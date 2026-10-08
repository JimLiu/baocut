/* 「服务」的纯模型 —— §17.6（2026-09-17）。
   服务 = 这台 Mac 上由 BaoCut 持有、等别人连进来的常驻进程：MCP 服务（外部 AI 应用连进来）、
   远端算力（局域网里的电脑把转录、配音、出图等活交过来）、Web 服务（浏览器打开 BaoCut Web）。
   它们和「工具」不是一类东西：工具是给一份输入、拿一份输出的一次性活，跑完就没了；
   服务有开 / 关、有地址、有谁连着，要的是「一眼看出开没开、一下能停」。
   这里只算：服务目录、统一的四态（off / starting / stopping / on，外加 error）、状态点与文案、
   能不能启动、侧栏那一行的三颗信号灯、总览页的汇总、旧路由落点、Web 服务的端口校验。 */
(function () {
  /* 顺序就是侧栏与规格里的顺序。`verb` = 这项服务的起 / 停动词（远端算力沿用 §17.3 的「共享」）。 */
  const SERVICES = [
    {id: 'mcp', name: 'MCP 服务', icon: 'mcp', scope: '仅本机',
      desc: '让其他 AI 应用读取视频、调用 BaoCut 工具',
      start: '启动服务', stop: '停止服务', starting: '正在启动…', stopping: '正在停止…'},
    {id: 'remote', name: '远端算力', icon: 'remote-compute', scope: '局域网',
      desc: '把这台 Mac 的算力共享给局域网里的其他电脑',
      start: '开始共享', stop: '停止共享', starting: '正在开始…', stopping: '正在停止…'},
    {id: 'web', name: 'Web 服务', icon: 'web', scope: '仅本机',
      desc: '在浏览器里打开 BaoCut Web，编辑同一批视频',
      start: '启动服务', stop: '停止服务', starting: '正在启动…', stopping: '正在停止…'},
  ];
  const IDS = SERVICES.map((s) => s.id);
  const byId = (id) => SERVICES.find((s) => s.id === id) || null;

  /** 一项服务的运行态 → 五选一。`st` = {on, phase, error}；phase 优先，其次 error，再看 on。 */
  function stateOf(st) {
    const s = st || {};
    if (s.phase === 'starting' || s.phase === 'stopping') return s.phase;
    if (s.error) return 'error';
    return s.on ? 'on' : 'off';
  }
  /** 状态点的色调：on 绿、error 橙、起停中与关着都是灰（起停中另有转圈，不靠颜色说话）。 */
  function dotTone(st) {
    const k = stateOf(st);
    return k === 'on' ? 'on' : k === 'error' ? 'error' : 'off';
  }
  /** 侧栏行 tooltip 与服务卡副标题前缀用的状态词 */
  function stateLabel(id, st) {
    const k = stateOf(st);
    const share = id === 'remote';
    if (k === 'starting') return share ? '正在开始共享…' : '正在启动…';
    if (k === 'stopping') return share ? '正在停止共享…' : '正在停止…';
    if (k === 'error') return share ? '共享意外停止' : '启动失败';
    if (k === 'on') return share ? '正在共享' : '运行中';
    return share ? '未共享' : '未启动';
  }

  /** 现在能不能启动；不能就给一句人话。目前三项服务都没有前置条件（MCP 默认开放所有项目），留着这个口子。 */
  function startBlock() { return null; }
  /** 侧栏悬停出来的快捷按钮：起停中不给；关着且不能直接起的（MCP 没选项目）给「去设置」。 */
  function quickAction(id, st, ctx) {
    const k = stateOf(st);
    if (k === 'starting' || k === 'stopping') return null;
    const svc = byId(id);
    if (k === 'on') return {kind: 'stop', icon: 'stop', tip: svc.stop};
    const block = startBlock(id, ctx);
    if (block) return {kind: 'open', icon: 'chevright', tip: block};
    return {kind: 'start', icon: 'play', tip: k === 'error' ? '重新' + svc.start : svc.start};
  }

  /** 侧栏「服务」那一行行尾的三颗信号灯：一项服务一颗，顺序同目录；各亮各的颜色
   *  （绿 = 在跑、橙 = 出错、灰 = 关着），起停中的那颗 `busy`（视图让它呼吸）。 */
  function lights(states) {
    return SERVICES.map((svc) => {
      const st = (states || {})[svc.id];
      const k = stateOf(st);
      return {id: svc.id, tone: dotTone(st), busy: k === 'starting' || k === 'stopping',
        label: `${svc.name} · ${stateLabel(svc.id, st)}`};
    });
  }
  /** 总览页标题下那一小句：有出错的先说出错，其次说几个在跑，全关着不说话。 */
  function summary(states) {
    const ks = IDS.map((id) => stateOf((states || {})[id]));
    const err = ks.filter((k) => k === 'error').length;
    const on = ks.filter((k) => k === 'on').length;
    if (err) return {text: `${err} 项出错`, tone: 'error'};
    if (on) return {text: `${on} 项运行中`, tone: 'on'};
    return null;
  }

  /** 路由落点：`{r:'services'}` 是总览（返回 'index'），`{r:'services', id}` 是某一项；id 不认识回总览。
   *  旧链接 `{r:'remote'}` 与 `{r:'tools', id:'remote'}`（2026-09-15 那两天的形状）都落到远端算力。 */
  function resolve(route) {
    const r = route || {};
    if (r.r === 'remote') return 'remote';
    if (r.r === 'tools' && r.id === 'remote') return 'remote';
    if (r.r === 'services') return IDS.indexOf(r.id) >= 0 ? r.id : 'index';
    return null;
  }

  /* ---------- Web 服务 ---------- */
  const WEB_DEFAULT_PORT = 24320;   // 与 `bcut serve --port` 默认值同（apps/baocut prefs::DEFAULT_SERVE_PORT）
  const RESERVED = {24350: '远端算力'};
  /** 端口输入 → {port} 或 {error}。只收 1024–65535 的整数；和本机其他 BaoCut 服务撞口的直接说是谁。 */
  function parsePort(text) {
    const t = String(text == null ? '' : text).trim();
    if (!/^\d{1,5}$/.test(t)) return {error: '端口要填 1024–65535 之间的数字'};
    const n = Number(t);
    if (n < 1024 || n > 65535) return {error: '端口要填 1024–65535 之间的数字'};
    if (RESERVED[n]) return {error: `${n} 已经留给${RESERVED[n]}，换一个端口`};
    return {port: n};
  }
  const webUrl = (port) => `http://127.0.0.1:${port || WEB_DEFAULT_PORT}/app/`;

  /* OpenAI 兼容 API 的地址、端点表与示例 2026-09-27 起在 model-openai-api.js（BC_OPENAI_API）。 */

  /* ---------- MCP 服务 ---------- */
  /* 2026-09-27 加第三档「直接放行」：自己用时每次确认太麻烦。第一次用的起点仍是「修改前询问」。 */
  const MCP_ACCESS = [
    {k: 'read', title: '只读', desc: '查看视频信息、文稿与处理状态'},
    {k: 'ask', title: '修改前询问', desc: '转录、翻译、剪辑、导出与生成前，在 BaoCut 中确认'},
    {k: 'auto', title: '直接放行', desc: '写入、任务与生成直接执行，不用确认；适合只有你自己用时'},
  ];
  /** MCP 固定端口：先试这个，被占用才退回随机端口（24320 Web、24350 远端算力）。 */
  const MCP_PORT = 24351;
  const mcpUrl = (port) => `http://127.0.0.1:${port || MCP_PORT}/mcp`;
  /** 「复制连接信息」给的客户端配置；要令牌时多一个 Authorization 头。 */
  function mcpClientConfig(url, token) {
    const server = {type: 'http', url};
    if (token) server.headers = {Authorization: 'Bearer ' + token};
    return JSON.stringify({mcpServers: {baocut: server}}, null, 2);
  }
  /** 开放范围的一句话。`ids` 为空 = 所有项目；`titleOf(id)` 取标题。 */
  function mcpScope(ids, total, titleOf) {
    const n = (ids || []).length;
    if (!n) return '所有视频（' + total + '）';
    if (n === 1) return '「' + titleOf(ids[0]) + '」';
    return '其中 ' + n + ' 部视频';
  }
  /** 选中 / 取消一个项目；全选上等于「所有项目」，收回空表。 */
  function mcpToggleProject(ids, id, total) {
    const next = ids.indexOf(id) >= 0 ? ids.filter((x) => x !== id) : ids.concat(id);
    return next.length >= total ? [] : next;
  }
  /** 服务卡副标题：关着时说起了会开放什么；开着时说开放了哪些项目、什么权限。`scope` 来自 mcpScope。 */
  function mcpSub(st, scope, access, requireToken) {
    const k = stateOf(st);
    const acc = (MCP_ACCESS.find((a) => a.k === access) || MCP_ACCESS[0]).title + (requireToken ? ' · 需要令牌' : '');
    if (k === 'on') return `${scope} · ${acc}`;
    if (k === 'starting' || k === 'stopping') return scope;
    return `启动后开放${scope} · ${acc}`;
  }

  /* ---------- 远端算力：节点接的任务（2026-09-27，docs/design/speech/bcut-remote-compute-jobs-design.md） ----------
     共享侧一类任务一行：有模型的任务列这台节点上能用的模型，一个都没有就不许开；
     下载 / 导出不靠模型，副行说用的是这台 Mac 的什么。顺序即规格里的任务目录顺序。 */
  const REMOTE_TASKS = [
    {k: 'asr', name: '转录', noun: '转录模型'},
    {k: 'tts', name: '配音', noun: '配音模型'},
    {k: 'image', name: '生成图片', noun: '图像模型'},
    {k: 'separate', name: '分离人声', noun: '分离模型'},
    {k: 'download', name: '下载视频', uses: '用这台 Mac 的网络和 yt-dlp'},
    {k: 'export', name: '导出视频', uses: '用这台 Mac 的编码器'},
  ];
  /** 共享卡「提供给其他电脑的任务」的行。`models` = {task: [id…]}（节点报的就绪模型），
   *  `off` = 节点主人关掉的任务 id 表。没模型的任务 `disabled`，此时开关显示为关。 */
  function remoteTaskRows(models, off) {
    const m = models || {};
    const closed = off || [];
    return REMOTE_TASKS.map((t) => {
      const list = t.uses ? null : (m[t.k] || []);
      const disabled = !!list && !list.length;
      return {
        k: t.k, name: t.name, models: list || [], disabled,
        on: !disabled && closed.indexOf(t.k) < 0,
        desc: t.uses || (disabled ? `这台 Mac 还没装${t.noun}` : null),
      };
    });
  }
  /** 共享卡段标题右侧的汇总：「提供 5 / 6 类任务」。 */
  function remoteTaskSummary(rows) {
    return `提供 ${rows.filter((r) => r.on).length} / ${rows.length} 类任务`;
  }
  /** 使用侧节点卡 meta 里的任务那一截：按任务目录顺序「转录 3 · 配音 2 · 出图 1 · 分离 · 导出」。
   *  节点没报 `tasks`（旧节点 / 旧缓存）返回 null，调用方退回旧的「N 个模型」写法——
   *  缺字段不等于什么都不接（与 §17.6 `ttsModels` 缺席的约定同理）。 */
  function nodeTaskMeta(node) {
    if (!node || !Array.isArray(node.tasks)) return null;
    const short = {asr: '转录', tts: '配音', image: '出图', separate: '分离', download: '下载', export: '导出'};
    const counts = node.taskModels || {};
    return REMOTE_TASKS.filter((t) => node.tasks.indexOf(t.k) >= 0)
      .map((t) => (Array.isArray(counts[t.k]) && counts[t.k].length ? `${short[t.k]} ${counts[t.k].length}` : short[t.k]))
      .join(' · ');
  }

  /** 「在哪儿跑」的候选机器（本机不在内）：在线、开放了这类任务、且报得出这只模型的已配对节点。
   *  没报 `tasks` / `taskModels` 的旧节点不算——宁可不给选，也不要开跑才失败（与配音 `dubNodes` 同理）。 */
  function nodesFor(nodes, task, model) {
    return (nodes || []).filter((n) => n.state !== 'offline'
      && Array.isArray(n.tasks) && n.tasks.indexOf(task) >= 0
      && n.taskModels && Array.isArray(n.taskModels[task]) && n.taskModels[task].indexOf(model) >= 0);
  }
  /** 选中的机器此刻还跑得了吗；跑不了（掉线 / 关了这类任务 / 换了模型）返回 null，调用方回落本机。 */
  function nodeOn(nodes, alias, task, model) {
    return alias ? nodesFor(nodes, task, model).find((n) => n.id === alias) || null : null;
  }
  /** 不靠模型的任务（下载 / 导出）的候选机器：在线 + 开放这类任务。没报 `tasks` 的旧节点不算。 */
  function nodesOffering(nodes, task) {
    return (nodes || []).filter((n) => n.state !== 'offline' && Array.isArray(n.tasks) && n.tasks.indexOf(task) >= 0);
  }
  function nodeOffering(nodes, alias, task) {
    return alias ? nodesOffering(nodes, task).find((n) => n.id === alias) || null : null;
  }

  window.BC_SERVICES = {
    SERVICES, IDS, byId, stateOf, dotTone, stateLabel, startBlock, quickAction, lights, summary, resolve,
    WEB_DEFAULT_PORT, parsePort, webUrl, MCP_ACCESS, MCP_PORT, mcpUrl, mcpClientConfig, mcpScope, mcpToggleProject, mcpSub,
    REMOTE_TASKS, remoteTaskRows, remoteTaskSummary, nodeTaskMeta, nodesFor, nodeOn, nodesOffering, nodeOffering,
  };
})();
