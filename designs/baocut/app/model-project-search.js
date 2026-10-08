/* BaoCut 原型 — 项目搜索（两层：元信息 + 内容）
   window.BC_PSEARCH。纯函数，无 React、无 DOM。

   **两层是产品语义，不是实现细节**（§17.3）：第一层是项目自己的元信息
   （ID / 标题 / 文件名 / 路径 / 简介 / 备注 / 链接 / 来源三项），本地即时可得；
   第二层是项目内容（文稿段落 / 章节 / 说话人 / 译文 / 画面文字），真机上要过内核
   `bcut project search` 的缓存索引，所以它**晚到**。原型用一次延时把这个「先出元信息、
   再补内容」的两拍演出来，视图不许把两层合并成一次渲染。

   匹配器只有一份：整串、忽略大小写、字面子串，直接复用 [model-find.js](model-find.js)
   的 `BC_FIND.ranges`。不分词、不做 AND / OR——查找条与项目搜索用同一套「命中」定义，
   否则同一个词在两个入口给出两种结果，用户没法解释。

   区间一律是 **UTF-16 偏移**（与 BC_FIND 同坐标系）。`snippet` 只在切窗口时避开
   代理对，切完把区间整体减去窗口起点——两套坐标混用是这层最容易漏进去的 bug。 */
(function () {
  const F = () => (typeof window !== 'undefined' ? window.BC_FIND : null);

  /* ---------- 字段表：权重决定排序里的「命中在多要紧的字段上」 ----------
     long 的字段走 snippet 窗口，短字段整条给出；timed 的字段前面挂等宽时间码。 */
  const FIELDS = [
    {k: 'id',         label: '视频 ID',   tier: 1, w: 100},
    {k: 'title',      label: '标题',      tier: 1, w: 90},
    {k: 'file',       label: '文件名',    tier: 1, w: 80},
    {k: 'path',       label: '路径',      tier: 1, w: 70, long: true},
    {k: 'desc',       label: '简介',      tier: 1, w: 62, long: true},
    {k: 'notes',      label: '备注',      tier: 1, w: 58, long: true},
    {k: 'url',        label: '链接',      tier: 1, w: 54, long: true},
    {k: 'srcTitle',   label: '来源标题',  tier: 1, w: 50},
    {k: 'srcDesc',    label: '来源简介',  tier: 1, w: 46, long: true},
    {k: 'uploader',   label: '上传者',    tier: 1, w: 42},
    {k: 'chapter',    label: '章节',      tier: 2, w: 34, long: true, timed: true},
    {k: 'speaker',    label: '说话人',    tier: 2, w: 30},
    {k: 'transcript', label: '文稿',      tier: 2, w: 26, long: true, timed: true},
    {k: 'trans',      label: '译文',      tier: 2, w: 22, long: true, timed: true},
    {k: 'overlay',    label: '画面文字',  tier: 2, w: 18, long: true, timed: true},
  ];
  const BY_KEY = FIELDS.reduce((m, f) => Object.assign(m, {[f.k]: f}), {});

  const WIN = 96;     // snippet 窗口（字符）
  const LEAD = 32;    // 首个命中之前留多少字符
  const PAGE = 10;    // 每个项目默认给几条命中行

  function norm(q) { return String(q == null ? '' : q).trim(); }

  /** 一段文本里的全部命中。整串、忽略大小写、字面子串——语义与查找条一致。 */
  function highlightRanges(text, query) {
    const q = norm(query);
    const find = F();
    if (!q || !find) return [];
    return find.ranges(text, q, {});
  }

  const isLow  = (c) => c >= 0xDC00 && c <= 0xDFFF;
  const isHigh = (c) => c >= 0xD800 && c <= 0xDBFF;

  /** 长字段的取窗：首个命中之前留 lead 个字符，总长 win，两端按需补省略号。
      窗口边界只往外让，绝不落在代理对中间（emoji 会被切成两个问号方块）。 */
  function snippet(text, ranges, win, lead) {
    const s = String(text == null ? '' : text);
    const W = win || WIN;
    const L = lead == null ? LEAD : lead;
    const rs = (ranges || []).slice().sort((a, b) => a.start - b.start);
    if (s.length <= W) return {text: s, ranges: rs, head: false, tail: false};

    let start = Math.max(0, (rs.length ? rs[0].start : 0) - L);
    if (start > 0 && isLow(s.charCodeAt(start))) start--;
    let end = Math.min(s.length, start + W);
    if (end < s.length && isHigh(s.charCodeAt(end - 1))) end++;
    /* 窗口贴到尾巴时把它顶回去，短一截的窗看起来像被随手截断 */
    if (end === s.length) {
      start = Math.max(0, end - W);
      if (start > 0 && isLow(s.charCodeAt(start))) start--;
    }

    const out = [];
    rs.forEach((r) => {
      if (r.end <= start || r.start >= end) return;
      out.push({start: Math.max(r.start, start) - start, end: Math.min(r.end, end) - start});
    });
    return {text: s.slice(start, end), ranges: out, head: start > 0, tail: end < s.length};
  }

  /** 一条命中行。长字段现场取窗，短字段整条留着。 */
  function row(pid, key, text, extra) {
    const f = BY_KEY[key];
    const rs = (extra && extra.ranges) || [];
    const cut = f.long ? snippet(text, rs) : {text: String(text), ranges: rs, head: false, tail: false};
    return Object.assign({
      pid, field: key, label: f.label, chip: (extra && extra.chip) || f.label,
      tier: f.tier, w: f.w, t: (extra && extra.t) != null ? extra.t : null, timed: !!f.timed,
    }, cut);
  }

  function push(out, pid, key, text, q, extra) {
    if (text == null || text === '') return;
    const rs = highlightRanges(text, q);
    if (!rs.length) return;
    out.push(row(pid, key, text, Object.assign({ranges: rs}, extra || {})));
  }

  /** 一个项目的元信息命中行（第一层）。 */
  function metadataRows(p, q) {
    const out = [];
    const src = p.src || {};
    const s = p.source || {};
    push(out, p.id, 'id', p.id, q);
    push(out, p.id, 'title', p.title, q);
    push(out, p.id, 'file', src.name, q);
    push(out, p.id, 'path', src.path, q);
    push(out, p.id, 'desc', p.desc, q);
    push(out, p.id, 'notes', p.notes, q);
    push(out, p.id, 'url', p.url || s.url, q);
    push(out, p.id, 'srcTitle', s.title, q);
    push(out, p.id, 'srcDesc', s.desc, q);
    push(out, p.id, 'uploader', s.uploader, q);
    return out;
  }

  /** 一个项目的内容命中行（第二层）。演示数据挂在 `p.content` 上。 */
  function contentRows(p, q) {
    const out = [];
    const c = p.content || {};
    (c.chapters || []).forEach((ch) => push(out, p.id, 'chapter', ch.title, q, {t: ch.t}));
    (c.speakers || []).forEach((sp) => push(out, p.id, 'speaker', sp, q));
    (c.paras || []).forEach((pa) => push(out, p.id, 'transcript', pa.text, q, {t: pa.t}));
    (c.trans || []).forEach((tr) => push(out, p.id, 'trans', tr.text, q,
      {t: tr.t, chip: BY_KEY.trans.label + ' · ' + tr.lang}));
    (c.overlay || []).forEach((ov) => push(out, p.id, 'overlay', ov.text, q, {t: ov.t}));
    return out;
  }

  /* 行内排序：先看命中在多要紧的字段上，再按时间先后；无时间的排在有时间的前面。 */
  function sortRows(rows) {
    return rows.slice().sort((a, b) =>
      (b.w - a.w) || ((a.t == null ? -1 : a.t) - (b.t == null ? -1 : b.t)));
  }

  function group(projects, q, rowsOf) {
    const query = norm(q);
    if (!query) return [];
    const out = [];
    (projects || []).forEach((p) => {
      const rows = rowsOf(p, query);
      if (rows.length) out.push({id: p.id, project: p, rows: sortRows(rows)});
    });
    return out;
  }

  /** 第一层结果：按项目分组。 */
  function metadataResults(projects, q) { return group(projects, q, metadataRows); }
  /** 第二层结果：按项目分组。 */
  function contentResults(projects, q)  { return group(projects, q, contentRows); }

  /** 合并两层（同一个项目只出现一次，命中行合到一组里）。 */
  function merge(a, b) {
    const map = new Map();
    const order = [];
    (a || []).concat(b || []).forEach((g) => {
      if (!map.has(g.id)) { map.set(g.id, {id: g.id, project: g.project, rows: []}); order.push(g.id); }
      const dst = map.get(g.id);
      dst.rows = dst.rows.concat(g.rows);
    });
    return order.map((id) => {
      const g = map.get(id);
      return {id: g.id, project: g.project, rows: sortRows(g.rows)};
    });
  }

  /** 排序：项目 ID 整串相等 > 最高字段权重 > 命中条数 > 修改时间新者。
      `mtime` 是「多少分钟前」，越小越新（见 data.js）。 */
  function rank(groups, q) {
    const query = norm(q).toLowerCase();
    const key = (g) => ({
      exact: String(g.id).toLowerCase() === query ? 1 : 0,
      w: g.rows.reduce((m, r) => Math.max(m, r.w), 0),
      n: g.rows.length,
      m: (g.project && g.project.mtime != null) ? g.project.mtime : Number.MAX_SAFE_INTEGER,
    });
    return (groups || []).slice().sort((ga, gb) => {
      const a = key(ga), b = key(gb);
      return (b.exact - a.exact) || (b.w - a.w) || (b.n - a.n) || (a.m - b.m);
    });
  }

  /** 一次搜完（视图分两拍调用；`content: false` 就是只出第一层）。 */
  function search(projects, q, opts) {
    const withContent = !opts || opts.content !== false;
    return rank(merge(metadataResults(projects, q),
      withContent ? contentResults(projects, q) : []), q);
  }

  /** 分页：每个项目默认给 pageSize 条，「还有 N 条」按一次再放 pageSize 条。 */
  function planRows(rows, shown, pageSize) {
    const all = rows || [];
    const size = pageSize || PAGE;
    const take = Math.max(0, Math.min(shown == null ? size : shown, all.length));
    const rest = all.length - take;
    return {rows: all.slice(0, take), rest, more: Math.min(rest, size), next: take + size};
  }

  /** 总命中条数（状态行用）。 */
  function total(groups) {
    return (groups || []).reduce((n, g) => n + g.rows.length, 0);
  }

  /** 状态行文案。第二层还没到时说清楚「还在搜」，不要让人以为已经搜完了。 */
  function statusLabel(groups, q, pending) {
    const query = norm(q);
    if (!query) return '';
    if (pending) return '正在搜索文稿…';
    return total(groups) + ' 条结果 ·「' + query + '」';
  }

  window.BC_PSEARCH = {
    FIELDS, BY_KEY, WIN, LEAD, PAGE,
    highlightRanges, snippet, metadataRows, contentRows,
    metadataResults, contentResults, merge, rank, search, planRows, total, statusLabel,
  };
})();
