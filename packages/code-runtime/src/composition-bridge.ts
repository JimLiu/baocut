import { COMPOSITION_BRIDGE_CHANNEL } from '@baocut/protocol';
import { COMPOSITION_ADAPTER_SCRIPT } from './composition-adapter.ts';

/**
 * 编辑器实时合成层的页面端桥（动效视频设计 §4.1；`@baocut/protocol` 的 `CompositionBridgeRequest` / `CompositionBridgeResponse`）。
 *
 * 舞台里的代码包跑在不开 `allow-same-origin` 的沙箱 `<iframe>` 里，父页面调不到 `window.__baocutAdapter`：这段脚本随入口页面
 * 一起下发（媒体通道给代码包目录发地址时注进入口页面的 `<head>` 开头，先于包自己的脚本跑），把取帧脚本的 `ready` / `seek` /
 * `dispose` 接到 `postMessage` 上。只认来自 `window.parent` 的、带 `channel` 的消息；回信的 `targetOrigin` 只能是 `*`（自己的来源
 * 是不透明的，父页面按 `event.source` 认 iframe）。就位时先发一次 `hello`，父页面从这时起才发请求。`ready` 没带 `compositionId`
 * 时在页面里按根元素的 `data-composition-id` 取（没有就是 `main`）：浏览器合成的清单里没有这个字段，父页面不知道。
 * `pick` 不经取帧脚本：交给 `COMPOSITION_PICK_SCRIPT` 装的 `window.__baocutPick`，回那一点下最内层节点的说明（或 `null`）；
 * `capture` 也不经取帧脚本：交给 `COMPOSITION_CAPTURE_SCRIPT` 装的 `window.__baocutCapture`，回此刻这一帧的 PNG（或 `null`）。
 *
 * 离屏宿主（`composition-host.ts`）仍直接 `executeJavaScript`，不经这座桥。
 */

// i18n-ignore-start: 注入页面的脚本源码，不是给人看的文字
/**
 * 「选择元素」的拾取（lite-editor §4.1、§11 第 12 条；`@baocut/protocol` 的 `CompositionBridgePick`）：装
 * `window.__baocutPick(x, y)`（视口坐标，即合成的固有像素）与 `window.__baocutDescribe(node)`。取最内层节点（与原型
 * `stage-markup.jsx` 的 `pickAt` 同），`html`、`body` 与没有节点时是 `null`。iframe 带 `inert` 与 `pointer-events: none` 不影响
 * 页面里的 `elementFromPoint`（2026-10-19 在 Electron 上核对过）。页面在 `window.__baocutPickRegions` 登记了拾取区域（代码包规范 §4.5：
 * 画在 canvas 里的字与图形）且点落在区域里时，先取最上面那个区域，写成 `region#<id>`。脚本里不用模板插值，全用 `+` 拼（这段源码本身是模板字符串）。
 */
export const COMPOSITION_PICK_SCRIPT = String.raw`(() => {
  if (window.__baocutPick) return;
  const NAME_MAX = 80;
  const IMPLICIT_ROLE = {
    button: 'button', img: 'img', svg: 'img', video: 'video', textarea: 'textbox', select: 'combobox',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary',
    ul: 'list', ol: 'list', li: 'listitem', table: 'table', form: 'form', dialog: 'dialog', progress: 'progressbar',
  };
  const INPUT_ROLE = {
    button: 'button', submit: 'button', reset: 'button', image: 'button', checkbox: 'checkbox', radio: 'radio',
    range: 'slider', number: 'spinbutton', search: 'searchbox',
  };
  const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const roleOf = (node, tag) => {
    const explicit = clean(node.getAttribute('role')).split(' ')[0];
    if (explicit) return explicit;
    if (tag === 'a' || tag === 'area') return node.hasAttribute('href') ? 'link' : undefined;
    if (tag === 'input') {
      const type = clean(node.getAttribute('type')).toLowerCase();
      if (type === 'hidden') return undefined;
      return INPUT_ROLE[type] || 'textbox';
    }
    return Object.prototype.hasOwnProperty.call(IMPLICIT_ROLE, tag) ? IMPLICIT_ROLE[tag] : undefined;
  };
  const nameOf = (node) => {
    for (const attr of ['aria-label', 'alt', 'title']) {
      const value = clean(node.getAttribute(attr));
      if (value) return value;
    }
    return clean(node.textContent);
  };
  const describe = (node) => {
    if (!node || node.nodeType !== 1 || node === document.documentElement || node === document.body) return null;
    const tag = String(node.tagName || '').toLowerCase();
    if (!tag || tag === 'html' || tag === 'body') return null;
    let selector = tag;
    if (node.id) selector += '#' + node.id;
    const classes = node.classList ? Array.from(node.classList).slice(0, 2) : [];
    for (const name of classes) selector += '.' + name;
    const box = node.getBoundingClientRect();
    const rect = { x: Math.round(box.left), y: Math.round(box.top), w: Math.round(box.width), h: Math.round(box.height) };
    const out = { selector, w: rect.w, h: rect.h, focusable: typeof node.tabIndex === 'number' && node.tabIndex >= 0 && !node.disabled, rect };
    let name = nameOf(node);
    if (name.length > NAME_MAX) name = name.slice(0, NAME_MAX - 1) + '\u2026';
    if (name) out.name = name;
    const role = roleOf(node, tag);
    if (role) out.role = role;
    return out;
  };
  // 页面登记的拾取区域（代码包规范 §4.5）：画在 canvas 里的字没有节点，按登记的框拾；后登记的在上，只看最后 REGIONS_MAX 项。
  const REGIONS_MAX = 500;
  const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
  const num = (value) => typeof value === 'number' && Number.isFinite(value);
  const regionAt = (x, y) => {
    let regions;
    try {
      regions = window.__baocutPickRegions;
    } catch (error) {
      return null;
    }
    if (!Array.isArray(regions)) return null;
    const stop = Math.max(0, regions.length - REGIONS_MAX);
    for (let i = regions.length - 1; i >= stop; i -= 1) {
      const region = regions[i];
      if (!region || typeof region !== 'object') continue;
      const rx = region.x, ry = region.y, rw = region.w, rh = region.h;
      if (!num(rx) || !num(ry) || !num(rw) || !num(rh) || !(rw > 0) || !(rh > 0)) continue;
      if (x < rx || y < ry || x > rx + rw || y > ry + rh) continue;
      const id = typeof region.id === 'string' && ID_PATTERN.test(region.id) ? region.id : '';
      const rect = { x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh) };
      const out = { selector: id ? 'region#' + id : 'region', w: rect.w, h: rect.h, focusable: false, rect };
      let name = clean(typeof region.name === 'string' ? region.name : '');
      if (name.length > NAME_MAX) name = name.slice(0, NAME_MAX - 1) + '\u2026';
      if (name) out.name = name;
      const role = clean(typeof region.role === 'string' ? region.role : '').split(' ')[0];
      if (role) out.role = role;
      return out;
    }
    return null;
  };
  window.__baocutDescribe = describe;
  window.__baocutPick = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return regionAt(x, y) || describe(document.elementFromPoint(x, y));
  };
})();`;

/**
 * Web 截图模式的取图（lite-editor §4.1、§11 第 14 条；`@baocut/protocol` 的 `CompositionBridgeCapture`）：装
 * `window.__baocutCapture()`，把此刻画着的这一帧画成一张视口大小（合成的固有像素）的 PNG。父页面与 iframe 不同源，拷不到它的像素，
 * 只能由页面自己画：根元素（`html` / `body`）的底色铺满视口，再按文档顺序画纯色底的块与可见的 `<canvas>`（按外包盒放，乘一路累积的
 * 不透明度，按 `overflow` 裁切）。画不进来的可见内容——文字、替换元素（图片、SVG、视频、表单控件）、伪元素、背景图、边框、阴影、
 * 描边、圆角底色、旋转或斜切、滤镜、混合、裁切路径、遮罩，没有保留绘图缓冲的 WebGL 画布——一出现就整张回 `null`（按截不出处理，
 * 不交一张缺了东西的图）；节点多于 `NODES_MAX`、视口大于 `SIDE_MAX`、画布被污染时也是 `null`。文档顺序近似绘制顺序（不看 `z-index`）。
 */
export const COMPOSITION_CAPTURE_SCRIPT = String.raw`(() => {
  if (window.__baocutCapture) return;
  const NODES_MAX = 5000;
  const SIDE_MAX = 8192;
  const SKIP = { script: 1, style: 1, template: 1, noscript: 1, link: 1, meta: 1, title: 1, head: 1, base: 1 };
  const REPLACED = {
    img: 1, svg: 1, video: 1, picture: 1, iframe: 1, object: 1, embed: 1, input: 1, textarea: 1, select: 1, button: 1,
    math: 1, meter: 1, progress: 1, audio: 1, frame: 1, frameset: 1, marquee: 1,
  };
  const CLIPS = { hidden: 1, clip: 1, auto: 1, scroll: 1 };
  const unsupported = new Error('capture unsupported');
  const alphaOf = (color) => {
    const text = String(color || '').trim();
    if (!text || text === 'transparent') return 0;
    const m = /^rgba?\(([^)]*)\)$/.exec(text);
    if (!m) return 1;
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const a = parseFloat(parts[3]);
    return parts[3].indexOf('%') >= 0 ? a / 100 : a;
  };
  const px = (value) => parseFloat(value) || 0;
  const none = (value) => value === undefined || value === null || value === '' || value === 'none' || value === 'normal' || value === 'auto';
  const plainTransform = (value) => {
    if (none(value)) return true;
    const m = /^matrix\(([^)]*)\)$/.exec(String(value).trim());
    if (!m) return false;
    const v = m[1].split(',').map(Number);
    return v.length === 6 && v[1] === 0 && v[2] === 0 && v[0] > 0 && v[3] > 0;
  };
  const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
  const hasBorder = (cs) => SIDES.some((side) => {
    const style = cs['border' + side + 'Style'];
    return style !== 'none' && style !== 'hidden' && px(cs['border' + side + 'Width']) > 0 && alphaOf(cs['border' + side + 'Color']) > 0;
  });
  const rounded = (cs) => ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].some((k) => px(cs[k]) > 0);
  const hasPseudo = (el, which) => {
    const content = getComputedStyle(el, which).content;
    return !none(content) && content !== '""' && content !== "''";
  };
  const intersect = (a, b) => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
  };
  const canvasReadable = (el) => {
    let ctx = null;
    try {
      ctx = el.getContext('2d');
    } catch (error) {
      return false;
    }
    if (ctx) return true;
    let gl = null;
    try {
      gl = el.getContext('webgl2') || el.getContext('webgl');
    } catch (error) {
      return false;
    }
    if (!gl) return false;
    const attrs = gl.getContextAttributes ? gl.getContextAttributes() : null;
    return !!(attrs && attrs.preserveDrawingBuffer);
  };

  const collect = (width, height) => {
    const ops = [];
    let nodes = 0;
    const root = document.documentElement;
    const body = document.body;
    const view = { x: 0, y: 0, w: width, h: height };
    const rootBg = root ? getComputedStyle(root).backgroundColor : '';
    const bodyBg = body ? getComputedStyle(body).backgroundColor : '';
    // 画布底色：html 的底色铺满视口；html 没有底色时 body 的底色传到视口上（CSS 背景的传播）。
    if (alphaOf(rootBg) > 0) ops.push({ kind: 'fill', color: rootBg, alpha: 1, rect: view, clip: view });
    else if (alphaOf(bodyBg) > 0) ops.push({ kind: 'fill', color: bodyBg, alpha: 1, rect: view, clip: view });
    const visit = (el, alpha, clip) => {
      nodes += 1;
      if (nodes > NODES_MAX) throw unsupported;
      const tag = String(el.tagName || '').toLowerCase();
      if (SKIP[tag]) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const own = cs.opacity === '' ? 1 : parseFloat(cs.opacity);
      const opacity = alpha * (Number.isFinite(own) ? own : 1);
      if (!(opacity > 0)) return;
      if (!none(cs.filter) || !none(cs.mixBlendMode) || !none(cs.backdropFilter) || !none(cs.clipPath) || !none(cs.maskImage || cs.webkitMaskImage))
        throw unsupported;
      if (!plainTransform(cs.transform) || !none(cs.rotate) || String(cs.scale || '').indexOf('-') >= 0) throw unsupported;
      const box = el.getBoundingClientRect();
      const rect = { x: box.left, y: box.top, w: box.width, h: box.height };
      const area = rect.w > 0 && rect.h > 0;
      const shown = cs.visibility !== 'hidden' && cs.visibility !== 'collapse';
      if (shown && area) {
        if (REPLACED[tag]) throw unsupported;
        if (!none(cs.backgroundImage) || !none(cs.boxShadow) || hasBorder(cs)) throw unsupported;
        if (cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0) throw unsupported;
        if (hasPseudo(el, '::before') || hasPseudo(el, '::after')) throw unsupported;
        const fill = el === root || el === body ? '' : cs.backgroundColor;
        if (alphaOf(fill) > 0) {
          if (rounded(cs)) throw unsupported;
          ops.push({ kind: 'fill', color: fill, alpha: opacity, rect, clip });
        }
        // body 在 html 有底色时只画自己的盒（不传播到视口）。
        if (el === body && alphaOf(rootBg) > 0 && alphaOf(bodyBg) > 0) {
          if (rounded(cs)) throw unsupported;
          ops.push({ kind: 'fill', color: bodyBg, alpha: opacity, rect, clip });
        }
      }
      if (tag === 'canvas') {
        if (!shown || !area || !(el.width > 0) || !(el.height > 0)) return;
        if (px(cs.paddingTop) || px(cs.paddingRight) || px(cs.paddingBottom) || px(cs.paddingLeft)) throw unsupported;
        if (cs.objectFit && cs.objectFit !== 'fill') throw unsupported;
        if (!canvasReadable(el)) throw unsupported;
        ops.push({ kind: 'canvas', el, alpha: opacity, rect, clip });
        return;
      }
      const clips = CLIPS[cs.overflowX] || CLIPS[cs.overflowY];
      const inner = clips && el !== root && el !== body ? intersect(clip, rect) : clip;
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) visit(child, opacity, inner);
        else if (child.nodeType === 3 && shown && /\S/.test(child.nodeValue || '')) throw unsupported;
      }
    };
    if (root) visit(root, 1, view);
    return ops;
  };

  window.__baocutCapture = async () => {
    const width = Math.round(window.innerWidth);
    const height = Math.round(window.innerHeight);
    if (!(width > 0) || !(height > 0) || width > SIDE_MAX || height > SIDE_MAX) return null;
    let ops;
    try {
      ops = collect(width, height);
    } catch (error) {
      return null;
    }
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    try {
      for (const op of ops) {
        const c = op.clip;
        if (!(c.w > 0) || !(c.h > 0)) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(c.x, c.y, c.w, c.h);
        ctx.clip();
        ctx.globalAlpha = op.alpha;
        if (op.kind === 'fill') {
          ctx.fillStyle = op.color;
          ctx.fillRect(op.rect.x, op.rect.y, op.rect.w, op.rect.h);
        } else ctx.drawImage(op.el, op.rect.x, op.rect.y, op.rect.w, op.rect.h);
        ctx.restore();
      }
      const image = await new Promise((resolve, reject) => {
        try {
          out.toBlob(resolve, 'image/png');
        } catch (error) {
          reject(error);
        }
      });
      return image ? { width, height, image } : null;
    } catch (error) {
      return null;
    }
  };
})();`;

export const COMPOSITION_BRIDGE_SCRIPT = String.raw`(() => {
  if (window.__baocutBridge) return;
  const CHANNEL = ${JSON.stringify(COMPOSITION_BRIDGE_CHANNEL)};
  const parent = window.parent;
  if (!parent || parent === window) return;
  const reply = (id, result) => parent.postMessage({ channel: CHANNEL, kind: 'result', id, result }, '*');
  // 清单里没有 compositionId：按根元素的 data-composition-id，没有就是 main（与导入时的 readRootAttributes 同一规则）。
  const rootCompositionId = () => {
    const root = document.querySelector('[data-composition-id]');
    return (root && root.getAttribute('data-composition-id')) || 'main';
  };
  const handle = async (message) => {
    if (message.kind === 'pick') return { ok: true, value: window.__baocutPick ? window.__baocutPick(message.x, message.y) : null };
    if (message.kind === 'capture') return { ok: true, value: window.__baocutCapture ? await window.__baocutCapture() : null };
    const adapter = window.__baocutAdapter;
    if (!adapter) return { ok: false, code: 'COMPOSITION_SCRIPT_ERROR', message: 'The composition adapter is not installed' };
    if (message.kind === 'ready') return adapter.ready(message.contract, message.compositionId || rootCompositionId(), message.timeoutMs, message.context);
    // 实时层播放时每个视频帧都 seek：不空帧（'live'），否则页面每帧之间整页透明，播放时闪。
    if (message.kind === 'seek') return adapter.seek(message.seconds, 'live');
    if (message.kind === 'dispose') return adapter.dispose();
    return { ok: false, code: 'COMPOSITION_SCRIPT_ERROR', message: 'Unknown bridge request ' + String(message.kind) };
  };
  window.addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || message.channel !== CHANNEL || typeof message.id !== 'number') return;
    handle(message).then(
      (result) => reply(message.id, result),
      (error) => reply(message.id, { ok: false, code: 'COMPOSITION_SCRIPT_ERROR', message: String((error && error.message) || error) }),
    );
  });
  window.__baocutBridge = true;
  parent.postMessage({ channel: CHANNEL, kind: 'hello' }, '*');
})();`;
// i18n-ignore-end

/** 注进入口页面的整段 `<script>`：取帧脚本、拾取、取图、桥依次。`</script>` 不会出现在这几段脚本里（没有字面量含它）。 */
export function compositionPageScript(): string {
  return `<script>${COMPOSITION_ADAPTER_SCRIPT}\n${COMPOSITION_PICK_SCRIPT}\n${COMPOSITION_CAPTURE_SCRIPT}\n${COMPOSITION_BRIDGE_SCRIPT}</script>`;
}

/**
 * 把脚本注进入口页面：放在 `<head>` 开头（没有 `<head>` 时放在 `<html>` 之后，再没有就放在最前面），先于包自己的脚本跑。
 * 只改这一处，页面其余原样。
 */
export function injectCompositionPageScript(html: string, script = compositionPageScript()): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + script + html.slice(head.index + head[0].length);
  const root = /<html(?:\s[^>]*)?>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + script + html.slice(root.index + root[0].length);
  return script + html;
}
