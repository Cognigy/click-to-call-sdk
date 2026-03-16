/**
 * WebRTC SDK - Main entry point
 * 
 * A standalone WebRTC SDK for SIP-based voice calling with custom audio support
 */

import { WebRTCClient } from './WebRTCClient.js';
import { isWebRTCSupported } from './utils/helpers.js';
import type { WebRTCClientConfig } from './types/index.js';

// Export types
export type {
	WebRTCClient as IWebRTCClient,
	WebRTCClientConfig,
	CreateWebRTCClientOptions,
	CreateWebRTCClient,
	EndpointConfig,
	SipConnectivityInfo,
	CallSession,
	CallEndInfo,
	SessionStatus,
	EventName,
	EventCallback,
	WebRTCClientEvents,
} from './types/index.js';

// Export main client class
export { WebRTCClient };

// Export utility functions
export { isWebRTCSupported };

/**
 * Create a new WebRTC client instance
 * 
 * @param config - Configuration for the WebRTC client
 * @returns Promise that resolves to a WebRTC client instance
 * 
 * @example
 * ```typescript
 * import { createWebRTCClient } from '@cognigy/webrtc-sdk';
 * 
 * const client = await createWebRTCClient({
 *   endpointUrl: 'https://api.example.com/webrtc-config',
 *   token: 'your-auth-token',
 *   userId: 'user-123',
 * });
 * 
 * // Set up event listeners
 * client.on('ringing', (session) => {
 *   console.log('Call is ringing:', session);
 * });
 * 
 * client.on('answered', (session) => {
 *   console.log('Call answered:', session);
 * });
 * 
 * 
 * // Connect and start a call
 * await client.connect();
 * await client.startCall();
 * ```
 */
export async function createWebRTCClient(config: WebRTCClientConfig): Promise<WebRTCClient> {
	// Validate configuration
	if (!config.endpointUrl) {
		throw new Error('endpointUrl is required');
	}

	// Check WebRTC support
	if (!isWebRTCSupported()) {
		throw new Error('WebRTC is not supported in this environment');
	}

	// Create and return client instance
	const client = new WebRTCClient(config);

	return client;
}

/**
 * SDK version
 */
export const VERSION = '1.0.0';

/**
 * SDK name
 */
export const SDK_NAME = '@cognigy/webrtc-sdk';

/**
 * Check if the current environment supports WebRTC
 * 
 * @returns true if WebRTC is supported, false otherwise
 */
export function checkWebRTCSupport(): {
	supported: boolean;
	missing: string[];
} {
	const missing: string[] = [];

	if (typeof window === 'undefined') {
		missing.push('window');
	} else {
		if (!window.RTCPeerConnection) {
			missing.push('RTCPeerConnection');
		}

		if (!window.navigator) {
			missing.push('navigator');
		} else {
			if (!window.navigator.mediaDevices) {
				missing.push('navigator.mediaDevices');
			} else if (!window.navigator.mediaDevices.getUserMedia) {
				missing.push('navigator.mediaDevices.getUserMedia');
			}
		}
	}

	return {
		supported: missing.length === 0,
		missing,
	};
}

