/* BaoCut 原型 — 文稿取值与复制
   window.BC_TX。纯函数，无 React、无 DOM。

   两件事：

   1. **语言投影**：段落有 text（原文）与 trans（译文）两列，面板按 lang 取。
      `both` 是两行对照，不是把两种语言拼成一句。

   2. **复制**：把选中范围铺成纯文本。四个开关（时间码 / 说话人 / 语言 / 范围）
      正交，不做成四个函数——那是前身原型「每个入口各写一遍」的老毛病。

   为什么复制要落在纯层：它的输出会被贴进别处（邮件、文档、prompt），
   格式一旦漂了没人看得出来，所以它需要单测钉住，而不是散在 JSX 里拼字符串。 */
(function () {
  /** 段落在某语言下的文本。lang: 'src' | 'trans' | 'both' */
  function paraText(para, lang) {
    if (lang === 'trans') return para.trans || '';
    if (lang === 'both') return [para.text, para.trans].filter(Boolean).join('\n');
    return para.text || '';
  }

  /** 词级时间戳只在原文（同 §13.2 word animation 的口径）：
      译文没有逐词时间，切到译文后播放跟随只能是段级。 */
  function hasWordTiming(lang) { return lang === 'src'; }

  /** 「初始分段」只在投影明确声明 active + provisional 时显示。
      缺字段的旧投影与 VAD / 定长切窗都不能猜成 provisional。 */
  function initialSegmentsProvisional(segments) {
    return !!(segments && segments.active && segments.provisional);
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  /** 时间码：一小时内 mm:ss，满一小时起 hh:mm:ss。文稿面板「复制」与文稿导出（段落时间戳、章节标题、
      文首元信息的 chapters 与 duration）同用这一个（2026-10-07 定稿）。 */
  function stamp(t) {
    const s = Math.max(0, Math.floor(t));
    const mmss = `${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
    return s >= 3600 ? `${pad2(Math.floor(s / 3600))}:${mmss}` : mmss;
  }

  /** 复制文本。opts: {lang, time, speaker, speakers} */
  function copyText(paras, opts) {
    const o = opts || {};
    const names = o.speakers || {};
    return paras.map((p) => {
      const head = [];
      if (o.time) head.push(stamp(p.start));
      if (o.speaker) head.push(((names[p.sp] || {}).name || p.sp) + '：');
      const body = paraText(p, o.lang);
      if (!head.length) return body;
      // 说话人独立行时正文另起一行，读起来才是「谁说了什么」而不是一坨
      return head.join(' ') + '\n' + body;
    }).join('\n\n');
  }

  /** 复制的回执文案：段数 + 字数（CJK 按字、拉丁按词，两种语言的「量」不是一回事） */
  function copyReceipt(paras, lang) {
    const txt = paras.map((p) => paraText(p, lang)).join('');
    const cjk = (txt.match(/[一-鿿]/g) || []).length;
    const words = (txt.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
    const unit = cjk >= words ? `${cjk} 字` : `${words} 词`;
    return `${paras.length} 段 · ${unit}`;
  }

  /* ---------- 转录中的实时文稿 ----------
     **实时文稿是任务事件流的投影，不是项目真相。** 转录跑到哪一秒，已转录的部分就
     铺到哪一段；落盘的 transcript 要等终态帧。所以它在内存里活着，不参与编辑、
     不参与撤销栈，也没有 cue id 可以指——UI 上必须是只读的。

     切片按**音频位置**算，不按段落条数：进度是「解码到第几秒」，
     按条数分只会在长段落上卡住不动。 */

  /* 转录到「保存」这一步的进度：识别在这里已经做完，剩下把结果写进视频。
     真实的转录一段段整句到达，没有「半句」——所以识别位置只在这之前随进度走，
     到了这一步就是整段素材（`product-design` §5.7；第 243 轮）。 */
  const LIVE_SAVE_PCT = 99;
  /** 演示里「保存」这一步停多少拍（一拍 260ms）——不停的话这一步一闪而过，看不见。 */
  const LIVE_SAVE_TICKS = 5;

  /** 进度换算成「识别到了第几秒」；保存阶段是整段素材。 */
  function liveAtPct(pct, dur) {
    if (pct >= LIVE_SAVE_PCT) return dur;
    return Math.max(0, Math.min(dur, (dur * pct) / 100));
  }

  /** 识别做完、结果还在写进视频：头部写「正在保存转写」，不再给取消。 */
  function liveSaving(job) {
    return !!job && job.kind === 'transcribe' && job.origin !== 'url' && job.status === 'running' && job.pct >= LIVE_SAVE_PCT;
  }

  /** 某个进度下的实时切片：识别到的整段（`end <= at`）。最后一段仍在「识别中」（挂光标）直到进入保存阶段。
      真实转录没有半句，所以没有「写到一半的那一段」。 */
  function liveSlice(paras, dur, pct) {
    const at = liveAtPct(pct, dur);
    const settled = [];
    for (const p of paras) {
      if (p.end > at) break;
      settled.push(p);
    }
    const saving = pct >= LIVE_SAVE_PCT;
    return {settled, at, saving, tailIndex: settled.length && !saving ? settled.length - 1 : -1};
  }

  /* ---------- 转录中的字幕轨（第 220 轮、第 243 轮） ----------
     转录跑着的时候，**视频照常放、时间轴照常在**——转录只是在往一条轨上填内容，
     不是把整个编辑器锁起来。所以门控只落在字幕这一件事上：转录到了第几秒，
     字幕轨就画到第几秒。两段语义（整句到达，没有半句）：
       · settled：整条 cue 都在 `at` 之前——已识别，照常画、照常上画面；最后一条挂光标；
       · pending：`at` 到片尾——还没识别到，轨上画一条「转录中」待定带，画面上没有字幕。
     `at` 与实时文稿共用一个定义（`liveAtPct`）：
     文稿面板一段段流入的位置、时间轴待定带的前缘、画面上字幕出现的边界是同一个数。
     只有**第一次转录**才这样（视频还没有字幕轨）；重新转录时已有的轨原样留着，只有文稿面板切到实时态
     （`product-design` §5.7），所以 `liveAt` 对 `rerun` 的任务返回 null。 */

  /** 转录到了第几秒；不在转录、或是重新转录的任务返回 null（调用方据此走正常路径）。 */
  function liveAt(job, dur) {
    if (!job || job.kind !== 'transcribe' || job.status !== 'running' || job.rerun) return null;
    const pct = Math.max(0, Math.min(100, +job.pct || 0));
    if (pct >= 100) return null;
    return liveAtPct(pct, dur);
  }

  /** 某一条 cue 在转录位置 `at` 下是否已识别到（`at` 为 null = 不在转录）。 */
  function cueRecognized(cue, at) {
    return at == null || cue.end <= at;
  }

  /** 整条轨按 `at` 切：{settled, tail, pending}；不在转录时 pending 为 null。tail = 还在长的最后一条（保存阶段没有）。 */
  function liveTrackSlice(cues, dur, at) {
    if (at == null) return {settled: cues.slice(), tail: null, pending: null};
    const settled = [];
    for (const c of cues) {
      if (!cueRecognized(c, at)) break;
      settled.push(c);
    }
    const pending = at < dur ? {start: at, end: dur} : null;
    return {settled, tail: pending && settled.length ? settled[settled.length - 1] : null, pending};
  }

  /** 阶段阶梯：转录跑的是音频不是文本，四段与文稿类 flow 不同名。 */
  const LIVE_STAGES = ['解码音频', '识别', '词级对齐', '落盘'];
  function liveStage(pct) {
    if (pct <= 0) return 0;
    if (pct >= 100) return LIVE_STAGES.length - 1;
    // 解码只在开头占一小段，识别是主体；对齐与落盘在末尾
    if (pct < 6) return 0;
    if (pct < 92) return 1;
    if (pct < LIVE_SAVE_PCT) return 2;
    return 3;
  }

  /* ---------- cue 是写入单位，段落是投影 ----------

     段落正文 = 它那几条 cue 的原文**直接相接**（data.js 的 makeParas 就是这么拼的），
     所以段落里每条 cue 占哪一段字符是算得出来的，不需要另存一张表。

     这件事要紧，是因为**落笔的单位是 cue 不是段落**：`apps/baocut` 的
     `app/editor/findbar.rs::replace` 按 cue 原文生成 `sourceText`，一条跨了 cue
     边界的命中没有单个 `sourceText` 可写，因此不参与替换。原型跟这条口径。 */

  /** 段落当前正文。cueText(id) 给出该 cue 现在的文本（改写过就是改写后的）。 */
  function paraSrc(para, cueText) {
    return para.cueIds.map((id) => cueText(id)).join('');
  }

  /** 段落正文里每条 cue 的区间（UTF-16 偏移，左闭右开）。 */
  function cueSpans(para, cueText) {
    const out = [];
    let at = 0;
    para.cueIds.forEach((id) => {
      const len = cueText(id).length;
      out.push({id, start: at, end: at + len});
      at += len;
    });
    return out;
  }

  /** 这一段区间整个落在哪条 cue 里；跨了边界就返回 null（= 不可替换）。 */
  function cueOfRange(spans, start, end) {
    const hit = spans.find((s) => start >= s.start && end <= s.end && start < s.end);
    return hit ? hit.id : null;
  }

  /** 把段落的整段改写摊回它的 cue 上，返回 {cueId: 新文本}。

      真实产品里这是**服务端**的事：Studio 的 `sourceParagraph` op 只提交整段实时
      文本，由服务端重派生词与 cue（`source-paragraph-edit.js` 的头注）。原型没有
      服务端，用一次前后缀 diff 近似：改动落在哪几条 cue 上，改动后的那一段就整个
      交给**第一条被触及的 cue**，其余被触及的 cue 只留下没被碰到的前后缀。
      在一条 cue 里打字因此是精确的；跨 cue 的大改会把中间那几条压到第一条上——
      那正是服务端会重派生、而客户端不该自己猜的情形。 */
  function applyParaEdit(para, cueText, nextText) {
    const old = paraSrc(para, cueText);
    const next = String(nextText == null ? '' : nextText);
    if (next === old) return {};
    const spans = cueSpans(para, cueText);
    if (!spans.length) return {};
    const max = Math.min(old.length, next.length);
    let pre = 0;
    while (pre < max && old[pre] === next[pre]) pre++;
    let suf = 0;
    while (suf < max - pre && old[old.length - 1 - suf] === next[next.length - 1 - suf]) suf++;
    const tailAt = old.length - suf;                       // 旧文本里未改动后缀的起点
    const idx = (at, last) => {
      const i = spans.findIndex((s) => (last ? at > s.start && at <= s.end : at >= s.start && at < s.end));
      return i < 0 ? (last ? spans.length - 1 : 0) : i;
    };
    const i0 = idx(pre, false);
    const i1 = Math.max(i0, idx(tailAt, true));
    const patch = {};
    const head = old.slice(spans[i0].start, pre);
    const tail = old.slice(tailAt, spans[i1].end);
    const mid = next.slice(pre, next.length - suf);
    patch[spans[i0].id] = i0 === i1 ? head + mid + tail : head + mid;
    for (let i = i0 + 1; i < i1; i++) patch[spans[i].id] = '';
    if (i1 > i0) patch[spans[i1].id] = tail;
    return patch;
  }

  /* ---------- 文稿导出正文（导出弹层「文稿」页） ----------
     段落是读的文章，不是带时间轴的行：
       · md：`# 标题`；章节成 `## 章名 · mm:ss`（时间戳关掉时只写章名）；
       · txt：没有标题（command-protocol-spec §4.4），章节成 `— 章名 —`；
       · 说话人开着时**每段**都带标签（不论有几位说话人）：md `**名字:** 正文`、txt `名字: 正文`；
       · 段落时间戳写在段末 ` [mm:ss]`（满一小时 `[hh:mm:ss]`），不加反引号；
         双语对照时跟在原文段后面；译文不带标签与时间戳——md 里是原文段后单独一段引用 `> 译文`，
         txt 里在同一段的下一行。
     与 Runtime `text-export.ts` 同一套排法（2026-10-07 定稿）。
     opts：{fmt:'md'|'txt', lang, chapters, time, speaker, speakers, title, meta}
     meta（只 md 生效）：文首 YAML frontmatter 的字段，见 frontmatter()。 */
  function exportText(sections, opts) {
    const o = opts || {};
    const md = o.fmt !== 'txt';
    const names = o.speakers || {};
    const nameOf = (p) => (names[p.sp] || {}).name || p.sp;
    const out = [];
    if (md && o.meta) {
      const used = [];
      (sections || []).forEach((sec) => sec.paras.forEach((p) => {
        const nm = nameOf(p);
        if (nm && !used.includes(nm)) used.push(nm);
      }));
      const chs = (sections || []).filter((sec) => sec.chapter).map((sec) => sec.chapter);
      out.push(frontmatter(o.meta, {speakers: o.speaker ? used : [], chapters: o.chapters ? chs : []}));
    }
    if (o.title && md) out.push('# ' + o.title);
    (sections || []).forEach((sec) => {
      if (!sec.paras.length) return;
      if (o.chapters && sec.chapter) {
        out.push(md ? '## ' + sec.chapter.title + (o.time ? ' · ' + stamp(sec.chapter.start) : '') : '— ' + sec.chapter.title + ' —');
      }
      sec.paras.forEach((p) => {
        const label = o.speaker ? (md ? '**' + nameOf(p) + ':** ' : nameOf(p) + ': ') : '';
        const tail = o.time ? ' [' + stamp(p.start) + ']' : '';
        if (o.lang === 'trans') { out.push(label + (p.trans || '') + tail); return; }
        const src = label + (p.text || '') + tail;
        if (o.lang !== 'both' || !p.trans) out.push(src);
        else if (md) out.push(src, '> ' + p.trans);
        else out.push(src + '\n' + p.trans);
      });
    });
    return out.join('\n\n');
  }

  /* ---------- 文稿文首元信息（YAML frontmatter） ----------
     与 Runtime 文稿导出同一份字段与顺序（2026-10-07 定稿；v2 内核的 thumbnail 不写）：
       title · description · source · author · published · platform · duration · language · translation，
     之后 speakers（说话人开着时列出全部）与 chapters（章节标题开着时，`[mm:ss] 章名`）。缺的字段整行不写；
     字符串一律 JSON 双引号转义（合法 YAML）；项目备注（notes）不进。
     值里的换行先折成空格（2026-09-20）：元信息每条就是一行，YouTube 简介那种
     几十行的来源字段留着换行只能写成 `\n` 转义，文稿开头会出现一串 `\n` 字面量。 */
  /** langs：{language: 源语言代码, translation: 译文语言代码（原文导出时空）} */
  function projectMeta(proj, langs) {
    const lg = langs || {};
    const p = proj || {};
    const src = p.source || {};
    const pub = String(src.publishedAt || '');
    const dur = Math.round(p.duration || 0);
    return {
      title: p.title, description: p.desc || src.desc, source: p.url || src.url, author: src.uploader,
      published: /^\d{8}$/.test(pub) ? `${pub.slice(0, 4)}-${pub.slice(4, 6)}-${pub.slice(6)}` : pub,
      platform: src.platform, duration: dur > 0 ? stamp(dur) : '',
      language: lg.language, translation: lg.translation,
    };
  }
  const META_KEYS = ['title', 'description', 'source', 'author', 'published', 'platform', 'duration', 'language', 'translation'];
  function frontmatter(meta, lists) {
    const m = meta || {};
    const l = lists || {};
    const q = (v) => JSON.stringify(String(v).split(/\s+/).filter(Boolean).join(' '));
    const out = ['---'];
    META_KEYS.forEach((k) => { if (m[k] != null && String(m[k]).trim()) out.push(`${k}: ${q(m[k])}`); });
    if ((l.speakers || []).length) out.push('speakers:', ...l.speakers.map((n) => `  - ${q(n)}`));
    if ((l.chapters || []).length) out.push('chapters:', ...l.chapters.map((c) => `  - ${q(`[${stamp(c.start)}] ${c.title}`)}`));
    out.push('---');
    return out.join('\n');
  }

  /* ---------- 文稿正文的选项（导出「文稿」页与文稿面板的复制共用，2026-10-09） ----------
     一套词、一个顺序：格式（Markdown / 纯文本）加五个开关。导出页与「复制设置」都从这张表取标签，
     不各写一份。复制出来的正文与同样设置的导出逐字相同（都走 exportText），差别只在两处：
     语言跟文稿面板当前的视图走；组合记在偏好 `txCopy`，与导出页分开记——导出多半是存档，
     复制多半是贴进聊天或文档，缺省本来就不一样。 */
  const TEXT_OPTS = [
    {k: 'frontmatter', label: '文首元信息'},
    {k: 'chapters', label: '章节标题'},
    {k: 'time', label: '段落时间戳'},
    {k: 'speaker', label: '说话人'},
    {k: 'skipCut', label: '跳过已剪段'},
  ];
  const FMT_LABEL = {md: 'Markdown', txt: '纯文本'};

  /** 复制的缺省：Markdown、五个开关全开。格式与开关都记在偏好里，下次打开还是上一次的选择。 */
  const COPY_DEFAULTS = {fmt: 'md', frontmatter: true, chapters: true, time: true, speaker: true, skipCut: true};

  /** 偏好里存的组合 → 完整选项；缺的、类型不对的取缺省。 */
  function copyOpts(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const out = {fmt: s.fmt === 'md' || s.fmt === 'txt' ? s.fmt : COPY_DEFAULTS.fmt};
    TEXT_OPTS.forEach(({k}) => { out[k] = typeof s[k] === 'boolean' ? s[k] : COPY_DEFAULTS[k]; });
    return out;
  }

  /** 生效值：文首元信息只在 Markdown 里写，章节标题要视频有章节。
      置灰的开关保留用户的勾选（换回 Markdown、有了章节就回来），只是这一次不算。 */
  function textEffective(o, has) {
    return Object.assign({}, o, {
      frontmatter: !!o.frontmatter && o.fmt === 'md',
      chapters: !!o.chapters && !!(has && has.chapters),
    });
  }

  /** 组合写成一串零件（复制钮的提示、复制后的回执、范围菜单的副题）：格式，再列开着的前四项；
      跳过已剪段是缺省，关掉时才写「含已剪段」。scope 同 textArgs：只列对这个范围生效的——
      范围复制不写文首元信息，这一段没有章节标题、也不按跳过已剪段丢（是用户点名要的那段）。 */
  function textParts(eff, scope) {
    const part = scope === 'chapter' || scope === 'para';
    const e = Object.assign({}, eff, part ? {frontmatter: false} : null, scope === 'para' ? {chapters: false, skipCut: true} : null);
    const parts = [FMT_LABEL[e.fmt] || FMT_LABEL.txt];
    TEXT_OPTS.forEach(({k, label}) => { if (k !== 'skipCut' && e[k]) parts.push(label); });
    if (!e.skipCut) parts.push('含已剪段');
    return parts;
  }

  /** 按范围把生效选项摊成 exportText 的参数。
      all：与导出同一份正文——Markdown 以 `# 标题` 开头，开着文首元信息时前面再加 YAML；纯文本没有标题。
      chapter：不写标题与文首元信息，章节标题照开关；para：只这一段，也不写章节标题。
      base：{lang, speakers, title, meta} */
  function textArgs(eff, scope, base) {
    const b = base || {};
    const whole = !scope || scope === 'all';
    return {
      fmt: eff.fmt, lang: b.lang, speakers: b.speakers, time: !!eff.time, speaker: !!eff.speaker,
      chapters: scope === 'para' ? false : !!eff.chapters,
      title: whole && eff.fmt === 'md' ? b.title : '',
      meta: whole && eff.frontmatter ? b.meta : null,
    };
  }

  window.BC_TX = {paraText, hasWordTiming, initialSegmentsProvisional, copyText, copyReceipt, stamp, exportText, projectMeta, frontmatter,
    TEXT_OPTS, FMT_LABEL, COPY_DEFAULTS, copyOpts, textEffective, textParts, textArgs,
    LIVE_SAVE_PCT, LIVE_SAVE_TICKS, liveAtPct, liveSaving, liveSlice, LIVE_STAGES, liveStage, liveAt, cueRecognized, liveTrackSlice,
    paraSrc, cueSpans, cueOfRange, applyParaEdit};
})();
