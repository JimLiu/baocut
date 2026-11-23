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

test('describe：智能体给会话起标题，步骤行念新标题', () => {
  assert.deepEqual(T.describe('conversations_set_title', {title: '城市骑行通勤的五个误区'}),
    {kind: 'conversation', label: '重命名会话', summary: '城市骑行通勤的五个误区', icon: 'edit'});
  assert.equal(T.describe('conversations.setTitle', {}).summary, '');
});

test('describe：项目工具，新建念项目名或目录名，放进新项目念用户给的名字', () => {
  assert.deepEqual(T.describe('projects_list', {}), {kind: 'project', label: '列出项目', summary: '', icon: 'folder'});
  assert.equal(T.describe('projects_create', {path: '/Users/me/Videos/episode-12', name: '第 12 期'}).summary, '第 12 期');
  assert.equal(T.describe('projects_create', {path: '/Users/me/Videos/episode-12/'}).summary, 'episode-12');
  assert.deepEqual(T.describe('projects_adopt_session', {name: '第 12 期'}), {kind: 'project', label: '放进新项目', summary: '第 12 期', icon: 'folder'});
  assert.equal(T.describe('projects.adoptSession', {}).summary, '');
  assert.equal(T.describe('projects_adopt_session', {project: '/Volumes/T7/访谈'}).summary, '访谈');
  assert.equal(T.describe('projects_adopt_session', {project: 'prj_1'}).summary, '');
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

test('describe：Open Artifact 的三个作品工具，Artifact 按动作分制作、查看与管理', () => {
  assert.deepEqual(T.describe('Artifact', {action: 'publish', title: '确定性渲染 · 第 1 讲'}),
    {kind: 'open-artifact', label: '制作作品', summary: '确定性渲染 · 第 1 讲', icon: 'template'});
  assert.equal(T.describe('Artifact', {}).label, '制作作品');
  assert.equal(T.describe('Artifact', {action: 'open'}).label, '查看作品');
  assert.equal(T.describe('Artifact', {action: 'delete'}).label, '管理作品');
  assert.deepEqual(T.describe('ArtifactData', {collection: 'rows'}), {kind: 'open-artifact', label: '读写作品数据', summary: 'rows', icon: 'list'});
  assert.deepEqual(T.describe('ArtifactComments', {action: 'list'}), {kind: 'open-artifact', label: '处理作品评论', summary: '', icon: 'edit'});
  for (const name of ['slides_check', 'design_check', 'design_system_check', 'docs_batch']) assert.equal(T.describe(name, {}), null, name);
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

test('按主题读取（embedding §2.10）：写明读了几段；没装模型退回字面匹配时也写明', () => {
  assert.deepEqual(T.describe('speech_relevant', {topic: '为什么要做本地', paragraphs: 12, mode: 'hybrid'}),
    {kind: 'speech-search', label: '按主题读取', icon: 'search', summary: '12 段 · 「为什么要做本地」'});
  assert.match(T.describe('speech_relevant', {paragraphs: 5, mode: 'lexical'}).summary, /字面匹配$/);
});
