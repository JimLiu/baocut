/* Project video library: bounded rows and media facts, independent of React. */
(function () {
  const ROW_HEIGHT = 96;
  function windowFor(count, top, height) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const start = Math.min(n, Math.max(0, Math.floor(Math.max(0, top || 0) / ROW_HEIGHT) - 3));
    const end = Math.min(n, Math.max(start, Math.ceil((Math.max(0, top || 0) + Math.max(0, height || 0)) / ROW_HEIGHT) + 3));
    return {start, end, height: n * ROW_HEIGHT};
  }
  function previewUrl(source) {
    const url = typeof source?.url === 'string' ? source.url.trim() : '';
    return /^(https?:\/\/|blob:|\/|\.\.?\/|assets\/)/.test(url) ? url : null;
  }
  /* 使用状态只看元素引用（2026-09-16）：没有「主视频」——项目原片也是普通视频元素，
     它在不在时间轴上和别的素材一样由引用决定；「转录源」是另一回事（面板单独标）。 */
  function usageIndex(elements, docs) {
    const names = new Set(), ids = new Set();
    for (const element of elements || []) {
      const value = {...element, ...(docs || {})[element.id]};
      if (value.kind !== 'video') continue;
      if (value.asset) names.add(value.asset);
      if (value.srcId || value.sourceId) ids.add(value.srcId || value.sourceId);
    }
    return {names, ids};
  }
  function usage(source, index) {
    return index.names.has(source.name) || index.ids.has(source.id) ? '已在时间轴' : '未使用';
  }
  const api = {ROW_HEIGHT, windowFor, previewUrl, usageIndex, usage};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.BC_VIDEO_LIBRARY = api;
})();
