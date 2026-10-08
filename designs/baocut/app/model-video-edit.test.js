const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-video-edit.js');

test('远程视频定位守恒源偏移，移动或拆分后不从头播放', () => {
  const time = window.BC_VIDEO_EDIT.sourceTime;
  assert.equal(time({start: 0, srcStart: 0}, 12.4), 12.4);
  assert.equal(time({start: 20, srcStart: 8}, 23), 11);
  assert.equal(time({start: 20, srcStart: 8}, 0), 0);
});
test('initial videos have independent ordinary element identities and poses', () => {
  const clips = [{id:'k1',start:0,end:4,src:2},{id:'k2',start:4,end:10,src:8}];
  const videos = window.BC_VIDEO_EDIT.initial(clips,'source.mp4');
  assert.equal(videos[0].kind,'video');
  assert.equal(videos[0].srcStart,2);
  assert.equal(videos[0].fromSource,true);
  videos[0].place.x=20;
  assert.equal(videos[1].place.x,50);
  videos.splice(0,1);
  assert.equal(clips.length,2);
});

test('splitElementAt：左半留 id 收尾到 t，右半新 id、start = t、srcStart 按 rate 推进，摆位样式原样复制', () => {
  const VE = window.BC_VIDEO_EDIT;
  const els = [{id: 'v1', kind: 'video', start: 10, end: 30, srcStart: 5, rate: 2, place: {x: 50, y: 50, w: 100}}];
  const docs = {v1: {start: 10, end: 30, pose: {x: 40}, style: {vol: 60}, muted: true}};
  const r = VE.splitElementAt(els, docs, 'v1', 18);
  assert.deepEqual(r.left, {id: 'v1', end: 18});
  assert.equal(r.right.id, 'v1-s1800');
  assert.equal(r.right.start, 18);
  assert.equal(r.right.end, 30);
  assert.equal(r.right.srcStart, 5 + (18 - 10) * 2, '源偏移按倍速推进');
  assert.equal(r.right.muted, true);
  assert.deepEqual(r.right.pose, {x: 40});
  assert.deepEqual(r.right.style, {vol: 60});
  assert.equal(VE.splitElementAt(els, docs, 'v1', 18, {id: 'x'}).right.id, 'x');
  assert.equal(VE.splitElementAt(els, docs, 'v1', 10.01), null, '离头太近不切');
  assert.equal(VE.splitElementAt(els, docs, 'v1', 29.99), null, '离尾太近不切');
  assert.equal(VE.splitElementAt(els, docs, 'v1', 40), null, '播放头不在段内');
  assert.equal(VE.splitElementAt([{id: 's', kind: 'sticker', start: 0, end: 9}], {}, 's', 4), null, '只切视频');
  assert.equal(VE.splitElementAt(els, docs, 'nope', 18), null);
});

test('splitTarget：选中的视频压在播放头上就切它，否则取最上层压在播放头上的视频；停用的不算', () => {
  const VE = window.BC_VIDEO_EDIT;
  const els = [
    {id: 'a', kind: 'video', start: 0, end: 20},
    {id: 'b', kind: 'video', start: 5, end: 15},
    {id: 'st', kind: 'sticker', start: 0, end: 20},
  ];
  assert.equal(VE.splitTarget(els, {}, 10, null).id, 'b', '最上层（元素表靠后）');
  assert.equal(VE.splitTarget(els, {}, 10, 'a').id, 'a', '选中的优先');
  assert.equal(VE.splitTarget(els, {}, 10, 'st').id, 'b', '选中的不是视频就退回最上层');
  assert.equal(VE.splitTarget(els, {b: {hidden: true}}, 10).id, 'a', '停用的不算');
  assert.equal(VE.splitTarget(els, {}, 18).id, 'a');
  assert.equal(VE.splitTarget(els, {}, 30), null);
  assert.equal(VE.splitTarget([], {}, 3), null);
});
