import { describe, expect, it } from 'vitest';
import {
  cameraFaceCount,
  hasCut,
  mainFaces,
  matchSpeakers,
  medianBoxes,
  mouthMotion,
  pickProbes,
  speakerSegments,
  turnsOf,
  type GrayBurst,
  type ProbeMotion,
  type SegmentOptions,
  type SpeakerWord,
} from './speaker-shots.ts';

/** 一个人从 `start` 到 `end` 连着说：每 0.3 秒一个词。 */
function talk(speaker: string, start: number, end: number): SpeakerWord[] {
  const words: SpeakerWord[] = [];
  for (let t = start; t < end - 1e-9; t += 0.3) words.push({ speaker, start: t, end: Math.min(end, t + 0.3) });
  return words;
}

const faces = new Map([
  ['spk_a', 0],
  ['spk_b', 1],
]);
const options = (extra: Partial<SegmentOptions> = {}): SegmentOptions => ({
  start: 0,
  end: 30,
  faces,
  split: true,
  centerFace: 0,
  ...extra,
});
const round = (segments: { start: number; end: number; face: number | null }[]) =>
  segments.map((s) => ({ start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100, face: s.face }));

describe('turnsOf', () => {
  it('同一人相隔不到 0.6 秒的词连成一段话，换人或停得久了另起一段；没分出说话人的词不算', () => {
    const turns = turnsOf([
      { speaker: 'spk_b', start: 5, end: 5.4 },
      { speaker: 'spk_a', start: 0, end: 0.4 },
      { speaker: 'spk_a', start: 0.9, end: 1.2 },
      { speaker: 'spk_a', start: 1.8, end: 2 },
      { speaker: null, start: 3, end: 3.2 },
      { start: 3.5, end: 3.7 },
    ]);
    expect(turns).toEqual([
      { speaker: 'spk_a', start: 0, end: 1.2 },
      { speaker: 'spk_a', start: 1.8, end: 2 },
      { speaker: 'spk_b', start: 5, end: 5.4 },
    ]);
  });
});

describe('pickProbes', () => {
  it('只在连续说了 4 秒以上的话里取，取在 30% 与 60% 处', () => {
    const probes = pickProbes([
      { speaker: 'spk_a', start: 0, end: 10 },
      { speaker: 'spk_b', start: 10, end: 13.9 },
      { speaker: 'spk_b', start: 20, end: 24 },
    ]);
    expect(probes).toEqual([
      { speaker: 'spk_a', at: 3 },
      { speaker: 'spk_a', at: 6 },
      { speaker: 'spk_b', at: 21.2 },
      { speaker: 'spk_b', at: 22.4 },
    ]);
  });

  it('多于上限时在整份转写里均匀挑，首尾都挑得到', () => {
    const turns = Array.from({ length: 100 }, (_, i) => ({ speaker: i % 2 ? 'spk_b' : 'spk_a', start: i * 10, end: i * 10 + 5 }));
    const probes = pickProbes(turns, 48);
    expect(probes).toHaveLength(48);
    expect(probes[0]!.at).toBeLessThan(10);
    expect(probes[47]!.at).toBeGreaterThan(980);
    expect(new Set(probes.map((p) => p.at)).size).toBe(48);
  });
});

describe('mainFaces 与 cameraFaceCount', () => {
  it('主脸不小于最大那张的 1/4、面积不小于 0.001，按中心从左到右', () => {
    const faces = mainFaces([
      { x: 0.6, y: 0.2, w: 0.1, h: 0.18, score: 0.9 },
      { x: 0.2, y: 0.2, w: 0.09, h: 0.16, score: 0.9 },
      { x: 0.45, y: 0.1, w: 0.03, h: 0.05, score: 0.9 },
      { x: 0.9, y: 0.9, w: 0.01, h: 0.01, score: 0.9 },
    ]);
    expect(faces.map((f) => f.x)).toEqual([0.2, 0.6]);
  });

  it('七成以上的取样是同样 2–4 张主脸才是单机位', () => {
    expect(cameraFaceCount([2, 2, 2, 2, 2, 2, 2, 1, 0, 3])).toBe(2);
    expect(cameraFaceCount([2, 2, 2, 2, 2, 2, 1, 1, 0, 3])).toBeNull();
    expect(cameraFaceCount([1, 1, 1, 1, 1, 1, 1, 1, 2, 2])).toBeNull();
    expect(cameraFaceCount([5, 5, 5, 5])).toBeNull();
    expect(cameraFaceCount([])).toBeNull();
  });
});

describe('画面的动静', () => {
  const W = 40;
  const H = 20;
  /** 一帧灰度：底色 `base`，在 `[x0, x1) × [y0, y1)`（像素）里填 `value`。 */
  const frame = (base: number, patch?: { x0: number; x1: number; y0: number; y1: number; value: number }) => {
    const out = new Uint8Array(W * H).fill(base);
    if (patch) for (let y = patch.y0; y < patch.y1; y++) for (let x = patch.x0; x < patch.x1; x++) out[y * W + x] = patch.value;
    return out;
  };
  // 左脸占 x 0–10、y 0–10 像素：嘴部是 x 2–8、y 6.2–10.5。
  const left = { x: 0, y: 0, w: 10 / W, h: 10 / H };
  const right = { x: 20 / W, y: 0, w: 10 / W, h: 10 / H };

  it('只量嘴部那一块，说话那张脸的动静大', () => {
    const mouth = (value: number) => frame(100, { x0: 2, x1: 8, y0: 7, y1: 10, value });
    const burst: GrayBurst = { width: W, height: H, frames: [mouth(100), mouth(160), mouth(100), mouth(160)] };
    expect(mouthMotion(burst, left)).toBeGreaterThan(20);
    expect(mouthMotion(burst, right)).toBe(0);
    expect(hasCut(burst)).toBe(false);
  });

  it('整幅画面突变是一刀', () => {
    expect(hasCut({ width: W, height: H, frames: [frame(40), frame(40), frame(200)] })).toBe(true);
  });

  it('每张脸的框取各取样的中位数', () => {
    const boxes = medianBoxes(
      [
        [
          { x: 0.1, y: 0.2, w: 0.1, h: 0.2 },
          { x: 0.6, y: 0.2, w: 0.1, h: 0.2 },
        ],
        [
          { x: 0.12, y: 0.22, w: 0.1, h: 0.2 },
          { x: 0.62, y: 0.2, w: 0.12, h: 0.2 },
        ],
        [
          { x: 0.5, y: 0.2, w: 0.1, h: 0.2 },
          { x: 0.61, y: 0.2, w: 0.1, h: 0.2 },
        ],
      ],
      2,
    );
    expect(boxes).toEqual([
      { x: 0.12, y: 0.2, w: 0.1, h: 0.2 },
      { x: 0.61, y: 0.2, w: 0.1, h: 0.2 },
    ]);
  });
});

describe('matchSpeakers', () => {
  const rows = (speaker: string, n: number, motion: number[]): ProbeMotion[] => Array.from({ length: n }, () => ({ speaker, motion }));

  it('实测的那张表（§2.5 第 5 条）：主讲对左脸、采访者对右脸，contrast 1.53 与 3.16', () => {
    const result = matchSpeakers([...rows('spk_host', 34, [1.01, 0.66]), ...rows('spk_guest', 6, [0.92, 2.91])], 2, [
      'spk_host',
      'spk_guest',
    ]);
    expect(result.speakers).toEqual([
      { id: 'spk_host', face: 0, probes: 34, contrast: 1.53 },
      { id: 'spk_guest', face: 1, probes: 6, contrast: 3.16 },
    ]);
    expect(result.confidence).toBe(1.53);
  });

  it('单个取样有认错的，按说话人合起来仍对得上；三人三张脸穷举一一对应', () => {
    const noisy = (speaker: string, own: number, n: number): ProbeMotion[] =>
      Array.from({ length: n }, (_, i) => {
        const motion = [1, 1, 1];
        motion[i % 5 === 0 ? (own + 1) % 3 : own] = 4;
        return { speaker, motion };
      });
    const result = matchSpeakers([...noisy('spk_a', 2, 10), ...noisy('spk_b', 0, 10), ...noisy('spk_c', 1, 10)], 3, [
      'spk_a',
      'spk_b',
      'spk_c',
    ]);
    expect(result.speakers.map((s) => s.face)).toEqual([2, 0, 1]);
    expect(result.confidence).toBeGreaterThan(1.25);
  });

  it('取样不到 4 个、contrast 低于 1.25 的说话人认不出；转写里没有取样的说话人也列出来', () => {
    const result = matchSpeakers([...rows('spk_a', 8, [3, 1]), ...rows('spk_b', 8, [1, 1.1]), ...rows('spk_c', 3, [1, 5])], 2, [
      'spk_a',
      'spk_b',
      'spk_c',
      'spk_d',
    ]);
    expect(result.speakers).toEqual([
      { id: 'spk_a', face: 0, probes: 8, contrast: expect.any(Number) },
      { id: 'spk_b', face: null, probes: 8, contrast: expect.any(Number) },
      { id: 'spk_c', face: null, probes: 3, contrast: null },
      { id: 'spk_d', face: null, probes: 0, contrast: null },
    ]);
    expect(result.speakers[1]!.contrast!).toBeLessThan(1.25);
    expect(result.confidence).toBe(result.speakers[0]!.contrast);
  });

  it('一个也认不出时 confidence 为 null', () => {
    const result = matchSpeakers([...rows('spk_a', 8, [1, 1]), ...rows('spk_b', 8, [1, 1])], 2, ['spk_a', 'spk_b']);
    expect(result.speakers.every((s) => s.face === null)).toBe(true);
    expect(result.confidence).toBeNull();
  });
});

describe('speakerSegments（§2.3 的规则）', () => {
  it('超过 1.5 秒的停顿分屏，不超过的并进前一段话；段首尾相接盖满区间', () => {
    expect(round(speakerSegments([...talk('spk_a', 0, 6), ...talk('spk_b', 10, 16)], options({ end: 16 })))).toEqual([
      { start: 0, end: 6, face: 0 },
      { start: 6, end: 10, face: null },
      { start: 10, end: 16, face: 1 },
    ]);
    expect(round(speakerSegments([...talk('spk_a', 0, 6), ...talk('spk_b', 7.2, 13)], options({ end: 13 })))).toEqual([
      { start: 0, end: 7.2, face: 0 },
      { start: 7.2, end: 13, face: 1 },
    ]);
  });

  it('区间开头、结尾的停顿：不超过 1.5 秒并进相邻的话，超过的分屏', () => {
    expect(round(speakerSegments(talk('spk_a', 1, 10), options({ end: 15 })))).toEqual([
      { start: 0, end: 10, face: 0 },
      { start: 10, end: 15, face: null },
    ]);
  });

  it('2 秒内交替说的一串合成一段分屏', () => {
    const words = [
      ...talk('spk_a', 0, 6),
      ...talk('spk_b', 6.1, 7.6),
      ...talk('spk_a', 7.7, 9.2),
      ...talk('spk_b', 9.3, 10.8),
      ...talk('spk_a', 10.9, 17),
    ];
    expect(round(speakerSegments(words, options({ end: 17 })))).toEqual([
      { start: 0, end: 6.1, face: 0 },
      { start: 6.1, end: 10.9, face: null },
      { start: 10.9, end: 17, face: 0 },
    ]);
  });

  it('短于 1.5 秒的插话不换人；在最前面时并进后一段', () => {
    const words = [...talk('spk_a', 0, 8), ...talk('spk_b', 8.1, 9), ...talk('spk_a', 9.1, 15)];
    expect(round(speakerSegments(words, options({ end: 15 })))).toEqual([{ start: 0, end: 15, face: 0 }]);
    const leading = [...talk('spk_b', 0, 0.9), ...talk('spk_a', 1, 8), ...talk('spk_b', 8.1, 14)];
    expect(round(speakerSegments(leading, options({ end: 14 })))).toEqual([
      { start: 0, end: 8.1, face: 0 },
      { start: 8.1, end: 14, face: 1 },
    ]);
  });

  it('认不出的说话人说话的那几段分屏', () => {
    const words = [...talk('spk_a', 0, 6), ...talk('spk_c', 6.1, 12), ...talk('spk_a', 12.1, 18)];
    expect(round(speakerSegments(words, options({ end: 18 })))).toEqual([
      { start: 0, end: 6.1, face: 0 },
      { start: 6.1, end: 12.1, face: null },
      { start: 12.1, end: 18, face: 0 },
    ]);
  });

  it('短于 3 秒的段有分屏的邻段时并进分屏段，否则并进较长的邻段；每段都不短于 3 秒', () => {
    const intoSplit = [...talk('spk_a', 0, 6), ...talk('spk_b', 6.1, 8.2), ...talk('spk_a', 12, 18)];
    expect(round(speakerSegments(intoSplit, options({ end: 18 })))).toEqual([
      { start: 0, end: 6.1, face: 0 },
      { start: 6.1, end: 12, face: null },
      { start: 12, end: 18, face: 0 },
    ]);
    const intoLonger = [...talk('spk_a', 0, 4), ...talk('spk_b', 4.1, 6), ...talk('spk_a', 6.1, 7.9), ...talk('spk_b', 8, 20)];
    const segments = speakerSegments(intoLonger, options({ end: 20 }));
    expect(segments.every((s) => s.end - s.start >= 3)).toBe(true);
    expect(segments[0]!.start).toBe(0);
    expect(segments[segments.length - 1]!.end).toBe(20);
    for (let i = 1; i < segments.length; i++) expect(segments[i]!.start).toBe(segments[i - 1]!.end);
  });

  it('整段本来就短于 3 秒时只有一段', () => {
    expect(speakerSegments([...talk('spk_a', 0, 1), ...talk('spk_b', 1.1, 2.4)], options({ end: 2.5 }))).toHaveLength(1);
  });

  it('关掉分屏时，该分屏的段留在前一个人身上（在最前面时用后一段的人），谁也认不出时对准离中心最近的脸', () => {
    const paused = [...talk('spk_a', 0, 6), ...talk('spk_b', 10, 16)];
    expect(round(speakerSegments(paused, options({ end: 16, split: false })))).toEqual([
      { start: 0, end: 10, face: 0 },
      { start: 10, end: 16, face: 1 },
    ]);
    const unknown = [...talk('spk_a', 0, 6), ...talk('spk_c', 6.1, 12), ...talk('spk_a', 12.1, 18)];
    expect(round(speakerSegments(unknown, options({ end: 18, split: false })))).toEqual([{ start: 0, end: 18, face: 0 }]);
    expect(round(speakerSegments(talk('spk_b', 5, 12), options({ end: 12, split: false })))).toEqual([{ start: 0, end: 12, face: 1 }]);
    expect(round(speakerSegments(talk('spk_c', 0, 12), options({ end: 12, split: false, centerFace: 1 })))).toEqual([
      { start: 0, end: 12, face: 1 },
    ]);
    expect(speakerSegments([], options({ end: 12, split: false, centerFace: 1 }))).toEqual([{ start: 0, end: 12, face: 1 }]);
  });

  it('区间外的词截掉，区间里没有词时整段分屏', () => {
    const words = [...talk('spk_a', 0, 20), ...talk('spk_b', 20.1, 40)];
    expect(round(speakerSegments(words, options({ start: 10, end: 30 })))).toEqual([
      { start: 10, end: 20.1, face: 0 },
      { start: 20.1, end: 30, face: 1 },
    ]);
    expect(speakerSegments([], options({ end: 12 }))).toEqual([{ start: 0, end: 12, face: null }]);
  });
});
