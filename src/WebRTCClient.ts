/**
 * Main WebRTC client implementation
 * Provides the public API for the WebRTC SDK
 */

import { ConfigManager } from './ConfigManager.js';
import { SipManager } from './SipManager.js';
import { SessionManager } from './SessionManager.js';
import { AudioManager } from './AudioManager.js';
import { CallStateStore } from './CallStateStore.js';
import { SDKEventEmitter, COGNIGY_WEBRTC_EVENTS } from './utils/events.js';
import { isWebRTCSupported, withTimeout } from './utils/helpers.js';
import type { ExtendedRTCSession } from './types/internal.js';
import { SDK_END_CAUSES } from './types/index.js';
import type {
	WebRTCClient as IWebRTCClient,
	WebRTCClientConfig,
	CallSession,
	CallEndInfo,
	CallStatus,
	ClientState,
	EndpointConfig,
	EventName,
	EventCallback,
	SendDTMFOptions
} from './types/index.js';

// JsSIP's own cause names, reused where the SDK ends a call for the same reason
const CONNECTION_ERROR = 'Connection Error';
const CANCELED = 'Canceled';
const INTERNAL_ERROR = 'Internal Error';

const isLive = (status: CallStatus) => status === 'connecting' || status === 'ringing' || status === 'answered';
const isTerminal = (status: CallStatus) => status === 'ended' || status === 'failed';

export class WebRTCClient extends SDKEventEmitter implements IWebRTCClient {
	private configManager: ConfigManager;
	private sipManager: SipManager;
	private sessionManager: SessionManager;
	private audioManager: AudioManager;
	private callStateStore = new CallStateStore();
	private isInitialized = false;
	private isDestroyed = false;
	private readonly callSetupTimeoutMs: number | undefined;
	private readonly disconnectAfterCall: boolean;
	private connectPromise: Promise<void> | null = null;
	private abortConnect: ((error: Error) => void) | null = null;
	private setupTimer: ReturnType<typeof setTimeout> | null = null;
	/** Session whose events drive the state; events from any other session are ignored. */
	private currentSessionId: string | null = null;

	constructor(config: WebRTCClientConfig) {
		super();
		this.callSetupTimeoutMs = config.callSetupTimeoutMs;
		this.disconnectAfterCall = config.disconnectAfterCall ?? false;

		// Validate WebRTC support
		if (!isWebRTCSupported()) {
			throw new Error('WebRTC is not supported in this environment');
		}
		// Initialize managers
		this.configManager = new ConfigManager(config.endpointUrl, config?.userId || undefined);
		this.sipManager = new SipManager();
		this.sessionManager = new SessionManager(config.pcConfig, (rtc) => this.sessionManager.createSession(rtc));
		this.audioManager = new AudioManager();

		// Set audio manager on session manager for direct audio handling
		this.sessionManager.setAudioManager(this.audioManager);

		if (config.captureAudio) {
			this.audioManager.setCaptureAudio(true);
		}

		this.setupEventHandlers();
		this.setupStateHandlers();
	}

	/**
	 * Feed the state store from session events. Registered on the internal
	 * managers, independent of the public forwarding above.
	 */
	private setupStateHandlers(): void {
		const store = this.callStateStore;
		const sm = this.sessionManager;
		const isCurrent = (session: CallSession) => session.id === this.currentSessionId;

		let previousStatus = store.getState().status;
		store.on(COGNIGY_WEBRTC_EVENTS.STATE_CHANGED, (state: ClientState) => {
			const callFinished = isTerminal(state.status) && !isTerminal(previousStatus);
			previousStatus = state.status;
			// Before forwarding, so a connect() from a stateChanged listener isn't
			// aborted by this disconnect and subscribers see the UA already stopped
			if (callFinished && this.disconnectAfterCall) {
				this.disconnect().catch(() => undefined);
			}
			this.emit(COGNIGY_WEBRTC_EVENTS.STATE_CHANGED, state);
		});
		sm.on(COGNIGY_WEBRTC_EVENTS.SESSION_CREATED, (session) => {
			this.clearSetupTimer();
			this.currentSessionId = session.id;
			store.update({ session });
		});
		sm.on(COGNIGY_WEBRTC_EVENTS.RINGING, (session) => {
			if (isCurrent(session)) store.update({ status: 'ringing', session });
		});
		sm.on(COGNIGY_WEBRTC_EVENTS.ANSWERED, (session) => {
			if (isCurrent(session)) store.update({ status: 'answered', session });
		});
		sm.on(COGNIGY_WEBRTC_EVENTS.ENDED, (session, endInfo) => {
			if (isCurrent(session)) store.update({ status: 'ended', session, endInfo, remoteStream: null, localStream: null });
		});
		sm.on(COGNIGY_WEBRTC_EVENTS.FAILED, (session, endInfo) => {
			if (isCurrent(session)) store.update({ status: 'failed', session, endInfo, remoteStream: null, localStream: null });
		});
		sm.on(COGNIGY_WEBRTC_EVENTS.MUTED, (session) => {
			if (isCurrent(session)) store.update({ muted: true });
		});
		sm.on(COGNIGY_WEBRTC_EVENTS.UNMUTED, (session) => {
			if (isCurrent(session)) store.update({ muted: false });
		});
		sm.on(COGNIGY_WEBRTC_EVENTS.TRANSCRIPTION, (info) => store.addTranscription(info));
		sm.on(COGNIGY_WEBRTC_EVENTS.STREAMS_CHANGED, (remoteStream, localStream) =>
			store.update({ remoteStream, localStream })
		);

		// Transport lost mid-call. Before a session exists JsSIP is still
		// connecting or reconnecting, and the setup timer covers that.
		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.DISCONNECTED, () => {
			if (!this.sessionManager.getRawSession()) {
				return;
			}
			this.endCallState('ended', null, CONNECTION_ERROR);
			this.disconnect().catch(() => undefined);
		});
	}

	private startSetupTimer(): void {
		this.clearSetupTimer();
		// Opt-in: connect-only consumers must not be failed by a timer
		if (!this.callSetupTimeoutMs) {
			return;
		}
		this.setupTimer = setTimeout(() => this.onSetupTimeout(), this.callSetupTimeoutMs);
	}

	private clearSetupTimer(): void {
		if (this.setupTimer) {
			clearTimeout(this.setupTimer);
			this.setupTimer = null;
		}
	}

	private onSetupTimeout(): void {
		this.setupTimer = null;
		// Detach first so the terminated session's own failed event doesn't win
		this.currentSessionId = null;
		if (this.sessionManager.getRawSession()) {
			try {
				this.sessionManager.terminate(480, 'Call setup timeout');
			} catch (error) {
				console.error('Failed to terminate session on setup timeout:', error);
			}
		}
		this.abortConnect?.(new Error('Call setup timeout'));
		this.teardown();
		this.endCallState('failed', 'local', SDK_END_CAUSES.SETUP_TIMEOUT);
	}

	/** Set a terminal state the SDK decided on, detached from any session. */
	private endCallState(status: 'ended' | 'failed', originator: CallEndInfo['originator'], cause: string, description: string | null = null): void {
		this.clearSetupTimer();
		this.currentSessionId = null;
		this.callStateStore.update({ status, endInfo: { originator, cause, description } });
	}

	/** Stop audio, sessions and the UA; keeps every listener for the next call. */
	private teardown(): void {
		this.clearSetupTimer();
		this.audioManager.stopAudio();
		this.sessionManager.terminateAll();
		this.sipManager.stop();
		this.isInitialized = false;
	}

	/** Reset the state for a new call and arm the setup timer. */
	private beginCall(): void {
		this.currentSessionId = null;
		this.callStateStore.startCall();
		this.startSetupTimer();
	}

	/**
	 * Set up event handlers between managers
	 */
	private setupEventHandlers(): void {
		// SIP Manager events
		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.CONNECTING, () => {
			this.emit(COGNIGY_WEBRTC_EVENTS.CONNECTING);
		});

		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.CONNECTED, () => {
			this.emit(COGNIGY_WEBRTC_EVENTS.CONNECTED);
		});

		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.DISCONNECTED, (info) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.DISCONNECTED, info);
		});

		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.REGISTERED, () => {
			this.emit(COGNIGY_WEBRTC_EVENTS.REGISTERED);
		});

		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.UNREGISTERED, () => {
			this.emit(COGNIGY_WEBRTC_EVENTS.UNREGISTERED);
		});

		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.REGISTRATION_FAILED, (info) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.REGISTRATION_FAILED, info);
		});

		this.sipManager.on('newRTCSession', (rtcSession) => {
			if (this.isDestroyed) return;
			this.sessionManager.createSession(rtcSession);
		});

		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.ERROR, (error) => {
			this.emitError(error);
		});

		// Session Manager events
		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.SESSION_CREATED, (session) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.SESSION_CREATED, session);
		});

		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.RINGING, (session) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.RINGING, session);
		});

		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.ANSWERED, (session) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.ANSWERED, session);
		});

		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.ENDED, (session, endInfo) => {
			this.audioManager.stopAudio();
			this.emit(COGNIGY_WEBRTC_EVENTS.ENDED, session, endInfo);
		});

		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.FAILED, (session, endInfo) => {
			this.audioManager.stopAudio();
			this.emit(COGNIGY_WEBRTC_EVENTS.FAILED, session, endInfo);
		});

		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.MUTED, (session) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.MUTED, session);
		});

		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.UNMUTED, (session) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.UNMUTED, session);
		});



		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.INFO_SENT, (text, data) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.INFO_SENT, text, data);
		});

		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.DTMF_SENT, (tones) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.DTMF_SENT, tones);
		});

		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.INFO_RECEIVED, (info) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.INFO_RECEIVED, info);
		});

		this.sessionManager.on(COGNIGY_WEBRTC_EVENTS.TRANSCRIPTION, (info) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.TRANSCRIPTION, info);
		});

		// Audio Manager events
		this.audioManager.on(COGNIGY_WEBRTC_EVENTS.AUDIO_ENDED, () => {
			this.emit(COGNIGY_WEBRTC_EVENTS.AUDIO_ENDED);
		});

		this.audioManager.on(COGNIGY_WEBRTC_EVENTS.ERROR, (error) => {
			this.emitError(error);
		});
		this.audioManager.on(COGNIGY_WEBRTC_EVENTS.CAPTURE_AUDIO, (stream) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.CAPTURE_AUDIO, stream);
		});

	}

	/**
	 * EventEmitter throws on an unhandled 'error', which would surface inside
	 * JsSIP's callbacks. Failures also reach the state and connect()'s rejection.
	 */
	private emitError(error: Error): void {
		if (this.listenerCount(COGNIGY_WEBRTC_EVENTS.ERROR) > 0) {
			this.emit(COGNIGY_WEBRTC_EVENTS.ERROR, error);
		}
	}

	/**
	 * Fetch the endpoint configuration (cached; concurrent calls share one request).
	 * Does not validate SIP fields, so widgets can render configs connect() rejects.
	 */
	loadConfig(): Promise<EndpointConfig> {
		return this.configManager.fetchConfig();
	}

	getConfig(): EndpointConfig | null {
		return this.configManager.getConfig();
	}

	/**
	 * Set the SIP user id. The UA is created from it, so it is locked once the
	 * UA exists (connect in progress or completed, until disconnect).
	 */
	setUserId(id: string): void {
		if (this.sipManager.getUserAgent()) {
			throw new Error('Cannot change userId while connected');
		}
		this.configManager.setUserId(id);
	}

	/**
	 * Connect to the SIP server and start a new call attempt: resets the state
	 * to `connecting` and arms the setup timer (if `callSetupTimeoutMs` is set).
	 * While a call is in progress it returns the in-flight promise.
	 *
	 * Rejects (`Failed to connect: …`) on config, registration or connection
	 * failure (state `failed`), when the setup timeout fires (`SETUP_TIMEOUT`),
	 * and when the attempt is cancelled by endCall() or disconnect() (state
	 * `ended`, cause `Canceled`).
	 */
	connect(): Promise<void> {
		if (this.isDestroyed) {
			return Promise.reject(new Error('Client has been destroyed'));
		}
		if (this.connectPromise && isLive(this.callStateStore.getState().status)) {
			return this.connectPromise;
		}

		this.beginCall();
		const promise = this.establishConnection();
		this.connectPromise = promise;
		return promise;
	}

	private async establishConnection(): Promise<void> {
		let cause: string = CONNECTION_ERROR;
		let aborted = false;
		let abortError: Error | null = null;
		let removeListeners = () => {};
		let abort!: (error: Error) => void;
		const abortion = new Promise<never>((_, reject) => {
			abort = (error: Error) => {
				aborted = true;
				abortError = error;
				reject(error);
			};
		});
		abortion.catch(() => undefined);
		this.abortConnect = abort;
		const abortable = <T>(promise: Promise<T>) => Promise.race([promise, abortion]);

		try {
			if (this.isConnected()) {
				return;
			}

			cause = SDK_END_CAUSES.CONFIG_FETCH_FAILED;
			await abortable(this.loadConfig());
			// A cached config wins the race against a same-tick abort
			if (aborted) {
				throw abortError ?? new Error(CANCELED);
			}
			cause = SDK_END_CAUSES.CONFIG_INVALID;
			this.configManager.assertCallable();
			cause = SDK_END_CAUSES.WIDGET_INACTIVE;
			if (!this.configManager.isActive()) {
				throw new Error('WebRTC widget is not active in the configuration');
			}
			cause = CONNECTION_ERROR;

			const sipCredentials = this.configManager.getSipCredentials();
			this.sipManager.initialize(
				{
					fullUsername: sipCredentials.fullUsername,
					password: sipCredentials.password,
					username: sipCredentials.username,
					userId: sipCredentials.userId,
					organisationId: sipCredentials.organisationId,
					projectId: sipCredentials.projectId,
					endpointId: sipCredentials.endpointId,
				},
				{
					wsUri: sipCredentials.wsUri,
					pcConfig: this.configManager.getPeerConnectionConfig(),
				}
			);

			await abortable(
				withTimeout(
					new Promise<void>((resolve, reject) => {
						const sip = this.sipManager;
						let connected = false;
						let registered = !sip.needsRegistration();
						const settle = () => {
							if (connected && registered) resolve();
						};
						const onConnected = () => {
							connected = true;
							settle();
						};
						const onRegistered = () => {
							registered = true;
							settle();
						};
						// Emitted just before the matching 'error'
						const onRegistrationFailed = () => {
							cause = SDK_END_CAUSES.REGISTRATION_FAILED;
						};
						const onError = (error: Error) => reject(error);

						sip.on(COGNIGY_WEBRTC_EVENTS.CONNECTED, onConnected);
						sip.on(COGNIGY_WEBRTC_EVENTS.REGISTERED, onRegistered);
						sip.on(COGNIGY_WEBRTC_EVENTS.REGISTRATION_FAILED, onRegistrationFailed);
						sip.on(COGNIGY_WEBRTC_EVENTS.ERROR, onError);
						removeListeners = () => {
							sip.off(COGNIGY_WEBRTC_EVENTS.CONNECTED, onConnected);
							sip.off(COGNIGY_WEBRTC_EVENTS.REGISTERED, onRegistered);
							sip.off(COGNIGY_WEBRTC_EVENTS.REGISTRATION_FAILED, onRegistrationFailed);
							sip.off(COGNIGY_WEBRTC_EVENTS.ERROR, onError);
						};

						sip.start();
					}),
					15000
				)
			);
			// An abort can land after the wait settled but before this continuation
			if (aborted) {
				throw abortError ?? new Error(CANCELED);
			}
			this.isInitialized = true;
		} catch (error) {
			// Whoever aborted has already torn down and set the state
			if (!aborted) {
				this.teardown();
				this.endCallState('failed', null, cause);
			}
			throw new Error(`Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			removeListeners();
			if (this.abortConnect === abort) {
				this.abortConnect = null;
			}
		}
	}

	/**
	 * Disconnect from the SIP server. Cancels a pending connect(); a call that
	 * has no session yet ends with cause `Canceled`.
	 */
	async disconnect(): Promise<void> {
		if (!this.isInitialized && !this.sipManager.getUserAgent() && !this.abortConnect) {
			return;
		}

		try {
			this.cancelOrTeardown(new Error('Disconnected'));
		} catch (error) {
			console.error('Error during disconnect:', error);
			throw new Error(`Failed to disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/** Tear down; a live call without a session ends as `Canceled`. */
	private cancelOrTeardown(reason: Error): void {
		const canceling = isLive(this.callStateStore.getState().status) && !this.sessionManager.getRawSession();
		this.abortConnect?.(reason);
		this.teardown();
		if (canceling) {
			this.endCallState('ended', 'local', CANCELED);
		}
	}

	/**
	 * Start a call. No-op while a session is live. On a connected client after
	 * an earlier call (no new connect()), resets the state and arms the setup
	 * timer like connect() does. Does not re-check registration: connect()
	 * already waited for it, and JsSIP dials and reconnects the transport itself.
	 */
	async startCall(): Promise<void> {
		if (!this.isInitialized) {
			throw new Error('Client not connected. Call connect() first.');
		}

		if (this.sessionManager.getRawSession()) {
			return;
		}

		if (this.callStateStore.getState().status !== 'connecting') {
			this.beginCall();
		}

		try {
			this.sipManager.call(this.configManager.getCallTarget());
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			this.endCallState('failed', 'local', INTERNAL_ERROR, message);
			throw new Error(`Failed to start call: ${message}`);
		}
	}

	/**
	 * End the current call. Before a session exists (still connecting), stops
	 * the UA and ends with cause `Canceled`; otherwise sends 480 and the state
	 * follows the session's events.
	 */
	async endCall(): Promise<void> {
		if (!this.sessionManager.getRawSession() && isLive(this.callStateStore.getState().status)) {
			this.cancelOrTeardown(new Error(CANCELED));
			return;
		}
		this.clearSetupTimer();
		try {
			this.sessionManager.terminate(480, 'Ended by user');
		} catch (error) {
			throw new Error(`Failed to end call: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Mute the current call
	 */
	async mute(): Promise<void> {
		try {
			this.sessionManager.mute();
		} catch (error) {
			throw new Error(`Failed to mute call: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Unmute the current call
	 */
	async unmute(): Promise<void> {
		try {
			this.sessionManager.unmute();
		} catch (error) {
			throw new Error(`Failed to unmute call: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * connect() then startCall(). Rejects like connect(), including when the
	 * attempt is cancelled via endCall() or the setup timeout fires. A cancel
	 * or timeout after connect() resolved but before dialing rejects with
	 * `Failed to connect: <end cause>` (e.g. `Canceled`, `SETUP_TIMEOUT`).
	 */
	async connectAndCall(): Promise<void> {
		await this.connect();
		const { status, endInfo } = this.callStateStore.getState();
		if (isTerminal(status)) {
			throw new Error(`Failed to connect: ${endInfo?.cause ?? CANCELED}`);
		}
		await this.startCall();
	}

	/**
	 * Send DTMF tones
	 */
	async sendDTMF(tones: string | number, options?: SendDTMFOptions): Promise<void> {
		try {
			this.sessionManager.sendDTMF(tones, options);
		} catch (error) {
			throw new Error(`Failed to send DTMF: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Send info message
	 */
	async sendInfo(text: string, data: Record<string, any> = {}): Promise<void> {
		try {
			this.sessionManager.sendInfo(text, data);
		} catch (error) {
			throw new Error(`Failed to send info: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Add event listener
	 */
	on<T extends EventName>(event: T, callback: EventCallback<T>): this {
		super.on(event, callback as any);
		return this;
	}

	/**
	 * Remove event listener
	 */
	off<T extends EventName>(event: T, callback: EventCallback<T>): this {
		super.off(event, callback as any);
		return this;
	}

	/**
	 * Check if connected to SIP server
	 */
	isConnected(): boolean {
		return (
			this.isInitialized &&
			this.sipManager.isConnected() &&
			(this.sipManager.isRegistered() || !this.sipManager.needsRegistration())
		);
	}

	/**
	 * Get current active session
	 */
	getCurrentSession(): CallSession | null {
		return this.sessionManager.getActiveSession();
	}

	getState(): ClientState {
		return this.callStateStore.getState();
	}

	subscribe(listener: (state: ClientState) => void): () => void {
		this.on(COGNIGY_WEBRTC_EVENTS.STATE_CHANGED, listener);
		return () => {
			this.off(COGNIGY_WEBRTC_EVENTS.STATE_CHANGED, listener);
		};
	}

	/**
	 * Advanced/unstable: underlying JsSIP session.
	 */
	getRawSession(): ExtendedRTCSession | null {
		return this.sessionManager.getRawSession();
	}

	/**
	 * Destroy the client and clean up resources
	 */
	async destroy(): Promise<void> {
		if (this.isDestroyed) {
			return;
		}

		try {
			await this.disconnect();
			this.clearSetupTimer();

			// Clean up managers
			this.audioManager.destroy();
			this.sessionManager.destroy();
			this.sipManager.destroy();

			// Clear configuration
			this.configManager.clearConfig();

			// Remove all event listeners
			this.removeAllListeners();

			this.isDestroyed = true;

		} catch (error) {
			console.error('Error during destroy:', error);
			throw new Error(`Failed to destroy client: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Get client status information
	 */
	getStatus(): {
		connected: boolean;
		registered: boolean;
		activeSession: CallSession | null;
		audioState: any;
	} {
		return {
			connected: this.sipManager.isConnected(),
			registered: this.sipManager.isRegistered(),
			activeSession: this.getCurrentSession(),
			audioState: this.audioManager.getState(),
		};
	}
}
