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

test('磁盘空间：够用时一句说明，不到 10 分钟时警告', () => {
  const free = 4.8e9;
  const internal = REC.diskLine(free, REC.bytesPerMinute(2560, 1600, 30, false));
  assert.equal(internal.low, false);
  const external = REC.diskLine(free, REC.bytesPerMinute(3840, 2160, 30, false));
  assert.equal(external.low, true);
  assert.match(external.text, /只剩 4\.8 GB/);
  assert.ok(REC.minutesLeft(free, REC.bytesPerMinute(3840, 2160, 30, false)) < REC.LOW_DISK_MINUTES);
  assert.match(REC.diskLine(500e9, 1e8).text, /2 小时以上/);
});

test('录制卡：等待开始时能打开面板，放进视频后能打开视频', () => {
  assert.deepEqual(REC.cardLine('waiting'), {text: '等你开始录制', action: 'panel', actionLabel: '打开录制面板'});
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

test('录好的一段：按面板的选择裁出几路，光标录进画面时不带光标设置', () => {
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

test('设置的缺省值：三个快捷键、30 fps、倒计时 3 秒、录制时收起', () => {
  assert.deepEqual(REC.SHORTCUT_ROWS.map((r) => r.k), ['start', 'stop', 'pause']);
  assert.equal(REC.SETTINGS_DEFAULTS.fps, '30');
  assert.equal(REC.SETTINGS_DEFAULTS.countdown, '3');
  assert.equal(REC.SETTINGS_DEFAULTS.hideWindow, true);
});
