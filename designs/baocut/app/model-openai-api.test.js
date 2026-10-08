/* OpenAI 兼容 API 纯模型：与 OpenAI 相同的路径、模型现场、模型解析与映射（设计稿 §3）、独立端口校验、试用区、代码片段、演示响应。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
const A = require('./model-openai-api.js');

const MODELS = [
  {id: 'moss-transcribe', name: 'MOSS Transcribe'},
  {id: 'whisper-large-v3', name: 'Whisper large-v3'},
  {id: 'speaker-diarization', name: '说话人区分', pack: true},
  {id: 'qwen3-tts-0.6b-customvoice', name: 'Qwen3-TTS CustomVoice', cat: 'tts'},
  {id: 'qwen3-tts-0.6b-base', name: 'Qwen3-TTS Base', cat: 'tts'},
  {id: 'htdemucs-ft', name: 'HTDemucs-FT', cat: 'sep'},
  {id: 'qwen-image-2.1', name: 'Qwen-Image-2.1', cat: 'image'},
];
const on = (ids) => (id) => ids.indexOf(id) >= 0;
const ALL = ['moss-transcribe', 'whisper-large-v3', 'speaker-diarization', 'qwen3-tts-0.6b-customvoice', 'qwen3-tts-0.6b-base', 'htdemucs-ft'];
const ctxWith = (ids, api, defaults) => A.ctxOf(MODELS, on(ids), defaults || {asr: 'whisper-large-v3'}, api || {});

test('三类能力，路径与 OpenAI 相同，只有主机和端口不同', () => {
  assert.deepEqual(A.CAPS.map((c) => c.k), ['asr', 'tts', 'image']);
  assert.deepEqual(A.ENDPOINTS.map((e) => `${e.method} ${e.path}`), [
    'GET /models', 'GET /models/{model}', 'POST /audio/transcriptions', 'POST /audio/speech', 'POST /images/generations']);
  assert.equal(A.apiBase(24320), 'http://127.0.0.1:24320/v1');
  assert.equal(A.apiBase(), 'http://127.0.0.1:24320/v1');
  assert.equal(A.epUrl(A.apiBase(24321), A.epBy('asr.transcriptions')), 'http://127.0.0.1:24321/v1/audio/transcriptions');
  assert.equal(A.epUrl(A.apiBase(), A.epBy('models.retrieve'), {model: 'whisper-1'}), 'http://127.0.0.1:24320/v1/models/whisper-1');
  assert.equal(A.epUrl(A.apiBase(), A.epBy('models.retrieve'), {}), 'http://127.0.0.1:24320/v1/models/{model}');
  // model 在识别与合成上必填，出图可不写；错误码都有状态、类型与人话
  assert.ok(A.epBy('asr.transcriptions').params.find((p) => p.name === 'model').req);
  assert.ok(A.epBy('tts.speech').params.find((p) => p.name === 'model').req);
  assert.ok(A.epBy('image.generations').params.find((p) => p.name === 'model').optionalModel);
  A.ENDPOINTS.forEach((e) => e.errors.forEach((code) => assert.equal(A.ERRORS[code].length, 3, `${e.id} ${code}`)));
  // 能力端点带 capability_disabled，/models 两条不带
  assert.ok(A.epBy('tts.speech').errors.indexOf('capability_disabled') >= 0);
  assert.ok(A.epBy('models.list').errors.indexOf('capability_disabled') < 0);
});

test('模型现场：只取三类、已下载、不是依赖包的；默认按本地模型页，缺了取第一只', () => {
  const ctx = ctxWith(ALL);
  assert.deepEqual(ctx.ready.asr.map((m) => m.id), ['moss-transcribe', 'whisper-large-v3']);
  assert.equal(ctx.dflt.asr.id, 'whisper-large-v3');
  assert.equal(ctx.dflt.tts.id, 'qwen3-tts-0.6b-customvoice');
  assert.equal(ctx.dflt.image, null);
  assert.ok(!ctx.byId['htdemucs-ft'], '分离不在 API 里');
  assert.ok(!ctx.byId['speaker-diarization']);
});

test('解析：本机 id 直接用；未下载、认不出都是 404；另一类是 400；缺 model 是 400，出图可省', () => {
  const ctx = ctxWith(['moss-transcribe', 'qwen3-tts-0.6b-customvoice']);
  assert.equal(A.resolveModel('moss-transcribe', 'asr', ctx).via, 'exact');
  assert.equal(A.resolveModel('whisper-large-v3', 'asr', ctx).error, 'model_not_found'); // 目录里有、没下载
  assert.equal(A.resolveModel('whisper-2', 'asr', ctx).error, 'model_not_found');
  assert.equal(A.resolveModel('Whisper-1', 'asr', ctx).error, 'model_not_found', '大小写敏感');
  const wrong = A.resolveModel('qwen3-tts-0.6b-customvoice', 'asr', ctx);
  assert.equal(wrong.error, 'model_wrong_capability');
  assert.equal(A.ERRORS[wrong.error][0], 400);
  assert.equal(A.resolveModel('', 'asr', ctx).error, 'invalid_request');
  assert.equal(A.resolveModel('', 'image', ctx, true).error, 'model_not_found');
  const withImg = ctxWith(['qwen-image-2.1']);
  assert.equal(A.resolveModel('', 'image', withImg, true).model.id, 'qwen-image-2.1');
  assert.equal(A.resolveModel('', 'image', withImg, true).via, 'default');
});

test('映射：预置名落到默认；多对多；按顺序取第一只已下载的；没指向这一类是 404', () => {
  const ctx = ctxWith(ALL);
  const w = A.resolveModel('whisper-1', 'asr', ctx);
  assert.equal(w.via, 'map');
  assert.equal(w.alias, 'whisper-1');
  assert.equal(w.model.id, 'whisper-large-v3');
  assert.equal(A.resolveModel('whisper-1', 'tts', ctx).error, 'model_not_found');
  // 一个名字指向两类；列表里先写没下载的，跳过它
  const api = {modelMap: [{name: 'local', to: ['qwen-image-2.1', 'moss-transcribe', 'default:tts']}, {name: 'x-tts', to: ['qwen3-tts-0.6b-base']}]};
  const c2 = ctxWith(ALL, api);
  assert.equal(A.resolveModel('local', 'asr', c2).model.id, 'moss-transcribe');
  assert.equal(A.resolveModel('local', 'tts', c2).model.id, 'qwen3-tts-0.6b-customvoice');
  assert.equal(A.resolveModel('local', 'image', c2).error, 'model_not_found');
  // 一只模型挂两个名字
  assert.equal(A.resolveModel('x-tts', 'tts', c2).model.id, 'qwen3-tts-0.6b-base');
  // 用户改过映射后预置不再生效
  assert.equal(A.resolveModel('whisper-1', 'asr', c2).error, 'model_not_found');
  // 空表：只剩本机 id
  assert.equal(A.resolveModel('tts-1', 'tts', ctxWith(ALL, {modelMap: []})).error, 'model_not_found');
});

test('映射校验：空名、空格、重名、与本机 id 同名、没有目标；有问题的行不生效', () => {
  const rows = [{name: '', to: ['default:asr']}, {name: 'a b', to: ['default:asr']}, {name: 'dup', to: ['default:asr']},
    {name: 'dup', to: ['default:tts']}, {name: 'moss-transcribe', to: ['default:asr']}, {name: 'empty', to: []}, {name: 'ok', to: ['default:tts']}];
  const ctx = ctxWith(ALL, {modelMap: rows});
  const issues = A.mapIssues(rows, ctx);
  assert.deepEqual(issues.map((x) => x && x.field), ['name', 'name', null, 'name', 'name', 'to', null]);
  assert.deepEqual(ctx.map.map((r) => r.name), ['dup', 'ok']);
  assert.equal(A.resolveModel('dup', 'tts', ctx).error, 'model_not_found', '重名的第二行不生效');
});

test('映射摘要与目标：每一类落到哪只；默认目标跟着本地模型页走；目录里没了的目标', () => {
  const ctx = ctxWith(['moss-transcribe']);
  const row = {name: 'mix', to: ['whisper-large-v3', 'default:asr', 'default:tts', 'gone-model']};
  const s = A.mapSummary(row, ctx);
  assert.deepEqual(s.map((x) => [x.cap, x.model && x.model.id]), [['asr', 'moss-transcribe'], ['tts', null]]);
  assert.equal(s[1].why, '还没有下载语音合成模型');
  assert.equal(A.targetInfo('default:asr', ctx).label, '默认模型');
  assert.ok(/MOSS/.test(A.targetInfo('default:asr', ctx).sub));
  assert.equal(A.targetInfo('whisper-large-v3', ctx).ready, false);
  assert.equal(A.targetInfo('gone-model', ctx).cap, null);
  assert.deepEqual(A.targetsOf('asr', ctx).map((t) => t.id), ['default:asr', 'moss-transcribe', 'whisper-large-v3']);
  assert.equal(A.mapRows({}).length, A.MAP_SEED.length);
  assert.notStrictEqual(A.mapRows({})[0].to, A.MAP_SEED[0].to, '拷贝，不共享数组');
});

test('/models：已下载模型 + 能落地的映射名；独立端口只列那一类', () => {
  const ctx = ctxWith(['moss-transcribe', 'qwen3-tts-0.6b-customvoice']);
  const ids = A.listModels(ctx).map((m) => m.id);
  assert.ok(ids.indexOf('moss-transcribe') >= 0 && ids.indexOf('whisper-1') >= 0 && ids.indexOf('tts-1') >= 0);
  assert.ok(ids.indexOf('gpt-image-1') < 0, '图像没下载，映射名不列');
  assert.deepEqual(A.listModels(ctx).find((m) => m.id === 'whisper-1').x_baocut.mapsTo, {asr: 'moss-transcribe'});
  const asrOnly = A.listModels(ctx, 'asr').map((m) => m.id);
  assert.ok(asrOnly.indexOf('tts-1') < 0 && asrOnly.indexOf('qwen3-tts-0.6b-customvoice') < 0);
  // 一只都没下载时是空列表
  assert.deepEqual(A.demoResponse(A.epBy('models.list'), {}, ctxWith([])).body.json, {object: 'list', data: []});
  // 查一只：映射名 200、未下载 404
  const got = A.demoResponse(A.epBy('models.retrieve'), {model: 'whisper-1'}, ctx);
  assert.equal(got.status, 200);
  assert.equal(A.demoResponse(A.epBy('models.retrieve'), {model: 'whisper-large-v3'}, ctx).status, 404);
});

test('独立端口：建议值、范围、与 Web / 远端算力 / MCP / 其他类冲突', () => {
  assert.equal(A.suggestPort('asr', 24320), 24321);
  assert.equal(A.suggestPort('image', 24320), 24323);
  assert.deepEqual(A.parseCapPort('24321', 'asr', 24320, {}), {port: 24321});
  assert.ok(A.parseCapPort('80', 'asr', 24320, {}).error);
  assert.ok(A.parseCapPort('24320', 'asr', 24320, {}).error);
  assert.ok(/远端算力/.test(A.parseCapPort('24350', 'asr', 24320, {}).error));
  assert.ok(/MCP/.test(A.parseCapPort('24351', 'asr', 24320, {}).error));
  assert.ok(/语音合成/.test(A.parseCapPort('24322', 'asr', 24320, {tts: 24322}).error));
  assert.deepEqual(A.parseCapPort('24322', 'tts', 24320, {tts: 24322}), {port: 24322});
});

test('试用区：挡板顺序；没下载模型不挡（演示 404）；model 初值取映射名', () => {
  const base = {cap: 'asr', apiOn: true, capOn: true, svcOn: true};
  assert.equal(A.blocker({...base, apiOn: false}).action, 'api');
  assert.equal(A.blocker({...base, capOn: false}).action, 'cap');
  assert.equal(A.blocker({...base, svcOn: false}).action, 'start');
  assert.equal(A.blocker(base), null);
  assert.equal(A.blocker({cap: null, apiOn: true, capOn: false, svcOn: true}), null, '/models 没有能力开关');
  const ctx = ctxWith(ALL);
  assert.equal(A.initialValues(A.epBy('asr.transcriptions'), ctx).model, 'whisper-1');
  assert.equal(A.initialValues(A.epBy('image.generations'), ctx).model, '', '出图不写 model');
  assert.equal(A.suggestModel('asr', ctxWith(ALL, {modelMap: []})), 'whisper-large-v3');
  const ch = A.modelChoices('tts', ctx);
  assert.deepEqual(ch.local.map((m) => m.id), ['qwen3-tts-0.6b-customvoice', 'qwen3-tts-0.6b-base']);
  assert.deepEqual(ch.named.map((m) => m.id), ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']);
});

test('按模型收哪些字段：CustomVoice 看 voice 与指令，Base 收参考音频', () => {
  const p = (n) => A.epBy('tts.speech').params.find((x) => x.name === n);
  assert.equal(A.ttsSupport('qwen3-tts-0.6b-customvoice').voice, 'preset');
  assert.ok(A.supports(p('instructions'), 'qwen3-tts-1.7b-voicedesign'));
  assert.ok(!A.supports(p('reference_audio'), 'qwen3-tts-0.6b-customvoice'));
  assert.ok(A.supports(p('reference_audio'), 'index-tts2.5'));
  assert.ok(!A.supports(p('reference_text'), 'indextts2'));
  assert.ok(A.supports(p('reference_text'), 'omnivoice'));
  assert.ok(A.supports(p('input'), 'anything'));
});

test('代码片段：model 照写；扩展字段 Python 走 extra_body；GET 带路径参数', () => {
  const ctx = ctxWith(ALL);
  const ep = A.epBy('asr.transcriptions');
  const v = {...A.initialValues(ep, ctx), response_format: 'srt'};
  const base = A.apiBase(24320);
  const c = A.curl(ep, base, v, '');
  assert.ok(c.startsWith('curl http://127.0.0.1:24320/v1/audio/transcriptions'));
  assert.ok(c.indexOf('-F model=whisper-1') > 0 && c.indexOf('-F response_format=srt') > 0);
  assert.ok(c.indexOf('Authorization') < 0);
  assert.ok(A.curl(ep, base, v, 'sk-1').indexOf('Bearer sk-1') > 0);
  const py = A.snippet('python', ep, base, v, '');
  assert.ok(py.indexOf('base_url="http://127.0.0.1:24320/v1"') > 0 && py.indexOf('model="whisper-1"') > 0);
  const tts = A.epBy('tts.speech');
  const tv = {...A.initialValues(tts, ctx), language: 'zh', reference_audio: {name: 'ref.wav'}};
  const tpy = A.snippet('python', tts, base, tv, '');
  assert.ok(/extra_body=\{"language": "zh", "reference_audio": base64\.b64encode/.test(tpy), tpy);
  assert.ok(tpy.startsWith('import base64'));
  assert.ok(A.snippet('js', tts, base, tv, '').indexOf('reference_audio: fs.readFileSync("ref.wav").toString("base64")') > 0);
  assert.ok(A.curl(tts, base, tv, '').indexOf('-o speech.mp3') > 0);
  const get = A.epBy('models.retrieve');
  assert.equal(A.curl(get, base, {model: 'tts-1'}, ''), 'curl http://127.0.0.1:24320/v1/models/tts-1');
  assert.ok(A.snippet('python', get, base, {model: 'tts-1'}, '').indexOf('client.models.retrieve("tts-1")') > 0);
  // 出图不写 model 时片段里也不写
  const img = A.epBy('image.generations');
  assert.ok(A.snippet('python', img, base, A.initialValues(img, ctx), '').indexOf('model=') < 0);
  assert.equal(A.maskKey('bcs_abcdefgh1234'), '••••••••1234');
});

test('演示响应：状态码与错误体照 OpenAI 的形状', () => {
  const ctx = ctxWith(['moss-transcribe', 'qwen3-tts-0.6b-customvoice', 'qwen-image-2.1']);
  const asr = A.epBy('asr.transcriptions');
  const ok = A.demoResponse(asr, {...A.initialValues(asr, ctx), response_format: 'srt'}, ctx);
  assert.equal(ok.status, 200);
  assert.equal(ok.model, 'moss-transcribe');
  assert.equal(ok.alias, 'whisper-1');
  assert.ok(ok.body.text.startsWith('1\n00:00:00,000 --> 00:00:03,200'));
  const nf = A.demoResponse(asr, {...A.initialValues(asr, ctx), model: 'whisper-2'}, ctx);
  assert.equal(nf.status, 404);
  assert.deepEqual(Object.keys(nf.body.json.error).sort(), ['code', 'message', 'param', 'type']);
  assert.equal(nf.body.json.error.code, 'model_not_found');
  assert.equal(nf.body.json.error.type, 'invalid_request_error');
  assert.equal(A.demoResponse(asr, {...A.initialValues(asr, ctx), model: ''}, ctx).status, 400);
  assert.equal(A.demoResponse(asr, {...A.initialValues(asr, ctx), response_format: 'diarized_json'}, ctx).status, 400);
  // 合成：CustomVoice 收参考音频 → 400；不收的指令忽略并说明
  const tts = A.epBy('tts.speech');
  const tv = A.initialValues(tts, ctx);
  assert.equal(A.demoResponse(tts, {...tv, reference_audio: {name: 'ref.wav'}}, ctx).body.json.error.code, 'unsupported_param');
  const said = A.demoResponse(tts, {...tv, voice: 'alloy'}, ctx);
  assert.equal(said.status, 200);
  assert.ok(/默认音色/.test(said.meta));
  assert.ok(/Vivian/.test(A.demoResponse(tts, {...tv, voice: 'Vivian'}, ctx).meta));
  // 出图：不写 model 用默认；不合规尺寸给建议；url / 透明底 / n>1 都是 unsupported_param
  const img = A.epBy('image.generations');
  const iv = A.initialValues(img, ctx);
  const good = A.demoResponse(img, iv, ctx);
  assert.equal(good.status, 200);
  assert.equal(good.model, 'qwen-image-2.1');
  assert.equal(good.body.json.x_baocut.license, 'non-commercial');
  assert.equal(good.body.json.size, '1024x576', 'auto = 模型缺省尺寸（与内核 resolve_size 一致）');
  const bad = A.demoResponse(img, {...iv, size: '1000x1000'}, ctx);
  assert.equal(bad.body.json.error.code, 'invalid_size');
  assert.ok(/`992x992`/.test(bad.body.json.error.message));
  assert.ok(/`auto` \(1024x576\)/.test(bad.body.json.error.message));
  ['response_format:url', 'background:transparent', 'output_format:webp', 'n:2'].forEach((kv) => {
    const [k, val] = kv.split(':');
    assert.equal(A.demoResponse(img, {...iv, [k]: val}, ctx).body.json.error.code, 'unsupported_param', kv);
  });
  assert.equal(A.fmtMs(640), '640 ms');
  assert.equal(A.fmtMs(2400), '2.4 s');
});
