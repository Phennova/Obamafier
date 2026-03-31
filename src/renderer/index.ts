import { ParticleSystem } from './gl/particle-system.js';
import { AnimationController } from './gl/animation.js';
import { QUALITY_SWAP_ITERATIONS } from '../common/types.js';
import type { QualityPreset, Resolution } from '../common/types.js';
import type { AssignmentWorkerOutput } from '../workers/shared/types.js';
import type { CryptoWorkerOutput } from '../workers/crypto-worker.js';

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
      saveObamacrypt: (rgba: number[], width: number, height: number, encodedKey: string, method: string) => Promise<{ filePath: string; actualMethod: string } | null>;
      readObamacrypt: (imagePath: string) => Promise<string | null>;
      getPathForFile: (file: File) => string;
    };
  }
}

type AppMode = 'obamafi' | 'encrypt' | 'decrypt';

// ─── DOM Elements ───────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const appTitle = document.getElementById('appTitle') as HTMLHeadingElement;
const status = document.getElementById('status') as HTMLSpanElement;
const progressContainer = document.getElementById('progressContainer') as HTMLDivElement;
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const dropOverlay = document.getElementById('dropOverlay') as HTMLDivElement;
const canvasContainer = document.getElementById('canvasContainer') as HTMLDivElement;
const modeTabs = document.querySelectorAll('.mode-tab') as NodeListOf<HTMLButtonElement>;

// Key bar
const keyBar = document.getElementById('keyBar') as HTMLDivElement;
const inputKey = document.getElementById('inputKey') as HTMLInputElement;
const btnGenerateKey = document.getElementById('btnGenerateKey') as HTMLButtonElement;
const btnCopyKey = document.getElementById('btnCopyKey') as HTMLButtonElement;

// Obamafi controls
const obamafiControls = document.getElementById('obamafiControls') as HTMLDivElement;
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

// Crypto controls
const cryptoControls = document.getElementById('cryptoControls') as HTMLDivElement;
const btnLoadCrypto = document.getElementById('btnLoadCrypto') as HTMLButtonElement;
const btnCrypt = document.getElementById('btnCrypt') as HTMLButtonElement;
const btnClearCrypto = document.getElementById('btnClearCrypto') as HTMLButtonElement;
const btnDownload = document.getElementById('btnDownload') as HTMLButtonElement;
const selMethod = document.getElementById('selMethod') as HTMLSelectElement;
const selResolutionCrypto = document.getElementById('selResolutionCrypto') as HTMLSelectElement;
const sliderDurationCrypto = document.getElementById('sliderDurationCrypto') as HTMLInputElement;
const valDurationCrypto = document.getElementById('valDurationCrypto') as HTMLSpanElement;
const sliderCurveCrypto = document.getElementById('sliderCurveCrypto') as HTMLInputElement;
const valCurveCrypto = document.getElementById('valCurveCrypto') as HTMLSpanElement;

// ─── State ──────────────────────────────────────────────────

let particles: ParticleSystem | null = null;
let animation: AnimationController | null = null;
let currentMode: AppMode = 'obamafi';
let sourceRGBA: number[] | null = null;
let targetRGBA: number[] | null = null;
let currentAssignment: number[] | null = null;
let cryptoResultRGBA: Uint8ClampedArray | null = null;
let cryptoEncodedKey: string | null = null;
let imageWidth = 0;
let imageHeight = 0;
let isProcessing = false;
let cryptoSourcePath: string | null = null;
let cryptoLoadedResolution: number = 0;

/** Toggle inactive appearance (CSS-only, no disabled attribute) */
function setActive(btn: HTMLElement, active: boolean) {
  btn.classList.toggle('inactive', !active);
}

// ─── Init ───────────────────────────────────────────────────

function init() {
  particles = new ParticleSystem(canvas);

  // Mode tabs
  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode as AppMode));
  });

  // Obamafi sliders
  sliderDuration.addEventListener('input', () => {
    valDuration.textContent = `${parseFloat(sliderDuration.value).toFixed(1)}s`;
    animation?.setDuration(parseFloat(sliderDuration.value));
  });
  sliderCurve.addEventListener('input', () => {
    valCurve.textContent = parseFloat(sliderCurve.value).toFixed(2);
  });

  // Crypto sliders
  sliderDurationCrypto.addEventListener('input', () => {
    valDurationCrypto.textContent = `${parseFloat(sliderDurationCrypto.value).toFixed(1)}s`;
    animation?.setDuration(parseFloat(sliderDurationCrypto.value));
  });
  sliderCurveCrypto.addEventListener('input', () => {
    valCurveCrypto.textContent = parseFloat(sliderCurveCrypto.value).toFixed(2);
  });

  // Obamafi buttons
  btnLoad.addEventListener('click', selectAndLoadImage);
  btnObamafi.addEventListener('click', startAnimation);
  btnReset.addEventListener('click', resetAnimation);
  btnClear.addEventListener('click', clearAll);
  btnSave.addEventListener('click', saveFrame);

  // Crypto buttons
  btnLoadCrypto.addEventListener('click', selectAndLoadCrypto);
  btnCrypt.addEventListener('click', runCrypto);
  btnClearCrypto.addEventListener('click', clearAll);
  btnDownload.addEventListener('click', downloadResult);
  btnGenerateKey.addEventListener('click', generateKey);
  btnCopyKey.addEventListener('click', copyKey);
  inputKey.addEventListener('input', onKeyInput);

  // Drag and drop
  canvasContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvasContainer.style.borderColor = currentMode === 'obamafi' ? 'var(--accent)' : 'var(--accent-encrypt)';
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
        if (currentMode === 'obamafi') {
          await loadAndProcess(filePath);
        } else {
          await loadCryptoImage(filePath);
        }
      }
    }
  });

  // Start with all action buttons inactive
  setActive(btnObamafi, false);
  setActive(btnReset, false);
  setActive(btnClear, false);
  setActive(btnSave, false);
  setActive(btnCrypt, false);
  setActive(btnClearCrypto, false);
  setActive(btnDownload, false);
  setActive(btnCopyKey, false);
}

// ─── Mode Switching ─────────────────────────────────────────

function switchMode(mode: AppMode) {
  currentMode = mode;
  clearAll();

  modeTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  if (mode === 'obamafi') {
    appTitle.textContent = 'OBAMAFIER';
  } else if (mode === 'encrypt') {
    appTitle.textContent = 'OBAMACRYPT';
  } else {
    appTitle.textContent = 'DEOBAMACRYPT';
  }

  if (mode === 'obamafi') {
    dropOverlay.querySelector('p')!.textContent = 'Drop an image here or click Load Image';
  } else if (mode === 'encrypt') {
    dropOverlay.querySelector('p')!.textContent = 'Drop an image to obamacrypt';
  } else {
    dropOverlay.querySelector('p')!.textContent = 'Drop an obamacrypted image to deobamacrypt';
  }

  obamafiControls.classList.toggle('hidden', mode !== 'obamafi');
  cryptoControls.classList.toggle('hidden', mode === 'obamafi');
  keyBar.classList.toggle('hidden', mode === 'obamafi');

  if (mode === 'encrypt') {
    inputKey.placeholder = 'Key will appear here after obamacryption...';
    inputKey.readOnly = true;
    btnGenerateKey.classList.add('hidden');
    btnCrypt.textContent = 'OBAMACRYPT';
    btnCrypt.className = 'primary encrypt';
  } else if (mode === 'decrypt') {
    inputKey.placeholder = 'Paste your obamacrypt key here...';
    inputKey.readOnly = false;
    btnGenerateKey.classList.add('hidden');
    btnCrypt.textContent = 'DEOBAMACRYPT';
    btnCrypt.className = 'primary decrypt';
  }
  inputKey.value = '';
  setActive(btnCopyKey, false);

  setStatus(mode === 'obamafi' ? 'Drop an image to begin' : mode === 'encrypt' ? 'Load an image to obamacrypt' : 'Load an obamacrypted image to deobamacrypt');
}

// ─── Key Management ─────────────────────────────────────────

function generateKey() {
  const chars = '0123456789abcdef';
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  inputKey.value = Array.from(arr, b => chars[b % 16]).join('');
  setActive(btnCopyKey, true);
  updateCryptButton();
}

function copyKey() {
  if (!inputKey.value) return;
  navigator.clipboard.writeText(inputKey.value);
  btnCopyKey.textContent = 'Copied!';
  setTimeout(() => { btnCopyKey.textContent = 'Copy'; }, 1500);
}

function onKeyInput() {
  setActive(btnCopyKey, inputKey.value.length > 0);
  updateCryptButton();
}

function updateCryptButton() {
  if (currentMode === 'encrypt') {
    setActive(btnCrypt, !!sourceRGBA && !isProcessing);
  } else {
    setActive(btnCrypt, !!sourceRGBA && inputKey.value.length > 0 && !isProcessing);
  }
}

// ─── Obamafi Mode ───────────────────────────────────────────

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
    dropOverlay.classList.add('hidden');
    progressContainer.classList.remove('hidden');
    setProgress(0, '');
    setStatus('Preprocessing...');

    const result = await window.electronAPI.processImages(sourcePath, resolution);
    sourceRGBA = result.source.rgba;
    targetRGBA = result.target.rgba;
    imageWidth = result.source.width;
    imageHeight = result.source.height;

    setProgress(0.1, '');
    setStatus('Computing assignment...');

    const assignment = await runAssignmentWorker(
      sourceRGBA, targetRGBA, imageWidth, imageHeight, swapIterations
    );
    currentAssignment = assignment;

    setStatus('Uploading to GPU...');
    const curvature = parseFloat(sliderCurve.value);
    particles!.uploadParticles(
      sourceRGBA, targetRGBA, assignment,
      imageWidth, imageHeight, 0.3, curvature
    );

    animation = new AnimationController(
      particles!,
      parseFloat(sliderDuration.value),
      (state) => {
        setActive(btnObamafi, state !== 'playing');
        setActive(btnReset, state !== 'idle');
        setActive(btnSave, state !== 'idle');
        if (state === 'finished') {
          setStatus('OBAMAFIED!');
          btnObamafi.textContent = 'REPLAY';
          setActive(btnObamafi, true);
        }
      },
    );
    animation.renderSource();

    progressContainer.classList.add('hidden');
    setStatus('Ready! Click OBAMAFI to transform');
    btnObamafi.textContent = 'OBAMAFI';
    setActive(btnObamafi, true);
    setActive(btnReset, false);
    setActive(btnClear, true);
    setActive(btnSave, true);
  } catch (err: any) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    isProcessing = false;
  }
}

// ─── Crypto Mode ────────────────────────────────────────────

async function selectAndLoadCrypto() {
  const path = await window.electronAPI.selectImage();
  if (path) await loadCryptoImage(path);
}

async function loadCryptoImage(sourcePath: string) {
  if (isProcessing) return;
  isProcessing = true;

  // Decrypt must use native resolution — the key is tied to the original dimensions
  const resolution = currentMode === 'decrypt' ? 0
    : selResolutionCrypto.value === 'original' ? 0
    : parseInt(selResolutionCrypto.value);

  cryptoSourcePath = sourcePath;
  cryptoLoadedResolution = resolution;

  try {
    dropOverlay.classList.add('hidden');
    setStatus('Loading image...');

    if (currentMode === 'encrypt') {
      const result = await window.electronAPI.processImages(sourcePath, resolution);
      sourceRGBA = result.source.rgba;
      targetRGBA = result.target.rgba;
      imageWidth = result.source.width;
      imageHeight = result.source.height;
    } else {
      const result = await window.electronAPI.loadImage(sourcePath, resolution);
      sourceRGBA = result.rgba;
      targetRGBA = null;
      imageWidth = result.width;
      imageHeight = result.height;

      const embeddedKey = await window.electronAPI.readObamacrypt(sourcePath);
      if (embeddedKey) {
        inputKey.value = embeddedKey;
        setActive(btnCopyKey, true);
      }
    }

    const identity = new Array(imageWidth * imageHeight);
    for (let i = 0; i < identity.length; i++) identity[i] = i;
    particles!.uploadParticles(sourceRGBA, sourceRGBA, identity, imageWidth, imageHeight, 0, 0);
    particles!.render(1);

    setActive(btnClearCrypto, true);
    setActive(btnDownload, false);
    cryptoResultRGBA = null;
    cryptoEncodedKey = null;

    if (currentMode === 'encrypt') {
      setStatus(`Image loaded (${imageWidth}x${imageHeight}). Click OBAMACRYPT to encrypt.`);
      setActive(btnCrypt, true);
    } else {
      if (inputKey.value) {
        setStatus(`Image loaded (${imageWidth}x${imageHeight}). Key found in image! Click DEOBAMACRYPT.`);
        setActive(btnCrypt, true);
      } else {
        setStatus(`Image loaded (${imageWidth}x${imageHeight}). No embedded key found — paste one manually.`);
        updateCryptButton();
      }
    }
  } catch (err: any) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    isProcessing = false;
  }
}

async function runCrypto() {
  if (!sourceRGBA || isProcessing) return;
  if (currentMode === 'decrypt' && !inputKey.value) return;
  isProcessing = true;

  const mode = currentMode as 'encrypt' | 'decrypt';

  try {
    // If encrypting and resolution changed since load, re-process at new resolution
    if (mode === 'encrypt' && cryptoSourcePath) {
      const currentRes = selResolutionCrypto.value === 'original' ? 0 : parseInt(selResolutionCrypto.value);
      if (currentRes !== cryptoLoadedResolution) {
        setStatus('Resolution changed — reprocessing...');
        const result = await window.electronAPI.processImages(cryptoSourcePath, currentRes);
        sourceRGBA = result.source.rgba;
        targetRGBA = result.target.rgba;
        imageWidth = result.source.width;
        imageHeight = result.source.height;
        cryptoLoadedResolution = currentRes;
      }
    }

    progressContainer.classList.remove('hidden');
    setProgress(0, '');
    setStatus(mode === 'encrypt' ? 'Obamacrypting...' : 'Deobamacrypting...');

    const result = await runCryptoWorker(mode);

    cryptoResultRGBA = new Uint8ClampedArray(result.resultRGBA);

    const curvature = parseFloat(sliderCurveCrypto.value);
    particles!.uploadParticles(
      sourceRGBA!, sourceRGBA!, result.permutation,
      imageWidth, imageHeight, 0.3, curvature
    );

    if (mode === 'encrypt' && result.encodedKey) {
      cryptoEncodedKey = result.encodedKey;
      inputKey.value = result.encodedKey;
      setActive(btnCopyKey, true);
      const sizeKB = (result.encodedKey.length / 1024).toFixed(0);
      setStatus(`Obamacrypted! Key (${sizeKB}KB) hidden in image. Download the image.`);
    }

    animation = new AnimationController(
      particles!,
      parseFloat(sliderDurationCrypto.value),
      (state) => {
        setActive(btnCrypt, state !== 'playing');
        if (state === 'finished') {
          if (mode === 'decrypt') {
            setStatus('Deobamacrypted! Download your recovered image.');
          }
          setActive(btnCrypt, true);
          setActive(btnDownload, true);
        }
      },
    );

    progressContainer.classList.add('hidden');
    animation.play();
  } catch (err: any) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    isProcessing = false;
  }
}

function runCryptoWorker(
  mode: 'encrypt' | 'decrypt'
): Promise<{ resultRGBA: number[]; permutation: number[]; encodedKey?: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/crypto-worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent<CryptoWorkerOutput>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setProgress(msg.progress ?? 0, msg.message ?? '');
        setStatus(msg.message ?? '');
      } else if (msg.type === 'result') {
        worker.terminate();
        resolve({
          resultRGBA: msg.rgba!,
          permutation: msg.permutation!,
          encodedKey: msg.encodedKey,
        });
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message));
    };

    worker.postMessage({
      type: mode,
      sourceRGBA: sourceRGBA!,
      targetRGBA: mode === 'encrypt' ? targetRGBA : undefined,
      width: imageWidth,
      height: imageHeight,
      key: inputKey.value,
    });
  });
}

async function downloadResult() {
  if (!cryptoResultRGBA || !imageWidth || !imageHeight) return;

  setStatus('Preparing image for save...');
  await new Promise(r => setTimeout(r, 50));

  try {
    if (currentMode === 'encrypt' && cryptoEncodedKey) {
      const method = selMethod.value;
      setStatus(method === 'lsb' ? 'Embedding key in pixel LSBs...' : 'Embedding key in PNG metadata...');
      await new Promise(r => setTimeout(r, 50));

      const saveResult = await window.electronAPI.saveObamacrypt(
        Array.from(cryptoResultRGBA),
        imageWidth,
        imageHeight,
        cryptoEncodedKey,
        method
      );
      if (saveResult) {
        const methodLabel = saveResult.actualMethod === 'lsb' ? 'hidden in pixel LSBs' : 'hidden in PNG metadata';
        const fallbackNote = saveResult.actualMethod !== method ? ' (auto-fallback for 100% quality)' : '';
        setStatus(`Saved to ${saveResult.filePath} — key ${methodLabel}${fallbackNote}!`);
      } else {
        setStatus('Save cancelled.');
      }
    } else {
      const offscreen = document.createElement('canvas');
      offscreen.width = imageWidth;
      offscreen.height = imageHeight;
      const ctx = offscreen.getContext('2d')!;
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(cryptoResultRGBA), imageWidth, imageHeight),
        0, 0
      );
      const dataUrl = offscreen.toDataURL('image/png');
      const savedPath = await window.electronAPI.exportFrame(dataUrl);
      if (savedPath) {
        setStatus(`Saved to ${savedPath}`);
      } else {
        setStatus('Save cancelled.');
      }
    }
  } catch (err: any) {
    setStatus(`Save failed: ${err.message}`);
    console.error('Download error:', err);
  }
}

// ─── Obamafi Assignment Worker ──────────────────────────────

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

    worker.postMessage({ type: 'compute', sourceRGBA, targetRGBA, width, height, swapIterations });
  });
}

// ─── Shared Actions ─────────────────────────────────────────

function startAnimation() {
  if (!animation || isProcessing) return;
  if (animation.animationState === 'finished') {
    animation.reset();
  }
  setActive(btnReset, true);
  setStatus('Transforming...');
  animation.play();
}

function resetAnimation() {
  if (!animation) return;
  animation.reset();
  setStatus('Ready! Click OBAMAFI to transform');
  btnObamafi.textContent = 'OBAMAFI';
  setActive(btnObamafi, true);
  setActive(btnReset, false);
}

function clearAll() {
  if (animation) {
    animation.destroy();
    animation = null;
  }
  sourceRGBA = null;
  targetRGBA = null;
  currentAssignment = null;
  cryptoResultRGBA = null;
  cryptoEncodedKey = null;
  cryptoSourcePath = null;
  cryptoLoadedResolution = 0;
  imageWidth = 0;
  imageHeight = 0;

  particles?.clear();

  dropOverlay.classList.remove('hidden');
  progressContainer.classList.add('hidden');

  setActive(btnObamafi, false);
  btnObamafi.textContent = 'OBAMAFI';
  setActive(btnReset, false);
  setActive(btnClear, false);
  setActive(btnSave, false);

  setActive(btnCrypt, false);
  setActive(btnClearCrypto, false);
  setActive(btnDownload, false);

  setStatus(currentMode === 'obamafi' ? 'Drop an image to begin' : currentMode === 'encrypt' ? 'Load an image to obamacrypt' : 'Load an obamacrypted image to deobamacrypt');
}

async function saveFrame() {
  if (!particles) return;
  setStatus('Saving frame...');

  try {
    if (animation) {
      particles.render(animation.progress);
    }
    const dataUrl = particles.captureFrame();
    const savedPath = await window.electronAPI.exportFrame(dataUrl);
    if (savedPath) {
      setStatus(`Saved to ${savedPath}`);
    } else {
      setStatus('Save cancelled.');
    }
  } catch (err: any) {
    setStatus(`Save failed: ${err.message}`);
    console.error('Save error:', err);
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

// ─── Start ──────────────────────────────────────────────────
init();
