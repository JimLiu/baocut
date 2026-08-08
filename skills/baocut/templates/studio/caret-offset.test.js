const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./caret-offset.js');

// vkCaretOffset 的原始算法，作为正向映射的对照实现（改动本模块不得改变它的语义）。
function legacy(raw, rawOff) {
  const text = raw.replace(/\s+/g, ' ').trim();
  const lead = (raw.match(/^\s*/) || [''])[0].length;
  const prefix = raw.slice(0, rawOff).slice(Math.min(lead, rawOff)).replace(/\s+/g, ' ');
  return Math.min(text.length, prefix.length);
}

const SAMPLES = [
  'hello world',
  '  hello   world  ',
  '你好，欢迎收看本期节目。',
  ' 你好 world 混排 ',
  'a👍b🎬c',
  '👍',
  'emoji 👍 在空白之间 🎬 结尾',
  '',
  '   ',
  '\n  多行\n  文本  \n',
  'trailing space ',
  ' leading space',
];

const midPair = (s, i) => i > 0 && i < s.length
  && s.charCodeAt(i - 1) >= 0xd800 && s.charCodeAt(i - 1) <= 0xdbff
  && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff;

test('正向映射与 vkCaretOffset 的原始算法逐位一致', () => {
  for (const raw of SAMPLES) {
    for (let i = 0; i <= raw.length; i += 1) {
      const got = C.toNormalized(raw, i);
      assert.equal(got.text, raw.replace(/\s+/g, ' ').trim(), raw);
      assert.equal(got.offset, legacy(raw, i), `${JSON.stringify(raw)} @${i}`);
    }
  }
});

test('逆映射与正向映射互为逆运算（每个合法归一化偏移都能原样还原）', () => {
  for (const raw of SAMPLES) {
    const text = C.normalize(raw);
    for (let o = 0; o <= text.length; o += 1) {
      if (midPair(text, o)) continue; // 代理对中间不是合法光标位
      const rawOff = C.toRaw(raw, o);
      assert.ok(rawOff >= 0 && rawOff <= raw.length, `${JSON.stringify(raw)} @${o}`);
      assert.equal(C.toNormalized(raw, rawOff).offset, o, `${JSON.stringify(raw)} @${o}`);
    }
  }
});

test('逆映射不会停在代理对中间', () => {
  const raw = 'a👍b🎬c';
  for (let o = 0; o <= C.normalize(raw).length; o += 1) {
    assert.equal(midPair(raw, C.toRaw(raw, o)), false, `offset ${o}`);
  }
});

test('行首偏移跳过前导空白，行尾偏移停在末位非空白字符之后', () => {
  const raw = '  hello  world  ';
  assert.equal(C.toRaw(raw, 0), 2);
  assert.equal(C.toRaw(raw, C.normalize(raw).length), raw.indexOf('d') + 1);
});

test('越界偏移被夹紧到合法区间', () => {
  const raw = ' 你好 ';
  assert.equal(C.toRaw(raw, -5), 1);
  assert.equal(C.toRaw(raw, 999), 3);
  assert.equal(C.toNormalized(raw, 999).offset, 2);
  assert.equal(C.toNormalized(raw, -5).offset, 0);
});

test('纯空白文本的任何偏移都落在空文本的 0 位', () => {
  assert.equal(C.normalize('   \n '), '');
  assert.equal(C.toNormalized('   \n ', 3).offset, 0);
  assert.equal(C.toRaw('   \n ', 0), 5);
});

test('CJK 与拉丁混排按 UTF-16 code unit 计数', () => {
  const raw = '你好 world';
  assert.equal(C.normalize(raw).length, 8);
  assert.equal(C.toRaw(raw, 2), 2);
  assert.equal(C.toRaw(raw, 3), 3);
  assert.equal(C.toNormalized(raw, raw.length).offset, 8);
});
