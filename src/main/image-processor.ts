import sharp from 'sharp';
import type { PixelData } from '../common/types.js';

/**
 * Load an image, center-crop to square, optionally resize,
 * and return raw RGBA pixel data.
 *
 * resolution=0 means use the original (cropped) size.
 */
export async function loadAndProcessImage(
  imagePath: string,
  resolution: number
): Promise<PixelData> {
  // Read file into buffer first to avoid Sharp file-path issues
  const fs = await import('fs/promises');
  const fileBuffer = await fs.readFile(imagePath);
  const image = sharp(fileBuffer).rotate(); // .rotate() auto-orients from EXIF
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions');
  }

  // Center-crop to square
  const size = Math.min(metadata.width, metadata.height);
  const left = Math.floor((metadata.width - size) / 2);
  const top = Math.floor((metadata.height - size) / 2);

  let pipeline = image
    .extract({ left, top, width: size, height: size });

  const finalSize = resolution > 0 ? resolution : size;

  if (resolution > 0) {
    pipeline = pipeline.resize(resolution, resolution, { kernel: sharp.kernel.lanczos3 });
  }

  const rawBuffer = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer();

  return {
    rgba: new Uint8ClampedArray(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength),
    width: finalSize,
    height: finalSize,
  };
}

/**
 * Load two images and resize both to the same square dimensions.
 * When resolution=0, uses the smaller of the two images' cropped sizes.
 */
export async function loadAndProcessPair(
  sourcePath: string,
  targetPath: string,
  resolution: number
): Promise<{ source: PixelData; target: PixelData; effectiveResolution: number }> {
  if (resolution > 0) {
    const [source, target] = await Promise.all([
      loadAndProcessImage(sourcePath, resolution),
      loadAndProcessImage(targetPath, resolution),
    ]);
    return { source, target, effectiveResolution: resolution };
  }

  // Original mode: determine shared size from the smaller image
  const fs = await import('fs/promises');
  const [srcBuf, tgtBuf] = await Promise.all([
    fs.readFile(sourcePath),
    fs.readFile(targetPath),
  ]);
  const [srcMeta, tgtMeta] = await Promise.all([
    sharp(srcBuf).rotate().metadata(),
    sharp(tgtBuf).rotate().metadata(),
  ]);

  const srcSize = Math.min(srcMeta.width ?? 512, srcMeta.height ?? 512);
  const tgtSize = Math.min(tgtMeta.width ?? 512, tgtMeta.height ?? 512);
  const shared = Math.min(srcSize, tgtSize);

  // Cap at 2048 to avoid GPU memory issues
  const capped = Math.min(shared, 2048);

  const [source, target] = await Promise.all([
    loadAndProcessImage(sourcePath, capped),
    loadAndProcessImage(targetPath, capped),
  ]);
  return { source, target, effectiveResolution: capped };
}
