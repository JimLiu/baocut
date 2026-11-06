// i18n-ignore-file: 拷进代码包用的运行库，报错写英文
// 卡通主播的画法：一张底图 + 局部补丁（口型、眨眼、表情），按 host-track.js 的时间轴逐帧换。
// 只由时间决定画面（同一时刻两次画结果相同），只画一张 Canvas 2D，能走指令烘焙。
//   const host = HostKit.host(window.HOST_PACK, window.HOST_TRACK);
//   HostKit.film({ draw(ctx, t) { host.draw(ctx, t, { x: 1640, y: 1080, h: 460 }); } });
// 嵌进别的代码包时不用 film()：在自己的 initialize 里 await host.ready，renderAt 里调 host.draw。
// 眨眼的快慢（闭 75 毫秒、睁 120 毫秒）取自 LivLiv Player 的 runtime/idle.ts（Apache-2.0，见 THIRD_PARTY_NOTICES.md）。
(() => {
  const jobs = [];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = u => { u = clamp(u); return u * u * (3 - 2 * u); };

  function loadImage(src) {
    const im = new Image();
    im.src = src;
    const job = im.decode().then(() => im, () => { throw new Error(`missing image ${src}`); });
    jobs.push(job);
    return im;
  }

  // 缺某个口型时借用最接近的；X（静止）就是底图本身的嘴
  const FALLBACK = { A: ['X'], B: ['C', 'A'], C: ['B', 'D', 'E'], D: ['C', 'E', 'B'], E: ['F', 'C', 'D'], F: ['E', 'A'], G: ['B', 'A'], X: [] };

  /** 有序的 [[t, value]]：t 时刻生效的那一项（找不到时 null） */
  function at(list, t) {
    let lo = 0, hi = list.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best < 0 ? null : list[best];
  }

  /**
   * pack：host-pack.mjs 写的 HOST_PACK；track：lipsync.mjs 写的 HOST_TRACK（可以不给，只眨眼不说话）。
   * o.dir：pack 里图片路径的前缀（缺省 './'）；o.motion：动作幅度倍数（0 = 不点头、不晃，缺省 1）；
   * o.idleBlink：时间轴以外（track 之前、之后、没有 track）每隔几秒眨一次眼，缺省 4，0 = 不眨
   */
  function host(pack, track = null, o = {}) {
    if (!pack || pack.version !== 1) throw new Error('host(): pass window.HOST_PACK written by host-pack.mjs');
    if (track && track.version !== 1) throw new Error('host(): pass window.HOST_TRACK written by lipsync.mjs');
    const dir = o.dir ?? './';
    const motionScale = o.motion ?? 1;
    const idleBlink = o.idleBlink ?? 4;
    const base = loadImage(dir + pack.base);
    const group = g => Object.fromEntries(Object.entries(pack[g] || {}).map(([n, p]) => [n, { ...p, im: loadImage(dir + p.src) }]));
    const mouth = group('mouth'), eyes = group('eyes'), face = group('face');
    const fps = track?.fps ?? 30, half = 0.5 / fps;
    const T = track ?? { mouth: [], blinks: [], nods: [], turns: [], faces: [], dur: 0 };
    const missing = new Set();

    function pickMouth(shape) {
      const seen = [shape, ...(FALLBACK[shape] ?? ['X'])];
      for (const s of seen) if (s === 'X' || mouth[s]) return s;
      return 'X';
    }

    /** 当前口型的字母（X A B C D E F G） */
    function shapeAt(t) {
      const hit = at(T.mouth, t + half);
      return hit && t <= T.dur + (T.offset ?? 0) + half ? hit[1] : 'X';
    }

    /** 表情：[名字, 不透明度]，进出各 0.2 秒淡入淡出；没有表情时 null */
    function faceAt(t) {
      for (const [t0, t1, name] of T.faces) {
        if (t < t0 - 0.2 || t > t1 + 0.2) continue;
        const a = Math.min(ease((t - t0 + 0.2) / 0.2), ease((t1 + 0.2 - t) / 0.2));
        if (a > 0) return [name, a];
      }
      return T.face ? [T.face, 1] : null;
    }

    /** 眨眼：0 睁眼，1 半闭，2 全闭。闭眼约 75 毫秒、睁眼约 120 毫秒 */
    const blinkList = (T.blinks || []).map(v => [v]);
    const trackStart = T.mouth.length ? T.mouth[0][0] : 0, trackEnd = (T.offset ?? 0) + (T.dur ?? 0);
    function idleAt(t) {
      // 时间轴以外按固定节奏眨，间隔带一点确定的变化
      if (!(idleBlink > 0)) return null;
      const k0 = Math.floor(t / idleBlink);
      for (let k = k0; k >= k0 - 1; k--) {
        const b = k * idleBlink + (((k * 7919) % 13) + 13) % 13 / 13 * idleBlink * 0.4;
        if (b <= t) return b;
      }
      return null;
    }
    function blinkAt(t) {
      let b = at(blinkList, t)?.[0] ?? null;
      if (!track || t < trackStart - 1 || t > trackEnd + 0.5) {
        const i = idleAt(t);
        if (i != null && (b == null || i > b)) b = i;
      }
      if (b == null) return 0;
      const u = t - b;
      if (u < 0 || u >= 0.2) return 0;
      return u < 0.04 || u >= 0.12 ? 1 : 2;
    }

    /** 点头：每个点头是一次临界阻尼的下沉，约 0.09 秒到底、0.6 秒回正 */
    function nodAt(t) {
      let y = 0;
      for (const [tn, s] of T.nods) {
        const u = t - tn;
        if (u < 0) break;
        if (u > 0.7) continue;
        const k = u / 0.09;
        y += s * k * Math.exp(1 - k);
      }
      return Math.min(y, 1.4);
    }

    /** 每句的朝向：句首 0.35 秒转过去，句末 0.35 秒转回来 */
    function turnAt(t) {
      let x = 0, y = 0;
      for (const [t0, t1, tx, ty] of T.turns) {
        if (t < t0 || t > t1 + 0.35) continue;
        const w = Math.min(ease((t - t0) / 0.35), ease((t1 + 0.35 - t) / 0.35));
        x += tx * w; y += ty * w;
      }
      return [x, y];
    }

    function patch(ctx, p, alpha = 1) {
      if (!p || alpha <= 0) return;
      if (alpha < 1) { ctx.save(); ctx.globalAlpha *= alpha; }
      ctx.drawImage(p.im, p.x, p.y, p.w, p.h);
      if (alpha < 1) ctx.restore();
    }

    /**
     * 画一帧。o.x, o.y：底边中点在画布上的位置（缺省右下角）；o.h：画出来的高度（缺省底图原高）；
     * o.flip：左右镜像；o.sink：底边往下藏多少（缺省高度的 4%，晃动时不露出底图的切边）；o.shape / o.face：临时盖过时间轴
     */
    function draw(ctx, t, d = {}) {
      const W = pack.w, H = pack.h;
      const h = d.h ?? H, s = h / H;
      const cw = ctx.canvas?.width ?? 1920, ch = ctx.canvas?.height ?? 1080;
      const x = d.x ?? cw - W * s * 0.55, y = d.y ?? ch;
      const sink = d.sink ?? h * 0.04;
      const m = motionScale;
      const [tx, ty] = turnAt(t);
      const nod = nodAt(t);
      const breathe = Math.sin((t / 3.6) * Math.PI * 2), sway = Math.sin((t / 7.3) * Math.PI * 2 + 1.3);
      const rot = m * (tx * 0.021 + sway * 0.004);
      const dx = m * (tx * 0.012 + sway * 0.003) * h;
      const dy = m * nod * 0.018 * h;
      const sy = 1 + m * (breathe * 0.004 - nod * 0.006 + ty * 0.006);

      ctx.save();
      ctx.translate(x + dx, y + sink + dy);
      ctx.rotate(rot);
      ctx.scale(d.flip ? -s : s, s * sy);
      ctx.translate(-W / 2, -H);
      ctx.drawImage(base, 0, 0, W, H);

      const f = d.face !== undefined ? (d.face ? [d.face, 1] : null) : faceAt(t);
      if (f && !face[f[0]] && !mouth[f[0]] && !missing.has(f[0])) {
        missing.add(f[0]);
        console.warn(`host: no face or mouth patch named ${f[0]}; drawing the plain face`);
      }
      const faceAlpha = f && face[f[0]] ? f[1] : 0;
      patch(ctx, f && face[f[0]], faceAlpha);
      // 表情盖住眼睛时不眨眼（补丁里的眼睛是平常的脸）
      if (faceAlpha < 0.5) {
        const b = blinkAt(t);
        const e = b === 2 ? eyes.closed ?? eyes.half : b === 1 ? eyes.half : null;
        patch(ctx, e, 1 - faceAlpha * 2);
      }
      let shape = pickMouth(d.shape ?? shapeAt(t));
      // 不说话时用表情自己的嘴（有 mouth.smile 这类补丁时）
      if (shape === 'X' && f && mouth[f[0]]) patch(ctx, mouth[f[0]], f[1]);
      else if (shape !== 'X') patch(ctx, mouth[shape]);
      ctx.restore();
      return shape;
    }

    const ready = Promise.all(jobs.slice());
    return { draw, shapeAt, faceAt, blinkAt, ready, pack, track: T, missing };
  }

  /**
   * 注册 baocut/1 合成。o.draw(ctx, t) 画一帧（画布已清成透明）；o.id 缺省取根元素的 data-composition-id；
   * o.background：不透明的底色（不给时整帧透明，叠在视频上）
   */
  function film(o) {
    const root = document.querySelector('[data-composition-id]');
    const id = o.id ?? root?.dataset.compositionId ?? 'main';
    let ctx = null;
    function frame(t) {
      const cv = ctx.canvas;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, cv.width, cv.height); }
      o.draw(ctx, t);
    }
    window.__baocutCompositions = window.__baocutCompositions || {};
    window.__baocutCompositions[id] = {
      async initialize(context) {
        const canvas = (context.target ?? root).querySelector('canvas');
        if (!canvas) throw new Error('no canvas inside the composition root');
        ctx = canvas.getContext('2d');
        await Promise.all(jobs);
        frame(0);
      },
      async renderAt(time) { frame(Number(time.ticks) / time.timescale); },
      dispose() { ctx = null; },
    };
  }

  window.HostKit = { host, film, FALLBACK };
})();
