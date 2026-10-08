const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-export.js');
require('./model-task-pill.js');
const P = global.window.BC_TASKPILL;

const T = [
  {id: 'j1', kind: 'transcribe', project: 'p2', title: '转录 · 发布会', sub: 'moss · 本机', status: 'running', pct: 45, phase: '识别中', started: '12 分钟前', cancellable: true},
  {id: 'j2', kind: 'transcribe', project: 'p3', title: '转录 · 课程 03', sub: '排队中 · 第 2 位', status: 'queued', pct: 0, started: '25 分钟前'},
  {id: 'j3', kind: 'export', project: 'p1', status: 'done', pct: 100},
];

test('pillList：只收活着的任务；在跑的先于排队的', () => {
  assert.deepEqual(P.pillList(T).map((t) => t.id), ['j1', 'j2']);
  assert.deepEqual(P.pillList([]), []);
});

test('pillList：这个项目的任务排最前，后起的在前；这个项目的导出不进表（按钮自己报进度）', () => {
  const ts = T.concat([
    {id: 'a1', seq: 1, kind: 'export', project: 'p1', status: 'running', pct: 12},
    {id: 'a2', seq: 2, kind: 'cleanup', project: 'p1', status: 'running', pct: 62},
    {id: 'a3', seq: 3, kind: 'polish', project: 'p1', status: 'running', pct: 5},
  ]);
  assert.deepEqual(P.pillList(ts, {projectId: 'p1'}).map((t) => t.id), ['a3', 'a2', 'j1', 'j2']);
  // 不在编辑器里时导出照常进表
  assert.deepEqual(P.pillList(ts).map((t) => t.id).slice(0, 3), ['a3', 'a2', 'a1']);
});

test('pillList：正在看的任务详情排第一；mineOnly 只报这个项目（Web）', () => {
  assert.deepEqual(P.pillList(T, {focusId: 'j2'}).map((t) => t.id), ['j2', 'j1']);
  assert.deepEqual(P.pillList(T, {projectId: 'p2', mineOnly: true}).map((t) => t.id), ['j1']);
  assert.deepEqual(P.pillList(T, {mineOnly: true}), []);
});

test('智能裁剪等人检查也算活着，不念百分比', () => {
  const crop = {id: 'c', kind: 'crop', project: 'p1', status: 'queued', stage: 'review', pct: 100};
  assert.deepEqual(P.pillList([crop]).map((t) => t.id), ['c']);
  assert.equal(P.label(crop), '智能裁剪 · 等你检查');
  assert.equal(P.row(crop).progress, null);
});

test('label：种类 · 百分比；排队的念排队中；链接导入念阶段', () => {
  assert.equal(P.label(T[0]), '转录 · 45%');
  assert.equal(P.label(T[1]), '转录 · 排队中');
  assert.equal(P.label({origin: 'url', status: 'running', phase: '下载中', pct: 30}), '下载中 · 30%');
  assert.equal(P.label({origin: 'url', status: 'running', phase: '检查链接', pct: null}), '检查链接');
});

test('pill：表头那一条 ＋ 其余条数（+N 与卡片行数同源）', () => {
  assert.equal(P.pill([]), null);
  const one = P.pill([T[0]]);
  assert.equal(one.label, '转录 · 45%');
  assert.equal(one.more, 0);
  const list = P.pillList(T);
  assert.equal(P.pill(list).more, P.card(list).rows.length - 1);
});

test('card：单条是详情、多条带计数头；超过 CARD_MAX 的收成一句', () => {
  const single = P.card([T[0]], 'p2');
  assert.equal(single.multi, false);
  assert.equal(single.title, null);
  assert.deepEqual(single.rows[0], {
    id: 'j1', title: '转录 · 发布会', detail: '识别中 · moss · 本机', meta: '12 分钟前开始 · 这部视频',
    state: '45%', progress: 45, cancellable: true,
  });
  const many = Array.from({length: 7}, (_, i) => ({id: 'x' + i, kind: 'polish', status: 'running', pct: i}));
  const c = P.card(many);
  assert.equal(c.title, '7 个后台任务');
  assert.equal(c.rows.length, P.CARD_MAX);
  assert.equal(c.overflow, 2);
  // 排队的不画进度条、也不说「几分钟前开始」
  const q = P.row(T[1]);
  assert.equal(q.progress, null);
  assert.equal(q.state, '排队中');
  assert.equal(q.meta, '');
});
