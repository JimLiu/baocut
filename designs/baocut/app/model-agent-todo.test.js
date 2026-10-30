const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-agent-todo.js');
const T = global.window.BC_AGENT_TODO;

const TODO = [
  {text: '转录第二段访谈', status: 'completed'},
  {text: '把文稿翻成英语', status: 'inProgress', activeForm: '正在把文稿翻成英语'},
  {text: '导出 1080p 预览', status: 'pending'},
];

test('visible：会话在跑、清单不空才显示', () => {
  assert.equal(T.visible({status: 'running', todo: TODO}), true);
  assert.equal(T.visible({status: 'done', todo: TODO}), false);
  assert.equal(T.visible({status: 'running', todo: []}), false);
  assert.equal(T.visible({status: 'running'}), false);
  assert.equal(T.visible(null), false);
});

test('current：进行中的说法优先，没有说法用原话，没有进行中的取下一条待做，全做完时空', () => {
  assert.equal(T.current(TODO), '正在把文稿翻成英语');
  assert.equal(T.current([{text: 'a', status: 'inProgress'}]), 'a');
  assert.equal(T.current([{text: 'a', status: 'completed'}, {text: 'b', status: 'pending'}]), 'b');
  assert.equal(T.current([{text: 'a', status: 'completed'}]), '');
});

test('line：已完成 / 总数 · 正在做的；全做完时只有数', () => {
  assert.equal(T.line(TODO), '1/3 · 正在把文稿翻成英语');
  assert.equal(T.line([{text: 'a', status: 'completed'}]), '1/1');
  assert.deepEqual(T.progress(TODO), {done: 1, total: 3});
});
