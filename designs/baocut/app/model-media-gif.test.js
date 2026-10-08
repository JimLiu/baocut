const test = require('node:test'),
  assert = require('node:assert/strict');
global.window = {};
require('./model-media-gif.js');
const G = window.BC_MEDIA_GIF;
const frame = [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0];
const gif = () => Uint8Array.from([...Buffer.from('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, ...frame, ...frame, 0x3b]);
test('读取实际 GIF 结构，调整延迟不修改输入或压缩像素', () => {
  const source = gif(),
    before = Buffer.from(source),
    parsed = G.parse(source);
  assert.equal(parsed.frames.length, 2);
  assert.equal(parsed.frames[0].duration, 100);
  const changed = G.retime(source, 2);
  assert.equal(G.parse(changed).frames[0].duration, 50);
  assert.deepEqual(Buffer.from(source), before);
  assert.equal(G.parse(G.retime(source, 0.25)).frames[1].duration, 400);
});
test('没有延迟扩展的 GIF 也可变速；坏头、截断和过大图片明确失败', () => {
  const source = gif(),
    noDelay = Uint8Array.from([...source.slice(0, 19), ...frame.slice(8), 0x3b]);
  assert.equal(G.parse(G.retime(noDelay, 2)).frames[0].duration, 50);
  assert.throws(() => G.parse(source.slice(0, -1)), /不完整/);
  const invalid = source.slice();
  invalid[0] = 0;
  assert.throws(() => G.parse(invalid), /有效/);
  const huge = source.slice();
  huge[6] = 255;
  huge[7] = 255;
  huge[8] = 255;
  huge[9] = 255;
  assert.throws(() => G.parse(huge), /过大/);
  assert.throws(() => G.retime(source, 0), /无效/);
});
