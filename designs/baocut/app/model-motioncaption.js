/* 动效字幕（emphasis 系列）—— **25 份，连 presetIR 一起写定**。

   `model-subpresets.js` 是 31 份 classic 字幕样式：那一族只有涂装（字体 / 色 /
   描边 / 阴影 / 底板）＋ 一个逐词动效枚举，舞台上一条 `paintCss` 就画完了。**这一族不是。**
   `emphasis*` 与 `template-*-sub` 的 `style` 里只有 `emphasisPreset: <id>` 一个指针，真正的
   东西在另一套引擎里：一张 `presetIR`（逐词 / 逐字 / 逐行 / 整条四档动画）＋ 一张
   `wordStylingRules`（哪个词吃哪一档），由解释器编译成 `rangeProperties[]` 再逐帧画。
   所以这一份文件是**第二条渲染路径的模型层**，不是又一张涂装表。

   数据段在下面两个标记之间，逐字段写定；改数据时要同步看测试里钉死的那几组原始数值。

   ---

   ## 一、收了哪 25 份

   第 70/71 轮收的是 17 份。**第 72 轮扩到 25 份**——顺序是定的，多出来的 8 份是
   **插在中段**的，不是追加在尾巴上：`emphasisSixteen` / `emphasisSeventeen` 排第 2 / 3，
   `template-020-sub` 第 5、`template-015-sub` 第 7、`template-013-sub` 第 10、
   `template-029-sub` 第 13、`emphasisTen` / `emphasisSeven` 第 18 / 19。

   **显示名就是 `label` 字段**，包括三个占位名「Template 003 / 004 / 005」
   （`emphasisFifteen` / `emphasisSixteen` / `emphasisSeventeen`），不替它们改名。
   它们的引擎名 Slab / Ember / Vesper 写在 `name` 字段里。

   **卡片 id 就是 preset id**（`emphasisFifteen` / `template-027-sub`…），中间不设翻译层。
   这是上一轮三次映射错误换来的结构性教训：一有翻译表，就有「按名字对错了」的余地。

   ## 二、`defaultsPatch` 是 fallback 不是 override（按行为，不按意图）

   每份 preset 挂了一个 `defaultsPatch`，读起来全是覆盖意图
   （`emphasisFifteen: {letterCasing:"uppercase"}`）。但合并是
   `{...patch, ...defaults}`——**defaults 摊在后面，引擎默认赢**。于是 patch 只对模板自己没
   定义的键生效，对多数 preset 是彻底的空操作。这看着像参数顺序写反了，但行为就是这样，
   所以按行为来。下面 `paint` / `layout` 直接读数据段里已经按这条规则算好的
   `effectiveDefaults`，不自己再合并一遍。

   横竖屏：按 `aspectRatio < 1` 在 `landscape` / `portrait` / `square` 三块里挑。
   原型舞台是 16:9，所以 `paint` / `layout` 取的是 **landscape 那一块盖在顶层标量上**的结果。

   ## 三、单位换算（沿用 `model-subpresets.js` 头部那张表）

   | 预设字段 | 这里 | 换算 |
   |---|---|---|
   | `outline.size` | `outlineW` | ×160（`paintCss` 的描边是 `fz × outlineW/160`） |
   | `shadow.size` | `shBlur` | ×100 |
   | `shadow.offset{x,y}` | `shDist` / `shAngle` | 极坐标逆运算 |
   | `letterSpacingEm` | `spacing` | ×100（`spacing` 存的是 1/100 em；classic 那边是 px 所以 ×2，**这边不是**） |
   | `lineHeight` | `lh` | ×100 |
   | `letterCasing` | `upper` | `none/uppercase/lowercase/capitalize` ↔ `''/upper/lower/title` |
   | `emphasis` | `bold` / `italic` | 四档拆两个布尔 |

   与 classic 那 31 份的**唯一口径差**：那边把字重编进族名（`Poppins Extrabold`）所以要拆
   （族, 字重）；这一族的族名是干净的（`Inter` / `Anton` / `Epilogue`…），字重只看 `emphasis`
   与逐词规则里的 `variant.weight`，所以 `paint.weight` 一律 400，粗细走 `bold` / `variant`。

   这一族**没有 `background` 块**——25 份的 `effectiveDefaults` 里一个 `background` 都没有，
   底板一律关着（`opacity: 0`）。底色留 `#000000` 给属性页那颗开关一个起点。

   字体：25 份用到的族全在 Google Fonts 上（含 2025 年新上的 `Special Gothic Expanded One`，
   与第 72 轮进来的 `Instrument Serif` / `Gloock` / `Unna` / `Gloria Hallelujah` /
   `Just Me Again Down Here` / `Rubik Spray Paint` / `BBH Bartle` 七个——逐一取过
   `css2?family=` 确认返回真的 `@font-face`），所以没有替身，只在栈末尾照 classic 的先例
   挂中文字体——拉丁字体一个 CJK 字形都没有。

   ## 四、`capabilities` 的 11 位：5 位有消费端，6 位是纯文档

   原样保留 11 位。其中 6 位在这一族里**没有消费端**：`usesDepthLayout` /
   `hasCharacterAnimations` / `usesDynamicColor` / `requiresMeasurements` / `usesBlendModes` /
   `supportsLineReflow`。留着是因为它们是预设数据的一部分，哪天补渲染路径时它们就是判据；
   **别拿它们当开关用**——今天没人读。

   真正有消费端的 5 位：`styleType`（决定这条 id 走不走动态路径）、`usesOwnHighlighting`、
   `ignoreEmphasisEnabled`（强制每个词 rank 落 `accessible`）、`usesHideBehindForeground`
   与 `usesMaskFill`（只用来让哨兵断言能报错）。

   **`hideBehindForeground`（藏到前景人物后面）不做视觉复现**：浏览器原型没有人物 matting。
   第 72 轮把它的求值语义补全了：这条属性的 `value` 恒是哨兵串 `"injectedHiddenUuid"`，
   引擎在求值时把「要藏到谁后面」的 uuid 列表填进来，**列表为空就把这一条 property 整条
   splice 掉**——没有 matting 目标时走的就是这一支，字幕照常画在最前面。
   原型的 `hiddenUuids` 恒为空，所以带哨兵的 7 份（Ember / Vesper / Volt / Citrus / Marker /
   Backdrop / Backdrop+）在原型里都是**文字在前、不被遮挡**；它们本该藏在人物后面，
   这是已知近似，见第九节。Volt 另有一个只装着这一条的 `hideBg` 标签，同时挂在高亮与非高亮
   两条规则上——那一整个标签因此在原型里是空的。

   Quill（`template-014-sub`）的 `description` 写着「hides behind the scene's foreground
   subject」，但它的 `usesHideBehindForeground` 是 `false`，presetIR 里也没有哨兵
   （字符串只出现在一条 `characterAnimations` 的描述里）——**描述是旧的，数据是真的**。

   ## 五、`presetIR` 规范化到哪一步

   数据段里已经做完**结构**那一半：`segments` / `interpolate` 两个别名合一成 `keyframes`、
   `easing` 缺省补 `linear`、整条通道全常量就塌缩成 `{value}`。
   运行期做**时间**那一半：`t0` / `t1` 是 `TimeDef`，要有窗口才解得开，所以原样带着，由
   `resolveChannel()` 解析、丢掉 NaN 与倒序段、再塌缩一次。`inject` 对象**保留为标记**
   （`{inject:…}`），由 `resolveInjects()` 在求值时替换。

   `characterAnimations` 的窗口是一个字形簇在词窗里的那一片；`lineAnimations` 是行首词起到
   行尾词止；`globalAnimations` 是整条 cue。25 份里 line / global 那两档**几乎全是静态通道**
   （`variant` / `shadow` / `box`），唯二带关键帧的是 Backdrop+ 与 Blaze 的 `fadeInWithLine`
   （逐行淡入，`expoOut`）——它挂在**词规则的标签**上、内容却是 `lineAnimations`，
   所以 `plan` 的行那一档取的是本行所有词的标签并集，不是空表。

   ## 六、每帧求值 → 绘制指令表，以及几处近似（第 71 轮：CSS 路径退役）

   用户裁决：动效字幕不许用 CSS 动画渲染，按预设自带的算法**逐帧采样、canvas 2D 绘制**。
   于是这一层从「发 `@keyframes` ＋ 内联 CSS」改成两个纯函数：

     `layoutOf(preset, words, measure, ctx)` → 排版（要量宽，`measure` 由视图注入）
     `plan(preset, layout, tSec, ctx)`      → **绘制指令表**（全数值、按绘制顺序）

   `stateAt(layers, t)` 是唯一的求值口子。**没有「挂动画」这个概念**：每一帧重新算一遍，
   `rangeProperties` 本来就是这样消费的。词的时间门控因此是模型的性质而不是补丁——
   没到自己的窗口取首帧（多半 alpha 0，指令表里连这一条都不发）、窗口内按 t、过窗停末帧。

   | presetIR property | 绘制指令 |
   |---|---|
   | `alpha` | `op.alpha`（多条相乘——`resolve` 默认 `compose`） |
   | `scale` | 常量 ＋ `impactLayout !== false` 折进字号（参与排版），其余落 `op.tf.sx/sy`（绕词心） |
   | `position` | `op.tf.tx/ty`，em × 字号（相加） |
   | `rotation` | `op.tf.rot`，单位**度**（相加） |
   | `blur` | `op.blur`（视图 `ctx.filter = blur()`） |
   | `spacing` | `op.tracking`，em × 字号。**`[from,to-1]` 的 off-by-one** 见 `rangeOf()` / `spacingApplies()` |
   | `color` | `op.fill`（`resolve` 默认 `override`，`compose` 相乘） |
   | `variant` | `op.face.weight` / `op.face.italic` |
   | `font` | `op.face.family` |
   | `shadow` | `op.shadow{dx,dy,blur,color}`（size 是模糊、offset 是位移，都占字号） |
   | `outline` | `op.stroke{w,color}`，视图先 `strokeText` 后 `fillText`（＝ `paint-order: stroke fill`） |
   | `blendingMode` | `plan().blend`——整条交给合成器（canvas 元素的 `mix-blend-mode`） |
   | `box` | `{kind:'box'}` 指令：几何 = 词框 ＋ `padding` 外扩，再按 `position` / `scale` 变形 |
   | `hideBehindForeground` | 忽略（见上） |

   **近似与裁决，逐条**：

   1. **缓动是精确的 Penner 函数**（第 71 轮改正）。上一轮存的是 cubic-bezier 等价式，因为
      求值结果最终要落进 `animation-timing-function`；canvas 没有这个约束，`EASE` 直接实现
      闭式解，`elasticOut` / `bounceOut` 是它们本来的样子。查表大小写不敏感——数据里有一处
      写成 `Linear`（大写 L），照样按 linear 走。
   2. **`rotation` 当度处理。** 属性上没有单位字段，值是 ±0.95 那个量级；当弧度是 ±54°，
      对一行字是荒唐的抖动，当度是 ±0.95° 正好是 Handwritten 那点手写抖。属于靠量级判的一条。
   3. **`resolve` 的混合数学取最朴素的一套**：`alpha` 相乘、`scale` 相乘、
      `position` / `rotation` 相加、`color` 的 `compose` 相乘、其余后来居上。
   4. **`box.roundness` 是四角四个数**，25 份里四角恒等，所以只取第一角。四角不等时要
      另接线——数据里没有，不预先造。
   5. **块高有下限**（`BOX_MIN_H_EM = 0.14`）。Memo 的 `padding.y` 恒在 −1.5em，按字面算
      高度是负的，而那条绿条该**整个扫入过程恒定 2px**（字号 ≈14.5px ⇒ 0.14em）——所以对块的
      高做钳制，且下限不随 padding 变。宽度那一路没有下限（扫入起点 1px）。
   6. **演示 rank 口径**（确定性，写死）：默认**最长的那个词** rank = `highlighted`（6），
      并列取先，其余 `accessible`（1）；`ignoreEmphasisEnabled` 的 preset 全员 `accessible`。
      rank 本该来自 AI 强调，原型没有那一路，所以给一条可复现的假规则。
      `wordStylingRules.base.rank` 仍然盖在它上面（Slab 的 base 就写着 `highlighted`）。
   7. **`accessibleColor` / `highlightColor` / `viralColor` 的演示取值**：底是深色画面，
      默认字色即可及色，所以 `accessibleColor = paint.color`；`highlightColor` /`viralColor`
      取 `paint.activeColor`（＝ `highlightStyle.color`，没有就回落 `paint.color`）。
   8. **`computedScale` 现在是真量宽**（第 71 轮）：`layoutOf` 拿注入的 `measure` 实测每个词，
      按 `wrapWidth × targetFillRatio × 容器宽` 算倍率。`calculateHighlightedTextScale`（Slab）
      **不设上限**——数据写着 `maxScale: 1`，但 `IS` 要比 `FIVE-MINUTE` 高一倍多，
      两者撑到同一条基准宽，那不可能是「不许放大」，所以这一格当没写。
      `calculatePerLineHighlightScales`（Zen One）照数据夹 `[1, 2]`。
   9. **「一次一词」是排版的结果，不是一条规则**（第 71 轮改正）。上一轮按
      `wordVisibility: "transient"` 硬性只画当前那一个词，那是错的——
      Terminal / Zen One / Quill / Linen 也写着 transient，画面上却都该逐词累积。真正让 Slab
      与 Zest 一次只出一个词的是它们自己的数据：`wrapWidth: 0.15` ＋ `maxLines: 1`。
      堆叠上限（`MAX_STACK = 5`）是原型自己定的——原型的样例是整句，不是短句。
      `splitToWords` 那一路不吃 `maxLines`（Cascade 写着 2，画面上要叠到五六行）。

   ## 七、三处「名字骗人」，逐条钉住

   这一轮的最高纪律是**不按名字猜**。以下三条都是读实现才看出来的，与名字读起来的意思相反：

   1. **`addDynamicColorTag` 加的是 `color-<这个词带进来的色>`，不是 `color-<rank 名>`。**
      拼标签用的是词带进来的那个 `color` 字段（AI 强调给的色串）。
      原型没有那一路，词不带色，所以这个标签**根本不会出现**；数据里也没有任何 `color-*` 的
      `customAnimation` 与它对应——它在这一族里本来就是空转。有测试钉着。
   2. **`highlightStyle` 是垫在词属性下面的，不是盖在上面的**（合并顺序是 `{...highlightStyle, ...wordProps}`）：
      规则赢，`highlightStyle` 只补规则没写的那几格。唯一的例外是 `spacing`——那一格
      `highlightStyle` 反过来盖过规则（`highlightStyle.spacing ?? 规则的 spacing`）。三个前置条件缺一不可：
      `dynamicHighlights` 开、模板有 `highlightStyle`、`ignoreEmphasisEnabled` 为假。
      所以 `highlight` 字段存的是**原样**的 `highlightStyle`（预设自己的单位），涂装换算另走
      `highlightPaint()`——先换一遍再合并就会两种单位混在一起。
   3. **词属性的 `spacing` 与 `paint.spacing` 不是一个单位。** 前者是 em（与动画通道的
      `spacing` 同一路，落 `letter-spacing: Xem`），后者是涂装那一路的 1/100 em。

   另有两条名字与内容对不上的，只在注释里记：`template-014-sub`（Quill）的 `description` 说它
   「hides behind the scene's foreground subject」，但它的 `usesHideBehindForeground` 是 `false`；
   `template-027-sub` 的 `highlightBox` 描述写着「padding x grows -84 → -0.4」，数据里是
   `[-4,-1.8] → [0,-1.5]`。**描述是旧的，数据是真的**，两处都以数据为准。

   ## 八、第 72 轮那 8 份带进来的新机制，逐条

   1. **`splitByHighlight` ＋ `lineAnnotation` ＋ `axes` / `responsiveAxes`（深度排版）。**
      Backdrop 一族 7 份把一条 cue 切成「连着的高亮词」与「其余」两组，分别挂在两条**屏幕
      坐标轴**上。横屏那一对由 `responsiveAxes.landscape` 覆盖 `presetIR.axes`——Volt 就是靠
      这条覆盖才对：`axes` 写 ±0.3，`responsiveAxes` 写 0.35 / 0.39，**非高亮那一组反而在
      高亮组上面**，画面上就是小字压在大字头顶。实现见 `depthAxes` / `placeDepth`；
      距离压缩那一格记在 `DEPTH_GAP_EM` 上，真值出在 `layout.depth.rawGapEm` 里。
      Blaze 的 `lineAnnotation` 两条轴同名（都是 `top`），所以它不分组，照常堆叠。
   2. **`hideBehindForeground` 哨兵**（7 份）：见第四节。原型恒走 splice 那一支。
   3. **`groupConsecutive` 的语义改正**：run 发的是覆盖整段的一条 rangeProperty，
      run 里**每个词都吃**，共用 run 的时间窗口——不是「只有首词发」。见 `wordTracks`。
   4. **`defaultHighlightStyles`**（只有 Ember 有）：模板给 `highlightStyle` 的兜底，
      垫在 preset 的下面。今天没有可观察效果（Ember 的 `highlightStyle` 已经写了同一个字体）。
   5. **`maxScale` 照数据夹**：`calculateHighlightedTextScale` 不再一律无上限，只有
      `<= 1` 的那一格（Slab 的 1）当没写。Ember 的 30 / `targetFillRatio 0.95`、Marker 9、
      Vesper 8、Volt / Backdrop / Backdrop+ 7、Citrus 6.4 都照夹。
   6. **量倍率的分组**（`scaleGroups`）：`splitByHighlight` 那一路按**连着的高亮段**一起量
      （Ember 的 `Ten years` 是两个词一起撑满基准宽），逐行那一路按行量，其余一个词一组。
      行与倍率互为因果，所以**迭代两轮**（Blaze 的 `TEAMS LOSE` 就是第二轮才分成两行的）。
      `targetFillRatio` **只有 `calculateHighlightedTextScale` 读**——判据见 `measureScales`。
   9. **块的 `padding` / `position` 有一处不是 em**：Citrus 写的是 `[-84,-2]` / `[48,0.4]`，
      84em 不可能是 em，按 px 解才得到整词高的绿色高亮块 ＋ 从右扫入。
      判据是量级（|v| ≥ 10），见 `bigUnit`。Memo 全在 em 的量级里，一格没动。
   7. **Volt 取的是尾部的词**：它的规则用 `relativeTo: "totalWords"` ＋ 负 `value`
      （`wordIndex eq totalWords−1`），与其余六份的「取头部」正好相反；`hideBg` 是一个
      只装着哨兵的空标签，同时挂在两条规则上。
   8. **Blaze** 是唯一用 `calculatePerLineHighlightScales` ＋ `greedyLineBreak` 的一份：
      高亮词逐行撑到 `wrapWidth × 0.4`，非高亮词吃 `wordPop`（快速淡入）、全员吃
      `softShadow`，高亮词另有 `scaleUp`（`resolve: "compose"`，与其余六份的 `override` 不同）
      与 `highlightBounce`。它的 `description` 说自己用 `newlineOnHighlight`，
      **数据里是 `greedyLineBreak`**——又一处「描述是旧的，数据是真的」，以数据为准。

   ## 九、已知近似与未实现，逐条

   口径：**画面定视觉语法（分组、上下次序、字号差、入场轨迹），数据定选词。**
   选词一律以规则算出来的为准（Ember `Ten years teaching ballet` → 前两个词；
   Vesper `sixties …` 首词长度 7 > 4 → 只有首词；Blaze 首词不参选、接着两个词入选；Volt 取尾部）。

   下面几格是原型画不出来或只做了近似的：

   - **遮挡**：7 份的字本该藏在人物后面（`hideBehindForeground`），原型画在最前面。
     原型没有人物 matting，这是设计上就画不出的那一格。
   - **轴距被压**：两组之间的空档真值 4.5–13em，原型夹到 1.2em（见 `DEPTH_GAP_EM`）。
   - **Blaze 的逐行倍率是两轮迭代**：草稿行 → 量倍率 → 重排 → 再量一次。
     `TEAMS` / `LOSE` 第二轮各占一行，倍率则按上面那条口径落；不追到完全收敛。
   - **Marker 的 exclusion 混合**在画廊卡上是整条 canvas 交给合成器的（`mix-blend-mode`），
     与 Slab 同一格近似；它本该只混合高亮那一个词。

   ## 十、这一层不碰 DOM

   一个数都不来自浏览器：量宽是注入的函数（视图给 canvas `measureText`，`node --test` 给
   等宽假量尺），输出是几何与颜色的数值表。`node --test` 直接 `require`。 */
(function () {

  /* ==== 数据段 开始 · 手改需同步测试 ==== */
  /* 25 份，顺序是定的。
     `k` 就是 preset id，`label` 是显示名（含 `emphasisFifteen` /
     `emphasisSixteen` / `emphasisSeventeen` 的占位名「Template 003 / 004 / 005」），
     `tpl` / `name` 是它背后的引擎模板 id 与引擎名。 */
  const PRESETS = [
    {
      k: "emphasisFifteen",
      label: "Template 003",
      tpl: "template-003-sub",
      name: "Slab",
      grade: "draft",
      category: "highlights",
      tags: ["karaoke", "stretch", "centered", "one-word", "all-caps"],
      note: "All-Caps single-word stretched cues. Copy of template-002-sub without blur reveal and without highlight overrides.",
      paint: {
        font: "Anton", weight: 400, bold: false, italic: false, color: "#FFFFFF", align: "center", lh: 110,
        spacing: -4, upper: "upper", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20,
        plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: false,
        activeColor: "#FFFFFF", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: null,
      dhs: null,
      caps: {
        styleType: "animation", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: false, usesOwnHighlighting: true, ignoreEmphasisEnabled: true,
        requiresMeasurements: true, usesBlendModes: true, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "animation", wordVisibility: "transient", maxLines: 1, wrapWidth: 0.15, size: 0.15,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null, lineTransform: null,
        lineTransformCondition: null, sizeAlgorithm: "calculateHighlightedTextScale",
        sizeParams: {minScale: 0.05, maxScale: 1, targetFillRatio: 3}, perWordSizeAlgorithm: null,
        perWordSizeParams: null, lineAnnotation: null, responsiveAxes: null, itemOverrides: null
      },
      rules: {base: {tags: ["stretch", "exclusionBlend"], rank: "highlighted"}, rules: []},
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          stretch: {
            word: [
              {
                d: "Item-level computed scale that fills wrapWidth uniformly across all words in the cue",
                p: [
                  {
                    type: "scale", ch: {value: {inject: "scale", source: "computedScale", fallback: 1}},
                    resolve: "override", impactLayout: true
                  }
                ]
              }
            ]
          },
          exclusionBlend: {
            word: [
              {
                d: "Apply exclusion blend mode to text — inverts background colors",
                p: [
                  {type: "blendingMode", ch: {value: "exclusion"}}
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "emphasisSixteen",
      label: "Template 004",
      tpl: "template-004-sub",
      name: "Ember",
      grade: "draft",
      category: "text-behind",
      tags: ["depth", "dynamic-color", "layered", "serif-accent"],
      note: "Depth layout emphasis with all words visible. Copy of emphasisSeven (Backdrop).",
      paint: {
        font: "Instrument Serif", weight: 400, bold: false, italic: false, color: "#FFFFFF",
        align: "center", lh: 105, spacing: -2, upper: "", mono: false, bg: "#000000", opacity: 0,
        corners: 0, pad: 20, plate: "line", outline: false, outlineColor: "#000000", outlineW: 0,
        shadow: true, activeColor: "#FF0503", shDist: 0, shAngle: 0, shBlur: 23, shColor: "#00000044"
      },
      highlight: {font: "Rubik Spray Paint", spacing: -0.08, color: "#FF0503"},
      dhs: {font: "Rubik Spray Paint"},
      caps: {
        styleType: "depth", usesDepthLayout: true, hasCharacterAnimations: false, usesDynamicColor: true,
        usesOwnHighlighting: true, ignoreEmphasisEnabled: false, requiresMeasurements: true,
        usesBlendModes: false, usesHideBehindForeground: true, usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "depth",
        wordVisibility: "persistent",
        maxLines: null,
        wrapWidth: 0.85,
        size: 0.068,
        textWrap: "nowrap",
        lineHeightAdjustmentMode: "glyphheight",
        textPositioningMode: null,
        lineTransform: "splitByHighlight",
        lineTransformCondition: null,
        sizeAlgorithm: "calculateHighlightedTextScale",
        sizeParams: {minScale: 0.1, maxScale: 30, targetFillRatio: 0.95},
        perWordSizeAlgorithm: null,
        perWordSizeParams: null,
        lineAnnotation: {
          highlightedAxis: "top", unhighlightedAxis: "bottom", highlightedAlign: "upperBound",
          unhighlightedAlign: "lowerBound", skipInPreview: true
        },
        responsiveAxes: {
          top: {landscape: [0, 0.3], portrait: [0, 0.32]},
          bottom: {landscape: [0, -0.3], portrait: [0, -0.23]}
        },
        itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted",
            when: {
              type: "or",
              rules: [
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 1},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 2},
                    {type: "allWordsMatch", quantifier: "every", field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "lte", value: 4},
                    {type: "position", field: "wordIndex", operator: "lte", value: 1}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                }
              ]
            },
            apply: {tags: ["hidden"], rank: "highlighted"}
          },
          {
            name: "Non-highlighted", when: {type: "constant", value: true},
            apply: {tags: ["shadow"], rank: "accessible"}
          }
        ]
      },
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [
          {
            d: "Fade in animation",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {t0: {time: ["start", -0.01]}, t1: {time: ["start", 0]}, easing: "linear", v0: 0, v1: 1}
                  ]
                }
              }
            ]
          }
        ],
        line: [
          {d: "No line animations", p: []}
        ],
        char: [],
        global: [],
        axes: {
          top: {pos: [0, 0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"},
          bottom: {pos: [0, -0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"}
        },
        tags: {
          hidden: {
            word: [
              {
                d: "Hidden text effect with color highlight and shadow",
                p: [
                  {type: "font", value: "Rubik Spray Paint"},
                  {
                    type: "scale", ch: {value: {inject: "scale", source: "computedScale", fallback: 1}},
                    resolve: "override", impactLayout: true
                  },
                  {type: "color", ch: {value: {inject: "color", source: "highlightColor"}}},
                  {type: "hideBehindForeground", value: "injectedHiddenUuid"},
                  {
                    type: "shadow",
                    size: {value: 0.05},
                    color: {
                      value: {
                        inject: "color", source: "highlightColor", transform: "scaleOpacity",
                        transformParam: 0.8
                      }
                    },
                    offset: {value: [0, 0.05]}
                  }
                ]
              }
            ],
            groupConsecutive: true
          }
        }
      }
    },

    {
      k: "emphasisSeventeen",
      label: "Template 005",
      tpl: "template-005-sub",
      name: "Vesper",
      grade: "example",
      category: "text-behind",
      tags: ["draft", "experimental", "depth", "dynamic-color", "layered", "serif-accent"],
      note: "DRAFT — fork of emphasisSeven. Depth layout emphasis with all words visible.",
      paint: {
        font: "Gloock", weight: 400, bold: false, italic: false, color: "#FFF18F", align: "center", lh: 105,
        spacing: -1, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20, plate: "line",
        outline: false, outlineColor: "#000000", outlineW: 0, shadow: true, activeColor: "#FFF18F",
        shDist: 0, shAngle: 0, shBlur: 20, shColor: "#00000044"
      },
      highlight: {font: "Gloock", spacing: -0.04, color: "#FFF18F"},
      dhs: null,
      caps: {
        styleType: "depth", usesDepthLayout: true, hasCharacterAnimations: false, usesDynamicColor: true,
        usesOwnHighlighting: true, ignoreEmphasisEnabled: false, requiresMeasurements: true,
        usesBlendModes: false, usesHideBehindForeground: true, usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "depth",
        wordVisibility: "persistent",
        maxLines: null,
        wrapWidth: 0.48,
        size: 0.06,
        textWrap: "nowrap",
        lineHeightAdjustmentMode: "glyphheight",
        textPositioningMode: null,
        lineTransform: "splitByHighlight",
        lineTransformCondition: null,
        sizeAlgorithm: "calculateHighlightedTextScale",
        sizeParams: {minScale: 0.1, maxScale: 8},
        perWordSizeAlgorithm: null,
        perWordSizeParams: null,
        lineAnnotation: {
          highlightedAxis: "top", unhighlightedAxis: "bottom", highlightedAlign: "upperBound",
          unhighlightedAlign: "lowerBound", skipInPreview: true
        },
        responsiveAxes: {
          top: {landscape: [0, 0.3], portrait: [0, 0.25]},
          bottom: {landscape: [0, -0.3], portrait: [0, -0.25]}
        },
        itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted",
            when: {
              type: "or",
              rules: [
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 1},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 2},
                    {type: "allWordsMatch", quantifier: "every", field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "lte", value: 4},
                    {type: "position", field: "wordIndex", operator: "lte", value: 1}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                }
              ]
            },
            apply: {tags: ["hidden"], rank: "highlighted"}
          },
          {
            name: "Non-highlighted", when: {type: "constant", value: true},
            apply: {tags: ["shadow"], rank: "accessible"}
          }
        ]
      },
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [
          {
            d: "Fade in animation",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {t0: {time: ["start", -0.01]}, t1: {time: ["start", 0]}, easing: "linear", v0: 0, v1: 1}
                  ]
                }
              }
            ]
          }
        ],
        line: [
          {d: "No line animations", p: []}
        ],
        char: [],
        global: [],
        axes: {
          top: {pos: [0, 0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"},
          bottom: {pos: [0, -0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"}
        },
        tags: {
          hidden: {
            word: [
              {
                d: "Hidden text effect with color highlight and shadow",
                p: [
                  {
                    type: "scale", ch: {value: {inject: "scale", source: "computedScale", fallback: 1}},
                    resolve: "override", impactLayout: true
                  },
                  {type: "color", ch: {value: {inject: "color", source: "highlightColor"}}},
                  {type: "hideBehindForeground", value: "injectedHiddenUuid"},
                  {
                    type: "shadow",
                    size: {value: 0.05},
                    color: {
                      value: {
                        inject: "color", source: "highlightColor", transform: "scaleOpacity",
                        transformParam: 0.8
                      }
                    },
                    offset: {value: [0, 0.05]}
                  }
                ]
              }
            ],
            groupConsecutive: true
          },
          shadow: {
            word: [
              {
                d: "Shadow effect for non-highlighted words",
                p: [
                  {
                    type: "shadow", size: {value: 0.08}, color: {value: "#0000007F"},
                    offset: {value: [0, 0]}
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "template-027-sub",
      label: "Memo",
      tpl: "template-027-sub",
      name: "Memo",
      grade: "draft",
      category: "highlights",
      tags: ["scale", "fade", "color-highlight", "serif-accent", "dynamic-color"],
      note: "Scale-in + fade-in emphasis with highlighted word enlargement. Copy of emphasisOne.",
      paint: {
        font: "Inter", weight: 400, bold: true, italic: false, color: "#FFFFFF", align: "center", lh: 84,
        spacing: -4, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20, plate: "line",
        outline: false, outlineColor: "#000000", outlineW: 0, shadow: false, activeColor: "#FFFFFF",
        shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {font: "Inter", spacing: 0, bold: false, italic: true, color: "#FFFFFF"},
      dhs: null,
      caps: {
        styleType: "animation", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: true, usesOwnHighlighting: false, ignoreEmphasisEnabled: false,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "animation", wordVisibility: "persistent", maxLines: 1, wrapWidth: 0.4, size: 0.036,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null,
        lineTransform: "greedyLineBreak", lineTransformCondition: null, sizeAlgorithm: null,
        sizeParams: null, perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: null,
        responsiveAxes: null, itemOverrides: null
      },
      rules: {
        base: {tags: ["wordFadeIn"], letterCasing: "lowercase"},
        rules: [
          {
            name: "Highlighted word with dynamic styles",
            when: {
              type: "and",
              rules: [
                {type: "rank", operator: "gte", value: "highlighted"},
                {
                  type: "or",
                  rules: [
                    {type: "featureFlag", name: "dynamicHighlights"},
                    {type: "position", field: "itemIndex", operator: "neq", value: 0, modulo: 3}
                  ]
                }
              ]
            },
            apply: {
              tags: ["wordFadeIn", "highlightBox"], addDynamicColorTag: true,
              variant: {weight: 500, italic: true}
            }
          },
          {
            name: "Non-highlighted (gets scale-in)", when: {type: "constant", value: true},
            apply: {tags: ["wordScaleIn"]}
          }
        ]
      },
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          wordFadeIn: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.16}, easing: "cubicOut", v0: 0, v1: 1}
                      ]
                    }
                  }
                ]
              }
            ]
          },
          highlightBox: {
            word: [
              {
                d: "Underline sweep: thin green bar below text. Padding x grows -84 → -0.4 (width collapsed → full), position x compensates 48 → 0 so it sweeps left-to-right. Padding y stays -2 (thin). Position y -0.6 places it below the text baseline.",
                p: [
                  {
                    type: "box",
                    payload: [
                      {type: "color", ch: {value: "#96FF1A"}},
                      {type: "roundness", ch: {value: [0.05, 0.05, 0.05, 0.05]}},
                      {
                        type: "padding",
                        ch: {
                          keyframes: [
                            {
                              t0: {progress: -0.12}, t1: {progress: 0.84}, easing: "quadOut",
                              v0: [-4, -1.8], v1: [0, -1.5]
                            }
                          ]
                        }
                      },
                      {
                        type: "position",
                        ch: {
                          keyframes: [
                            {
                              t0: {progress: -0.12}, t1: {progress: 0.84}, easing: "quadOut",
                              v0: [-2.8, 0.6], v1: [0, 0.8]
                            }
                          ]
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "template-020-sub",
      label: "Volt",
      tpl: "template-020-sub",
      name: "Volt",
      grade: "draft",
      category: "text-behind",
      tags: ["depth", "dynamic-color", "layered", "uppercase-highlight"],
      note: "Depth layout emphasis with all words visible. Highlighted words use Anton uppercase. Copy of emphasisSeven.",
      paint: {
        font: "Gloria Hallelujah", weight: 400, bold: true, italic: false, color: "#FFFFFF", align: "left",
        lh: 105, spacing: -3, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20,
        plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: false,
        activeColor: "#96FF1A", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {font: "Anton", spacing: 0, color: "#96FF1A"},
      dhs: null,
      caps: {
        styleType: "depth", usesDepthLayout: true, hasCharacterAnimations: false, usesDynamicColor: true,
        usesOwnHighlighting: true, ignoreEmphasisEnabled: false, requiresMeasurements: true,
        usesBlendModes: false, usesHideBehindForeground: true, usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "depth",
        wordVisibility: "persistent",
        maxLines: 1,
        wrapWidth: 0.48,
        size: 0.042,
        textWrap: "nowrap",
        lineHeightAdjustmentMode: "glyphheight",
        textPositioningMode: null,
        lineTransform: "splitByHighlight",
        lineTransformCondition: null,
        sizeAlgorithm: "calculateHighlightedTextScale",
        sizeParams: {minScale: 0.1, maxScale: 7},
        perWordSizeAlgorithm: null,
        perWordSizeParams: null,
        lineAnnotation: {
          highlightedAxis: "top", unhighlightedAxis: "bottom", highlightedAlign: "upperBound",
          unhighlightedAlign: "lowerBound", skipInPreview: true
        },
        responsiveAxes: {
          top: {landscape: [0, 0.35], portrait: [0, 0.31]},
          bottom: {landscape: [0, 0.39], portrait: [0, 0.33]}
        },
        itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted",
            when: {
              type: "or",
              rules: [
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 1},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 2},
                    {type: "allWordsMatch", quantifier: "every", field: "length", operator: "gt", value: 4},
                    {
                      type: "position", field: "wordIndex", operator: "eq", value: -1,
                      relativeTo: "totalWords"
                    }
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "lte", value: 4},
                    {
                      type: "position", field: "wordIndex", operator: "gte", value: -2,
                      relativeTo: "totalWords"
                    }
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "gt", value: 4},
                    {
                      type: "position", field: "wordIndex", operator: "eq", value: -1,
                      relativeTo: "totalWords"
                    }
                  ]
                }
              ]
            },
            apply: {tags: ["hidden", "hideBg"], rank: "highlighted", letterCasing: "uppercase"}
          },
          {
            name: "Non-highlighted", when: {type: "constant", value: true},
            apply: {tags: ["shadow", "hideBg"], rank: "accessible"}
          }
        ]
      },
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [
          {
            d: "Fade in animation",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {t0: {time: ["start", -0.01]}, t1: {time: ["start", 0]}, easing: "linear", v0: 0, v1: 1}
                  ]
                }
              }
            ]
          }
        ],
        line: [
          {d: "No line animations", p: []}
        ],
        char: [],
        global: [],
        axes: {
          top: {pos: [0, 0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"},
          bottom: {pos: [0, -0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"}
        },
        tags: {
          hidden: {
            word: [
              {
                d: "Hidden text effect with color highlight and shadow",
                p: [
                  {
                    type: "scale", ch: {value: {inject: "scale", source: "computedScale", fallback: 1}},
                    resolve: "override", impactLayout: true
                  },
                  {
                    type: "position",
                    ch: {
                      keyframes: [
                        {
                          t0: {progress: -0.28}, t1: {progress: 0.28}, easing: "backOut", v0: [0, -1.6],
                          v1: [0, 0]
                        }
                      ]
                    },
                    impactLayout: false
                  },
                  {
                    type: "blur",
                    size: {
                      keyframes: [
                        {t0: {progress: -0.28}, t1: {progress: 0.28}, easing: "quadOut", v0: 2.8, v1: 0}
                      ]
                    }
                  },
                  {type: "color", ch: {value: "#96FF1A"}}
                ]
              }
            ],
            groupConsecutive: true
          },
          shadow: {
            word: [
              {
                d: "Shadow effect for non-highlighted words",
                p: [
                  {
                    type: "shadow", size: {value: 0.08}, color: {value: "#0000007F"},
                    offset: {value: [0, 0]}
                  }
                ]
              }
            ]
          },
          hideBg: {
            word: [
              {
                d: "Auto-injected hideBehindForeground target",
                p: [
                  {type: "hideBehindForeground", value: "injectedHiddenUuid"}
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "template-018-sub",
      label: "Linen",
      tpl: "template-018-sub",
      name: "Linen",
      grade: "draft",
      category: "highlights",
      tags: ["typewriter", "character-animation", "dynamic-color", "box-animation"],
      note: "Typewriter emphasis with box exit animation. Copy of emphasisNine.",
      paint: {
        font: "Bricolage Grotesque", weight: 400, bold: true, italic: false, color: "#FFFFFF",
        align: "center", lh: 84, spacing: -4, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0,
        pad: 20, plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: false,
        activeColor: "#FFFFFF", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: null,
      dhs: null,
      caps: {
        styleType: "character", usesDepthLayout: false, hasCharacterAnimations: true,
        usesDynamicColor: false, usesOwnHighlighting: true, ignoreEmphasisEnabled: true,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "character", wordVisibility: "transient", maxLines: 1, wrapWidth: 0.4, size: 0.03,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null, lineTransform: null,
        lineTransformCondition: null, sizeAlgorithm: null, sizeParams: null, perWordSizeAlgorithm: null,
        perWordSizeParams: null, lineAnnotation: null, responsiveAxes: null, itemOverrides: null
      },
      rules: {rules: []},
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [
          {d: "", p: []}
        ],
        line: [
          {
            d: "",
            p: [
              {type: "variant", value: {weight: 500}}
            ]
          }
        ],
        char: [
          {
            d: "",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {
                      t0: {time: ["start", -0.02]}, t1: {time: ["start", 0.02]}, easing: "quadOut", v0: 0,
                      v1: 1
                    }
                  ]
                }
              },
              {
                type: "box",
                payload: [
                  {type: "color", ch: {value: "#EAEAEA66"}},
                  {type: "blur", size: {value: 0.8}},
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", 0]}, t1: {time: ["start", 0.001]}, easing: "Linear", v0: 0,
                          v1: 1
                        },
                        {
                          t0: {
                            min: [
                              {time: ["start", 0.09]},
                              {time: ["end", -0.001]}
                            ]
                          },
                          t1: {
                            min: [
                              {time: ["start", 0.1]},
                              {time: ["end", 0]}
                            ]
                          },
                          easing: "Linear",
                          v0: 1,
                          v1: 0
                        }
                      ]
                    }
                  },
                  {type: "padding", ch: {value: [0, 1.2]}},
                  {type: "position", ch: {value: [-0.12, 0]}},
                  {type: "roundness", ch: {value: [0.7, 0.7, 0.7, 0.7]}}
                ]
              }
            ]
          }
        ],
        global: [],
        axes: null,
        tags: {}
      }
    },

    {
      k: "template-015-sub",
      label: "Citrus",
      tpl: "template-015-sub",
      name: "Citrus",
      grade: "draft",
      category: "text-behind",
      tags: ["depth", "dynamic-color", "layered", "uppercase-highlight", "bounce", "outline", "shadow"],
      note: "Scratch/experimental copy of template-008-sub for free iteration.",
      paint: {
        font: "Inter", weight: 400, bold: false, italic: false, color: "#FFFFFF", align: "center", lh: 105,
        spacing: -3, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20, plate: "line",
        outline: false, outlineColor: "#000000", outlineW: 0, shadow: false, activeColor: "#121212",
        shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {font: "Inter", spacing: -0.08, color: "#121212"},
      dhs: null,
      caps: {
        styleType: "depth", usesDepthLayout: true, hasCharacterAnimations: false, usesDynamicColor: true,
        usesOwnHighlighting: true, ignoreEmphasisEnabled: false, requiresMeasurements: true,
        usesBlendModes: false, usesHideBehindForeground: true, usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "depth",
        wordVisibility: "persistent",
        maxLines: 1,
        wrapWidth: 0.8,
        size: 0.048,
        textWrap: "nowrap",
        lineHeightAdjustmentMode: "glyphheight",
        textPositioningMode: null,
        lineTransform: "splitByHighlight",
        lineTransformCondition: null,
        sizeAlgorithm: "calculateHighlightedTextScale",
        sizeParams: {minScale: 0.4, maxScale: 6.4},
        perWordSizeAlgorithm: null,
        perWordSizeParams: null,
        lineAnnotation: {
          highlightedAxis: "top", unhighlightedAxis: "bottom", highlightedAlign: "upperBound",
          unhighlightedAlign: "lowerBound", skipInPreview: true
        },
        responsiveAxes: {
          top: {landscape: [0, 0.36], portrait: [0, 0.33]},
          bottom: {landscape: [0, -0.4], portrait: [0, -0.28]}
        },
        itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted",
            when: {
              type: "or",
              rules: [
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 1},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 2},
                    {type: "allWordsMatch", quantifier: "every", field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "lte", value: 4},
                    {type: "position", field: "wordIndex", operator: "lte", value: 1}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                }
              ]
            },
            apply: {
              tags: ["hidden"], rank: "highlighted", variant: {weight: 500, italic: true},
              letterCasing: "lowercase"
            }
          },
          {
            name: "Non-highlighted", when: {type: "constant", value: true},
            apply: {tags: ["shadow"], rank: "accessible"}
          }
        ]
      },
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [
          {d: "Fade in animation", p: []}
        ],
        line: [
          {d: "No line animations", p: []}
        ],
        char: [],
        global: [],
        axes: {
          top: {pos: [0, 0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"},
          bottom: {pos: [0, -0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"}
        },
        tags: {
          hidden: {
            word: [
              {
                d: "Hidden text effect with color highlight and shadow",
                p: [
                  {
                    type: "scale", ch: {value: {inject: "scale", source: "computedScale", fallback: 1}},
                    resolve: "override", impactLayout: true
                  },
                  {type: "hideBehindForeground", value: "injectedHiddenUuid"},
                  {
                    type: "box",
                    payload: [
                      {type: "color", ch: {value: "#96FF1A"}},
                      {type: "roundness", ch: {value: [0.12, 0.12, 0.12, 0.12]}},
                      {
                        type: "padding",
                        ch: {
                          keyframes: [
                            {
                              t0: {progress: -0.12}, t1: {progress: 0.84}, easing: "quadOut", v0: [-84, -2],
                              v1: [-0.4, -2]
                            }
                          ]
                        }
                      },
                      {
                        type: "position",
                        ch: {
                          keyframes: [
                            {
                              t0: {progress: -0.12}, t1: {progress: 0.84}, easing: "quadOut", v0: [48, 0.4],
                              v1: [0, 0.4]
                            }
                          ]
                        }
                      },
                      {
                        type: "alpha",
                        ch: {
                          keyframes: [
                            {t0: {progress: 0}, t1: {progress: 0.15}, easing: "linear", v0: 0, v1: 1}
                          ]
                        }
                      }
                    ]
                  }
                ]
              }
            ],
            groupConsecutive: true
          },
          shadow: {
            word: [
              {
                d: "Shadow effect for non-highlighted words",
                p: [
                  {
                    type: "shadow", size: {value: 0.12}, color: {value: "#0000007F"},
                    offset: {value: [0, 0]}
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "template-011-sub",
      label: "Hush",
      tpl: "template-011-sub",
      name: "Hush",
      grade: "draft",
      category: "highlights",
      tags: ["blur-effect", "character-animation", "focus"],
      note: "Blur focus emphasis, no exit animations. Copy of emphasisSix.",
      paint: {
        font: "Montserrat", weight: 400, bold: false, italic: false, color: "#FFFFFF", align: "center",
        lh: 100, spacing: 0, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20,
        plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: false,
        activeColor: "#FFFFFF", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: null,
      dhs: null,
      caps: {
        styleType: "character", usesDepthLayout: false, hasCharacterAnimations: true,
        usesDynamicColor: false, usesOwnHighlighting: true, ignoreEmphasisEnabled: true,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "character", wordVisibility: "persistent", maxLines: 1, wrapWidth: 0.12, size: 0.04,
        textWrap: "nowrap", lineHeightAdjustmentMode: "glyphheight", textPositioningMode: null,
        lineTransform: null, lineTransformCondition: null, sizeAlgorithm: null, sizeParams: null,
        perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: null, responsiveAxes: null,
        itemOverrides: null
      },
      rules: {rules: []},
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [
          {
            d: "",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {
                      t0: {time: ["start", -0.64]}, t1: {time: ["start", 0.24]}, easing: "quadOut", v0: 0,
                      v1: 1
                    }
                  ]
                }
              },
              {
                type: "scale",
                ch: {
                  keyframes: [
                    {
                      t0: {time: ["start", -0.64]}, t1: {time: ["start", 0.24]}, easing: "quadOut",
                      v0: [0.8, 0.8], v1: [1, 1]
                    }
                  ]
                }
              },
              {
                type: "spacing",
                ch: {
                  keyframes: [
                    {
                      t0: {time: ["start", -0.8]}, t1: {time: ["start", 2.4]}, easing: "quadOut", v0: 0,
                      v1: 0.8
                    }
                  ]
                }
              }
            ]
          }
        ],
        line: [],
        char: [
          {
            d: "",
            p: [
              {
                type: "blur",
                size: {
                  keyframes: [
                    {
                      t0: {time: ["start", -0.64]}, t1: {time: ["start", 0.12]}, easing: "quadOut", v0: 1.6,
                      v1: 0
                    }
                  ]
                }
              }
            ]
          }
        ],
        global: [],
        axes: null,
        tags: {}
      }
    },

    {
      k: "template-022-sub",
      label: "Cascade",
      tpl: "template-022-sub",
      name: "Cascade",
      grade: "draft",
      category: "highlights",
      tags: ["scale", "fade", "bold", "purple", "word-by-word", "stacked"],
      note: "Bold purple word-by-word stacked reveal with dramatic scale emphasis on highlighted words. Copy of deepPurple.",
      paint: {
        font: "Inter", weight: 400, bold: false, italic: false, color: "#FFFFFF", align: "center", lh: 80,
        spacing: -9, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20, plate: "line",
        outline: true, outlineColor: "#000000", outlineW: 4, shadow: false, activeColor: "#FFFFFF",
        shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {color: "#FFFFFF"},
      dhs: null,
      caps: {
        styleType: "animation", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: false, usesOwnHighlighting: false, ignoreEmphasisEnabled: false,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "animation", wordVisibility: "persistent", maxLines: 2, wrapWidth: 0.8, size: 0.09,
        textWrap: "wrap", lineHeightAdjustmentMode: null, textPositioningMode: null,
        lineTransform: "splitToWords", lineTransformCondition: null, sizeAlgorithm: null, sizeParams: null,
        perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: null, responsiveAxes: null,
        itemOverrides: null
      },
      rules: {
        base: {tags: ["wordScaleIn", "wordFadeIn"], letterCasing: "lowercase", variant: {weight: 700}},
        rules: [
          {
            name: "Even lines — right align",
            when: {type: "position", field: "lineIndex", operator: "eq", value: 0, modulo: 1},
            apply: {align: "left"}, continueMatching: true
          },
          {
            name: "Odd lines — left align",
            when: {type: "position", field: "lineIndex", operator: "eq", value: 1, modulo: 1},
            apply: {align: "left"}, continueMatching: true
          },
          {
            name: "Above-median rank — highlight color",
            when: {type: "rank", operator: "gte", value: "cue-median"},
            apply: {color: {source: "highlightColor"}}, continueMatching: true
          },
          {
            name: "Highlighted word",
            when: {
              type: "and",
              rules: [
                {type: "rank", operator: "eq", value: "cue-max"},
                {
                  type: "or",
                  rules: [
                    {type: "featureFlag", name: "dynamicHighlights"},
                    {type: "position", field: "itemIndex", operator: "neq", value: 0, modulo: 2}
                  ]
                }
              ]
            },
            apply: {tags: ["wordScaleIn", "wordFadeIn"], scale: 1.2, variant: {weight: 900}}
          }
        ]
      },
      ir: {
        textTemplate: {textWrap: "wrap"},
        word: [
          {
            d: "Global letter-spacing spread animation: letters diverge over word lifetime",
            p: [
              {
                type: "spacing",
                ch: {
                  keyframes: [
                    {t0: {progress: 0}, t1: {progress: 1}, easing: "quadOut", v0: -0.06, v1: -0.09}
                  ]
                }
              }
            ]
          }
        ],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          wordScaleIn: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "scale",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.001]}, t1: {time: ["start", 0]}, easing: "linear", v0: 0,
                          v1: 1
                        }
                      ]
                    },
                    impactLayout: false
                  }
                ]
              }
            ]
          },
          wordFadeIn: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.001]}, t1: {time: ["start", 0]}, easing: "linear", v0: 0,
                          v1: 1
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "template-013-sub",
      label: "Marker",
      tpl: "template-013-sub",
      name: "Marker",
      grade: "draft",
      category: "text-behind",
      tags: ["depth", "dynamic-color", "layered", "serif-accent"],
      note: "Depth layout emphasis with all words visible. Copy of emphasisSeven.",
      paint: {
        font: "Archivo Black", weight: 400, bold: false, italic: false, color: "#FFFFFF", align: "center",
        lh: 105, spacing: -6, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20,
        plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: false,
        activeColor: "#FFFFFF", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {font: "Archivo Black", spacing: -0.08, color: "#FFFFFF"},
      dhs: null,
      caps: {
        styleType: "depth", usesDepthLayout: true, hasCharacterAnimations: false, usesDynamicColor: true,
        usesOwnHighlighting: true, ignoreEmphasisEnabled: false, requiresMeasurements: true,
        usesBlendModes: true, usesHideBehindForeground: true, usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "depth",
        wordVisibility: "persistent",
        maxLines: 3,
        wrapWidth: 0.6,
        size: 0.066,
        textWrap: "nowrap",
        lineHeightAdjustmentMode: "glyphheight",
        textPositioningMode: null,
        lineTransform: "splitByHighlight",
        lineTransformCondition: null,
        sizeAlgorithm: "calculateHighlightedTextScale",
        sizeParams: {minScale: 0.1, maxScale: 9},
        perWordSizeAlgorithm: null,
        perWordSizeParams: null,
        lineAnnotation: {
          highlightedAxis: "top", unhighlightedAxis: "bottom", highlightedAlign: "upperBound",
          unhighlightedAlign: "lowerBound", skipInPreview: true
        },
        responsiveAxes: {
          top: {landscape: [0, 0.4], portrait: [0, 0.35]},
          bottom: {landscape: [0, -0.4], portrait: [0, -0.25]}
        },
        itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted",
            when: {
              type: "or",
              rules: [
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 1},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 2},
                    {type: "allWordsMatch", quantifier: "every", field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "lte", value: 4},
                    {type: "position", field: "wordIndex", operator: "lte", value: 1}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                }
              ]
            },
            apply: {tags: ["hidden"], rank: "viral", font: "Archivo Black"}
          },
          {
            name: "Non-highlighted", when: {type: "constant", value: true},
            apply: {tags: ["shadow"], rank: "accessible"}
          }
        ]
      },
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [
          {
            d: "Fade in animation",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {t0: {time: ["start", -0.01]}, t1: {time: ["start", 0]}, easing: "linear", v0: 0, v1: 1}
                  ]
                }
              }
            ]
          }
        ],
        line: [
          {d: "No line animations", p: []}
        ],
        char: [],
        global: [],
        axes: {
          top: {pos: [0, 0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"},
          bottom: {pos: [0, -0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"}
        },
        tags: {
          hidden: {
            word: [
              {
                d: "Hidden text effect with color highlight and shadow",
                p: [
                  {type: "blendingMode", ch: {value: "exclusion"}},
                  {
                    type: "scale", ch: {value: {inject: "scale", source: "computedScale", fallback: 1}},
                    resolve: "override", impactLayout: true
                  },
                  {type: "hideBehindForeground", value: "injectedHiddenUuid"},
                  {type: "color", ch: {value: {inject: "color", source: "highlightColor"}}}
                ]
              }
            ],
            groupConsecutive: true
          },
          shadow: {
            word: [
              {
                d: "Shadow effect for non-highlighted words",
                p: [
                  {
                    type: "shadow", size: {value: 0.04}, color: {value: "#0000007F"},
                    offset: {value: [0, 0]}
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "template-014-sub",
      label: "Quill",
      tpl: "template-014-sub",
      name: "Quill",
      grade: "draft",
      category: "highlights",
      tags: ["typewriter", "character-animation", "minimal"],
      note: "Simple character-level typewriter, white text on Libertinus Keyboard, centered. One word per line. Copy of template-001-sub-2.",
      paint: {
        font: "Inter", weight: 400, bold: true, italic: false, color: "#FFFFFF", align: "left", lh: 88,
        spacing: -5, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20, plate: "line",
        outline: false, outlineColor: "#000000", outlineW: 0, shadow: true, activeColor: "#FFFFFF",
        shDist: 0, shAngle: 0, shBlur: 24, shColor: "#FFFFFF"
      },
      highlight: {font: "Ballet", spacing: 0.005},
      dhs: null,
      caps: {
        styleType: "character", usesDepthLayout: false, hasCharacterAnimations: true,
        usesDynamicColor: true, usesOwnHighlighting: true, ignoreEmphasisEnabled: false,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "character", wordVisibility: "transient", maxLines: 1, wrapWidth: 0.6, size: 0.04,
        textWrap: null, lineHeightAdjustmentMode: null, textPositioningMode: null,
        lineTransform: "splitToWords", lineTransformCondition: null, sizeAlgorithm: null, sizeParams: null,
        perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: null, responsiveAxes: null,
        itemOverrides: null
      },
      rules: {
        base: {rank: "accessible"},
        rules: [
          {
            name: "emphasis-first-only",
            when: {type: "position", field: "wordIndex", operator: "eq", value: 0},
            apply: {scale: 4.8, tags: ["flicker"], rank: "highlighted"}
          }
        ]
      },
      ir: {
        textTemplate: {},
        word: [
          {d: "", p: []}
        ],
        line: [],
        char: [
          {
            d: "Per-glyph alpha pop-in (typewriter) + invisible box anchor that gives word-level hideBehindForeground a renderable layer to attach to",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {
                      t0: {time: ["start", -0.1]}, t1: {time: ["start", -0.0999]}, easing: "linear", v0: 0,
                      v1: 1
                    }
                  ]
                }
              },
              {
                type: "box",
                payload: [
                  {type: "color", ch: {value: "#00000000"}}
                ]
              }
            ]
          }
        ],
        global: [],
        axes: null,
        tags: {
          flicker: {
            char: [
              {
                d: "3 sharp ON/OFF pulses; off-dips 10/6/12ms; ON-phases 12/24ms; settle at 100ms.",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", 0.03]}, t1: {time: ["start", 0.031]}, easing: "linear",
                          v0: 1, v1: 0
                        },
                        {
                          t0: {time: ["start", 0.031]}, t1: {time: ["start", 0.041]}, easing: "linear",
                          v0: 0, v1: 0
                        },
                        {
                          t0: {time: ["start", 0.041]}, t1: {time: ["start", 0.042]}, easing: "linear",
                          v0: 0, v1: 1
                        },
                        {
                          t0: {time: ["start", 0.042]}, t1: {time: ["start", 0.054]}, easing: "linear",
                          v0: 1, v1: 1
                        },
                        {
                          t0: {time: ["start", 0.054]}, t1: {time: ["start", 0.055]}, easing: "linear",
                          v0: 1, v1: 0
                        },
                        {
                          t0: {time: ["start", 0.055]}, t1: {time: ["start", 0.061]}, easing: "linear",
                          v0: 0, v1: 0
                        },
                        {
                          t0: {time: ["start", 0.061]}, t1: {time: ["start", 0.062]}, easing: "linear",
                          v0: 0, v1: 1
                        },
                        {
                          t0: {time: ["start", 0.062]}, t1: {time: ["start", 0.086]}, easing: "linear",
                          v0: 1, v1: 1
                        },
                        {
                          t0: {time: ["start", 0.086]}, t1: {time: ["start", 0.087]}, easing: "linear",
                          v0: 1, v1: 0
                        },
                        {
                          t0: {time: ["start", 0.087]}, t1: {time: ["start", 0.099]}, easing: "linear",
                          v0: 0, v1: 0
                        },
                        {
                          t0: {time: ["start", 0.099]}, t1: {time: ["start", 0.1]}, easing: "linear", v0: 0,
                          v1: 1
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "template-017-sub",
      label: "Zest",
      tpl: "template-017-sub",
      name: "Zest",
      grade: "draft",
      category: "highlights",
      tags: ["scale", "fade", "focus", "serif-accent"],
      note: "Focus emphasis where non-highlighted words fully fade out. Copy of emphasisThree.",
      paint: {
        font: "Inter", weight: 400, bold: true, italic: false, color: "#FFF700", align: "center", lh: 88,
        spacing: -6, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20, plate: "line",
        outline: false, outlineColor: "#000000", outlineW: 0, shadow: false, activeColor: "#FFF700",
        shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {font: "Jacquard 24", spacing: -0.08, bold: false, color: "#FFF700"},
      dhs: null,
      caps: {
        styleType: "animation", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: false, usesOwnHighlighting: false, ignoreEmphasisEnabled: false,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "animation", wordVisibility: "transient", maxLines: 1, wrapWidth: 0.15, size: 0.033,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null,
        lineTransform: "newlineOnHighlight", lineTransformCondition: null, sizeAlgorithm: null,
        sizeParams: null, perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: null,
        responsiveAxes: null, itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted word with dynamic styles",
            when: {
              type: "and",
              rules: [
                {type: "rank", operator: "gte", value: "highlighted"},
                {
                  type: "or",
                  rules: [
                    {type: "featureFlag", name: "dynamicHighlights"},
                    {type: "position", field: "itemIndex", operator: "neq", value: 0, modulo: 3}
                  ]
                }
              ]
            },
            apply: {tags: ["fadeIn", "scaleIn"], scale: [2, 2]}
          },
          {
            name: "Non-highlighted word (fallback)", when: {type: "constant", value: true},
            apply: {tags: ["fadeOut"]}
          }
        ]
      },
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [
          {
            d: "",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {t0: {progress: 0}, t1: {progress: 0.01}, easing: "linear", v0: 0, v1: 1}
                  ]
                }
              }
            ]
          }
        ],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          fadeIn: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0.001}, t1: {progress: 0.01}, easing: "cubicIn", v0: 0, v1: 1}
                      ]
                    }
                  }
                ]
              }
            ]
          },
          scaleIn: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "scale",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.01}, easing: "cubicIn", v0: [0, 0], v1: [2, 2]}
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "template-029-sub",
      label: "Blaze",
      tpl: "template-029-sub",
      name: "Blaze",
      grade: "example",
      category: "text-behind",
      tags: ["per-line-scale", "dynamic-color"],
      note: "emphasisTen fork experimenting with newlineOnHighlight + per-line highlight scales on all aspects (depth-style without depth axes separation on landscape).",
      paint: {
        font: "Just Me Again Down Here", weight: 400, bold: false, italic: false, color: "#FFFFFF",
        align: "center", lh: 110, spacing: 2, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0,
        pad: 20, plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: false,
        activeColor: "#FFC200", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {font: "BBH Bartle", spacing: -0.03, color: "#FFC200"},
      dhs: null,
      caps: {
        styleType: "depth", usesDepthLayout: true, hasCharacterAnimations: false, usesDynamicColor: true,
        usesOwnHighlighting: true, ignoreEmphasisEnabled: false, requiresMeasurements: true,
        usesBlendModes: false, usesHideBehindForeground: false, usesMaskFill: false,
        supportsLineReflow: false
      },
      layout: {
        styleType: "depth",
        wordVisibility: "persistent",
        maxLines: 2,
        wrapWidth: 0.53,
        size: 0.035,
        textWrap: "nowrap",
        lineHeightAdjustmentMode: "glyphheight",
        textPositioningMode: null,
        lineTransform: "greedyLineBreak",
        lineTransformCondition: null,
        sizeAlgorithm: null,
        sizeParams: null,
        perWordSizeAlgorithm: "calculatePerLineHighlightScales",
        perWordSizeParams: {minScale: 0.1, maxScale: 5, targetFillRatio: 0.4},
        lineAnnotation: {
          highlightedAxis: "top", unhighlightedAxis: "top", highlightedAlign: "lowerBound",
          unhighlightedAlign: "lowerBound", skipInPreview: true
        },
        responsiveAxes: {
          top: {landscape: [0, -0.1], portrait: [0, -0.05]},
          bottom: {landscape: [0, -0.3], portrait: [0, -0.25]}
        },
        itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "wordIndex", operator: "gte", value: 1},
                {
                  type: "or",
                  rules: [
                    {
                      type: "and",
                      rules: [
                        {type: "text", field: "totalWords", operator: "eq", value: 1},
                        {type: "position", field: "wordIndex", operator: "eq", value: 0}
                      ]
                    },
                    {
                      type: "and",
                      rules: [
                        {type: "text", field: "totalWords", operator: "eq", value: 2},
                        {
                          type: "allWordsMatch", quantifier: "every", field: "length", operator: "gt",
                          value: 4
                        },
                        {type: "position", field: "wordIndex", operator: "lte", value: 1}
                      ]
                    },
                    {
                      type: "and",
                      rules: [
                        {type: "text", field: "totalWords", operator: "gte", value: 3},
                        {type: "wordAtIndex", index: 0, field: "length", operator: "lte", value: 4},
                        {type: "position", field: "wordIndex", operator: "lte", value: 3}
                      ]
                    },
                    {
                      type: "and",
                      rules: [
                        {type: "text", field: "totalWords", operator: "gte", value: 3},
                        {type: "wordAtIndex", index: 0, field: "length", operator: "gt", value: 4},
                        {type: "position", field: "wordIndex", operator: "lte", value: 2}
                      ]
                    }
                  ]
                }
              ]
            },
            apply: {
              tags: ["scaleUp", "highlightBounce", "softShadow"], rank: "highlighted",
              letterCasing: "uppercase"
            }
          },
          {
            name: "Non highlighted text", when: {type: "constant", value: true},
            apply: {tags: ["softShadow", "wordPop"], rank: "accessible"}
          }
        ]
      },
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [],
        line: [
          {d: "No line animations", p: []}
        ],
        char: [],
        global: [],
        axes: {
          top: {pos: [0, -0.1], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"},
          bottom: {pos: [0, -0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"}
        },
        tags: {
          fadeInWithLine: {
            line: [
              {
                d: "Fades each line in one by one",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.08]}, t1: {time: ["start", 0.24]}, easing: "expoOut",
                          v0: 0, v1: 1
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          },
          wordPop: {
            word: [
              {
                d: "Quick per-word fade-in (snap pop) anchored to each word's start time",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.04]}, t1: {time: ["start", 0.06]}, easing: "quadOut",
                          v0: 0, v1: 1
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          },
          softShadow: {
            word: [
              {
                d: "Soft, slightly diffused shadow",
                p: [
                  {
                    type: "shadow", size: {value: 0.022}, color: {value: "#00000099"},
                    offset: {value: [0.004, 0.014]}
                  }
                ]
              }
            ]
          },
          highlightBounce: {
            word: [
              {
                d: "Subtle rise + blur-to-clear + fade-in for highlighted entrance",
                p: [
                  {
                    type: "position",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.32]}, t1: {time: ["start", 0.32]}, easing: "quartOut",
                          v0: [0, -0.4], v1: [0, 0]
                        }
                      ]
                    },
                    impactLayout: false
                  },
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.32]}, t1: {time: ["start", 0.32]}, easing: "quartOut",
                          v0: 0, v1: 1
                        }
                      ]
                    }
                  },
                  {
                    type: "blur",
                    size: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.32]}, t1: {time: ["start", 0.32]}, easing: "quartOut",
                          v0: 0.12, v1: 0
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          },
          scaleUp: {
            word: [
              {
                d: "Scales up highlighted word to wrapWidth via injected scale",
                p: [
                  {
                    type: "scale", ch: {value: {inject: "scale", source: "computedScale", fallback: 1}},
                    resolve: "compose", impactLayout: true
                  }
                ]
              }
            ],
            groupConsecutive: true
          }
        }
      }
    },

    {
      k: "emphasisThirteen",
      label: "Zen One",
      tpl: "emphasisZen",
      name: "Zen One",
      grade: "production",
      category: "highlights",
      tags: ["scale", "fade", "blur-effect", "serif-accent", "focus", "position-offset", "per-line-alignment"],
      note: "Zen-like reveal with alternating Inter/Playfair Display fonts, blur+fade+slide entrance from alternating sides, size hierarchy for highlighted words",
      paint: {
        font: "Inter", weight: 400, bold: false, italic: false, color: "#F5F0D0", align: "center", lh: 90,
        spacing: -4, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20, plate: "line",
        outline: false, outlineColor: "#000000", outlineW: 0, shadow: true, activeColor: "#F5F0D0",
        shDist: 0, shAngle: 0, shBlur: 40, shColor: "#00000066"
      },
      highlight: {color: "#F5F0D0"},
      dhs: null,
      caps: {
        styleType: "animation", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: false, usesOwnHighlighting: false, ignoreEmphasisEnabled: false,
        requiresMeasurements: true, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "animation", wordVisibility: "transient", maxLines: null, wrapWidth: 0.6, size: 0.05,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null,
        lineTransform: "eachHighlightInOwnLine", lineTransformCondition: null, sizeAlgorithm: null,
        sizeParams: null, perWordSizeAlgorithm: "calculatePerLineHighlightScales",
        perWordSizeParams: {minScale: 1, maxScale: 2, targetFillRatio: 1}, lineAnnotation: null,
        responsiveAxes: null, itemOverrides: null
      },
      rules: {
        base: {tags: ["fadeBlurIn"]},
        rules: [
          {
            name: "Playfair Display italic on odd-indexed words",
            when: {type: "position", field: "wordIndex", operator: "eq", value: 1, modulo: 2},
            apply: {font: "Playfair Display", italic: true}, continueMatching: true
          },
          {
            name: "Highlighted word — larger scale, slide from left (odd index)",
            when: {
              type: "and",
              rules: [
                {type: "rank", operator: "eq", value: "cue-max"},
                {type: "rank", operator: "gte", value: "highlighted"},
                {type: "position", field: "wordIndex", operator: "eq", value: 1, modulo: 2}
              ]
            },
            apply: {
              scale: 2, overwriteWithComputedScale: true, color: {source: "viralColor"},
              variant: {weight: 900}, tags: ["slideFromLeft"]
            },
            continueMatching: true
          },
          {
            name: "Highlighted word — slide from right (even)",
            when: {
              type: "and",
              rules: [
                {type: "rank", operator: "eq", value: "cue-max"},
                {type: "rank", operator: "gte", value: "highlighted"},
                {type: "position", field: "wordIndex", operator: "eq", value: 0, modulo: 2}
              ]
            },
            apply: {
              scale: 2, overwriteWithComputedScale: true, color: {source: "viralColor"},
              variant: {weight: 900}, tags: ["slideFromRight"]
            },
            continueMatching: true
          },
          {
            name: "Left-align first third of lines", when: {type: "linePosition", position: "firstThird"},
            apply: {align: "left"}, continueMatching: true
          }
        ]
      },
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          fadeBlurIn: {
            word: [
              {
                d: "Fade and blur in (non-highlighted words)",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.16}, easing: "cubicOut", v0: 0, v1: 1}
                      ]
                    }
                  },
                  {
                    type: "blur",
                    size: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.2}, easing: "cubicOut", v0: 0.8, v1: 0}
                      ]
                    }
                  }
                ]
              }
            ]
          },
          slideFromLeft: {
            word: [
              {
                d: "Slide in from left with fade and blur (highlighted words)",
                p: [
                  {
                    type: "position",
                    ch: {
                      keyframes: [
                        {
                          t0: {progress: 0}, t1: {progress: 0.4}, easing: "cubicOut", v0: [-4, 0],
                          v1: [0, 0]
                        }
                      ]
                    }
                  },
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.3}, easing: "cubicOut", v0: 0, v1: 1}
                      ]
                    }
                  },
                  {
                    type: "blur",
                    size: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.4}, easing: "cubicOut", v0: 0.8, v1: 0}
                      ]
                    }
                  }
                ]
              }
            ]
          },
          slideFromRight: {
            word: [
              {
                d: "Slide in from right with fade and blur (highlighted words)",
                p: [
                  {
                    type: "position",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.4}, easing: "cubicOut", v0: [4, 0], v1: [0, 0]}
                      ]
                    }
                  },
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.3}, easing: "cubicOut", v0: 0, v1: 1}
                      ]
                    }
                  },
                  {
                    type: "blur",
                    size: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.4}, easing: "cubicOut", v0: 0.8, v1: 0}
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "emphasisTwelve",
      label: "Glass",
      tpl: "emphasisTwelve",
      name: "Glass",
      grade: "production",
      category: "highlights",
      tags: ["dynamic-color", "layered", "serif-accent"],
      note: "Highlight emphasis with all words visible",
      paint: {
        font: "Inter", weight: 400, bold: false, italic: false, color: "#FFFFFF", align: "center", lh: 100,
        spacing: -4, upper: "lower", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20,
        plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: true,
        activeColor: "#FFFFFF", shDist: 0, shAngle: 0, shBlur: 40, shColor: "#0000002F"
      },
      highlight: {color: "#FFFFFF"},
      dhs: null,
      caps: {
        styleType: "default", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: false, usesOwnHighlighting: true, ignoreEmphasisEnabled: true,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "default", wordVisibility: "persistent", maxLines: null, wrapWidth: 0.64, size: 0.026,
        textWrap: "nowrap", lineHeightAdjustmentMode: "glyphheight", textPositioningMode: null,
        lineTransform: null, lineTransformCondition: null, sizeAlgorithm: null, sizeParams: null,
        perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: {skipInPreview: true},
        responsiveAxes: null, itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Non-highlighted", when: {type: "constant", value: true},
            apply: {tags: [], rank: "accessible", letterCasing: "lowercase"}
          }
        ]
      },
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [
          {
            d: "Fade in animation",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {t0: {time: ["start", -0.2]}, t1: {time: ["start", 0]}, easing: "quadIn", v0: 0, v1: 1}
                  ]
                }
              }
            ]
          }
        ],
        line: [],
        char: [],
        global: [
          {
            d: "Blurred box, slight colour drop + padding and horizontal positioning hack that centers the box and makes it look nicer.",
            p: [
              {
                type: "box",
                payload: [
                  {type: "color", ch: {value: "#EAEAEA"}},
                  {type: "blur", size: {value: 0.6}},
                  {type: "padding", ch: {value: [0, -0.2]}},
                  {type: "position", ch: {value: [0, 0.15]}},
                  {type: "roundness", ch: {value: [0.7, 0.7, 0.7, 0.7]}}
                ]
              }
            ]
          }
        ],
        axes: null,
        tags: {}
      }
    },

    {
      k: "emphasisEight",
      label: "Handwritten",
      tpl: "emphasisEight",
      name: "Handwritten",
      grade: "production",
      category: "highlights",
      tags: ["glow-effect", "rotation", "handwritten"],
      note: "Glow and rotation emphasis, no fade-out",
      paint: {
        font: "Special Gothic Expanded One", weight: 400, bold: false, italic: false, color: "#FFFFFF",
        align: "center", lh: 130, spacing: -5, upper: "", mono: false, bg: "#000000", opacity: 0,
        corners: 0, pad: 20, plate: "line", outline: false, outlineColor: "#000000", outlineW: 0,
        shadow: false, activeColor: "#FFFFFF", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {font: "Indie Flower", spacing: -0.055, bold: false},
      dhs: null,
      caps: {
        styleType: "animation", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: false, usesOwnHighlighting: false, ignoreEmphasisEnabled: false,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "animation", wordVisibility: "persistent", maxLines: null, wrapWidth: 0.48, size: 0.036,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null,
        lineTransform: "greedyLineBreak", lineTransformCondition: null, sizeAlgorithm: null,
        sizeParams: null, perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: null,
        responsiveAxes: null, itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted word",
            when: {
              type: "and",
              rules: [
                {type: "rank", operator: "gte", value: "highlighted"}
              ]
            },
            apply: {tags: ["highlight"]}
          }
        ]
      },
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          highlight: {
            word: [
              {
                d: "Applies Indie Flower font with pulsing white glow (shadow + blur) on entire word",
                p: [
                  {type: "font", value: "Indie Flower"},
                  {type: "scale", ch: {value: 2}},
                  {type: "spacing", ch: {value: -0.064}},
                  {
                    type: "shadow",
                    size: {
                      keyframes: [
                        {t0: {progress: -0.5}, t1: {progress: 0.65}, easing: "quadOut", v0: 0.6, v1: 0.6},
                        {t0: {progress: 0.65}, t1: {progress: 2}, easing: "quadOut", v0: 0.6, v1: 0.05}
                      ]
                    },
                    color: {value: "#FFFFFF"},
                    offset: {value: [0, 0]}
                  },
                  {
                    type: "rotation",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.112}, easing: "quadOut", v0: 0, v1: 0.95},
                        {
                          t0: {progress: 0.112}, t1: {progress: 0.223}, easing: "quadOut", v0: 0.95,
                          v1: -0.95
                        },
                        {
                          t0: {progress: 0.223}, t1: {progress: 0.335}, easing: "quadOut", v0: -0.95,
                          v1: 0.75
                        },
                        {
                          t0: {progress: 0.335}, t1: {progress: 0.446}, easing: "quadOut", v0: 0.75,
                          v1: -0.75
                        },
                        {
                          t0: {progress: 0.446}, t1: {progress: 0.558}, easing: "quadOut", v0: -0.75,
                          v1: 0.55
                        },
                        {
                          t0: {progress: 0.558}, t1: {progress: 0.67}, easing: "quadOut", v0: 0.55,
                          v1: -0.55
                        },
                        {t0: {progress: 0.67}, t1: {progress: 0.781}, easing: "quadOut", v0: -0.55, v1: 0.4},
                        {t0: {progress: 0.781}, t1: {progress: 0.93}, easing: "quadOut", v0: 0.4, v1: 0}
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "emphasisNine",
      label: "Terminal",
      tpl: "emphasisNine",
      name: "Terminal",
      grade: "production",
      category: "highlights",
      tags: ["typewriter", "character-animation", "dynamic-color", "box-animation"],
      note: "Typewriter emphasis with box exit animation",
      paint: {
        font: "IBM Plex Mono", weight: 400, bold: false, italic: false, color: "#00FF41", align: "center",
        lh: 100, spacing: -3, upper: "", mono: true, bg: "#000000", opacity: 0, corners: 0, pad: 20,
        plate: "line", outline: true, outlineColor: "#000000", outlineW: 3, shadow: false,
        activeColor: "#00FF41", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {color: "#00FF41"},
      dhs: null,
      caps: {
        styleType: "character", usesDepthLayout: false, hasCharacterAnimations: true,
        usesDynamicColor: false, usesOwnHighlighting: true, ignoreEmphasisEnabled: true,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "character", wordVisibility: "transient", maxLines: null, wrapWidth: 0.64, size: 0.025,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null, lineTransform: null,
        lineTransformCondition: null, sizeAlgorithm: null, sizeParams: null, perWordSizeAlgorithm: null,
        perWordSizeParams: null, lineAnnotation: null, responsiveAxes: null, itemOverrides: null
      },
      rules: {rules: []},
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [
          {d: "", p: []}
        ],
        line: [
          {
            d: "",
            p: [
              {type: "variant", value: {weight: 500}},
              {
                type: "shadow", size: {value: 0.2},
                color: {value: {inject: "color", source: "accessibleColor"}}, offset: {value: [0, 0.01]}
              }
            ]
          }
        ],
        char: [
          {
            d: "",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {
                      t0: {time: ["start", -0.05]}, t1: {time: ["start", 0.02]}, easing: "quadOut", v0: 0,
                      v1: 1
                    }
                  ]
                }
              },
              {
                type: "box",
                payload: [
                  {type: "color", ch: {value: {inject: "color", source: "accessibleColor"}}},
                  {type: "color", ch: {value: "#DEDEDE"}, resolve: "compose"},
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.05]}, t1: {time: ["start", 0.02]}, easing: "quadOut",
                          v0: 0, v1: 1
                        },
                        {
                          t0: {
                            max: [
                              {time: ["end", -0.07]},
                              {time: ["start", 0.02]}
                            ]
                          },
                          t1: {
                            max: [
                              {time: ["end", 0]},
                              {time: ["start", 0.025]}
                            ]
                          },
                          easing: "quadIn",
                          v0: 1,
                          v1: 0
                        }
                      ]
                    }
                  },
                  {type: "position", ch: {value: [1, 0]}},
                  {type: "roundness", ch: {value: [0.1, 0.1, 0.1, 0.1]}}
                ]
              }
            ]
          }
        ],
        global: [],
        axes: null,
        tags: {}
      }
    },

    {
      k: "emphasisTen",
      label: "Backdrop+",
      tpl: "emphasisTen",
      name: "Backdrop+",
      grade: "production",
      category: "text-behind",
      tags: ["depth", "dynamic-color", "layered", "uppercase-highlight", "bounce", "outline", "shadow"],
      note: "Backdrop+ depth layout with bounce-in highlights, outline and drop shadow on background text",
      paint: {
        font: "Unna", weight: 400, bold: false, italic: false, color: "#FFF600", align: "center", lh: 110,
        spacing: 2, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20, plate: "line",
        outline: false, outlineColor: "#000000", outlineW: 0, shadow: false, activeColor: "#FFF600",
        shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {font: "Anton", spacing: -0.03, color: "#FFF600"},
      dhs: null,
      caps: {
        styleType: "depth", usesDepthLayout: true, hasCharacterAnimations: false, usesDynamicColor: true,
        usesOwnHighlighting: true, ignoreEmphasisEnabled: false, requiresMeasurements: true,
        usesBlendModes: false, usesHideBehindForeground: true, usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "depth",
        wordVisibility: "persistent",
        maxLines: 1,
        wrapWidth: 0.8,
        size: 0.032,
        textWrap: "nowrap",
        lineHeightAdjustmentMode: "glyphheight",
        textPositioningMode: null,
        lineTransform: "splitByHighlight",
        lineTransformCondition: null,
        sizeAlgorithm: "calculateHighlightedTextScale",
        sizeParams: {minScale: 0.1, maxScale: 7},
        perWordSizeAlgorithm: null,
        perWordSizeParams: null,
        lineAnnotation: {
          highlightedAxis: "top", unhighlightedAxis: "bottom", highlightedAlign: "upperBound",
          unhighlightedAlign: "lowerBound", skipInPreview: true
        },
        responsiveAxes: {
          top: {landscape: [0, 0.3], portrait: [0, 0.35]},
          bottom: {landscape: [0, -0.3], portrait: [0, -0.25]}
        },
        itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted",
            when: {
              type: "or",
              rules: [
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 1},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 2},
                    {type: "allWordsMatch", quantifier: "every", field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "lte", value: 4},
                    {type: "position", field: "wordIndex", operator: "lte", value: 1}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                }
              ]
            },
            apply: {tags: ["hidden", "highlightBounce"], rank: "highlighted", letterCasing: "uppercase"}
          },
          {
            name: "Non highlighted text", when: {type: "constant", value: true},
            apply: {tags: ["outline", "dropShadow", "fadeInWithLine", "wt700"], rank: "accessible"}
          }
        ]
      },
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [],
        line: [
          {d: "No line animations", p: []}
        ],
        char: [],
        global: [],
        axes: {
          top: {pos: [0, 0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"},
          bottom: {pos: [0, -0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"}
        },
        tags: {
          fadeInWithLine: {
            line: [
              {
                d: "Fades each line in one by one",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.08]}, t1: {time: ["start", 0.24]}, easing: "expoOut",
                          v0: 0, v1: 1
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          },
          wt700: {
            word: [
              {
                d: "700 weight",
                p: [
                  {type: "variant", value: {weight: 700}}
                ]
              }
            ]
          },
          outline: {
            word: [
              {
                d: "apply outline",
                p: [
                  {type: "outline", size: {value: 0.02}, color: {value: "#000"}}
                ]
              }
            ]
          },
          dropShadow: {
            word: [
              {
                d: "apply dropShadow",
                p: [
                  {
                    type: "shadow", size: {value: 0.015}, color: {value: "#00000066"},
                    offset: {value: [0.01, 0.02]}
                  }
                ]
              }
            ]
          },
          highlightBounce: {
            word: [
              {
                d: "bounce the word in bottom to top",
                p: [
                  {
                    type: "position",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.08]}, t1: {time: ["start", 0.16]}, easing: "expoOut",
                          v0: [0, -3], v1: [0, 0]
                        }
                      ]
                    },
                    impactLayout: false
                  },
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", -0.08]}, t1: {time: ["start", 0.16]}, easing: "expoOut",
                          v0: 0, v1: 1
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          },
          hidden: {
            word: [
              {
                d: "Hidden text effect with color highlight",
                p: [
                  {type: "hideBehindForeground", value: "injectedHiddenUuid"},
                  {
                    type: "scale", ch: {value: {inject: "scale", source: "computedScale", fallback: 1}},
                    resolve: "override", impactLayout: true
                  }
                ]
              }
            ],
            groupConsecutive: true
          }
        }
      }
    },

    {
      k: "emphasisSeven",
      label: "Backdrop",
      tpl: "emphasisSeven",
      name: "Backdrop",
      grade: "production",
      category: "text-behind",
      tags: ["depth", "dynamic-color", "layered", "serif-accent"],
      note: "Depth layout emphasis with all words visible",
      paint: {
        font: "Instrument Serif", weight: 400, bold: false, italic: false, color: "#EEEEEE",
        align: "center", lh: 105, spacing: -3, upper: "lower", mono: false, bg: "#000000", opacity: 0,
        corners: 0, pad: 20, plate: "line", outline: false, outlineColor: "#000000", outlineW: 0,
        shadow: false, activeColor: "#E50914", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {font: "Instrument Serif", spacing: -0.08, color: "#E50914"},
      dhs: null,
      caps: {
        styleType: "depth", usesDepthLayout: true, hasCharacterAnimations: false, usesDynamicColor: true,
        usesOwnHighlighting: true, ignoreEmphasisEnabled: false, requiresMeasurements: true,
        usesBlendModes: false, usesHideBehindForeground: true, usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "depth",
        wordVisibility: "persistent",
        maxLines: null,
        wrapWidth: 0.72,
        size: 0.072,
        textWrap: "nowrap",
        lineHeightAdjustmentMode: "glyphheight",
        textPositioningMode: null,
        lineTransform: "splitByHighlight",
        lineTransformCondition: null,
        sizeAlgorithm: "calculateHighlightedTextScale",
        sizeParams: {minScale: 0.1, maxScale: 7},
        perWordSizeAlgorithm: null,
        perWordSizeParams: null,
        lineAnnotation: {
          highlightedAxis: "top", unhighlightedAxis: "bottom", highlightedAlign: "upperBound",
          unhighlightedAlign: "lowerBound", skipInPreview: true
        },
        responsiveAxes: {
          top: {landscape: [0, 0.3], portrait: [0, 0.35]},
          bottom: {landscape: [0, -0.3], portrait: [0, -0.25]}
        },
        itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted",
            when: {
              type: "or",
              rules: [
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 1},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "eq", value: 2},
                    {type: "allWordsMatch", quantifier: "every", field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "lte", value: 4},
                    {type: "position", field: "wordIndex", operator: "lte", value: 1}
                  ]
                },
                {
                  type: "and",
                  rules: [
                    {type: "text", field: "totalWords", operator: "gte", value: 3},
                    {type: "text", field: "totalWords", operator: "lte", value: 6},
                    {type: "wordAtIndex", index: 0, field: "length", operator: "gt", value: 4},
                    {type: "position", field: "wordIndex", operator: "eq", value: 0}
                  ]
                }
              ]
            },
            apply: {tags: ["hidden"], rank: "highlighted"}
          },
          {
            name: "Non-highlighted", when: {type: "constant", value: true},
            apply: {tags: ["shadow"], rank: "accessible"}
          }
        ]
      },
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [
          {
            d: "Fade in animation",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {t0: {time: ["start", -0.01]}, t1: {time: ["start", 0]}, easing: "linear", v0: 0, v1: 1}
                  ]
                }
              }
            ]
          }
        ],
        line: [
          {d: "No line animations", p: []}
        ],
        char: [],
        global: [],
        axes: {
          top: {pos: [0, 0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"},
          bottom: {pos: [0, -0.3], dir: [1, 0], unit: "screenCoord", frameOfReference: "relative"}
        },
        tags: {
          hidden: {
            word: [
              {
                d: "Hidden text effect with color highlight and shadow",
                p: [
                  {
                    type: "scale", ch: {value: {inject: "scale", source: "computedScale", fallback: 1}},
                    resolve: "override", impactLayout: true
                  },
                  {type: "color", ch: {value: {inject: "color", source: "highlightColor"}}},
                  {type: "hideBehindForeground", value: "injectedHiddenUuid"},
                  {
                    type: "shadow",
                    size: {value: 0.05},
                    color: {
                      value: {
                        inject: "color", source: "highlightColor", transform: "scaleOpacity",
                        transformParam: 0.8
                      }
                    },
                    offset: {value: [0, 0.05]}
                  }
                ]
              }
            ],
            groupConsecutive: true
          },
          shadow: {
            word: [
              {
                d: "Shadow effect for non-highlighted words",
                p: [
                  {
                    type: "shadow", size: {value: 0.08}, color: {value: "#0000007F"},
                    offset: {value: [0, 0]}
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "emphasisSix",
      label: "Whisper",
      tpl: "emphasisSix",
      name: "Whisper",
      grade: "production",
      category: "highlights",
      tags: ["blur-effect", "character-animation", "focus"],
      note: "Blur focus emphasis, no exit animations",
      paint: {
        font: "Epilogue", weight: 400, bold: true, italic: false, color: "#FFEA00", align: "center",
        lh: 100, spacing: -7, upper: "lower", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20,
        plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: false,
        activeColor: "#FFFFFF", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {color: "#FFFFFF"},
      dhs: null,
      caps: {
        styleType: "character", usesDepthLayout: false, hasCharacterAnimations: true,
        usesDynamicColor: false, usesOwnHighlighting: true, ignoreEmphasisEnabled: true,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "character", wordVisibility: "persistent", maxLines: null, wrapWidth: 0.44, size: 0.044,
        textWrap: "nowrap", lineHeightAdjustmentMode: "glyphheight", textPositioningMode: null,
        lineTransform: null, lineTransformCondition: null, sizeAlgorithm: null, sizeParams: null,
        perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: null, responsiveAxes: null,
        itemOverrides: null
      },
      rules: {rules: []},
      ir: {
        textTemplate: {lineHeightAdjustmentMode: "glyphheight", textWrap: "nowrap"},
        word: [
          {
            d: "",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {
                      t0: {time: ["start", -0.6]}, t1: {time: ["start", 0.12]}, easing: "quadOut", v0: 0,
                      v1: 1
                    }
                  ]
                }
              },
              {
                type: "scale",
                ch: {
                  keyframes: [
                    {
                      t0: {time: ["start", -0.6]}, t1: {time: ["start", 0.12]}, easing: "quadOut",
                      v0: [0, 0], v1: [1, 1]
                    }
                  ]
                }
              }
            ]
          }
        ],
        line: [],
        char: [
          {
            d: "",
            p: [
              {
                type: "blur",
                size: {
                  keyframes: [
                    {
                      t0: {time: ["start", -0.6]}, t1: {time: ["start", 0.12]}, easing: "quadOut", v0: 1.2,
                      v1: 0
                    }
                  ]
                }
              }
            ]
          }
        ],
        global: [],
        axes: null,
        tags: {}
      }
    },

    {
      k: "emphasisFive",
      label: "Fusion",
      tpl: "emphasisFive",
      name: "Fusion",
      grade: "production",
      category: "text-behind",
      tags: ["blend-mode", "box-animation", "dynamic-color", "full-screen"],
      note: "Scale and alpha entrance, words never fade out",
      paint: {
        font: "Archivo Black", weight: 400, bold: false, italic: false, color: "#FFFFFF", align: "center",
        lh: 90, spacing: -8, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20,
        plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: false,
        activeColor: "#FFFFFF", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: null,
      dhs: null,
      caps: {
        styleType: "blend", usesDepthLayout: false, hasCharacterAnimations: false, usesDynamicColor: false,
        usesOwnHighlighting: false, ignoreEmphasisEnabled: false, requiresMeasurements: true,
        usesBlendModes: true, usesHideBehindForeground: false, usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "blend", wordVisibility: "persistent", maxLines: null, wrapWidth: 0.36, size: 0.04,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null, lineTransform: null,
        lineTransformCondition: null, sizeAlgorithm: null, sizeParams: null, perWordSizeAlgorithm: null,
        perWordSizeParams: null, lineAnnotation: null, responsiveAxes: null, itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted - long sentence (difference blend)",
            when: {
              type: "and",
              rules: [
                {type: "rank", operator: "eq", value: "cue-max"},
                {type: "rank", operator: "gte", value: "highlighted"},
                {type: "text", field: "totalWords", operator: "gt", value: 1}
              ]
            },
            apply: {tags: ["wordScaleSmall", "blend-mode"], color: {source: "accessibleColor"}, spacing: 0}
          }
        ]
      },
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [
          {
            d: "Fast fade-in with stable scale",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {t0: {progress: 0}, t1: {progress: 0.01}, easing: "linear", v0: 0, v1: 1}
                  ]
                }
              },
              {type: "scale", ch: {value: 1}}
            ]
          }
        ],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          "blend-mode": {
            word: [
              {
                d: "Applies difference blend mode to the text",
                p: [
                  {type: "blendingMode", ch: {value: "difference"}}
                ]
              }
            ]
          },
          "blend-mode-multiply": {
            word: [
              {
                d: "Applies multiply blend mode to the text",
                p: [
                  {type: "blendingMode", ch: {value: "multiply"}}
                ]
              }
            ]
          },
          "big-box": {
            word: [
              {
                d: "Adds a massive black background box scaled to 10000x to cover the entire screen",
                p: [
                  {
                    type: "box",
                    payload: [
                      {type: "color", ch: {value: {inject: "color", source: "highlightColor"}}},
                      {type: "scale", ch: {value: 10000}}
                    ]
                  }
                ]
              }
            ]
          },
          wordScaleBig: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "scale", ch: {value: {inject: "scale", source: "computedScale", fallback: 2}},
                    impactLayout: false
                  },
                  {
                    type: "scale",
                    ch: {
                      keyframes: [
                        {
                          t0: {progress: 0}, t1: {progress: 8}, easing: "linear", v0: 1,
                          v1: 0.8356545961002786
                        }
                      ]
                    },
                    resolve: "compose",
                    impactLayout: false
                  }
                ]
              }
            ]
          },
          wordScaleSmall: {
            word: [
              {
                d: "",
                p: [
                  {type: "scale", ch: {value: 2.2}}
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "emphasisThree",
      label: "Glide",
      tpl: "emphasisThree",
      name: "Glide",
      grade: "production",
      category: "highlights",
      tags: ["scale", "fade", "focus", "serif-accent"],
      note: "Focus emphasis where non-highlighted words fully fade out",
      paint: {
        font: "Inter", weight: 400, bold: true, italic: false, color: "#FFFFFF", align: "center", lh: 80,
        spacing: -6, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20, plate: "line",
        outline: false, outlineColor: "#000000", outlineW: 0, shadow: true, activeColor: "#FFFFFF",
        shDist: 0, shAngle: 0, shBlur: 10, shColor: "#FFFFFF"
      },
      highlight: {font: "Pinyon Script", spacing: 0.00001, bold: false, color: "#FFFFFF"},
      dhs: null,
      caps: {
        styleType: "animation", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: false, usesOwnHighlighting: false, ignoreEmphasisEnabled: false,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "animation", wordVisibility: "transient", maxLines: null, wrapWidth: 0.44, size: 0.06,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null, lineTransform: null,
        lineTransformCondition: null, sizeAlgorithm: null, sizeParams: null, perWordSizeAlgorithm: null,
        perWordSizeParams: null, lineAnnotation: null, responsiveAxes: null, itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Highlighted word with dynamic styles",
            when: {
              type: "and",
              rules: [
                {type: "rank", operator: "gte", value: "highlighted"},
                {
                  type: "or",
                  rules: [
                    {type: "featureFlag", name: "dynamicHighlights"},
                    {type: "position", field: "itemIndex", operator: "neq", value: 0, modulo: 3}
                  ]
                }
              ]
            },
            apply: {tags: ["fadeIn", "scaleIn"], scale: [2, 2]}
          },
          {
            name: "Non-highlighted word (fallback)", when: {type: "constant", value: true},
            apply: {tags: ["fadeOut"]}
          }
        ]
      },
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [
          {
            d: "",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {t0: {progress: 0}, t1: {progress: 0.01}, easing: "linear", v0: 0, v1: 1}
                  ]
                }
              }
            ]
          }
        ],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          fadeIn: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0.01}, t1: {progress: 0.1}, easing: "cubicIn", v0: 0, v1: 1}
                      ]
                    }
                  }
                ]
              }
            ]
          },
          scaleIn: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "scale",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.01}, easing: "cubicIn", v0: [0, 0], v1: [1, 1]}
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "emphasisOne",
      label: "Glide2",
      tpl: "emphasisOne",
      name: "Glide2",
      grade: "production",
      category: "highlights",
      tags: ["scale", "fade", "color-highlight", "serif-accent", "dynamic-color"],
      note: "Scale-in + fade-in emphasis with highlighted word enlargement",
      paint: {
        font: "Inter", weight: 400, bold: true, italic: false, color: "#FFFFFF", align: "center", lh: 84,
        spacing: -4, upper: "lower", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20,
        plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: false,
        activeColor: "#96FF1A", shDist: 12, shAngle: 90, shBlur: 24, shColor: "#000000CC"
      },
      highlight: {font: "Pinyon Script", spacing: 0.00001, bold: false, color: "#96FF1A"},
      dhs: null,
      caps: {
        styleType: "animation", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: true, usesOwnHighlighting: false, ignoreEmphasisEnabled: false,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "animation", wordVisibility: "persistent", maxLines: null, wrapWidth: 0.4, size: 0.036,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null,
        lineTransform: "greedyLineBreak", lineTransformCondition: null, sizeAlgorithm: null,
        sizeParams: null, perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: null,
        responsiveAxes: null, itemOverrides: null
      },
      rules: {
        base: {tags: ["wordScaleIn", "wordFadeIn"], letterCasing: "lowercase"},
        rules: [
          {
            name: "Highlighted word with dynamic styles",
            when: {
              type: "and",
              rules: [
                {type: "rank", operator: "gte", value: "highlighted"},
                {
                  type: "or",
                  rules: [
                    {type: "featureFlag", name: "dynamicHighlights"},
                    {type: "position", field: "itemIndex", operator: "neq", value: 0, modulo: 3}
                  ]
                }
              ]
            },
            apply: {tags: ["wordScaleIn", "wordFadeIn"], scale: [1.68, 1.68], addDynamicColorTag: true}
          }
        ]
      },
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          wordScaleIn: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "scale",
                    ch: {
                      keyframes: [
                        {
                          t0: {progress: 0}, t1: {progress: 0.01}, easing: "cubicOut", v0: [0, 0],
                          v1: [1, 1]
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          },
          wordFadeIn: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.16}, easing: "cubicOut", v0: 0, v1: 1}
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "emphasisTwo",
      label: "Pulse",
      tpl: "emphasisTwo",
      name: "Pulse",
      grade: "production",
      category: "highlights",
      tags: ["scale", "fade", "cyclic", "position-driven", "pattern-based"],
      note: "Fade emphasis with explicit fadeOut animations",
      paint: {
        font: "Libre Caslon Text", weight: 400, bold: true, italic: false, color: "#FFFFFF",
        align: "center", lh: 100, spacing: -8, upper: "", mono: false, bg: "#000000", opacity: 0,
        corners: 0, pad: 20, plate: "line", outline: true, outlineColor: "#000000", outlineW: 6,
        shadow: true, activeColor: "#FFFFFF", shDist: 0, shAngle: 0, shBlur: 17, shColor: "#000000"
      },
      highlight: null,
      dhs: null,
      caps: {
        styleType: "animation", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: false, usesOwnHighlighting: false, ignoreEmphasisEnabled: false,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "animation", wordVisibility: "transient", maxLines: null, wrapWidth: 0.64, size: 0.036,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null,
        lineTransform: "greedyLineBreak", lineTransformCondition: null, sizeAlgorithm: null,
        sizeParams: null, perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: null,
        responsiveAxes: null, itemOverrides: null
      },
      rules: {
        rules: [
          {
            name: "Position 0-1, highlighted",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "itemIndex", operator: "lt", value: 2, modulo: 6},
                {type: "rank", operator: "eq", value: "cue-max"},
                {type: "rank", operator: "gte", value: "highlighted"}
              ]
            },
            apply: {tags: ["wordScaleIn01", "wordFadeOut"], scale: 2.4, scaleImpactLayout: true}
          },
          {
            name: "Position 0-1, not highlighted",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "itemIndex", operator: "lt", value: 2, modulo: 6},
                {type: "rank", operator: "neq", value: "cue-max"},
                {type: "rank", operator: "lt", value: "highlighted"}
              ]
            },
            apply: {tags: ["wordScaleInOut", "wordFadeOut"], scale: 2.4, scaleImpactLayout: true}
          },
          {
            name: "Position 2-3, highlighted",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "itemIndex", operator: "gte", value: 2, modulo: 6},
                {type: "position", field: "itemIndex", operator: "lt", value: 4, modulo: 6},
                {type: "rank", operator: "eq", value: "cue-max"},
                {type: "rank", operator: "gte", value: "highlighted"}
              ]
            },
            apply: {tags: ["wordScaleInNormal", "wordScaleIn01"], scale: 2.4, scaleImpactLayout: true}
          },
          {
            name: "Position 2-3, not highlighted",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "itemIndex", operator: "gte", value: 2, modulo: 6},
                {type: "position", field: "itemIndex", operator: "lt", value: 4, modulo: 6},
                {type: "rank", operator: "neq", value: "cue-max"},
                {type: "rank", operator: "lt", value: "highlighted"}
              ]
            },
            apply: {tags: ["wordScaleInNormal"]}
          },
          {
            name: "Position 4, highlighted",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "itemIndex", operator: "eq", value: 4, modulo: 6},
                {type: "rank", operator: "eq", value: "cue-max"},
                {type: "rank", operator: "gte", value: "highlighted"}
              ]
            },
            apply: {tags: ["wordScaleInOut", "wordFadeOut"], scale: 2.4, scaleImpactLayout: true}
          },
          {
            name: "Position 4, not highlighted",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "itemIndex", operator: "eq", value: 4, modulo: 6},
                {type: "rank", operator: "neq", value: "cue-max"},
                {type: "rank", operator: "lt", value: "highlighted"}
              ]
            },
            apply: {tags: ["wordScaleInNormal", "wordFadeOut"]}
          },
          {
            name: "Position 5, highlighted",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "itemIndex", operator: "eq", value: 5, modulo: 6},
                {type: "rank", operator: "eq", value: "cue-max"}
              ]
            },
            apply: {tags: ["wordScaleInNormal", "wordScaleIn01"], scale: 2.4, scaleImpactLayout: true}
          },
          {
            name: "Position 5, not highlighted",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "itemIndex", operator: "eq", value: 5, modulo: 6},
                {type: "rank", operator: "neq", value: "cue-max"}
              ]
            },
            apply: {tags: ["wordScaleInNormal"]}
          }
        ]
      },
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [
          {
            d: "",
            p: [
              {
                type: "alpha",
                ch: {
                  keyframes: [
                    {t0: {progress: 0}, t1: {progress: 0.16}, easing: "cubicIn", v0: 0, v1: 1}
                  ]
                }
              }
            ]
          }
        ],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          wordFadeOut: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "alpha",
                    ch: {
                      keyframes: [
                        {t0: {progress: 1}, t1: {progress: 2}, easing: "cubicIn", v0: 1, v1: 0.2}
                      ]
                    }
                  }
                ]
              }
            ]
          },
          wordScaleInOut: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "scale",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.16}, easing: "cubicIn", v0: 0, v1: 1},
                        {t0: {progress: 1}, t1: {progress: 2}, easing: "cubicIn", v0: 1, v1: 0.4167}
                      ]
                    }
                  }
                ]
              }
            ]
          },
          wordScaleIn01: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "scale",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.16}, easing: "cubicIn", v0: 0, v1: 1}
                      ]
                    }
                  }
                ]
              }
            ]
          },
          wordScaleInNormal: {
            word: [
              {
                d: "",
                p: [
                  {
                    type: "scale",
                    ch: {
                      keyframes: [
                        {t0: {progress: 0}, t1: {progress: 0.16}, easing: "cubicIn", v0: 0, v1: 1}
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    },

    {
      k: "emphasisFour",
      label: "Wiggle",
      tpl: "emphasisFour",
      name: "Wiggle",
      grade: "production",
      category: "highlights",
      tags: ["wiggle", "organic-motion", "position-offset"],
      note: "Wiggle emphasis with motion only, no alpha animations",
      paint: {
        font: "Lacquer", weight: 400, bold: false, italic: false, color: "#FFFFFF", align: "center",
        lh: 100, spacing: -6, upper: "", mono: false, bg: "#000000", opacity: 0, corners: 0, pad: 20,
        plate: "line", outline: false, outlineColor: "#000000", outlineW: 0, shadow: true,
        activeColor: "#FFD700", shDist: 2, shAngle: 90, shBlur: 40, shColor: "#000000"
      },
      highlight: {font: "Lacquer", spacing: 0.00001, bold: false, italic: false, color: "#FFD700"},
      dhs: null,
      caps: {
        styleType: "animation", usesDepthLayout: false, hasCharacterAnimations: false,
        usesDynamicColor: false, usesOwnHighlighting: false, ignoreEmphasisEnabled: false,
        requiresMeasurements: false, usesBlendModes: false, usesHideBehindForeground: false,
        usesMaskFill: false, supportsLineReflow: true
      },
      layout: {
        styleType: "animation", wordVisibility: "persistent", maxLines: null, wrapWidth: 0.55, size: 0.06,
        textWrap: "nowrap", lineHeightAdjustmentMode: null, textPositioningMode: null,
        lineTransform: "splitToWords", lineTransformCondition: null, sizeAlgorithm: null, sizeParams: null,
        perWordSizeAlgorithm: null, perWordSizeParams: null, lineAnnotation: null, responsiveAxes: null,
        itemOverrides: null
      },
      rules: {
        base: {tags: ["creepy-0"]},
        rules: [
          {
            name: "Middle word, even index - left offset",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "wordIndex", operator: "gt", value: 0},
                {type: "position", field: "wordIndex", operator: "lt", value: -1, relativeTo: "totalWords"},
                {type: "text", field: "totalWords", operator: "gte", value: 4},
                {type: "position", field: "wordIndex", operator: "eq", value: 0, modulo: 2}
              ]
            },
            apply: {tags: ["creepy-0", "left"]},
            continueMatching: true
          },
          {
            name: "Middle word, odd index - right offset",
            when: {
              type: "and",
              rules: [
                {type: "position", field: "wordIndex", operator: "gt", value: 0},
                {type: "position", field: "wordIndex", operator: "lt", value: -1, relativeTo: "totalWords"},
                {type: "text", field: "totalWords", operator: "gte", value: 4},
                {type: "position", field: "wordIndex", operator: "eq", value: 1, modulo: 2}
              ]
            },
            apply: {tags: ["creepy-0", "right"]},
            continueMatching: true
          }
        ]
      },
      ir: {
        textTemplate: {textWrap: "nowrap"},
        word: [],
        line: [],
        char: [],
        global: [],
        axes: null,
        tags: {
          left: {
            word: [
              {
                d: "Fixed offset position to the left",
                p: [
                  {type: "position", ch: {value: [-0.5, 0]}, impactLayout: false}
                ]
              }
            ]
          },
          right: {
            word: [
              {
                d: "Fixed offset position to the right",
                p: [
                  {type: "position", ch: {value: [0.5, 0]}, impactLayout: false}
                ]
              }
            ]
          },
          "creepy-0": {
            word: [
              {
                d: "Smooth organic wiggle with bezier curves - 8 segments",
                p: [
                  {
                    type: "position",
                    ch: {
                      keyframes: [
                        {
                          t0: {time: ["start", 0]},
                          t1: {time: ["start", 0.0625]},
                          easing: "sineInOut",
                          bezier: [
                            [0, 0],
                            [0.06, -0.04],
                            [-0.04, 0.06],
                            [-0.06, 0.02]
                          ]
                        },
                        {
                          t0: {time: ["start", 0.0625]},
                          t1: {time: ["start", 0.125]},
                          easing: "sineInOut",
                          bezier: [
                            [-0.06, 0.02],
                            [0.04, 0.06],
                            [0.06, -0.04],
                            [0.02, -0.06]
                          ]
                        },
                        {
                          t0: {time: ["start", 0.125]},
                          t1: {time: ["start", 0.1875]},
                          easing: "sineInOut",
                          bezier: [
                            [0.02, -0.06],
                            [-0.06, -0.02],
                            [0.04, 0.04],
                            [0.06, -0.02]
                          ]
                        },
                        {
                          t0: {time: ["start", 0.1875]},
                          t1: {time: ["start", 0.25]},
                          easing: "sineInOut",
                          bezier: [
                            [0.06, -0.02],
                            [-0.04, 0.02],
                            [0.02, -0.04],
                            [-0.05, 0.05]
                          ]
                        },
                        {
                          t0: {time: ["start", 0.25]},
                          t1: {time: ["start", 0.3125]},
                          easing: "sineInOut",
                          bezier: [
                            [-0.05, 0.05],
                            [0.05, -0.05],
                            [-0.03, -0.06],
                            [0.04, 0.03]
                          ]
                        },
                        {
                          t0: {time: ["start", 0.3125]},
                          t1: {time: ["start", 0.375]},
                          easing: "sineInOut",
                          bezier: [
                            [0.04, 0.03],
                            [-0.06, 0.04],
                            [0.05, -0.05],
                            [-0.04, -0.04]
                          ]
                        },
                        {
                          t0: {time: ["start", 0.375]},
                          t1: {time: ["start", 0.4375]},
                          easing: "sineInOut",
                          bezier: [
                            [-0.04, -0.04],
                            [0.06, 0.02],
                            [-0.05, 0.06],
                            [0.03, -0.03]
                          ]
                        },
                        {
                          t0: {time: ["start", 0.4375]},
                          t1: {time: ["start", 0.5]},
                          easing: "sineInOut",
                          bezier: [
                            [0.03, -0.03],
                            [-0.04, 0.02],
                            [0.02, -0.04],
                            [0, 0]
                          ]
                        }
                      ]
                    },
                    impactLayout: false
                  }
                ]
              }
            ]
          }
        }
      }
    }
  ];
  /* ==== 数据段 结束 ==== */

  /* ---------- 字体 ----------
     25 份用到的族**全在 Google Fonts 上**（第 72 轮那 8 份带进来的 7 个新族逐一核过：
     Instrument Serif / Gloock / Unna / Gloria Hallelujah / Just Me Again Down Here /
     Rubik Spray Paint / BBH Bartle，`css2?family=` 都返回真的 `@font-face`），
     所以不配替身；栈末尾一律挂中文字体——拉丁字体一个 CJK 字形都没有。 */
  const CJK = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC'";
  const F = (fam, kind) => ({fam, stack: "'" + fam + "', " + CJK + ', ' + kind});
  const FONTS = {
    'Anton': F('Anton', 'sans-serif'),
    'Inter': F('Inter', 'sans-serif'),
    'Montserrat': F('Montserrat', 'sans-serif'),
    'Epilogue': F('Epilogue', 'sans-serif'),
    'Archivo Black': F('Archivo Black', 'sans-serif'),
    'Bricolage Grotesque': F('Bricolage Grotesque', 'sans-serif'),
    'Special Gothic Expanded One': F('Special Gothic Expanded One', 'sans-serif'),
    'IBM Plex Mono': F('IBM Plex Mono', 'monospace'),
    'Libre Caslon Text': F('Libre Caslon Text', 'serif'),
    'Playfair Display': F('Playfair Display', 'serif'),
    'Pinyon Script': F('Pinyon Script', 'cursive'),
    'Indie Flower': F('Indie Flower', 'cursive'),
    'Ballet': F('Ballet', 'cursive'),
    'Jacquard 24': F('Jacquard 24', 'cursive'),
    'Lacquer': F('Lacquer', 'cursive'),
    // 第 72 轮：preset-seven 那 8 份带进来的
    'Instrument Serif': F('Instrument Serif', 'serif'),
    'Gloock': F('Gloock', 'serif'),
    'Unna': F('Unna', 'serif'),
    'Gloria Hallelujah': F('Gloria Hallelujah', 'cursive'),
    'Just Me Again Down Here': F('Just Me Again Down Here', 'cursive'),
    'Rubik Spray Paint': F('Rubik Spray Paint', 'cursive'),
    'BBH Bartle': F('BBH Bartle', 'sans-serif'),
  };
  const DEFAULT_FONT = F('Inter', 'sans-serif');
  function fontOf(name) { return FONTS[name] || DEFAULT_FONT; }
  /** 视图要往 `BaoCut.html` 的 Google Fonts link 与 `fonts.popular` 里加的族。 */
  function fontFamilies() { return Object.keys(FONTS); }

  /* ---------- 缓动 ----------
     第 71 轮起是**精确的 Penner 函数**，不再是 cubic-bezier 近似式。上一轮之所以存
     `cubic-bezier(...)` 字符串，是因为求值结果最终要落进 `@keyframes` 的
     `animation-timing-function`——CSS 只认那一种写法，于是连内联取帧也被迫走同一张表，
     `elasticOut` / `bounceOut` 这种一条三次贝塞尔装不下的只能退到 `quintOut`。
     canvas 每帧自己求值，没有这个约束：直接实现 easings.net 那一套闭式解，
     弹簧与回弹是它们本来的样子。

     键一律小写（`easeKey`）——数据里有 `Linear`（大写 L）与 `linear` 两种写法，
     匹配必须大小写不敏感，否则 `Linear` 那一份就会炸。
     `sin*` 是 `sine*` 的别名：两种拼法都认。 */
  const C1 = 1.70158, C2 = C1 * 1.525, C3 = C1 + 1, C4 = (2 * Math.PI) / 3, C5 = (2 * Math.PI) / 4.5;
  const N1 = 7.5625, D1 = 2.75;
  function bounceOut(p) {
    if (p < 1 / D1) return N1 * p * p;
    if (p < 2 / D1) return N1 * (p -= 1.5 / D1) * p + 0.75;
    if (p < 2.5 / D1) return N1 * (p -= 2.25 / D1) * p + 0.9375;
    return N1 * (p -= 2.625 / D1) * p + 0.984375;
  }
  const EASE = {
    linear: (p) => p,
    quadin: (p) => p * p,
    quadout: (p) => 1 - (1 - p) * (1 - p),
    quadinout: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
    cubicin: (p) => p * p * p,
    cubicout: (p) => 1 - Math.pow(1 - p, 3),
    cubicinout: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    quartin: (p) => p * p * p * p,
    quartout: (p) => 1 - Math.pow(1 - p, 4),
    quartinout: (p) => (p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2),
    quintin: (p) => Math.pow(p, 5),
    quintout: (p) => 1 - Math.pow(1 - p, 5),
    quintinout: (p) => (p < 0.5 ? 16 * Math.pow(p, 5) : 1 - Math.pow(-2 * p + 2, 5) / 2),
    expoin: (p) => (p === 0 ? 0 : Math.pow(2, 10 * p - 10)),
    expoout: (p) => (p === 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    expoinout: (p) => (p === 0 ? 0 : p === 1 ? 1 : p < 0.5
      ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
    sinein: (p) => 1 - Math.cos((p * Math.PI) / 2),
    sineout: (p) => Math.sin((p * Math.PI) / 2),
    sineinout: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
    circin: (p) => 1 - Math.sqrt(1 - p * p),
    circout: (p) => Math.sqrt(1 - Math.pow(p - 1, 2)),
    circinout: (p) => (p < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * p, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * p + 2, 2)) + 1) / 2),
    backin: (p) => C3 * p * p * p - C1 * p * p,
    backout: (p) => 1 + C3 * Math.pow(p - 1, 3) + C1 * Math.pow(p - 1, 2),
    backinout: (p) => (p < 0.5
      ? (Math.pow(2 * p, 2) * ((C2 + 1) * 2 * p - C2)) / 2
      : (Math.pow(2 * p - 2, 2) * ((C2 + 1) * (p * 2 - 2) + C2) + 2) / 2),
    elasticin: (p) => (p === 0 ? 0 : p === 1 ? 1
      : -Math.pow(2, 10 * p - 10) * Math.sin((p * 10 - 10.75) * C4)),
    elasticout: (p) => (p === 0 ? 0 : p === 1 ? 1
      : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * C4) + 1),
    elasticinout: (p) => (p === 0 ? 0 : p === 1 ? 1 : p < 0.5
      ? -(Math.pow(2, 20 * p - 10) * Math.sin((20 * p - 11.125) * C5)) / 2
      : (Math.pow(2, -20 * p + 10) * Math.sin((20 * p - 11.125) * C5)) / 2 + 1),
    bouncein: (p) => 1 - bounceOut(1 - p),
    bounceout: bounceOut,
    bounceinout: (p) => (p < 0.5 ? (1 - bounceOut(1 - 2 * p)) / 2 : (1 + bounceOut(2 * p - 1)) / 2),
    // 阶跃：`squareIn` 在整段里停在起点、`squareOut` 一开始就跳到终点
    squarein: () => 0,
    squareout: () => 1,
    squareinout: (p) => (p < 0.5 ? 0 : 1),
  };
  EASE.sinin = EASE.sinein; EASE.sinout = EASE.sineout; EASE.sininout = EASE.sineinout;
  const easeKey = (n) => String(n || 'linear').toLowerCase();
  /** 缓动曲线在进度 `p` 上的值。表外的名字按 linear 走（认不出的东西一律丢而不抛）。 */
  function ease01(name, p) {
    const f = EASE[easeKey(name)];
    if (!f) return p;
    if (p <= 0) return f(0);
    if (p >= 1) return f(1);
    return f(p);
  }
  /** 二维三次贝塞尔上的点（`creepy-0` / `left` / `right` 那种 `bezier` 段用）。 */
  function bezierPoint(pts, u) {
    const a = (1 - u) * (1 - u) * (1 - u), b = 3 * (1 - u) * (1 - u) * u,
      c = 3 * (1 - u) * u * u, d = u * u * u;
    const out = [];
    for (let i = 0; i < pts[0].length; i++) {
      out.push(a * pts[0][i] + b * pts[1][i] + c * pts[2][i] + d * pts[3][i]);
    }
    return out;
  }

  /* ---------- 时间 ----------
     参考窗口：一个词 = `BEAT_MS`；一个字形簇 = `CHAR_MS`（= BEAT / 5，「参考词五个字形」，
     视图知道真词长时可以自己传）。窗口一律以 cue 起点为 0。 */
  const BEAT_MS = 620;
  const BEAT = BEAT_MS / 1000;
  const CHAR_MS = BEAT_MS / 5;
  const WIN = {
    word: {win: [0, BEAT], prev: [-BEAT, 0], cue: [0, BEAT]},
    char: {win: [0, CHAR_MS / 1000], prev: [-CHAR_MS / 1000, 0], cue: [0, BEAT]},
    line: {win: [0, BEAT], prev: [-BEAT, 0], cue: [0, BEAT]},
    global: {win: [0, BEAT], prev: [-BEAT, 0], cue: [0, BEAT]},
  };

  /** 十种 anchor ＋ progress ＋ min/max。返回**秒，以 cue 起点为 0**。
   *  `win` / `prev` / `cue` 都是 `[t0, t1]`；`seg` 给 `t0` / `prevT0` / `prevT1` 三种
   *  只有在段内才解得开的引用用（`{t0, prevT0, prevT1}`，可省）。
   *  progress **不 clamp**——数据里 `progress: -0.12`（词前）与 `progress: 2`（两倍词长）都在用。 */
  function resolveTime(def, win, prev, cue, seg) {
    const s = seg || {};
    if (!def || typeof def !== 'object') return NaN;
    if ('time' in def) {
      const anchor = def.time[0], off = def.time[1] || 0;
      let v;
      switch (anchor) {
        case 'start': v = win[0] + off; break;
        case 'end': v = win[1] + off; break;
        case 'prevStart': v = (prev ? prev[0] : win[0]) + off; break;
        case 'prevEnd': v = (prev ? prev[1] : win[1]) + off; break;
        case 'absoluteStart': return off;
        case 'absoluteEnd': return cue[1] - cue[0] + off;
        // `t0` 只能用来定义 `t1`——拿它定义 `t0` 时给 NaN
        case 't0': return s.t0 === undefined ? NaN : s.t0 + off;
        case 'prevT0':
          if (s.prevT0 === undefined) throw new Error('prevT0 用在了没有上一段的地方');
          return s.prevT0 + off;
        case 'prevT1':
          if (s.prevT1 === undefined) throw new Error('prevT1 用在了没有上一段的地方');
          return s.prevT1 + off;
        default: throw new Error('不认识的时间锚点：' + anchor);
      }
      return v - cue[0];
    }
    if ('progress' in def) return win[0] + (win[1] - win[0]) * def.progress - cue[0];
    if ('max' in def) {
      if (!def.max.length) throw new Error('`max` 要一个非空数组');
      return Math.max.apply(null, def.max.map((d) => resolveTime(d, win, prev, cue, s))
        .filter((x) => !isNaN(x)));
    }
    if ('min' in def) {
      if (!def.min.length) throw new Error('`min` 要一个非空数组');
      return Math.min.apply(null, def.min.map((d) => resolveTime(d, win, prev, cue, s))
        .filter((x) => !isNaN(x)));
    }
    throw new Error('时间定义必须有 time / progress / min / max 之一');
  }

  /* ---------- 通道 ----------
     规范化的时间那一半：解 t0 / t1、丢掉 NaN 与 `t0 >= t1` 的段、剩下全常量就塌缩。
     输出永远是 `{value}` 或 `{keyframes:[…]}`（键的别名 `interpolate` 统一叫
     `keyframes`——与数据段同名，免得同一件事两个名字）。 */
  function resolveChannel(ch, ctx) {
    if (!ch) return {};
    const cueColor = ctx.cueColor;
    const pick = (v) => (v === 'useTextColor' ? (cueColor || '#FFFFFF') : v);
    if ('value' in ch) return {value: pick(ch.value)};
    if (!ch.keyframes || !ch.keyframes.length) return {};
    const out = [];
    let pT0, pT1;
    ch.keyframes.forEach((f) => {
      const seg = {prevT0: pT0, prevT1: pT1};
      const t0 = resolveTime(f.t0, ctx.win, ctx.prev, ctx.cue, seg);
      if (isNaN(t0)) return;                                   // NaN 段丢弃，且不更新 prev
      const t1 = resolveTime(f.t1, ctx.win, ctx.prev, ctx.cue, {prevT0: pT0, prevT1: pT1, t0: t0});
      pT0 = t0; pT1 = t1;
      if (isNaN(t1) || t0 >= t1) return;                       // 倒序 / 零长段丢弃
      if (f.bezier) out.push({t0: t0, t1: t1, bezier: f.bezier, easing: f.easing || 'linear'});
      else out.push({t0: t0, v0: pick(f.v0), t1: t1, v1: pick(f.v1), easing: f.easing || 'linear'});
    });
    const c = constantOf(out);
    return c === null ? {keyframes: out} : {value: c};
  }
  function sameV(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
    return a === b;
  }
  /** 全常量就塌缩；带 `bezier` 的段永不算常量；空表不算常量（返回 `{}`）。 */
  function constantOf(frames) {
    if (!frames.length || frames.some((f) => 'bezier' in f)) return null;
    const v = frames[0].v0;
    for (let i = 0; i < frames.length; i++) {
      if (!sameV(frames[i].v0, frames[i].v1) || !sameV(frames[i].v0, v)) return null;
    }
    return v;
  }

  const lerp = (a, b, p) => a + (b - a) * p;
  function lerpV(a, b, p) {
    if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, p);
    if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => lerp(x, b[i], p));
    if (typeof a === 'string' && typeof b === 'string' && a[0] === '#') return lerpHex(a, b, p);
    return p < 1 ? a : b;
  }
  function parseHex(s) {
    let h = String(s).replace('#', '');
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
      h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const h2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  function toHex(r, g, b, a) {
    return '#' + h2(r) + h2(g) + h2(b) + (a >= 1 ? '' : h2(a * 255));
  }
  /** 两个颜色相乘（`resolve: "compose"` 的取法），alpha 也相乘。 */
  function mulHex(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a[0] !== '#' || b[0] !== '#') return b;
    const x = parseHex(a), y = parseHex(b);
    return toHex((x[0] * y[0]) / 255, (x[1] * y[1]) / 255, (x[2] * y[2]) / 255, x[3] * y[3]);
  }
  function lerpHex(a, b, p) {
    const x = parseHex(a), y = parseHex(b);
    return toHex(lerp(x[0], y[0], p), lerp(x[1], y[1], p), lerp(x[2], y[2], p), lerp(x[3], y[3], p));
  }

  /** 已解好的通道在 `t`（秒，cue 相对）上的值。窗口外取首末段的端点（CSS 的 `both`）。 */
  function sampleChannel(rc, t) {
    if (!rc) return undefined;
    if ('value' in rc) return rc.value;
    const ks = rc.keyframes;
    if (!ks || !ks.length) return undefined;
    if (t <= ks[0].t0) return valueAt(ks[0], 0);
    const last = ks[ks.length - 1];
    if (t >= last.t1) return valueAt(last, 1);
    for (let i = 0; i < ks.length; i++) {
      const f = ks[i];
      if (t >= f.t0 && t <= f.t1) return valueAt(f, (t - f.t0) / (f.t1 - f.t0));
      // 段与段之间的空档：停在上一段的末值
      if (t < f.t0) return valueAt(ks[i - 1] || f, 1);
    }
    return valueAt(last, 1);
  }
  function valueAt(f, p) {
    const e = ease01(f.easing, p);
    return f.bezier ? bezierPoint(f.bezier, e) : lerpV(f.v0, f.v1, e);
  }
  /** 这条通道上所有段的边界时刻（生成关键帧网格用）。 */
  function boundsOf(rc) {
    if (!rc || !rc.keyframes) return [];
    const out = [];
    rc.keyframes.forEach((f) => { out.push(f.t0); out.push(f.t1); });
    return out;
  }

  /* ---------- rank ----------
     1–10 的整数是真相，三个名字（accessible / highlighted / viral）是它的分档。 */
  const clampRank = (n) => (n === undefined ? 1 : Math.max(1, Math.min(10, Math.round(n))));
  const rankName = (n) => (n >= 10 ? 'viral' : n >= 6 ? 'highlighted' : 'accessible');
  const RANK_NUM = {accessible: 1, highlighted: 6, viral: 10};
  const RANK_TIER = {accessible: 0, highlighted: 1, viral: 2};
  const isRankName = (v) => Object.prototype.hasOwnProperty.call(RANK_NUM, v);
  function rankNum(v, allWords) {
    if (typeof v === 'number') return clampRank(v);
    if (v === 'cue-max') {
      if (!allWords || !allWords.length) return 1;
      return allWords.reduce((m, w) => (w.rank > m ? w.rank : m), allWords[0].rank);
    }
    if (v === 'cue-median') {
      if (!allWords || !allWords.length) return 1;
      const s = allWords.map((w) => w.rank).sort((a, b) => a - b);
      return Math.round((s[(allWords.length - 1) >> 1] + s[allWords.length >> 1]) / 2);
    }
    return RANK_NUM[v];
  }

  /* ---------- 谓词 ---------- */
  function cmp(a, op, b) {
    switch (op) {
      case 'eq': return a === b;
      case 'neq': return a !== b;
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      default: return false;
    }
  }
  /** 谓词能读的那八个字段。表外的一律 null（= 判假）。 */
  function fieldOf(name, w) {
    switch (name) {
      case 'wordIndex': return w.wordIndex;
      case 'lineIndex': return w.lineIndex;
      case 'itemIndex': return w.itemIndex;
      case 'wordIndexInLine': return w.wordIndexInLine;
      case 'wordLength': return w.wordLength;
      case 'wordsInLine': return w.wordsInLine;
      case 'totalWords': return w.totalWords;
      case 'totalLines': return w.totalLines;
      default: return null;
    }
  }
  const aboveAccessible = (w) => RANK_TIER[rankName(w.rank)] >= RANK_TIER.highlighted;
  /** 五条具名算法。 */
  const ALGORITHMS = {
    alternating: (w, p) => w.wordIndex % ((p && p.step) || 2) === 0,
    isShortSentenceHighlighted: (w) => w.totalWords <= 1 && w.allWords.some(aboveAccessible),
    checkShortSentenceMode: (w) => w.totalWords <= 1,
    highlightedWordCount: (w, p) => cmp(w.allWords.filter(aboveAccessible).length,
      (p && p.operator) || 'gte', p && p.value !== undefined ? p.value : 1),
    firstHalfLines: (w) => w.lineIndex < Math.ceil(w.totalLines / 2),
  };

  /** 十三种谓词，逐条。`opts.featureFlags` 缺省 `{dynamicHighlights: true}`。 */
  function evalPredicate(pred, w, opts) {
    if (!pred || typeof pred !== 'object') return false;
    const flags = (opts && opts.featureFlags) || {dynamicHighlights: true};
    switch (pred.type) {
      case 'rank': {
        if (w.rank === null || w.rank === undefined) return pred.operator === 'neq';
        // 三个名字之间比的是**档**（0/1/2），不是 1/6/10；`cue-max` 那种比的是数
        if (typeof pred.value === 'string' && isRankName(pred.value)) {
          return cmp(RANK_TIER[rankName(w.rank)], pred.operator, RANK_TIER[pred.value]);
        }
        const v = typeof pred.value === 'string' ? rankNum(pred.value, w.allWords) : pred.value;
        return cmp(w.rank, pred.operator, v);
      }
      case 'position': {
        let n = fieldOf(pred.field, w);
        if (n === null || n === undefined) return false;
        if (pred.modulo !== undefined && pred.modulo > 0) n %= pred.modulo;
        let v = pred.value;
        if (pred.relativeTo) {
          const base = fieldOf(pred.relativeTo, w);
          if (base === null || base === undefined) return false;
          v = base + pred.value;
        }
        return cmp(n, pred.operator, v);
      }
      case 'text': {
        const n = fieldOf(pred.field, w);
        return n === null || n === undefined ? false : cmp(n, pred.operator, pred.value);
      }
      case 'linePosition': {
        const third = Math.max(1, Math.floor(w.totalLines / 3));
        switch (pred.position) {
          case 'first': return w.lineIndex === 0;
          case 'last': return w.lineIndex === w.totalLines - 1;
          case 'middle': return w.lineIndex > 0 && w.lineIndex < w.totalLines - 1;
          case 'firstThird': return w.lineIndex < third;
          case 'lastThird': return w.lineIndex >= w.totalLines - third;
          case 'middleThird': return w.lineIndex >= third && w.lineIndex < w.totalLines - third;
          default: return false;
        }
      }
      case 'algorithm': {
        const fn = ALGORITHMS[pred.name];
        return fn ? !!fn(w, pred.params) : false;
      }
      case 'range': {
        const n = pred.field === 'rank' ? w.rank : fieldOf(pred.field, w);
        return n === null || n === undefined ? false : (n >= pred.min && n <= pred.max);
      }
      case 'constant': return !!pred.value;
      case 'featureFlag': return flags[pred.name] === undefined ? false : !!flags[pred.name];
      case 'wordAtIndex': {
        const t = w.allWords[pred.index];
        if (!t) return false;
        return pred.field === 'length' ? cmp(t.length, pred.operator, pred.value) : false;
      }
      case 'allWordsMatch': {
        const q = pred.quantifier === 'every' ? 'every' : 'some';
        return w.allWords[q]((t) => (pred.field === 'length'
          ? cmp(t.length, pred.operator, pred.value) : false));
      }
      case 'and': return (pred.rules || []).every((r) => evalPredicate(r, w, opts));
      case 'or': return (pred.rules || []).some((r) => evalPredicate(r, w, opts));
      case 'not': return !evalPredicate(pred.rule, w, opts);
      default: return false;
    }
  }

  /* ---------- 选词 ---------- */

  const textOf = (w) => String(typeof w === 'string' ? w : (w && w.text) || '');

  /** **演示 rank 口径**（见头部第 6 条）：最长的那个词 highlighted（并列取先），其余 accessible；
   *  `ignoreEmphasisEnabled` 的 preset 全员 accessible。确定性——同样的词表永远同样的结果。 */
  function demoRanks(preset, words) {
    if (preset.caps.ignoreEmphasisEnabled) return words.map(() => RANK_NUM.accessible);
    let best = -1, bi = -1;
    words.forEach((w, i) => { const L = textOf(w).length; if (L > best) { best = L; bi = i; } });
    return words.map((w, i) => (i === bi ? RANK_NUM.highlighted : RANK_NUM.accessible));
  }

  /** 一个词的谓词上下文。单行是默认口径，`ctx.lines` 给了就按行拆。
   *  `color` 是这个词**带进来的**色（AI 强调那一路给的），原型里没有那一路，所以默认 null；
   *  `ctx.colors` 给了就按位取——`addDynamicColorTag` 拿的就是它。 */
  function wordContexts(words, ranks, ctx) {
    const c = ctx || {};
    const lines = c.lines || [words.map((_, i) => i)];
    const at = new Map();
    lines.forEach((idxs, li) => idxs.forEach((gi, wi) => at.set(gi, [li, wi, idxs.length])));
    const all = words.map((w, i) => ({text: textOf(w), length: textOf(w).length, rank: ranks[i]}));
    return words.map((w, i) => {
      const p = at.get(i) || [0, i, words.length];
      return {
        rank: ranks[i], color: (c.colors && c.colors[i]) || null,
        itemIndex: c.itemIndex === undefined ? 0 : c.itemIndex,
        wordIndex: i, totalWords: words.length,
        lineIndex: p[0], totalLines: lines.length,
        wordIndexInLine: p[1], wordsInLine: p[2],
        wordText: textOf(w), wordLength: textOf(w).length,
        allWords: all,
      };
    });
  }

  /** 一条 apply 盖在累积结果上。**只有 `tags` 是累加**，其余全是覆盖。 */
  function mergeApply(acc, ap) {
    const out = Object.assign({}, acc);
    if (ap.tags !== undefined) out.tags = (acc.tags || []).concat(ap.tags);
    ['scale', 'scaleImpactLayout', 'font', 'spacing', 'bold', 'italic', 'color', 'rank',
      'addDynamicColorTag', 'letterCasing', 'variant', 'box', 'align', 'overwriteWithComputedScale']
      .forEach((k) => { if (ap[k] !== undefined) out[k] = ap[k]; });
    return out;
  }

  /** 跑规则、落成每词的属性。返回的 `tags` 已去重（按 Set 的口径）。 */
  function applyRules(preset, words, ctx) {
    const c = ctx || {};
    const ranks = c.ranks || demoRanks(preset, words);
    const wcs = wordContexts(words, ranks, c);
    const rules = (preset.rules && preset.rules.rules) || [];
    const base = (preset.rules && preset.rules.base) || null;
    const ictx = injectContext(preset, c);
    return wcs.map((w) => {
      let acc = base ? Object.assign({}, base) : {};
      if (w.rank !== null && acc.rank === undefined) acc.rank = w.rank;
      const hit = [];
      for (let i = 0; i < rules.length; i++) {
        if (!evalPredicate(rules[i].when, w, c)) continue;
        hit.push(rules[i]);
        if (!rules[i].continueMatching) break;
      }
      hit.sort((a, b) => (a.priority || 0) - (b.priority || 0));
      hit.forEach((r) => { acc = mergeApply(acc, r.apply || {}); });
      if (typeof acc.rank === 'string') acc.rank = RANK_NUM[acc.rank];
      const out = finishApply(acc, preset, ictx, w, c);
      return withHighlightStyle(preset, out, acc, c);
    });
  }

  /** apply → 词属性。
   *
   *  **`addDynamicColorTag` 加的是 `color-<这个词带进来的色>`，不是 `color-<rank名>`** ——
   *  拼标签用的是谓词上下文里那个 `color` 字段（AI 强调给的色串）。
   *  原型没有那一路，所以除非 `ctx.colors` 给了色，这个标签根本不会出现
   *  （数据里也没有任何 `color-*` 的 customAnimation 与它对应，所以本来就是空转）。
   *
   *  `spacing` 这一路是 **em**（与动画通道的 `spacing` 同一个单位），
   *  与 `paint.spacing` 的 1/100 em **不是一回事**。 */
  function finishApply(ap, preset, ictx, w, ctx) {
    const out = {tags: [], rank: null, wordIndex: w.wordIndex, wordText: w.wordText};
    if (ap.tags) {
      const seen = [];
      ap.tags.forEach((t) => { if (seen.indexOf(t) < 0) seen.push(t); });
      if (ap.addDynamicColorTag && w.color) {
        const t = 'color-' + w.color;
        if (seen.indexOf(t) < 0) seen.push(t);
      }
      out.tags = seen;
    }
    if (ap.scale !== undefined) out.scale = Array.isArray(ap.scale) ? ap.scale.slice() : [ap.scale, ap.scale];
    if (ap.scaleImpactLayout !== undefined) out.scaleImpactLayout = ap.scaleImpactLayout;
    if (ap.overwriteWithComputedScale !== undefined) out.overwriteWithComputedScale = ap.overwriteWithComputedScale;
    if (ap.font !== undefined) out.font = ap.font;
    if (ap.spacing !== undefined) out.spacing = ap.spacing;
    if (ap.bold !== undefined) out.bold = ap.bold;
    if (ap.italic !== undefined) out.italic = ap.italic;
    if (ap.variant !== undefined) out.variant = ap.variant;
    if (ap.box !== undefined) out.box = ap.box;
    if (ap.align !== undefined) out.align = ap.align;
    if (ap.letterCasing !== undefined) out.letterCasing = ap.letterCasing;
    if (ap.color !== undefined) {
      if (typeof ap.color === 'string') out.color = ap.color;
      else {
        const v = ictx[ap.color.source] || (ap.color.sourceFallback ? ictx[ap.color.sourceFallback] : undefined);
        if (v !== undefined) out.color = v;
      }
    } else if (typeof ap.rank === 'number') {
      const tier = preset.caps.ignoreEmphasisEnabled ? 'accessible' : rankName(clampRank(ap.rank));
      const v = tier === 'viral' ? ictx.viralColor : tier === 'highlighted' ? ictx.highlightColor : undefined;
      if (v !== undefined) { out.color = v; out.colorWriteMask = 'rgb'; }
    }
    if (typeof ap.rank === 'number') out.rank = clampRank(ap.rank);
    out.rankName = out.rank === null ? null : rankName(out.rank);
    /* `overwriteWithComputedScale` 直接把量出来的 `computedScale` 顶上去。
       `computedScale` 是标量（其余地方 `scale` 都是二元组），几何一样，这里补成二元组。 */
    if (ap.overwriteWithComputedScale && ictx.computedScale !== undefined) {
      out.scale = [ictx.computedScale, ictx.computedScale];
    }
    return out;
  }

  /** 词属性落定之后那一步：rank 高于 accessible 时把模板的 `highlightStyle` 垫在词属性**下面**
   *  （`{...highlightStyle, ...wordProps}` 再叠用户覆盖——规则赢，highlightStyle 只补空位）。
   *  三个前置条件缺一不可：`dynamicHighlights` 开、模板有 `highlightStyle`、
   *  且 `ignoreEmphasisEnabled` 为假。用户覆盖（`textCustomizations`）原型没有，恒为空。 */
  function withHighlightStyle(preset, out, ap, ctx) {
    const hs = highlightStyleOf(preset);
    const flags = (ctx && ctx.featureFlags) || {dynamicHighlights: true};
    const tier = typeof ap.rank === 'number' ? rankName(clampRank(ap.rank)) : undefined;
    if (!hs || !Object.keys(hs).length) return out;
    if (tier === undefined || tier === 'accessible') return out;
    if (!flags.dynamicHighlights || preset.caps.ignoreEmphasisEnabled) return out;
    const merged = Object.assign({}, {
      font: hs.font, color: hs.color, bold: hs.bold, italic: hs.italic,
      letterCasing: hs.letterCasing,
    }, out);
    Object.keys(merged).forEach((k) => { if (merged[k] === undefined) delete merged[k]; });
    // `p?.spacing ?? l.spacing`：highlightStyle 的字距**盖过**规则给的
    const sp = hs.spacing !== undefined ? hs.spacing : ap.spacing;
    if (sp !== undefined) merged.spacing = sp;
    // `u.scale === undefined && p.size !== undefined && p.size !== 1`
    if (merged.scale === undefined && hs.size !== undefined && hs.size !== 1) {
      merged.scale = [hs.size, hs.size];
    }
    return merged;
  }

  /** `defaultHighlightStyles` 是**模板**给 `highlightStyle` 的兜底，垫在 preset 的下面
   *  （与 `highlightStyle` 垫在词属性下面同一个方向）。25 份里只有 Ember（`emphasisSixteen`）
   *  有一条，`{font: "Rubik Spray Paint"}`；而它的 `effectiveDefaults.highlightStyle` 已经
   *  写了同一个字体，所以这一格今天**没有可观察效果**——实现它是因为它是预设数据的一部分，
   *  不是因为它改变了哪一帧。 */
  function highlightStyleOf(preset) {
    if (!preset.dhs) return preset.highlight;
    return Object.assign({}, preset.dhs, preset.highlight || {});
  }

  /** `highlight` 是**原样**的 `highlightStyle`（预设自己的单位）。这一条把它换成涂装键，
   *  给画廊那一格「高亮词长什么样」用——换算与 `paint` 同一张表。 */
  function highlightPaint(k) {
    const p = byKey(k);
    if (!p) return null;
    const hs = highlightStyleOf(p);
    if (!hs) return null;
    const out = {};
    if (hs.font !== undefined) { out.font = hs.font; out.stack = fontOf(hs.font).stack; }
    if (hs.color !== undefined) out.color = hs.color;
    if (hs.spacing !== undefined) out.spacing = Math.round(hs.spacing * 100);
    if (hs.bold !== undefined) out.bold = hs.bold;
    if (hs.italic !== undefined) out.italic = hs.italic;
    if (hs.size !== undefined) out.size = hs.size;
    if (hs.letterCasing !== undefined) out.upper = CASING[hs.letterCasing] || '';
    return out;
  }
  const CASING = {none: '', uppercase: 'upper', lowercase: 'lower', capitalize: 'title'};

  /* ---------- inject ----------
     `accessibleColor` / `highlightColor` / `viralColor` 的演示取值见头部第 7 条。 */
  function injectContext(preset, opts) {
    const o = opts || {};
    const p = preset.paint;
    const ctx = {
      accessibleColor: o.accessibleColor || p.color,
      highlightColor: o.highlightColor || p.activeColor || p.color,
      viralColor: o.viralColor || p.activeColor || p.color,
    };
    if (o.computedScale !== undefined) ctx.computedScale = o.computedScale;
    return ctx;
  }
  const isInject = (v) => !!v && typeof v === 'object' && v.inject !== undefined;
  function resolveInject(node, ictx) {
    if (node.inject === 'color') {
      let v = ictx[node.source];
      if (v === undefined && node.sourceFallback) v = ictx[node.sourceFallback];
      if (v === undefined) v = node.fallback;
      if (v !== undefined && node.transformParam !== undefined) {
        if (node.transform === 'scaleOpacity') v = scaleOpacity(v, node.transformParam);
        else if (node.transform === 'scaleLuminosity') v = scaleLuminosity(v, node.transformParam);
      }
      return v;
    }
    const s = ictx.computedScale;
    if (s === undefined) return node.fallback;
    return node.transform === 'multiplyBy' && node.transformParam ? s * node.transformParam : s;
  }
  /** 深走一遍换掉所有 `{inject:…}`。 */
  function resolveInjects(tree, ictx) {
    if (isInject(tree)) return resolveInject(tree, ictx);
    if (Array.isArray(tree)) return tree.map((x) => resolveInjects(x, ictx));
    if (tree && typeof tree === 'object') {
      const out = {};
      Object.keys(tree).forEach((k) => { out[k] = resolveInjects(tree[k], ictx); });
      return out;
    }
    return tree;
  }
  const srgb2lin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const lin2srgb = (x) => 255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  /** 在线性光空间里把 RGB 与 alpha 一起乘 `t`。 */
  function scaleOpacity(color, t) {
    const c = parseHex(color);
    return toHex(lin2srgb(srgb2lin(c[0]) * t), lin2srgb(srgb2lin(c[1]) * t),
      lin2srgb(srgb2lin(c[2]) * t), c[3] * t);
  }
  /** 按线性光亮度缩放，是 OKLab L 通道的**近似**（这一族没有用到它）。 */
  function scaleLuminosity(color, t) {
    const c = parseHex(color);
    return toHex(lin2srgb(srgb2lin(c[0]) * t), lin2srgb(srgb2lin(c[1]) * t),
      lin2srgb(srgb2lin(c[2]) * t), c[3]);
  }

  /* ---------- hideBehindForeground 哨兵 ----------
     数据里这条属性的 `value` 恒是字符串 `"injectedHiddenUuid"`——它不是一个 uuid，是个
     **哨兵**：求值时引擎把「这条 cue 要藏到谁后面」的 uuid 列表填进来。列表为空时
     就把**这一条 property 整条 splice 掉**，字幕照常画在最前面（没有 matting 目标就
     没有可藏的东西，这不是降级，是它本来的分支）。

     带这条哨兵的是第 72 轮进来的 7 份：Ember / Vesper / Volt / Citrus / Marker /
     Backdrop / Backdrop+（Volt 另外还有一个只装着这一条的 `hideBg` 标签，同时挂在高亮与
     非高亮两条规则上——那一整个标签因此在原型里是空的）。原型没有人物 matting，
     `hiddenUuids` 恒为空，走的正是 splice 那一支：**文字在前、不被遮挡**。
     它们本该藏在人后，记为已知近似（见头部第九节）。 */
  const HIDE_SENTINEL = 'injectedHiddenUuid';
  const hideTargets = (o) => (o && o.hiddenUuids) || [];
  /** 这一条 `hideBehindForeground` 在这个上下文里会不会被整条 splice 掉。 */
  function hideSpliced(prop, opts) {
    if (!prop || prop.type !== 'hideBehindForeground') return false;
    if (prop.value !== HIDE_SENTINEL) return false;      // 真 uuid（数据里没有）就不是哨兵
    return hideTargets(opts).length === 0;
  }

  /* ---------- 取动画 ----------
     base 的那一档 ＋ 该词每个 tag 的那一档，按 tag 顺序并进来。 */
  const SCOPES = {word: 'word', char: 'char', line: 'line', global: 'global'};
  function entriesFor(preset, scope, tags) {
    const ir = preset.ir;
    if (scope === 'global') return (ir.global || []).slice();
    const out = (ir[scope] || []).slice();
    (tags || []).forEach((t) => {
      const def = ir.tags[t];
      if (def && def[scope]) out.push.apply(out, def[scope]);
    });
    return out;
  }
  /** 这个 tag 是不是「一串连着的词合成一条」。25 份里有 8 个标签带它：
   *  Ember / Vesper / Volt / Citrus / Marker / Backdrop / Backdrop+ 的 `hidden`，
   *  以及 Blaze 的 `scaleUp`。 */
  const groupsConsecutive = (preset, tag) => !!(preset.ir.tags[tag] && preset.ir.tags[tag].groupConsecutive);

  /** 把带同一个 `groupConsecutive` 标签、**同一行里连着**的词并成 run，只有首词发。
   *  `words` 是 `applyRules` 的输出，`lines` 是每行的全局词号数组。 */
  function consecutiveRuns(preset, words, lines) {
    const ls = lines || [words.map((_, i) => i)];
    const lineOf = new Map();
    ls.forEach((idxs, li) => idxs.forEach((gi) => lineOf.set(gi, li)));
    const runs = {};
    Object.keys(preset.ir.tags).forEach((tag) => {
      if (!groupsConsecutive(preset, tag)) return;
      const out = [];
      let cur = null, lastLine = null;
      words.forEach((w, i) => {
        if (w.tags.indexOf(tag) >= 0) {
          const broke = lastLine !== null && lineOf.get(i) !== lastLine;
          if (cur === null || broke) { if (cur) out.push(cur); cur = {tag: tag, words: [i]}; }
          else cur.words.push(i);
          lastLine = lineOf.get(i);
        } else { if (cur) { out.push(cur); cur = null; } lastLine = null; }
      });
      if (cur) out.push(cur);
      runs[tag] = out;
    });
    return runs;
  }

  /** 第 `i` 个词这一档要跑的 entry 表，分两堆。
   *
   *  **`groupConsecutive` 的语义在第 72 轮改正了**：一条 run 发的是覆盖
   *  `[run 首词 … run 末词]` 的**一条 rangeProperty**，所以 run 里的**每个词都吃**这一档，
   *  不是「只有首词发、其余被吞掉」。预期效果：Ember 的
   *  `Ten years` 两个词都是大号红色喷漆体，而那个倍率与那个颜色只有 `hidden` 这一个
   *  groupConsecutive 标签给得出——真要是只有首词发，`years` 就该是小号白衬线。
   *  区别落在**时间窗口**上：整条 run 共用 run 的窗口（首词起、末词止），不用各自的词窗。
   *
   *  返回 `tags`（按自己的词窗跑）/ `gtags`（按 run 窗口跑）/ `run`（这个词所在的 run）。 */
  function wordTracks(preset, i, ctx) {
    const c = ctx || {};
    const words = c.words;
    const tags = (words ? words[i].tags : (c.tags || [])).slice();
    if (!words) {
      return {tags: tags, gtags: [], entries: entriesFor(preset, 'word', tags), run: null};
    }
    const runs = consecutiveRuns(preset, words, c.lines);
    let run = null;
    const plain = [], grouped = [];
    tags.forEach((t) => {
      if (!groupsConsecutive(preset, t)) { plain.push(t); return; }
      const r = (runs[t] || []).find((x) => x.words.indexOf(i) >= 0);
      if (!r) { plain.push(t); return; }
      grouped.push(t);
      const span = {tag: t, from: r.words[0], to: r.words[r.words.length - 1]};
      if (!run || span.from < run.from) run = span;
    });
    return {tags: plain, gtags: grouped,
      entries: entriesFor(preset, 'word', plain.concat(grouped)), run: run};
  }

  /* ---------- 块的 padding / position 的单位（第 72 轮） ----------
     绝大多数通道的位移与内边距是 **em**（占字号）。块那两条通道里有一处**不是**：
     Citrus（`template-015-sub`）的 `padding` 是 `[-84,-2] → [-0.4,-2]`、`position` 是
     `[48,0.4] → [0,0.4]`。84em / 48em 不可能是 em（一个字号的 84 倍），而按 px 解正好：
     词宽两百来 px，`-84px` 的内边距把块收成一条窄条，扫到 `-0.4px` 正好铺满整词，
     `-2px` 的竖直内边距则让块保持**整词高**：Citrus 的绿块是一整块
     高亮底，不是 Memo 那样的一条细线。
     Memo（`[-4,-1.8] → [0,-1.5]` / `[-2.8,0.6] → [0,0.8]`）全在 em 的量级里，按 em 解出来
     正是那条 2px 绿线（第 71 轮的 `BOX_MIN_H_EM` 就是为它定的）。
     所以判据是**量级**，不是名字：一条块通道里出现 |v| ≥ 10 的分量就按 px 解。
     要不要再按画面分辨率归一还没定——25 份里只有这一处，归不归一看不出来。 */
  const BOX_PX_UNIT = 10;
  function bigUnit(ch) {
    let big = false;
    const scan = (v) => {
      if (typeof v === 'number') { if (Math.abs(v) >= BOX_PX_UNIT) big = true; return; }
      if (Array.isArray(v)) v.forEach(scan);
    };
    if (!ch || typeof ch !== 'object') return false;
    if ('value' in ch) scan(ch.value);
    (ch.keyframes || []).forEach((f) => { scan(f.v0); scan(f.v1); });
    return big;
  }

  /** 把这一档的所有 entry 摊成「层」：每层一个 CSS 落点 ＋ 一条已解好的通道。 */
  function layersOf(preset, scope, tags, opts) {
    const o = opts || {};
    const w = WIN[scope] || WIN.word;
    const cctx = {win: o.win || w.win, prev: o.prev || w.prev, cue: o.cue || w.cue,
      cueColor: preset.paint.color};
    const ictx = injectContext(preset, o);
    const out = [];
    const push = (target, rc, extra) => {
      if (!rc || (!('value' in rc) && !(rc.keyframes && rc.keyframes.length))) return;
      out.push(Object.assign({target: target, ch: rc}, extra || {}));
    };
    const ch = (c) => resolveChannel(resolveInjects(c, ictx), cctx);
    const walk = (props, boxed) => props.forEach((p) => {
      switch (p.type) {
        case 'alpha': push(boxed ? 'boxAlpha' : 'alpha', ch(p.ch), {resolve: p.resolve || 'compose'}); break;
        case 'scale': push(boxed ? 'boxScale' : 'scale', ch(p.ch), {resolve: p.resolve, impactLayout: p.impactLayout}); break;
        case 'position': push(boxed ? 'boxPos' : 'position',
          ch(p.ch), {resolve: p.resolve, impactLayout: p.impactLayout,
            unitPx: boxed ? bigUnit(p.ch) : false}); break;
        case 'rotation': push('rotation', ch(p.ch), {resolve: p.resolve, impactLayout: p.impactLayout}); break;
        case 'color': push(boxed ? 'boxColor' : 'color', ch(p.ch), {resolve: p.resolve || 'override'}); break;
        case 'spacing': push('spacing', ch(p.ch)); break;
        case 'blur': push(boxed ? 'boxBlur' : 'blur', ch(p.size)); break;
        case 'roundness': push('boxRound', ch(p.ch)); break;
        case 'padding': push('boxPad', ch(p.ch), {unitPx: bigUnit(p.ch)}); break;
        case 'blendingMode': push('blend', ch(p.ch)); break;
        case 'font': push('font', {value: resolveInjects(p.value, ictx)}); break;
        case 'variant': push('variant', {value: resolveInjects(p.value, ictx)}); break;
        case 'outline': push('outline', {value: 1}, {size: ch(p.size), color: ch(p.color)}); break;
        case 'shadow': push('shadow', {value: 1}, {size: ch(p.size), color: ch(p.color), offset: ch(p.offset)}); break;
        case 'gradient': push('gradient', {value: 1},
          {stops: (p.stops || []).map((s) => ({color: ch(s.color), position: ch(s.position)})),
            angle: p.angle ? ch(p.angle) : null}); break;
        case 'box': walk(p.payload || [], true); break;
        /* 哨兵：没有 matting 目标就整条 splice。有目标时留一层——原型画不出遮挡，
           `plan` 不消费它，留着是为了让「splice 了没有」这件事可断言而不是靠没写代码。 */
        case 'hideBehindForeground':
          if (!hideSpliced(p, o)) push('hide', {value: hideTargets(o).slice()});
          break;
        // 认它、丢它：原型没有 matting 遮罩，也没有轴对齐以外的竖直定位
        case 'maskFill': case 'verticalAlignment':
        case 'verticalAlignmentAxis': case 'horizontalAlignmentAxis': break;
        default: break;                                  // 认不出的属性类型：丢弃
      }
    });
    entriesFor(preset, scope, tags).forEach((e) => walk(e.p || [], false));
    return out;
  }

  /* ---------- 每帧求值：布局 → 绘制指令表 ----------
     第 71 轮换代：这一段此前生成 `@keyframes` ＋ 内联 CSS（`roles` / `styleAt` / `gridOf` /
     `unit` / `unitCss` / `keyframesCss` / `motion` / `frame`），现在生成**数**。
     CSS 那条路有三处结构性近似，全是 CSS 的限制逼出来的、不是预设本身的语义：
     分段缓动不一致时切五份线性子采样、`--vc-box-*` 的 `@property` 伪元素、
     负 `animation-delay` ＋ 拉长时长来承担词前起跳。canvas 每帧纯函数求值，三处一起没了。

     **没有「挂动画」这个概念**：`plan(preset, layout, t)` 是纯函数，每一帧都重新算。
     `rangeProperties` 本来就是这样消费的——词的时间门控由它自己的窗口承担，
     不到窗口取首帧（多半 alpha 0）、窗口内按 t、过窗停末帧，没有任何地方需要 clamp。

     两层：
       `layoutOf(preset, words, measure, ctx)` —— 排版。要量宽，所以 `measure` 由视图注入
         （canvas `measureText`；node 测试注入等宽假量尺）。输出每词 / 每字形簇的几何。
       `plan(preset, layout, t, ctx)` —— 绘制指令表。全数值，无 CSS 串，按绘制顺序。 */

  const num = (v) => Math.round(v * 1e4) / 1e4;

  /** `prefers-reduced-motion` 下不跑 RAF，画的是**签名帧**：当前词窗走到 35% 的那一刻。
   *  那一帧看得出是哪一种（取帧表本来就是按「签名帧」设计的），只是不动。 */
  const SAMPLE_ON = 0.35;
  /** 签名帧的 `t`（秒，cue 相对）——视图不必自己拼这条算式。 */
  function stillT(layout, i) {
    const w = layout.wins[Math.max(0, Math.min(i === undefined ? layout.cur : i, layout.wins.length - 1))];
    return w[0] + (w[1] - w[0]) * SAMPLE_ON;
  }

  /** 基准字号对应的 `layout.size`：20px 落在 880×495 的画面上 ≈ 画面高的 4%。
   *  不折算的话 25 份会长成一个大小，而「一次一词撑满」与「小号等宽终端」的差别**就是**字号。 */
  const SIZE_REF = 0.04;
  const SIZE_MIN = 10;
  function captionFontPx(k, fz) {
    const p = byKey(k);
    if (!p) return fz;
    return Math.max(SIZE_MIN, +(fz * (p.layout.size || SIZE_REF) / SIZE_REF).toFixed(1));
  }

  /* `scale` 分两路，判据是**常量还是关键帧**加上 `impactLayout`：
       常量 ＋ `impactLayout !== false` → **参与排版**（折进字号，行宽跟着变）；
       关键帧，或显式 `impactLayout: false` → **只画不排**（绕词心的绘制变形）。
     依据是三份数据与它们该有的画面：Slab 的 `stretch` 写着
     `impactLayout: true`（撑幅就是排版）；Fusion 的 `wordScaleSmall` 是常量 2.2、没写标志，
     那个大词该把同行的词挤开（是排版）；Cascade 的 `wordScaleIn` 与 Fusion 的
     `wordScaleBig` 都显式写着 `impactLayout: false`（0→1 的弹入，不该每帧回流）。 */
  const isLayoutScale = (L) => L.target === 'scale' && L.impactLayout !== false && 'value' in L.ch;

  function layoutScaleOf(layers) {
    let sx = 1, sy = 1;
    layers.forEach((L) => {
      if (!isLayoutScale(L)) return;
      const v = L.ch.value, a = Array.isArray(v) ? v : [v, v];
      if (L.resolve === 'override') { sx = a[0]; sy = a[1]; } else { sx *= a[0]; sy *= a[1]; }
    });
    return [sx, sy];
  }

  /** 一档层在 `t`（秒，cue 相对）上的**数值**状态。**唯一的求值口子**（`plan` 全从它取）。
   *  `tx/ty/blur/spacing/box.*` 留在 em——换成 px 要知道这个词的字号，那是 `plan` 的事。
   *  `resolve` 的混合数学取最朴素的一套：alpha 与 scale 相乘、
   *  position / rotation 相加、其余后来居上。 */
  function stateAt(layers, t, opts) {
    const o = opts || {};
    const s = {alpha: null, sx: 1, sy: 1, tx: 0, ty: 0, rot: 0, blur: 0, spacing: null,
      color: null, family: null, weight: null, italic: null, blend: null,
      shadow: null, outline: null, box: null, hide: null};
    const boxOf = () => (s.box || (s.box = {color: null, alpha: null, sx: 1, sy: 1,
      tx: 0, ty: 0, px: 0, py: 0, r: 0, blur: 0, padPx: false, posPx: false}));
    layers.forEach((L) => {
      const v = sampleChannel(L.ch, t);
      switch (L.target) {
        case 'alpha':
          s.alpha = (s.alpha === null || L.resolve === 'override') ? v : s.alpha * v; break;
        case 'scale': {
          if (o.skipLayoutScale && isLayoutScale(L)) break;
          const a = Array.isArray(v) ? v : [v, v];
          if (L.resolve === 'override') { s.sx = a[0]; s.sy = a[1]; } else { s.sx *= a[0]; s.sy *= a[1]; }
          break;
        }
        case 'position': {
          const a = Array.isArray(v) ? v : [v, 0];
          if (L.resolve === 'override') { s.tx = a[0]; s.ty = a[1]; } else { s.tx += a[0]; s.ty += a[1]; }
          break;
        }
        case 'rotation': s.rot = L.resolve === 'override' ? v : s.rot + v; break;
        case 'blur': s.blur = v || 0; break;
        case 'spacing': s.spacing = v; break;
        case 'color': s.color = (L.resolve === 'compose' && s.color) ? mulHex(s.color, v) : v; break;
        case 'blend': s.blend = v; break;
        case 'font': s.family = v; break;
        case 'variant':
          if (v && v.weight !== undefined) s.weight = v.weight;
          if (v && v.italic !== undefined) s.italic = !!v.italic;
          break;
        case 'outline':
          s.outline = {size: sampleChannel(L.size, t) || 0, color: sampleChannel(L.color, t)};
          break;
        case 'shadow':
          s.shadow = {size: sampleChannel(L.size, t) || 0, color: sampleChannel(L.color, t),
            offset: sampleChannel(L.offset, t) || [0, 0]};
          break;
        /* `resolve: "compose"` 取相乘。Terminal 的光标块写着两条 `color`：
           先 `accessibleColor`（#00FF41），再 `#DEDEDE` compose。那块该是**偏绿的白**，
           取相乘正好落在那儿；取覆盖会画成一块纯灰。 */
        case 'boxColor': {
          const b = boxOf();
          b.color = (L.resolve === 'compose' && b.color) ? mulHex(b.color, v) : v;
          break;
        }
        case 'boxAlpha': boxOf().alpha = boxOf().alpha === null ? v : boxOf().alpha * v; break;
        case 'boxScale': { const a = Array.isArray(v) ? v : [v, v]; const b = boxOf(); b.sx *= a[0]; b.sy *= a[1]; break; }
        case 'boxPos': { const a = Array.isArray(v) ? v : [v, 0]; const b = boxOf();
          b.tx += a[0]; b.ty += a[1]; if (L.unitPx) b.posPx = true; break; }
        case 'boxPad': { const a = Array.isArray(v) ? v : [v, v]; const b = boxOf();
          b.px += a[0]; b.py += a[1]; if (L.unitPx) b.padPx = true; break; }
        // 四角恒等（25 份里都是），取第一角
        case 'boxRound': boxOf().r = Array.isArray(v) ? v[0] : v; break;
        case 'boxBlur': boxOf().blur = v || 0; break;
        // 哨兵没被 splice 掉时的那一层：记下来，但画不出遮挡（`plan` 不读它）
        case 'hide': s.hide = v; break;
        default: break;                                  // gradient 等：25 份里没有
      }
    });
    if (s.alpha === null) s.alpha = 1;
    if (s.box && s.box.alpha === null) s.box.alpha = 1;
    return s;
  }

  /** 一个词那一档的全部层：普通标签按**自己的词窗**解，`groupConsecutive` 标签按
   *  **run 的窗口**解，两段拼起来。`plan` 与排版的包围盒采样都走这一条。 */
  function wordLayers(preset, it, cueDur, cs) {
    const cue = [0, cueDur];
    const a = layersFor(preset, 'word', it.tags, it.win, it.prev, cue, cs);
    if (!it.gtags || !it.gtags.length) return a;
    return a.concat(layersFor(preset, 'word', it.gtags, it.gwin, it.gprev, cue, cs));
  }

  /* `layersOf` 每次都要把通道重解一遍。一屏 17 张卡 × 每张十几个词 × 60fps——
     缓存的是纯函数的结果，键里带窗口与 `computedScale`，所以量宽换了值不会读到旧的。 */
  const LCACHE = new Map();
  const k4 = (a) => Math.round(a * 1e4);
  function layersFor(preset, scope, tags, win, prev, cue, cs) {
    const key = preset.k + '|' + scope + '|' + tags.join(',') + '|' + k4(win[0]) + ',' + k4(win[1])
      + '|' + k4(prev[0]) + ',' + k4(prev[1]) + '|' + k4(cue[1]) + '|' + (cs === undefined ? '' : cs);
    let L = LCACHE.get(key);
    if (L === undefined) {
      if (LCACHE.size > 4000) LCACHE.clear();
      L = layersOf(preset, scope, tags, {win: win, prev: prev, cue: cue, computedScale: cs});
      LCACHE.set(key, L);
    }
    return L;
  }
  /** 只这一层这一档真有条目的 tag——空层白算一遍缓存键。 */
  const liveTags = (p, scope, tags) => (tags || []).filter((t) => p.ir.tags[t] && p.ir.tags[t][scope]);

  /* ---------- 排版 ---------- */

  const HOT = RANK_NUM.highlighted;
  const MAX_STACK = 5;                                  // 堆叠上限：原型样例是整句，一词一行会太长
  /** 这个排版条目算不算「高亮」（`lineTransform` 与 `lineAnnotation` 分组用的同一条判据）。 */
  const isHot = (x) => x.wp.rank != null && x.wp.rank >= HOT;

  /** `lineTransform` → 每行的词下标。`splitToWords` 一词一行；`newlineOnHighlight` /
   *  `eachHighlightInOwnLine` 在强调词处断行；其余（`null` / `greedyLineBreak`）贪心折行。
   *  折行宽度是预设的 `wrapWidth`（占画面宽的比例）——不折的话 Terminal 那种长句
   *  会顶出画面，而它该是两行。 */
  function linesOf(preset, ws, wrapW) {                 // `ws` 是 `layoutOf` 的 item 表
    const lt = preset.layout.lineTransform;
    if (lt === 'splitToWords') return ws.map((_, i) => [i]);
    let runs;
    if (lt === 'splitByHighlight') {
      /* 第 72 轮新进来的一路（Backdrop 一族 7 份）：一段连着的**同类**词（全高亮 / 全非高亮）
         成一行，高亮与非高亮之间一定断开。`lineAnnotation` 再把这两类分到两条轴上——
         「大字在上、小字在下、人夹在中间」就是这两步的合成结果。 */
      runs = [];
      let run = [], hot = null;
      ws.forEach((x, i) => {
        const h = isHot(x);
        if (hot !== null && h !== hot && run.length) { runs.push(run); run = []; }
        hot = h;
        run.push(i);
      });
      if (run.length) runs.push(run);
    } else if (lt === 'newlineOnHighlight' || lt === 'eachHighlightInOwnLine') {
      runs = [];
      let run = [];
      ws.forEach((x, i) => {
        const hot = isHot(x);
        if (hot && run.length) { runs.push(run); run = []; }
        run.push(i);
        if (hot && lt === 'eachHighlightInOwnLine') { runs.push(run); run = []; }
      });
      if (run.length) runs.push(run);
    } else {
      runs = [ws.map((_, i) => i)];
    }
    if (!(wrapW > 0)) return runs;
    const out = [];
    runs.forEach((run) => {
      let cur = [], w = 0;
      run.forEach((i) => {
        const adv = ws[i].natW + (cur.length ? ws[i].gap : 0);
        if (cur.length && w + adv > wrapW) { out.push(cur); cur = []; w = 0; }
        cur.push(i);
        w += cur.length === 1 ? ws[i].natW : adv;
      });
      if (cur.length) out.push(cur);
    });
    return out;
  }

  /** 堆叠窗口：只留「到当前词为止的最后 N 行」。短句 cue 整条都能留在画面上，
   *  原型的样例却是整句，一词一行会长成十几行，所以要一个上限。
   *
   *  N 取 `maxLines`——**但 `splitToWords` 那一路不算**。Cascade 写着 `maxLines: 2`，
   *  画面上却该叠到五六行；Quill 写着 1，也该是两三行。
   *  一词一行的那一路本来就不折行，`maxLines` 在那儿管的是折行不是堆叠。反过来
   *  Memo / Linen / Hush / Slab / Zest 的 `maxLines: 1` 都是实打实的一行。 */
  function windowLines(preset, lines, cur) {
    const lt = preset.layout.lineTransform;
    /* `splitByHighlight` 也不吃 `maxLines`（第 72 轮补）：Volt 写着 `maxLines: 1`，画面上
       却要小字一行 ＋ 大字一行两组都在；Marker 写着 3，
       画面上是 1 行大字 ＋ 2 行小字。这一路的 `maxLines` 管的是**正文那一组的折行**，
       不是整条的堆叠上限——照字面夹会把高亮那一组直接夹没。 */
    const cap = (lt !== 'splitToWords' && lt !== 'splitByHighlight'
      && preset.layout.maxLines) || MAX_STACK;
    if (lines.length <= cap) return lines;
    let li = lines.length - 1;
    for (let i = 0; i < lines.length; i++) if (lines[i].indexOf(cur) >= 0) { li = i; break; }
    return lines.slice(Math.max(0, li - cap + 1), li + 1);
  }

  /** `computedScale`。判据是三个参数——`wrapWidth`（占画面宽的比例）
   *  × `targetFillRatio` ＝ 想让字占多宽，除以实测宽度就是倍率，下限是 `minScale`。
   *  这里按**可观察行为**实现，两条分开：
   *
   *  - `calculateHighlightedTextScale`（Slab）**不设上限**。数据写着 `maxScale: 1`，
   *    但 `IS` 要比 `FIVE-MINUTE` 高出一倍多，
   *    两者撑到同一条基准宽——那就不可能是「不许放大」。上限那一格当没写，
   *    这里只保留下限。撑幅是这一份的**全部特征**，压掉它这一份就不是这一份了。
   *  - `calculatePerLineHighlightScales`（Zen One）照数据夹 `[1, 2]`：强调词只是
   *    比正文大一档，没有撑满，上限在这一路是生效的。 */
  /** 量倍率时「要一起撑满基准宽」的分组（只收高亮词）。三路，判据是数据不是名字：
   *
   *  - `splitByHighlight`（Backdrop 一族 7 份）：**一段连着的高亮词是一组**。它们被
   *    `splitByHighlight` 放进同一行、`textWrap: nowrap` 又不许它们折开，所以
   *    Ember 的 `Ten years` 是两个词**一起**撑满基准宽的；
   *    各自撑满的话两个词加起来会有两倍宽，那一行就出画了。
   *  - 逐行那一档（`perWordSizeAlgorithm`，Zen One / Blaze）：**一行里的高亮词是一组**。
   *  - 其余（Slab）：**一个词一组**。Slab 的 base rank 就写着 highlighted，全员高亮，
   *    IR 原话 “uniformly across all words in the cue” ＝ 一条 cue 一个倍率、按最宽的那个
   *    词定。**不能拿草稿行分组**——它的行是缩放之后才折出来的（`wrapWidth 0.15`），
   *    拿没缩放的草稿行分组会把三个词并成一组，倍率立刻小三倍。 */
  function scaleGroups(preset, items, lines) {
    const hotIdx = [];
    items.forEach((x, i) => { if (isHot(x)) hotIdx.push(i); });
    if (!hotIdx.length) return [];
    if (preset.layout.lineTransform === 'splitByHighlight') {
      const out = [];
      let run = null;
      hotIdx.forEach((i) => {
        if (run && i === run[run.length - 1] + 1) run.push(i);
        else { run = [i]; out.push(run); }
      });
      return out;
    }
    if (preset.layout.perWordSizeAlgorithm) {
      return (lines || []).map((ln) => ln.filter((i) => isHot(items[i]))).filter((g) => g.length);
    }
    return hotIdx.map((i) => [i]);
  }

  /** `computedScale`。判据是三个参数——`wrapWidth`（占画面宽的比例）
   *  × `targetFillRatio` ＝ 想让字占多宽，除以实测宽度就是倍率，下限是 `minScale`。
   *  这里按**可观察行为**实现。返回每个词一个值（非高亮词恒 1）。 */
  function measureScales(preset, items, groups, boxW) {
    const L = preset.layout;
    const par = L.sizeParams || L.perWordSizeParams || {};
    const min = par.minScale === undefined ? 0.05 : par.minScale;
    const rawMax = par.maxScale === undefined ? 1 : par.maxScale;
    /* 上限：**照数据夹，只有 `<= 1` 的那一格当没写**。第 71 轮这里对
       `calculateHighlightedTextScale` 一律不设上限，因为当时这一族只有 Slab 用它，
       而 Slab 写的 `maxScale: 1` 与它该有的画面直接矛盾（`IS` 要比 `FIVE-MINUTE` 高一倍多，
       撑幅是它的全部特征）。第 72 轮进来的六份用的是同一个算法，写的却是
       30（Ember）/ 9（Marker）/ 8（Vesper）/ 7（Volt、Backdrop、Backdrop+）/ 6.4（Citrus）
       ——那些数一看就是真的上限，再一律无穷大就等于把数据扔了。所以判据收窄成：
       `<= 1` ＝ 没写 / 写错了，按无上限走；其余照夹。 */
    const max = (L.sizeAlgorithm === 'calculateHighlightedTextScale' && rawMax <= 1)
      ? Infinity : rawMax;
    /* `targetFillRatio` **只有 `calculateHighlightedTextScale` 读**（第 72 轮定的）。
       判据是 Blaze（竖屏 232×288）：它的
       `perWordSizeParams.targetFillRatio` 是 0.4，而 `TEAMS` 在 BBH Bartle 下按基准字号
       （0.077×288 ＝ 22.2px）量出来就已经有 143px 宽，它该占 150–160px ⇒ 倍率 ≈ 1.05。
       套上 0.4 的话目标宽只有 232×0.66×0.4 ＝ 61px，倍率 0.43——那个词会被**缩小**
       一半多，一眼就看得出不对。不套 0.4 时目标宽 153px、倍率 1.07，正好落在预期上。
       Zen One 的 `targetFillRatio` 写的是 1（套不套一个样），所以第 71 轮看不出这一格；
       Slab（`calculateHighlightedTextScale`，ratio 3）与 Ember（同算法，0.95）那一路照套，
       画面也对得上。 */
    const ratio = (L.sizeAlgorithm === 'calculateHighlightedTextScale'
      && par.targetFillRatio !== undefined) ? par.targetFillRatio : 1;
    const target = Math.max(1, (boxW || 0) * (L.wrapWidth || 0.6) * ratio);
    const fit = (w) => +(w > 0 ? Math.max(min, Math.min(max, target / w)) : min).toFixed(3);
    const widthOf = (g) => g.reduce((a, i, j) => a + items[i].natW + (j ? (items[i].gap || 0) : 0), 0);
    const out = items.map(() => 1);
    if (!groups.length) return out;
    // 逐行那一档一组一个值；整条那一档取最宽的那一组，一条 cue 一个值
    if (L.perWordSizeAlgorithm) {
      groups.forEach((g) => { const v = fit(widthOf(g)); g.forEach((i) => { out[i] = v; }); });
      return out;
    }
    const one = fit(Math.max.apply(null, groups.map(widthOf)));
    return items.map(() => one);
  }

  /* ---------- 深度排版（`lineAnnotation` ＋ `axes` / `responsiveAxes`） ----------
     第 72 轮进来的 Backdrop 一族（7 份）把一条 cue 拆成两组：高亮的一组挂在
     `highlightedAxis` 上、其余挂在 `unhighlightedAxis` 上，各按 `upperBound` /
     `lowerBound` 对齐。轴位是**屏幕比例**（`unit: "screenCoord"`,
     `frameOfReference: "relative"`，`+y` 朝上），横屏这一格由 `responsiveAxes.landscape`
     **覆盖** `presetIR.axes` 里写的那一对——Volt 就是靠这条覆盖才对：`axes` 写的是
     ±0.3，`responsiveAxes.landscape` 写的是 0.35 / 0.39，非高亮那一组反而**在上面**，
     画面上就是小字压在大字头顶上。

     **一处压缩，记明白**：轴位是屏幕比例、`layout.size` 也是屏幕比例，于是两组之间的
     空档按字面算是 `(hotY − bodyY) / size` 个字号——Backdrop 8.3em、Backdrop+ 18.8em、
     Citrus 15.8em。照字面画，一条字幕要三四百 px 高：画廊格子放不下，原型舞台的字幕块
     也不是整屏（字幕层整屏时照字面才成立）。所以这里**保留分组、次序与
     符号，只压距离**：空档照上式算，再夹到 `DEPTH_GAP_EM`。Volt 的 0.95em 夹不到，
     原样留着——它正好是这条规则的判据（那一份的看点就是次序反过来）。
     真值仍然出在 `layout.depth.gapEm` 里，舞台哪天要按屏幕比例摆，读它即可。 */
  /* 1.2em：画廊格子（`.sthumb--cap`，120px 高）里**两组之间还看得出是两条轴**的同时，
     25 份里最高的那几份（Backdrop / Marker / Ember）的墨迹高度刚好落回格子内的取值。
     它是一个**容器决定的数**，不是按屏幕比例算出来的——照字面算的真值在 `depth.rawGapEm`。 */
  const DEPTH_GAP_EM = 1.2;

  /** 这份 preset 的两条轴（横屏口径）。两条轴同名（Blaze：都挂 `top`）就没有深度分组。 */
  function depthAxes(preset) {
    const la = preset.layout.lineAnnotation;
    if (!la || !la.highlightedAxis || la.highlightedAxis === la.unhighlightedAxis) return null;
    const ax = preset.ir.axes || {};
    const ra = preset.layout.responsiveAxes || {};
    const posOf = (name) => {
      const r = ra[name] && ra[name].landscape;
      if (r) return r[1];
      const a = ax[name];
      return a && a.pos ? a.pos[1] : 0;
    };
    return {hotY: posOf(la.highlightedAxis), bodyY: posOf(la.unhighlightedAxis),
      hotAxis: la.highlightedAxis, bodyAxis: la.unhighlightedAxis,
      hotAlign: la.highlightedAlign || 'upperBound',
      bodyAlign: la.unhighlightedAlign || 'lowerBound'};
  }

  /** 把已按顺序堆好的行表改成两组两轴。`out` 原地改 `y`，返回 `{gapEm, rawGapEm, bodyFirst}`。 */
  function placeDepth(preset, out, fontPx) {
    const dep = depthAxes(preset);
    if (!dep || !preset.layout.size) return null;
    const hot = out.filter((L) => L.hot), body = out.filter((L) => !L.hot);
    if (!hot.length || !body.length) return null;
    const em = fontPx / preset.layout.size;             // 「屏幕比例 1.0」等于多少 px
    const hotTop = (0.5 - dep.hotY) * em;               // `upperBound`：高亮组的上边落这儿
    const bodyBottom = (0.5 - dep.bodyY) * em;          // `lowerBound`：正文组的下边落这儿
    const Hh = hot.reduce((a, L) => a + L.h, 0), Hb = body.reduce((a, L) => a + L.h, 0);
    const bodyFirst = bodyBottom <= hotTop;
    const raw = bodyFirst ? (hotTop - bodyBottom) : ((bodyBottom - Hb) - (hotTop + Hh));
    const cap = DEPTH_GAP_EM * fontPx;
    const gap = Math.max(0, Math.min(cap, raw));
    const stack = (ls, y0) => { let y = y0; ls.forEach((L) => { L.y = y; y += L.h; }); };
    if (bodyFirst) { stack(body, 0); stack(hot, Hb + gap); } else { stack(hot, 0); stack(body, Hh + gap); }
    out.sort((a, b) => a.y - b.y);
    return {axes: dep, gapEm: +(gap / fontPx).toFixed(3), rawGapEm: +(raw / fontPx).toFixed(3),
      bodyFirst: bodyFirst, h: Hh + Hb + gap};
  }

  const CASE_KEY = {upper: 'uppercase', lower: 'lowercase', title: 'capitalize'};

  /** 一个词的字面属性（涂装 ＋ 逐词规则 ＋ 这一档常量 scale），与时间无关。 */
  function faceOf(preset, w, fontPx, layoutScale) {
    const p = preset.paint;
    const casing = w.letterCasing || CASE_KEY[p.upper] || 'none';
    const weight = (w.variant && w.variant.weight !== undefined) ? w.variant.weight
      : (w.bold !== undefined ? (w.bold ? 700 : 400) : (p.bold ? 700 : (p.weight || 400)));
    const italic = (w.variant && w.variant.italic !== undefined) ? !!w.variant.italic
      : (w.italic !== undefined ? !!w.italic : !!p.italic);
    const rs = w.scale && w.scaleImpactLayout !== false ? w.scale : [1, 1];
    const sx = rs[0] * layoutScale[0], sy = rs[1] * layoutScale[1];
    return {
      family: fontOf(w.font || p.font).stack,
      sizePx: Math.max(1, fontPx * sx),
      // 二元不等比的那一路：字号吃 x，剩下的比值交给绘制变形（25 份里没有不等比的）
      squash: sx === 0 ? 1 : sy / sx,
      weight: weight, italic: italic,
      color: w.color || p.color,
      trackEm: w.spacing !== undefined ? w.spacing : (p.spacing || 0) / 100,
      casing: casing,
    };
  }

  /** 一条动效字幕的排版。`measure(text, face)` 由视图注入，返回 `{w, ascent, descent}`（px）。
   *  `ctx`：`{fz, boxW, cur, cueDur, wins, joint, ...applyRules 的那一套}`。
   *  `wins[i]` 是第 i 个词的窗口 `[起, 止]`（秒，cue 相对）；缺省按 cue 时长均分。 */
  function layoutOf(preset, words, measure, ctx) {
    const c = ctx || {};
    const fz = c.fz === undefined ? 20 : c.fz;
    const fontPx = captionFontPx(preset.k, fz);
    const boxW = c.boxW || 0;
    const n = words.length;
    const cueDur = c.cueDur === undefined ? Math.max(1e-3, n * BEAT) : c.cueDur;
    const wins = c.wins || words.map((_, i) => [i * cueDur / n, (i + 1) * cueDur / n]);
    const prevOf = (i) => (i > 0 ? wins[i - 1] : [wins[0][0] - (wins[0][1] - wins[0][0]), wins[0][0]]);
    const joint = c.joint || ((a, b) => (/[一-鿿]$/.test(a) || /^[一-鿿]/.test(b) ? '' : ' '));

    /* 这一档的常量 scale 要先解出来才知道字号，而 `computedScale` 又要先量宽——所以量两遍。
       `cs` 是整条那一档的倍率（标量），`csArr` 是逐行那一档的（每词一个）。 */
    const build = (cs, csArr) => {
      const wp = applyRules(preset, words, cs === undefined ? c
        : Object.assign({}, c, {computedScale: cs}));
      /* `groupConsecutive` 的 run 要在**词属性算完之后**才知道（run 按标签走）。
         run 里每个词都吃这一档，但共用 run 的窗口——见 `wordTracks` 的注释。 */
      const runs = consecutiveRuns(preset, wp, c.lines);
      return wp.map((w, i) => {
        const all = liveTags(preset, 'word', w.tags);
        const tags = [], gtags = [];
        all.forEach((t) => (groupsConsecutive(preset, t) ? gtags : tags).push(t));
        let gwin = wins[i], gprev = prevOf(i);
        if (gtags.length) {
          let a = Infinity, b = -Infinity, first = -1;
          gtags.forEach((t) => {
            const r = (runs[t] || []).find((x) => x.words.indexOf(i) >= 0);
            if (!r) return;
            const lo = r.words[0], hi = r.words[r.words.length - 1];
            if (wins[lo][0] < a) { a = wins[lo][0]; first = lo; }
            if (wins[hi][1] > b) b = wins[hi][1];
          });
          if (first >= 0) { gwin = [a, b]; gprev = prevOf(first); }
        }
        const ci = csArr ? csArr[i] : cs;
        const ls = layoutScaleOf(layersFor(preset, 'word', tags, wins[i], prevOf(i), [0, cueDur], ci)
          .concat(gtags.length
            ? layersFor(preset, 'word', gtags, gwin, gprev, [0, cueDur], ci) : []));
        const face = faceOf(preset, w, fontPx, ls);
        const text = applyCasing(words[i], face.casing);
        const m = measure(text, face);
        return {i: i, wp: w, tags: tags, gtags: gtags, gwin: gwin, gprev: gprev, cs: ci,
          face: face, text: text, natW: m.w, ascent: m.ascent, descent: m.descent};
      });
    };

    /* 词间距（拉丁补一个空格、CJK 直接相接）。空格宽按**两侧较大的那个字号**量：
       Handwritten 的强调词是 2 倍字号的手写体，只按后一个词的小字号量，两个词会粘在一起。 */
    const gaps = (items) => {
      items.forEach((x, i) => {
        const j = i === 0 ? '' : joint(words[i - 1], words[i]);
        x.gap = j ? Math.max(measure(j, x.face).w, measure(j, items[i - 1].face).w) : 0;
      });
      return items;
    };

    const wrapW = boxW ? Math.max(1, boxW * (preset.layout.wrapWidth || 0.6)) : 0;
    let items = gaps(build(undefined, null));
    let computedScale;
    if (needsMeasure(preset.k)) {
      /* 「每行的高亮段有多宽」要先有行，行又要先有字号，字号又改行——所以**迭代**：
         用没缩放的那一遍折一次草稿行、量倍率、整体重排，再拿重排后的行**再量一次**。
         Blaze 是这一步的判据：`teams lose` 没缩放时在同一行，合起来量出来的倍率偏小；
         缩放之后它们挤不下同一行了，各占一行再量，各自撑到基准宽——
         `TEAMS` / `LOSE` 就该各占一行各自撑满。
         两轮足够收敛（Slab / Zen One 第一轮就稳，两轮同值）；再多轮会在「刚好挤不下」
         的边界上来回跳，所以就到两轮为止。 */
      const per = !!preset.layout.perWordSizeAlgorithm;
      const base = items;                              // **没缩放的**那一遍，宽度永远从它量
      let scales = null, key = '';
      for (let pass = 0; pass < 2; pass++) {
        const lns = linesOf(preset, items, wrapW);     // 行的划分从**当前这一遍**取
        const k2 = JSON.stringify(lns);
        if (pass && k2 === key) break;                 // 行没变，倍率也不会变
        key = k2;
        scales = measureScales(preset, base, scaleGroups(preset, base, lns), boxW);
        items = gaps(build(per ? undefined : scales[0], per ? scales : null));
      }
      computedScale = per ? undefined : scales[0];
      /* 逐行那一档还有第二条落法：`overwriteWithComputedScale`（Zen One）——规则跑完之后
         把量出来的倍率直接顶到 `scale` 上。`applyRules` 的 ctx 只收一个标量，所以补在这里。 */
      if (per) {
        items.forEach((x, i) => {
          if (!x.wp.overwriteWithComputedScale) return;
          x.wp.scale = [scales[i], scales[i]];
          x.face = faceOf(preset, x.wp, fontPx, layoutScaleOf(
            layersFor(preset, 'word', x.tags, wins[i], prevOf(i), [0, cueDur], undefined)));
          const m = measure(x.text, x.face);
          x.natW = m.w; x.ascent = m.ascent; x.descent = m.descent;
        });
        gaps(items);
      }
    }

    const cur = c.cur === undefined ? n - 1 : c.cur;
    const idx = Math.max(0, Math.min(cur < 0 ? 0 : cur, n - 1));
    /* 「一次一词」不是一条规则，是**排版的结果**（第 71 轮改正）。上一轮按
       `wordVisibility: "transient"` 硬性只画当前那一个词，那是错的：
       Terminal / Zen One / Quill / Linen 四份也写着 transient，画面上却都该**逐词累积**。
       真正让 Slab 与 Zest 一次只出一个词的是它们自己的数据——`wrapWidth: 0.15`（折行宽
       只有画面的 15%，一个词就撑满）＋ `maxLines: 1`（堆叠窗口只留一行）。所以这里什么
       都不特判：折行 ＋ 堆叠窗口算完，一次一词自己就出来了。
       静息拍（cur = n）落在末行、cue 未开始（cur = −1）落在首行——那一格画面上是不是空的，
       由每个词自己的窗口决定（没到窗口就是首帧），不由这里兜底。 */
    const lines = windowLines(preset, linesOf(preset, items, wrapW), idx);

    // 行几何：每行按本行最大字号定行距与基线；对齐取本行首词的 align，没有就取涂装的
    const lhF = (preset.paint.lh || 100) / 100;
    const align = (ln) => items[ln[0]].wp.align || preset.paint.align || 'center';
    const out = [];
    let y = 0, maxW = 0;
    lines.forEach((ln) => {
      let w = 0, a = 0, d = 0, big = 0;
      ln.forEach((i, j) => {
        w += (j ? items[i].gap : 0) + items[i].natW;
        if (items[i].ascent > a) a = items[i].ascent;
        if (items[i].descent > d) d = items[i].descent;
        if (items[i].face.sizePx > big) big = items[i].face.sizePx;
      });
      out.push({y: y, h: big * lhF, ascent: a, descent: d, w: w, align: align(ln), words: ln,
        hot: ln.some((i) => isHot(items[i]))});
      y += big * lhF;
      if (w > maxW) maxW = w;
    });
    // 深度排版（Backdrop 一族）：两组分到两条轴上，原地改每一行的 `y`
    const depth = placeDepth(preset, out, fontPx);
    const totalH = depth ? depth.h : y;
    const cw = boxW || maxW;
    out.forEach((L) => {
      // 行框比字高时把基线放在行框中间，行框比字矮（Cascade 的 lh 0.8）时就贴着字走
      const base = L.y + Math.max(0, (L.h - (L.ascent + L.descent)) / 2) + L.ascent;
      let x = L.align === 'left' ? 0 : L.align === 'right' ? cw - L.w : (cw - L.w) / 2;
      L.x = x;
      L.baseline = base;
      L.words.forEach((i, j) => {
        const it = items[i];
        if (j) x += it.gap;
        it.x = x; it.baseline = base;
        it.win = wins[i]; it.prev = prevOf(i);
        x += it.natW;
      });
    });

    /* ---- 画布是硬边界 ----
       DOM 那一路溢出照样画得出来（`.vcm` 的 `::before` 想伸多远伸多远），canvas 画到框外
       就是没了。所以这里把每个词在**自己窗口上的竖直最远处**采出来：块（Memo 的绿条在
       基线下 0.8em、Linen 的柔光高 3.6em、Glass 的底板）、绘制变形（Whisper 的 0→1 弹入）、
       阴影与描边（Terminal 的绿辉光）都算进去，再整体下移，让画布正好装得下。
       采样点取窗口两端各外扩 25% 的七个时刻——通道的极值都在段边界上，七个点够。 */
    const SAMP = 6;
    let top = 0, bot = totalH;
    const grow = (a, b) => { if (a < top) top = a; if (b > bot) bot = b; };
    out.forEach((L) => L.words.forEach((i) => {
      const it = items[i];
      const fzw = it.face.sizePx;
      const wt = it.baseline - it.ascent, wh = it.ascent + it.descent;
      const deco = paintDeco(preset.paint, fzw);
      const halo = (deco.shadow ? deco.shadow.blur + Math.abs(deco.shadow.dy) : 0)
        + (deco.stroke ? deco.stroke.w : 0);
      grow(wt - halo, wt + wh + halo);
      const span = it.win[1] - it.win[0];
      const w0 = it.win[0] - span * 0.25, w1 = it.win[1] + span * 0.25;
      const cs = it.cs === undefined ? computedScale : it.cs;
      const scopes = [['word', null, null], ['char', [it.win[0], it.win[0] + span], it.prev]];
      if (!needsChars(preset.k)) scopes.pop();
      scopes.forEach((sc) => {
        const ly = sc[0] === 'word'
          ? wordLayers(preset, it, cueDur, cs)
          : layersFor(preset, 'char', it.tags.concat(it.gtags), sc[1], sc[2], [0, cueDur], cs);
        if (!ly.length) return;
        for (let s2 = 0; s2 <= SAMP; s2++) {
          const st = stateAt(ly, w0 + (w1 - w0) * s2 / SAMP, {skipLayoutScale: true});
          const cy = wt + wh / 2 + st.ty * fzw, hh = (wh * Math.abs(st.sy)) / 2;
          grow(cy - hh - st.blur * fzw, cy + hh + st.blur * fzw);
          if (st.shadow) {
            const sb = (st.shadow.size || 0) * fzw + Math.abs((st.shadow.offset[1] || 0) * fzw);
            grow(cy - hh - sb, cy + hh + sb);
          }
          if (!st.box) continue;
          const r = boxRect(st.box, it.x, wt, it.natW, wh, fzw);
          grow(r.y - r.blur * 2, r.y + r.h + r.blur * 2);
        }
      });
    }));
    if (scopesOf(preset.k).indexOf('global') >= 0 && out.length) {
      const gl = layersFor(preset, 'global', [], [0, cueDur], [-cueDur, 0], [0, cueDur], computedScale);
      const L0 = out[0], LN = out[out.length - 1];
      const gt = L0.baseline - L0.ascent, gh = LN.baseline + LN.descent - gt;
      for (let s2 = 0; s2 <= SAMP; s2++) {
        const st = stateAt(gl, (cueDur * s2) / SAMP, {skipLayoutScale: true});
        if (!st.box) continue;
        const r = boxRect(st.box, 0, gt, maxW, gh, fontPx);
        grow(r.y - r.blur * 2, r.y + r.h + r.blur * 2);
      }
    }
    if (top < 0) {
      out.forEach((L) => { L.y -= top; L.baseline -= top; L.words.forEach((i) => { items[i].baseline -= top; }); });
      bot -= top;
    }

    // 字形簇：窗口是这个簇在词窗里的那一片（`word.codepointTiming` 没有时均分）
    const chars = needsChars(preset.k);
    if (chars) {
      out.forEach((L) => L.words.forEach((i) => {
        const it = items[i];
        const gs = c.graphemes ? c.graphemes(it.text) : Array.from(it.text);
        const span = (it.win[1] - it.win[0]) / Math.max(1, gs.length);
        let cx = it.x;
        it.chars = gs.map((g, j) => {
          const w = measure(g, it.face).w;
          const o = {g: g, x: cx, w: w,
            win: [it.win[0] + j * span, it.win[0] + (j + 1) * span],
            prev: [it.win[0] + (j - 1) * span, it.win[0] + j * span]};
          cx += w;
          return o;
        });
      }));
    }

    /* 「墨迹带」＝ 字**落定之后**占的那一段（行框的上下沿），不含入场轨迹撑出来的空档。
       `boxH` 是画布高，为了装下 Backdrop+ 那种从 −3em 外面飞进来的词，它可以比墨迹高
       一倍多，而多出来的那一截**全是空的**。宿主格子按 `boxH` 居中，就等于把空档也算进
       中线——Backdrop+ 的字会被顶出格子。所以这里把墨迹带一起报出去，视图按它对中。 */
    const ink = out.length
      ? {top: out[0].baseline - out[0].ascent,
        bot: out[out.length - 1].baseline + out[out.length - 1].descent}
      : {top: 0, bot: Math.max(1, bot)};
    return {k: preset.k, fontPx: fontPx, boxW: cw, boxH: Math.max(1, bot), cueDur: cueDur,
      computedScale: computedScale, depth: depth, ink: ink, cur: idx, scopes: scopesOf(preset.k),
      lines: out, words: items, wins: wins};
  }

  /* ---------- 绘制指令表 ----------
     `kind: 'box'` 的几何 = 这个词（或字形簇、或整条）的排版框 ＋ 预设的 `padding` 外扩，
     再按 `position` / `scale` 变形。排版框的高取实测的 `ascent + descent`（＝ 浏览器给
     inline-block 的那个高），宽取步进宽。

     **块高有下限**：Memo 的 `padding.y` 恒在 −1.5em，按字面算高度是负的，
     而那条绿条（232×288 的画面上）该**整个扫入过程恒定 2px**、
     字号 ≈14.5px ⇒ 0.14em——所以对块的高做下限钳制，且下限不随 padding 变。
     宽度那一路没有下限（扫入起点 1px）。所以：宽 `max(0, …)`、高 `max(0.14em, …)`。 */
  const BOX_MIN_H_EM = 0.14;

  /** 涂装那一路的描边 / 阴影（`paintCss` 的同一套换算，单位是 px）。 */
  function paintDeco(paint, fz) {
    const out = {stroke: null, shadow: null};
    if (paint.outline) {
      out.stroke = {w: Math.max(0.5, +(fz * 0.05 * ((paint.outlineW || 8) / 8)).toFixed(2)),
        color: paint.outlineColor};
    }
    if (paint.shadow) {
      const a = ((paint.shAngle == null ? 90 : paint.shAngle) * Math.PI) / 180;
      const d = (paint.shDist == null ? 12 : paint.shDist) / 100 * fz;
      const b = (paint.shBlur == null ? 24 : paint.shBlur) / 100 * fz;
      // 距离为 0 = 辉光：往四周铺一圈，而不是往某个方向投一份
      out.shadow = d === 0
        ? {dx: 0, dy: 0, blur: b * 2.2 + 2, color: paint.shColor, glow: true}
        : {dx: Math.cos(a) * d, dy: Math.sin(a) * d, blur: b, color: paint.shColor, glow: false};
    }
    return out;
  }

  function boxRect(bs, x, y, w, h, fz) {
    // 单位：默认 em（×字号），量级 ≥ 10 的那一条按 px 解（见 `bigUnit` 上面那段）
    const uP = bs.padPx ? 1 : fz, uT = bs.posPx ? 1 : fz;
    const px = bs.px * uP, py = bs.py * uP;
    const bw = Math.max(0, w + 2 * px) * bs.sx;
    const bh = Math.max(BOX_MIN_H_EM * fz, h + 2 * py) * bs.sy;
    const cx = x + w / 2 + bs.tx * uT, cy = y + h / 2 + bs.ty * uT;
    return {x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh,
      r: Math.min(bs.r * fz, bw / 2, bh / 2), blur: bs.blur * fz};
  }
  function boxOp(bs, x, y, w, h, fz, blend) {
    const r = boxRect(bs, x, y, w, h, fz);
    return {kind: 'box', x: r.x, y: r.y, w: r.w, h: r.h, r: r.r,
      fill: bs.color, alpha: bs.alpha, blur: r.blur, blend: blend || null};
  }

  /** 一份 preset 在 `t`（秒，cue 相对）上的绘制指令表。按绘制顺序，全数值。
   *  `blend` 是整条要交给合成器的混合模式（Slab 的 exclusion / Fusion 的 difference）——
   *  canvas 画不到自己底下的画面，那一格归视图挂在 canvas 元素上。 */
  function plan(preset, layout, t, ctx) {
    const c = ctx || {};
    const ops = [];
    const cue = [0, layout.cueDur];
    const cs = layout.computedScale;
    const paint = preset.paint;
    let blend = null;

    // 整条那一档：Glass 的毛玻璃底板。窗口是整条 cue
    let gst = null;
    if (layout.scopes.indexOf('global') >= 0) {
      const gtags = [];
      layout.words.forEach((it) => liveTags(preset, 'global', it.wp.tags)
        .forEach((t) => { if (gtags.indexOf(t) < 0) gtags.push(t); }));
      gst = stateAt(layersFor(preset, 'global', gtags, cue, [-layout.cueDur, 0], cue, cs), t,
        {skipLayoutScale: true});
      if (gst.box && layout.lines.length) {
        const L0 = layout.lines[0], LN = layout.lines[layout.lines.length - 1];
        const x = Math.min.apply(null, layout.lines.map((L) => L.x));
        const w = Math.max.apply(null, layout.lines.map((L) => L.w));
        const top = L0.baseline - L0.ascent, bot = LN.baseline + LN.descent;
        ops.push(boxOp(gst.box, x, top, w, bot - top, layout.fontPx, null));
      }
    }

    layout.lines.forEach((L) => {
      // 行那一档：窗口是行首词起、行尾词止（Linen 的字重、Terminal 的绿色辉光）
      let lst = null;
      if (layout.scopes.indexOf('line') >= 0) {
        const w0 = layout.words[L.words[0]], wN = layout.words[L.words[L.words.length - 1]];
        /* 行那一档也吃**逐词规则给的标签**（第 72 轮补）：Backdrop+ 与 Blaze 的
           `fadeInWithLine` 是挂在词规则上、内容却是 `lineAnimations` 的——只有非高亮词带它，
           于是「正文那几行逐行淡入、高亮那一行不淡」正是它想要的。取本行所有词的标签并集
           （`liveTags` 过掉这一档没有条目的），不取 `[]`，否则整条标签路都收不到。 */
        const ltags = [];
        L.words.forEach((i) => liveTags(preset, 'line', layout.words[i].wp.tags)
          .forEach((t) => { if (ltags.indexOf(t) < 0) ltags.push(t); }));
        lst = stateAt(layersFor(preset, 'line', ltags, [w0.win[0], wN.win[1]],
          [w0.win[0] - BEAT, w0.win[0]], cue, cs), t, {skipLayoutScale: true});
      }
      L.words.forEach((i) => {
        const it = layout.words[i];
        const fz = it.face.sizePx;
        const st = stateAt(wordLayers(preset, it, layout.cueDur,
          it.cs === undefined ? cs : it.cs), t, {skipLayoutScale: true});
        const alpha = st.alpha * (lst ? lst.alpha : 1) * (gst ? gst.alpha : 1);
        if (st.blend) blend = st.blend;
        if (!(alpha > 0.001)) return;                    // 还没到自己的窗口：首帧多半就是隐形

        // 变形原点是词框的中心（与块同一个原点）——放在基线上会让 scale 把词往上抽
        const top = it.baseline - it.ascent, h = it.ascent + it.descent;
        const tf = {ox: it.x + it.natW / 2, oy: top + h / 2,
          tx: (st.tx + (lst ? lst.tx : 0)) * fz, ty: (st.ty + (lst ? lst.ty : 0)) * fz,
          sx: st.sx, sy: st.sy * it.face.squash, rot: st.rot + (lst ? lst.rot : 0)};
        const deco = paintDeco(paint, fz);
        const anim = st.shadow || (lst && lst.shadow);
        const shadow = anim
          ? {dx: (anim.offset[0] || 0) * fz, dy: (anim.offset[1] || 0) * fz,
            blur: (anim.size || 0) * fz, color: anim.color, glow: false}
          : deco.shadow;
        const ol = st.outline || (lst && lst.outline);
        const stroke = ol ? {w: (ol.size || 0) * fz, color: ol.color} : deco.stroke;
        // 词那一档 > 行那一档 > 逐词规则算出来的字面（`faceOf`）
        const pick = (a, b, c) => (a !== null ? a : (b !== null && b !== undefined ? b : c));
        const face = {family: st.family ? fontOf(st.family).stack : it.face.family,
          sizePx: fz,
          weight: pick(st.weight, lst && lst.weight, it.face.weight),
          italic: pick(st.italic, lst && lst.italic, it.face.italic)};
        const fill = st.color || it.face.color;
        const track = ((st.spacing !== null ? st.spacing : it.face.trackEm)) * fz;

        // 词那一档的块（Memo 的绿条、Fusion 的大底）：画在字下面
        if (st.box) ops.push(boxOp(st.box, it.x, top, it.natW, h, fz, null));

        if (!it.chars) {
          ops.push({kind: 'text', text: it.text, x: it.x, y: it.baseline, face: face,
            tracking: track, fill: fill, alpha: alpha, blur: st.blur * fz,
            shadow: shadow, stroke: stroke, tf: tf});
          return;
        }
        // 字形簇那一档：每个簇自己的窗口（打字机、Whisper 的逐字聚焦、Terminal 的光标）
        it.chars.forEach((g, j) => {
          const cst = stateAt(layersFor(preset, 'char', it.tags.concat(it.gtags || []),
            g.win, g.prev, cue, it.cs === undefined ? cs : it.cs), t, {skipLayoutScale: true});
          const ca = alpha * cst.alpha;
          if (!(ca > 0.001)) return;
          if (cst.box) ops.push(boxOp(cst.box, g.x, top, g.w, h, fz, null));
          ops.push({kind: 'text', text: g.g, x: g.x, y: it.baseline, face: face,
            tracking: track, fill: cst.color || fill, alpha: ca,
            blur: (st.blur + cst.blur) * fz, shadow: shadow, stroke: stroke,
            tf: Object.assign({}, tf, {tx: tf.tx + cst.tx * fz, ty: tf.ty + cst.ty * fz})});
        });
      });
    });
    return {w: layout.boxW, h: layout.boxH, blend: blend, ops: ops};
  }


  /* ---------- 视图要问的那几件事 ---------- */

  const byKey = (k) => PRESETS.find((p) => p.k === k) || null;
  /** 这份要不要视图量宽再把 `computedScale` 灌回来（`sizeOverrideAlgorithm` / `perWordSizeAlgorithm`
   *  的输出就是 `inject:{source:"computedScale"}` 读的那个值）。 */
  function needsMeasure(k) {
    const p = byKey(k);
    if (!p) return false;
    return !!(p.layout.sizeAlgorithm || p.layout.perWordSizeAlgorithm);
  }
  /** 这份要不要把词拆到字形簇（`characterAnimations` 非空——`hasCharacterAnimations` 那一位
   *  没有消费端，取动画时也是看有没有条目，不是看那一位）。 */
  function needsChars(k) {
    const p = byKey(k);
    if (!p) return false;
    if ((p.ir.char || []).length) return true;
    return Object.keys(p.ir.tags).some((t) => (p.ir.tags[t].char || []).length);
  }
  /** 一次只显示一个词（`wordVisibility: "transient"`）还是逐词堆叠留着（`persistent`）。 */
  const wordVisibility = (k) => { const p = byKey(k); return p ? p.layout.wordVisibility : null; };
  /** 这份用到哪几档（视图要接哪几路）。 */
  function scopesOf(k) {
    const p = byKey(k);
    if (!p) return [];
    const out = [];
    ['word', 'char', 'line', 'global'].forEach((s) => {
      if ((p.ir[s] || []).length || Object.keys(p.ir.tags).some((t) => (p.ir.tags[t][s] || []).length)) out.push(s);
    });
    return out;
  }
  /** `spacing` 的 off-by-one：字距在字之间，所以范围是 `[from, to-1]`，单字符整条跳过。 */
  const rangeOf = (type, from, to) => (type === 'spacing' ? [from, to - 1] : [from, to]);
  const spacingApplies = (charCount) => charCount > 1;
  /** `capitalize` **没有实现**——只认 uppercase / lowercase，其余原样。 */
  function applyCasing(text, casing) {
    if (casing === 'uppercase' || casing === 'upper') return String(text).toUpperCase();
    if (casing === 'lowercase' || casing === 'lower') return String(text).toLowerCase();
    return String(text);
  }
  /** 目录卡：`data.js` 的「动效字幕」那一区从这里派生（id 就是 preset id）。 */
  function cards() {
    return PRESETS.map((p) => ({id: p.k, name: p.label, form: 'orig', cat: 'designed',
      caption: p.k, anim: 'none', look: null}));
  }

  window.BC_VC = {
    PRESETS, FONTS, EASE, BEAT_MS, BEAT, CHAR_MS, WIN, SAMPLE_ON, ALGORITHMS, RANK_NUM, RANK_TIER,
    byKey, cards, fontOf, fontFamilies, ease01, bezierPoint,
    resolveTime, resolveChannel, sampleChannel, constantOf, lerpV,
    clampRank, rankName, rankNum, cmp, evalPredicate, demoRanks, wordContexts, applyRules,
    injectContext, resolveInject, resolveInjects, scaleOpacity, scaleLuminosity,
    entriesFor, groupsConsecutive, consecutiveRuns, wordTracks,
    layersOf, wordLayers, stateAt, layoutScaleOf, isLayoutScale, measureScales, scaleGroups,
    linesOf, windowLines,
    hideSpliced, HIDE_SENTINEL, highlightStyleOf, depthAxes, DEPTH_GAP_EM,
    captionFontPx, SIZE_REF, SIZE_MIN, BOX_MIN_H_EM, paintDeco, layoutOf, plan, stillT,
    needsMeasure, needsChars, wordVisibility, scopesOf, rangeOf, spacingApplies, applyCasing,
    highlightPaint, withHighlightStyle,
  };
})();
