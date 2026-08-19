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
  // 行内换行 DP 与 Rust `layout_profile::line_break_plan`（源 Cue 优化器的两行
  // 失衡分）共用同一份夹具：任一实现漂移都在这里失败。
  for (const row of contract.lineBreaks) {
    const lines = subtitle.sourceDisplayLines(
      row.words.map((text) => ({ text })), row.language, row.fit,
    );
    assert.deepEqual(
      lines.map((line) => line.words.map((_, offset) => line.from + offset)),
      row.expected,
      row.name,
    );
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

test('the canvas draws the original per source cue while the translation stays on its own piece', () => {
  const timing = subtitle.DEFAULT_TIMING;
  const cues = [
    { id: 'q-a', start: 0, end: 2, text: 'agentic engineering allows' },
    { id: 'q-b', start: 2, end: 4, text: 'us to shift' },
  ];
  // 一片译文横跨上面两条源 Cue —— 对齐契约下这是常态，不是异常
  const pieces = [{
    id: 's1#1', start: 0, end: 4, text: '智能体工程让我们得以转变',
    sourceText: 'agentic engineering allows us to shift',
  }];
  const at = (t) => ({
    orig: (subtitle.activeTimedItem(cues, t, timing) || {}).item,
    trans: (subtitle.activeTimedItem(pieces, t, timing) || {}).item,
  });

  // 原文行随源 Cue 切换，译文行始终是同一片：两条互不收窄的独立时间流，
  // 与烧录端 render_plan.rs::active_layouts 同构。
  assert.equal(at(1).orig.text, 'agentic engineering allows');
  assert.equal(at(3).orig.text, 'us to shift');
  assert.equal(at(1).trans.id, at(3).trans.id);
  assert.equal(at(3).trans.text, '智能体工程让我们得以转变');

  // 画布上绝不出现「整片对齐词 span」拼成的超长原文行
  assert.notEqual(at(1).orig.text, pieces[0].sourceText);
  assert.notEqual(at(3).orig.text, pieces[0].sourceText);
  // 合成该长行的 translationSourceCue() 投影已随 M122 删除
  assert.equal(subtitle.translationSourceCue, undefined);
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
    { id: 'q-b', words: [{ id: 'w3' }, { id: 'w4' }, { id: 'w5' }] },
    { id: 'q-c', words: [{ id: 'w6' }, { id: 'w7' }, { id: 'w8' }] },
  ];
  const words = ['Production', 'deployments', 'have', 'seen', 'fifty', 'percent',
    'fewer', 'rollbacks', 'overall']
    .map((text, index) => ({ id: `w${index}`, text, start: index, end: index + 1 }));
  const parts = subtitle.sourceCueParts({ sourceWords: words }, cues, 'en', 42);
  assert.deepEqual(parts.map((part) => part.cueId), ['q-a', 'q-b', 'q-c']);
  assert.deepEqual(parts.map((part) => part.text), [
    'Production deployments have', 'seen fifty percent', 'fewer rollbacks overall',
  ]);
  assert.deepEqual(parts.map((part) => [part.start, part.end]), [[0, 3], [3, 6], [6, 9]]);
  // 顺序拼接不变量：子行覆盖的词与片源词逐个相等，一个都不能丢
  assert.deepEqual(
    parts.flatMap((part) => part.lines.flatMap((line) => line.words.map((word) => word.id))),
    words.map((word) => word.id),
  );
});

test('an over-wide source part still wraps by width inside its own cue group', () => {
  const long = "It seems like each advancement we've had in the complexity of the way we write code"
    .split(/\s+/);
  const tail = ['right', 'about', 'here.'];
  const cues = [
    { id: 'q-a', words: long.map((_, index) => ({ id: `w${index}` })) },
    { id: 'q-b', words: tail.map((_, index) => ({ id: `tail${index}` })) },
  ];
  const words = long.map((text, index) => ({ id: `w${index}`, text, start: index, end: index + 1 }))
    .concat(tail.map((text, index) => ({ id: `tail${index}`, text, start: 99 + index, end: 100 + index })));
  const parts = subtitle.sourceCueParts({ sourceWords: words }, cues, 'en', 42);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].lines.length > 1);
  assert.ok(parts[0].lines.every((line) => Array.from(line.text).length <= 42));
  assert.deepEqual(parts[1].lines.map((line) => line.text), ['right about here.']);
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

// MARK: 碎片子行合并（与 apps/mac OrigLineView.mergeShortRuns 规则逐条一致）

// 只关心「每段几个词」，词本身用占位
const runsOf = (lengths) => lengths.map((length, index) => ({
  cueId: `q-${index}`,
  words: Array.from({ length }, (_, i) => ({ id: `r${index}w${i}` })),
}));
const lengthsOf = (runs) => runs.map((run) => run.words.length);

test('an orphan first run merges forward and an orphan last run merges backward', () => {
  assert.deepEqual(lengthsOf(subtitle.mergeShortRuns(runsOf([2, 5]))), [7]);
  assert.deepEqual(lengthsOf(subtitle.mergeShortRuns(runsOf([5, 2]))), [7]);
  assert.deepEqual(lengthsOf(subtitle.mergeShortRuns(runsOf([1, 4, 3]))), [5, 3]);
  // 合并后保留靠前那段的 cueId：子行可以跨 cue，这是刻意的展示妥协
  assert.deepEqual(subtitle.mergeShortRuns(runsOf([2, 5])).map((run) => run.cueId), ['q-0']);
});

test('an orphan middle run merges into the shorter neighbour, ties going to the previous', () => {
  assert.deepEqual(lengthsOf(subtitle.mergeShortRuns(runsOf([5, 1, 3]))), [5, 4]);
  assert.deepEqual(lengthsOf(subtitle.mergeShortRuns(runsOf([3, 1, 5]))), [4, 5]);
  assert.deepEqual(lengthsOf(subtitle.mergeShortRuns(runsOf([3, 1, 3]))), [4, 3]);
});

test('merging cascades, and a single run is never merged', () => {
  assert.deepEqual(lengthsOf(subtitle.mergeShortRuns(runsOf([1, 1, 1, 4]))), [3, 4]);
  assert.deepEqual(lengthsOf(subtitle.mergeShortRuns(runsOf([2, 2, 2]))), [6]);
  assert.deepEqual(lengthsOf(subtitle.mergeShortRuns(runsOf([1]))), [1]);
  assert.deepEqual(subtitle.mergeShortRuns([]), []);
});

test('a piece starting mid-cue shows no one-or-two word orphan subline', () => {
  // 「of a」是上一条源 Cue 的尾巴，译片从这里开始 —— 不能单独占一行
  const cues = [
    { id: 'q-a', words: [{ id: 'w0' }, { id: 'w1' }] },
    { id: 'q-b', words: [{ id: 'w2' }, { id: 'w3' }, { id: 'w4' }, { id: 'w5' }, { id: 'w6' }] },
  ];
  const words = ['of', 'a', 'much', 'larger', 'system', 'that', 'works']
    .map((text, index) => ({ id: `w${index}`, text, start: index, end: index + 1 }));
  const parts = subtitle.sourceCueParts({ sourceWords: words }, cues, 'en', 42);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, 'of a much larger system that works');
  assert.equal(parts[0].cueId, 'q-a');
  assert.deepEqual([parts[0].start, parts[0].end], [0, 7]);
  // 合并只动展示，词一个不少、顺序不变
  assert.deepEqual(parts[0].words.map((word) => word.id), words.map((word) => word.id));
});

test('a piece ending mid-cue absorbs the trailing orphan into the previous part', () => {
  // 「and the」是这条译片在下一条源 Cue 里啃到的两个词
  const cues = [
    { id: 'q-a', words: [{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }] },
    { id: 'q-b', words: [{ id: 'w4' }, { id: 'w5' }] },
  ];
  const words = ['renewable', 'sources', 'keep', 'growing', 'and', 'the']
    .map((text, index) => ({ id: `w${index}`, text, start: index, end: index + 1 }));
  const parts = subtitle.sourceCueParts({ sourceWords: words }, cues, 'en', 42);
  assert.deepEqual(parts.map((part) => part.text), ['renewable sources keep growing and the']);
  assert.deepEqual(parts.map((part) => part.cueId), ['q-a']);
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
  // 画布点选一律写「字幕对象」形态（Mac .sub / .subLine，原型 kind:'sub'）
  assert.deepEqual(
    subtitle.nextLineSelection(null, 'orig', false),
    { kind: 'sub', line: 'orig' },
  );
  assert.deepEqual(
    subtitle.nextLineSelection({ kind: 'sub', line: 'orig' }, 'trans', false),
    { kind: 'sub', line: 'trans' },
  );
  assert.deepEqual(
    subtitle.nextLineSelection({ kind: 'sub', line: 'orig' }, 'trans', true),
    { kind: 'sub', line: null },
  );
  // Shift 点同一行不改变现状
  assert.deepEqual(
    subtitle.nextLineSelection({ kind: 'sub', line: 'orig' }, 'orig', true),
    { kind: 'sub', line: 'orig' },
  );
  // 没有选中过时 Shift 不扩展，只选中被点的那一行
  assert.deepEqual(
    subtitle.nextLineSelection(null, 'trans', true),
    { kind: 'sub', line: 'trans' },
  );
  // 整行以外的命中（拖整栈）= 整体选中
  assert.deepEqual(
    subtitle.nextLineSelection({ kind: 'sub', line: 'orig' }, null, false),
    { kind: 'sub', line: null },
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

test('the subtitle-object selection is cue independent', () => {
  assert.equal(subtitle.isSubObjectSel({ kind: 'sub', line: null }), true);
  assert.equal(subtitle.isSubObjectSel({ cueId: 'c1' }), false);
  assert.equal(subtitle.isSubObjectSel(null), false);
  // 不绑 cue：任何 cueId 下都算选中，播放头跨 cue 边界后选中框不掉
  assert.equal(subtitle.isLineSelected({ kind: 'sub', line: null }, 'c1', 'orig'), true);
  assert.equal(subtitle.isLineSelected({ kind: 'sub', line: null }, 'c9', 'trans'), true);
  assert.equal(subtitle.isLineSelected({ kind: 'sub', line: null }, null, 'orig'), true);
  assert.equal(subtitle.isLineSelected({ kind: 'sub', line: 'trans' }, 'c1', 'orig'), false);
  assert.equal(subtitle.isLineSelected({ kind: 'sub', line: 'trans' }, 'c1', 'trans'), true);
  assert.equal(subtitle.selectedLineOf({ kind: 'sub', line: 'trans' }), 'trans');
  assert.equal(subtitle.selectedLineOf({ kind: 'sub', line: null }), null);
  assert.equal(subtitle.selectedLineOf({ kind: 'sub', line: 'both' }), null);
  assert.equal(subtitle.selectedLineOf(null), null);
});

test('clicking a line keeps the selection on the subtitle object, never on a cue', () => {
  // 普通点击：对象选中 → 仍是对象形态，只窄到被点的那一行
  assert.deepEqual(
    subtitle.nextLineSelection({ kind: 'sub', line: null }, 'trans', false),
    { kind: 'sub', line: 'trans' },
  );
  // Shift 扩展：整体 → 仍是整体（两行）
  assert.deepEqual(
    subtitle.nextLineSelection({ kind: 'sub', line: null }, 'orig', true),
    { kind: 'sub', line: null },
  );
  // 对象选中已窄到 trans 行，Shift 点 orig → 两行都选中
  assert.deepEqual(
    subtitle.nextLineSelection({ kind: 'sub', line: 'trans' }, 'orig', true),
    { kind: 'sub', line: null },
  );
  // 先从时间轴选了 cue（{cueId} 形态），再在画布上 Shift 点另一行：算同一条字幕，
  // 扩展到两行，并且落回对象形态（画布选中不再绑 cue）。
  assert.deepEqual(
    subtitle.nextLineSelection({ cueId: 'c1', line: 'orig' }, 'trans', true),
    { kind: 'sub', line: null },
  );
  assert.deepEqual(
    subtitle.nextLineSelection({ cueId: 'c1', line: 'orig' }, 'orig', false),
    { kind: 'sub', line: 'orig' },
  );
  // 元素选中不是字幕选中：Shift 不扩展
  assert.deepEqual(
    subtitle.nextLineSelection({ kind: 'el', id: 'e1' }, 'orig', true),
    { kind: 'sub', line: 'orig' },
  );
});

test('stage display mode is pinned to the original outside the bilingual context', () => {
  // sub 上下文（Transcript / Subtitle tab）：恒为原文，忽略 style.mode
  assert.equal(subtitle.stageMode('sub', 'bi'), 'orig');
  assert.equal(subtitle.stageMode('sub', 'trans'), 'orig');
  assert.equal(subtitle.stageMode('transcript', 'bi'), 'orig');
  assert.equal(subtitle.stageMode('subtitle', 'trans'), 'orig');
  // bi 上下文（Translate tab）：读 style.mode
  assert.equal(subtitle.stageMode('bi', 'bi'), 'bi');
  assert.equal(subtitle.stageMode('bi', 'trans'), 'trans');
  assert.equal(subtitle.stageMode('bi', 'orig'), 'orig');
  assert.equal(subtitle.stageMode('translate', 'trans'), 'trans');
  // 缺省 / 非法值回到双语
  assert.equal(subtitle.stageMode('bi', undefined), 'bi');
  assert.equal(subtitle.stageMode('bi', 'nonsense'), 'bi');
  // 与 resolveModeLines 串起来：sub 上下文永远只排一行原文
  assert.deepEqual(subtitle.resolveModeLines(subtitle.stageMode('sub', 'bi'), 'trans'), ['orig']);
  assert.deepEqual(subtitle.resolveModeLines(subtitle.stageMode('bi', 'bi'), 'trans'), ['trans', 'orig']);
});

// 逐字复刻 p-97e0e88d2f777a83 的 studio/style.json：扁平根是从 bi 上下文（mode
// 'trans'，所以根就是译文行 29）拍平出来的，sub 上下文自己的原文行是 30。
function contextsFixture() {
  const lineStyle = (size, weight) => ({
    backgroundColor: '#000000B3',
    backgroundPadding: 10,
    backgroundStyle: 'wrap',
    bgOn: false,
    borderRadius: 15,
    dropShadow: { blur: 0.12, color: '#000000', distance: 0.08, on: true, opacity: 0.9, rotation: 45 },
    fontColor: '#FFFFFF',
    fontFamily: { fontFamily: 'Montserrat', type: 'default' },
    fontSize: size,
    fontStyle: 'normal',
    fontWeight: weight,
    italic: false,
    letterSpacing: 0,
    lineHeight: 1.2,
    textAlign: 'center',
    textOutline: { color: '#000000', on: true, width: 14 },
    textTransform: 'none',
    underline: false,
    // contexts 里的历史死字段：块级锚点在 set 上，这个键绝不能被读进扁平根。
    verticalAlign: 'bottom',
  });
  const anim = (id) => ({ animationId: id, animationName: id === 'none' ? 'None' : 'Color', active: {}, spoken: {}, unspoken: {} });
  const set = (mode, origSize, transSize) => ({
    backgroundMode: 'separate',
    gap: 6,
    mode,
    order: 'trans',
    punct: true,
    rotation: 0,
    scale: 1,
    transition: { transitionId: 'none', transitionSpeed: 50 },
    width: 80,
    x: 50,
    y: 86,
    orig: { anim: anim('magic-wbw'), style: lineStyle(origSize, 'bold') },
    trans: { anim: anim('none'), style: lineStyle(transSize, 'normal') },
  });
  return {
    bcutStudioStyle: '0.1',
    displayTiming: { leadIn: 0.5, tail: 1 },
    fontSize: 29,                       // 扁平根 = bi 上下文的译文行
    bilingualOrigScale: 0.5517241378965517,
    transScale: 1.8125000001132812,
    mode: 'trans',
    x: 50,
    y: 86,
    voiceInkContexts: { sub: set('orig', 30, 22), bi: set('trans', 16, 29) },
  };
}

test('contextStyle 让每个上下文拿到自己的字号，而不是扁平根那一份', () => {
  const style = contextsFixture();
  // sub 上下文（Transcript / Subtitle tab）：原文 30，而扁平根是 29
  assert.equal(subtitle.lineFontSize(subtitle.contextStyle(style, 'sub'), false, false), 30);
  // bi 上下文：译文 29、压缩原文 16
  assert.equal(subtitle.lineFontSize(subtitle.contextStyle(style, 'bi'), true, true), 29);
  assert.equal(subtitle.lineFontSize(subtitle.contextStyle(style, 'bi'), false, true), 16);
  // 扁平根照旧（没有人重写 doc.style）
  assert.equal(style.fontSize, 29);
});

test('contextStyle 在没有 voiceInkContexts 时逐比特返回原对象', () => {
  const flat = { fontSize: 29, mode: 'bi' };
  assert.strictEqual(subtitle.contextStyle(flat, 'sub'), flat);
  assert.strictEqual(subtitle.contextStyle(flat, 'bi'), flat);
  assert.strictEqual(subtitle.contextStyle({ voiceInkContexts: null }, 'bi').voiceInkContexts, null);
});

test('contextStyle 的 sub 上下文恒为单行原文，且不产出行级摆放', () => {
  const style = contextsFixture();
  style.voiceInkContexts.bi.orig.x = 50;
  style.voiceInkContexts.bi.orig.y = 50;
  style.voiceInkContexts.sub.orig.x = 10;   // 手改/导入的脏数据，sub 不该消费
  style.voiceInkContexts.sub.orig.y = 10;
  const sub = subtitle.contextStyle(style, 'sub');
  assert.equal(sub.mode, 'orig');
  assert.equal(subtitle.linePosition(sub, 'orig'), null);
  assert.deepEqual(subtitle.resolveModeLines(subtitle.stageMode('sub', sub.mode), sub.order), ['orig']);
  // bi 上下文才读行级摆放，对齐 Mac SubtitleStyleContexts.lineGeom 的 guard ctx == .bi
  const bi = subtitle.contextStyle(style, 'bi');
  assert.equal(bi.mode, 'trans');
  assert.deepEqual(subtitle.linePosition(bi, 'orig'), { x: 50, y: 50 });
  assert.equal(subtitle.linePosition(bi, 'trans'), null);
});

test('contextStyle 按 mergeFlat 的映射摊平外观，不把行样式的 verticalAlign 当块锚点', () => {
  const style = contextsFixture();
  const sub = subtitle.contextStyle(style, 'sub');
  assert.equal(sub.fontFamily, 'Montserrat');   // {type,fontFamily} → 字符串
  assert.equal(sub.bold, true);                 // fontWeight 'bold'
  assert.equal(sub.background, false);          // bgOn
  assert.equal(sub.outline, true);              // textOutline.on
  assert.equal(sub.align, 'center');            // textAlign
  assert.equal(sub.italic, undefined);          // 条件键：没开就不出现
  // 块级锚点只认 set 上的 verticalAlign；行样式里那个是死字段
  assert.equal(sub.verticalAlign, undefined);
  assert.equal(sub.transStyle.bold, false);     // 译文行 fontWeight 'normal'
  assert.equal(sub.origStyle.fontSize, undefined);   // 尺寸走比例链，不写显式行字号
  // 译文行的逐字动画跟着自己那一行走
  assert.equal(sub.origStyle.wordAnimation.animationId, 'magic-wbw');
  assert.equal(sub.transStyle.wordAnimation.animationId, 'none');
});

test('覆盖层盖在上下文样式之上，行级 partial 只做一层深合并', () => {
  const style = contextsFixture();
  const patched = subtitle.applyStylePatch(
    subtitle.contextStyle(style, 'bi'),
    { mode: 'bi', fontSize: 40, origStyle: { x: 20, y: 30 } },
  );
  // 用户在 Web 里改的模式/字号赢过 contexts
  assert.equal(patched.mode, 'bi');
  assert.equal(subtitle.lineFontSize(patched, false, true), 40);
  // 行级 patch 只写 x/y，那一行的外观仍然来自 contexts
  assert.deepEqual(subtitle.linePosition(patched, 'orig'), { x: 20, y: 30 });
  assert.equal(patched.origStyle.fontColor, '#FFFFFF');
  assert.equal(patched.origStyle.align, 'center');
  // 显式 null 仍然是「清除该行覆盖」
  const cleared = subtitle.applyStylePatch(patched, { origStyle: null });
  assert.equal(subtitle.linePosition(cleared, 'orig'), null);
  // 没有 patch 时原样返回
  assert.strictEqual(subtitle.applyStylePatch(patched, null), patched);
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

test('an untranslated sentence leaves the translated lane empty instead of borrowing the source', () => {
  // 译文单行模式只排一条 trans 行，这条行的内容只能来自译文 cue。
  assert.deepEqual(subtitle.resolveModeLines('trans'), ['trans']);

  // canvas-stage 的行门：`tcue && tcue.text`，投影后再按 trim 过滤。缺译（没有
  // transCue，或有但正文是空/全空白）在这一步就被整行丢掉，于是那一段既没有文字
  // 也没有背景框——绝不用原文顶替译文行。
  const laneText = (tcue) => subtitle.projectPunctuation(
    (tcue && tcue.text) || '', 'zh', true).trim();
  assert.equal(laneText(null), '');
  assert.equal(laneText({ id: 't1', sid: 's-w1', text: '' }), '');
  assert.equal(laneText({ id: 't1', sid: 's-w1', text: '   ' }), '');
  assert.equal(laneText({ id: 't1', sid: 's-w1', text: '阿尔法一。' }), '阿尔法一');

  // 回退助手已被移除：任何一个表面重新引入它都会让预览与烧录再次分叉。
  assert.equal(subtitle.translatedLaneFallback, undefined);
});

test('punctuation projection covers every language, stays optional, and is non-destructive', () => {
  const source = '你好，版本 1.2 真的可以吗？';
  assert.equal(subtitle.projectPunctuation(source, 'zh'), '你好 版本 1.2 真的可以吗？');
  assert.equal(subtitle.projectPunctuation(source, 'zh', false), source);
  assert.equal(subtitle.projectPunctuation('Hello, world.', 'en'), 'Hello world');
});
