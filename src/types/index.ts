/**
 * Public API types for the WebRTC SDK
 */

import type { ExtendedRTCSession } from './internal.js';

export type { ExtendedRTCSession } from './internal.js';

// Configuration types
export interface EndpointConfig {
	organisationId: string;
	projectId: string;
	endpointSettings: {
		snapshotId: string | null;
		endpointUrlToken: string;
		endpointName: string;
		channel: string;
		localeReferenceId: string;
		collectAnalytics: boolean;
		active: boolean;
		version?: string;
		sipConnectivityInfo: SipConnectivityInfo;
		webrtcWidgetConfig: WebrtcWidgetConfig;
		/** Absent from older endpoint configs. */
		endpointId?: string;
	};
	settings?: {
		transcription?: { enabled?: boolean };
		privacyNotice?: {
			enabled: boolean;
			text: string;
			cancelButtonText: string;
			submitButtonText: string;
			urlText: string;
			url: string;
		};
	};
}

export interface WebrtcWidgetConfig {
	active: boolean;
	label?: string;
	tagline?: string;
	theme?: string;
	avatarLogoUrl?: string;
	transcription?: {
		enabled?: boolean;
		backgroundMode?: 'transparent' | 'custom';
		backgroundColor?: string;
	};
	basePanelBackgroundColor?: string;
	demoPage?: {
		background?: {
			color?: string;
			mode?: 'color' | 'imageUrl';
			imageUrl?: string;
		};
		position?: 'centered' | 'bottomRight';
	};
}

export interface SipConnectivityInfo {
	userId?: string;
	username: string;
	applicationSid: string;
	password: string;
	wsUri: string;
	realm: string;
	clientSid?: string;
}

export interface WebRTCClientConfig {
	endpointUrl: string;
	userId?: string;
	pcConfig?: RTCConfiguration;
	captureAudio?: boolean;
	/**
	 * Fail the call if no SIP session exists this long after connect()
	 * (or startCall() on a connected client). Unset or 0: no timer.
	 */
	callSetupTimeoutMs?: number;
	/** Stop the SIP UA once a call ends or fails; the next connect() starts a new one. Default false. */
	disconnectAfterCall?: boolean;
}

/** `endInfo.cause` values the SDK sets itself, next to JsSIP's causes. */
export const SDK_END_CAUSES = {
	CONFIG_FETCH_FAILED: "CONFIG_FETCH_FAILED",
	CONFIG_INVALID: "CONFIG_INVALID",
	WIDGET_INACTIVE: "WIDGET_INACTIVE",
	REGISTRATION_FAILED: "REGISTRATION_FAILED",
	SETUP_TIMEOUT: "SETUP_TIMEOUT",
} as const;

export type SdkEndCause = (typeof SDK_END_CAUSES)[keyof typeof SDK_END_CAUSES];

// Event types
export interface CallSession {
	id: string;
	status: SessionStatus;
	direction: 'incoming' | 'outgoing';
	startTime: Date;
	answerTime?: Date;
	duration: number;
	muted: boolean;
	localHold: boolean;
	remoteHold: boolean;
}

export type CallStatus = 'idle' | 'connecting' | 'ringing' | 'answered' | 'ended' | 'failed';

export interface TranscriptMessage {
	id: string;
	text: string;
	originator: 'bot' | 'user';
	timestamp: number;
}

/** Immutable snapshot; every change produces a new object. */
export interface ClientState {
	status: CallStatus;
	muted: boolean;
	session: CallSession | null;
	endInfo: CallEndInfo | null;
	transcript: TranscriptMessage[];
	remoteStream: MediaStream | null;
	localStream: MediaStream | null;
}

export type SessionStatus = 'init' | 'ringing' | 'answered' | 'failed' | 'ended';

export interface CallEndInfo {
	originator: 'local' | 'remote' | null;
	cause: string | null;
	description?: string | null;
}

export interface SendDTMFOptions {
	/** Tone duration in ms. JsSIP enforces its own default and minimum. */
	duration?: number;
	/** Gap between tones in ms. */
	interToneGap?: number;
	/** Defaults to `'INFO'` (SIP INFO), which is what Voice Gateway expects. */
	transportType?: 'INFO' | 'RFC2833';
}

/** Detail of a failed SIP registration; `response` is absent for transport-level failures. */
export interface RegistrationFailedInfo {
	cause: string;
	response?: { status_code: number; reason_phrase: string };
}

/** Detail of a lost SIP transport connection (WebSocket close code and reason). */
export interface DisconnectedInfo {
	code?: number;
	reason?: string;
}

// Event callback types
export interface WebRTCClientEvents {
	'connecting': () => void;
	'connected': () => void;
	'disconnected': (info: DisconnectedInfo) => void;
	'registered': () => void;
	'unregistered': () => void;
	'registrationFailed': (info: RegistrationFailedInfo) => void;
	'sessionCreated': (session: CallSession) => void;
	'ringing': (session: CallSession) => void;
	'answered': (session: CallSession) => void;
	'ended': (session: CallSession, endInfo: CallEndInfo) => void;
	'failed': (session: CallSession, endInfo: CallEndInfo) => void;
	'muted': (session: CallSession) => void;
	'unmuted': (session: CallSession) => void;
	'audioEnded': () => void;
	'infoSent': (text: string, data: Record<string, any>) => void;
	'dtmfSent': (tones: string) => void;
	'infoReceived': (data: { originator: string; info: any }) => void;
	'error': (error: Error) => void;
	'captureAudio': (stream: MediaStream) => void;
	'transcription': (data: any) => void;
	'stateChanged': (state: ClientState) => void;
}

export type EventName = keyof WebRTCClientEvents;
export type EventCallback<T extends EventName> = WebRTCClientEvents[T];

// Main client interface
export interface WebRTCClient {
	// Core call methods
	startCall(): Promise<void>;
	endCall(): Promise<void>;

	// Audio control
	mute(): Promise<void>;
	unmute(): Promise<void>;

	// Communication methods
	sendDTMF(tones: string | number, options?: SendDTMFOptions): Promise<void>;
	sendInfo(text: string, data?: Record<string, any>): Promise<void>;

	// Event handling
	on<T extends EventName>(event: T, callback: EventCallback<T>): this;
	off<T extends EventName>(event: T, callback: EventCallback<T>): this;

	// Config
	/** Fetch the endpoint config once and cache it; concurrent calls share one request. */
	loadConfig(): Promise<EndpointConfig>;
	getConfig(): EndpointConfig | null;
	/** Override the SIP user id. Throws once connect() has started. */
	setUserId(id: string): void;

	// State getters
	isConnected(): boolean;
	getCurrentSession(): CallSession | null;
	/** Current immutable state snapshot. */
	getState(): ClientState;
	/** Listen for state changes (does not fire immediately). Returns an unsubscribe function. */
	subscribe(listener: (state: ClientState) => void): () => void;
	/** Advanced/unstable: underlying JsSIP session. */
	getRawSession(): ExtendedRTCSession | null;

	// Lifecycle
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	destroy(): Promise<void>;

	//extended methods
	connectAndCall(): Promise<void>;
}

// Factory function type
export interface CreateWebRTCClientOptions extends WebRTCClientConfig { }

export type CreateWebRTCClient = (config: CreateWebRTCClientOptions) => Promise<WebRTCClient>;
