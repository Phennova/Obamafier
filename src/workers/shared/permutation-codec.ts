/**
 * Encode/decode a permutation as a compact base64 string.
 * Uses delta encoding + simple RLE-like compression.
 */

/**
 * Encode a permutation (inverse assignment) to a compact string.
 * Format: width,height|base64(compressed_deltas)
 */
export function encodePermutation(inversePerm: Uint32Array, width: number, height: number): string {
  // Delta-encode: store differences between consecutive values
  // Hilbert-matched permutations have structured deltas that compress well
  const deltas = new Int32Array(inversePerm.length);
  deltas[0] = inversePerm[0];
  for (let i = 1; i < inversePerm.length; i++) {
    deltas[i] = inversePerm[i] - inversePerm[i - 1];
  }

  // Convert to bytes (variable-length encoding)
  const bytes = varintEncode(deltas);

  // Base64 encode
  const base64 = bytesToBase64(bytes);

  return `${width},${height}|${base64}`;
}

/**
 * Decode a permutation string back to a Uint32Array.
 */
export function decodePermutation(encoded: string): { inversePerm: Uint32Array; width: number; height: number } {
  const pipeIdx = encoded.indexOf('|');
  if (pipeIdx === -1) throw new Error('Invalid key format');

  const [dims, base64] = [encoded.substring(0, pipeIdx), encoded.substring(pipeIdx + 1)];
  const [width, height] = dims.split(',').map(Number);
  const n = width * height;

  const bytes = base64ToBytes(base64);
  const deltas = varintDecode(bytes, n);

  // Undo delta encoding
  const inversePerm = new Uint32Array(n);
  inversePerm[0] = deltas[0];
  for (let i = 1; i < n; i++) {
    inversePerm[i] = inversePerm[i - 1] + deltas[i];
  }

  return { inversePerm, width, height };
}

// Variable-length integer encoding (zigzag + varint)
function varintEncode(values: Int32Array): Uint8Array {
  const buf = new Uint8Array(values.length * 5); // max 5 bytes per value
  let pos = 0;

  for (let i = 0; i < values.length; i++) {
    // Zigzag encode (maps negatives to positives: 0→0, -1→1, 1→2, -2→3, ...)
    let v = (values[i] << 1) ^ (values[i] >> 31);

    // Varint encode
    while (v > 0x7f) {
      buf[pos++] = (v & 0x7f) | 0x80;
      v >>>= 7;
    }
    buf[pos++] = v & 0x7f;
  }

  return buf.slice(0, pos);
}

function varintDecode(bytes: Uint8Array, count: number): Int32Array {
  const values = new Int32Array(count);
  let pos = 0;

  for (let i = 0; i < count; i++) {
    let v = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const b = bytes[pos++];
      v |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    // Zigzag decode
    values[i] = (v >>> 1) ^ -(v & 1);
  }

  return values;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
