// i18n-ignore-file: copied into code bundles; strings are for logs and on-screen text the scene passes in
// Character rig for full-frame code scenes (baocut/1, one canvas, every frame a pure function of t).
// Mechanics only, no look of its own: palette and fonts come from R.style(), art from cutout.mjs.
// Copy into the project's shared/ and trim what you do not use.
//
//   const R = window.RigKit;
//   R.style({ font: '800 %px Title', ink: '#2b2d42', accent: '#d62828' });
//   R.assets(window.RIG);                  // rig-data.js written by cutout.mjs
//   R.voice(window.TIMING?.words ?? []);   // [{ w, t0, t1 }], seconds within this segment
//   R.film({ end: 12.4, blur: 1, build() {
//     R.shot('s1', 0, (t0, t1) => (t, g) => { R.camera(t, t0, t1); R.plate('lab'); R.actor('ann', t, { x: 400, y: 1000, h: 700 }); });
//   } });
//
// Baking rules kept here: one canvas, full clear every frame, no main-canvas readback, no ctx.filter, no letterSpacing,
// no Path2D, default image smoothing. Time only comes from t; randomness only from hash(n).
(function () {
  const root = document.getElementById('root');
  const W = Number(root?.dataset.width) || 1920, H = Number(root?.dataset.height) || 1080;
  const FPS = Number(root?.dataset.fps) || 30;
  const UNIT = Math.min(W, H) / 1080;

  let c = null;
  const IMG = {}, jobs = [];
  const shots = [], wipes = [], events = [], warnings = [];
  let SPR = {}, PLATES = {}, TOK = [], STREAM = '', STREAM_INDEX = [], base = './img/';

  // ---------- style ----------
  const S = {
    font: '800 %px sans-serif', ink: '#2b2d42', accent: '#d62828', paper: '#ffffff', puff: '#ffffff', tag: '#f4a261',
    bg: '#000000', arm: { upper: 118, lower: 112, thick: 36, ref: 918 },
  };
  function style(o) {
    Object.assign(S, o, { arm: { ...S.arm, ...(o.arm || {}) } });
    return S;
  }
  const fontAt = (px, font) => (font ?? S.font).replace('%', String(Math.round(px)));

  // ---------- math ----------
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = k => { k = clamp(k); return k * k * (3 - 2 * k); };
  const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
  const spring = (age, w = 15, d = 8) => (age <= 0 ? 0 : 1 - Math.exp(-d * age) * Math.cos(w * age));
  const squash = (age, amp = 0.22) => (age <= 0 ? 0 : amp * Math.exp(-9 * age) * Math.sin(22 * age));
  const hop = (t, t0, dur = 0.42, ht = 70) => (t < t0 || t > t0 + dur ? 0 : Math.sin((Math.PI * (t - t0)) / dur) * ht);
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  // A prop dropping in: negative offset until it lands on t0.
  function fall(t, t0, from = 900, dur = 0.2) {
    if (t >= t0) return 0;
    const k = clamp(1 - (t0 - t) / dur);
    return (k * k - 1) * from;
  }
  const roll = (t, t0, t1, to, from = 0) => (t < t0 ? from : Math.round(lerp(from, to, 1 - Math.pow(1 - clamp((t - t0) / Math.max(t1 - t0, 0.01)), 2))));

  // ---------- sound events ----------
  const E = (s, t) => { events.push({ s, t: Number(t.toFixed(3)) }); };

  // ---------- cues: every cut, sign and gesture starts on a real word ----------
  const norm = s => String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  function voice(words) {
    TOK = (words || []).map(w => ({ w: norm(w.w ?? w.text ?? w.s ?? ''), t0: w.t0 ?? w.start ?? w.t, t1: w.t1 ?? w.end ?? w.e }));
    STREAM = ''; STREAM_INDEX = [];
    TOK.forEach((tok, i) => { for (let k = 0; k < tok.w.length; k++) STREAM_INDEX.push(i); STREAM += tok.w; });
  }
  // Finds a phrase in any language by its letters, on word boundaries. A phrase said more than once needs { nth: 1.. }:
  // repeated words without an occurrence number are how cuts end up on the wrong line.
  function findCue(phrase, o) {
    const p = norm(phrase), hits = [];
    if (!p) throw new Error('empty cue');
    for (let i = STREAM.indexOf(p); i >= 0; i = STREAM.indexOf(p, i + 1)) {
      const first = STREAM_INDEX[i], last = STREAM_INDEX[i + p.length - 1];
      const startsWord = i === 0 || STREAM_INDEX[i - 1] !== first;
      const endsWord = i + p.length === STREAM.length || STREAM_INDEX[i + p.length] !== last;
      if (startsWord && endsWord) hits.push([first, last]);
    }
    if (!hits.length) throw new Error(`no cue: ${phrase}`);
    if (hits.length > 1 && o.nth === undefined) throw new Error(`cue "${phrase}" is said ${hits.length} times; pass { nth }`);
    const hit = hits[(o.nth ?? 1) - 1];
    if (!hit) throw new Error(`cue "${phrase}" has ${hits.length} occurrences, not ${o.nth}`);
    return hit;
  }
  // { word: n } is the nth word of the phrase, counted from 0; negative counts from its last word.
  function cue(phrase, o = {}) {
    const [a, b] = findCue(phrase, o), w = o.word ?? 0;
    return TOK[clamp(w >= 0 ? a + w : b + 1 + w, a, b)].t0 + (o.offset ?? 0);
  }
  function cueEnd(phrase, o = {}) {
    const [a, b] = findCue(phrase, o), w = o.word ?? -1;
    return TOK[clamp(w >= 0 ? a + w : b + 1 + w, a, b)].t1 + (o.offset ?? 0);
  }

  // ---------- assets ----------
  function loadImage(key, src) {
    const im = new Image();
    im.src = src;
    IMG[key] = im;
    jobs.push(im.decode().catch(() => { throw new Error(`missing image ${src}`); }));
    return im;
  }
  function img(file, key) { return IMG[key ?? file] ?? loadImage(key ?? file, base + file); }
  function assets(rig, dir = './img/') {
    base = dir;
    SPR = rig.sprites || {};
    PLATES = rig.plates || {};
    for (const [n, p] of Object.entries(PLATES)) loadImage(`plate:${n}`, base + p.file);
    for (const [n, m] of Object.entries(SPR)) {
      if (m.kind === 'prop') { loadImage(n, `${base}${n}.png`); continue; }
      loadImage(`${n}_head`, `${base}${n}_head.png`);
      loadImage(`${n}_body`, `${base}${n}_body.png`);
      if (m.kind === 'walk') { loadImage(`${n}_legs`, `${base}${n}_legs.png`); loadImage(`${n}_legs_dark`, `${base}${n}_legs_dark.png`); }
      if (m.hand) loadImage(`${n}_hand`, `${base}${n}_hand.png`);
    }
  }
  // Per-sprite overrides: sleeve, face, edge (false to drop the sleeve line), hand (mitten, paw or a function), arm lengths.
  function sprite(name, o) { Object.assign(SPR[name], o); return SPR[name]; }

  // ---------- camera: the plate and everything on it share one transform ----------
  function camera(t, t0, t1, o = {}) {
    const k = smooth((t - t0) / Math.max(t1 - t0, 0.01));
    const z = lerp(o.z0 ?? 1.03, o.z1 ?? 1.06, k);
    const fx = lerp(o.x0 ?? W / 2, o.x1 ?? o.x0 ?? W / 2, k), fy = lerp(o.y0 ?? H / 2, o.y1 ?? o.y0 ?? H / 2, k);
    const vw = W / z, vh = H / z;
    const vx = clamp(fx - vw / 2, 0, W - vw);
    // The floor guard keeps feet in frame; a zoom past the plate's edges would show black.
    const vy = clamp(Math.max(fy - vh / 2, (o.floor ?? H * 0.993) - vh), 0, H - vh);
    c.setTransform(z, 0, 0, z, -vx * z, -vy * z);
    if (R.onCamera) R.onCamera({ t, z });
  }
  const screen = () => c.setTransform(1, 0, 0, 1, 0, 0);
  // Plates cover the canvas; a plate from another aspect crops around its focus (fx, fy in cutout.mjs).
  function coverOf(p) {
    const s = Math.max(W / p.w, H / p.h), dw = p.w * s, dh = p.h * s;
    return { s, x: (W - dw) * (p.fx ?? 0.5), y: (H - dh) * (p.fy ?? 0.5), w: dw, h: dh };
  }
  function plate(name) {
    const p = PLATES[name], q = coverOf(p);
    c.drawImage(IMG[`plate:${name}`], q.x, q.y, q.w, q.h);
  }
  function board(name, i = 0) {
    const p = PLATES[name], b = p.boards?.[i];
    if (!b) throw new Error(`plate ${name} has no board ${i}`);
    const q = coverOf(p);
    const r = { x: q.x + b.x * q.w, y: q.y + b.y * q.h, w: b.w * q.w, h: b.h * q.h };
    if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) warnings.push(`board ${i} of plate ${name} runs off the canvas; set fx, fy for this plate`);
    return r;
  }

  // ---------- typed text on things in the world ----------
  const splitLetters = s => (typeof Intl !== 'undefined' && Intl.Segmenter
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), x => x.segment)
    : Array.from(s));
  // Letters arrive big and to one side, then settle. Worded for a rect the plate already has, never a card over the art.
  function typed(rect, text, t0, o = {}) {
    const lines = String(text).split('\n'), cps = o.cps ?? 30, pad = o.pad ?? 0.86, lh = o.lh ?? 1.14;
    let size = o.size ?? 96;
    const fit = () => {
      c.save();
      for (;;) {
        c.font = fontAt(size, o.font);
        const widest = Math.max(...lines.map(l => c.measureText(l).width));
        if ((widest <= rect.w * pad && size * lh * lines.length <= rect.h * pad) || size <= 10) break;
        size -= 1;
      }
      const list = [];
      let n = 0;
      const top = rect.y + rect.h * (o.vy ?? 0.5) - (size * lh * lines.length) / 2 + (size * lh) / 2;
      lines.forEach((l, li) => {
        const parts = splitLetters(l), lw = c.measureText(l).width;
        const x0 = rect.x + rect.w * (o.hx ?? 0.5) - lw / 2;
        let prefix = '';
        for (const ch of parts) {
          if (ch.trim()) {
            const at = t0 + n / cps;
            list.push({ ch, x: x0 + c.measureText(prefix).width, y: top + li * size * lh, at });
            if (!o.silent) E('tick', at);
          }
          prefix += ch;
          n += 1;
        }
      });
      c.restore();
      if (size < (o.minSize ?? 24 * UNIT)) warnings.push(`text "${text}" shrank to ${size}px to fit its board`);
      return list;
    };
    const letters = fit();
    const from = o.arrive ?? 1.45, dx0 = o.drift ?? 0.7, settle = o.settle ?? 0.18, name = lines.join(' ');
    return t => {
      c.save();
      c.font = fontAt(size, o.font);
      c.fillStyle = o.color ?? S.ink;
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      for (const l of letters) {
        const age = t - l.at;
        if (age < 0) continue;
        const k = easeOut(age / settle);
        const s = lerp(from, 1, k);
        c.save();
        c.translate(l.x + lerp(dx0 * size, 0, k), l.y);
        c.scale(s, s);
        c.fillText(l.ch, 0, 0);
        c.restore();
      }
      c.restore();
      if (window.__baocutPickRegions && letters.length && t >= letters[0].at && c.getTransform) {
        const m = c.getTransform();
        window.__baocutPickRegions.push({ x: m.a * rect.x + m.e, y: m.d * rect.y + m.f, w: m.a * rect.w, h: m.d * rect.h, name });
      }
    };
  }

  // Marks drawn stroke by stroke over a rect: wrong ideas, right answers, the thing to look at.
  function strokeRun(strokes, t0, o = {}) {
    const dur = o.dur ?? 0.11, width = (o.width ?? 30) * UNIT;
    return t => {
      c.save();
      c.strokeStyle = o.color ?? S.accent; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
      strokes.forEach((pts, si) => {
        const k = clamp((t - t0 - si * dur) / dur);
        if (k <= 0) return;
        const segs = pts.length - 1, upto = k * segs;
        c.beginPath();
        c.moveTo(pts[0][0], pts[0][1]);
        for (let i = 0; i < segs && i < upto; i++) {
          const f = Math.min(1, upto - i);
          c.lineTo(lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f));
        }
        c.stroke();
      });
      c.restore();
    };
  }
  function cross(rect, t0, o = {}) {
    if (!o.silent) E('hit', t0);
    const inset = o.inset ?? 0.12;
    const x0 = rect.x + rect.w * inset, x1 = rect.x + rect.w * (1 - inset), y0 = rect.y + rect.h * inset, y1 = rect.y + rect.h * (1 - inset);
    return strokeRun([[[x0, y0], [x1, y1]], [[x1, y0], [x0, y1]]], t0, o);
  }
  function check(rect, t0, o = {}) {
    if (!o.silent) E('ding', t0);
    const x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    return strokeRun([[[x + w * 0.18, y + h * 0.55], [x + w * 0.42, y + h * 0.8], [x + w * 0.84, y + h * 0.22]]], t0, { dur: 0.2, ...o });
  }
  function ring(rect, t0, o = {}) {
    if (!o.silent) E('pop', t0);
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = -1.9 + (i / 40) * Math.PI * 2.1;
      pts.push([rect.x + rect.w / 2 + (Math.cos(a) * rect.w) / 2, rect.y + rect.h / 2 + (Math.sin(a) * rect.h) / 2]);
    }
    return strokeRun([pts], t0, { dur: 0.32, width: 14, ...o });
  }

  // A small card in screen space for dates and places. Icon is 'calendar', 'pin', a function (x, y, size) or null.
  function tag(text, t0, o = {}) {
    if (!o.silent) E('pop', t0);
    const w = (o.w ?? 330) * UNIT, h = (o.h ?? 120) * UNIT, x = o.x ?? 40 * UNIT, y = o.y ?? 40 * UNIT;
    const icon = o.icon === undefined ? 'calendar' : o.icon, iconW = icon ? h * 0.67 + h * 0.15 : 0;
    let size = 54 * UNIT;
    c.save();
    for (;;) { c.font = fontAt(size, o.font); if (c.measureText(text).width <= w - iconW - h * 0.3 || size < 16) break; size -= 1; }
    c.restore();
    return t => {
      const age = t - t0;
      if (age < 0) return;
      const s = spring(age, 16, 7);
      screen();
      c.save();
      c.translate(x + w / 2, y + h / 2);
      c.scale(s, s);
      c.translate(-w / 2, -h / 2);
      c.fillStyle = o.paper ?? S.paper;
      c.beginPath(); c.roundRect(0, 0, w, h, h * 0.12); c.fill();
      const q = h * 0.67, ix = h * 0.15, iy = (h - q) / 2;
      if (icon === 'calendar') {
        c.fillStyle = o.color ?? S.tag;
        c.beginPath(); c.roundRect(ix, iy, q, q, q * 0.1); c.fill();
        c.fillStyle = o.paper ?? S.paper;
        c.fillRect(ix + q * 0.1, iy + q * 0.3, q * 0.8, q * 0.6);
        c.fillStyle = o.color ?? S.tag;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) c.fillRect(ix + q * (0.19 + i * 0.225), iy + q * (0.4 + j * 0.225), q * 0.15, q * 0.15);
      } else if (icon === 'pin') {
        c.fillStyle = o.color ?? S.tag;
        c.beginPath(); c.arc(ix + q / 2, iy + q * 0.38, q * 0.32, Math.PI * 0.86, Math.PI * 0.14); c.lineTo(ix + q / 2, iy + q); c.closePath(); c.fill();
        c.fillStyle = o.paper ?? S.paper;
        c.beginPath(); c.arc(ix + q / 2, iy + q * 0.38, q * 0.13, 0, 7); c.fill();
      } else if (typeof icon === 'function') {
        icon(ix, iy, q);
      }
      c.fillStyle = o.ink ?? S.ink;
      c.font = fontAt(size, o.font);
      c.textBaseline = 'middle'; c.textAlign = 'left';
      c.fillText(text, iconW + h * 0.1, h * 0.53);
      c.restore();
    };
  }

  // ---------- backdrops for full-frame headlines ----------
  function gearShape(x, y, r, teeth, rot, color) {
    c.save(); c.translate(x, y); c.rotate(rot); c.fillStyle = color;
    c.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? r : r * 1.2;
      c.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr); c.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr);
    }
    c.closePath(); c.fill();
    c.restore();
  }
  const backdrop = {
    puffs: (base, light) => t => {
      c.fillStyle = base; c.fillRect(0, 0, W, H);
      c.fillStyle = light;
      for (let i = 0; i < 12; i++) {
        const x = ((hash(i) * W * 1.15 + t * (30 + 40 * hash(i + 3))) % (W * 1.2)) - W * 0.1, y = hash(i + 7) * H, r = (60 + 90 * hash(i + 11)) * UNIT;
        for (let j = 0; j < 4; j++) { c.beginPath(); c.arc(x + j * r * 0.75, y + Math.sin(j * 2 + i) * r * 0.32, r * (0.7 + 0.2 * Math.sin(j + i)), 0, 7); c.fill(); }
      }
    },
    gears: (base, light) => t => {
      c.fillStyle = base; c.fillRect(0, 0, W, H);
      gearShape(W * 0.13, H * 0.2, 210 * UNIT, 12, t * 0.35, light);
      gearShape(W * 0.88, H * 0.78, 280 * UNIT, 14, -t * 0.26, light);
      gearShape(W * 0.86, H * 0.18, 130 * UNIT, 10, -t * 0.5, light);
      gearShape(W * 0.12, H * 0.81, 140 * UNIT, 10, t * 0.48, light);
    },
    rays: (base, light) => t => {
      c.fillStyle = base; c.fillRect(0, 0, W, H);
      c.fillStyle = light;
      const R0 = Math.hypot(W, H);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + t * 0.12;
        c.beginPath(); c.moveTo(W / 2, H / 2); c.lineTo(W / 2 + Math.cos(a) * R0, H / 2 + Math.sin(a) * R0); c.lineTo(W / 2 + Math.cos(a + 0.26) * R0, H / 2 + Math.sin(a + 0.26) * R0); c.closePath(); c.fill();
      }
    },
  };

  // ---------- arrivals: a spring, a squash or a puff, never a fade ----------
  function puff(x, y, t, t0, r = 60, seed = 1, n = 7, color) {
    const age = t - t0;
    if (age < 0 || age > 0.42) return;
    c.save();
    c.fillStyle = color ?? S.puff;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash(seed + i) * 0.8, k = age / 0.42;
      const d = r * (0.35 + 1.1 * Math.sqrt(k));
      const rr = r * (0.28 + 0.25 * hash(seed + i + 9)) * Math.sin(Math.PI * Math.min(k * 1.05, 1));
      c.beginPath(); c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, Math.max(rr, 0), 0, 7); c.fill();
    }
    c.restore();
  }
  // A "!" or "?" over a character: springs in, holds, shrinks away.
  function pop(sym, x, y, t, t0, o = {}) {
    const age = t - t0, life = o.life ?? 0.8;
    if (age < 0 || age > life + 0.12) return;
    const s = spring(age, 18, 8) * (age > life ? 1 - (age - life) / 0.12 : 1);
    c.save();
    c.translate(x, y);
    c.rotate((o.rot ?? 0.12) * Math.sin(age * 9));
    c.scale(s, s);
    c.font = fontAt((o.size ?? 120) * UNIT, o.font);
    c.fillStyle = o.color ?? S.accent;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(sym, 0, 0);
    c.restore();
  }
  function prop(name, x, y, h, o = {}) {
    const im = IMG[name], w = (h * im.width) / im.height, sq = o.sq ?? 0;
    c.save();
    c.translate(x, y);
    if (o.rot) c.rotate(o.rot);
    c.scale((o.flip ? -1 : 1) * (1 + sq) * (o.s ?? 1), (1 - sq) * (o.s ?? 1));
    c.drawImage(im, -w / 2, -h, w, h);
    c.restore();
  }

  // ---------- faces ----------
  const blinkTable = new Map();
  function blinking(seed, t) {
    let list = blinkTable.get(seed);
    if (!list) {
      list = [0.4 + 2 * hash(seed)];
      blinkTable.set(seed, list);
    }
    while (list[list.length - 1] < t) list.push(list[list.length - 1] + 2.7 + 1.5 * hash(seed * 3 + list.length));
    return list.some(b => t >= b && t < b + 0.14);
  }
  function drawHead(name, t, o, seed) {
    const m = SPR[name];
    c.save();
    c.translate(m.neckX, m.neckY);
    c.rotate(0.035 * Math.sin(t * 2.3 + seed) + (o.headRot ?? 0));
    c.translate(-m.neckX, -m.neckY);
    c.drawImage(IMG[`${name}_head`], 0, 0);
    if (o.blink !== false && m.eyes?.length && blinking(seed + 1, t)) {
      for (const e of m.eyes) {
        c.fillStyle = m.face;
        c.beginPath(); c.arc(e.x, e.y, e.r * 1.35, 0, 7); c.fill();
        c.fillStyle = m.lid ?? '#26262e';
        c.fillRect(e.x - e.r * 1.1, e.y - e.r * 0.18, e.r * 2.2, e.r * 0.36);
      }
    }
    c.restore();
  }

  // ---------- hands ----------
  const hands = {
    mitten(g, pose, r, skin) {
      g.fillStyle = skin;
      if (pose === 'fist') {
        g.beginPath(); g.arc(r * 0.3, 0, r, 0, 7); g.fill();
      } else if (pose === 'point') {
        g.beginPath(); g.arc(r * 0.2, 0, r * 0.88, 0, 7); g.fill();
        g.beginPath(); g.roundRect(r * 0.3, -r * 0.3, r * 1.9, r * 0.6, r * 0.3); g.fill();
        g.beginPath(); g.ellipse(r * 0.2, r * 0.75, r * 0.5, r * 0.28, 0.6, 0, 7); g.fill();
      } else {
        g.beginPath(); g.ellipse(r * 0.55, 0, r * 1.2, r * 0.95, 0, 0, 7); g.fill();
        g.beginPath(); g.ellipse(r * 0.3, -r * 0.95, r * 0.6, r * 0.3, -0.6, 0, 7); g.fill();
      }
    },
    paw(g, pose, r, skin) {
      g.fillStyle = skin;
      g.beginPath(); g.arc(r * 0.35, 0, r * (pose === 'fist' ? 0.95 : 1.05), 0, 7); g.fill();
      if (pose !== 'fist') {
        const reach = pose === 'point' ? 1.5 : 1.1;
        for (const a of pose === 'point' ? [0] : [-0.7, 0, 0.7]) {
          g.beginPath(); g.ellipse(r * 0.35 + Math.cos(a) * r * reach, Math.sin(a) * r * reach, r * 0.42, r * 0.34, a, 0, 7); g.fill();
        }
      }
    },
  };

  // ---------- arms: two-bone IK tubes ----------
  function shiftTone(hex, f) {
    return `#${[1, 3, 5].map(i => Math.round(clamp(f(parseInt(hex.slice(i, i + 2), 16)), 0, 255)).toString(16).padStart(2, '0')).join('')}`;
  }
  function sleeveEdge(hex) {
    const lum = [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0) / 3;
    return lum < 80 ? shiftTone(hex, v => v + 46) : shiftTone(hex, v => v * 0.68);
  }
  const armOf = m => ({ ...S.arm, ...(m.arm || {}) });
  // out is the arm's outward side in the sprite: -1 left, +1 right. The elbow takes the solution that sits lower and
  // further out, so a raised arm bends downward and a hanging arm bends away from the body. Where that preference is
  // near zero the elbow is pointing at the camera: the bend flattens and the arm crosses sides without a pop.
  function armSolve(m, sx, sy, tx, ty, out) {
    const a0 = armOf(m), u = m.h / a0.ref, l1 = a0.upper * u, l2 = a0.lower * u;
    const dx = tx - sx, dy = ty - sy;
    const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1, l1 + l2 - 0.5);
    const base = Math.atan2(dy, dx);
    const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    const px = -Math.sin(base), py = Math.cos(base);
    const side = (py + 0.6 * out * px) / Math.hypot(1, 0.6);
    const bend = Math.sign(side) * clamp(Math.abs(side) / 0.3);
    const along = Math.cos(a) * l1, off = Math.sin(a) * l1 * bend;
    return { ex: sx + Math.cos(base) * along + px * off, ey: sy + Math.sin(base) * along + py * off,
      hx: sx + Math.cos(base) * d, hy: sy + Math.sin(base) * d, base, u, th: a0.thick * u, reach: Math.hypot(dx, dy) / (l1 + l2), L: l1 + l2 };
  }
  function drawArm(name, m, sx, sy, tx, ty, out, spec) {
    const q = armSolve(m, sx, sy, tx, ty, out), { ex, ey, hx, hy, base, u, th } = q;
    if (R.onArm) R.onArm({ name, out, sx, sy, ex, ey, hx, hy, reach: q.reach, L: q.L, front: !!spec?.front });
    const sleeve = m.sleeve ?? '#888888', pose = spec?.pose ?? 'open', hold = spec?.hold;
    const edge = m.edge === false ? null : (m.edge ?? sleeveEdge(sleeve));
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (edge) {
      // The edge starts below the shoulder so the sleeve still melts into the coat at the socket.
      c.strokeStyle = edge; c.lineWidth = th + 7 * u;
      c.beginPath(); c.moveTo(lerp(sx, ex, 0.3), lerp(sy, ey, 0.3)); c.lineTo(ex, ey); c.lineTo(hx, hy); c.stroke();
    }
    c.strokeStyle = sleeve; c.lineWidth = th;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.lineTo(hx, hy); c.stroke();
    const fore = Math.atan2(hy - ey, hx - ex), cf = Math.cos(fore), sf = Math.sin(fore);
    if (edge) {
      c.strokeStyle = edge; c.lineWidth = th + 2 * u; c.lineCap = 'butt';
      c.beginPath(); c.moveTo(hx - cf * 13 * u, hy - sf * 13 * u); c.lineTo(hx - cf * 3 * u, hy - sf * 3 * u); c.stroke();
    }
    const ang = pose === 'point' ? base : fore;
    if (hold) {
      // Held props go under the hand so the fingers close over them.
      const im = IMG[hold.name], hh = hold.h * u, ww = (hh * im.width) / im.height;
      c.save();
      c.translate(hx, hy);
      c.rotate(hold.rot ?? 0);
      c.drawImage(im, -ww / 2 + (hold.side ?? 0) * hh, -hh * (0.5 + (hold.up ?? 0.25)), ww, hh);
      c.restore();
    }
    const hand = typeof m.hand_ === 'function' ? m.hand_ : hands[m.hand_ ?? 'mitten'];
    c.save();
    c.translate(hx, hy);
    c.rotate(ang);
    hand(c, pose, th * 0.72, m.face ?? m.skin ?? '#f4a08c');
    c.restore();
  }

  // Arm specs, relative to the actor unless noted:
  //   at: [angle, reach]  angle 0 is straight out, negative is up; reach is a fraction of the arm.
  //   aim: [wx, wy]       world point to point toward; elevation is capped so the hand stays clear of the head.
  //   x, y                world point for a hand that has to touch something in the scene.
  //   from, to, k         blend between two specs; swing() builds these. undefined is the relaxed idle arm.
  // Also: pose (open, point, fist), hold ({ name, h, rot, up, side }), front (draw over the head).
  const AIM_UP = -0.55, AIM_DOWN = 0.6;
  function armTarget(a, m, sx, sy, out, t, seed, toLocal) {
    const arm = armOf(m), L = ((arm.upper + arm.lower) * m.h) / arm.ref;
    if (!a) return [sx + out * (m.h * 0.045 + Math.sin(t * 1.4 + seed + out) * m.h * 0.012), sy + m.h * 0.235];
    if (a.k !== undefined) {
      const p = armTarget(a.from, m, sx, sy, out, t, seed, toLocal), q = armTarget(a.to, m, sx, sy, out, t, seed, toLocal);
      return [lerp(p[0], q[0], a.k), lerp(p[1], q[1], a.k)];
    }
    if (a.at) return [sx + out * Math.cos(a.at[0]) * a.at[1] * L, sy + Math.sin(a.at[0]) * a.at[1] * L];
    if (a.aim) {
      const [wx, wy] = toLocal(a.aim[0], a.aim[1]);
      const raw = Math.atan2(wy - sy, (wx - sx) * out);
      if (Math.abs(raw) > Math.PI / 2 && R.onAcross) R.onAcross({ t });
      const ang = clamp(raw, AIM_UP, AIM_DOWN), r = (a.reach ?? 0.92) * L;
      return [sx + out * Math.cos(ang) * r, sy + Math.sin(ang) * r];
    }
    return toLocal(a.x, a.y);
  }
  // Ease an arm from spec A to spec B starting at `at`, so a new gesture never snaps in on one frame.
  function swing(t, at, A, B, d = 0.16) {
    const k = smooth((t - at) / d);
    if (k <= 0) return A;
    if (k >= 1) return B;
    const end = k < 0.5 ? A : B;
    return { from: A, to: B, k, pose: end?.pose ?? 'open', hold: end?.hold, front: end?.front };
  }

  // ---------- characters ----------
  // o: x, y (feet), h, flip, lift, sq, headRot, seed, blink, draw (scribbling hand piece); l, r: arm specs.
  function actor(name, t, o) {
    const m = SPR[name], k = o.h / m.h, f = o.flip ? -1 : 1, seed = o.seed ?? name.length;
    const bob = Math.sin(t * 1.9 + seed) * 2.2;
    const sq = o.sq ?? 0, sxk = k * (1 + sq), syk = k * (1 - sq), fy = o.y - (o.lift ?? 0);
    c.save();
    c.translate(o.x, fy);
    c.scale(f * sxk, syk);
    c.translate(-m.w / 2, -m.h + bob);
    const toLocal = (wx, wy) => [(wx - o.x) / (f * sxk) + m.w / 2, (wy - fy) / syk + m.h - bob];
    const after = [];
    const arm = (a, sx, sy, out) => {
      const [tx, ty] = armTarget(a, m, sx, sy, out, t, seed, toLocal);
      const draw = () => drawArm(name, m, sx, sy, tx, ty, out, a);
      if (a?.front) { after.push(draw); return () => {}; }
      return draw;
    };
    if (m.shoulders) {
      const s = m.shoulders, al = arm(o.l, s.lx, s.y, -1), ar = arm(o.r, s.rx, s.y, 1);
      c.drawImage(IMG[`${name}_body`], 0, 0);
      al(); ar();
    } else {
      c.drawImage(IMG[`${name}_body`], 0, 0);
      // Side-on figures have one code-drawn arm, reaching the way they face.
      if (m.shoulder && o.r) arm(o.r, m.shoulder.x, m.shoulder.y, m.facing === 'left' ? -1 : 1)();
    }
    if (IMG[`${name}_hand`]) {
      const sc = m.h / 620;
      c.drawImage(IMG[`${name}_hand`], o.draw ? 8 * Math.sin(t * 17) * sc : 0, o.draw ? 8 * Math.sin(t * 23 + 1) * sc : 0);
    }
    drawHead(name, t, o, seed);
    after.forEach(fn => fn());
    c.restore();
  }

  // Walks: thighs swing +-0.42 rad, the knee bends 0.75 cos^2 on the swing, the hips drop so the planted foot stays
  // down, the body moves 1.5 leg lengths per cycle, so feet never slide.
  function legLength(name, h) { const m = SPR[name]; return (m.h - (m.hemY - m.hipUp)) * (h / m.h); }
  const walkPhase = (name, h, dist) => (dist / (1.5 * legLength(name, h))) * Math.PI * 2;
  function walker(name, t, o) {
    const m = SPR[name], k = o.h / m.h, f = o.flip ? -1 : 1, seed = o.seed ?? 5;
    const hip = m.hemY - m.hipUp, L = m.h - hip, L1 = L * 0.5, L2 = L * 0.5;
    const leg = ph => {
      const th = 0.42 * Math.sin(ph), knee = Math.cos(ph) > 0 ? 0.75 * Math.pow(Math.cos(ph), 2) : 0;
      const a1 = -th, a2 = a1 + knee;
      return { a1, a2, footY: L1 * Math.cos(a1) + L2 * Math.cos(a2) };
    };
    const near = leg(o.phase), far = leg(o.phase + Math.PI);
    const drop = L - Math.max(near.footY, far.footY);
    const drawLeg = (g, dark) => {
      const im = IMG[`${name}_legs${dark ? '_dark' : ''}`];
      c.save();
      c.translate(m.legX, hip);
      c.rotate(g.a1);
      c.drawImage(im, 0, hip, m.w, L1 + 6, -m.legX, 0, m.w, L1 + 6);
      c.translate(0, L1);
      c.fillStyle = dark ? m.trouserDark : m.trouser;
      c.beginPath(); c.arc(0, 0, m.legW * 0.46, 0, 7); c.fill();
      c.rotate(g.a2 - g.a1);
      c.drawImage(im, 0, hip + L1, m.w, L2, -m.legX, 0, m.w, L2);
      c.restore();
    };
    c.save();
    c.translate(o.x, o.y);
    c.scale(f * k, k);
    c.translate(-m.w / 2, -m.h + drop);
    drawLeg(far, true);
    drawLeg(near, false);
    c.drawImage(IMG[`${name}_body`], 0, 0);
    drawHead(name, t, o, seed);
    c.restore();
  }

  // ---------- wipes between big sections ----------
  function blobPath(cx, cy, R0, seed, wobble) {
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const r = R0 * (1 + wobble * (0.16 * Math.sin(5 * a + seed) + 0.1 * Math.sin(11 * a + seed * 2.3) + 0.05 * Math.sin(23 * a + seed * 3.1)));
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
  }
  // o: shape (splat, iris, bars), color, dur (seconds in and out), seed.
  function wipe(t, o = {}) {
    const dur = o.dur ?? 0.2;
    wipes.push({ t, dur, shape: o.shape ?? 'splat', color: o.color ?? S.paper, seed: o.seed ?? t });
    if (!o.silent) E('whoosh', t - dur);
  }
  function drawWipes(t) {
    for (const w of wipes) {
      const a = t - (w.t - w.dur), b = t - w.t;
      if (a < 0 || b > w.dur) continue;
      screen();
      c.fillStyle = w.color;
      if (w.shape === 'bars') {
        const n = 6, k = b < 0 ? a / w.dur : 1 - b / w.dur, e = k * k * (3 - 2 * k);
        for (let i = 0; i < n; i++) c.fillRect(0, (i * H) / n, W, Math.ceil((H / n) * e));
        continue;
      }
      const wobble = w.shape === 'iris' ? 0 : 1, maxR = Math.hypot(W, H) * 0.68;
      if (b < 0) {
        const R0 = maxR * Math.pow(a / w.dur, 2);
        c.beginPath(); blobPath(W / 2, H / 2, R0, w.seed, wobble); c.fill();
        if (wobble) {
          for (let i = 0; i < 6; i++) {
            const an = hash(w.seed + i) * 6.28, d = R0 * 0.9 + 80 * UNIT;
            c.beginPath(); blobPath(W / 2 + Math.cos(an) * d, H / 2 + Math.sin(an) * d, R0 * 0.16 + 26 * UNIT, w.seed + i, 1); c.fill();
          }
        }
      } else {
        const R0 = maxR * Math.pow(b / w.dur, 2);
        c.beginPath();
        c.rect(0, 0, W, H);
        blobPath(W / 2, H / 2, R0, w.seed + 7, wobble);
        c.fill('evenodd');
      }
    }
  }

  // ---------- film ----------
  function shot(id, t0, init) { shots.push({ id, t0, init }); }
  const shotAt = t => {
    let s = shots[0];
    for (const x of shots) if (t >= x.t0) s = x;
    return s;
  };
  let mainCtx = null, buffer = null, blurPasses = 1;
  function scene(t) {
    const s = shotAt(t);
    c.save();
    screen();
    c.fillStyle = S.bg;
    c.fillRect(0, 0, W, H);
    s.draw(t, c);
    screen();
    c.restore();
    c.save();
    drawWipes(t);
    c.restore();
  }
  function renderFrame(t) {
    window.__baocutPickRegions = [];
    if (blurPasses <= 1) { c = mainCtx; scene(t); return; }
    // Motion blur over half a frame. A subframe never crosses a cut.
    const s = shotAt(t), next = shots.find(x => x.t0 > t)?.t0 ?? Infinity, times = [];
    for (let i = 0; i < blurPasses; i++) {
      const ti = t + (i / blurPasses) * (0.5 / FPS);
      if (ti < next && ti >= s.t0) times.push(ti);
    }
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.globalAlpha = 1;
    mainCtx.fillStyle = S.bg;
    mainCtx.fillRect(0, 0, W, H);
    c = buffer.getContext('2d');
    times.forEach((ti, i) => {
      scene(ti);
      mainCtx.globalAlpha = 1 / (i + 1);
      mainCtx.drawImage(buffer, 0, 0);
    });
    mainCtx.globalAlpha = 1;
    c = mainCtx;
  }
  // o: end (seconds), build() (registers shots and wipes), blur (subframes; 1 means none), id (defaults to data-composition-id).
  function film(o) {
    const id = o.id ?? root?.dataset.compositionId ?? 'scene';
    window.__baocutCompositions = window.__baocutCompositions || {};
    window.__baocutCompositions[id] = {
      async initialize(context) {
        mainCtx = (context.target ?? root).querySelector('canvas').getContext('2d');
        c = mainCtx;
        blurPasses = o.blur ?? 1;
        if (blurPasses > 1) { buffer = document.createElement('canvas'); buffer.width = W; buffer.height = H; }
        await Promise.all(jobs);
        await document.fonts?.load?.(fontAt(80));
        o.build(R);
        await Promise.all(jobs);
        shots.sort((a, b) => a.t0 - b.t0);
        if (!shots.length || shots[0].t0 > 0.001) throw new Error('the first shot must start at 0');
        shots.forEach((s, i) => {
          s.t1 = i + 1 < shots.length ? shots[i + 1].t0 : o.end;
          s.draw = s.init(s.t0, s.t1);
        });
        events.sort((a, b) => a.t - b.t);
        window.RIG_TIMELINE = { end: o.end, cuts: shots.map(s => ({ id: s.id, t: s.t0 })), wipes: wipes.map(w => w.t), events, warnings };
        renderFrame(0);
      },
      async renderAt(time) { renderFrame(Number(time.ticks) / time.timescale); },
      dispose() { mainCtx = null; c = null; buffer = null; },
    };
  }

  const R = {
    style, W, H, FPS, UNIT, assets, img, sprite, voice, cue, cueEnd, E,
    clamp, lerp, smooth, easeOut, spring, squash, hop, fall, roll, hash,
    camera, screen, plate, board,
    typed, cross, check, ring, tag, backdrop, gear: gearShape, puff, pop, prop,
    actor, walker, walkPhase, legLength, swing, armSolve, hands,
    shot, wipe, film, renderFrame,
    get ctx() { return c; },
    get sprites() { return SPR; },
    onArm: null, onAcross: null, onCamera: null,
  };
  window.RigKit = R;
})();
