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

			expect(rtcSession.sendDTMF).toHaveBeenCalledWith('42', undefined);
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
	describe('current session', () => {
		let ringing: MockRTCSession;
		let manager: SessionManager;

		beforeEach(() => {
			manager = new SessionManager();
			ringing = new MockRTCSession();
			manager.createSession(ringing as any);
			ringing.simulateProgress();
		});

		afterEach(() => {
			manager.destroy();
		});

		it('terminate works while ringing (before accepted)', () => {
			manager.terminate();

			expect(ringing.terminate).toHaveBeenCalledWith({
				status_code: 480,
				reason_phrase: 'Ended by user',
			});
		});

		it('tracks local and remote hold', () => {
			const updates: any[] = [];
			manager.on(COGNIGY_WEBRTC_EVENTS.SESSION_UPDATED, (s) => updates.push(s));

			ringing.emit('hold', { originator: 'local' });
			ringing.emit('hold', { originator: 'remote' });
			expect(updates.at(-1)).toMatchObject({ localHold: true, remoteHold: true });

			ringing.emit('unhold', { originator: 'local' });
			ringing.emit('unhold', { originator: 'remote' });
			ringing.emit('unhold', { originator: 'system' });
			expect(updates.at(-1)).toMatchObject({ localHold: false, remoteHold: false });
		});

		it('terminateAll terminates live sessions and keeps listeners', () => {
			const ended = new MockRTCSession();
			manager.createSession(ended as any);
			ended.simulateEnded();
			const listener = vi.fn();
			manager.on(COGNIGY_WEBRTC_EVENTS.RINGING, listener);

			manager.terminateAll();

			expect(ringing.terminate).toHaveBeenCalled();
			expect(ended.terminate).not.toHaveBeenCalled();
			expect(manager.getRawSession()).toBeNull();
			const next = new MockRTCSession();
			manager.createSession(next as any);
			next.simulateProgress();
			expect(listener).toHaveBeenCalledTimes(1);
		});

		it('terminate throws when no session is live', () => {
			ringing.simulateFailed();

			expect(() => manager.terminate()).toThrow('No active session to terminate');
		});

		it('mute before answer throws Session not established', () => {
			rtcSession.isEstablished.mockReturnValue(false);

			expect(() => sessionManager.mute()).toThrow('Session not established');
			expect(rtcSession.mute).not.toHaveBeenCalled();
		});

		it('prefers the active session over a newer ringing one', () => {
			// beforeEach's outer session is active; a newer session is ringing
			const other = new MockRTCSession();
			sessionManager.createSession(other as any);

			sessionManager.terminate();

			expect(rtcSession.terminate).toHaveBeenCalled();
			expect(other.terminate).not.toHaveBeenCalled();
		});

		it('falls back to the most recent live session and skips ended ones', () => {
			const older = new MockRTCSession();
			const newer = new MockRTCSession();
			manager.createSession(older as any);
			manager.createSession(newer as any);
			newer.simulateEnded();

			manager.terminate();

			expect(older.terminate).toHaveBeenCalled();
			expect(newer.terminate).not.toHaveBeenCalled();
			expect(ringing.terminate).not.toHaveBeenCalled();
		});
	});

	describe('getRawSession', () => {
		it('returns the current session and null after it ends', () => {
			expect(sessionManager.getRawSession()).toBe(rtcSession);

			rtcSession.simulateEnded();

			expect(sessionManager.getRawSession()).toBeNull();
		});

		it('returns null when there is no session', () => {
			const emptyManager = new SessionManager();

			expect(emptyManager.getRawSession()).toBeNull();

			emptyManager.destroy();
		});
	});

	describe('newInfo', () => {
		it('emits transcription without Object.hasOwn (pre-ES2022 browsers)', () => {
			const hasOwn = Object.hasOwn;
			const transcription = vi.fn();
			const infoReceived = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.TRANSCRIPTION, transcription);
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.INFO_RECEIVED, infoReceived);
			delete (Object as any).hasOwn;
			try {
				rtcSession.emit('newInfo', {
					originator: 'remote',
					info: { body: JSON.stringify({ _transcription: { messages: [] } }) },
				});
			} finally {
				Object.hasOwn = hasOwn;
			}

			expect(transcription).toHaveBeenCalledWith({ messages: [] });
			expect(infoReceived).not.toHaveBeenCalled();
		});
	});

	describe('createSession', () => {
		it('does not create or announce the same rtc session twice', () => {
			const createdSpy = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.SESSION_CREATED, createdSpy);
			const other = new MockRTCSession();

			const first = sessionManager.createSession(other as any);
			const second = sessionManager.createSession(other as any);

			expect(second).toBe(first);
			expect(createdSpy).toHaveBeenCalledTimes(1);
			expect(sessionManager.getAllSessions()).toHaveLength(2);
		});
	});

	describe('early ICE', () => {
		it('does not call ready() for host candidates', () => {
			const evt = rtcSession.simulateIceCandidate('host');

			expect(evt.ready).not.toHaveBeenCalled();
		});

		it('calls ready() on the first srflx candidate', () => {
			const host = rtcSession.simulateIceCandidate('host');
			const srflx = rtcSession.simulateIceCandidate('srflx');
			const later = rtcSession.simulateIceCandidate('srflx');

			expect(host.ready).not.toHaveBeenCalled();
			expect(srflx.ready).toHaveBeenCalledTimes(1);
			expect(later.ready).not.toHaveBeenCalled();
		});

		it('calls ready() on the first relay candidate', () => {
			const evt = rtcSession.simulateIceCandidate('relay');

			expect(evt.ready).toHaveBeenCalledTimes(1);
		});

		it('counts candidates per session', () => {
			const other = new MockRTCSession();
			sessionManager.createSession(other as any);

			rtcSession.simulateIceCandidate('srflx');
			const evt = other.simulateIceCandidate('host');

			expect(evt.ready).not.toHaveBeenCalled();
		});

		it('ignores malformed candidates without throwing', () => {
			const ready = vi.fn();

			expect(() => rtcSession.emit('icecandidate', { candidate: null, ready })).not.toThrow();
			expect(() => rtcSession.emit('icecandidate', { candidate: {}, ready })).not.toThrow();
			expect(() =>
				rtcSession.emit('icecandidate', { candidate: { candidate: 'short' }, ready }),
			).not.toThrow();
			expect(ready).not.toHaveBeenCalled();
		});
	});

	describe('REFER and replaces', () => {
		it('accepts REFER and hands the new session to createSession', () => {
			const onNewSession = vi.fn();
			const pcConfig = { iceServers: [{ urls: 'stun:example.org' }] };
			const manager = new SessionManager(pcConfig, onNewSession);
			const rtc = new MockRTCSession();
			manager.createSession(rtc as any);

			const data = rtc.simulateRefer(true);

			expect(data.accept).toHaveBeenCalledTimes(1);
			const [initCallback, options] = data.accept.mock.calls[0];
			expect(options).toEqual({
				mediaConstraints: { audio: true, video: false },
				pcConfig,
			});

			const referred = new MockRTCSession();
			initCallback(referred);

			expect(referred.data.replaces).toBe(true);
			expect(onNewSession).toHaveBeenCalledWith(referred);
			manager.destroy();
		});

		it('does not flag a REFER without a replaces header', () => {
			const onNewSession = vi.fn();
			const manager = new SessionManager(undefined, onNewSession);
			const rtc = new MockRTCSession();
			manager.createSession(rtc as any);

			const data = rtc.simulateRefer(false);
			const referred = new MockRTCSession();
			data.accept.mock.calls[0][0](referred);

			expect(referred.data.replaces).toBeUndefined();
			expect(onNewSession).toHaveBeenCalledWith(referred);
			manager.destroy();
		});

		it('still accepts a REFER without refer_to', () => {
			const onNewSession = vi.fn();
			const manager = new SessionManager(undefined, onNewSession);
			const rtc = new MockRTCSession();
			manager.createSession(rtc as any);
			const data = { request: {}, accept: vi.fn(), reject: vi.fn() };
			rtc.emit('refer', data);

			const referred = new MockRTCSession();
			expect(() => data.accept.mock.calls[0][0](referred)).not.toThrow();

			expect(referred.data.replaces).toBeUndefined();
			expect(onNewSession).toHaveBeenCalledWith(referred);
			manager.destroy();
		});

		it('auto-answers a replaces session that is not established', () => {
			const onNewSession = vi.fn();
			const pcConfig = { iceServers: [] };
			const manager = new SessionManager(pcConfig, onNewSession);
			const rtc = new MockRTCSession();
			manager.createSession(rtc as any);

			const data = rtc.simulateReplaces();
			const replacing = new MockRTCSession('incoming');
			replacing.isEstablished.mockReturnValue(false);
			data.accept.mock.calls[0][0](replacing);

			expect(replacing.data.replaces).toBe(true);
			expect(onNewSession).toHaveBeenCalledWith(replacing);
			expect(replacing.answer).toHaveBeenCalledWith({
				mediaConstraints: { audio: true, video: false },
				pcConfig,
			});
			manager.destroy();
		});

		it('does not answer a replaces session that is already established', () => {
			const manager = new SessionManager(undefined, vi.fn());
			const rtc = new MockRTCSession();
			manager.createSession(rtc as any);

			const data = rtc.simulateReplaces();
			const replacing = new MockRTCSession('incoming');
			data.accept.mock.calls[0][0](replacing);

			expect(replacing.answer).not.toHaveBeenCalled();
			manager.destroy();
		});
	});

	describe('streamsChanged', () => {
		const audioTrack = (id: string) => ({ id, kind: 'audio' });
		const videoTrack = (id: string) => ({ id, kind: 'video' });

		class FakeStream {
			constructor(public tracks: any[] = []) {}
			addTrack = vi.fn();
		}

		const OriginalMediaStream = globalThis.MediaStream;

		beforeEach(() => {
			(globalThis as any).MediaStream = FakeStream;
		});

		afterEach(() => {
			(globalThis as any).MediaStream = OriginalMediaStream;
		});

		it('emits remote and local audio streams on accepted', () => {
			const spy = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.STREAMS_CHANGED, spy);
			rtcSession.simulatePeerConnection();
			const pc = rtcSession._connection;
			pc.getReceivers.mockReturnValue([{ track: audioTrack('r1') }, { track: videoTrack('rv') }]);
			pc.getSenders.mockReturnValue([{ track: audioTrack('l1') }, { track: null }]);

			rtcSession.simulateAccepted();

			expect(spy).toHaveBeenCalledTimes(1);
			const [remote, local] = spy.mock.calls[0];
			expect(remote.tracks).toEqual([audioTrack('r1')]);
			expect(local.tracks).toEqual([audioTrack('l1')]);
		});

		it('emits null for a side without audio tracks', () => {
			const spy = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.STREAMS_CHANGED, spy);
			rtcSession.simulatePeerConnection();
			rtcSession._connection.getSenders.mockReturnValue([{ track: audioTrack('l1') }]);

			rtcSession.simulateAccepted();

			const [remote, local] = spy.mock.calls[0];
			expect(remote).toBeNull();
			expect(local.tracks).toEqual([audioTrack('l1')]);
		});

		it('does not emit when neither side has audio tracks', () => {
			const spy = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.STREAMS_CHANGED, spy);
			rtcSession.simulatePeerConnection();

			rtcSession.simulateAccepted();
			rtcSession._connection.dispatch('negotiationneeded');

			expect(spy).not.toHaveBeenCalled();
		});

		it('emits a null pair once when the last audio track goes away', () => {
			const spy = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.STREAMS_CHANGED, spy);
			rtcSession.simulatePeerConnection();
			const pc = rtcSession._connection;
			pc.getReceivers.mockReturnValue([{ track: audioTrack('r1') }]);
			pc.dispatch('negotiationneeded');

			pc.getReceivers.mockReturnValue([]);
			pc.dispatch('negotiationneeded');
			pc.dispatch('negotiationneeded');

			expect(spy).toHaveBeenCalledTimes(2);
			expect(spy.mock.calls[1].slice(0, 2)).toEqual([null, null]);
		});

		it('emits on peer-connection track and negotiationneeded', () => {
			const spy = vi.fn();
			sessionManager.on(COGNIGY_WEBRTC_EVENTS.STREAMS_CHANGED, spy);
			rtcSession.simulatePeerConnection();
			const pc = rtcSession._connection;
			pc.getReceivers.mockReturnValue([{ track: audioTrack('r1') }]);

			pc.dispatch('track', { track: audioTrack('r1') });
			pc.dispatch('negotiationneeded');

			expect(spy).toHaveBeenCalledTimes(2);
		});

		it('still forwards remote audio to the audio manager on track', () => {
			const audioManager = { handleRemoteStream: vi.fn() };
			sessionManager.setAudioManager(audioManager);
			rtcSession.simulatePeerConnection();

			rtcSession._connection.dispatch('track', { track: audioTrack('r1') });

			expect(audioManager.handleRemoteStream).toHaveBeenCalledTimes(1);
		});
	});
});
