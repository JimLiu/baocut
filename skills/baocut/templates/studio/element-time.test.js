const test = require('node:test');
const assert = require('node:assert');

const ET = require('./element-time.js');

test('整片判定按值做：投影里 start/end 已被求值成 0 与片尾', () => {
  assert.equal(ET.isWholeVideo({ start: 0, end: 175 }, 175), true);
  assert.equal(ET.isWholeVideo({ start: 0, end: 174.98 }, 175), true);
  assert.equal(ET.isWholeVideo({ start: 2, end: 175 }, 175), false);
  assert.equal(ET.isWholeVideo({ start: 0, end: 8 }, 175), false);
});

test('整片开关写 null 删键，关掉落成显式 0…片尾', () => {
  assert.deepEqual(ET.wholePatch(true, 175), { start: null, end: null });
  assert.deepEqual(ET.wholePatch(false, 175), { start: 0, end: 175 });
  // 极短片子也不能造出 end <= start 的窗口
  assert.deepEqual(ET.wholePatch(false, 0), { start: 0, end: 0.5 });
});

test('时间文本：m:ss.s 与纯秒都能读，非法输入回 null', () => {
  assert.equal(ET.formatTime(83.45), '01:23.5');
  assert.equal(ET.formatTime(3723.1), '01:02:03.1');
  assert.equal(ET.formatTime(-5), '00:00.0');
  assert.equal(ET.parseTime('1:23.5'), 83.5);
  assert.equal(ET.parseTime('01:23'), 83);
  assert.equal(ET.parseTime('83.5'), 83.5);
  assert.equal(ET.parseTime('1:02:03.1'), 3723.1);
  assert.equal(ET.parseTime('1:75'), null);
  assert.equal(ET.parseTime('abc'), null);
  assert.equal(ET.parseTime(''), null);
});

test('两端钳制：不交叉、不短于 MIN_SPAN、不出片尾', () => {
  const element = { start: 2, end: 8 };
  assert.deepEqual(ET.startPatch(element, -3, 175), { start: 0 });
  assert.deepEqual(ET.startPatch(element, 9, 175), { start: 7.5 });
  assert.deepEqual(ET.endPatch(element, 1, 175), { end: 2.5 });
  assert.deepEqual(ET.endPatch(element, 900, 175), { end: 175 });
  assert.deepEqual(ET.spanPatch(element, { start: 4, end: 4.1 }, 175), { start: 4, end: 4.5 });
});

test('拖块保持时长，越过片尾时整段贴到片尾', () => {
  assert.deepEqual(ET.movedSpan({ start: 2, end: 8 }, 5, 175), { start: 7, end: 13 });
  assert.deepEqual(ET.movedSpan({ start: 2, end: 8 }, -10, 175), { start: 0, end: 6 });
  assert.deepEqual(ET.movedSpan({ start: 170, end: 174 }, 20, 175), { start: 171, end: 175 });
});

test('裁边只动一端', () => {
  assert.deepEqual(ET.resizedSpan({ start: 2, end: 8 }, 'l', 1, 175), { start: 3, end: 8 });
  assert.deepEqual(ET.resizedSpan({ start: 2, end: 8 }, 'r', -1, 175), { start: 2, end: 7 });
  // 拖过头也不许翻转
  assert.deepEqual(ET.resizedSpan({ start: 2, end: 8 }, 'l', 100, 175), { start: 7.5, end: 8 });
});

test('mergePatch 与服务端同语义：对象递归合并、null 留作删除标记', () => {
  const merged = ET.mergePatch({ place: { x: 50, y: 40 }, style: { bold: true } }, { place: { y: 60 } });
  assert.deepEqual(merged, { place: { x: 50, y: 60 }, style: { bold: true } });
  assert.deepEqual(ET.mergePatch({ start: 2 }, { start: null }), { start: null });
  // 后一次草稿覆盖前一次的 null
  assert.deepEqual(ET.mergePatch(ET.mergePatch(null, { start: null }), { start: 3 }), { start: 3 });
  // 数组与标量整值替换
  assert.deepEqual(ET.mergePatch({ a: { b: 1 } }, { a: 2 }), { a: 2 });
});

test('草稿叠加：命中的元素合并、null 键真的消失，其它轨道原样返回', () => {
  const tracks = [
    { id: 'overlay', elements: [{ id: 'el-1', start: 2, end: 8, place: { x: 50, y: 40 } }] },
    { id: 'wm', elements: [{ id: 'el-2', start: 0, end: 175 }] },
  ];
  const next = ET.applyDraftToTracks(tracks, { id: 'el-1', set: { start: null, end: null, place: { y: 70 } } });
  assert.deepEqual(next[0].elements[0], { id: 'el-1', place: { x: 50, y: 70 } });
  assert.equal(next[1], tracks[1]);          // 未命中的轨道保持同一引用
  assert.equal(tracks[0].elements[0].start, 2); // 原对象不被改写
  // 找不到 id 时原样返回，避免无意义的重渲染
  assert.equal(ET.applyDraftToTracks(tracks, { id: 'nope', set: { start: 1 } }), tracks);
  assert.deepEqual(ET.applyDraftToTracks(tracks, null), tracks);
});

test('九宫对齐：知道宽度就按半宽贴边，不知道给保守内缩', () => {
  assert.deepEqual(ET.alignPlace('left', { place: { w: 34 } }, 16 / 9), { x: 17 });
  assert.deepEqual(ET.alignPlace('right', { place: { w: 34 } }, 16 / 9), { x: 83 });
  assert.deepEqual(ET.alignPlace('center', { place: { w: 34 } }, 16 / 9), { x: 50 });
  assert.deepEqual(ET.alignPlace('left', { place: {} }, 16 / 9), { x: 12 });
  assert.deepEqual(ET.alignPlace('middle', { place: {} }, 16 / 9), { y: 50 });
  // 超宽元素不许把锚点推出画面
  assert.deepEqual(ET.alignPlace('left', { place: { w: 100, scale: 2 } }, 16 / 9), { x: 45 });
});
