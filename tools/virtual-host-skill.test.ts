import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ACTS, actAt, buildTrack, facesOf, fineTimeline, levelsOf, MOUTH, OPEN_RANGE, quantize, STEP, TRACK_FPS, unitsFromWords } from '../skills/baocut/built-in-skills/virtual-host/scripts/lipsync.mjs';
import { writePng } from '../skills/baocut/built-in-skills/virtual-host/scripts/puppet/png.mjs';
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

  type Track = { format: string; version: number; fps: number; duration: number; params: Record<string, number[]>; expressions?: Record<string, number[]> };
  type Built = { track: Track; shapes: string[] };
  const at = (a: number[], k: number) => a[Math.min(k, a.length - 1)];

  it('writes a 120 fps puppet track whose mouth follows the shapes', () => {
    const units = unitsFromWords(words, 'zh-CN');
    const { track, shapes } = buildTrack({ units, dur: 2, seed: 1 }) as Built;
    expect(track).toMatchObject({ format: 'baocut-puppet-track', version: 1, fps: TRACK_FPS, duration: 2 });
    expect(Object.keys(track.params).sort()).toEqual(['angleX', 'angleY', 'angleZ', 'mouthOpen', 'vowel']);
    for (const ch of Object.values(track.params)) {
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
    expect(Math.max(...track.params.angleY.map(Math.abs))).toBeLessThan(30);
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
    expect(c.params.angleX).not.toEqual(a.params.angleX);
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

  it('plays one-shot acts from faces.json on the head, in place of the syllable nods they overlap', () => {
    const units = unitsFromWords(words, 'zh-CN');
    const { list, acts } = facesOf([{ line: 1, act: 'nod' }, { t0: 1.2, t1: 2, face: 'smile', act: 'shake' }], units);
    expect(list).toEqual([[1.2, 2, 'smile']]);
    // a line's act starts on its first word, a span's on t0
    expect(acts).toEqual([[units[0].t0, 'nod'], [1.2, 'shake']]);
    expect(() => facesOf([{ line: 1, act: 'hop' }], units)).toThrow(/act must be one of nod, shake, tilt, shy/);
    expect(() => facesOf([{ line: 1 }], units)).toThrow(/needs a face .* or an act/);
    // the curves: shake turns the head ±13°, nod dips it down, tilt leans it; all ease in and out to nothing
    const peak = (id: string, k: number) => Math.max(...Array.from({ length: 400 }, (_, i) => Math.abs(actAt(id, (i / 400) * ACTS[id as keyof typeof ACTS])[k])));
    expect(peak('shake', 0)).toBeCloseTo(13, 0);
    expect(Math.min(...Array.from({ length: 100 }, (_, i) => actAt('nod', i / 100)[1]))).toBeLessThan(-9);
    expect(peak('tilt', 2)).toBeCloseTo(11, 0);
    for (const id of Object.keys(ACTS)) {
      expect(actAt(id, 0).every((v: number) => v === 0)).toBe(true);
      expect(actAt(id, ACTS[id as keyof typeof ACTS] + 0.01).every((v: number) => v === 0)).toBe(true);
    }
    // on the track the act adds to the head's own motion and the nods under it are dropped
    const base = buildTrack({ units, dur: 3, seed: 2 }) as Built & { nods: [number, number][] };
    const shook = buildTrack({ units, dur: 3, seed: 2, faces: [{ t0: 0.1, t1: 1.4, act: 'shake' }] }) as Built & { nods: [number, number][]; acts: [number, string][] };
    expect(shook.acts).toEqual([[0.1, 'shake']]);
    expect(base.nods.some(([t]) => t > -0.1 && t < 1.15)).toBe(true);
    expect(shook.nods.some(([t]) => t > -0.1 && t < 1.15)).toBe(false);
    for (let k = 0; k < 3 * TRACK_FPS; k += 7) {
      const d = at(shook.track.params.angleX, k) - at(base.track.params.angleX, k);
      expect(Math.abs(d - actAt('shake', k / TRACK_FPS - 0.1)[0])).toBeLessThan(0.02);
    }
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

function drawCharacter({ line = [24, 20, 22] as RGB, hair = [120, 62, 32] as RGB, iris = null as RGB | null } = {}) {
  const skin: RGB = [252, 212, 180], white: RGB = [255, 255, 255], dark: RGB = [70, 20, 26], green: RGB = [0, 177, 64];
  const neck = { inside: rect(222, 300, 290, 470), fill: skin, outline: 6 };
  const body = { inside: ell(256, 560, 170, 150), fill: [150, 120, 210] as RGB, outline: 6 };
  const head = { inside: ell(256, 228, 100, 118), fill: skin, outline: 6 };
  // a bob: a cap over the forehead and locks down both sides of the face
  const hairShape = { inside: (x: number, y: number) => ell(256, 214, 120, 126)(x, y) && y < 290 && (y < 168 || !ell(256, 228, 93, 111)(x, y)), fill: hair, outline: 6 };
  const eye = (cx: number): Shape[] => [
    { inside: ell(cx, 238, 21, 15), fill: white, outline: 2 },
    { inside: ell(cx, 239, 9, 10), fill: iris ?? line, outline: 2 },
    { inside: ell(cx + 3, 235, 2.6, 2.6), fill: white },
  ];
  const lid = (cx: number): Shape[] => [
    { inside: ell(cx, 238, 22, 16), fill: skin },
    { inside: stroke((x) => 238 + 6 * (1 - ((x - cx) / 21) ** 2), cx - 21, cx + 21, 1.8), fill: line },
  ];
  const brow = (cx: number): Shape => ({ inside: stroke((x) => 206 - 4 * (1 - ((x - cx) / 22) ** 2), cx - 22, cx + 22, 3), fill: line });
  // angry: brows pulled down toward the nose, the upper lids lowered flat over the irises, a blush on the cheeks
  const vBrow = (cx: number): Shape => ({ inside: stroke((x) => 198 + 10 * (cx < 256 ? x - (cx - 22) : cx + 22 - x) / 44, cx - 22, cx + 22, 3), fill: line });
  const narrowed = (cx: number): Shape[] => [
    { inside: (x, y) => ell(cx, 238, 22, 16)(x, y) && y < 233, fill: skin },
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
    frown: [clear, { inside: stroke((x) => 300 + 6 * ((x - 256) / 22) ** 2, 234, 278, 2.5), fill: line }],
  };
  const draw = ({ bald = false, brows = [brow(214), brow(298)], eyes = [...eye(214), ...eye(298)], mouth = mouths.rest, cheeks = [] as Shape[] } = {}) =>
    render([neck, body, head, ...(bald ? [] : [hairShape]), ...brows, ...eyes, ...cheeks, ...mouth], line, green);
  return {
    portrait: draw(),
    bald: draw({ bald: true }),
    lids: draw({ eyes: [...lid(214), ...lid(298)] }),
    half: draw({ mouth: mouths.half }),
    open: draw({ mouth: mouths.open }),
    round: draw({ mouth: mouths.round }),
    wide: draw({ mouth: mouths.wide }),
    smile: draw({ mouth: mouths.smile }),
    angry: draw({ brows: [vBrow(214), vBrow(298)], eyes: [...eye(214), ...eye(298), ...narrowed(214), ...narrowed(298)], mouth: mouths.frown, cheeks: [blush(198), blush(314)] }),
  };
}

function writeCharacter(dir: string, look: Parameters<typeof drawCharacter>[0] = {}, mouths?: Record<string, string>) {
  fs.mkdirSync(path.join(dir, 'art'), { recursive: true });
  for (const [k, im] of Object.entries(drawCharacter(look))) writePng(path.join(dir, `art/${k}.png`), im);
  const cfg = {
    name: 'synth', portrait: 'art/portrait.png', bald: 'art/bald.png',
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
    expect(model.rig).toBeUndefined();
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
    expect(note('angry')).toMatch(/px patch: eyes, brows, blush, mouth$/);
    type Layer = { id: string; x: number; y: number; w: number; h: number; texture: string; talk?: string; brows?: string; role?: string; expression?: string };
    const layers = (JSON.parse(fs.readFileSync(path.join(path.dirname(cfg), 'puppet/package/model.json'), 'utf8')) as { layers: Layer[] }).layers;
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
  });

  it('measures coloured line art: brown outlines, irises and hair', () => {
    const { status, report } = build(writeCharacter(tmp(), { line: [70, 30, 14], hair: [150, 90, 50], iris: [120, 70, 40] }));
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(status).toBe(0);
    const [r, g, b] = report.checks.find((c) => c.item === 'portrait')!.note.match(/line (\d+),(\d+),(\d+)/)!.slice(1).map(Number);
    expect(Math.abs(r - 70) + Math.abs(g - 30) + Math.abs(b - 14)).toBeLessThan(16);
  });

  it('says which edit to redo when the mouths do not open in steps', () => {
    const cfg = writeCharacter(tmp(), {}, { half: 'art/open.png', open: 'art/half.png' });
    const { status, stdout } = build(cfg);
    expect(status).toBe(1);
    expect(stdout).toMatch(/^FIX {2}mouth ladder: half 28 px tall, open 12 px; open must be taller than half$/m);
  });
});
