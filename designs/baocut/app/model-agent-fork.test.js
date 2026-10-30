const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-video-versions.js');
require('./model-agent-fork.js');
const F = global.window.BC_AGENT_FORK;
const VV = global.window.BC_VIDEO_VERSIONS;

const ROWS = [
  {id: 'u1', role: 'user', text: '把第 3 章的停顿压到 0.3 秒'},
  {id: 'a1', role: 'assistant', text: '我先扫一遍第 3 章。'},
  {id: 't1', role: 'tool', kind: 'command', cmd: 'bcut project info', out: 'duration 206s'},
  {id: 'a2', role: 'assistant', text: '有 11 处停顿。'},
  {id: 'u2', role: 'user', text: '口癖也去掉'},
  {id: 'p1', role: 'permission', cmd: 'bcut cleanup', state: 'allowed'},
  {id: 'a3', role: 'assistant', text: '好了。'},
];

test('turnNumber：第几轮从用户消息数起', () => {
  assert.equal(F.turnNumber(ROWS, 3), 1);
  assert.equal(F.turnNumber(ROWS, 6), 2);
});

test('forkable：结束了、有问有答的回合才能分叉', () => {
  assert.equal(F.forkable({user: ROWS[0], replied: true}, false), true);
  assert.equal(F.forkable({user: ROWS[0], replied: true}, true), false);
  assert.equal(F.forkable({user: ROWS[0], replied: false}, false), false);
  assert.equal(F.forkable({user: null, replied: true}, false), false);
});

test('context：只带用户消息与 Agent 正文，截到那一轮为止', () => {
  const c = F.context(ROWS, 3, {title: '压停顿', folder: '~/Movies/BaoCut/科浪访谈'});
  assert.equal(c.turns, 1);
  assert.equal(c.omitted, 0);
  assert.match(c.text, /^Chat history from a previous BaoCut session\.\nSource session: 压停顿\nSource folder: /);
  assert.match(c.text, /User: 把第 3 章的停顿压到 0\.3 秒\n\nAssistant: 我先扫一遍第 3 章。\n\nAssistant: 有 11 处停顿。$/);
  assert.doesNotMatch(c.text, /bcut project info|口癖/);
  const all = F.context(ROWS, 6, {});
  assert.equal(all.turns, 2);
  assert.doesNotMatch(all.text, /bcut cleanup/);
});

test('context：再分叉一次时，上一次带进来的记录接着带', () => {
  const first = F.context(ROWS, 3, {title: '压停顿'});
  const rows = [{id: 'fork', role: 'marker', kind: 'fork', text: F.refLabel('压停顿', 1), context: first},
    {id: 'u9', role: 'user', text: '再压到 0.2 秒'}, {id: 'a9', role: 'assistant', text: '好的。'},
    {id: 'imp_end', role: 'marker', kind: 'imported', text: '以上导入自 Codex'}];
  const c = F.context(rows, 3, {title: '压停顿（分叉）'});
  assert.equal(c.turns, 2);
  assert.match(c.text, /Source session: 压停顿（分叉）\n\nChat history from a previous BaoCut session\.\nSource session: 压停顿\n/);
  assert.match(c.text, /有 11 处停顿。\n\nUser: 再压到 0\.2 秒\n\nAssistant: 好的。$/);
});

test('context：太长时从最早的整轮略去，写明略去；最近一轮本身超长时截掉中间', () => {
  const long = [];
  for (let i = 0; i < 10; i++) long.push({role: 'user', text: `第 ${i} 轮 ` + 'x'.repeat(80)}, {role: 'assistant', text: 'y'.repeat(80)});
  const c = F.context(long, long.length - 1, {}, 700);
  assert.ok(c.text.length <= 700, `${c.text.length}`);
  assert.ok(c.omitted > 0 && c.turns > 0);
  assert.equal(c.omitted + c.turns, 10);
  assert.match(c.text, /\[Earlier messages omitted\]\n\nUser: 第 \d 轮/);
  assert.match(c.text, /第 9 轮/);
  const one = F.context([{role: 'user', text: 'z'.repeat(2000)}], 0, {}, 300);
  assert.ok(one.text.length <= 300, `${one.text.length}`);
  assert.match(one.text, /\[Message truncated\]/);
  assert.equal(one.omitted, 0);
  assert.equal(F.context([], -1, {}).text.endsWith('No chat history.'), true);
});

/* 一部视频的版本：5 → 4 → 3 → 2 版（新的在前），at 是多少分钟前 */
const st = () => VV.normalize({list: [
  {n: 2, at: [400, 380], convs: [['s1', '压停顿']]},
  {n: 3, at: [300, 280], convs: [['s1', '压停顿']]},
  {n: 4, at: [200, 190]},
  {n: 5, at: [100, 50], convs: [['s9', '别的会话']]},
]});

test('restoreState：回到那一轮结束之前的最后一版；那之后没改动不用回', () => {
  assert.deepEqual(F.restoreState(st(), 250), {k: 'ok', target: 3, after: 2});
  assert.deepEqual(F.restoreState(st(), 30), {k: 'none'});
  // 那一刻落在第 5 版中间：第 5 版算在之后
  assert.deepEqual(F.restoreState(st(), 70), {k: 'ok', target: 4, after: 1});
});

test('restoreState：那时的版本被清掉、视频那之后才有、链断开、不在项目里', () => {
  assert.deepEqual(F.restoreState(st(), 500), {k: 'gone', after: 4});
  const fresh = VV.normalize({list: [{n: 1, at: [100, 90]}, {n: 2, at: [80, 70]}]});
  assert.deepEqual(F.restoreState(fresh, 500), {k: 'new', after: 2});
  const broken = st();
  broken.versions.find((v) => v.n === 4).unreadable = true;
  const b = F.restoreState(broken, 250);
  assert.equal(b.k, 'blocked');
  assert.match(b.why, /版本 4/);
  assert.deepEqual(F.restoreState(VV.scenario(st(), 'outside'), 250), {k: 'outside'});
});

test('restoreRows：只列这条会话改过、那之后又有改动的视频；回不去的变灰', () => {
  const states = {p1: st(), p2: VV.normalize({list: [{n: 1, at: [90, 80], convs: [['s2', 'x']]}]}), p3: st()};
  const movies = [{id: 'p1', title: '访谈'}, {id: 'p3', title: '预告'}];
  const rows = F.restoreRows('s1', movies, states, 250);
  assert.deepEqual(rows.map((r) => [r.id, r.title, r.state.k, r.checked, r.disabled]), [
    ['p1', '访谈', 'ok', true, false],
    ['p3', '预告', 'ok', true, false],
  ]);
  assert.match(rows[0].note, /回到版本 3；那之后的 2 版改动/);
  assert.deepEqual(F.restoreRows('s1', movies, states, 30), []);
  const gone = F.restoreRows('s1', movies, {p1: st()}, 500);
  assert.equal(gone[0].disabled, true);
  assert.match(gone[0].note, /那时的版本已不在/);
});

test('restoreItem：没有要回的不出现，都回不去时变灰', () => {
  assert.equal(F.restoreItem([]), null);
  const ok = {title: '访谈', state: {k: 'ok'}, note: 'n'};
  const gone = {title: '预告', state: {k: 'gone'}, note: '那时的版本已不在'};
  assert.deepEqual(F.restoreItem([ok]), {disabled: false, note: '「访谈」回到那一轮结束时'});
  assert.deepEqual(F.restoreItem([ok, gone]), {disabled: false, note: '1 部视频回到那一轮结束时'});
  assert.deepEqual(F.restoreItem([gone]), {disabled: true, note: '那时的版本已不在'});
});
