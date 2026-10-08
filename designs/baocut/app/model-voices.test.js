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
  ['qwen3', 'qwen3-1.7b', 'indextts2', 'indextts25', 'gptsovits', 'voxcpm2', 'omnivoice'].forEach((e) => {
    const p = V.profileFor(e);
    assert.equal(p.ok, true, e);
    assert.equal(p.mode, 'clone');
    assert.ok(p.line);
  });
  assert.match(V.profileFor('qwen3').line, /ICL/);
  assert.match(V.profileFor('gptsovits').line, /原文/);
  // 多句一致那句统一由 RUN_LINE 带，引擎落地句自己不再重复
  assert.match(V.RUN_LINE, /同一颗种子/);
  ['qwen3', 'indextts2', 'gptsovits'].forEach((e) => assert.doesNotMatch(V.profileFor(e).line, /种子/));
  const chips = V.engineChips();
  assert.deepEqual(chips.map((c) => c.ok), [true, true, true, true, true, true, true]);
  assert.match(V.profileFor('omnivoice').line, /非商用/);
  assert.equal(V.auditionModel((id) => id === 'gpt-sovits-v2'), 'gpt-sovits-v2');
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
  const g = V.pickerGroups('qwen3', V.DEMO);
  assert.deepEqual(g.map((x) => x.k), ['default', 'my', 'builtin', 'preset', 'file']);
  assert.equal(g[1].items.length, 3);
  assert.equal(g[1].items[2].kind, 'new');
  assert.deepEqual(V.pickerGroups('indextts2', []).map((x) => x.k), ['default', 'my', 'builtin', 'file']);
});

test('选择器值 ↔ 表单：选我的声音落成 clone + my: 参考，选预设落 preset，反推一致', () => {
  const f = {engine: 'qwen3', mode: 'preset', preset: 'Vivian', refText: ''};
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
