const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-import.js');
const M = window.BC_IMPORT;
const start = (scenario = 'success') => M.start({id: 'i1', url: 'https://example.com/video', info: {title: 'Video', site: 'Example'}, scenario});
test('never creates a project on metadata, download completion, error or cancellation', () => {
  for (const scenario of ['success', 'missing', 'outdated', 'network', 'denied']) {
    let t = start(scenario);
    for (let i = 0; i < 15 && t.stage !== 'ready'; i++) {
      assert.equal(M.canCreate(t), false);
      assert.equal(M.attach(t, 'p1'), t);
      assert.equal(t.project, null);
      t = M.tick(t);
    }
    assert.equal(M.canCreate(M.cancel(t)), false);
  }
});
test('verified media attaches once; retry never creates another project', () => {
  let t = start('transcription');
  for (let i = 0; i < 20 && !M.canCreate(t); i++) t = M.tick(t);
  assert.equal(M.canCreate(t), true);
  t = M.attach(t, 'p1');
  assert.equal(M.attach(t, 'p2'), t);
  while (t.status === 'running') t = M.tick(t);
  assert.equal(t.issue, 'transcription');
  assert.equal(t.phase, '转录未完成');
  t = M.retry(t);
  assert.equal(t.project, 'p1');
  assert.equal(t.stage, 'transcribing');
  while (t.status === 'running') t = M.tick(t);
  assert.equal(t.stage, 'done');
});
test('network retry retains progress; cancellation ignores late events', () => {
  let t = start('network');
  while (t.status === 'running') t = M.tick(t);
  const pct = t.pct;
  assert.equal(M.retry(t).pct, pct);
  t = M.cancel(M.retry(t));
  assert.equal(M.tick(t), t);
  assert.equal(M.retry(t), t);
});
test('403 recovery can retry without changing source or creating a project', () => {
  let t = start('denied');
  while (t.status === 'running') t = M.tick(t);
  assert.equal(t.issue, 'denied');
  const resumed = M.retry(t);
  assert.equal(resumed.stage, 'downloading');
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.url, t.url);
  assert.equal(resumed.project, null);
  assert.equal(M.canCreate(resumed), false);
});
test('direct media skips downloader installation', () => {
  const t = M.start({id: 'i2', info: {direct: 'mp4'}, tool: 'missing'});
  assert.equal(M.tick(t).stage, 'downloading');
});
test('canceled transcription restarts only on explicit action and retains the project', () => {
  const t = M.cancel({...start(), stage: 'transcribing', project: 'p1'});
  assert.equal(M.retry(t), t);
  assert.equal(M.restart(t).project, 'p1');
  assert.equal(M.restart(t).stage, 'transcribing');
  assert.equal(M.canCreate(M.restart(t)), false);
});
test('every issue declares retryable and tools, and retry only re-runs retryable ones', () => {
  for (const [code, issue] of Object.entries(M.issues)) {
    assert.equal(typeof issue.retryable, 'boolean', code);
    assert.ok(['primary', 'hint', null].includes(issue.tools), code);
    const t = {...start(), status: 'error', stage: 'error', issue: code, pct: 30};
    assert.equal(M.retry(t) !== t, issue.retryable, code);
  }
});
test('recovery keeps one accent action and folds tools behind a hint for 403', () => {
  const at = code => M.recovery({...start(), status: 'error', stage: 'error', issue: code});
  assert.deepEqual(at('denied'), {primary: 'retry', secondary: ['tools', 'change'], tools: 'hint', setup: false});
  assert.deepEqual(at('network'), {primary: 'retry', secondary: ['change'], tools: null, setup: false});
  assert.deepEqual(at('login'), {primary: 'change', secondary: [], tools: null, setup: false});
  assert.deepEqual(at('unsupported'), {primary: 'change', secondary: [], tools: null, setup: false});
  assert.deepEqual(at('invalid'), {primary: 'change', secondary: ['retry'], tools: null, setup: false});
  assert.deepEqual(at('missing'), {primary: null, secondary: ['change'], tools: 'primary', setup: true});
  assert.deepEqual(at('install'), {primary: null, secondary: ['change'], tools: 'primary', setup: false});
  assert.deepEqual(at('outdated'), {primary: null, secondary: ['retry', 'change'], tools: 'primary', setup: false});
  assert.deepEqual(M.recovery({...start(), status: 'error', issue: 'transcription', project: 'p1'}), {primary: 'retry', secondary: [], tools: null, setup: false});
  assert.deepEqual(M.recovery(start()), {primary: null, secondary: [], tools: null, setup: false});
});
test('login, unsupported and busy fail during download; invalid media fails at verification without a project', () => {
  for (const scenario of ['login', 'unsupported', 'busy', 'invalid']) {
    let t = start(scenario);
    for (let i = 0; i < 20 && t.status === 'running'; i++) { assert.equal(M.canCreate(t), false); t = M.tick(t); }
    assert.equal(t.status, 'error');
    assert.equal(t.issue, scenario);
    assert.equal(t.project, null);
  }
  const t = start('invalid');
  let v = t; while (v.stage !== 'error') v = M.tick(v);
  assert.equal(v.phase, '媒体验证未通过');
  assert.equal(M.retry(v).pct, 0);
  assert.equal(M.retry(v).attempts, 1);
});

test('用别的电脑下载（J3）：本机缺下载工具不拦，下载阶段点名机器', () => {
  let t = M.start({id: 'i2', url: 'https://example.com/video', info: {title: 'Video', site: 'Example'}, scenario: 'missing', tool: 'missing',
    options: {via: 'n1', viaName: 'mac-studio.local'}});
  t = M.tick(t);
  assert.equal(t.stage, 'downloading');
  assert.equal(t.phase, '在 mac-studio.local 上下载视频');
  let local = M.tick(M.start({id: 'i3', url: 'https://example.com/video', info: {title: 'Video', site: 'Example'}, scenario: 'missing', tool: 'missing'}));
  assert.equal(local.stage, 'repair', '本机下载照旧先准备工具');
  local = M.tick(M.start({id: 'i4', url: 'https://example.com/video', info: {title: 'Video', site: 'Example'}}));
  assert.equal(local.phase, '下载视频');
});

test('movieRecord：下载完成建出的视频记录，链接导入与 Agent 下载共用；带项目时落进项目的子目录', () => {
  const plain = M.movieRecord({id: 'v1', title: '访谈', name: 'talk.mp4', duration: 600, hue: 30});
  assert.equal(plain.status, 'transcribing');
  assert.equal(plain.src.path, '~/Downloads/talk.mp4');
  assert.equal(plain.model, 'moss-transcribe');
  assert.equal(plain.dir, undefined);
  const inDir = M.movieRecord({id: 'v2', title: '访谈', name: 'talk.mp4', saveDir: '~/BaoCut/播客/访谈/', dir: 'd1', duration: 600, hue: 30});
  assert.equal(inDir.src.path, '~/BaoCut/播客/访谈/talk.mp4');
  assert.deepEqual([inDir.dir, inDir.folder], ['d1', '访谈']);
});
