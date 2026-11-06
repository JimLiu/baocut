import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { align, mouthLadder, run } from '../skills/baocut/built-in-skills/virtual-host/scripts/host-pack.mjs';
import { writePng } from '../skills/baocut/built-in-skills/virtual-host/scripts/image-io.mjs';
import { buildTrack, facesOf, fineTimeline, levelsOf, quantize, STEP, unitsFromWords } from '../skills/baocut/built-in-skills/virtual-host/scripts/lipsync.mjs';
import { planLabel, planText, splitSyllable } from '../skills/baocut/built-in-skills/virtual-host/scripts/visemes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'skills/baocut/built-in-skills/virtual-host');

const tmpDirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-host-'));
  tmpDirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

type Unit = { text: string; reading: string; plan: unknown; kind: string; t0: number; t1: number };
const spoken = (text: string, lang: string, readings: Record<string, string> | null = null) =>
  (planText(text, lang, readings) as Unit[]).filter((u) => u.plan !== undefined && /[\p{L}\p{N}]/u.test(u.text));
const labels = (text: string, lang: string, readings: Record<string, string> | null = null) =>
  spoken(text, lang, readings).map((u) => `${u.text}:${u.reading}:${planLabel(u.plan)}`);

describe('virtual-host visemes', () => {
  it('reads Mandarin syllables into closed, rounded and open shapes', () => {
    expect(splitSyllable('wo')).toEqual(['', 'uo']);
    expect(labels('我是宝玉', 'zh-CN')).toEqual(['我:wo:F·E', '是:shi:B', '宝:bao:A·D·E', '玉:yu:F']);
  });

  it('picks the reading of a polyphone from its phrase', () => {
    expect(labels('我去银行', 'zh-CN')).toContain('行:hang:B·D');
  });

  it('applies a readings table to kanji, brand names and Chinese words', () => {
    expect(labels('今日は天気', 'ja', { 今日: 'きょう', 天気: 'てんき' })).toEqual(['今日:きょう:B·E·F', 'は:は:B·D', '天気:てんき:B·C·B']);
    expect(labels('欢迎 BaoCut', 'zh-CN', { BaoCut: 'bao cut' })).toContain('BaoCut:bao cut:A·D·E·B·C·B');
    // same syllable count as characters: one reading per character
    expect(labels('行长', 'zh-CN', { 行长: 'hang zhang' })).toEqual(['行:hang:B·D', '长:zhang:B·D']);
  });

  it('reads kana, hangul and English, and leaves other scripts to loudness', () => {
    expect(labels('안녕', 'ko')).toEqual(['안:안:D', '녕:녕:B·C']);
    expect(labels('hello world', 'en')).toEqual(['hello:hello:B·C·B·E', 'world:world:F·E·B']);
    expect(labels('привет', 'ru')).toEqual(['привет:привет:?']);
  });
});

describe('virtual-host lip sync', () => {
  const words = {
    timescale: 1_000_000,
    segments: [
      {
        text: '大家好我是',
        words: [
          { text: '大', start: 0, end: 160_000 },
          { text: '家', start: 160_000, end: 320_000 },
          { text: '好', start: 320_000, end: 640_000 },
          { text: '我', start: 1_280_000, end: 1_280_100 },
          { text: '是', start: 1_280_100, end: 1_520_000 },
        ],
      },
    ],
  };

  it('gives words the aligner collapsed to zero length a share of the next word', () => {
    const units = unitsFromWords(words, 'zh-CN') as Unit[];
    const wo = units.find((u) => u.text === '我')!, shi = units.find((u) => u.text === '是')!;
    expect(wo.t0).toBeCloseTo(1.28, 3);
    expect(wo.t1 - wo.t0).toBeGreaterThan(0.08);
    expect(shi.t0).toBeCloseTo(wo.t1, 6);
    expect(shi.t1).toBeCloseTo(1.52, 3);
  });

  it('keeps a short closed-lip run and holds every other shape at least two frames', () => {
    const fine = [...Array(20).fill('D'), 'A', 'A', 'A', ...Array(20).fill('D'), 'B', ...Array(20).fill('C')];
    const frames = quantize(fine, 30, Math.ceil((fine.length * STEP) * 30)) as string[];
    expect(frames).toContain('A');
    const runs: [string, number][] = [];
    for (const s of frames) {
      if (runs.length && runs[runs.length - 1][0] === s) runs[runs.length - 1][1]++;
      else runs.push([s, 1]);
    }
    for (const [s, n] of runs) if (s !== 'A') expect(n).toBeGreaterThanOrEqual(2);
  });

  const frameString = (fine: string[], fps = 30) => (quantize(fine, fps, Math.ceil(fine.length * STEP * fps)) as string[]).join('');
  const runsOf = (frames: string) => frames.match(/(.)\1*/g)!;

  it('opens the mouth as wide as the voice is loud, without flicker at a threshold', () => {
    // one long "a" (plan D): quiet, medium, then loud
    const units = [{ t0: 0.03, t1: 1.23, line: 0, plan: [{ shape: 'D', w: 1, kind: 'v' }] }];
    const env = Float32Array.from({ length: 130 }, (_, i) => (i < 40 ? 0.1 : i < 80 ? 0.35 : 0.8));
    const { fine } = fineTimeline(units, 130, env, null) as { fine: string[] };
    expect(fine.slice(5, 35).every((s) => s === 'B')).toBe(true);
    expect(fine.slice(45, 75).every((s) => s === 'C')).toBe(true);
    expect(fine.slice(85, 115).every((s) => s === 'D')).toBe(true);
    // loudness wobbling around the first threshold stays on one level
    expect([...levelsOf([0.1, 0.26, 0.24, 0.26, 0.24, 0.3], 6)]).toEqual([0, 0, 0, 0, 0, 1]);
    expect([...levelsOf([0.6, 0.49, 0.51, 0.47, 0.2], 5)]).toEqual([2, 2, 2, 1, 0]);
  });

  it('keeps a short closure between two open syllables by borrowing frames from them', () => {
    // a 40 ms "B" between two "D": too short for two frames, but it is the only close between the syllables
    const frames = frameString([...Array(12).fill('D'), ...Array(4).fill('B'), ...Array(12).fill('D')]);
    expect(frames).toMatch(/^D{2,}BBD{2,}$/);
  });

  it('adds a one-frame tween across a big jump, taken from the more open side', () => {
    expect(frameString([...Array(30).fill('X'), ...Array(30).fill('D')])).toMatch(/^X{9}CD{8}$/);
    expect(frameString([...Array(30).fill('D'), ...Array(30).fill('F')])).toMatch(/^D{8}EF{9}$/);
    // no tween when a side is only as long as the minimum hold
    expect(frameString([...Array(7).fill('X'), ...Array(30).fill('D')])).toMatch(/^X{2}D+$/);
  });

  it('holds shapes for 55 ms at any frame rate', () => {
    const fine = [...Array(20).fill('D'), ...Array(5).fill('B'), ...Array(20).fill('C'), ...Array(4).fill('E'), ...Array(20).fill('X')];
    for (const run of runsOf(frameString(fine, 60))) if (run[0] !== 'A') expect(run.length).toBeGreaterThanOrEqual(4);
  });

  it('builds the same track from the same input and seed', () => {
    const units = unitsFromWords(words, 'zh-CN');
    const a = buildTrack({ units, dur: 2, seed: 1 }).track;
    const b = buildTrack({ units, dur: 2, seed: 1 }).track;
    const c = buildTrack({ units, dur: 2, seed: 2 }).track;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(c.mouth).toEqual(a.mouth);
    expect(a.mouth[0]).toEqual([0, expect.any(String)]);
    expect(a.mouth.at(-1)![1]).toBe('X');
    const shifted = buildTrack({ units, dur: 2, seed: 1, offset: 5 }).track;
    expect(shifted.mouth.map(([t]: [number]) => +(t - 5).toFixed(4))).toEqual(a.mouth.map(([t]: [number]) => t));
  });

  it('turns faces.json lines into spans around the spoken words', () => {
    const units = unitsFromWords(words, 'zh-CN');
    const { def, list } = facesOf({ default: 'calm', items: [{ line: 1, face: 'smile' }] }, units);
    expect(def).toBe('calm');
    expect(list).toHaveLength(1);
    expect(list[0][2]).toBe('smile');
    expect(list[0][0]).toBe(0);
    expect(list[0][1]).toBeCloseTo(1.82, 2);
    expect(() => facesOf([{ line: 3, face: 'smile' }], units)).toThrow(/no spoken text/);
  });
});

// A bust on chroma green: shirt, face, two eyes and a closed mouth.
const GREEN = [0, 177, 64];
type Rect = [x: number, y: number, w: number, h: number, color: number[]];
function paint(rects: Rect[], dx = 0, dy = 0, background: number[] | null = GREEN) {
  const w = 320, h = 320, d = new Uint8ClampedArray(w * h * 4);
  if (background) for (let p = 0; p < w * h; p++) d.set([...background, 255], p * 4);
  for (const [x, y, rw, rh, c] of rects) {
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) {
      const X = i + dx, Y = j + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h) d.set([...c, 255], (Y * w + X) * 4);
    }
  }
  return { w, h, d };
}
const DARK = [30, 24, 28], RED = [200, 60, 70];
const bust: Rect[] = [[40, 200, 240, 120, [60, 90, 200]], [90, 40, 140, 170, [244, 200, 170]]];
const eyesOpen: Rect[] = [[120, 100, 16, 16, DARK], [184, 100, 16, 16, DARK]];
const eyesShut: Rect[] = [[120, 106, 16, 4, DARK], [184, 106, 16, 4, DARK]];
const mouthRest: Rect[] = [[140, 160, 40, 6, RED]];
const portrait = (eyes = eyesOpen, mouth = mouthRest, dx = 0, dy = 0, background: number[] | null = GREEN) => paint([...bust, ...eyes, ...mouth], dx, dy, background);

describe('virtual-host pack', () => {
  it('aligns a shifted edit and leaves an in-place edit where it is', () => {
    // align() runs on keyed (transparent) images
    const base = portrait(eyesOpen, mouthRest, 0, 0, null);
    expect(align(base, portrait(eyesOpen, mouthRest, 6, -4, null))).toMatchObject({ s: 1, dx: 6, dy: -4 });
    expect(align(base, portrait(eyesOpen, [[140, 152, 40, 26, DARK]], 0, 0, null))).toMatchObject({ s: 1, dx: 0, dy: 0 });
  });

  it('cuts one patch box per group and writes host-data.js', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'art'));
    writePng(path.join(dir, 'art/portrait.png'), portrait());
    writePng(path.join(dir, 'art/mouth-A.png'), portrait(eyesOpen, [[138, 161, 44, 4, DARK]]));
    writePng(path.join(dir, 'art/mouth-D.png'), portrait(eyesOpen, [[140, 152, 40, 26, DARK], [146, 168, 28, 8, RED]]));
    writePng(path.join(dir, 'art/eyes-closed.png'), portrait(eyesShut));
    const manifest = path.join(dir, 'host.json');
    fs.writeFileSync(manifest, JSON.stringify({ base: 'art/portrait.png', variants: { mouth: { A: 'art/mouth-A.png', D: 'art/mouth-D.png' }, eyes: { closed: 'art/eyes-closed.png' } } }));
    const { data, report } = run(manifest);
    expect(report.variants.map((v: { name: string; ok: boolean }) => [v.name, v.ok])).toEqual([['mouth-A', true], ['mouth-D', true], ['eyes-closed', true]]);
    // the mouth box covers every mouth edit (portrait pixels) and stays clear of the eyes
    const [mx, my, mw, mh] = report.groups.mouth.box;
    expect(mx).toBeLessThanOrEqual(138);
    expect(mx + mw).toBeGreaterThanOrEqual(182);
    expect(my).toBeLessThanOrEqual(152);
    expect(my + mh).toBeGreaterThanOrEqual(178);
    const [, ey, , eh] = report.groups.eyes.box;
    expect(ey + eh).toBeLessThanOrEqual(my);
    // both mouth patches share the group box; the base is cropped to the figure
    expect(data.mouth.A).toMatchObject({ x: data.boxes.mouth[0], y: data.boxes.mouth[1], w: mw, h: mh });
    expect(data.mouth.D.src).toBe('pack/mouth-D.png');
    expect(data.w).toBeLessThan(320);
    const js = fs.readFileSync(path.join(dir, 'pack/host-data.js'), 'utf8');
    expect(js).toMatch(/^\/\/ virtual host pack/);
    expect(js).toContain('window.HOST_PACK = {');
    for (const f of ['base.png', 'mouth-A.png', 'mouth-D.png', 'eyes-closed.png', 'proof.png', 'pack-report.json']) expect(fs.existsSync(path.join(dir, 'pack', f))).toBe(true);
  });

  it('measures the mouths and warns when they do not open in steps', () => {
    const ok = { B: { w: 120, h: 20, area: 1800 }, C: { w: 110, h: 46, area: 4000 }, D: { w: 130, h: 78, area: 8000 }, E: { w: 54, h: 70, area: 3000 }, F: { w: 64, h: 52, area: 2600 } };
    expect(mouthLadder(ok)).toEqual([]);
    const flat = mouthLadder({ ...ok, C: { w: 110, h: 21, area: 2000 }, F: { w: 60, h: 80, area: 3800 } });
    expect(flat.join('\n')).toMatch(/C opens barely more than B/);
    expect(flat.join('\n')).toMatch(/F is not smaller than E/);
    expect(mouthLadder({ ...ok, D: { w: 130, h: 120, area: 12000 } }).join('\n')).toMatch(/a laugh/);
  });

  it('splits the head from the body at the neck, and leaves a figure without a neck whole', () => {
    // face, a narrow neck, then shoulders
    const necked: Rect[] = [[90, 40, 140, 160, [244, 200, 170]], [140, 200, 40, 40, [236, 190, 160]], [40, 240, 240, 80, [60, 90, 200]]];
    const figure = (mouth: Rect[]) => paint([...necked, ...eyesOpen, ...mouth]);
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'art'));
    writePng(path.join(dir, 'art/portrait.png'), figure(mouthRest));
    writePng(path.join(dir, 'art/mouth-A.png'), figure([[138, 161, 44, 4, DARK]]));
    writePng(path.join(dir, 'art/mouth-D.png'), figure([[140, 152, 40, 26, DARK], [146, 168, 28, 8, RED]]));
    const manifest = path.join(dir, 'host.json');
    fs.writeFileSync(manifest, JSON.stringify({ base: 'art/portrait.png', variants: { mouth: { A: 'art/mouth-A.png', D: 'art/mouth-D.png' } } }));
    const { data, report } = run(manifest);
    expect(report.rig.neck).toEqual([200, 239]);
    expect(report.mouthSizes.D.h).toBeGreaterThan(report.mouthSizes.A.h);
    // pack pixels: the base is cropped to the figure
    const top = data.rig.neck[0];
    expect(data.rig.neck[1] - top).toBe(39);
    expect(data.rig.pivot[1]).toBe(data.rig.neck[1]);
    expect(data.rig.head.y + data.rig.head.h).toBeLessThanOrEqual(data.rig.neck[1] + 1);
    expect(data.rig.body).toBe('pack/body.png');
    for (const f of ['head.png', 'body.png']) expect(fs.existsSync(path.join(dir, 'pack', f))).toBe(true);

    // the old bust has no neck: the shirt is wider than the face right below the mouth
    fs.writeFileSync(manifest, JSON.stringify({ base: 'art/portrait.png', variants: { mouth: { A: 'art/mouth-A.png' } }, out: 'pack-off', neck: false }));
    const off = run(manifest);
    expect(off.report.rig.reason).toMatch(/neck: false/);
    expect(off.data.rig).toBeUndefined();
  });

  it('refuses mouth names that are not shapes or expressions', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'host.json'), JSON.stringify({ base: 'p.png', variants: { mouth: { a: 'x.png' } } }));
    expect(() => run(path.join(dir, 'host.json'))).toThrow(/A–G/);
  });
});

describe('virtual-host host-kit', () => {
  type Call = [string, ...unknown[]];
  function load() {
    class FakeImage {
      src = '';
      decode() {
        return Promise.resolve();
      }
    }
    const warnings: string[] = [];
    const window: Record<string, unknown> = {};
    const context = vm.createContext({ window, Image: FakeImage, console: { warn: (m: string) => warnings.push(m) }, document: { querySelector: () => null } });
    vm.runInContext(fs.readFileSync(path.join(skill, 'host-kit/host-kit.js'), 'utf8'), context);
    return { HostKit: window.HostKit as { host: (...a: unknown[]) => Host }, warnings };
  }
  type Host = { draw: (ctx: unknown, t: number, d?: object) => string; blinkAt: (t: number) => number; shapeAt: (t: number) => string };
  const patch = (name: string) => ({ src: `pack/${name}.png`, x: 10, y: 20, w: 30, h: 10 });
  const pack = { version: 1, w: 200, h: 300, base: 'pack/base.png', mouth: { A: patch('mouth-A'), B: patch('mouth-B'), D: patch('mouth-D'), smile: patch('mouth-smile') }, eyes: { half: patch('eyes-half'), closed: patch('eyes-closed') }, face: { smile: patch('face-smile') } };
  const track = { version: 1, fps: 30, dur: 3, offset: 0, mouth: [[0, 'D'], [0.5, 'G'], [1, 'A'], [1.5, 'X']], blinks: [2], nods: [[0, 1]], turns: [[0, 1.5, 0.5, 0]], faces: [[2.5, 3, 'smile'], [1.6, 1.8, 'wink']] };
  function fakeCtx() {
    const calls: Call[] = [];
    const record = (name: string) => (...args: unknown[]) => calls.push([name, ...args]);
    return { calls, canvas: { width: 1920, height: 1080 }, globalAlpha: 1, save: record('save'), restore: record('restore'), translate: record('translate'), rotate: record('rotate'), scale: record('scale'), drawImage: (im: { src: string }, ...args: unknown[]) => calls.push(['drawImage', im.src, ...args]) };
  }
  const drawn = (ctx: ReturnType<typeof fakeCtx>) => ctx.calls.filter((c) => c[0] === 'drawImage').map((c) => c[1]);

  it('draws the mouth of the track and borrows the nearest shape when one is missing', () => {
    const { HostKit } = load();
    const host = HostKit.host(pack, track);
    let ctx = fakeCtx();
    expect(host.draw(ctx, 0.2)).toBe('D');
    expect(drawn(ctx)).toEqual(['./pack/base.png', './pack/mouth-D.png']);
    ctx = fakeCtx();
    expect(host.draw(ctx, 0.7)).toBe('B'); // no G patch: G falls back to B
    expect(drawn(ctx)).toContain('./pack/mouth-B.png');
    ctx = fakeCtx();
    expect(host.draw(ctx, 1.55)).toBe('X');
    expect(drawn(ctx)).toEqual(['./pack/base.png']);
  });

  it('blinks at the track times, uses the expression mouth at rest, and is deterministic', () => {
    const { HostKit, warnings } = load();
    const host = HostKit.host(pack, track);
    // the lid closes in about 67 ms, stays shut to 100 ms and opens more slowly
    expect([2.01, 2.05, 2.08, 2.12, 2.16, 2.25].map((t) => host.blinkAt(t))).toEqual([0, 1, 2, 1, 1, 0]);
    let ctx = fakeCtx();
    host.draw(ctx, 2.08);
    expect(drawn(ctx)).toContain('./pack/eyes-closed.png');
    // expressions keep their eyes open, so the blink goes on top of them
    ctx = fakeCtx();
    host.draw(ctx, 2.08, { face: 'smile' });
    expect(drawn(ctx)).toEqual(['./pack/base.png', './pack/face-smile.png', './pack/eyes-closed.png', './pack/mouth-smile.png']);
    ctx = fakeCtx();
    host.draw(ctx, 2.8);
    expect(drawn(ctx)).toEqual(['./pack/base.png', './pack/face-smile.png', './pack/mouth-smile.png']);
    const a = fakeCtx(), b = fakeCtx();
    host.draw(a, 0.9);
    host.draw(b, 0.9);
    expect(a.calls).toEqual(b.calls);
    host.draw(fakeCtx(), 1.7);
    expect(warnings).toEqual(['host: no face or mouth patch named wink; drawing the plain face']);
  });

  it('nods and turns only the head when the pack has a head and body', () => {
    const { HostKit } = load();
    const rigged = { ...pack, rig: { body: 'pack/body.png', head: { src: 'pack/head.png', x: 40, y: 0, w: 120, h: 200 }, neck: [180, 200], pivot: [100, 200] } };
    const still = { ...track, nods: [] };
    const draws = (p: object, tr: object, t: number, o = {}) => {
      const ctx = fakeCtx();
      HostKit.host(p, tr, o).draw(ctx, t);
      return ctx.calls;
    };
    const bodyCalls = (calls: Call[]) => calls.slice(0, calls.findIndex((c) => c[0] === 'drawImage' && c[1] === './pack/body.png') + 1);
    const nodding = draws(rigged, track, 0.12), resting = draws(rigged, still, 0.12);
    expect(nodding.some((c) => c[1] === './pack/base.png')).toBe(false);
    // the body is drawn the same whether or not the head nods; the head is not
    expect(bodyCalls(nodding)).toEqual(bodyCalls(resting));
    expect(bodyCalls(nodding).length).toBeGreaterThan(0);
    expect(nodding).not.toEqual(resting);
    // the head above the neck is one draw, the neck is cut into 2-pixel strips (plus one row of overlap)
    const head = nodding.filter((c) => c[1] === './pack/head.png');
    expect(head).toHaveLength(1 + 10);
    expect(head[0].slice(2)).toEqual([0, 0, 120, 181, 40, 0, 120, 181]);
    expect(head[1].slice(2)).toEqual([0, 180, 120, 3, 40, 180, 120, 3]);
    // rig: false draws the whole figure as one picture again
    expect(draws(rigged, track, 0.12, { rig: false }).filter((c) => c[0] === 'drawImage').map((c) => c[1])[0]).toBe('./pack/base.png');
  });
});
