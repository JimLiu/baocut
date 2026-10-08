/* model-svgfill.js —— 把色卡的判据钉住。真实素材那几条读的是 `assets/stickers/`
   本体——判据一旦漂，这几条会先红。

   素材里的 hex 是**画进视频画面的填充**，不是 S2 表面。这里一律用变量拼出来，
   免得设计系统检查器把测试数据当成 chrome 色值。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
global.window = {};
require('./model-svgfill.js');
const F = window.BC_SVGFILL;

const H = (s) => '#' + s;
const A = H('FF7676'), B = H('123ABC'), C = H('0A0B0C');
const asset = (f) => fs.readFileSync(path.join(__dirname, '..', 'assets', 'stickers', f), 'utf8');
const hexes = (svg) => F.fillsOf(svg).map((x) => x.hex);

test('八个标签的 fill 属性进色卡，别的标签与非颜色值一律不进', () => {
  const svg = `<svg><g fill="${A}"><path fill="${A}"/><rect fill="${B}"/>`
    + `<text fill="${C}">x</text><path fill="none"/><path fill="currentColor"/>`
    + `<path fill="url(#grad)"/></g></svg>`;
  assert.deepStrictEqual(F.fillsOf(svg), [
    {hex: A, tag: 'path', count: 1},
    {hex: B, tag: 'rect', count: 1},
  ], '`g` 与 `text` 不在白名单，none / currentColor / 渐变引用读不出色');
});

test('同一个默认色的节点归一组，组的次序 = 文档出现次序', () => {
  const svg = `<svg><circle fill="${B}"/><path fill="${A}"/><path fill="${A.toLowerCase()}"/>`
    + `<ellipse fill="${B}"/></svg>`;
  assert.deepStrictEqual(F.fillsOf(svg), [
    {hex: B, tag: 'circle', count: 2},
    {hex: A, tag: 'path', count: 2},
  ], '大小写不同是同一个色；`tag` 记的是这一组第一个节点的标签');
});

test('三种 hex 写法都认，三位简写补齐成六位', () => {
  assert.deepStrictEqual(hexes('<path fill="#fff"/>'), [H('FFFFFF')]);
  assert.deepStrictEqual(hexes(`<path fill="${A}80"/>`), [A + '80'], '八位（带 alpha）原样留着');
  assert.deepStrictEqual(hexes(''), []);
  assert.deepStrictEqual(hexes(null), []);
});

test('style 里只认 fill 那一条声明，stop-color 也算一种承载', () => {
  assert.deepStrictEqual(hexes(`<path style="fill:${A};stroke:${B}"/>`), [A],
    'stroke 不是填充色，不出卡');
  assert.deepStrictEqual(hexes(`<path style="fill-rule:nonzero;fill:${A};fill-opacity:1"/>`), [A],
    'fill-rule / fill-opacity 后面不是冒号，不会被误认');
  assert.deepStrictEqual(hexes(`<stop stop-color="${A}"/><stop stop-color="${B}"/>`), [A, B]);
  assert.deepStrictEqual(hexes(`<path fill="none" style="fill:${A}"/>`), [A],
    'fill 属性读不出色时再落到 style');
});

test('含 `<image>` 的素材一张卡都不给（位图套壳）', () => {
  const svg = `<svg><path fill="${A}"/><image href="x.png"/></svg>`;
  assert.deepStrictEqual(F.fillsOf(svg), []);
  assert.deepStrictEqual(F.groupsOf(svg), []);
  assert.strictEqual(F.applyFills(svg, [B]), svg, '换色也不动它');
});

test('不同色超过 15 种就一张卡都不给，否则最多 5 张', () => {
  const many = (n) => Array.from({length: n},
    (_, i) => `<path fill="#${String(100000 + i * 7)}"/>`).join('');
  assert.strictEqual(F.groupsOf(many(15)).length, 15);
  assert.strictEqual(F.fillsOf(many(15)).length, 5, '15 种在闭区间里，取前 5 组');
  assert.deepStrictEqual(F.fillsOf(many(16)), [], '第 16 种一到，整段收走');
  assert.strictEqual(F.groupsOf(many(16)).length, 16, '分组本身还在，收走的只是色卡');
});

test('applyFills：第 i 张卡只换第 i 组，别处一个字符都不动', () => {
  const svg = `<svg><path fill="${A}" stroke="${A}"/><rect style="fill:${B};stroke:${A}"/>`
    + `<path fill="${A}"/></svg>`;
  const TO = H('00FF00');
  assert.strictEqual(F.applyFills(svg, [TO]),
    `<svg><path fill="${TO}" stroke="${A}"/><rect style="fill:${B};stroke:${A}"/>`
    + `<path fill="${TO}"/></svg>`, '第一组两个节点一起换，stroke 与第二组原样');
  assert.strictEqual(F.applyFills(svg, [null, TO]),
    `<svg><path fill="${A}" stroke="${A}"/><rect style="fill:${TO};stroke:${A}"/>`
    + `<path fill="${A}"/></svg>`, '空位跳过，只换第二组的 style 声明');
  assert.strictEqual(F.applyFills(svg, []), svg, '空表 = 没改过色');
  assert.strictEqual(F.applyFills(svg, null), svg);
  assert.strictEqual(F.applyFills(svg, [TO, TO, TO, TO]), F.applyFills(svg, [TO, TO]),
    '多给的卡没有对应的组，丢掉');
});

test('isDefault：与默认色逐项相等才算「没改过」', () => {
  const svg = `<path fill="${A}"/><rect fill="${B}"/>`;
  assert.strictEqual(F.isDefault(svg, []), true);
  assert.strictEqual(F.isDefault(svg, null), true);
  assert.strictEqual(F.isDefault(svg, [A, B]), true);
  assert.strictEqual(F.isDefault(svg, [A.toLowerCase(), B]), true, '大小写不算改动');
  assert.strictEqual(F.isDefault(svg, [H('00FF00'), B]), false);
});

test('dataUri 是 base64 的 image/svg+xml，能原样解回来', () => {
  const svg = `<svg><path fill="${A}"/><title>中文</title></svg>`;
  const uri = F.dataUri(svg);
  assert.ok(uri.indexOf('data:image/svg+xml;base64,') === 0);
  assert.strictEqual(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'), svg,
    'UTF-8 不能在 base64 这一步丢掉');
});

test('内置矢量贴纸直译成 SVG 后走同一条路', () => {
  const svg = F.builtinSvg([{fill: A, d: 'M0 0L1 1Z'}, {stroke: B, w: 0.1, d: 'M0 1L1 0'}]);
  assert.deepStrictEqual(hexes(svg), [A], '只有填充进色卡，描边不进');
  assert.ok(F.applyFills(svg, [H('00FF00')]).indexOf(H('00FF00')) > 0);
  assert.ok(F.applyFills(svg, [H('00FF00')]).indexOf(B) > 0, '描边色原样留着');
});

test('内置贴纸的第 i 层按它的原色排第几取卡', () => {
  const layers = [{fill: A, d: 'M0 0Z'}, {stroke: B, w: 0.1, d: 'M0 1Z'},
                  {fill: C, d: 'M1 1Z'}, {fill: A, d: 'M1 0Z'}];
  const TO = H('00FF00');
  assert.strictEqual(F.layerFill(layers, [TO], 0), TO);
  assert.strictEqual(F.layerFill(layers, [TO], 3), TO, '同色的两层一起换');
  assert.strictEqual(F.layerFill(layers, [TO], 1), 'none', '只描边的层没有填充色');
  assert.strictEqual(F.layerFill(layers, [TO], 2), C, '第二组没给新色，留原色');
  assert.strictEqual(F.layerFill(layers, [null, TO], 2), TO);
  assert.strictEqual(F.layerFill(layers, [], 0), A, '空表 = 全是原色');
  assert.strictEqual(F.layerFill(layers, null, 9), 'none', '越界不炸');
});

/* ---------- 真实素材（判据一旦漂，这三条先红） ---------- */

test('单色第三方素材仍有一个可编辑颜色组', () => {
  const svg = asset('hand-01.svg');
  assert.strictEqual(F.groupsOf(svg).length, 1);
  const before = hexes(svg);
  const TO = H('00FF00');
  const out = F.applyFills(svg, [TO]);
  assert.ok(out.split(TO).length - 1 >= 1, '第一组的节点都应换色');
  assert.deepStrictEqual(hexes(out).slice(1), before.slice(1), '其他组原样');
  assert.deepStrictEqual(hexes(out)[0], TO, '换完再读，第一张卡就是新色');
});

test('Fluent 笑哭表情的同色节点一起换，其他组不变', () => {
  const svg = asset('emoji-cryLaugh.svg');
  const cards = F.fillsOf(svg);
  assert.ok(cards.length >= 2 && cards.length <= 5);
  const TO = H('00FF00');
  const out = F.applyFills(svg, [null, TO]);
  assert.strictEqual(out.split('fill="' + TO + '"').length - 1, cards[1].count);
  assert.deepStrictEqual(hexes(out), cards.map((c, i) => i === 1 ? TO : c.hex));
  assert.ok(out.includes('MIT License'), '许可注释必须随工程保留');
});

test('新的播客素材默认色往返不写空编辑', () => {
  const svg = asset('podcast-02.svg');
  const before = hexes(svg);
  assert.ok(before.length >= 2);
  const TO = H('00FF00');
  assert.ok(F.applyFills(svg, [TO]).includes('fill="' + TO + '"'));
  assert.strictEqual(F.isDefault(svg, before), true);
});

test('新的爱心贴纸支持多个色区', () => {
  const svg = asset('emoji-heart.svg');
  assert.ok(hexes(svg).length >= 2);
});

/* 第 238 轮：五个动态分类换成 Noto 的 Lottie JSON（走 lottie-web，不吃这道 SVG 门禁），
   所以 `anim/` 下只剩 Lottie，静态 SVG 从 325 张降到 269 张。 */
test('301 张第三方 SVG 素材全部通过分色与许可门禁', () => {
  let count = 0;
  for (const sub of ['', 'anim/']) {
    for (const file of fs.readdirSync(path.join(__dirname, '../assets/stickers', sub))) {
      if (!file.endsWith('.svg')) continue;
      const svg = asset(sub + file);
      assert.ok(svg.includes('MIT License') || svg.includes('CC0 1.0 Universal'), file);
      const before = hexes(svg);
      assert.ok(before.length >= 1 && before.length <= 5, file);
      const out = F.applyFills(svg, [H('10FE72')]);
      assert.deepStrictEqual(hexes(out), before.map((c, i) => i === 0 ? H('10FE72') : c), file);
      count++;
    }
  }
  assert.strictEqual(count, 301);
});

test('stretch —— 给根 <svg> 写 preserveAspectRatio="none"（拉伸档）', () => {
  const out = F.stretch('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>');
  assert.strictEqual(out,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" preserveAspectRatio="none">'
    + '<path d="M0 0"/></svg>');
});

test('stretch —— 已有的 preserveAspectRatio 被替换而不是叠加', () => {
  const out = F.stretch('<svg preserveAspectRatio="xMidYMid meet" viewBox="0 0 1 1"></svg>');
  assert.strictEqual(out.split('preserveAspectRatio').length - 1, 1);
  assert.ok(out.indexOf('preserveAspectRatio="none"') > 0);
  assert.ok(out.indexOf('viewBox="0 0 1 1"') > 0);
});

test('stretch —— 只动根标签：内部 <image> 的同名属性不碰', () => {
  const out = F.stretch('<svg viewBox="0 0 1 1"><image preserveAspectRatio="xMidYMid slice"/></svg>');
  assert.ok(out.indexOf('<image preserveAspectRatio="xMidYMid slice"/>') > 0);
  assert.ok(/^<svg viewBox="0 0 1 1" preserveAspectRatio="none">/.test(out));
});

test('stretch —— 自闭合根标签与空输入不炸', () => {
  assert.strictEqual(F.stretch('<svg viewBox="0 0 1 1"/>'),
    '<svg viewBox="0 0 1 1" preserveAspectRatio="none"/>');
  assert.strictEqual(F.stretch(''), '');
  assert.strictEqual(F.stretch(null), '');
  assert.strictEqual(F.stretch('not svg'), 'not svg');
});

test('stretch —— 内置贴纸也能拉伸，且不影响色卡判据', () => {
  const svg = F.builtinSvg([{d: 'M0 0L1 1', fill: A}]);
  const out = F.stretch(svg);
  assert.ok(out.indexOf('preserveAspectRatio="none"') > 0);
  assert.deepStrictEqual(hexes(out), [A], '加了属性之后分组不变');
});
