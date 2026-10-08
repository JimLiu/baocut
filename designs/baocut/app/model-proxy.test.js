/* BC_PROXY：BCF 预览代理舞台胶囊的判据（§11.2） */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-proxy.js');
const X = global.window.BC_PROXY;

const gen = (over) => Object.assign({status: 'generating', since: 0, done: 333, total: 900}, over);

test('百分比 = 已生成帧 / 总帧，向下取整，封顶 99', () => {
  assert.strictEqual(X.pct(333, 900), 37);
  assert.strictEqual(X.pct(0, 900), 0);
  assert.strictEqual(X.pct(899, 900), 99);
  assert.strictEqual(X.pct(900, 900), 99, '烧完之前不显示 100%');
  assert.strictEqual(X.pct(1, 3), 33);
});

test('总帧数未知或为 0 → 不给百分比', () => {
  assert.strictEqual(X.pct(10, 0), null);
  assert.strictEqual(X.pct(10, undefined), null);
  assert.strictEqual(X.visible(gen({total: 0}), 5000), false);
});

test('生成持续满 1 秒才露面', () => {
  const st = gen({since: 10000});
  assert.strictEqual(X.visible(st, 10999), false);
  assert.strictEqual(X.visible(st, 11000), true);
  assert.strictEqual(X.waitMs(st, 10400), 600);
  assert.strictEqual(X.waitMs(st, 11000), null, '已该露面就不再排计时器');
});

test('已就绪立刻消失；失败静默消失', () => {
  assert.strictEqual(X.chip(gen({status: 'ready'}), 99999, 'zh'), null);
  assert.strictEqual(X.chip(gen({status: 'failed'}), 99999, 'zh'), null);
  assert.strictEqual(X.waitMs(gen({status: 'ready'}), 0), null);
  assert.deepStrictEqual(X.column(gen({status: 'failed'}), null, 99999, 'zh'), [],
    '失败不换成报错提示');
});

test('排队中算在生成，按 0% 计', () => {
  const st = {status: 'queued', since: 0, done: 0, total: 900};
  assert.strictEqual(X.chip(st, 2000, 'zh').text, '正在优化播放 · 0%');
});

test('文案：中文 / 英文，分隔符与标题栏任务胶囊同一个中点', () => {
  assert.strictEqual(X.label(37, 'zh'), '正在优化播放 · 37%');
  assert.strictEqual(X.label(37, 'en'), 'Optimizing playback · 37%');
  assert.strictEqual(X.staleLabel('第 12 行：缺少 }', 'zh'), '显示的是上一版能用的画面 · 第 12 行：缺少 }');
  assert.strictEqual(X.staleLabel('x', 'en'), 'Showing the last version that worked · x');
});

test('与「上一版画面」同时出现：优化播放在上、上一版在下', () => {
  const col = X.column(gen(), 'err', 5000, 'zh');
  assert.deepStrictEqual(col.map(c => c.key), ['optimizing', 'stale']);
  assert.deepStrictEqual(X.column(gen({since: 4500}), 'err', 5000, 'zh').map(c => c.key), ['stale'],
    '不满 1 秒时只剩上一版提示');
  assert.deepStrictEqual(X.column(null, null, 5000, 'zh'), []);
});

test('修订切换：上一修订仍在生成则计时接着算，否则重新计 1 秒', () => {
  assert.strictEqual(X.since(gen({since: 100}), 5000), 100);
  assert.strictEqual(X.since(gen({status: 'ready', since: 100}), 5000), 5000);
  assert.strictEqual(X.since(gen({status: 'failed', since: 100}), 5000), 5000);
  assert.strictEqual(X.since(null, 5000), 5000);
});

test('多个来源：只数在生成的，帧数求和，计时取最早', () => {
  const t = X.tally([
    {status: 'generating', since: 300, done: 100, total: 300},
    {status: 'queued', since: 800, done: 0, total: 600},
    {status: 'ready', since: 0, done: 900, total: 900},
    {status: 'failed', since: 0, done: 5, total: 900},
  ]);
  assert.deepStrictEqual(t, {status: 'generating', since: 300, done: 100, total: 900});
  assert.strictEqual(X.pct(t.done, t.total), 11);
  assert.strictEqual(X.tally([{status: 'ready'}, {status: 'failed'}]), null);
});

test('刷新节拍 1 秒', () => {
  assert.strictEqual(X.TICK_MS, 1000);
  assert.strictEqual(X.SHOW_AFTER_MS, 1000);
});
