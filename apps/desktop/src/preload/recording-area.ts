import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AreaPayload } from '../main/recording/area-picker.ts';

/** 录制区域的选框（屏幕录制设计 §11 第 1 项）：只收主进程给的文字、交回拖出来的两个点（null 是取消）。 */
contextBridge.exposeInMainWorld('recordingArea', {
  onView: (listener: (view: AreaPayload) => void) => {
    const handler = (_event: IpcRendererEvent, view: AreaPayload) => listener(view);
    ipcRenderer.on('baocut:recording-area-view', handler);
    ipcRenderer.send('baocut:recording-area-ready');
    return () => void ipcRenderer.removeListener('baocut:recording-area-view', handler);
  },
  done: (drag: { from: { x: number; y: number }; to: { x: number; y: number } } | null) =>
    ipcRenderer.send('baocut:recording-area-done', drag ? { from: { x: drag.from.x, y: drag.from.y }, to: { x: drag.to.x, y: drag.to.y } } : null),
});
