/**
 * Unit tests for SipManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SipManager } from '../../SipManager.js';
import { COGNIGY_WEBRTC_EVENTS } from '../../utils/events.js';

// Mock the jssip module
vi.mock('jssip', async () => {
	const { MockUASpy, MockWebSocketInterfaceSpy } = await import('../mocks/jssip.js');
	return {
		UA: MockUASpy,
		WebSocketInterface: MockWebSocketInterfaceSpy,
	};
});

import type { MockUA as MockUAType } from '../mocks/jssip.js';
import { MockUASpy, MockWebSocketInterfaceSpy, type MockUA } from '../mocks/jssip.js';

describe('SipManager', () => {
	let sipManager: SipManager;
	let mockUA: MockUAType;

	const mockClientConfig = {
		fullUsername: 'test@example.com',
		password: 'password123',
		username: 'test',
	};

	const mockSettings = {
		wsUri: 'wss://example.com:8443',
	};

	beforeEach(() => {
		sipManager = new SipManager();
		vi.clearAllMocks();
	});

	afterEach(() => {
		sipManager.destroy();
	});

	describe('constructor', () => {
		it('should create SipManager instance', () => {
			expect(sipManager).toBeInstanceOf(SipManager);
			expect(sipManager.isConnected()).toBe(false);
			expect(sipManager.isRegistered()).toBe(false);
		});
	});

	describe('initialize', () => {
		it('should initialize SIP user agent with correct configuration', () => {
			sipManager.initialize(mockClientConfig, mockSettings);
			
			expect(MockWebSocketInterfaceSpy).toHaveBeenCalledWith(mockSettings.wsUri);
			expect(MockUASpy).toHaveBeenCalledWith({
				uri: `sip:${mockClientConfig.fullUsername}`,
				password: mockClientConfig.password,
				authorization_user: mockClientConfig.username,
				sockets: expect.any(Array),
				register: true,
			});
		});

		it('should stop existing UA before initializing new one', () => {
			sipManager.initialize(mockClientConfig, mockSettings);
			const firstUA = sipManager.getUserAgent();

			sipManager.initialize(mockClientConfig, mockSettings);

			expect(firstUA?.stop).toHaveBeenCalled();
		});

		it('should set up event handlers', () => {
			sipManager.initialize(mockClientConfig, mockSettings);
			mockUA = sipManager.getUserAgent() as unknown as MockUA;

			expect(mockUA.listenerCount('connecting')).toBeGreaterThan(0);
			expect(mockUA.listenerCount('connected')).toBeGreaterThan(0);
			expect(mockUA.listenerCount('disconnected')).toBeGreaterThan(0);
			expect(mockUA.listenerCount('registered')).toBeGreaterThan(0);
			expect(mockUA.listenerCount('newRTCSession')).toBeGreaterThan(0);
		});
	});

	describe('start', () => {
		it('should start the SIP user agent', () => {
			sipManager.initialize(mockClientConfig, mockSettings);
			mockUA = sipManager.getUserAgent() as unknown as MockUA;

			sipManager.start();

			expect(mockUA.start).toHaveBeenCalled();
		});

		it('should throw error if not initialized', () => {
			expect(() => sipManager.start()).toThrow('SIP manager not initialized');
		});

		it('should update state on connection events', async () => {
			sipManager.initialize(mockClientConfig, mockSettings);
			mockUA = sipManager.getUserAgent() as unknown as MockUA;

			const connectingSpy = vi.fn();
			const connectedSpy = vi.fn();
			const registeredSpy = vi.fn();

			sipManager.on('connecting', connectingSpy);
			sipManager.on(COGNIGY_WEBRTC_EVENTS.CONNECTED, connectedSpy);
			sipManager.on(COGNIGY_WEBRTC_EVENTS.REGISTERED, registeredSpy);

			sipManager.start();

			// Wait for async events
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(connectingSpy).toHaveBeenCalled();
			expect(connectedSpy).toHaveBeenCalled();
			expect(registeredSpy).toHaveBeenCalled();
			expect(sipManager.isConnected()).toBe(true);
			expect(sipManager.isRegistered()).toBe(true);
		});
	});

	describe('stop', () => {
		it('should stop the SIP user agent', () => {
			sipManager.initialize(mockClientConfig, mockSettings);
			mockUA = sipManager.getUserAgent() as unknown as MockUA;

			sipManager.stop();

			expect(mockUA.stop).toHaveBeenCalled();
			expect(sipManager.getUserAgent()).toBeNull();
			expect(sipManager.isConnected()).toBe(false);
			expect(sipManager.isRegistered()).toBe(false);
		});

		it('should handle stop when not initialized', () => {
			expect(() => sipManager.stop()).not.toThrow();
		});
	});

	describe('call', () => {
		beforeEach(() => {
			sipManager.initialize(mockClientConfig, mockSettings);
			mockUA = sipManager.getUserAgent() as unknown as MockUA;
			// Simulate registered state
			sipManager.start();
		});

		it('should make a call with correct parameters', async() => {
			const number = 'app-12345';
			const originalNumber = '12345';
			await new Promise(resolve => setTimeout(resolve, 20));
			sipManager.call(number, originalNumber);

			expect(mockUA.call).toHaveBeenCalledWith(number, {
				data: {
					originalNumber,
					sessionId: expect.any(String),
				},
				mediaConstraints: { audio: true, video: false },
				extraHeaders: ['X-Source: webrtc'],
				pcConfig: undefined,
			});
		});

		it('should use number as originalNumber if not provided', async() => {
			const number = 'app-12345';
			await new Promise(resolve => setTimeout(resolve, 20));

			sipManager.call(number);

			expect(mockUA.call).toHaveBeenCalledWith(number, expect.objectContaining({
				data: expect.objectContaining({
					originalNumber: number,
				}),
			}));
		});

		it('should throw error if not initialized', () => {
			sipManager.stop();
			expect(() => sipManager.call('123')).toThrow('SIP manager not initialized');
		});

		it('should throw error if not registered', () => {
			// Mock unregistered state
			mockUA.isRegistered = vi.fn(() => false);
			(sipManager as any).state.registered = false;

			expect(() => sipManager.call('123')).toThrow('SIP client not registered');
		});

		it('should emit error event on call failure', async() => {
			await new Promise(resolve => setTimeout(resolve, 20));
			const errorSpy = vi.fn();
			sipManager.on(COGNIGY_WEBRTC_EVENTS.ERROR, errorSpy);

			mockUA.call.mockImplementation(() => {
				throw new Error('Call failed');
			});

			expect(() => sipManager.call('123')).toThrow('Call failed');
			expect(errorSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining('Failed to make call'),
				})
			);
		});
	});

	describe('newRTCSession handling', () => {
		beforeEach(() => {
			sipManager.initialize(mockClientConfig, mockSettings);
			mockUA = sipManager.getUserAgent() as unknown as MockUA;
		});

		it('should handle new RTC session and set up sendInfo override', async () => {
			const sessionCreatedSpy = vi.fn();
			const infoSentSpy = vi.fn();
			await sipManager.start();
			sipManager.on(COGNIGY_WEBRTC_EVENTS.SESSION_CREATED, sessionCreatedSpy);
			sipManager.on(COGNIGY_WEBRTC_EVENTS.INFO_SENT, infoSentSpy);
			await new Promise(resolve => setTimeout(resolve, 20));

			sipManager.call('app-12345');

			// Wait for async session creation
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			expect(sessionCreatedSpy).toHaveBeenCalledWith(session);

			// Test sendInfo override
			session.sendInfo('test message', { key: 'value' });
			expect(infoSentSpy).toHaveBeenCalledWith('test message', { key: 'value' });
		});

		it('should add session ID to session data', async () => {
			await sipManager.start();
			await new Promise(resolve => setTimeout(resolve, 20));
			sipManager.call('app-12345');

			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();
			expect(session.data.sessionId).toBeDefined();
			expect(typeof session.data.sessionId).toBe('string');
		});
	});

	describe('state management', () => {
		beforeEach(() => {
			sipManager.initialize(mockClientConfig, mockSettings);
		});

		it('should return current state', () => {
			const state = sipManager.getState();

			expect(state).toEqual({
				ua: expect.anything(),
				connected: false,
				registered: false,
				connecting: false,
			});
		});

		it('should update state on connection events', async () => {
			sipManager.start();

			await new Promise(resolve => setTimeout(resolve, 50));

			const state = sipManager.getState();
			expect(state.connected).toBe(true);
			expect(state.registered).toBe(true);
			expect(state.connecting).toBe(false);
		});
	});

	describe('error handling', () => {
		it('should emit error on registration failure', () => {
			sipManager.initialize(mockClientConfig, mockSettings);
			mockUA = sipManager.getUserAgent() as unknown as MockUA;

			const errorSpy = vi.fn();
			sipManager.on(COGNIGY_WEBRTC_EVENTS.ERROR, errorSpy);

			mockUA.emit('registrationFailed', { cause: 'Authentication failed' });

			expect(errorSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					message: 'Registration failed: Authentication failed',
				})
			);
		});

		it('should handle sendInfo errors gracefully', async () => {
			await sipManager.initialize(mockClientConfig, mockSettings);
			mockUA = sipManager.getUserAgent() as unknown as MockUA;
			await sipManager.start();
			await new Promise(resolve => setTimeout(resolve, 20));
			const errorSpy = vi.fn();
			sipManager.on(COGNIGY_WEBRTC_EVENTS.ERROR, errorSpy);

			const originalCall = mockUA.call;
			mockUA.call = vi.fn().mockImplementation((target: string, options?: any) => {
				const session = originalCall.call(mockUA, target, options);
				session.sendInfo = vi.fn().mockImplementation(() => {
					throw new Error('SendInfo failed');
				});
				return session;
			});

			await sipManager.call('app-12345');
			await new Promise(resolve => setTimeout(resolve, 20));

			const session = mockUA.getLastSession();

			session.sendInfo('test', {});

			expect(errorSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining('Failed to send info'),
				})
			);

			// Restore the original call method
			mockUA.call = originalCall;
		});
	});

	describe('destroy', () => {
		it('should clean up resources', () => {
			sipManager.initialize(mockClientConfig, mockSettings);
			mockUA = sipManager.getUserAgent() as unknown as MockUA;

			sipManager.destroy();

			expect(mockUA.stop).toHaveBeenCalled();
			expect(sipManager.getUserAgent()).toBeNull();
			expect(sipManager.listenerCount('connecting')).toBe(0);
		});
	});
});
