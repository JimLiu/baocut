const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-substyle.js');
require('./model-pose.js');
require('./model-shape-paths.js');
require('./model-elements.js');
require('./model-textpresets.js');
require('./model-wordanim.js');
require('./model-subanim.js');
require('./model-subpresets.js');
require('./model-motioncaption.js');
require('./model-template.js');
require('./model-cut.js');
require('./model-defaultsub.js');
require('./data.js');  // data.js 顶层用到上面这些纯模型
require('./model-local-models.js');
const L = global.window.BC_LOCALMODELS;
const D = global.window.BC_DATA;
const M = D.setModels;
const C = D.setComponents;
const byId = (id) => M.find((m) => m.id === id);

test('默认候选按类别隔离，排除半装、能力包和平台不支持的模型', () => {
  const ms = [
    {id: 'a', cat: 'asr'}, {id: 't', cat: 'tts', uses: ['codec']},
    {id: 's', cat: 'sep'}, {id: 'i', cat: 'image', supported: false},
    {id: 'p', cat: 'asr', pack: true}, {id: 'v', cat: 'vision'},
  ];
  const on = {a: true, t: true, s: true, i: true, p: true, v: true};
  const comps = [{id: 'codec'}];
  assert.deepEqual(L.defaultChoices(ms, comps, on, 'asr').map(m => m.id), ['a']);
  assert.deepEqual(L.defaultChoices(ms, comps, on, 'tts'), []);
  assert.deepEqual(L.defaultChoices(ms, comps, {...on, codec: true}, 'tts').map(m => m.id), ['t']);
  assert.deepEqual(L.defaultChoices(ms, comps, on, 'sep').map(m => m.id), ['s']);
  assert.deepEqual(L.defaultChoices(ms, comps, on, 'image'), []);
  assert.deepEqual(L.defaultChoices(ms, comps, on, 'vision'), []);
});

test('公共组件按同一分类里声明它的模型数算：两只以上放顶部，只有一只用的跟着那只模型', () => {
  const asr = L.layout(M, C, 'asr');
  assert.deepEqual(asr.shared.map((c) => c.id), ['vad', 'aligner', 'whisper-tokenizer', 'wespeaker']);
  asr.rows.forEach((r) => assert.deepEqual(r.own, [], r.m.id));
  const tts = L.layout(M, C, 'tts');
  assert.deepEqual(tts.shared.map((c) => c.id), ['tts-codec']);
  assert.deepEqual(tts.rows.find((r) => r.m.id === 'qwen3-tts-1.7b-base').common, ['tts-codec']);
  assert.deepEqual(tts.rows.find((r) => r.m.id === 'index-tts2.5').own.map((c) => c.id), ['indextts-aux']);
  assert.deepEqual(tts.rows.find((r) => r.m.id === 'indextts2').own, []);
  assert.deepEqual(L.layout(M, C, 'sep').shared, []);
});

test('每个声明的组件都在目录里，分类不串：TTS 不会被问 aligner / VAD', () => {
  const ids = C.map((c) => c.id);
  M.forEach((m) => (m.uses || []).forEach((u) => assert.ok(ids.includes(u), `${m.id} → ${u}`)));
  M.filter((m) => m.cat === 'tts').forEach((m) => {
    assert.ok(!m.uses.includes('vad') && !m.uses.includes('aligner'), m.id);
  });
  assert.deepEqual(byId('moss-transcribe').uses, ['wespeaker']);
});

test('半装：权重在、组件缺；主按钮只下缺的那部分', () => {
  const on = L.initial(M, C);
  const w = byId('whisper-large-v3');
  assert.equal(L.half(w, C, on), true);
  assert.deepEqual(L.missing(w, C, on).map((x) => x.id), ['whisper-tokenizer']);
  assert.equal(L.needSize(w, C, on), 3.2);
  assert.equal(L.ready(byId('qwen3-asr-0.6b'), C, on), true);
  const t = byId('whisper-turbo');
  assert.equal(L.half(t, C, on), false);
  assert.deepEqual(L.missing(t, C, on).map((x) => x.id), ['whisper-turbo', 'whisper-tokenizer']);
  assert.equal(L.needSize(t, C, on), 1536 + 3.2);
  const after = L.applyInstall(on, t);
  assert.equal(L.ready(w, C, after), true, '补上分词器后另一只 Whisper 也跟着就绪');
});

test('盘上合计：共享组件只算一次，按分类可拆', () => {
  const on = L.initial(M, C);
  const asr = 1748 + 680 + 947 + 1.2 + 938 + 26.5;
  assert.equal(+L.disk(M, C, on, 'asr').toFixed(1), asr);
  assert.equal(L.disk(M, C, on, 'tts'), 1732 + 1249 + 662);   // CustomVoice + Base（2026-09-24 演示装上，试听克隆可试）+ 共用编解码器
  assert.equal(L.disk(M, C, on, 'sep'), 0);
  assert.equal(L.disk(M, C, on, 'vision'), 6.4);   // 人物定位随应用附带（§15.9）
  assert.equal(+L.disk(M, C, on).toFixed(1), +(asr + 1732 + 1249 + 662 + 6.4).toFixed(1));
});

test('删除：共享组件还有别人在用就保留，最后一个使用者走时一起回收', () => {
  let on = L.initial(M, C);
  const q = byId('qwen3-asr-0.6b');
  const w = byId('whisper-large-v3');
  const r1 = L.removal(q, M, C, on);
  assert.equal(r1.frees, 680);
  assert.deepEqual(r1.kept.map((k) => k.c.id), ['vad', 'aligner']);
  assert.match(L.removalBody(q, M, C, on), /还有 Whisper large-v3 在用，保留/);
  on = L.applyRemove(on, q, M, C);
  assert.equal(on.vad, true);
  const r2 = L.removal(w, M, C, on);
  assert.deepEqual(r2.orphaned.map((c) => c.id), ['vad', 'aligner']);
  assert.equal(+r2.frees.toFixed(1), 947 + 1.2 + 938);
  on = L.applyRemove(on, w, M, C);
  assert.equal(on.vad, false);
  assert.equal(on.aligner, false);
  assert.equal(on.wespeaker, true, 'MOSS 还在，声纹嵌入不动');
  const tts = byId('qwen3-tts-0.6b-customvoice');
  assert.match(L.removalBody(tts, M, C, on), /Qwen3-TTS 语音编解码器 还有 Qwen3-TTS 0.6B Base 在用，保留/);
  on = L.applyRemove(on, byId('qwen3-tts-0.6b-base'), M, C);
  assert.equal(on['tts-codec'], true, 'CustomVoice 还在，编解码器不动');
  assert.match(L.removalBody(tts, M, C, on), /Qwen3-TTS 语音编解码器——没有别的已装模型还需要/);
});

test('组件副题与体积写法', () => {
  const on = L.initial(M, C);
  const vad = C.find((c) => c.id === 'vad');
  assert.equal(L.compUsage(vad, M, on), '2 个已装模型在用 · 共 4 个需要');
  const aux = C.find((c) => c.id === 'indextts-aux');
  assert.equal(L.compUsage(aux, M, on), '1 个模型会用到 · 暂无已装');
  assert.equal(L.mb(1.2), '1.2 MB');
  assert.equal(L.mb(1748), '1.7 GB');
  assert.equal(L.mb(662), '662 MB');
});

test('语音合成：引擎表里的每只模型都有设置行；只有 OmniVoice 标不能商用（2026-09-26）', () => {
  require('./model-tts.js');
  const TTS = global.window.BC_TTS;
  Object.keys(TTS.MODELS).forEach((id) => {
    const row = byId(id);
    assert.ok(row, id);
    if (id !== 'htdemucs-ft') assert.equal(row.cat, 'tts', id);   // 分离模型也挂在 MODELS 里（配音用）
  });
  assert.equal(byId('qwen3-tts-1.7b-voicedesign').size, 2287);
  assert.deepEqual(byId('qwen3-tts-1.7b-voicedesign').uses, ['tts-codec']);
  assert.equal(byId('voxcpm2').size, 2870);
  assert.equal(byId('omnivoice').size, 1049);
  const nc = M.filter((m) => m.license && m.license.commercialUse === false).map((m) => m.id);
  assert.deepEqual(nc, ['omnivoice', 'qwen-image-2.1']);
  assert.equal(byId('omnivoice').license.name, 'CC-BY-NC-4.0');
  // 新行各自一个仓库：公共组件照旧只有 12Hz 编解码器
  const tts = L.layout(M, C, 'tts');
  assert.deepEqual(tts.shared.map((c) => c.id), ['tts-codec']);
  assert.deepEqual(tts.rows.find((r) => r.m.id === 'omnivoice').own, []);
});


test('catalog keeps incomplete installations visible and only flags dependencies used by installed models', () => {
  const models = [{id: 'a', uses: ['c']}, {id: 'b', uses: ['c', 'd']}, {id: 'e', uses: ['d']}, {id: 't', cat: 'tts'}];
  const comps = [{id: 'c'}, {id: 'd'}];
  const view = L.catalog(models, comps, {a: true}, 'asr');
  assert.deepEqual(view.groups.map(g => g.rows.map(r => r.m.id)), [['a'], ['b', 'e']]);
  assert.deepEqual(view.repair.map(c => c.id), ['c']);
  assert.deepEqual(L.catalog(models, comps, {a: true, c: true}, 'asr').repair, []);
  assert.deepEqual(L.catalog(models, comps, {}, 'asr').repair, []);
});

test('默认模型菜单：语音识别与音源分离有「自动选择」，其余类没设时是「未设置」', () => {
  ['tts', 'image', 'vision'].forEach((c) => assert.equal(L.hasAuto(c), false, c));
  ['asr', 'sep'].forEach((c) => assert.equal(L.hasAuto(c), true, c));
  assert.equal(L.defaultView('sep', null, '', [{id: 's', name: 'S'}]).label, '自动选择');
  const asr = L.defaultView('asr', null, '', [{id: 'a', name: 'A'}]);
  assert.deepEqual([asr.auto, asr.label, asr.checked], [true, '自动选择', null]);
  const none = L.defaultView('tts', null, '', [{id: 't', name: 'T'}]);
  assert.deepEqual([none.auto, none.label, none.checked, none.cloud], [false, '未设置', null, false]);
  const local = L.defaultView('tts', 't', '', [{id: 't', name: 'T'}]);
  assert.deepEqual([local.label, local.checked], ['T', 't']);
  assert.equal(L.defaultView('tts', 'gone', '', [{id: 't', name: 'T'}]).label, '未设置', '默认的模型已删：按未设置算');
  const cloud = L.defaultView('tts', 't', 'OpenAI · gpt-4o-mini-tts', [{id: 't', name: 'T'}]);
  assert.deepEqual([cloud.label, cloud.checked, cloud.cloud], ['OpenAI · gpt-4o-mini-tts', null, true], '云端默认如实显示，不勾本地项');
  assert.equal(L.defaultView('sep', null, 'x', []).cloud, false, '分离没有云端默认');
});

test('详情的许可行：权重的许可，加上要署名或许可不同的组件', () => {
  const lines = (id) => L.licenseLines(byId(id), C).map((x) => `${x.part}:${x.lic.name}`);
  // MOSS：权重 Apache-2.0；声纹嵌入 CC-BY-4.0 要署名（它在公共组件里，也要列）
  assert.deepEqual(lines('moss-transcribe'), ['模型权重:Apache-2.0', '声纹嵌入:CC-BY-4.0']);
  assert.match(L.licenseLines(byId('moss-transcribe'), C)[1].lic.summary, /署名：.*WeSpeaker.*pyannote\.audio/);
  // 说话人区分包：整包登记 MIT（Pyannote 分段），声纹嵌入 CC-BY-4.0 要署名，另列
  assert.deepEqual(lines('speaker-diarization'), ['模型权重:MIT', '声纹嵌入:CC-BY-4.0']);
  assert.equal(L.licenseLines(byId('speaker-diarization'), C)[1].comp, true);
  // Qwen-Image-2.1：不可商用，只有权重那条
  assert.deepEqual(lines('qwen-image-2.1'), ['模型权重:Qwen RESEARCH LICENSE AGREEMENT']);
  // 对齐器与权重同为 Apache-2.0 不重复列；Whisper large-v3 turbo 是 MIT，对齐器另列
  assert.deepEqual(lines('qwen3-asr-0.6b'), ['模型权重:Apache-2.0']);
  assert.deepEqual(lines('whisper-large-v3'), ['模型权重:Apache-2.0']);
  assert.deepEqual(lines('whisper-turbo'), ['模型权重:MIT', 'Forced aligner:Apache-2.0']);
  assert.deepEqual(lines('omnivoice'), ['模型权重:CC-BY-NC-4.0']);
  // 登记里没有许可的：不画这一行
  assert.deepEqual(lines('vision-person'), []);
  M.filter((m) => m.license).forEach((m) => assert.ok(m.license.name && m.license.url && m.license.summary, m.id));
});
