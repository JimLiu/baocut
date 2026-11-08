import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ACTS, actAt, buildTrack, facesOf, fineTimeline, levelsOf, MOUTH, OPEN_RANGE, quantize, STEP, TRACK_FPS, unitsFromWords } from '../skills/baocut/built-in-skills/virtual-host/scripts/lipsync.mjs';
import { readPng, writePng } from '../skills/baocut/built-in-skills/virtual-host/scripts/puppet/png.mjs';
import { keyOut } from '../skills/baocut/built-in-skills/virtual-host/scripts/puppet/seg.mjs';
import { smoothFill, strandFill } from '../skills/baocut/built-in-skills/virtual-host/scripts/puppet/fill.mjs';
import { expressionEyeRegions, cutExpressionEyes } from '../skills/baocut/built-in-skills/virtual-host/scripts/puppet/expreyes.mjs';
import { browAcross, redrawnBrows } from '../skills/baocut/built-in-skills/virtual-host/scripts/puppet/brows.mjs';
import { faceZone } from '../skills/baocut/built-in-skills/virtual-host/scripts/puppet/partmap.mjs';
import { zipNames } from '../skills/baocut/built-in-skills/virtual-host/scripts/puppet/zip.mjs';
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

  type Track = { format: string; version: number; fps: number; duration: number; params: Record<string, number[]>; offsets?: Record<string, number[]>; expressions?: Record<string, number[]> };
  type Built = { track: Track; shapes: string[] };
  const at = (a: number[], k: number) => a[Math.min(k, a.length - 1)];

  it('writes a 120 fps puppet track whose mouth follows the shapes', () => {
    const units = unitsFromWords(words, 'zh-CN');
    const { track, shapes } = buildTrack({ units, dur: 2, seed: 1 }) as Built;
    expect(track).toMatchObject({ format: 'baocut-puppet-track', version: 1, fps: TRACK_FPS, duration: 2 });
    // the track sets only the mouth; the head, body and brows are offsets on top of the player's idle motion
    expect(Object.keys(track.params).sort()).toEqual(['mouthOpen', 'vowel']);
    expect(Object.keys(track.offsets!).every((k) => ['angleX', 'angleY', 'angleZ', 'bodyX', 'browLY', 'browRY'].includes(k))).toBe(true);
    for (const ch of [...Object.values(track.params), ...Object.values(track.offsets!)]) {
      expect(ch.length).toBeGreaterThan(0);
      expect(ch.length).toBeLessThanOrEqual(Math.ceil(track.duration * track.fps) + 1);
    }
    expect(shapes).toHaveLength(Math.floor(2 * TRACK_FPS) + 1);
    // every step draws the mouth of its shape: closed lips shut, rounded lips pull the vowel to "round"
    for (let k = 0; k < shapes.length; k++) {
      const [open, vowel] = MOUTH[shapes[k] as keyof typeof MOUTH];
      expect([at(track.params.mouthOpen, k), at(track.params.vowel, k)]).toEqual([open, vowel]);
    }
    expect(shapes.some((s) => s === 'E' || s === 'F')).toBe(true); // 我 wo
    expect(shapes.at(-1)).toBe('X');
    expect(Math.max(...track.offsets!.angleY.map(Math.abs))).toBeLessThan(30);
  });

  it('lets the voice set how far each shape opens, and opens the mouth on a loud syllable the words left out', () => {
    // 大 at 0.1–0.4 s with the voice rising and falling through it; then a loud syllable at 0.6–0.75 s with no word
    const da = { timescale: 1000, segments: [{ text: '大', words: [{ text: '大', start: 100, end: 400 }] }] };
    const env = Float32Array.from({ length: 101 }, (_, i) => (i >= 10 && i < 40 ? Math.sin(((i - 10) / 30) * Math.PI) : i >= 60 && i < 75 ? 0.8 : 0));
    const { track, shapes } = buildTrack({ units: unitsFromWords(da, 'zh-CN'), env, dur: 1 }) as Built;
    const open = (t: number) => at(track.params.mouthOpen, Math.round(t * TRACK_FPS));
    for (let k = 0; k < shapes.length; k++) {
      const [lo, hi] = OPEN_RANGE[shapes[k] as keyof typeof OPEN_RANGE];
      expect(at(track.params.mouthOpen, k)).toBeGreaterThanOrEqual(lo);
      expect(at(track.params.mouthOpen, k)).toBeLessThanOrEqual(hi);
    }
    // inside the syllable the mouth follows the voice instead of holding one value
    expect(open(0.25)).toBeGreaterThan(0.8);
    expect(open(0.15)).toBeLessThan(open(0.25));
    expect(open(0.35)).toBeLessThan(open(0.25));
    expect(new Set(track.params.mouthOpen.slice(Math.round(0.1 * TRACK_FPS), Math.round(0.4 * TRACK_FPS))).size).toBeGreaterThan(10);
    expect(open(0.5)).toBe(0);
    expect(shapes[Math.round(0.67 * TRACK_FPS)]).not.toBe('X');
    expect(open(0.67)).toBeGreaterThan(0.5);
    expect(open(0.9)).toBe(0);
  });

  it('builds the same track from the same input and seed; the seed moves only the head', () => {
    const units = unitsFromWords(words, 'zh-CN');
    const a = (buildTrack({ units, dur: 2, seed: 1 }) as Built).track;
    const b = (buildTrack({ units, dur: 2, seed: 1 }) as Built).track;
    const c = (buildTrack({ units, dur: 2, seed: 2 }) as Built).track;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(c.params.mouthOpen).toEqual(a.params.mouthOpen);
    expect(c.params.vowel).toEqual(a.params.vowel);
    expect(c.offsets!.angleX).not.toEqual(a.offsets!.angleX);
  });

  // a voice of syllables: 0.6–2.2 s, one every 0.25 s, its loudness rising and falling through each
  const syllables = (from = 0.6, to = 2.2) => Float32Array.from({ length: 401 }, (_, i) => {
    const t = i * STEP;
    return t >= from && t < to ? Math.sin((((t - from) % 0.25) / 0.25) * Math.PI) : 0;
  });

  it('moves the head and brows with the voice the way LivLiv TalkMotion does', () => {
    const { track, nods } = buildTrack({ units: [], env: syllables(), dur: 4, seed: 3 }) as Built & { nods: [number, number][] };
    const o = track.offsets!;
    const span = (ch: string, t0: number, t1: number) => o[ch].slice(Math.round(t0 * TRACK_FPS), Math.round(t1 * TRACK_FPS));
    // the phrase's first syllable nods (a dip of a few degrees within 0.4 s), later ones only some of the time
    expect(nods[0][0]).toBeGreaterThan(0.6);
    expect(nods[0][0]).toBeLessThan(0.75);
    expect(Math.min(...span('angleY', nods[0][0], nods[0][0] + 0.4))).toBeLessThan(-2);
    expect(nods.length).toBeGreaterThan(1);
    expect(nods.length).toBeLessThan(7);
    // nothing moves before the voice; the body turns with the head by 15 %
    expect(span('angleX', 0, 0.6).every((v) => v === 0)).toBe(true);
    for (let k = 0; k < o.bodyX.length; k += 11) expect(Math.abs(o.bodyX[k] - 0.15 * at(o.angleX, k))).toBeLessThan(0.011);
    // no bounce asked: the picture stays where it is
    expect(o.moveY).toBeUndefined();
    const hop = (buildTrack({ units: [], env: syllables(), dur: 4, seed: 3, bounce: true }) as Built).track.offsets!.moveY;
    expect(Math.max(...hop)).toBeLessThanOrEqual(0);
    expect(Math.min(...hop)).toBeCloseTo(-0.02, 3);
    // motion 0: only the mouth
    expect((buildTrack({ units: [], env: syllables(), dur: 4, seed: 3, motion: 0 }) as Built).track.offsets).toBeUndefined();
    expect(() => buildTrack({ units: [], env: syllables(), dur: 4, motion: 3 })).toThrow(/motion must be between 0 and 2/);
  });

  it('closes the lips for b p m', () => {
    const bao = { timescale: 1000, segments: [{ text: '宝宝', words: [{ text: '宝', start: 200, end: 500 }, { text: '宝', start: 500, end: 800 }] }] };
    const { track, shapes } = buildTrack({ units: unitsFromWords(bao, 'zh-CN'), dur: 1.2 }) as Built;
    const closed = shapes.map((s, k) => (s === 'A' ? k : -1)).filter((k) => k >= 0);
    expect(closed.length).toBeGreaterThan(0);
    // one closure inside the second syllable, between the two open vowels
    expect(closed.some((k) => k / TRACK_FPS > 0.45 && k / TRACK_FPS < 0.6)).toBe(true);
    for (const k of closed) expect(at(track.params.mouthOpen, k)).toBe(0);
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
    // the expression is a weight channel that ramps up and back down
    const { track } = buildTrack({ units, dur: 3, faces: [{ line: 1, face: 'smile' }] }) as Built;
    const smile = track.expressions!.smile;
    expect(Math.max(...smile)).toBe(1);
    expect(at(smile, Math.round(2.5 * TRACK_FPS))).toBe(0);
    for (const v of smile) expect(v >= 0 && v <= 1).toBe(true);
  });

  it('hands one expression over to the next in one shared window, never both shown at once', () => {
    // smile, then surprised 0.05 s later, then shy 0.5 s after that, then smile again; calm everywhere else
    const faces = { default: 'calm', items: [{ t0: 0.5, t1: 1.5, face: 'smile' }, { t0: 1.55, t1: 2.5, face: 'surprised' }, { t0: 3, t1: 3.5, face: 'shy' }, { t0: 3.52, t1: 4.2, face: 'smile' }] };
    const { track } = buildTrack({ units: unitsFromWords(words, 'zh-CN'), dur: 5, faces }) as Built;
    const ch = track.expressions!;
    const alpha = (w: number) => { const x = Math.min(1, Math.max(0, (w - 0.3) / 0.4)); return x * x * (3 - 2 * x); };
    for (let k = 0; k <= 5 * TRACK_FPS; k++) {
      const w = Object.values(ch).map(c => at(c, k));
      // the weights add up to one (calm takes the rest), so the patches' opacities add up to about one too
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
      const a = w.map(alpha).sort((x, y) => y - x);
      expect(a[1]).toBeLessThanOrEqual(0.5 + 1e-3);
    }
    // the smile → surprised handoff is centred in the 0.05 s gap: both are at half there
    expect(at(ch.smile, Math.round(1.525 * TRACK_FPS))).toBeCloseTo(0.5, 1);
    expect(at(ch.surprised, Math.round(1.525 * TRACK_FPS))).toBeCloseTo(0.5, 1);
    // a gap of 0.25 s or more: each ramps on its own, calm in between
    expect(at(ch.calm, Math.round(2.75 * TRACK_FPS))).toBe(1);
  });

  it('plays one-shot acts from faces.json on top of the talking motion', () => {
    const units = unitsFromWords(words, 'zh-CN');
    const { list, acts } = facesOf([{ line: 1, act: 'nod' }, { t0: 1.2, t1: 2, face: 'smile', act: 'shake' }], units);
    expect(list).toEqual([[1.2, 2, 'smile']]);
    // a line's act starts on its first word, a span's on t0
    expect(acts).toEqual([[units[0].t0, 'nod'], [1.2, 'shake']]);
    expect(() => facesOf([{ line: 1, act: 'jump' }], units)).toThrow(/act must be one of nod, shake, tilt, hop, shy/);
    expect(() => facesOf([{ line: 1 }], units)).toThrow(/needs a face .* or an act/);
    // the curves (LivLiv actions.ts): shake turns the head ±13°, nod dips it, tilt leans it, hop crouches and rises,
    // shy looks aside; all ease in and out to nothing
    const curve = (id: string, ch: string) => Array.from({ length: 400 }, (_, i) => (actAt(id, (i / 400) * ACTS[id as keyof typeof ACTS]) as Record<string, number>)[ch] ?? 0);
    const peak = (id: string, ch: string) => Math.max(...curve(id, ch).map(Math.abs));
    expect(peak('shake', 'angleX')).toBeCloseTo(13, 0);
    expect(peak('shake', 'bodyX')).toBeCloseTo(1.95, 1);
    expect(Math.min(...curve('nod', 'angleY'))).toBeLessThan(-9);
    expect(peak('tilt', 'angleZ')).toBeCloseTo(11, 0);
    expect(Math.min(...curve('hop', 'moveY'))).toBeCloseTo(-0.025, 3);
    expect(Math.max(...curve('hop', 'moveY'))).toBeCloseTo(0.04, 3);
    expect(peak('shy', 'eyeBallX')).toBeCloseTo(0.7, 1);
    for (const id of Object.keys(ACTS)) {
      expect(Object.values(actAt(id, 0)).every((v) => v === 0)).toBe(true);
      expect(actAt(id, ACTS[id as keyof typeof ACTS] + 0.01)).toEqual({});
    }
    // on the track the act adds to the talking motion, which goes on under it
    const base = buildTrack({ units, dur: 3, seed: 2 }) as Built & { nods: [number, number][] };
    const shook = buildTrack({ units, dur: 3, seed: 2, faces: [{ t0: 0.1, t1: 1.4, act: 'shake' }] }) as Built & { nods: [number, number][]; acts: [number, string][] };
    expect(shook.acts).toEqual([[0.1, 'shake']]);
    expect(shook.nods).toEqual(base.nods);
    for (let k = 0; k < 3 * TRACK_FPS; k += 7) {
      const d = at(shook.track.offsets!.angleX, k) - at(base.track.offsets!.angleX, k);
      expect(Math.abs(d - (actAt('shake', k / TRACK_FPS - 0.1).angleX ?? 0))).toBeLessThan(0.02);
    }
    // the same act again before the first ends: the first fades out over 0.15 s instead of adding up
    const twice = buildTrack({ units: [], env: syllables(5, 5), dur: 3, motion: 0, faces: [{ t0: 0.5, t1: 1, act: 'tilt' }, { t0: 1.2, t1: 2, act: 'tilt' }] }) as Built;
    expect(Math.max(...twice.track.offsets!.angleZ)).toBeLessThanOrEqual(11.01);
  });

  const lipsync = path.join(skill, 'scripts/lipsync.mjs');
  it('writes the track and the check table from the command line, and sends offsets to motionIn', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'intro.words.json'), JSON.stringify(words));
    const out = path.join(dir, 'host/intro.track.json');
    const r = spawnSync(process.execPath, [lipsync, '--words', path.join(dir, 'intro.words.json'), '--out', out, '--lang', 'zh-CN'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toMatchObject({ format: 'baocut-puppet-track', fps: TRACK_FPS });
    const check = fs.readFileSync(path.join(dir, 'host/lipsync-check.txt'), 'utf8').split('\n');
    expect(check[1]).toMatch(/^\d+(\.\d+)?s, \d+ steps at 120 fps \(shown below at 30 fps\), mouth changes \d+, nods \d+, phrases 2$/);
    expect(check.find((l) => /^\s+[\d.]+\s+好/.test(l))).toMatch(/好\s+hao\s+B·D·E/);
    const bad = spawnSync(process.execPath, [lipsync, '--words', path.join(dir, 'intro.words.json'), '--out', out, '--offset', '2'], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/unknown option --offset .*motionIn/);
    // --bounce is a switch; --motion sets how much the voice moves the head
    const hop = spawnSync(process.execPath, [lipsync, '--words', path.join(dir, 'intro.words.json'), '--out', out, '--lang', 'zh-CN', '--bounce', '--motion', '1.5'], { encoding: 'utf8' });
    expect(hop.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).offsets.moveY.length).toBeGreaterThan(1);
  });
});

// A flat cartoon bust drawn from filled shapes with outlines, on chroma green: the portrait, its bald repaint and
// edits that differ from it only where they are asked to (mouths, closed eyes, a smile), like the image model's.
type RGB = [number, number, number];
type Shape = { inside: (x: number, y: number) => boolean; fill: RGB; outline?: number };
const SIZE = 512;
const ell = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const rect = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const stroke = (f: (x: number) => number, x0: number, x1: number, t: number) => (x: number, y: number) => x >= x0 && x <= x1 && Math.abs(y - f(x)) <= t;

function render(shapes: Shape[], line: RGB, background: RGB) {
  const n = SIZE * SIZE, d = new Uint8ClampedArray(n * 4), m = new Uint8Array(n);
  for (let p = 0; p < n; p++) d.set([...background, 255], p * 4);
  for (const s of shapes) {
    for (let p = 0; p < n; p++) m[p] = s.inside((p % SIZE) + 0.5, Math.floor(p / SIZE) + 0.5) ? 1 : 0;
    const r = s.outline ?? 0;
    for (let p = 0; p < n; p++) {
      if (!m[p]) continue;
      const x = p % SIZE, y = Math.floor(p / SIZE);
      let edge = false;
      for (let j = -r; j <= r && !edge; j++) for (let i = -r; i <= r && !edge; i++) {
        if (!r || i * i + j * j > r * r) continue;
        const X = x + i, Y = y + j;
        edge = X < 0 || Y < 0 || X >= SIZE || Y >= SIZE || !m[Y * SIZE + X];
      }
      d.set([...(edge ? line : s.fill), 255], p * 4);
    }
  }
  return { w: SIZE, h: SIZE, d };
}

function drawCharacter({ line = [24, 20, 22] as RGB, hair = [120, 62, 32] as RGB, iris = null as RGB | null, fringe = false, socket = false, rim = false } = {}) {
  const skin: RGB = [252, 212, 180], white: RGB = [255, 255, 255], dark: RGB = [70, 20, 26], green: RGB = [0, 177, 64];
  // a shaded face: the skin round each eye darker than the cheeks, the closed lid as dark as it
  const shade: RGB = [212, 172, 140], lidSkin = socket ? shade : skin;
  const sockets: Shape[] = socket ? [ell(214, 238, 34, 26), ell(298, 238, 34, 26)].map((inside) => ({ inside, fill: shade })) : [];
  const neck = { inside: rect(222, 300, 290, 470), fill: skin, outline: 6 };
  const body = { inside: ell(256, 560, 170, 150), fill: [150, 120, 210] as RGB, outline: 6 };
  const head = { inside: ell(256, 228, 100, 118), fill: skin, outline: 6 };
  // a bob: a cap over the forehead and locks down both sides of the face; with a fringe the bangs come down past the
  // brows, which are drawn over them
  const inFringe = (x: number, y: number) => fringe && y < 218 && Math.abs(x - 256) < 80;
  const hairShape = { inside: (x: number, y: number) => ell(256, 214, 120, 126)(x, y) && y < 290 && (y < 168 || inFringe(x, y) || !ell(256, 228, 93, 111)(x, y)), fill: hair, outline: 6 };
  const eye = (cx: number): Shape[] => [
    { inside: ell(cx, 238, 21, 15), fill: white, outline: 2 },
    { inside: ell(cx, 239, 9, 10), fill: iris ?? line, outline: 2 },
    { inside: ell(cx + 3, 235, 2.6, 2.6), fill: white },
  ];
  const lid = (cx: number): Shape[] => [
    { inside: ell(cx, 238, 22, 16), fill: lidSkin },
    { inside: stroke((x) => 238 + 6 * (1 - ((x - cx) / 21) ** 2), cx - 21, cx + 21, 1.8), fill: line },
  ];
  const brow = (cx: number, up = 0): Shape => ({ inside: stroke((x) => 206 - up - 4 * (1 - ((x - cx) / 22) ** 2), cx - 22, cx + 22, 3), fill: line });
  // angry: brows pulled down toward the nose, the upper lids lowered flat over the irises, a blush on the cheeks
  const vBrow = (cx: number): Shape => ({ inside: stroke((x) => 198 + 10 * (cx < 256 ? x - (cx - 22) : cx + 22 - x) / 44, cx - 22, cx + 22, 3), fill: line });
  const narrowed = (cx: number): Shape[] => [
    { inside: (x, y) => ell(cx, 238, 22, 16)(x, y) && y < 233, fill: lidSkin },
    { inside: stroke(() => 233, cx - 20, cx + 20, 1.8), fill: line },
  ];
  const blush = (cx: number): Shape => ({ inside: ell(cx, 275, 14, 7), fill: [250, 182, 170] });
  const clear: Shape = { inside: ell(256, 302, 34, 18), fill: skin };
  const mouths: Record<string, Shape[]> = {
    rest: [{ inside: stroke(() => 302, 236, 276, 2.5), fill: line }],
    half: [clear, { inside: ell(256, 302, 22, 6), fill: dark, outline: 2 }, { inside: rect(240, 297, 272, 299), fill: white }],
    open: [clear, { inside: ell(256, 304, 22, 14), fill: dark, outline: 2 }, { inside: ell(256, 312, 12, 5), fill: [220, 90, 100] }],
    round: [clear, { inside: ell(256, 303, 13, 13), fill: dark, outline: 2 }],
    wide: [clear, { inside: ell(256, 302, 22, 7), fill: white, outline: 2 }, { inside: stroke(() => 305, 238, 274, 1.5), fill: line }],
    smile: [clear, { inside: stroke((x) => 296 + 7 * (1 - ((x - 256) / 28) ** 2), 228, 284, 2.5), fill: line }],
    // a smile much wider than the portrait's mouth, its ends past the mouth's own area
    broad: [clear, { inside: stroke((x) => 296 + 7 * (1 - ((x - 256) / 44) ** 2), 212, 300, 2.5), fill: line }],
    frown: [clear, { inside: stroke((x) => 300 + 6 * ((x - 256) / 22) ** 2, 234, 278, 2.5), fill: line }],
  };
  // rim: a light line, lighter than the skin, 2 px wide on the face under the hair's lower edges (the part map leaves
  // it to the face)
  const hairRim: Shape[] = rim ? [{ inside: (x, y) => head.inside(x, y) && !hairShape.inside(x, y) && hairShape.inside(x, y - 2), fill: [255, 248, 240] }] : [];
  const draw = ({ bald = false, brows = [brow(214), brow(298)], eyes = [...eye(214), ...eye(298)], mouth = mouths.rest, cheeks = [] as Shape[] } = {}) =>
    render([neck, body, head, ...sockets, ...(bald ? [] : [hairShape, ...hairRim]), ...brows, ...eyes, ...cheeks, ...mouth], line, green);
  // the part map (references/art.md section 5): the same shapes, each part in its key colour, the eye lines black
  const key = (s: Shape, fill: RGB, outline?: number): Shape => ({ inside: s.inside, fill, outline });
  const eyeMap = (cx: number) => { const [w, i, hl] = eye(cx); return [key(w, [255, 255, 255], 2), key(i, [0, 255, 255]), key(hl, [0, 255, 255])]; };
  const partmap = render([
    key(neck, [255, 128, 0]), key(body, [128, 128, 128]), key(head, [255, 255, 0]),
    { inside: (x, y) => hairShape.inside(x, y) && (y < 200 || inFringe(x, y)), fill: [255, 0, 0] },
    { inside: (x, y) => hairShape.inside(x, y) && y >= 200 && !inFringe(x, y), fill: [255, 0, 255] },
    key(brow(214), [128, 0, 255]), key(brow(298), [128, 0, 255]), ...eyeMap(214), ...eyeMap(298), key(mouths.rest[0], [128, 0, 0]),
  ], [0, 0, 0], green);
  return {
    portrait: draw(),
    partmap,
    bald: draw({ bald: true }),
    lids: draw({ eyes: [...lid(214), ...lid(298)] }),
    half: draw({ mouth: mouths.half }),
    open: draw({ mouth: mouths.open }),
    round: draw({ mouth: mouths.round }),
    wide: draw({ mouth: mouths.wide }),
    smile: draw({ mouth: mouths.smile }),
    broad: draw({ mouth: mouths.broad }),
    // one brow raised 7 px, the other left as it was
    raised: draw({ brows: [brow(214, 7), brow(298)] }),
    angry: draw({ brows: [vBrow(214), vBrow(298)], eyes: [...eye(214), ...eye(298), ...narrowed(214), ...narrowed(298)], mouth: mouths.frown, cheeks: [blush(198), blush(314)] }),
    // laughing with the eyes shut
    happy: draw({ eyes: [...lid(214), ...lid(298)], mouth: mouths.broad }),
  };
}

function writeCharacter(dir: string, look: Parameters<typeof drawCharacter>[0] = {}, mouths?: Record<string, string>, o: { partmap?: boolean } = {}) {
  fs.mkdirSync(path.join(dir, 'art'), { recursive: true });
  for (const [k, im] of Object.entries(drawCharacter(look))) writePng(path.join(dir, `art/${k}.png`), im);
  const cfg = {
    name: 'synth', portrait: 'art/portrait.png', bald: 'art/bald.png', ...(o.partmap ? { partmap: 'art/partmap.png' } : {}),
    mouths: mouths ?? { half: 'art/half.png', open: 'art/open.png', round: 'art/round.png', wide: 'art/wide.png' },
    lids: 'art/lids.png', expressions: { smile: 'art/smile.png', angry: 'art/angry.png' },
  };
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(cfg));
  return path.join(dir, 'character.json');
}

type Report = { ok: boolean; package: string; checks: { ok: boolean; item: string; note: string }[] };
const build = (cfg: string) => {
  const r = spawnSync(process.execPath, [path.join(skill, 'scripts/puppet-build.mjs'), cfg], { encoding: 'utf8' });
  const report = JSON.parse(fs.readFileSync(path.join(path.dirname(cfg), 'puppet/report.json'), 'utf8')) as Report;
  return { status: r.status, stdout: r.stdout, report };
};
const texturesIn = (v: unknown): string[] =>
  typeof v === 'string' ? (v.startsWith('textures/') ? [v] : []) : v && typeof v === 'object' ? Object.values(v).flatMap(texturesIn) : [];

describe('virtual-host puppet package', { timeout: 60_000 }, () => {
  it('masks the hair for the bald repaint', () => {
    const cfg = writeCharacter(tmp());
    const r = spawnSync(process.execPath, [path.join(skill, 'scripts/puppet-mask.mjs'), cfg], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const { strokes } = JSON.parse(fs.readFileSync(path.join(path.dirname(cfg), 'hair-mask.json'), 'utf8')) as { strokes: { radius: number; points: number[][] }[] };
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.length).toBeLessThanOrEqual(500);
    // the cap over the forehead is in the mask, the eyes and the mouth are not
    const hit = (x: number, y: number) => strokes.some((s) => s.points.some(([px, py], i) => {
      const [qx, qy] = s.points[Math.min(i + 1, s.points.length - 1)];
      const t = Math.max(0, Math.min(1, ((x - px) * (qx - px) + (y - py) * (qy - py)) / ((qx - px) ** 2 + (qy - py) ** 2 || 1)));
      return Math.hypot(x - (px + t * (qx - px)), y - (py + t * (qy - py))) <= s.radius;
    }));
    expect(hit(256, 120)).toBe(true);
    expect(hit(214, 238)).toBe(false);
    expect(hit(256, 302)).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(cfg), 'hair-mask.png'))).toBe(true);
  });

  it('builds a package whose layers give back the portrait at rest', () => {
    const cfg = writeCharacter(tmp());
    const { status, report } = build(cfg);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(status).toBe(0);
    expect(report.checks.find((c) => c.item === 'portrait')!.note).toMatch(/no glasses$/);
    for (const v of ['lids', 'mouth half', 'mouth open', 'mouth round', 'mouth wide', 'expression smile', 'expression angry'])
      expect(report.checks.find((c) => c.item === `${v} lines up`)!.note).toMatch(/shift 0,0, scale 1/);
    const names = zipNames(fs.readFileSync(report.package)) as string[];
    expect(names[0]).toBe('model.json');
    const model = JSON.parse(fs.readFileSync(path.join(path.dirname(cfg), 'puppet/package/model.json'), 'utf8'));
    expect(model).toMatchObject({ format: 'baocut-puppet', version: 1, name: 'synth', canvas: [SIZE, SIZE], expressions: [{ id: 'smile' }, { id: 'angry' }] });
    // the neck under the chin goes half way with a head turn; the rest of the rig is the players' defaults
    expect(model.rig).toEqual({ neck: { twist: 0.5 } });
    // the head turns round the neck line: just above the chin (row 346)
    expect(report.checks.find((c) => c.item === 'neck line')!.note).toMatch(/^\d+ px above the chin \(\d+% of the face\)$/);
    expect(346 - model.anchors.neck_y).toBeLessThan(40);
    for (const t of texturesIn(model)) expect(names).toContain(t);
    for (const id of ['back_hair', 'front_hair', 'face', 'body', 'eye_L', 'eye_R', 'iris_L', 'iris_R', 'brows', 'mouth', 'expr_smile', 'expr_angry'])
      expect(model.layers.map((l: { id: string }) => l.id)).toContain(id);
  });

  it('cuts each expression as one patch of what it changed: eyes, brows, blush and mouth', () => {
    const cfg = writeCharacter(tmp());
    const { status, report } = build(cfg);
    expect(status).toBe(0);
    const note = (id: string) => report.checks.find((c) => c.item === `expression ${id}`)!.note;
    expect(note('smile')).toMatch(/px patch: mouth$/);
    expect(note('angry')).toMatch(/px patch: eyes, brows, blush, mouth; brows L \d+ \/ R \d+ px, 0 of them on the bangs; eyes L R blink$/);
    type Layer = { id: string; x: number; y: number; w: number; h: number; texture: string; talk?: string; brows?: string; role?: string; expression?: string; pivot?: number[] };
    const pkg = path.join(path.dirname(cfg), 'puppet/package');
    const layers = (JSON.parse(fs.readFileSync(path.join(pkg, 'model.json'), 'utf8')) as { layers: Layer[] }).layers;
    const smile = layers.find((l) => l.id === 'expr_smile')!, angry = layers.find((l) => l.id === 'expr_angry')!;
    expect(angry).toMatchObject({ role: 'expr', expression: 'angry', brows: 'redrawn' });
    expect(angry.talk).toMatch(/^textures\/.+\.png$/);
    expect(smile.brows).toBeUndefined();
    // the smile left the eyes alone: its patch stays below them, so blinks and gaze show through
    expect(smile.y).toBeGreaterThan(253);
    // the angry patch covers both eyes (whites 193-319 x 223-253), the brows and the blush below the eyes
    expect(angry.x).toBeLessThanOrEqual(184);
    expect(angry.x + angry.w).toBeGreaterThanOrEqual(328);
    expect(angry.y).toBeLessThanOrEqual(198);
    expect(angry.y + angry.h).toBeGreaterThanOrEqual(282);
    // the eyes it drew are layers of their own after the patch, squashed onto the neutral eye's lid line in a blink;
    // under them the patch and its talking copy are bare skin (the irises are line-coloured, centred at row 239)
    const ids = layers.map((l) => l.id);
    const lum = (l: Layer, file: string, x: number, y: number) => {
      const im = readPng(path.join(pkg, file)), q = 4 * ((y - l.y) * im.w + (x - l.x));
      return im.d[q + 3] > 200 ? (im.d[q] + im.d[q + 1] + im.d[q + 2]) / 3 : -1;
    };
    for (const [s, cx] of [['L', 214], ['R', 298]] as const) {
      const e = layers.find((l) => l.id === `expr_angry_eye_${s}`)!;
      expect(e).toMatchObject({ role: `expr_eye_${s}`, expression: 'angry', pivot: layers.find((l) => l.id === `eye_${s}`)!.pivot });
      expect(ids.indexOf(e.id)).toBe(ids.indexOf('expr_angry') + (s === 'L' ? 1 : 2));
      expect(lum(e, e.texture, cx, 239)).toBeLessThan(60);
      expect(lum(angry, angry.texture, cx, 239)).toBeGreaterThan(180);
      expect(lum(angry, angry.talk!, cx, 239)).toBeGreaterThan(180);
    }
    expect(ids.some((i) => i.startsWith('expr_smile_eye'))).toBe(false);
  });

  it('leaves the eyes of an expression that shut them in its patch', () => {
    for (const partmap of [false, true]) {
      const dir = tmp();
      const cfgFile = writeCharacter(dir, partmap ? { hair: [230, 190, 90] } : {}, undefined, { partmap });
      const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, expressions: { happy: 'art/happy.png' } }));
      const { status, report } = build(cfgFile);
      expect(report.checks.filter((c) => !c.ok)).toEqual([]);
      expect(status).toBe(0);
      expect(report.checks.find((c) => c.item === 'expression happy')!.note).toMatch(/px patch: eyes, mouth; eyes L R drawn shut, kept in the patch$/);
      const ids = (JSON.parse(fs.readFileSync(path.join(dir, 'puppet/package/model.json'), 'utf8')) as { layers: { id: string }[] }).layers.map((l) => l.id);
      expect(ids).toContain('expr_happy');
      expect(ids.some((i) => i.startsWith('expr_happy_eye'))).toBe(false);
    }
  });

  it('clears the whole edited mouth from the talking patch, even a smile wider than the portrait mouth', () => {
    for (const partmap of [false, true]) {
      const dir = tmp();
      const cfgFile = writeCharacter(dir, partmap ? { hair: [230, 190, 90] } : {}, undefined, { partmap });
      const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, expressions: { ...cfg.expressions, smile: 'art/broad.png' } }));
      const { status, report } = build(cfgFile);
      expect(report.checks.filter((c) => !c.ok)).toEqual([]);
      expect(status).toBe(0);
      const pkg = path.join(dir, 'puppet/package');
      type Layer = { id: string; x: number; y: number; texture: string; talk: string };
      const smile = (JSON.parse(fs.readFileSync(path.join(pkg, 'model.json'), 'utf8')) as { layers: Layer[] }).layers.find((l) => l.id === 'expr_smile')!;
      // dark line pixels at the smile's two ends (x 212-224 and 288-300), outside the portrait mouth's area
      const ends = (file: string) => {
        const im = readPng(path.join(pkg, file));
        let n = 0;
        for (let y = 288; y <= 306; y++) for (const [x0, x1] of [[212, 224], [288, 300]]) for (let x = x0; x <= x1; x++) {
          const i = x - smile.x, j = y - smile.y;
          if (i < 0 || j < 0 || i >= im.w || j >= im.h) continue;
          const q = 4 * (j * im.w + i);
          if (im.d[q + 3] > 128 && (im.d[q] + im.d[q + 1] + im.d[q + 2]) / 3 < 100) n++;
        }
        return n;
      };
      expect(ends(smile.texture)).toBeGreaterThan(20);
      // while the mouth layer talks, none of the smile is left beside it
      expect(ends(smile.talk)).toBe(0);
    }
  });

  it('measures coloured line art: brown outlines, irises and hair', () => {
    const { status, report } = build(writeCharacter(tmp(), { line: [70, 30, 14], hair: [150, 90, 50], iris: [120, 70, 40] }));
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(status).toBe(0);
    const [r, g, b] = report.checks.find((c) => c.item === 'portrait')!.note.match(/line (\d+),(\d+),(\d+)/)!.slice(1).map(Number);
    expect(Math.abs(r - 70) + Math.abs(g - 30) + Math.abs(b - 14)).toBeLessThan(16);
  });

  it('builds the BaoCut and LivLiv packages along a part map', () => {
    const cfg = writeCharacter(tmp(), { hair: [230, 190, 90] }, undefined, { partmap: true });
    const { status, report, stdout } = build(cfg);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^ok {3}rest matches the portrait/m);
    const dir = path.join(path.dirname(cfg), 'puppet');
    const model = JSON.parse(fs.readFileSync(path.join(dir, 'package/model.json'), 'utf8'));
    const ids = model.layers.map((l: { id: string }) => l.id);
    for (const id of ['body', 'face', 'mouth', 'brows', 'side_hair', 'front_hair', 'expr_smile', 'expr_angry']) expect(ids).toContain(id);
    const lv = JSON.parse(fs.readFileSync(path.join(dir, 'livliv/model.json'), 'utf8'));
    expect(lv).toMatchObject({ format: 'livliv-model', version: 4, canvas: [SIZE, SIZE], files: { cover: 'cover.png', avatar: 'avatar.png' } });
    // LivLiv has no expr_eye roles (it would draw them always on): its angry patch keeps the eyes, the irises dark
    type Layer = { id: string; x: number; y: number; texture: string; talk?: string; role?: string };
    const own = (l: Layer) => (l.role ?? '').startsWith('expr_eye_');
    expect(model.layers.filter(own).map((l: Layer) => l.id)).toEqual(['expr_angry_eye_L', 'expr_angry_eye_R']);
    expect(lv.layers.map((l: { id: string }) => l.id)).toEqual(model.layers.filter((l: Layer) => !own(l)).map((l: Layer) => l.id));
    expect(fs.readdirSync(path.join(dir, 'livliv/textures')).filter((f) => f.includes('_eye_'))).toEqual([]);
    const lum = (pkg: string, l: Layer, file: string, x: number, y: number) => {
      const im = readPng(path.join(dir, pkg, file)), q = 4 * ((y - l.y) * im.w + (x - l.x));
      return (im.d[q] + im.d[q + 1] + im.d[q + 2]) / 3;
    };
    const ab = model.layers.find((l: Layer) => l.id === 'expr_angry'), al = lv.layers.find((l: Layer) => l.id === 'expr_angry');
    for (const f of [ab.texture, ab.talk]) {
      expect(lum('package', ab, f, 214, 239)).toBeGreaterThan(180);
      expect(lum('livliv', al, f, 214, 239)).toBeLessThan(60);
    }
    expect(model.rig).toEqual({ neck: { twist: 0.5 } });
    expect(lv.rig).toEqual(model.rig);
    expect(lv.anchors.neck_y).toBe(model.anchors.neck_y);
    expect(zipNames(fs.readFileSync(path.join(dir, 'synth.livliv')))).toContain('cover.png');
  });

  it('leaves the light rim under the hair to the hair, over skin on the face', () => {
    // the cap over the forehead ends at row 168; the rim is rows 168-169, on the face in the part map
    const cfg = writeCharacter(tmp(), { hair: [230, 190, 90], rim: true }, undefined, { partmap: true });
    const { status, report, stdout } = build(cfg);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^ok {3}rest matches the portrait/m);
    const dir = path.join(path.dirname(cfg), 'puppet/package');
    type Layer = { id: string; x: number; y: number; texture: string };
    const layers = (JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8')) as { layers: Layer[] }).layers;
    const px = (id: string, x: number, y: number) => {
      const l = layers.find((v) => v.id === id)!, im = readPng(path.join(dir, l.texture)), q = 4 * ((y - l.y) * im.w + (x - l.x));
      return { lum: (im.d[q] + im.d[q + 1] + im.d[q + 2]) / 3, a: im.d[q + 3] };
    };
    for (const y of [168, 169]) {
      // the face there is skin (lum 215): left as the rim, it stayed on the forehead, a pale copy of the hair's edge,
      // when the hair swayed
      expect(Math.abs(px('face', 256, y).lum - 215)).toBeLessThan(10);
      // the bangs carry the rim as drawn, so at rest it is there and it goes with them
      expect(px('front_hair', 256, y)).toMatchObject({ a: 255 });
      expect(px('front_hair', 256, y).lum).toBeGreaterThan(240);
    }
  });

  it('keeps a closed lid as dark as the shaded skin round the eye, not the lighter skin of the whole face', () => {
    const cfg = writeCharacter(tmp(), { hair: [230, 190, 90], socket: true }, undefined, { partmap: true });
    const { status, report } = build(cfg);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(status).toBe(0);
    const dir = path.join(path.dirname(cfg), 'puppet');
    const model = JSON.parse(fs.readFileSync(path.join(dir, 'package/model.json'), 'utf8'));
    type Layer = { id: string; x: number; y: number; texture: string };
    const lid = model.layers.find((l: Layer) => l.id === 'eye_L_closed') as Layer;
    const im = readPng(path.join(dir, 'package', lid.texture)), q = 4 * ((232 - lid.y) * im.w + (214 - lid.x));
    expect(im.d[q + 3]).toBeGreaterThan(200);
    // the socket is 40 darker than the cheeks: matched to the whole face's skin the lid came out as light as a cheek
    expect(Math.abs((im.d[q] + im.d[q + 1] + im.d[q + 2]) / 3 - (212 + 172 + 140) / 3)).toBeLessThan(12);
  });

  it('takes a brow-coloured blot in the part map below the eyes for the part round it', () => {
    // two map colours mixing at an edge can make the brow's purple anywhere; a brow is above its eye
    const cfg = writeCharacter(tmp(), { hair: [230, 190, 90] }, undefined, { partmap: true });
    const file = path.join(path.dirname(cfg), 'art/partmap.png'), map = readPng(file);
    for (let y = 284; y < 288; y++) for (let x = 200; x < 204; x++) map.d.set([128, 0, 255, 255], 4 * (y * map.w + x));
    writePng(file, map);
    const { status, report } = build(cfg);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(status).toBe(0);
    const model = JSON.parse(fs.readFileSync(path.join(path.dirname(cfg), 'puppet/package/model.json'), 'utf8'));
    // the eye whites start at row 223
    expect(model.anchors.brows[0][3]).toBeLessThan(223);
  });

  it('keeps the neck line at the chin when the part map has a neck-orange speck up in the face', () => {
    // red bangs and a yellow face mixing at an edge make orange, the neck's colour
    const neckY = (speck: boolean) => {
      const cfg = writeCharacter(tmp(), { hair: [230, 190, 90] }, undefined, { partmap: true });
      if (speck) {
        const file = path.join(path.dirname(cfg), 'art/partmap.png'), map = readPng(file);
        for (let y = 208; y < 214; y++) for (let x = 250; x < 256; x++) map.d.set([255, 128, 0, 255], 4 * (y * map.w + x));
        writePng(file, map);
      }
      const { status, report } = build(cfg);
      expect(report.checks.filter((c) => !c.ok)).toEqual([]);
      expect(status).toBe(0);
      return JSON.parse(fs.readFileSync(path.join(path.dirname(cfg), 'puppet/package/model.json'), 'utf8')).anchors.neck_y;
    };
    expect(neckY(true)).toBe(neckY(false));
  });

  it('says to redo the part map when its neck runs up into the face', () => {
    const cfg = writeCharacter(tmp(), { hair: [230, 190, 90] }, undefined, { partmap: true });
    const file = path.join(path.dirname(cfg), 'art/partmap.png'), map = readPng(file);
    // an orange strip up the cheek, joined to the neck below the chin
    for (let y = 256; y < 346; y++) for (let x = 222; x < 229; x++) map.d.set([255, 128, 0, 255], 4 * (y * map.w + x));
    writePng(file, map);
    const { status, stdout } = build(cfg);
    expect(status).toBe(1);
    expect(stdout).toMatch(/^FIX {2}neck line: \d+ px above the chin \(\d+% of the face\); the neck \(orange\) in the part map starts up in the face: redo the map$/m);
  });

  it.each([true, false])('draws the brows an expression moved over the bangs (part map %s)', (partmap) => {
    const dir = tmp();
    const cfgFile = writeCharacter(dir, { hair: [230, 190, 90], fringe: true }, undefined, { partmap });
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, expressions: { ...cfg.expressions, surprised: 'art/raised.png' } }));
    const { status, report } = build(cfgFile);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(status).toBe(0);
    // without a part map the brows are found on the bangs: dark strokes inside the hair, cut off from its lines
    if (!partmap) expect(report.checks.find((c) => c.item === 'brows')!.note).toMatch(/^L \d+ \/ R \d+ px, [1-9]\d* on the bangs$/);
    expect(report.checks.find((c) => c.item === 'expression surprised')!.note).toMatch(/brows L [1-9]\d* \/ R [1-9]\d* px, [1-9]\d* of them on the bangs$/);
    type Layer = { id: string; x: number; y: number; texture: string; brow_tex?: string };
    for (const pkg of (partmap ? ['package', 'livliv'] : ['package']).map((d) => path.join(dir, 'puppet', d))) {
      const layers = (JSON.parse(fs.readFileSync(path.join(pkg, 'model.json'), 'utf8')) as { layers: Layer[] }).layers;
      const ids = layers.map((l) => l.id);
      // the brows come after the bangs, so the brows the expressions draw are drawn over the hair too
      expect(ids.indexOf('brows')).toBeGreaterThan(ids.indexOf('front_hair'));
      const front = layers.find((l) => l.id === 'front_hair')!, surprised = layers.find((l) => l.id === 'expr_surprised')!;
      expect(surprised.brow_tex).toMatch(/^textures\/.+\.png$/);
      const dark = (l: Layer, file: string, x0: number, y0: number, x1: number, y1: number) => {
        const im = readPng(path.join(pkg, file));
        let n = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = x - l.x, j = y - l.y;
          if (i < 0 || j < 0 || i >= im.w || j >= im.h) continue;
          const q = 4 * (j * im.w + i);
          if (im.d[q + 3] > 128 && (im.d[q] + im.d[q + 1] + im.d[q + 2]) / 3 < 100) n++;
        }
        return n;
      };
      // the raised brow (rows 192-197 at its middle) and the brow the edit left (rows 199-205) are in brow_tex, and the
      // bangs under the portrait's brows are filled with hair, so the raised brow leaves no old brow behind
      expect(dark(surprised, surprised.brow_tex!, 206, 192, 222, 196)).toBeGreaterThan(60);
      expect(dark(surprised, surprised.brow_tex!, 290, 200, 306, 204)).toBeGreaterThan(60);
      for (const cx of [214, 298]) expect(dark(front, front.texture, cx - 8, 199, cx + 8, 205)).toBe(0);
      // the players mesh a layer only where its texture is opaque: the patch is opaque under every brow it draws
      const bt = readPng(path.join(pkg, surprised.brow_tex!)), tex = readPng(path.join(pkg, surprised.texture));
      expect([bt.w, bt.h]).toEqual([tex.w, tex.h]);
      let bare = 0;
      for (let q = 3; q < bt.d.length; q += 4) if (bt.d[q] > 128 && tex.d[q] === 0) bare++;
      expect(bare).toBe(0);
    }
  });

  it('says which edit to redo when the mouths do not open in steps', () => {
    const cfg = writeCharacter(tmp(), {}, { half: 'art/open.png', open: 'art/half.png' });
    const { status, stdout } = build(cfg);
    expect(status).toBe(1);
    expect(stdout).toMatch(/^FIX {2}mouth ladder: half 28 px tall, open 12 px; open must be taller than half$/m);
  });

  it('says to redraw when the brows cannot be told from the bangs', () => {
    // brows in the line colour on bangs in the line colour: nothing to move
    const { status, stdout } = build(writeCharacter(tmp(), { hair: [24, 20, 22], fringe: true }));
    expect(status).toBe(1);
    expect(stdout).toMatch(/^FIX {2}brows: brow L and R not found; redraw the portrait with both eyebrows clearly visible/m);
  });
});

describe('virtual-host key removal', () => {
  // a generated portrait: the green backdrop darkens down the picture, the hair has a pocket of backdrop behind one
  // faint strand and a shaded gap closed off inside it, and there are colours near the key that are the drawing
  const W = 120, H = 120;
  const under = (y: number): RGB => [3, Math.round(190 - 0.25 * y), 55];
  const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k] * (1 - t) + b[k] * t)) as RGB;
  const HAIR: RGB = [200, 90, 40];
  const portrait = () => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let c = under(y);
      const inHair = x >= 10 && x < 60 && y >= 10 && y < 110;
      if (inHair) c = HAIR;
      if (x >= 26 && x < 34 && y >= 50 && y < 58) c = mix([0, 0, 0], under(y), 0.75); // the shaded gap inside the hair
      if (x >= 40 && x < 48 && y >= 80 && y < 88) c = [60, 170, 80]; // a green iris
      if (x >= 14 && x < 24 && y >= 20 && y < 28) c = [100, 200, 120]; // green hair
      if (x >= 10 && x < 20 && y >= 95 && y < 110) c = [170, 240, 210]; // a mint sleeve at the edge
      if (x >= 84 && x < 86 && y >= 40 && y < 80) c = [176, 191, 65]; // a strand painted in the backdrop's light
      const strand = y >= 28 && y < 92 && x >= 60 && x < 74 && (x >= 72 || y < 30 || y >= 90);
      if (strand) c = mix(HAIR, under(y), 0.58);
      else if (y >= 30 && y < 90 && x >= 60 && x < 72) c = mix([0, 0, 0], under(y), 0.82); // the pocket behind it
      d.set([...c, 255], 4 * (y * W + x));
    }
    return { w: W, h: H, d };
  };
  const at = (x: number, y: number) => y * W + x;

  it('unmixes key colour deeper than the edge band where it joins the backdrop, against the backdrop round it', () => {
    const K = keyOut(portrait());
    expect(K.bg[at(66, 60)]).toBe(0);
    expect(K.alpha[at(66, 60)]).toBeLessThan(0.35);
    // the backdrop behind a pixel is the backdrop round it, not one colour for the whole picture
    expect(K.under(at(80, 15))[1] - K.under(at(80, 105))[1]).toBeGreaterThan(15);
    // a colour of the drawing near the key, at the edge, stays solid past the edge band
    expect(K.alpha[at(15, 100)]).toBe(1);
    expect(K.alpha[at(44, 84)]).toBe(1);
  });

  it('unmixes a strand with less key in its colour than none against the colour round it, and takes the spill out', () => {
    // the faint strand is 42% hair: the key's excess alone reads it as 56% and leaves the key in it, olive
    const K = keyOut(portrait()), p = at(73, 60);
    expect(Math.abs(K.alpha[p] - 0.42)).toBeLessThan(0.03);
    for (let k = 0; k < 3; k++) expect(Math.abs(K.fg.d[4 * p + k] - HAIR[k])).toBeLessThan(6);
    // a strand no mix explains, lit like the backdrop, keeps no more of its green than the hair round it has
    const q = 4 * at(84, 60);
    expect(K.fg.d[q] - K.fg.d[q + 1]).toBeGreaterThan(50);
    // what the layers must give back at rest is the portrait with that spill out, and the portrait everywhere else
    expect(K.clean.d[q + 1]).toBeLessThan(170);
    expect([...K.clean.d.subarray(4 * at(30, 30), 4 * at(30, 30) + 3)]).toEqual(HAIR);
  });

  it('keys out a gap the drawing closes off only where the caller says gaps can be', () => {
    const plain = keyOut(portrait());
    expect(plain.alpha[at(30, 54)]).toBe(1);
    const hair = new Uint8Array(W * H);
    for (let y = 10; y < 110; y++) for (let x = 10; x < 40; x++) hair[at(x, y)] = 1;
    const K = keyOut(portrait(), { holes: hair });
    expect(K.alpha[at(30, 54)]).toBe(0);
    // green hair is far from the key colour and stays; the iris is outside the hair and stays
    expect(K.alpha[at(18, 24)]).toBe(1);
    expect(K.alpha[at(44, 84)]).toBe(1);
  });
});

describe('virtual-host expression eye regions', () => {
  // an eye on skin in the shadow of the bangs: the lash 8 px thick over the whites, a brown crease in the shadow 6 px
  // above the lash, a wing flicked up from the outer corner. The expression looks up: its iris 4 px higher
  const W = 120, H = 80, cx = 62, cy = 46, rx = 30, ry = 14;
  const skin: RGB = [252, 212, 180], shade = skin.map((v) => v * 0.8) as RGB, line: RGB = [40, 25, 25];
  const top = (X: number) => { const u = (X - cx) / rx; return Math.abs(u) <= 1 ? cy - ry * Math.sqrt(1 - u * u) : null; };
  const inEye = (X: number, Y: number) => ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 <= 1;
  // what an edit can draw as light as the skin, or in its shade: a catchlight in the iris, the whites under the lash in
  // its shadow, whites as pink as the skin at the corners
  const pink: RGB = [246, 214, 196], whiteShade: RGB = [220, 188, 165];
  // iris: its centre x and radius; light: a spot [x, y, r] as light as the skin; lash: how far the lash reaches above
  // the eye's outline
  type Look = { catchlight?: boolean; shadedWhites?: boolean; pinkCorners?: boolean; iris?: [number, number]; light?: [number, number, number]; lash?: number };
  const draw = (irisY: number, look: Look = {}) => {
    const d = new Uint8ClampedArray(W * H * 4), drawn = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x, X = x + 0.5, Y = y + 0.5, t = top(X), wx = cx - rx - X;
      let c = skin, eye = false;
      if (t !== null) {
        const lt = t - (look.lash ?? 6);
        if (Y >= lt - 9 && Y < lt) c = shade;
        if (Math.abs(Y - (lt - 6)) <= 1 && Math.abs(X - cx) <= 0.95 * rx) c = [185, 120, 105];
        if (Y >= lt && Y <= t + 2) [c, eye] = [line, true];
        else if (inEye(X, Y)) {
          const [ix, ir] = look.iris ?? [cx, 9];
          let e: RGB = Y > cy && !inEye(X, Y + 2) ? line : Math.hypot(X - ix, Y - irisY) <= ir ? [60, 90, 150] : [255, 255, 255];
          const white = e[0] === 255;
          if (look.catchlight && Math.hypot(X - (cx + 3), Y - (irisY - 5)) <= 2.5) e = pink;
          else if (look.light && Math.hypot(X - look.light[0], Y - look.light[1]) <= look.light[2]) e = pink;
          else if (white && look.shadedWhites && Y <= t + 5) e = whiteShade;
          else if (white && look.pinkCorners && Math.abs(X - cx) > 0.75 * rx) e = pink;
          [c, eye] = [e, true];
        }
      }
      if (wx >= -1 && wx <= 8 && Math.abs(Y - (cy - wx)) <= 1.2) [c, eye] = [line, true];
      d.set([...c, 255], 4 * p);
      drawn[p] = eye ? 1 : 0;
    }
    return { im: { w: W, h: H, d }, drawn };
  };

  it('keeps the crease in the shadow of the bangs and the skin round a corner out of the eye, and its wing in', () => {
    const N = draw(cy + 1), E = draw(cy - 3);
    const changed = new Uint8Array(W * H).map((_, p) => [0, 1, 2].some((k) => N.im.d[4 * p + k] !== E.im.d[4 * p + k]) ? 1 : 0);
    const patch = { w: W, h: H, d: new Uint8ClampedArray(W * H * 4).fill(255) };
    const { R, shut } = expressionEyeRegions({ E: E.im, im: N.im, patch, eyes: [{ drawn: N.drawn, hit: true }, null], changed, skin, w: W, h: H });
    expect(shut).toEqual([]);
    const at = (x: number, y: number) => R[0]![y * W + x];
    // the eye and its lash
    expect(at(cx, cy)).toBe(1);
    expect(at(cx, cy - ry - 3)).toBe(1);
    // the crease near the corners, within the eye's box: the shadow between it and the lash is skin. Taken for a line,
    // it carried the region up to the crease column by column, and a blink squashed pieces of the crease with the eye
    for (const x of [Math.round(cx - 0.85 * rx), Math.round(cx + 0.85 * rx)]) expect(at(x, Math.floor(top(x + 0.5)! - 12))).toBe(0);
    // past the whites: the wing, and not the skin of the column below it
    expect(at(cx - rx - 5, cy - 5)).toBe(1);
    expect(at(cx - rx - 5, cy + 10)).toBe(0);
  });

  it('takes in what the eye draws as light as the skin or in its shade, up to the lash, and still not the crease', () => {
    const N = draw(cy + 1), E = draw(cy - 3, { catchlight: true, shadedWhites: true, pinkCorners: true });
    const changed = new Uint8Array(W * H).map((_, p) => [0, 1, 2].some((k) => N.im.d[4 * p + k] !== E.im.d[4 * p + k]) ? 1 : 0);
    const patch = { w: W, h: H, d: new Uint8ClampedArray(W * H * 4).fill(255) };
    const { R, shut } = expressionEyeRegions({ E: E.im, im: N.im, patch, eyes: [{ drawn: N.drawn, hit: true }, null], changed, skin, w: W, h: H });
    expect(shut).toEqual([]);
    const at = (x: number, y: number) => R[0]![y * W + x];
    // a catchlight as light as the skin, where the iris hides the whites: it and the lash over it. A walk from it
    // stopped at it, and the lash stayed in the patch over the shut eye
    expect(at(cx + 3, cy - 8)).toBe(1);
    expect(at(cx + 3, cy - ry - 3)).toBe(1);
    // the whites in the lash's shadow, and the lash over them
    for (const x of [cx - 16, cx + 16]) {
      const t = top(x + 0.5)!;
      expect(at(x, Math.floor(t + 4))).toBe(1);
      expect(at(x, Math.floor(t - 3))).toBe(1);
    }
    // whites as pink as the skin at both corners: left out, they stayed in the patch, a light stripe over the shut lid
    for (const x of [Math.round(cx - 0.85 * rx), Math.round(cx + 0.85 * rx)]) {
      expect(at(x, cy)).toBe(1);
      expect(at(x, Math.floor(top(x + 0.5)! - 12))).toBe(0);
    }
  });

  it('takes in an iris out to the corner under a highlight as light as the skin, and a lash drawn thicker', () => {
    // the expression looks aside: its iris reaches the outer corner, no whites beyond it, a highlight in it as light as
    // the skin; its lash is drawn twice as thick as the neutral one
    const N = draw(cy + 1), E = draw(cy + 2, { iris: [cx + 18, 13], light: [cx + 20, cy + 1, 5], lash: 14 });
    const changed = new Uint8Array(W * H).map((_, p) => [0, 1, 2].some((k) => N.im.d[4 * p + k] !== E.im.d[4 * p + k]) ? 1 : 0);
    const patch = { w: W, h: H, d: new Uint8ClampedArray(W * H * 4).fill(255) };
    const { R, shut } = expressionEyeRegions({ E: E.im, im: N.im, patch, eyes: [{ drawn: N.drawn, hit: true }, null], changed, skin, w: W, h: H });
    expect(shut).toEqual([]);
    const at = (x: number, y: number) => R[0]![y * W + x];
    // the highlight and the iris under it: a walk down the column stopped at the highlight, and the rest of the iris
    // stayed in the patch over the closing lid
    expect(at(cx + 20, cy + 1)).toBe(1);
    for (let y = cy + 4; y <= cy + 7; y++) for (const x of [cx + 19, cx + 20, cx + 21]) expect(at(x, y)).toBe(1);
    // the lash up to its top, and not the crease above it: cut straight at the neutral lash's thickness, the squashed
    // eye's top was a straight edge while it closed
    for (const x of [cx - 16, cx, cx + 10]) {
      const t = top(x + 0.5)!;
      expect(at(x, Math.floor(t - 13))).toBe(1);
      expect(at(x, Math.floor(t - 20))).toBe(0);
    }
  });

  it('cuts the eye so that, open, it over the cut patch is the patch as drawn, over any face under it', () => {
    const N = draw(cy + 1), E = draw(cy - 3);
    const changed = new Uint8Array(W * H).map((_, p) => [0, 1, 2].some((k) => N.im.d[4 * p + k] !== E.im.d[4 * p + k]) ? 1 : 0);
    // the patch see-through across the outer corner, where an edit barely changed the face
    const drawn = new Uint8ClampedArray(E.im.d);
    for (let y = 0; y < H; y++) for (let x = 0; x < cx - 20; x++) drawn[4 * (y * W + x) + 3] = 40 + 4 * x;
    const patch = { w: W, h: H, d: new Uint8ClampedArray(drawn) }, T = { w: W, h: H, d: new Uint8ClampedArray(drawn) };
    const regions = expressionEyeRegions({ E: E.im, im: N.im, patch, eyes: [{ drawn: N.drawn, hit: true }, null], changed, skin, w: W, h: H });
    // the bare face lighter than the expression's skin (an edit that blushes or shades the face)
    const under = { w: W, h: H, d: new Uint8ClampedArray(W * H * 4).map((_, i) => [255, 236, 214, 255][i % 4]) };
    const { eyes } = cutExpressionEyes({ L: patch, T, under, regions, pivots: [[cx, cy], null], keep: null, w: W, h: H });
    expect(eyes.map((e: { side: string }) => e.side)).toEqual(['L']);
    const X = eyes[0].L.d, bg = [30, 200, 60];
    for (const P of [patch, T]) {
      let worst = 0;
      for (let p = 0; p < W * H; p++) {
        const ax = X[4 * p + 3] / 255, ap = P.d[4 * p + 3] / 255, a0 = drawn[4 * p + 3] / 255;
        for (let k = 0; k < 3; k++) {
          const cut = X[4 * p + k] * ax + (1 - ax) * (P.d[4 * p + k] * ap + bg[k] * (1 - ap));
          worst = Math.max(worst, Math.abs(cut - (drawn[4 * p + k] * a0 + bg[k] * (1 - a0))));
        }
      }
      // a soft eye over a patch gone to the bare face left a light ring round the eye
      expect(worst).toBeLessThanOrEqual(2);
    }
    // shut, the opaque patch shows the bare face inside the region and itself outside it; the see-through part of the
    // region shows the face under the patch
    expect([...patch.d.slice(4 * (cy * W + cx), 4 * (cy * W + cx) + 3)]).toEqual([255, 236, 214]);
    expect([...patch.d.slice(4 * (5 * W + cx + 30), 4 * (5 * W + cx + 30) + 3)]).toEqual(skin);
    expect(patch.d[4 * (cy * W + cx - 25) + 3]).toBe(0);
  });
});

describe('virtual-host redrawn brows', () => {
  it('takes a brow pressed onto the lash whole, and not the lash the expression redrew under it', () => {
    // level neutral brows; the expression lowers them toward the middle and opens its eyes 3 px higher. The left brow
    // runs on over the lash (the eye region takes its end in), the right one ends on the skin above it
    const W = 200, H = 90, midX = 100, rx = 28, ry = 12, eyeX = [55, 145];
    const skin: RGB = [252, 212, 180], browCol: RGB = [90, 55, 40], hairCol: RGB = [200, 120, 60], line: RGB = [40, 25, 25];
    const paint = (eyeY: number, browAt: (X: number, Y: number) => boolean) => {
      const d = new Uint8ClampedArray(W * H * 4), eyes = new Uint8Array(W * H), brow = new Uint8Array(W * H), lash = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x, X = x + 0.5, Y = y + 0.5, ex = eyeX[X >= midX ? 1 : 0], u = (X - ex) / rx;
        const t = Math.abs(u) <= 1 ? eyeY - ry * Math.sqrt(1 - u * u) : null;
        let c = skin;
        if (t !== null && Y >= t - 5 && Y < t) [c, eyes[p], lash[p]] = [line, 1, 1];
        else if (t !== null && Y >= t && Y <= 2 * eyeY - t) [c, eyes[p]] = [Math.hypot(X - ex, Y - eyeY) < 8 ? [60, 90, 150] : [255, 255, 255], 1];
        if (browAt(X, Y)) [c, brow[p], lash[p]] = [browCol, 1, 0];
        d.set([...c, 255], 4 * p);
      }
      return { im: { w: W, h: H, d }, eyes, brow, lash };
    };
    const N = paint(63, (X, Y) => Y >= 24 && Y < 30 && ((X >= 22 && X < 82) || (X >= 118 && X < 178)));
    const E = paint(60, (X, Y) => (X >= 20 && X < 86 && Math.abs(Y - (26 + (X - 20) / 3)) <= 3) || (X >= 124 && X < 180 && Math.abs(Y - (26 + (180 - X) / 5)) <= 3));
    const near = new Uint8Array(W * H).map((_, p) => (p < 62 * W ? 1 : 0));
    const L = { w: W, h: H, d: new Uint8ClampedArray(E.im.d) }, T = { w: W, h: H, d: new Uint8ClampedArray(E.im.d) };
    const under = { w: W, h: H, d: new Uint8ClampedArray(W * H * 4).map((_, i) => [...skin, 255][i % 4]) };
    const { bm } = redrawnBrows({ E: E.im, im: N.im, near, eyes: E.eyes, lids: null, full: N.brow, browCol, hairCol, skin, midX, L, T, under, w: W, h: H });
    let inEye = 0;
    for (let p = 0; p < W * H; p++) {
      // the brow's pixels in the eye region (and next to it) too: left out, they went with the eye layer and squashed
      // away in a blink, and the closed lid's skin showed through the brow's end
      if (E.brow[p]) expect(bm[p]).toBe(1);
      if (E.brow[p] && E.eyes[p]) inEye++;
      // the lash the edit moved changed like a brow and ran on from it: taken in, it was left over the closed lid
      if (E.lash[p]) expect(bm[p]).toBe(0);
    }
    expect(inEye).toBeGreaterThan(0);
    // the right brow ends where it was drawn, short of the eye
    expect(bm.reduce((a, v) => a + v, 0)).toBe(E.brow.reduce((a, v) => a + v, 0));
  });
});

describe('virtual-host brows across the strands', () => {
  it('takes back a brow drawn over a strand the part map painted across it, and leaves a strand drawn over the brow', () => {
    // a brow on rows 18-21 from x 4 to 100 crossed by three strands the map paints across it: x 14-23 under the brow
    // (the brow drawn over it, 60%), x 34-43 over the brow, with its outline at both edges and a strand line drawn
    // slantwise across it a pixel a row, and one slanting under the brow, 6 px wide, so that every column it crosses
    // keeps some brow above or below it
    const W = 120, H = 40, midX = 110;
    const skin: RGB = [252, 212, 180], hair: RGB = [200, 120, 60], browCol: RGB = [90, 55, 40], line: RGB = [40, 25, 25];
    const d = new Uint8ClampedArray(W * H * 4), brow = new Uint8Array(W * H), front = new Uint8Array(W * H), drawnOver = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x, onBrow = y >= 18 && y <= 21 && x >= 4 && x <= 100, slant = x - (y - 18);
      const under = y <= 33 && ((x >= 14 && x <= 23) || (slant >= 66 && slant <= 71)), over = x >= 34 && x <= 43 && y <= 33;
      let c = skin;
      if (under) c = onBrow ? browCol.map((v, k) => 0.6 * v + 0.4 * hair[k]) as RGB : hair;
      else if (over) c = x === 34 || x === 43 || x === 22 + y ? line : hair;
      else if (onBrow) c = browCol;
      if (under || over) front[p] = 1;
      else if (onBrow) brow[p] = 1;
      if (under && onBrow) drawnOver[p] = 1;
      d.set([...c, 255], 4 * p);
    }
    const out = browAcross({ im: { w: W, h: H, d }, brow, front, browCol, midX, w: W, h: H });
    // the brow over the strands under it, all of it, and nothing of the strand over it, its lines included
    for (let p = 0; p < W * H; p++) expect(out[p]).toBe(drawnOver[p]);
    expect(drawnOver.reduce((a, v) => a + v, 0)).toBe(64);
  });
});

describe('virtual-host face zone', () => {
  it('keeps the skin between the strands over a brow as face, and no other yellow piece apart from the face', () => {
    // the face from row 30 down, x 20-79, with a brow over it on rows 30-33 (x 25-74) and the bangs above; between two
    // strands a pocket of forehead over the brow (x 40-49, rows 22-29), a piece of yellow among the strands 4 rows above
    // the brow (x 60-65, rows 22-25), and beside the head a purple blob with a yellow piece under it (x 2-8)
    const W = 100, H = 80, face = new Uint8Array(W * H), brow = new Uint8Array(W * H), want = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x, onBrow = y >= 30 && y <= 33 && x >= 25 && x <= 74;
      const inFace = y >= 30 && x >= 20 && x <= 79 && !onBrow, pocket = y >= 22 && y <= 29 && x >= 40 && x <= 49;
      if (onBrow || (y >= 50 && y <= 53 && x >= 2 && x <= 8)) brow[p] = 1;
      if (inFace || pocket || (y >= 22 && y <= 25 && x >= 60 && x <= 65) || (y >= 54 && y <= 57 && x >= 2 && x <= 8)) face[p] = 1;
      if (inFace || pocket) want[p] = 1;
    }
    const F = faceZone(face, brow, W, H);
    for (let p = 0; p < W * H; p++) expect(F!.zone[p]).toBe(want[p]);
    expect(F!.overBrows).toBe(80);
  });
});

describe('virtual-host bangs fill', () => {
  // a hole across hair (a brow on the bangs), rows y0 to y1 - 1 (25-34) of a 60 px tall picture, from x0 to x1
  const fillHole = (fill: typeof strandFill, pic: () => { w: number; h: number; d: Uint8ClampedArray }, x0: number, x1: number, y0 = 25, y1 = 35) => {
    const im = pic(), ref = pic(), { w, h } = im, hole = new Uint8Array(w * h);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hole[y * w + x] = 1;
    fill(im, hole, Uint8Array.from(hole, (v) => 1 - v), w, h);
    return { im, ref, w };
  };
  const strands = (slope: number) => () => {
    const w = 80, h = 60, d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dark = (((Math.floor((x - slope * y) / 3) % 2) + 2) % 2) === 0;
      d.set([...(dark ? [90, 50, 30] : [200, 140, 90]), 255], 4 * (y * w + x));
    }
    return { w, h, d };
  };

  it('runs the strands on through the hole, upright or at a slant, where a smooth fill blurs them out', () => {
    for (const slope of [0, 0.35]) {
      const err = (fill: typeof strandFill) => {
        const { im, ref, w } = fillHole(fill, strands(slope), 10, 70);
        let sum = 0, n = 0;
        for (let y = 26; y < 34; y++) for (let x = 20; x < 60; x++) { sum += Math.abs(im.d[4 * (y * w + x)] - ref.d[4 * (y * w + x)]); n++; }
        return sum / n;
      };
      expect(err(strandFill)).toBeLessThan(20);
      expect(err(smoothFill)).toBeGreaterThan(40);
    }
  });

  it('runs the strand lines on through the middle of a thick brow too, far from the hair round it', () => {
    // thin dark lines every 12 px at a slant on light hair; 24 rows of hole, so the middle rows are 12 px from the
    // hair, past the window the strands' way is first read from (a smooth fill there cut every line, 36 off)
    const lines = () => {
      const w = 80, h = 60, d = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (((x - 0.2 * y) % 12) + 12) % 12;
        d.set([...(u < 2 ? [90, 50, 30] : [220, 170, 130]), 255], 4 * (y * w + x));
      }
      return { w, h, d };
    };
    const { im, ref, w } = fillHole(strandFill, lines, 10, 70, 18, 42);
    let sum = 0, n = 0;
    for (let y = 26; y < 34; y++) for (let x = 20; x < 60; x++) { sum += Math.abs(im.d[4 * (y * w + x)] - ref.d[4 * (y * w + x)]); n++; }
    expect(sum / n).toBeLessThan(20);
  });

  it('fills flat hair smoothly: its faint shading is no strand to carry a line from far along the hole', () => {
    // shaded a level a pixel from top to bottom, and a dark line just past the hole's right end
    const shaded = () => {
      const w = 120, h = 60, d = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = 150 + y;
        d.set([...(x === 90 || x === 91 ? [v - 100, v - 100, v - 100] : [v + 40, v, v - 30]), 255], 4 * (y * w + x));
      }
      return { w, h, d };
    };
    const { im, ref, w } = fillHole(strandFill, shaded, 10, 90);
    let worst = 0;
    for (let y = 25; y < 35; y++) for (let x = 20; x < 76; x++) worst = Math.max(worst, Math.abs(im.d[4 * (y * w + x) + 1] - ref.d[4 * (y * w + x) + 1]));
    expect(worst).toBeLessThan(6);
  });
});
