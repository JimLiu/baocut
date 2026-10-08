/* 剪成短视频（§15.12）纯模型：人给的参数、句子边界上的起止、候选的提醒、来源关系、
   短视频项目里「原片」卡的片段排布。不碰 DOM，不依赖 React；node --test 直接 require。

   三个词：
   - 句（sentence）：文稿里的一句，带起止时间。候选的起止只落在句子边界上，调起止一次挪一句。
     原型里一条 cue 就是一句；真产品用 transcript 的 Sentence 投影。
   - 候选（candidate）：`{id, from, to, start, end, title, reason, on, weak, loose, removed, focusX, redoOf}`，
     `from` / `to` 是句子下标（含两端），`start` / `end` 是原片时钟上的秒。
   - 片段（piece）：短视频项目时间轴上一段绑着原片的视频，`{id, start, end, in, out}`——
     `start` / `end` 在时间轴时钟，`in` / `out` 在原片时钟。

   长度一律用秒，不数字数：哪种语言的文稿都是同一条规则。 */
(function () {
  const COUNT = {min: 1, max: 10, def: 3};
  /** 找的时候比要的多找几段备选（裁决点 H）。 */
  const SPARE = 2;
  /** 与发布前检查 `duration` 同一条线（BC_SHORTS.MAX_DURATION）。 */
  const PLATFORM_MAX = 60;
  /** 候选与某支短视频用到的原片区间重叠超过这个比例，算「已切过」。 */
  const DONE_RATIO = 0.5;

  const LENGTHS = [
    {id: 'short', min: 15, max: 30, name: '15–30 秒'},
    {id: 'mid', min: 30, max: 60, name: '30–60 秒'},
    {id: 'long', min: 60, max: 90, name: '60–90 秒'},
  ];
  const FOCUS = [
    {id: 'speaker', name: '跟着说话的人', desc: '本机模型认人，谁说话框跟谁', needs: ['person', 'speaker']},
    {id: 'center', name: '居中', desc: '裁画面正中，最快，不用本机模型'},
    {id: 'manual', name: '我自己定', desc: '挑片段时在原片上拖取景框，每支定一个位置'},
  ];
  const TRACKS = [
    {id: 'both', name: '原文 + 译文'},
    {id: 'orig', name: '只要原文'},
    {id: 'trans', name: '只要译文'},
  ];
  const STYLES = [
    {id: 'shorts', name: '短视频字幕', desc: '内置预设，避开平台按钮'},
    {id: 'project', name: '沿用这部视频的样式', desc: '字号和位置照搬，可能被平台按钮挡住'},
  ];
  const DEFAULTS = {count: COUNT.def, length: 'mid', focus: 'speaker', tracks: 'both', style: 'shorts',
    note: '', scope: 'all', skipDone: true, hook: true, crossChapter: false};
  const FIND_STAGES = ['读文稿', '找片段', '核对起止'];
  const CREATE_STAGES = ['切文稿', '套字幕样式', '取景', '发布前检查'];

  const lengthOf = (id) => LENGTHS.find((l) => l.id === id) || LENGTHS[1];
  const focusOf = (id) => FOCUS.find((f) => f.id === id) || FOCUS[0];
  const clampCount = (n) => (Number.isFinite(+n) && n !== '' && n != null
    ? Math.max(COUNT.min, Math.min(COUNT.max, Math.round(+n))) : COUNT.def);

  /** 参数落到这个项目上：没有译文就只有原文；原片本来就是竖屏就不用取景。
      取景缺省跟着说话的人，缺本机模型也不替人改选——模型门在主按钮上（下载并开始）。 */
  function normalize(params, ctx) {
    const c = ctx || {};
    const p = Object.assign({}, DEFAULTS, params);
    p.count = clampCount(p.count);
    p.length = lengthOf(p.length).id;
    if (!c.hasTrans) p.tracks = 'orig';
    else if (!TRACKS.some((t) => t.id === p.tracks)) p.tracks = 'both';
    if (c.portrait) p.focus = 'center';
    else if (!FOCUS.some((f) => f.id === p.focus)) p.focus = DEFAULTS.focus;
    if (!c.children) p.skipDone = DEFAULTS.skipDone;
    return p;
  }

  /* ---------- 时间 ---------- */
  function mmss(t) {
    const s = Math.max(0, Math.round(t || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  const secs = (t) => Math.max(0, Math.round(t || 0)) + ' 秒';
  const spanText = (a) => `${mmss(a.start)} – ${mmss(a.end)} · ${secs(a.end - a.start)}`;
  const overlapSec = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

  /* ---------- 句子边界 ---------- */
  const EPS = 0.02;
  function nearest(list, t, key) {
    let best = 0, d = Infinity;
    list.forEach((s, i) => { const x = Math.abs(s[key] - t); if (x < d) { d = x; best = i; } });
    return best;
  }
  /** 压在 t 上的那一句；t 在两句之间或片尾之外时取最近的。 */
  function indexAt(sentences, t) {
    const i = sentences.findIndex((s) => t >= s.start - EPS && t < s.end - EPS);
    if (i >= 0) return i;
    return t < (sentences[0] || {start: 0}).start ? 0 : nearest(sentences, t, 'end');
  }
  function rangeOf(sentences, from, to) {
    const n = sentences.length;
    const a = Math.max(0, Math.min(n - 1, from));
    const b = Math.max(a, Math.min(n - 1, to));
    return {from: a, to: b, start: sentences[a].start, end: sentences[b].end};
  }
  /** 模型给的时间吸附到最近的句首 / 句尾；起点不会落到终点之后。 */
  function snap(sentences, start, end) {
    const from = nearest(sentences, start, 'start');
    const to = Math.max(from, nearest(sentences, end, 'end'));
    return rangeOf(sentences, from, to);
  }
  /** 挪一句。`edge` 'start' | 'end'，`dir` -1 往前、+1 往后。挪不动（到头、会把这一段挪没）原样返回。
      挪过的那一端不再算「落在句中」。 */
  function nudge(sentences, seg, edge, dir) {
    if (!canNudge(sentences, seg, edge, dir)) return seg;
    const r = edge === 'start' ? rangeOf(sentences, seg.from + dir, seg.to) : rangeOf(sentences, seg.from, seg.to + dir);
    const loose = Object.assign({}, seg.loose, {[edge]: false});
    const out = Object.assign({}, seg, r, {loose, edited: true});
    // 另一端若本来就落在句中，它的时间不跟着句子边界走
    if (edge === 'start' && seg.loose && seg.loose.end) out.end = seg.end;
    if (edge === 'end' && seg.loose && seg.loose.start) out.start = seg.start;
    return out;
  }
  function canNudge(sentences, seg, edge, dir) {
    if (!seg || (dir !== 1 && dir !== -1)) return false;
    if (edge === 'start') return dir < 0 ? seg.from > 0 : seg.from < seg.to;
    if (edge === 'end') return dir > 0 ? seg.to < sentences.length - 1 : seg.to > seg.from;
    return false;
  }
  /** 拖原片条上一段的两端：吸附到句子边界，至少留一句。 */
  function dragEdge(sentences, seg, edge, t) {
    const r = edge === 'start'
      ? rangeOf(sentences, Math.min(seg.to, nearest(sentences, t, 'start')), seg.to)
      : rangeOf(sentences, seg.from, Math.max(seg.from, nearest(sentences, t, 'end')));
    return Object.assign({}, seg, r, {loose: Object.assign({}, seg.loose, {[edge]: false}), edited: true});
  }

  /* ---------- 来源关系 ---------- */
  const isChild = (p) => !!(p && p.origin && p.origin.project);
  /** 父 → 子是反查出来的（裁决点 A）：来源项目自己不记。 */
  function childrenOf(projects, id) {
    return (projects || []).filter((p) => isChild(p) && p.origin.project === id && !p.archived)
      .sort((a, b) => a.origin.in - b.origin.in);
  }
  const parentOf = (projects, proj) => (isChild(proj) ? (projects || []).find((p) => p.id === proj.origin.project) || null : null);
  /** 这一支现在用到的原片区间。`used` 是编辑后的现状，没有就是切出时的那一段。 */
  function usedRanges(proj) {
    if (!isChild(proj)) return [];
    const list = proj.used && proj.used.length ? proj.used : [{in: proj.origin.in, out: proj.origin.out}];
    return list.map((r) => ({start: r.in, end: r.out}));
  }
  /** 项目卡 / 行上的来源徽标。 */
  function originLabel(projects, proj) {
    if (!isChild(proj)) return null;
    const parent = parentOf(projects, proj);
    const span = `${mmss(proj.origin.in)} – ${mmss(proj.origin.out)}`;
    return parent
      ? {missing: false, parent, text: `来自「${parent.title}」· ${span}`, short: `来自「${parent.title}」`}
      : {missing: true, parent: null, text: '来源视频已不在视频库', short: '来源视频已不在视频库'};
  }
  const countLabel = (n) => `${n} 支短视频`;
  /** 候选被哪一支短视频切过（重叠超过候选时长的一半）。 */
  function doneBy(seg, children) {
    const dur = seg.end - seg.start;
    if (!(dur > 0)) return null;
    return (children || []).find((c) => usedRanges(c).reduce((n, r) => n + overlapSec(seg, r), 0) > dur * DONE_RATIO) || null;
  }
  /** 删除来源项目时确认框里多的那一句。 */
  const deleteNote = (n) => (n > 0
    ? `它切出的 ${n} 支短视频不受影响，仍可打开和导出，只是不能再从原片添加片段。` : '');

  /* ---------- 候选的提醒 ---------- */
  /** 固定次序：已切过 → 平台时长 → 比要的长 / 短 → 重叠 → 要靠前文 → 译文 → 落在句中。
      `ctx`：`{params, list（全部候选，按原片先后）, children, sentences}`。重叠只和**勾上的**别的候选比。 */
  function flags(seg, ctx) {
    const c = ctx || {};
    const p = c.params || DEFAULTS;
    const len = lengthOf(p.length);
    const dur = seg.end - seg.start;
    const out = [];
    /* 重做的是哪一支写在「为什么挑它」那一行，小牌只说后果（小牌不折行，写不下标题） */
    if (seg.redoOf) out.push({k: 'redo', tone: 'accent', text: '重做 · 另建一支，原来那支不动'});
    const done = doneBy(seg, (c.children || []).filter((k) => k.id !== seg.redoOf));
    if (done) out.push({k: 'done', tone: 'notice', text: `已切过 · 「${done.title}」`});
    if (dur > PLATFORM_MAX + 0.5) out.push({k: 'over60', tone: 'notice', text: `超过 ${PLATFORM_MAX} 秒，部分平台不按 Shorts 推`});
    if (Math.round(dur - len.max) >= 1) out.push({k: 'long', tone: 'neutral', text: `比你要的长 ${Math.round(dur - len.max)} 秒`});
    else if (Math.round(len.min - dur) >= 1) out.push({k: 'short', tone: 'neutral', text: `比你要的短 ${Math.round(len.min - dur)} 秒`});
    const list = (c.list || []).filter((x) => !x.removed);
    list.forEach((x, i) => {
      if (x.id === seg.id || !x.on) return;
      const o = Math.round(overlapSec(seg, x));
      if (o >= 1) out.push({k: 'overlap', tone: 'notice', text: `和第 ${i + 1} 段重叠 ${o} 秒`});
    });
    if (seg.weak) out.push({k: 'context', tone: 'neutral', text: '要靠前文才听得懂'});
    if (p.tracks !== 'orig' && c.sentences
      && c.sentences.slice(seg.from, seg.to + 1).some((s) => !s.trans)) out.push({k: 'untranslated', tone: 'notice', text: '这几句还没有译文'});
    if (seg.loose && seg.loose.start) out.push({k: 'mid-start', tone: 'notice', text: '起点落在一句话中间'});
    if (seg.loose && seg.loose.end) out.push({k: 'mid-end', tone: 'notice', text: '终点落在一句话中间'});
    return out;
  }

  /* ---------- 候选列表 ---------- */
  const byTime = (list) => list.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const visible = (list) => byTime((list || []).filter((c) => !c.removed));
  const chosen = (list) => visible(list).filter((c) => c.on);
  const totalSec = (list) => chosen(list).reduce((n, c) => n + (c.end - c.start), 0);
  function pickHeadline(list, preselected) {
    const n = visible(list).length, on = chosen(list).length;
    return preselected
      ? `找到 ${n} 段，先替你选了 ${on} 段 · 合计 ${mmss(totalSec(list))}`
      : `${n} 段候选，勾了 ${on} 段 · 合计 ${mmss(totalSec(list))}`;
  }
  const createLabel = (n) => (n > 0 ? `创建 ${n} 支短视频` : '创建短视频');
  const hookOf = (sentences, seg) => (sentences[seg.from] || {}).text || '';
  const tailOf = (sentences, seg) => (sentences[seg.to] || {}).text || '';
  /** 按把握的先后替用户勾：不勾要靠前文的、已切过的、和已勾的重叠的，勾满要的条数为止。 */
  function preselect(list, count, children) {
    const on = [];
    return list.map((c) => {
      const ok = on.length < count && !c.weak && !doneBy(c, children) && !on.some((x) => overlapSec(x, c) >= 1);
      if (ok) on.push(c);
      return Object.assign({}, c, {on: ok});
    });
  }

  /* 演示的候选：起点是句子下标，`n` 是「30–60 秒」那一档下的句数，别的档按比例伸缩。
     次序就是把握的先后。真产品里这张表由模型或 Agent 给出，这里只为原型可复现。 */
  const DEMO = [
    {k: 'a', at: 4, n: 10, title: '为什么要把视频工具做在本机', reason: '以一个问题开头，三句之内给出回答'},
    {k: 'c', at: 26, n: 10, title: '上传本身就是一个决定', reason: '开头一句就是结论，后面是理由'},
    {k: 'd', at: 37, n: 12, title: '字幕为什么是单独的一层', reason: '一个观点讲完整，中间有一句可以单独引用'},
    {k: 'f', at: 17, n: 9, title: '词是真相，句子只是投影', reason: '开头一句就能单独引用'},
    {k: 'b', at: 11, n: 12, title: '渲染最难的是确定性', reason: '有例子，结尾落在一句结论上'},
    {k: 'e', at: 50, n: 11, title: '每个小改动都要三次签字', reason: '有故事，但开头那句在接前面的话', weak: true},
    {k: 'g', at: 56, n: 6, title: '像是把编译器那套搬过来了', reason: '一问一答，收得干净'},
  ];
  const SCALE = {short: 0.5, mid: 1, long: 1.9};
  function demoPool(sentences, params, scope) {
    const p = Object.assign({}, DEFAULTS, params);
    const k = SCALE[lengthOf(p.length).id];
    const lo = scope ? scope.start : -Infinity, hi = scope ? scope.end : Infinity;
    return DEMO.filter((d) => d.at < sentences.length && sentences[d.at].start >= lo - EPS && sentences[d.at].start < hi - EPS)
      .map((d) => {
        let to = Math.min(sentences.length - 1, d.at + Math.max(2, Math.round(d.n * k)) - 1);
        if (scope && !p.crossChapter) while (to > d.at && sentences[to].end > hi + EPS) to--;
        return Object.assign({id: 'sc-' + d.k, title: d.title, reason: d.reason, weak: !!d.weak, on: false}, rangeOf(sentences, d.at, to));
      });
  }
  /** 第一轮：要 n 支就找 n + SPARE 段；开着「已经切过的不再找」时切过的不进候选。 */
  function demoCandidates(sentences, params, o) {
    const c = o || {};
    const p = Object.assign({}, DEFAULTS, params);
    const pool = demoPool(sentences, p, c.scope).filter((x) => !(p.skipDone && doneBy(x, c.children)));
    return byTime(preselect(pool.slice(0, clampCount(p.count) + SPARE), clampCount(p.count), c.children));
  }
  /** 再找几段：把还没出现过的接在后面，不勾。找不到返回空表。 */
  function demoMore(sentences, params, list, o) {
    const c = o || {};
    const p = Object.assign({}, DEFAULTS, params);
    const have = new Set((list || []).map((x) => x.id));
    return demoPool(sentences, p, c.scope)
      .filter((x) => !have.has(x.id) && !(p.skipDone && doneBy(x, c.children))).slice(0, SPARE)
      .map((x) => Object.assign(x, {added: 'more'}));
  }
  /** 自己加一段：有选区用选区（不吸附，落在句中的带提醒），没有就从播放头那一句起凑到这一档的中间长度。 */
  function manualCandidate(sentences, o) {
    const id = o.id || 'sc-m' + Math.round((o.t || (o.range && o.range.start) || 0) * 100);
    if (o.range && o.range.end > o.range.start) {
      const from = indexAt(sentences, o.range.start), to = Math.max(from, indexAt(sentences, o.range.end - EPS * 2));
      const loose = {start: Math.abs(sentences[from].start - o.range.start) > EPS, end: Math.abs(sentences[to].end - o.range.end) > EPS};
      return {id, from, to, start: o.range.start, end: o.range.end, loose,
        title: o.title || hookOf(sentences, {from}), reason: '你自己选的区间', on: true, added: 'manual'};
    }
    const len = lengthOf((o.params || DEFAULTS).length);
    const from = indexAt(sentences, o.t || 0);
    let to = from;
    while (to < sentences.length - 1 && sentences[to].end - sentences[from].start < (len.min + len.max) / 2) to++;
    return Object.assign({id, title: o.title || hookOf(sentences, {from}), reason: '你自己加的，从播放头那一句起', on: true, added: 'manual'},
      rangeOf(sentences, from, to));
  }

  /* ---------- 创建 ---------- */
  function childTitle(title, taken) {
    const base = String(title || '').trim() || '未命名短视频';
    const used = new Set(taken || []);
    if (!used.has(base)) return base;
    let i = 2;
    while (used.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }
  /** 短视频项目的记录：引用来源项目的同一份原片，只记起止，不复制视频。 */
  function childProject(o) {
    const parent = o.parent, seg = o.seg, p = Object.assign({}, DEFAULTS, o.params);
    return {
      id: o.id, title: o.title, status: 'complete', entry: parent.entry || 'trans', bare: true,
      delivery: 'shorts', ratio: '9:16',
      origin: {project: parent.id, in: seg.start, out: seg.end},
      cut: {focus: p.focus, focusX: seg.focusX == null ? null : seg.focusX, tracks: p.tracks, style: p.style},
      src: Object.assign({}, parent.src),
      duration: +(seg.end - seg.start).toFixed(2), lang: parent.lang, model: parent.model,
      modified: '刚刚', mtime: 0, otime: 0, ctime: 0, hue: parent.hue,
      desc: `从「${parent.title}」切出的短视频，${mmss(seg.start)} – ${mmss(seg.end)}。`,
      content: {}, meta: {speakers: o.speakers || 1, chapters: 1, cues: seg.to - seg.from + 1},
    };
  }
  /** 发布前检查在完成页上的一句话（只有时长这一条在创建时就判得了）。 */
  function checkLine(seg) {
    const dur = Math.round(seg.end - seg.start);
    return dur > PLATFORM_MAX
      ? {tone: 'notice', text: `1 项要看一眼 · 时长 ${dur} 秒`}
      : {tone: 'positive', text: '能查的都过了'};
  }

  /* ---------- 文案 ---------- */
  function summaryLine(params) {
    const p = Object.assign({}, DEFAULTS, params);
    return [`${p.count} 支`, `每支 ${lengthOf(p.length).name}`, focusOf(p.focus).name].join(' · ');
  }
  const lengthNote = (id) => (lengthOf(id).max > PLATFORM_MAX ? `超过 ${PLATFORM_MAX} 秒，部分平台不按 Shorts 推` : '');
  /** 交给 Agent 时接在意图后面的几句（BC_AGENT.intentPrompt 的 extra）。 */
  function agentExtra(params, o) {
    const c = o || {};
    const p = Object.assign({}, DEFAULTS, params);
    const len = lengthOf(p.length);
    const out = [`要 ${p.count} 支，每支 ${len.min}–${len.max} 秒，起止落在句子边界上`];
    if (c.scopeName) out.push(`只在「${c.scopeName}」里找`);
    if (String(p.note || '').trim()) out.push(`我想要的：${String(p.note).trim()}`);
    if (p.hook) out.push('每段从一句能单独成立的话起');
    if (c.children && p.skipDone) out.push(`已经切过的 ${c.children} 支不用再找`);
    out.push(`多找 ${SPARE} 段备选，每段给标题和一句理由，写进候选库让我在「剪成短视频」面板里挑；我确认之前不要创建视频`);
    return out;
  }
  const taskTitle = (title) => `剪成短视频 · ${title}`;
  function stageAt(stages, pct) {
    return Math.min(stages.length - 1, Math.floor((Math.max(0, Math.min(99.9, pct)) / 100) * stages.length));
  }
  /** AI 工具列表里那张卡的副题。 */
  function listStatus(s, fallback, children) {
    const tail = children ? ` · 已有 ${children} 支` : '';
    if (!s || s.phase === 'setup') return fallback + tail;
    if (s.phase === 'finding') return `正在找片段 · ${Math.round(s.pct || 0)}%`;
    if (s.phase === 'review') return `找到 ${visible(s.list).length} 段 · 等你挑`;
    if (s.phase === 'creating') return `正在创建 ${s.made ? s.made.length : chosen(s.list).length} 支 · ${Math.round(s.pct || 0)}%`;
    if (s.phase === 'done') return `已创建 ${s.made.length} 支`;
    return fallback + tail;
  }

  /* ---------- 取景与字幕预览（挑片段的舞台） ---------- */
  const OUT_RATIO = 9 / 16;
  /** 取景窗在原片上的大小（占原片宽高的比例）：原片比 9:16 宽就裁左右，比它窄就裁上下。 */
  function focusSize(srcRatio) {
    const r = srcRatio > 0 ? srcRatio : 16 / 9;
    return r >= OUT_RATIO ? {w: OUT_RATIO / r, h: 1} : {w: 1, h: r / OUT_RATIO};
  }
  /** 取景窗的横向中心夹在原片里。 */
  function clampFocus(x, srcRatio) {
    const half = focusSize(srcRatio).w / 2;
    const v = Number.isFinite(+x) && x != null ? +x : 0.5;
    return Math.min(1 - half, Math.max(half, v));
  }
  /** `偏左 18%` / `偏右 6%` / `居中`：取景窗中心离画面正中多远（占原片宽）。 */
  function focusText(x) {
    if (x == null) return '居中';
    const d = Math.round((x - 0.5) * 100);
    return d === 0 ? '居中' : d < 0 ? `偏左 ${-d}%` : `偏右 ${d}%`;
  }
  const REVIEW_FIELDS = ['start', 'end', 'from', 'to', 'loose', 'focusX'];
  const reviewBounds = (c) => Object.fromEntries(REVIEW_FIELDS.map((k) => [k, c[k]]));
  const sameBounds = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function reviewRecord(s, before, after) {
    const a = reviewBounds(before), b = reviewBounds(after);
    if (sameBounds(a, b)) return {};
    return {undoHistory: (s.undoHistory || []).slice(-99).concat([{id: before.id, before: a, after: b}]), redoHistory: []};
  }
  function reviewCanStep(s, redo) {
    const stack = (redo ? s.redoHistory : s.undoHistory) || [], e = stack[stack.length - 1];
    const c = e && s.list.find((c) => c.id === e.id && !c.made && !c.removed);
    return !!c && sameBounds(reviewBounds(c), redo ? e.before : e.after);
  }
  function reviewStep(s, redo) {
    if (!reviewCanStep(s, redo)) return {};
    const from = redo ? 'redoHistory' : 'undoHistory', to = redo ? 'undoHistory' : 'redoHistory';
    const stack = s[from], e = stack[stack.length - 1], bounds = redo ? e.after : e.before;
    return {[from]: stack.slice(0, -1), [to]: (s[to] || []).concat([e]),
      list: s.list.map((c) => c.id === e.id ? {...c, ...bounds} : c), sel: e.id, expand: e.id, t: bounds.start, playing: false};
  }
  function setReviewEdge(sentences, c, edge, time, duration) {
    if (!Number.isFinite(time) || time < 0 || time > duration) return null;
    const next = {...c, [edge]: time};
    if (next.end - next.start < 0.1 || !sentences.length) return null;
    next.from = indexAt(sentences, next.start); next.to = Math.max(next.from, indexAt(sentences, next.end - EPS * 2));
    next.loose = {...c.loose, [edge]: Math.abs((edge === 'start' ? sentences[next.from].start : sentences[next.to].end) - time) > 1e-9};
    return next;
  }
  function reviewCueAt(cues, t) {
    let lo = 0, hi = cues.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (cues[mid].start <= t) lo = mid + 1; else hi = mid; }
    const cue = cues[lo - 1]; return cue && t < cue.end ? cue : null;
  }
  /** 这一刻取景窗的横向中心。`speakerX` 是「说话人 id → 他在画面里的横向位置」，认不出时退到正中。 */
  function focusAt(params, seg, sentence, speakerX, srcRatio, fallbackX) {
    const p = Object.assign({}, DEFAULTS, params);
    let x = 0.5;
    if (p.focus === 'manual') x = seg && seg.focusX != null ? seg.focusX : 0.5;
    else if (p.focus === 'speaker' && sentence && speakerX && speakerX[sentence.sp] != null) x = speakerX[sentence.sp];
    else if (p.focus === 'speaker' && fallbackX != null) x = fallbackX;
    return clampFocus(x, srcRatio);
  }
  /** 示意轨迹：停顿沿用此前的人，片头看下一位；没有台词线索时先取可见人物。
      App 使用真实视听轨迹，此处不把出场顺序当成人脸身份识别。 */
  function contextFocus(sentences, t, speakerX, subjects) {
    let previous = null;
    for (const sentence of sentences || []) {
      const x = speakerX && speakerX[sentence.sp];
      if (x == null) continue;
      if (sentence.start <= t) previous = x;
      else return previous == null ? x : previous;
    }
    if (previous != null) return previous;
    const person = (subjects || []).find((s) => s.kind === 'person');
    return person ? person.x : null;
  }
  /** 说话人按出场先后轮流对到画面里的人。 */
  function speakerMap(sentences, subjects) {
    const people = (subjects || []).filter((x) => x.kind === 'person');
    const out = {};
    if (!people.length) return out;
    let n = 0;
    (sentences || []).forEach((c) => { if (c.sp != null && out[c.sp] == null) out[c.sp] = people[n++ % people.length].x; });
    return out;
  }
  /** 成片预览里字幕的落位（占 9:16 画面的百分比）与要画的行。`safe` 是平台安全区（BC_SHORTS.SAFE）。 */
  function captionSpec(params, sentence, safe) {
    const p = Object.assign({}, DEFAULTS, params);
    const z = safe || {bottom: 24, side: 6, right: 18};
    const shorts = p.style === 'shorts';
    const lines = [];
    if (sentence) {
      if (p.tracks !== 'trans' && sentence.text) lines.push({k: 'orig', text: sentence.text});
      if (p.tracks !== 'orig' && sentence.trans) lines.push({k: 'trans', text: sentence.trans});
    }
    const width = shorts ? 2 * Math.min(50 - z.side, 100 - z.right - 50) - 4 : 84;
    const bottom = shorts ? 100 - z.bottom - 2 : 86;
    return {lines, width, bottom, fontPct: shorts ? 5.5 : 2.3, blocked: bottom > 100 - z.bottom};
  }

  /** 短视频项目打开时画面上的字幕轨：创建时选了哪几轨就留哪几轨；选了「短视频字幕」就按平台安全区落位。
      `layout` 是绑好画幅的 `BC_SHORTS.captionLayout`（轨 → {id: 几何}），与发布前检查同一份几何。
      没有 `cut`（不是从这里切出来的项目）原样返回。 */
  function openTracks(cut, tracks, layout) {
    const list = tracks || [];
    if (!cut) return list;
    const kept = list.filter((t) => (cut.tracks === 'orig' ? t.role === 'source' : cut.tracks === 'trans' ? t.role !== 'source' : true));
    if (cut.style !== 'shorts' || !layout) return kept;
    const geo = layout(kept) || {};
    return kept.map((t) => (geo[t.id] ? Object.assign({}, t, geo[t.id]) : t));
  }

  /* ---------- 短视频项目里的「原片」卡 ---------- */
  /** 时间轴上绑着原片的视频元素 → 片段（按时间轴先后）。 */
  function piecesOf(elements) {
    return (elements || []).filter((e) => e.kind === 'video' && e.fromSource && !e.hidden && e.end != null)
      .map((e) => ({id: e.id, start: e.start, end: e.end, in: e.srcStart || 0, out: (e.srcStart || 0) + (e.end - e.start) * (e.rate || 1)}))
      .sort((a, b) => a.start - b.start);
  }
  /** 多留一句：前面（'before'）取结束在 `in` 之前的那一句，后面（'after'）取开始在 `out` 之后的那一句；
      片段的边落在句中时先补齐那半句。到原片头尾、没有句子可留时返回 null。 */
  function extendRange(sentences, piece, side) {
    if (side === 'before') {
      const s = sentences.slice().reverse().find((x) => x.start < piece.in - EPS);
      return s ? {in: s.start, out: piece.in, at: piece.start, sentence: s} : null;
    }
    const s = sentences.find((x) => x.end > piece.out + EPS);
    return s ? {in: piece.out, out: s.end, at: piece.end, sentence: s} : null;
  }
  /** 原片 [in, out) 里的句子搬到时间轴 `at` 处；压在区间边上的句子按区间截短。 */
  function cuesIn(sentences, range, at, tag) {
    return sentences.filter((s) => overlapSec(s, {start: range.in, end: range.out}) > EPS)
      .map((s) => Object.assign({}, s, {
        id: tag ? `${s.id}@${tag}` : s.id, srcId: s.id,
        start: +(at + Math.max(s.start, range.in) - range.in).toFixed(2),
        end: +(at + Math.min(s.end, range.out) - range.in).toFixed(2),
      }));
  }
  /** 在时间轴 `at` 处插进原片的一段：后面的字幕顺延，新字幕补进来。同一句用第二次时 id 带后缀。 */
  function insertCues(cues, sentences, range, at, tag) {
    const d = range.out - range.in;
    const shifted = (cues || []).map((c) => (c.start >= at - EPS
      ? Object.assign({}, c, {start: +(c.start + d).toFixed(2), end: +(c.end + d).toFixed(2)}) : c));
    const ids = new Set(shifted.map((c) => c.id));
    const fresh = cuesIn(sentences, range, at).map((c) => (ids.has(c.id) ? Object.assign({}, c, {id: `${c.id}@${tag || 'r'}`}) : c));
    return shifted.concat(fresh).sort((a, b) => a.start - b.start);
  }
  /** 多留一句对各片段的改动：`[{id, start, end, in}]`（只列变了的）。 */
  function extendPatches(pieces, id, side, range) {
    const d = range.out - range.in;
    const i = pieces.findIndex((p) => p.id === id);
    if (i < 0) return [];
    return pieces.map((p, k) => {
      if (k < i) return null;
      if (k === i) return {id: p.id, start: p.start, end: +(p.end + d).toFixed(2), in: side === 'before' ? range.in : p.in};
      return {id: p.id, start: +(p.start + d).toFixed(2), end: +(p.end + d).toFixed(2), in: p.in};
    }).filter(Boolean);
  }
  /** 「播放头处」落到哪条缝：播放头压在片段中间时放到这一段后面，不把它劈开。 */
  function insertPoint(pieces, where, t) {
    const last = pieces.length ? pieces[pieces.length - 1].end : 0;
    if (where !== 'playhead') return last;
    const hit = pieces.find((p) => t >= p.start - EPS && t < p.end - EPS);
    if (hit) return t - hit.start < EPS * 2 ? hit.start : hit.end;
    const next = pieces.find((p) => p.start >= t - EPS);
    return next ? next.start : last;
  }
  /** 再加一段对已有片段的改动（在 `at` 之后的顺延）。 */
  function shiftPatches(pieces, at, d) {
    return pieces.filter((p) => p.start >= at - EPS)
      .map((p) => ({id: p.id, start: +(p.start + d).toFixed(2), end: +(p.end + d).toFixed(2), in: p.in}));
  }
  /** 对话框里点首尾两句选出的连续区间。 */
  function selection(sentences, a, b) {
    if (a == null) return null;
    const r = rangeOf(sentences, Math.min(a, b == null ? a : b), Math.max(a, b == null ? a : b));
    return Object.assign(r, {in: r.start, out: r.end, count: r.to - r.from + 1, text: `已选 ${r.to - r.from + 1} 句 · ${secs(r.end - r.start)}`});
  }
  /** 这一支已经用到的句子（一半以上落在某个片段里）。 */
  function usedIds(sentences, pieces) {
    const out = new Set();
    sentences.forEach((s) => {
      const hit = (pieces || []).reduce((n, p) => n + overlapSec(s, {start: p.in, end: p.out}), 0);
      if (hit > (s.end - s.start) * 0.5) out.add(s.id);
    });
    return out;
  }
  /** 原片条上的色块：百分比。 */
  function bar(ranges, dur) {
    return (ranges || []).map((r) => ({
      left: +(Math.max(0, r.start) / dur * 100).toFixed(3),
      width: +(Math.max(0, Math.min(dur, r.end) - Math.max(0, r.start)) / dur * 100).toFixed(3),
    }));
  }
  /** 来源卡「用到的片段」逐段一行：原片里的起止、开头那一句、两头还能不能多留一句。 */
  function pieceRows(sentences, pieces) {
    return (pieces || []).map((p, i) => {
      const first = (sentences || []).find((x) => overlapSec(x, {start: p.in, end: p.out}) > EPS);
      return {
        id: p.id, n: i + 1, at: p.start, span: spanText({start: p.in, end: p.out}), hook: first ? first.text : '',
        before: extendRange(sentences || [], p, 'before'), after: extendRange(sentences || [], p, 'after'),
      };
    });
  }
  /** 多留一句 / 再加一段之后，时间轴上别的元素跟着顺延：`at` 之后开始的整块后移，片段自己与铺满全片的不动。 */
  function ripplePatches(elements, at, d, skip) {
    const out = [];
    (elements || []).forEach((e) => {
      if ((skip || []).indexOf(e.id) >= 0 || e.fromSource || e.endAnchor) return;
      if (typeof e.start !== 'number' || typeof e.end !== 'number' || e.start < at - EPS) return;
      out.push({id: e.id, start: +(e.start + d).toFixed(2), end: +(e.end + d).toFixed(2)});
    });
    return out;
  }
  /** 「从原片添加片段」对话框的行：章节头也算一行，行高固定，列表按行数虚拟化。 */
  const ROW_H = 32;
  function sourceRows(sentences, chapters) {
    const heads = (chapters || []).slice().sort((a, b) => a.start - b.start);
    const rows = [];
    let cur = -1;
    (sentences || []).forEach((s, i) => {
      let k = cur;
      while (k + 1 < heads.length && s.start >= heads[k + 1].start - EPS) k += 1;
      if (k !== cur) { cur = k; rows.push({head: true, id: 'h:' + heads[k].id, title: heads[k].title, at: heads[k].start}); }
      rows.push({head: false, id: s.id, index: i, sentence: s});
    });
    return rows;
  }
  function rowWindow(count, top, height, rowH) {
    const h = rowH > 0 ? rowH : ROW_H;
    const n = Math.max(0, Math.floor(count || 0));
    const start = Math.min(n, Math.max(0, Math.floor(Math.max(0, top || 0) / h) - 4));
    const end = Math.min(n, Math.max(start, Math.ceil((Math.max(0, top || 0) + Math.max(0, height || 0)) / h) + 4));
    return {start, end, height: n * h};
  }
  /** `used` 与片段现状是不是一回事（一样就不写回）。 */
  const sameUsed = (proj, pieces) => JSON.stringify(usedRanges(proj).map((r) => [+r.start.toFixed(2), +r.end.toFixed(2)]))
    === JSON.stringify((pieces || []).map((x) => [+x.in.toFixed(2), +x.out.toFixed(2)]));
  /** 项目记录里的现状：片段变了以后写回 `used`。 */
  const usedFrom = (pieces) => pieces.map((p) => ({in: +p.in.toFixed(2), out: +p.out.toFixed(2)}));

  /* ---------- 来源项目视频 Tab 里「切出的短视频」那一组 ----------
     来源项目自己不记切出过什么（裁决点 A），这一组是从项目库反查出来的，按在原片里的先后排。 */
  const MADE_ROW_H = 64;
  /** 组里一次最多露出几行，多的在组里滚。 */
  const MADE_SHOWN = 4;
  const tracksOf = (id) => TRACKS.find((t) => t.id === id) || TRACKS[0];
  /** 这一支切出之后在编辑器里动过起止没有：现状和切出时的那一段不是一回事。 */
  function editedSince(proj) {
    if (!isChild(proj)) return false;
    const r = usedRanges(proj);
    return r.length !== 1 || Math.abs(r[0].start - proj.origin.in) > EPS || Math.abs(r[0].end - proj.origin.out) > EPS;
  }
  /** 创建时的选择念成一句：取景 · 字幕轨。没有记录（老项目）给空串。 */
  function cutLine(cut) {
    if (!cut) return '';
    return [focusOf(cut.focus).name, tracksOf(cut.tracks).name].join(' · ');
  }
  /** 组头：几支、合计多长（按现状）。 */
  function madeHead(children) {
    const list = children || [];
    const total = list.reduce((n, k) => n + usedRanges(k).reduce((a, r) => a + (r.end - r.start), 0), 0);
    return {count: list.length, total, text: `${list.length} 支 · 合计 ${mmss(total)}`};
  }
  /** 一支一行：标题、现在用到原片的哪一段、多长、创建时的选择、剪过没有。 */
  function madeRows(children) {
    return (children || []).map((k, i) => {
      const used = usedRanges(k);
      const len = used.reduce((a, r) => a + (r.end - r.start), 0);
      const edited = editedSince(k);
      return {
        id: k.id, n: i + 1, title: k.title, at: k.origin.in, hue: k.hue,
        span: used.length === 1 ? `${mmss(used[0].start)} – ${mmss(used[0].end)}` : `${used.length} 段 · 从 ${mmss(used[0].start)} 起`,
        len: secs(len), over: Math.round(len) > PLATFORM_MAX, edited, cut: cutLine(k.cut), modified: k.modified || '',
      };
    });
  }
  /** 组里那条原片条：每一支用到的区间各一块，带着是哪一支（悬停一行时点亮它的那几块）。 */
  function madeBar(children, dur) {
    const out = [];
    if (!(dur > 0)) return out;
    (children || []).forEach((k) => bar(usedRanges(k), dur).forEach((b) => out.push(Object.assign({id: k.id}, b))));
    return out;
  }
  /** 重做出来的那一支叫什么：原来的标题后面接「第 N 版」，从 2 数起；原来就是某一版的，接着往下数。 */
  function redoTitle(title, taken) {
    const base = String(title || '').trim().replace(/ · 第 \d+ 版$/, '') || '未命名短视频';
    const used = new Set(taken || []);
    let n = 2;
    while (used.has(`${base} · 第 ${n} 版`)) n++;
    return `${base} · 第 ${n} 版`;
  }
  /** 「调整后再生成」带回挑片段页的那一条候选：现状是连着的一段就用现状，剪成了几段就用切出时的那一段。
      起止不在句子边界上的（在编辑器里拖过）照原样带回，候选卡上有「落在句中」的提醒。
      `taken` 是项目库里已有的标题，用来给新的一支起名。 */
  function redoCandidate(sentences, child, taken) {
    if (!isChild(child) || !(sentences || []).length) return null;
    const used = usedRanges(child);
    const whole = used.length === 1;
    const r = whole ? used[0] : {start: child.origin.in, end: child.origin.out};
    const c = manualCandidate(sentences, {range: r, id: 'sc-redo-' + child.id, title: redoTitle(child.title, taken)});
    return Object.assign(c, {
      added: 'redo', redoOf: child.id, focusX: child.cut && child.cut.focusX != null ? child.cut.focusX : null,
      reason: whole ? `「${child.title}」现在的起止` : `「${child.title}」切出时的起止 · 后来加的片段不带过来`,
    });
  }
  /** 重做时的设置：那一支创建时的取景、字幕轨与样式盖在现有设置上，再落到这个项目的现状上。 */
  function redoParams(child, base, facts) {
    const cut = (child && child.cut) || {};
    const p = Object.assign({}, base);
    ['focus', 'tracks', 'style'].forEach((k) => { if (cut[k] != null) p[k] = cut[k]; });
    return normalize(p, facts);
  }
  /** 重做落在会话的哪一步：正在跑就等它（busy）；手里还有没创建的候选就接在后面（append）；否则单起一页（fresh）。 */
  function redoPlan(s) {
    if (!s) return 'fresh';
    if (s.phase === 'finding' || s.phase === 'creating') return 'busy';
    if ((s.phase === 'review' || s.phase === 'done') && visible(s.list).some((c) => !c.made)) return 'append';
    return 'fresh';
  }
  /** 接在候选后面：上一次重做、已经创建掉的那几条撤下去。取景和字幕一页只有一套——
      别的候选一条都没勾时跟这一支原来的走；有勾上的就不动（`kept` 说的是和这一支原来的不一样）。 */
  function redoAppend(s, child, c) {
    const list = (s.list || []).filter((x) => x.id !== c.id && !(x.redoOf && x.made)).concat([c]);
    const own = redoParams(child, s.params, s.facts);
    if (!chosen(list).some((x) => x.id !== c.id)) return {list, params: own, kept: false};
    const kept = ['focus', 'tracks', 'style'].some((k) => own[k] !== s.params[k]);
    return {list, params: s.params, kept};
  }
  /** 挑片段页顶上那一句：只有重做的那一条时说的是重做，不说「找到几段」。 */
  function pickLead(list, preselected) {
    const v = visible(list);
    const on = chosen(list).length;
    if (v.length && v.every((c) => c.redoOf)) return {redo: true, head: `重做 ${v.length} 支${on === v.length ? '' : `，勾了 ${on} 支`} · 合计 ${mmss(totalSec(list))}`, sub: '起止不对就调，取景和字幕在下面改。创建的是另一部新视频，原来那支不动。'};
    return {redo: false, head: pickHeadline(list, preselected), sub: '逐段试看，起止不对就调，标题可以改。勾上的才会创建。'};
  }

  const api = {
    COUNT, SPARE, PLATFORM_MAX, DONE_RATIO, LENGTHS, FOCUS, TRACKS, STYLES, DEFAULTS, FIND_STAGES, CREATE_STAGES,
    lengthOf, focusOf, clampCount, normalize,
    mmss, secs, spanText, overlapSec,
    indexAt, rangeOf, snap, nudge, canNudge, dragEdge,
    isChild, childrenOf, parentOf, usedRanges, originLabel, countLabel, doneBy, deleteNote,
    flags, visible, chosen, totalSec, pickHeadline, createLabel, hookOf, tailOf, preselect,
    demoCandidates, demoMore, manualCandidate,
    childTitle, childProject, checkLine,
    summaryLine, lengthNote, agentExtra, taskTitle, stageAt, listStatus,
    focusSize, clampFocus, focusText, focusAt, contextFocus, speakerMap, captionSpec, openTracks,
    reviewRecord, reviewCanStep, reviewStep, setReviewEdge, reviewCueAt,
    piecesOf, extendRange, cuesIn, insertCues, extendPatches, insertPoint, shiftPatches, selection, usedIds, bar, usedFrom,
    ROW_H, pieceRows, ripplePatches, sourceRows, rowWindow, sameUsed,
    MADE_ROW_H, MADE_SHOWN, tracksOf, editedSince, cutLine, madeHead, madeRows, madeBar, redoTitle, redoCandidate, redoParams, redoPlan, redoAppend, pickLead,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.BC_SHORTS_CUT = api;
})();
