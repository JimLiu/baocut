const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-player.js');
const P = global.window.BC_PLAYER;

test('空闲隐藏：只有「在播 + 不悬停 + 没按住 + 满 3 秒」四条同时成立才隐', () => {
  assert.equal(P.chromeHidden({playing: true, idleMs: 3000}), true);
  assert.equal(P.chromeHidden({playing: true, idleMs: 2999}), false, '差 1ms 也不隐');
  assert.equal(P.chromeHidden({playing: false, idleMs: 99999}), false, '暂停恒可见');
  assert.equal(P.chromeHidden({playing: true, hovering: true, idleMs: 99999}), false, '指针在条上不隐');
  assert.equal(P.chromeHidden({playing: true, scrubbing: true, idleMs: 99999}), false, '拖进度条不隐');
  assert.equal(P.chromeHidden({playing: true, pop: 'speed', idleMs: 99999}), false, '开着弹层不隐');
  assert.equal(P.chromeHidden({playing: true, volDragging: true, idleMs: 99999}), false, '拖音量不隐');
});

test('holdingVisible 三件事', () => {
  assert.equal(P.holdingVisible({}), false);
  assert.equal(P.holdingVisible({scrubbing: true}), true);
  assert.equal(P.holdingVisible({pop: 'caps'}), true);
  assert.equal(P.holdingVisible({volDragging: true}), true);
});

test('进度映射：比例钳在 [0,1]，时长为 0 不出 NaN', () => {
  assert.equal(P.seekPct(0, 200), 0);
  assert.equal(P.seekPct(50, 200), 0.25);
  assert.equal(P.seekPct(500, 200), 1);
  assert.equal(P.seekPct(-5, 200), 0);
  assert.equal(P.seekPct(10, 0), 0);
});

test('点进度条：横坐标 → 秒，两端钳住', () => {
  const rect = {left: 100, width: 400};
  assert.equal(P.timeAt(100, rect, 200), 0);
  assert.equal(P.timeAt(300, rect, 200), 100);
  assert.equal(P.timeAt(500, rect, 200), 200);
  assert.equal(P.timeAt(20, rect, 200), 0, '拖到条子左边外仍是 0');
  assert.equal(P.timeAt(900, rect, 200), 200);
  assert.equal(P.timeAt(300, {left: 0, width: 0}, 200), 0, '零宽不除');
});

test('步进：时间与音量各自钳住', () => {
  assert.equal(P.stepTime(10, 5, 200), 15);
  assert.equal(P.stepTime(2, -5, 200), 0);
  assert.equal(P.stepTime(198, 5, 200), 200);
  assert.equal(P.stepVolume(80, 10), 90);
  assert.equal(P.stepVolume(95, 10), 100);
  assert.equal(P.stepVolume(5, -10), 0);
});

test('喇叭四档与舞台工具条同表', () => {
  assert.equal(P.volumeIcon(0, false), 'vol0');
  assert.equal(P.volumeIcon(80, true), 'vol0', '静音优先');
  assert.equal(P.volumeIcon(33, false), 'vol1');
  assert.equal(P.volumeIcon(34, false), 'vol2');
  assert.equal(P.volumeIcon(66, false), 'vol2');
  assert.equal(P.volumeIcon(67, false), 'vol3');
});

test('字幕档位按项目实际有的轨生成', () => {
  const both = [{role: 'source'}, {role: 'trans'}];
  assert.deepEqual(P.captionModes(both).map((m) => m.k), ['off', 'source', 'trans', 'both']);
  assert.deepEqual(P.captionModes([{role: 'source'}]).map((m) => m.k), ['off', 'source'],
    '只有原文时不摆「双语」');
  assert.deepEqual(P.captionModes([]).map((m) => m.k), ['off']);
  assert.deepEqual(P.captionModes([{role: 'source', hidden: true}, {role: 'trans'}]).map((m) => m.k),
    ['off', 'trans'], '文档里停用的轨不进档位表');
});

test('字幕档位 → 哪条轨露出来', () => {
  assert.equal(P.captionVisible('off', 'source'), false);
  assert.equal(P.captionVisible('source', 'source'), true);
  assert.equal(P.captionVisible('source', 'trans'), false);
  assert.equal(P.captionVisible('trans', 'trans'), true);
  assert.equal(P.captionVisible('both', 'source'), true);
  assert.equal(P.captionVisible('both', 'trans'), true);
});

test('默认档：两条轨在就双语，单轨跟着那条走', () => {
  assert.equal(P.defaultCaptionMode([{role: 'source'}, {role: 'trans'}]), 'both');
  assert.equal(P.defaultCaptionMode([{role: 'source'}]), 'source');
  assert.equal(P.defaultCaptionMode([{role: 'trans'}]), 'trans');
  assert.equal(P.defaultCaptionMode([]), 'off');
});

test('章节命中与进度条刻痕', () => {
  const chs = [{id: 'c1', start: 0}, {id: 'c2', start: 60}, {id: 'c3', start: 120}];
  assert.equal(P.chapterAt(chs, 0).id, 'c1');
  assert.equal(P.chapterAt(chs, 59.9).id, 'c1');
  assert.equal(P.chapterAt(chs, 60).id, 'c2');
  assert.equal(P.chapterAt(chs, 999).id, 'c3');
  assert.equal(P.chapterAt([], 10), null);
  assert.deepEqual(P.chapterTicks(chs, 240), [25, 50], '首章的 0 不画');
  assert.deepEqual(P.chapterTicks(chs, 0), []);
});

test('键位表', () => {
  const k = (key, mod) => P.hotkey(Object.assign({key}, mod || {}));
  assert.equal(k(' '), 'play');
  assert.equal(k('K'), 'play');
  assert.equal(k('Escape'), 'exit');
  assert.equal(k('f'), 'exit');
  assert.equal(k('m'), 'mute');
  assert.equal(k('c'), 'captions');
  assert.equal(k('ArrowLeft'), 'back');
  assert.equal(k('ArrowLeft', {shiftKey: true}), 'prev-chapter');
  assert.equal(k('ArrowRight'), 'fwd');
  assert.equal(k('ArrowRight', {shiftKey: true}), 'next-chapter');
  assert.equal(k('j'), 'back10');
  assert.equal(k('l'), 'fwd10');
  assert.equal(k('ArrowUp'), 'vol-up');
  assert.equal(k('ArrowDown'), 'vol-down');
  assert.equal(k('Home'), 'start');
  assert.equal(k('End'), 'end');
  assert.equal(k('5'), 'pct-5');
  assert.equal(k('x'), null);
  assert.equal(k('c', {metaKey: true}), null, '⌘C 让给系统');
  assert.equal(k('ArrowLeft', {altKey: true}), null);
});

test('数字键 → 秒', () => {
  assert.equal(P.pctTime('pct-0', 200), 0);
  assert.equal(P.pctTime('pct-5', 200), 100);
  assert.equal(P.pctTime('pct-9', 200), 180);
  assert.equal(P.pctTime('play', 200), null);
});

test('条高由 S2 阶梯拼出来：24 + 20 + 8 + 40 + 24 = 116', () => {
  assert.equal(P.BAR_H, P.BAR_PAD * 2 + P.SEEK_HIT + P.ROW_GAP + P.CTRL_H);
  assert.equal(P.BAR_H, 116);
  [P.BAR_PAD, P.ROW_GAP, P.SEEK_HIT].forEach((v) => assert.ok([4, 6, 8, 12, 16, 20, 24, 32, 40, 48].includes(v), v + ' 在间距阶梯上'));
  assert.ok([20, 24, 32, 40, 48].includes(P.CTRL_H), '控件行高在控件阶梯上');
});

test('键表与 hotkey 是同一张表：逐行按下去都得有反应', () => {
  P.KEYS.forEach((r) => {
    const got = P.hotkey(r.probe);
    if (r.prefix) assert.ok(String(got).indexOf(r.a + '-') === 0, r.keys + ' → ' + got);
    else assert.equal(got, r.a, r.keys + ' 这一行按下去没反应');
    assert.ok(r.label && r.keys, '每一行都要有人话与键位');
  });
});

test('反向：hotkey 认得的动作，键表里一个都不许缺', () => {
  const listed = new Set();
  P.KEYS.forEach((r) => { listed.add(r.a); (r.also || []).forEach((x) => listed.add(x)); });
  const keys = [' ', 'Escape', 'Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '?']
    .concat('abcdefghijklmnopqrstuvwxyz0123456789'.split(''));
  const seen = new Set();
  keys.forEach((k) => [false, true].forEach((shiftKey) => {
    const a = P.hotkey({key: k, shiftKey});
    if (a) seen.add(/^pct-/.test(a) ? 'pct' : a);
  }));
  seen.forEach((a) => assert.ok(listed.has(a), '动作 ' + a + ' 接了却没写进 KEYS'));
  assert.ok(seen.has('keys') && seen.has('fwd') && seen.has('end'), '扫描本身要扫得到东西');
});

test('播放键三态：在播是暂停，停在片尾（成片时钟，余量 0.05s）是重播，其余是播放', () => {
  assert.equal(P.playButtonState({playing: true, out: 10, dur: 100}), 'pause');
  assert.equal(P.playButtonState({playing: true, out: 100, dur: 100}), 'pause', '在播时到了片尾仍是暂停');
  assert.equal(P.playButtonState({playing: false, out: 10, dur: 100}), 'play');
  assert.equal(P.playButtonState({playing: false, out: 99.95, dur: 100}), 'replay', '刚好落在余量边界');
  assert.equal(P.playButtonState({playing: false, out: 99.9, dur: 100}), 'play', '差一点不算片尾');
  assert.equal(P.playButtonState({playing: false, out: 120, dur: 100}), 'replay');
  assert.equal(P.playButtonState({playing: false, out: 0, dur: 0}), 'play', '空时间线没有片尾');
  assert.equal(P.playButtonState({playing: false, out: 0}), 'play');
  assert.deepEqual(Object.keys(P.PLAY_ICON).sort(), ['pause', 'play', 'replay']);
  assert.equal(P.PLAY_ICON.replay, 'refresh');
});
