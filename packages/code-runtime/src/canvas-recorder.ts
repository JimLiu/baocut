/**
 * 页面里的 Canvas 2D 录制脚本（代码包规范 §7.2「指令烘焙」）。
 *
 * 宿主在 `ready()` 之前用 `webContents.executeJavaScript` 注入 `CANVAS_RECORDER_SCRIPT`，得到 `window.__baocutRecorder`。
 * 它包装 `CanvasRenderingContext2D.prototype` 的路径、裁剪、状态栈与绘制方法：照常调用原方法（`measureText`、状态读写都还是
 * Chromium 的结果），同时在录制窗口里把主画布上的调用记成指令。Rust 侧（`render-raster` 的 `canvas2d`）把指令转成 DrawOp 再光栅。
 *
 * - 主画布：根元素里唯一一张已挂进文档（`isConnected`）的 canvas，尺寸等于固有尺寸、铺满视口。根元素里别的可见 DOM、非 2D 上下文、
 *   `alpha: false`、CSS 变换或不透明度都判为不支持。
 * - 状态直接读真实 context（变换、填充、透明度、合成、投影、线型、字体）；只有路径与裁剪栈自己跟踪：路径命令连同加入时的变换一起记，
 *   帧首把延续下来的路径与裁剪栈写进 `init`，每一帧因此自成一体，可以并行转换。
 * - 渐变、图案的参数记在 WeakMap 里；离屏 canvas 作图片源时按版本号快照成位图资源；图片记 `currentSrc`（宿主改写成包内相对路径）；
 *   字体按 CSS 字体匹配从 `document.fonts` 里选 face，URL 来自包装过的 `FontFace` 构造函数或 `@font-face` 规则。
 * - 文字在这里归一成「左对齐 + alphabetic 基线」：对齐用 `measureText().width`，基线偏移用两种基线下 `fontBoundingBoxAscent` 之差。
 * - 判为不支持时记下第一条原因，`record` 照常返回，由宿主整段回退到像素烘焙。
 *
 * `record(seconds[])` 逐个时刻调 `__baocutAdapter.seek(秒, false)`（不等 rAF），返回
 * `{ frames: [{ i, s, init?, ops, states, grads, pats }], resources: [新出现的资源], header, unsupported }`。指令格式见规范 §7.2。
 */

// i18n-ignore-start: 注入页面的脚本源码，不是给人看的文字
export const CANVAS_RECORDER_SCRIPT = String.raw`(() => {
  if (window.__baocutRecorder) return;
  const C2D = CanvasRenderingContext2D.prototype;
  const orig = {};
  const PATH_LOG_LIMIT = 200000;
  let main = null;
  let frame = null;
  let unsupported = null;
  const fail = (reason) => {
    if (!unsupported) unsupported = String(reason);
  };

  // ---------- 数值 ----------
  const r5 = (v) => (Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : v);
  const r7 = (v) => (Number.isFinite(v) ? Math.round(v * 1e7) / 1e7 : v);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  // ---------- 资源 ----------
  const resources = [];
  let resourceCursor = 0;
  const resourceIds = new Map();
  const addResource = (key, make) => {
    if (resourceIds.has(key)) return resourceIds.get(key);
    const value = make();
    if (value === null) return null;
    const id = resources.length;
    value.id = id;
    resources.push(value);
    resourceIds.set(key, id);
    return id;
  };

  // ---------- 离屏 canvas 版本号 ----------
  const versions = new WeakMap();
  const bump = (canvas) => versions.set(canvas, (versions.get(canvas) || 0) + 1);
  for (const prop of ['width', 'height']) {
    const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
    if (!desc || !desc.set) continue;
    Object.defineProperty(HTMLCanvasElement.prototype, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(value) {
        desc.set.call(this, value);
        if (this === main) {
          resetMirror();
          if (frame) frame.ops.push(['RESET']);
        } else bump(this);
      },
    });
  }

  // ---------- 字体 ----------
  const faceSources = new WeakMap();
  const NativeFontFace = window.FontFace;
  if (typeof NativeFontFace === 'function') {
    window.FontFace = new Proxy(NativeFontFace, {
      construct(target, args, newTarget) {
        const face = Reflect.construct(target, args, newTarget);
        faceSources.set(face, { source: args[1], base: document.baseURI });
        return face;
      },
    });
  }
  const unquote = (s) => String(s).trim().replace(/^(['"])(.*)\1$/, '$2');
  const splitFamilies = (list) => {
    const out = [];
    let cur = '';
    let quote = null;
    for (const ch of list) {
      if (quote) {
        cur += ch;
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        cur += ch;
        quote = ch;
      } else if (ch === ',') {
        out.push(unquote(cur));
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(unquote(cur));
    return out.filter(Boolean);
  };
  const firstUrl = (src, base) => {
    const m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(String(src));
    if (!m) return null;
    try {
      return new URL(m[2], base).href;
    } catch {
      return null;
    }
  };
  const parseWeight = (w) => {
    const parts = String(w).trim().split(/\s+/).map((p) => (p === 'normal' ? 400 : p === 'bold' ? 700 : Number(p)));
    if (parts.some((p) => !Number.isFinite(p))) return null;
    return [parts[0], parts.length > 1 ? parts[1] : parts[0]];
  };
  const styleKind = (s) => (/^italic/.test(s) ? 'italic' : /^oblique/.test(s) ? 'oblique' : 'normal');
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);

  const cssFaceUrl = (face) => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const fam = unquote(rule.style.getPropertyValue('font-family'));
        if (fam.toLowerCase() !== unquote(face.family).toLowerCase()) continue;
        const w = rule.style.getPropertyValue('font-weight') || 'normal';
        const s = rule.style.getPropertyValue('font-style') || 'normal';
        if (String(parseWeight(w)) !== String(parseWeight(face.weight)) || styleKind(s) !== styleKind(face.style)) continue;
        return firstUrl(rule.style.getPropertyValue('src'), sheet.href || document.baseURI);
      }
    }
    return null;
  };

  let facesCache = null;
  const loadedFaces = () => {
    if (facesCache) return facesCache;
    const out = [];
    document.fonts.forEach((face) => {
      if (face.status !== 'loaded') return;
      out.push(face);
    });
    facesCache = out;
    return out;
  };

  const faceResource = (face) =>
    addResource(face, () => {
      const known = faceSources.get(face);
      let url = null;
      if (known) {
        if (typeof known.source !== 'string') {
          fail('font-binary-source');
          return null;
        }
        url = firstUrl(known.source, known.base);
      } else url = cssFaceUrl(face);
      if (!url || !/^file:/i.test(url)) {
        fail('font-source-unresolved: ' + face.family);
        return null;
      }
      if (face.unicodeRange && !/^U\+0+-10FFFF$/i.test(String(face.unicodeRange).trim())) {
        fail('font-unicode-range: ' + face.family);
        return null;
      }
      if (face.featureSettings && face.featureSettings !== 'normal') {
        fail('font-feature-settings: ' + face.family);
        return null;
      }
      const weight = parseWeight(face.weight) || [400, 400];
      return { type: 'font', url, family: unquote(face.family), weight, style: styleKind(face.style) };
    });

  // CSS Fonts 4 §5.2：先按样式，再按粗细选 face。
  const matchFace = (faces, weight, style) => {
    const order = style === 'italic' ? ['italic', 'oblique', 'normal'] : style === 'oblique' ? ['oblique', 'italic', 'normal'] : ['normal', 'oblique', 'italic'];
    let pool = [];
    for (const kind of order) {
      pool = faces.filter((f) => styleKind(f.style) === kind);
      if (pool.length) break;
    }
    const ranged = pool.map((f) => ({ f, w: parseWeight(f.weight) || [400, 400] }));
    const inRange = ranged.find((x) => x.w[0] <= weight && weight <= x.w[1]);
    if (inRange) return inRange.f;
    const below = ranged.filter((x) => x.w[1] < weight).sort((a, b) => b.w[1] - a.w[1]);
    const above = ranged.filter((x) => x.w[0] > weight).sort((a, b) => a.w[0] - b.w[0]);
    let pick;
    if (weight >= 400 && weight <= 500) {
      const upTo500 = above.filter((x) => x.w[0] <= 500);
      pick = upTo500[0] || below[0] || above[0];
    } else if (weight < 400) pick = below[0] || above[0];
    else pick = above[0] || below[0];
    return pick ? pick.f : null;
  };

  // ctx.font 的序列化形如 "italic bold 48px/normal \"BC Sans\", sans-serif"。
  const fontCache = new Map();
  const resolveFont = (spec) => {
    if (fontCache.has(spec)) return fontCache.get(spec);
    let result = null;
    const m = /^(.*?)\s*(-?[\d.]+(?:e[-+]?\d+)?)px(?:\s*\/\s*\S+)?\s+(.+)$/i.exec(spec);
    if (!m) fail('font-unparsed: ' + spec);
    else {
      let weight = 400;
      let style = 'normal';
      let ok = true;
      for (const word of m[1].split(/\s+/).filter(Boolean)) {
        if (word === 'normal') continue;
        if (word === 'italic' || word === 'oblique') style = word;
        else if (word === 'bold') weight = 700;
        else if (/^\d+(\.\d+)?$/.test(word)) weight = Number(word);
        else {
          ok = false;
          fail('font-variant: ' + word);
        }
      }
      const size = Number(m[2]);
      if (ok && size > 0) {
        const faces = loadedFaces();
        for (const family of splitFamilies(m[3])) {
          if (GENERIC.has(family.toLowerCase())) break;
          const candidates = faces.filter((f) => unquote(f.family).toLowerCase() === family.toLowerCase());
          if (!candidates.length) continue;
          const face = matchFace(candidates, weight, style);
          const id = face ? faceResource(face) : null;
          if (id !== null) result = { id, size, weight, style };
          break;
        }
        if (!result) fail('font-not-bundled: ' + spec);
      }
    }
    fontCache.set(spec, result);
    return result;
  };

  // ---------- 颜色 ----------
  let scratch = null;
  const colorCache = new Map();
  const parseColor = (text) => {
    if (colorCache.has(text)) return colorCache.get(text);
    let out = null;
    const s = String(text).trim();
    let m;
    if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s))) {
      const v = parseInt(m[1], 16);
      out = [(v >> 16) & 255, (v >> 8) & 255, v & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
    } else if ((m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s))) {
      let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      out = [Number(m[1]), Number(m[2]), Number(m[3]), a];
    } else if (s === 'transparent') out = [0, 0, 0, 0];
    colorCache.set(text, out);
    return out;
  };
  const normalizeColor = (value) => {
    if (!scratch) scratch = document.createElement('canvas').getContext('2d');
    scratch.fillStyle = '#000000';
    scratch.fillStyle = value;
    const c = parseColor(scratch.fillStyle);
    if (!c) fail('color-space: ' + scratch.fillStyle);
    return c || [0, 0, 0, 0];
  };

  // ---------- 渐变与图案 ----------
  const gradients = new WeakMap();
  const patterns = new WeakMap();
  const wrapFactory = (name, make) => {
    const fn = C2D[name];
    if (typeof fn !== 'function') return;
    orig[name] = fn;
    C2D[name] = function (...args) {
      const result = fn.apply(this, args);
      try {
        make(this, result, args);
      } catch (error) {
        fail(name + ': ' + error);
      }
      return result;
    };
  };
  wrapFactory('createLinearGradient', (_ctx, g, a) => gradients.set(g, { k: 'l', p: a.slice(0, 4).map(num), stops: [] }));
  wrapFactory('createRadialGradient', (_ctx, g, a) => gradients.set(g, { k: 'r', p: a.slice(0, 6).map(num), stops: [] }));
  wrapFactory('createConicGradient', (_ctx, g) => gradients.set(g, { k: 'c' }));
  wrapFactory('createPattern', (ctx, p, a) => {
    if (!p) return;
    const rep = a[1] === null || a[1] === undefined || a[1] === '' ? 'repeat' : String(a[1]);
    patterns.set(p, { source: a[0], version: a[0] instanceof HTMLCanvasElement ? versions.get(a[0]) || 0 : 0, rep, m: null });
  });
  const addStop = CanvasGradient.prototype.addColorStop;
  CanvasGradient.prototype.addColorStop = function (offset, color) {
    addStop.call(this, offset, color);
    const def = gradients.get(this);
    if (def && def.stops) def.stops.push([Number(offset)].concat(normalizeColor(color)));
  };
  const patternSetTransform = CanvasPattern.prototype.setTransform;
  if (typeof patternSetTransform === 'function') {
    CanvasPattern.prototype.setTransform = function (m) {
      patternSetTransform.call(this, m);
      const def = patterns.get(this);
      if (def) {
        const d = m ? new DOMMatrix([m.a ?? m.m11 ?? 1, m.b ?? m.m12 ?? 0, m.c ?? m.m21 ?? 0, m.d ?? m.m22 ?? 1, m.e ?? m.m41 ?? 0, m.f ?? m.m42 ?? 0]) : null;
        def.m = d ? [d.a, d.b, d.c, d.d, d.e, d.f].map(r7) : null;
      }
    };
  }

  // ---------- 图片源 ----------
  const sourceResource = (src) => {
    if (src instanceof HTMLImageElement) {
      if (!src.complete || !src.naturalWidth || !src.naturalHeight) return undefined;
      const url = src.currentSrc || src.src;
      if (!/^file:/i.test(url)) {
        fail('image-source-scheme: ' + url.slice(0, 32));
        return null;
      }
      return addResource('img:' + url, () => ({ type: 'image', url, w: src.naturalWidth, h: src.naturalHeight }));
    }
    if (src instanceof HTMLCanvasElement) {
      if (src === main) {
        fail('main-canvas-as-source');
        return null;
      }
      if (!src.width || !src.height) return undefined;
      const version = versions.get(src) || 0;
      let key = canvasKeys.get(src);
      if (!key) {
        key = 'cv' + canvasCount++;
        canvasKeys.set(src, key);
      }
      return addResource(key + '@' + version, () => {
        let data;
        try {
          data = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
        } catch (error) {
          fail('canvas-source-unreadable');
          return null;
        }
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < data.length; i += CHUNK) bin += String.fromCharCode.apply(null, data.subarray(i, i + CHUNK));
        return { type: 'bitmap', w: src.width, h: src.height, rgba: btoa(bin) };
      });
    }
    fail('image-source-type: ' + (src && src.constructor ? src.constructor.name : typeof src));
    return null;
  };
  const canvasKeys = new WeakMap();
  let canvasCount = 0;

  // ---------- 路径与裁剪的镜像 ----------
  let pathLog = [];
  let levels = [[]];
  const resetMirror = () => {
    pathLog = [];
    levels = [[]];
  };
  const tfOf = (ctx) => {
    const m = ctx.getTransform();
    return [r7(m.a), r7(m.b), r7(m.c), r7(m.d), r5(m.e), r5(m.f)];
  };
  const sameTf = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5];
  const emitTf = (tf) => {
    if (!sameTf(frame.tf, tf)) {
      frame.ops.push(['m'].concat(tf));
      frame.tf = tf;
    }
  };

  const wrapPath = (name, encode) => {
    const fn = C2D[name];
    if (typeof fn !== 'function') return;
    orig[name] = fn;
    C2D[name] = function (...args) {
      const result = fn.apply(this, args);
      if (this.canvas === main && main) {
        if (name === 'beginPath') pathLog = [];
        else {
          const cmd = encode(args);
          if (cmd) {
            const tf = tfOf(this);
            pathLog.push({ tf, cmd });
            if (pathLog.length > PATH_LOG_LIMIT) {
              fail('path-too-long');
              pathLog = [];
            }
            if (frame) {
              emitTf(tf);
              frame.ops.push(cmd);
            }
          }
        }
        if (name === 'beginPath' && frame) frame.ops.push(['B']);
      }
      return result;
    };
  };
  const nums = (args, n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(r5(num(args[i])));
    return out;
  };
  const finite = (arr) => arr.every((v) => Number.isFinite(v));
  wrapPath('beginPath', () => null);
  wrapPath('closePath', () => ['Z']);
  wrapPath('moveTo', (a) => (finite(nums(a, 2)) ? ['M'].concat(nums(a, 2)) : null));
  wrapPath('lineTo', (a) => (finite(nums(a, 2)) ? ['L'].concat(nums(a, 2)) : null));
  wrapPath('quadraticCurveTo', (a) => (finite(nums(a, 4)) ? ['Q'].concat(nums(a, 4)) : null));
  wrapPath('bezierCurveTo', (a) => (finite(nums(a, 6)) ? ['C'].concat(nums(a, 6)) : null));
  wrapPath('arc', (a) => {
    const v = nums(a, 5).concat(a[5] ? 1 : 0);
    v[3] = num(a[3]);
    v[4] = num(a[4]);
    return finite(v) ? ['A'].concat(v) : null;
  });
  wrapPath('arcTo', (a) => (finite(nums(a, 5)) ? ['T'].concat(nums(a, 5)) : null));
  wrapPath('ellipse', (a) => {
    const v = nums(a, 4).concat([num(a[4]), num(a[5]), num(a[6]), a[7] ? 1 : 0]);
    return finite(v) ? ['E'].concat(v) : null;
  });
  wrapPath('rect', (a) => (finite(nums(a, 4)) ? ['R'].concat(nums(a, 4)) : null));
  wrapPath('roundRect', (a) => {
    const v = nums(a, 4);
    if (!finite(v)) return null;
    let radii = a[4] === undefined ? [0] : Array.isArray(a[4]) ? a[4] : [a[4]];
    const pt = (r) => (typeof r === 'number' ? [r, r] : [num(r && r.x !== undefined ? r.x : 0), num(r && r.y !== undefined ? r.y : 0)]);
    radii = radii.map(pt);
    let ul, ur, lr, ll;
    if (radii.length === 4) [ul, ur, lr, ll] = radii;
    else if (radii.length === 3) [ul, ur, lr, ll] = [radii[0], radii[1], radii[2], radii[1]];
    else if (radii.length === 2) [ul, ur, lr, ll] = [radii[0], radii[1], radii[0], radii[1]];
    else [ul, ur, lr, ll] = [radii[0], radii[0], radii[0], radii[0]];
    return ['RR'].concat(v, ul, ur, lr, ll);
  });

  const wrapStack = (name, apply) => {
    const fn = C2D[name];
    orig[name] = fn;
    C2D[name] = function (...args) {
      const result = fn.apply(this, args);
      if (this.canvas === main && main) apply(this, args);
      return result;
    };
  };
  wrapStack('save', () => {
    levels.push(levels[levels.length - 1].slice());
    if (frame) frame.ops.push(['S']);
  });
  wrapStack('restore', () => {
    if (levels.length > 1) levels.pop();
    if (frame) frame.ops.push(['X']);
  });
  wrapStack('clip', (ctx, args) => {
    if (args[0] instanceof Path2D) return fail('Path2D');
    const rule = args[0] === 'evenodd' ? 1 : 0;
    levels[levels.length - 1] = levels[levels.length - 1].concat([{ path: pathLog.slice(), rule }]);
    if (frame) frame.ops.push(['K', rule]);
  });
  for (const name of ['reset', 'putImageData', 'drawFocusIfNeeded', 'scrollPathIntoView']) {
    const fn = C2D[name];
    if (typeof fn !== 'function') continue;
    orig[name] = fn;
    C2D[name] = function (...args) {
      if (this.canvas === main) {
        if (name === 'reset') resetMirror();
        if (frame || name === 'reset') fail('unsupported-call: ' + name);
      } else bump(this.canvas);
      return fn.apply(this, args);
    };
  }
  {
    const fn = C2D.getImageData;
    C2D.getImageData = function (...args) {
      if (this.canvas === main) fail('main-canvas-readback');
      return fn.apply(this, args);
    };
  }

  // ---------- 绘制状态 ----------
  const paintOf = (style) => {
    if (typeof style === 'string') {
      const c = parseColor(style);
      if (!c) fail('color-space: ' + style);
      return ['c'].concat(c || [0, 0, 0, 0]);
    }
    if (style instanceof CanvasGradient) {
      const def = gradients.get(style);
      if (!def) return fail('gradient-untracked'), ['c', 0, 0, 0, 0];
      if (def.k === 'c') return fail('conic-gradient'), ['c', 0, 0, 0, 0];
      const key = JSON.stringify(def);
      let id = frame.gradKeys.get(key);
      if (id === undefined) {
        id = frame.grads.length;
        frame.grads.push(def);
        frame.gradKeys.set(key, id);
      }
      return ['g', id];
    }
    if (style instanceof CanvasPattern) {
      const def = patterns.get(style);
      if (!def) return fail('pattern-untracked'), ['c', 0, 0, 0, 0];
      if (def.rep !== 'repeat') return fail('pattern-repetition: ' + def.rep), ['c', 0, 0, 0, 0];
      if (def.source instanceof HTMLCanvasElement && (versions.get(def.source) || 0) !== def.version) {
        // 图案在创建时就拷贝了源画布；之后源画布再变不影响这个图案。
        fail('pattern-source-changed');
      }
      const res = sourceResource(def.source);
      if (res === null || res === undefined) return ['c', 0, 0, 0, 0];
      const pat = { r: res, m: def.m };
      const key = JSON.stringify(pat);
      let id = frame.patKeys.get(key);
      if (id === undefined) {
        id = frame.pats.length;
        frame.pats.push(pat);
        frame.patKeys.set(key, id);
      }
      return ['p', id];
    }
    fail('paint-type');
    return ['c', 0, 0, 0, 0];
  };

  const stateOf = (ctx, kind) => {
    if (ctx.filter && ctx.filter !== 'none') fail('filter: ' + ctx.filter);
    const st = { a: r5(ctx.globalAlpha), op: ctx.globalCompositeOperation };
    const sc = parseColor(ctx.shadowColor) || [0, 0, 0, 0];
    if (sc[3] > 0 && (ctx.shadowBlur > 0 || ctx.shadowOffsetX || ctx.shadowOffsetY)) st.sh = sc.concat([r5(ctx.shadowBlur), r5(ctx.shadowOffsetX), r5(ctx.shadowOffsetY)]);
    if (kind === 'fill') st.p = paintOf(ctx.fillStyle);
    else if (kind === 'stroke') {
      st.p = paintOf(ctx.strokeStyle);
      st.lw = r5(ctx.lineWidth);
      st.cap = ctx.lineCap;
      st.join = ctx.lineJoin;
      st.ml = r5(ctx.miterLimit);
      const dash = ctx.getLineDash();
      if (dash.length) {
        st.dash = dash.map(r5);
        st.do = r5(ctx.lineDashOffset);
      }
    }
    if (kind === 'image' || (st.p && st.p[0] === 'p')) {
      if (!ctx.imageSmoothingEnabled) fail('image-smoothing-disabled');
      else if (ctx.imageSmoothingQuality && ctx.imageSmoothingQuality !== 'low') fail('image-smoothing-quality: ' + ctx.imageSmoothingQuality);
    }
    const key = JSON.stringify(st);
    let id = frame.stateKeys.get(key);
    if (id === undefined) {
      id = frame.states.length;
      frame.states.push(st);
      frame.stateKeys.set(key, id);
    }
    return id;
  };

  // ---------- 绘制 ----------
  const wrapDraw = (name, record) => {
    const fn = C2D[name];
    if (typeof fn !== 'function') return;
    orig[name] = fn;
    C2D[name] = function (...args) {
      const result = fn.apply(this, args);
      if (this.canvas !== main || !main) bump(this.canvas);
      else if (frame) {
        try {
          emitTf(tfOf(this));
          const op = record(this, args);
          if (op) frame.ops.push(op);
        } catch (error) {
          fail(name + ': ' + error);
        }
      }
      return result;
    };
  };
  wrapDraw('fill', (ctx, a) => {
    if (a[0] instanceof Path2D) return fail('Path2D'), null;
    return ['F', stateOf(ctx, 'fill'), a[0] === 'evenodd' ? 1 : 0];
  });
  wrapDraw('stroke', (ctx, a) => {
    if (a[0] instanceof Path2D) return fail('Path2D'), null;
    return ['D', stateOf(ctx, 'stroke')];
  });
  wrapDraw('fillRect', (ctx, a) => (finite(nums(a, 4)) ? ['FR', stateOf(ctx, 'fill')].concat(nums(a, 4)) : null));
  wrapDraw('strokeRect', (ctx, a) => (finite(nums(a, 4)) ? ['SR', stateOf(ctx, 'stroke')].concat(nums(a, 4)) : null));
  wrapDraw('clearRect', (_ctx, a) => (finite(nums(a, 4)) ? ['CR'].concat(nums(a, 4)) : null));

  const baselineCache = new Map();
  const baselineOffset = (ctx) => {
    const key = ctx.font + '|' + ctx.textBaseline;
    if (baselineCache.has(key)) return baselineCache.get(key);
    const current = ctx.textBaseline;
    const here = orig.measureText.call(ctx, 'M').fontBoundingBoxAscent;
    ctx.textBaseline = 'alphabetic';
    const alpha = orig.measureText.call(ctx, 'M').fontBoundingBoxAscent;
    ctx.textBaseline = current;
    const off = alpha - here;
    baselineCache.set(key, off);
    return off;
  };
  orig.measureText = C2D.measureText;
  const textOp = (tag) => (ctx, a) => {
    const text = String(a[0]).replace(/[\t\n\f\r]/g, ' ');
    const x = num(a[1]);
    const y = num(a[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    let maxWidth = a.length > 3 && a[3] !== undefined ? num(a[3]) : null;
    if (maxWidth !== null && !(maxWidth > 0)) return null;
    if (!text) return null;
    for (const [prop, ok] of [
      ['letterSpacing', ['0px', '0']],
      ['wordSpacing', ['0px', '0']],
      ['fontKerning', ['auto', 'normal']],
      ['fontStretch', ['normal']],
      ['fontVariantCaps', ['normal']],
      ['textRendering', ['auto']],
    ]) {
      if (ctx[prop] !== undefined && ctx[prop] !== '' && !ok.includes(ctx[prop])) fail('text-' + prop + ': ' + ctx[prop]);
    }
    let dir = ctx.direction;
    if (dir === 'inherit') dir = getComputedStyle(ctx.canvas).direction;
    if (dir === 'rtl') return fail('text-rtl'), null;
    const font = resolveFont(ctx.font);
    if (!font) return null;
    const width = orig.measureText.call(ctx, text).width;
    const off = baselineOffset(ctx);
    let align = ctx.textAlign;
    if (align === 'start') align = 'left';
    else if (align === 'end') align = 'right';
    let effective = width;
    let scaleX = 1;
    if (maxWidth !== null && width > maxWidth) {
      scaleX = maxWidth / width;
      effective = maxWidth;
    }
    const left = x - (align === 'center' ? effective / 2 : align === 'right' ? effective : 0);
    const st = stateOf(ctx, tag === 'FT' ? 'fill' : 'stroke');
    return [tag, st, text, r5(left), r5(y + off), font.id, font.size, font.weight, font.style, r5(width), r7(scaleX)];
  };
  wrapDraw('fillText', textOp('FT'));
  wrapDraw('strokeText', textOp('ST'));

  wrapDraw('drawImage', (ctx, a) => {
    const src = a[0];
    const res = sourceResource(src);
    if (res === null || res === undefined) return null;
    const def = resources[res];
    const iw = def.w;
    const ih = def.h;
    let sx = 0, sy = 0, sw = iw, sh = ih, dx, dy, dw, dh;
    if (a.length >= 9) [sx, sy, sw, sh, dx, dy, dw, dh] = a.slice(1, 9).map(num);
    else if (a.length >= 5) [dx, dy, dw, dh] = a.slice(1, 5).map(num);
    else {
      [dx, dy] = a.slice(1, 3).map(num);
      dw = iw;
      dh = ih;
    }
    const v = [sx, sy, sw, sh, dx, dy, dw, dh];
    if (!finite(v) || !sw || !sh || !dw || !dh) return null;
    // 负宽高按规范归一（矩形取角点，不翻转图像）。
    if (sw < 0) (sx += sw), (sw = -sw);
    if (sh < 0) (sy += sh), (sh = -sh);
    if (dw < 0) (dx += dw), (dw = -dw);
    if (dh < 0) (dy += dh), (dh = -dh);
    // 源矩形裁到图像内，目标矩形按比例跟着收。
    const kx = dw / sw;
    const ky = dh / sh;
    if (sx < 0) (dx -= sx * kx), (dw += sx * kx), (sw += sx), (sx = 0);
    if (sy < 0) (dy -= sy * ky), (dh += sy * ky), (sh += sy), (sy = 0);
    if (sx + sw > iw) (dw -= (sx + sw - iw) * kx), (sw = iw - sx);
    if (sy + sh > ih) (dh -= (sy + sh - ih) * ky), (sh = ih - sy);
    if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return null;
    return ['I', stateOf(ctx, 'image'), res].concat([sx, sy, sw, sh, dx, dy, dw, dh].map(r5));
  });

  // ---------- 主画布与页面检查 ----------
  const rgbaOf = (css) => parseColor(css) || null;
  const over = (top, under) => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a <= 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat([a]);
  };
  const covers = (el, W, H) => {
    const r = el.getBoundingClientRect();
    return r.left <= 0 && r.top <= 0 && r.right >= W && r.bottom >= H;
  };

  const inspect = (ctxInfo) => {
    const { width: W, height: H, alpha, compositionId } = ctxInfo;
    const escaped = window.CSS && CSS.escape ? CSS.escape(compositionId) : compositionId;
    const root = document.querySelector('[data-composition-id="' + escaped + '"]');
    if (!root) return { error: 'root-missing' };
    const canvases = Array.from(document.querySelectorAll('canvas')).filter((c) => c.isConnected && c.getClientRects().length > 0);
    if (canvases.length !== 1) return { error: 'canvas-count: ' + canvases.length };
    const cv = canvases[0];
    if (!root.contains(cv)) return { error: 'canvas-outside-root' };
    if (cv.width !== W || cv.height !== H) return { error: 'canvas-size: ' + cv.width + 'x' + cv.height };
    const r = cv.getBoundingClientRect();
    if (Math.abs(r.left) > 0.01 || Math.abs(r.top) > 0.01 || Math.abs(r.width - W) > 0.01 || Math.abs(r.height - H) > 0.01) {
      return { error: 'canvas-placement' };
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return { error: 'canvas-not-2d' };
    const attrs = ctx.getContextAttributes ? ctx.getContextAttributes() : {};
    if (attrs.alpha === false) return { error: 'canvas-opaque-context' };
    if (attrs.colorSpace && attrs.colorSpace !== 'srgb') return { error: 'canvas-color-space: ' + attrs.colorSpace };
    // 画布到 <html> 一路不能有变换、不透明度、滤镜、混合与遮罩。
    for (let el = cv; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.opacity !== '1' || cs.transform !== 'none' || cs.filter !== 'none' || cs.mixBlendMode !== 'normal' || (cs.clipPath && cs.clipPath !== 'none') || (cs.maskImage && cs.maskImage !== 'none') || cs.visibility !== 'visible') {
        return { error: 'canvas-ancestor-style: ' + el.tagName.toLowerCase() };
      }
    }
    // 根元素里除了画布与它的祖先，不能有可见的元素或文字。
    const chain = new Set();
    for (let el = cv; el; el = el.parentElement) chain.add(el);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 3) {
        if (node.textContent.trim() && node.parentElement && !/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(node.parentElement.tagName)) {
          const range = document.createRange();
          range.selectNodeContents(node);
          if (range.getClientRects().length) return { error: 'visible-text' };
        }
        continue;
      }
      if (chain.has(node) || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|LINK|META)$/.test(node.tagName)) continue;
      const rects = Array.from(node.getClientRects()).filter((q) => q.width > 0 && q.height > 0);
      if (rects.length && getComputedStyle(node).visibility !== 'hidden') return { error: 'visible-dom: ' + node.tagName.toLowerCase() };
    }
    // 页面底色：窗口底色上依次叠 html、body、…、画布的背景色。
    let bg = alpha ? [0, 0, 0, 0] : [0, 0, 0, 1];
    const html = document.documentElement;
    const layers = [];
    for (let el = cv; el; el = el.parentElement) layers.unshift(el);
    const htmlBg = rgbaOf(getComputedStyle(html).backgroundColor) || [0, 0, 0, 0];
    for (const el of layers) {
      const cs = getComputedStyle(el);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { error: 'background-image: ' + el.tagName.toLowerCase() };
      const c = rgbaOf(cs.backgroundColor);
      if (!c) return { error: 'background-color: ' + cs.backgroundColor };
      if (c[3] <= 0) continue;
      const fills = el === html || (el === document.body && htmlBg[3] <= 0) || covers(el, W, H);
      if (!fills) return { error: 'background-partial: ' + el.tagName.toLowerCase() };
      bg = over([c[0] / 255, c[1] / 255, c[2] / 255, c[3]], bg);
    }
    return { canvas: cv, background: bg.map((v) => Math.round(v * 1e6) / 1e6) };
  };

  const resetMirrorFor = (cv) => {
    if (main !== cv) {
      main = cv;
      resetMirror();
    }
  };

  window.__baocutRecorder = {
    record: async (seconds, ctxInfo) => {
      try {
        if (!window.__baocutAdapter) throw new Error('adapter missing');
        const page = inspect(ctxInfo);
        if (page.error) fail(page.error);
        else resetMirrorFor(page.canvas);
        facesCache = null;
        const frames = [];
        for (const s of seconds) {
          if (unsupported) break;
          frame = { s, ops: [], states: [], grads: [], pats: [], tf: null, stateKeys: new Map(), gradKeys: new Map(), patKeys: new Map() };
          if (pathLog.length || levels.some((l) => l.length)) {
            frame.init = { path: pathLog.map((e) => ({ tf: e.tf, cmd: e.cmd })), levels: levels.map((l) => l.map((e) => ({ path: e.path, rule: e.rule }))) };
          }
          let seek;
          try {
            seek = await window.__baocutAdapter.seek(s, false);
          } finally {
            const done = frame;
            frame = null;
            if (seek && seek.ok) {
              frames.push({ s: done.s, sampled: seek.value.sampledSeconds, target: seek.value.targetSeconds, clamped: seek.value.clamped, init: done.init, ops: done.ops, states: done.states, grads: done.grads, pats: done.pats });
            }
          }
          if (!seek || !seek.ok) return { ok: false, code: (seek && seek.code) || 'COMPOSITION_SCRIPT_ERROR', message: (seek && seek.message) || 'seek failed' };
        }
        const fresh = resources.slice(resourceCursor);
        resourceCursor = resources.length;
        return { ok: true, value: { frames, resources: fresh, background: page.background || null, unsupported } };
      } catch (error) {
        return { ok: false, code: 'COMPOSITION_SCRIPT_ERROR', message: String((error && error.message) || error) };
      }
    },
  };
})();
true;`;
// i18n-ignore-end
