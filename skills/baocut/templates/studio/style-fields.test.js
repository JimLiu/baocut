const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./style-fields.js');
const R = require('./subtitle-rendering.js');

test('ctxMeta 按上下文给标题，未知 ctx 回落字幕样式', () => {
  // Mac StylePaneView.refresh：Subtitle style / Translation style
  assert.equal(F.ctxMeta('sub').title, '字幕样式');
  assert.equal(F.ctxMeta('bi').title, '译文样式');
  assert.equal(F.ctxMeta('title').title, '字幕样式');
});

test('clampTarget 与 Mac SubtitleStyleContexts.clampTarget 同一套钳制', () => {
  // 非双语上下文只有原文一行，面板没有目标选择（Mac selectableTargets 不含 .both）
  assert.equal(F.clampTarget('sub', 'bi', 'trans'), 'orig');
  assert.equal(F.clampTarget('sub', 'bi', null), 'orig');
  // 双语：选中哪一行就写哪一行，没选行 = both
  assert.equal(F.clampTarget('bi', 'bi', 'orig'), 'orig');
  assert.equal(F.clampTarget('bi', 'bi', 'trans'), 'trans');
  assert.equal(F.clampTarget('bi', 'bi', null), 'both');
  // both 在双语上下文里永远可选：「仅译文」少了它，显示模式就没地方回去了
  assert.equal(F.clampTarget('bi', 'trans', null), 'both');
  assert.equal(F.clampTarget('bi', 'orig', null), 'both');
  // 选中的行不在画面上 → 退回默认目标（只剩一行时就是那一行）
  assert.equal(F.clampTarget('bi', 'trans', 'orig'), 'trans');
  assert.equal(F.clampTarget('bi', 'orig', 'trans'), 'orig');
});

test('lineKey / lineView 与内核的行级 partial 解释同构', () => {
  assert.equal(F.lineKey('trans'), 'transStyle');
  assert.equal(F.lineKey('orig'), 'origStyle');
  const st = {
    fontColor: '#FFFFFF', fontSize: 30, backgroundColor: '#000000B3',
    transStyle: { fontColor: '#FFD43B' },
  };
  // 面板显示的行样式 = 内核 layoutMetrics 交给画布的那一份
  const view = F.lineView(st, 'trans');
  assert.equal(view.fontColor, '#FFD43B');
  assert.equal(view.backgroundColor, '#000000B3');
  assert.deepEqual(view, R.layoutMetrics(st, 1920, 1080, true, false).lineStyle);
  // 没有 partial 的行直接看根样式；both / 未知目标同理
  assert.equal(F.lineView(st, 'orig'), st);
  assert.equal(F.lineView(st, 'both'), st);
});

test('linePatch 落进行级 partial 而不是根，且保留该行已有的键', () => {
  const st = { fontColor: '#FFFFFF', transStyle: { fontColor: '#FFD43B', x: 40, y: 70 } };
  const patch = F.linePatch(st, 'trans', { bold: true });
  assert.deepEqual(patch, { transStyle: { fontColor: '#FFD43B', x: 40, y: 70, bold: true } });
  // 写译文不能碰到原文：合并后原文行的解析结果不变
  const next = { ...st, ...patch };
  assert.equal(R.layoutMetrics(next, 1920, 1080, false, false).lineStyle.bold, undefined);
  assert.equal(R.layoutMetrics(next, 1920, 1080, true, false).lineStyle.bold, true);
  // both / 单语上下文照旧写根
  assert.deepEqual(F.linePatch(st, 'both', { bold: true }), { bold: true });
});

test('发光开关派生与内核 effectStyle 同源，全零打开时补种子值', () => {
  assert.equal(F.glowOn({}), false);
  assert.equal(F.glowOn({ glow: { intensity: 30 } }), true);
  assert.equal(F.glowOn({ glow: { on: false, intensity: 30 } }), false);
  const flat = { glow: { on: false, intensity: 0 } };
  const on = F.glowToggle(flat, true);
  assert.equal(on.glow.intensity, F.DEF.glow.intensity);
  assert.equal(R.effectStyle({ ...flat, ...on }).glowOn, true);
  const off = F.glowToggle({ glow: { on: true, intensity: 70 } }, false);
  assert.equal(off.glow.intensity, 70, '关掉要留住数值');
  assert.equal(R.effectStyle(off).glowOn, false);
  assert.equal(F.glowPatch({ glow: { on: false } }, { range: 80 }).glow.on, true);
  assert.ok(F.GLOW_COLORS.includes(F.DEF.glow.color));
});

test('逐词强调色：读默认配方、写回时带上 animationName 与对比文字色', () => {
  F.WORD_ANIMATIONS.forEach((wa) => {
    const bindings = F.ACCENTS[wa.value] || [];
    const anim = R.normalizeWordAnimation({ wordAnimation: { animationName: wa.value } });
    bindings.forEach((binding) => {
      // 面板读到的初值就是内核配方给的那个颜色
      const path = binding.key.split('.');
      assert.equal(F.accentColor(anim, binding), anim[path[0]][path[1]]);
      const patch = F.accentPatch(anim, binding, '#18E1D6');
      assert.equal(patch.wordAnimation.animationName, wa.value);
      const resolved = R.normalizeWordAnimation({ wordAnimation: patch.wordAnimation });
      assert.equal(resolved[path[0]][path[1]], '#18E1D6');
      if (binding.contrast) {
        const c = binding.contrast.split('.');
        assert.equal(resolved[c[0]][c[1]], F.contrastOn('#18E1D6'), '强调底要配对比文字色');
        assert.equal(F.accentPatch(anim, binding, '#101820').wordAnimation[c[0]][c[1]],
          '#FFFFFF', '深色强调底要配浅色文字');
      }
    });
  });
  assert.equal(F.contrastOn('#FFD43B'), '#0D0D0D');
  assert.equal(F.contrastOn('#000000'), '#FFFFFF');
});

test('入场动画 id 与逐词动画名都在内核认识的集合里', () => {
  F.TRANSITIONS.forEach((tr) => {
    const style = { transition: { transitionId: tr.id, transitionSpeed: 50 } };
    assert.equal(R.transitionConfig(style).id, tr.id);
    if (tr.id !== 'none') assert.ok(R.transitionDuration(style) > 0, tr.id + ' 应该有时长');
  });
  F.WORD_ANIMATIONS.forEach((wa) => {
    const resolved = R.normalizeWordAnimation({ wordAnimation: { animationName: wa.value } });
    assert.equal(resolved.animationName, wa.value);
  });
});

test('withAlpha 保留 RGB 只换 alpha，输出 #RRGGBBAA', () => {
  assert.equal(F.withAlpha('#000000B3', 1), '#000000FF');
  assert.equal(F.withAlpha('#3B63F3', 0.5), '#3B63F380');
  assert.equal(F.withAlpha('rgba(255,0,0,0.2)', 0), '#FF000000');
  // 越界/非法输入不产生野颜色
  assert.equal(F.withAlpha('nope', 0.5), '#00000080');
  assert.equal(F.withAlpha('#FFFFFF', 5), '#FFFFFFFF');
});

test('alphaOf 与内核 parseColor 对同一批颜色给同样的 alpha', () => {
  ['#000000B3', '#FFFFFF', 'rgba(0,0,0,0.35)', 'transparent', '#0008'].forEach((color) => {
    const mine = F.alphaOf(color);
    const theirs = R.parseColor(color).a;
    assert.ok(Math.abs(mine - theirs) < 0.005, color + '：' + mine + ' vs ' + theirs);
  });
});

test('withRgb 换色时留住原有不透明度，色板自带 alpha 时按色板的来', () => {
  assert.equal(F.withRgb('#000000B3', '#3B63F3'), '#3B63F3B3');
  assert.equal(F.withRgb('#000000B3', '#FFFFFFCC'), '#FFFFFFCC');
});

test('底板开关派生：显式布尔优先，缺席时看颜色 alpha', () => {
  assert.equal(F.backgroundOn({ background: false, backgroundColor: '#000000B3' }), false);
  assert.equal(F.backgroundOn({ backgroundColor: '#000000B3' }), true);
  assert.equal(F.backgroundOn({ backgroundColor: 'transparent' }), false);
  assert.equal(F.backgroundOn({}), false);
});

test('底板从全透明打开时连默认底板一起铺进去', () => {
  assert.deepEqual(F.backgroundToggle({ backgroundColor: 'transparent' }, true),
    { background: true, ...F.DEF.background });
  assert.deepEqual(F.backgroundToggle({ backgroundColor: '#000000B3' }, true), { background: true });
  assert.deepEqual(F.backgroundToggle({ backgroundColor: '#000000B3' }, false), { background: false });
});

test('描边开关同时写 outline 与 textOutline.on —— 只写布尔时内核不动', () => {
  const st = { outline: true, textOutline: { on: true, color: '#000000', width: 14 } };
  const off = F.outlineToggle(st, false);
  assert.equal(off.outline, false);
  assert.equal(off.textOutline.on, false);
  // 内核判据（effectStyle）必须跟着关掉，这正是历史 bug 的护栏
  assert.equal(R.effectStyle({ ...st, ...off }).outlineOn, false);
  assert.equal(R.effectStyle({ ...st, outline: false }).outlineOn, true, '只写布尔应当无效');
  const on = F.outlineToggle({ ...st, ...off }, true);
  assert.equal(R.effectStyle({ ...st, ...off, ...on }).outlineOn, true);
});

test('描边从零宽打开时补上默认粗细与颜色', () => {
  const patch = F.outlineToggle({ textOutline: { on: false, width: 0, color: 'transparent' } }, true);
  assert.equal(patch.textOutline.width, F.DEF.outline.width);
  assert.equal(patch.textOutline.color, F.DEF.outline.color);
  assert.equal(F.outlinePatch({ textOutline: { on: false, width: 3 } }, { width: 8 }).textOutline.on, true);
});

test('描边开关派生：textOutline.on 优先于布尔 outline，都缺席时看宽度', () => {
  assert.equal(F.outlineOn({ outline: true, textOutline: { on: false, width: 14 } }), false);
  assert.equal(F.outlineOn({ outline: false, textOutline: { on: true, width: 14 } }), true);
  assert.equal(F.outlineOn({ outline: true }), true);
  assert.equal(F.outlineOn({ textOutline: { width: 14, color: '#000000' } }), true);
  assert.equal(F.outlineOn({ textOutline: { width: 0 } }), false);
  assert.equal(F.outlineOn({}), false);
});

test('阴影开关：全零时打开要补种子值，关掉保留数值', () => {
  const flat = { dropShadow: { on: false, blur: 0, distance: 0, color: '#000000' } };
  const on = F.shadowToggle(flat, true);
  assert.equal(on.dropShadow.blur, F.DEF.shadow.blur);
  assert.equal(R.effectStyle({ ...flat, ...on }).shadowOn, true);
  const kept = F.shadowToggle({ dropShadow: { on: true, blur: 0.3, distance: 0.1 } }, false);
  assert.deepEqual(kept.dropShadow, { on: false, blur: 0.3, distance: 0.1 });
  assert.equal(F.shadowOn(kept), false);
  assert.equal(F.shadowOn({ dropShadow: { blur: 0.1 } }), true);
  assert.equal(F.shadowOn({}), false);
  assert.equal(F.shadowPatch({ dropShadow: { on: false } }, { opacity: 0.5 }).dropShadow.on, true);
});

test('shadowOpacity 镜像内核的默认值（描边开着 0.48，否则 0.6）', () => {
  assert.equal(F.shadowOpacity({ dropShadow: { opacity: 0.25 } }), 0.25);
  assert.equal(F.shadowOpacity({ outline: true }), 0.48);
  assert.equal(F.shadowOpacity({}), 0.6);
  // 与 effectStyle 合成出来的 rgba 对得上（面板显示 = 画面用的那个 alpha）
  const style = { outline: true, dropShadow: { on: true, blur: 0.1, color: '#000000' } };
  const composed = R.parseColor(R.effectStyle(style).shadowColor).a;
  assert.ok(Math.abs(composed - F.shadowOpacity(style)) < 0.005);
});

test('INK_COLORS 含纯黑 —— 描边/阴影的默认色必须能在色板上被选中', () => {
  assert.ok(F.INK_COLORS.includes(F.DEF.outline.color));
  assert.ok(F.INK_COLORS.includes(F.DEF.shadow.color));
});

test('blockAlign 只认三个字面量，其余按 center', () => {
  assert.equal(F.blockAlign({ verticalAlign: 'top' }), 'top');
  assert.equal(F.blockAlign({ verticalAlign: 'bottom' }), 'bottom');
  assert.equal(F.blockAlign({ verticalAlign: 'Bottom' }), 'center');
  assert.equal(F.blockAlign({}), 'center');
  assert.equal(F.blockAlign(null), 'center');
});
