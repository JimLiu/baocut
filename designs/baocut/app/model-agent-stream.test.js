const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-agent-stream.js');
const S = global.window.BC_AGENT_STREAM;

/* ---------- revealStep ---------- */
test('revealStep：与积压成正比，下限 1、上限 backlog', () => {
  assert.equal(S.revealStep({backlog: 300, elapsedMs: 16}), 32);
  assert.equal(S.revealStep({backlog: 30, elapsedMs: 16}), 4);
  assert.equal(S.revealStep({backlog: 3, elapsedMs: 1}), 1);
  assert.equal(S.revealStep({backlog: 0, elapsedMs: 16}), 0);
  assert.equal(S.revealStep({backlog: 5, elapsedMs: 0}), 1);
});

test('revealStep：elapsed ≥ horizon 全部放出；先夹到 250ms', () => {
  assert.equal(S.revealStep({backlog: 120, elapsedMs: 150}), 120);
  assert.equal(S.revealStep({backlog: 120, elapsedMs: 5000}), 120);
  // horizon 比 250 长时，夹过的 elapsed 放不完
  assert.equal(S.revealStep({backlog: 1000, elapsedMs: 5000, horizonMs: 500}), 500);
  assert.equal(S.revealStep({backlog: 100, elapsedMs: 50, horizonMs: 100}), 50);
});

/* ---------- safeCut / advanceCut ---------- */
test('safeCut：切点拉回字素簇起点', () => {
  const s = 'a👍🏽b';
  assert.equal(S.safeCut(s, 2), 1);
  assert.equal(S.safeCut(s, 3), 1);
  assert.equal(S.safeCut(s, 5), 5);
  assert.equal(S.safeCut('中文', 1), 1);
  assert.equal(S.safeCut('abc', 0), 0);
  assert.equal(S.safeCut('abc', 99), 3);
});

test('safeCut：没有 Intl.Segmenter 时原样返回', () => {
  const saved = Intl.Segmenter;
  try {
    Intl.Segmenter = undefined;
    assert.equal(S.safeCut('a👍🏽b', 2), 2);
  } finally { Intl.Segmenter = saved; }
  assert.equal(S.safeCut('a👍🏽b', 2), 1);
});

test('advanceCut：落在簇中间也至少前进一整个簇', () => {
  const s = 'a👍🏽b';
  assert.equal(S.advanceCut(s, 1, 1), 5);
  assert.equal(S.advanceCut(s, 0, 1), 1);
  assert.equal(S.advanceCut(s, 5, 10), 6);
  assert.equal(S.advanceCut(s, 6, 3), 6);
});

/* ---------- splitBlocks ---------- */
test('splitBlocks：空行分块，块尾空行不算', () => {
  assert.deepEqual(S.splitBlocks('第一段\n\n第二段\n\n'), ['第一段', '第二段']);
  assert.deepEqual(S.splitBlocks('# 标题\n正文'), ['# 标题\n正文']);
  assert.deepEqual(S.splitBlocks(''), []);
});

test('splitBlocks：围栏代码块里的空行不拆', () => {
  const md = '说明\n\n```sh\necho a\n\necho b\n```\n\n结尾';
  assert.deepEqual(S.splitBlocks(md), ['说明', '```sh\necho a\n\necho b\n```', '结尾']);
  // 没闭合的围栏：后面全归它
  assert.deepEqual(S.splitBlocks('```\na\n\nb'), ['```\na\n\nb']);
});

test('splitBlocks：列表内部的空行不拆', () => {
  const md = '- 第一项\n\n- 第二项\n\n  续行\n\n之后的段落';
  assert.deepEqual(S.splitBlocks(md), ['- 第一项\n\n- 第二项\n\n  续行', '之后的段落']);
  assert.deepEqual(S.splitBlocks('1. 一\n\n2. 二'), ['1. 一\n\n2. 二']);
});

/* ---------- closeStreamingTail ---------- */
test('closeStreamingTail：补上没闭合的加粗、斜体、删除线与行内代码', () => {
  assert.equal(S.closeStreamingTail('正在 **加'), '正在 **加**');
  assert.equal(S.closeStreamingTail('*斜'), '*斜*');
  assert.equal(S.closeStreamingTail('~~删'), '~~删~~');
  assert.equal(S.closeStreamingTail('运行 `bcut in'), '运行 `bcut in`');
  assert.equal(S.closeStreamingTail('**先跑 `bcut'), '**先跑 `bcut`**');
  // 收尾标记写到一半：补成完整的
  assert.equal(S.closeStreamingTail('**加粗*'), '**加粗**');
});

test('closeStreamingTail：末尾孤零零的标记去掉', () => {
  assert.equal(S.closeStreamingTail('接着 **'), '接着 ');
  assert.equal(S.closeStreamingTail('接着 *'), '接着 ');
  assert.equal(S.closeStreamingTail('接着 ~'), '接着 ');
  assert.equal(S.closeStreamingTail('接着 _'), '接着 ');
  assert.equal(S.closeStreamingTail('接着 `'), '接着 ');
  assert.equal(S.closeStreamingTail('snake_case'), 'snake_case');
});

test('closeStreamingTail：已配对的不重复补', () => {
  assert.equal(S.closeStreamingTail('一段 **加粗** 和 `代码`'), '一段 **加粗** 和 `代码`');
  assert.equal(S.closeStreamingTail('**加粗**'), '**加粗**');
  assert.equal(S.closeStreamingTail('2 * 3 = 6'), '2 * 3 = 6');
  assert.equal(S.closeStreamingTail('* 列表项\n* 第二项'), '* 列表项\n* 第二项');
  assert.equal(S.closeStreamingTail('`a*b` 之后'), '`a*b` 之后');
});

test('closeStreamingTail：前面已完成的段落不动，只补最后一段', () => {
  assert.equal(S.closeStreamingTail('上一段 **没闭合\n\n这一段 **加'), '上一段 **没闭合\n\n这一段 **加**');
  assert.equal(S.closeStreamingTail('上一段 [链接\n\n这一段'), '上一段 [链接\n\n这一段');
});

test('closeStreamingTail：在没闭合的围栏代码块里什么都不做，代码块里的 ** 不动', () => {
  const open = '看这段：\n\n```js\nconst a = "**";\nconst b = `x';
  assert.equal(S.closeStreamingTail(open), open);
  const tilde = '~~~\n**x\n';
  assert.equal(S.closeStreamingTail(tilde), tilde);
  const closed = '```\n**x\n```\n';
  assert.equal(S.closeStreamingTail(closed), closed);
  // 围栏闭合以后的新段落照常补
  assert.equal(S.closeStreamingTail('```\n**x\n```\n然后 **加'), '```\n**x\n```\n然后 **加**');
});

test('closeStreamingTail：链接只露出文字，没写完的图片整个隐藏', () => {
  assert.equal(S.closeStreamingTail('见 [文档'), '见 文档');
  assert.equal(S.closeStreamingTail('见 [文档]'), '见 文档');
  assert.equal(S.closeStreamingTail('见 [文档](https://exa'), '见 文档');
  assert.equal(S.closeStreamingTail('见 [文档](https://example.test/a)'), '见 [文档](https://example.test/a)');
  assert.equal(S.closeStreamingTail('图 ![封面](cov'), '图 ');
  assert.equal(S.closeStreamingTail('图 ![封'), '图 ');
  assert.equal(S.closeStreamingTail('图 ![封面](cover.png)'), '图 ![封面](cover.png)');
  assert.equal(S.closeStreamingTail('`a[0` 后'), '`a[0` 后');
});

/* ---------- chunkArrivals ---------- */
test('chunkArrivals：2–12 个字符一块、40–120ms 一块，拼回原文', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const text = '我先读一遍文稿，**再**给你一个计划。👍🏽 `bcut project info`';
  const chunks = S.chunkArrivals(text, rand);
  assert.equal(chunks.map((c) => c.text).join(''), text);
  chunks.forEach((c, i) => {
    const n = Array.from(c.text).length;
    if (i < chunks.length - 1) assert.ok(n >= 2 && n <= 12, `块 ${i} 有 ${n} 个字符`);
    assert.ok(c.delay >= 40 && c.delay <= 120);
  });
  assert.equal(chunks[chunks.length - 1].end, text.length);
  assert.deepEqual(S.chunkArrivals('', rand), []);
  assert.equal(S.chunkArrivals('ab', () => 0)[0].delay, 40);
  assert.equal(S.chunkArrivals('a'.repeat(20), () => 0.9999)[0].text.length, 12);
});
