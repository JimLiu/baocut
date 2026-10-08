/* 视频元素的纯模型：演示 clip → 普通视频元素，以及「在播放头分割」（2026-09-16）。
   没有主视频（§11 / §12.6 / §19）：项目原片只是 `kind:'video'` 的普通元素，所有轨道平等。
   `fromSource` 只剩一个含义——「这段元素绑着转录 / 源时钟」（`model-cut.js toTimeline`
   用它把源时间映射到时间轴时间），不再表示「主轨」。 */
(function () {
  const EDGE = 0.05;   // 离片段两端不足这么多秒不切（切出来的是一条看不见的碎片）

  function initial(clips, asset) {
    return clips.map(c => ({id:'video-'+c.id, kind:'video', icon:'video', name:'视频',
      asset, start:c.start, end:c.end, srcStart:c.src || 0, added:true, layer:0, fromSource:true,
      place:{x:50,y:50,w:100,h:100,scale:1,rot:0}, style:{vol:100,radius:0}}));
  }
  const sourceTime = (el, time) => Math.max(0, (el.srcStart || 0) + time - el.start);

  const merged = (elements, docs, id) => {
    const el = (elements || []).find(e => e.id === id);
    return el ? Object.assign({}, el, (docs || {})[id]) : null;
  };
  /** `t` 是否落在这件视频元素可切的区间里（两端各留 EDGE） */
  function canSplit(el, t) {
    if (!el || el.kind !== 'video' || el.end == null) return false;
    return t - el.start >= EDGE && el.end - t >= EDGE;
  }
  /** 播放头处该切哪一件：选中的视频元素压在播放头上就切它；否则取压在播放头上的**最上层**
      视频元素（元素表后者在上）；没有返回 null。停用的元素不算。 */
  function splitTarget(elements, docs, t, selId) {
    const list = (elements || []).map(e => Object.assign({}, e, (docs || {})[e.id]))
      .filter(e => !e.hidden && canSplit(e, t));
    if (selId) { const s = list.find(e => e.id === selId); if (s) return s; }
    return list.length ? list[list.length - 1] : null;
  }
  /**
   * 把视频元素 `id` 在时间轴时刻 `t` 一分为二。返回 `{left, right}`：
   *   left  = `{id, end: t}`——原件留 id、收尾到 t（调用方 `setElDoc`）；
   *   right = 新元素：新 id、`start = t`、`srcStart` 按 `(t − start) × rate` 推进，
   *           摆位 / 样式 / 文档字段（静音、动画…）原样复制。
   * 不可切（不是视频、离两端太近、找不到）返回 null。`opts.id` 指定右半的 id。
   */
  function splitElementAt(elements, docs, id, t, opts) {
    const el = merged(elements, docs, id);
    if (!canSplit(el, t)) return null;
    const rate = el.rate || 1;
    const right = Object.assign({}, el, {
      id: (opts && opts.id) || (id + '-s' + Math.round(t * 100)),
      start: t, srcStart: (el.srcStart || 0) + (t - el.start) * rate, added: true,
    });
    delete right.endAnchor; delete right.members;
    return {left: {id, end: t}, right};
  }
  window.BC_VIDEO_EDIT = {initial, sourceTime, canSplit, splitTarget, splitElementAt, SPLIT_EDGE: EDGE};
})();
