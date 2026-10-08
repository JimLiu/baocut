/* Text inspector decisions. Appearance patches never replace typography or timing. */
(function () {
  const effectPatch = (preset) => Object.assign({bg: null, ol: null, sh: null, alpha: 1}, preset.style);
  const enabled = (effect) => !!effect && effect.enabled !== false;
  const toggleEffect = (effect, defaults, on) => Object.assign({}, defaults, effect, {enabled: on});
  const comparable = (key, value) => {
    if (value == null) return key === 'alpha' ? 1 : null;
    if (typeof value !== 'object') return value;
    if (value.enabled === false) return null;
    return Object.fromEntries(Object.keys(value).filter((k) => k !== 'enabled').sort().map((k) => [k, value[k]]));
  };
  const presetOf = (style, presets) => (presets || []).find((p) => {
    const patch = effectPatch(p);
    return Object.keys(patch).every((key) => JSON.stringify(comparable(key, style[key])) === JSON.stringify(comparable(key, patch[key])));
  });
  const duration = (slot, cur) => cur && cur.dur || (slot === 'loop' ? 2 : 0.6);
  function chooseAnimation(slot, item, cur) {
    if (item.k === 'none') return {k: 'none'};
    return {k: item.k, dur: duration(slot, cur),
      dir: item.dirs ? (item.dirs.some((d) => d.k === cur.dir) ? cur.dir : item.dirs[0].k) : null};
  }
  const api = {effectPatch, enabled, toggleEffect, presetOf, duration, chooseAnimation};
  if (typeof window !== 'undefined') window.BC_TEXT_CONTROLS = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
