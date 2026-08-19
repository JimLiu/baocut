const test = require('node:test');
const assert = require('node:assert');
const OPS = require('./element-ops.js');

test('addTextElement：播放头处 10 秒窗口、居中偏上、带缺省样式', () => {
  const op = OPS.addTextElement({ time: 12.37, duration: 175 });
  assert.strictEqual(op.kind, 'addElement');
  assert.strictEqual(op.element.kind, 'text');
  assert.strictEqual(op.element.start, 12.3);
  assert.strictEqual(op.element.end, 22.3);
  assert.deepStrictEqual(op.element.place, { x: 50, y: 40 });
  assert.strictEqual(op.element.text, OPS.TEXT_PLACEHOLDER);
  assert.strictEqual(op.element.style.fontSize, OPS.TEXT_STYLE.fontSize);
  // style 是深拷贝：两次新建互不影响那份冻结的模板。
  op.element.style.fontSize = 9;
  assert.strictEqual(OPS.TEXT_STYLE.fontSize, 41);
  // 元素不带任何媒体字段（schema 对 text 元素禁止 srcId/mode/fit/bg）。
  ['srcId', 'mode', 'fit', 'bg', 'srcStart'].forEach((key) => {
    assert.ok(!(key in op.element), key + ' 不该出现在 text 元素上');
  });
});

test('元素窗口不越过片尾，也不塌成 end <= start', () => {
  // 播放头贴着片尾：窗口整体前移，仍留出 0.2 秒。
  const late = OPS.addTextElement({ time: 175, duration: 175 });
  assert.ok(late.element.start < late.element.end);
  assert.strictEqual(late.element.end, 175);
  const image = OPS.addImageElement({ time: 60, duration: 61, path: 'media/a.png' })[1];
  assert.strictEqual(image.element.start, 60);
  assert.strictEqual(image.element.end, 61);
  // 极短项目也不会造出非法窗口。
  const tiny = OPS.addTextElement({ time: 0, duration: 0 });
  assert.ok(tiny.element.end > tiny.element.start);
});

test('addImageElement：putSource + addElement 同事务，pip 右上缺省', () => {
  const ops = OPS.addImageElement({
    time: 3.04, duration: 68.7, path: 'media/logo.png',
    naturalWidth: 800.4, naturalHeight: 600.6, sourceId: 'src-fixed',
  });
  assert.deepStrictEqual(ops[0], {
    kind: 'putSource',
    sourceId: 'src-fixed',
    source: { path: 'media/logo.png', kind: 'image', duration: 0, naturalW: 800, naturalH: 601 },
  });
  assert.strictEqual(ops[1].element.srcId, 'src-fixed');
  assert.strictEqual(ops[1].element.kind, 'image');
  assert.strictEqual(ops[1].element.mode, 'pip');
  assert.strictEqual(ops[1].element.fit, 'cover');
  assert.deepStrictEqual(ops[1].element.place, { x: 71, y: 29, w: 34, radius: 28 });
  assert.strictEqual(ops[1].element.start, 3);
  assert.strictEqual(ops[1].element.end, 7);
  // 自然尺寸探测失败时不写这两个键（schema 不接受 null）。
  const unknown = OPS.addImageElement({ time: 0, duration: 10, path: 'media/x.png' })[0];
  assert.ok(!('naturalW' in unknown.source));
  assert.ok(!('naturalH' in unknown.source));
  // 未给 sourceId 时自动分配且互不相同。
  const a = OPS.addImageElement({ time: 0, duration: 10, path: 'media/x.png' })[0].sourceId;
  const b = OPS.addImageElement({ time: 0, duration: 10, path: 'media/x.png' })[0].sourceId;
  assert.notStrictEqual(a, b);
  assert.ok(a.startsWith('src-'));
});

test('addWatermark：带 role 的 text 元素、全片、右上角、透明度 0.6', () => {
  const op = OPS.addWatermark();
  assert.strictEqual(op.element.role, 'watermark');
  assert.strictEqual(op.element.kind, 'text');
  assert.strictEqual(op.element.text, OPS.WATERMARK_TEXT);
  assert.deepStrictEqual(op.element.place, { x: 85, y: 10, w: 22, opacity: 0.6 });
  // 全片 = 不写 start/end（投影会填 0…片尾）。
  assert.ok(!('start' in op.element));
  assert.ok(!('end' in op.element));
  assert.strictEqual(OPS.addWatermark({ text: '@baoyu' }).element.text, '@baoyu');
});

test('movePlace：只写新 x/y，且不带数值 base', () => {
  const element = { id: 'el-3', place: { x: 85, y: 10, w: 22, opacity: 0.6 } };
  // 不带 base 是刻意的：serde_json 的 Number 按表示比较，JS 的 50 与磁盘上的 50.0
  // 永远不相等，带上就等于把每一次拖动都写成 skipped（而那是 200 应答，静默丢写）。
  assert.deepStrictEqual(OPS.movePlace(element, { x: 40.5, y: 62 }), {
    kind: 'patchElement',
    elId: 'el-3',
    set: { place: { x: 40.5, y: 62 } },
  });
  assert.ok(!('base' in OPS.movePlace(element, { x: 1, y: 2 })));
  // basePlace 仍只取所见的 x/y 两维（面板读坐标用），缺席不凭空补 50。
  assert.deepStrictEqual(OPS.basePlace(element), { x: 85, y: 10 });
  assert.deepStrictEqual(OPS.basePlace({ id: 'el-9' }), {});
});

test('setText / removeElement / elementLabel', () => {
  assert.deepStrictEqual(OPS.setText({ id: 'el-1', text: '旧' }, '新'), {
    kind: 'patchElement', elId: 'el-1', base: { text: '旧' }, set: { text: '新' },
  });
  assert.deepStrictEqual(OPS.setText({ id: 'el-1' }, '新').base, { text: '' });
  assert.deepStrictEqual(OPS.removeElement({ id: 'el-2' }), { kind: 'removeElement', elId: 'el-2' });
  assert.deepStrictEqual(OPS.removeElement('el-7'), { kind: 'removeElement', elId: 'el-7' });
  assert.strictEqual(OPS.elementLabel({ kind: 'text', role: 'watermark' }), '水印');
  assert.strictEqual(OPS.elementLabel({ kind: 'image' }), '图片');
  assert.strictEqual(OPS.elementLabel({ kind: 'text' }), '文本');
  assert.strictEqual(OPS.elementLabel(null), '元素');
});

test('addImageElement role=watermark：全片、右上角小 logo、走 wm 轨', () => {
  const ops = OPS.addImageElement({ time: 3, duration: 10, path: 'media/logo.png', role: 'watermark' });
  const element = ops[1].element;
  assert.strictEqual(element.role, 'watermark');
  assert.strictEqual(element.kind, 'image');
  assert.deepStrictEqual(element.place, { ...OPS.WATERMARK_IMAGE_PLACE });
  // 全片 = 不写 start/end（与文本水印同一条规则）。
  assert.ok(!('start' in element));
  assert.ok(!('end' in element));
});

test('replaceImageSource：新 source + 只改 srcId（不覆盖旧 source）', () => {
  const ops = OPS.replaceImageSource({ id: 'el-4', srcId: 'src-old' }, {
    sourceId: 'src-new', path: 'media/new.png', naturalWidth: 100, naturalHeight: 50,
  });
  assert.deepStrictEqual(ops[0], {
    kind: 'putSource',
    sourceId: 'src-new',
    source: { path: 'media/new.png', kind: 'image', duration: 0, naturalW: 100, naturalH: 50 },
  });
  assert.deepStrictEqual(ops[1], { kind: 'patchElement', elId: 'el-4', set: { srcId: 'src-new' } });
});
