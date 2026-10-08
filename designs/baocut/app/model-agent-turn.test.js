const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-agent-turn.js');
const T = global.window.BC_AGENT_TURN;

test('toolStep：带 kind 的用固定类别名 + 摘要', () => {
  assert.deepEqual(T.toolStep({kind: 'edit', summary: '分镜.md', cmd: 'x'}), {kind: 'edit', label: '修改文件', summary: '分镜.md'});
  assert.deepEqual(T.toolStep({kind: 'search', summary: '口癖'}), {kind: 'search', label: '搜索', summary: '口癖'});
  assert.equal(T.toolStep({kind: 'command', cmd: 'bcut info'}).summary, 'bcut info');
  assert.equal(T.toolStep({kind: 'other', summary: '本机模型'}).label, '其他工具');
});

test('toolStep：只有 cmd 的老数据按写法推类别', () => {
  assert.deepEqual(T.toolStep({cmd: '读取 transcript.json · 第 3 章 · 18 段'}), {kind: 'read', label: '读取文件', summary: 'transcript.json'});
  assert.deepEqual(T.toolStep({cmd: 'bcut project info project.bcut'}), {kind: 'command', label: '运行命令', summary: 'bcut project info project.bcut'});
  assert.equal(T.toolStep({cmd: 'transcript.json · 62 句'}).kind, 'read');
  assert.equal(T.toolStep({cmd: '插图/ · 6 张 PNG'}).summary, '插图/');
  assert.deepEqual(T.toolStep({cmd: '本机语音模型 · 已安装 2 个'}), {kind: 'other', label: '其他工具', summary: '本机语音模型 · 已安装 2 个'});
  assert.equal(T.toolStep({kind: 'bogus', cmd: 'bcut x'}).kind, 'command');
});

test('toolStatus / nextToolStatus：fail 与 failed 同义，失败之后不再被改回', () => {
  assert.equal(T.toolStatus('run'), 'run');
  assert.equal(T.toolStatus('fail'), 'failed');
  assert.equal(T.toolStatus('failed'), 'failed');
  assert.equal(T.toolStatus('done'), 'done');
  assert.equal(T.nextToolStatus('failed', 'done'), 'failed');
  assert.equal(T.nextToolStatus('fail', 'run'), 'fail');
  assert.equal(T.nextToolStatus('run', 'done'), 'done');
});

test('stepMeta：非零退出码与耗时', () => {
  assert.deepEqual(T.stepMeta({exitCode: 1, took: '0.4s'}), ['退出码 1', '0.4s']);
  assert.deepEqual(T.stepMeta({exitCode: 0, took: '0.4s'}), ['0.4s']);
  assert.deepEqual(T.stepMeta({took: 2}), ['2s']);
  assert.deepEqual(T.stepMeta({}), []);
});

test('diffLines / looksLikeDiff：按行归类，文件头不算增删', () => {
  const diff = '--- a/分镜.md\n+++ b/分镜.md\n@@ -1,2 +1,2 @@\n 标题\n-旧的一行\n+新的一行\n';
  assert.ok(T.looksLikeDiff(diff));
  assert.ok(!T.looksLikeDiff('duration 206s · 3 speakers'));
  assert.deepEqual(T.diffLines(diff).map((l) => l.type), ['meta', 'meta', 'hunk', 'ctx', 'del', 'add']);
});

test('parsePathToken：前缀路径与多段路径', () => {
  assert.deepEqual(T.parsePathToken('./transcript.json'), {path: './transcript.json', line: null, lineEnd: null, col: null});
  assert.equal(T.parsePathToken('~/BaoCut/访谈/分镜.md').path, '~/BaoCut/访谈/分镜.md');
  assert.equal(T.parsePathToken('../a').path, '../a');
  assert.equal(T.parsePathToken('/tmp/x').path, '/tmp/x');
  assert.equal(T.parsePathToken('ai/reviews/cleanup.json').path, 'ai/reviews/cleanup.json');
  assert.equal(T.parsePathToken('subs/en.SRT').path, 'subs/en.SRT');
});

test('parsePathToken：行号后缀', () => {
  assert.deepEqual(T.parsePathToken('src/app.ts:12'), {path: 'src/app.ts', line: 12, lineEnd: null, col: null});
  assert.deepEqual(T.parsePathToken('src/app.ts:12-20'), {path: 'src/app.ts', line: 12, lineEnd: 20, col: null});
  assert.deepEqual(T.parsePathToken('./a.rs:12:5'), {path: './a.rs', line: 12, lineEnd: null, col: 5});
  assert.equal(T.pathTip(T.parsePathToken('src/app.ts:12-20')), 'src/app.ts · 第 12–20 行');
  assert.equal(T.pathTip(T.parsePathToken('./a.rs:12:5')), './a.rs · 第 12 行第 5 列');
  assert.equal(T.pathTip(T.parsePathToken('./a.rs:3')), './a.rs · 第 3 行');
  assert.equal(T.pathTip(T.parsePathToken('./a.rs')), './a.rs');
});

test('parsePathToken：不像路径的不算', () => {
  ['transcript.json', 'bcut auto <文件>', 'a/b.exe', 'example.com/a.ts', 'https://x.test/a.md', 'a/b.md?x=1',
    '/', '//cdn/a.js', 'render', '', 'x/y', 'a//b.ts'].forEach((s) => assert.equal(T.parsePathToken(s), null, s));
});

test('gapBetween：相邻种类定间距', () => {
  assert.equal(T.gapBetween('user', 'user'), 4);
  assert.equal(T.gapBetween('user', 'assistant'), 0);
  assert.equal(T.gapBetween('tool', 'tool'), 0);
  assert.equal(T.gapBetween('user', 'tool'), 16);
  assert.equal(T.gapBetween('assistant', 'tool'), 4);
  assert.equal(T.gapBetween('tool', 'assistant'), 4);
  assert.equal(T.gapBetween('block', 'block'), 12);
  assert.equal(T.gapBetween('assistant', 'permission'), 16);
  assert.equal(T.gapBetween('footer', 'user'), 16);
  assert.equal(T.gapBetween('permission', 'footer'), 4);
  assert.equal(T.gapBetween('user', 'footer'), 4);
  assert.equal(T.gapBetween(null, 'user'), 0);
  assert.equal(T.rowKind({role: 'work'}), 'tool');
  assert.equal(T.rowKind({role: 'receipt'}), 'receipt');
});

test('turns：按用户消息切回合，正文用空行连接、不含工具', () => {
  const rows = [
    {id: 'u1', role: 'user', text: 'a'},
    {id: 'a1', role: 'assistant', text: '第一段', work: [{role: 'tool', cmd: 'bcut x'}]},
    {id: 'w', role: 'work', items: []},
    {id: 'a2', role: 'assistant', text: '第二段\n'},
    {id: 'u2', role: 'user', text: 'b'},
    {id: 'u3', role: 'user', text: 'c'},
    {id: 'e', role: 'assistant', text: '', error: 'x'},
  ];
  const t = T.turns(rows);
  assert.deepEqual(t.map((x) => [x.start, x.end, x.replied]), [[0, 3, true], [4, 4, false], [5, 6, true]]);
  assert.equal(t[0].text, '第一段\n\n第二段');
  assert.equal(t[2].text, '');
  assert.equal(t[0].user.id, 'u1');
  assert.deepEqual(T.turns([]), []);
});

test('formatElapsed / clockLabel / footerLabel', () => {
  assert.equal(T.formatElapsed(42000), '0:42');
  assert.equal(T.formatElapsed(63000), '1:03');
  assert.equal(T.formatElapsed(3725000), '1:02:05');
  assert.equal(T.formatElapsed(-5), '0:00');
  assert.equal(T.clockLabel(new Date(2026, 9, 5, 14, 32, 10).getTime()), '14:32');
  assert.equal(T.clockLabel(new Date(2026, 9, 5, 9, 5).getTime()), '09:05');
  assert.equal(T.footerLabel({live: true, startedAt: 1000, now: 43000}), '正在工作 · 0:42');
  assert.equal(T.footerLabel({live: true}), '正在工作');
  assert.equal(T.footerLabel({live: true, waiting: true, startedAt: 1000, now: 61000}), '等你允许 · 1:00');
  assert.equal(T.footerLabel({startedAt: 0, endedAt: 63000}), '');
  assert.equal(T.footerLabel({startedAt: 1, endedAt: 63001}), '已工作 1:03');
});

test('endTurn：只给最后一条用户消息记结束时刻，已经记过的不改', () => {
  const msgs = [{id: 'u1', role: 'user', startedAt: 1, endedAt: 5}, {id: 'a', role: 'assistant'}, {id: 'u2', role: 'user', startedAt: 10}, {id: 'b', role: 'assistant'}];
  const out = T.endTurn(msgs, 20);
  assert.equal(out[2].endedAt, 20);
  assert.equal(out[0].endedAt, 5);
  assert.equal(msgs[2].endedAt, undefined);
  assert.equal(T.endTurn(out, 30), out);
  assert.deepEqual(T.endTurn([], 1), []);
  const noStart = [{id: 'u', role: 'user'}];
  assert.equal(T.endTurn(noStart, 1), noStart);
});

test('toolStep：BaoCut 工具用自己的类别名与图标，未知工具退回原来的推法', () => {
  require('./model-agent-tools.js');
  assert.deepEqual(T.toolStep({tool: 'speech_search', args: {query: '口癖'}, cmd: 'x'}), {kind: 'speech-search', label: '检索文稿', summary: '口癖', icon: 'search'});
  assert.equal(T.toolStep({tool: 'mystery_tool', cmd: 'bcut x'}).kind, 'command');
});
