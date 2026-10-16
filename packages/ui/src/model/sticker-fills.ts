/**
 * 素材贴纸的色卡（视频格式规范 §3 贴纸的 `fillOverrides`）：把 SVG 或 Lottie 素材拉下来，读出能整体换掉的那几种颜色。
 * 与渲染侧的 `crates/timeline` 的 `svg_fill::fills_of`、`lottie_fill::fills_of` 同一套判据（原型 `model-svgfill.js`、
 * `model-lottiefill.js`），换色表都按源 hex 键，所以属性页这里列出的颜色就是渲染换得动的颜色。
 */

/** SVG：只有这八个标签的填充色进色卡。 */
const TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'stop']);
/** SVG 默认最多几张卡。 */
export const SVG_MAX_SWATCHES = 5;
/** SVG 里超过这么多种不同色就一张卡都不给（那是插画，逐色改没有意义）。 */
export const SVG_MAX_COLORS = 15;
/** Lottie 默认最多几张卡（Noto 那批素材的实际色数上界）。 */
export const LOTTIE_MAX_SWATCHES = 8;

const HEX8 = /#[0-9A-Fa-f]{8}/;
const HEX6 = /#[0-9A-Fa-f]{6}/;
const HEX3 = /#[0-9A-Fa-f]{3}/;
/** `style` 里的 fill 声明；`fill-opacity` / `fill-rule` 不会命中（它们后面不是冒号）。 */
const STYLE_FILL = /(^|;)([ \t]*)fill[ \t]*:[ \t]*([^;]*)/i;
/** 一个开始标签（属性值里的 `>` 由前两支吃掉，不会把标签切断）。 */
const TAG_RE = /<([A-Za-z][A-Za-z0-9:_.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/g;
const ATTR_RE = /([A-Za-z_:][A-Za-z0-9:._-]*)[ \t\r\n]*=[ \t\r\n]*("([^"]*)"|'([^']*)')/g;

/** 补齐三位简写并统一大写：`#fff` 与 `#FFFFFF` 是同一组。 */
export function normHex(hex: string): string {
  const upper = hex.toUpperCase();
  return upper.length === 4 ? `#${upper[1]}${upper[1]}${upper[2]}${upper[2]}${upper[3]}${upper[3]}` : upper;
}

/** 一个色值串里的 hex：8 位 → 6 位 → 3 位依次试；`none`、`currentColor`、`url(#…)` 读不出色。 */
function hexIn(value: string): string | null {
  const text = value.replace(/url\([^)]*\)/g, ' ');
  return (text.match(HEX8) ?? text.match(HEX6) ?? text.match(HEX3))?.[0] ?? null;
}

/** 一个节点的默认色：`fill` 属性 → `style` 里的 fill → `stop-color`，取第一个读得出来的。 */
function nodeColor(attrs: Map<string, string>): string | null {
  const fill = attrs.get('fill');
  const fromFill = fill === undefined ? null : hexIn(fill);
  if (fromFill) return fromFill;
  const style = attrs.get('style');
  const declared = style === undefined ? null : style.match(STYLE_FILL);
  const fromStyle = declared ? hexIn(declared[3]!) : null;
  if (fromStyle) return fromStyle;
  const stop = attrs.get('stop-color');
  return stop === undefined ? null : hexIn(stop);
}

/** SVG 的色卡：同色的节点归一组，组按第一次出现的次序；含 `<image>`（位图套壳）或超过 15 种色时没有，否则前 5 组。 */
export function svgFillColors(svg: string): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  TAG_RE.lastIndex = 0;
  for (let tag = TAG_RE.exec(svg); tag; tag = TAG_RE.exec(svg)) {
    const name = tag[1]!.toLowerCase();
    if (name === 'image') return [];
    if (!TAGS.has(name)) continue;
    const attrs = new Map<string, string>();
    ATTR_RE.lastIndex = 0;
    for (let attr = ATTR_RE.exec(tag[2]!); attr; attr = ATTR_RE.exec(tag[2]!)) attrs.set(attr[1]!.toLowerCase(), attr[3] ?? attr[4] ?? '');
    const color = nodeColor(attrs);
    if (!color) continue;
    const hex = normHex(color);
    if (!seen.has(hex)) {
      seen.add(hex);
      order.push(hex);
    }
  }
  return order.length > SVG_MAX_COLORS ? [] : order.slice(0, SVG_MAX_SWATCHES);
}

/** Lottie 的 `[r, g, b]`（0–1，偶尔 0–255，任意一维大于 1 就整体按 0–255 读）→ `#RRGGBB`。 */
function rgbHex(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const raw = value.slice(0, 3);
  if (!raw.every((c): c is number => typeof c === 'number' && Number.isFinite(c))) return null;
  const scaled = raw.some((c) => c > 1) ? raw.map((c) => c / 255) : raw;
  return `#${scaled
    .map((c) =>
      Math.round(Math.min(Math.max(c, 0), 1) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

/** 纯色图层的 `sc`：只认 `#RGB` / `#RRGGBB`。 */
function solidHex(value: string): string | null {
  const text = value.trim();
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(text) ? normHex(text) : null;
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);

/** 形状树里的静态色（`fl` 填充、`st` 描边，`c.a` 为真的带关键帧，跳过），`gr` 递归进 `it`。 */
function visitShapes(items: unknown, out: string[]): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isObj(item)) continue;
    if (item.ty === 'fl' || item.ty === 'st') {
      const color = item.c;
      if (!isObj(color) || color.a) continue;
      const hex = rgbHex(color.k);
      if (hex) out.push(hex);
    } else if (item.ty === 'gr') visitShapes(item.it, out);
  }
}

/** Lottie 的色卡：根图层在前、预合成依次在后，静态色按出现次数降序（次数相同按第一次出现），最多 8 组。解不开时没有。 */
export function lottieFillColors(json: string): string[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return [];
  }
  if (!isObj(doc)) return [];
  const order: string[] = [];
  const lists = [doc.layers, ...(Array.isArray(doc.assets) ? doc.assets.map((asset) => (isObj(asset) ? asset.layers : undefined)) : [])];
  for (const layers of lists) {
    if (!Array.isArray(layers)) continue;
    for (const layer of layers) {
      if (!isObj(layer)) continue;
      if (layer.ty === 1 && typeof layer.sc === 'string') {
        const hex = solidHex(layer.sc);
        if (hex) order.push(hex);
      }
      visitShapes(layer.shapes, order);
    }
  }
  const count = new Map<string, number>();
  for (const hex of order) count.set(hex, (count.get(hex) ?? 0) + 1);
  // Map 的键按第一次放进去的次序；sort 是稳定的，次数相同就保持这个次序。
  return [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!).slice(0, LOTTIE_MAX_SWATCHES);
}

/** 按素材的媒体类型取色卡；位图、视频与认不出的素材没有。 */
export function stickerFillColors(mediaType: string, text: string): string[] {
  if (mediaType === 'image/svg+xml') return svgFillColors(text);
  if (mediaType === 'application/json' || mediaType === 'application/lottie+json') return lottieFillColors(text);
  return [];
}
