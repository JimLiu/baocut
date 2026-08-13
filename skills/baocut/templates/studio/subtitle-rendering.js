// BaoCut Subtitle Studio — deterministic subtitle presentation kernel.
//
// Ported from VoiceInk's CanvasReferenceScale, SubtitleDisplay,
// SubtitleFrameSpec/DocumentRenderer, StyleFX, WordFX, and SubtitleTransition.
// This file intentionally has no React/Konva dependency: the Canvas surface,
// tests, and any future export preview all consume the same pure decisions.
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_SUBTITLE = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const REFERENCE_SHORT_EDGE = 540;
  const LANDSCAPE_ASPECT = 16 / 9;
  const DEFAULT_TIMING = Object.freeze({ leadIn: 0.5, tail: 1.0 });
  const DEFAULT_BILINGUAL_ORIG_SCALE = 16 / 30;
  const DEFAULT_TRANSLATION_RATIO = 22 / 16;

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function referenceScale(width, height) {
    const w = Number(width), h = Number(height);
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
      ? Math.min(w, h) / REFERENCE_SHORT_EDGE
      : 1;
  }

  function fitFrame(containerWidth, containerHeight, rawAspectRatio) {
    const boxWidth = Math.max(40, finite(containerWidth, 40));
    const boxHeight = Math.max(40, finite(containerHeight, 40));
    const aspectRatio = finite(rawAspectRatio, LANDSCAPE_ASPECT) > 0
      ? finite(rawAspectRatio, LANDSCAPE_ASPECT)
      : LANDSCAPE_ASPECT;
    let width = boxWidth;
    let height = width / aspectRatio;
    if (height > boxHeight) {
      height = boxHeight;
      width = height * aspectRatio;
    }
    return { width, height, aspectRatio, scale: referenceScale(width, height) };
  }

  function timingOf(value) {
    const timing = value || DEFAULT_TIMING;
    return {
      leadIn: Math.max(0, finite(timing.leadIn, DEFAULT_TIMING.leadIn)),
      tail: Math.max(0, finite(timing.tail, DEFAULT_TIMING.tail)),
    };
  }

  // VoiceInk SubtitleDisplay.pad: nearby cues divide their real silence in the
  // tail:lead-in ratio, so display windows meet but never overlap.
  function displayPadding(buffer, gap, timing = DEFAULT_TIMING) {
    const resolved = timingOf(timing);
    const cap = resolved.leadIn + resolved.tail;
    if (cap <= 0) return 0;
    return Math.min(
      Math.max(0, finite(buffer, 0)),
      Math.max(0, finite(gap, Number.POSITIVE_INFINITY)) * Math.max(0, buffer) / cap,
    );
  }

  function intervalStart(item) {
    return finite(item && item.start, 0);
  }

  function intervalEnd(item) {
    return Math.max(intervalStart(item), finite(item && item.end, intervalStart(item)));
  }

  function displayWindow(items, index, timing = DEFAULT_TIMING) {
    if (!Array.isArray(items) || index < 0 || index >= items.length) return null;
    const resolved = timingOf(timing);
    const start = intervalStart(items[index]);
    const end = intervalEnd(items[index]);
    const previousGap = index > 0
      ? start - intervalEnd(items[index - 1])
      : Number.POSITIVE_INFINITY;
    const nextGap = index + 1 < items.length
      ? intervalStart(items[index + 1]) - end
      : Number.POSITIVE_INFINITY;
    return {
      start: start - displayPadding(resolved.leadIn, previousGap, resolved),
      end: end + displayPadding(resolved.tail, nextGap, resolved),
    };
  }

  // O(log n), matching VoiceInk's 60 Hz hot path.
  function activeIndex(items, time, timing = DEFAULT_TIMING) {
    if (!Array.isArray(items) || !items.length) return -1;
    const t = finite(time, 0);
    const resolved = timingOf(timing);
    let low = 0, high = items.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (intervalStart(items[middle]) <= t) low = middle + 1;
      else high = middle;
    }
    const next = low;
    if (next - 1 >= 0) {
      const end = intervalEnd(items[next - 1]);
      const gap = next < items.length
        ? intervalStart(items[next]) - end
        : Number.POSITIVE_INFINITY;
      if (t < end + displayPadding(resolved.tail, gap, resolved)) return next - 1;
    }
    if (next < items.length) {
      const start = intervalStart(items[next]);
      const gap = next - 1 >= 0
        ? start - intervalEnd(items[next - 1])
        : Number.POSITIVE_INFINITY;
      if (t >= start - displayPadding(resolved.leadIn, gap, resolved)) return next;
    }
    return -1;
  }

  function activeTimedItem(items, time, timing = DEFAULT_TIMING) {
    const index = activeIndex(items, time, timing);
    if (index < 0) return null;
    const window = displayWindow(items, index, timing);
    return { item: items[index], index, displayStart: window.start, displayEnd: window.end };
  }

  function joinSourceWords(words, language) {
    const primary = String(language || '').toLowerCase().split(/[-_]/)[0];
    const separator = ['zh', 'ja', 'th'].includes(primary) ? '' : ' ';
    return words.map((word) => String((word && word.text) || '')).filter(Boolean).join(separator);
  }

  // A translation piece owns one semantic source span, but that span may be
  // wider than the editor column. Split it into presentation-only sublines at
  // source-word boundaries; never turn these visual wraps into transAlign cuts.
  function sourceDisplayLines(input, language = '', fit = 42) {
    const source = Array.isArray(input)
      ? input.map((word) => ({ ...word, text: String((word && word.text) || '').trim() }))
        .filter((word) => word.text)
      : String(input || '').trim().split(/\s+/u).filter(Boolean)
        .map((text) => ({ text }));
    if (!source.length) return [];
    const primary = String(language || '').toLowerCase().split(/[-_]/)[0];
    const separator = ['zh', 'ja', 'th'].includes(primary) ? '' : ' ';
    const limit = Math.max(8, Math.floor(finite(fit, 42)));
    const textFor = (from, to) => source.slice(from, to + 1).map((word) => word.text).join(separator);
    const full = textFor(0, source.length - 1);
    if (Array.from(full).length <= limit) {
      return [{ text: full, words: source, from: 0, to: source.length - 1 }];
    }

    const lineCount = Math.max(2, Math.ceil(Array.from(full).length / limit));
    const ideal = Math.min(limit, Math.ceil(Array.from(full).length / lineCount));
    const best = Array(source.length + 1).fill(Number.POSITIVE_INFINITY);
    const next = Array(source.length).fill(-1);
    best[source.length] = 0;
    for (let from = source.length - 1; from >= 0; from -= 1) {
      for (let to = from; to < source.length; to += 1) {
        const line = textFor(from, to);
        const width = Array.from(line).length;
        if (width > limit && to > from) break;
        const tail = line.trim().slice(-1);
        const boundaryPenalty = to === source.length - 1 || /[.!?;:，。！？；：]/u.test(tail) ? 0 : 12;
        const score = 100000 + ((ideal - Math.min(width, limit)) ** 2) + boundaryPenalty + best[to + 1];
        if (score < best[from]) {
          best[from] = score;
          next[from] = to + 1;
        }
      }
    }
    const lines = [];
    for (let from = 0; from < source.length;) {
      const end = next[from] > from ? next[from] : from + 1;
      lines.push({
        text: textFor(from, end - 1),
        words: source.slice(from, end),
        from,
        to: end - 1,
      });
      from = end;
    }
    return lines;
  }

  // wordId -> owning source cue id. Built from cues[].words[].id, never from
  // time: a midpoint lookup silently drops words that fall into inter-cue gaps.
  // Cached on the cues array identity — the store rebuilds that array (deep
  // clone in applyOverlays) whenever cues change, so identity is a safe key.
  const sourceCueIndexCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function sourceCueIndex(cues) {
    if (!Array.isArray(cues)) return new Map();
    const cached = sourceCueIndexCache && sourceCueIndexCache.get(cues);
    if (cached) return cached;
    const index = new Map();
    cues.forEach((cue) => {
      const words = Array.isArray(cue && cue.words) ? cue.words : [];
      words.forEach((word) => {
        const id = word && word.id;
        if (id == null) return;
        const key = String(id);
        if (!index.has(key)) index.set(key, cue.id);
      });
    });
    if (sourceCueIndexCache) sourceCueIndexCache.set(cues, index);
    return index;
  }

  // Absorb orphan runs (M122). A piece whose span starts or ends mid-cue
  // produced 1–2 word stubs ("of a", "then") on a line of their own — visual
  // litter that says nothing about the alignment. A run of **≤ 2 words merges
  // into an adjacent run**:
  //
  //   * the FIRST run merges forward (into the next one),
  //   * the LAST run merges backward (into the previous one),
  //   * a MIDDLE run merges into the SHORTER neighbour, **ties → previous**,
  //   * a piece with a single run is left alone,
  //   * merging CASCADES: if the merged run is still ≤ 2 words it merges again.
  //
  // One left-to-right pass over the current array (so the neighbour lengths a
  // decision sees are post-merge ones), re-examining the run just merged. The
  // merged run keeps the EARLIER run's cueId.
  //
  // A merged run may therefore SPAN a source cue boundary — a deliberate display
  // compromise: no data changes, the piece still owns exactly the same words,
  // the panel just stops showing hairline-separated stubs.
  // `OrigLineView.mergeShortRuns` (apps/mac) and `translate-model.js`
  // (designs/baocut-mac) carry the mirrored implementation; the three must stay
  // rule-for-rule identical.
  function mergeShortRuns(runs, minWords = 3) {
    if (!Array.isArray(runs) || runs.length < 2) return Array.isArray(runs) ? runs : [];
    const out = runs.slice();
    let i = 0;
    while (out.length > 1 && i < out.length) {
      if (out[i].words.length >= minWords) { i += 1; continue; }
      let target;
      if (i === 0) target = 1;
      else if (i === out.length - 1) target = i - 1;
      else target = out[i - 1].words.length <= out[i + 1].words.length ? i - 1 : i + 1;
      const keep = Math.min(i, target);
      const drop = Math.max(i, target);
      out[keep] = {
        cueId: out[keep].cueId,
        words: out[keep].words.concat(out[drop].words),
      };
      out.splice(drop, 1);
      i = keep;   // the merged run may still be short — cascade
    }
    return out;
  }

  // DISPLAY LAYER ONLY. A translation piece owns one semantic source span, and
  // that span routinely covers several source subtitle cues — that is the
  // visible many-to-one shape. Group the piece's source words into runs by
  // owning cue so the pair shows one part per source cue, then width-wrap
  // inside each part with sourceDisplayLines. Computed at render time: it
  // writes nothing, and source cue boundaries still never reach the alignment
  // decision layer (model payload, align engine, transAlign).
  //
  // Degradation is monotone: words with no id, or ids missing from every cue
  // (e.g. a locally edited cue whose words[] was dropped), extend the previous
  // run instead of disappearing. With no usable cue index at all the result is
  // a single part — byte-identical to the plain width-wrapped rendering.
  function sourceCueParts(piece, cues, language = '', fit = 42) {
    const words = Array.isArray(piece && piece.sourceWords) ? piece.sourceWords : [];
    const fallbackStart = finite(piece && piece.sourceStart, finite(piece && piece.start, 0));
    const fallbackEnd = Math.max(
      fallbackStart,
      finite(piece && piece.sourceEnd, finite(piece && piece.end, fallbackStart)),
    );
    const index = sourceCueIndex(cues);
    const runs = [];
    words.forEach((word) => {
      const id = word && word.id != null ? String(word.id) : null;
      const cueId = id !== null && index.has(id) ? index.get(id) : null;
      const last = runs[runs.length - 1];
      if (last && (cueId === null || last.cueId === cueId)) {
        last.words.push(word);
        return;
      }
      runs.push({ cueId, words: [word] });
    });

    const parts = [];
    mergeShortRuns(runs).forEach((run, runIndex) => {
      const lines = sourceDisplayLines(run.words, language, fit);
      if (!lines.length) return;
      const covered = lines.flatMap((line) => line.words);
      const first = covered[0];
      const last = covered[covered.length - 1];
      parts.push({
        key: (run.cueId == null ? 'part' : run.cueId) + ':' + runIndex,
        cueId: run.cueId == null ? null : run.cueId,
        words: covered,
        lines,
        start: finite(first && first.start, fallbackStart),
        end: Math.max(
          finite(first && first.start, fallbackStart),
          finite(last && last.end, fallbackEnd),
        ),
        text: joinSourceWords(covered, language),
      });
    });
    if (parts.length) return parts;

    // No usable source words: fall back to the flat source text, exactly as the
    // width-only rendering did.
    const lines = sourceDisplayLines(String((piece && piece.sourceText) || ''), language, fit);
    if (!lines.length) return [];
    return [{
      key: 'text:0',
      cueId: null,
      words: [],
      lines,
      start: fallbackStart,
      end: fallbackEnd,
      text: lines.map((line) => line.text).join(' '),
    }];
  }

  // M122: `translationSourceCue()` lived here — it wrapped a translation
  // piece's whole aligned source span in a synthetic cue so the canvas could
  // draw it as the ORIGINAL line. It is gone. On the canvas the original line
  // follows the active source Cue and the translation line its own piece: two
  // independent time streams that never narrow each other, exactly what the
  // burn-in does (`render_plan.rs::active_layouts`). The merged span survives
  // only in the panel, as `sourceCueParts()` display parts.

  function displayDurations(items, timing = DEFAULT_TIMING) {
    return (items || []).map((_, index) => {
      const window = displayWindow(items, index, timing);
      return window ? window.end - window.start : 0;
    });
  }

  // 译文单行模式下缺译句留空：`trans` 行没有内容就什么都不画（连背景框也不画），
  // 绝不用原文顶替译文行。烧录端同样如此（render_plan.rs），缺译的可见性由导出信
  // 封的 missingTranslations / partial-translation 负责，而不是靠悄悄换成原文。
  function resolveModeLines(mode, order = 'trans') {
    if (mode === 'orig') return ['orig'];
    if (mode === 'trans') return ['trans'];
    return order === 'orig' ? ['orig', 'trans'] : ['trans', 'orig'];
  }

  function nestedLineStyle(style, isTranslation) {
    const rootStyle = style || {};
    const override = isTranslation ? rootStyle.transStyle : rootStyle.origStyle;
    return override && typeof override === 'object'
      ? { ...rootStyle, ...override }
      : rootStyle;
  }

  // 「显式行级字号」只认 partial 自身写下的数值 fontSize：nestedLineStyle 的合并包
  // 必然从根继承 fontSize，拿它做判据会让任何 partial（哪怕只含 x/y）都跳过双语
  // compact 与 transScale 缩放，与烧录端 resolve_line_style 分叉。typeof 纪律同
  // linePosition：字符串 '18'、null、true 一律视为缺席，对齐 serde as_f64。
  function lineFontSize(style, isTranslation, compactOriginal) {
    const rootStyle = style || {};
    const override = isTranslation ? rootStyle.transStyle : rootStyle.origStyle;
    const explicitLineSize = override && typeof override === 'object'
      ? override.fontSize
      : undefined;
    if (Number.isFinite(explicitLineSize)) return Math.max(1, explicitLineSize);
    const base = Math.max(1, finite(rootStyle.fontSize, 30));
    const bilingualScale = Math.max(
      0.1,
      finite(rootStyle.bilingualOrigScale, DEFAULT_BILINGUAL_ORIG_SCALE),
    );
    if (isTranslation) {
      return base * bilingualScale
        * Math.max(0.1, finite(rootStyle.transScale, DEFAULT_TRANSLATION_RATIO));
    }
    return base * (compactOriginal ? bilingualScale : 1);
  }

  function layoutMetrics(style, frameWidth, frameHeight, isTranslation, compactOriginal) {
    const rootStyle = style || {};
    const lineStyle = nestedLineStyle(rootStyle, isTranslation);
    const canvasScale = referenceScale(frameWidth, frameHeight)
      * Math.max(0.05, finite(rootStyle.scale, 1));
    const fontSize = lineFontSize(rootStyle, isTranslation, compactOriginal) * canvasScale;
    const backgroundPadding = Math.max(0, finite(lineStyle.backgroundPadding, 10));
    const pad = backgroundPadding * canvasScale * 0.8;
    const backgroundStyle = lineStyle.backgroundStyle || 'wrap';
    const backgroundOn = lineStyle.background != null
      ? Boolean(lineStyle.background)
      : lineStyle.bgOn != null
        ? Boolean(lineStyle.bgOn)
        : !isTransparent(lineStyle.backgroundColor);
    const widthPct = clamp(finite(rootStyle.width, 80), 5, 100);
    const wrapWidth = Math.max(10, finite(frameWidth, 0) * widthPct / 100);
    const block = backgroundOn && backgroundStyle === 'block';
    return {
      lineStyle,
      canvasScale,
      fontSize,
      lineHeight: Math.max(0.5, finite(lineStyle.lineHeight, 1.2)),
      letterSpacing: finite(lineStyle.letterSpacing, 0) * canvasScale,
      padH: pad,
      padV: pad * (block ? 0.62 : 0.45),
      borderRadius: Math.max(0, finite(lineStyle.borderRadius, 15)) * canvasScale * 0.55,
      wrapWidth,
      maxTextWidth: Math.max(10, wrapWidth - pad * 2),
      blockMinWidth: block ? Math.max(0, finite(frameWidth, 0) * 0.28) : 0,
      backgroundOn,
      backgroundStyle,
    };
  }

  // 「真实背景」判据：开关开着**且**颜色不是近全透明，镜像 Mac
  // StyleFX.bgOn(style) && !VKColor.isTransparent(...) 与 CLI 的
  // has_real_background(line.style.background_on && a > 2)。不能只看 backgroundOn：
  // 显式 background:true 配一个 rgba(...,0) 在 layoutMetrics 里仍是 true，两端会分叉。
  // 颜色缺失/无法解析时 isTransparent 返回 false，即按"落回不透明默认色"处理，
  // 与 canvas 端 fill 兜底 #000000cc 一致。
  function hasRealBackground(metrics) {
    if (!metrics || !metrics.backgroundOn) return false;
    const lineStyle = metrics.lineStyle || {};
    return !isTransparent(lineStyle.backgroundColor);
  }

  // 共享底板只跟**一行**走：padding/圆角/颜色一律取源行（orig）的 spec，只有当源
  // 行没有真实背景、而译文行有时才 fallback 到译文行；另一行的 backgroundPadding
  // 被完全忽略。不能取"堆栈里的第一行"—— transTop 时译文行排在前面，而
  // origStyle/transStyle 又能各自覆盖 backgroundPadding，那样预览与烧录端会分叉。
  // 对应 Mac SubtitleFrameDrawing.sharedBackgroundSpec 与 CLI render_plan 的
  // plate_line。entries: [{ line, metrics }]，返回其中一项或 null。
  function sharedPlateLine(entries) {
    const list = (entries || []).filter(Boolean);
    const source = list.find((entry) => entry.line !== 'trans') || null;
    const trans = list.find((entry) => entry.line === 'trans') || null;
    if (source && trans) {
      return !hasRealBackground(source.metrics) && hasRealBackground(trans.metrics)
        ? trans
        : source;
    }
    return source || trans || null;
  }

  // 行级位置覆盖：origStyle.x/y 与 transStyle.x/y 是帧百分比。x、y 必须同时存在
  // 才算覆盖；只写一半视为未覆盖，该行继续参与锚点堆栈。
  //
  // y 钉住文本块的哪条边由 verticalAlign 决定：'top' = 顶边（换行向下生长）、
  // 'center' = 中心（缺省，历史行为）、'bottom' = 底边（换行向上生长）。
  function lineStyleKey(line) {
    return line === true || line === 'trans' ? 'transStyle' : 'origStyle';
  }

  const VERTICAL_ALIGNS = ['top', 'center', 'bottom'];

  // 严格白名单：只认这三个字符串字面量，'Top' / 'middle' / 数字 / 布尔 / 数组 /
  // 对象一律视为缺席。烧录端用 serde 的 as_str() 做同样匹配，预览端若宽松就会
  // 出现"预览按锚边、导出按中心"的分叉（同 linePosition 的 typeof 纪律）。
  function verticalAlignValue(value) {
    return typeof value === 'string' && VERTICAL_ALIGNS.indexOf(value) >= 0 ? value : null;
  }

  // 块级锚点：读根级 style.verticalAlign，缺席 = center（历史行为）。
  function blockVerticalAlign(style) {
    return verticalAlignValue((style || {}).verticalAlign);
  }

  // 行级锚点：与 x/y 一样只读 partial，不走 nestedLineStyle 的 merged 结果。
  // 根级 verticalAlign 是块级语义，铺进 merged 会把整栈锚点误当成行锚点。
  function lineVerticalAlign(style, line) {
    const override = (style || {})[lineStyleKey(line)];
    if (!override || typeof override !== 'object') return null;
    return verticalAlignValue(override.verticalAlign);
  }

  // 在 [slotTop, slotTop + slot] 的槽位里摆一段高 height 的内容。
  function alignWithin(slotTop, slot, height, align) {
    if (align === 'top') return slotTop;
    if (align === 'bottom') return slotTop + slot - height;
    return slotTop + (slot - height) / 2;
  }

  // 锚点 anchor 是这块内容的哪条边，返回顶边坐标。
  function anchorBlock(anchor, height, align) {
    return alignWithin(anchor, 0, height, align);
  }

  // 双语堆叠的结构性默认：钉住接缝——上行贴槽底（向上生长）、下行贴槽顶（向下
  // 生长），于是任一行折行时两行之间的缝隙纹丝不动。单行栈退回 center。
  function seamAlign(rank, count) {
    if (count < 2) return 'center';
    if (rank === 0) return 'bottom';
    if (rank + 1 === count) return 'top';
    return 'center';
  }

  // 落位中心 → 写回 style 的 y（锚边坐标），是 anchorBlock + height/2 的逆运算。
  // 拖拽与「独立摆放」写回都必须走它，否则锚点不是 center 的行一存就跳。
  function lineAnchorFromCenter(centerY, height, align) {
    const value = finite(centerY, 0);
    const size = Math.max(0, finite(height, 0));
    if (align === 'top') return value - size / 2;
    if (align === 'bottom') return value + size / 2;
    return value;
  }

  function roundPercent(value) {
    return Math.round(finite(value, 0) * 10) / 10;
  }

  function linePosition(style, line) {
    const override = (style || {})[lineStyleKey(line)];
    if (!override || typeof override !== 'object') return null;
    // 只认真正的数字，不做字符串强转：导出端用 serde 的 as_f64()，"20" / true / []
    // 在那边一律不算覆盖，预览端若宽松就会出现"预览浮动、导出回堆栈"的分叉。
    const { x, y } = override;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  // 生成写回 style 的补丁。position 为 null 表示清除覆盖：删掉 x/y 与
  // verticalAlign（回堆栈后锚点由接缝默认承担），该行其余排版键原样保留；整个
  // 覆盖对象空掉时写 null（而不是 {}），既能覆盖住 data.json 里的同名键、又不会
  // 让 nestedLineStyle 把空对象当成"存在显式行样式"。
  //
  // verticalAlign 只在 position 显式带这个键时才动：滑杆等只改 x/y 的调用照旧
  // 不带，已有锚点不会被顺手抹掉。带上非法值等同于清除。
  function lineStylePatch(style, line, position) {
    const key = lineStyleKey(line);
    const base = (style || {})[key];
    const next = { ...(base && typeof base === 'object' ? base : {}) };
    if (position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))) {
      next.x = roundPercent(position.x);
      next.y = roundPercent(position.y);
      if (Object.prototype.hasOwnProperty.call(position, 'verticalAlign')) {
        const align = verticalAlignValue(position.verticalAlign);
        if (align) next.verticalAlign = align;
        else delete next.verticalAlign;
      }
    } else {
      delete next.x;
      delete next.y;
      delete next.verticalAlign;
    }
    return { [key]: Object.keys(next).length ? next : null };
  }

  // 整体拖拽：锚点位移多少，已有的行覆盖同步位移多少（契约 §2）。
  function shiftLineOverrides(style, dx, dy) {
    const patch = {};
    ['orig', 'trans'].forEach((line) => {
      const position = linePosition(style, line);
      if (!position) return;
      Object.assign(patch, lineStylePatch(style, line, {
        x: roundPercent(position.x + finite(dx, 0)),
        y: roundPercent(position.y + finite(dy, 0)),
      }));
    });
    return patch;
  }

  // 纯布局：把行分成"参与堆栈"和"独立摆放"两组。
  //
  // 堆栈走槽位：双语时每行的槽位高 = 单行参考高 entry.reference（fontSize ×
  // lineHeight，不含折行），栈总高按槽位累加；实际内容再在自己的槽位里按行级
  // 锚点落位，缺省用接缝锚点。于是任一行折行只会往远离接缝的方向生长，另一行
  // 不动。entry 不带 reference 时槽位退回实际高度 —— 每行都只有 1 行时槽位 ==
  // 实际高，alignWithin 三态全部退化为恒等，逐比特还原改造前的数学（等价性
  // 验收线，见 tests 里的 "单行等价" 用例）。
  //
  // 整栈几何（stackHeight / stackCenter / 共享底板）从落位后的实际 extent 反推，
  // 不再用 total/2 从锚点反推：折行时底板随内容扩张，两行文本也不再互相侵入。
  function planLineLayout(entries, options) {
    const opts = options || {};
    const style = opts.style || {};
    const frameWidth = finite(opts.frameWidth, 0);
    const frameHeight = finite(opts.frameHeight, 0);
    const gap = Math.max(0, finite(opts.gap, 0));
    const padH = Math.max(0, finite(opts.padH, 0));
    const padV = Math.max(0, finite(opts.padV, 0));
    const list = (entries || []).map((entry, index) => {
      const height = Math.max(0, finite(entry.height, 0));
      return {
        line: entry.line,
        index,
        width: Math.max(0, finite(entry.width, 0)),
        height,
        reference: entry.reference == null
          ? height
          : Math.max(0, finite(entry.reference, height)),
      };
    });
    const anchor = {
      x: frameWidth * (finite(style.x, 50) / 100),
      y: frameHeight * (finite(style.y, 86) / 100),
    };
    // 行级 x/y 只在双语上下文生效，判据是"当前模式排了两行"，不是"这一刻真的画
    // 出了两行"——某条 cue 缺译文时导出端仍会让带覆盖的行浮动（apps/cli
    // line_position_override 只看 mode），预览必须同样处理。调用方不传时退回按
    // 实际行数判断，纯函数单测因此不必都写这个开关。
    const detachable = opts.bilingual == null ? list.length > 1 : Boolean(opts.bilingual);
    const stacked = [];
    const detached = [];
    list.forEach((entry) => {
      const position = detachable ? linePosition(style, entry.line) : null;
      // 行级锚点与 x/y 同门控：非双语上下文一律不读行级覆盖。
      const align = detachable ? lineVerticalAlign(style, entry.line) : null;
      if (position) detached.push({ ...entry, percent: position, align });
      else stacked.push({ ...entry, align });
    });

    const count = stacked.length;
    // 只有真的在堆两行以上时才用参考高做槽位；单行栈用实际高，保证"剩余单行 =
    // 天生单行"的跨端契约（方案 §8 决定 5）。
    const slotOf = (entry) => (count >= 2 ? entry.reference : entry.height);
    const stackWidth = count
      ? Math.max(...stacked.map((entry) => entry.width)) + padH * 2
      : 0;
    // 区块垂直锚点钉的是**共享底板的边**，不是字形 span：锚定总高要含底板上下
    // padding，落笔游标再让开一个 padV。于是 top 时底板顶边压在锚线上、bottom 时
    // 底板底边压在锚线上，与 apps/cli raster.rs stacked_extent/place_lines 及 Mac
    // 的 stackedSize 同构。center 恒等不变（-total/2 - padV + padV 抵消），separate
    // 模式 padV=0 也原样不动。
    const totalHeight = stacked.reduce((sum, entry) => sum + slotOf(entry), 0)
      + gap * Math.max(0, count - 1)
      + padV * 2;
    let cursor = anchorBlock(anchor.y, totalHeight, blockVerticalAlign(style) || 'center') + padV;
    const placedStack = stacked.map((entry, rank) => {
      const slot = slotOf(entry);
      const align = entry.align || seamAlign(rank, count);
      const top = alignWithin(cursor, slot, entry.height, align);
      cursor += slot + gap;
      return { ...entry, align, top };
    });
    const spanTop = count ? Math.min(...placedStack.map((entry) => entry.top)) : 0;
    const spanBottom = count
      ? Math.max(...placedStack.map((entry) => entry.top + entry.height))
      : 0;
    const stackHeight = count ? spanBottom - spanTop + padV * 2 : 0;
    const boxTop = spanTop - padV;
    const stackedPlacements = placedStack.map((entry) => {
      const x = (stackWidth - entry.width) / 2;
      return {
        ...entry,
        detached: false,
        x,
        y: entry.top - boxTop,
        center: {
          x: anchor.x + x + entry.width / 2 - stackWidth / 2,
          y: entry.top + entry.height / 2,
        },
      };
    });
    const detachedPlacements = detached.map((entry) => {
      const top = anchorBlock(
        frameHeight * (entry.percent.y / 100),
        entry.height,
        entry.align || 'center',
      );
      return {
        ...entry,
        align: entry.align || 'center',
        detached: true,
        top,
        center: {
          x: frameWidth * (entry.percent.x / 100),
          y: top + entry.height / 2,
        },
      };
    });
    return {
      anchor,
      stackWidth,
      stackHeight,
      // 整栈盒子的中心（含 padV）。锚点缺省且无折行时它等于 anchor，非 center 的
      // 块级锚点或折行槽位下则不等——渲染端必须用它定位共享底板与堆栈组。
      stackCenter: {
        x: anchor.x,
        y: count ? boxTop + stackHeight / 2 : anchor.y,
      },
      // 落位后的纯文本 extent（不含 padV），共享底板/吸附的反推依据。
      stackSpan: count ? { top: spanTop, bottom: spanBottom } : null,
      stacked: stackedPlacements,
      detached: detachedPlacements,
      placements: [...stackedPlacements, ...detachedPlacements]
        .sort((a, b) => a.index - b.index),
    };
  }

  // 选中语义：sel.line 缺失/为空 = 整体选中；'orig' / 'trans' = 只选中该行。
  function isLineSelected(sel, cueId, line) {
    if (!sel || cueId == null || sel.cueId !== cueId) return false;
    return sel.line == null || sel.line === line;
  }

  function nextLineSelection(sel, cueId, line, extend) {
    if (cueId == null) return sel || null;
    const target = line === 'orig' || line === 'trans' ? line : null;
    if (!target) return { cueId, line: null };
    const sameCue = Boolean(sel) && sel.cueId === cueId;
    if (!extend || !sameCue) return { cueId, line: target };
    const current = sel.line === 'orig' || sel.line === 'trans' ? sel.line : null;
    // Shift 点另一行 → 两行都选中（等价整体）；Shift 点同一行不改变现状。
    return current === target ? { cueId, line: target } : { cueId, line: null };
  }

  function parseColor(value) {
    const input = String(value || '').trim();
    if (!input || input === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    let match = /^#([\da-f]{3,8})$/i.exec(input);
    if (match) {
      let hex = match[1];
      if (hex.length === 3 || hex.length === 4) {
        hex = Array.from(hex, (part) => part + part).join('');
      }
      if (hex.length === 6 || hex.length === 8) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
        };
      }
    }
    match = /^rgba?\(([^)]+)\)$/i.exec(input);
    if (match) {
      const parts = match[1].split(',').map((part) => Number(part.trim()));
      if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
        return {
          r: clamp(parts[0], 0, 255),
          g: clamp(parts[1], 0, 255),
          b: clamp(parts[2], 0, 255),
          a: parts.length > 3 && Number.isFinite(parts[3]) ? clamp(parts[3], 0, 1) : 1,
        };
      }
    }
    return null;
  }

  function isTransparent(value) {
    const color = parseColor(value);
    return color ? color.a <= 0.01 : false;
  }

  function colorWithAlpha(value, alpha) {
    const color = parseColor(value);
    if (!color) return value;
    return `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${clamp(alpha, 0, 1).toFixed(3)})`;
  }

  function effectStyle(style) {
    const value = style || {};
    const outline = value.textOutline || {};
    const shadow = value.dropShadow || {};
    const glow = value.glow || {};
    const outlineOn = outline.on != null
      ? Boolean(outline.on)
      : value.outline != null
        ? Boolean(value.outline)
        : finite(outline.width, 0) > 0 && !isTransparent(outline.color);
    const shadowOn = shadow.on != null
      ? Boolean(shadow.on)
      : finite(shadow.blur, 0) > 0 || finite(shadow.distance, 0) > 0;
    const glowOn = glow.on != null ? Boolean(glow.on) : finite(glow.intensity, 0) > 0;
    return {
      outlineOn,
      outlineColor: outline.color || 'rgba(0,0,0,0.88)',
      outlineWidth: Math.max(0, finite(outline.width, value.outline ? 14 : 0)),
      shadowOn,
      shadowBlur: Math.max(0, finite(shadow.blur, value.outline ? 0.12 : 0.08)),
      shadowDistance: Math.max(0, finite(shadow.distance, 0.04)),
      shadowRotation: finite(shadow.rotation, 90),
      shadowColor: colorWithAlpha(
        shadow.color || '#000000',
        finite(shadow.opacity, value.outline ? 0.48 : 0.6),
      ),
      glowOn,
      glowColor: glow.color || '#FFFFFF',
      glowIntensity: clamp(finite(glow.intensity, 50), 0, 100),
      glowRange: clamp(finite(glow.range, 40), 0, 100),
    };
  }

  function normalizeWordAnimation(style) {
    const value = (style && (style.wordAnimation || style.anim)) || null;
    if (!value) {
      return {
        animationName: 'Color',
        spoken: {},
        active: { color: (style && style.karaokeColor) || '#8CAAFF' },
        unspoken: {},
      };
    }
    const name = value.animationName || value.name || 'None';
    if (name === 'None' || value.animationId === 'none') {
      return { animationName: 'None', spoken: {}, active: {}, unspoken: {} };
    }
    const base = { animationName: name, spoken: {}, active: {}, unspoken: {} };
    if (name === 'Color') base.active.color = '#FFD43B';
    if (name === 'Reveal') {
      base.unspoken.color = 'transparent';
      base.unspoken.shadowOff = true;
      base.unspoken.underline = false;
    }
    if (name === 'Highlight') {
      base.active.backgroundColor = '#FFD43B';
      base.active.color = '#0D0D0D';
      base.active.borderRadiusEm = 0.25;
    }
    if (name === 'Bounce') base.active.bottomEm = 0.22;
    if (name === 'Paint') {
      base.spoken.color = '#FFD43B';
      base.spoken.underline = true;
      base.spoken.underlineOffsetEm = 0.18;
    }
    if (name === 'Custom') {
      base.spoken.color = '#2EC971';
      base.active.backgroundColor = '#FFD43B';
      base.active.color = '#0D0D0D';
      base.active.borderRadiusEm = 0.25;
      base.unspoken.opacity = 0.5;
    }
    return {
      animationName: name,
      spoken: { ...base.spoken, ...(value.spoken || {}) },
      active: { ...base.active, ...(value.active || {}) },
      unspoken: { ...base.unspoken, ...(value.unspoken || {}) },
    };
  }

  function wordState(animation, index, currentIndex) {
    const resolved = animation || normalizeWordAnimation(null);
    const output = {};
    if (index <= currentIndex) Object.assign(output, resolved.spoken || {});
    if (index === currentIndex) Object.assign(output, resolved.active || {});
    if (index > currentIndex) Object.assign(output, resolved.unspoken || {});
    return output;
  }

  function wordIndexAt(words, time) {
    if (!Array.isArray(words) || !words.length) return 0;
    const t = finite(time, 0);
    let low = 0, high = words.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const end = finite(words[middle].end, finite(words[middle].t1, 0));
      if (t < end) high = middle;
      else low = middle + 1;
    }
    return Math.min(low, words.length - 1);
  }

  const TRANSITIONS = Object.freeze({
    'magic-fade': {
      max: 0.15, min: 0.35, bezier: [0.42, 0, 0.58, 1],
    },
    'magic-pop': {
      max: 0.01, min: 0.19, bezier: [0.22, 0.19, 0.54, 1.62],
    },
    'magic-flip': {
      max: 0.01, min: 0.19, bezier: [0.25, 0.46, 0.45, 0.94],
    },
  });

  function transitionConfig(style) {
    const rootStyle = style || {};
    const value = rootStyle.transition || {};
    return {
      id: value.transitionId || value.id || rootStyle.transitionId || 'none',
      speed: clamp(
        finite(value.transitionSpeed, finite(value.speed, finite(rootStyle.transitionSpeed, 50))),
        0,
        100,
      ),
    };
  }

  function transitionDuration(style) {
    const config = transitionConfig(style);
    const row = TRANSITIONS[config.id];
    return row ? row.max + (row.min - row.max) * ((100 - config.speed) / 100) : 0;
  }

  function cubicCoordinate(t, p1, p2) {
    const inverse = 1 - t;
    return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t;
  }

  function cubicDerivative(t, p1, p2) {
    const inverse = 1 - t;
    return 3 * inverse * inverse * p1
      + 6 * inverse * t * (p2 - p1)
      + 3 * t * t * (1 - p2);
  }

  function cubicBezier(progress, x1, y1, x2, y2) {
    const x = clamp(finite(progress, 0), 0, 1);
    let parameter = x;
    for (let i = 0; i < 6; i += 1) {
      const error = cubicCoordinate(parameter, x1, x2) - x;
      const slope = cubicDerivative(parameter, x1, x2);
      if (Math.abs(error) < 1e-6 || Math.abs(slope) < 1e-6) break;
      parameter = clamp(parameter - error / slope, 0, 1);
    }
    let low = 0, high = 1;
    for (let i = 0; i < 10; i += 1) {
      const coordinate = cubicCoordinate(parameter, x1, x2);
      if (Math.abs(coordinate - x) < 1e-6) break;
      if (coordinate < x) low = parameter;
      else high = parameter;
      parameter = (low + high) / 2;
    }
    return cubicCoordinate(parameter, y1, y2);
  }

  function transitionPose(style, displayStart, time, canvasScale = 1, frameRate = 30) {
    const config = transitionConfig(style);
    const row = TRANSITIONS[config.id];
    const duration = transitionDuration(style);
    const identity = { opacity: 1, scaleX: 1, scaleY: 1, blur: 0, active: false };
    if (!row || duration <= 0) return identity;
    const fps = Math.max(1, finite(frameRate, 30));
    const quantizedTime = Math.round(finite(time, 0) * fps) / fps;
    const quantizedStart = Math.round(finite(displayStart, 0) * fps) / fps;
    const phase = (quantizedTime - quantizedStart) / duration;
    if (phase >= 1) return identity;
    const eased = cubicBezier(clamp(phase, 0, 1), ...row.bezier);
    if (config.id === 'magic-fade') {
      return {
        opacity: clamp(eased, 0, 1),
        scaleX: 1,
        scaleY: 1,
        blur: Math.max(0, 6 * canvasScale * (1 - eased)),
        active: true,
      };
    }
    if (config.id === 'magic-pop') {
      const scale = 0.7 + 0.3 * eased;
      return { opacity: 1, scaleX: scale, scaleY: scale, blur: 0, active: true };
    }
    return {
      opacity: 1,
      scaleX: 1,
      scaleY: clamp(eased, 0, 1),
      blur: 0,
      active: true,
    };
  }

  const DELIVERY_FILE_SUFFIXES = new Set([
    'app', 'ai', 'avi', 'bin', 'c', 'cc', 'cn', 'com', 'conf', 'cpp', 'css', 'csv',
    'dev', 'doc', 'docx', 'edu', 'gif', 'go', 'gov', 'h', 'hpp', 'html', 'io', 'java',
    'jpeg', 'jpg', 'js', 'json', 'log', 'm', 'md', 'mov', 'mp3', 'mp4', 'net', 'org',
    'pdf', 'php', 'plist', 'png', 'py', 'rb', 'rs', 'sh', 'sql', 'svg', 'swift', 'toml',
    'ts', 'txt', 'uk', 'us', 'vtt', 'wav', 'xml', 'yaml', 'yml', 'zip',
  ]);
  const DELIVERY_ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'rev', 'hon', 'fr', 'gen',
    'gov', 'sen', 'rep', 'col', 'lt', 'sgt', 'capt', 'vs', 'etc', 'inc', 'ltd',
    'corp', 'dept', 'vol', 'fig',
  ]);
  const DELIVERY_CLOSERS = new Set(Array.from(')]}\uFF09\uFF3D\uFF5D\u3011\u3015\u300D\u300F\u3009\u300B\u201D\u2019'));
  const DELIVERY_TRIM = new Set(Array.from('"\'()[]{}<>,;:!?，。！？'));
  const isDeliveryAsciiAlphaNumeric = (character) => /[A-Za-z0-9]/u.test(character || '');
  const isDeliveryAsciiAlpha = (character) => /[A-Za-z]/u.test(character || '');
  const isDeliveryCjk = (character) => /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/u.test(character || '');
  const isDeliveryAsciiToken = (character) => (
    isDeliveryAsciiAlphaNumeric(character) || '._-@/:\\~%+?=&()[]{}'.includes(character)
  );
  const trimDeliveryPunctuation = (value) => {
    const chars = Array.from(value);
    let start = 0;
    let end = chars.length;
    while (start < end && DELIVERY_TRIM.has(chars[start])) start += 1;
    while (end > start && DELIVERY_TRIM.has(chars[end - 1])) end -= 1;
    return chars.slice(start, end).join('');
  };

  function deliveryCodeLike(token) {
    const lower = token.toLocaleLowerCase();
    if (['://', '@', '/', '\\', '=', '{', '}', '[', ']', '_', '::', '->']
      .some((needle) => lower.includes(needle))
      || (lower.includes('(') && lower.includes(')'))) return true;
    const pieces = trimDeliveryPunctuation(lower).split('.').filter(Boolean);
    return pieces.length >= 2 && DELIVERY_FILE_SUFFIXES.has(pieces[pieces.length - 1]);
  }

  function preserveDeliveryAsciiPeriod(chars, index) {
    const previous = index > 0 ? chars[index - 1] : null;
    const next = index + 1 < chars.length ? chars[index + 1] : null;
    if (isDeliveryCjk(previous) || isDeliveryCjk(next)) {
      if (isDeliveryCjk(previous) && isDeliveryAsciiAlphaNumeric(next)) {
        let right = index + 1;
        while (right < chars.length
          && (isDeliveryAsciiAlphaNumeric(chars[right]) || chars[right] === '.')) right += 1;
        const pieces = chars.slice(index + 1, right).join('')
          .replace(/^\.+|\.+$/gu, '').split('.').filter(Boolean);
        if (DELIVERY_FILE_SUFFIXES.has((pieces[0] || '').toLocaleLowerCase())
          || DELIVERY_FILE_SUFFIXES.has((pieces[pieces.length - 1] || '').toLocaleLowerCase())) {
          return true;
        }
      }
      return false;
    }
    if (/[0-9]/u.test(previous || '') && /[0-9]/u.test(next || '')) return true;
    if (isDeliveryAsciiAlphaNumeric(previous) && isDeliveryAsciiAlphaNumeric(next)) return true;

    let left = index;
    while (left > 0 && isDeliveryAsciiToken(chars[left - 1])) left -= 1;
    let right = index + 1;
    while (right < chars.length && isDeliveryAsciiToken(chars[right])) right += 1;
    const token = chars.slice(left, right).join('');
    const lower = token.toLocaleLowerCase();
    if (!isDeliveryAsciiToken(next)) {
      const pieces = trimDeliveryPunctuation(chars.slice(left, index).join('').toLocaleLowerCase())
        .split('.').filter(Boolean);
      if (pieces.length >= 2 && DELIVERY_FILE_SUFFIXES.has(pieces[pieces.length - 1])) return false;
    }
    if (index === left && isDeliveryAsciiAlphaNumeric(next)
      && (left === 0 || /\s/u.test(chars[left - 1]))) return true;
    if (deliveryCodeLike(token) || (/[0-9]/u.test(lower) && lower.includes('.'))) return true;
    const pieces = lower.split('.').filter(Boolean);
    if (pieces.length >= 2
      && pieces.every((piece) => piece.length === 1 && isDeliveryAsciiAlpha(piece))) return true;
    if (isDeliveryAsciiAlphaNumeric(next) && pieces.length >= 2
      && DELIVERY_FILE_SUFFIXES.has(pieces[pieces.length - 1])) return true;
    if (index + 1 === right) {
      let wordLeft = index;
      while (wordLeft > 0 && isDeliveryAsciiAlpha(chars[wordLeft - 1])) wordLeft -= 1;
      if (DELIVERY_ABBREVIATIONS.has(chars.slice(wordLeft, index).join('').toLocaleLowerCase())) {
        return true;
      }
    }
    return false;
  }

  function isDeliveryClosingDelimiter(chars, index) {
    const character = chars[index];
    if (character !== '"' && character !== '\'') {
      return DELIVERY_CLOSERS.has(character);
    }
    const intraWord = (candidate) => (
      chars[candidate] === '\''
      && candidate > 0 && candidate + 1 < chars.length
      && /\p{L}/u.test(chars[candidate - 1]) && /\p{L}/u.test(chars[candidate + 1])
    );
    if (intraWord(index)) return false;
    const prior = chars.slice(0, index)
      .filter((candidate, offset) => candidate === character && !intraWord(offset)).length;
    return prior % 2 === 1;
  }

  function shouldReplaceDeliveryPunctuation(chars, index) {
    const character = chars[index];
    const comma = character === ',' || character === '\uFF0C';
    const period = character === '.' || character === '\u3002' || character === '\uFF0E';
    if (!comma && !period) return false;
    const previous = index > 0 ? chars[index - 1] : null;
    const next = index + 1 < chars.length ? chars[index + 1] : null;
    if (/[0-9]/u.test(previous || '') && /[0-9]/u.test(next || '')) return false;
    if (character === '.') {
      let start = index;
      while (start > 0 && chars[start - 1] === '.') start -= 1;
      let end = index + 1;
      while (end < chars.length && chars[end] === '.') end += 1;
      if (end - start >= 3 || preserveDeliveryAsciiPeriod(chars, index)) return false;
    }
    return true;
  }

  // Non-destructive delivery projection shared with bcut-flow-core. Stored
  // text stays literal; presentation in every language replaces ordinary
  // commas and periods with a single separator while preserving data tokens.
  function projectPunctuation(text, _language, enabled = true) {
    const value = String(text || '');
    if (!enabled) return value;
    const chars = Array.from(value);
    const output = [];
    let pendingSeparator = false;
    chars.forEach((character, index) => {
      if (character === '\n' || character === '\r') {
        output.push(character);
        pendingSeparator = false;
        return;
      }
      if (shouldReplaceDeliveryPunctuation(chars, index)) {
        while (output.length && /\s/u.test(output[output.length - 1])
          && output[output.length - 1] !== '\n' && output[output.length - 1] !== '\r') output.pop();
        pendingSeparator = true;
        return;
      }
      if (/\s/u.test(character)) {
        if (!pendingSeparator) output.push(character);
        return;
      }
      if (pendingSeparator && isDeliveryClosingDelimiter(chars, index)) {
        output.push(character);
        return;
      }
      if (pendingSeparator && output.length) output.push(' ');
      output.push(character);
      pendingSeparator = false;
    });
    return output.join('');
  }

  function transformText(text, style) {
    const value = String(text || '');
    const transform = style && style.textTransform;
    if (transform === 'uppercase') return value.toLocaleUpperCase();
    if (transform === 'lowercase') return value.toLocaleLowerCase();
    return value;
  }

  return {
    REFERENCE_SHORT_EDGE,
    LANDSCAPE_ASPECT,
    DEFAULT_TIMING,
    DEFAULT_BILINGUAL_ORIG_SCALE,
    DEFAULT_TRANSLATION_RATIO,
    clamp,
    referenceScale,
    fitFrame,
    displayPadding,
    displayWindow,
    displayDurations,
    activeIndex,
    activeTimedItem,
    sourceDisplayLines,
    mergeShortRuns,
    sourceCueParts,
    resolveModeLines,
    nestedLineStyle,
    lineFontSize,
    layoutMetrics,
    hasRealBackground,
    sharedPlateLine,
    lineStyleKey,
    linePosition,
    lineStylePatch,
    shiftLineOverrides,
    VERTICAL_ALIGNS,
    blockVerticalAlign,
    lineVerticalAlign,
    alignWithin,
    anchorBlock,
    seamAlign,
    lineAnchorFromCenter,
    planLineLayout,
    isLineSelected,
    nextLineSelection,
    parseColor,
    isTransparent,
    colorWithAlpha,
    effectStyle,
    normalizeWordAnimation,
    wordState,
    wordIndexAt,
    transitionConfig,
    transitionDuration,
    cubicBezier,
    transitionPose,
    projectPunctuation,
    transformText,
  };
});
