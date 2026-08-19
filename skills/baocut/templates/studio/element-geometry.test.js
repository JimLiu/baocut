const test = require('node:test');
const assert = require('node:assert');
const EG = require('./element-geometry.js');

// 画布：960×540（短边 540 = REFERENCE_SHORT_EDGE，radius 换算恒等，便于对拍）。
const W = 960;
const H = 540;
// 测量器：每个字 10px 宽，行内断行判据因此可以手算。
const measure = () => 10;

test('visibleElements 按轨道序 × 轨内序过滤半开区间与 hidden', () => {
  const tracks = [
    { id: 'overlay', elements: [
      { id: 'el-1', kind: 'text', text: 'a', start: 0, end: 5 },
      { id: 'el-2', kind: 'text', text: 'b', start: 5, end: 10 },
      { id: 'el-3', kind: 'text', text: 'c', start: 0, end: 10, hidden: true },
      { id: 'el-4', kind: 'video', srcId: 'src-a', start: 0, end: 10 },
      { id: 'el-5', kind: 'audio', srcId: 'src-b', start: 0, end: 10 },
    ] },
    { id: 'hidden-track', hidden: true, elements: [{ id: 'el-6', kind: 'text', text: 'd', start: 0, end: 10 }] },
    { id: 'wm', elements: [{ id: 'el-7', kind: 'text', role: 'watermark', text: 'w', start: 0, end: 12 }] },
  ];
  assert.deepStrictEqual(EG.visibleElements(tracks, 0, 12).map((el) => el.id), ['el-1', 'el-7']);
  // 区间是 [start, end)：5.0 属于第二条，不属于第一条。
  assert.deepStrictEqual(EG.visibleElements(tracks, 5, 12).map((el) => el.id), ['el-2', 'el-7']);
  assert.deepStrictEqual(EG.visibleElements(tracks, 11, 12).map((el) => el.id), ['el-7']);
  assert.deepStrictEqual(EG.visibleElements(tracks, 12, 12).map((el) => el.id), []);
  // trackId 随元素带出，供面板/时间轴显示归属。
  assert.strictEqual(EG.visibleElements(tracks, 0, 12)[1].trackId, 'wm');
});

test('visibleElements 用 duration 兜 end 缺失，并丢掉非法窗口', () => {
  const tracks = [{ id: 'wm', elements: [
    { id: 'el-1', kind: 'text', text: 'w', start: 0 },
    { id: 'el-2', kind: 'text', text: 'x', start: 4, end: 4 },
    { id: 'el-3', kind: 'text', text: 'y' },
  ] }];
  assert.deepStrictEqual(EG.visibleElements(tracks, 7.5, 8).map((el) => el.id), ['el-1']);
  assert.strictEqual(EG.visibleElements(tracks, 0, 8)[0].end, 8);
});

test('textWrapWidth：place.w 是画布宽百分比，缺席退回 90%', () => {
  assert.strictEqual(EG.textWrapWidth({ place: { w: 50 } }, W), 480);
  assert.strictEqual(EG.textWrapWidth({ place: {} }, W), 864);
  assert.strictEqual(EG.textWrapWidth({}, W), 864);
  // 下限 1%（Rust 的 width.max(1.0)）。
  assert.strictEqual(EG.textWrapWidth({ place: { w: 0 } }, W), 9.6);
});

test('textWrap 逐字断行、丢行首空白、retain 空行', () => {
  const wrapped = EG.textWrap('abcde', 30, measure);
  assert.deepStrictEqual(wrapped.lines.map((line) => line.text), ['abc', 'de']);
  assert.strictEqual(wrapped.width, 30);
  // 行首空白不进新行（Rust 的 `line.width == 0 && piece.trim().is_empty()` 分支）；
  // 行尾空白照旧留在上一行并计入行宽 —— 这是烧录端 layout_text 的现状，字幕那条
  // 路径（canvas-stage 的 wrapRuns）才会把行尾空白弹掉，两者有意不同。
  assert.deepStrictEqual(EG.textWrap('ab cd', 20, measure).lines.map((line) => line.text), ['ab ', 'cd']);
  // 显式换行保留，空行被 retain 掉。
  assert.deepStrictEqual(EG.textWrap('a\n\nb', 100, measure).lines.map((line) => line.text), ['a', 'b']);
  // 空文本仍给一行零宽，调用方不必分情况。
  assert.deepStrictEqual(EG.textWrap('', 100, measure).lines, [{ text: '', width: 0 }]);
});

// 投影里的 place / tile 是 serde 直出：Option 字段缺席时序列化成 **null**，不是省略。
// `Number(null) === 0` 会把缺席读成 0（换行宽 1%、锚点贴边、缩放归零），而烧录端
// as_f64() 对 null 是 None → 走缺省。这一组把两端钉在一起。
test('null 值的 place / tile 字段等于缺席，不等于 0', () => {
  const projected = {
    id: 'el-1',
    kind: 'text',
    place: { x: 50, y: 40, w: null, scale: null, scaleY: null, rot: null, opacity: null, radius: null },
    tile: { on: true, angle: null, gapX: null, gapY: null, stagger: null },
  };
  assert.strictEqual(EG.textWrapWidth(projected, W), W * 0.9);
  assert.deepStrictEqual(EG.transformOf(projected), { scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 });
  const stamps = EG.textStamps(projected, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60,
  });
  assert.strictEqual(stamps[0].rotation, -30);
  const stepY = 60 + H * 10 / 100;
  const anchorY = H * 40 / 100;
  const row1 = stamps.filter((stamp) => Math.abs(stamp.y - (anchorY + stepY)) < 1e-9).map((stamp) => stamp.x);
  assert.ok(Math.min(...row1.map((x) => Math.abs(x - (480 + (200 + W * 8 / 100) / 2)))) < 1e-9);
  const image = EG.imagePlacement(
    { kind: 'image', place: { x: null, y: null, w: null, radius: null } },
    { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 100 },
  );
  assert.strictEqual(image.boxWidth, Math.round(W * 0.34));
  assert.strictEqual(image.centerX, W / 2);
  assert.strictEqual(image.centerY, H / 2);
  assert.strictEqual(image.radius, 0);
  assert.deepStrictEqual(EG.movedPlace(projected, { dx: 0, dy: 0, frameWidth: W, frameHeight: H }),
    { x: 50, y: 40 });
});

test('transformOf：scaleY 缺席跟随 scale，opacity 钳制到 0…1', () => {
  assert.deepStrictEqual(EG.transformOf({ place: { scale: 1.5 } }), {
    scaleX: 1.5, scaleY: 1.5, rotation: 0, opacity: 1,
  });
  assert.deepStrictEqual(EG.transformOf({ place: { scale: 2, scaleY: 0.5, rot: -12, opacity: 0.4 } }), {
    scaleX: 2, scaleY: 0.5, rotation: -12, opacity: 0.4,
  });
  assert.strictEqual(EG.transformOf({ place: { opacity: 3 } }).opacity, 1);
  assert.strictEqual(EG.transformOf({}).scaleX, 1);
});

test('textPlacement：缺省 place 居中，锚点换算出字形顶边', () => {
  const placement = EG.textPlacement({}, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60, padV: 10,
  });
  assert.deepStrictEqual(placement.stamps, [{ x: 480, y: 270, rotation: 0 }]);
  // center：含 padding 的盒子（60 + 20）居中 → 顶边 -40，再进 padV → -30。
  assert.strictEqual(placement.topOffset, -30);
  assert.strictEqual(placement.verticalAlign, 'center');
  const top = EG.textPlacement({ verticalAlign: 'top' }, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60, padV: 10,
  });
  assert.strictEqual(top.topOffset, 10);
  const bottom = EG.textPlacement({ verticalAlign: 'bottom' }, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60, padV: 10,
  });
  assert.strictEqual(bottom.topOffset, -70);
  // 非白名单值一律视为缺席（与内核 verticalAlignValue 同纪律）。
  assert.strictEqual(EG.verticalAlignValue('Top'), null);
});

test('textStamps 平铺：step、行列数、奇数行错开半步、角度缺省 -30', () => {
  const element = { place: { x: 50, y: 50 }, tile: { on: true } };
  const stamps = EG.textStamps(element, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60,
  });
  const stepX = 200 + W * 8 / 100;    // 276.8
  const stepY = 60 + H * 10 / 100;    // 114
  const columns = Math.ceil(W / stepX) + 3;   // 4 + 3 = 7
  const rows = Math.ceil(H / stepY) + 3;      // 5 + 3 = 8
  assert.strictEqual(stamps.length, (columns * 2 + 1) * (rows * 2 + 1));
  const anchor = stamps.find((stamp) => stamp.y === 270);
  assert.ok(anchor);
  assert.strictEqual(stamps[0].rotation, -30);
  // 锚点所在行（row 0）不错开；相邻行错开半步。
  const row0 = stamps.filter((stamp) => Math.abs(stamp.y - 270) < 1e-9).map((stamp) => stamp.x);
  const row1 = stamps.filter((stamp) => Math.abs(stamp.y - (270 + stepY)) < 1e-9).map((stamp) => stamp.x);
  assert.ok(row0.includes(480));
  assert.ok(Math.min(...row1.map((x) => Math.abs(x - (480 + stepX / 2)))) < 1e-9);
  // stagger 关掉后两行对齐。
  const straight = EG.textStamps({ place: {}, tile: { on: true, stagger: false } }, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60,
  });
  const straightRow1 = straight.filter((stamp) => Math.abs(stamp.y - (270 + stepY)) < 1e-9);
  assert.ok(straightRow1.some((stamp) => Math.abs(stamp.x - 480) < 1e-9));
  // tile.on 为假 = 整对象不生效（schema 也不落盘）。
  assert.strictEqual(EG.textStamps({ place: {}, tile: { on: false } }, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60,
  }).length, 1);
  // rot 与 tile.angle 相加。
  assert.strictEqual(EG.textStamps({ place: { rot: 15 }, tile: { on: true, angle: -45 } }, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60,
  })[0].rotation, -30);
});

// 平铺时"这个对象在哪"必须仍是 place.x/y：文本网格从 -rows/-cols 起铺、图片网格以
// 画布中心为原点，拿第一枚印章当锚点会把命中面和选中框甩到画面外（水印因此点不中）。
test('平铺元素的锚点是 place.x/y，不是第一枚印章', () => {
  const watermark = { kind: 'text', role: 'watermark', place: { x: 85, y: 10, w: 22 }, tile: { on: true } };
  const placement = EG.textPlacement(watermark, {
    frameWidth: W, frameHeight: H, contentWidth: 100, contentHeight: 24, padV: 4,
  });
  assert.deepStrictEqual(placement.anchor, { x: W * 0.85, y: H * 0.10, rotation: 0 });
  // 第一枚印章在画面外（网格左上角），锚点不受它影响。
  assert.ok(placement.stamps[0].x < 0 && placement.stamps[0].y < 0);
  // 锚点不吃 tile.angle（那是印章花纹角度），但吃 place.rot。
  assert.strictEqual(EG.textPlacement({ ...watermark, place: { ...watermark.place, rot: 12 } }, {
    frameWidth: W, frameHeight: H, contentWidth: 100, contentHeight: 24, padV: 4,
  }).anchor.rotation, 12);
  const image = EG.imagePlacement(
    { kind: 'image', place: { x: 85, y: 10, w: 10 }, tile: { on: true } },
    { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 100 },
  );
  assert.deepStrictEqual(image.anchor, { x: W * 0.85, y: H * 0.10, rotation: 0 });
  assert.deepStrictEqual(EG.anchorPoint({ place: { x: 25, y: 75 } }, W, H), { x: W * 0.25, y: H * 0.75 });
});

test('imagePlacement pip：宽按 w%、高按自然比例、中心按 x/y%', () => {
  const placement = EG.imagePlacement(
    { kind: 'image', place: { x: 71, y: 29, w: 34, radius: 28 } },
    { frameWidth: W, frameHeight: H, naturalWidth: 800, naturalHeight: 400 },
  );
  assert.strictEqual(placement.boxWidth, Math.round(W * 0.34));       // 326
  assert.strictEqual(placement.boxHeight, Math.round(W * 0.34 / 2));  // 163
  assert.ok(Math.abs(placement.centerX - W * 0.71) < 1e-9);
  assert.ok(Math.abs(placement.centerY - H * 0.29) < 1e-9);
  // 短边正好 540 时 radius 是恒等换算。
  assert.strictEqual(placement.radius, 28);
  assert.strictEqual(placement.mode, 'pip');
  assert.strictEqual(placement.fit, 'cover');
  assert.strictEqual(placement.stamps.length, 1);
  assert.deepStrictEqual(placement.stamps[0], placement.anchor);
  // w 缺席退回 34%。
  assert.strictEqual(
    EG.imagePlacement({ kind: 'image', place: {} }, { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 100 }).boxWidth,
    Math.round(W * 0.34),
  );
});

test('imagePlacement radius 随短边缩放，fullscreen 铺满且不吃 radius', () => {
  const half = EG.imagePlacement(
    { kind: 'image', place: { radius: 28 } },
    { frameWidth: 480, frameHeight: 270, naturalWidth: 100, naturalHeight: 100 },
  );
  assert.ok(Math.abs(half.radius - 28 * 270 / 540) < 1e-9);
  const full = EG.imagePlacement(
    { kind: 'image', mode: 'fullscreen', fit: 'contain', bg: 'black', place: { radius: 28 } },
    { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 400 },
  );
  assert.strictEqual(full.boxWidth, W);
  assert.strictEqual(full.boxHeight, H);
  assert.strictEqual(full.centerX, W / 2);
  assert.strictEqual(full.centerY, H / 2);
  assert.strictEqual(full.radius, 0);
  assert.strictEqual(full.fullscreen, true);
  assert.strictEqual(full.background, 'black');
});

test('imagePlacement 平铺：fullscreen 也退回 pip 盒，点阵绕画布中心旋转', () => {
  const tiled = EG.imagePlacement(
    { kind: 'image', mode: 'fullscreen', place: { w: 10 }, tile: { on: true, angle: 0, gapX: 100, gapY: 100 } },
    { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 100 },
  );
  // 平铺时即便 mode 是 fullscreen 也按 pip 盒盖印（render_media_element 的
  // `(true, Fullscreen)` 分支）。
  assert.strictEqual(tiled.fullscreen, false);
  assert.strictEqual(tiled.boxWidth, 96);
  assert.strictEqual(tiled.tiled, true);
  // angle 0 时点阵不旋转：同一行的印章 y 相同、x 间距恰好一个 step（点阵原点在
  // 画布中心加上 -对角线/2 的起点偏移，所以不必落在正中）。
  const stepX = 96 + W;      // gapX 100% → 960
  const row = tiled.stamps.filter((stamp) => Math.abs(stamp.y - tiled.stamps[0].y) < 1e-9)
    .map((stamp) => stamp.x)
    .sort((left, right) => left - right);
  assert.ok(row.length >= 2);
  assert.ok(Math.abs(row[1] - row[0] - stepX) < 1e-9);
  // 未旋转时印章行仍平行于画面：第一行的 y 就是点阵起点。
  assert.ok(Math.abs(tiled.stamps[0].y - (H / 2 - Math.hypot(W, H) / 2)) < 1e-9);
  // 锚点仍是 place.x/y（拖动写它，选中框画它）。
  assert.deepStrictEqual(tiled.anchor, { x: W * 0.5, y: H * 0.5, rotation: 0 });
});

test('tileStampPoints：gap 有 2% 下限，stagger 只错开奇数行', () => {
  const points = EG.tileStampPoints(400, 300, 40, 30, { on: true, gapX: 0, gapY: 0 });
  const stepX = 40 + 400 * 2 / 100;   // gap 下限 2% → 48
  const stepY = 30 + 300 * 2 / 100;   // → 36
  const first = points[0];
  const diagonal = Math.hypot(400, 300);
  assert.ok(Math.abs(first.y + diagonal / 2) < 1e-9);
  assert.ok(Math.abs(first.x - (-diagonal / 2 - stepX)) < 1e-9);
  const row1 = points.filter((point) => Math.abs(point.y - (-diagonal / 2 + stepY)) < 1e-9);
  assert.ok(Math.abs(row1[0].x - (-diagonal / 2 - stepX + stepX / 2)) < 1e-9);
});

test('movedPlace：位移换成一位小数百分比并钳制在 2…98', () => {
  const element = { place: { x: 50, y: 40 } };
  assert.deepStrictEqual(EG.movedPlace(element, { dx: 96, dy: 54, frameWidth: W, frameHeight: H }),
    { x: 60, y: 50 });
  assert.deepStrictEqual(EG.movedPlace(element, { dx: -W, dy: -H, frameWidth: W, frameHeight: H }),
    { x: 2, y: 2 });
  assert.deepStrictEqual(EG.movedPlace(element, { dx: W, dy: H, frameWidth: W, frameHeight: H }),
    { x: 98, y: 98 });
  // 缺省锚点是 50/50。
  assert.deepStrictEqual(EG.movedPlace({}, { dx: 0, dy: 0, frameWidth: W, frameHeight: H }),
    { x: 50, y: 50 });
});
