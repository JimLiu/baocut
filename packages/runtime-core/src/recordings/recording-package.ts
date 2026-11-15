import fs from 'node:fs/promises';
import path from 'node:path';
import { journalLine, type JournalLine } from './worker-protocol.ts';

/**
 * 录制目录 → 可以导入的一份录制（屏幕录制设计 §7「收尾」，视频格式规范 §4.7–§4.10）。只读 Worker 写下的 `journal.jsonl` 与它指向的
 * 文件，所以正常停止与崩溃之后的恢复是同一条路径，不需要 Worker 在场：
 *
 * - 时刻：日志里是系统单调时钟上的纳秒；录制时间从 0 开始、不计暂停，换成 `TIMESCALE`（微秒）的整数刻度。每段的 `t0` 是前面各段
 *   长度之和；一路流的 `start` 是 `段的 t0 + (流的第一个样本 − 段的开始)`。Worker 丢掉了段外的样本，所以流不会早于段开始。
 * - 结尾：日志里有 `stream-end` / `segment-end` 的照用；崩溃之后没有的，按文件里读得出的时长补上（`probe`）。
 * - 有内容的区间（`coverage`）：`[start, min(start + 文件时长, 断开的时刻, 段的结尾))`。设备晚启动、中途断开都这样表达。
 * - 指针与键盘：Worker 的事件文件按段换算成格式规范的指针轨与键盘轨（时刻是相对这一段开头的微秒），写进 `package/`。
 *   `shortcuts` 的键盘轨一律不留 `key`（格式规范 §4.10：这是录制后端的义务，Runtime 再兜一次）。
 */

export const TIMESCALE = 1_000_000;
/** 屏幕取景文档的刻度（毫秒）：取景只要这个精度。 */
/** 比这短的段与流（不到几帧，比如继续后马上又暂停）当作没有内容丢掉；放进时间线再修尾会修成零长。 */
const MIN_SPAN = TIMESCALE / 10;

export const VIEW_TIMESCALE = 1000;

export type MediaRole = 'screen' | 'camera' | 'microphone' | 'system-audio';

export interface PackageStream {
  /** 清单里的流 ID：`<段>-<角色>`。 */
  id: string;
  role: MediaRole | 'pointer' | 'keyboard';
  segmentId: string;
  /** 要导入的文件（绝对路径）。 */
  file: string;
  /** 素材源时间 0 在录制时间的哪一刻（刻度）。 */
  start: number;
  /** 录制时间上真正有内容的区间（刻度）。 */
  coverage: { t0: number; t1: number };
  /** 文件本身的长度（刻度）：比有内容的区间长时，导入把实例修到区间的结尾。 */
  length: number;
  device?: { id?: string; name?: string };
  lost?: true;
}

export interface PackageCursor {
  id: string;
  file: string;
  hotspot: { x: number; y: number };
  scale?: number;
  shape?: string;
}

export interface RecordingPackage {
  recorder: { name: string; version?: string; revision?: string };
  platform: string;
  startedAt: string;
  capture: { kind: 'display' | 'window' | 'area'; width: number; height: number; scale: number };
  cursor: 'separate' | 'baked' | 'none';
  keyboard: 'shortcuts' | 'all' | null;
  /** 有效录制长度（刻度）。 */
  duration: number;
  segments: Array<{ id: string; t0: number; t1: number }>;
  streams: PackageStream[];
  cursors: PackageCursor[];
  /** 读日志与文件时丢掉的东西（读不出的文件、坏行），英文，给日志与任务的警告。 */
  warnings: string[];
}

export class RecordingPackageError extends Error {
  readonly code: 'RECORDING_EMPTY' | 'RECORDING_JOURNAL_INVALID';
  constructor(code: 'RECORDING_EMPTY' | 'RECORDING_JOURNAL_INVALID', message: string) {
    super(message);
    this.code = code;
  }
}

/** 读一个媒体文件的时长（秒）；读不出时 null。 */
export type ProbeDuration = (file: string) => Promise<number | null>;

/** 读日志：每行一个对象，崩溃时最后一行可能只写了一半（跳过并记警告）。 */
export async function readJournal(captureDir: string): Promise<{ lines: JournalLine[]; warnings: string[] }> {
  let text: string;
  try {
    text = await fs.readFile(path.join(captureDir, 'journal.jsonl'), 'utf8');
  } catch {
    throw new RecordingPackageError('RECORDING_EMPTY', 'The recording has no journal');
  }
  const lines: JournalLine[] = [];
  const warnings: string[] = [];
  for (const [n, raw] of text.split('\n').entries()) {
    if (!raw.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      warnings.push(`Journal line ${n + 1} is not JSON; skipped`);
      continue;
    }
    const parsed = journalLine.safeParse(value);
    if (!parsed.success) {
      warnings.push(`Journal line ${n + 1} has an unknown shape; skipped`);
      continue;
    }
    lines.push(parsed.data);
  }
  return { lines, warnings };
}

const usOf = (ns: bigint): number => Number(ns / 1000n);

/** 由日志与文件得出一份录制（见文件头）。`outDir` 放换算出的指针轨与键盘轨。 */
export async function buildPackage(captureDir: string, outDir: string, probe: ProbeDuration): Promise<RecordingPackage> {
  const { lines, warnings } = await readJournal(captureDir);
  const begin = lines.find((line) => line.type === 'begin');
  if (!begin || begin.type !== 'begin') throw new RecordingPackageError('RECORDING_JOURNAL_INVALID', 'The journal has no begin line');

  interface RawStream {
    role: MediaRole;
    segmentId: string;
    file: string;
    startNs: bigint;
    endNs: bigint | null;
    lost: boolean;
    device?: { id?: string; name?: string };
  }
  const segments = new Map<string, { startNs: bigint; endNs: bigint | null; pointer?: string; keys?: string }>();
  const streams: RawStream[] = [];
  const cursors: PackageCursor[] = [];
  for (const line of lines) {
    switch (line.type) {
      case 'segment':
        if (!segments.has(line.id)) segments.set(line.id, { startNs: BigInt(line.startNs), endNs: null });
        break;
      case 'segment-end': {
        const seg = segments.get(line.id);
        if (seg) seg.endNs = BigInt(line.endNs);
        break;
      }
      case 'stream':
        if (segments.has(line.segmentId) && !streams.some((s) => s.segmentId === line.segmentId && s.role === line.role)) {
          streams.push({
            role: line.role,
            segmentId: line.segmentId,
            file: path.join(captureDir, line.file),
            startNs: BigInt(line.startNs),
            endNs: null,
            lost: false,
            ...(line.device ? { device: line.device } : {}),
          });
        }
        break;
      case 'stream-end': {
        const stream = streams.find((s) => s.segmentId === line.segmentId && s.role === line.role);
        if (stream) {
          stream.endNs = BigInt(line.endNs);
          stream.lost = line.lost === true;
        }
        break;
      }
      case 'pointer': {
        const seg = segments.get(line.segmentId);
        if (seg) seg.pointer = path.join(captureDir, line.file);
        break;
      }
      case 'keys': {
        const seg = segments.get(line.segmentId);
        if (seg) seg.keys = path.join(captureDir, line.file);
        break;
      }
      case 'cursor':
        if (!cursors.some((c) => c.id === line.id)) {
          cursors.push({
            id: line.id,
            file: path.join(captureDir, line.file),
            hotspot: line.hotspot,
            ...(line.scale !== undefined ? { scale: line.scale } : {}),
            ...(line.shape !== undefined ? { shape: line.shape } : {}),
          });
        }
        break;
      default:
        break;
    }
  }

  // 每路流在文件里有多长；读不出（崩溃时还没写下第一个分片）的丢掉。
  const lengths = new Map<RawStream, bigint>();
  for (const stream of streams) {
    const seconds = await probe(stream.file);
    if (seconds === null || !(seconds > 0)) {
      warnings.push(`Dropped the ${stream.role} stream of segment ${stream.segmentId}: its file is missing or unreadable`);
      continue;
    }
    lengths.set(stream, BigInt(Math.round(seconds * 1e9)));
  }

  // 段的结尾：日志里有的照用，没有的取它各路流的结尾里最晚的；没有内容的段丢掉。
  const out: RecordingPackage = {
    recorder: begin.recorder,
    platform: begin.platform,
    startedAt: begin.startedAt,
    capture: begin.capture,
    cursor: begin.cursor,
    keyboard: begin.keyboard,
    duration: 0,
    segments: [],
    streams: [],
    cursors: [],
    warnings,
  };
  await fs.mkdir(outDir, { recursive: true });
  const ordered = [...segments.entries()].sort((a, b) => (a[1].startNs < b[1].startNs ? -1 : a[1].startNs > b[1].startNs ? 1 : 0));
  let t0 = 0;
  const written = new Set<string>();
  for (const [segmentId, seg] of ordered) {
    const own = streams.filter((s) => s.segmentId === segmentId && lengths.has(s));
    let endNs = seg.endNs;
    if (endNs === null) {
      for (const s of own) {
        const end = s.endNs ?? s.startNs + lengths.get(s)!;
        if (endNs === null || end > endNs) endNs = end;
      }
    }
    const span = endNs === null ? 0 : usOf(endNs - seg.startNs);
    const screen = own.find((s) => s.role === 'screen');
    if (span < MIN_SPAN || !screen) {
      warnings.push(`Dropped segment ${segmentId}: it is too short or has no screen recording`);
      continue;
    }
    const t1 = t0 + span;
    out.segments.push({ id: segmentId, t0, t1 });
    for (const s of own) {
      const length = usOf(lengths.get(s)!);
      const start = t0 + usOf(s.startNs - seg.startNs);
      let end = Math.min(start + length, t1);
      if (s.endNs !== null) end = Math.min(end, t0 + usOf(s.endNs - seg.startNs));
      if (end - start < MIN_SPAN) {
        warnings.push(`Dropped the ${s.role} stream of segment ${segmentId}: it has too little content inside the segment`);
        continue;
      }
      out.streams.push({
        id: `${segmentId}-${s.role}`,
        role: s.role,
        segmentId,
        file: s.file,
        start,
        coverage: { t0: start, t1: end },
        length,
        ...(s.device ? { device: s.device } : {}),
        ...(s.lost ? { lost: true as const } : {}),
      });
    }
    if (begin.cursor !== 'none' && seg.pointer) {
      const file = path.join(outDir, `${segmentId}-pointer.json`);
      const events = await convertPointer(seg.pointer, seg.startNs, warnings);
      if (events) {
        await fs.writeFile(file, distinct(JSON.stringify(events), written));
        out.streams.push({ id: `${segmentId}-pointer`, role: 'pointer', segmentId, file, start: t0, coverage: { t0, t1 }, length: span });
      }
    }
    if (begin.keyboard && seg.keys) {
      const file = path.join(outDir, `${segmentId}-keys.json`);
      const events = await convertKeys(seg.keys, seg.startNs, begin.keyboard, warnings);
      if (events) {
        await fs.writeFile(file, distinct(JSON.stringify(events), written));
        out.streams.push({ id: `${segmentId}-keyboard`, role: 'keyboard', segmentId, file, start: t0, coverage: { t0, t1 }, length: span });
      }
    }
    t0 = t1;
  }
  if (out.segments.length === 0) throw new RecordingPackageError('RECORDING_EMPTY', 'Nothing was recorded');
  out.duration = t0;
  if (begin.cursor === 'separate') {
    for (const cursor of cursors) {
      try {
        await fs.access(cursor.file);
        out.cursors.push(cursor);
      } catch {
        warnings.push(`Dropped cursor image ${cursor.id}: its file is missing`);
      }
    }
  }
  // 没有指针流时清单只能说 `none`（格式规范 §4.7）：例如 Worker 在第一段写下指针文件之前就崩溃了。
  if (out.cursor !== 'none' && !out.streams.some((s) => s.role === 'pointer')) {
    out.cursor = out.cursor === 'separate' ? 'none' : out.cursor;
    if (out.cursor === 'none') out.cursors = [];
  }
  if (out.keyboard && !out.streams.some((s) => s.role === 'keyboard')) out.keyboard = null;
  return out;
}

async function readEventLines(file: string, warnings: string[]): Promise<unknown[][] | null> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    warnings.push(`Event file ${path.basename(file)} is missing`);
    return null;
  }
  const rows: unknown[][] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      const row = JSON.parse(raw);
      if (Array.isArray(row)) rows.push(row);
    } catch {
      // 崩溃时最后一行可能只写了一半。
    }
  }
  return rows;
}

/** 相对段开头的刻度；早于段开头的夹到 0。 */
const relTicks = (ns: unknown, segStart: bigint): number | null => {
  if (typeof ns !== 'string' || !/^\d{1,20}$/.test(ns)) return null;
  const value = BigInt(ns) - segStart;
  return value < 0n ? 0 : usOf(value);
};

const sortByT = <T extends [number, ...unknown[]]>(rows: T[]): T[] => rows.sort((a, b) => a[0] - b[0]);

/**
 * 引擎按内容导入素材：两段的指针轨或键盘轨字节相同（指针一直没动、两段都没按键）时会变成同一个素材，而清单不允许两路流用同一个
 * 素材（§4.7）。字节撞上时在末尾多加换行（JSON 里无意义的空白），让每一路都是自己的素材。
 */
function distinct(body: string, written: Set<string>): string {
  let text = body;
  while (written.has(text)) text += '\n';
  written.add(text);
  return text;
}

export async function convertPointer(file: string, segStart: bigint, warnings: string[]) {
  const rows = await readEventLines(file, warnings);
  if (!rows) return null;
  const moves: Array<[number, number, number]> = [];
  const buttons: Array<[number, number, 0 | 1]> = [];
  const cursors: Array<[number, string]> = [];
  for (const row of rows) {
    const t = relTicks(row[0], segStart);
    if (t === null) continue;
    if (row[1] === 'm' && typeof row[2] === 'number' && typeof row[3] === 'number' && Number.isFinite(row[2]) && Number.isFinite(row[3])) {
      moves.push([t, row[2], row[3]]);
    } else if (row[1] === 'b' && Number.isInteger(row[2]) && (row[3] === 0 || row[3] === 1)) {
      buttons.push([t, row[2] as number, row[3]]);
    } else if (row[1] === 'c' && typeof row[2] === 'string' && row[2]) {
      cursors.push([t, row[2]]);
    }
  }
  return { format: 'baocut-pointer-track', version: 1, timescale: TIMESCALE, moves: sortByT(moves), buttons: sortByT(buttons), cursors: sortByT(cursors) };
}

const KEY_CODE = /^[A-Za-z0-9]{1,64}$/;

export async function convertKeys(file: string, segStart: bigint, scope: 'shortcuts' | 'all', warnings: string[]) {
  const rows = await readEventLines(file, warnings);
  if (!rows) return null;
  const keys: Array<[number, string, 0 | 1, string]> = [];
  for (const row of rows) {
    const t = relTicks(row[0], segStart);
    if (t === null || (row[2] !== 0 && row[2] !== 1)) continue;
    const code = typeof row[1] === 'string' && KEY_CODE.test(row[1]) ? row[1] : 'Unidentified';
    const key = scope === 'all' && typeof row[3] === 'string' && Buffer.byteLength(row[3]) <= 64 ? row[3] : '';
    keys.push([t, code, row[2], key]);
  }
  return { format: 'baocut-key-track', version: 1, timescale: TIMESCALE, keys: sortByT(keys) };
}

/** 素材版本的引用（视频格式规范 §2.3）。 */
export interface VersionRef {
  id: string;
  revision: string;
}

/** 录制清单的正文（格式规范 §4.7）。`refs` 是每个导入的文件对应的素材版本。 */
export function manifestBody(pkg: RecordingPackage, refs: ReadonlyMap<string, VersionRef>): Record<string, unknown> {
  const ticks = (n: number) => String(n);
  return {
    schema: 'baocut.recording/1',
    timescale: TIMESCALE,
    clock: 'recording',
    recorder: pkg.recorder,
    platform: pkg.platform,
    startedAt: pkg.startedAt,
    duration: ticks(pkg.duration),
    segments: pkg.segments.map((s) => ({ id: s.id, t0: ticks(s.t0), t1: ticks(s.t1) })),
    streams: pkg.streams.map((s) => ({
      id: s.id,
      role: s.role,
      segmentId: s.segmentId,
      assetRef: refOf(refs, s.file),
      start: ticks(s.start),
      coverage: [{ t0: ticks(s.coverage.t0), t1: ticks(s.coverage.t1) }],
      ...(s.device ? { device: s.device } : {}),
      ...(s.role === 'screen' ? { capture: pkg.capture } : {}),
    })),
    pointer: {
      mode: pkg.cursor,
      ...(pkg.cursor === 'separate'
        ? {
            cursors: pkg.cursors.map((c) => ({
              id: c.id,
              assetRef: refOf(refs, c.file),
              hotspot: { x: clamp01(c.hotspot.x), y: clamp01(c.hotspot.y) },
              ...(c.scale !== undefined ? { scale: c.scale } : {}),
              ...(c.shape !== undefined ? { shape: c.shape } : {}),
            })),
          }
        : {}),
    },
    ...(pkg.keyboard ? { keyboard: { scope: pkg.keyboard } } : {}),
  };
}

function refOf(refs: ReadonlyMap<string, VersionRef>, file: string): VersionRef {
  const ref = refs.get(file);
  if (!ref) throw new Error(`No imported asset for ${path.basename(file)}`);
  return ref;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 屏幕取景的缺省正文（格式规范 §4.9）：录制时间、还没有缩放区间，光标按缺省画。 */
export function defaultScreenView(): Record<string, unknown> {
  return { schema: 'baocut.screen-view/1', timescale: VIEW_TIMESCALE, clock: 'recording', solver: 1, zooms: [] };
}
