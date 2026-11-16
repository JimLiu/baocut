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
import type { RatioId } from './recording-area.ts';

/*
 * 屏幕录制的界面规则（屏幕录制设计 §11）：入口能不能用、启动器与录制卡各项能不能选、上次的选择怎样落到这台电脑现在的设备上、
 * 控制条上写什么。都是纯函数，启动器、覆盖层、控制条、入口与测试共用；文字在组件里按种类取。
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

/** 界面认得、会换成自己文字的原因码（与 Runtime 的 `RECORDING_UNAVAILABLE` 的 `details.reason` 同一套）。 */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['remote', 'unsupported', 'unsupported-platform', 'no-worker', 'no-window']);

/** 协议的 `RecordingUnavailableCode` 换成界面自己的码。 */
const PROTOCOL_CODES: Readonly<Record<string, string>> = {
  'remote-runtime': 'remote',
  'platform-unsupported': 'unsupported-platform',
  'worker-missing': 'no-worker',
  'no-desktop': 'no-window',
};

/** 录不了的原因码：先看 `unavailable.code`，再看 `reason` 本身是不是码（协议约定它是码）。都没有时 null。 */
export function unavailableCode(sources: RecordingSources): string | null {
  const extra: string | undefined = sources.unavailable?.code;
  if (extra) return PROTOCOL_CODES[extra] ?? extra;
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

/** 启动器记住的选择（按这台电脑记，localStorage）。设备按 ID 记，名字留着在设备不在时提示。 */
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
  /** 「一个区域」框好的那块：所在屏幕（Worker 的屏幕 ID，null 是主屏）与相对它左上角的逻辑点。没框过时 null；锁定时下次沿用。 */
  area: RecordingArea | null;
  /** 区域锁定：下次沿用这块区域，覆盖层里不能拖动。 */
  areaLocked: boolean;
  /** 区域覆盖层工具条上的比例。 */
  ratio: RatioId;
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
  areaLocked: false,
  ratio: 'free',
  includeSelf: false,
};

/** 倒计时的几档（秒，0 是不倒计时）：设置与录制卡的齿轮菜单共用。 */
export const COUNTDOWNS = [0, 3, 5, 10] as const;

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
 * 记下的区域所在屏幕不在了、或框已经出了那块屏幕（换了分辨率），丢掉它（解除锁定）并提示。没锁定的区域不沿用：覆盖层每次重新画。
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
  if (next.windowId !== null && !sources.windows.some((w) => w.id === next.windowId)) {
    if (next.source === 'window') notices.push({ kind: 'window-gone' });
    next.windowId = null;
  }
  if (next.area && !next.areaLocked) next.area = null;
  if (next.area && !areaFits(next.area, sources)) {
    if (next.source === 'area') notices.push({ kind: 'area-gone' });
    next.area = null;
    next.areaLocked = false;
  }
  return { choice: next, notices };
}

/** 一项为什么不能选：没有这种设备。 */
export type OptionBlock = { kind: 'no-display' } | { kind: 'no-window' } | { kind: 'no-camera' } | { kind: 'no-microphone' };

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

/** 各个来源能不能选：没有屏幕时三格都不能选，没有窗口时「窗口」不能选。 */
export function sourceBlocks(sources: RecordingSources): Record<RecordingChoice['source'], OptionBlock | null> {
  const noDisplay = sources.displays.length ? null : ({ kind: 'no-display' } as const);
  return { display: noDisplay, window: sources.windows.length ? null : { kind: 'no-window' }, area: noDisplay };
}

/**
 * 录制卡的开始挡在哪：录不了；选了区域还没框；屏幕权限被拒（必需的一路）；选了的可选一路权限被拒（去掉它就能继续）。
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
    // 不要光标时没有指针可跟，自动缩放也就没有了（§11「启动器」）。
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
  const free = sources.disk?.freeBytes;
  if (typeof free !== 'number' || !Number.isFinite(free) || free < 0) return null;
  const rate = recordingBytesPerSecond(choice, sources, fps);
  const seconds = free / rate;
  if (seconds >= LOW_DISK_MINUTES * 60) return null;
  return { freeBytes: free, minutes: Math.max(1, Math.floor(seconds / 60)) };
}

/** 智能体在 `waiting` 里填好的选项换成启动器的选择（缺的项用记下的）。 */
export function choiceFromOptions(options: RecordingOptions, base: RecordingChoice): RecordingChoice {
  const source = options.source;
  return {
    ...base,
    source: source.kind,
    displayId: source.kind === 'display' ? (source.displayId ?? null) : base.displayId,
    windowId: source.kind === 'window' ? source.windowId : base.windowId,
    area: source.kind === 'area' ? { displayId: source.displayId ?? null, rect: { ...source.rect } } : base.area,
    areaLocked: source.kind === 'area' ? true : base.areaLocked,
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
 * 要不要自动打开智能体发起的那次（§13）：正看着发起它的会话、还在等开始、这次启动里没关掉过、启动器没有开着。
 * 返回要打开的那次，不打开时 null。
 */
export function autoOpenWaiting(input: {
  recordings: readonly RecordingSummary[];
  conversationId: Id | null;
  dismissed: readonly Id[];
  sessionOpen: boolean;
}): RecordingSummary | null {
  if (input.sessionOpen) return null;
  const waiting = waitingFor(input.recordings, input.conversationId);
  return waiting && !input.dismissed.includes(waiting.recordingId) ? waiting : null;
}

// ---- 启动器与录制卡 ----

/** 「把 BaoCut 也录进去」只对整块屏幕与区域有意义：录一个窗口时本来就只录那个窗口。 */
export function showsIncludeSelf(source: RecordingChoice['source']): boolean {
  return source === 'display' || source === 'area';
}

/**
 * 设备行右侧的药丸：权限被拒 →「允许」（点它打开系统设置）；没选 →「关」；选的设备不在了 →「未连接」；否则「开」。
 * `action` 是点药丸做的事。系统声音没有设备与权限，只有开与关。
 */
export type DevicePill = { state: 'allow'; action: 'open-settings' } | { state: 'off'; action: 'open-list' } | { state: 'missing'; action: 'open-list' } | { state: 'on'; action: 'turn-off' };

export function devicePill(input: { permission: SystemAccessState | null; on: boolean; connected?: boolean }): DevicePill {
  if (input.permission !== null && permissionBlocked(input.permission)) return { state: 'allow', action: 'open-settings' };
  if (!input.on) return { state: 'off', action: 'open-list' };
  if (input.connected === false) return { state: 'missing', action: 'open-list' };
  return { state: 'on', action: 'turn-off' };
}

/** 原地列表的搜索：不分大小写，按名字包含。 */
export function filterList<T extends { label: string }>(items: readonly T[], query: string): T[] {
  const k = query.trim().toLocaleLowerCase();
  return k ? items.filter((x) => x.label.toLocaleLowerCase().includes(k)) : items.slice();
}

/** 没选麦克风、设置里开着「没有麦克风时先确认」时，按开始先问一句。 */
export function needsMicConfirm(microphone: string | null, confirmNoMic: boolean): boolean {
  return !microphone && confirmNoMic;
}

/** 这次能不能开 `getUserMedia`（摄像头预览、电平）：只在系统已经允许时开，免得这里替 Worker 弹出系统的授权窗口。 */
export function canPreview(state: SystemAccessState | undefined): boolean {
  return state === 'granted';
}

// ---- 控制条 ----

/**
 * 控制条第一格（停止 + 计时）里写什么：倒计时是剩下的秒数；准备中「正在开始」；暂停「已暂停」；停止之后「正在收尾…」；
 * 录制中是已录时长。
 */
export type BarStatus = { kind: 'countdown'; seconds: number } | { kind: 'starting' } | { kind: 'paused' } | { kind: 'finishing' } | { kind: 'clock'; text: string };

export function barStatus(r: Pick<RecordingSummary, 'state' | 'elapsed' | 'countdownLeft'>): BarStatus {
  switch (r.state) {
    case 'countdown':
      return { kind: 'countdown', seconds: Math.max(1, r.countdownLeft ?? 1) };
    case 'waiting':
    case 'preparing':
      return { kind: 'starting' };
    case 'paused':
      return { kind: 'paused' };
    case 'recording':
      return { kind: 'clock', text: formatElapsed(r.elapsed) };
    default:
      return { kind: 'finishing' };
  }
}

/** 控制条上各个按钮能不能点：倒计时与准备中不能暂停（停止等于取消）；收尾时都不能点。 */
export function barActions(state: RecordingState): { stop: boolean; pause: boolean; restart: boolean; discard: boolean } {
  const rec = state === 'recording' || state === 'paused';
  const pre = state === 'preparing' || state === 'countdown';
  return { stop: rec || pre, pause: rec, restart: rec || pre, discard: rec || pre };
}
