/* model-textpresets.js —— 把「这一份是从核心那 51 个文件搬来的」钉住。
   数不是随手写的：simple 13 / title 10 / lowerThird 20 / other 8 = 51，与
   core/presets/builtin/textpreset/*.json 的文件数一致；动画目录是文字专用的
   那三张表（In 19 / Out 16 / Loop 9）。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-textpresets.js');
const TP = window.BC_TP;

test('51 条预设，四类的条数与核心的文件数逐类对上', () => {
  assert.strictEqual(TP.PRESETS.length, 51);
  const n = (c) => TP.byCat(c).length;
  assert.strictEqual(n('simple'), 13);
  assert.strictEqual(n('title'), 10);
  assert.strictEqual(n('lower'), 20);
  assert.strictEqual(n('other'), 8);
  assert.strictEqual(TP.byCat('all').length, 51);
});

test('id 就是核心那份的 id（不另起一套编号）', () => {
  assert.ok(TP.get('simple.01'));
  assert.ok(TP.get('lowerThird.20'));
  assert.ok(TP.get('other.08'));
  assert.strictEqual(new Set(TP.PRESETS.map((p) => p.id)).size, 51);
});

test('每一条都有可画的内容、时长与包围盒', () => {
  TP.PRESETS.forEach((p) => {
    assert.ok(p.els.length >= 1, p.id + ' 没有内容');
    assert.strictEqual(p.n, p.els.length, p.id + ' 的角标数与件数不一致');
    assert.ok(p.dur > 0, p.id + ' 没有时长');
    assert.ok(p.box && p.box.w > 0 && p.box.h > 0, p.id + ' 没有包围盒');
    p.els.forEach((e, i) => {
      assert.ok(e.x != null && e.y != null, p.id + ' 第 ' + i + ' 件没有落位');
      if (e.k === 'text') assert.ok(String(e.t).length > 0, p.id + ' 第 ' + i + ' 件没有文案');
      else assert.ok(e.w > 0 && e.h > 0, p.id + ' 第 ' + i + ' 件形状没有尺寸');
    });
  });
});

test('包围盒真的框住了所有成员', () => {
  TP.PRESETS.forEach((p) => {
    const b = p.box;
    p.els.forEach((e) => {
      assert.ok(e.x >= b.x - b.w / 2 - 0.01 && e.x <= b.x + b.w / 2 + 0.01, p.id + ' 有成员在盒外');
      assert.ok(e.y >= b.y - b.h / 2 - 0.01 && e.y <= b.y + b.h / 2 + 0.01, p.id + ' 有成员在盒外');
    });
  });
});

test('`anim` 角标与实际带没带动画一致', () => {
  TP.PRESETS.forEach((p) => {
    const has = p.els.some((e) => e.a && Object.keys(e.a).some((s) => e.a[s][0] !== 'none'));
    assert.strictEqual(p.anim, has, p.id + ' 的动画角标不对');
  });
});

test('字样卡才有预览字号 pv，场景卡没有', () => {
  TP.PRESETS.filter((p) => p.lay === 'stack')
    .forEach((p) => assert.ok(p.els.every((e) => e.k !== 'text' || e.pv), p.id + ' 缺预览字号 pv'));
  assert.strictEqual(TP.PRESETS.filter((p) => p.lay === 'stack').length, 26);
  assert.strictEqual(TP.PRESETS.filter((p) => p.lay === 'scene').length, 25);
});

test('动画目录是文字专用的三张表：In 19 / Out 16 / Loop 9', () => {
  assert.strictEqual(TP.ANIMS.in.length, 19);
  assert.strictEqual(TP.ANIMS.out.length, 16);
  assert.strictEqual(TP.ANIMS.loop.length, 9);
  ['in', 'out', 'loop'].forEach((s) => {
    assert.strictEqual(TP.ANIMS[s][0].k, 'none', s + ' 的第一格恒是「无」');
    assert.strictEqual(new Set(TP.ANIMS[s].map((a) => a.k)).size, TP.ANIMS[s].length, s + ' 有重键');
  });
  // 方向只有 slide 一条带
  ['in', 'out'].forEach((s) => {
    const withDir = TP.ANIMS[s].filter((a) => a.dirs);
    assert.deepStrictEqual(withDir.map((a) => a.k), ['slide']);
  });
  assert.ok(TP.ANIMS.loop.every((a) => !a.dirs), 'Loop 一律无方向');
});

test('核心标记逐格都有，且只落在核心 registry 真有的配方上（enter 25 / exit 21 / loop 11，第 156 轮）', () => {
  const ENTER = ['none', 'fade', 'rise', 'drop', 'slideL', 'slideR', 'slideUp', 'slideDown', 'pop',
                 'zoomIn', 'zoomOut', 'spin', 'blurIn', 'typewriter', 'riseWords', 'wipe', 'compress',
                 'bounce', 'fall', 'skid', 'roll', 'wave', 'flipboard', 'dragonfly', 'billboard'];
  const EXIT = ['none', 'fade', 'sink', 'rise', 'slideL', 'slideR', 'slideUp', 'slideDown', 'shrink',
                'zoomIn', 'zoomOut', 'spin', 'wipe', 'compress', 'fall', 'skid', 'roll', 'drop',
                'flipboard', 'dragonfly', 'billboard'];
  const LOOP = ['float', 'pulse', 'sway', 'jitter', 'blink', 'rotate', 'heartBeat', 'vogue',
                'dragonfly', 'billboard', 'roll', 'none'];
  assert.strictEqual(ENTER.length, 25); assert.strictEqual(EXIT.length, 21); assert.strictEqual(LOOP.length, 12);
  const check = (slot, list) => TP.ANIMS[slot].forEach((a) => {
    assert.ok(a.core, slot + '/' + a.k + ' 没有核心配方');
    assert.ok(list.indexOf(a.core) >= 0, a.k + ' → ' + a.core);
  });
  check('in', ENTER); check('out', EXIT); check('loop', LOOP);
  // 核心名 → 目录格 与 目录格 → 核心名 互为反函数（方向变体折回 slide）
  ['in', 'out', 'loop'].forEach((s) => TP.ANIMS[s].forEach((a) => {
    assert.strictEqual(TP.animOf({a: {[s]: [a.core, 0.6]}})[s].k, a.k, s + '/' + a.core + ' 折不回 ' + a.k);
  }));
  assert.deepStrictEqual(TP.animOf({a: {in: ['slideUp', 0.5]}}).in, {k: 'slide', dir: 'up', dur: 0.5});
  assert.deepStrictEqual(TP.animOf({a: {out: ['slideDown', 0.4]}}).out, {k: 'slide', dir: 'down', dur: 0.4});
  assert.deepStrictEqual(TP.DIR4.map((d) => d.label), ['左', '右', '上', '下'], '方向词是裸的「侧」');
});

test('预设里写的核心动画名，一条不落地折回目录里的某一格', () => {
  TP.PRESETS.forEach((p) => p.els.forEach((e) => {
    const a = e.a || {};
    ['in', 'out', 'loop'].forEach((slot) => {
      if (!a[slot]) return;
      const k = TP.FROM_CORE[a[slot][0]];
      assert.ok(k, p.id + ' 的 ' + a[slot][0] + ' 没有对照');
      assert.ok(TP.ANIMS[slot].some((x) => x.k === k), p.id + ' 的 ' + k + ' 不在 ' + slot + ' 目录里');
    });
  }));
});

test('样式袋来回一趟不丢东西', () => {
  const e = TP.get('lowerThird.06').els[1];      // 带底色的那条
  const st = TP.toStyle(e);
  const back = TP.fromStyle(st);
  assert.strictEqual(back.color, e.color);
  assert.strictEqual(back.size, e.size);
  assert.deepStrictEqual(back.bg, e.bg, '底色是画面内容的一部分，不能在转一圈之后掉了');
  assert.strictEqual(back.b, !!e.b);
});

test('字号换算落到舞台单位：与画布默认字号同一量级', () => {
  const head = TP.get('title.07').els[0];        // 「写一句标题」那张
  assert.ok(head.size > 35 && head.size < 55, '整屏标题应当和 canvasStyle.size(44) 同量级');
  const css = TP.textCss(head, 1);
  assert.strictEqual(css.fontSize, head.size);
  assert.strictEqual(TP.textCss(head, 0.5).fontSize, head.size / 2, 'k 是唯一的缩放入口');
});

test('空心字用 transparent，不用 opacity（否则描边一起没了）', () => {
  const e = TP.get('other.08').els[0];
  assert.strictEqual(e.alpha, 0);
  const css = TP.textCss(e, 1);
  assert.strictEqual(css.color, 'transparent');
  assert.strictEqual(css.opacity, null);
  assert.ok(/px #/.test(css.WebkitTextStroke), '描边要留着');
});

test('每一款字体都有能画中文的字体栈', () => {
  const fams = new Set();
  TP.PRESETS.forEach((p) => p.els.forEach((e) => { if (e.font) fams.add(e.font); }));
  fams.forEach((f) => {
    assert.ok(TP.FONTS[f], f + ' 没有登记类别');
    assert.ok(/PingFang|Songti|Kaiti|Yuanti|Sarasa|Heiti/.test(TP.fontStack(f)), f + ' 的栈里没有中文字面');
  });
});
