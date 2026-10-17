import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { AppUpdateNotice, AppUpdateSnapshot, HostBridge, UpdatesHost } from '@baocut/ui';

type WebHost = NonNullable<HostBridge['web']>;
type WebTabState = Parameters<Parameters<WebHost['onState']>[0]>[0];

/**
 * 网页标签（架构设计 §12.10）：视图在主进程里，这里只转发调用与状态。参数在主进程里重新校验。
 */
const web: WebHost = {
  create: () => ipcRenderer.invoke('baocut:web-create'),
  navigate: (id, url) => ipcRenderer.invoke('baocut:web-navigate', id, url),
  back: (id) => ipcRenderer.send('baocut:web-back', id),
  forward: (id) => ipcRenderer.send('baocut:web-forward', id),
  reload: (id, ignoreCache) => ipcRenderer.send('baocut:web-reload', id, ignoreCache === true),
  find: (id, query, options) => ipcRenderer.send('baocut:web-find', id, { query, forward: options?.forward, next: options?.next }),
  stopFind: (id) => ipcRenderer.send('baocut:web-find-stop', id),
  setViewport: (id, size) => ipcRenderer.send('baocut:web-viewport', id, size ? { width: size.width, height: size.height } : null),
  onShortcut: (listener) => {
    const handler = (_event: IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
    ipcRenderer.on('baocut:web-shortcut', handler);
    return () => void ipcRenderer.removeListener('baocut:web-shortcut', handler);
  },
  stop: (id) => ipcRenderer.send('baocut:web-stop', id),
  setZoom: (id, percent) => ipcRenderer.send('baocut:web-zoom', id, percent),
  setBounds: (id, bounds) =>
    ipcRenderer.send('baocut:web-bounds', id, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }),
  setVisible: (id, visible) => ipcRenderer.send('baocut:web-visible', id, visible),
  destroy: (id) => ipcRenderer.send('baocut:web-destroy', id),
  onState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: WebTabState) => listener(state);
    ipcRenderer.on('baocut:web-state', handler);
    return () => void ipcRenderer.removeListener('baocut:web-state', handler);
  },
  clearData: () => ipcRenderer.invoke('baocut:web-clear-data'),
};

/**
 * 应用自动更新（架构设计 §2.6）：检查、下载、校验、换包都在主进程里，这里只转发调用并订阅状态与提醒。
 */
const updates: UpdatesHost = {
  get: () => ipcRenderer.invoke('baocut:updates-get'),
  onState: (listener) => {
    const handler = (_event: IpcRendererEvent, snapshot: AppUpdateSnapshot) => listener(snapshot);
    ipcRenderer.on('baocut:updates-state', handler);
    return () => void ipcRenderer.removeListener('baocut:updates-state', handler);
  },
  onNotice: (listener) => {
    const handler = (_event: IpcRendererEvent, notice: AppUpdateNotice) => listener(notice);
    ipcRenderer.on('baocut:updates-notice', handler);
    return () => void ipcRenderer.removeListener('baocut:updates-notice', handler);
  },
  configure: (prefs) => ipcRenderer.send('baocut:updates-configure', { autoCheck: prefs.autoCheck, autoDownload: prefs.autoDownload }),
  check: () => ipcRenderer.invoke('baocut:updates-check'),
  download: () => ipcRenderer.invoke('baocut:updates-download'),
  cancel: () => ipcRenderer.invoke('baocut:updates-cancel'),
  install: () => ipcRenderer.invoke('baocut:updates-install'),
  openDownloadPage: () => ipcRenderer.invoke('baocut:updates-open-download-page'),
};

/**
 * 渲染进程能用的全部原生能力。保持最小：业务请求不经过这里，界面直连 Runtime。
 * 形状与 @baocut/ui 的 HostBridge 一致。
 */
contextBridge.exposeInMainWorld('baocut', {
  platform: process.platform,
  getConnection: () => ipcRenderer.invoke('baocut:connection'),
  pickDirectory: (options?: { title?: string }) => ipcRenderer.invoke('baocut:pick-directory', options),
  pickMediaFiles: () => ipcRenderer.invoke('baocut:pick-media'),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  revealPath: (target: string) => ipcRenderer.invoke('baocut:reveal', target),
  openFile: (target: string) => ipcRenderer.invoke('baocut:open-file', target),
  // 删除项目品牌：BRAND.md 与 brand/ 移到废纸篓（路径在主进程里重新校验）。
  trashProjectBrand: (projectPath: string) => ipcRenderer.invoke('baocut:trash-project-brand', projectPath),
  web,
  updates,
  openExternal: (url: string) => ipcRenderer.invoke('baocut:open-external', url),
  pickMessageFiles: (options) => ipcRenderer.invoke('baocut:pick-message-files', options),
  pickFiles: (options) => ipcRenderer.invoke('baocut:pick-files', options),
  pickSavePath: (options) => ipcRenderer.invoke('baocut:pick-save-path', options),
  saveFile: (options) => ipcRenderer.invoke('baocut:save-file', options),
  // 下载 Runtime 媒体通道里的文件：主进程弹存储对话框并流式写盘（地址在主进程里重新校验）。
  saveUrl: (options) => ipcRenderer.invoke('baocut:save-url', options),
  // 我的声音 › 克隆新音色：录好的 WAV 写进临时目录，路径交给 Runtime（内容在主进程里重新校验）。
  writeRecording: (data) => ipcRenderer.invoke('baocut:write-recording', data),
  // 生成图片：粘贴或拖进来、没有本机路径的参考图写进临时目录，路径交给 Runtime（内容在主进程里重新校验）。
  writeImageRef: (data) => ipcRenderer.invoke('baocut:write-image-ref', data),
  // 界面语言：主进程据此换应用菜单与对话框的语言（参数在主进程里重新校验）。
  setLocale: (locale) => ipcRenderer.send('baocut:set-locale', locale),
} satisfies HostBridge);
