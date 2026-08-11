// BaoCut Subtitle Studio — Konva preview surface.
// A hidden HTMLMediaElement remains the decoder and playback clock. Konva.Image
// paints video frames, while the VoiceInk-compatible presentation kernel owns
// subtitle timing, scale, style, layout, and seek-safe animation decisions.
(() => {
const { useEffect, useRef, useState } = React;
const K = window.Konva;
const R = window.BCS_SUBTITLE;
const FONT_CATALOG = window.BCS_FONT_CATALOG;

if (!K) throw new Error('Konva failed to load');
if (!R) throw new Error('subtitle-rendering.js failed to load');
if (!FONT_CATALOG) throw new Error('font-catalog.js failed to load');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function canvasColor(value, fallback) {
  const v = value || fallback;
  const color = R.parseColor(v);
  return color
    ? `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${color.a.toFixed(3)})`
    : v;
}

function canvasFontFamily(value) {
  return FONT_CATALOG.stackFor(value);
}

function lineMetrics(st, width, height, isTrans, compactOriginal) {
  const layout = R.layoutMetrics(st, width, height, isTrans, compactOriginal);
  const lineStyle = layout.lineStyle;
  const effects = R.effectStyle(lineStyle);
  const bold = lineStyle.bold != null
    ? lineStyle.bold
    : ['bold', 'semibold', 'heavy'].includes(lineStyle.fontWeight);
  const italic = Boolean(lineStyle.italic) || lineStyle.fontStyle === 'italic';
  const shadowAngle = effects.shadowRotation * Math.PI / 180;
  const shadowDistance = effects.shadowDistance * layout.fontSize;
  const glowBlur = effects.glowOn
    ? Math.max(1, effects.glowRange / 100 * layout.fontSize * 0.9)
    : 0;
  return {
    ...layout,
    fontFamily: canvasFontFamily(lineStyle.fontFamily || st.fontFamily),
    fontStyle: italic && bold ? 'italic bold' : italic ? 'italic' : bold ? 'bold' : 'normal',
    fill: canvasColor(lineStyle.fontColor || st.fontColor, '#fff'),
    align: lineStyle.textAlign || lineStyle.align || st.align || 'center',
    textDecoration: lineStyle.underline ? 'underline' : '',
    stroke: effects.outlineOn ? canvasColor(effects.outlineColor, '#000') : undefined,
    // Konva centers the stroke on the glyph outline. VoiceInk's persisted
    // percentage describes the visible half, so the Canvas stroke is doubled.
    strokeWidth: effects.outlineOn
      ? Math.max(0.5, layout.fontSize * effects.outlineWidth / 100)
      : 0,
    shadowEnabled: effects.glowOn || effects.shadowOn,
    shadowColor: effects.glowOn
      ? R.colorWithAlpha(effects.glowColor, effects.glowIntensity / 100)
      : effects.shadowColor,
    shadowBlur: effects.glowOn ? glowBlur : effects.shadowBlur * layout.fontSize,
    shadowOffsetX: effects.glowOn ? 0 : Math.cos(shadowAngle) * shadowDistance,
    shadowOffsetY: effects.glowOn ? 0 : Math.sin(shadowAngle) * shadowDistance,
    shadowOpacity: 1,
  };
}

function textAttrs(m) {
  return {
    fontFamily: m.fontFamily,
    fontSize: m.fontSize,
    fontStyle: m.fontStyle,
    letterSpacing: m.letterSpacing,
    fill: m.fill,
    stroke: m.stroke,
    strokeWidth: m.strokeWidth,
    fillAfterStrokeEnabled: true,
    shadowEnabled: m.shadowEnabled,
    shadowColor: m.shadowColor,
    shadowBlur: m.shadowBlur,
    shadowOffsetX: m.shadowOffsetX,
    shadowOffsetY: m.shadowOffsetY,
    shadowOpacity: m.shadowOpacity,
    textDecoration: m.textDecoration,
    perfectDrawEnabled: false,
    listening: false,
  };
}

function timedRuns(text, words) {
  const runs = [];
  let cursor = 0;
  (words || []).forEach((word, index) => {
    const raw = String(word.w == null ? word.text || '' : word.w);
    if (!raw) return;
    let found = text.indexOf(raw, cursor);
    if (found < 0) found = text.toLocaleLowerCase().indexOf(raw.toLocaleLowerCase(), cursor);
    if (found < 0) return;
    if (found > cursor) runs.push({ text: text.slice(cursor, found), wordIndex: null });
    runs.push({ text: text.slice(found, found + raw.length), wordIndex: index });
    cursor = found + raw.length;
  });
  if (cursor < text.length) runs.push({ text: text.slice(cursor), wordIndex: null });
  return runs.length ? runs : [{ text, wordIndex: null }];
}

function splitRun(run) {
  const pieces = String(run.text).split(/(\n|\s+)/u).filter(Boolean);
  return pieces.map((text) => ({
    text,
    wordIndex: run.wordIndex,
    whitespace: text !== '\n' && /^\s+$/u.test(text),
    newline: text === '\n',
  }));
}

function wrapRuns(runs, maxWidth, measure) {
  const lines = [{ units: [], width: 0 }];
  const current = () => lines[lines.length - 1];
  const nextLine = () => {
    while (current().units.length && current().units[current().units.length - 1].whitespace) {
      current().width -= current().units.pop().width;
    }
    lines.push({ units: [], width: 0 });
  };
  const add = (unit) => {
    unit.width = measure(unit.text);
    current().units.push(unit);
    current().width += unit.width;
  };

  runs.flatMap(splitRun).forEach((unit) => {
    if (unit.newline) {
      nextLine();
      return;
    }
    const width = measure(unit.text);
    if (unit.whitespace) {
      if (current().units.length) add(unit);
      return;
    }
    if (current().units.length && current().width + width > maxWidth) nextLine();
    if (width <= maxWidth) {
      add(unit);
      return;
    }
    // A single CJK/URL token can exceed the line. TextKit falls back to glyph
    // wrapping; mirror that rather than overflowing the authored width.
    Array.from(unit.text).forEach((character) => {
      const characterWidth = measure(character);
      if (current().units.length && current().width + characterWidth > maxWidth) nextLine();
      add({ ...unit, text: character });
    });
  });
  while (lines.length > 1 && !lines[lines.length - 1].units.length) lines.pop();
  return lines;
}

function makeSubtitleLine({
  text,
  cue,
  st,
  width: frameWidth,
  height: frameHeight,
  isTrans,
  language,
  compactOriginal,
  separateBackground,
}) {
  const lineStyle = R.nestedLineStyle(st, isTrans);
  const transformed = R.transformText(text, lineStyle);
  const m = lineMetrics(st, frameWidth, frameHeight, isTrans, compactOriginal);
  const attrs = textAttrs(m);
  const probe = new K.Text(attrs);
  const measure = (value) => {
    probe.text(value);
    return Math.ceil(probe.getTextWidth() * 100) / 100;
  };
  const words = !isTrans && cue ? window.vkWordTimes(cue) : [];
  const transformedWords = words.map((word) => ({
    ...word,
    w: R.transformText(
      R.projectPunctuation(word.w, language, st.punct !== false),
      lineStyle,
    ),
  }));
  const lines = wrapRuns(timedRuns(transformed, transformedWords), m.maxTextWidth, measure);
  probe.destroy();

  const padH = separateBackground ? m.padH : 0;
  const padV = separateBackground ? m.padV : 0;
  const lineHeightPx = m.fontSize * m.lineHeight;
  const naturalTextWidth = Math.max(1, ...lines.map((line) => line.width));
  const blockInnerWidth = separateBackground
    ? Math.max(0, m.blockMinWidth - padH * 2)
    : 0;
  const textWidth = Math.min(m.maxTextWidth, Math.max(naturalTextWidth, blockInnerWidth));
  const width = Math.min(m.wrapWidth, textWidth + padH * 2);
  const height = Math.max(lineHeightPx, lines.length * lineHeightPx) + padV * 2;
  const group = new K.Group();
  group.add(new K.Rect({
    width,
    height,
    fill: separateBackground && m.backgroundOn
      ? canvasColor(lineStyle.backgroundColor || st.backgroundColor, '#000000cc')
      : 'rgba(0,0,0,0.001)',
    cornerRadius: separateBackground && m.backgroundOn ? m.borderRadius : 0,
    // This transparent plate is the subtitle object's hit surface. The glyph
    // nodes remain non-listening so every click resolves through one policy.
    listening: true,
  }));

  // VoiceInk paints all active-word plates below the attributed glyph pass.
  // Keep those z-planes separate so a later word's plate cannot cover an
  // earlier word when adjacent highlights meet.
  const highlightGroup = new K.Group({ listening: false });
  const textGroup = new K.Group({ listening: false });
  group.add(highlightGroup);
  group.add(textGroup);
  const animatedNodes = [];
  lines.forEach((line, lineIndex) => {
    const alignOffset = m.align === 'left'
      ? 0
      : m.align === 'right'
        ? textWidth - line.width
        : (textWidth - line.width) / 2;
    let cursor = padH + alignOffset;
    line.units.forEach((unit) => {
      const y = padV + lineIndex * lineHeightPx + (lineHeightPx - m.fontSize) / 2;
      const highlight = new K.Rect({
        x: cursor - m.fontSize * 0.14,
        y: y - m.fontSize * 0.04,
        width: unit.width + m.fontSize * 0.28,
        height: m.fontSize * 1.08,
        cornerRadius: m.fontSize * 0.25,
        visible: false,
        listening: false,
      });
      const node = new K.Text({
        ...attrs,
        x: cursor,
        y,
        text: unit.text,
      });
      highlightGroup.add(highlight);
      textGroup.add(node);
      if (unit.wordIndex != null) {
        animatedNodes.push({
          node,
          highlight,
          wordIndex: unit.wordIndex,
          baseY: y,
          baseFill: m.fill,
          baseDecoration: m.textDecoration,
          baseShadowEnabled: m.shadowEnabled,
        });
      }
      cursor += unit.width;
    });
  });

  return {
    group,
    width,
    height,
    // 单行参考高：双语堆栈用它做槽位，折行只改 height 不改 reference，接缝因此
    // 不动。这里含底板 padding（模板的 height 一贯含 padV），与 CLI 烧录端
    // LineBox.reference 的纯字形高差一圈 padding —— 仅 backgroundPadding > 0 时
    // 可见，是先于本次存在的跨端差异（方案 §6.2 第 7 条），另立任务统一。
    reference: m.fontSize * m.lineHeight + padV * 2,
    metrics: m,
    animation: !isTrans && animatedNodes.length ? {
      cue,
      words,
      nodes: animatedNodes,
      visibleWordIndices: [...new Set(animatedNodes.map((entry) => entry.wordIndex))],
      style: R.normalizeWordAnimation(lineStyle),
      fontSize: m.fontSize,
      lastIndex: null,
    } : null,
  };
}

function karaokeProgress(cue, t) {
  const words = window.vkWordTimes(cue);
  if (!words.length) return 0;
  const i = R.wordIndexAt(words, t);
  const word = words[i];
  const within = clamp((t - word.start) / Math.max(0.01, word.end - word.start), 0, 1);
  return clamp((i + within) / words.length, 0, 1);
}

function updateWordAnimation(animation, t) {
  if (!animation || !animation.words.length) return false;
  const timedIndex = R.wordIndexAt(animation.words, t);
  const visible = animation.visibleWordIndices || [];
  const index = [...visible].reverse().find((candidate) => candidate <= timedIndex)
    ?? visible.find((candidate) => candidate > timedIndex)
    ?? timedIndex;
  if (animation.lastIndex === index) return false;
  animation.lastIndex = index;
  animation.nodes.forEach((entry) => {
    const state = R.wordState(animation.style, entry.wordIndex, index);
    entry.node.fill(canvasColor(state.color, entry.baseFill));
    entry.node.opacity(clamp(state.opacity == null ? 1 : state.opacity, 0, 1));
    entry.node.y(entry.baseY - (state.bottomEm || 0) * animation.fontSize);
    entry.node.textDecoration(state.underline == null
      ? entry.baseDecoration
      : state.underline ? 'underline' : '');
    entry.node.shadowEnabled(state.shadowOff ? false : entry.baseShadowEnabled);
    const background = state.backgroundColor;
    entry.highlight.visible(Boolean(background) && !R.isTransparent(background));
    entry.highlight.fill(canvasColor(background, 'transparent'));
    entry.highlight.cornerRadius((state.borderRadiusEm == null ? 0.25 : state.borderRadiusEm) * animation.fontSize);
    entry.highlight.opacity(clamp(state.opacity == null ? 1 : state.opacity, 0, 1));
  });
  return true;
}

function applyTransition(transition, t, suppressed, wordChanged) {
  if (!transition) return;
  const pose = suppressed
    ? { opacity: 1, scaleX: 1, scaleY: 1, blur: 0, active: false }
    : R.transitionPose(
      transition.style,
      transition.displayStart,
      t,
      transition.canvasScale,
      30,
    );
  // 姿态节点是两行共享的父节点 root，它的 offset 就是全局锚点，因此独立摆放的
  // 行也随整体一起围绕锚点缩放，而不是各自围绕自己的中心。
  (transition.nodes || []).forEach((node) => {
    node.opacity(pose.opacity);
    node.scale({ x: pose.scaleX, y: pose.scaleY });
    if (pose.blur > 0.05 && K.Filters && K.Filters.Blur) {
      if (wordChanged || !node.isCached()) {
        node.clearCache();
        node.cache({ pixelRatio: Math.min(2, window.devicePixelRatio || 1) });
      }
      node.filters([K.Filters.Blur]);
      node.blurRadius(pose.blur);
    } else {
      node.filters([]);
      if (node.isCached()) node.clearCache();
    }
  });
}

// 选中投影：整体选中拖 root（锚点位移），单行选中拖该行自己的 Group。
function bindSelection(nodes, state) {
  if (!nodes || !nodes.transformer) return;
  const { root, stack, lineNodes, detachedNodes, transformer } = nodes;
  // 选中行可能因为模式切换而不在当前渲染行里，此时退回整体选中。
  const active = state.selectedLine && lineNodes[state.selectedLine]
    ? state.selectedLine
    : null;
  const draggable = Boolean(state.selected) && !state.playing && !state.editingLine;
  root.draggable(draggable && !active);
  Object.keys(lineNodes).forEach((line) => {
    lineNodes[line].draggable(draggable && active === line);
  });
  // 单行选中显示该行包围框；整体选中沿用堆栈框，只有确有行脱离堆栈时才并入
  // 独立行——否则 Transformer 会从跟随 stack 旋转的框变成轴对齐并集框。
  const targets = active
    ? [lineNodes[active]]
    : detachedNodes.length
      ? (stack ? [stack, ...detachedNodes] : detachedNodes)
      : (stack ? [stack] : []);
  transformer.nodes(targets);
  transformer.visible(Boolean(state.selected) && !state.editingLine && targets.length > 0);
}

function placeholderPalette(hue) {
  const palettes = [
    ['#233e78', '#171d3f', '#0f1324'],
    ['#176752', '#18372f', '#101f1b'],
    ['#805426', '#422c21', '#211714'],
    ['#1d6476', '#173540', '#101d24'],
  ];
  return palettes[Math.abs(Math.round((hue || 252) / 50)) % palettes.length];
}

function CanvasTextEditor({ edit, frameWidth, frameHeight, onCommit, onCancel }) {
  const ref = useRef(null);
  const done = useRef(false);
  const left = clamp(edit.rect.x - 6, 8, Math.max(8, frameWidth - 88));
  const top = clamp(edit.rect.y - 4, 8, Math.max(8, frameHeight - 48));
  const width = Math.max(80, Math.min(edit.rect.width + 12, frameWidth - left - 8));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const grow = () => {
      el.style.height = 'auto';
      el.style.height = Math.min(frameHeight - top - 8, Math.max(edit.rect.height + 8, el.scrollHeight + 4)) + 'px';
    };
    grow();
    el.focus();
    el.select();
    el.addEventListener('input', grow);
    return () => el.removeEventListener('input', grow);
  }, []);

  const finish = (save) => {
    if (done.current) return;
    done.current = true;
    if (!save) {
      onCancel();
      return;
    }
    onCommit(ref.current.value.replace(/\s+/g, ' ').trim());
  };

  return (
    <textarea
      ref={ref}
      className="bcs-canvas-editor"
      defaultValue={edit.value}
      spellCheck={false}
      aria-label={edit.line === 'trans' ? '编辑译文字幕' : '编辑原文字幕'}
      style={{
        left,
        top,
        width,
        minHeight: edit.rect.height + 8,
        fontFamily: edit.metrics.fontFamily,
        fontSize: edit.metrics.fontSize,
        fontWeight: edit.metrics.fontStyle.includes('bold') ? 800 : 500,
        lineHeight: edit.metrics.lineHeight,
        color: edit.metrics.fill,
        textAlign: edit.metrics.align,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

function KonvaPreview({
  width,
  height,
  mediaEl,
  hasVideo,
  hasAudio,
  hue,
  cue,
  tcue,
  sourceLanguage,
  targetLanguage,
  lines,
  style: st,
  scale,
  t,
  playing,
  displayStart,
  selected,
  selectedLine,
  showSubs,
  transcribing,
  editingLine,
  onCanvasPress,
  onSelectLine,
  onEditLine,
  onMoveBy,
  onMoveLine,
}) {
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const actionRef = useRef(null);
  const wordAnimationRef = useRef(null);
  const transitionRef = useRef(null);
  const nodesRef = useRef(null);
  const lastClickActionRef = useRef(null);
  const editSuppressedUntilRef = useRef(0);
  const [fontReady, setFontReady] = useState(false);
  actionRef.current = {
    onCanvasPress, onSelectLine, onEditLine, onMoveBy, onMoveLine,
    playing, selected, selectedLine,
  };

  useEffect(() => {
    let live = true;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (live) setFontReady(true);
      });
    } else {
      setFontReady(true);
    }
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const stage = new K.Stage({ container: hostRef.current, width, height });
    const mediaLayer = new K.Layer();
    const overlayLayer = new K.Layer();
    stage.add(mediaLayer);
    stage.add(overlayLayer);
    const animation = new K.Animation(() => {}, mediaLayer);
    sceneRef.current = { stage, mediaLayer, overlayLayer, animation };
    return () => {
      animation.stop();
      stage.destroy();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.stage.size({ width, height });
    scene.stage.batchDraw();
  }, [width, height]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const layer = scene.mediaLayer;
    layer.destroyChildren();
    const back = new K.Rect({ width, height, fill: '#000' });
    back.on('click tap', () => {
      lastClickActionRef.current = actionRef.current.onCanvasPress({ hasTarget: false });
    });
    layer.add(back);
    const cleanups = [];

    if (hasVideo && mediaEl) {
      const image = new K.Image({ image: mediaEl, listening: true });
      image.on('click tap', () => {
        lastClickActionRef.current = actionRef.current.onCanvasPress({ hasTarget: false });
      });
      layer.add(image);
      const fit = () => {
        const vw = mediaEl.videoWidth || width;
        const vh = mediaEl.videoHeight || height;
        const mediaScale = Math.min(width / vw, height / vh);
        const w = vw * mediaScale;
        const h = vh * mediaScale;
        image.setAttrs({ x: (width - w) / 2, y: (height - h) / 2, width: w, height: h });
        layer.batchDraw();
      };
      ['loadedmetadata', 'loadeddata', 'seeked', 'resize'].forEach((name) => {
        mediaEl.addEventListener(name, fit);
        cleanups.push(() => mediaEl.removeEventListener(name, fit));
      });
      fit();
    } else {
      const colors = placeholderPalette(hue);
      layer.add(new K.Rect({
        width,
        height,
        fillLinearGradientStartPoint: { x: 0, y: 0 },
        fillLinearGradientEndPoint: { x: width, y: height },
        fillLinearGradientColorStops: [0, colors[0], 0.62, colors[1], 1, colors[2]],
        listening: false,
      }));
      const grid = new K.Group({ opacity: 0.16, listening: false });
      const gap = Math.max(28, width / 14);
      for (let x = gap; x < width; x += gap) {
        grid.add(new K.Line({ points: [x, 0, x, height], stroke: '#fff', strokeWidth: 1 }));
      }
      for (let y = gap; y < height; y += gap) {
        grid.add(new K.Line({ points: [0, y, width, y], stroke: '#fff', strokeWidth: 1 }));
      }
      layer.add(grid);
      layer.add(new K.Text({
        x: width * 0.04,
        y: height * 0.82,
        text: hasAudio ? '音频项目' : '无媒体预览',
        fontFamily: FONT_CATALOG.stackFor('system'),
        fontSize: Math.max(18, 24 * scale),
        fontStyle: 'bold',
        letterSpacing: 4,
        fill: 'rgba(255,255,255,0.32)',
        listening: false,
      }));
    }
    layer.draw();
    return () => cleanups.forEach((fn) => fn());
  }, [mediaEl, hasVideo, hasAudio, hue, width, height, scale]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (playing && hasVideo && mediaEl) {
      scene.animation.start();
    } else {
      scene.animation.stop();
      scene.mediaLayer.batchDraw();
    }
    return () => scene.animation.stop();
  }, [playing, hasVideo, mediaEl]);

  const cueKey = cue ? cue.id + '\n' + cue.text : '';
  const transKey = tcue ? tcue.id + '\n' + (tcue.text || '') : '';
  const linesKey = lines.join(',');
  const styleKey = JSON.stringify(st);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { overlayLayer, stage } = scene;
    overlayLayer.destroyChildren();
    wordAnimationRef.current = null;
    transitionRef.current = null;
    nodesRef.current = null;
    window.BCS_LINE_CENTERS = null;
    if (!showSubs || transcribing || (!cue && !tcue)) {
      overlayLayer.draw();
      return;
    }

    const defs = lines.map((line) => {
      if (line === 'orig') {
        return cue ? {
          line, text: cue.text, cue, isTrans: false, language: sourceLanguage,
        } : null;
      }
      return tcue && tcue.text ? {
        line, text: tcue.text, isTrans: true, language: targetLanguage,
      } : null;
    }).filter(Boolean).map((def) => ({
      ...def,
      text: R.projectPunctuation(def.text, def.language, st.punct !== false),
    })).filter((def) => def.text.trim());
    if (!defs.length) {
      overlayLayer.draw();
      return;
    }

    const sharedBackground = st.backgroundMode === 'shared';
    const compactOriginal = lines.includes('trans');
    // 行级 x/y 只在双语上下文生效，判据是模式排了两行而不是这一刻画出了两行：
    // 缺译文的那条 cue 在导出端仍按覆盖浮动，预览要一致。
    const detachable = lines.length > 1;
    const made = defs.map((def) => {
      const override = detachable ? R.linePosition(st, def.line) : null;
      return {
        ...def,
        override,
        rendered: makeSubtitleLine({
          text: def.text,
          cue: def.cue,
          st,
          width,
          height,
          isTrans: def.isTrans,
          language: def.language,
          compactOriginal,
          // 独立摆放的行离开共享底板，必须自带底板才不会失去背景。
          separateBackground: !sharedBackground || Boolean(override),
        }),
      };
    });
    const canvasScale = R.referenceScale(width, height) * Math.max(0.05, Number(st.scale) || 1);
    const gap = Math.max(0, Number(st.gap == null ? 6 : st.gap)) * canvasScale;
    const stackedItems = made.filter((item) => !item.override);
    // 共享底板的 padding / 圆角 / 颜色只跟一行走，且那一行由 sharedPlateLine 按
    // 「源行优先，源行无真背景才退到译文行」选出——不能拿 stackedItems[0]：
    // transTop 时排在前面的是译文行，而 origStyle/transStyle 又能各自覆盖
    // backgroundPadding，取首行会让预览与 CLI/Mac 的底板尺寸分叉。
    const sharedPlate = R.sharedPlateLine(
      stackedItems.map((item) => ({ line: item.line, metrics: item.rendered.metrics })),
    );
    const sharedMetrics = sharedPlate ? sharedPlate.metrics : made[0].rendered.metrics;
    const sharedPadH = sharedBackground && stackedItems.length ? sharedMetrics.padH : 0;
    const sharedPadV = sharedBackground && stackedItems.length ? sharedMetrics.padV : 0;
    const plan = R.planLineLayout(
      made.map((item) => ({
        line: item.line,
        width: item.rendered.width,
        height: item.rendered.height,
        reference: item.rendered.reference,
      })),
      {
        style: st,
        frameWidth: width,
        frameHeight: height,
        gap,
        padH: sharedPadH,
        padV: sharedPadV,
        bilingual: detachable,
      },
    );
    const rotation = Number(st.rotation) || 0;
    const pctX = (value) => Math.round((value / width) * 1000) / 10;
    const pctY = (value) => Math.round((value / height) * 1000) / 10;

    const vGuide = new K.Line({
      points: [width / 2, 0, width / 2, height],
      stroke: '#3b63fb',
      strokeWidth: 1,
      visible: false,
      listening: false,
    });
    const hGuide = new K.Line({
      points: [0, height / 2, width, height / 2],
      stroke: '#3b63fb',
      strokeWidth: 1,
      visible: false,
      listening: false,
    });
    const boundCenter = (pos) => ({
      x: clamp(Math.abs(pos.x - width / 2) < 8 ? width / 2 : pos.x, width * 0.03, width * 0.97),
      y: clamp(Math.abs(pos.y - height / 2) < 8 ? height / 2 : pos.y, height * 0.04, height * 0.96),
    });
    const showGuides = (cx, cy) => {
      vGuide.visible(Math.abs(cx - width / 2) < 1);
      hGuide.visible(Math.abs(cy - height / 2) < 1);
    };
    const endDrag = () => {
      vGuide.hide();
      hGuide.hide();
      stage.container().style.cursor = 'grab';
    };

    // root 是两行共享的父变换：支点固定在全局锚点，整组 scale/rotation 与入场
    // 转场都作用在它身上，独立摆放的浮动行因此仍随整体一起变换。它同时承载整体
    // 拖拽，"两行都独立摆放"时也总有可拖的对象；子节点一律用画面坐标。
    const root = new K.Group({
      x: plan.anchor.x,
      y: plan.anchor.y,
      offsetX: plan.anchor.x,
      offsetY: plan.anchor.y,
      rotation,
    });
    // 行级拖拽写回的是画面坐标，需要先剥掉 root 的旋转/缩放。
    const toFrame = (point) => root.getAbsoluteTransform().copy().invert().point(point);
    const stack = plan.stacked.length ? new K.Group() : null;
    if (stack) {
      root.add(stack);
      if (sharedBackground) {
        const sharedStyle = sharedMetrics.lineStyle;
        stack.add(new K.Rect({
          width: plan.stackWidth,
          height: plan.stackHeight,
          fill: sharedMetrics.backgroundOn
            ? canvasColor(sharedStyle.backgroundColor || st.backgroundColor, '#000000cc')
            : 'rgba(0,0,0,0.001)',
          cornerRadius: sharedMetrics.backgroundOn ? sharedMetrics.borderRadius : 0,
          listening: false,
        }));
      }
    }

    const byLine = {};
    made.forEach((item) => { byLine[item.line] = item; });
    const lineNodes = {};
    const detachedNodes = [];
    plan.placements.forEach((placement) => {
      const item = byLine[placement.line];
      if (!item) return;
      const rendered = item.rendered;
      const group = rendered.group;
      // 每个行 Group 都以自身中心为原点，这样 Konva 的绝对位置（dragBoundFunc
      // 的入参、getAbsolutePosition 的返回）在堆栈内、独立摆放两种情况下都是
      // 该行的可见中心，写回百分比时无需再分情况换算。
      group.offset({ x: placement.width / 2, y: placement.height / 2 });
      if (placement.detached) {
        group.position(placement.center);
        root.add(group);
        detachedNodes.push(group);
      } else {
        group.position({
          x: placement.x + placement.width / 2,
          y: placement.y + placement.height / 2,
        });
        stack.add(group);
      }
      lineNodes[placement.line] = group;

      group.on('click tap', (e) => {
        e.cancelBubble = true;
        const state = actionRef.current;
        const extend = Boolean(e.evt && e.evt.shiftKey);
        const action = state.onCanvasPress({
          hasTarget: true,
          targetSelected: state.selected
            && (state.selectedLine == null || state.selectedLine === item.line),
          select: () => state.onSelectLine(item.line, extend),
        });
        lastClickActionRef.current = action;
        if (action !== 'passThrough') editSuppressedUntilRef.current = performance.now() + 500;
        if (action === 'passThrough') state.onSelectLine(item.line, extend);
      });
      group.on('dblclick dbltap', (e) => {
        e.cancelBubble = true;
        if (lastClickActionRef.current !== 'passThrough'
          || actionRef.current.playing
          || !actionRef.current.selected
          || performance.now() < editSuppressedUntilRef.current) return;
        const rect = group.getClientRect({ relativeTo: stage, skipShadow: true });
        actionRef.current.onEditLine(item.line, rect, rendered.metrics);
      });
      group.dragBoundFunc(boundCenter);
      group.on('dragstart', () => {
        stage.container().style.cursor = 'grabbing';
      });
      group.on('dragmove', () => {
        const center = toFrame(group.getAbsolutePosition());
        showGuides(center.x, center.y);
      });
      group.on('dragend', () => {
        endDrag();
        const center = toFrame(group.getAbsolutePosition());
        // 写回的 y 是锚边坐标，不是中心：读显式行锚点（缺席 = center），因为
        // lineStylePatch 不带 verticalAlign 键时会原样保留已有锚点。堆栈行被拖成
        // 独立行时锚点仍缺席，换算退化为恒等，落点零跳动。
        const align = R.lineVerticalAlign(st, item.line) || 'center';
        const anchorY = R.lineAnchorFromCenter(center.y, placement.height, align);
        actionRef.current.onMoveLine(item.line, pctX(center.x), pctY(anchorY));
        overlayLayer.batchDraw();
      });
      if (editingLine === item.line) group.visible(false);
      if (rendered.animation) wordAnimationRef.current = rendered.animation;
    });

    if (stack) {
      stack.offset({ x: plan.stackWidth / 2, y: plan.stackHeight / 2 });
      // 堆栈盒子的中心不再恒等于锚点：折行的槽位与块级锚点都会让它偏移，必须用
      // 落位后反推的 stackCenter，否则共享底板会和文字错开。
      stack.position(plan.stackCenter);
    }
    overlayLayer.add(vGuide);
    overlayLayer.add(hGuide);
    overlayLayer.add(root);

    // 整体拖拽的参照中心：有堆栈时就是锚点，全部独立摆放时退化为各行中心均值，
    // 让吸附线与边界钳制仍作用在可见内容上。
    const baseCenter = plan.stacked.length || !plan.detached.length
      ? plan.anchor
      : {
        x: plan.detached.reduce((sum, item) => sum + item.center.x, 0) / plan.detached.length,
        y: plan.detached.reduce((sum, item) => sum + item.center.y, 0) / plan.detached.length,
      };
    // root 的位置就是锚点位置，拖动量 = 当前位置 - 初始锚点。吸附与边界仍作用在
    // 可见内容的参照中心上，因此先把位移映射过去再钳制。
    const rootDelta = () => ({ x: root.x() - plan.anchor.x, y: root.y() - plan.anchor.y });
    root.dragBoundFunc((pos) => {
      const dx = pos.x - plan.anchor.x;
      const dy = pos.y - plan.anchor.y;
      const bounded = boundCenter({ x: baseCenter.x + dx, y: baseCenter.y + dy });
      return {
        x: plan.anchor.x + (bounded.x - baseCenter.x),
        y: plan.anchor.y + (bounded.y - baseCenter.y),
      };
    });
    root.on('mouseenter', () => {
      const state = actionRef.current;
      stage.container().style.cursor = state.selected && !state.playing && !editingLine
        ? 'grab'
        : 'default';
    });
    root.on('mouseleave', () => {
      stage.container().style.cursor = 'default';
    });
    root.on('dragstart', () => {
      stage.container().style.cursor = 'grabbing';
    });
    root.on('dragmove', () => {
      const delta = rootDelta();
      showGuides(baseCenter.x + delta.x, baseCenter.y + delta.y);
    });
    root.on('dragend', () => {
      endDrag();
      const delta = rootDelta();
      actionRef.current.onMoveBy(pctX(delta.x), pctY(delta.y));
      overlayLayer.batchDraw();
    });

    const transformer = new K.Transformer({
      nodes: [],
      enabledAnchors: [],
      rotateEnabled: false,
      borderStroke: '#3b63fb',
      borderStrokeWidth: 2,
      padding: 6,
      visible: false,
      listening: false,
    });
    overlayLayer.add(transformer);
    nodesRef.current = { root, stack, lineNodes, detachedNodes, transformer };
    bindSelection(nodesRef.current, { selected, selectedLine, playing, editingLine });
    // 样式面板「独立摆放」需要该行当前的推导中心作为起点；中心依赖实测文本尺寸，
    // 只能由画布产出。h 是该行的百分比高度，面板据它把中心换算成锚边坐标。
    // 这里只是一次只读快照，不参与订阅。
    window.BCS_LINE_CENTERS = plan.placements.reduce((acc, placement) => {
      acc[placement.line] = {
        x: pctX(placement.center.x),
        y: pctY(placement.center.y),
        h: pctY(placement.height),
      };
      return acc;
    }, {});
    transitionRef.current = {
      // 入场转场作用在共享父节点上，支点即全局锚点：浮动行与堆栈一起进场。
      nodes: [root],
      style: st,
      displayStart: displayStart == null ? t : displayStart,
      canvasScale,
    };
    const wordChanged = updateWordAnimation(wordAnimationRef.current, t);
    applyTransition(transitionRef.current, t, selected || Boolean(editingLine), wordChanged);
    overlayLayer.draw();
  }, [
    cueKey,
    transKey,
    linesKey,
    styleKey,
    sourceLanguage,
    targetLanguage,
    width,
    height,
    showSubs,
    transcribing,
    editingLine,
    fontReady,
    displayStart,
  ]);

  // 行级选中变化不重建节点：sel.line 只改拖拽目标与包围框，双击窗口因此不会被
  // 第一次点击打断。
  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    bindSelection(nodes, { selected, selectedLine, playing, editingLine });
    const layer = nodes.transformer.getLayer();
    if (layer) layer.batchDraw();
  }, [selected, selectedLine, playing, editingLine, cueKey]);

  // Word animation and the entrance pose are both pure functions of the
  // playhead. Seeking and playback therefore paint the same Canvas state.
  useEffect(() => {
    const transition = transitionRef.current;
    const animation = wordAnimationRef.current;
    if (!transition && !animation) return;
    const wordChanged = updateWordAnimation(animation, t);
    applyTransition(transition, t, selected || Boolean(editingLine), wordChanged);
    const layer = (transition && transition.nodes[0] && transition.nodes[0].getLayer())
      || (animation && animation.nodes[0] && animation.nodes[0].node.getLayer());
    if (layer) layer.batchDraw();
  }, [t, selected, editingLine, cueKey, transKey]);

  return (
    <div
      ref={hostRef}
      className="bcs-konva-preview"
      role="group"
      tabIndex="0"
      aria-label="Canvas 视频与字幕预览：单击画面播放或暂停；暂停后单击原文行或译文行可单独选中，Shift 单击另一行整体选中；已选中且暂停时可拖拽该行或双击编辑"
    />
  );
}

window.BCSCanvas = {
  KonvaPreview,
  CanvasTextEditor,
  lineMetrics,
  canvasColor,
  karaokeProgress,
};
})();
