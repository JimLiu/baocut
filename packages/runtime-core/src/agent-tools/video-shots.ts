// i18n-ignore-file: 给模型的工具说明与说明文字
import fs from 'node:fs/promises';
import {
  RpcError,
  sequenceDurationFrames,
  type Id,
  type Localized,
  type Rate,
  type VideoPictureShotsResult,
  type VideoShotCut,
  type VideoShotSpeaker,
  type VideoShotsParams,
  type VideoShotsResult,
  type VideoSnapshot,
  type VideoSpeakerShotsResult,
} from '@baocut/protocol';
import { RcAgentTools, RcCommon } from '@baocut/protocol/messages/runtime-core';
import type { FaceDetector } from '../face-detection.ts';
import { timelineWords } from '../ai-tools/timeline-sentences.ts';
import type { VideoService } from '../videos/video-service.ts';
import { imageSize, type MediaAnalysis } from '../media-analysis.ts';
import { ToolError } from './tool-catalog.ts';
import { frameSourceAtFrame, type FrameSource } from './video-frames.ts';
import {
  BURST,
  MIN_USABLE_PROBES,
  cameraFaceCount,
  hasCut,
  mainFaces,
  matchSpeakers,
  medianBoxes,
  mouthMotion,
  pickProbes,
  speakerSegments,
  turnsOf,
  type Box,
  type ProbeMotion,
  type SpeakerWord,
} from './speaker-shots.ts';

/**
 * 镜头切换（`videos_shots` 与 `videos.shots`，架构设计 §3.5「镜头切换」）：剪辑后时间线上一段区间里画面在哪里切换。
 *
 * 1. 按取帧的同一条规则（`frameSourceAtFrame`：最上层、启用、轨道可见的视频片段）把区间切成若干段，每段是一个片段的一截；
 *    相邻两段换了片段、源画面又不接续（不同素材，或同一素材的源时间跳了）的地方是一处 `edit`。
 * 2. 每段线性正速率的源区间交给 ffmpeg 的场景分数（`MediaAnalysis.sceneCuts`），超过阈值的帧按这段的时间映射换回时间线，
 *    对到帧，是 `scene`。静帧、倒放的片段不检测。
 * 3. 短于 `minShot` 的镜头并进前一个（第一个并进后一个）：去掉它前面（第一个时是后面）的那处切换。
 *
 * `by: "speaker"`（docs/design/shorts-framing §2.3、§2.5）不找画面的切换，按说话人切段：区间里画面上占得最多的那个素材是
 * 这一路的原片，它的讲话转写给出说话人；先在整份转写里取样认出每个说话人是哪张脸（`speakerMapping`，按素材内容与转写的修订
 * 缓存在内存里），再把区间里时间线上的词交给 `speakerSegments` 切段。区间里别的素材的画面上没有这份转写的词，按停顿算。
 */

/** 一次最多检测这么长的区间（秒）：要解码整段画面。 */
export const MAX_SHOTS_RANGE_SECONDS = 20 * 60;
export const DEFAULT_SCENE_THRESHOLD = 0.3;
export const DEFAULT_MIN_SHOT = 0.8;

export const SHOTS_NOTE =
  '切换点只看画面突变（ffmpeg 场景分数），不认人：叠化、推拉会漏报，闪光、快速运动可能多报。kind "edit" 是时间线上换了片段、源画面接不上的地方。要核对时用 videos_frames 取切换点前后的帧。';

export const SPEAKER_SHOTS_NOTE =
  '按说话人切段：每段对准一个人（face 是 faces 的下标，speaker 是说话人 ID）或分屏（两项都是 null）。说话人与脸的对应只靠嘴部的动静，speakers 里 face 为 null 的人没认出来，他说话的那几段分屏；confidence 低（1.25–1.5）时用 videos_frames 取几段的 sampleAt 核对。';

export type ShotsErrorCode =
  | 'SHOTS_RANGE_EMPTY'
  | 'SHOTS_RANGE_TOO_LONG'
  | 'SHOTS_NO_SPEAKERS'
  | 'SHOTS_NOT_SINGLE_CAMERA'
  | 'SHOTS_SPEAKERS_UNMATCHED'
  | 'SHOTS_FACES_UNAVAILABLE';

/** 镜头检测的拒绝：调用方按 `code` 换成 RPC 错误或工具错误。 */
export class ShotsError extends Error {
  readonly code: ShotsErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: ShotsErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

/** 跟不了说话人时的下一步（§2.3「跟不了时退回整支分屏」）。 */
const SPEAKER_FALLBACK = '这一段整支分屏（一个分屏段盖住整段，不按说话人切），在提示牌里说原因';

/** 工具面的错误：区间的错误换成 `INVALID_ARGUMENTS`，跟不了说话人的以自己的错误码拒绝，带上 `next`（给模型看的说明）；别的原样抛。 */
export function shotsToolError(error: unknown): unknown {
  if (!(error instanceof ShotsError)) return error;
  const { code, details } = error;
  switch (code) {
    case 'SHOTS_RANGE_TOO_LONG':
      return new ToolError('INVALID_ARGUMENTS', `区间超过 ${MAX_SHOTS_RANGE_SECONDS / 60} 分钟：分成几段分别检测`, { code, ...details });
    case 'SHOTS_RANGE_EMPTY':
      return new ToolError('INVALID_ARGUMENTS', '区间对到帧之后是空的：终点要大于起点，起点要在时间线里', { code, ...details });
    case 'SHOTS_NO_SPEAKERS':
      return new ToolError(code, '这一路原片没有讲话转写，或转写里不到 2 个说话人：没法按说话人切段', {
        ...details,
        next: `${SPEAKER_FALLBACK}；请用户先在 AI 工具里识别说话人，再剪一次`,
      });
    case 'SHOTS_NOT_SINGLE_CAMERA':
      return new ToolError(code, '取样里多数帧不是同样 2–4 张主脸（不是单机位，或检测不到脸），或者能用的取样不到 6 个', {
        ...details,
        next: `原片有近景与全景来回切时按画面的镜头取景（by picture，同取景「自动」）；整段确实只有一个全景机位时${SPEAKER_FALLBACK}`,
      });
    case 'SHOTS_SPEAKERS_UNMATCHED':
      return new ToolError(code, '一个说话人也认不出是画面里的哪张脸（嘴部的动静与谁在说话对不上）', { ...details, next: SPEAKER_FALLBACK });
    case 'SHOTS_FACES_UNAVAILABLE':
      return new ToolError(code, '人脸检测不可用（检测程序或模型缺失、起不来）', { ...details, next: SPEAKER_FALLBACK });
  }
}

export interface ShotsOptions {
  /** 剪辑后时间线上的秒；缺省 0 与时长。 */
  start?: number | undefined;
  end?: number | undefined;
  threshold?: number | undefined;
  minShot?: number | undefined;
  /** `by: "speaker"`：false 时该分屏的段留在前一个人身上；缺省 true。 */
  split?: boolean | undefined;
}

/** 区间里的一段：帧号 `[from, to)` 与画面上的片段（没有片段时 null）。 */
export interface ShotSegment {
  from: number;
  to: number;
  source: FrameSource | null;
}

/** 对到帧之后的区间：起点向下、终点向上取整，截到时长。 */
export function shotsRange(video: VideoSnapshot, options: Pick<ShotsOptions, 'start' | 'end'>): { from: number; to: number; fps: Rate } {
  const sequence = video.sequences[video.rootSequenceId];
  if (!sequence) throw new ShotsError('SHOTS_RANGE_EMPTY');
  const { fps } = sequence;
  const duration = sequenceDurationFrames(sequence);
  const toFrames = (seconds: number) => (seconds * fps.num) / fps.den;
  const from = Math.max(0, Math.floor(toFrames(options.start ?? 0) + 1e-9));
  const to = Math.min(duration, options.end === undefined ? duration : Math.ceil(toFrames(options.end) - 1e-9));
  if (!(to > from)) throw new ShotsError('SHOTS_RANGE_EMPTY', { start: options.start ?? 0, end: options.end ?? null });
  const seconds = ((to - from) * fps.den) / fps.num;
  if (seconds > MAX_SHOTS_RANGE_SECONDS + 1e-9) {
    throw new ShotsError('SHOTS_RANGE_TOO_LONG', { seconds, maxSeconds: MAX_SHOTS_RANGE_SECONDS });
  }
  return { from, to, fps };
}

/**
 * 把帧区间 `[from, to)` 按画面上的片段切段：边界是区间两端与其中各视频片段的起止帧；每个小段在起点问一次最上层的片段，
 * 相邻的同一片段（或都没有片段）合成一段。
 */
export function shotSegments(video: VideoSnapshot, from: number, to: number): ShotSegment[] {
  const sequence = video.sequences[video.rootSequenceId];
  if (!sequence) return [];
  const bounds = new Set([from, to]);
  for (const item of sequence.items) {
    if (item.type !== 'video') continue;
    for (const f of [item.span.fromFrame, item.span.fromFrame + item.span.durationFrames]) if (f > from && f < to) bounds.add(f);
  }
  const sorted = [...bounds].sort((a, b) => a - b);
  const out: ShotSegment[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const source = frameSourceAtFrame(video, sorted[i]!);
    const last = out[out.length - 1];
    if (last && (last.source?.item.id ?? null) === (source?.item.id ?? null)) last.to = sorted[i + 1]!;
    else out.push({ from: sorted[i]!, to: sorted[i + 1]!, source });
  }
  return out;
}

/** 线性正速率的源时钟：片段在帧 `frame` 处的源时间（秒）与速率；静帧、倒放的为 null。 */
function linearAt(source: FrameSource, frame: number, fps: Rate): { at: number; rate: number } | null {
  const map = source.item.timeMap;
  if (map.kind !== 'linear' || map.rate.num <= 0) return null;
  const rate = map.rate.num / map.rate.den;
  const local = ((frame - source.item.span.fromFrame) * fps.den) / fps.num;
  return { at: Number(map.sourceIn.ticks) / map.sourceIn.timescale + local * rate, rate };
}

/** 两段相接处的画面接不接得上：同一素材版本、同一速率，左段末帧之后的源时间与右段首帧相差不到半帧。 */
function continuous(left: ShotSegment, right: ShotSegment, fps: Rate): boolean {
  if (!left.source || !right.source) return false;
  if (left.source.assetId !== right.source.assetId || left.source.revision !== right.source.revision) return false;
  const a = linearAt(left.source, left.to, fps);
  const b = linearAt(right.source, right.from, fps);
  if (!a || !b || Math.abs(a.rate - b.rate) > 1e-9) return false;
  return Math.abs(a.at - b.at) < (0.5 * fps.den * a.rate) / fps.num;
}

/** 帧号写成秒（6 位小数）。 */
function secondsOf(frame: number, fps: Rate): number {
  return Math.round(((frame * fps.den) / fps.num) * 1e6) / 1e6;
}

/** 取帧用的时刻：帧的正中（十进制秒字符串），换回帧号时不会因为小数截断落到前一帧。 */
function sampleText(frame: number, fps: Rate): string {
  const value = ((frame + 0.5) * fps.den) / fps.num;
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

export interface ShotsDeps {
  analysis: MediaAnalysis;
  /** 素材版本的文件（同 `videos_frames` 的取法）。 */
  assetFile: (assetId: Id, revision: string) => Promise<{ root: string; file: string }>;
}

/** 检测镜头切换（见模块说明）。 */
export async function detectShots(deps: ShotsDeps, video: VideoSnapshot, options: ShotsOptions): Promise<Omit<VideoPictureShotsResult, 'videoId'>> {
  const threshold = options.threshold ?? DEFAULT_SCENE_THRESHOLD;
  const minShot = options.minShot ?? DEFAULT_MIN_SHOT;
  const { from, to, fps } = shotsRange(video, options);
  const segments = shotSegments(video, from, to);

  const cuts = new Map<number, { score: number | null; kind: VideoShotCut['kind'] }>();
  for (let i = 1; i < segments.length; i++) {
    if (!continuous(segments[i - 1]!, segments[i]!, fps)) cuts.set(segments[i]!.from, { score: null, kind: 'edit' });
  }
  for (const segment of segments) {
    const source = segment.source;
    const start = source ? linearAt(source, segment.from, fps) : null;
    if (!source || !start) continue;
    const durSec = (((segment.to - segment.from) * fps.den) / fps.num) * start.rate;
    const found = await deps.analysis.sceneCuts(source.asset, { fromSec: start.at, durSec, threshold }, () =>
      deps.assetFile(source.assetId, source.revision),
    );
    for (const cut of found) {
      const frame = segment.from + Math.round((((cut.at - start.at) / start.rate) * fps.num) / fps.den);
      if (frame <= segment.from || frame >= segment.to) continue;
      const existing = cuts.get(frame);
      if (!existing || (existing.kind === 'scene' && (existing.score ?? 0) < cut.score)) cuts.set(frame, { score: cut.score, kind: 'scene' });
    }
  }

  // 短于 minShot 的镜头并进前一个（第一个并进后一个）。
  const frames = [...cuts.keys()].sort((a, b) => a - b);
  const minFrames = (minShot * fps.num) / fps.den;
  for (;;) {
    const edges = [from, ...frames, to];
    const short = edges.findIndex((edge, i) => i + 1 < edges.length && edges[i + 1]! - edge < minFrames - 1e-9);
    if (short < 0 || frames.length === 0) break;
    frames.splice(short === 0 ? 0 : short - 1, 1);
  }

  const edges = [from, ...frames, to];
  return {
    revision: video.revision,
    range: { start: secondsOf(from, fps), end: secondsOf(to, fps) },
    cuts: frames.map((frame) => ({ at: secondsOf(frame, fps), ...cuts.get(frame)! })),
    shots: edges.slice(0, -1).map((start, i) => {
      const end = edges[i + 1]!;
      const at = (p: number) => sampleText(Math.min(end - 1, start + Math.floor((end - start) * p)), fps);
      return { start: secondsOf(start, fps), end: secondsOf(end, fps), sampleAt: [at(0.2), at(0.5), at(0.8)] };
    }),
    threshold,
    minShot,
    detector: 'ffmpeg-scene',
  };
}

/** `by: "speaker"` 另要的几样：人脸检测、视频里的文档与时间线上的词。 */
export interface SpeakerShotsDeps extends ShotsDeps {
  faces?: FaceDetector | undefined;
  /** 一份文档当前版本的正文（讲话转写）。 */
  document: (documentId: Id) => Promise<{ revision: string; body: unknown }>;
  /** 转写在剪辑后时间线 `[start, end)` 里的词（秒；剪掉的不在，同 `timelineWords`）。 */
  words: (documentId: Id, range: { start: number; end: number }) => Promise<SpeakerWord[]>;
}

/** 一份讲话转写：词（素材源时钟上的秒）与说话人。 */
interface Transcript {
  id: Id;
  revision: string;
  words: SpeakerWord[];
  speakers: { id: string; name: string }[];
}

/** 认出来的对应：每张脸的中位框与说话人、每个说话人对上的脸。 */
interface SpeakerMapping {
  faces: { box: Box; speaker: string | null }[];
  speakers: VideoShotSpeaker[];
  confidence: number;
}

/** 讲话转写的正文（`baocut.speech/1`）里切段要的几项；不是转写时 null。 */
function transcriptOf(id: Id, revision: string, body: unknown): Transcript | null {
  const value = body as { timescale?: unknown; words?: unknown; speakers?: unknown } | null;
  if (!value || !Array.isArray(value.words)) return null;
  const scale = typeof value.timescale === 'number' && value.timescale > 0 ? value.timescale : 1_000_000;
  const words: SpeakerWord[] = [];
  for (const raw of value.words as { start?: unknown; end?: unknown; speaker?: unknown }[]) {
    if (typeof raw?.start !== 'number' || typeof raw.end !== 'number' || typeof raw.speaker !== 'string' || !raw.speaker) continue;
    words.push({ start: raw.start / scale, end: raw.end / scale, speaker: raw.speaker });
  }
  const named = new Map<string, string>();
  for (const s of Array.isArray(value.speakers) ? (value.speakers as { id?: unknown; name?: unknown }[]) : []) {
    if (typeof s?.id === 'string') named.set(s.id, typeof s.name === 'string' ? s.name : s.id);
  }
  const ids = [...new Set([...named.keys(), ...words.map((w) => w.speaker!)])].filter((id) => words.some((w) => w.speaker === id));
  return { id, revision, words, speakers: ids.map((sid) => ({ id: sid, name: named.get(sid) ?? sid })) };
}

/** 区间里画面上占得最多的素材版本（这一路的原片）；区间里没有视频画面时 null。 */
function primarySource(segments: readonly ShotSegment[]): FrameSource | null {
  const covered = new Map<string, { source: FrameSource; frames: number }>();
  for (const segment of segments) {
    if (!segment.source) continue;
    const key = `${segment.source.assetId}@${segment.source.revision}`;
    const entry = covered.get(key) ?? { source: segment.source, frames: 0 };
    entry.frames += segment.to - segment.from;
    covered.set(key, entry);
  }
  return [...covered.values()].sort((a, b) => b.frames - a.frames)[0]?.source ?? null;
}

/** 原片的讲话转写里第一份分出 2 个以上说话人的；没有时 `SHOTS_NO_SPEAKERS`。 */
async function transcriptFor(deps: SpeakerShotsDeps, video: VideoSnapshot, assetId: Id): Promise<Transcript> {
  const records = Object.values(video.documents).filter((d) => d.kind === 'speech' && d.sourceAssetId === assetId);
  for (const record of records) {
    const { revision, body } = await deps.document(record.id);
    const transcript = transcriptOf(record.id, revision, body);
    if (transcript && transcript.speakers.length >= 2) return transcript;
  }
  throw new ShotsError('SHOTS_NO_SPEAKERS', { transcripts: records.length });
}

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * 认出每个说话人是哪张脸（§2.5）：在整份转写里取样，每个取样的一帧做人脸检测（一次检测全部），主脸数与多数不同的不用；
 * 余下的从取样时刻起解 1.2 秒灰度画面，有一刀的不用，量每张脸嘴部的动静，交给 `matchSpeakers`。
 */
async function speakerMapping(deps: SpeakerShotsDeps, source: FrameSource, transcript: Transcript): Promise<SpeakerMapping> {
  if (!deps.faces) throw new ShotsError('SHOTS_FACES_UNAVAILABLE');
  const locate = () => deps.assetFile(source.assetId, source.revision);
  const probes = pickProbes(turnsOf(transcript.words));
  const files = await Promise.all(probes.map((p) => deps.analysis.keyframeFile(source.asset, p.at, BURST.edge, locate)));
  const found = files.length ? await deps.faces.detect(files) : { faces: [] };
  if (!found) throw new ShotsError('SHOTS_FACES_UNAVAILABLE');
  const main = found.faces.map((faces) => mainFaces(faces));
  const count = cameraFaceCount(main.map((faces) => faces.length));
  if (count === null) throw new ShotsError('SHOTS_NOT_SINGLE_CAMERA', { probes: probes.length, faceCounts: main.map((faces) => faces.length) });
  const kept = probes.map((probe, i) => ({ probe, file: files[i]!, faces: main[i]! })).filter((p) => p.faces.length === count);
  const dims = imageSize(await fs.readFile(kept[0]!.file))?.dims;
  if (!dims) throw new ShotsError('SHOTS_FACES_UNAVAILABLE');
  const measured = await Promise.all(
    kept.map(async ({ probe, faces }): Promise<(ProbeMotion & { boxes: Box[] }) | null> => {
      const frames = await deps.analysis.grayBurst(
        source.asset,
        { fromSec: probe.at, durSec: BURST.seconds, fps: BURST.fps, width: dims.width, height: dims.height },
        locate,
      );
      const burst = { width: dims.width, height: dims.height, frames };
      if (frames.length < 4 || hasCut(burst)) return null;
      return { speaker: probe.speaker, motion: faces.map((f) => mouthMotion(burst, f)), boxes: faces };
    }),
  );
  const rows = measured.filter((row) => row !== null);
  if (rows.length < MIN_USABLE_PROBES) throw new ShotsError('SHOTS_NOT_SINGLE_CAMERA', { probes: probes.length, usable: rows.length });
  const match = matchSpeakers(rows, count, transcript.speakers.map((s) => s.id));
  if (match.confidence === null) {
    throw new ShotsError('SHOTS_SPEAKERS_UNMATCHED', { speakers: match.speakers.map(({ id, probes: n, contrast }) => ({ id, probes: n, contrast })) });
  }
  const boxes = medianBoxes(
    rows.map((row) => row.boxes),
    count,
  );
  return {
    faces: boxes.map((box, k) => ({
      box: { x: round4(box.x), y: round4(box.y), w: round4(box.w), h: round4(box.h) },
      speaker: match.speakers.find((s) => s.face === k)?.id ?? null,
    })),
    speakers: match.speakers.map((s) => ({ ...s, name: transcript.speakers.find((t) => t.id === s.id)?.name ?? s.id })),
    confidence: match.confidence,
  };
}

/** 认出来的对应按分析实例缓存（工具与网关方法共用）：键是素材内容与转写的修订，至多留这么多份。 */
const MAPPING_CACHE_SIZE = 16;
const mappings = new WeakMap<MediaAnalysis, Map<string, Promise<SpeakerMapping>>>();

function cachedMapping(analysis: MediaAnalysis, key: string, compute: () => Promise<SpeakerMapping>): Promise<SpeakerMapping> {
  let cache = mappings.get(analysis);
  if (!cache) mappings.set(analysis, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const job = compute();
  cache.set(key, job);
  while (cache.size > MAPPING_CACHE_SIZE) cache.delete(cache.keys().next().value!);
  // 认不出、不是单机位是这份素材与转写的结论，留着；检测不可用、解码失败下次再试。
  job.catch((error: unknown) => {
    if ((!(error instanceof ShotsError) || error.code === 'SHOTS_FACES_UNAVAILABLE') && cache.get(key) === job) cache.delete(key);
  });
  return job;
}

/** 按说话人切段（见模块说明）。 */
export async function detectSpeakerShots(
  deps: SpeakerShotsDeps,
  video: VideoSnapshot,
  options: ShotsOptions,
): Promise<Omit<VideoSpeakerShotsResult, 'videoId'>> {
  const { from, to, fps } = shotsRange(video, options);
  const source = primarySource(shotSegments(video, from, to));
  if (!source) throw new ShotsError('SHOTS_NOT_SINGLE_CAMERA', { probes: 0 });
  const transcript = await transcriptFor(deps, video, source.assetId);
  const mapping = await cachedMapping(deps.analysis, `${source.asset.contentHash}|${transcript.id}@${transcript.revision}`, () =>
    speakerMapping(deps, source, transcript),
  );
  const range = { start: secondsOf(from, fps), end: secondsOf(to, fps) };
  const words = await deps.words(transcript.id, range);
  const faceOf = new Map(mapping.speakers.filter((s) => s.face !== null).map((s) => [s.id, s.face!]));
  const distance = (box: Box) => Math.abs(box.x + box.w / 2 - 0.5);
  const centerFace = mapping.faces.reduce((best, f, k) => (distance(f.box) < distance(mapping.faces[best]!.box) ? k : best), 0);
  const segments = speakerSegments(words, { ...range, faces: faceOf, split: options.split ?? true, centerFace });

  // 段的边界对到帧；对到同一帧的段去掉。
  const cuts: { frame: number; face: number | null }[] = [{ frame: from, face: segments[0]!.face }];
  for (const segment of segments.slice(1)) {
    const frame = Math.min(to, Math.max(from, Math.round((segment.start * fps.num) / fps.den)));
    if (frame === cuts[cuts.length - 1]!.frame) cuts[cuts.length - 1]!.face = segment.face;
    else if (frame < to) cuts.push({ frame, face: segment.face });
  }
  return {
    revision: video.revision,
    range,
    shots: cuts.map(({ frame: start, face }, i) => {
      const end = cuts[i + 1]?.frame ?? to;
      const at = (p: number) => sampleText(Math.min(end - 1, start + Math.floor((end - start) * p)), fps);
      return {
        start: secondsOf(start, fps),
        end: secondsOf(end, fps),
        sampleAt: [at(0.2), at(0.5), at(0.8)],
        speaker: face === null ? null : (mapping.faces[face]?.speaker ?? null),
        face,
      };
    }),
    faces: mapping.faces,
    speakers: mapping.speakers,
    confidence: mapping.confidence,
    detector: 'mouth-motion',
  };
}

/** `videos.shots`（网关方法）：与工具 `videos_shots` 同一个实现；视频要已经打开。 */
export async function videoShots(
  deps: { analysis: MediaAnalysis; videos: VideoService; faces?: FaceDetector | undefined },
  params: VideoShotsParams,
): Promise<VideoShotsResult> {
  const video = deps.videos.mirror(params.videoId)?.video;
  if (!video) throw new RpcError('not-found', RcCommon.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
  try {
    if (params.by === 'speaker') {
      const result = await detectSpeakerShots(speakerShotsDeps(deps, params.videoId), video, params);
      return { videoId: params.videoId, ...result };
    }
    const result = await detectShots(
      { analysis: deps.analysis, assetFile: (assetId, revision) => deps.videos.assetFile(params.videoId, assetId, revision) },
      video,
      params,
    );
    return { videoId: params.videoId, ...result };
  } catch (error) {
    if (!(error instanceof ShotsError)) throw error;
    throw new RpcError(error.code === 'SHOTS_RANGE_TOO_LONG' || error.code === 'SHOTS_RANGE_EMPTY' ? 'invalid-request' : 'unsupported', shotsMessage(error.code), {
      code: error.code,
      ...error.details,
    });
  }
}

/** 网关方法的错误说明（给人看的，随界面语言）。 */
function shotsMessage(code: ShotsErrorCode): Localized {
  switch (code) {
    case 'SHOTS_RANGE_TOO_LONG':
      return RcAgentTools.shotsRangeTooLong({ minutes: MAX_SHOTS_RANGE_SECONDS / 60 });
    case 'SHOTS_RANGE_EMPTY':
      return RcAgentTools.shotsRangeEmpty();
    case 'SHOTS_NO_SPEAKERS':
      return RcAgentTools.shotsNoSpeakers();
    case 'SHOTS_NOT_SINGLE_CAMERA':
      return RcAgentTools.shotsNotSingleCamera();
    case 'SHOTS_SPEAKERS_UNMATCHED':
      return RcAgentTools.shotsSpeakersUnmatched();
    case 'SHOTS_FACES_UNAVAILABLE':
      return RcAgentTools.shotsFacesUnavailable();
  }
}

/** 工具与网关方法共用的 `by: "speaker"` 依赖：文档与时间线上的词都从视频服务读。 */
export function speakerShotsDeps(
  deps: { analysis: MediaAnalysis; videos: VideoService; faces?: FaceDetector | undefined },
  videoId: Id,
): SpeakerShotsDeps {
  return {
    analysis: deps.analysis,
    faces: deps.faces,
    assetFile: (assetId, revision) => deps.videos.assetFile(videoId, assetId, revision),
    document: async (documentId) => {
      const content = await deps.videos.document(videoId, documentId);
      return { revision: content.revision, body: content.body };
    },
    words: async (documentId, range) =>
      (await timelineWords(deps.videos, videoId, documentId, range)).map((w) => ({ start: w.start, end: w.end ?? w.start, speaker: w.speaker ?? null })),
  };
}
