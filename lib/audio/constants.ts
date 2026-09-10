/**
 * Audio provider registry: metadata for the TTS/ASR providers this platform
 * serves. Trimmed to ElevenLabs, this platform's sole voice provider for the
 * MVP — see types.ts for the "how to add a provider" steps.
 *
 * Model ids and the voice catalog were verified live against ElevenLabs'
 * current docs and API (not assumed from general knowledge): `POST
 * /v1/text-to-speech/{voice_id}` defaults to `eleven_multilingual_v2`
 * ("most stable on long-form generations", explicit Hindi support among its
 * 29 languages); `POST /v1/speech-to-text` currently runs on `scribe_v2`
 * ("90+ languages", word-level timestamps). Voice ids below were pulled from
 * `GET /v2/voices` on the account this was built against.
 */

import type { ASRProviderConfig, ASRProviderId, TTSProviderConfig, TTSProviderId } from './types';

export const TTS_PROVIDERS: Record<TTSProviderId, TTSProviderConfig> = {
  'elevenlabs-tts': {
    id: 'elevenlabs-tts',
    name: 'ElevenLabs',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.elevenlabs.io/v1',
    models: [
      { id: 'eleven_multilingual_v2', name: 'Multilingual v2' },
      { id: 'eleven_flash_v2_5', name: 'Flash v2.5' },
      { id: 'eleven_v3', name: 'v3' },
    ],
    defaultModelId: 'eleven_multilingual_v2',
    // Premade voices from the account's /v2/voices catalog. All of ElevenLabs'
    // premade voices can speak any of the multilingual model's ~29 languages
    // (including Hindi) regardless of the voice's native recording accent —
    // "language" here is the voice's labeled accent, not a restriction.
    voices: [
      {
        id: 'Xb7hH8MSUJpSbSDYk0k2',
        name: 'Alice',
        language: 'en-GB',
        gender: 'female',
        description: 'Clear, engaging educator voice — good default for a lead teacher.',
      },
      {
        id: 'onwK4e9ZLuTAKqWW03F9',
        name: 'Daniel',
        language: 'en-GB',
        gender: 'male',
        description: 'Steady, formal broadcaster voice — good default for a teaching assistant.',
      },
      {
        id: 'XrExE9yKIg1WjnnlVkGX',
        name: 'Matilda',
        language: 'en-US',
        gender: 'female',
        description: 'Knowledgeable, upbeat voice suited for lectures.',
      },
      {
        id: 'EXAVITQu4vr4xnSDxMaL',
        name: 'Sarah',
        language: 'en-US',
        gender: 'female',
        description: 'Mature, confident, reassuring narration voice.',
      },
      {
        id: 'CwhRBWXzGAHq8TQ4Fs17',
        name: 'Roger',
        language: 'en-US',
        gender: 'male',
        description: 'Laid-back but resonant voice for a friendlier tone.',
      },
    ],
    supportedFormats: ['mp3', 'wav', 'pcm', 'opus', 'ulaw', 'alaw'],
    speedRange: { min: 0.7, max: 1.2, default: 1.0 },
  },
};

export const ASR_PROVIDERS: Record<ASRProviderId, ASRProviderConfig> = {
  'elevenlabs-asr': {
    id: 'elevenlabs-asr',
    name: 'ElevenLabs Scribe',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.elevenlabs.io/v1',
    models: [{ id: 'scribe_v2', name: 'Scribe v2' }],
    defaultModelId: 'scribe_v2',
    // 'auto' lets Scribe detect the language; explicit ISO-639-1/3 codes
    // improve accuracy for known-language audio (verified live for 'hi').
    supportedLanguages: ['auto', 'en', 'hi'],
    supportedFormats: ['mp3', 'wav', 'webm', 'ogg', 'flac', 'm4a'],
  },
};

export function getTTSProvider(id: TTSProviderId): TTSProviderConfig | undefined {
  return TTS_PROVIDERS[id];
}

export function getAllTTSProviders(): TTSProviderConfig[] {
  return Object.values(TTS_PROVIDERS);
}

export function getTTSVoices(id: TTSProviderId) {
  return TTS_PROVIDERS[id]?.voices ?? [];
}

export function getASRProvider(id: ASRProviderId): ASRProviderConfig | undefined {
  return ASR_PROVIDERS[id];
}

export function getAllASRProviders(): ASRProviderConfig[] {
  return Object.values(ASR_PROVIDERS);
}

export function getASRSupportedLanguages(id: ASRProviderId): string[] {
  return ASR_PROVIDERS[id]?.supportedLanguages ?? [];
}
