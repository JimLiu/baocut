const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
const P = require('./model-panels.js');

const WIDE = 16 / 9, TALL = 9 / 16;

test('rectsFor：两人上下各半，三人三行铺满，四人田字格；人数不对没有版式', () => {
  assert.deepEqual(P.rectsFor('rows', 2), [{x: 0, y: 0, w: 100, h: 50}, {x: 0, y: 50, w: 100, h: 50}]);
  const three = P.rectsFor('rows', 3);
  assert.equal(three.length, 3);
  assert.ok(Math.abs(three[2].y + three[2].h - 100) < 1e-9, '三行铺到底');
  assert.ok(Math.abs(three[1].y + three[1].h - three[2].y) < 1e-9, '行与行之间不留缝');
  assert.equal(P.rectsFor('grid', 4).length, 4);
  assert.equal(P.rectsFor('rows', 4), null);
  assert.equal(P.layoutFor(5), null);
  assert.deepEqual(P.layoutOf(P.rectsFor('rows', 2).map((rect) => ({rect}))), {layout: 'rows', gap: 0});
});

test('rectsFor：上一下二是上格整宽、下面左右两格；间距按画布短边算，横缝竖缝像素相同', () => {
  assert.deepEqual(P.rectsFor('spotlight', 3), [{x: 0, y: 0, w: 100, h: 50}, {x: 0, y: 50, w: 50, h: 50}, {x: 50, y: 50, w: 50, h: 50}]);
  assert.equal(P.rectsFor('spotlight', 2), null);
  assert.deepEqual(P.layoutsFor(3), ['rows', 'spotlight']);
  assert.deepEqual(P.layoutsFor(2), ['rows']);
  /* 9:16 三行、间距 2：竖缝是 2 × 1080 ÷ 1920 = 1.125% 的画面高 */
  assert.deepEqual(P.rectsFor('rows', 3, 2, TALL), [
    {x: 0, y: 0, w: 100, h: 32.583}, {x: 0, y: 33.708, w: 100, h: 32.584}, {x: 0, y: 67.417, w: 100, h: 32.583}]);
  /* 田字格的横缝与竖缝像素一样宽 */
  const g = P.rectsFor('grid', 4, 4, TALL);
  const gx = (g[1].x - g[0].w) * 1080 / 100, gy = (g[2].y - g[0].h) * 1920 / 100;
  assert.ok(Math.abs(gx - gy) < 0.1, `${gx} vs ${gy}`);
  /* 间距 0 与不留间距一样；读回来认得版式与间距，超过 10 的夹到 10 */
  assert.deepEqual(P.rectsFor('rows', 3, 0, TALL), P.rectsFor('rows', 3));
  for (const [layout, n] of [['rows', 2], ['rows', 3], ['spotlight', 3], ['grid', 4]]) {
    assert.deepEqual(P.layoutOf(P.rectsFor(layout, n, 3, TALL).map((rect) => ({rect})), TALL), {layout, gap: 3}, layout);
  }
  assert.deepEqual(P.layoutOf(P.rectsFor('rows', 2, 30, TALL).map((rect) => ({rect})), TALL), {layout: 'rows', gap: 10});
  assert.equal(P.layoutOf([{rect: {x: 0, y: 0, w: 60, h: 100}}, {rect: {x: 60, y: 0, w: 40, h: 100}}], TALL), null, '自己画的格子认不出');
});

test('panelsFrom：上一下二把 main 放上格，其余按左右进下面两格；带间距', () => {
  const a = {left: 0.05, top: 0.2, right: 0.75, bottom: 0.2};
  const b = {left: 0.4, top: 0.2, right: 0.4, bottom: 0.2};
  const c = {left: 0.75, top: 0.2, right: 0.05, bottom: 0.2};
  const p = P.panelsFrom([c, a, b], WIDE, TALL, {layout: 'spotlight', main: 2, gap: 2});
  assert.deepEqual(p.map((x) => x.rect), P.rectsFor('spotlight', 3, 2, TALL));
  const center = (panel) => { const w = P.windowOf(panel.focal, WIDE, P.cellRatio(panel.rect, TALL)); return w.left + w.w / 2; };
  assert.ok(Math.abs(center(p[0]) - 0.5) < 1e-3, '主讲人 b 在上格');
  assert.ok(center(p[1]) < center(p[2]), '其余两人左边的在左下');
});

test('relayout / swapViews：换版式、改间距、放到上格时每格保留看得见的那块原片', () => {
  const regions = [{left: 0.05, top: 0.2, right: 0.75, bottom: 0.2}, {left: 0.4, top: 0.2, right: 0.4, bottom: 0.2},
    {left: 0.75, top: 0.2, right: 0.05, bottom: 0.2}];
  const rows = P.panelsFrom(regions, WIDE, TALL);
  const spot = P.relayout(rows, P.rectsFor('spotlight', 3, 0, TALL), WIDE, TALL);
  rows.forEach((p, i) => {
    const a = P.viewOf(p, WIDE, TALL), b = P.viewOf(spot[i], WIDE, TALL);
    assert.ok(Math.abs(a.cx - b.cx) < 2e-3 && Math.abs(a.cy - b.cy) < 2e-3, `第 ${i} 格中心不动`);
    assert.ok(Math.abs(a.h - b.h) < 2e-3, `第 ${i} 格看得见的高不变`);
  });
  assert.equal(P.relayout(rows, P.rectsFor('grid', 4), WIDE, TALL), rows, '格数不同不换');
  const top = P.swapViews(spot, 0, 2, WIDE, TALL);
  assert.ok(Math.abs(P.viewOf(top[0], WIDE, TALL).cx - P.viewOf(spot[2], WIDE, TALL).cx) < 2e-3, '右下的人到了上格');
  assert.ok(Math.abs(P.viewOf(top[2], WIDE, TALL).cx - P.viewOf(spot[0], WIDE, TALL).cx) < 2e-3);
  assert.deepEqual(top.map((x) => x.rect), spot.map((x) => x.rect));
});

test('zoomAt：指针下那一点不动，夹在 1–4 倍，碰到边说出来', () => {
  const p = [{rect: {x: 0, y: 0, w: 100, h: 50}, focal: {x: 0.5, y: 0.5, zoom: 1.5}}, {rect: {x: 0, y: 50, w: 100, h: 50}, focal: {x: 0.5, y: 0.5, zoom: 1}}];
  const ratio = P.cellRatio(p[0].rect, TALL);
  const at = {x: 0.3, y: 0.4};
  const before = P.windowOf(p[0].focal, WIDE, ratio);
  const r = P.zoomAt(p, 0, 1.2, at, WIDE, TALL);
  assert.equal(r.hit, null);
  assert.equal(r.panels[0].focal.zoom, 1.8);
  const after = P.windowOf(r.panels[0].focal, WIDE, ratio);
  assert.ok(Math.abs((before.left + at.x * before.w) - (after.left + at.x * after.w)) < 1e-3, '横向不动');
  assert.ok(Math.abs((before.top + at.y * before.h) - (after.top + at.y * after.h)) < 1e-3, '纵向不动');
  assert.equal(r.panels[1], p[1], '别的格子不动');
  assert.equal(P.zoomAt(p, 0, 9, at, WIDE, TALL).hit, 'max');
  assert.equal(P.zoomAt(p, 0, 9, at, WIDE, TALL).panels[0].focal.zoom, P.MAX_ZOOM);
  assert.equal(P.zoomAt(p, 1, 0.5, at, WIDE, TALL).hit, 'min');
  /* 在贴着原片左边的地方缩小：窗口被推回原片里 */
  const edge = [{rect: p[0].rect, focal: {x: 0, y: 0.5, zoom: 3}}];
  const out = P.zoomAt(edge, 0, 0.8, {x: 0.9, y: 0.5}, WIDE, TALL);
  assert.equal(out.hit, 'edge');
  assert.equal(out.panels[0].focal.x, 0);
});

test('cellRatio：9:16 画面的上下两格是 9:8', () => {
  assert.equal(P.cellRatio({x: 0, y: 0, w: 100, h: 50}, TALL), 1.125);
  assert.equal(P.cellRatio({x: 0, y: 0, w: 50, h: 50}, TALL), TALL);
});

test('regionToFocal：放大到刚好装下区域，窗口以区域中心为中心', () => {
  const cell = 9 / 8;
  /* 左边那个人：中心 0.3，宽 0.3，高 0.6 */
  const r = P.regionToFocal({left: 0.15, top: 0.15, right: 0.55, bottom: 0.25}, WIDE, cell);
  assert.equal(r.cropped, false);
  assert.equal(r.focal.zoom, 1.667, '高度先顶满：1 ÷ 0.6');
  const w = P.windowOf(r.focal, WIDE, cell);
  assert.ok(Math.abs(w.left + w.w / 2 - 0.3) < 1e-3, '窗口中心落在这个人身上');
  assert.ok(Math.abs(w.top + w.h / 2 - 0.45) < 1e-3);
  /* 贴着原片左边的人：窗口往里推，不露出原片外面 */
  const edge = P.regionToFocal({left: 0, top: 0.2, right: 0.8, bottom: 0.2}, WIDE, cell);
  assert.ok(Math.abs(P.windowOf(edge.focal, WIDE, cell).left) < 1e-3);
  assert.equal(edge.focal.x, 0);
});

test('regionToFocal：区域比这一格最宽的窗口还宽时对准中心、标出裁掉', () => {
  const r = P.regionToFocal({left: 0.05, top: 0, right: 0.05, bottom: 0}, WIDE, 9 / 8);
  assert.equal(r.cropped, true);
  assert.equal(r.focal.zoom, 1);
  assert.equal(r.focal.x, 0.5);
});

test('panelsFrom：按区域中心从左到右排进格子，给的次序不影响结果', () => {
  const left = {left: 0.15, top: 0.15, right: 0.55, bottom: 0.25};
  const right = {left: 0.55, top: 0.15, right: 0.15, bottom: 0.25};
  const a = P.panelsFrom([right, left], WIDE, TALL);
  const b = P.panelsFrom([left, right], WIDE, TALL);
  assert.deepEqual(a, b);
  assert.ok(a[0].focal.x < a[1].focal.x, '最左的人在上面');
  assert.equal(P.panelsFrom([left], WIDE, TALL), null, '一个人不分屏');
});

test('upscaleOf：1080p 原片剪 1080×1920，两格的放大量比一人近景小', () => {
  const src = {width: 1920, height: 1080}, out = {width: 1080, height: 1920};
  const two = P.panelsFrom([{left: 0.15, top: 0.15, right: 0.55, bottom: 0.25}, {left: 0.55, top: 0.15, right: 0.15, bottom: 0.25}], WIDE, TALL);
  const single = {rect: {x: 0, y: 0, w: 100, h: 100}, focal: {x: 0.5, y: 0.5, zoom: 1}};
  assert.ok(P.upscaleOf(two[0], src, out) < P.upscaleOf(single, src, out));
  assert.ok(P.upscaleOf(two[0], src, out) < P.UPSCALE_WARN);
});

test('swap / withFocal / applyTo：格子不动，只动取景点', () => {
  const p = P.defaultPanels();
  const s = P.swap(p);
  assert.deepEqual(s.map((x) => x.rect), p.map((x) => x.rect));
  assert.equal(s[0].focal.x, 0.75);
  assert.equal(P.withFocal(p, 1, {zoom: 9}).at(1).focal.zoom, P.MAX_ZOOM);
  assert.equal(P.withFocal(p, 0, {x: -1}).at(0).focal.x, 0);
  assert.equal(P.applyTo(s, p)[0].focal.x, 0.75);
  const spaced = P.rectsFor('rows', 2, 2, TALL).map((rect, i) => ({rect, focal: s[i].focal}));
  assert.deepEqual(P.applyTo(spaced, p).map((x) => x.rect), spaced.map((x) => x.rect), '格子（间距）一起套');
  assert.equal(P.applyTo(s, P.rectsFor('grid', 4).map((rect) => ({rect, focal: {x: 0.5, y: 0.5, zoom: 1}}))), null, '格数不同不套');
});

test('soloFrom：只留一格的人时，这个人仍在原片里原来的横向位置', () => {
  const p = P.panelsFrom([{left: 0.15, top: 0.15, right: 0.55, bottom: 0.25}, {left: 0.55, top: 0.15, right: 0.15, bottom: 0.25}], WIDE, TALL);
  const top = P.soloFrom(p[0], WIDE, TALL);
  const bottom = P.soloFrom(p[1], WIDE, TALL);
  assert.ok(top.x < 0.5 && bottom.x > 0.5);
  assert.equal(top.zoom, 1);
  /* 一人的窗口宽 0.316：中心落在 0.3 */
  const u = 1 / (WIDE / TALL);
  assert.ok(Math.abs(top.x * (1 - u) + u / 2 - 0.3) < 2e-3);
});

test('names：格子的叫法', () => {
  assert.deepEqual(P.names(2), ['上', '下']);
  assert.deepEqual(P.names(4), ['左上', '右上', '左下', '右下']);
  assert.deepEqual(P.names(3), ['上', '中', '下']);
  assert.deepEqual(P.names(3, 'spotlight'), ['上', '左下', '右下']);
});

test('seams：上下两格与田字格是 50，三行是两条；左右并排没有横向接缝', () => {
  assert.deepStrictEqual(P.seams(P.rectsFor('rows', 2).map((rect) => ({rect}))), [50]);
  assert.deepStrictEqual(P.seams(P.rectsFor('rows', 3).map((rect) => ({rect}))), [33.333, 66.667]);
  assert.deepStrictEqual(P.seams(P.rectsFor('grid', 4).map((rect) => ({rect}))), [50]);
  assert.deepStrictEqual(P.seams([{rect: {x: 0, y: 0, w: 50, h: 100}}, {rect: {x: 50, y: 0, w: 50, h: 100}}]), []);
  /* 留了间距的取缝的中线；上一下二只有一条横缝 */
  assert.deepStrictEqual(P.seams(P.rectsFor('rows', 3, 2, TALL).map((rect) => ({rect}))), [33.146, 66.855]);
  assert.deepStrictEqual(P.seams(P.rectsFor('spotlight', 3, 2, TALL).map((rect) => ({rect}))), [50]);
  /* 隔得太远的不算接缝 */
  assert.deepStrictEqual(P.seams([{rect: {x: 0, y: 0, w: 100, h: 40}}, {rect: {x: 0, y: 60, w: 100, h: 40}}]), []);
});

test('captionSeam：按这一句自己的开始定，整块的中点平移到最近的接缝；关掉、自己写了 y 的不挪', () => {
  const panels = P.rectsFor('rows', 2).map((rect) => ({rect}));
  const spans = P.spansOf([{id: 'v', kind: 'video'}, {id: 'w', kind: 'video'}], {v: {start: 10, end: 20, panels}, w: {start: 0, end: 30}}, 206);
  assert.deepStrictEqual(spans, [{start: 10, end: 20, seams: [50]}]);
  assert.strictEqual(P.captionSeam(spans, true, 12, [{y: 86}]), -36);
  // 双语两条轨一起挪，中点落在接缝上
  assert.strictEqual(P.captionSeam(spans, true, 12, [{y: 80}, {y: 86}]), -33);
  // 开始在一人段、延续进分屏段的不挪；开始在分屏段、延续出去的照挂
  assert.strictEqual(P.captionSeam(spans, true, 9, [{y: 86}]), null);
  assert.strictEqual(P.captionSeam(spans, true, 19.5, [{y: 86}]), -36);
  assert.strictEqual(P.captionSeam(spans, false, 12, [{y: 86}]), null);
  assert.strictEqual(P.captionSeam(spans, true, 12, [{y: 86}, {y: 20, ownY: true}]), null);
  // 三行取离锚线最近的那条；隐藏的视频不算
  const rows3 = [{start: 0, end: 5, seams: P.seams(P.rectsFor('rows', 3).map((rect) => ({rect})))}];
  assert.strictEqual(P.captionSeam(rows3, true, 1, [{y: 86}]), -19.333);
  assert.deepStrictEqual(P.spansOf([{id: 'v', kind: 'video'}], {v: {start: 10, end: 20, panels, hidden: true}}, 206), []);
});

