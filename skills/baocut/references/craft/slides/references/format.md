<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/slides/references/format.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 幻灯片的格式

这一页是页面文件的完整写法：哪些标签、属性与样式能用，各有什么上限。不在这里的写法，编辑器读入时会丢掉或报错，校验会逐条列出；报错的那一页在编辑器里只能看、不能改。

## 1. 页面文件

- `slides/<id>.html` 里恰好一个 `<section>`，前后没有别的内容：不写 `<!doctype>`、`<html>`、`<head>`、`<body>`，也不写 `<title>`、`<link>`、`<style>`、`<meta>`、`<script>`。
- 画布固定 1920×1080 像素，坐标与尺寸都按它算。
- `<section>` 上能写的属性：
  - `id`：与文件名相同（字母、数字、`-`、`_`，最长 64 个字符）。
  - `style`：只管四类——背景（`background`，纯色或 `linear-gradient(…)`）；全页文字的默认值（`font-family`、`font-size`、`font-weight`、`font-style`、`line-height`、`letter-spacing`、`text-align`、`text-transform`、`white-space`、`color`）；版式（`display:flex` 或 `display:grid`，以及 `flex-direction`、`gap`、`align-items`、`justify-content`、`grid-template-columns`）；`padding`。边框、圆角、阴影、透明度、变形、宽高与定位都不能写在 `<section>` 上。
  - `data-transition`：进入这一页时的换页效果，`fade`、`push` 或 `magic`。
  - `hidden`：放映时跳过这一页。
- 其余属性会被丢掉。分节写在 `deck.json` 的 `sections` 里，不写在页面上。

## 2. 流式与钉住

- 没写 `position:absolute` 的子元素是**流式**的：按 `<section>` 的版式与留白依次排开，自己不用算坐标。
- 写了 `position:absolute` 的是**钉住**的：用 `left`、`top`、`right`、`bottom`、`width`、`height` 按画布坐标摆放。坐标不能是负数；同一方向写了两条边（如 `left` 与 `right`）就不要再写这个方向的尺寸。
- 叠放次序就是源码顺序，后写的盖住先写的，没有 `z-index`。整页的背景图写成第一个子元素。
- `position:relative` 的 `<div>` 里，钉住的子元素按这个 `<div>` 定位。
- `id`、`data-build-in`、`data-build-out` 只对直接钉在 `<section>` 下的元素有效，写在流式元素上会被丢掉。

```html
<section id="quote" data-transition="fade" style="background:#1c1d21;color:#f4f1ea;font-family:'Source Sans 3', Arial, sans-serif;padding:128px;display:flex;flex-direction:column;justify-content:center">
  <p style="font-size:64px;font-weight:600;line-height:1.2">剪辑的一半时间花在找素材上。</p>
  <p id="source" data-build-in="fade 1" style="position:absolute;left:128px;bottom:96px;width:900px;font-size:28px;color:#a8a39a">— 来自 30 位剪辑师的访谈</p>
</section>
```

## 3. 标签

| 标签 | 用途与规则 |
| --- | --- |
| `<h1>` `<h2>` `<h3>` | 标题。没有 `<h4>`–`<h6>`，更小的标题用加粗的 `<p>`。 |
| `<p>` | 段落。 |
| `<ul>` `<ol>` `<li>` | 列表，只有一层（嵌套的会被摊平）。`<li>` 里只放文字与行内标签；样式写在 `<ul>`、`<ol>` 上，`<li>` 上的 `style` 会被丢掉；项目符号的缩进用 `padding-left`。 |
| `<b>` `<i>` `<u>` `<a href>` `<span style>` `<br>` | 行内：加粗、斜体、下划线、链接、局部样式、换行。 |
| `<div>` | 容器，用 flex 或 grid 排子元素，最多嵌套 15 层。没有内容、没有底色的空 `<div>` 会被去掉；要当弹簧就写 `flex:1`。 |
| `<img>` | 图片，见第 5 节。 |
| `<svg>` | 内联矢量图，见第 5 节。 |
| `<table>` `<tr>` `<th>` `<td>` | 表格，见第 6 节。 |
| `<hr>` | 一条线：`border-top:2px solid #…`，或用 `background` 加 `height`（1–32px）当线宽；不支持虚线。 |
| `<x-shape kind="…">` | 形状，见第 7 节。 |
| `<x-icon name="…">` | 内置图标，见第 7 节。 |
| `<x-connector>` | 连线与箭头，见第 7 节。 |
| `<aside>` | 讲稿：`<section>` 的直接子元素，纯文字（上面的 `style` 无效），最多 4000 字，习惯写在最后。 |

- 其余标签（`<h4>`–`<h6>`、`<blockquote>`、`<figure>`、`<pre>`、`<header>`、`<footer>`、`<nav>`、`<main>`、`<article>` 等）都是错误。格式里另有 `<video>` 与 `<x-embed>`，在 BaoCut 里不用。
- 元素上的 `class`、`title`、`role`、`aria-*`、`lang` 以及上面没提到的 `data-*` 都会被丢掉。

## 4. 样式

- 只写在 `style` 属性里，每个文字元素自己写 `font-size`（8–400px）。
- 长度用 px。`%` 只在钉住的元素、单元格宽度与 flex 方向上的份额里有意义；不用 `em`、`rem`、`vw`、`calc()`、`var()`。
- 颜色写十六进制、`rgb()`、`rgba()`、`hsl()` 或颜色名都行；整份统一写十六进制最好管理。
- 间距用父元素的 `gap` 与 `padding`，不用 `margin`（`margin:0` 除外）；要把一块推到底部，用 `justify-content` 或一个 `flex:1` 的空 `<div>`。
- 可用的装饰：`border`（包括单边，如 `border-left`）、`border-radius`、`box-shadow`、`opacity`、`text-shadow`、`linear-gradient(…)` 底色、钉住元素的 `transform:rotate(…)`。
- 文字：`font-family`、`font-size`、`font-weight`、`font-style`、`line-height`（倍数或 px）、`letter-spacing`、`text-align`、`text-transform`、`text-decoration`、`white-space`、`color`。
- 不支持：`float`、`z-index`、`object-position`、`background-image:url(…)`（背景图用钉满全页的 `<img>`）、`border-collapse`。
- `<h1>`–`<h3>`、`<p>`、`<ul>`、`<ol>`、`<table>` 上可以写 `data-fit`：不写就是 `shrink`，放不下时把字缩小，最多缩到六成；`none` 是不缩，放不下就溢出。

## 5. 图片与矢量图

- `<img src>` 只认两种地址：导入 deck 后得到的 `/_blob/<id>`；或 70 KB 以内的 png、jpeg、gif、webp、avif、svg `data:` 地址（只适合很小的标志，SVG 里的 `#` 写成 `%23`）。网上的地址、相对路径、绝对路径都是错误。
- 写 `alt`（最多 500 字），宽高用 px。
- 图还没有时可以只写 `alt` 与宽高、不写 `src`，当占位图框：它保住位置，用户在编辑器里选中它就能补上图（见 [幻灯片的图片与插图](images.md)「占位图框」）。
- `object-fit:cover`（默认，裁掉多出的部分铺满框）或 `contain`（完整显示）。cover 的图可以用 `data-crop="倍数 X% Y%"` 放大并选焦点，倍数 1–50，例如 `data-crop="1.5 50% 30%"`。
- `<svg>` 直接写在页面里：恰好一个 `<svg>` 根元素，源码不超过约 70 KB；写 `width` 与 `height`（只写 `viewBox` 时按 400px 宽算）；不能有 `<script>`、`<foreignObject>`、`onclick` 这类事件属性、指向外部的 `href` 或 `url(…)`。`aria-label` 当替代文字。SVG 整体当作一张图，里面的 `<text>` 在编辑器里改不了字，也不用 deck 的字体，文字放在 SVG 外面。SVG 里的特殊字符直接写，或写成数字形式（`&#8212;`）与 `&amp;`、`&lt;`、`&gt;`、`&quot;`，不写 `&nbsp;` 这类 HTML 实体。

```html
<img src="/_blob/0f3a…" alt="新版时间线截图" style="position:absolute;left:0;top:0;width:1920px;height:1080px;object-fit:cover" data-crop="1.2 50% 40%">
```

## 6. 表格

- `<table>` 里直接写 `<tr>`（套 `<thead>`、`<tbody>` 也可以），每行的单元格一样多；不支持 `colspan`、`rowspan`，要合并就拆表或重复文字。
- 单元格里只放文字与行内标签，不放图片（会被删掉）。
- 字号、颜色、宽度写在 `<table>` 上；`<th>`、`<td>` 上只认 `text-align`、`width`、`color`、`padding`，`<th>` 另可写 `font-weight`。单元格不能有底色和边框，表格自己画细线；要强调一格就换颜色或加粗。
- 一页最多 4000 个单元格，整份 40000 个；数据多时拆页，或只留结论。

```html
<table style="font-size:28px;color:#22252b;width:1200px">
  <tr><th style="text-align:left">渠道</th><th style="text-align:right">新用户</th><th style="text-align:right">环比</th></tr>
  <tr><td>搜索</td><td style="text-align:right">12,400</td><td style="text-align:right;color:#15803d">+38%</td></tr>
  <tr><td>社交</td><td style="text-align:right">8,900</td><td style="text-align:right;color:#b91c1c">−6%</td></tr>
</table>
```

## 7. 形状、图标与连线

- `<x-shape kind="…">`：`rect`、`rounded`（圆角矩形）、`ellipse`、`diamond`、`arrow-right`、`arrow-left`、`arrow-up`、`arrow-down`、`line`。里面不放内容；`background` 是填充（只能纯色），`border` 是描边；钉住时写全 `width` 与 `height`；`transform` 只认 `rotate(…)`。要在形状上写字，另放一个钉在同一位置的 `<p>`。
- `<x-icon name="…">`：内置图标，名字不分大小写——Activity、Book、Chart、Chat、Check、CheckCircle、Clock、Cloud、Code、Database、Globe、GraduationCap、Home、Key、Lightbulb、Lightning、Link、Lock、PaperPlane、Play、Search、Settings、Star、ThumbsUp、Tool、Trust、Users、Verified、Warning、Wrench。`width`、`height` 用 px（只写一个就是正方形），`color` 上色。名字不在表里的会显示成一段文字。字体里没有的符号（✓ ✗ ★ ☐ 这类）会换成系统字体显示：打勾用 `<x-icon name="Check">`，表示「没有」写字或一个 −。
- `<x-connector>`：直线、折线与箭头。钉在画布上时写全 `x1`、`y1`、`x2`、`y2`（px 数字；在 `position:relative` 的 `<div>` 里也可以写百分比）。
  - `head`：`end`（终点有箭头，默认）、`both`、`none`；也可以分别写 `head-start`、`head-end`：`none`、`open`、`filled`。
  - `route`：`straight`、`elbow`、`hv`（先横后竖）、`vh`（先竖后横）。
  - 线的粗细、虚实与颜色用 `border`（`solid`、`dashed`、`dotted`）。

```html
<x-shape kind="rounded" style="position:absolute;left:160px;top:420px;width:360px;height:160px;background:#ffffff;border:2px solid #22252b"></x-shape>
<p style="position:absolute;left:160px;top:470px;width:360px;font-size:32px;text-align:center">导入素材</p>
<x-connector x1="540" y1="500" x2="760" y2="500" head="end" style="border:3px solid #c2410c"></x-connector>
<x-icon name="lightbulb" style="position:absolute;left:800px;top:452px;width:96px;color:#c2410c"></x-icon>
```

## 8. 动效

- 换页：`<section data-transition="fade">`，见第 1 节。
- 元素逐个出现：钉住的元素上写 `data-build-in="效果 次序"`，离开用 `data-build-out`。效果有 `fade`、`rise`、`drop`、`left`、`right`、`scale`、`pop`；次序是 1–50 的整数，不写就按源码顺序；末尾加 `auto` 的一步不等点击，紧接着上一步出现。

## 9. 字体

- 页面里用到的网络字体与字体文件，都要在 `deck.json` 的 `faces` 里登记：键是自己起的短名，值是 `{ "family": "…", "href": "…" }` 或 `{ "family": "…", "src": "…" }`，`href` 与 `src` 只写一个。
- `family` 以英文字母开头，只含字母、数字、空格、`-`、`_`，最长 40 个字符，与 `font-family` 里写的完全一致。
- `href` 只能是 Google Fonts 的 css2 地址（`https://fonts.googleapis.com/css2?family=…`），最长 1024 个字符，用到的字重都写进去。
- `src` 是 deck 里的字体文件的地址，原样写；不写 `data:`、网上地址或相对路径。只有一个字重的静态字体文件，所有字重都显示成那一个：优先用可变字体文件，或只用最常用的那个字重。
- 字体文件（woff2、woff、ttf、otf）终端里没有把字体导入 deck 的命令：装进 deck 的设计系统的字体拷到 `ds/<folder>/fonts/<文件>`（路径只含字母、数字与 `._/-`），`src` 写 `project/ds/<folder>/fonts/<文件>`；其他字体改用 Google Fonts 或系统字体，交付时说明。
- 一份最多登记 4 个字体。系统字体（Arial、Georgia、Courier New、PingFang SC、Microsoft YaHei 这类）不用登记，写在字体栈后面当退路，最后以 `sans-serif` 或 `serif` 收尾。
- 中文可以用 `Noto Sans SC`、`Noto Serif SC`；日文、韩文各有对应的 Noto 字体。

## 10. 上限

- 一页最多 200 个元素（每个标签都算），超出的部分会被丢掉。
- 一个文字元素最多 20000 字、100 处行内样式。
- 整份最多 500 页。
