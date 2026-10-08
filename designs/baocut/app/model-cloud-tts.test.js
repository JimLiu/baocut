const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-cloud-tts.js');
require('./model-tts.js');
require('./model-voices.js');
const C = global.window.BC_CLOUD_TTS;
const TTS = global.window.BC_TTS;
const V = global.window.BC_VOICES;

const voice = (o) => V.makeVoice(Object.assign({name: '主持人', lang: 'zh', dur: 7.4, consent: 'permitted', text: 'x'}, o));

test('模型 id：cloud:<provider>/<model> 拼与拆，非 cloud 前缀回 null', () => {
  assert.equal(C.modelId('elevenlabs', 'eleven_v3'), 'cloud:elevenlabs/eleven_v3');
  assert.deepEqual(C.parse('cloud:minimax/speech-2.8-hd'), {provider: 'minimax', model: 'speech-2.8-hd'});
  assert.deepEqual(C.parse('cloud:openai'), {provider: 'openai', model: ''});
  assert.equal(C.parse('qwen3-tts-0.6b-base'), null);
  assert.equal(C.parse('remote:mac-studio/qwen3'), null);
  assert.ok(C.isCloud('cloud:openai'));
  assert.equal(C.providerOf('cloud:openai/tts-1'), 'openai');
});

test('三家种子表：OpenAI 不能克隆、只有 gpt-4o-mini-tts 收风格指令；ElevenLabs 有三根滑杆；MiniMax 有情绪、音高、音量与接入点', () => {
  const o = C.capabilities('openai', 'gpt-4o-mini-tts');
  assert.equal(o.clone, false);
  assert.equal(o.instruct, true);
  assert.equal(C.capabilities('openai', 'tts-1').instruct, false);
  assert.equal(o.profile, 'none');
  const e = C.capabilities('elevenlabs', 'eleven_multilingual_v2');
  assert.equal(e.clone, true);
  assert.deepEqual(e.sliders.map((s) => s.k), ['stability', 'similarity', 'styleStrength']);
  assert.equal(e.langs.length, 29);
  assert.equal(C.capabilities('elevenlabs', 'eleven_flash_v2_5').langs.length, 32);
  assert.equal(C.capabilities('elevenlabs', 'eleven_v3').maxChars, 5000);
  const m = C.capabilities('minimax', 'speech-2.8-hd');
  assert.ok(m.emotions && m.emotions.length === 9);
  assert.ok(m.pitch && m.volume);
  assert.equal(m.region, true);
  assert.equal(m.langs.length, 40);
  assert.equal(C.minimaxBoost('zh-Hans'), 'Chinese');
  assert.equal(C.minimaxBoost('yue'), 'Chinese,Yue');
  assert.equal(C.minimaxBoost('xx'), 'auto');
  // 每家的语速区间不同，滑杆按能力表画
  assert.deepEqual([C.capabilities('openai').speed.max, C.capabilities('elevenlabs').speed.max, C.capabilities('minimax').speed.max], [4, 1.2, 2]);
});

test('语言 Picker：多语言只列常用 12 种，40 种的表默认也收到常用那几种、all 才全列', () => {
  const o = C.langOptions('openai', 'tts-1');
  assert.equal(o[0].code, 'auto');
  assert.equal(o.length, 13);
  assert.equal(C.langOptions('minimax', 'speech-2.8-hd').length, 13);
  assert.equal(C.langOptions('minimax', 'speech-2.8-hd', true).length, 41);
  assert.equal(C.langOptions('elevenlabs', 'eleven_multilingual_v2').length, 13);
  assert.equal(C.langOptions('elevenlabs', 'eleven_multilingual_v2', true).length, 30);
  assert.ok(C.speaks('openai', 'tts-1', 'th'), '多语言引擎什么都会念');
  assert.ok(!C.speaks('elevenlabs', 'eleven_multilingual_v2', 'th'));
  assert.ok(C.speaks('elevenlabs', 'eleven_multilingual_v2', 'zh-Hans'));
  assert.equal(C.langsShort('elevenlabs', 'eleven_v3'), '70+ 种语言');
  assert.equal(C.langsShort('elevenlabs', 'eleven_multilingual_v2'), '29 种语言');
});

test('引擎：只把已连接的 API 提供方折成引擎，形状与本地引擎兼容（engineOf / modelFor / voiceModes）', () => {
  const list = C.engines(['openai', 'elevenlabs']);
  assert.deepEqual(list.map((e) => e.id), ['cloud:openai', 'cloud:elevenlabs']);
  const e = list[1];
  assert.equal(e.cloud, true);
  assert.equal(e.models.preset, 'cloud:elevenlabs/eleven_v3');
  assert.equal(e.cloudModels.length, 3);
  // model-tts.js 认云端引擎：engineOf 不再落到表头，voiceModes 只有 preset（音色由选择器管）
  assert.equal(TTS.engineOf('cloud:elevenlabs').name, 'ElevenLabs');
  assert.deepEqual(TTS.voiceModes('cloud:elevenlabs'), ['preset']);
  assert.equal(TTS.modelFor('cloud:minimax', 'preset'), 'cloud:minimax/speech-2.8-hd');
  assert.equal(TTS.engineOf('qwen3').cloud, undefined);
  assert.equal(TTS.engineOf('cloud:nope').id, 'qwen3', '认不出的云端引擎仍落到表头');
  // hasStyle：只有收风格指令的模型才有「风格」一行
  assert.equal(TTS.hasStyle('cloud:openai'), true);
  assert.equal(TTS.hasStyle('cloud:elevenlabs'), false);
  assert.equal(TTS.hasEmotion('cloud:minimax'), false, 'MiniMax 的情绪是枚举，走云端选项区，不走 IndexTTS 那套');
  assert.equal(TTS.engineSpeaks('cloud:openai', 'ko'), true);
  assert.equal(TTS.engineSpeaks('cloud:openai', 'th'), true, '多语言引擎会念常用表之外的语言');
  // ENGINES 本身不变：本地七只（2026-09-26 加 VoxCPM2 / OmniVoice）
  assert.equal(TTS.ENGINES.length, 7);
  assert.equal(TTS.allEngines(['minimax']).length, 8);
});

test('引擎卡与页顶 chip：标签按能力派生，联网计费用 notice；没连的多一枚「未连接」', () => {
  const c = C.card('minimax');
  assert.equal(c.id, 'cloud:minimax');
  const labels = c.tags.map((t) => t.label);
  assert.ok(labels.includes('克隆') && labels.includes('情绪') && labels.includes('语速 / 音高 / 音量') && labels.includes('40 种语言'));
  assert.equal(c.tags.find((t) => t.label === '联网计费').tone, 'notice');
  assert.ok(!C.card('openai').tags.some((t) => t.label === '克隆'));
  assert.ok(C.card('openai').tags.some((t) => /风格指令（gpt-4o-mini-tts）/.test(t.label)));
  assert.ok(C.card('elevenlabs').tags.some((t) => t.label === '稳定 / 相似 / 风格强度'));
  assert.ok(C.card('elevenlabs', false).tags.some((t) => t.label === '未连接'));
  assert.equal(C.headerChip('elevenlabs'), '联网 · ElevenLabs · 按字符计费');
});

test('自建 API 提供方：OpenAI-compatible 形状，手填的音色成目录，没填就由对方缺省', () => {
  const p = C.customProvider({id: 'custom-0', name: '我的节点', url: 'https://mac-studio.local:24320', models: ['qwen3-tts-0.6b-base'], voices: 'zh-female, zh-male'});
  assert.equal(p.api, 'openai');
  assert.equal(p.custom, true);
  assert.equal(p.voices.length, 2);
  assert.equal(C.defaultVoice(p, 'zh').id, 'zh-female');
  const bare = C.customProvider({id: 'custom-1', name: 'x', url: 'https://x', models: ['m']});
  assert.equal(C.defaultVoice(bare, 'zh'), null);
  assert.equal(C.engines(['custom-0'], [p])[0].custom, true);
  assert.equal(C.headerChip(p), '联网 · 我的节点 · 发到你自建的服务');
  assert.ok(C.card(p).tags.some((t) => t.label === 'OpenAI-compatible'));
});

test('默认音色按语言：精确命中 → 英语 → 表首；目录里的都能按 id 找到', () => {
  assert.equal(C.defaultVoice('minimax', 'ja').id, 'Japanese_Whisper_Belle');
  assert.equal(C.defaultVoice('minimax', 'yue').id, 'Cantonese_GentleLady');
  assert.equal(C.defaultVoice('minimax', 'de').id, 'German_Friendly_Man', '表里没写的语言按目录的 lang 匹配');
  assert.equal(C.defaultVoice('minimax', 'th').id, 'English_Graceful_Lady', '谁都不会念的落到英语');
  assert.equal(C.defaultVoice('openai', 'zh').id, 'marin');
  assert.equal(C.defaultVoice('elevenlabs', 'zh').name, '林语');
  assert.equal(C.voicesOf('openai').length, 13);
  // 「刷新音色」问回来的并进目录、不重复
  const more = {elevenlabs: [{id: 'x1', name: '新的'}, {id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah'}]};
  assert.equal(C.voicesOf('elevenlabs', more).length, C.voicesOf('elevenlabs').length + 1);
  assert.equal(C.searchVoices(C.voicesOf('elevenlabs'), '中文').length, 2);
  assert.equal(C.searchVoices(C.voicesOf('elevenlabs'), 'sarah')[0].name, 'Sarah');
});

test('克隆状态：OpenAI 不能克隆；许可未说明不上传；MiniMax 要 10 秒；首次用时上传；上传过；换参考段后陈旧；移除密钥后 orphan', () => {
  const v = voice({});
  assert.equal(C.cloneStatus(v, 'openai').k, 'unsupported');
  assert.match(C.cloneStatus(v, 'openai', {saved: ['openai', 'elevenlabs']}).line, /换 ElevenLabs$/);
  assert.equal(C.cloneStatus(voice({consent: 'unspecified'}), 'elevenlabs').k, 'consent');
  assert.equal(C.cloneStatus(v, 'minimax').k, 'short');
  assert.equal(C.cloneStatus(voice({sourceDur: 24}), 'minimax').k, 'first');
  assert.match(C.cloneStatus(voice({sourceDur: 24}), 'minimax').line, /7 天不用会过期/);
  const first = C.cloneStatus(v, 'elevenlabs');
  assert.equal(first.k, 'first');
  assert.equal(first.ok, true);
  const up = Object.assign({}, v, {cloud: C.bindAfter(v, 'elevenlabs', 'upload', {at: '2026-09-24'})});
  assert.equal(C.cloneStatus(up, 'elevenlabs').k, 'uploaded');
  assert.equal(C.cloneStatus(up, 'elevenlabs').chip, 'ElevenLabs ↑ 已上传');
  const stale = Object.assign({}, up, {cloud: C.bindAfter(up, 'elevenlabs', 'retake')});
  assert.equal(C.cloneStatus(stale, 'elevenlabs').k, 'stale');
  const orphan = Object.assign({}, up, {cloud: C.bindAfter(up, 'elevenlabs', 'orphan')});
  assert.equal(C.cloneStatus(orphan, 'elevenlabs').k, 'orphan');
  const gone = Object.assign({}, up, {cloud: C.bindAfter(up, 'elevenlabs', 'delete')});
  assert.equal(C.cloneStatus(gone, 'elevenlabs').k, 'first');
  // 接入点换了：MiniMax 的绑定视为陈旧
  const mm = voice({sourceDur: 24});
  const mmUp = Object.assign({}, mm, {cloud: C.bindAfter(mm, 'minimax', 'upload', {region: 'global'})});
  assert.equal(C.cloneStatus(mmUp, 'minimax', {region: 'global'}).k, 'uploaded');
  assert.equal(C.cloneStatus(mmUp, 'minimax', {region: 'cn'}).k, 'stale');
  // 行卡上的 chip 只列已连接的
  assert.deepEqual(C.cloudChips(v, ['openai', 'minimax']).map((c) => c.k), ['unsupported', 'short']);
  assert.match(C.uploadNotice(v, 'elevenlabs'), /「主持人」的参考段（7\.4 秒）上传到 ElevenLabs/);
});

test('选择器分组（§2.3）：默认 / 我的声音 / 提供方音色（多于 12 只带搜索）/ 临时；OpenAI 没有临时那一组', () => {
  const voices = [voice({id: 'a'}), voice({id: 'b', consent: 'unspecified', name: '路人'})];
  const g = C.pickerGroups('elevenlabs', voices, {lang: 'en'});
  assert.deepEqual(g.map((x) => x.k), ['default', 'my', 'voices', 'file']);
  assert.match(g[0].items[0].sub, /Sarah/);
  assert.equal(g[1].items[0].disabled, false);
  assert.equal(g[1].items[1].disabled, true);
  assert.match(g[1].items[1].why, /许可未说明/);
  assert.equal(g[1].items[2].kind, 'new');
  assert.equal(g[2].search, true);
  assert.equal(g[2].total, 14);
  assert.deepEqual(C.pickerGroups('openai', voices).map((x) => x.k), ['default', 'my', 'voices']);
  assert.ok(C.pickerGroups('openai', voices)[1].items.every((it) => it.kind === 'new' || it.disabled), 'OpenAI 下我的声音整组置灰');
  assert.equal(C.pickerGroups('openai', voices)[2].search, true);
  assert.equal(C.pickerGroups('elevenlabs', voices, {query: 'zzz'})[2].items[0].kind, 'none');
  assert.match(C.pickerGroups('minimax', voices, {sourceDur: 0})[3].items[0].sub, /7 天后自动过期/);
  // 值 → 名字与那一句
  assert.equal(C.valueLabel('elevenlabs', {kind: 'voice', id: 'pNInz6obpgDQGcFmaJgB'}), 'Adam');
  assert.equal(C.valueLabel('elevenlabs', {kind: 'my', id: 'a'}, voices), '主持人');
  assert.match(C.valueLine('elevenlabs', {kind: 'my', id: 'a'}, voices), /同一只 voice id$/);
  assert.match(C.valueLine('elevenlabs', {kind: 'default'}, voices, {lang: 'zh'}), /林语/);
  assert.equal(C.voiceLabel('minimax', null, [], {lang: 'ja'}), '默认音色 · Whisper Belle');
});

test('校验与费用：字数上限按模型；我的声音在这家不可用就拦；没连密钥先连', () => {
  const f = {engine: 'cloud:elevenlabs', cloudModel: 'cloud:elevenlabs/eleven_v3', text: 'x'.repeat(5001), cloudVoice: {kind: 'default'}};
  assert.match(C.validate(f, [])[0], /5,000 字/);
  assert.equal(C.validate(Object.assign({}, f, {text: 'hi'}), []).length, 0);
  assert.equal(C.validate(Object.assign({}, f, {text: 'x'.repeat(5001), cloudModel: 'cloud:elevenlabs/eleven_flash_v2_5'}), []).length, 0);
  const v = voice({id: 'a', consent: 'unspecified'});
  assert.match(C.validate({engine: 'cloud:elevenlabs', text: 'hi', cloudVoice: {kind: 'my', id: 'a'}}, [v])[0], /许可未说明/);
  assert.match(C.validate({engine: 'cloud:minimax', text: 'hi', cloudVoice: {kind: 'default'}}, [], {saved: ['openai']})[0], /先连接 MiniMax/);
  assert.equal(C.validate({engine: 'qwen3', text: 'hi'}, []).length, 0, '本地引擎不归它管');
  assert.match(C.costLine('欢迎使用 BaoCut', 'minimax'), /按字符计费 · 这次约 11 字/);
  assert.equal(C.chars('  ab c '), 4);
});

test('Google Gemini（§5.6 / §12.9）：两只模型都收风格指令、没有数值语速、不能克隆、30 只内置音色、默认 Kore、一次 4096 字、24 kHz、按 token 计费', () => {
  assert.deepEqual(C.parse('cloud:google/gemini-3.8-flash-lite-tts'), {provider: 'google', model: 'gemini-3.8-flash-lite-tts'});
  assert.equal(C.modelId('google', 'gemini-3.8-flash-tts'), 'cloud:google/gemini-3.8-flash-tts');
  for (const id of ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']) {
    const cap = C.capabilities('google', id);
    assert.equal(cap.model, id);
    assert.equal(cap.speed, null, '没有 speed 键：语速一行整行不出现');
    assert.equal(cap.instruct, true);
    assert.equal(cap.clone, false);
    assert.equal(cap.profile, 'none');
    assert.equal(cap.maxChars, 4096);
    assert.equal(cap.rate, 24000);
    assert.equal(cap.api, 'gemini');
    assert.deepEqual(cap.sliders, []);
    assert.equal(cap.emotions, null);
  }
  assert.equal(C.capabilities('google').model, 'gemini-3.8-flash-tts', '缺省落到表首 3.8 Flash');
  assert.equal(C.langsShort('google', 'gemini-3.8-flash-tts'), '130 种语言');
  assert.equal(C.langsShort('google', 'gemini-3.8-flash-lite-tts'), '101 种语言');
  const labels = C.card('google').tags.map((t) => t.label);
  assert.ok(labels.includes('风格指令') && labels.includes('130 种语言（Flash-Lite 101）') && labels.includes('联网计费'), labels.join(' / '));
  assert.ok(!labels.some((l) => /语速|克隆/.test(l)), '不做假标签：没有语速、没有克隆');
  assert.equal(C.headerChip('google'), '联网 · Google Gemini · 按 token 计费');
  assert.match(C.costLine('欢迎使用 BaoCut', 'google'), /^按 token 计费 · 这次约 11 字/);
  assert.equal(C.billing('openai'), '按字符计费');
  assert.equal(TTS.hasStyle('cloud:google'), true);
  assert.equal(TTS.engineOf('cloud:google').name, 'Google Gemini');
});

test('Gemini 音色：30 只内置、默认 Kore（任何语言都是它）、多于 12 只带搜索；我的声音整组置灰写原因、没有临时那一组', () => {
  const list = C.voicesOf('google');
  assert.equal(list.length, 30);
  assert.equal(new Set(list.map((v) => v.id)).size, 30);
  assert.ok(list.some((v) => v.id === 'Zephyr') && list.some((v) => v.id === 'Sulafat'));
  assert.equal(C.defaultVoice('google', 'zh').id, 'Kore');
  assert.equal(C.defaultVoice('google', 'ja').id, 'Kore');
  assert.equal(C.defaultVoice('google', '').id, 'Kore');
  const v = voice({id: 'a'});
  const st = C.cloneStatus(v, 'google', {saved: ['google', 'elevenlabs']});
  assert.equal(st.k, 'unsupported');
  assert.equal(st.ok, false);
  assert.equal(st.chip, 'Google Gemini 不能克隆');
  assert.match(st.line, /^Google Gemini 不能克隆 · 用它的音色目录（含你在 AI Studio 建的）/);
  assert.match(st.line, /换 ElevenLabs$/);
  const g = C.pickerGroups('google', [v, voice({id: 'b', name: '路人'})], {lang: 'zh'});
  assert.deepEqual(g.map((x) => x.k), ['default', 'my', 'voices']);
  assert.match(g[0].items[0].sub, /Kore/);
  assert.ok(g[1].items.every((it) => it.kind === 'new' || it.disabled), '我的声音整组置灰');
  assert.ok(g[1].items.filter((it) => it.disabled).every((it) => /不能克隆/.test(it.why || '')), '置灰写原因');
  assert.equal(g[2].search, true);
  assert.equal(g[2].total, 30);
  assert.equal(g[2].items.length, 30);
  assert.equal(C.pickerGroups('google', [], {query: 'kore'})[2].items[0].id, 'Kore');
  // 上传类入口不认 Gemini：行卡 chip 写「不能克隆」
  assert.deepEqual(C.cloudChips(v, ['google']).map((c) => c.k), ['unsupported']);
});

test('Gemini 校验：一次上限 4096 字（8,192 输入 token 的保守折算），超出就提示切段；我的声音被拦', () => {
  const f = {engine: 'cloud:google', cloudModel: 'cloud:google/gemini-3.8-flash-tts', text: 'x'.repeat(4097), cloudVoice: {kind: 'default'}};
  assert.match(C.validate(f, [])[0], /gemini-3\.8-flash-tts 一次最多 4,096 字/);
  assert.equal(C.validate(Object.assign({}, f, {text: 'x'.repeat(4096)}), []).length, 0);
  const v = voice({id: 'a'});
  assert.match(C.validate(Object.assign({}, f, {text: 'hi', cloudVoice: {kind: 'my', id: 'a'}}), [v])[0], /Google Gemini 不能克隆/);
  assert.match(C.validate(Object.assign({}, f, {text: 'hi'}), [], {saved: ['openai']})[0], /先连接 Google Gemini/);
});
