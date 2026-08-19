// BaoCut Subtitle Studio — 叠加元素几何内核（文本 / 图片）。
//
// 真相是烧录端 `apps/cli/src/cmd/studio_export/render_plan.rs` 的
// `render_text_element` / `render_media_element` 与 `raster.rs::tile_stamp_points`：
// 本文件逐公式镜像它们，缺省值也逐个对齐（缺省不一致 = 预览与成片错位）。
// 无 React / Konva 依赖：画布层、单测与将来的导出预览消费同一份决策。
//
// 记两条容易踩的不对称（都是烧录端现状，不是笔误）：
//   1. 文本平铺与图片平铺**不是同一套网格**。文本按内容盒 step 在锚点 (x,y) 周围
//      铺 ±(ceil(边/step)+3) 行列；图片走 `tile_stamp_points`，在**画布中心**周围
//      按对角线长铺，再把整张点阵旋转到 tile.angle。
//   2. 文本的 gapX/gapY 只有 `unwrap_or(8/10)`，图片那条还有 `.max(2.0)` 下限。
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_ELEMENT_GEOMETRY = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // 与 studio_export.rs 的 REFERENCE_SHORT_EDGE 同值：radius 等「画布参考单位」
  // 字段按短边比例换算。
  const REFERENCE_SHORT_EDGE = 540;
  const VERTICAL_ALIGNS = ['top', 'center', 'bottom'];
  // 元素缺省值（render_plan.rs 收集元素时的 unwrap_or 链）。
  const DEFAULTS = Object.freeze({
    x: 50, y: 50, scale: 1, rot: 0, opacity: 1,
    textWidthRatio: 0.9,     // place.w 缺席时换行宽 = 画布宽 × 0.9
    imageWidthPct: 34,       // pip 缺席宽度百分比
    tileAngle: -30, tileGapX: 8, tileGapY: 10, tileStagger: true,
    mode: 'pip', fit: 'cover', bg: 'black',
  });

  // 只认真正的有限数值（typeof 纪律，同 subtitle-rendering.js 的 linePosition）：
  // 投影里的 `place` / `tile` 是 serde 直出，**缺席字段序列化成 null 而不是省略**
  // （Place/Tile 的 Option 字段没有 skip_serializing_if）。`Number(null) === 0`
  // 会把"缺席"读成 0：place.w 缺席就变成 1% 换行宽、place.x 缺席就贴到左边缘，
  // 而烧录端的 as_f64() 对 null 是 None → 走缺省。宽松的换算在这里就是错的。
  const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback);
  const isBlank = (text) => !String(text).trim();
  const roundPercent = (value) => Math.round(finite(value, 0) * 10) / 10;

  function verticalAlignValue(value) {
    return typeof value === 'string' && VERTICAL_ALIGNS.indexOf(value) >= 0 ? value : null;
  }

  // 锚点 anchor 是这块内容的哪条边，返回顶边坐标（镜像 raster.rs::anchor_block）。
  function anchorBlock(anchor, height, align) {
    if (align === 'top') return anchor;
    if (align === 'bottom') return anchor - height;
    return anchor - height / 2;
  }

  function placeOf(element) {
    const place = (element && element.place) || {};
    return place && typeof place === 'object' ? place : {};
  }

  function tileOf(element) {
    const tile = element && element.tile;
    return tile && typeof tile === 'object' && tile.on ? tile : null;
  }

  // 通用变换：scale / scaleY / rot / opacity（缺省与烧录端一致；scaleY 缺席跟随 scale）。
  function transformOf(element) {
    const place = placeOf(element);
    const scale = finite(place.scale, DEFAULTS.scale);
    return {
      scaleX: scale,
      scaleY: finite(place.scaleY, scale),
      rotation: finite(place.rot, DEFAULTS.rot),
      opacity: Math.max(0, Math.min(1, finite(place.opacity, DEFAULTS.opacity))),
    };
  }

  // ---------- 投影消费 ----------
  // `studio/data.json.timeline.tracks[]`：元素窗口已求值为时间轴秒（词锚点已解析），
  // `end` 缺席时投影already填成片尾。可见判据是半开区间 [start, end)。
  // 顺序 = 轨道数组序 × 轨内数组序（§3.6：没有隐式 canonicalRank），字幕层垫在
  // 所有 overlay 轨之下由画布的图层顺序表达，不在这里排。
  function visibleElements(tracks, time, duration) {
    const t = finite(time, 0);
    const end = finite(duration, 0);
    const out = [];
    (Array.isArray(tracks) ? tracks : []).forEach((track) => {
      if (!track || track.hidden === true) return;
      (Array.isArray(track.elements) ? track.elements : []).forEach((element) => {
        if (!element || element.hidden === true) return;
        // 本轮只渲染 text / image：video 元素要解码第二条媒体流（B-roll，D16 省略），
        // audio 元素没有画面。
        if (element.kind !== 'text' && element.kind !== 'image') return;
        const start = finite(element.start, NaN);
        const stop = finite(element.end, end);
        if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return;
        if (t < start || t >= stop) return;
        out.push({ ...element, trackId: track.id || null, start, end: stop });
      });
    });
    return out;
  }

  // ---------- 文本元素 ----------
  // 镜像 raster.rs::layout_text 在 `words` 为空时的行为：逐 grapheme 断行
  // （元素没有词时间，timed_runs 只吐一条无词 run，于是每个字都是独立断点），
  // 行首空白丢弃，最后 retain 掉没有任何 chunk 的空行。
  function textWrap(text, wrapWidth, measure) {
    const limit = Math.max(1, finite(wrapWidth, 1));
    const lines = [{ text: '', width: 0 }];
    Array.from(String(text == null ? '' : text)).forEach((piece) => {
      if (piece === '\n') {
        lines.push({ text: '', width: 0 });
        return;
      }
      const width = finite(measure(piece), 0);
      let line = lines[lines.length - 1];
      if (line.width > 0 && line.width + width > limit && !isBlank(piece)) {
        lines.push({ text: '', width: 0 });
        line = lines[lines.length - 1];
      }
      if (line.width === 0 && isBlank(piece)) return;
      line.text += piece;
      line.width += width;
    });
    const kept = lines.filter((line) => line.text.length > 0);
    if (!kept.length) kept.push({ text: '', width: 0 });
    return { lines: kept, width: kept.reduce((max, line) => Math.max(max, line.width), 0) };
  }

  // 换行宽：place.w 是画布宽百分比（下限 1%），缺席退回画布宽的 90%。
  function textWrapWidth(element, frameWidth) {
    const width = Math.max(0, finite(frameWidth, 0));
    const w = placeOf(element).w;
    return typeof w === 'number' && Number.isFinite(w)
      ? width * Math.max(1, w) / 100
      : width * DEFAULTS.textWidthRatio;
  }

  // 元素锚点：place.x/y 换算成画面像素中心（缺省 50/50）。这是"这个对象在哪"的
  // 唯一答案 —— 拖动写它、选中框画它。平铺元素**不能**拿第一枚印章当锚点：文本的
  // 网格从 -rows/-cols 起铺，第一枚在画面外；图片的网格更是以画布中心为原点。
  function anchorPoint(element, frameWidth, frameHeight) {
    const place = placeOf(element);
    return {
      x: Math.max(0, finite(frameWidth, 0)) * finite(place.x, DEFAULTS.x) / 100,
      y: Math.max(0, finite(frameHeight, 0)) * finite(place.y, DEFAULTS.y) / 100,
    };
  }

  // 平铺印章中心（文本）：step = 内容尺寸 + 画布尺寸 × gap%，行列 ±(ceil(边/step)+3)，
  // 奇数行错开半步，每个印章旋转 rot + tile.angle。
  function textStamps(element, options) {
    const { frameWidth, frameHeight, contentWidth, contentHeight } = options;
    const transform = transformOf(element);
    const { x, y } = anchorPoint(element, frameWidth, frameHeight);
    const tile = tileOf(element);
    if (!tile) return [{ x, y, rotation: transform.rotation }];
    const gapX = finite(tile.gapX, DEFAULTS.tileGapX);
    const gapY = finite(tile.gapY, DEFAULTS.tileGapY);
    const stepX = Math.max(1, finite(contentWidth, 0) + frameWidth * gapX / 100);
    const stepY = Math.max(1, finite(contentHeight, 0) + frameHeight * gapY / 100);
    const columns = Math.ceil(frameWidth / stepX) + 3;
    const rows = Math.ceil(frameHeight / stepY) + 3;
    const rotation = transform.rotation + finite(tile.angle, DEFAULTS.tileAngle);
    const stagger = tile.stagger == null ? DEFAULTS.tileStagger : Boolean(tile.stagger);
    const stamps = [];
    for (let row = -rows; row <= rows; row += 1) {
      // Rust 的 `row.rem_euclid(2) != 0`：负数行也按正余数判奇偶。
      const offset = stagger && Math.abs(row % 2) === 1 ? stepX / 2 : 0;
      for (let column = -columns; column <= columns; column += 1) {
        stamps.push({ x: x + column * stepX + offset, y: y + row * stepY, rotation });
      }
    }
    return stamps;
  }

  // 文本元素的完整摆放：印章列表 + 块级垂直锚点换算出的字形顶边（相对印章中心）。
  //
  // 锚点钉的是**含内边距的盒子**（render_plan.rs 的注释：先按 height + 2×pad_v
  // 挂块，再进 pad_v 得到字形顶边），缺省 center。
  function textPlacement(element, options) {
    const contentWidth = Math.max(0, finite(options.contentWidth, 0));
    const contentHeight = Math.max(0, finite(options.contentHeight, 0));
    const padV = Math.max(0, finite(options.padV, 0));
    const align = verticalAlignValue(element && element.verticalAlign) || 'center';
    const transform = transformOf(element);
    const stamps = textStamps(element, {
      frameWidth: options.frameWidth,
      frameHeight: options.frameHeight,
      contentWidth,
      contentHeight,
    });
    const anchor = anchorPoint(element, options.frameWidth, options.frameHeight);
    return {
      ...transform,
      stamps,
      // 锚点带 place.rot（不含 tile.angle —— 那是印章各自的花纹角度）。
      anchor: { ...anchor, rotation: transform.rotation },
      contentWidth,
      contentHeight,
      // 相对印章中心的字形顶边偏移：绝对顶边 = 印章中心 y + topOffset。
      topOffset: anchorBlock(0, contentHeight + padV * 2, align) + padV,
      verticalAlign: align,
    };
  }

  // ---------- 图片元素 ----------
  // 镜像 raster.rs::tile_stamp_points：印章尺寸 + 画布尺寸 × gap%（gap 有 2% 下限），
  // 以画布中心为原点、按对角线长铺满，奇数行错开半步。返回的是**未旋转**的相对点，
  // 调用方再整体旋转（render_media_element 就是这么做的）。
  function tileStampPoints(frameWidth, frameHeight, stampWidth, stampHeight, tile) {
    const width = Math.max(0, finite(frameWidth, 0));
    const height = Math.max(0, finite(frameHeight, 0));
    // 下限 1px 只是防御除零/死循环：正常输入下 gap 有 2% 下限，step 必然为正。
    const stepX = Math.max(1, finite(stampWidth, 0)
      + width * Math.max(2, finite(tile.gapX, DEFAULTS.tileGapX)) / 100);
    const stepY = Math.max(1, finite(stampHeight, 0)
      + height * Math.max(2, finite(tile.gapY, DEFAULTS.tileGapY)) / 100);
    const diagonal = Math.hypot(width, height);
    const stagger = tile.stagger == null ? DEFAULTS.tileStagger : Boolean(tile.stagger);
    const points = [];
    let row = 0;
    for (let y = -diagonal / 2; y <= diagonal / 2 + stepY; y += stepY) {
      const offset = stagger && row % 2 === 1 ? stepX / 2 : 0;
      for (let x = -diagonal / 2 - stepX + offset; x <= diagonal / 2 + stepX; x += stepX) {
        points.push({ x, y });
      }
      row += 1;
    }
    return points;
  }

  // 图片/视频元素的盒子与印章。naturalWidth/Height 由调用方从已加载的图片给出
  // （投影里没有自然尺寸；`putSource.source.naturalW/H` 是给 CLI 的记录）。
  function imagePlacement(element, options) {
    const frameWidth = Math.max(1, finite(options.frameWidth, 1));
    const frameHeight = Math.max(1, finite(options.frameHeight, 1));
    const naturalWidth = Math.max(1, finite(options.naturalWidth, 1));
    const naturalHeight = Math.max(1, finite(options.naturalHeight, 1));
    const place = placeOf(element);
    const transform = transformOf(element);
    const tile = tileOf(element);
    const mode = element && element.mode ? element.mode : DEFAULTS.mode;
    const fit = element && element.fit ? element.fit : DEFAULTS.fit;
    const background = element && element.bg ? element.bg : DEFAULTS.bg;
    const fullscreen = mode === 'fullscreen' && !tile;
    let boxWidth;
    let boxHeight;
    let centerX;
    let centerY;
    if (fullscreen) {
      boxWidth = frameWidth;
      boxHeight = frameHeight;
      centerX = frameWidth / 2;
      centerY = frameHeight / 2;
    } else {
      boxWidth = frameWidth * Math.max(1, finite(place.w, DEFAULTS.imageWidthPct)) / 100;
      boxHeight = boxWidth * naturalHeight / naturalWidth;
      centerX = frameWidth * finite(place.x, DEFAULTS.x) / 100;
      centerY = frameHeight * finite(place.y, DEFAULTS.y) / 100;
    }
    // 局部画布按整数像素建立（Rust `round().max(1)`），圆角/椭圆遮罩作用在它上面。
    const localWidth = Math.max(1, Math.round(boxWidth));
    const localHeight = Math.max(1, Math.round(boxHeight));
    const shortEdge = Math.min(frameWidth, frameHeight);
    // radius 是「画布参考单位」：按短边 / 540 换算，且只在 pip 或平铺时生效。
    const radius = mode === 'pip' || tile
      ? Math.max(0, finite(place.radius, 0)) * shortEdge / REFERENCE_SHORT_EDGE
      : 0;
    let stamps;
    if (tile) {
      const rotation = finite(tile.angle, DEFAULTS.tileAngle) + transform.rotation;
      const radians = rotation * Math.PI / 180;
      stamps = tileStampPoints(frameWidth, frameHeight, localWidth, localHeight, tile)
        .map((point) => {
          const scaledX = point.x * transform.scaleX;
          const scaledY = point.y * transform.scaleY;
          return {
            x: frameWidth / 2 + scaledX * Math.cos(radians) - scaledY * Math.sin(radians),
            y: frameHeight / 2 + scaledX * Math.sin(radians) + scaledY * Math.cos(radians),
            rotation,
          };
        });
    } else {
      stamps = [{ x: centerX, y: centerY, rotation: transform.rotation }];
    }
    return {
      ...transform,
      mode,
      fit,
      background,
      fullscreen,
      boxWidth: localWidth,
      boxHeight: localHeight,
      centerX,
      centerY,
      radius,
      tiled: Boolean(tile),
      stamps,
      // 锚点是盒子中心：pip / 平铺时它就是 place.x/y（拖动写它、选中框画它），
      // fullscreen 时退化为画布中心。
      anchor: { x: centerX, y: centerY, rotation: transform.rotation },
    };
  }

  // 拖动写回：把画面坐标位移换成 place.x/y 的百分比（一位小数，与字幕拖动同精度），
  // 并把锚点钳制在画面内（原型 elements-stage.jsx 的 2…98）。
  function movedPlace(element, options) {
    const frameWidth = Math.max(1, finite(options.frameWidth, 1));
    const frameHeight = Math.max(1, finite(options.frameHeight, 1));
    const place = placeOf(element);
    const x = finite(place.x, DEFAULTS.x) + finite(options.dx, 0) / frameWidth * 100;
    const y = finite(place.y, DEFAULTS.y) + finite(options.dy, 0) / frameHeight * 100;
    return {
      x: roundPercent(Math.max(2, Math.min(98, x))),
      y: roundPercent(Math.max(2, Math.min(98, y))),
    };
  }

  return {
    REFERENCE_SHORT_EDGE,
    DEFAULTS,
    anchorBlock,
    anchorPoint,
    imagePlacement,
    movedPlace,
    placeOf,
    roundPercent,
    textPlacement,
    textStamps,
    textWrap,
    textWrapWidth,
    tileOf,
    tileStampPoints,
    transformOf,
    verticalAlignValue,
    visibleElements,
  };
});
