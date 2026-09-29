/**
 * Session management for the WebRTC SDK
 * Adapted from the original SipSession class
 */

import { Grammar } from 'jssip';
import type { DTMFOptions } from 'jssip/lib/RTCSession';
import type { IncomingResponse } from 'jssip/lib/SIPMessage';
import { SDKEventEmitter, COGNIGY_WEBRTC_EVENTS } from './utils/events.js';
import type {
	ExtendedRTCSession,
	SessionState,
} from './types/internal.js';
import type { CallSession, SendDTMFOptions } from './types/index.js';
import { randomId } from './utils/helpers.js';

export class SessionManager extends SDKEventEmitter {
	private sessions: Map<string, SessionState> = new Map();
	/** Sessions whose last streamsChanged carried at least one stream. */
	private sessionsWithStreams = new Set<string>();
	private activeSessionId: string | null = null;
	private audioManager?: any;
	private readonly pcConfig?: RTCConfiguration;
	private readonly onNewSession: (rtcSession: ExtendedRTCSession) => void;

	/**
	 * @param pcConfig - Peer connection config, reused for sessions created via REFER/replaces
	 * @param onNewSession - Receives sessions JsSIP creates for REFER/replaces; defaults to createSession
	 */
	constructor(pcConfig?: RTCConfiguration, onNewSession?: (rtcSession: ExtendedRTCSession) => void) {
		super();
		this.pcConfig = pcConfig;
		this.onNewSession = onNewSession ?? ((rtcSession) => this.createSession(rtcSession));
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
		// JsSIP announces REFER/replaces sessions twice (init callback, then newRTCSession)
		for (const existing of this.sessions.values()) {
			if (existing.rtcSession === rtcSession) {
				return existing.id;
			}
		}

		const sessionId = rtcSession.data?.sessionId || randomId('session');
		if (rtcSession.data) {
			rtcSession.data.sessionId = sessionId;
		}

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
			if (rtcSession._connection) {
				this.emitStreams(sessionState, rtcSession._connection);
			}
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

		this.setupTransferHandlers(rtcSession);
		this.setupIceHandler(rtcSession);

		// Peer connection events for audio handling
		this.setupPeerConnectionHandlers(sessionState);
	}

	/**
	 * Always accept incoming REFER and replaces requests; JsSIP hands us the new session.
	 */
	private setupTransferHandlers(rtcSession: ExtendedRTCSession): void {
		rtcSession.on('refer', (data: any) => {
			const { request, accept } = data;
			accept(
				(newSession: ExtendedRTCSession) => {
					// Flag it so the UI does not play ringing
					if (request?.refer_to?.uri?.hasHeader('replaces')) {
						newSession.data.replaces = true;
					}
					this.onNewSession(newSession);
				},
				{
					mediaConstraints: { audio: true, video: false },
					pcConfig: this.pcConfig,
				},
			);
		});

		rtcSession.on('replaces', (data: any) => {
			data.accept((newSession: ExtendedRTCSession) => {
				newSession.data.replaces = true;
				this.onNewSession(newSession);

				if (!newSession.isEstablished()) {
					newSession.answer({
						mediaConstraints: { audio: true, video: false },
						pcConfig: this.pcConfig,
					});
				}
			});
		});
	}

	/**
	 * Finish ICE gathering early once a srflx or relay candidate exists, instead of
	 * waiting for every candidate (host candidates alone are not routable).
	 */
	private setupIceHandler(rtcSession: ExtendedRTCSession): void {
		let routable = false;
		let readyCalled = false;

		rtcSession.on('icecandidate', (evt: any) => {
			const candidate = evt?.candidate?.candidate;
			if (typeof candidate !== 'string') {
				return;
			}
			const type = candidate.split(' ')[7];
			if (type === 'srflx' || type === 'relay') {
				routable = true;
			}
			if (routable && !readyCalled) {
				readyCalled = true;
				evt.ready();
			}
		});
	}

	private handleNewInfo(data: any): void {
		const { originator, info } = data;
		try {
			if (originator === 'remote') {
				const parsedData = JSON.parse(info.body);
				// biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn needs Safari 15.4 / Chrome 93
				if (Object.prototype.hasOwnProperty.call(parsedData, '_transcription')) {
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
			pc.addEventListener('negotiationneeded', () => this.emitStreams(sessionState, pc));
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
				this.emitStreams(sessionState, pc);
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
	 * Emit the peer connection's current remote/local audio streams (internal
	 * event). A null pair is emitted once when the last audio track goes away.
	 */
	private emitStreams(sessionState: SessionState, pc: RTCPeerConnection): void {
		const audioTracks = (items: Array<RTCRtpReceiver | RTCRtpSender>): MediaStreamTrack[] =>
			items
				.map((item) => item.track)
				.filter((track): track is MediaStreamTrack => !!track && track.kind === 'audio');

		const remoteTracks = audioTracks(pc.getReceivers());
		const localTracks = audioTracks(pc.getSenders());
		const remote = remoteTracks.length > 0 ? new MediaStream(remoteTracks) : null;
		const local = localTracks.length > 0 ? new MediaStream(localTracks) : null;

		if (remote || local) {
			this.sessionsWithStreams.add(sessionState.id);
		} else if (!this.sessionsWithStreams.delete(sessionState.id)) {
			return;
		}
		this.emit(COGNIGY_WEBRTC_EVENTS.STREAMS_CHANGED, remote, local);
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
	sendDTMF(tones: string | number, options?: SendDTMFOptions): void {
		const sessionState = this.getActiveSessionState();
		if (sessionState?.rtcSession?.isEstablished()) {
			// SendDTMFOptions' transportType literals match JsSIP's DTMF_TRANSPORT string enum values
			sessionState.rtcSession.sendDTMF(String(tones), options as DTMFOptions);
			this.emit(COGNIGY_WEBRTC_EVENTS.DTMF_SENT, String(tones));
		} else {
			throw new Error('No active session to send DTMF');
		}
	}

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
	 * Terminate the current session (also works while it is still ringing)
	 */
	terminate(sipCode: number = 480, sipReason: string = 'Ended by user'): void {
		const sessionState = this.getCurrentSessionState();
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
	 * Current session: the active one, else the most recently created that has not ended or failed
	 */
	private getCurrentSessionState(): SessionState | null {
		const active = this.getActiveSessionState();
		if (active) {
			return active;
		}
		const states = Array.from(this.sessions.values());
		for (let i = states.length - 1; i >= 0; i--) {
			const state = states[i];
			if (state.status !== 'ended' && state.status !== 'failed') {
				return state;
			}
		}
		return null;
	}

	/**
	 * Advanced/unstable: underlying JsSIP session.
	 */
	getRawSession(): ExtendedRTCSession | null {
		return this.getCurrentSessionState()?.rtcSession ?? null;
	}

	/**
	 * Remove session
	 */
	private removeSession(sessionId: string): void {
		this.sessions.delete(sessionId);
		this.sessionsWithStreams.delete(sessionId);
		if (this.activeSessionId === sessionId) {
			this.activeSessionId = null;
		}
		this.emit(COGNIGY_WEBRTC_EVENTS.SESSION_DESTROYED, sessionId);
	}

	/**
	 * Terminate every session that has not ended. Keeps listeners, so the
	 * client's wiring survives disconnect() and serves the next call.
	 */
	terminateAll(): void {
		for (const sessionState of this.sessions.values()) {
			const ended = sessionState.status === 'ended' || sessionState.status === 'failed';
			if (!ended && sessionState.rtcSession && !sessionState.rtcSession.isEnded()) {
				sessionState.rtcSession.terminate();
			}
		}

		this.sessions.clear();
		this.sessionsWithStreams.clear();
		this.activeSessionId = null;
	}

	/**
	 * Terminate all sessions and remove all listeners
	 */
	destroy(): void {
		this.terminateAll();
		this.removeAllListeners();
	}
}
