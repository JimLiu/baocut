/* model-sticker-source.js —— 贴纸素材「源类型」的纯模型（第 238 轮）。

   第 237 轮之前，动态贴纸是 56 张带 `<animate>` 的 SVG，视图层只要判断
   「有没有 SMIL」就够了。本轮五个内置动态分类换成了 Google Noto Animated
   Emoji 的 **Lottie JSON**（CC BY 4.0，81 份），加上品牌库允许用户上传 GIF /
   SVG 动画 / 静态图，一张贴纸的源从此有四种：

   | kind     | 判据            | 播放方式                          |
   | -------- | --------------- | --------------------------------- |
   | `lottie` | `.json`         | lottie-web 的 SVG renderer        |
   | `gif`    | `.gif`          | `<img>`，由浏览器自己放           |
   | `svg`    | `.svg`          | 有 SMIL 走 IntrinsicSticker，否则静态 |
   | `image`  | 其余（png/webp/jpg…） | `<img>`                     |
   | `pet`    | 显式 `{kind:'pet'}`  | Codex Pet 雪碧图，CSS 背景逐格步进（第 242 轮） |

   `pet` 没有扩展名判据：它的源是一张 `.webp` 雪碧图（随包的、`blob:` 的或
   raw.githubusercontent 的），光看 URL 与普通位图无异，所以**必须**由调用方显式
   带 `kind:'pet'`（样式袋里的 `assetKind`、品牌收件记录的 `kind` 都会带）。
   分类只看扩展名（`blob:` / `data:` 这种拿不到扩展名的源允许调用方显式带上
   `kind`），所以它是纯字符串函数，放在这一层由 `node --test` 盯着；视图层
   （`panel-elements-tile.jsx`、`stage-elements.jsx`）只调用，不再各自写正则。

   另外收了两件 Lottie 元数据的活：`posterFrame()` 找 `markers[]` 里名为
   `rest` 的静止帧（Noto 用它当封面姿势，缺了就退回第 0 帧），`seconds()`
   把 `ip`/`op`/`fr` 换算成秒。 */
(function () {
  const KINDS = ['lottie', 'gif', 'svg', 'image', 'pet'];
  /** 扩展名 → kind。没列进来的一律 `image`。 */
  const BY_EXT = {json: 'lottie', gif: 'gif', svg: 'svg'};

  /** 去掉 `?v=…` / `#…`，取小写扩展名；取不到时返回 `''`。 */
  function ext(src) {
    if (typeof src !== 'string') return '';
    const clean = src.split('?')[0].split('#')[0];
    const slash = clean.lastIndexOf('/');
    const name = slash < 0 ? clean : clean.slice(slash + 1);
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return '';
    return name.slice(dot + 1).toLowerCase();
  }

  /** 源类型。`src` 可以是字符串，也可以是 `{src, kind}`（kind 优先，用于 blob:）。 */
  function kindOf(src) {
    if (src && typeof src === 'object') {
      if (KINDS.indexOf(src.kind) >= 0) return src.kind;
      return kindOf(src.src);
    }
    return BY_EXT[ext(src)] || 'image';
  }

  /** 需要 lottie-web 才能放的源。 */
  function isLottie(src) { return kindOf(src) === 'lottie'; }

  /** Codex Pet 雪碧图（第 242 轮）：`BC_PET` 逐格步进，不走 `<img>`。 */
  function isPet(src) { return kindOf(src) === 'pet'; }

  /** 这张贴纸自己会动吗？（SVG 要看有没有 SMIL，所以要把源码给进来） */
  function isMoving(src, raw) {
    const k = kindOf(src);
    if (k === 'lottie' || k === 'gif' || k === 'pet') return true;
    if (k === 'svg') return typeof raw === 'string' && raw.indexOf('<animate') >= 0;
    return false;
  }

  /** 归「动态贴纸」子页吗？——贴纸与动态贴纸两个子页的**互补**分页判据（第 240 轮）。

     只看 kind：`lottie` / `gif` / `pet` 归动态，`svg` 与位图归贴纸。这一格里没有 `raw`
     是有意的：SMIL 要读源码才知道，而三个表面（原型、App v2、Web）在建格子那
     一刻手上都只有一条路径（App 的渲染层还被门禁禁止读盘），所以带 `<animate>`
     的 SVG 也只出现在静态那一页。取名不叫 `isMoving` 就是为了不和「这张贴纸自
     己会动吗」混成一件事——那是播放判据，这是分页判据。 */
  function isDynamicPage(src) {
    const k = kindOf(src);
    return k === 'lottie' || k === 'gif' || k === 'pet';
  }

  /** 分色编辑（`BC_SVGFILL`）只能改 SVG 源码；Lottie 走 lottie-web 的图层改色。 */
  function fillMode(src) {
    const k = kindOf(src);
    if (k === 'svg') return 'svg';
    if (k === 'lottie') return 'lottie';
    return 'none';
  }

  /** kind 的中文名，给品牌库的行标签用。 */
  const KIND_LABEL = {lottie: 'Lottie', gif: 'GIF', svg: 'SVG 动画', image: '图片', pet: 'Codex Pet'};
  function label(src) { return KIND_LABEL[kindOf(src)] || KIND_LABEL.image; }

  /* ---------- Lottie 元数据 ---------- */

  /** `markers[]` 里名为 `rest` 的静止帧（大小写不敏感）；没有就是第 0 帧。 */
  function posterFrame(data) {
    if (!data || !Array.isArray(data.markers)) return 0;
    for (const m of data.markers) {
      const nm = m && (m.cm || m.nm);
      if (typeof nm === 'string' && nm.trim().toLowerCase() === 'rest') {
        return Number(m.tm) || 0;
      }
    }
    return 0;
  }

  /** 时长（秒）。`fr` 缺省按 60 算，和 Noto 的导出一致。 */
  function seconds(data) {
    if (!data) return 0;
    const fr = Number(data.fr) || 60;
    const ip = Number(data.ip) || 0;
    const op = Number(data.op) || 0;
    return op > ip ? (op - ip) / fr : 0;
  }

  Object.assign(window, {BC_STSRC: {
    KINDS, BY_EXT, KIND_LABEL,
    ext, kindOf, isLottie, isPet, isMoving, isDynamicPage, fillMode, label, posterFrame, seconds,
  }});
})();
