/* BaoCut 原型 — 表面（surface）
   window.BC_SURFACE。纯函数，无 React、无 DOM。

   同一套组件服务两份原型（§22.5）：
     · `app` —— BaoCut.html，对应桌面客户端 apps/baocut：全功能。
     · `web` —— BaoCutWeb.html，对应 apps/web：在 Agent 里预览视频效果、做简单编辑的网页。
       没有任何 AI 功能入口（AI 操作从 Agent 或 App 发起），外壳只有「视频列表 ＋ 编辑器 ＋ 导出」。
     · `review` —— BaoCutWeb.html?review=<项目 id>，对应 apps/web 的审片页 `/review/<videoId>`（架构设计 §12.8、
       产品设计 §5.12）：外部 Agent 给的固定链接，整页只有这一部视频的编辑器——没有视频列表、导出、任务与品牌库，
       默认落在轻量视图，能切时间线、改动照常写进视频。

   入口 HTML 在加载本文件**之前**写 `window.BC_SURFACE_ID = 'web'`；不写就是 `app`。
   共享组件只读这里的能力位（`BC_SURFACE.ai` 等），不自己判断 id——
   「Web 少了什么」因此只有这一张表，两份原型不会各漂各的。 */
(function () {
  const CAPS = {
    app: {
      id: 'app', name: 'BaoCut',
      ai: true,          // AI 入口：工具页（product-design §5.10）、面板里的重跑 / 翻译 / 配音 / 智能裁剪 / 生成语音
      agent: true,       // Agent 抽屉、会话、交给 Agent
      pages: true,       // 新建项目 / 我的项目 / 后台任务 / 工具 / 服务 / 设置
      help: true,        // 帮助中心（F1）
      windowChrome: true, // 标题栏画 macOS 红绿灯与前进后退
      importMedia: true, // 往项目里加本机文件 / 在线素材 / 录制
      flashFix: true,    // 光速修正：再导一次只重渲改过的区间（Web 的导出只有整片重导）
      remote: true,      // 远端算力：共享侧在服务页，使用侧是各处的「在哪儿跑 / 用哪台电脑」（Web 没有服务页，也不配对节点）
      sidebarDefaultOpen: true,
      /* App rail（2026-10-01）：窗口最左一列 Home / Space ＋ 底部 end section 工具 / 服务 / 任务中心 / 设置（2026-10-02），
         所有 App 路由都在（含编辑器）。
         有它时页面侧栏按 Tab 换（Home 是会话树、Space 是分类），编辑器里不放页面侧栏、只留会话抽屉。
         这些区域用 react-spectrum S2（window.RSP，只在 App 入口加载）；共享组件只读这一位，不碰 RSP。 */
      appRail: true,
      /* 按需下载的字体（product-design §5.9）：选字框是「内置 / 本机 / 已下载 / 可下载」一张表，打开视频时自动下载
         用到的字体（编辑器顶上一条字体条），导出面板说明字体的下载状态。Web 对应的浏览器会话没有 `fonts.*`，保持原来的三段选字框。 */
      fontDownloads: true,
      /* 在文件夹中显示：交给系统的文件管理器（访达 / 资源管理器）打开所在文件夹。浏览器做不到，Web 不画这颗按钮。 */
      reveal: true,
      /* 成片没选位置时导到原视频所在的文件夹（product-design §8.3），别的种类放项目的 exports/。浏览器拿不到本机路径，Web 都导到 exports/。 */
      exportNextToSource: true,
      /* 本机的管理动作（版本记录设计 §6）：项目设置里开关自动提交、「初始化 git」、允许仓库的本地过滤器。
         Web 能看 git 状态、能「提交到 git」，这三项停用并写明去桌面应用：改 Runtime 设置、在本机文件夹里建仓库、
         允许执行仓库配置里的程序，都只在桌面界面与 CLI。 */
      localAdmin: true,
      /* 视频列表（Web 的侧栏，web-shell.jsx）与换视频：App 用 rail 与 Space，不读这一位；审片页只有一部视频。 */
      videoList: false,
      /* 导出与视频栏上的任务胶囊：审片会话碰不到作业与任务（架构设计 §12.8），两样都不画。 */
      exportVideo: true,
      tasks: true,
    },
    web: {
      id: 'web', name: 'BaoCut Web',
      ai: false, agent: false, pages: false, help: false, windowChrome: false,
      importMedia: true, flashFix: false, remote: false,
      sidebarDefaultOpen: false, appRail: false, fontDownloads: false, reveal: false, exportNextToSource: false, localAdmin: false,
      videoList: true, exportVideo: true, tasks: true,
    },
    review: {
      id: 'review', name: 'BaoCut 审片',
      ai: false, agent: false, pages: false, help: false, windowChrome: false,
      importMedia: true, flashFix: false, remote: false,
      sidebarDefaultOpen: false, appRail: false, fontDownloads: false, reveal: false, exportNextToSource: false, localAdmin: false,
      videoList: false, exportVideo: false, tasks: false,
    },
  };

  /* Web 不落的 Tab。`aitools` 是 rail 第三格（product-design §5.10），Web 没有 AI 入口，不列它，落到它时退回文稿。
     审片页另外不列品牌：品牌库是跨视频的用户数据，审片会话碰不到。 */
  const WEB_RAIL_DROP = ['aitools'];
  const REVIEW_RAIL_DROP = ['aitools', 'brand'];

  const resolveId = (raw) => (raw === 'web' || raw === 'review' ? raw : 'app');

  function make(raw) {
    const caps = CAPS[resolveId(raw)];
    const isWeb = caps.id !== 'app';
    const drop = caps.id === 'review' ? REVIEW_RAIL_DROP : WEB_RAIL_DROP;

    /** rail 表按表面过滤（顺序不动） */
    const rail = (items) => (isWeb ? items.filter((r) => drop.indexOf(r.k) < 0) : items);

    /** 落点 Tab：项目原本要落在这个表面没有的 Tab（智能裁剪会话开着 → aitools）时退回文稿 */
    const landingTab = (tab) => (isWeb && drop.indexOf(tab) >= 0 ? 'transcript' : tab);

    /** localStorage 键按表面分开：两份原型同源，路由栈与布局偏好不许互相串 */
    const storageKey = (key) => (isWeb ? key.replace(/^bc-/, 'bc-web-') : key);

    /** Web 的路由只有两种：某部视频的编辑器，或「还没选视频」。其余一律归到后者。 */
    const normalizeRoute = (route, hasProject) => {
      if (!isWeb) return route;
      if (route && route.r === 'editor' && hasProject(route.id)) return {r: 'editor', id: route.id, t: route.t};
      return {r: 'none'};
    };

    /** 没有 AI 入口的表面上，面板里原本放按钮的地方改说这句话（去处，不是歉意） */
    const aiElsewhere = (what) => `${what}从 Agent 或 BaoCut App 发起，结果会同步到这里`;

    return Object.assign({}, caps, {isWeb, rail, landingTab, storageKey, normalizeRoute, aiElsewhere});
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.BC_SURFACE = Object.assign(make(root.BC_SURFACE_ID), {make, CAPS, WEB_RAIL_DROP, REVIEW_RAIL_DROP});
})();
