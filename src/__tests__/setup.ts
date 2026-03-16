/**
 * Test setup file for Vitest
 * Configures global test environment and mocks
 */

import { vi } from 'vitest';

// Extend global interface for test utilities
declare global {
	var testUtils: {
		createMockMediaStream: () => MediaStream;
		createMockAudio: () => HTMLAudioElement;
		createMockRTCPeerConnection: () => RTCPeerConnection;
		delay: (ms: number) => Promise<void>;
	};
}

// Mock browser APIs that are not available in jsdom
class MockRTCPeerConnection {
	createOffer = vi.fn();
	createAnswer = vi.fn();
	setLocalDescription = vi.fn();
	setRemoteDescription = vi.fn();
	addIceCandidate = vi.fn();
	addEventListener = vi.fn();
	removeEventListener = vi.fn();
	close = vi.fn();
	getStats = vi.fn();
	addTrack = vi.fn();
	removeTrack = vi.fn();
	getSenders = vi.fn(() => []);
	getReceivers = vi.fn(() => []);
	getTransceivers = vi.fn(() => []);
	connectionState = 'new';
	iceConnectionState = 'new';
	iceGatheringState = 'new';
	signalingState = 'stable';
}

Object.defineProperty(window, 'RTCPeerConnection', {
	writable: true,
	value: MockRTCPeerConnection,
});

Object.defineProperty(window.navigator, 'mediaDevices', {
	writable: true,
	value: {
		getUserMedia: vi.fn(),
		getDisplayMedia: vi.fn(),
		enumerateDevices: vi.fn(() => Promise.resolve([])),
	},
});

// Mock Audio constructor
class MockAudio {
	play = vi.fn(() => Promise.resolve());
	pause = vi.fn();
	load = vi.fn();
	addEventListener = vi.fn();
	removeEventListener = vi.fn();
	volume = 1;
	muted = false;
	paused = true;
	ended = false;
	currentTime = 0;
	duration = 0;
	src = '';
	srcObject: MediaStream | null = null;
	autoplay = false;
	onplaying: (() => void) | null = null;
	onpause: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onended: (() => void) | null = null;
}

Object.defineProperty(window, 'Audio', {
	writable: true,
	value: MockAudio,
});

// Mock MediaStream
class MockMediaStream {
	getTracks = vi.fn(() => []);
	getAudioTracks = vi.fn(() => []);
	getVideoTracks = vi.fn(() => []);
	addTrack = vi.fn();
	removeTrack = vi.fn();
	clone = vi.fn();
	addEventListener = vi.fn();
	removeEventListener = vi.fn();
	id = 'mock-stream-id';
	active = true;
}

Object.defineProperty(window, 'MediaStream', {
	writable: true,
	value: MockMediaStream,
});

// Mock fetch for configuration requests
global.fetch = vi.fn();

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
	value: {
		getItem: vi.fn(),
		setItem: vi.fn(),
		removeItem: vi.fn(),
		clear: vi.fn(),
		length: 0,
		key: vi.fn(),
	},
	writable: true,
});

// Mock WebSocket
class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	
	send = vi.fn();
	close = vi.fn();
	addEventListener = vi.fn();
	removeEventListener = vi.fn();
	readyState = 1; // OPEN
	CONNECTING = 0;
	OPEN = 1;
	CLOSING = 2;
	CLOSED = 3;
}

Object.defineProperty(window, 'WebSocket', {
	writable: true,
	value: MockWebSocket,
});

// Global test utilities
global.testUtils = {
	createMockMediaStream: () => new MediaStream(),
	createMockAudio: () => new Audio(),
	createMockRTCPeerConnection: () => new RTCPeerConnection(),
	delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
};
