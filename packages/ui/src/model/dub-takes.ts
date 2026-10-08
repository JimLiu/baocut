import type {
  AssetRecord,
  AudioItem,
  DocumentRecord,
  DubOriginalAudio,
  DubPlanTake,
  EditOperation,
  Id,
  JobRecord,
  Sequence,
  SequenceItem,
} from '@baocut/protocol';
import { DUB_EXTENSION, mutedItemsOf } from './dub-undo.ts';
import { isDubJob } from './dub-progress.ts';
import { jobLive } from './task-list.ts';
import { textHash, type TranslationBody } from './translation-doc.ts';
import { dubMark, type DubBlock } from './timeline-dub.ts';

/**
 * 句级重配（设计稿 model-dub.js「块级管理」与「版」，timeline-dub.jsx 的行头与块菜单）：每句配音的多个版本、哪几句在重配、
 * 哪几句要重新生成、切换版本与切换音源要发的操作。不碰 React。
 *
 * 数据从哪来：
 * - 配音计划单元的 `extensions['baocut.dub']`：`take`（当前版本）、`seed`、`takes[]`（`DubPlanTake`）；旧计划没有版本时
 *   已经放上的那一版在视图上补成第 1 版（不改计划，与 Runtime 重配时补记的口径相同）；
 * - 在跑的配音流程冻结的 `pipeline.params.regroup`（`FrozenDubRegroup`）：哪一组的哪几句在重配；
 * - 计划单元的 `status`：`failed`（音色不可用）与 `needs-fit`（放不下）且时间线上没有这一句的，是「没合成」的句。
 */

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// ---- 版本 ----

export interface UnitTakes {
  /** 译文单元（实例上的 `unitId`）。 */
  unitId: Id;
  /** 计划里的单元 ID（`d-<unitId>`）。 */
  planUnitId: Id;
  status: string | null;
  /** 当前版本；没有版本时 null。 */
  take: number | null;
  seed: number | null;
  /** 按版号升序。 */
  takes: DubPlanTake[];
  /** 放不下时超出的秒数（`needs-fit`）。 */
  overflowSeconds: number | null;
  /** 音色不可用没有合成（`failed`）。 */
  voiceUnavailable: boolean;
  /** 原句不在时间线上（`draft`）。 */
  offTimeline: boolean;
}

function readTake(raw: unknown): DubPlanTake | null {
  if (!isObject(raw)) return null;
  const k = num(raw.k);
  if (k === null || k < 1) return null;
  const ref =
    isObject(raw.assetRef) && str(raw.assetRef.id) && str(raw.assetRef.revision)
      ? { id: raw.assetRef.id as Id, revision: raw.assetRef.revision as string }
      : undefined;
  const fit = raw.fit === 'fit' || raw.fit === 'tempo' || raw.fit === 'extended' ? raw.fit : null;
  const over = num(raw.overflowSeconds);
  return {
    k,
    seed: num(raw.seed),
    artifactId: str(raw.artifactId),
    ...(ref ? { assetRef: ref } : {}),
    samples: num(raw.samples),
    sampleRate: num(raw.sampleRate),
    fit,
    tempo: num(raw.tempo),
    ...(over !== null ? { overflowSeconds: over } : {}),
    text: typeof raw.text === 'string' ? raw.text : null,
    jobId: str(raw.jobId),
    at: str(raw.at),
  };
}

/** 计划单元的译文单元 ID（`translationUnitId`，旧的退回 `d-<unitId>`）。 */
function unitIdOf(raw: Json): Id | null {
  const own = isObject(raw.extensions) ? raw.extensions[DUB_EXTENSION] : undefined;
  const id = str(raw.id);
  return (isObject(own) ? str(own.translationUnitId) : null) ?? (id?.startsWith('d-') ? id.slice(2) : null);
}

/** 一个计划单元的版本。旧计划（没有 `takes`）里已经放上的那一版补成第 1 版。 */
export function unitTakes(raw: unknown): UnitTakes | null {
  if (!isObject(raw)) return null;
  const unitId = unitIdOf(raw);
  const planUnitId = str(raw.id);
  if (!unitId || !planUnitId) return null;
  const own = isObject(raw.extensions) && isObject(raw.extensions[DUB_EXTENSION]) ? (raw.extensions[DUB_EXTENSION] as Json) : {};
  let takes: DubPlanTake[];
  let take = num(own.take);
  if (Array.isArray(own.takes)) {
    takes = own.takes.flatMap((t) => readTake(t) ?? []).sort((a, b) => a.k - b.k);
  } else if (str(own.artifactId)) {
    const samples = typeof raw.actualSamples === 'string' ? Number(raw.actualSamples) : null;
    const fit = own.fit === 'fit' || own.fit === 'tempo' || own.fit === 'extended' ? own.fit : null;
    takes = [
      {
        k: 1,
        seed: num(own.seed),
        artifactId: str(own.artifactId),
        samples: samples !== null && Number.isFinite(samples) ? samples : null,
        sampleRate: num(raw.sampleRate),
        fit,
        tempo: num(own.tempo),
        text: isObject(raw.script) && typeof raw.script.text === 'string' ? raw.script.text : null,
        jobId: null,
        at: null,
      },
    ];
    take = 1;
  } else {
    takes = [];
  }
  if (takes.length > 0 && (take === null || !takes.some((t) => t.k === take))) take = takes[takes.length - 1]!.k;
  if (takes.length === 0) take = null;
  return {
    unitId,
    planUnitId,
    status: str(raw.status),
    take,
    seed: take !== null ? (takes.find((t) => t.k === take)?.seed ?? null) : null,
    takes,
    overflowSeconds: num(own.overflowSeconds),
    voiceUnavailable: own.voiceUnavailable !== undefined,
    offTimeline: own.offTimeline === true,
  };
}

/** 计划里每句的版本，按计划的次序。 */
export function planTakes(body: unknown): Map<Id, UnitTakes> {
  const out = new Map<Id, UnitTakes>();
  if (!isObject(body) || !Array.isArray(body.units)) return out;
  for (const raw of body.units) {
    const unit = unitTakes(raw);
    if (unit && !out.has(unit.unitId)) out.set(unit.unitId, unit);
  }
  return out;
}

export function activeTake(unit: Pick<UnitTakes, 'take' | 'takes'> | null | undefined): DubPlanTake | null {
  if (!unit || unit.take === null) return null;
  return unit.takes.find((t) => t.k === unit.take) ?? null;
}

/** 当前版本以外的版本（归档）。 */
export function archivedTakes(unit: Pick<UnitTakes, 'take' | 'takes'> | null | undefined): DubPlanTake[] {
  if (!unit) return [];
  return unit.takes.filter((t) => t.k !== unit.take);
}

/** 这一版放上时间线的长度（秒）；没放上（放不下）时 null。 */
export function takeSeconds(take: Pick<DubPlanTake, 'samples' | 'sampleRate'>): number | null {
  return take.samples !== null && take.sampleRate !== null && take.sampleRate > 0 ? take.samples / take.sampleRate : null;
}

/** 块提示里的版本：只有一版时不写；种子没有时不写种子。 */
export function versionTip(unit: Pick<UnitTakes, 'take' | 'takes'> | null | undefined): { k: number; seed: number | null } | null {
  if (!unit || unit.takes.length <= 1) return null;
  const take = activeTake(unit);
  return take ? { k: take.k, seed: take.seed } : null;
}

// ---- 哪几句在重配 ----

export interface RegroupJob {
  jobId: Id;
  groupId: string;
  units: Id[];
  seed: number | null;
}

/** 这个视频在跑的句级重配（冻结参数里有 `regroup`）。 */
export function regroupJobs(jobs: readonly JobRecord[], videoId: Id | null): RegroupJob[] {
  const out: RegroupJob[] = [];
  for (const job of jobs) {
    if (!isDubJob(job, videoId) || !jobLive(job)) continue;
    const regroup = job.pipeline?.params.regroup;
    if (!isObject(regroup) || !str(regroup.groupId) || !Array.isArray(regroup.units)) continue;
    out.push({
      jobId: job.jobId,
      groupId: regroup.groupId as string,
      units: regroup.units.filter((u): u is Id => typeof u === 'string' && u !== ''),
      seed: num(regroup.seed),
    });
  }
  return out;
}

/** 一句在不在重配的键。 */
export const queuedId = (groupId: string, unitId: Id) => `${groupId}\t${unitId}`;

/** 在重配的句子，排好序拼成一个串：任务进度事件很多，界面用它当选择器的值，句子没变时不重画时间线。 */
export function queuedKey(jobs: readonly JobRecord[], videoId: Id | null): string {
  const ids = new Set<string>();
  for (const job of regroupJobs(jobs, videoId)) for (const unitId of job.units) ids.add(queuedId(job.groupId, unitId));
  return [...ids].sort().join('\n');
}

export function queuedSet(key: string): ReadonlySet<string> {
  return new Set(key ? key.split('\n') : []);
}

/**
 * 时间线的配音块叠上「在重配」与当前版本（块本身在 model/timeline-dub.ts 算；这两样来自任务与计划的版本）。
 * 没有变化的块原样返回，不新建对象。
 */
export function withRegen(blocks: ReadonlyMap<Id, DubBlock>, plans: ReadonlyMap<string, unknown>, queued: ReadonlySet<string>): ReadonlyMap<Id, DubBlock> {
  const byGroup = new Map<string, Map<Id, UnitTakes>>();
  const out = new Map<Id, DubBlock>();
  for (const [id, block] of blocks) {
    if (!block.unitId) {
      out.set(id, block);
      continue;
    }
    let takes = byGroup.get(block.groupId);
    if (!takes) {
      takes = planTakes(plans.get(block.groupId));
      byGroup.set(block.groupId, takes);
    }
    const version = versionTip(takes.get(block.unitId));
    const inQueue = queued.has(queuedId(block.groupId, block.unitId));
    out.set(id, version || inQueue ? { ...block, queued: inQueue, version } : block);
  }
  return out;
}

// ---- 要重新生成的句 ----

export interface FailedUnit {
  unitId: Id;
  /** `voice`：音色不可用没有合成；`overlong`：合成了但放不下。 */
  reason: 'voice' | 'overlong';
  overflowSeconds: number | null;
}

/** 这一组在时间线上的句子（实例上的 `unitId`）。 */
export function placedUnits(sequence: Sequence, groupId: string): Set<Id> {
  const out = new Set<Id>();
  for (const item of sequence.items) {
    const mark = dubMark(item);
    if (mark?.groupId === groupId && mark.unitId) out.add(mark.unitId);
  }
  return out;
}

/** 没合成出来的句：计划里 `failed`（音色不可用）或 `needs-fit`（放不下），而且时间线上没有这一句。按计划的次序。 */
export function failedUnits(planBody: unknown, placed: ReadonlySet<Id>): FailedUnit[] {
  const out: FailedUnit[] = [];
  for (const unit of planTakes(planBody).values()) {
    if (placed.has(unit.unitId)) continue;
    if (unit.status === 'failed') out.push({ unitId: unit.unitId, reason: 'voice', overflowSeconds: null });
    else if (unit.status === 'needs-fit') out.push({ unitId: unit.unitId, reason: 'overlong', overflowSeconds: unit.overflowSeconds });
  }
  return out;
}

/** 计划里每句的序号（从 1 起；计划的单元按句子的次序）：没有译文可对时，改译文并重配的对话框靠它写第几句。 */
export function planUnitOrder(planBody: unknown): Map<Id, number> {
  const out = new Map<Id, number>();
  if (!isObject(planBody) || !Array.isArray(planBody.units)) return out;
  planBody.units.forEach((raw, i) => {
    const unitId = isObject(raw) ? unitIdOf(raw) : null;
    if (unitId && !out.has(unitId)) out.set(unitId, i + 1);
  });
  return out;
}

/** 要重新生成的候选：没合成的 + 过快的块（设计稿 `regenCandidates`）。不重复，没合成的在前；正在重配的不算。 */
export function regenCandidates(
  failed: readonly FailedUnit[],
  blocks: Iterable<Pick<DubBlock, 'groupId' | 'unitId' | 'fast'>>,
  groupId: string,
  queued: ReadonlySet<string> = new Set(),
): Id[] {
  const out = new Set<Id>(failed.map((f) => f.unitId));
  for (const block of blocks) if (block.groupId === groupId && block.fast && block.unitId) out.add(block.unitId);
  return [...out].filter((unitId) => !queued.has(queuedId(groupId, unitId)));
}

export interface TrackCounts {
  /** 时间线上的句 + 没合成的句。 */
  total: number;
  fast: number;
  muted: number;
  failed: number;
  queued: number;
}

/** 一条配音轨的计数（设计稿 `blockCounts`）：排队重配的块照旧按现在这一版算过快（重配好之前放的还是它）。 */
export function trackCounts(
  blocks: Iterable<Pick<DubBlock, 'fast' | 'muted' | 'groupId' | 'unitId'>>,
  failed: readonly FailedUnit[],
  queued: ReadonlySet<string>,
): TrackCounts {
  const counts = { total: failed.length, fast: 0, muted: 0, failed: failed.length, queued: 0 };
  for (const block of blocks) {
    counts.total++;
    const inQueue = !!block.unitId && queued.has(queuedId(block.groupId, block.unitId));
    if (inQueue) counts.queued++;
    if (block.fast) counts.fast++;
    if (block.muted) counts.muted++;
  }
  return counts;
}

// ---- 切换版本 ----

/** 按产物找这一版的素材（引擎不回收素材；导入时素材来源记着 `artifactId`）。 */
export function assetOfArtifact(assets: Record<Id, AssetRecord>, artifactId: string | null): { id: Id; revision: string } | null {
  if (!artifactId) return null;
  for (const asset of Object.values(assets)) {
    for (const [revision, value] of Object.entries(asset.revisions)) {
      const source = value?.provenance.source;
      if (isObject(source) && source.artifactId === artifactId) return { id: asset.id, revision };
    }
  }
  return null;
}

/** 这一版能不能放回时间线：放上过（有长度）、素材找得到。 */
export function takeRef(take: DubPlanTake, assets: Record<Id, AssetRecord>): { id: Id; revision: string } | null {
  if (takeSeconds(take) === null) return null;
  return take.assetRef ?? assetOfArtifact(assets, take.artifactId);
}

export interface SwitchTakeInput {
  sequence: Sequence;
  /** 这一句现在的实例（位置、音量、名字照它）。 */
  item: AudioItem;
  record: Pick<DocumentRecord, 'id' | 'revisions' | 'currentRevision'>;
  body: unknown;
  unitId: Id;
  k: number;
  assets: Record<Id, AssetRecord>;
}

/**
 * 切到第 k 版（一笔可撤销的编辑）：删掉这一句在这一组里的实例、用那一版的素材放回原处（起点、音量、静音、名字照现在的，
 * 速率回到 1）、写配音计划的新版本（`take` 改成 k，被换下的那一版补记素材，之后能切回）。已经是当前版本、那一版没放上过
 * 或找不到素材时 null（界面置灰）。
 */
export function switchTakeOperations(input: SwitchTakeInput): EditOperation[] | null {
  const { sequence, item, record, unitId, k, assets } = input;
  const mark = dubMark(item);
  if (!mark || mark.unitId !== unitId || !isObject(input.body) || !Array.isArray(input.body.units)) return null;
  const body = structuredClone(input.body) as Json & { units: unknown[] };
  const index = body.units.findIndex((raw) => isObject(raw) && unitIdOf(raw) === unitId);
  const raw = body.units[index] as Json | undefined;
  const view = unitTakes(raw);
  if (!raw || !view || view.take === k) return null;
  const target = view.takes.find((t) => t.k === k);
  const ref = target ? takeRef(target, assets) : null;
  if (!target || !ref) return null;
  const takes = view.takes.map((t) => ({ ...t }));
  const current = takes.find((t) => t.k === view.take);
  if (current && !current.assetRef) current.assetRef = { id: item.assetRef.id, revision: item.assetRef.revision };
  const chosen = takes.find((t) => t.k === k)!;
  chosen.assetRef = ref;
  const own = { ...(isObject(raw.extensions) && isObject(raw.extensions[DUB_EXTENSION]) ? (raw.extensions[DUB_EXTENSION] as Json) : {}) };
  own.takes = takes;
  own.take = k;
  if (target.seed !== null) own.seed = target.seed;
  else delete own.seed;
  if (target.fit !== null) own.fit = target.fit;
  if (target.tempo !== null) own.tempo = target.tempo;
  if (target.artifactId !== null) own.artifactId = target.artifactId;
  delete own.overflowSeconds;
  delete own.offTimeline;
  delete own.voiceUnavailable;
  raw.extensions = { ...(isObject(raw.extensions) ? raw.extensions : {}), [DUB_EXTENSION]: own };
  raw.status = 'ready';
  raw.actualSamples = String(target.samples);
  raw.sampleRate = target.sampleRate;
  if (target.text !== null) raw.script = { ...(isObject(raw.script) ? raw.script : {}), text: target.text };

  const olds = sequence.items.filter((other) => {
    const m = dubMark(other);
    return m?.groupId === mark.groupId && m.unitId === unitId;
  });
  const previous = record.revisions[record.currentRevision]?.summary;
  return [
    { type: 'deleteItems', sequenceId: sequence.id, itemIds: olds.map((o) => o.id) },
    {
      type: 'insertItems',
      sequenceId: sequence.id,
      items: [
        {
          type: 'audio',
          trackId: item.trackId,
          assetRef: ref,
          fromFrame: item.fromFrame,
          subframeOffset: item.subframeOffset,
          playDuration: { ticks: String(target.samples), timescale: target.sampleRate! },
          timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
          mix: { volume: item.mix.volume, ...(item.mix.muted ? { muted: true } : {}) },
          ...(item.name !== undefined ? { name: item.name } : {}),
          role: item.role ?? 'dub',
          extensions: {
            ...(item.extensions ?? {}),
            [DUB_EXTENSION]: { groupId: mark.groupId, language: mark.language, unitId, take: k, ...(target.seed !== null ? { seed: target.seed } : {}) },
          },
        },
      ],
    },
    {
      type: 'putDocument',
      documentId: record.id,
      kind: 'dubbing-plan',
      body,
      summary: { ...(isObject(previous) ? previous : {}), groupId: mark.groupId },
    },
  ];
}

// ---- 听配音 / 听原声 / 两者都听 ----

export type DubSource = 'dub' | 'original' | 'both' | 'none';

/** 一组配音的音源相关部分：配音块、它自己分离出的背景声与人声、原声的处理与记下的原声实例。 */
export interface SourceGroup {
  groupId: string;
  policy: DubOriginalAudio | null;
  /** 这组配音静音的原声实例（`mute` 时，或分离过的 `duck` 换成两轨的实例；计划里记着）。 */
  mutedItemIds: Id[];
}

/** 从配音计划正文读原声的处理。 */
export function sourceGroup(groupId: string, planBody: unknown): SourceGroup {
  const policy = isObject(planBody) ? planBody.originalDialoguePolicy : undefined;
  return {
    groupId,
    policy: policy === 'duck' || policy === 'mute' || policy === 'keep' ? policy : null,
    mutedItemIds: mutedItemsOf(planBody),
  };
}

function stemOf(item: SequenceItem): string | null {
  const own = item.extensions?.[DUB_EXTENSION];
  return isObject(own) && own.stem !== undefined ? str(own.groupId) : null;
}

/** 这组的配音块与分离出的两轨（背景声、人声）。 */
function groupItems(sequence: Sequence, groupId: string) {
  const dubs: SequenceItem[] = [];
  const beds: SequenceItem[] = [];
  for (const item of sequence.items) {
    if (dubMark(item)?.groupId === groupId) dubs.push(item);
    else if (stemOf(item) === groupId) beds.push(item);
  }
  return { dubs, beds };
}

const itemSilent = (item: SequenceItem) => (item.type === 'audio' ? item.mix.muted === true : item.type === 'video' ? !item.embeddedAudio.enabled : true);

/** 一批实例有没有出声的（实例没静音、所在轨道没静音）。 */
function audible(sequence: Sequence, items: readonly SequenceItem[]): boolean {
  const muted = new Set(sequence.tracks.filter((t) => t.muted).map((t) => t.id));
  return items.some((item) => !itemSilent(item) && !muted.has(item.trackId));
}

/** 以这组配音轨为触发的闪避规则。 */
function duckRules(sequence: Sequence, items: readonly SequenceItem[]) {
  const tracks = new Set(items.map((i) => i.trackId));
  return (sequence.ducking ?? []).filter((rule) => rule.trigger.kind === 'items' && rule.trigger.trackIds?.some((id) => tracks.has(id)));
}

/** 这一组现在在听什么（设计稿 model-tts.js `sourceOf`）。 */
export function sourceOf(sequence: Sequence, group: SourceGroup): DubSource {
  const { dubs } = groupItems(sequence, group.groupId);
  const dub = audible(sequence, dubs);
  const byId = new Map(sequence.items.map((i) => [i.id, i]));
  const rules = duckRules(sequence, dubs);
  let orig: boolean;
  // 静音过的原声实例（`mute`，或分离过的 `duck`：原声实例换成了背景声与人声两轨）看它们自己。
  if (group.policy === 'mute' || group.mutedItemIds.length > 0) {
    const originals = group.mutedItemIds.flatMap((id) => byId.get(id) ?? []);
    orig = originals.length === 0 || audible(sequence, originals);
  } else if (group.policy === 'duck') {
    const targets = rules.flatMap((r) => r.target.itemIds ?? []).flatMap((id) => byId.get(id) ?? []);
    orig = targets.length === 0 || audible(sequence, targets);
  } else {
    orig = true;
  }
  const ducked = group.policy === 'duck' && rules.some((r) => r.enabled);
  if (dub && (!orig || ducked)) return 'dub';
  if (orig && !dub) return 'original';
  return orig && dub ? 'both' : 'none';
}

/** 「听配音」能不能做：`keep` 的组没有记下原声是哪几段，听配音与两者都听是一回事。 */
export function canListenDub(group: SourceGroup): boolean {
  return group.policy === 'mute' || group.policy === 'duck';
}

/**
 * 把一批实例开或关：整条轨道只放这批实例时改轨道的静音（不碰各块自己的静音），否则逐件改实例的静音。
 * 只发状态真的要变的。
 */
function sideOperations(sequence: Sequence, items: readonly SequenceItem[], on: boolean): EditOperation[] {
  const ops: EditOperation[] = [];
  const ids = new Set(items.map((i) => i.id));
  const trackIds = [...new Set(items.map((i) => i.trackId))];
  for (const trackId of trackIds) {
    const track = sequence.tracks.find((t) => t.id === trackId);
    if (!track) continue;
    const own = sequence.items.filter((i) => i.trackId === trackId);
    if (own.every((i) => ids.has(i.id))) {
      if (track.muted === on) ops.push({ type: 'updateTrack', sequenceId: sequence.id, trackId, muted: !on });
      continue;
    }
    for (const item of own) {
      if (!ids.has(item.id) || item.type !== 'audio') continue;
      if (!!item.mix.muted === on) ops.push({ type: 'setAudioMix', sequenceId: sequence.id, itemId: item.id, muted: !on });
    }
    if (on && track.muted) ops.push({ type: 'updateTrack', sequenceId: sequence.id, trackId, muted: false });
  }
  return ops;
}

/**
 * 切换音源（设计稿 model-tts.js `switchSource`）：
 * - 听配音：这组的配音与分轨（背景声、人声）开，别的语言的配音与分轨关；静音记下的原声（`mute` 的原句实例，分离过的 `duck`
 *   换成两轨的实例），`duck` 时打开闪避；
 * - 听原声：所有配音与分轨关，原声恢复（各组静音过的原声取消静音，闪避关掉）；
 * - 两者都听：这组的配音开、别的关，分轨都关（原声本来就带背景与人声），原声恢复、闪避关掉。
 * `keep` 的组原声不动。`groups` 是序列上全部的配音组（含 `target` 那一组）。
 */
export function switchSourceOperations(
  sequence: Sequence,
  groups: readonly SourceGroup[],
  groupId: string,
  target: Exclude<DubSource, 'none'>,
): EditOperation[] {
  const ops: EditOperation[] = [];
  const self = groups.find((g) => g.groupId === groupId);
  if (!self) return ops;
  for (const group of groups) {
    const { dubs, beds } = groupItems(sequence, group.groupId);
    const mine = group.groupId === groupId;
    ops.push(...sideOperations(sequence, dubs, mine && target !== 'original'));
    ops.push(...sideOperations(sequence, beds, mine && target === 'dub'));
  }
  // 原声：只有「听配音」时静音这组记下的那几段（`mute` 的原句实例，或分离过的 `duck` 换成两轨的实例）；别的情况各组静音过的都恢复。
  const muteNow = new Set(target === 'dub' ? self.mutedItemIds : []);
  const touched = new Set<Id>();
  for (const group of groups) for (const id of group.mutedItemIds) touched.add(id);
  for (const id of muteNow) touched.add(id);
  for (const item of sequence.items) {
    if (!touched.has(item.id) || (item.type !== 'audio' && item.type !== 'video')) continue;
    const want = muteNow.has(item.id);
    if (itemSilent(item) !== want) ops.push({ type: 'setAudioMix', sequenceId: sequence.id, itemId: item.id, muted: want });
  }
  // 闪避：这组 `duck` 时听配音打开、别的关；别的组的闪避不动（它们的配音已经关了）。
  if (self.policy === 'duck') {
    const { dubs } = groupItems(sequence, groupId);
    for (const rule of duckRules(sequence, dubs)) {
      const want = target === 'dub';
      if (rule.enabled !== want) ops.push({ type: 'setDucking', sequenceId: sequence.id, ruleId: rule.id, enabled: want });
    }
  }
  return ops;
}

// ---- 改译文并重配 ----

/**
 * 改几句译文（「改译文并重配」的第一步）：合成念的是译文的 `naturalText`，所以改的是它（有字幕显示改写的单元，改写不动、
 * 字幕照旧），改过的单元记为 `reviewed`、`textHash` 跟着换。文字没变或是空的不改。没有改动时 null。
 */
export async function retextTranslation(body: TranslationBody, texts: ReadonlyMap<Id, string>): Promise<{ body: TranslationBody; changed: Id[] } | null> {
  const changed: Id[] = [];
  const units = await Promise.all(
    body.units.map(async (unit) => {
      const wanted = texts.get(unit.id);
      const value = wanted?.trim() ?? '';
      if (value === '' || value === unit.naturalText.trim()) return unit;
      changed.push(unit.id);
      const alignment = unit.alignment && !unit.displayRewrite ? { ...unit.alignment, textHash: await textHash(value) } : unit.alignment;
      return { ...unit, naturalText: value, alignment, status: 'reviewed' as const };
    }),
  );
  return changed.length > 0 ? { body: { ...body, units }, changed } : null;
}
