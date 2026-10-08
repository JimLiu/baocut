const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-select.js');
const S = global.window.BC_SELECT;

const EL = (id) => ({kind: 'element', id, elKind: 'shape'});

test('key 是 kind:id[:trackId]', () => {
  assert.equal(S.key(EL('e-shp')), 'element:e-shp');
  assert.equal(S.key({kind: 'subs', trackId: 't1'}), 'subs::t1');
  assert.equal(S.key(null), '');
});

test('norm 不丢调用方挂上来的字段', () => {
  const s = S.norm({kind: 'element', id: 'e-shp', elKind: 'shape', seed: {a: 1}});
  assert.deepEqual(s.seed, {a: 1});
  assert.equal(s.elKind, 'shape');
  assert.equal(S.norm({}), null);
});

test('普通点选替换整个选中集', () => {
  assert.deepEqual(S.keys(S.apply([EL('a'), EL('b')], EL('c'))), ['element:c']);
  assert.deepEqual(S.apply([EL('a')], null), []);
});

test('add 追加、toggle 反选', () => {
  const one = S.apply([], EL('a'), {add: true});
  const two = S.apply(one, EL('b'), {add: true});
  assert.deepEqual(S.keys(two), ['element:a', 'element:b']);
  assert.deepEqual(S.keys(S.apply(two, EL('a'), {toggle: true})), ['element:b']);
  /* add（非 toggle）碰到已选项保持原样，不重复入列 */
  assert.deepEqual(S.keys(S.apply(two, EL('a'), {add: true})), ['element:a', 'element:b']);
});

test('只有 element 能多选（2026-09-16 起没有 clip），其余退化单选', () => {
  assert.ok(S.canMulti('element') && !S.canMulti('clip'));
  assert.ok(!S.canMulti('cue') && !S.canMulti('subs') && !S.canMulti('member'));
  const mixed = S.apply([EL('a')], {kind: 'cue', id: 'c1'}, {add: true});
  assert.deepEqual(S.keys(mixed), ['cue:c1']);
  /* 反过来：选着字幕轨再 shift 点元素，字幕轨被请出去 */
  const back = S.apply([{kind: 'subs', trackId: 't1'}], EL('a'), {add: true});
  assert.deepEqual(S.keys(back), ['element:a']);
});

test('primary 是最后一次点中的那件', () => {
  const two = S.apply(S.apply([], EL('a'), {add: true}), EL('b'), {add: true});
  assert.equal(S.primary(two).id, 'b');
  assert.equal(S.primary([]), null);
  assert.ok(S.has(two, 'element', 'a'));
  assert.ok(!S.has(two, 'clip', 'a'));
});

test('visibleAt 把 end=null 当成铺到片尾', () => {
  const els = [{id: 'a', start: 0, end: 10}, {id: 'b', start: 20, end: null}, {id: 'c', start: 5, end: 9}];
  assert.deepEqual(S.visibleAt(els, 6, 206).map((e) => e.id), ['a', 'c']);
  assert.deepEqual(S.visibleAt(els, 30, 206).map((e) => e.id), ['b']);
});

test('hitRect 取相交，边贴边不算', () => {
  const rects = [{id: 'a', x: 0, y: 0, w: 10, h: 10}, {id: 'b', x: 20, y: 20, w: 10, h: 10}];
  assert.deepEqual(S.hitRect(rects, {x: 5, y: 5, w: 20, h: 20}), ['a', 'b']);
  assert.deepEqual(S.hitRect(rects, {x: 10, y: 0, w: 5, h: 5}), []);
  /* 反向拖出来的框（负宽高）先归一化 */
  assert.deepEqual(S.hitRect(rects, {x: 25, y: 25, w: -20, h: -20}), ['a', 'b']);
});

test('粘贴 id 不叠加 copy 后缀', () => {
  assert.equal(S.pasteId('e-shp', 1), 'e-shp-copy-1');
  assert.equal(S.pasteId('e-shp-copy-1', 2), 'e-shp-copy-2');
});

test('粘贴偏移每次再挪 2%，并夹在限位内', () => {
  assert.deepEqual(S.pasteOffset({x: 50, y: 50, w: 20}, 1), {x: 52, y: 52, w: 20});
  assert.deepEqual(S.pasteOffset({x: 50, y: 50, w: 20}, 3), {x: 56, y: 56, w: 20});
  assert.equal(S.pasteOffset({x: 96, y: 50}, 3).x, 97);
});

test('播放头在时段外才搬时间，且保长', () => {
  const el = {start: 30, end: 38};
  assert.deepEqual(S.pasteSpan(el, 33, 206), {start: 30, end: 38});
  assert.deepEqual(S.pasteSpan(el, 100, 206), {start: 100, end: 108});
  assert.deepEqual(S.pasteSpan(el, 205, 206), {start: 198, end: 206});
  assert.deepEqual(S.pasteSpan({start: 50, end: null}, 20, 206), {start: 20, end: null});
  assert.deepEqual(S.pasteSpan({start: 0, end: null}, 40, 206), {start: 0, end: null});
});

test('nudge 夹取在限位内并保留其它 pose 字段', () => {
  assert.deepEqual(S.nudge({x: 50, y: 50, w: 20, rot: 8}, 1, 0), {x: 51, y: 50, w: 20, rot: 8});
  assert.equal(S.nudge({x: 96.5, y: 50}, 5, 0).x, 97);
  assert.equal(S.nudge({x: 50, y: 5}, 0, -5).y, 4);
});

test('frameStep 一帧 1/30、⇧ 一秒，夹在 0…dur', () => {
  assert.ok(Math.abs(S.frameStep(1, 1, {dur: 206}) - (1 + 1 / 30)) < 1e-9);
  assert.equal(S.frameStep(1, 1, {shift: true, dur: 206}), 2);
  assert.equal(S.frameStep(0, -1, {dur: 206}), 0);
  assert.equal(S.frameStep(206, 1, {dur: 206}), 206);
});

test('marqueeRect 归一化并在 4px 以内仍算点击（第 115 轮）', () => {
  assert.deepEqual(S.marqueeRect({x: 10, y: 10}, {x: 40, y: 30}), {x: 10, y: 10, w: 30, h: 20, on: true});
  // 反向拖：起点在右下角，矩形照样是正的
  assert.deepEqual(S.marqueeRect({x: 40, y: 30}, {x: 10, y: 10}), {x: 10, y: 10, w: 30, h: 20, on: true});
  assert.equal(S.marqueeRect({x: 10, y: 10}, {x: 13, y: 12}).on, false);
  assert.equal(S.marqueeRect({x: 10, y: 10}, {x: 14, y: 10}).on, true);
  assert.equal(S.MARQUEE_MIN, 4);
});

test('boundsOf 给出多选统一框，空集给 null', () => {
  assert.equal(S.boundsOf([]), null);
  assert.deepEqual(S.boundsOf([{x: 0, y: 0, w: 10, h: 10}, {x: 20, y: 5, w: 10, h: 20}]),
    {x: 0, y: 0, w: 30, h: 25});
  // 单件时统一框就是它自己
  assert.deepEqual(S.boundsOf([{x: 4, y: 6, w: 8, h: 2}]), {x: 4, y: 6, w: 8, h: 2});
});

test('groupShift 先把位移夹到全组合法，不把组拖变形', () => {
  // 90 这件先撞到 97 的限位，整组因此只走 7
  assert.deepEqual(S.groupShift([{x: 50, y: 50}, {x: 90, y: 50}], 20, 0), {dx: 7, dy: 0});
  assert.deepEqual(S.groupShift([{x: 50, y: 50}, {x: 90, y: 50}], 5, 0), {dx: 5, dy: 0});
  assert.deepEqual(S.groupShift([{x: 10, y: 10}], -20, -20), {dx: -7, dy: -6});
  assert.deepEqual(S.groupShift([], 20, 20), {dx: 0, dy: 0});
});

test('groupScale 绕统一框中心等比缩，倍率夹在 0.1…5', () => {
  assert.deepEqual(S.groupScale([{id: 'a', x: 40, y: 50, scale: 1}, {id: 'b', x: 60, y: 50, scale: 2}],
    {x: 50, y: 50}, 2), [{id: 'a', x: 30, y: 50, scale: 2}, {id: 'b', x: 70, y: 50, scale: 4}]);
  assert.equal(S.groupScale([{id: 'a', x: 50, y: 50, scale: 4}], {x: 50, y: 50}, 4)[0].scale, 5);
  assert.equal(S.groupScale([{id: 'a', x: 50, y: 50, scale: 0.2}], {x: 50, y: 50}, 0.1)[0].scale, 0.1);
});

test('playState：起播清选中并退出编辑，暂停原样留着', () => {
  const prev = {sels: [{kind: 'element', id: 'e-txt'}], editing: {id: 'e-txt'}};
  assert.deepEqual(S.playState(prev, true), {sels: [], editing: null});
  assert.deepEqual(S.playState(prev, false), prev);
});

test('seekForSel：在时段内不动，在时段外跳到起点后一帧', () => {
  const span = {start: 10, end: 20};
  assert.equal(S.seekForSel(span, 12, 206), null);          // 在里面
  assert.equal(S.seekForSel(span, 10, 206), null);          // 起点也算在里面
  assert.equal(S.seekForSel(span, 20, 206), null);          // 终点也算
  assert.ok(Math.abs(S.seekForSel(span, 3, 206) - (10 + 1 / 30)) < 1e-9);   // 在前面
  assert.ok(Math.abs(S.seekForSel(span, 90, 206) - (10 + 1 / 30)) < 1e-9);  // 在后面
});

test('seekForSel：追加选择（shift / ⌘）不动播放头', () => {
  const span = {start: 10, end: 20};
  const mods = {add: true, toggle: true};
  assert.equal(S.seekForSel(span, 3, 206, mods), null);     // 带修饰键：原地不动
  assert.equal(S.seekForSel(span, 90, 206, mods), null);
  // 没按修饰键（null / undefined）仍照旧带过去
  assert.ok(Math.abs(S.seekForSel(span, 3, 206, null) - (10 + 1 / 30)) < 1e-9);
  assert.ok(Math.abs(S.seekForSel(span, 3, 206) - (10 + 1 / 30)) < 1e-9);
});

test('seekForSel：end 为 null 铺到片尾，超短块不越过自己的终点', () => {
  assert.equal(S.seekForSel({start: 0, end: null}, 100, 206), null);
  assert.ok(Math.abs(S.seekForSel({start: 120, end: null}, 5, 206) - (120 + 1 / 30)) < 1e-9);
  // 比一帧还短的块：跳到 start + 1 帧会越过 end，夹回 end
  assert.equal(S.seekForSel({start: 10, end: 10.01}, 0, 206), 10.01);
  assert.equal(S.seekForSel(null, 5, 206), null);
});

test('removeTarget：与 Delete 键同一条判据，元素优先、其次字幕轨，字幕条与空选不删', () => {
  const el = (id) => ({kind: 'element', id, elKind: 'text'});
  const subs = {kind: 'subs', trackId: 'src'};
  const cue = {kind: 'cue', id: 'c3'};
  assert.deepEqual(S.removeTarget([el('a'), el('b')], el('b')), {kind: 'elements', ids: ['a', 'b']});
  assert.deepEqual(S.removeTarget([subs], subs), {kind: 'subs', trackId: 'src'});
  assert.deepEqual(S.removeTarget([subs, el('a')], subs), {kind: 'elements', ids: ['a']});   // 混选：元素先
  assert.equal(S.removeTarget([cue], cue), null);
  assert.equal(S.removeTarget([], null), null);
  assert.equal(S.removeTarget(null, undefined), null);
});
