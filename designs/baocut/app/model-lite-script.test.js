const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-lite-script.js');
const S = global.window.BC_LITE_SCRIPT;

const v1 = '# 片名\n\n## s01 钩子\n\n第一段旁白。\n\n## s02 写作文\n\n第二段旁白。';
const v2 = '# 片名\n\n## s01 钩子\n\n第一段旁白，改过。\n\n## s02 写作文\n\n第二段旁白。\n\n## s03 涂卡\n\n第三段。';
const script = {file: '脚本.md', versions: [
  {n: 1, kind: 'create', day: '今天', at: '09:12', markdown: v1},
  {n: 2, kind: 'agent', day: '今天', at: '09:40', markdown: v2},
]};

test('按空行切块，标题单独成块', () => {
  const b = S.blocks('## 标题\n正文一行\n第二行\n\n- 列表');
  assert.deepEqual(b.map(x => x.text), ['## 标题', '正文一行\n第二行', '- 列表']);
  assert.equal(b[0].heading, '标题');
  assert.equal(b[1].heading, null);
});

test('逐块比：改过的一段并成 changed，新加的小节是 added', () => {
  const d = S.diff(v1, v2);
  assert.deepEqual(d.map(x => x.status), ['same', 'same', 'changed', 'same', 'same', 'added', 'added']);
  assert.equal(d[2].before, '第一段旁白。');
  assert.equal(S.changeCount(d), 3);
  assert.deepEqual(S.diff(null, v1).map(x => x.status), ['same', 'same', 'same', 'same', 'same']);
});

test('删掉的块留在原位，标 removed', () => {
  const d = S.diff(v2, v1);
  assert.deepEqual(d.map(x => x.status), ['same', 'same', 'changed', 'same', 'same', 'removed', 'removed']);
});

test('版本行新的在前；摘要说改了哪几个小节', () => {
  const rows = S.rows(script, []);
  assert.deepEqual(rows.map(r => r.n), [2, 1]);
  assert.equal(rows[1].title, '做视频时写入');
  assert.equal(rows[0].title, '改了「s01 钩子」「s03 涂卡」');
  assert.equal(rows[0].latest, true);
  assert.equal(rows[0].sub, '今天 09:40 · 智能体');
});

test('回到版本：加一版，正文换成那一版；和现在一样时不加', () => {
  const r = S.restore(script, [], 1, '10:05');
  assert.equal(r.version, 3);
  assert.equal(S.current(script, r.extra), v1);
  const rows = S.rows(script, r.extra);
  assert.equal(rows[0].title, '回到版本 1');
  assert.equal(rows[0].sub, '今天 10:05 · 你');
  assert.equal(S.restore(script, r.extra, 1, '10:06').noop, true);
  assert.equal(S.restore(script, [], 9, '10:06').error, '没有版本 9');
  const d = S.detail(script, r.extra, 1);
  assert.equal(d.canRestore, false);
  assert.match(d.why, /现在就是版本 1/);
  assert.equal(S.detail(script, r.extra, 3).why, '这就是现在的脚本');
});

test('没有脚本：版本是空的，现在的正文是空串', () => {
  assert.deepEqual(S.rows(null, []), []);
  assert.equal(S.current(undefined, []), '');
});

test('当前段对到脚本的小节：按段 ID 或段名', () => {
  const b = S.blocks(v2);
  assert.equal(S.sectionFor(b, {id: 's02', title: '别的名字'}), 3);
  assert.equal(S.sectionFor(b, {id: 'speech-1', title: 's03 涂卡'}), 5);
  assert.equal(S.sectionFor(b, {id: 'speech-2', title: '对不上'}), -1);
  assert.equal(S.sectionFor(b, null), -1);
});

test('连着改了两块：两块都标 changed，不错配成删掉 + 新加', () => {
  const d = S.diff('## s01\n\n旧的一段。\n\n> 旧的备注', '## s01\n\n新的一段。\n\n> 新的备注');
  assert.deepEqual(d.map(x => x.status), ['same', 'changed', 'changed']);
  assert.deepEqual(d.map(x => x.before || null), [null, '旧的一段。', '> 旧的备注']);
});
