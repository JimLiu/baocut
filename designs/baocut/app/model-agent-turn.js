/* BaoCut 原型 — Agent 会话线程里「算出来的东西」：工具步骤行、正文里的文件路径、行间距、回合页脚
   window.BC_AGENT_TURN。无 React、无 DOM，node --test 直接 require。只在 App 入口加载。

   - 工具步骤行：固定的类别名 + 次级摘要（命令本身 / 相对路径 / 查询词），状态一旦失败不再被改回；
     BaoCut 自己的工具另有类别（model-agent-tools.js）
   - `parsePathToken`：正文行内代码像不像项目里的文件路径，带不带行号
   - `gapBetween`：相邻两行按种类定间距
   - 回合：从一句用户消息到下一句之前；页脚的计时、结束时刻与「复制这一轮」的正文 */
(function () {
  /* ---------- 工具步骤 ---------- */
  const TOOL_LABELS = {command: '运行命令', read: '读取文件', edit: '修改文件', search: '搜索', other: '其他工具'};
  const FILE_EXT = ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'css', 'rs', 'py', 'toml', 'yaml', 'yml',
    'srt', 'vtt', 'ass', 'mp4', 'mov', 'wav', 'mp3', 'png', 'jpg'];
  const CLI = /^(bcut|ffmpeg|ffprobe|npm|npx|node|git|ls|cat|rg|grep|find|python3?|sh|bash)(\s|$)/;
  const looksLikeFile = (s) => /\/$/.test(s) || new RegExp(`\\.(${FILE_EXT.join('|')})$`, 'i').test(s);

  /** 一条工具消息的类别与摘要。演示数据带 `kind` / `summary`；只有 `cmd` 的老数据按写法推。 */
  function toolStep(m) {
    /* BaoCut 自己的工具（架构设计 §3.5）：类别名与摘要按工具与参数定（model-agent-tools.js），带图标 */
    const own = m && m.tool && window.BC_AGENT_TOOLS ? window.BC_AGENT_TOOLS.describe(m.tool, m.args) : null;
    if (own) return own;
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

  /** 折叠行右侧的元数据：非零退出码、耗时。 */
  function stepMeta(m) {
    const out = [];
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
  /** 页脚文案：进行中「正在工作 · 0:42」（停下来等放行时「等你允许 · 0:42」），完成「已工作 1:03」；没有开始时间就不显示时长。 */
  function footerLabel(o) {
    const {startedAt, endedAt, live, waiting, now} = o || {};
    if (live) {
      const word = waiting ? '等你允许' : '正在工作';
      return startedAt ? `${word} · ${formatElapsed((now || Date.now()) - startedAt)}` : word;
    }
    if (startedAt && endedAt) return `已工作 ${formatElapsed(endedAt - startedAt)}`;
    return '';
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
    parsePathToken, pathTip, gapBetween, rowKind, turns, formatElapsed, clockLabel, footerLabel,
  };
})();
