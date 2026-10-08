/* model-sticker-source.test.js —— 贴纸源类型（第 238 轮）。钉住四种 kind 的判据、
   缓存串不影响分类，以及 Lottie 静止帧 / 时长的读法；顺带拿真实的内置素材对拍。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
global.window = {};
require('./model-sticker-source.js');
const S = window.BC_STSRC;

test('扩展名决定 kind，缓存串与锚点不参与判断', () => {
  assert.strictEqual(S.kindOf('assets/stickers/anim/dyn-emoji-01.json'), 'lottie');
  assert.strictEqual(S.kindOf('assets/stickers/anim/dyn-emoji-01.json?v=20260910-r238'), 'lottie');
  assert.strictEqual(S.kindOf('a/b/c.GIF'), 'gif');
  assert.strictEqual(S.kindOf('assets/stickers/podcast-02.svg#icon'), 'svg');
  assert.strictEqual(S.kindOf('photo.png'), 'image');
  assert.strictEqual(S.kindOf('photo.webp'), 'image');
  assert.strictEqual(S.kindOf('photo.JPEG'), 'image');
  // 拿不到扩展名的源（blob:、data:、空串）保底当静态图
  assert.strictEqual(S.kindOf('blob:http://localhost:4327/9f1c-…'), 'image');
  assert.strictEqual(S.kindOf(''), 'image');
  assert.strictEqual(S.kindOf(null), 'image');
  assert.strictEqual(S.ext('x/y.tar.gz'), 'gz');
  assert.strictEqual(S.ext('/no-dot/file'), '');
  assert.strictEqual(S.ext('.hidden'), '');
});

test('对象形式的源可以显式带 kind（blob: 上传件靠它）', () => {
  assert.strictEqual(S.kindOf({src: 'blob:xyz', kind: 'lottie'}), 'lottie');
  assert.strictEqual(S.kindOf({src: 'blob:xyz', kind: 'gif'}), 'gif');
  // kind 不认识时退回按 src 判断
  assert.strictEqual(S.kindOf({src: 'x.gif', kind: 'wat'}), 'gif');
  assert.strictEqual(S.kindOf({src: 'x.json'}), 'lottie');
});

test('isLottie / isMoving / fillMode / label 四个派生判断', () => {
  assert.strictEqual(S.isLottie('a.json'), true);
  assert.strictEqual(S.isLottie('a.svg'), false);
  assert.strictEqual(S.isMoving('a.json'), true);
  assert.strictEqual(S.isMoving('a.gif'), true);
  assert.strictEqual(S.isMoving('a.png'), false);
  // SVG 会不会动要看源码里有没有 SMIL
  assert.strictEqual(S.isMoving('a.svg', '<svg><rect/></svg>'), false);
  assert.strictEqual(S.isMoving('a.svg', '<svg><animateTransform dur="2s"/></svg>'), true);
  assert.strictEqual(S.fillMode('a.svg'), 'svg');
  assert.strictEqual(S.fillMode('a.json'), 'lottie');
  assert.strictEqual(S.fillMode('a.gif'), 'none');
  assert.deepStrictEqual(['a.json', 'a.gif', 'a.svg', 'a.png'].map(S.label),
    ['Lottie', 'GIF', 'SVG 动画', '图片']);
});

test('isDynamicPage 把品牌库切成互补的两页，带 SMIL 的 SVG 也留在静态页', () => {
  assert.strictEqual(S.isDynamicPage('a.json'), true);
  assert.strictEqual(S.isDynamicPage('a.gif'), true);
  assert.strictEqual(S.isDynamicPage('a.svg'), false);
  assert.strictEqual(S.isDynamicPage('a.png'), false);
  assert.strictEqual(S.isDynamicPage({src: 'blob:xyz', kind: 'lottie'}), true);
  // Codex Pet（第 242 轮）只认显式 kind：同一张 .webp 不带 kind 就是位图、归静态页
  assert.strictEqual(S.isDynamicPage({src: 'x/spritesheet.webp', kind: 'pet'}), true);
  assert.strictEqual(S.isDynamicPage('x/spritesheet.webp'), false);
  assert.strictEqual(S.isPet({src: 'blob:1', kind: 'pet'}), true);
  assert.strictEqual(S.isMoving({src: 'blob:1', kind: 'pet'}), true);
  assert.strictEqual(S.fillMode({src: 'blob:1', kind: 'pet'}), 'none');
  assert.strictEqual(S.label({src: 'blob:1', kind: 'pet'}), 'Codex Pet');
  // 分页判据不读源码：SMIL 与否都归静态那一页（与 `isMoving` 的分工）
  assert.strictEqual(S.isMoving('a.svg', '<svg><animate dur="1s"/></svg>'), true);
  assert.strictEqual(S.isDynamicPage('a.svg'), false);
  // 互补：四种 kind 各只落一页，不重不漏
  const srcs = ['a.json', 'a.gif', 'a.svg', 'a.png', 'a.webp'];
  const dyn = srcs.filter((x) => S.isDynamicPage(x));
  const still = srcs.filter((x) => !S.isDynamicPage(x));
  assert.strictEqual(dyn.length + still.length, srcs.length);
  assert.deepStrictEqual(dyn, ['a.json', 'a.gif']);
});

test('posterFrame 认 rest 标记（大小写不敏感），缺了退回第 0 帧', () => {
  assert.strictEqual(S.posterFrame({markers: [{tm: 12, cm: 'rest', dr: 0}]}), 12);
  assert.strictEqual(S.posterFrame({markers: [{tm: 5, nm: 'Rest'}]}), 5);
  assert.strictEqual(S.posterFrame({markers: [{tm: 5, cm: 'intro'}]}), 0);
  assert.strictEqual(S.posterFrame({markers: []}), 0);
  assert.strictEqual(S.posterFrame({}), 0);
  assert.strictEqual(S.posterFrame(null), 0);
});

test('seconds 用 ip/op/fr 换算，fr 缺省 60', () => {
  assert.strictEqual(S.seconds({fr: 60, ip: 0, op: 120}), 2);
  assert.strictEqual(S.seconds({ip: 0, op: 30}), 0.5);
  assert.strictEqual(S.seconds({fr: 30, ip: 10, op: 10}), 0);
  assert.strictEqual(S.seconds(null), 0);
});

test('81 份内置 Lottie 逐份判成 lottie，且静止帧落在 [ip, op] 里', () => {
  const dir = path.join(__dirname, '../assets/stickers/anim');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'provenance.json');
  assert.strictEqual(files.length, 81);
  for (const f of files) {
    const src = 'assets/stickers/anim/' + f;
    assert.strictEqual(S.kindOf(src), 'lottie', f);
    assert.strictEqual(S.isMoving(src), true, f);
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const poster = S.posterFrame(data);
    assert.ok(poster >= (data.ip || 0) && poster <= data.op, f + ' poster=' + poster);
    assert.ok(S.seconds(data) > 0, f);
  }
});
