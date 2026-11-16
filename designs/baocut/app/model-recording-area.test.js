const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-recording-area.js');
const A = window.BC_REC_AREA;
const B = {x: 0, y: 0, w: 1440, h: 900};

test('画选区：任意方向拖，截在屏幕里；比例时高度跟着宽度', () => {
  assert.deepEqual(A.drawRect({x: 100, y: 100}, {x: 400, y: 300}, 'free', B), {x: 100, y: 100, w: 300, h: 200});
  assert.deepEqual(A.drawRect({x: 400, y: 300}, {x: 100, y: 100}, 'free', B), {x: 100, y: 100, w: 300, h: 200});
  assert.deepEqual(A.drawRect({x: 1400, y: 10}, {x: 1600, y: 50}, 'free', B), {x: 1400, y: 10, w: 40, h: 40});
  assert.deepEqual(A.drawRect({x: 0, y: 0}, {x: 320, y: 10}, '16:9', B), {x: 0, y: 0, w: 320, h: 180});
  assert.deepEqual(A.drawRect({x: 0, y: 0}, {x: 10, y: 300}, '1:1', B), {x: 0, y: 0, w: 300, h: 300});
  /* 比例选区碰到屏幕边就整体缩回来 */
  const r = A.drawRect({x: 1000, y: 800}, {x: 1440, y: 900}, '16:9', B);
  assert.ok(r.x + r.w <= 1440 && r.y + r.h <= 900);
  assert.ok(Math.abs(r.w / r.h - 16 / 9) < 0.05);
});

test('移动不出屏幕，方向键微移 1 / Shift 10', () => {
  const r = {x: 100, y: 100, w: 300, h: 200};
  assert.deepEqual(A.moveRect(r, -500, 0, B), {x: 0, y: 100, w: 300, h: 200});
  assert.deepEqual(A.moveRect(r, 5000, 5000, B), {x: 1140, y: 700, w: 300, h: 200});
  assert.deepEqual(A.nudge(r, 'ArrowRight', false, B), {x: 101, y: 100, w: 300, h: 200});
  assert.deepEqual(A.nudge(r, 'ArrowUp', true, B), {x: 100, y: 90, w: 300, h: 200});
  assert.equal(A.nudge(r, 'Enter', false, B), r);
});

test('拖把手：对边固定；比例时角把手按宽定高、边把手以中线为轴', () => {
  const r = {x: 100, y: 100, w: 400, h: 300};
  assert.deepEqual(A.resizeRect(r, 'se', 100, 50, 'free', B), {x: 100, y: 100, w: 500, h: 350});
  assert.deepEqual(A.resizeRect(r, 'nw', -50, -50, 'free', B), {x: 50, y: 50, w: 450, h: 350});
  assert.deepEqual(A.resizeRect(r, 'w', -200, 0, 'free', B), {x: 0, y: 100, w: 500, h: 300});
  assert.deepEqual(A.resizeRect(r, 'e', -1000, 0, 'free', B).w, 1, '不会翻过对边');
  assert.deepEqual(A.resizeRect(r, 'se', 0, 0, '1:1', B), {x: 100, y: 100, w: 400, h: 400});
  assert.deepEqual(A.resizeRect(r, 'e', 0, 0, '4:3', B), {x: 100, y: 100, w: 400, h: 300});
  assert.deepEqual(A.resizeRect(r, 's', 0, 100, '1:1', B), {x: 100, y: 100, w: 400, h: 400}, '改高时宽跟着、以竖中线为轴');
  const big = A.resizeRect(r, 'se', 2000, 2000, '16:9', B);
  assert.ok(big.x + big.w <= 1440 && big.y + big.h <= 900);
});

test('换比例保持中心；最小 150、边把手不足 80 不显示；铺满与贴合窗口', () => {
  const r = A.applyRatio({x: 100, y: 100, w: 400, h: 400}, '16:9', B);
  assert.deepEqual(r, {x: 100, y: 188, w: 400, h: 225});
  assert.equal(A.applyRatio(null, '16:9', B), null);
  assert.equal(A.tooSmall({x: 0, y: 0, w: 149, h: 400}), true);
  assert.equal(A.tooSmall({x: 0, y: 0, w: 150, h: 150}), false);
  assert.deepEqual(A.edgeHandles({w: 79, h: 200}), {n: false, s: false, e: true, w: true});
  assert.deepEqual(A.fillScreen(B), B);
  assert.deepEqual(A.fitWindow({x: -20, y: 600, w: 400, h: 600}, B), {x: 0, y: 600, w: 380, h: 300});
  assert.equal(A.sizeText({w: 1280.4, h: 720}), '1280 × 720');
});

test('鼠标下最上面的窗口', () => {
  const ws = [{id: 'a', x: 0, y: 0, w: 500, h: 500}, {id: 'b', x: 300, y: 300, w: 500, h: 500}];
  assert.equal(A.windowAt(ws, {x: 400, y: 400}).id, 'b');
  assert.equal(A.windowAt(ws, {x: 100, y: 100}).id, 'a');
  assert.equal(A.windowAt(ws, {x: 1000, y: 100}), null);
});

test('录制卡：选区下方 16 → 放不下放上方 → 都放不下放选区内靠上', () => {
  const card = {w: 416, h: 120};
  assert.deepEqual(A.cardPlacement({x: 200, y: 100, w: 400, h: 300}, B, card), {x: 192, y: 416, where: 'below'});
  assert.deepEqual(A.cardPlacement({x: 200, y: 500, w: 400, h: 350}, B, card), {x: 192, y: 364, where: 'above'});
  assert.deepEqual(A.cardPlacement({x: 0, y: 0, w: 1440, h: 900}, B, card), {x: 512, y: 16, where: 'inside'});
  assert.equal(A.cardPlacement({x: 0, y: 100, w: 100, h: 100}, B, card).x, 8, '不出屏幕');
});

test('控制条位置：屏幕底部向上 120，窗口下边缘向上 48', () => {
  assert.deepEqual(A.barPlacement('display', null, B), {x: 560, y: 716});
  assert.deepEqual(A.barPlacement('window', {x: 100, y: 100, w: 600, h: 400}, B), {x: 240, y: 388});
  assert.deepEqual(A.barPlacement('window', {x: 100, y: 100, w: 600, h: 400}, B, A.BAR.hAlert).y, 302);
  assert.equal(A.barPlacement('window', {x: 1300, y: 0, w: 140, h: 40}, B).y, 0, '截在屏幕里');
});

test('摄像头浮窗：形状循环、大小 230 ↔ 400、拖角 150–600、右下距两边 100', () => {
  assert.deepEqual(A.SHAPES.map(A.nextShape), ['square', 'wide', 'round']);
  assert.deepEqual(A.cameraBox(230, 'round'), {w: 230, h: 230});
  assert.deepEqual(A.cameraBox(400, 'wide'), {w: 400, h: 225});
  assert.equal(A.toggleCameraSize(230), 400);
  assert.equal(A.toggleCameraSize(400), 230);
  assert.equal(A.toggleCameraSize(321), 230);
  assert.equal(A.resizeCamera(230, 'se', 40, 10), 270);
  assert.equal(A.resizeCamera(230, 'nw', 40, 10), 190);
  assert.equal(A.resizeCamera(230, 'se', 9999, 0), 600);
  assert.equal(A.resizeCamera(230, 'se', -9999, 0), 150);
  assert.deepEqual(A.cameraPlacement(null, {w: 230, h: 230}, B), {x: 1110, y: 570});
  assert.deepEqual(A.cameraPlacement({x: 5000, y: -9}, {w: 230, h: 230}, B), {x: 1210, y: 0});
});
