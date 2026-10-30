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
  // 子智能体走了几步：写在结构化事实之后、耗时之前
  assert.deepEqual(T.stepMeta({info: {type: 'subAgent', agentType: 'Explore'}, substeps: [{}, {}, {}], took: '14s'}), ['Explore', '3 步', '14s']);
  assert.deepEqual(T.stepMeta({substeps: []}), []);
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

test('gapBetween：卡片与后续消息留出间距，页脚仍贴近上一行', () => {
  for (const prev of ['user', 'assistant', 'tool']) {
    for (const next of ['user', 'assistant', 'tool', 'permission']) {
      assert.equal(T.gapBetween(prev, next, true), 24, `${prev}>${next}`);
    }
    assert.equal(T.gapBetween(prev, 'footer', true), 4);
  }
  assert.equal(T.gapBetween(null, 'assistant', true), 0);
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

test('parseVideoTime：视频时间链接取出视频与秒，认不出的返回 null', () => {
  assert.deepEqual(T.parseVideoTime('/videos/p7?t=63'), {videoId: 'p7', seconds: 63});
  assert.deepEqual(T.parseVideoTime('/videos/p7?t=41.5'), {videoId: 'p7', seconds: 41.5});
  assert.deepEqual(T.parseVideoTime('/videos/a%20b?x=1&t=0'), {videoId: 'a b', seconds: 0});
  ['/videos/p7', '/videos/p7?t=', '/videos/p7?t=-3', '/videos/p7?t=abc', '/videos/p7/x?t=3', '/videos/?t=3',
    'https://x.example/videos/p7?t=3', '/settings/models'].forEach((s) => assert.equal(T.parseVideoTime(s), null, s));
});

test('waitingFor / waitingLabel：等的是提问卡说「等你回答」，否则「等你允许」', () => {
  const sess = (messages, status = 'waiting') => ({status, messages});
  assert.equal(T.waitingFor(sess([], 'running')), null);
  assert.equal(T.waitingFor(sess([{role: 'permission', state: 'pending'}])), 'allow');
  assert.equal(T.waitingFor(sess([{role: 'permission', state: 'allowed'}, {role: 'question', state: 'pending'}])), 'answer');
  assert.equal(T.waitingFor(sess([])), 'allow');
  assert.equal(T.waitingLabel(sess([{role: 'question', state: 'pending'}])), '等你回答');
  assert.equal(T.waitingLabel(sess([{role: 'question', state: 'pending'}]), true), '待回答');
  assert.equal(T.waitingLabel(sess([], 'idle')), '');
  assert.equal(T.footerLabel({live: true, waiting: 'answer'}), '等你回答');
  assert.equal(T.footerLabel({live: true, waiting: true}), '等你允许');
});

test('结构化事实：类别与摘要按它定，标签写读的行、搜到几处、失败的状态码、子智能体类型', () => {
  assert.deepEqual(T.toolStep({info: {type: 'read', path: 'glossary.md', offset: 40, limit: 25}, cmd: 'x'}), {kind: 'read', label: '读取文件', summary: 'glossary.md'});
  assert.deepEqual(T.toolStep({info: {type: 'search', pattern: '光栅化', path: 'transcript.json'}}).summary, '光栅化 · transcript.json');
  assert.deepEqual(T.toolStep({info: {type: 'fetch', url: 'https://x.test'}}), {kind: 'fetch', label: '读取网页', summary: 'https://x.test'});
  assert.deepEqual(T.toolStep({info: {type: 'subAgent', description: '核对原文'}}), {kind: 'agent', label: '子智能体', summary: '核对原文'});
  assert.deepEqual(T.stepMeta({info: {type: 'read', path: 'a', offset: 40, limit: 25}, took: '0.1s'}), ['第 40–64 行', '0.1s']);
  assert.deepEqual(T.stepMeta({info: {type: 'read', path: 'a', offset: 40}}), ['从第 40 行']);
  assert.deepEqual(T.stepMeta({info: {type: 'read', path: 'a'}}), []);
  assert.deepEqual(T.stepMeta({info: {type: 'search', pattern: 'x', files: 2, matches: 6}}), ['6 处匹配']);
  assert.deepEqual(T.stepMeta({info: {type: 'search', pattern: 'x', files: 2}}), ['2 个文件']);
  assert.deepEqual(T.stepMeta({info: {type: 'fetch', url: 'u', status: 404}}), ['HTTP 404']);
  assert.deepEqual(T.stepMeta({info: {type: 'fetch', url: 'u', status: 200}}), []);
  assert.deepEqual(T.stepMeta({info: {type: 'subAgent', agentType: 'Explore'}}), ['Explore']);
});

test('windowStart：只显示最后几个回合时从哪一行开始；回合不够时从头', () => {
  const rows = [{role: 'assistant'}, {role: 'user'}, {role: 'assistant'}, {role: 'user'}, {role: 'work'}, {role: 'user'}];
  assert.equal(T.windowStart(rows, 1), 5);
  assert.equal(T.windowStart(rows, 2), 3);
  assert.equal(T.windowStart(rows, 3), 0, '三个回合正好全显示，开头那条没有用户消息的回复也在');
  assert.equal(T.windowStart([], T.TAIL_TURNS), 0);
});

test('findHits / locateHit：只查用户消息与回复正文，不分大小写；命中跨行连着数', () => {
  const rows = [
    {id: 'u1', role: 'user', text: '给片头配 BGM'},
    {id: 'w1', role: 'work', items: [{id: 't', text: 'bgm.wav'}]},
    {id: 'a1', role: 'assistant', text: '换了一段 bgm，另一段 Bgm 留作备选'},
    {id: 'u2', role: 'user', text: '好'},
    {id: 'a2', role: 'assistant', text: 'BGM 已经放上'},
  ];
  const hits = T.findHits(rows, 'bgm');
  assert.deepEqual(hits, [{id: 'u1', row: 0, count: 1}, {id: 'a1', row: 2, count: 2}, {id: 'a2', row: 4, count: 1}]);
  assert.deepEqual(T.findHits(rows, ''), []);
  assert.deepEqual(T.findHits(rows, 'aa'), []);
  assert.deepEqual(T.locateHit(hits, 0), {hit: hits[0], nth: 0});
  assert.deepEqual(T.locateHit(hits, 2), {hit: hits[1], nth: 1});
  assert.deepEqual(T.locateHit(hits, 3), {hit: hits[2], nth: 0});
  assert.equal(T.locateHit(hits, 4), null);
  assert.equal(T.locateHit(hits, -1), null);
  assert.equal(T.findHits([{id: 'x', role: 'user', text: 'aaaa'}], 'aa')[0].count, 2, '不重叠地数');
});

test('shownFor：命中在还没显示的旧回合里时，每次多接 TAIL_TURNS 直到它进窗口', () => {
  const rows = [];
  for (let i = 0; i < 70; i++) rows.push({id: `u${i}`, role: 'user', text: ''}, {id: `a${i}`, role: 'assistant', text: ''});
  assert.equal(T.shownFor(rows, 139, T.TAIL_TURNS), T.TAIL_TURNS);
  assert.equal(T.shownFor(rows, 70, T.TAIL_TURNS), T.TAIL_TURNS * 2);
  assert.equal(T.shownFor(rows, 0, T.TAIL_TURNS), T.TAIL_TURNS * 3);
});
