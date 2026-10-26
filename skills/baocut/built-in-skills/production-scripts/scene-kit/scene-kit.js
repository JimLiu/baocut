// Drawing mechanics for production-scripts code scenes (baocut/1, one canvas, drawn from scratch every frame),
// first written for history-video intros.
// Copy into the project's shared/ and trim what you do not use. It has no look of its own:
// the scene sets this episode's colours and font families with K.style({...}) before K.scene(draw).
//
//   K.style({ bg, ink, muted, accent, print, plate, halo, land, sea, coast,
//             fonts: { body, title, latin, mono }, aiLabel, creditFont })
//   K.img('house.jpg')          // at the top level of the scene, so initialize() waits for it
//   K.scene((ctx, t) => { K.clear(ctx); ... })   // t = seconds from the start of this segment
//
// Motion feel: K.cam(t, keys) + K.lens(ctx, c) is one 2D camera for the whole frame (eased in-out, zoom in log space);
// K.spring(t, t0) is a damped spring for pops and landings; K.ambient(t) is the clock for twinkle, spin and bob,
// carried across segments that production.json lists in continues. Story state (which step, which reading) stays a
// function of t (or of a story clock you derive from t), so a replay or rewind of the story never rewinds the stars.
//
// Timing comes from window.TIMING (build.mjs): lines[i].chars are per-character start times,
// clips[] are this segment's clips (at/end in segment seconds, box in canvas px, words[{t,s,e}] in segment seconds),
// credits{file: line} are the on-screen source lines from sources.json.
// build.mjs, quotes.mjs and sources.mjs write these fields; change their format and this file together.
// Baking rules kept here: one canvas, full clear every frame, no main-canvas readback, no ctx.filter,
// no letterSpacing (manual tracking instead), unscaled images on integer pixels, textures blitted 1:1.
// Over a photo or footage frame draw at most one full-frame translucent layer live (shade, wash, fade);
// vignette(), edge() and grain() are pre-rendered bitmaps for that reason. To darken a photo, prefer
// full(ctx, im, { alpha }) over a dark clear() to shade() on top of it.
(function () {
  const root = document.getElementById('root');
  const W = Number(root?.dataset.width) || 1920, H = Number(root?.dataset.height) || 1080;

  // ---------- style ----------
  const S = {
    bg: '#000000', ink: '#ffffff', muted: '#9a9a9a', accent: '#ffffff', print: '#f4f4f4', plate: '#111111',
    halo: 'rgba(0,0,0,0.6)', land: '#cccccc', sea: '#888888', coast: '#555555', shadow: 'rgba(0,0,0,0.35)',
    fonts: { body: 'sans-serif', title: 'sans-serif', latin: 'sans-serif', mono: 'monospace' },
    aiLabel: '', creditFont: 'body', creditSize: 16,
  };
  function style(o) {
    Object.assign(S, o, { fonts: { ...S.fonts, ...(o.fonts || {}) } });
    return S;
  }

  // ---------- math ----------
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));
  const ease = {
    lin: k => k,
    io: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    out: k => 1 - Math.pow(1 - k, 3),
    in: k => k * k * k,
    sine: k => -(Math.cos(Math.PI * k) - 1) / 2,
    back: k => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  };
  const io = (t, a, b) => ease.io(prog(t, a, b));
  const out = (t, a, b) => ease.out(prog(t, a, b));
  // fade in over [a, b], out over [c, d]
  const win = (t, a, b, c = Infinity, d = Infinity) => Math.min(ease.sine(prog(t, a, b)), 1 - ease.sine(prog(t, c, d)));
  // zoom or scale between a and b in log space: the same ratio every second, so a push-in from 1 to 8 does not seem to brake
  const zlerp = (a, b, k) => Math.exp(lerp(Math.log(a), Math.log(b), k));
  // damped spring from 0 to 1 that fires at t0 (seconds): 0 before t0, overshoots, settles on 1.
  // zeta 0.42-0.5 with omega 12-16 rad/s (about 2-2.5 Hz) overshoots ~20% and settles in 0.5-0.7 s; raise zeta toward 0.7 for a calmer land.
  // It passes 1 on purpose: test "has it appeared" with t >= t0, not with the value.
  function spring(t, t0, o = {}) {
    const x = t - t0;
    if (!(x > 0)) return 0;
    const z = o.zeta ?? 0.45, w = o.omega ?? 14;
    if (z >= 1) return 1 - Math.exp(-w * x) * (1 + w * x);
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + (z * w / wd) * Math.sin(wd * x));
  }
  // 2D camera keys [{ t, x, y, zoom, rot?, from? }]: (x, y) is the canvas point at the centre of the screen.
  // Between keys it eases in-out (cubic) from `from` (default the previous key's t) to t; zoom moves in log space.
  // Put each key's t on the spoken word (at()), so the camera settles as the word lands.
  function cam(t, keys) {
    if (t <= keys[0].t) return keys[0];
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1], b = keys[i];
      if (t <= b.t) {
        const k = ease.io(prog(t, b.from ?? a.t, b.t));
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), zoom: zlerp(a.zoom ?? 1, b.zoom ?? 1, k), rot: lerp(a.rot || 0, b.rot || 0, k) };
      }
    }
    return keys[keys.length - 1];
  }
  // draw the world through camera c from here on (world units = canvas px at zoom 1); reset(ctx) before screen-space text
  function lens(ctx, c) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(W / 2, H / 2);
    ctx.scale(c.zoom ?? 1, c.zoom ?? 1);
    if (c.rot) ctx.rotate(c.rot);
    ctx.translate(-c.x, -c.y);
  }

  // ---------- timing ----------
  const TM = () => window.TIMING || { lines: [], dur: 0 };
  // environment clock (twinkle, spin, bob, drifting particles): continues from the previous segment when production.json
  // lists this one in continues, so the motion does not jump back to 0 at the seam
  const ambient = t => (TM().ambient || 0) + t;
  const line = i => TM().lines[i];
  // when the k-th character of `sub` in narration line i is spoken ('end' = its last character)
  function at(i, sub, k = 0) {
    const l = line(i);
    if (!l) { console.warn('no narration line', i); return 0; }
    if (!sub) return l.start;
    const idx = l.text.indexOf(sub);
    if (idx < 0) { console.warn('cue not found', i, sub); return l.start; }
    const j = Math.min(idx + (k === 'end' ? sub.length - 1 : k), (l.chars || []).length - 1);
    return l.chars ? l.chars[j] : l.start;
  }
  const lastEnd = () => { const L = TM().lines; return L.length ? L[L.length - 1].end : 0; };
  const dur = () => TM().dur;
  const clips = () => TM().clips || [];
  const clip = id => clips().find(c => c.id === id) || null;
  // the on-screen source line for a file (basename), or ''
  const credit = file => (TM().credits || {})[String(file).split('/').pop()] || '';

  // ---------- assets ----------
  const imgs = new Map();
  function img(name, dir = './img/') {
    const src = name.startsWith('./') ? name : dir + name;
    if (!imgs.has(src)) { const im = new Image(); im.src = src; imgs.set(src, im); }
    return imgs.get(src);
  }
  const aspect = (im, crop) => (crop ? crop[2] / crop[3] : im.naturalWidth / Math.max(1, im.naturalHeight));

  // ---------- grounds ----------
  function reset(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.setLineDash([]);
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  }
  // opaque full clear; every frame starts here
  function clear(ctx, color) {
    reset(ctx);
    ctx.fillStyle = color || S.bg;
    ctx.fillRect(0, 0, W, H);
  }
  // radial wash: stops = [[offset, colour], ...]; centre and radii as fractions of the canvas
  function wash(ctx, stops, o = {}) {
    const g = ctx.createRadialGradient(W * (o.cx ?? 0.5), H * (o.cy ?? 0.45), (o.r0 ?? 0.05) * W, W * (o.cx ?? 0.5), H * (o.cy ?? 0.5), (o.r1 ?? 0.72) * W);
    for (const [k, c] of stops) g.addColorStop(k, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // darkened edges, pre-rendered once per colour and blitted 1:1 (a live radial gradient over a photo
  // makes the baked frame drift from the browser's)
  const vignettes = new Map();
  function vignette(ctx, color = 'rgba(0,0,0,1)', a = 0.5) {
    if (a <= 0) return;
    if (!vignettes.has(color)) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, color);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      vignettes.set(color, c);
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= a; ctx.drawImage(vignettes.get(color), 0, 0); ctx.restore();
  }
  // one side darkened so text can sit on a full-frame picture (side: left | right | top | bottom, o.reach = fraction of
  // the frame the shade covers, o.stops = [[offset, alpha], ...]); pre-rendered once per look and blitted 1:1 like vignette()
  const edges = new Map();
  function edge(ctx, side = 'left', color = '0,0,0', a = 1, o = {}) {
    if (a <= 0) return;
    const reach = o.reach ?? 0.65, stops = o.stops || [[0, 0.82], [0.42, 0.55], [1, 0]];
    const key = `${side}|${color}|${reach}|${JSON.stringify(stops)}`;
    if (!edges.has(key)) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d'), across = side === 'left' || side === 'right' ? W : H, len = across * reach;
      const [x0, y0, x1, y1] = { left: [0, 0, len, 0], right: [W, 0, W - len, 0], top: [0, 0, 0, len], bottom: [0, H, 0, H - len] }[side];
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      for (const [k, al] of stops) gr.addColorStop(k, `rgba(${color},${al})`);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      edges.set(key, c);
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= a; ctx.drawImage(edges.get(key), 0, 0); ctx.restore();
  }
  // a flat full-frame tint; over a photo this is the one live layer, see the header
  function shade(ctx, color, a) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  // film / paper grain: a full-size texture made once and blitted 1:1 at (0, 0).
  // Stretching a small texture over the frame makes the baked frames differ from the browser.
  const grains = new Map();
  function grain(ctx, o = {}) {
    const a = o.alpha ?? 1;
    if (a <= 0) return;
    const key = `${o.seed ?? 1}|${o.tint || ''}|${o.amount ?? 16}`;
    if (!grains.has(key)) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      const d = g.createImageData(W, H);
      const [tr, tg, tb] = o.tint || [0, -4, -12];
      let s = o.seed ?? 20240917;
      for (let i = 0; i < d.data.length; i += 4) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const v = 90 + ((s >> 16) & 127);
        d.data[i] = v + tr; d.data[i + 1] = v + tg; d.data[i + 2] = v + tb; d.data[i + 3] = o.amount ?? 16;
      }
      g.putImageData(d, 0, 0);
      grains.set(key, c);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= a;
    ctx.drawImage(grains.get(key), 0, 0);
    ctx.restore();
  }

  // ---------- images ----------
  // draw `im` cover-fitted into (x, y, w, h); o.crop = [sx, sy, sw, sh] limits the source,
  // o.zoom >= 1 pushes in, o.fx / o.fy (0..1) pick where the push goes
  function cover(ctx, im, x, y, w, h, o = {}) {
    const iw = im.naturalWidth, ih = im.naturalHeight;
    if (!iw || !ih) return;
    const [sx, sy, sw, sh] = o.crop || [0, 0, iw, ih];
    const ar = w / h;
    let cw = sw, ch = sw / ar;
    if (ch > sh) { ch = sh; cw = sh * ar; }
    const z = Math.max(1, o.zoom || 1);
    cw /= z; ch /= z;
    const cx = sx + (sw - cw) * (o.fx ?? 0.5), cy = sy + (sh - ch) * (o.fy ?? 0.5);
    ctx.drawImage(im, cx, cy, cw, ch, x, y, w, h);
  }
  // full-frame photo (slow push: animate o.zoom); o.alpha fades it
  function full(ctx, im, o = {}) {
    const a = o.alpha ?? 1;
    if (a <= 0.002) return;
    ctx.save();
    ctx.globalAlpha *= a;
    cover(ctx, im, o.x ?? 0, o.y ?? 0, o.w ?? W, o.h ?? H, o);
    ctx.restore();
  }
  // a photographic print centred at (o.x, o.y): photo area o.w x o.h, border, shadow, optional caption and credit under it.
  // o.rot (degrees), o.s (scale), o.alpha; o.ai puts the AI label on it.
  function print(ctx, im, o) {
    const a = o.alpha ?? 1;
    if (a <= 0.002) return;
    const b = o.border ?? 12, w = o.w, h = o.h;
    const capSize = o.capSize || 22, credSize = o.credSize || 15;
    const capH = o.caption ? capSize * 2.3 + (o.credit ? credSize * 1.6 : 0) : 0;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(o.x, o.y);
    if (o.rot) ctx.rotate((o.rot * Math.PI) / 180);
    if (o.s && o.s !== 1) ctx.scale(o.s, o.s);
    if (o.shadow !== false) {
      ctx.shadowColor = o.shadowColor || S.shadow;
      ctx.shadowBlur = o.blur ?? 26;
      ctx.shadowOffsetY = o.drop ?? 10;
    }
    ctx.fillStyle = o.paper || S.print;
    ctx.fillRect(-w / 2 - b, -h / 2 - b, w + 2 * b, h + 2 * b + capH);
    ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    cover(ctx, im, -w / 2, -h / 2, w, h, o);
    if (o.caption) {
      text(ctx, o.caption, -w / 2, h / 2 + b + capSize * 1.4, { size: capSize, color: o.capColor || S.ink, font: o.capFont || 'body' });
      if (o.credit) text(ctx, o.credit, -w / 2, h / 2 + b + capSize * 1.4 + credSize * 1.7, { size: credSize, color: S.muted, font: S.creditFont });
    } else if (o.credit) {
      text(ctx, o.credit, w / 2 - 6, h / 2 - 10, { size: credSize, color: 'rgba(255,255,255,0.85)', align: 'right', font: S.creditFont, halo: 'rgba(0,0,0,0.45)', haloW: 4 });
    }
    if (o.ai) aiTag(ctx, -w / 2 + 14, -h / 2 + 14, { size: 18 });
    ctx.restore();
  }
  // a paper slip with one phrase on it, centred at (x, y), settling onto the table over k = 0..1 (a quote pulled out of
  // the recording, a slogan); o.out (0..1) lifts it away, o.under (0..1) draws an accent line under the words. Returns its box.
  function slip(ctx, s, x, y, k, o = {}) {
    const size = o.size || 60, pad = Math.round(size * 0.55);
    const w = Math.round(measure(ctx, s, size, o.font || 'title') + 2 * pad), h = Math.round(size * 1.75);
    const box = { x0: x - w / 2, y0: y - h / 2, w, h };
    const away = o.out || 0;
    if (k <= 0 || away >= 1) return box;
    const e = ease.out(k), eo = ease.sine(away);
    ctx.save();
    ctx.globalAlpha *= (o.alpha ?? 1) * Math.min(1, k * 2.2) * (1 - eo);
    ctx.translate(x, y - (1 - e) * 22 - eo * 24);
    ctx.rotate((((o.rot || 0) + (1 - e) * 2.5) * Math.PI) / 180);
    const sc = (o.s || 1) * lerp(1.04, 1, e);
    ctx.scale(sc, sc);
    ctx.save();
    ctx.shadowColor = o.shadowColor || S.shadow; ctx.shadowBlur = o.blur ?? 22; ctx.shadowOffsetY = o.drop ?? 8;
    ctx.fillStyle = o.paper || S.print;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
    text(ctx, s, 0, size * 0.36, { size, font: o.font || 'title', color: o.color || S.plate, align: 'center' });
    if (o.under > 0) {
      const tw = w - 2 * pad;
      ctx.fillStyle = o.accent || S.accent;
      ctx.fillRect(-tw / 2, Math.round(size * 0.56), tw * clamp(o.under), Math.max(3, Math.round(size * 0.07)));
    }
    ctx.restore();
    return box;
  }
  // a recording drawn as bars: env = { dur, bars: [0..1, ...] } (production-scripts envelope.mjs writes one into shared/).
  // k (0..1) draws it left to right; o.hot = [[from, to], ...] recording seconds drawn in the accent colour;
  // o.head (recording seconds) puts a playhead on it; o.color / o.hotColor / o.headColor override the style.
  function bars(ctx, env, x, y, w, h, k = 1, o = {}) {
    if (!env || !env.bars?.length || k <= 0) return;
    const n = env.bars.length, bw = w / n, hot = o.hot || [];
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    for (let i = 0; i < n * k; i++) {
      const t0 = (i / n) * env.dur, t1 = ((i + 1) / n) * env.dur;
      const bh = Math.max(2, env.bars[i] * h);
      ctx.fillStyle = hot.some(([p, q]) => t1 > p && t0 < q) ? o.hotColor || S.accent : o.color || S.muted;
      ctx.fillRect(Math.round(x + i * bw), Math.round(y + (h - bh) / 2), Math.max(1, Math.round(bw * (o.fill ?? 0.62))), Math.round(bh));
    }
    if (o.head != null) {
      ctx.fillStyle = o.headColor || S.ink;
      ctx.fillRect(Math.round(x + (w * o.head) / env.dur) - 1, Math.round(y - 10), 2, Math.round(h + 20));
    }
    ctx.restore();
  }
  // a magnified detail of `im` inside a circle (o.r) or a rectangle (o.w, o.h) centred at (o.x, o.y).
  // o.src = [sx, sy, sw, sh] is the detail in image pixels; o.ring colours the edge; o.alpha fades it.
  function loupe(ctx, im, o) {
    const a = o.alpha ?? 1;
    if (a <= 0.002) return;
    const round = o.r != null, w = round ? o.r * 2 : o.w, h = round ? o.r * 2 : o.h;
    const x0 = o.x - w / 2, y0 = o.y - h / 2;
    const shape = () => { ctx.beginPath(); if (round) ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); else ctx.rect(x0, y0, w, h); };
    ctx.save();
    ctx.globalAlpha *= a;
    if (o.shadow !== false) {
      ctx.save(); ctx.shadowColor = o.shadowColor || S.shadow; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
      shape(); ctx.fillStyle = o.ring || S.print; ctx.fill(); ctx.restore();
    }
    ctx.save(); shape(); ctx.clip();
    cover(ctx, im, x0, y0, w, h, { crop: o.src });
    ctx.restore();
    if (o.ring !== null) { shape(); ctx.lineWidth = o.ringW ?? 4; ctx.strokeStyle = o.ring || S.print; ctx.stroke(); }
    ctx.restore();
  }

  // ---------- text ----------
  // a role in S.fonts ('body', 'title', ...) or a family name
  const fam = f => S.fonts[f] || f || S.fonts.body;
  const font = (size, f) => `${size}px ${fam(f)}`;
  // a Latin-only face (latin, mono) has no CJK: a string with any goes to the body face, not a browser fallback
  // (a fallback font is a missing glyph to the instruction bake)
  const WIDE = /[⺀-鿿가-힯豈-﫿＀-￯]/;
  const roleFor = (s, f) => ((f === 'latin' || f === 'mono') && WIDE.test(s) ? 'body' : f);
  function measure(ctx, s, size, f) { ctx.font = font(size, roleFor(s, f)); return ctx.measureText(s).width; }
  // o: size, font, color, align, base, alpha, track (px between characters, instead of letterSpacing), halo (outline colour), haloW.
  // Returns the drawn width.
  function text(ctx, s, x, y, o = {}) {
    const a = o.alpha ?? 1;
    if (a <= 0.002 || !s) return 0;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.font = font(o.size || 32, roleFor(s, o.font));
    ctx.textBaseline = o.base || 'alphabetic';
    ctx.fillStyle = o.color || S.ink;
    const halo = (str, px) => { if (o.halo) { ctx.lineWidth = o.haloW || 6; ctx.strokeStyle = o.halo; ctx.lineJoin = 'round'; ctx.strokeText(str, px, y); } };
    let wTot;
    if (o.track) {
      const chars = [...s];
      const ws = chars.map(ch => ctx.measureText(ch).width);
      wTot = ws.reduce((p, q) => p + q, 0) + o.track * (chars.length - 1);
      let cx = o.align === 'center' ? x - wTot / 2 : o.align === 'right' ? x - wTot : x;
      ctx.textAlign = 'left';
      chars.forEach((ch, i) => { halo(ch, cx); ctx.fillText(ch, cx, y); cx += ws[i] + o.track; });
    } else {
      ctx.textAlign = o.align || 'left';
      wTot = ctx.measureText(s).width;
      halo(s, x);
      ctx.fillText(s, x, y);
    }
    ctx.restore();
    return wTot;
  }
  // characters appear one by one, each fading in over `soft` characters; k = 0..1 of the whole string.
  // o.cursor draws a caret after the last visible character.
  function typeOn(ctx, s, x, y, k, o = {}) {
    if (k <= 0) return;
    const chars = [...s];
    const soft = o.soft ?? 2;
    const n = k * (chars.length + soft);
    ctx.save();
    ctx.font = font(o.size || 32, roleFor(s, o.font));
    ctx.textBaseline = o.base || 'alphabetic';
    const ws = chars.map(ch => ctx.measureText(ch).width);
    const tr = o.track || 0;
    const tot = ws.reduce((p, q) => p + q, 0) + tr * (chars.length - 1);
    let cx = o.align === 'center' ? x - tot / 2 : o.align === 'right' ? x - tot : x;
    ctx.textAlign = 'left';
    ctx.fillStyle = o.color || S.ink;
    const base = ctx.globalAlpha * (o.alpha ?? 1);
    let caret = cx;
    chars.forEach((ch, i) => {
      const a = clamp((n - i) / soft);
      if (a > 0) {
        ctx.globalAlpha = base * a;
        ctx.fillText(ch, cx, y + (1 - a) * (o.rise ?? 0));
        caret = cx + ws[i];
      }
      cx += ws[i] + tr;
    });
    if (o.cursor && k < 1) { ctx.globalAlpha = base; ctx.fillRect(caret + 3, y - (o.size || 32) * 0.8, Math.max(2, (o.size || 32) * 0.08), (o.size || 32) * 0.95); }
    ctx.restore();
  }
  // greedy line breaking for CJK and Latin; closing punctuation stays on its line
  function wrap(ctx, s, maxW, size, f) {
    ctx.font = font(size, roleFor(s, f));
    const lines = [];
    let cur = '';
    const tokens = s.match(/[A-Za-z0-9À-ɏ'’.,;:!?\-–—()"“”]+\s*|\s+|./gu) || [];
    for (const tk of tokens) {
      const next = cur + tk;
      if (ctx.measureText(next.trimEnd()).width > maxW && cur) {
        if (/^[、。，；：！？」』）,.;:!?]/u.test(tk)) { lines.push((cur + tk).trimEnd()); cur = ''; continue; }
        lines.push(cur.trimEnd());
        cur = tk.trimStart();
      } else cur = next;
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    return lines;
  }
  // boxed label; returns its width
  function tag(ctx, s, x, y, o = {}) {
    const a = o.alpha ?? 1;
    if (a <= 0 || !s) return 0;
    const size = o.size || 20;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.font = font(size, o.font || 'title');
    const w = ctx.measureText(s).width + size * 1.0, h = size * 1.75;
    const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    ctx.fillStyle = o.bg || S.ink;
    ctx.fillRect(x0, y, w, h);
    ctx.fillStyle = o.color || S.bg;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(s, x0 + size * 0.5, y + h / 2 + 1);
    ctx.restore();
    return w;
  }
  // the "AI-generated illustration" label, in the film's language (S.aiLabel)
  function aiTag(ctx, x, y, o = {}) {
    if (!S.aiLabel) { console.warn('K.style({ aiLabel }) is not set; AI pictures must be labelled on screen'); return; }
    tag(ctx, S.aiLabel, x, y, { size: o.size || 18, align: o.align, alpha: o.alpha, bg: o.bg || 'rgba(0,0,0,0.7)', color: o.color || '#ffffff', font: o.font });
  }
  // a source line (from TIMING.credits or a literal) in a corner; align 'right' anchors at x
  function creditLine(ctx, s, x, y, o = {}) {
    if (!s) return;
    text(ctx, s, x, y, { size: o.size || S.creditSize, font: o.font || S.creditFont, color: o.color || S.muted, align: o.align || 'left', alpha: o.alpha, halo: o.halo, haloW: o.haloW || 4 });
  }

  // ---------- marks ----------
  // a line that grows over k = 0..1
  function rule(ctx, x, y, w, k, o = {}) {
    if (k <= 0) return;
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.fillStyle = o.color || S.accent;
    ctx.fillRect(o.align === 'right' ? x + w * (1 - k) : x, y, w * k, o.h || 3);
    ctx.restore();
  }
  // a rubber stamp that lands at t0
  function stamp(ctx, s, x, y, t, t0, o = {}) {
    const k = prog(t, t0, t0 + (o.d ?? 0.32));
    if (k <= 0) return;
    const sc = lerp(o.from ?? 1.7, 1, ease.out(k));
    const size = o.size || 44;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(((o.rot ?? -4) * Math.PI) / 180);
    ctx.scale(sc, sc);
    ctx.globalAlpha *= (o.alpha ?? 1) * Math.min(1, k * 1.6) * 0.92;
    ctx.font = font(size, o.font || 'title');
    const w = ctx.measureText(s).width + size * 0.9, h = size * 1.5;
    ctx.strokeStyle = ctx.fillStyle = o.color || S.accent;
    ctx.lineWidth = Math.max(2, size * 0.07);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.strokeRect(-w / 2 + size * 0.14, -h / 2 + size * 0.14, w - size * 0.28, h - size * 0.28);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, 0, size * 0.04);
    ctx.restore();
  }
  // a dot with an optional expanding ring (o.pulse: any number, its fraction is the phase)
  function dot(ctx, x, y, o = {}) {
    const a = o.alpha ?? 1;
    if (a <= 0) return;
    const r = o.r || 8;
    if (o.pulse != null) {
      const ph = ((o.pulse % 1) + 1) % 1;
      ctx.save();
      ctx.globalAlpha *= a * (1 - ph);
      ctx.strokeStyle = o.color || S.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, r + ph * r * 3.2, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.fillStyle = o.fill || o.color || S.accent;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (o.ring !== null) { ctx.strokeStyle = o.ring || S.bg; ctx.lineWidth = 2.5; ctx.stroke(); }
    ctx.restore();
  }
  // poly-line path up to fraction k of its length; returns { tip, dir } for an arrow head. Stroke or fill it yourself.
  function partial(ctx, pts, k) {
    if (k <= 0 || pts.length < 2) return null;
    let L = 0;
    const seg = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
    let rem = L * clamp(k);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    let tip = pts[0], dir = [1, 0];
    for (let i = 1; i < pts.length; i++) {
      const d = seg[i - 1];
      const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
      if (d > 0) dir = [(bx - ax) / d, (by - ay) / d];
      if (rem >= d) { ctx.lineTo(bx, by); rem -= d; tip = pts[i]; } else { const f = d ? rem / d : 0; tip = [ax + (bx - ax) * f, ay + (by - ay) * f]; ctx.lineTo(tip[0], tip[1]); break; }
    }
    return { tip, dir };
  }
  // quadratic Bézier sampled as points (feed it to partial for a route)
  function bez(p0, p1, p2, n = 48) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, v = 1 - u;
      pts.push([v * v * p0[0] + 2 * v * u * p1[0] + u * u * p2[0], v * v * p0[1] + 2 * v * u * p1[1] + u * u * p2[1]]);
    }
    return pts;
  }
  function arrowHead(ctx, tip, dir, size, color) {
    ctx.save();
    ctx.fillStyle = color || S.accent;
    ctx.beginPath();
    const [x, y] = tip, [dx, dy] = dir, nx = -dy, ny = dx;
    ctx.moveTo(x + dx * size * 0.4, y + dy * size * 0.4);
    ctx.lineTo(x - dx * size + nx * size * 0.55, y - dy * size + ny * size * 0.55);
    ctx.lineTo(x - dx * size - nx * size * 0.55, y - dy * size - ny * size * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // the plate under a footage picture-in-picture (the clip itself plays on the track above): box = TIMING.clips[i].box
  function plate(ctx, box, a = 1, o = {}) {
    if (a <= 0 || !box) return;
    const pad = o.pad ?? 10;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.shadowColor = o.shadowColor || S.shadow;
    ctx.shadowBlur = o.blur ?? 30;
    ctx.shadowOffsetY = o.drop ?? 12;
    ctx.fillStyle = o.color || S.plate;
    ctx.fillRect(box.x - pad, box.y - pad, box.w + 2 * pad, box.h + 2 * pad);
    ctx.restore();
  }
  // how far a clip is shown: 0 before, 1 while it plays, with fades of `f` seconds at both ends
  const clipWin = (t, c, f = 0.4) => (c ? win(t, c.at - f, c.at, c.end, c.end + f) : 0);

  // ---------- maps: land only, no borders ----------
  // Equirectangular with a cos(phi) squeeze around a reference latitude: fine for a country or a region.
  // Data: arrays of rings, delta-encoded in units of q degrees (geo110.js: q = 0.1).
  const decoded = new Map();
  function rings(src, q = 0.1) {
    if (decoded.has(src)) return decoded.get(src);
    const res = src.map(d => {
      const pts = [];
      let x = d[0], y = d[1];
      pts.push([x * q, y * q]);
      // unwrap rings that cross the antimeridian; the shift most points share becomes 0
      let shift = 0, px = x * q;
      const shifts = [0];
      for (let i = 2; i < d.length; i += 2) {
        x += d[i]; y += d[i + 1];
        const lx = x * q;
        if (lx + shift - px > 180) shift -= 360; else if (lx + shift - px < -180) shift += 360;
        px = lx + shift;
        pts.push([px, y * q]);
        shifts.push(shift);
      }
      const cnt = {};
      for (const sh of shifts) cnt[sh] = (cnt[sh] || 0) + 1;
      const base = +Object.keys(cnt).reduce((p, r) => (cnt[r] > cnt[p] ? r : p));
      if (base) for (const pt of pts) pt[0] -= base;
      return pts;
    });
    decoded.set(src, res);
    return res;
  }
  // raster the land of a lon/lat box once, off-screen.
  // o: lon0, lon1, lat0, lat1, phi (reference latitude), ppu (px per degree of latitude: enough for the closest camera),
  //    data (rings source, default window.GEO110), q, land, coast, coastW (0 = none), wrap (also draw rings shifted by +360)
  function makeMap(o) {
    const k = Math.cos((o.phi * Math.PI) / 180);
    const cw = Math.ceil((o.lon1 - o.lon0) * k * o.ppu), ch = Math.ceil((o.lat1 - o.lat0) * o.ppu);
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    const X = lon => (lon - o.lon0) * k * o.ppu, Y = lat => (o.lat1 - lat) * o.ppu;
    g.beginPath();
    for (const r of rings(o.data || window.GEO110, o.q ?? 0.1)) {
      for (const off of o.wrap ? [0, 360] : [0]) {
        let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
        for (const [x, y] of r) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
        if (maxx + off < o.lon0 - 2 || minx + off > o.lon1 + 2 || maxy < o.lat0 - 2 || miny > o.lat1 + 2) continue;
        r.forEach(([x, y], i) => (i ? g.lineTo(X(x + off), Y(y)) : g.moveTo(X(x + off), Y(y))));
        g.closePath();
      }
    }
    g.fillStyle = o.land || S.land;
    g.fill();
    if (o.coastW !== 0) {
      g.lineJoin = 'round';
      g.lineWidth = o.coastW || 2;
      g.strokeStyle = o.coast || S.coast;
      g.stroke();
    }
    return { c, o, k, X, Y, cw, ch };
  }
  // a hatched area = polygons (lon/lat) intersected with land, off-screen. Label it as illustrative on screen.
  // o: fill, hatch, hatchW, step, fadeLat [from, to] (fades out towards `to`)
  function makeZone(m, polys, o = {}) {
    const c = document.createElement('canvas');
    c.width = m.cw; c.height = m.ch;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    for (const poly of polys) {
      g.beginPath();
      poly.forEach(([lon, lat], i) => (i ? g.lineTo(m.X(lon), m.Y(lat)) : g.moveTo(m.X(lon), m.Y(lat))));
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(m.c, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = o.fill || 'rgba(160,30,20,0.3)';
    g.fillRect(0, 0, m.cw, m.ch);
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = o.hatch || 'rgba(140,20,15,0.55)';
    g.lineWidth = o.hatchW || 2;
    const step = o.step || 14;
    g.beginPath();
    for (let x = -m.ch; x < m.cw; x += step) { g.moveTo(x, m.ch); g.lineTo(x + m.ch, 0); }
    g.stroke();
    if (o.fadeLat) {
      g.globalCompositeOperation = 'destination-out';
      const y0 = m.Y(o.fadeLat[0]), y1 = m.Y(o.fadeLat[1]);
      const gr = g.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = gr;
      g.fillRect(0, Math.min(y0, y1) - 2, m.cw, Math.abs(y1 - y0) + 2);
    }
    return c;
  }
  // camera: centre lon/lat, span = degrees of longitude across the screen, dx/dy shift the centre on screen
  function view(m, cam) {
    const s = W / (cam.span * m.k);
    const cx = W / 2 + (cam.dx || 0), cy = H / 2 + (cam.dy || 0);
    const x = lon => cx + (lon - cam.lon) * m.k * s;
    const y = lat => cy - (lat - cam.lat) * s;
    return { s, x, y, pt: (lon, lat) => [x(lon), y(lat)] };
  }
  // camera keys [{ t, lon, lat, span, dx?, dy?, from? }] eased in-out; span interpolates in log space
  function camAt(t, keys) {
    if (t <= keys[0].t) return keys[0];
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1], b = keys[i];
      if (t <= b.t) {
        const k = ease.io(prog(t, b.from ?? a.t, b.t));
        return {
          lon: lerp(a.lon, b.lon, k), lat: lerp(a.lat, b.lat, k), span: zlerp(a.span, b.span, k),
          dx: lerp(a.dx || 0, b.dx || 0, k), dy: lerp(a.dy || 0, b.dy || 0, k),
        };
      }
    }
    return keys[keys.length - 1];
  }
  // draw the land raster (or a zone made from it) through view v
  function drawMap(ctx, m, v, a = 1, canvas) {
    if (a <= 0) return;
    const x0 = v.x(m.o.lon0), y0 = v.y(m.o.lat1), x1 = v.x(m.o.lon1), y1 = v.y(m.o.lat0);
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.drawImage(canvas || m.c, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }
  // only the part of a zone east of westLon (animate westLon to spread it)
  function drawZone(ctx, m, zc, v, a, westLon) {
    if (a <= 0) return;
    const x0 = v.x(m.o.lon0), y0 = v.y(m.o.lat1), x1 = v.x(m.o.lon1), y1 = v.y(m.o.lat0);
    const sx = Math.max(0, Math.min(m.cw - 1, m.X(westLon ?? m.o.lon0)));
    const fx = (x1 - x0) / m.cw;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.drawImage(zc, sx, 0, m.cw - sx, m.ch, x0 + sx * fx, y0, (m.cw - sx) * fx, y1 - y0);
    ctx.restore();
  }
  // faint lon/lat grid every `step` degrees
  function graticule(ctx, v, step = 10, o = {}) {
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 0.08;
    ctx.strokeStyle = o.color || S.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lon = -180; lon <= 360; lon += step) { const x = v.x(lon); if (x > -10 && x < W + 10) { ctx.moveTo(x, 0); ctx.lineTo(x, H); } }
    for (let lat = -80; lat <= 80; lat += step) { const y = v.y(lat); if (y > -10 && y < H + 10) { ctx.moveTo(0, y); ctx.lineTo(W, y); } }
    ctx.stroke();
    ctx.restore();
  }
  // a city: dot plus name (and an optional second line, e.g. the original spelling)
  function city(ctx, x, y, name, o = {}) {
    const a = o.alpha ?? 1;
    if (a <= 0) return;
    const size = o.size || 30;
    dot(ctx, x, y, { r: o.r || 7, color: o.color || S.ink, alpha: a, pulse: o.pulse, fill: o.fill, ring: o.ring });
    const dx = o.dx ?? 14, dy = o.dy ?? 8;
    text(ctx, name, x + dx, y + dy, { size, font: o.font || 'title', color: o.tcolor || S.ink, align: o.align || 'left', alpha: a, halo: o.halo ?? S.halo, haloW: 7 });
    if (o.sub) text(ctx, o.sub, x + dx, y + dy + size * 0.95, { size: size * 0.62, font: o.subFont || 'latin', color: o.subColor || S.muted, align: o.align || 'left', alpha: a, halo: o.halo ?? S.halo, haloW: 6 });
  }

  // ---------- the original voice, lit word by word ----------
  const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/u;
  // lay out clip.words (TIMING.clips[i].words, segment seconds) inside (o.x, o.y, o.maxW) and light each as it is said.
  // o: size, font, color, dim (alpha of unsaid words), dimColor, under (underline colour), lh (line height factor), align ('left' | 'center').
  // Returns { lines, height } so a translation can go under it.
  function quoteWords(ctx, c, t, o) {
    if (!c?.words?.length) return { lines: 0, height: 0 };
    const size = o.size || 52, lh = size * (o.lh ?? 1.42);
    ctx.save();
    ctx.font = font(size, roleFor(c.words.map(w => w.t).join(''), o.font || 'latin'));
    const sp = ctx.measureText(' ').width;
    const rows = [[]];
    let x = 0;
    c.words.forEach((w, i) => {
      const ww = ctx.measureText(w.t).width;
      const gap = i === 0 || CJK.test(w.t[0]) || CJK.test(c.words[i - 1].t.slice(-1)) ? 0 : sp;
      if (x > 0 && x + gap + ww > o.maxW) { rows.push([]); x = 0; }
      else x += x > 0 ? gap : 0;
      rows[rows.length - 1].push({ w, x, ww });
      x += ww;
    });
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const base = ctx.globalAlpha * (o.alpha ?? 1);   // multiplies like K.text, so an outer fade takes the words with it
    rows.forEach((row, r) => {
      const rw = row.length ? row[row.length - 1].x + row[row.length - 1].ww : 0;
      const ox = o.align === 'center' ? o.x + (o.maxW - rw) / 2 : o.x;
      for (const p of row) {
        const lit = prog(t, p.w.s - 0.06, Math.max(p.w.s + 0.12, p.w.e));
        ctx.globalAlpha = base * lerp(o.dim ?? 0.22, 1, lit);
        ctx.fillStyle = lit > 0 ? o.color || S.ink : o.dimColor || o.color || S.ink;
        ctx.fillText(p.w.t, ox + p.x, o.y + r * lh);
        if (o.under && lit > 0) {
          ctx.fillStyle = o.under;
          ctx.fillRect(ox + p.x, o.y + r * lh + size * 0.2, p.ww * lit, Math.max(2, size * 0.05));
        }
      }
    });
    ctx.restore();
    return { lines: rows.length, height: rows.length * lh };
  }

  // ---------- picking (lets the editor's marker select a line of canvas text) ----------
  function pick(name, x, y, w, h, id) {
    (window.__baocutPickRegions = window.__baocutPickRegions || []).push(id ? { x, y, w, h, name, id } : { x, y, w, h, name });
  }

  // ---------- registration ----------
  function scene(draw, opts = {}) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    root.appendChild(cv);
    let ctx = null;
    window.__baocutCompositions = window.__baocutCompositions || {};
    window.__baocutCompositions[root.dataset.compositionId] = {
      async initialize() {
        ctx = cv.getContext('2d');
        const fams = [...new Set(Object.values(S.fonts))];
        await Promise.all([
          ...[...imgs.values()].map(im => im.decode().catch(() => console.warn('image failed', im.src))),
          ...fams.map(f => document.fonts.load(`40px ${f}`, opts.sample || '中Aa1')),
          // every @font-face in the bundle, so a family used by name (not through a role in S.fonts) is ready on frame 0 too
          ...[...document.fonts].map(f => f.load().catch(() => console.warn('font failed', f.family))),
        ]);
        if (opts.setup) opts.setup(ctx);
        window.__baocutPickRegions = [];
        draw(ctx, 0);
      },
      async renderAt(time) {
        window.__baocutPickRegions = [];
        draw(ctx, Number(time.ticks) / time.timescale);
      },
      dispose() { ctx = null; },
    };
  }

  window.K = {
    W, H, S, style, clamp, lerp, prog, ease, io, out, win, zlerp, spring, cam, lens,
    at, line, lastEnd, dur, ambient, clips, clip, clipWin, credit,
    img, aspect, reset, clear, wash, vignette, edge, shade, grain,
    cover, full, print, slip, bars, loupe,
    font, measure, text, typeOn, wrap, tag, aiTag, creditLine,
    rule, stamp, dot, partial, bez, arrowHead, plate,
    rings, makeMap, makeZone, view, camAt, drawMap, drawZone, graticule, city,
    quoteWords, pick, scene,
  };
})();
