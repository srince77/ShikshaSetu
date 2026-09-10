/**
 * ASR (Automatic Speech Recognition) Provider Implementation
 *
 * Factory pattern for routing ASR requests to provider implementations,
 * following the same architecture as lib/ai/providers.ts. Trimmed to
 * ElevenLabs Scribe — see types.ts for the "how to add a provider" steps.
 *
 * ElevenLabs Speech-to-Text: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 * Verified live: `POST /v1/speech-to-text`, multipart/form-data, `xi-api-key`
 * header, fields `model_id` (currently `scribe_v2`), `file`, optional
 * `language_code`. JSON response carries `text`, `language_code`,
 * `language_probability`, and a `words` array. Round-tripped against a real
 * Hindi TTS clip: the transcription matched the source text almost exactly
 * (near-1.0 language_probability for `hin`), at roughly 1s for an 8s clip.
 */

import type { ASRModelConfig } from './types';
import { ASR_PROVIDERS } from './constants';

/** Result of ASR transcription */
export interface ASRTranscriptionResult {
  text: string;
}

/** Transcribe audio using the configured ASR provider. */
export async function transcribeAudio(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const provider = ASR_PROVIDERS[config.providerId];

  if (provider?.requiresApiKey && !config.apiKey) {
    throw new Error(`API key required for ASR provider: ${config.providerId}`);
  }

  switch (config.providerId) {
    case 'elevenlabs-asr':
      return await transcribeElevenLabsASR(config, audioBuffer);
    default:
      throw new Error(`Unsupported ASR provider: ${config.providerId}`);
  }
}

async function toAudioBlob(audioBuffer: Buffer | Blob): Promise<Blob> {
  if (audioBuffer instanceof Blob) {
    return audioBuffer;
  }
  const arrayBuffer = audioBuffer.buffer.slice(
    audioBuffer.byteOffset,
    audioBuffer.byteOffset + audioBuffer.byteLength,
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: 'audio/webm' });
}

/**
 * ElevenLabs Scribe implementation (multipart upload, direct fetch).
 *
 * `language_code` is only sent when the caller pins a known language —
 * omitting it lets Scribe auto-detect, which the live test above confirmed
 * works well even for short clips.
 */
async function transcribeElevenLabsASR(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const baseUrl = (config.baseUrl || ASR_PROVIDERS['elevenlabs-asr'].defaultBaseUrl || '').replace(
    /\/$/,
    '',
  );

  const audioBlob = await toAudioBlob(audioBuffer);
  const formData = new FormData();
  formData.set('model_id', config.modelId || 'scribe_v2');
  formData.set('file', audioBlob, 'audio.webm');
  if (config.language && config.language !== 'auto') {
    formData.set('language_code', config.language);
  }

  const response = await fetch(`${baseUrl}/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': config.apiKey! },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`ElevenLabs ASR API error: ${errorText || response.statusText}`);
  }

  const data = (await response.json()) as { text?: unknown };
  return { text: typeof data.text === 'string' ? data.text : '' };
}

// Re-export from constants for convenience
export { getAllASRProviders, getASRProvider, getASRSupportedLanguages } from './constants';
