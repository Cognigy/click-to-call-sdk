import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CallStateStore } from '../../CallStateStore.js';
import { COGNIGY_WEBRTC_EVENTS } from '../../utils/events.js';
import type { ClientState } from '../../types/index.js';

describe('CallStateStore', () => {
	let store: CallStateStore;

	beforeEach(() => {
		vi.useFakeTimers();
		store = new CallStateStore();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts idle', () => {
		expect(store.getState()).toEqual({
			status: 'idle',
			muted: false,
			session: null,
			endInfo: null,
			transcript: [],
			remoteStream: null,
			localStream: null,
		});
	});

	it('emits a new state object on every change and none for no-op updates', () => {
		const states: ClientState[] = [];
		store.on(COGNIGY_WEBRTC_EVENTS.STATE_CHANGED, (s: ClientState) => states.push(s));
		const initial = store.getState();

		store.update({ status: 'ringing' });
		store.update({ status: 'ringing' });
		store.update({ muted: true });

		expect(states).toHaveLength(2);
		expect(states[0]).not.toBe(initial);
		expect(states[1]).not.toBe(states[0]);
		expect(states[0].status).toBe('ringing');
		expect(states[1].muted).toBe(true);
		expect(initial.status).toBe('idle');
		expect(store.getState()).toBe(states[1]);
	});

	it('dedupes a repeated transcription within 1s', () => {
		store.addTranscription({ originator: 'bot', messages: [{ text: 'hello' }] });
		vi.advanceTimersByTime(500);
		store.addTranscription({ originator: 'bot', messages: [{ text: 'hello' }] });
		expect(store.getState().transcript).toHaveLength(1);

		vi.advanceTimersByTime(1001);
		store.addTranscription({ originator: 'bot', messages: [{ text: 'hello' }] });
		expect(store.getState().transcript).toHaveLength(2);
	});

	it('does not dedupe across originators and gives messages unique ids', () => {
		store.addTranscription({ originator: 'bot', messages: [{ text: 'hi' }, { text: 'there' }] });
		store.addTranscription({ originator: 'user', messages: [{ text: 'hi' }] });
		const { transcript } = store.getState();
		expect(transcript.map((m) => m.originator)).toEqual(['bot', 'bot', 'user']);
		expect(new Set(transcript.map((m) => m.id)).size).toBe(3);
	});

	it('emits once per transcription batch and nothing when all messages are duplicates', () => {
		const spy = vi.fn();
		store.addTranscription({ originator: 'bot', messages: [{ text: 'a' }, { text: 'b' }] });
		store.on(COGNIGY_WEBRTC_EVENTS.STATE_CHANGED, spy);
		store.addTranscription({ originator: 'bot', messages: [{ text: 'c' }, { text: 'd' }] });
		expect(spy).toHaveBeenCalledTimes(1);
		store.addTranscription({ originator: 'bot', messages: [{ text: 'c' }] });
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('ignores a transcription payload without messages', () => {
		expect(() => store.addTranscription({ originator: 'bot' } as any)).not.toThrow();
		expect(store.getState().transcript).toEqual([]);
	});

	it('clears transcript and endInfo on startCall', () => {
		store.addTranscription({ originator: 'user', messages: [{ text: 'x' }] });
		store.update({
			status: 'ended',
			muted: true,
			endInfo: { originator: 'remote', cause: 'BYE' },
			remoteStream: {} as MediaStream,
			localStream: {} as MediaStream,
		});

		store.update({ session: { id: 's1' } as any });
		store.startCall();

		expect(store.getState()).toMatchObject({
			status: 'connecting',
			session: null,
			muted: false,
			endInfo: null,
			transcript: [],
			remoteStream: null,
			localStream: null,
		});
	});
	it('publishes frozen snapshots that callers cannot mutate', () => {
		store.addTranscription({ originator: 'bot', messages: [{ text: 'hi' }] });
		const snapshot = store.getState() as any;

		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.transcript)).toBe(true);
		expect(Object.isFrozen(snapshot.transcript[0])).toBe(true);
		expect(() => {
			snapshot.status = 'answered';
		}).toThrow(TypeError);
		expect(() => snapshot.transcript.push({ id: 'x', text: 'y', originator: 'user', timestamp: 0 })).toThrow(TypeError);
		expect(() => {
			snapshot.transcript[0].text = 'changed';
		}).toThrow(TypeError);

		expect(store.getState().status).toBe('idle');
		expect(store.getState().transcript.map((m) => m.text)).toEqual(['hi']);
	});

	it('freezes the initial state and every update', () => {
		expect(Object.isFrozen(store.getState())).toBe(true);
		expect(Object.isFrozen(store.getState().transcript)).toBe(true);
		store.update({ status: 'ringing' });
		expect(Object.isFrozen(store.getState())).toBe(true);
		store.startCall();
		expect(Object.isFrozen(store.getState())).toBe(true);
		expect(Object.isFrozen(store.getState().transcript)).toBe(true);
	});
});
