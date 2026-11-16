import { defineMessages } from '@baocut/protocol';
import { zhHans } from './recording-copy.zh-Hans.ts';
import { zhHant } from './recording-copy.zh-Hant.ts';
import { ja } from './recording-copy.ja.ts';
import { ko } from './recording-copy.ko.ts';
import { es } from './recording-copy.es.ts';
import { fr } from './recording-copy.fr.ts';
import { de } from './recording-copy.de.ts';
import { nl } from './recording-copy.nl.ts';
import { ptBR } from './recording-copy.pt-BR.ts';
import { it } from './recording-copy.it.ts';
import { ru } from './recording-copy.ru.ts';
import { pl } from './recording-copy.pl.ts';
import { tr } from './recording-copy.tr.ts';
import { vi } from './recording-copy.vi.ts';

/** 屏幕录制的界面文案（屏幕录制设计 §11）：入口、启动器的落点行、会话卡片、恢复提示、设置（英文是键与类型的来源）。 */
const en = {
  // 入口
  record: 'Record',
  recordTip: 'Record your screen into a new video, without the agent',
  recordNewVideo: 'Record new video',
  recordIntoVideo: 'Record',
  recordIntoTip: 'Record your screen into this video, on a new track at the playhead',
  blockRemote: 'Only the computer running BaoCut can be recorded.',
  blockUnsupported: 'Screen recording isn’t available on this computer.',
  blockBusy: 'A recording is already in progress.',
  defaultProject: 'Recordings',

  // 启动器与录制卡（录制的小窗与入口共用）
  loading: 'Checking screens and devices…',
  loadFailed: (message: string) => `Couldn’t check screens and devices: ${message}`,
  retry: 'Try again',
  windowName: (app: string, title: string) => (title ? `${app} — ${title}` : app),
  includeSelf: 'Include BaoCut in the recording',
  systemDefault: 'System default',
  cursor: 'Mouse',
  cursorSeparate: 'Draw cursor separately',
  cursorBaked: 'Record cursor into the video',
  cursorNone: 'No cursor',
  cursorSeparateNote: 'You can resize or hide the cursor later.',
  cursorNoneNote: 'Without a cursor there’s no automatic zoom.',
  keys: 'Keyboard',
  keysOff: 'Don’t record',
  keysShortcuts: 'Shortcuts only',
  keysAll: 'All keys',
  keysAllNote: 'All keys includes the text you type.',
  countdown: 'Countdown',
  countdownSeconds: (n: number) => `${n} seconds`,
  cancel: 'Cancel',
  startFailed: (message: string) => `Couldn’t start recording: ${message}`,
  cancelled: 'Recording cancelled.',

  // 不能录的原因
  openSettings: 'Open System Settings',
  unavailableNoWorker: 'The screen recorder is missing from this copy of BaoCut. Reinstall BaoCut to record.',
  unavailableNoWindow: 'Open the BaoCut app on this computer to record.',
  diskLow: (free: string, minutes: number) => `Only ${free} free where recordings are saved, enough for about ${minutes} min. You can still start.`,

  // 设备不在了
  cameraGone: (name: string | null) => (name ? `“${name}” isn’t connected, so the camera is off.` : 'The camera you used last time isn’t connected, so the camera is off.'),
  microphoneGone: (name: string | null) =>
    name ? `“${name}” isn’t connected, so the microphone is off.` : 'The microphone you used last time isn’t connected, so the microphone is off.',
  displayGone: 'The screen you used last time isn’t connected. Recording the main screen.',
  windowGone: 'The window you used last time is closed. Recording the entire screen.',
  areaGone: 'The area you used last time no longer fits its screen. Select it again.',

  // 会话卡片
  cardTitle: 'Screen recording',
  cardWaiting: 'Waiting for you to start',
  cardCountdown: (n: number) => `Starting in ${n}…`,
  cardRecording: (elapsed: string) => `Recording · ${elapsed}`,
  cardPaused: (elapsed: string) => `Paused · ${elapsed}`,
  cardFinishing: 'Finishing the recording…',
  cardImportable: 'Recorded, not added to a video yet',
  cardDone: (duration: string) => `Added to the video · ${duration}`,
  cardFailed: (message: string) => `Recording failed: ${message}`,
  cardDiscarded: 'Recording discarded',
  cardOpenPanel: 'Open recorder',
  cardOpenVideo: 'Open video',

  // 启动时的恢复提示
  recoverTitle: 'A recording wasn’t finished',
  recoverBody: (date: string, duration: string) => `The recording from ${date} (${duration}) stopped before it was added to a video. Recover it, or delete the recorded files.`,
  recoverMore: (n: number) => (n === 1 ? '1 more unfinished recording' : `${n} more unfinished recordings`),
  recover: 'Recover',
  delete: 'Delete',
  deleteTitle: 'Delete this recording?',
  deleteBody: 'The recorded files are deleted. This can’t be undone.',
  recovering: 'Recovering the recording…',
  recoverFailed: (message: string) => `Couldn’t recover the recording: ${message}`,
  deleted: 'Recording deleted.',
  deleteFailed: (message: string) => `Couldn’t delete the recording: ${message}`,

  // 设置 › 通用 › 录制（桌面端）
  settingsGroup: 'Screen recording',
  shortcutStop: 'Stop recording',
  shortcutPause: 'Pause or resume',
  shortcutPress: 'Press keys…',
  shortcutNone: 'None',
  shortcutFailed: (names: string) => `Couldn’t set the shortcut for ${names}. Another app may be using it.`,
  defaultFps: 'Frame rate',
  fpsValue: (fps: number) => `${fps} fps`,

  // 启动器的落点行
  landingNew: (project: string) => (project ? `New video · ${project}` : 'New video'),
  landingInto: 'Add to this video',
  landingAgent: 'The agent asked for a recording',

  // 设置 › 通用 › 屏幕录制（桌面端）
  countdownHint: 'After you press start, the countdown runs in the control bar’s timer. The gear on the recording card changes this too.',
  countdownOff: 'Off',
  confirmNoMic: 'Ask before recording without a microphone',
  confirmNoMicHint: 'So you don’t find out afterwards that the recording has no sound.',
  mainWindow: 'Main window when recording starts',
  mainWindowHint: 'Only the control bar stays on screen, and it isn’t recorded. When you stop, BaoCut comes back and opens the editor.',
  mainWindowBackground: 'Hide',
  mainWindowMinimize: 'Minimize',
  afterDiscard: 'After discarding a recording',
  afterDiscardNone: 'Do nothing',
  afterDiscardLauncher: 'Reopen the recorder',
  defaultFpsHint: '60 fps files are about twice as large. Recordings the agent starts use the frame rate it asks for.',
  trayIcon: 'Menu bar icon',
  trayIconHint: 'Record a screen, window or area right from the menu bar. While recording, click it to stop.',
  shortcutsGroup: 'Recording shortcuts',
  shortcutHint: 'None are set by default: while a shortcut is set, other apps can’t use those keys. They work even when BaoCut is hidden.',
  shortcutLauncher: 'Open recorder',
  shortcutDisplay: 'Record screen',
  shortcutDisplayHint: 'Opens the screen picker directly.',
  shortcutWindow: 'Record window',
  shortcutArea: 'Record area',
  shortcutRestart: 'Restart recording',
  shortcutFor: (name: string) => `Shortcut for ${name}`,
  shortcutClearFor: (name: string) => `Clear the shortcut for ${name}`,
  shortcutNeedsModifierMac: 'Include ⌘, ⌥ or ⌃',
  shortcutNeedsModifierPc: 'Include Ctrl, Alt or Win',
  shortcutTaken: 'Another recording shortcut already uses these keys.',
};

export type RecordingMessages = typeof en;

export const RC = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
