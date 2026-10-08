/* 时间轴的「删掉一段并前移」—— window.BC_RIPPLE。纯函数，无 React、无 DOM。

   两个入口共用这一份算式（2026-10-08）：
     · 删除选中（Delete / 删除钮）：删完以后，删掉的那几段里**所有轨道都空了**的部分合拢，
       后面的内容前移、总长变短；只删空了一条轨（例如只删视频、字幕还在）就留空隙——
       字幕句间原本就有的停顿算占着（`cueCover`）。
     · 从所有轨道删除一段（右键菜单 / ⇧⌫）：把这段时间从每一条轨上拿掉，跨在边上的
       内容裁掉落在段里的部分，后面的内容前移。

   语义对照视频格式规范 §6.4 与命令协议规范的 `removeRange`（波纹删除）：段内整件删掉；
   跨左缘的收尾到段首；跨右缘的从段尾起、整体前移，媒体的 `srcStart` 按 `(段尾 − 原起点) × rate`
   推进；整段落在一件媒体里时切成两件、右半前移；没有源时钟的元素、字幕条与章节只缩短。
   多段从右往左处理，前面那段的时刻不受后面那段影响。 */
(function () {
  const EPS = 0.001;
  /* 小于这个长度的空隙不合拢：两件首尾相接时浮点误差留下的缝，不是用户删出来的空。 */
  const MIN_GAP = 0.05;
  const round3 = (v) => Math.round(v * 1000) / 1000;

  /** 一组区间的并集，按起点排好、相接的并成一段。 */
  function merge(spans) {
    const list = (spans || []).filter((s) => s && s.end - s.start > EPS)
      .map((s) => ({start: s.start, end: s.end}))
      .sort((a, b) => a.start - b.start);
    const out = [];
    list.forEach((s) => {
      const last = out[out.length - 1];
      if (last && s.start <= last.end + EPS) last.end = Math.max(last.end, s.end);
      else out.push(s);
    });
    return out;
  }

  /** `spans` 里没被 `cover` 盖住的部分。 */
  function uncovered(spans, cover) {
    const holes = merge(cover);
    const out = [];
    merge(spans).forEach((s) => {
      let at = s.start;
      holes.forEach((h) => {
        if (h.end <= at + EPS || h.start >= s.end - EPS) return;
        if (h.start > at + EPS) out.push({start: at, end: h.start});
        at = Math.max(at, h.end);
      });
      if (s.end > at + EPS) out.push({start: at, end: s.end});
    });
    return out;
  }

  /**
   * 字幕轨占着的时间：留下的句子，加上**原本就有的停顿**——相邻两句都还在时，两句之间算占着；
   * 首句还在时片头到首句、末句还在时末句到 `dur` 也算。只删视频、字幕没动时，句间停顿不会被
   * 当成「所有轨道都空了」合拢掉（那会让字幕一截一截往前缩）；删掉句子空出来的地方才算空。
   * `gone` 是这次删掉的 cue id。
   */
  function cueCover(cues, gone, dur) {
    const list = (cues || []).slice().sort((a, b) => a.start - b.start);
    const keep = (cu) => (gone || []).indexOf(cu.id) < 0;
    const out = list.filter(keep).map((cu) => ({start: cu.start, end: cu.end}));
    list.forEach((cu, i) => {
      const next = list[i + 1];
      if (next && keep(cu) && keep(next) && next.start > cu.end) out.push({start: cu.end, end: next.start});
    });
    const first = list[0], last = list[list.length - 1];
    if (first && keep(first)) out.push({start: 0, end: first.start});
    if (last && keep(last) && dur > last.end) out.push({start: last.end, end: dur});
    return out;
  }

  /** 删除之后要合拢的空隙：删掉的那几段里，留下的内容在任何一条轨上都不再盖到的部分。 */
  function gapsAfterDelete(deleted, remaining) {
    return uncovered(deleted, remaining).filter((g) => g.end - g.start >= MIN_GAP)
      .map((g) => ({start: round3(g.start), end: round3(g.end)}));
  }

  /**
   * 一件带时段的东西在拿掉 `[a, b]` 之后变成什么：返回 0、1 或 2 件。
   * `opts.media` 为真时整段落在它里面会切成两件（右半带 `opts.splitId`），并推进 `srcStart`；
   * 否则只缩短。未变的原样返回同一个对象，调用方据此跳过写入。
   */
  function cutItem(item, a, b, opts) {
    const o = opts || {};
    const len = b - a;
    const s = item.start;
    const e = item.end == null ? Infinity : item.end;
    if (e <= a + EPS) return [item];
    const rate = item.rate || 1;
    const shiftEnd = (v) => (v === Infinity ? item.end : round3(v - len));
    if (s >= b - EPS) return [Object.assign({}, item, {start: round3(s - len), end: shiftEnd(e)})];
    if (s >= a - EPS && e <= b + EPS) return [];
    if (s < a && e <= b + EPS) return [Object.assign({}, item, {end: round3(a)})];
    const tail = (from) => {
      const out = {start: round3(a), end: shiftEnd(e)};
      if (o.media) out.srcStart = round3((item.srcStart || 0) + (b - from) * rate);
      return out;
    };
    if (s >= a - EPS) return [Object.assign({}, item, tail(s))];
    /* s < a < b < e：整段落在这一件里 */
    if (!o.media) return [Object.assign({}, item, {end: shiftEnd(e)})];
    const left = Object.assign({}, item, {end: round3(a)});
    const right = Object.assign({}, item, tail(s), {id: o.splitId || (item.id + '-r')});
    return [left, right];
  }

  /**
   * 从所有轨道拿掉若干段。`model = {elements, cues, chapters}`，每件都有 `start / end`；
   * 元素 `kind === 'video'` 或带 `srcStart` 的按媒体处理。`splitId(el, span)` 给切出来的右半起 id。
   * 返回 `{elements, cues, chapters, removed, closed}`：`removed` 是整件消失的元素 id，
   * `closed` 是合拢掉的总秒数。
   */
  function removeSpans(model, spans, opts) {
    const o = opts || {};
    const ranges = merge(spans).sort((x, y) => y.start - x.start);
    let elements = (model.elements || []).slice();
    let cues = (model.cues || []).slice();
    let chapters = (model.chapters || []).slice();
    const removed = [];
    ranges.forEach((r) => {
      const next = [];
      elements.forEach((el) => {
        const media = el.kind === 'video' || el.srcStart != null;
        const out = cutItem(el, r.start, r.end, {media, splitId: o.splitId ? o.splitId(el, r) : null});
        if (!out.length) removed.push(el.id);
        out.forEach((x) => next.push(x));
      });
      elements = next;
      cues = cues.flatMap((c) => cutItem(c, r.start, r.end));
      chapters = chapters.flatMap((c) => cutItem(c, r.start, r.end));
    });
    const closed = round3(ranges.reduce((n, r) => n + (r.end - r.start), 0));
    return {elements, cues, chapters, removed: removed.filter((id) => elements.every((e) => e.id !== id)), closed};
  }

  /** 一个时刻（播放头）在拿掉 `spans` 之后落在哪：段后的前移，落在段里的回到段首。 */
  function shiftTime(t, spans) {
    return round3(merge(spans).sort((x, y) => y.start - x.start).reduce((v, r) => (
      v >= r.end ? v - (r.end - r.start) : v > r.start ? r.start : v), t));
  }

  window.BC_RIPPLE = {EPS, MIN_GAP, merge, uncovered, cueCover, gapsAfterDelete, cutItem, removeSpans, shiftTime};
})();
