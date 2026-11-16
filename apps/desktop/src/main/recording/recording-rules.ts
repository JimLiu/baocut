import type { RecordingState, RecordingStreamStatus, RecordingSummary } from '@baocut/protocol';

/*
 * 录制中主进程的规则（屏幕录制设计 §11「录制中」「停止之后」）：控制条显示什么、什么时候收起与放回应用窗口、托盘的动作、
 * 全局快捷键什么时候生效。都是纯函数，有单测；Electron 的调用在 recording-service.ts。
 */

/** 控制条的样子：倒计时、录制中、暂停、收尾。`null` 是不显示。 */
export interface BarView {
  recordingId: string;
  phase: 'countdown' | 'recording' | 'paused' | 'finishing';
  /** 已录秒数（倒计时时是剩下的秒数）。 */
  seconds: number;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  canDiscard: boolean;
  /** 中途断开的那几路（只提示一次，由调用方记）。 */
  lost: Array<RecordingStreamStatus['role']>;
}

/** 收起应用窗口的阶段：从准备到收尾之前。 */
const CAPTURE: ReadonlySet<RecordingState> = new Set(['preparing', 'countdown', 'recording', 'paused']);
/** 控制条在的阶段：采集中，以及停下之后到导入完之前（显示「正在收尾」）。 */
const BAR: ReadonlySet<RecordingState> = new Set(['countdown', 'recording', 'paused', 'stopping', 'finalizing', 'importing']);

export function isCapturing(state: RecordingState): boolean {
  return CAPTURE.has(state);
}

/** 这台电脑此刻正在进行的那次（最多一次）：在采集或在收尾的。 */
export function currentRecording(recordings: readonly RecordingSummary[]): RecordingSummary | null {
  return recordings.find((r) => BAR.has(r.state) || r.state === 'preparing') ?? null;
}

export function barView(r: RecordingSummary | null): BarView | null {
  if (!r || !BAR.has(r.state)) return null;
  const phase = r.state === 'countdown' ? 'countdown' : r.state === 'recording' ? 'recording' : r.state === 'paused' ? 'paused' : 'finishing';
  return {
    recordingId: r.recordingId,
    phase,
    seconds: phase === 'countdown' ? (r.countdownLeft ?? r.options.countdown) : r.elapsed,
    canPause: phase === 'recording',
    canResume: phase === 'paused',
    canStop: phase === 'recording' || phase === 'paused',
    canDiscard: phase !== 'finishing',
    lost: r.streams.filter((s) => s.lost).map((s) => s.role),
  };
}

/**
 * 应用窗口怎么办：开始采集时收起（设置里关掉了就不收），采集结束（停下、失败、放弃）时放回来。
 * `before` 是上次看到的状态（没看到过是 undefined）。
 */
export function windowPlan(before: RecordingState | undefined, next: RecordingState, hideWindow: boolean): 'hide' | 'restore' | null {
  const was = before !== undefined && isCapturing(before);
  const now = isCapturing(next);
  if (!was && now) return hideWindow ? 'hide' : null;
  if (was && !now) return 'restore';
  return null;
}

/**
 * 这次录制要不要收起应用窗口：设置里开着收起，而且这次没要求把 BaoCut 录进去（`includeSelf`，整屏与区域才起作用）——
 * 要录 BaoCut 自己时收起窗口就什么也录不到。
 */
export function hideForRecording(r: RecordingSummary, hideWindow: boolean): boolean {
  return hideWindow && !(r.options.includeSelf && r.options.source.kind !== 'window');
}

/** 全局快捷键只在采集时注册（录完就还给别的应用）。 */
export function shortcutsWanted(r: RecordingSummary | null): boolean {
  return !!r && (r.state === 'recording' || r.state === 'paused' || r.state === 'countdown');
}

/** 快捷键「暂停与继续」此刻该调哪个方法。 */
export function toggleMethod(r: RecordingSummary | null): 'recordings.pause' | 'recordings.resume' | null {
  if (r?.state === 'recording') return 'recordings.pause';
  if (r?.state === 'paused') return 'recordings.resume';
  return null;
}

/** 渲染进程给的设置：快捷键是 Electron accelerator 写法（空串不用），不认识的值退回缺省。 */
export interface RecordingHostSettings {
  shortcuts: { stop: string; pause: string };
  hideWindow: boolean;
}

export const DEFAULT_HOST_SETTINGS: RecordingHostSettings = {
  shortcuts: { stop: 'CommandOrControl+Shift+2', pause: 'CommandOrControl+Shift+3' },
  hideWindow: true,
};

const ACCELERATOR = /^[A-Za-z0-9+\-=[\];',./`\\ ]{0,64}$/;

export function parseHostSettings(raw: unknown): RecordingHostSettings {
  const v = (raw ?? {}) as { shortcuts?: { stop?: unknown; pause?: unknown }; hideWindow?: unknown };
  const key = (value: unknown, fallback: string) => (typeof value === 'string' && ACCELERATOR.test(value) ? value : fallback);
  return {
    shortcuts: {
      stop: key(v.shortcuts?.stop, DEFAULT_HOST_SETTINGS.shortcuts.stop),
      pause: key(v.shortcuts?.pause, DEFAULT_HOST_SETTINGS.shortcuts.pause),
    },
    hideWindow: typeof v.hideWindow === 'boolean' ? v.hideWindow : DEFAULT_HOST_SETTINGS.hideWindow,
  };
}

/** 系统设置里各项隐私权限的地址（macOS）。地址写死，渲染进程不能借它打开别的页。 */
export const PRIVACY_URLS: Record<'screen' | 'camera' | 'microphone' | 'inputMonitoring', string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  inputMonitoring: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
};

/** Windows 的隐私设置页（录制在 Windows 上还不能用，这几页先留着给权限行用）。 */
export const WINDOWS_PRIVACY_URLS: Partial<Record<keyof typeof PRIVACY_URLS, string>> = {
  camera: 'ms-settings:privacy-webcam',
  microphone: 'ms-settings:privacy-microphone',
};

export function privacyUrl(permission: unknown, platform: NodeJS.Platform): string | null {
  if (typeof permission !== 'string' || !(permission in PRIVACY_URLS)) return null;
  const p = permission as keyof typeof PRIVACY_URLS;
  if (platform === 'darwin') return PRIVACY_URLS[p];
  if (platform === 'win32') return WINDOWS_PRIVACY_URLS[p] ?? null;
  return null;
}

/** 已录时长 `m:ss`，过一小时 `h:mm:ss`。 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ---- 区域框选（屏幕录制设计 §11 第 1 项「一个区域」） ----

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 框太小当作没选（误点一下不算一个区域）。逻辑点。 */
export const MIN_AREA = 32;

/**
 * 选框盖在哪块屏幕上：界面给的 ID（Worker 报的屏幕 ID，macOS 上与 Electron 的 `display.id` 同为 CGDirectDisplayID）对得上就用它，
 * 对不上或没给就用主屏。
 */
export function pickDisplay<D extends { id: number; bounds: Bounds }>(displays: readonly D[], wanted: unknown, primary: D): D {
  if (typeof wanted === 'string' && wanted) return displays.find((d) => String(d.id) === wanted) ?? primary;
  return primary;
}

/**
 * 拖出来的框换成相对那块屏幕左上角的逻辑点：`from` 与 `to` 是选框页面里的坐标（CSS 像素即逻辑点），`content` 是选框窗口
 * 内容区此刻在桌面上的位置（macOS 可能把它压到菜单栏下面，所以不假定它与屏幕重合），`display` 是那块屏幕。
 * 结果夹在屏幕里、取整；夹完宽或高不到 `MIN_AREA` 时 null。
 */
export function areaRect(from: { x: number; y: number }, to: { x: number; y: number }, content: Bounds, display: Bounds): Bounds | null {
  const ox = content.x - display.x;
  const oy = content.y - display.y;
  const clampX = (v: number) => Math.min(display.width, Math.max(0, v + ox));
  const clampY = (v: number) => Math.min(display.height, Math.max(0, v + oy));
  const x0 = Math.round(clampX(Math.min(from.x, to.x)));
  const x1 = Math.round(clampX(Math.max(from.x, to.x)));
  const y0 = Math.round(clampY(Math.min(from.y, to.y)));
  const y1 = Math.round(clampY(Math.max(from.y, to.y)));
  if (x1 - x0 < MIN_AREA || y1 - y0 < MIN_AREA) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** 选框页面交回来的拖动：两个有限的点；别的形状不认。 */
export function parseAreaDrag(raw: unknown): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const v = raw as { from?: { x?: unknown; y?: unknown }; to?: { x?: unknown; y?: unknown } } | null;
  const point = (p: { x?: unknown; y?: unknown } | undefined) =>
    p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
  const from = point(v?.from);
  const to = point(v?.to);
  return from && to ? { from, to } : null;
}
