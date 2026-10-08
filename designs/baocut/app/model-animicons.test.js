/* model-animicons.js —— 目录格的示意图（第 58.3 轮）。
   这些测试盯的是「每一格都有图、图里真的画着东西、静止时彼此不同」——
   前一版那个只在 hover 时才动的小方块，十三格长得一模一样。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-shape-paths.js');   // model-elements.js 的形状几何（生成物）
require('./model-elements.js');
require('./model-animicons.js');
const E = window.BC_EL;
const A = window.BC_ANIMICON;

test('三个槽的每一格都有示意图（「无」除外，它画的是禁止符）', () => {
  ['in', 'out', 'loop'].forEach((slot) => {
    E.ANIMS[slot].forEach((a) => {
      if (a.k === 'none') { assert.strictEqual(A.animIcon(slot, a.k), null); return; }
      const g = A.animIcon(slot, a.k);
      assert.ok(g && g.length, slot + '-' + a.k + ' 没有示意图');
    });
  });
});

test('图形数量与目录对得上：12 + 12 + 9', () => {
  assert.strictEqual(Object.keys(A.ICONS).length, 33);
});

test('每一份都画在同一个 80×80 视框里', () => {
  assert.strictEqual(A.VIEWBOX, '0 0 80 80');
});

test('每一份里都有能画出东西的节点（不是空壳）', () => {
  Object.keys(A.ICONS).forEach((k) => {
    const flat = JSON.stringify(A.ICONS[k]);
    assert.ok(/"d":"M/.test(flat) || /"t":"rect"/.test(flat), k + ' 里没有路径也没有方块');
  });
});

test('同一个槽里两两不同——这正是这一轮要解决的事', () => {
  ['in', 'out', 'loop'].forEach((slot) => {
    const seen = {};
    Object.keys(A.ICONS).filter((k) => k.indexOf(slot + '-') === 0).forEach((k) => {
      const sig = JSON.stringify(A.ICONS[k]).split(slot + '-').join('');   // id 前缀不算差别
      assert.ok(!seen[sig], k + ' 与 ' + seen[sig] + ' 是同一张图');
      seen[sig] = k;
    });
  });
  // 跨槽同名的那几支（旋转）本来就是同一张图——不当差异要求
  assert.strictEqual(JSON.stringify(A.ICONS['in-spin']).replace(/in-/g, ''),
    JSON.stringify(A.ICONS['loop-spin']).replace(/loop-/g, ''));
});

test('渐变与裁剪的 id 都带上了自己的前缀，同一页里不会撞名', () => {
  const ids = [];
  const walk = (n) => {
    if (n.a && n.a.id) ids.push(n.a.id);
    (n.c || []).forEach(walk);
  };
  Object.keys(A.ICONS).forEach((k) => A.ICONS[k].forEach(walk));
  ids.forEach((i) => assert.match(i, /^anim-/));
  assert.strictEqual(new Set(ids).size, ids.length, 'id 撞名');
});

test('引用的 url(#…) 都指向本图里声明过的 id', () => {
  Object.keys(A.ICONS).forEach((k) => {
    const ids = [];
    const refs = [];
    const walk = (n) => {
      if (n.a && n.a.id) ids.push(n.a.id);
      Object.keys(n.a || {}).forEach((p) => {
        const v = n.a[p];
        if (typeof v === 'string') {
          const m = v.match(/url\(#([^)]+)\)/);
          if (m) refs.push(m[1]);
        }
      });
      (n.c || []).forEach(walk);
    };
    A.ICONS[k].forEach(walk);
    refs.forEach((r) => assert.ok(ids.indexOf(r) >= 0, k + ' 引到了不存在的 ' + r));
  });
});
