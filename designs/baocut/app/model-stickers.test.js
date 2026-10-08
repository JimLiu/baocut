/* model-stickers.js —— 贴纸目录只保留有固定第三方来源的
   15 个静态包与 5 个动态包。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
global.window = {};
require('./model-stickers.js');
/* data.js 的建数据链（第 89 轮：二级分类那一行的判据要同时看 data.js 与本表） */
require('./model-substyle.js');
require('./model-pose.js');
require('./model-shape-paths.js');
require('./model-elements.js');
require('./model-textpresets.js');
require('./model-wordanim.js');
require('./model-subanim.js');
require('./model-subpresets.js');
require('./model-motioncaption.js');
require('./model-template.js');
require('./model-cut.js');   // data.js 的剪口建议派生自它（第 192 轮）
require('./model-defaultsub.js'); // data.js 的画廊第一区（默认样式那张卡）
require('./data.js');
require('./model-elpanel.js');
const SK = window.BC_SK;
const D = window.BC_DATA;
const DIR = path.join(__dirname, '..', 'assets', 'stickers');

test('素材目录 16 个分类（15 个第三方包 ＋ CTA 组合包），包名唯一', () => {
  assert.strictEqual(SK.PACKS.length, 16);
  const ks = SK.PACKS.map((p) => p.k);
  assert.strictEqual(new Set(ks).size, 16);
});

test('空包与无第三方来源的包都不进入目录', () => {
  assert.ok(SK.PACKS.every((p) => p.files.length > 0));
  for (const removed of ['brandlogo', 'lower', 'pride', 'frame', 'letter',
    'blackfriday', 'shape', 'discount', 'component', 'callout', 'background']) {
    assert.ok(!SK.find(removed), removed);
  }
});

test('旧工程用的内置矢量只保留渲染兼容，不进入可添加目录', () => {
  assert.strictEqual(SK.BUILTIN.length, 10);
  assert.ok(SK.PACKS.every((p) => p.k !== 'builtin'));
  assert.ok(window.BC_ELPANEL.stickerRest(SK.PACKS).every((p) => p.k !== 'builtin'));
});

test('收下的每一张素材都真的在 assets/stickers 里', () => {
  SK.mirrored().forEach((p) => {
    SK.list(p).forEach((s) => {
      assert.ok(fs.existsSync(path.join(DIR, p.k + '-' + s.file)), s.src + ' 不存在');
    });
  });
});

test('目录数量只显示实际可用素材，没有旧站点的虚假总数', () => {
  SK.mirrored().forEach((p) => {
    assert.strictEqual(p.files.length, p.total, p.k);
  });
});

test('All 视图那一屏按包轮流取，不是取列表前 n 张', () => {
  const head = SK.head(12, 2);
  assert.strictEqual(head.length, 12);
  const first = SK.mirrored()[0].k;
  assert.ok(head.filter((s) => s.pack.k === first).length <= 2, '一个包最多占两格');
});

test('搜索命中包名与检索词（中英文都认），命中就是整包', () => {
  assert.ok(SK.search('箭头').some((p) => p.k === 'arrow'));
  assert.ok(SK.search('podcast').some((p) => p.k === 'podcast'));
  assert.strictEqual(SK.search('这个词不存在').length, 0);
});

test('路径由 slug ＋ 后缀拼出来，不在别处再拼一次', () => {
  const p = SK.find('arrow');
  assert.strictEqual(SK.src(p, p.files[0]), 'assets/stickers/arrow-' + p.files[0]);
});

test('动态贴纸只保留 5 个有第三方来源的分类', () => {
  assert.strictEqual(SK.ANIM.length, 5);
  SK.ANIM.forEach((c) => {
    assert.ok(/^dyn-/.test(c.k), c.k + ' 没带前缀');
    assert.strictEqual(c.anim, true);
    assert.ok(c.files.length > 0, c.k + ' 一张都没有');
  });
  // 静态包与动态分类的 slug 不能撞——撞了 find() 会拿错一整包
  const st = SK.PACKS.map((p) => p.k);
  SK.ANIM.forEach((c) => assert.ok(st.indexOf(c.k) < 0, c.k + ' 与静态包同名'));
});

test('动图落在 anim 子目录，每一张都在盘上', () => {
  SK.ANIM.forEach((c) => {
    SK.list(c).forEach((s) => {
      assert.ok(s.src.indexOf('assets/stickers/anim/') === 0, s.src + ' 不在 anim 子目录');
      assert.ok(s.anim, s.id + ' 没标成动图');
      assert.ok(fs.existsSync(path.join(DIR, 'anim', c.k + '-' + s.file)), s.src + ' 不存在');
    });
  });
});

test('动图搜索与静态包同口径，两侧互不串台', () => {
  assert.ok(!SK.searchAnim('箭头').some((c) => c.k === 'dyn-arrow'));
  assert.ok(SK.searchAnim('emoji').some((c) => c.k === 'dyn-emoji'));
  // Confetti 第 231 轮不再是动图包（改为算法粒子元素）
  assert.ok(!SK.searchAnim('confetti').some((c) => c.k === 'dyn-confetti'));
  assert.strictEqual(SK.searchAnim('这个词不存在').length, 0);
  // 静态那侧的搜索不该把动态分类捞进来
  assert.ok(!SK.search('箭头').some((p) => p.anim));
});

test('满屏平台标识的两类整类不收，逐条还过了品牌与影视 IP 词表', () => {
  const prov = JSON.parse(fs.readFileSync(path.join(DIR, 'anim', 'provenance.json'), 'utf8'));
  const cats = new Set(Object.values(prov).map((v) => v.cat));
  assert.ok(!cats.has('Logos'), '平台标识那一类不该在');
  assert.ok(!cats.has('Social Media'), '社交平台那一类不该在');
  const BRAND = /instagram|youtube|tiktok|facebook|twitter|snapchat|netflix|disney|spotify/i;
  Object.entries(prov).forEach(([f, v]) => {
    assert.ok(!BRAND.test(v.title || ''), f + ' 的原标题里有品牌名');
  });
});

/* ---------- 分区的二级分类（第 89 轮；第 122 轮结构搬去 model-elpanel.js） ---------- */

test('声明了 subs 的分区，二级分类表都取得到，而且钻得进去', () => {
  const P = window.BC_ELPANEL;
  // 模板那一行（2026-09-14）：全部 ＋ 有模板的组，组按内置目录算（品牌库为空也至少有两格）
  const TPL = window.BC_TPL;
  const tables = {pack: P.stickerChips(SK.PACKS), viz: P.VIZ_CATS,
    tpl: P.tplChips(TPL.groupTemplates(TPL.builtins('zh'), 'zh'))};
  P.SECTIONS.forEach((sec) => {
    if (!sec.subs) return;
    const t = tables[sec.subs];
    assert.ok(t, `${sec.k} 声明的 subs=${sec.subs} 没有对应的表`);
    // 只有一格的话这一行 chip 什么也没分，不该摆
    assert.ok(t.length >= 2, `${sec.k} 的二级分类少于两格`);
    assert.ok(sec.tab, `${sec.k} 有二级分类就必须能钻进去`);
    t.forEach((c) => {
      assert.ok(c.k, 'chip 要有 key');
      assert.ok(c.label, 'chip 要有中文名');
    });
  });
});

test('只有一层的分区不声明 subs——不造一行空 chip', () => {
  const P = window.BC_ELPANEL;
  assert.deepStrictEqual(P.SECTIONS.filter((s) => s.subs).map((s) => s.k), ['st', 'viz', 'fr']);
});
