const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-home-docs-versions.js');
const V = window.BC_HOME_DOCS_VERSIONS;

const h = (id, text) => ({id, type: 'h2', text});
const p = (id, text) => ({id, type: 'p', text});
const v1 = [h('b1', '目标'), p('b2', '首月 800 名付费学员。'), h('b3', '上线节奏'), p('b4', '每周一讲。')];
const v2 = [h('b1', '目标'), p('b2', '首月 500 名付费学员。'), h('b3', '上线节奏'), p('b4', '每周一讲。')];
const now = [h('b1', '目标'), p('b2', '首月 500 名付费学员。'), h('b3', '上线节奏'), p('b4', '每周一讲，第 5 讲后两周一讲。'), h('b5', '渠道'), p('b6', '邮件列表。')];
const doc = {id: 'docs-x', tabs: [{id: 'plan', name: '计划', blocks: now}, {id: 'empty', name: '空白', blocks: [p('b1', '还没写')]}],
  versions: {plan: [
    {n: 1, day: '昨天', start: '21:40', end: '21:52', by: [{kind: 'you'}], cut: 'quiet', blocks: v1},
    {n: 2, day: '昨天', start: '22:10', end: '22:10', by: [{kind: 'you'}], cut: 'turn', blocks: v2},
    {n: 3, day: '今天', start: '10:05', end: '10:12', by: [{kind: 'agent', session: 's1'}], open: true},
  ]}};
const title = (id) => (id === 's1' ? '发布计划' : null);

test('列表：data.js 里最新的一版就是标签页现在的正文；没有版本的标签页只有一版', () => {
  const vs = V.list(doc, 'plan');
  assert.deepEqual(vs.map((v) => v.n), [1, 2, 3]);
  assert.equal(vs[2].blocks, now);
  assert.equal(V.current(doc, 'plan'), now);
  const one = V.list(doc, 'empty');
  assert.equal(one.length, 1);
  assert.equal(one[0].open, true);
  assert.deepEqual(V.list(doc, 'missing'), []);
});

test('行：新的在前，摘要是改了哪几个小节，带时间与谁改的', () => {
  const rows = V.rows(doc, 'plan', null, title);
  assert.deepEqual(rows.map((r) => r.n), [3, 2, 1]);
  assert.equal(rows[2].title, '第一版');
  assert.equal(rows[1].title, '改了「目标」');
  assert.equal(rows[0].title, '改了「上线节奏」「渠道」');
  assert.equal(rows[0].sub, '今天 10:05–10:12 · 智能体（发布计划）');
  assert.equal(rows[1].sub, '昨天 22:10 · 你');
  assert.equal(rows[0].open, true);
});

test('改动：按块 id 对上；删掉的块按原来的顺序插回去', () => {
  const marks = V.diff(v2, now).map((x) => `${x.block.id}:${x.status}`);
  assert.deepEqual(marks, ['b1:same', 'b2:same', 'b3:same', 'b4:changed', 'b5:added', 'b6:added']);
  const A = p('A', 'a'), B = p('B', 'b'), C = p('C', 'c'), D = p('D', 'd');
  assert.deepEqual(V.diff([A, B, C, D], [A, D]).map((x) => `${x.block.id}:${x.status}`), ['A:same', 'B:removed', 'C:removed', 'D:same']);
  assert.deepEqual(V.diff([A, B, C], [C]).map((x) => `${x.block.id}:${x.status}`), ['A:removed', 'B:removed', 'C:same']);
  assert.ok(V.diff(null, now).every((x) => x.status === 'same'));
  assert.equal(V.summary({blocks: v1}, {blocks: v1}), '没有改动正文');
  assert.equal(V.summary({blocks: [A, B, C, D]}, {blocks: [A]}), '改了「开头」');
});

test('摘要：超过两个小节只列前两个', () => {
  const a = [h('x1', '一'), p('x2', '1'), h('x3', '二'), p('x4', '2'), h('x5', '三'), p('x6', '3')];
  const b = [h('x1', '一'), p('x2', '1!'), h('x3', '二'), p('x4', '2!'), h('x5', '三'), p('x6', '3!')];
  assert.equal(V.summary({blocks: a}, {blocks: b}), '改了「一」「二」等 3 处');
});

test('详情：最新一版回不去；和现在一样的旧版本也不能回', () => {
  const d3 = V.detail(doc, 'plan', null, 3, title);
  assert.equal(d3.latest, true);
  assert.equal(d3.canRestore, false);
  assert.equal(d3.why, '这就是标签页现在的正文');
  const d1 = V.detail(doc, 'plan', null, 1, title);
  assert.equal(d1.canRestore, true);
  assert.equal(d1.first, true);
  assert.equal(d1.cut, '之后安静了 5 分钟');
  assert.deepEqual(d3.sessions, ['s1']);
  assert.deepEqual(d1.sessions, []);
  assert.equal(V.detail(doc, 'plan', null, 9), null);
});

test('回到版本：加一个新版本、带那一版的正文；还开着的那一版收口；可以再回去', () => {
  const r = V.restore(doc, 'plan', null, 1, '11:30');
  assert.equal(r.version, 4);
  const vs = V.list(doc, 'plan', r.extra);
  assert.deepEqual(vs.map((v) => v.n), [1, 2, 3, 4]);
  assert.equal(vs[2].open, false);
  assert.equal(vs[2].cut, 'restore');
  assert.equal(vs[2].blocks, now);
  assert.equal(vs[3].kind, 'restore');
  assert.deepEqual(V.current(doc, 'plan', r.extra), v1);
  /* 收口的那一版和回到版本加出来的那一版，改动都对着前一版算 */
  const d3 = V.detail(doc, 'plan', r.extra, 3, title);
  assert.equal(d3.canRestore, true);
  assert.equal(d3.cut, '之后回到了别的版本');
  assert.ok(V.changeCount(d3.changes) > 0);
  const d4 = V.detail(doc, 'plan', r.extra, 4, title);
  assert.equal(d4.title, '回到版本 1');
  assert.equal(d4.by, '你');
  assert.deepEqual(d4.changes.filter((x) => x.status !== 'same').map((x) => `${x.block.id}:${x.status}`), ['b2:changed', 'b4:changed', 'b5:removed', 'b6:removed']);
  /* 版本 1 现在就是标签页的正文：回到它没有改动 */
  assert.equal(V.detail(doc, 'plan', r.extra, 1).canRestore, false);
  assert.deepEqual(V.restore(doc, 'plan', r.extra, 1, '11:31'), {noop: true, extra: r.extra});
  /* 再回到版本 3：又加一版，正文回到现在这样 */
  const back = V.restore(doc, 'plan', r.extra, 3, '11:32');
  assert.equal(back.version, 5);
  assert.equal(V.current(doc, 'plan', back.extra), now);
  assert.equal(V.restore(doc, 'plan', null, 7, '11:33').error, '没有版本 7');
});

test('保留：每个标签页最多 10 个，删最旧的', () => {
  let extra = null;
  for (let i = 0; i < 10; i++) {
    const all = V.list(doc, 'plan', extra);
    const r = V.restore(doc, 'plan', extra, all[all.length - 2].n, `12:0${i}`);
    assert.ok(r.version, `第 ${i + 1} 次`);
    extra = r.extra;
  }
  const vs = V.list(doc, 'plan', extra);
  assert.equal(vs.length, V.KEEP);
  assert.equal(vs[0].n, 4);
  assert.equal(vs[vs.length - 1].n, 13);
  assert.equal(V.detail(doc, 'plan', extra, 4).first, true);
});

test('演示数据：每个标签页的版本号连续，最新一版不写正文、还开着，其余各带正文且不和后一版一样', () => {
  ['substyle', 'pose', 'shape-paths', 'elements', 'textpresets', 'wordanim', 'subanim', 'subpresets', 'motioncaption', 'template', 'cut', 'defaultsub']
    .forEach((m) => require(`./model-${m}.js`));
  require('./data.js');
  const demo = window.BC_DATA.spaceOutputs.find((x) => x.kind === 'docs' && x.versions);
  assert.ok(demo);
  for (const [tabId, vs] of Object.entries(demo.versions)) {
    assert.ok(demo.tabs.some((t) => t.id === tabId), tabId);
    assert.ok(vs.length <= V.KEEP);
    vs.forEach((v, i) => assert.equal(v.n, vs[0].n + i));
    const last = vs[vs.length - 1];
    assert.equal(last.blocks, undefined);
    assert.equal(last.open, true);
    vs.slice(0, -1).forEach((v) => { assert.ok(v.blocks && v.cut, `${tabId} ${v.n}`); assert.equal(v.open, undefined); });
    V.list(demo, tabId).forEach((v, i, all) => { if (i) assert.notEqual(V.summary(all[i - 1], v), '没有改动正文', `${tabId} ${v.n}`); });
  }
});
