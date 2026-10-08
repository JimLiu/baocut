import type { DocumentRecord, Id, JobLiveSegment, JobProgress, JobRecord, Sequence } from '@baocut/protocol';
import { deriveCues, projectableItems, projectSpeech, readSpeechWords, type SpeechWord } from './speech-cues.ts';
import { jobLive } from './task-list.ts';

/*
 * 转录中的实时文稿（原型第 220 轮，model-transcript.js `liveSlice` / `liveTrackSlice`；架构设计 §6.6「实时文稿」）。
 *
 * 实时段落是任务事件流的投影，不是项目内容：只读、不进撤销栈、没有 cue id。三段语义照原型：
 *   · settled：已经收到的段落——照常画；
 *   · inflight：原型在 `at` 落在一条 cue 中间时只露前缀。真实数据没有半段文字，所以没有前缀，只在最后一段末尾挂光标；
 *   · pending：`at` 到素材末尾，还没转录到——时间线画「转录中」待定带。
 * `at` = max(最后一段的终点, 进度换算的秒数)：`seconds` 进度的 `done` 就是秒；`segments`（VAD 切出的片段）按
 * `done / total × 时长` 只当下限。不流式返回的服务（在线、节点、整段模型）到结束前一段也没有：只有待定带与骨架，不造假数据。
 */

const EMPTY: readonly JobLiveSegment[] = Object.freeze([]);

/** 转录到了素材的第几秒（素材自己的时钟）。`done` 时（转写做完、流程还在建字幕层）就是素材末尾。 */
export function liveAt(segments: readonly JobLiveSegment[], progress: JobProgress | null, duration: number | null, done = false): number {
  const limit = duration != null && duration > 0 ? duration : Infinity;
  if (done) return limit === Infinity ? Math.max(0, lastEnd(segments)) : limit;
  let reached = lastEnd(segments);
  if (progress?.unit === 'seconds') reached = Math.max(reached, progress.done);
  else if (progress?.unit === 'segments' && progress.total && limit !== Infinity)
    reached = Math.max(reached, (progress.done / progress.total) * limit);
  return Math.max(0, Math.min(limit, reached));
}

function lastEnd(segments: readonly JobLiveSegment[]): number {
  let end = 0;
  for (const s of segments) if (Number.isFinite(s.end) && s.end > end) end = s.end;
  return end;
}

/** 还没转录到的那一段（素材时钟）；转完了是 null。时长不明时一直延到无穷远，由时间线上的实例区间裁住。 */
export function livePending(at: number, duration: number | null, done = false): { start: number; end: number } | null {
  if (done) return null;
  const end = duration != null && duration > 0 ? duration : Infinity;
  return at < end ? { start: at, end } : null;
}

// ---- 哪一次转录属于哪个素材 ----

/** 视频里一个素材正在进行的转录。 */
export interface LiveTranscription {
  assetId: Id;
  /** 跑识别的转写 Job：实时段落按它的 `jobId` 记，进度也画它的。 */
  step: JobRecord;
  /** 提交它的固定流程（转录、从链接导入）；直接提交的转写没有。 */
  parent: JobRecord | null;
  /** 转写还在跑（排队、执行、自动重跑）。false 时转写已经做完，流程还在往下走（建字幕层）。 */
  running: boolean;
}

/**
 * 这个视频里每个素材正在进行的转录（每个素材一条，重试过时取最新的）。转录流程与从链接导入都把识别交给一个 `transcribe`
 * Job（`submitter` 指回流程父任务），所以从转写 Job 找起，同时认得出编辑器里提交的、智能体与命令行提交的。
 * 转写做完、父任务还在跑（字幕层还没建好）的也算，免得在识别结果与字幕轨之间空出一拍。
 */
export function liveTranscriptions(jobs: readonly JobRecord[], videoId: Id | null): LiveTranscription[] {
  if (!videoId) return [];
  const byAsset = new Map<Id, LiveTranscription>();
  for (const step of jobs) {
    if (step.kind !== 'transcribe' || step.videoId !== videoId || !step.assetId) continue;
    const parent = step.submitter.kind === 'pipeline' ? (jobs.find((j) => j.jobId === step.submitter.id) ?? null) : null;
    const running = jobLive(step);
    if (!running && !(step.state === 'completed' && parent && jobLive(parent))) continue;
    const seen = byAsset.get(step.assetId);
    if (!seen || step.createdAt >= seen.step.createdAt) byAsset.set(step.assetId, { assetId: step.assetId, step, parent, running });
  }
  return [...byAsset.values()];
}

/** 时间线上有没有这个素材的字幕（字幕实例的文档是从这个素材转出来的）。 */
export function assetCaptioned(sequence: Sequence, documents: Record<Id, DocumentRecord>, assetId: Id): boolean {
  return sequence.items.some((item) => {
    if (item.type !== 'caption') return false;
    const record = documents[item.documentId];
    return record?.kind === 'caption' && record.sourceAssetId === assetId;
  });
}

/** 这次转录开始之前，素材已经有转写（是重新转录）。 */
export function transcribedBefore(documents: Record<Id, DocumentRecord>, assetId: Id, since: string): boolean {
  return Object.values(documents).some(
    (record) =>
      record.kind === 'speech' &&
      record.sourceAssetId === assetId &&
      Object.values(record.revisions).some((revision) => revision.createdAt < since),
  );
}

/**
 * 时间线要不要画临时的转录行（v2 的规矩：只有第一次转录才画）。第一次转录时还没有字幕轨——流程最后一步才建——所以这一行
 * 不属于哪条轨，占在字幕行的位置上。转写做完以后，识别结果先落成转写文档、字幕轨稍后才建：这中间照旧画着，直到字幕轨出现
 * 或流程结束（不建字幕层的流程，例如从链接导入默认不建，结束时这一行就收起）。转写做完却一段也没有时不画空行。
 */
export function liveRowShown(facts: { running: boolean; segments: number; captioned: boolean; transcribedBefore: boolean }): boolean {
  if (facts.captioned || facts.transcribedBefore) return false;
  return facts.running || facts.segments > 0;
}

/**
 * 文稿面板要不要切到只读的实时态（原型 panels.jsx：转录在跑就切，重新转录也一样）。转写做完以后等转写文档落进视频再切回来，
 * 免得中间闪一下「还没有文稿」。
 */
export function liveTranscriptShown(facts: { running: boolean; segments: number; documentLanded: boolean }): boolean {
  if (facts.running) return true;
  return facts.segments > 0 && !facts.documentLanded;
}

// ---- 保留段落 ----

/**
 * 转写 Job 结束时客户端丢掉它的实时段落（`applyJobsEvent`），可流程还在建字幕层：这段时间里临时行与文稿要接着画。
 * 这里把刚被丢掉、且 Job 已完成、父任务还在跑的段落留住；父任务结束（或 Job 不在列表里了）就放掉。没有变化时返回原对象。
 */
export function holdSegments(
  previous: Readonly<Record<Id, readonly JobLiveSegment[]>>,
  next: Readonly<Record<Id, readonly JobLiveSegment[]>>,
  held: Readonly<Record<Id, readonly JobLiveSegment[]>>,
  jobs: readonly JobRecord[],
): Record<Id, readonly JobLiveSegment[]> {
  const byId = new Map(jobs.map((job) => [job.jobId, job]));
  const keep = (jobId: Id) => {
    const job = byId.get(jobId);
    if (!job || job.state !== 'completed' || job.submitter.kind !== 'pipeline') return false;
    const parent = byId.get(job.submitter.id);
    return !!parent && jobLive(parent);
  };
  let out: Record<Id, readonly JobLiveSegment[]> | null = null;
  for (const jobId of Object.keys(held)) {
    if (keep(jobId)) continue;
    out ??= { ...held };
    delete out[jobId];
  }
  for (const [jobId, segments] of Object.entries(previous)) {
    if (next[jobId] || !segments.length || !keep(jobId)) continue;
    out ??= { ...held };
    out[jobId] = segments;
  }
  return out ?? (held as Record<Id, readonly JobLiveSegment[]>);
}

// ---- 投到时间线上 ----

/** 投到序列上的一段（秒）。跨剪辑点的段落裁成几块，`key` 各不相同，`index` 是它在全部段落里的序号。 */
export interface PlacedSegment {
  key: string;
  index: number;
  start: number;
  end: number;
  text: string;
}

const placedCache = new WeakMap<readonly JobLiveSegment[], WeakMap<Sequence, Map<Id, readonly PlacedSegment[]>>>();

/**
 * 实时段落在序列上的位置：与生成字幕同一套投影（`projectSpeech`，素材时钟 → 时间线上取用这个素材的实例），裁掉、错开的
 * 实例照样放对。按段落数组（同一个数组就是同一批段落）与序列版本缓存。
 */
export function placeSegments(sequence: Sequence, assetId: Id, segments: readonly JobLiveSegment[]): readonly PlacedSegment[] {
  if (!segments.length) return EMPTY as readonly never[];
  let bySequence = placedCache.get(segments);
  if (!bySequence) placedCache.set(segments, (bySequence = new WeakMap()));
  let byAsset = bySequence.get(sequence);
  if (!byAsset) bySequence.set(sequence, (byAsset = new Map()));
  let placed = byAsset.get(assetId);
  if (!placed) {
    const words: SpeechWord[] = segments.map((s, index) => ({
      id: String(index),
      start: s.start,
      end: s.end,
      text: s.text,
      paragraphStart: false,
    }));
    placed = projectSpeech(sequence, assetId, words).map((w) => ({
      key: w.key,
      index: Number(w.id),
      start: w.start,
      end: w.end,
      text: w.text,
    }));
    byAsset.set(assetId, placed);
  }
  return placed;
}

/** 待定带在序列上的几块（素材剪成几段放在时间线上时，每段一块）。 */
export function placePending(
  sequence: Sequence,
  assetId: Id,
  pending: { start: number; end: number } | null,
): Array<{ start: number; end: number }> {
  if (!pending) return [];
  const end = Number.isFinite(pending.end) ? pending.end : Number.MAX_SAFE_INTEGER;
  return projectSpeech(sequence, assetId, [{ id: 'pending', start: pending.start, end, text: '', paragraphStart: false }]).map((w) => ({
    start: w.start,
    end: w.end,
  }));
}

// ---- 只读的文稿行 ----

/** 只读文稿行的一行：素材与它最新的那份转写。 */
export interface TranscriptRowSource {
  assetId: Id;
  speech: DocumentRecord;
}

/**
 * 时间线上只读的「文稿」行（原型 model-timeline.js `rows` 的 `transcript`；产品设计 §5.7）：视频转录过、却一条字幕轨都没有
 * （转录时没建字幕层，例如从链接导入默认不建；或字幕轨都删了）——文稿照样落在字幕行的位置上，看得见哪里在说话。
 * 每个转录过、时间线上取用了的素材一行（最新那份转写），按在时间线上第一次出现的先后排；正画着临时转录行的素材不重复画。
 * 它不是轨：没有开关、不进导出、不可选中。
 */
export function transcriptRows(
  sequence: Sequence,
  documents: Record<Id, DocumentRecord>,
  liveAssets: ReadonlySet<Id>,
): TranscriptRowSource[] {
  if (sequence.tracks.some((track) => track.kind === 'subtitle')) return [];
  const created = (record: DocumentRecord) => record.revisions[record.currentRevision]?.createdAt ?? '';
  const latest = new Map<Id, DocumentRecord>();
  for (const record of Object.values(documents)) {
    if (record.kind !== 'speech' || !record.sourceAssetId || liveAssets.has(record.sourceAssetId)) continue;
    const seen = latest.get(record.sourceAssetId);
    if (!seen || created(record) >= created(seen)) latest.set(record.sourceAssetId, record);
  }
  return [...latest]
    .map(([assetId, speech]) => ({ assetId, speech, first: Math.min(...projectableItems(sequence, assetId).map(startFrame)) }))
    .filter(({ first }) => Number.isFinite(first))
    .sort((a, b) => a.first - b.first || (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0))
    .map(({ assetId, speech }) => ({ assetId, speech }));
}

const startFrame = (item: Sequence['items'][number]) => ('span' in item ? item.span.fromFrame : item.fromFrame);

/**
 * 文稿行里的句子块：转写正文（`baocut.speech/1`）按字幕同一套断句（`deriveCues`）切成句，经取用这个素材的实例投到序列上，
 * 剪掉的部分不出现、跨剪辑点的句子裁成几块。正文还没取到或不是转写时没有块。
 */
export function placeTranscript(sequence: Sequence, assetId: Id, body: unknown): readonly PlacedSegment[] {
  const speech = readSpeechWords(body);
  if (!speech?.words.length) return EMPTY as readonly never[];
  const cues = deriveCues(speech.words);
  const words: SpeechWord[] = cues.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end, text: cue.text, paragraphStart: false }));
  const index = new Map(cues.map((cue, n) => [cue.id, n]));
  return projectSpeech(sequence, assetId, words).map((w) => ({ key: w.key, index: index.get(w.id) ?? 0, start: w.start, end: w.end, text: w.text }));
}
