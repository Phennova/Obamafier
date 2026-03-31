import { ipcMain, dialog, BrowserWindow } from 'electron';
import zlib from 'zlib';
import sharp from 'sharp';

function getWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || undefined;
}
import { loadAndProcessImage, loadAndProcessPair } from './image-processor.js';
import { IPC_CHANNELS, OBAMACRYPT_META_KEY } from '../common/constants.js';

// ─── LSB Steganography ────────────────────────────────────────
//
// Hybrid approach: 2 LSBs on R,G,B (minimal visual impact) +
// all 8 bits of alpha channel (fully opaque images — alpha is
// 255 everywhere, so we repurpose it entirely for data).
//
// Per pixel: 2+2+2+8 = 14 bits = 1.75 bytes/pixel
// For 512×512: 458,752 bytes (448KB)
// For 768×768: 1,032,192 bytes (1008KB)
// Max RGB shift: 3/255 ≈ 1.2% — imperceptible.
// Alpha: replaced entirely, but image renders identically on
// opaque backgrounds (Electron window bg is solid dark).

const LSB_MAGIC = 0x0BA3AF1E;
const RGB_LSB = 2; // bits per RGB channel
const BITS_PER_PIXEL = RGB_LSB * 3 + 8; // 14 bits (2+2+2 from RGB, 8 from alpha)

function capacityBytes(pixelCount: number): number {
  return Math.floor((pixelCount * BITS_PER_PIXEL) / 8);
}

/**
 * Embed data using 2 LSBs per RGB channel + full alpha channel.
 */
function lsbEmbed(rgba: Uint8ClampedArray, data: Buffer): void {
  const pixelCount = rgba.length / 4;
  const cap = capacityBytes(pixelCount);

  if (data.length > cap) {
    throw new Error(
      `Data too large for LSB embedding: need ${(data.length / 1024).toFixed(0)}KB, ` +
      `have ${(cap / 1024).toFixed(0)}KB capacity`
    );
  }

  let bitPos = 0;
  const totalBits = data.length * 8;

  function readBits(n: number): number {
    let val = 0;
    for (let i = n - 1; i >= 0 && bitPos < totalBits; i--, bitPos++) {
      const byteIdx = bitPos >> 3;
      const bitIdx = 7 - (bitPos & 7);
      val |= ((data[byteIdx] >> bitIdx) & 1) << i;
    }
    return val;
  }

  for (let px = 0; px < pixelCount && bitPos < totalBits; px++) {
    const base = px * 4;
    // 2 LSBs into R, G, B
    rgba[base + 0] = (rgba[base + 0] & 0xFC) | readBits(2);
    rgba[base + 1] = (rgba[base + 1] & 0xFC) | readBits(2);
    rgba[base + 2] = (rgba[base + 2] & 0xFC) | readBits(2);
    // Full 8 bits into alpha
    if (bitPos < totalBits) {
      rgba[base + 3] = readBits(8);
    }
  }
}

/**
 * Extract hidden data from 2 LSBs per RGB + full alpha.
 */
function lsbExtract(rgba: Uint8ClampedArray): { width: number; height: number; data: Buffer } | null {
  // Extract 12-byte header
  const header = lsbExtractN(rgba, 12);
  if (!header) return null;

  const magic = header.readUInt32BE(0);
  if (magic !== LSB_MAGIC) return null;

  const width = header.readUInt16BE(4);
  const height = header.readUInt16BE(6);
  const payloadLength = header.readUInt32BE(8);

  if (payloadLength <= 0 || payloadLength > rgba.length) return null;

  const all = lsbExtractN(rgba, 12 + payloadLength);
  if (!all) return null;

  return { width, height, data: all.subarray(12, 12 + payloadLength) };
}

function lsbExtractN(rgba: Uint8ClampedArray, byteCount: number): Buffer | null {
  const result = Buffer.alloc(byteCount);
  const totalBits = byteCount * 8;
  let bitPos = 0;
  const pixelCount = rgba.length / 4;

  function writeBits(val: number, n: number) {
    for (let i = n - 1; i >= 0 && bitPos < totalBits; i--, bitPos++) {
      const bit = (val >> i) & 1;
      const byteIdx = bitPos >> 3;
      const bitIdx = 7 - (bitPos & 7);
      result[byteIdx] |= bit << bitIdx;
    }
  }

  for (let px = 0; px < pixelCount && bitPos < totalBits; px++) {
    const base = px * 4;
    writeBits(rgba[base + 0] & 0x03, 2);
    writeBits(rgba[base + 1] & 0x03, 2);
    writeBits(rgba[base + 2] & 0x03, 2);
    writeBits(rgba[base + 3], 8);
  }

  return result;
}

// ─── IPC Handlers ─────────────────────────────────────────────

export function registerIpcHandlers(getTargetPath: () => string) {
  ipcMain.handle(IPC_CHANNELS.SELECT_IMAGE, async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff', 'tif', 'gif', 'avif', 'heif', 'heic', 'svg', 'ico'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(
    IPC_CHANNELS.LOAD_IMAGE,
    async (_event, imagePath: string, resolution: number) => {
      const data = await loadAndProcessImage(imagePath, resolution);
      return {
        rgba: Array.from(data.rgba),
        width: data.width,
        height: data.height,
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROCESS_IMAGES,
    async (_event, sourcePath: string, resolution: number) => {
      const targetPath = getTargetPath();
      console.log('[process-images] source:', sourcePath, 'target:', targetPath, 'res:', resolution);
      const fs = await import('fs');
      if (!fs.existsSync(sourcePath)) throw new Error(`Source file not found: ${sourcePath}`);
      if (!fs.existsSync(targetPath)) throw new Error(`Target file not found: ${targetPath}`);
      const { source, target, effectiveResolution } = await loadAndProcessPair(
        sourcePath, targetPath, resolution
      );
      return {
        source: {
          rgba: Array.from(source.rgba),
          width: source.width,
          height: source.height,
        },
        target: {
          rgba: Array.from(target.rgba),
          width: target.width,
          height: target.height,
        },
        effectiveResolution,
      };
    }
  );

  ipcMain.handle(IPC_CHANNELS.GET_TARGET_PATH, () => {
    return getTargetPath();
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_FRAME, async (_event, pngDataUrl: string) => {
    console.log('[export-frame] called, data length:', pngDataUrl?.length ?? 0);
    if (!pngDataUrl) { console.log('[export-frame] ERROR: no data'); return null; }

    const win = getWindow();
    console.log('[export-frame] showing save dialog, window:', !!win);
    const result = await dialog.showSaveDialog(win!, {
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
      defaultPath: 'obamafied.png',
    });
    if (result.canceled || !result.filePath) { console.log('[export-frame] cancelled'); return null; }

    console.log('[export-frame] writing to:', result.filePath);
    const base64 = pngDataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const fs = await import('fs/promises');
    await fs.writeFile(result.filePath, buffer);
    console.log('[export-frame] done, size:', buffer.length);
    return result.filePath;
  });

  // ─── Save Obamacrypt (dual method) ───────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.SAVE_OBAMACRYPT,
    async (_event, rgbaArray: number[], width: number, height: number, encodedKey: string, method: string) => {
      console.log('[save-obamacrypt] method:', method, 'key length:', encodedKey?.length);
      if (!rgbaArray || !encodedKey) return null;

      const win = getWindow();
      const result = await dialog.showSaveDialog(win!, {
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
        defaultPath: 'obamacrypted.png',
      });
      if (result.canceled || !result.filePath) return null;

      const rgba = new Uint8ClampedArray(rgbaArray);
      const fs = await import('fs/promises');

      let actualMethod = method;

      if (method === 'lsb') {
        // ─── LSB Method: embed in pixel values ───
        const capacity = capacityBytes(width * height);
        const pipeIdx = encodedKey.indexOf('|');
        const base64Part = encodedKey.substring(pipeIdx + 1);
        const varintBytes = Buffer.from(base64Part, 'base64');
        const compressed = zlib.deflateSync(varintBytes, { level: 9, memLevel: 9 });

        const header = Buffer.alloc(12);
        header.writeUInt32BE(LSB_MAGIC, 0);
        header.writeUInt16BE(width, 4);
        header.writeUInt16BE(height, 6);
        header.writeUInt32BE(compressed.length, 8);
        const payload = Buffer.concat([header, compressed]);

        console.log(`[save-obamacrypt] LSB: ${(payload.length/1024).toFixed(0)}KB payload, ${(capacity/1024).toFixed(0)}KB capacity`);

        if (payload.length > capacity) {
          console.log(`[save-obamacrypt] LSB capacity exceeded, falling back to metadata method`);
          actualMethod = 'metadata';
        } else {
          lsbEmbed(rgba, payload);
        }
      }

      // Save the image (with LSB-modified pixels, or unmodified for metadata)
      await sharp(Buffer.from(rgba.buffer), { raw: { width, height, channels: 4 } })
        .png({ compressionLevel: 9, palette: false })
        .toFile(result.filePath);

      if (actualMethod !== 'lsb') {
        // ─── Metadata Method: inject PNG zTXt chunk ───
        const pngBuf = await fs.readFile(result.filePath);
        const withKey = injectPngZtxt(pngBuf, OBAMACRYPT_META_KEY, encodedKey);
        await fs.writeFile(result.filePath, withKey);
        console.log(`[save-obamacrypt] metadata: injected ${(encodedKey.length/1024).toFixed(0)}KB key as zTXt chunk`);
      }

      console.log('[save-obamacrypt] saved:', result.filePath, 'method:', actualMethod);
      return { filePath: result.filePath, actualMethod };
    }
  );

  // ─── Read Obamacrypt (tries both methods) ──────────────────
  ipcMain.handle(
    IPC_CHANNELS.READ_OBAMACRYPT,
    async (_event, imagePath: string) => {
      const fs = await import('fs/promises');
      const buf = await fs.readFile(imagePath);

      // Try metadata method first (fast — just scan PNG chunks)
      const metaKey = extractPngZtxt(buf, OBAMACRYPT_META_KEY);
      if (metaKey) {
        console.log('[read-obamacrypt] found key in PNG metadata');
        return metaKey;
      }

      // Try LSB method (decode to raw RGBA and extract)
      try {
        const { data } = await sharp(buf)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
        const extracted = lsbExtract(rgba);
        if (extracted) {
          const varintBytes = zlib.inflateSync(extracted.data);
          const base64Part = varintBytes.toString('base64');
          const key = `${extracted.width},${extracted.height}|${base64Part}`;
          console.log('[read-obamacrypt] found key in LSB data');
          return key;
        }
      } catch {}

      console.log('[read-obamacrypt] no key found in image');
      return null;
    }
  );
}

// ─── PNG zTXt Chunk Helpers ──────────────────────────────────

function injectPngZtxt(png: Buffer, keyword: string, text: string): Buffer {
  const keyBuf = Buffer.from(keyword, 'latin1');
  const textBuf = zlib.deflateSync(Buffer.from(text, 'latin1'));
  const chunkData = Buffer.concat([keyBuf, Buffer.from([0x00, 0x00]), textBuf]);
  const chunkType = Buffer.from('zTXt', 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(chunkData.length);
  const crc = crc32(Buffer.concat([chunkType, chunkData]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc);
  const chunk = Buffer.concat([lengthBuf, chunkType, chunkData, crcBuf]);
  const iendOffset = png.length - 12;
  return Buffer.concat([png.subarray(0, iendOffset), chunk, png.subarray(iendOffset)]);
}

function extractPngZtxt(png: Buffer, keyword: string): string | null {
  let offset = 8;
  while (offset < png.length - 12) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'zTXt') {
      const data = png.subarray(offset + 8, offset + 8 + length);
      const nullIdx = data.indexOf(0x00);
      if (nullIdx > 0) {
        const key = data.subarray(0, nullIdx).toString('latin1');
        if (key === keyword) {
          const compressed = data.subarray(nullIdx + 2);
          return zlib.inflateSync(compressed).toString('latin1');
        }
      }
    }
    offset += 12 + length;
  }
  return null;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
