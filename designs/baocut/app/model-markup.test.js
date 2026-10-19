const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-markup.js');
const M = window.BC_MARKUP;

const frame = {w: 800, h: 400};

test('初始：画笔、矩形、红、4px；加标记带当前颜色粗细并选中它', () => {
  const s = M.init();
  assert.deepEqual([s.tool, s.shape, s.color, s.width, s.marks, s.sel], ['pen', 'rect', 'red', 4, [], null]);
  const t = M.add(M.setColor(M.setWidth(s, 6), 'blue'), {kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2});
  assert.equal(t.marks.length, 1);
  assert.deepEqual([t.marks[0].color, t.marks[0].width, t.sel], ['blue', 6, t.marks[0].id]);
  assert.equal(M.setShape(s, 'arrow').tool, 'shape');
});

test('撤销 / 重做：每次改动进历史，撤销回上一组，重做再回来；新改动清掉未来', () => {
  let s = M.add(M.init(), {id: 'a', kind: 'rect', x: 0, y: 0, w: 0.5, h: 0.5});
  s = M.add(s, {id: 'b', kind: 'step', x: 0.2, y: 0.2, w: 0, h: 0});
  assert.ok(M.canUndo(s) && !M.canRedo(s));
  s = M.undo(s);
  assert.deepEqual(s.marks.map(m => m.id), ['a']);
  assert.ok(M.canRedo(s));
  s = M.redo(s);
  assert.deepEqual(s.marks.map(m => m.id), ['a', 'b']);
  s = M.undo(M.undo(s));
  assert.deepEqual([s.marks, M.canUndo(s)], [[], false]);
  s = M.add(s, {id: 'c', kind: 'text', x: 0.5, y: 0.5, w: 0, h: 0, text: '字'});
  assert.ok(!M.canRedo(s));
  assert.deepEqual(M.clear(s).marks, []);
  assert.deepEqual(M.undo(M.clear(s)).marks.map(m => m.id), ['c']);
});

test('选中后改颜色 / 粗细连那条一起改；删除、拖动中的改动不进历史', () => {
  let s = M.add(M.init(), {id: 'a', kind: 'line', x: 0.1, y: 0.1, w: 0, h: 0, to: {x: 0.5, y: 0.5}});
  s = M.setColor(s, 'green');
  assert.equal(s.marks[0].color, 'green');
  s = M.select(s, null);
  s = M.setWidth(s, 8);
  assert.deepEqual([s.width, s.marks[0].width], [8, 4]);
  const n = s.past.length;
  s = M.update(s, 'a', {x: 0.2}, {history: false});
  assert.deepEqual([s.marks[0].x, s.past.length], [0.2, n]);
  const orig = s.marks[0];
  s = M.update(s, 'a', {x: 0.3}, {history: false});
  s = M.finishDrag(s, 'a', orig);
  assert.deepEqual([s.marks[0].x, s.past.length, s.past[n].find(m => m.id === 'a').x], [0.3, n + 1, 0.2]);
  assert.equal(M.finishDrag(s, 'a', s.marks[0]), s);
  s = M.remove(s, 'a');
  assert.deepEqual([s.marks, s.sel, s.past.length], [[], null, n + 2]);
});

test('手势换成归一化几何：矩形取两点的框，箭头带终点，画笔带点列与外接框，点只记一个点', () => {
  assert.deepEqual(M.fromGesture('rect', {x: 600, y: 100}, {x: 200, y: 300}, frame), {x: 0.25, y: 0.25, w: 0.5, h: 0.5});
  assert.deepEqual(M.fromGesture('arrow', {x: -20, y: 0}, {x: 900, y: 400}, frame), {x: 0, y: 0, w: 0, h: 0, to: {x: 1, y: 1}});
  const pen = M.fromGesture('pen', {x: 80, y: 40}, null, frame, [{x: 80, y: 40}, {x: 160, y: 80}, {x: 120, y: 200}]);
  assert.deepEqual(pen.points, [{x: 0.1, y: 0.1}, {x: 0.2, y: 0.2}, {x: 0.15, y: 0.5}]);
  assert.deepEqual([pen.x, pen.y, pen.w, pen.h], [0.1, 0.1, 0.1, 0.4]);
  assert.deepEqual(M.fromGesture('step', {x: 400, y: 200}, null, frame), {x: 0.5, y: 0.5, w: 0, h: 0});
});

test('平移不出画面，点列与终点一起挪；把手：框八枚、线两端、点没有；拖把手改框不小于 1%', () => {
  const line = {kind: 'arrow', x: 0.8, y: 0.8, w: 0, h: 0, to: {x: 0.9, y: 0.9}};
  const moved = M.move(line, 0.5, -0.2);
  assert.deepEqual([moved.x, moved.y, moved.to], [0.9, 0.6, {x: 1, y: 0.7}]);
  const pen = {kind: 'pen', x: 0, y: 0, w: 0.2, h: 0.2, points: [{x: 0, y: 0}, {x: 0.2, y: 0.2}]};
  assert.deepEqual(M.move(pen, -0.5, 0.1).points, [{x: 0, y: 0.1}, {x: 0.2, y: 0.3}]);
  const box = {kind: 'rect', x: 0.2, y: 0.2, w: 0.4, h: 0.2};
  assert.deepEqual(M.handles(box).map(h => h.k), M.BOX_HANDLES);
  assert.deepEqual(M.handles(box)[4], {k: 'se', x: 0.6, y: 0.4});
  assert.deepEqual(M.handles(line).map(h => h.k), ['from', 'to']);
  assert.deepEqual(M.handles({kind: 'step', x: 0.5, y: 0.5, w: 0, h: 0}), []);
  assert.deepEqual(M.resize(box, 'se', 0.1, 0.1), {kind: 'rect', x: 0.2, y: 0.2, w: 0.5, h: 0.3});
  assert.deepEqual(M.resize(box, 'nw', 0.1, -0.5), {kind: 'rect', x: 0.3, y: 0, w: 0.3, h: 0.4});
  assert.equal(M.resize(box, 'e', -0.9, 0).w, 0.01);
  assert.deepEqual(M.resize(line, 'to', 0.5, 0.5).to, {x: 1, y: 1});
});

test('编号按加入顺序从 1 起；没写字的文字标记不发；一条标记说成话', () => {
  let s = M.add(M.init(), {id: 's1', kind: 'step', x: 0.1, y: 0.1, w: 0, h: 0});
  s = M.add(s, {id: 't', kind: 'text', x: 0.3, y: 0.3, w: 0, h: 0, text: ''});
  s = M.add(s, {id: 's2', kind: 'step', x: 0.2, y: 0.2, w: 0, h: 0});
  assert.deepEqual([M.stepNumber(s.marks, 's1'), M.stepNumber(s.marks, 's2'), M.stepNumber(s.marks, 't')], [1, 2, null]);
  assert.deepEqual(M.sendable(s.marks).map(m => m.id), ['s1', 's2']);
  assert.equal(M.describe(s.marks[2], s.marks), '编号 2');
  assert.equal(M.describe({kind: 'rect', color: 'red'}), '红色矩形');
  assert.equal(M.describe({kind: 'element', element: {label: '字幕 · “你好”', kind: 'caption', text: '你好'}}), '字幕 · “你好”');
});

test('元素说成话：字幕 / 元素带原文，HTML 节点带选择器、尺寸与可访问名；给模型的 detail 是英文', () => {
  assert.equal(M.elementLabel({kind: 'caption', id: 'c3', text: '对所以我们把整条链路搬到了本机'}), '字幕 · “对所以我们把整条链路搬到了本机”');
  assert.equal(M.elementLabel({kind: 'html', selector: 'button#play.bc-icon-button', w: 32, h: 32, name: '播放', role: 'button'}), 'button#play.bc-icon-button · 32 × 32');
  assert.equal(M.elementDetail({kind: 'html', selector: 'button#play', w: 32, h: 32, name: '播放', role: 'button'}), 'html button#play 32×32 name="播放" role=button');
  assert.equal(M.elementDetail({kind: 'caption', id: 'c3', text: '你好'}), 'caption c3 "你好"');
});

test('整组换成视频标注：矩形是 box、编号是 pin，带颜色粗细，文字与评论的内容进批注，别的批注为空；评论带印章截图', () => {
  let s = M.add(M.init(), {id: 'a', kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2});
  s = M.add(s, {id: 'b', kind: 'step', x: 0.5, y: 0.5, w: 0, h: 0});
  s = M.add(s, {id: 'c', kind: 'text', x: 0.6, y: 0.6, w: 0, h: 0, text: ' 字太小 '});
  s = M.add(s, {id: 'd', kind: 'text', x: 0.7, y: 0.7, w: 0, h: 0, text: ''});
  s = M.add(s, {id: 'e', kind: 'element', x: 0.2, y: 0.8, w: 0.6, h: 0.1, element: {kind: 'caption', id: 'c3', label: '字幕 · “你好”', detail: 'caption c3 "你好"'}});
  s = M.add(s, {id: 'f', kind: 'comment', x: 0.4, y: 0.3, w: 0, h: 0, text: '这里慢一点'});
  s = M.add(s, {id: 'g', kind: 'comment', x: 0.5, y: 0.3, w: 0, h: 0, text: ''});
  assert.deepEqual(M.sendable(s.marks).map(m => m.id), ['a', 'b', 'c', 'e', 'f']);
  assert.equal(M.describe(s.marks[5]), '评论 · “这里慢一点”');
  const notes = M.toNotes(s.marks, {video: 'p15', revision: 2, timeMs: 1000}, n => `${n.kind}@${n.region.x}`);
  assert.deepEqual(notes.map(n => n.kind), ['box', 'pin', 'text', 'element', 'comment']);
  assert.deepEqual(notes[4].shot, {timeMs: 1000, stamp: {x: 0.4, y: 0.3}});
  assert.equal(notes[0].shot, undefined);
  assert.deepEqual(notes[0].style, {color: 'red', width: 4});
  assert.deepEqual([notes[0].text, notes[2].text, notes[0].label, notes[0].video], ['', '字太小', 'box@0.1', 'p15']);
  assert.deepEqual(notes[3].element.detail, 'caption c3 "你好"');
});
