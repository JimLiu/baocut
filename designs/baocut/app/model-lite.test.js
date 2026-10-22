const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-lite.js');
const L = global.window.BC_LITE;

const cues = [
  {id: 'g1', start: 0, end: 5, text: '第一句', trans: 'one'},
  {id: 'g2', start: 5.2, end: 11, text: '第二句', trans: 'two'},
  {id: 'g3', start: 14, end: 20, text: '第三句', trans: 'three'},
  {id: 'g4', start: 20.5, end: 26, text: '第四句', trans: 'four'},
];

test('场景表优先：句子换成序列时间，素材按种类列出', () => {
  const segs = L.segments({scenes: [
    {id: 's01', title: '钩子', start: 0, end: 22, script: '# 钩子', bundle: 'bundles/s01', narration: 'audio/s01.wav',
      lines: [{start: 0.3, end: 3.9, text: '一辆车'}, {start: 4.2, end: 9, text: '它没掉下来'}],
      footage: [{src: 'clips/hang.mp4', at: 4.2, dur: 2.4, label: '画面：发布会'}], images: ['ref/fig1.png']},
    {id: 'intro', title: '开场', start: 22, end: 26},
  ], chapters: [{id: 'c1', title: '不该用的章节', start: 0, end: 26}], cues, duration: 26});
  assert.equal(segs.length, 2);
  assert.equal(segs[0].source, 'scene');
  assert.deepEqual(segs[0].lines.map(l => [l.start, l.end]), [[0.3, 3.9], [4.2, 9]]);
  assert.deepEqual(segs[0].assets.map(a => a.kind), ['bundle', 'audio', 'footage', 'image']);
  assert.equal(segs[0].footage[0].at, 4.2);
  assert.equal(segs[1].lines.length, 0);
  assert.equal(segs[1].index, 1);
});

test('没有场景表：章节标记成段，句子按中点归章', () => {
  const segs = L.segments({chapters: [{id: 'c1', title: '开场', start: 0, end: 12}, {id: 'c2', title: '正文', start: 12, end: 26}], cues, duration: 26});
  assert.equal(segs[0].source, 'chapter');
  assert.deepEqual(segs[0].lines.map(l => l.id), ['g1', 'g2']);
  assert.deepEqual(segs[1].lines.map(l => l.id), ['g3', 'g4']);
  assert.equal(segs[1].lines[0].trans, 'three');
});

test('没有章节：按旁白停顿分段，首段从 0 起、末段到片尾', () => {
  const segs = L.segments({cues, duration: 30});
  assert.equal(segs.length, 2);
  assert.equal(segs[0].source, 'speech');
  assert.deepEqual([segs[0].start, segs[0].end], [0, 14]);
  assert.deepEqual([segs[1].start, segs[1].end], [14, 30]);
  assert.equal(segs[0].title, '第一句');
});

test('什么都没有：整条一段，标题是视频名', () => {
  const segs = L.segments({duration: 30, title: '一部视频'});
  assert.equal(segs.length, 1);
  assert.equal(segs[0].source, 'whole');
  assert.deepEqual([segs[0].start, segs[0].end, segs[0].title], [0, 30, '一部视频']);
});

test('空章节（end 不大于 start）不成段', () => {
  const segs = L.segments({chapters: [{id: 'c1', title: 'x', start: 5, end: 5}], cues, duration: 30});
  assert.equal(segs[0].source, 'speech');
});

test('播放头在哪一段、哪一句', () => {
  const segs = L.segments({chapters: [{id: 'c1', title: '开场', start: 0, end: 12}, {id: 'c2', title: '正文', start: 12, end: 26}], cues, duration: 26});
  assert.equal(L.segmentAt(segs, 0).id, 'c1');
  assert.equal(L.segmentAt(segs, 12).id, 'c2');
  assert.equal(L.segmentAt(segs, 26).id, 'c2');
  assert.equal(L.segmentAt(segs, 27), null);
  assert.equal(L.lineAt(segs[0].lines, 5.1).id, 'g1');
  assert.equal(L.lineAt(segs[0].lines, 5.2).id, 'g2');
  assert.equal(L.lineAt(segs[1].lines, 13), null);
  assert.equal(L.prevStart(segs, 13), 12);
  assert.equal(L.prevStart(segs, 12), 0);
  assert.equal(L.nextStart(segs, 0), 12);
  assert.equal(L.nextStart(segs, 20), null);
});

test('段条：比例、已播、当前段与时长标签', () => {
  const segs = L.segments({chapters: [{id: 'c1', title: '开场', start: 0, end: 20}, {id: 'c2', title: '正文', start: 20, end: 100}], duration: 100});
  const bar = L.barSpans(segs, 30, 100);
  assert.deepEqual(bar.map(b => b.flex), [0.2, 0.8]);
  assert.deepEqual(bar.map(b => b.done), [1, 0.125]);
  assert.deepEqual(bar.map(b => b.current), [false, true]);
  assert.deepEqual(bar.map(b => b.label), ['20s', '1:20']);
});

test('图层开关只按实际有的轨道生成', () => {
  assert.deepEqual(L.layers({}), []);
  const all = L.layers({captions: [{id: 'zh', label: '中文字幕'}, {id: 'en', label: '英文译文'}], footage: true, sourceLabels: true, watermark: true, music: true,
    overlays: [{id: 'sticker', label: '贴纸'}]});
  assert.deepEqual(all.map(l => l.key), ['caption:zh', 'caption:en', 'footage', 'overlay:sticker', 'source-labels', 'watermark', 'music']);
  assert.deepEqual([...new Set(all.map(l => l.section))], ['captions', 'picture', 'sound']);
});

test('默认视图：不分种类一律审片（2026-10-21）', () => {
  for (const proj of [{scenes: [{}]}, {entry: 'trans'}, {focus: 'elements'}, {preview: {url: 'x'}}, null]) assert.equal(L.defaultViewByKind(proj), 'lite');
});

test('打开时的视图：URL > 这部视频的记忆 > 全局默认 > 审片', () => {
  const proj = {id: 'p1', focus: 'elements'};
  assert.equal(L.viewFor(proj, {}, null), 'lite');
  assert.equal(L.viewFor(proj, {editorViewDefault: 'timeline'}, null), 'timeline');
  assert.equal(L.viewFor(proj, {editorViewDefault: 'timeline', editorViewByVideo: {p1: 'lite'}}, null), 'lite');
  assert.equal(L.viewFor(proj, {editorViewByVideo: {p1: 'lite'}}, 'timeline'), 'timeline');
  assert.equal(L.viewFor(proj, {}, 'bogus'), 'lite');
});

test('记住选择：按视频记；设为默认时同时写全局', () => {
  const a = L.remember({editorViewByVideo: {p2: 'lite'}}, 'p1', 'timeline', false);
  assert.deepEqual(a, {editorViewByVideo: {p2: 'lite', p1: 'timeline'}});
  const b = L.remember({}, 'p1', 'timeline', true);
  assert.deepEqual(b, {editorViewByVideo: {p1: 'timeline'}, editorViewDefault: 'timeline'});
});

test('标注落点：哪一段、哪一句，与给人看的写法', () => {
  const segs = L.segments({scenes: [{id: 's03', title: '问题 1', start: 60, end: 90, lines: [{start: 0, end: 4, text: '甲'}, {start: 4.5, end: 9, text: '乙'}]}]});
  const c = L.noteContext(segs, 65);
  assert.deepEqual(c.segment, {id: 's03', kind: 'scene', index: 0, title: '问题 1'});
  assert.deepEqual(c.line, {id: 's03:l2', index: 2, text: '乙'});
  assert.equal(L.contextLabel(c), 's03 · 第 2 句');
  assert.deepEqual(L.noteContext(segs, 10), {});
  assert.equal(L.contextLabel({}), '');
});

test('片式段条：播放头只落在当前片上，拖边预览把后面的场景推开', () => {
  const segs = L.segments({scenes: [
    {id: 'a', title: 'A', start: 0, end: 10, lines: [{start: 0, end: 8, text: 'x'}]},
    {id: 'b', title: 'B', start: 10, end: 20},
  ], duration: 20});
  const chips = L.chipSpans(segs, 12, 20, 15, null);
  assert.deepEqual(chips.map(c => c.head), [null, 0.2]);
  assert.deepEqual(chips.map(c => c.hover), [null, 0.5]);
  assert.deepEqual(chips.map(c => c.resizable), [true, true]);
  const dragged = L.chipSpans(segs, 12, 20, null, {index: 0, end: 15});
  assert.deepEqual(dragged.map(c => [c.start, c.end]), [[0, 15], [15, 25]]);
  assert.ok(Math.abs(dragged[0].flex - 15 / 25) < 1e-9);
});

test('场景改时长：不能短过旁白末句 + tail，后面的场景与字幕整体平移', () => {
  const scenes = [
    {id: 'a', title: 'A', start: 0, end: 10, lines: [{start: 0, end: 8, text: 'x'}]},
    {id: 'b', title: 'B', start: 10, end: 20, lines: [{start: 1, end: 3, text: 'y'}]},
  ];
  assert.equal(L.minSceneLength(scenes[0]), 8.4);
  const shrink = L.retimeScene(scenes, 0, 5);
  assert.equal(shrink.scenes[0].end, 8.4);
  assert.equal(shrink.delta, -1.6);
  assert.deepEqual([shrink.scenes[1].start, shrink.scenes[1].end], [8.4, 18.4]);
  assert.equal(shrink.scenes[0].durationOwner, 'user');
  assert.equal(L.retimeScene(scenes, 0, 10), null);
  const grow = L.retimeScene(scenes, 0, 12.5);
  assert.deepEqual(L.chaptersOf(grow.scenes).map(c => [c.start, c.end]), [[0, 12.5], [12.5, 22.5]]);
  const cues = [{id: 'c1', start: 2, end: 4}, {id: 'c2', start: 11, end: 13}];
  assert.deepEqual(L.shiftAfter(cues, 10, grow.delta).map(c => [c.start, c.end]), [[2, 4], [13.5, 15.5]]);
});

test('拖边的范围：场景到旁白末句 + tail 为止、没有上限；章节两边各留 1 秒；末章没有', () => {
  const sc = L.segments({scenes: [
    {id: 'a', title: 'A', start: 0, end: 10, lines: [{start: 0, end: 8, text: 'x'}]},
    {id: 'b', title: 'B', start: 10, end: 20},
  ], duration: 20});
  assert.deepEqual(L.resizeBounds(sc, 0), {min: 8.4, max: Infinity});
  assert.deepEqual(L.resizeBounds(sc, 1), {min: 11, max: Infinity});
  const ch = L.segments({chapters: [{id: 'c1', title: '一', start: 0, end: 10}, {id: 'c2', title: '二', start: 10, end: 20}], duration: 20});
  assert.deepEqual(L.resizeBounds(ch, 0), {min: 1, max: 19});
  assert.equal(L.resizeBounds(ch, 1), null);
});

test('片条缩放：1 倍起每档 ×1.5、顶到 8 倍；放大后播放头出了视野才滚', () => {
  assert.equal(L.zoomIn(1), 1.5);
  assert.equal(L.zoomIn(6), 8);
  assert.equal(L.zoomOut(1.5), 1);
  assert.equal(L.zoomOut(1), 1);
  assert.equal(L.clampZoom(0.3), 1);
  assert.equal(L.keepInView(100, 0, 400), null);
  assert.equal(L.keepInView(500, 0, 400), 367);
  assert.equal(L.keepInView(10, 100, 400), 0);
});

test('缩放标签与适应一段：100% 起整数百分比；一段铺满 = 总长 ÷ 段长，夹在 1–8 倍', () => {
  assert.deepEqual([1, 1.5, 2.25, 8].map(L.zoomLabel), ['100%', '150%', '225%', '800%']);
  assert.equal(L.fitZoom({start: 60, end: 100}, 200), 5);
  assert.equal(L.fitZoom({start: 0, end: 10}, 200), 8);
  assert.equal(L.fitZoom({start: 0, end: 200}, 200), 1);
  assert.equal(L.fitZoom(null, 200), 1);
  assert.deepEqual(L.ZOOM_MENU.map(m => m.k), ['in', 'out', 'fit', 'segment', 'playhead']);
});

test('播放条时钟：分不补零、秒不带小数、有小时才写小时', () => {
  assert.deepEqual([0, 29.4, 180, 3723.6, -2].map(L.fmtClock), ['0:00', '0:29', '3:00', '1:02:04', '0:00']);
});

test('章节挪边界：总长不变，两边各留 1 秒，末章拖不动', () => {
  const ch = [{id: 'c1', title: '一', start: 0, end: 10}, {id: 'c2', title: '二', start: 10, end: 20}];
  assert.deepEqual(L.moveChapterBoundary(ch, 0, 14).map(c => [c.start, c.end]), [[0, 14], [14, 20]]);
  assert.deepEqual(L.moveChapterBoundary(ch, 0, 25).map(c => [c.start, c.end]), [[0, 19], [19, 20]]);
  assert.equal(L.moveChapterBoundary(ch, 0, 10), null);
  assert.equal(L.moveChapterBoundary(ch, 1, 30), null);
});

test('循环：整片是整条，当前段是播放头所在的段，不循环为 null', () => {
  const segs = [{start: 0, end: 10}, {start: 10, end: 25}];
  assert.equal(L.LOOP_DEFAULT, 'whole');
  assert.deepEqual(L.LOOP_MODES.map(m => m.k), ['whole', 'segment', 'off']);
  assert.deepEqual(L.loopRange(segs, 'whole', 12, 25), {start: 0, end: 25});
  assert.deepEqual(L.loopRange(segs, 'segment', 3, 25), {start: 0, end: 10});
  assert.deepEqual(L.loopRange(segs, 'segment', 25, 25), {start: 10, end: 25});
  assert.equal(L.loopRange(segs, 'off', 3, 25), null);
  assert.equal(L.loopRange([], 'segment', 3, 25), null);
});

test('当前段循环只在播放走的一步跨过段尾时跳回段首，片尾、倒退与比时钟走得快的大步不跳', () => {
  const segs = [{start: 0, end: 10}, {start: 10, end: 25}];
  const step = L.loopMaxStep(1 / 60, 1);
  assert.equal(L.loopJump(segs, 'segment', 9.99, 10.005, 25, step), 0);
  assert.equal(L.loopJump(segs, 'segment', 9.5, 9.51, 25, step), null);
  assert.equal(L.loopJump(segs, 'segment', 8, 10, 25, step), null);
  assert.equal(L.loopJump(segs, 'segment', 24.99, 25, 25, step), null);
  assert.equal(L.loopJump(segs, 'whole', 9.99, 10.005, 25, step), null);
  assert.equal(L.loopJump(segs, 'segment', 9.2, 10.2, 25, L.loopMaxStep(1, 1)), 0);
  assert.equal(L.loopJump(segs, 'segment', 8.5, 10.5, 25, L.loopMaxStep(1, 1)), null);
});
