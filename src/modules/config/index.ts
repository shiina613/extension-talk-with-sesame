// Config module - Extension configuration and validation
// Public API

export {
  validatePort,
  validateHost,
  validateAudioChunkSizeMs,
  validateModelPath,
  validateConfig,
} from './config.validator';

export type { ValidationResult, ConfigValidationResult } from './config.validator';

export { getDefaults, loadConfig, saveConfig } from './config.service';
