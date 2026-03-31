import type { AnimationConfig, Resolution, QualityPreset } from './types.js';

export const DEFAULT_RESOLUTION: Resolution = 512;
export const DEFAULT_QUALITY: QualityPreset = 'high';

export const DEFAULT_ANIMATION: AnimationConfig = {
  duration: 3.0,
  easing: 'cubic',
  staggerAmount: 0.3,
  curvature: 0.4,
};

export const TARGET_IMAGE_FILENAME = 'obama.jpg';

export const IPC_CHANNELS = {
  LOAD_IMAGE: 'load-image',
  SELECT_IMAGE: 'select-image',
  PROCESS_IMAGES: 'process-images',
  PROCESSING_PROGRESS: 'processing-progress',
  EXPORT_FRAME: 'export-frame',
  GET_TARGET_PATH: 'get-target-path',
  SAVE_OBAMACRYPT: 'save-obamacrypt',
  READ_OBAMACRYPT: 'read-obamacrypt',
} as const;

export const OBAMACRYPT_META_KEY = 'obamacrypt_v1';

