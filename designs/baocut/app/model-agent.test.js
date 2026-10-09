const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-agent.js');
const A = global.window.BC_AGENT;

test('conversationRows groups adjacent tools without crossing answers or permissions', () => {
  const messages = ['user', 'tool', 'tool', 'permission', 'tool', 'assistant', 'receipt'].map((role, i) => ({id: String(i), role}));
  const rows = A.conversationRows(messages);
  assert.deepEqual(rows.map((r) => r.role), ['user', 'work', 'permission', 'work', 'assistant']);
  assert.deepEqual(rows[1].items.map((m) => m.id), ['1', '2']);
  assert.deepEqual(rows[4].work.map((m) => m.id), ['6']);
  assert.equal(messages.length, 7);
  assert.deepEqual(A.conversationRows([]), []);
});

test('conversationRows：变更回执与工具收进同一组，两段文字之间只有一行', () => {
  const messages = [{id: 'u', role: 'user'}, {id: 'a', role: 'assistant', text: 'x'}, {id: 't1', role: 'tool', tool: 'speech_search'},
    {id: 'r1', role: 'receipt', text: '已写入译文'}, {id: 't2', role: 'tool', tool: 'exports_create'}, {id: 'r2', role: 'receipt', text: '已应用'},
    {id: 'b', role: 'assistant', text: 'y'}, {id: 'p', role: 'permission'}, {id: 'r3', role: 'receipt', text: '已应用'}, {id: 'u2', role: 'user'},
    {id: 'r4', role: 'receipt', text: '已应用'}];
  const rows = A.conversationRows(messages);
  assert.deepEqual(rows.map((r) => r.role), ['user', 'assistant', 'assistant', 'permission', 'work', 'user', 'work']);
  assert.deepEqual(rows[1].work.map((m) => m.id), ['t1', 'r1', 't2', 'r2']);
  assert.deepEqual(rows[4].items.map((m) => m.id), ['r3']);
  assert.deepEqual(rows[6].items.map((m) => m.id), ['r4']);
});

test('conversationRows：紧跟回答的工具挂到那条回答的 work 上，原消息不被改写', () => {
  const messages = [{id: 'u', role: 'user'}, {id: 'a', role: 'assistant', text: 'x'}, {id: 't1', role: 'tool', cmd: 'bcut x'},
    {id: 't2', role: 'tool', cmd: '读取 y'}, {id: 'b', role: 'assistant', text: 'y'}];
  const rows = A.conversationRows(messages);
  assert.deepEqual(rows.map((r) => r.role), ['user', 'assistant', 'assistant']);
  assert.deepEqual(rows[1].work.map((m) => m.id), ['t1', 't2']);
  assert.equal(messages[1].work, undefined);
  assert.equal(rows[2].work, undefined);
});

test('workSummary：按种类归纳、首次出现排序，没有种类就退回计数', () => {
  assert.equal(A.workKind({cmd: '读取 transcript.json'}), 'file_read');
  assert.equal(A.workKind({cmd: 'bcut project info'}), 'command');
  assert.equal(A.workKind({cmd: 'x', kind: 'search'}), 'search');
  assert.equal(A.workSummary([]), '0 项活动');
});

test('workSummary：读 / 改的文件按去重后的路径计数，新 kind 与老写法同义', () => {
  assert.equal(A.workKind({kind: 'read'}), 'file_read');
  assert.equal(A.workKind({kind: 'edit'}), 'file_change');
  assert.equal(A.workKind({kind: 'other'}), 'tool');
  assert.equal(A.workKind({tool: 'speech_search', kind: 'read'}), 'tool');
  assert.equal(A.workSummary([{cmd: '读取 a · 1 段'}, {cmd: 'bcut a'}, {cmd: '读取 b'}, {cmd: '读取 a · 2 段'}]), '读取了 2 个文件、运行了命令');
  assert.equal(A.workSummary([{kind: 'edit', summary: '分镜.md'}, {kind: 'edit', summary: '分镜.md'}, {kind: 'edit', summary: 'notes.md'}]), '修改了 2 个文件');
  assert.equal(A.workSummary([{kind: 'search', summary: '口癖'}, {kind: 'other', summary: '本机模型'}]), '搜索了、调用了工具');
  assert.equal(A.workKind({role: 'receipt', text: '已应用'}), 'video');
  assert.equal(A.workSummary([{tool: 'edits_apply'}, {role: 'receipt'}, {cmd: 'bcut x'}, {role: 'receipt'}]), '调用了工具、提交了 2 笔视频修改、运行了命令');
});

test('agoLabel：刚刚 / 分钟 / 小时 / 昨天 / 天', () => {
  assert.equal(A.agoLabel(0), '刚刚');
  assert.equal(A.agoLabel(18), '18 分钟前');
  assert.equal(A.agoLabel(60), '1 小时前');
  assert.equal(A.agoLabel(23 * 60 + 59), '23 小时前');
  assert.equal(A.agoLabel(24 * 60), '昨天');
  assert.equal(A.agoLabel(3 * 24 * 60), '3 天前');
});

test('bucket 与 agoLabel 同一条分界', () => {
  assert.equal(A.bucket(0), '今天');
  assert.equal(A.bucket(24 * 60 - 1), '今天');
  assert.equal(A.bucket(24 * 60), '昨天');
  assert.equal(A.bucket(48 * 60), '更早');
});

test('sessionTitle：第一句、去空白、超长截断、空串兜底', () => {
  assert.equal(A.sessionTitle('  把第 3 章的停顿压到 0.3 秒。然后导出。'), '把第 3 章的停顿压到 0.3 秒。');
  assert.equal(A.sessionTitle('给每章起个更短的标题'), '给每章起个更短的标题');
  assert.equal(A.sessionTitle('一'.repeat(40), 10), '一'.repeat(9) + '…');
  assert.equal(A.sessionTitle('   '), '新会话');
  assert.equal(A.sessionTitle('第一行\n第二行'), '第一行 第二行');
});

test('sortSessions：在跑的永远在上，其余按最近活动；同分稳定', () => {
  const list = [
    {id: 'a', status: 'done', ago: 60},
    {id: 'b', status: 'running', ago: 5},
    {id: 'c', status: 'done', ago: 18},
    {id: 'd', status: 'idle', ago: 18},
    {id: 'e', status: 'waiting', ago: 200},
  ];
  assert.deepEqual(A.sortSessions(list).map((s) => s.id), ['b', 'e', 'd', 'c', 'a']);
  // 不改原数组
  assert.deepEqual(list.map((s) => s.id), ['a', 'b', 'c', 'd', 'e']);
});

test('groupSessions：只出现有内容的桶，桶序固定', () => {
  const g = A.groupSessions([
    {id: 'a', status: 'done', ago: 3 * 24 * 60},
    {id: 'b', status: 'done', ago: 10},
    {id: 'c', status: 'done', ago: 30 * 60},
  ]);
  assert.deepEqual(g.map((x) => x.label), ['今天', '昨天', '更早']);
  assert.deepEqual(g.map((x) => x.items.map((s) => s.id)), [['b'], ['c'], ['a']]);
  assert.deepEqual(A.groupSessions([]), []);
});

const H = [
  {id: 'claude', name: 'Claude Code', found: true, dflt: true, models: [{id: 'sonnet', name: 'Sonnet', dflt: true}, {id: 'opus', name: 'Opus'}]},
  {id: 'codex', name: 'Codex CLI', found: false, models: [{id: 'gpt-5-codex', name: 'gpt-5-codex', dflt: true}]},
];

test('pickHarness：偏好 → 默认 → 第一个装着的 → null', () => {
  assert.equal(A.pickHarness(H, 'claude').id, 'claude');
  // 偏好的那个没装：不硬选它，回落到装着的
  assert.equal(A.pickHarness(H, 'codex').id, 'claude');
  assert.equal(A.pickHarness(H.map((h) => ({...h, found: false})), 'claude'), null);
  assert.equal(A.pickHarness([], 'claude'), null);
});

test('harnessLabel：默认委托 Agent；目录缺席不能掩盖指定模型', () => {
  assert.equal(A.harnessLabel(H[0], 'opus'), 'Claude Code · Opus');
  assert.equal(A.harnessLabel(H[0]), 'Claude Code · Agent 默认模型');
  assert.equal(A.harnessLabel(H[0], 'nope'), 'Claude Code · nope');
  assert.equal(A.harnessLabel(null), '未连接');
});

test('compactModelLabel：窄的时候只留级别名；认不出的原样返回（与 packages/ui agent-choice.ts 同一套用例）', () => {
  const cases = [['Sonnet 5.5', 'Sonnet'], ['Claude Opus 5.5', 'Opus'], ['Claude Sonnet 5', 'Sonnet'], ['GPT-5.6 Sol', 'Sol'],
    ['GPT-6.1 Sol', 'Sol'], ['GPT-6.1-Sol', 'Sol'], ['GPT-6-Astra', 'Astra'], ['GPT-5.5', 'GPT'], ['GPT-5.6 Luna', 'Luna'], ['Fable 5.1 [1m]', 'Fable'], ['Opus 4.6 (1M context)', 'Opus'],
    ['Gemini 3 Flash', 'Flash'], ['Grok 4.5', 'Grok'], ['Kimi K3', 'Kimi'], ['Opus', 'Opus'], ['Auto', 'Auto']];
  for (const [label, short] of cases) assert.equal(A.compactModelLabel(label), short, label);
  for (const label of ['gpt-6.1-sol', 'claude-sonnet-5-20260101', 'Use the default model (currently Opus 5.5)', 'corp-sonnet-proxy', 'A B C D E', '5.5']) {
    assert.equal(A.compactModelLabel(label), label, label);
  }
});

test('harnessShort：Agent 默认模型写「默认」，跟着正在用的模型走', () => {
  const h = {id: 'claude', name: 'Claude Code', models: [{id: 'sonnet', name: 'Sonnet 5.5'}, {id: 'opus', name: 'Opus 5.5'}]};
  assert.equal(A.harnessShort(h, 'sonnet'), 'Sonnet');
  assert.equal(A.harnessShort(h, null), '默认');
  assert.equal(A.harnessShort(h, null, 'opus'), 'Opus');
  assert.equal(A.harnessShort(h, 'nope-7'), 'nope-7');
  assert.equal(A.harnessShort(null), '未连接');
});

test('intentPrompt：带项目名与范围 / 语言；未知意图回 text', () => {
  const p = {title: '科浪访谈 第 42 期'};
  assert.match(A.intentPrompt({kind: 'translate', lang: '日语'}, p), /「科浪访谈 第 42 期」.*日语/);
  assert.match(A.intentPrompt({kind: 'polish', scope: '第 3 章'}, p), /第 3 章/);
  assert.match(A.intentPrompt({kind: 'cleanup'}, null), /这部视频全篇/);
  assert.equal(A.intentPrompt({kind: 'nope', text: '自定义'}, p), '自定义');
  assert.equal(A.intentPrompt(null, p), '');
  // 写作与发布（§15.11）：候选数 / 张数进句子，缺省 6 个标题、3 张封面
  assert.match(A.intentPrompt({kind: 'title', count: 9}, p), /起 9 个候选标题，角度各不相同/);
  assert.match(A.intentPrompt({kind: 'title'}, p), /起 6 个候选标题/);
  assert.match(A.intentPrompt({kind: 'desc'}, p), /简介，带章节时间码/);
  assert.match(A.intentPrompt({kind: 'cover', count: 4}, p), /做 4 张封面候选.*候选库/);
});

test('planFor：按关键词挑脚本；无项目时不写、不建任务', () => {
  assert.equal(A.planFor('把字幕翻译成英文', true).kind, 'translate');
  assert.equal(A.planFor('Translate to English please', true).kind, 'translate');
  assert.equal(A.planFor('把口癖和长停顿都剪掉', true).kind, 'cleanup');
  assert.equal(A.planFor('给每章起个更短的标题', true).kind, 'chapters');
  assert.equal(A.planFor('导出双语 SRT', true).kind, 'export');
  assert.equal(A.planFor('今天天气如何', true).kind, 'custom');
  const noProj = A.planFor('把字幕翻译成英文', false);
  assert.equal(noProj.kind, 'translate');
  assert.equal(noProj.write, null);
  assert.equal(noProj.task, null);
  // 有写入的脚本必有对应的任务与收据——放行卡之后要能落成一条后台任务
  A.PLAN_KINDS.forEach((k) => {
    const p = A.planFor({shortscut: '短视频', stale: '译文过期', translate: '翻译', cleanup: '口癖', chapters: '章节', polish: '润色', speakers: '说话人', export: '导出', dub: '配音', title: '起标题', crop: '裁剪', retranscribe: '重新转录', summary: '总结', blog: '博客', desc: '简介', cover: '封面'}[k], true);
    assert.equal(p.kind, k);
    // 写作与发布只读不写：没有放行卡，也不落任务
    if (p.write) assert.ok(p.write.cmd && p.task && p.receipt, k);
    else assert.ok(p.close && !p.task, k);
  });
});

test('planFor：挂着场景模板发来的先确认简报，不读不写、不建任务，关键词不抢先（template-spec §5.2）', () => {
  const p = A.planFor('把发布会剪成翻译字幕版\n模板：推广短片\n画幅与时长：9:16，约 30 秒', true);
  assert.equal(p.kind, 'brief');
  assert.match(p.summary, /推广短片/);
  assert.match(p.summary, /主题[\s\S]*目标[\s\S]*受众[\s\S]*材料/);
  assert.deepEqual([p.reads, p.write, p.task, p.close], [[], null, null, null]);
  assert.equal(A.planFor('把字幕翻译成英文', true).kind, 'translate');
});

test('shortscut 计划与意图：「剪成短视频」落到 shortscut，不被 cleanup 的「剪」抢走；只写候选库（§15.12）', () => {
  const p = {title: '科浪访谈 第 42 期'};
  const text = A.intentPrompt({kind: 'shortscut', extra: ['要 3 支，每支 30–60 秒']}, p);
  assert.match(text, /^从「科浪访谈 第 42 期」里挑几段.*我确认后再创建视频。要 3 支，每支 30–60 秒。$/);
  assert.match(A.intentPrompt({kind: 'shortscut', scope: '第 2 章'}, p), /的第 2 章里挑几段/);
  const plan = A.planFor(text, true);
  assert.equal(plan.kind, 'shortscut');
  assert.equal(plan.task.kind, 'shorts-cut');
  assert.match(plan.write.why, /不创建视频/);
  assert.equal(A.planFor('把口癖和长停顿都剪掉', true).kind, 'cleanup');
});

test('stale 计划与意图：有「剪切」也有「译文」的那句落到 stale，不落 cleanup / translate（第 196 轮）', () => {
  assert.equal(A.planFor('有 4 句译文的原文被剪切了，重译一下', true).kind, 'stale');
  assert.equal(A.planFor('把口癖和长停顿都剪掉', true).kind, 'cleanup');
  assert.equal(A.planFor('把字幕翻译成英文', true).kind, 'translate');
  const p = {title: '科浪访谈 第 42 期'};
  assert.match(A.intentPrompt({kind: 'stale'}, p), /原文改过.*只重译这些句子/);
  assert.match(A.intentPrompt({kind: 'stale', edited: 3, cut: 4}, p), /3 句原文改过、4 句原文被剪切.*按剪后的原文重译/);
  assert.doesNotMatch(A.intentPrompt({kind: 'stale', cut: 4}, p), /原文改过/);
});

test('syncAgent：落在编码 Agent 上时家 · 模型听输入框底栏那枚 chip 的（2026-09-21）', () => {
  const hs = [
    {id: 'claude', name: 'Claude Code', found: true, models: [{id: 'sonnet', name: 'Sonnet', dflt: true}]},
    {id: 'codex', name: 'Codex CLI', found: true, models: [{id: 'sol', name: 'GPT-5.6-Sol'}]},
  ];
  const ms = [{id: 'gpt-4o', name: 'gpt-4o', provider: 'OpenAI'}];
  const g = A.runnerOptions({harnesses: hs, models: ms});
  const claude = A.resolveRunner('agent:claude', g);
  assert.equal(A.syncAgent(claude, g, {harness: 'codex', model: 'sol'}).k, 'agent:codex:sol', 'Agent 的家 · 模型听 chip 的');
  const api = A.resolveRunner('api:gpt-4o', g);
  assert.equal(A.syncAgent(api, g, {harness: 'codex', model: 'sol'}).k, 'api:gpt-4o', '云模型 chip 表达不了，不动');
  assert.equal(A.syncAgent(claude, g, null).k, 'agent:claude', 'chip 还没落地就不动');
  assert.equal(A.syncAgent(claude, g, {harness: 'gone', model: null}).k, 'agent:claude', 'chip 那家不在候选里也不动');
  assert.equal(A.syncAgent(claude, g, {harness: 'codex', model: null}).k, 'agent:codex', 'chip 是「交给 Agent 自己决定」就落在那一家的默认模型上');
  assert.equal(A.syncAgent(null, g, {harness: 'codex', model: 'sol'}), null);
});

test('preferredRunner：工具页自己记的 → 偏好 Agent 挑就绪的 → 全局记忆；sessionProgress 从会话倒推四段', () => {
  const hs = [
    {id: 'claude', name: 'Claude Code', found: true, account: 'Claude Pro', models: [{id: 'sonnet', name: 'Sonnet', dflt: true}]},
    {id: 'codex', name: 'Codex CLI', found: false, models: []},
  ];
  const ms = [{id: 'claude-sonnet', name: 'claude-sonnet', provider: 'Anthropic', note: '默认'}];
  const g = A.runnerOptions({harnesses: hs, models: ms});
  assert.equal(A.preferredRunner(g, {global: 'api:claude-sonnet'}).k, 'api:claude-sonnet', '没偏好就是全局');
  assert.equal(A.preferredRunner(g, {global: 'api:claude-sonnet', prefer: 'agent'}).k, 'agent:claude', '偏好 Agent 且就绪');
  assert.equal(A.preferredRunner(g, {global: 'api:claude-sonnet', prefer: 'agent', own: 'agent:claude:sonnet'}).k, 'agent:claude:sonnet', '这一页记过就用它');
  assert.equal(A.preferredRunner(g, {global: 'api:claude-sonnet', prefer: 'agent', own: 'api:gone'}).k, 'agent:claude', '记的项不在了当没记');
  const gNoAg = A.runnerOptions({harnesses: [hs[1]], models: ms});
  assert.equal(A.preferredRunner(gNoAg, {global: 'api:claude-sonnet', prefer: 'agent'}).k, 'api:claude-sonnet', 'Agent 没就绪退回全局');

  assert.deepEqual(A.sessionProgress(null).cur, 0);
  const s = {id: 's', status: 'running', messages: [{role: 'user', text: 'x'}, {role: 'tool', cmd: 'bcut project info', status: 'done'}]};
  assert.deepEqual(A.sessionProgress(s), {cur: 0, pct: null, note: 'bcut project info', waiting: false, done: false});
  s.messages.push({role: 'permission', state: 'pending', cmd: 'bcut cleanup project.bcut --review'});
  assert.equal(A.sessionProgress(s).cur, 1);
  assert.equal(A.sessionProgress(s).waiting, true);
  s.messages[2].state = 'allowed';
  s.messages.push({role: 'tool', cmd: 'bcut cleanup project.bcut --review', status: 'run', taskId: 't1'});
  assert.deepEqual(A.sessionProgress(s, {id: 't1', pct: 36}), {cur: 2, pct: 36, note: 'bcut cleanup project.bcut --review', waiting: false, done: false});
  assert.equal(A.sessionProgress(s, {id: 't1', pct: 95}).cur, 3, '尾段算写入');
  s.messages.push({role: 'receipt', text: '已应用 · 9 处'});
  assert.deepEqual(A.sessionProgress(s, {id: 't1', pct: 100}), {cur: 4, pct: 100, note: '已应用 · 9 处', waiting: false, done: true});
});

test('rulePrefix / autoAllowed：记的是子命令前缀，不是整条命令', () => {
  assert.equal(A.rulePrefix('bcut translate project.bcut --lang en'), 'bcut translate');
  assert.equal(A.rulePrefix('bcut export a && bcut export b'), 'bcut export');
  assert.equal(A.rulePrefix('ffmpeg -i x'), 'ffmpeg');
  assert.equal(A.rulePrefix(''), '');
  assert.equal(A.autoAllowed('bcut translate x --lang ja', ['bcut translate']), true);
  assert.equal(A.autoAllowed('bcut polish x', ['bcut translate']), false);
  assert.equal(A.autoAllowed('', ['']), false);
});

test('readiness：三条各自判，云端是可选项', () => {
  const r = A.readiness({
    models: [{id: 'm', name: 'MOSS Transcribe', installed: true, dflt: true}],
    harnesses: H, preferred: 'claude',
    providers: [{connected: true}, {connected: false}],
  });
  assert.deepEqual(r.map((x) => x.ok), [true, true, true]);
  assert.equal(r[0].label, '语音模型 · MOSS Transcribe');
  assert.equal(r[1].label, 'Agent · Claude Code');
  assert.equal(r[2].label, '云端模型 · 1 个 provider');
  const none = A.readiness({models: [], harnesses: [], providers: []});
  assert.deepEqual(none.map((x) => x.ok), [false, false, false]);
  assert.equal(none[2].optional, true);
  assert.deepEqual(none[1].route, {r: 'settings', sec: 'agent'});
});

const S = [
  {id: 'a', project: 'p1', status: 'done', ago: 30},
  {id: 'b', project: 'p1', status: 'running', ago: 4},
  {id: 'c', project: 'p2', status: 'waiting', ago: 9},
  {id: 'd', project: 'p1', status: 'idle', ago: 2},
  {id: 'e', project: 'p1', status: 'done', ago: 90},
  {id: 'f', project: null, status: 'idle', ago: 500},
];

test('liveSessions：只留在跑 / 等你的，跨项目，在跑的在前', () => {
  assert.deepEqual(A.liveSessions(S).map((s) => s.id), ['b', 'c']);
  assert.deepEqual(A.liveSessions([]), []);
});

test('sessionsOf / projectTree：会话挂在自己的项目下，默认露 3 条', () => {
  assert.deepEqual(A.sessionsOf(S, 'p1').map((s) => s.id), ['b', 'd', 'a', 'e']);
  assert.deepEqual(A.sessionsOf(S, 'p1', 2).map((s) => s.id), ['b', 'd']);
  const t = A.projectTree([{id: 'p1'}, {id: 'p2'}, {id: 'p3'}], S);
  assert.equal(t.rows[0].sessions.length, 3);
  assert.equal(t.rows[0].more, 1);
  assert.equal(t.rows[0].live, true);
  assert.equal(t.rows[2].sessions.length, 0);
  assert.equal(t.rows[2].live, false);
  assert.deepEqual(t.loose.map((s) => s.id), ['f']);
  assert.equal(t.hiddenRows, 0);
  assert.equal(t.looseHidden, 0);
});

test('sortProjects：默认最近打开，缺 otime 回落 mtime；缺 ctime 沉底；同分保持原序', () => {
  const P = [
    {id: 'a', title: '乙', mtime: 5, otime: 90, ctime: 400},
    {id: 'b', title: '甲', mtime: 60, otime: 1},
    {id: 'c', title: '丙', mtime: 30, ctime: 400},
    {id: 'd', title: 'Alpha', mtime: 30, ctime: 100},
  ];
  assert.deepEqual(A.sortProjects(P).map((p) => p.id), ['b', 'c', 'd', 'a']);
  assert.deepEqual(A.sortProjects(P, 'edited').map((p) => p.id), ['a', 'c', 'd', 'b']);
  assert.deepEqual(A.sortProjects(P, 'created').map((p) => p.id), ['d', 'a', 'c', 'b']);
  assert.deepEqual(A.sortProjects([{id: 'x', title: 'Beta'}, {id: 'y', title: 'Alpha'}], 'title').map((p) => p.id), ['y', 'x']);
  assert.deepEqual(A.TREE_SORTS.map((s) => s.key), ['opened', 'edited', 'created', 'title']);
});

test('projectTree：limit / looseLimit 截断两段并记下没加载的条数', () => {
  const P = [{id: 'p1', otime: 3}, {id: 'p2', otime: 1}, {id: 'p3', otime: 2}];
  const L = [1, 2, 3, 4, 5, 6, 7].map((i) => ({id: 'l' + i, project: null, status: 'idle', ago: i}));
  const t = A.projectTree(P, L, {limit: 2, looseLimit: 5});
  assert.deepEqual(t.rows.map((r) => r.project.id), ['p2', 'p3']);
  assert.equal(t.hiddenRows, 1);
  assert.equal(t.loose.length, 5);
  assert.equal(t.looseHidden, 2);
  assert.equal(A.loadMore(5, 5, 7), 7);
  assert.equal(A.loadMore(2, 8, 30), 10);
});

test('mentionQuery / applyMention：只认末尾正在输入的 @token', () => {
  assert.equal(A.mentionQuery('把 @产'), '产');
  assert.equal(A.mentionQuery('@'), '');
  assert.equal(A.mentionQuery('a@b'), null);
  assert.equal(A.mentionQuery('把 @章节:开场 的'), null);
  assert.equal(A.applyMention('参考 @产', '@章节:产品演示'), '参考 @章节:产品演示 ');
  assert.equal(A.applyMention('没有 at', '@术语表'), '没有 at @术语表 ');
  assert.equal(A.applyMention('', '@术语表'), '@术语表 ');
});

test('mentionItems：这部视频的对象在前、其他视频只读参考在后，按查询过滤', () => {
  const ctx = {
    project: {id: 'p1', title: '甲'},
    projects: [{id: 'p1', title: '甲'}, {id: 'p2', title: '乙的访谈'}],
    chapters: [{id: 'c1', title: '开场'}, {id: 'c3', title: '产品演示'}],
    speakers: [{id: 's1', name: '林澈'}],
    langs: [{code: 'en', name: 'English'}],
  };
  const g = A.mentionItems('', ctx);
  assert.deepEqual(g.map((x) => x.group), ['这部视频', '其他视频（只读参考）']);
  assert.deepEqual(g[0].items.map((i) => i.kind), ['chapter', 'chapter', 'speaker', 'file', 'glossary', 'file']);
  assert.deepEqual(g[1].items.map((i) => i.label), ['乙的访谈']);
  assert.deepEqual(A.mentionItems('产', ctx)[0].items.map((i) => i.ref), ['@章节:产品演示']);
  assert.deepEqual(A.mentionItems('访谈', ctx).map((x) => x.group), ['其他视频（只读参考）']);
  // 没绑项目：只有其他项目一组
  assert.deepEqual(A.mentionItems('', {projects: ctx.projects}).map((x) => x.group), ['其他视频（只读参考）']);
  // data.js 的 speakers 是按 id 键的对象（第 110 轮浏览器里 @ 一下就白屏的那个 bug）
  const keyed = A.mentionItems('林', {...ctx, speakers: {s1: {id: 's1', name: '林澈'}}});
  assert.deepEqual(keyed[0].items.map((i) => i.ref), ['@说话人:林澈']);
});

test('stepSummary：放行的是看得见规模的一步，LLM 步带模型名、本机步带引擎名', () => {
  const tr = A.planFor('翻译', true);
  assert.equal(A.stepSummary(tr, {model: 'gpt-4o'}), '这一步会用 gpt-4o 翻译 42 句');
  assert.equal(A.stepSummary(tr, {model: 'gpt-4o', scope: '第 3 章', count: 11}), '这一步会用 gpt-4o 翻译第 3 章的 11 句');
  assert.equal(A.stepSummary(A.planFor('说话人', true), {model: 'gpt-4o'}), '这一步会用 本机声纹模型 识别 62 句的说话人');
  assert.equal(A.stepSummary(A.planFor('天气', true)), '');
  A.PLAN_KINDS.forEach((k) => { const p = A.planFor({shortscut: '短视频', stale: '译文过期', translate: '翻译', cleanup: '口癖', chapters: '章节', polish: '润色', speakers: '说话人', export: '导出', dub: '配音', title: '起标题', crop: '裁剪', retranscribe: '重新转录', summary: '总结', blog: '博客', desc: '简介', cover: '封面'}[k], true); if (p.write) assert.ok(p.step, k); });
});

test('startRoute：只有文件走向导，有话就走 Agent，都没有为 null', () => {
  assert.deepEqual(A.startRoute('', 'a.mp4'), {kind: 'wizard', file: 'a.mp4'});
  assert.deepEqual(A.startRoute('加字幕并翻译', null), {kind: 'agent', text: '加字幕并翻译', file: null});
  assert.deepEqual(A.startRoute(' 翻译 ', 'a.mp4'), {kind: 'agent', text: '翻译', file: 'a.mp4'});
  assert.equal(A.startRoute('  ', null), null);
});

test('scopeOptions：整篇在前，每章规模按时长折算；关掉的编码 Agent 不被挑中', () => {
  const ch = [{id: 'c1', title: '开场', start: 0, end: 22}, {id: 'c2', title: '演示', start: 22, end: 206}];
  const sc = A.scopeOptions(42, ch, 206);
  assert.equal(sc[0].k, 'all');
  assert.equal(sc[0].count, 42);
  assert.equal(sc[1].count, 4);
  assert.equal(sc[2].count, 38);
  assert.equal(sc[2].label, '第 2 章 · 演示');
  const hs = [{id: 'a', found: true, dflt: true, enabled: false}, {id: 'b', found: true}];
  assert.equal(A.pickHarness(hs, null).id, 'b');
  assert.equal(A.pickHarness([{id: 'a', found: true, enabled: false}], null), null);
});

test('runnerOptions / defaultRunner / resolveRunner：谁来做是一份全局记忆，按就绪挑默认，按种类回落', () => {
  const hs = [
    {id: 'claude', name: 'Claude Code', found: true, account: 'Claude Pro', models: [{id: 'sonnet', name: 'Sonnet', dflt: true}, {id: 'opus', name: 'Opus'}]},
    {id: 'codex', name: 'Codex CLI', found: false, models: [{id: 'gpt-5', name: 'gpt-5'}]},
    {id: 'off', name: 'Off', found: true, enabled: false, models: [{id: 'x', name: 'x'}]},
  ];
  const ms = [{id: 'claude-sonnet', name: 'claude-sonnet', provider: 'Anthropic', note: '默认'},
    {id: 'gemini', name: 'gemini', provider: 'Google', note: '未连接 key'}];
  const g = A.runnerOptions({harnesses: hs, models: ms});
  // 第 186 轮：Agent 组两级——每家一条「Agent 默认模型」打头（模型留空），再是目录里的模型；停用的家不列
  assert.deepEqual(g[0].items.map((i) => i.k), ['agent:claude', 'agent:claude:sonnet', 'agent:claude:opus', 'agent:codex', 'agent:codex:gpt-5']);
  assert.deepEqual(g[0].items.map((i) => i.ready), [true, true, true, false, false]);
  assert.deepEqual(g[0].items.slice(0, 2).map((i) => [i.label, i.mname, i.msub, i.sub]),
    [['Claude Code · Agent 默认模型', 'Agent 默认模型', '按 CLI 配置选择', 'Claude Pro'], ['Claude Code · Sonnet', 'Sonnet', '默认', 'Claude Pro']]);
  assert.deepEqual(g[1].items.map((i) => [i.k, i.ready]), [['api:claude-sonnet', true], ['api:gemini', false]]);
  // 两个都就绪 → Agent（product-design §5.10）；只有 API 就绪 → API；都没有 → 第一条 Agent
  assert.equal(A.defaultRunner(g), 'agent:claude');
  assert.equal(A.defaultRunner(A.runnerOptions({harnesses: [hs[1]], models: ms})), 'api:claude-sonnet');
  assert.equal(A.defaultRunner(A.runnerOptions({harnesses: hs, models: [ms[1]]})), 'agent:claude');
  assert.equal(A.defaultRunner(A.runnerOptions({harnesses: [hs[1]], models: [ms[1]]})), 'agent:codex');
  // 记忆命中原样返回；本机工具页拿到 api 记忆时回落成 local；agent 记忆在 Agent 组里回落到就绪那条
  assert.equal(A.resolveRunner('agent:claude:opus', g).label, 'Claude Code · Opus');
  const loc = A.runnerOptions({harnesses: hs, local: {label: '本机声纹模型'}});
  assert.equal(A.resolveRunner('api:claude-sonnet', loc).kind, 'local');
  // 记的模型不在目录里但这家还在：保留模型、标「当前列表未提供」；这家也没了才按种类回落
  const kept = A.resolveRunner('agent:codex:nope', loc);
  assert.deepEqual([kept.k, kept.harness, kept.model, kept.label, kept.msub, kept.ready], ['agent:codex:nope', 'codex', 'nope', 'Codex CLI · nope', '当前列表未提供此模型', false]);
  assert.equal(A.resolveRunner('agent:gemini:pro', loc).k, 'agent:claude');
  assert.equal(A.resolveRunner(null, g).k, 'agent:claude');
});

test('runnerTabs：弹层顶部两段——Agent 数家不数模型，本机组不标数，选中项所在组亮起', () => {
  const hs = [
    {id: 'claude', name: 'Claude Code', found: true, account: 'Claude Pro', models: [{id: 'sonnet', name: 'Sonnet', dflt: true}, {id: 'opus', name: 'Opus'}]},
    {id: 'codex', name: 'Codex CLI', found: true, account: 'ChatGPT Plus', models: [{id: 'gpt-5', name: 'gpt-5'}]},
    {id: 'pi', name: 'Pi', found: true, extra: true, account: 'Pi', models: [{id: 'a', name: 'a'}]},
    {id: 'gemini', name: 'Gemini CLI', found: false, extra: true, models: []},
  ];
  const ms = [{id: 'claude-sonnet', name: 'claude-sonnet', provider: 'Anthropic', note: '默认'},
    {id: 'gpt-4o', name: 'gpt-4o', provider: 'OpenAI'}];
  const g = A.runnerOptions({harnesses: hs, models: ms});
  assert.deepEqual(g.map((x) => [x.kind, x.tab]), [['agent', '交给 Agent'], ['api', '直接调模型']]);
  // 三家装着（没检测到的 extra 不列），Agent 组 items 是 3 + 4 条，段上只数 3 家
  const tabs = A.runnerTabs(g, A.resolveRunner('api:gpt-4o', g));
  assert.deepEqual(tabs.map((t) => [t.k, t.label, t.count, t.on]), [['agent', '交给 Agent', 3, false], ['api', '直接调模型', 2, true]]);
  assert.equal(tabs[0].desc, '本机，用你的订阅，写入前会问你');
  assert.deepEqual(A.runnerTabs(g, A.resolveRunner('agent:claude:opus', g)).map((t) => t.on), [true, false]);
  // 没选中项落在第一组；本机那一组不标数
  assert.deepEqual(A.runnerTabs(g, null).map((t) => t.on), [true, false]);
  const loc = A.runnerOptions({harnesses: hs, local: {label: '本机声纹模型'}});
  assert.deepEqual(A.runnerTabs(loc, A.resolveRunner('local', loc)).map((t) => [t.k, t.label, t.count, t.on]), [['agent', '交给 Agent', 3, false], ['local', '直接跑', null, true]]);
});

test('stepSummary / intentPrompt：Agent 进句子是「让」，勾选项成「先…再…」，附加要求接在意图句后', () => {
  const tr = A.planFor('翻译', true);
  assert.equal(A.stepSummary(tr, {agent: 'Claude Code · Sonnet'}), '这一步会让 Claude Code · Sonnet 翻译 42 句，写入前会先问你');
  assert.equal(A.stepSummary(tr, {model: 'gpt-4o', pre: '润色原文'}), '这一步会用 gpt-4o 先润色原文，再翻译 42 句');
  const p = A.intentPrompt({kind: 'chapters', extra: ['先润色并分段', '', '  ']}, {title: '甲'});
  assert.equal(p, '给「甲」按话题分出章节，每章起一个短标题。先润色并分段。');
  assert.equal(A.intentPrompt({kind: 'chapters'}, {title: '甲'}), '给「甲」按话题分出章节，每章起一个短标题。');
  assert.equal(A.intentPrompt({text: '随便', extra: ['语气轻松一点。']}), '随便语气轻松一点。');
});

test('composerFoot：脚注随编码 Agent 变，订阅名只取 account 第一段', () => {
  assert.equal(A.composerFoot({name: 'Claude Code', account: 'Claude Pro 订阅 · 已登录'}),
    '在本机 Claude Code 里运行，用你的 Claude Pro 订阅；每次写入视频前都会先问你。Enter 发送，Shift+Enter 换行，@ 引用参考，/ 调用工具。');
  assert.equal(A.composerFoot({name: 'Codex CLI', account: 'ChatGPT Plus / Pro 订阅'}),
    '在本机 Codex CLI 里运行，用你的 ChatGPT Plus / Pro 订阅；每次写入视频前都会先问你。Enter 发送，Shift+Enter 换行，@ 引用参考，/ 调用工具。');
  assert.match(A.composerFoot(null), /^在本机 Claude Code 里运行，用你自己的订阅；/);
});

test('slashQuery / slashItems / applySlash：只认开头的 /token，选中留 `/cmd ` 在正文里', () => {
  const cmds = [{cmd: '/translate', label: '翻译字幕'}, {cmd: '/polish', label: '润色文稿'}];
  assert.equal(A.slashQuery('/'), '');
  assert.equal(A.slashQuery('/tra'), 'tra');
  assert.equal(A.slashQuery('/translate 日语'), null);
  assert.equal(A.slashQuery('把 /tra'), null);
  assert.deepEqual(A.slashItems('', cmds).map((c) => c.cmd), ['/translate', '/polish']);
  assert.deepEqual(A.slashItems('po', cmds).map((c) => c.cmd), ['/polish']);
  assert.deepEqual(A.slashItems('润色', cmds).map((c) => c.cmd), ['/polish']);
  assert.equal(A.applySlash('/tra', '/translate'), '/translate ');
  assert.equal(A.applySlash('', '/polish'), '/polish ');
  assert.equal(A.applySlash('/x 这一章', '/polish'), '/polish 这一章');
});

test('访问模式：四档两两可分，规则层先于模式层', () => {
  assert.deepEqual(A.MODE_KEYS, ['ask', 'autoAcceptEdits', 'auto', 'fullAccess']);
  assert.equal(A.normalizeMode('乱写'), 'ask');
  assert.equal(A.normalizeMode(undefined), 'ask');
  assert.ok(A.modeRank('fullAccess') > A.modeRank('ask'));
  // 监督：常规写入也要问
  assert.deepEqual(A.modeGate('ask', 'bcut translate p.bcut --lang en', []), {auto: false, reason: null});
  // 规则命中时不看模式——它更窄也更好解释
  assert.deepEqual(A.modeGate('ask', 'bcut translate p.bcut --lang en', ['bcut translate']),
    {auto: true, reason: 'rule'});
  // 自动接受修改 / 自动：常规放行，但记录行不是同一句
  assert.deepEqual(A.modeGate('autoAcceptEdits', 'bcut polish p.bcut', []), {auto: true, reason: 'edit'});
  assert.deepEqual(A.modeGate('auto', 'bcut polish p.bcut', []), {auto: true, reason: 'mode'});
  // 编辑类 = 走 bcut 写项目；其余任意命令算命令类。没有「高风险命令集」这一层。
  assert.ok(A.isEditWrite('bcut export p.bcut --to mp4'));
  assert.ok(A.isEditWrite('bcut speakers p.bcut --apply'));
  assert.ok(!A.isEditWrite('ffmpeg -i a.mp4 b.mov'));
  // 自动接受修改：命令类仍弹卡；自动 / 完全访问：全部放行
  assert.deepEqual(A.modeGate('autoAcceptEdits', 'ffmpeg -i a.mp4 b.mov', []), {auto: false, reason: null});
  assert.deepEqual(A.modeGate('auto', 'ffmpeg -i a.mp4 b.mov', []), {auto: true, reason: 'mode'});
  assert.deepEqual(A.modeGate('fullAccess', 'ffmpeg -i a.mp4 b.mov', []), {auto: true, reason: 'mode'});
  // 导出与识别说话人不再被单挑出来：它们和别的 bcut 写入同档
  assert.deepEqual(A.modeGate('autoAcceptEdits', 'bcut export p.bcut --to mp4', []), {auto: true, reason: 'edit'});
  assert.deepEqual(A.modeGate('auto', 'bcut speakers p.bcut --apply', []), {auto: true, reason: 'mode'});
});

test('访问模式：四档永远可选，新会话继承上一条', () => {
  // 没有 clampMode / modeSelectable 这类天花板：模型层不提供「把某一档关掉」的能力
  assert.equal(A.clampMode, undefined);
  assert.equal(A.modeSelectable, undefined);
  assert.equal(A.isRiskyWrite, undefined);
  // 新会话优先继承当前会话，其次全局种子，都没有就监督
  assert.equal(A.nextSessionMode({mode: 'auto'}, 'fullAccess'), 'auto');
  assert.equal(A.nextSessionMode(null, 'fullAccess'), 'fullAccess');
  assert.equal(A.nextSessionMode(null, null), 'ask');
  assert.equal(A.nextSessionMode({mode: '乱写'}, null), 'ask');
});

test('autoAllowLabel / modeFoot / modeToast：一家人的句式', () => {
  assert.equal(A.autoAllowLabel('rule', 'bcut translate'), '自动允许 · 规则 bcut translate');
  assert.equal(A.autoAllowLabel('edit'), '自动允许 · 编辑');
  assert.equal(A.autoAllowLabel('mode'), '自动允许 · 访问模式');
  assert.equal(A.autoAllowLabel('loop'), '自动允许 · 应答环');
  assert.equal(A.modeFoot('ask'), '每次写入视频前都会先问你。');
  assert.match(A.modeFoot('autoAcceptEdits'), /其它命令仍会问你/);
  assert.match(A.modeFoot('fullAccess'), /不再逐次问你/);
  const list = [{k: 'auto', label: '自动'}, {k: 'ask', label: '监督'}];
  assert.equal(A.modeLabel(list, 'auto'), '自动');
  assert.equal(A.modeLabel(list, '乱写'), '监督');
  assert.match(A.modeToast(list, 'auto'), /^访问模式 · 自动：/);
  for (const status of ['running', 'waiting']) {
    assert.equal(A.modeToast(list, 'auto', status), '下一轮使用「自动」，本轮继续按原访问模式执行。');
  }
});

test('agentAvailability / homeMode：装了且启用 = agent；都停用 = off；一个没装 = missing', () => {
  const on = A.agentAvailability(H, 'claude');
  assert.equal(on.state, 'ready'); assert.equal(on.harness.id, 'claude');
  assert.equal(A.homeMode(H, 'claude'), 'agent');
  const off = A.agentAvailability(H.map((h) => ({...h, enabled: false})), 'claude');
  assert.equal(off.state, 'off'); assert.equal(off.harness, null);
  assert.deepEqual(off.installed.map((h) => h.id), H.filter((h) => h.found).map((h) => h.id));
  assert.equal(A.homeMode(H.map((h) => ({...h, enabled: false}))), 'setup');
  const none = A.agentAvailability(H.map((h) => ({...h, found: false})));
  assert.equal(none.state, 'missing'); assert.deepEqual(none.installed, []);
  assert.equal(A.homeMode([]), 'setup');
});

test('setupGuide：没装引导去连接，都停用当场可启用；就绪时不出卡', () => {
  assert.equal(A.setupGuide(A.agentAvailability(H, 'claude')), null);
  const miss = A.setupGuide(A.agentAvailability(H.map((h) => ({...h, found: false}))));
  assert.equal(miss.state, 'missing'); assert.equal(miss.cta, '连接 Agent'); assert.equal(miss.harness, null);
  const off = A.setupGuide(A.agentAvailability(H.map((h) => ({...h, enabled: false}))));
  assert.equal(off.state, 'off'); assert.equal(off.harness.id, 'claude'); assert.equal(off.cta, '启用 Claude Code');
  assert.match(off.body, /Claude Code/);
});

test('providerRows / modelRows：第一级按 provider 一行、副文案随状态；第二级默认模型在前、目录外的当前模型也露出', () => {
  const sel = {harness: 'claude', model: 'opus'};
  const rows = A.providerRows(H, sel);
  assert.deepEqual(rows.map((r) => [r.id, r.state, r.on]), [['claude', 'ready', true], ['codex', 'missing', false]]);
  assert.equal(rows[0].sub, 'Opus · 本机');
  assert.equal(A.providerRows([{...H[0], account: 'Claude Pro 订阅 · 已登录'}], sel)[0].sub, 'Opus · Claude Pro 订阅');
  assert.match(rows[1].sub, /^未安装/);
  assert.equal(A.providerRows(H.map((h) => ({...h, enabled: false})), sel)[0].sub, '已在设置里停用');
  assert.equal(A.providerRows(H, {harness: 'claude', model: null})[0].sub, 'Agent 默认模型 · 本机');
  assert.equal(A.providerRows(H, {harness: 'claude', model: null, activeModel: 'opus'})[0].sub, 'Opus · 本机');
  assert.equal(A.harnessLabel(H[0], null, 'opus'), 'Claude Code · Opus');
  assert.equal(A.modelRows(H[0], {harness: 'claude', model: null, activeModel: 'opus'})[0].sub,
    '按 CLI 配置选择 · Opus');
  const ms = A.modelRows(H[0], sel);
  assert.deepEqual(ms.map((m) => [m.id, m.on]), [[null, false], ['sonnet', false], ['opus', true]]);
  assert.deepEqual(A.modelRows(H[0], {harness: 'claude', model: 'nope'}).slice(0, 2).map((m) => [m.id, m.on]), [[null, false], ['nope', true]]);
  // 选中的是另一家：这一家没有任何一行打勾
  assert.ok(A.modelRows(H[0], {harness: 'codex', model: null}).every((m) => !m.on));
  assert.deepEqual(A.modelRows(null, sel), []);
});

test('第 207 轮：翻译脚本的目标语跟着话走，任务记录带 target', () => {
  const en = A.planFor('把字幕翻译成英文', true);
  assert.equal(en.task.target, 'en');
  assert.match(en.write.cmd, /--lang en/);
  const ja = A.planFor('翻译成日文', true);
  assert.equal(ja.task.target, 'ja');
  assert.equal(ja.task.title, '翻译 · 中 → 日本語');
  assert.match(ja.write.cmd, /--lang ja/);
  assert.equal(A.planFor('翻译成日文', false).task, null);
});

test('斜杠命令点名计划：每条命令都有脚本，不靠关键词；翻译配音不被翻译抢走', () => {
  Object.keys(A.SLASH_KINDS).forEach((cmd) => {
    assert.ok(A.PLAN_KINDS.includes(A.SLASH_KINDS[cmd]), cmd);
    assert.equal(A.planFor(cmd + ' ', true).kind, A.SLASH_KINDS[cmd], cmd);
  });
  assert.equal(A.slashKind('/translate 日语'), 'translate');
  assert.equal(A.slashKind('把 /translate'), null);
  assert.equal(A.slashKind('/nope'), null);
  assert.equal(A.planFor('/title 起个标题', true).kind, 'title');
  assert.equal(A.planFor('给视频做翻译配音', true).kind, 'dub');
  assert.equal(A.planFor('给每章起个更短的标题', true).kind, 'chapters');
});

test('要在面板里看结果的计划带 open：工具名能被编辑器接单', () => {
  const withOpen = A.PLANS.filter((p) => p.open);
  assert.deepEqual(withOpen.map((p) => p.open.tool).sort(), ['blog', 'cover', 'crop', 'desc', 'dub', 'shortscut', 'summary', 'title']);
  withOpen.forEach((p) => { assert.ok(p.open.label && p.close.includes(`「${p.open.label}」`), p.kind); assert.ok(!/右侧/.test(p.close), p.kind); });
});

test('planFor：话里留着没填的待填项（[目标语言]）就先问，不猜一个值开工；模板任务仍走简报', () => {
  const p = A.planFor('转录这个视频，并翻译成[目标语言]，做成双语字幕。', true);
  assert.equal(p.kind, 'brief');
  assert.equal(p.write, null);
  assert.match(p.summary, /「目标语言」你还没写/);
  assert.deepEqual(A.missingSlots('给[产品]做推广，面向[受众]，[受众]要年轻'), ['产品', '受众']);
  assert.equal(A.askFor('转录这个视频，并翻译成日语，做成双语字幕。'), null);
  assert.match(A.planFor('给[产品]做推广\n模板：推广短片', true).summary, /场景模板「推广短片」/);
});
