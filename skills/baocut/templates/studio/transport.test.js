const test = require('node:test');
const assert = require('node:assert/strict');
const TR = require('./transport.js');

const cues = [
  { id: 'a', start: 0, end: 2 },
  { id: 'b', start: 5, end: 7 },
  { id: 'c', start: 12.5, end: 15 },
];

test('normalizeRate 落到最近档位，非法值回 1×', () => {
  assert.equal(TR.normalizeRate(1.5), 1.5);
  assert.equal(TR.normalizeRate(1.3), 1.25);
  assert.equal(TR.normalizeRate(0.1), 0.5);
  assert.equal(TR.normalizeRate(9), 2);
  for (const bad of [0, -1, NaN, Infinity, null, undefined, '1.5']) {
    assert.equal(TR.normalizeRate(bad), 1, String(bad));
  }
});

test('speedLabel 只在非 1× 时给文案', () => {
  assert.equal(TR.speedLabel(1), null);
  assert.equal(TR.speedLabel(2), '2×');
  assert.equal(TR.speedLabel(0.75), '0.75×');
  // 归一化后是 1× 的输入同样不显示数字
  assert.equal(TR.speedLabel(1.02), null);
});

test('styleCtx 只有 translate 是双语栈', () => {
  assert.equal(TR.styleCtx('translate'), 'bi');
  for (const tab of ['subtitle', 'transcript', 'style', undefined]) {
    assert.equal(TR.styleCtx(tab), 'sub', String(tab));
  }
  assert.equal(TR.styleLabel('bi'), '译文样式');
  assert.equal(TR.styleLabel('sub'), '字幕样式');
  assert.equal(TR.styleTip('bi'), '打开译文样式面板');
  assert.equal(TR.styleTip('sub'), '打开字幕样式面板');
});

test('prevCueStart 跨过刚过去的那条，最早回到 0', () => {
  // 落在 b 内且已播过 0.3s：回到本条起点（走带的常规行为）
  assert.equal(TR.prevCueStart(cues, 6), 5);
  // 刚进入 c（12.5）：0.3 内不算，退到 b
  assert.equal(TR.prevCueStart(cues, 12.6), 5);
  assert.equal(TR.prevCueStart(cues, 12.9), 12.5);
  // 片头前后都回 0
  assert.equal(TR.prevCueStart(cues, 0), 0);
  assert.equal(TR.prevCueStart(cues, 0.1), 0);
  assert.equal(TR.prevCueStart([], 30), 0);
});

test('nextCueStart 没有更晚的就走到片尾', () => {
  assert.equal(TR.nextCueStart(cues, 0, 20), 5);
  assert.equal(TR.nextCueStart(cues, 5, 20), 12.5);
  // 边界余量：正好停在起点上不跳回自己
  assert.equal(TR.nextCueStart(cues, 5.01, 20), 12.5);
  assert.equal(TR.nextCueStart(cues, 13, 20), 20);
  assert.equal(TR.nextCueStart([], 3, 20), 20);
});

test('乱序 cue 也取真正的相邻起点', () => {
  const shuffled = [cues[2], cues[0], cues[1]];
  assert.equal(TR.nextCueStart(shuffled, 0, 20), 5);
  assert.equal(TR.prevCueStart(shuffled, 12.9), 12.5);
});

test('非法 start 的 cue 被跳过', () => {
  const dirty = [{ id: 'x' }, { id: 'y', start: NaN }, null, { id: 'z', start: 8 }];
  assert.equal(TR.nextCueStart(dirty, 0, 20), 8);
  assert.equal(TR.prevCueStart(dirty, 20), 8);
});

test('isReplay 只在停在片尾时为真', () => {
  assert.equal(TR.isReplay(false, 175, 175), true);
  assert.equal(TR.isReplay(false, 174.9995, 175), true);
  assert.equal(TR.isReplay(false, 174, 175), false);
  // 播放中永远不是重播态
  assert.equal(TR.isReplay(true, 175, 175), false);
  // 没有时长（空项目）不是重播态
  assert.equal(TR.isReplay(false, 0, 0), false);
});

test('rulerStep 按 90px 目标间距选档', () => {
  assert.equal(TR.rulerStep(100), 1);
  assert.equal(TR.rulerStep(45), 2);
  assert.equal(TR.rulerStep(10), 10);
  assert.equal(TR.rulerStep(1), 120);
  // 极密时退到最大档而不是 undefined
  assert.equal(TR.rulerStep(0.01), 300);
  assert.equal(TR.rulerStep(0), 300);
});

test('rulerTicks 含 0 与末尾整点', () => {
  assert.deepEqual(TR.rulerTicks(10, 5), [0, 5, 10]);
  assert.deepEqual(TR.rulerTicks(12, 5), [0, 5, 10]);
  assert.deepEqual(TR.rulerTicks(0, 5), [0]);
  assert.deepEqual(TR.rulerTicks(-1, 5), []);
  assert.deepEqual(TR.rulerTicks(10, 0), []);
});

test('timeToX / xToTime 互为反函数并带 PAD', () => {
  assert.equal(TR.PAD, 24);
  assert.equal(TR.timeToX(0, 10), 24);
  assert.equal(TR.timeToX(3, 10), 54);
  assert.equal(TR.xToTime(54, 10, 175), 3);
  // PAD 之内的点击钳到 0，超出时长钳到片尾
  assert.equal(TR.xToTime(0, 10, 175), 0);
  assert.equal(TR.xToTime(10, 10, 175), 0);
  assert.equal(TR.xToTime(99999, 10, 175), 175);
  for (const t of [0, 1.25, 7.5, 175]) {
    assert.ok(Math.abs(TR.xToTime(TR.timeToX(t, 12.5), 12.5, 175) - t) < 1e-9);
  }
});

test('contentWidth 两侧都留 PAD', () => {
  assert.equal(TR.contentWidth(10, 10), 100 + 48);
  assert.equal(TR.contentWidth(0, 10), 48);
});

test('fullscreenKeyAction 覆盖 Mac 全屏键位表', () => {
  assert.deepEqual(TR.fullscreenKeyAction(' ', 'Space'), { type: 'togglePlay' });
  assert.deepEqual(TR.fullscreenKeyAction('k', 'KeyK'), { type: 'togglePlay' });
  assert.deepEqual(TR.fullscreenKeyAction('K', 'KeyK'), { type: 'togglePlay' });
  assert.deepEqual(TR.fullscreenKeyAction('ArrowLeft', 'ArrowLeft'), { type: 'seek', delta: -5 });
  assert.deepEqual(TR.fullscreenKeyAction('ArrowRight', 'ArrowRight'), { type: 'seek', delta: 5 });
  assert.deepEqual(TR.fullscreenKeyAction('j', 'KeyJ'), { type: 'seek', delta: -10 });
  assert.deepEqual(TR.fullscreenKeyAction('l', 'KeyL'), { type: 'seek', delta: 10 });
  assert.deepEqual(TR.fullscreenKeyAction('ArrowUp', 'ArrowUp'), { type: 'volume', delta: 0.05 });
  assert.deepEqual(TR.fullscreenKeyAction('ArrowDown', 'ArrowDown'), { type: 'volume', delta: -0.05 });
  assert.deepEqual(TR.fullscreenKeyAction('m', 'KeyM'), { type: 'mute' });
  assert.deepEqual(TR.fullscreenKeyAction('c', 'KeyC'), { type: 'subs' });
  assert.deepEqual(TR.fullscreenKeyAction('f', 'KeyF'), { type: 'exit' });
  // 表外的键不归全屏管，事件继续冒泡给别的处理器
  assert.equal(TR.fullscreenKeyAction('s', 'KeyS'), null);
  assert.equal(TR.fullscreenKeyAction('Escape', 'Escape'), null);
  assert.equal(TR.fullscreenKeyAction(undefined, undefined), null);
});

test('nudgeStep / nudgeDelta：0.5%，Shift 4× = 2%，上为负', () => {
  assert.equal(TR.nudgeStep(false), 0.5);
  assert.equal(TR.nudgeStep(true), 2);
  assert.deepEqual(TR.nudgeDelta('ArrowLeft', false), { dx: -0.5, dy: 0 });
  assert.deepEqual(TR.nudgeDelta('ArrowRight', false), { dx: 0.5, dy: 0 });
  assert.deepEqual(TR.nudgeDelta('ArrowUp', false), { dx: 0, dy: -0.5 });
  assert.deepEqual(TR.nudgeDelta('ArrowDown', false), { dx: 0, dy: 0.5 });
  assert.deepEqual(TR.nudgeDelta('ArrowUp', true), { dx: 0, dy: -2 });
  assert.equal(TR.nudgeDelta('j', false), null);
});

test('clampPlacement 钳到拖拽同一组边界并留一位小数', () => {
  assert.deepEqual(TR.clampPlacement(50, 86), { x: 50, y: 86 });
  assert.deepEqual(TR.clampPlacement(2, 2), { x: 3, y: 4 });
  assert.deepEqual(TR.clampPlacement(120, 120), { x: 97, y: 96 });
  assert.deepEqual(TR.clampPlacement(50.44, 85.55), { x: 50.4, y: 85.6 });
  assert.deepEqual(TR.clampPlacement(NaN, undefined), { x: 3, y: 4 });
});
