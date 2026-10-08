/* 字体库的纯层（product-design §5.9「字体」、§7.6；architecture-design §9.1）。
   ============================================================================
   选字框、设置里的「字体」、打开视频时的字体下载条与导出面板读的是同一份状态：
   每个族一条，`state` 与 Runtime 的 `FontFamilyStatus.state` 同一套词——

     built-in     内置：随应用发布，不下载
     installed    本机：本机已装，同族只认本机的，不下载
     downloaded   已下载：下载缓存里有它的字重
     downloadable 可下载：Google Fonts 字体目录里有，还没下载
     downloading  下载中：带字节进度
     failed       失败：最近一次下载失败或被取消（取消也记在这里，`error.code === 'CANCELLED'`），可以重试

   这里只做「算」：合表、排序、筛选、分段、每一行末尾放什么、进度怎么念、镜像地址是否合规、
   打开视频与导出时要说什么。状态本身（下载的推进、取消、删除）在 font-library-store.jsx。
   不碰 DOM、不读 `window.BC_DATA`，输入全部由调用方给。
   ============================================================================ */
(function () {
  const STATE_LABEL = {
    'built-in': '内置', installed: '本机', downloaded: '已下载', downloadable: '可下载',
    downloading: '下载中', failed: '失败',
  };
  const SOURCE_LABEL = {'built-in': '随应用发布', local: '本机已装', 'google-fonts': 'Google Fonts'};
  const LICENCE_LABEL = {'OFL-1.1': 'SIL Open Font License 1.1', 'Apache-2.0': 'Apache License 2.0', 'UFL-1.0': 'Ubuntu Font Licence 1.0'};
  const CATEGORIES = [
    {k: 'sans-serif', label: '无衬线'}, {k: 'serif', label: '衬线'}, {k: 'display', label: '标题'},
    {k: 'handwriting', label: '手写'}, {k: 'monospace', label: '等宽'},
  ];
  const SCRIPTS = [
    {k: 'chinese', label: '中文'}, {k: 'japanese', label: '日文'}, {k: 'korean', label: '韩文'},
    {k: 'latin', label: '拉丁'}, {k: 'cyrillic', label: '西里尔'}, {k: 'greek', label: '希腊'},
    {k: 'vietnamese', label: '越南'}, {k: 'arabic', label: '阿拉伯'}, {k: 'hebrew', label: '希伯来'},
    {k: 'thai', label: '泰文'}, {k: 'devanagari', label: '天城文'},
  ];
  /** 样张：非拉丁文字的族在族名后面补几个本文字的字（族名多是拉丁字母，看不出中文长什么样）。 */
  const SAMPLE = {chinese: '永和九年', japanese: 'あいうえお', korean: '가나다라', arabic: 'أبجد', hebrew: 'אבגד',
    thai: 'กขฃค', devanagari: 'कखगघ'};

  function fmtBytes(n) {
    const b = Math.max(0, Number(n) || 0);
    if (b >= 1024 * 1024 * 1024) return (b / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return b + ' B';
  }

  /** 进度怎么念：知道总数时是百分比，不知道时只念收到了多少。 */
  function progressText(p) {
    if (!p) return '';
    if (p.total) return Math.min(100, Math.floor((p.done / p.total) * 100)) + '%';
    return fmtBytes(p.done);
  }
  const progressValue = (p) => (p && p.total ? Math.min(100, (p.done / p.total) * 100) : null);

  /** 一个族此刻的状态：元数据（来源）＋ 运行时（缓存、在跑的下载、最近的失败）。
      次序与 Runtime 相同：内置 > 本机 > 下载中 > 已下载 > 失败 > 可下载。 */
  function stateOf(meta, rt) {
    if (meta.source === 'built-in') return 'built-in';
    if (meta.source === 'local') return 'installed';
    const r = rt || {};
    if (r.progress) return 'downloading';
    if (r.faces && r.faces.length) return 'downloaded';
    if (r.error) return 'failed';
    return 'downloadable';
  }

  /** 合表：元数据 × 运行时 × 样张写法 → 每个族一条。`extra` 是只在旧目录里有名字的族（当本机的）。 */
  function statuses(input) {
    const metas = (input && input.families) || [];
    const runtime = (input && input.runtime) || {};
    const samples = {};
    ((input && input.samples) || []).forEach((s) => { samples[s.n] = s.st; });
    const seen = {};
    const out = metas.map((m) => {
      seen[m.family] = 1;
      return row(m, runtime[m.family], samples[m.family]);
    });
    ((input && input.samples) || []).forEach((s) => {
      if (!seen[s.n]) out.push(row({family: s.n, source: 'local', category: null, scripts: [], weights: [], italics: [], licence: null, rank: null}, null, s.st));
    });
    return out;
  }
  function row(meta, rt, st) {
    const r = rt || {};
    const state = stateOf(meta, r);
    const faces = r.faces || [];
    return Object.assign({}, meta, {
      state, st: st || "font-family:'" + meta.family + "'",
      faces, sizeBytes: faces.length * (meta.faceBytes || 0),
      progress: state === 'downloading' ? r.progress : null,
      error: state === 'failed' ? r.error : null,
      downloadedAt: r.at || null,
    });
  }

  /** 列表次序（与 `fonts.catalogue` 相同）：内置在前，已下载其次，再按目录的热门程度（本机装了的目录字体也在这里），
      目录里没有的本机字体最后（按名字）。 */
  function order(list) {
    const tier = (f) => (f.source === 'built-in' ? 0 : f.state === 'downloaded' ? 1 : f.rank != null ? 2 : 3);
    return list.slice().sort((a, b) => {
      const ta = tier(a), tb = tier(b);
      if (ta !== tb) return ta - tb;
      if (ta === 2 || ta === 0) return (a.rank == null ? Infinity : a.rank) - (b.rank == null ? Infinity : b.rank);
      return a.family.localeCompare(b.family, 'en');
    });
  }

  /** 排好的次序记成 族名 → 序号：打开着的选字框用它排，下载完成不挪行（表外的新族排在后面）。 */
  function orderKey(list) {
    const key = {};
    order(list).forEach((f, i) => { key[f.family] = i; });
    return key;
  }
  const sortRows = (rows, frozen) => (frozen
    ? rows.slice().sort((a, b) => (frozen[a.family] ?? Infinity) - (frozen[b.family] ?? Infinity) || a.family.localeCompare(b.family, 'en'))
    : order(rows));

  /** 按族名（包含、不分大小写）、分类与文字筛。 */
  function filter(list, q) {
    const query = String((q && q.query) || '').trim().toLowerCase();
    return list.filter((f) => (!query || f.family.toLowerCase().includes(query))
      && (!q || !q.category || f.category === q.category)
      && (!q || !q.script || (f.scripts || []).includes(q.script)));
  }

  /** 选字框的分段：「这个视频里用到」「最近用过」「品牌字体」，然后是全部（同一张表的不同取法，不去重）。
      有检索词或筛选时合成一条「搜索结果」。`limit` 是全部那一段先画多少条（其余滚到底再画）。 */
  function sections(list, opts) {
    const o = opts || {};
    const byName = {};
    list.forEach((f) => { byName[f.family] = f; });
    const pick = (names) => (names || []).map((n) => byName[n]).filter(Boolean);
    if (String(o.query || '').trim() || o.category || o.script) {
      const rows = sortRows(filter(list, o), o.frozen);
      return [{key: 'search', title: '搜索结果', rows, total: rows.length}];
    }
    const out = [];
    const used = pick(o.inVideo);
    if (used.length) out.push({key: 'video', title: '这个视频里用到', rows: used});
    const recent = pick(o.recent).slice(0, 5);
    if (recent.length) out.push({key: 'recent', title: '最近用过', rows: recent});
    const brand = pick(o.brand);
    if (brand.length) out.push({key: 'brand', title: '品牌字体', rows: brand});
    const all = sortRows(list, o.frozen);
    out.push({key: 'all', title: '全部字体', rows: all, total: all.length});
    return out;
  }

  /** 每一行末尾放什么。 */
  function rowEnd(f) {
    switch (f.state) {
      case 'built-in': case 'installed':
        return {kind: 'badge', label: STATE_LABEL[f.state]};
      case 'downloaded':
        return {kind: 'badge', label: '已下载', tone: 'positive'};
      case 'downloading':
        return {kind: 'progress', label: progressText(f.progress), value: progressValue(f.progress)};
      case 'failed': {
        const cancelled = f.error && f.error.code === 'CANCELLED';
        return {kind: 'retry', label: cancelled ? '已取消' : '失败', message: f.error ? f.error.message : ''};
      }
      default:
        return {kind: 'download', label: '下载', size: fmtBytes((f.faceBytes || 0) * Math.min(2, (f.weights || []).length || 1))};
    }
  }

  /** 样张：族名 ＋（非拉丁文字的族）几个本文字的字。 */
  function sampleText(f) {
    const s = (f.scripts || []).find((k) => SAMPLE[k]);
    return s ? SAMPLE[s] : '';
  }

  /** 字体没取到时用什么代替（示意：真实的回退由渲染内核按文字与分类定）。 */
  function fallbackFor(f) {
    const scripts = (f && f.scripts) || [];
    if (scripts.some((s) => s === 'chinese' || s === 'japanese' || s === 'korean')) return 'Noto Sans SC';
    if (f && f.category === 'serif') return 'Source Serif 4';
    if (f && f.category === 'monospace') return 'Roboto Mono';
    return 'Inter';
  }

  /** 按 CSS 的字体匹配把要的字重对到这个族实际有的：400–500 先往上到 500 再往下，<400 先往下，>500 先往上。 */
  function snapWeight(weights, w) {
    const ws = (weights || []).slice().sort((a, b) => a - b);
    if (!ws.length || ws.includes(w)) return ws.length ? w : 400;
    const down = ws.filter((x) => x < w).reverse();
    const up = ws.filter((x) => x > w);
    if (w >= 400 && w <= 500) {
      const mid = up.filter((x) => x <= 500);
      return (mid[0] != null ? mid[0] : down[0] != null ? down[0] : up[0]);
    }
    return w < 400 ? (down[0] != null ? down[0] : up[0]) : (up[0] != null ? up[0] : down[0]);
  }

  /** 要下载哪几个字重：没指定时常规与粗体（按这个族实际有的对齐，同一个只算一次）。 */
  function defaultFaces(f) {
    return Array.from(new Set([snapWeight(f.weights, 400), snapWeight(f.weights, 700)]));
  }

  /** 镜像地址：空 = 用默认；否则必须是 https、没有账号、查询参数与片段。返回错误文案或 null。 */
  function mirrorError(value) {
    const v = String(value || '').trim();
    if (!v) return null;
    let u;
    try { u = new URL(v); } catch (e) { return '不是有效的地址'; }
    if (u.protocol !== 'https:') return '只接受 https:// 开头的地址';
    if (u.username || u.password) return '地址里不能带账号或密码';
    if (u.search || u.hash) return '地址里不能带查询参数或 #';
    return null;
  }

  /** 设置里的已下载列表：每个族一行（字重、大小、许可、是否有导出在用），以及总大小。 */
  function downloadedList(list, inUse) {
    const busy = new Set(inUse || []);
    const rows = list.filter((f) => f.faces && f.faces.length && f.source === 'google-fonts')
      .map((f) => ({family: f.family, st: f.st, faces: f.faces.slice().sort((a, b) => a - b), sizeBytes: f.sizeBytes,
        licence: f.licence, at: f.downloadedAt, inUse: busy.has(f.family)}))
      .sort((a, b) => a.family.localeCompare(b.family, 'en'));
    return {rows, totalBytes: rows.reduce((s, r) => s + r.sizeBytes, 0)};
  }

  /** 打开视频时的字体条：`job` 是这次要下载的族与各自的结果。返回要画什么；null 表示不画。
      - 进行中：「正在下载这个视频用到的字体 · 1/3 · 族名 42%」，可以跳过当前这个或全部取消；
      - 结束时全部到了：一句「字体已就绪」，过一会儿自己消失；
      - 有没取到的：「2 个字体没取到，正在用回退字体显示」，展开是族 → 回退字体与原因，每个可以重试；
      - 自动下载关着：「这个视频用到 2 个没下载的字体」，可以一次下载，或去设置。 */
  function openStrip(job, byName) {
    if (!job || job.dismissed) return null;
    const get = (n) => byName[n] || {family: n};
    const total = job.families.length;
    if (!total) return null;
    if (job.mode === 'off') {
      return {kind: 'off', title: '这个视频用到 ' + total + ' 个没下载的字体，正在用回退字体显示',
        rows: job.families.map((n) => ({family: n, fallback: fallbackFor(get(n)), reason: '自动下载已关闭'}))};
    }
    const settled = job.families.filter((n) => job.results[n]);
    const current = job.families.find((n) => !job.results[n]);
    if (current) {
      const f = get(current);
      return {kind: 'running', title: '正在下载这个视频用到的字体', count: (settled.length + 1) + '/' + total,
        current, progress: f.state === 'downloading' ? progressText(f.progress) : '等待中',
        value: f.state === 'downloading' ? progressValue(f.progress) : null};
    }
    const missed = job.families.filter((n) => job.results[n] !== 'ok');
    if (!missed.length) return {kind: 'ready', title: '这个视频用到的 ' + total + ' 个字体已就绪'};
    return {kind: 'missed', title: missed.length + ' 个字体没取到，正在用回退字体显示',
      rows: missed.map((n) => ({family: n, fallback: fallbackFor(get(n)), reason: reasonText(job.results[n], get(n))}))};
  }
  function reasonText(result, f) {
    if (result === 'skipped') return '已跳过';
    if (result === 'cancelled') return '已取消';
    return (f && f.error && f.error.message) || '下载失败';
  }

  /** 导出面板（视频页）关于字体的那一句：用到的族里还在下载的、失败的、没下载的（自动下载关着）。
      导出会先等在下载的；没取到的照回退字体画，导出结果里也有一条警告（`FONT_NOT_DOWNLOADED`）。 */
  function exportNote(list, inVideo, autoDownload) {
    const byName = {};
    list.forEach((f) => { byName[f.family] = f; });
    const used = (inVideo || []).map((n) => byName[n]).filter(Boolean);
    const pending = used.filter((f) => f.state === 'downloading');
    const failed = used.filter((f) => f.state === 'failed');
    const missing = used.filter((f) => f.state === 'downloadable');
    const names = (fs) => fs.map((f) => '「' + f.family + '」').join('');
    const lines = [];
    if (pending.length) lines.push({tone: 'info', families: pending.map((f) => f.family),
      text: names(pending) + '还在下载 · 导出会先等它下载完再开始画'});
    if (failed.length) lines.push({tone: 'notice', families: failed.map((f) => f.family), action: '重试',
      text: names(failed) + '没下载成功 · 会用' + failed.map((f) => '「' + fallbackFor(f) + '」').join('') + '代替导出'});
    /* 自动下载开着：导出开始时先下载（与「在下载的」一样等它），下载不成才用回退字体；关着：照回退字体导出 */
    if (missing.length && autoDownload) lines.push({tone: 'info', families: missing.map((f) => f.family), action: '现在下载',
      text: names(missing) + '还没下载 · 导出开始时先下载，下载不成就用回退字体'});
    else if (missing.length) lines.push({tone: 'notice', families: missing.map((f) => f.family), action: '下载',
      text: names(missing) + '没有下载（自动下载已关闭）· 会用回退字体导出'});
    return lines;
  }

  /** 还没结束的导出钉住的族（任务记录的 `fontPins`）：设置里删不掉、清空时留下。 */
  function exportPins(tasks) {
    const out = new Set();
    (tasks || []).forEach((t) => {
      if (t.kind === 'export' && (t.status === 'running' || t.status === 'queued')) (t.fontPins || []).forEach((n) => out.add(n));
    });
    return Array.from(out);
  }

  window.BC_FONTLIB = {STATE_LABEL, SOURCE_LABEL, LICENCE_LABEL, CATEGORIES, SCRIPTS, fmtBytes, progressText, progressValue,
    stateOf, statuses, order, orderKey, filter, sections, rowEnd, sampleText, fallbackFor, snapWeight, defaultFaces, mirrorError, downloadedList,
    openStrip, exportNote, exportPins};
})();
