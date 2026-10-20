// i18n-ignore-file: tool schema text, errors and next steps for the model
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  CompositionBakeInfo,
  EditResult,
  Id,
  Sequence,
  SequenceItem,
  Track,
  TrackKind,
  VideoOpenResult,
  VideoSnapshot,
} from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { VideoService } from '../videos/video-service.ts';
import { videoChangeOf, type CompositionEdit, type CompositionService } from '../compositions/composition-service.ts';
import {
  atOf,
  checkPlan,
  isImagePath,
  layoutSegments,
  placeCards,
  placeClips,
  placeWatermarks,
  planSchema,
  rippleSteps,
  timingSchema,
  type CardSlot,
  type ClipSlot,
  type Plan,
  type PlanClip,
  type PlanWatermark,
  type RippleStep,
  type SegmentSlot,
  type Timing,
  type WatermarkSlot,
} from './assemble-plan.ts';
import { ToolError, errorBody, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolApprovalNote, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { resolveUserPath } from './video-digest.ts';
import { videoArg, type VideoTools } from './video-tools.ts';

/**
 * 一次放好制作计划（`edits_assemble`，Agent 面设计 §4.3）：各段代码画面与旁白首尾相接，实拍片段按句子与字放，卡片放在卡片轨上，
 * 水印图片放在最上面一条轨。
 * 排布在 `assemble-plan.ts`（纯计算）；这里读计划与时间文件、量代码包、对照上一次的记录（视频里 `production-plan` 文档），
 * 先查要动的轨道与实例有没有锁着（锁着的引擎会拒绝，前台烘焙就白做了），再按顺序提交：准备轨道 → 删掉过时的条目 →
 * 波纹腾位置或换包 → 放新段落、旁白、实拍、转场、卡片、水印 → 写记录。代码画面走
 * `CompositionService`（与 `compositions_import` 同一条路径），其余每笔走 `VideoTools.submitEdit`（与 `edits_apply` 同一条路径）。
 */

export interface AssembleToolsDeps {
  videos: VideoService;
  scope: ToolScope;
  compositions: CompositionService;
  edits: VideoTools;
}

export const PLAN_RECORD_KIND = 'production-plan';
const RECORD_SCHEMA = 'baocut.production-plan/1';
const DEFAULT_TRACKS = { scenes: 'Scenes', narration: 'Narration', footage: 'Footage', cards: 'Cards', watermarks: 'Watermark' } as const;
/** 引擎给新视频起的轨道名（V1、A1）：空着时可以拿来用。 */
const DEFAULT_TRACK_NAME = /^[VA]\d+$/;
/** 别人同时写入（后台烘焙在写替身）造成的版本冲突，按最新版本重试的次数。 */
const WRITE_ATTEMPTS = 4;

const recordSchema = z.object({
  schema: z.literal(RECORD_SCHEMA),
  tracks: z.object({
    scenes: z.string(),
    narration: z.string(),
    footage: z.string().nullable(),
    cards: z.string().nullable(),
    watermarks: z.string().nullable().default(null),
  }),
  segments: z.array(
    z.object({
      id: z.string(),
      contentHash: z.string(),
      sceneItem: z.string(),
      narration: z.string().nullable(),
      narrationItem: z.string().nullable(),
    }),
  ),
  clips: z.array(z.object({ id: z.string(), key: z.string(), item: z.string() })),
  cards: z.array(z.object({ id: z.string(), contentHash: z.string(), item: z.string() })),
  watermarks: z.array(z.object({ id: z.string(), key: z.string(), item: z.string() })).default([]),
});
type PlanRecord = z.infer<typeof recordSchema>;

const schemas = {
  edits_assemble: z.strictObject({
    video: videoArg,
    plan: planSchema.optional().describe('The production plan inline; give plan or planFile'),
    planFile: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe('Path to the production plan JSON; relative paths inside it resolve against its folder. Give plan or planFile'),
    dryRun: z
      .boolean()
      .optional()
      .describe('Optional. true: lay out the plan and report what would change, without asking for approval or editing the video'),
    background: z
      .boolean()
      .optional()
      .describe('Optional. Bake the code bundles in background bake jobs (default true); false bakes each one before going on'),
    bake: z
      .enum(['auto', 'ops', 'pixels'])
      .optional()
      .describe('Optional. Bake renderer for the code bundles, as in compositions_import: auto (default), ops or pixels'),
    revision: z.string().regex(/^\d+$/).optional().describe('Optional. The video revision the plan was made against; refuses when the video has moved on'),
  }),
};

type AssembleArgs = z.infer<(typeof schemas)['edits_assemble']>;

const DEFINITIONS: Record<keyof typeof schemas, ToolInfo> = {
  edits_assemble: {
    title: 'Assemble production plan',
    description: [
      'Place a production plan on the timeline in one call: code bundle segments end to end with narration, plus footage clips, cards and watermarks.',
      'Plan: segments in play order, each { id, bundle (code bundle folder; its length is the segment length), narration? { path | artifactId }, timing? }. timing is the aligned narration { lines: [{ text, start, chars? }], gaps? } (seconds from the segment start) or a path to that JSON. Clips { id, seg, anchor, path, from?, to, audio?, fit?, crop?, pip?, in?, out? } start at a sentence (line, optionally cue = words inside it), at the pause left for them (gap), right after the previous clip (follow) or at seconds into the segment (at); a clip stops at the next clip of its segment or at the segment end. Cards { id, seg, line + cue | at, bundle } are transparent code bundles. Watermarks { id, path (image), seg + (line + cue | at) or at (seconds on the timeline), dur, pip?, fit? } sit on the top track. Tracks default to Scenes, Narration, Footage, Cards and Watermark; footageLayer under moves Footage below Scenes. Cutting, voicing and aligning happen before this tool; burned labels, bilingual subtitles and Ken Burns moves are not covered.',
      'Reruns are incremental. The video keeps a record of what was placed (a production-plan document). A segment whose bundle got longer or shorter is swapped with ripple, so later content moves by the difference; a segment inserted between placed ones gets room first (insertRange). New narration (a different file or artifact) replaces the old one; clips, cards and watermarks are placed again only when they changed (a re-cut file counts) or moved. Removing a placed segment from the plan is refused (PLAN_SEGMENT_REMOVED): remove its span first. LAYOUT_MISMATCH means the placed segments are no longer end to end (moved by hand). TARGET_LOCKED (before anything changes) names locked tracks or items the run would touch.',
      'dryRun: true returns the layout and the actions (place, resize, replace, keep, move, remove) without asking or editing. Otherwise one approval covers the run; each step is its own undoable edit. Bundles bake in background bake jobs by default (bakeJobId per segment and card; check with jobs_inspect before export); with background: false each result has bake { renderer, fps, seconds, fallback? } and a fallback to browser-pixels is listed in warnings.',
      'Returns fps, totalFrames, tracks, segments [{ id, from, frames, action, sceneItem, narrationItem, bakeJobId, bake }], clips [{ id, from, frames, action, item }], cards, watermarks, steps, warnings (clips or watermarks cut short or skipped, pixel bakes), revision { before, after }, recordDocumentId and check { ok, problems } (segments end to end on the scene track).',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      {
        title: 'Preview what a plan file would change',
        args: { video: 'demo', planFile: 'plan/assemble.json', dryRun: true },
      },
      {
        title: 'Two segments with narration and a footage clip at a word',
        args: {
          video: 'demo',
          plan: {
            segments: [
              { id: 's1', bundle: 'scenes/s1', narration: { path: 'voice/s1.wav' }, timing: 'timing/s1.json' },
              { id: 's2', bundle: 'scenes/s2', narration: { path: 'voice/s2.wav' }, timing: 'timing/s2.json' },
            ],
            clips: [{ id: 'launch', seg: 's2', line: 1, cue: 'liftoff', path: 'footage/launch.mp4', from: 12, to: 16, in: { kind: 'dissolve' } }],
          },
        },
      },
    ],
    surfaces: ['agent', 'cli'],
    positional: 'video',
  },
};

/** 计划里各段落的状态与这次的动作。 */
type SegmentAction = 'place' | 'resize' | 'replace' | 'keep';
type ItemAction = 'place' | 'keep' | 'move';

interface SegmentPlan {
  slot: SegmentSlot;
  bundle: string;
  contentHash: string;
  /** 时间线上那个代码画面现在用的包（记录里写它）：换包成功之后才是 `contentHash`。 */
  placedHash: string | null;
  action: SegmentAction;
  sceneItem: Id | null;
  narration: { key: string; source: { path: string } | { artifactId: string } } | null;
  narrationAction: 'place' | 'keep' | 'none';
  narrationItem: Id | null;
  bakeJobId: Id | null;
  bake: BakeNote | null;
}

/** 前台烘焙实际用的渲染器（`compositions.import` 回执的 `bake`，去掉诊断用的各阶段用时）。 */
type BakeNote = Pick<CompositionBakeInfo, 'renderer' | 'fps' | 'seconds' | 'fallback'>;

interface ClipPlan {
  slot: ClipSlot;
  source: PlanClip;
  key: string;
  action: ItemAction;
  item: Id | null;
}

interface CardPlan {
  slot: CardSlot;
  bundle: string;
  name: string;
  contentHash: string;
  action: ItemAction;
  item: Id | null;
  bakeJobId: Id | null;
  bake: BakeNote | null;
}

interface WatermarkPlan {
  slot: WatermarkSlot;
  source: PlanWatermark;
  key: string;
  action: ItemAction;
  item: Id | null;
}

export class AssembleTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: AssembleToolsDeps;

  constructor(deps: AssembleToolsDeps) {
    // 目录一致性测试只构造、不调用：依赖用到时才取。
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    if (name === 'edits_assemble') return this.#assemble(args as AssembleArgs, principal);
    throw new ToolError('UNKNOWN_TOOL', `No such tool: ${name}`);
  }

  async #assemble(args: AssembleArgs, principal: ToolPrincipal) {
    const { scope, compositions, videos } = this.#deps;
    const dryRun = args.dryRun === true;
    const background = args.background !== false;
    const access = scope.authorize(principal, !dryRun);
    if ((args.plan === undefined) === (args.planFile === undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', 'Give exactly one of plan and planFile');
    }
    const opened = await scope.open(args.video, access);
    const videoId = opened.ref.videoId;
    const importBase = scope.importBase(access, opened);
    const { plan, timings } = await loadPlan(args, importBase);
    checkPlan(plan);

    const before = this.#current(opened);
    if (args.revision !== undefined && args.revision !== before.revision) {
      throw new ToolError('PROJECT_REVISION_CONFLICT', `The video is at revision ${before.revision}, not ${args.revision}`, {
        next: 'Read the video again (videos_inspect) and decide whether the plan still applies',
      });
    }
    const sequence = rootSequence(before);
    const fps = sequence.fps;

    // 量代码包：长度（序列的帧）与内容摘要；同一个包只量一次。
    const measured = new Map<string, { frames: number; contentHash: string }>();
    const measure = async (bundle: string) => {
      if (!measured.has(bundle)) measured.set(bundle, await compositions.measure(bundle, importBase, fps));
      return measured.get(bundle)!;
    };
    for (const s of plan.segments) await measure(s.bundle);
    for (const c of plan.cards ?? []) await measure(c.bundle);

    const slots = layoutSegments(plan.segments.map((s) => ({ id: s.id, frames: measured.get(s.bundle)!.frames })));
    const { clips: clipSlots, warnings } = placeClips(plan.clips ?? [], slots, timings, fps);
    const cardSlots = placeCards(
      plan.cards ?? [],
      slots,
      timings,
      new Map((plan.cards ?? []).map((c) => [c.id, measured.get(c.bundle)!.frames])),
      fps,
    );
    const { watermarks: watermarkSlots, warnings: watermarkWarnings } = placeWatermarks(plan.watermarks ?? [], slots, timings, fps);
    warnings.push(...watermarkWarnings);

    // 对照上一次的记录：时间线上代码画面的位置是准的。
    const record = await this.#record(videoId, before);
    const items = new Map(sequence.items.map((item) => [item.id, item]));
    const planned = new Set(plan.segments.map((s) => s.id));
    const placed = new Map<string, { from: number; frames: number }>();
    for (const r of record?.body.segments ?? []) {
      const span = spanOf(items.get(r.sceneItem));
      if (!planned.has(r.id)) {
        if (span) {
          throw new ToolError('PLAN_SEGMENT_REMOVED', `Segment ${r.id} is on the timeline (frames ${span.from}–${span.from + span.frames}) but not in the plan`, {
            next: `Remove its span on all tracks first (edits_apply removeRange from "${atOf(span.from, fps)}" to "${atOf(span.from + span.frames, fps)}"), or put it back in the plan`,
          });
        }
        continue;
      }
      if (span) placed.set(r.id, span);
    }
    const { steps, off } = rippleSteps(slots, placed);
    if (off.length) {
      throw new ToolError('LAYOUT_MISMATCH', `The placed segments no longer sit where the plan record says: ${off.join('; ')}`, {
        next: 'Undo the manual moves (edits_undo) so the segments are end to end again, then run again',
      });
    }
    const shifted = (frame: number) => steps.reduce((f, s) => (f >= s.boundary ? f + s.delta : f), frame);

    const recordSegments = new Map((record?.body.segments ?? []).map((r) => [r.id, r]));
    const segments: SegmentPlan[] = [];
    for (const [i, s] of plan.segments.entries()) {
      const slot = slots[i]!;
      const r = recordSegments.get(s.id);
      const at = placed.get(s.id);
      const contentHash = measured.get(s.bundle)!.contentHash;
      const action: SegmentAction = !at ? 'place' : at.frames !== slot.frames ? 'resize' : r!.contentHash !== contentHash ? 'replace' : 'keep';
      const narration = s.narration ? await narrationOf(s.narration, importBase.confine) : null;
      const oldNarration = r?.narrationItem && items.has(r.narrationItem) ? r.narrationItem : null;
      const keepNarration = action !== 'place' && !!narration && !!oldNarration && r!.narration === narration.key;
      segments.push({
        slot,
        bundle: s.bundle,
        contentHash,
        placedHash: at ? r!.contentHash : null,
        action,
        sceneItem: at ? r!.sceneItem : null,
        narration,
        narrationAction: !narration ? 'none' : keepNarration ? 'keep' : 'place',
        narrationItem: keepNarration ? oldNarration : null,
        bakeJobId: null,
        bake: null,
      });
    }

    // 文件的大小与修改时间算进内容键：同一个路径重新剪过（overlay 脚本原地重写）也要换。
    const stamps = new Map<string, string>();
    const stampOf = async (file: string, what: string) => {
      if (!stamps.has(file)) stamps.set(file, await fileStamp(file, importBase.confine, what));
      return stamps.get(file)!;
    };
    const recordClips = new Map((record?.body.clips ?? []).map((r) => [r.id, r]));
    const sources = new Map((plan.clips ?? []).map((c) => [c.id, c]));
    const clips: ClipPlan[] = [];
    for (const slot of clipSlots) {
      const source = sources.get(slot.id)!;
      const key = clipKey(source, slot, await stampOf(source.path, `clip ${slot.id}`));
      const r = recordClips.get(slot.id);
      const span = r ? spanOf(items.get(r.item)) : null;
      const keep = !!span && r!.key === key && shifted(span.from) === slot.from && span.frames === slot.frames;
      clips.push({ slot, source, key, action: keep ? 'keep' : 'place', item: keep ? r!.item : null });
    }

    const recordCards = new Map((record?.body.cards ?? []).map((r) => [r.id, r]));
    const cardSources = new Map((plan.cards ?? []).map((c) => [c.id, c]));
    const cards: CardPlan[] = cardSlots.map((slot) => {
      const source = cardSources.get(slot.id)!;
      const contentHash = measured.get(source.bundle)!.contentHash;
      const r = recordCards.get(slot.id);
      const span = r ? spanOf(items.get(r.item)) : null;
      const same = !!span && r!.contentHash === contentHash;
      const action: ItemAction = !same ? 'place' : shifted(span!.from) === slot.from ? 'keep' : 'move';
      return { slot, bundle: source.bundle, name: source.name ?? source.id, contentHash, action, item: same ? r!.item : null, bakeJobId: null, bake: null };
    });

    const recordWatermarks = new Map((record?.body.watermarks ?? []).map((r) => [r.id, r]));
    const watermarkSources = new Map((plan.watermarks ?? []).map((w) => [w.id, w]));
    const watermarks: WatermarkPlan[] = [];
    for (const slot of watermarkSlots) {
      const source = watermarkSources.get(slot.id)!;
      const key = watermarkKey(source, slot, await stampOf(source.path, `watermark ${slot.id}`));
      const r = recordWatermarks.get(slot.id);
      const span = r ? spanOf(items.get(r.item)) : null;
      const same = !!span && r!.key === key && span.frames === slot.frames;
      const action: ItemAction = !same ? 'place' : shifted(span!.from) === slot.from ? 'keep' : 'move';
      watermarks.push({ slot, source, key, action, item: same ? r!.item : null });
    }

    // 要删掉的：换了旁白或段落要重放的旧旁白、不在计划里或要重放的实拍与卡片。
    const stale: Id[] = [];
    const live = (itemId: Id | null | undefined) => (itemId && items.has(itemId) ? [itemId] : []);
    for (const s of segments) {
      const r = recordSegments.get(s.slot.id);
      if (r && s.narrationAction !== 'keep') stale.push(...live(r.narrationItem));
    }
    for (const r of record?.body.segments ?? []) if (!planned.has(r.id)) stale.push(...live(r.narrationItem));
    const keptClips = new Set(clips.filter((c) => c.action === 'keep').map((c) => c.item));
    for (const r of record?.body.clips ?? []) if (!keptClips.has(r.item)) stale.push(...live(r.item));
    const keptCards = new Set(cards.filter((c) => c.action !== 'place').map((c) => c.item));
    for (const r of record?.body.cards ?? []) if (!keptCards.has(r.item)) stale.push(...live(r.item));
    const keptWatermarks = new Set(watermarks.filter((w) => w.action !== 'place').map((w) => w.item));
    for (const r of record?.body.watermarks ?? []) if (!keptWatermarks.has(r.item)) stale.push(...live(r.item));

    const total = slots.length ? slots[slots.length - 1]!.from + slots[slots.length - 1]!.frames : 0;
    const changed = {
      segments: segments.filter((s) => s.action !== 'keep' || s.narrationAction === 'place').length,
      clips: clips.filter((c) => c.action !== 'keep').length,
      cards: cards.filter((c) => c.action !== 'keep').length,
      watermarks: watermarks.filter((w) => w.action !== 'keep').length,
    };
    const report = (after: string, recordDocumentId: Id | null, check: { ok: boolean; problems: string[] } | null, approval?: ToolApprovalNote | void) => ({
      videoId,
      dryRun,
      fps,
      totalFrames: total,
      totalSeconds: Number(atOf(total, fps)),
      segments: segments.map((s) => ({
        id: s.slot.id,
        from: s.slot.from,
        frames: s.slot.frames,
        action: s.action,
        narration: s.narrationAction,
        sceneItem: s.sceneItem,
        narrationItem: s.narrationItem,
        bakeJobId: s.bakeJobId,
        bake: s.bake,
      })),
      clips: clips.map((c) => ({ id: c.slot.id, from: c.slot.from, frames: c.slot.frames, action: c.action, item: c.item })),
      cards: cards.map((c) => ({ id: c.slot.id, from: c.slot.from, frames: c.slot.frames, action: c.action, item: c.item, bakeJobId: c.bakeJobId, bake: c.bake })),
      watermarks: watermarks.map((w) => ({ id: w.slot.id, from: w.slot.from, frames: w.slot.frames, action: w.action, item: w.item })),
      steps,
      removed: stale.length,
      warnings,
      revision: { before: before.revision, after },
      recordDocumentId,
      check,
      ...approvalField(approval),
    });

    const nothing = !stale.length && !steps.length && !changed.segments && !changed.clips && !changed.cards && !changed.watermarks;
    if (!nothing) {
      const locked = lockedTargets(sequence, {
        touched: [
          ...stale,
          ...segments.filter((x) => x.action === 'resize' || x.action === 'replace').map((x) => x.sceneItem!),
          ...cards.filter((c) => c.action === 'move').map((c) => c.item!),
          ...watermarks.filter((w) => w.action === 'move').map((w) => w.item!),
        ],
        from: steps.length ? Math.min(...steps.map((st) => st.boundary)) : null,
        tracks: (['scenes', 'narration', 'footage', 'cards', 'watermarks'] as const)
          .filter((role) => ({ scenes: changed.segments, narration: changed.segments, footage: changed.clips, cards: changed.cards, watermarks: changed.watermarks })[role] > 0)
          .map((role) => existingTrack(sequence, plan.tracks?.[role], record?.body.tracks[role] ?? null, DEFAULT_TRACKS[role])),
      });
      if (locked.length) {
        throw new ToolError('TARGET_LOCKED', `The run would change locked tracks or items: ${locked.join('; ')}`, {
          next: 'Unlock them (edits_apply updateTrack or updateItem with locked: false) and run again; nothing was changed',
        });
      }
    }
    if (dryRun || (nothing && record)) {
      return {
        ...report(before.revision, record?.documentId ?? null, null),
        ...(dryRun ? { note: 'Dry run: nothing was changed. Run again without dryRun to apply.' } : { note: 'Everything already matches the plan; nothing was changed.' }),
      };
    }

    const approval = await scope.confirm(access, {
      tool: 'edits_assemble',
      video: args.video,
      ...confirmSummary(RcAgentTools.assembleSummary(changed)),
    });
    const write = (label: string, operations: Record<string, unknown>[]) => this.#write(access, opened, principal, label, operations);
    const importer = (request: Parameters<CompositionService['import']>[0]) =>
      compositions.import(
        { ...request, background, ...(args.bake ? { bake: args.bake } : {}) },
        {
          open: async () => opened,
          importBase: () => importBase,
          // 整次运行开始前已经确认过。
          confirm: async () => {},
          apply: (o, edit) => this.#apply(access, o, principal, edit),
          submitter: access.submitter,
        },
      );

    // 1. 轨道。
    const tracks = await this.#tracks(plan, record?.body.tracks ?? null, opened, write, {
      footage: clips.length > 0,
      cards: cards.length > 0,
      watermarks: watermarks.length > 0,
    });

    // 中途失败时也把已经放好的写进记录，重跑时从这里接着做。
    try {
      // 2. 删掉过时的条目（在波纹之前，免得它们被挪动或挡路）。
      if (stale.length) await write(RcAgentTools.assembleRemoveLabel({ count: stale.length }).text, [{ type: 'deleteItems', itemIds: stale }]);

      // 3. 从最后一段往前：变长变短的换包带 ripple，插进来的段落先腾位置。
      const bySegment = new Map(segments.map((s) => [s.slot.id, s]));
      for (const step of steps) {
        const s = bySegment.get(step.id)!;
        if (step.kind === 'resize') {
          const result = await importer({ path: s.bundle, name: s.slot.id, replace: { itemId: s.sceneItem!, ripple: true } });
          s.placedHash = s.contentHash;
          s.bakeJobId = result.bakeJobId;
          s.bake = bakeNote(result.bake);
        } else {
          await this.#makeRoom(opened, write, step);
        }
      }
      // 4. 长度没变、换了包的段落原地替换。
      for (const s of segments.filter((x) => x.action === 'replace')) {
        const result = await importer({ path: s.bundle, name: s.slot.id, replace: { itemId: s.sceneItem!, ripple: true } });
        s.placedHash = s.contentHash;
        s.bakeJobId = result.bakeJobId;
        s.bake = bakeNote(result.bake);
      }
      // 5. 新段落的代码画面。
      for (const s of segments.filter((x) => x.action === 'place')) {
        const result = await importer({ path: s.bundle, name: s.slot.id, place: { track: tracks.scenes, at: atOf(s.slot.from, fps) } });
        s.sceneItem = result.itemId;
        s.placedHash = s.contentHash;
        s.bakeJobId = result.bakeJobId;
        s.bake = bakeNote(result.bake);
      }
      // 6. 旁白：一笔导入并放好。
      const voiced = segments.filter((s) => s.narrationAction === 'place');
      if (voiced.length) {
        const ops: Record<string, unknown>[] = [];
        voiced.forEach((s, i) => {
          const ref = `narration-${i}`;
          const name = `${s.slot.id} narration`;
          ops.push(
            'path' in s.narration!.source
              ? { type: 'importAsset', path: s.narration!.source.path, storage: 'managed', name, ref }
              : { type: 'importAsset', artifactId: s.narration!.source.artifactId, name, ref },
            {
              type: 'addItem',
              asset: { ref },
              trackId: tracks.narration,
              at: { unit: 'frames', value: s.slot.from },
              alignment: 'exact-frame',
              name,
            },
          );
        });
        const result = await write(RcAgentTools.assembleNarrationLabel({ count: voiced.length }).text, ops);
        const created = createdOn(this.#current(opened), result, tracks.narration);
        for (const s of voiced) s.narrationItem = created.get(s.slot.from) ?? null;
      }
      // 7. 实拍片段：一笔导入并写入，转场另一笔。
      const fresh = clips.filter((c) => c.action === 'place');
      if (fresh.length) {
        const refs = new Map<string, string>();
        const ops: Record<string, unknown>[] = [];
        for (const c of fresh) {
          if (refs.has(c.source.path)) continue;
          const ref = `footage-${refs.size}`;
          refs.set(c.source.path, ref);
          ops.push({ type: 'importAsset', path: c.source.path, storage: 'managed', name: path.basename(c.source.path), ref });
        }
        ops.push({
          type: 'insertItems',
          sequenceId: before.rootSequenceId,
          items: fresh.map((c) => footageItem(c, tracks.footage!, refs.get(c.source.path)!)),
        });
        const result = await write(RcAgentTools.assembleFootageLabel({ count: fresh.length }).text, ops);
        const created = createdOn(this.#current(opened), result, tracks.footage!);
        for (const c of fresh) c.item = created.get(c.slot.from) ?? null;
        const transitions = fresh.flatMap((c) =>
          c.item
            ? [
                ...(c.slot.in ? [transitionOp({ rightItemId: c.item }, c.slot.in)] : []),
                ...(c.slot.out ? [transitionOp({ leftItemId: c.item }, c.slot.out)] : []),
              ]
            : [],
        );
        if (transitions.length) await write(RcAgentTools.assembleTransitionsLabel().text, transitions);
      }
      // 8. 卡片与水印：挪动的一笔，新卡片逐个导入。
      const moved = [...cards, ...watermarks].filter((c) => c.action === 'move');
      if (moved.length) {
        await write(
          RcAgentTools.assembleMoveLabel({ count: moved.length }).text,
          moved.map((c) => ({ type: 'moveItem', itemId: c.item, at: { unit: 'frames', value: c.slot.from }, alignment: 'exact-frame' })),
        );
      }
      for (const c of cards.filter((x) => x.action === 'place')) {
        const result = await importer({ path: c.bundle, name: c.name, place: { track: tracks.cards!, at: atOf(c.slot.from, fps) } });
        c.item = result.itemId;
        c.bakeJobId = result.bakeJobId;
        c.bake = bakeNote(result.bake);
      }
      // 9. 新水印：一笔导入并写入。
      const marks = watermarks.filter((w) => w.action === 'place');
      if (marks.length) {
        const refs = new Map<string, string>();
        const ops: Record<string, unknown>[] = [];
        for (const w of marks) {
          if (refs.has(w.source.path)) continue;
          const ref = `watermark-${refs.size}`;
          refs.set(w.source.path, ref);
          ops.push({ type: 'importAsset', path: w.source.path, storage: 'managed', name: path.basename(w.source.path), ref });
        }
        ops.push({
          type: 'insertItems',
          sequenceId: before.rootSequenceId,
          items: marks.map((w) => watermarkItem(w, tracks.watermarks!, refs.get(w.source.path)!)),
        });
        const result = await write(RcAgentTools.assembleWatermarkLabel({ count: marks.length }).text, ops);
        const created = createdOn(this.#current(opened), result, tracks.watermarks!);
        for (const w of marks) w.item = created.get(w.slot.from) ?? null;
      }
    } catch (error) {
      await this.#writeRecord(write, record?.documentId ?? null, tracks, segments, clips, cards, watermarks).catch(() => {});
      throw error;
    }

    // 前台烘焙退回逐帧截图（慢、文件大）而调用方没有要像素时提一句：按代码场景细则改好包再跑会原地换包。
    if (args.bake !== 'pixels') {
      for (const [what, x] of [...segments.map((s) => [`segment ${s.slot.id}`, s] as const), ...cards.map((c) => [`card ${c.slot.id}`, c] as const)]) {
        if (x.bake?.renderer === 'browser-pixels') {
          warnings.push(`${what} baked as browser-pixels${x.bake.fallback ? ` (${x.bake.fallback.reason})` : ''}; fix the bundle so it bakes as draw ops and run again, or pass bake: "pixels" when that is intended (WebGL)`);
        }
      }
    }

    // 10. 记录。
    const recordDocumentId = await this.#writeRecord(write, record?.documentId ?? null, tracks, segments, clips, cards, watermarks);

    const after = this.#current(opened);
    return report(after.revision, recordDocumentId, checkScenes(after, segments), approval);
  }

  /** 写记录（`production-plan` 文档）：只记已经在时间线上的；旁白没放上去时不记它的键，重跑时会再放。 */
  async #writeRecord(
    write: (label: string, operations: Record<string, unknown>[]) => Promise<EditResult>,
    documentId: Id | null,
    tracks: PlanRecord['tracks'],
    segments: SegmentPlan[],
    clips: ClipPlan[],
    cards: CardPlan[],
    watermarks: WatermarkPlan[],
  ): Promise<Id | null> {
    const body: PlanRecord = {
      schema: RECORD_SCHEMA,
      tracks,
      segments: segments
        .filter((s) => s.sceneItem && s.placedHash)
        .map((s) => ({
          id: s.slot.id,
          contentHash: s.placedHash!,
          sceneItem: s.sceneItem!,
          narration: s.narrationItem ? (s.narration?.key ?? null) : null,
          narrationItem: s.narrationItem,
        })),
      clips: clips.filter((c) => c.item).map((c) => ({ id: c.slot.id, key: c.key, item: c.item! })),
      cards: cards.filter((c) => c.item).map((c) => ({ id: c.slot.id, contentHash: c.contentHash, item: c.item! })),
      watermarks: watermarks.filter((w) => w.item).map((w) => ({ id: w.slot.id, key: w.key, item: w.item! })),
    };
    const name = RcAgentTools.assembleRecordName().text;
    const written = await write(
      documentId ? RcAgentTools.updateDocumentLabel({ name }).text : RcAgentTools.newDocumentLabel({ name }).text,
      [{ type: 'putDocument', ...(documentId ? { documentId } : { ref: 'record' }), kind: PLAN_RECORD_KIND, name, body }],
    );
    return documentId ?? written.receipt.refs?.record ?? null;
  }

  /** 视频里上一次的记录（`production-plan` 文档）；没有或读不懂时为 null。 */
  async #record(videoId: Id, video: VideoSnapshot): Promise<{ documentId: Id; body: PlanRecord } | null> {
    const doc = Object.values(video.documents)
      .filter((d) => d.kind === PLAN_RECORD_KIND)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!doc) return null;
    const parsed = recordSchema.safeParse((await this.#deps.videos.document(videoId, doc.id)).body);
    if (!parsed.success) {
      throw new ToolError('PLAN_RECORD_INVALID', `The production plan record (document ${doc.id}) cannot be read: ${parsed.error.message}`, {
        next: 'Delete the record document and the placed segments, then run again',
      });
    }
    return { documentId: doc.id, body: parsed.data };
  }

  /**
   * 轨道：按 ID 或名字找，记录里的 ID 还在时用它；找不到时用一条同类、空着、没有名字（或是引擎起的 V1、A1）的轨道并改名，再没有就新建。
   * 新建的按场景、实拍、卡片、水印的顺序加在上面；`footageLayer`、卡片与水印在最上面的顺序不对时挪一次。
   */
  async #tracks(
    plan: Plan,
    recorded: PlanRecord['tracks'] | null,
    opened: VideoOpenResult,
    write: (label: string, operations: Record<string, unknown>[]) => Promise<EditResult>,
    need: { footage: boolean; cards: boolean; watermarks: boolean },
  ): Promise<PlanRecord['tracks']> {
    const sequence = rootSequence(this.#current(opened));
    const used = new Set(sequence.items.map((i) => i.trackId));
    const claimed = new Set<Id>();
    const ops: Record<string, unknown>[] = [];
    const resolve = (role: keyof typeof DEFAULT_TRACKS, kind: TrackKind): { id: Id } | { ref: string } => {
      const wanted = plan.tracks?.[role];
      const ofKind = sequence.tracks.filter((t) => t.kind === kind && !claimed.has(t.id));
      const pick = (t: Track | undefined) => {
        if (!t) return null;
        claimed.add(t.id);
        return { id: t.id };
      };
      if (wanted) {
        const found = pick(ofKind.find((t) => t.id === wanted) ?? ofKind.find((t) => t.name === wanted));
        if (found) return found;
      } else {
        const found = pick(ofKind.find((t) => t.id === recorded?.[role]) ?? ofKind.find((t) => t.name === DEFAULT_TRACKS[role]));
        if (found) return found;
      }
      const name = wanted ?? DEFAULT_TRACKS[role];
      const empty = pick(ofKind.find((t) => (!t.name || DEFAULT_TRACK_NAME.test(t.name)) && !used.has(t.id)));
      if (empty) {
        ops.push({ type: 'updateTrack', trackId: empty.id, name });
        return empty;
      }
      ops.push({ type: 'addTrack', kind, name, ref: role });
      return { ref: role };
    };
    const roles = {
      scenes: resolve('scenes', 'visual'),
      narration: resolve('narration', 'audio'),
      footage: need.footage ? resolve('footage', 'visual') : null,
      cards: need.cards ? resolve('cards', 'visual') : null,
      watermarks: need.watermarks ? resolve('watermarks', 'visual') : null,
    };
    let refs: Record<string, Id> = {};
    if (ops.length) refs = (await write(RcAgentTools.assembleTracksLabel().text, ops)).receipt.refs ?? {};
    const idOf = (r: { id: Id } | { ref: string } | null) => (r === null ? null : 'id' in r ? r.id : refs[r.ref]!);
    const ids = {
      scenes: idOf(roles.scenes)!,
      narration: idOf(roles.narration)!,
      footage: idOf(roles.footage),
      cards: idOf(roles.cards),
      watermarks: idOf(roles.watermarks),
    };

    const order = new Map(rootSequence(this.#current(opened)).tracks.map((t) => [t.id, t.order]));
    const moves: Record<string, unknown>[] = [];
    if (ids.footage) {
      const under = plan.footageLayer === 'under';
      const below = order.get(ids.footage)! < order.get(ids.scenes)!;
      if (under !== below) moves.push({ type: 'moveTrack', trackId: ids.footage, target: ids.scenes, position: under ? 'below' : 'above' });
    }
    if (ids.cards) {
      const top = ids.footage && plan.footageLayer !== 'under' ? ids.footage : ids.scenes;
      if (order.get(ids.cards)! < order.get(top)! || (top !== ids.scenes && order.get(ids.cards)! < order.get(ids.scenes)!)) {
        moves.push({ type: 'moveTrack', trackId: ids.cards, target: top, position: 'above' });
      }
    }
    if (ids.watermarks) {
      // 水印在这几条轨的最上面：卡片刚挪过时直接挪到卡片上面。
      const others = [ids.scenes, ids.footage, ids.cards].filter((x): x is Id => x !== null);
      const top = ids.cards ?? (ids.footage && plan.footageLayer !== 'under' ? ids.footage : ids.scenes);
      if (moves.length || others.some((x) => order.get(ids.watermarks!)! < order.get(x)!)) {
        moves.push({ type: 'moveTrack', trackId: ids.watermarks, target: top, position: 'above' });
      }
    }
    if (moves.length) await write(RcAgentTools.assembleTracksLabel().text, moves);
    return ids;
  }

  /** 插进来的段落：在边界之后有内容的轨道上腾出它的帧数（跨在边界上的不拆、不动）。 */
  async #makeRoom(opened: VideoOpenResult, write: (label: string, operations: Record<string, unknown>[]) => Promise<EditResult>, step: RippleStep) {
    const sequence = rootSequence(this.#current(opened));
    const trackIds = [...new Set(sequence.items.filter((i) => (startOf(i) ?? -1) >= step.boundary).map((i) => i.trackId))];
    if (!trackIds.length) return;
    await write(RcAgentTools.assembleRoomLabel({ segment: step.id }).text, [
      {
        type: 'insertRange',
        at: { unit: 'frames', value: step.boundary },
        duration: { unit: 'frames', value: step.delta },
        trackIds,
        alignment: 'exact-frame',
        straddle: 'stay',
      },
    ]);
  }

  /** 一笔修改：与 `edits_apply` 同一条路径；别人同时写入造成的版本冲突按最新版本重试。 */
  async #write(access: ToolAccess, opened: VideoOpenResult, principal: ToolPrincipal, label: string, operations: Record<string, unknown>[]) {
    return retryingConflicts(
      async (expectedRevision) =>
        (await this.#deps.edits.submitEdit(access, opened, principal, { expectedRevision, label, operations, commandId: undefined })).result,
      () => this.#current(opened).revision,
    );
  }

  /** 代码画面的两笔（导入素材、放置或替换）：回执放一张变更卡，同 `compositions_import`。 */
  async #apply(access: ToolAccess, opened: VideoOpenResult, principal: ToolPrincipal, edit: CompositionEdit): Promise<EditResult> {
    const { videos, scope } = this.#deps;
    const videoId = opened.ref.videoId;
    const taskId = (access as { taskId?: unknown }).taskId;
    const result = await videos.apply(
      {
        videoId,
        commandId: scope.commandId(access, edit.commandId),
        expectedRevision: edit.expectedRevision,
        operations: edit.operations as never,
        label: edit.label,
      },
      principal,
      { ...(typeof taskId === 'string' ? { taskId } : {}), protections: scope.protections?.(access, videoId) ?? [] },
    );
    scope.recordChange(access, videoChangeOf(videos, opened, result));
    return result;
  }

  #current(opened: VideoOpenResult): VideoSnapshot {
    return this.#deps.videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video;
  }
}

async function retryingConflicts(write: (expectedRevision: string) => Promise<EditResult>, latest: () => string): Promise<EditResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write(latest());
    } catch (error) {
      if (attempt >= WRITE_ATTEMPTS || errorBody(error).code !== 'PROJECT_REVISION_CONFLICT') throw error;
    }
  }
}

function rootSequence(video: VideoSnapshot): Sequence {
  return video.sequences[video.rootSequenceId]!;
}

/** 实例在序列上的起点（帧）：画面实例看 `span`，音频看 `fromFrame`。 */
function startOf(item: SequenceItem): number | null {
  if ('span' in item && item.span) return item.span.fromFrame;
  if ('fromFrame' in item && typeof item.fromFrame === 'number') return item.fromFrame;
  return null;
}

function spanOf(item: SequenceItem | undefined): { from: number; frames: number } | null {
  return item && 'span' in item && item.span ? { from: item.span.fromFrame, frames: item.span.durationFrames } : null;
}

/** 这笔新建在某条轨道上的实例，按起点（帧）找。 */
function createdOn(video: VideoSnapshot, result: EditResult, trackId: Id): Map<number, Id> {
  const created = new Set(result.receipt.createdIds);
  const out = new Map<number, Id>();
  for (const item of rootSequence(video).items) {
    if (!created.has(item.id) || item.trackId !== trackId) continue;
    const from = startOf(item);
    if (from !== null) out.set(from, item.id);
  }
  return out;
}

/** 实拍片段的内容键：源（路径与文件的大小、修改时间）、入点、长度、画面与声音、转场；时间线上的起点另外比。 */
function clipKey(c: PlanClip, slot: ClipSlot, stamp: string): string {
  // 记哈希不记原文：路径是本机绝对路径，写进记录会让便携包拒绝导出（视频格式规范 §4.6）。
  const key = JSON.stringify({
    path: c.path,
    stamp,
    sourceIn: slot.sourceIn,
    frames: slot.frames,
    fit: c.fit ?? 'cover',
    crop: c.crop ?? null,
    pip: c.pip ?? null,
    audio: c.audio ?? false,
    in: slot.in,
    out: slot.out,
    name: c.name ?? c.id,
  });
  return `sha256:${createHash('sha256').update(key).digest('hex')}`;
}

/** 水印的内容键：图片（路径与文件的大小、修改时间）、长度、位置与放法；时间线上的起点另外比。 */
function watermarkKey(w: PlanWatermark, slot: WatermarkSlot, stamp: string): string {
  const key = JSON.stringify({ path: w.path, stamp, frames: slot.frames, pip: w.pip ?? null, fit: w.fit ?? 'contain', name: w.name ?? w.id });
  return `sha256:${createHash('sha256').update(key).digest('hex')}`;
}

function watermarkItem(w: WatermarkPlan, trackId: Id, assetImportRef: string): Record<string, unknown> {
  return {
    type: 'image',
    trackId,
    assetImportRef,
    name: w.source.name ?? w.source.id,
    role: 'watermark',
    span: { fromFrame: w.slot.from, durationFrames: w.slot.frames },
    place: w.source.pip ? { x: w.source.pip.x, y: w.source.pip.y, w: w.source.pip.w } : {},
    mode: w.source.pip ? 'pip' : 'fullscreen',
    fit: w.source.fit ?? 'contain',
  };
}

function bakeNote(bake: CompositionBakeInfo | null | undefined): BakeNote | null {
  if (!bake) return null;
  return { renderer: bake.renderer, fps: bake.fps, seconds: bake.seconds, ...(bake.fallback ? { fallback: bake.fallback } : {}) };
}

/** 一条角色轨道现在在不在：按给的 ID 或名字、记录里的 ID、缺省名字找，同 `#tracks`。 */
function existingTrack(sequence: Sequence, wanted: string | undefined, recorded: Id | null, fallback: string): Track | undefined {
  if (wanted) return sequence.tracks.find((t) => t.id === wanted) ?? sequence.tracks.find((t) => t.name === wanted);
  return sequence.tracks.find((t) => t.id === recorded) ?? sequence.tracks.find((t) => t.name === fallback);
}

/**
 * 这次要动的东西里锁着的：要删、换包、挪的实例，波纹会挪的（起点不早于最早的边界、任何轨道上），要往里放东西的轨道。
 * 引擎会以 `TARGET_LOCKED` 拒绝它们，但那时前面几笔（甚至前台烘焙）已经做了，所以先查。
 */
function lockedTargets(sequence: Sequence, run: { touched: Id[]; from: number | null; tracks: (Track | undefined)[] }): string[] {
  const tracks = new Map(sequence.tracks.map((t) => [t.id, t]));
  const out: string[] = [];
  const seen = new Set<Id>();
  const lockedTracks = new Set<Id>();
  const check = (item: SequenceItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    const track = tracks.get(item.trackId);
    if (item.locked) out.push(`item ${item.name ?? item.id} (${item.id}) is locked`);
    else if (track?.locked) {
      out.push(`item ${item.name ?? item.id} (${item.id}) is on locked track ${track.name ?? track.id}`);
      lockedTracks.add(track.id);
    }
  };
  const touched = new Set(run.touched);
  for (const item of sequence.items) {
    const from = startOf(item);
    if (touched.has(item.id) || (run.from !== null && from !== null && from >= run.from)) check(item);
  }
  for (const t of run.tracks) if (t?.locked && !lockedTracks.has(t.id)) out.push(`track ${t.name ?? t.id} is locked`);
  return out;
}

/** 文件指纹：大小与修改时间（大的实拍文件不读内容）。 */
async function fileStamp(file: string, confine: string | null, what: string): Promise<string> {
  const stat = await fs.stat(await confined(file, confine, what));
  return `${stat.size}:${Math.round(stat.mtimeMs)}`;
}

function footageItem(c: ClipPlan, trackId: Id, assetImportRef: string): Record<string, unknown> {
  const image = isImagePath(c.source.path);
  const audio = c.source.audio;
  return {
    type: image ? 'image' : 'video',
    trackId,
    assetImportRef,
    name: c.source.name ?? c.source.id,
    role: 'broll',
    span: { fromFrame: c.slot.from, durationFrames: c.slot.frames },
    place: c.source.pip ? { x: c.source.pip.x, y: c.source.pip.y, w: c.source.pip.w } : {},
    mode: c.source.pip ? 'pip' : 'fullscreen',
    fit: c.source.fit ?? 'cover',
    ...(c.source.crop ? { crop: c.source.crop } : {}),
    ...(image
      ? {}
      : {
          timeMap: { kind: 'linear', sourceIn: { ticks: String(Math.round(c.slot.sourceIn * 1_000_000)), timescale: 1_000_000 }, rate: { num: 1, den: 1 } },
          embeddedAudio: { enabled: audio !== undefined && audio !== false, volume: typeof audio === 'number' ? audio : 1 },
        }),
  };
}

function transitionOp(side: { rightItemId: Id } | { leftItemId: Id }, t: NonNullable<ClipSlot['in']>): Record<string, unknown> {
  return {
    type: 'setTransition',
    ...side,
    kind: t.kind,
    params: {},
    easing: t.easing,
    duration: { unit: 'frames', value: t.frames },
    alignment: 'exact-frame',
  };
}

/** 最后核对：场景轨上各段的代码画面按计划首尾相接。 */
function checkScenes(video: VideoSnapshot, segments: SegmentPlan[]): { ok: boolean; problems: string[] } {
  const items = new Map(rootSequence(video).items.map((i) => [i.id, i]));
  const problems: string[] = [];
  for (const s of segments) {
    const span = s.sceneItem ? spanOf(items.get(s.sceneItem)) : null;
    if (!span) problems.push(`segment ${s.slot.id}: scene item missing`);
    else if (span.from !== s.slot.from || span.frames !== s.slot.frames) {
      problems.push(`segment ${s.slot.id}: at frame ${span.from} for ${span.frames}, the plan says ${s.slot.from} for ${s.slot.frames}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** 读计划与时间文件；计划里的相对路径对计划文件所在的目录（内联时对工作目录）解析成绝对路径。 */
async function loadPlan(
  args: AssembleArgs,
  base: { cwd: string; confine: string | null },
): Promise<{ plan: Plan; timings: Map<string, Timing | undefined> }> {
  let plan: Plan;
  let dir = base.cwd;
  if (args.planFile !== undefined) {
    const file = resolveUserPath(args.planFile, base.cwd);
    const parsed = planSchema.safeParse(await readJson(file, base.confine, 'planFile'));
    if (!parsed.success) throw new ToolError('INVALID_ARGUMENTS', `planFile ${args.planFile}: ${parsed.error.message}`);
    plan = parsed.data;
    dir = path.dirname(file);
  } else {
    plan = args.plan!;
  }
  const abs = (p: string) => resolveUserPath(p, dir);
  const timings = new Map<string, Timing | undefined>();
  const segments = [];
  for (const s of plan.segments) {
    let timing: Timing | undefined;
    if (typeof s.timing === 'string') {
      const parsed = timingSchema.safeParse(await readJson(abs(s.timing), base.confine, `segment ${s.id} timing`));
      if (!parsed.success) throw new ToolError('INVALID_ARGUMENTS', `segment ${s.id} timing ${s.timing}: ${parsed.error.message}`);
      timing = parsed.data;
    } else {
      timing = s.timing;
    }
    timings.set(s.id, timing);
    segments.push({
      ...s,
      bundle: abs(s.bundle),
      ...(s.narration?.path !== undefined ? { narration: { ...s.narration, path: abs(s.narration.path) } } : {}),
    });
  }
  return {
    plan: {
      ...plan,
      segments,
      ...(plan.clips ? { clips: plan.clips.map((c) => ({ ...c, path: abs(c.path) })) } : {}),
      ...(plan.cards ? { cards: plan.cards.map((c) => ({ ...c, bundle: abs(c.bundle) })) } : {}),
      ...(plan.watermarks ? { watermarks: plan.watermarks.map((w) => ({ ...w, path: abs(w.path) })) } : {}),
    },
    timings,
  };
}

/** 读一个 JSON 文件；对外服务时（`confine`）按真实路径必须在项目里。 */
async function readJson(file: string, confine: string | null, what: string): Promise<unknown> {
  const real = await confined(file, confine, what);
  try {
    return JSON.parse(await fs.readFile(real, 'utf8'));
  } catch (error) {
    throw new ToolError('INVALID_ARGUMENTS', `${what}: cannot read ${file} as JSON (${(error as Error).message})`);
  }
}

async function confined(file: string, confine: string | null, what: string): Promise<string> {
  const real = await fs.realpath(file).catch(() => null);
  if (!real) throw new ToolError('FILE_NOT_FOUND', `${what}: ${file} does not exist`);
  if (confine) {
    const root = await fs.realpath(confine);
    if (real !== root && !real.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) {
      throw new ToolError('PATH_OUTSIDE_PROJECT', `${what}: ${file} is outside the project folder`);
    }
  }
  return real;
}

/** 旁白的键：产物看 ID，文件看内容摘要（换了录音、同名覆盖都算新的）。 */
async function narrationOf(
  narration: { path?: string | undefined; artifactId?: string | undefined },
  confine: string | null,
): Promise<{ key: string; source: { path: string } | { artifactId: string } }> {
  if (narration.artifactId !== undefined) return { key: `artifact:${narration.artifactId}`, source: { artifactId: narration.artifactId } };
  const file = narration.path!;
  const real = await confined(file, confine, 'narration');
  const hash = createHash('sha256').update(await fs.readFile(real)).digest('hex');
  return { key: `sha256:${hash}`, source: { path: file } };
}
