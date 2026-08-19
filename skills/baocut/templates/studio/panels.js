// BaoCut Subtitle Studio — 外壳面板状态与侧边栏派生（纯函数，可单测）。
//
// 面板 = { sidebar, rpane, timeline, stage } 四个布尔。stage 与 rpane 互斥兜底：
// 两个都关会让内容区空掉，所以关掉后一个时自动把前一个开回来（与原型
// designs/baocut-mac/app/store.jsx 的 setPanel 同语义）。
//
// 尺寸限幅与原型一致：侧栏 220–400（<100 自动收起）、右侧 pane 360–（宽度-420）、
// 时间轴 160–80%（<80 自动隐藏）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_PANELS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PANELS_KEY = 'bcs:panels';
  const SIDEBAR_W_KEY = 'vk-sidebar-w';
  const RPANE_W_KEY = 'vk-rpane-w';
  const TIMELINE_H_KEY = 'vk-timeline-h';

  const DEFAULTS = { sidebar: true, rpane: true, timeline: true, stage: true };
  const NAMES = ['sidebar', 'rpane', 'timeline', 'stage'];

  const SIDEBAR = { def: 240, min: 220, max: 400, hide: 100 };
  const RPANE = { min: 360, rest: 420 };
  const TIMELINE = { def: 280, min: 160, hide: 80, maxRatio: 0.8 };

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  // 只认布尔，其它一律回落到默认值 —— localStorage 可能被旧版本或手工写脏。
  function normalize(raw) {
    const out = {};
    NAMES.forEach((name) => {
      const v = raw && typeof raw[name] === 'boolean' ? raw[name] : DEFAULTS[name];
      out[name] = v;
    });
    if (!out.stage && !out.rpane) out.stage = true;
    return out;
  }

  // 原型 setPanel：stage/rpane 互斥兜底 —— 关掉其中一个时，若另一个已关，则把它开回来。
  function setPanel(panels, name, on) {
    const cur = normalize(panels);
    if (NAMES.indexOf(name) < 0) return cur;
    const next = Object.assign({}, cur, { [name]: !!on });
    if (!next.stage && !next.rpane) {
      if (name === 'stage') next.rpane = true; else next.stage = true;
    }
    return next;
  }

  function loadPanels(storage) {
    if (!storage) return normalize(null);
    try { return normalize(JSON.parse(storage.getItem(PANELS_KEY))); } catch (e) { return normalize(null); }
  }

  function savePanels(storage, panels) {
    if (!storage) return;
    try { storage.setItem(PANELS_KEY, JSON.stringify(normalize(panels))); } catch (e) { /* 隐私模式忽略 */ }
  }

  function loadNumber(storage, key, fallback) {
    if (!storage) return fallback;
    try {
      const v = parseInt(storage.getItem(key), 10);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    } catch (e) { return fallback; }
  }

  function saveNumber(storage, key, value) {
    if (!storage) return;
    try { storage.setItem(key, String(Math.round(value))); } catch (e) { /* 隐私模式忽略 */ }
  }

  function loadSidebarWidth(storage) {
    return clamp(loadNumber(storage, SIDEBAR_W_KEY, SIDEBAR.def), SIDEBAR.min, SIDEBAR.max);
  }

  // 拖拽结果：宽度小于 hide 阈值时收起侧栏，否则限幅。
  function sidebarDrag(width) {
    if (width < SIDEBAR.hide) return { hide: true, width: SIDEBAR.min };
    return { hide: false, width: Math.round(clamp(width, SIDEBAR.min, SIDEBAR.max)) };
  }

  // 时间轴高度：小于 hide 阈值时隐藏面板，否则在 [min, 容器高 * 0.8] 内限幅。
  function timelineDrag(height, containerH) {
    if (height < TIMELINE.hide) return { hide: true, height: TIMELINE.min };
    const max = Math.max(TIMELINE.min, Math.round((containerH || 0) * TIMELINE.maxRatio));
    return { hide: false, height: Math.round(clamp(height, TIMELINE.min, max)) };
  }

  // 右侧 pane 宽度（无自动隐藏；剩余给舞台的宽度不少于 rest）。
  function rpaneDrag(width, containerW) {
    return Math.round(clamp(width, RPANE.min, Math.max(RPANE.rest, (containerW || 0) - RPANE.rest)));
  }

  // ---------- 侧边栏 RECENT ----------

  // 中文相对时间。now 省略时取当前时刻（测试一律显式传入以保持确定性）。
  function relativeTime(ts, now) {
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const at = Number(now == null ? Date.now() : now);
    const diff = at - ts;
    if (diff < 0) return '刚刚';
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    const hour = Math.floor(min / 60);
    if (hour < 24) return hour + ' 小时前';
    // 天数按"自然日"算：昨天 23:50 在今天 00:10 看也应该是"昨天"。
    const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const days = Math.round((startOfDay(at) - startOfDay(ts)) / 86400000);
    if (days <= 0) return hour + ' 小时前';
    if (days === 1) return '昨天';
    if (days < 7) return days + ' 天前';
    if (days < 30) return Math.floor(days / 7) + ' 周前';
    if (days < 365) return Math.floor(days / 30) + ' 个月前';
    return Math.floor(days / 365) + ' 年前';
  }

  // 媒体类型 → 图标名（缺失/未知按视频处理，与原型 Thumb 的兜底分支一致）。
  function mediaIcon(kind) {
    if (kind === 'audio') return 'audio-wave';
    if (kind === 'image') return 'image';
    if (kind === 'project') return 'folder';
    return 'video';
  }

  // 从 location.pathname 解出当前项目 id：/projects/<id>/... 或 /<id>/...。
  // 单项目模式下 URL 根本没有 id 段（页面就服务在 /），返回 null 交给 root:true。
  const TAB_SEG = /^(transcript|subtitle|translation|translate|style)$/;
  function projectIdFromPath(pathname) {
    const segs = String(pathname || '').split('/').filter(Boolean).filter((s) => !TAB_SEG.test(s));
    if (!segs.length) return null;
    if (segs[0] === 'projects') return segs[1] || null;
    return segs[0];
  }

  // 当前项目：URL 里有 id 就按 id 命中，否则取 root:true 的那项（单项目模式）。
  function currentProject(projects, pathname) {
    const list = Array.isArray(projects) ? projects : [];
    const id = projectIdFromPath(pathname);
    if (id) {
      const hit = list.find((p) => p && p.id === id);
      if (hit) return hit;
    }
    return list.find((p) => p && p.root) || null;
  }

  // /__bcut/projects 不可用时的兜底：healthz.projects[] 只有 id/path。
  function fromHealthz(healthz) {
    const list = (healthz && Array.isArray(healthz.projects)) ? healthz.projects : [];
    return list.map((p) => ({
      id: p.id,
      path: p.path,
      title: p.title || p.id,
      mediaKind: null,
      duration: null,
      modifiedAt: null,
      root: !!p.root,
    }));
  }

  return {
    PANELS_KEY, SIDEBAR_W_KEY, RPANE_W_KEY, TIMELINE_H_KEY,
    DEFAULTS, SIDEBAR, RPANE, TIMELINE,
    normalize, setPanel, loadPanels, savePanels,
    loadNumber, saveNumber, loadSidebarWidth,
    sidebarDrag, timelineDrag, rpaneDrag,
    relativeTime, mediaIcon, projectIdFromPath, currentProject, fromHealthz,
  };
});
