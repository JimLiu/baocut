/* BaoCut 原型 — AI 工具里用到本机语义的几处（embedding-integration-design §2.3、§2.5、§2.7、§2.8、§3.6、§3.8）
   window.BC_TOOL_SEMANTIC。纯函数，无 React、无 DOM；node --test 直接 require。
   · 生成章节的「边界」一行（§2.3 / §3.6）；
   · 润色的术语候选：哪些是本机按意思找的、哪些是记下的误听写法；没装模型时只剩后者（§2.5）；勾选的一次改完，算一笔编辑；
   · 剪口播的「重录」：每组各遍的原文、时长、是否完整；建议保留哪一遍但不预先勾；
     数字、否定词、专有名词不同的两遍列进「相似但有差异」并高亮差异（§3.8 差异检查）；
   · 写博客的关键帧插图：装了多模态按段落内容挑，没装按出处时间取帧（§2.3 插图）；
   · 剪成短视频的主题句（§2.8）。
   Web 没有 AI 工具 Tab，不加载本文件（/^app\/model-tool-/）。 */
(function () {
  const pad2 = (n) => String(n).padStart(2, '0');
  const mmss = (t) => { const s = Math.max(0, Math.round(Number(t) || 0)); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; };

  /* ---------- 章节边界（§2.3、§3.6） ---------- */
  const BOUNDARY = [
    {k: 'topic', label: '按话题自动检测', sub: '本机先找讲话内容的转折，模型只在这些位置分章、命名；重跑只换标题不换边界'},
    {k: 'model', label: '由模型决定', sub: '整篇发给模型，边界与标题一起定；长视频重跑可能分得不一样'},
  ];
  const boundaryDefault = (st) => (st && st.usable ? 'topic' : 'model');

  /* ---------- 章节自检（§3.6 第 5 条，原型提议 2026-10-13） ----------
     生成章节之后，本机拿语义索引里的向量查两件事，只提示、不改章节：
     · 标题贴不贴内容：标题与这一章句群（质心）的相似度。只比同一部视频的几章——低于这几章的中位数 titleMargin 以上、
       且低于 titleFloor 的，提示标题可能没概括这一章；
     · 相邻两章是不是在讲同一件事：两章质心相似度高于 merge 的，提示可以考虑合并（没有合并按钮：挪边界在文稿里做）。
     scores = {titleFit: {章节 id: 相似度}, adjacent: {章节 id: 与上一章的相似度}}；没装模型、索引没好时不查（available: false）。
     阈值都未经校准。 */
  const CHAPTER_CHECK = {titleFloor: 0.45, titleMargin: 0.12, merge: 0.9};
  function chapterHints(chapters, scores, st) {
    const list = chapters || [];
    if (!st || !st.usable || st.stale || !scores || list.length < 2) return {available: !!(st && st.usable && !st.stale), hints: []};
    const fit = scores.titleFit || {}, adj = scores.adjacent || {};
    const fits = list.map((c) => fit[c.id]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    const median = fits.length ? fits[Math.floor((fits.length - 1) / 2)] : null;
    const hints = [];
    list.forEach((c, i) => {
      const f = fit[c.id];
      if (median !== null && typeof f === 'number' && f < CHAPTER_CHECK.titleFloor && f < median - CHAPTER_CHECK.titleMargin)
        hints.push({k: 'title', id: c.id, text: '标题可能没概括这一章：和这一章讲的内容不太贴，可以改个名'});
      const a = adj[c.id];
      if (i > 0 && typeof a === 'number' && a >= CHAPTER_CHECK.merge)
        hints.push({k: 'merge', id: c.id, prev: list[i - 1].id, text: `和上一章「${list[i - 1].title}」讲的很接近，可以考虑合并`});
    });
    return {available: true, hints};
  }

  /* ---------- 写作「按主题」（§2.2；§4 待评审第 2 条的原型提议） ----------
     缺省：整篇放得进所选模型的上下文、且视频不超过 30 分钟时用「整篇」；否则缺省「按主题」。
     没装模型时永远不缺省按主题（置灰）。 */
  const TOPIC_LONG_SEC = 30 * 60;
  function topicDefault(o) {
    const x = o || {};
    if (!x.usable) return {k: 'all', why: null};
    if ((x.duration || 0) > TOPIC_LONG_SEC) return {k: 'topic', why: '视频超过 30 分钟，缺省按主题挑段落'};
    if (x.budget && (x.words || 0) > x.budget) return {k: 'topic', why: '整篇超出所选模型的上下文，缺省按主题挑段落'};
    return {k: 'all', why: null};
  }
  /** 挑中的句子覆盖几章（参数页那一行「覆盖 N 章」） */
  function chaptersCovered(ids, cues, chapters) {
    const hit = new Set();
    (ids || []).forEach((id) => {
      const c = (cues || []).find((x) => x.id === id);
      const ch = c && (chapters || []).find((h) => c.start >= h.start && c.start < h.end);
      if (ch) hit.add(ch.id);
    });
    return hit.size;
  }
  /** 「按主题」这一项：能用时副题说怎么挑；没装 / 不支持时置灰并写原因 */
  function topicScope(st, n, chapters) {
    const usable = !!(st && st.usable);
    return {k: 'topic', label: '按主题', count: n, disabled: !usable,
      sub: usable ? `本机按提示词挑出相关段落 · 现在 ${n} 段，覆盖 ${chapters} 章` : '需要本机语义模型'};
  }

  /* ---------- 术语候选（§2.5） ---------- */
  /** 这次能列出的候选：没装模型时只有 exact（记下的误听写法），并带一句说明 */
  function termRows(cands, st) {
    const usable = !!(st && st.usable);
    const rows = (cands || []).filter((c) => usable || c.mode === 'exact');
    return {rows, hidden: (cands || []).length - rows.length, note: usable ? null : '只做了精确匹配：按术语表里记下的误听写法找，读音或意思相近的没有找'};
  }
  /** 勾了的那些一次改完：算一笔编辑（收据一行、撤销一次） */
  function applyTerms(rows, checked) {
    const on = rows.filter((r) => checked[r.id]);
    const n = on.reduce((s, r) => s + r.n, 0);
    return {rows: on, n, receipt: on.length ? `按术语表改了 ${n} 处（${on.length} 个写法）` : null};
  }
  /** 文稿里写法不一致、库里还没有的专名（§2.5「反向」）：一行说明 */
  const variantLine = (v) => v.forms.map((f, i) => `「${f}」${v.counts[i]} 次`).join('，');
  /** 润色结果里唯一一张「发现术语」清单（§2.5 反向）：库里没有的疑似专名（cands：BC_GLOSSARY.newTerms 的结果）
      与写法不一致的专名（variants）合成一份。写法不一致的排前、带上其余写法作误听写法；
      建议写法已在库里（knownTerms 的 source 或 variants）的不再列；与 cands 同名的合并成一行。
      只是清单：一行也不预先收，用户逐行挑表收进。返回 [{key, source, variants, count, line}] */
  function harvestRows(cands, variants, knownTerms) {
    const norm = (x) => String(x || '').trim().toLowerCase();
    const known = new Set();
    (knownTerms || []).forEach((t) => { known.add(norm(t.source)); (t.variants || []).forEach((v) => known.add(norm(v))); });
    const rows = [];
    const seen = new Set();
    (variants || []).forEach((v) => {
      if (known.has(norm(v.pick)) || seen.has(norm(v.pick))) return;
      seen.add(norm(v.pick));
      const c = (cands || []).find((x) => norm(x.source) === norm(v.pick));
      rows.push({key: 'v:' + v.id, source: v.pick, variants: v.forms.filter((f) => f !== v.pick),
        count: v.counts.reduce((a, b) => a + b, 0), line: `写法不一致：${variantLine(v)} · 建议统一成「${v.pick}」` + (c ? ` · 「${c.sample}」` : '')});
    });
    (cands || []).forEach((c) => {
      if (seen.has(norm(c.source)) || known.has(norm(c.source))) return;
      seen.add(norm(c.source));
      rows.push({key: 'c:' + c.source, source: c.source, variants: [], count: c.count, line: `出现 ${c.count} 次 · 「${c.sample}」`});
    });
    return rows;
  }

  /* ---------- 重录（§2.7、§3.8） ---------- */
  const NEG = ['不会', '没有', '不是', '不能', '不要', '别', '没', '不', '未', '非', '无', "don't", "doesn't", "isn't", "won't", 'not', 'never', 'no'];
  /** 一句里的数字、否定词、专有名词（专名：调用方给的术语表 / 人名，加上英文大写开头的词） */
  function marks(text, names) {
    const s = String(text || '');
    const out = [];
    const take = (re, kind) => { let m; re.lastIndex = 0; while ((m = re.exec(s))) out.push({kind, v: m[0], s: m.index, e: m.index + m[0].length}); };
    take(/\d+(?:\.\d+)?/g, 'num');
    const negs = NEG.slice().sort((a, b) => b.length - a.length);
    const used = [];
    negs.forEach((w) => {
      let i = s.indexOf(w);
      while (i >= 0) {
        if (!used.some(([a, b]) => i < b && i + w.length > a)) { used.push([i, i + w.length]); out.push({kind: 'neg', v: w, s: i, e: i + w.length}); }
        i = s.indexOf(w, i + w.length);
      }
    });
    (names || []).forEach((n) => { let i = s.indexOf(n); while (i >= 0) { out.push({kind: 'name', v: n, s: i, e: i + n.length}); i = s.indexOf(n, i + n.length); } });
    take(/\b[A-Z][a-zA-Z]+\b/g, 'name');
    return out.sort((a, b) => a.s - b.s);
  }
  const KIND = {num: '数字', neg: '否定', name: '专有名词'};
  /** 两遍的差异：按种类比较集合，不同的那些在各自原文里高亮。kinds 为空 = 可以当重录 */
  function diff(a, b, names) {
    const ma = marks(a, names), mb = marks(b, names);
    const kinds = [];
    const bad = {a: [], b: []};
    ['num', 'neg', 'name'].forEach((k) => {
      const va = ma.filter((m) => m.kind === k).map((m) => m.v);
      const vb = mb.filter((m) => m.kind === k).map((m) => m.v);
      const onlyA = ma.filter((m) => m.kind === k && vb.indexOf(m.v) < 0);
      const onlyB = mb.filter((m) => m.kind === k && va.indexOf(m.v) < 0);
      if (onlyA.length || onlyB.length) { kinds.push(KIND[k]); bad.a.push(...onlyA); bad.b.push(...onlyB); }
    });
    return {kinds, a: cut(a, bad.a), b: cut(b, bad.b)};
  }
  function cut(text, ms) {
    const s = String(text || '');
    const out = [];
    let at = 0;
    ms.slice().sort((x, y) => x.s - y.s).forEach((m) => {
      if (m.s < at) return;
      if (m.s > at) out.push({t: s.slice(at, m.s), hl: false});
      out.push({t: s.slice(m.s, m.e), hl: true});
      at = m.e;
    });
    if (at < s.length) out.push({t: s.slice(at), hl: false});
    return out;
  }
  /** 建议保留哪一遍：最后一遍完整的；都不完整取最长的（§2.7「保留最后一遍或最完整的一遍」） */
  function suggestKeep(takes) {
    const done = takes.filter((t) => t.complete);
    if (done.length) return done[done.length - 1].id;
    return takes.slice().sort((x, y) => y.text.length - x.text.length)[0].id;
  }
  /** 一组重录的展示数据；differ：组里有一对算「相似但有差异」 */
  function retakeGroup(g, names) {
    const keep = suggestKeep(g.takes);
    const pairs = [];
    for (let i = 1; i < g.takes.length; i++) pairs.push(diff(g.takes[0].text, g.takes[i].text, names));
    const differ = pairs.some((p) => p.kinds.length);
    return Object.assign({}, g, {keep, differ, kinds: [...new Set(pairs.flatMap((p) => p.kinds))],
      label: `${mmss(g.at)} · ${g.takes.length} 遍`,
      takes: g.takes.map((t, i) => Object.assign({}, t, {
        meta: `${t.dur.toFixed(1)} 秒 · ${t.complete ? '完整' : '没说完'}`,
        pieces: i === 0 ? (differ ? pairs[0].a : null) : (differ ? pairs[i - 1].b : null),
      }))});
  }
  /** 用户确认的组 → 要剪掉的遍（保留的那遍之外）；一笔编辑 */
  function applyRetakes(groups, confirmed, keepOf) {
    const cuts = [];
    groups.forEach((g) => {
      if (!confirmed[g.id]) return;
      const keep = (keepOf && keepOf[g.id]) || g.keep;
      g.takes.forEach((t) => { if (t.id !== keep) cuts.push({group: g.id, take: t.id, t: t.t, dur: t.dur}); });
    });
    const secs = cuts.reduce((s, c) => s + c.dur, 0);
    return {cuts, receipt: cuts.length ? `剪掉 ${cuts.length} 遍重录 · 共 ${secs.toFixed(1)} 秒` : null};
  }
  /** 没装模型时只找文字完全相同的：演示数据里没有完全相同的 → 空 */
  function retakeRows(groups, st) {
    if (st && st.usable) return groups;
    return groups.filter((g) => g.takes.every((t) => t.text === g.takes[0].text));
  }

  /* ---------- 关键帧插图（§2.3） ---------- */
  /** 每个有出处的段落一张：装了多模态按内容挑（matched），没装按段落第一处出处的时间取（byTime）。
      blocks：BC_WRCITES.blocks 的结果（只看当前视频的出处）；lookup(cue) → {start}；step：段落间隔（每几段一张） */
  function illustrations(blocks, lookup, install, step) {
    const byContent = install === 'full';
    const n = step || 2;
    const out = [];
    let k = 0;
    blocks.forEach((b) => {
      if (/^h\d$/.test(b.type) || b.inferred) return;
      const own = b.cites.find((c) => !c.video);
      const cue = own && lookup(own.cue);
      if (!cue || (k++ % n)) return;
      const t = byContent ? cue.start + 1.2 : cue.start;
      out.push({after: b.id, t, cand: [t, t + 2.5, t - 2.5].filter((x) => x >= 0), pick: 0, byContent,
        caption: frameCaption(t, byContent)});
    });
    return {frames: out, note: byContent ? null : '按时间取帧，未按内容挑选'};
  }
  function frameCaption(t, byContent) { return byContent ? `按这段内容挑的画面 · ${mmss(t)}` : `${mmss(t)} 的画面`; }
  /** 换一张：同一时间附近的下一个候选；题注跟着换成新时间 */
  function nextFrame(f) {
    const pick = (f.pick + 1) % f.cand.length;
    return Object.assign({}, f, {pick, t: f.cand[pick], caption: frameCaption(f.cand[pick], f.byContent)});
  }

  /* ---------- 剪成短视频的主题（§2.8） ---------- */
  function shortsTopic(text, st) {
    const t = String(text || '').trim();
    if (!t) return {extra: null, note: '可空：不写就全片分析'};
    if (!st || !st.usable) return {extra: null, note: '需要本机语义模型；不写主题时照常全片分析', blocked: true};
    return {extra: `只在讲「${t}」的片段里找`, note: '本机先圈出讲这件事的片段，再交给模型挑'};
  }

  const api = {TOPIC_LONG_SEC, topicDefault, chaptersCovered, topicScope, BOUNDARY, boundaryDefault, CHAPTER_CHECK, chapterHints, termRows, applyTerms, variantLine, harvestRows, marks, diff, KIND, suggestKeep, retakeGroup, applyRetakes,
    retakeRows, illustrations, nextFrame, shortsTopic, mmss};
  if (typeof window !== 'undefined') window.BC_TOOL_SEMANTIC = api;
})();
