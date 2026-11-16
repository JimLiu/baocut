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

/** 屏幕录制的界面文案（屏幕录制设计 §11）：入口、录制面板、会话卡片、恢复提示（英文是键与类型的来源）。 */
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

  // 面板
  title: 'Record screen',
  titleAgent: 'Record for this conversation',
  agentLead: 'The agent asked for a recording. Check the options, then start when you’re ready.',
  loading: 'Checking screens and devices…',
  loadFailed: (message: string) => `Couldn’t check screens and devices: ${message}`,
  retry: 'Try again',
  source: 'Record',
  sourceDisplay: 'Entire screen',
  sourceWindow: 'Window',
  sourceArea: 'Area',
  display: 'Screen',
  displayName: (name: string, width: number, height: number) => `${name} (${width} × ${height})`,
  displayMain: (name: string) => `${name} · Main`,
  window: 'Window',
  windowName: (app: string, title: string) => (title ? `${app} — ${title}` : app),
  includeSelf: 'Include BaoCut in the recording',
  includeSelfHint: 'When off, BaoCut’s windows and your conversations stay out of the video.',
  camera: 'Camera',
  microphone: 'Microphone',
  none: 'Don’t use',
  systemDefault: 'System default',
  systemAudio: 'System audio',
  systemAudioHint: 'Sound played by apps on this computer',
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
  countdownNone: 'No countdown',
  start: 'Start recording',
  cancel: 'Cancel',
  starting: 'Starting…',
  startFailed: (message: string) => `Couldn’t start recording: ${message}`,
  cancelled: 'Recording cancelled.',
  previewLabel: 'Camera preview',
  previewUnavailable: 'The preview appears once camera access is allowed.',
  previewFailed: 'Couldn’t show the camera preview.',
  levelLabel: 'Microphone level',
  levelUnavailable: 'The level appears once microphone access is allowed.',

  // 不可选的原因
  noDisplay: 'No screen found.',
  noWindow: 'No windows to record.',
  noAreaPicker: 'Drawing an area on screen isn’t available yet.',
  noCamera: 'No camera found.',
  noMicrophone: 'No microphone found.',

  // 权限
  permScreen: 'Screen Recording',
  permCamera: 'Camera',
  permMicrophone: 'Microphone',
  permInput: 'Input Monitoring',
  permStatus: (name: string, status: string) => `${name}: ${status}`,
  permGranted: 'Allowed',
  permAsk: 'macOS will ask when recording starts.',
  permDenied: (name: string) => `BaoCut isn’t allowed to use ${name}. Turn it on in System Settings.`,
  permUnknown: 'Permission status unknown.',
  openSettings: 'Open System Settings',
  needScreen: 'Screen Recording permission is required to record.',
  needOptional: (names: string) => `Turn on ${names} in System Settings, or stop using it, to start.`,
  unavailable: 'Recording isn’t available right now.',

  // 设备不在了
  cameraGone: (name: string | null) => (name ? `“${name}” isn’t connected, so the camera is off.` : 'The camera you used last time isn’t connected, so the camera is off.'),
  microphoneGone: (name: string | null) =>
    name ? `“${name}” isn’t connected, so the microphone is off.` : 'The microphone you used last time isn’t connected, so the microphone is off.',
  displayGone: 'The screen you used last time isn’t connected. Recording the main screen.',
  windowGone: 'The window you used last time is closed. Recording the entire screen.',

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
  shortcutHint: 'Shortcuts work everywhere while recording, even when BaoCut is hidden.',
  shortcutPress: 'Press keys…',
  shortcutNone: 'None',
  shortcutChange: 'Change',
  shortcutClear: 'Clear',
  shortcutReset: 'Reset',
  shortcutFailed: (names: string) => `Couldn’t set the shortcut for ${names}. Another app may be using it.`,
  hideWindow: 'Hide BaoCut while recording',
  hideWindowHint: 'Only the small control bar stays on screen. It isn’t recorded.',
};

export type RecordingMessages = typeof en;

export const RC = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
