const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-nav.js');
require('./model-app-ia.js');
const IA = global.window.BC_APP_IA;

test('rail 分层且每个入口只出现一次，所有根路由仍可往返', () => {
  assert.deepEqual(IA.TABS.map(t => t.k), ['home', 'space', 'tools']);
  assert.deepEqual(IA.SECONDARY.map(t => t.k), ['services', 'tasks']);
  assert.deepEqual(IA.END.map(t => t.k), ['settings']);
  const tabs = IA.SECTIONS.flatMap(s => s.items);
  assert.equal(new Set(tabs.map(t => t.k)).size, 6);
  tabs.forEach(t => {
    assert.equal(IA.tabOf(t.root), t.k);
    assert.deepEqual(IA.routeFromHref(IA.hrefFor(t.root)), t.root);
  });
});

test('路由归哪一格：工具 / 服务各亮自己那格；打开的视频按 via 亮 Home 或 Space', () => {
  const cases = [
    [{r: 'home'}, 'home'], [{r: 'agent', id: 's1'}, 'home'], [{r: 'agent', dir: 'd1'}, 'home'],
    [{r: 'models'}, 'settings'], [{r: 'models', sec: 'cloud', tab: 'llm'}, 'settings'],
    [{r: 'tools'}, 'tools'], [{r: 'tools', id: 'tts'}, 'tools'],
    [{r: 'services'}, 'services'], [{r: 'services', id: 'mcp'}, 'services'],
    [{r: 'remote'}, 'services'], [{r: 'tools', id: 'remote'}, 'services'],
    [{r: 'projects'}, 'space'], [{r: 'sessions'}, 'space'], [{r: 'tasks'}, 'tasks'], [{r: 'task', id: 'j1'}, 'tasks'],
    [{r: 'settings', sec: 'agent'}, 'settings'], [{r: 'skill'}, 'settings'],
    [{r: 'editor', id: 'p1'}, 'home'], [{r: 'editor', id: 'p1', via: 'home'}, 'home'], [{r: 'editor', id: 'p1', via: 'space'}, 'space'],
  ];
  cases.forEach(([r, t]) => assert.equal(IA.tabOf(r), t, JSON.stringify(r)));
});

test('页面侧栏：入口及其子页保留对应目录；视频保留入口侧栏，设置内置导航', () => {
  assert.equal(IA.sideOf({r: 'home'}), 'home');
  assert.equal(IA.sideOf({r: 'agent', id: 's1'}), 'home');
  assert.equal(IA.sideOf({r: 'agent', dir: 'd1'}), 'home');
  assert.equal(IA.sideOf({r: 'projects'}), 'space');
  assert.equal(IA.sideOf({r: 'projects', sec: 'final'}), 'space');
  assert.equal(IA.sideOf({r: 'editor', id: 'p1', via: 'space'}), 'space');
  assert.equal(IA.sideOf({r: 'editor', id: 'p1', via: 'home'}), 'home');
  [{r: 'tools'}, {r: 'tools', id: 'tts'}].forEach(r => assert.equal(IA.sideOf(r), 'tools'));
  [{r: 'services'}, {r: 'services', id: 'web'}, {r: 'remote'}, {r: 'tools', id: 'remote'}].forEach(r => assert.equal(IA.sideOf(r), 'services'));
  [{r: 'tasks'}, {r: 'task', id: 'j1'}].forEach(r => assert.equal(IA.sideOf(r), 'tasks'));
  [{r: 'settings'}, {r: 'models'}, {r: 'skill'}].forEach(r => assert.equal(IA.sideOf(r), null));
});

test('点 rail：在这一格里回根，不在就回上次停留的地方（视频不算）', () => {
  const nav = {stack: [{r: 'home'}, {r: 'agent', id: 's2'}, {r: 'projects', sec: 'final'}, {r: 'editor', id: 'p1', via: 'space'}, {r: 'tasks'}], pos: 4};
  assert.deepEqual(IA.railTarget(nav, 'home'), {r: 'agent', id: 's2'});
  assert.deepEqual(IA.railTarget(nav, 'space'), {r: 'projects', sec: 'final'});
  assert.deepEqual(IA.railTarget(nav, 'tasks'), {r: 'tasks'});
  // 工具 / 服务：在这一格里（子页）回根；不在就回上次停留的子页
  const nav2 = {stack: [{r: 'services', id: 'mcp'}, {r: 'tools', id: 'tts'}, {r: 'home'}], pos: 2};
  assert.deepEqual(IA.railTarget(nav2, 'services'), {r: 'services', id: 'mcp'});
  assert.deepEqual(IA.railTarget(nav2, 'tools'), {r: 'tools', id: 'tts'});
  assert.deepEqual(IA.railTarget({stack: [{r: 'tools', id: 'tts'}], pos: 0}, 'tools'), {r: 'tools'});
  assert.deepEqual(IA.railTarget({stack: [{r: 'home'}], pos: 0}, 'services'), {r: 'services'});
  assert.deepEqual(IA.railTarget({stack: [{r: 'agent', id: 's2'}], pos: 0}, 'home'), {r: 'home'});
  assert.deepEqual(IA.railTarget({stack: [{r: 'home'}], pos: 0}, 'space'), {r: 'projects'});
  assert.equal(IA.railTarget(nav, 'nope'), null);
  // 前进历史里的不算
  assert.deepEqual(IA.railTarget({stack: [{r: 'home'}, {r: 'projects', sec: 'doc'}], pos: 0}, 'space'), {r: 'projects'});
});

test('关闭视频：Home 打开的回到那条会话；Space 打开的回到 Space 上次的列表', () => {
  const nav = {stack: [{r: 'projects', sec: 'movie', id: 'd1'}, {r: 'editor', id: 'p1', via: 'space'}], pos: 1};
  assert.deepEqual(IA.closeMovieTarget({r: 'editor', id: 'p1', via: 'space'}, {open: true, sid: 's1'}, nav), {r: 'projects', sec: 'movie', id: 'd1'});
  assert.deepEqual(IA.closeMovieTarget({r: 'editor', id: 'p1', via: 'space'}, {open: true, sid: 's1'}, {stack: [], pos: 0}), {r: 'projects'});
  assert.deepEqual(IA.closeMovieTarget({r: 'editor', id: 'p1', via: 'home'}, {open: true, sid: 's1'}), {r: 'agent', id: 's1'});
  assert.deepEqual(IA.closeMovieTarget({r: 'editor', id: 'p1'}, {open: false, sid: null}), {r: 'home'});
});

test('侧栏链接：href 与路由互换', () => {
  const routes = [
    {r: 'agent', id: 's1'}, {r: 'agent', dir: 'd2'}, {r: 'projects'}, {r: 'projects', sec: 'final', id: 'd1'}, {r: 'projects', from: 'p1'},
    {r: 'editor', id: 'p1', via: 'space'}, {r: 'tools'}, {r: 'services', id: 'mcp'}, {r: 'tasks'}, {r: 'settings'}, {r: 'home'},
  ];
  routes.forEach((r) => assert.deepEqual(IA.routeFromHref(IA.hrefFor(r)), r, IA.hrefFor(r)));
  assert.equal(IA.hrefFor({r: 'agent', id: 'a b'}), '#/agent/a%20b');
  assert.deepEqual(IA.routeFromHref('#/agent/a%20b'), {r: 'agent', id: 'a b'});
  assert.deepEqual(IA.routeFromHref(''), {r: 'home'});
  assert.deepEqual(IA.routeFromHref('#/whatever'), {r: 'home'});
});

test('任务目录与总览同步排序、状态迁移，不改变源记录顺序', () => {
  const tasks = [{id:'a', status:'running', seq:1}, {id:'b', status:'queued', seq:3}, {id:'c', status:'error', seq:2}, {id:'d', status:'done'}];
  assert.deepEqual(IA.taskGroups(tasks).map(g => g.items.map(t => t.id)), [['b','a'], ['c','d']]);
  assert.deepEqual(tasks.map(t => t.id), ['a','b','c','d']);
  tasks[1] = {...tasks[1], status:'done'};
  assert.deepEqual(IA.taskGroups(tasks).map(g => g.items.map(t => t.id)), [['a'], ['b','c','d']]);
  assert.deepEqual(IA.taskGroups([]).map(g => g.items), [[],[]]);
});


test('视频保留 Space 来源筛选，直接打开不把视频 id 当作目录', () => {
  const route = {r:'editor', id:'p11', via:'space'};
  const source = {r:'projects', id:'d1', sec:'movie'};
  const nav = {stack:[source, route, {r:'projects', id:'d2'}], pos:1};
  assert.deepEqual(IA.sidebarRoute(route, nav), source);
  assert.deepEqual(IA.sidebarRoute(route, {stack:[route], pos:0}), {r:'projects'});
  assert.deepEqual(IA.closeMovieTarget(route, null, nav), source);
});

test('快捷聊天转入 Home 的正常会话，保留视频和 Tab，关闭视频仍是同一条会话', () => {
  const route = IA.movieChatRoute({r:'editor', id:'p11', tab:'video', via:'space'}, 's9');
  assert.deepEqual(route, {r:'agent', id:'s9', movie:'p11', tab:'video'});
  assert.equal(IA.tabOf(route), 'home');
  assert.deepEqual(IA.sidebarRoute(route), route);
  assert.deepEqual(IA.routeFromHref(IA.hrefFor(route)), route);
  assert.deepEqual(IA.closeMovieTarget(route), {r:'agent', id:'s9'});
  assert.equal(IA.movieChatRoute({r:'home'}, 's9'), null);
  assert.equal(IA.movieChatRoute({r:'editor', id:'p11'}, ''), null);
  const NAV = window.BC_NAV;
  assert.equal(NAV.isSame(route, {...route, movie:'p12'}), false);
  assert.equal(NAV.isSame(route, {r:'agent', id:'s9', tab:'video'}), false);
  const history = NAV.push(NAV.push(NAV.fresh(), {r:'editor', id:'p11', via:'space'}), route);
  assert.equal(NAV.current(NAV.back(history)).via, 'space');
  assert.deepEqual(NAV.current(NAV.fwd(NAV.back(history))), route);
});
