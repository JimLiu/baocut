// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文，给人看的名字从配置来
// 制作脚本的共用部分：找配置、调 baocut CLI、读旁白稿、数语速单位、按整帧排段。
// 整个 scripts/ 目录一起拷进工程（例如 <工程>/tools/），只依赖 Node 自带的模块。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// 配置文件名：先找 production.json，再找 explainer.json（旧名，继续认）
export const CONFIG_NAMES = ['production.json', 'explainer.json'];
export const CONFIG_NAME = CONFIG_NAMES[1];

const DEFAULTS = {
  bc: ['baocut'],
  fps: 30,
  canvas: { width: 1080, height: 1920, background: '#000000' },
  compositionId: 'main',
  script: { path: 'script.md', notePrefixes: ['@', '（', '(', '>', '<!--'] },
  fixedLines: {},
  hold: {},
  tail: 0.35,
  voice: { format: 'wav', attach: false },
  asr: { provider: 'google', model: 'gemini-3.5-transcribe', chunkSeconds: 0, args: [] },
  names: { narration: 'Narration', footage: 'Footage', watermark: 'Watermark', quote: 'Original voice' },
  dirs: { scenes: 'scenes', shared: 'shared', bundles: 'bundles', timing: 'timing', audio: 'audio', work: '.baocut-out' },
  bundle: { scripts: null, pick: ['img'], keep: [], exclude: [], module: false, fonts: {}, alpha: false },
  prepend: false,
};

// 配置：--config <文件>，或环境变量 PRODUCTION_CONFIG / EXPLAINER_CONFIG，或从当前目录往上找 production.json / explainer.json。工程根目录 = 配置所在目录。
export function loadConfig(argv = process.argv) {
  const i = argv.indexOf('--config'), eq = argv.find(a => a.startsWith('--config='));
  let file = i > 0 ? argv[i + 1] : eq ? eq.slice('--config='.length) : process.env.PRODUCTION_CONFIG || process.env.EXPLAINER_CONFIG;
  if (!file) for (let d = process.cwd(); ; d = path.dirname(d)) {
    const hit = CONFIG_NAMES.find(n => fs.existsSync(path.join(d, n)));
    if (hit) { file = path.join(d, hit); break; }
    if (path.dirname(d) === d) break;
  }
  if (!file) throw new Error(`${CONFIG_NAMES.join(' or ')} not found from ${process.cwd()} upwards; pass --config <file>`);
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
    // 结果超过 CLI 的输出上限（videos inspect 素材一多就会）：CLI 只回摘要，完整结果写在 path 指的文件里
    const r = j.result;
    if (r?.truncated === true && typeof r.path === 'string' && r.continueWith?.file === r.path) {
      const full = JSON.parse(fs.readFileSync(r.path, 'utf8'));
      fs.rmSync(r.path, { force: true });
      return full;
    }
    return r;
  };
}

// 视频里从 fromSeconds 起（含跨过它的）的全部片段：videos inspect 一次最多列 1000 个，截断时从最后一个的起点往后翻页
export function allItems(bc, video, fromSeconds = 0) {
  const seen = new Map();
  for (let from = fromSeconds; ;) {
    const r = bc(['videos', 'inspect', video, '--from-seconds', String(from), '--limit', '1000']);
    for (const it of r.items) seen.set(it.id, it);
    if (!r.itemsCoverage?.truncated) return { revision: r.revision, items: [...seen.values()].sort((a, b) => a.startFrame - b.startFrame) };
    const next = r.items.at(-1).startSeconds;
    if (!(next > from)) throw new Error(`more than 1000 clips start at ${from}s; cannot page through them`);
    from = next;
  }
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

// 每段的备注行（notePrefixes 开头的行，去掉括号）拼成一句，给预览页当 note
export function scriptNotes(cfg) {
  const md = fs.readFileSync(cfg.abs(cfg.script.path), 'utf8');
  const ids = new Set(cfg.order), out = {};
  let cur = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#{1,2}\s+(\S+)/);
    if (h) { cur = ids.has(h[1]) ? h[1] : null; continue; }
    if (/^-{3,}$/.test(line)) { cur = null; continue; }
    if (!cur || !cfg.script.notePrefixes.some(p => line.startsWith(p))) continue;
    (out[cur] ||= []).push(line.replace(/^(<!--|[@>]|[（(])\s*/, '').replace(/\s*(-->|[）)])$/, ''));
  }
  return Object.fromEntries(Object.entries(out).map(([id, l]) => [id, l.join(' ')]));
}

// 一段里所有片段的起点（按 clips.json 的先后）：follow 为 true 的片段接在上一个片段的原长之后，其余同 clipAt
export function clipTimes(tm, clips) {
  const at = {};
  clips.forEach((c, i) => {
    const p = clips[i - 1];
    if (c.follow && !p) throw new Error(`clip ${c.id} follows nothing; it is the first clip of ${c.seg}`);
    at[c.id] = c.follow ? at[p.id] + p.to - p.from : clipAt(tm, c);
  });
  return at;
}

// 片段在这一段里的起点（秒，相对段首）：head 为 true 的从段首（0）放，盖住第一句之前的那点空；
// 留白片段（gap）取 gaps.mjs 在旁白里留出的那段空白的起点；after 给了句号（从 0 数，负数从末句倒数，true 是末句）时
// 从那一句念完的时刻放（段尾 hold 里放一句原声）；其余按 line / cue。offset（秒）在这之上再挪，可正可负
export function clipAt(tm, clip) {
  const off = clip.offset ?? 0;
  if (clip.head) return off;
  if (clip.gap) {
    const g = (tm.gaps || []).find(x => x.clip === clip.id);
    if (!g) throw new Error(`clip ${clip.id} pauses the narration but timing has no gap for it; run gaps.mjs ${clip.seg}`);
    return g.at + off;
  }
  if (clip.after != null && clip.after !== false) {
    const n = tm.lines.length, i = clip.after === true ? n - 1 : clip.after < 0 ? n + clip.after : clip.after;
    if (!tm.lines[i]) throw new Error(`clip ${clip.id}: after ${clip.after} is not a line of ${clip.seg} (it has ${n})`);
    return tm.lines[i].end + off;
  }
  return cueTime(tm, clip.line, clip.cue) + off;
}

// 只有声音的来源：录音文件，或 video 为 false 的视频片段（只取原声、不上画面）
export const AUDIO_FILE = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus)$/i;
export const isAudioOnly = (clip, source) => clip.video === false || AUDIO_FILE.test(source || '');

// 一句旁白里某个时刻（秒，相对这一段开头）：第 line 句（从 0 数）的开头；给了 cue 就取 cue 这几个字开始被说到的时刻
export function cueTime(tm, line, cue) {
  const l = tm.lines[line];
  if (!l) throw new Error(`line ${line} missing (segment has ${tm.lines.length} lines)`);
  if (!cue) return l.start;
  const i = l.text.indexOf(cue);
  if (i < 0) throw new Error(`cue "${cue}" not in line ${line}: ${l.text}`);
  return l.chars?.[i] ?? l.start;
}

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

// 原片像素裁剪 [x, y, w, h] 换成时间线上的四边比例；W、H 取素材记录里的显示宽高（videos inspect 的 size），不假定 1920×1080
export function cropFraction([x, y, w, h], W, H) {
  if (!(W > 0 && H > 0)) throw new Error(`crop needs the source size; got ${W}x${H}`);
  const r = v => Math.min(Math.max(+v.toFixed(6), 0), 0.95);
  const c = { left: r(x / W), top: r(y / H), right: r(1 - (x + w) / W), bottom: r(1 - (y + h) / H) };
  return Object.values(c).some(v => v > 0) ? c : null;
}

// 取景表 [s, dx, dy]（放大 s 倍，画面中心挪到离正中 dx%、dy% 的地方，正数往左、往上）换成 focalPoint：
// 铺满裁切留下的那块框按取景点分两边，框的左边 = x × (1 − 1/s)，所以 x = 框左 ÷ (1 − 1/s)；s 为 1 时没有可挪的，取正中
export function focalOf([s, dx, dy]) {
  if (!(s >= 1 && s <= 4)) throw new Error(`focus scale ${s} must be within 1 and 4`);
  const axis = d => {
    const w = 1 / s, room = 1 - w;
    if (room < 1e-6) return 0.5;
    const left = Math.min(Math.max((50 - d) / 100 - w / 2, 0), room);
    return +(left / room).toFixed(4);
  };
  return { x: axis(dx), y: axis(dy), ...(s > 1 ? { zoom: s } : {}) };
}

// 时间线上的秒写成整数刻度的 MediaTime（毫秒）
export const mediaTime = sec => ({ ticks: String(Math.round(sec * 1000)), timescale: 1000 });

// 字体覆盖哪些码位：读 TrueType / OpenType 的 cmap 表（格式 4 与 12），返回码位集合。
// 依次挑 (3,10)、(0,4)、(3,1)、(0,3) 子表，都没有时取第一个格式 4 或 12 的子表。
// 读不了的（字体集合 .ttc、WOFF、没有 cmap）返回 { skip: 原因 }，调用方打一行说明后跳过这款字体。
export function fontCmap(file) {
  const b = fs.readFileSync(file);
  if (b.length < 12) return { skip: 'file too short for a font' };
  const tag = b.toString('latin1', 0, 4);
  if (tag === 'ttcf') return { skip: 'font collection (.ttc); split out one face first' };
  if (tag === 'wOFF' || tag === 'wOF2') return { skip: 'WOFF is compressed; check the source TTF / OTF instead' };
  if (b.readUInt32BE(0) !== 0x00010000 && tag !== 'OTTO' && tag !== 'true') return { skip: 'not a TrueType / OpenType font' };
  let cmap = -1;
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
    const rec = 12 + i * 16;
    if (b.toString('latin1', rec, rec + 4) === 'cmap') { cmap = b.readUInt32BE(rec + 8); break; }
  }
  if (cmap < 0) return { skip: 'no cmap table' };
  const subs = [];
  for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
    const rec = cmap + 4 + i * 8, at = cmap + b.readUInt32BE(rec + 4);
    subs.push({ pe: `${b.readUInt16BE(rec)},${b.readUInt16BE(rec + 2)}`, at, format: b.readUInt16BE(at) });
  }
  const usable = subs.filter(s => s.format === 4 || s.format === 12);
  const sub = ['3,10', '0,4', '3,1', '0,3'].map(pe => usable.find(s => s.pe === pe)).find(Boolean) || usable[0];
  if (!sub) return { skip: 'no cmap subtable of format 4 or 12' };
  const cps = new Set(), at = sub.at;
  if (sub.format === 4) {
    // 分段表：endCode[] 后隔两字节是 startCode[]，再是 idDelta[]、idRangeOffset[]；字形号 0 是 .notdef，不算有
    const seg = b.readUInt16BE(at + 6) / 2, ends = at + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
    for (let s = 0; s < seg; s++) {
      const end = b.readUInt16BE(ends + s * 2), start = b.readUInt16BE(starts + s * 2);
      const delta = b.readInt16BE(deltas + s * 2), ro = b.readUInt16BE(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g;
        if (!ro) g = (c + delta) & 0xffff;
        else {
          const p = ranges + s * 2 + ro + (c - start) * 2;
          g = p + 2 <= b.length ? b.readUInt16BE(p) : 0;
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) cps.add(c);
      }
    }
  } else {
    // 分组表：每组 { startCharCode, endCharCode, startGlyphID }，组内字形号连续
    for (let i = 0, n = b.readUInt32BE(at + 12); i < n; i++) {
      const g = at + 16 + i * 12, start = b.readUInt32BE(g), end = Math.min(b.readUInt32BE(g + 4), 0x10ffff), glyph = b.readUInt32BE(g + 8);
      for (let c = start; c <= end; c++) if (glyph + (c - start)) cps.add(c);
    }
  }
  return { cps, has: cp => cps.has(cp) };
}
