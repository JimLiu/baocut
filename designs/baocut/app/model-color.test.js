/* model-color.js —— 取色面板的换算。§18 / 第 81 轮。
   这一层唯一的用途是「两枚圆钮站在哪、输入框里那串字是什么意思」，所以判据都是
   往返：hex → HSV → hex 必须逐字节回来，否则拖一下 SV 方块颜色就会自己漂。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-color.js');
const C = window.BC_COLOR;

test('原型完整色板保留固定内容色（应用已采用独立的紧凑色板）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '../../..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const colors = (source) => (source.match(/#[0-9a-f]{6}/gi) || []).map((c) => c.toLowerCase());
  const prototype = colors(read('designs/baocut/app/data.js').match(/swatches: \[([\s\S]*?)\]/)[1]);
  assert.strictEqual(prototype.length, 31, '原型调色板保留 31 个固定内容色');
  assert.strictEqual(new Set(prototype).size, 31);
  /* @ds-allow: 默认视频内容色的回归断言 */
  assert.deepStrictEqual(prototype.slice(0, 7), ['#000000', '#5d647b', '#9094a5', '#bfc1ce', '#dfe0e5', '#eeeef0', '#ffffff']);
  /* @ds-allow: 默认视频内容色的回归断言 */
  assert.deepStrictEqual([prototype[11], prototype[19], prototype[27]], ['#2d8eff', '#96c6ff', '#c0ddff']);
});

test('归一化吃三位 / 六位 / 八位 / 无井号 / 大写，别的都判 null', () => {
  assert.strictEqual(C.normHex('#2D8EFF'), '#2d8eff');
  assert.strictEqual(C.normHex('2d8eff'), '#2d8eff');
  assert.strictEqual(C.normHex('  #abc '), '#aabbcc');
  assert.strictEqual(C.normHex('#2d8eff80'), '#2d8eff', '八位截掉 alpha，alpha 由 alphaOf 取');
  ['', '#12', '#12345', 'gg1122', 'var(--blue-900)', null].forEach((bad) => {
    assert.strictEqual(C.normHex(bad), null, String(bad) + ' 不该被当成颜色');
  });
});

test('alpha 拆合：100 写六位，让没改过透明度的值逐字节不变', () => {
  assert.strictEqual(C.alphaOf('#2d8eff'), 100);
  assert.strictEqual(C.alphaOf('#2d8eff80'), 50);
  assert.strictEqual(C.alphaOf('#2d8eff00'), 0);
  assert.strictEqual(C.withAlpha('#2d8eff', 100), '#2d8eff');
  assert.strictEqual(C.withAlpha('#2d8eff', 50), '#2d8eff80');
  assert.strictEqual(C.withAlpha('#2d8eff', 0), '#2d8eff00');
  assert.strictEqual(C.withAlpha('#2d8eff', 140), '#2d8eff', '越界夹回 0–100');
  assert.strictEqual(C.withAlpha('nope', 50), null);
});

test('hex → HSV → hex 往返逐字节回来（拖一下不该让颜色自己漂）', () => {
  ['#2d8eff', '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
    '#7f7f7f', '#ffd646', '#70db74', '#a46cff'].forEach((hex) => {
    assert.strictEqual(C.fromHsv(C.toHsv(hex)), hex, hex + ' 往返漂了');
  });
});

test('灰阶的色相无定义时报 0，纯色的三档坐标对得上', () => {
  assert.deepStrictEqual(C.toHsv('#000000'), {h: 0, s: 0, v: 0});
  assert.deepStrictEqual(C.toHsv('#ffffff'), {h: 0, s: 0, v: 1});
  const red = C.toHsv('#ff0000');
  assert.strictEqual(red.h, 0);
  assert.strictEqual(red.s, 1);
  assert.strictEqual(red.v, 1);
  assert.strictEqual(Math.round(C.toHsv('#00ff00').h), 120);
  assert.strictEqual(Math.round(C.toHsv('#0000ff').h), 240);
});

test('色相绕圈与越界一律折回去，不出 NaN', () => {
  assert.strictEqual(C.fromHsv({h: 360, s: 1, v: 1}), '#ff0000');
  assert.strictEqual(C.fromHsv({h: -60, s: 1, v: 1}), '#ff00ff');
  assert.strictEqual(C.fromHsv({h: 0, s: 2, v: 2}), '#ff0000', 's/v 夹进 0–1');
});

test('三档读数', () => {
  assert.strictEqual(C.format('#2d8eff', 'Hex'), '#2d8eff');
  assert.strictEqual(C.format('#2d8eff', 'RGB'), '45, 142, 255');
  assert.strictEqual(C.format('#2d8eff', 'HSL'), '212, 100%, 59%');
  assert.strictEqual(C.format('nope', 'Hex'), '');
});

test('三档输入：两种写法都吃，越界与缺项判 null（调用方据此弹回）', () => {
  assert.strictEqual(C.parseAny('2d8eff', 'Hex'), '#2d8eff');
  assert.strictEqual(C.parseAny('45, 142, 255', 'RGB'), '#2d8eff');
  assert.strictEqual(C.parseAny('rgb(45 142 255)', 'RGB'), '#2d8eff');
  assert.strictEqual(C.parseAny('212, 100%, 59%', 'HSL'), '#2e8fff', '读数取过整，回来差一个色阶是正常的');
  assert.strictEqual(C.parseAny('45, 142', 'RGB'), null, '缺一项');
  assert.strictEqual(C.parseAny('45, 142, 300', 'RGB'), null, '越界');
  assert.strictEqual(C.parseAny('212, 140%, 59%', 'HSL'), null);
  assert.strictEqual(C.parseAny('', 'RGB'), null);
});

test('HSL 那档往返：读数再输回去，颜色差不超过一个色阶', () => {
  ['#2d8eff', '#ffd646', '#70db74'].forEach((hex) => {
    const back = C.parseAny(C.format(hex, 'HSL'), 'HSL');
    const a = C.toRgb(hex), b = C.toRgb(back);
    ['r', 'g', 'b'].forEach((k) => assert.ok(Math.abs(a[k] - b[k]) <= 3,
      hex + ' 的 ' + k + ' 差了 ' + Math.abs(a[k] - b[k])));
  });
});

test('SV 方块的背景色相跟着当前色走——此前它在 CSS 里写死成 220', () => {
  assert.ok(C.svBackground(0).includes('#ff0000'));
  assert.ok(C.svBackground(213).includes('#0073ff'));
});
