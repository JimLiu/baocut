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
  // 没有能改图的模型时，能快速填充的工具缺省快速填充；只能用模型的不变
  assert.equal(E.blank('erase', false).method, 'fill');
  assert.equal(E.blank('repaint', false).method, 'model');
  assert.deepEqual(E.OPS.filter((o) => o.batch).map((o) => o.id), ['upscale', 'watermark']);
});

test('放大：照片模型 2、3 倍要缩，动画（快）都是原生，waifu2x 的 3 倍先放大 4 倍；插值与 AI 重画不缩；超过 16384 拒绝', () => {
  assert.deepEqual(E.SCALES.map((s) => E.needsResize('photo', s)), [true, true, false]);
  assert.deepEqual(E.SCALES.map((s) => E.needsResize('anime', s)), [false, false, false]);
  assert.deepEqual(E.SCALES.map((s) => E.needsResize('waifu2x', s)), [false, true, false]);
  assert.deepEqual(E.SCALES.map((s) => E.peakScale('waifu2x', s)), [2, 4, 4]);
  assert.deepEqual(E.SCALES.map((s) => E.needsResize('lanczos', s) || E.needsResize('generative', s)), [false, false, false]);
  assert.deepEqual(E.upscaleSize(src, 4), {width: 4800, height: 3200, tooLarge: false});
  assert.equal(E.upscaleSize({width: 5000, height: 10}, 4).tooLarge, true);
  // 照片模型 2 倍要先出 4 倍的中间图：中间图超过 16384 也拒绝；动画模型原生 2 倍不受影响
  assert.equal(E.upscaleSize({width: 5000, height: 10}, 2, 'photo').tooLarge, true);
  assert.equal(E.upscaleSize({width: 5000, height: 10}, 2, 'anime').tooLarge, false);
  const ready = {tools: {'realesrgan-ncnn-vulkan': 'ready', 'waifu2x-ncnn-vulkan': 'ready', 'upscayl-models': 'ready'}};
  const f = Object.assign(E.blank('upscale'), {scale: 4});
  assert.match(E.problems(f, [{name: 'big.png', width: 5000, height: 10}], null, ready)[0], /超过 16384/);
  assert.match(E.problems(Object.assign({}, f, {scale: 3, model: 'waifu2x'}), [{name: 'big.png', width: 4500, height: 10}], null, ready)[0], /先放大 4 倍/);
  assert.match(E.problems(f, [src], null, {tools: {}})[0], /Real-ESRGAN/);
  assert.deepEqual(E.problems(f, [src], null, ready), []);
});

test('放大：每个模型要下载的工具一次一个，Upscayl 的先要 Real-ESRGAN 再要权重包；Lanczos 与 AI 重画不用下载', () => {
  assert.deepEqual(E.upscaleTools('photo'), ['realesrgan-ncnn-vulkan']);
  assert.deepEqual(E.upscaleTools('remacri'), ['realesrgan-ncnn-vulkan', 'upscayl-models']);
  assert.deepEqual(E.upscaleTools('waifu2x-photo'), ['waifu2x-ncnn-vulkan']);
  assert.deepEqual(E.upscaleTools('lanczos'), []);
  assert.deepEqual(E.upscaleTools('generative'), []);
  const f = Object.assign(E.blank('upscale'), {model: 'remacri'});
  assert.match(E.problems(f, [src], null, {tools: {'realesrgan-ncnn-vulkan': 'ready'}})[0], /Upscayl 权重/);
  // 分组里每个模型都在，每个模型都有组
  assert.deepEqual(E.UPSCALE_MODELS.filter((m) => !E.UPSCALE_GROUPS.some((g) => g.k === m.group)), []);
  assert.equal(E.UPSCALE_MODELS.length, 13);
});

test('放大：许可提醒只给不能商用与作者没写的权重', () => {
  assert.equal(E.licenseNote('photo'), null);
  assert.equal(E.licenseNote('high-fidelity'), null);
  assert.match(E.licenseNote('remacri'), /不能商用/);
  assert.match(E.licenseNote('ultramix-balanced'), /没写许可/);
  assert.equal(E.licenseNote('lanczos'), null);
  assert.deepEqual(['ultrasharp', 'upscayl-lite', 'waifu2x'].map(E.licenseTag), ['不可商用', '许可未注明', null]);
});

test('放大的提交参数只带这个模型收的：换了模型，旧的去噪、模型与补充说明不带', () => {
  const srcs = [{path: '/p/a.png', name: 'a.png', width: 10, height: 10}];
  const engine = {provider: 'google', model: 'gemini-3-pro-image'};
  // waifu2x 设了去噪 2、又写过补充说明，换到 remacri：都不带
  const waifu = Object.assign(E.blank('upscale'), {model: 'waifu2x-anime', denoise: 2, prompt: '保留文字'});
  assert.deepEqual(E.upscaleRequest(waifu, srcs, engine), {inputs: ['/p/a.png'], scale: 4, model: 'waifu2x-anime', denoise: 2});
  assert.deepEqual(E.upscaleRequest(Object.assign({}, waifu, {model: 'remacri'}), srcs, engine), {inputs: ['/p/a.png'], scale: 4, model: 'remacri'});
  assert.deepEqual(E.upscaleRequest(Object.assign({}, waifu, {model: 'generative'}), srcs, engine),
    {inputs: ['/p/a.png'], scale: 4, model: 'generative', provider: 'google', imageModel: 'gemini-3-pro-image', prompt: '保留文字'});
  // AI 重画：要有能用的模型，补充说明不超过 1000 字
  const gen = Object.assign(E.blank('upscale'), {model: 'generative'});
  assert.match(E.problems(gen, srcs, null, {tools: {}, modelReason: '还没有收参考图的图像模型'})[0], /参考图/);
  assert.match(E.problems(Object.assign({}, gen, {prompt: 'x'.repeat(1001)}), srcs, null, {tools: {}})[0], /1000/);
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
  const ctx = {modelReason: null};
  assert.match(E.problems(E.blank('erase'), [src], {strokes: []}, ctx)[0], /涂出要去掉/);
  assert.match(E.problems(E.blank('watermark'), [src], {boxes: []}, ctx)[0], /框出水印/);
  const all = {boxes: [{x: 0, y: 0, w: 1200, h: 800}]};
  assert.match(E.problems(E.blank('erase'), [src], all, ctx)[0], /六成/);
  const some = {strokes: [{r: 30, pts: [[200, 200]]}]};
  assert.deepEqual(E.problems(E.blank('erase'), [src], some, ctx), []);
  assert.match(E.problems(E.blank('repaint'), [src], some, ctx)[0], /改成什么/);
  assert.deepEqual(E.problems(Object.assign(E.blank('repaint'), {prompt: '换成一只橘猫'}), [src], some, ctx), []);
  assert.match(E.problems(E.blank('erase'), [src], some, {modelReason: '还没有可用的能改图的图像模型，先去设置'})[0], /图像模型/);
  // 快速填充不用模型
  assert.deepEqual(E.problems(E.blank('watermark'), [src], {boxes: [{x: 10, y: 10, w: 100, h: 30}]}, {modelReason: '还没有可用的能改图的图像模型，先去设置'}), []);
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
  assert.match(E.problems(Object.assign(E.blank('expand'), {ratio: '1:1'}), [square], null, {modelReason: null})[0], /一样/);
  assert.match(E.problems(Object.assign(E.blank('expand'), {ratio: '16:9'}), [{name: 'w.png', width: 3000, height: 3000}], null, {modelReason: null})[0], /4096/);
});

test('输出名字：<源名>-<动作>.png，重名加序号，不覆盖', () => {
  assert.equal(E.outputName('upscale', 'beach.jpg', {scale: 2}), 'beach-upscaled-2x.png');
  assert.equal(E.outputName('watermark', 'a.png', {}, ['a-no-watermark.png', 'a-no-watermark-2.png']), 'a-no-watermark-3.png');
  assert.equal(E.outputName('expand', 'a.webp', {}), 'a-expanded.png');
  const s = E.statusLine(Object.assign(E.blank('upscale'), {scale: 2}), [src], null, {tools: {'realesrgan-ncnn-vulkan': 'ready'}}, false);
  assert.deepEqual(s, {bad: false, text: '2400×1600 · beach-upscaled-2x.png'});
  assert.deepEqual(E.statusLine(E.blank('erase'), [], null, {}, false), {bad: false, text: '先选一张图片'});
});

test('批量去水印：框按第一张记，换算到别的尺寸；比例不同要提示；常见位置的框都在画面里', () => {
  const sel = {boxes: [{x: 900, y: 700, w: 200, h: 60}]};
  assert.equal(E.scaleSelection(sel, src, src), sel);
  assert.deepEqual(E.scaleSelection(sel, src, {width: 600, height: 400}).boxes, [{x: 450, y: 350, w: 100, h: 30}]);
  assert.equal(E.ratioDiffers(src, {width: 600, height: 400}), false);
  assert.equal(E.ratioDiffers(src, {width: 1080, height: 1920}), true);
  E.BOX_PRESETS.forEach((p) => {
    const b = p.box(src.width, src.height);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= src.width && b.y + b.h <= src.height, p.label);
  });
  assert.equal(Object.keys(E.ANCHOR_LABEL).length, E.ANCHORS.length);
});

test('隐私：扩图总是整张；小选区只送一块，选区大到工作区盖满整张时整张', () => {
  assert.equal(E.sendsWhole('expand', null, src), true);
  assert.equal(E.sendsWhole('erase', {strokes: [{r: 20, pts: [[600, 400]]}]}, src), false);
  assert.equal(E.sendsWhole('erase', {boxes: [{x: 0, y: 0, w: 1100, h: 700}]}, src), true);
  assert.equal(E.sendsWhole('erase', {strokes: [{r: 20, pts: [[100, 100]]}]}, {width: 400, height: 300}), true, '小图：至少 512 的工作区就是整张');
});
