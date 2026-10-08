const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-legacy-import.js');
require('./model-legacy-import-run.js');
const LI = global.window.BC_LEGACY_IMPORT;
const R = global.window.BC_LEGACY_IMPORT_RUN;

const runAll = (legacy, mounted) => R.settle(legacy, mounted);

test('开始导入：全部排队，第一个在导入；任务记录在跑、念当前项目', () => {
  const l = R.start(LI.DEMO_FOUND, '~/Documents/BaoCut', 'darwin');
  const c = R.counts(l);
  assert.equal(c.total, 8);
  assert.equal(c.running, 1);
  assert.equal(c.queued, 7);
  assert.equal(R.current(l).title, LI.DEMO_FOUND[0].title);
  const p = R.taskPatch(l);
  assert.equal(p.status, 'running');
  assert.equal(p.pct, 0);
  assert.equal(p.phase, '导入中');
  assert.equal(p.detail, `正在导入「${LI.DEMO_FOUND[0].title}」`);
  assert.equal(p.sub, '已导入 0/8 · 导入到 ~/Documents/BaoCut');
  assert.equal(p.attention, null);
});

test('一步一个：落到结局再拉起下一个，进度按处理过的项目数', () => {
  const l = R.step(R.start(LI.DEMO_FOUND, '~/Documents/BaoCut', 'darwin'));
  assert.equal(l.items[0].state, 'done');
  assert.equal(l.items[1].state, 'running');
  assert.equal(R.taskPatch(l).pct, 13);
});

test('跑完：没导入的留在待处理，任务算完成但带「N 个待处理」', () => {
  const l = runAll(R.start(LI.DEMO_FOUND, '~/Documents/BaoCut', 'darwin'));
  const c = R.counts(l);
  assert.deepEqual([c.done, c.missing, c.error, c.live], [4, 3, 1, 0]);
  const p = R.taskPatch(l);
  assert.equal(p.status, 'done');
  assert.equal(p.pct, 100);
  assert.equal(p.phase, null);
  assert.equal(p.attention, '4 个待处理');
  assert.equal(p.sub, '已导入 4 · 待处理 4 · 导入到 ~/Documents/BaoCut');
  assert.deepEqual(R.finishToast(l), {text: '导入结束：4 个已导入，4 个没导入', tone: 'neutral', action: 'result'});
});

test('原因分组：每块没接上的硬盘一组，文件不在原处一组，读不出来一组；每组有原因与补救', () => {
  const gs = R.groups(runAll(R.start(LI.DEMO_FOUND, '~/Documents/BaoCut', 'darwin')));
  assert.deepEqual(gs.map((g) => [g.kind, g.items.length]), [['volume', 2], ['moved', 1], ['error', 1]]);
  const drive = gs[0];
  assert.equal(drive.title, '移动硬盘「Extreme SSD」没接上');
  assert.match(drive.why, /这 2 个项目.*\/Volumes\/Extreme SSD/);
  assert.match(drive.fix, /接上硬盘后点「重试」/);
  assert.match(drive.fix, /下次启动 BaoCut 会自动再试/);
  gs.forEach((g) => { assert.ok(g.title && g.why && g.fix, g.kind); });
});

test('Windows：硬盘是盘符，路径用反斜杠', () => {
  const l = runAll(R.start(LI.DEMO_FOUND, 'C:\\Users\\me\\Documents\\BaoCut', 'win32'));
  const drive = R.groups(l)[0];
  assert.equal(drive.volume.root, 'E:\\');
  assert.equal(drive.items[0].missing[0], 'E:\\2025\\京都\\A001.MP4');
  assert.match(l.items[0].path, /^C:\\Users\\me\\AppData\\Roaming\\BaoCut\\projects\\p1$/);
});

test('卡片一句话与单行说明', () => {
  const l = runAll(R.start(LI.DEMO_FOUND, '~/Documents/BaoCut', 'darwin'));
  assert.equal(R.cardNote(l), '2 个项目的素材在没接上的「Extreme SSD」上，1 个项目的素材文件找不到，1 个项目的文件读不出来。');
  assert.match(R.cardHint(l), /^接上「Extreme SSD」后点「全部重试」/);
  assert.match(R.cardHint(R.skip(l, R.groups(l)[0].items.map((it) => it.path))), /原因和处理办法在详情里/);
  assert.equal(R.cardHint(R.skip(l)), '');
  const kyoto = l.items.find((it) => it.title === '周末 vlog · 京都赏枫');
  assert.equal(R.itemNote(kyoto), '缺 3 个文件，例如 /Volumes/Extreme SSD/2025/京都/A001.MP4');
  const course = l.items.find((it) => it.title === '课程录屏 · 第 2 讲');
  assert.equal(R.itemNote(course), '缺 ~/Movies/课程录屏/第 2 讲.mov');
  assert.match(R.itemNote(l.items.find((it) => it.state === 'error')), /project\.json/);
});

test('重试：硬盘接上了就导入成功，没接上还是待处理；读不出来的重试还是读不出来', () => {
  const done = runAll(R.start(LI.DEMO_FOUND, '~/Documents/BaoCut', 'darwin'));
  const again = R.retry(done);
  assert.equal(R.counts(again).live, 4);
  assert.equal(R.taskPatch(again).status, 'running');
  const still = runAll(again);
  assert.equal(R.counts(still).pending, 4);
  assert.deepEqual(R.finishToast(still), {text: '重试的 4 个还是没导入', tone: 'neutral', action: 'result'});
  const mounted = runAll(R.retry(done), [R.demoDrive('darwin').root]);
  const c = R.counts(mounted);
  assert.deepEqual([c.done, c.missing, c.error], [6, 1, 1]);
  assert.deepEqual(R.finishToast(mounted), {text: '重试的 4 个里 2 个已导入，2 个还是没导入', tone: 'neutral', action: 'result'});
  const drivePaths = R.groups(done)[0].items.map((it) => it.path);
  const ok = runAll(R.retry(done, drivePaths), [R.demoDrive('darwin').root]);
  assert.deepEqual(R.finishToast(ok), {text: '重试的 2 个项目都已导入', tone: 'positive', action: 'open'});
  assert.equal(R.retry(ok, drivePaths), ok, '已经导入的不再重试');
});

test('只重试 / 跳过点到的那几个；跳过的不算待处理，能改为导入', () => {
  const done = runAll(R.start(LI.DEMO_FOUND, '~/Documents/BaoCut', 'darwin'));
  const errorPath = done.items.find((it) => it.state === 'error').path;
  const skipped = R.skip(done, [errorPath]);
  let c = R.counts(skipped);
  assert.deepEqual([c.skipped, c.pending], [1, 3]);
  assert.equal(R.taskPatch(skipped).attention, '3 个待处理');
  assert.equal(R.taskPatch(skipped).sub, '已导入 4 · 待处理 3 · 已跳过 1 · 导入到 ~/Documents/BaoCut');
  // 重试缺省不碰跳过的
  c = R.counts(R.retry(skipped));
  assert.deepEqual([c.skipped, c.live], [1, 3]);
  // 「改为导入」：点名的跳过项重新排队
  const back = R.retry(skipped, [errorPath]);
  assert.equal(back.items.find((it) => it.path === errorPath).state, 'running');
  // 撤销跳过：放回原来的原因，不重新导入
  const undone = R.unskip(skipped, [errorPath]);
  assert.equal(undone.items.find((it) => it.path === errorPath).state, 'error');
  assert.equal(R.counts(undone).live, 0);
  // 全部跳过：不再有待处理，任务干净地完成
  const all = R.skip(done);
  assert.equal(R.counts(all).pending, 0);
  assert.equal(R.taskPatch(all).attention, null);
});

test('全部导入成功：toast 去 Space 看；其他任务在跑时念「等其他任务」', () => {
  const found = LI.DEMO_FOUND.filter((f) => !R.DEMO_PROBLEMS[f.title]);
  const l = runAll(R.start(found, '~/Documents/BaoCut', 'darwin'));
  assert.deepEqual(R.finishToast(l), {text: '4 个旧版项目已导入', tone: 'positive', action: 'open'});
  const waiting = Object.assign({}, R.start(found, '~/Documents/BaoCut', 'darwin'), {waiting: true});
  const p = R.taskPatch(waiting);
  assert.equal(p.phase, '等其他任务');
  assert.match(p.detail, /等它们结束后自动继续/);
});

test('Home 顶上那一条：在跑报进度，跑完有没导入的报结果，全导入了不出', () => {
  const l = R.step(R.start(LI.DEMO_FOUND, '~/Documents/BaoCut', 'darwin'));
  assert.deepEqual(R.banner(l), {
    state: 'running', title: '正在导入旧版项目 · 1/8',
    detail: `正在导入「${LI.DEMO_FOUND[1].title}」 · 导入到 ~/Documents/BaoCut`, pct: 13,
  });
  const done = R.settle(l);
  const b = R.banner(done);
  assert.equal(b.state, 'result');
  assert.equal(b.title, '旧版项目导入结束：4 个已导入，4 个没导入');
  assert.equal(b.detail, R.cardNote(done));
  assert.equal(R.banner(R.skip(done)), null);
});
