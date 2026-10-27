const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-image-edit.js');
const E = global.window.BC_IMAGE_EDIT;

const src = {name: 'beach.jpg', width: 1200, height: 800};

test('五个工具：放大、去除物体、去水印、重绘、扩图；选区与提示词的要求各不相同', () => {
  assert.deepEqual(E.OPS.map((o) => o.id), ['upscale', 'erase', 'watermark', 'repaint', 'expand']);
  assert.deepEqual(E.OPS.map((o) => o.select), [null, 'brush', 'box', 'brush', null]);
  assert.deepEqual(E.OPS.map((o) => o.prompt), ['none', 'none', 'none', 'required', 'optional']);
  // 去水印缺省快速填充（不用模型），去除物体缺省 AI 修补
  assert.equal(E.blank('watermark').method, 'fill');
  assert.equal(E.blank('erase').method, 'model');
});

test('放大：照片模型 2、3 倍要缩，动画模型都是原生；超过 16384 拒绝', () => {
  assert.deepEqual(E.SCALES.map((s) => E.needsResize('photo', s)), [true, true, false]);
  assert.deepEqual(E.SCALES.map((s) => E.needsResize('anime', s)), [false, false, false]);
  assert.deepEqual(E.upscaleSize(src, 4), {width: 4800, height: 3200, tooLarge: false});
  assert.equal(E.upscaleSize({width: 5000, height: 10}, 4).tooLarge, true);
  const f = Object.assign(E.blank('upscale'), {scale: 4});
  assert.match(E.problems(f, [{name: 'big.png', width: 5000, height: 10}], null, {esrgan: 'ready'})[0], /超过 16384/);
  assert.match(E.problems(f, [src], null, {esrgan: 'missing'})[0], /Real-ESRGAN/);
  assert.deepEqual(E.problems(f, [src], null, {esrgan: 'ready'}), []);
});

test('选区：笔画与框按格子算覆盖率与外框；AI 修补的工作区留上下文、至少 512、不出界', () => {
  assert.equal(E.selectionStats({strokes: []}, src), null);
  const box = E.selectionStats({boxes: [{x: 1000, y: 700, w: 160, h: 64}]}, src);
  assert.deepEqual(box.box, {x: 992, y: 688, w: 176, h: 80});
  assert.ok(box.coverage > 0 && box.coverage < 0.05);
  const stroke = E.selectionStats({strokes: [{r: 20, pts: [[100, 100], [300, 100]]}]}, src);
  assert.ok(stroke.box.x <= 80 && stroke.box.x + stroke.box.w >= 320, '笔画两端连起来');
  const roi = E.workArea(box.box, src);
  assert.deepEqual([roi.w, roi.h], [512, 512]);
  assert.ok(roi.x + roi.w <= src.width && roi.y + roi.h <= src.height && roi.x >= 0 && roi.y >= 0);
  assert.equal(E.workArea({x: 0, y: 0, w: 1100, h: 700}, src).full, true);
});

test('去除与重绘：没涂不能开始，涂得太多换生成图片；重绘要写改成什么', () => {
  const ctx = {engineReady: true};
  assert.match(E.problems(E.blank('erase'), [src], {strokes: []}, ctx)[0], /涂出要去掉/);
  assert.match(E.problems(E.blank('watermark'), [src], {boxes: []}, ctx)[0], /框出水印/);
  const all = {boxes: [{x: 0, y: 0, w: 1200, h: 800}]};
  assert.match(E.problems(E.blank('erase'), [src], all, ctx)[0], /六成/);
  const some = {strokes: [{r: 30, pts: [[200, 200]]}]};
  assert.deepEqual(E.problems(E.blank('erase'), [src], some, ctx), []);
  assert.match(E.problems(E.blank('repaint'), [src], some, ctx)[0], /改成什么/);
  assert.deepEqual(E.problems(Object.assign(E.blank('repaint'), {prompt: '换成一只橘猫'}), [src], some, ctx), []);
  assert.match(E.problems(E.blank('erase'), [src], some, {engineReady: false})[0], /图像模型/);
  // 快速填充不用模型
  assert.deepEqual(E.problems(E.blank('watermark'), [src], {boxes: [{x: 10, y: 10, w: 100, h: 30}]}, {engineReady: false}), []);
});

test('扩图：按比例只往一个方向加、按锚点放原图；按边扩按百分比；比例相同、过大、扩太多各有说法', () => {
  const center = E.expandPlan(src, {ratio: '16:9', anchor: 'center'});
  assert.deepEqual([center.width, center.height, center.x, center.y], [1422, 800, 111, 0]);
  assert.deepEqual(center.added, {left: 111, top: 0, right: 111, bottom: 0});
  const left = E.expandPlan(src, {ratio: '16:9', anchor: 'left'});
  assert.deepEqual([left.x, left.added.right], [0, 222]);
  const tall = E.expandPlan(src, {ratio: '9:16', anchor: 'bottom'});
  assert.deepEqual([tall.width, tall.height, tall.y], [1200, 2133, 1333]);
  assert.equal(tall.staged, true, '竖向扩出超过原图一倍：提醒分两次');
  const free = E.expandPlan(src, {ratio: 'free', margins: {left: 10, right: 10, top: 25, bottom: 0}});
  assert.deepEqual([free.width, free.height, free.x, free.y], [1440, 1000, 120, 200]);
  const square = {name: 's.png', width: 800, height: 800};
  assert.match(E.problems(Object.assign(E.blank('expand'), {ratio: '1:1'}), [square], null, {engineReady: true})[0], /一样/);
  assert.match(E.problems(Object.assign(E.blank('expand'), {ratio: '16:9'}), [{name: 'w.png', width: 3000, height: 3000}], null, {engineReady: true})[0], /4096/);
});

test('输出名字：<源名>-<动作>.png，重名加序号，不覆盖', () => {
  assert.equal(E.outputName('upscale', 'beach.jpg', {scale: 2}), 'beach-upscaled-2x.png');
  assert.equal(E.outputName('watermark', 'a.png', {}, ['a-no-watermark.png', 'a-no-watermark-2.png']), 'a-no-watermark-3.png');
  assert.equal(E.outputName('expand', 'a.webp', {}), 'a-expanded.png');
  const s = E.statusLine(Object.assign(E.blank('upscale'), {scale: 2}), [src], null, {esrgan: 'ready'}, false);
  assert.deepEqual(s, {bad: false, text: '2400×1600 · beach-upscaled-2x.png'});
  assert.deepEqual(E.statusLine(E.blank('erase'), [], null, {}, false), {bad: false, text: '先选一张图片'});
});
