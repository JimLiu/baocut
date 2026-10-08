// S2 样式的去重合并，开发时（`s2-styles-client.ts`，在浏览器里）与生产构建（`s2-styles.ts` 的构建插件，在 Node 里）共用。
//
// 输入是按先后排好的若干份 CSS（开发时一份宏调用、一个组件各一份；构建时是合成好的 s2-styles 一整份），输出一份层叠结果相同的 CSS：
// - 层的先后由每个层名第一次出现（声明语句或规则块）的位置决定：按出现的先后记下全部层名，在最前用一条 `@layer a, b, …;` 声明，
//   层的先后不变（点号连起来的名字依次声明各级，与嵌套写法等价）。
// - 不同层的规则之间、层里的与不在层里的规则之间，先后不影响层叠（先比层，层相同才比特异性与先后），所以规则可以按层归组。
// - 同一层（不在层里也算一组）里，一条规则出现多次时只留最后一次：几份相同的规则对任何元素给的声明都一样，比先后时以最后一份为准，
//   留下最后一份、其余规则保持原来的相对先后，任意两条规则之间谁在后都不变，层叠结果因此不变。
// 规则以原文为单位：@media、@supports、@keyframes、@font-face 等连同里面的内容整块算一条。
// 拆不准的写法（匿名层、@import、条件规则里套 @layer）不做：`parseLayeredCss` 返回 null，调用方原样保留那份 CSS。

/** 一条规则：所在的层（具名层的完整路径，不在层里为 null）与原文。 */
export interface CssItem {
  layer: string | null;
  text: string;
}

/** 拆开的一份 CSS：层名按第一次出现的先后，规则按原来的先后。 */
export interface LayeredCss {
  layers: string[];
  items: CssItem[];
}

/** 把一份 CSS 拆成层名与规则；遇到拆不准的写法返回 null。顶层的注释（包括 source map 注释）丢掉。 */
export function parseLayeredCss(css: string): LayeredCss | null {
  const parsed: LayeredCss = { layers: [], items: [] };
  return collect(css, 0, css.length, null, parsed) ? parsed : null;
}

/** 按顺序合并若干份拆开的 CSS，相同的规则只留最后一次；`separator` 是规则之间的分隔（构建时用空串保持压缩）。 */
export function mergeLayeredCss(sheets: Iterable<LayeredCss>, separator = '\n'): string {
  const order = new Set<string>();
  // 同一条规则再出现时挪到最后：Map 的先后就是每条规则最后一次出现的先后。
  const last = new Map<string, CssItem>();
  for (const sheet of sheets) {
    for (const name of sheet.layers) order.add(name);
    for (const item of sheet.items) {
      const key = `${item.layer ?? ''}\n${item.text}`;
      last.delete(key);
      last.set(key, item);
    }
  }
  const groups = new Map<string | null, string[]>();
  for (const { layer, text } of last.values()) {
    const group = groups.get(layer);
    if (group) group.push(text);
    else groups.set(layer, [text]);
  }
  const out: string[] = [];
  if (order.size > 0) out.push(`@layer ${[...order].join(',')};`);
  for (const name of order) {
    const group = groups.get(name);
    if (group) out.push(`@layer ${name}{${separator}${group.join(separator)}${separator}}`);
  }
  const unlayered = groups.get(null);
  if (unlayered) out.push(...unlayered);
  return out.join(separator);
}

function collect(css: string, start: number, end: number, layer: string | null, out: LayeredCss): boolean {
  const declare = (name: string) => {
    const full = layer ? `${layer}.${name}` : name;
    if (!out.layers.includes(full)) out.layers.push(full);
    return full;
  };
  let i = start;
  while (i < end) {
    i = skipSpaceAndComments(css, i, end);
    if (i >= end) break;
    // 这一条到哪里：顶层的 `;`（语句）或 `{`（块的开头，再找配对的 `}`）。
    const stop = scan(css, i, end, ';{');
    if (stop < 0) return false;
    const prelude = css.slice(i, stop).trim();
    const isBlock = css[stop] === '{';
    const close = isBlock ? scan(css, stop + 1, end, '}') : stop;
    if (close < 0) return false;
    const atLayer = /^@layer(?=[\s{;]|$)/i.test(prelude);
    if (atLayer) {
      const names = prelude
        .slice('@layer'.length)
        .split(',')
        .map((name) => name.trim());
      if (names.some((name) => !/^[\w-]+(\.[\w-]+)*$/.test(name))) return false; // 匿名层或写错的名字
      if (isBlock) {
        if (names.length !== 1) return false;
        if (!collect(css, stop + 1, close, declare(names[0]!), out)) return false;
      } else {
        for (const name of names) declare(name);
      }
    } else {
      if (/^@(import|charset|namespace)\b/i.test(prelude)) return false;
      const text = css.slice(i, close + 1).trim();
      // 条件规则里套的 @layer 也在声明层，整块搬动会改层的先后。
      if (/@layer\b/i.test(text)) return false;
      out.items.push({ layer, text });
    }
    i = close + 1;
  }
  return true;
}

/** 从 `i` 往后找第一个不在字符串、注释、括号或嵌套块里的 `chars` 中的字符；找不到返回 -1。 */
function scan(css: string, i: number, end: number, chars: string): number {
  let depth = 0;
  let parens = 0;
  while (i < end) {
    const c = css.charAt(i);
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(css, i, end);
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      if (close < 0 || close >= end) return -1;
      i = close + 2;
      continue;
    }
    if (depth === 0 && parens === 0 && chars.includes(c)) return i;
    if (c === '(') parens++;
    else if (c === ')') parens = Math.max(0, parens - 1);
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return -1;
}

function skipString(css: string, i: number, end: number): number {
  const quote = css[i];
  i++;
  while (i < end && css[i] !== quote) i += css[i] === '\\' ? 2 : 1;
  return i + 1;
}

function skipSpaceAndComments(css: string, i: number, end: number): number {
  while (i < end) {
    if (/\s/.test(css.charAt(i))) i++;
    else if (css[i] === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close < 0 ? end : close + 2;
    } else break;
  }
  return i;
}
