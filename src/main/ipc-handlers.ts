import { ipcMain, dialog, BrowserWindow } from 'electron';
import path from 'path';
import { loadAndProcessImage, loadAndProcessPair } from './image-processor.js';
import { IPC_CHANNELS } from '../common/constants.js';

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
}
