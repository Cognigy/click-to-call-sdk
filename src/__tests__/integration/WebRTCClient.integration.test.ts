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

	describe('Config API', () => {
		const invalidSipConfig = () => ({
			...mockEndpointConfig,
			endpointSettings: {
				...mockEndpointConfig.endpointSettings,
				sipConnectivityInfo: { wsUri: 'wss://sip.example.com:8443' },
			},
		});
		const respondWith = (body: unknown) => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve(body),
			});
		};

		it('loadConfig fetches once and caches', async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);

			expect(client.getConfig()).toBeNull();
			const first = await client.loadConfig();
			const second = await client.loadConfig();

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(second).toBe(first);
			expect(client.getConfig()).toBe(first);
		});

		it('loadConfig shares one fetch between concurrent calls', async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);

			const [a, b] = await Promise.all([client.loadConfig(), client.loadConfig()]);

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(a).toBe(b);
		});

		it('loadConfig refetches after a failed fetch', async () => {
			global.fetch = vi
				.fn()
				.mockResolvedValueOnce(mockFetchResponses.unauthorized)
				.mockResolvedValueOnce(mockFetchResponses.success);
			client = new WebRTCClient(mockWebRTCClientConfig);

			await expect(client.loadConfig()).rejects.toThrow(/401/);
			await expect(client.loadConfig()).resolves.toEqual(mockEndpointConfig);
			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it('loadConfig resolves configs that fail SIP validation', async () => {
			respondWith(invalidSipConfig());
			client = new WebRTCClient(mockWebRTCClientConfig);

			await expect(client.loadConfig()).resolves.toMatchObject({ organisationId: 'test-org-id' });
		});

		it('connect rejects configs that fail SIP validation', async () => {
			respondWith(invalidSipConfig());
			client = new WebRTCClient(mockWebRTCClientConfig);

			await expect(client.connect()).rejects.toThrow(/Invalid endpoint configuration/);
			expect(client.isConnected()).toBe(false);
		});

		it('setUserId before connect sets the SIP identity', async () => {
			client = new WebRTCClient({ endpointUrl: mockWebRTCClientConfig.endpointUrl });

			await client.loadConfig();
			client.setUserId('webrtc-x');
			await client.connect();

			const ua = (client as any).sipManager.getUserAgent() as MockUAType;
			expect(ua.config.uri).toBe('sip:webrtc-x@sip.example.com');
		});

		it('setUserId after connect throws', async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();

			expect(() => client.setUserId('webrtc-x')).toThrow('Cannot change userId while connected');
		});

		it('setUserId works again after disconnect', async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();
			await client.disconnect();

			expect(() => client.setUserId('webrtc-x')).not.toThrow();
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

		it('subscribe returns an unsubscribe function', () => {
			const listener = vi.fn();
			const unsubscribe = client.subscribe(listener);
			expect(listener).not.toHaveBeenCalled();

			(client as any).callStateStore.update({ muted: true });
			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener.mock.calls[0][0]).toBe(client.getState());

			unsubscribe();
			(client as any).callStateStore.update({ muted: false });
			expect(listener).toHaveBeenCalledTimes(1);
		});

		const startSession = async () => {
			await client.startCall();
			await new Promise((resolve) => setTimeout(resolve, 20));
			return mockUA.getLastSession();
		};
		const transcriptionInfo = (text: string) => ({
			originator: 'remote',
			info: { body: JSON.stringify({ _transcription: { originator: 'bot', messages: [{ text }] } }) },
		});

		it('records transcription messages in state', async () => {
			const session = await startSession();
			const publicSpy = vi.fn();
			client.on(COGNIGY_WEBRTC_EVENTS.TRANSCRIPTION, publicSpy);
			session.emit('newInfo', transcriptionInfo('hi'));
			expect(client.getState().transcript.map((m) => m.text)).toEqual(['hi']);
			expect(publicSpy).toHaveBeenCalledWith({ originator: 'bot', messages: [{ text: 'hi' }] });
		});

		it('tracks stream changes in state', async () => {
			const remote = {} as MediaStream;
			const local = {} as MediaStream;
			await startSession();
			const id = client.getState().session?.id;
			(client as any).sessionManager.emit(COGNIGY_WEBRTC_EVENTS.STREAMS_CHANGED, remote, local, id);
			expect(client.getState().remoteStream).toBe(remote);
			expect(client.getState().localStream).toBe(local);
		});

		it('ignores transcription and streams from a previous session', async () => {
			const first = await startSession();
			first.simulatePeerConnection();
			first.simulateAccepted();
			first.simulateEnded();
			const second = await startSession();
			expect(second).not.toBe(first);
			second.simulatePeerConnection();
			second._connection.getReceivers.mockReturnValue([{ track: { id: 'r2', kind: 'audio' } }]);
			second.simulateAccepted();
			const { remoteStream } = client.getState();
			expect(remoteStream).toBeTruthy();

			first.emit('newInfo', transcriptionInfo('stale'));
			first._connection.getReceivers.mockReturnValue([{ track: { id: 'r1', kind: 'audio' } }]);
			first._connection.dispatch('negotiationneeded');

			expect(client.getState().transcript).toEqual([]);
			expect(client.getState().remoteStream).toBe(remoteStream);

			second.emit('newInfo', transcriptionInfo('fresh'));
			expect(client.getState().transcript.map((m) => m.text)).toEqual(['fresh']);
		});

		for (const outcome of ['ended', 'failed'] as const) {
			it(`clears remote and local streams when the call ${outcome}`, async () => {
				await client.startCall();
				await new Promise((resolve) => setTimeout(resolve, 20));
				const session = mockUA.getLastSession();
				session.simulatePeerConnection();
				const pc = session._connection;
				pc.getReceivers.mockReturnValue([{ track: { id: 'r1', kind: 'audio' } }]);
				pc.getSenders.mockReturnValue([{ track: { id: 'l1', kind: 'audio' } }]);
				session.simulateAccepted();
				expect(client.getState().remoteStream).toBeTruthy();
				expect(client.getState().localStream).toBeTruthy();

				if (outcome === 'ended') session.simulateEnded();
				else session.simulateFailed();

				expect(client.getState()).toMatchObject({ status: outcome, remoteStream: null, localStream: null });
			});

			it(`ignores late events from a session that ${outcome}`, async () => {
				await client.startCall();
				await new Promise((resolve) => setTimeout(resolve, 20));
				const session = mockUA.getLastSession();
				session.simulatePeerConnection();
				const pc = session._connection;
				pc.getReceivers.mockReturnValue([{ track: { id: 'r1', kind: 'audio' } }]);
				session.simulateAccepted();

				if (outcome === 'ended') session.simulateEnded();
				else session.simulateFailed();
				const terminal = client.getState();

				session.emit('newInfo', transcriptionInfo('late'));
				pc.dispatch('negotiationneeded');
				session.emit('muted', { audio: true });

				expect(client.getState()).toBe(terminal);
			});
		}

		it('keeps state.session in sync on mute and hold without changing status', async () => {
			await client.startCall();
			await new Promise((resolve) => setTimeout(resolve, 20));
			const session = mockUA.getLastSession();
			session.simulateAccepted();

			session.emit('muted');
			expect(client.getState()).toMatchObject({ muted: true, session: { muted: true } });
			session.emit('unmuted');
			expect(client.getState()).toMatchObject({ muted: false, session: { muted: false } });

			session.emit('hold', { originator: 'local' });
			expect(client.getState()).toMatchObject({ status: 'answered', session: { localHold: true } });
			session.emit('hold', { originator: 'remote' });
			expect(client.getState().session).toMatchObject({ localHold: true, remoteHold: true });
			session.emit('unhold', { originator: 'local' });
			session.emit('unhold', { originator: 'remote' });
			expect(client.getState()).toMatchObject({
				status: 'answered',
				session: { localHold: false, remoteHold: false },
			});
		});

		it('never publishes a session status ahead of the top-level status', async () => {
			const snapshots: Array<[string, string | undefined]> = [];
			client.subscribe((s) => snapshots.push([s.status, s.session?.status]));
			await client.startCall();
			await new Promise((resolve) => setTimeout(resolve, 20));
			const session = mockUA.getLastSession();
			session.simulateAccepted();
			session.simulateEnded();

			for (const [status, sessionStatus] of snapshots) {
				if (sessionStatus && sessionStatus !== 'init') expect(sessionStatus).toBe(status);
			}
		});

		it('ignores session updates from a session that is not current', async () => {
			await client.startCall();
			await new Promise((resolve) => setTimeout(resolve, 20));
			const current = client.getState().session;
			(client as any).sessionManager.emit(COGNIGY_WEBRTC_EVENTS.SESSION_UPDATED, {
				...current,
				id: 'other-session',
				muted: true,
			});
			expect(client.getState().session).toBe(current);
		});

		it('tracks ringing, answered and ended through a full call', async () => {
			const fresh = new WebRTCClient(mockWebRTCClientConfig);
			try {
				const statuses: string[] = [];
				fresh.subscribe((s) => statuses.push(s.status));
				await fresh.connect();
				await fresh.startCall();
				await new Promise((resolve) => setTimeout(resolve, 20));
				const ua = (fresh as any).sipManager.getUserAgent() as MockUAType;
				const session = ua.getLastSession();
				expect(fresh.getState().session).toBeTruthy();
				session.simulateAccepted();
				session.emit('muted');
				expect(fresh.getState().muted).toBe(true);
				session.simulateEnded();

				expect(statuses.filter((s, i) => s !== statuses[i - 1])).toEqual(['connecting', 'ringing', 'answered', 'ended']);
				expect(fresh.getState().endInfo).toBeTruthy();
			} finally {
				await fresh.destroy();
			}
		});

		it('emits sessionCreated on the client synchronously on newRTCSession', async () => {
			const order: string[] = [];
			client.on('sessionCreated', (session) => order.push(`created:${session.status}`));
			client.on('ringing', () => order.push('ringing'));

			await client.startCall();
			await new Promise(resolve => setTimeout(resolve, 20));

			expect(order).toEqual(['created:init', 'ringing']);
		});

		it('exposes the underlying JsSIP session via getRawSession', async () => {
			expect(client.getRawSession()).toBeNull();

			await client.startCall();
			await new Promise(resolve => setTimeout(resolve, 20));

			expect(client.getRawSession()).toBe(mockUA.getLastSession());
		});

		it('wires REFER-created sessions into the session manager once', async () => {
			await client.startCall();
			await new Promise(resolve => setTimeout(resolve, 20));
			const created = vi.fn();
			client.on('sessionCreated', created);

			const data = mockUA.getLastSession().simulateRefer(true);
			const { MockRTCSession } = await import('../mocks/jssip.js');
			const referred = new MockRTCSession('outgoing');
			data.accept.mock.calls[0][0](referred);
			// JsSIP then announces the same session on the UA
			mockUA.emit('newRTCSession', { session: referred });

			expect(created).toHaveBeenCalledTimes(1);
			expect(referred.data.replaces).toBe(true);
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

		it('should send DTMF tones during call', async () => {
			const dtmfEvents: string[] = [];

			client.on(COGNIGY_WEBRTC_EVENTS.DTMF_SENT, (tones) => dtmfEvents.push(tones));

			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateAccepted();

			await new Promise(resolve => setTimeout(resolve, 50));

			await expect(client.sendDTMF('1')).resolves.toBeUndefined();
			await client.sendDTMF(2, { transportType: 'RFC2833' });

			expect(session.sendDTMF).toHaveBeenNthCalledWith(1, '1', undefined);
			expect(session.sendDTMF).toHaveBeenNthCalledWith(2, '2', { transportType: 'RFC2833' });
			expect(dtmfEvents).toEqual(['1', '2']);
		});

		it('should reject DTMF without an active call', async () => {
			await expect(client.sendDTMF('1')).rejects.toThrow('Failed to send DTMF: No active session to send DTMF');
		});

		it('should surface invalid DTMF tones as a readable rejection', async () => {
			await client.startCall();

			// Wait for the automatic progress event from mock UA
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			session.simulateAccepted();
			session.sendDTMF.mockImplementation(() => {
				throw new TypeError('Invalid tones: x');
			});

			await expect(client.sendDTMF('x')).rejects.toThrow('Failed to send DTMF: Invalid tones: x');
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
			await client.sendDTMF('1');

			await client.endCall();
			session.simulateEnded();

			await new Promise(resolve => setTimeout(resolve, 100));

			// Verify events were emitted
			const eventNames = allEvents.map(e => e.event);
			expect(eventNames).toContain(COGNIGY_WEBRTC_EVENTS.ANSWERED);
			expect(eventNames).toContain(COGNIGY_WEBRTC_EVENTS.MUTED);
			expect(eventNames).toContain(COGNIGY_WEBRTC_EVENTS.INFO_SENT);
			expect(eventNames).toContain(COGNIGY_WEBRTC_EVENTS.DTMF_SENT);
			expect(eventNames).toContain(COGNIGY_WEBRTC_EVENTS.ENDED);
		});
	});

	describe('Event detail', () => {
		it('emits registrationFailed with response status', async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();
			mockUA = (client as any).sipManager.getUserAgent();
			const handler = vi.fn();
			client.on('registrationFailed', handler);
			client.on('error', () => {});

			mockUA.emit('registrationFailed', {
				cause: 'Rejected',
				response: { status_code: 403, reason_phrase: 'Forbidden', extra: 'x' },
			});

			expect(handler).toHaveBeenCalledWith({
				cause: 'Rejected',
				response: { status_code: 403, reason_phrase: 'Forbidden' },
			});
		});

		it('emits disconnected with code and reason', async () => {
			client = new WebRTCClient(mockWebRTCClientConfig);
			await client.connect();
			mockUA = (client as any).sipManager.getUserAgent();
			const handler = vi.fn();
			client.on('disconnected', handler);

			mockUA.emit('disconnected', { code: 1006, reason: 'gone', socket: {} });

			expect(handler).toHaveBeenCalledWith({ code: 1006, reason: 'gone' });
		});

		it('isConnected is true for a connected runtime endpoint', async () => {
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

			expect(client.isConnected()).toBe(true);
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
