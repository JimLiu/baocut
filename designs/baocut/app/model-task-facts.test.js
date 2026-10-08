const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-task-facts.js');
const F = global.window.BC_TASK_FACTS;

const keynote = () => ({
  id: 'p2', title: '产品发布会 · 主视频', duration: 3120,
  src: {name: 'launch-keynote.mov', path: '~/Movies/发布会/launch-keynote.mov'},
});

test('时长与用时的写法跟核心同一口径', () => {
  assert.strictEqual(F.clock(206), '3:26');
  assert.strictEqual(F.clock(3120), '52:00');
  assert.strictEqual(F.clock(3723), '1:02:03');
  assert.strictEqual(F.took(42000), '42s');
  assert.strictEqual(F.took(760000), '12m 40s');
  assert.strictEqual(F.took(3900000), '1h 5m');
  assert.strictEqual(F.fmtSize(612 * 1024 * 1024), '612 MB');
  assert.strictEqual(F.fmtSize(1536 * 1024 * 1024), '1.5 GB');
  assert.strictEqual(F.fmtCount(6180), '6,180');
});

test('项目库里的项目：媒体读项目记录，给「打开项目」', () => {
  const s = F.source({kind: 'transcribe', project: 'p2'}, keynote());
  assert.deepStrictEqual(s.media, {name: 'launch-keynote.mov', path: '~/Movies/发布会/launch-keynote.mov', duration: 3120});
  assert.strictEqual(s.project.registered, true);
  assert.strictEqual(s.project.title, '产品发布会 · 主视频');
});

test('不在项目库里的包：标题取包名，媒体读任务记录上探到的那份', () => {
  const t = {kind: 'transcribe', project: null, pkg: '/tmp/bcut-review/review-v1.bcut',
    media: {name: 'dry-voice.wav', path: '/tmp/bcut-review/review-v1/dry-voice.wav', duration: 162}};
  const s = F.source(t, null);
  assert.deepStrictEqual(s.project, {id: null, title: 'review-v1.bcut', path: '/tmp/bcut-review/review-v1.bcut', registered: false});
  assert.strictEqual(s.media.duration, 162);
});

test('没探到媒体时只剩项目；什么都没有时两块都缺席', () => {
  const s = F.source({kind: 'transcribe', pkg: '/tmp/a.bcut'}, null);
  assert.strictEqual(s.media, null);
  assert.strictEqual(s.project.path, '/tmp/a.bcut');
  assert.deepStrictEqual(F.source({kind: 'export'}, null), {media: null, project: null});
});

test('已转录内容只在转录还在跑时出现', () => {
  const segs = [{start: 10, end: 14, text: '第二句'}, {start: 2, end: 6, text: '第一句'}];
  assert.strictEqual(F.transcript({kind: 'transcribe', status: 'done', liveSegments: segs}, 60), null);
  assert.strictEqual(F.transcript({kind: 'export', status: 'running', liveSegments: segs}, 60), null);
  const tr = F.transcript({kind: 'transcribe', status: 'running', liveSegments: segs}, 3120);
  assert.deepStrictEqual(tr.segments.map((s) => s.text), ['第一句', '第二句'], '按时间顺序排');
  assert.strictEqual(F.transcriptSummary(tr), '2 段 · 转录到 0:14 / 52:00');
  assert.strictEqual(F.transcriptSummary(F.transcript({kind: 'transcribe', status: 'running', liveSegments: segs})), '2 段 · 转录到 0:14', '不知道总长就不写分母');
});

test('还没有文字时给空列表，计数头是空串；最多留 40 段且留最新的', () => {
  const empty = F.transcript({kind: 'retranscribe', status: 'running', liveSegments: [{start: 0, end: 1, text: '  '}]}, 60);
  assert.deepStrictEqual(empty.segments, []);
  assert.strictEqual(F.transcriptSummary(empty), '');
  const many = Array.from({length: 45}, (_, i) => ({start: i, end: i + 1, text: `第 ${i} 段`}));
  const tr = F.transcript({kind: 'transcribe', status: 'running', liveSegments: many}, 60);
  assert.strictEqual(tr.segments.length, F.LIVE_SEGMENT_LIMIT);
  assert.strictEqual(tr.segments[0].text, '第 5 段');
});

test('详情只产出有值的行', () => {
  const rows = F.details({kind: 'transcribe', status: 'queued', source: 'app', started: '25 分钟前'}, '转录');
  assert.deepStrictEqual(rows.map((r) => r[0]), ['类型', '发起方', '状态', '开始于']);
});

test('转录在跑：语言 / 调用含重试 / 剩余 / 用时', () => {
  const rows = Object.fromEntries(F.details({kind: 'transcribe', status: 'running', source: 'app', started: '12 分钟前',
    lang: '中文', callsDone: 84, callsTotal: 120, callsRetried: 3, leftMs: 930000, elapsedMs: 760000}, '转录'));
  assert.strictEqual(rows['调用'], '84/120 · 重试 3');
  assert.strictEqual(rows['预计剩余'], '15m 30s');
  assert.strictEqual(rows['用时'], '12m 40s');
  assert.strictEqual(rows['状态'], '进行中');
});

test('导出：帧数从总帧与进度推出，速度只在跑的时候写；跑完不写剩余', () => {
  const run = Object.fromEntries(F.details({kind: 'export', status: 'running', frames: 6180, pctFine: 50, fps: 212, leftMs: 14000}, '导出'));
  assert.strictEqual(run['帧'], '3,090/6,180');
  assert.strictEqual(run['速度'], '212 fps');
  assert.strictEqual(run['预计剩余'], '14s');
  const done = Object.fromEntries(F.details({kind: 'export', status: 'done', framesDone: 6180, framesTotal: 6180, fps: 212, leftMs: 0, elapsedMs: 94000}, '导出'));
  assert.strictEqual(done['帧'], '6,180/6,180');
  assert.strictEqual(done['速度'], undefined);
  assert.strictEqual(done['预计剩余'], undefined);
  assert.strictEqual(done['用时'], '1m 34s');
});

test('下载：已传输字节；撤销与取消的状态念法', () => {
  const rows = Object.fromEntries(F.details({kind: 'import', status: 'running', bytesDone: 612 * 1024 * 1024, bytesTotal: 1536 * 1024 * 1024}, '导入视频'));
  assert.strictEqual(rows['已传输'], '612 MB / 1.5 GB');
  assert.strictEqual(F.statusLabel({status: 'done', undone: true}), '已撤销');
  assert.strictEqual(F.statusLabel({status: 'error', canceled: true}), '已取消');
});

test('智能裁剪任务的详情多出目标画幅 / 场景 / 原片三行', () => {
  const rows = Object.fromEntries(F.details({kind: 'crop', status: 'queued', stage: 'review', source: 'app', started: '刚刚',
    crop: {ratio: '9:16', scene: '多人对谈', source: 'lecture.mp4'}}, '智能裁剪'));
  assert.equal(rows['目标画幅'], '9:16'); assert.equal(rows['场景'], '多人对谈'); assert.equal(rows['原片'], 'lecture.mp4');
  assert.equal(rows['阶段'], '等你检查');
});

/* ---------- 图片任务（2026-09-27） ---------- */

const codexRun = () => ({id: 'im1', kind: 'image', stage: 'image', status: 'running', pct: 4, source: 'cli', startedAt: 1000,
  detail: '第 1 行 · Codex 正在画 · 15 秒',
  images: [{line: 1, prompt: '一只橘猫趴在窗台上晒太阳，水彩风格，暖色调，背景是老城区的屋顶', model: 'agent:codex/gpt-image',
    engine: 'codex', status: 'running', n: 1, aspect: '1:1', paths: [], elapsedMs: 15000}]});

const cloudBatch = () => ({id: 'im2', kind: 'image', stage: 'image', status: 'done', project: 'p5', title: null,
  elapsedMs: 41000,
  images: [
    {line: 1, prompt: '城市夜景', model: 'cloud:openai/gpt-image-2', modelName: 'gpt-image-2', engine: 'cloud', status: 'done',
     n: 2, aspect: '16:9', paths: ['/a/1.png', '/a/2.png'], cost: {amount: 0.04, currency: 'USD'}, elapsedMs: 12000},
    {line: 2, prompt: '海边日出', model: 'cloud:openai/gpt-image-2', engine: 'cloud', status: 'done',
     n: 1, aspect: '16:9', paths: ['/a/3.png'], cost: {amount: 0.04, currency: 'USD'}, elapsedMs: 9000},
    {line: 3, prompt: '山间小路', model: 'cloud:openai/gpt-image-2', engine: 'cloud', status: 'error',
     n: 1, aspect: '16:9', paths: [], cost: {amount: 0.04, currency: 'USD'}, error: '提示词被服务商的内容策略拦下'},
  ]});

test('图片任务的来源卡只有项目行：项目的视频不是它的输入', () => {
  const s = F.source({kind: 'image', project: 'p2'}, keynote());
  assert.strictEqual(s.media, null);
  assert.strictEqual(s.project.title, '产品发布会 · 主视频');
});

test('图片摘要：已完成 / 总行数 · 在画数 · 估价只计已完成的', () => {
  const im = F.images(cloudBatch());
  assert.strictEqual(im.done, 2);
  assert.strictEqual(im.total, 3);
  assert.strictEqual(im.running, 0);
  assert.deepStrictEqual(im.spent, [{currency: 'USD', amount: 0.08}], '失败行的估价不计');
  assert.strictEqual(im.engine, 'cloud');
  assert.strictEqual(F.imagesSummary(im), '2/3 张 · 约 $0.08');
  const mid = cloudBatch(); mid.images[2].status = 'running';
  assert.strictEqual(F.imagesSummary(F.images(mid)), '2/3 张 · 1 在画 · 约 $0.08');
});

test('图片摘要：Codex 写订阅额度，本机写不花钱，云端还没画完一张不写花费', () => {
  assert.strictEqual(F.imagesSummary(F.images(codexRun())), '0/1 张 · 1 在画 · 用 Codex 订阅额度');
  const local = {kind: 'image', images: [{line: 1, prompt: 'x', model: 'local:qwen-image-2.1', status: 'done', n: 1}]};
  assert.strictEqual(F.images(local).engine, 'local', '缺 engine 时按前缀兜底');
  assert.strictEqual(F.imagesSummary(F.images(local)), '1/1 张 · 本机生成 · 不花钱');
  const remote = {kind: 'image', images: [{line: 1, prompt: 'x', model: 'remote:studio/qwen-image-2.1', status: 'done', n: 1}]};
  assert.strictEqual(F.imagesSummary(F.images(remote)), '1/1 张 · 在已配对的电脑上生成 · 不花钱');
  assert.strictEqual(F.imageMeta(remote.images[0]), 'qwen-image-2.1 · 1 张');
  const fresh = {kind: 'image', images: [{line: 1, prompt: 'x', model: 'cloud:openai/gpt-image-2', status: 'queued', cost: {amount: 0.28, currency: 'USD'}}]};
  assert.strictEqual(F.imagesSummary(F.images(fresh)), '0/1 张');
  const two = {kind: 'image', images: [
    {line: 1, status: 'done', model: 'cloud:a/b', cost: {amount: 0.1, currency: 'CNY'}},
    {line: 2, status: 'done', model: 'cloud:c/d', cost: {amount: 0.04, currency: 'USD'}}]};
  assert.strictEqual(F.imagesCost(F.images(two)), '约 ¥0.10 + $0.04', '币种分开记；格式器按币种通用');
  const eur = {kind: 'image', images: [{line: 1, status: 'done', model: 'cloud:a/b', cost: {amount: 0.1, currency: 'EUR'}}]};
  assert.strictEqual(F.imagesCost(F.images(eur)), '约 EUR 0.10', '不认识的币种写代码前缀');
});

test('图片行：超过 24 行只列 24 行，总数按 imagesTotal；提示词截 300 字', () => {
  const rows = Array.from({length: 30}, (_, i) => ({line: i + 1, prompt: '字'.repeat(320), model: 'cloud:a/b', status: 'queued'}));
  const im = F.images({kind: 'image', images: rows, imagesTotal: 40});
  assert.strictEqual(im.items.length, F.IMAGE_ROW_LIMIT);
  assert.strictEqual(im.total, 40);
  assert.strictEqual(Array.from(im.items[0].prompt).length, 301, '300 字 + 省略号');
  assert.strictEqual(F.images({kind: 'transcribe'}), null);
});

test('图片元信息：模型 · 画幅 · N 张 · 约 ¥ · 秒数，缺的不写', () => {
  const [a, , c] = cloudBatch().images;
  assert.strictEqual(F.imageMeta(a), 'gpt-image-2 · 16:9 · 2 张 · 约 $0.04 · 12 s');
  assert.strictEqual(F.imageMeta(c), 'gpt-image-2 · 16:9 · 1 张 · 约 $0.04', '没有秒数就不写；模型名取 id 的最后一段');
  assert.strictEqual(F.imageMeta(codexRun().images[0]), 'Codex · 1:1 · 1 张 · 15 s', 'Codex 行不写估价');
  assert.strictEqual(F.imageMeta({model: 'local:qwen-image-2.1', status: 'queued', elapsedMs: 0}), 'qwen-image-2.1');
  assert.strictEqual(F.imageStatus({status: 'running'}).label, '正在画');
  assert.strictEqual(F.imageStatus({status: 'cancelled'}).label, '已取消');
});

test('标题兜底：发起方标题 → 第一行提示词（40 字）→ 种类名；阶段机器值不进标题', () => {
  assert.strictEqual(F.taskTitle({title: '导出 · 访谈', stage: 'export'}, '导出'), '导出 · 访谈');
  assert.strictEqual(F.taskTitle(codexRun(), '生成图片'), '一只橘猫趴在窗台上晒太阳，水彩风格，暖色调，背景是老城区的屋顶');
  const long = {kind: 'image', images: [{prompt: '长'.repeat(50)}]};
  assert.strictEqual(F.taskTitle(long, '生成图片'), '长'.repeat(40) + '…');
  assert.strictEqual(F.taskTitle({kind: 'transcribe', stage: 'transcribe'}, '转录'), '转录');
});

test('列表副行：「提示词前 24 字…」 · 已完成/总行数', () => {
  assert.strictEqual(F.cardSub({...cloudBatch(), title: '短视频切片 · 第 7 条'}), '「城市夜景」 · 2/3 张');
  assert.strictEqual(F.cardSub(codexRun()), '0/1 张', '标题已是提示词，副行不重复');
  assert.strictEqual(F.cardSub({kind: 'export'}), null);
});

test('详情：阶段与种类同名不出，不同名照出；图片任务多图片与花费两格', () => {
  const run = Object.fromEntries(F.details(codexRun(), '生成图片', 16000));
  assert.strictEqual(run['阶段'], undefined, 'stage image = kind image');
  assert.strictEqual(run['图片'], '0/1');
  assert.strictEqual(run['花费'], '用 Codex 订阅额度');
  assert.strictEqual(run['用时'], '15s', '运行中没报 elapsedMs：从 startedAt 现算');
  const done = Object.fromEntries(F.details(cloudBatch(), '生成图片'));
  assert.strictEqual(done['图片'], '2/3');
  assert.strictEqual(done['花费'], '约 $0.08');
  assert.strictEqual(done['用时'], '41s');
  const tr = Object.fromEntries(F.details({kind: 'transcribe', stage: 'transcribe', status: 'error'}, '转录'));
  assert.strictEqual(tr['阶段'], undefined);
  const other = Object.fromEntries(F.details({kind: 'translate', stage: 'align', status: 'running'}, '翻译'));
  assert.strictEqual(other['阶段'], 'align');
});

test('详情：用时现算只在运行中、有数字开始时刻、且给了 now 时发生', () => {
  const base = {kind: 'export', status: 'running', startedAt: 5000};
  assert.strictEqual(Object.fromEntries(F.details(base, '导出'))['用时'], undefined, '没有 now 不猜');
  assert.strictEqual(Object.fromEntries(F.details(Object.assign({}, base, {status: 'done'}), '导出', 99000))['用时'], undefined);
  assert.strictEqual(Object.fromEntries(F.details(Object.assign({}, base, {elapsedMs: 3000}), '导出', 99000))['用时'], '3s', 'elapsedMs 优先');
  assert.strictEqual(Object.fromEntries(F.details(base, '导出', 95000))['用时'], '1m 30s');
});
