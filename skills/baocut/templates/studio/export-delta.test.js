const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./export-delta.js');

function doc() {
  return {
    rev: 7,
    meta: { title: 'Demo', duration: 60 },
    cues: [
      { id: 'c1', start: 0, end: 2.5, text: '你好，欢迎收看。' },
      { id: 'c2', start: 10, end: 12, text: '第二句字幕。' },
    ],
    transCues: [
      { id: 't1', start: 0, end: 2.5, text: 'Hello and welcome.' },
      { id: 't2', start: 10, end: 12, text: 'The second line.' },
    ],
  };
}

test('干净文档对自身基线判定为已同步', () => {
  const d = doc();
  const base = D.snapshot(d, { filename: 'demo.mp4' });
  const delta = D.delta(d, base);
  assert.equal(delta.count, 0);
  assert.equal(delta.upToDate, true);
  assert.deepEqual(delta.windows, []);
});

test('改一个词只弄脏自己的时间窗', () => {
  const d = doc();
  const base = D.snapshot(d, null);
  d.cues = d.cues.map((c) => c.id === 'c2' ? { ...c, text: '第二句改过的字幕。' } : c);
  const delta = D.delta(d, base);
  assert.equal(delta.count, 1);
  assert.equal(delta.windows.length, 1);
  const [s, e] = delta.windows[0];
  assert.ok(s >= 9 && s < 10, 'padded start');
  assert.ok(e > 12 && e <= 12.5, 'padded end');
});

test('译文行变化同样计入 delta（双语烧录）', () => {
  const d = doc();
  const base = D.snapshot(d, null);
  d.transCues = d.transCues.map((c) => c.id === 't1' ? { ...c, text: 'Hello there and welcome.' } : c);
  const delta = D.delta(d, base);
  assert.equal(delta.count, 1);
  assert.equal(delta.windows[0][0], 0);
});

test('断行/并行改变 Cue 集合，新增与消失都计入', () => {
  const d = doc();
  const base = D.snapshot(d, null);
  d.cues = [
    { id: 'c1a', start: 0, end: 1.2, text: '你好，' },
    { id: 'c1b', start: 1.2, end: 2.5, text: '欢迎收看。' },
    d.cues[1],
  ];
  const delta = D.delta(d, base);
  assert.ok(delta.count >= 3); // c1 消失 + c1a/c1b 新增
  assert.equal(delta.upToDate, false);
});

test('相邻脏时间窗合并成一个拼接段', () => {
  const wins = D.mergeWindows([[1, 2], [2.5, 3.5], [30, 31]], 60);
  assert.equal(wins.length, 2);
});

test('优先使用时间线投影 Cue（多源项目的输出时间）', () => {
  const d = doc();
  d.timelineCues = [{ id: 'c1', start: 5, end: 7.5, text: '你好，欢迎收看。' }];
  d.timelineTransCues = [];
  const base = D.snapshot(d, null);
  d.timelineCues = [{ id: 'c1', start: 5, end: 7.5, text: '改过了。' }];
  const delta = D.delta(d, base);
  assert.equal(delta.count, 1);
  assert.ok(delta.windows[0][0] >= 4.5 && delta.windows[0][1] <= 8);
});

test('换了项目标题的基线不参与判定', () => {
  const d = doc();
  const base = D.snapshot(d, null);
  d.meta = { ...d.meta, title: 'Another project' };
  assert.equal(D.delta(d, base), null);
});
