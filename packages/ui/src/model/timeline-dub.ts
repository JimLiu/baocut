import type { AssetRecord, AudioItem, DocumentRecord, EditOperation, Id, Rate, Sequence, SequenceItem } from '@baocut/protocol';
import { itemRangeSeconds, mediaTimeToSeconds } from '@baocut/protocol';
import { DUB_EXTENSION } from './dub-undo.ts';
import { speechSpeakers } from './dub-setup.ts';
import { rateFromSpeed, speedOf } from './property-values.ts';
import { speechSentences } from './translation-doc.ts';

/**
 * 时间线上的配音块（设计稿 timeline-dub.jsx，产品设计 §12.6 / §15.6）：一组配音的实例在轨道上画成「淡的」块——
 * 左缘一道说话人色条、块上写这一句的译文，只有几种状态跳出来：语速快过 1.35× 整块换黄（过快），静音的压淡加删除线，
 * 手动拉过的在提示里写明。这里只算：哪些实例是配音块、每块的说话人与色相、译文、实际语速，拖右缘改语速时的新速率，
 * 以及菜单要发的操作。不碰 React。
 *
 * 数据从哪来（都不需要另取正文以外的东西）：
 * - 实例的 `extensions['baocut.dub']`：`{ groupId, language, unitId }`；分离出来的背景带 `stem`，不是配音块；
 * - 合成音频的素材来源（`provenance.source.tempo`）：流程对齐时用 atempo 加过的速，实例自己的变速再乘上去才是听到的语速；
 * - 配音计划文档（`dubbing-plan`，当前版本 `summary.groupId` 认组）：单元的译文与原句；
 * - 原句所在的转写（计划单元的 `targetAnchor.speechRef`）：句子第一个没隐藏的词的说话人。
 * 计划或转写还没取到时降级：块照画，色相取第一档、文字取片段名。
 */

/** 语速快过它就标「过快」（设计稿 model-tts.js `MAX_RATE`：舒适上限）。 */
export const DUB_FAST_RATE = 1.35;
/** 合同 `setSpeed` 收的速率范围。 */
export const DUB_SPEED_MIN = 0.1;
export const DUB_SPEED_MAX = 10;

/** 说话人 → 色相，按说话人在转写里的次序轮转（设计稿 model-tts.js `SPEAKER_HUES`）。 */
export const SPEAKER_HUES = ['blue', 'green', 'orange', 'purple', 'magenta', 'indigo'] as const;
export type SpeakerHue = (typeof SPEAKER_HUES)[number];

export function speakerHue(index: number): SpeakerHue {
  const n = SPEAKER_HUES.length;
  return SPEAKER_HUES[((Math.trunc(index) % n) + n) % n]!;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

// ---- 认块、认组 ----

export interface DubMark {
  groupId: string;
  language: string | null;
  unitId: string | null;
}

/** 这件实例是不是配音块：音频、带 `baocut.dub.groupId`、不是分离出来的背景（`stem`）。 */
export function dubMark(item: SequenceItem): DubMark | null {
  if (item.type !== 'audio') return null;
  const own = item.extensions?.[DUB_EXTENSION];
  if (!isObject(own) || own.stem !== undefined) return null;
  const groupId = text(own.groupId);
  return groupId ? { groupId, language: text(own.language), unitId: text(own.unitId) } : null;
}

export interface DubGroup {
  groupId: string;
  language: string | null;
  /** 这组的块，按时间先后。 */
  itemIds: Id[];
  trackIds: Id[];
}

/** 序列里的配音组（按第一次出现的次序），每组的块按时间先后。 */
export function dubGroups(sequence: Sequence): DubGroup[] {
  const groups = new Map<string, { group: DubGroup; starts: Map<Id, number> }>();
  for (const item of sequence.items) {
    const mark = dubMark(item);
    if (!mark) continue;
    let entry = groups.get(mark.groupId);
    if (!entry) {
      entry = { group: { groupId: mark.groupId, language: mark.language, itemIds: [], trackIds: [] }, starts: new Map() };
      groups.set(mark.groupId, entry);
    }
    entry.group.itemIds.push(item.id);
    entry.starts.set(item.id, itemRangeSeconds(item, sequence.fps).start);
    if (!entry.group.trackIds.includes(item.trackId)) entry.group.trackIds.push(item.trackId);
    entry.group.language ??= mark.language;
  }
  return [...groups.values()].map(({ group, starts }) => ({
    ...group,
    itemIds: [...group.itemIds].sort((a, b) => starts.get(a)! - starts.get(b)!),
  }));
}

/** 只放这一组配音的轨道：行头写「配音 · 语言」。空的轨道、混着别的实例或别的组的不算。 */
export function dubTrackGroup(sequence: Sequence, trackId: Id): DubGroup | null {
  const items = sequence.items.filter((item) => item.trackId === trackId);
  if (items.length === 0) return null;
  const marks = items.map(dubMark);
  const first = marks[0];
  if (!first || marks.some((m) => !m || m.groupId !== first.groupId)) return null;
  return dubGroups(sequence).find((g) => g.groupId === first.groupId) ?? null;
}

export type DubStem = 'background' | 'vocals';

/**
 * 只放一组配音分离出的同一种分轨的轨道（设计稿 model-timeline.js 的「背景声」行）：哪一种、哪一组、这组的语言。
 * 空的轨道、混着别的实例、别的分轨或别的组的不算。
 */
export function stemTrackOf(sequence: Sequence, trackId: Id): { stem: DubStem; groupId: string; language: string | null } | null {
  const items = sequence.items.filter((item) => item.trackId === trackId);
  if (items.length === 0) return null;
  const marks = items.map((item) => {
    const own = item.extensions?.[DUB_EXTENSION];
    return isObject(own) && (own.stem === 'background' || own.stem === 'vocals') && text(own.groupId)
      ? { stem: own.stem as DubStem, groupId: own.groupId as string }
      : null;
  });
  const first = marks[0];
  if (!first || marks.some((m) => !m || m.stem !== first.stem || m.groupId !== first.groupId)) return null;
  const language = dubGroups(sequence).find((g) => g.groupId === first.groupId)?.language ?? null;
  return { ...first, language };
}

// ---- 配音计划与转写 ----

/** 这组配音的计划文档：`dubbing-plan`，当前版本的概要里记着 `groupId`（流程写入时给的）。 */
export function planRecordOf(documents: Record<Id, DocumentRecord>, groupId: string): DocumentRecord | null {
  for (const record of Object.values(documents)) {
    if (record.kind !== 'dubbing-plan') continue;
    const summary = record.revisions[record.currentRevision]?.summary;
    if (isObject(summary) && summary.groupId === groupId) return record;
  }
  return null;
}

export interface PlanUnit {
  /** 译文单元（实例上的 `unitId`）。 */
  unitId: Id;
  /** 念的稿子（译文）。 */
  text: string | null;
  /** 原句与它所在的转写。 */
  sentenceId: Id | null;
  speechId: Id | null;
  status: string | null;
}

/** 配音计划正文里的单元，按译文单元认（`extensions['baocut.dub'].translationUnitId`，旧的退回 `d-<unitId>`）。 */
export function planUnits(body: unknown): Map<Id, PlanUnit> {
  const units = new Map<Id, PlanUnit>();
  if (!isObject(body) || !Array.isArray(body.units)) return units;
  for (const raw of body.units) {
    if (!isObject(raw)) continue;
    const own = isObject(raw.extensions) ? raw.extensions[DUB_EXTENSION] : undefined;
    const id = text(raw.id);
    const unitId = (isObject(own) ? text(own.translationUnitId) : null) ?? (id?.startsWith('d-') ? id.slice(2) : null);
    if (!unitId) continue;
    const anchor = isObject(raw.targetAnchor) ? raw.targetAnchor : null;
    const speechRef = anchor && isObject(anchor.speechRef) ? anchor.speechRef : null;
    const sentences = Array.isArray(raw.sourceSentenceIds) ? raw.sourceSentenceIds : [];
    units.set(unitId, {
      unitId,
      text: isObject(raw.script) ? text(raw.script.text) : null,
      sentenceId: text(sentences[0]) ?? (anchor ? text(anchor.sentenceId) : null),
      speechId: speechRef ? text(speechRef.id) : null,
      status: text(raw.status),
    });
  }
  return units;
}

/** 计划里引用的转写（取第一个有的）：说话人从它来。 */
export function planSpeechId(units: ReadonlyMap<Id, PlanUnit>): Id | null {
  for (const unit of units.values()) if (unit.speechId) return unit.speechId;
  return null;
}

export interface SpeakerIndex {
  /** 说话人在转写里的次序（决定色相）。 */
  order: string[];
  names: Map<string, string>;
  /** 句子 → 说话人：句子第一个没隐藏的词的（与 Runtime 一致）。 */
  bySentence: Map<Id, string>;
}

/** 转写里的说话人与每句的说话人；正文不是转写时 null，没有说话人信息时三张表都是空的。 */
export function sentenceSpeakers(body: unknown): SpeakerIndex | null {
  const sentences = speechSentences(body);
  if (!sentences || !isObject(body)) return null;
  const speakers = speechSpeakers(body);
  const words = new Map<Id, { speaker: string | null; hidden: boolean }>();
  for (const raw of Array.isArray(body.words) ? body.words : []) {
    if (isObject(raw) && typeof raw.id === 'string') words.set(raw.id, { speaker: text(raw.speaker), hidden: raw.hidden === true });
  }
  const bySentence = new Map<Id, string>();
  for (const sentence of sentences) {
    const speaker = sentence.wordIds.map((id) => words.get(id)).find((w) => w && !w.hidden)?.speaker;
    if (speaker) bySentence.set(sentence.id, speaker);
  }
  return { order: speakers.map((s) => s.speakerId), names: new Map(speakers.map((s) => [s.speakerId, s.name])), bySentence };
}

// ---- 语速 ----

/** 合成音频对齐时加过的速（素材来源里的 `tempo`；没有就是 1）。 */
export function dubTempo(item: AudioItem, assets: Record<Id, AssetRecord>): number {
  const source = assets[item.assetRef.id]?.revisions[item.assetRef.revision]?.provenance.source;
  const tempo = isObject(source) ? source.tempo : undefined;
  return typeof tempo === 'number' && Number.isFinite(tempo) && tempo > 0 ? tempo : 1;
}

/** 实例自己的变速（线性时间映射的速率；定格时是 1）。 */
export function itemSpeed(item: AudioItem): number {
  return item.timeMap.kind === 'linear' ? speedOf(item.timeMap.rate) : 1;
}

/** 块上的语速角标要不要写：1.0× 不写。 */
export function showsRate(rate: number): boolean {
  return Math.abs(rate - 1) >= 0.005;
}

export interface DubBlock {
  itemId: Id;
  groupId: string;
  language: string | null;
  unitId: string | null;
  /** 这一句在组里的序号（按时间，从 1 起）。 */
  index: number;
  /** 译文；计划还没取到时 null（画片段名）。 */
  text: string | null;
  speakerId: string | null;
  speakerName: string | null;
  hue: SpeakerHue;
  /** 合成时对齐加的速 × 实例的变速 = 听到的语速。 */
  tempo: number;
  speed: number;
  rate: number;
  fast: boolean;
  muted: boolean;
  /** 实例自己变过速（手动拉过右缘，或在属性里改过）。 */
  manual: boolean;
  /** 这一句正在重配（在跑的配音流程冻结的 `params.regroup` 里有它）；时间线叠加，不在这里算。 */
  queued?: boolean;
  /** 这一句有几个版本时，当前是第几版、用的种子（model/dub-takes.ts 的 `versionTip`）；只有一版时 null。 */
  version?: { k: number; seed: number | null } | null;
}

/** 已经取到的正文：组 → 配音计划正文，转写文档 ID → 转写正文。 */
export interface DubSources {
  assets: Record<Id, AssetRecord>;
  plans: ReadonlyMap<string, unknown>;
  speeches: ReadonlyMap<Id, unknown>;
}

/** 序列里所有的配音块。 */
export function dubBlocks(sequence: Sequence, sources: DubSources): Map<Id, DubBlock> {
  const blocks = new Map<Id, DubBlock>();
  const byId = new Map(sequence.items.map((item) => [item.id, item]));
  for (const group of dubGroups(sequence)) {
    const units = planUnits(sources.plans.get(group.groupId));
    const speechId = planSpeechId(units);
    const speakers = speechId ? sentenceSpeakers(sources.speeches.get(speechId)) : null;
    group.itemIds.forEach((itemId, i) => {
      const item = byId.get(itemId) as AudioItem;
      const mark = dubMark(item)!;
      const unit = mark.unitId ? units.get(mark.unitId) : undefined;
      const speakerId = (unit?.sentenceId && speakers?.bySentence.get(unit.sentenceId)) || null;
      const order = speakerId && speakers ? speakers.order.indexOf(speakerId) : -1;
      const tempo = dubTempo(item, sources.assets);
      const speed = itemSpeed(item);
      const rate = tempo * speed;
      blocks.set(itemId, {
        itemId,
        groupId: group.groupId,
        language: mark.language ?? group.language,
        unitId: mark.unitId,
        index: i + 1,
        text: unit?.text ?? null,
        speakerId,
        speakerName: speakerId ? (speakers?.names.get(speakerId) ?? speakerId) : null,
        hue: speakerHue(Math.max(0, order)),
        tempo,
        speed,
        rate,
        fast: rate > DUB_FAST_RATE + 1e-9,
        muted: !!item.mix.muted,
        manual: showsRate(speed),
      });
    });
  }
  return blocks;
}

// ---- 拖右缘改语速 ----

/** 同一条轨道上这件之后还有多少空（秒，到下一件的起点）；后面没有东西时 null。变长盖住后面的实例时引擎整笔拒绝。 */
export function roomAfter(sequence: Sequence, item: SequenceItem): number | null {
  const own = itemRangeSeconds(item, sequence.fps);
  let next: number | null = null;
  for (const other of sequence.items) {
    if (other.id === item.id || other.trackId !== item.trackId) continue;
    const start = itemRangeSeconds(other, sequence.fps).start;
    if (start >= own.end - 1e-9 && (next === null || start < next)) next = start;
  }
  return next === null ? null : next - own.start;
}

export interface Stretch {
  /** 要提交的速率（约分，取到两位小数）。 */
  rate: Rate;
  speed: number;
  /** 这个速率下块的长度（秒）。 */
  seconds: number;
  /** 被夹住了（合同范围或后面那一件）。 */
  clamped: boolean;
}

/**
 * 把块拉到 `wantSeconds` 秒：取用的源区间不变，速率 = 原速率 × 原长度 / 新长度（设计稿「语速 = 合成时长 / 新时长」，
 * 引擎 `setSpeed` 同一个口径、按有理数精确算）。夹在合同的 0.1–10 之内；`room` 是到同轨下一件起点的长度，变长不能超过它
 * （速率往上取一档，宁可短一点也不盖住——盖住了引擎整笔拒绝）。
 */
export function stretchSpeed(item: AudioItem, wantSeconds: number, room: number | null): Stretch {
  const seconds0 = mediaTimeToSeconds(item.playDuration);
  const speed0 = itemSpeed(item);
  const source = seconds0 * speed0;
  let lo = DUB_SPEED_MIN;
  // 向上取：浮点把「正好贴着」算成多一丁点时多进一档（短一点），不会反过来盖住。
  if (room !== null && room > 0) lo = Math.max(lo, Math.ceil((source / room) * 100) / 100);
  if (lo > DUB_SPEED_MAX) return { rate: rateFromSpeed(speed0), speed: speed0, seconds: seconds0, clamped: true };
  const rounded = Math.round((source / Math.max(1e-3, wantSeconds)) * 100) / 100;
  const speed = Math.min(DUB_SPEED_MAX, Math.max(lo, rounded));
  return { rate: rateFromSpeed(speed), speed, seconds: source / speed, clamped: speed !== rounded };
}

/** 拖完要不要提交：速率真的变了。 */
export function stretchChanged(item: AudioItem, stretch: Stretch): boolean {
  return Math.abs(stretch.speed - itemSpeed(item)) >= 0.005;
}

// ---- 菜单要发的操作 ----

/** 选区里的配音块（按选区次序）；别的实例不管。 */
export function selectedBlocks(selection: readonly Id[], blocks: ReadonlyMap<Id, DubBlock>): DubBlock[] {
  return selection.flatMap((id) => {
    const block = blocks.get(id);
    return block ? [block] : [];
  });
}

/** 这组配音有没有分离出来的背景声（「移除这组配音」连它一起拿掉）。 */
export function hasBackground(sequence: Sequence, groupId: string): boolean {
  return sequence.items.some((item) => {
    const own = item.extensions?.[DUB_EXTENSION];
    return isObject(own) && own.groupId === groupId && own.stem !== undefined;
  });
}

/** 静音或取消静音这几块：只发状态真的要变的那几件。 */
export function muteOperations(sequence: Sequence, itemIds: readonly Id[], muted: boolean): EditOperation[] {
  const wanted = new Set(itemIds);
  return sequence.items
    .filter((item) => wanted.has(item.id) && item.type === 'audio' && !!item.mix.muted !== muted)
    .map((item) => ({ type: 'setAudioMix', sequenceId: sequence.id, itemId: item.id, muted }));
}

/** 这几件里有没有锁着的（实例锁定，或所在的轨道锁定）：引擎拒绝改它们，菜单把对应的项置灰。 */
export function anyLocked(sequence: Sequence, itemIds: readonly Id[]): boolean {
  const lockedTracks = new Set(sequence.tracks.filter((track) => track.locked).map((track) => track.id));
  const wanted = new Set(itemIds);
  return sequence.items.some((item) => wanted.has(item.id) && (item.locked || lockedTracks.has(item.trackId)));
}

/** 这组配音（连同分离出来的背景）里有没有锁着的：「移除这组配音」是一笔事务，有一件锁着整笔就被拒。 */
export function groupLocked(sequence: Sequence, groupId: string): boolean {
  const ids = sequence.items
    .filter((item) => {
      const own = item.extensions?.[DUB_EXTENSION];
      return isObject(own) && own.groupId === groupId;
    })
    .map((item) => item.id);
  return anyLocked(sequence, ids);
}
