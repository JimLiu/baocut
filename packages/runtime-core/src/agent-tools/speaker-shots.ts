import type { DetectedFace } from '../face-detection.ts';

/**
 * 跟着说话人切段（`videos_shots` 的 `by: "speaker"`，docs/design/shorts-framing §2.3、§2.5）里不碰文件的那几步：把转写的词
 * 连成一段段话、在整份转写里挑取样、量每张脸嘴部的动静、认出每个说话人是哪张脸，再按 §2.3 的五条规则把区间切成对准一个人或
 * 分屏的段。取帧、解码、人脸检测与缓存在 `video-shots.ts`。时间都是秒：取样用素材源时钟，切段用剪辑后时间线。
 */

/** 同一人前后两个词相隔不到这么久（秒）连成一段话。 */
export const TURN_GAP = 0.6;
/** 两段话之间的停顿超过这么久（秒）自成一段，分屏；不超过时并进前一段话。 */
export const PAUSE_SPLIT = 1.5;
/** 连着几段话都短于这么久（秒）、又换了人：两人抢着说，分屏。 */
export const CROSSTALK_TURN = 2;
/** 短于这么久（秒）的插话不换人。 */
export const INTERJECTION = 1.5;
/** 每段至少这么长（秒）。 */
export const MIN_SEGMENT = 3;
/** 取样只在连续说了这么久（秒）以上的话里取，取在这段话的这几处。 */
export const PROBE_TURN = 4;
export const PROBE_AT = [0.3, 0.6] as const;
/** 整份转写里至多挑这么多个取样。 */
export const MAX_PROBES = 48;
/** 每个取样从取样时刻起解这么长的灰度画面：每秒帧数、时长（秒）、长边像素。 */
export const BURST = { fps: 12, seconds: 1.2, edge: 640 } as const;
/** 相邻两帧整幅的平均像素差超过它，算这 1.2 秒里有一刀。 */
export const CUT_DIFF = 25;
/** 脸框面积（按帧归一化）小于它的是误检。 */
export const MIN_FACE_AREA = 0.001;
/** 能用的取样不到这么多个、或同样几张主脸的取样不到这个比例，不是单机位。 */
export const MIN_USABLE_PROBES = 6;
export const SAME_FACES_SHARE = 0.7;
/** 取样不到这么多个、或 `contrast` 低于它的说话人认不出。 */
export const MIN_SPEAKER_PROBES = 4;
export const MIN_CONTRAST = 1.25;
/** `contrast` 写进结果时的上限（他在别的脸上的分数为 0 时）。 */
const MAX_CONTRAST = 99;

/** 一个词：起止（秒）与说话人；没分出说话人的词不算。 */
export interface SpeakerWord {
  start: number;
  end: number;
  speaker?: string | null;
}

/** 一段话：同一人连着说的词。 */
export interface Turn {
  speaker: string;
  start: number;
  end: number;
}

/** 按起点排好，同一人前后两个词相隔不到 `TURN_GAP` 的连成一段话。 */
export function turnsOf(words: readonly SpeakerWord[]): Turn[] {
  const spoken = words
    .filter((w): w is SpeakerWord & { speaker: string } => !!w.speaker && Number.isFinite(w.start) && w.end >= w.start)
    .sort((a, b) => a.start - b.start);
  const out: Turn[] = [];
  for (const w of spoken) {
    const last = out[out.length - 1];
    if (last && last.speaker === w.speaker && w.start - last.end < TURN_GAP) last.end = Math.max(last.end, w.end);
    else out.push({ speaker: w.speaker, start: w.start, end: w.end });
  }
  return out;
}

/** 一个取样：素材源时钟上的时刻与这时在说话的人。 */
export interface Probe {
  at: number;
  speaker: string;
}

/** 连续说了 `PROBE_TURN` 秒以上的每段话在 30% 与 60% 处各一个取样；多于 `max` 个时在整份里均匀挑（含第一个与最后一个）。 */
export function pickProbes(turns: readonly Turn[], max = MAX_PROBES): Probe[] {
  const all = turns
    .filter((t) => t.end - t.start >= PROBE_TURN)
    .flatMap((t) => PROBE_AT.map((p) => ({ at: t.start + (t.end - t.start) * p, speaker: t.speaker })));
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, i) => all[Math.round((i * (all.length - 1)) / Math.max(1, max - 1))]!);
}

/** 主脸（同 §2.1）：面积不小于 `MIN_FACE_AREA`、也不小于最大那张的 1/4，按中心横坐标从左到右。 */
export function mainFaces(faces: readonly DetectedFace[]): DetectedFace[] {
  const real = faces.filter((f) => f.w * f.h >= MIN_FACE_AREA);
  const largest = Math.max(0, ...real.map((f) => f.w * f.h));
  return real.filter((f) => f.w * f.h >= largest / 4).sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
}

/**
 * 多数取样的主脸数：取样里七成以上是同样 2–4 张主脸时是那个数，否则 null（不是单机位，或检测不到脸）。
 * 分母是所有取样，包括一张脸也没有的。
 */
export function cameraFaceCount(counts: readonly number[]): number | null {
  const tally = new Map<number, number>();
  for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
  const top = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (!top) return null;
  const [count, n] = top;
  return count >= 2 && count <= 4 && n / counts.length >= SAME_FACES_SHARE ? count : null;
}

/** 按帧宽高归一化的框（左上角与宽高）。 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一段灰度画面：每帧 `width × height` 个字节，逐行。 */
export interface GrayBurst {
  width: number;
  height: number;
  frames: readonly Uint8Array[];
}

/** 相邻两帧在一块区域（按帧归一化的 `[x0, x1) × [y0, y1)`，截到画面里）的平均像素差。 */
function regionDiff(a: Uint8Array, b: Uint8Array, burst: GrayBurst, x0: number, x1: number, y0: number, y1: number): number {
  const { width, height } = burst;
  const left = Math.max(0, Math.floor(x0 * width));
  const right = Math.min(width, Math.ceil(x1 * width));
  const top = Math.max(0, Math.floor(y0 * height));
  const bottom = Math.min(height, Math.ceil(y1 * height));
  let sum = 0;
  let n = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = y * width + x;
      sum += Math.abs(a[i]! - b[i]!);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** 这段画面里有没有一刀：相邻两帧整幅的平均像素差有一处超过 `CUT_DIFF`。 */
export function hasCut(burst: GrayBurst): boolean {
  for (let i = 1; i < burst.frames.length; i++) {
    if (regionDiff(burst.frames[i - 1]!, burst.frames[i]!, burst, 0, 1, 0, 1) > CUT_DIFF) return true;
  }
  return false;
}

/** 一张脸嘴部（脸框高度的 62%–105%、宽度居中的 60%）相邻两帧的平均像素差，再在这段画面里求平均。 */
export function mouthMotion(burst: GrayBurst, face: Box): number {
  const x0 = face.x + face.w * 0.2;
  const x1 = face.x + face.w * 0.8;
  const y0 = face.y + face.h * 0.62;
  const y1 = face.y + face.h * 1.05;
  let sum = 0;
  for (let i = 1; i < burst.frames.length; i++) sum += regionDiff(burst.frames[i - 1]!, burst.frames[i]!, burst, x0, x1, y0, y1);
  return burst.frames.length > 1 ? sum / (burst.frames.length - 1) : 0;
}

/** 每张脸（编号同主脸的左右次序）在各取样里的框取中位数。 */
export function medianBoxes(probes: readonly (readonly Box[])[], count: number): Box[] {
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  return Array.from({ length: count }, (_, k) => {
    const boxes = probes.map((p) => p[k]!).filter(Boolean);
    return {
      x: median(boxes.map((b) => b.x)),
      y: median(boxes.map((b) => b.y)),
      w: median(boxes.map((b) => b.w)),
      h: median(boxes.map((b) => b.h)),
    };
  });
}

/** 一个能用的取样：在说话的人与每张脸（左到右）嘴部的动静。 */
export interface ProbeMotion {
  speaker: string;
  motion: readonly number[];
}

/** 一个说话人认没认出：对上的脸（认不出时 null）、取样数与 `contrast`（没参与对应时 null）。 */
export interface SpeakerMatch {
  id: string;
  face: number | null;
  probes: number;
  contrast: number | null;
}

/**
 * 认出每个说话人是哪张脸（§2.5 第 3、4 条）：每张脸的动静除以它在所有取样里的平均，按说话人求平均得「说话人 × 脸」的表；
 * 取样够 `MIN_SPEAKER_PROBES` 个的说话人参与对应，在所有一一对应里取总分最大的（至多 4 张脸，穷举）。对上的脸的分数 ÷ 他在
 * 别的脸上的最高分是 `contrast`，低于 `MIN_CONTRAST` 的认不出。`speakerIds` 是转写里的说话人，按它的次序返回。
 * `confidence` 是认出的说话人里最小的 `contrast`，一个也没认出时 null。
 */
export function matchSpeakers(
  rows: readonly ProbeMotion[],
  faceCount: number,
  speakerIds: readonly string[],
): { speakers: SpeakerMatch[]; confidence: number | null } {
  const means = Array.from(
    { length: faceCount },
    (_, k) => rows.reduce((sum, r) => sum + (r.motion[k] ?? 0), 0) / Math.max(1, rows.length),
  );
  const table = new Map<string, { probes: number; score: number[] }>();
  for (const row of rows) {
    const entry = table.get(row.speaker) ?? { probes: 0, score: new Array<number>(faceCount).fill(0) };
    entry.probes++;
    for (let k = 0; k < faceCount; k++) entry.score[k]! += means[k]! > 0 ? (row.motion[k] ?? 0) / means[k]! : 0;
    table.set(row.speaker, entry);
  }
  for (const entry of table.values()) entry.score = entry.score.map((s) => s / entry.probes);

  const candidates = speakerIds.filter((id) => (table.get(id)?.probes ?? 0) >= MIN_SPEAKER_PROBES);
  // 每张脸给一个候选说话人或谁也不给，说话人不重复；取总分最大的那个（同分取先找到的）。
  let best: (string | null)[] = new Array<string | null>(faceCount).fill(null);
  let bestScore = -1;
  const pick: (string | null)[] = [];
  const walk = (k: number, used: Set<string>, score: number) => {
    if (k === faceCount) {
      if (score > bestScore + 1e-12) {
        bestScore = score;
        best = [...pick];
      }
      return;
    }
    for (const id of [...candidates, null]) {
      if (id !== null && used.has(id)) continue;
      pick[k] = id;
      if (id !== null) used.add(id);
      walk(k + 1, used, score + (id !== null ? table.get(id)!.score[k]! : 0));
      if (id !== null) used.delete(id);
    }
  };
  walk(0, new Set(), 0);

  const speakers = speakerIds.map((id): SpeakerMatch => {
    const entry = table.get(id);
    const face = best.indexOf(id);
    if (!entry || face < 0) return { id, face: null, probes: entry?.probes ?? 0, contrast: null };
    const own = entry.score[face]!;
    const other = Math.max(0, ...entry.score.filter((_, k) => k !== face));
    const raw = other > 0 ? own / other : own > 0 ? MAX_CONTRAST : 0;
    const contrast = Math.min(MAX_CONTRAST, Math.round(raw * 100) / 100);
    return { id, face: raw >= MIN_CONTRAST ? face : null, probes: entry.probes, contrast };
  });
  const matched = speakers.filter((s) => s.face !== null).map((s) => s.contrast!);
  return { speakers, confidence: matched.length ? Math.min(...matched) : null };
}

/** 切出来的一段：剪辑后时间线上的秒与对准的脸（编号同 `faces`），分屏时 null。 */
export interface SpeakerSegment {
  start: number;
  end: number;
  face: number | null;
}

export interface SegmentOptions {
  /** 要切的区间（剪辑后时间线上的秒）。 */
  start: number;
  end: number;
  /** 认出的说话人 → 脸；不在里面的说话人认不出。 */
  faces: ReadonlyMap<string, number>;
  /** false：该分屏的段留在前一段的人身上（参数页关掉分屏）。 */
  split: boolean;
  /** 关掉分屏而区间里谁也认不出时对准的脸（离画面中心最近的那张）。 */
  centerFace: number;
}

interface Piece {
  start: number;
  end: number;
  /** `turn` 是一段话；`pause` 是超过 1.5 秒的停顿，`crosstalk` 是两人抢着说，都分屏。 */
  kind: 'turn' | 'pause' | 'crosstalk';
  speaker: string | null;
}

const length = (p: { start: number; end: number }) => p.end - p.start;

/**
 * 按说话人把 `[start, end)` 切成首尾相接的段（§2.3 的五条规则，依次）：
 * 1. 一段段话；两段话之间不超过 1.5 秒的停顿并进前一段话（区间开头的并进第一段话），超过的自成一段，分屏。
 * 2. 连着 2 段以上都短于 2 秒、相邻两段换了人的话合成一段，分屏。
 * 3. 短于 1.5 秒的话并进前一段（在最前面时并进后一段）。
 * 4. 认不出的说话人说的段分屏。关掉分屏时，1、2、4 该分屏的段留在前一段的人身上（在最前面时用后一段的人），
 *    谁也认不出时对准 `centerFace`。
 * 5. 相邻版式相同的合并；短于 3 秒的段从最短的起并进相邻的分屏段，没有时并进较长的邻段，直到每段都不短于 3 秒或只剩一段。
 * `words` 是区间里的词（剪辑后时间线上的秒，剪掉的词不在里面），伸出区间的部分截掉。
 */
export function speakerSegments(words: readonly SpeakerWord[], options: SegmentOptions): SpeakerSegment[] {
  const { start: S, end: E } = options;
  const inside = words.filter((w) => w.end > S && w.start < E).map((w) => ({ ...w, start: Math.max(S, w.start), end: Math.min(E, w.end) }));

  // 1. 一段段话与停顿，首尾相接盖满区间。
  const pieces: Piece[] = [];
  for (const turn of turnsOf(inside)) {
    let last = pieces[pieces.length - 1];
    if (last && turn.start < last.end) {
      // 两人的词叠在一起：前一段话到后一段话开口为止。
      last.end = turn.start;
      if (last.end <= last.start) {
        pieces.pop();
        last = pieces[pieces.length - 1];
      }
    }
    const cursor = last ? last.end : S;
    if (turn.start - cursor > PAUSE_SPLIT) pieces.push({ start: cursor, end: turn.start, kind: 'pause', speaker: null });
    else if (last) last.end = turn.start;
    pieces.push({ start: pieces.length ? turn.start : S, end: turn.end, kind: 'turn', speaker: turn.speaker });
  }
  const tail = pieces[pieces.length - 1];
  if (!tail) return [{ start: S, end: E, face: options.split ? null : options.centerFace }];
  if (E - tail.end > PAUSE_SPLIT) pieces.push({ start: tail.end, end: E, kind: 'pause', speaker: null });
  else tail.end = E;

  // 2. 两人抢着说。
  const talked: Piece[] = [];
  const quick = (p: Piece) => p.kind === 'turn' && length(p) < CROSSTALK_TURN;
  for (let i = 0; i < pieces.length;) {
    let j = i;
    if (quick(pieces[i]!)) while (j + 1 < pieces.length && quick(pieces[j + 1]!) && pieces[j + 1]!.speaker !== pieces[j]!.speaker) j++;
    talked.push(j > i ? { start: pieces[i]!.start, end: pieces[j]!.end, kind: 'crosstalk', speaker: null } : pieces[i]!);
    i = j + 1;
  }

  // 3. 插话不换人。
  const kept: Piece[] = [];
  let leading = null as Piece | null;
  for (const piece of talked) {
    const last = kept[kept.length - 1];
    if (piece.kind === 'turn' && length(piece) < INTERJECTION) {
      if (last) last.end = piece.end;
      else leading = leading ? { ...leading, end: piece.end } : { ...piece };
      continue;
    }
    kept.push({ ...piece, start: leading ? leading.start : piece.start });
    leading = null;
  }
  if (leading) kept.push(leading);

  // 4. 每段对准谁；关掉分屏时留在前一个人身上。
  let segments: SpeakerSegment[] = kept.map((p) => ({
    start: p.start,
    end: p.end,
    face: p.kind === 'turn' && p.speaker !== null ? (options.faces.get(p.speaker) ?? null) : null,
  }));
  if (!options.split) {
    const first = segments.find((s) => s.face !== null)?.face ?? options.centerFace;
    let previous = first;
    segments = segments.map((s) => {
      previous = s.face ?? previous;
      return { ...s, face: previous };
    });
  }

  // 5. 合并版式相同的邻段，再把短段并进邻段。
  const mergeSame = (list: SpeakerSegment[]) => {
    const out: SpeakerSegment[] = [];
    for (const s of list) {
      const last = out[out.length - 1];
      if (last && last.face === s.face) last.end = s.end;
      else out.push({ ...s });
    }
    return out;
  };
  segments = mergeSame(segments);
  while (segments.length > 1) {
    let i = -1;
    for (let k = 0; k < segments.length; k++) {
      if (length(segments[k]!) < MIN_SEGMENT - 1e-9 && (i < 0 || length(segments[k]!) < length(segments[i]!) - 1e-9)) i = k;
    }
    if (i < 0) break;
    const left = segments[i - 1];
    const right = segments[i + 1];
    let into: SpeakerSegment;
    if (left?.face === null) into = left;
    else if (right?.face === null) into = right;
    else if (!left || !right) into = (left ?? right)!;
    else into = length(left) >= length(right) ? left : right;
    segments[i] = { ...segments[i]!, face: into.face };
    segments = mergeSame(segments);
  }
  return segments;
}
