// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 文字 → 口型字母。口型用 A–G 七张嘴加一张不说话的 X（与 Rhubarb Lip Sync 同一套字母）：
//   A 双唇紧闭（b p m）  B 牙几乎合上、嘴角拉开（大多数辅音、i）  C 半开（e）  D 大张（a）
//   E 圆唇半开（o）      F 撅嘴小圆孔（u ü w）                    G 上牙压下唇（f v）   X 不说话
// 中文按拼音：声母占字的前 30%（最多 80 毫秒），其余给韵母，复韵母拆成两三段；日文按假名；韩文按谚文拆字母；
// 拉丁字母按字母组合规则（英文另有常用词表）。认不出读音的（日文汉字、数字、其他文字）返回 null，
// 由 lipsync.mjs 按音量与元音线索补。只依赖 Node 自带的模块。
import { PINYIN } from './pinyin-table.mjs';

export const SHAPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'X'];
/** 张口程度：合并过短的口型、音量小时降档都按它。X 与 A 都是闭着的 */
export const OPEN = { X: 0, A: 0, G: 1, B: 1, F: 2, C: 2, E: 3, D: 4 };

// ---------- 中文 ----------
let READING = null;
function readings() {
  if (!READING) {
    READING = new Map();
    for (const [s, cs] of Object.entries(PINYIN)) for (const c of cs) READING.set(c, s);
    for (const [c, s] of Object.entries(CHAR_OVERRIDES)) READING.set(c, s);
  }
  return READING;
}

/** 单字读音表给错、而且口型不同的字（表里一个字只有一个读音） */
export const CHAR_OVERRIDES = { 著: 'zhe' };

/** 多音字在词里的读音，只收口型确实和单字读音不同的常用词。长的词优先匹配 */
export const PHRASES = {
  银行: 'yin hang', 行业: 'hang ye', 行情: 'hang qing', 排行: 'pai hang', 行长: 'hang zhang', 内行: 'nei hang',
  外行: 'wai hang', 行列: 'hang lie', 行家: 'hang jia', 投行: 'tou hang', 央行: 'yang hang', 各行各业: 'ge hang ge ye',
  銀行: 'yin hang', 行業: 'hang ye',
  了解: 'liao jie', 了不起: 'liao bu qi', 不得了: 'bu de liao', 不了: 'bu liao', 不了解: 'bu liao jie', 了如指掌: 'liao ru zhi zhang',
  明了: 'ming liao', 了结: 'liao jie', 了却: 'liao que', 了然: 'liao ran', 一目了然: 'yi mu liao ran', 不了了之: 'bu liao le zhi',
  了結: 'liao jie',
  音乐: 'yin yue', 乐器: 'yue qi', 乐队: 'yue dui', 乐团: 'yue tuan', 乐曲: 'yue qu', 声乐: 'sheng yue', 乐谱: 'yue pu', 器乐: 'qi yue',
  音樂: 'yin yue', 樂器: 'yue qi', 樂隊: 'yue dui', 樂團: 'yue tuan',
  还钱: 'huan qian', 归还: 'gui huan', 偿还: 'chang huan', 还原: 'huan yuan', 还给: 'huan gei', 退还: 'tui huan', 还款: 'huan kuan',
  還錢: 'huan qian', 歸還: 'gui huan', 償還: 'chang huan', 還原: 'huan yuan',
  着急: 'zhao ji', 睡着: 'shui zhao', 着火: 'zhao huo', 着凉: 'zhao liang', 着迷: 'zhao mi', 着手: 'zhuo shou', 着重: 'zhuo zhong',
  着陆: 'zhuo lu', 着想: 'zhuo xiang', 衣着: 'yi zhuo', 执着: 'zhi zhuo', 沉着: 'chen zhuo', 着装: 'zhuo zhuang', 着眼: 'zhuo yan',
  著作: 'zhu zuo', 著名: 'zhu ming', 显著: 'xian zhu', 顯著: 'xian zhu', 名著: 'ming zhu', 原著: 'yuan zhu', 著稱: 'zhu cheng',
  著称: 'zhu cheng', 專著: 'zhuan zhu', 专著: 'zhuan zhu', 執著: 'zhi zhuo',
  首都: 'shou du', 都市: 'du shi', 成都: 'cheng du', 都城: 'du cheng', 京都: 'jing du', 古都: 'gu du',
  睡觉: 'shui jiao', 午觉: 'wu jiao', 睡覺: 'shui jiao',
  角色: 'jue se', 主角: 'zhu jue', 配角: 'pei jue',
  会计: 'kuai ji', 會計: 'kuai ji',
  供给: 'gong ji', 给予: 'ji yu', 补给: 'bu ji', 自给自足: 'zi ji zi zu',
  的确: 'di que', 目的: 'mu di', 的士: 'di shi', 有的放矢: 'you di fang shi', 標的: 'biao di', 标的: 'biao di',
  地方: 'di fang', 地球: 'di qiu', 地区: 'di qu', 地图: 'di tu', 地铁: 'di tie', 地址: 'di zhi', 地点: 'di dian', 地位: 'di wei',
  土地: 'tu di', 基地: 'ji di', 当地: 'dang di', 本地: 'ben di', 各地: 'ge di', 场地: 'chang di', 地下: 'di xia', 地上: 'di shang',
  地面: 'di mian', 地震: 'di zhen', 地區: 'di qu', 地圖: 'di tu', 地鐵: 'di tie', 地點: 'di dian', 當地: 'dang di',
  率领: 'shuai ling', 坦率: 'tan shuai', 直率: 'zhi shuai', 草率: 'cao shuai', 轻率: 'qing shuai',
  薄弱: 'bo ruo', 单薄: 'dan bo', 稀薄: 'xi bo', 微薄: 'wei bo',
  厌恶: 'yan wu', 可恶: 'ke wu', 人参: 'ren shen', 参差: 'cen ci',
  模样: 'mu yang', 模具: 'mu ju', 模板: 'mu ban',
  暖和: 'nuan huo', 搅和: 'jiao huo', 出差: 'chu chai', 大夫: 'dai fu',
};
const PHRASE_MAX = Math.max(...Object.keys(PHRASES).map(k => k.length));

/** 每个字的拼音（无声调，ü 写 v），与 text 按 JS 下标一一对应；不是汉字或不认识的为 null */
export function pinyinOf(text) {
  const table = readings(), out = new Array(text.length).fill(null);
  for (let i = 0; i < text.length;) {
    let hit = 0;
    for (let n = Math.min(PHRASE_MAX, text.length - i); n >= 2; n--) {
      const p = PHRASES[text.slice(i, i + n)];
      if (p) { p.split(' ').forEach((s, k) => { out[i + k] = s; }); hit = n; break; }
    }
    if (hit) { i += hit; continue; }
    out[i] = table.get(text[i]) ?? null;
    i++;
  }
  return out;
}

const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's'];
const SYLLABIC = new Set(['m', 'n', 'ng', 'hm', 'hng']);

/** 拼音拆成声母与韵母，y w 开头的写法还原成 i u ü 开头的韵母，iu ui un 还原成 iou uei uen */
export function splitSyllable(s) {
  if (SYLLABIC.has(s)) return ['', s];
  let ini = '', fin = s;
  for (const i of INITIALS) if (s.startsWith(i) && s.length > i.length) { ini = i; fin = s.slice(i.length); break; }
  if (!ini && s[0] === 'y') { fin = s.slice(1); fin = fin[0] === 'u' ? `v${fin.slice(1)}` : fin[0] === 'i' ? fin : `i${fin}`; }
  else if (!ini && s[0] === 'w') { fin = s.slice(1); fin = fin[0] === 'u' ? fin : `u${fin}`; }
  if (ini && 'jqx'.includes(ini) && fin[0] === 'u') fin = `v${fin.slice(1)}`;
  if (ini && fin === 'iu') fin = 'iou';
  if (ini && fin === 'ui') fin = 'uei';
  if (ini && fin === 'un') fin = 'uen';
  return [ini, fin];
}

// 韵母 → [口型, 权重]：介音、韵尾 1，主元音 2；鼻韵尾 n ng 不单列一段
const FINALS = {
  a: 'D', o: 'E', e: 'C', i: 'B', u: 'F', v: 'F', er: 'E', ê: 'C',
  ai: 'D2 B1', ei: 'C2 B1', ao: 'D2 E1', ou: 'E2 F1',
  an: 'D', en: 'C', ang: 'D', eng: 'C', ong: 'E', in: 'B', ing: 'B',
  ia: 'B1 D2', ie: 'B1 C2', iao: 'B1 D2 E1', iou: 'B1 E2 F1', ian: 'B1 C2', iang: 'B1 D2', iong: 'B1 E2', io: 'B1 E2',
  ua: 'F1 D2', uo: 'F1 E2', uai: 'F1 D2 B1', uei: 'F1 C2 B1', uan: 'F1 D2', uen: 'F1 C2', uang: 'F1 D2', ueng: 'F1 C2',
  ve: 'F1 C2', van: 'F1 C2', vn: 'F1 B2',
  m: 'A', n: 'B', ng: 'B', hm: 'A', hng: 'B',
};
const seq = spec => spec.split(' ').map(t => ({ shape: t[0], w: t.length > 1 ? Number(t.slice(1)) : 1, kind: 'v' }));

/** 一个拼音音节的口型计划：[{shape, w, kind}]，kind 'c' 是声母（占前 30%，最多 80 毫秒） */
export function syllablePlan(s) {
  const [ini, fin] = splitSyllable(s);
  const spec = FINALS[fin];
  if (!spec) return null;
  const body = seq(spec);
  if (!ini) return body;
  const shape = ini === 'b' || ini === 'p' || ini === 'm' ? 'A' : ini === 'f' ? 'G' : fin[0] === 'u' || fin[0] === 'v' ? 'F' : 'B';
  const total = body.reduce((n, p) => n + p.w, 0);
  return [{ shape, w: (total * 3) / 7, kind: 'c', max: 0.08 }, ...body];
}

// ---------- 日文假名 ----------
const KANA_ROWS = [
  ['あいうえお', ''], ['かきくけこ', 'B'], ['がぎぐげご', 'B'], ['さしすせそ', 'B'], ['ざじずぜぞ', 'B'], ['たちつてと', 'B'],
  ['だぢづでど', 'B'], ['なにぬねの', 'B'], ['はひふへほ', 'B'], ['ばびぶべぼ', 'A'], ['ぱぴぷぺぽ', 'A'], ['まみむめも', 'A'],
  ['らりるれろ', 'B'], ['ぁぃぅぇぉ', ''], ['ゔ', 'G'],
];
const KANA_VOWEL = 'DBFCE';
const KANA = new Map();
for (const [row, c] of KANA_ROWS) [...row].forEach((k, i) => KANA.set(k, { c, v: KANA_VOWEL[i] }));
KANA.set('ふ', { c: 'F', v: 'F' });
for (const [k, v] of [['や', 'D'], ['ゆ', 'F'], ['よ', 'E'], ['わ', 'D'], ['を', 'E'], ['ゐ', 'B'], ['ゑ', 'C']]) KANA.set(k, { c: k === 'わ' || k === 'を' ? 'F' : 'B', v });
const SMALL_Y = { ゃ: 'D', ゅ: 'F', ょ: 'E', ゎ: 'D' };
export const KANA_TAIL = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮっッーゝゞヽヾ]/;
const hira = c => { const n = c.codePointAt(0); return n >= 0x30a1 && n <= 0x30f6 ? String.fromCodePoint(n - 0x60) : c; };

/** 一个假名（可带后面的小假名、促音、长音）的口型计划 */
export function kanaPlan(text) {
  const plan = [];
  let lastV = null;
  for (const raw of text) {
    const k = hira(raw);
    if (k === 'ん') { plan.push({ shape: 'B', w: 1, kind: 'v' }); lastV = 'B'; continue; }
    if (k === 'っ') { plan.push({ shape: 'A', w: 1, kind: 'c', hold: true }); continue; }
    if (k === 'ー') { if (lastV) plan.push({ shape: lastV, w: 2, kind: 'v' }); continue; }
    if (SMALL_Y[k] && plan.length) { const last = plan[plan.length - 1]; last.shape = SMALL_Y[k]; lastV = last.shape; continue; }
    const e = KANA.get(k);
    if (!e) continue;
    if (e.c) plan.push({ shape: e.c, w: 1, kind: 'c', max: 0.07 });
    plan.push({ shape: e.v, w: 2, kind: 'v' });
    lastV = e.v;
  }
  return plan.length ? plan : null;
}

// ---------- 韩文谚文 ----------
const HANGUL_L = 'BBBBBBAAABBBBBBBBAB'; // ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ；ㅇ(11) 不发音
const HANGUL_V = ['D', 'C', 'B1 D2', 'B1 C2', 'C', 'C', 'B1 C2', 'B1 C2', 'E', 'F1 D2', 'F1 C2', 'F1 C2', 'B1 E2', 'F', 'F1 C2', 'F1 C2', 'F1 B2', 'B1 F2', 'B', 'B', 'B'];
const HANGUL_T_CLOSED = new Set([10, 14, 16, 17, 18, 26]); // ㄻ ㄿ ㅁ ㅂ ㅄ ㅍ 收尾闭唇

export function hangulPlan(ch) {
  const code = ch.codePointAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  const L = Math.floor(code / 588), V = Math.floor((code % 588) / 28), T = code % 28;
  const plan = [];
  if (L !== 11) plan.push({ shape: HANGUL_L[L], w: 1, kind: 'c', max: 0.08 });
  plan.push(...seq(HANGUL_V[V]));
  if (HANGUL_T_CLOSED.has(T)) plan.push({ shape: 'A', w: 1, kind: 'c', max: 0.07 });
  return plan;
}

// ---------- 拉丁字母 ----------
/** 英文常用词，按字母规则会出错的 */
export const ENGLISH_WORDS = {
  the: 'B C', a: 'C', i: 'D B', to: 'B F', do: 'B F', you: 'B F', of: 'C G', one: 'F C B', two: 'B F', who: 'F', what: 'F C B',
  was: 'F C B', are: 'D', said: 'B C B', have: 'B D G', our: 'D F', eye: 'D B', they: 'B C B', there: 'B C', where: 'F C',
  were: 'F C', would: 'F B', could: 'B F B', should: 'B F B', does: 'B C B', been: 'A B', done: 'B C B', move: 'A F G',
  love: 'B C G', some: 'B C A', come: 'B C A', from: 'G B C A', any: 'C B B', many: 'A C B B', people: 'A B A B', how: 'B D F',
  now: 'B D F', know: 'B E F', why: 'F D B', my: 'A D B', by: 'A D B', hi: 'B D B', ok: 'E F B C B', okay: 'E F B C B',
};
const LETTER_NAMES = {
  a: 'C B', b: 'A B', c: 'B B', d: 'B B', e: 'B', f: 'C G', g: 'B B', h: 'C B', i: 'D B', j: 'B C B', k: 'B C B', l: 'C B', m: 'C A',
  n: 'C B', o: 'E F', p: 'A B', q: 'B F', r: 'D', s: 'C B', t: 'B B', u: 'B F', v: 'G B', w: 'B C A B F', x: 'C B B', y: 'F D B', z: 'B B',
};
// 字母组合 → 口型，长的先匹配；c 辅音，v 元音
const GRAPHEMES = [
  ['igh', 'D2 B1', 'v'], ['tch', 'B', 'c'], ['sch', 'B', 'c'],
  ['ph', 'G', 'c'], ['wh', 'F', 'c'], ['qu', 'B F', 'c'], ['th', 'B', 'c'], ['sh', 'B', 'c'], ['ch', 'B', 'c'], ['ck', 'B', 'c'],
  ['ng', 'B', 'c'], ['gh', '', 'c'], ['mb', 'A', 'c'],
  ['ee', 'B', 'v'], ['ea', 'B', 'v'], ['ie', 'B', 'v'], ['ei', 'B', 'v'], ['ey', 'B', 'v'], ['oo', 'F', 'v'], ['ou', 'E2 F1', 'v'],
  ['ow', 'E2 F1', 'v'], ['oa', 'E2 F1', 'v'], ['oi', 'E2 B1', 'v'], ['oy', 'E2 B1', 'v'], ['au', 'E', 'v'], ['aw', 'E', 'v'],
  ['ai', 'C2 B1', 'v'], ['ay', 'C2 B1', 'v'], ['ar', 'D', 'v'], ['er', 'C', 'v'], ['ir', 'C', 'v'], ['ur', 'C', 'v'], ['or', 'E', 'v'],
  ['ue', 'F', 'v'], ['ew', 'F', 'v'], ['ui', 'F', 'v'],
];
const LATIN_LETTER = {
  b: 'A', p: 'A', m: 'A', f: 'G', v: 'G', w: 'F', a: 'D', e: 'C', i: 'B', o: 'E', u: 'C', y: 'B',
};

/** 一个拉丁字母词的口型计划。english=false 时不用英文词表与不发音的 e，u 读圆唇（西班牙语、德语、意大利语等） */
export function latinPlan(word, english = true) {
  const raw = word.replace(/[’']/g, '');
  if (!raw) return null;
  const lower = raw.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (!/^[a-z]+$/.test(lower)) return null;
  // 全大写的短词按字母名念：AI、GPT
  if (raw.length >= 2 && raw.length <= 5 && raw === raw.toUpperCase() && /[A-Z]/.test(raw)) {
    return [...lower].flatMap(c => seq(LETTER_NAMES[c]));
  }
  if (english && ENGLISH_WORDS[lower]) return seq(ENGLISH_WORDS[lower]);
  let s = lower, magic = null;
  // 词尾不发音的 e：前面的单元音变长音（make take time home cute）
  if (english && s.length >= 3 && /[aeiou][^aeiouwy]e$/.test(s) && !/[aeiou]{2}[^aeiou]e$/.test(s)) {
    magic = s.length - 3;
    s = s.slice(0, -1);
  }
  const plan = [];
  for (let i = 0; i < s.length;) {
    let hit = null;
    for (const [g, spec, kind] of GRAPHEMES) if (s.startsWith(g, i)) { hit = [g, spec, kind]; break; }
    if (hit) {
      const [g, spec, kind] = hit;
      if (spec) plan.push(...seq(spec).map(p => ({ ...p, kind, ...(kind === 'c' ? { max: 0.08 } : {}) })));
      i += g.length;
      continue;
    }
    const c = s[i];
    const vowel = 'aeiou'.includes(c) || (c === 'y' && i > 0);
    let spec = LATIN_LETTER[c] ?? 'B';
    if (!english && c === 'u') spec = 'F';
    if (english && i === magic) spec = { a: 'C2 B1', e: 'B', i: 'D2 B1', o: 'E2 F1', u: 'F' }[c] ?? spec;
    if (english && c === 'y' && i === s.length - 1 && s.length <= 3) spec = 'D2 B1';
    plan.push(...seq(spec).map(p => ({ ...p, kind: vowel ? 'v' : 'c', ...(vowel ? {} : { max: 0.08 }) })));
    i++;
  }
  return plan.length ? plan : null;
}

// ---------- 切分 ----------
const HAN = /\p{Script=Han}/u, KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u, HANGUL = /\p{Script=Hangul}/u;
const LATIN = /[\p{Script=Latin}’']/u, NUM = /\p{N}/u, LETTER = /\p{L}/u;
const PAUSE = /[，。！？；：、,.!?;:…—「」『』“”"()（）\n]/;

export const isSpoken = c => /[\p{L}\p{N}]/u.test(c);

/**
 * 文字切成念的单位：汉字、谚文一字一个，假名一个（连同后面的小假名、促音、长音），拉丁字母与数字连写的算一个词。
 * 返回 [{text, at, len, kind, pauseAfter}]，at 是 JS 下标；pauseAfter 表示后面跟着标点（句中停顿或句末）
 */
export function tokenize(text) {
  const out = [];
  for (let i = 0; i < text.length;) {
    const c = text[i];
    let kind = null, j = i + 1;
    if (HAN.test(c)) kind = 'han';
    else if (KANA_RE.test(c) && !KANA_TAIL.test(c)) { kind = 'kana'; while (j < text.length && KANA_TAIL.test(text[j])) j++; }
    else if (KANA_TAIL.test(c) && out.length && out[out.length - 1].kind === 'kana' && out[out.length - 1].at + out[out.length - 1].len === i) {
      out[out.length - 1].len++; i++; continue;
    } else if (HANGUL.test(c)) kind = 'hangul';
    else if (LATIN.test(c) && c !== '’' && c !== "'") { kind = 'latin'; while (j < text.length && LATIN.test(text[j])) j++; }
    else if (NUM.test(c)) { kind = 'number'; while (j < text.length && (NUM.test(text[j]) || (/[.,]/.test(text[j]) && NUM.test(text[j + 1] ?? '')))) j++; }
    else if (LETTER.test(c)) { kind = 'other'; while (j < text.length && LETTER.test(text[j]) && !HAN.test(text[j]) && !KANA_RE.test(text[j]) && !HANGUL.test(text[j]) && !LATIN.test(text[j])) j++; }
    if (!kind) {
      if (PAUSE.test(c) && out.length) out[out.length - 1].pauseAfter = true;
      i++;
      continue;
    }
    out.push({ text: text.slice(i, j), at: i, len: j - i, kind, pauseAfter: false });
    i = j;
  }
  return out;
}

/** 语言标签归到这里认得的几类：zh、ja、ko、en、other（别的语言：拉丁字母按拼写粗略推，别的文字读不出）、auto（看文字自己判断） */
export function langFamily(lang) {
  const l = String(lang || 'auto').toLowerCase();
  if (l === 'auto') return 'auto';
  if (/^(zh|cmn)(\b|-|_)/.test(l) || l === 'zh' || l === 'cmn') return 'zh';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('ko')) return 'ko';
  if (l.startsWith('en')) return 'en';
  return 'other';
}

/**
 * 一段文字里每个念的单位的口型计划。lang：BCP 47 语言标签或 auto；readings：读音表（见 applyReadings）。
 * 返回 tokenize() 的单位，各加 reading（拼音、假名或词本身）与 plan（[{shape, w, kind}] 或 null = 读音不明）
 */
export function planText(text, lang = 'auto', readings = null) {
  let fam = langFamily(lang);
  if (fam === 'auto') fam = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? 'ja' : HAN.test(text) ? 'zh' : HANGUL.test(text) ? 'ko' : 'en';
  const units = tokenize(text);
  const py = units.some(u => u.kind === 'han') && fam === 'zh' ? pinyinOf(text) : null;
  for (const u of units) {
    u.reading = u.text;
    u.plan = null;
    if (u.kind === 'han' && py) { u.reading = py[u.at] ?? u.text; u.plan = py[u.at] ? syllablePlan(py[u.at]) : null; }
    else if (u.kind === 'kana') u.plan = kanaPlan(u.text);
    else if (u.kind === 'hangul') u.plan = hangulPlan(u.text);
    else if (u.kind === 'latin') u.plan = latinPlan(u.text, fam === 'en' || fam === 'zh' || fam === 'ja' || fam === 'ko');
  }
  return readings ? applyReadings(text, units, readings, fam) : units;
}

/** 一段读音（假名、谚文、拼音或拼法相近的字母）的口型计划；读不出来时 null */
export function readingPlan(reading, fam) {
  const parts = [];
  for (const tok of tokenize(reading)) {
    let p = null;
    if (tok.kind === 'kana') p = kanaPlan(tok.text);
    else if (tok.kind === 'hangul') p = hangulPlan(tok.text);
    else if (tok.kind === 'han') { const py = pinyinOf(tok.text)[0]; p = py ? syllablePlan(py) : null; }
    else if (tok.kind === 'latin') p = (fam === 'zh' && syllablePlan(tok.text.toLowerCase())) || latinPlan(tok.text, fam !== 'other');
    if (p) parts.push(...p);
  }
  return parts.length ? parts : null;
}

const beatsOf = u => (u.kind === 'latin' ? Math.max(1, (u.text.toLowerCase().match(/[aeiouy]+/g) || []).length) : 1);

/**
 * 读音表 { 词: 读音 }，纠正内置规则读错或读不出的词，长的词先配，词的首尾要落在念的单位的边界上：
 * - 汉字词给拼音，一字一个音节、空格隔开（重庆 → "chong qing"），仍一字一个单位；
 * - 别的（日文汉字词给假名：今日 → "きょう"；品牌名、缩写给拼法相近的字母或假名：BaoCut → "bao cut"）把词里的单位合成一个，
 *   按读音出口型，时长照原来几个单位的总长
 */
export function applyReadings(text, units, readings, fam) {
  const keys = Object.keys(readings).filter(k => k && String(readings[k] ?? '').trim()).sort((a, b) => b.length - a.length);
  const taken = new Uint8Array(text.length), drop = new Set();
  for (const key of keys) {
    for (let i = text.indexOf(key); i >= 0; i = text.indexOf(key, i + key.length)) {
      const end = i + key.length;
      if (taken.subarray(i, end).some(Boolean)) continue;
      const inside = units.filter(u => !drop.has(u) && u.at >= i && u.at + u.len <= end);
      if (!inside.length || inside[0].at !== i || inside[inside.length - 1].at + inside[inside.length - 1].len !== end) continue;
      taken.fill(1, i, end);
      const reading = String(readings[key]).trim(), syl = reading.toLowerCase().split(/\s+/);
      if (fam === 'zh' && inside.every(u => u.kind === 'han') && syl.length === inside.length && syl.every(v => syllablePlan(v))) {
        inside.forEach((u, k) => { u.reading = syl[k]; u.plan = syllablePlan(syl[k]); });
        continue;
      }
      const head = inside[0], tail = inside[inside.length - 1];
      head.beats = inside.reduce((n, u) => n + (u.beats ?? beatsOf(u)), 0);
      head.text = text.slice(head.at, end);
      head.len = end - head.at;
      head.pauseAfter = tail.pauseAfter;
      head.kind = 'reading';
      head.reading = reading;
      head.plan = readingPlan(reading, fam);
      for (const u of inside.slice(1)) drop.add(u);
    }
  }
  return drop.size ? units.filter(u => !drop.has(u)) : units;
}

/**
 * 把一个单位的口型计划铺到 [t0, t1] 上：辅音段按权重分，但每段最多 max 秒（声母 80 毫秒），多出来的给元音段。
 * 返回 [{shape, t0, t1}]，相邻同口型合并
 */
export function layoutPlan(plan, t0, t1) {
  const d = Math.max(0, t1 - t0);
  if (!plan || !plan.length || !d) return [];
  const W = plan.reduce((n, p) => n + p.w, 0) || 1;
  const dur = plan.map(p => (d * p.w) / W);
  let spare = 0;
  plan.forEach((p, i) => { if (p.kind === 'c' && p.max != null && dur[i] > p.max) { spare += dur[i] - p.max; dur[i] = p.max; } });
  const vw = plan.reduce((n, p) => n + (p.kind === 'c' ? 0 : p.w), 0);
  if (spare && vw) plan.forEach((p, i) => { if (p.kind !== 'c') dur[i] += (spare * p.w) / vw; });
  const out = [];
  let t = t0;
  plan.forEach((p, i) => {
    const e = i === plan.length - 1 ? t1 : t + dur[i];
    if (e > t) {
      const last = out[out.length - 1];
      if (last && last.shape === p.shape) last.t1 = e;
      else out.push({ shape: p.shape, t0: t, t1: e });
    }
    t = e;
  });
  return out;
}

/** 计划的简写，给核对表看：B·D 或 A·C·B */
export const planLabel = plan => (plan ? plan.map(p => p.shape).filter((s, i, a) => s !== a[i - 1]).join('·') : '?');
