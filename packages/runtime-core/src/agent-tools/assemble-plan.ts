// i18n-ignore-file: tool schema text, errors and next steps for the model
import { z } from 'zod';
import { SINGLE_SIDED_TRANSITION_KINDS, type Rate, type TransitionKind } from '@baocut/protocol';
import { ToolError } from './tool-catalog.ts';

/**
 * 制作计划的排布（`edits_assemble`，Agent 面设计 §4.3）：只算、不读写视频。各段代码包按整帧首尾相接，旁白在段首；实拍片段按
 * 段内的句子、字或留白定起点，截在下一个片段或段尾；卡片按字时间放在卡片轨上。已经放过的段落按记录推演变长变短与插入
 * （从最后一段往前），推演完的起点必须与排好的一致。工具（`assemble-tools.ts`）拿这里的结果去导入与提交。
 */

const id = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
const seconds = z.number().finite().min(0);
const filePath = z.string().min(1).max(4096);

const timingLine = z
  .object({
    text: z.string().describe('The sentence as spoken'),
    start: seconds.describe('When the sentence starts, in seconds from the start of the segment'),
    end: seconds.optional().describe('When it ends (optional)'),
    chars: z
      .array(seconds.nullable())
      .optional()
      .describe('Per-character start times (seconds from the segment start), index-aligned with text; used by cue'),
  })
  .passthrough();

export const timingSchema = z
  .object({
    lines: z.array(timingLine).describe('Aligned sentences of the narration'),
    gaps: z
      .array(z.object({ clip: id.describe('Clip id'), at: seconds.describe('Gap start, seconds from the segment start') }).passthrough())
      .optional()
      .describe('Pauses left in the narration for gap clips'),
  })
  .passthrough();

export type Timing = z.infer<typeof timingSchema>;

const transition = z.strictObject({
  kind: z.enum(SINGLE_SIDED_TRANSITION_KINDS as [TransitionKind, ...TransitionKind[]]).describe('dissolve, wipe, slide, zoom or iris'),
  dur: z.number().min(0.1).max(2).optional().describe('Seconds (0.1–2), default 0.5; capped at half the clip, dropped below 0.1 s'),
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).optional().describe('linear, ease-in, ease-out or ease-in-out (default)'),
});

const LINE = 'Sentence index in the segment timing (from 0); the anchor is its start';
const CUE = 'Optional. Words inside that sentence; the anchor becomes the moment they are spoken (timing chars)';
const AT = 'Seconds from the start of the segment; instead of line / cue';

export const planSchema = z.strictObject({
  tracks: z
    .strictObject({
      scenes: z.string().min(1).max(200).optional().describe('Visual track for the segment code bundles (id or name); default "Scenes"'),
      narration: z.string().min(1).max(200).optional().describe('Audio track for narration (id or name); default "Narration"'),
      footage: z.string().min(1).max(200).optional().describe('Visual track for footage clips (id or name); default "Footage"'),
      cards: z.string().min(1).max(200).optional().describe('Visual track for cards (id or name); default "Cards"'),
      watermarks: z.string().min(1).max(200).optional().describe('Visual track for watermarks (id or name); default "Watermark"'),
    })
    .optional()
    .describe(
      'Optional. Tracks by id or name. A missing named track reuses an empty unnamed track of the right kind (and names it), else it is created',
    ),
  footageLayer: z
    .enum(['over', 'under'])
    .optional()
    .describe('over (default): footage above the scenes; under: footage track moved below the scenes (bundles must be transparent)'),
  segments: z
    .array(
      z.strictObject({
        id: id.describe('Segment id (letters, digits, . _ -)'),
        bundle: filePath.describe('Code bundle directory of the segment; its length sets the segment length'),
        narration: z
          .strictObject({
            path: filePath.optional().describe('Audio file'),
            artifactId: z.string().min(1).max(200).optional().describe('Or a generated artifact (jobs_inspect outputs)'),
          })
          .optional()
          .describe('Optional. Narration audio, placed at the segment start; give path or artifactId'),
        timing: z
          .union([timingSchema, filePath])
          .optional()
          .describe('Aligned narration: { lines: [{ text, start, chars? }], gaps? } or a path to that JSON; needed by line / cue / gap anchors'),
      }),
    )
    .min(1)
    .max(500)
    .describe('Segments in play order, placed end to end from frame 0'),
  clips: z
    .array(
      z.strictObject({
        id: id.describe('Clip id'),
        seg: id.describe('Segment the clip belongs to'),
        line: z.number().int().min(0).optional().describe(LINE),
        cue: z.string().min(1).optional().describe(CUE),
        gap: z.boolean().optional().describe('true: start at the pause left for this clip (timing.gaps entry with clip = id)'),
        follow: z.boolean().optional().describe('true: start right after the previous clip of the segment (its from–to length)'),
        at: seconds.optional().describe(AT),
        path: filePath.describe('Video or image file'),
        from: seconds.optional().describe('Source in point, seconds (default 0); ignored for images'),
        to: seconds.describe('Source out point, seconds; for images the clip length'),
        audio: z
          .union([z.boolean(), z.number().min(0).max(4)])
          .optional()
          .describe('Keep the source sound: true, or a volume (0–4); default muted. Not for images'),
        fit: z.enum(['cover', 'contain']).optional().describe('cover (default) or contain'),
        crop: z
          .strictObject({
            left: z.number().min(0).lt(1),
            top: z.number().min(0).lt(1),
            right: z.number().min(0).lt(1),
            bottom: z.number().min(0).lt(1),
          })
          .optional()
          .describe('Optional. Fractions cut from each edge of the source before fit'),
        pip: z
          .strictObject({
            x: z.number().describe('Frame centre x, percent of the canvas width'),
            y: z.number().describe('Frame centre y, percent of the canvas height'),
            w: z.number().positive().describe('Frame width, percent of the canvas width'),
          })
          .optional()
          .describe('Optional. Picture in picture instead of full screen'),
        in: transition.optional().describe('Optional. One-sided transition in; skipped when the clip touches the previous one'),
        out: transition.optional().describe('Optional. One-sided transition out; skipped when the clip touches the next one'),
        name: z.string().min(1).max(200).optional().describe('Clip name on the timeline; default the id'),
      }),
    )
    .max(2000)
    .optional()
    .describe(
      'Optional. Footage clips. Anchor: line (+ cue), gap, follow or at. A clip stops at the next clip of its segment or at the segment end',
    ),
  cards: z
    .array(
      z.strictObject({
        id: id.describe('Card id'),
        seg: id.describe('Segment the card belongs to'),
        line: z.number().int().min(0).optional().describe(LINE),
        cue: z.string().min(1).optional().describe(CUE),
        at: seconds.optional().describe(AT),
        bundle: filePath.describe('Transparent code bundle directory; its length is the card length'),
        name: z.string().min(1).max(200).optional().describe('Clip name on the timeline; default the id'),
      }),
    )
    .max(2000)
    .optional()
    .describe('Optional. Cards (transparent code bundles) on the card track at the word time'),
  watermarks: z
    .array(
      z.strictObject({
        id: id.describe('Watermark id'),
        path: filePath.describe('Image file (png, jpg, webp, bmp, tif, gif)'),
        seg: id.optional().describe('Optional. Segment to anchor to (then line + cue or at are relative to it); without seg, at is seconds on the timeline'),
        line: z.number().int().min(0).optional().describe(LINE),
        cue: z.string().min(1).optional().describe(CUE),
        at: seconds.optional().describe('Seconds from the start of seg, or from the start of the timeline when seg is not given'),
        dur: z.number().positive().max(3600).describe('Seconds on screen; cut at the end of the last segment'),
        pip: z
          .strictObject({
            x: z.number().describe('Box centre x, percent of the canvas width'),
            y: z.number().describe('Box centre y, percent of the canvas height'),
            w: z.number().positive().describe('Box width, percent of the canvas width'),
          })
          .optional()
          .describe('Optional. Where the image sits; default full screen'),
        fit: z.enum(['cover', 'contain']).optional().describe('contain (default) or cover'),
        name: z.string().min(1).max(200).optional().describe('Clip name on the timeline; default the id'),
      }),
    )
    .max(2000)
    .optional()
    .describe('Optional. Images over everything for a fixed time (watermark, logo) on the top track; they must not overlap'),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanSegment = Plan['segments'][number];
export type PlanClip = NonNullable<Plan['clips']>[number];
export type PlanCard = NonNullable<Plan['cards']>[number];
export type PlanWatermark = NonNullable<Plan['watermarks']>[number];
export type PlanTransition = z.infer<typeof transition>;

/** 排好的一段：起点与帧数（序列的帧）。 */
export interface SegmentSlot {
  id: string;
  from: number;
  frames: number;
}

/** 排好的实拍片段：时间线上的起点与帧数，源入点（秒），两侧要做的转场（帧数已经夹好）。 */
export interface ClipSlot {
  id: string;
  seg: string;
  from: number;
  frames: number;
  sourceIn: number;
  in: { kind: TransitionKind; easing: string; frames: number } | null;
  out: { kind: TransitionKind; easing: string; frames: number } | null;
}

export interface CardSlot {
  id: string;
  seg: string;
  from: number;
  frames: number;
}

export interface WatermarkSlot {
  id: string;
  from: number;
  frames: number;
}

/** 推演出的一步波纹：`resize` 换包带 ripple，`insert` 用 insertRange 腾位置。 */
export interface RippleStep {
  kind: 'resize' | 'insert';
  id: string;
  boundary: number;
  delta: number;
}

const IMAGE = /\.(png|jpe?g|webp|bmp|tiff?|gif)$/i;

export function isImagePath(file: string): boolean {
  return IMAGE.test(file);
}

/** 秒数换成帧（按序列帧率四舍五入）。 */
export function frameOf(secondsValue: number, fps: Rate): number {
  return Math.round((secondsValue * fps.num) / fps.den);
}

/** 帧换成秒（`compositions_import` 的 place.at：十位小数，换回帧时落在同一帧）。 */
export function atOf(frame: number, fps: Rate): string {
  return String(+((frame * fps.den) / fps.num).toFixed(10));
}

/** 计划自身的一致性：id 不重复，片段与卡片指向存在的段，锚点给且只给一种。 */
export function checkPlan(plan: Plan): void {
  const dup = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const value of ids) {
      if (seen.has(value)) throw new ToolError('INVALID_ARGUMENTS', `plan.${what} has id "${value}" twice`);
      seen.add(value);
    }
  };
  dup(
    plan.segments.map((s) => s.id),
    'segments',
  );
  dup(
    (plan.clips ?? []).map((c) => c.id),
    'clips',
  );
  dup(
    (plan.cards ?? []).map((c) => c.id),
    'cards',
  );
  dup(
    (plan.watermarks ?? []).map((w) => w.id),
    'watermarks',
  );
  const segments = new Set(plan.segments.map((s) => s.id));
  for (const s of plan.segments) {
    if (s.narration && (s.narration.path === undefined) === (s.narration.artifactId === undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', `segment ${s.id}: narration needs exactly one of path and artifactId`);
    }
  }
  for (const c of plan.clips ?? []) {
    if (!segments.has(c.seg)) throw new ToolError('INVALID_ARGUMENTS', `clip ${c.id}: segment ${c.seg} is not in plan.segments`);
    const anchors = [c.line !== undefined, c.gap === true, c.follow === true, c.at !== undefined].filter(Boolean).length;
    if (anchors !== 1) throw new ToolError('INVALID_ARGUMENTS', `clip ${c.id}: give exactly one anchor of line (with optional cue), gap, follow and at`);
    if (c.cue !== undefined && c.line === undefined) throw new ToolError('INVALID_ARGUMENTS', `clip ${c.id}: cue needs line`);
    const from = c.from ?? 0;
    if (!(c.to > from)) throw new ToolError('INVALID_ARGUMENTS', `clip ${c.id}: to (${c.to}) must be after from (${from})`);
    if (isImagePath(c.path) && c.audio !== undefined && c.audio !== false) {
      throw new ToolError('INVALID_ARGUMENTS', `clip ${c.id}: ${c.path} is a still image and has no sound; drop audio`);
    }
  }
  for (const c of plan.cards ?? []) {
    if (!segments.has(c.seg)) throw new ToolError('INVALID_ARGUMENTS', `card ${c.id}: segment ${c.seg} is not in plan.segments`);
    if ((c.line !== undefined) === (c.at !== undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', `card ${c.id}: give exactly one anchor of line (with optional cue) and at`);
    }
    if (c.cue !== undefined && c.line === undefined) throw new ToolError('INVALID_ARGUMENTS', `card ${c.id}: cue needs line`);
  }
  for (const w of plan.watermarks ?? []) {
    if (!isImagePath(w.path)) throw new ToolError('INVALID_ARGUMENTS', `watermark ${w.id}: ${w.path} is not an image (png, jpg, webp, bmp, tif, gif)`);
    if (w.seg === undefined) {
      if (w.at === undefined || w.line !== undefined || w.cue !== undefined) {
        throw new ToolError('INVALID_ARGUMENTS', `watermark ${w.id}: without seg give at (seconds on the timeline) and no line or cue`);
      }
      continue;
    }
    if (!segments.has(w.seg)) throw new ToolError('INVALID_ARGUMENTS', `watermark ${w.id}: segment ${w.seg} is not in plan.segments`);
    if ((w.line !== undefined) === (w.at !== undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', `watermark ${w.id}: give exactly one anchor of line (with optional cue) and at`);
    }
    if (w.cue !== undefined && w.line === undefined) throw new ToolError('INVALID_ARGUMENTS', `watermark ${w.id}: cue needs line`);
  }
}

/** 段首按帧数累加。 */
export function layoutSegments(segments: { id: string; frames: number }[]): SegmentSlot[] {
  let from = 0;
  return segments.map(({ id: segId, frames }) => {
    const slot = { id: segId, from, frames };
    from += frames;
    return slot;
  });
}

/** 一句旁白里的时刻（秒，相对段首）：第 line 句的开头；给了 cue 就是 cue 那几个字开始被说到的时刻。 */
export function cueSeconds(timing: Timing | undefined, owner: string, segId: string, line: number, cue: string | undefined): number {
  if (!timing) throw new ToolError('INVALID_ARGUMENTS', `${owner}: segment ${segId} has no timing; line / cue anchors need it`);
  const l = timing.lines[line];
  if (!l) throw new ToolError('INVALID_ARGUMENTS', `${owner}: line ${line} missing (segment ${segId} has ${timing.lines.length} lines)`);
  if (cue === undefined) return l.start;
  const index = l.text.indexOf(cue);
  if (index < 0) throw new ToolError('INVALID_ARGUMENTS', `${owner}: cue "${cue}" is not in line ${line} of ${segId}: ${l.text}`);
  return l.chars?.[index] ?? l.start;
}

/** 实拍片段在段内的起点（秒）：follow 接在上一个片段的原长之后，gap 取留白的起点，其余按句子或 at。 */
function clipStarts(clips: PlanClip[], timing: Timing | undefined): Map<string, number> {
  const at = new Map<string, number>();
  clips.forEach((c, i) => {
    const prev = clips[i - 1];
    if (c.follow) {
      if (!prev) throw new ToolError('INVALID_ARGUMENTS', `clip ${c.id} follows nothing; it is the first clip of ${c.seg}`);
      at.set(c.id, at.get(prev.id)! + prev.to - (prev.from ?? 0));
    } else if (c.gap) {
      const gap = timing?.gaps?.find((g) => g.clip === c.id);
      if (!gap) throw new ToolError('INVALID_ARGUMENTS', `clip ${c.id} pauses the narration but the timing of ${c.seg} has no gap for it`);
      at.set(c.id, gap.at);
    } else if (c.at !== undefined) {
      at.set(c.id, c.at);
    } else {
      at.set(c.id, cueSeconds(timing, `clip ${c.id}`, c.seg, c.line!, c.cue));
    }
  });
  return at;
}

/**
 * 实拍片段的落点：段首 + 段内起点，截在同一段下一个片段的起点或段尾；转场不超过片段的一半，与前后片段相接的那一侧不做。
 * 截掉的不报错，放进 `warnings`。
 */
export function placeClips(
  clips: PlanClip[],
  slots: SegmentSlot[],
  timings: Map<string, Timing | undefined>,
  fps: Rate,
): { clips: ClipSlot[]; warnings: string[] } {
  const warnings: string[] = [];
  const placed: (ClipSlot & { plan: PlanClip })[] = [];
  for (const slot of slots) {
    const mine = clips.filter((c) => c.seg === slot.id);
    if (!mine.length) continue;
    const starts = clipStarts(mine, timings.get(slot.id));
    const ordered = mine.map((c) => ({ c, f0: slot.from + frameOf(starts.get(c.id)!, fps) })).sort((a, b) => a.f0 - b.f0);
    const end = slot.from + slot.frames;
    ordered.forEach(({ c, f0 }, i) => {
      // 图片的 from / to 只定长度。
      const want = f0 + frameOf(c.to - (c.from ?? 0), fps);
      const stop = Math.min(ordered[i + 1]?.f0 ?? Infinity, end);
      if (want > end && stop === end) warnings.push(`clip ${c.id} runs ${want - end} frames past the end of ${slot.id}; cut at the segment end`);
      const f1 = Math.min(want, stop);
      if (f1 <= f0) {
        warnings.push(`clip ${c.id} has no room (starts at frame ${f0}, stops at ${stop}); skipped`);
        return;
      }
      placed.push({
        id: c.id,
        seg: slot.id,
        from: f0,
        frames: f1 - f0,
        sourceIn: isImagePath(c.path) ? 0 : (c.from ?? 0),
        in: null,
        out: null,
        plan: c,
      });
    });
  }
  placed.sort((a, b) => a.from - b.from);
  placed.forEach((c, i) => {
    const prev = placed[i - 1];
    const next = placed[i + 1];
    const side = (t: PlanTransition | undefined, touching: boolean) =>
      t && !touching
        ? { kind: t.kind, easing: t.easing ?? 'ease-in-out', frames: Math.min(frameOf(t.dur ?? 0.5, fps), Math.floor(c.frames / 2)) }
        : null;
    c.in = side(c.plan.in, !!prev && prev.from + prev.frames >= c.from);
    c.out = side(c.plan.out, !!next && c.from + c.frames >= next.from);
    // 引擎的单侧转场至少 0.1 秒。
    const shortest = Math.ceil((0.1 * fps.num) / fps.den);
    if (c.in && c.in.frames < shortest) c.in = null;
    if (c.out && c.out.frames < shortest) c.out = null;
  });
  return { clips: placed.map(({ plan: _plan, ...slot }) => slot), warnings };
}

/** 卡片的落点：段首 + 字时间；长度是卡片代码包的长度。同一条卡片轨上不能重叠。 */
export function placeCards(
  cards: PlanCard[],
  slots: SegmentSlot[],
  timings: Map<string, Timing | undefined>,
  frames: Map<string, number>,
  fps: Rate,
): CardSlot[] {
  const bySeg = new Map(slots.map((s) => [s.id, s]));
  const placed = cards
    .map((c) => {
      const slot = bySeg.get(c.seg)!;
      const t = c.at !== undefined ? c.at : cueSeconds(timings.get(c.seg), `card ${c.id}`, c.seg, c.line!, c.cue);
      return { id: c.id, seg: c.seg, from: slot.from + frameOf(t, fps), frames: frames.get(c.id)! };
    })
    .sort((a, b) => a.from - b.from);
  placed.forEach((c, i) => {
    const next = placed[i + 1];
    if (next && c.from + c.frames > next.from) {
      throw new ToolError('INVALID_ARGUMENTS', `cards ${c.id} and ${next.id} overlap on the card track (frames ${next.from}–${c.from + c.frames})`, {
        next: 'Move one of them (another cue or at), or shorten the earlier card bundle',
      });
    }
  });
  return placed;
}

/**
 * 水印的落点：给了段落时是段首 + 字时间或秒数，没给时是时间线上的秒数；长度是 `dur`，截在最后一段的末尾（截掉的放进
 * `warnings`，整个落在末尾之后的拒绝）。同一条水印轨上不能重叠。
 */
export function placeWatermarks(
  watermarks: PlanWatermark[],
  slots: SegmentSlot[],
  timings: Map<string, Timing | undefined>,
  fps: Rate,
): { watermarks: WatermarkSlot[]; warnings: string[] } {
  const warnings: string[] = [];
  const bySeg = new Map(slots.map((s) => [s.id, s]));
  const last = slots[slots.length - 1];
  const end = last ? last.from + last.frames : 0;
  const placed = watermarks
    .map((w) => {
      const from =
        w.seg === undefined
          ? frameOf(w.at!, fps)
          : bySeg.get(w.seg)!.from + frameOf(w.at !== undefined ? w.at : cueSeconds(timings.get(w.seg), `watermark ${w.id}`, w.seg, w.line!, w.cue), fps);
      if (from >= end) {
        throw new ToolError('INVALID_ARGUMENTS', `watermark ${w.id} starts at frame ${from}, at or after the end of the last segment (${end})`);
      }
      const want = Math.max(1, frameOf(w.dur, fps));
      if (from + want > end) warnings.push(`watermark ${w.id} runs ${from + want - end} frames past the end of the last segment; cut there`);
      return { id: w.id, from, frames: Math.min(want, end - from) };
    })
    .sort((a, b) => a.from - b.from);
  placed.forEach((w, i) => {
    const next = placed[i + 1];
    if (next && w.from + w.frames > next.from) {
      throw new ToolError('INVALID_ARGUMENTS', `watermarks ${w.id} and ${next.id} overlap on the watermark track (frames ${next.from}–${w.from + w.frames})`, {
        next: 'Move one of them or shorten dur',
      });
    }
  });
  return { watermarks: placed, warnings };
}

/**
 * 已放好的段落（`placed`：时间线上它的代码画面的起点与帧数）推演到排好的位置：从最后一段往前，帧数变了的换包带 ripple
 * （旧终点之后的内容挪 Δ），新插进来、后面还有已放好的段落的先用 insertRange 腾出它的帧数。`off` 列出推演之后仍然对不上
 * 的段落（中间有空隙、顺序变了、被手动挪过）。
 */
export function rippleSteps(slots: SegmentSlot[], placed: Map<string, { from: number; frames: number }>): { steps: RippleStep[]; off: string[] } {
  const sim = new Map([...placed].map(([segId, p]) => [segId, { from: p.from, frames: p.frames }]));
  const steps: RippleStep[] = [];
  const endBefore = (k: number) => {
    for (let i = k - 1; i >= 0; i--) {
      const p = sim.get(slots[i]!.id);
      if (p) return p.from + p.frames;
    }
    return 0;
  };
  const shift = (boundary: number, delta: number) => {
    for (const p of sim.values()) if (p.from >= boundary) p.from += delta;
  };
  for (let k = slots.length - 1; k >= 0; k--) {
    const s = slots[k]!;
    const p = sim.get(s.id);
    if (p && p.frames !== s.frames) {
      const boundary = p.from + p.frames;
      const delta = s.frames - p.frames;
      steps.push({ kind: 'resize', id: s.id, boundary, delta });
      shift(boundary, delta);
      p.frames = s.frames;
    } else if (!p && slots.slice(k + 1).some((x) => sim.has(x.id))) {
      const boundary = endBefore(k);
      steps.push({ kind: 'insert', id: s.id, boundary, delta: s.frames });
      shift(boundary, s.frames);
    }
  }
  const off = slots
    .filter((s) => sim.has(s.id) && sim.get(s.id)!.from !== s.from)
    .map((s) => `${s.id} would sit at frame ${sim.get(s.id)!.from}, the plan puts it at ${s.from}`);
  return { steps, off };
}
