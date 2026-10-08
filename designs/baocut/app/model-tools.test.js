const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-tts.js');
require('./model-video.js');
require('./model-cloud-image.js');
require('./model-tools.js');
const T = global.window.BC_TOOLS;
const TTS = global.window.BC_TTS;

test('本地默认模型覆盖内置推荐，未安装的默认模型不会预选', () => {
  const id = T.modelOf({engine: 'gptsovits', mode: 'clone'});
  assert.equal(T.modelOf(T.preferredForm(() => true, id)), id);
  const fallback = T.modelOf(T.blank());
  assert.equal(T.modelOf(T.preferredForm(mid => mid === fallback, id)), fallback);
});

test('工具目录按处理的对象分三组：语音与字幕、文字与图片、视频文件（product-design §2.7）', () => {
  assert.deepEqual(T.GROUPS.map((g) => [g.k, g.label]), [['speech', '语音与字幕'], ['text-image', '文字与图片'], ['video-file', '视频文件']]);
  assert.deepEqual(T.GROUPS[0].tools.map((t) => t.id), ['transcribe', 'translate', 'dub', 'tts']);
  assert.deepEqual(T.GROUPS[1].tools.map((t) => t.id), ['text', 'image']);
  assert.deepEqual(T.GROUPS[2].tools.map((t) => t.id), ['link', 'compress', 'merge', 'extract']);
  assert.equal(T.openable('link').name, '下载视频');
  assert.equal(T.openable('transcribe').group, 'speech');
  assert.equal(T.openable('dub').name, '翻译配音');
  assert.equal(T.openable('text').group, 'text-image');
  assert.equal(T.openable('extract').name, '提取音频');
  assert.equal(T.openable('remote'), null);
  assert.equal(T.openable('merge').name, '合并视频');
  assert.equal(T.openable('nope'), null);
  assert.ok(!T.TOOLS.some((t) => t.planned), '目录里不该还留着占位工具');
  T.TOOLS.forEach((t) => {
    assert.ok(t.navIcon, `${t.id} 缺侧栏图标`);
    assert.ok(['video', 'artifact'].includes(t.output), `${t.id} 的结果种类`);
    assert.ok(t.inputs.length && t.inputs.every((i) => T.INPUTS[i.kind] && ['video', 'artifact'].includes(i.output)), `${t.id} 的输入声明`);
    assert.ok(!t.artifact || T.ARTIFACTS[t.artifact], `${t.id} 的产物类型`);
    t.inputs.filter((i) => i.kind === 'space').forEach((i) => assert.ok(i.kinds && i.kinds.length, `${t.id} 的 Space 输入要声明种类`));
    if (t.output === 'artifact') assert.ok(T.ARTIFACTS[t.artifact], `${t.id} 缺省产出 Space 条目`);
  });
});

test('输入来源与结果从声明派生：转录收文件 / Space / 链接，选可编辑的视频时写进它', () => {
  assert.deepEqual(T.inputOptions('transcribe').map((o) => o.label), ['本机文件', 'Space', '链接']);
  assert.deepEqual(T.inputOptions('transcribe')[1].kinds, ['final', 'audio', 'movie']);
  assert.deepEqual(T.inputOptions('translate').map((o) => [o.k, o.label, o.output]),
    [['space', 'Space', 'artifact'], ['file', '本机字幕文件', 'artifact']]);
  assert.equal(T.inputOptions('translate')[0].needs, 'transcript');
  assert.deepEqual(T.inputOptions('translate')[1].accept, ['.srt', '.vtt']);
  assert.deepEqual(T.inputOptions('dub').map((o) => o.k), ['space']);
  assert.deepEqual(T.inputOptions('tts').map((o) => o.k), ['text', 'space']);
  assert.deepEqual(T.sourceOptions('text').map((o) => o.k), ['text'], '文本生成的 Space 文档只作材料，不在来源切换里');
  assert.equal(T.inputOptions('text')[1].attach, true);
  assert.equal(T.outputOf('transcribe', 'link'), 'artifact');
  assert.equal(T.outputOf('transcribe', 'space', 'final'), 'artifact');
  assert.equal(T.outputOf('transcribe', 'space', 'movie'), 'video');
  assert.equal(T.outputOf('translate', 'file'), 'artifact');
  assert.equal(T.outputOf('dub', 'file'), null);
  assert.deepEqual(T.inputOptions('nope'), []);
  assert.deepEqual(T.targetOptions('transcribe').map((x) => x.k), ['none', 'create'], '新建视频是可选项，缺省只生成文稿和字幕');
  assert.equal(T.resultLine('transcribe'), '结果：Space 里的文档与字幕条目；也可以新建视频；选可编辑的视频时写进它');
  assert.equal(T.resultLine('translate'), '结果：Space 里的字幕条目；选可编辑的视频时写进它');
  assert.equal(T.resultLine('dub'), '结果：写进你选的视频');
  assert.equal(T.resultLine('tts'), '结果：Space 里的音频条目');
  assert.equal(T.resultLine('extract'), '结果：Space 里的音频条目');
});

test('下载视频得到文件，不需要视频目标', () => {
  assert.deepEqual(T.inputOptions('link').map((o) => [o.k, o.output]), [['link', 'artifact']]);
  assert.equal(T.outputOf('link', 'link'), 'artifact');
  assert.deepEqual(T.targetOptions('link'), []);
  assert.match(T.resultLine('link'), /视频文件/);
});

test('生成图片卡的状态行念引擎清单：没有可用引擎时指路，有就数', () => {
  const I = global.window.BC_CLOUD_IMAGE;
  const none = I.engines({saved: [], codex: {h: null, on: false}, installed: () => false});
  assert.equal(T.imageStatus(none).on, false);
  const some = I.engines({saved: ['openai'], codex: {h: null, on: false}, installed: () => false});
  assert.equal(T.imageStatus(some).on, true);
});

test('压缩 / 合并两张卡的状态行读 ffmpeg 探测结果', () => {
  assert.deepEqual(T.videoStatus({found: false}), {text: '要先装 ffmpeg', on: false});
  assert.deepEqual(T.videoStatus({found: true, major: 7, version: '7.1'}), {text: 'ffmpeg 7.1 就绪', on: true});
});

test('音色方式与模型：Qwen3 0.6B 预设 / 克隆，1.7B 多描述，OmniVoice 克隆 + 描述同一只权重', () => {
  assert.deepEqual(T.voiceModes('qwen3'), ['preset', 'clone']);
  assert.deepEqual(T.voiceModes('qwen3-1.7b'), ['preset', 'clone', 'describe']);
  assert.deepEqual(T.voiceModes('voxcpm2'), ['clone']);
  assert.deepEqual(T.voiceModes('omnivoice'), ['clone', 'describe']);
  assert.equal(T.modelOf({engine: 'qwen3', mode: 'preset'}), 'qwen3-tts-0.6b-customvoice');
  assert.equal(T.modelOf({engine: 'qwen3', mode: 'describe'}), 'qwen3-tts-0.6b-customvoice', '0.6B 没有描述，非法方式落到首选');
  assert.equal(T.modelOf({engine: 'qwen3-1.7b', mode: 'describe'}), 'qwen3-tts-1.7b-voicedesign');
  assert.deepEqual(T.modelsOf('qwen3'), ['qwen3-tts-0.6b-customvoice', 'qwen3-tts-0.6b-base']);
  assert.deepEqual(T.modelsOf('qwen3-1.7b'), ['qwen3-tts-1.7b-customvoice', 'qwen3-tts-1.7b-base', 'qwen3-tts-1.7b-voicedesign']);
  // 两种方式同一只权重：只算一次（体积、下载都不翻倍）
  assert.deepEqual(T.modelsOf('omnivoice'), ['omnivoice']);
  assert.deepEqual(T.modelsOf('voxcpm2'), ['voxcpm2']);
});

test('模型卡能力标签随引擎变', () => {
  const labels = (e) => T.engineCard(e).tags.map((t) => t.label);
  assert.deepEqual(labels('qwen3'), ['预设音色', '克隆', '风格指令', '中 / 英 / 日 / 韩 等 10 种']);
  assert.deepEqual(labels('qwen3-1.7b'), ['预设音色', '克隆', '风格指令', '描述声音', '中 / 英 / 日 / 韩 等 10 种', '较慢']);
  assert.deepEqual(labels('voxcpm2'), ['需要参考音频', '风格指令', '中 / 英 / 日 / 韩 等 31 种']);
  assert.deepEqual(labels('omnivoice'), ['克隆', '描述声音', '按时长念', '英 / 中 / 德 / 西 等 100 种', '仅限非商用']);
  assert.equal(T.engineCard('omnivoice').tags.find((t) => t.label === '仅限非商用').tone, 'notice');
  assert.deepEqual(labels('indextts2'), ['需要参考音频', '情绪', '中 / 英']);
  assert.deepEqual(labels('gptsovits'), ['需要参考音频', '中 / 英']);
});

test('语言表只列引擎会念的；「自动」时文字语种不支持就拦', () => {
  assert.deepEqual(T.langOptions('indextts2').map((l) => l.code), ['auto', 'zh', 'en']);
  assert.equal(T.langOptions('qwen3').length, 11);
  assert.equal(T.detectLang('こんにちは、世界'), 'ja');
  assert.equal(T.detectLang('你好'), 'zh');
  assert.equal(T.detectLang('Hello'), 'en');
  assert.equal(T.detectLang('  '), null);
  const f = Object.assign(T.blank(), {engine: 'indextts2', mode: 'clone', text: 'おかえりなさい。', ref: {builtin: 'zh-male', name: 'x', dur: 6.16}});
  assert.match(T.langProblem(f), /IndexTTS2 不会念日本語，换 Qwen3-TTS 0.6B 或 Qwen3-TTS 1.7B 或 IndexTTS 2.5/);
  assert.equal(T.langProblem(Object.assign({}, f, {engine: 'indextts25'})), null);
});

test('换引擎：音色方式落到合法值，语言回自动，谁都不强塞参考（各有默认音色）', () => {
  const f = Object.assign(T.blank(), {lang: 'ko', emotion: 'happy'});
  const g = T.switchEngine(f, 'indextts2');
  assert.equal(g.mode, 'clone');
  assert.equal(g.lang, 'auto');
  assert.equal(g.ref, null, '2026-09-21：不给参考就是按语言挑的内置音色');
  const h = T.switchEngine(Object.assign({}, g, {emotion: 'happy'}), 'gptsovits');
  assert.equal(h.emotion, 'none');
  const k = T.switchEngine(T.blank(), 'qwen3-1.7b');
  assert.equal(k.ref, null);
});

test('校验：空文字、超长、缺参考、描述为空、情绪音频', () => {
  const base = T.blank();
  assert.deepEqual(T.validate(base), ['先写要念的文字']);
  assert.deepEqual(T.validate(Object.assign({}, base, {text: '好'})), []);
  assert.match(T.validate(Object.assign({}, base, {text: 'x'.repeat(2001)}))[0], /最多 2000 字/);
  const clone = Object.assign({}, base, {engine: 'gptsovits', mode: 'clone', text: '你好'});
  assert.deepEqual(T.validate(clone), [], '不给参考就是默认音色');
  // 选了「我的音频」还没给文件：这半步要拦
  assert.match(T.validate(Object.assign({}, clone, TTS.pickRef({refText: ''}, 'file')))[0], /先选一段参考音频/);
  assert.deepEqual(T.validate(Object.assign({}, clone, {engine: 'qwen3-1.7b'})), []);
  assert.match(T.validate(Object.assign({}, base, {engine: 'qwen3-1.7b', mode: 'describe', instruct: ' ', text: '你好'}))[0], /描述/);
  const emo = Object.assign({}, clone, {engine: 'indextts2', ref: {name: 'a.wav', dur: 6}, emotion: 'ref2'});
  assert.match(T.validate(emo)[0], /情绪/);
});

test('念法卡：填进风格、顺手带示例文字，再点一次清空', () => {
  const f = T.blank();
  const p = T.pickVibe(f, 'radio');
  assert.equal(p.style, T.VIBES[0].style);
  assert.equal(p.text, T.sampleText(f), '文字框空着就带一段示例');
  const written = Object.assign({}, f, {text: '自己写的一句', style: T.VIBES[0].style});
  assert.deepEqual(T.pickVibe(written, 'radio'), {style: ''}, '同一张再点一次清空');
  assert.equal(T.pickVibe(written, 'news').text, undefined, '写过字就不覆盖');
  assert.equal(T.vibeOf(T.VIBES[2].style).k, 'bedtime');
  assert.equal(T.vibeOf('自己想的一句语气'), null);
  const rolled = T.rollVibe(Object.assign({}, written, {text: 'x'}), () => 0);
  assert.notEqual(rolled.style, T.VIBES[0].style, '「换一个」不会换到当前这张');
  assert.equal(T.rollPreset('Vivian', () => 0), 'Serena');
});

test('开页落到已装模型，没装的指一只装好的替代', () => {
  const none = () => false;
  assert.equal(T.preferredForm(none).engine, 'qwen3', '一个都没装还是默认那只');
  assert.equal(T.installedAlternative(T.blank(), none), null);
  const only = (id) => id === 'qwen3-tts-0.6b-customvoice';
  assert.equal(T.preferredForm(only).engine, 'qwen3');
  assert.equal(T.installedAlternative(T.blank(), only), null, '装好了就没有替代一说');

  const idx = (id) => id === 'indextts2';
  const pref = T.preferredForm(idx);
  assert.equal(pref.engine, 'indextts2');
  assert.equal(pref.mode, 'clone');
  assert.equal(pref.ref, null, '不带参考也能念：默认音色按语言挑');
  const far = T.installedAlternative(T.blank(), idx);
  assert.deepEqual([far.engine, far.mode, far.switched], ['indextts2', 'clone', true]);

  const big = (id) => id === 'qwen3-tts-1.7b-customvoice';
  const near = T.installedAlternative(T.blank(), big);
  assert.deepEqual([near.engine, near.mode, near.switched], ['qwen3-1.7b', 'preset', false], '同一种音色方式优先');
});

test('字数行、示例句、音色短名', () => {
  assert.equal(T.textStats(''), '0 / 2000 字');
  assert.match(T.textStats('你好。再见。'), /^6 \/ 2000 字 · 2 段 · 约 /);
  assert.equal(T.sampleText(Object.assign(T.blank(), {lang: 'en'})), TTS.sampleLine('en', 'intro').text);
  assert.equal(T.voiceLabel({mode: 'preset', preset: 'Eric'}), 'Eric');
  assert.equal(T.voiceLabel({mode: 'clone', ref: null, lang: 'zh'}), '默认音色 · 中文女声');
  assert.equal(T.voiceLabel({mode: 'clone', ref: {builtin: 'ja-male', name: 'x'}}), '日语男声');
  assert.equal(T.voiceLabel({mode: 'describe', instruct: TTS.DESCRIBE_VOICES[1].instruct}), '沉稳男声');
});

test('生成记录：命名、元数据、一次只跑一条', () => {
  const r = T.makeRecord(Object.assign(T.blank(), {text: '欢迎回来。', engine: 'gptsovits', mode: 'clone', ref: {builtin: 'zh-male', name: 'x', dur: 6.16}}), 7);
  assert.equal(r.name, '语音-007.wav');
  assert.equal(r.rate, 32000);
  assert.equal(T.recordMeta(r), `00:0${Math.round(r.dur)} · 32 kHz · GPT-SoVITS · 中文男声 · 简体中文`);
  assert.match(T.recordMeta(Object.assign({}, r, {rate: 22050})), /22\.05 kHz/);
  const list = [{id: 'a', seq: 1, status: 'done'}, {id: 'b', seq: 3, status: 'queued'}, {id: 'c', seq: 2, status: 'queued'}];
  assert.equal(T.nextQueued(list).id, 'c');
  assert.equal(T.nextQueued(list.concat([{id: 'd', seq: 4, status: 'running'}])), null);
  assert.equal(T.aheadOf(list, 'b'), 1);
});

test('生成语音卡状态行按已装模型数', () => {
  assert.equal(T.ttsStatus(() => false).text, '10 个语音模型可下载');
  assert.equal(T.ttsStatus((id) => id === 'indextts2').text, '已装 1 / 10 个语音模型');
});

test('自建 API 提供方（留的口子）：登记后只凭 cloud:<id> 就能出卡、语言、上限与记录', () => {
  const C = window.BC_CLOUD_TTS;
  const p = C.customProvider({id: 'custom-9', name: '自家 TTS', url: 'https://tts.example.com/v1', models: ['kokoro-v1'], voices: 'af_bella, am_adam'});
  const engine = 'cloud:custom-9';
  const card = T.engineCard(engine, true);
  assert.equal(card.name, '自家 TTS');
  assert.ok(card.tags.some((t) => /OpenAI-compatible/.test(t.label)), JSON.stringify(card.tags));
  assert.equal(T.langOptions(engine, false, 'cloud:custom-9/kokoro-v1').length, 12 + 1);   // 常用 12 种 + 自动
  const f = T.switchEngine(T.blank(), engine);
  assert.equal(T.modelOf(f), 'cloud:custom-9/kokoro-v1');
  assert.equal(T.maxChars(f), 4096);
  assert.equal(T.voiceLabel(Object.assign({}, f, {text: 'hello'}), []), '默认音色 · af_bella');
  const r = T.makeRecord(Object.assign({}, f, {text: 'Hello there'}), 7, []);
  assert.equal(r.provider, '自家 TTS');
  assert.equal(r.chars, 11);
  assert.equal(r.engineName, '自家 TTS · kokoro-v1');
  assert.equal(T.ttsStatus(() => false, ['custom-9']).text, '10 个语音模型可下载 · 1 家云端已连接');
  assert.ok(T.validate(Object.assign({}, f, {text: 'hi'}), {voices: [], saved: ['custom-9']}).length === 0);
  assert.equal(C.engines(['custom-9']).length, 1, 'engines 不带 extra 也认登记过的自建');
  assert.equal(p.custom, true);
});
