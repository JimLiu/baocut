const test = require('node:test');
const assert = require('node:assert/strict');
const RT = require('./style-route.js');

const PROJECT = '/projects/p130-what-is-an-agentic-harness.bcut/';

test('末段还原 tab：translation 与 translate 都落到内部名 translate', () => {
  assert.deepEqual(RT.routeFromPath(PROJECT + 'translation'), { tab: 'translate', styleOpen: false });
  assert.deepEqual(RT.routeFromPath(PROJECT + 'translate'), { tab: 'translate', styleOpen: false });
  assert.deepEqual(RT.routeFromPath(PROJECT + 'subtitle'), { tab: 'subtitle', styleOpen: false });
  assert.deepEqual(RT.routeFromPath(PROJECT + 'transcript'), { tab: 'transcript', styleOpen: false });
});

test('/style 不再是 tab：解释为 transcript + 打开样式层', () => {
  assert.deepEqual(RT.routeFromPath(PROJECT + 'style'), { tab: 'transcript', styleOpen: true });
});

test('认不出末段（项目根、未知路径、空值）时按 transcript 处理', () => {
  assert.deepEqual(RT.routeFromPath(PROJECT), { tab: 'transcript', styleOpen: false });
  assert.deepEqual(RT.routeFromPath(PROJECT + 'unknown'), { tab: 'transcript', styleOpen: false });
  assert.deepEqual(RT.routeFromPath(''), { tab: 'transcript', styleOpen: false });
  assert.deepEqual(RT.routeFromPath(null), { tab: 'transcript', styleOpen: false });
});

test('pathFor 换末段而不叠加，且不带尾斜杠（相对 fetch 基准目录不变）', () => {
  assert.equal(RT.pathFor(PROJECT, 'translate', false), PROJECT + 'translation');
  assert.equal(RT.pathFor(PROJECT + 'style', 'translate', false), PROJECT + 'translation');
  assert.equal(RT.pathFor(PROJECT + 'subtitle', 'transcript', false), PROJECT + 'transcript');
  assert.equal(RT.pathFor(PROJECT + 'translation/', 'subtitle', false), PROJECT + 'subtitle');
});

test('pathFor 在样式层打开时末段恒为 style，与当前 tab 无关', () => {
  assert.equal(RT.pathFor(PROJECT, 'transcript', true), PROJECT + 'style');
  assert.equal(RT.pathFor(PROJECT + 'translation', 'translate', true), PROJECT + 'style');
  assert.equal(RT.pathFor(PROJECT + 'style', 'subtitle', true), PROJECT + 'style');
});

test('未知 tab 名回落 transcript，不产生野路径', () => {
  assert.equal(RT.pathFor(PROJECT, 'style', false), PROJECT + 'transcript');
  assert.equal(RT.pathFor(PROJECT, undefined, false), PROJECT + 'transcript');
});

test('routeFromPath ∘ pathFor 往返稳定', () => {
  [['transcript', false], ['subtitle', false], ['translate', false], ['transcript', true]]
    .forEach(([tab, styleOpen]) => {
      const path = RT.pathFor(PROJECT, tab, styleOpen);
      assert.deepEqual(RT.routeFromPath(path), { tab, styleOpen });
    });
});
