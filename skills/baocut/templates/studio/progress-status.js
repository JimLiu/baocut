// BaoCut Subtitle Studio — 任务状态投影（纯函数）。
//
// 任务真相来自 serve 的通知中枢：`GET /__bcut/ws` 每次变化推一帧全量
// `{type:"jobs", rev, jobs:[…]}`。存活判定（pid 是否在、心跳是否过期、终态
// 保留窗口）全部由中枢负责，页面不再自己算 —— 这里只做三件事：
//   1. 认出本页对应的项目路径（healthz + URL 前缀）；
//   2. 从全量任务表里挑出该项目当前该上状态条的那一个；
//   3. 把它投影成 LiveHeader / TranscribingPane 已有的 status 形状。
//
// `studio/progress.json`（经 `__bcut/studio/poll` 的 progress 分量下发）仍是
// 三项 WS 没有的细节的来源：`phases[]`（阶段指示行）、`contentFingerprint`
// （正文投影是否落后于阶段状态）以及 `pct` 的"不确定"语义 —— jobs 条目的
// `pct` 是非空数字，表达不了 progress.json 的 `pct: null`。它的 `active` /
// `updatedAt` 一律不参与，否则 CLI 崩掉后的陈旧快照会永远显示"处理中"。
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_PROGRESS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // serve 进程内的导出/渲染任务有自己的 UI（导出面板与其 status 端点），
  // 不进字幕状态条 —— 它们从来不写 progress.json，收进来就是新行为。
  const EXCLUDED_KINDS = ['export', 'render'];
  // 排队中的任务尚未开跑（pid 哨兵 0），但它确实是本项目待办的活，按"进行中"
  // 呈现；终态（done/error/cancelled）在中枢里还会保留 30s，不进状态条。
  const ACTIVE_JOB_STATUS = ['running', 'queued'];
  // URL 末段的 tab 名不是项目 id（见 store.jsx 的 TAB_PATH_RE）。
  const TAB_SEGMENTS = ['subtitle', 'transcript', 'translation', 'translate', 'style'];

  // 路径比较：jobs.json 记的是 CLI 拿到的原样路径（未 canonicalize），
  // healthz/mount 给的是规范化过的；macOS 上 /tmp/x 与 /private/tmp/x 是同一处。
  // 只做尾斜杠与 /private 前缀两项归一，不做 basename 之类的宽松兜底 ——
  // 认错项目比认不出更糟。
  function normalizePath(value) {
    if (typeof value !== 'string') return null;
    let path = value.trim();
    if (!path) return null;
    path = path.replace(/\/+$/, '');
    if (path === '/private') return '/';
    if (path.startsWith('/private/')) path = path.slice('/private'.length);
    return path || '/';
  }

  function samePath(a, b) {
    const x = normalizePath(a);
    const y = normalizePath(b);
    return Boolean(x && y && x === y);
  }

  function decodeSegment(segment) {
    try { return decodeURIComponent(segment); } catch (e) { return segment; }
  }

  // 页面 URL 里的项目 id：`/projects/<id>/…` 命名空间优先，其次是挂载点/根子目录
  // 的首段；单项目模式（rootIsProject）路径上没有 id，返回 null。
  function projectIdFromPath(pathname) {
    let segments = String(pathname || '').split('/').filter(Boolean);
    if (segments.length && TAB_SEGMENTS.includes(segments[segments.length - 1])) {
      segments = segments.slice(0, -1);
    }
    if (!segments.length) return null;
    if (segments[0] === 'projects') {
      return segments.length > 1 ? decodeSegment(segments[1]) : null;
    }
    return decodeSegment(segments[0]);
  }

  // 本页项目的绝对路径。认不出（例如 healthz 的项目表按规范路径去重后，
  // 注册表 id 被同路径的挂载 id 顶掉）时返回 null —— 宁可不显示任务状态，
  // 也不要把别的项目的任务挂到本页上。
  function resolveProjectPath(health, pathname) {
    if (!health || typeof health !== 'object') return null;
    const projects = Array.isArray(health.projects) ? health.projects : [];
    const id = projectIdFromPath(pathname);
    if (id) {
      const hit = projects.find((entry) => entry && entry.id === id);
      return hit ? normalizePath(hit.path) : null;
    }
    return health.rootIsProject ? normalizePath(health.root) : null;
  }

  // 从一帧全量任务表里挑本项目当前的任务：非终态、非导出/渲染、心跳最新的那个。
  function selectJob(jobs, projectPath) {
    if (!projectPath || !Array.isArray(jobs)) return null;
    let best = null;
    for (const job of jobs) {
      if (!job || typeof job !== 'object') continue;
      if (!ACTIVE_JOB_STATUS.includes(job.status)) continue;
      if (EXCLUDED_KINDS.includes(job.kind) || EXCLUDED_KINDS.includes(job.stage)) continue;
      if (!samePath(job.project, projectPath)) continue;
      if (!best || Number(job.updatedAt || 0) >= Number(best.updatedAt || 0)) best = job;
    }
    return best;
  }

  function copyCount(target, source, key) {
    if (source && source[key] != null) target[key] = source[key];
  }

  // status 投影：base = data.json 的 status（CLI 派生的 ready/empty/transcribing
  // 基线），job = WS 选中的任务，progress = studio/poll 带来的 progress.json。
  function projectStatus(base, job, progress, dataFingerprint) {
    const status = { ...(base || {}) };
    const phases = (progress && progress.phases) || status.phases || [];
    const fingerprint = (progress && progress.contentFingerprint) || status.contentFingerprint;
    if (!job) {
      // 任务中枢明确说本项目没有在跑的任务时，旧 progress/data 快照都不能
      // 制造运行态。尤其不要让一次迟到写入留下的旧指纹永久显示 syncing。
      return {
        ...status,
        active: false,
        phases,
        contentFingerprint: dataFingerprint || status.contentFingerprint || fingerprint,
      };
    }
    // progress 缺指纹（旧版/残缺写入）时不判失同步——只有两侧都带指纹且确实
    // 不同且确有活动任务时，才是"正文投影落后于阶段状态"。
    const outOfSync = Boolean(
      dataFingerprint
      && progress && progress.contentFingerprint
      && dataFingerprint !== progress.contentFingerprint
    );
    if (outOfSync) {
      return {
        ...status,
        active: true,
        phase: 'syncing',
        pct: null,
        detail: '正在同步字幕内容',
        phases: phases.map((phase) => ({ ...phase, state: 'pending' })),
        contentFingerprint: progress.contentFingerprint,
      };
    }
    // jobs 条目的 pct 恒为数字（progress.json 的 null 到这里是 0），同阶段的
    // progress.json 说"没有确定进度"时按不确定进度条呈现。
    let pct = Number.isFinite(job.pct) ? job.pct : null;
    if (progress && progress.phase === job.phase && progress.pct == null) pct = null;
    const next = {
      ...status,
      active: true,
      phase: job.phase || status.phase,
      pct,
      detail: job.detail || '',
      phases,
      contentFingerprint: fingerprint,
      updatedAt: job.updatedAt,
    };
    copyCount(next, job, 'linesDone');
    copyCount(next, job, 'linesTotal');
    copyCount(next, job, 'callsDone');
    copyCount(next, job, 'callsTotal');
    return next;
  }

  function isActive(status) {
    return Boolean(status && status.active);
  }

  return {
    EXCLUDED_KINDS,
    ACTIVE_JOB_STATUS,
    normalizePath,
    samePath,
    projectIdFromPath,
    resolveProjectPath,
    selectJob,
    projectStatus,
    isActive,
  };
});
