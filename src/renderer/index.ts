import { ParticleSystem } from './gl/particle-system.js';
import { AnimationController } from './gl/animation.js';
import { QUALITY_SWAP_ITERATIONS } from '../common/types.js';
import type { QualityPreset, Resolution } from '../common/types.js';
import type { AssignmentWorkerOutput } from '../workers/shared/types.js';

// Electron API exposed via preload
declare global {
  interface Window {
    electronAPI: {
      selectImage: () => Promise<string | null>;
      loadImage: (path: string, resolution: Resolution) => Promise<{
        rgba: number[];
        width: number;
        height: number;
      }>;
      processImages: (sourcePath: string, resolution: Resolution) => Promise<{
        source: { rgba: number[]; width: number; height: number };
        target: { rgba: number[]; width: number; height: number };
      }>;
      getTargetPath: () => Promise<string>;
      exportFrame: (pngDataUrl: string) => Promise<string | null>;
      getPathForFile: (file: File) => string;
    };
  }
}

// DOM elements
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const status = document.getElementById('status') as HTMLSpanElement;
const progressContainer = document.getElementById('progressContainer') as HTMLDivElement;
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const dropOverlay = document.getElementById('dropOverlay') as HTMLDivElement;
const canvasContainer = document.getElementById('canvasContainer') as HTMLDivElement;

const btnLoad = document.getElementById('btnLoad') as HTMLButtonElement;
const btnObamafi = document.getElementById('btnObamafi') as HTMLButtonElement;
const btnReset = document.getElementById('btnReset') as HTMLButtonElement;
const btnClear = document.getElementById('btnClear') as HTMLButtonElement;
const btnSave = document.getElementById('btnSave') as HTMLButtonElement;
const selResolution = document.getElementById('selResolution') as HTMLSelectElement;
const selQuality = document.getElementById('selQuality') as HTMLSelectElement;
const sliderDuration = document.getElementById('sliderDuration') as HTMLInputElement;
const valDuration = document.getElementById('valDuration') as HTMLSpanElement;
const sliderCurve = document.getElementById('sliderCurve') as HTMLInputElement;
const valCurve = document.getElementById('valCurve') as HTMLSpanElement;

// State
let particles: ParticleSystem | null = null;
let animation: AnimationController | null = null;
let sourceRGBA: number[] | null = null;
let targetRGBA: number[] | null = null;
let currentAssignment: number[] | null = null;
let imageWidth = 0;
let imageHeight = 0;
let isProcessing = false;

// Initialize
function init() {
  particles = new ParticleSystem(canvas);

  // Slider updates
  sliderDuration.addEventListener('input', () => {
    valDuration.textContent = `${parseFloat(sliderDuration.value).toFixed(1)}s`;
    animation?.setDuration(parseFloat(sliderDuration.value));
  });

  sliderCurve.addEventListener('input', () => {
    valCurve.textContent = parseFloat(sliderCurve.value).toFixed(2);
  });

  // Load image button
  btnLoad.addEventListener('click', selectAndLoadImage);

  // OBAMAFI button
  btnObamafi.addEventListener('click', startAnimation);

  // Reset button
  btnReset.addEventListener('click', resetAnimation);

  // Clear button
  btnClear.addEventListener('click', clearAll);

  // Save frame button
  btnSave.addEventListener('click', saveFrame);

  // Drag and drop
  canvasContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvasContainer.style.borderColor = 'var(--accent)';
  });

  canvasContainer.addEventListener('dragleave', () => {
    canvasContainer.style.borderColor = '';
  });

  canvasContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    canvasContainer.style.borderColor = '';
    const file = e.dataTransfer?.files[0];
    if (file) {
      const filePath = window.electronAPI.getPathForFile(file);
      if (filePath) {
        await loadAndProcess(filePath);
      }
    }
  });
}

async function selectAndLoadImage() {
  const path = await window.electronAPI.selectImage();
  if (path) await loadAndProcess(path);
}

async function loadAndProcess(sourcePath: string) {
  if (isProcessing) return;
  isProcessing = true;

  const resolution = selResolution.value === 'original' ? 0 : parseInt(selResolution.value);
  const quality = selQuality.value as QualityPreset;
  const swapIterations = QUALITY_SWAP_ITERATIONS[quality];

  try {
    // Show progress
    dropOverlay.classList.add('hidden');
    progressContainer.classList.remove('hidden');
    setProgress(0, 'Loading images...');
    setStatus('Preprocessing...');

    // Load both images via main process
    const result = await window.electronAPI.processImages(sourcePath, resolution);
    sourceRGBA = result.source.rgba;
    targetRGBA = result.target.rgba;
    imageWidth = result.source.width;
    imageHeight = result.source.height;

    setProgress(0.1, 'Computing optimal pixel assignment...');
    setStatus('Computing assignment...');

    // Run assignment in Web Worker
    const assignment = await runAssignmentWorker(
      sourceRGBA, targetRGBA, imageWidth, imageHeight, swapIterations
    );
    currentAssignment = assignment;

    // Upload to GPU
    setStatus('Uploading to GPU...');
    const curvature = parseFloat(sliderCurve.value);
    particles!.uploadParticles(
      sourceRGBA, targetRGBA, assignment,
      imageWidth, imageHeight,
      0.3, curvature
    );

    // Show source image (t=0)
    animation = new AnimationController(
      particles!,
      parseFloat(sliderDuration.value),
      (state) => {
        btnObamafi.disabled = state === 'playing';
        btnReset.disabled = state === 'idle';
        btnSave.disabled = state === 'idle';
        if (state === 'finished') {
          setStatus('OBAMAFIED!');
          btnObamafi.textContent = 'REPLAY';
          btnObamafi.disabled = false;
        }
      },
      (_time) => {}
    );
    animation.renderSource();

    progressContainer.classList.add('hidden');
    setStatus('Ready! Click OBAMAFI to transform');
    btnObamafi.disabled = false;
    btnObamafi.textContent = 'OBAMAFI';
    btnReset.disabled = true;
    btnClear.disabled = false;
    btnSave.disabled = false;

  } catch (err: any) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    isProcessing = false;
  }
}

function runAssignmentWorker(
  sourceRGBA: number[],
  targetRGBA: number[],
  width: number,
  height: number,
  swapIterations: number
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/assignment-worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent<AssignmentWorkerOutput>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        const phaseOffset =
          msg.phase === 'preprocessing' ? 0 :
          msg.phase === 'hilbert' ? 0.1 :
          msg.phase === 'refining' ? 0.3 : 0.9;
        const phaseWeight =
          msg.phase === 'preprocessing' ? 0.1 :
          msg.phase === 'hilbert' ? 0.2 :
          msg.phase === 'refining' ? 0.6 : 0.1;

        const totalProgress = phaseOffset + (msg.progress ?? 0) * phaseWeight;
        setProgress(totalProgress, msg.message ?? '');
        setStatus(msg.message ?? '');
      } else if (msg.type === 'result') {
        worker.terminate();
        resolve(msg.assignment!);
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message));
    };

    worker.postMessage({
      type: 'compute',
      sourceRGBA,
      targetRGBA,
      width,
      height,
      swapIterations,
    });
  });
}

function startAnimation() {
  if (!animation) return;

  if (animation.animationState === 'finished') {
    animation.reset();
  }

  btnReset.disabled = false;
  setStatus('Transforming...');
  animation.play();
}

function resetAnimation() {
  if (!animation) return;
  animation.reset();
  setStatus('Ready! Click OBAMAFI to transform');
  btnObamafi.textContent = 'OBAMAFI';
  btnObamafi.disabled = false;
  btnReset.disabled = true;
}

function clearAll() {
  if (animation) {
    animation.destroy();
    animation = null;
  }
  sourceRGBA = null;
  targetRGBA = null;
  currentAssignment = null;
  imageWidth = 0;
  imageHeight = 0;

  // Clear canvas
  particles?.clear();

  // Reset UI
  dropOverlay.classList.remove('hidden');
  progressContainer.classList.add('hidden');
  btnObamafi.disabled = true;
  btnObamafi.textContent = 'OBAMAFI';
  btnReset.disabled = true;
  btnClear.disabled = true;
  btnSave.disabled = true;
  setStatus('Drop an image to begin');
}

async function saveFrame() {
  if (!particles) return;
  const dataUrl = particles.captureFrame();
  const savedPath = await window.electronAPI.exportFrame(dataUrl);
  if (savedPath) {
    setStatus(`Saved to ${savedPath}`);
  }
}

function setStatus(msg: string) {
  status.textContent = msg;
}

function setProgress(value: number, _msg: string) {
  progressBar.style.width = `${Math.round(value * 100)}%`;
  if (value >= 1) {
    progressBar.classList.add('complete');
  } else {
    progressBar.classList.remove('complete');
  }
}

// Start
init();
