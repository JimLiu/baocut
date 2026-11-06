import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { align, run } from '../skills/baocut/built-in-skills/virtual-host/scripts/host-pack.mjs';
import { writePng } from '../skills/baocut/built-in-skills/virtual-host/scripts/image-io.mjs';
import { buildTrack, facesOf, quantize, STEP, unitsFromWords } from '../skills/baocut/built-in-skills/virtual-host/scripts/lipsync.mjs';
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
    return { calls, canvas: { width: 1920, height: 1080 }, globalAlpha: 1, save: record('save'), restore: record('restore'), translate: record('translate'), rotate: record('rotate'), scale: record('scale'), drawImage: (im: { src: string }) => calls.push(['drawImage', im.src]) };
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
    expect(host.blinkAt(2.01)).toBe(1);
    expect(host.blinkAt(2.08)).toBe(2);
    expect(host.blinkAt(2.25)).toBe(0);
    let ctx = fakeCtx();
    host.draw(ctx, 2.08);
    expect(drawn(ctx)).toContain('./pack/eyes-closed.png');
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
});
