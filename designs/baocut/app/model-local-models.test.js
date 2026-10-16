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
  // 语音合成每只都是一个 GGUF（audio.cpp 引擎随应用内置）：没有公共组件，也没有自带组件
  const tts = L.layout(M, C, 'tts');
  assert.deepEqual(tts.shared, []);
  tts.rows.forEach((r) => assert.deepEqual([r.own, r.common], [[], []], r.m.id));
  assert.deepEqual(L.layout(M, C, 'sep').shared, []);
  // 只有一只用的组件跟着那只模型的行走（演示数据里已经没有这种组件，用一组假数据守住规则）
  const lay = L.layout([{id: 'a', cat: 'tts', uses: ['x']}, {id: 'b', cat: 'tts', uses: ['x', 'y']}], [{id: 'x'}, {id: 'y'}], 'tts');
  assert.deepEqual(lay.shared.map((c) => c.id), ['x']);
  assert.deepEqual(lay.rows.find((r) => r.m.id === 'b').own.map((c) => c.id), ['y']);
  assert.deepEqual(lay.rows.find((r) => r.m.id === 'b').common, ['x']);
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

test('下载结局（store 的 modelEnd）：下完等于装上；没下完只记下好的；设置页重开时按它与 store 的装没装重建', () => {
  const on = L.initial(M, C);
  const w = byId('whisper-large-v3');
  const t = byId('whisper-turbo');
  assert.equal(L.applyEnd(on, w, null), on, '没有结局时不动');
  assert.equal(L.ready(w, C, L.applyEnd(on, w, {ok: true})), true, '补齐下完：缺的组件也装上');
  // 没下完：组件下好了、权重没下成 → 权重仍缺，下载按钮只算权重
  const part = L.applyEnd(on, t, {ok: false, done: ['whisper-tokenizer'], line: 'x'});
  assert.equal(part['whisper-turbo'], false);
  assert.equal(part['whisper-tokenizer'], true);
  assert.equal(L.needSize(t, C, part), t.size);
  // 重开设置页：补齐下完的半装模型不再缺；在别处删掉的模型以 store 为准
  const live = {'whisper-large-v3': true, 'whisper-turbo': false, 'moss-transcribe': false};
  const isLive = (id) => (id in live ? live[id] : !!on[id]);
  const back = L.withStore(on, M, isLive, {'whisper-large-v3': {ok: true}});
  assert.equal(L.ready(w, C, back), true);
  assert.equal(back['moss-transcribe'], false);
  const failed = L.withStore(on, M, isLive, {'whisper-turbo': {ok: false, done: ['whisper-tokenizer'], line: 'x'}});
  assert.equal(failed['whisper-turbo'], false, '权重没下成：store 也没记上');
  assert.equal(L.ready(w, C, failed), true, '下好的分词器留着，同一只组件的另一只 Whisper 跟着就绪');
});

test('盘上合计：共享组件只算一次，按分类可拆', () => {
  const on = L.initial(M, C);
  const asr = 1748 + 680 + 947 + 1.2 + 938 + 26.5;
  assert.equal(+L.disk(M, C, on, 'asr').toFixed(1), asr);
  assert.equal(L.disk(M, C, on, 'tts'), 1899 + 2687);   // 0.6B Base（2026-09-24 演示装上，试听克隆可试）+ 1.7B CustomVoice，各自一个 GGUF
  assert.equal(L.disk(M, C, on, 'sep'), 0);
  assert.equal(L.disk(M, C, on, 'vision'), 6.4);   // 人物定位随应用附带（§15.9）
  assert.equal(+L.disk(M, C, on).toFixed(1), +(asr + 1899 + 2687 + 6.4).toFixed(1));
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
  assert.match(L.removalBody(w, M, C, on), /VAD 语音活动检测、Forced aligner——没有别的已装模型还需要/);
  on = L.applyRemove(on, w, M, C);
  assert.equal(on.vad, false);
  assert.equal(on.aligner, false);
  assert.equal(on.wespeaker, true, 'MOSS 还在，声纹嵌入不动');
  // 语音合成没有共享组件：删一只只腾出它自己的 GGUF
  assert.equal(L.removalBody(byId('qwen3-tts-0.6b-base'), M, C, on), '腾出 1.9 GB。');
});

test('组件副题与体积写法', () => {
  const on = L.initial(M, C);
  const vad = C.find((c) => c.id === 'vad');
  assert.equal(L.compUsage(vad, M, on), '2 个已装模型在用 · 共 4 个需要');
  const tok = C.find((c) => c.id === 'whisper-tokenizer');
  assert.equal(L.compUsage(tok, M, on), '1 个已装模型在用 · 共 2 个需要');
  assert.equal(L.compUsage(tok, M, {}), '2 个模型会用到 · 暂无已装');
  assert.equal(L.mb(1.2), '1.2 MB');
  assert.equal(L.mb(1748), '1.7 GB');
  assert.equal(L.mb(662), '662 MB');
});

test('公共组件那一行：装好写体积，缺的借一只装着的模型补齐，没人装着就等装模型时一起下', () => {
  const asr = M.filter((m) => L.catOf(m) === 'asr');
  const tok = C.find((c) => c.id === 'whisper-tokenizer');
  let on = L.initial(M, C);
  assert.deepEqual(L.compAction(C.find((c) => c.id === 'vad'), asr, C, on), {kind: 'installed'});
  // 演示数据：Whisper large-v3 装着、分词器缺 → 借它补齐，只下它缺的
  const get = L.compAction(tok, asr, C, on);
  assert.equal(get.kind, 'get');
  assert.equal(get.target.id, 'whisper-large-v3');
  assert.equal(get.size, tok.size);
  // 删掉 Whisper large-v3：没有装着的模型用分词器，不给按钮
  on = L.applyRemove(on, byId('whisper-large-v3'), M, C);
  assert.deepEqual(L.compAction(tok, asr, C, on), {kind: 'later'});
  // 补齐之后组件装好，其他用它的模型一起用上
  on = L.applyInstall(L.initial(M, C), get.target);
  assert.equal(L.compAction(tok, asr, C, on).kind, 'installed');
});

test('公共组件借谁补齐：缺得最少的那只，一样多按目录顺序；不认这台电脑的不借', () => {
  const comps = [{id: 'c', size: 10}, {id: 'd', size: 50}];
  const models = [{id: 'a', uses: ['c', 'd']}, {id: 'b', uses: ['c']}, {id: 'e', uses: ['c']}, {id: 'x', uses: ['c'], supported: false}];
  const on = {a: true, b: true, e: true, x: true};
  const act = L.compAction(comps[0], models, comps, on);
  assert.equal(act.target.id, 'b', 'a 还缺 d，b 只缺 c；b 与 e 一样多取靠前的');
  assert.equal(act.size, 10);
  assert.equal(L.compAction(comps[0], models, comps, {a: true}).target.id, 'a');
  assert.equal(L.compAction(comps[0], models, comps, {a: true}).size, 60, '补齐 a 连 d 一起下');
  assert.deepEqual(L.compAction(comps[0], models, comps, {x: true}), {kind: 'later'});
});

test('语音合成：引擎表里的每只模型都有设置行；OmniVoice 与 Fish S2 Pro 标不能商用（2026-09-26）', () => {
  require('./model-tts.js');
  const TTS = global.window.BC_TTS;
  Object.keys(TTS.MODELS).forEach((id) => {
    const row = byId(id);
    assert.ok(row, id);
    if (id !== 'htdemucs-ft') assert.equal(row.cat, 'tts', id);   // 分离模型也挂在 MODELS 里（配音用）
  });
  // 体积按 audio.cpp Q8 GGUF 的字节数折成 MiB（packages/models repo-manifests.ts 的 estimatedBytes）
  assert.equal(byId('qwen3-tts-1.7b-voicedesign').size, 2686);
  assert.deepEqual(byId('qwen3-tts-1.7b-voicedesign').uses, []);
  assert.equal(byId('voxcpm2').size, 2818);
  assert.equal(byId('omnivoice').size, 1288);
  assert.equal(byId('fish-s2-pro').size, 6025);
  M.filter((m) => m.cat === 'tts').forEach((m) => assert.equal(m.repo, 'audio-cpp/audio.cpp-gguf', m.id));
  ['qwen3-tts-0.6b-customvoice', 'gpt-sovits-v2'].forEach((id) => assert.equal(byId(id), undefined, `${id} 已删`));
  const nc = M.filter((m) => m.license && m.license.commercialUse === false).map((m) => m.id);
  assert.deepEqual(nc, ['omnivoice', 'fish-s2-pro', 'qwen-image-2.1-turbo', 'qwen-image-2.1', 'yue2-3b']);
  assert.equal(byId('omnivoice').license.name, 'CC-BY-NC-4.0');
  // 每只一个 GGUF：没有公共组件
  const tts = L.layout(M, C, 'tts');
  assert.deepEqual(tts.shared, []);
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
  ['tts', 'image', 'music', 'vision'].forEach((c) => assert.equal(L.hasAuto(c), false, c));
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
  assert.deepEqual(lines('qwen-image-2.1-turbo'), ['模型权重:Qwen RESEARCH LICENSE AGREEMENT']);
  // 对齐器与权重同为 Apache-2.0 不重复列；Whisper large-v3 turbo 是 MIT，对齐器另列
  assert.deepEqual(lines('qwen3-asr-0.6b'), ['模型权重:Apache-2.0']);
  assert.deepEqual(lines('whisper-large-v3'), ['模型权重:Apache-2.0']);
  assert.deepEqual(lines('whisper-turbo'), ['模型权重:MIT', 'Forced aligner:Apache-2.0']);
  assert.deepEqual(lines('omnivoice'), ['模型权重:CC-BY-NC-4.0']);
  // 登记里没有许可的：不画这一行
  assert.deepEqual(lines('vision-person'), []);
  M.filter((m) => m.license).forEach((m) => assert.ok(m.license.name && m.license.url && m.license.summary, m.id));
});

test('下载来源的基础规则：基址认回 Hugging Face / ModelScope / 镜像，镜像地址的校验', () => {
  assert.equal(L.sourceOf(null), 'hf');
  assert.equal(L.sourceOf(''), 'hf');
  assert.equal(L.sourceOf('https://huggingface.co/'), 'hf');
  assert.equal(L.sourceOf('https://www.modelscope.cn'), 'ms');
  assert.equal(L.sourceOf('https://modelscope.cn/'), 'ms', '按主机认，不要求写成 www');
  assert.equal(L.sourceOf('https://hf-mirror.com'), 'custom');
  assert.equal(L.sourceOf('https://modelscope.cn.example.com'), 'custom', '只认 modelscope.cn 本身');
  assert.equal(L.sourceOf(L.MS_ENDPOINT), 'ms');

  assert.equal(L.endpointError(''), null);
  assert.equal(L.endpointError('https://hf-mirror.com'), null);
  assert.equal(L.endpointError('http://10.0.0.2:8080/hf'), null, '局域网镜像可以是 http，可以带路径前缀');
  assert.match(L.endpointError('hf-mirror.com'), /有效/);
  assert.match(L.endpointError('ftp://mirror.example'), /http/);
  assert.match(L.endpointError('https://user:pw@mirror.example'), /账号/);
  assert.match(L.endpointError('https://mirror.example/?token=1'), /查询参数/);
});

test('音乐生成：audio.cpp 引擎随应用内置，不是 YuE2 的组件；只下载模型，权重在就不是半装', () => {
  const y = byId('yue2-3b');
  assert.deepEqual(y.uses, []);
  assert.equal(C.find((c) => c.id === 'audiocpp-engine'), undefined, '引擎不在组件目录里');
  assert.ok(C.every((c) => !c.release), '组件都来自模型仓库，没有要从 GitHub 发布页下载的');
  const lay = L.layout(M, C, 'music');
  assert.deepEqual(lay.shared, []);
  assert.deepEqual(lay.rows[0].own, []);
  const none = {};
  assert.equal(L.needSize(y, C, none), y.size, '下载按钮的体积只有模型');
  assert.deepEqual(L.applyInstall(none, y), {'yue2-3b': true});
  assert.equal(L.half(y, C, {'yue2-3b': true}), false);
  assert.deepEqual(L.licenseLines(y, C).map((x) => `${x.part}:${x.lic.name}`), ['模型权重:CC-BY-NC-4.0']);
});
