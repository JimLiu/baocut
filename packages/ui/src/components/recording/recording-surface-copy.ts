import { defineMessages } from '@baocut/protocol';
import { zhHans } from './recording-surface-copy.zh-Hans.ts';
import { zhHant } from './recording-surface-copy.zh-Hant.ts';
import { ja } from './recording-surface-copy.ja.ts';
import { ko } from './recording-surface-copy.ko.ts';
import { es } from './recording-surface-copy.es.ts';
import { fr } from './recording-surface-copy.fr.ts';
import { de } from './recording-surface-copy.de.ts';
import { nl } from './recording-surface-copy.nl.ts';
import { ptBR } from './recording-surface-copy.pt-BR.ts';
import { it } from './recording-surface-copy.it.ts';
import { ru } from './recording-surface-copy.ru.ts';
import { pl } from './recording-surface-copy.pl.ts';
import { tr } from './recording-surface-copy.tr.ts';
import { vi } from './recording-surface-copy.vi.ts';

/** 录制的小窗（屏幕录制设计 §11）：启动器、选取覆盖层与录制卡、控制条、摄像头浮窗（英文是键与类型的来源）。 */
const en = {
  // 启动器
  launcher: 'Recorder',
  close: 'Close recorder',
  settings: 'Recording settings',
  settingsTip: 'Settings › General › Screen recording',
  backToEditor: 'Back to the editor',
  screenBlocked: 'Allow BaoCut to record your screen in System Settings first.',
  targets: 'What to record',
  targetDisplay: 'Screen',
  targetWindow: 'Window',
  targetArea: 'Area',
  chooseDisplay: 'Choose a screen',
  chooseWindow: 'Choose a window',
  devices: 'Camera and microphone',
  camera: 'Camera',
  microphone: 'Microphone',
  systemAudio: 'System audio',
  noCamera: 'No camera',
  noMicrophone: 'No microphone',
  systemOn: 'Record system audio',
  systemOff: 'Don’t record system audio',
  pillOn: 'On',
  pillOff: 'Off',
  pillMissing: 'Not connected',
  pillAllow: 'Allow',
  pillLabel: (row: string, state: string) => `${row}: ${state}`,
  more: 'More options',
  cursorBakedNote: 'The cursor is recorded into the picture and can’t be changed later.',
  selfOn: 'BaoCut’s windows appear in the video, except the control bar.',
  selfOff: 'BaoCut’s own windows aren’t recorded.',
  cameraMissing: (name: string) => `“${name}” isn’t connected, so the camera won’t be recorded.`,
  back: 'Back',
  search: (title: string) => `Search: ${title}`,
  empty: (query: string) => `Nothing matches “${query}”`,
  displayMeta: (width: number, height: number, main: boolean) => (main ? `${width} × ${height} · Main` : `${width} × ${height}`),

  // 选取覆盖层
  picker: 'Choose what to record',
  displayInfo: (width: number, height: number, fps: number) => `${width}×${height} · ${fps} FPS`,
  windowHint: 'Move the pointer over the window you want, then click to choose it',
  windowList: 'Choose a window to record',
  adjustArea: 'Adjust recording area',
  areaHint: 'Drag to select an area',
  areaHintSub: 'Or click a window to fit the area to it',
  areaTools: 'Area',
  areaEmpty: 'Draw an area',
  ratio: 'Aspect ratio',
  ratioFree: 'Free',
  reset: 'Reset selection',
  fill: 'Fill screen',
  lock: 'Lock area',
  lockOn: 'Locked: used again next time and can’t be dragged',
  lockOff: 'Lock the area to use it again next time and avoid stray drags',
  tooSmall: (min: number) => `Minimum ${min} × ${min}`,
  tooSmallSize: (size: string) => `${size} is too small`,

  // 录制卡
  cancel: 'Cancel',
  cancelTip: 'Cancel and go back to the recorder',
  start: 'Start recording',
  countdown: 'Countdown',
  recordingOptions: 'Recording options',
  countdownOff: 'Off',
  countdownSeconds: (n: number) => `${n} sec`,
  noMicTitle: 'No microphone selected',
  noMicBody: 'This recording won’t have your voice. Choose a microphone, or continue without one.',
  noMicNever: 'Don’t ask again',
  noMicGo: 'Continue without microphone',

  // 控制条
  bar: 'Recording controls',
  stop: 'Stop recording',
  stopCountdown: (n: number) => `Stop (starts in ${n} s)`,
  stopClock: (time: string) => `Stop recording · ${time}`,
  starting: 'Starting',
  finishing: 'Finishing…',
  paused: 'Paused',
  pause: 'Pause',
  resume: 'Resume',
  restart: 'Restart',
  discard: 'Discard',
  grip: 'Drag the control bar',
  micLevel: 'Microphone level',
  micOff: 'No microphone',
  restartTitle: 'Restart recording?',
  restartBody: 'This recording will be discarded.',
  discardTitle: 'Discard this recording?',
  discardBody: 'What you recorded so far is deleted.',
  keep: 'Keep recording',
  diskAlert: (minutes: number) => `Disk almost full: about ${minutes} min left. Recording stops and saves when it runs out.`,
  lostAlert: (names: string) => `${names} disconnected. The rest keeps recording.`,
  sleptAlert: 'Paused while the computer was asleep. Press Resume to keep recording.',
  dismiss: 'Got it',
  roleScreen: 'Screen',
  roleCamera: 'Camera',
  roleMicrophone: 'Microphone',
  roleSystemAudio: 'System audio',
  rolePointer: 'Mouse',
  roleKeyboard: 'Keyboard',

  // 摄像头浮窗
  cameraPreview: (name: string) => `Camera preview: ${name}`,
  cameraTools: 'Camera preview',
  cameraClose: 'Close camera preview',
  cameraCloseTip: 'Don’t use the camera',
  cameraHideTip: 'Hide the preview (the camera keeps recording)',
  sizeLarger: 'Make larger',
  sizeSmaller: 'Make smaller',
  shape: 'Shape',
  shapeTip: (name: string) => `Shape: ${name} (click to change)`,
  shapeRound: 'Round',
  shapeSquare: 'Square',
  shapeWide: 'Widescreen 16:9',
  mirror: 'Mirror',
};

export type RecordingSurfaceMessages = typeof en;

export const RS = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
