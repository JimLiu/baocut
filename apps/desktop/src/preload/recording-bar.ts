import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BarPayload } from '../main/recording/recording-service.ts';

/** 录制控制条（屏幕录制设计 §11「录制中」）：只收主进程给的样子、回报按了哪个按钮。 */
contextBridge.exposeInMainWorld('recordingBar', {
  onView: (listener: (view: BarPayload) => void) => {
    const handler = (_event: IpcRendererEvent, view: BarPayload) => listener(view);
    ipcRenderer.on('baocut:recording-bar-view', handler);
    ipcRenderer.send('baocut:recording-bar-ready');
    return () => void ipcRenderer.removeListener('baocut:recording-bar-view', handler);
  },
  act: (action: 'pause' | 'resume' | 'stop' | 'discard') => ipcRenderer.invoke('baocut:recording-bar-act', action),
});
