const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-sublist.js');
const L = window.BC_SUBLIST;

test('阅读速度不计空白、按 Unicode 字符计数，阈值按语言且不提前取整', () => {
  assert.deepEqual(L.readingSpeed('ab cd\n😀\u0085', 2, 'en'), {value: 2.5, level: 'ok'});
  assert.deepEqual(L.readingSpeed(' \n', 1, 'zh'), {value: 0, level: 'none'});
  assert.equal(L.readingSpeed('字'.repeat(9), 1, 'zh-CN').level, 'ok');
  assert.equal(L.readingSpeed('字'.repeat(13), 1, 'zh').level, 'warn');
  assert.equal(L.readingSpeed('字'.repeat(14), 1, 'ja').level, 'bad');
  assert.equal(L.readingSpeed('ก'.repeat(10), 1, 'th').level, 'warn');
  assert.equal(L.readingSpeed('a'.repeat(17), 1, 'en').level, 'ok');
  assert.equal(L.readingSpeed('a'.repeat(21), 1, 'en').level, 'warn');
  assert.equal(L.readingSpeed('a'.repeat(22), 1, 'en').level, 'bad');
  assert.deepEqual(L.readingSpeed('字'.repeat(9), 0.999, 'zh'), {value: 9, level: 'warn'});
  assert.equal(L.readingSpeed('ab', 0, 'en').value, 20);
});

const tracks = [
  {id: 'zh', role: 'source', name: '中文'},
  {id: 'en', role: 'translation', name: 'English'},
  {id: 'ja', role: 'translation', name: '日本語', hidden: true},
];
const shelved = [{id: 'ko', role: 'translation', name: '한국어'}];
const running = {code: 'es', name: 'Español', pct: 42};

test('langs：译文轨（含停用）、拿下的、正在翻的按轨条顺序排，原文轨不进来', () => {
  const l = L.langs({tracks, shelved, running});
  assert.deepEqual(l.map((o) => o.code), ['en', 'ja', 'ko', 'es']);
  assert.deepEqual(l.map((o) => o.state), ['on', 'off', 'shelved', 'running']);
  assert.equal(l[3].pct, 42);
  // 同一门语言不重复：正在翻的已经落轨就只算轨
  assert.deepEqual(L.langs({tracks, running: {code: 'en', name: 'English'}}).map((o) => o.code), ['en', 'ja']);
});

test('resolve：没有译文只能单列；偏好语言不在候选里落到第一门；模式非法回落 src', () => {
  assert.deepEqual(L.resolve({mode: 'bi', lang: 'en'}, []), {mode: 'src', lang: null, opt: null});
  const opts = L.langs({tracks, shelved});
  assert.equal(L.resolve({mode: 'bi', lang: 'de'}, opts).lang, 'en');
  assert.equal(L.resolve({mode: 'trans', lang: 'ko'}, opts).lang, 'ko');
  assert.equal(L.resolve({mode: 'nope', lang: 'ko'}, opts).mode, 'src');
  assert.equal(L.resolve(null, opts).mode, 'src');
});

test('onPick：选中译文轨切对照语言（单列顺便切双语），只看译文保持只看译文；原文轨与未知 id 不动', () => {
  const opts = L.langs({tracks, shelved, running});
  assert.deepEqual(L.onPick({mode: 'src', lang: null}, 'ja', opts), {mode: 'bi', lang: 'ja'});
  assert.deepEqual(L.onPick({mode: 'trans', lang: 'en'}, 'ja', opts), {mode: 'trans', lang: 'ja'});
  assert.deepEqual(L.onPick({mode: 'bi', lang: 'en'}, 'es', opts), {mode: 'bi', lang: 'es'});
  const keep = {mode: 'bi', lang: 'en'};
  assert.equal(L.onPick(keep, 'zh', opts), keep);
  assert.equal(L.onPick(keep, 'el-3', opts), keep);
  assert.equal(L.onPick(keep, 'en', opts), keep);
  // 单列时点已是对照语言的轨：仍要切到双语（用户点它就是想看它）
  assert.deepEqual(L.onPick({mode: 'src', lang: 'en'}, 'en', opts), {mode: 'bi', lang: 'en'});
});

test('label / suffix：头部文案与下拉后缀', () => {
  const opts = L.langs({tracks, shelved, running});
  assert.equal(L.label(L.resolve({mode: 'src'}, opts), '中文'), '中文');
  assert.equal(L.label(L.resolve({mode: 'bi', lang: 'ja'}, opts), '中文'), '中文 ＋ 日本語');
  assert.equal(L.label(L.resolve({mode: 'trans', lang: 'ko'}, opts), '中文'), '只看 한국어');
  assert.equal(L.label(L.resolve({mode: 'bi'}, []), '中文'), '中文');
  assert.deepEqual(opts.map(L.suffix), ['', '已停用', '已拿下', '翻译中 42%']);
});

test('第 207 轮：正在重翻一门已落轨的语言——条目不换态，只挂进度；后缀照样写翻译中', () => {
  const tracks = [{id: 'zh', name: '中文', role: 'source'}, {id: 'ja', name: '日本語', role: 'translation'}];
  const opts = L.langs({tracks, shelved: [], running: {code: 'ja', name: '日本語', pct: 42}});
  assert.equal(opts.length, 1);
  assert.equal(opts[0].state, 'on');
  assert.equal(opts[0].pct, 42);
  assert.equal(L.suffix(opts[0]), '翻译中 42%');
  const fresh = L.langs({tracks, shelved: [], running: {code: 'en', name: 'English', pct: 7}});
  assert.equal(fresh[1].state, 'running');
  assert.equal(L.suffix(fresh[1]), '翻译中 7%');
});
