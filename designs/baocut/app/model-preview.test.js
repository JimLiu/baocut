/* model-preview.js —— 悬停预览的窗口、折返与快照。这一层的价值在于「hover 哪一支，
   播放头就该在哪一段来回走」：窗口算歪，用户看到的就是别的动画甚至一片空白；
   折返算歪，循环会卡在末尾一帧；快照算歪，鼠标移开后播放头回不到原处。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-preview.js');
const PV = window.BC_PREV;
require('./model-textanim.js');
const TA = window.BC_TA;

function localPeek(slot, k, dur, span = {start: 30.13, end: 36}) {
  return {targetId: 'title', span, patch: {[slot]: {k, dur, dir: 'up'}},
    localWin: PV.windowOf({slot, k, dur, period: dur, ...span})};
}
test('局部预览只采样目标成员，不改变源动画与时间轴', () => {
  const p = localPeek('in', 'slide', 0.6);
  const before = JSON.stringify(p);
  assert.equal(PV.localSample(p, 'sibling', 0.3), null);
  const s = PV.localSample(p, 'title', 0.3);
  near(s.t, 0.3);
  near(TA.at(s.anim, s.t, s.duration).ty, -16.25); // 第 156 轮起方向 = 从哪一侧来：默认「上」= 从上面来，ty 为负
  assert.equal(JSON.stringify(p), before);
});
test('局部出场使用真实尾部时间，其他阶段不会叠入候选效果', () => {
  const p = localPeek('out', 'fade', 0.6);
  const s = PV.localSample(p, 'title', 0.6);
  near(TA.at(s.anim, s.t, s.duration).op, 0.5);
  assert.deepStrictEqual(Object.keys(s.anim), ['out']);
});
test('局部循环按设定周期重复，短片段按真实时间窗口截取', () => {
  const p = localPeek('loop', 'heartbeat', 4);
  near(PV.localSample(p, 'title', 4.25).t, 0.25);
  const short = localPeek('in', 'slide', 1, {start: 10, end: 10.2});
  const s = PV.localSample(short, 'title', 0.1);
  near(s.duration, 0.2);
  near(TA.at(s.anim, s.t, s.duration).ty, -94.77);
});
test('局部退出或整体播放时不创建局部采样', () => {
  assert.equal(PV.localSample(null, 'title', 1), null);
  assert.equal(PV.localSample({kind: 'segment', win: {t0: 0, t1: 5}}, 'title', 1), null);
});

const W = (o) => PV.windowOf(o);
/* 折返是连续时钟上的取模，允许 1μs 级浮点误差——播放头本来就按帧推进 */
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' ≉ ' + b);

test('入场：从元素起点起，长度 = 时长 + 停留（末尾那一帧要看得见）', () => {
  assert.deepStrictEqual(W({slot: 'in', k: 'fade', start: 2, end: 10, dur: 0.6}),
                         {t0: 2, t1: 2.9});
  // 文字那一族的 t 前缀归一到同一条规则
  assert.deepStrictEqual(W({slot: 'tin', k: 'fade', start: 2, end: 10, dur: 0.6}),
                         {t0: 2, t1: 2.9});
});

test('出场：停留在头上——先看在位的样子，再看它走掉，末端贴着元素终点', () => {
  assert.deepStrictEqual(W({slot: 'out', k: 'slide', start: 2, end: 10, dur: 0.6}),
                         {t0: 9.1, t1: 10});
});

test('循环：一轮就是一个窗口，不加停留（它本来就在回到原处）', () => {
  assert.deepStrictEqual(W({slot: 'loop', k: 'sway', start: 2, end: 10, period: 2}),
                         {t0: 2, t1: 4});
});

test('Zoom 跟入场同一条窗口规则（推进也是从起点开始的一次性动作）', () => {
  assert.deepStrictEqual(W({slot: 'zoom', k: 'deep', start: 0, end: 8, dur: 1.2}),
                         {t0: 0, t1: 1.5});
});

test('字幕那一支的窗口是整条 cue', () => {
  assert.deepStrictEqual(W({slot: 'cue', k: 'pop', start: 12.4, end: 15}),
                         {t0: 12.4, t1: 15});
});

test('窗口永远夹在元素自己的时间段里（短元素不会预览到别人的时间上去）', () => {
  assert.deepStrictEqual(W({slot: 'in', k: 'fade', start: 5, end: 5.4, dur: 0.6}),
                         {t0: 5, t1: 5.4});
  assert.deepStrictEqual(W({slot: 'out', k: 'fade', start: 5, end: 5.4, dur: 0.6}),
                         {t0: 5, t1: 5.4});
  assert.deepStrictEqual(W({slot: 'loop', k: 'sway', start: 5, end: 5.4, period: 2}),
                         {t0: 5, t1: 5.4});
});

test('算不出窗口就返回 null = 不进预览态（「无」、零长度、认不得的槽）', () => {
  assert.strictEqual(W({slot: 'in', k: 'none', start: 0, end: 8}), null);
  assert.strictEqual(W({slot: 'in', k: 'fade', start: 4, end: 4}), null);
  assert.strictEqual(W({slot: 'in', k: 'fade', start: 8, end: 2}), null);
  assert.strictEqual(W({slot: 'style', k: 'fade', start: 0, end: 8}), null);
  assert.strictEqual(W(null), null);
});

test('折返：过了末尾从头起走，掉一大帧也不会卡在末尾', () => {
  assert.strictEqual(PV.wrap(2.5, 2, 4), 2.5);
  assert.strictEqual(PV.wrap(1.5, 2, 4), 2);   // 落在窗口前先夹到起点
  assert.strictEqual(PV.wrap(4, 2, 4), 2);     // 末尾即折返
  near(PV.wrap(4.3, 2, 4), 2.3);
  near(PV.wrap(8.3, 2, 4), 2.3); // 掉了两轮也能落回正确相位
  assert.strictEqual(PV.wrap(3, 5, 5), 5);     // 零宽窗口不除零
});

test('快照只存三格，退出时原样放回；没存过则返回 null（不许把播放头拽回片头）', () => {
  const s = PV.snapshot({playT: 12.4, playing: false, muted: false, extra: 1});
  assert.deepStrictEqual(s, {playT: 12.4, playing: false, muted: false});
  assert.deepStrictEqual(PV.restore(s), s);
  assert.strictEqual(PV.restore(null), null);
  assert.deepStrictEqual(PV.snapshot(null), {playT: 0, playing: false, muted: false});
});

test('Zoom 推进：起点不缩放，一段走完停在自己的深度上', () => {
  const T = {none: 1, shallow: 1.08, moderate: 1.2, deep: 1.4};
  const one = [{k: 'moderate', speed: 1.2}];
  assert.strictEqual(PV.zoomScale(one, 0, T), 1);
  assert.strictEqual(PV.zoomScale(one, 1.2, T), 1.2);
  assert.strictEqual(PV.zoomScale(one, 5, T), 1.2);
  assert.ok(PV.zoomScale(one, 0.6, T) > 1 && PV.zoomScale(one, 0.6, T) < 1.2);
});

test('Zoom 叠段是依次推进：第二段等第一段走完才起步，末值相乘', () => {
  const T = {none: 1, shallow: 1.08, moderate: 1.2, deep: 1.4};
  const two = [{k: 'shallow', speed: 1}, {k: 'shallow', speed: 1}];
  assert.strictEqual(PV.zoomScale(two, 1, T), 1.08);
  assert.strictEqual(PV.zoomScale(two, 2, T), 1.166);
  assert.strictEqual(PV.zoomScale([], 1, T), 1);
  assert.strictEqual(PV.zoomScale([{k: 'none', speed: 1}], 1, T), 1);
});

test('只设了 Zoom 的元素不能被判成静止的', () => {
  assert.ok(PV.hasZoom({zoom: [{k: 'deep'}]}));
  assert.ok(!PV.hasZoom({zoom: [{k: 'none'}]}));
  assert.ok(!PV.hasZoom({zoom: []}));
  assert.ok(!PV.hasZoom(null));
});
