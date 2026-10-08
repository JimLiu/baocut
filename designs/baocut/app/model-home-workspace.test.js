const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-home-workspace.js');
require('./model-nav.js');
const W = window.BC_HOME_WORKSPACE, N = window.BC_NAV;
const movie = {key:'movie:p1', kind:'movie', id:'p1', tab:'subtitle'};
const file = {key:'file:o1', kind:'file', id:'o1'};
const web = {key:'web:w1', kind:'web', id:'w1', url:'https://example.com/'};

test('multiple resource types coexist, reopening selects rather than duplicates', () => {
  const first = W.open(W.open(W.open(W.empty(), movie), file), web);
  const next = W.open(first, {...movie, tab:'video'});
  assert.equal(next.tabs.length, 3);
  assert.equal(next.active, movie.key);
  assert.equal(next.tabs[0].tab, 'video');
  assert.equal(first.tabs[0].tab, 'subtitle');
});
test('closing active selects the right neighbor, then the left, then collapses', () => {
  const first = W.open(W.open(W.open(W.empty(), movie), file), web);
  assert.equal(W.close(first, file.key).active, web.key);
  const right = W.close(W.open(first, file), file.key);
  assert.equal(right.active, web.key);
  const left = W.close(right, web.key);
  assert.equal(left.active, movie.key);
  assert.deepEqual(W.close(left, movie.key), W.empty());
  assert.equal(W.close(first, 'missing'), first);
});
test('deep links roundtrip every pane type and keep editor tool/time', () => {
  for (const item of [movie, {...movie,t:24.5},file,web,{...web,url:''}]) {
    const route = W.route('s2', item);
    const parsed = N.routeFromHref(N.hrefFor(route));
    assert.deepEqual(parsed, route);
    const selected = W.fromRoute(parsed);
    assert.equal(selected.key, item.key);
    assert.equal(selected.kind, item.kind);
  }
  assert.equal(N.isSame(W.route('s2',file),W.route('s2',web)), false);
  assert.equal(N.isSame(W.route('s2',web),W.route('s2',{...web,url:'https://example.org/'})), false);
});
test('history reconciliation isolates conversations and preserves inactive tabs', () => {
  let book = W.reconcile({}, W.route('s2',movie));
  book = W.reconcile(book, W.route('s2',file));
  const s2 = book.s2;
  book = W.reconcile(book, W.route('s1',web));
  assert.equal(book.s2, s2);
  assert.deepEqual(book.s1.tabs,[web]);
  book = W.reconcile(book, W.route('s2',movie));
  assert.equal(book.s2.active,movie.key);
  assert.equal(book.s2.tabs.length,2);
  assert.equal(W.reconcile(book, W.route('s2',movie)),book);
  book = W.reconcile(book, W.route('s2',null));
  assert.equal(book.s2.active,null);
  assert.equal(book.s2.tabs.length,2);
});
test('web addresses reject executable schemes and credentials', () => {
  assert.equal(W.safeUrl('example.org/path?q=a b'),'https://example.org/path?q=a%20b');
  assert.equal(W.safeUrl('http://127.0.0.1:4333/'),'http://127.0.0.1:4333/');
  for(const url of ['javascript:alert(1)','data:text/html,hi','file:///tmp/a','https://user:pass@example.org','https://','']) assert.equal(W.safeUrl(url),null);
});
test('reorder in both directions keeps active resource and pane objects intact', () => {
  const original = W.open(W.open(W.open(W.empty(), movie), file), web);
  const right = W.move(original, movie.key, web.key, true);
  assert.deepEqual(right.tabs, [file, web, movie]);
  assert.equal(right.active, web.key);
  assert.equal(right.tabs[2], original.tabs[0]);
  const left = W.move(right, movie.key, file.key);
  assert.deepEqual(left, original);
  assert.deepEqual(original.tabs, [movie, file, web]);
  assert.equal(W.move(original, movie.key, file.key), original);
  assert.equal(W.move(original, movie.key, movie.key), original);
  assert.equal(W.move(original, 'missing', web.key), original);
  assert.equal(W.move(original, movie.key, 'missing'), original);
  const reconciled = W.reconcile({s2:right}, W.route('s2', web));
  assert.equal(reconciled.s2, right);
  assert.equal(W.close(right, web.key).active, movie.key);
});
test('drag targets include gaps and strip edges; preview offsets reserve the dragged tab slot', () => {
  const rects = [{key:'a',left:100,width:120},{key:'b',left:224,width:160},{key:'c',left:388,width:120}];
  const end = W.dragTarget(rects, 'a', 520);
  assert.deepEqual(end, {key:'c',after:true});
  assert.deepEqual(W.dragOffsets(rects,'a',end), {b:-124,c:-124,a:288});
  const start = W.dragTarget(rects, 'c', 90);
  assert.deepEqual(start, {key:'a',after:false});
  assert.deepEqual(W.dragOffsets(rects,'c',start), {c:-288,a:124,b:124});
  assert.deepEqual(W.dragTarget(rects, 'a', 386), {key:'c',after:false});
  assert.equal(W.dragTarget([rects[0]],'a',100), null);
  assert.deepEqual(W.dragOffsets(rects,'a',null), {});
});
test('narrow mode is one container-width threshold; unmeasured widths stay wide', () => {
  assert.equal(W.NARROW_WIDTH, 960);
  assert.equal(W.isNarrow(959), true);
  assert.equal(W.isNarrow(600), true);
  assert.equal(W.isNarrow(960), false);
  assert.equal(W.isNarrow(1400), false);
  for (const w of [0, -1, NaN, undefined, Infinity]) assert.equal(W.isNarrow(w), false);
});
test('a wide-to-narrow switch keeps the visible pane unless the conversation has focus', () => {
  assert.equal(W.narrowShowsConversation(true, true), true);
  assert.equal(W.narrowShowsConversation(false, false), true);
  assert.equal(W.narrowShowsConversation(true, false), true);
  assert.equal(W.narrowShowsConversation(false, true), false);
});
test('the conversation tab never joins drag hit-testing: dropping left of every tab lands at the first real slot', () => {
  const rects = [{key:'a',left:200,width:120},{key:'b',left:324,width:120}];
  assert.deepEqual(W.dragTarget(rects, 'b', 10), {key:'a',after:false});
  assert.deepEqual(W.move({tabs:[{key:'a'},{key:'b'}],active:'a'}, 'b', 'a', false).tabs.map(t => t.key), ['b','a']);
});

test('split drag exceeds the old 560px / 45% cap and hides at half the pane minimum', () => {
  assert.deepEqual(W.resizeSplit(800, 1400), {width:800, hidden:false});
  assert.deepEqual(W.resizeSplit(1080, 1400), {width:1080, hidden:false});
  assert.deepEqual(W.resizeSplit(1240, 1400), {width:1080, hidden:false});
  assert.deepEqual(W.resizeSplit(1241, 1400), {width:1080, hidden:true});
  assert.deepEqual(W.resizeSplit(1700, 1400), {width:1080, hidden:true});
  // Reversing the same gesture restores the split; the left minimum still holds.
  assert.deepEqual(W.resizeSplit(950, 1400), {width:950, hidden:false});
  assert.deepEqual(W.resizeSplit(100, 1400), {width:320, hidden:false});
  assert.deepEqual(W.resizeSplit(801, 960), {width:640, hidden:true});
});

test('draft workspaces are scoped by project and their resource routes round-trip', () => {
  for (const draft of [{r:'home'}, {r:'agent', dir:'d1'}]) {
    const key = W.keyFor(draft);
    assert.ok(key.startsWith('draft:'));
    assert.deepEqual(W.route(key, null), draft);
    for (const item of [web, file, movie]) {
      const route = W.route(key, item);
      assert.deepEqual(N.routeFromHref(N.hrefFor(route)), route);
      assert.equal(W.keyFor(route), key);
      assert.equal(W.fromRoute(route).key, item.key);
    }
    const book = W.reconcile({}, W.route(key, web));
    assert.deepEqual(book[key].tabs, [web]);
    assert.equal(W.reconcile(book, draft)[key].active, null);
    const carried = W.carry(book, key, 'created');
    assert.equal(carried[key], undefined);
    assert.deepEqual(carried.created.tabs, [web]);
    assert.deepEqual(W.route('created', web), {r:'agent', id:'created', web:web.id, url:web.url});
  }
  assert.notEqual(W.keyFor({r:'home'}), W.keyFor({r:'agent', dir:'d1'}));
  assert.equal(W.keyFor({r:'agent', id:'s2', dir:'d1'}), 's2');
  for (const r of [{r:'projects'}, {r:'editor', id:'p1'}, {r:'settings'}]) {
    assert.equal(W.keyFor(r), null);
    const book = {s2: W.open(W.empty(), web)};
    assert.equal(W.reconcile(book, r), book);
    assert.equal(W.fromRoute(r), null);
  }
  // Only drafts move; a session never hands its tabs to another session.
  const book = {s2: W.open(W.empty(), web)};
  assert.equal(W.carry(book, 's2', 's3'), book);
  assert.equal(W.carry(book, 'draft:', 's3'), book);
  assert.equal(W.carry({'draft:': W.empty()}, 'draft:', null)['draft:'].tabs.length, 0);
});
test('entering full view keeps the visible pane, otherwise selects the conversation', () => {
  assert.equal(W.fullViewEntry(true, file.key), file.key);
  assert.equal(W.fullViewEntry(false, file.key), W.CONVERSATION);
  assert.equal(W.fullViewEntry(false, null), W.CONVERSATION);
  assert.equal(W.fullViewEntry(true, null), W.CONVERSATION);
});
test('the tabs button opens a first tab, then toggles the split or leaves full view', () => {
  assert.deepEqual(W.tabsButton({count:0, visible:false, full:false}), {overlay:'tabs-plus', label:'打开新标签页', action:'open'});
  assert.deepEqual(W.tabsButton({count:0, visible:false, full:true}), {overlay:'tabs-plus', label:'打开新标签页', action:'open'});
  assert.deepEqual(W.tabsButton({count:2, visible:true, full:false}), {icon:'hide-tabs', label:'隐藏标签页', action:'hide'});
  assert.deepEqual(W.tabsButton({count:2, visible:false, full:false}), {count:2, badge:'2', label:'显示标签页', action:'show'});
  for (const visible of [true, false]) assert.deepEqual(W.tabsButton({count:3, visible, full:true}), {icon:'hide-tabs', label:'进入分屏视图', action:'split'});
  assert.equal(W.tabsButton({count:9, visible:false, full:false}).badge, '9');
  assert.equal(W.tabsButton({count:10, visible:false, full:false}).badge, '9+');
});
test('a start page is replaced in place by the page it creates', () => {
  const start = {key:'web:a', kind:'web', id:'a', url:''};
  const other = {key:'web:b', kind:'web', id:'b', url:'https://example.com/'};
  const page = {key:'file:p', kind:'file', id:'p'};
  const state = {tabs:[start, other], active:'web:a'};
  assert.deepEqual(W.replace(state, 'web:a', page), {tabs:[page, other], active:'file:p'});
  // Replacing with a tab that is already open keeps one copy, in the replaced slot.
  assert.deepEqual(W.replace({tabs:[other, start, page], active:'web:a'}, 'web:a', page), {tabs:[other, page], active:'file:p'});
  // A missing key falls back to opening the tab.
  assert.deepEqual(W.replace({tabs:[other], active:'web:b'}, 'web:x', page), {tabs:[other, page], active:'file:p'});
});
