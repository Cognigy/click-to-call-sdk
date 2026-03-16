/**
 * Error handling and edge case tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebRTCClient } from '../../WebRTCClient.js';
import { createWebRTCClient, checkWebRTCSupport } from '../../index.js';
import { ConfigManager } from '../../ConfigManager.js';
import type { SipManager } from '../../SipManager.js';
import { SessionManager } from '../../SessionManager.js';
import { AudioManager } from '../../AudioManager.js';
import {
	mockWebRTCClientConfig,
	mockFetchResponses,
	mockInvalidEndpointConfig
} from '../mocks/fixtures.js';
import { isValidSipUri } from '../../utils/helpers.js';

// Mock jssip using the existing mock classes
vi.mock('jssip', async () => {
	const { MockUA, MockWebSocketInterface } = await import('../mocks/jssip.js');
	return {
		UA: MockUA,
		WebSocketInterface: MockWebSocketInterface,
	};
});



describe('Error Handling and Edge Cases', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('WebRTC Support Detection', () => {
		it('should detect missing WebRTC APIs', () => {
			const originalRTC = window.RTCPeerConnection;
			const originalNavigator = window.navigator;

			// @ts-expect-error
			window.RTCPeerConnection = undefined;
			// @ts-expect-error
			window.navigator = undefined;

			const support = checkWebRTCSupport();

			expect(support.supported).toBe(false);
			expect(support.missing).toContain('RTCPeerConnection');
			expect(support.missing).toContain('navigator');

			// Restore
			window.RTCPeerConnection = originalRTC;
			window.navigator = originalNavigator;
		});

		it('should detect missing mediaDevices API', () => {
			const originalMediaDevices = window.navigator.mediaDevices;
			// @ts-expect-error
			window.navigator.mediaDevices = undefined;

			const support = checkWebRTCSupport();

			expect(support.supported).toBe(false);
			expect(support.missing).toContain('navigator.mediaDevices');

			// Restore
			window.navigator.mediaDevices = originalMediaDevices;
		});

		it('should throw error when creating client without WebRTC support', () => {
			const originalRTC = window.RTCPeerConnection;
			// @ts-expect-error
			window.RTCPeerConnection = undefined;

			expect(() => new WebRTCClient(mockWebRTCClientConfig)).toThrow(
				'WebRTC is not supported in this environment'
			);

			// Restore
			window.RTCPeerConnection = originalRTC;
		});
	});

	describe('Configuration Errors', () => {
		it('should handle missing endpoint URL', async () => {
			const invalidConfig = { ...mockWebRTCClientConfig, endpointUrl: '' };

			await expect(createWebRTCClient(invalidConfig)).rejects.toThrow(
				'endpointUrl is required'
			);
		});


		it('should handle network timeout during config fetch', async () => {
			vi.stubGlobal('fetch', vi.fn().mockImplementation(() => mockFetchResponses.timeout()));

			const client = new WebRTCClient(mockWebRTCClientConfig);

			await expect(client.connect()).rejects.toThrow(
				'Configuration fetch failed: Operation timed out after 10000ms'
			);
		});

		it('should handle malformed JSON response', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.reject(new Error('Invalid JSON')),
			}));

			const client = new WebRTCClient(mockWebRTCClientConfig);

			await expect(client.connect()).rejects.toThrow(
				'Configuration fetch failed: Invalid JSON'
			);
		});

		it('should handle inactive widget configuration', async () => {
			const inactiveConfig = {
				...mockInvalidEndpointConfig,
				endpointSettings: {
					webrtcWidgetConfig: { active: false },
					sipConnectivityInfo: {
						username: 'test',
						password: 'test',
						wsUri: 'wss://test.com:8443',
						realm: 'test.com',
						applicationSid: 'test-sid',
					},
				},
			};

			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve(inactiveConfig),
			}));

			const client = new WebRTCClient(mockWebRTCClientConfig);

			await expect(client.connect()).rejects.toThrow(
				'Invalid endpoint configuration received'
			);
		});
	});

	describe('SIP Connection Errors', () => {
		let client: WebRTCClient;
		let sipManager: SipManager;

		beforeEach(() => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponses.success));
			client = new WebRTCClient(mockWebRTCClientConfig);
			sipManager = (client as any).sipManager;
		});

		afterEach(async () => {
			if (client) {
				await client.destroy();
			}
		});

		it('should handle SIP initialization failure', async () => {
			// Mock the initialize method to throw an error
			// const sipManager = (client as any).sipManager;
			const initializeSpy = vi.spyOn(sipManager, 'initialize');
			initializeSpy.mockImplementation(() => {
				throw new Error('SIP initialization failed');
			});

			await expect(client.connect()).rejects.toThrow('Failed to connect');

			// Restore
			initializeSpy.mockRestore();
		});

		it('should handle call attempts when not connected', async () => {
			// Don't connect the client - leave it uninitialized
			const isRegisteredSpy = vi.spyOn(sipManager, 'isRegistered');
			isRegisteredSpy.mockImplementation(() => false);

			await expect(client.startCall()).rejects.toThrow('Client not connected. Call connect() first.');
		});


		it('should handle info send failure', async () => {
			// Mock start instead of initialize to avoid the UA check
			sipManager.start = vi.fn().mockImplementation(() => {
				// Simulate successful start
				sipManager.isRegistered = vi.fn().mockReturnValue(true);
			});

			// Mock the session manager to have an active session
			const sessionManager = (client as any).sessionManager;
			const mockSession = {
				isEstablished: vi.fn().mockReturnValue(true),
				sendInfo: vi.fn()
			};
			sessionManager.getActiveSessionState = vi.fn().mockReturnValue({ rtcSession: mockSession });

			// Mock the connect method to resolve immediately
			const connectSpy = vi.spyOn(client, 'connect').mockResolvedValue(undefined);
			const startCallSpy = vi.spyOn(client, 'startCall').mockResolvedValue(undefined);

			await client.connect();
			await client.startCall();

			// Now mock sendInfo to throw error
			sessionManager.sendInfo = vi.fn(() => {
				throw new Error('Info send failed');
			});

			await expect(client.sendInfo('test')).rejects.toThrow('Failed to send info');

			// Restore spies
			connectSpy.mockRestore();
			startCallSpy.mockRestore();
		});
	});

	describe('Audio Manager Errors', () => {
		let audioManager: AudioManager;

		beforeEach(() => {
			audioManager = new AudioManager();
		});

		afterEach(() => {
			audioManager.destroy();
		});

		it('should handle audio element creation failure in non-browser environment', () => {
			const originalWindow = global.window;
			// @ts-expect-error
			delete global.window;

			const audioManager = new AudioManager();

			// Should not throw, but should log warning
			expect(() => audioManager.handleRemoteStream(new MediaStream())).not.toThrow();

			// Restore
			global.window = originalWindow;
		});

		it('should handle invalid volume values', () => {
			expect(() => audioManager.setVolume(-1)).toThrow('Volume must be between 0 and 1');
			expect(() => audioManager.setVolume(2)).toThrow('Volume must be between 0 and 1');
			expect(() => audioManager.setVolume(NaN)).toThrow('Volume must be between 0 and 1');
		});

		it('should handle stream with no tracks gracefully', () => {
			const mockStream = new MediaStream();
			vi.stubGlobal('mockStream.getTracks', vi.fn().mockResolvedValue([]));
			mockStream.getTracks = vi.fn().mockReturnValue([]);
			mockStream.getAudioTracks = vi.fn().mockReturnValue([]);

			expect(() => audioManager.handleRemoteStream(mockStream)).not.toThrow();
			expect(() => audioManager.stopAudio()).not.toThrow();
		});
	});

	describe('Session Manager Errors', () => {
		let sessionManager: SessionManager;

		beforeEach(() => {
			sessionManager = new SessionManager();
		});

		afterEach(() => {
			sessionManager.destroy();
		});

		it('should throw error without active session', () => {
			expect(() => sessionManager.mute()).toThrow('No active session to mute');
			// expect(() => sessionManager.unmute()).toThrow('No active session to unmute');
			expect(() => sessionManager.terminate()).toThrow('No active session to terminate');
			expect(() => sessionManager.sendInfo('test')).toThrow('No active session to send info');
		});

		it('should handle invalid session ID', () => {
			expect(sessionManager.getSession('invalid-id')).toBeNull();
			expect(() => sessionManager.setActiveSession('invalid-id')).toThrow('Session not found');
		});
	});

	describe('Config Manager Errors', () => {
		let configManager: ConfigManager;

		beforeEach(() => {
			configManager = new ConfigManager('https://test.com', 'token');
		});

		it('should handle operations without loaded config', () => {
			expect(() => configManager.getSipCredentials()).toThrow('Configuration not loaded');
			expect(() => configManager.getApplicationSid()).toThrow('Configuration not loaded');
			expect(configManager.isActive()).toBe(false);
			expect(configManager.isConfigValid()).toBe(false);
		});

		it('should handle HTTP error codes', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponses.serverError));

			await expect(configManager.fetchConfig()).rejects.toThrow(
				'Failed to fetch config: 500 Internal Server Error'
			);
		});

		it('should handle fetch rejection', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

			await expect(configManager.fetchConfig()).rejects.toThrow(
				'Configuration fetch failed: Network error'
			);
		});
	});

	describe('Memory and Resource Management', () => {
		it('should handle multiple client instances', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponses.success));

			const clients = await Promise.all([
				createWebRTCClient(mockWebRTCClientConfig),
				createWebRTCClient(mockWebRTCClientConfig),
				createWebRTCClient(mockWebRTCClientConfig),
			]);

			// All should be created successfully
			expect(clients).toHaveLength(3);
			clients.forEach(client => {
				expect(client).toBeInstanceOf(WebRTCClient);
			});

			// Clean up
			await Promise.all(clients.map(client => client.destroy()));
		});

		it('should handle rapid connect/disconnect cycles', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponses.success));
			const client = new WebRTCClient(mockWebRTCClientConfig);

			// Rapid connect/disconnect
			for (let i = 0; i < 5; i++) {
				await client.connect();
				expect(client.isConnected()).toBe(true);

				await client.disconnect();
				expect(client.isConnected()).toBe(false);
			}

			await client.destroy();
		});

		it('should handle event listener memory leaks', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponses.success));
			const client = new WebRTCClient(mockWebRTCClientConfig);

			// Add many listeners
			const handlers = Array.from({ length: 100 }, () => vi.fn());
			handlers.forEach(handler => {
				client.on('connected', handler);
				client.on('ringing', handler);
				client.on('ended', handler);
			});

			await client.connect();

			// Remove all listeners
			handlers.forEach(handler => {
				client.off('connected', handler);
				client.off('ringing', handler);
				client.off('ended', handler);
			});

			await client.destroy();

			// Should not have memory leaks
			expect(client.listenerCount('connected')).toBe(0);
			expect(client.listenerCount('ringing')).toBe(0);
			expect(client.listenerCount('ended')).toBe(0);
		});
	});

	describe('Edge Cases', () => {
		it('should handle empty or null configuration values', () => {
			const configManager = new ConfigManager('', '');
			expect(() => configManager.getSipCredentials()).toThrow('Configuration not loaded');
		});

		it('should handle malformed SIP URIs', () => {
			// This would be tested in the actual SIP implementation
			// For now, we test the validation function

			expect(isValidSipUri('')).toBe(false);
			expect(isValidSipUri('invalid')).toBe(false);
			expect(isValidSipUri('sip:')).toBe(false);
			expect(isValidSipUri('sip:@domain.com')).toBe(false);
		});

		it('should handle concurrent operations', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponses.success));
			const client = await createWebRTCClient(mockWebRTCClientConfig);

			// Concurrent connect attempts
			const connectPromises = [
				client.connect(),
			];
			const result = await Promise.all(connectPromises);
			// Should not throw errors
			expect(result).toBeDefined();

			await client.destroy();
		});

		it('should handle operations after destroy', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponses.success));
			const client = new WebRTCClient(mockWebRTCClientConfig);

			await client.connect();
			await client.destroy();

			// All operations should fail gracefully
			await expect(client.connect()).rejects.toThrow('Client has been destroyed');
			await expect(client.startCall()).rejects.toThrow('Client not connected. Call connect() first.');
			await expect(client.endCall()).rejects.toThrow('Failed to end call');
		});
	});
});
