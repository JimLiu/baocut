const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-tts.js');
require('./model-voices.js');
const TTS = global.window.BC_TTS;
const V = global.window.BC_VOICES;

const S = (id, start, end, sp, text) => ({id, start, end, sp, text});
const CUES = [
  S('g1', 0, 5.4, 's1', '欢迎回到《码与远方》，我是林澈。'),
  S('g2', 5.4, 11.2, 's1', '这一期我们请到了两位做本地视频工具的朋友。'),
  S('g3', 11.2, 16.8, 's2', '嗯，就是，谢谢邀请，我是周远。'),
  S('g4', 16.8, 22.0, 's3', '大家好，我是苏黎，负责渲染这一块。'),
  S('g5', 22.0, 28.6, 's1', '先从一个很实际的问题开始：为什么要做本地？'),
  S('g6', 28.6, 35.0, 's2', '因为素材是别人的。上传这件事本身就是一个决定。'),
  S('g7', 35.0, 41.4, 's2', '我没准备好替客户做这个决定。'),
  S('g8', 41.4, 47.2, 's3', '而且模型已经跑得动了，这一年变化很大。'),
  S('g9', 47.2, 53.8, 's1', '那时候每一个小改动都要三次签字。'),
  S('g10', 53.8, 60.2, 's2', '对，所以我们把整条链路搬到了本机。'),
];

test('麦克风门槛：短于 5 秒不给存，够了回 null', () => {
  assert.equal(V.REC.min, 5);
  assert.match(V.takeProblem(3.2), /只录到 3\.2 秒/);
  assert.equal(V.takeProblem(5), null);
  assert.equal(V.takeProblem(11.9), null);
});

test('样本（2026-10-14，11-08 放长）：目标 30 秒、最长 3 分钟；5 秒以下不给存，10 秒以下只提醒云端嫌短；授权声明 3 秒起、英文是推荐值', () => {
  assert.deepEqual(V.SAMPLE, {min: 5, good: 10, target: 30, max: 180, countdown: 10});
  const providers = [{name: 'MiniMax', clone: {min: 10}}, {name: 'Google Gemini', clone: {min: 10, consent: true}}, {name: 'ElevenLabs', clone: {min: 1}}];
  assert.match(V.sampleVerdict(3.1, providers).problem, /只录到 3\.1 秒/);
  const mid = V.sampleVerdict(7.4, providers);
  assert.equal(mid.problem, null);
  assert.deepEqual(mid.short, ['MiniMax 要 10 秒以上', 'Google Gemini 要 10 秒以上']);
  assert.deepEqual(V.sampleVerdict(29.1, providers).short, []);
  assert.equal(V.sampleVerdict(30, providers).line, '够了');
  assert.match(V.consentProblem(1.2), /把整句念完/);
  assert.equal(V.consentProblem(7.9), null);
  // 授权声明：官方 30 个地区语言，旧码 en / zh 也认；常用两种给芯片，其余 28 种在「更多语言」；表外可自定义
  assert.equal(V.CONSENT_PHRASES.length, 30);
  assert.equal(V.consentPhrase('en').code, 'en-US');
  assert.equal(V.consentPhrase('en-US').recommended, true);
  assert.match(V.consentPhrase('en').text, /^I am the owner of this voice/);
  assert.equal(V.consentPhrase('zh').code, 'zh-CN');
  assert.equal(V.consentPhrase('zh-CN').verified, false, '中文实测常验不过');
  assert.equal(V.consentPhrase('xx').code, 'en-US', '没有的语言退到英文');
  assert.equal(V.consentPhrase('fr-CA').text, V.consentPhrase('fr-FR').text, '同一语言几个地区原文相同');
  assert.equal(V.phraseLabel(V.consentPhrase('fr-CA')), 'Français（加拿大）');
  assert.equal(V.phraseLabel(V.consentPhrase('ja-JP')), '日本語');
  assert.deepEqual(V.CONSENT_COMMON, ['en-US', 'zh-CN']);
  assert.equal(V.consentMore().length, 28);
  assert.ok(V.consentMore().every((o) => V.CONSENT_COMMON.indexOf(o.code) < 0));
  assert.deepEqual(V.consentPhrase('custom', ' 我同意 '), {code: 'custom', label: '自定义', text: '我同意', custom: true});
  assert.equal(V.consentPhrase('custom').text, '');
  // 台词：这门语言的三句示例连起来，第一句就是参考段原文
  const script = V.sampleScript('zh');
  assert.equal(script.lines.length, 3);
  assert.match(script.first, /^欢迎使用 BaoCut/);
  assert.deepEqual(V.referenceFromSample(29.1, script.first), {dur: 10, text: script.first, textSource: 'script'});
  assert.deepEqual(V.referenceFromSample(7.4, ''), {dur: 7.4, text: '', textSource: 'none'});
  // 先选模型：本机引擎总在，云端列能克隆的（没连密钥的也能选）；选中的里有要授权声明的才有那一步
  const CT = global.window.BC_CLOUD_TTS || require('./model-cloud-tts.js');
  const targets = V.cloneTargets(V.engineChips(), CT.providers(), ['elevenlabs']);
  assert.ok(targets.some((t) => t.kind === 'local' && t.id === 'indextts2'));
  assert.ok(!targets.some((t) => t.kind === 'cloud' && t.id === 'openai'), 'OpenAI 不能克隆');
  const g = targets.find((t) => t.id === 'google');
  assert.deepEqual([g.kind, g.consent, g.connected], ['cloud', true, false]);
  assert.equal(targets.find((t) => t.id === 'elevenlabs').connected, true);
  assert.deepEqual(V.cloneSteps([g]).map((s) => s.k), ['models', 'sample', 'consent', 'save']);
  assert.deepEqual(V.cloneSteps([g])[2].needed, ['Google Gemini']);
  assert.deepEqual(V.cloneSteps(targets.filter((t) => t.id !== 'google')).map((s) => s.k), ['models', 'sample', 'save'], '没选 Gemini 就没有授权那一步');
  assert.deepEqual(V.cloneSteps([]).map((s) => s.k), ['models', 'sample', 'save']);
});

test('音色档记什么认人：每只本机引擎一颗种子，云端各家一只 voice id；授权录音另存一段', () => {
  const me = V.DEMO.find((v) => v.id === 'v-me');
  assert.equal(me.seed, 48213);
  assert.deepEqual(me.seeds, {indextts2: 48213, voxcpm2: 90117});
  assert.equal(V.seedFor(me, 'voxcpm2'), 90117);
  assert.equal(V.seedFor(me, 'qwen3'), 48213, '没单独给种子的引擎用底种子');
  assert.equal(me.consentClip.lang, 'en-US');
  assert.equal(me.cloud.google.voiceId, 'voice_demo7q2mx');
  const b = V.bindings(me, [{id: 'google', name: 'Google Gemini'}]);
  assert.deepEqual(b.map((x) => x.kind + ':' + x.id), ['seed:indextts2', 'seed:voxcpm2', 'seed:*', 'voice:google']);
  assert.equal(V.idLine(me, [{id: 'google', name: 'Google Gemini'}]), '种子 48213（IndexTTS2 / 其余本机引擎） · 种子 90117（VoxCPM2） · Google Gemini voice_demo7q2mx · 授权声明 English（美国） 7.9 秒');
  const host = V.DEMO.find((v) => v.id === 'v-host');
  assert.equal(host.consentClip, null);
  assert.deepEqual(host.seeds, {});
  assert.equal(V.idLine(host, [{id: 'elevenlabs', name: 'ElevenLabs'}]), `种子 ${host.seed}（本机引擎） · ElevenLabs bc_ele_host`);
  // 模型页那一行：云端只列建过 voice id 的，本机列每只音色与它在这只引擎上的种子
  assert.deepEqual(V.voicesBoundTo(V.DEMO, {kind: 'cloud', id: 'google'}).map((x) => x.v.id + ' ' + x.value), ['v-me voice_demo7q2mx']);
  assert.deepEqual(V.voicesBoundTo(V.DEMO, {kind: 'cloud', id: 'minimax'}), []);
  assert.deepEqual(V.voicesBoundTo(V.DEMO, {kind: 'local', id: 'voxcpm2'}).map((x) => x.value), ['种子 90117', `种子 ${host.seed}`]);
  const fresh = V.makeVoice({name: 'x', consentClip: {dur: 6.94}});
  assert.ok(fresh.seed >= 1 && Number.isInteger(fresh.seed));
  assert.equal(fresh.consentClip.dur, 6.9);
  assert.equal(fresh.consentClip.lang, 'en-US');
  const custom = V.makeVoice({name: 'y', consentClip: {lang: 'custom', text: '我同意', dur: 5}});
  assert.equal(V.idLine(custom, []).split(' · ').pop(), '授权声明 自定义 5.0 秒');
  assert.deepEqual(JSON.parse(V.exportBundle(custom)).consentClip, {file: 'consent.wav', seconds: 5, language: 'custom', text: '我同意'});
  assert.match(V.metaLine(me), /^简体中文 · 样本 29\.1 秒 · 麦克风 · 2 天前$/);
  const up = V.makeVoice({lang: 'en', dur: 10, sourceDur: 29.1, source: {kind: 'upload', name: 'reference_speaker.wav'}});
  assert.equal(V.metaLine(up), 'English · 样本 29.1 秒 · 上传 · reference_speaker.wav · 刚刚');
  const j = JSON.parse(V.exportBundle(me));
  assert.equal(j.seed, 48213);
  assert.deepEqual(j.seeds, {indextts2: 48213, voxcpm2: 90117});
  assert.equal(JSON.parse(V.exportBundle(host)).seeds, null);
  assert.deepEqual(j.consentClip, {file: 'consent.wav', seconds: 7.9, language: 'en-US'});
  assert.equal(JSON.parse(V.exportBundle(host)).consentClip, null);
  assert.equal(j.cloud, undefined, 'voice id 不进导出包');
});

test('音色档：makeVoice 补默认值，元数据一行按来源分两种写法', () => {
  const mic = V.makeVoice({name: ' 我 ', lang: 'zh', dur: 7.83, text: 'x', source: {kind: 'mic'}});
  assert.equal(mic.name, '我');
  assert.equal(mic.dur, 7.8);
  assert.equal(mic.textSource, 'script');
  assert.equal(mic.qwen3, 'icl');
  assert.ok(mic.file, '试听要有随包录音可放');
  assert.match(V.metaLine(mic), /^简体中文 · 7\.8 秒 · 麦克风 · 刚刚$/);
  const media = V.DEMO.find((v) => v.id === 'v-host');
  assert.equal(media.textSource, 'transcript');
  assert.equal(V.sourceLine(media), '第 12 期访谈.mp4 · 说话人 A · 00:00–00:11');
  assert.equal(V.makeVoice({}).name, '我自己');
});

test('按引擎落地：能吃参考音频的都走 clone', () => {
  ['qwen3', 'qwen3-1.7b', 'indextts2', 'indextts25', 'voxcpm2', 'omnivoice', 'fish-s2-pro'].forEach((e) => {
    const p = V.profileFor(e);
    assert.equal(p.ok, true, e);
    assert.equal(p.mode, 'clone');
    assert.ok(p.line);
  });
  assert.match(V.profileFor('qwen3').line, /ICL/);
  assert.match(V.profileFor('voxcpm2').line, /原文/);
  // 多句一致那句统一由 RUN_LINE 带，引擎落地句自己不再重复
  assert.match(V.RUN_LINE, /同一颗种子/);
  ['qwen3', 'indextts2', 'voxcpm2'].forEach((e) => assert.doesNotMatch(V.profileFor(e).line, /种子/));
  const chips = V.engineChips();
  assert.deepEqual(chips.map((c) => c.ok), [true, true, true, true, true, true, true]);
  assert.match(V.profileFor('omnivoice').line, /非商用/);
  // 试听克隆的次序（OmniVoice 仅限非商用、Fish 同样不进）
  assert.deepEqual(V.CLONE_MODELS, ['indextts2', 'qwen3-tts-0.6b-base', 'index-tts2.5', 'qwen3-tts-1.7b-base', 'voxcpm2']);
  assert.equal(V.auditionModel((id) => id === 'voxcpm2'), 'voxcpm2');
  assert.equal(V.auditionModel((id) => id === 'index-tts2.5' || id === 'qwen3-tts-0.6b-base'), 'qwen3-tts-0.6b-base');
  assert.equal(V.auditionModel(() => true), 'indextts2');
  assert.equal(V.auditionModel(() => false), null);
});

test('分人页：每人一张卡、字母按出场、按说话时长排、候选最多 3 段互不重叠且都 5–10 秒', () => {
  const cards = V.analyze(CUES, {});
  assert.deepEqual(cards.map((c) => c.id), ['s2', 's1', 's3']);
  assert.deepEqual(cards.map((c) => c.letter), ['B', 'A', 'C']);
  assert.equal(V.speakerLine(cards[0]), '说了 25 秒 · 4 句');
  cards.forEach((c) => {
    assert.ok(c.candidates.length <= 3);
    const used = new Set();
    c.candidates.forEach((w) => {
      assert.ok(w.seconds >= 5 && w.seconds <= 10, `${c.id} ${w.seconds}`);
      assert.ok(w.text, '候选带文字');
      w.ids.forEach((id) => { assert.ok(!used.has(id)); used.add(id); });
      assert.deepEqual(w.issues, []);
    });
  });
  assert.equal(V.candidateLine(cards[0].candidates[0]), '00:29–00:35 · 6.4 秒');
});

test('质量 chip 只报分离 / 分人步报上来的区间：插话、背景声；分离过就不报背景声', () => {
  const opt = {overlaps: [[52.5, 54.5]], music: [[0, 12]]};
  const cards = V.analyze(CUES, {}, opt);
  const a = cards.find((c) => c.id === 's1');
  assert.deepEqual(a.candidates.map((w) => w.issues), [[], ['overlap'], ['background']]);
  const sep = V.analyze(CUES, {}, Object.assign({separated: true}, opt));
  assert.deepEqual(sep.find((c) => c.id === 's1').candidates.map((w) => w.issues), [[], ['overlap'], []]);
  assert.equal(V.issueLabel('overlap'), '有人插话');
  const short = V.analyze([S('x', 0, 3, 'q', 'hi')], {});
  assert.deepEqual(short[0].candidates[0].issues, ['short']);
  // 凑得出 5 秒的说话人不再列碎段
  const mixed = V.analyze([S('a', 0, 6, 'q', 'one'), S('b', 20, 23, 'q', 'two'), S('c', 40, 43.5, 'q', 'three')], {});
  assert.deepEqual(mixed[0].candidates.map((w) => w.issues), [[]]);
});

test('分人页保存：勾了谁就造谁，名字空着用「说话人 X」，底栏那句跟着人数', () => {
  const cards = V.analyze(CUES, {});
  assert.equal(V.saveLabel(cards, {}), '先勾一位说话人');
  assert.equal(V.saveLabel(cards, {s1: {on: true, name: '主持人'}}), '存为音色「主持人」');
  assert.equal(V.saveLabel(cards, {s1: {on: true}, s2: {on: true}}), '已选 2 位 · 存为 2 只音色');
  const media = {name: '访谈.mp4', lang: 'zh', separated: true};
  const out = V.voicesFromPicks(cards, {s1: {on: true, name: '主持人', k: 1}, s3: {on: true}}, media);
  assert.deepEqual(out.map((v) => v.name), ['主持人', '说话人 C']);
  assert.equal(out[0].source.kind, 'media');
  assert.equal(out[0].source.speaker, 'A');
  assert.equal(out[0].start, undefined);
  assert.equal(out[0].source.start, cards.find((c) => c.id === 's1').candidates[1].start);
  assert.equal(out[0].textSource, 'transcript');
  assert.ok(out[0].text);
});

test('共享选择器：四组按引擎增减', () => {
  const g = V.pickerGroups('qwen3-1.7b', V.DEMO);
  assert.deepEqual(g.map((x) => x.k), ['default', 'my', 'builtin', 'preset', 'file']);
  assert.equal(g[1].items.length, 3);
  assert.equal(g[1].items[2].kind, 'new');
  assert.deepEqual(V.pickerGroups('indextts2', []).map((x) => x.k), ['default', 'my', 'builtin', 'file']);
  assert.deepEqual(V.pickerGroups('qwen3', []).map((x) => x.k), ['default', 'my', 'builtin', 'file'], '0.6B 只剩 Base：没有预设一组');
});

test('选择器值 ↔ 表单：选我的声音落成 clone + my: 参考，选预设落 preset，反推一致', () => {
  const f = {engine: 'qwen3-1.7b', mode: 'preset', preset: 'Vivian', refText: ''};
  const patch = V.applyToForm(f, {kind: 'my', id: 'v-host'}, V.DEMO);
  assert.equal(patch.mode, 'clone');
  assert.equal(patch.ref.my, 'v-host');
  assert.match(patch.refText, /码与远方/);
  assert.deepEqual(V.valueOfForm(Object.assign({}, f, patch)), {kind: 'my', id: 'v-host'});
  assert.equal(V.valueLabel({kind: 'my', id: 'v-host'}, V.DEMO), '主持人');
  assert.equal(V.valueLabel({kind: 'my', id: 'gone'}, V.DEMO), '已删除的音色');
  const p2 = V.applyToForm(Object.assign({}, f, patch), {kind: 'preset', id: 'Serena'}, V.DEMO);
  assert.deepEqual(p2, {mode: 'preset', preset: 'Serena'});
  const b = V.applyToForm(f, {kind: 'builtin', id: 'en-male'});
  assert.equal(b.ref.builtin, 'en-male');
  assert.deepEqual(V.valueOfForm(Object.assign({}, f, b)), {kind: 'builtin', id: 'en-male'});
  const d = V.applyToForm(Object.assign({}, f, patch), {kind: 'default'});
  assert.equal(d.ref, null);
  assert.equal(d.mode, 'clone');
  assert.deepEqual(V.valueOfForm({engine: 'indextts2', mode: 'clone', ref: null}), {kind: 'default'});
  assert.equal(V.valueLabel({kind: 'default'}), '默认音色');
});

test('导出包：voice.json schema 1，带参考文字、来源与同意声明', () => {
  const v = V.DEMO[0];
  const j = JSON.parse(V.exportBundle(v));
  assert.equal(j.schema, 1);
  assert.equal(j.reference.file, 'reference.wav');
  assert.equal(j.reference.seconds, 7.8);
  assert.equal(j.reference.textSource, 'script');
  assert.equal(j.consent, 'self');
  assert.equal(j.provenance.kind, 'mic');
  assert.equal(j.qwen3.mode, 'icl');
  assert.equal(V.bundleName(v), '我自己.bcvoice');
});

test('model-tts 那边认 my: 来源：refSources 把我的声音排在默认之后、pickRef 带上原文', () => {
  const src = TTS.refSources('indextts2', false, V.DEMO);
  assert.deepEqual(src.slice(0, 3).map((s) => s.k), ['none', 'my:v-me', 'my:v-host']);
  assert.equal(src[1].my, true);
  const f = TTS.pickRef({engine: 'indextts2', refText: ''}, 'my:v-me', null, V.DEMO);
  assert.equal(f.ref.my, 'v-me');
  assert.equal(f.ref.name, '我自己');
  assert.match(f.refText, /BaoCut/);
  assert.equal(TTS.refSourceOf(f.ref), 'my:v-me');
});

test('新音色的默认名字：重名时依次加编号', () => {
  assert.equal(V.defaultVoiceName([]), '我的声音');
  assert.equal(V.defaultVoiceName([{name: '主持人'}, {name: '我的声音'}]), '我的声音 2');
  assert.equal(V.defaultVoiceName([{name: '我的声音'}, {name: '我的声音 2'}]), '我的声音 3');
});

test('录样本（2026-11-08）：30 秒不停，过了目标说够了可以接着说，只在最后 10 秒倒数；进度条按目标填满', () => {
  assert.equal(V.secLabel(30), '30 秒');
  assert.equal(V.secLabel(180), '3 分钟');
  assert.equal(V.secLabel(90), '1 分 30 秒');
  assert.deepEqual(V.liveHint(2, V.SAMPLE), {text: '还差 3.0 秒', pct: 2 / 30 * 100});
  assert.equal(V.liveHint(12, V.SAMPLE).text, '够了 · 到 30 秒最好');
  const past = V.liveHint(30.1, V.SAMPLE);
  assert.equal(past.text, '够了 · 想多说就接着说，最长 3 分钟', '30 秒不停');
  assert.equal(past.pct, 100);
  assert.equal(V.liveHint(169.9, V.SAMPLE).text, '够了 · 想多说就接着说，最长 3 分钟', '最后 10 秒之前不倒数');
  assert.equal(V.liveHint(172.3, V.SAMPLE).text, '还能录 8 秒');
  assert.equal(V.liveHint(180, V.SAMPLE).text, '到点自动停');
  // 授权声明没有 countdown：照旧数还能录几秒，进度条按上限
  assert.equal(V.liveHint(9, V.CONSENT_REC).text, '还能录 6.0 秒');
  assert.equal(V.liveHint(5, V.CONSENT_REC).text, '够了 · 到 8 秒最好');
  assert.equal(V.liveHint(7.5, V.CONSENT_REC).pct, 50);
  // 样本比这家上限长：明说只用前一段
  const gemini = {id: 'google', name: 'Google Gemini', clone: {min: 10, max: 30, consent: true}};
  const eleven = {id: 'elevenlabs', name: 'ElevenLabs', clone: {min: 1, max: 300}};
  const long = V.sampleVerdict(46.2, [gemini, eleven]);
  assert.deepEqual(long.trim, ['Google Gemini 用前 30 秒']);
  assert.equal(long.line, '够了 · Google Gemini 用前 30 秒');
  assert.deepEqual(V.sampleVerdict(30, [gemini]).trim, [], '正好 30 秒不截');
});

const CT = global.window.BC_CLOUD_TTS || require('./model-cloud-tts.js');
const GEMINI = CT.providerById('google');
const pickTargets = () => V.cloneTargets(V.engineChips(), CT.providers(), ['google', 'elevenlabs']);

test('采集页预选：本机引擎照旧全勾，云端只勾入口那一家；从云端模型过来直接进「录样本」', () => {
  const targets = pickTargets();
  const local = targets.filter((t) => t.kind === 'local').map((t) => t.id);
  assert.deepEqual(V.initialPicks(targets, null), local, '从我的声音直接进：一家云端都不替人勾');
  assert.deepEqual(V.initialPicks(targets, 'google'), local.concat('google'));
  assert.ok(V.initialPicks(targets, 'google').indexOf('elevenlabs') < 0, '连着的别家也不勾');
  assert.equal(V.startStep(targets, 'google'), 1);
  assert.equal(V.startStep(targets, 'indextts2'), 0, '本机模型过来照旧从第一步');
  assert.equal(V.startStep(targets, null), 0);
});

test('保存那一步：前提齐了的才上传；按钮说会发生什么；没齐的照实说不上传和为什么；按钮旁一句外发', () => {
  const targets = pickTargets();
  const g = targets.find((t) => t.id === 'google');
  const local = targets.filter((t) => t.kind === 'local');
  const e0 = () => targets.find((t) => t.id === 'elevenlabs');
  const base = {declared: true, sampleDur: 46.2, refDur: 10, consentClip: {dur: 7.9}, providers: CT.providers()};
  const ok = V.savePlan(local.concat(g), base);
  assert.deepEqual(ok.uploads, ['google']);
  assert.equal(ok.button, '保存并上传到 Google Gemini');
  const row = ok.rows.find((r) => r.id === 'google');
  assert.equal(row.k, 'upload');
  assert.match(row.line, /^保存后马上上传样本前 30 秒和授权声明（7\.9 秒），截在停顿处/);
  assert.equal(ok.outflow, '会把样本前 30 秒和授权声明（7.9 秒）发给 Google Gemini，用来建克隆；其余都留在这台电脑上。');
  assert.equal(ok.rows[0].k, 'local');
  assert.match(ok.rows[0].line, /用样本前 10 秒当参考段/);
  // 30 秒以内不截，不写「截在停顿处」
  assert.doesNotMatch(V.savePlan([g], Object.assign({}, base, {sampleDur: 24.6})).rows[0].line, /截在停顿处/);
  // 四种不上传
  const plan = (o, t) => V.savePlan([t || g], Object.assign({}, base, o));
  assert.equal(plan({declared: false}).rows[0].k, 'undeclared');
  assert.equal(plan({declared: false}).button, '保存音色');
  assert.equal(plan({declared: false}).outflow, '只存在这台电脑上，不发给任何服务商。');
  assert.equal(plan({consentClip: null}).rows[0].k, 'no-consent');
  assert.match(plan({consentClip: null}).rows[0].line, /跳过了授权声明/);
  assert.equal(plan({sampleDur: 7.4}).rows[0].k, 'short');
  // 自定义的授权声明：Google 只认官方原文，注定验不过就不传
  assert.equal(plan({consentCustom: true}).rows[0].k, 'custom-consent');
  assert.deepEqual(plan({consentCustom: true}).uploads, []);
  assert.equal(V.savePlan([e0()], Object.assign({}, base, {consentCustom: true})).rows[0].k, 'upload', '不要声明的家不受影响');
  const off = plan({}, Object.assign({}, g, {connected: false}));
  assert.equal(off.rows[0].k, 'offline');
  assert.match(off.rows[0].line, /连上后在这只音色的 ⋯ 里上传/);
  assert.deepEqual(off.uploads, []);
  // 不要授权声明的家：只发样本；两家都齐就都传，按钮点名
  const e = targets.find((t) => t.id === 'elevenlabs');
  const both = V.savePlan([g, e], base);
  assert.equal(both.button, '保存并上传到 Google Gemini、ElevenLabs');
  assert.match(both.outflow, /样本 46\.2 秒发给 ElevenLabs/);
  assert.equal(V.savePlan([], base).button, '保存音色');
});

test('上传中 / 建好 / 没建成：记在音色上，建好落进 cloud，点「知道了」才清掉', () => {
  const v = V.makeVoice({id: 'v-new', name: '我的声音', consent: 'self', sourceDur: 46.2, consentClip: {dur: 7.9}});
  assert.equal(V.cloneState(v, 'google'), null);
  const up = Object.assign({}, v, V.cloneAfter(v, 'google', 'start'));
  assert.equal(V.cloneState(up, 'google'), 'uploading');
  assert.deepEqual(V.cloneRuns(up).map((r) => [r.id, r.state]), [['google', 'uploading']]);
  const err = V.CLONE_DEMO.find((d) => d.k === 'speaker-mismatch').error;
  const bad = Object.assign({}, up, V.cloneAfter(up, 'google', 'fail', {error: err}));
  assert.equal(V.cloneState(bad, 'google'), 'failed');
  assert.equal(bad.cloneRun.google.error.reason, 'speaker-mismatch');
  const ready = Object.assign({}, bad, V.cloneAfter(bad, 'google', 'ready'));
  assert.equal(V.cloneState(ready, 'google'), 'ready');
  assert.match(ready.cloud.google.voiceId, /^voice_/);
  assert.deepEqual(V.cloneRuns(ready).map((r) => [r.id, r.state]), [['google', 'ready']]);
  assert.equal(CT.cloneStatus(ready, 'google').k, 'uploaded');
  const seen = Object.assign({}, ready, V.cloneAfter(ready, 'google', 'dismiss'));
  assert.deepEqual(V.cloneRuns(seen), []);
  assert.equal(V.cloneState(seen, 'google'), 'ready');
  assert.match(seen.cloud.google.voiceId, /^voice_/);
});

test('没建成的诊断：原因 → 办法 → 一键去做，原话只当附注', () => {
  const d = (k) => V.cloneFailure(V.CLONE_DEMO.find((x) => x.k === k).error, GEMINI);
  const mismatch = d('speaker-mismatch');
  assert.equal(mismatch.title, '两段录音不像同一个人');
  assert.match(mismatch.advice.join(' '), /同一只麦克风、在同一个房间/);
  assert.deepEqual(mismatch.action, {k: 'consent', label: '重录授权声明', sub: '存好后自动重新上传'});
  assert.match(mismatch.raw, /^Consent verification failed/);
  assert.equal(d('consent-unrecognized').action.k, 'consent');
  assert.match(d('consent-unrecognized').advice.join(' '), /一字不差.*英文最稳/);
  assert.match(d('source-duration').cause, /10–30 秒.*太短或太长/);
  assert.match(d('source-duration').advice[2], /剪到 30 秒以内/);
  assert.equal(d('source-duration').action.k, 'sample');
  assert.equal(d('synthetic-audio').action.k, 'sample');
  assert.equal(d('audio-invalid').action.k, 'sample');
  assert.match(d('voice-limit').cause, /最多存 200 只/);
  assert.match(d('voice-limit').advice[0], /Google AI Studio/);
  assert.equal(d('voice-limit').action.k, 'retry');
  assert.match(d('feature-unavailable').cause, /Tier 1/);
  assert.deepEqual(d('feature-unavailable').action, {k: 'provider', label: '打开 Google Gemini 设置'});
  assert.equal(d('auth').action.k, 'provider');
  assert.equal(d('auth').reason, 'auth');
  assert.equal(d('quota').action.k, 'retry');
  assert.equal(d('network').title, '连不上 Google Gemini');
  assert.deepEqual(d('grant').action, {k: 'grant', label: '同意并上传'});
  // 认不出的：给 Gemini 的那张清单，按规格写 10–30 秒，带两段同一麦克风与原文
  const unknown = d('unknown');
  assert.equal(unknown.reason, 'unknown');
  assert.equal(unknown.action.k, 'retry');
  assert.deepEqual(unknown.advice, ['样本是 10–30 秒干净、自然的说话', '从头到尾只有一个成年人在说', '在安静的房间录，没有音乐和回声',
    '样本和授权声明用同一只麦克风、在同一个房间录', '授权声明一字不差照着原文念']);
  assert.equal(unknown.raw, 'Request contains an invalid argument.');
  assert.equal(unknown.code, 'PROVIDER_REJECTED');
  // 演示挡位的原因与命令协议规范的 details.reason 一一对应，都挂在 PROVIDER_REJECTED 上
  assert.deepEqual(V.CLONE_DEMO.filter((x) => x.error && x.error.reason).map((x) => [x.error.code, x.error.reason]),
    ['speaker-mismatch', 'consent-unrecognized', 'source-duration', 'synthetic-audio', 'audio-invalid', 'voice-limit', 'feature-unavailable']
      .map((r) => ['PROVIDER_REJECTED', r]));
  // reason 优先于 code；不要授权声明的家清单里没有那两条；别家不写 Gemini 的专属说法
  assert.equal(V.cloneFailure({code: 'PROVIDER_AUTH_FAILED', reason: 'voice-limit'}, GEMINI).reason, 'voice-limit');
  const eleven = CT.providerById('elevenlabs');
  assert.equal(V.cloneChecklist(eleven).length, 3);
  assert.doesNotMatch(V.cloneFailure({reason: 'voice-limit'}, eleven).cause, /200/);
  assert.equal(V.cloneFailure(null, eleven).raw, '');
  // 演示挡位每一档（除了建好）都落到一条有标题、有办法、有按钮的诊断
  V.CLONE_DEMO.filter((x) => x.error).forEach((x) => {
    const r = V.cloneFailure(x.error, GEMINI);
    assert.ok(r.title && r.cause && r.advice.length && r.action.label, x.k);
  });
});
