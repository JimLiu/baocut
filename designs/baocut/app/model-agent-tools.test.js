const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-agent-tools.js');
const T = global.window.BC_AGENT_TOOLS;

test('describe：读取与检索类工具带自己的类别名与摘要', () => {
  assert.deepEqual(T.describe('videos_inspect', {video: '科浪 42 期'}), {kind: 'video-read', label: '读取视频', summary: '科浪 42 期', icon: 'film'});
  assert.equal(T.describe('videos_inspect', {path: '/素材/访谈 A.mp4'}).summary, '访谈 A.mp4');
  assert.deepEqual(T.describe('speech_search', {query: '口癖'}), {kind: 'speech-search', label: '检索文稿', summary: '口癖', icon: 'search'});
  assert.equal(T.describe('documents_read', {document: '文稿', sentences: 62}).summary, '文稿 · 62 句');
  assert.equal(T.describe('timeline_query', {video: '主视频', range: '00:30–01:10'}).summary, '主视频 · 00:30–01:10');
  assert.equal(T.describe('previews_capture', {at: 72}).summary, '01:12');
  assert.equal(T.describe('space_search', {query: '片头'}).label, '搜索 Space');
});

test('describe：模型类工具', () => {
  assert.deepEqual(T.describe('models_transcribe', {model: 'moss-transcribe', duration: 206}),
    {kind: 'transcribe', label: '转录', summary: 'moss-transcribe · 3 分 26 秒', icon: 'transcript'});
  assert.equal(T.describe('models_synthesize_speech', {}).summary, '1 句');
  assert.equal(T.describe('models_synthesize_speech', {lines: 3, voice: '温和女声'}).summary, '3 句 · 温和女声');
  assert.equal(T.describe('models_generate_image', {count: 2}).summary, '2 张');
  assert.equal(T.describe('captions_create', {bilingual: true}).summary, '中英双语');
  assert.equal(T.describe('captions_create', {}).summary, '原文');
  assert.equal(T.describe('exports_create', {resolution: '1080p'}).summary, '1080p');
});

test('describe：下载视频（视频还没创建，下载卡挂在这一行）', () => {
  assert.deepEqual(T.describe('downloads_fetch', {site: 'lanshan.example', name: '第 12 期 · 城市夜跑.mp4'}),
    {kind: 'download', label: '下载视频', summary: 'lanshan.example · 第 12 期 · 城市夜跑.mp4', icon: 'download'});
  assert.equal(T.describe('downloads.fetch', {url: 'https://a.example/v.mp4'}).summary, 'https://a.example/v.mp4');
});

test('describe：edits_apply 按操作分类别', () => {
  assert.deepEqual(T.describe('edits_apply', {putDocument: {schema: 'baocut.translation/2', language: '英语', units: 62}}),
    {kind: 'translate', label: '翻译', summary: '英语 · 62 句', icon: 'translate'});
  assert.deepEqual(T.describe('edits_apply', {cut: {count: 11, what: '停顿'}}), {kind: 'cut', label: '剪辑', summary: '11 处停顿', icon: 'split'});
  assert.equal(T.describe('edits_apply', {putDocument: {name: '章节'}}).label, '写入文稿');
  assert.equal(T.describe('edits_apply', {ops: 4}).summary, '4 项操作');
  assert.equal(T.describe('edits_propose', {cut: {count: 3, what: '口癖'}}).label, '提出修改');
  assert.equal(T.describe('edits_undo', {label: '删停顿'}).label, '撤销修改');
});

test('describe：网关名同样认得，认不出的返回 null', () => {
  assert.equal(T.normalize('models.synthesizeSpeech'), 'models_synthesize_speech');
  assert.equal(T.describe('models.generateImage', {count: 1}).label, '生成图片');
  assert.equal(T.describe('bash', {}), null);
  assert.equal(T.describe('', {}), null);
  for (const name of T.NAMES) assert.ok(T.describe(name, {}).label, name);
});

test('spoken 与 callText', () => {
  assert.equal(T.spoken(45), '45 秒');
  assert.equal(T.spoken(3120), '52 分钟');
  assert.equal(T.spoken(3720), '1 小时 2 分');
  assert.equal(T.callText('speech_search', {}), 'speech_search');
  assert.equal(T.callText('speech.search', {query: '嗯'}), 'speech_search {\n  "query": "嗯"\n}');
});
