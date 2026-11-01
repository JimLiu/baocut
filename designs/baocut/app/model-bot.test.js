const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-bot.js');
const B = global.window.BC_BOT;

const NOW = Date.parse('2026-10-31T12:00:00Z');
const item = (id, patch) => ({id, channelId: 'c', title: id, owner: 'agent', priority: 'medium', updatedAt: NOW, steps: [], finishedSteps: [], outputs: [], updates: [], ...patch});

test('状态键：进行中按子状态，已解决按结局，每个键都在对照表里', () => {
  assert.equal(B.statusKey(item('a', {status: 'active', active: {state: 'needsInput'}})), 'needsInput');
  assert.equal(B.statusKey(item('a', {status: 'active'})), 'working');
  assert.equal(B.statusKey(item('a', {status: 'resolved', resolution: {kind: 'dismissed', at: NOW}})), 'dismissed');
  assert.equal(B.statusKey(item('a', {status: 'scheduled'})), 'scheduled');
  const {items} = B.demo(NOW);
  items.forEach(i => assert.ok(B.STATUS[B.statusKey(i)], i.id));
});

test('任务面板：进行中按子状态分组，空组不列；接下来与定时分开，定时按开始时刻；建议最多 3 条', () => {
  const items = [
    item('w', {status: 'active', active: {state: 'working'}}),
    item('in', {status: 'active', active: {state: 'needsInput'}}),
    item('rv', {status: 'active', active: {state: 'needsReview'}}),
    item('rv2', {status: 'active', active: {state: 'needsReview'}, priority: 'high'}),
    item('bl', {status: 'active', active: {state: 'blocked'}}),
    item('sc2', {status: 'scheduled', startAt: NOW + 2000}),
    item('sc', {status: 'scheduled', startAt: NOW + 1000}),
    item('up', {status: 'upNext'}),
    ...[1, 2, 3, 4].map(n => item('s' + n, {status: 'suggested'})),
  ];
  const s = B.taskSections(items, 'all', NOW, false);
  assert.deepEqual(s.active.map(g => [g.state, g.items.map(i => i.id)]),
    [['needsReview', ['rv2', 'rv']], ['needsInput', ['in']], ['blocked', ['bl']], ['working', ['w']]]);
  assert.deepEqual(s.upNext.map(i => i.id), ['up']);
  assert.deepEqual(s.scheduled.map(i => i.id), ['sc', 'sc2']);
  assert.equal(s.suggested.length, 3);
  assert.deepEqual(B.tabCounts(s), {active: 5, upNext: 1, scheduled: 2, resolved: 0});
});

test('页签：每条任务按状态落到一个页签，建议不落', () => {
  assert.deepEqual(B.TASK_TABS, ['active', 'upNext', 'scheduled', 'resolved']);
  assert.equal(B.tabOf(item('a', {status: 'scheduled'})), 'scheduled');
  assert.equal(B.tabOf(item('a', {status: 'resolved'})), 'resolved');
  assert.equal(B.tabOf(item('a', {status: 'suggested'})), null);
  B.TASK_TABS.forEach(k => assert.ok(B.TAB_LABEL[k], k));
});

test('任务面板：已完成只列 30 天内最近 20 条，其余计数；展开后全列', () => {
  const old = item('old', {status: 'resolved', resolution: {kind: 'done', at: NOW - 40 * 86400000}});
  const recent = Array.from({length: 22}, (_, n) => item('r' + n, {status: 'resolved', resolution: {kind: 'done', at: NOW - n * 1000}}));
  const s = B.taskSections([old, ...recent], 'all', NOW, false);
  assert.equal(s.done.length, 20);
  assert.equal(s.moreDone, 3);
  assert.equal(B.taskSections([old, ...recent], 'all', NOW, true).done.length, 23);
});

test('筛选：我的只看我来做的，智能体的只看交给智能体的', () => {
  const items = [item('u', {status: 'upNext', owner: 'user'}), item('a', {status: 'upNext', owner: 'agent'})];
  assert.deepEqual(B.taskSections(items, 'mine', NOW).upNext.map(i => i.id), ['u']);
  assert.deepEqual(B.taskSections(items, 'agent', NOW).upNext.map(i => i.id), ['a']);
});

test('频道侧栏：主频道第一，置顶其次，其余按最近活动；归档另成一组；徽标数等你的任务', () => {
  const {channels, items} = B.demo(NOW);
  const rows = B.channelSummaries(channels, items);
  const groups = B.channelGroups(rows);
  assert.deepEqual(groups.active.map(r => r.channel.id), ['chan_main', 'chan_weekly', 'chan_shorts', 'chan_dub']);
  assert.deepEqual(groups.archived.map(r => r.channel.id), ['chan_old']);
  assert.equal(rows.find(r => r.channel.id === 'chan_main').counts.needsYou, 2);
  assert.equal(B.needsYouTotal(rows), 3);
});

test('新建任务：默认我来做、进接下来；交给智能体并现在开始才直接开始', () => {
  const t = B.newTask({id: 'n', channelId: 'c', title: '  写提纲 ', ...B.NEW_TASK_DEFAULTS}, NOW);
  assert.equal(t.title, '写提纲');
  assert.equal(t.status, 'upNext');
  assert.equal(B.newTask({id: 'n', channelId: 'c', title: 'x', owner: 'user', start: true}, NOW).status, 'upNext');
  assert.equal(B.newTask({id: 'n', channelId: 'c', title: 'x', owner: 'agent', start: true}, NOW).status, 'active');
});

test('快捷操作与下一步一行', () => {
  assert.deepEqual(B.quickActions(item('a', {status: 'upNext'})), ['start', 'markDone', 'dismiss']);
  assert.deepEqual(B.quickActions(item('a', {status: 'active', active: {state: 'blocked'}})), ['refresh', 'markDone', 'dismiss']);
  assert.equal(B.applyAction(item('a', {status: 'upNext'}), 'markDone', NOW).resolution.kind, 'done');
  assert.equal(B.nextLine(item('a', {status: 'active', question: {text: '用哪张？', options: []}})), '用哪张？');
  assert.equal(B.nextLine(item('a', {status: 'resolved', outcome: '好了'})), '好了');
});

test('提示芯片只跟最后一条消息走：之后用户说了话就收起', () => {
  const chips = [{label: '好'}];
  assert.deepEqual(B.openChips([{kind: 'message', role: 'assistant', text: 'x', chips}, {kind: 'work-item-ref', workItemId: 'a'}]), chips);
  assert.equal(B.openChips([{kind: 'message', role: 'assistant', text: 'x', chips}, {kind: 'message', role: 'user', text: 'y'}]), null);
});
