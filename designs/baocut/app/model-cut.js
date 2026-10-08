/* 口播剪辑的剪口覆盖层 —— 第 192 轮（§12.6「剪口覆盖层」/ §13.1「剪辑模式」）。
   ============================================================================
   **数据结构不动 clip**。`clips {id, start, end, src}` 仍是时间轴与源偏移的真相，
   剪口是叠在它上面的一张**稀疏覆盖表**：

     cut = {id, start, end, kind, text, why, state, by, batch?}
       start / end  时间轴时钟（与 clips / cues 同钟），秒
       kind         'filler' 口癖 · 'pause' 停顿 · 'take' 重复起句 · 'repeat' 重复 · 'manual' 手动
       text         文稿里对应的字（停顿是「（停顿 1.4s）」）
       state        'suggested' 建议（AI / Agent 写入，尚未生效）· 'cut' 已剪（生效）
       by           'ai' | 'agent' | 'you'
       batch        一次 AI / Agent 任务写入的一批建议共用任务 id，任务页撤销时整批撤走

   为什么不直接改 clips：
     · 剪口要**可见**——已剪的段要在时间轴上留一块暗纹、在文稿里留一行划掉的字，
       直接从 clips 里抠掉那一段，用户就看不见「这里剪过什么」，也点不回来；
     · 建议态要**可逐条接受 / 忽略**，接受前不能影响播放与导出；
     · 撤销 / 重做走整张表的快照，与 cue 改写表同栈。
   真正的成片 clips 由 `compose(clips, cuts)` **派生**：同形的 `[{id, start, end, src}]`，
   给导出与 App 写路径消费；原型的时间轴与画布仍画原 clips，剪口只叠在上面。
   ============================================================================ */
(function () {
  const EPS = 1e-6;
  const KIND_LABEL = {filler: '口癖', pause: '停顿', take: '重复起句', repeat: '重复', manual: '手动'};

  const round3 = (x) => Math.round(x * 1000) / 1000;
  const norm = (list) => (list || [])
    .filter((c) => c && c.end - c.start > EPS)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const active = (cuts) => norm(cuts).filter((c) => c.state === 'cut');
  const suggested = (cuts) => norm(cuts).filter((c) => c.state === 'suggested');
  const overlaps = (a, b) => a.start < b.end - EPS && b.start < a.end - EPS;

  /** 时长文案：不到一分钟写 `0.8s`，否则 `1 分 12 秒`。 */
  function label(secs) {
    const s = Math.max(0, secs);
    if (s < 60) return (Math.round(s * 10) / 10).toFixed(1) + 's';
    const m = Math.floor(s / 60);
    const r = Math.round(s - m * 60);
    return r ? `${m} 分 ${r} 秒` : `${m} 分`;
  }
  const kindLabel = (k) => KIND_LABEL[k] || KIND_LABEL.manual;
  const total = (list) => norm(list).reduce((s, c) => s + (c.end - c.start), 0);
  /** 汇总：条数 / 总秒数 / 按 kind 分组条数。 */
  function summary(list) {
    const l = norm(list);
    const byKind = {};
    l.forEach((c) => { byKind[c.kind] = (byKind[c.kind] || 0) + 1; });
    return {n: l.length, secs: round3(total(l)), byKind};
  }
  /** 汇总句：`口癖 3 处、停顿 3 处、重复起句 3 处`。 */
  function kindsText(list) {
    const {byKind} = summary(list);
    return ['filler', 'pause', 'take', 'repeat', 'manual']
      .filter((k) => byKind[k]).map((k) => `${kindLabel(k)} ${byKind[k]} 处`).join('、');
  }

  /* ---------- 写入 ---------- */
  function setState(cuts, ids, state) {
    const set = new Set([].concat(ids));
    return norm(cuts).map((c) => (set.has(c.id) ? Object.assign({}, c, {state}) : c));
  }
  const accept = (cuts, ids) => setState(cuts, ids, 'cut');
  /** 忽略建议 / 恢复已剪：都是把这一条从表里拿走。 */
  function remove(cuts, ids) {
    const set = new Set([].concat(ids));
    return norm(cuts).filter((c) => !set.has(c.id));
  }
  const acceptAll = (cuts) => norm(cuts).map((c) => (c.state === 'suggested' ? Object.assign({}, c, {state: 'cut'}) : c));
  const rejectAll = (cuts) => norm(cuts).filter((c) => c.state !== 'suggested');
  const restoreAll = (cuts) => norm(cuts).filter((c) => c.state !== 'cut');
  const withoutBatch = (cuts, batch) => norm(cuts).filter((c) => c.batch !== batch);

  /** 手动剪一段：与已剪段重叠就合并成一段，盖住的建议一并吸收（视为已接受）。 */
  function add(cuts, cut) {
    const me = Object.assign({state: 'cut', by: 'you', kind: 'manual'}, cut);
    let start = me.start, end = me.end;
    const rest = [];
    norm(cuts).forEach((c) => {
      if (!overlaps(c, me)) { rest.push(c); return; }
      start = Math.min(start, c.start); end = Math.max(end, c.end);
    });
    // id 由区间决定（确定性，不用 Date / 随机）：同一段剪两次落到同一条
    const id = me.id || ('m' + Math.round(start * 1000) + '-' + Math.round(end * 1000));
    rest.push(Object.assign({}, me, {id, start: round3(start), end: round3(end)}));
    return norm(rest);
  }
  /** 写入一批建议：与表里任何一段重叠的跳过（同一处不重复建议）。 */
  function suggest(cuts, list, by, batch) {
    let out = norm(cuts);
    (list || []).forEach((c) => {
      const s = Object.assign({}, c, {state: 'suggested', by: by || c.by || 'ai'});
      if (batch) { s.batch = batch; s.id = batch + ':' + c.id; }
      if (out.some((x) => overlaps(x, s))) return;
      out = out.concat([s]);
    });
    return norm(out);
  }

  /* ---------- 读取 / 派生 ---------- */
  /** 播放头落在已剪段里就跳到段尾（剪口连着的也一路跳过去）。 */
  function skip(cuts, t) {
    let x = t;
    for (const c of active(cuts)) {
      if (x >= c.start - EPS && x < c.end - EPS) x = c.end;
    }
    return x;
  }
  /** 时间轴时钟 → 成片时钟：减掉它前面所有已剪段。 */
  function toOut(cuts, t) {
    let d = 0;
    for (const c of active(cuts)) {
      if (c.end <= t + EPS) d += c.end - c.start;
      else if (c.start < t) d += t - c.start;
    }
    return Math.max(0, t - d);
  }
  const outDuration = (duration, cuts) => Math.max(0, duration - total(active(cuts)));
  const at = (cuts, t) => norm(cuts).find((c) => t >= c.start - EPS && t < c.end - EPS) || null;

  /** 派生成片 clips：把已剪段从每条 clip 里抠掉，剩下的碎片按顺序重新贴紧。
      形状与输入 clip 一样（`{id, start, end, src}`），碎片 id 是 `k3.2` 这种。 */
  function compose(clips, cuts) {
    const cut = active(cuts);
    const out = [];
    let t = 0;
    (clips || []).forEach((k) => {
      const pieces = [];
      let a = k.start;
      cut.forEach((c) => {
        if (c.end <= a + EPS || c.start >= k.end - EPS) return;
        if (c.start > a + EPS) pieces.push([a, Math.min(c.start, k.end)]);
        a = Math.max(a, c.end);
      });
      if (a < k.end - EPS) pieces.push([a, k.end]);
      pieces.forEach(([s, e], i) => {
        const len = e - s;
        out.push({id: pieces.length > 1 ? k.id + '.' + (i + 1) : k.id,
          start: round3(t), end: round3(t + len), src: round3((k.src || 0) + (s - k.start))});
        t += len;
      });
    });
    return out;
  }

  /* ---------- 文稿 ↔ 时间 ----------
     词级时间戳在原型里没有，用 cue 内**字符比例**近似：一条 cue 的文字均匀铺在它的
     起止之间。真实产品这两个函数读 `words[]`。 */
  const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;
  const WORD = /[A-Za-z0-9À-ɏ'’]/;
  /** 切 token：中日文逐字、拉丁按词，标点与空白挂在前一个 token 上（没有前一个就挂后一个）。
      返回 `[{s, e}]` 字符区间，首尾相接覆盖全文。 */
  function tokens(text) {
    const s = String(text || '');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      let j = i + 1;
      if (WORD.test(ch)) { while (j < s.length && WORD.test(s[j])) j++; }
      else if (!CJK.test(ch)) {
        // 标点 / 空白：整段吃掉，挂到前一个 token 上
        while (j < s.length && !WORD.test(s[j]) && !CJK.test(s[j])) j++;
        if (out.length) { out[out.length - 1].e = j; i = j; continue; }
        // 开头就是标点：并进紧随其后的那个 token
        const k = j;
        let m = k + 1;
        if (k < s.length) {
          if (WORD.test(s[k])) { while (m < s.length && WORD.test(s[m])) m++; }
          out.push({s: i, e: Math.min(m, s.length)});
          i = Math.min(m, s.length);
          continue;
        }
        out.push({s: i, e: j}); i = j; continue;
      }
      out.push({s: i, e: j});
      i = j;
    }
    return out;
  }

  /** 段落里的字符区间 → 时间区间。`spans` 是 `BC_TX.cueSpans` 的输出（每条 cue 占的字符段），
      `cueOf(id)` 给 cue 的起止。 */
  function rangeTime(spans, cueOf, s, e) {
    const tAt = (pos, tail) => {
      for (const sp of spans) {
        const inside = tail ? pos > sp.start && pos <= sp.end : pos >= sp.start && pos < sp.end;
        if (!inside) continue;
        const cue = cueOf(sp.id);
        if (!cue) return null;
        const len = Math.max(1, sp.end - sp.start);
        return cue.start + ((pos - sp.start) / len) * (cue.end - cue.start);
      }
      return null;
    };
    const a = tAt(s, false), b = tAt(e, true);
    if (a == null || b == null) return null;
    return {start: round3(Math.min(a, b)), end: round3(Math.max(a, b))};
  }

  /** 剪口 → 它在段落文本里占的字符区间（可能跨 cue）。停顿这类只有时间没有字的剪口，
      返回 `{s, e}` 相等的一个插入点 + `mark: true`。 */
  function charsOf(spans, cueOf, cut) {
    let s = null, e = null;
    for (const sp of spans) {
      const cue = cueOf(sp.id);
      if (!cue || !overlaps(cue, cut)) continue;
      const len = sp.end - sp.start;
      const dur = Math.max(EPS, cue.end - cue.start);
      const a = sp.start + Math.round(Math.max(0, (cut.start - cue.start) / dur) * len);
      const b = sp.start + Math.round(Math.min(1, (cut.end - cue.start) / dur) * len);
      s = s == null ? a : Math.min(s, a);
      e = e == null ? b : Math.max(e, b);
    }
    if (s == null) return null;
    if (cut.kind === 'pause') return {s: e, e, mark: true};
    return {s, e, mark: s === e};
  }

  /* 改字态隐藏已剪词 —— 第 199 轮（§13.1「改字 / 剪辑两态」）。
     已剪的字只有剪辑态才需要看见（划掉、可恢复）；改字态编辑的是一份抠掉已剪词的
     **显示投影**，提交时按「未动的前缀 / 后缀」把抠掉的段放回，再写整段全文。
     与内核 bcut-editor-core::hidden_text 同一套规则：
       · 每个区间向后吞紧随的空白（词间连接符），落在文末的改为向前吞前导空白；
       · 前缀里的隐藏段原位放回，后缀里的随文本伸缩平移，被改写区间吞掉的随改写消失；
       · 段首 / 段尾的隐藏段永远贴着段首 / 段尾。 */
  const isWs = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

  /** 把 `ranges = [{s, e}]`（显示前全文的字符区间，任意顺序、可重叠）抠掉 →
      `{text, hidden: [{at, text}]}`；`at` 是隐藏段在显示文本里的落点。 */
  function hideChars(text, ranges) {
    const spans = (ranges || [])
      .filter((r) => r && r.s < r.e && r.e <= text.length)
      .map((r) => {
        let e = r.e, s = r.s;
        while (e < text.length && isWs(text[e])) e += 1;
        if (e === text.length) while (s > 0 && isWs(text[s - 1])) s -= 1;
        return {s, e};
      })
      .sort((a, b) => a.s - b.s || a.e - b.e);
    const merged = [];
    spans.forEach((sp) => {
      const last = merged[merged.length - 1];
      if (last && sp.s <= last.e) last.e = Math.max(last.e, sp.e);
      else merged.push({s: sp.s, e: sp.e});
    });
    let out = '', cursor = 0;
    const hidden = [];
    merged.forEach((sp) => {
      out += text.slice(cursor, sp.s);
      const last = hidden[hidden.length - 1];
      if (last && last.at === out.length) last.text += text.slice(sp.s, sp.e);
      else hidden.push({at: out.length, text: text.slice(sp.s, sp.e)});
      cursor = sp.e;
    });
    out += text.slice(cursor);
    return {text: out, hidden};
  }

  function placements(base, edited, hidden) {
    let prefix = 0;
    while (prefix < base.length && prefix < edited.length && base[prefix] === edited[prefix]) prefix += 1;
    const room = Math.min(base.length, edited.length) - prefix;
    let suffix = 0;
    while (suffix < room && base[base.length - 1 - suffix] === edited[edited.length - 1 - suffix]) suffix += 1;
    const tail = base.length - suffix;
    return hidden.map((seg) => {
      if (seg.at === 0) return 0;
      if (seg.at === base.length) return edited.length;
      if (seg.at <= prefix) return Math.min(seg.at, edited.length);
      if (seg.at >= tail) return seg.at + edited.length - base.length;
      return null;
    });
  }

  /** 用户改完显示文本后把隐藏段放回 → 可写回的整段全文；没有隐藏段时恒等于 edited。 */
  function restoreHidden(base, edited, hidden) {
    if (!hidden || !hidden.length) return edited;
    const places = placements(base, edited, hidden);
    let out = '';
    const queue = hidden.map((seg, i) => ({at: places[i], text: seg.text})).filter((q) => q.at != null);
    let qi = 0;
    for (let i = 0; i < edited.length; i += 1) {
      while (qi < queue.length && queue[qi].at <= i) { out += queue[qi].text; qi += 1; }
      out += edited[i];
    }
    for (; qi < queue.length; qi += 1) out += queue[qi].text;
    return out;
  }

  /** 改字态一段的显示投影：把所有已生效剪口在这段里占的字符区间抠掉（停顿这类
      只有时间没有字的剪口不参与）。没剪到 → null，调用方直接用全文。 */
  function editView(text, spans, cueOf, cuts) {
    const ranges = [];
    active(cuts).forEach((cut) => {
      const r = charsOf(spans, cueOf, cut);
      if (r && !r.mark && r.e > r.s) ranges.push(r);
    });
    if (!ranges.length) return null;
    const view = hideChars(text, ranges);
    return view.hidden.length ? view : null;
  }

  /** 改字态的行投影（剪缝，§13.1）：整段剪光的段不再自己占一张段落卡——那和在场的段
      只差一句灰字，扫一眼分不出哪段还在成片里。连着剪光的几段折成**一条剪缝**：

        `{kind:'seam', id, paras[], start, end, secs, cutIds[]}`

      `secs` 按覆盖这一段区间的已剪段算交集（段间停顿也算进去，那正是体感上少掉的量），
      `cutIds` 是「恢复这条缝」要放回的剪口——一条剪口跨到缝外时整条放回，恢复的单位
      始终是剪口本身。没剪光的段原样出 `{kind:'para', para}`。

      @param paras 顺序排好的段落（要 id / start / end）
      @param isAllCut `(para) => bool`——由调用方按 `editView` 判定 */
  function seamRows(paras, isAllCut, cuts) {
    const live = active(cuts);
    const out = [];
    (paras || []).forEach((para) => {
      if (!isAllCut(para)) { out.push({kind: 'para', para}); return; }
      const last = out[out.length - 1];
      if (last && last.kind === 'seam') {
        last.paras.push(para);
        last.end = Math.max(last.end, para.end);
      } else {
        out.push({kind: 'seam', id: 'seam-' + para.id, paras: [para], start: para.start, end: para.end});
      }
    });
    out.forEach((row) => {
      if (row.kind !== 'seam') return;
      const hits = live.filter((c) => c.start < row.end - EPS && c.end > row.start + EPS);
      row.cutIds = hits.map((c) => c.id);
      row.secs = round3(hits.reduce(
        (s, c) => s + (Math.min(c.end, row.end) - Math.max(c.start, row.start)), 0)) || round3(row.end - row.start);
    });
    return out;
  }

  /** 演示数据的建议按「哪条 cue 里的哪个子串」定义，时间从 cue 按字符比例算出来——
      这样中英两个语言包引的都是同一处毛病，时间也和 makeCues 铺出来的 cue 一致。
      `spec = {id, cue, kind, why, find: {zh, en}}` 或 `{…, tail: 秒数}`（cue 尾部的停顿）。 */
  function fromSpecs(specs, cues, lang) {
    const out = [];
    (specs || []).forEach((sp) => {
      const cue = (cues || []).find((c) => c.id === sp.cue);
      if (!cue) return;
      const dur = cue.end - cue.start;
      if (sp.tail) {
        const t = Math.min(sp.tail, dur);
        out.push({id: sp.id, cue: cue.id, kind: sp.kind || 'pause', why: sp.why || '长停顿',
          start: round3(cue.end - t), end: round3(cue.end), text: `（停顿 ${t.toFixed(1)}s）`});
        return;
      }
      const str = (sp.find && (sp.find[lang] || sp.find.zh)) || '';
      const i = str ? cue.text.indexOf(str) : -1;
      if (i < 0) return;
      const len = Math.max(1, cue.text.length);
      out.push({id: sp.id, cue: cue.id, kind: sp.kind, why: sp.why, text: str,
        start: round3(cue.start + (i / len) * dur), end: round3(cue.start + ((i + str.length) / len) * dur)});
    });
    return norm(out);
  }

  /* ---------- 剪口对字幕的影响（第 196 轮） ----------
     剪掉一段原文，压在它上面的字幕块要跟着缩短——**行内分割**，和主视频一样不新增轨。
     译文却不能自动跟着变：译文是按整句译的，原文剪掉半句，译文还是原来那句，只能先标成
     「原文被剪切」，交给 Agent / 模型按剪后的原文成批重译（§13.1）。 */

  /** 区间 `[start, end)` 抠掉已剪段后剩下的碎片；整段都剪掉返回 []。 */
  function keptPieces(cuts, start, end) {
    const out = [];
    let a = start;
    for (const c of active(cuts)) {
      if (c.end <= a + EPS || c.start >= end - EPS) continue;
      if (c.start > a + EPS) out.push({start: round3(a), end: round3(Math.min(c.start, end))});
      a = Math.max(a, c.end);
    }
    if (a < end - EPS) out.push({start: round3(a), end: round3(end)});
    return out;
  }

  /** 一条 cue 被已剪段碰到了多少：`{removed, kept, whole, words, sig}`。
   *  `words`——剪掉的是字（口癖 / 重复 / 手动），不只是句尾停顿；只剪停顿的译文不用动。
   *  `sig` 是碰到它的剪段 id 拼串——译文按这一版处理过就记在 `cue.transCutFix` 上，
   *  剪段一恢复或再多剪一刀，sig 变了，就重新标成待处理。没碰到返回 null。 */
  function cueImpact(cuts, cue) {
    const hits = active(cuts).filter((c) => overlaps(c, cue));
    if (!hits.length) return null;
    const kept = keptPieces(cuts, cue.start, cue.end);
    const removed = round3(hits.reduce((s, c) => s + (Math.min(c.end, cue.end) - Math.max(c.start, cue.start)), 0));
    return {id: cue.id, removed, kept, whole: !kept.length, words: hits.some((c) => c.kind !== 'pause'),
      sig: hits.map((c) => c.id).sort().join('+')};
  }

  /** 这条 cue 的译文是否待处理（原文有字被剪、且还没按这一版剪口处理过）；是就返回影响，否则 null。 */
  function transStale(cuts, cue) {
    const im = cueImpact(cuts, cue);
    if (!im || !im.words || cue.transCutFix === im.sig) return null;
    return im;
  }

  /** 整篇的译文受剪情况：`{stale: [影响…], whole, partial, trimmed, fixed}`。
   *  `trimmed` 只被剪短了停顿、`fixed` 已按当前剪口处理过——两者都不用再动。 */
  function transImpact(cuts, cues) {
    const r = {stale: [], whole: 0, partial: 0, trimmed: 0, fixed: 0};
    (cues || []).forEach((cue) => {
      const im = cueImpact(cuts, cue);
      if (!im) return;
      if (!im.words) { r.trimmed += 1; return; }
      if (cue.transCutFix === im.sig) { r.fixed += 1; return; }
      r.stale.push(im);
      if (im.whole) r.whole += 1; else r.partial += 1;
    });
    return r;
  }

  /** 把当前待处理的译文都记成「已按这一版剪口处理」：返回 `{cues, ids}`，没有待处理项时 cues 原样返回。 */
  function fixTrans(cuts, cues) {
    const ids = [];
    const next = (cues || []).map((cue) => {
      const im = transStale(cuts, cue);
      if (!im) return cue;
      ids.push(cue.id);
      return {...cue, transCutFix: im.sig};
    });
    return {cues: ids.length ? next : cues, ids};
  }

  /** 源片时间 → 时间轴时间（第 193 轮）：`cuts` 与文稿选区记的都是源片时间，时间轴上
      的主视频元素（`fromSource`）可能被挪过位，按包住 `start` 的那段元素的
      `start − srcStart` 平移；找不到就当没挪（identity）。 */
  function toTimeline(elements, start, end) {
    const el = (elements || []).find((e) => e.fromSource && e.kind === 'video'
      && start >= (e.srcStart == null ? e.start : e.srcStart)
      && start < (e.srcStart == null ? e.start : e.srcStart) + (e.end - e.start));
    const shift = el ? el.start - (el.srcStart == null ? el.start : el.srcStart) : 0;
    return {start: round3(start + shift), end: round3(end + shift)};
  }

  /* ---------- 折叠时钟与剪口带（第 197 轮）----------
     剪口是**全局**的：所有轨被剪的是源片上同一段，所以时间轴不再逐行画槽，而是一层贯穿
     所有轨的带（像播放头、像第 193 轮的选区高亮）。已剪段**不占视频时间**：默认时间轴按
     成片时钟折叠——刻度、播放头、块的位置都走 `view(t)`，剪掉的地方折掉；第 200 轮起
     `expanded` 就是全局「剪辑」开关：开着时撑开成空槽带（`view` 恒等，刻度仍按成片时钟标数字、
     槽内只画阴影不标数），关着时已剪段在时间轴上什么都不画。与内核「三层时间域」同一口径
     （技术方案 C7 / D-C1 就此收口）。

     `fold(t)` / `unfold(f)`：时间轴时钟 ↔ 成片时钟，不看开关；`view` / `unview` 看开关；
     `skip(t)`：落在已剪段里的时刻推到段尾（点标尺 / 拖播放头用）。
     `slots`：每条剪口在时间轴时钟上的区间（含建议，`sug` 位区分）；`seams`：折叠态下
     同一位置的相邻已剪段并成一组（`f` 成片时刻、`ids`、`secs`、`kinds`）——第 200 轮起视图
     不再画缝，这张表只留给内核 `fold_view` 的对拍夹具。 */
  function foldMap(cuts, elements, opts) {
    const expanded = !!(opts && opts.expanded);
    const slots = norm(cuts).map((c) => {
      const t = toTimeline(elements, c.start, c.end);
      return {id: c.id, cut: c, start: t.start, end: t.end, sug: c.state === 'suggested'};
    });
    // 折叠只看已剪段；重叠的并成一段，免得同一截时间减两次
    const spans = [];
    slots.filter((x) => !x.sug).sort((a, b) => a.start - b.start).forEach((x) => {
      const last = spans[spans.length - 1];
      if (last && x.start <= last.end + EPS) last.end = Math.max(last.end, x.end);
      else spans.push({start: x.start, end: x.end});
    });
    const fold = (t) => {
      let d = 0;
      for (const c of spans) {
        if (c.end <= t + EPS) d += c.end - c.start;
        else if (c.start < t) d += t - c.start;
      }
      return round3(Math.max(0, t - d));
    };
    const unfold = (f) => {
      let t = f;
      for (const c of spans) if (t >= c.start - EPS) t += c.end - c.start;
      return round3(t);
    };
    const skip = (t) => {
      for (const c of spans) if (t >= c.start - EPS && t < c.end - EPS) return c.end;
      return t;
    };
    const seams = [];
    slots.filter((x) => !x.sug).sort((a, b) => a.start - b.start).forEach((x) => {
      const f = fold(x.start);
      const last = seams[seams.length - 1];
      if (last && Math.abs(last.f - f) <= EPS) {
        last.ids.push(x.id); last.secs += x.end - x.start; last.cuts.push(x.cut);
        if (!last.kinds.includes(x.cut.kind)) last.kinds.push(x.cut.kind);
      } else seams.push({f, ids: [x.id], secs: x.end - x.start, kinds: [x.cut.kind], cuts: [x.cut]});
    });
    seams.forEach((m) => { m.secs = round3(m.secs); });
    return {
      expanded, slots, spans, seams, fold, unfold, skip,
      view: expanded ? (t) => t : fold,
      unview: expanded ? (f) => f : unfold,
      has: spans.length > 0,
    };
  }

  /** 一段（cue / 段落）是否整段落在已剪掉的区间里——文稿导出「跳过已剪段」按它筛
   *  （第 239 轮）。只有整段被剪才丢：半截被剪的段落文字仍在成片里，留着。 */
  function dropped(cuts, span) {
    if (!span || !(span.end > span.start)) return false;
    return active(cuts).some((c) => span.start >= c.start - EPS && span.end <= c.end + EPS);
  }

  /* ---------- 拖空槽带边缘改剪切范围（2026-10-01，§12.6，内核 `retimeCut` / spec 1.303.0）----------
     剪辑模式展开态，空槽带的左 / 右缘可以拖：只动被拖的那条边，松手一次原子写（id、kind、by、
     batch 不变），一步撤销。判据镜像内核 `bcut-editor-core::cut_mode::drag_cut_edge`：
       · 缺省吸词边界——左缘候选 `wordSpanStart`、右缘候选 `wordSpanEnd`，与按词剪同一套
         （`WORD_PAD` 留白 + 帧对齐，不切半个词），取离落点最近的界内候选；没词或界内没候选退回自由；
       · Alt 自由落点，按帧对齐；
       · 夹到 `[0, duration]`、不越过相邻**已剪**段（贴边可以）、至少一帧宽，拖过界贴住界本身。
     原型没有词级时间戳：`wordTimes` 用 cue 内**字符比例**近似（与 `rangeTime` / `charsOf` 同一套），
     也没有真实帧率，按演示素材的 30 fps（台账 prototype-ledger/2026-10-01-032906.md 记着这几处近似）。 */
  const CUT_FPS = 30;
  const WORD_PAD = 0.05;   // 内核 bcut-timeline::words::DEFAULT_WORD_PAD

  /** cue → 近似词表 `[{t0, t1, hidden}]`（源时钟，按起点排好序）：每个 token 按字符比例铺在 cue 内。 */
  function wordTimes(cues) {
    const out = [];
    (cues || []).slice().sort((a, b) => a.start - b.start).forEach((cue) => {
      const text = String(cue.text || '');
      const len = Math.max(1, text.length);
      const dur = cue.end - cue.start;
      if (!(dur > 0)) return;
      tokens(text).forEach((tk) => {
        out.push({t0: cue.start + (tk.s / len) * dur, t1: cue.start + (tk.e / len) * dur, hidden: false});
      });
    });
    return out;
  }

  /** 「从 `words[i]` 起剪」的起点：不越过前一个可见词的尾，留 `pad` 余量，帧对齐先向外（向前）取整，
      外扩越回前一个词时改向内取整（内核 `word_span_start`）。 */
  function wordSpanStart(words, i, fps, pad) {
    let prevEnd = 0;
    for (let k = i - 1; k >= 0; k--) if (!words[k].hidden) { prevEnd = words[k].t1; break; }
    const raw = Math.max(prevEnd, words[i].t0 - pad, 0);
    let s = Math.max(0, Math.floor(raw * fps) / fps);
    if (s < prevEnd - 1e-9) s = Math.ceil(raw * fps) / fps;
    return s;
  }
  /** 「剪到 `words[i]` 为止」的终点（`wordSpanStart` 的镜像，内核 `word_span_end`）。 */
  function wordSpanEnd(words, i, duration, fps, pad) {
    let nextStart = duration;
    for (let k = i + 1; k < words.length; k++) if (!words[k].hidden) { nextStart = words[k].t0; break; }
    const raw = Math.min(nextStart, words[i].t1 + pad, duration);
    let e = Math.min(duration, Math.ceil(raw * fps) / fps);
    if (e > nextStart + 1e-9) e = Math.floor(raw * fps) / fps;
    return e;
  }

  /** 在 `[lo, hi]` 里找离 `target` 最近的词边界候选：二分定位后向两侧走到第一个越界即停
      （候选随词序单调不减，十万词规模也是对数级）。 */
  function snapWordEdge(words, edge, target, lo, hi, fps, duration) {
    const E = 1e-9;
    const cand = (i) => (edge === 'start'
      ? wordSpanStart(words, i, fps, WORD_PAD) : wordSpanEnd(words, i, duration, fps, WORD_PAD));
    const key = (w) => (edge === 'start' ? w.t0 : w.t1);
    let a = 0, b = words.length;
    while (a < b) { const m = (a + b) >> 1; if (key(words[m]) < target) a = m + 1; else b = m; }
    let best = null;
    const consider = (v) => { if (best == null || Math.abs(v - target) < Math.abs(best - target)) best = v; };
    for (let i = a; i < words.length; i++) {
      if (words[i].hidden) continue;
      const v = cand(i);
      if (v > hi + E) break;
      if (v >= lo - E) { consider(v); if (v >= target) break; }
    }
    for (let i = a - 1; i >= 0; i--) {
      if (words[i].hidden) continue;
      const v = cand(i);
      if (v < lo - E) break;
      if (v <= hi + E) { consider(v); if (v <= target) break; }
    }
    return best == null ? null : Math.min(hi, Math.max(lo, best));
  }

  /** 拖剪口 `id` 的一条边（`edge: 'start' | 'end'`）到源时刻 `t` → 新区间 `{start, end}`；剪口不在 → null。
      `opts = {snap = true, fps = CUT_FPS, duration}`。相邻界只看已剪段：建议还没生效，
      被新区间盖住的建议由 `retime` 吸收（内核把它记成 superseded）。 */
  function dragEdge(cuts, words, id, edge, t, opts) {
    const o = opts || {};
    const fps = o.fps > 0 ? o.fps : CUT_FPS;
    const duration = o.duration;
    if (!Number.isFinite(t) || !(duration >= 0)) return null;
    const me = norm(cuts).find((c) => c.id === id);
    if (!me) return null;
    const others = active(cuts).filter((c) => c.id !== id);
    const frame = 1 / fps;
    let lo, hi;
    if (edge === 'start') {
      lo = others.filter((c) => c.end <= me.start + EPS).reduce((m, c) => Math.max(m, c.end), 0);
      hi = Math.min(me.end - frame, duration);
    } else {
      lo = Math.max(0, me.start + frame);
      hi = others.filter((c) => c.start >= me.end - EPS).reduce((m, c) => Math.min(m, c.start), duration);
    }
    if (lo > hi + 1e-9) return null;
    hi = Math.max(hi, lo);
    let at;
    if (t <= lo) at = lo;
    else if (t >= hi) at = hi;
    else {
      const snapped = o.snap === false ? null : snapWordEdge(words || [], edge, t, lo, hi, fps, duration);
      at = snapped != null ? snapped : Math.min(hi, Math.max(lo, Math.round(t * fps) / fps));
    }
    return edge === 'start' ? {start: round3(at), end: me.end} : {start: me.start, end: round3(at)};
  }

  /** 表面入口（内核 `drag_slot_edge`）：空槽带 `slot`（`foldMap().slots` 的一条）的 `edge` 从
      `pressX` 拖到 `x`（像素，`pxps` 像素 / 秒）→ `{id, edge, t0, t1, start, end, changed}`：
      `t0 / t1` 是要写回的源区间，`start / end` 是展开轴上的预览带（只平移被拖的那条边）。
      原型没有倍速 clip，`rate` 恒 1。按下没动原样返回（单击不让旧边被吸走）。 */
  function dragSlotEdge(slot, cuts, words, edge, pressX, x, pxps, free, opts) {
    if (!slot || !(pxps > 0)) return null;
    const c = slot.cut;
    let r;
    if (x === pressX) r = {start: c.start, end: c.end};
    else {
      const origin = edge === 'start' ? c.start : c.end;
      r = dragEdge(cuts, words, slot.id, edge, origin + (x - pressX) / pxps,
        Object.assign({}, opts, {snap: !free}));
    }
    if (!r) return null;
    const changed = Math.abs(r.start - c.start) > EPS || Math.abs(r.end - c.end) > EPS;
    return {id: slot.id, edge, t0: r.start, t1: r.end,
      start: round3(slot.start + (r.start - c.start)), end: round3(slot.end + (r.end - c.end)), changed};
  }

  /** 改一处剪口的区间（内核 op `retimeCut`）：只改 `start / end`，`id / kind / by / batch / state / text`
      原样；被新区间盖住的**建议**一并拿走（内核记成 superseded）。区间没变 → 原数组（调用方据此不写）。 */
  function retime(cuts, id, start, end) {
    const me = (cuts || []).find((c) => c.id === id);
    if (!me || !(end - start > EPS)) return cuts;
    const s = round3(start), e = round3(end);
    if (Math.abs(me.start - s) <= EPS && Math.abs(me.end - e) <= EPS) return cuts;
    const next = Object.assign({}, me, {start: s, end: e});
    return norm(cuts.filter((c) => c.id !== id && !(c.state === 'suggested' && overlaps(c, next))).concat([next]));
  }

  Object.assign(window, {BC_CUT: {
    KIND_LABEL, norm, active, suggested, overlaps, label, kindLabel, total, summary, kindsText, dropped,
    setState, accept, remove, acceptAll, rejectAll, restoreAll, withoutBatch, add, suggest,
    skip, toOut, outDuration, at, compose, tokens, rangeTime, charsOf, fromSpecs, toTimeline,
    keptPieces, cueImpact, transStale, transImpact, fixTrans, foldMap,
    hideChars, restoreHidden, editView, seamRows,
    CUT_FPS, WORD_PAD, wordTimes, wordSpanStart, wordSpanEnd, dragEdge, dragSlotEdge, retime,
  }});
})();
