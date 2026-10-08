const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-stage-load.js');
const M = global.window.BC_STAGE_LOAD;

test('正常时什么都不画', () => {
  assert.equal(M.notice(M.demo('ready', 0), 99999, {}, 'zh'), null);
  assert.equal(M.notice(undefined, 0, {}, 'zh'), null);
});

test('载入中：先是安静的一块，过一小会儿才露出转圈，满门槛变成卡在引擎', () => {
  const d = M.demo('loading', 1000);
  assert.deepEqual(M.notice(d, 1000 + 100, {}, 'zh'), {kind: 'loading', label: '正在载入预览', spinner: false});
  assert.equal(M.notice(d, 1000 + M.SPINNER_DELAY_MS, {}, 'zh').spinner, true);
  assert.equal(M.waitMs(d, 1000 + 100), M.SPINNER_DELAY_MS - 100);
  assert.equal(M.waitMs(d, 1000 + 2000), M.STALL_MS - 2000);
  const n = M.notice(d, 1000 + M.STALL_MS, {}, 'zh');
  assert.equal(n.kind, 'stalled');
  assert.equal(n.detail, '预览引擎还在载入');
  assert.equal(n.body, '已经等了 10 秒。重试只重新载入预览，不会改动视频。');
  assert.equal(n.retry, '重试');
});

test('卡住的挡位点名卡在哪一步；媒体用文件名，字幕没有名字时用通用说法', () => {
  const at = 5000;
  assert.equal(M.notice(M.demo('stall-media', at), at, {media: 'talk-take2.mp4'}, 'zh').detail, '在等媒体：talk-take2.mp4');
  assert.equal(M.notice(M.demo('stall-captions', at), at, {}, 'zh').detail, '在等字幕：原文字幕');
  assert.equal(M.notice(M.demo('stall-engine', at), at + 3000, {}, 'zh').body, '已经等了 13 秒。重试只重新载入预览，不会改动视频。');
  // 卡住时每秒更新等了多久。
  assert.equal(M.waitMs(M.demo('stall-engine', at), at + 300), 700);
});

test('重试：载入一小会儿后好了', () => {
  const d = M.demo('retrying', 0);
  assert.equal(M.notice(d, 100, {}, 'zh').kind, 'loading');
  assert.equal(M.notice(d, M.RETRY_DEMO_MS, {}, 'zh'), null);
  assert.equal(M.waitMs(d, M.RETRY_DEMO_MS), null);
});

test('英文文案：用术语表的说法（重试 = Try again）', () => {
  const n = M.notice(M.demo('stall-media', 0), 0, {media: 'a.mp4'}, 'en');
  assert.equal(n.title, 'Preview is stuck');
  assert.equal(n.detail, 'Waiting for media: a.mp4');
  assert.equal(n.retry, 'Try again');
  assert.equal(M.notice(M.demo('loading', 0), 0, {}, 'en').label, 'Loading preview');
  const p = M.notice(M.demo('preparing', 0), M.STALL_MS, {media: 'a.webm'}, 'en');
  assert.equal(p.label, `Preparing preview · ${p.pct}%`);
  assert.equal(p.detail, 'Converting so it can play: a.webm');
});

test('转换中：头一小会儿安静，随后是百分比与进度条，进度在走就不算卡住，走完出画面', () => {
  const d = M.demo('preparing', 0);
  assert.deepEqual(M.notice(d, 100, {}, 'zh'), {kind: 'loading', label: '正在载入预览', spinner: false});
  // 还不知道进度：没有百分比，进度条不定。
  const unknown = M.notice(d, M.SPINNER_DELAY_MS, {media: 'talk.webm'}, 'zh');
  assert.equal(unknown.kind, 'preparing');
  assert.equal(unknown.label, '正在准备预览');
  assert.equal(unknown.pct, null);
  assert.equal(unknown.detail, '要先转换才能播放：talk.webm');
  assert.equal(unknown.body, '只在第一次打开时转换，之后直接播放；原文件不会改动。');
  // 过了卡住门槛仍是转换中，百分比在涨。
  const a = M.notice(d, M.STALL_MS, {}, 'zh');
  const b = M.notice(d, M.STALL_MS + 2000, {}, 'zh');
  assert.equal(a.kind, 'preparing');
  assert.ok(b.pct > a.pct);
  assert.equal(a.label, `正在准备预览 · ${a.pct}%`);
  assert.equal(M.notice(d, M.PREPARE_DEMO_MS, {}, 'zh'), null);
  // 按 1 秒的节拍刷新；走完就不再排计时器。
  assert.equal(M.waitMs(d, 100), M.SPINNER_DELAY_MS - 100);
  assert.equal(M.waitMs(d, 3300), 700);
  assert.equal(M.waitMs(d, M.PREPARE_DEMO_MS), null);
});

test('百分比向下取整、封顶 99；不知道进度是 null', () => {
  assert.equal(M.pct(0.379), 37);
  assert.equal(M.pct(0.999), 99);
  assert.equal(M.pct(1), 99);
  assert.equal(M.pct(undefined), null);
  assert.equal(M.pct(null), null);
});

test('转换卡住：进度停住满门槛才算卡在转换，等了多久从停住那一刻算，点名那个媒体', () => {
  const d = M.demo('prepare-stuck', 0);
  const frozen = M.FROZEN_AFTER_MS;
  assert.equal(M.notice(d, frozen + M.STALL_MS - 1, {media: 'talk.webm'}, 'zh').label, '正在准备预览 · 37%');
  const n = M.notice(d, frozen + M.STALL_MS, {media: 'talk.webm'}, 'zh');
  assert.equal(n.kind, 'stalled');
  assert.equal(n.step, 'prepare');
  assert.equal(n.detail, '转换媒体没有进展：talk.webm');
  assert.equal(n.body, '已经等了 10 秒。重试只重新载入预览，不会改动视频。');
  assert.equal(M.notice(d, frozen + M.STALL_MS, {media: 'talk.webm'}, 'en').detail, "Media conversion isn't progressing: talk.webm");
});

test('原型开关的挡位都能演出来', () => {
  // 门槛之后再过一会儿：转换中还在走，其余的非正常挡位都已卡住。
  const at = M.FROZEN_AFTER_MS + M.STALL_MS;
  const expected = {ready: null, loading: 'stalled', preparing: 'preparing', 'prepare-stuck': 'stalled'};
  for (const [mode] of M.DEMOS) {
    const n = M.notice(M.demo(mode, 0), at, {}, 'zh');
    const want = mode in expected ? expected[mode] : 'stalled';
    assert.equal(n ? n.kind : null, want, mode);
  }
});
