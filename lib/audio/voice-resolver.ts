/**
 * Voice resolution: which TTS provider + voice an agent speaks with.
 *
 * Drastically trimmed from the reference implementation, which resolves
 * across many user-configurable providers (enablement gating, custom
 * provider voices, voice clone profiles, browser-native). With exactly one
 * provider for the MVP, resolution collapses to "does this agent have a
 * pinned voice; otherwise pick one deterministically from the catalog" —
 * but the shape (a `ResolvedVoice` the caller feeds straight into
 * `generateTTS`) is kept so a second provider can slot in later without
 * callers changing.
 */

import type { TTSProviderId } from './types';
import { TTS_PROVIDERS } from './constants';
import type { AgentConfig } from '@/lib/orchestration/types';

export interface ResolvedVoice {
  providerId: TTSProviderId;
  modelId?: string;
  voiceId: string;
}

const DEFAULT_PROVIDER_ID: TTSProviderId = 'elevenlabs-tts';

/**
 * Resolve the voice an agent speaks with: its own pinned `voiceConfig` when
 * present and known, otherwise a deterministic pick from the catalog keyed
 * by the agent's position in the roster (so a fixed 2-3 agent classroom
 * gets stable, distinct voices across runs).
 */
export function resolveAgentVoice(agent: AgentConfig, agentIndex: number): ResolvedVoice {
  const pinned = agent.voiceConfig;
  const catalog = TTS_PROVIDERS[DEFAULT_PROVIDER_ID].voices;

  if (pinned?.voiceId?.trim() && catalog.some((v) => v.id === pinned.voiceId)) {
    return { providerId: DEFAULT_PROVIDER_ID, modelId: pinned.modelId, voiceId: pinned.voiceId };
  }

  const voice = catalog[agentIndex % catalog.length];
  return { providerId: DEFAULT_PROVIDER_ID, voiceId: voice.id };
}

/** Display name for a voice id, for UI/logging. */
export function findVoiceDisplayName(voiceId: string): string {
  const voice = TTS_PROVIDERS[DEFAULT_PROVIDER_ID].voices.find((v) => v.id === voiceId);
  return voice?.name ?? voiceId;
}
