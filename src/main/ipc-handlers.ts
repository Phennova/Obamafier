import { ipcMain, dialog, BrowserWindow } from 'electron';
import path from 'path';
import zlib from 'zlib';
import sharp from 'sharp';
import { loadAndProcessImage, loadAndProcessPair } from './image-processor.js';
import { IPC_CHANNELS, OBAMACRYPT_META_KEY } from '../common/constants.js';

/**
 * Inject a tEXt chunk into a PNG buffer, right before the IEND chunk.
 * PNG tEXt chunks are invisible to image viewers — only programs
 * that specifically search for the keyword can find the data.
 */
function injectPngTextChunk(png: Buffer, keyword: string, text: string): Buffer {
  // Compress the text to reduce file size (use zTXt compressed text chunk)
  const keyBuf = Buffer.from(keyword, 'latin1');
  const textBuf = zlib.deflateSync(Buffer.from(text, 'latin1'));

  // zTXt chunk data: keyword + null + compression_method(0) + compressed_text
  const chunkData = Buffer.concat([
    keyBuf,
    Buffer.from([0x00, 0x00]), // null separator + compression method (0 = zlib)
    textBuf,
  ]);

  // PNG chunk: length(4) + type(4) + data + crc(4)
  const chunkType = Buffer.from('zTXt', 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(chunkData.length);

  // CRC32 over type + data
  const crc = crc32(Buffer.concat([chunkType, chunkData]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc);

  const chunk = Buffer.concat([lengthBuf, chunkType, chunkData, crcBuf]);

  // Insert before the IEND chunk (last 12 bytes of any PNG)
  const iendOffset = png.length - 12;
  return Buffer.concat([
    png.subarray(0, iendOffset),
    chunk,
    png.subarray(iendOffset),
  ]);
}

/**
 * Extract a zTXt chunk value from a PNG buffer by keyword.
 */
function extractPngTextChunk(png: Buffer, keyword: string): string | null {
  // PNG signature is 8 bytes, then chunks
  let offset = 8;
  while (offset < png.length - 12) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');

    if (type === 'zTXt') {
      const data = png.subarray(offset + 8, offset + 8 + length);
      // Find null separator
      const nullIdx = data.indexOf(0x00);
      if (nullIdx > 0) {
        const key = data.subarray(0, nullIdx).toString('latin1');
        if (key === keyword) {
          // Skip compression method byte (index nullIdx+1)
          const compressed = data.subarray(nullIdx + 2);
          const decompressed = zlib.inflateSync(compressed);
          return decompressed.toString('latin1');
        }
      }
    }

    // Also check plain tEXt chunks
    if (type === 'tEXt') {
      const data = png.subarray(offset + 8, offset + 8 + length);
      const nullIdx = data.indexOf(0x00);
      if (nullIdx > 0) {
        const key = data.subarray(0, nullIdx).toString('latin1');
        if (key === keyword) {
          return data.subarray(nullIdx + 1).toString('latin1');
        }
      }
    }

    offset += 12 + length; // 4(length) + 4(type) + data + 4(crc)
  }
  return null;
}

/** CRC32 for PNG chunks */
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

export function registerIpcHandlers(getTargetPath: () => string) {
  // Open file dialog and return the selected path
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

  // Load and process an image, return raw pixel data
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

  // Process both source and target images
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

  // Export: save a PNG buffer to disk
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

  // Save obamacrypted PNG with permutation hidden in PNG tEXt chunk
  ipcMain.handle(
    IPC_CHANNELS.SAVE_OBAMACRYPT,
    async (_event, rgbaArray: number[], width: number, height: number, encodedKey: string) => {
      const result = await dialog.showSaveDialog({
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
        defaultPath: 'obamacrypted.png',
      });
      if (result.canceled || !result.filePath) return null;

      const rgba = Buffer.from(new Uint8ClampedArray(rgbaArray).buffer);

      // The key is embedded as a PNG tEXt chunk with a custom keyword.
      // Normal image viewers ignore unknown tEXt chunks entirely —
      // only Obamafier knows to look for this specific keyword.
      await sharp(rgba, { raw: { width, height, channels: 4 } })
        .png({
          compressionLevel: 9,
          palette: false,
        })
        .withMetadata()
        .toFile(result.filePath);

      // Sharp doesn't support writing arbitrary tEXt chunks directly,
      // so we manually inject the chunk into the PNG binary.
      const fs = await import('fs/promises');
      const pngBuf = await fs.readFile(result.filePath);
      const withKey = injectPngTextChunk(pngBuf, OBAMACRYPT_META_KEY, encodedKey);
      await fs.writeFile(result.filePath, withKey);

      return result.filePath;
    }
  );

  // Read obamacrypt permutation from PNG tEXt chunk
  ipcMain.handle(
    IPC_CHANNELS.READ_OBAMACRYPT,
    async (_event, imagePath: string) => {
      const fs = await import('fs/promises');
      const pngBuf = await fs.readFile(imagePath);
      return extractPngTextChunk(pngBuf, OBAMACRYPT_META_KEY);
    }
  );
}
