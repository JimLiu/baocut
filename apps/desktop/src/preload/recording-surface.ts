import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { RecordingSurfaceAction, RecordingSurfaceBridge, RecordingSurfaceState } from '@baocut/ui';

/**
 * 录制的小窗（启动器、选取覆盖层、控制条、摄像头浮窗；屏幕录制设计 §11）：从主进程拿这扇窗是哪一种、同一份状态，回报动作。
 * 不给别的原生能力；动作的参数在主进程里重新校验。
 */
const bridge: RecordingSurfaceBridge = {
  init: () => ipcRenderer.invoke('baocut:recording-surface-init'),
  onState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: RecordingSurfaceState) => listener(state);
    ipcRenderer.on('baocut:recording-surface-state', handler);
    ipcRenderer.send('baocut:recording-surface-ready');
    return () => void ipcRenderer.removeListener('baocut:recording-surface-state', handler);
  },
  act: (action: RecordingSurfaceAction) => ipcRenderer.invoke('baocut:recording-surface-act', action),
};

contextBridge.exposeInMainWorld('recordingSurface', bridge);
