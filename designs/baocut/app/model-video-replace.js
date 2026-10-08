/* 替换视频的纯模型（2026-09-16 二次修订，按用户拍板）：
   · 不检查时长——选了就换。新视频多长，片段就多长：这条轨道只有它，轨道跟着变长变短；
     和别的视频同在一条轨道，它变长就把后面的片段往后推，变短就把后面的往前拉（ripple）。
   · 同一原片裁出来的产物（`source.crop`）仍按原片时间对齐，片段时长不变——换的是同一段内容的另一种裁法。
   · 一份成片对应时间轴上的**一段视频**，不是一堆碎片：`planSource` 把用同一原片的所有片段
     （剪口拆出来的六段也算）一次换掉、剪口不动；不在生成范围里的片段保持原样。
   · 改项目画幅只是可选项：不勾就保持画幅，新素材按高居中放入。 */
(function () {
  const EPS = 0.001, MIN_LEN = 0.1;
  const snapshot = target => JSON.parse(JSON.stringify(target));
  const sameSource = (target, source) => {
    if (!target || !source) return false;
    const id = target.srcId || target.sourceId;
    return id ? id === source.id : target.asset === source.name;
  };
  const sourceFor = (target, sources) => (sources || []).find(source => sameSource(target, source)) || null;
  const aligned = (target, source) => !!source?.crop && sameSource(target, {id:source.crop.sourceId,name:source.crop.sourceName});
  function fullFrame(target, original, canvasRatio) {
    if (target.mode === 'fullscreen' && !target.pose) return true;
    const p = {...target.place, ...target.pose}, w = p.w ?? 34;
    const parts = String(canvasRatio).split(':').map(Number), canvas = parts[0] / parts[1];
    const sourceRatio = original?.naturalW / original?.naturalH;
    const height = p.h ?? (Number.isFinite(sourceRatio) ? w * canvas / sourceRatio : 0);
    return Math.abs(w - 100) < .1 && Math.abs(height - 100) < .1
      && Math.abs((p.x ?? 50)-50) < .1 && Math.abs((p.y ?? 50)-50) < .1
      && Math.abs((p.scale ?? 1)-1) < .00001 && Math.abs(p.rot || 0) < .00001;
  }
  function initialStart(target, source) {
    const recipe = source?.crop;
    if (aligned(target, source))
      return Math.max(0, (target.srcStart || 0) - recipe.range.start);
    return sameSource(target, source) ? target.srcStart || 0 : 0;
  }
  /** 同源成片是否盖住了这个片段消费的原片区间（盖住才按原片时间对齐；没盖住就当普通视频换）。 */
  function covered(target, source) {
    if (!aligned(target, source)) return false;
    const r = source.crop.range, u = target.srcStart || 0, rate = target.rate ?? 1;
    return u + EPS >= r.start && u + (target.end - target.start) * rate <= r.end + EPS;
  }
  /** 时间轴上和目标同一条轨道的视频片段（镜像 `BC_TIMELINE.laneFit` 的 first-fit 分道）。 */
  function lane(target, elements, docs) {
    const list = (elements || []).map(e => ({...e, ...(docs || {})[e.id]})).filter(e => e.kind === 'video' && e.end != null);
    const ordered = list.map((e, i) => [e, i]).sort((a, b) => a[0].start - b[0].start || a[1] - b[1]);
    const lanes = [];
    ordered.forEach(([e]) => {
      let i = lanes.findIndex(l => l[l.length - 1].end <= e.start + EPS);
      if (i < 0) { lanes.push([]); i = lanes.length - 1; }
      lanes[i].push(e);
    });
    return lanes.find(l => l.some(e => e.id === target.id)) || [target];
  }
  /** 一次替换的计划：换哪份素材、片段变多长、同轨后面的片段挪到哪。不改时间轴，只算。
   *  新素材一律从 0 秒起（2026-09-16 二次修订去掉了开始时间输入）；同源成片按原片时间对齐。 */
  function plan({expected, target, source, sourceStart = 0, elements = [], docs = {}}) {
    const fail = reason => ({ok: false, reason});
    if (!target || JSON.stringify(expected) !== JSON.stringify(target)) return fail('目标片段已变化，请关闭后重新发起替换。');
    if (target.locked) return fail('目标片段已锁定，请先解锁。');
    if (target.kind !== 'video') return fail('请选择一个视频片段。');
    if (!source) return fail('选择用来替换的视频素材。');
    if (!Number.isFinite(sourceStart) || sourceStart < 0) return fail('素材开始时间无效。');
    const rate = target.rate ?? 1, oldLen = target.end - target.start;
    const isAligned = covered(target, source);
    let srcStart = sourceStart, newLen = oldLen, mode = 'full';
    if (isAligned) { srcStart = (target.srcStart || 0) - source.crop.range.start; mode = 'aligned'; }
    else if (Number.isFinite(source.dur) && source.dur > 0) {
      if (sourceStart >= source.dur - EPS) return fail(`开始时间超出素材时长（${source.dur.toFixed(1)} 秒）。`);
      newLen = Math.max(MIN_LEN, (source.dur - sourceStart) / (rate > 0 ? rate : 1));
    } else mode = 'keep';   // 时长未知：先保留原时长
    const delta = +(newLen - oldLen).toFixed(3), newEnd = +(target.start + newLen).toFixed(3);
    const track = lane(target, elements, docs);
    const after = delta ? track.filter(e => e.id !== target.id && e.start + EPS >= target.end) : [];
    const ripple = after.map(e => ({id: e.id, start: +(e.start + delta).toFixed(3), end: +(e.end + delta).toFixed(3)}));
    const patch = {asset: source.name, srcId: source.id, srcStart, naturalW: source.naturalW || null, naturalH: source.naturalH || null,
      crop: source.crop || null};
    if (delta) patch.end = newEnd;
    return {ok: true, reason: '', mode, patch, delta, newLen, oldLen, alone: track.length === 1, ripple};
  }
  /** 一份成片换掉时间轴上用同一原片的所有片段：盖住的按原片时间对齐一起换，没盖住的保持原样。 */
  function planSource({elements = [], docs = {}, output}) {
    if (!output || !output.crop) return {instances: [], replaced: [], outside: [], already: []};
    const key = {id: output.crop.sourceId, name: output.crop.sourceName};
    const merged = elements.map(e => ({...e, ...docs[e.id]})).filter(e => e.kind === 'video');
    const already = merged.filter(e => sameSource(e, output));   // 已经在用这份成片的片段
    const instances = merged.filter(e => sameSource(e, key)).sort((a, b) => a.start - b.start);
    const replaced = [], outside = [];
    instances.forEach(target => {
      if (target.locked || !covered(target, output)) { outside.push(target); return; }
      const p = plan({expected: snapshot(target), target, source: output, sourceStart: initialStart(target, output), elements, docs});
      if (p.ok) replaced.push({id: target.id, name: target.asset || target.name, start: target.start, end: target.end, patch: p.patch}); else outside.push(target);
    });
    const span = instances.length ? {start: instances[0].start, end: Math.max(...instances.map(e => e.end))} : null;
    return {instances, replaced, outside, span, already};
  }
  /** 保持项目画幅时新素材的摆位：按高铺满、居中，两侧留画布底色，不拉伸。 */
  function keepPlace(place, outRatio, canvasRatio) {
    const w = Math.min(100, Math.round(100 * outRatio / canvasRatio * 10) / 10);
    return {...(place || {}), x: 50, y: 50, w, h: 100, scale: 1, rot: 0};
  }
  /** 一句话说清这次替换对时间轴的影响。 */
  function describe(p) {
    if (!p || !p.ok) return '';
    if (p.mode === 'aligned') return '同一原片裁出来的，按原片时间对齐，片段时长不变。';
    if (p.mode === 'keep') return '素材时长未知，先保留片段原时长。';
    const d = Math.abs(p.delta), n = p.ripple.length;
    if (d < EPS) return '新素材和片段一样长，时间轴不变。';
    const dir = p.delta > 0 ? '长' : '短';
    if (p.alone || !n) return `片段会变${dir} ${d.toFixed(1)} 秒，这条轨道跟着变${dir}。`;
    return `片段会变${dir} ${d.toFixed(1)} 秒，同轨后面 ${n} 段往${p.delta > 0 ? '后' : '前'}挪。`;
  }
  /** 完成页 / 素材菜单要的一份汇总：换几段、换的是谁、画幅和画布是否不同（canvasRatio 是数值）。 */
  function replaceGroup({elements = [], docs = {}, sources = [], output, canvasRatio}) {
    const p = planSource({elements, docs, output});
    const original = (sources || []).find(s => output?.crop && s.id === output.crop.sourceId) || null;
    const outRatio = output?.naturalW && output?.naturalH ? output.naturalW / output.naturalH : (output?.crop?.ratio || null);
    const ratioDiffers = !!(outRatio && canvasRatio > 0 && Math.abs(outRatio - canvasRatio) > 1e-6);
    return {...p, count: p.instances.length, name: original ? original.name : (output?.crop?.sourceName || ''), ratioDiffers, outRatio};
  }
  const api = {snapshot, sameSource, sourceFor, aligned, covered, fullFrame, initialStart, lane, plan, planSource, replaceGroup, keepPlace, describe};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.BC_VIDEO_REPLACE = api;
})();
