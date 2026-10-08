const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-tts.js');
require('./model-dub.js');
const TTS = global.window.BC_TTS;
const DUB = global.window.BC_DUB;

const cues = [
  {id: 'c1', start: 0, end: 3, sp: 's1', text: '大家好，今天聊聊本地模型。', trans: 'Hi everyone, today we talk about local models.'},
  {id: 'c2', start: 3.2, end: 5, sp: 's2', text: '先看架构。', trans: 'Architecture first, and then we will look at the numbers in detail.'},
  {id: 'c3', start: 5.4, end: 9, sp: 's1', text: '然后是速度对比。', trans: 'Then speed.'},
  {id: 'c4', start: 9.5, end: 12, sp: 's3', text: '最后总结。', trans: 'Finally, a summary.'},
];
const pace = TTS.paceFor({}, 'qwen3-tts', 'en');

test('引擎能力卡：Qwen3 有预设与风格，克隆型引擎没有预设', () => {
  const q = DUB.capabilities('qwen3');
  assert.equal(q.presets.length, 9);
  assert.equal(q.style, true);
  assert.equal(q.emotion, false);
  const i = DUB.capabilities('indextts2');
  assert.equal(i.presets.length, 0);
  assert.equal(i.emotion, true);
  assert.match(DUB.capabilityLine('qwen3'), /9 个预设音色/);
  assert.match(DUB.capabilityLine('gptsovits'), /没有预设音色/);
});

test('预设按目标语言分母语 / 非母语', () => {
  const ja = DUB.presetsFor('qwen3', 'ja');
  assert.deepEqual(ja.native.map((p) => p.id), ['Ono_Anna']);
  assert.equal(ja.others.length, 8);
  const zh = DUB.presetsFor('qwen3', 'zh-CN');
  assert.equal(zh.native.length, 7);
  assert.equal(DUB.presetsFor('indextts2', 'zh').native.length, 0);
});

test('发音标准优先的实现来源随引擎 × 语言变化', () => {
  assert.equal(DUB.accentSource('qwen3', 'ko').kind, 'preset');
  assert.equal(DUB.accentSource('indextts2', 'en').kind, 'ref');
  // 2026-09-21：内置音色从中英两段扩到 zh / en / ja / es 八只，中文不用再自己传录音
  assert.equal(DUB.accentSource('indextts2', 'zh').kind, 'ref');
  assert.equal(DUB.accentSource('indextts25', 'ar').kind, 'upload');
  assert.equal(DUB.accentSource('qwen3', 'de').kind, 'preset-any');
  const opts = DUB.priorityOptions('indextts2', 'zh');
  assert.equal(opts.length, 2);
  assert.equal(opts[0].id, 'voice');
  assert.equal(opts[1].needsUpload, false, '有中文内置音色，不必上传');
  assert.equal(DUB.priorityOptions('indextts25', 'ar')[1].needsUpload, true);
  assert.equal(DUB.priorityOptions('gptsovits', 'ja')[0].available, false);
});

test('取向映射回 strategy，并给说话人分配母语预设', () => {
  assert.equal(DUB.strategyOf('voice', 'qwen3', 'ja'), 'clone');
  assert.equal(DUB.strategyOf('accent', 'qwen3', 'ja'), 'preset');
  assert.equal(DUB.strategyOf('accent', 'indextts2', 'zh'), 'upload', '内置母语参考仍按「同一段参考」记账');
  const a = DUB.assignPresets('qwen3', 'ko', ['s1', 's2']);
  assert.deepEqual(a, {s1: 'Sohee', s2: 'Sohee'});
  const b = DUB.assignPresets('qwen3', 'en', ['s1', 's2', 's3']);
  assert.equal(Object.keys(b).length, 3);
  assert.ok(b.s1 !== b.s2);
  assert.equal(DUB.voiceReady({priority: 'accent', engine: 'indextts2', lang: 'zh', ref: null}), true, '有中文内置音色');
  assert.equal(DUB.voiceReady({priority: 'accent', engine: 'indextts25', lang: 'ar', ref: null}), false);
  assert.equal(DUB.voiceReady({priority: 'accent', engine: 'indextts25', lang: 'ar', ref: {name: 'x'}}), true);
  // OmniVoice 上传的母语参考要写原文：不带原文会吞掉每句开头
  assert.equal(DUB.voiceReady({priority: 'accent', engine: 'omnivoice', lang: 'uk', ref: {name: 'x'}}), false);
  assert.equal(DUB.voiceReady({priority: 'accent', engine: 'omnivoice', lang: 'uk', ref: {name: 'x'}, refText: 'Привіт'}), true);
  assert.match(DUB.startProblem({priority: 'accent', engine: 'omnivoice', lang: 'uk', ref: {name: 'x'}, refText: ' '}, {count: 3}), /原文/);
  assert.match(DUB.voiceSummary({priority: 'voice'}, 3), /克隆 3 位/);
  assert.match(DUB.voiceSummary({priority: 'accent', engine: 'qwen3', lang: 'ja', presets: {s1: 'Ono_Anna'}}, 1), /Ono_Anna/);
});

test('引擎专属的其他设置', () => {
  assert.deepEqual(DUB.extraSettings('qwen3').map((s) => s.key), ['style']);
  assert.deepEqual(DUB.extraSettings('indextts2').map((s) => s.key), ['emotion']);
  assert.deepEqual(DUB.extraSettings('gptsovits').map((s) => s.key), ['refText']);
});

test('时长对比：每句原声 vs 预测，汇总与条宽', () => {
  const plan = DUB.compareRows(cues, {pace, lang: 'en'});
  assert.equal(plan.rows.length, 4);
  const r2 = plan.rows[1];
  assert.equal(r2.srcDur, 1.8);
  assert.ok(r2.predDur > r2.srcDur);
  assert.ok(r2.ratio > 1);
  assert.ok(['over', 'retranslate', 'tight'].indexOf(r2.level) >= 0);
  const r3 = plan.rows[2];
  assert.equal(r3.short, true);
  const sum = DUB.compareSummary(plan);
  assert.equal(sum.total, 4);
  assert.ok(sum.need >= 1);
  assert.ok(sum.short >= 1);
  const w = DUB.barWidths(r2);
  assert.equal(w.pred, 100);
  assert.ok(w.src < 100);
  assert.match(DUB.compareLine(sum), /译文预计/);
  assert.equal(DUB.mmss(192), '3 分 12 秒');
});

test('过程：进度换算到句，逐句列表带状态', () => {
  assert.equal(DUB.sentenceAt(5, 4), -1);
  assert.equal(DUB.sentenceAt(95, 4), 4);
  const mid = DUB.runLog(cues, 60, {failed: {c1: true}});
  assert.equal(mid.stage, 'synth');
  assert.equal(mid.items.filter((i) => i.state === 'running').length, 1);
  assert.equal(mid.items.find((i) => i.id === 'c1').state, 'failed');
  assert.ok(mid.items.some((i) => i.state === 'queued'));
  assert.equal(DUB.runLog(cues, 10).stage, 'before');
  assert.equal(DUB.runLog(cues, 99).done, 4);
});

test('块级管理：静音、删除、排队与重新生成', () => {
  const blocks = TTS.dubBlocks(cues, {speakerOrder: ['s1', 's2', 's3'], failed: {c4: true}, fit: 'compress'});
  const m = DUB.muteBlocks(blocks, ['c1'], true);
  assert.equal(m[0].muted, true);
  assert.equal(DUB.blockCounts(m).muted, 1);
  assert.equal(DUB.deleteBlocks(blocks, ['c1', 'c2']).length, 2);
  const q = DUB.queueRegen(blocks, ['c2']);
  assert.equal(q[1].status, 'queued');
  assert.equal(DUB.blockCounts(q).queued, 1);
  const stretched = TTS.stretchBlock(q[1], 4);
  const done = DUB.regenerate([stretched], ['c2'], {fit: 'compress', script: {c2: 'Architecture first.'}});
  assert.equal(done[0].status, 'done');
  assert.equal(done[0].manual, false);
  assert.equal(done[0].text, 'Architecture first.');
  assert.ok(done[0].synth < stretched.synth);
  assert.match(DUB.trackLine(blocks), /4 句 · 1 句没合成/);
  assert.deepEqual(DUB.regenCandidates(blocks).indexOf('c4') >= 0, true);
});

test('选择：单选、追加、shift 连选', () => {
  const blocks = TTS.dubBlocks(cues, {speakerOrder: ['s1', 's2', 's3']});
  assert.deepEqual(DUB.pickIds([], blocks, 'c2'), ['c2']);
  assert.deepEqual(DUB.pickIds(['c2'], blocks, 'c4', {meta: true}), ['c2', 'c4']);
  assert.deepEqual(DUB.pickIds(['c2', 'c4'], blocks, 'c4', {meta: true}), ['c2']);
  assert.deepEqual(DUB.pickIds(['c1'], blocks, 'c3', {shift: true}), ['c1', 'c2', 'c3']);
  assert.deepEqual(DUB.pickIds(['c3'], blocks, 'c1', {shift: true}), ['c3', 'c1', 'c2']);
  assert.equal(DUB.selectionTitle(blocks, ['c1', 'c2']), '选中 2 句');
  assert.match(DUB.selectionTitle(blocks, ['c3']), /Then speed/);
});

test('导出声道：默认模式、清单与汇总文案', () => {
  const eff = [
    {key: 'audio', kind: 'audio', id: 'audio', label: '原声', on: true},
    {key: 'dub:en', kind: 'dub', id: 'en', label: '配音 · English', on: true},
    {key: 'dub:ja', kind: 'dub', id: 'ja', label: '配音 · 日本語', on: true},
    {key: 'bed:en', kind: 'bed', id: 'en', label: '背景声 · English', on: true},
    {key: 'bed:ja', kind: 'bed', id: 'ja', label: '背景声 · 日本語', on: false},
  ];
  assert.equal(DUB.dubModeDefault(eff), 'multi');
  assert.equal(DUB.dubModeDefault(eff.slice(0, 2)), 'one');
  const multi = DUB.audioTracks(eff, 'multi');
  assert.equal(multi.length, 3);
  assert.equal(multi[0].label, '原声');
  assert.equal(multi[1].dflt, true);
  assert.deepEqual([multi[1].sub, multi[2].sub], ['配音 + 背景声', '配音'], '背景声一组一份：只混自己那组开着的');
  const one = DUB.audioTracks(eff, 'one', 'ja');
  assert.equal(one.length, 1);
  assert.equal(one[0].id, 'ja');
  assert.match(one[0].sub, /^配音 · 其余 1 条不进文件/);
  assert.match(DUB.audioTracks(eff, 'one', 'en')[0].sub, /^配音 \+ 背景声 · 其余/);
  assert.match(DUB.dubExportPart(eff, 'multi'), /3 条声道/);
  assert.equal(DUB.dubExportPart(eff, 'one', 'ja'), '配音 · 日本語');
  assert.equal(DUB.audioTracks([eff[0]], 'one').length, 0);
});

test('引擎列表：能力、取向与就绪判定', () => {
  assert.equal(DUB.accentSource('qwen3', 'ja').kind, 'preset');
  assert.equal(DUB.strategyOf('voice', 'qwen3', 'en'), 'clone');
  assert.equal(DUB.strategyOf('accent', 'qwen3', 'ja'), 'preset');
  assert.equal(DUB.voiceReady({priority: 'voice', engine: 'qwen3', lang: 'en'}), true);
  assert.equal(DUB.extraSettings('qwen3')[0].default, '');
  // Qwen3-TTS 1.7B 进配音引擎菜单：CustomVoice / Base，2026-09-26 起再加 VoiceDesign（可描述新声音）。
  assert.equal(DUB.capabilityLine('qwen3-1.7b'), '会念 10 种语言 · 9 个预设音色 · 可克隆 · 一句话指定风格 · 可描述新声音');
  assert.equal(DUB.capabilities('qwen3-1.7b').presets.length, 9);
  // ja / ko 有原生预设；德语等没有母语预设也没有内置母语参考 → 任选一个预设。
  // 配音不走 1.7B 的描述造声（VoiceDesign 只在语音合成面板与工作台用）
  assert.equal(DUB.accentSource('qwen3-1.7b', 'ja').kind, 'preset');
  assert.equal(DUB.accentSource('qwen3-1.7b', 'de').kind, 'preset-any');
  assert.equal(DUB.modelNeeded({priority: 'accent', engine: 'qwen3-1.7b', lang: 'de'}), 'qwen3-tts-1.7b-customvoice');
  assert.equal(DUB.accentSource('qwen3', 'de').kind, 'preset-any');
});

test('音频 Tab 分组：一条配音轨折成 background.wav + 逐句 s-N.wav，散装文件另列', () => {
  const blocks = [
    {id: 'c2', start: 3.2, end: 5.0, text: 'Architecture first.', status: 'done', fast: true},
    {id: 'c1', start: 0, end: 3.1, text: 'Hi everyone.', status: 'done'},
    {id: 'c3', start: 5.4, end: 9, text: 'Then speed.', status: 'failed'},
    {id: 'c4', start: 9.5, end: 12, text: 'Finally.', status: 'done', muted: true},
  ];
  const d = {lang: 'en', langName: 'English', engineName: 'Qwen3-TTS', blocks, bed: true};
  const files = DUB.dubFiles(d, {duration: 12});
  assert.deepEqual(files.map((f) => f.name), ['background.wav', 's-1.wav', 's-2.wav', 's-3.wav', 's-4.wav']);
  assert.equal(files[0].kind, 'bed');
  assert.equal(files[0].dur, 12);
  assert.equal(files[1].blockId, 'c1');               // 按 start 排，不按传入顺序
  assert.deepEqual(files.slice(1).map((f) => f.status), ['done', 'fast', 'failed', 'done']);
  assert.equal(files[4].muted, true);
  assert.equal(files[2].dur, 1.8);
  assert.equal(DUB.dubFiles({lang: 'ja', blocks, bed: false}).length, 4);   // 没分离就没有 background.wav
  assert.equal(DUB.groupLine(d, files), '5 个文件 · 4 句 · 1 句没合成 · 1 句过快 · 1 句静音 · Qwen3-TTS');
  const loose = [{id: 'a1', name: 'bgm.mp3'}];
  const shape = DUB.audioGroups(loose, [d, {lang: 'ja', langName: '日本語', engine: 'qwen3', blocks: blocks.slice(0, 2)}], {duration: 12, dubOff: {ja: true}});
  assert.equal(shape.groups.length, 2);
  assert.equal(shape.groups[0].onTimeline, true);
  assert.equal(shape.groups[1].onTimeline, false);
  assert.deepEqual(shape.groups[0].regen, ['c2', 'c3']);
  assert.equal(shape.groups[1].engineName, 'qwen3');
  assert.equal(shape.total, 8);
  assert.deepEqual(shape.loose, loose);
  assert.equal(DUB.audioAside(shape), '2 组配音 · 8 个文件');
  assert.equal(DUB.audioAside(DUB.audioGroups(loose, [])), '1 个文件');
});

test('设置页（2026-09-16）：按语言与取向自动选引擎，已装的优先', () => {
  const none = () => false;
  // D2（2026-09-23）：中英文什么都没装时缺省 IndexTTS2
  assert.deepEqual(DUB.pickEngine({lang: 'en', priority: 'voice', installed: none}), {engine: 'indextts2', installed: false, model: 'indextts2', speaks: true});
  assert.equal(DUB.pickEngine({lang: 'zh', priority: 'voice', installed: none}).engine, 'indextts2');
  assert.equal(DUB.pickEngine({lang: 'zh-Hans', priority: 'accent', installed: none}).engine, 'indextts2');
  // 已装优先不变：装了 Qwen3 0.6B Base 没装 IndexTTS2 → 仍用 Qwen3
  const q3 = (id) => id === 'qwen3-tts-0.6b-base';
  assert.equal(DUB.pickEngine({lang: 'zh', priority: 'voice', installed: q3}).engine, 'qwen3');
  assert.equal(DUB.pickEngine({lang: 'zh', priority: 'voice', installed: q3}).installed, true);
  // 两只都装了：IndexTTS2 排在前面
  assert.equal(DUB.pickEngine({lang: 'en', priority: 'voice', installed: (id) => id === 'qwen3-tts-0.6b-base' || id === 'indextts2'}).engine, 'indextts2');
  // IndexTTS2 不会念的语言不受影响：韩语、日语照旧表头 Qwen3
  assert.equal(DUB.pickEngine({lang: 'ko', priority: 'voice', installed: none}).engine, 'qwen3');
  const has = (id) => id === 'indextts2';
  assert.equal(DUB.pickEngine({lang: 'en', priority: 'voice', installed: has}).engine, 'indextts2');
  assert.equal(DUB.pickEngine({lang: 'en', priority: 'voice', installed: has}).installed, true);
  // 日语 IndexTTS2 不会念：仍是 Qwen3；发音标准优先要的是 CustomVoice
  const ja = DUB.pickEngine({lang: 'ja', priority: 'accent', installed: has});
  assert.equal(ja.engine, 'qwen3');
  assert.equal(ja.model, 'qwen3-tts-0.6b-customvoice');
  assert.equal(DUB.pickEngine({lang: 'xx', installed: none}).speaks, false);
});

test('模型门：缺的模型合成一张卡；已装的替代引擎；主按钮文案带「下载模型并」', () => {
  const cat = [{id: 'qwen3-tts-0.6b-base', name: 'Qwen3-TTS 0.6B Base', size: 1249}, {id: 'htdemucs-ft', name: 'HTDemucs-FT', size: 321}];
  const r = {engine: 'qwen3', lang: 'en', priority: 'voice', separate: true};
  const m = DUB.missingModels(r, {installed: () => false, catalog: cat});
  assert.deepEqual(m.ids, ['qwen3-tts-0.6b-base', 'htdemucs-ft']);
  assert.equal(m.sizeLabel, '1.5 GB');
  assert.deepEqual(DUB.missingModels(r, {installed: () => false, catalog: cat, locked: true}).ids, ['qwen3-tts-0.6b-base']);
  assert.deepEqual(DUB.missingModels({...r, separate: false}, {installed: (id) => id === 'qwen3-tts-0.6b-base', catalog: cat}).ids, []);
  assert.equal(DUB.installedAlternative(r, () => false), null);
  assert.deepEqual(DUB.installedAlternative(r, (id) => id === 'gpt-sovits-v2'), {engine: 'gptsovits', name: 'GPT-SoVITS'});
  assert.equal(DUB.ctaLabel({count: 62, ln: ' English'}), '配成 English · 62 句');
  assert.equal(DUB.ctaLabel({count: 62, ln: '日本語', needTranslate: true, download: true}), '下载模型并翻译并配成日本語 · 62 句');
  assert.equal(DUB.ctaLabel({count: 62, ln: ' English', review: true}), '对比时长再配成 English');
  assert.equal(DUB.ctaLabel({count: 3, locked: true}), '重新生成这 3 句');
});

test('设置页摘要句、语言行与开始前的阻碍', () => {
  const r = {engine: 'qwen3', lang: 'en', priority: 'voice'};
  assert.equal(DUB.stepLine(r, {count: 62, speakers: 3, langName: 'English'}), '用 Qwen3-TTS 0.6B 克隆 3 位说话人的原声，把 62 句配成English');
  assert.equal(DUB.stepLine({...r, lang: 'ja', priority: 'accent'}, {count: 62, langName: '日本語', needTranslate: true}), '先把 62 句翻成日本語，再用 Qwen3-TTS 0.6B 换成母语声音配音');
  assert.equal(DUB.langLine({lang: 'en', langName: 'English', translated: true, dubs: []}), 'English 已有译文 · 直接配');
  assert.equal(DUB.langLine({lang: 'ja', langName: '日本語', translated: false, dubs: [{lang: 'ja'}]}), '日本語 还没有译文 · 会先翻译，译文轨也留下 · 已有「配音 · 日本語」，这次写回同一条轨');
  assert.equal(DUB.startProblem(r, {count: 0}), '还没有文稿 · 先转录，转好回到这里就能配');
  assert.equal(DUB.startProblem({...r, engine: 'indextts2', lang: 'ja'}, {count: 5, langName: '日本語'}), 'IndexTTS2 不会念日本語 · 换一只引擎');
  assert.equal(DUB.startProblem({engine: 'indextts2', lang: 'zh', priority: 'accent'}, {count: 5, langName: '中文'}), null, '中文有内置音色');
  assert.equal(DUB.startProblem({engine: 'indextts25', lang: 'ar', priority: 'accent'}, {count: 5, langName: 'العربية'}), '先给一段 5–10 秒的العربية母语录音当参考');
  assert.equal(DUB.startProblem(r, {count: 5}), null);
});

test('在哪儿跑：只有报得出这只模型的在线节点进候选', () => {
  const nodes = [
    {id: 'n1', name: 'mac-studio.local', state: 'online', ttsModels: ['index-tts2.5', 'gpt-sovits-v2']},
    {id: 'n2', name: 'mini.local', state: 'online', ttsModels: ['gpt-sovits-v2']},
    {id: 'n3', name: 'older.local', state: 'online'},                       // 还没扫过配音模型
    {id: 'n4', name: 'away.local', state: 'offline', ttsModels: ['index-tts2.5']},
  ];
  assert.deepEqual(DUB.dubNodes(nodes, 'index-tts2.5').map((n) => n.id), ['n1']);
  assert.deepEqual(DUB.dubNodes(nodes, 'gpt-sovits-v2').map((n) => n.id), ['n1', 'n2']);
  assert.equal(DUB.nodeRunsModel(nodes, 'n2', 'gpt-sovits-v2'), true);
  assert.equal(DUB.nodeRunsModel(nodes, 'n3', 'gpt-sovits-v2'), false, '没报过 ttsModels 的不给选');
  assert.equal(DUB.nodeRunsModel(nodes, 'n4', 'index-tts2.5'), false, '掉线的不给选');
  // 选机器只包一层前缀，模型 id 本身不变
  assert.equal(DUB.runtimeModel('index-tts2.5', null), 'index-tts2.5');
  assert.equal(DUB.runtimeModel('index-tts2.5', 'n1'), 'remote:n1/index-tts2.5');
});

test('跑在别人机器上时 TTS 那只不进模型门，人声分离照算', () => {
  const r = {engine: 'indextts25', lang: 'en', priority: 'accent', separate: true};
  const cat = [{id: 'index-tts2.5', name: 'IndexTTS 2.5', size: 2200}, {id: 'htdemucs-ft', name: 'HTDemucs', size: 320}];
  const none = () => false;
  assert.deepEqual(DUB.missingModels(r, {installed: none, catalog: cat}).ids, ['index-tts2.5', 'htdemucs-ft']);
  assert.deepEqual(DUB.missingModels(r, {installed: none, catalog: cat, remote: true}).ids, ['htdemucs-ft']);
  assert.deepEqual(DUB.missingModels({...r, separate: false}, {installed: none, catalog: cat, remote: true}).ids, []);
});

test('节点也开放人声分离时分离一并交过去（远端任务 J2）：HTDemucs 也不进门，旁注说清', () => {
  const nodes = [
    {id: 'n1', state: 'online', ttsModels: ['index-tts2.5'], tasks: ['asr', 'tts', 'separate'], taskModels: {separate: ['htdemucs-ft']}},
    {id: 'n2', state: 'online', ttsModels: ['index-tts2.5'], tasks: ['asr', 'tts'], taskModels: {}},
    {id: 'n3', state: 'online', ttsModels: ['index-tts2.5']},
    {id: 'n4', state: 'offline', ttsModels: ['index-tts2.5'], tasks: ['separate'], taskModels: {separate: ['htdemucs-ft']}},
    {id: 'n5', state: 'online', tasks: ['separate'], taskModels: {separate: []}},
  ];
  assert.equal(DUB.nodeSeparates(nodes, 'n1'), true);
  assert.equal(DUB.nodeSeparates(nodes, 'n2'), false, '没开放分离');
  assert.equal(DUB.nodeSeparates(nodes, 'n3'), false, '没报 tasks 的旧节点分离留本机');
  assert.equal(DUB.nodeSeparates(nodes, 'n4'), false, '掉线');
  assert.equal(DUB.nodeSeparates(nodes, 'n5'), false, '开了任务却没装 HTDemucs');
  assert.equal(DUB.nodeSeparates(nodes, null), false, '本机');
  const r = {engine: 'indextts25', lang: 'en', priority: 'accent', separate: true};
  const cat = [{id: 'index-tts2.5', name: 'IndexTTS 2.5', size: 2200}, {id: 'htdemucs-ft', name: 'HTDemucs', size: 320}];
  const none = () => false;
  assert.deepEqual(DUB.missingModels(r, {installed: none, catalog: cat, remote: true, remoteSeparate: true}).ids, []);
  assert.deepEqual(DUB.missingModels(r, {installed: none, catalog: cat, remoteSeparate: true}).ids, ['index-tts2.5', 'htdemucs-ft'], '合成在本机时分离也在本机');
  assert.match(DUB.nodeHint({separate: true, remoteSeparate: true}), /人声分离与合成都在那台机器上跑/);
  assert.match(DUB.nodeHint({separate: true, remoteSeparate: false}), /分离仍在这台 Mac 上跑/);
  assert.equal(DUB.nodeHint({separate: false, remoteSeparate: true}), '合成在那台机器上跑、音频经局域网传回，本机不需要装这只模型');
  assert.equal(DUB.whereLine({}), '全程在本机');
  assert.equal(DUB.whereLine({nodeName: 'mac-studio.local', separate: true, remoteSeparate: true}), '合成与人声分离在 mac-studio.local 上跑');
  assert.equal(DUB.whereLine({nodeName: 'mac-studio.local', separate: true, remoteSeparate: false}), '合成在 mac-studio.local 上跑');
  assert.equal(DUB.whereLine({nodeName: 'mac-studio.local', separate: false, remoteSeparate: true}), '合成在 mac-studio.local 上跑');
});

test('版（2026-09-23）：旧块补第 1 版，重新生成记新版且上一版留在归档，换回一版只改指向不新增', () => {
  const g = {lang: 'en', langName: 'English', engine: 'qwen3', priority: 'voice', fit: 'compress'};
  const blocks = TTS.dubBlocks(cues, {speakerOrder: ['s1', 's2', 's3'], failed: {c4: true}, fit: 'compress'});
  const c1 = blocks.find((b) => b.id === 'c1');
  const t1 = DUB.takesOf(c1, g);
  assert.equal(t1.length, 1);
  assert.equal(t1[0].k, 1);
  assert.equal(t1[0].model, DUB.groupModel(g));
  assert.equal(t1[0].engine, 'qwen3');
  assert.equal(DUB.demoSeed('c1', 1), t1[0].seed);
  assert.ok(t1[0].seed >= 1000 && t1[0].seed <= 9999);
  assert.equal(DUB.takesOf(blocks.find((b) => b.id === 'c4'), g).length, 0, '没合成出来的句没有版');
  assert.equal(DUB.archivedTakes(c1, g).length, 0);
  assert.deepEqual(DUB.sentenceIndex(blocks, 'c2'), {i: 2, n: 4});
  assert.equal(DUB.takeFile(12, 3), 's-12.t3.wav');

  const regen = DUB.regenerate(blocks, ['c1'], {fit: 'compress', group: g, take: {model: 'index-tts2.5', seed: 4242}});
  const r1 = regen.find((b) => b.id === 'c1');
  assert.equal(r1.takes.length, 2);
  assert.equal(r1.take, 2);
  const cur = DUB.activeTake(r1, g);
  assert.equal(cur.k, 2);
  assert.equal(cur.seed, 4242);
  assert.equal(cur.model, 'index-tts2.5');
  assert.equal(cur.engine, 'indextts25');
  assert.equal(r1.synth, cur.synth);
  assert.equal(r1.end, +(r1.start + Math.min(cur.synth, r1.slotEnd - r1.start) * 1).toFixed(2) || r1.end);
  assert.equal(DUB.archivedTakes(r1, g).length, 1);
  assert.equal(DUB.archivedTakes(r1, g)[0].k, 1);
  assert.equal(DUB.modelMismatch(r1, g), true, '这一句用了与组不同的模型');
  assert.equal(DUB.mismatchCount(regen, g), 1);
  assert.equal(DUB.demoSynth('x', 7, 'm'), DUB.demoSynth('x', 7, 'm'), '同种子同模型时长确定');

  const again = DUB.regenerate(regen, ['c1'], {fit: 'compress', group: g});
  const r2 = again.find((b) => b.id === 'c1');
  assert.equal(r2.takes.length, 3);
  assert.equal(r2.take, 3);
  assert.equal(DUB.activeTake(r2, g).model, DUB.groupModel(g), '不给参数就沿用组的模型');
  assert.equal(DUB.modelMismatch(r2, g), false);

  const back = DUB.restoreTake(again, 'c1', 1, {fit: 'compress', group: g});
  const b1 = back.find((b) => b.id === 'c1');
  assert.equal(b1.take, 1);
  assert.equal(b1.takes.length, 3, '换回不新增版');
  assert.equal(b1.synth, t1[0].synth);
  assert.equal(b1.manual, false);
  assert.equal(DUB.archivedTakes(b1, g).map((t) => t.k).join(','), '2,3');
  assert.equal(DUB.restoreTake(again, 'c1', 9, {group: g}).find((b) => b.id === 'c1').take, 3, '不存在的版原样返回');

  const kept = DUB.keepLatest(back, 2, g).find((b) => b.id === 'c1');
  assert.equal(kept.takes.map((t) => t.k).join(','), '1,3', '当前版永远保留，其余从新到旧留');
  assert.equal(DUB.clearArchive(back, g).find((b) => b.id === 'c1').takes.length, 1);
});

test('语速对照：与组同模型的句取中位数当基准，模型不同「不比整条基准」，超 ±10% 标离群', () => {
  const g = {lang: 'en', langName: 'English', engine: 'qwen3', priority: 'voice', fit: 'compress'};
  const blocks = TTS.dubBlocks(cues, {speakerOrder: ['s1', 's2', 's3'], fit: 'compress'});
  const ref = DUB.paceReference(blocks, g);
  assert.equal(ref.model, DUB.groupModel(g));
  assert.equal(ref.from, 4);
  assert.ok(ref.perMin > 0);
  const t = DUB.activeTake(blocks[0], g);
  assert.equal(DUB.perMinOf('Hi everyone today', 3, 'en'), 60);
  assert.equal(DUB.perMinOf('大家好', 1.5, 'zh'), 120);
  const same = DUB.paceText({...t, perMin: ref.perMin}, ref, 'en');
  assert.match(same.text, /词\/分 · 与整条基准相当$/);
  assert.equal(same.outlier, false);
  const fast = DUB.paceText({...t, perMin: +(ref.perMin * 1.2).toFixed(1)}, ref, 'en');
  assert.match(fast.text, /比整条基准快 20%/);
  assert.equal(fast.outlier, true);
  const slow = DUB.paceText({...t, perMin: +(ref.perMin * 0.95).toFixed(1)}, ref, 'en');
  assert.match(slow.text, /比整条基准慢 5%/);
  assert.equal(slow.outlier, false);
  const other = DUB.paceText({...t, model: 'index-tts2.5'}, ref, 'zh');
  assert.match(other.text, /字\/分 · 不比整条基准$/);
  assert.equal(other.ratio, null);
  assert.equal(DUB.paceText(null, ref, 'en').text, '没量到语速');
  assert.equal(DUB.deviationShort({...t, perMin: +(ref.perMin * 1.2).toFixed(1)}, ref), '快 20%');
  assert.equal(DUB.deviationShort({...t, model: 'x'}, ref), '');
  assert.equal(DUB.paceReference([], g), null);
  assert.match(DUB.versionLine({k: 2, seed: 1042, engine: 'indextts25', model: 'index-tts2.5', synth: 2.4, perMin: 100}, {ref}), /^第 2 版 · 种子 1042 · IndexTTS 2\.5 · 2\.4 s$/);
});

test('归档组：按语言分段、每行一版从新到旧，空归档不出组；副题带版数 / 语言数 / 体积', () => {
  const g = {lang: 'en', langName: 'English', engine: 'qwen3', priority: 'voice', fit: 'compress'};
  const blocks = TTS.dubBlocks(cues, {speakerOrder: ['s1', 's2', 's3'], fit: 'compress'});
  assert.deepEqual(DUB.archiveShape([{...g, blocks}]).groups, []);
  assert.equal(DUB.archiveShape([{...g, blocks}]).line, '');
  let bl = DUB.regenerate(blocks, ['c1', 'c3'], {group: g});
  bl = DUB.regenerate(bl, ['c1'], {group: g, take: {seed: 7}});
  const ja = {...g, lang: 'ja', langName: '日本語', blocks: DUB.regenerate(blocks, ['c2'], {group: {...g, lang: 'ja'}})};
  const shape = DUB.archiveShape([{...g, blocks: bl}, ja]);
  assert.equal(shape.groups.length, 2);
  assert.equal(shape.total, 4);
  assert.equal(shape.langs, 2);
  assert.equal(shape.groups[0].langName, 'English');
  assert.deepEqual(shape.groups[0].rows.map((r) => `${r.file}`), ['s-1.t2.wav', 's-1.t1.wav', 's-3.t1.wav']);
  assert.equal(shape.groups[0].rows[0].k, 2);
  assert.match(shape.groups[0].rows[0].line, /^第 2 版 · 种子 \d+ · Qwen3-TTS · [\d.]+ s/);
  assert.equal(shape.groups[1].rows[0].file, 's-2.t1.wav');
  assert.match(shape.line, /^4 个旧版本 · 2 种语言 · [\d.]+ (KB|MB)$/);
  assert.equal(DUB.archivedCount(bl, g), 3);
  assert.equal(DUB.sizeLabel(2 * 1024 * 1024), '2.0 MB');
  assert.equal(DUB.sizeLabel(500), '1 KB');
});

test('旁白组（2026-09-23 补充）：生成语音按句落成一条轨，组键 vo<n>（与 App 同形，无冒号）、语言另记；重排顺延，不进音源切换', () => {
  const f = {text: '第一句话。第二句稍微长一点点。第三句。', engine: 'qwen3', mode: 'preset', lang: 'auto'};
  const g = DUB.narrationGroup(f, 7, {at: 12});
  assert.equal(g.role, 'narration');
  assert.equal(g.lang, 'vo7');
  assert.equal(g.langCode, 'zh');
  assert.equal(g.trackId, 'dub:vo7');
  assert.equal(DUB.dubFiles(g)[0].id, 'dub-vo7-n7-1', '组键进音源 id，不带冒号');
  assert.equal(g.blocks.length, 3);
  assert.equal(g.blocks[0].start, 12);
  assert.equal(g.blocks[0].end, g.blocks[0].slotEnd);
  assert.ok(g.blocks[1].start >= g.blocks[0].end + DUB.NARRATION_GAP - 1e-9);
  assert.equal(DUB.groupTitle(g), '旁白 · 第一句话。');
  assert.equal(DUB.groupBadge(g, () => null), 'VO');
  assert.equal(DUB.groupBadge({lang: 'en'}, (l) => l.toUpperCase()), 'EN');
  assert.equal(DUB.isNarration(g), true);
  assert.equal(DUB.takesOf(g.blocks[0], g)[0].model, g.model);
  assert.equal(DUB.takesOf(g.blocks[0], g)[0].perMin, DUB.perMinOf(g.blocks[0].text, g.blocks[0].synth, 'zh'), '语速按 langCode 数字');
  const re = DUB.regenerate(g.blocks, [g.blocks[1].id], {fit: g.fit, group: g, take: {seed: 1}});
  const flowed = DUB.reflowNarration(re);
  assert.equal(flowed[0].start, 12);
  assert.equal(flowed[1].end, +(flowed[1].start + flowed[1].synth).toFixed(2), '旁白句不压不截');
  assert.equal(flowed[2].start, +(flowed[1].end + DUB.NARRATION_GAP).toFixed(2));
  assert.equal(TTS.activeDubLang([g, {lang: 'en'}], {}), 'en');
  assert.equal(TTS.activeDubLang([g], {}), null);
  // 「自动」语言：汉字个数对英文词数（同 App），英文单词的音节不算进汉字
  const auto = (text) => DUB.narrationGroup({text, engine: 'qwen3', mode: 'preset', lang: 'auto'}, 1, {}).langCode;
  assert.equal(auto('Transformers changed everything about language models.'), 'en');
  assert.equal(auto('Transformer 换了一个思路。'), 'zh');
});

test('一角色一轨的旁白组（2026-09-24）：组名 vo/<who>，组卡与句属性页多一行「角色」（角色名 · 风格）', () => {
  const f = {text: '海浪一层层压过来。', engine: 'indextts2', mode: 'preset', lang: 'zh'};
  const sea = DUB.narrationGroup(f, 1, {who: 'sea', style: '低沉、缓慢', title: '忽略'});
  assert.equal(sea.langName, 'vo/sea', '有角色时不取 title');
  assert.equal(DUB.groupTitle(sea), '旁白 · vo/sea');
  assert.equal(DUB.roleText(sea), 'sea · 低沉、缓慢');
  const bird = DUB.narrationGroup(f, 2, {who: 'bird'});
  assert.equal(DUB.roleText(bird), 'bird', '清单没写风格只有角色名');
  const plain = DUB.narrationGroup(f, 3, {title: '开场'});
  assert.equal(DUB.groupTitle(plain), '旁白 · 开场');
  assert.equal(DUB.roleText(plain), null);
  const shape = DUB.audioGroups([], [sea, bird, plain], {});
  assert.deepEqual(shape.groups.map((g) => g.roleLine), ['sea · 低沉、缓慢', 'bird', null]);
});

test('VoxCPM2 / OmniVoice 进配音：能力卡、母语来源、引擎专属设置', () => {
  const vox = DUB.capabilities('voxcpm2');
  assert.equal(vox.style, true, 'VoxCPM2 的风格走可控克隆');
  assert.equal(vox.refText, true);
  assert.equal(vox.presets.length, 0);
  assert.equal(vox.duration, 0);
  assert.equal(DUB.capabilityLine('voxcpm2'), '会念 31 种语言 · 没有预设音色 · 可克隆 · 一句话指定风格');
  assert.deepEqual(DUB.extraSettings('voxcpm2').map((x) => x.key), ['style', 'refText']);
  assert.match(DUB.extraSettings('voxcpm2')[0].hint, /可控克隆/);
  const omni = DUB.capabilities('omnivoice');
  assert.equal(omni.style, false);
  assert.equal(omni.vocab, true);
  assert.equal(omni.duration, 60);
  assert.equal(omni.nonCommercial, true);
  assert.match(DUB.capabilityLine('omnivoice'), /能按目标时长合成 · 仅限非商用$/);
  assert.deepEqual(DUB.extraSettings('omnivoice').map((x) => x.key), ['refText']);
  // 发音标准优先：有内置母语参考就用参考，否则要上传；配音不走 OmniVoice 的描述造声
  assert.equal(DUB.accentSource('omnivoice', 'zh').kind, 'ref');
  assert.equal(DUB.accentSource('omnivoice', 'de').kind, 'upload');
  assert.equal(DUB.accentSource('voxcpm2', 'fr').kind, 'upload');
  assert.equal(DUB.modelNeeded({priority: 'voice', engine: 'omnivoice', lang: 'en'}), 'omnivoice');
  assert.equal(DUB.modelNeeded({priority: 'voice', engine: 'voxcpm2', lang: 'en'}), 'voxcpm2');
});
