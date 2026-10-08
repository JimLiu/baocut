const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-tool-handover.js');
const H = window.BC_HANDOVER;

test('按结果种类预填一句草稿，引用只带元数据', () => {
  const d = H.draft({id: 'tool-subtitle-1', kind: 'subtitle', name: 'talk.srt', file: '~/Downloads/talk.srt'});
  assert.equal(d.text, H.DEFAULTS.subtitle);
  assert.deepEqual(d.reference, {id: 'tool-subtitle-1', kind: 'subtitle', name: 'talk.srt', dir: null, file: '~/Downloads/talk.srt'});
});

test('给了意图用意图；没有条目返回 null；没见过的种类有兜底句', () => {
  assert.equal(H.draft({id: 'x', kind: 'doc'}, ' 翻译成日文 ').text, '翻译成日文');
  assert.equal(H.draft(null), null);
  assert.equal(H.draft({id: 'x', kind: 'weird'}).text, '接着处理这个结果。');
});
