import { generatePermutation, invertPermutation, applyPermutation } from './shared/crypto.js';
import { rgbaBufferToLab } from './shared/color.js';
import { computeHilbertIndices } from './shared/hilbert.js';
import { encodePermutation, decodePermutation } from './shared/permutation-codec.js';

export interface CryptoWorkerInput {
  type: 'encrypt' | 'decrypt';
  sourceRGBA: number[];      // source image (encrypt) or encrypted image (decrypt)
  targetRGBA?: number[];     // Obama reference (encrypt only)
  width: number;
  height: number;
  key: string;               // encrypt: ignored (key is generated), decrypt: the permutation key
  swapIterations?: number;
}

export interface CryptoWorkerOutput {
  type: 'progress' | 'result';
  progress?: number;
  message?: string;
  rgba?: number[];
  permutation?: number[];
  /** The encoded key (encrypt only) */
  encodedKey?: string;
}

function postProgress(progress: number, message: string) {
  const msg: CryptoWorkerOutput = { type: 'progress', progress, message };
  self.postMessage(msg);
}

function labDistSq(
  colorsA: Float32Array, idxA: number,
  colorsB: Float32Array, idxB: number
): number {
  const oA = idxA * 3, oB = idxB * 3;
  const dL = colorsA[oA] - colorsB[oB];
  const da = colorsA[oA + 1] - colorsB[oB + 1];
  const db = colorsA[oA + 2] - colorsB[oB + 2];
  return dL * dL + da * da + db * db;
}

function encrypt(data: CryptoWorkerInput) {
  const { sourceRGBA, targetRGBA, width, height, swapIterations = 2_000_000 } = data;
  if (!targetRGBA) throw new Error('Target (Obama) image required for encryption');

  const n = width * height;
  const srcRGBA = new Uint8ClampedArray(sourceRGBA);
  const tgtRGBA = new Uint8ClampedArray(targetRGBA);

  // Convert to LAB
  postProgress(0.05, 'Converting colors...');
  const sourceLab = rgbaBufferToLab(srcRGBA, n);
  const targetLab = rgbaBufferToLab(tgtRGBA, n);

  // Hilbert sort-match
  postProgress(0.1, 'Computing Hilbert indices...');
  const sourceHilbert = computeHilbertIndices(sourceLab, n);
  const targetHilbert = computeHilbertIndices(targetLab, n);

  const sourceOrder = new Uint32Array(n);
  const targetOrder = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    sourceOrder[i] = i;
    targetOrder[i] = i;
  }
  sourceOrder.sort((a, b) => sourceHilbert[a] - sourceHilbert[b]);
  targetOrder.sort((a, b) => targetHilbert[a] - targetHilbert[b]);

  // Assignment: source pixel at sourceOrder[k] → target position targetOrder[k]
  const assignment = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    assignment[sourceOrder[i]] = targetOrder[i];
  }

  postProgress(0.3, 'Refining color matching...');

  // Swap refinement (deterministic — same result every time for same input)
  const reportInterval = Math.max(1, Math.floor(swapIterations / 50));
  let swapsAccepted = 0;
  // Use a simple seeded PRNG for reproducibility
  let rngState = 12345;
  function nextRand() {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState;
  }

  for (let i = 0; i < swapIterations; i++) {
    const s1 = nextRand() % n;
    const s2 = nextRand() % n;
    if (s1 === s2) continue;

    const t1 = assignment[s1];
    const t2 = assignment[s2];

    const currentCost =
      labDistSq(sourceLab, s1, targetLab, t1) +
      labDistSq(sourceLab, s2, targetLab, t2);
    const swapCost =
      labDistSq(sourceLab, s1, targetLab, t2) +
      labDistSq(sourceLab, s2, targetLab, t1);

    if (swapCost < currentCost) {
      assignment[s1] = t2;
      assignment[s2] = t1;
      swapsAccepted++;
    }

    if (i % reportInterval === 0) {
      postProgress(0.3 + 0.5 * (i / swapIterations),
        `Refining... ${((i / swapIterations) * 100).toFixed(0)}%`);
    }
  }

  // Apply assignment to create encrypted image
  postProgress(0.85, 'Applying permutation...');
  const encryptedRGBA = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const srcOff = i * 4;
    const dstOff = assignment[i] * 4;
    encryptedRGBA[dstOff] = srcRGBA[srcOff];
    encryptedRGBA[dstOff + 1] = srcRGBA[srcOff + 1];
    encryptedRGBA[dstOff + 2] = srcRGBA[srcOff + 2];
    encryptedRGBA[dstOff + 3] = srcRGBA[srcOff + 3];
  }

  // Compute inverse permutation (this IS the key)
  // inverse[obama_pos] = source_pos
  const inversePerm = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    inversePerm[assignment[i]] = i;
  }

  // Encode inverse permutation as the key string
  postProgress(0.9, 'Generating key...');
  const encodedKey = encodePermutation(inversePerm, width, height);

  postProgress(1, `Done! ${swapsAccepted} refinement swaps applied`);

  const result: CryptoWorkerOutput = {
    type: 'result',
    rgba: Array.from(encryptedRGBA),
    permutation: Array.from(assignment),
    encodedKey,
  };
  self.postMessage(result);
}

function decrypt(data: CryptoWorkerInput) {
  const { sourceRGBA, width, height, key } = data;
  const n = width * height;

  postProgress(0.1, 'Decoding key...');

  // Decode the key to get the inverse permutation
  const decoded = decodePermutation(key);

  if (decoded.width !== width || decoded.height !== height) {
    throw new Error(`Key is for ${decoded.width}x${decoded.height} but image is ${width}x${height}`);
  }

  const inversePerm = decoded.inversePerm;

  postProgress(0.4, 'Deobamacrypting pixels...');

  // Apply inverse permutation: for each obama position j, the original source position is inversePerm[j]
  // encrypted[j] has the color that should go to source position inversePerm[j]
  const decryptedRGBA = new Uint8ClampedArray(n * 4);
  const srcRGBA = new Uint8ClampedArray(sourceRGBA);

  for (let j = 0; j < n; j++) {
    const srcOff = j * 4; // encrypted position (obama layout)
    const dstOff = inversePerm[j] * 4; // original source position
    decryptedRGBA[dstOff] = srcRGBA[srcOff];
    decryptedRGBA[dstOff + 1] = srcRGBA[srcOff + 1];
    decryptedRGBA[dstOff + 2] = srcRGBA[srcOff + 2];
    decryptedRGBA[dstOff + 3] = srcRGBA[srcOff + 3];
  }

  // Build permutation for animation (encrypted pos → source pos)
  postProgress(0.8, 'Preparing animation...');

  const result: CryptoWorkerOutput = {
    type: 'result',
    rgba: Array.from(decryptedRGBA),
    permutation: Array.from(inversePerm),
  };
  self.postMessage(result);
}

self.onmessage = (e: MessageEvent<CryptoWorkerInput>) => {
  if (e.data.type === 'encrypt') {
    encrypt(e.data);
  } else {
    decrypt(e.data);
  }
};
