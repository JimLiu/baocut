import { z } from 'zod';

/**
 * Runtime 与 Recording Worker 之间的私有协议（屏幕录制设计 §7）：stdio 上的 JSON 行，形状同别的 Worker（`json-line-worker.ts`）。
 * Rust 一侧的同名类型在 `crates/recording-worker/src/protocol.rs`；两边都读 `crates/recording-worker/tests/fixtures/protocol.json`，
 * 防止各改各的。
 *
 * 请求：
 * - `hello` → 协议版本、平台、能不能采集（不能时 `reason`）。
 * - `sources` → 能录的屏幕、窗口、摄像头、麦克风与系统权限的状态。只问状态，不触发系统的授权窗口。
 * - `start` → 在 `dir` 里开始第一段（倒计时由 Runtime 做完再发）。
 * - `pause` / `resume` → 结束当前段、开始新的一段。
 * - `stop` → 结束当前段、关掉各路写入，文件可读之后才回答。
 *
 * 推送：`stream`（一路流的第一个样本到了）、`device-lost`（设备中途断开）、`disk-low`、`failed`（采集中途失败）。
 *
 * 落盘：Worker 只写 `dir` 里的媒体文件、指针与键盘的事件文件、光标图片，和一份只追加的 `journal.jsonl`。Runtime 收尾时只读
 * 这份日志（正常停止与崩溃之后的恢复是同一条路径，`recording-package.ts`）。时刻是系统单调时钟上的纳秒，写成十进制字符串。
 */

export const RECORDING_WORKER_PROTOCOL = 1;

const nsString = z.string().regex(/^\d{1,20}$/);
const role = z.enum(['screen', 'camera', 'microphone', 'system-audio']);
const access = z.enum(['granted', 'denied', 'not-determined', 'restricted', 'unknown']);

export const helloResult = z.object({
  protocol: z.number().int(),
  version: z.string(),
  platform: z.string(),
  capture: z.object({ supported: z.boolean(), reason: z.string().optional() }),
});
export type WorkerHello = z.infer<typeof helloResult>;

export const sourcesResult = z.object({
  permissions: z.object({ screen: access, camera: access, microphone: access, inputMonitoring: access }),
  displays: z.array(
    z.object({ id: z.string(), name: z.string(), width: z.number(), height: z.number(), scale: z.number(), primary: z.boolean() }),
  ),
  windows: z.array(z.object({ id: z.string(), title: z.string(), app: z.string(), width: z.number(), height: z.number() })),
  cameras: z.array(z.object({ id: z.string(), name: z.string(), default: z.boolean().optional() })),
  microphones: z.array(z.object({ id: z.string(), name: z.string(), default: z.boolean().optional() })),
});
export type WorkerSources = z.infer<typeof sourcesResult>;

/** `start` 的参数：录制目录与已经解析过的选项（`microphone` 是设备 ID 或 `default`）。 */
export interface WorkerStartParams {
  dir: string;
  source:
    | { kind: 'display'; displayId?: string }
    | { kind: 'window'; windowId: string }
    | { kind: 'area'; displayId?: string; rect: { x: number; y: number; width: number; height: number } };
  camera: string | null;
  microphone: string | null;
  systemAudio: boolean;
  cursor: 'separate' | 'baked' | 'none';
  keys: 'off' | 'shortcuts' | 'all';
  fps: number;
  /**
   * 整屏与区域录制时不录进画面的应用（按 bundle id 或进程 ID 认，ScreenCaptureKit 的内容过滤）。不给时什么都不排除；
   * 选单个窗口时不起作用。后加的可选字段，协议版本不变：旧的 Worker 不认识就忽略。
   */
  exclude?: WorkerExclusion;
}

export interface WorkerExclusion {
  bundleIds?: string[];
  pids?: number[];
}

export const startResult = z.object({
  segmentId: z.string(),
  atNs: nsString,
  /** 实际的鼠标模式：拿不到不带光标的画面时从 `separate` 退到 `baked`。 */
  cursor: z.enum(['separate', 'baked', 'none']),
  capture: z.object({ kind: z.enum(['display', 'window', 'area']), width: z.number().int().positive(), height: z.number().int().positive(), scale: z.number().positive() }),
});
export type WorkerStarted = z.infer<typeof startResult>;

export const segmentResult = z.object({ segmentId: z.string(), atNs: nsString });
export const stopResult = z.object({ journal: z.string() });

export const workerEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('stream'), params: z.object({ role, segmentId: z.string(), startNs: nsString }) }),
  z.object({ event: z.literal('device-lost'), params: z.object({ role, segmentId: z.string(), atNs: nsString }) }),
  z.object({ event: z.literal('disk-low'), params: z.object({ freeBytes: z.number() }) }),
  z.object({ event: z.literal('failed'), params: z.object({ code: z.string(), message: z.string() }) }),
]);
export type WorkerEventMessage = z.infer<typeof workerEvent>;

/** `journal.jsonl` 的一行。 */
export const journalLine = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('begin'),
    recorder: z.object({ name: z.string(), version: z.string().optional(), revision: z.string().optional() }),
    platform: z.string(),
    startedAt: z.string(),
    cursor: z.enum(['separate', 'baked', 'none']),
    keyboard: z.enum(['shortcuts', 'all']).nullable(),
    capture: z.object({ kind: z.enum(['display', 'window', 'area']), width: z.number().int().positive(), height: z.number().int().positive(), scale: z.number().positive() }),
  }),
  z.object({ type: z.literal('segment'), id: z.string(), startNs: nsString }),
  z.object({ type: z.literal('segment-end'), id: z.string(), endNs: nsString }),
  z.object({
    type: z.literal('stream'),
    role,
    segmentId: z.string(),
    file: z.string(),
    startNs: nsString,
    device: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
  }),
  z.object({ type: z.literal('stream-end'), role, segmentId: z.string(), endNs: nsString, lost: z.boolean().optional() }),
  z.object({ type: z.literal('pointer'), segmentId: z.string(), file: z.string() }),
  z.object({ type: z.literal('keys'), segmentId: z.string(), file: z.string() }),
  z.object({
    type: z.literal('cursor'),
    id: z.string(),
    file: z.string(),
    hotspot: z.object({ x: z.number(), y: z.number() }),
    scale: z.number().positive().optional(),
    shape: z.string().optional(),
  }),
]);
export type JournalLine = z.infer<typeof journalLine>;

/**
 * 指针事件文件（`pointer` 行的 `file`）的一行：`[ns, 'm', x, y]` 位置（捕获画面的归一化坐标）、`[ns, 'b', button, down]` 按键、
 * `[ns, 'c', cursorId]` 光标外观。键盘事件文件的一行：`[ns, code, down, key]`。
 */
export type PointerEventLine = [string, 'm', number, number] | [string, 'b', number, 0 | 1] | [string, 'c', string];
export type KeyEventLine = [string, string, 0 | 1, string];

/** 系统设置里各项权限的位置（英文路径，进错误的 `details.systemAccess`）。 */
export const SETTINGS_PATHS: Record<string, Record<'screen' | 'camera' | 'microphone' | 'inputMonitoring', string>> = {
  darwin: {
    screen: 'System Settings > Privacy & Security > Screen & System Audio Recording',
    camera: 'System Settings > Privacy & Security > Camera',
    microphone: 'System Settings > Privacy & Security > Microphone',
    inputMonitoring: 'System Settings > Privacy & Security > Input Monitoring',
  },
  win32: {
    screen: 'Settings > Privacy & security > Screenshots and screen recording',
    camera: 'Settings > Privacy & security > Camera',
    microphone: 'Settings > Privacy & security > Microphone',
    inputMonitoring: 'Settings > Privacy & security',
  },
};
