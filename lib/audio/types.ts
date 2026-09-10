/**
 * Audio Provider Type Definitions
 *
 * Unified types for TTS (Text-to-Speech) and ASR (Automatic Speech
 * Recognition), trimmed to this platform's sole voice provider for the
 * MVP: ElevenLabs (multilingual TTS + Scribe ASR). The provider-id union +
 * registry-metadata + switch-case + config shape is kept intact (see the
 * HOW TO ADD A NEW PROVIDER steps below) so a second provider can be added
 * later without a redesign.
 *
 * HOW TO ADD A NEW PROVIDER:
 *
 * Step 1: Add the provider id to TTSProviderId (or ASRProviderId) below.
 * Step 2: Add its metadata (name, models, voices, formats) to the
 *         TTS_PROVIDERS (or ASR_PROVIDERS) registry in constants.ts.
 * Step 3: Implement `generate<Provider>TTS` / `transcribe<Provider>ASR` in
 *         tts-providers.ts / asr-providers.ts, and add a case to the
 *         generateTTS() / transcribeAudio() switch.
 * Step 4: Add any i18n strings the UI needs for the new provider's name.
 */

// ============================================================================
// TTS (Text-to-Speech) Types
// ============================================================================

export type TTSProviderId = 'elevenlabs-tts';

/** Voice information for TTS */
export interface TTSVoiceInfo {
  id: string;
  name: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  description?: string;
}

/** TTS Provider Configuration */
export interface TTSProviderConfig {
  id: TTSProviderId;
  name: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  models: Array<{ id: string; name: string }>;
  defaultModelId: string;
  voices: TTSVoiceInfo[];
  supportedFormats: string[];
  speedRange?: { min: number; max: number; default: number };
}

/** TTS Model Configuration for API calls */
export interface TTSModelConfig {
  providerId: TTSProviderId;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  voice: string;
  speed?: number;
  format?: string;
  /** Cancel the provider request when this signal aborts. */
  signal?: AbortSignal;
}

// ============================================================================
// ASR (Automatic Speech Recognition) Types
// ============================================================================

export type ASRProviderId = 'elevenlabs-asr';

/** ASR Provider Configuration */
export interface ASRProviderConfig {
  id: ASRProviderId;
  name: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  models: Array<{ id: string; name: string }>;
  defaultModelId: string;
  supportedLanguages: string[];
  supportedFormats: string[];
}

/** ASR Model Configuration for API calls */
export interface ASRModelConfig {
  providerId: ASRProviderId;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  language?: string;
}
