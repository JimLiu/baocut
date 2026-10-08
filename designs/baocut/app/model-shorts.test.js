const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-shorts.js');
require('./model-template.js');
const S = global.window.BC_SHORTS;
const T = global.window.BC_TPL;

test('安全区：竖屏平台款（抖音 / 小红书）的每一层都落在安全框里——两边共用一组数', () => {
  const plat = T.BUILTINS.filter((t) => t.group === 'douyin' || t.group === 'xhs');
  assert.ok(plat.length >= 4);
  plat.forEach((t) => {
    assert.equal(t.ratio, S.RATIO, t.id);
    t.layers.forEach((l) => assert.ok(S.inSafe(l.box), `${t.id}/${l.id} 越出安全框`));
  });
});

test('安全框 = 画面减去三块遮挡区；三块互不重叠、拼起来贴满画面边缘', () => {
  assert.deepEqual(S.safeBox(), {x: 6, y: 8, w: 76, h: 68});
  const z = S.zones();
  assert.deepEqual(z.map((x) => x.k), ['top', 'right', 'bottom']);
  const [top, right, bottom] = z;
  assert.equal(top.y + top.h, right.y);
  assert.equal(right.y + right.h, bottom.y);
  assert.equal(bottom.y + bottom.h, 100);
  assert.equal(right.x + right.w, 100);
  assert.ok(!S.inSafe({x: 70, y: 4, w: 24, h: 3.2}), '通用竖屏款右上计数压在状态栏与按钮列上');
});

test('只有竖幅才有平台安全区', () => {
  assert.ok(S.isPortrait('9:16'));
  assert.ok(S.isPortrait('3:4'));
  assert.ok(!S.isPortrait('16:9'));
  assert.ok(!S.isPortrait('1:1'));
  assert.ok(!S.isPortrait('自定义'));
});

test('从一句话里看出 Shorts；光说「竖屏」或「短片」不算；亲手拨过就听用户的', () => {
  ['做一条竖屏数学短视频', '发抖音的贴纸动画', '一条 YouTube Shorts', 'a TikTok about tides', '做成视频号竖屏短片'].forEach((t) => assert.ok(S.detect(t), t));
  ['做一条 30 秒的竖屏倒计时开场', '把这篇读书笔记做成剪贴簿风格的短片', '讲解导数的几何意义'].forEach((t) => assert.ok(!S.detect(t), t));
  assert.deepEqual(S.effective(null, '抖音短视频'), {on: true, by: 'guess'});
  assert.deepEqual(S.effective(false, '抖音短视频'), {on: false, by: 'pick'});
  assert.deepEqual(S.effective(true, '讲导数'), {on: true, by: 'pick'});
  assert.deepEqual(S.effective(null, '讲导数'), {on: false, by: null});
});

test('时长只剩两档，缺省约 30 秒；流程条是六步加读材料', () => {
  const all = [{k: 's'}, {k: 'm'}, {k: 'l'}, {k: 'auto'}];
  assert.deepEqual(S.lengths(all).map((l) => l.k), ['s', 'm']);
  assert.equal(S.clampLength('auto'), 's');
  assert.equal(S.clampLength('l'), 's');
  assert.equal(S.clampLength('m'), 'm');
  assert.deepEqual(S.pipeline({}).map((x) => x.k), ['script', 'voice', 'build', 'sfx', 'check', 'review']);
  assert.equal(S.pipeline({attachments: 2})[0].k, 'read');
  assert.match(S.promptLine('约 1 分钟'), /^按 Shorts 做：9:16，约 1 分钟；/);
  assert.match(S.promptLine(), /不加求关注的结尾/);
});

test('原型安全区的遮罩与安全框互补，边界归一化为画面百分比', () => {
  assert.deepEqual(S.SAFE, {top: 8, right: 18, bottom: 24, side: 6});
  const box = S.safeBox();
  assert.equal(box.x + box.w + S.SAFE.right, 100);
  assert.equal(box.y + box.h + S.SAFE.bottom, 100);
});

test('项目标记：delivery = shorts 才算，缺席即常规（旧的 shorts: true 不认）', () => {
  assert.ok(S.isShorts({delivery: 'shorts'}));
  assert.ok(!S.isShorts({}));
  assert.ok(!S.isShorts({shorts: true}));
  assert.ok(!S.isShorts(null));
  assert.ok(S.checkVisible('9:16', {}));
  assert.ok(S.checkVisible('16:9', {delivery: 'shorts'}));
  assert.ok(!S.checkVisible('16:9', {}));
});

test('字幕块几何：5.5% 画宽 = 77 号字；居中又不压按钮列最宽 64；块按两行、下沿钉锚线', () => {
  assert.equal(S.sizeForWidth(5.5), 77);
  assert.ok(Math.abs(S.fontPct(77) - 5.5) < 0.05);
  assert.equal(S.centeredWidth(), 64);
  const b = S.subBlock({size: 32, lh: 100, y: 80, valign: 'bottom'}, 9 / 16);
  assert.equal(b.w, 84);
  assert.equal(b.x, 8);
  assert.ok(Math.abs(b.y + b.h - 80) < 1e-9);
  assert.ok(Math.abs(b.h - 2 * (20 / 880 * 100) * 9 / 16) < 1e-9);
  const c = S.subBlock({size: 32, lh: 100, y: 50, valign: 'center'}, 9 / 16);
  assert.ok(Math.abs(c.y + c.h / 2 - 50) < 1e-9);
});

test('Shorts 字幕落位：最下一块下沿贴 74，往上叠，字号按比例缩放到 5.5%，全部落在安全框里', () => {
  const tracks = [{id: 'en', size: 44, y: 86, lh: 110}, {id: 'zh', size: 32, y: 93, lh: 110, role: 'source'},
    {id: 'ja', size: 32, y: 50, hidden: true}];
  const L = S.captionLayout(tracks, 9 / 16);
  assert.deepEqual(Object.keys(L).sort(), ['en', 'zh']);
  assert.equal(L.zh.y, 74);
  assert.equal(L.en.size, 77);
  assert.equal(L.zh.size, 56);
  assert.ok(L.en.y < L.zh.y);
  tracks.filter((t) => !t.hidden).forEach((t) => {
    const b = S.subBlock(Object.assign({}, t, L[t.id]), 9 / 16);
    assert.ok(S.inSafe(b), t.id + ' 越出安全框');
  });
  // 单轨：5.5% 字号、宽 60、居中
  const one = S.captionLayout([{id: 'zh', size: 32, y: 86, lh: 110}], 9 / 16);
  assert.deepEqual(one.zh, {y: 74, valign: 'bottom', size: 77, width: 60});
  assert.deepEqual(S.captionLayout([], 9 / 16), {});
});

const base = () => ({
  ratio: '9:16', span: {start: 0, end: 40, dur: 40},
  cues: [{start: 0.4, end: 3, text: '先说结论'}, {start: 37, end: 40, text: '就是这么简单'}],
  subTracks: [Object.assign({id: 'zh', name: '中文', role: 'source', on: true, lh: 110}, S.captionLayout([{id: 'zh', size: 32, y: 86, lh: 110}], 9 / 16).zh)],
  texts: [], loop: false, loudness: null,
});

test('发布前检查：行序与规则 id 恒为契约 3 那九条，状态只在五态里', () => {
  const rows = S.checkRows(base());
  assert.deepEqual(rows.map((r) => r.rule), S.CHECK_RULES);
  assert.deepEqual(S.CHECK_RULES, ['aspect', 'duration', 'first-frame', 'hook-3s', 'safe-area', 'subtitles', 'loop', 'loudness', 'ending']);
  rows.forEach((r) => assert.ok(S.CHECK_STATUS.includes(r.status), r.rule));
  assert.deepEqual(rows.map((r) => r.status), ['ok', 'ok', 'skip', 'ok', 'ok', 'ok', 'skip', 'skip', 'ok']);
  assert.deepEqual(S.checkSummary(rows), {ok: 6, warn: 0, error: 0, info: 0, skip: 3});
  assert.equal(S.checkHeadline(S.checkSummary(rows)), '能查的都过了 · 3 项要成片才能查');
  assert.equal(S.checkHeadline({ok: 3, warn: 2, error: 1, info: 1, skip: 0}), '1 项不合格 · 2 项建议改');
  assert.deepEqual(Object.keys(S.CHECK_STATUS_LABEL), S.CHECK_STATUS);
  assert.deepEqual(S.checkRows({}).map((r) => r.rule), S.CHECK_RULES);
});

test('发布前检查：画幅 error、时长与开口与结尾 warn、跳转指针', () => {
  const p = base();
  p.ratio = '16:9';
  p.span = {start: 10, end: 100, dur: 90};
  p.cues = [{start: 14, end: 16, text: '开场晚了'}, {start: 97.5, end: 100, text: '记得点赞关注'}];
  const by = Object.fromEntries(S.checkRows(p).map((r) => [r.rule, r]));
  assert.equal(by.aspect.status, 'error');
  assert.deepEqual(by.aspect.pointer, {kind: 'ratio'});
  assert.equal(by.duration.status, 'warn');
  assert.match(by.duration.message, /超过 60 秒/);
  assert.equal(by['hook-3s'].status, 'warn');
  assert.deepEqual(by['hook-3s'].pointer, {kind: 'time', t: 10});
  assert.equal(by.ending.status, 'warn');
  assert.match(by.ending.message, /点赞/);
  assert.equal(by.ending.at, 97.5);
  const en = base();
  en.cues = [{start: 38, end: 40, text: '好', trans: "Don't forget to subscribe"}];
  assert.equal(S.checkRows(en).find((r) => r.rule === 'ending').status, 'warn');
  const likely = base();
  likely.cues = [{start: 38, end: 40, text: '好', trans: 'Most likely it works'}];
  assert.equal(S.checkRows(likely).find((r) => r.rule === 'ending').status, 'ok', 'likely 不算 like');
});

test('发布前检查：字幕块落在底部文案区 → safe-area warn，带 at 与 pointer；文字元素压按钮列同样算', () => {
  const p = base();
  p.subTracks = [{id: 'zh', name: '中文', role: 'source', on: true, size: 32, y: 86, valign: 'bottom'}];
  p.texts = [{id: 'e-cnt', label: '计时 · 倒计时', box: {x: 70, y: 20, w: 20, h: 5}, start: 5, end: 9}];
  const r = S.checkRows(p).find((x) => x.rule === 'safe-area');
  assert.equal(r.status, 'warn');
  assert.equal(r.at, 0.4);
  assert.deepEqual(r.pointer, {kind: 'subs', trackId: 'zh'});
  assert.match(r.message, /中文字幕压到「账号 · 文案 · 评论」 · 另有 1 处/);
  p.subTracks[0].name = 'English';
  assert.match(S.checkRows(p).find((x) => x.rule === 'safe-area').message, /^English 字幕压到/);
  assert.equal(r.hits[1].zone, '点赞 · 评论 · 分享');
  assert.deepEqual(r.hits[1].pointer, {kind: 'element', id: 'e-cnt'});
  // 不烧入的轨不查；导出时间段外的元素不查
  p.subTracks[0].on = false;
  p.texts[0].start = 50; p.texts[0].end = 60;
  const q = S.checkRows(p);
  assert.equal(q.find((x) => x.rule === 'safe-area').status, 'ok');
  assert.equal(q.find((x) => x.rule === 'subtitles').status, 'warn');
  assert.match(q.find((x) => x.rule === 'subtitles').message, /不烧入/);
  p.subTracks = [];
  assert.match(S.checkRows(p).find((x) => x.rule === 'subtitles').message, /没有字幕轨/);
});

test('发布前检查：响度只印实测值、状态恒为 info，不带任何目标数；循环与首帧要渲染 → skip', () => {
  const p = base();
  p.loudness = {lufs: -15.2, tp: -1.8, file: 'a.mp4'};
  p.loop = true;
  const by = Object.fromEntries(S.checkRows(p).map((r) => [r.rule, r]));
  assert.equal(by.loudness.status, 'info');
  assert.equal(by.loudness.message, 'a.mp4 实测 −15.2 LUFS · 真峰值 −1.8 dBTP');
  assert.doesNotMatch(by.loudness.message, /目标|−14|−16|−23/);
  assert.deepEqual(by.loudness.value, {lufs: -15.2, tp: -1.8});
  assert.equal(by.loop.status, 'skip');
  assert.match(by.loop.message, /首末/);
  assert.equal(by['first-frame'].status, 'skip');
  assert.equal(S.checkRows(base()).find((r) => r.rule === 'loudness').status, 'skip');
});

test('导出 Shorts 快捷设置：一行说明、只把源语言字幕烧入、封面文件名、是否已套用', () => {
  assert.equal(S.presetLine(), '1080×1920 · 30 fps · H.264 · 字幕烧入 · 封面另存');
  assert.deepEqual(S.EXPORT_PRESET, {ratio: '9:16', short: 1080, fps: 30, codec: 'H.264', subs: 'burn', cover: {t: 0, fmt: 'png'}});
  const lanes = [{key: 'subs:en', kind: 'subs', role: 'translation'}, {key: 'subs:zh', kind: 'subs', role: 'source'}, {key: 'els', kind: 'els'}];
  assert.deepEqual(S.presetOverrides(lanes, {'subs:en': false}), {'subs:en': false, 'subs:zh': true});
  assert.deepEqual(S.presetOverrides([{key: 'subs:ja', kind: 'subs', role: 'translation'}], {}), {'subs:ja': true});
  assert.deepEqual(S.presetOverrides([], {a: 1}), {a: 1});
  assert.equal(S.coverName('kelang'), 'kelang-cover.png');
  assert.equal(S.presetNote(608), '源裁成竖屏最高 608p，不放大');
  assert.equal(S.presetNote(1080), '');
  assert.ok(S.presetMatches({ratio: '9:16', resPick: 1080, subsOn: true, cover: true}));
  assert.ok(!S.presetMatches({ratio: '9:16', resPick: 720, subsOn: true, cover: true}));
  assert.ok(!S.presetMatches({ratio: '9:16', resPick: 1080, subsOn: true, cover: false}));
});

test('切 Shorts：读出条数、切片版流程条、交给 Agent 的一行写明每支一部新视频与来源片段', () => {
  assert.equal(S.cutCount('把这期切成三条 Shorts'), 3);
  assert.equal(S.cutCount('cut 5 个短视频'), 5);
  assert.equal(S.cutCount('切两支抖音'), 2);
  assert.equal(S.cutCount('切几条 Shorts'), null);
  assert.deepEqual(S.cutPipeline().map((s) => s.label), ['读转录', '挑钩子段', '切段并换 9:16', '字幕与安全区', '发布前检查', '你来挑']);
  assert.equal(S.cutPipeline().slice(-1)[0].by, 'you');
  const line = S.cutPromptLine(3);
  assert.match(line, /^切成 3 条 Shorts：/);
  assert.match(line, /每支一部新视频/);
  assert.match(line, /原片里的起止/);
  assert.match(S.cutPromptLine(null), /^切成几条 Shorts：/);
  assert.equal(S.cutGrammarLine(), '每支一部新视频 · 9:16 · 不超过 60 秒 · 从看点起 · 记下来源片段');
});
