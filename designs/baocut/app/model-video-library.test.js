const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./model-video-library.js');

test('10万条视频只挂载视口和缓冲行，末尾与空列表不越界', () => {
  for (const top of [0, 480, 540000, 9599500]) {
    const w = V.windowFor(100000, top, 480);
    assert.ok(w.end - w.start <= 12);
    assert.ok(w.start >= 0 && w.end <= 100000);
    assert.equal(w.height, 9600000);
  }
  assert.deepEqual(V.windowFor(0, 0, 480), {start: 0, end: 0, height: 0});
  assert.deepEqual(V.windowFor(2, 9999, 480), {start: 2, end: 2, height: 192});
});

test('只有真实媒体URL可播放，不把本地路径、原源或重构图元数据伪装成预览', () => {
  assert.equal(V.previewUrl({url: 'https://media.example.test/video.mp4'}), 'https://media.example.test/video.mp4');
  assert.equal(V.previewUrl({url: 'blob:preview'}), 'blob:preview');
  for (const source of [{path: '/private/video.mp4'}, {url: 'file:///private/video.mp4'}, {url: 'javascript:alert(1)'}, {crop: {sourceId: 'v1'}}]) {
    assert.equal(V.previewUrl(source), null);
  }
});

test('使用状态读取有效元素文档，支持源ID及文件名引用', () => {
  const index = V.usageIndex([{id: 'a', kind: 'video', asset: 'old.mp4'}, {id: 'b', kind: 'video', sourceId: 'v3'}],
    {a: {asset: 'new.mp4', srcId: 'v2'}});
  assert.equal(V.usage({id: 'v0', name: 'main.mp4'}, index), '未使用', '没有「主视频」捷径：转录源不被引用时也是未使用');
  assert.equal(V.usage({id: 'v2', name: 'renamed.mp4'}, index), '已在时间轴');
  assert.equal(V.usage({id: 'v3', name: 'other.mp4'}, index), '已在时间轴');
  assert.equal(V.usage({id: 'v4', name: 'old.mp4'}, index), '未使用');
});
