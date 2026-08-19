// BaoCut Subtitle Studio — 虚拟列表的纯逻辑（window.BCS_VLIST）。
// 只做数组/数字运算，不碰 DOM 也不依赖 React，方便 node --test 直接加载。
// 行模型是"章节头 + 条目"压平成的一维数组（与 Mac 端 SubtitlePaneTable 的
// .head/.item 一致），高度先用估算值占位，渲染后由 ResizeObserver 实测回填。
// 高度缓存键 =(行 key, 内容指纹, 列表宽度)：内容变了只失效一行，宽度变了全表失效。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BCS_VLIST = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 行模型 ----------
  // groups: [{ ch, ci, rows: [...] }]（panes.jsx 的 byChapter 输出）
  // itemKey(row) -> 稳定 key（字幕用 cue.id）
  function flatten(groups, itemKey) {
    const out = [];
    for (const g of groups) {
      out.push({ kind: 'head', key: 'ch:' + g.ci, ci: g.ci, ch: g.ch, sticky: true });
      for (const r of g.rows) out.push({ kind: 'item', key: itemKey(r), ci: g.ci, item: r });
    }
    return out;
  }

  function indexByKey(rows) {
    const m = new Map();
    for (let i = 0; i < rows.length; i++) m.set(rows[i].key, i);
    return m;
  }

  // ---------- 高度 ----------
  // 前缀偏移，长度 n+1，offsets[n] 是总高度。
  function offsets(heights) {
    const out = new Array(heights.length + 1);
    out[0] = 0;
    for (let i = 0; i < heights.length; i++) out[i + 1] = out[i] + heights[i];
    return out;
  }

  // 最后一个满足 offsets[i] <= y 的 i（限制在 [0, n-1]）。offsets 单调不减。
  function findIndexAt(offs, y) {
    const n = offs.length - 1;
    if (n <= 0) return 0;
    if (!(y > 0)) return 0;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offs[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // 可见区间（end 为开区间），上下各留 overscan 像素。
  function visibleRange(offs, scrollTop, viewH, overscan) {
    const n = offs.length - 1;
    if (n <= 0) return { start: 0, end: 0 };
    const pad = overscan || 0;
    const top = Math.max(0, scrollTop - pad);
    const bottom = scrollTop + Math.max(0, viewH) + pad;
    const start = findIndexAt(offs, top);
    let end = start;
    while (end < n && offs[end] < bottom) end++;
    if (end <= start) end = Math.min(n, start + 1);
    return { start, end };
  }

  // 渲染集合 = 窗口内的行 ∪ 钉住的行（编辑中 / 光标交接目标）。返回升序去重下标。
  function renderPlan(rows, range, pinnedKeys, byKey) {
    const idx = [];
    for (let i = range.start; i < range.end; i++) idx.push(i);
    if (pinnedKeys && pinnedKeys.length) {
      const map = byKey || indexByKey(rows);
      const extra = [];
      for (const k of pinnedKeys) {
        if (k == null) continue;
        const i = map.get(k);
        if (i == null || (i >= range.start && i < range.end)) continue;
        if (extra.indexOf(i) < 0) extra.push(i);
      }
      if (extra.length) return idx.concat(extra).sort((a, b) => a - b);
    }
    return idx;
  }

  // 视口顶部应该固定显示的章节头：窗口起点之前最近的 sticky 行。
  // 下一个 sticky 行顶上来时按真实 sticky 语义被顶走。
  function stickyAt(rows, offs, scrollTop, heights) {
    let head = -1;
    for (let i = Math.min(findIndexAt(offs, scrollTop), rows.length - 1); i >= 0; i--) {
      if (offs[i] > scrollTop) continue;
      if (rows[i].sticky) { head = i; break; }
    }
    if (head < 0) return null;
    const h = heights[head] || 0;
    let top = scrollTop;
    for (let i = head + 1; i < rows.length; i++) {
      if (!rows[i].sticky) continue;
      if (offs[i] < scrollTop + h) top = Math.max(0, offs[i] - h);
      break;
    }
    if (offs[head] >= top) return null;   // 本体就在位，不用叠加浮层
    return { index: head, top };
  }

  // 让第 index 行进入视口所需的 scrollTop；已在视口内返回 null。
  function scrollTopFor(offs, index, scrollTop, viewH, margin) {
    const n = offs.length - 1;
    if (index < 0 || index >= n) return null;
    const m = margin == null ? 8 : margin;
    const top = offs[index], h = offs[index + 1] - offs[index];
    if (top >= scrollTop + m && top + h <= scrollTop + viewH - m) return null;
    return Math.max(0, Math.min(offs[n] - viewH, top - viewH / 2 + h / 2));
  }

  // 把第 index 行中心放到视口中心；首尾按可滚范围钳制。
  function centerScrollTop(offs, index, viewH, tailPad) {
    const n = offs.length - 1;
    if (index < 0 || index >= n) return null;
    const top = offs[index], h = offs[index + 1] - offs[index];
    const max = Math.max(0, offs[n] + (tailPad || 0) - viewH);
    return Math.floor(Math.max(0, Math.min(max, top - viewH / 2 + h / 2)));
  }

  // Mac JumpPill 的 12pt 舒适边界：整行越过边界才显示方向。
  function offscreenDirection(offs, index, scrollTop, viewH, margin) {
    const n = offs.length - 1;
    if (index < 0 || index >= n || viewH <= 0) return null;
    const m = margin == null ? 12 : margin;
    const top = offs[index], bottom = offs[index + 1];
    if (bottom <= scrollTop + m) return 'up';
    if (top >= scrollTop + viewH - m) return 'down';
    return null;
  }

  // ---------- 高度缓存 ----------
  // estimate(row, width) 给未测量行的占位高度；fingerprint(row) 是内容指纹。
  function createHeightStore(opts) {
    const estimate = opts.estimate, fingerprint = opts.fingerprint;
    let width = 0;
    let cache = new Map();   // key -> { fp, h }
    return {
      get width() { return width; },
      setWidth(w) {
        const next = Math.round(w || 0);
        if (next === width) return false;
        width = next;
        cache = new Map();
        return true;
      },
      height(row) {
        const hit = cache.get(row.key);
        if (hit && hit.fp === fingerprint(row)) return hit.h;
        return estimate(row, width);
      },
      // 返回 true 表示缓存被更新（需要重排）
      measure(row, h) {
        if (!(h > 0)) return false;
        const fp = fingerprint(row);
        const hit = cache.get(row.key);
        if (hit && hit.fp === fp && Math.abs(hit.h - h) <= 0.5) return false;
        cache.set(row.key, { fp, h });
        return true;
      },
      heights(rows) {
        const out = new Array(rows.length);
        for (let i = 0; i < rows.length; i++) out[i] = this.height(rows[i]);
        return out;
      },
      // 行被移除后清掉缓存，避免长会话里无限增长
      prune(rows) {
        if (cache.size <= rows.length * 2) return;
        const live = new Set(rows.map((r) => r.key));
        for (const k of Array.from(cache.keys())) if (!live.has(k)) cache.delete(k);
      },
      size() { return cache.size; },
    };
  }

  // ---------- 字幕行的估算 ----------
  // 常量对应 subtitle.css / editor.css 的实际盒子，估得越准首屏抖动越少。
  const SB = {
    gap: 8,          // .vk-vrow 的 padding-bottom
    paraGap: 12,     // .vk-vrow--para 的 padding-top（与 gap 合起来复现 20px）
    frame: 15,       // .sb 的 border(2) + padding-top/bottom(13)
    head: 23,        // .sb__head + margin-bottom
    textPad: 4,      // .sb-text 的上下 padding
    line: 20.25,     // 13.5px × 1.5
    inset: 27,       // .sb 左右 padding + border
    latin: 6.75,
    cjk: 13.5,
    headRow: 50,     // 章节头行
  };

  function textWidth(text) {
    let w = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      w += c > 0x2e80 && c < 0xffef ? SB.cjk : SB.latin;
    }
    return w;
  }

  function estimateSubtitleRow(row, width) {
    if (row.kind === 'head') return SB.headRow;
    const cue = row.item && row.item.cue ? row.item.cue : row.item || {};
    const inner = Math.max(120, (width || 360) - SB.inset);
    const lines = Math.max(1, Math.ceil(textWidth(String(cue.text || '')) / inner));
    return SB.gap + (cue.paraStart ? SB.paraGap : 0)
      + SB.frame + SB.head + SB.textPad + lines * SB.line;
  }

  function subtitleFingerprint(row) {
    if (row.kind === 'head') return 'h';
    const cue = row.item && row.item.cue ? row.item.cue : row.item || {};
    return (cue.paraStart ? '1' : '0') + '|' + (cue.text || '');
  }

  return {
    flatten, indexByKey, offsets, findIndexAt, visibleRange, renderPlan, stickyAt,
    scrollTopFor, centerScrollTop, offscreenDirection,
    createHeightStore, estimateSubtitleRow, subtitleFingerprint, SB,
  };
}));
