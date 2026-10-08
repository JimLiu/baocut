const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-nav.js');
const N = global.window.BC_NAV;

const store = (init) => {
  let v = init;
  return {getItem: () => v, setItem: (k, x) => { v = x; }};
};

test('初始态是 Home 一条', () => {
  const n = N.fresh();
  assert.deepEqual(N.current(n), {r: 'home'});
  assert.equal(N.canBack(n), false);
  assert.equal(N.canFwd(n), false);
});

test('push / back / fwd', () => {
  let n = N.fresh();
  n = N.push(n, {r: 'projects'});
  n = N.push(n, {r: 'editor', id: 'p1'});
  assert.equal(n.stack.length, 3);
  assert.deepEqual(N.current(n), {r: 'editor', id: 'p1'});
  n = N.back(n);
  assert.deepEqual(N.current(n), {r: 'projects'});
  assert.equal(N.canFwd(n), true);
  n = N.fwd(n);
  assert.deepEqual(N.current(n), {r: 'editor', id: 'p1'});
  assert.equal(N.canFwd(n), false);
});

test('后退后再 push 会丢掉前进历史', () => {
  let n = N.fresh();
  n = N.push(n, {r: 'projects'});
  n = N.push(n, {r: 'tasks'});
  n = N.back(n);
  n = N.push(n, {r: 'remote'});
  assert.deepEqual(n.stack.map((r) => r.r), ['home', 'projects', 'remote']);
  assert.equal(N.canFwd(n), false);
});

test('push 同一条路由原地不动（连点不堆栈）', () => {
  let n = N.fresh();
  n = N.push(n, {r: 'editor', id: 'p1'});
  const before = n;
  n = N.push(n, {r: 'editor', id: 'p1'});
  assert.equal(n, before);
  n = N.push(n, {r: 'editor', id: 'p2'});
  assert.equal(n.stack.length, 3, 'id 不同就是另一条');
});

test('replace 不进历史', () => {
  let n = N.push(N.fresh(), {r: 'settings', sec: 'general'});
  const depth = n.stack.length;
  n = N.replace(n, {r: 'settings', sec: 'local'});
  assert.equal(n.stack.length, depth);
  assert.deepEqual(N.current(n), {r: 'settings', sec: 'local'});
});

test('栈深上限 50，超了从头丢', () => {
  let n = N.fresh();
  for (let i = 0; i < 80; i++) n = N.push(n, {r: 'editor', id: 'p' + i});
  assert.equal(n.stack.length, 50);
  assert.equal(n.pos, 49);
  assert.deepEqual(N.current(n), {r: 'editor', id: 'p79'});
});

test('端点不越界', () => {
  let n = N.fresh();
  assert.equal(N.back(n), n);
  assert.equal(N.fwd(n), n);
});

test('load 拒绝坏数据，回到初始态', () => {
  assert.deepEqual(N.load(store(null)), N.fresh());
  assert.deepEqual(N.load(store('not json')), N.fresh());
  assert.deepEqual(N.load(store('{"stack":[],"pos":0}')), N.fresh());
  assert.deepEqual(N.load(store('{"stack":[{"r":"home"}],"pos":9}')), N.fresh(), 'pos 越界');
  assert.deepEqual(N.load(store('{"stack":[{"x":1}],"pos":0}')), N.fresh(), '条目没有 r');
});

test('save → load 往返', () => {
  const s = store(null);
  let n = N.push(N.fresh(), {r: 'editor', id: 'p1', tab: 'subtitle'});
  N.save(n, s);
  assert.deepEqual(N.load(s), n);
});

test('项目页的 from（只看某个项目切出的短视频）算不同的一条路由', () => {
  let n = N.push(N.fresh(), {r: 'projects'});
  n = N.push(n, {r: 'projects', from: 'p1'});
  assert.equal(n.stack.length, 3);
  assert.deepEqual(N.current(n), {r: 'projects', from: 'p1'});
  assert.equal(N.push(n, {r: 'projects', from: 'p1'}), n);
  n = N.replace(n, {r: 'projects'});
  assert.deepEqual(N.current(n), {r: 'projects'});
});

test('编辑器的 via（从 Home 还是 Space 打开视频）算不同的一条路由', () => {
  let n = N.push(N.fresh(), {r: 'editor', id: 'p1', via: 'home'});

test('新会话页的 dir（在哪个项目里起）算不同的一条路由', () => {
  const n = N.push(N.fresh(), {r: 'agent', dir: 'd1'});
  assert.equal(n.stack.length, 2);
  assert.equal(N.push(n, {r: 'agent', dir: 'd2'}).stack.length, 3);
  assert.equal(N.push(n, {r: 'agent', dir: 'd1'}), n);
});
  n = N.push(n, {r: 'editor', id: 'p1', via: 'space'});
  assert.equal(n.stack.length, 3);
  assert.equal(N.push(n, {r: 'editor', id: 'p1', via: 'space'}), n);
  assert.ok(!N.isSame({r: 'editor', id: 'p1'}, {r: 'editor', id: 'p1', via: 'home'}));
  assert.ok(!N.isSame({r: 'editor', id: 'p1', via: 'home'}, {r: 'editor', id: 'p1', via: 'home', t: 4}));
});


test('旧模型 URL 迁入设置，保留能力与子页并兼容已有设置链接', () => {
  for (const page of [{sec: 'local', tab: 'tts'}, {sec: 'cloud', tab: 'image'}, {sec: 'voices'}]) {
    const route = {r: 'settings', ...page};
    assert.deepEqual(N.routeFromHref(N.hrefFor(route)), route);
    assert.deepEqual(N.routeFromHref(N.hrefFor({r: 'models', ...page})), route);
    const query = new URLSearchParams(page).toString();
    assert.deepEqual(N.routeFromHref('#/settings?' + query), route);
    assert.deepEqual(N.routeFromHref('#/models?' + query), route);
  }
  assert.deepEqual(N.routeFromHref('#/models'), {r: 'settings', sec: 'local'});
  assert.deepEqual(N.routeFromHref('#/settings?sec=agent'), {r: 'settings', sec: 'agent'});
});
