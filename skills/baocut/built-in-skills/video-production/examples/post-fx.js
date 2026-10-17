// post-fx.js — 代码画面的后期效果（Canvas2D），给 `baocut/1` 代码包用。
// 拷进代码包，用 <script src="./post-fx.js"></script> 引入，得到全局的 PostFX。
// 每个效果只由时间 t 与参数决定：不用 Math.random、Date.now，也不逐帧累加，同一时刻两次取帧一致。
// 所有效果都不读回主画布（不 getImageData、不把主画布当图片源）：导入时能走指令烘焙，比逐帧截图快一二十倍。
// 发光与色散要用到画好的画面，就让 draw(g, w, h) 在离屏画布上再画一遍（只在效果生效的那几帧）。
//
// 典型的 renderAt(t)：
//   const fx = PostFX.cuesAt(cues, t);              // cues 读自包里的 cues.json
//   const s = PostFX.shake(t, fx.shake * 24);        // 先算震动与推近，画正片时套上
//   const draw = (g, w, h) => {                      // 画一遍正片：g 是要画的 context，w×h 是它的尺寸
//     g.save(); g.scale(w / W, h / H); g.translate(s.x, s.y); PostFX.zoom(g, W, H, 1 + fx.zoom * 0.08);
//     drawScene(g, t);
//     g.restore();
//   };
//   ctx.clearRect(0, 0, W, H);
//   draw(ctx, W, H);
//   PostFX.glow(ctx, fx.glow * 0.8, draw);           // 再按顺序叠：发光 → 色散 → 暗角 → 颗粒 → 闪白
//   PostFX.chroma(ctx, fx.glitch * 6, draw);
//   PostFX.vignette(ctx, 0.35);
//   PostFX.grain(ctx, t, 30, 0.06);
//   PostFX.flash(ctx, fx.flash);
(function () {
  'use strict';

  /** 整数编号 → [0, 1) 的固定值；同一个编号永远是同一个值。 */
  function hash(n) {
    let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }

  /** 一条提示在 t 时的强度：起 30 ms 线性升到 strength，之后在 dur 内平方衰减到 0。 */
  function envelope(cue, t) {
    const dur = cue.dur > 0 ? cue.dur : 0.25;
    const local = t - cue.t;
    if (local < 0 || local >= dur) return 0;
    const strength = cue.strength === undefined ? 1 : cue.strength;
    const attack = Math.min(0.03, dur / 4);
    if (local < attack) return strength * (local / attack);
    const p = (local - attack) / (dur - attack);
    return strength * (1 - p) * (1 - p);
  }

  /** 把 t 时所有生效的提示按种类合成一个 { flash, glow, shake, zoom, glitch, … }（同种取最大）。 */
  function cuesAt(cues, t) {
    const out = { flash: 0, glow: 0, shake: 0, zoom: 0, glitch: 0 };
    for (const cue of cues) {
      const v = envelope(cue, t);
      if (v > 0) out[cue.kind] = Math.max(out[cue.kind] || 0, v);
    }
    return out;
  }

  /** 平滑的确定性抖动：返回 { x, y } 像素位移，amount 是最大位移。 */
  function shake(t, amount, seed) {
    if (!(amount > 0)) return { x: 0, y: 0 };
    const base = (seed | 0) * 7919;
    const noise = (channel) => {
      const u = t * 28;
      const i = Math.floor(u);
      const f = u - i;
      const s = f * f * (3 - 2 * f);
      const a = hash(base + channel * 104729 + i) * 2 - 1;
      const b = hash(base + channel * 104729 + i + 1) * 2 - 1;
      return a + (b - a) * s;
    };
    return { x: noise(1) * amount, y: noise(2) * amount };
  }

  /** 以画面中心推近；在画正片之前、ctx.save() 之后调用。 */
  function zoom(ctx, w, h, scale) {
    if (scale === 1) return;
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h / 2);
  }

  function flash(ctx, amount, color) {
    if (!(amount > 0)) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, amount);
    ctx.fillStyle = color || '#ffffff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  function vignette(ctx, strength) {
    if (!(strength > 0)) return;
    const { width: w, height: h } = ctx.canvas;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${Math.min(1, strength)})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  const scratch = new Map();
  function canvasFor(key, w, h) {
    let c = scratch.get(key);
    if (!c || c.width !== w || c.height !== h) {
      c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      scratch.set(key, c);
    }
    return c;
  }

  /** 发光：draw 在 1/8 大小的离屏画布上把正片再画一遍（放大回来就是模糊），用 screen 叠回去。 */
  function glow(ctx, amount, draw) {
    if (!(amount > 0)) return;
    const { width: w, height: h } = ctx.canvas;
    const small = canvasFor('glow', Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 8)));
    const g = small.getContext('2d');
    g.clearRect(0, 0, small.width, small.height);
    draw(g, small.width, small.height);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.min(1, amount);
    ctx.drawImage(small, 0, 0, w, h);
    ctx.restore();
  }

  /**
   * 色散：红通道往左、蓝通道往右各挪 px 像素（不透明的画面）。主画布只留绿通道，红、蓝各在离屏画布上用 draw 再画一遍、
   * 乘上纯色取出单个通道，错开后用 lighter 加回来。只在要用的那几帧调用。
   */
  function chroma(ctx, px, draw) {
    const shift = Math.round(px);
    if (!(shift > 0)) return;
    const { width: w, height: h } = ctx.canvas;
    const channel = (key, color) => {
      const c = canvasFor(key, w, h);
      const g = c.getContext('2d');
      g.clearRect(0, 0, w, h);
      draw(g, w, h);
      g.save();
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      g.restore();
      return c;
    };
    const red = channel('chroma-r', '#ff0000');
    const blue = channel('chroma-b', '#0000ff');
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(red, -shift, 0);
    ctx.drawImage(blue, shift, 0);
    ctx.restore();
  }

  /** 胶片颗粒：4 张预先算好的噪点图按帧号轮换，overlay 叠上去。 */
  const GRAIN_SIZE = 256;
  const grainTiles = [];
  function grainTile(index) {
    if (!grainTiles[index]) {
      const c = document.createElement('canvas');
      c.width = GRAIN_SIZE;
      c.height = GRAIN_SIZE;
      const g = c.getContext('2d');
      const image = g.createImageData(GRAIN_SIZE, GRAIN_SIZE);
      for (let p = 0; p < GRAIN_SIZE * GRAIN_SIZE; p++) {
        const v = Math.round(hash(index * 65536 + p) * 255);
        image.data[p * 4] = v;
        image.data[p * 4 + 1] = v;
        image.data[p * 4 + 2] = v;
        image.data[p * 4 + 3] = 255;
      }
      g.putImageData(image, 0, 0);
      grainTiles[index] = c;
    }
    return grainTiles[index];
  }

  function grain(ctx, t, fps, amount) {
    if (!(amount > 0)) return;
    const frame = Math.floor(t * (fps || 30) + 1e-6);
    const tile = grainTile(frame % 4);
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(1, amount);
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    // 每帧把噪点图挪一个固定的偏移，免得四张图轮换看出格子。
    ctx.translate(-Math.floor(hash(frame) * GRAIN_SIZE), -Math.floor(hash(frame + 1) * GRAIN_SIZE));
    ctx.fillRect(0, 0, ctx.canvas.width + GRAIN_SIZE, ctx.canvas.height + GRAIN_SIZE);
    ctx.restore();
  }

  globalThis.PostFX = { hash, envelope, cuesAt, shake, zoom, flash, vignette, glow, chroma, grain };
})();
