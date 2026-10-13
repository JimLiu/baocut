/* 本机语义索引的状态与文案（embedding-integration-design §2.11、§2.12、§3.11；retrieval-spec v0.1 §11.5、§13.2）。
   App 与 Web 都加载：Web 不建索引，只显示 Runtime 的能力状态（§2.12），字幕面板的翻译记忆标记与术语不一致统计也读这里。
   · 状态：装了哪个包（none / text / full）、这台电脑支不支持、索引是否跟上（ready / stale）、是否暂停；
   · 每个入口自己说明状态（§2.11「每个入口自己说明状态」）：置灰或退回时一句原因 + 去设置的入口，不弹全局警告；
   · 完整性按通道分别写（「文字已就绪；画面 18/30 个素材完成」），不是一根 60% 的进度条（v0.1 §13.2）；
   · 翻译记忆的「沿用」与术语不一致（§2.6）。
   无 React、无 DOM，`node --test` 直接跑。 */
(function () {
  /* ---------- 状态 ---------- */
  /* half：上次安装没下完（2026-10-13 下载确认框）——{pkg, have: [已下好的部分 id], note: 失败那一句}；这时这个包仍算没装 */
  const DEFAULT = {install: 'text', platform: 'ok', index: 'ready', paused: false, tm: true, terms: true, half: null};
  /* 原型演示用的 URL 开关：`?semantic=none|stale|unsupported|ready|full`（写在 hash 前面） */
  const DEMO = {
    none: {install: 'none'},
    stale: {index: 'stale'},
    unsupported: {platform: 'unsupported', install: 'none'},
    ready: {},
    full: {install: 'full'},
  };
  function fromSearch(search) {
    const m = /[?&]semantic=([a-z]+)/.exec(String(search || ''));
    return m && DEMO[m[1]] ? Object.assign({}, DEFAULT, DEMO[m[1]]) : null;
  }

  /** 语义能力此刻能不能用；reason 是 v0.1 §11.5 的标准错误码，界面用它挑文案。 */
  function status(st) {
    const s = Object.assign({}, DEFAULT, st || {});
    if (s.platform === 'unsupported') return {usable: false, reason: 'UNSUPPORTED', stale: false, mode: 'lexical'};
    if (s.install === 'none') return {usable: false, reason: 'MODEL_NOT_INSTALLED', stale: false, mode: 'lexical'};
    if (s.paused) return {usable: true, reason: 'INDEX_PARTIAL', stale: true, mode: 'hybrid', paused: true};
    if (s.index === 'stale') return {usable: true, reason: 'INDEX_PARTIAL', stale: true, mode: 'hybrid'};
    return {usable: true, reason: null, stale: false, mode: 'hybrid'};
  }

  const STALE_NOTE = '索引更新中，结果可能不含最近的修改';
  const PAUSED_NOTE = '索引已暂停，结果可能不含最近的修改';
  const UNSUPPORTED_NOTE = '这台电脑暂不支持本机语义模型，精确文字搜索照常可用';

  /* 每个入口各写一句（§2.11）：not = 没装 / 不支持时；fallback = 退回的那条路。 */
  const ENTRY = {
    search:   {not: '没装本机语义模型，只按精确文字找了', fallback: '精确文字'},
    topic:    {not: '需要本机语义模型', fallback: '整篇 / 某一章'},
    terms:    {not: '只做了精确匹配：按术语表里记下的误听写法找', fallback: '精确匹配'},
    tm:       {not: '只沿用原文完全相同的句子', fallback: '精确匹配'},
    retakes:  {not: '只找了文字完全相同的重录', fallback: '完全相同的文字'},
    frames:   {not: '按时间取帧，未按内容挑选', fallback: '按出处时间取帧'},
    chapters: {not: '需要本机语义模型；由模型决定边界', fallback: '由模型决定'},
    shorts:   {not: '需要本机语义模型；不写主题时照常全片分析', fallback: '全片分析'},
    agent:    {not: '字面匹配', fallback: 'lexical'},
  };
  /** 一个入口此刻那一句：能用且不过期 → null；过期 → 不阻塞的提醒；不能用 → 原因（+ 去设置）。 */
  function entryNote(entry, st) {
    const s = status(st);
    const e = ENTRY[entry] || ENTRY.search;
    if (!s.usable) {
      return {tone: 'info', text: s.reason === 'UNSUPPORTED' && entry === 'search' ? UNSUPPORTED_NOTE : e.not,
        link: s.reason === 'UNSUPPORTED' ? null : '去设置', blocking: entry === 'topic' || entry === 'chapters'};
    }
    if (s.stale) return {tone: 'notice', text: s.paused ? PAUSED_NOTE : STALE_NOTE, link: null, blocking: false};
    return null;
  }

  /* ---------- 通道与完整性 ---------- */
  const CHANNELS = [
    {k: 'text', label: '讲话内容', short: '文字'},
    {k: 'visual', label: '画面', short: '画面', later: '这一版还没有画面索引；之后装好多模态搜索、按项目开启'},
    {k: 'audio', label: '声音', short: '声音', later: '这一版还没有声音索引；之后装好多模态搜索、按项目开启'},
  ];
  /** 包装了哪些通道：多模态包含文字（v0.1 §4.2：已装完整包时不再强制装文字包）。 */
  function channelsOf(install) {
    return install === 'full' ? ['text', 'visual', 'audio'] : install === 'text' ? ['text'] : [];
  }

  /** 一个范围的完整性（§2.11 / v0.1 §13.2）：按通道分别写。
      c.text = {done, total, pending?, none?}；c.visual / c.audio = {done, total} 或省略（没开 / 这一版没有）。 */
  function coverageLine(c) {
    const o = c || {};
    const parts = [];
    const t = o.text;
    if (t) {
      if (!t.total) parts.push('没有文稿，未建立文字索引');
      else if (t.done >= t.total) parts.push('文字已就绪');
      else {
        const why = [t.pending ? `${t.pending} 部还在转录` : null, t.none ? `${t.none} 部没有文稿` : null].filter(Boolean).join('、');
        parts.push(`文字 ${t.done}/${t.total} 部视频${why ? `（${why}）` : ''}`);
      }
    }
    ['visual', 'audio'].forEach((k) => {
      const v = o[k];
      if (!v) return;
      const name = k === 'visual' ? '画面' : '声音';
      parts.push(v.done >= v.total ? `${name}已就绪` : `${name} ${v.done}/${v.total} 个素材完成`);
    });
    if (o.later) parts.push('画面与声音这一版还没有索引');
    return parts.join('；');
  }
  /** 把若干项目的文字完整性加起来（Space 搜索的「全部项目」）。 */
  function sumText(list) {
    return (list || []).reduce((a, p) => ({done: a.done + (p.text.done || 0), total: a.total + (p.text.total || 0),
      pending: a.pending + (p.text.pending || 0), none: a.none + (p.text.none || 0)}), {done: 0, total: 0, pending: 0, none: 0});
  }

  function fmtBytes(n) {
    if (!n) return '0 MB';
    const mb = n / 1048576;
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
  }

  /* ---------- 翻译记忆与术语一致（§2.6） ---------- */
  /** 这一句是不是沿用的既有译文；`over` 是用户点了「改为重译」的那几句。 */
  function reusedFrom(tm, cardId, over) {
    if (!tm || (over && over[cardId])) return null;
    return (tm.reused || {})[cardId] || null;
  }
  /** 统计条上那一项：N 处术语不一致；fixed 是已经统一过的术语。 */
  function conflicts(tm, fixed) {
    const list = ((tm && tm.conflicts) || []).filter((c) => !(fixed && fixed[c.term]));
    return {n: list.reduce((s, c) => s + c.spots.length, 0), list};
  }
  /** 翻译工具参数页那一行：「参考了 N 句已有译文」；没装模型时只做精确匹配。 */
  /** to：目标语言代码。只数同一语言方向的已有译文（refsByLang 有这一项就用它，否则用 refs） */
  function tmLine(tm, st, to) {
    const s = status(st);
    const by = tm && tm.refsByLang;
    const n = (by && to && Object.prototype.hasOwnProperty.call(by, to) ? by[to] : tm && tm.refs) || 0;
    if (!s.usable) return `翻译记忆只做精确匹配：原文完全相同的句子沿用已有译文`;
    return n ? `参考了 ${n} 句已有译文（同一语言方向、你已有的视频）` : '没有找到可参考的已有译文';
  }

  const api = {DEFAULT, DEMO, fromSearch, status, entryNote, ENTRY, STALE_NOTE, PAUSED_NOTE, UNSUPPORTED_NOTE,
    CHANNELS, channelsOf, coverageLine, sumText, fmtBytes, reusedFrom, conflicts, tmLine};
  if (typeof window !== 'undefined') window.BC_SEMANTIC = api;
})();
