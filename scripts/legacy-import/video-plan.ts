// 一个旧项目变成一个视频的「计划」：先列出素材，素材登记之后（知道了 ID、尺寸与时长）再给出文档、轨道与实例。
// 计划是纯数据；写进视频由 video-writer.ts 负责，预演（dry-run）只算不写。

import type { Rate } from './exact-time.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** 旧格式自己记下的素材信息：预演时代替引擎的探测结果。 */
export interface MediaHint {
  kind: 'video' | 'audio' | 'image' | 'lottie' | 'bundle' | 'other';
  width?: number;
  height?: number;
  durationUs?: bigint;
  hasAudio?: boolean;
}

export interface AssetPlan {
  ref: string;
  path: string;
  name?: string;
  /** 目录素材（代码包）只收这些相对路径。 */
  include?: string[];
  bundle?: Json;
  provenance?: { origin: string; source?: Json };
  /** 旧格式记下的 `sha256-…`，用来发现文件在旧项目建好之后变过。 */
  legacyHash?: string;
  hint: MediaHint;
}

/** 登记之后的素材。预演时由 `hint` 合成。 */
export interface AssetInfo {
  id: string;
  revision: string;
  kind: string;
  width?: number;
  height?: number;
  durationUs?: bigint;
  hasAudio: boolean;
  contentHash?: string;
}

export interface DocumentPlan {
  ref: string;
  kind: string;
  name: string;
  language?: string;
  sourceAsset?: string;
  sourceDocument?: string;
  body: Json;
  summary?: Json;
}

export interface TrackPlan {
  key: string;
  kind: 'visual' | 'audio' | 'subtitle';
  name: string;
  /** 旧轨道的隐藏、静音与锁定。锁定在全部写完之后才设，免得挡住后面的写入。 */
  hidden?: boolean;
  muted?: boolean;
  locked?: boolean;
}

/** `followPolicy` 里指向转写文档的占位：写入时换成转写文档当时的 `VersionRef`。 */
export const SPEECH_REF = { document: 'speech' };

export interface KeyframePlan {
  property: string;
  keyframes: Json[];
}

/** 旧元素自己的单侧转场：`in` 落在实例的开头（`rightItemId`），`out` 落在结尾（`leftItemId`）。 */
export interface TransitionPlan {
  side: 'in' | 'out';
  kind: string;
  /** 十进制秒。 */
  duration: string;
}

export interface ItemPlan {
  track: string;
  /** 旧项目里的 ID，写进 `extensions["baocut.import"].sourceId`，也用来把字幕、关键帧、转场、闪避与剪口集合挂到对应的实例上。 */
  sourceId: string;
  /** 实例的字段，不含 `trackId`。字幕实例的 `documentId` 等由下面三个字段解析。 */
  item: { [key: string]: Json };
  document?: string;
  styleDocument?: string;
  scopeSourceIds?: string[];
  keyframes?: KeyframePlan[];
  transitions?: TransitionPlan[];
}

/** 一条闪避规则：v2 写在被压低的元素上，这里按（触发、深度、起落）归并成序列上的规则。 */
export interface DuckingPlan {
  trigger: { kind: 'speech' } | { kind: 'tracks'; legacyTrack: string };
  depth?: number;
  attack?: string;
  release?: string;
  targetSourceIds: string[];
}

/** 一份剪口集合（视频格式规范 §6.7）：正文里的 `scopeItemIds` 在实例写完之后由 `scopeSourceIds` 换成实例 ID。 */
export interface CutSetPlan {
  ref: string;
  name: string;
  sourceAsset: string;
  body: { [key: string]: Json };
  scopeSourceIds: string[];
}

export interface VideoContent {
  documents: DocumentPlan[];
  tracks: TrackPlan[];
  items: ItemPlan[];
  /** 旧轨道 ID → 它拆出来的新轨道（闪避按轨道触发时用）。 */
  legacyTracks?: Record<string, string[]>;
  ducking?: DuckingPlan[];
  cutSets?: CutSetPlan[];
  template?: Json;
  /** 画布底色 `#RRGGBB`。 */
  background?: string;
}

export interface ProjectPlan {
  /** 稳定的键：决定视频目录名与事务的 commandId，重跑时不变。 */
  key: string;
  name: string;
  dirName: string;
  fps: Rate;
  width: number;
  height: number;
  assets: AssetPlan[];
  build(assets: Map<string, AssetInfo>): VideoContent;
  report: ProjectReport;
}

export interface ProjectReport {
  source: string;
  format: string;
  kind: string;
  name: string;
  videoDir?: string;
  fps: { legacy: number | null; rate: Rate; note?: string };
  canvas: { width: number; height: number; note?: string };
  assets: { planned: number; linked: number; missing: string[]; hashChanged: string[]; reused: number };
  documents: Record<string, number>;
  tracks: number;
  items: Record<string, number>;
  /** 旧格式里有、新格式没有位置的字段：原样放进 `extensions["baocut.import"]`，这里计数。 */
  unmapped: Record<string, number>;
  /** 旧格式里有、在新格式里不适用的行为或对应关系（键里写原因），不算丢失。 */
  notApplicable: Record<string, number>;
  /** 导入时做的估算（画布尺寸、没有终点的音频的长度等）。 */
  estimated: Record<string, number>;
  /** 超出新格式取值范围、夹到范围里的值。 */
  clamped: Record<string, number>;
  /** 新格式不接受、没有写进去的字段或对象（逐项的说明在 `warnings`）。 */
  dropped: Record<string, number>;
  /** 写进去的关键帧绑定、转场、闪避规则、剪口集合等序列上的对象。 */
  written: Record<string, number>;
  /** 生效长度比写入长度短的单侧转场（实例不到转场的两倍长，引擎的回执）。 */
  shortenedTransitions: { sourceId: string; side: string; durationFrames: number; effectiveFrames: number }[];
  anchors: { resolved: number; unresolved: number };
  time: { maxSnapMs: number; clampedTails: number };
  notImported: string[];
  warnings: string[];
  failed: string[];
  durationFrames?: number;
  revision?: string;
}

export function newReport(source: string, format: string, kind: string, name: string, fps: Rate): ProjectReport {
  return {
    source,
    format,
    kind,
    name,
    fps: { legacy: null, rate: fps },
    canvas: { width: 0, height: 0 },
    assets: { planned: 0, linked: 0, missing: [], hashChanged: [], reused: 0 },
    documents: {},
    tracks: 0,
    items: {},
    unmapped: {},
    notApplicable: {},
    estimated: {},
    clamped: {},
    dropped: {},
    written: {},
    shortenedTransitions: [],
    anchors: { resolved: 0, unresolved: 0 },
    time: { maxSnapMs: 0, clampedTails: 0 },
    notImported: [],
    warnings: [],
    failed: [],
  };
}

export function count(table: Record<string, number>, key: string, by = 1): void {
  table[key] = (table[key] ?? 0) + by;
}

/** 夹到 `[lo, hi]`；夹过的在报告的「夹到范围里的」计数。 */
export function clampTo(report: ProjectReport, label: string, value: number, lo: number, hi: number): number {
  if (value >= lo && value <= hi) return value;
  count(report.clamped, label);
  return value < lo ? lo : hi;
}

/** 缓动名的封闭表（`motion::curve::EASE_NAMES`）：关键帧、音量包络与动画预设共用。 */
export const EASE_NAMES = [
  'linear',
  'easeInQuad',
  'easeOutQuad',
  'easeInOutQuad',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
  'easeInQuart',
  'easeOutQuart',
  'easeInOutQuart',
  'easeInExpo',
  'easeOutExpo',
  'easeInOutExpo',
  'easeInSine',
  'easeOutSine',
  'easeInOutSine',
  'easeInBack',
  'easeOutBack',
  'easeInOutBack',
  'easeOutElastic',
];

/** 同一条旧轨道上互相重叠的元素分到几条新轨道上（新格式同一轨道不重叠）。返回每个元素所在的行。 */
export function lanes(ranges: { start: number; end: number }[]): number[] {
  const order = ranges.map((_, i) => i).sort((a, b) => ranges[a].start - ranges[b].start || a - b);
  const ends: number[] = [];
  const lane = new Array<number>(ranges.length).fill(0);
  for (const i of order) {
    let n = ends.findIndex((end) => end <= ranges[i].start);
    if (n < 0) n = ends.push(0) - 1;
    ends[n] = ranges[i].end;
    lane[i] = n;
  }
  return lane;
}

/** 视频目录名：去掉路径分隔符与控制字符，保留原名可读。 */
export function dirNameOf(name: string): string {
  const cleaned = name
    .replace(/[\\/:\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return (cleaned || 'untitled').slice(0, 80).trim();
}

/** 目录名不能撞：大小写不敏感的文件系统上也不撞。 */
export function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} ${n}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
