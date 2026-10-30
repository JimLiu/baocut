/* BaoCut 原型 — Agent 会话线程里「算出来的东西」：工具步骤行、正文里的文件路径、行间距、回合页脚
   window.BC_AGENT_TURN。无 React、无 DOM，node --test 直接 require。只在 App 入口加载。

   - 工具步骤行：固定的类别名 + 次级摘要（命令本身 / 相对路径 / 查询词），状态一旦失败不再被改回；
     BaoCut 自己的工具另有类别（model-agent-tools.js）；带结构化事实（`info`，架构设计 §3.1）的按它定类别、摘要与标签
   - `parsePathToken`：正文行内代码像不像项目里的文件路径，带不带行号
   - `parseVideoTime`：正文里的视频时间链接（`/videos/<videoId>?t=<秒>`）
   - `gapBetween`：相邻两行按种类定间距
   - 回合：从一句用户消息到下一句之前；页脚的计时、结束时刻与「复制这一轮」的正文 */
(function () {
  /* ---------- 工具步骤 ---------- */
  const TOOL_LABELS = {command: '运行命令', read: '读取文件', edit: '修改文件', search: '搜索', fetch: '读取网页', agent: '子智能体', other: '其他工具'};
  const FILE_EXT = ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'css', 'rs', 'py', 'toml', 'yaml', 'yml',
    'srt', 'vtt', 'ass', 'mp4', 'mov', 'wav', 'mp3', 'png', 'jpg'];
  const CLI = /^(bcut|ffmpeg|ffprobe|npm|npx|node|git|ls|cat|rg|grep|find|python3?|sh|bash)(\s|$)/;
  const looksLikeFile = (s) => /\/$/.test(s) || new RegExp(`\\.(${FILE_EXT.join('|')})$`, 'i').test(s);

  /** 一条工具消息的类别与摘要。演示数据带 `kind` / `summary`；只有 `cmd` 的老数据按写法推。 */
  function toolStep(m) {
    /* BaoCut 自己的工具（架构设计 §3.5）：类别名与摘要按工具与参数定（model-agent-tools.js），带图标 */
    const own = m && m.tool && window.BC_AGENT_TOOLS ? window.BC_AGENT_TOOLS.describe(m.tool, m.args) : null;
    if (own) return own;
    const fact = infoStep(m && m.info);
    if (fact) return fact;
    const cmd = String((m && m.cmd) || '').trim();
    const kind = m && TOOL_LABELS[m.kind] ? m.kind : null;
    if (kind) return {kind, label: TOOL_LABELS[kind], summary: (m.summary || cmd).trim()};
    if (/^读取\s/.test(cmd)) {
      const rest = cmd.replace(/^读取\s+/, '');
      return {kind: 'read', label: TOOL_LABELS.read, summary: rest.split(' · ')[0].trim()};
    }
    if (CLI.test(cmd)) return {kind: 'command', label: TOOL_LABELS.command, summary: cmd};
    const first = cmd.split(' · ')[0].trim();
    if (first && !/\s/.test(first) && looksLikeFile(first)) return {kind: 'read', label: TOOL_LABELS.read, summary: first};
    return {kind: 'other', label: TOOL_LABELS.other, summary: cmd};
  }

  /** 结构化事实 → 类别与摘要：读的文件、搜的模式（与位置）、取的网址、交给子智能体的事。 */
  function infoStep(info) {
    if (!info) return null;
    const make = (kind, summary) => ({kind, label: TOOL_LABELS[kind], summary: String(summary || '').trim()});
    if (info.type === 'read') return make('read', info.path);
    if (info.type === 'search') return make('search', info.path ? `${info.pattern} · ${info.path}` : info.pattern);
    if (info.type === 'fetch') return make('fetch', info.url);
    if (info.type === 'subAgent') return make('agent', info.description);
    return null;
  }
  /** 结构化事实给的标签：读了哪几行、搜到几处、取网页失败的状态码、子智能体的类型。整读与成功不写。 */
  function infoMeta(info) {
    if (!info) return null;
    if (info.type === 'read' && (info.offset || info.limit)) {
      const from = info.offset || 1;
      return info.limit ? `第 ${from}–${from + info.limit - 1} 行` : `从第 ${from} 行`;
    }
    if (info.type === 'search') return info.matches != null ? `${info.matches} 处匹配` : info.files != null ? `${info.files} 个文件` : null;
    if (info.type === 'fetch' && info.status >= 400) return `HTTP ${info.status}`;
    if (info.type === 'subAgent' && info.agentType) return info.agentType;
    return null;
  }

  /** 演示数据里失败写成过 `fail` 与 `failed` 两种：统一成 run / done / failed。 */
  function toolStatus(status) {
    if (status === 'run') return 'run';
    if (status === 'fail' || status === 'failed') return 'failed';
    return 'done';
  }
  /** 状态更新：一旦失败就不再被后续的更新改回。 */
  function nextToolStatus(prev, next) {
    return toolStatus(prev) === 'failed' ? prev : next;
  }

  /** 折叠行右侧的元数据：结构化事实的标签、非零退出码、耗时。 */
  function stepMeta(m) {
    const out = [];
    const fact = infoMeta(m && m.info);
    if (fact) out.push(fact);
    // 子智能体走了几步（挂在这一行下的 substeps，架构设计 §3.1 的 parentId）
    const subs = m && Array.isArray(m.substeps) ? m.substeps.length : 0;
    if (subs > 0) out.push(`${subs} 步`);
    const code = m && m.exitCode;
    if (code != null && Number(code) !== 0) out.push(`退出码 ${code}`);
    if (m && m.took != null && m.took !== '') out.push(typeof m.took === 'number' ? `${m.took}s` : String(m.took));
    return out;
  }

  /** unified diff 的每一行归类：add / del / hunk / meta / ctx。 */
  function diffLines(text) {
    return String(text || '').replace(/\n$/, '').split('\n').map((line) => {
      let type = 'ctx';
      if (/^(\+\+\+|---)(\s|$)/.test(line) || /^(diff |index )/.test(line)) type = 'meta';
      else if (line.startsWith('@@')) type = 'hunk';
      else if (line.startsWith('+')) type = 'add';
      else if (line.startsWith('-')) type = 'del';
      return {type, text: line};
    });
  }
  /** 输出是不是一段 unified diff（有 @@ 块头，或 ---/+++ 文件头）。 */
  function looksLikeDiff(text) {
    const s = String(text || '');
    return /^@@ .* @@/m.test(s) || (/^--- \S/m.test(s) && /^\+\+\+ \S/m.test(s));
  }

  /* ---------- 正文里的文件路径 ---------- */
  const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;
  /** 行内代码像不像文件路径。是就返回 {path, line, lineEnd, col}，不是返回 null。 */
  function parsePathToken(text) {
    const raw = String(text || '').trim();
    if (!raw || /\s/.test(raw) || raw.indexOf('?') >= 0 || raw.indexOf('://') >= 0) return null;
    const m = /^(.*?)(?::(\d+)(?:-(\d+)|:(\d+))?)?$/.exec(raw);
    const path = m[1];
    if (!path) return null;
    const prefixed = /^(\.\.?\/|~\/|\/)/.test(path) && !/^\/\//.test(path) && path.length > 1;
    if (!prefixed) {
      const segs = path.split('/');
      if (segs.length < 2 || segs.some((s, i) => !s && i < segs.length - 1)) return null;
      const last = segs[segs.length - 1];
      const ext = /\.([a-z0-9]+)$/i.exec(last);
      if (!ext || FILE_EXT.indexOf(ext[1].toLowerCase()) < 0) return null;
      if (DOMAIN.test(segs[0])) return null;
    }
    const num = (v) => (v == null ? null : Number(v));
    return {path, line: num(m[2]), lineEnd: num(m[3]), col: num(m[4])};
  }
  /** tooltip 的文字：相对路径与行范围。 */
  function pathTip(p) {
    if (!p) return '';
    if (p.line == null) return p.path;
    if (p.lineEnd != null) return `${p.path} · 第 ${p.line}–${p.lineEnd} 行`;
    if (p.col != null) return `${p.path} · 第 ${p.line} 行第 ${p.col} 列`;
    return `${p.path} · 第 ${p.line} 行`;
  }

  /* ---------- 视频时间链接 ---------- */
  /** 回复里的「视频某一刻」（product-design §3.2.2）：`/videos/<videoId>?t=<秒>`，秒是时间线上的。
      是就返回 {videoId, seconds}；认不出（没有 t、秒不是非负数、多一段路径）返回 null，按普通链接处理。 */
  function parseVideoTime(href) {
    const m = /^\/videos\/([^/?#]+)\?(?:[^#]*&)?t=([^&#]*)(?:[&#].*)?$/.exec(String(href || '').trim());
    if (!m || m[2] === '') return null;
    const seconds = Number(m[2]);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    let videoId;
    try { videoId = decodeURIComponent(m[1]); } catch { return null; }
    return videoId ? {videoId, seconds} : null;
  }

  /* ---------- 间距 ---------- */
  /* 行与行之间按相邻种类定间距。`block` 是同一条回复里的 Markdown 块，`footer` 是回合页脚。 */
  const GAPS = {
    'user>user': 4, 'user>assistant': 0, 'tool>tool': 0, 'user>tool': 16,
    'assistant>tool': 4, 'tool>assistant': 4, 'block>block': 12,
  };
  function gapBetween(prev, next, prevHasCards = false) {
    if (!prev) return 0;
    if (next === 'footer') return 4; // 页脚贴着这一轮的最后一行
    // product-design §3.2.2：结构化卡片与下一条消息分开，不沿用正文／工具行的紧凑间距。
    if (prevHasCards) return 24;
    const g = GAPS[`${prev}>${next}`];
    return g == null ? 16 : g;
  }
  /** 线程里一行的种类（`conversationRows` 的产物）：工具组算 tool。 */
  function rowKind(row) {
    if (!row) return null;
    if (row.role === 'work' || row.role === 'tool') return 'tool';
    if (row.role === 'user' || row.role === 'assistant') return row.role;
    return row.role || 'other';
  }

  /* ---------- 回合 ---------- */
  /** 把线程行切成回合：每个回合 {start, end, user, text, replied}。`text` 是这一轮 assistant 正文（Markdown 源码，空行连接）。 */
  function turns(rows) {
    const out = [];
    let cur = null;
    (rows || []).forEach((row, i) => {
      if (row.role === 'user' || !cur) {
        cur = {start: i, end: i, user: row.role === 'user' ? row : null, texts: [], replied: false};
        out.push(cur);
      }
      cur.end = i;
      if (row.role !== 'user') cur.replied = true;
      if (row.role === 'assistant' && String(row.text || '').trim()) cur.texts.push(String(row.text).trim());
    });
    return out.map((t) => ({start: t.start, end: t.end, user: t.user, replied: t.replied, text: t.texts.join('\n\n')}));
  }

  /** 打开会话时先载入的回合数（架构设计 §11.3 `CONVERSATION_TAIL_TURNS`），「加载更早的消息」每次再往前接这么多。 */
  const TAIL_TURNS = 30;
  /** 只显示最后 `shown` 个回合时，第一行在 rows 里的下标；回合不够这么多时是 0。回合从用户消息算起。 */
  function windowStart(rows, shown) {
    const starts = [];
    (rows || []).forEach((row, i) => { if (row.role === 'user') starts.push(i); });
    return starts.length > shown ? starts[starts.length - shown] : 0;
  }

  /**
   * 在会话中查找（产品设计 §3.2.2）：只查用户消息与回复的正文，不分大小写的纯文本，步骤与工具输出不查。
   * 按先后给出有命中的行 {id, row, count}；`row` 是它在 rows 里的下标（还没显示的旧回合据此往前接）。
   */
  function findHits(rows, query) {
    const q = String(query || '').toLowerCase();
    if (!q) return [];
    const out = [];
    (rows || []).forEach((row, i) => {
      if (row.role !== 'user' && row.role !== 'assistant') return;
      const text = String(row.text || '').toLowerCase();
      let count = 0;
      for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) count++;
      if (count) out.push({id: row.id, row: i, count});
    });
    return out;
  }
  /** 第 `index` 处命中（从 0 数，跨行连着数）落在哪一行、是那一行里的第几处；越界时 null。 */
  function locateHit(hits, index) {
    let rest = index;
    for (const hit of hits || []) {
      if (rest < hit.count) return rest >= 0 ? {hit, nth: rest} : null;
      rest -= hit.count;
    }
    return null;
  }
  /** 要显示多少个回合，第 `row` 行才在窗口里（每次多接 TAIL_TURNS）。 */
  function shownFor(rows, row, shown) {
    let n = shown;
    while (windowStart(rows, n) > row) n += TAIL_TURNS;
    return n;
  }

  /** 时长：0:42、1:03、1:02:05。 */
  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }
  /** 结束时刻：本地 24 小时制 14:32。 */
  function clockLabel(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  /** 页脚文案：进行中「正在工作 · 0:42」（停下来等放行时「等你允许 · 0:42」，等你回答提问时「等你回答」），完成「已工作 1:03」；
      没有开始时间就不显示时长。`waiting` 是 waitingFor 的结果（'allow' / 'answer'），老调用传 true 按放行算。 */
  function footerLabel(o) {
    const {startedAt, endedAt, live, waiting, now} = o || {};
    if (live) {
      const word = waiting ? WAIT_WORDS[waiting === 'answer' ? 'answer' : 'allow'].long : '正在工作';
      return startedAt ? `${word} · ${formatElapsed((now || Date.now()) - startedAt)}` : word;
    }
    if (startedAt && endedAt) return `已工作 ${formatElapsed(endedAt - startedAt)}`;
    return '';
  }

  /**
   * 会话停下来等你时等的是什么（产品设计 §6.6）：最后一张没答的卡是提问就是 'answer'，是方案就是 'plan'，否则 'allow'；
   * 不在等是 null。方案和允许一样进待处理列表，状态词同「等你允许」，只是输入框里发的话算回复。
   */
  const WAIT_WORDS = {answer: {long: '等你回答', short: '待回答'}, allow: {long: '等你允许', short: '待允许'}};
  WAIT_WORDS.plan = WAIT_WORDS.allow;
  const WAIT_ROLES = {question: 'answer', plan: 'plan', permission: 'allow'};
  function waitingFor(sess) {
    if (!sess || sess.status !== 'waiting') return null;
    const ms = sess.messages || [];
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      if (WAIT_ROLES[m.role] && m.state === 'pending') return WAIT_ROLES[m.role];
    }
    return 'allow';
  }
  /** 状态词：长的「等你回答 / 等你允许」（会话行），短的「待回答 / 待允许」（标题旁的小标签）。 */
  function waitingLabel(sess, short) {
    const k = waitingFor(sess);
    return k ? WAIT_WORDS[k][short ? 'short' : 'long'] : '';
  }

  /** 这一轮结束：给最后一条还没有 endedAt 的用户消息记上结束时刻（停止、拒绝、跑完都走这里）。 */
  function endTurn(messages, now) {
    const list = messages || [];
    let idx = -1;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].role === 'user') { idx = i; break; }
    if (idx < 0 || list[idx].endedAt || !list[idx].startedAt) return list;
    return list.map((m, i) => (i === idx ? {...m, endedAt: now} : m));
  }

  window.BC_AGENT_TURN = {
    endTurn,
    TOOL_LABELS, FILE_EXT, toolStep, toolStatus, nextToolStatus, stepMeta, diffLines, looksLikeDiff,
    parsePathToken, pathTip, parseVideoTime, gapBetween, rowKind, turns, TAIL_TURNS, windowStart, findHits, locateHit, shownFor, formatElapsed, clockLabel, footerLabel, waitingFor, waitingLabel,
  };
})();
