// BaoCut Subtitle Studio — 项目列表页（/projects/）的纯函数：路由判定、搜索
// 过滤、视图偏好、缩略图 URL、徽标文案。可单测，不碰 DOM。
//
// 数据源是 GET /__bcut/projects 的条目（见 docs/bcut-cli-server-reference.md §4.5）：
//   { id, path, source, mounted, root, title, mediaKind, duration, modifiedAt, transcriptReady }
// 端点已按 modifiedAt 降序排好，这里只过滤不重排 —— 排序真相在服务端一处。
(function (root, factory) {
  const panels = (typeof module === 'object' && module.exports)
    ? require('./panels.js')
    : (root && root.BCS_PANELS);
  const api = factory(panels);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_PROJECTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  const VIEW_KEY = 'bcs:projects-view';

  // ---------- 路由 ----------
  // 列表页与编辑器页是同一份 index.html（serve 的 /projects/ 直接返回它），
  // 页面按 pathname 分流：只有 /projects 与 /projects/ 本身是列表页，
  // /projects/<id>/… 是某个项目的编辑器。
  function isProjectsRoute(pathname) {
    const segs = String(pathname || '').split('/').filter(Boolean);
    return segs.length === 1 && segs[0] === 'projects';
  }

  // 项目页地址（带尾斜杠：页面资源是相对路径）。
  function projectHref(id) {
    return '/projects/' + encodeURIComponent(String(id == null ? '' : id)) + '/';
  }

  // ---------- 搜索 ----------
  // 只搜标题 / 路径 / id：Studio 没有服务端全文（转录、译文）检索端点，
  // 原型那套内容命中分组因此不做。空查询原样返回（保持服务端顺序）。
  function searchProjects(list, q) {
    const arr = Array.isArray(list) ? list : [];
    const needle = String(q == null ? '' : q).trim().toLowerCase();
    if (!needle) return arr;
    return arr.filter((p) => p && [p.title, p.path, p.id].some(
      (v) => typeof v === 'string' && v.toLowerCase().indexOf(needle) >= 0));
  }

  // ---------- 视图偏好 ----------
  function normalizeView(v) { return v === 'list' ? 'list' : 'grid'; }

  function loadView(storage) {
    if (!storage) return 'grid';
    try { return normalizeView(storage.getItem(VIEW_KEY)); } catch (e) { return 'grid'; }
  }

  function saveView(storage, view) {
    if (!storage) return;
    try { storage.setItem(VIEW_KEY, normalizeView(view)); } catch (e) { /* 隐私模式忽略 */ }
  }

  // ---------- 缩略图 ----------
  // 只有视频项目有帧可抽（GET <project>/__bcut/thumb）。t 取 min(1, 时长/2)：
  // 首帧常是黑场或片头卡，往里一点更能认出内容；短片不越界。
  // 音频/图片/无媒体/无时长一律返回 null，由调用方画类型占位图标。
  function thumbUrl(entry, width) {
    if (!entry || entry.mediaKind !== 'video') return null;
    const duration = Number(entry.duration);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const t = Math.min(1, duration / 2);
    const w = Math.round(Number(width) > 0 ? Number(width) : 320);
    return projectHref(entry.id) + '__bcut/thumb?t=' + t + '&w=' + w;
  }

  // ---------- 徽标 ----------
  // 状态：Studio 的项目只有"转录产物在不在"这一个可判定阶段（转录中/失败是
  // 任务中枢的事，不是项目字段），所以两档就够 —— 不做原型那五档的占位。
  function statusBadge(entry) {
    return entry && entry.transcriptReady
      ? { label: '已转录', cls: 'vk-badge--complete' }
      : { label: '未转录', cls: 'vk-badge--queued' };
  }

  // 来源：沿用旧服务端列表页的词汇。dir（root 下未登记的子目录）不显示 —— 它是
  // 默认情况，给每张卡都挂一个"目录"徽标只是噪音。
  const SOURCE_LABEL = { mount: '挂载', root: '当前项目', registry: '项目库' };
  function sourceLabel(entry) {
    return (entry && SOURCE_LABEL[entry.source]) || null;
  }

  return {
    VIEW_KEY, SOURCE_LABEL,
    isProjectsRoute, projectHref, searchProjects,
    normalizeView, loadView, saveView,
    thumbUrl, statusBadge, sourceLabel,
    // 相对时间与媒体图标与侧边栏 RECENT 共用一份实现（panels.js）。
    relativeTime: P && P.relativeTime,
    mediaIcon: P && P.mediaIcon,
  };
});
