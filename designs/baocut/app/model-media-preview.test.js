const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-media-preview.js');
const M = window.BC_MEDIA_PREVIEW;

test('图片和视频扩展名支持大小写、查询串和片段', () => {
  assert.equal(M.kind('封面/cover.SVG'), 'image');
  assert.equal(M.kind('https://example.com/out.mp4?download=1#t=2'), 'video');
  assert.equal(M.kind('data.json'), null);
});
test('候选组不混入其它会话、项目、独立图片和回收站', () => {
  const a = {id: 'a', file: 'a.svg', previewGroup: 'one', dir: 'd1', session: 's1'};
  const b = {...a, id: 'b', file: 'b.svg'};
  const otherSession = {...b, id: 's2', session: 's2'}, otherDir = {...b, id: 'd2', dir: 'd2'};
  const single = {...a, id: 'single', previewGroup: null};
  assert.deepEqual(M.gallery(a, [a, b, otherSession, otherDir, single, {...b, id: 'trash', trashed: true}]).map(i => i.id), ['a', 'b']);
  assert.deepEqual(M.gallery(single, [a, b, single]), [single]);
});
test('图片批注用归一化坐标，反向框选与缩放不会改变区域', () => {
  const a = M.point({x: 160, y: 110}, {left: 100, top: 50, width: 300, height: 200});
  const b = M.point({x: 220, y: 170}, {left: 100, top: 50, width: 600, height: 400});
  assert.deepEqual(a, {x: .2, y: .3}); assert.deepEqual(b, a);
  assert.deepEqual(M.region({x: .8, y: .7}, {x: .2, y: .3}), {x: .2, y: .3, width: .6000000000000001, height: .39999999999999997});
  assert.deepEqual(M.point({x: 1000, y: -1}, {left: 0, top: 0, width: 100, height: 100}), {x: 1, y: 0});
  assert.equal(M.point({x: 0, y: 0}, {left: 0, top: 0, width: 0, height: 100}), null);
});
test('缩放有边界；适合窗口保持比例且不放大原图', () => {
  assert.equal(M.fit({width: 960, height: 600}, {width: 528, height: 348}), .5);
  assert.equal(M.fit({width: 960, height: 600}, {width: 2000, height: 1400}), 1);
  assert.equal(M.zoomStep(400, 1), 400); assert.equal(M.zoomStep(10, -1), 10);
});
test('批注和比例请求保留原图，并追加到原有草稿', () => {
  const file = {file: '封面/候选-a.svg'};
  const request = M.commentPrompt(file, [{text: '减小标题', region: {x: .1, y: .2, width: .3, height: .4}}]);
  assert.match(request, /10%, 20%/); assert.match(request, /减小标题/); assert.match(request, /保留原图/);
  assert.equal(M.resizePrompt(file, '5:9'), null);
  assert.match(M.resizePrompt(file, '9:16'), /9:16/);
  assert.equal(M.appendDraft('原有文字', request), '原有文字\n\n' + request);
});

test('连续缩放有限且双指缩放保留比例', () => {
  assert.equal(M.pinchZoom(100, 20, 40), 200);
  assert.equal(M.pinchZoom(100, 0, 50), 100);
  assert.equal(M.wheelZoom(100, -9999), 400);
  assert.equal(M.wheelZoom(100, 9999), 10);
});
test('批量附件去重，超额整体失败，既有草稿不截掉空白', () => {
  const existing = [{url: 'a'}];
  assert.deepEqual(M.mergeAttachments(existing, [{url: 'a'}, {url: 'b'}]), [{url:'a'}, {url:'b'}]);
  assert.throws(() => M.mergeAttachments(existing, [{url:'b'}], 1), /最多/);
  assert.deepEqual(existing, [{url:'a'}]);
  assert.equal(M.appendDraft(' old \n', 'new'), ' old \n\n\nnew');
});

test('音频内嵌预览识别常见格式，复制路径保留项目来源和绝对路径', () => {
  for (const extension of ['WAV', 'mp3', 'm4a', 'flac', 'aac', 'ogg', 'opus']) assert.equal(M.kind(`audio.${extension}?v=1`), 'audio');
  assert.equal(M.filePath({file: '音频/demo.wav'}, '~/BaoCut/示例/'), '~/BaoCut/示例/音频/demo.wav');
  assert.equal(M.filePath({file: '/tmp/demo.wav'}, '/project'), '/tmp/demo.wav');
  assert.equal(M.filePath({file: 'C:\\Audio\\demo.wav'}, '/project'), 'C:\\Audio\\demo.wav');
});

test('缩略图方向键与首尾键在当前组内切换，边界不循环', () => {
  assert.equal(M.galleryKey(0, 4, 'ArrowUp'), 0);
  assert.equal(M.galleryKey(3, 4, 'ArrowDown'), 3);
  assert.equal(M.galleryKey(1, 4, 'ArrowRight'), 2);
  assert.equal(M.galleryKey(1, 4, 'Home'), 0);
  assert.equal(M.galleryKey(1, 4, 'End'), 3);
  assert.equal(M.galleryKey(0, 0, 'End'), null);
  assert.equal(M.galleryKey(0, 4, 'Enter'), null);
});
