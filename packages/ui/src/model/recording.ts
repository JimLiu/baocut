import type {
  Id,
  RecordingCursorMode,
  RecordingKeysMode,
  RecordingOptions,
  RecordingPermissions,
  RecordingSource,
  RecordingSources,
  RecordingState,
  RecordingSummary,
  SystemAccessState,
} from '@baocut/protocol';
import { RECORDING_DEFAULTS } from '@baocut/protocol';

/*
 * 屏幕录制的界面规则（屏幕录制设计 §11）：入口能不能用、面板各项能不能选、上次的选择怎样落到这台电脑现在的设备上。
 * 都是纯函数，面板、入口与测试共用；文字在组件里按 `RecordingBlock` / `RecordingNotice` 的种类取。
 */

/** 问 `recordings.sources` 的结果：还在问、问到了、被拒绝（`code` 与 `details.reason` 是 Runtime 给的）。 */
export type SourcesState =
  | { status: 'idle' }
  | { status: 'loading'; last: RecordingSources | null }
  | { status: 'ready'; sources: RecordingSources }
  | { status: 'error'; code: string | null; reason: string | null; message: string };

/** 入口为什么不能用：`remote` 连着别的电脑上的 Runtime；`unsupported` 这台电脑录不了（`text` 是 Runtime 的原因）；`busy` 已有一次在录。 */
export type RecordingBlock = { kind: 'remote' } | { kind: 'unsupported'; text: string | null } | { kind: 'busy' };

export type RecordingEntry = { kind: 'hidden' } | { kind: 'disabled'; block: RecordingBlock } | { kind: 'ready' };

/** 录制中、收尾前的状态：这时不能再开一次（`RECORDING_BUSY`）。 */
const LIVE: ReadonlySet<RecordingState> = new Set(['preparing', 'countdown', 'recording', 'paused', 'stopping']);

export function isLiveRecording(state: RecordingState): boolean {
  return LIVE.has(state);
}

/** 录完、导入完或放弃之后不再变的状态。 */
export function isSettledRecording(state: RecordingState): boolean {
  return state === 'in-timeline' || state === 'failed' || state === 'discarded';
}

/**
 * 入口的样子（§11）：Web 与没有录制能力的宿主不显示；Runtime 说不能录（远程、平台不支持、没有 Worker）时置灰并给原因；
 * 已有一次在录时置灰。还没问到来源时照常可点，面板里再等。
 */
export function recordingEntry(input: {
  platform: string;
  hostCapable: boolean;
  sources: SourcesState;
  recordings: readonly RecordingSummary[];
}): RecordingEntry {
  if (input.platform === 'web' || !input.hostCapable) return { kind: 'hidden' };
  const s = input.sources;
  if (s.status === 'error' && s.code === 'RECORDING_UNAVAILABLE') {
    return { kind: 'disabled', block: s.reason === 'remote' ? { kind: 'remote' } : { kind: 'unsupported', text: s.message || null } };
  }
  if (s.status === 'ready' && !s.sources.available) return { kind: 'disabled', block: { kind: 'unsupported', text: s.sources.reason } };
  if (input.recordings.some((r) => isLiveRecording(r.state))) return { kind: 'disabled', block: { kind: 'busy' } };
  return { kind: 'ready' };
}

/** 面板记住的选择（按这台电脑记，localStorage）。设备按 ID 记，名字留着在设备不在时提示。 */
export interface RecordingChoice {
  source: 'display' | 'window' | 'area';
  displayId: string | null;
  windowId: string | null;
  camera: string | null;
  cameraName: string | null;
  microphone: string | null;
  microphoneName: string | null;
  systemAudio: boolean;
  cursor: RecordingCursorMode;
  keys: RecordingKeysMode;
  countdown: number;
}

export const DEFAULT_CHOICE: RecordingChoice = {
  source: 'display',
  displayId: null,
  windowId: null,
  camera: RECORDING_DEFAULTS.camera,
  cameraName: null,
  microphone: RECORDING_DEFAULTS.microphone,
  microphoneName: null,
  systemAudio: RECORDING_DEFAULTS.systemAudio,
  cursor: RECORDING_DEFAULTS.cursor,
  keys: RECORDING_DEFAULTS.keys,
  countdown: RECORDING_DEFAULTS.countdown,
};

export const COUNTDOWNS = [3, 5, 0] as const;

/** 设备不在了退回「不用」时的提示种类，带上次记下的名字。 */
export type RecordingNotice =
  | { kind: 'camera-gone'; name: string | null }
  | { kind: 'microphone-gone'; name: string | null }
  | { kind: 'display-gone' }
  | { kind: 'window-gone' };

/**
 * 把记下的选择落到这台电脑现在的设备上：摄像头、麦克风不在了退回「不用」，屏幕不在了退回主屏，窗口不在了退回整块屏幕，各给一条提示。
 * 区域没有选框，退回整块屏幕（不提示，入口本来就不可选）。
 */
export function resolveChoice(choice: RecordingChoice, sources: RecordingSources): { choice: RecordingChoice; notices: RecordingNotice[] } {
  const next = { ...choice };
  const notices: RecordingNotice[] = [];
  if (next.camera !== null && next.camera !== 'default' && !sources.cameras.some((c) => c.id === next.camera)) {
    notices.push({ kind: 'camera-gone', name: next.cameraName });
    next.camera = null;
    next.cameraName = null;
  }
  if (next.microphone !== null && next.microphone !== 'default' && !sources.microphones.some((m) => m.id === next.microphone)) {
    notices.push({ kind: 'microphone-gone', name: next.microphoneName });
    next.microphone = null;
    next.microphoneName = null;
  }
  if (next.displayId !== null && !sources.displays.some((d) => d.id === next.displayId)) {
    if (next.source === 'display') notices.push({ kind: 'display-gone' });
    next.displayId = null;
  }
  if (next.source === 'window' && !sources.windows.some((w) => w.id === next.windowId)) {
    if (next.windowId !== null) notices.push({ kind: 'window-gone' });
    next.source = 'display';
    next.windowId = null;
  }
  if (next.source === 'area') next.source = 'display';
  return { choice: next, notices };
}

/** 一项为什么不能选：没有这种设备、没有选框、权限被拒（`permission` 是要开的那一项）。 */
export type OptionBlock =
  | { kind: 'no-display' }
  | { kind: 'no-window' }
  | { kind: 'no-area-picker' }
  | { kind: 'no-camera' }
  | { kind: 'no-microphone' };

/** 被系统拒绝或受限：要去系统设置里开。还没问过的不算，开始时系统自己会问。 */
export function permissionBlocked(state: SystemAccessState): boolean {
  return state === 'denied' || state === 'restricted';
}

/** 这次选择要用到的系统权限（与 Runtime 的预检同一份规则：屏幕总要，摄像头、麦克风选了才要，录键盘要输入监控）。 */
export function neededPermissions(choice: RecordingChoice): Array<keyof RecordingPermissions> {
  const wanted: Array<keyof RecordingPermissions> = ['screen'];
  if (choice.camera) wanted.push('camera');
  if (choice.microphone) wanted.push('microphone');
  if (choice.keys !== 'off') wanted.push('inputMonitoring');
  return wanted;
}

/** 各个来源能不能选。 */
export function sourceBlocks(sources: RecordingSources): Record<RecordingChoice['source'], OptionBlock | null> {
  return {
    display: sources.displays.length ? null : { kind: 'no-display' },
    window: sources.windows.length ? null : { kind: 'no-window' },
    // 区域要在屏幕上画一个框；那个选框（主进程的透明全屏窗口）还没有，先置灰。
    area: { kind: 'no-area-picker' },
  };
}

/**
 * 开始按钮挡在哪：录不了；屏幕权限被拒（必需的一路）；选了的可选一路权限被拒（去掉它就能继续）。
 * `missing` 是被拒的权限，按 `neededPermissions` 的顺序。
 */
export function startBlock(
  choice: RecordingChoice,
  sources: RecordingSources,
): { kind: 'ok' } | { kind: 'unavailable' } | { kind: 'permission'; missing: Array<keyof RecordingPermissions>; required: boolean } {
  if (!sources.available) return { kind: 'unavailable' };
  const missing = neededPermissions(choice).filter((p) => permissionBlocked(sources.permissions[p]));
  if (missing.length === 0) return { kind: 'ok' };
  return { kind: 'permission', missing, required: missing.includes('screen') };
}

/** 选择换成 `recordings.start` 的选项。 */
export function choiceOptions(choice: RecordingChoice): Partial<RecordingOptions> {
  let source: RecordingSource;
  if (choice.source === 'window' && choice.windowId) source = { kind: 'window', windowId: choice.windowId };
  else source = choice.displayId ? { kind: 'display', displayId: choice.displayId } : { kind: 'display' };
  return {
    source,
    camera: choice.camera,
    microphone: choice.microphone,
    systemAudio: choice.systemAudio,
    cursor: choice.cursor,
    keys: choice.keys,
    countdown: choice.countdown,
    // 不要光标时没有指针可跟，自动缩放也就没有了（§11 第 5 项）。
    autoZoom: choice.cursor !== 'none',
  };
}

/** 智能体在 `waiting` 里填好的选项换成面板的选择（缺的项用记下的）。 */
export function choiceFromOptions(options: RecordingOptions, base: RecordingChoice): RecordingChoice {
  const source = options.source;
  return {
    ...base,
    source: source.kind === 'window' ? 'window' : 'display',
    displayId: source.kind === 'window' ? base.displayId : (source.displayId ?? null),
    windowId: source.kind === 'window' ? source.windowId : base.windowId,
    camera: options.camera,
    cameraName: options.camera === base.camera ? base.cameraName : null,
    microphone: options.microphone,
    microphoneName: options.microphone === base.microphone ? base.microphoneName : null,
    systemAudio: options.systemAudio,
    cursor: options.cursor,
    keys: options.keys,
    countdown: options.countdown,
  };
}

/** 这条会话里等着用户按开始的那次（智能体发起的）。 */
export function waitingFor(recordings: readonly RecordingSummary[], conversationId: Id | null): RecordingSummary | null {
  if (!conversationId) return null;
  return recordings.find((r) => r.state === 'waiting' && r.requestedBy?.conversationId === conversationId) ?? null;
}

/** 上次没有收完、等用户决定恢复或删除的录制（新的在前）。 */
export function unfinishedRecordings(recordings: readonly RecordingSummary[]): RecordingSummary[] {
  return recordings.filter((r) => r.unfinished && r.state === 'importable').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 已录时长 `m:ss`，过一小时 `h:mm:ss`。 */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * 录完之后要不要打开编辑器：这个界面看着它从录制中走到「已进时间线」（重开界面时早已导入完的不算），选项要求打开。
 * `seen` 是之前看到的状态，`next` 是这次的。
 */
export function shouldOpenAfter(seen: RecordingState | undefined, next: RecordingSummary): boolean {
  if (next.state !== 'in-timeline' || !next.options.open || !next.result) return false;
  return seen !== undefined && seen !== 'in-timeline';
}

/**
 * 要不要自动弹出智能体发起的那次（§13）：正看着发起它的会话、还在等开始、这次启动里没关掉过、没有别的面板开着。
 * 返回要打开的那次，不弹时 null。
 */
export function autoOpenWaiting(input: {
  recordings: readonly RecordingSummary[];
  conversationId: Id | null;
  dismissed: readonly Id[];
  panelOpen: boolean;
}): RecordingSummary | null {
  if (input.panelOpen) return null;
  const waiting = waitingFor(input.recordings, input.conversationId);
  return waiting && !input.dismissed.includes(waiting.recordingId) ? waiting : null;
}
