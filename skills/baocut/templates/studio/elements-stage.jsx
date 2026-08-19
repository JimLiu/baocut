// BaoCut Subtitle Studio — 叠加元素的画布层（文本 / 图片 / 水印）。
//
// 几何全部来自 element-geometry.js（烧录端 render_plan.rs 的孪生），本文件只负责
// 把它翻译成 Konva 节点、接选中/拖动/双击编辑。层次上元素在字幕之上、主画面之上
// （§3.6：字幕不占轨道，垫在所有 overlay 轨之下），所以 canvas-stage 把这一层加在
// 字幕层后面。
//
// 文本元素的排版与外观复用字幕内核（`BCS_SUBTITLE` + canvas-stage 的
// lineMetrics/textAttrs）：元素 `style` 就是字幕样式 schema 的子集，两端零漂移。
// 与字幕的两处有意差异（都是烧录端 render_text_element 的现状）：
//   · 换行宽是 place.w（缺省画布宽 90%），不减内边距，也不吃 style.width；
//   · 每行都居中于印章中心（元素没有 textAlign 分支），底板圆角取 padH。
(() => {
const K = window.Konva;
const R = window.BCS_SUBTITLE;
const EG = window.BCS_ELEMENT_GEOMETRY;
const CANVAS = window.BCSCanvas;

if (!K) throw new Error('Konva failed to load');
if (!R) throw new Error('subtitle-rendering.js failed to load');
if (!EG) throw new Error('element-geometry.js failed to load');
if (!CANVAS) throw new Error('canvas-stage.jsx must load before elements-stage.jsx');

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const SELECTION_STROKE = '#3b63fb';

// ---------- 图片解码缓存 ----------
// 同一个 srcId 在时间轴上可能出现多次、也会随播放头每帧重建节点，所以
// HTMLImageElement 按 URL 缓存；加载完成再通知调用方重画一次该层。
const imageCache = new Map();

function imageEntry(url, onSettled) {
  const cached = imageCache.get(url);
  if (cached) {
    if (cached.state === 'loading' && onSettled) cached.waiters.push(onSettled);
    return cached;
  }
  const image = new Image();
  const entry = { state: 'loading', image, waiters: onSettled ? [onSettled] : [] };
  imageCache.set(url, entry);
  const settle = (state) => () => {
    entry.state = state;
    entry.waiters.splice(0).forEach((fn) => fn(entry));
  };
  image.onload = settle('ready');
  image.onerror = settle('error');
  image.src = url;
  return entry;
}

// ---------- 文本元素 ----------
function buildTextStamps(element, options) {
  const { width, height } = options;
  const style = (element.style && typeof element.style === 'object') ? element.style : {};
  const metrics = CANVAS.lineMetrics(style, width, height, false, false);
  const attrs = CANVAS.textAttrs(metrics);
  const text = R.transformText(String(element.text == null ? '' : element.text), metrics.lineStyle);
  const probe = new K.Text(attrs);
  const measure = (value) => {
    probe.text(value);
    return Math.ceil(probe.getTextWidth() * 100) / 100;
  };
  const wrapped = EG.textWrap(text, EG.textWrapWidth(element, width), measure);
  probe.destroy();
  const lineHeightPx = metrics.fontSize * metrics.lineHeight;
  const contentHeight = wrapped.lines.length * lineHeightPx;
  const placement = EG.textPlacement(element, {
    frameWidth: width,
    frameHeight: height,
    contentWidth: wrapped.width,
    contentHeight,
    padV: metrics.padV,
  });
  const boxWidth = wrapped.width + metrics.padH * 2;
  const boxHeight = contentHeight + metrics.padV * 2;
  const nodes = placement.stamps.map((stamp) => {
    const group = new K.Group({
      x: stamp.x,
      y: stamp.y,
      rotation: stamp.rotation,
      scaleX: placement.scaleX,
      scaleY: placement.scaleY,
      opacity: placement.opacity,
      listening: false,
    });
    if (metrics.backgroundOn) {
      group.add(new K.Rect({
        x: -boxWidth / 2,
        y: placement.topOffset - metrics.padV,
        width: boxWidth,
        height: boxHeight,
        // 圆角取 padH：元素底板走 render_plan 的 fill_round_rect(…, background_pad_h)，
        // 与字幕底板的 borderRadius 不是同一个来源，别在这里"顺手统一"。
        cornerRadius: metrics.padH,
        fill: CANVAS.canvasColor(metrics.lineStyle.backgroundColor, '#000000cc'),
        listening: false,
      }));
    }
    wrapped.lines.forEach((line, index) => {
      group.add(new K.Text({
        ...attrs,
        x: -line.width / 2,
        y: placement.topOffset + index * lineHeightPx + (lineHeightPx - metrics.fontSize) / 2,
        text: line.text,
      }));
    });
    return group;
  });
  return {
    nodes,
    placement,
    metrics,
    // 命中面 / 选中框：一枚透明矩形，钉在**锚点**（place.x/y）上，尺寸为含内边距的
    // 文本盒。平铺时印章有几百枚，它们只负责显示；可点、可拖、被选中框圈住的始终
    // 是锚点这一个对象 —— 拖动写回的也正是它那一维。
    anchor: anchorBox(placement, {
      x: -boxWidth / 2,
      y: placement.topOffset - metrics.padV,
      width: boxWidth,
      height: boxHeight,
    }),
  };
}

// 锚点命中面：位置取 placement.anchor，旋转只吃 place.rot（不含 tile.angle —— 那是
// 印章各自的花纹角度，不是这个对象的朝向）。
function anchorBox(placement, box) {
  const group = new K.Group({
    x: placement.anchor.x,
    y: placement.anchor.y,
    rotation: placement.rotation,
    scaleX: placement.scaleX,
    scaleY: placement.scaleY,
  });
  group.add(new K.Rect({ ...box, fill: 'rgba(0,0,0,0.001)', listening: true }));
  return group;
}

// ---------- 图片元素 ----------
function buildImageStamps(element, options) {
  const { width, height, mediaURL, onSettled } = options;
  const url = mediaURL(element.srcId);
  const entry = imageEntry(url, onSettled);
  if (entry.state !== 'ready') return null;
  const natural = { width: entry.image.naturalWidth || 1, height: entry.image.naturalHeight || 1 };
  const placement = EG.imagePlacement(element, {
    frameWidth: width,
    frameHeight: height,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
  });
  const boxWidth = placement.boxWidth;
  const boxHeight = placement.boxHeight;
  // fit：cover 取长边铺满并裁切，contain 完整放入。contain 的留边填充只做 black
  // （bg: 'blur' 的高斯留边本轮省略，见报告）。
  const ratio = placement.fit === 'contain'
    ? Math.min(boxWidth / natural.width, boxHeight / natural.height)
    : Math.max(boxWidth / natural.width, boxHeight / natural.height);
  const drawWidth = natural.width * ratio;
  const drawHeight = natural.height * ratio;
  const nodes = placement.stamps.map((stamp) => {
    const group = new K.Group({
      x: stamp.x,
      y: stamp.y,
      rotation: stamp.rotation,
      scaleX: placement.scaleX,
      scaleY: placement.scaleY,
      opacity: placement.opacity,
      offsetX: boxWidth / 2,
      offsetY: boxHeight / 2,
      listening: false,
      clipFunc: (context) => {
        const radius = Math.max(0, Math.min(placement.radius, Math.min(boxWidth, boxHeight) / 2));
        context.beginPath();
        if (radius <= 0) {
          context.rect(0, 0, boxWidth, boxHeight);
        } else {
          context.moveTo(radius, 0);
          context.arcTo(boxWidth, 0, boxWidth, boxHeight, radius);
          context.arcTo(boxWidth, boxHeight, 0, boxHeight, radius);
          context.arcTo(0, boxHeight, 0, 0, radius);
          context.arcTo(0, 0, boxWidth, 0, radius);
        }
        context.closePath();
      },
    });
    if (placement.fit === 'contain') {
      group.add(new K.Rect({ width: boxWidth, height: boxHeight, fill: '#000', listening: false }));
    }
    group.add(new K.Image({
      image: entry.image,
      x: (boxWidth - drawWidth) / 2,
      y: (boxHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
      listening: false,
    }));
    return group;
  });
  return {
    nodes,
    placement,
    metrics: null,
    anchor: anchorBox(placement, {
      x: -boxWidth / 2,
      y: -boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
    }),
  };
}

// ---------- 层装配 ----------
// 一次性重建整层：元素数量以个位数计，逐帧 diff 不值得。返回 { anchors } 供调用方
// 需要时定位（当前只有内部使用）。
function renderElements(options) {
  const {
    layer, stage, elements, width, height, selectedId, editingId, playing, mediaURL, actions,
  } = options;
  layer.destroyChildren();
  if (!elements || !elements.length) {
    layer.draw();
    return { count: 0 };
  }

  const guideAttrs = { stroke: SELECTION_STROKE, strokeWidth: 1, visible: false, listening: false };
  const vGuide = new K.Line({ points: [width / 2, 0, width / 2, height], ...guideAttrs });
  const hGuide = new K.Line({ points: [0, height / 2, width, height / 2], ...guideAttrs });
  const transformer = new K.Transformer({
    nodes: [],
    enabledAnchors: [],
    rotateEnabled: false,
    borderStroke: SELECTION_STROKE,
    borderStrokeWidth: 2,
    padding: 6,
    visible: false,
    listening: false,
  });

  let selectedAnchor = null;
  elements.forEach((element) => {
    const built = element.kind === 'image'
      ? buildImageStamps(element, { width, height, mediaURL, onSettled: actions.onImageReady })
      : buildTextStamps(element, { width, height });
    if (!built || !built.nodes.length) return;
    const selected = selectedId === element.id;
    const editing = editingId === element.id;
    const container = new K.Group({ listening: !editing });
    built.nodes.forEach((node) => container.add(node));
    const anchorNode = built.anchor;
    container.add(anchorNode);
    if (editing) container.visible(false);
    layer.add(container);
    const anchorCenter = { x: built.placement.anchor.x, y: built.placement.anchor.y };

    container.on('click tap', (event) => {
      event.cancelBubble = true;
      const action = actions.press({
        hasTarget: true,
        targetSelected: selected,
        select: () => actions.select(element),
      });
      if (action === 'passThrough') actions.select(element);
    });
    // 文本元素双击进内联编辑（图片没有可编辑的文本）。与字幕同款前提：已选中、
    // 已暂停 —— 播放中双击只会连击到播放/暂停策略上。
    if (element.kind === 'text') {
      container.on('dblclick dbltap', (event) => {
        event.cancelBubble = true;
        if (playing || !selected) return;
        actions.edit(
          element,
          anchorNode.getClientRect({ relativeTo: stage, skipShadow: true }),
          built.metrics,
        );
      });
    }
    container.on('mouseenter', () => {
      stage.container().style.cursor = selected && !playing ? 'grab' : 'default';
    });
    container.on('mouseleave', () => { stage.container().style.cursor = 'default'; });

    const draggable = selected && !playing && !editing;
    container.draggable(draggable);
    if (draggable) {
      container.dragBoundFunc((pos) => {
        // 吸附中线、钳制在画面内：判据作用在**锚点**上（平铺水印移动的就是锚点），
        // 与写回 place.x/y 的那一维一致。
        const rawX = anchorCenter.x + pos.x;
        const rawY = anchorCenter.y + pos.y;
        const centerX = clamp(Math.abs(rawX - width / 2) < 8 ? width / 2 : rawX,
          width * 0.02, width * 0.98);
        const centerY = clamp(Math.abs(rawY - height / 2) < 8 ? height / 2 : rawY,
          height * 0.02, height * 0.98);
        vGuide.visible(Math.abs(centerX - width / 2) < 1);
        hGuide.visible(Math.abs(centerY - height / 2) < 1);
        return { x: centerX - anchorCenter.x, y: centerY - anchorCenter.y };
      });
      container.on('dragstart', () => { stage.container().style.cursor = 'grabbing'; });
      container.on('dragend', () => {
        vGuide.hide();
        hGuide.hide();
        stage.container().style.cursor = 'grab';
        actions.move(element, container.x(), container.y());
        layer.batchDraw();
      });
    }
    if (selected && !editing) selectedAnchor = anchorNode;
  });

  layer.add(vGuide);
  layer.add(hGuide);
  layer.add(transformer);
  if (selectedAnchor) {
    transformer.nodes([selectedAnchor]);
    transformer.visible(true);
  }
  layer.draw();
  return { count: elements.length };
}

window.BCSElements = { renderElements, imageEntry };
})();
