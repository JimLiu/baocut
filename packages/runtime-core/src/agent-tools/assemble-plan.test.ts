import { describe, expect, it } from 'vitest';
import {
  atOf,
  checkPlan,
  cueSeconds,
  frameOf,
  layoutSegments,
  placeCards,
  placeClips,
  planSchema,
  rippleSteps,
  type Plan,
  type PlanClip,
  type Timing,
} from './assemble-plan.ts';
import { ToolError } from './tool-catalog.ts';

const FPS = { num: 30, den: 1 };
const NTSC = { num: 30000, den: 1001 };

const timing: Timing = {
  lines: [
    { text: 'first line', start: 0.2, chars: [0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7] },
    { text: 'second one', start: 2, chars: [2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 2.9, 3] },
  ],
  gaps: [{ clip: 'g', at: 4 }],
};

function clip(over: Partial<PlanClip> & { id: string }): PlanClip {
  return { seg: 'a', path: 'f.mp4', to: 3, ...over } as PlanClip;
}

describe('assemble-plan：秒与帧', () => {
  it('atOf 换回帧时落在同一帧（NTSC 也一样）', () => {
    for (const frame of [0, 1, 1826, 15244, 99999]) {
      expect(frameOf(Number(atOf(frame, FPS)), FPS)).toBe(frame);
      expect(frameOf(Number(atOf(frame, NTSC)), NTSC)).toBe(frame);
    }
  });
});

describe('assemble-plan：计划的一致性', () => {
  const base: Plan = { segments: [{ id: 'a', bundle: 'b/a' }] };

  it('段落 id 重复、片段指向不存在的段、锚点不止一种都拒绝', () => {
    expect(() => checkPlan({ segments: [...base.segments, ...base.segments] })).toThrow(/twice/);
    expect(() => checkPlan({ ...base, clips: [clip({ id: 'x', seg: 'zz', line: 0 })] })).toThrow(/not in plan.segments/);
    expect(() => checkPlan({ ...base, clips: [clip({ id: 'x', line: 0, at: 1 })] })).toThrow(/exactly one anchor/);
    expect(() => checkPlan({ ...base, clips: [clip({ id: 'x' })] })).toThrow(/exactly one anchor/);
    expect(() => checkPlan({ ...base, clips: [clip({ id: 'x', at: 1, cue: 'one' })] })).toThrow(/cue needs line/);
    expect(() => checkPlan({ ...base, clips: [clip({ id: 'x', at: 1, from: 3, to: 3 })] })).toThrow(/must be after/);
    expect(() => checkPlan({ ...base, clips: [clip({ id: 'x', at: 1, path: 'p.png', audio: true })] })).toThrow(/still image/);
    expect(() => checkPlan({ ...base, cards: [{ id: 'c', seg: 'a', bundle: 'c' }] })).toThrow(/exactly one anchor/);
    expect(() =>
      checkPlan({ segments: [{ id: 'a', bundle: 'b', narration: { path: 'a.wav', artifactId: 'sha256:x' } }] }),
    ).toThrow(/exactly one of path and artifactId/);
    expect(() => checkPlan({ ...base, clips: [clip({ id: 'x', line: 0, cue: 'one' })] })).not.toThrow();
  });

  it('schema 接受 timing 为对象或路径，拒绝不认识的字段', () => {
    expect(planSchema.safeParse({ segments: [{ id: 'a', bundle: 'b', timing: 'timing/a.json' }] }).success).toBe(true);
    expect(planSchema.safeParse({ segments: [{ id: 'a', bundle: 'b', timing }] }).success).toBe(true);
    expect(planSchema.safeParse({ segments: [{ id: 'a', bundle: 'b', extra: 1 }] }).success).toBe(false);
    expect(planSchema.safeParse({ segments: [{ id: 'a b', bundle: 'b' }] }).success).toBe(false);
  });
});

describe('assemble-plan：排段与锚点', () => {
  it('段首按帧数累加', () => {
    expect(layoutSegments([{ id: 'a', frames: 90 }, { id: 'b', frames: 45 }, { id: 'c', frames: 1 }])).toEqual([
      { id: 'a', from: 0, frames: 90 },
      { id: 'b', from: 90, frames: 45 },
      { id: 'c', from: 135, frames: 1 },
    ]);
  });

  it('cue 取那几个字开始被说到的时刻，没有 cue 取句首', () => {
    expect(cueSeconds(timing, 'clip x', 'a', 1, undefined)).toBe(2);
    expect(cueSeconds(timing, 'clip x', 'a', 1, 'one')).toBe(2.8);
    expect(() => cueSeconds(timing, 'clip x', 'a', 5, undefined)).toThrow(/line 5 missing/);
    expect(() => cueSeconds(timing, 'clip x', 'a', 0, 'nope')).toThrow(/not in line 0/);
    expect(() => cueSeconds(undefined, 'clip x', 'a', 0, undefined)).toThrow(/has no timing/);
  });
});

describe('assemble-plan：实拍片段', () => {
  const slots = layoutSegments([{ id: 'a', frames: 300 }, { id: 'b', frames: 150 }]);
  const timings = new Map<string, Timing | undefined>([['a', timing], ['b', timing]]);

  it('按句子、cue、gap、follow 与 at 定起点，截在下一个片段或段尾', () => {
    const { clips, warnings } = placeClips(
      [
        clip({ id: 'l', line: 0, from: 10, to: 13 }),
        clip({ id: 'c', line: 1, cue: 'one', to: 10 }),
        clip({ id: 'g', gap: true, from: 1, to: 2 }),
        clip({ id: 'f', follow: true, to: 30 }),
        clip({ id: 'b1', seg: 'b', at: 1, to: 2 }),
      ],
      slots,
      timings,
      FPS,
    );
    expect(clips.map((c) => [c.id, c.from, c.frames, c.sourceIn])).toEqual([
      ['l', 6, 78, 10], // 0.2 s → frame 6; stops at c (2.8 s → 84)
      ['c', 84, 36, 0], // stops at g (4 s → 120)
      ['g', 120, 30, 1], // 1 s long
      ['f', 150, 150, 0], // after g's 1 s; cut at the segment end (300)
      ['b1', 330, 60, 0],
    ]);
    expect(warnings).toEqual([expect.stringContaining('clip f runs 750 frames past the end of a')]);
  });

  it('follow 的第一个片段拒绝；gap 没有留白时拒绝', () => {
    expect(() => placeClips([clip({ id: 'f', follow: true })], slots, timings, FPS)).toThrow(/follows nothing/);
    expect(() => placeClips([clip({ id: 'zz', gap: true })], slots, timings, FPS)).toThrow(/no gap for it/);
  });

  it('转场：与前后片段相接的一侧不做，长度不超过片段的一半', () => {
    const { clips } = placeClips(
      [
        clip({ id: 'x', at: 0, to: 1, in: { kind: 'dissolve' }, out: { kind: 'wipe', dur: 2 } }),
        clip({ id: 'y', at: 1, to: 2, in: { kind: 'dissolve' }, out: { kind: 'iris', easing: 'linear' } }),
        clip({ id: 'z', at: 5, to: 1, in: { kind: 'slide', dur: 0.2 } }),
      ],
      slots,
      timings,
      FPS,
    );
    const [x, y, z] = clips;
    expect(x!.in).toEqual({ kind: 'dissolve', easing: 'ease-in-out', frames: 15 });
    expect(x!.out).toBeNull(); // touches y
    expect(y!.in).toBeNull(); // touches x
    expect(y!.out).toEqual({ kind: 'iris', easing: 'linear', frames: 15 });
    expect(z!.in).toEqual({ kind: 'slide', easing: 'ease-in-out', frames: 6 });
  });

  it('图片的 from 不当入点', () => {
    const { clips } = placeClips([clip({ id: 'p', at: 0, path: 'photo.JPG', from: 2, to: 5 })], slots, timings, FPS);
    expect(clips[0]).toMatchObject({ frames: 90, sourceIn: 0 });
  });
});

describe('assemble-plan：卡片', () => {
  const slots = layoutSegments([{ id: 'a', frames: 300 }]);
  const timings = new Map<string, Timing | undefined>([['a', timing]]);

  it('按字时间放，重叠时拒绝', () => {
    const cards = placeCards(
      [
        { id: 'k2', seg: 'a', at: 5, bundle: 'k2' },
        { id: 'k1', seg: 'a', line: 1, cue: 'one', bundle: 'k1' },
      ],
      slots,
      timings,
      new Map([['k1', 60], ['k2', 30]]),
      FPS,
    );
    expect(cards).toEqual([
      { id: 'k1', seg: 'a', from: 84, frames: 60 },
      { id: 'k2', seg: 'a', from: 150, frames: 30 },
    ]);
    expect(() =>
      placeCards([{ id: 'k1', seg: 'a', at: 0, bundle: 'k1' }, { id: 'k2', seg: 'a', at: 1, bundle: 'k2' }], slots, timings, new Map([['k1', 60], ['k2', 30]]), FPS),
    ).toThrow(ToolError);
  });
});

describe('assemble-plan：波纹推演', () => {
  it('从最后一段往前：变长变短换包带 ripple，中间插入的段先腾位置', () => {
    const slots = layoutSegments([{ id: 'a', frames: 100 }, { id: 'n', frames: 40 }, { id: 'b', frames: 80 }, { id: 'c', frames: 50 }]);
    const placed = new Map([
      ['a', { from: 0, frames: 90 }],
      ['b', { from: 90, frames: 60 }],
      ['c', { from: 150, frames: 50 }],
    ]);
    const { steps, off } = rippleSteps(slots, placed);
    expect(steps).toEqual([
      { kind: 'resize', id: 'b', boundary: 150, delta: 20 },
      { kind: 'insert', id: 'n', boundary: 90, delta: 40 },
      { kind: 'resize', id: 'a', boundary: 90, delta: 10 },
    ]);
    expect(off).toEqual([]);
  });

  it('末尾新增的段不需要腾位置；有空隙或顺序变了时列在 off', () => {
    const slots = layoutSegments([{ id: 'a', frames: 100 }, { id: 'b', frames: 50 }]);
    expect(rippleSteps(slots, new Map([['a', { from: 0, frames: 100 }]]))).toEqual({ steps: [], off: [] });
    expect(rippleSteps(slots, new Map([['b', { from: 120, frames: 50 }], ['a', { from: 0, frames: 100 }]])).off).toEqual([
      'b would sit at frame 120, the plan puts it at 100',
    ]);
    expect(rippleSteps(slots, new Map([['b', { from: 0, frames: 50 }], ['a', { from: 50, frames: 100 }]])).off).toHaveLength(2);
  });
});
