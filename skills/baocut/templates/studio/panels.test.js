const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./panels.js');

function fakeStorage(init) {
  const map = Object.assign({}, init);
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    _map: map,
  };
}

test('normalize 只认布尔并保证 stage/rpane 不同时为假', () => {
  assert.deepEqual(P.normalize(null), { sidebar: true, rpane: true, timeline: true, stage: true });
  assert.deepEqual(P.normalize({ sidebar: false, timeline: 'yes' }),
    { sidebar: false, rpane: true, timeline: true, stage: true });
  assert.deepEqual(P.normalize({ stage: false, rpane: false }),
    { sidebar: true, rpane: false, timeline: true, stage: true });
});

test('setPanel 关掉 stage/rpane 中的后一个时把另一个开回来', () => {
  const base = P.normalize(null);
  const noStage = P.setPanel(base, 'stage', false);
  assert.deepEqual(noStage, { sidebar: true, rpane: true, timeline: true, stage: false });
  // 舞台已关，再关 rpane → rpane 关不掉之外还得把 stage 开回来
  const back = P.setPanel(noStage, 'rpane', false);
  assert.equal(back.rpane, false);
  assert.equal(back.stage, true);
  // 未知面板名不改变状态
  assert.deepEqual(P.setPanel(base, 'nope', false), base);
  // 原对象不被就地修改
  assert.equal(base.stage, true);
});

test('setPanel 其它面板互不影响', () => {
  const base = P.normalize(null);
  assert.deepEqual(P.setPanel(base, 'timeline', false),
    { sidebar: true, rpane: true, timeline: false, stage: true });
  assert.deepEqual(P.setPanel(base, 'sidebar', false),
    { sidebar: false, rpane: true, timeline: true, stage: true });
});

test('loadPanels / savePanels 走 localStorage 且能吃下脏数据', () => {
  assert.deepEqual(P.loadPanels(null), P.DEFAULTS);
  assert.deepEqual(P.loadPanels(fakeStorage({ 'bcs:panels': 'not json' })), P.DEFAULTS);
  const s = fakeStorage({ 'bcs:panels': JSON.stringify({ sidebar: false, timeline: false }) });
  assert.deepEqual(P.loadPanels(s), { sidebar: false, rpane: true, timeline: false, stage: true });
  P.savePanels(s, { sidebar: false, rpane: false, timeline: true, stage: false });
  assert.deepEqual(JSON.parse(s._map['bcs:panels']),
    { sidebar: false, rpane: false, timeline: true, stage: true });
});

test('侧栏宽度读取与拖拽限幅', () => {
  assert.equal(P.loadSidebarWidth(null), 240);
  assert.equal(P.loadSidebarWidth(fakeStorage({ 'vk-sidebar-w': '900' })), 400);
  assert.equal(P.loadSidebarWidth(fakeStorage({ 'vk-sidebar-w': '30' })), 220);
  assert.equal(P.loadSidebarWidth(fakeStorage({ 'vk-sidebar-w': 'x' })), 240);
  assert.deepEqual(P.sidebarDrag(300), { hide: false, width: 300 });
  assert.deepEqual(P.sidebarDrag(150), { hide: false, width: 220 });   // 100–220 钉在 220
  assert.deepEqual(P.sidebarDrag(80), { hide: true, width: 220 });
  assert.deepEqual(P.sidebarDrag(999), { hide: false, width: 400 });
});

test('时间轴高度拖拽：<80 自动隐藏，其余在 160–80% 之间', () => {
  assert.deepEqual(P.timelineDrag(300, 900), { hide: false, height: 300 });
  assert.deepEqual(P.timelineDrag(120, 900), { hide: false, height: 160 });
  assert.deepEqual(P.timelineDrag(60, 900), { hide: true, height: 160 });
  assert.deepEqual(P.timelineDrag(800, 900), { hide: false, height: 720 });
  // 容器很矮时 max 不得低于 min
  assert.deepEqual(P.timelineDrag(500, 100), { hide: false, height: 160 });
});

test('右侧 pane 宽度限幅给舞台留出 420', () => {
  assert.equal(P.rpaneDrag(500, 1400), 500);
  assert.equal(P.rpaneDrag(100, 1400), 360);
  assert.equal(P.rpaneDrag(1300, 1400), 980);
});

test('中文相对时间', () => {
  const now = new Date(2026, 7, 17, 12, 0, 0).getTime();
  const min = 60000, hour = 60 * min;
  assert.equal(P.relativeTime(now - 20 * 1000, now), '刚刚');
  assert.equal(P.relativeTime(now - 5 * min, now), '5 分钟前');
  assert.equal(P.relativeTime(now - 2 * hour, now), '2 小时前');
  // 今天 12:00 看昨天 20:00 → 16 小时前仍算"小时"，昨天 06:00 才是"昨天"
  assert.equal(P.relativeTime(new Date(2026, 7, 16, 20, 0, 0).getTime(), now), '16 小时前');
  assert.equal(P.relativeTime(new Date(2026, 7, 16, 6, 0, 0).getTime(), now), '昨天');
  assert.equal(P.relativeTime(new Date(2026, 7, 14, 9, 0, 0).getTime(), now), '3 天前');
  assert.equal(P.relativeTime(new Date(2026, 7, 5, 9, 0, 0).getTime(), now), '1 周前');
  assert.equal(P.relativeTime(new Date(2026, 5, 5, 9, 0, 0).getTime(), now), '2 个月前');
  assert.equal(P.relativeTime(new Date(2024, 5, 5, 9, 0, 0).getTime(), now), '2 年前');
  assert.equal(P.relativeTime(null, now), '');
  assert.equal(P.relativeTime(now + 10 * min, now), '刚刚');
});

test('媒体类型图标兜底', () => {
  assert.equal(P.mediaIcon('audio'), 'audio-wave');
  assert.equal(P.mediaIcon('image'), 'image');
  assert.equal(P.mediaIcon('project'), 'folder');
  assert.equal(P.mediaIcon('video'), 'video');
  assert.equal(P.mediaIcon(null), 'video');
  assert.equal(P.mediaIcon('weird'), 'video');
});

test('从路径解析项目 id（忽略 tab 末段）', () => {
  assert.equal(P.projectIdFromPath('/projects/p130.bcut/'), 'p130.bcut');
  assert.equal(P.projectIdFromPath('/projects/p130.bcut/translation'), 'p130.bcut');
  assert.equal(P.projectIdFromPath('/p130.bcut/subtitle'), 'p130.bcut');
  assert.equal(P.projectIdFromPath('/'), null);
  assert.equal(P.projectIdFromPath('/style'), null);
  assert.equal(P.projectIdFromPath(''), null);
});

test('当前项目：URL 命中优先，单项目模式回落 root', () => {
  const list = [
    { id: 'p1', root: false },
    { id: 'p2', root: true },
  ];
  assert.equal(P.currentProject(list, '/projects/p1/').id, 'p1');
  assert.equal(P.currentProject(list, '/').id, 'p2');
  assert.equal(P.currentProject(list, '/unknown/').id, 'p2');
  assert.equal(P.currentProject([], '/projects/p1/'), null);
  assert.equal(P.currentProject(null, '/'), null);
});

test('healthz 兜底投影只带 id/path，title 用 id', () => {
  assert.deepEqual(P.fromHealthz({ projects: [{ id: 'p1', path: '/a/p1.bcut', root: true }] }), [
    { id: 'p1', path: '/a/p1.bcut', title: 'p1', mediaKind: null, duration: null, modifiedAt: null, root: true },
  ]);
  assert.deepEqual(P.fromHealthz(null), []);
});
