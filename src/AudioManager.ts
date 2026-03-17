/**
 * Audio management for the WebRTC SDK
 * Handles custom audio events and remote audio streams
 */

import { SDKEventEmitter, COGNIGY_WEBRTC_EVENTS } from './utils/events.js';
import type { AudioState } from './types/internal.js';

export class AudioManager extends SDKEventEmitter {
	private state: AudioState = {
		remoteAudio: null,
		currentStream: null,
		captureAudio: false,
	};

	constructor() {
		super();
		this.initializeDefaultAudio();
	}

	/**
	 * Initialize default audio element for non-custom audio handling
	 */
	private initializeDefaultAudio(): void {
		if (typeof window === 'undefined') {
			console.warn('AudioManager: Window not available, skipping default audio initialization');
			return;
		}

		this.state.remoteAudio = new Audio();
		this.state.remoteAudio.autoplay = true;
		this.state.remoteAudio.volume = 1.0;

		// Set up audio element event listeners
		this.state.remoteAudio.onplaying = () => {
			console.log('Default audio started playing');
			this.emit('audioStarted');
		};

		this.state.remoteAudio.onpause = () => {
			console.log('Default audio paused');
			this.emit('audioPaused');
		};

		this.state.remoteAudio.onerror = (error) => {
			console.error('Default audio error:', error);
			this.emit(COGNIGY_WEBRTC_EVENTS.ERROR, new Error('Audio playback error'));
		};

		this.state.remoteAudio.onended = () => {
			console.log('Default audio ended');
			this.emit('audioEnded');
		};
	}

	/**
	 * Handle incoming remote audio stream
	 */
	handleRemoteStream(stream: MediaStream): void {
		console.log('AudioManager: Handling remote stream', stream);
		this.state.currentStream = stream;
		this.playDefaultAudio(stream);
		if (this.state.captureAudio) {
			this.emit(COGNIGY_WEBRTC_EVENTS.CAPTURE_AUDIO, stream);
		}
	}

	/**
	 * Play audio using default audio element
	 */
	private playDefaultAudio(stream: MediaStream): void {
		if (!this.state.remoteAudio) {
			console.warn('AudioManager: Default audio element not initialized');
			return;
		}
		const audioTracks = stream.getAudioTracks();
		if (audioTracks.length === 0) {
			console.warn('AudioManager: Stream has no audio tracks, skipping audio setup');
			return;
		}

		try {
			this.state.remoteAudio.srcObject = stream;

			const playPromise = this.state.remoteAudio.play();
			if (playPromise instanceof Promise) {
				playPromise
					.then(() => {
						console.log('AudioManager: Default audio started successfully');
					})
					.catch((error) => {
						console.error('AudioManager: Failed to start default audio:', error);
						this.emit(COGNIGY_WEBRTC_EVENTS.ERROR, new Error(`Audio playback failed: ${error.message}`));
					});
			}
		} catch (error) {
			console.error('AudioManager: Error setting up default audio:', error);
			this.emit(COGNIGY_WEBRTC_EVENTS.ERROR, new Error(`Audio setup failed: ${error}`));
		}
	}

	/**
	 * Stop current audio playback
	 */
	stopAudio(): void {
		console.log('AudioManager: Stopping audio');

		if (this.state.remoteAudio && typeof this.state.remoteAudio.pause === 'function') {
			this.state.remoteAudio.pause();
			this.state.remoteAudio.srcObject = null;
		}

		if (this.state.currentStream) {
			// Stop all tracks in the stream
			this.state.currentStream.getTracks().forEach(track => {
				track.stop();
			});
			this.state.currentStream = null;
		}

		this.emit(COGNIGY_WEBRTC_EVENTS.AUDIO_ENDED);
	}

	/**
	 * Set audio volume
	 */
	setVolume(volume: number): void {
		if (volume < 0 || volume > 1 || Number.isNaN(volume)) {
			throw new Error('Volume must be between 0 and 1');
		}

		if (this.state.remoteAudio && typeof this.state.remoteAudio.volume !== 'undefined') {
			this.state.remoteAudio.volume = volume;
		}
	}

	/**
	 * Get current volume
	 */
	getVolume(): number {
		if (this.state.remoteAudio && typeof this.state.remoteAudio.volume !== 'undefined') {
			return this.state.remoteAudio.volume;
		}
		return 1;
	}

	/**
	 * Mute/unmute audio
	 */
	setMuted(muted: boolean): void {
		if (this.state.remoteAudio && typeof this.state.remoteAudio.muted !== 'undefined') {
			this.state.remoteAudio.muted = muted;
		}
	}

	/**
	 * Check if audio is muted
	 */
	isMuted(): boolean {
		if (this.state.remoteAudio && typeof this.state.remoteAudio.muted !== 'undefined') {
			return this.state.remoteAudio.muted;
		}
		return false;
	}

	/**
	 * Get current audio stream
	 */
	getCurrentStream(): MediaStream | null {
		return this.state.currentStream;
	}

	/**
	 * Enable or disable capture audio event emission
	 */
	setCaptureAudio(enabled: boolean): void {
		this.state.captureAudio = enabled;
	}


	/**
	 * Get audio state information
	 */
	getState(): {
		hasRemoteAudio: boolean;
		hasCurrentStream: boolean;
		volume: number;
		muted: boolean;
	} {
		return {
			hasRemoteAudio: !!this.state.remoteAudio,
			hasCurrentStream: !!this.state.currentStream,
			volume: this.getVolume(),
			muted: this.isMuted(),
		};
	}

	/**
	 * Clean up audio resources
	 */
	destroy(): void {
		this.stopAudio();
		if (this.state.remoteAudio) {
			// Clean up native DOM event handlers
			this.state.remoteAudio.onplaying = null;
			this.state.remoteAudio.onpause = null;
			this.state.remoteAudio.onerror = null;
			this.state.remoteAudio.onended = null;

			this.state.remoteAudio = null;
		}
		this.removeAllListeners(COGNIGY_WEBRTC_EVENTS.AUDIO_ENDED);
		this.removeAllListeners(COGNIGY_WEBRTC_EVENTS.ERROR);
		this.removeAllListeners();
	}
}
