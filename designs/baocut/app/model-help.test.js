const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-help.js');
const H = window.BC_HELP;

test('原型指南与当前 App / Web 共享中文目录一致', async () => {
  const {helpGuides} = await import('../build/help-content.mjs');
  assert.deepEqual(H.guides, JSON.parse(JSON.stringify(helpGuides(require('node:path').resolve(__dirname, '../../..')))));
  assert.match(H.guides.find(g => g.id === 'import').steps[0][1], /Space/);
});

test('帮助可按中英文关键词和正文中的症状检索', () => {
  assert.ok(H.search('  BiLiNgUaL  ').some(g => g.id === 'translate'));
  assert.ok(H.search('画面外').some(g => g.id === 'missing'));
  assert.deepEqual(H.search('字幕 不显示').map(g => g.id), ['missing']);
});
test('空查询保留目录；不匹配的查询不返回无关教程', () => {
  assert.deepEqual(H.search(' \n '), H.guides);
  assert.deepEqual(H.search('不存在的帮助主题'), []);
});

test('缺省短名不会成为搜索正文', () => { assert.deepEqual(H.search('null'), []); });
