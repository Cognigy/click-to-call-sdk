/**
 * Unit tests for SessionManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../SessionManager.js';
import { COGNIGY_WEBRTC_EVENTS } from '../../utils/events.js';
import { MockRTCSession } from '../mocks/jssip.js';

vi.mock('jssip', async () => {
	const { MockUA, MockWebSocketInterface } = await import('../mocks/jssip.js');
	return {
		UA: MockUA,
		WebSocketInterface: MockWebSocketInterface,
	};
});

describe('SessionManager', () => {
	let sessionManager: SessionManager;
	let rtcSession: MockRTCSession;

	beforeEach(() => {
		sessionManager = new SessionManager();
		rtcSession = new MockRTCSession();
		const sessionId = sessionManager.createSession(rtcSession as any);
		sessionManager.setActiveSession(sessionId);
	});

	afterEach(() => {
		sessionManager.destroy();
	});

	describe('sendDTMF', () => {
		it('sends tones on an established session and emits dtmfSent', () => {
			const dtmfSpy = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.DTMF_SENT, dtmfSpy);

			sessionManager.sendDTMF('1#');

			expect(rtcSession.sendDTMF).toHaveBeenCalledWith('1#', undefined);
			expect(dtmfSpy).toHaveBeenCalledWith('1#');
		});

		it('emits numeric tones as a string', () => {
			const dtmfSpy = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.DTMF_SENT, dtmfSpy);

			sessionManager.sendDTMF(42);

			expect(rtcSession.sendDTMF).toHaveBeenCalledWith(42, undefined);
			expect(dtmfSpy).toHaveBeenCalledWith('42');
		});

		it('passes options through to JsSIP', () => {
			const options = { duration: 200, interToneGap: 100, transportType: 'RFC2833' as const };

			sessionManager.sendDTMF('5', options);

			expect(rtcSession.sendDTMF).toHaveBeenCalledWith('5', options);
		});

		it('throws when the session is not established', () => {
			rtcSession.isEstablished.mockReturnValue(false);
			const dtmfSpy = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.DTMF_SENT, dtmfSpy);

			expect(() => sessionManager.sendDTMF('1')).toThrow('No active session to send DTMF');
			expect(rtcSession.sendDTMF).not.toHaveBeenCalled();
			expect(dtmfSpy).not.toHaveBeenCalled();
		});

		it('throws when there is no active session', () => {
			const emptyManager = new SessionManager();

			expect(() => emptyManager.sendDTMF('1')).toThrow('No active session to send DTMF');

			emptyManager.destroy();
		});

		it('does not emit dtmfSent when JsSIP rejects the tones', () => {
			rtcSession.sendDTMF.mockImplementation(() => {
				throw new TypeError('Invalid tones: x');
			});
			const dtmfSpy = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.DTMF_SENT, dtmfSpy);

			expect(() => sessionManager.sendDTMF('x')).toThrow('Invalid tones: x');
			expect(dtmfSpy).not.toHaveBeenCalled();
		});
	});
});
