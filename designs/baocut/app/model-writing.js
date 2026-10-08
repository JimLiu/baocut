/* BaoCut 原型 — 写作与发布（§15.11，AI 工具重设计 §8）
   window.BC_WRITING。纯函数，无 React、无 DOM；node --test 直接 require。

   这里放五个工具（写总结 / 写博客 / 起标题 / 写简介 / 做封面）共用的判断：
     · 选项表：篇幅、风格、视角、画幅、封面上的字、底图路线；
     · 视角推断（`auto` → 作者 / 观众，带一句依据）与语言缺省（写作跟界面语言，发布跟文稿）；
     · 标题候选：一批一批进来，按文本去重、推荐排第一、选用单选、已选用的可以改字；
     · 封面候选库：登记 / 选用（同一时刻只有一张）/ 删除 / 照这张再改（新的一张挨着原来那张）；
     · 关键帧条：本机挑 8 帧的演示版、钉住、加上当前画面；
     · 交给 Agent 时折进意图句的附加要求；
     · 演示样张（按语言分；目前备了 zh 与 en 两份，别的语言由调用方说明回落）。
   视图在 panel-aitools-write.jsx / panel-aitools-cover.jsx。Web 没有 AI 入口（§22），不加载本文件。 */
(function () {
  /* ---------- 选项表 ---------- */
  const LENGTHS = [{k: 'short', label: '短'}, {k: 'medium', label: '中'}, {k: 'long', label: '长'}];
  const STYLES = [
    {k: 'plain', label: '平实'}, {k: 'pop', label: '科普'}, {k: 'sharp', label: '毒舌'},
    {k: 'light', label: '轻松'}, {k: 'pro', label: '专业'}, {k: 'custom', label: '自定义…'},
  ];
  const VIEWS = [{k: 'auto', label: '自动'}, {k: 'author', label: '我是作者'}, {k: 'viewer', label: '我是观众'}];
  const VIEW_NAME = {author: '作者', viewer: '观众'};
  /* 工具 → 分组。写作给读的人，发布给发视频的人（重设计 §3）。 */
  const GROUP = {summary: 'write', blog: 'write', title: 'publish', desc: 'publish', cover: 'publish'};
  const TITLE_COUNT = {min: 3, max: 12, dflt: 6};
  const COVER_COUNT = {min: 2, max: 4, dflt: 3};
  const RATIOS = ['project', '16:9', '9:16', '1:1', '4:3'];
  const TEXT_MODES = [{k: 'none', label: '不放字'}, {k: 'phrase', label: '一句短语'}, {k: 'phrase-sub', label: '短语加一行小字'}];
  /* 底图的四条路线（重设计 §7.4）。`model`：要不要出图模型；`tag`：候选卡上的路线标签。 */
  const ROUTES = [
    {k: 'frame', label: '真实画面', tag: '视频画面', model: false},
    {k: 'restyled', label: '参考重绘', tag: '参考重绘', model: true},
    {k: 'generated', label: '全新生成', tag: 'AI 生成', model: true},
    {k: 'drawn', label: '代码绘制', tag: '代码绘制', model: false},
  ];
  const ROUTE = ROUTES.reduce((m, r) => (m[r.k] = r, m), {});
  /* 封面进行态上方那一行（重设计 §7.2 的七步里用户看得见的六步） */
  const COVER_STEPS = ['读文稿，定一件事', '挑关键帧', '定几个想法', '做底图', '合成', '缩小了检查'];
  const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

  /* ---------- 时间 ---------- */
  const pad2 = (n) => String(n).padStart(2, '0');
  /** 00:41 / 1:02:03：章节时间码与要点时间用的写法（整秒，满一小时进位） */
  function mmss(t) {
    const s = Math.max(0, Math.round(Number(t) || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
  }
  /** "01:44" / "1:02:03" → 秒；认不出回 null */
  function parseTime(str) {
    const m = String(str || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
  }

  /* ---------- 风格 ---------- */
  /** 风格落成一句话：自定义的原样传（用户怎么描述就怎么传，§6.1 `--style`） */
  function styleText(style, custom) {
    if (style === 'custom') return String(custom || '').trim() || null;
    const s = STYLES.find((x) => x.k === style);
    return s ? s.label : null;
  }

  /* ---------- 视角（重设计 §3.3） ---------- */
  function hostOf(url) {
    const m = String(url || '').match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
    return m ? m[1].replace(/^www\./, '') : null;
  }
  /** 风格文档写了身份就照它；否则媒体带来源链接（下载来的）按观众，本地文件按作者。
      `reason` 是可以直接显示在「自动」旁边的一句依据。 */
  function inferView(proj, doc) {
    if (doc && (doc.role === 'author' || doc.role === 'viewer')) {
      return {view: doc.role, reason: '你的风格文档写了身份'};
    }
    const url = proj && (proj.url || (proj.source && proj.source.url));
    if (url) return {view: 'viewer', reason: `媒体带来源链接（${hostOf(url) || url}），按别人的视频算`};
    return {view: 'author', reason: '媒体是本机文件，按你自己的视频算'};
  }
  /** 用户选定的优先；`auto` 走推断。回 {view, auto, reason} */
  function resolveView(choice, proj, doc) {
    if (choice === 'author' || choice === 'viewer') return {view: choice, auto: false, reason: null};
    return Object.assign({auto: true}, inferView(proj, doc));
  }

  /* ---------- 语言 ----------
     o = {ui, src, publish, trans: [已完成的译文语言 code], catalog: [{code, name, native}]}。
     写作组缺省跟界面语言：读的人要读懂；发布组缺省跟要发布的那一版，没有单独的那一版就跟文稿。
     两处都不写死某一种语言；给不出来（界面语言也认不出）时退到文稿语言。 */
  function defaultLang(tool, o) {
    const x = o || {};
    if (GROUP[tool] === 'write') {
      return x.ui ? {code: x.ui, why: '跟界面语言'} : {code: x.src || null, why: '跟文稿'};
    }
    if (x.publish) return {code: x.publish, why: '跟要发布的那一版'};
    return {code: x.src || x.ui || null, why: '跟文稿'};
  }
  /** 下拉的两组：这个项目已有的语言（原文在前，已有译文随后）排前面，其余按目录顺序。 */
  function langOptions(o) {
    const x = o || {};
    const cat = x.catalog || [];
    const seen = new Set();
    const project = [];
    const push = (code, tag) => {
      if (!code || seen.has(code)) return;
      seen.add(code);
      project.push({code, tag});
    };
    push(x.src, '原文');
    (x.trans || []).forEach((c) => push(c, '已有译文'));
    const other = cat.filter((l) => !seen.has(l.code)).map((l) => ({code: l.code}));
    return [{key: 'project', items: project}, {key: 'other', items: other}];
  }
  function langName(code, catalog) {
    const l = (catalog || []).find((x) => x.code === code);
    return l ? l.native : String(code || '');
  }

  /* ---------- 标题候选（重设计 §8.1） ----------
     状态 {seq, batches: [{id, kind, like, lang, cands:[{id,title,angle,why}], rec}], picked: {id, text, edited} | null}。
     最新一批在最前；「之前的候选」是其余几批。选用是单选：再点同一张取消。 */
  const emptyTitles = () => ({seq: 0, batches: [], picked: null});
  const normTitle = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const allCands = (st) => (st.batches || []).reduce((a, b) => a.concat(b.cands), []);
  const findCand = (st, id) => allCands(st).find((c) => c.id === id) || null;
  /** 新的一批进来：和已有的逐条比文本，重复的丢掉（`--more` 的校验在引擎，这里是显示层兜底） */
  function addBatch(st, batch) {
    const seen = new Set(allCands(st).map((c) => normTitle(c.title)));
    let seq = st.seq;
    const cands = [];
    let rec = null;
    (batch.cands || []).forEach((c, i) => {
      const key = normTitle(c.title);
      if (!key || seen.has(key)) return;
      seen.add(key);
      seq += 1;
      const it = {id: 't' + seq, title: String(c.title).trim(), angle: c.angle || null, why: c.why || null};
      if (i === (batch.recommended || 0)) rec = it.id;
      cands.push(it);
    });
    if (!cands.length) return st;
    const b = {id: 'b' + (st.batches.length + 1), kind: batch.kind || 'first', like: batch.like || null,
      lang: batch.lang || null, platform: batch.platform || null, cands, rec: rec || cands[0].id};
    return Object.assign({}, st, {seq, batches: [b].concat(st.batches)});
  }
  /** 卡片顺序：推荐的排第一，其余照模型给的顺序 */
  function ordered(batch) {
    if (!batch) return [];
    const r = batch.cands.filter((c) => c.id === batch.rec);
    return r.concat(batch.cands.filter((c) => c.id !== batch.rec));
  }
  const current = (st) => st.batches[0] || null;
  const earlier = (st) => st.batches.slice(1);
  function pickTitle(st, id) {
    if (st.picked && st.picked.id === id) return Object.assign({}, st, {picked: null});
    const c = findCand(st, id);
    if (!c) return st;
    return Object.assign({}, st, {picked: {id, text: c.title, edited: false}});
  }
  /** 就地改字：改成空的不收（要取消请点「已选用」），改回原文就不算用户的版本 */
  function editPicked(st, text) {
    if (!st.picked) return st;
    const t = String(text || '').trim();
    if (!t) return st;
    const c = findCand(st, st.picked.id);
    return Object.assign({}, st, {picked: {id: st.picked.id, text: t, edited: !c || t !== c.title}});
  }
  const clearPick = (st) => Object.assign({}, st, {picked: null});
  const pickedTitle = (st) => (st && st.picked ? st.picked.text : null);

  /* ---------- 封面候选库（重设计 §7.6 / §8.3） ----------
     状态 {seq, items: [{id, idea, base, text, sub, frames, ratio, by, from, note, seed}], picked: id | null}。 */
  const emptyCovers = () => ({seq: 0, items: [], picked: null});
  function addCover(lib, c) {
    const seq = lib.seq + 1;
    const it = Object.assign({base: 'frame', text: '', sub: '', frames: [], by: 'agent', from: null, note: null},
      c, {id: 'c' + seq, seed: c && c.seed != null ? c.seed : seq});
    const items = lib.items.slice();
    const at = c && c.after ? items.findIndex((x) => x.id === c.after) : -1;
    delete it.after;
    if (at >= 0) items.splice(at + 1, 0, it); else items.push(it);
    return Object.assign({}, lib, {seq, items});
  }
  /** 选用：同一时刻只有一张；再点已选用的那张就是取消 */
  function pickCover(lib, id) {
    if (lib.picked === id) return Object.assign({}, lib, {picked: null});
    if (!lib.items.some((x) => x.id === id)) return lib;
    return Object.assign({}, lib, {picked: id});
  }
  function removeCover(lib, id) {
    return Object.assign({}, lib, {items: lib.items.filter((x) => x.id !== id), picked: lib.picked === id ? null : lib.picked});
  }
  /** 照这张再改：新的一张登记在原来那张旁边，原来那张留着 */
  function reviseCover(lib, id, note) {
    const o = lib.items.find((x) => x.id === id);
    const n = String(note || '').trim();
    if (!o || !n) return lib;
    return addCover(lib, {idea: o.idea, base: o.base, scene: o.scene, text: o.text, sub: o.sub, frames: o.frames, ratio: o.ratio,
      by: 'agent', from: id, note: n, after: id, seed: o.seed + 17});
  }

  /* ---------- 关键帧条（重设计 §7.3 的演示版） ----------
     真产品里是 `bcut frames --auto 8`：镜头切换、清晰度、人脸、互不相似。原型按章节铺 8 帧，
     每帧带一种画面（主持人 / 两人 / 屏幕 / 三人）与一句理由；结果是确定的。 */
  const SCENES = [
    {k: 'host', people: 1, why: '主持人正脸、居中'},
    {k: 'duo', people: 2, why: '两人同框、表情清楚'},
    {k: 'screen', people: 0, why: '屏幕内容清晰可读'},
    {k: 'trio', people: 3, why: '三人同框'},
  ];
  function sceneAt(chapters, t) {
    const list = chapters || [];
    let i = list.findIndex((c) => t >= c.start && t < c.end);
    if (i < 0) i = list.length ? list.length - 1 : 0;
    return SCENES[Math.min(i, SCENES.length - 1)];
  }
  function autoFrames(chapters, duration, n) {
    const k = n || 8;
    const d = Number(duration) || 0;
    const out = [];
    for (let i = 0; i < k; i++) {
      const t = Math.round((d * (i + 0.5)) / k);
      const sc = sceneAt(chapters, t);
      out.push({t, scene: sc.k, people: sc.people, why: sc.why, score: Math.round((0.92 - ((i * 7) % 5) * 0.04) * 100) / 100, pinned: false});
    }
    return out;
  }
  /** 加上当前画面：已经在条上（±0.5 秒）就只是钉住它；否则加一帧、钉住、按时间排进去 */
  function addFrame(frames, t, chapters) {
    const hit = frames.find((f) => Math.abs(f.t - t) <= 0.5);
    if (hit) return frames.map((f) => (f === hit ? Object.assign({}, f, {pinned: true}) : f));
    const sc = sceneAt(chapters, t);
    const add = {t: Math.round(t * 10) / 10, scene: sc.k, people: sc.people, why: '你加的当前画面', score: null, pinned: true, manual: true};
    return frames.concat([add]).sort((a, b) => a.t - b.t);
  }
  const togglePin = (frames, t) => frames.map((f) => (f.t === t ? Object.assign({}, f, {pinned: !f.pinned}) : f));
  const pinned = (frames) => frames.filter((f) => f.pinned);

  /* ---------- 封面想法（演示版的 Agent 出稿） ----------
     一次出的几张尽量走不同的路线（§7.4）；钉住的帧优先用。
     别人的视频（视角 = 观众）里的人只用真实画面，参考重绘只拿没有人的帧；没有这样的帧就换回真实画面（§7.5）。 */
  /* 视频画面 / 参考重绘的想法按取到的那一帧写（画面里有什么就说什么）；另外两条路线不看帧 */
  const FRAME_IDEA = ['字压在下三分之一', '右侧留白放一句话'];
  function frameIdea(base, fr, n) {
    if (!fr) return base === 'restyled' ? '参考视频画面重绘成扁平插画，背景换成纯色' : `视频画面裁切，${FRAME_IDEA[n % FRAME_IDEA.length]}`;
    const sc = SCENES.find((x) => x.k === fr.scene) || SCENES[0];
    const at = `${mmss(fr.t)} `;
    if (base === 'restyled') {
      return sc.k === 'screen' ? `把 ${at}的演示屏幕重绘成扁平插画，只留转录那一栏` : `把 ${at}的画面（${sc.why}）重绘成扁平插画，背景换成纯色`;
    }
    return `用 ${at}的画面（${sc.why}），${FRAME_IDEA[n % FRAME_IDEA.length]}`;
  }
  const IDEAS = {
    generated: ['一台笔记本上浮着一段声波，旁边一朵灰掉的云', '一根断开的网线接着一段完整的字幕条'],
    drawn: ['一张对比条形图：上传加排队，和本机跑完', '一条时间轴：录音到字幕的每一步都不联网'],
  };
  function planCovers(o) {
    const x = o || {};
    const count = clampInt(x.count || COVER_COUNT.dflt, COVER_COUNT.min, COVER_COUNT.max);
    let routes = (x.routes || []).filter((r) => ROUTE[r]);
    if (!routes.length) routes = ['frame'];
    const frames = x.frames || [];
    const byPin = pinned(frames).concat(frames.filter((f) => !f.pinned).slice().sort((a, b) => (b.score || 0) - (a.score || 0)));
    const out = [];
    const used = {};
    for (let i = 0; i < count; i++) {
      let base = routes[i % routes.length];
      let pool = byPin;
      if (base === 'restyled' && x.view === 'viewer') {
        pool = byPin.filter((f) => !f.people);
        if (!pool.length) { base = 'frame'; pool = byPin; }
      }
      const cur = pool === byPin ? 'all' : 'nopeople';   // 用帧的路线共用游标：每张落在不同的帧上
      const fr = base === 'generated' || base === 'drawn' ? null : pool[(used[cur] || 0) % Math.max(1, pool.length)] || null;
      if (fr) used[cur] = (used[cur] || 0) + 1;
      const idea = IDEAS[base] ? IDEAS[base][(used[base] || 0) % IDEAS[base].length] : frameIdea(base, fr, used[base] || 0);
      used[base] = (used[base] || 0) + 1;
      out.push({idea, base, frames: fr ? [fr.t] : [], scene: fr ? fr.scene : null,
        text: x.textMode === 'none' ? '' : (x.phrase || ''), sub: x.textMode === 'phrase-sub' ? (x.sub || '') : '', ratio: x.ratio || '16:9'});
    }
    return out;
  }
  /** 「直接用这一帧」：不经模型，登记成一张视频画面候选 */
  const frameCover = (f, ratio) => ({idea: `直接用 ${mmss(f.t)} 这一帧`, base: 'frame', frames: [f.t], scene: f.scene, text: '', sub: '', ratio: ratio || '16:9', by: 'user'});
  /** 画幅：「跟视频画布」落到视频的实际画幅 */
  const ratioOf = (choice, projRatio) => (choice === 'project' || !choice ? (projRatio && projRatio !== 'Original' ? projRatio : '16:9') : choice);

  /** 点名了平台的结果下面那一行提醒；没点名不出 */
  function platformNote(platform) {
    const p = String(platform || '').trim();
    return p ? `要发到 ${p}：平台的规定会变，发布前对着它当前的规定核对一遍` : null;
  }

  /* ---------- 交给 Agent：设置态折成附加要求（接在意图句后，一句一条） ---------- */
  function intentExtra(tool, o, names) {
    const x = o || {};
    const nm = names || {};
    const out = [];
    const len = LENGTHS.find((l) => l.k === x.length);
    if (len && tool !== 'title' && tool !== 'cover') out.push(`篇幅：${len.label}`);
    const st = styleText(x.style, x.custom);
    if (st) out.push(`风格：${st}`);
    if (x.lang) out.push(`用${nm.lang || x.lang}写`);
    if ((tool === 'blog' || tool === 'desc') && x.view) {
      out.push(x.view.auto ? `视角：${VIEW_NAME[x.view.view]}（自动推断：${x.view.reason}）` : `视角：${VIEW_NAME[x.view.view]}`);
    }
    if ((tool === 'title' || tool === 'desc') && x.platform) out.push(`要发到：${x.platform}，按它的规定写，写完提醒我核对`);
    if ((tool === 'desc' || tool === 'cover') && x.picked) out.push(`已选用的标题：${x.picked}`);
    if (tool === 'cover') {
      if (x.idea) out.push(`封面要说的一件事：${x.idea}`);
      if (x.ratio) out.push(`画幅 ${x.ratio}`);
      const tm = TEXT_MODES.find((m) => m.k === x.textMode);
      if (tm) out.push(`封面上的字：${tm.label}`);
      if (x.routes) out.push(`可以用的路线：${x.routes.map((r) => ROUTE[r].label).join('、') || '真实画面'}`);
      const pins = (x.pins || []).map(mmss);
      if (pins.length) out.push(`优先用我钉住的 ${pins.length} 帧（${pins.join('、')}）`);
    }
    if (x.note) out.push(String(x.note).trim());
    return out.filter(Boolean);
  }

  /* ---------- Markdown（博客正文与总结正文的排版） ----------
     只认这几样：# / ## 标题、- 列表、> 引用、空行分段、**粗体**、[mm:ss] 时间码。 */
  function mdBlocks(text) {
    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push({type: 'p', text: para.join(' ')}); para = []; } };
    String(text || '').split('\n').forEach((raw) => {
      const ln = raw.trim();
      if (!ln) { flush(); return; }
      let m;
      if ((m = ln.match(/^(#{1,3})\s+(.*)$/))) { flush(); out.push({type: 'h' + m[1].length, text: m[2]}); return; }
      if ((m = ln.match(/^[-*]\s+(.*)$/))) { flush(); out.push({type: 'li', text: m[1]}); return; }
      if ((m = ln.match(/^>\s?(.*)$/))) { flush(); out.push({type: 'quote', text: m[1]}); return; }
      para.push(ln);
    });
    flush();
    return out;
  }
  /** 行内：粗体与时间码拆成片段 [{k:'t'|'b'|'time', v, s}] */
  function mdInline(text) {
    const out = [];
    const re = /\*\*([^*]+)\*\*|\[((?:\d+:)?\d{1,2}:\d{2})\]/g;
    let last = 0, m;
    const s = String(text || '');
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({k: 't', v: s.slice(last, m.index)});
      if (m[1] != null) out.push({k: 'b', v: m[1]});
      else out.push({k: 'time', v: m[2], s: parseTime(m[2])});
      last = re.lastIndex;
    }
    if (last < s.length) out.push({k: 't', v: s.slice(last)});
    return out;
  }
  /** 纯文本（复制用）：去掉 Markdown 记号，时间码留着 */
  const plain = (text) => mdBlocks(text).map((b) => (b.type === 'li' ? '- ' : '') + b.text.replace(/\*\*/g, '')).join('\n\n');

  /* ---------- 演示样张 ----------
     演示项目是「科浪电台 · 第 42 期」（data.js p1）。样张按语言分，目前备 zh 与 en；
     调用方拿到 `fallback: true` 时要在页面上说明显示的是哪一份。 */
  const DEMO_LANGS = ['zh', 'en'];
  const demoLang = (code, src) => (DEMO_LANGS.indexOf(code) >= 0 ? {code, fallback: false}
    : {code: DEMO_LANGS.indexOf(src) >= 0 ? src : DEMO_LANGS[0], fallback: true});

  const SUMMARY = {
    zh: {
      body: '科浪电台第 42 期，三位做本地视频工具的人讨论语音识别为什么可以、也值得放在本机跑。\n\n' +
        '小模型这两年进步很快，一台普通笔记本转一小时语音，比上传再排队还快 [00:41]。更要紧的是语音数据不出本机，访谈、内部会议、还没发布的演示都不必外传 [01:03]。' +
        '本机跑还能随便重跑、随时换模型，不用算钱 [01:28]；成本上一边是电费、一边是账单 [02:21]，断网也照样能用 [02:32]。\n\n' +
        '结论：本地优先并不反对云，只是把能在本机做完的事留在本机 [02:46]。',
      points: [
        {t: 26, text: '过去大家默认语音识别在云上：模型大、机器带不动'},
        {t: 41, text: '小模型进步快，笔记本转一小时语音比上传加排队快'},
        {t: 63, text: '语音数据不出本机：访谈、会议、未发布的演示'},
        {t: 88, text: '本机可以随便重跑、换模型，不用算钱'},
        {t: 104, text: '演示：拖进文件、选语言、点开始，就地出带时间的文稿'},
        {t: 131, text: '改一个词，字幕、翻译、导出同时跟着变'},
        {t: 141, text: '成本：本机是电费，云上是账单'},
        {t: 152, text: '离线场景：飞机上、客户机房、展会现场'},
        {t: 166, text: '总结：能在本机做完的就别上传'},
      ],
    },
    en: {
      body: 'Episode 42 of the Kelang podcast: three people who build local video tools discuss why speech recognition can, and should, run on your own machine.\n\n' +
        'Small models have improved fast. An ordinary laptop now transcribes an hour of audio faster than uploading and waiting in a queue [00:41]. More importantly, the audio never leaves the machine, so interviews, internal meetings and unreleased demos stay private [01:03]. ' +
        'Running locally also means you can re-run or swap models for free [01:28]; the cost is electricity instead of a bill [02:21], and it works offline [02:32].\n\n' +
        'The takeaway: local-first is not anti-cloud. It keeps on your machine whatever can be finished there [02:46].',
      points: [
        {t: 26, text: 'Speech recognition used to be assumed to live in the cloud'},
        {t: 41, text: 'A laptop now beats upload plus queue for an hour of audio'},
        {t: 63, text: 'Audio stays on the machine: interviews, meetings, unreleased demos'},
        {t: 88, text: 'Re-run and swap models locally at no cost'},
        {t: 104, text: 'Demo: drop a file, pick a language, press start'},
        {t: 131, text: 'Edit one word and subtitles, translation and export follow'},
        {t: 141, text: 'Cost: electricity locally, a bill in the cloud'},
        {t: 152, text: 'Offline: on a plane, in a client server room, at a trade show'},
        {t: 166, text: 'Takeaway: do not upload what you can finish locally'},
      ],
    },
  };
  /** 要点条数由篇幅定（§6.2：不固定条数）；演示按短 / 中 / 长取 4 / 6 / 9 条 */
  const POINTS_BY_LENGTH = {short: 4, medium: 6, long: 9};
  function demoSummary(lang, length) {
    const s = SUMMARY[lang] || SUMMARY.zh;
    const n = POINTS_BY_LENGTH[length] || POINTS_BY_LENGTH.medium;
    const step = s.points.length / n;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(s.points[Math.min(s.points.length - 1, Math.floor(i * step))]);
    return {body: s.body, points: pts};
  }

  const BLOG = {
    zh: {
      author: '# 我们为什么把语音识别搬回了本机\n\n' +
        '这期科浪，我和周远、苏黎聊了一个老话题的新做法：把视频工具做成本地优先的。\n\n' +
        '过去几年，大家默认语音识别是云上的事——模型太大，机器带不动。但小模型这两年掉得很快，现在一台普通笔记本转一小时的语音，比上传再排队还快 [00:41]。\n\n' +
        '## 数据不出门\n\n' +
        '访谈、内部会议、还没发布的产品演示，这些素材本来就不该往外传 [01:03]。本机跑还有一个副作用：可以随便重跑，不用算钱 [01:28]。\n\n' +
        '## 三件事\n\n' +
        '- 改一个词，字幕、翻译、导出同时跟着变 [02:11]\n' +
        '- 成本是电费，不是账单 [02:21]\n' +
        '- 飞机上、机房里、断网的展会现场也能用 [02:32]\n\n' +
        '能在本机做完的就别上传。下期我们接着讲对齐、翻译，以及导出为什么必须是确定的。',
      viewer: '# 语音识别为什么可以回到本机：科浪电台第 42 期笔记\n\n' +
        '> 本文整理自科浪电台第 42 期（kelang.example/ep42），嘉宾周远、苏黎，主持林澈。文中观点属于节目嘉宾。\n\n' +
        '节目讨论的是一个老话题的新做法：把视频工具做成本地优先的。主持人先抛出问题——为什么要做本地？\n\n' +
        '## 小模型改变了什么\n\n' +
        '嘉宾认为，过去语音识别默认在云上，是因为模型太大、机器带不动。小模型这两年进步很快，节目里的说法是：普通笔记本转一小时语音，已经比上传加排队快 [00:41]。\n\n' +
        '## 节目给出的三个理由\n\n' +
        '- **隐私**：访谈、会议和未发布的演示不出本机 [01:03]\n' +
        '- **成本**：本机是电费，云上是账单，量一大差距明显 [02:21]\n' +
        '- **离线**：飞机上、客户机房、断网现场都要能用 [02:32]\n\n' +
        '节目的结论是「本地优先不反对云，只是把默认值调回来」[02:46]。',
    },
    en: {
      author: '# Why we moved speech recognition back onto the laptop\n\n' +
        'On this episode of Kelang, Zhou Yuan, Su Li and I talked about an old topic done a new way: building video tools that are local-first.\n\n' +
        'For years everyone assumed speech recognition belonged in the cloud because the models were too big. Small models have improved so fast that an ordinary laptop now transcribes an hour of audio faster than uploading and queuing [00:41].\n\n' +
        '## The data stays home\n\n' +
        'Interviews, internal meetings and unreleased demos should not leave the building [01:03]. Running locally also means you can re-run as often as you like, for free [01:28].\n\n' +
        '## Three things\n\n' +
        '- Edit one word and subtitles, translation and export follow [02:11]\n' +
        '- The cost is electricity, not a bill [02:21]\n' +
        '- It works on a plane, in a server room, at an offline trade show [02:32]\n\n' +
        'If it can be finished locally, do not upload it. Next time: alignment, translation, and why export has to be deterministic.',
      viewer: '# Can speech recognition come home? Notes on Kelang episode 42\n\n' +
        '> Based on Kelang podcast episode 42 (kelang.example/ep42), with guests Zhou Yuan and Su Li, hosted by Lin Che. The views are the guests\'.\n\n' +
        'The episode takes an old topic in a new direction: video tools that are local-first. The host opens with the obvious question: why local?\n\n' +
        '## What small models changed\n\n' +
        'According to the guests, speech recognition lived in the cloud because the models were too large. That has changed quickly; in the episode\'s words, a laptop now beats upload plus queue for an hour of audio [00:41].\n\n' +
        '## Three reasons given\n\n' +
        '- **Privacy**: interviews, meetings and unreleased demos stay on the machine [01:03]\n' +
        '- **Cost**: electricity locally, a bill in the cloud [02:21]\n' +
        '- **Offline**: planes, client server rooms, trade shows without a network [02:32]\n\n' +
        'Their conclusion: local-first is not against the cloud; it resets the default [02:46].',
    },
  };
  const demoBlog = (lang, view) => (BLOG[lang] || BLOG.zh)[view === 'viewer' ? 'viewer' : 'author'];

  /** 简介：头两行 + 概述 + 章节时间码（命令填入，模型不写时间，§6.2）+ 出处 + 标签 */
  function demoDescription(o) {
    const x = o || {};
    const en = x.lang === 'en';
    const view = x.view === 'viewer' ? 'viewer' : 'author';
    const head = x.title ? x.title : (en ? 'Speech recognition can run on your own laptop now.' : '语音识别，现在可以在自己的笔记本上跑了。');
    const second = en
      ? (view === 'viewer' ? 'Three builders of local video tools on privacy, cost and working offline.' : 'We compare local and cloud transcription on privacy, cost and working offline.')
      : (view === 'viewer' ? '三位做本地视频工具的人，聊隐私、成本和断网能不能用。' : '这期我们把本机转录和云端转录放在一起比：隐私、成本、断网能不能用。');
    const body = en
      ? 'Includes a live demo: drop in a file and get a timestamped transcript on the spot.'
      : (x.length === 'short' ? '' : '节目里有一段现场演示：拖进文件，当场出带时间的文稿。');
    const chapters = (x.chapters || []).map((c) => `${mmss(c.start)} ${c.title}`).join('\n');
    const credit = view === 'viewer'
      ? (en ? 'Source: Kelang podcast, episode 42 (kelang.example/ep42)' : '出处：科浪电台 · 第 42 期（kelang.example/ep42）')
      : null;
    const text = [head, second, body, chapters ? (en ? 'Chapters\n' : '章节\n') + chapters : null, credit].filter(Boolean).join('\n\n');
    const tags = en ? ['speech recognition', 'local-first', 'privacy', 'offline', 'podcast']
      : ['语音识别', '本地优先', '隐私', '离线', '科浪电台'];
    return {text, tags};
  }

  /* 标题候选池：角度真的不同（反差 / 问题 / 数字 / 成本 / 场景 / 观点 …），理由里写出视频哪一段兑现。
     「再来一批」取还没出现过的、角度尽量不重复的；「照这个再来几个」取同一角度的变体。 */
  const T = (angle, title, why) => ({angle, title, why});
  const TITLE_POOL = {
    zh: [
      T('反差', '语音识别不上云，反而更快了', '和「云上更快」的默认印象相反，00:41 有实测的说法'),
      T('问题', '为什么你的访谈录音不该上传？', '留一个视频会回答的问题，答案在 01:03'),
      T('数字', '一小时录音，一台笔记本，比上传还快', '具体的量和设备，缩成小图也读得出'),
      T('成本', '电费还是账单：语音识别放在哪儿更划算', '周远追问成本那段（02:21）利害最直接'),
      T('场景', '飞机上、机房里、断网现场：离线转录怎么做', '三个具体场景，需要离线的人一眼认出自己'),
      T('观点', '本地优先，是把默认值调回来', '直接用收尾那句结论（02:46），给认同这个立场的人'),
      T('演示', '拖进文件、点开始：本机转录全程实录', '演示段（01:44）是画面最好看的一段'),
      T('隐私', '还没发布的产品演示，别先交给别人的服务器', '点名一类最怕外传的素材（01:03）'),
      T('趋势', '小模型掉得这么快，语音识别该回到本机了', '讲变化，给关注技术走向的人'),
      T('副作用', '换个模型重跑一遍，不用再算钱', '苏黎补充的副作用（01:28），对常改稿的人最实在'),
      T('编辑', '改一个词，字幕、翻译、导出一起跟着变', '演示里最直观的一步（02:11）'),
      T('人物', '做本地视频工具的三个人，为什么不做云端版', '人物加立场，适合先认人再点开的观众'),
      T('对比', '本地还是云端？一期讲清语音识别的取舍', '把两边摆在一起，适合还没拿定主意的人'),
      T('悬念', '你的会议录音，现在在谁的服务器上？', '一个人人答不上来的问题，视频给了去处'),
      T('清单', '云端转录的三个隐藏成本', '隐私、账单、断网三件事视频里都讲到了'),
      T('受众', '做访谈的人，这期值得听完', '直接点名最该看的人'),
      T('流程', '从录音到字幕，一步都不用联网', '讲完整链路，演示段可以兑现'),
      T('历史', '为什么剪辑软件一直把语音当配角', '来源简介里的开篇问题，节目从这里讲起'),
    ],
    en: [
      T('Contrast', 'Skipping the cloud made our transcription faster', 'Goes against the usual assumption; backed up at 00:41'),
      T('Question', 'Why shouldn\'t your interview recordings be uploaded?', 'Asks something the video answers at 01:03'),
      T('Numbers', 'One hour of audio, one laptop, faster than uploading', 'Concrete amounts that still read at thumbnail size'),
      T('Cost', 'Electricity or a bill: where should transcription run?', 'The cost exchange at 02:21 has the clearest stakes'),
      T('Scene', 'On a plane, in a server room, offline: transcribing anyway', 'Three specific places people will recognise'),
      T('Opinion', 'Local-first just resets the default', 'Uses the closing line at 02:46'),
      T('Demo', 'Drop a file, press start: local transcription, start to finish', 'The demo at 01:44 is the best-looking part'),
      T('Privacy', 'Don\'t hand your unreleased demo to someone else\'s server', 'Names the kind of footage people least want leaked'),
      T('Trend', 'Small models got good. Speech recognition can come home', 'For people who follow where the technology is going'),
      T('Side effect', 'Re-run with another model, and pay nothing', 'Su Li\'s point at 01:28, practical for frequent editors'),
    ],
  };
  const LIKE_POOL = {
    zh: {
      '反差': [T('反差', '不上传，反而先出字幕', '同一个反差，换成结果先到'), T('反差', '我们把语音识别从云上搬了回来，快了', '第一人称讲同一个反差'), T('反差', '越大的模型越要上云？这期说不一定', '用问句包住反差')],
      '问题': [T('问题', '录音上传之前，你想过这个问题吗？', '同一个问题，更短'), T('问题', '内部会议的录音，该交给谁转？', '把问题落到会议场景')],
      '数字': [T('数字', '60 分钟语音，本机转完不用排队', '同一组数字换一种说法'), T('数字', '一台笔记本跑赢上传加排队', '数字换成胜负')],
      '成本': [T('成本', '语音识别的账单，可以换成电费', '同一个利害，句子更短'), T('成本', '量一大，云端转录就不是一个价了', '讲规模带来的差距')],
    },
    en: {},
  };
  function demoTitles(st, o) {
    const x = o || {};
    const lang = demoLang(x.lang, x.src).code;
    const pool = TITLE_POOL[lang];
    const used = new Set(allCands(st).map((c) => normTitle(c.title)));
    const fresh = pool.filter((c) => !used.has(normTitle(c.title)));
    const count = clampInt(x.count || TITLE_COUNT.dflt, TITLE_COUNT.min, TITLE_COUNT.max);
    if (x.kind === 'like') {
      const base = findCand(st, x.like);
      if (!base) return {kind: 'like', like: x.like, lang, cands: []};
      const vs = ((LIKE_POOL[lang] || {})[base.angle] || []).filter((c) => !used.has(normTitle(c.title)));
      const same = fresh.filter((c) => c.angle === base.angle);
      return {kind: 'like', like: x.like, lang, cands: vs.concat(same).slice(0, 3)};
    }
    const angles = new Set(allCands(st).map((c) => c.angle));
    const pick = fresh.filter((c) => !angles.has(c.angle)).concat(fresh.filter((c) => angles.has(c.angle))).slice(0, count);
    return {kind: x.kind === 'more' ? 'more' : 'first', like: null, lang, cands: pick, recommended: 0};
  }

  const api = {
    LENGTHS, STYLES, VIEWS, VIEW_NAME, GROUP, TITLE_COUNT, COVER_COUNT, RATIOS, TEXT_MODES, ROUTES, ROUTE, COVER_STEPS, SCENES,
    mmss, parseTime, styleText, hostOf, inferView, resolveView, defaultLang, langOptions, langName,
    emptyTitles, addBatch, ordered, current, earlier, pickTitle, editPicked, clearPick, pickedTitle, findCand, allCands,
    emptyCovers, addCover, pickCover, removeCover, reviseCover,
    sceneAt, autoFrames, addFrame, togglePin, pinned, planCovers, frameCover, ratioOf,
    intentExtra, platformNote, mdBlocks, mdInline, plain,
    DEMO_LANGS, demoLang, demoSummary, demoBlog, demoDescription, demoTitles, TITLE_POOL,
  };
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.BC_WRITING = api;
})();
