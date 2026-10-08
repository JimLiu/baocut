/* 普通视频边界转场的原型状态与预览采样。不是 BCF 格式扩展。 */
(function () {
  const PRESETS = [
    {k: 'none', label: '无'}, {k: 'dissolve', label: '叠化'},
    {k: 'wipe', label: '擦除'}, {k: 'slide', label: '滑入'},
    {k: 'zoom', label: '缩放'}, {k: 'iris', label: '圆形展开'},
  ];
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function normalize(value, length) {
    const max = Math.max(0, Math.min(2, Number.isFinite(length) ? length / 2 : 2));
    return {k: PRESETS.some(p => p.k === value?.k) ? value.k : 'none',
      dur: clamp(Number.isFinite(value?.dur) ? value.dur : 0.5, Math.min(0.1, max), max)};
  }
  // progress 是可见比例；进入 0→1，离开 1→0。内容层独立于选中几何。
  function style(k, progress) {
    const p = clamp(progress, 0, 1);
    if (k === 'none' || p === 1) return {};
    if (k === 'wipe') return {clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`};
    if (k === 'slide') return {transform: `translateX(${(p - 1) * 100}%)`, opacity: p};
    if (k === 'zoom') return {transform: `scale(${0.75 + p * 0.25})`, opacity: p};
    if (k === 'iris') return {clipPath: `circle(${p * 72}% at 50% 50%)`};
    return {opacity: p};
  }
  function at(transitions, time, length) {
    if (time < 0 || time >= length || length <= 0) return {opacity: 0};
    for (const slot of ['in', 'out']) {
      const v = normalize(transitions?.[slot], length);
      const edge = slot === 'in' ? time : length - time;
      if (v.k !== 'none' && v.dur > 0 && edge < v.dur) return style(v.k, edge / v.dur);
    }
    return {};
  }
  window.BC_VIDEO_TRANSITION = {PRESETS, normalize, style, at};
})();
