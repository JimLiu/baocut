const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-tts.js');
const TTS = global.window.BC_TTS;

test('引擎 + 音色方式 → 模型 id；只有 Qwen3-TTS 分预设 / 克隆', () => {
  assert.equal(TTS.modelFor('qwen3', 'preset'), 'qwen3-tts-0.6b-customvoice');
  assert.equal(TTS.modelFor('qwen3', 'clone'), 'qwen3-tts-0.6b-base');
  assert.equal(TTS.modelFor('indextts2', 'preset'), 'indextts2');
  assert.equal(TTS.modelFor('indextts25', 'preset'), 'index-tts2.5');
  assert.equal(TTS.modelFor('gptsovits', 'clone'), 'gpt-sovits-v2');
  assert.deepEqual(TTS.voiceModes('indextts2'), ['clone']);
  assert.deepEqual(TTS.voiceModes('gptsovits'), ['clone']);
  assert.equal(TTS.cloneOnly('qwen3'), false);
  assert.equal(TTS.cloneOnly('indextts25'), true);
  assert.equal(TTS.hasEmotion('indextts25'), true);
  assert.equal(TTS.hasEmotion('gptsovits'), false);
  assert.equal(TTS.hasEmotion('qwen3'), false);
  assert.equal(TTS.engineName('gptsovits'), 'GPT-SoVITS');
  TTS.ENGINES.filter((e) => e.model).forEach((e) => assert.equal(TTS.MODELS[e.model].engine, e.id, e.id));
  assert.deepEqual(TTS.voiceModes('qwen3'), ['preset', 'clone']);
  assert.equal(TTS.PRESETS.length, 9);
  assert.equal(TTS.EMOTIONS.length, 10);
});

test('校验：空文字、克隆缺参考、情绪另给一段音频却没选', () => {
  assert.deepEqual(TTS.validate({text: '', engine: 'qwen3', mode: 'preset'}), ['先写要合成的文字']);
  assert.deepEqual(TTS.validate({text: '你好', engine: 'qwen3', mode: 'preset', preset: 'Vivian'}), []);
  assert.equal(TTS.validate({text: '你好', engine: 'qwen3', mode: 'clone'})[0], '克隆声音要先给参考音频');
  // 2026-09-21：只能克隆的引擎也有默认音色了，不给参考不再是错
  assert.deepEqual(TTS.validate({text: '你好', engine: 'indextts2'}), []);
  assert.deepEqual(TTS.validate({text: '你好', engine: 'indextts2', ref: {name: 'a.wav'}, emotion: 'ref'}), [], '跟参考音频不用另给');
  const errs = TTS.validate({text: '你好', engine: 'indextts2', ref: {name: 'a.wav'}, emotion: 'ref2'});
  assert.deepEqual(errs, ['情绪选了另给一段音频，先把那段音频选上']);
  assert.deepEqual(TTS.validate({text: '你好', engine: 'indextts25'}), []);
  assert.deepEqual(TTS.validate({text: '你好', engine: 'gptsovits', ref: {name: 'a.wav'}, emotion: 'ref2'}), [], 'GPT-SoVITS 没有情绪');
  assert.equal(TTS.validate({text: 'x'.repeat(2001), engine: 'qwen3', mode: 'preset'})[0], '一次最多 2000 字，超出的分两次');
});

test('GPT-SoVITS 参考音频：带参考文本才限 3–10 秒，时长未知不拦', () => {
  const f = {text: '你好', engine: 'gptsovits', refText: '参考原文'};
  assert.deepEqual(TTS.validate({...f, ref: {name: 'a.wav', dur: 6.2}}), []);
  assert.deepEqual(TTS.validate({...f, ref: {name: 'a.wav', dur: 12}}),
    ['GPT-SoVITS 带参考文本时参考音频要 3–10 秒（现在 12.0 秒）；清空参考文本也能念']);
  assert.deepEqual(TTS.validate({...f, refText: ' ', ref: {name: 'a.wav', dur: 12}}), [], '不带参考文本只取音色');
  assert.deepEqual(TTS.validate({...f, ref: {name: 'a.wav'}}), []);
  assert.equal(TTS.validatePreview({...f, ref: {name: 'a.wav', dur: 2}}).length, 1);
  assert.equal(TTS.refProblem({engine: 'indextts25', refText: 'x', ref: {name: 'a.wav', dur: 20}}), null);
});

test('生成表单的语言 Picker 跟着引擎收窄', () => {
  const codes = (e) => TTS.formLangs(e).map((l) => l.code);
  assert.deepEqual(codes('qwen3'), ['auto', 'zh', 'en', 'ja', 'ko']);
  assert.deepEqual(codes('indextts2'), ['auto', 'zh', 'en']);
  assert.deepEqual(codes('indextts25'), ['auto', 'zh', 'en', 'ja']);
  assert.deepEqual(codes('gptsovits'), ['auto', 'zh', 'en']);
});

test('分段：按句末标点与换行切，小数点不切', () => {
  assert.deepEqual(TTS.segments('欢迎回到科浪。这一期聊本地优先！你觉得呢？'), ['欢迎回到科浪。', '这一期聊本地优先！', '你觉得呢？']);
  assert.deepEqual(TTS.segments('Version 1.5 ships today. Thanks.'), ['Version 1.5 ships today.', 'Thanks.']);
  assert.deepEqual(TTS.segments('第一行\n\n第二行'), ['第一行', '第二行']);
  assert.deepEqual(TTS.segments(''), []);
});

test('时长估算：中文按字、英文按词，标点加停顿', () => {
  assert.equal(TTS.estimateDuration(''), 0);
  const zh = TTS.estimateDuration('欢迎回到科浪，这一期我们聊一个老话题的新做法。');
  assert.ok(zh > 4 && zh < 7, String(zh));
  const en = TTS.estimateDuration('Let us start with speech recognition.');
  assert.ok(en > 2 && en < 3.5, String(en));
});

test('生成阶段：加载 → 第 n/N 段 → 完成', () => {
  assert.deepEqual(TTS.genPhase(0, 3).cur, 0);
  assert.equal(TTS.genPhase(12, 3).label, '合成第 1/3 段');
  assert.equal(TTS.genPhase(70, 3).label, '合成第 2/3 段');
  assert.equal(TTS.genPhase(99, 3).label, '合成第 3/3 段');
  assert.equal(TTS.genPhase(100, 3).cur, 2);
  assert.equal(TTS.genPhase(0, 3, 'MiniMax').label, '连接 MiniMax');
  assert.equal(TTS.genPhase(70, 3, 'MiniMax').label, '发送第 2/3 段');
  assert.deepEqual(TTS.genStages('MiniMax'), ['连接', '发送', '完成']);
  assert.deepEqual(TTS.genStages(null), TTS.GEN_STAGES);
});

test('素材卡记录：tts-N.wav、来源章 TTS、meta 带引擎与耗时', () => {
  const s = TTS.asSource({text: '你好，世界。', engine: 'qwen3', mode: 'preset', preset: 'Serena'}, 7, '3.2 秒');
  assert.equal(s.id, 'tts7');
  assert.equal(s.name, 'tts-7.wav');
  assert.equal(s.badge, 'TTS');
  assert.match(s.meta, /^00:0\d · 48 kHz · Qwen3-TTS · 3\.2 秒$/);
  assert.equal(s.tts.preset, 'Serena');
  assert.equal(TTS.genSub({text: '你好。再见。', engine: 'qwen3', mode: 'preset', preset: 'Serena'}), 'Qwen3-TTS · 预设 · Serena · 2 段');
  assert.equal(TTS.genSub({text: '你好。', engine: 'indextts2', ref: {name: 'me.wav'}}), 'IndexTTS2 · 克隆 · me.wav · 1 段');
  assert.equal(TTS.genSub({text: '你好。', engine: 'gptsovits', mode: 'preset', ref: {name: 'me.wav'}}), 'GPT-SoVITS · 克隆 · me.wav · 1 段');
});

test('分离窗数：206 秒 → 27 窗', () => {
  assert.equal(TTS.sepWindows(206), 27);
  assert.equal(TTS.sepWindows(7.8), 1);
  assert.equal(TTS.sepWindows(0), 1);
});

test('配音阶段：按出现的阶段归一权重、不分离时跳过、要翻译时前面多一段', () => {
  const o = {sentences: 62, duration: 206, speakerAt: (i) => (i === 0 ? '林澈' : '周远')};
  assert.deepEqual(TTS.dubStages(o), ['分离人声与背景', '逐句合成', '时间对齐', '写入时间轴']);
  assert.equal(TTS.dubPhase(0, o).label, '分离 1/27 窗');
  assert.match(TTS.dubPhase(0, {...o, sepAt: 'mac-studio.local'}).activity, /^在 mac-studio\.local 上 · HTDemucs-FT/, '分离交给节点时活动行点名机器');
  assert.match(TTS.dubPhase(0, o).activity, /^HTDemucs-FT/);
  assert.equal(TTS.dubPhase(29, o).cur, 0);
  const p = TTS.dubPhase(30, o);
  assert.equal(p.cur, 1);
  assert.equal(p.activity, '合成第 1/62 句 · 林澈');
  assert.equal(TTS.dubPhase(84, o).label, '合成第 61/62 句');
  assert.equal(TTS.dubPhase(86, o).cur, 2);
  assert.equal(TTS.dubPhase(96, o).cur, 3);
  assert.equal(TTS.dubPhase(100, o).cur, 3);
  assert.equal(TTS.dubPhase(100, Object.assign({langName: 'English'}, o)).activity, '写「配音 · English」轨与「背景声」轨');
  const noSep = Object.assign({separate: false}, o);
  assert.deepEqual(TTS.dubStages(noSep), ['逐句合成', '时间对齐', '写入时间轴']);
  assert.equal(TTS.dubPhase(0, noSep).key, 'synth');
  const tr = Object.assign({translate: true, langName: '日本語'}, o);
  assert.equal(TTS.dubStages(tr).length, 5);
  assert.equal(TTS.dubPhase(0, tr).label, '翻译第 1/62 句');
  assert.equal(TTS.dubPhase(10, tr).cur, 0);
  assert.equal(TTS.dubPhase(17, tr).key, 'separate', '翻译占 20/120');
});

test('时间适配：默认不截断只加速、借空档、快过 1.35× 标 fast；截断策略保留旧行为', () => {
  const base = {overrun: false, fast: false, cut: false};
  assert.deepEqual(TTS.fitSentence(4, 5, 'compress'), {rate: 1, dur: 4, ...base});
  assert.deepEqual(TTS.fitSentence(6, 5, 'compress'), {rate: 1.2, dur: 5, ...base});
  // 10 秒的合成音、5 秒槽位、下一句 8 秒后才开口：1.35× 压到 7.41 秒装得进空档 → 借空档，不过快
  assert.deepEqual(TTS.fitSentence(10, 5, 'compress', 8), {rate: 1.35, dur: 7.41, overrun: true, fast: false, cut: false});
  // 空档只到 6 秒：1.35× 装不下，继续加速到 6 秒装下 → 过快
  assert.deepEqual(TTS.fitSentence(10, 5, 'compress', 6), {rate: 1.67, dur: 6, overrun: true, fast: true, cut: false});
  // 7 秒合成音、5 秒槽位、空档到 8 秒：1.35× 压到 5.19 秒装得进空档，借空档但不算过快
  assert.deepEqual(TTS.fitSentence(7, 5, 'compress', 8), {rate: 1.35, dur: 5.19, overrun: true, fast: false, cut: false});
  const hard = TTS.fitSentence(10, 5, 'compress');
  assert.deepEqual(hard, {rate: 2, dur: 5, overrun: false, fast: true, cut: false});
  const cut = TTS.fitSentence(10, 5, 'truncate');
  assert.deepEqual(cut, {rate: 1.35, dur: 5, overrun: false, fast: false, cut: true});
  assert.deepEqual(TTS.fitSentence(6, 5, 'overrun'), {rate: 1, dur: 6, overrun: true, fast: false, cut: false});
  assert.deepEqual(TTS.fitSentence(6, 5, 'fixed'), {rate: 1, dur: 6, overrun: true, fast: false, cut: false});
  assert.equal(TTS.FIT[0].id, 'compress');
  assert.equal(TTS.FIT.map((f) => f.id).join(','), 'compress,truncate,overrun,fixed');
});

test('拉伸块：语速 = 合成时长 / 新时长，夹在 0.7–2.0×，过快与超出各自标记', () => {
  const b = {id: 'g1', start: 10, end: 14, slotEnd: 14, synth: 4.8, rate: 1.2, overrun: false, fast: false};
  const s = TTS.stretchBlock(b, 3);
  assert.equal(s.rate, 1.6); assert.equal(s.end, 13); assert.equal(s.fast, true); assert.equal(s.manual, true);
  const loose = TTS.stretchBlock(b, 6);
  assert.equal(loose.rate, 0.8); assert.equal(loose.end, 16); assert.equal(loose.overrun, true); assert.equal(loose.fast, false);
  assert.equal(TTS.stretchBlock(b, 1).rate, 2);
  assert.equal(TTS.stretchBlock(b, 60).rate, 0.7);
  assert.equal(TTS.rateLabel({rate: 1}), '');
  assert.equal(TTS.rateLabel({rate: 1.22, fast: false}), '1.22×');
  assert.equal(TTS.rateLabel({rate: 1.62, fast: true}), '1.62× · 过快');
});

test('音源开关：按语言切整组；背景声只在听这组配音时开；压低时不静掉原声', () => {
  const langs = ['en', 'ja'];
  assert.deepEqual(TTS.switchSource('dub', {lang: 'en', langs}),
    {muted: true, bedMuted: false, dubOff: {en: false, ja: true}, bedOff: {en: false, ja: true}, dubMuted: false});
  assert.deepEqual(TTS.switchSource('dub', {original: 'duck', lang: 'ja', langs}),
    {muted: false, bedMuted: false, dubOff: {en: true, ja: false}, bedOff: {en: true, ja: false}, dubMuted: false});
  assert.deepEqual(TTS.switchSource('original', {lang: 'en', langs}),
    {muted: false, bedMuted: true, dubOff: {en: true, ja: true}, bedOff: {en: true, ja: true}, dubMuted: true}, '原声自带背景，各组背景声也关');
  assert.deepEqual(TTS.switchSource('both', {original: 'mute', lang: 'en', langs}),
    {muted: false, bedMuted: true, dubOff: {en: false, ja: true}, bedOff: {en: true, ja: true}, dubMuted: false});
  assert.deepEqual(TTS.switchSource('dub', {lang: 'en'}).dubOff, {en: false}, '不给 langs 就只管这一条');
  assert.equal(TTS.sourceOf({muted: true, dubOff: {en: false}, lang: 'en'}), 'dub');
  assert.equal(TTS.sourceOf({muted: false, dubOff: {en: false}, lang: 'en', ducked: true}), 'dub');
  assert.equal(TTS.sourceOf({muted: false, dubOff: {en: true}, lang: 'en'}), 'original');
  assert.equal(TTS.sourceOf({muted: false, dubOff: {en: false, ja: true}, lang: 'en'}), 'both');
  assert.equal(TTS.sourceOf({muted: true, dubOff: {en: true}, lang: 'en'}), 'none');
  assert.equal(TTS.sourceOf({muted: false, dubMuted: true}), 'original', '老调用给 dubMuted 也认');
  assert.equal(TTS.sourceLabel('dub', 'English'), '配音 · English');
  assert.equal(TTS.sourceLabel('original'), '原声');
  assert.equal(TTS.sourceLabel('both', '日本語'), '两者 · 日本語');
  const dubs = [{lang: 'en'}, {lang: 'ja'}];
  assert.equal(TTS.activeDubLang(dubs, {en: false, ja: true}), 'en');
  assert.equal(TTS.activeDubLang(dubs, {}), 'ja', '都开着取最后配的');
  assert.equal(TTS.activeDubLang(dubs, {en: true, ja: true}), null);
  assert.equal(TTS.dubTrackId('ja-JP'), 'dub:ja');
  assert.equal(TTS.BED_TRACK_ID, 'bed');
});

test('配音语言表：按引擎筛通用目录、原声语言不配、换引擎落回可选项', () => {
  const codes = ['zh', 'en', 'zh-Hant', 'es', 'ja', 'fr', 'de', 'ko', 'pt', 'it', 'ru', 'ar', 'hi'];
  assert.deepEqual(TTS.ttsLangs('qwen3', codes, 'en'), ['zh', 'zh-Hant', 'es', 'ja', 'fr', 'de', 'ko', 'pt', 'it', 'ru']);
  assert.deepEqual(TTS.ttsLangs('indextts2', codes, 'en'), ['zh', 'zh-Hant']);
  assert.deepEqual(TTS.ttsLangs('indextts2', codes, 'zh'), ['en'], '原声简体中文时繁體中文也不配（同一口普通话）');
  assert.deepEqual(TTS.ttsLangs('indextts25', codes, 'zh'), ['en', 'es', 'ja', 'ar']);
  assert.deepEqual(TTS.ttsLangs('gptsovits', codes, 'en'), ['zh', 'zh-Hant']);
  assert.deepEqual(TTS.dubLangMarks(['ja', 'zh'], ['zh']), {ja: '先翻译', zh: '已有译文'});
  assert.equal(TTS.fallbackLang('ja', ['zh', 'zh-Hant'], ['zh-Hant']), 'zh-Hant', '优先落到已有译文');
  assert.equal(TTS.fallbackLang('ja', ['zh', 'zh-Hant'], []), 'zh');
  assert.equal(TTS.fallbackLang('zh', ['zh', 'zh-Hant'], []), 'zh', '还在表里就不动');
});

test('克隆参考窗：同一人相邻整句凑 5–10 秒，连同原文；单句过长才截断', () => {
  const cues = [
    {id: 'a', sp: 'S1', start: 0, end: 2.0, text: 'Hi.'},
    {id: 'b', sp: 'S1', start: 2.2, end: 4.6, text: 'Welcome back.'},
    {id: 'c', sp: 'S1', start: 4.8, end: 8.9, text: 'Today we talk about AI.'},
    {id: 'd', sp: 'S2', start: 9.0, end: 11.0, text: 'Right.'},
    {id: 'e', sp: 'S1', start: 11.2, end: 23.0, text: 'A very long monologue.'},
    {id: 'f', sp: 'S2', start: 30.0, end: 33.0, text: 'Sure.'},
  ];
  const w = TTS.referenceWindow(cues, 'S1');
  assert.deepEqual(w.ids, ['a', 'b', 'c']);
  assert.equal(w.start, 0); assert.equal(w.end, 8.9);
  assert.equal(w.text, 'Hi. Welcome back. Today we talk about AI.');
  assert.equal(w.cut, false);
  assert.equal(TTS.referenceLine(w), '克隆 · 连续 3 句 · 8.9 秒');
  // S2 两句中间隔了 19 秒，不能连；都不到 5 秒就取最长那句
  const w2 = TTS.referenceWindow(cues, 'S2');
  assert.deepEqual(w2.ids, ['f']);
  assert.equal(w2.text, 'Sure.');
  // 只有一句超长：截到 max，原文对不上只能走声纹
  const w3 = TTS.referenceWindow([{id: 'x', sp: 'S3', start: 5, end: 25, text: 'long'}], 'S3');
  assert.deepEqual(w3, {ids: ['x'], start: 5, end: 15, text: null, cut: true});
  assert.equal(TTS.referenceLine(w3), '克隆 · 截 10.0 秒 · 仅声纹');
  assert.equal(TTS.referenceWindow(cues, 'S9'), null);
  // 被别人插话打断的不算相邻
  const w4 = TTS.referenceWindow([
    {id: 'p', sp: 'A', start: 0, end: 3}, {id: 'q', sp: 'B', start: 3.1, end: 4}, {id: 'r', sp: 'A', start: 4.1, end: 7}], 'A');
  assert.equal(w4.ids.length, 1);
});

test('删除之前的全部配音：有配音才出现；提示随勾选变', () => {
  assert.equal(TTS.clearPrevInfo([], 'en', false).show, false);
  const dubs = [{lang: 'ja', langName: '日本語', bed: true}, {lang: 'en', langName: 'English', bed: true}];
  const off = TTS.clearPrevInfo(dubs, 'en', false);
  assert.equal(off.show, true);
  assert.deepEqual(off.others, ['日本語']);
  assert.equal(off.hint, '保留 日本語 的配音，播放条上能切换 · 同语言的那条本来就会被替换');
  assert.equal(TTS.clearPrevInfo(dubs, 'en', true).hint, '会一并移除 2 组配音（连同各自的背景声） · 能撤销');
  assert.equal(TTS.clearPrevInfo([{lang: 'en', langName: 'English'}], 'en', false).hint, '同语言的那条本来就会被替换');
});

test('语速库计数：中日韩句子里的拉丁字母串按音节折算（与 bcut_lang::pace 同一张表）', () => {
  const table = [
    ['Transformer 换了一个思路。', 9],
    ['所以，Transformer 的关键不是记住一个固定答案，而是让所有词并行交流，并动态决定该关注哪里。', 38],
    ['而 AI Agent 会自己动手，', 10],
    ['ChatGPT', 4], ['OpenAI', 4], ['iPhone', 2], ['GPUs', 3], ['Claude Code', 2], ['Google', 2],
    ['TRANSFORMER', 3], ['CLAUDE', 1], ['GPU', 3], ['RLHF', 4], ['HTTPS', 5],
    ['CUDA', 4],   // 读成单词的短缩写逐字母算，多算是接受的
    ["Let's go", 2], ['it’s', 1], ['2026 年', 5], ['H100', 4], ['GPT-4o', 5], ['ChatGPTを使う', 7],
  ];
  for (const [text, units] of table) assert.equal(TTS.countUnits(text, 'zh'), units, text);
  assert.equal(TTS.latinUnits('Kubernetes'), 4);
  assert.equal(TTS.latinUnits('PyTorch'), 2);
  assert.equal(TTS.latinUnits('x'), 1);
  assert.equal(TTS.countUnits('Transformer changed the game.', 'en'), 4, '按词的语言不变');
  assert.equal(TTS.countUnits('ChatGPT and GPUs', 'en'), 3);
});

test('语速库：种子 → 逐次更新 → 分位收敛；按字 / 按词；设置页文案', () => {
  assert.equal(TTS.paceUnit('zh'), 'char'); assert.equal(TTS.paceUnit('en-US'), 'word'); assert.equal(TTS.paceUnit('ja'), 'char');
  assert.equal(TTS.countUnits('欢迎回到科浪，这一期聊本地优先。', 'zh'), 14);
  assert.equal(TTS.countUnits("Let's start with speech recognition.", 'en'), 5);
  const seed = TTS.paceFor({}, 'qwen3-tts-0.6b-customvoice', 'zh');
  assert.deepEqual(seed.perMin, {p10: 230, median: 268, p90: 310});
  assert.equal(seed.source, 'seed');
  assert.equal(TTS.paceFor({}, 'indextts2', 'ja').unit, 'char', '没有种子的语言按单位给默认');
  assert.deepEqual(TTS.paceFor({}, 'index-tts2.5', 'en').perMin, {p10: 138, median: 174, p90: 206});
  assert.deepEqual(TTS.paceFor({}, 'gpt-sovits-v2', 'zh').perMin, {p10: 196, median: 228, p90: 286});
  assert.equal(TTS.paceFor({}, 'gpt-sovits-v2', 'en').perMin.median, 189);
  assert.equal(TTS.paceLine(seed, 'zh'), '简体中文 ≈ 268 字/分（230–310 · 种子值）');
  let lib = {};
  // 12 句都念得偏快（300 字/分），中位向 300 靠，但头几次仍被种子拉着
  for (let i = 0; i < 12; i++) lib = TTS.paceUpdate(lib, 'qwen3-tts-0.6b-customvoice', 'zh', {units: 50, seconds: 10}, '2026-09-11T10:00:00Z');
  const p = lib['qwen3-tts-0.6b-customvoice'].zh;
  assert.equal(p.samples, 12); assert.equal(p.source, 'measured'); assert.equal(p.perMin.median, 300);
  assert.equal(TTS.paceLine(p, 'zh'), '简体中文 ≈ 300 字/分（300–300 · 12 次生成）');
  const one = TTS.paceUpdate({}, 'qwen3-tts-0.6b-customvoice', 'zh', {units: 50, seconds: 10})['qwen3-tts-0.6b-customvoice'].zh;
  assert.ok(one.perMin.median > 268 && one.perMin.median < 300, '第一次只按 1/5 权重靠向测量值：' + one.perMin.median);
  assert.deepEqual(TTS.paceUpdate(lib, 'indextts2', 'en', {units: 0, seconds: 3}), lib, '空样本不更新');
  assert.equal(TTS.PACE_PATH, '~/Library/Application Support/BaoCut/tts-pace.json');
});

test('按时长整理计划：预测语速分四档、预算按到下一句前的空档、演示改写变短、人工改后重算', () => {
  const cues = [
    {id: 'g1', start: 0, end: 5, sp: 's1', text: '欢迎回到科浪。', trans: 'Welcome back to the show.'},
    {id: 'g2', start: 5, end: 8, sp: 's2', text: '这一期聊本地优先。', trans: 'This week we are going to talk about local-first tools and how they earn their keep in a busy editing workflow.'},
    {id: 'g3', start: 8, end: 9.5, sp: 's3', text: '好。', trans: 'Right, and that is exactly why.'},
    {id: 'g4', start: 9.5, end: 14, sp: 's1', text: '继续。', trans: 'Let us continue with the next part of the plan.'},
  ];
  const plan = TTS.fitPlan(cues, {model: 'qwen3-tts-0.6b-customvoice', lang: 'en'});
  assert.equal(plan.unit, 'word');
  assert.equal(plan.total, 4);
  assert.deepEqual(plan.rows.map((r) => r.level), ['ok', 'retranslate', 'over', 'ok']);
  assert.equal(plan.rows[0].budget, 12, '5 秒 × 150 词/分 = 12 词');
  assert.equal(plan.rows[1].units, 22);
  assert.equal(plan.over, 1); assert.equal(plan.retranslate, 1); assert.equal(plan.ok, 2);
  const rw = TTS.demoRewrite(plan.rows[1], 'en', plan.pace);
  assert.equal(rw.kind, 'retranslate');
  assert.ok(rw.units <= plan.rows[1].budget, `${rw.units} ≤ ${plan.rows[1].budget}`);
  assert.ok(rw.rate <= 1.05, String(rw.rate));
  assert.equal(TTS.demoRewrite(plan.rows[0], 'en', plan.pace), null);
  const edited = TTS.replanRow(plan.rows[2], 'Right.', plan.pace, 'en');
  assert.equal(edited.level, 'ok'); assert.equal(edited.units, 1);
  // 配音稿覆盖层：改过的句按新文字算，没改的照旧
  const plan2 = TTS.fitPlan(cues, {model: 'qwen3-tts-0.6b-customvoice', lang: 'en', script: {g2: rw.text, g3: 'Right.'}});
  assert.equal(plan2.over + plan2.retranslate, 0);
  const blocks = TTS.dubBlocks(cues, {speakerOrder: ['s1', 's2', 's3'], script: {g3: 'Right.'}});
  assert.equal(blocks[2].text, 'Right.');
  assert.equal(blocks[1].text, cues[1].trans);
});

test('配音块：一句一块、按说话人着色、失败集与重试', () => {
  const cues = [
    {id: 'g1', start: 0, end: 5.4, sp: 's1', text: '欢迎回到科浪。', trans: 'Welcome back.'},
    {id: 'g2', start: 5.4, end: 11.2, sp: 's2', text: '这一期聊本地优先。', trans: 'This week is about local-first tools, how they earn their keep, and why the editing workflow finally gets out of your way.'},
    {id: 'g3', start: 11.2, end: 14, sp: 's3', text: '好。', trans: 'Right.'},
  ];
  const blocks = TTS.dubBlocks(cues, {speakerOrder: ['s1', 's2', 's3'], failed: {g3: true}});
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((b) => b.hue), ['blue', 'green', 'orange']);
  assert.equal(blocks[0].start, 0);
  assert.ok(blocks[0].end <= 5.4);
  assert.ok(blocks[1].end <= 11.2 + 0.001, '压到原句时长');
  assert.equal(blocks[1].fast, true, '长句只加速不截断，标过快');
  assert.equal(blocks[1].cut, false);
  assert.equal(blocks[1].text, cues[1].trans);
  assert.equal(blocks[1].limitEnd, 11.2, '下一句紧挨着：没空档可借');
  assert.equal(TTS.fastOf(blocks).length, 1);
  assert.equal(blocks[2].status, 'failed');
  assert.equal(TTS.failedOf(blocks).length, 1);
  const fixed = TTS.retry(blocks, ['g3']);
  assert.equal(TTS.failedOf(fixed).length, 0);
  assert.equal(TTS.speakerHue(6), 'blue');
});

test('演示失败集：62 句坏 3 句，确定性', () => {
  const cues = Array.from({length: 62}, (_, i) => ({id: 'g' + (i + 1)}));
  const f = TTS.demoFailures(cues);
  assert.deepEqual(Object.keys(f), ['g8', 'g31', 'g54']);
});

test('收据与任务 sub', () => {
  const cues = [
    {id: 'g1', start: 0, end: 5, sp: 's1', text: 'a'}, {id: 'g2', start: 5, end: 9, sp: 's1', text: 'b'},
  ];
  const blocks = TTS.dubBlocks(cues, {speakerOrder: ['s1'], failed: {g2: true}});
  assert.equal(TTS.dubReceipt({blocks, engine: 'qwen3', elapsed: '1 分 48 秒'}), '已应用 · 配音 1/2 句 · 背景声已分离 · 1 分 48 秒 · Qwen3-TTS');
  const fastBlocks = blocks.map((b, i) => (i === 0 ? Object.assign({}, b, {fast: true}) : b));
  assert.equal(TTS.dubReceipt({blocks: fastBlocks, engine: 'qwen3', separate: false}), '已应用 · 配音 1/2 句 · 1 句过快 · Qwen3-TTS');
  assert.equal(TTS.dubReceipt({blocks: TTS.retry(blocks, ['g2']), engine: 'indextts2', separate: false}), '已应用 · 配音 2 句 · IndexTTS2');
  assert.equal(TTS.dubSub({engine: 'qwen3', strategy: 'clone'}, '日本語'), '日本語 · Qwen3-TTS · 克隆每位说话人的原声 · 分离背景');
});

test('设置预览允许多段长文本，每只引擎不给参考都能念（各有默认音色）', () => {
  const text = '欢迎使用 BaoCut。\n'.repeat(250);
  ['qwen3', 'qwen3-1.7b', 'indextts2', 'indextts25', 'gptsovits'].forEach((engine) => {
    assert.deepEqual(TTS.validatePreview({text, engine}), [], engine);
  });
  assert.deepEqual(TTS.validatePreview({text, engine: 'qwen3', mode: 'preset'}), []);
  assert.deepEqual(TTS.validatePreview({text, engine: 'indextts2', ref: {name: 'sample.wav'}}), []);
  // 选了「我的音频」还没给文件：这半步要拦下，不能悄悄当默认音色
  assert.deepEqual(
    TTS.validatePreview(Object.assign({text, engine: 'indextts2'}, TTS.pickRef({refText: ''}, 'file'))),
    ['先选一段参考音频，或换回内置音色']);
  assert.ok(TTS.validatePreview({text: ' \n ', engine: 'qwen3'}).length);
});

test('内置音色：八只（中 / 英 / 日 / 西 × 男女），时长过得了 GPT-SoVITS 带原文的 3–10 秒与参考窗 5–10 秒', () => {
  assert.equal(TTS.BUILTIN_REFS.length, 8);
  assert.deepEqual(TTS.BUILTIN_REFS.map((r) => r.id),
    ['zh-female', 'zh-male', 'en-female', 'en-male', 'ja-female', 'ja-male', 'es-female', 'es-male']);
  TTS.BUILTIN_REFS.forEach((r) => {
    assert.ok(r.dur >= TTS.REF_WINDOW.min && r.dur <= TTS.REF_WINDOW.max, r.id);
    assert.ok(r.text.trim().length > 0, r.id);
    // VoiceDesign 接不了参考音频：同一只音色在它身上是这句英文描述
    assert.ok(/female|male/.test(r.describe), r.id);
    assert.ok(r.file.startsWith('tts-voice-'), r.id);
    const f = Object.assign({text: '你好', engine: 'gptsovits'}, TTS.pickRef({refText: ''}, r.id));
    assert.equal(TTS.refProblem(f), null, r.id);
    assert.deepEqual(TTS.validatePreview(f), [], r.id);
  });
  assert.match(TTS.REF_CREDIT, /FLEURS/);
  // 默认音色按语言挑，认不出按文字的字形；旧 id 还认
  assert.equal(TTS.defaultBuiltin('zh-Hans', 'hello').id, 'zh-female');
  assert.equal(TTS.defaultBuiltin('es-419', 'hello').id, 'es-female');
  assert.equal(TTS.defaultBuiltin('auto', 'こんにちは').id, 'ja-female');
  assert.equal(TTS.defaultBuiltin('auto', 'good morning').id, 'en-female');
  assert.equal(TTS.builtinRef('ref-female').id, 'en-female');
  assert.equal(TTS.builtinRef('女性-温柔'), null);
  assert.deepEqual(TTS.moreBuiltins().map((r) => r.id), ['ja-female', 'ja-male', 'es-female', 'es-male']);
});

test('参考来源：每只引擎都从「默认音色」开局，快捷四只 + 我的音频', () => {
  ['indextts2', 'indextts25', 'gptsovits', 'qwen3', 'qwen3-1.7b'].forEach((e) => {
    assert.deepEqual(TTS.refDefault(e), {ref: null, refText: ''}, e);
    assert.deepEqual(TTS.refSources(e).map((x) => x.k),
      ['none', 'zh-female', 'zh-male', 'en-female', 'en-male', 'file'], e);
  });
  // 「更多音色」列全部八只
  assert.deepEqual(TTS.refSources('indextts2', true).map((x) => x.k),
    ['none'].concat(TTS.BUILTIN_REFS.map((r) => r.id)).concat(['file']));
  assert.equal(TTS.refSourceOf(null), 'none');
  assert.equal(TTS.refSourceOf(null, true), 'file');
  assert.equal(TTS.refSourceOf({builtin: 'ja-male'}), 'ja-male');
  assert.equal(TTS.refSourceOf({name: 'a.wav'}), 'file');
  // 内置音色怎么落地：克隆那几只拿录音，VoiceDesign 拿描述，CustomVoice 用模型自己的说话人
  assert.equal(TTS.builtinKind('indextts2', 'clone'), 'ref');
  assert.equal(TTS.builtinKind('qwen3', 'clone'), 'ref');
  assert.equal(TTS.builtinKind('qwen3', 'preset'), 'presets');
  assert.equal(TTS.builtinKind('qwen3-1.7b', 'describe'), 'describe');
});

test('切参考来源：内置音色的原文跟着走，用户自己写的参考文本保留', () => {
  const male = TTS.pickRef({refText: ''}, 'zh-male');
  assert.deepEqual(TTS.pickRef(male, 'file'), {ref: null, refText: '', refPicking: true});
  assert.deepEqual(TTS.pickRef(male, 'file', {name: 'me.wav'}), {ref: {name: 'me.wav'}, refText: '', refPicking: false});
  assert.deepEqual(TTS.pickRef({ref: {name: 'me.wav'}, refText: '我自己的原文'}, 'none'),
    {ref: null, refText: '我自己的原文', refPicking: false});
  assert.equal(TTS.pickRef({refText: '我自己的原文'}, 'ja-female').refText, TTS.builtinRef('ja-female').text);
});

test('TTS 行简介：只写出声方式、要不要录音、情绪与语言', () => {
  const cv = TTS.modelBrief('qwen3-tts-0.6b-customvoice');
  assert.equal(cv.summary, '9 个预设音色，选一个就能念');
  assert.deepEqual(cv.facts, ['预设音色', '中 / 英 / 日 / 韩 等 10 种语言']);
  const base = TTS.modelBrief('qwen3-tts-0.6b-base');
  assert.equal(base.needsRef, false);
  assert.equal(base.facts[0], '内置音色 / 克隆');
  assert.deepEqual(TTS.modelBrief('index-tts2.5').facts, ['内置音色 / 克隆', '情绪可调', '中 / 英 / 日 / 西 / 阿']);
  assert.equal(TTS.modelBrief('gpt-sovits-v2').summary, '八只内置音色，或用一段录音克隆声音');
  assert.equal(TTS.modelBrief('htdemucs-ft'), null);
});

test('Qwen3-TTS 1.7B：CustomVoice / Base / VoiceDesign 三种音色方式（0.6B 不变）；收据仍写 Qwen3-TTS', () => {
  assert.deepEqual(TTS.voiceModes('qwen3-1.7b'), ['preset', 'clone', 'describe']);
  assert.deepEqual(TTS.voiceModes('qwen3'), ['preset', 'clone']);
  assert.equal(TTS.modelFor('qwen3-1.7b', 'preset'), 'qwen3-tts-1.7b-customvoice');
  assert.equal(TTS.modelFor('qwen3-1.7b', 'clone'), 'qwen3-tts-1.7b-base');
  assert.equal(TTS.modelFor('qwen3-1.7b', 'describe'), 'qwen3-tts-1.7b-voicedesign');
  assert.equal(TTS.modelFor('qwen3', 'describe'), 'qwen3-tts-0.6b-customvoice');
  assert.ok(!TTS.cloneOnly('qwen3-1.7b'));
  assert.ok(TTS.hasDescribe('qwen3-1.7b'));
  assert.ok(!TTS.hasDescribe('qwen3'));
  // VoiceDesign 吃一句自由描述：描述空就拦；内置音色在描述那一档落成那句描述
  assert.ok(!TTS.describeByVocab('qwen3-1.7b'));
  assert.equal(TTS.builtinKind('qwen3-1.7b', 'describe'), 'describe');
  assert.equal(TTS.builtinKind('qwen3-1.7b', 'clone'), 'ref');
  assert.deepEqual(TTS.validate({text: '你好。', engine: 'qwen3-1.7b', mode: 'describe', instruct: '  '}), ['先用一句话描述想要的声音']);
  assert.deepEqual(TTS.validate({text: '你好。', engine: 'qwen3-1.7b', mode: 'describe', instruct: '温暖的女声'}), []);
  assert.ok(TTS.hasStyle('qwen3-1.7b') && TTS.hasStyle('qwen3'));
  // 2026-09-21：一只都不再「必须给参考」
  assert.ok(!TTS.refRequired('qwen3-1.7b'));
  assert.ok(!TTS.refRequired('indextts2'));
  // 克隆要参考音频，预设不要
  assert.ok(TTS.validate({text: '你好。', engine: 'qwen3-1.7b', mode: 'clone'}).includes('克隆声音要先给参考音频'));
  assert.deepEqual(TTS.validate({text: '你好。', engine: 'qwen3-1.7b', mode: 'preset', preset: 'Vivian'}), []);
  assert.deepEqual(TTS.validatePreview({text: '你好。', engine: 'qwen3-1.7b'}), []);
  assert.equal(TTS.refSources('qwen3-1.7b')[0].k, 'none');
  assert.equal(TTS.refDefault('qwen3-1.7b').ref, null);
  const brief = TTS.modelBrief('qwen3-tts-1.7b-base');
  assert.equal(brief.needsRef, false);
  assert.equal(brief.summary, '八只内置音色，或用一段录音克隆声音');
  assert.deepEqual(brief.facts, ['内置音色 / 克隆', '中 / 英 / 日 / 韩 等 10 种语言']);
  const cv = TTS.modelBrief('qwen3-tts-1.7b-customvoice');
  assert.equal(cv.voice, 'preset');
  assert.equal(cv.summary, '9 个预设音色，选一个就能念');
  const vd = TTS.modelBrief('qwen3-tts-1.7b-voicedesign');
  assert.equal(vd.voice, 'describe');
  assert.deepEqual(vd.facts, ['按描述造声音', '中 / 英 / 日 / 韩 等 10 种语言']);
  assert.equal(TTS.MODELS['qwen3-tts-1.7b-voicedesign'].engine, 'qwen3-1.7b');
  assert.match(TTS.quickSlow('qwen3-tts-1.7b-voicedesign'), /描述决定/);
  assert.equal(TTS.engineName('qwen3'), 'Qwen3-TTS 0.6B');
  assert.equal(TTS.engineName('qwen3-1.7b'), 'Qwen3-TTS 1.7B');
  assert.equal(TTS.engineFamily('qwen3-1.7b'), 'Qwen3-TTS');
  assert.equal(TTS.engineFamily('indextts2'), 'IndexTTS2');
  assert.equal(TTS.genSub({text: '你好。', engine: 'qwen3-1.7b', mode: 'clone', ref: {name: 'me.wav'}}), 'Qwen3-TTS · 克隆 · me.wav · 1 段');
  assert.ok(!TTS.ENGINES.find((e) => e.id === 'qwen3-1.7b').dubOnly);
});

test('一键试听：默认选择直接能合成，换音色 / 语言 / 自定义文本都产出合法表单', () => {
  Object.keys(TTS.MODELS).filter((id) => TTS.MODELS[id].engine !== 'sep').forEach((id) => {
    const f = TTS.quickForm(id);
    assert.deepEqual(TTS.validatePreview(f), [], id);
    TTS.sampleLangs(id).forEach((l) => assert.deepEqual(TTS.validatePreview(TTS.quickForm(id, {lang: l.code})), [], id + l.code));
    TTS.quickVoices(id).filter((v) => v.k !== 'file' && v.k !== 'describe').forEach((v) => {
      assert.deepEqual(TTS.validatePreview(TTS.quickForm(id, {voice: v.k})), [], id + v.k);
    });
  });
  assert.deepEqual(TTS.sampleLangs('gpt-sovits-v2').map((l) => l.code), ['zh', 'en']);
  assert.deepEqual(TTS.quickVoices('qwen3-tts-0.6b-customvoice').map((v) => v.k), TTS.QUICK_PRESETS);
  const en = TTS.quickForm('indextts2', {lang: 'en', voice: 'en-female'});
  assert.equal(en.ref.builtin, 'en-female');
  assert.match(en.text, /^Welcome to BaoCut/);
  assert.equal(TTS.quickForm('indextts2', {custom: '随便念一句'}).text, '随便念一句');
  // 选了「我的音频」还没给文件：只能克隆的引擎要拦下
  assert.equal(TTS.validatePreview(TTS.quickForm('indextts2', {voice: 'file'})).length, 1);
  assert.deepEqual(TTS.validatePreview(TTS.quickForm('indextts2', {voice: 'file'}, {name: 'me.wav'})), []);
  assert.match(TTS.quickSummary(TTS.quickForm('indextts2', {lang: 'en', voice: 'en-female', tone: 'natural'}), {lang: 'en', kind: 'intro'}), /^英语女声 · English · 音频约/);
  // 语气不是默认那档就跟在音色后面；台词不是那句介绍就跟在语言后面
  assert.match(TTS.quickSummary(TTS.quickForm('indextts2', {lang: 'en', voice: 'en-female'}), {lang: 'en', kind: 'numbers'}), /^英语女声 · 热情洋溢 · English · 数字/);
  // 试听默认音色跟着示例语言走
  assert.equal(TTS.quickForm('index-tts2.5', {lang: 'ja'}).ref.builtin, 'ja-female');
  assert.equal(TTS.quickSummary(TTS.quickForm('qwen3-tts-0.6b-customvoice'), {lang: 'zh', kind: 'intro'}, 1.6),
    'Vivian · 热情洋溢 · 简体中文 · 用时 1.6 秒 · 音频约 12.3 秒'.replace('12.3', TTS.estimateDuration(TTS.SAMPLE_LINES[0].text).toFixed(1)));
  // 十一门语言 × 三句，每只引擎会念的语言都选得到（Qwen3-TTS 十门）
  assert.equal(TTS.SAMPLE_LINES.length, 33);
  assert.equal(TTS.sampleLangs('qwen3-tts-0.6b-base').length, 10);
  assert.deepEqual(TTS.sampleKinds('ru').map((k) => k.k), ['intro', 'numbers', 'mood']);
  assert.equal(TTS.sampleLine('de', 'numbers').text, TTS.quickForm('qwen3-tts-0.6b-base', {lang: 'de', kind: 'numbers'}).text);
  // 认不出的种类退回这门语言的第一句，认不出的语言退到表头
  assert.equal(TTS.sampleLine('zh', 'nope').kind, 'intro');
  assert.equal(TTS.sampleLine('xx', 'mood').code, 'zh');
});

test('VoiceDesign 试听：内置音色是一句描述，也能自己描述；不给参考录音；有说明提示', () => {
  // VoiceDesign 接不了参考音频：同一组内置音色在它身上是那句英文描述
  assert.deepEqual(TTS.quickVoices('qwen3-tts-1.7b-voicedesign').map((v) => v.k),
    TTS.QUICK_BUILTINS.concat(['warm', 'anchor', 'bright', 'describe']));
  assert.ok(TTS.quickVoices('qwen3-tts-1.7b-voicedesign').every((v) => v.k !== 'file'));
  const f = TTS.quickForm('qwen3-tts-1.7b-voicedesign');
  assert.equal(f.mode, 'describe');
  assert.equal(f.ref, null);
  // 默认音色跟着示例语言（中文）走，落地成中文女声那句描述
  assert.equal(f.builtin, 'zh-female');
  assert.equal(f.instruct, TTS.builtinRef('zh-female').describe);
  assert.match(TTS.quickSummary(f, {lang: 'zh'}), /^中文女声 · 简体中文 · 音频约/);
  const warm = TTS.quickForm('qwen3-tts-1.7b-voicedesign', {voice: 'warm'});
  assert.equal(warm.instruct, TTS.DESCRIBE_VOICES[0].instruct);
  assert.deepEqual(TTS.validatePreview(f), []);
  assert.deepEqual(TTS.validatePreview(TTS.quickForm('qwen3-tts-1.7b-voicedesign', {voice: 'describe'})), ['先用一句话描述想要的声音']);
  const own = TTS.quickForm('qwen3-tts-1.7b-voicedesign', {voice: 'describe', describe: '低沉的老年男声'});
  assert.equal(own.instruct, '低沉的老年男声');
  assert.match(TTS.quickSummary(own, {lang: 'zh'}), /^自己描述 · 简体中文 · 音频约/);
  assert.match(TTS.quickSummary(TTS.quickForm('qwen3-tts-1.7b-voicedesign', {voice: 'anchor', lang: 'en'}), {lang: 'en'}), /^沉稳男声 · English/);
  assert.ok(TTS.quickSlow('qwen3-tts-1.7b-voicedesign'));
  assert.equal(TTS.quickSlow('qwen3-tts-0.6b-customvoice'), null);
});

test('试听结果身份：选择一变身份就变，同一组选择身份相同（芯片只改选择，旧结果据此标成上一次）', () => {
  const k = (id, pick, file) => TTS.quickKey(TTS.quickForm(id, pick, file));
  assert.equal(k('qwen3-tts-0.6b-customvoice'), k('qwen3-tts-0.6b-customvoice', {lang: 'zh', voice: 'Vivian'}));
  assert.notEqual(k('qwen3-tts-0.6b-customvoice'), k('qwen3-tts-0.6b-customvoice', {lang: 'en'}));
  assert.notEqual(k('qwen3-tts-0.6b-customvoice'), k('qwen3-tts-0.6b-customvoice', {voice: 'Eric'}));
  assert.notEqual(k('indextts2'), k('indextts2', {voice: 'en-female'}));
  assert.notEqual(k('indextts2', {voice: 'file'}, {name: 'a.wav'}), k('indextts2', {voice: 'file'}, {name: 'b.wav'}));
  assert.notEqual(k('indextts2'), k('indextts2', {custom: '随便念一句'}));
  assert.notEqual(k('qwen3-tts-1.7b-voicedesign', {voice: 'describe', describe: 'a'}), k('qwen3-tts-1.7b-voicedesign', {voice: 'describe', describe: 'b'}));
  // 换台词、换语气都是另一组选择
  assert.notEqual(k('indextts2'), k('indextts2', {kind: 'numbers'}));
  assert.notEqual(k('indextts2'), k('indextts2', {tone: 'natural'}));
  assert.notEqual(k('qwen3-tts-0.6b-customvoice'), k('qwen3-tts-0.6b-customvoice', {tone: 'anchor'}));
});

test('试听语气：CustomVoice 走风格指令，IndexTTS 走情感向量，其余引擎没有这一行', () => {
  assert.deepEqual(TTS.quickTones('qwen3-tts-0.6b-customvoice').map((t) => t.k), ['upbeat', 'natural', 'anchor', 'soft']);
  assert.ok(TTS.quickTones('qwen3-tts-0.6b-customvoice').every((t) => !t.emotion));
  assert.deepEqual(TTS.quickTones('indextts2').map((t) => t.k), ['upbeat', 'natural', 'anchor', 'surprised']);
  assert.ok(TTS.quickTones('indextts2').every((t) => !t.instruct));
  // 不认语气的引擎：Base（只会克隆）、GPT-SoVITS（没有情绪控制）、VoiceDesign（语气就是那句描述）
  ['qwen3-tts-0.6b-base', 'gpt-sovits-v2', 'qwen3-tts-1.7b-voicedesign'].forEach((id) => assert.deepEqual(TTS.quickTones(id), []));
  // 默认就是热情洋溢：设置页的试听是听「它念 BaoCut 的介绍好不好听」
  assert.equal(TTS.quickDefaults('qwen3-tts-0.6b-customvoice').tone, 'upbeat');
  assert.equal(TTS.quickDefaults('gpt-sovits-v2').tone, 'natural');
  const up = TTS.quickForm('qwen3-tts-0.6b-customvoice');
  assert.equal(up.instruct, TTS.quickTone('qwen3-tts-0.6b-customvoice', 'upbeat').instruct);
  assert.equal(TTS.quickForm('qwen3-tts-0.6b-customvoice', {tone: 'natural'}).instruct, undefined);
  const emo = TTS.quickForm('indextts2');
  assert.equal(emo.emotion, 'happy');
  assert.equal(emo.instruct, undefined);
  // 换了模型带过来的旧 id 落回中立档，不是落空
  assert.equal(TTS.quickTone('indextts2', 'soft').k, 'natural');
  assert.equal(TTS.quickTone('gpt-sovits-v2', 'upbeat'), null);
  // 语气不改表单校验：哪一档都能直接合成
  TTS.quickTones('indextts2').forEach((t) => assert.deepEqual(TTS.validatePreview(TTS.quickForm('indextts2', {tone: t.k})), [], t.k));
});

test('VoxCPM2 / OmniVoice：模型 id、音色方式、风格行在哪一档、内置音色怎么落地', () => {
  assert.equal(TTS.MODELS.voxcpm2.engine, 'voxcpm2');
  assert.equal(TTS.MODELS.omnivoice.engine, 'omnivoice');
  assert.deepEqual(TTS.voiceModes('voxcpm2'), ['clone']);
  assert.deepEqual(TTS.voiceModes('omnivoice'), ['clone', 'describe']);
  assert.equal(TTS.modelFor('omnivoice', 'clone'), 'omnivoice');
  assert.equal(TTS.modelFor('omnivoice', 'describe'), 'omnivoice');
  assert.equal(TTS.modelFor('voxcpm2', 'describe'), 'voxcpm2', '非法方式落到首选');
  assert.ok(TTS.hasDescribe('omnivoice'));
  assert.ok(!TTS.hasDescribe('voxcpm2'));
  assert.ok(TTS.describeByVocab('omnivoice'));
  assert.ok(!TTS.describeByVocab('qwen3-1.7b'));
  // 风格：CustomVoice 在预设档；VoxCPM2 在克隆档（风格 → 可控克隆）；OmniVoice 没有自由风格
  assert.ok(TTS.hasStyle('voxcpm2'));
  assert.ok(!TTS.hasStyle('omnivoice'));
  assert.ok(TTS.styleOn('qwen3', 'preset'));
  assert.ok(!TTS.styleOn('qwen3', 'clone'));
  assert.ok(TTS.styleOn('voxcpm2', 'clone'));
  assert.ok(!TTS.styleOn('omnivoice', 'clone'));
  assert.ok(!TTS.styleOn('indextts2', 'clone'));
  // 内置音色：两只新引擎克隆档拿随包录音当参考；OmniVoice 描述档不吃那几句英文描述；VoiceDesign 拿描述
  assert.equal(TTS.builtinKind('voxcpm2', 'clone'), 'ref');
  assert.equal(TTS.builtinKind('omnivoice', 'clone'), 'ref');
  assert.equal(TTS.builtinKind('omnivoice', 'describe'), 'none');
  assert.equal(TTS.builtinKind('qwen3-1.7b', 'describe'), 'describe');
  assert.equal(TTS.engineOf('omnivoice').nonCommercial, true);
  assert.equal(TTS.engineOf('voxcpm2').nonCommercial, undefined);
  // 策略说明点名两只会描述的引擎
  assert.match(TTS.STRATEGY.find((s) => s.id === 'describe').desc, /Qwen3-TTS 1\.7B 与 OmniVoice/);
});

test('OmniVoice 描述词表与 model-runtime::synthesize::omnivoice::instruct 对拍', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../crates/model-runtime/src/synthesize/omnivoice/instruct.rs'), 'utf8');
  const arr = (name) => {
    const m = src.match(new RegExp('pub const ' + name + ': \\[&str; \\d+\\] = \\[([^\\]]*)\\]'));
    assert.ok(m, name);
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };
  const cat = (k) => TTS.OMNI_DESIGN.cats.find((c) => c.k === k).items;
  assert.deepEqual(cat('gender'), arr('GENDER_ZH'));
  assert.deepEqual(cat('age'), arr('AGE_ZH'));
  assert.deepEqual(cat('pitch'), arr('PITCH_ZH'));
  assert.deepEqual(cat('style'), arr('STYLE_ZH'));
  assert.deepEqual([...cat('accent')].sort(), [...arr('ACCENT_EN')].sort());
  assert.deepEqual(cat('dialect'), arr('DIALECT_ZH'));
});

test('OmniVoice 描述词表：每类至多一项、口音 / 方言跟语言、拼成 --instruct', () => {
  assert.deepEqual(TTS.omniCats('zh').map((c) => c.k), ['gender', 'age', 'pitch', 'style', 'dialect']);
  assert.deepEqual(TTS.omniCats('en').map((c) => c.k), ['gender', 'age', 'pitch', 'style', 'accent']);
  assert.deepEqual(TTS.omniCats('auto').map((c) => c.k), ['gender', 'age', 'pitch', 'style']);
  let sel = TTS.omniToggle({}, 'gender', '女');
  sel = TTS.omniToggle(sel, 'age', '青年');
  sel = TTS.omniToggle(sel, 'age', '老年');
  assert.deepEqual(sel, {gender: '女', age: '老年'}, '同类换一项');
  assert.deepEqual(TTS.omniToggle(sel, 'age', '老年'), {gender: '女'}, '再点一次取消');
  assert.equal(TTS.omniCount(sel), 2);
  assert.equal(TTS.omniCount({gender: '不存在'}), 0);
  assert.equal(TTS.omniInstruct({age: '青年', gender: '女', pitch: '高音调'}), '女, 青年, 高音调', '按类的固定次序');
  assert.equal(TTS.omniLabel({gender: '男', accent: 'british accent'}), '男 · 英国口音');
  // 校验：一项没挑拦；只挑一项放行；英语口音配中文拦
  assert.match(TTS.omniProblem({}, 'zh'), /至少挑一项/);
  assert.equal(TTS.omniProblem({style: '耳语'}, 'zh'), null);
  assert.match(TTS.omniProblem({gender: '男', accent: 'british accent'}, 'zh'), /英语口音只在念English时生效|英语口音只在念/);
  assert.equal(TTS.omniProblem({gender: '男', accent: 'british accent'}, 'en'), null);
  assert.match(TTS.omniProblem({dialect: '四川话'}, 'en'), /汉语方言只在念/);
  // 换语言：清掉不再生效的口音 / 方言与词表外的值
  assert.deepEqual(TTS.omniFit({gender: '男', accent: 'british accent', dialect: '四川话', age: '胡写'}, 'zh'), {gender: '男', dialect: '四川话'});
  assert.deepEqual(TTS.omniFit({gender: '男', accent: 'british accent', dialect: '四川话'}, 'en'), {gender: '男', accent: 'british accent'});
  assert.deepEqual(TTS.omniFit({gender: '男', accent: 'british accent', dialect: '四川话'}, 'de'), {gender: '男'});
  assert.deepEqual(TTS.omniFit({gender: '男', dialect: '四川话'}, 'zh-Hans'), {gender: '男', dialect: '四川话'});
  // 描述造声只在中英训练过：别的语言提醒一句
  assert.equal(TTS.omniLangNote('zh'), null);
  assert.equal(TTS.omniLangNote('auto'), null);
  assert.match(TTS.omniLangNote('de'), /只在中文、英语上训练过/);
  // 表单：OmniVoice 的描述原文从挑的项拼，旧的自由描述不作数
  const base = {text: '你好。', engine: 'omnivoice', mode: 'describe', lang: 'zh', instruct: 'A warm female voice'};
  assert.equal(TTS.describeText(Object.assign({}, base, {omni: {gender: '女'}})), '女');
  assert.deepEqual(TTS.validate(Object.assign({}, base, {omni: {}})), ['先在性别、年龄、音高等几项里至少挑一项']);
  assert.deepEqual(TTS.validate(Object.assign({}, base, {omni: {gender: '女'}})), []);
  assert.equal(TTS.validate(Object.assign({}, base, {omni: {accent: 'british accent'}})).length, 1);
  // 现成挑法都合法
  TTS.OMNI_PRESETS.forEach((p) => assert.equal(TTS.omniProblem(p.sel, 'zh'), null, p.k));
});

test('OmniVoice 克隆要写参考原文（不写会吞掉正文开头）；内置音色自带原文，描述造声不看参考', () => {
  const f = {text: '你好。', engine: 'omnivoice', mode: 'clone', lang: 'zh', ref: {file: 'me.wav', dur: 6}, refText: ''};
  assert.ok(TTS.refTextRequired('omnivoice'));
  assert.ok(!TTS.refTextRequired('voxcpm2'));
  assert.match(TTS.refProblem(f), /原文/);
  assert.equal(TTS.validate(f).length, 1);
  assert.deepEqual(TTS.validate(Object.assign({}, f, {refText: '我今天说几句话。'})), []);
  assert.equal(TTS.refProblem(Object.assign({}, f, {engine: 'voxcpm2'})), null, 'VoxCPM2 不带原文走可控克隆');
  assert.equal(TTS.refProblem(Object.assign({}, f, {mode: 'describe'})), null);
  const b = TTS.BUILTIN_REFS[0];
  const picked = TTS.pickRef({refText: ''}, b.id, null, []);
  assert.equal(picked.ref.builtin, b.id);
  assert.equal(TTS.refProblem(Object.assign({}, f, picked)), null);
});

test('本地数值旋钮：只列认的引擎、没碰过不传、夹进区间、给了目标时长不传语速', () => {
  assert.deepEqual(TTS.knobsOf('indextts25').map((d) => d.k), ['speed']);
  assert.deepEqual(TTS.knobsOf('indextts2'), [], 'IndexTTS2 不收 --speed');
  assert.deepEqual(TTS.knobsOf('voxcpm2').map((d) => d.k), ['cfg', 'steps']);
  assert.deepEqual(TTS.knobsOf('omnivoice').map((d) => d.k), ['speed', 'cfg', 'steps']);
  assert.deepEqual(TTS.knobsOf('qwen3'), []);
  const vox = TTS.knobsOf('voxcpm2');
  assert.deepEqual(vox.map((d) => [d.min, d.max, d.dflt]), [[1, 3, 2], [1, 50, 10]]);
  const omni = TTS.knobsOf('omnivoice');
  assert.deepEqual(omni.map((d) => [d.min, d.max, d.dflt]), [[0.5, 1.5, 1], [0, 4, 2], [4, 64, 32]]);
  assert.deepEqual(TTS.knobsOf('indextts25').map((d) => [d.min, d.max]), [[0.5, 1.5]]);
  // 没设过：值取默认，参数表为空，副题「按模型默认」
  assert.equal(TTS.knobValue('voxcpm2', {}, 'cfg'), 2);
  assert.deepEqual(TTS.knobArgs('voxcpm2', {}), []);
  assert.equal(TTS.knobLine('voxcpm2', {}), '按模型默认');
  // 设过：夹进区间、按步长取整；别的引擎的键不传
  let k = TTS.setKnob('voxcpm2', {}, 'cfg', 9);
  assert.deepEqual(k, {cfg: 3});
  k = TTS.setKnob('voxcpm2', k, 'steps', 20.4);
  assert.deepEqual(k, {cfg: 3, steps: 20});
  assert.deepEqual(TTS.knobArgs('voxcpm2', Object.assign({speed: 1.2}, k)).map((a) => a.flag), ['--cfg', '--steps']);
  assert.equal(TTS.knobLine('voxcpm2', k), '引导强度 3.0 · 采样步数 20');
  assert.deepEqual(TTS.setKnob('voxcpm2', k, 'cfg', null), {steps: 20}, 'null 回到不传');
  // OmniVoice 按目标时长合成时语速不传
  const ok = {speed: 1.5, steps: 16};
  assert.deepEqual(TTS.knobArgs('omnivoice', ok).map((a) => a.k), ['speed', 'steps']);
  assert.deepEqual(TTS.knobArgs('omnivoice', ok, {duration: true}).map((a) => a.k), ['steps']);
  assert.equal(TTS.knobLine('indextts25', {speed: 1.2}), '语速 1.20×');
  assert.equal(TTS.durationMax('omnivoice'), 60);
  assert.equal(TTS.durationMax('voxcpm2'), 0);
});

test('新模型的速览、语速回落、快速试听键', () => {
  const vox = TTS.modelBrief('voxcpm2');
  assert.equal(vox.voice, 'clone');
  assert.ok(vox.facts.indexOf('风格指令') >= 0);
  const omni = TTS.modelBrief('omnivoice');
  assert.equal(omni.nonCommercial, true);
  assert.deepEqual(omni.facts.slice(0, 1), ['内置音色 / 克隆 / 描述']);
  assert.match(TTS.quickSlow('voxcpm2'), /一倍实时/);
  assert.match(TTS.quickSlow('omnivoice'), /CC-BY-NC-4\.0/);
  // 没有种子：按单位落到默认语速
  ['voxcpm2', 'omnivoice', 'qwen3-tts-1.7b-voicedesign'].forEach((m) => {
    assert.equal(TTS.paceFor({}, m, 'zh').unit, 'char', m);
    assert.equal(TTS.paceFor({}, m, 'en').unit, 'word', m);
  });
  // 快速试听键带上描述项与旋钮：换一项就不是同一段
  const f = {text: '你好。', engine: 'omnivoice', mode: 'describe', lang: 'zh', omni: {gender: '女'}, knobs: {}};
  assert.notEqual(TTS.quickKey(f), TTS.quickKey(Object.assign({}, f, {omni: {gender: '男'}})));
  assert.notEqual(TTS.quickKey(f), TTS.quickKey(Object.assign({}, f, {knobs: {steps: 16}})));
});

test('配音块：OmniVoice 要压的句按目标时长直接合成（不事后变速），装得下的句、压太狠的句与别的引擎照旧', () => {
  const cues = [
    {id: 'g1', start: 0, end: 3, sp: 's1', trans: 'Hi.'},
    {id: 'g2', start: 3, end: 5, sp: 's1', trans: 'This week is about local-first tools and why the editing workflow finally gets out of your way.'},
    {id: 'gm', start: 5.5, end: 7.5, sp: 's1', trans: 'This week is about local-first tools.'},
    {id: 'g3', start: 8, end: 73, sp: 's1', trans: 'word '.repeat(240).trim() + '.'},
  ];
  const omni = TTS.dubBlocks(cues, {speakerOrder: ['s1'], engine: 'omnivoice'});
  assert.equal(omni[0].timed, undefined, '装得下的句照自然语速，不拉长');
  assert.ok(omni[0].end < 3);
  assert.equal(omni[2].timed, true, '压到 1.35× 以内的句按目标长度直接合成');
  assert.equal(omni[2].cut, false);
  assert.equal(omni[2].fast, false);
  assert.ok(omni[2].rate > 1 && omni[2].rate <= 1.35, String(omni[2].rate));
  assert.ok(omni[2].end <= omni[2].limitEnd + 0.001);
  assert.equal(omni[1].timed, undefined, '隐含语速快过 1.35× 会吞字：退回事后加速');
  assert.equal(omni[1].fast, true, '照样标橙');
  assert.equal(omni[3].timed, undefined, '超过 60 秒的那句退回普通做法');
  const trunc = TTS.dubBlocks(cues, {speakerOrder: ['s1'], engine: 'omnivoice', fit: 'truncate'});
  assert.ok(trunc.every((x) => !x.timed), '压缩并截断守 1.35× 上限，照旧事后处理');
  const over = TTS.dubBlocks(cues, {speakerOrder: ['s1'], engine: 'omnivoice', fit: 'overrun'});
  assert.ok(over.every((x) => !x.timed), '允许超出：不按时长');
  ['voxcpm2', 'qwen3'].forEach((e) => {
    const b = TTS.dubBlocks(cues, {speakerOrder: ['s1'], engine: e});
    assert.ok(b.every((x) => !x.timed), e);
  });
});
