const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-ai-prompt.js');
const P = window.BC_AIPROMPT;

test('第一批只列从文稿出发的三组；翻译与画面另有去处说明', () => {
  assert.deepEqual(P.GROUPS_NOW, ['整理文稿', '写作', '发布']);
  assert.deepEqual(P.GROUPS_LATER, ['翻译', '画面']);
  assert.match(P.LATER_NOTE, /之后搬到这里/);
});

test('模板 = 意图句 + 固定约束；写作类带 Markdown 与语言，整理类不带', () => {
  const t = P.template('summary', '从「A」的文稿提炼一份带时间码的要点总结。', {lang: '中文'});
  const lines = t.split('\n');
  assert.equal(lines[0], '从「A」的文稿提炼一份带时间码的要点总结。');
  assert.match(t, /Markdown/);
  assert.match(t, /中文/);
  assert.match(t, /mm:ss/);
  const p = P.template('polish', '润色。', {lang: '中文'});
  assert.ok(!/Markdown/.test(p));
  assert.match(p, /不改写我的表达/);
  // 空意图句不留空行
  assert.equal(P.template('cleanup', '', {}), '');
});

test('每个工具都有一句「会不会改视频」', () => {
  ['polish', 'chapters', 'speakers', 'retranscribe', 'cleanup', 'stale', 'summary', 'blog', 'title', 'desc', 'cover']
    .forEach((k) => assert.ok(P.EFFECT[k], k));
  assert.match(P.EFFECT.summary, /不改视频/);
  assert.match(P.EFFECT.polish, /撤销/);
});

test('上下文包按工具取材，折成一行', () => {
  const items = P.contextPack('summary', {paras: 42, words: 6200, chapters: 4, attachments: 1});
  assert.deepEqual(items.map((i) => i.k), ['transcript', 'chapters', 'attachments']);
  assert.match(P.contextLine(items), /^发给模型的：提示词 \+ 文稿 42 段 · 约 6,200 字/);
  const stale = P.contextPack('stale', {paras: 42, stale: 3});
  assert.ok(stale.some((i) => i.k === 'translation'));
  const cover = P.contextPack('cover', {paras: 42, frames: 6});
  assert.equal(cover[0].k, 'frames');
  const scoped = P.contextPack('polish', {paras: 9, scope: '第 2 章 · 现场访谈'});
  assert.equal(scoped[0].label, '文稿 · 第 2 章 · 现场访谈');
  assert.equal(P.contextLine([]), '发给模型的：只有上面的提示词');
});

test('会话去向缺省新会话；这部视频有过会话时才给「接着」', () => {
  const none = P.sessionOptions([{id: 's1', project: 'other', messages: [{}]}], 'p1');
  assert.deepEqual(none.options.map((o) => o.k), ['new']);
  assert.equal(none.dflt, 'new');
  const has = P.sessionOptions([{id: 's9', project: 'p1', title: '剪口癖', messages: [{}, {}]}, {id: 's1', project: 'p1', messages: [{}]}], 'p1');
  assert.deepEqual(has.options.map((o) => o.k), ['new', 'current']);
  assert.equal(has.options[1].sid, 's9');
  assert.match(has.options[1].label, /剪口癖/);
  assert.match(has.options[1].sub, /2 条消息/);
  // 还没说过话的空会话不算
  const empty = P.sessionOptions([{id: 's2', project: 'p1', messages: []}], 'p1');
  assert.equal(empty.options.length, 1);
});

test('hint 随谁来做与去向变', () => {
  assert.match(P.hint({agent: true, session: 'new'}), /^新开一条会话/);
  assert.match(P.hint({agent: true, session: 'current'}), /^发到这部视频当前的会话/);
  assert.match(P.hint({agent: false, model: 'gpt-4o', readonly: true, cloud: true}), /直接调 gpt-4o.*不写进视频.*按用量计费/);
  assert.match(P.hint({agent: false, model: 'qwen', readonly: false, cloud: false}), /完成即应用.*不出本机/);
});
