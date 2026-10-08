/* BaoCut 原型 — Space（2026-10-01，product-design §4）
   window.BC_SPACE。纯函数，无 React、无 DOM；只在 App 入口加载。

   Space 是**派生的视图，不是第二份存储**（§4.1）：条目由各项目里权威的视频记录（store 的 `projects`）
   与产物记录（data.js `spaceOutputs` ＋ 二次编辑另存出来的新版本）投影出来。用户自己的整理——
   收藏、移入回收站——是盖在投影上的一层标记（`marks`），重建投影不丢它们。

   这里算：条目投影、分类与计数、搜索 / 排序 / 按项目与状态筛选、状态与来源的文字、
   时长与规格两列（§4.3）、视频菜单里的转录动作（§4.4），以及二次编辑「另存为新版本」（新加一条，原条目不动，§4.6）。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 条目类型（§4.2）。图标名是 S2 图标集里的（RSP.Icons），视图按名取。 */
  const KINDS = {
    movie:    {k: 'movie',    label: '视频', icon: 'Filmstrip'},
    final:    {k: 'final',    label: '成片', icon: 'Video'},
    image:    {k: 'image',    label: '图片', icon: 'Image'},
    audio:    {k: 'audio',    label: '音频', icon: 'AudioWave'},
    subtitle: {k: 'subtitle', label: '字幕', icon: 'CloseCaptions'},
    doc:      {k: 'doc',      label: '文档', icon: 'FileText'},
    template: {k: 'template', label: '模板', icon: 'Template'},
  };
  const KIND_ORDER = ['movie', 'final', 'image', 'audio', 'subtitle', 'doc', 'template'];

  /* 分类侧栏（§4.3）：全部 ＋ 七类；收藏；回收站。 */
  const CATS = [{k: 'all', label: '全部', icon: 'Apps'}]
    .concat(KIND_ORDER.map((k) => ({k, label: KINDS[k].label, icon: KINDS[k].icon})));
  const SPECIAL = [{k: 'fav', label: '收藏', icon: 'Star'}, {k: 'trash', label: '回收站', icon: 'Delete'}];
  const isCat = (k) => CATS.some((c) => c.k === k) || SPECIAL.some((c) => c.k === k);

  /* 状态（§4.4）。`failed` 只给转录失败的视频——表里没有它，但它和「缺失」不是一回事（§2.6）。 */
  const STATUS = {
    generating: {k: 'generating', label: '生成中',  tone: 'informative'},
    candidate:  {k: 'candidate',  label: '候选',    tone: 'notice'},
    applied:    {k: 'applied',    label: '已应用',  tone: 'positive'},
    published:  {k: 'published',  label: '已发布',  tone: 'positive'},
    stale:      {k: 'stale',      label: '来源已变', tone: 'notice'},
    missing:    {k: 'missing',    label: '缺失',    tone: 'negative'},
    failed:     {k: 'failed',     label: '失败',    tone: 'negative'},
  };

  const SORTS = [{k: 'recent', label: '最近活动'}, {k: 'created', label: '创建时间'}, {k: 'updated', label: '更新时间'}, {k: 'name', label: '名称'}, {k: 'kind', label: '类型'}];

  /** 视频的状态：转录在跑 / 排队 → 生成中；源文件找不到 → 缺失；转录失败 → 失败；其余是普通的工作稿（无状态）。 */
  function movieStatus(m) {
    if (m.status === 'transcribing' || m.status === 'queued') return 'generating';
    if (m.src && m.src.state === 'missing') return 'missing';
    if (m.status === 'error') return 'failed';
    return null;
  }

  /* 视频菜单里的转录动作（§4.4）：转录过 → 重新转录；上次失败 → 重试转录；有素材但没转录过 → 转录。
     能不能转录与工具的视频选择器同一个判据（BC_TOOL_TARGETS.blockReason：转录中 / 排队 / 没有素材 / 源文件找不到 都不给）。 */
  const TRANSCRIBE = {
    redo:  {k: 'redo',  label: '重新转录…'},
    retry: {k: 'retry', label: '重试转录…'},
    first: {k: 'first', label: '转录…'},
  };
  /** 视频记录 → 'redo' | 'retry' | 'first' | null（不能转录）。 */
  function transcribeAction(m) {
    const TT = root.BC_TOOL_TARGETS;
    if (!m || !TT) return null;
    const f = TT.facts(m);
    if (TT.blockReason('transcribe', m, f)) return null;
    if (f.state === 'failed') return 'retry';
    return f.transcripts.length ? 'redo' : 'first';
  }

  const mark = (marks, key, id, fallback) => {
    const m = marks && marks[key];
    return m && Object.prototype.hasOwnProperty.call(m, id) ? !!m[id] : !!fallback;
  };

  /**
   * 投影：视频 ＋ 产物 → 一张条目表。
   * @param {{movies, outputs, dirs?, marks?, pctOf?}} s
   *   pctOf(item) → 生成中条目的进度（读任务记录；不给就用记录上的 pct / progress）
   */
  function items(s) {
    const dirs = {};
    (s.dirs || []).forEach((d) => { dirs[d.id] = d; });
    const pct = s.pctOf || (() => null);
    const out = [];
    (s.movies || []).forEach((m) => {
      const it = {
        id: m.id, kind: 'movie', name: m.title, dir: m.dir || null, movie: m.id, session: null, task: null,
        status: movieStatus(m), dur: m.duration || 0, res: m.src ? m.src.res : '', bytes: (m.src && m.src.bytes) || null,
        ctime: m.ctime != null ? m.ctime : null,
        transcribe: transcribeAction(m), mtime: m.mtime != null ? m.mtime : m.ctime != null ? m.ctime : null,   // 刚建的视频只有 ctime
        origin: m.origin ? m.origin.project : null, queuePos: m.status === 'queued' ? m.queuePos || null : null,
        hue: m.hue, folder: m.folder || null, ver: null, parent: null,
        toolRun: m.toolRun || null,   // 工具新建的视频：来源记为那次运行（product-design §2.7）
      };
      it.fav = mark(s.marks, 'fav', m.id, m.fav);
      it.trashed = mark(s.marks, 'trash', m.id, m.archived);
      it.pct = it.status === 'generating' && !it.queuePos ? (pct(it) != null ? pct(it) : m.progress || 0) : null;
      out.push(it);
    });
    (s.outputs || []).forEach((o) => {
      const it = Object.assign({session: null, task: null, movie: null, dir: null, status: null, ver: null, parent: null, origin: null}, o);
      it.fav = mark(s.marks, 'fav', o.id, o.fav);
      it.trashed = mark(s.marks, 'trash', o.id, o.trashed);
      it.pct = it.status === 'generating' ? (pct(it) != null ? pct(it) : o.pct || 0) : null;
      out.push(it);
    });
    return out;
  }

  /** 一个条目落在不落在某个分类里。回收站只收已移入的；其余分类都不含回收站里的。 */
  function inCat(it, cat) {
    if (cat === 'trash') return !!it.trashed;
    if (it.trashed) return false;
    if (!cat || cat === 'all') return true;
    if (cat === 'fav') return !!it.fav;
    return it.kind === cat;
  }

  /** 各分类的条目数（侧栏行尾）。 */
  function counts(list) {
    const n = {};
    CATS.concat(SPECIAL).forEach((c) => { n[c.k] = 0; });
    (list || []).forEach((it) => { CATS.concat(SPECIAL).forEach((c) => { if (inCat(it, c.k)) n[c.k]++; }); });
    return n;
  }

  const lc = (x) => String(x || '').toLowerCase();

  /**
   * 列表区：分类 → 筛选 → 搜索 → 排序。
   * @param {Array} list items() 的结果
   * @param {{cat?, q?, sort?, dir?, status?, from?}} o
   *   dir：项目 id，'none' = 不属于任何项目；status：状态键，'none' = 无状态；from：只看从这部视频切出来的
   */
  function view(list, o) {
    const opt = o || {};
    const q = lc(opt.q).trim();
    let rows = (list || []).filter((it) => inCat(it, opt.cat || 'all'));
    if (opt.from) rows = rows.filter((it) => it.origin === opt.from);
    if (opt.dir) rows = rows.filter((it) => (opt.dir === 'none' ? !it.dir : it.dir === opt.dir));
    if (opt.status) rows = rows.filter((it) => (opt.status === 'none' ? !it.status : it.status === opt.status));
    if (q) rows = rows.filter((it) => lc(it.name).indexOf(q) >= 0 || lc(it.file).indexOf(q) >= 0);
    const sort = opt.sort || 'recent';
    const idx = new Map(rows.map((r, i) => [r, i]));
    // 演示时间是距今的分钟数：数值越小，实际时间越新（§4.3，时间倒序）。
    const t = (it, key = 'mtime') => (Number.isFinite(it[key]) ? it[key] : Infinity);
    return rows.slice().sort((a, b) => {
      let d = 0;
      if (sort === 'name') d = String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
      else if (sort === 'kind') d = (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || (t(a) - t(b));
      else if (sort === 'created') d = t(a, 'ctime') - t(b, 'ctime');
      else d = t(a) - t(b);
      return d || (idx.get(a) - idx.get(b));
    });
  }

  /** 「项目」筛选的选项：条目里出现过的项目（按名称），有不属于项目的条目时末尾加一项。 */
  function dirOptions(list, dirs) {
    const seen = new Set((list || []).map((it) => it.dir));
    const opts = (dirs || []).filter((d) => seen.has(d.id)).map((d) => ({k: d.id, label: d.name}))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
    if (seen.has(null) || seen.has(undefined)) opts.push({k: 'none', label: '不属于任何项目'});
    return opts;
  }

  /* 视频的状态用视频自己的词（data.js 的 BADGE：转录中 / 排队中 / 失败），与会话里的视频卡、Home 的视频选择器一个说法；
     「生成中」留给产物与筛选菜单（§4.4）。 */
  const badgeWord = (k, fallback) => {
    const B = root.BC_DATA && root.BC_DATA.BADGE;
    return (B && B[k] && B[k].label) || fallback;
  };

  /** 状态那一列 / 卡片角上的字。生成中带进度或排队位次；没有状态返回 null。 */
  function statusText(it) {
    const s = it && it.status ? STATUS[it.status] : null;
    if (!s) return null;
    if (it.kind === 'movie' && s.k === 'generating') {
      return it.queuePos ? `${badgeWord('queued', '排队中')} · 第 ${it.queuePos} 位` : `${badgeWord('transcribing', '转录中')} · ${Math.round(it.pct || 0)}%`;
    }
    if (it.kind === 'movie' && s.k === 'failed') return badgeWord('error', s.label);
    if (s.k === 'generating') {
      if (it.queuePos) return `${s.label} · 排队第 ${it.queuePos} 位`;
      if (it.pct != null) return `${s.label} · ${Math.round(it.pct)}%`;
    }
    return s.label;
  }

  /** 文件大小：B 取整；KB 起不到 10 留一位小数（「2.4 MB」），10 以上取整（「84 MB」）。按 1024 进位。 */
  function formatBytes(n) {
    const b = +n;
    if (!(b > 0)) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = b, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    if (i === 0) return `${Math.round(v)} B`;
    const r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
    if (r >= 1024 && i < units.length - 1) return `1 ${units[i + 1]}`;
    return `${String(r).replace(/\.0$/, '')} ${units[i]}`;
  }

  /* 有时长的类型（§4.3）：视频、成片、音频。时长是它们的首要事实，网格的角标与列表的「时长」列都画它。 */
  const TIMED = ['movie', 'final', 'audio'];

  /** 文字写法的时长（「3 分 26 秒」），查看框的事实用；有时长的类型才有，其余类型或时长未知返回 ''。 */
  function durationText(it) {
    if (!it || TIMED.indexOf(it.kind) < 0 || !(it.dur > 0)) return '';
    const T = root.BC_TIME;
    return T ? T.duration(it.dur) : `${Math.round(it.dur)} 秒`;
  }

  /** 时钟写法的时长（「03:26」「1:20:20」）：网格卡片的角标与列表的「时长」列共用，与 Home 会话里视频卡的时长同一个写法；
      等宽数字右对齐，一列扫下来长短一目了然。 */
  function durationClock(it) {
    if (!durationText(it)) return '';
    const T = root.BC_TIME;
    return T ? T.timecode(it.dur, {decimals: 0}) : durationText(it);
  }

  /** 「规格」那一列（次要事实）：视频、成片、图片 → 分辨率 · 文件大小；音频 → 文件大小；字幕 → N 句；文档 → N 行。 */
  function specText(it) {
    if (!it) return '';
    const size = formatBytes(it.bytes);
    if (it.kind === 'movie' || it.kind === 'final' || it.kind === 'image') return [it.res || '', size].filter(Boolean).join(' · ');
    if (it.kind === 'audio') return size;
    if (it.kind === 'subtitle') return it.lines ? `${it.lines} 句` : '';
    if (it.kind === 'doc') return it.lines ? `${it.lines} 行` : '';
    return '';
  }

  /** 工具生成的条目的工具名（§2.7）：条目记的 `toolId`（或字符串形的 `tool`）在工具目录里的名字；认不出返回 null。 */
  function toolName(it) {
    const id = it && (it.toolId || (typeof it.tool === 'string' ? it.tool : null));
    const T = root.BC_TOOLS;
    const t = id && T && T.TOOLS ? T.TOOLS.find((x) => x.id === id) : null;
    return t ? t.name : null;
  }

  /** 「来源」那一列：项目 · 视频；不属于项目的写明。工具的结果写「工具 · <工具名>」（§2.7：结果缺省不属于项目），属于项目时前面带项目。 */
  function sourceText(it, dirsById, moviesById) {
    const d = it.dir ? (dirsById || {})[it.dir] : null;
    const m = it.kind !== 'movie' && it.movie ? (moviesById || {})[it.movie] : null;
    const head = d ? d.name : '不属于任何项目';
    if (it.kind === 'movie' && it.toolRun) return `${head} · ${it.toolRun.label || '工具'}新建`;
    if (it.kind !== 'movie' && (it.tool === true || typeof it.tool === 'string' || it.toolId)) {
      const name = toolName(it);
      const tool = name ? `工具 · ${name}` : '工具';
      return d ? `${d.name} · ${tool}` : tool;
    }
    return m ? `${head} · ${m.title}` : head;
  }

  const agoText = (min) => {
    if (min == null) return '';
    const AG = root.BC_AGENT;
    return AG ? AG.agoLabel(min) : `${Math.round(min)} 分钟前`;
  };

  /** 轻量文档预览：标题、段落、平面列表和围栏代码。其他语法保留原文字，视图不注入 HTML。 */
  function documentBlocks(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let i = 0;
    const list = (line) => line.match(/^(?:(\d+)\. |([-*+]) )(.*)$/);
    const boundary = (line) => !line.trim() || /^#{1,6} |^```/.test(line) || list(line);
    while (i < lines.length) {
      const line = lines[i++];
      if (!line.trim()) continue;
      if (/^```/.test(line)) {
        const content = [];
        while (i < lines.length && !/^```\s*$/.test(lines[i])) content.push(lines[i++]);
        if (i < lines.length) i++;
        blocks.push({type: 'code', text: content.join('\n')});
      } else if (/^#{1,6} /.test(line)) {
        const m = line.match(/^(#{1,6}) (.*)$/);
        blocks.push({type: 'heading', level: m[1].length, text: m[2]});
      } else if (list(line)) {
        const m = list(line), ordered = !!m[1], items = [m[3]];
        while (i < lines.length && list(lines[i]) && !!list(lines[i])[1] === ordered) items.push(list(lines[i++])[3]);
        blocks.push({type: 'list', ordered, start: ordered ? Number(m[1]) : null, items});
      } else {
        const content = [line];
        while (i < lines.length && !boundary(lines[i])) content.push(lines[i++]);
        blocks.push({type: 'paragraph', text: content.join('\n')});
      }
    }
    return blocks;
  }

  /* ---------- 二次编辑（§4.6） ---------- */
  /** 这个条目的二次编辑走哪条路：
      editor（视频：完整编辑器）· source（有来源视频的成片：回到来源视频）· new-movie（无来源的成片：以它为素材新建视频）·
      text（字幕 / 文档：直接改文字，另存为新版本）· version（图片 / 音频 / 模板：另存一份新版本再改，模型辅助交给 Agent）。 */
  function editRoute(it) {
    if (!it) return null;
    if (it.kind === 'movie') return 'editor';
    if (it.kind === 'final') return it.movie ? 'source' : 'new-movie';
    if (it.kind === 'subtitle' || it.kind === 'doc') return 'text';
    return 'version';
  }

  const rootOf = (it) => (it.parent || it.id);
  /** 同一条产物的全部版本（原条目在前，按版本号）。 */
  function versionsOf(it, list) {
    const r = rootOf(it);
    return (list || []).filter((x) => x.kind !== 'movie' && rootOf(x) === r)
      .sort((a, b) => (a.ver || 1) - (b.ver || 1));
  }

  /** 名字里插版本号：「a.srt」→「a v2.srt」；已经带版本号的换掉。 */
  function versionName(name, ver) {
    const raw = String(name || '');
    const slash = raw.endsWith('/') ? '/' : '';   // 目录形的产物（模板包）：版本号插在尾斜杠前
    const base = (slash ? raw.slice(0, -1) : raw).replace(/ v\d+(?=(\.[^.\s/]+)?$)/, '');
    const m = base.match(/^(.*?)(\.[^.\s/]+)?$/);
    return `${m[1]} v${ver}${m[2] || ''}${slash}`;
  }

  /**
   * 另存为新版本：返回一条**新的**产物记录（原条目不动）。新版本是候选，和原条目同一个来源，
   * 文字类带上改过的文字。视频不走这里（视频的二次编辑就是编辑器里的普通事务）。
   */
  function newVersion(it, list, newId, patch) {
    if (!it || it.kind === 'movie' || !newId) return null;
    const vs = versionsOf(it, list);
    const ver = vs.reduce((n, x) => Math.max(n, x.ver || 1), 1) + 1;
    const origin = vs[0] || it;
    const rec = {
      id: newId, kind: it.kind, name: versionName(origin.name, ver), dir: it.dir || null, movie: it.movie || null,
      session: it.session || null, task: null, status: 'candidate', ctime: 0, mtime: 0, parent: rootOf(it), ver,
      dur: it.dur, res: it.res, lines: it.lines, hue: it.hue, text: it.text,
      file: it.file ? versionName(it.file, ver) : '',
    };
    return Object.assign(rec, patch || {});
  }

  /* ---------- 导入素材（§4.8） ----------
     导入 = 把文件拷进项目目录的「素材/」；Space 的投影会把它们读出来。视频不在这里——视频是视频的源，
     走「从文件新建视频」。认不出的类型不收。 */
  const IMPORT_ACCEPT = ['image/*', 'audio/*', '.srt', '.vtt', '.ass', '.md', '.txt'];
  function kindOfFile(name, type) {
    const n = String(name || '').toLowerCase();
    const t = String(type || '').toLowerCase();
    if (t.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|svg)$/.test(n)) return 'image';
    if (t.startsWith('audio/') || /\.(wav|mp3|m4a|aac|flac|ogg)$/.test(n)) return 'audio';
    if (/\.(srt|vtt|ass)$/.test(n)) return 'subtitle';
    if (/\.(md|txt)$/.test(n) || t === 'text/plain' || t === 'text/markdown') return 'doc';
    return null;
  }
  /** 一份导入文件 → 一条产物记录（不认得的类型返回 null）。 */
  function assetRecord(file, dirId, id) {
    const kind = kindOfFile(file && file.name, file && file.type);
    if (!kind || !id) return null;
    return {id, kind, name: file.name, dir: dirId || null, movie: null, session: null, task: null, status: null,
      ctime: 0, mtime: 0, file: '素材/' + file.name, hue: 200};
  }

  /** 输入框「+ › 最近的视频」：最近活动的 n 部（缺省 8），不含归档的；每项带「项目名 · 相对时间」。 */
  function recentMovies(movies, dirs, n) {
    const byDir = Object.fromEntries((dirs || []).map((d) => [d.id, d]));
    const t = (m) => (m.mtime == null ? Infinity : m.mtime);
    return (movies || []).map((m, i) => ({m, i})).filter((x) => !x.m.archived && !x.m.trashed)
      .sort((a, b) => (t(a.m) - t(b.m)) || (a.i - b.i)).slice(0, n == null ? 8 : n)
      .map(({m}) => ({id: m.id, title: m.title,
        desc: [(byDir[m.dir] || {}).name || '不属于任何项目', agoText(m.mtime)].filter(Boolean).join(' · ')}));
  }

  root.BC_SPACE = {
    KINDS, KIND_ORDER, CATS, SPECIAL, STATUS, SORTS, TRANSCRIBE, isCat, movieStatus, transcribeAction,
    items, inCat, counts, view, dirOptions, statusText, formatBytes, durationText, durationClock, specText, sourceText, toolName, agoText,
    documentBlocks, editRoute, versionsOf, versionName, newVersion, IMPORT_ACCEPT, kindOfFile, assetRecord, recentMovies,
  };
})();
