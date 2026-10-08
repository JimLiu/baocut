const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-agent.js');
require('./model-agent-tools.js');
require('./model-agent-sim.js');
require('./model-settings-nav.js');
require('./model-settings-link.js');
const S = global.window.BC_AGENT_SIM;
const TOOLS = global.window.BC_AGENT_TOOLS;

test('planFor：说转录 / 加字幕走转录脚本，带 models_transcribe 的调用', () => {
  const p = S.planFor('给这个视频加字幕', true, {title: '科浪 42 期'});
  assert.equal(p.kind, 'transcribe');
  assert.equal(p.task.kind, 'transcribe');
  assert.equal(p.sim.tool, 'models_transcribe');
  assert.deepEqual(p.reads[0].args, {video: '科浪 42 期'});
  assert.equal(TOOLS.describe(p.sim.tool, p.sim.args).summary, 'moss-transcribe · 3 分 26 秒');
  assert.equal(S.planFor('给这个视频加字幕并翻译成英文', true).kind, 'transcribe');
  assert.equal(S.planFor('转写一下', true).sim.task.runsOn, '本机');
});

test('planFor：重新转录、斜杠命令、没视频的会话不被转录脚本抢走', () => {
  assert.equal(S.planFor('重新转录第 2 章', true).kind, 'retranscribe');
  assert.equal(S.planFor('重新转录第 2 章', true).sim.kind, 'retranscribe');
  assert.equal(S.planFor('/translate 转录稿翻成英文', true).kind, 'translate');
  const none = S.planFor('转录这个视频', false);
  assert.equal(none.write, null);
  assert.equal(none.sim, undefined);
  assert.equal(S.planFor('总结一下', true).sim, undefined);
});

test('planFor：翻译写一份译文文稿，导出带交付文件', () => {
  const tr = S.planFor('翻译成日语', true, {agent: 'Claude Code · Sonnet'});
  assert.equal(tr.sim.tool, 'edits_apply');
  assert.equal(tr.sim.task.lang, '日语');
  assert.equal(tr.sim.task.model, 'Claude Code · Sonnet');
  assert.equal(TOOLS.describe(tr.sim.tool, tr.sim.args).label, '翻译');
  assert.equal(TOOLS.describe(tr.sim.tool, tr.sim.args).summary, '日语 · 62 句');
  const ex = S.planFor('导出成片', true, {title: '科浪 42 期'});
  assert.equal(ex.sim.result.files[0].name, '科浪 42 期.mp4');
  assert.equal(ex.sim.result.checks.length, 3);
});

test('progress：按进度推阶段键与展示文字，用时与剩余线性', () => {
  const sim = S.simFor({kind: 'transcribe'});
  assert.deepEqual(S.progress(sim, 0), {pct: 0, elapsedMs: 0, leftMs: 252000, phase: '解码音频', jobPhase: 'decoding'});
  assert.equal(S.progress(sim, 40).jobPhase, 'transcribing');
  assert.equal(S.progress(sim, 80).jobPhase, 'aligning');
  assert.equal(S.progress(sim, 90).jobPhase, 'diarizing');
  assert.equal(S.progress(sim, 100).jobPhase, 'finalizing');
  assert.equal(S.progress(sim, 50).elapsedMs, 126000);
  const solo = S.simFor({kind: 'transcribe'}, {asr: {diarize: false}});
  assert.equal(S.progress(solo, 90).jobPhase, 'finalizing');
  const tr = S.simFor({kind: 'translate', task: {target: 'en'}});
  assert.equal(S.progress(tr, 5).step, 'freeze-source');
  assert.equal(S.progress(tr, 5).linesDone, 0);
  assert.equal(S.progress(tr, 48).linesDone, 31);
  assert.equal(S.progress(tr, 90).step, 'assemble');
  assert.equal(S.progress(tr, 90).linesDone, 62);
  const ex = S.simFor({kind: 'export'});
  assert.equal(S.progress(ex, 44).framesDone, 3090);
  assert.equal(S.progress(ex, 97).jobPhase, 'publishing');
});

test('done 与收尾话', () => {
  const sim = S.simFor({kind: 'transcribe'});
  const d = S.done(sim);
  assert.equal(d.pct, 100);
  assert.equal(d.phase, null);
  assert.equal(d.result.sentences, 62);
  assert.equal(S.done(S.simFor({kind: 'translate', task: {}})).result.unaligned, 2);
  assert.equal(S.pace(sim), 4);
  assert.match(S.stoppedText(sim), /^转录已取消/);
  assert.match(S.stoppedText(S.simFor({kind: 'export'})), /半成品/);
});

test('planFor：话里有链接就下载——会话还没有视频也能写；有视频时要说「下载」', () => {
  const p = S.planFor('把这个视频下载下来 https://lanshan.example/talks/city-run-12.mp4 然后转录', false);
  assert.equal(p.kind, 'download');
  assert.equal(p.sim.tool, 'downloads_fetch');
  assert.equal(p.sim.task.name, 'city-run-12.mp4');
  assert.equal(p.sim.task.site, 'lanshan.example');
  assert.equal(TOOLS.describe(p.sim.tool, p.sim.args).label, '下载视频');
  assert.match(p.write.cmd, /^bcut download https:\/\/lanshan\.example\//);
  assert.equal(S.planFor('https://lanshan.example/v/42', false).kind, 'download');
  assert.notEqual(S.planFor('参考一下 https://lanshan.example/v/42 的节奏', true).kind, 'download');
  assert.equal(S.planFor('https://x.example/fail.mp4 下载', true).sim.task.scenario, 'network');
});

test('下载：进度只有百分比与用时，演示的失败链接在 34% 断一次，重试过不再断', () => {
  const sim = S.planFor('下载 https://lanshan.example/a.mp4', false).sim;
  assert.deepEqual(S.progress(sim, 50), {pct: 50, elapsedMs: 24000, leftMs: 24000});
  assert.equal(S.downloadFails({scenario: 'network'}, 30), false);
  assert.equal(S.downloadFails({scenario: 'network'}, 34), true);
  assert.equal(S.downloadFails({scenario: 'network', retried: true}, 60), false);
  assert.equal(S.downloadFails({scenario: 'success'}, 60), false);
  const after = S.afterDownload({title: '城市夜跑', sizeMB: 320, mediaSec: 1560});
  assert.match(after.close, /320 MB/);
  assert.equal(after.transcribe.task.mediaSec, 1560);
  assert.equal(after.transcribe.result.result.sentences, 473);
  assert.match(S.stoppedText({kind: 'download'}), /没有建视频/);
});

test('retrySim：按任务记录重建，计数的总数沿用记录', () => {
  const tl = S.retrySim({kind: 'translate', target: 'ja', linesTotal: 12});
  assert.equal(S.progress(tl, 90).linesDone, 12);
  assert.equal(S.done(tl).result.units, 12);
  const tx = S.retrySim({kind: 'transcribe', mediaSec: 42});
  assert.equal(S.done(tx).result.sentences, 13);
  const ex = S.retrySim({kind: 'export', framesTotal: 1260});
  assert.equal(S.progress(ex, 44).framesDone, 630);
  assert.equal(S.retrySim({kind: 'cleanup'}), null);
});

test('视频卡的一行读得懂模拟写出的任务记录', () => {
  require('./model-agent-cards.js');
  const C = global.window.BC_AGENT_CARDS;
  const sim = S.simFor({kind: 'transcribe'});
  const run = C.jobRow(Object.assign({id: 'a1', kind: 'transcribe', status: 'running'}, sim.task, S.progress(sim, 40)));
  assert.equal(run.line, '识别中 · 已识别 1:22 / 3:26');
  const fin = C.jobRow(Object.assign({id: 'a1', kind: 'transcribe', status: 'done'}, sim.task, S.done(sim)));
  assert.deepEqual(fin.facts, ['62 句', '3 位说话人']);
});

test('planFor：演示挡位「没有可用的语音识别服务」——先查能力，不提交任务，收尾话带两条认得出的设置链接', () => {
  const L = global.window.BC_SETTINGS_LINK;
  for (const [text, hasProject] of [['转录翻译 https://www.example.com/watch?v=demo', false], ['给这个视频加字幕', true]]) {
    const p = S.planFor(text, hasProject, {noTranscriber: true});
    assert.equal(p.kind, 'unavailable');
    assert.equal(p.write, null);
    assert.equal(TOOLS.describe(p.reads[0].tool, p.reads[0].args).summary, '语音识别');
    const links = [...p.close.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
    assert.deepEqual(links.map((m) => m[2]), ['/settings/models/asr', '/settings/models/providers']);
    links.forEach((m) => assert.equal(L.parse(m[2]).trail, m[1]));
  }
  assert.equal(S.planFor('/retranscribe', true, {noTranscriber: true}).kind, 'retranscribe', '斜杠命令不受挡位影响');
  assert.equal(S.planFor('给这个视频加字幕', true, {noTranscriber: false}).kind, 'transcribe');
});

test('转录记下语音模型与参数；重试沿用', () => {
  const p = S.planFor('转录这一期', true, {title: '科浪 42 期'});
  assert.deepEqual([p.sim.task.model, p.sim.task.runsOn, p.sim.task.lang, p.sim.task.diarize], ['moss-transcribe', '本机', '中文', true]);
  const run = Object.assign({id: 't', kind: 'transcribe', status: 'running', pct: 52, title: '转录 · 科浪'}, p.sim.task,
    {model: 'whisper-large-v3', diarize: false, paceStep: 0.5, mediaSec: 600});
  const again = S.retrySim(Object.assign({}, run, {status: 'error'}));
  assert.equal(again.args.model, 'whisper-large-v3');
  assert.equal(again.task.diarize, false);
  assert.equal(S.pace(again), 0.5, '放慢的演示任务重试后照样慢');
});

test('边转边问：回话时等那件转录（jobs_wait），结束后按记录收尾', () => {
  const w = S.waitPlan({id: 'ag23t', kind: 'transcribe', title: '转录 · Sintel'});
  assert.deepEqual([w.kind, w.write, w.wait.taskId, w.tool], ['wait', null, 'ag23t', 'jobs_wait']);
  assert.deepEqual(TOOLS.describe(w.tool, w.args), {kind: 'job', label: '等待任务', summary: '转录 · Sintel', icon: 'tasks'});
  const ok = S.waitClose({status: 'done', result: {sentences: 62, speakers: 3}});
  assert.equal(ok.receipt, '已写入文稿 · 62 句 · 3 位说话人');
  assert.match(ok.close, /^转完了：62 句、3 位说话人。/);
  assert.equal(S.waitClose({status: 'error', canceled: true}).receipt, null);
  assert.match(S.waitClose({status: 'error', error: '内存不足'}).close, /内存不足/);
});
