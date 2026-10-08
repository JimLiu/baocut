const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-whiteboard.js');
const W = window.BC_WHITEBOARD;

test('缺省：记号笔 / 白纸 / 画时跟时长走 / 墨线优先；示范自带节拍', () => {
  const d = W.defaults();
  assert.equal(d.demo, W.DEMOS[0].k);
  assert.equal(d.hand, 'marker');
  assert.equal(d.paper, '#FFFFFF');
  assert.equal(d.draw, null);
  assert.equal(d.inkFirst, true);
  assert.deepEqual(d.beats, []);
  assert.equal(W.defaults('flow').beats.length, 3);
  assert.equal(W.HANDS.map((h) => h.k).join(), 'marker,pen,none');
});

test('normalize：非法手 / 纸 / 画时被归位，null 纸=透明，节拍按 at 排序并夹到 64', () => {
  const p = W.normalize({demo: 'nope', hand: 'brush', paper: 'red', draw: 999, inkFirst: 0});
  assert.equal(p.demo, W.DEMOS[0].k);
  assert.equal(p.hand, 'marker');
  assert.equal(p.paper, '#FFFFFF');
  assert.equal(p.draw, W.LIMITS.draw[1]);
  assert.equal(p.inkFirst, false);
  assert.equal(W.normalize({paper: null}).paper, null);
  assert.equal(W.normalize({paper: '#abcdef'}).paper, '#ABCDEF');
  const beats = [];
  for (let i = 0; i < 70; i++) beats.push({at: 70 - i, box: [0, 0, 10, 10]});
  const q = W.normalize({beats});
  assert.equal(q.beats.length, W.LIMITS.beats);
  assert.ok(q.beats.every((b, i) => !i || b.at >= q.beats[i - 1].at));
});

test('画时：缺席 = min(0.8×时长, 自然画时)，显式值也夹到时长以内', () => {
  const p = W.defaults('idea');
  const nat = W.natural(p);
  assert.ok(nat >= 1 && nat <= 15);
  assert.ok(Math.abs(W.effectiveDraw(p, 100) - nat) < 1e-9, '时长很长时取自然画时');
  assert.ok(Math.abs(W.effectiveDraw(p, 2) - 1.6) < 1e-9, '时长短时取 0.8×时长');
  assert.equal(W.effectiveDraw(Object.assign({}, p, {draw: 30}), 6), 6, '显式画时夹到时长');
  assert.equal(W.effectiveDraw(Object.assign({}, p, {draw: 3}), 6), 3);
});

test('揭示进度随 t 单调不减，画时之后为 1 且手抬起', () => {
  const p = W.defaults('chart');
  const dur = 8;
  const draw = W.effectiveDraw(p, dur);
  let last = -1;
  for (let t = 0; t <= dur; t += 0.05) {
    const r = W.reveal(p, t, dur);
    assert.ok(r >= last - 1e-9, `t=${t} 回退 ${last} → ${r}`);
    last = r;
  }
  assert.ok(W.reveal(p, draw, dur) > 0.999);
  assert.equal(W.sample(p, draw + 0.01, {w: 320, h: 180}, dur).hand, null);
  assert.ok(W.sample(p, draw / 2, {w: 320, h: 180}, dur).hand, '画到一半手在纸上');
  assert.equal(W.sample(p, 0, {w: 320, h: 180}, dur).strokes.length, 0, 't=0 一笔未落');
});

test('同一份 props 同一个 t 恒得同一帧；纸色与手型透传', () => {
  const p = Object.assign(W.defaults('idea'), {paper: '#FFF8E7', hand: 'pen'});
  const a = W.sample(p, 1.3, {w: 200, h: 200}, 6);
  const b = W.sample(p, 1.3, {w: 200, h: 200}, 6);
  assert.deepEqual(a, b);
  assert.equal(a.paper, '#FFF8E7');
  assert.equal(a.hand.kind, 'pen');
  assert.equal(W.sample(Object.assign({}, p, {hand: 'none'}), 1.3, {w: 200, h: 200}, 6).hand, null);
});

test('笔顺：墨线优先时色块排在墨线后；关掉则按原序', () => {
  const d = W.byDemo('idea');
  const first = W.order(d.strokes, {inkFirst: true, beats: []});
  const inkIdx = first.findIndex((o) => !o.stroke.ink);
  assert.ok(first.slice(inkIdx).every((o) => !o.stroke.ink));
  const raw = W.order(d.strokes, {inkFirst: false, beats: []});
  assert.deepEqual(raw.map((o) => o.i), d.strokes.map((_, i) => i));
});

test('节拍：第二拍到点时第一块画完、第二块未动；组窗到 end 止；节拍窗夹到画时', () => {
  const p = Object.assign(W.defaults('flow'), {draw: 9});
  const dur = 12;
  const f = W.sample(p, 3.2, {w: 100, h: 100}, dur);
  const d = W.byDemo('flow');
  const box1 = (s) => s.pts.every((q) => q[0] <= 34);
  const box2 = (s) => s.pts.every((q) => q[0] >= 34 && q[0] <= 66);
  d.strokes.forEach((s, i) => {
    const fr = f.strokes.find((x) => x.order === i);
    if (box1(s)) assert.ok(fr && fr.done, `第一块第 ${i} 笔应画完`);
    if (box2(s)) assert.ok(!fr, `第二块第 ${i} 笔不该开始`);
  });
  const win = W.windows(p, 9);
  assert.deepEqual(win[0], [0, 2.8], '第一拍止于 end 锚点（w4:end = 2.8），不是下一拍起点');
  assert.deepEqual(win[1], [3.2, 6.3]);
  assert.deepEqual(win[2], [6.4, 9], '末拍没写 end = 到画时');
  assert.deepEqual(win[3], [6.4, 9], 'box 外的笔画与末拍同窗');
  assert.deepEqual(W.windows(Object.assign({}, p, {draw: 4}), 4)[2], [4, 4], '超出画时的节拍夹到画时');
  const early = W.windows({demo: 'flow', beats: [{at: 0, end: 2, box: [0, 0, 34, 100]}]}, 5);
  assert.deepEqual(early, [[0, 2], [2, 5]], '末拍 end 早于画时：box 外的笔画排在它之后');
  assert.equal(W.reveal(p, 2.8, dur) < W.reveal(p, 3.2, dur) + 1e-9, true);
  assert.ok(Math.abs(W.reveal(p, 2.8, dur) - W.reveal(p, 3.19, dur)) < 1e-9, '2.8–3.2 s 是拍与拍之间，不落墨');
});

test('0.9 归一化：pace / strict / end / label 有缺省，锚点串原样留着并按解析秒排序，label 截到 80 字', () => {
  const d = W.defaults('flow');
  assert.equal(d.pace, 'stretch');
  assert.equal(d.strict, false);
  assert.equal(d.beats[0].at, '~main:w1:start');
  assert.equal(d.beats[0].end, '~main:w4:end');
  assert.equal(d.beats[0].label, '第一步 · 收需求');
  assert.equal(d.beats[2].end, undefined, '末拍没写 end');
  const legacy = W.normalize({demo: 'flow', beats: [{at: 5, box: [66, 0, 34, 100]}, {at: 0, box: [0, 0, 34, 100]}]});
  assert.equal(legacy.pace, 'stretch');
  assert.equal(legacy.strict, false);
  assert.deepEqual(legacy.beats.map((b) => b.at), [0, 5], '0.8 文档读入即 0.9 语义，缺省 = 老行为');
  assert.equal('end' in legacy.beats[0], false);
  const q = W.normalize({demo: 'flow', pace: 'natural', strict: 1, beats: [
    {at: '~main:w9:start', box: [66, 0, 34, 100], label: ' x'.repeat(60)},
    {at: '~main:w1:start', end: '~main:w4:end', box: [0, 0, 34, 100]},
    {at: '~main:w99:start', box: [0, 0, 1, 1]},
    {at: 'nonsense', box: [0, 0, 1, 1]},
    {at: -3, end: 'also nonsense', box: [34, 0, 32, 100]},
  ]});
  assert.equal(q.pace, 'natural');
  assert.equal(q.strict, true);
  assert.equal(W.normalize({pace: 'fast'}).pace, 'stretch');
  assert.deepEqual(q.beats.map((b) => b.at), ['~main:w1:start', 0, '~main:w9:start', '~main:w99:start'],
    '非法 at 丢掉；数字与锚点按解析秒混排（同秒按原序）；解析不到的排最后');
  assert.equal(q.beats[1].end, undefined, '非法 end 丢掉');
  assert.equal(q.beats[2].label.length, W.LIMITS.label);
  assert.equal(W.isAnchor('~main:w12:end'), true);
  assert.equal(W.isAnchor('~main:w12'), false);
  assert.equal(W.resolveTime('~main:w4:end', 'flow'), 2.8);
  assert.equal(W.resolveTime('~main:w4:end', 'idea'), null, '别的示范没有这张词表');
  assert.equal(W.resolveTime(1.5, 'idea'), 1.5);
});

test('resolvedBeats / mode：end 缺省 = 下一拍 at、末拍 null；锚点解析不到 ok:false；徽标三档', () => {
  const rb = W.resolvedBeats(W.defaults('flow'));
  assert.deepEqual(rb.map((b) => [b.at, b.end, b.anchored, b.ok]), [[0, 2.8, true, true], [3.2, 6.3, true, true], [6.4, null, true, true]]);
  const mixed = W.resolvedBeats({demo: 'flow', beats: [{at: 0, box: [0, 0, 34, 100]}, {at: 3, box: [34, 0, 32, 100]}, {at: '~main:w99:start', box: [66, 0, 34, 100]}]});
  assert.deepEqual(mixed.map((b) => [b.at, b.end, b.ok]), [[0, 3, true], [3, null, true], [null, null, false]]);
  assert.equal(W.mode(W.defaults('flow')), 'narration', '节拍含锚点 = 跟随旁白');
  assert.equal(W.mode(Object.assign(W.defaults('flow'), {draw: 9})), 'narration', '锚点优先于手填画时');
  assert.equal(W.mode(W.defaults('idea')), 'natural');
  assert.equal(W.mode(Object.assign(W.defaults('idea'), {draw: 3})), 'manual');
  assert.equal(W.mode({demo: 'flow', beats: [{at: 0, box: [0, 0, 34, 100]}]}), 'natural', '数字节拍不算跟随旁白');
  assert.deepEqual(Object.keys(W.MODES), ['narration', 'natural', 'manual']);
});

test('pace natural：每拍按自然速度画完后定格到组窗结束，stretch 撑满组窗；effectiveDraw 不变', () => {
  const base = Object.assign(W.defaults('flow'), {draw: 9.2});
  const nat = Object.assign({}, base, {pace: 'natural'});
  const dur = 12;
  assert.equal(W.effectiveDraw(nat, dur), W.effectiveDraw(base, dur), 'pace 不动画时');
  const Ln = W.lane(nat, dur), Ls = W.lane(base, dur);
  assert.deepEqual(Ls.beats.map((b) => [b.at, b.end, b.drawEnd, b.idleTo]), [[0, 2.8, 2.8, 3.2], [3.2, 6.3, 6.3, 6.4], [6.4, 9.2, 9.2, 9.2]],
    'stretch：drawEnd = 组窗右缘');
  assert.ok(Ln.beats.every((b) => b.drawEnd < b.end), 'natural：每拍在组窗结束前画完');
  assert.ok(Ln.beats[0].drawEnd > 2 && Ln.beats[0].drawEnd < 2.8);
  // 第一拍画完到组窗结束之间：natural 已画满这一块、stretch 还没有
  const box1 = (s) => s.pts.every((q) => q[0] <= 34);
  const t = (Ln.beats[0].drawEnd + 2.8) / 2;
  const fn = W.sample(nat, t, {w: 100, h: 100}, dur), fs = W.sample(base, t, {w: 100, h: 100}, dur);
  W.byDemo('flow').strokes.forEach((s, i) => {
    if (!box1(s)) return;
    const a = fn.strokes.find((x) => x.order === i), b = fs.strokes.find((x) => x.order === i);
    assert.ok(a && a.done, `natural 第 ${i} 笔已画完`);
    assert.ok(!b || !b.done || i === 0, 'stretch 还在画');
  });
  assert.ok(fn.hand, 'hold 期间手还在纸上（静止在末笔）');
  assert.ok(W.reveal(nat, 9.2, dur) > 0.999 && W.reveal(base, 9.2, dur) > 0.999, '两种节奏都在画时画完');
  let last = -1;
  for (let x = 0; x <= dur; x += 0.05) { const r = W.reveal(nat, x, dur); assert.ok(r >= last - 1e-9); last = r; }
  assert.deepEqual(Ln.issues, [], '示范的三拍窗口都装得下');
  const tight = W.lane(Object.assign({}, nat, {beats: [{at: 0, end: 1, box: [0, 0, 34, 100]}, {at: 1, box: [34, 0, 66, 100]}]}), dur);
  assert.deepEqual(tight.issues.map((i) => i.code), ['whiteboard-window-too-short']);
  assert.equal(tight.beats[0].drawEnd, 1, '装不下就压到组窗');
  assert.equal(tight.issues[0].level, 'warning');
});

test('strict：笔画按 box 切段、重叠归后拍、box 外的段排到末拍之后；缺省仍按质心归第一个 box', () => {
  const d = W.byDemo('flow');
  const loose = W.order(d.strokes, W.defaults('flow'));
  assert.equal(loose.length, d.strokes.length, '不严格：一笔一条');
  assert.equal(loose.find((o) => o.i === 3).group, 0, '横跨两块的箭杆按质心（x=34，两块都含）归第一块');
  const strict = W.order(d.strokes, Object.assign(W.defaults('flow'), {strict: true}));
  assert.ok(strict.length > d.strokes.length, '严格：跨 box 的笔画被切开');
  const parts = strict.filter((o) => o.i === 3);
  assert.deepEqual(parts.map((o) => o.group), [0, 1], '箭杆 30→38：34 以左归第一拍、以右归第二拍');
  assert.ok(strict.every((o) => o.group < 3), '示范三块铺满画面，没有落在外面的段');
  const pcs = W.splitByBoxes([[0, 50], [100, 50]], [[0, 0, 60, 100], [40, 0, 60, 100]]);
  assert.deepEqual(pcs.map((p) => p.owner), [0, 1], '重叠 40–60 归后一拍');
  assert.ok(Math.abs(pcs[0].pts[pcs[0].pts.length - 1][0] - 40) < 1e-9);
  const out = W.splitByBoxes([[0, 50], [100, 50]], [[10, 0, 20, 100]]);
  assert.deepEqual(out.map((p) => p.owner), [1, 0, 1], 'box 外的两段 owner = boxes.length');
  const f = W.sample(Object.assign(W.defaults('flow'), {strict: true, draw: 9}), 9, {w: 100, h: 100}, 12);
  assert.ok(Math.abs(W.reveal(Object.assign(W.defaults('flow'), {strict: true, draw: 9}), 9, 12) - 1) < 1e-9, '切段后总长不变、画时画完');
  assert.ok(f.strokes.some((s) => s.part > 0));
  const emp = W.check({demo: 'flow', strict: true, beats: [{at: 0, end: 1, box: [0, 0, 1, 1]}, {at: 1, box: [0, 0, 100, 100]}]}, 12);
  assert.ok(emp.some((i) => i.code === 'whiteboard-empty-box'));
  const un = W.check({demo: 'flow', strict: true, beats: [{at: 0, box: [0, 0, 34, 100]}]}, 12);
  assert.ok(un.some((i) => i.code === 'whiteboard-unassigned-foreground'));
  assert.deepEqual(W.check({demo: 'flow', strict: false, beats: [{at: 0, box: [0, 0, 34, 100]}]}, 12), [], '不严格不报归属');
});

test('check：锚点缺失 / 拍序 / 末拍晚于画时 三种码；示范缺省无告警', () => {
  assert.deepEqual(W.check(W.defaults('flow'), 12), []);
  assert.deepEqual(W.check(W.defaults('idea'), 12), []);
  const miss = W.check({demo: 'flow', beats: [{at: '~main:w1:start', end: '~main:w77:end', box: [0, 0, 34, 100]}]}, 12);
  assert.deepEqual(miss.map((i) => [i.code, i.level, i.field]), [['word-anchor-missing', 'error', 'beats[0].end']]);
  const order = W.check({demo: 'flow', beats: [{at: 0, end: 5, box: [0, 0, 34, 100]}, {at: 3, box: [34, 0, 66, 100]}]}, 12);
  assert.deepEqual(order.map((i) => i.code), ['whiteboard-beat-window'], 'end 越过下一拍起点');
  const zero = W.check({demo: 'flow', beats: [{at: 2, end: 2, box: [0, 0, 34, 100]}]}, 12);
  assert.deepEqual(zero.map((i) => i.code), ['whiteboard-beat-window'], '起 = 止 不算窗');
  const late = W.check({demo: 'flow', draw: 4, beats: [{at: 0, end: 6, box: [0, 0, 34, 100]}]}, 12);
  assert.deepEqual(late.map((i) => i.code), ['whiteboard-beat-after-draw']);
  assert.ok(W.lane({demo: 'flow', beats: [{at: '~main:w99:start', box: [0, 0, 34, 100]}]}, 12).beats[0].ok === false);
  assert.equal(W.fmtBeat({ok: false}), '锚点失效');
  assert.equal(W.fmtBeat({ok: true, at: 0, end: 2.8}), '0.0 – 2.8 s');
});

test('switchDemo：换示范换笔画与节拍，手 / 纸 / 画时留着', () => {
  const p = Object.assign(W.defaults('idea'), {hand: 'pen', paper: null, draw: 4});
  const q = W.switchDemo(p, 'flow');
  assert.equal(q.demo, 'flow');
  assert.equal(q.beats.length, 3);
  assert.equal(q.hand, 'pen');
  assert.equal(q.paper, null);
  assert.equal(q.draw, 4);
});

test('paint：在假 2D 上下文上按纸 → 笔画 → 手的顺序落笔，透明纸不铺底', () => {
  const calls = [];
  const g = new Proxy({canvas: {width: 100, height: 100}}, {
    get(t, k) { if (k in t) return t[k]; return (...a) => calls.push(k); },
    set(t, k, v) { t[k] = v; return true; },
  });
  const p = W.defaults('idea');
  W.paint(g, W.sample(p, 1, {w: 100, h: 100}, 6));
  assert.equal(calls[0], 'save');
  assert.ok(calls.indexOf('fillRect') >= 0, '白纸铺底');
  assert.ok(calls.indexOf('stroke') > calls.indexOf('fillRect'));
  const calls2 = [];
  const g2 = new Proxy({canvas: {width: 100, height: 100}}, {
    get(t, k) { if (k in t) return t[k]; return (...a) => calls2.push(k); },
    set(t, k, v) { t[k] = v; return true; },
  });
  W.paint(g2, W.sample(Object.assign({}, p, {paper: null, hand: 'none'}), 1, {w: 100, h: 100}, 6));
  assert.equal(calls2.indexOf('fillRect'), -1, '透明纸不铺底');
  assert.equal(calls2.indexOf('ellipse'), -1, '无手不画手');
});

test('时间轴画时带：自动画时 = min(0.8×时长, 自然画时)，定格是余下的；节拍夹到时长、从 1 编号、带标签与徽标', () => {
  const p = W.defaults('flow');
  const L = W.lane(p, 12);
  assert.equal(L.auto, true);
  assert.equal(L.draw, W.effectiveDraw(p, 12));
  assert.ok(Math.abs(L.draw + L.hold - 12) < 1e-9);
  assert.deepEqual(L.beats.map((b) => b.i), [1, 2, 3]);
  assert.deepEqual(L.beats.map((b) => b.at), [0, 3.2, 6.4]);
  assert.deepEqual(L.beats.map((b) => b.label), ['第一步 · 收需求', '第二步 · 拆任务', '第三步 · 交付']);
  assert.ok(L.beats.every((b) => b.anchored && b.ok));
  assert.equal(L.mode, 'narration');
  assert.equal(L.pace, 'stretch');
  assert.equal(L.strict, false);
  assert.deepEqual(L.issues, []);
  const short = W.lane(p, 3);
  assert.deepEqual(short.beats.map((b) => b.at), [0, 3, 3], '第三拍 6.4s 落在 3s 条子之外，夹到条尾');
  const manual = W.lane(Object.assign({}, p, {draw: 4}), 12);
  assert.equal(manual.auto, false);
  assert.equal(manual.draw, 4);
  assert.equal(manual.hold, 8);
  assert.equal(W.lane(Object.assign(W.defaults('idea'), {draw: 4}), 12).mode, 'manual');
});

test('拖画时手柄：夹到 [0.5, min(60, 时长)]，贴近条尾吸回「跟时长走」（null），非法输入也回 null', () => {
  assert.equal(W.dragDraw(4.26, 12, 0.5), 4.3);
  assert.equal(W.dragDraw(0.1, 12, 0.5), 0.5, '下限 0.5s');
  assert.equal(W.dragDraw(11.7, 12, 0.5), null, '离条尾不足吸附距离 → 自动');
  assert.equal(W.dragDraw(11.4, 12, 0.5), 11.4);
  assert.equal(W.dragDraw(80, 100, 0.5), 60, '上限 60s');
  assert.equal(W.dragDraw(NaN, 12, 0.5), null);
  assert.equal(W.dragDraw(3, 2, 0), null, '越过条尾也是自动');
});

test('画面带格子：等宽切格、末格按剩余裁、t 取格中点秒数并夹到时长；零宽零缩放没有格', () => {
  const f = W.strip(12, 100, 20, 46);
  assert.deepEqual(f.map((x) => [x.left, x.width]), [[0, 46], [46, 46], [92, 8]]);
  assert.ok(Math.abs(f[0].t - 23 / 20) < 1e-9);
  assert.ok(Math.abs(f[2].t - 96 / 20) < 1e-9);
  const far = W.strip(2, 100, 20, 46);
  assert.equal(far[2].t, 2, '格中点落在时长之外就夹到时长（画完定格那一帧）');
  assert.deepEqual(W.strip(12, 0, 20), []);
  assert.deepEqual(W.strip(12, 100, 0), []);
  assert.equal(W.strip(12, 100, 20).length, 3, '缺省格宽 46');
});
