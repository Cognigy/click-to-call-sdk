/**
 * SIP connection management for the WebRTC SDK
 * Adapted from the original SipClient class
 */

import { WebSocketInterface, UA } from 'jssip';
import type { UA as IUA } from 'jssip';
import { SDKEventEmitter, COGNIGY_WEBRTC_EVENTS } from './utils/events.js';
import type {
	InternalClientConfig,
	InternalClientSettings,
	ExtendedRTCSession,
	SipManagerState
} from './types/internal.js';
import { randomId } from './utils/helpers.js';
import type { DisconnectedInfo, RegistrationFailedInfo } from './types/index.js';

export class SipManager extends SDKEventEmitter {
	private ua: IUA | null = null;
	private pcConfig?: RTCConfiguration;
	private identityHeaders: string[] = [];
	private requiresRegistration = true;
	private state: SipManagerState = {
		ua: null,
		connected: false,
		registered: false,
		connecting: false,
	};

	/**
	 * Initialize the SIP user agent
	 */
	initialize(client: InternalClientConfig, settings: InternalClientSettings): void {
		if (this.ua) {
			this.stop();
		}

		this.pcConfig = settings.pcConfig;
		this.identityHeaders =
			client.organisationId && client.projectId
				? [
						`X-Organisation-Id: ${client.organisationId}`,
						`X-Project-Id: ${client.projectId}`,
						...(client.endpointId ? [`X-Endpoint-Id: ${client.endpointId}`] : []),
					]
				: [];

		console.log('Creating SIP client with config:', { client, settings }, settings.pcConfig);

		const socket = new WebSocketInterface(settings.wsUri);

		// Runtime endpoints have no realm or credentials; the SBC admits them by the
		// declared identity headers only, and nothing needs to reach this UA, so skip
		// REGISTER. The host just has to parse — the resolver ignores it.
		this.requiresRegistration = !(client.organisationId && client.projectId && client.endpointId);
		const uaConfig = this.requiresRegistration
			? {
					uri: `sip:${client.fullUsername}`,
					password: client.password,
					authorization_user: client.username,
					sockets: [socket],
					register: true,
				}
			: {
					uri: `sip:${client.userId || 'anonymous'}@${new URL(settings.wsUri).hostname}`,
					sockets: [socket],
					register: false,
				};

		this.ua = new UA(uaConfig);
		this.state.ua = this.ua;

		this.setupEventHandlers();
	}

	/**
	 * Set up event handlers for the UA
	 */
	private setupEventHandlers(): void {
		const ua = this.ua;
		if (!ua) return;
		// A stopped UA keeps emitting (e.g. disconnected once its socket closes).
		// Still forward those until a newer UA exists, but never let them touch
		// state: it belongs to the current UA (or was reset by stop()).
		const on = (event: string, handler: (data: any, current: boolean) => void) => {
			ua.on(event as any, (data: any) => {
				const current = this.ua === ua;
				if (current || this.ua === null) {
					handler(data, current);
				}
			});
		};

		on('connecting', (_data: any, current) => {
			console.log('SIP connecting');
			if (current) this.state.connecting = true;
			this.emit(COGNIGY_WEBRTC_EVENTS.CONNECTING);
		});

		on('connected', (data: any, current) => {
			console.log('SIP connected:', data);
			if (current) {
				this.state.connected = true;
				this.state.connecting = false;
			}
			this.emit(COGNIGY_WEBRTC_EVENTS.CONNECTED, data);
		});

		on('disconnected', (data: any, current) => {
			console.log('SIP disconnected:', data);
			if (current) {
				this.state.connected = false;
				this.state.registered = false;
				this.state.connecting = false;
			}
			// Forward only code and reason, not the JsSIP socket
			const info: DisconnectedInfo = { code: data?.code, reason: data?.reason };
			this.emit(COGNIGY_WEBRTC_EVENTS.DISCONNECTED, info);
		});

		// Registration events
		on('registered', (data: any, current) => {
			console.log('SIP registered:', data);
			if (current) this.state.registered = true;
			this.emit(COGNIGY_WEBRTC_EVENTS.REGISTERED, data);
		});

		on('unregistered', (data: any, current) => {
			console.log('SIP unregistered:', data);
			if (current) this.state.registered = false;
			this.emit(COGNIGY_WEBRTC_EVENTS.UNREGISTERED, data);
		});

		// New RTC session events
		on('newRTCSession', (data: any) => {
			const rtcSession = data.session as ExtendedRTCSession;

			this.handleNewSession(rtcSession);
			this.emit('newRTCSession', rtcSession);
		});

		// Registration failure
		on('registrationFailed', (data: any) => {
			console.error('SIP registration failed:', data);
			// Map instead of forwarding the JsSIP response, which carries the whole message
			const info: RegistrationFailedInfo = { cause: data.cause };
			if (data.response) {
				info.response = {
					status_code: data.response.status_code,
					reason_phrase: data.response.reason_phrase,
				};
			}
			this.emit(COGNIGY_WEBRTC_EVENTS.REGISTRATION_FAILED, info);
			this.emit(COGNIGY_WEBRTC_EVENTS.ERROR, new Error(`Registration failed: ${data.cause}`));
		});
	}

	/**
	 * Handle new RTC session
	 */
	private handleNewSession(rtcSession: ExtendedRTCSession): void {
		// Add session ID if not present
		if (!rtcSession.data) {
			rtcSession.data = {};
		}

		if (!rtcSession.data.sessionId) {
			rtcSession.data.sessionId = randomId('session');
		}

		// Override the sendInfo method with our custom implementation
		const originalSendInfo = rtcSession.sendInfo;
		rtcSession.sendInfo = (text: string, data: Record<string, any>) => {
			try {
				// Call the original JsSIP sendInfo method with proper parameters
				(originalSendInfo as any).call(rtcSession, 'application/json', JSON.stringify({ text, data }));
				this.emit(COGNIGY_WEBRTC_EVENTS.INFO_SENT, text, data);
			} catch (error) {
				console.error('Failed to send info:', error);
				this.emit(COGNIGY_WEBRTC_EVENTS.ERROR, new Error(`Failed to send info: ${error}`));
			}
		};

		this.emit(COGNIGY_WEBRTC_EVENTS.SESSION_CREATED, rtcSession);
	}

	/**
	 * Start the SIP user agent
	 */
	start(): void {
		if (!this.ua) {
			throw new Error('SIP manager not initialized');
		}

		console.log('Starting SIP user agent');
		this.state.connecting = true;
		this.ua.start();
	}

	/**
	 * Stop the SIP user agent
	 */
	stop(): void {
		const ua = this.ua;
		if (ua) {
			console.log('Stopping SIP user agent');
			// Detach first so events emitted while stopping are ignored
			this.ua = null;
			this.state = {
				ua: null,
				connected: false,
				registered: false,
				connecting: false,
			};
			ua.stop();
		}
	}

	/**
	 * Make a call to the specified number
	 */
	call(number: string, originalNumber?: string): void {
		if (!this.ua) {
			throw new Error('SIP manager not initialized');
		}

		if (this.requiresRegistration && !this.state.registered) {
			throw new Error('SIP client not registered');
		}

		console.log(`Making call to: ${number}`);

		try {
			this.ua.call(number, {
				// @ts-expect-error - JsSIP typings are incorrect
				data: {
					originalNumber: originalNumber || number,
					sessionId: randomId('call'),
				},
				mediaConstraints: { audio: true, video: false },
				pcConfig: this.pcConfig,
				extraHeaders: ['X-Source: webrtc', ...this.identityHeaders],
			});
		} catch (error) {
			console.error('Failed to make call:', error);
			this.emit(COGNIGY_WEBRTC_EVENTS.ERROR, new Error(`Failed to make call: ${error}`));
			throw error;
		}
	}

	/**
	 * Get the current state
	 */
	getState(): SipManagerState {
		return { ...this.state };
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.state.connected;
	}

	/**
	 * Whether calls need a prior REGISTER (false for runtime endpoints)
	 */
	needsRegistration(): boolean {
		return this.requiresRegistration;
	}

	/**
	 * Check if registered
	 */
	isRegistered(): boolean {
		return this.state.registered;
	}

	/**
	 * Check if connecting
	 */
	isConnecting(): boolean {
		return this.state.connecting;
	}

	/**
	 * Get the user agent instance (for advanced usage)
	 */
	getUserAgent(): IUA | null {
		return this.ua;
	}

	/**
	 * Clean up resources
	 */
	destroy(): void {
		this.stop();
		this.removeAllListeners();
	}
}
