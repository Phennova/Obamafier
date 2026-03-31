import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS } from './common/constants.js';
import type { Resolution } from './common/types.js';

contextBridge.exposeInMainWorld('electronAPI', {
  selectImage: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_IMAGE),

  loadImage: (imagePath: string, resolution: Resolution) =>
    ipcRenderer.invoke(IPC_CHANNELS.LOAD_IMAGE, imagePath, resolution),

  processImages: (sourcePath: string, resolution: Resolution) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROCESS_IMAGES, sourcePath, resolution),

  getTargetPath: () => ipcRenderer.invoke(IPC_CHANNELS.GET_TARGET_PATH),

  exportFrame: (pngDataUrl: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXPORT_FRAME, pngDataUrl),

  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
