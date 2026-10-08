const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-languages.js');
require('./model-tts.js');
require('./model-tools.js');
require('./model-tool-targets.js');
require('./model-tool-space-input.js');
const S = global.window.BC_TOOL_SPACE_INPUT;

const items = [
  {id: 'p1', kind: 'movie', movie: 'p1', name: '有文稿的视频', mtime: 5},
  {id: 'p2', kind: 'movie', movie: 'p2', name: '没转录的视频', mtime: 1},
  {id: 'o1', kind: 'final', name: '成片.mp4', mtime: 3},
  {id: 'o2', kind: 'subtitle', name: '英文字幕.srt', mtime: 2, text: '1\n00:00:00,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,000 --> 00:00:04,000\nWorld'},
  {id: 'o3', kind: 'audio', name: '原声.m4a', status: 'missing', mtime: 4},
  {id: 'o4', kind: 'doc', name: '摘要.md', text: '# 标题\n正文'},
  {id: 'o5', kind: 'subtitle', name: '旧字幕.srt', trashed: true},
  {id: 'o6', kind: 'image', name: '封面.png'},
];
const movies = [
  {id: 'p1', title: '有文稿的视频', model: 'whisper', status: 'complete', lang: '中文', src: {name: 'a.mp4'}},
  {id: 'p2', title: '没转录的视频', status: 'complete', src: {name: 'b.mp4'}},
];

test('各工具收的 Space 种类照 §2.7 表二', () => {
  assert.deepEqual(S.kindsFor('transcribe'), ['final', 'audio', 'movie']);
  assert.deepEqual(S.kindsFor('translate'), ['movie', 'subtitle']);
  assert.deepEqual(S.kindsFor('dub'), ['movie']);
  assert.deepEqual(S.kindsFor('tts'), ['doc', 'subtitle']);
  assert.deepEqual(S.kindsFor('text'), [], '文本生成的文档只作材料');
  assert.deepEqual(S.kindsFor('text', true), ['doc', 'subtitle']);
  ['compress', 'merge', 'extract'].forEach((id) => assert.deepEqual(S.kindsFor(id), ['final'], id));
  assert.deepEqual(S.kindsFor('image'), [], '生成图片不收 Space 输入');
  assert.deepEqual(S.kindsFor('nope'), []);
});

test('候选只列收的种类、不列回收站，能选的排前面，不能选的写清原因', () => {
  const rows = S.candidates('transcribe', items, {movies});
  assert.deepEqual(rows.map((r) => r.id), ['p2', 'o1', 'p1', 'o3'], '转录只要素材，没转录的视频也能选');
  assert.equal(rows.find((r) => r.id === 'o3').eligible, false);
  assert.match(rows.find((r) => r.id === 'o3').reason, /找不到/);
  const tr = S.candidates('translate', items, {movies});
  assert.deepEqual(tr.map((r) => [r.id, r.eligible]), [['o2', true], ['p1', true], ['p2', false]]);
  assert.match(tr.find((r) => r.id === 'p2').reason, /还没有文稿/);
  assert.ok(tr.find((r) => r.id === 'p1').tags.some((t) => t.k === 'transcript'), '视频标出已有的文稿');
  assert.ok(!tr.some((r) => r.id === 'o5'), '回收站里的不列');
  assert.deepEqual(S.candidates('tts', items, {q: '摘要'}).map((r) => r.id), ['o4']);
  assert.deepEqual(S.candidates('text', items, {attach: true}).map((r) => r.id), ['o2', 'o4']);
});

test('条目 → 收它的工具（Space 查看器「用工具处理…」）', () => {
  const ids = (it, o) => S.toolsFor(it, o).map((t) => t.id);
  assert.deepEqual(ids(items[2]), ['transcribe', 'compress', 'merge', 'extract']);
  assert.deepEqual(ids(items[3]), ['translate', 'tts', 'text']);
  assert.deepEqual(ids(items[5]), ['tts', 'text']);
  assert.equal(S.toolsFor(items[5]).find((t) => t.id === 'text').attach, true);
  assert.deepEqual(ids(items[0], {movie: movies[0]}), ['transcribe', 'translate', 'dub']);
  assert.match(S.toolsFor(items[1], {movie: movies[1]}).find((t) => t.id === 'dub').reason, /还没有文稿/);
  assert.deepEqual(ids(items[7]), [], '图片没有收它的工具');
  assert.deepEqual(S.toolsFor(items[6]), [], '回收站里的不处理');
});

test('选中的条目怎么走：视频写进它，其余当文件', () => {
  assert.equal(S.runInput(items[0]), 'video');
  assert.equal(S.runInput(items[2]), 'file');
});

test('取文字：字幕去掉序号与时间码；生成语音超上限时拒绝并报出字数，不截断', () => {
  assert.equal(S.textOf(items[3]), 'Hello\nWorld');
  assert.equal(S.textOf(items[5]), '# 标题\n正文');
  assert.deepEqual(S.textCheck(items[3], 2000), {ok: true, text: 'Hello\nWorld', chars: 11, error: null});
  const long = {id: 'x', kind: 'doc', name: '长文.md', text: '字'.repeat(2001)};
  const c = S.textCheck(long);
  assert.equal(c.ok, false);
  assert.equal(c.text, '', '不截断');
  assert.match(c.error, /2001 字，超过一次 2000 字的上限/);
  assert.match(S.textCheck({id: 'e', kind: 'doc', name: '空.md', text: ''}).error, /没有可以念的文字/);
});

test('预设：收的条目成为 Space 输入，附加材料另记，不收的忽略', () => {
  assert.deepEqual(S.fromPreset('transcribe', {entry: items[2]}), {source: 'space', entry: items[2], attach: false});
  assert.equal(S.fromPreset('text', {entry: items[5]}).attach, true);
  assert.equal(S.fromPreset('dub', {entry: items[2]}), null);
  assert.equal(S.fromPreset('tts', {entry: items[6]}), null);
  assert.equal(S.fromPreset('tts', null), null);
});

test('上次转录失败的视频：转录能选（重试），翻译字幕不能选', () => {
  const entry = {id: 'pf', kind: 'movie', movie: 'pf', name: '失败的视频', status: 'failed'};
  const movie = {id: 'pf', title: '失败的视频', status: 'error', model: 'x', src: {name: 'f.mov', state: 'ok'}};
  assert.equal(S.reasonFor('transcribe', entry, {movie}), null);
  assert.ok(S.reasonFor('translate', entry, {movie}));
});
