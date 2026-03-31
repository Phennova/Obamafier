export interface PixelData {
  /** Raw RGBA buffer */
  rgba: Uint8ClampedArray;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

export interface LABPixel {
  L: number;
  a: number;
  b: number;
}

export interface AssignmentResult {
  /** assignment[sourceIndex] = targetIndex */
  assignment: Uint32Array;
  /** Total color distance (sum of squared LAB distances) */
  totalCost: number;
}

export interface AnimationConfig {
  /** Duration in seconds */
  duration: number;
  /** Easing function name */
  easing: 'linear' | 'cubic' | 'exponential';
  /** Max stagger delay (0-1) */
  staggerAmount: number;
  /** Bezier curvature magnitude */
  curvature: number;
}

export interface ProcessingProgress {
  phase: 'preprocessing' | 'hilbert' | 'refining' | 'ready';
  progress: number; // 0-1
  message: string;
}

export type Resolution = number;

export type QualityPreset = 'draft' | 'medium' | 'high' | 'ultra';

export const QUALITY_SWAP_ITERATIONS: Record<QualityPreset, number> = {
  draft: 500_000,
  medium: 2_000_000,
  high: 5_000_000,
  ultra: 15_000_000,
};
