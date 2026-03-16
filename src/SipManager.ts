/**
 * SIP connection management for the WebRTC SDK
 * Adapted from the original SipClient class
 */

import { WebSocketInterface, UA } from 'jssip';
import type { UA as IUA } from 'jssip';
import type { UAEventMap } from 'jssip/lib/UA';
import { SDKEventEmitter, COGNIGY_WEBRTC_EVENTS } from './utils/events.js';
import type {
	InternalClientConfig,
	InternalClientSettings,
	ExtendedRTCSession,
	SipManagerState
} from './types/internal.js';
import { randomId } from './utils/helpers.js';

export class SipManager extends SDKEventEmitter {
	private ua: IUA | null = null;
	private pcConfig?: RTCConfiguration;
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

		console.log('Creating SIP client with config:', { client, settings }, settings.pcConfig);

		const socket = new WebSocketInterface(settings.wsUri);
		const uri = `sip:${client.fullUsername}`;

		const uaConfig = {
			uri,
			password: client.password,
			authorization_user: client.username,
			sockets: [socket],
			register: true,
		};

		this.ua = new UA(uaConfig);
		this.state.ua = this.ua;

		this.setupEventHandlers();
	}

	/**
	 * Set up event handlers for the UA
	 */
	private setupEventHandlers(): void {
		if (!this.ua) return;

		// Connection events
		(['connecting', 'connected', 'disconnected'] as const).forEach((eventName) => {
			this.ua?.on(eventName as keyof UAEventMap, (data: any) => {
				console.log(`SIP ${eventName}:`, data);

				// Update state
				if (eventName === 'connected') {
					this.state.connected = true;
					this.state.connecting = false;
				} else if (eventName === 'disconnected') {
					this.state.connected = false;
					this.state.registered = false;
					this.state.connecting = false;
				} else if (eventName === 'connecting') {
					this.state.connecting = true;
				}

				// Emit SDK event
				this.emit(COGNIGY_WEBRTC_EVENTS[eventName.toUpperCase() as keyof typeof COGNIGY_WEBRTC_EVENTS], data);
			});
		});

		// Registration events
		this.ua.on('registered', (data: any) => {
			console.log('SIP registered:', data);
			this.state.registered = true;
			this.emit(COGNIGY_WEBRTC_EVENTS.REGISTERED, data);
		});

		this.ua.on('unregistered', (data: any) => {
			console.log('SIP unregistered:', data);
			this.state.registered = false;
			this.emit(COGNIGY_WEBRTC_EVENTS.UNREGISTERED, data);
		});

		// New RTC session events
		this.ua.on('newRTCSession', (data: any) => {
			const rtcSession = data.session as ExtendedRTCSession;

			this.handleNewSession(rtcSession);
			this.emit('newRTCSession', rtcSession);
		});

		// Registration failure
		this.ua.on('registrationFailed', (data: any) => {
			console.error('SIP registration failed:', data);
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
		if (this.ua) {
			console.log('Stopping SIP user agent');
			this.ua.stop();
			this.ua = null;
			this.state = {
				ua: null,
				connected: false,
				registered: false,
				connecting: false,
			};
		}
	}

	/**
	 * Make a call to the specified number
	 */
	call(number: string, originalNumber?: string): void {
		if (!this.ua) {
			throw new Error('SIP manager not initialized');
		}

		if (!this.state.registered) {
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
				extraHeaders: ['X-Source: webrtc'],
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
