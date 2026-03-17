/**
 * Session management for the WebRTC SDK
 * Adapted from the original SipSession class
 */

import { Grammar } from 'jssip';
import type { IncomingResponse } from 'jssip/lib/SIPMessage';
import { SDKEventEmitter, COGNIGY_WEBRTC_EVENTS } from './utils/events.js';
import type {
	ExtendedRTCSession,
	SessionState,
} from './types/internal.js';
import type { CallSession } from './types/index.js';
import { randomId } from './utils/helpers.js';

export class SessionManager extends SDKEventEmitter {
	private sessions: Map<string, SessionState> = new Map();
	private activeSessionId: string | null = null;
	private audioManager?: any;

	constructor(_pcConfig?: RTCConfiguration) {
		super();
	}

	/**
	 * Set the audio manager for direct audio handling
	 */
	setAudioManager(audioManager: any): void {
		this.audioManager = audioManager;
	}

	/**
	 * Create a new session from an RTC session
	 */
	createSession(rtcSession: ExtendedRTCSession): string {
		const sessionId = rtcSession.data?.sessionId || randomId('session');

		const sessionState: SessionState = {
			id: sessionId,
			startTime: new Date(),
			status: 'init',
			active: false,
			endInfo: {
				originator: null,
				cause: null,
				description: null,
			},
			muted: false,
			localHold: false,
			remoteHold: false,
			doingAttendedTransfer: false,
			autoMerge: false,
			rtcSession,
		};

		this.sessions.set(sessionId, sessionState);
		this.setupSessionEventHandlers(sessionState);

		this.emit(COGNIGY_WEBRTC_EVENTS.SESSION_CREATED, this.getPublicSession(sessionState));

		return sessionId;
	}

	/**
	 * Set up event handlers for a session
	 */
	private setupSessionEventHandlers(sessionState: SessionState): void {
		const { rtcSession } = sessionState;

		rtcSession.on('connecting', () => {
			this.updateSession(sessionState);
			this.emit(COGNIGY_WEBRTC_EVENTS.CONNECTING, this.getPublicSession(sessionState));
		});

		// Progress event (ringing)
		rtcSession.on('progress', () => {
			sessionState.status = 'ringing';
			this.updateSession(sessionState);
			this.emit(COGNIGY_WEBRTC_EVENTS.RINGING, this.getPublicSession(sessionState));
		});

		// Accepted event (answered)
		rtcSession.on('accepted', () => {
			sessionState.status = 'answered';
			this.setActiveSession(sessionState.id);
			this.updateSession(sessionState);
			this.emit(COGNIGY_WEBRTC_EVENTS.ANSWERED, this.getPublicSession(sessionState));
		});

		// Failed event
		rtcSession.on('failed', (data: any) => {
			this.handleSessionEnd(sessionState, data, 'failed');
		});

		// Ended event
		rtcSession.on('ended', (data: any) => {
			this.handleSessionEnd(sessionState, data, 'ended');
		});

		// Mute/unmute events
		rtcSession.on('muted', () => {
			sessionState.muted = true;
			this.updateSession(sessionState);
			this.emit(COGNIGY_WEBRTC_EVENTS.MUTED, this.getPublicSession(sessionState));
		});

		rtcSession.on('unmuted', () => {
			sessionState.muted = false;
			this.updateSession(sessionState);
			this.emit(COGNIGY_WEBRTC_EVENTS.UNMUTED, this.getPublicSession(sessionState));
		});

		// Hold/unhold events
		rtcSession.on('hold', (data: any) => {
			if (data.originator === 'local') {
				sessionState.localHold = true;
			} else if (data.originator === 'remote') {
				sessionState.remoteHold = true;
			}
			this.updateSession(sessionState);
		});

		rtcSession.on('unhold', (data: any) => {
			if (data.originator === 'local') {
				sessionState.localHold = false;
			} else if (data.originator === 'remote') {
				sessionState.remoteHold = false;
			}
			this.updateSession(sessionState);
		});

		// SDP modification for Firefox OPUS stereo fix
		rtcSession.on('sdp', (evt: any) => {
			if (evt.sdp.includes('opus') && evt.sdp.includes('stereo=1')) {
				evt.sdp = evt.sdp.replace('stereo=1', 'stereo=0');
			}
		});


		// info messages
		rtcSession.on('newInfo', this.handleNewInfo.bind(this));

		// Peer connection events for audio handling
		this.setupPeerConnectionHandlers(sessionState);
	}

	private handleNewInfo(data: any): void {
		const { originator, info } = data;
		try {
			if (originator === 'remote') {
				const parsedData = JSON.parse(info.body);
				if (Object.hasOwn(parsedData, '_transcription')) {
					// Emit transcription event and stop here - don't emit newInfo for transcription events
					this.emit(COGNIGY_WEBRTC_EVENTS.TRANSCRIPTION, parsedData._transcription);
					return;
				}
			}
			this.emit(COGNIGY_WEBRTC_EVENTS.INFO_RECEIVED, data);
		} catch (_error) {
			this.emit(COGNIGY_WEBRTC_EVENTS.INFO_RECEIVED, data);
		}
	}

	/**
	 * Set up peer connection event handlers
	 */
	private setupPeerConnectionHandlers(sessionState: SessionState): void {
		const { rtcSession } = sessionState;

		const attachPCListeners = (pc: RTCPeerConnection) => {
			pc.addEventListener('track', (event: any) => {
				const track = event.track;

				// Only forward audio tracks to the audio manager
				if (track && track.kind === 'audio') {
					const stream = new MediaStream();
					stream.addTrack(track);

					if (this.audioManager) {
						this.audioManager.handleRemoteStream(stream);
					}
				}
			});
		};

		if (rtcSession._connection) {
			attachPCListeners(rtcSession._connection);
		} else {
			rtcSession.on('peerconnection', (data: any) => {
				const pc = data.peerconnection;
				attachPCListeners(pc);
			});
		}
	}

	/**
	 * Handle session end (failed or ended)
	 */
	private handleSessionEnd(sessionState: SessionState, data: any, status: 'failed' | 'ended'): void {
		const { originator, cause, message } = data;
		let description: string | null = null;

		// Extract description from message
		if (message && originator === 'remote') {
			if (status === 'failed' && (message as IncomingResponse).status_code) {
				description = `${(message as IncomingResponse).status_code}`.trim();
			} else if (status === 'ended' && message.hasHeader && message.hasHeader('Reason')) {
				const reason = Grammar.parse(message.getHeader('Reason'), 'Reason');
				if (reason) {
					description = `${reason.cause}`.trim();
				}
			}
		}

		sessionState.endInfo = {
			originator,
			cause,
			description,
		};
		sessionState.status = status;
		sessionState.active = false;

		// Clear active session if this was the active one
		if (this.activeSessionId === sessionState.id) {
			this.activeSessionId = null;
		}

		this.updateSession(sessionState);

		// Emit appropriate event
		const publicSession = this.getPublicSession(sessionState);
		if (status === 'failed') {
			this.emit(COGNIGY_WEBRTC_EVENTS.FAILED, publicSession, sessionState.endInfo);
		} else {
			this.emit(COGNIGY_WEBRTC_EVENTS.ENDED, publicSession, sessionState.endInfo);
		}

		// Emit audio ended event
		this.emit(COGNIGY_WEBRTC_EVENTS.AUDIO_ENDED);

		// Clean up session after a delay
		setTimeout(() => {
			this.removeSession(sessionState.id);
		}, 5000);
	}

	/**
	 * Update session and emit change event
	 */
	private updateSession(sessionState: SessionState): void {
		this.sessions.set(sessionState.id, sessionState);
		this.emit(COGNIGY_WEBRTC_EVENTS.SESSION_UPDATED, this.getPublicSession(sessionState));
	}

	/**
	 * Convert internal session state to public session
	 */
	private getPublicSession(sessionState: SessionState): CallSession {
		return {
			id: sessionState.id,
			status: sessionState.status,
			direction: sessionState.rtcSession.direction === 'outgoing' ? 'outgoing' : 'incoming',
			startTime: sessionState.startTime,
			answerTime: sessionState.rtcSession.start_time || undefined,
			duration: this.calculateDuration(sessionState),
			muted: sessionState.muted,
			localHold: sessionState.localHold,
			remoteHold: sessionState.remoteHold,
		};
	}

	/**
	 * Calculate session duration
	 */
	private calculateDuration(sessionState: SessionState): number {
		if (!sessionState.rtcSession.start_time) {
			return 0;
		}
		const now = new Date();
		return Math.floor((now.getTime() - sessionState.rtcSession.start_time.getTime()) / 1000);
	}

	/**
	 * Set active session
	 */
	setActiveSession(sessionId: string): void {
		const sessionState = this.sessions.get(sessionId);
		if (!sessionState) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		// Deactivate previous active session
		if (this.activeSessionId && this.activeSessionId !== sessionId) {
			const prevSession = this.sessions.get(this.activeSessionId);
			if (prevSession) {
				prevSession.active = false;
				if (prevSession.rtcSession.isEstablished() && !prevSession.localHold) {
					prevSession.rtcSession.hold();
				}
			}
		}

		// Activate new session
		sessionState.active = true;
		this.activeSessionId = sessionId;

		// Unhold if established
		if (sessionState.rtcSession.isEstablished() && sessionState.localHold) {
			sessionState.rtcSession.unhold();
		}

		this.updateSession(sessionState);
	}

	/**
	 * Get active session
	 */
	getActiveSession(): CallSession | null {
		if (!this.activeSessionId) {
			return null;
		}

		const sessionState = this.sessions.get(this.activeSessionId);
		return sessionState ? this.getPublicSession(sessionState) : null;
	}

	/**
	 * Get session by ID
	 */
	getSession(sessionId: string): CallSession | null {
		const sessionState = this.sessions.get(sessionId);
		return sessionState ? this.getPublicSession(sessionState) : null;
	}

	/**
	 * Get all sessions
	 */
	getAllSessions(): CallSession[] {
		return Array.from(this.sessions.values()).map(state => this.getPublicSession(state));
	}

	/**
	 * Mute active session
	 */
	mute(): void {
		const sessionState = this.getActiveSessionState();
		if (!sessionState) {
			throw new Error('No active session to mute');
		}
		if (sessionState.rtcSession.isEstablished()) {
			sessionState.rtcSession.mute({ audio: true, video: true });
		} else {
			throw new Error('Session not established');
		}
	}

	/**
	 * Unmute active session
	 */
	unmute(): void {
		const sessionState = this.getActiveSessionState();
		if (sessionState?.rtcSession?.isEstablished()) {
			sessionState.rtcSession.unmute({ audio: true, video: true });
		}
	}

	/**
	 * Send DTMF tones
	 */
	// sendDTMF(tones: string | number): void {
	// 	console.log('sendDTMF',tones);
	// 	const sessionState = this.getActiveSessionState();
	// 	if (sessionState && sessionState.rtcSession.isEstablished()) {
	// 		sessionState.rtcSession.sendDTMF(tones);
	// 		this.emit(COGNIGY_WEBRTC_EVENTS.DTMF_SENT, tones.toString());
	// 	} else {
	// 		throw new Error('No active session to send DTMF');
	// 	}
	// }

	/**
	 * Send info message
	 */
	sendInfo(text: string, data: Record<string, any> = {}): void {
		const sessionState = this.getActiveSessionState();
		if (sessionState?.rtcSession?.isEstablished()) {
			sessionState.rtcSession.sendInfo(text, data);
			this.emit(COGNIGY_WEBRTC_EVENTS.INFO_SENT, text, data);
		} else {
			throw new Error('No active session to send info');
		}
	}

	/**
	 * Terminate active session
	 */
	terminate(sipCode: number = 480, sipReason: string = 'Ended by user'): void {
		const sessionState = this.getActiveSessionState();
		if (!sessionState) {
			throw new Error('No active session to terminate');
		}
		sessionState.rtcSession.terminate({
			status_code: sipCode,
			reason_phrase: sipReason,
		});
	}

	/**
	 * Get active session state (internal)
	 */
	private getActiveSessionState(): SessionState | null {
		return this.activeSessionId ? this.sessions.get(this.activeSessionId) || null : null;
	}

	/**
	 * Remove session
	 */
	private removeSession(sessionId: string): void {
		this.sessions.delete(sessionId);
		if (this.activeSessionId === sessionId) {
			this.activeSessionId = null;
		}
		this.emit(COGNIGY_WEBRTC_EVENTS.SESSION_DESTROYED, sessionId);
	}

	/**
	 * Clean up all sessions
	 */
	destroy(): void {
		// Terminate all active sessions
		for (const sessionState of this.sessions.values()) {
			if (sessionState.rtcSession && !sessionState.rtcSession.isEnded()) {
				sessionState.rtcSession.terminate();
			}
		}

		this.sessions.clear();
		this.activeSessionId = null;
		this.removeAllListeners();
	}
}
