#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// The mask for the bald repaint: the portrait's hair (as puppet-build.mjs finds it), grown 4 px, as strokes for the
// retouch tool's repaint (`mask: { strokes }`). Plain Node >= 22.
//
//   node puppet-mask.mjs <character.json> [out.json]
//
// Reads "portrait" (and "skin" / "line" / "hair" when set) from character.json. Writes out.json (default: hair-mask.json next
// to character.json) and out.png, the mask to look at: white is what gets repainted.
import fs from 'node:fs';
import path from 'node:path';
import { readImage, writeGray } from './puppet/png.mjs';
import { segment } from './puppet/segment.mjs';
import { maskStrokes } from './puppet/seg.mjs';
import { dilate, count, bbox } from './puppet/ops.mjs';

// what the retouch tool takes
const MAX_STROKES = 500, MAX_SHARE = 0.6;

const [cfgArg, outArg] = process.argv.slice(2);
if (!cfgArg) {
  console.error('usage: node puppet-mask.mjs <character.json> [out.json]');
  process.exit(2);
}
const cfgPath = path.resolve(cfgArg);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
if (!cfg.portrait) {
  console.error('FIX  config: "portrait" is required');
  process.exit(1);
}
const out = path.resolve(outArg ?? path.join(path.dirname(cfgPath), 'hair-mask.json'));
const im = readImage(path.resolve(path.dirname(cfgPath), cfg.portrait)), { w, h } = im;
let G;
try {
  G = segment(im, { skin: cfg.skin, line: cfg.line, hair: cfg.hair, glasses: cfg.glasses });
} catch (e) {
  console.error(`FIX  portrait: ${e.message}`);
  process.exit(1);
}
const m = dilate(G.hair, w, h, 4);
const share = count(m) / (w * h);
if (share > MAX_SHARE) {
  console.error(`FIX  the hair mask covers ${(100 * share).toFixed(1)}% of the image (the repaint takes at most 60%): make the character smaller in the frame`);
  process.exit(1);
}
// one stroke per run of each row band; coarser bands until the count fits (a stroke's radius covers its band)
let step = 4, strokes = maskStrokes(m, w, h, step, 3);
while (strokes.length > MAX_STROKES) {
  step += 2;
  strokes = maskStrokes(m, w, h, step, Math.ceil(step / 2) + 1);
}
fs.writeFileSync(out, JSON.stringify({ strokes }) + '\n');
writeGray(out.replace(/\.json$/, '') + '.png', w, h, m.map((v) => v * 255));
console.log(`ok   hair mask: ${count(G.hair)} px of hair in ${bbox(G.hair, w, h)}, ${(100 * share).toFixed(1)}% of the image, ${strokes.length} strokes -> ${out}`);
