const test = require('node:test');
const assert = require('node:assert');
global.window = {};
const RD = require('./model-readings.js');
require('./model-tts.js');
require('./model-dub.js');
require('./model-tools.js');
const TTS = global.window.BC_TTS;
const DUB = global.window.BC_DUB;
const TOOLS = global.window.BC_TOOLS;

test('注音：只有中文要注音（zh / zh-Hans / zh-Hant 及别名）', () => {
  ['zh', 'zh-Hans', 'zh-Hant', 'zh_CN', 'ZH'].forEach((l) => assert.equal(RD.needsReadings(l), true, l));
  ['en', 'ja', 'yue', 'ko', '', null].forEach((l) => assert.equal(RD.needsReadings(l), false, String(l)));
  assert.equal(RD.hasHan('Hello 世界'), true);
  assert.equal(RD.hasHan('Hello'), false);
});

test('注音：解析单字与多字注记，偏移落在表面文字上，读音统一小写', () => {
  const p = RD.parseReadings('他在银<行|XING2>里<行|hang2>走，<银行|yin2  hang2>。');
  assert.equal(p.surface, '他在银行里行走，银行。');
  assert.deepEqual(p.readings, [
    {start: 3, end: 4, surface: '行', reading: 'xing2'},
    {start: 5, end: 6, surface: '行', reading: 'hang2'},
    {start: 8, end: 10, surface: '银行', reading: 'yin2 hang2'},
  ]);
  assert.equal(RD.render(p.surface, p.readings), '他在银<行|xing2>里<行|hang2>走，<银行|yin2 hang2>。');
  assert.equal(RD.parseReadings('<绿|lü4>').readings[0].reading, 'lv4', 'ü 写成 v');
});

test('注音：带调拼音在解析时规范成声调数字，可混用、不分大小写', () => {
  const one = (s) => RD.parseReadings(s).readings.map((r) => r.reading);
  const p = RD.parseReadings('<行|háng>、<银行|yín háng>、<绿|lǜ>、走<了|le>、<女|nǚ>、<驴|lǘ>、<女|nü>、<嗯|ńg>');
  assert.equal(p.surface, '行、银行、绿、走了、女、驴、女、嗯');
  assert.deepEqual(p.readings.map((r) => r.reading), ['hang2', 'yin2 hang2', 'lv4', 'le5', 'nv3', 'lv2', 'nv5', 'ng2']);
  assert.deepEqual(one('<句|jǜ><雨|yǔ><行|xing>'), ['ju4', 'yu3', 'xing5'], 'j/q/x/y 后的 ü 折成 u；不标调是轻声');
  assert.deepEqual(one('<银行|yín hang2><银行|yin2 háng><东西|dong1 xi>'), ['yin2 hang2', 'yin2 hang2', 'dong1 xi5'], '逐音节混用');
  assert.deepEqual(one('<行|HÁNG><银行|Yín Háng><绿|LǛ><女|NÜ3>'), ['hang2', 'yin2 hang2', 'lv4', 'nv3'], '大写折成小写');
  assert.deepEqual(one('<呣|m2><哼|hng>'), ['m2', 'hng5'], '成音节的 m / hng');
  assert.equal(RD.render(p.surface, p.readings).startsWith('<行|hang2>、<银行|yin2 hang2>'), true, '渲回的是数字写法');
  // 数字 → 带调 → 再解析，回到同一个读音（词典与词组表的全部读音）。
  const all = [...Object.values(RD.DICT).flatMap((list) => list.map(([r]) => r)), ...Object.values(RD.PHRASES)];
  all.forEach((r) => assert.equal(RD.parseReadings(`<${'字'.repeat(r.split(' ').length)}|${RD.toneMark(r)}>`).readings[0].reading, r, r));
});

test('注音：畸形注记原样当普通文字', () => {
  [
    '<行|', '<|xing2>', '<行>', '<行|xyz>', '<行|xing7>', '<银行|yin2>', '<行|xing2 hang2>',
    '<行|háng2>', '<行|hángá>', '<银行|yín>', '<行|zhuángáng>', '<银行|yín 2háng>', '<行|xyz2>', '<中文|Chinese>',
    '<行|háng>', '<ab|hang2>',
  ].forEach((s) => {
    const p = RD.parseReadings(s);
    assert.equal(p.surface, s, s);
    assert.equal(p.readings.length, 0, s);
  });
  assert.equal(RD.stripReadings('a<行|'), 'a<行|');
  assert.equal(RD.stripReadings('没有注记'), '没有注记');
});

test('注音：量语速 / 估时长 / 字数都不算注记', () => {
  const plain = '我们重新渲染一遍，都是重渲染的。';
  const marked = '我们<重新|chong2 xin1>渲染一遍，<都|dou1>是<重|chong2>渲染的。';
  assert.equal(TTS.countUnits(marked, 'zh'), TTS.countUnits(plain, 'zh'));
  assert.equal(TTS.estimateDuration(marked), TTS.estimateDuration(plain));
  assert.equal(TOOLS.textStats(marked), TOOLS.textStats(plain));
  assert.equal(TTS.fitPlan([{id: 'c1', start: 0, end: 4, trans: marked}], {pace: TTS.paceFor({}, 'indextts2', 'zh'), lang: 'zh'}).rows[0].text, plain);
});

test('注音：带调拼音', () => {
  assert.equal(RD.toneMark('hang2'), 'háng');
  assert.equal(RD.toneMark('yin2 hang2'), 'yín háng');
  assert.equal(RD.toneMark('lv4'), 'lǜ');
  assert.equal(RD.toneMark('lve4'), 'lüè');
  assert.equal(RD.toneMark('liu2'), 'liú');
  assert.equal(RD.toneMark('gui4'), 'guì');
  assert.equal(RD.toneMark('ou3'), 'ǒu');
  assert.equal(RD.toneMark('le5'), 'le');
});

test('注音判定：词组表命中不算候选，剩下的多音字按词典默认，模型按上下文改', () => {
  const text = '我们重新渲染，都是重渲染的，时间差不多。';
  const dict = RD.annotate(text, {llm: false});
  const by = (a, s) => a.readings.filter((r) => r.surface === s);
  assert.equal(by(dict, '重新')[0].src, 'phrase');
  assert.equal(by(dict, '重新')[0].chip, false);
  assert.equal(by(dict, '差不多')[0].reading, 'cha4 bu4 duo1');
  assert.deepEqual(by(dict, '重').map((r) => [r.reading, r.src, r.chip]), [['zhong4', 'dict', true]]);
  const llm = RD.annotate(text, {llm: true});
  assert.deepEqual(by(llm, '重').map((r) => [r.reading, r.src, r.dflt]), [['chong2', 'llm', 'zhong4']]);
  assert.equal(by(llm, '都')[0].reading, 'dou1');
  // 文字里手写的注记照单全收
  const own = RD.annotate('<行|hang2>不行', {llm: true});
  assert.deepEqual(own.readings.map((r) => [r.start, r.reading, r.src]), [[0, 'hang2', 'user'], [2, 'xing2', 'dict']]);
  // 项目级读音优先于词组表
  const proj = RD.annotate('行长来了', {project: [{surface: '行长', reading: 'xing2 zhang3'}, {surface: '行', reading: 'hang2'}]});
  assert.deepEqual(proj.readings.map((r) => [r.surface, r.reading, r.remembered]), [['行长', 'xing2 zhang3', true]]);
});

test('注音判定：普通句子的候选不多（防清单膨胀把每句都标黄）', () => {
  const a = RD.annotate('今天我们来看一下这个项目的整体结构，然后再讲具体的实现细节。', {llm: true});
  assert.ok(a.readings.filter((r) => r.chip).length <= 1);
});

test('注音：候选读音——单字带例词，多字按其中多音字组合', () => {
  assert.deepEqual(RD.optionsOf({surface: '行', reading: 'hang2'}), [{reading: 'xing2', ex: '行走'}, {reading: 'hang2', ex: '银行'}]);
  const combos = RD.optionsOf({surface: '行长', reading: 'hang2 zhang3'}).map((o) => o.reading);
  assert.equal(combos[0], 'hang2 zhang3');
  assert.ok(combos.includes('xing2 chang2'));
});

test('注音：各引擎没按注音念的', () => {
  const rs = RD.annotate('绿林好汉重做一遍，模样没变', {llm: true}).readings;
  const pick = (e) => RD.dropped(rs, e).map((r) => r.surface + r.reading);
  assert.deepEqual(pick('indextts25'), []);
  assert.deepEqual(pick('indextts2'), ['绿lu4'], 'IndexTTS2 词表没有 LU4 这个片');
  // Qwen3：词组表 / 词典默认不渲染也不算丢；与默认不同的读音靠同音字，没有代表字（mu2）才算丢
  assert.deepEqual(pick('qwen3'), ['模mu2']);
  assert.deepEqual(pick('qwen3-1.7b'), ['模mu2']);
  assert.equal(RD.dropped(rs, 'gptsovits').length, rs.length);
  assert.match(RD.dropReason('qwen3'), /Qwen3 不支持这一读音/);
});

test('注音：收据一行、计数、只有多字词进项目读音', () => {
  assert.equal(RD.receiptLine(0, 0), '');
  assert.equal(RD.receiptLine(12, 0), '注音 12 处');
  assert.equal(RD.receiptLine(12, 3), '注音 12 处 · 3 处引擎没按注音念');
  const edited = [
    {start: 0, end: 2, surface: '行长', reading: 'xing2 zhang3', src: 'user'},
    {start: 3, end: 4, surface: '行', reading: 'hang2', src: 'user'},
    {start: 5, end: 6, surface: '重', reading: 'chong2', src: 'llm'},
  ];
  assert.deepEqual(RD.remember([{surface: '行长', reading: 'hang2 zhang3'}, {surface: '银行', reading: 'yin2 hang2'}], edited),
    [{surface: '行长', reading: 'xing2 zhang3'}, {surface: '银行', reading: 'yin2 hang2'}]);
  assert.equal(RD.llmReady({name: 'x'}), true);
  assert.equal(RD.llmReady({name: 'x', note: '未连接 key'}), false);
  assert.equal(RD.llmReady(null), false);
});

test('注音进配音：块上存表面文字，注记与没念的单列；重新生成与换回旧版都带着', () => {
  const cues = [{id: 'c1', start: 0, end: 3, sp: 's1', text: 'We re-render.', trans: '我们重渲染。'},
    {id: 'c2', start: 3.2, end: 6, sp: 's1', text: 'Green.', trans: '绿色。'}];
  const script = {c1: '我们<重|chong2>渲染。', c2: '<绿|lv4>色。'};
  const blocks = TTS.dubBlocks(cues, {script, engine: 'indextts2'});
  assert.equal(blocks[0].text, '我们重渲染。');
  assert.deepEqual(blocks[0].readings.map((r) => r.reading), ['chong2']);
  assert.deepEqual(blocks[0].readingsDropped, []);
  assert.deepEqual(blocks[1].readingsDropped.map((r) => r.surface), ['绿']);
  assert.deepEqual(RD.tally(blocks), {n: 2, m: 1});
  assert.equal(TTS.dubBlocks(cues, {}).some((b) => b.readings), false, '没注音的块不带这两个字段');
  // 没有配音稿也不丢读音；换一只引擎重算没念的
  const g = {lang: 'zh', engine: 'indextts2', blocks};
  const re = DUB.regenerate(blocks, ['c2'], {group: g, take: {model: 'index-tts2.5', engine: 'indextts25'}});
  assert.equal(re[1].text, '绿色。');
  assert.deepEqual(re[1].readingsDropped, []);
  assert.equal(DUB.activeTake(re[1], g).readings[0].reading, 'lv4');
  const back = DUB.restoreTake(re, 'c2', 1, {group: g});
  assert.deepEqual(back[1].readingsDropped.map((r) => r.surface), ['绿'], '换回第 1 版：那一版是 IndexTTS2 念的');
});

test('注音进生成语音：表单的 chip 行渲进文字，文字改过就作废', () => {
  const f = {text: '行不行', engine: 'indextts2', mode: 'clone', lang: 'zh'};
  const a = RD.annotate(f.text, {});
  const g = Object.assign({}, f, {readings: RD.setReading(a.readings, 0, 'hang2'), readingsFor: f.text});
  assert.equal(RD.formText(g), '<行|hang2>不<行|xing2>');
  assert.equal(RD.formStale(g), false);
  const edited = Object.assign({}, g, {text: '行不行呢'});
  assert.equal(RD.formStale(edited), true);
  assert.equal(RD.formText(edited), '行不行呢');
  const rec = TOOLS.makeRecord(Object.assign(TOOLS.blank(), g), 3);
  assert.equal(rec.text, '<行|hang2>不<行|xing2>');
  assert.equal(rec.surface, '行不行');
  const vo = DUB.narrationGroup(g, 2, {});
  assert.equal(vo.blocks[0].text, '行不行');
  assert.equal(vo.blocks[0].readings[0].reading, 'hang2');
});

test('「交给 Agent」提示词：折出模型 / 音色 / 风格 / 语言，含中文才要它标读音，空文字留占位', () => {
  const f = Object.assign(TOOLS.blank(), {text: '这一行<行|hang2>字很重要。', style: '像深夜电台一样慢一点', lang: 'zh'});
  const p = TOOLS.agentPrompt(f);
  assert.match(p, /^用 BaoCut 生成语音：模型 Qwen3-TTS 0\.6B CustomVoice，音色 Serena，风格「像深夜电台一样慢一点」，语言 简体中文。先按上下文标好多音字读音（<字\|读音> 语法），再合成成 WAV 给我试听；不要改我的文字。要念的文字：\n\n这一行行字很重要。$/);
  const en = TOOLS.agentPrompt(Object.assign(TOOLS.blank(), {text: 'Hello there.', preset: 'Eric'}));
  assert.match(en, /音色 Eric。合成成 WAV/);
  assert.doesNotMatch(en, /多音字|风格|语言/);
  assert.match(TOOLS.agentPrompt(TOOLS.blank()), /要念的文字：\n\n（把要念的文字放在这里）$/);
});

test('注音：VoxCPM2 / OmniVoice 不认注音，按原字念', () => {
  const marked = '他在银<行|hang2>里。';
  ['voxcpm2', 'omnivoice'].forEach((e) => {
    const rd = RD.forEngine(marked, e);
    assert.equal(rd.text, '他在银行里。', e);
    assert.equal(rd.dropped.length, rd.readings.length, e);
  });
  assert.match(RD.dropReason('voxcpm2'), /VoxCPM2 不认注音/);
  assert.match(RD.dropReason('omnivoice'), /OmniVoice 不认注音/);
});
