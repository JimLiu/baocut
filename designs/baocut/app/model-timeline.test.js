const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-timeline.js');
const TL = global.window.BC_TL;

test('显式空轨集保持为空：新建空白项目与拿下最后一条字幕都不补虚构轨', () => {
  assert.deepStrictEqual(TL.rows([], {subTracks: [], audio: false, music: false}),
    {rows: [], height: 0});
  const visible = TL.rows([{id: 'new-title', kind: 'text', start: 0, end: 5}],
    {subTracks: [], audio: false, music: false}).rows;
  assert.deepStrictEqual(visible.map(row => row.key), ['el:text@0'], '元素行按类别 + 道命名（同类共道）');
  assert.equal(TL.rows([], {}).rows.filter(row => row.kind === 'subs').length, 1);
});

test('只读文稿行：转录过却没有字幕轨时占字幕行的位置；有字幕轨或没传 transcript 时不出', () => {
  const only = TL.rows([], {subTracks: [], transcript: true, audio: false, music: false}).rows;
  assert.deepStrictEqual(only.map((r) => [r.key, r.kind, r.h]), [['transcript', 'transcript', TL.ROW_H.subs]]);
  assert.equal(TL.headLabel(only[0]), '文稿');
  assert.equal(TL.laneSwitch(only[0]), null, '它不是轨：没有启停开关');
  const withTrack = TL.rows([], {subTracks: [{id: 'zh', name: '中文'}], transcript: true, audio: false, music: false}).rows;
  assert.deepStrictEqual(withTrack.map((r) => r.key), ['subs:zh'], '有字幕轨时文稿就在字幕里，不再另起一行');
  assert.deepStrictEqual(TL.rows([], {subTracks: [], transcript: false}).rows.filter((r) => r.kind === 'transcript'), []);
});

test('空白项目开放尾巴：显示时长 = 内容末端 + 10s，有主素材时原样', () => {
  assert.equal(TL.BLANK_TAIL, 10);
  assert.equal(TL.displayDuration(0, true), 10, '零内容也要有 10s 可落播放头');
  assert.equal(TL.displayDuration(12, true), 22);
  assert.equal(TL.displayDuration(206, false), 206);
  assert.equal(TL.BLANK_ROW_H, 64);
});

const CH = [
  {id: 'c1', start: 0, end: 22}, {id: 'c2', start: 22, end: 95},
  {id: 'c3', start: 95, end: 158}, {id: 'c4', start: 158, end: 206},
];
const CLIPS = [
  {id: 'k1', start: 0, end: 28, src: 0}, {id: 'k2', start: 28, end: 45.2, src: 28},
  {id: 'k3', start: 45.2, end: 78, src: 45.2}, {id: 'k4', start: 78, end: 120, src: 78},
  {id: 'k5', start: 120, end: 163, src: 120}, {id: 'k6', start: 163, end: 206, src: 163},
];

test('横向几何是 8 + t × pxps', () => {
  assert.equal(TL.px(0, 20), 8);
  assert.equal(TL.px(12.4, 20), 256);
  assert.equal(TL.contentWidth(206, 20), 4136);
  assert.equal(Math.round(TL.timeAt(256, 20) * 10) / 10, 12.4);
});

test('px ↔ timeAt 往返', () => {
  for (const t of [0, 12.4, 95, 206]) {
    assert.ok(Math.abs(TL.timeAt(TL.px(t, 20), 20) - t) < 1e-9);
  }
});

test('播放从左侧等播放头走到中线，从右侧平滑追到中线', () => {
  const left = TL.playbackFollowScrollOffset(300, 100, 2000, 800, 200, 1);
  assert.deepStrictEqual(left, {scroll: 100, settled: false});
  const reached = TL.playbackFollowScrollOffset(500, 100, 2000, 800, 200, 1);
  assert.deepStrictEqual(reached, {scroll: 100, settled: true});

  const half = TL.playbackFollowScrollOffset(875, 100, 2000, 800, 650, 0.5);
  assert.deepStrictEqual(half, {scroll: 350, settled: false});
  const done = TL.playbackFollowScrollOffset(900, 100, 2000, 800, 650, 1);
  assert.deepStrictEqual(done, {scroll: 500, settled: true});
});

test('播放头起步在视口左侧外（往回跳转）时平滑追回，不等它走到中线', () => {
  const half = TL.playbackFollowScrollOffset(1000, 5000, 20000, 800, -4000, 0.5);
  assert.ok(half.scroll < 5000);
  assert.strictEqual(half.settled, false);
  const done = TL.playbackFollowScrollOffset(1000, 5000, 20000, 800, -4000, 1);
  assert.deepStrictEqual(done, {scroll: TL.centeredScrollOffset(1000, 20000, 800), settled: true});
});

test('刻度步长取首个 ≥90px 的档', () => {
  assert.equal(TL.tickStep(20), 5, '100% 时 5s 一格（5×20=100 ≥ 90）');
  assert.equal(TL.tickStep(80), 2, '最大缩放 2s 一格（2×80=160；1×80=80 < 90）');
  assert.equal(TL.tickStep(4.4), 30, 'Fit 时 30s 一格（15×4.4=66 < 90）');
  assert.equal(TL.tickStep(0.01), 300, '再小也不越出档位表');
});

test('刻度含 0 且不超过 dur', () => {
  const t = TL.ticks(206, 20);
  assert.equal(t[0], 0);
  assert.equal(t[t.length - 1], 205);
  assert.ok(t.every((x) => x <= 206));
});

test('缩放 ×÷1.5 并钳在 [下限, 80]', () => {
  assert.equal(TL.zoomIn(20), 30);
  assert.equal(TL.zoomOut(30), 20);
  assert.equal(TL.zoomIn(80), 80, '上限不越');
  assert.equal(TL.zoomOut(4.4), 4.4, '缺省下限不越');
  assert.equal(TL.zoomOut(1, 0.5), 1 / 1.5, '传入更低的下限就能继续缩');
  assert.equal(TL.zoomOut(0.6, 0.5), 0.5, '传入的下限不越');
});

test('缩放百分比标签：≥10 取整、1–10 一位小数、<1 两位有效数字', () => {
  const P = (pct) => TL.zoomLabel((pct / 100) * TL.PXPS_DEFAULT);
  assert.equal(TL.zoomLabel(20), '100%');
  assert.equal(TL.zoomLabel(4.4), '22%');
  assert.equal(TL.zoomLabel(80), '400%');
  assert.equal(P(10), '10%');
  assert.equal(P(4.4), '4.4%');
  assert.equal(P(5), '5%', '去掉多余的 .0');
  assert.equal(P(1), '1%');
  assert.equal(P(9.96), '10%', '进位跨档不写 10.0%');
  assert.equal(P(0.999), '1%');
  assert.equal(P(0.42), '0.42%');
  assert.equal(P(0.05), '0.05%', '去掉末尾的 0');
  assert.equal(P(0.012), '0.012%');
  assert.equal(P(0.5), '0.5%');
  assert.equal(P(0.00123), '0.0012%');
  for (const pxps of [0.0001, 0.01, 0.1234, 0.9, 1.234]) {
    assert.ok(!/^0%$/.test(TL.zoomLabel(pxps)), '有效缩放不显示 0%');
    assert.ok(!/\.0%$/.test(TL.zoomLabel(pxps)), '不留 .0');
  }
});

test('fitPxps 让 206s 铺满 906px 视口 ≈ 4.4', () => {
  assert.equal(Math.round(TL.fitPxps(206, 906) * 10) / 10, 4.3);
});

test('缩放下限 = min(固定下限, 整片入镜)：短视频不变，长视频能缩到整片入镜', () => {
  assert.equal(TL.minPxps(10, 906), TL.PXPS_FIT_206, '短视频停在固定下限');
  assert.equal(TL.minPxps(206, 906), TL.fitPxps(206, 906), '206s 在 906 视口里整片入镜略小于 4.4');
  assert.ok(TL.minPxps(206, 906) <= TL.PXPS_FIT_206);
  assert.equal(TL.minPxps(0, 906), TL.PXPS_FIT_206, '没有时长退回固定下限');
  assert.equal(TL.minPxps(100, 10), TL.PXPS_FIT_206, '视口还没量出来退回固定下限');
  const floor = TL.minPxps(7200, 906);
  assert.equal(floor, TL.fitPxps(7200, 906));
  assert.ok(floor < TL.PXPS_FIT_206);
  assert.equal(TL.zoomOut(floor * 1.2, floor), floor, '2 小时的片子能缩到整片入镜');
  const label = TL.zoomLabel(floor);
  assert.equal(label, '0.62%', '2 小时 / 906px → 0.62%');
  assert.ok(!/^0%$/.test(label));
  assert.equal(TL.zoomPlan('fit', {pxps: 20, scroll: 0, viewportW: 906, viewDur: 7200, playVt: 0}).pxps, floor);
});

// 视口 800、视图时长 600s：内容宽 = 16 + 600×pxps
const ZS = {pxps: 20, scroll: 0, viewportW: 800, viewDur: 600, playVt: 10};
test('锚点缩放：播放头在视口内就留在原来的屏幕 x', () => {
  const r = TL.zoomPlan('in', Object.assign({}, ZS, {scroll: 100, playVt: 20}));   // 屏幕 x = 8+400-100 = 308
  assert.equal(r.pxps, 30);
  assert.equal(TL.px(20, r.pxps) - r.scroll, 308);
  const far = Object.assign({}, ZS, {scroll: 800, playVt: 60});   // 屏幕 x = 8+1200-800 = 408
  const o = TL.zoomPlan('out', far);
  assert.equal(TL.px(60, o.pxps) - o.scroll, 408);
  const clamped = TL.zoomPlan('out', Object.assign({}, ZS, {scroll: 100, playVt: 20}));
  assert.equal(clamped.scroll, 0, '内容左缘不够再让时，滚动夹在 0');
});

test('锚点缩放：播放头在视口外就保持视口中线的时刻不动', () => {
  const st = Object.assign({}, ZS, {scroll: 2000, playVt: 5});   // 中线时刻 = (2000+400-8)/20
  const r = TL.zoomPlan('in', st);
  assert.ok(Math.abs(TL.timeAt(r.scroll + 400, r.pxps) - TL.timeAt(2000 + 400, 20)) < 1e-9);
});

test('锚点缩放：滚动夹在内容范围内；放大到上限、缩到下限不抖', () => {
  const r = TL.zoomPlan('out', Object.assign({}, ZS, {pxps: 20, scroll: 0, playVt: 0}));
  assert.equal(r.scroll, 0);
  const atMax = TL.zoomPlan('in', Object.assign({}, ZS, {pxps: 80, scroll: 300, playVt: 8}));
  assert.equal(atMax.pxps, 80);
  assert.equal(atMax.scroll, 300, '已在上限，屏幕 x 不变就不动');
  const w = TL.contentWidth(600, 80);
  assert.ok(TL.zoomPlan('in', Object.assign({}, ZS, {pxps: 40, scroll: w, playVt: 590})).scroll <= w - 800);
});

test('100% 回到 PXPS_DEFAULT 并锚住播放头', () => {
  const r = TL.zoomPlan('100', Object.assign({}, ZS, {pxps: 60, scroll: 900, playVt: 20}));   // 屏幕 x = 8+1200-900
  assert.equal(r.pxps, 20);
  assert.equal(TL.px(20, 20) - r.scroll, 308);
});

test('适应窗口：整片入镜并回到 0', () => {
  const r = TL.zoomPlan('fit', Object.assign({}, ZS, {scroll: 1234}));
  assert.equal(r.scroll, 0);
  assert.ok(Math.abs(TL.contentWidth(600, r.pxps) - 800) < 1e-9);
});

test('缩放到播放头：PXPS_PLAYHEAD 且播放头居中', () => {
  const r = TL.zoomPlan('playhead', Object.assign({}, ZS, {playVt: 300}));
  assert.equal(r.pxps, TL.PXPS_PLAYHEAD);
  assert.equal(TL.px(300, r.pxps) - r.scroll, 400);
  const edge = TL.zoomPlan('playhead', Object.assign({}, ZS, {playVt: 0}));
  assert.equal(edge.scroll, 0, '贴近片头时夹在 0');
});

test('适应片段 / 所选：区间铺满视口并居中；没有区间返回 null', () => {
  const r = TL.zoomPlan('fitsel', Object.assign({}, ZS, {span: {start: 100, end: 140}}));
  assert.ok(Math.abs(r.pxps - TL.fitPxps(40, 800)) < 1e-9);
  assert.ok(Math.abs(TL.px(100, r.pxps) - r.scroll - TL.PAD) < 1e-6, '区间起点落在左内边距处');
  assert.equal(TL.zoomPlan('fitclip', ZS), null);
  const tiny = TL.zoomPlan('fitclip', Object.assign({}, ZS, {span: {start: 100, end: 101}}));
  assert.equal(tiny.pxps, TL.PXPS_MAX, '极短区间封顶 400%');
  assert.ok(Math.abs(TL.px(100.5, tiny.pxps) - tiny.scroll - 400) < 1e-6, '铺不满也居中');
});

test('缩放快捷键与菜单提示一一对应（⌥ 下认 e.code）', () => {
  const ev = (o) => Object.assign({metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: '', code: ''}, o);
  assert.equal(TL.zoomKey(ev({key: '=', code: 'Equal'})), 'in');
  assert.equal(TL.zoomKey(ev({key: '+', code: 'Equal', shiftKey: true})), 'in');
  assert.equal(TL.zoomKey(ev({key: '-', code: 'Minus'})), 'out');
  assert.equal(TL.zoomKey(ev({key: '0', code: 'Digit0'})), '100');
  assert.equal(TL.zoomKey(ev({key: '¡', code: 'Digit1', altKey: true})), 'fit');
  assert.equal(TL.zoomKey(ev({key: '™', code: 'Digit2', altKey: true})), 'fitclip');
  assert.equal(TL.zoomKey(ev({key: '£', code: 'Digit3', altKey: true})), 'playhead');
  assert.equal(TL.zoomKey(ev({key: '¢', code: 'Digit4', altKey: true})), 'fitsel');
  assert.equal(TL.zoomKey(ev({key: '5', code: 'Digit5', altKey: true})), null);
  assert.equal(TL.zoomKey(ev({key: '1', code: 'Digit1'})), null, '没按 ⌥ 的 ⌘1 不是缩放');
  assert.equal(TL.zoomKey(ev({key: '=', code: 'Equal', metaKey: false})), null, '不按 ⌘ / Ctrl 不是缩放');
  assert.equal(TL.zoomKey(ev({key: 'z', code: 'KeyZ'})), null);
});

test('章节命中与 « » 跳转', () => {
  assert.equal(TL.chapterAt(CH, 0), 0);
  assert.equal(TL.chapterAt(CH, 21.9), 0);
  assert.equal(TL.chapterAt(CH, 22), 1);
  assert.equal(TL.chapterAt(CH, 206), 3, '末章含右端点');
  assert.equal(TL.chapterAt(CH, 300), -1);
  assert.equal(TL.prevChapterStart(CH, 100), 95);
  assert.equal(TL.prevChapterStart(CH, 5), 0, '首章前 clamp 到 0');
  assert.equal(TL.nextChapterStart(CH, 100), 158);
  assert.equal(TL.nextChapterStart(CH, 200), 206, '末章后 clamp 到结尾');
});

test('没有章节也保留一整段播放进度条', () => {
  assert.deepStrictEqual(TL.playbackSpans([], 206, 'Project title'), [
    {id: 'playback', title: 'Project title', start: 0, end: 206, playbackOnly: true},
  ]);
  assert.deepStrictEqual(TL.playbackSpans(CH, 206), CH);
  assert.deepStrictEqual(TL.playbackSpans([], 0), []);
});

test('clipAt', () => {
  assert.equal(TL.clipAt(CLIPS, 0), 0);
  assert.equal(TL.clipAt(CLIPS, 28), 1, '边界归右侧那一段');
  assert.equal(TL.clipAt(CLIPS, 206), 5, '末段含右端点');
  assert.equal(TL.clipAt(CLIPS, 300), -1);
});

test('splitClips 已退役（2026-09-16）：播放头分割切的是视频元素，见 model-video-edit.test.js', () => {
  assert.equal(TL.splitClips, undefined);
});

test('splitSpan 联动切分，endAnchor 也能切', () => {
  assert.equal(TL.splitSpan({id: 'e', start: 10, end: 20}, 5), null, '切点在范围外');
  const a = TL.splitSpan({id: 'e', start: 10, end: 20}, 15);
  assert.deepEqual([a[0].start, a[0].end, a[1].start, a[1].end], [10, 15, 15, 20]);
  const b = TL.splitSpan({id: 'w', start: 0, end: null}, 100);
  assert.equal(b[0].end, 100);
  assert.equal(b[1].end, null, '铺到结尾的元素切完右半仍然铺到结尾');
});

test('行序：元素按类别 → 字幕 → 音乐，没有 clips 行也没有常驻音频行（2026-09-16），y 累加不留缝', () => {
  const els = [
    {id: 'a', kind: 'wave', start: 0}, {id: 'b', kind: 'sticker', start: 7.6},
    {id: 'c', kind: 'textgroup', start: 30}, {id: 'd', kind: 'tpl', start: 0},
  ];
  const {rows, height} = TL.rows(els);
  assert.deepEqual(rows.map((r) => r.key),
    ['el:c', 'el:sticker@0', 'el:wave@0', 'el:d', 'subs:subs', 'music']);
  assert.equal(rows[0].y, 0);
  assert.equal(rows[1].y, 34, '文本行 34 高');
  assert.equal(height, 34 + 30 + 30 + 30 + 46 + 30, '字幕行恒展开 46');
});

test('剪口不新增轨：fromSource 的每段 clip 仍是自己的元素行，剪口只在各自行内分割（第 196 轮）', () => {
  const els = [
    {id: 'v2', kind: 'video', fromSource: true, start: 12, end: 30},
    {id: 't', kind: 'textgroup', start: 0},
    {id: 'v1', kind: 'video', fromSource: true, start: 0, end: 10},
    {id: 'pip', kind: 'video', start: 5, end: 9},
  ];
  const {rows} = TL.rows(els, {hiddenEls: {v1: true}});
  assert.deepEqual(rows.map((r) => r.key), ['el:t', 'el:video@1', 'el:video@0', 'subs:subs', 'music'],
    '没有合并出来的「主视频」行：视频类同类共道，两段源 clip 不重叠坐同一道，画中画与 v1 重叠才叠出第二道（高道在上）');
  assert.ok(!rows.some((r) => r.kind === 'main'));
  assert.deepEqual(TL.rowEls(rows[1]).map((e) => e.id), ['pip']);
  assert.deepEqual(TL.rowEls(rows[2]).map((e) => e.id), ['v1', 'v2'], '同一道上按 start 排');
  assert.equal(rows[2].off, false, '一道上只停用了 v1，整行不算停用');
  assert.deepEqual(TL.rowEls(rows[3]), [], '字幕行上没有元素');
  assert.equal(TL.rowOfEl(rows, 'v1').key, 'el:video@0');
  assert.equal(TL.rowOfEl(rows, 'pip').key, 'el:video@1');
  assert.equal(TL.rowOfEl(rows, 'nope'), null);
});

test('视频预览保留 42px 画面和 24px 波形，字幕行头使用语言缩写', () => {
  assert.equal(TL.ROW_H.video - 8, 42 + 24);
  assert.equal(TL.ROW_H.clips, undefined, '没有 clips 行（2026-09-16）');
  assert.equal(TL.languageBadge('en-US'), 'EN');
  assert.equal(TL.languageBadge('ja'), 'JP');
  assert.equal(TL.languageBadge('zh_Hant'), 'ZH');
});

test('时间轴最小高 = 章节条 13 + transport 46 + 边线 1', () => {
  assert.equal(TL.MIN_HEIGHT, 60);
  assert.equal(TL.TRACKS_ORIGIN_Y, 59, 'W3 起 transport 在上，轨道从 59 起');
});

/* ---------- 元素条的拖动 / 裁剪 / 吸附（第 39.2 轮） ---------- */

test('吸附阈值按像素判，不是按秒——缩放越小越难吸', () => {
  const pts = TL.snapPoints([{id: 'a', start: 10, end: 20}], 'b', 12.4, 206);
  // pxps 20：0.4s = 8px，在 10px 阈值内
  assert.strictEqual(TL.snapTime(10.4, pts, 20).t, 10);
  // pxps 4.4（Fit）：同样 0.4s 只有 1.8px，照样吸
  assert.strictEqual(TL.snapTime(10.4, pts, 4.4).t, 10);
  // pxps 80：0.4s = 32px，超出阈值，不吸
  assert.strictEqual(TL.snapTime(10.4, pts, 80).t, 10.4);
});

test('吸附点含播放头（贯穿全高）与其它元素的两缘，不含自己', () => {
  const pts = TL.snapPoints([{id: 'a', start: 10, end: 20}, {id: 'b', start: 30, end: 40}], 'b', 12.4, 206);
  assert.ok(pts.some((p) => p.t === 12.4 && p.full), '播放头那条要贯穿全高');
  assert.deepStrictEqual(pts.filter((p) => p.row).map((p) => p.t), [10, 20]);
  assert.ok(!pts.some((p) => p.row === 'b'), '不该吸到自己身上');
});

test('整条拖动长度不变，两端都试吸附', () => {
  const pts = TL.snapPoints([{id: 'a', start: 10, end: 20}], 'b', 12.4, 206);
  const r = TL.dragSpan({start: 5, end: 15}, 5.2, 206, pts, 20);
  assert.deepStrictEqual([r.start, r.end], [10, 20], '起点吸到 10');
  // 右缘吸附：把 [0,10] 往右推到右缘落在 20 附近
  const r2 = TL.dragSpan({start: 0, end: 10}, 10.2, 206, pts, 20);
  assert.deepStrictEqual([r2.start, r2.end], [10, 20]);
});

test('拖动夹在 [0, dur]，不会把元素推出时间轴', () => {
  const r = TL.dragSpan({start: 5, end: 15}, -99, 206, [], 20);
  assert.deepStrictEqual([r.start, r.end], [0, 10]);
  const r2 = TL.dragSpan({start: 190, end: 200}, 99, 206, [], 20);
  assert.deepStrictEqual([r2.start, r2.end], [196, 206]);
});

test('裁剪只动一端，且留得下最短时长', () => {
  const a = TL.trimSpan({start: 5, end: 15}, 'left', 99, 206, [], 20);
  assert.deepStrictEqual([a.start, a.end], [15 - TL.TRIM_MIN, 15]);
  const b = TL.trimSpan({start: 5, end: 15}, 'right', -99, 206, [], 20);
  assert.deepStrictEqual([b.start, b.end], [5, 5 + TL.TRIM_MIN]);
  const c = TL.trimSpan({start: 5, end: 15}, 'right', 999, 206, [], 20);
  assert.strictEqual(c.end, 206);
});

test('块窄于 45px 就不画图标与文字', () => {
  assert.strictEqual(TL.showsLabel(44), false);
  assert.strictEqual(TL.showsLabel(45), true);
});

test('动画色带被条子本身夹住，放不下就按比例缩', () => {
  const anim = {in: {k: 'fade', dur: 0.6}, out: {k: 'fade', dur: 0.6}, loop: {k: 'sway'}};
  assert.deepStrictEqual(TL.animBands({start: 0, end: 8}, anim), {in: 0.6, out: 0.6, loop: true});
  assert.deepStrictEqual(TL.animBands({start: 0, end: 1}, anim), {in: 0.5, out: 0.5, loop: true});
  assert.deepStrictEqual(TL.animBands({start: 0, end: 8}, null), {in: 0, out: 0, loop: false});
  assert.deepStrictEqual(TL.animBands({start: 0, end: 8}, {in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}}),
    {in: 0, out: 0, loop: false});
});

/* ---------- 字幕行恒展开（第 105 轮，两态退役） ---------- */

test('字幕行恒为展开态 46（要放得下两行译文），合并带已退役', () => {
  const a = TL.rows([], {audio: false});
  assert.strictEqual(a.rows.filter((r) => r.kind === 'subs')[0].h, TL.ROW_H.subs);
  assert.strictEqual(TL.ROW_H.subs, 46);
  assert.strictEqual(TL.condensedSpan, undefined, '合并带的几何随两态一起删了');
});

test('时间轴不读 Tab（第 105 轮）：rows() 与 subsOpen/textOpen 无关，同输入同输出', () => {
  const els = [{id: 'e-txt', kind: 'textgroup', start: 30}];
  const ms = [{id: 'm1', delay: 0}, {id: 'm2', delay: 0.13}];
  const base = {subTracks: [{id: 'zh', name: '中文'}, {id: 'en', name: 'EN'}], textMembers: ms};
  const plain = TL.rows(els, base);
  // 旧 API 的两个开关不再被接受：塞进来也改变不了任何一行的存在与高度
  const withFlags = TL.rows(els, Object.assign({subsOpen: false, textOpen: false}, base));
  assert.deepStrictEqual(withFlags, plain);
  const withFlagsOn = TL.rows(els, Object.assign({subsOpen: true, textOpen: true}, base));
  assert.deepStrictEqual(withFlagsOn, plain);
});

test('cue 块上写的是这一条字幕的文字，双语才带译文；太窄什么都不写', () => {
  const cue = {text: '大家好', trans: 'Hi everyone'};
  assert.deepStrictEqual(TL.cueLabel(cue, 200, false), {text: '大家好'});
  assert.deepStrictEqual(TL.cueLabel(cue, 200, true), {text: '大家好', trans: 'Hi everyone'});
  assert.strictEqual(TL.cueLabel(cue, 44, true), null, '45px 阈值对 cue 一样生效');
});

test('cue 的边缘不进吸附点表——不然 62 条 cue 会把别的元素一路咬住', () => {
  const spans = [{id: 'a', start: 10, end: 20}];
  const pts = TL.snapPoints(spans, 'b', 12.4, 206);
  assert.strictEqual(pts.length, 5, '播放头 + 0 + DUR + a 的两缘，就这些');
  assert.ok(pts.every((p) => p.full || p.row === 'a' || p.t === 0 || p.t === 206));
});

/* ---------- 视频轨与音频轨（第 39.4 轮） ---------- */

test('缩略帧按固定宽度铺满，末帧裁到剩余宽度', () => {
  assert.deepStrictEqual(TL.thumbs(100, 46),
    [{left: 0, width: 46}, {left: 46, width: 46}, {left: 92, width: 8}]);
  assert.deepStrictEqual(TL.thumbs(46, 46), [{left: 0, width: 46}]);
  assert.deepStrictEqual(TL.thumbs(0, 46), []);
  assert.strictEqual(TL.thumbs(200).length, Math.ceil(200 / TL.THUMB_W), '不给宽度时走默认帧宽');
});

test('选中环三档：极窄不描边改整块染色，其余 2px / 4px', () => {
  assert.strictEqual(TL.ringSize(4), 'small');
  assert.strictEqual(TL.ringSize(8), 'medium');
  assert.strictEqual(TL.ringSize(9), 'large');
  assert.strictEqual(TL.ringWidth(3, true), 0);
  assert.strictEqual(TL.ringWidth(7, true), 2);
  assert.strictEqual(TL.ringWidth(200, true), 4);
  assert.strictEqual(TL.ringWidth(200, false), 1);
  assert.strictEqual(TL.ringFills(3, true), true, 'small 档选中要整块染色');
  assert.strictEqual(TL.ringFills(3, false), false);
  assert.strictEqual(TL.ringFills(200, true), false);
});

test('块宽 ≤ 4px 不画波形与缩略图', () => {
  assert.strictEqual(TL.showsMedia(4), false);
  assert.strictEqual(TL.showsMedia(5), true);
});

test('波形是确定性的：同一段永远画出同一条，不同起点画出不同的', () => {
  assert.strictEqual(TL.wavePath(60, 20, 0), TL.wavePath(60, 20, 0));
  assert.notStrictEqual(TL.wavePath(60, 20, 0), TL.wavePath(60, 20, 28));
  assert.ok(TL.wavePath(60, 20, 0).endsWith(' Z'), '镜像包络是闭合路径');
});

test('行序含音乐行——§12.6 一直写着，实现里一直没有；音频行只在纯音频或有配音时出现（2026-09-16）', () => {
  const ks = TL.rows([], {}).rows.map((r) => r.kind);
  assert.deepStrictEqual(ks, ['subs', 'music']);
  assert.deepStrictEqual(TL.rows([], {music: false}).rows.map((r) => r.kind), ['subs']);
  assert.deepStrictEqual(TL.rows([], {music: false, mainAudio: true}).rows.map((r) => r.kind), ['subs', 'audio']);
  const dubbed = TL.rows([], {music: false, dubs: [{lang: 'ja', blocks: []}]}).rows;
  assert.deepStrictEqual(dubbed.map((r) => r.kind), ['subs', 'dub', 'audio']);
  assert.equal(dubbed[2].split, true, '有配音时那一行是从视频元素剥离出来的「原声」');
  assert.equal(dubbed[2].label, '原声');
});

/* ---------- 文字轨（第 39.5 轮） ---------- */

test('标签 20 字截断加省略号，正好 20 字不截', () => {
  assert.strictEqual(TL.truncate('本地优先'), '本地优先');
  assert.strictEqual(TL.truncate('一二三四五六七八九十一二三四五六七八九十'), '一二三四五六七八九十一二三四五六七八九十', '正好 20 字不截');
  assert.strictEqual(TL.truncate('一二三四五六七八九十一二三四五六七八九十一'), '一二三四五六七八九十一二三四五六七八九十…');
  assert.strictEqual(TL.truncate('abcdef', 3), 'abc…');
  assert.strictEqual(TL.truncate(null), '');
});

test('成员起点 = 组起点 + delay，终点跟组一起收', () => {
  const g = {start: 30, end: 38};
  assert.deepStrictEqual(TL.memberSpan(g, {delay: 0}), {start: 30, end: 38});
  assert.deepStrictEqual(TL.memberSpan(g, {delay: 0.13}), {start: 30.13, end: 38});
  assert.deepStrictEqual(TL.memberSpan(g, {delay: 99}), {start: 38, end: 38}, '错峰再大也不越过终点');
});

test('文本组成员泳道常开（第 105 轮）：组行后面恒跟缩进的成员行', () => {
  const els = [{id: 'e-txt', kind: 'textgroup', start: 30}];
  const ms = [{id: 'm1', delay: 0}, {id: 'm2', delay: 0.13}];
  // 没有成员表可用时（组自己没带、也没传兜底表）才只剩组行
  const bare = TL.rows(els, {audio: false, music: false});
  assert.deepStrictEqual(bare.rows.map((r) => r.key), ['el:e-txt', 'subs:subs']);
  const open = TL.rows(els, {audio: false, music: false, textMembers: ms});
  assert.deepStrictEqual(open.rows.map((r) => r.key), ['el:e-txt', 'mem:m1', 'mem:m2', 'subs:subs']);
  assert.ok(open.rows[1].indent, '成员行要缩进');
  assert.strictEqual(open.rows[1].h, TL.ROW_H.member);
  assert.strictEqual(open.height, bare.height + TL.ROW_H.member * 2);
});

/* ---------- 素材导入态（第 39.6 轮） ---------- */

test('导入态分两段：导入完了还要转码，进度改读 transcodePct', () => {
  assert.deepStrictEqual(TL.importState(null), {label: '', pct: 0, active: false});
  assert.deepStrictEqual(TL.importState({imported: false, pct: 0.63}),
    {label: '导入中', pct: 63, active: true});
  assert.deepStrictEqual(TL.importState({imported: true, needTranscode: true, pct: 1, transcodePct: 0.2}),
    {label: '转码中', pct: 20, active: true}, '传完 ≠ 可用');
  assert.deepStrictEqual(TL.importState({imported: true, needTranscode: false, pct: 1}),
    {label: '导入中', pct: 100, active: false}, '不需要转码就直接就绪');
});

test('导入进度夹在 0–100', () => {
  assert.strictEqual(TL.importState({imported: false, pct: 1.4}).pct, 100);
  assert.strictEqual(TL.importState({imported: false, pct: -1}).pct, 0);
});


/* ---------- 一门语言 = 一条字幕轨 = 一行（第 45 轮） ---------- */

test('几条字幕轨就有几行，行序 = 轨序', () => {
  const tracks = [{id: 'zh', name: '中文'}, {id: 'en', name: 'English'}, {id: 'ja', name: '日本語'}];
  const {rows} = TL.rows([], {subTracks: tracks});
  const subs = rows.filter((r) => r.kind === 'subs');
  assert.strictEqual(subs.length, 3);
  assert.deepStrictEqual(subs.map((r) => r.key), ['subs:zh', 'subs:en', 'subs:ja']);
  assert.deepStrictEqual(subs.map((r) => r.label), ['中文', 'English', '日本語']);
  // 换了轨序，行序跟着换——时间轴上的先后就是画面上的叠序
  const swapped = TL.rows([], {subTracks: [tracks[1], tracks[0], tracks[2]]});
  assert.deepStrictEqual(swapped.rows.filter((r) => r.kind === 'subs').map((r) => r.key),
    ['subs:en', 'subs:zh', 'subs:ja']);
});

test('多条字幕轨时每一行都是展开态行高，总高跟着涨', () => {
  const one = TL.rows([], {subTracks: [{id: 'zh', name: '中文'}]});
  const two = TL.rows([], {subTracks: [{id: 'zh', name: '中文'}, {id: 'en', name: 'EN'}]});
  assert.strictEqual(two.height - one.height, TL.ROW_H.subs);
});

test('rows：停用位折成每行一个 off（第 120 轮），成员行跟组、模板行不停用', () => {
  const els = [
    {id: 'g', kind: 'textgroup', start: 0, end: 10, members: [{id: 'm1'}]},
    {id: 's', kind: 'sticker', start: 0, end: 10},
    {id: 't', kind: 'tpl', start: 0, end: 10},
  ];
  const r = TL.rows(els, {
    hiddenEls: {g: true, t: true},
    subTracks: [{id: 'zh', name: '中文'}, {id: 'ja', name: '日本語', hidden: true}],
    audioMuted: true, musicMuted: false, mainAudio: true,
  }).rows;
  const off = Object.fromEntries(r.map((x) => [x.key, x.off]));
  assert.equal(off['el:g'], true);
  assert.equal(off['mem:m1'], true);
  assert.equal(off['el:sticker@0'], false);
  assert.equal(off['el:t'], false);
  assert.equal(off['subs:zh'], false);
  assert.equal(off['subs:ja'], true);
  assert.equal(off['clips'], undefined, '没有 clips 行');
  assert.equal(off['audio'], true);
  assert.equal(off['music'], false);
});

test('laneSwitch：字幕 / 元素 / 音频 / 音乐有开关，成员、模板没有', () => {
  const els = [
    {id: 'g', kind: 'textgroup', start: 0, end: 10, members: [{id: 'm1'}]},
    {id: 't', kind: 'tpl', start: 0, end: 10},
  ];
  const r = TL.rows(els, {subTracks: [{id: 'zh', name: '中文'}], mainAudio: true}).rows;
  const by = Object.fromEntries(r.map((x) => [x.key, TL.laneSwitch(x)]));
  assert.deepEqual(by['el:g'], {kind: 'el', id: 'g'});
  assert.deepEqual(by['subs:zh'], {kind: 'subs', id: 'zh'});
  assert.deepEqual(by['audio'], {kind: 'audio', id: 'audio'});
  assert.deepEqual(by['music'], {kind: 'music', id: 'music'});
  assert.equal(by['mem:m1'], null);
  assert.equal(by['el:t'], null);
  assert.equal(by['clips'], undefined, '没有 clips 行');
  assert.equal(TL.laneSwitch(null), null);
});

test('配音组：一种语言一组（配音行 + 自己的背景声行）、停用位按组、背景声另有一份；老的单 dub 调用仍认', () => {
  const dubs = [{lang: 'ja', langName: '日本語', bed: true, blocks: []}, {lang: 'en', langName: 'English', bed: true, original: 'duck', blocks: []},
    {lang: 'de', langName: 'Deutsch', bed: false, blocks: []}];
  const r = TL.rows([], {subTracks: [], dubs, dubOff: {ja: true, en: false, de: true}, bedOff: {en: true}}).rows;
  assert.deepEqual(r.filter((x) => x.kind === 'dub' || x.kind === 'bed').map((x) => [x.key, x.label, x.off]),
    [['dub:ja', '配音 · 日本語', true], ['bed:ja', '背景声 · 日本語', true],
     ['dub:en', '配音 · English', false], ['bed:en', '背景声 · English', true],
     ['dub:de', '配音 · Deutsch', true]], '背景声跟在自己那组后面、没分离的组没有背景声行');
  const bedJa = r.find((x) => x.key === 'bed:ja');
  assert.deepEqual([bedJa.indent, bedJa.grouped, bedJa.groupOff, bedJa.bedOff], [true, true, true, false], '组关着：背景声行灰，但它自己的停用位没动');
  const bedEn = r.find((x) => x.key === 'bed:en');
  assert.deepEqual([bedEn.groupOff, bedEn.bedOff, bedEn.off], [false, true, true]);
  assert.equal(r.find((x) => x.key === 'dub:en').group, true);
  assert.equal(r.find((x) => x.key === 'dub:de').group, false);
  const au = r.find((x) => x.kind === 'audio');
  assert.deepEqual([au.label, au.split, au.ducked], ['原声', true, true], '有配音组时主音频行叫原声、标 split；开着的那组选了压低');
  assert.deepEqual(TL.laneSwitch(r.find((x) => x.key === 'dub:en')), {kind: 'dub', id: 'en'});
  assert.deepEqual(TL.laneSwitch(bedEn), {kind: 'bed', id: 'en'});
  const old = TL.rows([], {subTracks: [], dub: {lang: 'en', langName: 'English', bed: true, blocks: []}, dubMuted: true, bedMuted: true}).rows;
  assert.deepEqual(old.filter((x) => x.kind === 'dub' || x.kind === 'bed').map((x) => [x.key, x.off, x.bedOff]), [['dub:en', true, undefined], ['bed:en', true, true]]);
  assert.equal(TL.rows([], {subTracks: []}).rows.find((x) => x.kind === 'audio'), undefined, '没配音也不是纯音频项目：没有音频行（2026-09-16）');
  assert.equal(TL.rows([], {subTracks: [], mainAudio: true}).rows.find((x) => x.kind === 'audio').label, '音频', '纯音频项目那一行还叫音频');
});

/* ---------- 第 222 轮：缩略帧只有一份配方（时间轴的缩略图带 = 进度条的悬停预览） ---------- */

test('缩略帧按源秒数取，不按第几个格子：放大时间轴不换一批画面', () => {
  assert.equal(TL.FRAME_S, 2);
  assert.equal(TL.frameIndex(28, 28), 0);
  assert.equal(TL.frameIndex(29.9, 28), 0, '同一帧管满 2 秒');
  assert.equal(TL.frameIndex(30, 28), 1);
  assert.equal(TL.frameIndex(27, 28), 0, '段起点之前不给负帧号');
  /* 同一秒，20px/s 与 80px/s 两档缩放算出来必须是同一张 */
  const at = (pxps, leftPx) => TL.frameCss(28, TL.frameIndex(28 + leftPx / pxps, 28));
  assert.equal(at(20, 46), at(80, 184));
});

test('进度条预览与时间轴那一段读同一份配方：同一秒 = 同一张', () => {
  const clips = [{start: 0, end: 28}, {start: 28, end: 45.2}];
  assert.equal(TL.frameAt(clips, 31), TL.frameCss(28, TL.frameIndex(31, 28)));
  assert.notEqual(TL.frameAt(clips, 31), TL.frameAt(clips, 27), '跨段换种子');
  assert.notEqual(TL.frameAt(clips, 31), TL.frameAt(clips, 35), '同段内隔了帧就换画面');
  assert.ok(/^linear-gradient\(/.test(TL.frameAt(clips, 999)), '落在片尾之后也得有东西可画');
});

test('纯音频项目：音频行是主轨（第 225 轮）；视频项目没有 clips 行也没有主音频行（2026-09-16）', () => {
  const {rows} = TL.rows([], {subTracks: [], mainAudio: true, music: false});
  assert.deepStrictEqual(rows.map(r => r.kind), ['audio']);
  assert.equal(rows[0].main, true);
  assert.equal(rows[0].h, 56);
  const video = TL.rows([{id: 'v', kind: 'video', start: 0, end: 10}], {subTracks: [], music: false}).rows;
  assert.deepStrictEqual(video.map(r => r.kind), ['element'], '视频元素自己的行带着声音');
  assert.equal(video[0].h, TL.ROW_H.video);
});

test('修边热区：窄块也留得下中间那一段，宽块封顶 7px（第 226 轮）', () => {
  assert.equal(TL.blockEdgeZone(120), 7);
  assert.equal(TL.blockEdgeZone(12), 4);          // 12 / 3
  assert.equal(TL.blockEdgeZone(0), 0);
  // 12px 的贴纸：两端各 4px 能拖边，中间还剩 4px 能整条拖走
  assert.equal(TL.blockEdgeSide(1, 12), 'left');
  assert.equal(TL.blockEdgeSide(6, 12), null);
  assert.equal(TL.blockEdgeSide(11, 12), 'right');
  // 宽块两端各 7px，其余全是「整条拖动」
  assert.equal(TL.blockEdgeSide(3, 120), 'left');
  assert.equal(TL.blockEdgeSide(60, 120), null);
  assert.equal(TL.blockEdgeSide(118, 120), 'right');
  // 窄到热区不足 3px 就不画（也判不出边）
  assert.ok(TL.blockEdgeZone(6) < TL.HANDLE_MIN_ZONE);
});

/* ---------- 白板手绘行与「被盖住」带（2026-09-11） ---------- */
test('白板手绘行与视频行同高（74）：两层内容装不进 30px 的元素行', () => {
  const r = TL.rows([{id: 'wb', kind: 'whiteboard', start: 80, end: 92}, {id: 'st', kind: 'sticker', start: 0, end: 3}],
    {subTracks: [], audio: false, music: false}).rows;
  assert.deepEqual(r.map((x) => [x.key, x.h]), [['el:sticker@0', 30], ['el:whiteboard@0', TL.ROW_H.video]]);
  assert.ok(TL.isMediaKind('whiteboard') && TL.isMediaKind('video') && !TL.isMediaKind('image'));
});

const WB = {id: 'e-wb', kind: 'whiteboard', name: '白板手绘 · 示范', icon: 'whiteboard', start: 80, end: 92,
  place: {x: 50, y: 50, w: 100, h: 100}};
const MAIN = {id: 'video-k1', kind: 'video', name: '视频', icon: 'video', start: 0, end: 206, fromSource: true,
  place: {x: 50, y: 50, w: 100, h: 100}};
const paper = (hex) => () => ({whiteboard: {paper: hex}});

test('盖住判据：铺满画布且铺了纸的白板盖住下层视频；透明纸 / 停用 / 缩小不算；铺满的视频也盖（2026-09-16 不再豁免 fromSource）', () => {
  assert.equal(TL.covers(WB, {}, paper('#FFFFFF')()), true);
  assert.equal(TL.covers(WB, {}, paper(null)()), false, '透明纸露出下层');
  assert.equal(TL.covers(WB, {hidden: true}, paper('#FFFFFF')()), false, '停用的不上画面');
  assert.equal(TL.covers(WB, {pose: {w: 60, h: 60}}, paper('#FFFFFF')()), false, '缩小后露出四周');
  assert.equal(TL.covers(WB, {pose: {x: 30}}, paper('#FFFFFF')()), false, '挪开后露出一侧');
  assert.equal(TL.covers(WB, {pose: {scale: 0.8}}, paper('#FFFFFF')()), false);
  assert.equal(TL.covers(MAIN, {}, {}), true, '铺满画幅的源片视频也盖住它下面的视频；自己不盖自己由 coverSpans 跳过');
  const img = {id: 'i', kind: 'image', start: 0, end: 5, place: {x: 50, y: 50, w: 100, h: 100}};
  assert.equal(TL.covers(img, {}, {}), true, '铺满且不透明的图片也盖');
  assert.equal(TL.covers(img, {}, {opacity: 60}), false);
  assert.equal(TL.covers({id: 's', kind: 'sticker', place: {x: 50, y: 50, w: 100, h: 100}}, {}, {}), false, '贴纸不进判据');
});

test('被盖时段：裁到目标视频区间、按时间排、相接的合并并记下是谁盖的；目标自己不算', () => {
  const els = [MAIN, WB, {id: 'i2', kind: 'image', name: '封面', icon: 'image', start: 90, end: 100,
    place: {x: 50, y: 50, w: 100, h: 100}}];
  const st = (id) => (id === 'e-wb' ? {whiteboard: {paper: '#FFFFFF'}} : {});
  const spans = TL.coverSpans(MAIN, els, {}, st);
  assert.equal(spans.length, 1, '80–92 与 90–100 相接，合成一段');
  assert.deepEqual([spans[0].start, spans[0].end], [80, 100]);
  assert.deepEqual(spans[0].by.map((b) => b.id), ['e-wb', 'i2']);
  const short = Object.assign({}, MAIN, {end: 85});
  assert.deepEqual(TL.coverSpans(short, els, {}, st).map((s) => [s.start, s.end]), [[80, 85]], '裁到目标视频区间');
  const pip = {id: 'pip', kind: 'video', name: '画中画', icon: 'video', start: 0, end: 50, place: {x: 50, y: 50, w: 100, h: 100}};
  assert.deepEqual(TL.coverSpans(pip, [MAIN, pip], {}, () => ({})).map((s) => [s.start, s.end, s.by[0].id]), [[0, 50, 'video-k1']],
    '每条视频行都算：铺满画幅的源片视频盖住它下面的画中画');
  assert.deepEqual(TL.coverSpans(MAIN, [MAIN, pip], {}, () => ({})).map((s) => [s.start, s.end]), [[0, 50]], '反过来也成立');
  assert.deepEqual(TL.coverSpans(MAIN, els, {'e-wb': {hidden: true}}, st).map((s) => [s.start, s.end]), [[90, 100]]);
  assert.deepEqual(TL.coverSpans(MAIN, [MAIN, WB], {}, () => ({whiteboard: {paper: null}})), [], '透明纸不盖');
  assert.deepEqual(TL.coverSpans(null, els, {}, st), []);
});

/* ---------- 同类共道（2026-09-11，§12.6 全局规则） ---------- */
test('同类共道：同一类别不重叠坐一道，重叠才叠道，且 first-fit 塞回已空出的道', () => {
  const els = [
    {id: 'a', kind: 'sticker', start: 0, end: 3},
    {id: 'b', kind: 'sticker', start: 2, end: 5},      // 与 a 重叠 → 第二道
    {id: 'c', kind: 'sticker', start: 3, end: 6},      // a 已结束（相接不算重叠）→ 回到 0 道
    {id: 'd', kind: 'sticker', start: 5.5, end: 8},    // 0 道被 c 占着，1 道 b 已结束 → 1 道
    {id: 'e', kind: 'shape', start: 0, end: 10},       // 另一类别，自己一道
  ];
  const {rows, height} = TL.rows(els, {subTracks: [], audio: false, music: false});
  assert.deepEqual(rows.map((r) => [r.key, TL.rowEls(r).map((e) => e.id)]), [
    ['el:sticker@1', ['b', 'd']],
    ['el:sticker@0', ['a', 'c']],
    ['el:shape@0', ['e']],
  ], '高道在上、0 道贴近字幕；行数 = 最大同时重叠数');
  assert.equal(height, 30 * 3);
  assert.equal(rows[0].elKind, 'sticker');
  assert.equal(rows[0].lane, 1);
  assert.equal(rows[0].el.id, 'b', 'row.el 是这一道的头一件');
  assert.equal(TL.rowOfEl(rows, 'd').key, 'el:sticker@1');
});

test('同类共道：分道镜像内核 partition——按 start 稳定排序、1ms 容差、开放式片尾按 end 算', () => {
  assert.deepEqual(TL.LANE_EPSILON, 0.001);
  const lanes = TL.laneFit([{id: 'x', start: 1, end: 2}, {id: 'y', start: 1, end: 3}, {id: 'z', start: 2.5, end: 4}], 10);
  assert.deepEqual(lanes.map((l) => l.map((e) => e.id)), [['x', 'z'], ['y']], '同 start 保持输入序');
  const eps = TL.laneFit([{id: 'p', start: 0, end: 2.0005}, {id: 'q', start: 2, end: 3}], 10);
  assert.deepEqual(eps.map((l) => l.map((e) => e.id)), [['p', 'q']], '差 0.5ms 不算重叠');
  const open = TL.laneFit([{id: 'o', start: 0, end: null}, {id: 'r', start: 5, end: 6}], 10);
  assert.deepEqual(open.map((l) => l.map((e) => e.id)), [['o'], ['r']], '开放式片尾一直占着这一道');
  // rows() 没传 end 时开放式片尾按已知的最长终点算
  const r = TL.rows([{id: 'o', kind: 'wave', start: 0}, {id: 'r', kind: 'wave', start: 5, end: 6}],
    {subTracks: [], audio: false, music: false}).rows;
  assert.deepEqual(r.map((x) => x.key), ['el:wave@1', 'el:wave@0']);
});

test('同类共道：模板与文本组例外仍一件一行；共道行的开关拧整行、停用位要整行都停才算', () => {
  const els = [
    {id: 'g1', kind: 'textgroup', start: 0, end: 4, members: [{id: 'm1'}]},
    {id: 'g2', kind: 'textgroup', start: 10, end: 14, members: [{id: 'm2'}]},
    {id: 's1', kind: 'sticker', start: 0, end: 3},
    {id: 's2', kind: 'sticker', start: 4, end: 6},
    {id: 't', kind: 'tpl', start: 0},
  ];
  const r = TL.rows(els, {subTracks: [], audio: false, music: false, hiddenEls: {s1: true}}).rows;
  assert.deepEqual(r.map((x) => x.key), ['el:g1', 'mem:m1', 'el:g2', 'mem:m2', 'el:sticker@0', 'el:t']);
  const st = r.find((x) => x.key === 'el:sticker@0');
  assert.equal(st.off, false, '只停了 s1，整行不算停用');
  assert.deepEqual(TL.laneSwitch(st), {kind: 'el', id: 's1', ids: ['s1', 's2']}, '多件时带 ids，id 仍是头一件');
  assert.deepEqual(TL.laneSwitch(r[0]), {kind: 'el', id: 'g1'}, '单件的行不带 ids');
  const both = TL.rows(els, {subTracks: [], audio: false, music: false,
    hiddenEls: {s1: true, s2: true}}).rows.find((x) => x.key === 'el:sticker@0');
  assert.equal(both.off, true);
});

test('同类共道：抓取带按与邻块间隙的一半收（镜像 core::block_grab_margin）', () => {
  assert.equal(TL.blockGrabMargin(100), 3, '间隙够宽借满 3px');
  assert.equal(TL.blockGrabMargin(4), 2, '4px 间隙只借一半');
  assert.equal(TL.blockGrabMargin(0), 0);
  assert.equal(TL.blockGrabMargin(-2), 0);
  assert.equal(TL.blockGrabMargin(NaN), 0);
  const row = TL.rows([{id: 'a', kind: 'sticker', start: 0, end: 3}, {id: 'b', kind: 'sticker', start: 3.5, end: 6},
    {id: 'c', kind: 'sticker', start: 8, end: 9}],
    {subTracks: [], audio: false, music: false}).rows[0];
  assert.deepEqual(TL.rowGaps(row, row.els[1]), {left: 0.5, right: 2});
  assert.deepEqual(TL.rowGaps(row, row.els[0]), {left: Infinity, right: 0.5});
  assert.deepEqual(TL.rowGaps(row, row.els[2]), {left: 2, right: Infinity});
});

test('配乐轨：一路一行排在音乐之后，停用位按总线，开关拧 score:<bus>', () => {
  require('./model-score.js');
  const score = [{bus: 'music', stale: false}, {bus: 'amb', stale: true, staleInputs: ['events.json']}, {bus: 'sfx'}];
  const {rows} = TL.rows([], {subTracks: [], audio: false, score, scoreOff: {sfx: true}});
  assert.deepStrictEqual(rows.map((r) => r.key), ['music', 'score:music', 'score:amb', 'score:sfx']);
  const amb = rows[2];
  assert.equal(amb.label, '配乐 · 环境声');
  assert.equal(amb.stale, true);
  assert.equal(rows[3].off, true);
  assert.deepStrictEqual(TL.laneSwitch(amb), {kind: 'score', id: 'amb'});
  assert.equal(TL.rows([], {subTracks: [], audio: false, music: false}).rows.length, 0, '没有 score 表就没有配乐行');
});

test('行头优先显示轨道类别与语言，不把素材文件名作为轨道名', () => {
  assert.equal(TL.headLabel({kind:'element', el:{kind:'video', name:'very-long-file.mp4'}}), '视频');
  assert.equal(TL.headLabel({kind:'subs', track:{lang:'zh-CN'}}), '字幕 · 中文');
  assert.equal(TL.headLabel({kind:'subs', track:{lang:'en-US'}}), '字幕 · 英文');
  assert.equal(TL.headLabel({kind:'dub', dub:{lang:'ja', role:'narration'}}), '旁白 · 日文');
  assert.equal(TL.headLabel({kind:'audio', split:true}), '原声');
  assert.equal(TL.headLabel({kind:'element', el:{kind:'image'}}), '图片');
  assert.equal(TL.headLabel({kind:'subs', track:{lang:'pt-BR'}}), '字幕 · PT');
});

test('播放头横坐标取整到设备像素：1× 落整数、2× 落半像素，缺省按 1×', () => {
  assert.strictEqual(TL.devicePx(152.3, 1), 152);
  assert.strictEqual(TL.devicePx(152.3, 2), 152.5);
  assert.strictEqual(TL.devicePx(152.74, 2), 152.5);
  assert.strictEqual(TL.devicePx(152.3, 0), 152);
  assert.strictEqual(TL.devicePx(152.3, undefined), 152);
});
