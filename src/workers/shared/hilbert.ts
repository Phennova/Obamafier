/**
 * 3D Hilbert Curve encoding.
 * Maps (x, y, z) each in [0, 2^order - 1] to a single integer index
 * that preserves spatial locality.
 *
 * Based on the Butz algorithm for N-dimensional Hilbert curves.
 */

/**
 * Convert (x, y, z) to a Hilbert curve index at the given order.
 * For order=8, each coordinate is in [0, 255].
 * Returns a BigInt since order=8 gives indices up to 2^24.
 *
 * We use a simpler approach: interleave bits with Gray code transforms.
 */
export function hilbert3D(x: number, y: number, z: number, order: number = 8): number {
  // We use a lookup-table-free approach based on the recursive definition
  let rx: number, ry: number, rz: number;
  let d = 0;
  let coords = [x, y, z];

  for (let s = order - 1; s >= 0; s--) {
    const mask = 1 << s;
    const bits = [
      (coords[0] & mask) ? 1 : 0,
      (coords[1] & mask) ? 1 : 0,
      (coords[2] & mask) ? 1 : 0,
    ];

    // Convert to Gray code index
    const grayIdx = bits[0] * 4 + bits[1] * 2 + bits[2];

    // Map Gray code to Hilbert index using lookup
    const hilbertIdx = GRAY_TO_HILBERT[grayIdx];
    d = d * 8 + hilbertIdx;

    // Rotate/flip coordinates for next level
    rotateCoords(coords, s, bits);
  }

  return d;
}

// Lookup: Gray code index → Hilbert curve index for 3D
// This mapping ensures locality preservation
const GRAY_TO_HILBERT = [0, 1, 3, 2, 7, 6, 4, 5];

function rotateCoords(coords: number[], s: number, bits: number[]): void {
  const mask = (1 << s) - 1;

  // Apply transforms based on position in the curve
  if (bits[2] === 0) {
    if (bits[1] === 1) {
      coords[0] = mask - coords[0];
      coords[1] = mask - coords[1];
    }
    // Swap x and z
    const temp = coords[0];
    coords[0] = coords[2];
    coords[2] = temp;
  }
}

/**
 * Compute Hilbert indices for an array of LAB colors.
 * LAB values are normalized to [0, 255] range for the curve.
 */
export function computeHilbertIndices(
  labColors: Float32Array,
  pixelCount: number
): Float64Array {
  const indices = new Float64Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 3;
    // Normalize LAB to [0, 255]
    const L = Math.round(Math.min(255, Math.max(0, labColors[offset] * 2.55)));
    const a = Math.round(Math.min(255, Math.max(0, labColors[offset + 1] + 128)));
    const b = Math.round(Math.min(255, Math.max(0, labColors[offset + 2] + 128)));

    indices[i] = hilbert3D(L, a, b);
  }

  return indices;
}
