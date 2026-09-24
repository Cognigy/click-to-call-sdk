/**
 * Integration tests for WebRTCClient
 * Tests the complete workflow and component interactions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebRTCClient } from '../../WebRTCClient.js';
import { COGNIGY_WEBRTC_EVENTS } from '../../utils/events.js';
import {
	mockEndpointConfig,
	mockWebRTCClientConfig,
	mockFetchResponses,
} from '../mocks/fixtures.js';

// Mock jssip using the existing mock classes
vi.mock('jssip', async () => {
	const { MockUA, MockWebSocketInterface } = await import('../mocks/jssip.js');
	return {
		UA: MockUA,
		WebSocketInterface: MockWebSocketInterface,
	};
});

// Import MockUA type for type checking
import type { MockUA as MockUAType } from '../mocks/jssip.js';

describe('WebRTCClient Integration Tests', () => {
	let client: WebRTCClient;
	let mockUA: MockUAType;

	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
	});

	afterEach(async () => {
		if (client) {
			await client.destroy();
		}
	});

	describe('Client Lifecycle', () => {
		it('should complete full connection workflow', async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);

			const events: string[] = [];
			const eventHandler = (eventName: string) => () => {
				events.push(eventName)
			};

			client.on(COGNIGY_WEBRTC_EVENTS.CONNECTING, eventHandler('connecting'));
			client.on(COGNIGY_WEBRTC_EVENTS.CONNECTED, eventHandler('connected'));
			client.on(COGNIGY_WEBRTC_EVENTS.REGISTERED, eventHandler('registered'));

			await client.connect();
			expect(client.isConnected()).toBe(true);
			expect(events).toContain('connecting');
			expect(events).toContain('connected');
			expect(events).toContain('registered');
		});

		it('should handle connection failure gracefully', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.unauthorized);
			client = new WebRTCClient(mockWebRTCClientConfig);

			await expect(client.connect()).rejects.toThrow(/Failed to connect/);
			expect(client.isConnected()).toBe(false);
		});

		it('should disconnect and clean up properly', async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();

			expect(client.isConnected()).toBe(true);

			await client.disconnect();

			expect(client.isConnected()).toBe(false);
		});
	});

	describe('Call Workflow', () => {
		beforeEach(async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();
			mockUA = (client as any).sipManager.getUserAgent();
		});

		it('should complete successful call workflow', async () => {
			const events: Array<{ event: string; session?: any }> = [];

			client.on(COGNIGY_WEBRTC_EVENTS.ANSWERED, (session) => events.push({ event: 'answered', session }));
			client.on(COGNIGY_WEBRTC_EVENTS.ENDED, (session) => events.push({ event: 'ended', session }));

			// Start call
			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			// Simulate call acceptance
			const session = mockUA.getLastSession();
			session.simulateAccepted();
			// Wait for events to propagate
			await new Promise(resolve => setTimeout(resolve, 50));
			expect(events.map(e => e.event)).toEqual(['answered']);
			expect(client.getCurrentSession()).toBeTruthy();

			// End call
			await client.endCall();
			session.simulateEnded();

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(events.map(e => e.event)).toContain('ended');
			expect(client.getCurrentSession()).toBeNull();
		});

		it('should dial the bare endpointId and thread identity headers through WebRTCClient', async () => {
			await client.destroy();
			const runtimeConfig = {
				...mockEndpointConfig,
				endpointSettings: {
					...mockEndpointConfig.endpointSettings,
					endpointId: 'endpoint-1',
					sipConnectivityInfo: { wsUri: 'wss://sip.example.com:8443' },
				},
			};
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve(runtimeConfig),
			});
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();
			mockUA = (client as any).sipManager.getUserAgent();
			expect(mockUA.config).toMatchObject({ register: false });
			expect(mockUA.config.uri).toBe('sip:test-user-123@sip.example.com');

			await client.startCall();

			expect(mockUA.call).toHaveBeenCalledWith('endpoint-1', expect.objectContaining({
				extraHeaders: ['X-Source: webrtc', 'X-Organisation-Id: test-org-id', 'X-Project-Id: test-project-id', 'X-Endpoint-Id: endpoint-1'],
			}));
		});

		it('should handle call failure', async () => {
			const events: Array<{ event: string; session?: any }> = [];

			client.on(COGNIGY_WEBRTC_EVENTS.FAILED, (session) => events.push({ event: 'failed', session }));

			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateFailed();

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(events.map(e => e.event)).toEqual(['failed']);
		});

		it('should handle mute/unmute during call', async () => {
			const events: string[] = [];

			client.on(COGNIGY_WEBRTC_EVENTS.MUTED, () => events.push('muted'));
			client.on(COGNIGY_WEBRTC_EVENTS.UNMUTED, () => events.push('unmuted'));

			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateAccepted();

			await new Promise(resolve => setTimeout(resolve, 50));

			// Test mute/unmute
			await client.mute();
			session.emit('muted');

			await client.unmute();
			session.emit('unmuted');

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(events).toEqual(['muted', 'unmuted']);
		});

		it('should receive info messages during call', async () => {
			const infoEvents: Array<{ text: string; data: any }> = [];

			client.on(COGNIGY_WEBRTC_EVENTS.INFO_RECEIVED, (info) => infoEvents.push(info));

			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateAccepted();

			await new Promise(resolve => setTimeout(resolve, 50));

			// Simulate receiving info message
			session.simulateInfoReceived('test info', { key: 'value' });

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(infoEvents).toHaveLength(1);
			expect(infoEvents[0]).toEqual({
				text: 'test info',
				data: { key: 'value' }
			});
		});

		it('should send info messages during call', async () => {
			const infoEvents: Array<{ text: string; data: any }> = [];

			client.on(COGNIGY_WEBRTC_EVENTS.INFO_SENT, (text, data) => infoEvents.push({ text, data }));

			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateAccepted();

			await new Promise(resolve => setTimeout(resolve, 50));

			await client.sendInfo('test message', { key: 'value' });
			await client.sendInfo('another message');

			expect(infoEvents).toEqual([
				{ text: 'test message', data: { key: 'value' } },
				{ text: 'another message', data: {} },
			]);
		});
	});

	describe('Audio Integration', () => {
		beforeEach(async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();
			mockUA = (client as any).sipManager.getUserAgent();
		});

		it('should handle default audio workflow', async () => {
			const audioEvents: MediaStream[] = [];

			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateAccepted();
			session.simulatePeerConnection();

			// Simulate remote stream
			const mockStream = new MediaStream();
			session._connection.addEventListener.mock.calls
				.find(([event]) => event === 'addstream')?.[1]({ stream: mockStream });

			await new Promise(resolve => setTimeout(resolve, 50));

			// Should not emit audioRequired for default audio
			expect(audioEvents).toHaveLength(0);
		});
	});

	describe('Error Handling Integration', () => {
		it('should handle configuration fetch errors', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.serverError);
			client = new WebRTCClient(mockWebRTCClientConfig);

			await expect(client.connect()).rejects.toThrow('Failed to connect');
		});

		it('should handle SIP connection errors', async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);

			const errorEvents: Error[] = [];
			client.on(COGNIGY_WEBRTC_EVENTS.ERROR, (error) => errorEvents.push(error));

			await client.connect();

			// Simulate SIP error
			const sipManager = (client as any).sipManager;
			sipManager.emit(COGNIGY_WEBRTC_EVENTS.ERROR, new Error('SIP connection failed'));

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(errorEvents).toHaveLength(1);
			expect(errorEvents[0].message).toBe('SIP connection failed');
		});

		it('should handle call errors when not connected', async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await expect(client.startCall()).rejects.toThrow('Client not connected. Call connect() first.');
			await expect(client.endCall()).rejects.toThrow('Failed to end call');
			await expect(client.mute()).rejects.toThrow('Failed to mute call');
		});
	});

	describe('State Management Integration', () => {
		beforeEach(async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();
			mockUA = (client as any).sipManager.getUserAgent();
		});

		it('should maintain consistent state across operations', async () => {
			// Initial state
			expect(client.isConnected()).toBe(true);
			expect(client.getCurrentSession()).toBeNull();

			// Start call
			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateAccepted();

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(client.getCurrentSession()).toBeTruthy();

			// End call
			await client.endCall();
			session.simulateEnded();

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(client.getCurrentSession()).toBeNull();

			// Disconnect
			await client.disconnect();

			expect(client.isConnected()).toBe(false);
		});

		it('should provide accurate status information', async () => {
			const initialStatus = client.getStatus();

			expect(initialStatus).toEqual({
				connected: true,
				registered: true,
				activeSession: null,
				audioState: expect.any(Object),
			});

			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateAccepted();

			await new Promise(resolve => setTimeout(resolve, 50));

			const callStatus = client.getStatus();

			expect(callStatus.activeSession).toBeTruthy();
			expect(callStatus.connected).toBe(true);
			expect(callStatus.registered).toBe(true);
		});
	});

	describe('Event System Integration', () => {
		beforeEach(async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();
			mockUA = (client as any).sipManager.getUserAgent();
		});

		it('should properly propagate events through the system', async () => {
			const allEvents: Array<{ event: string; data?: any }> = [];

			// Listen to all events
			Object.values(COGNIGY_WEBRTC_EVENTS).forEach(event => {
				client.on(event as any, (...args: any[]) => {
					allEvents.push({ event, data: args });
				});
			});

			// Perform operations
			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateAccepted();

			await client.mute();
			session.emit('muted');

			await client.sendInfo('test', {});

			await client.endCall();
			session.simulateEnded();

			await new Promise(resolve => setTimeout(resolve, 100));

			// Verify events were emitted
			const eventNames = allEvents.map(e => e.event);
			expect(eventNames).toContain(COGNIGY_WEBRTC_EVENTS.ANSWERED);
			expect(eventNames).toContain(COGNIGY_WEBRTC_EVENTS.MUTED);
			expect(eventNames).toContain(COGNIGY_WEBRTC_EVENTS.INFO_SENT);
			expect(eventNames).toContain(COGNIGY_WEBRTC_EVENTS.ENDED);
		});
	});

	describe('Cleanup and Resource Management', () => {
		beforeEach(async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();
			mockUA = (client as any).sipManager.getUserAgent();
		});

		it('should properly clean up resources on destroy', async () => {
			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateAccepted();

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(client.isConnected()).toBe(true);
			expect(client.getCurrentSession()).toBeTruthy();

			await client.destroy();

			expect(client.isConnected()).toBe(false);
			expect(client.getCurrentSession()).toBeNull();

			// Should not be able to perform operations after destroy
			await expect(client.connect()).rejects.toThrow('Client has been destroyed');
		});
	});
});
