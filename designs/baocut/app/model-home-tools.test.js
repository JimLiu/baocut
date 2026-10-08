const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./model-home-tools.js');
const N = require('./model-newproject.js');
const HT = require('./model-home-templates.js');
const tpl = (k) => ({title: HT.get(k).title});
test('Home template travels with the message without replacing user text', () => {
  const text = '介绍旅行水杯';
  const prompt = N.homePrompt(text, tpl('product-showcase'), {});
  assert.ok(prompt.startsWith(text));
  assert.match(prompt, /模板：产品展示/);
  assert.ok(!prompt.includes(HT.prompt(HT.get('product-showcase')).slice(0, 12)), 'the template body is spliced by the Runtime, not the client');
  assert.equal(N.homePrompt(text, null, {}), text);
  assert.match(N.homePrompt('', null, {attachments: 1}), /附上的材料/);
  assert.doesNotMatch(N.homePrompt(text, tpl('knowledge-explainer'), {}), /产品展示/);
});
test('Tool output identities are stable and do not collide across kinds', () => {
  const rec = {id: '1', name: '语音.wav', dur: 12};
  assert.equal(T.output('audio', rec).id, T.output('audio', rec).id);
  assert.notEqual(T.output('audio', rec).id, T.output('image', rec).id);
  assert.equal(T.output('unknown', rec), null);
  assert.equal(T.output('final', {id: 'l1', name: '下载.mp4'}).kind, 'final', '从链接只下载成文件：视频文件进 Space');
  assert.equal(T.moviePatch(T.output('final', {id: 'l1', name: '下载.mp4'})), null, '视频文件不走产物补丁新建视频');
  assert.equal(T.output('audio', {}), null);
});
test('Converting transcript retains source, cue times and leaves original result untouched', () => {
  const cue = {id: 'g1', start: 0, end: 2, text: '示例'};
  const it = T.output('subtitle', {id: 'tx1', name: '访谈.srt', sourceName: '访谈.mp4', dur: 2, cues: [cue]});
  const movie = T.moviePatch(it);
  assert.equal(movie.src.name, '访谈.mp4'); assert.equal(movie.sourceOutput, it.id);
  assert.equal(movie.status, 'complete'); assert.deepEqual(movie.initialCues, [cue]);
  movie.initialCues[0].text = 'edited'; assert.equal(it.cues[0].text, '示例');
});
test('Generated audio makes a movie with waveform and no unrelated demo subtitles', () => {
  const it = T.output('audio', {id: 'tts1', name: '旁白.wav', dur: 8, sourceUrl: 'assets/cloud-test.wav'});
  const movie = T.moviePatch(it);
  assert.equal(movie.entry, 'a2v'); assert.equal(movie.duration, 8);
  assert.equal(movie.src.path, 'assets/cloud-test.wav'); assert.equal(movie.config.wave, true);
  assert.deepEqual(movie.initialCues, []);
  assert.equal(T.moviePatch({kind: 'subtitle'}), null);
  assert.equal(T.moviePatch({kind: 'image'}), null);
});
test('Cloud ASR readiness maps both legacy OpenAI ids and namespaced providers', () => {
  assert.equal(T.asrProvider({id: 'gpt-4o-transcribe', provider: 'OpenAI'}), 'openai');
  assert.equal(T.asrProvider({id: 'cloud:elevenlabs/scribe_v2'}), 'elevenlabs');
  assert.equal(T.asrProvider({id: 'cloud:volcengine/bigmodel-asr'}), 'volcengine');
  assert.equal(T.asrProvider({id: 'moss-transcribe'}), null);
});
test('A translated subtitle file without media becomes a movie once media is chosen', () => {
  const it = T.output('subtitle', {id: 'tr1', name: '分享-en.srt', dur: 6, cues: [{id: 'c1', start: 0, end: 3, text: 'Hi'}]});
  assert.equal(T.moviePatch(it), null);
  const movie = T.moviePatch(it, 'share.mp4');
  assert.equal(movie.src.name, 'share.mp4'); assert.equal(movie.src.path, 'share.mp4');
  assert.equal(movie.initialCues.length, 1);
});
test('Tool output records carry the producing tool, task, run parameters and saved path (§2.7)', () => {
  const it = T.output('doc', {id: 'llm-3', name: '访谈-改写.md', file: '~/Desktop/访谈-改写.md', toolId: 'text', task: 'task-9', params: {input: '改写'}});
  assert.equal(it.id, 'tool-doc-llm-3');
  assert.equal(it.toolId, 'text'); assert.equal(it.task, 'task-9'); assert.deepEqual(it.params, {input: '改写'});
  assert.equal(it.file, '~/Desktop/访谈-改写.md');
  const bare = T.output('audio', {id: 'a', name: '旁白.wav', tool: 'tts'});
  assert.equal(bare.toolId, 'tts', '只给 tool 时也记下来源工具');
  assert.equal(bare.file, '~/Downloads/旁白.wav', '没给路径时落在默认保存位置，不再写 ~/BaoCut/工具');
  assert.equal(bare.task, null); assert.equal(bare.params, null);
});
