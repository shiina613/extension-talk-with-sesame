// Config validation - pure functions for validating ExtensionConfig fields

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export function validatePort(value: unknown): ValidationResult {
  if (typeof value !== 'number') return { valid: false, error: 'Port must be a number' };
  if (!Number.isInteger(value)) return { valid: false, error: 'Port must be an integer' };
  if (value < 1 || value > 65535) return { valid: false, error: 'Port must be between 1 and 65535' };
  return { valid: true };
}

export function validateHost(value: unknown): ValidationResult {
  if (typeof value !== 'string') return { valid: false, error: 'Host must be a string' };
  if (value.trim() === '') return { valid: false, error: 'Host must not be empty' };
  return { valid: true };
}

export function validateAudioChunkSizeMs(value: unknown): ValidationResult {
  if (typeof value !== 'number') return { valid: false, error: 'Audio chunk size must be a number' };
  if (!Number.isInteger(value)) return { valid: false, error: 'Audio chunk size must be an integer' };
  if (value < 100 || value > 2000) return { valid: false, error: 'Audio chunk size must be between 100 and 2000 ms' };
  return { valid: true };
}

export function validateModelPath(value: unknown): ValidationResult {
  if (typeof value !== 'string') return { valid: false, error: 'Model path must be a string' };
  if (value.trim() === '') return { valid: false, error: 'Model path must not be empty' };
  return { valid: true };
}

const FIELD_VALIDATORS: Record<string, (value: unknown) => ValidationResult> = {
  serverHost: validateHost,
  serverPort: validatePort,
  audioChunkSizeMs: validateAudioChunkSizeMs,
  modelPath: validateModelPath,
};

export function validateConfig(partial: Record<string, unknown>): ConfigValidationResult {
  const errors: Record<string, string> = {};

  for (const [field, value] of Object.entries(partial)) {
    const validator = FIELD_VALIDATORS[field];
    if (!validator) continue;

    const result = validator(value);
    if (!result.valid && result.error) {
      errors[field] = result.error;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
