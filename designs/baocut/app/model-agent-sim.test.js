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

test('planFor：只说了下载的只下载、不建视频；要转录或编辑的下完建视频；文件存进保存目录', () => {
  const only = S.planFor('下载这个视频 https://lanshan.example/v/42', true, {saveDir: '~/Movies/下载'});
  assert.equal(only.sim.task.only, true);
  assert.equal(only.sim.task.saveDir, '~/Movies/下载');
  assert.match(only.write.why, /~\/Movies\/下载.*不建视频/);
  const use = S.planFor('下载下来转录 https://lanshan.example/v/42', true);
  assert.equal(use.sim.task.only, false);
  assert.equal(use.sim.task.saveDir, '~/Downloads', '没给保存目录时是系统下载文件夹');
  assert.equal(S.planFor('https://lanshan.example/v/42', false).sim.task.only, false, '没说下载：照旧下完建视频');
  assert.equal(S.planFor('Download and translate https://lanshan.example/v/42 下载后翻译', true).sim.task.only, false);
});

test('planFor：音频链接落成音频文件；下载任务带演示播放地址（视频另带封面）', () => {
  const audio = S.planFor('下载这期播客 https://boke.example/episodes/ep42.m4a', true).sim.task;
  assert.equal(audio.name, 'ep42.m4a');
  assert.match(audio.previewSrc, /\.wav$/);
  assert.equal(audio.poster, undefined, '音频没有封面');
  assert.match(S.planFor('下载这期播客 https://boke.example/episodes/ep42.m4a', true).summary, /音频/);
  const video = S.planFor('下载这个视频 https://lanshan.example/v/42', true).sim.task;
  assert.equal(video.name, '42.mp4');
  assert.ok(video.previewSrc && video.poster, '视频带播放地址与封面');
});

test('下载：进度只有百分比与用时，演示的失败链接在 34% 断一次，重试过不再断', () => {
  const sim = S.planFor('下载 https://lanshan.example/a.mp4', false).sim;
  assert.deepEqual(S.progress(sim, 50), {pct: 50, elapsedMs: 24000, leftMs: 24000});
  assert.equal(S.downloadFails({scenario: 'network'}, 30), false);
  assert.equal(S.downloadFails({scenario: 'network'}, 34), true);
  assert.equal(S.downloadFails({scenario: 'network', retried: true}, 60), false);
  assert.equal(S.downloadFails({scenario: 'success'}, 60), false);
  const after = S.afterDownload({title: '城市夜跑', name: 'city-run.mp4', sizeMB: 320, mediaSec: 1560});
  assert.match(after.close, /320 MB，存在 ~\/Downloads\/city-run\.mp4/);
  assert.equal(after.transcribe.task.mediaSec, 1560);
  assert.equal(after.transcribe.result.result.sentences, 473);
  assert.match(S.stoppedText({kind: 'download'}), /没有建视频/);
  const only = S.afterDownload({title: '城市夜跑', name: 'city-run.mp4', sizeMB: 320, saveDir: '~/BaoCut/素材实验/downloads/', only: true});
  assert.equal(only.transcribe, null, '只下载不起转录');
  assert.match(only.close, /存在 ~\/BaoCut\/素材实验\/downloads\/city-run\.mp4。只下载，没有建视频/);
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

test('planFor：带链接但目标语言没填，先问清再下载；填好了没视频就下载', () => {
  const url = 'https://www.youtube.com/watch?v=abc123';
  const ask = S.planFor(`转录这个视频，并翻译成[目标语言]，做成双语字幕。${url}`, false);
  assert.equal(ask.kind, 'brief');
  assert.equal(ask.sim, undefined);
  assert.equal(S.planFor(`转录这个视频，并翻译成日语，做成双语字幕。${url}`, false).kind, 'download');
});

test('下载要登录：读完页面就停，Agent 用设置链接把用户带到设置 › 视频下载的网站登录', () => {
  const sim = S.planFor('下载 https://lanshan.example/members/42', false).sim;
  assert.equal(sim.task.scenario, 'login');
  assert.equal(S.downloadFails(sim.task, S.LOGIN_FAIL_AT - 1), false);
  assert.equal(S.downloadFails(sim.task, S.LOGIN_FAIL_AT), true);
  assert.equal(S.downloadFails({...sim.task, retried: true}, 60), false);
  const reply = S.loginReply(sim.task);
  assert.match(reply, /\[设置 › 视频下载\]\(\/settings\/downloader\)/);
  assert.match(reply, /lanshan\.example 仍然要求登录/);
  assert.ok(window.BC_SETTINGS_LINK.parse('/settings/downloader'));
});

test('读不到 Safari 的 Cookie：读完页面就停，回复把用户带到卡上的「打开系统设置」，不自己去开系统设置', () => {
  const sim = S.planFor('下载 https://video.example/safari-only/42', false).sim;
  assert.equal(sim.task.scenario, 'cookies');
  assert.equal(S.downloadFails(sim.task, S.LOGIN_FAIL_AT), true);
  assert.equal(S.downloadFails({...sim.task, retried: true}, 60), false);
  const reply = S.cookiesReply(sim.task);
  assert.match(reply, /完全磁盘访问权限/);
  assert.match(reply, /下载卡上的「打开系统设置」/);
  assert.match(reply, /\[设置 › 视频下载\]\(\/settings\/downloader\)/);
});
