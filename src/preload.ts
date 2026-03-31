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

  saveObamacrypt: (rgba: number[], width: number, height: number, encodedKey: string, method: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_OBAMACRYPT, rgba, width, height, encodedKey, method),

  readObamacrypt: (imagePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.READ_OBAMACRYPT, imagePath),

  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // Auto-updater
  onUpdateAvailable: (cb: (version: string) => void) =>
    ipcRenderer.on(IPC_CHANNELS.UPDATE_AVAILABLE, (_e, version) => cb(version)),
  onUpdateProgress: (cb: (percent: number) => void) =>
    ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, (_e, percent) => cb(percent)),
  onUpdateDownloaded: (cb: (version: string) => void) =>
    ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOADED, (_e, version) => cb(version)),
  installUpdate: () => ipcRenderer.send(IPC_CHANNELS.UPDATE_INSTALL),
});
