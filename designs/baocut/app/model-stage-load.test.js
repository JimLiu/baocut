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
});

test('原型开关的挡位都能演出来', () => {
  for (const [mode] of M.DEMOS) {
    const n = M.notice(M.demo(mode, 0), M.STALL_MS, {}, 'zh');
    if (mode === 'ready') assert.equal(n, null);
    else assert.equal(n.kind, 'stalled', mode);
  }
});
