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
  assert.equal(P.layoutOf(P.rectsFor('rows', 2).map((rect) => ({rect}))), 'rows');
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
});
