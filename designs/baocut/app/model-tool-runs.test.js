const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-languages.js');
require('./model-tts.js');
require('./model-tools.js');
require('./model-tool-runs.js');
const R = global.window.BC_TOOL_RUNS;

const labels = (tool, o) => R.plan(tool, o).map((s) => s.label);

test('步骤表照首批流程（architecture §7.9）', () => {
  assert.deepEqual(labels('transcribe', {input: 'file'}), ['转写', '保存文稿和字幕'], '文件缺省不建视频，产出文档与字幕');
  assert.deepEqual(labels('transcribe', {input: 'link'}), ['解析链接', '下载媒体', '校验可解码', '放进 Space', '转写', '保存文稿和字幕']);
  assert.deepEqual(labels('transcribe', {input: 'file', target: 'create'}), ['新建视频', '转写', '应用文稿', '建立字幕层']);
  assert.deepEqual(labels('transcribe', {input: 'link', target: 'create'}), ['解析链接', '下载媒体', '校验可解码', '新建视频', '转写', '应用文稿', '建立字幕层']);
  assert.deepEqual(labels('transcribe', {input: 'video'}), ['打开视频', '转写', '应用文稿', '建立字幕层']);
  /* 已有文稿的视频按落点（product-design §5.11）：新建视频 / 换用文稿 */
  assert.deepEqual(labels('transcribe', {input: 'video', target: 'first'}), ['打开视频', '转写', '应用文稿', '建立字幕层']);
  assert.deepEqual(labels('transcribe', {input: 'video', target: 'new-video'}), ['新建视频', '转写', '应用文稿', '建立字幕层']);
  assert.deepEqual(labels('transcribe', {input: 'video', target: 'replace', diarize: true}), ['打开视频', '转写', '识别说话人', '换用文稿', '结转译文与字幕']);
  assert.deepEqual(labels('translate', {input: 'video'}), ['打开视频', '逐批翻译', '核对译文', '应用译文', '建立字幕层']);
  assert.deepEqual(labels('translate', {input: 'file'}), ['逐批翻译', '核对译文', '保存字幕文件']);
  assert.deepEqual(labels('dub', {input: 'video', translate: true}), ['打开视频', '逐批翻译', '核对译文', '逐句合成', '时间对齐', '应用配音']);
  assert.deepEqual(labels('dub', {input: 'video'}), ['打开视频', '核对译文', '逐句合成', '时间对齐', '应用配音']);
});

test('下载视频可选转录为文稿和字幕，不创建视频', () => {
  assert.deepEqual(labels('link', {}), ['解析链接', '下载媒体', '校验可解码', '放进 Space']);
  assert.deepEqual(labels('link', {transcribe: true}).slice(-2), ['转写', '保存文稿和字幕']);
  assert.equal(R.create('link', {}).input, 'link');
});

test('推进：一步满了记完成、下一步开始，并报出刚完成的步骤', () => {
  let run = R.create('transcribe', {input: 'file', target: 'create'});
  assert.equal(run.steps[0].status, 'running');
  assert.equal(R.phase(run), '正在新建视频 · 第 1 / 4 步');
  let r = R.advance(run, 60);
  assert.equal(r.finished, null);
  assert.equal(R.pct(r.run), 15);
  r = R.advance(r.run, 60);
  assert.equal(r.finished, 'create');
  assert.equal(r.run.cur, 1);
  assert.equal(r.run.steps[1].status, 'running');
  assert.equal(R.pct(r.run), 25);
  run = r.run;
  const seen = [];
  while (run.status === 'running') { const x = R.advance(run, 50); if (x.finished) seen.push(x.finished); run = x.run; }
  assert.deepEqual(seen, ['asr', 'applyTx', 'layer']);
  assert.equal(run.status, 'done');
  assert.equal(R.pct(run), 100);
  assert.equal(R.advance(run, 10).run, run, '完成之后不再推进');
});

test('失败停在那一步，重试从那一步开始，已完成的步骤保留', () => {
  let run = R.create('translate', {input: 'video'});
  run = R.advance(run, 100).run;               // 打开视频 完成
  run = R.advance(run, 40).run;                // 逐批翻译 40%
  run = R.fail(run, '模型没有返回');
  assert.equal(run.status, 'failed');
  assert.equal(run.steps[0].status, 'done');
  assert.equal(run.steps[1].status, 'failed');
  assert.equal(R.phase(run), '停在「逐批翻译」· 第 2 / 5 步');
  const patch = R.taskPatch(run);
  assert.equal(patch.status, 'error');
  assert.equal(patch.error, '模型没有返回');
  assert.equal(R.advance(run, 10).run, run, '失败的运行不再推进');
  run = R.retry(run);
  assert.equal(run.status, 'running');
  assert.equal(run.attempt, 2);
  assert.equal(run.cur, 1);
  assert.equal(run.steps[0].status, 'done', '完成的步骤不重做');
  assert.equal(run.steps[1].pct, 0, '失败的那一步从头再跑');
  assert.equal(R.taskPatch(run).status, 'running');
  assert.equal(R.retry(run), run, '只有失败的运行能重试');
});

test('结果页每个产物接着做什么（product-design §2.7「结果与下一步」）', () => {
  const ids = (kind, tool) => R.followUps({id: 'x', kind}, tool).map((n) => [n.id, n.kind]);
  assert.deepEqual(ids('subtitle'), [['translate', 'tool'], ['tts', 'tool'], ['new-movie', 'action']]);
  assert.deepEqual(ids('doc'), [['tts', 'tool'], ['new-movie', 'action']], '翻译字幕不收文档，不列');
  ['audio', 'image', 'final'].forEach((k) => assert.deepEqual(ids(k), [['new-movie', 'action'], ['add-to-movie', 'action']], k));
  assert.deepEqual(ids('movie', 'transcribe'), [['open-movie', 'action'], ['translate', 'tool'], ['dub', 'tool']]);
  assert.deepEqual(ids('movie', 'translate'), [['open-movie', 'action'], ['dub', 'tool']], '译文之后是翻译配音');
  assert.deepEqual(ids('movie', 'dub'), [['open-movie', 'action']]);
  assert.deepEqual(R.followUps(null), []);
  assert.equal(R.followUps({kind: 'subtitle'})[0].label, '翻译字幕');
  assert.equal(R.opensMovie('translate', 'file'), false);
  assert.equal(R.opensMovie('translate', 'video'), true);
  assert.equal(R.opensMovie('transcribe', 'link'), false);
  assert.equal(R.opensMovie('transcribe', 'link', {target: 'create'}), true);
  assert.equal(R.opensMovie('link', 'link', {transcribe: true}), false);
});

test('任务记录带产物与保存位置：outputs 是条目 id 列表，saveDir 是保存目录', () => {
  let run = R.create('transcribe', {input: 'file', saveDir: '~/Downloads'});
  assert.deepEqual(R.taskPatch(run).outputs, []);
  assert.equal(R.taskPatch(run).saveDir, '~/Downloads');
  run = R.withOutputs(run, ['tool-doc-tr1', 'tool-subtitle-tr1', 'tool-doc-tr1', null]);
  assert.deepEqual(R.taskPatch(run).outputs, ['tool-doc-tr1', 'tool-subtitle-tr1'], '去重、保持先后');
  assert.equal(R.taskPatch(R.create('dub', {input: 'video'})).saveDir, null, '写进已有视频的运行没有保存位置');
  assert.deepEqual(R.outputsPatch([{id: 'tool-audio-g1'}, 'tool-image-i2', null], '~/Movies'), {outputs: ['tool-audio-g1', 'tool-image-i2'], saveDir: '~/Movies'});
  assert.deepEqual(R.outputsPatch(null), {outputs: [], saveDir: null});
});

test('当场授权：说清发什么、发给谁、预计多少钱；同意过的不再问', () => {
  assert.deepEqual(R.parsePrice('$0.006 / 分钟'), {currency: '$', amount: 0.006, unit: '分钟'});
  assert.equal(R.parsePrice(''), null);
  const a = R.need({recipient: '云端识别', data: 'audio', seconds: 206, price: '$0.006 / 分钟'});
  assert.equal(a.key, '云端识别:audio');
  assert.equal(a.what, '这段素材的音轨，约 4 分钟');
  assert.equal(a.cost, '约 $0.02（$0.006 / 分钟）');
  const t = R.need({recipient: '云端文本', data: 'transcript', chars: 2480});
  assert.equal(t.data, '文稿');
  assert.equal(t.what, '文稿文字，约 2,480 字');
  assert.match(t.cost, /按云端文本的价目计费/);
  assert.match(R.need({recipient: 'Anthropic', data: 'transcript', chars: 10}).cost, /按 Anthropic 的价目计费/);
  assert.deepEqual(R.grantNeeds([a, t, a, null], ['云端文本:transcript']).map((n) => n.key), ['云端识别:audio']);
  assert.deepEqual(R.grantNeeds([a], (k) => k === a.key), []);
});

test('开了识别说话人、模型又不自带区分时，转写之后单列一步', () => {
  assert.deepEqual(labels('transcribe', {input: 'file', diarize: true, target: 'create'}), ['新建视频', '转写', '识别说话人', '应用文稿', '建立字幕层']);
  assert.deepEqual(labels('transcribe', {input: 'file', diarize: true}), ['转写', '识别说话人', '保存文稿和字幕']);
  assert.deepEqual(labels('transcribe', {input: 'video', diarize: false}), ['打开视频', '转写', '应用文稿', '建立字幕层']);
  // 从链接导入的「下载后转录」没有这只开关
  assert.deepEqual(labels('link', {transcribe: true, diarize: true}).slice(-2), ['转写', '保存文稿和字幕']);
});

test('识别说话人开关：自带的锁开，在线服务不区分的锁关，要说话人区分包的没拨过时随装没装', () => {
  const none = () => false;
  const all = () => true;
  const moss = {id: 'moss-transcribe', name: 'MOSS Transcribe', speakers: 'builtin'};
  const whisper = {id: 'whisper-large-v3', name: 'Whisper large-v3', speakers: 'pack'};
  const openai = {id: 'whisper-1', name: 'whisper-1', provider: 'OpenAI'};
  const scribe = {id: 'cloud:elevenlabs/scribe_v2', name: 'scribe_v2', provider: 'ElevenLabs', speakers: 'builtin'};
  assert.deepEqual(R.speakerSwitch(moss, false, none), {kind: 'builtin', on: true, locked: true, missing: false, step: false});
  assert.equal(R.speakerSwitch(scribe, null, none).kind, 'builtin');
  assert.deepEqual(R.speakerSwitch(openai, true, all), {kind: 'none', on: false, locked: true, missing: false, step: false});
  // 没拨过：装了就开、没装就关——不让一个没下载的包挡住开始
  assert.deepEqual(R.speakerSwitch(whisper, null, all), {kind: 'pack', on: true, locked: false, missing: false, step: true});
  assert.deepEqual(R.speakerSwitch(whisper, null, none), {kind: 'pack', on: false, locked: false, missing: false, step: false});
  // 拨开了又没装 → 缺模型；拨关了就不管装没装
  assert.deepEqual(R.speakerSwitch(whisper, true, none), {kind: 'pack', on: true, locked: false, missing: true, step: true});
  assert.equal(R.speakerSwitch(whisper, false, all).on, false);
  assert.equal(R.speakerSwitch(whisper, true, (id) => id === R.DIARIZE_PACK).missing, false);
  // 本机模型缺 speakers 字段按要包处理
  assert.equal(R.speakerSwitch({id: 'x-local', name: 'X'}, true, none).kind, 'pack');
});

test('识别说话人的说明与折叠标题', () => {
  const pack = {id: 'speaker-diarization', name: '说话人区分', size: 5.7};
  const moss = {id: 'moss-transcribe', speakers: 'builtin'};
  const whisper = {id: 'whisper-large-v3', speakers: 'pack'};
  assert.deepEqual(R.speakerCopy(R.speakerSwitch(moss, null, () => false), 'MOSS Transcribe', pack),
    {note: 'MOSS Transcribe 自带说话人区分，转录时一起完成', summary: '识别说话人 · 模型自带'});
  assert.deepEqual(R.speakerCopy(R.speakerSwitch(whisper, true, () => false), 'Whisper large-v3', pack),
    {note: '要先下载「说话人区分」（5.7 MB），下完才能区分说话人', summary: '识别说话人 · 要先下载模型'});
  assert.equal(R.speakerCopy(R.speakerSwitch(whisper, null, () => false), 'Whisper large-v3', pack).summary, '不识别说话人');
  assert.equal(R.speakerCopy(R.speakerSwitch({id: 'whisper-1', provider: 'OpenAI'}, null, () => true), 'whisper-1', pack).note,
    'whisper-1 不区分说话人；需要时换一只本机模型，或自带区分的服务');
});
