import { describe, it, expect, vi } from 'vitest';
import { SDKEventEmitter } from '../../../utils/events.js';

describe('SDKEventEmitter', () => {
	it('removeAllListeners() without an event removes every listener', () => {
		const emitter = new SDKEventEmitter();
		const a = vi.fn();
		emitter.on('a', a);
		emitter.on('b', vi.fn());

		emitter.removeAllListeners();
		emitter.emit('a');

		expect(a).not.toHaveBeenCalled();
		expect(emitter.listenerCount('a')).toBe(0);
		expect(emitter.listenerCount('b')).toBe(0);
	});

	it('removeAllListeners(event) removes only that event', () => {
		const emitter = new SDKEventEmitter();
		emitter.on('a', vi.fn());
		emitter.on('b', vi.fn());

		emitter.removeAllListeners('a');

		expect(emitter.listenerCount('a')).toBe(0);
		expect(emitter.listenerCount('b')).toBe(1);
	});
});
