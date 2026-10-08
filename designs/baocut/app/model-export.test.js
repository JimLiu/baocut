const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-export.js');
require('./model-timeline.js');
const X = global.window.BC_EXPORT;
const TL = global.window.BC_TL;

test('preparation is an activity phase and hands over to encoded percentage', () => {
  const task = {kind: 'export', status: 'running', preparePhase: 'prepare-timeline', prepareElapsedMs: 8700, pct: 0};
  assert.deepEqual(X.preparationView(task), {active: true, label: '整理时间轴与音频', seconds: 8});
  assert.equal(X.pillLabel(task), '准备导出');
  assert.equal(X.preparationView({...task, preparePhase: null}).active, false);
  assert.equal(X.pillLabel({...task, preparePhase: null, pct: 31}), '导出 · 31%');
  assert.equal(X.preparationView({...task, status: 'done'}).active, false);
  assert.equal(X.preparationView({...task, preparePhase: 'prepare-fonts', prepareDetail: 'Ma Shan Zheng 42%'}).label, '下载字体 · Ma Shan Zheng 42%');
});

const TRACKS = [
  {id: 'zh', name: '中文', role: 'source', lang: 'zh'},
  {id: 'ja', name: '日本語', role: 'trans', lang: 'ja'},
];
const ROWS = [
  {key: 'el:e1', kind: 'element', el: {id: 'e1', name: '贴纸', icon: 'sticker'}},
  {key: 'el:e2', kind: 'text', el: {id: 'e2', name: '标题', icon: 'text'}},
  {key: 'm:e2:1', kind: 'element', el: {id: 'e2', name: '标题'}, member: {id: 'x'}},
  {key: 'subs:zh', kind: 'subs', track: TRACKS[0]},
  {key: 'subs:ja', kind: 'subs', track: Object.assign({}, TRACKS[1], {hidden: true})},
  {key: 'audio', kind: 'audio', label: '音频'},
  {key: 'music', kind: 'music', label: '音乐'},
];

test('lanes：字幕逐轨、元素合组、成员行不重复；初值就是时间轴的启停位', () => {
  const ls = X.lanes(ROWS, {hiddenEls: {e1: true}, muted: false, musicMuted: true});
  assert.deepEqual(ls.map((l) => l.key), ['subs:zh', 'subs:ja', 'els', 'audio', 'music']);
  assert.equal(ls[0].on, true);
  assert.equal(ls[1].on, false);
  assert.equal(ls[1].sub, '译文字幕');
  assert.deepEqual(ls[2].items.map((i) => [i.id, i.on]), [['e1', false], ['e2', true]]);
  assert.equal(ls[2].on, true);
  assert.equal(ls[3].on, true);
  assert.equal(ls[4].on, false);
});

test('lanes：没有元素时不出元素组', () => {
  const ls = X.lanes(ROWS.filter((r) => r.kind === 'subs' || r.kind === 'audio'), {});
  assert.deepEqual(ls.map((l) => l.key), ['subs:zh', 'subs:ja', 'audio']);
});

test('apply：覆盖只碰点名的键，元素组的 on 现算', () => {
  const ls = X.lanes(ROWS, {});
  const eff = X.apply(ls, {'subs:zh': false, 'subs:ja': true, 'el:e1': false, 'el:e2': false});
  assert.equal(eff[0].on, false);
  assert.equal(eff[1].on, true);
  assert.equal(eff[2].on, false);
  assert.equal(eff[3].on, true);
  // 原清单不被改
  assert.equal(ls[0].on, true);
});

test('setGroup：整组开关写到每一件', () => {
  const ls = X.lanes(ROWS, {});
  const ov = X.setGroup(ls, {'subs:zh': false}, false);
  assert.deepEqual(ov, {'subs:zh': false, 'el:e1': false, 'el:e2': false});
  assert.equal(X.apply(ls, ov)[2].on, false);
});

test('syncWrites：只列出与时间轴不同的几条；覆盖回原值不算差异', () => {
  const ls = X.lanes(ROWS, {hiddenEls: {e1: true}});
  assert.deepEqual(X.syncWrites(ls, {}), []);
  assert.deepEqual(X.syncWrites(ls, {'subs:zh': true, 'el:e1': false}), []);
  const w = X.syncWrites(ls, {'subs:zh': false, 'subs:ja': true, 'el:e2': false, audio: false});
  assert.deepEqual(w, [
    {key: 'subs:zh', kind: 'subs', id: 'zh', on: false},
    {key: 'subs:ja', kind: 'subs', id: 'ja', on: true},
    {key: 'el:e2', kind: 'el', id: 'e2', on: false},
    {key: 'audio', kind: 'audio', id: undefined, on: false},
  ]);
});

const CLIPS = [
  {id: 'c1', start: 0, end: 45},
  {id: 'c2', start: 45, end: 78.4},
  {id: 'c3', start: 78.4, end: 206},
];

test('rangeOptions：1-based 片段号 + 元素名 + 起止', () => {
  const o = X.rangeOptions(CLIPS);
  assert.equal(o[1].label, '片段 2 · 0:45–1:18');
  assert.equal(o[2].index, 3);
  assert.equal(X.rangeOptions([{id: 'v', start: 0, end: 28, name: 'ep42.mp4'}])[0].label, '片段 1 · ep42.mp4 · 0:00–0:28');
});

test('videoSegments：时间轴上的视频元素 = 片段，按 start 排、读 elDocs 的起止与停用位（2026-09-16）', () => {
  const els = [
    {id: 'b', kind: 'video', name: 'broll.mov', start: 40, end: 60},
    {id: 'a', kind: 'video', name: 'ep42.mp4', asset: 'ep42.mp4', start: 0, end: 28},
    {id: 'st', kind: 'sticker', start: 0, end: 9},
    {id: 'h', kind: 'video', start: 5, end: 9},
    {id: 'open', kind: 'video', start: 70, end: null},
  ];
  const segs = X.videoSegments(els, {h: {hidden: true}, a: {start: 0, end: 30}});
  assert.deepEqual(segs, [{id: 'a', start: 0, end: 30, name: 'ep42.mp4'}, {id: 'b', start: 40, end: 60, name: 'broll.mov'}]);
  assert.deepEqual(X.videoSegments([], {}), []);
  assert.equal(X.rangeOptions(segs)[1].label, '片段 2 · broll.mov · 0:40–1:00');
});

test('defaultRange：选中的视频元素 > 播放头所在 > 第一段', () => {
  assert.equal(X.defaultRange(CLIPS, [{kind: 'element', id: 'c3'}], 10), 'c3');
  assert.equal(X.defaultRange(CLIPS, [{kind: 'element', id: 'e1'}], 50), 'c2', '选中的不是片段就按播放头');
  assert.equal(X.defaultRange(CLIPS, [], 999), 'c1');
  assert.equal(X.defaultRange([], [], 0), null);
});

test('rangeSpan：整片与一段', () => {
  assert.deepEqual(X.rangeSpan(CLIPS, null, 206), {start: 0, end: 206, dur: 206, index: 0, whole: true});
  const s = X.rangeSpan(CLIPS, 'c2', 206);
  assert.equal(s.index, 2);
  assert.ok(Math.abs(s.dur - 33.4) < 1e-9);
});

test('estimate：§17.1 M122 的 k=2.10 ms/(帧·Mpx)，1080p ≈ 4.35 ms/帧', () => {
  const e = X.estimate(1080, '16:9', 206);
  assert.equal(e.frames, 6180);
  assert.ok(Math.abs(e.ms / e.frames - 4.3546) < 0.01);
  assert.equal(e.eta, '≈ 27 秒');
  assert.equal(e.size, '206 MB');
  const k = X.estimate(2160, '16:9', 206);
  assert.ok(k.ms > e.ms * 3.9 && k.ms < e.ms * 4.1);
  assert.equal(k.size, '773 MB');
  assert.equal(X.estimate(2160, '16:9', 6.74 * 3600).size, '91.0 GB');
  assert.equal(X.estimate(720, '16:9', 6.74 * 3600).eta, '≈ 23 分');
});

test('dims / resLabel：短边是分辨率的值，2160 念 4K', () => {
  assert.deepEqual(X.dims(1080, '16:9'), {w: 1920, h: 1080});
  assert.deepEqual(X.dims(1080, '9:16'), {w: 1080, h: 1920});
  assert.deepEqual(X.dims(720, '1:1'), {w: 720, h: 720});
  assert.deepEqual(X.dims(2160, '4:5'), {w: 2160, h: 2700});
  assert.equal(X.dims(1080, '2.35:1').w % 2, 0);
  // 认不出的画幅退 16:9，短边缺省 1080。
  assert.deepEqual(X.dims(0, 'Original'), {w: 1920, h: 1080});
  assert.equal(X.resLabel(2160), '4K');
  assert.equal(X.resLabel(1440), '1440p');
  assert.equal(X.resLabel(608), '608p');
});

test('sourceShort：原始分辨率按裁切后的画面算', () => {
  assert.equal(X.sourceShort('1920×1080', '16:9'), 1080);
  assert.equal(X.sourceShort('3840×2160', '16:9'), 2160);
  assert.equal(X.sourceShort('2560×1440', '16:9'), 1440);
  // 竖幅源导 16:9：裁掉上下，1080×608，短边 608——不是未裁的 1920。
  assert.equal(X.sourceShort('1080×1920', '16:9'), 608);
  assert.equal(X.sourceShort('1080×1920', '9:16'), 1080);
  // 横幅源导 9:16：裁掉左右，608×1080。
  assert.equal(X.sourceShort('1920×1080', '9:16'), 608);
  // 认不出画幅就按源自己的比例；探不到尺寸就是 null。
  assert.equal(X.sourceShort('1920×1080', 'Original'), 1080);
  assert.equal(X.sourceShort({w: 1280, h: 720}, '16:9'), 720);
  assert.equal(X.sourceShort(null, '16:9'), null);
});

test('exportShort：多个视频源取裁切后最高的短边，画幅跟舞台（2026-09-13）', () => {
  assert.equal(X.exportShort('640×360', [], '16:9'), 360);
  assert.equal(X.exportShort('640×360', ['1920×1080'], '16:9'), 1080);
  // 4:3 的 B-roll 放进 16:9 舞台要裁掉上下，只剩 810。
  assert.equal(X.exportShort('640×360', ['1440×1080'], '16:9'), 810);
  // 竖幅舞台：横幅 B-roll 裁成 608 宽。
  assert.equal(X.exportShort('640×360', ['1920×1080'], '9:16'), 608);
  // 比主视频低的源不拉低原始档；认不出画幅按主视频比例。
  assert.equal(X.exportShort('1920×1080', ['640×360'], 'Original'), 1080);
  assert.equal(X.exportShort('640×360', [{w: 1280, h: 720}], 'Original'), 720);
  // 没有主视频（2026-09-16）：转录源尺寸未知也从视频元素取；一个都不知道才 null。
  assert.equal(X.exportShort(null, ['1920×1080'], '16:9'), 1080);
  assert.equal(X.exportShort(null, ['1440×1080', '640×360'], 'Original'), 1080, '认不出画幅跟第一个认得出尺寸的源');
  assert.equal(X.exportShort(null, [], '16:9'), null);
  assert.equal(X.exportShort(undefined, [null, 'x'], '16:9'), null);
});

test('resChoices：原始分辨率在首位并带标注，比它高的一档都不给', () => {
  assert.deepEqual(X.resChoices(1080), [
    {short: 1080, label: '1080p', source: true},
    {short: 720, label: '720p', source: false},
  ]);
  assert.deepEqual(X.resChoices(2160).map((c) => c.short), [2160, 1080, 720]);
  assert.deepEqual(X.resChoices(1440).map((c) => c.label), ['1440p', '1080p', '720p']);
  // 裁出来只剩 608 短边：能给的只有原始那一档。
  assert.deepEqual(X.resChoices(608).map((c) => c.short), [608]);
  // 源尺寸未知：1080 兜底，没有哪一项标「原始」。
  assert.deepEqual(X.resChoices(null), [
    {short: 1080, label: '1080p', source: false},
    {short: 720, label: '720p', source: false},
  ]);
});

test('resolveShort：没挑过跟原始走，挑高了夹回来', () => {
  assert.equal(X.resolveShort(null, 1080), 1080);
  assert.equal(X.resolveShort(null, null), 1080);
  assert.equal(X.resolveShort(720, 1080), 720);
  // 挑过 4K 之后换了个只有 1080 的源（或把画幅裁小了）：夹回原始那一档。
  assert.equal(X.resolveShort(2160, 1080), 1080);
  assert.equal(X.resolveShort(1080, 608), 608);
  // 挑的那档已经不在清单里（画幅一变源短边涨了）：取不超过它的最大档。
  assert.equal(X.resolveShort(608, 1080), 720);
});

test('fmtEta：秒 / 分 / 小时三档', () => {
  assert.equal(X.fmtEta(400), '≈ 1 秒');
  assert.equal(X.fmtEta(90 * 1000), '≈ 2 分');
  assert.equal(X.fmtEta(125 * 60 * 1000), '≈ 2 小时 5 分');
});

test('lanes：配音组——背景声一组一份、组关了它也不进混音、原声行标已剥离', () => {
  const dubs = [{lang: 'en', langName: 'English', bed: true, blocks: [{status: 'done'}]}, {lang: 'ja', langName: '日本語', bed: true, blocks: [{status: 'done'}]}];
  const rows = TL.rows([], {subTracks: [], dubs, dubOff: {en: false, ja: true}, bedOff: {en: true, ja: false}}).rows;
  const ls = X.lanes(rows, {muted: true, dubOff: {en: false, ja: true}, bedOff: {en: true, ja: false}});
  assert.deepEqual(ls.filter((l) => l.kind === 'dub' || l.kind === 'bed').map((l) => [l.key, l.id, l.label, l.on]),
    [['dub:en', 'en', '配音 · English', true], ['bed:en', 'en', '背景声 · English', false],
     ['dub:ja', 'ja', '配音 · 日本語', false], ['bed:ja', 'ja', '背景声 · 日本語', false]], 'en 组开着但它的背景声自己关了；ja 整组关着，背景声跟着不进');
  const au = ls.find((l) => l.kind === 'audio');
  assert.deepEqual([au.label, au.on], ['原声', false]);
  assert.match(au.sub, /已被配音替下/);
  const sp = X.spanOf('all', {dur: 10});
  assert.deepEqual(X.summary(X.lanes(rows, {dubOff: {en: false, ja: true}, bedOff: {}}), {span: sp}).slice(-4), ['音频', '音乐', '配音', '背景声']);
  assert.deepEqual(X.summary(ls, {span: sp}).slice(-3), ['静音', '音乐', '配音'], '开着的组没有开着的背景声就不写');
});

test('summary / videoName / taskSub：随生效清单联动', () => {
  const ls = X.lanes(ROWS, {});
  const eff = X.apply(ls, {'subs:zh': false, 'subs:ja': true, 'el:e1': false});
  const span = X.rangeSpan(CLIPS, 'c3', 206);
  assert.deepEqual(X.summary(eff, {span, dims: {w: 1920, h: 1080}}),
    ['片段 3 · 2:08', '1920×1080', '日本語字幕', '1/2 个元素', '音频', '音乐']);
  assert.equal(X.videoName('kelang-ep42', eff, span), 'kelang-ep42 JA 片段3.mp4');
  assert.equal(X.taskSub(eff, {span, dims: {w: 1920, h: 1080}}), 'mp4 · 1920×1080 · 日本語字幕 · 片段 3');
  const none = X.apply(ls, {'subs:zh': false, 'subs:ja': false, 'el:e1': false, 'el:e2': false, audio: false, music: false});
  assert.deepEqual(X.summary(none, {span: X.rangeSpan(CLIPS, null, 206)}), ['整片 3:26', '无字幕', '无元素', '静音']);
  assert.equal(X.videoName('kelang-ep42', none, null), 'kelang-ep42.mp4');
});

test('subtitleNames：单轨一份、多轨默认合成、也可各出一份', () => {
  const ls = X.lanes(ROWS, {});
  const both = X.apply(ls, {'subs:ja': true});
  assert.deepEqual(X.subtitleNames('kelang-ep42', both, 'srt', true), ['kelang-ep42-zh-ja.srt']);
  assert.deepEqual(X.subtitleNames('kelang-ep42', both, 'vtt', false), ['kelang-ep42-zh.vtt', 'kelang-ep42-ja.vtt']);
  assert.deepEqual(X.subtitleNames('kelang-ep42', X.apply(ls, {}), 'srt', true), ['kelang-ep42-zh.srt']);
  assert.deepEqual(X.subtitleNames('kelang-ep42', X.apply(ls, {'subs:zh': false}), 'srt', true), []);
});

test('pillLabel / cancelCopy：按任务种类念对的那句话', () => {
  assert.equal(X.pillLabel({kind: 'export', pct: 37}), '导出 · 37%');
  assert.equal(X.pillLabel({kind: 'transcribe', pct: 45}), '转录 · 45%');
  assert.equal(X.pillLabel({kind: 'weird'}), '任务 · 0%');
  assert.equal(X.cancelCopy('export').confirmLabel, '取消导出');
  assert.match(X.cancelCopy('export').body, /视频本身不受影响/);
  assert.equal(X.cancelCopy('polish').title, '取消这个任务？');
  assert.equal(X.cancelCopy('download').confirmLabel, '取消下载');
});

test('cropRect：项目画面在目标画幅里居中 cover——横转竖裁两边、竖转横裁上下、同幅不裁', () => {
  const r = X.cropRect(16 / 9, 9 / 16);
  assert.equal(r.height, 100);
  assert.ok(Math.abs(r.width - 316.049) < 0.01);
  assert.ok(Math.abs(r.left + 108.025) < 0.01);
  assert.equal(r.cut, 'sides');
  const q = X.cropRect(16 / 9, 2.35);
  assert.equal(q.width, 100);
  assert.ok(Math.abs(q.height - 132.188) < 0.01);
  assert.equal(q.cut, 'topBottom');
  assert.deepEqual(X.cropRect(16 / 9, 16 / 9), {left: 0, top: 0, width: 100, height: 100, cut: null});
});

test('fitBox：按画幅在盒里放到最大', () => {
  assert.deepEqual(X.fitBox(330, 186, 16 / 9), {w: 330, h: 186});
  assert.deepEqual(X.fitBox(330, 186, 9 / 16), {w: 105, h: 186});
  assert.deepEqual(X.fitBox(0, 186, 1), {w: 0, h: 0});
});

test('offKeys：关着的轨与逐件元素', () => {
  const ls = X.lanes(ROWS, {hiddenEls: {e1: true}});
  assert.deepEqual(X.offKeys(X.apply(ls, {'subs:ja': false, audio: false})), {'subs:ja': true, 'el:e1': true, audio: true});
  assert.deepEqual(X.offKeys(X.apply(ls, {'el:e1': true, 'subs:ja': true})), {});
});

/* ---------- 第 239 轮：范围放宽 / 体积档 / ASS / 文稿 ---------- */

const CHAPTERS = [
  {id: 'c1', title: '开场', start: 0, end: 22},
  {id: 'c2', title: '现场访谈', start: 22, end: 95},
  {id: 'c3', title: '产品演示', start: 95, end: 158},
  {id: 'c4', title: '观点与总结', start: 158, end: 206},
];

test('parseT / fmtT / fileT：时间码往返，非法输入给 null', () => {
  assert.equal(X.parseT('1:05.5'), 65.5);
  assert.equal(X.parseT('0:45'), 45);
  assert.equal(X.parseT('1:02:03'), 3723);
  assert.equal(X.parseT('90'), 90);
  assert.equal(X.parseT('1:75'), null);
  assert.equal(X.parseT('abc'), null);
  assert.equal(X.parseT(''), null);
  assert.equal(X.fmtT(65.46), '1:05.5');
  assert.equal(X.fmtT(0), '0:00.0');
  assert.equal(X.fileT(78.4), '1m18s');
});

test('chapterOptions / defaultChapter：章号、起止、播放头命中', () => {
  const opts = X.chapterOptions(CHAPTERS);
  assert.equal(opts.length, 4);
  assert.equal(opts[1].label, '第 2 章 · 现场访谈');
  assert.equal(opts[1].time, '0:22–1:35');
  assert.equal(X.defaultChapter(CHAPTERS, 100), 'c3');
  assert.equal(X.defaultChapter(CHAPTERS, 999), 'c1');
  assert.deepEqual(X.toggleId(['c1'], 'c2'), ['c1', 'c2']);
  assert.deepEqual(X.toggleId(['c1', 'c2'], 'c1'), ['c2']);
});

test('spanOf：整片', () => {
  const s = X.spanOf('all', {dur: 206});
  assert.equal(s.whole, true);
  assert.equal(s.dur, 206);
  assert.equal(s.label, '整片 3:26');
  assert.equal(s.tag, '');
});

test('spanOf：单章 / 相邻多章合成一段 / 不相邻', () => {
  const one = X.spanOf('chapters', {chapters: CHAPTERS, ids: ['c2'], dur: 206});
  assert.equal(one.dur, 73);
  assert.equal(one.contiguous, true);
  assert.equal(one.label, '第 2 章 · 现场访谈 · 1:13');
  assert.equal(one.tag, ' 第2章');
  const adj = X.spanOf('chapters', {chapters: CHAPTERS, ids: ['c3', 'c2'], dur: 206});
  assert.equal(adj.runs.length, 1);
  assert.equal(adj.dur, 136);
  assert.equal(adj.label, '第 2–3 章 · 2:16');
  assert.equal(adj.tag, ' 第2-3章');
  const gap = X.spanOf('chapters', {chapters: CHAPTERS, ids: ['c1', 'c4'], dur: 206});
  assert.equal(gap.runs.length, 2);
  assert.equal(gap.contiguous, false);
  assert.equal(gap.label, '2 章 · 1:10 · 不相邻');
  assert.equal(gap.tag, ' 第1+4章');
  const none = X.spanOf('chapters', {chapters: CHAPTERS, ids: [], dur: 206});
  assert.equal(none.empty, true);
  assert.equal(none.label, '还没勾章节');
});

test('spanOf：片段多选与文件名后缀', () => {
  const s = X.spanOf('clips', {clips: CLIPS, ids: ['c1', 'c3'], dur: 206});
  assert.equal(s.segs.length, 2);
  assert.equal(s.contiguous, false);
  assert.equal(s.tag, ' 片段1+3');
  assert.equal(X.videoName('ep', [], s), 'ep 片段1+3.mp4');
  assert.deepEqual(X.spanFiles('ep', [], s, true), ['ep 片段1.mp4', 'ep 片段3.mp4']);
  assert.deepEqual(X.spanFiles('ep', [], s, false), ['ep 片段1+3.mp4']);
  const one = X.spanOf('clips', {clips: CLIPS, ids: ['c3'], dur: 206});
  assert.equal(one.short, '片段 3');
  assert.equal(X.videoName('ep', [], one), 'ep 片段3.mp4');
  const named = X.spanOf('clips', {clips: [{id: 'v', start: 0, end: 28, name: 'ep42.mp4'}], ids: ['v'], dur: 206});
  assert.equal(named.short, '片段 1', '元素名不进 short / 文件名');
  assert.equal(named.label, '片段 1 · 0:28');
});

test('spanOf：自定义起止钳位、最小 0.5s、整段即整片', () => {
  const s = X.spanOf('custom', {custom: {start: 45, end: 78.4}, dur: 206});
  assert.equal(s.dur, 33.4);
  assert.equal(s.label, '0:45.0–1:18.4 · 0:33');
  assert.equal(s.tag, ' 0m45s-1m18s');
  assert.equal(s.short, '0:45–1:18');
  assert.equal(X.videoName('ep', [], s), 'ep 0m45s-1m18s.mp4');
  assert.deepEqual(X.clampCustom(-3, 500, 206), {start: 0, end: 206});
  assert.deepEqual(X.clampCustom(100, 100.2, 206), {start: 100, end: 100.5});
  assert.deepEqual(X.clampCustom(206, 206, 206), {start: 205.5, end: 206});
  assert.equal(X.spanOf('custom', {custom: {start: 0, end: 206}, dur: 206}).whole, true);
});

test('summary / taskSub 认 spanOf 的 label 与 short', () => {
  const ls = X.lanes(ROWS, {});
  const s = X.spanOf('chapters', {chapters: CHAPTERS, ids: ['c2'], dur: 206});
  assert.equal(X.summary(ls, {span: s})[0], '第 2 章 · 现场访谈 · 1:13');
  assert.match(X.taskSub(ls, {span: s}), /第 2 章 · 现场访谈$/);
});

test('estimate：体积档只改体积不改耗时', () => {
  const std = X.estimate(1080, '16:9', 206);
  const small = X.estimate(1080, '16:9', 206, 'small');
  const high = X.estimate(1080, '16:9', 206, 'high');
  assert.equal(small.eta, std.eta);
  assert.equal(high.frames, std.frames);
  assert.equal(std.mbps, 8);
  assert.equal(small.mbps, 4);
  assert.equal(high.mbps, 12);
  assert.equal(small.size, '103 MB');
  assert.equal(high.size, '309 MB');
  assert.deepEqual(X.QUALITY_KEYS, ['small', 'standard', 'high']);
});

test('subtitleNames：ASS 扩展名，未知格式回退 srt', () => {
  const ls = X.apply(X.lanes(ROWS, {}), {'subs:ja': true});
  assert.deepEqual(X.subtitleNames('ep', ls, 'ass', true), ['ep-zh-ja.ass']);
  assert.deepEqual(X.subtitleNames('ep', ls, 'ASS', false), ['ep-zh.ass', 'ep-ja.ass']);
  assert.deepEqual(X.subtitleNames('ep', ls, 'sub', true), ['ep-zh-ja.srt']);
  assert.deepEqual(X.SUB_FORMATS.map((f) => f.k), ['srt', 'vtt', 'ass', 'json']);
  assert.deepEqual(X.subtitleNames('ep', ls, 'json', true), ['ep-zh-ja.json']);
});

test('文稿：语言选项、文件名、摘要', () => {
  const LANGS = [{code: 'zh', name: '中文', native: '中文', done: 100}, {code: 'ja', name: '日语', native: '日本語', done: 100}, {code: 'en', name: '英语', native: 'English', done: 40}];
  const opts = X.txLangOptions('zh', '中文', LANGS);
  assert.deepEqual(opts.map((o) => o.k), ['src', 'trans:ja', 'both:ja']);
  assert.equal(opts[2].sub, '中文 + 日本語');
  assert.equal(opts[1].label, '日本語');
  assert.deepEqual(X.txLangOptions('zh', '中文', []).map((o) => o.k), ['src']);
  /* 语言复选：至少留一行、译文一次只配一门 */
  let sel = {src: true, trans: null};
  assert.equal(X.txLangLocked(sel, 'src'), true);
  assert.equal(X.txLangToggle(sel, 'src'), sel);
  sel = X.txLangToggle(sel, 'ja');
  assert.equal(X.txLangPick(sel, opts).k, 'both:ja');
  assert.equal(X.txLangLocked(sel, 'src') || X.txLangLocked(sel, 'ja'), false);
  sel = X.txLangToggle(sel, 'src');
  assert.equal(X.txLangPick(sel, opts).k, 'trans:ja');
  assert.equal(X.txLangLocked(sel, 'ja'), true);
  assert.deepEqual(X.txLangToggle({src: true, trans: 'ja'}, 'ko'), {src: true, trans: 'ko'});
  assert.equal(X.txLangPick(X.txLangToggle({src: true, trans: 'ja'}, 'ja'), opts).k, 'src');
  assert.equal(X.transcriptName('ep', opts[0], 'md', 'zh'), 'ep-transcript-zh.md');
  assert.equal(X.transcriptName('ep', opts[1], 'txt', 'zh'), 'ep-transcript-ja.txt');
  assert.equal(X.transcriptName('ep', opts[2], 'md', 'zh'), 'ep-transcript-zh-ja.md');
  assert.deepEqual(X.transcriptSummary(opts[2], 'md', {chapters: true, time: true, speaker: false, skipCut: true}),
    ['Markdown', '双语对照', '章节标题', '段落时间戳', '跳过已剪段']);
  assert.deepEqual(X.transcriptSummary(opts[0], 'md', {frontmatter: true, time: true}), ['Markdown', '原文', '文首元信息', '段落时间戳']);
  assert.deepEqual(X.transcriptSummary(opts[0], 'txt', {frontmatter: true}), ['纯文本', '原文']);
});

test('stepIn / inRuns：预览播放只走选中的区间', () => {
  const runs = [{start: 22, end: 95}, {start: 158, end: 206}];
  assert.equal(X.inRuns(50, runs), true);
  assert.equal(X.inRuns(100, runs), false);
  assert.equal(X.stepIn(50, 0.1, runs), 50.1);
  assert.equal(X.stepIn(94.9, 0.1, runs), 158, '出了第一段跳到下一段开头');
  assert.equal(X.stepIn(205.9, 0.1, runs), 22, '走完回到第一段');
  assert.equal(X.stepIn(100, 0.1, runs), 158, '不在任何段里就去下一段');
  assert.equal(X.stepIn(10, 0.1, []), 10.1);
});

test('PROJECT_TARGETS：七个目标，扩展名与 §4.3 的烘焙格式认领对得上', () => {
  assert.equal(X.PROJECT_TARGETS.length, 7);
  const byId = Object.fromEntries(X.PROJECT_TARGETS.map((t) => [t.id, t]));
  assert.equal(byId.premiere.ext, '.xml', 'Premiere 是 FCP7 XML，不是 .prproj');
  assert.equal(byId.resolve.ext, '.fcpxml');
  assert.equal(byId.resolve.altExt, '.xml');
  assert.equal(byId['final-cut-pro'].ext, '.fcpxml');
  assert.equal(byId.shotcut.ext, '.mlt');
  assert.equal(byId.kdenlive.ext, '.kdenlive');
  assert.equal(byId.jianying.isDirectory, true);
  assert.equal(byId.capcut.isDirectory, true);
  assert.deepEqual(X.bakeFormatsFor(byId.capcut), ['mov']);
  assert.deepEqual(X.bakeFormatsFor(byId['final-cut-pro']), ['mov']);
  // PNG 序列只有 MLT（Shotcut / Kdenlive）写得成图像序列；Premiere / Resolve 只认 .mov。
  assert.deepEqual(X.bakeFormatsFor(byId.premiere), ['mov']);
  assert.deepEqual(X.bakeFormatsFor(byId.resolve), ['mov']);
  assert.deepEqual(X.bakeFormatsFor(byId.shotcut), ['mov', 'webm', 'png']);
  assert.deepEqual(X.bakeFormatsFor(byId.kdenlive), ['mov', 'webm', 'png']);
  assert.deepEqual(X.bakeFormatsFor(null), []);
});

test('targetMeta：目录 / 扩展名 / 可选兜底扩展名 / 可直接安装', () => {
  const byId = Object.fromEntries(X.PROJECT_TARGETS.map((t) => [t.id, t]));
  assert.equal(X.targetMeta(byId.jianying), '目录 · .capcut · 可直接安装打开');
  assert.equal(X.targetMeta(byId.premiere), '.xml');
  assert.equal(X.targetMeta(byId.resolve), '.fcpxml（可选 .xml）');
});

test('elementDelivery：sticker / placeholder 按有没有源件判，算法元素按策略判', () => {
  assert.equal(X.elementDelivery({kind: 'video'}, 'auto'), 'native');
  assert.equal(X.elementDelivery({kind: 'sticker', asset: 'a.svg'}, 'auto'), 'native');
  assert.equal(X.elementDelivery({kind: 'sticker'}, 'auto'), 'baked');
  assert.equal(X.elementDelivery({kind: 'sticker'}, 'none'), 'dropped');
  assert.equal(X.elementDelivery({kind: 'placeholder', srcId: 'x'}, 'auto'), 'native');
  assert.equal(X.elementDelivery({kind: 'placeholder'}, 'auto'), 'baked');
  assert.equal(X.elementDelivery({kind: 'placeholder'}, 'none'), 'dropped');
  assert.equal(X.elementDelivery({kind: 'shape'}, 'auto'), 'baked');
  assert.equal(X.elementDelivery({kind: 'shape'}, 'lossy'), 'baked');
  assert.equal(X.elementDelivery({kind: 'shape'}, 'none'), 'dropped');
  assert.equal(X.elementDelivery({kind: 'counter'}, 'auto'), 'baked');
});

test('deliverySummary：三档计数 + 放弃清单；hidden 元素跳过，不进任何一档', () => {
  const els = [
    {id: 'v1', kind: 'video', name: '视频'},
    {id: 'e-shp', kind: 'shape', name: '形状 · 圆角矩形'},
    {id: 'e-prg', kind: 'progress', name: '进度条'},
    {id: 'e-stk', kind: 'sticker', name: '贴纸 · 麦克风', asset: 'podcast-02.svg'},
    {id: 'e-hidden', kind: 'shape', name: '隐藏形状', hidden: true},
  ];
  const auto = X.deliverySummary(els, 'auto');
  assert.deepEqual(auto, {native: 2, baked: 2, dropped: 0, skipped: 1, droppedNames: []});
  const none = X.deliverySummary(els, 'none');
  assert.equal(none.native, 2);
  assert.equal(none.baked, 0);
  assert.equal(none.dropped, 2);
  assert.deepEqual(none.droppedNames, ['形状 · 圆角矩形', '进度条']);
  assert.deepEqual(X.deliverySummary([], 'auto'), {native: 0, baked: 0, dropped: 0, skipped: 0, droppedNames: []});
});

test('用哪台电脑导出（J4）：上传 + 那边导出与本机比，缓存过的不再传', () => {
  const b = X.uploadBytes({duration: 100});
  assert.equal(b, Math.round(100 * 1e6 * 1.15));
  assert.equal(X.uploadBytes({mediaBytes: 5e8, cachedBytes: 3e8}), 2e8);
  assert.equal(X.uploadBytes({mediaBytes: 1e8, cachedBytes: 3e8}), 0);
  const fast = X.remoteEstimate(600000, 6e8, 2, 60e6);
  assert.equal(Math.round(fast.uploadMs), 10000);
  assert.equal(fast.remoteMs, 300000);
  assert.equal(fast.faster, true);
  assert.ok(fast.uploadShare > 0 && fast.uploadShare < 0.1);
  const slow = X.remoteEstimate(20000, 6e9, 2, 60e6);
  assert.equal(slow.faster, false, '素材太大、片子太短：本机更快');
  assert.match(X.remoteNote('mac-studio.local', slow, 20000), /这次在本机导出更快$/);
  assert.doesNotMatch(X.remoteNote('mac-studio.local', fast, 600000), /本机导出更快/);
});
