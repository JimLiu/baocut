import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { findEyes, keySheet, measureBoards, neckRow, splitHead, trim, writePng } from '../skills/baocut/built-in-skills/character-animation/scripts/cutout.mjs';
import { analyse } from '../skills/baocut/built-in-skills/character-animation/scripts/jump-scan.mjs';
import { layoutItems, planPlacements } from '../skills/baocut/built-in-skills/character-animation/scripts/place-sfx.mjs';
import { checkBundle, loadBundle } from '../skills/baocut/built-in-skills/character-animation/scripts/rig-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'skills/baocut/built-in-skills/character-animation');

const tmpDirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-rig-'));
  tmpDirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

type Rect = [x: number, y: number, w: number, h: number, color: number[]];
const GREEN = [0, 177, 64];

function paint(w: number, h: number, background: number[], rects: Rect[]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) d.set([...background, 255], p * 4);
  for (const [x, y, rw, rh, c] of rects) {
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) d.set([...c, 255], (j * w + i) * 4);
  }
  return { w, h, d };
}

// A big-headed figure on chroma green: dot eyes, a narrow neck, a dark coat with a dark-green tie inside it.
const figure = () =>
  paint(400, 1000, GREEN, [
    [130, 60, 140, 200, [244, 160, 140]],
    [160, 130, 16, 16, [20, 20, 24]],
    [224, 130, 16, 16, [20, 20, 24]],
    [180, 260, 40, 40, [244, 160, 140]],
    [100, 300, 200, 300, [30, 40, 70]],
    [190, 340, 20, 80, [20, 90, 50]],
    [130, 600, 140, 340, [30, 40, 70]],
  ]);

describe('cutout', () => {
  it('keys only the border-connected background, so dark green inside the coat survives', () => {
    const keyed = keySheet(figure());
    expect(keyed.d[(10 * 400 + 10) * 4 + 3]).toBe(0);
    expect(keyed.d[(380 * 400 + 200) * 4 + 3]).toBe(255);
    expect(keyed.d[(450 * 400 + 200) * 4 + 3]).toBe(255);
    expect(keyed.touches).toBe(false);
  });

  it('works on other key colours', () => {
    const magenta = [255, 0, 255];
    const keyed = keySheet(paint(100, 100, magenta, [[30, 30, 40, 40, [40, 200, 80]]]));
    expect(keyed.d[(5 * 100 + 5) * 4 + 3]).toBe(0);
    expect(keyed.d[(50 * 100 + 50) * 4 + 1]).toBe(200);
  });

  it('reports a subject that touches the edge, which usually means it was cropped', () => {
    expect(keySheet(paint(100, 100, GREEN, [[30, 30, 40, 70, [30, 40, 70]]])).touches).toBe(true);
  });

  it('finds the neck under the head rather than a narrower waist further down', () => {
    const rgba = trim(keySheet(figure()));
    const y = neckRow(rgba) + rgba.y0;
    expect(y).toBeGreaterThanOrEqual(260);
    expect(y).toBeLessThan(300);
  });

  it('finds dot eyes and refills above the neck cut so a turning head shows no gap', () => {
    const rgba = trim(keySheet(figure()));
    const { head, body, neckY, neckX } = splitHead(rgba);
    expect(findEyes(rgba, neckY)).toHaveLength(2);
    expect(head.d[(neckY * rgba.w + Math.round(neckX)) * 4 + 3]).toBe(0);
    const filled = (neckY - 5) * rgba.w + Math.round(neckX);
    expect(body.d[filled * 4 + 3]).toBe(255);
    expect(body.d[filled * 4]).toBeGreaterThan(200);
  });

  it('measures blank boards as fractions of the plate, and dark boards on request', () => {
    const plate = paint(1000, 500, [120, 140, 160], [
      [100, 50, 300, 150, [250, 250, 250]],
      [600, 250, 300, 200, [30, 40, 50]],
    ]);
    const light = measureBoards(plate);
    expect(light).toHaveLength(1);
    expect(light[0].x).toBeCloseTo(0.1, 1);
    expect(light[0].w).toBeCloseTo(0.3, 1);
    const dark = measureBoards(plate, 'dark');
    expect(dark).toHaveLength(1);
    expect(dark[0].y).toBeCloseTo(0.5, 1);
  });
});

const png = (dir: string, name: string, w: number, h: number) => writePng(path.join(dir, name), { w, h, d: new Uint8ClampedArray(w * h * 4).fill(200) });

const FRONT = {
  kind: 'front', w: 400, h: 1000, neckY: 280, neckX: 200, eyes: [{ x: 170, y: 140, r: 8 }], skin: '#f4a08c', face: '#f4a08c',
  shoulders: { y: 355, lx: 110, rx: 290 }, sleeve: '#1e2846',
};
const WALK = { ...FRONT, kind: 'walk', hemY: 700, hipUp: 50, legX: 200, legW: 60, trouser: '#333333', trouserDark: '#222222' };

/** The shipped example scene as a real bundle, with stand-in art. */
function exampleBundle(extra: { scene?: (src: string) => string; words?: string[] } = {}) {
  const dir = tmp(), img = path.join(dir, 'img'), ex = path.join(skill, 'examples/mini-film');
  fs.mkdirSync(img);
  fs.cpSync(path.join(ex, 'index.html'), path.join(dir, 'index.html'));
  const scene = fs.readFileSync(path.join(ex, 'scene.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'scene.js'), extra.scene ? extra.scene(scene) : scene);
  fs.cpSync(path.join(skill, 'rig-kit/rig-kit.js'), path.join(dir, 'rig-kit.js'));
  const words = extra.words ?? 'built by farms not quite in 1909 so who did it she did'.split(' ');
  fs.writeFileSync(path.join(dir, 'words.js'), `window.WORDS = ${JSON.stringify(words.map((w, i) => ({ w, t0: 0.2 + i * 0.6, t1: 0.7 + i * 0.6 })))};`);
  fs.writeFileSync(
    path.join(dir, 'rig-data.js'),
    `window.RIG = ${JSON.stringify({
      plates: { hall: { file: 'hall.png', w: 1920, h: 1080, boards: [{ x: 0.2, y: 0.2, w: 0.3, h: 0.25 }] } },
      sprites: { guide: FRONT, visitor: WALK, flask: { kind: 'prop', w: 100, h: 200 } },
    })};`,
  );
  png(img, 'hall.png', 1920, 1080);
  png(img, 'flask.png', 100, 200);
  for (const n of ['guide_head', 'guide_body', 'visitor_head', 'visitor_body', 'visitor_legs', 'visitor_legs_dark']) png(img, `${n}.png`, 400, 1000);
  return dir;
}

describe('rig kit', () => {
  it('the shipped example runs clean through the rig check', async () => {
    const r = await checkBundle(exampleBundle());
    expect(r.problems).toEqual({});
    expect(r.timeline.cuts.map((c: { id: string }) => c.id)).toEqual(['sign', 'walk']);
    expect(r.timeline.wipes).toHaveLength(1);
    expect(r.timeline.events.map((e: { s: string }) => e.s)).toEqual(expect.arrayContaining(['tick', 'hit', 'whoosh', 'pop']));
  });

  it('flags arms that cannot reach and arms aimed across the body', async () => {
    const bad = await checkBundle(
      exampleBundle({ scene: src => src.replace("l: { aim: [b.x + b.w / 2, b.y + b.h / 2 - 30 * Math.sin(t * 3)], pose: 'point' }", "l: { x: 100, y: 100, pose: 'point' }, r: { aim: [100, 500], pose: 'point' }").replace("r: R.swing(t, tNo, undefined, { at: [-0.3, 0.85], pose: 'open' }),", '') }),
    );
    const flags = Object.values(bad.problems).flatMap(p => Object.keys(p as object));
    expect(flags).toContain('overreach');
    expect(flags).toContain('across');
  });

  it('flags WOFF fonts, which the instruction bake cannot read', async () => {
    const dir = exampleBundle();
    const html = path.join(dir, 'index.html');
    fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('title.ttf', 'title.woff2'));
    expect(Object.keys((await checkBundle(dir)).problems)).toContain('fonts must be TTF or OTF');
  });

  it('refuses a repeated phrase without an occurrence number', async () => {
    const dir = exampleBundle({ words: 'built by farms not quite in 1909 so who did it she did she did'.split(' ') });
    await expect(loadBundle(dir)).rejects.toThrow(/said 2 times/);
  });

  it('finds cues in text without spaces, on word boundaries', async () => {
    const { sandbox } = await loadBundle(exampleBundle());
    const R = sandbox.RigKit;
    R.voice([{ w: '其实', t0: 1, t1: 2 }, { w: '不是', t0: 2, t1: 3 }, { w: '这样', t0: 3, t1: 4 }]);
    expect(R.cue('不是这样')).toBe(2);
    expect(R.cueEnd('不是这样')).toBe(4);
    expect(() => R.cue('是这')).toThrow(/no cue/);
  });

  it('bends a raised elbow downward, a hanging elbow outward, and never jumps as the hand sweeps', async () => {
    const { sandbox } = await loadBundle(exampleBundle());
    const solve = sandbox.RigKit.armSolve;
    const m = { h: 918 };
    const out = solve(m, 0, 0, 180, 0, 1);
    expect(out.ey).toBeGreaterThan(0);
    const hanging = solve(m, 0, 0, 30, 180, 1);
    expect(hanging.ex).toBeGreaterThan(hanging.hx * (hanging.ey / hanging.hy));
    let prev = solve(m, 0, 0, 0, 190, 1);
    for (let a = Math.PI / 2; a > -Math.PI / 2; a -= 0.02) {
      const q = solve(m, 0, 0, Math.cos(a) * 190, Math.sin(a) * 190, 1);
      expect(Math.hypot(q.ex - prev.ex, q.ey - prev.ey)).toBeLessThan(40);
      prev = q;
    }
  });

  it('swings between specs without snapping, including to and from the idle arm', async () => {
    const { sandbox } = await loadBundle(exampleBundle());
    const { swing } = sandbox.RigKit;
    const point = { at: [0, 0.9], pose: 'point' };
    expect(swing(1, 2, undefined, point)).toBeUndefined();
    expect(swing(3, 2, undefined, point)).toBe(point);
    const mid = swing(2.08, 2, point, undefined);
    expect(mid.from).toBe(point);
    expect(mid.to).toBeUndefined();
    expect(mid.k).toBeGreaterThan(0);
    expect(mid.k).toBeLessThan(1);
  });
});

describe('sound placement', () => {
  it('thins typing ticks but keeps other events', () => {
    const events = [0, 0.03, 0.06, 0.09, 0.2].map(t => ({ s: 'tick', t })).concat({ s: 'hit', t: 0.21 });
    const out = planPlacements(events, { tickGap: 0.07, offset: 1 });
    expect(out.filter(p => p.s === 'tick').map(p => p.at)).toEqual([1, 1.09, 1.2]);
    expect(out.filter(p => p.s === 'hit')).toHaveLength(1);
  });

  it('puts the loudest point of a whoosh on the event and never overlaps clips on one track', () => {
    const assets = { whoosh: { seconds: 0.4 }, pop: { seconds: 0.5 } };
    const placements = [{ s: 'whoosh', at: 1 }, { s: 'pop', at: 2 }, { s: 'pop', at: 2.1 }, { s: 'pop', at: 3 }];
    const { items, lanes } = layoutItems(placements, assets, 30);
    expect(items[0].fromFrame).toBe(24);
    expect(lanes).toEqual({ whoosh: 1, pop: 2 });
    expect(items.map((i: { lane: number }) => i.lane)).toEqual([0, 0, 1, 0]);
  });
});

describe('jump scan', () => {
  const steady = Array.from({ length: 300 }, () => 0.5);
  const timeline = { cuts: [{ t: 0 }, { t: 2 }], wipes: [4] };

  it('accepts jumps on cuts and wipes and reports the rest', () => {
    const d = [...steady];
    d[119] = 20;
    d[239] = 20;
    d[59] = 20;
    const r = analyse(d, [], 60, timeline);
    expect(r.planned).toBe(2);
    expect(r.unplanned).toEqual([1]);
  });

  it('reports a picture that holds still too long', () => {
    expect(analyse(Array.from({ length: 120 }, () => 0), [], 60, timeline).stillTooLong).toBe(true);
    expect(analyse(steady, [], 60, timeline).stillTooLong).toBe(false);
  });
});
