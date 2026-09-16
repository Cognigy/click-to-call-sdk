/**
 * Main WebRTC client implementation
 * Provides the public API for the WebRTC SDK
 */

import { ConfigManager } from './ConfigManager.js';
import { SipManager } from './SipManager.js';
import { SessionManager } from './SessionManager.js';
import { AudioManager } from './AudioManager.js';
import { SDKEventEmitter, COGNIGY_WEBRTC_EVENTS } from './utils/events.js';
import { isWebRTCSupported, withTimeout } from './utils/helpers.js';
import type {
	WebRTCClient as IWebRTCClient,
	WebRTCClientConfig,
	CallSession,
	EventName,
	EventCallback
} from './types/index.js';

export class WebRTCClient extends SDKEventEmitter implements IWebRTCClient {
	private configManager: ConfigManager;
	private sipManager: SipManager;
	private sessionManager: SessionManager;
	private audioManager: AudioManager;
	private isInitialized = false;
	private isDestroyed = false;

	constructor(config: WebRTCClientConfig) {
		super();

		// Validate WebRTC support
		if (!isWebRTCSupported()) {
			throw new Error('WebRTC is not supported in this environment');
		}
		// Initialize managers
		this.configManager = new ConfigManager(config.endpointUrl, config?.userId || undefined);
		this.sipManager = new SipManager();
		this.sessionManager = new SessionManager(config.pcConfig);
		this.audioManager = new AudioManager();

		// Set audio manager on session manager for direct audio handling
		this.sessionManager.setAudioManager(this.audioManager);

		if (config.captureAudio) {
			this.audioManager.setCaptureAudio(true);
		}

		this.setupEventHandlers();
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

		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.DISCONNECTED, () => {
			this.emit(COGNIGY_WEBRTC_EVENTS.DISCONNECTED);
		});

		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.REGISTERED, () => {
			this.emit(COGNIGY_WEBRTC_EVENTS.REGISTERED);
		});

		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.UNREGISTERED, () => {
			this.emit(COGNIGY_WEBRTC_EVENTS.UNREGISTERED);
		});

		this.sipManager.on('newRTCSession', (rtcSession) => {
			// Create session in session manager
			this.sessionManager.createSession(rtcSession);
		});

		this.sipManager.on(COGNIGY_WEBRTC_EVENTS.ERROR, (error) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.ERROR, error);
		});

		// Session Manager events
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
			this.emit(COGNIGY_WEBRTC_EVENTS.ERROR, error);
		});
		this.audioManager.on(COGNIGY_WEBRTC_EVENTS.CAPTURE_AUDIO, (stream) => {
			this.emit(COGNIGY_WEBRTC_EVENTS.CAPTURE_AUDIO, stream);
		});

	}

	/**
	 * Connect to the SIP server
	 */
	async connect(): Promise<void> {
		if (this.isDestroyed) {
			throw new Error('Client has been destroyed');
		}

		try {
			// Fetch configuration
			const _config = await this.configManager.fetchConfig();
			if (!this.configManager.isActive()) {
				throw new Error('WebRTC widget is not active in the configuration');
			}

			// Get SIP credentials
			const sipCredentials = this.configManager.getSipCredentials();

			// Initialize SIP manager
			this.sipManager.initialize(
				{
					fullUsername: sipCredentials.fullUsername,
					password: sipCredentials.password,
					username: sipCredentials.username,
					organisationId: sipCredentials.organisationId,
					projectId: sipCredentials.projectId,
					endpointId: sipCredentials.endpointId,
				},
				{
					wsUri: sipCredentials.wsUri,
					pcConfig: this.configManager.getPeerConnectionConfig(),
				}
			);

			// Start SIP connection
			this.sipManager.start();

			// Wait for connection with timeout
			await withTimeout(
				new Promise<void>((resolve, reject) => {
					let connected = false;
					let registered = false;

					const onConnected = () => {
						connected = true;
						if (registered) {
							this.sipManager.off(COGNIGY_WEBRTC_EVENTS.CONNECTED, onConnected);
							this.sipManager.off(COGNIGY_WEBRTC_EVENTS.REGISTERED, onRegistered);
							this.sipManager.off(COGNIGY_WEBRTC_EVENTS.ERROR, onError);
							this.isInitialized = true;
							resolve();
						}
					};

					const onRegistered = () => {
						registered = true;
						if (connected) {
							this.sipManager.off(COGNIGY_WEBRTC_EVENTS.CONNECTED, onConnected);
							this.sipManager.off(COGNIGY_WEBRTC_EVENTS.REGISTERED, onRegistered);
							this.sipManager.off(COGNIGY_WEBRTC_EVENTS.ERROR, onError);
							this.isInitialized = true;
							resolve();
						}
					};

					const onError = (error: Error) => {
						this.sipManager.off(COGNIGY_WEBRTC_EVENTS.CONNECTED, onConnected);
						this.sipManager.off(COGNIGY_WEBRTC_EVENTS.REGISTERED, onRegistered);
						this.sipManager.off(COGNIGY_WEBRTC_EVENTS.ERROR, onError);
						reject(error);
					};

					this.sipManager.on(COGNIGY_WEBRTC_EVENTS.CONNECTED, onConnected);
					this.sipManager.on(COGNIGY_WEBRTC_EVENTS.REGISTERED, onRegistered);
					this.sipManager.on(COGNIGY_WEBRTC_EVENTS.ERROR, onError);
				}),
				15000 // 15 second timeout
			);

		} catch (error) {
			throw new Error(`Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Disconnect from the SIP server
	 */
	async disconnect(): Promise<void> {
		if (!this.isInitialized) {
			return;
		}

		try {
			// Stop audio
			this.audioManager.stopAudio();

			// Terminate any active sessions
			this.sessionManager.destroy();

			// Stop SIP connection
			this.sipManager.stop();

			this.isInitialized = false;
		} catch (error) {
			console.error('Error during disconnect:', error);
			throw new Error(`Failed to disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Start a call
	 */
	async startCall(): Promise<void> {
		if (!this.isInitialized) {
			throw new Error('Client not connected. Call connect() first.');
		}

		if (!this.sipManager.isRegistered()) {
			throw new Error('SIP client not registered');
		}

		try {
			this.sipManager.call(this.configManager.getCallTarget());

		} catch (error) {
			throw new Error(`Failed to start call: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * End the current call
	 */
	async endCall(): Promise<void> {
		try {
			this.sessionManager.terminate();
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

	async connectAndCall(): Promise<void> {
		await this.connect();
		await this.startCall();
	}

	/**
	 * Send DTMF tones
	 */
	// async sendDTMF(tones: string | number): Promise<void> {
	// 	try {
	// 		this.sessionManager.sendDTMF(tones);
	// 	} catch (error) {
	// 		throw new Error(`Failed to send DTMF: ${error instanceof Error ? error.message : 'Unknown error'}`);
	// 	}
	// }

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
		return this.isInitialized && this.sipManager.isRegistered();
	}

	/**
	 * Get current active session
	 */
	getCurrentSession(): CallSession | null {
		return this.sessionManager.getActiveSession();
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
