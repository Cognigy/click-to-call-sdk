/**
 * Unit tests for AudioManager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioManager } from '../../AudioManager.js';
import { COGNIGY_WEBRTC_EVENTS } from '../../utils/events.js';

describe('AudioManager', () => {
	let audioManager: AudioManager;
	let mockMediaStream: MediaStream;

	beforeEach(() => {
		mockMediaStream = new MediaStream();
		vi.clearAllMocks();
	});

	describe('constructor', () => {
		it('should create AudioManager with default config', () => {
			audioManager = new AudioManager();

			expect(audioManager).toBeInstanceOf(AudioManager);
		});

		it('should initialize default audio', () => {
			audioManager = new AudioManager();

			const state = audioManager.getState();
			expect(state.hasRemoteAudio).toBe(true);
		});
	});

	describe('handleRemoteStream', () => {
		it('should store current stream', () => {
			audioManager = new AudioManager();

			audioManager.handleRemoteStream(mockMediaStream);

			expect(audioManager.getCurrentStream()).toBe(mockMediaStream);
		});
	});

	describe('stopAudio', () => {
		it('should stop current stream and emit audioEnded event', () => {
			audioManager = new AudioManager();
			const eventSpy = vi.fn();
			audioManager.on(COGNIGY_WEBRTC_EVENTS.AUDIO_ENDED, eventSpy);

			// Mock stream with tracks
			const mockTrack = { stop: vi.fn() };
			mockMediaStream.getTracks = vi.fn().mockReturnValue([mockTrack]);

			audioManager.handleRemoteStream(mockMediaStream);
			audioManager.stopAudio();

			expect(mockTrack.stop).toHaveBeenCalled();
			expect(audioManager.getCurrentStream()).toBeNull();
			expect(eventSpy).toHaveBeenCalled();
		});

		it('should handle stopping audio when no stream is active', () => {
			audioManager = new AudioManager();
			const eventSpy = vi.fn();
			audioManager.on(COGNIGY_WEBRTC_EVENTS.AUDIO_ENDED, eventSpy);

			audioManager.stopAudio();

			expect(eventSpy).toHaveBeenCalled();
		});
	});

	describe('volume control', () => {
		beforeEach(() => {
			audioManager = new AudioManager();
		});

		it('should set volume for audio', () => {
			audioManager.setVolume(0.5);
			expect(audioManager.getVolume()).toBe(0.5);
		});

		it('should throw error for invalid volume values', () => {
			expect(() => audioManager.setVolume(-0.1)).toThrow('Volume must be between 0 and 1');
			expect(() => audioManager.setVolume(1.1)).toThrow('Volume must be between 0 and 1');
		});
	});

	describe('mute control', () => {
		beforeEach(() => {
			audioManager = new AudioManager();
		});

		it('should mute and unmute audio', () => {
			audioManager.setMuted(true);
			expect(audioManager.isMuted()).toBe(true);

			audioManager.setMuted(false);
			expect(audioManager.isMuted()).toBe(false);
		});
	});


	describe('getState', () => {
		it('should return current audio state', () => {
			audioManager = new AudioManager();
			audioManager.handleRemoteStream(mockMediaStream);

			const state = audioManager.getState();

			expect(state).toEqual({
				hasRemoteAudio: true,
				hasCurrentStream: true,
				volume: 1,
				muted: false,
			});
		});
	});

	describe('destroy', () => {
		it('should clean up resources and remove listeners', () => {
			const audioManager = new AudioManager();
			const eventSpy = vi.fn();
			audioManager.on(COGNIGY_WEBRTC_EVENTS.AUDIO_ENDED, eventSpy);
	
			// Mock stream with tracks
			const mockTrack = { stop: vi.fn() };
			mockMediaStream.getTracks = vi.fn().mockReturnValue([mockTrack]);
			audioManager.handleRemoteStream(mockMediaStream);
	
			// Verify listener was added
			expect(audioManager.listenerCount(COGNIGY_WEBRTC_EVENTS.AUDIO_ENDED)).toBe(1);
	
			audioManager.destroy();
	
			expect(mockTrack.stop).toHaveBeenCalled();
			expect(audioManager.getCurrentStream()).toBeNull();
			console.log(audioManager,'audioManager');
			// Check that listeners were actually removed
			expect(audioManager.listenerCount(COGNIGY_WEBRTC_EVENTS.AUDIO_ENDED)).toBe(0);
		});
	});
});
