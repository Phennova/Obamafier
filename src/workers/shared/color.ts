/**
 * RGB to CIELAB color space conversion.
 * Uses D65 illuminant reference white.
 */

// D65 reference white
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

function srgbToLinear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function labF(t: number): number {
  const delta = 6 / 29;
  return t > delta * delta * delta
    ? Math.cbrt(t)
    : t / (3 * delta * delta) + 4 / 29;
}

/**
 * Convert RGB (0-255) to CIELAB.
 * Returns [L, a, b] where L in [0,100], a/b in [-128,127] approx.
 */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  // sRGB → linear RGB → XYZ
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;

  // XYZ → Lab
  const fx = labF(x / Xn);
  const fy = labF(y / Yn);
  const fz = labF(z / Zn);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);

  return [L, a, bVal];
}

/**
 * Extract all pixels from an RGBA buffer and convert to packed LAB Float32Array.
 * Returns Float32Array of [L0, a0, b0, L1, a1, b1, ...].
 */
export function rgbaBufferToLab(rgba: Uint8ClampedArray | number[], pixelCount: number): Float32Array {
  const lab = new Float32Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const [L, a, b] = rgbToLab(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
    lab[i * 3] = L;
    lab[i * 3 + 1] = a;
    lab[i * 3 + 2] = b;
  }
  return lab;
}
