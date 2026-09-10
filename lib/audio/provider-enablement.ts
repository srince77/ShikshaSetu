/**
 * TTS provider enablement — a small, framework-agnostic predicate for
 * "is this provider usable right now". A lean stand-in for the reference
 * app's full multi-provider registry (ElevenLabs and friends, with server
 * credential state), which is being built separately; this phase only needs
 * to know when the client-side browser-native fallback should take over.
 */
export const BROWSER_NATIVE_TTS_PROVIDER_ID = 'browser-native-tts' as const;

export interface TTSEnablementConfig {
  apiKey?: string;
  baseUrl?: string;
  enabled?: boolean;
  serverDisabled?: boolean;
  [key: string]: unknown;
}

/** Whether a provider may be used: browser-native always is; anything else
 * needs a truthy config and must not be explicitly disabled. */
export function isTTSProviderEnabled(
  providerId: string,
  config: TTSEnablementConfig | undefined,
): boolean {
  if (providerId === BROWSER_NATIVE_TTS_PROVIDER_ID) return config?.enabled !== false;
  if (config?.serverDisabled) return false;
  if (config?.enabled === false) return false;
  return !!(config?.apiKey || config?.baseUrl);
}
