/**
 * Playback-relevant user settings (TTS only, for this phase). A lean
 * stand-in for the reference app's much larger settings store (model/API-key
 * configuration, UI preferences, etc., mostly out of scope here) — extend
 * this rather than reintroducing a mega-store.
 */
import { create } from 'zustand';
import { BROWSER_NATIVE_TTS_PROVIDER_ID } from '@/lib/audio/provider-enablement';

interface SettingsState {
  ttsEnabled: boolean;
  ttsProviderId: string;
  ttsSpeed: number;
  ttsVolume: number;
  ttsMuted: boolean;
  ttsVoice: string;
  ttsProvidersConfig: Record<string, { apiKey?: string; baseUrl?: string; enabled?: boolean }>;

  setTtsEnabled: (enabled: boolean) => void;
  setTtsMuted: (muted: boolean) => void;
  setTtsVolume: (volume: number) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ttsEnabled: true,
  ttsProviderId: BROWSER_NATIVE_TTS_PROVIDER_ID,
  ttsSpeed: 1,
  ttsVolume: 1,
  ttsMuted: false,
  ttsVoice: 'default',
  ttsProvidersConfig: {},

  setTtsEnabled: (enabled) => set({ ttsEnabled: enabled }),
  setTtsMuted: (muted) => set({ ttsMuted: muted }),
  setTtsVolume: (volume) => set({ ttsVolume: volume }),
}));
