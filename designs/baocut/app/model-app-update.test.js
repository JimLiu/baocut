/* App 自动更新纯模型的测试。2026-10-05：补已下载后的静默检查、退出即安装、下载到 100% 的校验段。
   2026-10-05 晚：停止屏障的三个选择与等待态（关于页、更新窗；等待时更新窗不写「退出时会自动安装」那句）。 */
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-app-update.js');
const U = global.window.BC_UPDATE;
const info = U.DEMO_INFO;

test('节奏：启动后 15 s 第一次，之后每 6 小时', () => {
  assert.equal(U.FIRST_CHECK_DELAY_S, 15);
  assert.equal(U.CHECK_INTERVAL_H, 6);
  assert.equal(U.nextAutoCheckAt(1000, null), 1015);
  assert.equal(U.nextAutoCheckAt(1000, 500), 1015, '上次检查早于这次启动：照样启动后 15 s 查');
  assert.equal(U.nextAutoCheckAt(1000, 1015), 1015 + 6 * 3600);
});

test('偏好缺席即开', () => {
  assert.equal(U.autoUpdateOn({}), true);
  assert.equal(U.autoUpdateOn(null), true);
  assert.equal(U.autoUpdateOn({appAutoUpdate: true}), true);
  assert.equal(U.autoUpdateOn({appAutoUpdate: false}), false);
});

test('feed 地址与下载页', () => {
  assert.equal(U.FEEDS['aarch64-apple-darwin'], 'https://baocut.app/v2/appcast-aarch64-apple-darwin.json');
  assert.equal(U.FEEDS['x86_64-pc-windows-msvc'], 'https://baocut.app/v2/appcast-x86_64-pc-windows-msvc.json');
  assert.equal(U.DOWNLOAD_PAGE, 'https://baocut.app/v2/');
  assert.equal(U.LANGS.length, 15);
});

test('只比 build', () => {
  assert.equal(U.isNewer({build: 57}, {build: 56}), true);
  assert.equal(U.isNewer({build: 56}, {build: 56}), false);
  assert.equal(U.isNewer(null, {build: 56}), false);
});

test('版本说明：取当前语言，缺了回落 notes，最多 6 行', () => {
  const zh = U.notesFor(info, 'zh-Hans');
  assert.equal(zh.lines.length, 6);
  assert.equal(zh.more, true);
  assert.match(zh.lines[0], /^设置 › 关于/);
  const de = U.notesFor(info, 'de');
  assert.match(de.lines[0], /^Settings › About/);
  assert.deepEqual(U.notesFor({notes: 'a\n\n b '}, 'en'), {lines: ['a', 'b'], more: false});
  assert.equal(U.langCode('跟随系统'), 'zh-Hans');
  assert.equal(U.langCode('Deutsch'), 'de');
  assert.equal(U.langCode('Klingon', 'en'), 'en', '没列出的语言落到给定的缺省');
});

test('相对时间', () => {
  assert.equal(U.relTime(100, 130), '刚刚');
  assert.equal(U.relTime(0, 5 * 60), '5 分钟前');
  assert.equal(U.relTime(0, 3 * 3600 + 10), '3 小时前');
  assert.equal(U.relTime(0, 2 * 86400), '2 天前');
});

test('状态机：检查 → 有新版本 → 下载 → 就绪 → 安装', () => {
  let s = {k: 'idle'};
  s = U.reduce(s, {type: 'check'});
  assert.equal(s.k, 'checking');
  assert.equal(U.reduce(s, {type: 'none'}).k, 'upToDate');
  s = U.reduce(s, {type: 'found', info});
  assert.deepEqual(s, {k: 'available', info});
  s = U.reduce(s, {type: 'download'});
  assert.deepEqual(s, {k: 'downloading', info, pct: 0});
  s = U.reduce(s, {type: 'progress', pct: 41.6});
  assert.equal(s.pct, 42);
  assert.deepEqual(U.reduce(s, {type: 'cancel'}), {k: 'available', info});
  assert.equal(U.reduce(s, {type: 'check'}), s, '下载中不重查');
  s = U.reduce(s, {type: 'downloaded', path: '/tmp/x.zip'});
  assert.deepEqual(s, {k: 'ready', info, path: '/tmp/x.zip'});
  s = U.reduce(s, {type: 'install'});
  assert.equal(s.k, 'installing');
});

test('状态机：两种失败，重试各回各的那一步', () => {
  const checkFail = U.reduce({k: 'checking'}, {type: 'fail', msg: 'x'});
  assert.deepEqual(checkFail, {k: 'error', msg: 'x', info: null});
  assert.deepEqual(U.retryEvent(checkFail), {type: 'check'});
  const verifyFail = U.reduce({k: 'downloading', info, pct: 90}, {type: 'fail', msg: 'y'});
  assert.equal(verifyFail.info, info);
  assert.deepEqual(U.retryEvent(verifyFail), {type: 'download'});
  assert.equal(U.reduce(verifyFail, {type: 'download'}).k, 'downloading');
  assert.equal(U.reduce(checkFail, {type: 'check'}).k, 'checking');
});

test('自动检查：「有新版本」「已下载」静默；手动检查照旧进检查中（§17.7，同 App may_auto_check / after_check_failure）', () => {
  const available = {k: 'available', info};
  const unmet = {k: 'available', info, systemUnmet: '27.0'};
  const ready = {k: 'ready', info, path: '/tmp/x.zip'};
  const info2 = {...info, version: '2.3.1', build: 58};

  // 手动检查在已下载时照旧进检查中（界面上已下载时没有「检查更新」按钮）
  assert.deepEqual(U.reduce(ready, {type: 'check'}), {k: 'checking'});
  // 其余不发起的：Unsupported、查 / 下 / 装途中、静默检查已在途
  for (const s of [{k: 'unsupported', why: 'dev'}, {k: 'checking'}, {k: 'downloading', info, pct: 10},
    {k: 'installing', info}, {...available, bg: true}, {...ready, bg: true}]) assert.equal(U.mayAutoCheck(s), false, s.k);
  for (const s of [{k: 'idle'}, {k: 'upToDate'}, {k: 'error', msg: 'x', info: null}, available, unmet, ready]) {
    assert.equal(U.mayAutoCheck(s), true, s.k);
  }

  for (const start of [available, unmet]) {
    // 静默：显示态不变，侧栏按钮、更新窗内容、关于页都照旧
    const bg = U.reduce(start, {type: 'check', auto: true});
    assert.equal(bg.k, 'available');
    assert.equal(bg.bg, true);
    assert.deepEqual(U.sideButton(bg), U.sideButton(start));
    assert.deepEqual(U.dialog(bg, {lang: 'zh'}), U.dialog(start, {lang: 'zh'}));
    assert.deepEqual(U.view(bg, {lang: 'zh'}), U.view(start, {lang: 'zh'}));
    // 结果回来再落地：失败保持原态；已是最新照规则；发现更新的 build 换成新版本信息
    assert.deepEqual(U.reduce(bg, {type: 'fail', msg: 'x'}), start);
    assert.deepEqual(U.reduce(bg, {type: 'none'}), {k: 'upToDate'});
    assert.deepEqual(U.reduce(bg, {type: 'found', info: info2}), {k: 'available', info: info2});
    assert.deepEqual(U.reduce(bg, {type: 'found', info: info2, systemUnmet: '28.0'}),
      {k: 'available', info: info2, systemUnmet: '28.0'});
    // 手动检查照旧进检查中，失败进出错态（不带版本信息，侧栏按钮让开）
    const manual = U.reduce(start, {type: 'check'});
    assert.deepEqual(manual, {k: 'checking'});
    const manualFail = U.reduce(manual, {type: 'fail', msg: 'x'});
    assert.deepEqual(manualFail, {k: 'error', msg: 'x', info: null});
    assert.equal(U.sideButton(manualFail).visible, false);
  }
  // 静默检查在途时点「下载并安装」照常开下载，标记不带进下载态
  assert.deepEqual(U.reduce({...available, bg: true}, {type: 'download'}), {k: 'downloading', info, pct: 0});
  // 其余起点的自动检查照常进检查中，失败进出错态
  for (const start of [{k: 'idle'}, {k: 'upToDate'}, {k: 'error', msg: 'old', info: null}]) {
    const c = U.reduce(start, {type: 'check', auto: true});
    assert.deepEqual(c, {k: 'checking'});
    assert.deepEqual(U.reduce(c, {type: 'fail', msg: 'x'}), {k: 'error', msg: 'x', info: null});
  }
});

/* ---------- 2026-10-05：已下载之后照常静默检查、退出即安装、下载到 100% 先校验 ---------- */

test('已下载时的自动检查：静默，结果逐条落地', () => {
  const ready = {k: 'ready', info, path: U.demoPath(info)};
  const next = U.DEMO_INFO_NEXT;
  const bg = U.reduce(ready, {type: 'check', auto: true});
  assert.deepEqual(bg, {...ready, bg: true});
  // 显示态不变：侧栏按钮、更新窗、关于页都照旧；在途时不再发起第二次
  assert.deepEqual(U.sideButton(bg), U.sideButton(ready));
  assert.deepEqual(U.dialog(bg, {lang: 'zh-Hans'}), U.dialog(ready, {lang: 'zh-Hans'}));
  assert.deepEqual(U.view(bg, {lang: 'zh-Hans'}), U.view(ready, {lang: 'zh-Hans'}));
  assert.equal(U.mayAutoCheck(bg), false);
  assert.equal(U.reduce(bg, {type: 'check', auto: true}), bg);

  assert.deepEqual(U.reduce(bg, {type: 'found', info}), ready, '同一个 build：留在已下载');
  assert.deepEqual(U.reduce(bg, {type: 'found', info: next}), {k: 'available', info: next}, '更新的 build：旧下载作废');
  assert.deepEqual(U.reduce(bg, {type: 'found', info: next, systemUnmet: '28.0'}), ready,
    '更新的 build 本机装不了：留着已校验、能装的这版');
  const bg58 = {k: 'ready', info: next, path: U.demoPath(next), bg: true};
  assert.deepEqual(U.reduce(bg58, {type: 'found', info}), {k: 'available', info},
    '已下载的 58 被撤、更新源退回 57（仍比正在跑的 56 新）：以更新源为准');
  assert.deepEqual(U.reduce(bg, {type: 'none'}), {k: 'upToDate'}, '更新源里没有更新的了：不装已撤回的版本');
  assert.deepEqual(U.reduce(bg, {type: 'fail', msg: 'x'}), ready, '网络抖动不丢下载好的更新');
  // 在途时点「重启并更新」照常安装，标记不带进安装态
  assert.deepEqual(U.reduce(bg, {type: 'install'}), {k: 'installing', info});
  // 不是静默检查在途的已下载，不吃检查结果
  for (const ev of [{type: 'found', info: next}, {type: 'none'}]) assert.equal(U.reduce(ready, ev), ready, ev.type);
});

test('检查落地后的跟进：只有自动检查落到能下载的「有新版本」才下载或提醒', () => {
  const next = U.DEMO_INFO_NEXT;
  const av = {k: 'available', info: next};
  assert.equal(U.afterCheck(av, true, true), 'download');
  assert.equal(U.afterCheck(av, true, false), 'notify');
  assert.equal(U.afterCheck(av, false, true), null, '手动检查不跟进');
  assert.equal(U.afterCheck({...av, systemUnmet: '28.0'}, true, true), null, '系统版本不够');
  const ready = {k: 'ready', info};
  assert.equal(U.afterCheck(U.reduce({...ready, bg: true}, {type: 'found', info}), true, true), null, '留在已下载');
  assert.equal(U.afterCheck({k: 'upToDate'}, true, true), null);
  // 被作废后照常走一遍：下载 → 校验 → 已下载，toast 按新 build 再弹一次
  let s = U.reduce({...ready, bg: true}, {type: 'found', info: next});
  s = U.reduce(s, {type: 'download'});
  assert.deepEqual(s, {k: 'downloading', info: next, pct: 0});
  s = U.reduce(U.reduce(s, {type: 'progress', pct: 100}), {type: 'downloaded', path: U.demoPath(next)});
  assert.deepEqual(s, {k: 'ready', info: next, path: '~/Library/Caches/BaoCut/Updates/BaoCut-2.3.1-build.58-aarch64-apple-darwin.zip'});
  assert.deepEqual(U.readyToast(next, 57), {text: 'BaoCut 2.3.1 已下载，退出时自动安装', action: '重启并更新'});
});

test('退出即安装：只有已下载会装，不另加确认', () => {
  const ready = {k: 'ready', info, path: '/x.zip'};
  assert.equal(U.quitInstalls(ready), true);
  assert.equal(U.quitInstalls({...ready, bg: true}), true, '静默检查在途也装已下载的那版');
  for (const s of [{k: 'idle'}, {k: 'available', info}, {k: 'downloading', info, pct: 100}, {k: 'error', msg: 'y', info},
    {k: 'unsupported', why: 'dev'}, null]) assert.equal(U.quitInstalls(s), false, JSON.stringify(s));
  assert.equal(U.quitDemoText(ready), '原型演示：正式版这时退出并装好 2.3.0，下次打开就是新版本');
  assert.equal(U.quitDemoText({k: 'idle'}), '原型演示：正式版这时直接退出，没有下载好的更新要装');
});

test('下载到 100%：校验段，三处一致，照样能取消', () => {
  const st = {k: 'downloading', info, pct: 100};
  const v = U.view(st);
  assert.equal(v.line, '正在校验 2.3.0…');
  assert.equal(v.progress, 100);
  assert.deepEqual(v.actions.map((a) => a.k), ['cancel']);
  assert.equal(U.sideButton(st).tip, '正在校验更新…');
  assert.deepEqual(U.dialog(st, {}).footer.left, {progress: 100, text: '正在校验…'});
  assert.deepEqual(U.reduce(st, {type: 'cancel'}), {k: 'available', info});
  assert.equal(U.view({k: 'downloading', info, pct: 99}).line, '正在下载 2.3.0 · 99%');
});

test('Unsupported 不吃任何事件', () => {
  const dev = {k: 'unsupported', why: 'dev'};
  assert.equal(U.reduce(dev, {type: 'check'}), dev);
  assert.deepEqual(U.view(dev).actions, []);
  assert.equal(U.view(dev).line, '开发构建不检查更新');
  assert.equal(U.view({k: 'unsupported', why: 'appStore'}).line, 'App Store 版本由 App Store 负责更新');
});

test('关于页各态的文案与按钮', () => {
  const labels = (v) => v.actions.map((a) => a.label + (a.disabled ? '(禁用)' : ''));
  const idle = U.view({k: 'idle'}, {lastCheck: 0, now: 3 * 3600});
  assert.deepEqual(labels(idle), ['检查更新']);
  assert.equal(idle.sub, '上次检查：3 小时前');
  assert.equal(U.view({k: 'idle'}, {}).sub, null, '没检查过就不写这一行');
  assert.deepEqual(labels(U.view({k: 'checking'})), ['正在检查…(禁用)']);
  const up = U.view({k: 'upToDate'});
  assert.equal(up.line, '已是最新版本');
  assert.equal(up.tone, 'positive');
  assert.deepEqual(labels(up), ['检查更新']);
  const av = U.view({k: 'available', info}, {lang: 'zh-Hans'});
  assert.equal(av.line, '有新版本 2.3.0（Build 57）');
  assert.equal(av.notes.lines.length, 6);
  assert.deepEqual(av.actions[0], {k: 'download', label: '下载并安装', variant: 'accent', disabled: false});
  const dl = U.view({k: 'downloading', info, pct: 42});
  assert.equal(dl.line, '正在下载 2.3.0 · 42%');
  assert.equal(dl.progress, 42);
  assert.deepEqual(labels(dl), ['取消']);
  const ready = U.view({k: 'ready', info});
  assert.equal(ready.line, '2.3.0 已下载，退出 BaoCut 时自动安装');
  assert.deepEqual(ready.actions[0], {k: 'restart', label: '重启并更新', variant: 'accent', disabled: false});
  assert.deepEqual(labels(U.view({k: 'installing', info})), ['正在安装…(禁用)']);
  const err = U.view({k: 'error', msg: '连不上', info: null});
  assert.equal(err.tone, 'negative');
  assert.deepEqual(labels(err), ['重试']);
  assert.deepEqual(err.link, {k: 'downloadPage', label: '前往下载页'});
});

test('toast：就绪每个 build 只弹一次；关着自动下载时提示可以更新', () => {
  assert.deepEqual(U.readyToast(info, null), {text: 'BaoCut 2.3.0 已下载，退出时自动安装', action: '重启并更新'});
  assert.equal(U.readyToast(info, 57), null);
  assert.deepEqual(U.availableToast(info), {text: 'BaoCut 2.3.0 可以更新了', action: '查看', opens: 'updateWindow'},
    '「查看」打开更新窗，不再去设置 › 关于');
});

test('停止屏障：有后台任务才问，三个选择，列出远端任务', () => {
  assert.equal(U.restartAsk([]), null);
  assert.equal(U.restartAsk(), null);
  const local = (id) => ({id, title: '转录 ' + id, where: 'moss · 本机', remote: false});
  assert.deepEqual(U.restartAsk([local('a'), local('b'), local('c')]), {
    title: '现在重启并更新？',
    body: '有 3 个后台任务正在运行，重启会中断它们，之后可以重新开始。',
    remoteTitle: null, remote: [],
    stopLabel: '现在停止并安装', waitLabel: '等任务结束后安装', cancelLabel: '稍后',
  });
  const ask = U.restartAsk([local('a'), {id: 'r', title: '出图', where: 'gpt-image-2 · 云端', remote: true}]);
  assert.equal(ask.body, '有 2 个后台任务正在运行，重启会中断它们，之后可以重新开始。', '远端的也算在 N 里');
  assert.equal(ask.remoteTitle, '下面这些在远端运行，停止后服务商那边可能仍在运行或计费：');
  assert.deepEqual(ask.remote, [{id: 'r', title: '出图', where: 'gpt-image-2 · 云端'}]);
});

test('屏障里的任务：只算在跑的，跑在云端 / 远端的算远端', () => {
  const rows = [
    {id: 'j1', title: '转录 · A', sub: 'moss-transcribe · 本机', status: 'running'},
    {id: 'im1', sub: 'Codex 画图', runsOn: '本机 · Codex', status: 'running'},
    {id: 'c1', title: '出图 · B', sub: 'gpt-image-2 · 云端', runsOn: '云端', status: 'running'},
    {id: 'q', title: '排队的', status: 'queued'},
    {id: 'd', title: '跑完的', runsOn: '云端', status: 'done'},
  ];
  assert.deepEqual(U.barrierTasks(rows), [
    {id: 'j1', title: '转录 · A', where: 'moss-transcribe · 本机', remote: false},
    {id: 'im1', title: 'Codex 画图', where: '本机 · Codex', remote: false},
    {id: 'c1', title: '出图 · B', where: '云端', remote: true},
  ]);
  assert.deepEqual(U.barrierTasks(null), []);
});

test('等任务结束后安装：关于页与更新窗', () => {
  const ready = {k: 'ready', info, path: 'x'};
  const v = U.view(ready, {waiting: 3});
  assert.equal(v.line, '2.3.0 已下载，等后台任务结束后安装');
  assert.equal(v.tone, 'strong');
  assert.deepEqual(v.actions.map((a) => a.k), ['restart']);
  assert.deepEqual(v.link, {k: 'stopWaiting', label: '不等了'});
  assert.equal(v.sub, '还有 3 个后台任务在跑，都结束后自动安装。');
  assert.equal(U.view(ready, {waiting: 0}).sub, '后台任务都结束了，正在安装…');
  for (const ctx of [{}, {waiting: null}]) {
    const plain = U.view(ready, ctx);
    assert.equal(plain.line, '2.3.0 已下载，退出 BaoCut 时自动安装', '没在等');
    assert.equal(plain.link, undefined);
  }
  const d = U.dialog(ready, {waiting: 2});
  assert.deepEqual(d.footer.left, {note: '还有 2 个后台任务在跑，都结束后自动安装。'});
  assert.deepEqual(d.footer.buttons.map((b) => `${b.k}:${b.label}:${b.variant}`),
    ['stopWaiting:不等了:secondary', 'restart:重启并更新:accent']);
  assert.equal(d.note, null, '在等时不写「退出时会自动安装」，不和「都结束后自动安装」并排');
  assert.equal(U.dialog(ready, {waiting: 0}).note, null);
  assert.equal(U.dialog(ready, {waiting: null}).note, '退出 BaoCut 时会自动安装，不用现在重启。', '没在等照写');
  assert.equal(U.dialog({k: 'available', info}, {waiting: 2}).footer.left, null, '等待只作用在已下载');
});

test('设置 › 通用的开关行', () => {
  assert.equal(U.AUTO_ROW.label, '自动检查并下载更新');
  assert.equal(U.AUTO_ROW.desc, '启动时和之后每 6 小时检查一次；下载好的更新在你下次退出时安装，也可以马上重启更新，不会自己重启。');
});

test('演示态：每一格都落到能画的态，亮哪格能反推回来', () => {
  U.DEMO_STATES.forEach(({k}) => {
    const s = U.demoState(k);
    assert.equal(U.demoKeyOf(s), k);
    assert.ok(U.view(s, {lang: 'zh-Hans', now: 0}));
  });
});

test('系统版本不够：停在有新版本，红字写要求的 macOS，不给下载、点了也不下', () => {
  const st = U.reduce({k: 'checking'}, {type: 'found', info, systemUnmet: '27.0'});
  assert.deepEqual(st, {k: 'available', info, systemUnmet: '27.0'});
  const v = U.view(st, {lang: 'zh-Hans'});
  assert.equal(v.line, '有新版本 2.3.0（Build 57）');
  assert.equal(v.warn, '需要 macOS 27.0');
  assert.deepEqual(v.actions, []);
  assert.equal(U.reduce(st, {type: 'download'}), st);
  assert.equal(U.view({k: 'available', info}, {}).warn, undefined);
});

/* ---------- 侧栏更新按钮与更新窗（§17.7，2026-10-01）：显示表逐行钉住 ---------- */

test('侧栏按钮显示表：每一行', () => {
  const shown = (s) => U.sideButton(s);
  assert.deepEqual(shown({k: 'available', info}),
    {visible: true, glyph: 'download', dot: 'white', tip: '有新版本 · BaoCut 2.3.0'}, '有新版本（系统版本够）');
  assert.deepEqual(shown({k: 'available', info, systemUnmet: '27.0'}), {visible: false}, '系统版本不够：没有能做的事');
  assert.deepEqual(shown({k: 'downloading', info, pct: 42}),
    {visible: true, glyph: 'ring', pct: 42, dot: null, tip: '正在下载更新 · 42%'}, '下载中：进度环、无点');
  assert.deepEqual(shown({k: 'ready', info, path: '/x.zip'}),
    {visible: true, glyph: 'check', dot: 'positive', tip: '更新已下载 · 退出时自动安装'}, '已下载：对勾 + 绿点');
  assert.deepEqual(shown({k: 'error', msg: 'y', info}),
    {visible: true, glyph: 'download', dot: 'negative', tip: '更新出错 · 点击查看'}, '出错且带版本信息：下载 + 红点');
  assert.deepEqual(shown({k: 'error', msg: 'x', info: null}), {visible: false}, '检查失败（不带版本信息）');
  ['idle', 'checking', 'upToDate'].forEach((k) => assert.deepEqual(shown({k}), {visible: false}, k));
  assert.deepEqual(shown({k: 'installing', info}), {visible: false}, 'installing');
  assert.deepEqual(shown({k: 'unsupported', why: 'dev'}), {visible: false}, 'unsupported dev');
  assert.deepEqual(shown({k: 'unsupported', why: 'appStore'}), {visible: false}, 'unsupported appStore');
  assert.deepEqual(shown(null), {visible: false}, '没有态当空闲');
});

test('侧栏按钮跟着演示挡位的每一格走', () => {
  const vis = {};
  U.DEMO_STATES.forEach(({k}) => { vis[k] = U.sideButton(U.demoState(k)).visible; });
  assert.deepEqual(vis, {
    idle: false, checking: false, upToDate: false, available: true, blocked: false, downloading: true,
    verifying: true, ready: true, installing: false, errorCheck: false, errorVerify: true, dev: false, appStore: false,
  });
});

test('更新窗：头部、正文与全部说明（不截 6 行）', () => {
  const ctx = {lang: 'zh-Hans', current: {version: '2.2.1', build: 56}};
  const d = U.dialog({k: 'available', info}, ctx);
  assert.equal(d.title, '有新版本');
  assert.equal(d.sub, 'BaoCut 2.3.0 · Build 57');
  assert.equal(d.current, '你现在用的是 BaoCut 2.2.1（Build 56）。');
  assert.equal(d.notesTitle, '更新内容');
  assert.equal(d.notes.length, 7, '弹窗列全部条目；关于页仍截 6 行');
  assert.equal(d.notes[0], '设置 › 关于可以检查更新，下载好后替你安装。');
  assert.match(U.dialog({k: 'available', info}, {lang: 'de'}).notes[0], /^Settings › About/, '缺了这种语言用英文 notes');
  assert.equal(U.dialog({k: 'downloading', info, pct: 42}, ctx).title, '有新版本');
  assert.equal(U.dialog({k: 'error', msg: 'y', info}, ctx).title, '有新版本');
  assert.equal(U.dialog({k: 'ready', info}, ctx).title, '更新已下载');
  assert.equal(U.dialog({k: 'ready', info}, ctx).note, '退出 BaoCut 时会自动安装，不用现在重启。');
  assert.equal(U.dialog({k: 'available', info}, ctx).note, null, '只有已下载多这一句');
  assert.equal(U.notesFor(info, 'zh-Hans').lines.length, 6, 'notesFor 的 6 行语义不变');
});

test('更新窗底栏：每一态', () => {
  const foot = (s) => U.dialog(s, {}).footer;
  const keys = (f) => f.buttons.map((b) => `${b.k}:${b.label}:${b.variant}`);
  const av = foot({k: 'available', info});
  assert.equal(av.left, null);
  assert.deepEqual(keys(av), ['later:稍后:secondary', 'download:下载并安装:accent']);
  const dl = foot({k: 'downloading', info, pct: 42});
  assert.deepEqual(dl.left, {progress: 42, text: '正在下载 · 42%'});
  assert.deepEqual(keys(dl), ['cancel:取消:secondary']);
  const ready = foot({k: 'ready', info});
  assert.equal(ready.left, null);
  assert.deepEqual(keys(ready), ['later:稍后:secondary', 'restart:重启并更新:accent']);
  const err = foot({k: 'error', msg: U.DEMO_ERRORS.verify, info});
  assert.deepEqual(err.left, {error: '下载的文件没有通过校验，已经删掉。'}, '与关于页同一份原因');
  assert.equal(err.left.error, U.view({k: 'error', msg: U.DEMO_ERRORS.verify, info}).line);
  assert.deepEqual(keys(err), ['downloadPage:前往下载页:secondary', 'retry:重试:accent']);
  assert.deepEqual(U.retryEvent({k: 'error', msg: 'y', info}), {type: 'download'}, '窗里的「重试」重新下载');
});

test('更新窗自动关：按钮不该显示的态一律没有窗', () => {
  [{k: 'idle'}, {k: 'checking'}, {k: 'upToDate'}, {k: 'installing', info}, {k: 'unsupported', why: 'dev'},
    {k: 'available', info, systemUnmet: '27.0'}, {k: 'error', msg: 'x', info: null}]
    .forEach((s) => assert.equal(U.dialog(s, {}), null, JSON.stringify(s)));
  const st = U.reduce({k: 'downloading', info, pct: 30}, {type: 'cancel'});
  assert.ok(U.dialog(st, {}), '下载中点「取消」回到有新版本，窗还在');
  assert.equal(U.dialog(U.reduce({k: 'ready', info}, {type: 'install'}), {}), null, '进了安装中，窗关');
});
