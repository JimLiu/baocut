/* node --test designs/baocut/app/model-trans-run.test.js */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-trans-run.js');
const R = window.BC_TRUN;

const ROWS = [1, 2, 3, 4, 5, 6];
const states = (pct, queued) => R.runSlice(ROWS, pct, queued).rows.map((r) => r.state);
const name = (pct, queued) => R.TRANS_STAGES[R.stage(pct, queued)];

test('四段的分界不是四等分——读文稿是快步骤，翻译才是主体', () => {
  assert.equal(name(0), '读文稿');
  assert.equal(name(7), '读文稿');
  assert.equal(name(8), '翻译');
  // App v2 的 floor(pct/25) 在这里会说「读文稿」，而那时卡片已经在流了
  assert.equal(name(20), '翻译');
  assert.equal(name(69), '翻译');
  assert.equal(name(70), '拆分对齐');
  assert.equal(name(95), '拆分对齐');
  assert.equal(name(96), '落盘');
  assert.equal(name(100), '落盘');
});

test('排队中恒在第一段——它还没开始读，进度是多少都一样', () => {
  assert.equal(name(0, true), '读文稿');
  assert.equal(name(80, true), '读文稿');
  assert.deepEqual(states(80, true), []);
});

test('读文稿这一段不渲染任何句子——没读到的东西摆一排灰条是在假装进度', () => {
  assert.deepEqual(states(0), []);
  assert.deepEqual(states(7), []);
});

test('翻译段：句子一句句上屏，在飞那句在末尾，后面的不渲染', () => {
  assert.deepEqual(states(20), ['translated', 'translating']);
  assert.deepEqual(states(50), ['translated', 'translated', 'translated', 'translated', 'translating']);
  // 整句上屏、没有块刻度是合法中间态：这一段里一条 aligned 都不该有
  assert.ok(!states(50).includes('aligned'));
  assert.ok(!states(50).includes('aligning'));
});

test('对齐段：译文都在了，刻度一条条长出来，同刻只有一句在长', () => {
  const s = states(85);
  assert.equal(s.length, ROWS.length, '这一段所有句子都已有译文，全部渲染');
  assert.equal(s.filter((x) => x === 'aligning').length, 1);
  assert.deepEqual(s, ['aligned', 'aligned', 'aligned', 'aligning', 'translated', 'translated']);
});

test('对齐段的开头：一条都没对齐，第一句正在长刻度', () => {
  assert.equal(states(70)[0], 'aligning');
  assert.ok(!states(70).includes('aligned'));
});

test('落盘段：全部成形', () => {
  assert.ok(states(97).every((x) => x === 'aligned'));
  assert.ok(states(100).every((x) => x === 'aligned'));
});

test('在飞的句子同刻只有一句', () => {
  for (const pct of [10, 20, 33, 50, 69, 70, 80, 90, 95]) {
    const s = states(pct);
    const flying = s.filter((x) => x === 'translating' || x === 'aligning').length;
    assert.equal(flying, 1, 'pct=' + pct + ' 的在飞句数应为 1，实为 ' + flying);
  }
});

test('行数只在翻译段涨，调用数跟着整条跑', () => {
  const T = {lines: 42, calls: 120};
  assert.deepEqual(R.counts(0, T), {lines: 0, linesTotal: 42, calls: 0, callsTotal: 120});
  const mid = R.counts(39, T);          // 翻译段中点
  assert.ok(mid.lines > 0 && mid.lines < 42);
  assert.equal(R.counts(70, T).lines, 42, '进对齐段时句子已经全部译完');
  assert.equal(R.counts(90, T).lines, 42, '对齐段行数不再涨——它数的是译出来的句子');
  assert.ok(R.counts(90, T).calls > R.counts(70, T).calls, '对齐同样在打模型，调用数继续涨');
  assert.equal(R.counts(100, T).calls, 120);
});

test('排队中两个计数都是 0', () => {
  const c = R.counts(80, {lines: 42, calls: 120}, true);
  assert.equal(c.lines, 0);
  assert.equal(c.calls, 0);
});

test('对齐段的波次短语署名不是翻译模型——那一段跑的是拆分对齐', () => {
  const m = 'claude';
  assert.ok(R.activity(R.runSlice(ROWS, 30), m).startsWith('claude · 正在翻第'));
  assert.ok(R.activity(R.runSlice(ROWS, 85), m).startsWith('align-edges · 正在拆分对齐第'));
  assert.ok(R.activity(R.runSlice(ROWS, 5), m).includes('读文稿'));
  assert.ok(R.activity(R.runSlice(ROWS, 99), m).includes('写回'));
});

test('句序在飞的编号从 1 起，不是 0', () => {
  assert.ok(R.activity(R.runSlice(ROWS, 9), 'x').includes('第 1 句'));
  assert.ok(R.activity(R.runSlice(ROWS, 70), 'x').includes('第 1 句'));
});

test('排队中没有波次短语——那会儿没有任何模型在动', () => {
  assert.equal(R.activity(R.runSlice(ROWS, 0, true), 'claude'), null);
  assert.equal(R.activity(R.runSlice(ROWS, 60, true), 'claude'), null);
  // 一旦真的跑起来就有
  assert.ok(R.activity(R.runSlice(ROWS, 60, false), 'claude'));
});

test('slice 把排队标志带出来，视图不用再问一次任务记录', () => {
  assert.equal(R.runSlice(ROWS, 0, true).queued, true);
  assert.equal(R.runSlice(ROWS, 60).queued, false);
});

/* ---------- 第 207 轮：任务归属与发起方 ---------- */
const JOBS = [
  {id: 'a', kind: 'translate', project: 'p1', status: 'done'},
  {id: 'b', kind: 'transcribe', project: 'p1', status: 'running'},
  {id: 'c', kind: 'translate', project: 'p2', status: 'running'},
  {id: 'd', kind: 'translate', project: 'p1', status: 'queued', source: 'cli'},
  {id: 'e', kind: 'translate', project: 'p1', status: 'running', source: 'agent', session: 's1'},
  {id: 'f', kind: 'translate', project: 'p1', status: 'running', source: 'agent', session: 's2'},
];

test('找的是这个项目的翻译任务，不认死 id；跑着的压过排队的，同态取最新起的', () => {
  assert.equal(R.findJob(JOBS, 'p1').id, 'f');
  assert.equal(R.findJob(JOBS.filter((j) => j.status !== 'running'), 'p1').id, 'd');
  assert.equal(R.findJob(JOBS, 'p2').id, 'c');
  assert.equal(R.findJob(JOBS, 'p3'), null);
  assert.equal(R.findJob([], 'p1'), null);
});

test('发起方三档；没写来源按 app', () => {
  assert.equal(R.sourceKind({source: 'cli'}), 'cli');
  assert.equal(R.sourceKind({source: 'external'}), 'cli');
  assert.equal(R.sourceKind({source: 'agent'}), 'agent');
  assert.equal(R.sourceKind({}), 'app');
});

test('取消钮看 cancellable 位：命令行任务只有明确接受叫停才给，其余默认能取消', () => {
  assert.equal(R.canCancel({source: 'cli'}), false);
  assert.equal(R.canCancel({source: 'cli', cancellable: true}), true);
  assert.equal(R.canCancel({source: 'agent'}), true);
  assert.equal(R.canCancel({source: 'app', cancellable: false}), false);
  assert.equal(R.canCancel(null), false);
});

test('只有 App 自己开的翻译才把列表带到目标语；命令行 / Agent 的不抢列表', () => {
  assert.equal(R.jumpsList({source: 'app'}), true);
  assert.equal(R.jumpsList({source: 'cli'}), false);
  assert.equal(R.jumpsList({source: 'agent'}), false);
});

test('会话标题从 sub 尾段取；压缩版那行字排队与翻译中两种口径', () => {
  assert.equal(R.sessionTitle({sub: 'Claude Code · 会话「翻成英文」'}), '翻成英文');
  assert.equal(R.sessionTitle({sub: 'claude · Anthropic'}), null);
  assert.equal(R.stripText({status: 'running'}, '中', '日本語'), '翻译中 · 中 → 日本語');
  assert.equal(R.stripText({status: 'queued'}, '中', '日本語'), '排队中 · 翻译成 日本語');
});
