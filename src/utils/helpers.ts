/**
 * Utility functions for the WebRTC SDK
 */

/**
 * Generate a random ID with optional prefix
 */
export function randomId(prefix?: string): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 8; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	if (prefix) {
		return `${prefix}-${result}`;
	}
	return result;
}

/**
 * Validate if a string is a valid SIP URI
 */
export function isValidSipUri(uri: string): boolean {
	const sipUriRegex = /^sip:[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
	return sipUriRegex.test(uri);
}

/**
 * Validate if a string is a valid WebSocket URI
 */
export function isValidWsUri(uri: string): boolean {
	const wsUriRegex = /^wss?:\/\/[a-zA-Z0-9.-]+:[0-9]+$/;
	return wsUriRegex.test(uri);
}

/**
 * Create a delay promise
 */
export function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely parse JSON string
 */
export function safeJsonParse<T>(jsonString: string, fallback: T): T {
	try {
		return JSON.parse(jsonString);
	} catch {
		return fallback;
	}
}

/**
 * Check if we're running in a browser environment
 */
export function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Check if WebRTC is supported
 */
export function isWebRTCSupported(): boolean {
	if (!isBrowser()) return false;

	return !!(
		window.RTCPeerConnection &&
		window.navigator &&
		window.navigator.mediaDevices &&
		window.navigator.mediaDevices.getUserMedia
	);
}

/**
 * Validate endpoint configuration
 */
export function validateEndpointConfig(config: any): boolean {
	if (!config || typeof config !== 'object') return false;

	const required = [
		'organisationId',
		'projectId',
		'endpointSettings',
		'endpointSettings.sipConnectivityInfo',
		'endpointSettings.sipConnectivityInfo.username',
		'endpointSettings.sipConnectivityInfo.password',
		'endpointSettings.sipConnectivityInfo.wsUri',
		'endpointSettings.sipConnectivityInfo.realm',
		'endpointSettings.sipConnectivityInfo.applicationSid'
	];

	return required.every(path => {
		const value = getNestedProperty(config, path);
		return value !== undefined && value !== null && value !== '';
	});
}

/**
 * Get nested property from object using dot notation
 */
export function getNestedProperty(obj: any, path: string): any {
	return path.split('.').reduce((current, key) => {
		return current && current[key] !== undefined ? current[key] : undefined;
	}, obj);
}

/**
 * Debounce function calls
 */
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let timeout: NodeJS.Timeout | null = null;

	return (...args: Parameters<T>) => {
		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(() => func(...args), wait);
	};
}


/**
 * Create a timeout promise that rejects after specified time
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
		)
	]);
}

/**
 * Format duration in seconds to human readable format
 */
export function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	}
	return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
