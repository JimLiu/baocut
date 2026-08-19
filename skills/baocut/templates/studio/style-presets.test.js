const test = require('node:test');
const assert = require('node:assert/strict');
const SP = require('./style-presets.js');
const R = require('./subtitle-rendering.js');

// Mac SampleData.presets 的 id 与分组（apps/mac/.../SampleStyleDataAdapter.swift）。
// 这份清单是"两端同一批预设"的护栏：Mac 加一档而 Studio 不加，用户在两边看到的
// 预设墙就不一样了。
const MAC_PRESETS = [
  ['DEFAULT_PRESET', '精选'], ['DARK_OUTLINE', '精选'], ['HIGHLIGHTER', '精选'], ['SPOKEN', '精选'],
  ['HEADLINE', '粗体'], ['PRIME', '粗体'], ['SWIFT', '粗体'], ['CHILL', '粗体'],
  ['FOCUS', '粗体'], ['ELECTRIC', '粗体'],
  ['CLASSIC_PRESET', '简洁'], ['LIGHT_MODE', '简洁'], ['DARK_MODE', '简洁'],
  ['DARK_LOFI', '简洁'], ['SERIF', '简洁'], ['MONOSPACE', '简洁'],
  ['BUBBLY', '趣味'], ['ZAP', '趣味'], ['COMIC_PRESET', '趣味'], ['GRAFITTI_PRESET', '趣味'],
  ['BUBBLE_GUM_PRESET', '趣味'], ['HANDWRITING_PRESET', '趣味'],
  ['STRONG_PRESET', '复古'], ['MEME_TEXT_PRESET', '复古'], ['TYPEWRITER_PRESET', '复古'],
  ['ARCADE', '复古'], ['CONSOLE_PRESET', '复古'],
];

test('预设表与 Mac SampleData.presets 同 id、同顺序、同分组', () => {
  assert.deepEqual(SP.PRESETS.map((p) => [p.id, p.group]), MAC_PRESETS);
  assert.deepEqual(SP.groups().map((g) => g.name), ['精选', '粗体', '简洁', '趣味', '复古']);
  assert.equal(SP.groups().reduce((n, g) => n + g.presets.length, 0), SP.PRESETS.length);
});

test('每个预设都写全"会变的字段"，换预设不会留下上一套的残留', () => {
  const keys = Object.keys(SP.BASE);
  SP.PRESETS.forEach((p) => {
    assert.equal(typeof p.name, 'string');
    assert.ok(p.name.length, p.id + ' 缺少名字');
    keys.forEach((key) => {
      assert.ok(Object.prototype.hasOwnProperty.call(p.style, key),
        p.id + ' 缺少字段 ' + key);
    });
  });
});

test('预设里的字体都能被字体目录解析出真实字体栈', () => {
  // font-catalog.js 是 Mac fontLibrary 的孪生；预设引用了目录以外的家族就等于
  // 在浏览器里回落成系统字体，两端外观直接分叉。
  const source = require('node:fs').readFileSync(require.resolve('./font-catalog.js'), 'utf8');
  const families = new Set(Array.from(source.matchAll(/\{ family: '([^']+)'/g), (m) => m[1]));
  SP.PRESETS.forEach((p) => {
    assert.ok(families.has(p.style.fontFamily), p.id + ' 的字体不在目录里：' + p.style.fontFamily);
  });
});

test('预设的开关字段与内核解析一致（勾着就画得出来）', () => {
  SP.PRESETS.forEach((p) => {
    const fx = R.effectStyle(p.style);
    assert.equal(fx.outlineOn, !!p.style.outline, p.id + ' 描边开关与内核不一致');
    const metrics = R.layoutMetrics(p.style, 1920, 1080, false, false);
    assert.equal(metrics.backgroundOn, !!p.style.background, p.id + ' 底板开关与内核不一致');
    // 逐词动画名必须是内核认识的配方
    const resolved = R.normalizeWordAnimation(p.style);
    assert.equal(resolved.animationName, p.style.wordAnimation.animationName, p.id);
    // 入场 id 必须是内核认识的过渡
    assert.equal(R.transitionConfig(p.style).id, p.style.transition.transitionId, p.id);
  });
});

test('byId 命中新 id、旧 id 走兼容映射、未知给 null', () => {
  assert.equal(SP.byId('HEADLINE').name, '大标题');
  assert.equal(SP.byId('impact').id, 'HEADLINE', '旧 id 要映射到最接近的一档');
  // CLI default_style() 至今写的是 "classic"，它必须仍然点亮「默认」
  assert.equal(SP.byId('classic').id, 'DEFAULT_PRESET');
  assert.equal(SP.byId('nope'), null);
});

test('labelFor / selectedId：命中预设名 / 手改后自定义 / 无样式给默认', () => {
  assert.equal(SP.labelFor({ preset: 'DARK_MODE' }), '深色模式');
  assert.equal(SP.labelFor({ preset: 'boxed' }), '深色模式');
  assert.equal(SP.labelFor({ preset: 'gone' }), '自定义');
  assert.equal(SP.labelFor({}), '自定义');
  assert.equal(SP.labelFor(null), '默认');
  assert.equal(SP.selectedId({ preset: 'classic' }), 'DEFAULT_PRESET');
  assert.equal(SP.selectedId({ preset: 'gone' }), null);
  assert.equal(SP.selectedId(null), null);
});
