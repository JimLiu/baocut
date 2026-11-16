import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-recordings.zh-Hans.ts';
import { zhHant } from './rc-recordings.zh-Hant.ts';
import { ja } from './rc-recordings.ja.ts';
import { ko } from './rc-recordings.ko.ts';
import { es } from './rc-recordings.es.ts';
import { fr } from './rc-recordings.fr.ts';
import { de } from './rc-recordings.de.ts';
import { nl } from './rc-recordings.nl.ts';
import { ptBR } from './rc-recordings.pt-BR.ts';
import { it } from './rc-recordings.it.ts';
import { ru } from './rc-recordings.ru.ts';
import { pl } from './rc-recordings.pl.ts';
import { tr } from './rc-recordings.tr.ts';
import { vi } from './rc-recordings.vi.ts';

/**
 * 屏幕录制（docs/design/screen-recording §7、§11–§13）里 Runtime 写给人看的文字：导入的撤销标签、新视频的名字、方法与任务的错误。
 * 智能体看的工具说明是英文，写在 `runtime-core/src/agent-tools/recording-tools.ts`。
 */
const en = {
  importLabel: 'Import screen recording',
  videoName: (p: { stamp: string }) => `Screen recording ${p.stamp}`,

  // ---- 权限 ----
  permScreen: 'Screen recording',
  permCamera: 'Camera',
  permMicrophone: 'Microphone',
  permInputMonitoring: 'Input Monitoring',
  permissionDenied: (p: { names: string }) =>
    `BaoCut doesn't have access to: ${p.names}. Turn it on in System Settings, then try again. BaoCut never changes these settings for you.`,

  // ---- 能不能录 ----
  unsupportedPlatform: 'Screen recording is not available on this system yet.',
  noWorker: 'The recording component is missing. Reinstall BaoCut or build the recording worker.',
  noWindow: 'Recording needs the BaoCut desktop app open on this computer. Open BaoCut and try again.',
  remote: 'Recording only works on the computer that runs BaoCut, not on a remote connection.',
  unattended: "Recording needs someone at the computer, so it can't start from a scheduled or unattended task.",
  busy: 'Another recording is in progress. Stop or discard it first.',
  diskFull: (p: { free: string }) => `Not enough free disk space to record (${p.free} left).`,
  sourceNotFound: 'The screen or window to record is no longer available.',
  sourceNotCapturable: "The window can't be recorded right now: it is hidden, minimized or on another desktop. Bring it onto the screen and try again.",

  // ---- 状态 ----
  notFound: (p: { id: string }) => `Recording not found: ${p.id}`,
  notWaiting: 'This recording has already started or ended.',
  notRecording: 'Nothing is being recorded right now.',
  notPaused: 'The recording is not paused.',
  closedBeforeStart: 'The recording panel was closed before recording started.',
  alreadyImported: "This recording is already in a video, so it can't be discarded here. Undo or delete it in the video instead.",
  stillActive: 'Stop the recording before recovering it.',
  notRecoverable: 'This recording has nothing left to recover.',
  videoNotFound: (p: { id: string }) => `Video not found: ${p.id}`,
  targetNeeded: 'Choose a project or a video for the recording.',

  // ---- 失败 ----
  workerFailed: (p: { reason: string }) => `Recording stopped unexpectedly: ${p.reason}`,
  workerCrashed: 'The recorder quit unexpectedly. What was recorded so far was kept and can be recovered.',
  empty: 'Nothing was recorded.',
  journalInvalid: 'The recording files are damaged and could not be read.',
  diskLowStopped: 'The disk is almost full, so recording stopped. What was recorded so far was kept.',
  importFailed: (p: { reason: string }) => `The recording could not be added to the video: ${p.reason}`,
  interrupted: 'BaoCut stopped while recording. What was recorded so far was kept and can be recovered.',

  // ---- 确认（会话里的审批卡） ----
  confirmPause: 'Pause the screen recording',
  confirmResume: 'Resume the screen recording',
  confirmStop: 'Stop the screen recording and add it to the video',
  confirmDiscard: 'Discard the screen recording and delete its files',
  confirmRecover: 'Finish the unfinished screen recording and add it to the video',
};

export type RcRecordingsMessages = typeof en;

export const RcRecordings = defineCatalog('rcRecordings', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
