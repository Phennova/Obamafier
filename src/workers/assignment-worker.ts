import { rgbaBufferToLab } from './shared/color.js';
import { computeHilbertIndices } from './shared/hilbert.js';
import type { AssignmentWorkerInput, AssignmentWorkerOutput } from './shared/types.js';

function postProgress(phase: string, progress: number, message: string) {
  const msg: AssignmentWorkerOutput = { type: 'progress', phase, progress, message };
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

function computeAssignment(data: AssignmentWorkerInput) {
  const pixelCount = data.width * data.height;
  const sourceRGBA = new Uint8ClampedArray(data.sourceRGBA);
  const targetRGBA = new Uint8ClampedArray(data.targetRGBA);

  // Phase 1: Convert to LAB
  postProgress('preprocessing', 0, 'Converting to LAB color space...');
  const sourceLab = rgbaBufferToLab(sourceRGBA, pixelCount);
  const targetLab = rgbaBufferToLab(targetRGBA, pixelCount);
  postProgress('preprocessing', 1, 'LAB conversion complete');

  // Phase 2: Compute Hilbert indices
  postProgress('hilbert', 0, 'Computing Hilbert curve indices...');
  const sourceHilbert = computeHilbertIndices(sourceLab, pixelCount);
  const targetHilbert = computeHilbertIndices(targetLab, pixelCount);
  postProgress('hilbert', 0.5, 'Sorting by Hilbert index...');

  // Create index arrays and sort by Hilbert index
  const sourceOrder = new Uint32Array(pixelCount);
  const targetOrder = new Uint32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    sourceOrder[i] = i;
    targetOrder[i] = i;
  }

  sourceOrder.sort((a, b) => sourceHilbert[a] - sourceHilbert[b]);
  targetOrder.sort((a, b) => targetHilbert[a] - targetHilbert[b]);

  // Match by rank: sorted source #i → sorted target #i
  const assignment = new Uint32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    assignment[sourceOrder[i]] = targetOrder[i];
  }
  postProgress('hilbert', 1, 'Hilbert assignment complete');

  // Phase 3: Swap refinement
  const swapIterations = data.swapIterations;
  const reportInterval = Math.max(1, Math.floor(swapIterations / 100));
  let swapsAccepted = 0;

  postProgress('refining', 0, `Refining with ${(swapIterations / 1e6).toFixed(1)}M swaps...`);

  for (let i = 0; i < swapIterations; i++) {
    const s1 = Math.floor(Math.random() * pixelCount);
    const s2 = Math.floor(Math.random() * pixelCount);
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
      postProgress('refining', i / swapIterations,
        `Refining... ${((i / swapIterations) * 100).toFixed(0)}% (${swapsAccepted} swaps accepted)`);
    }
  }

  // Compute final total cost
  let totalCost = 0;
  for (let i = 0; i < pixelCount; i++) {
    totalCost += labDistSq(sourceLab, i, targetLab, assignment[i]);
  }

  postProgress('ready', 1, `Done! ${swapsAccepted} beneficial swaps found`);

  const result: AssignmentWorkerOutput = {
    type: 'result',
    assignment: Array.from(assignment),
    totalCost,
  };
  self.postMessage(result);
}

self.onmessage = (e: MessageEvent<AssignmentWorkerInput>) => {
  if (e.data.type === 'compute') {
    computeAssignment(e.data);
  }
};
