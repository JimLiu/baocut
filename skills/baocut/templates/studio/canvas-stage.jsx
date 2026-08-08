// BaoCut Subtitle Studio — Konva preview surface.
// A hidden HTMLMediaElement remains the decoder and playback clock. Konva.Image
// paints video frames, while the VoiceInk-compatible presentation kernel owns
// subtitle timing, scale, style, layout, and seek-safe animation decisions.
(() => {
const { useEffect, useRef, useState } = React;
const K = window.Konva;
const R = window.BCS_SUBTITLE;

if (!K) throw new Error('Konva failed to load');
if (!R) throw new Error('subtitle-rendering.js failed to load');

const FONTS = {
  system: '"Noto Sans SC", sans-serif',
  montserrat: '"Montserrat", "Noto Sans SC", sans-serif',
  bebas: '"Bebas Neue", "Noto Sans SC", sans-serif',
  lexend: '"Lexend Deca", "Noto Sans SC", sans-serif',
  serif: '"Source Serif 4", "Noto Sans SC", serif',
};
window.BCS_FONTS = FONTS;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function canvasColor(value, fallback) {
  const v = value || fallback;
  const color = R.parseColor(v);
  return color
    ? `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${color.a.toFixed(3)})`
    : v;
}

function canvasFontFamily(value) {
  const family = value && typeof value === 'object' ? value.fontFamily : value;
  return FONTS[family] || family || FONTS.system;
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
  const stack = transition.stack;
  stack.opacity(pose.opacity);
  stack.scale({ x: pose.scaleX, y: pose.scaleY });
  if (pose.blur > 0.05 && K.Filters && K.Filters.Blur) {
    if (wordChanged || !stack.isCached()) {
      stack.clearCache();
      stack.cache({ pixelRatio: Math.min(2, window.devicePixelRatio || 1) });
    }
    stack.filters([K.Filters.Blur]);
    stack.blurRadius(pose.blur);
  } else {
    stack.filters([]);
    if (stack.isCached()) stack.clearCache();
  }
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
  showSubs,
  transcribing,
  editingLine,
  onCanvasPress,
  onSelectLine,
  onEditLine,
  onMove,
}) {
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const actionRef = useRef(null);
  const wordAnimationRef = useRef(null);
  const transitionRef = useRef(null);
  const stackRef = useRef(null);
  const transformerRef = useRef(null);
  const lastClickActionRef = useRef(null);
  const editSuppressedUntilRef = useRef(0);
  const [fontReady, setFontReady] = useState(false);
  actionRef.current = {
    onCanvasPress, onSelectLine, onEditLine, onMove,
    playing, selected,
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
        fontFamily: FONTS.system,
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
    stackRef.current = null;
    transformerRef.current = null;
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

    const stack = new K.Group({ draggable: selected && !playing && !editingLine });
    const sharedBackground = st.backgroundMode === 'shared';
    const compactOriginal = lines.includes('trans');
    const made = defs.map((def) => ({
      ...def,
      rendered: makeSubtitleLine({
        text: def.text,
        cue: def.cue,
        st,
        width,
        height,
        isTrans: def.isTrans,
        language: def.language,
        compactOriginal,
        separateBackground: !sharedBackground,
      }),
    }));
    const canvasScale = R.referenceScale(width, height) * Math.max(0.05, Number(st.scale) || 1);
    const gap = Math.max(0, Number(st.gap == null ? 6 : st.gap)) * canvasScale;
    const sharedMetrics = made[0].rendered.metrics;
    const sharedPadH = sharedBackground ? sharedMetrics.padH : 0;
    const sharedPadV = sharedBackground ? sharedMetrics.padV : 0;
    const stackWidth = Math.max(...made.map((item) => item.rendered.width)) + sharedPadH * 2;
    const contentHeight = made.reduce((sum, item) => sum + item.rendered.height, 0)
      + gap * Math.max(0, made.length - 1);
    const stackHeight = contentHeight + sharedPadV * 2;
    if (sharedBackground) {
      const sharedStyle = sharedMetrics.lineStyle;
      stack.add(new K.Rect({
        width: stackWidth,
        height: stackHeight,
        fill: sharedMetrics.backgroundOn
          ? canvasColor(sharedStyle.backgroundColor || st.backgroundColor, '#000000cc')
          : 'rgba(0,0,0,0.001)',
        cornerRadius: sharedMetrics.backgroundOn ? sharedMetrics.borderRadius : 0,
        listening: false,
      }));
    }
    let y = sharedPadV;
    made.forEach((item) => {
      const rendered = item.rendered;
      rendered.group.position({ x: (stackWidth - rendered.width) / 2, y });
      rendered.group.on('click tap', (e) => {
        e.cancelBubble = true;
        const action = actionRef.current.onCanvasPress({
          hasTarget: true,
          targetSelected: actionRef.current.selected,
          select: () => actionRef.current.onSelectLine(item.line),
        });
        lastClickActionRef.current = action;
        if (action !== 'passThrough') editSuppressedUntilRef.current = performance.now() + 500;
        if (action === 'passThrough') actionRef.current.onSelectLine(item.line);
      });
      rendered.group.on('dblclick dbltap', (e) => {
        e.cancelBubble = true;
        if (lastClickActionRef.current !== 'passThrough'
          || actionRef.current.playing
          || !actionRef.current.selected
          || performance.now() < editSuppressedUntilRef.current) return;
        const rect = rendered.group.getClientRect({ relativeTo: stage, skipShadow: true });
        actionRef.current.onEditLine(item.line, rect, rendered.metrics);
      });
      if (editingLine === item.line) rendered.group.visible(false);
      stack.add(rendered.group);
      if (rendered.animation) wordAnimationRef.current = rendered.animation;
      y += rendered.height + gap;
    });
    stack.offset({ x: stackWidth / 2, y: stackHeight / 2 });
    const preferredX = width * ((st.x == null ? 50 : st.x) / 100);
    const preferredY = height * ((st.y == null ? 86 : st.y) / 100);
    stack.position({
      x: preferredX,
      y: preferredY,
    });
    stack.rotation(Number(st.rotation) || 0);

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
    overlayLayer.add(vGuide);
    overlayLayer.add(hGuide);
    overlayLayer.add(stack);
    stack.dragBoundFunc((pos) => ({
      x: clamp(Math.abs(pos.x - width / 2) < 8 ? width / 2 : pos.x, width * 0.03, width * 0.97),
      y: clamp(Math.abs(pos.y - height / 2) < 8 ? height / 2 : pos.y, height * 0.04, height * 0.96),
    }));
    stack.on('mouseenter', () => {
      stage.container().style.cursor = selected && !playing && !editingLine ? 'grab' : 'default';
    });
    stack.on('mouseleave', () => {
      stage.container().style.cursor = 'default';
    });
    stack.on('dragstart', () => {
      stage.container().style.cursor = 'grabbing';
    });
    stack.on('dragmove', () => {
      vGuide.visible(Math.abs(stack.x() - width / 2) < 1);
      hGuide.visible(Math.abs(stack.y() - height / 2) < 1);
    });
    stack.on('dragend', () => {
      vGuide.hide();
      hGuide.hide();
      stage.container().style.cursor = 'grab';
      actionRef.current.onMove(
        Math.round((stack.x() / width) * 1000) / 10,
        Math.round((stack.y() / height) * 1000) / 10,
      );
      overlayLayer.batchDraw();
    });

    const transformer = new K.Transformer({
      nodes: [stack],
      enabledAnchors: [],
      rotateEnabled: false,
      borderStroke: '#3b63fb',
      borderStrokeWidth: 2,
      padding: 6,
      visible: selected && !editingLine,
      listening: false,
    });
    overlayLayer.add(transformer);
    stackRef.current = stack;
    transformerRef.current = transformer;
    transitionRef.current = {
      stack,
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

  useEffect(() => {
    const transformer = transformerRef.current;
    const stack = stackRef.current;
    if (!transformer || !stack) return;
    transformer.nodes([stack]);
    transformer.visible(selected && !editingLine);
    stack.draggable(selected && !playing && !editingLine);
    transformer.getLayer().batchDraw();
  }, [selected, playing, editingLine, cueKey]);

  // Word animation and the entrance pose are both pure functions of the
  // playhead. Seeking and playback therefore paint the same Canvas state.
  useEffect(() => {
    const transition = transitionRef.current;
    const animation = wordAnimationRef.current;
    if (!transition && !animation) return;
    const wordChanged = updateWordAnimation(animation, t);
    applyTransition(transition, t, selected || Boolean(editingLine), wordChanged);
    const layer = (transition && transition.stack.getLayer())
      || (animation && animation.nodes[0] && animation.nodes[0].node.getLayer());
    if (layer) layer.batchDraw();
  }, [t, selected, editingLine, cueKey, transKey]);

  return (
    <div
      ref={hostRef}
      className="bcs-konva-preview"
      role="group"
      tabIndex="0"
      aria-label="Canvas 视频与字幕预览：单击画面播放或暂停；暂停后可选中字幕；已选中且暂停时可拖拽或双击编辑"
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
