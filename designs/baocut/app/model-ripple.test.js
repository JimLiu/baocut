const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-ripple.js');
const R = window.BC_RIPPLE;

test('merge：按起点排序，相接的并成一段', () => {
  assert.deepEqual(R.merge([{start: 5, end: 8}, {start: 0, end: 2}, {start: 2, end: 3}, {start: 7, end: 9}]),
    [{start: 0, end: 3}, {start: 5, end: 9}]);
  assert.deepEqual(R.merge([]), []);
});

test('gapsAfterDelete：所有轨道都空了才合拢；只空一条轨不动', () => {
  /* 删掉 0–28 的视频，字幕还在：没有可合拢的空隙 */
  assert.deepEqual(R.gapsAfterDelete([{start: 0, end: 28}], [{start: 1, end: 5}, {start: 6, end: 27}, {start: 28, end: 206}]),
    [{start: 0, end: 1}, {start: 5, end: 6}, {start: 27, end: 28}]);
  assert.deepEqual(R.gapsAfterDelete([{start: 0, end: 28}], [{start: 0, end: 30}]), []);
  /* 视频与字幕一起删：整段合拢 */
  assert.deepEqual(R.gapsAfterDelete([{start: 0, end: 28}, {start: 0.5, end: 27.5}], [{start: 28, end: 206}]),
    [{start: 0, end: 28}]);
  /* 浮点缝不算空隙 */
  assert.deepEqual(R.gapsAfterDelete([{start: 10, end: 20}], [{start: 0, end: 10.01}, {start: 10.02, end: 30}]), []);
});

test('cutItem：段前不动、段后前移、段内删掉、跨缘裁掉段里的部分', () => {
  const it = (start, end, extra) => Object.assign({id: 'x', start, end}, extra);
  assert.deepEqual(R.cutItem(it(0, 5), 10, 20), [it(0, 5)]);
  assert.deepEqual(R.cutItem(it(25, 30), 10, 20), [it(15, 20)]);
  assert.deepEqual(R.cutItem(it(12, 18), 10, 20), []);
  assert.deepEqual(R.cutItem(it(5, 15), 10, 20), [it(5, 10)]);
  assert.deepEqual(R.cutItem(it(15, 25), 10, 20), [it(10, 15)]);
  /* 没有源时钟：整段落在里面只缩短 */
  assert.deepEqual(R.cutItem(it(5, 25), 10, 20), [it(5, 15)]);
  /* 媒体：跨右缘推进 srcStart，整段落在里面切成两件 */
  assert.deepEqual(R.cutItem(it(15, 25, {srcStart: 100}), 10, 20, {media: true}), [it(10, 15, {srcStart: 105})]);
  assert.deepEqual(R.cutItem(it(5, 25, {srcStart: 100, rate: 2}), 10, 20, {media: true, splitId: 'y'}),
    [it(5, 10, {srcStart: 100, rate: 2}), {id: 'y', start: 10, end: 15, srcStart: 130, rate: 2}]);
  /* 铺到片尾（end 为 null）的只挪起点 */
  assert.deepEqual(R.cutItem(it(25, null), 10, 20), [it(15, null)]);
});

test('removeSpans：多段从右往左处理，元素、字幕与章节一起前移', () => {
  const elements = [
    {id: 'v1', kind: 'video', start: 0, end: 28, srcStart: 0},
    {id: 'v2', kind: 'video', start: 28, end: 45, srcStart: 28},
    {id: 'v3', kind: 'video', start: 45, end: 78, srcStart: 45},
    {id: 't', kind: 'text', start: 40, end: 50},
  ];
  const cues = [{id: 'c1', start: 1, end: 3}, {id: 'c2', start: 29, end: 31}, {id: 'c3', start: 60, end: 62}];
  const chapters = [{id: 'h1', start: 0, end: 22}, {id: 'h2', start: 22, end: 78}];
  const r = R.removeSpans({elements, cues, chapters}, [{start: 0, end: 28}, {start: 50, end: 55}],
    {splitId: (el) => el.id + '-r'});
  assert.equal(r.closed, 33);
  assert.deepEqual(r.removed, ['v1']);
  assert.deepEqual(r.elements, [
    {id: 'v2', kind: 'video', start: 0, end: 17, srcStart: 28},
    {id: 'v3', kind: 'video', start: 17, end: 22, srcStart: 45},
    {id: 'v3-r', kind: 'video', start: 22, end: 45, srcStart: 55},
    {id: 't', kind: 'text', start: 12, end: 22},
  ]);
  assert.deepEqual(r.cues, [{id: 'c2', start: 1, end: 3}, {id: 'c3', start: 27, end: 29}]);
  assert.deepEqual(r.chapters, [{id: 'h2', start: 0, end: 45}]);
});

test('shiftTime：播放头段前不动、段里回到段首、段后前移', () => {
  const spans = [{start: 10, end: 20}, {start: 40, end: 45}];
  assert.equal(R.shiftTime(5, spans), 5);
  assert.equal(R.shiftTime(15, spans), 10);
  assert.equal(R.shiftTime(30, spans), 20);
  assert.equal(R.shiftTime(42, spans), 30);
  assert.equal(R.shiftTime(50, spans), 35);
});

test('cueCover：原有停顿算占着，删掉句子空出来的才算空', () => {
  const cues = [{id: 'a', start: 0.5, end: 3}, {id: 'b', start: 3.4, end: 6}, {id: 'c', start: 7, end: 9}];
  // 只删视频：句间停顿与片头片尾都算占着，删掉的 [0, 10] 没有一处空
  assert.deepEqual(R.gapsAfterDelete([{start: 0, end: 10}], R.cueCover(cues, [], 10)), []);
  // 连前两句一起删：片头到第三句之前都空了；第三句之后到片尾仍算占着
  assert.deepEqual(R.gapsAfterDelete([{start: 0, end: 10}], R.cueCover(cues, ['a', 'b'], 10)), [{start: 0, end: 7}]);
  // 删中间一句：两侧的停顿不再桥接，那一段空出来
  assert.deepEqual(R.gapsAfterDelete([{start: 3, end: 7}], R.cueCover(cues, ['b'], 10)), [{start: 3, end: 7}]);
});
