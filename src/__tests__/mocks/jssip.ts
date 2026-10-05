/**
 * Mock implementation of JsSIP for testing
 */

import { vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock RTCSession
export class MockRTCSession extends EventEmitter {
	public direction: 'incoming' | 'outgoing' = 'outgoing';
	public start_time: Date | null = null;
	public _connection: any = null;
	public data: Record<string, any> = {};
	public remote_identity = {
		uri: {
			user: 'test-user',
		},
	};

	constructor(direction: 'incoming' | 'outgoing' = 'outgoing') {
		super();
		this.direction = direction;
	}

	isEstablished = vi.fn(() => true);
	isEnded = vi.fn(() => false);
	answer = vi.fn();
	terminate = vi.fn();
	mute = vi.fn();
	unmute = vi.fn();
	hold = vi.fn();
	unhold = vi.fn();
	sendInfo = vi.fn();
	sendDTMF = vi.fn();

	// Simulate call progression
	simulateProgress() {
		this.emit('progress');
	}

	simulateAccepted() {
		this.start_time = new Date();
		this.emit('accepted');
	}

	simulateEnded(cause = 'BYE') {
		this.emit('ended', {
			originator: 'local',
			cause,
			message: null,
		});
	}

	simulateFailed(cause = 'Request Timeout') {
		this.emit('failed', {
			originator: 'remote',
			cause,
			message: { status_code: 408 },
		});
	}

	simulatePeerConnection() {
		const listeners = new Map<string, Array<(evt: any) => void>>();
		this._connection = {
			addEventListener: vi.fn((type: string, handler: (evt: any) => void) => {
				listeners.set(type, [...(listeners.get(type) ?? []), handler]);
			}),
			removeEventListener: vi.fn(),
			getSenders: vi.fn((): any[] => []),
			getReceivers: vi.fn((): any[] => []),
			// Test helper: fire a peer-connection event at the registered listeners
			dispatch: (type: string, evt: any = {}) => {
				for (const handler of listeners.get(type) ?? []) handler(evt);
			},
		};
		this.emit('peerconnection', { peerconnection: this._connection });
	}

	/** Emit a JsSIP `icecandidate` event; returns the event so tests can inspect `ready`. */
	simulateIceCandidate(type: 'host' | 'srflx' | 'relay' | string) {
		const evt = {
			candidate: { candidate: `candidate:1 1 udp 2122260223 10.0.0.1 54321 typ ${type}` },
			ready: vi.fn(),
		};
		this.emit('icecandidate', evt);
		return evt;
	}

	/** Emit a JsSIP `refer` event; returns the event data. */
	simulateRefer() {
		const data = { request: {}, accept: vi.fn(), reject: vi.fn() };
		this.emit('refer', data);
		return data;
	}

	/** Emit a JsSIP `replaces` event; returns the event data. */
	simulateReplaces() {
		const data = { request: {}, accept: vi.fn(), reject: vi.fn() };
		this.emit('replaces', data);
		return data;
	}

	simulateInfoReceived(text: string, data: any = {}) {
		this.emit('newInfo', { text, data });
	}
}

// Mock WebSocketInterface
export class MockWebSocketInterface extends EventEmitter {
	constructor(public uri: string) {
		super();
	}

	connect = vi.fn();
	disconnect = vi.fn();
	send = vi.fn();
}

// Create a spyable constructor using vi.fn with a class implementation
export const MockWebSocketInterfaceSpy = vi.fn(function MockWebSocketInterfaceSpyImpl(this: any, uri: string) {
	// Call parent constructor logic
	EventEmitter.call(this);
	this.uri = uri;
	this.connect = vi.fn();
	this.disconnect = vi.fn();
	this.send = vi.fn();
	return this;
}) as unknown as typeof MockWebSocketInterface & ReturnType<typeof vi.fn>;

// Make instances inherit from EventEmitter
MockWebSocketInterfaceSpy.prototype = Object.create(EventEmitter.prototype);
MockWebSocketInterfaceSpy.prototype.constructor = MockWebSocketInterfaceSpy;

// Mock UA (User Agent)
export class MockUA extends EventEmitter {
	private _sessions: MockRTCSession[] = [];
	private _isStarted = false;
	private _isConnected = false;
	private _isRegistered = false;

	constructor(public config: any) {
		super();
	}

	start = vi.fn(() => {
		if (this._isStarted) return;

		this._isStarted = true;
		console.log('MockUA: Starting...');

		// Simulate the real JsSIP UA behavior with proper timing
		// First emit connecting
		setTimeout(() => {
			console.log('MockUA: Emitting connecting');
			this.emit('connecting');
		}, 5);

		// Then emit connected
		setTimeout(() => {
			console.log('MockUA: Emitting connected');
			this._isConnected = true;
			this.emit('connected');
		}, 10);

		// Finally emit registered (this is what the WebRTCClient waits for)
		if (this.config?.register === false) return;
		setTimeout(() => {
			console.log('MockUA: Emitting registered');
			this._isRegistered = true;
			this.emit('registered');
		}, 15);
	});

	stop = vi.fn(() => {
		console.log('MockUA: Stopping...');
		this._isStarted = false;
		this._isConnected = false;
		this._isRegistered = false;
		setTimeout(() => this.emit('disconnected'), 50);
	});

	call = vi.fn((_target: string, options?: any) => {
		const session = new MockRTCSession('outgoing');
		session.data = options?.data || {};
		this._sessions.push(session);

		setTimeout(() => {
			this.emit('newRTCSession', { session });
			session.simulateProgress();
		}, 10);

		return session;
	});

	register = vi.fn();
	unregister = vi.fn();
	isRegistered = vi.fn(() => this._isRegistered);
	isConnected = vi.fn(() => this._isConnected);

	// Test utilities
	getSessions() {
		return this._sessions;
	}

	getLastSession() {
		return this._sessions[this._sessions.length - 1];
	}

	simulateIncomingCall() {
		const session = new MockRTCSession('incoming');
		this._sessions.push(session);
		this.emit('newRTCSession', { session });
		return session;
	}

	simulateConnectionFailure() {
		setTimeout(() => {
			this.emit('registrationFailed', { cause: 'Connection failed' });
		}, 20);
	}
}

// Create a spyable constructor using vi.fn with MockUA implementation
export const MockUASpy = vi.fn(function MockUASpyImpl(this: any, config: any) {
	// Call parent constructor logic
	EventEmitter.call(this);
	this.config = config;
	this._sessions = [];
	this._isStarted = false;
	this._isConnected = false;
	this._isRegistered = false;
	
	this.start = vi.fn(() => {
		if (this._isStarted) return;
		this._isStarted = true;
		console.log('MockUA: Starting...');
		setTimeout(() => {
			console.log('MockUA: Emitting connecting');
			this.emit('connecting');
		}, 5);
		setTimeout(() => {
			console.log('MockUA: Emitting connected');
			this._isConnected = true;
			this.emit('connected');
		}, 10);
		if (this.config?.register === false) return;
		setTimeout(() => {
			console.log('MockUA: Emitting registered');
			this._isRegistered = true;
			this.emit('registered');
		}, 15);
	});
	
	this.stop = vi.fn(() => {
		console.log('MockUA: Stopping...');
		this._isStarted = false;
		this._isConnected = false;
		this._isRegistered = false;
		setTimeout(() => this.emit('disconnected'), 50);
	});
	
	this.call = vi.fn((_target: string, options?: any) => {
		const session = new MockRTCSession('outgoing');
		session.data = options?.data || {};
		this._sessions.push(session);
		setTimeout(() => {
			this.emit('newRTCSession', { session });
			session.simulateProgress();
		}, 10);
		return session;
	});
	
	this.register = vi.fn();
	this.unregister = vi.fn();
	this.isRegistered = vi.fn(() => this._isRegistered);
	this.isConnected = vi.fn(() => this._isConnected);
	
	this.getSessions = () => this._sessions;
	this.getLastSession = () => this._sessions[this._sessions.length - 1];
	this.simulateIncomingCall = () => {
		const session = new MockRTCSession('incoming');
		this._sessions.push(session);
		this.emit('newRTCSession', { session });
		return session;
	};
	this.simulateConnectionFailure = () => {
		setTimeout(() => {
			this.emit('registrationFailed', { cause: 'Connection failed' });
		}, 20);
	};
	
	return this;
}) as unknown as typeof MockUA & ReturnType<typeof vi.fn>;

// Make instances inherit from EventEmitter
MockUASpy.prototype = Object.create(EventEmitter.prototype);
MockUASpy.prototype.constructor = MockUASpy;

// Mock Grammar
export const MockGrammar = {
	parse: vi.fn((header: string, type: string) => {
		if (type === 'Reason' && header) {
			return { cause: '200' };
		}
		return null;
	}),
};

// Mock C (Constants)
export const MockC = {
	causes: {
		BYE: 'BYE',
		CANCELED: 'CANCELED',
		NO_ANSWER: 'NO_ANSWER',
		EXPIRES: 'EXPIRES',
		REJECTED: 'REJECTED',
	},
};

// Export the mocked JsSIP module
export const JsSIPMock = {
	UA: MockUA,
	WebSocketInterface: MockWebSocketInterface,
	Grammar: MockGrammar,
	C: MockC,
};

// Mock the entire jssip module
// vi.mock('jssip', () => JsSIPMock);

