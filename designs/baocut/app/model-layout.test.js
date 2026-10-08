const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-layout.js');
const L = global.window.BC_LAYOUT;

test('侧边栏三档：正常 / 钳到区间 / 拖窄进 ghost', () => {
  assert.deepEqual(L.sidebar(232), {width: 232, ghost: false, last: 232});
  assert.equal(L.sidebar(500).width, 400, '上限 400');
  assert.equal(L.sidebar(120).width, 120);
  assert.equal(L.sidebar(100).ghost, true, '<=100 进 ghost');
  assert.equal(L.sidebar(60).ghost, true);
});

test('App 的页面侧栏（PAGE_SIDE）：默认 240、最窄 200、上限 400，拖到 100 以下仍收起；不传就是 Web 那组数', () => {
  const P = L.PAGE_SIDE;
  assert.equal(P.def, 240);
  assert.ok(P.def >= 240 && P.def <= 280, '默认落在 240–280');
  assert.equal(P.min, 200);
  assert.deepEqual(L.sidebar(240, null, P), {width: 240, ghost: false, last: 240});
  assert.equal(L.sidebar(120, null, P).width, 200, '比 200 窄就钳到 200，不收起');
  assert.equal(L.sidebar(199, null, P).width, 200);
  assert.equal(L.sidebar(320, null, P).width, 320, '拖宽多少就是多少（记住的是这个值）');
  assert.equal(L.sidebar(500, null, P).width, 400, '上限 400');
  assert.equal(L.sidebar(100, null, P).ghost, true, '<=100 进 ghost');
  assert.equal(L.sidebar(60, null, P).last, 240, '收起后没有记录就恢复到默认 240');
  assert.equal(L.sidebar(60, 300, P).last, 300, '收起后恢复到上次的宽度');
  assert.equal(L.sidebar(120).width, 120, 'Web（不传 PAGE_SIDE）仍可拖到 88–200 之间');
  assert.equal(L.sidebar(60).last, 232, 'Web 的默认仍是 232');
});

test('ghost 后拖回来恢复到上次宽度，不是默认宽（§20 #2 的格式限制不继承）', () => {
  const collapsed = L.sidebar(60, 300);
  assert.equal(collapsed.last, 300);
  assert.equal(L.sidebar(collapsed.last).width, 300);
});

test('右面板 ghost 带是 [300,340)', () => {
  assert.equal(L.pane(360).width, 360);
  assert.equal(L.pane(340).width, 340, '340 仍是可见态');
  assert.equal(L.pane(339).ghost, true);
  assert.equal(L.pane(600).width, 560, '上限 560');
  assert.equal(L.pane(null).width, 360, '默认 360');
  assert.equal(L.pane(360, true).ghost, true, '显式收起');
});

test('拖隐 → rail 点击 → 恢复到 last（ghost 不是单向门，第 104 轮）', () => {
  // 拖进 ghost 带：结果的 last 就是恢复宽度——调用方要把它写回宽度偏好，不能写 0
  const g = L.pane(320, false, 400);
  assert.equal(g.ghost, true);
  assert.equal(g.last, 400, 'ghost 结果携带恢复宽度');
  // rail 展开 = hidden 翻回 false、宽度用 last：面板真的回来，宽度是拖隐前那份
  const back = L.pane(g.last, false, g.last);
  assert.equal(back.ghost, false);
  assert.equal(back.width, 400);
  // solve 同口径核一遍
  const r = L.solve({contentWidth: 1400, contentHeight: 800, paneWidth: g.last, paneHidden: false});
  assert.equal(r.paneW, 400);
  assert.equal(r.paneGhost, false);
  // 反例：宽度偏好被写成 0 就是当年的单向门——pane() 会再判 ghost
  assert.equal(L.pane(0, false, 400).ghost, true);
});

test('内容区求解：rail 恒 68 且在最右', () => {
  const r = L.solve({contentWidth: 1400, contentHeight: 800});
  assert.equal(r.railW, 68);
  assert.equal(r.paneW, 360);
  assert.equal(r.splitterW, 0, '分隔线的拖拽命中区覆盖两侧，不留白缝');
  assert.equal(r.stageW + r.paneW + r.railW, 1400, '三块区域用满宽度');
  assert.equal(r.timelineH, 246);
  assert.equal(r.stageH, 800 - 246);
});

test('窗口变窄时压面板给舞台留 420', () => {
  const r = L.solve({contentWidth: 900, contentHeight: 800, paneWidth: 560});
  assert.ok(r.stageW >= 420, '舞台不低于 STAGE_MIN_W');
  assert.equal(r.paneW, 900 - 68 - 420);
});

test('时间轴钳在 [60, 内容高 − 舞台最小高]，没有全隐态', () => {
  assert.equal(L.solve({contentWidth: 1400, contentHeight: 800, timelineHeight: 10}).timelineH, 60);
  assert.equal(L.solve({contentWidth: 1400, contentHeight: 800, timelineHeight: 9999}).timelineH, 800 - 260);
  assert.equal(L.solve({contentWidth: 1400, contentHeight: 200, timelineHeight: 30}).timelineH, 60,
    '窗口再矮，章节条 + transport 也恒在');
});

test('全屏：舞台吃满，其余归零', () => {
  const r = L.solve({contentWidth: 1400, contentHeight: 800, fullscreen: true});
  assert.deepEqual([r.stageW, r.stageH, r.paneW, r.railW, r.timelineH], [1400, 800, 0, 0, 0]);
});

test('舞台 aspect-fit 留 32 内边距，宽高各自受限', () => {
  assert.deepEqual(L.fitStage(1000, 600, 16 / 9), {w: 936, h: 527}, '高不是瓶颈时按宽');
  assert.deepEqual(L.fitStage(1000, 300, 16 / 9), {w: 420, h: 236}, '矮的时候按高');
  assert.deepEqual(L.fitStage(20, 20, 16 / 9), {w: 0, h: 0});
});

test('全屏播放：inset 传 0 就吃满整个盒子（第 222 轮）', () => {
  assert.deepEqual(L.fitStage(1920, 1080, 16 / 9, 0), {w: 1920, h: 1080});
  assert.deepEqual(L.fitStage(1920, 1200, 16 / 9, 0), {w: 1920, h: 1080}, '屏比画面高就上下留黑');
  assert.deepEqual(L.fitStage(1000, 600, 16 / 9, 0), {w: 1000, h: 563});
});

test('比例解析，Original 无实测尺寸回落 16:9', () => {
  assert.equal(L.ratioValue('16:9'), 16 / 9);
  assert.equal(L.ratioValue('9:16'), 9 / 16);
  assert.equal(L.ratioValue('2.35:1'), 2.35);
  assert.equal(L.ratioValue('Original'), 16 / 9);
  assert.equal(L.ratioValue('Original', 4 / 3), 4 / 3);
  assert.equal(L.ratioValue('nonsense'), 16 / 9);
});


test('窄编辑区的覆盖工具面板保留可读宽度，舞台仍占完整可用宽度', () => {
  const geo = L.solve({contentWidth:600, contentHeight:800, paneWidth:360, overlayNarrow:true});
  assert.equal(geo.paneOverlay, true);
  assert.equal(geo.paneW, 360);
  assert.equal(geo.stageW, 532);
  assert.equal(geo.splitterW, 0);
  const hidden = L.solve({contentWidth:600, contentHeight:800, paneWidth:360, overlayNarrow:true, paneHidden:true});
  assert.equal(hidden.paneW, 0);
  assert.equal(hidden.stageW, 532);
});
