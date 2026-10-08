const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-score.js');
const SC = global.window.BC_SCORE;

test('轨 id → 总线：持久化 id 与展示泳道 id 都认，别的轨给 null', () => {
  assert.equal(SC.busOf('score:amb'), 'amb');
  assert.equal(SC.busOf('tr-au.score:music'), 'music');
  assert.equal(SC.busOf('music'), null);
  assert.equal(SC.busOf('tr-el.score:amb'), null);
  assert.equal(SC.busOf('score:'), null);
});

test('名字：三路给中文，自定义总线原样', () => {
  assert.equal(SC.laneName('amb'), '配乐 · 环境声');
  assert.equal(SC.badge('sfx'), '音效');
  assert.equal(SC.laneName('choir'), '配乐 · choir');
  assert.equal(SC.badge('choir'), 'CHOI');
});

test('过期说明：列出改过的输入；不过期为 null', () => {
  assert.equal(SC.staleTip({bus: 'amb', stale: false}), null);
  assert.equal(SC.staleTip({bus: 'amb', stale: true, staleInputs: ['events.json', 'score.json']}),
    '已过期：events.json、score.json 在这一路生成后改过');
  assert.equal(SC.staleTip({bus: 'amb', stale: true}), '已过期，需要重新生成这一路');
  assert.equal(SC.headTip({bus: 'amb', stale: true, staleInputs: ['events.json']}),
    '配乐 · 环境声 · 已过期：events.json 在这一路生成后改过');
});

test('重新生成副题：忙 > 过期 > 已是最新', () => {
  const t = {bus: 'amb', stale: true, staleInputs: ['events.json']};
  assert.equal(SC.regenSub(t, true), SC.BUSY_SUB);
  assert.match(SC.regenSub(t, false), /events\.json/);
  assert.equal(SC.regenSub({bus: 'music'}, false), SC.FRESH_SUB);
});

test('重新生成完：一路只清那一路，null 清全部', () => {
  const ts = [{bus: 'music', stale: true, staleInputs: ['score.json']}, {bus: 'amb', stale: true, staleInputs: ['events.json']}];
  const one = SC.markFresh(ts, 'amb');
  assert.equal(SC.staleCount(one), 1);
  assert.equal(one[1].stale, false);
  assert.equal(SC.staleCount(SC.markFresh(ts, null)), 0);
  assert.equal(SC.staleCount(ts), 2, '不改原表');
});
