/**
 * Test fixtures and mock data
 */

import type { EndpointConfig, WebRTCClientConfig } from '../../types/index.js';

export const mockEndpointConfig: EndpointConfig = {"organisationId":"test-org-id","projectId":"test-project-id","endpointSettings":{"snapshotId":null,"endpointUrlToken":"test-endpoint-token-placeholder","endpointName":"test-webrtc-endpoint","channel":"voiceGateway2","localeReferenceId":"00000000-0000-0000-0000-000000000001","collectAnalytics":true,"active":true,"version":"1.0.0","sipConnectivityInfo":{"applicationSid":"00000000-0000-0000-0000-000000000002","clientSid":"00000000-0000-0000-0000-000000000003","password":"test-password-placeholder","realm":"sip.example.com","username":"widget-test-user","wsUri":"wss://sip.example.com:8443"},"webrtcWidgetConfig":{"active":true,"label":""}},"settings":{"privacyNotice":{"enabled":false,"text":"Please accept our privacy policy to start your chat.\n\nLorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.","cancelButtonText":"Cancel","submitButtonText":"Submit","urlText":"","url":""}}}

export const mockWebRTCClientConfig: WebRTCClientConfig = {
	endpointUrl: 'https://api.example.com/test-endpoint-token-placeholder',
	userId: 'test-user-123'
};


export const mockInvalidEndpointConfig = {
	organisationId: 'test-invalid-org-id',
};

export const mockSipCredentials = {"applicationSid":"00000000-0000-0000-0000-000000000002","clientSid":"00000000-0000-0000-0000-000000000003","password":"test-password-placeholder","realm":"sip.example.com","username":"widget-test-user","wsUri":"wss://sip.example.com:8443"};

export const mockCallSession = {
	id: 'session-test-123',
	status: 'answered' as const,
	direction: 'outgoing' as const,
	startTime: new Date('2023-01-01T10:00:00Z'),
	answerTime: new Date('2023-01-01T10:00:05Z'),
	duration: 30,
	muted: false,
	localHold: false,
	remoteHold: false,
};

export const mockCallEndInfo = {
	originator: 'local' as const,
	cause: 'BYE',
	description: null,
};

// Mock fetch responses
export const mockFetchResponses = {
	success: {
		ok: true,
		status: 200,
		json: () => Promise.resolve(mockEndpointConfig),
	},
	unauthorized: {
		ok: false,
		status: 401,
		statusText: 'Unauthorized',
		json: () => Promise.resolve({ error: 'Unauthorized' }),
	},
	serverError: {
		ok: false,
		status: 500,
		statusText: 'Internal Server Error',
		json: () => Promise.resolve({ error: 'Server Error' }),
	},
	networkError: () => Promise.reject(new Error('Network Error')),
	timeout: () => new Promise(() => { }), // Never resolves
};

// Test event sequences for integration tests
export const mockEventSequences = {
	successfulCall: [
		{ event: 'connecting', delay: 10 },
		{ event: 'connected', delay: 20 },
		{ event: 'registered', delay: 30 },
		{ event: 'ringing', delay: 100 },
		{ event: 'answered', delay: 200 },
		{ event: 'ended', delay: 5000 },
	],
	failedCall: [
		{ event: 'connecting', delay: 10 },
		{ event: 'connected', delay: 20 },
		{ event: 'registered', delay: 30 },
		{ event: 'ringing', delay: 100 },
		{ event: 'failed', delay: 200 },
	],
	connectionFailure: [
		{ event: 'connecting', delay: 10 },
		{ event: 'error', delay: 100 },
	],
};
