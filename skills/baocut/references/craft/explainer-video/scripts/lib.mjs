// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文，给人看的名字从配置来
// 讲解片制作脚本的共用部分：找配置、调 baocut CLI、读旁白稿、数语速单位、按整帧排段。
// 整个 scripts/ 目录一起拷进工程（例如 <工程>/tools/），只依赖 Node 自带的模块。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const CONFIG_NAME = 'explainer.json';

const DEFAULTS = {
  bc: ['baocut'],
  fps: 30,
  canvas: { width: 1080, height: 1920, background: '#000000' },
  compositionId: 'main',
  script: { path: 'script.md', notePrefixes: ['（', '(', '>', '<!--'] },
  fixedLines: {},
  hold: {},
  tail: 0.35,
  voice: { format: 'wav', attach: false },
  asr: { provider: 'google', model: 'gemini-3.5-transcribe', chunkSeconds: 0, args: [] },
  names: { narration: 'Narration' },
  dirs: { scenes: 'scenes', shared: 'shared', bundles: 'bundles', timing: 'timing', audio: 'audio', work: '.baocut-out' },
  bundle: { scripts: null, pick: ['img'], keep: [], exclude: [] },
};

// 配置：--config <文件>，或环境变量 EXPLAINER_CONFIG，或从当前目录往上找 explainer.json。工程根目录 = 配置所在目录。
export function loadConfig(argv = process.argv) {
  const i = argv.indexOf('--config'), eq = argv.find(a => a.startsWith('--config='));
  let file = i > 0 ? argv[i + 1] : eq ? eq.slice('--config='.length) : process.env.EXPLAINER_CONFIG;
  if (!file) for (let d = process.cwd(); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, CONFIG_NAME))) { file = path.join(d, CONFIG_NAME); break; }
    if (path.dirname(d) === d) break;
  }
  if (!file) throw new Error(`${CONFIG_NAME} not found from ${process.cwd()} upwards; pass --config <file>`);
  file = path.resolve(file);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = { ...DEFAULTS, ...raw };
  for (const k of Object.keys(DEFAULTS)) if (isPlain(DEFAULTS[k]) && isPlain(raw[k])) cfg[k] = { ...DEFAULTS[k], ...raw[k] };
  cfg.file = file;
  cfg.root = path.dirname(file);
  cfg.abs = (...p) => path.resolve(cfg.root, ...p);
  const bad = [];
  if (!Array.isArray(cfg.order) || !cfg.order.length) bad.push('order (segment ids in play order)');
  if (typeof cfg.language !== 'string') bad.push('language (BCP 47, e.g. zh-CN, en-US)');
  if (!(cfg.fps > 0)) bad.push('fps');
  if (!(cfg.canvas.width > 0 && cfg.canvas.height > 0)) bad.push('canvas.width / canvas.height');
  if (new Set(cfg.order || []).size !== (cfg.order || []).length) bad.push('order has duplicate ids');
  if (bad.length) throw new Error(`${file}: missing or invalid ${bad.join(', ')}`);
  cfg.estimateRate ??= /^(zh|ja|yue)\b/i.test(cfg.language) ? 4.5 : 2.7;
  return cfg;
}

const isPlain = v => v && typeof v === 'object' && !Array.isArray(v);

// 位置参数是段落 id；--name value、--name=value 与单独的 --flag 都认。valued 列出要带值的旗标。
export function parseArgs(argv, valued = []) {
  const ids = [], flags = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { ids.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (valued.includes(a.slice(2)) || a === '--config') flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return { ids, flags };
}

export const listFlag = v => (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

// 调 baocut CLI，返回 result；ok 为 false 时抛错，错误对象挂在 err.cli 上。
export function makeBc(cfg) {
  const [cmd0, ...pre] = cfg.bc;
  const cmd = cmd0.startsWith('.') ? cfg.abs(cmd0) : cmd0;
  return args => {
    let out;
    try {
      out = execFileSync(cmd, [...pre, ...args, '--json'], { cwd: cfg.root, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'inherit'] });
    } catch (e) {
      out = e.stdout;
      if (!out) throw new Error(`${cmd} ${args.slice(0, 2).join(' ')}: ${e.message}`);
    }
    const j = JSON.parse(out);
    if (!j.ok) {
      const err = new Error(`${args.slice(0, 2).join(' ')}: ${out.slice(0, 1500)}`);
      err.cli = j.error || j;
      throw err;
    }
    return j.result;
  };
}

export const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
export const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

// 旁白稿：「## <id> 标题」开一段（id 要在 order 里），别的一、二级标题或 --- 结束这一段；
// 段内每个非空行是一句旁白，notePrefixes 开头的行与三级以下标题是备注。fixedLines 里的段（固定开场、结尾）不从稿子读。
export function scriptLines(cfg) {
  const md = fs.readFileSync(cfg.abs(cfg.script.path), 'utf8');
  const ids = new Set(cfg.order), out = {};
  let cur = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#{1,2}\s+(\S+)/);
    if (h) { cur = ids.has(h[1]) ? h[1] : null; if (cur) out[cur] = []; continue; }
    if (/^-{3,}$/.test(line)) { cur = null; continue; }
    if (!cur || !line || line.startsWith('#') || cfg.script.notePrefixes.some(p => line.startsWith(p))) continue;
    out[cur].push(line);
  }
  for (const [id, lines] of Object.entries(cfg.fixedLines)) out[id] = lines;
  return out;
}

export const narrationText = lines => lines.join('\n');

// 语速单位：汉字与假名一个字算一个，其余文字按词（连在一起的字母数字，带撇号与小数点）算一个。
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}';
const UNIT = new RegExp(`[${CJK}]|(?:(?![${CJK}])[\\p{L}\\p{N}])+(?:['’.,](?:(?![${CJK}])[\\p{L}\\p{N}])+)*`, 'gu');
export const units = s => (s.match(UNIT) || []).length;
export const isCjk = c => new RegExp(`[${CJK}]`, 'u').test(c);
export const isSpoken = c => /[\p{L}\p{N}]/u.test(c);

// 时间线上的秒：帧号 ÷ 帧率，十位小数（compositions import 的 place.at 要这个精度）
export const atOf = (frame, fps) => String(+(frame / fps).toFixed(10));
export const frameOf = (at, fps) => Math.round(parseFloat(at) * fps);

// 各段的起点：按 order 把各包的帧数累加。包的帧数 = round(data-duration × fps)。
export function layout(cfg) {
  let from = 0;
  const missing = [];
  const segs = cfg.order.map(id => {
    const f = cfg.abs(cfg.dirs.bundles, id, 'index.html');
    if (!fs.existsSync(f)) { missing.push(id); return { id, from, frames: 0 }; }
    const m = fs.readFileSync(f, 'utf8').match(/data-duration="([\d.]+)"/);
    if (!m) throw new Error(`${f}: no data-duration on the root element`);
    const seg = { id, from, frames: Math.round(+m[1] * cfg.fps) };
    from += seg.frames;
    return seg;
  });
  if (missing.length) throw new Error(`bundles missing for ${missing.join(', ')}; run build.mjs first`);
  return segs;
}

// 代码包内容的指纹：文件相对路径与内容一起算，改了任何一个文件就变
export function bundleHash(dir) {
  const h = crypto.createHash('sha256');
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(rel, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(p + '\0').update(fs.readFileSync(path.join(dir, p))).update('\0');
    }
  };
  walk('');
  return 'sha256:' + h.digest('hex').slice(0, 32);
}

export const textHash = s => 'sha256:' + crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
