// BaoCut Subtitle Studio — 光速修正的导出基线与 Delta 判定（window.BCS_EXPORT_DELTA）。
// 视频导出成功时按"输出字幕 Cue"盖章一份内容基线；之后的小编辑（改词、断行、
// 并行、调时）与基线逐条比对，映射成输出时间窗，让"光速修正"只重渲这些秒数
// 并拼接回已导出的文件，而不是重跑整条管线。原文行与译文行分层比对——
// 任一层变化都会让覆盖该时间窗的导出画面失效。
// UMD：无 React/Konva 依赖，node --test 可直接加载。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BCS_EXPORT_DELTA = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fnv(parts) {
    let h = 0x811c9dc5 >>> 0;
    for (const part of parts) {
      const s = String(part);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      h ^= 0x1f; h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(36);
  }

  const cueKey = (c, i) => c.id != null ? String(c.id) : 't' + (Number(c.start) || 0).toFixed(2) + ':' + i;
  const cueHash = (c) => fnv([c.text || '', (Number(c.start) || 0).toFixed(2), (Number(c.end) || 0).toFixed(2)]);

  function layerSnapshot(cues) {
    const out = {};
    (cues || []).forEach((c, i) => { out[cueKey(c, i)] = { h: cueHash(c), s: Number(c.start) || 0, e: Number(c.end) || 0 }; });
    return out;
  }

  // 导出成功那一刻的快照。orig / trans 分层：导出的画面里两层都可能烧进帧。
  function snapshot(doc, artifact) {
    return {
      title: (doc.meta && doc.meta.title) || '',
      rev: doc.rev || 0,
      orig: layerSnapshot(doc.timelineCues || doc.cues),
      trans: layerSnapshot(doc.timelineTransCues || doc.transCues),
      duration: (doc.meta && doc.meta.duration) || 0,
      artifact: artifact || null,
      at: Date.now(),
    };
  }

  const PAD = 0.4;   // 每个脏 Cue 时间窗的重渲余量（秒）
  const JOIN = 0.8;  // 相邻时间窗合并阈值（秒）

  function mergeWindows(wins, maxEnd) {
    const sorted = wins
      .map(function (w) { return [Math.max(0, w[0] - PAD), Math.min(maxEnd || Infinity, w[1] + PAD)]; })
      .filter(function (w) { return w[1] > w[0]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    const out = [];
    sorted.forEach(function (w) {
      const last = out[out.length - 1];
      if (last && w[0] - last[1] <= JOIN) last[1] = Math.max(last[1], w[1]);
      else out.push(w);
    });
    return out;
  }

  function diffLayer(baseLayer, cues, dirty) {
    const now = new Map();
    (cues || []).forEach(function (c, i) { now.set(cueKey(c, i), c); });
    let count = 0;
    now.forEach(function (c, key) {
      const b = baseLayer[key];
      if (!b) { dirty.push([Number(c.start) || 0, Number(c.end) || 0]); count++; }
      else if (b.h !== cueHash(c)) {
        dirty.push([Math.min(b.s, Number(c.start) || 0), Math.max(b.e, Number(c.end) || 0)]);
        count++;
      }
    });
    Object.keys(baseLayer).forEach(function (key) {
      if (!now.has(key)) { const b = baseLayer[key]; dirty.push([b.s, b.e]); count++; }
    });
    return count;
  }

  // 当前 doc 对基线的差异：
  // → null（无基线 / 基线属于另一个项目）
  // → { count, windows, seconds, upToDate }，windows 为合并后的输出时间窗。
  function delta(doc, base) {
    if (!doc || !base || !base.orig) return null;
    if (base.title && doc.meta && doc.meta.title && base.title !== doc.meta.title) return null;
    const dirty = [];
    let count = 0;
    count += diffLayer(base.orig, doc.timelineCues || doc.cues, dirty);
    count += diffLayer(base.trans, doc.timelineTransCues || doc.transCues, dirty);
    const maxEnd = Math.max(base.duration || 0, (doc.meta && doc.meta.duration) || 0);
    const windows = mergeWindows(dirty, maxEnd);
    const seconds = windows.reduce(function (a, w) { return a + (w[1] - w[0]); }, 0);
    return { count: count, windows: windows, seconds: seconds, upToDate: count === 0 };
  }

  return { snapshot: snapshot, delta: delta, mergeWindows: mergeWindows, cueHash: cueHash };
}));
