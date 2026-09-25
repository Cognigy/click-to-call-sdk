/**
 * Event emitter utilities for the WebRTC SDK
 */

import { EventEmitter as NodeEventEmitter } from 'events';
import type { EventEmitter } from '../types/internal.js';

/**
 * Custom event emitter that extends Node.js EventEmitter
 * Provides type-safe event handling for the SDK
 */
export class SDKEventEmitter extends NodeEventEmitter implements EventEmitter {
	constructor() {
		super();
		// Set max listeners to avoid memory leak warnings
		this.setMaxListeners(50);
	}

	/**
	 * Add an event listener
	 */
	on(event: string, listener: (...args: any[]) => void): this {
		super.on(event, listener);
		return this;
	}

	/**
	 * Remove an event listener
	 */
	off(event: string, listener: (...args: any[]) => void): this {
		super.off(event, listener);
		return this;
	}

	/**
	 * Emit an event
	 */
	emit(event: string, ...args: any[]): boolean {
		return super.emit(event, ...args);
	}

	/**
	 * Remove all listeners for an event or all events
	 */
	removeAllListeners(event?: string): this {
		return super.removeAllListeners(event);
	}

	/**
	 * Add a one-time event listener
	 */
	once(event: string, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	/**
	 * Get the number of listeners for an event
	 */
	listenerCount(event: string): number {
		return super.listenerCount(event);
	}

	/**
	 * Get all listeners for an event
	 */
	listeners(event: string): ((...args: any[]) => void)[] {
		return super.listeners(event) as ((...args: any[]) => void)[];
	}
}


/**
 * Event names used throughout the SDK
 */
export const COGNIGY_WEBRTC_EVENTS = {
	// Connection events
	CONNECTING: 'connecting',
	CONNECTED: 'connected',
	DISCONNECTED: 'disconnected',
	REGISTERED: 'registered',
	UNREGISTERED: 'unregistered',

	// Call events
	RINGING: 'ringing',
	ANSWERED: 'answered',
	ENDED: 'ended',
	FAILED: 'failed',

	// Audio events
	MUTED: 'muted',
	UNMUTED: 'unmuted',
	AUDIO_ENDED: 'audioEnded',

	// Communication events
	INFO_SENT: 'infoSent',
	DTMF_SENT: 'dtmfSent',

	// Error events
	ERROR: 'error',

	// Internal events
	SESSION_CREATED: 'sessionCreated',
	SESSION_UPDATED: 'sessionUpdated',
	SESSION_DESTROYED: 'sessionDestroyed',

	INFO_RECEIVED: 'infoReceived',
	TRANSCRIPTION: 'transcription',
	CAPTURE_AUDIO: 'captureAudio',
} as const;

export type SDKEventName = typeof COGNIGY_WEBRTC_EVENTS[keyof typeof COGNIGY_WEBRTC_EVENTS];
