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
 *
 * 离屏宿主（`composition-host.ts`）仍直接 `executeJavaScript`，不经这座桥。
 */

// i18n-ignore-start: 注入页面的脚本源码，不是给人看的文字
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

/** 注进入口页面的整段 `<script>`：取帧脚本在前、桥在后。`</script>` 不会出现在两段脚本里（没有字面量含它）。 */
export function compositionPageScript(): string {
  return `<script>${COMPOSITION_ADAPTER_SCRIPT}\n${COMPOSITION_BRIDGE_SCRIPT}</script>`;
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
