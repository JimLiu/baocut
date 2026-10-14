/* BaoCut 原型 — Space 搜索（embedding-integration-design §2.4、§2.11；retrieval-spec v0.1 §11.2–11.5、§13）
   window.BC_SPACE_SEARCH。纯函数，无 React、无 DOM；node --test 直接 require。

   · 方式：综合（按意思 + 字面，缺省）/ 精确文字。没装模型或这台电脑不支持时「综合」退回精确文字，并在结果顶上说一句（§2.11）；
   · 通道：讲话内容 / 画面 / 声音。画面与声音这一版没有索引，只显示为不可用并写明原因（v0.1 §1 MVP 范围）；
   · 范围：这个项目 / 全部项目；
   · 结果卡：原句（纯语义命中不画假高亮，v0.1 §11.3）、时间、命中通道、视频名；排序不给百分比（相似度不是概率）；
   · 「在时间线打开」只在那一句还在时间线上时出现（剪掉了的只能看原片位置）；
   · 跨视频问答（§2.4 P1）：答案每句带可点的出处，索引不全时写明。
   演示里「按意思找」是 data.js semantic.concepts 那张手写概念表，不是真的向量。 */
(function () {
  const MODES = [{k: 'mix', label: '综合'}, {k: 'exact', label: '精确文字'}];
  const SCOPES = [{k: 'project', label: '这个项目'}, {k: 'all', label: '全部项目'}];

  const norm = (s) => String(s || '').toLowerCase();
  /** 查询里的字面片段：按空白与标点切，去掉疑问尾巴；单字也保留（中文常见） */
  function terms(q) {
    return String(q || '').replace(/[？?！!。，,；;：:“”"「」]/g, ' ').split(/\s+/).map((x) => x.trim()).filter(Boolean)
      .map((x) => x.replace(/^(我)?(哪一期|哪里|哪段)?(讲过|提到|说过)?/, '').replace(/(的那段|那段|的地方)$/, '') || x);
  }
  /** 字面命中的区间（给真高亮用） */
  function spans(text, ts) {
    const out = [];
    const low = norm(text);
    ts.forEach((t) => {
      const k = norm(t);
      if (!k) return;
      let i = low.indexOf(k);
      while (i >= 0) { out.push([i, i + k.length]); i = low.indexOf(k, i + k.length); }
    });
    out.sort((a, b) => a[0] - b[0]);
    return out.reduce((acc, r) => {
      const last = acc[acc.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else acc.push(r.slice());
      return acc;
    }, []);
  }
  /** 正文按高亮区间切成片段 [{t, hl}] */
  function pieces(text, ranges) {
    if (!ranges || !ranges.length) return [{t: text, hl: false}];
    const out = [];
    let at = 0;
    ranges.forEach(([s, e]) => {
      if (s > at) out.push({t: text.slice(at, s), hl: false});
      out.push({t: text.slice(s, e), hl: true});
      at = e;
    });
    if (at < text.length) out.push({t: text.slice(at), hl: false});
    return out;
  }

  /** 概念表里被查询唤起的那几条（演示的「按意思」） */
  function conceptHits(q, concepts) {
    const lq = norm(q);
    const ids = [];
    (concepts || []).forEach((c) => {
      if (c.keys.some((k) => lq.indexOf(norm(k)) >= 0 || (lq.length >= 2 && norm(k).indexOf(lq) >= 0))) {
        c.hits.forEach((id) => { if (ids.indexOf(id) < 0) ids.push(id); });
      }
    });
    return ids;
  }

  /** 搜索。o: {corpus, concepts, mode, scope, dir, dirOf(video)→dir, status: BC_SEMANTIC.status(...), cutOut: [ids], limit}
      返回 {results, mode: 'hybrid'|'lexical', degraded, asked}。results 已排序，不带分数。 */
  function search(q, o) {
    const x = o || {};
    const query = String(q || '').trim();
    const st = x.status || {usable: true};
    const asked = x.mode === 'exact' ? 'exact' : 'mix';
    const semantic = asked === 'mix' && st.usable;
    const out = {results: [], mode: semantic ? 'hybrid' : 'lexical', degraded: asked === 'mix' && !st.usable, asked};
    if (!query) return out;
    const pool = (x.corpus || []).filter((c) => x.scope !== 'project' || !x.dirOf || x.dirOf(c.video) === x.dir);
    const ts = terms(query);
    const exact = pool.filter((c) => spans(c.text, ts).length);
    const sem = semantic ? conceptHits(query, x.concepts).map((id) => pool.find((c) => c.id === id)).filter(Boolean) : [];
    /* 合并：两路都有的排前（各自名次相加），其余按各自名次交错——只给顺序，不给分数（v0.1 §11.3） */
    const rank = {};
    exact.forEach((c, i) => { rank[c.id] = {c, e: i}; });
    sem.forEach((c, i) => { rank[c.id] = Object.assign(rank[c.id] || {c}, {s: i}); });
    const cut = new Set(x.cutOut || []);
    const list = Object.values(rank).map((r) => {
      const both = r.e != null && r.s != null;
      const ranges = r.e != null ? spans(r.c.text, ts) : null;
      return Object.assign({}, r.c, {
        by: both ? 'both' : r.e != null ? 'exact' : 'semantic',
        /* 弱命中：只有意思一路、分数低于弱命中线（演示：概念表里排第 4 名之后的）。只标出，不藏起来 */
        weak: r.e == null && r.s >= 3,
        channel: 'text',
        hl: ranges,                        // 纯语义命中：null，不画高亮
        inTimeline: !cut.has(r.c.id),
        order: both ? Math.min(r.e, r.s) - 100 : (r.e != null ? r.e : r.s) + (r.e != null ? 0 : 0.5),
      });
    }).sort((a, b) => a.order - b.order);
    out.results = list.slice(0, x.limit || 20).map((r) => { const y = Object.assign({}, r); delete y.order; return y; });
    return out;
  }

  /** 弱命中折起来（retrieval-spec §11.3）：有明显相关的结果时，勉强相关的收在后面，点开才显示；全是弱命中时照常全给，
      卡片上写「只是勉强相关」。返回 {shown, folded}，顺序不变。 */
  function fold(results) {
    const list = results || [];
    const strong = list.filter((r) => !r.weak);
    return strong.length ? {shown: strong, folded: list.filter((r) => r.weak)} : {shown: list, folded: []};
  }

  /** 卡片右下那一小行「怎么找到的」：不写分数 */
  const BY = {both: '字面与意思都对上', exact: '字面命中', semantic: '意思相近，原句里没有这些字', weak: '只是勉强相关，原句里没有这些字'};

  /** 这一条为什么命中（卡片上那一句，不写分数）：字面对上的写出原句里对上的词（最多 3 个，按出现顺序去重）；只按意思找到的
      写「意思接近」。向量说不出是「因为哪个概念」才近，所以不编概念名——产品里能如实给的就是这些，再加上命中的那一帧与那一句本身。 */
  function why(r) {
    const words = [];
    (r.hl || []).forEach(([s, e]) => { const w = r.text.slice(s, e); if (words.indexOf(w) < 0) words.push(w); });
    const said = words.slice(0, 3).map((w) => `「${w}」`).join('');
    if (r.weak) return BY.weak;
    if (r.by === 'both' && said) return `说到了${said}，意思也对得上`;
    if (r.by === 'exact' && said) return `说到了${said}`;
    return '意思接近，原句里没有这些字';
  }

  /** 预览里放的那一段：命中那句的起止，前后各留 2 秒，不早于 0。返回 {from, to, hit: [start, end]} */
  const MOMENT_PAD = 2;
  function moment(r) {
    const end = r.end != null && r.end > r.t ? r.end : r.t + 4;
    return {from: Math.max(0, r.t - MOMENT_PAD), to: end + MOMENT_PAD, hit: [r.t, end]};
  }

  /** 结果顶上的提示（各自一句，可同时出现）：退回字面 / 索引在更新 */
  function notices(res, st, S) {
    const out = [];
    if (res.degraded) out.push({tone: 'info', text: st && st.reason === 'UNSUPPORTED' ? S.UNSUPPORTED_NOTE : S.ENTRY.search.not, settings: !(st && st.reason === 'UNSUPPORTED')});
    if (st && st.usable && st.stale) out.push({tone: 'notice', text: st.paused ? S.PAUSED_NOTE : S.STALE_NOTE});
    return out;
  }

  /** 范围的完整性：这个项目 = 那一个项目；全部 = 加起来。projects：data.js semantic.projects */
  function coverage(scope, dir, projects, S) {
    const list = scope === 'project' ? (projects || []).filter((p) => p.dir === dir) : (projects || []);
    const text = S.sumText(list);
    return {text, line: S.coverageLine({text, later: true}), partial: text.done < text.total};
  }

  /* ---------- 跨视频问答（§2.4 P1） ---------- */
  /** 用检索结果拼一段带出处的回答：按视频分组，每组一句，每句挂那几条结果做出处。
      names：视频 id → 名字。cov：coverage() 的结果，不全时加一句说明。 */
  function answer(q, results, names, cov) {
    const top = (results || []).slice(0, 6);
    if (!top.length) return {lines: [], note: '没找到相关的片段，换个说法试试。', partial: !!(cov && cov.partial)};
    const groups = [];
    top.forEach((r) => {
      let g = groups.find((x) => x.video === r.video);
      if (!g) { g = {video: r.video, items: []}; groups.push(g); }
      if (g.items.length < 2) g.items.push(r);
    });
    const lines = groups.slice(0, 3).map((g) => ({
      text: `「${(names && names[g.video]) || g.video}」：${g.items.map((r) => r.text.replace(/[。.]$/, '')).join('；')}。`,
      cites: g.items.map((r) => ({id: r.id, video: r.video, t: r.t})),
    }));
    const head = `${groups.length} 部视频里讲过相关的内容${groups.length > 3 ? '，这里列出前 3 部' : ''}：`;
    const note = cov && cov.partial ? `索引还不全（${cov.line}），答案可能漏了还没建好索引的视频。` : null;
    return {head, lines, note, partial: !!(cov && cov.partial)};
  }

  /** 输入像个问题吗（以问号结尾或有疑问词）——像就在结果上方给「回答这个问题」 */
  const looksLikeQuestion = (q) => /[？?]$|哪一期|哪里|什么时候|为什么|怎么|有没有|是不是/.test(String(q || '').trim());

  /* ---------- 相关视频（§2.4 P2：查看框里「讲相近内容的视频」） ---------- */
  const RELATED_SHOWN = 5;
  const LATIN = /^[A-Za-z0-9][A-Za-z0-9 .'&+-]*$/;
  /** 名字里的词：按空白与标点切，留下两个字以上、不是纯数字的 */
  function nameTokens(name) {
    return String(name || '').split(/[\s·・|｜,，、:：;；()（）[\]【】「」_—–.\-→]+/).map((t) => t.trim())
      .filter((t) => [...t].length >= 2 && !/^\d+$/.test(t));
  }
  /** 两个名字里共同的词（取最长的一个）；拉丁写法落在词边界上，其他按子串。没有时 null */
  function sharedName(a, b) {
    const has = (tok, name) => (LATIN.test(tok)
      ? new RegExp(`(^|[^A-Za-z0-9])${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i').test(name)
      : norm(name).indexOf(norm(tok)) >= 0);
    const found = nameTokens(a).filter((t) => has(t, b)).concat(nameTokens(b).filter((t) => has(t, a)));
    return found.sort((x, y) => [...y].length - [...x].length)[0] || null;
  }

  /** 讲相近内容的视频。o: {items: Space 条目, corpus, concepts, status: BC_SEMANTIC.status(...), limit}
      · 有模型、这部视频建好了索引：按整部视频的意思找别的视频，每部给最接近的那一句（演示用概念表模拟：和这部视频
        命中同一概念的别的视频，共同概念多的排前，那一句取第一个共同概念里它的命中）；
      · 没装模型、不支持，或这部视频还没建好索引：退回名字相近（名字里有同一个词），写明按名字列的（§2.13）；
      · 不列：自己、从它切出的短视频、它的来源视频（内容本来就重叠）、回收站里的。不给分数。
      返回 {by: 'semantic'|'name', reason: null|'MODEL_NOT_INSTALLED'|'UNSUPPORTED'|'INDEX_NOT_READY', stale, rows, more}；
      rows: {video, name, dir, why: {t, text}|null, shared: 词|null} */
  function related(video, o) {
    const x = o || {};
    const st = x.status || {usable: true};
    const items = x.items || [];
    const self = items.find((i) => i.id === video) || {};
    const pool = items.filter((i) => i.kind === 'movie' && i.id !== video && !i.trashed && i.origin !== video && i.id !== self.origin);
    const limit = x.limit || RELATED_SHOWN;
    const indexed = (x.corpus || []).some((c) => c.video === video);
    const cut = (rows) => ({rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit)});
    if (st.usable && indexed) {
      const mine = (h) => h.split(':')[0] === video;
      const score = {};
      (x.concepts || []).forEach((c) => {
        if (!c.hits.some(mine)) return;
        const seen = new Set();
        c.hits.forEach((h) => {
          const v = h.split(':')[0];
          const it = pool.find((i) => i.id === v);
          if (!it || seen.has(v)) return;
          seen.add(v);
          const s = score[v] || (score[v] = {it, n: 0, first: null});
          s.n++;
          if (!s.first) s.first = (x.corpus || []).find((cc) => cc.id === h) || null;
        });
      });
      const rows = Object.values(score).sort((a, b) => b.n - a.n)
        .map((s) => ({video: s.it.id, name: s.it.name, dir: s.it.dir, why: s.first ? {t: s.first.t, text: s.first.text} : null, shared: null}));
      return Object.assign({by: 'semantic', reason: null, stale: !!st.stale}, cut(rows));
    }
    const rows = pool.map((it) => ({it, shared: sharedName(self.name, it.name)})).filter((r) => r.shared)
      .sort((a, b) => ([...b.shared].length - [...a.shared].length) || ((b.it.dir === self.dir) - (a.it.dir === self.dir)))
      .map((r) => ({video: r.it.id, name: r.it.name, dir: r.it.dir, why: null, shared: r.shared}));
    return Object.assign({by: 'name', reason: st.usable ? 'INDEX_NOT_READY' : st.reason, stale: false}, cut(rows));
  }

  /** 相关视频那一块顶上的一句：按名字列的原因；索引在更新时的提醒。能用且最新时 null */
  function relatedNote(r) {
    if (r.by === 'name') {
      if (r.reason === 'UNSUPPORTED') return {tone: 'info', text: '这台电脑暂不支持本机语义模型，先按名字相近列出', settings: false};
      if (r.reason === 'INDEX_NOT_READY') return {tone: 'info', text: '这部视频的讲话内容还没建好索引，先按名字相近列出', settings: false};
      return {tone: 'info', text: '没装本机语义模型，先按名字相近列出', settings: true};
    }
    return r.stale ? {tone: 'notice', text: '索引更新中，结果可能不含最近的修改', settings: false} : null;
  }

  /* ---------- 编辑器里的「查找片段」（§2.1：与 Space 搜索同一服务的另一个入口） ---------- */
  const IN_VIDEO_SHOWN = 5;
  /** 这部视频里意思相近、原句里没有这些字的句子（字面命中已在文稿里高亮，不重复列）。o: {corpus, concepts, video, status, limit}
      返回 {usable, stale, rows: [{id, t, end, text}]}；查询不到两个字、正则查找、语义不能用时 rows 为空（不能用的原因由入口的那一句说）。 */
  function inVideo(q, o) {
    const x = o || {};
    const st = x.status || {usable: true};
    const out = {usable: !!st.usable, stale: !!st.stale, rows: []};
    if (!st.usable || x.regex || [...String(q || '').trim()].length < 2) return out;
    const pool = (x.corpus || []).filter((c) => c.video === x.video);
    const res = search(q, {corpus: pool, concepts: x.concepts, mode: 'mix', status: st});
    out.rows = res.results.filter((r) => r.by === 'semantic').slice(0, x.limit || IN_VIDEO_SHOWN)
      .map((r) => ({id: r.id, t: r.t, end: r.end, text: r.text}))
      .sort((a, b) => a.t - b.t);
    return out;
  }

  const api = {MODES, SCOPES, terms, spans, pieces, conceptHits, search, fold, BY, why, MOMENT_PAD, moment, notices, coverage, answer, looksLikeQuestion,
    RELATED_SHOWN, nameTokens, sharedName, related, relatedNote, IN_VIDEO_SHOWN, inVideo};
  if (typeof window !== 'undefined') window.BC_SPACE_SEARCH = api;
})();
