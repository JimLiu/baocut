const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-time.js');
require('./model-agent.js');
require('./model-tool-targets.js');
require('./model-space.js');
const SP = global.window.BC_SPACE;

const dirs = [{id: 'd1', name: '科浪访谈'}, {id: 'd2', name: '新品发布'}];
const movies = [
  {id: 'm1', title: '双语版', dir: 'd1', folder: '双语版', status: 'complete', model: 'moss-transcribe', duration: 206, src: {name: 'a.mp4', res: '1920×1080', bytes: 88080384, state: 'ok'}, mtime: 120},
  {id: 'm2', title: '主视频', dir: 'd2', status: 'transcribing', progress: 45, duration: 3120, src: {name: 'b.mov', res: '3840×2160', state: 'ok'}, mtime: 12},
  {id: 'm3', title: '课程', dir: 'd2', status: 'queued', queuePos: 2, src: {state: 'ok'}, mtime: 25},
  {id: 'm4', title: '访谈', dir: 'd1', status: 'complete', model: 'whisper-large-v3', src: {name: 'd.mp4', state: 'missing'}, mtime: 4320},
  {id: 'm5', title: '回顾', dir: null, status: 'error', src: {name: 'e.mov', state: 'ok'}, mtime: 11520, archived: true},
  {id: 'm6', title: '切片', dir: 'd1', status: 'complete', src: {name: 'f.mp4', state: 'ok'}, origin: {project: 'm1'}, mtime: 10080},
];
const outputs = [
  {id: 'o1', kind: 'final', name: '双语版.mp4', dir: 'd1', movie: 'm1', status: 'stale', dur: 206, res: '1920×1080', mtime: 60},
  {id: 'o2', kind: 'subtitle', name: '英文字幕.srt', dir: 'd1', movie: 'm1', session: 's2', status: 'published', lines: 62, mtime: 18, file: '导出/en.srt', text: 'a'},
  {id: 'o3', kind: 'image', name: '封面 A.png', dir: null, task: 't1', status: 'generating', res: '1024×1024', mtime: 0, fav: true},
  {id: 'o4', kind: 'doc', name: '旧稿.md', dir: 'd2', trashed: true, mtime: 9000},
];
const all = () => SP.items({movies, outputs, dirs, pctOf: (it) => (it.task === 't1' ? 7 : null)});

test('投影：视频与产物进同一张表；视频状态由记录推出来', () => {
  const list = all();
  assert.equal(list.length, 10);
  const by = Object.fromEntries(list.map((x) => [x.id, x]));
  assert.equal(by.m1.kind, 'movie');
  assert.equal(by.m1.status, null, '普通工作稿没有状态');
  assert.deepEqual([by.m2.status, by.m2.pct], ['generating', 45]);
  assert.deepEqual([by.m3.status, by.m3.pct, by.m3.queuePos], ['generating', null, 2]);
  assert.equal(by.m4.status, 'missing');
  assert.equal(by.m5.status, 'failed');
  assert.equal(by.m5.trashed, true, '归档的视频在回收站里');
  assert.equal(by.o3.pct, 7, '进度读任务记录');
  assert.equal(by.m6.origin, 'm1');
});

test('整理标记盖在投影上：收藏 / 回收站可以覆盖记录上的初值', () => {
  const list = SP.items({movies, outputs, marks: {fav: {m1: true, o3: false}, trash: {o4: false, o1: true}}});
  const by = Object.fromEntries(list.map((x) => [x.id, x]));
  assert.equal(by.m1.fav, true);
  assert.equal(by.o3.fav, false);
  assert.equal(by.o4.trashed, false);
  assert.equal(by.o1.trashed, true);
});

test('分类与计数：回收站只收已移入的，其余分类不含它们', () => {
  const n = SP.counts(all());
  assert.equal(n.all, 8);
  assert.equal(n.movie, 5);
  assert.equal(n.final, 1);
  assert.equal(n.subtitle, 1);
  assert.equal(n.image, 1);
  assert.equal(n.doc, 0);
  assert.equal(n.fav, 1);
  assert.equal(n.trash, 2);
  assert.deepEqual(SP.CATS.map((c) => c.label), ['全部', '视频', '成片', '图片', '音频', '字幕', '文档', '模板']);
  assert.deepEqual(SP.SPECIAL.map((c) => c.label), ['收藏', '回收站']);
  assert.ok(SP.isCat('trash') && SP.isCat('doc') && !SP.isCat('nope'));
});

test('排序：最近活动 / 名称 / 类型', () => {
  const list = all();
  assert.deepEqual(SP.view(list, {cat: 'all'}).map((x) => x.id), ['o3', 'm2', 'o2', 'm3', 'o1', 'm1', 'm4', 'm6']);
  assert.deepEqual(SP.view(list, {cat: 'movie', sort: 'name'}).map((x) => x.name), ['访谈', '课程', '切片', '双语版', '主视频']);
  assert.deepEqual(SP.view(list, {sort: 'kind'}).map((x) => x.kind),
    ['movie', 'movie', 'movie', 'movie', 'movie', 'final', 'image', 'subtitle']);
});

test('筛选：项目 / 状态 / 切自 / 搜索（名称或文件）', () => {
  const list = all();
  assert.deepEqual(SP.view(list, {dir: 'd2'}).map((x) => x.id), ['m2', 'm3']);
  assert.deepEqual(SP.view(list, {dir: 'none'}).map((x) => x.id), ['o3']);
  assert.deepEqual(SP.view(list, {status: 'generating'}).map((x) => x.id), ['o3', 'm2', 'm3']);
  assert.deepEqual(SP.view(list, {status: 'none', cat: 'movie'}).map((x) => x.id), ['m1', 'm6']);
  assert.deepEqual(SP.view(list, {from: 'm1'}).map((x) => x.id), ['m6']);
  assert.deepEqual(SP.view(list, {q: 'EN.SRT'}).map((x) => x.id), ['o2']);
  assert.deepEqual(SP.view(list, {cat: 'trash'}).map((x) => x.id), ['o4', 'm5']);
});

test('「项目」筛选的选项：出现过的项目，再加「不属于任何项目」', () => {
  assert.deepEqual(SP.dirOptions(all(), dirs).map((o) => o.k), ['d1', 'd2', 'none']);
  assert.deepEqual(SP.dirOptions(all().filter((x) => x.dir), dirs).map((o) => o.label), ['科浪访谈', '新品发布']);
});

test('状态 / 时长 / 规格 / 来源的字', () => {
  const by = Object.fromEntries(all().map((x) => [x.id, x]));
  assert.equal(SP.statusText(by.o1), '来源已变');
  assert.equal(SP.statusText(by.m1), null);
  assert.equal(SP.durationText(by.m1), '3 分 26 秒');
  assert.equal(SP.durationClock(by.m1), '03:26');
  assert.equal(SP.specText(by.m1), '1920×1080 · 84 MB');
  assert.equal(SP.durationText(by.o1), '3 分 26 秒');
  assert.equal(SP.specText(by.o1), '1920×1080', '文件大小未知时只写分辨率');
  assert.equal(SP.durationText(by.o2), '', '字幕不是有时长的类型');
  assert.equal(SP.specText(by.o2), '62 句');
  assert.equal(SP.durationText(by.o3), '');
  assert.equal(SP.durationClock(by.o3), '');
  assert.equal(SP.specText(by.o3), '1024×1024');
  assert.equal(SP.durationText(by.m3), '', '时长未知不写 0 秒');
  const D = {d1: dirs[0], d2: dirs[1]};
  const M = Object.fromEntries(movies.map((m) => [m.id, m]));
  assert.equal(SP.sourceText(by.o1, D, M), '科浪访谈 · 双语版');
  assert.equal(SP.sourceText(by.m1, D, M), '科浪访谈');
  assert.equal(SP.sourceText(by.o3, D, M), '不属于任何项目');
  assert.equal(SP.agoText(90), '1 小时前');
});

test('二次编辑的路子（§4.6）', () => {
  const by = Object.fromEntries(all().map((x) => [x.id, x]));
  assert.equal(SP.editRoute(by.m1), 'editor');
  assert.equal(SP.editRoute(by.o1), 'source');
  assert.equal(SP.editRoute({kind: 'final'}), 'new-movie');
  assert.equal(SP.editRoute(by.o2), 'text');
  assert.equal(SP.editRoute(by.o3), 'version');
});

test('另存为新版本：新加一条候选，原条目不动；版本号递增', () => {
  const list = all();
  const o2 = list.find((x) => x.id === 'o2');
  const before = JSON.stringify(o2);
  const v2 = SP.newVersion(o2, list, 'o2v2', {text: 'b'});
  assert.equal(JSON.stringify(o2), before, '原条目一个字段都不变');
  assert.deepEqual([v2.id, v2.parent, v2.ver, v2.status, v2.name, v2.file, v2.text, v2.session],
    ['o2v2', 'o2', 2, 'candidate', '英文字幕 v2.srt', '导出/en v2.srt', 'b', 's2']);
  const v3 = SP.newVersion(v2, list.concat([v2]), 'o2v3');
  assert.deepEqual([v3.parent, v3.ver, v3.name], ['o2', 3, '英文字幕 v3.srt']);
  assert.deepEqual(SP.versionsOf(o2, list.concat([v2, v3])).map((x) => x.id), ['o2', 'o2v2', 'o2v3']);
  assert.equal(SP.newVersion(list.find((x) => x.id === 'm1'), list, 'x'), null, '视频不走另存');
  assert.equal(SP.versionName('模板/双语/', 2), '模板/双语 v2/');
  assert.equal(SP.versionName('访谈双语 · 横版', 2), '访谈双语 · 横版 v2');
});

test('导入素材：按扩展名 / MIME 认类型；视频与认不出的不收；落在项目的「素材/」下', () => {
  assert.equal(SP.kindOfFile('a.PNG', ''), 'image');
  assert.equal(SP.kindOfFile('x', 'audio/mpeg'), 'audio');
  assert.equal(SP.kindOfFile('ep.srt', ''), 'subtitle');
  assert.equal(SP.kindOfFile('notes.md', ''), 'doc');
  assert.equal(SP.kindOfFile('clip.mp4', 'video/mp4'), null);
  assert.equal(SP.kindOfFile('a.zip', ''), null);
  const r = SP.assetRecord({name: 'cover.png', type: 'image/png'}, 'd1', 'n1');
  assert.deepEqual([r.id, r.kind, r.dir, r.file, r.status], ['n1', 'image', 'd1', '素材/cover.png', null]);
  assert.equal(SP.assetRecord({name: 'clip.mp4', type: 'video/mp4'}, 'd1', 'n2'), null);
  assert.equal(SP.assetRecord({name: 'a.png'}, null, 'n3').dir, null);
});

test('刚建的视频还没有 mtime：按建立时间（ctime）排进「最近活动」，不沉到底', () => {
  const list = SP.items({movies: [{id: 'old', title: '旧', status: 'complete', src: {state: 'ok'}, mtime: 30},
    {id: 'new', title: '新', status: 'ready', src: {state: 'ok'}, ctime: 0}], outputs: []});
  assert.equal(list.find((x) => x.id === 'new').mtime, 0);
  assert.deepEqual(SP.view(list, {sort: 'recent'}).map((x) => x.id), ['new', 'old']);
  assert.equal(SP.items({movies: [{id: 'x', title: 'x', src: {state: 'ok'}}], outputs: []})[0].mtime, null);
});

test('文档阅读分块保留列表起始编号、段落换行和代码原文', () => {
  assert.deepEqual(SP.documentBlocks('# 标题\r\n\r\n3. 第三项\n4. 第四项\n\n- 列表\n\n正文\n下一行\n\n```html\n<script>ignored()</script>\n```'), [
    {type: 'heading', level: 1, text: '标题'},
    {type: 'list', ordered: true, start: 3, items: ['第三项', '第四项']},
    {type: 'list', ordered: false, start: null, items: ['列表']},
    {type: 'paragraph', text: '正文\n下一行'},
    {type: 'code', text: '<script>ignored()</script>'},
  ]);
});
test('空文档、未闭合围栏及不支持语法都不丢弃正文', () => {
  assert.deepEqual(SP.documentBlocks(''), []);
  assert.deepEqual(SP.documentBlocks('```\nraw\n'), [{type: 'code', text: 'raw\n'}]);
  assert.deepEqual(SP.documentBlocks('<img src=x>\n**字面内容**'), [{type: 'paragraph', text: '<img src=x>\n**字面内容**'}]);
});

test('工具新建的视频：来源记为那次运行', () => {
  const list = SP.items({movies: [{id: 'mt', title: '新视频', dir: 'd1', status: 'complete', src: {state: 'ok'}, mtime: 0,
    toolRun: {tool: 'transcribe', task: 'a1', label: '转录工具'}}], outputs: [], dirs});
  assert.deepEqual(list[0].toolRun, {tool: 'transcribe', task: 'a1', label: '转录工具'});
  assert.equal(SP.sourceText(list[0], {d1: dirs[0]}, {}), '科浪访谈 · 转录工具新建');
});

test('最近的视频：按最近活动取前 n 部，不含归档的，带「项目名 · 相对时间」', () => {
  const rows = SP.recentMovies(movies, dirs, 3);
  assert.deepEqual(rows.map((r) => r.id), ['m2', 'm3', 'm1']);
  assert.equal(rows[0].desc, '新品发布 · 12 分钟前');
  assert.equal(rows[2].desc, '科浪访谈 · 2 小时前');
  assert.ok(!SP.recentMovies(movies, dirs).some((r) => r.id === 'm5'));
  assert.equal(SP.recentMovies(movies, dirs).length, 5);
  assert.equal(SP.recentMovies([{id: 'x', title: '散片', mtime: 0}], [], 8)[0].desc, '不属于任何项目 · 刚刚');
  assert.deepEqual(SP.recentMovies(null, null), []);
});

test('视频的状态用视频自己的词（data.js BADGE），与会话里的视频卡一个说法；产物仍是「生成中」', () => {
  const by = Object.fromEntries(all().map((x) => [x.id, x]));
  assert.equal(SP.statusText(by.m2), '转录中 · 45%');
  assert.equal(SP.statusText(by.m3), '排队中 · 第 2 位');
  assert.equal(SP.statusText({kind: 'movie', status: 'failed'}), '失败');
  assert.equal(SP.statusText({kind: 'image', status: 'generating', pct: 30}), '生成中 · 30%');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'data.js'), 'utf8');
  for (const w of ['转录中', '排队中', '失败']) assert.match(src, new RegExp(`label: '${w}'`), `${w} 在 BADGE 表里`);
});

test('时长：转录中 / 排队的视频也有源文件的时长；长片的角标进位到小时', () => {
  const by = Object.fromEntries(all().map((x) => [x.id, x]));
  assert.equal(by.m2.status, 'generating');
  assert.equal(SP.durationText(by.m2), '52 分');
  assert.equal(SP.durationClock(by.m2), '52:00');
  assert.equal(SP.durationClock({kind: 'movie', dur: 4820}), '1:20:20');
  assert.equal(SP.durationText({kind: 'audio', dur: 30}), '30 秒');
  assert.equal(SP.specText({kind: 'audio', dur: 30, bytes: 5557452}), '5.3 MB');
  assert.equal(SP.specText({kind: 'doc', lines: 4}), '4 行');
  assert.equal(SP.specText({kind: 'template'}), '');
});

test('文件大小：B 取整，KB 起不到 10 留一位，10 以上取整，按 1024 进位', () => {
  assert.equal(SP.formatBytes(0), '');
  assert.equal(SP.formatBytes(null), '');
  assert.equal(SP.formatBytes(900), '900 B');
  assert.equal(SP.formatBytes(1536), '1.5 KB');
  assert.equal(SP.formatBytes(2.4 * 1024 * 1024), '2.4 MB');
  assert.equal(SP.formatBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(SP.formatBytes(88080384), '84 MB');
  assert.equal(SP.formatBytes(1024 * 1024 - 1), '1 MB');
  assert.equal(SP.formatBytes(58.5 * 1024 ** 3), '59 GB');
});

test('视频菜单的转录动作：转录过 → 重新转录；失败 → 重试；没转录过 → 转录；转录中 / 排队 / 源文件找不到 → 不给', () => {
  const by = Object.fromEntries(all().map((x) => [x.id, x]));
  assert.equal(by.m1.transcribe, 'redo');
  assert.equal(by.m5.transcribe, 'retry');
  assert.equal(by.m6.transcribe, 'first');
  assert.equal(by.m2.transcribe, null);
  assert.equal(by.m3.transcribe, null);
  assert.equal(by.m4.transcribe, null);
  assert.equal(by.o1.transcribe, undefined, '产物没有转录动作');
  assert.deepEqual(['redo', 'retry', 'first'].map((k) => SP.TRANSCRIBE[k].label), ['重新转录…', '重试转录…', '转录…']);
});

test('来源：工具的结果写「工具 · <工具名>」，属于项目时前面带项目；认不出工具只写「工具」', () => {
  global.window.BC_TOOLS = {TOOLS: [{id: 'tts', name: '生成语音'}]};
  const by = {d1: {id: 'd1', name: '科浪访谈'}};
  assert.equal(SP.sourceText({id: 'a', kind: 'audio', tool: true, toolId: 'tts', dir: null}, by, {}), '工具 · 生成语音');
  assert.equal(SP.sourceText({id: 'b', kind: 'audio', tool: 'tts', dir: 'd1'}, by, {}), '科浪访谈 · 工具 · 生成语音');
  assert.equal(SP.sourceText({id: 'c', kind: 'doc', tool: true, dir: null}, by, {}), '工具');
  assert.equal(SP.toolName({toolId: 'nope'}), null);
  delete global.window.BC_TOOLS;
});
