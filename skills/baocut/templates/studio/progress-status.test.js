const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./progress-status.js');

const job = (over) => ({
  id: 'j1', pid: 100, project: '/p/demo.bcut', kind: 'translate', stage: 'translate',
  phase: 'translating', pct: 42, detail: '整句翻译', status: 'running',
  message: null, startedAt: 1, updatedAt: 100, source: 'external',
  cancellable: false, queueState: null, ...over,
});

test('normalizePath 归一尾斜杠与 macOS /private 前缀', () => {
  assert.equal(P.normalizePath('/p/demo.bcut/'), '/p/demo.bcut');
  assert.equal(P.normalizePath('/private/tmp/demo.bcut'), '/tmp/demo.bcut');
  assert.equal(P.normalizePath('  '), null);
  assert.equal(P.normalizePath(null), null);
  assert.ok(P.samePath('/private/tmp/x/', '/tmp/x'));
  assert.ok(!P.samePath('/tmp/x', '/tmp/y'));
  assert.ok(!P.samePath(null, '/tmp/x'));
});

test('projectIdFromPath 认出三种路由形态', () => {
  assert.equal(P.projectIdFromPath('/'), null);
  assert.equal(P.projectIdFromPath('/transcript'), null);          // 单项目模式的 tab
  assert.equal(P.projectIdFromPath('/demo/translate'), 'demo');    // 挂载点/根子目录
  assert.equal(P.projectIdFromPath('/projects/demo/style'), 'demo');
  assert.equal(P.projectIdFromPath('/projects'), null);
  assert.equal(P.projectIdFromPath('/my%20proj/'), 'my proj');
});

test('resolveProjectPath：单项目取 root，带 id 走项目表，认不出返回 null', () => {
  const health = {
    root: '/srv/root', rootIsProject: true,
    projects: [{ id: 'demo', path: '/private/tmp/demo.bcut' }],
  };
  assert.equal(P.resolveProjectPath(health, '/subtitle'), '/srv/root');
  assert.equal(P.resolveProjectPath(health, '/demo/'), '/tmp/demo.bcut');
  assert.equal(P.resolveProjectPath(health, '/unknown/'), null);
  assert.equal(P.resolveProjectPath({ root: '/srv/root', rootIsProject: false, projects: [] }, '/'), null);
  assert.equal(P.resolveProjectPath(null, '/'), null);
});

test('selectJob 只取本项目的非终态字幕任务，取心跳最新的那个', () => {
  const jobs = [
    job({ id: 'other', project: '/p/other.bcut' }),
    job({ id: 'done', status: 'done', updatedAt: 900 }),
    job({ id: 'export', kind: 'export', stage: 'export', phase: 'render', updatedAt: 900 }),
    job({ id: 'old', updatedAt: 10 }),
    job({ id: 'new', updatedAt: 200 }),
  ];
  assert.equal(P.selectJob(jobs, '/p/demo.bcut').id, 'new');
  assert.equal(P.selectJob(jobs, null), null);
  assert.equal(P.selectJob([], '/p/demo.bcut'), null);
  assert.equal(P.selectJob([job({ status: 'queued', id: 'q' })], '/p/demo.bcut').id, 'q');
  assert.equal(P.selectJob([job({ project: null })], '/p/demo.bcut'), null);
});

test('projectStatus 无任务时压掉 data.json 的陈旧 active', () => {
  const base = { active: true, phase: 'translating', pct: 30, detail: '整句翻译', updatedAt: 5 };
  const status = P.projectStatus(base, null, null, 'fp');
  assert.equal(status.active, false);
  assert.equal(P.isActive(status), false);
  assert.equal(status.phase, 'translating');   // 阶段文案不改写，只是不再"进行中"
});

test('无任务时陈旧 progress 指纹不伪造 syncing', () => {
  const base = {
    active: true, phase: 'aligning', detail: '正在提交阶段成果',
    contentFingerprint: 'old',
  };
  const progress = {
    active: true, phase: 'aligning', detail: '拆分并对齐双语字幕',
    contentFingerprint: 'old', phases: [{ label: '拆分对齐', state: 'active' }],
  };
  const status = P.projectStatus(base, null, progress, 'current');
  assert.equal(status.active, false);
  assert.equal(status.phase, 'aligning');
  assert.equal(status.contentFingerprint, 'current');
  assert.notEqual(status.detail, '正在同步字幕内容');
});

test('projectStatus 用任务覆盖阶段/进度/细节与计数', () => {
  const base = { active: false, phase: 'ready', pct: 100, detail: '完成', linesTotal: 9 };
  const status = P.projectStatus(base, job({ linesDone: 3, linesTotal: 12 }), null, null);
  assert.equal(status.active, true);
  assert.equal(status.phase, 'translating');
  assert.equal(status.pct, 42);
  assert.equal(status.detail, '整句翻译');
  assert.equal(status.linesDone, 3);
  assert.equal(status.linesTotal, 12);
  assert.equal(status.updatedAt, 100);
});

test('本地转录细阶段归一为转录页并透传有界实时文本', () => {
  const liveSegments = [{ start: 1.25, end: 2.5, text: 'hello' }];
  const status = P.projectStatus({}, job({
    kind: 'transcribe', stage: 'transcribe', phase: 'vad', liveSegments,
  }), null, null);
  assert.equal(status.phase, 'transcribing');
  assert.deepEqual(status.liveSegments, liveSegments);
});

test('外层 transcribe kind 不覆盖 auto 已前进到的翻译与对齐阶段', () => {
  const aligning = P.projectStatus({}, job({
    kind: 'transcribe', stage: 'align', phase: 'aligning', detail: '拆分并对齐双语字幕',
  }), null, null);
  assert.equal(aligning.phase, 'aligning');
  assert.equal(aligning.detail, '拆分并对齐双语字幕');

  const translating = P.projectStatus({}, job({
    kind: 'transcribe', stage: 'translate', phase: '', detail: '整句翻译',
  }), null, null);
  assert.equal(translating.phase, 'translating', 'phase 缺失时由具体 stage 兜底');

  const ready = P.projectStatus({}, job({
    kind: 'transcribe', stage: 'ready', phase: 'ready', pct: 100,
  }), null, null);
  assert.equal(ready.phase, 'ready', '收尾心跳也不得倒退成转录中');
});

test('progress.json 只贡献 phases / contentFingerprint / pct 的不确定性', () => {
  const phases = [{ label: '润色', state: 'done' }, { label: '翻译', state: 'active' }];
  const progress = {
    active: true, updatedAt: 1, phases, contentFingerprint: 'fp',
    phase: 'translating', pct: null,
  };
  const status = P.projectStatus({}, job({ pct: 0 }), progress, 'fp');
  assert.equal(status.pct, null, 'progress.json 说不确定 → 不确定进度条');
  assert.deepEqual(status.phases, phases);
  assert.equal(status.contentFingerprint, 'fp');
  // 不同阶段的 progress.json 不得覆盖任务的确定进度
  const other = P.projectStatus({}, job({ pct: 42 }), { ...progress, phase: 'polishing' }, 'fp');
  assert.equal(other.pct, 42);
  // progress.json 的 active/updatedAt 不参与
  const idle = P.projectStatus({}, null, progress, 'fp');
  assert.equal(idle.active, false);
  assert.equal(idle.updatedAt, undefined);
});

test('指纹不一致时进入 syncing，且阶段全部回到 pending', () => {
  const progress = {
    contentFingerprint: 'new', phases: [{ label: '润色', state: 'done' }], pct: 50,
  };
  const status = P.projectStatus({ phase: 'ready' }, job(), progress, 'old');
  assert.equal(status.phase, 'syncing');
  assert.equal(status.active, true);
  assert.equal(status.pct, null);
  assert.equal(status.detail, '正在同步字幕内容');
  assert.deepEqual(status.phases, [{ label: '润色', state: 'pending' }]);
  // 一侧缺指纹时不判失同步
  assert.equal(P.projectStatus({}, job(), { phases: [] }, 'old').phase, 'translating');
});
