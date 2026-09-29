/**
 * Immutable call state snapshot store. Every change replaces the state
 * object and emits `stateChanged`. Snapshots, their transcript and its
 * messages are frozen so consumers cannot corrupt the store.
 */

import { SDKEventEmitter, COGNIGY_WEBRTC_EVENTS } from './utils/events.js';
import { randomId } from './utils/helpers.js';
import type { ClientState, TranscriptMessage } from './types/index.js';

const TRANSCRIPT_DEDUPE_WINDOW_MS = 1000;

const freeze = (state: ClientState): ClientState => {
	if (!Object.isFrozen(state.transcript)) {
		const transcript = state.transcript.map((m) => (Object.isFrozen(m) ? m : Object.freeze({ ...m })));
		state = { ...state, transcript: Object.freeze(transcript) };
	}
	return Object.freeze(state);
};

const initialState = (): ClientState =>
	freeze({
		status: 'idle',
		muted: false,
		session: null,
		endInfo: null,
		transcript: [],
		remoteStream: null,
		localStream: null,
	});

export class CallStateStore extends SDKEventEmitter {
	private state: ClientState = initialState();

	getState(): ClientState {
		return this.state;
	}

	update(patch: Partial<ClientState>): void {
		const changed = (Object.keys(patch) as (keyof ClientState)[]).some(
			(key) => !Object.is(this.state[key], patch[key])
		);
		if (!changed) {
			return;
		}
		this.state = freeze({ ...this.state, ...patch });
		this.emit(COGNIGY_WEBRTC_EVENTS.STATE_CHANGED, this.state);
	}

	startCall(): void {
		this.update({
			status: 'connecting',
			muted: false,
			session: null,
			endInfo: null,
			transcript: [],
			remoteStream: null,
			localStream: null,
		});
	}

	addTranscription(t: { originator: TranscriptMessage['originator']; messages?: { text: string }[] }): void {
		const now = Date.now();
		const transcript: TranscriptMessage[] = [...this.state.transcript];
		// Runs inside JsSIP's INFO handler: a malformed payload must not throw
		for (const { text } of t.messages ?? []) {
			const duplicate = transcript.some(
				(m) =>
					m.text === text &&
					m.originator === t.originator &&
					Math.abs(now - m.timestamp) < TRANSCRIPT_DEDUPE_WINDOW_MS
			);
			if (!duplicate) {
				transcript.push({ id: randomId('msg'), text, originator: t.originator, timestamp: now });
			}
		}
		if (transcript.length !== this.state.transcript.length) {
			this.update({ transcript });
		}
	}
}
