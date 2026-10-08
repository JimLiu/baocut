/* Continuous renderer-neutral samples. Parity fixtures come from
   bcut-subtitle-render::word_motion; legacy CSS signature samples are not used. */
(function () {
  const ease = (name, p) => {
    p = Math.max(0, Math.min(1, p));
    switch (name) {
      case 'sinIn': return 1 - Math.cos(p * Math.PI / 2);
      case 'sinOut': case 'sinout': return Math.sin(p * Math.PI / 2);
      case 'sinInOut': return (1 - Math.cos(p * Math.PI)) / 2;
      case 'expoOut': return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
      case 'cubicOut': return 1 - Math.pow(1 - p, 3);
      case 'quadOut': return 1 - Math.pow(1 - p, 2);
      case 'squareIn': return 0;
      case 'squareOut': return 1;
      case 'squareInOut': return Math.round(p);
      default: return p;
    }
  };
  const identity = () => ({opacity: 1, scale: 1, dy: 0, rx: 0, ry: 0, rz: 0, tint: false, chip: null, centered: false, blockScaled: false});
  const randomCache = new Map();
  function seededUnit(seed) {
    if (randomCache.has(seed)) return randomCache.get(seed);
    const a = new Uint32Array(624); a.fill(0x8b8b8b8b);
    const mix = x => (x ^ (x >>> 27)) >>> 0;
    let r1 = Math.imul(1664525, mix(a[0] ^ a[306] ^ a[623])) >>> 0, r2 = (r1 + 1) >>> 0;
    a[306] += r1; a[317] += r2; a[0] = r2;
    for (let k = 1; k < 624; k++) {
      r1 = Math.imul(1664525, mix(a[k] ^ a[(k + 306) % 624] ^ a[k - 1])) >>> 0;
      r2 = (r1 + k + (k === 1 ? seed : 0)) >>> 0;
      a[(k + 306) % 624] += r1; a[(k + 317) % 624] += r2; a[k] = r2;
    }
    for (let k = 624; k < 1248; k++) {
      const j = k % 624, r3 = Math.imul(1566083941, mix((a[j] + a[(k + 306) % 624] + a[(k - 1) % 624]) >>> 0)) >>> 0, r4 = (r3 - j) >>> 0;
      a[(k + 306) % 624] ^= r3; a[(k + 317) % 624] ^= r4; a[j] = r4;
    }
    let y = (a[397] ^ (((a[0] & 0x80000000) | (a[1] & 0x7fffffff)) >>> 1) ^ (a[1] & 1 ? 0x9908b0df : 0)) >>> 0;
    y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18;
    const result = Math.fround(Math.fround(y >>> 0) * 2 ** -32);
    if (randomCache.size >= 32) randomCache.clear(); randomCache.set(seed, result);
    return result;
  }
  const lerp = (a, b, p) => a + (b - a) * p;
  function sample(track, t, series) {
    const ks = track.keyframes;
    let a = ks[0], b = a, p = 0;
    if (t >= ks[ks.length - 1].time) a = b = ks[ks.length - 1];
    else if (t > a.time) {
      const i = ks.findIndex((k) => k.time > t);
      a = ks[i - 1]; b = ks[i]; p = ease(b.easing, b.easing === 'squareInOut' ? t : (t - a.time) / (b.time - a.time));
    }
    const value = (key, axis, fallback) => lerp(a[key]?.[axis] ?? fallback, b[key]?.[axis] ?? fallback, p);
    const out = {};
    if (a.translate || b.translate) out.dy = value('translate', 'y', 0);
    if (a.scale || b.scale) out.scale = value('scale', 'x', 1);
    if (a.rotation || b.rotation) {
      out.rx = value('rotation', 'x', 0); out.ry = value('rotation', 'y', 0); out.rz = value('rotation', 'z', 0);
      const range = track.kf === 'rotateFlipClock' ? 5 : track.kf === 'randomRotate' ? 3 : 0;
      if (range) {
        const direction = series % 2 ? -1 : 1;
        out.rx *= direction;
        out.ry = out.ry * direction + (track.kf === 'randomRotate' ? seededUnit(series) * 0.5 : 0);
        out.rz = out.rz * direction + (seededUnit(series) * 2 - 1) * range;
      }
    }
    if (a.colour || b.colour) {
      out.opacity = value('colour', 'a', 1);
      const c = a.colour || {};
      if (c.useCustom != null || c.useSecondary != null || c.mixSecondary != null)
        out.tint = (c.mixSecondary ?? (c.useCustom || c.useSecondary ? 1 : 0)) > 0.5;
    }
    if (a.box || b.box) {
      const x = a.box || b.box, y = b.box || x;
      out.chip = {scale: lerp(x.scale?.x ?? 1, y.scale?.x ?? 1, p),
        alpha: lerp(x.colour?.a ?? 1, y.colour?.a ?? 1, p), corner_rounding: x.cornerRounding};
    }
    return out;
  }
  function frame(id, seconds, count = 4) {
    seconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0.675;
    const duration = count * 0.5, cycle = duration + 0.5, elapsed = seconds % cycle;
    const series = Math.floor(seconds / cycle), result = {block: identity(), words: Array.from({length: count}, identity)};
    const length = id === 'flipClock' || id === 'stomp' ? Math.min(duration * 0.7, 1) : 0.5;
    for (const track of window.BC_SA.tracksOf(id)) {
      if (track.group === 'block') {
        Object.assign(result.block, sample(track, elapsed / length, series));
        result.block.centered ||= !!track.centreElements;
        result.block.blockScaled ||= !!track.blockScaling;
      }
      else result.words.forEach((pose, i) => {
        const part = sample(track, Math.max(0, Math.min(1, (elapsed - i * 0.5) / 0.5)), series);
        if (part.chip && (elapsed < i * 0.5 || elapsed >= (i + 1) * 0.5)) part.chip = null;
        Object.assign(pose, part);
        pose.centered ||= !!track.centreElements;
        pose.blockScaled ||= !!track.blockScaling;
      });
    }
    return result;
  }
  window.BC_SC = {ease, frame, seededUnit};
})();
