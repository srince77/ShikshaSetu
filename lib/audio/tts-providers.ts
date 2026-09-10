/**
 * TTS (Text-to-Speech) Provider Implementation
 *
 * Factory pattern for routing TTS requests to provider implementations,
 * following the same architecture as lib/ai/providers.ts. Trimmed to
 * ElevenLabs — see types.ts for the "how to add a provider" steps this
 * keeps intact.
 *
 * ElevenLabs TTS: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 * Verified live: `POST /v1/text-to-speech/{voice_id}?output_format=...`,
 * `xi-api-key` header, JSON body `{ text, model_id, voice_settings }`,
 * binary audio response. Confirmed against a real Hindi request/response
 * round trip (see the ASR side for the matching Scribe transcription test).
 */

import type { TTSModelConfig } from './types';
import { TTS_PROVIDERS } from './constants';

/** Result of TTS generation */
export interface TTSGenerationResult {
  audio: Uint8Array;
  format: string;
}

/** Thrown when a TTS provider returns a rate-limit / concurrency-quota error. */
export class TTSRateLimitError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'TTSRateLimitError';
  }
}

/**
 * Per-request bound for one TTS provider call. Overridable via
 * `TTS_REQUEST_TIMEOUT_MS` (ms) for slower deployments; a hung provider
 * fails the call with this error instead of wedging the caller.
 */
const DEFAULT_TTS_REQUEST_TIMEOUT_MS = 30_000;

function ttsRequestTimeoutMs(): number {
  const raw = process.env.TTS_REQUEST_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTS_REQUEST_TIMEOUT_MS;
}

/** Thrown when a single TTS provider request exceeds {@link ttsRequestTimeoutMs}. */
export class TTSRequestTimeoutError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'TTSRequestTimeoutError';
  }
}

/** Combine the caller's cancel signal with the per-request timeout. */
function ttsRequestSignal(callerSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ttsRequestTimeoutMs());
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

function isTimeoutSignal(signal: AbortSignal): boolean {
  return (
    signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
  );
}

/** Map an upstream HTTP 429 to a typed {@link TTSRateLimitError}. */
export function throwIfTtsRateLimited(provider: string, status: number): void {
  if (status === 429) {
    throw new TTSRateLimitError(provider, `${provider} TTS rate limit exceeded (HTTP 429)`);
  }
}

/**
 * Generate speech using the configured TTS provider.
 *
 * The request is created with a signal combining the caller's cancel signal
 * (`config.signal`) with the per-request timeout, so a caller cancel aborts
 * the in-flight fetch within seconds and a hung provider fails with
 * {@link TTSRequestTimeoutError} instead of hanging forever.
 */
export async function generateTTS(
  config: TTSModelConfig,
  text: string,
): Promise<TTSGenerationResult> {
  const provider = TTS_PROVIDERS[config.providerId];

  if (provider?.requiresApiKey && !config.apiKey) {
    throw new Error(`API key required for TTS provider: ${config.providerId}`);
  }

  const signal = ttsRequestSignal(config.signal);
  try {
    switch (config.providerId) {
      case 'elevenlabs-tts':
        return await generateElevenLabsTTS(config, text, signal);
      default:
        throw new Error(`Unsupported TTS provider: ${config.providerId}`);
    }
  } catch (error) {
    // A caller cancel must propagate as-is so the enclosing run treats it as
    // an interruption, not a provider failure.
    if (config.signal?.aborted) throw error;
    if (isTimeoutSignal(signal)) {
      throw new TTSRequestTimeoutError(
        config.providerId,
        `TTS request timed out after ${ttsRequestTimeoutMs()}ms (provider ${config.providerId}) — the provider did not respond.`,
      );
    }
    throw error;
  }
}

/**
 * ElevenLabs TTS implementation (voice-specific endpoint, direct fetch).
 *
 * `speed` is clamped to ElevenLabs' documented voice_settings range
 * (0.7-1.2); `use_speaker_boost` is left on for the clearer classroom-
 * narration presence it gives at the cost of a little latency.
 */
async function generateElevenLabsTTS(
  config: TTSModelConfig,
  text: string,
  signal: AbortSignal,
): Promise<TTSGenerationResult> {
  const baseUrl = config.baseUrl || TTS_PROVIDERS['elevenlabs-tts'].defaultBaseUrl;
  const requestedFormat = config.format || 'mp3';
  const clampedSpeed = Math.min(1.2, Math.max(0.7, config.speed || 1.0));
  const outputFormatMap: Record<string, string> = {
    mp3: 'mp3_44100_128',
    opus: 'opus_48000_96',
    pcm: 'pcm_44100',
    wav: 'wav_44100',
    ulaw: 'ulaw_8000',
    alaw: 'alaw_8000',
  };
  const outputFormat = outputFormatMap[requestedFormat] || outputFormatMap.mp3;

  const response = await fetch(
    `${baseUrl}/text-to-speech/${encodeURIComponent(config.voice)}?output_format=${outputFormat}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': config.apiKey!,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        text,
        model_id: config.modelId || 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed: clampedSpeed,
          use_speaker_boost: true,
        },
      }),
      signal,
    },
  );

  if (!response.ok) {
    throwIfTtsRateLimited('ElevenLabs', response.status);
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`ElevenLabs TTS API error: ${errorText || response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    audio: new Uint8Array(arrayBuffer),
    format: requestedFormat,
  };
}

// Re-export from constants for convenience
export { getAllTTSProviders, getTTSProvider, getTTSVoices } from './constants';
