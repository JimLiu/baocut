const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-agent-plan.js');
const P = global.window.BC_AGENT_PLAN;

const MODES = [{k: 'ask', label: '监督'}, {k: 'autoAcceptEdits', label: '自动接受修改'}];

test('summary：第一行非空文字，去掉标题的 #，过长截断', () => {
  assert.equal(P.summary('\n## 片头加音乐\n\n1. 选曲'), '片头加音乐');
  assert.equal(P.summary(''), '');
  assert.equal(P.summary('长'.repeat(200)).length, 120);
});

test('stateLabel：批准的写实施时的访问模式，没写模式按默认；其余按状态', () => {
  assert.equal(P.stateLabel({state: 'approved', mode: 'ask'}, MODES), '已批准 · 按「监督」实施');
  assert.equal(P.stateLabel({state: 'approved'}, MODES), '已批准 · 按「自动接受修改」实施');
  assert.equal(P.stateLabel({state: 'declined'}, MODES), '未批准');
  assert.equal(P.stateLabel({state: 'byMessage'}, MODES), '已用消息回复');
  assert.equal(P.stateLabel({state: 'stopped'}, MODES), '已停止');
  assert.equal(P.stateLabel({state: 'pending'}, MODES), '');
});

test('pendingSummary：会话列表里那一行', () => {
  assert.equal(P.pendingSummary({plan: '# 片头加音乐'}), '等你批准 · 片头加音乐');
  assert.equal(P.pendingSummary({plan: ''}), '等你批准 · 方案');
});
