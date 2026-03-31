import { ipcMain, dialog } from 'electron';
import zlib from 'zlib';
import sharp from 'sharp';
import { loadAndProcessImage, loadAndProcessPair } from './image-processor.js';
import { IPC_CHANNELS } from '../common/constants.js';

// ─── LSB Steganography ────────────────────────────────────────
//
// Hides the permutation data in the least significant bits of the
// image pixel values. Uses 2 LSBs per channel (R, G, B — skips alpha)
// giving 6 bits per pixel.
//
// Format embedded in LSBs:
//   [32 bits] magic number (0x0BA3A F1E = "OBAMAFILE" truncated)
//   [32 bits] payload length in bytes
//   [N bytes] zlib-compressed permutation data
//
// The magic number lets us detect whether an image has hidden data
// without false positives. No metadata, no PNG chunks — the data
// lives in the pixel values themselves.

const LSB_MAGIC = 0x0BA3AF1E; // "OBAMA-FILE" in hex-ish
const BITS_PER_PIXEL = 6; // 2 LSBs × 3 channels (R, G, B)

/**
 * Embed data into the LSBs of an RGBA pixel buffer.
 * Modifies the buffer in-place.
 */
function lsbEmbed(rgba: Uint8ClampedArray, data: Buffer): void {
  const totalBits = data.length * 8;
  const availableBits = (rgba.length / 4) * BITS_PER_PIXEL;

  if (totalBits > availableBits) {
    throw new Error(
      `Data too large for LSB embedding: need ${totalBits} bits, ` +
      `have ${availableBits} bits (${(availableBits / 8 / 1024).toFixed(0)}KB capacity)`
    );
  }

  let bitIndex = 0;

  for (let px = 0; px < rgba.length / 4 && bitIndex < totalBits; px++) {
    const base = px * 4;
    // Embed 2 bits into each of R, G, B (skip alpha)
    for (let ch = 0; ch < 3 && bitIndex < totalBits; ch++) {
      const byteIdx = Math.floor(bitIndex / 8);
      const bitOff = 7 - (bitIndex % 8); // MSB first
      const bit1 = (data[byteIdx] >> bitOff) & 1;
      bitIndex++;

      let bit2 = 0;
      if (bitIndex < totalBits) {
        const byteIdx2 = Math.floor(bitIndex / 8);
        const bitOff2 = 7 - (bitIndex % 8);
        bit2 = (data[byteIdx2] >> bitOff2) & 1;
        bitIndex++;
      }

      // Clear the 2 LSBs and set our data
      rgba[base + ch] = (rgba[base + ch] & 0xFC) | (bit1 << 1) | bit2;
    }
  }
}

/**
 * Extract data from the LSBs of an RGBA pixel buffer.
 * Returns null if no valid data found (magic number mismatch).
 */
function lsbExtract(rgba: Uint8ClampedArray): Buffer | null {
  const maxBits = (rgba.length / 4) * BITS_PER_PIXEL;

  // First extract the header: 4 bytes magic + 4 bytes length = 64 bits
  const headerBits = 64;
  if (maxBits < headerBits) return null;

  const headerBytes = extractBits(rgba, 0, headerBits);
  const magic = headerBytes.readUInt32BE(0);

  if (magic !== LSB_MAGIC) return null;

  const payloadLength = headerBytes.readUInt32BE(4);

  // Sanity check
  if (payloadLength <= 0 || payloadLength > maxBits / 8) return null;

  const totalBits = (8 + payloadLength) * 8;
  if (totalBits > maxBits) return null;

  // Extract the full payload
  const allBytes = extractBits(rgba, 0, totalBits);
  return allBytes.subarray(8, 8 + payloadLength);
}

/** Extract N bits from RGBA LSBs starting at bit offset 0 */
function extractBits(rgba: Uint8ClampedArray, _startBit: number, totalBits: number): Buffer {
  const result = Buffer.alloc(Math.ceil(totalBits / 8));
  let bitIndex = 0;

  for (let px = 0; px < rgba.length / 4 && bitIndex < totalBits; px++) {
    const base = px * 4;
    for (let ch = 0; ch < 3 && bitIndex < totalBits; ch++) {
      const val = rgba[base + ch];
      const bit1 = (val >> 1) & 1;
      const bit2 = val & 1;

      const byteIdx1 = Math.floor(bitIndex / 8);
      const bitOff1 = 7 - (bitIndex % 8);
      result[byteIdx1] |= bit1 << bitOff1;
      bitIndex++;

      if (bitIndex < totalBits) {
        const byteIdx2 = Math.floor(bitIndex / 8);
        const bitOff2 = 7 - (bitIndex % 8);
        result[byteIdx2] |= bit2 << bitOff2;
        bitIndex++;
      }
    }
  }

  return result;
}

// ─── IPC Handlers ─────────────────────────────────────────────

export function registerIpcHandlers(getTargetPath: () => string) {
  ipcMain.handle(IPC_CHANNELS.SELECT_IMAGE, async () => {
    const result = await dialog.showOpenDialog({
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
    const result = await dialog.showSaveDialog({
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
      defaultPath: 'obamafied.png',
    });
    if (result.canceled || !result.filePath) return null;

    const base64 = pngDataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const fs = await import('fs/promises');
    await fs.writeFile(result.filePath, buffer);
    return result.filePath;
  });

  // ─── LSB Steganography: Save ────────────────────────────────
  //
  // Embeds the permutation key into the pixel LSBs, then saves as PNG.
  // No metadata, no PNG chunks — the data is IN the pixel values.
  // Survives metadata stripping. Invisible to the human eye.
  //
  ipcMain.handle(
    IPC_CHANNELS.SAVE_OBAMACRYPT,
    async (_event, rgbaArray: number[], width: number, height: number, encodedKey: string) => {
      const result = await dialog.showSaveDialog({
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
        defaultPath: 'obamacrypted.png',
      });
      if (result.canceled || !result.filePath) return null;

      const rgba = new Uint8ClampedArray(rgbaArray);

      // Compress the key string
      const keyBuf = Buffer.from(encodedKey, 'utf-8');
      const compressed = zlib.deflateSync(keyBuf, { level: 9 });

      // Build the payload: magic(4) + length(4) + compressed data
      const header = Buffer.alloc(8);
      header.writeUInt32BE(LSB_MAGIC, 0);
      header.writeUInt32BE(compressed.length, 4);
      const payload = Buffer.concat([header, compressed]);

      console.log(
        `[obamacrypt] LSB embed: ${compressed.length} bytes compressed ` +
        `(${keyBuf.length} raw) into ${width}x${height} image ` +
        `(capacity: ${Math.floor((width * height * BITS_PER_PIXEL) / 8)} bytes)`
      );

      // Embed into pixel LSBs
      lsbEmbed(rgba, payload);

      // Save as PNG (lossless — preserves LSBs exactly)
      await sharp(Buffer.from(rgba.buffer), { raw: { width, height, channels: 4 } })
        .png({ compressionLevel: 9, palette: false })
        .toFile(result.filePath);

      return result.filePath;
    }
  );

  // ─── LSB Steganography: Read ────────────────────────────────
  //
  // Reads the raw RGBA pixels and extracts data from LSBs.
  // Returns null if no hidden data found (magic number mismatch).
  //
  ipcMain.handle(
    IPC_CHANNELS.READ_OBAMACRYPT,
    async (_event, imagePath: string) => {
      const fs = await import('fs/promises');
      const buf = await fs.readFile(imagePath);

      // Decode to raw RGBA
      const { data, info } = await sharp(buf)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);

      // Extract hidden data from LSBs
      const payload = lsbExtract(rgba);
      if (!payload) {
        console.log('[obamacrypt] No LSB data found in image');
        return null;
      }

      // Decompress
      try {
        const decompressed = zlib.inflateSync(payload);
        const key = decompressed.toString('utf-8');
        console.log(`[obamacrypt] LSB extract: ${payload.length} bytes compressed → ${key.length} chars`);
        return key;
      } catch {
        console.log('[obamacrypt] LSB data found but decompression failed');
        return null;
      }
    }
  );
}
