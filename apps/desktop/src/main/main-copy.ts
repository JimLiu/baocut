import { defineMessages } from '@baocut/protocol';
import { zhHans } from './main-copy.zh-Hans.ts';
import { zhHant } from './main-copy.zh-Hant.ts';
import { ja } from './main-copy.ja.ts';
import { ko } from './main-copy.ko.ts';
import { es } from './main-copy.es.ts';
import { fr } from './main-copy.fr.ts';
import { de } from './main-copy.de.ts';
import { nl } from './main-copy.nl.ts';
import { ptBR } from './main-copy.pt-BR.ts';
import { it } from './main-copy.it.ts';
import { ru } from './main-copy.ru.ts';
import { pl } from './main-copy.pl.ts';
import { tr } from './main-copy.tr.ts';
import { vi } from './main-copy.vi.ts';

/**
 * 桌面端主进程的文案：应用菜单、打开 / 存储对话框、退出确认、Runtime 起不来与网页标签的错误。英文是键与类型的来源，译文在
 * `main-copy.<语言>.ts`。菜单项沿用各平台的固定说法（Electron 缺省菜单的英文）；界面语言变了主进程重建菜单（index.ts）。
 */
const en = {
  // ---- 应用菜单（app-menu.ts）----
  about: (app: string) => `About ${app}`,
  services: 'Services',
  hide: (app: string) => `Hide ${app}`,
  hideOthers: 'Hide Others',
  showAll: 'Show All',
  quit: (app: string) => `Quit ${app}`,
  exit: 'Exit',
  fileMenu: 'File',
  closeWindow: 'Close Window',
  close: 'Close',
  editMenu: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  pasteAndMatchStyle: 'Paste and Match Style',
  delete: 'Delete',
  selectAll: 'Select All',
  speech: 'Speech',
  startSpeaking: 'Start Speaking',
  stopSpeaking: 'Stop Speaking',
  viewMenu: 'View',
  reload: 'Reload',
  forceReload: 'Force Reload',
  toggleDevTools: 'Toggle Developer Tools',
  actualSize: 'Actual Size',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  toggleFullScreen: 'Toggle Full Screen',
  windowMenu: 'Window',
  minimize: 'Minimize',
  zoom: 'Zoom',
  bringAllToFront: 'Bring All to Front',

  // ---- 对话框（index.ts）----
  openProjectTitle: 'Open project folder',
  open: 'Open',
  choose: 'Choose',
  importAssetsTitle: 'Import assets',
  importButton: 'Import',
  mediaFilter: 'Videos, audio, and images',
  allFilesFilter: 'All files',
  openFileTitle: 'Open file',
  save: 'Save',

  // ---- Runtime 起不来或不再拉起（runtime-supervisor.ts，经 `getConnection` 到界面）----
  runtimeNoDiscovery: 'Runtime started but didn’t write its discovery file',
  runtimeTimeout: 'Runtime took too long to start',
  runtimeExited: (code: number | null) => `Runtime failed to start (exit code ${code})`,
  runtimeQuitting: 'The app is quitting',

  // ---- 退出时自己起的 Runtime 还有活（quit-prompt.ts，架构设计 §2.2）----
  quitBusyTitle: (count: number) => (count === 1 ? '1 task is still running' : `${count} tasks are still running`),
  quitBusyDetail: 'Quitting now interrupts them. You can keep them running in the background instead; BaoCut stops by itself after they finish.',
  quitKeepRunning: 'Keep Running in Background',
  quitStop: 'Stop and Quit',
  relaunchBusyDetail: 'Restarting now interrupts them, so the new permission can take effect.',
  relaunchStop: 'Stop and Restart',
  cancel: 'Cancel',
  // 已经交给 Provider 的调用：停下 Runtime 也不会在那边取消（退出对话框里列出）。
  remoteHeading: 'Already sent out. Stopping won’t cancel these at the provider, and they may still be billed:',
  remoteMore: (count: number) => `and ${count} more`,
  /** 调用出自哪种任务（同界面任务列表的叫法）；没有任务记录的是 Agent 任务，别的种类叫「任务」。 */
  callKind: {
    agent: 'Agent task',
    task: 'Task',
    transcribe: 'Transcribe',
    synthesizeSpeech: 'Generate speech',
    generateImage: 'Generate image',
    generateMusic: 'Generate music',
    generateText: 'Generate text',
    modelTest: 'Check model',
    voiceClone: 'Clone voice',
    agentTranslate: 'Translate',
  },

  // ---- 网页标签（web-tabs.ts）----
  webCreateNotWindow: 'Only app windows can create web tabs',
  webTooManyTabs: 'Too many web tabs are open',
  webTabMissing: 'This web tab no longer exists',
  webClearNotWindow: 'Only app windows can clear web data',
  webOpenNotWindow: 'Only app windows can open external links',
  webOpenScheme: 'Only http and https URLs can be opened',
};

export type MainMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
