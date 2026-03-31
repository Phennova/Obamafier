/**
 * Seeded PRNG and deterministic permutation for Obamacryption.
 *
 * Key → SHA-256 hash → seed for xorshift128+ → Fisher-Yates shuffle
 * The same key always produces the same permutation.
 */

/**
 * Simple hash function that works in Web Workers (no SubtleCrypto needed).
 * Produces 4 x 32-bit values from a string key.
 */
function hashKey(key: string): [number, number, number, number] {
  // FNV-1a inspired multi-round hash to produce 128 bits
  const seeds: number[] = [0x811c9dc5, 0xc4ceb9fe, 0xa2b3c4d5, 0x12345678];

  for (let round = 0; round < 4; round++) {
    let h = seeds[round];
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
      h ^= h >>> 16;
    }
    // Mix in round number for independence
    h ^= round * 0x9e3779b9;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    seeds[round] = h >>> 0; // ensure unsigned
  }

  return seeds as [number, number, number, number];
}

/**
 * xorshift128+ PRNG — fast, good quality, seedable.
 * Returns a function that produces random uint32 values.
 */
function createRNG(seed: [number, number, number, number]): () => number {
  let s0 = seed[0] | 0 || 1; // avoid zero state
  let s1 = seed[1] | 0 || 2;
  let s2 = seed[2] | 0 || 3;
  let s3 = seed[3] | 0 || 4;

  return function next(): number {
    const t = s3;
    let s = s0;
    s3 = s2;
    s2 = s1;
    s1 = s0;
    s ^= s << 11;
    s ^= s >>> 8;
    s0 = s ^ t ^ (t >>> 19);
    return (s0 + t) >>> 0;
  };
}

/**
 * Generate a deterministic permutation of [0..n-1] using Fisher-Yates
 * shuffle seeded by the given key.
 */
export function generatePermutation(key: string, n: number): Uint32Array {
  const seed = hashKey(key);
  const rng = createRNG(seed);

  // Initialize identity permutation
  const perm = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    perm[i] = i;
  }

  // Fisher-Yates shuffle
  for (let i = n - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    const temp = perm[i];
    perm[i] = perm[j];
    perm[j] = temp;
  }

  return perm;
}

/**
 * Compute the inverse permutation.
 * If perm[i] = j, then inverse[j] = i.
 */
export function invertPermutation(perm: Uint32Array): Uint32Array {
  const n = perm.length;
  const inv = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    inv[perm[i]] = i;
  }
  return inv;
}

/**
 * Apply a permutation to RGBA pixel data.
 * Output pixel at position perm[i] gets the color from input pixel i.
 */
export function applyPermutation(
  rgba: Uint8ClampedArray | number[],
  perm: Uint32Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const n = width * height;
  const output = new Uint8ClampedArray(n * 4);

  for (let i = 0; i < n; i++) {
    const srcOffset = i * 4;
    const dstOffset = perm[i] * 4;
    output[dstOffset] = rgba[srcOffset];
    output[dstOffset + 1] = rgba[srcOffset + 1];
    output[dstOffset + 2] = rgba[srcOffset + 2];
    output[dstOffset + 3] = rgba[srcOffset + 3];
  }

  return output;
}

/**
 * Generate a random hex key.
 */
export function generateRandomKey(length: number = 32): string {
  const chars = '0123456789abcdef';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % 16]).join('');
}
