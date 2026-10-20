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
 * `pick` 不经取帧脚本：交给 `COMPOSITION_PICK_SCRIPT` 装的 `window.__baocutPick`，回那一点下最内层节点的说明（或 `null`）。
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
    const adapter = window.__baocutAdapter;
    if (!adapter) return { ok: false, code: 'COMPOSITION_SCRIPT_ERROR', message: 'The composition adapter is not installed' };
    if (message.kind === 'ready') return adapter.ready(message.contract, message.compositionId || rootCompositionId(), message.timeoutMs, message.context);
    if (message.kind === 'seek') return adapter.seek(message.seconds, true);
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

/** 注进入口页面的整段 `<script>`：取帧脚本、拾取、桥依次。`</script>` 不会出现在这几段脚本里（没有字面量含它）。 */
export function compositionPageScript(): string {
  return `<script>${COMPOSITION_ADAPTER_SCRIPT}\n${COMPOSITION_PICK_SCRIPT}\n${COMPOSITION_BRIDGE_SCRIPT}</script>`;
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
