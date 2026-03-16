/**
 * Unit tests for utility helper functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	randomId,
	isValidSipUri,
	isValidWsUri,
	delay,
	safeJsonParse,
	isBrowser,
	isWebRTCSupported,
	validateEndpointConfig,
	getNestedProperty,
	debounce,
	withTimeout,
	formatDuration,
} from '../../../utils/helpers.js';
import { mockEndpointConfig, mockInvalidEndpointConfig } from '../../mocks/fixtures.js';

describe('Helper Functions', () => {
	describe('randomId', () => {
		it('should generate a random ID with default length', () => {
			const id = randomId();
			expect(id).toHaveLength(8);
			expect(id).toMatch(/^[A-Za-z0-9]{8}$/);
		});

		it('should generate a random ID with prefix', () => {
			const id = randomId('test');
			expect(id).toMatch(/^test-[A-Za-z0-9]{8}$/);
		});

		it('should generate unique IDs', () => {
			const id1 = randomId();
			const id2 = randomId();
			expect(id1).not.toBe(id2);
		});
	});

	describe('isValidSipUri', () => {
		it('should validate correct SIP URIs', () => {
			expect(isValidSipUri('sip:user@example.com')).toBe(true);
			expect(isValidSipUri('sip:test.user@sub.domain.com')).toBe(true);
			expect(isValidSipUri('sip:user123@example.org')).toBe(true);
		});

		it('should reject invalid SIP URIs', () => {
			expect(isValidSipUri('http://example.com')).toBe(false);
			expect(isValidSipUri('sip:user')).toBe(false);
			expect(isValidSipUri('user@example.com')).toBe(false);
			expect(isValidSipUri('sip:@example.com')).toBe(false);
			expect(isValidSipUri('')).toBe(false);
		});
	});

	describe('isValidWsUri', () => {
		it('should validate correct WebSocket URIs', () => {
			expect(isValidWsUri('ws://example.com:8080')).toBe(true);
			expect(isValidWsUri('wss://secure.example.com:8443')).toBe(true);
			expect(isValidWsUri('ws://localhost:3000')).toBe(true);
		});

		it('should reject invalid WebSocket URIs', () => {
			expect(isValidWsUri('http://example.com')).toBe(false);
			expect(isValidWsUri('ws://example.com')).toBe(false); // No port
			expect(isValidWsUri('wss://example.com:abc')).toBe(false); // Invalid port
			expect(isValidWsUri('')).toBe(false);
		});
	});

	describe('delay', () => {
		it('should resolve after specified time', async () => {
			const start = Date.now();
			await delay(100);
			const elapsed = Date.now() - start;
			expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some variance
		});
	});

	describe('safeJsonParse', () => {
		it('should parse valid JSON', () => {
			const obj = { test: 'value' };
			const result = safeJsonParse(JSON.stringify(obj), {});
			expect(result).toEqual(obj);
		});

		it('should return fallback for invalid JSON', () => {
			const fallback = { default: true };
			const result = safeJsonParse('invalid json', fallback);
			expect(result).toBe(fallback);
		});

		it('should return fallback for empty string', () => {
			const fallback = { default: true };
			const result = safeJsonParse('', fallback);
			expect(result).toBe(fallback);
		});
	});

	describe('isBrowser', () => {
		it('should return true in jsdom environment', () => {
			expect(isBrowser()).toBe(true);
		});
	});

	describe('isWebRTCSupported', () => {
		it('should return true when WebRTC APIs are available', () => {
			expect(isWebRTCSupported()).toBe(true);
		});

		it('should return false when RTCPeerConnection is not available', () => {
			const originalRTC = window.RTCPeerConnection;
			// @ts-expect-error
			window.RTCPeerConnection = undefined;

			expect(isWebRTCSupported()).toBe(false);

			window.RTCPeerConnection = originalRTC;
		});
	});

	describe('validateEndpointConfig', () => {
		it('should validate correct endpoint configuration', () => {
			expect(validateEndpointConfig(mockEndpointConfig)).toBe(true);
		});

		it('should reject invalid endpoint configuration', () => {
			expect(validateEndpointConfig(mockInvalidEndpointConfig)).toBe(false);
			expect(validateEndpointConfig(null)).toBe(false);
			expect(validateEndpointConfig(undefined)).toBe(false);
			expect(validateEndpointConfig({})).toBe(false);
		});

		it('should reject configuration with missing nested properties', () => {
			const invalidConfig = {
				...mockEndpointConfig,
				endpointSettings: {
					...mockEndpointConfig.endpointSettings,
					sipConnectivityInfo: {
						...mockEndpointConfig.endpointSettings.sipConnectivityInfo,
						username: '', // Empty required field
					},
				},
			};
			expect(validateEndpointConfig(invalidConfig)).toBe(false);
		});
	});

	describe('getNestedProperty', () => {
		const testObj = {
			level1: {
				level2: {
					level3: 'value',
				},
				array: [1, 2, 3],
			},
		};

		it('should get nested property value', () => {
			expect(getNestedProperty(testObj, 'level1.level2.level3')).toBe('value');
			expect(getNestedProperty(testObj, 'level1.array')).toEqual([1, 2, 3]);
		});

		it('should return undefined for non-existent properties', () => {
			expect(getNestedProperty(testObj, 'level1.nonexistent')).toBeUndefined();
			expect(getNestedProperty(testObj, 'nonexistent.level2')).toBeUndefined();
		});

		it('should handle null/undefined objects', () => {
			expect(getNestedProperty(null, 'test')).toBeUndefined();
			expect(getNestedProperty(undefined, 'test')).toBeUndefined();
		});
	});

	describe('debounce', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should debounce function calls', () => {
			const fn = vi.fn();
			const debouncedFn = debounce(fn, 100);

			debouncedFn('arg1');
			debouncedFn('arg2');
			debouncedFn('arg3');

			expect(fn).not.toHaveBeenCalled();

			vi.advanceTimersByTime(100);

			expect(fn).toHaveBeenCalledTimes(1);
			expect(fn).toHaveBeenCalledWith('arg3');
		});
	});


	describe('withTimeout', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should resolve with promise result when promise resolves first', async () => {
			const promise = Promise.resolve('success');
			const result = withTimeout(promise, 1000);

			await expect(result).resolves.toBe('success');
		});

		it('should reject with timeout error when timeout occurs first', async () => {
			const promise = new Promise(() => { }); // Never resolves
			const result = withTimeout(promise, 100);

			vi.advanceTimersByTime(100);

			await expect(result).rejects.toThrow('Operation timed out after 100ms');
		});
	});

	describe('formatDuration', () => {
		it('should format seconds correctly', () => {
			expect(formatDuration(30)).toBe('0:30');
			expect(formatDuration(90)).toBe('1:30');
			expect(formatDuration(3661)).toBe('1:01:01');
		});

		it('should handle zero duration', () => {
			expect(formatDuration(0)).toBe('0:00');
		});

		it('should pad single digits', () => {
			expect(formatDuration(5)).toBe('0:05');
			expect(formatDuration(65)).toBe('1:05');
		});
	});
});
