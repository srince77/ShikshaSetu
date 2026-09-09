/**
 * Audio player used by the playback engine to play narration for `speech`
 * actions. `SpeechAction.audioId` is an opaque `AssetRef` (see
 * `packages/dsl/src/storage.ts`); resolving it to bytes is the job of a
 * `StorageProvider`, which this phase does not have yet (that seam is
 * `@shikshasetu/storage`, built separately). Until that package exists, a ref
 * that already looks like a playable URL (http(s)/blob/data) is played
 * directly; anything else resolves to "no audio", and the playback engine's
 * existing browser-TTS / reading-timer fallback takes over — this is the
 * intended degradation path, not a gap to paper over.
 */
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioPlayer');

function isPlayableUrl(ref: string): boolean {
  return /^(https?:|blob:|data:)/.test(ref);
}

export class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private onEndedCallback: (() => void) | null = null;
  private muted = false;
  private volume = 1;
  private playbackRate = 1;
  private requestToken = 0;

  private stopAudioElement(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
  }

  /**
   * Play audio for a speech reference. Returns true if audio started
   * playing, false if there is nothing playable (caller falls back to TTS or
   * a reading-time dwell).
   */
  public async play(audioId: string, legacyUrl?: string): Promise<boolean> {
    const requestToken = ++this.requestToken;
    try {
      const src = isPlayableUrl(audioId) ? audioId : legacyUrl && isPlayableUrl(legacyUrl) ? legacyUrl : null;
      if (!src) return false;

      this.stopAudioElement();
      if (requestToken !== this.requestToken) return false;

      this.audio = new Audio();
      this.audio.src = src;
      this.audio.volume = this.muted ? 0 : this.volume;
      this.audio.defaultPlaybackRate = this.playbackRate;
      this.audio.playbackRate = this.playbackRate;

      this.audio.addEventListener('ended', () => {
        this.onEndedCallback?.();
      });

      try {
        await this.audio.play();
      } catch (playError) {
        throw playError;
      }
      if (requestToken !== this.requestToken) return false;
      this.audio.playbackRate = this.playbackRate;
      return true;
    } catch (error) {
      log.error('Failed to play audio:', error);
      throw error;
    }
  }

  public pause(): void {
    this.requestToken += 1;
    if (this.audio && !this.audio.paused) this.audio.pause();
  }

  public stop(): void {
    this.requestToken += 1;
    this.stopAudioElement();
    // onEndedCallback intentionally not cleared: play() calls stop()
    // internally, clearing here would break the callback chain. Stale
    // callbacks are harmless — the engine's mode/generation guard prevents a
    // spurious processNext.
  }

  public resume(): void {
    if (this.audio?.paused) {
      this.audio.playbackRate = this.playbackRate;
      this.audio.play().catch((error) => log.error('Failed to resume audio:', error));
    }
  }

  public isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused;
  }

  public hasActiveAudio(): boolean {
    return this.audio !== null;
  }

  public getCurrentTime(): number {
    return this.audio ? this.audio.currentTime * 1000 : 0;
  }

  public getDuration(): number {
    return this.audio && !isNaN(this.audio.duration) ? this.audio.duration * 1000 : 0;
  }

  public onEnded(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio) this.audio.volume = muted ? 0 : this.volume;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio && !this.muted) this.audio.volume = this.volume;
  }

  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2, rate));
    if (this.audio) this.audio.playbackRate = this.playbackRate;
  }

  public destroy(): void {
    this.stop();
    this.onEndedCallback = null;
  }
}

export function createAudioPlayer(): AudioPlayer {
  return new AudioPlayer();
}
