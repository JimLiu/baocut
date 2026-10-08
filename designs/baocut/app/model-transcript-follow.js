/* BaoCut 原型 — 文稿播放跟随（词级）
   window.BC_FOLLOW。纯函数，无 React、无 DOM。

   文稿面板播放时做三件事（product-design §5.7）：当前在念的词高亮、已经念过的词退灰、
   当前词滚到列表中间。字幕列表与译文列表只按整条跟随：正在播的那一条滚进视野、不居中
   （`activeAt` ＋ `nearestTop`）。

   原型没有词表：词元按 `BC_CUT.tokens` 切（中日文逐字、拉丁按词、标点挂前一个），
   时间按 `BC_CUT.rangeTime` 在 cue 内按字符比例插值——与剪辑态（CutText）同一套近似，
   真实产品读 words[]。这里只管「给定时间区间与播放头，谁在念、谁念过」与「滚到哪」。 */
(function () {
  /** 播放头落在哪个词元上。`times` 是每个词元的 `{start, end}`（取不到时间的为 null），
      按时间先后排好。返回 `{now, played}`：
        now    — 当前词元下标（start <= t < end），落在两个词元的间隙（停顿）里为 -1；
        played — 已念完的词元个数：下标 < played 的都算念过（间隙之前的那些也算）。 */
  function progress(times, t) {
    let now = -1, played = 0;
    (times || []).forEach((r, i) => {
      if (!r) return;
      if (r.end <= t) played = i + 1;
      else if (now < 0 && r.start <= t) now = i;
    });
    if (now >= 0) played = Math.min(played, now);
    return {now, played};
  }

  /** 改字态的正文是抠掉已剪字的投影（`BC_CUT.editView`），cue 字符区间却按全文算。
      投影里的位置 → 全文位置：`hidden` 是 `[{at, text}]`，`at` 为投影偏移、被抠的字
      排在投影第 `at` 个字之前。`tail` 为真时按区间右端（开区间）映射。 */
  function unhide(hidden, pos, tail) {
    if (!hidden || !hidden.length) return pos;
    const p = tail ? pos - 1 : pos;
    let add = 0;
    hidden.forEach((h) => { if (h.at <= p) add += String(h.text || '').length; });
    return p + add + (tail ? 1 : 0);
  }

  /** 一段正文的词级跟随：切词元、给每个词元算时间、按播放头分出当前与已念。
      `text` 是面板显示的那一份（可能是投影，`hidden` 给出被抠的段）；
      `spans` / `cueOf` 同 `BC_CUT.rangeTime`。返回 `{toks, now, played}`。 */
  function paraWords(text, spans, cueOf, t, hidden) {
    const CUT = window.BC_CUT;
    const toks = CUT.tokens(text);
    const times = toks.map((k) => CUT.rangeTime(spans, cueOf, unhide(hidden, k.s, false), unhide(hidden, k.e, true)));
    return Object.assign({toks}, progress(times, t));
  }

  /** 把一个元素（在滚动容器内容坐标里的 top / height）滚到容器垂直中间的 scrollTop，
      夹在 [0, scrollHeight - clientHeight]；内容比视口矮时为 0。 */
  function centerTop(scrollHeight, clientHeight, elTop, elHeight) {
    const max = Math.max(0, scrollHeight - clientHeight);
    const want = elTop + elHeight / 2 - clientHeight / 2;
    return Math.max(0, Math.min(max, Math.round(want)));
  }

  /** 列表跟随时把一个元素滚进视野的 scrollTop（等价于 scrollIntoView 的 block 'nearest'）：
      已完整可见就不动（返回当前 scrollTop）；在上方则顶边对齐、在下方则底边对齐；
      比视口还高时顶边对齐。夹在 [0, scrollHeight - clientHeight]。 */
  function nearestTop(scrollTop, clientHeight, elTop, elHeight, scrollHeight) {
    const max = Math.max(0, scrollHeight - clientHeight);
    let want = scrollTop;
    if (elTop < scrollTop || elHeight > clientHeight) want = elTop;
    else if (elTop + elHeight > scrollTop + clientHeight) want = elTop + elHeight - clientHeight;
    else return scrollTop;
    return Math.max(0, Math.min(max, Math.round(want)));
  }

  /** 播放头落在哪一条上：`spans` 是 `{start, end}`（缺时间的为 null），返回第一条
      start <= t < end 的下标；落在两条之间的空隙里为 -1（跟随原地不动）。 */
  function activeAt(spans, t) {
    return (spans || []).findIndex((r) => !!r && r.start <= t && t < r.end);
  }

  window.BC_FOLLOW = {progress, unhide, paraWords, centerTop, nearestTop, activeAt};
})();
