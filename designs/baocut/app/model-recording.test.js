const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-recording.js');
const REC = window.BC_REC;

test('「把 BaoCut 也录进去」只在整块屏幕与区域出现', () => {
  assert.equal(REC.showsIncludeSelf('display'), true);
  assert.equal(REC.showsIncludeSelf('area'), true);
  assert.equal(REC.showsIncludeSelf('window'), false);
  assert.equal(REC.selfNote('window', true), '');
  assert.match(REC.selfNote('display', false), /不会录进去/);
  assert.match(REC.selfNote('display', true), /也会出现在画面里/);
});

test('磁盘空间：够用时一句说明，不到 10 分钟时提醒', () => {
  const free = 4.8e9;
  const internal = REC.diskLine(free, REC.bytesPerMinute(2560, 1600, 30, false));
  assert.equal(internal.low, false);
  const external = REC.diskLine(free, REC.bytesPerMinute(3840, 2160, 30, false));
  assert.equal(external.low, true);
  assert.match(external.text, /只剩 4\.8 GB/);
  assert.ok(REC.minutesLeft(free, REC.bytesPerMinute(3840, 2160, 30, false)) < REC.LOW_DISK_MINUTES);
  assert.match(REC.diskLine(500e9, 1e8).text, /2 小时以上/);
});

test('时钟：分:秒，过一小时时:分:秒', () => {
  assert.equal(REC.clock(0), '0:00');
  assert.equal(REC.clock(75), '1:15');
  assert.equal(REC.clock(3599), '59:59');
  assert.equal(REC.clock(3600), '1:00:00');
  assert.equal(REC.clock(3725), '1:02:05');
});

test('落点行与开始按钮的第二行', () => {
  assert.deepEqual(REC.landing('new', {project: '确定性渲染课程'}), {text: '新视频 · 确定性渲染课程', back: false});
  assert.equal(REC.landing('new', {}).text, '新视频');
  assert.deepEqual(REC.landing('into', {video: '第 5 讲'}), {text: '加进 第 5 讲', back: true});
  const a = REC.landing('agent', {note: '屏幕加摄像头'});
  assert.equal(a.text, '智能体请求录制');
  assert.equal(a.note, '屏幕加摄像头');
  assert.equal(REC.startNote('into'), '加进当前视频');
  assert.equal(REC.startNote('new'), '录成新视频');
  assert.equal(REC.startNote('agent'), '录成新视频');
});

test('药丸：允许 > 关 > 未连接 > 开，点开着的药丸是关掉它', () => {
  assert.deepEqual(REC.pill({on: true, permission: false}), {state: 'allow', label: '允许', action: 'open-settings'});
  assert.deepEqual(REC.pill({on: false}), {state: 'off', label: '关', action: 'open-list'});
  assert.deepEqual(REC.pill({on: true, connected: false}), {state: 'missing', label: '未连接', action: 'open-list'});
  assert.deepEqual(REC.pill({on: true}), {state: 'on', label: '开', action: 'turn-off'});
  assert.equal(REC.deviceName('camera', null), '不用摄像头');
  assert.equal(REC.deviceName('mic', null), '不用麦克风');
  assert.equal(REC.deviceName('mic', {label: '外接麦克风'}), '外接麦克风');
  assert.equal(REC.deviceName('system', true), '录系统声音');
  assert.equal(REC.deviceName('system', false), '不录系统声音');
  assert.deepEqual(REC.filterList([{label: 'Studio 麦克风'}, {label: '内建麦克风'}], 'studio').map((x) => x.label), ['Studio 麦克风']);
  assert.equal(REC.filterList([{label: 'a'}], '  ').length, 1);
});

test('状态机：启动器 → 覆盖层 → 倒计时 → 录制 ⇄ 暂停 → 收尾', () => {
  let s = {phase: 'launcher'};
  s = REC.step(s, {type: 'pick', kind: 'window'});
  assert.deepEqual([s.phase, s.kind], ['picker', 'window']);
  /* 再点已选中的格是取消覆盖层；点另一格是换模式 */
  assert.equal(REC.step(s, {type: 'pick', kind: 'window'}).phase, 'launcher');
  assert.equal(REC.step(s, {type: 'pick', kind: 'area'}).kind, 'area');
  assert.equal(REC.step(s, 'escape').phase, 'launcher');
  assert.equal(REC.step(s, 'close-card').phase, 'launcher');
  s = REC.step(s, {type: 'start', countdown: 3});
  assert.deepEqual([s.phase, s.left], ['countdown', 3]);
  assert.equal(REC.step(s, 'pause'), s, '倒计时里不能暂停');
  s = REC.step(REC.step(s, 'tick'), 'tick');
  assert.equal(s.left, 1);
  s = REC.step(s, 'tick');
  assert.equal(s.phase, 'starting');
  s = REC.step(s, 'started');
  assert.equal(s.phase, 'recording');
  s = REC.step(REC.step(s, 'tick'), 'tick');
  assert.equal(s.elapsed, 2);
  s = REC.step(s, 'pause');
  assert.equal(s.phase, 'paused');
  assert.equal(REC.step(s, 'tick').elapsed, 2, '暂停时不计时');
  s = REC.step(s, 'resume');
  s = REC.step(s, 'stop');
  assert.equal(s.phase, 'finishing');
  assert.equal(REC.step(s, 'discard'), s, '收尾时不能丢弃');
  s = REC.step(s, 'finished');
  assert.deepEqual([s.phase, s.outcome], ['closed', 'done']);
});

test('状态机：没有倒计时直接开始；倒计时里停止等于取消；重新开始与丢弃', () => {
  const picker = {phase: 'picker', kind: 'display'};
  assert.equal(REC.step(picker, {type: 'start', countdown: 0}).phase, 'starting');
  const cd = REC.step(picker, {type: 'start', countdown: 5});
  assert.deepEqual(REC.step(cd, 'stop'), Object.assign({}, cd, {phase: 'closed', outcome: 'cancelled'}));
  const rec = Object.assign({}, cd, {phase: 'recording', elapsed: 40});
  const again = REC.step(rec, 'restart');
  assert.deepEqual([again.phase, again.left, again.elapsed], ['countdown', 5, 0]);
  assert.equal(REC.step(Object.assign({}, rec, {countdown: 0}), 'restart').phase, 'starting');
  assert.deepEqual(REC.step(rec, {type: 'discard', afterDiscard: 'none'}).phase, 'closed');
  assert.deepEqual(REC.step(rec, {type: 'discard', afterDiscard: 'launcher'}).phase, 'launcher');
  assert.equal(REC.step({phase: 'launcher'}, 'close-launcher').outcome, 'cancelled');
  assert.equal(REC.step({phase: 'launcher'}, 'escape').phase, 'launcher');
});

test('状态机：电脑睡眠时录制中自动暂停并记下，继续后去掉；倒计时与正在开始时取消', () => {
  const rec = {phase: 'recording', elapsed: 12};
  const slept = REC.step(rec, 'sleep');
  assert.deepEqual([slept.phase, slept.slept, slept.elapsed], ['paused', true, 12]);
  assert.equal(REC.step(slept, 'sleep'), slept, '已暂停时不变');
  assert.deepEqual([REC.step(slept, 'resume').phase, REC.step(slept, 'resume').slept], ['recording', false]);
  assert.deepEqual(REC.step({phase: 'countdown', left: 2}, 'sleep').outcome, 'cancelled');
  assert.deepEqual(REC.step({phase: 'starting'}, 'sleep').phase, 'closed');
  assert.equal(REC.step({phase: 'finishing'}, 'sleep').phase, 'finishing');
});

test('控制条第一格：倒数数字、状态字与计时', () => {
  assert.deepEqual(REC.barStatus({phase: 'countdown', left: 3}), {text: '3', kind: 'countdown'});
  assert.equal(REC.barStatus({phase: 'starting'}).text, '正在开始');
  assert.equal(REC.barStatus({phase: 'paused', elapsed: 9}).text, '已暂停');
  assert.equal(REC.barStatus({phase: 'finishing'}).text, '正在收尾…');
  assert.deepEqual(REC.barStatus({phase: 'recording', elapsed: 3725}), {text: '1:02:05', kind: 'clock'});
  assert.deepEqual(REC.barActions('countdown'), {stop: true, pause: false, restart: true, discard: true});
  assert.deepEqual(REC.barActions('finishing'), {stop: false, pause: false, restart: false, discard: false});
});

test('没有麦克风时先确认，只在设置开着时', () => {
  assert.equal(REC.needsMicConfirm('none', {confirmNoMic: true}), true);
  assert.equal(REC.needsMicConfirm('none', {confirmNoMic: false}), false);
  assert.equal(REC.needsMicConfirm('m1', {confirmNoMic: true}), false);
});

test('托盘：不录时是菜单，录制中单击直接停止', () => {
  assert.deepEqual(REC.trayMenu(false).filter((x) => !x.sep).map((x) => x.id), ['open', 'display', 'window', 'area', 'settings', 'quit']);
  assert.equal(REC.trayMenu(true), null);
});

test('录制卡：等待开始时打开录制启动器，放进视频后能打开视频', () => {
  assert.deepEqual(REC.cardLine('waiting'), {text: '等你开始录制', action: 'launcher', actionLabel: '打开录制启动器'});
  assert.equal(REC.cardLine('recording', {elapsed: 75}).text, '正在录制 · 1:15');
  const done = REC.cardLine('done', {title: '第 5 讲', elapsed: 96});
  assert.equal(done.action, 'video');
  assert.equal(done.text, '已放进视频 · 1:36');
  assert.equal(REC.cardLine('cancelled').text, '已取消录制。');
});

test('恢复提示只讲最新的一次', () => {
  assert.equal(REC.recoveryText([]), null);
  const r = REC.recoveryText([{id: 'a', date: '昨天 16:20', duration: 312, ago: 1400}, {id: 'b', date: '今天 09:05', duration: 74, ago: 30}]);
  assert.equal(r.id, 'b');
  assert.equal(r.body, '今天 09:05的录制（1:14）在放进视频之前中断了。可以恢复，或者删掉录下的文件。');
  assert.equal(r.more, '还有 1 次没有收完的录制');
});

test('录好的一段：按启动器的选择裁出几路，光标录进画面时不带光标设置', () => {
  const demo = {
    duration: 96, streams: {screen: {asset: 's.mp4'}, camera: {asset: 'c.mp4'}, microphone: {asset: 'm.m4a'}, system: {asset: 'a.m4a'}},
    clicks: [{t: 4}, {t: 30}], follow: {safeArea: 0.5}, cursor: {size: 1.5},
    zooms: [{id: 'z1', t0: 3, t1: 6, origin: 'auto', scale: 2}, {id: 'z2', t0: 10, t1: 30, origin: 'auto', scale: 2}, {id: 'z5', t0: 1, t1: 2, origin: 'manual'}],
  };
  const a = REC.takeFrom(demo, 2, {seconds: 24, camera: 'c1', mic: 'default', system: false, cursor: 'baked'},
    {video: [{id: 'v1', name: 's.mp4'}, {id: 'v2', name: 'c.mp4'}], audio: [{id: 'a1'}, {id: 'a2'}]});
  assert.deepEqual(Object.keys(a.rec.streams), ['screen', 'camera', 'microphone']);
  assert.equal(a.rec.id, 'rec-take2');
  assert.equal(a.rec.cursor, null);
  assert.deepEqual(a.rec.zooms.map((z) => z.id), ['z1']);
  assert.deepEqual(a.sources.video.map((s) => s.name), ['screen-take2.mp4', 'camera-take2.mp4']);
  assert.equal(a.sources.audio.length, 1);
  const b = REC.takeFrom(demo, 3, {seconds: 2, cursor: 'none'});
  assert.equal(b.rec.duration, 8);
  assert.deepEqual(b.rec.zooms, []);
});

test('设置的缺省值：快捷键都不设、倒计时 3 秒、没有麦克风先确认、关闭到后台', () => {
  assert.deepEqual(REC.SHORTCUT_ROWS.map((r) => r.k), ['launcher', 'display', 'window', 'area', 'stop', 'pause', 'restart']);
  assert.ok(Object.values(REC.SETTINGS_DEFAULTS.shortcuts).every((k) => k === ''));
  assert.deepEqual(REC.COUNTDOWNS.map((c) => c.id), ['0', '3', '5', '10']);
  const d = REC.mergeSettings(null);
  assert.deepEqual([d.countdown, d.fps, d.confirmNoMic, d.mainWindow, d.afterDiscard, d.trayIcon], ['3', '30', true, 'background', 'none', true]);
});

test('读回旧设置：旧缺省快捷键丢掉，不认识的值退回缺省', () => {
  const v = REC.mergeSettings({shortcuts: {start: '⌥⇧⌘R', stop: '⌥⇧⌘S', pause: '⌃⌥P'}, countdown: '7', fps: '60', hideWindow: false, confirmNoMic: false});
  assert.equal(v.shortcuts.stop, '');
  assert.equal(v.shortcuts.pause, '⌃⌥P');
  assert.equal('start' in v.shortcuts, false);
  assert.equal(v.countdown, '3');
  assert.equal(v.fps, '60');
  assert.equal(v.confirmNoMic, false);
  assert.equal('hideWindow' in v, false);
});

test('录快捷键：必须带 ⌘ / ⌥ / ⌃', () => {
  assert.equal(REC.shortcutFrom({key: 'Shift', shiftKey: true}), null);
  assert.equal(REC.shortcutFrom({key: 'r', code: 'KeyR'}).ok, false);
  assert.equal(REC.shortcutFrom({key: 'R', code: 'KeyR', shiftKey: true}).ok, false);
  assert.deepEqual(REC.shortcutFrom({key: 'r', code: 'KeyR', ctrlKey: true, altKey: true}), {ok: true, label: '⌃⌥R'});
  assert.equal(REC.shortcutFrom({key: '@', code: 'Digit2', metaKey: true, shiftKey: true}).label, '⇧⌘2');
});
