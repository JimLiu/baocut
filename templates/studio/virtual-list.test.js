const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./virtual-list.js');

const groups = [
  { ch: { title: 'A', start: 0, end: 10 }, ci: 0, rows: [{ cue: { id: 'c1', text: 'one' } }, { cue: { id: 'c2', text: 'two' } }] },
  { ch: { title: 'B', start: 10, end: 20 }, ci: 1, rows: [{ cue: { id: 'c3', text: 'three' } }] },
];
const flat = () => V.flatten(groups, (r) => r.cue.id);

test('flatten 交错章节头与条目并标记 sticky', () => {
  const rows = flat();
  assert.deepEqual(rows.map((r) => r.kind), ['head', 'item', 'item', 'head', 'item']);
  assert.deepEqual(rows.map((r) => r.key), ['ch:0', 'c1', 'c2', 'ch:1', 'c3']);
  assert.equal(rows[0].sticky, true);
  assert.equal(rows[1].sticky, undefined);
  assert.equal(rows[4].ci, 1);
});

test('offsets 是前缀和，末位为总高', () => {
  assert.deepEqual(V.offsets([10, 20, 30]), [0, 10, 30, 60]);
  assert.deepEqual(V.offsets([]), [0]);
});

test('findIndexAt 命中包含该 y 的行', () => {
  const offs = V.offsets([10, 20, 30]);
  assert.equal(V.findIndexAt(offs, 0), 0);
  assert.equal(V.findIndexAt(offs, 9.9), 0);
  assert.equal(V.findIndexAt(offs, 10), 1);
  assert.equal(V.findIndexAt(offs, 29), 1);
  assert.equal(V.findIndexAt(offs, 30), 2);
  assert.equal(V.findIndexAt(offs, 1e6), 2);
  assert.equal(V.findIndexAt(V.offsets([]), 5), 0);
});

test('findIndexAt 与线性扫描在大表上一致', () => {
  const heights = Array.from({ length: 500 }, (_, i) => 10 + (i % 7));
  const offs = V.offsets(heights);
  for (let y = 0; y < offs[500]; y += 3) {
    let want = 0;
    for (let i = 0; i < 500; i++) if (offs[i] <= y) want = i;
    assert.equal(V.findIndexAt(offs, y), want, 'y=' + y);
  }
});

test('visibleRange 覆盖视口并按 overscan 扩张', () => {
  const offs = V.offsets(new Array(100).fill(10));
  const tight = V.visibleRange(offs, 200, 100, 0);
  assert.equal(tight.start, 20);
  assert.equal(tight.end, 30);
  const loose = V.visibleRange(offs, 200, 100, 50);
  assert.equal(loose.start, 15);
  assert.equal(loose.end, 35);
  // 顶部不越界
  assert.equal(V.visibleRange(offs, 0, 100, 400).start, 0);
  // 空表
  assert.deepEqual(V.visibleRange(V.offsets([]), 0, 100, 400), { start: 0, end: 0 });
});

test('visibleRange 至少给一行，滚到底也不空', () => {
  const offs = V.offsets(new Array(10).fill(10));
  const r = V.visibleRange(offs, 100, 0, 0);
  assert.ok(r.end > r.start);
});

test('renderPlan 把窗外的钉住行补进来并保持升序', () => {
  const rows = new Array(100).fill(0).map((_, i) => ({ key: 'k' + i }));
  const range = { start: 40, end: 45 };
  const plan = V.renderPlan(rows, range, ['k3', 'k42', 'k90', null, 'nope']);
  assert.deepEqual(plan, [3, 40, 41, 42, 43, 44, 90]);
  // 无钉住行时直接返回窗口
  assert.deepEqual(V.renderPlan(rows, range, []), [40, 41, 42, 43, 44]);
});

test('stickyAt 返回当前章节头及被顶走的位移', () => {
  const rows = flat();
  const heights = [30, 60, 60, 30, 60];
  const offs = V.offsets(heights);   // [0,30,90,150,180,240]
  // 还没滚动：章节头本体就在位，不需要浮层
  assert.equal(V.stickyAt(rows, offs, 0, heights), null);
  // 滚过第一个头：浮层贴顶
  assert.deepEqual(V.stickyAt(rows, offs, 100, heights), { index: 0, top: 100 });
  // 第二个头（offset=150，高 30）顶上来
  assert.deepEqual(V.stickyAt(rows, offs, 130, heights), { index: 0, top: 120 });
  // 越过第二个头之后换成它
  assert.deepEqual(V.stickyAt(rows, offs, 200, heights), { index: 3, top: 200 });
});

test('scrollTopFor 只在目标出视口时给新位置', () => {
  const offs = V.offsets(new Array(100).fill(20));
  assert.equal(V.scrollTopFor(offs, 12, 200, 400, 8), null);       // 240 在 [200,600]
  const up = V.scrollTopFor(offs, 2, 400, 400, 8);
  assert.ok(up != null && up < 400);
  const down = V.scrollTopFor(offs, 60, 0, 400, 8);
  assert.equal(down, 1200 - 200 + 10);
  assert.equal(V.scrollTopFor(offs, -1, 0, 400, 8), null);
  assert.equal(V.scrollTopFor(offs, 999, 0, 400, 8), null);
  // 不会滚过底
  assert.equal(V.scrollTopFor(offs, 99, 0, 400, 8), 2000 - 400);
});

test('高度缓存按指纹命中，文本变化即失效', () => {
  const store = V.createHeightStore({
    estimate: () => 64,
    fingerprint: (r) => r.item.cue.text,
  });
  const row = { key: 'c1', kind: 'item', item: { cue: { id: 'c1', text: 'hello' } } };
  assert.equal(store.height(row), 64);
  assert.equal(store.measure(row, 90), true);
  assert.equal(store.height(row), 90);
  assert.equal(store.measure(row, 90.2), false, '亚像素抖动不重排');
  const changed = { key: 'c1', kind: 'item', item: { cue: { id: 'c1', text: 'hello world' } } };
  assert.equal(store.height(changed), 64, '文本变了退回估算');
});

test('宽度变化整表失效', () => {
  const store = V.createHeightStore({ estimate: (r, w) => w / 10, fingerprint: () => 'x' });
  store.setWidth(400);
  const row = { key: 'a' };
  store.measure(row, 123);
  assert.equal(store.height(row), 123);
  assert.equal(store.setWidth(400), false);
  assert.equal(store.setWidth(360), true);
  assert.equal(store.height(row), 36);
});

test('prune 清掉已消失的行', () => {
  const store = V.createHeightStore({ estimate: () => 10, fingerprint: () => 'x' });
  for (let i = 0; i < 50; i++) store.measure({ key: 'k' + i }, 20 + i);
  assert.equal(store.size(), 50);
  const live = [{ key: 'k1' }, { key: 'k2' }];
  store.prune(live);
  assert.equal(store.size(), 2);
  assert.equal(store.height({ key: 'k1' }), 21);
});

test('字幕行估算随文本长度与宽度变化', () => {
  const short = { kind: 'item', key: 'a', item: { cue: { text: 'hi' } } };
  const long = { kind: 'item', key: 'b', item: { cue: { text: 'x'.repeat(400) } } };
  const h1 = V.estimateSubtitleRow(short, 360);
  const h2 = V.estimateSubtitleRow(long, 360);
  const h3 = V.estimateSubtitleRow(long, 720);
  assert.ok(h1 > 40 && h1 < 90, '单行在合理区间: ' + h1);
  assert.ok(h2 > h1);
  assert.ok(h3 < h2, '变宽后行数减少');
  // 段首多一段间距
  const para = { kind: 'item', key: 'c', item: { cue: { text: 'hi', paraStart: true } } };
  assert.equal(V.estimateSubtitleRow(para, 360) - h1, V.SB.paraGap);
  // 中文比拉丁宽
  const cjk = { kind: 'item', key: 'd', item: { cue: { text: '中'.repeat(60) } } };
  const lat = { kind: 'item', key: 'e', item: { cue: { text: 'a'.repeat(60) } } };
  assert.ok(V.estimateSubtitleRow(cjk, 360) > V.estimateSubtitleRow(lat, 360));
  assert.equal(V.estimateSubtitleRow({ kind: 'head', key: 'ch:0' }, 360), V.SB.headRow);
});

test('字幕指纹区分文本与段首', () => {
  const a = { kind: 'item', item: { cue: { text: 'x' } } };
  const b = { kind: 'item', item: { cue: { text: 'x', paraStart: true } } };
  assert.notEqual(V.subtitleFingerprint(a), V.subtitleFingerprint(b));
  assert.equal(V.subtitleFingerprint({ kind: 'head' }), 'h');
});

test('5000 行的排版与查找是常数级可用', () => {
  const big = [];
  for (let c = 0; c < 50; c++) {
    big.push({ ch: { title: 'C' + c, start: c, end: c + 1 }, ci: c, rows: [] });
    for (let i = 0; i < 100; i++) big[c].rows.push({ cue: { id: 'c' + c + '_' + i, text: 'line ' + i } });
  }
  const rows = V.flatten(big, (r) => r.cue.id);
  assert.equal(rows.length, 5050);
  const store = V.createHeightStore({ estimate: V.estimateSubtitleRow, fingerprint: V.subtitleFingerprint });
  store.setWidth(380);
  const offs = V.offsets(store.heights(rows));
  const range = V.visibleRange(offs, offs[2500], 700, 400);
  assert.ok(range.end - range.start < 40, '可见行数远小于总行数: ' + (range.end - range.start));
  const plan = V.renderPlan(rows, range, [rows[10].key]);
  assert.equal(plan[0], 10);
  assert.equal(plan.length, range.end - range.start + 1);
});
