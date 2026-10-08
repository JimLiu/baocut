const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-time.js');
const T = global.window.BC_TIME;

test('timecode 一位小数、满一小时进位', () => {
  assert.equal(T.timecode(0), '00:00.0');
  assert.equal(T.timecode(12.4), '00:12.4');
  assert.equal(T.timecode(206), '03:26.0');
  assert.equal(T.timecode(3599.9), '59:59.9');
  assert.equal(T.timecode(3600), '1:00:00.0');
  assert.equal(T.timecode(3723.5), '1:02:03.5');
  assert.equal(T.timecode(-5.5), '-00:05.5');
  /* 第 88 轮：**先量化再拆位**。任何一段时长都是两个浮点秒相减，`22.4 − 12.4` 是
     9.999999999999998——旧写法的补零判据看未取整的值（不到 10，补个 0），位数却来自
     `toFixed(1)` 进位后的 "10.0"，于是属性页上一条 10 秒的元素写着 `00:010.0`。 */
  assert.equal(T.timecode(22.4 - 12.4), '00:10.0');
  assert.equal(T.timecode(9.999999), '00:10.0');
  assert.equal(T.timecode(59.99), '01:00.0', '秒进位要带着分一起走');
  assert.equal(T.timecode(3599.99), '1:00:00.0', '分进位要带着小时一起走');
});

test('timecode decimals:0 去掉小数位', () => {
  assert.equal(T.timecode(12.4, {decimals: 0}), '00:12');
  assert.equal(T.timecode(3723.5, {decimals: 0}), '1:02:04');
});

test('duration 是给元数据看的粗粒度', () => {
  assert.equal(T.duration(58), '58 秒');
  assert.equal(T.duration(206), '3 分 26 秒');
  assert.equal(T.duration(120), '2 分');
  assert.equal(T.duration(3600), '1 小时');
  assert.equal(T.duration(4820), '1 小时 20 分');
});

test('parse 收三种形态', () => {
  assert.equal(T.parse('90'), 90);
  assert.equal(T.parse('1:30'), 90);
  assert.equal(T.parse('01:30.5'), 90.5);
  assert.equal(T.parse('1:02:03.5'), 3723.5);
  assert.equal(T.parse('  12.4 '), 12.4);
  assert.equal(T.parse('-5'), -5);
});

test('parse 非法输入返回 null，不静默变 0', () => {
  assert.equal(T.parse(''), null);
  assert.equal(T.parse('abc'), null);
  assert.equal(T.parse('1:2:3:4'), null);
  assert.equal(T.parse('1:70'), null, '分秒段 ≥60 不合法');
  assert.equal(T.parse('1.5:30'), null, '只有最后一段能带小数');
  assert.equal(T.parse(':30'), null);
  assert.equal(T.parse(null), null);
});

test('parse ↔ timecode 往返', () => {
  for (const t of [0, 12.4, 206, 3723.5]) {
    assert.equal(T.parse(T.timecode(t)), t);
  }
});

test('clamp 钳到区间并对齐一位小数', () => {
  assert.equal(T.clamp(-3, 206), 0);
  assert.equal(T.clamp(999, 206), 206);
  assert.equal(T.clamp(12.44, 206), 12.4);
  assert.equal(T.clamp(12.46, 206), 12.5);
});
