/**
 * Public API types for the WebRTC SDK
 */

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
		webrtcWidgetConfig: {
			active: boolean;
			label?: string;
		};
	};
	settings?: {
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
}

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

export type SessionStatus = 'init' | 'ringing' | 'answered' | 'failed' | 'ended';

export interface CallEndInfo {
	originator: 'local' | 'remote' | null;
	cause: string | null;
	description?: string | null;
}

// Event callback types
export interface WebRTCClientEvents {
	'connecting': () => void;
	'connected': () => void;
	'disconnected': () => void;
	'registered': () => void;
	'unregistered': () => void;
	'ringing': (session: CallSession) => void;
	'answered': (session: CallSession) => void;
	'ended': (session: CallSession, endInfo: CallEndInfo) => void;
	'failed': (session: CallSession, endInfo: CallEndInfo) => void;
	'muted': (session: CallSession) => void;
	'unmuted': (session: CallSession) => void;
	'audioEnded': () => void;
	'infoSent': (text: string, data: Record<string, any>) => void;
	'infoReceived': (data: { originator: string; info: any }) => void;
	'error': (error: Error) => void;
	'captureAudio': (stream: MediaStream) => void;
	'transcription': (data: any) => void;
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
	// sendDTMF(tones: string | number): Promise<void>; //DTMF is not supported in the SDK
	sendInfo(text: string, data?: Record<string, any>): Promise<void>;

	// Event handling
	on<T extends EventName>(event: T, callback: EventCallback<T>): this;
	off<T extends EventName>(event: T, callback: EventCallback<T>): this;

	// State getters
	isConnected(): boolean;
	getCurrentSession(): CallSession | null;

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
