const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
/* BADGE 词表从 data.js 原文读（整份 data.js 依赖一串编辑器模型，这里只要这张表） */
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname, 'data.js'), 'utf8');
const block = /const BADGE = \{([\s\S]*?)\n  \};/.exec(src)[1];
global.window.BC_DATA = {BADGE: Object.fromEntries([...block.matchAll(/(\w+):\s*\{label: '([^']+)',\s*tone: '([^']+)'\}/g)].map((m) => [m[1], {label: m[2], tone: m[3]}]))};
require('./model-import.js');
require('./model-agent.js');
require('./model-agent-cards.js');
const C = global.window.BC_AGENT_CARDS;
const D = global.window.BC_DATA;

const tr = (o) => Object.assign({id: 't1', kind: 'transcribe', project: 'v1', status: 'running', pct: 46, jobPhase: 'transcribing',
  model: 'moss-transcribe', runsOn: '本机', mediaSec: 1560, elapsedMs: 252000, leftMs: 296000}, o);

test('badge：说法与 data.js 的 BADGE 一致；指向视频的转录在跑 / 排队时以任务为准', () => {
  const words = Object.values(D.BADGE).map((b) => b.label);
  assert.deepEqual(words, ['未转录', '已转录', '转录中', '排队中', '失败']);
  const mv = {id: 'v1', status: 'complete'};
  assert.deepEqual(C.badge(mv, []), {k: 'complete', label: '已转录', tone: 'positive', text: '已转录'});
  assert.equal(C.badge(mv, [tr()]).text, '转录中 · 46%');
  assert.equal(C.badge(mv, [tr({status: 'queued', queuePos: 2})]).text, '排队中 · 第 2 位');
  assert.equal(C.badge(mv, [tr({kind: 'translate', status: 'done'})]).k, 'complete', '翻译完了不改视频的转录状态');
  assert.equal(C.badge(mv, [tr({project: 'other'})]).k, 'complete');
  assert.equal(C.badge({id: 'v2', status: 'transcribing', progress: 12}, []).text, '转录中 · 12%');
  assert.equal(C.badge({id: 'v3', status: 'error'}, []).label, '失败');
  assert.equal(C.badge({id: 'v4', status: 'weird'}, []).k, 'ready');
  words.forEach((w) => assert.ok(['未转录', '已转录', '转录中', '排队中', '失败'].includes(w)));
});

test('badge：转录没在跑、有翻译在跑时写「翻译中」；智能体自己翻译没有百分比；转录在跑时以转录为准', () => {
  const mv = {id: 'v1', status: 'complete'};
  const tl = (o) => tr(Object.assign({id: 'l1', kind: 'translate', pct: 61, step: 'translate', lang: '英语'}, o));
  assert.deepEqual(C.badge(mv, [tl()]), {k: 'translating', label: '翻译中', tone: 'accent', text: '翻译中 · 61%'});
  assert.equal(C.badge(mv, [tl({byAgent: true, pct: null})]).text, '翻译中');
  assert.equal(C.badge(mv, [tl(), tl({id: 'l2', lang: '日本語', pct: 10})]).text, '翻译中', '两门一起翻不写哪一门的百分比');
  assert.equal(C.badge(mv, [tl({status: 'queued'})]).k, 'complete', '排队的翻译还没开始');
  assert.equal(C.badge(mv, [tl(), tr()]).text, '转录中 · 46%');
  assert.equal(C.badge(mv, [tl({project: 'other'})]).k, 'complete');
  assert.ok(!Object.values(D.BADGE).some((b) => b.label === '翻译中'), '翻译中不进视频的状态词表');
});

test('jobRow：智能体自己翻译是不确定的细条、写一共多少句，不给取消', () => {
  const r = C.jobRow({id: 'l1', kind: 'translate', project: 'v1', status: 'running', pct: null, byAgent: true, lang: '英语',
    linesTotal: 62, elapsedMs: 40000, cancellable: true});
  assert.equal(r.name, '翻译 · 英语');
  assert.equal(r.pct, null);
  assert.equal(r.tail, null);
  assert.equal(r.line, '智能体逐句翻译 · 共 62 句');
  assert.equal(r.time, '已用 0:40');
  assert.deepEqual(r.actions, []);
  const done = C.jobRow({id: 'l1', kind: 'translate', project: 'v1', status: 'done', byAgent: true, lang: '英语', result: {units: 62}});
  assert.deepEqual(done.facts, ['英语', '62 条']);
});

test('sessionJobs：这条会话起的或引用过的活，按第一次引用排；别处的活、合成语音与生图不进视频卡', () => {
  const tasks = [
    {id: 'x', kind: 'export', project: 'v1', session: 's1'},
    {id: 'a', kind: 'transcribe', project: 'v1'},
    {id: 'b', kind: 'translate', project: 'v1'},
    {id: 'c', kind: 'tts', project: 'v1', session: 's1'},
    {id: 'd', kind: 'export', project: 'v1', session: 'other'},
    {id: 'e', kind: 'export', project: 'v2', session: 's1'},
  ];
  const sess = {id: 's1', messages: [{id: 'm1', role: 'tool', taskId: 'b'}, {id: 'm2', role: 'tool', taskId: 'a'}, {id: 'm3', role: 'tool', taskId: 'c'}]};
  assert.deepEqual(C.sessionJobs('v1', sess, tasks).map((t) => t.id), ['b', 'a', 'x']);
});

test('内部检查不占视频卡的活与折叠计数，正式分段导出仍显示', () => {
  const tasks = [
    {id: 'delivery', kind: 'export', purpose: 'deliverable', project: 'v1', session: 's1', status: 'done', files: [{name: 'sample.part1.mp4', durationSec: 1}]},
    {id: 'preview', kind: 'export', purpose: 'preview', project: 'v1', session: 's1', status: 'running'},
  ];
  const jobs = C.sessionJobs('v1', {id: 's1'}, tasks);
  assert.deepEqual(jobs.map(t => t.id), ['delivery']);
  const folded = C.foldRows(jobs.map(C.jobRow));
  assert.equal(folded.earlier.length, 0);
});

test('jobRow：运行中是阶段、计数、百分比、已用与剩余与取消', () => {
  const r = C.jobRow(tr());
  assert.equal(r.name, '转录');
  assert.equal(r.tail, '46%');
  assert.equal(r.line, '识别中 · 已识别 11:58 / 26:00');
  assert.equal(r.time, '已用 4:12 · 预计还要 4:56');
  assert.deepEqual(r.actions.map((a) => a.label), ['取消']);
  assert.deepEqual(C.jobRow(tr({cancellable: false})).actions, []);
  const tl = C.jobRow({id: 'l', kind: 'translate', status: 'running', pct: 61, step: 'translate', lang: '英语', linesDone: 38, linesTotal: 62});
  assert.equal(tl.name, '翻译 · 英语');
  assert.equal(tl.line, '翻译 · 已译 38 / 62 句');
  const ex = C.jobRow({id: 'e', kind: 'export', status: 'running', pct: 44, jobPhase: 'generating', framesDone: 2719, framesTotal: 6180});
  assert.equal(ex.line, '编码中 · 已画 2,719 / 6,180 帧');
  const q = C.jobRow({id: 'q', kind: 'export', status: 'queued'});
  assert.deepEqual([q.tail, q.line, q.pct], ['排队中', '排队中', null]);
});

test('jobRow：完成后那一行是结果事实；导出给播放与在文件夹中显示', () => {
  const t = C.jobRow(tr({status: 'done', result: {sentences: 62, speakers: 3, warnings: ['diarization-unavailable']}}));
  assert.deepEqual(t.facts, ['62 句', '3 位说话人']);
  assert.equal(t.warnings[0].indexOf('说话人区分不可用'), 0);
  assert.deepEqual([t.tail, t.pct, t.line, t.time, t.actions.length], ['完成', null, null, null, 0]);
  const l = C.jobRow({id: 'l', kind: 'translate', status: 'done', lang: '英语', result: {units: 62, stale: 0, unaligned: 2}});
  assert.deepEqual(l.facts, ['英语', '62 条', '2 条未对齐']);
  const e = C.jobRow({id: 'e', kind: 'export', status: 'done', files: [{name: '主视频.mp4', width: 1920, height: 1080, durationSec: 206, size: '482 MB'}],
    checks: [{label: '音画同步'}, {label: '响度偏低', ok: false}]});
  assert.deepEqual(e.file, {name: '主视频.mp4', path: null, meta: '1920×1080 · 3:26 · 482 MB'});
  assert.deepEqual(e.checks, [{label: '音画同步', ok: true}, {label: '响度偏低', ok: false}]);
  assert.deepEqual(e.actions.map((a) => a.label), ['播放', '在文件夹中显示']);
});

test('jobRow：只有成片和音频给播放，别的文件只给在文件夹中显示（product-design §3.2.2）', () => {
  const ks = (name) => C.jobRow({id: 'e', kind: 'export', status: 'done', files: [{name}]}).actions.map((a) => a.k);
  assert.deepEqual(ks('主视频.mp4'), ['play', 'reveal']);
  assert.deepEqual(ks('主视频.MP4'), ['play', 'reveal']);
  assert.deepEqual(ks('旁白.m4a'), ['play', 'reveal']);
  assert.deepEqual(ks('主视频-en.srt'), ['reveal']);
  assert.deepEqual(C.jobRow({id: 'e', kind: 'export', status: 'done', files: []}).actions, []);
});

test('jobRow：失败红字写原因，有去处的给按钮；取消写已取消', () => {
  const crash = C.jobRow(tr({status: 'error', errorCode: 'MODEL_CRASHED', error: '语音模型进程意外退出'}));
  assert.deepEqual([crash.tail, crash.error], ['失败', '语音模型进程意外退出']);
  assert.deepEqual(crash.actions.map((a) => a.label), ['重试']);
  assert.deepEqual(C.jobRow(tr({status: 'error', errorCode: 'CAPABILITY_NOT_CONFIGURED'})).actions[0].route, {r: 'settings', sec: 'cloud', tab: 'stt'});
  assert.equal(C.jobRow(tr({status: 'error', errorCode: 'PROVIDER_AUTH_FAILED'})).actions[0].label, '去登录');
  assert.deepEqual(C.jobRow(tr({status: 'error', errorCode: 'DISK_FULL', error: '磁盘满了'})).actions, []);
  assert.equal(C.jobRow(tr({status: 'error'})).error, '这一步没有完成');
  const cancel = C.jobRow(tr({status: 'error', outcome: 'canceled', canceled: true, error: '已取消'}));
  assert.deepEqual([cancel.state, cancel.tail, cancel.error, cancel.actions.length], ['canceled', '已取消', null, 0]);
});

test('remedy：去设置启用、去登录、重试', () => {
  assert.deepEqual(C.remedy({kind: 'image', errorCode: 'CAPABILITY_NOT_CONFIGURED'}).route, {r: 'settings', sec: 'cloud', tab: 'image'});
  assert.deepEqual(C.remedy({kind: 'transcribe', errorCode: 'CAPABILITY_NOT_CONFIGURED', remedy: {local: true}}).route, {r: 'settings', sec: 'local', tab: 'asr'});
  assert.deepEqual(C.remedy({kind: 'image', errorCode: 'AGENT_AUTH_REQUIRED'}).route, {r: 'settings', sec: 'agent'});
  assert.equal(C.remedy({kind: 'translate', errorCode: 'STALE_JOB_INPUT'}).label, '重试');
  assert.equal(C.remedy({kind: 'export', errorCode: 'DISK_FULL'}), null);
});

test('download：下载中 pct、已下多少、已用与剩余、取消；失败写原因与重试', () => {
  const run = C.download({id: 'd', kind: 'download', status: 'running', pct: 27, sizeMB: 320, elapsedMs: 13000, leftMs: 35000,
    site: 'lanshan.example', url: 'https://lanshan.example/v/12', title: '城市夜跑'});
  assert.deepEqual([run.title, run.name, run.source], ['正在下载视频', '城市夜跑', 'https://lanshan.example/v/12']);
  assert.equal(run.line, '下载中 · 已下 86 / 320 MB');
  assert.equal(run.time, '已用 0:13 · 预计还要 0:35');
  assert.deepEqual(run.actions.map((a) => a.label), ['取消']);
  const failed = C.download({id: 'd', kind: 'download', status: 'error', issue: 'network', pct: 34});
  assert.equal(failed.error, '连接中断了');
  assert.match(failed.hint, /续传/);
  assert.deepEqual(failed.actions.map((a) => a.label), ['重试']);
  assert.deepEqual(C.download({id: 'd', kind: 'download', status: 'error', issue: 'login'}).actions, []);
  assert.deepEqual(C.download({id: 'd', kind: 'download', status: 'error', canceled: true}).actions.map((a) => a.k), ['retry']);
  assert.equal(C.download({id: 'd', kind: 'download', status: 'done'}).title, '下载完成');
});

test('candidate：只有完成且有候选的合成语音 / 生成图片', () => {
  const c = C.candidate({id: 'i', kind: 'image', status: 'done', model: 'pixa-image-1', runsOn: '云端', picked: 1,
    outputs: [{name: '封面 A', width: 768, height: 1344}, {name: '封面 B', width: 768, height: 1344}]});
  assert.deepEqual([c.title, c.sub, c.action], ['图片候选', 'pixa-image-1 · 云端', '预览']);
  assert.deepEqual(c.candidates.map((x) => [x.meta, x.picked]), [['768×1344', false], ['768×1344', true]]);
  assert.equal(C.candidate({id: 's', kind: 'tts', status: 'done', outputs: [{name: 'A', durationSec: 5, voice: '温和女声'}]}).candidates[0].meta, '0:05 · 温和女声');
  assert.equal(C.candidate({id: 's', kind: 'tts', status: 'running', outputs: [{name: 'A'}]}), null);
  assert.equal(C.candidate({id: 's', kind: 'tts', status: 'error'}), null);
  assert.equal(C.candidate({id: 'x', kind: 'export', status: 'done', outputs: [{}]}), null);
});

test('rowCards：工具消息折在回复或工作组里也找得到行；下载卡挪到最新一条引用，建出视频后原位换成视频卡', () => {
  const A = global.window.BC_AGENT;
  const messages = [
    {id: 'u', role: 'user'}, {id: 'a1', role: 'assistant'},
    {id: 'w1', role: 'tool', taskId: 'dl'}, {id: 'w2', role: 'tool', taskId: 'img'},
    {id: 'a2', role: 'assistant'}, {id: 'w3', role: 'tool', taskId: 'dl'},
  ];
  const rows = A.conversationRows(messages);
  assert.deepEqual(C.rowIndex(rows).get('w2'), 'a1');
  const img = {id: 'img', kind: 'image', status: 'done', outputs: [{name: 'A'}]};
  const running = C.rowCards(rows, messages, [], [{id: 'dl', kind: 'download', status: 'running'}, img]);
  assert.deepEqual([...running.entries()], [['a1', [{k: 'candidate', taskId: 'img'}]], ['a2', [{k: 'download', taskId: 'dl'}]]]);
  const movie = {id: 'v9', kind: 'movie', messageId: 'w1'};
  const done = C.rowCards(rows, messages, [movie], [{id: 'dl', kind: 'download', status: 'done', project: 'v9'}, img]);
  assert.deepEqual([...done.entries()], [['a1', [{k: 'artifact', item: movie}, {k: 'candidate', taskId: 'img'}]]]);
  const groupRows = A.conversationRows([{id: 'u', role: 'user'}, {id: 'w1', role: 'tool', taskId: 'dl'}]);
  assert.deepEqual([...C.rowCards(groupRows, [{id: 'u', role: 'user'}, {id: 'w1', role: 'tool', taskId: 'dl'}], [], [{id: 'dl', kind: 'download', status: 'error'}]).keys()], ['work-w1']);
  assert.equal(C.rowCards(rows, messages, [{id: 'p', kind: 'movie', messageId: null}], []).size, 0, '没有消息锚点的产物只在汇总里');
});

test('movieCard：状态 + 一件活一行', () => {
  const sess = {id: 's1', messages: [{id: 'm', role: 'tool', taskId: 't1'}]};
  const c = C.movieCard({id: 'v1', status: 'complete'}, sess, [tr()]);
  assert.equal(c.badge.text, '转录中 · 46%');
  assert.deepEqual(c.rows.map((r) => r.name), ['转录']);
  assert.deepEqual([c.shown.map((r) => r.id), c.earlier], [['t1'], []]);
  assert.deepEqual(C.movieCard(null, sess, [tr()]).rows, []);
  // 一件在跑、两件已结束：摊开在跑的那件，已结束的按新的在前收起
  const many = [tr({id: 'a', status: 'done'}), tr({id: 'b', kind: 'export', status: 'error', canceled: true}), tr({id: 'c', kind: 'export', pct: 83})];
  const sess3 = {id: 's1', messages: many.map((t) => ({id: 'm' + t.id, role: 'tool', taskId: t.id}))};
  const c3 = C.movieCard({id: 'v1', status: 'complete'}, sess3, many);
  assert.deepEqual([c3.rows.length, c3.shown.map((r) => r.id), c3.earlier.map((r) => r.id), c3.pending], [3, ['c'], ['b', 'a'], 0]);
  // 之前一件转录失败可重试、收起了：卡上带出 pending
  const fail = [tr({id: 'a', status: 'error', errorCode: 'MODEL_CRASHED'}), tr({id: 'b', kind: 'export', status: 'error', canceled: true})];
  const c4 = C.movieCard({id: 'v1', status: 'complete'}, {id: 's1', messages: fail.map((t) => ({id: 'm' + t.id, role: 'tool', taskId: t.id}))}, fail);
  assert.deepEqual([c4.shown.map((r) => r.id), c4.earlier.map((r) => r.id), c4.pending], [['b'], ['a'], 1]);
});

test('movieCard：一条会话一张卡，前面回合已结束的活收进「之前的 N 项」', () => {
  const two = [tr({id: 'a', status: 'done'}), tr({id: 'b', kind: 'translate', status: 'done'}), tr({id: 'c', kind: 'export', status: 'done'})];
  const sess = {id: 's1', messages: [{id: 'u1', role: 'user'}, {id: 'ma', role: 'tool', taskId: 'a'},
    {id: 'u2', role: 'user'}, {id: 'mb', role: 'tool', taskId: 'b'}, {id: 'mc', role: 'tool', taskId: 'c'}]};
  const c = C.movieCard({id: 'v1', status: 'complete'}, sess, two);
  assert.deepEqual([c.shown.map((r) => r.id), c.earlier.map((r) => r.id)], [['c'], ['b', 'a']]);
  // 第二轮的活还在跑：摊开它，第一轮已结束的转录收起
  const live = [two[0], tr({id: 'b', kind: 'translate', pct: 30}), two[2]];
  const c2 = C.movieCard({id: 'v1', status: 'complete'}, sess, live);
  assert.deepEqual([c2.shown.map((r) => r.id), c2.earlier.map((r) => r.id)], [['b'], ['c', 'a']]);
});

test('foldRows：有活在跑只摊开进行中的；都结束了只摊开最后一件；其余新的在前收起', () => {
  const row = (id, state) => ({id, state});
  const ids = (f) => [f.shown.map((r) => r.id), f.earlier.map((r) => r.id)];
  // 一件在跑、其余已结束：只摊开在跑的，不再带上最后结束的那件
  assert.deepEqual(ids(C.foldRows([row('a', 'done'), row('b', 'canceled'), row('c', 'done'), row('d', 'failed'), row('e', 'running')])),
    [['e'], ['d', 'c', 'b', 'a']]);
  // 在跑与排队都算进行中，按原先后都摊开
  assert.deepEqual(ids(C.foldRows([row('a', 'done'), row('b', 'running'), row('c', 'done'), row('d', 'queued')])), [['b', 'd'], ['c', 'a']]);
  // 都结束了：只摊开列表里的最后一件（提交先后的最后，任务记录没有结束时间）
  assert.deepEqual(ids(C.foldRows([row('a', 'failed'), row('b', 'done'), row('c', 'canceled')])), [['c'], ['b', 'a']]);
  // 只有一件：没有收起的
  assert.deepEqual(ids(C.foldRows([row('a', 'done')])), [['a'], []]);
  assert.deepEqual(ids(C.foldRows([row('a', 'running')])), [['a'], []]);
  // 空
  assert.deepEqual(C.foldRows([]), {shown: [], earlier: [], pending: 0});
  assert.deepEqual(C.foldRows(null), {shown: [], earlier: [], pending: 0});
});

test('foldRows.pending：只数收起里失败且有去处的；没去处的失败、已取消、摊开着的都不算', () => {
  const row = (id, state, ks) => ({id, state, actions: (ks || []).map((k) => ({k, label: k}))});
  // 收起里：重试、去设置、去登录各一件算；失败没去处、已取消、完成不算
  const f = C.foldRows([row('a', 'failed', ['retry']), row('b', 'failed', ['settings']), row('c', 'failed', ['login']),
    row('d', 'failed'), row('e', 'canceled'), row('f', 'done', ['play', 'reveal']), row('g', 'done')]);
  assert.deepEqual([f.shown.map((r) => r.id), f.pending], [['g'], 3]);
  // 摊开着的那件（最后结束的）失败且可重试：不算进 pending，收起里没有就是 0
  assert.deepEqual([C.foldRows([row('a', 'done'), row('b', 'failed', ['retry'])]).pending], [0]);
  // 有活在跑：之前失败可重试的收起了，算
  assert.equal(C.foldRows([row('a', 'failed', ['retry']), row('b', 'running', ['cancel'])]).pending, 1);
  // needsAction 本身
  assert.equal(C.needsAction(row('x', 'failed', ['retry'])), true);
  assert.equal(C.needsAction(row('x', 'failed')), false);
  assert.equal(C.needsAction(row('x', 'canceled', ['retry'])), false);
  assert.equal(C.needsAction(null), false);
});

test('jobRow：转录写出用的模型与参数，在跑与结束后都只读', () => {
  const had = D.models;
  D.models = {local: [{id: 'moss-transcribe', name: 'MOSS Transcribe'}], cloud: [{id: 'gpt-4o-transcribe', name: 'gpt-4o-transcribe', provider: 'OpenAI'}]};
  try {
    const run = C.jobRow(tr({session: 's1', lang: '中文', diarize: true}));
    assert.equal(run.asr, 'MOSS Transcribe · 本机 · 中文 · 识别说话人');
    assert.deepEqual(run.actions.map((a) => [a.k, a.label]), [['cancel', '取消']]);
    assert.deepEqual(C.jobRow(tr({session: 's1', status: 'queued'})).actions.map((a) => a.k), ['cancel']);
    assert.equal(C.jobRow(tr({model: 'gpt-4o-transcribe', lang: '英语'})).asr, 'OpenAI · gpt-4o-transcribe · 云端 · 英语');
    assert.equal(C.jobRow(tr({model: 'mystery-asr'})).asr, 'mystery-asr', '表里没有的原样写 id');
    const done = C.jobRow(tr({session: 's1', status: 'done', lang: '中文'}));
    assert.equal(done.asr, 'MOSS Transcribe · 本机 · 中文');
    assert.deepEqual(done.actions, []);
    // 不是转录的没有这一行
    assert.equal(C.jobRow({id: 'l', kind: 'translate', status: 'running', session: 's1', model: 'x'}).asr, null);
  } finally { D.models = had; }
});
