import type { RecordingState, RecordingSummary } from '@baocut/protocol';

/*
 * 录制时主进程的规则（屏幕录制设计 §11）：控制条什么时候在、什么时候收起与放回应用窗口、全局快捷键什么时候生效、渲染进程交来的
 * 设置与请求怎么校验、覆盖层盖着的屏幕对上 Worker 的哪块、控制条与摄像头浮窗的缺省位置。都是纯函数，有单测；Electron 的调用在
 * recording-service.ts 与 recording-surfaces.ts。
 */

/** 收起应用窗口的阶段：从准备到收尾之前。 */
const CAPTURE: ReadonlySet<RecordingState> = new Set(['preparing', 'countdown', 'recording', 'paused']);
/** 控制条在的阶段：准备、采集中，以及停下之后到导入完之前（显示「正在收尾」）。 */
const BAR_STATES: ReadonlySet<RecordingState> = new Set(['preparing', 'countdown', 'recording', 'paused', 'stopping', 'finalizing', 'importing']);

export function isCapturing(state: RecordingState): boolean {
  return CAPTURE.has(state);
}

/** 这台电脑此刻正在进行的那次（最多一次）：在采集或在收尾的。 */
export function currentRecording(recordings: readonly RecordingSummary[]): RecordingSummary | null {
  return recordings.find((r) => BAR_STATES.has(r.state)) ?? null;
}

/**
 * 应用窗口怎么办：开始采集时收起（收到后台或最小化，看设置；这次要把 BaoCut 录进去时不动），采集结束（停下、失败、放弃）时放回来。
 * `before` 是上次看到的状态（没看到过是 undefined）。
 */
export function windowPlan(before: RecordingState | undefined, next: RecordingState, hide: boolean): 'hide' | 'restore' | null {
  const was = before !== undefined && isCapturing(before);
  const now = isCapturing(next);
  if (!was && now) return hide ? 'hide' : null;
  if (was && !now) return 'restore';
  return null;
}

/** 这次录制要不要收起应用窗口：要把 BaoCut 录进去（`includeSelf`，整屏与区域才起作用）时不收，不然什么也录不到。 */
export function hideForRecording(r: RecordingSummary): boolean {
  return !(r.options.includeSelf && r.options.source.kind !== 'window');
}

/** 停止、暂停、重新开始的全局快捷键只在采集时注册（录完就还给别的应用）。 */
export function captureShortcutsWanted(r: RecordingSummary | null): boolean {
  return !!r && isCapturing(r.state);
}

/**
 * 打开启动器与直接选屏幕、窗口、区域的四个快捷键什么时候占着：设置交过来之后（之前不知道用户是不是清掉了它们）、连着 Runtime、
 * 而且眼下没有在录的（在录时这几组键还给别的应用）。
 */
export function openShortcutsWanted(r: RecordingSummary | null, connected: boolean, configured: boolean): boolean {
  return configured && connected && !r;
}

/** 快捷键「暂停与继续」此刻该调哪个方法。 */
export function toggleMethod(r: RecordingSummary | null): 'recordings.pause' | 'recordings.resume' | null {
  if (r?.state === 'recording') return 'recordings.pause';
  if (r?.state === 'paused') return 'recordings.resume';
  return null;
}

/** 七个全局快捷键：前四个在不录时占着，后三个只在采集时占着。 */
export const SHORTCUT_KEYS = ['launcher', 'display', 'window', 'area', 'stop', 'pause', 'restart'] as const;
export type ShortcutKey = (typeof SHORTCUT_KEYS)[number];
export const OPEN_SHORTCUTS: readonly ShortcutKey[] = ['launcher', 'display', 'window', 'area'];
export const CAPTURE_SHORTCUTS: readonly ShortcutKey[] = ['stop', 'pause', 'restart'];

export type PickerKind = 'display' | 'window' | 'area';

/** 打开启动器的请求（与 @baocut/ui 的 `RecordingSessionRequest` 同形；这里重新校验）。 */
export interface SessionRequest {
  target: { videoId: string; at?: number } | { create: { name?: string; projectId?: string; conversationId?: string } } | { home: { projectId: string | null; name: string } };
  recordingId?: string;
  landing: { text: string; note?: string; kind: 'new' | 'into' | 'agent' };
  direct?: PickerKind;
}

/** 渲染进程给的设置：快捷键是 Electron accelerator 写法（空串不用），不认识的值退回缺省。 */
export interface RecordingHostSettings {
  shortcuts: Record<ShortcutKey, string>;
  mainWindow: 'background' | 'minimize';
  afterDiscard: 'none' | 'launcher';
  trayIcon: boolean;
  home: SessionRequest | null;
}

/** 快捷键缺省都不设：占着的组合键别的应用就用不了，由用户自己挑。 */
export const DEFAULT_HOST_SETTINGS: RecordingHostSettings = {
  shortcuts: { launcher: '', display: '', window: '', area: '', stop: '', pause: '', restart: '' },
  mainWindow: 'background',
  afterDiscard: 'none',
  trayIcon: true,
  home: null,
};

const ACCELERATOR = /^[A-Za-z0-9+\-=[\];',./`\\ ]{0,64}$/;

export function parseHostSettings(raw: unknown): RecordingHostSettings {
  const v = (raw ?? {}) as { shortcuts?: Record<string, unknown>; mainWindow?: unknown; afterDiscard?: unknown; trayIcon?: unknown; home?: unknown };
  const shortcuts = { ...DEFAULT_HOST_SETTINGS.shortcuts };
  for (const k of SHORTCUT_KEYS) {
    const value = v.shortcuts?.[k];
    if (typeof value === 'string' && ACCELERATOR.test(value)) shortcuts[k] = value;
  }
  return {
    shortcuts,
    mainWindow: v.mainWindow === 'minimize' ? 'minimize' : 'background',
    afterDiscard: v.afterDiscard === 'launcher' ? 'launcher' : 'none',
    trayIcon: typeof v.trayIcon === 'boolean' ? v.trayIcon : DEFAULT_HOST_SETTINGS.trayIcon,
    home: v.home == null ? null : parseSessionRequest(v.home),
  };
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const text = (value: unknown, max = 500): string | null => (typeof value === 'string' && value.length <= max ? value : null);
const id = (value: unknown): string | null => (typeof value === 'string' && ID.test(value) ? value : null);

/** 渲染进程给的打开启动器的请求：形状不对时 null。 */
export function parseSessionRequest(raw: unknown): SessionRequest | null {
  const v = raw as { target?: Record<string, unknown>; recordingId?: unknown; landing?: { text?: unknown; note?: unknown; kind?: unknown }; direct?: unknown } | null;
  if (!v || typeof v !== 'object' || !v.target || typeof v.target !== 'object') return null;
  const t = v.target;
  let target: SessionRequest['target'] | null = null;
  if ('videoId' in t) {
    const videoId = id(t.videoId);
    const at = typeof t.at === 'number' && Number.isFinite(t.at) && t.at >= 0 ? t.at : undefined;
    if (videoId) target = at === undefined ? { videoId } : { videoId, at };
  } else if ('create' in t && t.create && typeof t.create === 'object') {
    const c = t.create as Record<string, unknown>;
    const create: { name?: string; projectId?: string; conversationId?: string } = {};
    if (c.name !== undefined) {
      const name = text(c.name, 200);
      if (name === null) return null;
      create.name = name;
    }
    if (c.projectId !== undefined) {
      const projectId = id(c.projectId);
      if (!projectId) return null;
      create.projectId = projectId;
    }
    if (c.conversationId !== undefined) {
      const conversationId = id(c.conversationId);
      if (!conversationId) return null;
      create.conversationId = conversationId;
    }
    target = { create };
  } else if ('home' in t && t.home && typeof t.home === 'object') {
    const h = t.home as Record<string, unknown>;
    const name = text(h.name, 200);
    const projectId = h.projectId === null ? null : id(h.projectId);
    if (name !== null && (h.projectId === null || projectId)) target = { home: { projectId, name } };
  }
  const landingText = text(v.landing?.text);
  const kind = v.landing?.kind;
  if (!target || landingText === null || (kind !== 'new' && kind !== 'into' && kind !== 'agent')) return null;
  const note = v.landing?.note === undefined ? undefined : text(v.landing.note);
  const recordingId = v.recordingId === undefined ? undefined : id(v.recordingId);
  if (note === null || recordingId === null) return null;
  const direct = v.direct === 'display' || v.direct === 'window' || v.direct === 'area' ? v.direct : undefined;
  return {
    target,
    landing: note === undefined ? { text: landingText, kind } : { text: landingText, note, kind },
    ...(recordingId ? { recordingId } : {}),
    ...(direct ? { direct } : {}),
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

// ---- 覆盖层盖着的屏幕（屏幕录制设计 §11「选取覆盖层」） ----

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Electron 的一块屏幕对上 Worker 报的哪块（`sources.displays[].id`）：macOS 上两边同为 CGDirectDisplayID，先按 ID；对不上时按
 * 逻辑尺寸与是否主屏；再不行，主屏对主屏。都对不上时 null。
 */
export function workerDisplayFor(
  display: { id: number; bounds: Bounds; primary: boolean },
  workers: readonly { id: string; width: number; height: number; primary: boolean }[],
): string | null {
  const exact = workers.find((w) => w.id === String(display.id));
  if (exact) return exact.id;
  const sized = workers.find((w) => w.width === display.bounds.width && w.height === display.bounds.height && w.primary === display.primary);
  if (sized) return sized.id;
  return display.primary ? (workers.find((w) => w.primary)?.id ?? null) : null;
}

// ---- 控制条与摄像头浮窗的缺省位置（屏幕录制设计 §11「控制条」「摄像头浮窗」） ----

export const BAR = { width: 320, height: 64, alertHeight: 150 } as const;

/**
 * 控制条小窗的缺省位置：录屏幕或区域时在那块屏幕底部居中、向上 120；录窗口时在窗口下边缘居中、向上 48。
 * 截在屏幕里（`display` 是屏幕的工作区，全局坐标）。返回小窗左上角。
 */
export function barPlacement(kind: 'display' | 'window' | 'area', target: Bounds | null, display: Bounds, height: number = BAR.height): { x: number; y: number } {
  const onWindow = kind === 'window' && !!target;
  const ref = onWindow ? target : display;
  const up = onWindow ? 48 : 120;
  const x = clampN(ref.x + ref.width / 2 - BAR.width / 2, display.x, display.x + display.width - BAR.width);
  const y = clampN(ref.y + ref.height - up - height, display.y, display.y + display.height - height);
  return { x: Math.round(x), y: Math.round(y) };
}

export const CAMERA_MARGIN = 100;

/** 摄像头浮窗的位置：记下的位置截回屏幕里；没有时在右下角，离两边各 100。 */
export function cameraPlacement(saved: { x: number; y: number } | null, box: { width: number; height: number }, display: Bounds): { x: number; y: number } {
  if (saved) return { x: Math.round(clampN(saved.x, display.x, display.x + display.width - box.width)), y: Math.round(clampN(saved.y, display.y, display.y + display.height - box.height)) };
  return { x: Math.max(display.x, display.x + display.width - CAMERA_MARGIN - box.width), y: Math.max(display.y, display.y + display.height - CAMERA_MARGIN - box.height) };
}

function clampN(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
