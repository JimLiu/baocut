const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-agent-schedule.js');
const S = global.window.BC_AGENT_SCHEDULE;

// 2026-10-30 是星期五
const at = (d, h, m) => new Date(2026, 9, d, h, m || 0);
const iso = (t) => t && `${t.getMonth() + 1}-${t.getDate()} ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;

test('parseCron：五段，范围、步长、列表；看不懂与超出范围写明哪一段', () => {
  assert.equal(S.parseCron('0 9 * * 1-5').ok, true);
  assert.equal(S.parseCron('*/15 8-18/2 1,15 * 7').ok, true);
  assert.deepEqual(S.parseCron('0 9 * *'), {ok: false, error: 'cron 要五段：分 时 日 月 周'});
  assert.deepEqual(S.parseCron('0 25 * * *'), {ok: false, error: '第 2 段（时）「25」超出 0–23'});
  assert.deepEqual(S.parseCron('0 9 * * mon'), {ok: false, error: '第 5 段（周）「mon」看不懂'});
});

test('nextRun：每天、每周、每小时、cron；严格在之后', () => {
  assert.equal(iso(S.nextRun({type: 'daily', time: '09:00'}, at(30, 8, 59))), '10-30 9:00');
  assert.equal(iso(S.nextRun({type: 'daily', time: '09:00'}, at(30, 9, 0))), '10-31 9:00');
  assert.equal(iso(S.nextRun({type: 'weekly', days: [1, 3], time: '20:30'}, at(30, 12))), '11-2 20:30');
  assert.equal(iso(S.nextRun({type: 'hourly', minute: 15}, at(30, 12, 20))), '10-30 13:15');
  assert.equal(iso(S.nextRun({type: 'cron', expr: '0 9 * * 1-5'}, at(30, 10))), '11-2 9:00');
  // 周日写成 7
  assert.equal(iso(S.nextRun({type: 'cron', expr: '0 8 * * 7'}, at(30, 10))), '11-1 8:00');
  // 日与周都限定：满足其一
  assert.equal(iso(S.nextRun({type: 'cron', expr: '0 9 1 * 1'}, at(30, 10))), '11-1 9:00');
  assert.equal(S.nextRun({type: 'cron', expr: '0 9 30 2 *'}, at(30, 10)), null);
});

test('missedBetween：Runtime 没开着时到点了几次', () => {
  const daily = {type: 'daily', time: '09:00'};
  assert.equal(S.missedBetween(daily, at(27, 18), at(30, 10)), 3);
  assert.equal(S.missedBetween(daily, at(30, 9), at(30, 10)), 0);
  assert.equal(S.missedBetween({type: 'hourly', minute: 0}, at(1, 0), at(30, 0), 5), 5);
});

test('describe 与 whenLabel', () => {
  assert.equal(S.describe({type: 'weekly', days: [3, 1], time: '20:30'}), '每周一、三 20:30');
  assert.equal(S.describe({type: 'hourly', minute: 0}), '每小时第 0 分');
  assert.equal(S.describe({type: 'cron', expr: '0 9 * * 1-5'}), 'cron 0 9 * * 1-5');
  assert.equal(S.whenLabel(at(30, 21, 5), at(30, 10)), '今天 21:05');
  assert.equal(S.whenLabel(at(31, 9), at(30, 10)), '明天 09:00');
  assert.equal(S.whenLabel(at(2, 9), at(30, 10)), '10 月 2 日 09:00');
});

test('fire：上一次还在跑就跳过；会话正忙就等；会话没了或归档就暂停；跑满就完成', () => {
  const base = {status: 'active', target: {type: 'session', id: 's1'}, runs: []};
  const idle = {id: 's1', status: 'done'};
  assert.deepEqual(S.fire(base, idle), {k: 'run'});
  assert.deepEqual(S.fire(base, {id: 's1', status: 'running'}), {k: 'queue'});
  assert.deepEqual(S.fire(base, {id: 's1', status: 'waiting'}), {k: 'queue'});
  assert.deepEqual(S.fire(Object.assign({}, base, {runs: [{status: 'running'}]}), idle), {k: 'skip'});
  assert.deepEqual(S.fire(Object.assign({}, base, {runs: [{status: 'queued'}]}), idle), {k: 'skip'});
  assert.deepEqual(S.fire(base, undefined), {k: 'pause', reason: '目标会话已删除'});
  assert.deepEqual(S.fire(base, {id: 's1', archived: true}), {k: 'pause', reason: '目标会话已归档'});
  const capped = Object.assign({}, base, {maxRuns: 2, runs: [{status: 'done'}, {status: 'skipped'}, {status: 'missed', count: 3}, {status: 'failed'}]});
  assert.deepEqual(S.fire(capped, idle), {k: 'complete'});
  assert.equal(S.countedRuns(capped), 2);
  assert.deepEqual(S.fire({status: 'active', target: {type: 'new', dir: 'd1'}, runs: []}, undefined), {k: 'run'});
  assert.equal(S.fire(Object.assign({}, base, {status: 'paused'}), idle), null);
});

test('statusOf、runLabel、accessHint', () => {
  const now = at(30, 10);
  assert.deepEqual(S.statusOf({status: 'active', cadence: {type: 'daily', time: '09:00'}}, now), {k: 'active', label: '下一次：明天 09:00', tone: 'informative'});
  assert.equal(S.statusOf({status: 'paused', pauseReason: '目标会话已归档'}, now).label, '已暂停：目标会话已归档');
  assert.equal(S.statusOf({status: 'completed', maxRuns: 4}, now).label, '已完成（跑满 4 次）');
  assert.equal(S.runLabel({status: 'missed', count: 3}), '错过 · 3 次（BaoCut 没开着）');
  assert.equal(S.runLabel({status: 'skipped'}), '跳过：上一次还在跑');
  assert.equal(S.accessHint('fullAccess', []), null);
  assert.match(S.accessHint('ask', [{k: 'ask', label: '监督'}]), /^这条会话的访问模式是「监督」/);
});

test('validate', () => {
  const ok = {prompt: '总结频道这周的新视频', cadence: {type: 'daily', time: '09:00'}, maxRuns: null};
  assert.equal(S.validate(ok), null);
  assert.equal(S.validate(Object.assign({}, ok, {prompt: ' '})), '写一段每次要发的话');
  assert.equal(S.validate(Object.assign({}, ok, {cadence: {type: 'cron', expr: '0 9'}})), 'cron 要五段：分 时 日 月 周');
  assert.equal(S.validate(Object.assign({}, ok, {cadence: {type: 'weekly', days: [], time: '09:00'}})), '至少选一天');
  assert.equal(S.validate(Object.assign({}, ok, {cadence: {type: 'daily', time: '9点'}})), '时刻写成 09:00 这样');
  assert.equal(S.validate(Object.assign({}, ok, {maxRuns: 0})), '最多运行次数要是正整数');
});
