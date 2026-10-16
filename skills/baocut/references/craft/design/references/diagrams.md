<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/design/references/diagrams.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 图示：流程图、组织架构图、系统关系图、泳道图、时序图、时间线

**用分开的元素搭图示，绝不做成一个 `<svg>`。** 编辑器把一个 `<svg>` 当作一整块来选中和拖动，所以在画成一整个 svg 的流程图里，谁都没法单独移动某个框或改它的文字。你可能已经加载过的、把图示手绘成内联 `<svg>`（放在 `<figure>` 里）的指引，是给普通页面用的，不是给设计稿用的。在没人会移动或改文字的部件上，一个 `<svg>` 仍然是对的：图标、logo、插画、数据图表的绘图区（有人会改文字的标签和 callout 作为分开的元素叠在它上面）。页面里排成一行、只用 chevron 相连的步骤，仍然用 flex 行。

## 宿主容器

图示是 flex 或 grid 规则的唯一例外：箭头的数值取自它所连卡片的 px 位置，而 flex 子元素没有这种位置。所有东西都放在**一个**宿主容器里：一个带 `position: relative` 以及 px `width` 和 `height` 的 `<div>`，其中每个元素都用行内的 `position: absolute; left; top`（px）定位。图示占满整块画板时，宿主容器**就是**画板的根元素，标题也只是又一个被定位的元素（这样每张卡片和每个箭头都点一下就能选中）；每个元素都从根元素边缘往里缩 64px，因为 padding 不会移动被定位的元素。

每个元素都写成字面的 markup：由 `<sc-for>` 生成的卡片，或 `left`/`top` 是 `{{hole}}` 的卡片，没法单独拖动（点一下会选中所有副本）。文件顺序就是绘制顺序和点击顺序，两个框重叠时后写的那个接收点击：先写背景带，再写所有箭头，然后是卡片，最后是标签。

## 元素

- **卡片**：一个 `<div>`，带行内的 `width`、`height` 和 `box-sizing: border-box`（箭头公式要用外框尺寸），它的标签放在里面，只用文字和行内 tag（`<b>`、`<span>`、`<br>`），绝不放子 `<div>`：这样点一下就选中卡片，拖动时卡片和标签一起移动。卡片是 flex 盒子，所以含 tag 的标签要放进**一个** `<span>`，如示例所示；散放的话，各部分会并排摆放并丢掉空格。图标放在卡片里、那个 `<span>` 之前，卡片上设 `gap: 8px`（这样文字能单独选中；拖卡片时抓它的图标或 padding 处）。每种卡片按换行后最长的标签定一次尺寸（16px 字号下每个字符约 9px，大写字母 11px，每行 24px，再加 padding），取偶数；图示放不下就把画板加大，绝不把字缩小。判断菱形是一张宽和高都约为其标签两倍的卡片，用 `clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%)` 加填充色，不用边框（裁切会把边框切掉）；它的四个顶点就是卡片各边的中点。绝不用旋转的正方形。
- **箭头**：每一段**直**线一个小 `<svg>`，从示例照抄，每个 attribute 都抄。它就是编辑器的 Arrow 工具画出来的那种 svg：能单独选中和拖动，两端各有一个手柄。svg 覆盖从箭尾到**箭尖**的整段箭头；path 在离箭尖 2 个 `stroke-width` 处停住，位于箭头头部下方。颜色、粗细和虚线写在 svg 的 `style` 里（`stroke`、`stroke-width`、`stroke-dasharray: 6 6`）；头部自己沿用箭头的颜色和粗细，绝不是虚线（Safari 则按头部自己的 path 来画：给它的 `fill` attribute 和它 `style` 里的第一个 `fill` 写上箭头的颜色）。Properties 面板可能把用户的改动写成箭头 `<path>` 上的 `stroke` 和 `stroke-width` attribute：这些优先，所以要在那里改样式。改了粗细之后，移动 path 带实心头部的每一端，让它的箭尖保持不动。每个箭头带自己的 `<defs>`，其中 marker 的 `id` 是文件里别的 marker 都没有的（`dc-arrow-head-filled-1`、`-2`……，接着已有的编号往下数），并由它的 `marker-end` 指名：隐藏或删除一个箭头绝不会改变另一个的头部。用户可以把任意一端设为 none、open 或 filled：文件里已有的头部保持原样。一条普通线就是同样的 svg，只是不带 `<defs>` 和 `marker-end`。
- **折线箭头**：一串直线段，每段都正好从上一段结束的地方开始，只有最后一段带头部（一条含多个点的 path，或一条曲线，会被当作一个框来选中，缩放时会被拉伸）。
- **一对多**：从父节点引一条线到间隙中间，在那里画一条横跨的线，从第一个子节点的中心 x 到最后一个子节点的中心 x，然后从这条线分别引箭头进每个子节点（在组织架构图里用普通线，终点**落在**边上）。多对一是它的镜像。
- **箭头上的标签**（"yes"、"retry"）：单独一个小 `<div>`，`font-size: 13px; line-height: 16px`，与每条线和每张卡片都隔开 8px 或以上：在 y 处那条线的上方时，它的 `top` 是 y − 28，下方时是 y + 12；在 x 处那条竖线的旁边时，它的 `left` 是 x + 12，`top` 是线段中点 − 8。"yes" 或 "no" 放在线段靠它所属判断节点的那一端。它的框也会接收点击，所以宽度不要超过文字：`width` 刚好比文字宽一点（每个字符约 8px），`text-align: center`，`left` = 它所在间隙的中点减去宽度的一半。
- **泳道或其他背景带**：一个空的 `<div>`，最先写，它的名字是角上一个单独的标签，与每条线和每张卡片都隔开。生命线和时间线的轨道线都是普通线。

## 数值

写文件之前，先在 grid 上定好每张卡片的 `left`、`top`、`width` 和 `height`：同一行的卡片共用中心 y，同一列的卡片共用中心 x，间隙 48px 或以上（有线沿间隙走时 96 或以上；有标签放在间隙里时为标签宽度 + 16），全部用整数 px。箭头从一张卡片某条边的中点出发，箭尖停在离另一张卡片那条边中点 1px 的地方：右边的中点是 (`left + width`, `top + height/2`)，底边的中点是 (`left + width/2`, `top + height`)。摆放卡片时让每个箭头都有一条自己的边；两个必须共用一条边的箭头（相邻卡片之间一去一回）分别放在这条边的三分之一和三分之二处，两张卡片上取相同的 y（或 x）。回环如果没有间隙或空格子可穿过，就从外面绕：从一条空闲的边出来，沿着卡片外 48px 处的一条空白带走，进入前面那张卡片的一条空闲边。线段保持水平或竖直，走间隙或空格子，绝不横穿卡片。

每个 svg 的长度正好等于它那一段，从箭尾到箭尖，厚 8px，线在正中间。设 (x, y) 为线段的**左**端（竖直时为**上**端），不管它指向哪边；n 为它的长度；h 在线段以头部结尾时为 2 个 `stroke-width`（示例里是 4），不带头部时为 0：

- 水平：`left: x; top: y − 4`，`width="n" height="8"`，path 向右时为 `M 0 4 L n−h 4`，向左时为 `M n 4 L h 4`
- 竖直：`left: x − 4; top: y`，`width="8" height="n"`，path 向下时为 `M 4 0 L 4 n−h`，向上时为 `M 4 n L 4 h`

那 1px 从箭尖那一端扣掉，所以指向左或上的箭头，它的框从离被指向的卡片 1px 处开始。`width`/`height` attribute、`viewBox` 以及 style 里的 `width`/`height` 始终是同样的两个数。

**箭头不会跟着卡片走。** 移动卡片或改它的尺寸时，重新计算每一个连到它的箭头；用户手动改时也得这么做，所以拐弯要少。

## 示例：一块画板的根元素、两张卡片，以及在两卡相对边的三分点上一去一回的箭头

第一个箭头从 (264, 160) 到箭尖 (423, 160)，离第二张卡片差 1px；它的 path 在箭尖前 4px 停住。回程箭头指向左，从 (424, 184) 到 (265, 184)，所以它的框从箭尖开始，x = 265；它的标签在它下方，以间隙的中点 x = 344 为中心。

```html
<div style="position: relative; width: 688px; height: 276px">
<svg width="159" height="8" viewBox="0 0 159 8" preserveAspectRatio="none" style="position: absolute; left: 264px; top: 156px; width: 159px; height: 8px; overflow: visible; fill: none; stroke: #8a8378; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round"><defs><marker id="dc-arrow-head-filled-1" orient="auto" markerWidth="5" markerHeight="5" refX="2" refY="2" overflow="visible"><path d="M0 0 L4 2 L0 4 Z" fill="#8a8378" stroke="none" style="stroke: none; fill: #8a8378; fill: context-stroke"/></marker></defs><path d="M 0 4 L 155 4" marker-end="url(#dc-arrow-head-filled-1)"></path></svg>
<svg width="159" height="8" viewBox="0 0 159 8" preserveAspectRatio="none" style="position: absolute; left: 265px; top: 180px; width: 159px; height: 8px; overflow: visible; fill: none; stroke: #8a8378; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round"><defs><marker id="dc-arrow-head-filled-2" orient="auto" markerWidth="5" markerHeight="5" refX="2" refY="2" overflow="visible"><path d="M0 0 L4 2 L0 4 Z" fill="#8a8378" stroke="none" style="stroke: none; fill: #8a8378; fill: context-stroke"/></marker></defs><path d="M 159 4 L 4 4" marker-end="url(#dc-arrow-head-filled-2)"></path></svg>
<div style="position: absolute; left: 64px; top: 64px; font-size: 24px; font-weight: 600">Invoices</div>
<div style="position: absolute; left: 64px; top: 136px; width: 200px; height: 72px; box-sizing: border-box; padding: 8px; display: flex; align-items: center; justify-content: center; text-align: center; background: #ffffff; border: 1px solid #d6d2c4; border-radius: 10px">Draft the invoice</div>
<div style="position: absolute; left: 424px; top: 136px; width: 200px; height: 72px; box-sizing: border-box; padding: 8px; display: flex; align-items: center; justify-content: center; text-align: center; background: #ffffff; border: 1px solid #d6d2c4; border-radius: 10px"><span><b>Approve</b><br>Finance signs off</span></div>
<div style="position: absolute; left: 304px; top: 196px; width: 80px; text-align: center; font-size: 13px; line-height: 16px; color: #6b6a65">sent back</div>
</div>
```
