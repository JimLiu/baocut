import type { DocumentRecord, Id, SpaceEntry, TimelineItem } from '@baocut/protocol';
import { derivedFrom } from './space.ts';

/**
 * 剪成短视频的结果（产品设计 §5.10「结果页」）：这一轮会话派生出了哪几支子视频、子视频从父视频的哪一段来。
 * 子视频的派生来源文档（`kind: 'derivation'`，视频格式规范 `baocut.derivation/1`）随快照下发，概要就是正文。
 */

export const DERIVATION_KIND = 'derivation';

/** 子视频的派生来源：父视频、父视频剪辑后时间线上的区间（秒）、记剪口的主素材。 */
export interface ShortsDerivation {
  parentVideoId: Id;
  parentRevision: string | null;
  range: { start: number; end: number };
  primaryAssetId: Id | null;
  /** 开头一句（派生时智能体给的）；没给时 null，卡片取保留段的第一句。 */
  hook: string | null;
  /** 为什么挑它；没给时 null。 */
  reason: string | null;
  /** 提示牌；没给时空。 */
  notes: string[];
  /** 分段取景有几个镜头（派生来源文档的 `settings.crops`，没有时按 `framing.shots`）；没有分段取景时 0。 */
  shots: number;
  /** 其中几段分屏（`settings.crops` 里带 `layout` 的项，短视频分屏设计 §8.2）。 */
  splits: number;
  /** 版式条（子视频时间线的秒）；没有分屏段时 null。 */
  strip: LayoutSegment[] | null;
}

/** 版式条的一段（子视频时间线的秒）：一人（`n` 为 1）或分屏 `n` 格；相邻同格数的合成一段。 */
export interface LayoutSegment {
  start: number;
  end: number;
  n: number;
}

/** `settings.crops` 的每一项：父视频时间线上的 `[from, to)` 与格数（一人是 1）；认不出的项跳过。 */
function cropSpans(summary: Record<string, unknown>): LayoutSegment[] {
  const crops = (summary.settings as { crops?: unknown } | undefined)?.crops;
  if (!Array.isArray(crops)) return [];
  return crops.flatMap((crop: unknown) => {
    if (!crop || typeof crop !== 'object') return [];
    const c = crop as { from?: unknown; to?: unknown; layout?: unknown; panels?: unknown };
    const start = Number(c.from);
    const end = Number(c.to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return [];
    return [{ start, end, n: typeof c.layout === 'string' && Array.isArray(c.panels) ? c.panels.length : 1 }];
  });
}

/**
 * 版式条（原型 model-shorts-cut.js `layoutStrip`）：把各段取景按时间排开，没盖住的地方按兜底的一人取景算，相邻同格数的合成一段，
 * 换成子视频时间线的秒（减去区间起点）。没有分屏段、或区间是空的时 null。
 */
export function layoutStrip(spans: readonly LayoutSegment[], range: { start: number; end: number }): LayoutSegment[] | null {
  if (!spans.some((s) => s.n > 1) || !(range.end > range.start)) return null;
  const out: LayoutSegment[] = [];
  const push = (start: number, end: number, n: number) => {
    if (!(end - start > 1e-6)) return;
    const last = out[out.length - 1];
    if (last && last.n === n) last.end = end;
    else out.push({ start, end, n });
  };
  let at = range.start;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const start = Math.max(s.start, at);
    const end = Math.min(s.end, range.end);
    if (!(end > start)) continue;
    push(at, start, 1);
    push(start, end, s.n);
    at = end;
  }
  push(at, range.end, 1);
  return out.map((s) => ({ start: s.start - range.start, end: s.end - range.start, n: s.n }));
}

const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const lengthOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** 分段取景有几个镜头：按 `settings.crops`（派生时给的各段取景）数；`framing.shots` 是主素材在源时钟上的各段，剪口会把一个镜头拆成几段，只作兜底。 */
function shotCount(summary: Record<string, unknown>): number {
  const framing = summary.framing as { shots?: unknown } | undefined;
  const settings = summary.settings as { crops?: unknown } | undefined;
  return lengthOf(settings?.crops) || lengthOf(framing?.shots);
}

/** 结果页卡上「取景」那一行写几个镜头：分了不止一个镜头、或有分屏段时是段数，否则 null（不出这一行）。 */
export function framingShots(derivation: Pick<ShortsDerivation, 'shots' | 'splits'> | null): number | null {
  return derivation && (derivation.shots > 1 || derivation.splits > 0) ? Math.max(1, derivation.shots) : null;
}

/** 视频里的派生来源文档的概要；不是子视频（没有这份文档、或认不出）时 null。 */
export function readDerivation(documents: Record<Id, DocumentRecord> | null | undefined): ShortsDerivation | null {
  if (!documents) return null;
  for (const record of Object.values(documents)) {
    if (record.kind !== DERIVATION_KIND) continue;
    const summary = record.revisions[record.currentRevision]?.summary as Record<string, unknown> | undefined;
    if (!summary || typeof summary !== 'object' || typeof summary.parentVideoId !== 'string') continue;
    const range = summary.range as { start?: unknown; end?: unknown } | undefined;
    const start = Number(range?.start);
    const end = Number(range?.end);
    if (range?.start === undefined || range?.end === undefined || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    return {
      parentVideoId: summary.parentVideoId,
      parentRevision: typeof summary.parentRevision === 'string' ? summary.parentRevision : null,
      range: { start, end },
      primaryAssetId: typeof summary.primaryAssetId === 'string' ? summary.primaryAssetId : null,
      // 加法式字段：旧的派生来源文档没有，卡片就不显示。
      hook: textOf(summary.hook),
      reason: textOf(summary.reason),
      notes: Array.isArray(summary.notes) ? summary.notes.flatMap((n) => textOf(n) ?? []) : [],
      shots: shotCount(summary),
      splits: cropSpans(summary).filter((s) => s.n > 1).length,
      strip: layoutStrip(cropSpans(summary), { start, end }),
    };
  }
  return null;
}

/** 一条会话里智能体新建的视频（`video-created`：`videos_create` 与新派生的子视频；认回已有子视频的不记）。时间线还没读到时 null。 */
export function createdVideoIds(items: readonly TimelineItem[] | undefined): Set<Id> | null {
  if (!items) return null;
  const ids = new Set<Id>();
  for (const item of items) if (item.kind === 'video-created') ids.add(item.videoId);
  return ids;
}

/** 认这一轮的依据：交出去的那条会话、那一刻，与（时间线读到时）会话里新建的视频。 */
export interface ShortsBatchKey {
  parentVideoId: Id;
  conversationId: Id;
  /** 交给 Agent 的那一刻（ISO）。 */
  handedAt: string;
  /** 那条会话时间线里 `video-created` 的视频；时间线还没读到时 null。 */
  created: ReadonlySet<Id> | null;
}

const videoIdOf = (entry: Pick<SpaceEntry, 'ref'>): Id | null => (entry.ref && 'videoId' in entry.ref ? entry.ref.videoId : null);

/** 后台打开会更新数据库的写锁代与 mtime；只按内容版本重读，旧 Runtime 没有版本时退回最近活动时间。 */
export function shortFactsKey(entry: SpaceEntry): string {
  return JSON.stringify([entry.id, videoIdOf(entry), entry.source.projectId, entry.source.conversationId, entry.relPath, entry.statusDetail?.currentRevision ?? entry.lastActivityAt]);
}

const createdAt = (entry: Pick<SpaceEntry, 'createdAt' | 'lastActivityAt'>) => entry.createdAt ?? entry.lastActivityAt;

/**
 * 这一轮切出的子视频（含回收站里的，调用方按需要再筛），按创建先后排。从 Space 里这部父视频派生的视频条目里认：
 *
 * 1. 条目的 `origin.conversationId` 有值时只按它（Runtime 现在的派生条目不带，留着以后带上）；
 * 2. 否则会话时间线里新建过它（`video-created`），或它是交出去之后才建的（`createdAt`，旧 Runtime 没有时按最近活动）。
 *
 * 认回已有子视频（同一区间与设置再派生一次）既没有 `video-created`，创建时间也早于这一轮：认不出，结果页不列。
 */
export function shortsBatch(entries: readonly SpaceEntry[], key: ShortsBatchKey): SpaceEntry[] {
  const out: SpaceEntry[] = [];
  const seen = new Set<Id>();
  for (const entry of entries) {
    if (derivedFrom(entry) !== key.parentVideoId) continue;
    const videoId = videoIdOf(entry);
    if (!videoId || seen.has(videoId)) continue;
    const origin = entry.origin?.conversationId;
    const mine = origin ? origin === key.conversationId : !!key.created?.has(videoId) || createdAt(entry) >= key.handedAt;
    if (!mine) continue;
    seen.add(videoId);
    out.push(entry);
  }
  return out.sort((a, b) => createdAt(a).localeCompare(createdAt(b)) || a.name.localeCompare(b.name));
}

/** 条目指向的视频（子视频卡用）；不是视频条目时 null。 */
export function entryVideoId(entry: Pick<SpaceEntry, 'ref'>): Id | null {
  return videoIdOf(entry);
}

/**
 * 头上「第 k/N」的 k（从 0 起）：开着的是其中一支就是它；开着父视频时是上次选中的那一支，没选过是第一支。
 * 没有子视频时 -1。
 */
export function pagerIndex(ids: readonly Id[], openId: Id | null, focus: Id | null): number {
  if (!ids.length) return -1;
  const open = openId ? ids.indexOf(openId) : -1;
  if (open >= 0) return open;
  const focused = focus ? ids.indexOf(focus) : -1;
  return focused >= 0 ? focused : 0;
}

/** 父视频「切出的短视频」一组默认露出几行（原型 `MADE_SHOWN`）；多的收起，「还有 N 支」展开。 */
export const MADE_SHOWN = 6;

/**
 * 父视频「切出的短视频」一组里的子视频（原型 `madeOrder`）：从这部视频切出、没移进回收站的，同一个视频只算一次；
 * 按建立时间倒序，新切的在最上面，同一时刻按名字。
 */
export function madeShorts(entries: readonly SpaceEntry[], videoId: Id): SpaceEntry[] {
  const seen = new Set<Id>();
  const createdAt = (entry: SpaceEntry) => entry.createdAt ?? entry.lastActivityAt;
  return entries
    .filter((e) => !e.user.trashedAt && derivedFrom(e) === videoId)
    .filter((e) => {
      const id = entryVideoId(e);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => createdAt(b).localeCompare(createdAt(a)) || a.name.localeCompare(b.name));
}
