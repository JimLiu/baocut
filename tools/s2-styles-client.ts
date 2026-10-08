// 开发时 S2 样式的合并去重（由 `s2-styles.ts` 的开发插件引入，生产构建不用）：
// 每份 CSS（style 宏的一处调用、S2 的一个组件）按载入的先后登记进来，按 `s2-styles-merge.ts` 合成一个 <style>，
// 相同的规则只留最后一次、层的先后不变——与 Vite 给每份各插一个 <style> 的层叠结果相同。拆不准的那份照旧单独插一个 <style>。

import { type LayeredCss, mergeLayeredCss, parseLayeredCss } from './s2-styles-merge.ts';

/** 已登记的 CSS，Map 的先后就是登记的先后（同一 id 再登记挪到最后，与文件改了之后新插的样式表一致）。 */
const sheets = new Map<string, LayeredCss>();
/** 拆不准、单独插的 <style>。 */
const loose = new Map<string, HTMLStyleElement>();
let element: HTMLStyleElement | null = null;
let scheduled = false;

/** 登记一份 CSS；同一 id 再次登记（文件改了）时换掉旧的。 */
export function addStyle(id: string, css: string): void {
  removeStyle(id);
  const parsed = parseLayeredCss(css);
  if (parsed) {
    sheets.set(id, parsed);
    schedule();
    return;
  }
  const style = document.createElement('style');
  style.setAttribute('data-vite-dev-id', id);
  style.textContent = css;
  document.head.appendChild(style);
  loose.set(id, style);
}

/** 注销一份 CSS（热更新后不再被引用）；没有别处用到的规则随之去掉。 */
export function removeStyle(id: string): void {
  loose.get(id)?.remove();
  loose.delete(id);
  if (sheets.delete(id)) schedule();
}

/** 同一轮里的登记与注销合在一起，在微任务里重写一次样式表。 */
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (!element) {
      element = document.createElement('style');
      element.setAttribute('data-vite-dev-id', 'baocut:s2-styles');
      document.head.appendChild(element);
    }
    element.textContent = mergeLayeredCss(sheets.values());
  });
}
