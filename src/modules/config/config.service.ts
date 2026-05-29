// Config storage service - load, save, and provide defaults for ExtensionConfig

import { ExtensionConfig } from '@shared/types';
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  DEFAULT_AUDIO_CHUNK_SIZE_MS,
} from '@shared/constants';
import { validateConfig } from './config.validator';

const STORAGE_KEY = 'config';

export function getDefaults(): ExtensionConfig {
  return {
    serverHost: DEFAULT_SERVER_HOST,
    serverPort: DEFAULT_SERVER_PORT,
    modelPath: 'sherpa-onnx-streaming-zipformer-en-2023-06-21',
    audioChunkSizeMs: DEFAULT_AUDIO_CHUNK_SIZE_MS,
  };
}

export async function loadConfig(): Promise<ExtensionConfig> {
  const defaults = getDefaults();
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<ExtensionConfig> | undefined;
  if (!stored) return defaults;
  return { ...defaults, ...stored };
}

export async function saveConfig(
  partial: Partial<ExtensionConfig>
): Promise<{ success: boolean; errors?: Record<string, string> }> {
  const validation = validateConfig(partial as Record<string, unknown>);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }
  const current = await loadConfig();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  return { success: true };
}
