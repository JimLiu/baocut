#!/usr/bin/env node
// i18n-ignore-file: 给智能体用的独立脚本，lint 文案不进文案目录
// 把一份按 motion-graphics 骨架写好的自包含 HTML 打成 BaoCut 代码包（HyperFrames 合同），并先做静态 lint。
//
//   node build-bundle.mjs --html <index.html> --out <dir> [--bundle-id <id>] [--revision <r>]
//                         [--alpha true|false] [--lint-only] [--verify]
//
// 输出 <out>/<revision>/：index.html、files.manifest.json、bundle.manifest.json、dependency.lock、build.recipe.json；
// --verify 再用 Electron 离屏窗口逐个时刻 seek、截图、检查，写 <out>/<revision>/verification.json，截图放包外的 <out>/<revision>-preview/<t>.png。
// 结果以 JSON 打到 stdout；lint 或验证失败时退出码 1。无 npm 依赖；--verify 需要能解析到 electron 包。
// 也可以被 import：导出 lintHtml(html) 与 buildBundle(opts)。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TOOL = 'motion-graphics/build-bundle';
export const TOOL_VERSION = '1.0.0';
export const MAX_HTML_BYTES = 512 * 1024;

const REQUIRED_ROOT_ATTRS = [
  'data-composition-id',
  'data-start',
  'data-width',
  'data-height',
  'data-duration',
  'data-fps',
  'data-aspect-ratio',
  'data-structure',
  'data-layout',
  'data-motion',
];
const POSITIVE_ROOT_ATTRS = ['data-width', 'data-height', 'data-fps', 'data-duration'];
const TOKENS = ['--ink', '--panel', '--accent'];

// 出场窗口：开始不早于 duration−0.8，结束不晚于 duration−0.05；停留：最后一个入场到出场开始至少 1.2 s。
const EXIT_EARLIEST_START = 0.8;
const EXIT_LATEST_END = 0.05;
const MIN_HOLD = 1.2;
const MIN_FIRST_START = 0.02;
const MIN_WINDOW = 0.2;
const MAX_WINDOW = 2.0;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** 字符偏移 → 1 起的行号。 */
function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** 从 open（指向 '(' 或 '{'）开始找配对的闭括号，返回其下标；找不到返回 -1。不处理字符串里的括号，骨架写法足够。 */
function matchBracket(src, open) {
  const pair = { '(': ')', '{': '}', '[': ']' };
  const close = pair[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close && --depth === 0) return i;
  }
  return -1;
}

/** 按顶层逗号切分参数串。 */
function splitArgs(src) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of src) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** 只认数字、DURATION 与四则运算的表达式；别的（循环变量等）返回 null，表示无法静态求值。 */
function evalTime(expr, duration) {
  const replaced = expr.replace(/\bDURATION\b/g, `(${duration})`);
  if (!/^[\d.\s+\-*/()]+$/.test(replaced)) return null;
  try {
    const v = Function(`"use strict";return (${replaced});`)();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** 在 Math.sin/Math.cos 的参数里：周期性的持续动效（pulse 等），不算入场窗口。 */
function insidePeriodic(src, index) {
  const lineStart = src.lastIndexOf('\n', index) + 1;
  const before = src.slice(lineStart, index);
  const re = /Math\.(?:sin|cos)\(/g;
  let m;
  while ((m = re.exec(before))) {
    const open = lineStart + m.index + m[0].length - 1;
    const close = matchBracket(src, open);
    if (close === -1 || close > index) return true;
  }
  return false;
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return attrs;
}

/**
 * 静态检查一份 HTML。返回 { ok, issues: [{code, message, line?}], warnings, meta }。
 * meta 带 width/height/fps/duration/compositionId 与时间包络（firstStart、entranceEnd、exitStart、exitEnd），供 build 与 verify 使用。
 */
export function lintHtml(html) {
  const issues = [];
  const warnings = [];
  const add = (code, message, index) => issues.push(index === undefined ? { code, message } : { code, message, line: lineAt(html, index) });
  const meta = { compositionId: null, width: null, height: null, fps: null, duration: null, continuous: false, windows: [] };

  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_HTML_BYTES) add('FILE_TOO_LARGE', `HTML 有 ${bytes} 字节，超过上限 ${MAX_HTML_BYTES}`);

  // 根元素
  const rootMatch = /<([a-z][\w-]*)\b[^>]*(?<![\w-])id\s*=\s*["']root["'][^>]*>/i.exec(html);
  if (!rootMatch) {
    add('ROOT_MISSING', '找不到 id="root" 的根元素');
  } else {
    const attrs = parseAttrs(rootMatch[0].slice(rootMatch[1].length + 1, -1));
    for (const name of REQUIRED_ROOT_ATTRS) {
      if (!(name in attrs) || attrs[name].trim() === '') add('ROOT_ATTR_MISSING', `根元素缺少 ${name}`, rootMatch.index);
    }
    for (const name of POSITIVE_ROOT_ATTRS) {
      if (!(name in attrs)) continue;
      const v = Number(attrs[name]);
      if (!Number.isFinite(v) || v <= 0) add('ROOT_ATTR_INVALID', `${name}="${attrs[name]}" 不是正数`, rootMatch.index);
    }
    if ('data-start' in attrs && Number(attrs['data-start']) !== 0) add('ROOT_ATTR_INVALID', 'data-start 必须为 0', rootMatch.index);
    meta.compositionId = attrs['data-composition-id'] || null;
    meta.width = Number(attrs['data-width']) || null;
    meta.height = Number(attrs['data-height']) || null;
    meta.fps = Number(attrs['data-fps']) || null;
    meta.duration = Number(attrs['data-duration']) || null;
    meta.continuous = attrs['data-motion-continuous'] === 'true';
  }

  // viewport 与根尺寸一致
  const viewport = /<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i.exec(html);
  if (!viewport) add('VIEWPORT_MISSING', '缺少 <meta name="viewport" content="width=W,height=H">');
  else if (meta.width && meta.height) {
    const content = parseAttrs(viewport[0]).content || '';
    const w = /width\s*=\s*(\d+)/.exec(content)?.[1];
    const h = /height\s*=\s*(\d+)/.exec(content)?.[1];
    if (Number(w) !== meta.width || Number(h) !== meta.height)
      add('VIEWPORT_MISMATCH', `viewport（${content}）与根元素 ${meta.width}×${meta.height} 不一致`, viewport.index);
  }

  // 时间线登记
  const registry = /window\.__timelines\s*=\s*\{([^}]*)\}/.exec(html);
  if (!registry) add('TIMELINE_REGISTRY_MISSING', '缺少 window.__timelines = { [compositionId]: timeline }');
  else {
    const body = registry[1];
    const id = meta.compositionId ?? 'main';
    const literal = new RegExp(`(^|[\\s,{])(["'\`]?)${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\2\\s*:`).test(body);
    const computed =
      /\[\s*(COMPOSITION_ID|[\w.]*compositionId)\s*\]\s*:/.test(body) && /dataset\.compositionId|data-composition-id/.test(html);
    if (!literal && !computed) add('TIMELINE_REGISTRY_MISSING', `window.__timelines 没有登记 composition "${id}"`, registry.index);
  }

  // 统一出场
  const exitRe =
    /const\s+exit\s*=\s*1\s*-\s*easeInOut\(\s*range\(\s*time\s*,([^,]+),([^)]+)\)\s*\)\s*;\s*scene\.style\.opacity\s*=\s*String\(\s*exit\s*\)/;
  const exitMatch = exitRe.exec(html);
  let exitIndex = -1;
  if (!exitMatch)
    add(
      'EXIT_MISSING',
      '缺少统一出场：const exit = 1 - easeInOut(range(time, DURATION - a, DURATION - b)); scene.style.opacity = String(exit);',
    );
  else if (meta.duration) {
    exitIndex = exitMatch.index + exitMatch[0].indexOf('range(');
    const start = evalTime(exitMatch[1].trim(), meta.duration);
    const end = evalTime(exitMatch[2].trim(), meta.duration);
    if (start === null || end === null) add('EXIT_WINDOW', '统一出场的窗口无法静态求值', exitMatch.index);
    else {
      meta.exitStart = start;
      meta.exitEnd = end;
      if (end > meta.duration - EXIT_LATEST_END + 1e-9)
        add('EXIT_WINDOW', `出场结束 ${end} s 晚于 duration−${EXIT_LATEST_END}`, exitMatch.index);
      if (start < meta.duration - EXIT_EARLIEST_START - 1e-9)
        add('EXIT_WINDOW', `出场开始 ${start} s 早于 duration−${EXIT_EARLIEST_START}`, exitMatch.index);
      if (end <= start) add('EXIT_WINDOW', '出场窗口的结束不晚于开始', exitMatch.index);
    }
  }

  // 全部 range(time, a, b) 窗口
  if (meta.duration) {
    const re = /\brange\(\s*time\s*,/g;
    let m;
    while ((m = re.exec(html))) {
      const open = m.index + m[0].indexOf('(');
      const close = matchBracket(html, open);
      if (close === -1) continue;
      if (m.index === exitIndex) continue;
      const args = splitArgs(html.slice(open + 1, close));
      const line = lineAt(html, m.index);
      const a = evalTime(args[1] ?? '', meta.duration);
      const b = evalTime(args[2] ?? '', meta.duration);
      if (a === null || b === null) {
        warnings.push({ code: 'WINDOW_NOT_STATIC', message: `range(time, ${args[1]}, ${args[2]}) 无法静态求值，未参与包络检查`, line });
        continue;
      }
      const periodic = insidePeriodic(html, m.index);
      meta.windows.push({ start: a, end: b, line, periodic });
      const len = b - a;
      if (len < MIN_WINDOW - 1e-9 || len > MAX_WINDOW + 1e-9)
        add('WINDOW_LENGTH', `窗口 ${a}–${b} s 长 ${len.toFixed(2)} s，应在 ${MIN_WINDOW}–${MAX_WINDOW} s`, m.index);
      if (a < 0 || b > meta.duration + 1e-9) add('WINDOW_OUT_OF_RANGE', `窗口 ${a}–${b} s 超出 0–${meta.duration} s`, m.index);
    }
    const entrances = meta.windows.filter((w) => !w.periodic);
    if (entrances.length) {
      meta.firstStart = Math.min(...entrances.map((w) => w.start));
      meta.entranceEnd = Math.max(...entrances.map((w) => w.end));
      const first = entrances.find((w) => w.start === meta.firstStart);
      if (meta.firstStart < MIN_FIRST_START - 1e-9)
        issues.push({
          code: 'FIRST_ENTRY_TOO_EARLY',
          message: `第一个入场从 ${meta.firstStart} s 开始，应不早于 ${MIN_FIRST_START} s`,
          line: first.line,
        });
      if (meta.exitStart !== undefined && !meta.continuous && meta.entranceEnd > meta.exitStart - MIN_HOLD + 1e-9) {
        const last = entrances.find((w) => w.end === meta.entranceEnd);
        issues.push({
          code: 'HOLD_TOO_SHORT',
          message: `最后一个入场在 ${meta.entranceEnd} s 结束，距出场开始 ${meta.exitStart} s 不足 ${MIN_HOLD} s（持续动效可在根元素加 data-motion-continuous="true"）`,
          line: last.line,
        });
      }
    }
  }

  // 网络与外部资源
  const banned = [
    [/https?:\/\//g, 'EXTERNAL_URL', '外部 URL'],
    [/(["'`(=]\s*)\/\/[\w.-]/g, 'EXTERNAL_URL', '协议相对的 // URL'],
    [/<script\b[^>]*\bsrc\s*=/gi, 'EXTERNAL_SCRIPT', '<script src>'],
    [/<link\s/gi, 'EXTERNAL_LINK', '<link>'],
    [/@import\b/g, 'CSS_IMPORT', '@import'],
    [/\bfetch\s*\(/g, 'NETWORK_API', 'fetch('],
    [/\bXMLHttpRequest\b/g, 'NETWORK_API', 'XMLHttpRequest'],
    [/\bnew\s+(?:WebSocket|EventSource)\b/g, 'NETWORK_API', 'WebSocket / EventSource'],
    [/\bimport\s*\(/g, 'NETWORK_API', '动态 import('],
    [/\bDate\.now\b/g, 'NONDETERMINISTIC', 'Date.now'],
    [/\bperformance\.now\b/g, 'NONDETERMINISTIC', 'performance.now'],
    [/\bMath\.random\b/g, 'NONDETERMINISTIC', 'Math.random'],
    [/\bnew\s+Date\s*\(/g, 'NONDETERMINISTIC', 'new Date('],
  ];
  for (const [re, code, what] of banned) {
    let m;
    while ((m = re.exec(html))) add(code, `不允许 ${what}：渲染须离线且只由 time 决定`, m.index);
  }

  // requestAnimationFrame 只能出现在时间线的 play() 里
  const playBodies = [];
  const playRe = /\bplay\s*\(\s*\)\s*\{/g;
  let pm;
  while ((pm = playRe.exec(html))) {
    const open = pm.index + pm[0].length - 1;
    const close = matchBracket(html, open);
    if (close !== -1) playBodies.push([open, close]);
  }
  const rafRe = /\brequestAnimationFrame\b/g;
  let rm;
  while ((rm = rafRe.exec(html))) {
    if (!playBodies.some(([o, c]) => rm.index > o && rm.index < c))
      add('RAF_OUTSIDE_PLAY', 'requestAnimationFrame 只能用在时间线的 play() 里（预览），画面须由 seek 决定', rm.index);
  }

  // 颜色 token
  const rootRule = /#root\s*\{([^}]*)\}/.exec(html);
  if (!rootRule) add('TOKEN_MISSING', '缺少 #root{…} 规则与 --ink --panel --accent');
  else for (const t of TOKENS) if (!new RegExp(`${t}\\s*:`).test(rootRule[1])) add('TOKEN_MISSING', `#root 没有定义 ${t}`, rootRule.index);

  // 文案
  if (!/\bdata-copy-primary\b/.test(html.replace(/<script[\s\S]*?<\/script>/gi, '')))
    add('COPY_PRIMARY_MISSING', '至少要有一个带 data-copy-primary 的文案元素');
  if (!/(^|[\s,}])\.copy\s*[{,]/m.test(html))
    add('COPY_RULE_MISSING', '缺少 .copy{max-width:100%;overflow:hidden;text-overflow:ellipsis} 规则');

  return { ok: issues.length === 0, issues, warnings, meta };
}

/** 帧率 → 约分的整数比。 */
export function toRate(fps) {
  for (const den of [1, 1001, 1000]) {
    const num = Math.round(fps * den);
    if (Math.abs(num / den - fps) < 1e-6) {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const g = gcd(num, den);
      return { num: num / g, den: den / g };
    }
  }
  return { num: Math.round(fps * 1000), den: 1000 };
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/**
 * lint 通过后写出代码包。opts：{ html（文件路径）, out, bundleId?, revision?, alpha?, lintOnly? }。
 * 返回 { ok, lint, dir?, manifest? }；lint 失败时不写任何文件。
 */
export function buildBundle(opts) {
  const htmlPath = path.resolve(opts.html);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const lint = lintHtml(html);
  if (!lint.ok || opts.lintOnly) return { ok: lint.ok, lint };

  const { meta } = lint;
  const bundleId = opts.bundleId || path.basename(path.dirname(htmlPath));
  const revision = opts.revision || '1';
  const alpha = opts.alpha ?? true;
  const dir = path.join(path.resolve(opts.out), revision);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'dependency.lock'), '');
  // 配方只记确定的输入（不含绝对路径与时间），同样的输入得到同样的 contentHash。
  writeJson(path.join(dir, 'build.recipe.json'), {
    tool: TOOL,
    version: TOOL_VERSION,
    inputs: { html: path.basename(htmlPath), sha256: sha256(html), bundleId, revision, alpha },
  });

  // contentHash 覆盖这三个文件；不参与的 bundle.manifest.json、files.manifest.json、verification.json
  // 与 @baocut/protocol 的 CODE_BUNDLE_UNHASHED_FILES 一致。
  const listed = ['build.recipe.json', 'dependency.lock', 'index.html'];
  const files = listed
    .map((p) => {
      const data = fs.readFileSync(path.join(dir, p));
      return { path: p, size: data.length, sha256: sha256(data) };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  writeJson(path.join(dir, 'files.manifest.json'), files);

  const manifest = {
    format: 'baocut.code-bundle',
    schemaVersion: 1,
    bundleId,
    revision,
    contentHash: 'sha256-' + sha256(JSON.stringify(files)),
    runtime: { engine: 'browser', contract: 'hyperframes/1', entry: 'index.html', frameworkHints: [] },
    source: { filesManifest: 'files.manifest.json', dependencyLock: 'dependency.lock', buildRecipe: 'build.recipe.json' },
    intrinsic: { width: meta.width, height: meta.height, fps: toRate(meta.fps), durationFrames: Math.round(meta.duration * meta.fps) },
    output: { alpha, colorSpace: 'srgb', audio: 'none' },
    timing: { access: 'random' },
    timeDependencies: [{ kind: 'local-only' }],
    permissions: { network: 'deny', assetIds: [] },
  };
  writeJson(path.join(dir, 'bundle.manifest.json'), manifest);
  return { ok: true, lint, dir, manifest };
}

/** verify 的采样时刻：0、入场结束、停留中点、duration−0.3、duration。 */
export function sampleTimes(meta) {
  const d = meta.duration;
  const end = meta.entranceEnd ?? Math.min(d / 2, 2);
  const exitStart = meta.exitStart ?? d - 0.62;
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    start: 0,
    entranceEnd: round(end),
    holdMid: round((end + exitStart) / 2),
    beforeEnd: round(Math.max(0, d - 0.3)),
    end: round(d),
  };
}

function parseArgs(argv) {
  const opts = { alpha: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--html') opts.html = next();
    else if (a === '--out') opts.out = next();
    else if (a === '--bundle-id') opts.bundleId = next();
    else if (a === '--revision') opts.revision = next();
    else if (a === '--alpha') opts.alpha = next() !== 'false';
    else if (a === '--lint-only') opts.lintOnly = true;
    else if (a === '--verify') opts.verify = true;
    else if (a === '--electron-verify') opts.electronVerify = next();
    else throw new Error(`未知参数：${a}`);
  }
  return opts;
}

function runVerifyInElectron(dir) {
  const require = createRequire(import.meta.url);
  let electron;
  try {
    electron = require('electron');
  } catch {
    return { ok: false, error: '--verify 需要 electron 包（在 BaoCut 仓库里运行，或装好 electron）' };
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [fileURLToPath(import.meta.url), '--electron-verify', dir], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env,
  });
  const report = path.join(dir, 'verification.json');
  if (!fs.existsSync(report)) return { ok: false, error: `Electron 验证没有写出报告（退出码 ${r.status}）` };
  return JSON.parse(fs.readFileSync(report, 'utf8'));
}

// ---- Electron 端：离屏打开包的入口，按时刻 seek、截图、检查 ----
async function electronVerify(dir) {
  const require = createRequire(import.meta.url);
  const { app, BrowserWindow, session } = require('electron');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.disableHardwareAcceleration();
  app.dock?.hide();

  const main = async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.manifest.json'), 'utf8'));
    const html = fs.readFileSync(path.join(dir, manifest.runtime.entry), 'utf8');
    const { meta } = lintHtml(html);
    const { width, height } = manifest.intrinsic;
    const checks = [];
    const check = (name, ok, detail) => checks.push(detail === undefined ? { name, ok: !!ok } : { name, ok: !!ok, detail });

    const blocked = [];
    const ses = session.fromPartition('motion-graphics-verify');
    ses.webRequest.onBeforeRequest((details, cb) => {
      const ok = /^(file|data|devtools|chrome-extension):/.test(details.url);
      if (!ok) blocked.push(details.url);
      cb({ cancel: !ok });
    });

    const win = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      show: false,
      transparent: true,
      frame: false,
      enableLargerThanScreen: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: true, session: ses, backgroundThrottling: false, contextIsolation: true },
    });
    win.webContents.setFrameRate(60);
    await win.loadURL(pathToFileURL(path.join(dir, manifest.runtime.entry)).href);
    const js = (code) => win.webContents.executeJavaScript(code, true);
    await js('document.fonts ? document.fonts.ready.then(() => true) : true');

    const id = JSON.stringify(meta.compositionId ?? 'main');
    check('timeline', await js(`!!(window.__timelines && window.__timelines[${id}])`));
    check('qa', await js('!!window.__GRAPHICS_QA__'));

    // seek 后等页面真正重绘一帧再截图。
    const paint = () =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, 500);
        win.webContents.once('paint', () => {
          clearTimeout(timer);
          resolve();
        });
        win.webContents.invalidate();
      });
    const capture = async (t) => {
      await js(
        `window.__timelines[${id}].seek(${t}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`,
      );
      await paint();
      await paint();
      return win.webContents.capturePage();
    };

    const times = sampleTimes(meta);
    // 截图放在包目录之外：包里只留 contentHash 覆盖的文件与 verification.json。
    const previewDir = `${dir}-preview`;
    fs.mkdirSync(previewDir, { recursive: true });
    const frames = {};
    for (const [key, t] of Object.entries(times)) {
      const img = await capture(t);
      const png = img.toPNG();
      const size = img.getSize();
      const file = path.join(previewDir, `${t}.png`);
      fs.writeFileSync(file, png);
      frames[key] = { t, file, size, hash: sha256(png), image: img };
    }
    for (const f of Object.values(frames))
      check(`size@${f.t}`, f.size.width === width && f.size.height === height, `${f.size.width}×${f.size.height}`);

    // 确定性：打乱顺序再取一遍，同一时刻 PNG 字节一致。
    for (const key of Object.keys(times).reverse()) {
      const again = sha256((await capture(times[key])).toPNG());
      check(`deterministic@${times[key]}`, again === frames[key].hash);
    }

    const mid = frames.holdMid;
    check('distinct-start-vs-hold', frames.start.hash !== mid.hash);
    check('distinct-end-vs-hold', frames.end.hash !== mid.hash);

    if (manifest.output.alpha) {
      const bmp = mid.image.toBitmap();
      const { width: w, height: h } = mid.size;
      const alphaAt = (x, y) => bmp[(y * w + x) * 4 + 3];
      const corners = [alphaAt(0, 0), alphaAt(w - 1, 0), alphaAt(0, h - 1), alphaAt(w - 1, h - 1)];
      check(
        'alpha-corners',
        corners.every((a) => a === 0),
        corners,
      );
      const opaque = bmp.some((_, i) => i % 4 === 3 && bmp[i] > 0);
      check('alpha-has-content', opaque);
    }

    await js(`window.__GRAPHICS_QA__.seek(${mid.t})`);
    const inspect = await js('window.__GRAPHICS_QA__.inspect()');
    check('inspect.copyCount', inspect.copyCount > 0, inspect.copyCount);
    check('inspect.insideRoot', inspect.insideRoot);
    check('inspect.insideSafeArea', inspect.insideSafeArea, inspect.outsideSafe);
    if (manifest.output.alpha) check('inspect.transparentRoot', inspect.transparentRoot);

    for (const mode of ['long', 'cjk']) {
      const at = await js(`window.__GRAPHICS_QA__.setCopy(${JSON.stringify(mode)})`);
      const r = await js('window.__GRAPHICS_QA__.inspect()');
      check(`setCopy(${mode}).insideRoot`, r.insideRoot);
      check(`setCopy(${mode}).insideSafeArea`, r.insideSafeArea, r.outsideSafe);
      const img = await capture(at);
      fs.writeFileSync(path.join(previewDir, `copy-${mode}.png`), img.toPNG());
    }
    await js(`window.__GRAPHICS_QA__.setCopy('original')`);

    check('network', blocked.length === 0, blocked);
    win.destroy();

    const report = {
      ok: checks.every((c) => c.ok),
      bundleId: manifest.bundleId,
      revision: manifest.revision,
      contentHash: manifest.contentHash,
      tool: { name: TOOL, version: TOOL_VERSION, electron: process.versions.electron },
      times,
      frames: Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, { t: f.t, file: path.relative(dir, f.file), sha256: f.hash }])),
      inspect,
      checks,
    };
    writeJson(path.join(dir, 'verification.json'), report);
  };

  // ESM 主进程里不能顶层 await app.whenReady()：ready 要等模块求值结束才发。
  app
    .whenReady()
    .then(main)
    .then(
      () => app.exit(0),
      (err) => {
        console.error(err);
        app.exit(1);
      },
    );
}

function cli(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: String(err.message) }, null, 2));
    return 1;
  }
  if (opts.electronVerify) {
    electronVerify(path.resolve(opts.electronVerify));
    return null;
  }
  if (!opts.html || (!opts.out && !opts.lintOnly)) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error:
            '用法：node build-bundle.mjs --html <index.html> --out <dir> [--bundle-id <id>] [--revision <r>] [--alpha true|false] [--lint-only] [--verify]',
        },
        null,
        2,
      ),
    );
    return 1;
  }
  const built = buildBundle(opts);
  const result = { ok: built.ok, issues: built.lint.issues, warnings: built.lint.warnings };
  if (built.dir) Object.assign(result, { dir: built.dir, manifest: built.manifest });
  if (built.ok && opts.verify && !opts.lintOnly) {
    const v = runVerifyInElectron(built.dir);
    result.verification = v.error ? { ok: false, error: v.error } : { ok: v.ok, failed: v.checks.filter((c) => !c.ok), frames: v.frames };
    result.ok = !!v.ok;
  }
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const code = cli(process.argv.slice(2));
  if (code !== null) process.exitCode = code;
}
