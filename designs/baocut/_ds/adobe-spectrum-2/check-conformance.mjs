#!/usr/bin/env node
/*
 * Spectrum 2 conformance checker.
 *
 *   node _ds/adobe-spectrum-2/check-conformance.mjs \
 *     --token-file app/tokens.css app/*.css app/*.jsx app/*.js
 *
 * The binding is checked, not imported: one file in the project carries the
 * generated token block, and every literal value in every checked file is
 * measured against the same token data.
 *
 *   --token-file <path>   the one file that must carry the token block.
 *                         Criterion A runs against it alone; the other files
 *                         skip A and still run B–F. Omit it and every file
 *                         must carry its own block — the self-contained
 *                         artboard case this checker started as.
 *   --strict-height <s>   also treat the control-height scale as a HARD
 *                         criterion for files whose path contains <s>
 *                         (repeatable). Everywhere else it stays advisory.
 *
 * Exits non-zero when anything is off-system. Deliberate deviations (media
 * stills, brand-free demo art, OS chrome) are declared with a reason in
 * _ds_conformance.json at the project root. `allow` may be a flat
 * { "#HEX": "reason" } map that applies everywhere, or scoped per file:
 * { "app/data.js": { "#HEX": "reason" }, "*": { … } }.
 */
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKENS = JSON.parse(fs.readFileSync(path.join(HERE, 'tokens', 'tokens.json'), 'utf8'));
const GEOM = JSON.parse(fs.readFileSync(path.join(HERE, 'components', 'control-geometry.json'), 'utf8'));

/* ---------- argv ---------- */
const argv = process.argv.slice(2);
const files = [];
let tokenFile = null;
const strictHeight = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--token-file') { tokenFile = argv[++i]; continue; }
  if (a === '--strict-height') { strictHeight.push(argv[++i]); continue; }
  if (a.startsWith('--')) continue;
  files.push(a);
}
if (!files.length) {
  console.error('usage: check-conformance.mjs [--token-file <path>] [--strict-height <substr>] <file> [...]');
  process.exit(2);
}
if (tokenFile && !files.some((f) => path.resolve(f) === path.resolve(tokenFile))) files.unshift(tokenFile);
const tokenFileAbs = tokenFile ? path.resolve(tokenFile) : null;
if (tokenFileAbs && !fs.existsSync(tokenFileAbs)) {
  console.error(`--token-file ${tokenFile} does not exist`);
  process.exit(2);
}
// ui.css owns the control atoms, so its heights are held to the hard scale by default
if (!strictHeight.length) strictHeight.push('/ui.css');

/* ---------- conformance config ---------- */
// walk up from the first checked file to find _ds_conformance.json
let cfgPath = null;
for (let dir = path.dirname(path.resolve(files[0])), i = 0; i < 6; i++, dir = path.dirname(dir)) {
  const p = path.join(dir, '_ds_conformance.json');
  if (fs.existsSync(p)) { cfgPath = p; break; }
}
const CFG = cfgPath ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {allow: {}};
const projectRoot = cfgPath ? path.dirname(cfgPath) : path.dirname(path.resolve(files[0]));

const rawAllow = CFG.allow || {};
const scoped = Object.values(rawAllow).some((v) => v && typeof v === 'object');
/** hexes allowed in `file` (project-relative POSIX path) */
function allowedFor(rel) {
  const out = new Set();
  const take = (map) => { for (const h of Object.keys(map || {})) out.add(h.toUpperCase()); };
  if (!scoped) { take(rawAllow); return out; }
  for (const [key, map] of Object.entries(rawAllow)) {
    if (typeof map !== 'object' || map === null) continue;
    if (key === '*' || rel === key || rel.endsWith('/' + key)) take(map);
  }
  return out;
}

/* ---------- what the token data permits ---------- */
const tokenHex = new Set();
for (const v of Object.values(TOKENS.colors)) {
  if (v.light) tokenHex.add(v.light.toUpperCase());
  if (v.dark) tokenHex.add(v.dark.toUpperCase());
}
const FONT_SIZES = new Set(GEOM.fontSize.scale);
const RADII = new Set([...GEOM.cornerRadius.scale, 999, 9999]);
const HEIGHTS = new Set([...Object.values(GEOM.controlHeight.scale), ...Object.values(GEOM.smallControlSize.scale), 56, 64]);
const DURATION = GEOM.motion.duration;
const EASE = GEOM.motion.timingFunction.replace(/\s+/g, '');

const norm = (h) => {
  h = h.toUpperCase();
  return h.length === 4 ? '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] : h;
};

/* ---------- the generated block the project must carry ---------- */
const expectedBlock = () =>
  fs.readFileSync(path.join(HERE, 'tokens', 'artboard-tokens.css'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('/*')).join('\n');

let failures = 0;
const report = [];
let sawTokenBlock = false;

for (const file of files) {
  const abs = path.resolve(file);
  const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
  const txt = fs.readFileSync(abs, 'utf8');
  const lines = txt.split('\n');
  const allowed = allowedFor(rel);
  const hardHeight = strictHeight.some((s) => rel.includes(s) || abs.includes(s));
  const issues = [];
  const add = (kind, line, msg, advisory = false) => issues.push({kind, line, msg, advisory});

  /* A — token block present and byte-identical to the generated one.
     With --token-file, only that file is required to carry it. */
  const m = txt.match(/\/\* @ds tokens: adobe-spectrum-2 \*\/([\s\S]*?)\/\* @ds end \*\//);
  const ownsBlock = tokenFileAbs ? abs === tokenFileAbs : true;
  if (ownsBlock) {
    if (!m) {
      add('token-block', 0, 'missing the generated token block (/* @ds tokens: adobe-spectrum-2 */ … /* @ds end */)');
    } else {
      sawTokenBlock = true;
      const got = m[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('/*')).join('\n');
      if (got !== expectedBlock()) {
        const g = new Set(got.split('\n')), e = new Set(expectedBlock().split('\n'));
        const drift = [...e].filter((l) => !g.has(l)).slice(0, 6);
        const extra = [...g].filter((l) => !e.has(l)).slice(0, 6);
        add('token-block', txt.slice(0, m.index).split('\n').length,
          'token block drifted from tokens/artboard-tokens.css' +
          (drift.length ? '\n      missing: ' + drift.join(' ') : '') +
          (extra.length ? '\n      unexpected: ' + extra.join(' ') : ''));
      }
    }
  } else if (m) {
    add('token-block', txt.slice(0, m.index).split('\n').length,
      `a second token block lives here; --token-file points at ${path.relative(projectRoot, tokenFileAbs)}. One copy only.`);
  }

  // line range covered by the generated token block — its values are the
  // system's own and must not be re-flagged as literals
  const blockStart = m ? txt.slice(0, m.index).split('\n').length : -1;
  const blockEnd = m ? blockStart + m[0].split('\n').length - 1 : -1;

  lines.forEach((ln, i) => {
    const n = i + 1;
    if (n >= blockStart && n <= blockEnd) return;
    // a line opts out with a stated reason, on the line itself or the one above
    // it (long data lines read better with the reason on its own line):
    //   /* @ds-allow: it draws the OS window, not an S2 surface */
    if (/@ds-allow:/.test(ln) || (i > 0 && /@ds-allow:/.test(lines[i - 1]))) return;

    /* B — colors */
    for (const c of ln.matchAll(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g)) {
      // a run of hex digits inside a word (an id like #084 in a log line) is not a color
      const before = ln[c.index - 1];
      if (before && /[\w>]/.test(before)) continue;
      const h = norm(c[0]);
      if (tokenHex.has(h) || allowed.has(h)) continue;
      add('color', n, `${h} is not a Spectrum token and is not declared in _ds_conformance.json`);
    }

    /* C — type ramp */
    for (const f of ln.matchAll(/font-size:\s*([0-9.]+)px/g)) {
      const px = parseFloat(f[1]);
      if (!FONT_SIZES.has(px)) add('font-size', n, `${px}px is off the S2 ramp (${[...FONT_SIZES].slice(0, 9).join('/')}…)`);
    }

    /* D — corner radius */
    for (const r of ln.matchAll(/border-radius:\s*([0-9.]+)px/g)) {
      const px = parseFloat(r[1]);
      if (!RADII.has(px)) add('radius', n, `${px}px is off the S2 radius scale (${GEOM.cornerRadius.scale.join('/')} or pill)`);
    }

    /* E — motion */
    for (const d of ln.matchAll(/(\d+)ms\s+cubic-bezier\(([^)]*)\)/g)) {
      if (parseInt(d[1]) !== DURATION) add('motion', n, `${d[1]}ms transition; S2 default is ${DURATION}ms`);
      if (('cubic-bezier(' + d[2] + ')').replace(/\s+/g, '') !== EASE) add('motion', n, `easing ${d[2]} is not the S2 default curve`);
    }
  });

  /* F — control heights. Only rules that look like a control are measured: the
     same rule has to carry a border-radius AND a padding. A hand-written
     stylesheet spreads a rule over many lines, so CSS is scanned per rule
     block; everything else (JSX inline styles) stays line-scoped.
     Advisory by default; a hard failure in a --strict-height file, because
     that file owns the control atoms and a stray value there leaks into every
     screen. */
  const isCss = /\.css$/.test(abs);
  const looksLikeControl = (body) => /border-radius\s*:/.test(body) && /(^|[^-])padding\s*:/.test(body);
  const measureHeights = (body, lineOf) => {
    for (const h of body.matchAll(/(?<!line-|max-|min-)height:\s*([0-9.]+)px/g)) {
      const px = parseFloat(h[1]);
      if (HEIGHTS.has(px)) continue;
      add('control-height', lineOf(h.index),
        `${px}px is off the control scale (${Object.values(GEOM.controlHeight.scale).join('/')})`,
        !hardHeight);
    }
  };

  if (isCss) {
    // walk top-level rule blocks; skip at-rules (@media/@keyframes) wholesale
    const lineAt = (idx) => txt.slice(0, idx).split('\n').length;
    const re = /([^{}]*)\{([^{}]*)\}/g;
    for (const m of re.exec.call ? [...txt.matchAll(re)] : []) {
      const sel = m[1];
      const body = m[2];
      if (/@/.test(sel)) continue;
      const bodyStart = m.index + m[1].length + 1;
      const head = lineAt(m.index);
      const bodyLines = txt.slice(0, bodyStart).split('\n').length;
      // a stated reason on the selector line or the one above it exempts the rule
      const above = lines[head - 2] || '';
      if (/@ds-allow:/.test(lines[head - 1] || '') || /@ds-allow:/.test(above)) continue;
      if (!looksLikeControl(body)) continue;
      measureHeights(body, (off) => bodyLines + body.slice(0, off).split('\n').length - 1);
    }
  } else {
    lines.forEach((ln, i) => {
      if (!/height:\s*[0-9.]+px/.test(ln)) return;
      if (/@ds-allow:/.test(ln) || (i > 0 && /@ds-allow:/.test(lines[i - 1]))) return;
      if (!looksLikeControl(ln)) return;
      measureHeights(ln, () => i + 1);
    });
  }

  const hard = issues.filter((x) => !x.advisory);
  failures += hard.length;
  report.push({file: rel || file, issues});
}

if (tokenFileAbs && !sawTokenBlock) {
  // already reported as a token-block failure on that file; nothing extra to say
}

for (const {file, issues} of report) {
  const hard = issues.filter((x) => !x.advisory);
  const soft = issues.filter((x) => x.advisory);
  console.log(`\n${file} — ${hard.length} off-system, ${soft.length} advisory`);
  const byKind = {};
  for (const x of issues) (byKind[x.kind] = byKind[x.kind] || []).push(x);
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`  ${kind} (${list.length})`);
    for (const x of list.slice(0, 12)) console.log(`    line ${x.line}: ${x.msg}`);
    if (list.length > 12) console.log(`    … ${list.length - 12} more`);
  }
}
console.log(`\n${failures ? 'FAIL' : 'ok'} — ${failures} off-system value(s) across ${files.length} file(s)`);
process.exit(failures ? 1 : 0);
