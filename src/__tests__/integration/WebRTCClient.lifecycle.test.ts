/**
 * Call lifecycle: setup timeout, disconnectAfterCall, connect failures, re-calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebRTCClient } from '../../WebRTCClient.js';
import { SDK_END_CAUSES } from '../../index.js';
import type { WebRTCClientConfig } from '../../types/index.js';
import { mockEndpointConfig, mockWebRTCClientConfig, mockFetchResponses } from '../mocks/fixtures.js';
import type { MockUA as MockUAType } from '../mocks/jssip.js';

const ua = vi.hoisted(() => ({
	instances: [] as any[],
	failRegistration: false,
	silentCall: false,
}));

vi.mock('jssip', async () => {
	const { MockUA, MockWebSocketInterface } = await import('../mocks/jssip.js');
	const { vi: v } = await import('vitest');
	class RecordingUA extends MockUA {
		constructor(config: any) {
			super(config);
			ua.instances.push(this);
			if (ua.failRegistration) {
				this.start = v.fn(() => {
					setTimeout(() => this.emit('connecting'), 5);
					setTimeout(() => this.emit('connected'), 10);
					setTimeout(
						() =>
							this.emit('registrationFailed', {
								cause: 'Authentication Error',
								response: { status_code: 401, reason_phrase: 'Unauthorized' },
							}),
						15
					);
				});
			}
			if (ua.silentCall) {
				this.call = v.fn();
			}
		}
	}
	return { UA: RecordingUA, WebSocketInterface: MockWebSocketInterface };
});

const lastUA = (): MockUAType => ua.instances[ua.instances.length - 1];

const respondWith = (body: unknown) => {
	global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) });
};

describe('WebRTCClient call lifecycle', () => {
	let client: WebRTCClient;

	const create = (config: Partial<WebRTCClientConfig> = {}) => {
		client = new WebRTCClient({ ...mockWebRTCClientConfig, ...config });
		return client;
	};

	const connect = async () => {
		const p = client.connect();
		await vi.advanceTimersByTimeAsync(20);
		await p;
	};

	/** connect, dial and let the mock UA create the session and ring */
	const ring = async () => {
		await connect();
		await client.startCall();
		await vi.advanceTimersByTimeAsync(20);
		return lastUA().getLastSession();
	};

	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.clearAllMocks();
		ua.instances.length = 0;
		ua.failRegistration = false;
		ua.silentCall = false;
		global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
	});

	afterEach(async () => {
		await client?.destroy();
		vi.useRealTimers();
	});

	it('exports the SDK end causes', () => {
		expect(SDK_END_CAUSES).toEqual({
			CONFIG_FETCH_FAILED: 'CONFIG_FETCH_FAILED',
			CONFIG_INVALID: 'CONFIG_INVALID',
			WIDGET_INACTIVE: 'WIDGET_INACTIVE',
			REGISTRATION_FAILED: 'REGISTRATION_FAILED',
			SETUP_TIMEOUT: 'SETUP_TIMEOUT',
		});
	});

	describe('setup timeout', () => {
		it('setup timeout fails the call with SETUP_TIMEOUT and stops the UA', async () => {
			ua.silentCall = true;
			create();
			await connect();
			await client.startCall();

			await vi.advanceTimersByTimeAsync(10_001);

			expect(client.getState().status).toBe('failed');
			expect(client.getState().endInfo).toEqual({ originator: 'local', cause: 'SETUP_TIMEOUT', description: null });
			expect(lastUA().stop).toHaveBeenCalled();
			expect(client.isConnected()).toBe(false);
		});

		it('rejects a pending connect when the setup timeout fires first', async () => {
			global.fetch = vi.fn(() => new Promise(() => {})) as any;
			create();
			const p = client.connect();
			const settled = expect(p).rejects.toThrow(/^Failed to connect: Call setup timeout/);

			await vi.advanceTimersByTimeAsync(10_001);

			await settled;
			expect(client.getState().endInfo?.cause).toBe(SDK_END_CAUSES.SETUP_TIMEOUT);
		});

		it('terminates the current session with 480 when the timeout fires', async () => {
			create();
			const p = client.connect();
			await vi.advanceTimersByTimeAsync(20);
			await p;
			// Session exists but the timer is still running: re-arm it by hand
			await client.startCall();
			await vi.advanceTimersByTimeAsync(20);
			const session = lastUA().getLastSession();
			(client as any).startSetupTimer();

			await vi.advanceTimersByTimeAsync(10_001);

			expect(session.terminate).toHaveBeenCalledWith({ status_code: 480, reason_phrase: 'Call setup timeout' });
			expect(client.getState().endInfo?.cause).toBe(SDK_END_CAUSES.SETUP_TIMEOUT);
		});

		it('setup timeout is cleared once the session is created', async () => {
			create();
			await ring();

			await vi.advanceTimersByTimeAsync(20_000);

			expect(client.getState().status).toBe('ringing');
		});

		it('honours a custom callSetupTimeoutMs', async () => {
			ua.silentCall = true;
			create({ callSetupTimeoutMs: 3000 });
			await connect();
			await client.startCall();

			await vi.advanceTimersByTimeAsync(2900);
			expect(client.getState().status).toBe('connecting');
			await vi.advanceTimersByTimeAsync(200);
			expect(client.getState().status).toBe('failed');
			expect(client.getState().endInfo?.cause).toBe('SETUP_TIMEOUT');
		});
	});

	describe('endCall', () => {
		it('endCall before session stops the UA and ends', async () => {
			ua.silentCall = true;
			create();
			await connect();
			await client.startCall();

			await expect(client.endCall()).resolves.toBeUndefined();

			expect(lastUA().stop).toHaveBeenCalled();
			expect(client.getState().status).toBe('ended');
			expect(client.getState().endInfo).toEqual({ originator: 'local', cause: 'Canceled', description: null });
			// timer is cleared: nothing overwrites the Canceled state
			await vi.advanceTimersByTimeAsync(20_000);
			expect(client.getState().endInfo?.cause).toBe('Canceled');
		});

		it('endCall while connect is pending cancels it without throwing', async () => {
			create();
			const p = client.connect();
			const settled = expect(p).rejects.toThrow(/^Failed to connect: Canceled/);

			await expect(client.endCall()).resolves.toBeUndefined();

			await settled;
			expect(client.getState().status).toBe('ended');
			expect(client.getState().endInfo?.cause).toBe('Canceled');
			await vi.advanceTimersByTimeAsync(100);
			expect(ua.instances.length).toBeLessThanOrEqual(1);
			expect(client.isConnected()).toBe(false);
		});

		it('endCall with a session terminates it with 480 Ended by user', async () => {
			create();
			const session = await ring();

			await client.endCall();

			expect(session.terminate).toHaveBeenCalledWith({ status_code: 480, reason_phrase: 'Ended by user' });
			expect(client.getState().status).toBe('ringing');
			session.simulateEnded('Canceled');
			expect(client.getState().status).toBe('ended');
		});
	});

	describe('transport loss', () => {
		it('disconnect while ringing ends the call with Connection Error', async () => {
			create();
			await ring();

			lastUA().emit('disconnected', { code: 1006 });

			expect(client.getState().status).toBe('ended');
			expect(client.getState().endInfo).toEqual({ originator: null, cause: 'Connection Error', description: null });
			expect(lastUA().stop).toHaveBeenCalled();
			expect(client.isConnected()).toBe(false);
		});

		it('disconnect before a session is ignored', async () => {
			ua.silentCall = true;
			create();
			await connect();

			lastUA().emit('disconnected', { code: 1006 });

			expect(client.getState().status).toBe('connecting');
			expect(lastUA().stop).not.toHaveBeenCalled();
		});

		it('ignores disconnected from a UA that was already stopped', async () => {
			create({ disconnectAfterCall: true });
			const first = await ring();
			first.simulateEnded();
			const oldUA = lastUA();

			await ring();
			// MockUA.stop emits disconnected 50 ms later; the old UA must not end call 2
			oldUA.emit('disconnected', {});

			expect(client.getState().status).toBe('ringing');
		});
	});

	describe('disconnectAfterCall and re-calls', () => {
		it('second call after disconnectAfterCall emits events again', async () => {
			create({ disconnectAfterCall: true });
			const events: string[] = [];
			client.on('ringing', () => events.push('ringing'));
			client.on('answered', () => events.push('answered'));

			const first = await ring();
			first.simulateAccepted();
			(client as any).callStateStore.addTranscription({ originator: 'bot', messages: [{ text: 'hi' }] });
			first.simulateEnded();
			const firstUA = lastUA();
			expect(firstUA.stop).toHaveBeenCalled();
			expect(client.isConnected()).toBe(false);

			const statuses: string[] = [];
			client.subscribe((s) => statuses.push(s.status));
			const second = await ring();
			expect(lastUA()).not.toBe(firstUA);
			expect(ua.instances).toHaveLength(2);
			expect(client.getState().transcript).toEqual([]);
			second.simulateAccepted();

			expect(events).toEqual(['ringing', 'answered', 'ringing', 'answered']);
			expect(statuses.filter((s, i) => s !== statuses[i - 1])).toEqual(['connecting', 'ringing', 'answered']);
			expect(client.getState().status).toBe('answered');
		});

		it('keeps the UA after a call without disconnectAfterCall', async () => {
			create();
			const session = await ring();
			session.simulateEnded();

			expect(lastUA().stop).not.toHaveBeenCalled();
			expect(client.isConnected()).toBe(true);
		});

		it('connect while in a call returns the in-flight promise', async () => {
			create();
			const a = client.connect();
			const b = client.connect();
			expect(b).toBe(a);
			await vi.advanceTimersByTimeAsync(20);
			await Promise.all([a, b]);

			expect(ua.instances).toHaveLength(1);
		});

		it('startCall on a connected client resets state like a new call', async () => {
			create();
			const first = await ring();
			first.simulateAccepted();
			(client as any).callStateStore.addTranscription({ originator: 'bot', messages: [{ text: 'hi' }] });
			first.simulateEnded();
			expect(client.getState().status).toBe('ended');

			const statuses: string[] = [];
			client.subscribe((s) => statuses.push(s.status));
			await client.startCall();

			expect(statuses[0]).toBe('connecting');
			expect(client.getState()).toMatchObject({ endInfo: null, transcript: [], session: null });
			await vi.advanceTimersByTimeAsync(20);
			expect(client.getState().status).toBe('ringing');
			expect(ua.instances).toHaveLength(1);
		});

		it('connect after a call reuses a still-connected UA', async () => {
			create();
			const first = await ring();
			first.simulateEnded();

			await client.connect();
			expect(client.getState().status).toBe('connecting');
			await client.startCall();
			await vi.advanceTimersByTimeAsync(20);

			expect(ua.instances).toHaveLength(1);
			expect(client.getState().status).toBe('ringing');
		});

		it('startCall that JsSIP rejects fails the call with Internal Error', async () => {
			create();
			await connect();
			lastUA().call.mockImplementation(() => {
				throw new Error('Invalid target');
			});

			await expect(client.startCall()).rejects.toThrow('Failed to start call: Invalid target');

			expect(client.getState().status).toBe('failed');
			expect(client.getState().endInfo).toEqual({ originator: 'local', cause: 'Internal Error', description: 'Invalid target' });
			await vi.advanceTimersByTimeAsync(20_000);
			expect(client.getState().endInfo?.cause).toBe('Internal Error');
		});

		it('startCall is a no-op while a session is live', async () => {
			create();
			await ring();
			const calls = lastUA().call.mock.calls.length;

			await client.startCall();

			expect(lastUA().call.mock.calls.length).toBe(calls);
			expect(client.getState().status).toBe('ringing');
		});

		it('ignores end and mute events from a previous session', async () => {
			create();
			const first = await ring();
			first.simulateAccepted();
			first.simulateEnded();

			await client.startCall();
			await vi.advanceTimersByTimeAsync(20);
			const second = lastUA().getLastSession();
			expect(second).not.toBe(first);
			second.simulateAccepted();

			first.emit('muted');
			first.simulateFailed();
			first.simulateEnded();

			expect(client.getState().status).toBe('answered');
			expect(client.getState().muted).toBe(false);
			second.emit('muted');
			expect(client.getState().muted).toBe(true);
		});
	});

	describe('connect failures', () => {
		it('connect with invalid SIP config fails with CONFIG_INVALID', async () => {
			respondWith({
				...mockEndpointConfig,
				endpointSettings: {
					...mockEndpointConfig.endpointSettings,
					sipConnectivityInfo: { wsUri: 'wss://sip.example.com:8443' },
				},
			});
			create();

			await expect(client.connect()).rejects.toThrow(/^Failed to connect: Invalid endpoint configuration/);

			expect(client.getState().status).toBe('failed');
			expect(client.getState().endInfo).toEqual({ originator: null, cause: 'CONFIG_INVALID', description: null });
		});

		it('fetch failure fails with CONFIG_FETCH_FAILED', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.serverError);
			create();

			await expect(client.connect()).rejects.toThrow(/^Failed to connect:/);

			expect(client.getState().endInfo).toEqual({ originator: null, cause: 'CONFIG_FETCH_FAILED', description: null });
		});

		it('inactive widget fails with WIDGET_INACTIVE', async () => {
			respondWith({
				...mockEndpointConfig,
				endpointSettings: {
					...mockEndpointConfig.endpointSettings,
					webrtcWidgetConfig: { active: false },
				},
			});
			create();

			await expect(client.connect()).rejects.toThrow(/^Failed to connect: WebRTC widget is not active/);

			expect(client.getState().endInfo).toEqual({ originator: null, cause: 'WIDGET_INACTIVE', description: null });
			expect(ua.instances).toHaveLength(0);
		});

		it('registration failure fails with REGISTRATION_FAILED', async () => {
			ua.failRegistration = true;
			create();
			const registrationFailed = vi.fn();
			client.on('registrationFailed', registrationFailed);

			const p = client.connect();
			const settled = expect(p).rejects.toThrow(/^Failed to connect: Registration failed/);
			await vi.advanceTimersByTimeAsync(20);
			await settled;

			expect(registrationFailed).toHaveBeenCalledWith({
				cause: 'Authentication Error',
				response: { status_code: 401, reason_phrase: 'Unauthorized' },
			});
			expect(client.getState().status).toBe('failed');
			expect(client.getState().endInfo).toEqual({ originator: null, cause: 'REGISTRATION_FAILED', description: null });
		});

		it('stops the UA after a failed connect so setUserId and reconnect work', async () => {
			ua.failRegistration = true;
			create();
			const p = client.connect();
			const settled = expect(p).rejects.toThrow(/Failed to connect/);
			await vi.advanceTimersByTimeAsync(20);
			await settled;

			expect(lastUA().stop).toHaveBeenCalled();
			expect(() => client.setUserId('webrtc-retry')).not.toThrow();

			ua.failRegistration = false;
			await connect();
			expect(client.isConnected()).toBe(true);
			expect(lastUA().config.uri).toBe('sip:webrtc-retry@sip.example.com');
		});

		it('disconnect stops a UA left behind while connecting', async () => {
			create();
			const p = client.connect();
			p.catch(() => undefined);
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(0);
			expect(ua.instances).toHaveLength(1);

			await client.disconnect();

			expect(lastUA().stop).toHaveBeenCalled();
			await expect(p).rejects.toThrow(/Failed to connect/);
			expect(() => client.setUserId('x')).not.toThrow();
		});
	});
});
