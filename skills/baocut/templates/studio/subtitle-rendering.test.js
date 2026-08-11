const test = require('node:test');
const assert = require('node:assert/strict');

const subtitle = require('./subtitle-rendering.js');
const contract = require('./subtitle-render-contract.json');

test('shared Rust/preview subtitle contract fixtures stay stable', () => {
  for (const row of contract.displayWindows) {
    const actual = subtitle.displayWindow(row.items, row.index);
    assert.ok(Math.abs(actual.start - row.expected.start) < 1e-9);
    assert.ok(Math.abs(actual.end - row.expected.end) < 1e-9);
  }
  for (const row of contract.modes) {
    assert.deepEqual(subtitle.resolveModeLines(row.mode, row.order), row.expected);
  }
  for (const row of contract.punctuationProjections) {
    assert.equal(
      subtitle.projectPunctuation(row.text, row.language, row.enabled),
      row.expected,
    );
  }
  for (const row of contract.wordAnimations) {
    const animation = subtitle.normalizeWordAnimation({
      wordAnimation: { animationName: row.name },
    });
    assert.deepEqual(subtitle.wordState(animation, row.index, row.current), row.expected);
  }
  for (const row of contract.transitions) {
    const style = { transition: { transitionId: row.id, transitionSpeed: row.speed } };
    assert.deepEqual(
      subtitle.transitionPose(style, row.displayStart, row.time, row.scale, row.fps),
      row.expected,
    );
  }
  for (const row of contract.lineFontSizes) {
    const metrics = subtitle.layoutMetrics(
      row.style, row.frame.width, row.frame.height, row.line === 'trans', row.compactOriginal,
    );
    assert.ok(Math.abs(metrics.fontSize - row.expected) < 1e-9, row.name);
  }
});

test('Canvas scale and frame fit use the 540 px short-edge contract', () => {
  assert.equal(subtitle.referenceScale(960, 540), 1);
  assert.equal(subtitle.referenceScale(1080, 1920), 2);
  assert.deepEqual(
    subtitle.fitFrame(800, 500, 16 / 9),
    { width: 800, height: 450, aspectRatio: 16 / 9, scale: 5 / 6 },
  );
  const portrait = subtitle.fitFrame(800, 500, 9 / 16);
  assert.equal(portrait.height, 500);
  assert.equal(portrait.width, 281.25);
  assert.equal(portrait.scale, 281.25 / 540);
});

test('display timing splits short gaps without blanks or overlap', () => {
  const cues = [
    { id: 'a', start: 1, end: 2 },
    { id: 'b', start: 2.3, end: 3 },
  ];
  assert.ok(Math.abs(subtitle.displayWindow(cues, 0).end - 2.2) < 1e-9);
  assert.ok(Math.abs(subtitle.displayWindow(cues, 1).start - 2.2) < 1e-9);
  assert.equal(subtitle.activeTimedItem(cues, 2.199).item.id, 'a');
  assert.equal(subtitle.activeTimedItem(cues, 2.2).item.id, 'b');
  assert.equal(subtitle.activeTimedItem(cues, 0.499), null);
  const durations = subtitle.displayDurations(cues);
  assert.ok(Math.abs(durations[0] - 1.7) < 1e-9);
  assert.ok(Math.abs(durations[1] - 1.8) < 1e-9);
});

test('long gaps receive the full 0.5 second lead-in and 1 second tail', () => {
  const cues = [
    { id: 'a', start: 2, end: 3 },
    { id: 'b', start: 6, end: 7 },
  ];
  assert.deepEqual(subtitle.displayWindow(cues, 0), { start: 1.5, end: 4 });
  assert.deepEqual(subtitle.displayWindow(cues, 1), { start: 5.5, end: 8 });
  assert.equal(subtitle.activeTimedItem(cues, 4.5), null);
});

test('Translate preview shows the complete aligned source span independent of source cues', () => {
  const fallback = {
    id: 'subtitle-q2', text: 'agentic engineering allows us to shift', start: 10, end: 12,
    words: [
      { id: 'w0', text: 'us', t0: 10, t1: 10.5 },
      { id: 'w1', text: 'to', t0: 10.5, t1: 11 },
      { id: 'w2', text: 'shift', t0: 11, t1: 12 },
    ],
  };
  const cue = subtitle.translationSourceCue({
    id: 's1#1',
    sourceText: 'to shift away from deterministic logic',
    sourceWords: [
      { id: 'w1', text: 'to', start: 127, end: 128 },
      { id: 'w2', text: 'shift', start: 128, end: 129 },
      { id: 'w3', text: 'away', start: 129, end: 130 },
      { id: 'w4', text: 'from deterministic logic', start: 130, end: 131 },
    ],
    sourceStart: 127,
    sourceEnd: 131,
    start: 20,
    end: 22,
  }, fallback, 'en');

  assert.equal(cue.text, 'to shift away from deterministic logic');
  assert.notEqual(cue.text, fallback.text);
  assert.equal(cue.start, 20);
  assert.equal(cue.end, 22);
  assert.deepEqual(
    cue.words.map(({ text, t0, t1 }) => ({ text, t0, t1 })),
    [
      { text: 'to', t0: 20, t1: 20.5 },
      { text: 'shift', t0: 20.5, t1: 21 },
      { text: 'away', t0: 21, t1: 21.5 },
      { text: 'from deterministic logic', t0: 21.5, t1: 22 },
    ],
  );
});

test('Translate preview ignores a non-overlapping active source cue', () => {
  const cue = subtitle.translationSourceCue({
    id: 'translation', sourceText: 'to shift', start: 1, end: 2,
    sourceWords: [{ id: 'w2', text: 'shift', start: 1, end: 2 }],
  }, {
    id: 'subtitle', text: 'next cue', start: 2, end: 3,
    words: [{ id: 'w3', text: 'next', t0: 2, t1: 3 }],
  }, 'en');
  assert.equal(cue.text, 'to shift');
  assert.equal(cue.start, 1);
  assert.equal(cue.end, 2);
});

test('Translate preview keeps the Subtitle cue only when no aligned source exists', () => {
  const fallback = { id: 'subtitle-q1', text: 'fallback', start: 1, end: 2 };
  assert.equal(subtitle.translationSourceCue(null, fallback), fallback);
  assert.equal(subtitle.translationSourceCue({ id: 'translation', text: '译文' }, fallback), fallback);
  assert.equal(subtitle.translationSourceCue({
    id: 'sentence', sourceText: 'whole sentence', text: '整句', start: 1, end: 4,
  }, fallback), fallback);
});

test('long aligned source spans wrap visually without changing their word coverage', () => {
  const examples = [
    "It seems like each advancement we've had in the complexity of the way we write code to interact with these models",
    "so the humans don't get distracted paying attention to that in reviews, stuff like that.",
  ];
  for (const text of examples) {
    const words = text.split(/\s+/).map((value, index) => ({ id: `w${index}`, text: value }));
    const lines = subtitle.sourceDisplayLines(words, 'en', 42);
    assert.ok(lines.length > 1);
    assert.ok(lines.every((line) => Array.from(line.text).length <= 42));
    assert.deepEqual(lines.flatMap((line) => line.words.map((word) => word.id)), words.map((word) => word.id));
    assert.equal(lines.map((line) => line.text).join(' '), text);
  }
  assert.deepEqual(
    subtitle.sourceDisplayLines('Which means when I find a need', 'en', 42).map((line) => line.text),
    ['Which means when I find a need'],
  );
});

test('a translation piece shows one source part per source cue it covers', () => {
  const cues = [
    { id: 'q-a', words: [{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }] },
    { id: 'q-b', words: [{ id: 'w3' }, { id: 'w4' }] },
    { id: 'q-c', words: [{ id: 'w5' }] },
  ];
  const words = ['Production', 'deployments', 'have', 'seen', 'fifty', 'percent']
    .map((text, index) => ({ id: `w${index}`, text, start: index, end: index + 1 }));
  const parts = subtitle.sourceCueParts({ sourceWords: words }, cues, 'en', 42);
  assert.deepEqual(parts.map((part) => part.cueId), ['q-a', 'q-b', 'q-c']);
  assert.deepEqual(parts.map((part) => part.text), [
    'Production deployments have', 'seen fifty', 'percent',
  ]);
  assert.deepEqual(parts.map((part) => [part.start, part.end]), [[0, 3], [3, 5], [5, 6]]);
  // 顺序拼接不变量：子行覆盖的词与片源词逐个相等，一个都不能丢
  assert.deepEqual(
    parts.flatMap((part) => part.lines.flatMap((line) => line.words.map((word) => word.id))),
    words.map((word) => word.id),
  );
});

test('an over-wide source part still wraps by width inside its own cue group', () => {
  const long = "It seems like each advancement we've had in the complexity of the way we write code"
    .split(/\s+/);
  const cues = [
    { id: 'q-a', words: long.map((_, index) => ({ id: `w${index}` })) },
    { id: 'q-b', words: [{ id: 'tail' }] },
  ];
  const words = long.map((text, index) => ({ id: `w${index}`, text, start: index, end: index + 1 }))
    .concat([{ id: 'tail', text: 'here.', start: 99, end: 100 }]);
  const parts = subtitle.sourceCueParts({ sourceWords: words }, cues, 'en', 42);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].lines.length > 1);
  assert.ok(parts[0].lines.every((line) => Array.from(line.text).length <= 42));
  assert.deepEqual(parts[1].lines.map((line) => line.text), ['here.']);
});

test('source grouping degrades to plain width wrapping when cue words are missing', () => {
  const words = 'so the humans do not get distracted paying attention to that in reviews and stuff'
    .split(/\s+/).map((text, index) => ({ id: `w${index}`, text, start: index, end: index + 1 }));
  const piece = { sourceWords: words, sourceText: words.map((w) => w.text).join(' ') };
  const flat = subtitle.sourceDisplayLines(words, 'en', 42);
  for (const cues of [null, undefined, [], [{ id: 'q-a' }], [{ id: 'q-a', words: [] }]]) {
    const parts = subtitle.sourceCueParts(piece, cues, 'en', 42);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].cueId, null);
    assert.deepEqual(parts[0].lines.map((line) => line.text), flat.map((line) => line.text));
  }
  // 词落在没有 words[] 的 cue（本地编辑过）上时并入上一组，绝不丢词
  const partial = subtitle.sourceCueParts(piece, [{ id: 'q-a', words: [{ id: 'w0' }, { id: 'w1' }] }], 'en', 42);
  assert.deepEqual(
    partial.flatMap((part) => part.words.map((word) => word.id)),
    words.map((word) => word.id),
  );
  assert.equal(partial.length, 1);
});

test('a piece without source words falls back to its source text, and an empty piece to nothing', () => {
  const parts = subtitle.sourceCueParts(
    { sourceText: 'Which means when I find a need', sourceStart: 2, sourceEnd: 5 },
    [{ id: 'q-a', words: [{ id: 'w0' }] }], 'en', 42,
  );
  assert.deepEqual(parts.map((part) => part.text), ['Which means when I find a need']);
  assert.deepEqual([parts[0].start, parts[0].end], [2, 5]);
  assert.deepEqual(subtitle.sourceCueParts({}, [], 'en', 42), []);
  assert.deepEqual(subtitle.sourceCueParts(null, null, 'en', 42), []);
});

test('font metrics preserve standalone and bilingual VoiceInk sizes', () => {
  const style = { fontSize: 30, width: 80 };
  const standalone = subtitle.layoutMetrics(style, 1920, 1080, false, false);
  const bilingualOriginal = subtitle.layoutMetrics(style, 1920, 1080, false, true);
  const translation = subtitle.layoutMetrics(style, 1920, 1080, true, true);
  assert.equal(standalone.canvasScale, 2);
  assert.equal(standalone.fontSize, 60);
  assert.equal(bilingualOriginal.fontSize, 32);
  assert.equal(translation.fontSize, 44);
  assert.equal(standalone.wrapWidth, 1536);
  assert.equal(standalone.padH, 16);
  assert.equal(standalone.padV, 7.2);
});

test('explicit per-line styles bypass the compatibility font ratios', () => {
  const style = {
    fontSize: 30,
    origStyle: { fontSize: 18 },
    transStyle: { fontSize: 24 },
  };
  assert.equal(subtitle.lineFontSize(style, false, true), 18);
  assert.equal(subtitle.lineFontSize(style, true, true), 24);
});

test('a line override without fontSize keeps the bilingual compact ratios', () => {
  // 「独立摆放」只写 x/y/verticalAlign。合并包必然从根继承 fontSize，用它做
  // 判据会让原文行从 compact 跳回全尺寸，而烧录端仍按 compact。
  const style = {
    fontSize: 30,
    origStyle: { x: 20, y: 30 },
    transStyle: { x: 80, y: 70, verticalAlign: 'top' },
  };
  assert.equal(subtitle.lineFontSize(style, false, true), 16);
  assert.equal(subtitle.lineFontSize(style, true, true), 22);
  assert.equal(subtitle.lineFontSize(style, false, false), 30);
  assert.equal(subtitle.layoutMetrics(style, 1920, 1080, false, true).fontSize, 32);
  assert.equal(subtitle.layoutMetrics(style, 1920, 1080, true, true).fontSize, 44);
});

test('only a numeric per-line fontSize counts as explicit', () => {
  const explicit = { fontSize: 30, origStyle: { fontSize: 18, x: 20, y: 30 } };
  assert.equal(subtitle.lineFontSize(explicit, false, true), 18);
  // 烧录端 as_f64 只认 JSON 数字：字符串、布尔、null 一律视为未写
  assert.equal(subtitle.lineFontSize({ fontSize: 30, origStyle: { fontSize: '18' } }, false, true), 16);
  assert.equal(subtitle.lineFontSize({ fontSize: 30, origStyle: { fontSize: true } }, false, true), 16);
  assert.equal(subtitle.lineFontSize({ fontSize: 30, origStyle: { fontSize: null } }, false, true), 16);
  assert.equal(subtitle.lineFontSize({ fontSize: 30, origStyle: { fontSize: NaN } }, false, true), 16);
  // Rust 的 size.max(1.0)：0 和负数夹到 1，而不是回落到缩放
  assert.equal(subtitle.lineFontSize({ fontSize: 30, origStyle: { fontSize: 0 } }, false, true), 1);
  assert.equal(subtitle.lineFontSize({ fontSize: 30, origStyle: { fontSize: -5 } }, false, true), 1);
});

const LINE_ENTRIES = [
  { line: 'trans', width: 400, height: 60 },
  { line: 'orig', width: 300, height: 40 },
];
const LINE_OPTIONS = { frameWidth: 1000, frameHeight: 500, gap: 12, padH: 0, padV: 0 };

test('line layout without overrides reproduces the anchor stack math', () => {
  const plan = subtitle.planLineLayout(LINE_ENTRIES, { ...LINE_OPTIONS, style: { x: 50, y: 80 } });
  assert.equal(plan.detached.length, 0);
  assert.equal(plan.stackWidth, 400);
  assert.equal(plan.stackHeight, 112);
  assert.deepEqual(plan.anchor, { x: 500, y: 400 });
  assert.deepEqual(plan.stacked.map((item) => [item.line, item.x, item.y]), [
    ['trans', 0, 0],
    ['orig', 50, 72],
  ]);
  // 推导中心 = 锚点 + 行在堆栈内的中心相对堆栈中心的偏移
  assert.deepEqual(plan.stacked[0].center, { x: 500, y: 374 });
  assert.deepEqual(plan.stacked[1].center, { x: 500, y: 436 });
});

test('shared background padding wraps the stack exactly as before', () => {
  const plan = subtitle.planLineLayout(LINE_ENTRIES, {
    ...LINE_OPTIONS, padH: 10, padV: 6, style: {},
  });
  assert.equal(plan.stackWidth, 420);
  assert.equal(plan.stackHeight, 124);
  assert.deepEqual(plan.stacked.map((item) => [item.x, item.y]), [[10, 6], [60, 78]]);
  assert.deepEqual(plan.anchor, { x: 500, y: 430 });
});

test('the block anchor pins the shared plate edge, not the glyph span', () => {
  // 与 apps/cli raster.rs 同构：锚定总高含底板上下 padding，top 时底板顶边压在
  // 锚线上、bottom 时底板底边压在锚线上；center 与既有结果逐值一致。
  const shared = { ...LINE_OPTIONS, padH: 10, padV: 6 };
  const top = subtitle.planLineLayout(LINE_ENTRIES, {
    ...shared, style: { x: 50, y: 80, verticalAlign: 'top' },
  });
  const boxTop = (plan) => plan.stackCenter.y - plan.stackHeight / 2;
  assert.deepEqual(top.anchor, { x: 500, y: 400 });
  assert.equal(top.stackHeight, 124);
  assert.deepEqual(top.stackSpan, { top: 406, bottom: 518 });
  assert.equal(boxTop(top), 400);

  const bottom = subtitle.planLineLayout(LINE_ENTRIES, {
    ...shared, style: { x: 50, y: 80, verticalAlign: 'bottom' },
  });
  assert.equal(bottom.stackHeight, 124);
  assert.deepEqual(bottom.stackSpan, { top: 282, bottom: 394 });
  assert.equal(boxTop(bottom) + bottom.stackHeight, 400);

  // center 不受影响：-total/2 - padV + padV 抵消
  const center = subtitle.planLineLayout(LINE_ENTRIES, {
    ...shared, style: { x: 50, y: 80, verticalAlign: 'center' },
  });
  assert.deepEqual(center.stackSpan, { top: 344, bottom: 456 });
  assert.deepEqual(center.stackCenter, center.anchor);
  assert.deepEqual(center.stacked.map((item) => [item.x, item.y]), [[10, 6], [60, 78]]);
  // separate 模式（padV 0）逐值不动
  const separate = subtitle.planLineLayout(LINE_ENTRIES, {
    ...LINE_OPTIONS, style: { x: 50, y: 80, verticalAlign: 'top' },
  });
  assert.deepEqual(separate.stackSpan, { top: 400, bottom: 512 });
});

test('the shared plate follows the source line spec, not the first stacked line', () => {
  // 共享底板只跟一行走：源行优先，只有源行没有真实背景而译文行有时才退到译文行。
  // 镜像 Mac sharedBackgroundSpec 与 CLI render_plan 的 plate_line。
  const metrics = (style) => subtitle.layoutMetrics(style, 1000, 500, false, false);
  const withBg = { line: 'orig', metrics: metrics({ backgroundColor: '#000000cc' }) };
  const transBg = { line: 'trans', metrics: metrics({ backgroundColor: '#ff0000ff' }) };
  const noBg = { line: 'orig', metrics: metrics({ background: false }) };
  const clearBg = { line: 'orig', metrics: metrics({ background: true, backgroundColor: 'rgba(0,0,0,0)' }) };

  // transTop 时译文行排在前面，取首行会分叉
  assert.equal(subtitle.sharedPlateLine([transBg, withBg]), withBg);
  assert.equal(subtitle.sharedPlateLine([withBg, transBg]), withBg);
  // 源行背景关 → 退到译文行
  assert.equal(subtitle.sharedPlateLine([transBg, noBg]), transBg);
  // 源行开着但颜色近全透明，同样不算真实背景
  assert.equal(subtitle.sharedPlateLine([transBg, clearBg]), transBg);
  assert.equal(subtitle.hasRealBackground(clearBg.metrics), false);
  assert.equal(subtitle.hasRealBackground(withBg.metrics), true);
  // 两行都没有真背景时留在源行（Mac 基线），单行/空栈按原样返回
  const clearTrans = { line: 'trans', metrics: metrics({ background: false }) };
  assert.equal(subtitle.sharedPlateLine([clearTrans, noBg]), noBg);
  assert.equal(subtitle.sharedPlateLine([transBg]), transBg);
  assert.equal(subtitle.sharedPlateLine([]), null);
});

test('a detached line leaves the stack and the rest re-centers on the anchor', () => {
  const style = { x: 50, y: 80, transStyle: { x: 20, y: 30 } };
  const plan = subtitle.planLineLayout(LINE_ENTRIES, { ...LINE_OPTIONS, style });
  assert.deepEqual(
    plan.detached.map((item) => [item.line, item.center.x, item.center.y]),
    [['trans', 200, 150]],
  );
  assert.equal(plan.stacked.length, 1);
  assert.equal(plan.stackWidth, 300);
  assert.equal(plan.stackHeight, 40);
  // 只剩一行时堆栈退化为单行居中于锚点，与既有单行数学一致
  assert.deepEqual(plan.stacked[0].center, { x: 500, y: 400 });
  // 绘制顺序仍按行序，独立行不会被排到末尾
  assert.deepEqual(plan.placements.map((item) => item.line), ['trans', 'orig']);
});

test('both lines can detach, and a single-line context ignores line positions', () => {
  const style = { x: 50, y: 80, origStyle: { x: 10, y: 10 }, transStyle: { x: 90, y: 90 } };
  const plan = subtitle.planLineLayout(LINE_ENTRIES, { ...LINE_OPTIONS, style });
  assert.equal(plan.stacked.length, 0);
  assert.equal(plan.stackWidth, 0);
  assert.equal(plan.stackHeight, 0);
  assert.equal(plan.detached.length, 2);

  const single = subtitle.planLineLayout([LINE_ENTRIES[1]], { ...LINE_OPTIONS, style });
  assert.equal(single.detached.length, 0);
  assert.deepEqual(single.stacked[0].center, { x: 500, y: 400 });
});

test('bilingual mode keeps the override even when only one line has content', () => {
  // 导出端 line_position_override 只看 mode：双语模式下某条 cue 缺译文时，
  // 剩下的那行仍按覆盖浮动。预览用 bilingual 开关表达同一判据。
  const style = { x: 50, y: 80, origStyle: { x: 10, y: 10 } };
  const floating = subtitle.planLineLayout([LINE_ENTRIES[1]], {
    ...LINE_OPTIONS, style, bilingual: true,
  });
  assert.equal(floating.stacked.length, 0);
  assert.deepEqual(
    floating.detached.map((item) => [item.line, item.center.x, item.center.y]),
    [['orig', 100, 50]],
  );

  const monolingual = subtitle.planLineLayout([LINE_ENTRIES[1]], {
    ...LINE_OPTIONS, style, bilingual: false,
  });
  assert.equal(monolingual.detached.length, 0);
  assert.deepEqual(monolingual.stacked[0].center, { x: 500, y: 400 });
});

// 垂直锚点：数值全部抄自 Rust 烧录端 apps/cli/src/cmd/studio_export/tests.rs 的
// place_lines 用例（PLACE_ANCHOR (500,860)、PLACE_FRAME 1000×1000、PLACE_GAP 6），
// 逐条对拍。预览与烧录一旦分叉，这里先红。
test('vertical anchors and seam stacking match the Rust burn-in placements', () => {
  for (const row of contract.verticalAligns) {
    assert.equal(
      subtitle.lineVerticalAlign({ origStyle: { verticalAlign: row.value } }, 'orig'),
      row.expected,
      JSON.stringify(row.value),
    );
    assert.equal(
      subtitle.blockVerticalAlign({ verticalAlign: row.value }),
      row.expected,
      JSON.stringify(row.value),
    );
  }
  // 键整个缺席，以及覆盖对象本身不存在
  assert.equal(subtitle.lineVerticalAlign({ origStyle: { x: 1, y: 2 } }, 'orig'), null);
  assert.equal(subtitle.lineVerticalAlign({}, 'trans'), null);
  assert.equal(subtitle.blockVerticalAlign({}), null);

  for (const row of contract.seamAligns) {
    assert.equal(subtitle.seamAlign(row.rank, row.count), row.expected);
  }

  for (const row of contract.linePlacements) {
    const style = { x: row.anchor.x, y: row.anchor.y };
    if (row.blockAlign) style.verticalAlign = row.blockAlign;
    row.lines.forEach((line) => {
      if (!line.over && !line.align) return;
      const bag = {};
      if (line.over) Object.assign(bag, line.over);
      if (line.align) bag.verticalAlign = line.align;
      style[subtitle.lineStyleKey(line.line)] = bag;
    });
    const plan = subtitle.planLineLayout(row.lines, {
      style,
      frameWidth: row.frame.width,
      frameHeight: row.frame.height,
      gap: row.gap,
      padH: 0,
      // platePadV 缺席即 separate 语义（0），带 platePadV 的行对拍共享底板锚定。
      padV: row.platePadV || 0,
      bilingual: true,
    });
    assert.deepEqual(
      plan.placements.map((item) => item.top),
      row.expected.tops,
      row.name,
    );
    assert.deepEqual(plan.stackSpan, row.expected.span, row.name);
  }
});

test('single row lines keep the pre-anchor stack output bit for bit', () => {
  // 等价性硬义务：reference 缺席（== 实际高）时槽位退化为实际高，三态 alignWithin
  // 全部变成恒等，整份输出与改造前逐值一致。
  const flat = subtitle.planLineLayout(LINE_ENTRIES, { ...LINE_OPTIONS, style: { x: 50, y: 80 } });
  const explicit = subtitle.planLineLayout(
    LINE_ENTRIES.map((entry) => ({ ...entry, reference: entry.height })),
    { ...LINE_OPTIONS, style: { x: 50, y: 80 } },
  );
  assert.deepEqual(explicit, flat);
  assert.equal(flat.stackHeight, 112);
  assert.deepEqual(flat.stackCenter, flat.anchor);
  assert.deepEqual(flat.stacked.map((item) => [item.x, item.y]), [[0, 0], [50, 72]]);
});

test('wrapped stack lines expand the shared background instead of each other', () => {
  const wrapped = [
    { line: 'trans', width: 400, height: 120, reference: 60 },
    { line: 'orig', width: 300, height: 40, reference: 40 },
  ];
  const plan = subtitle.planLineLayout(wrapped, {
    ...LINE_OPTIONS, padV: 6, style: { x: 50, y: 80 },
  });
  // 槽位仍是 60 + 12 + 40 = 112，接缝停在原处；上行只向上生长
  assert.deepEqual(plan.stacked.map((item) => item.top), [284, 416]);
  assert.deepEqual(plan.stackSpan, { top: 284, bottom: 456 });
  // 底板从落位后的实际 extent 反推（172 + 2×padV），不再是 total/2 反推
  assert.equal(plan.stackHeight, 184);
  assert.deepEqual(plan.stackCenter, { x: 500, y: 370 });
  // 局部坐标仍以底板左上角为原点
  assert.deepEqual(plan.stacked.map((item) => [item.x, item.y]), [[0, 6], [50, 138]]);
  // 下行不因上行折行而移动
  const flat = subtitle.planLineLayout(
    [{ line: 'trans', width: 400, height: 60, reference: 60 }, wrapped[1]],
    { ...LINE_OPTIONS, padV: 6, style: { x: 50, y: 80 } },
  );
  assert.equal(flat.stacked[1].top, plan.stacked[1].top);
});

test('the stack centre stays the anchor unless the block anchor moves it', () => {
  const style = { x: 50, y: 80, verticalAlign: 'bottom' };
  const plan = subtitle.planLineLayout(LINE_ENTRIES, { ...LINE_OPTIONS, style });
  assert.deepEqual(plan.stacked.map((item) => item.top), [288, 360]);
  assert.deepEqual(plan.stackCenter, { x: 500, y: 344 });
  // 块级锚点是根级语义，不能被当成行锚点铺进堆栈里的每一行
  assert.equal(subtitle.lineVerticalAlign(style, 'orig'), null);
});

test('line anchors round-trip through the write-back conversion without jumping', () => {
  const height = 40;
  for (const align of ['top', 'center', 'bottom']) {
    const y = subtitle.lineAnchorFromCenter(300, height, align);
    assert.equal(subtitle.anchorBlock(y, height, align) + height / 2, 300, align);
  }
  assert.equal(subtitle.lineAnchorFromCenter(300, 40, 'top'), 280);
  assert.equal(subtitle.lineAnchorFromCenter(300, 40, 'bottom'), 320);
  assert.equal(subtitle.lineAnchorFromCenter(300, 40, undefined), 300);
});

test('line style patches carry the vertical anchor only when asked', () => {
  assert.deepEqual(
    subtitle.lineStylePatch({}, 'orig', { x: 20, y: 30, verticalAlign: 'bottom' }),
    { origStyle: { x: 20, y: 30, verticalAlign: 'bottom' } },
  );
  // 只改 x/y 的调用（滑杆、整体位移）不带这个键，已写入的锚点原样保留
  assert.deepEqual(
    subtitle.lineStylePatch(
      { origStyle: { x: 20, y: 30, verticalAlign: 'bottom' } },
      'orig',
      { x: 40, y: 50 },
    ),
    { origStyle: { x: 40, y: 50, verticalAlign: 'bottom' } },
  );
  // 非法值等同于清除，绝不落进 style
  assert.deepEqual(
    subtitle.lineStylePatch(
      { origStyle: { x: 20, y: 30, verticalAlign: 'bottom' } },
      'orig',
      { x: 20, y: 30, verticalAlign: 'Middle' },
    ),
    { origStyle: { x: 20, y: 30 } },
  );
  // 回堆栈时锚点随 x/y 一起清掉，交还给接缝默认
  assert.deepEqual(
    subtitle.lineStylePatch({ origStyle: { x: 20, y: 30, verticalAlign: 'top' } }, 'orig', null),
    { origStyle: null },
  );
  assert.deepEqual(
    subtitle.shiftLineOverrides({ transStyle: { x: 20, y: 30, verticalAlign: 'top' } }, 5, -5),
    { transStyle: { x: 25, y: 25, verticalAlign: 'top' } },
  );
});

test('line anchors stay inert outside a bilingual context', () => {
  const style = { x: 50, y: 80, origStyle: { x: 20, y: 30, verticalAlign: 'top' } };
  const entries = [{ line: 'orig', width: 300, height: 80, reference: 40 }];
  const mono = subtitle.planLineLayout(entries, { ...LINE_OPTIONS, style, bilingual: false });
  assert.equal(mono.detached.length, 0);
  assert.equal(mono.stacked[0].align, 'center');
  assert.equal(mono.stacked[0].top, 360);
  const bi = subtitle.planLineLayout(entries, { ...LINE_OPTIONS, style, bilingual: true });
  assert.equal(bi.stacked.length, 0);
  assert.equal(bi.detached[0].align, 'top');
  assert.equal(bi.detached[0].top, 150);
  assert.deepEqual(bi.detached[0].center, { x: 200, y: 190 });
});

test('a line position needs both axes and stays absent by default', () => {
  assert.equal(subtitle.linePosition({}, 'orig'), null);
  assert.equal(subtitle.linePosition({ origStyle: { x: 20 } }, 'orig'), null);
  assert.equal(subtitle.linePosition({ origStyle: { x: 20, y: null } }, 'orig'), null);
  assert.equal(subtitle.linePosition({ origStyle: null }, 'orig'), null);
  assert.equal(subtitle.linePosition({ origStyle: { x: NaN, y: 30 } }, 'orig'), null);
  assert.equal(subtitle.linePosition({ origStyle: { x: Infinity, y: 30 } }, 'orig'), null);
  // 与导出端 as_f64() 对齐：非数字类型不算覆盖，别靠 Number() 强转救回来。
  assert.equal(subtitle.linePosition({ origStyle: { x: '20', y: '30' } }, 'orig'), null);
  assert.equal(subtitle.linePosition({ origStyle: { x: true, y: 30 } }, 'orig'), null);
  assert.deepEqual(
    subtitle.linePosition({ origStyle: { x: 20, y: 30 } }, 'orig'),
    { x: 20, y: 30 },
  );
  assert.deepEqual(subtitle.linePosition({ transStyle: { x: 0, y: 0 } }, true), { x: 0, y: 0 });
});

test('line position patches keep other line keys and clear only x/y', () => {
  assert.deepEqual(
    subtitle.lineStylePatch({ origStyle: { fontSize: 18 } }, 'orig', { x: 20.34, y: 30.06 }),
    { origStyle: { fontSize: 18, x: 20.3, y: 30.1 } },
  );
  assert.deepEqual(
    subtitle.lineStylePatch({ origStyle: { fontSize: 18, x: 1, y: 2 } }, 'orig', null),
    { origStyle: { fontSize: 18 } },
  );
  // 覆盖只剩位置时写 null：既盖住 data.json 的同名键，又不会留下空对象
  assert.deepEqual(
    subtitle.lineStylePatch({ transStyle: { x: 1, y: 2 } }, 'trans', null),
    { transStyle: null },
  );
  assert.equal(
    subtitle.lineFontSize({ fontSize: 30, transStyle: null }, true, true),
    subtitle.lineFontSize({ fontSize: 30 }, true, true),
  );
});

test('whole-stack moves shift existing line overrides by the same delta', () => {
  const style = {
    x: 50,
    y: 86,
    origStyle: { fontSize: 18, x: 20, y: 30 },
    transStyle: { x: 80.4, y: 70 },
  };
  assert.deepEqual(subtitle.shiftLineOverrides(style, -5.5, 2.2), {
    origStyle: { fontSize: 18, x: 14.5, y: 32.2 },
    transStyle: { x: 74.9, y: 72.2 },
  });
  assert.deepEqual(subtitle.shiftLineOverrides({ x: 50, y: 86 }, 3, 3), {});
});

test('line selection narrows on a plain click and extends to the whole stack on shift', () => {
  assert.deepEqual(
    subtitle.nextLineSelection(null, 'c1', 'orig', false),
    { cueId: 'c1', line: 'orig' },
  );
  assert.deepEqual(
    subtitle.nextLineSelection({ cueId: 'c1', line: 'orig' }, 'c1', 'trans', false),
    { cueId: 'c1', line: 'trans' },
  );
  assert.deepEqual(
    subtitle.nextLineSelection({ cueId: 'c1', line: 'orig' }, 'c1', 'trans', true),
    { cueId: 'c1', line: null },
  );
  // Shift 点同一行不改变现状；跨字幕的 Shift 只切到新字幕的那一行
  assert.deepEqual(
    subtitle.nextLineSelection({ cueId: 'c1', line: 'orig' }, 'c1', 'orig', true),
    { cueId: 'c1', line: 'orig' },
  );
  assert.deepEqual(
    subtitle.nextLineSelection({ cueId: 'c1', line: 'orig' }, 'c2', 'trans', true),
    { cueId: 'c2', line: 'trans' },
  );
  assert.deepEqual(
    subtitle.nextLineSelection({ cueId: 'c1' }, 'c1', 'orig', true),
    { cueId: 'c1', line: null },
  );
});

test('selection membership treats a missing line as the whole stack', () => {
  assert.equal(subtitle.isLineSelected({ cueId: 'c1' }, 'c1', 'orig'), true);
  assert.equal(subtitle.isLineSelected({ cueId: 'c1' }, 'c1', 'trans'), true);
  assert.equal(subtitle.isLineSelected({ cueId: 'c1', line: 'orig' }, 'c1', 'trans'), false);
  assert.equal(subtitle.isLineSelected({ cueId: 'c1', line: 'orig' }, 'c1', 'orig'), true);
  assert.equal(subtitle.isLineSelected({ cueId: 'c1' }, 'c2', 'orig'), false);
  assert.equal(subtitle.isLineSelected(null, 'c1', 'orig'), false);
});

test('word animation state merges spoken, active, and unspoken layers', () => {
  const animation = subtitle.normalizeWordAnimation({
    wordAnimation: {
      animationName: 'Custom',
      spoken: { color: '#00ff00' },
      active: { backgroundColor: '#ffff00' },
      unspoken: { opacity: 0.4 },
    },
  });
  assert.deepEqual(subtitle.wordState(animation, 0, 1), { color: '#00ff00' });
  assert.deepEqual(
    subtitle.wordState(animation, 1, 1),
    { color: '#0D0D0D', backgroundColor: '#ffff00', borderRadiusEm: 0.25 },
  );
  assert.deepEqual(subtitle.wordState(animation, 2, 1), { opacity: 0.4 });
});

test('entrance transitions are anchored to display start and seek-safe', () => {
  const fade = {
    transition: { transitionId: 'magic-fade', transitionSpeed: 50 },
  };
  assert.equal(subtitle.transitionDuration(fade), 0.25);
  assert.deepEqual(
    subtitle.transitionPose(fade, 1.5, 1.5, 2),
    { opacity: 0, scaleX: 1, scaleY: 1, blur: 12, active: true },
  );
  assert.deepEqual(
    subtitle.transitionPose(fade, 1.5, 2, 2),
    { opacity: 1, scaleX: 1, scaleY: 1, blur: 0, active: false },
  );

  const pop = {
    transition: { transitionId: 'magic-pop', transitionSpeed: 50 },
  };
  assert.ok(Math.abs(subtitle.transitionDuration(pop) - 0.1) < 1e-9);
  assert.equal(subtitle.transitionPose(pop, 2, 2).scaleX, 0.7);
});

test('line ordering follows the subtitle context', () => {
  assert.deepEqual(subtitle.resolveModeLines('orig'), ['orig']);
  assert.deepEqual(subtitle.resolveModeLines('trans'), ['trans']);
  assert.deepEqual(subtitle.resolveModeLines('bi', 'trans'), ['trans', 'orig']);
  assert.deepEqual(subtitle.resolveModeLines('bi', 'orig'), ['orig', 'trans']);
});

test('punctuation projection covers every language, stays optional, and is non-destructive', () => {
  const source = '你好，版本 1.2 真的可以吗？';
  assert.equal(subtitle.projectPunctuation(source, 'zh'), '你好 版本 1.2 真的可以吗？');
  assert.equal(subtitle.projectPunctuation(source, 'zh', false), source);
  assert.equal(subtitle.projectPunctuation('Hello, world.', 'en'), 'Hello world');
});
