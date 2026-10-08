const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-project-info.js');
const PI = global.window.BC_PINFO;

const local = () => ({
  id: 'p8', title: '口播剪辑 · 实验',
  src: {name: 'talk-take2.mp4', path: '~/Movies/口播/talk-take2.mp4', format: 'MP4 · H.264', res: '1920×1080'},
  lang: '中文', model: 'moss-transcribe', meta: {speakers: 1, chapters: 3, cues: 62},
});
const fromUrl = () => ({
  id: 'p1', title: '中 → EN · 科浪访谈双语版',
  src: {name: 'kelang-ep42-master.mp4', path: '~/Movies/播客/kelang-ep42-master.mp4', format: 'MP4', res: '1920×1080'},
  lang: '中文', model: 'moss-transcribe', tlang: '英语',
  url: 'https://kelang.example/ep42',
  source: {uploader: '科浪电台', publishedAt: '20260420', platform: 'YouTube', views: 128400, videoId: 'kl-ep42'},
  meta: {speakers: 3, chapters: 4, cues: 62},
});

test('缺席的行整行省略，不写占位', () => {
  const bare = {id: 'p0', title: '新项目', src: {}, meta: {}};
  const rows = PI.sections(bare, '00:00', PI.editorExtras(bare))[0].rows;
  assert.deepStrictEqual(rows.map((r) => r.label), ['媒体'], '没路径没转录就只剩媒体一行');
  assert.strictEqual(PI.contentsRow(0, 0, 0), null, '三段全 0 时整行不出现');
  assert.strictEqual(PI.translationRow('  '), null);
  // 空分区连标题一起丢：没有来源信息就没有那个小标题。
  assert.deepStrictEqual(PI.sections(bare, '00:00', []).map((s) => s.title), [PI.SECTION_MEDIA]);
});

test('两个入口的信息密度不同：extras 只有编辑器那条路给得出', () => {
  const p = fromUrl();
  const editor = PI.sections(p, '03:12', PI.editorExtras(p));
  assert.deepStrictEqual(editor[0].rows.map((r) => r.label),
    ['位置', '媒体', '转录', '内容', '译文']);
  assert.strictEqual(editor[0].rows[3].value, '3 位说话人 · 4 章 · 62 段');
  assert.strictEqual(editor[0].rows[4].value, '英语');
  // 项目卡那条路手上没有文稿，最后两行缺席，其余一模一样。
  const card = PI.sections(p, '03:12', []);
  assert.deepStrictEqual(card[0].rows.map((r) => r.label), ['位置', '媒体', '转录']);
});

test('来源信息逐项放行，网址导入才有', () => {
  assert.deepStrictEqual(PI.sections(local(), '03:12', []).map((s) => s.title), [PI.SECTION_MEDIA]);
  const meta = PI.sections(fromUrl(), '03:12', [])[1];
  assert.strictEqual(meta.title, PI.SECTION_SOURCE);
  assert.deepStrictEqual(meta.rows.map((r) => `${r.label}=${r.value}`),
    ['频道=科浪电台', '发布=2026-04-20', '平台=YouTube', '播放量=128,400', '视频 ID=kl-ep42']);
  assert.strictEqual(meta.rows[4].mono, true, '视频 ID 是等宽的');
  // 日期不是八位数字就整行不出，不猜格式。
  assert.strictEqual(PI.prettyDate('2026-04-20'), null);
});

test('省略号只进眼睛不进剪贴板', () => {
  const long = '“The default way to code is vibecoding.” OpenAI chief research officer.mp4';
  const short = PI.elideMiddle(long, PI.HERO_NAME_MAX);
  assert.strictEqual(Array.from(short).length, PI.HERO_NAME_MAX);
  assert.ok(short.startsWith('“The default way'));
  assert.ok(short.endsWith('officer.mp4'), '扩展名留得住');
  assert.strictEqual(PI.elideMiddle('talk.mp4', PI.HERO_NAME_MAX), 'talk.mp4');
  // 复制走完整值。
  assert.ok(PI.heroLine({src: {name: long}}).endsWith(long));
});

test('复制文本就是屏幕上那几行，值内换行缩进两格', () => {
  const p = local();
  const list = PI.sections(p, '03:12', PI.editorExtras(p));
  list.push(PI.detailsSection('', '第一行\n第二行', '  '));
  const text = PI.copyText(p.title, PI.heroLine(p), list.filter(Boolean));
  assert.strictEqual(text,
    '口播剪辑 · 实验\n' +
    '本地文件 · talk-take2.mp4\n' +
    '\n' +
    '来源与媒体\n' +
    '位置: ~/Movies/口播/talk-take2.mp4\n' +
    '媒体: 03:12 · 1920×1080 · MP4 · H.264\n' +
    '转录: moss-transcribe · 中文\n' +
    '内容: 1 位说话人 · 3 章 · 62 段\n' +
    '\n' +
    '详情\n' +
    '简介: 第一行\n  第二行\n');
  // 全空的备注不占一行。
  assert.strictEqual(PI.detailsSection('', '', ''), null);
});
