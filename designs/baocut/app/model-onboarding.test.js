const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-local-models.js');
require('./model-onboarding.js');
const OB = global.window.BC_ONBOARDING;

const models = [
  {id: 'moss-transcribe', name: 'MOSS Transcribe', size: 1748, uses: ['wespeaker']},
  {id: 'qwen3-asr-0.6b', name: 'Qwen3-ASR 0.6B', size: 680, uses: ['vad', 'aligner']},
  {id: 'speaker-diarization', name: '说话人区分', size: 5.7, pack: true, uses: ['wespeaker']},
  {id: 'qwen3-tts-0.6b-base', name: 'Qwen3-TTS 0.6B Base', cat: 'tts', size: 1899, uses: [], note: '克隆'},
  {id: 'qwen3-tts-1.7b-customvoice', name: 'Qwen3-TTS 1.7B CustomVoice', cat: 'tts', size: 2687, uses: [], note: '预设音色'},
  {id: 'indextts2', name: 'IndexTTS2', cat: 'tts', size: 3466, uses: []},
  {id: 'voxcpm2', name: 'VoxCPM2', cat: 'tts', size: 2818, uses: []},
  {id: 'vision-person', name: '人物定位', cat: 'vision', size: 6.4, uses: []},
  {id: 'qwen-image-2.1', name: 'Qwen-Image-2.1', cat: 'image', size: 10035, uses: [], license: {commercialUse: false}},
  {id: 'qwen-image-2.1-turbo', name: 'Qwen-Image-2.1 Turbo', cat: 'image', size: 18125, uses: [], license: {commercialUse: false}},
  {id: 'yue2-3b', name: 'YuE2 3B', cat: 'music', size: 4608, uses: [], supported: false},
];
const comps = [
  {id: 'vad', name: 'VAD 语音活动检测', size: 1.2, installed: true},
  {id: 'aligner', name: 'Forced aligner', size: 938, installed: true},
  {id: 'wespeaker', name: '声纹嵌入', size: 26.5, installed: true},
];
const none = () => false;
const ids = (list) => list.map((c) => c.m.id);

test('六步，Agent 排第一；最后一步是音乐生成', () => {
  assert.deepEqual(OB.STEPS.map((s) => s.k), ['agent', 'asr', 'tts', 'semantic', 'image', 'music']);
  assert.equal(OB.isLast('music'), true);
  assert.equal(OB.isLast('agent'), false);
  assert.equal(OB.stepOf('nope').k, 'agent');
});

test('只在第一次启动弹：走完或退出都记下，之后不再弹', () => {
  assert.equal(OB.shouldShow(null), true);
  assert.equal(OB.shouldShow(undefined), true);
  assert.equal(OB.shouldShow(OB.record('done', 'music', ['moss-transcribe'])), false);
  assert.equal(OB.shouldShow(OB.record('esc', 'agent')), false);
  assert.equal(OB.shouldShow({state: 'whatever'}), true);
});

test('记录：停在哪一步、这次引导里开始下载了哪些', () => {
  assert.deepEqual(OB.record('done', 'music', ['moss-transcribe', 'sem']), {state: 'done', step: 'music', downloaded: ['moss-transcribe', 'sem']});
  assert.deepEqual(OB.record('esc', 'tts'), {state: 'skipped', step: 'tts', downloaded: []});
  assert.deepEqual(OB.record('close'), {state: 'skipped', step: 'agent', downloaded: []});
  assert.equal(OB.recordText(null), '没有记录');
  assert.equal(OB.recordText(OB.record('esc', 'semantic')), '在「语义搜索」退出');
  assert.equal(OB.recordText(OB.record('done', 'music', ['a', 'b'])), '已走完 · 下载了 2 个');
});

test('原型的模拟启动：?onboarding=1 是全新安装，?onboarding=installed 是老用户升级', () => {
  assert.equal(OB.demoLaunch('?onboarding=1'), true);
  assert.equal(OB.demoFresh('?onboarding=1'), true);
  assert.equal(OB.demoLaunch('?onboarding=installed'), true);
  assert.equal(OB.demoFresh('?onboarding=installed'), false);
  assert.equal(OB.demoLaunch(''), false);
  assert.equal(OB.demoLaunch('?legacy=1'), false);
});

test('转录候选：只列语音识别模型、不含辅助包，推荐的 MOSS 排第一，副题写区分说话人的方式', () => {
  const list = OB.choices('asr', models, {'moss-transcribe': 'builtin', 'qwen3-asr-0.6b': 'pack'});
  assert.deepEqual(ids(list), ['moss-transcribe', 'qwen3-asr-0.6b']);
  assert.equal(list[0].recommended, true);
  assert.equal(list[0].note, '转录同时区分说话人');
  assert.equal(list[1].note, '要区分说话人，另装「说话人区分」');
});

test('其余几步的候选：语音合成只列三只、推荐 CustomVoice；图像推荐 Turbo；不支持的不列', () => {
  assert.deepEqual(ids(OB.choices('tts', models)), ['qwen3-tts-1.7b-customvoice', 'qwen3-tts-0.6b-base', 'voxcpm2']);
  assert.equal(OB.choices('tts', models)[0].note, '预设音色');
  assert.deepEqual(ids(OB.choices('image', models)), ['qwen-image-2.1-turbo', 'qwen-image-2.1']);
  assert.equal(OB.nonCommercial(models[9]), true);
  assert.equal(OB.nonCommercial(models[0]), false);
  assert.deepEqual(OB.choices('music', models), []);
  assert.deepEqual(OB.choices('agent', models), []);
  assert.deepEqual(OB.choices('semantic', models), []);
});

test('安装表：全新安装时组件也不在盘上；这次下好的部分算在盘上', () => {
  const fresh = OB.installTable(models, comps, OB.freshInstalled, true, []);
  assert.equal(fresh['moss-transcribe'], false);
  assert.equal(fresh.wespeaker, false);
  assert.equal(fresh['vision-person'], true);
  const got = OB.installTable(models, comps, OB.freshInstalled, true, ['wespeaker']);
  assert.equal(got.wespeaker, true);
  const upgraded = OB.installTable(models, comps, (id) => id === 'qwen3-asr-0.6b', false, []);
  assert.equal(upgraded['qwen3-asr-0.6b'], true);
  assert.equal(upgraded.aligner, true);
});

test('默认勾选：每一步至少勾一只——一只没装时勾推荐的（没有推荐的勾第一只），已经装了的算勾上、不再多勾', () => {
  const fresh = OB.installTable(models, comps, none, true, []);
  assert.deepEqual(OB.initialPicks('asr', OB.choices('asr', models), comps, fresh), ['moss-transcribe']);
  assert.deepEqual(OB.initialPicks('tts', OB.choices('tts', models), comps, fresh), ['qwen3-tts-1.7b-customvoice']);
  assert.deepEqual(OB.initialPicks('image', OB.choices('image', models), comps, fresh), ['qwen-image-2.1-turbo']);
  const music = [{m: {id: 'ace-step', size: 3500, uses: []}}, {m: {id: 'yue2-3b', size: 4608, uses: []}}];
  assert.deepEqual(OB.initialPicks('music', music, comps, fresh), ['ace-step']);
  const upgraded = OB.installTable(models, comps, (id) => id === 'qwen3-asr-0.6b' || id === 'voxcpm2', false, []);
  assert.deepEqual(OB.initialPicks('asr', OB.choices('asr', models), comps, upgraded), []);
  assert.deepEqual(OB.initialPicks('tts', OB.choices('tts', models), comps, upgraded), []);
  assert.deepEqual(OB.initialPicks('asr', [], comps, fresh), []);
});

test('要下多少：权重加缺的组件，共用的只算一份，与 BC_LOCALMODELS.needSize 一致', () => {
  const fresh = OB.installTable(models, comps, none, true, []);
  const p = OB.plan([models[0]], comps, fresh);
  assert.deepEqual(p.parts.map((x) => x.id), ['moss-transcribe', 'wespeaker']);
  assert.equal(p.parts[0].name, 'MOSS Transcribe');
  assert.equal(p.total, global.window.BC_LOCALMODELS.needSize(models[0], comps, fresh));
  assert.equal(OB.planLine(p), '一起下载：MOSS Transcribe 1.7 GB · 声纹嵌入 26.5 MB');
  // 两只共用声纹嵌入：只下一份
  const two = OB.plan([models[0], models[2]], comps, fresh);
  assert.deepEqual(two.parts.map((x) => x.id), ['moss-transcribe', 'wespeaker', 'speaker-diarization']);
  // 组件已在盘上（不是全新安装）就只下权重
  const kept = OB.installTable(models, comps, none, false, []);
  assert.deepEqual(OB.plan([models[0]], comps, kept).parts.map((x) => x.id), ['moss-transcribe']);
  assert.deepEqual(OB.plan([], comps, kept), {parts: [], total: 0});
  assert.equal(OB.planLine({parts: []}), null);
});

test('语义搜索包：没装时三部分都要下，装好了不下', () => {
  const pkg = {parts: [{id: 'embedding-text', size: 157}, {id: 'embedding', size: 462}, {id: 'litertlm-runtime', size: 43}]};
  assert.equal(OB.pkgPlan(pkg, false).total, 662);
  assert.deepEqual(OB.pkgPlan(pkg, true), {parts: [], total: 0});
});

test('主按钮：有要下的写「后台下载 X 并继续」，没有就往下走，最后一步是完成', () => {
  const fresh = OB.installTable(models, comps, none, true, []);
  assert.deepEqual(OB.primary('asr', OB.plan([models[0]], comps, fresh)), {kind: 'download', label: '后台下载 1.7 GB 并继续'});
  assert.deepEqual(OB.primary('asr', {parts: [], total: 0}), {kind: 'next', label: '下一步'});
  assert.deepEqual(OB.primary('music', {parts: [], total: 0}), {kind: 'next', label: '完成'});
  assert.equal(OB.primary('music', {parts: [{id: 'yue2-3b', size: 4608}], total: 4608}).label, '后台下载 4.5 GB 并完成');
});

/* Agent 一步：用一份最小的 BC_AGENT_SETUP 替身，只验这一层怎么分行、怎么写 */
const AS = {
  groups: (list) => ({main: list.filter((h) => !h.extra), more: list.filter((h) => h.extra)}),
  health: (h) => (!h.found ? 'missing' : h.loggedIn === false ? 'login' : h.enabled === false ? 'off' : 'ready'),
  problem: (h) => (h.loggedIn === false ? {title: `${h.name} 需要重新登录`} : null),
  installMethods: (h) => h.installs || [],
  runnable: (m) => !!m && !/\|\s*bash\b/.test(m.cmd),
  loginCmd: (h) => h.cmd,
};
const agents = [
  {id: 'claude', name: 'Claude Code', cmd: 'claude', found: true, enabled: true, ver: '2.2.0', account: 'Claude Pro 订阅 · 已登录'},
  {id: 'codex', name: 'Codex', cmd: 'codex', found: false, plan: 'ChatGPT Plus 或 Pro 订阅',
    installs: [{k: 'brew', label: 'Homebrew', cmd: 'brew install codex'}, {k: 'npm', label: 'npm', cmd: 'npm i -g @openai/codex'}]},
  {id: 'antigravity', name: 'Antigravity', cmd: 'agy', found: false, plan: 'Google 账号',
    installs: [{k: 'script', label: '官方脚本', cmd: 'curl -fsSL https://example.com/install.sh | bash'}]},
  {id: 'opencode', name: 'OpenCode', cmd: 'opencode', found: true, loggedIn: false, ver: '2.0.1'},
  {id: 'gemini', name: 'Gemini CLI', cmd: 'gemini', found: true, enabled: false, ver: '0.9.0', account: 'Google 账号'},
  {id: 'amp', name: 'Amp', found: false, extra: true},
];

test('Agent 一步：主列表每家一行，能用 / 停用的可勾（启用），要处理的不给勾，没装的看能不能在后台装', () => {
  const rows = OB.agentRows(agents, AS);
  assert.deepEqual(rows.map((r) => [r.h.id, r.kind]),
    [['claude', 'use'], ['codex', 'install'], ['antigravity', 'manual'], ['opencode', 'fix'], ['gemini', 'use']]);
  assert.equal(rows[1].method.k, 'brew');
  assert.equal(rows[2].method, null);
});

test('Agent 一行下面那一句：版本与账号、问题、订阅；勾上要装的写怎么装和怎么登录', () => {
  const rows = OB.agentRows(agents, AS);
  assert.equal(OB.agentLine(rows[0], {picked: true}, AS), '本机已安装 · v2.2.0 · Claude Pro 订阅');
  assert.equal(OB.agentLine(rows[1], {picked: false}, AS), '未安装 · 装好后用你已有的 ChatGPT Plus 或 Pro 订阅登录');
  assert.equal(OB.agentLine(rows[1], {picked: true}, AS), '用 Homebrew 在后台安装（brew install codex）· 装好后在终端里运行 codex 登录');
  assert.equal(OB.agentLine(rows[2], {picked: false}, AS), '只能在终端里按官方说明安装 · 说明在 设置 › Agent 提供方');
  assert.equal(OB.agentLine(rows[3], {picked: false}, AS), 'OpenCode 需要重新登录 · 在 设置 › Agent 提供方 里处理');
});

test('Agent 一行在装与没装成：在装（含排队）写「正在用…」；没装成又没再勾上写去后台任务看，再勾上写这次怎么装', () => {
  const rows = OB.agentRows(agents, AS);
  assert.equal(OB.agentLine(rows[1], {picked: true, running: true}, AS), '正在用 Homebrew 在后台安装 · 装好后在终端里运行 codex 登录');
  assert.equal(OB.agentLine(rows[1], {picked: false, failed: true}, AS), '没装成 · 详情在后台任务里');
  assert.equal(OB.agentLine(rows[1], {picked: true, failed: true}, AS), '用 Homebrew 在后台安装（brew install codex）· 装好后在终端里运行 codex 登录');
});

test('排着队的一家走到哪了：没轮到、在装算在跑，装好 done，没装成与被停止都是 error', () => {
  const tasks = [{id: 'a1', status: 'running'}, {id: 'a2', status: 'done'}, {id: 'a3', status: 'error'},
    {id: 'a4', status: 'error', canceled: true}];
  assert.equal(OB.agentJobStatus({tid: null, failed: false}, tasks), 'running');
  assert.equal(OB.agentJobStatus({tid: 'a1', failed: false}, tasks), 'running');
  assert.equal(OB.agentJobStatus({tid: 'a2', failed: false}, tasks), 'done');
  assert.equal(OB.agentJobStatus({tid: 'a3', failed: false}, tasks), 'error');
  assert.equal(OB.agentJobStatus({tid: 'a4', failed: false}, tasks), 'error');
  assert.equal(OB.agentJobStatus({tid: null, failed: true}, tasks), 'error');
});

test('Agent 一步的主按钮：勾了要装的写「后台安装 N 个并继续」，否则下一步', () => {
  assert.deepEqual(OB.agentPrimary(2), {kind: 'install', label: '后台安装 2 个并继续'});
  assert.deepEqual(OB.agentPrimary(0), {kind: 'next', label: '下一步'});
});

test('底部那一行：只有一件在跑时写名字与百分比（Agent 没有百分比），几件同时在跑只写个数，跑完的、没成的只计数；Agent 写「安装」', () => {
  assert.equal(OB.bgLine([]), null);
  assert.equal(OB.bgLine([{name: 'MOSS Transcribe', pct: 31.4, status: 'running'}, {name: '语义搜索', pct: 100, status: 'done'}]),
    '后台在下载 MOSS Transcribe 31% · 1 个已下完');
  assert.equal(OB.bgLine([{name: 'A', pct: 10, status: 'running'}, {name: 'B', pct: 20, status: 'running'}]), '后台在下载 2 个');
  assert.equal(OB.bgLine([{name: 'A', pct: 100, status: 'done'}, {name: 'B', pct: 40, status: 'error'}]),
    '后台下载 · 1 个已下完 · 1 个没下成');
  // 装 Agent 给不出进度（pct 为 null）：只写名字，不写百分比
  assert.equal(OB.bgLine([{name: 'Codex', pct: null, status: 'running', agent: true}, {name: 'A', pct: 100, status: 'done'}]),
    '后台在安装 Codex · 1 个已下完');
  assert.equal(OB.bgLine([{name: 'A', pct: 10, status: 'running'}, {name: 'B', pct: 20, status: 'running'},
    {name: 'Codex', pct: null, status: 'done', agent: true}, {name: 'C', pct: 100, status: 'done'}]), '后台在下载 2 个 · 2 个已完成');
  assert.equal(OB.bgLine([{name: 'Codex', pct: null, status: 'done', agent: true}]), '后台安装 · 1 个已装好');
  assert.equal(OB.bgLine([{name: 'Codex', pct: null, status: 'running', agent: true}, {name: 'A', pct: 20, status: 'running'}]),
    '后台在下载和安装 2 个');
});
