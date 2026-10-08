/* BaoCut 原型 — 章节分节与章节表改写
   window.BC_CH。纯函数，无 React、无 DOM。

   两条与实现共享的语义：

   1. **分节含空章节。** App v2 `adapters/transcript_list.rs` 的 `sections()` 走
      `ChapterListPlanner.sectionPlans(includeEmptyChapters: true)`——Transcript 与
      Subtitle 面板的唯一差别就是这一条：AI 生成的空章节照样出头行，否则用户看不到
      它、也就没法给它挪段落。这里同构。

   2. **章节是连续时间区间，不是段落的集合。** 所以「把某段挪去相邻章节」的真相是
      **挪边界**，不是给段落改 chapterId——不然章节就会变成不连续的段落集，
      `patchTranscript.set.chapters` 那张整表（起止时间）根本装不下。
      连带后果：挪一段就必然带走同侧的邻居，这不是实现偷懒，是模型定义。

   写回口径同 `apps/baocut/src/adapters/edits.rs::chapter_title_op`：
   `patchTranscript.set.chapters` 是**整表替换**，保留每章 id，只改命中的字段。 */
(function () {
  /** 段落归章：取段中点落在哪一章（段可能跨边界，用中点避免两边都算）。 */
  function chapterOfPara(chapters, para) {
    const mid = (para.start + para.end) / 2;
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i];
      if (mid >= c.start && (mid < c.end || i === chapters.length - 1)) return i;
    }
    return chapters.length ? chapters.length - 1 : -1;
  }

  /** 分节：[{chapter, index, paras}]；空章节保留头行；无章节表时退化成单个 chapter:null 节。 */
  function sections(chapters, paras) {
    if (!chapters || !chapters.length) return [{chapter: null, index: -1, paras: paras.slice()}];
    const out = chapters.map((c, i) => ({chapter: c, index: i, paras: []}));
    paras.forEach((p) => {
      const i = chapterOfPara(chapters, p);
      if (i >= 0) out[i].paras.push(p);
    });
    return out;
  }

  /** 改名：整表替换、保留 id 与边界；空白标题不成立（返回 null = 不写）。 */
  function renameChapter(chapters, id, title) {
    const t = String(title == null ? '' : title).trim();
    if (!t) return null;
    let hit = false;
    const next = chapters.map((c) => {
      if (c.id !== id) return c;
      hit = true;
      return Object.assign({}, c, {title: t});
    });
    return hit ? next : null;
  }

  /** 一次移动会带走哪些段（含被拖的那段）：
      dir = -1 去上一章 → 本章里这一段**及其之前**的段；
      dir = +1 去下一章 → 本章里这一段**及其之后**的段。
      返回 null = 这一步不成立（没有相邻章 / 会把本章清空 / 段不在章内）。 */
  function movePlan(chapters, paras, paraId, dir) {
    if (!chapters || chapters.length < 2) return null;
    const para = paras.find((p) => p.id === paraId);
    if (!para) return null;
    const ci = chapterOfPara(chapters, para);
    const to = ci + dir;
    if (ci < 0 || to < 0 || to >= chapters.length) return null;
    const mine = paras.filter((p) => chapterOfPara(chapters, p) === ci);
    const at = mine.findIndex((p) => p.id === paraId);
    if (at < 0) return null;
    const moving = dir < 0 ? mine.slice(0, at + 1) : mine.slice(at);
    // 本章至少留一段：空章节在分节里合法（AI 可以生成），但**用户把自己的章掏空**
    // 只会得到一个零长区间，没有可回退的落点。这一步直接不成立。
    if (moving.length >= mine.length) return null;
    return {from: ci, to, moving, boundary: dir < 0 ? para.end : para.start};
  }

  /** 执行移动：只改被跨过的那一条边界，其余章节原样（整表替换语义）。 */
  function moveParaToChapter(chapters, paras, paraId, dir) {
    const plan = movePlan(chapters, paras, paraId, dir);
    if (!plan) return null;
    const b = +plan.boundary.toFixed(2);
    const next = chapters.map((c, i) => {
      if (dir < 0 && i === plan.to) return Object.assign({}, c, {end: b});
      if (dir < 0 && i === plan.from) return Object.assign({}, c, {start: b});
      if (dir > 0 && i === plan.from) return Object.assign({}, c, {end: b});
      if (dir > 0 && i === plan.to) return Object.assign({}, c, {start: b});
      return c;
    });
    return {chapters: next, moved: plan.moving.length, from: plan.from, to: plan.to};
  }

  window.BC_CH = {chapterOfPara, sections, renameChapter, movePlan, moveParaToChapter};
})();
