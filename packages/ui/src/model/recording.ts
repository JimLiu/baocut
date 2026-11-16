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

/**
 * 入口为什么不能用：`remote` 连着别的电脑上的 Runtime；`unsupported` 这台电脑录不了（`code` 是 Runtime 的原因码，
 * 界面按它取自己的文字；认不出的码用 `text`，即 Runtime 给的原因）；`busy` 已有一次在录。
 */
export type RecordingBlock = { kind: 'remote' } | { kind: 'unsupported'; code: string | null; text: string | null } | { kind: 'busy' };

/**
 * `recordings.sources` 将来多给的两项（协议里还没有，都是可选的；Runtime 不给时界面照旧）：
 * - `disk.freeBytes`：录制落点所在磁盘的剩余字节，面板据此提示够不够录十分钟；
 * - `unavailable.code`：录不了时的英文原因码（`reason` 目前是 Runtime 本地化好的文字）。
 */
export type SourcesExtras = { disk?: { freeBytes: number }; unavailable?: { code: string } };

/** 界面认得、会换成自己文字的原因码（与 Runtime 的 `RECORDING_UNAVAILABLE` 的 `details.reason` 同一套）。 */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['remote', 'unsupported', 'unsupported-platform', 'no-worker', 'no-window']);

/** 录不了的原因码：先看 `unavailable.code`，再看 `reason` 本身是不是码（协议约定它是码）。都没有时 null。 */
export function unavailableCode(sources: RecordingSources): string | null {
  const extra = (sources as RecordingSources & SourcesExtras).unavailable?.code;
  if (typeof extra === 'string' && extra) return extra;
  return sources.reason && UNAVAILABLE_CODES.has(sources.reason) ? sources.reason : null;
}

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
    return { kind: 'disabled', block: s.reason === 'remote' ? { kind: 'remote' } : { kind: 'unsupported', code: s.reason, text: s.message || null } };
  }
  if (s.status === 'ready' && !s.sources.available) {
    const code = unavailableCode(s.sources);
    return { kind: 'disabled', block: code === 'remote' ? { kind: 'remote' } : { kind: 'unsupported', code, text: code === s.sources.reason ? null : s.sources.reason } };
  }
  if (input.recordings.some((r) => isLiveRecording(r.state))) return { kind: 'disabled', block: { kind: 'busy' } };
  return { kind: 'ready' };
}

/**
 * 按下开始录制的全局快捷键时做什么：面板已经开着就不动（窗口已经带到前台）；入口置灰时说明为什么；否则打开面板，
 * 录成眼下这一页的项目里的一个新视频（与 Home 的「录制」相同）。入口不显示（Web、宿主不能录）时什么都不做。
 */
export function startFromShortcut(input: {
  entry: RecordingEntry;
  panelOpen: boolean;
  projectId: Id | null;
}): { kind: 'open'; projectId: Id | null } | { kind: 'blocked'; block: RecordingBlock } | null {
  if (input.panelOpen || input.entry.kind === 'hidden') return null;
  if (input.entry.kind === 'disabled') return { kind: 'blocked', block: input.entry.block };
  return { kind: 'open', projectId: input.projectId };
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
  /** 「一个区域」框好的那块：所在屏幕（Worker 的屏幕 ID，null 是主屏）与相对它左上角的逻辑点。没框过时 null。 */
  area: RecordingArea | null;
  /** 整屏与区域也录进 BaoCut 自己的窗口（`recordings.start` 的 `includeSelf`）；录单个窗口时不起作用。 */
  includeSelf: boolean;
}

export interface RecordingArea {
  displayId: string | null;
  rect: { x: number; y: number; width: number; height: number };
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
  area: null,
  includeSelf: false,
};

export const COUNTDOWNS = [3, 5, 0] as const;

/** 设置里能选的屏幕帧率，第一个是缺省（与 `RECORDING_DEFAULTS.fps` 一致）。 */
export const RECORDING_FPS = [30, 60] as const;

/** 设备不在了退回「不用」时的提示种类，带上次记下的名字。 */
export type RecordingNotice =
  | { kind: 'camera-gone'; name: string | null }
  | { kind: 'microphone-gone'; name: string | null }
  | { kind: 'display-gone' }
  | { kind: 'window-gone' }
  | { kind: 'area-gone' };

/** 区域所在的屏幕（null 是主屏）。 */
export function areaDisplay(area: RecordingArea, sources: RecordingSources): RecordingSources['displays'][number] | null {
  if (area.displayId === null) return sources.displays.find((d) => d.primary) ?? sources.displays[0] ?? null;
  return sources.displays.find((d) => d.id === area.displayId) ?? null;
}

/** 区域还在它那块屏幕里（逻辑点）。 */
function areaFits(area: RecordingArea, sources: RecordingSources): boolean {
  const d = areaDisplay(area, sources);
  const r = area.rect;
  return !!d && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= d.width && r.y + r.height <= d.height;
}

/**
 * 把记下的选择落到这台电脑现在的设备上：摄像头、麦克风不在了退回「不用」，屏幕不在了退回主屏，窗口不在了退回整块屏幕，各给一条提示。
 * 记下的区域所在屏幕不在了、或框已经出了那块屏幕（换了分辨率），丢掉它并提示；宿主没有选框（`areaPicker` 为假）时
 * 「一个区域」退回整块屏幕（不提示，入口本来就不可选）；选着区域却没有框时也退回整块屏幕。
 */
export function resolveChoice(
  choice: RecordingChoice,
  sources: RecordingSources,
  host: { areaPicker: boolean } = { areaPicker: false },
): { choice: RecordingChoice; notices: RecordingNotice[] } {
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
  if (next.area && !areaFits(next.area, sources)) {
    if (next.source === 'area') notices.push({ kind: 'area-gone' });
    next.area = null;
  }
  if (next.source === 'area' && (!host.areaPicker || !next.area)) next.source = 'display';
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

/** 各个来源能不能选。区域要在屏幕上画一个框：宿主有选框（桌面端主进程的透明窗口，`areaPicker`）才能选。 */
export function sourceBlocks(sources: RecordingSources, host: { areaPicker: boolean } = { areaPicker: false }): Record<RecordingChoice['source'], OptionBlock | null> {
  return {
    display: sources.displays.length ? null : { kind: 'no-display' },
    window: sources.windows.length ? null : { kind: 'no-window' },
    area: !host.areaPicker ? { kind: 'no-area-picker' } : sources.displays.length ? null : { kind: 'no-display' },
  };
}

/**
 * 开始按钮挡在哪：录不了；选了区域还没框；屏幕权限被拒（必需的一路）；选了的可选一路权限被拒（去掉它就能继续）。
 * `missing` 是被拒的权限，按 `neededPermissions` 的顺序。
 */
export function startBlock(
  choice: RecordingChoice,
  sources: RecordingSources,
): { kind: 'ok' } | { kind: 'unavailable' } | { kind: 'no-area' } | { kind: 'permission'; missing: Array<keyof RecordingPermissions>; required: boolean } {
  if (!sources.available) return { kind: 'unavailable' };
  if (choice.source === 'area' && !choice.area) return { kind: 'no-area' };
  const missing = neededPermissions(choice).filter((p) => permissionBlocked(sources.permissions[p]));
  if (missing.length === 0) return { kind: 'ok' };
  return { kind: 'permission', missing, required: missing.includes('screen') };
}

/** 选择换成 `recordings.start` 的选项。 */
export function choiceOptions(choice: RecordingChoice): Partial<RecordingOptions> {
  let source: RecordingSource;
  if (choice.source === 'window' && choice.windowId) source = { kind: 'window', windowId: choice.windowId };
  else if (choice.source === 'area' && choice.area) {
    const { displayId, rect } = choice.area;
    source = displayId ? { kind: 'area', displayId, rect: { ...rect } } : { kind: 'area', rect: { ...rect } };
  } else source = choice.displayId ? { kind: 'display', displayId: choice.displayId } : { kind: 'display' };
  return {
    source,
    camera: choice.camera,
    microphone: choice.microphone,
    systemAudio: choice.systemAudio,
    cursor: choice.cursor,
    keys: choice.keys,
    countdown: choice.countdown,
    // 选单个窗口时选的就是那个窗口，排除名单不起作用，不送。
    ...(source.kind === 'window' ? {} : { includeSelf: choice.includeSelf }),
    // 不要光标时没有指针可跟，自动缩放也就没有了（§11 第 5 项）。
    autoZoom: choice.cursor !== 'none',
  };
}

/** 剩余空间不够录这么多分钟时提醒（§11「开始之前检查落点所在磁盘的剩余空间」）；只提醒，照样能开始。 */
export const LOW_DISK_MINUTES = 10;

/** 估码率用的每像素每帧比特数：H.264 硬件编码录屏的偏高估计，宁可早提醒。 */
const BITS_PER_PIXEL = 0.15;
const CAMERA_PIXELS = 1280 * 720;
const CAMERA_FPS = 30;
const AUDIO_BYTES_PER_SECOND = 128_000 / 8;

/**
 * 这次选择大约每秒写多少字节：屏幕按物理像素（逻辑尺寸乘缩放）与帧率估，加上摄像头（按 720p）与每一路声音。
 * 窗口与区域用所在屏幕的缩放；不知道在哪块屏幕时用主屏。
 */
export function recordingBytesPerSecond(choice: RecordingChoice, sources: RecordingSources, fps: number = RECORDING_DEFAULTS.fps): number {
  const primary = sources.displays.find((d) => d.primary) ?? sources.displays[0];
  let display = sources.displays.find((d) => d.id === choice.displayId) ?? primary;
  let points = display ? display.width * display.height : 1920 * 1080;
  if (choice.source === 'window') {
    const w = sources.windows.find((x) => x.id === choice.windowId);
    if (w) points = w.width * w.height;
  } else if (choice.source === 'area' && choice.area) {
    display = areaDisplay(choice.area, sources) ?? primary;
    points = choice.area.rect.width * choice.area.rect.height;
  }
  const scale = display?.scale ?? 1;
  const screen = (points * scale * scale * fps * BITS_PER_PIXEL) / 8;
  const camera = choice.camera ? (CAMERA_PIXELS * CAMERA_FPS * BITS_PER_PIXEL) / 8 : 0;
  const audio = (choice.microphone ? AUDIO_BYTES_PER_SECOND : 0) + (choice.systemAudio ? AUDIO_BYTES_PER_SECOND : 0);
  return screen + camera + audio;
}

/**
 * 剩余空间提醒：`sources` 给了剩余字节、而且不够录 `LOW_DISK_MINUTES` 分钟时，给出剩余字节与大约还能录几分钟（至少 1）。
 * Runtime 不给剩余空间时 null（不猜）。
 */
export function lowDisk(choice: RecordingChoice, sources: RecordingSources, fps?: number): { freeBytes: number; minutes: number } | null {
  const free = (sources as RecordingSources & SourcesExtras).disk?.freeBytes;
  if (typeof free !== 'number' || !Number.isFinite(free) || free < 0) return null;
  const rate = recordingBytesPerSecond(choice, sources, fps);
  const seconds = free / rate;
  if (seconds >= LOW_DISK_MINUTES * 60) return null;
  return { freeBytes: free, minutes: Math.max(1, Math.floor(seconds / 60)) };
}

/** 智能体在 `waiting` 里填好的选项换成面板的选择（缺的项用记下的）。 */
export function choiceFromOptions(options: RecordingOptions, base: RecordingChoice): RecordingChoice {
  const source = options.source;
  return {
    ...base,
    source: source.kind,
    displayId: source.kind === 'display' ? (source.displayId ?? null) : base.displayId,
    windowId: source.kind === 'window' ? source.windowId : base.windowId,
    area: source.kind === 'area' ? { displayId: source.displayId ?? null, rect: { ...source.rect } } : base.area,
    camera: options.camera,
    cameraName: options.camera === base.camera ? base.cameraName : null,
    microphone: options.microphone,
    microphoneName: options.microphone === base.microphone ? base.microphoneName : null,
    systemAudio: options.systemAudio,
    cursor: options.cursor,
    keys: options.keys,
    countdown: options.countdown,
    includeSelf: options.includeSelf ?? false,
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
