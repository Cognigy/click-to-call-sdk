/**
 * Internal types for the WebRTC SDK
 */

import type { RTCSession } from 'jssip/lib/RTCSession';
import type { UA } from 'jssip';
import type { CallEndInfo, SessionStatus } from './index.js';

// Extended RTCSession type with custom sendInfo method
export type ExtendedRTCSession = Omit<RTCSession, 'sendInfo'> & {
	_connection: RTCSession['connection'];
	sendInfo: (text: string, data: Record<string, any>) => void;
	data: {
		originalNumber?: string;
		replaces?: boolean;
		[key: string]: any;
	};
};

// Internal session options
export interface SessionOptions {
	pcConfig?: RTCConfiguration;
	onSession: (rtcSession: ExtendedRTCSession) => void;
}

// Internal client configuration
export interface InternalClientConfig {
	fullUsername: string;
	password: string;
	username: string;
}

// Internal client settings
export interface InternalClientSettings {
	wsUri: string;
	pcConfig?: RTCConfiguration;
}

// Session state interface
export interface SessionState {
	id: string;
	startTime: Date;
	status: SessionStatus;
	active: boolean;
	endInfo: CallEndInfo;
	muted: boolean;
	localHold: boolean;
	remoteHold: boolean;
	doingAttendedTransfer: boolean;
	autoMerge: boolean;
	rtcSession: ExtendedRTCSession;
}

// Audio manager state
export interface AudioState {
	remoteAudio: HTMLAudioElement | null;
	currentStream: MediaStream | null;
	captureAudio: boolean;
}

// SIP manager state
export interface SipManagerState {
	ua: UA | null;
	connected: boolean;
	registered: boolean;
	connecting: boolean;
}

// Event emitter interface
export interface EventEmitter {
	on(event: string, listener: (...args: any[]) => void): this;
	off(event: string, listener: (...args: any[]) => void): this;
	emit(event: string, ...args: any[]): void;
	removeAllListeners(event?: string): void;
}
