# 字幕编辑器重设计：样式库、模板调整与分层外观

状态：提案，原型先行（2026-10-25）。本文定义字幕样式编辑器的下一版：能浏览、套用和调整成百上千份**模板样式**（`baocut.caption-scene-style/1`，含从样式包导入的），并把内置样式从 43 份扩到 103 份。原型按本文改；Electron / Web、Runtime 与核心的改动等用户确认原型后再做（[开发流程 §3](../../development-workflow.md#3-多端同步)）。样式模型的七个维度沿用[字幕样式模型](caption-style-model-design.md)，场景格式沿用[动态字幕格式](dynamic-caption-format-design.md)与[视频格式 §5.6](../../spec/video-format-spec.md#56-layoutprofile样式与导出)，本文只写在它们之上新增或改变的部分。

## 目录

1. [目标与结论](#1-目标与结论)
2. [现状与差距](#2-现状与差距)
3. [两类样式](#3-两类样式)
4. [组合样式 v2：分层外观](#4-组合样式-v2分层外观)
5. [模板调整层 `adjust`](#5-模板调整层-adjust)
6. [场景摘要](#6-场景摘要)
7. [样式包](#7-样式包)
8. [效果标签与适配判定](#8-效果标签与适配判定)
9. [界面](#9-界面)
10. [内置样式扩充](#10-内置样式扩充)
11. [归属、作用域与偏好](#11-归属作用域与偏好)
12. [落地顺序与验收](#12-落地顺序与验收)
13. [与现有规格、原型的差异](#13-与现有规格原型的差异)
14. [待评审事项](#14-待评审事项)

## 1. 目标与结论

- **所有样式最终都是场景**。内置样式由组合样式编译成 `caption-scene`，模板样式本身就是场景。画廊缩略图、画布预览与成片走同一个渲染器，缩略图才等于成片。
- **两类样式，一个入口**。组合样式（`baocut.caption-style/2`）可以逐项编辑；模板样式只能**调整**颜色、字体、大小、位置、关键词与「换一版」，其余结构原样保留。属性页按样式的类别换页，用户不需要知道背后是哪种正文。
- **编辑器不求值**。界面要知道一份模板里有几种颜色、各用在哪里、用了什么字体、读哪些词标签，全部来自核心的场景摘要（§6），界面不解析表达式树。
- **样式包是外部样式的唯一入口**。批量导入的模板以样式包（§7）安装到应用数据，套用时冻结进视频。BaoCut 自身不随附任何第三方模板。
- **内置样式扩到 103 份**，新增 60 份用到渐变、多层描边、内阴影、发光、纹理、弹性入场、逐行入场与关键词（§10）。分区仍只按气质分，技术特征用效果标签筛（§8）。

## 2. 现状与差距

| 方面 | 现状 | 差距 |
| --- | --- | --- |
| 真实编辑器 | 43 份预设，正文是七维模型，编译到 Studio 样式；画廊缩略图由真渲染器画 | 只认 Studio：视频的样式一旦是场景，画廊显示「无法套用」、属性页显示格式说明 |
| 核心 | 能解析、校验、渲染 `caption-scene-style/1`，预览 WASM 与导出共用 | 没有调整层，没有给界面用的摘要 |
| 智能体与流程 | `setCaptionStyle` 只收 Studio 补丁；转写、翻译、生成字幕层只产出 Studio | 不能把模板样式写进视频，不能改 `presentation` |
| 导入的模板 | 每份是一份完整场景：颜色与字体写成字面值，参数只有内部计时常量，落位全是导入工具的默认值；约 2/3 有描边、1/2 有阴影、1/3 是多行页，约 150 份按关键词标签换色换字号，约 60 份带表情装饰 | 不能换色、换字体、挪位置；关键词标签没人写；没有名字以外的分类信息给界面 |
| 品牌库 | 存任意正文，上限 64 KiB；场景里的图片资源是某部视频内的 `id@revision` | 大场景存不下；带图片的样式换一部视频就丢资源 |

## 3. 两类样式

| | 组合样式 | 模板样式 |
| --- | --- | --- |
| 正文 | `baocut.caption-style/2`（§4） | `baocut.caption-scene-style/1` + `adjust`（§5） |
| 来源 | 内置、我的品牌库、用户调过的 | 样式包（§7）、智能体写入、旧视频 |
| 可编辑 | 七个维度的每一项 | 只调整：颜色、字体、大小、位置、关键词、换一版 |
| 渲染 | 编译成场景再渲染 | 调整层预处理后直接渲染 |
| 属性页 | 外观 / 动画 / 排版三页（§9.2） | 调整页（§9.3） |

组合样式可以另存为模板样式（编译结果冻结），反方向不支持：场景可能含有七维面板表达不了的结构，硬摊平会丢效果。

## 4. 组合样式 v2：分层外观

`baocut.caption-style/2` 在 `/1` 的七个维度上改三处：涂装改成涂装栈，当前词与动效各补几种，落位加分页。没有改动的字段沿用[字幕样式模型 §3](caption-style-model-design.md#3-模型七个维度)。

```ts
interface CaptionStyleBodyV2 {
  schema: 'baocut.caption-style/2';
  typography: Typography;               // 同 /1
  surface: SurfaceStack;
  layout: LayoutV2;
  activeWord: ActiveWordV2;
  motion?: MotionV2;
  emphasis?: EmphasisLookV2;
  preset?: { id: string; revision: number };
}

interface SurfaceStack {
  fill: Fill;                                   // 字身
  strokes: { color: string; width: number }[];  // 0–3 层，由内向外；width 为这一圈朝外看得见的厚度（em），逐圈叠加
  shadows: { color: string; offset: [number, number]; blur: number; inner?: boolean }[];  // 0–3 层，em
  glow?: { color: string; radius: number; strength: number };   // radius 为 em，strength 0–1
  plate?: Plate;                                 // 同 /1 的 surface.plate
  wordBox?: WordBox;                             // 同 /1 的 surface.wordBox
}
type Fill =
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; angle: number; stops: [number, string][] }   // 2–5 个色标，位置 0–1
  | { kind: 'texture'; texture: string; tint?: string };           // 内置纹理库的 id

interface LayoutV2 extends Layout {             // Layout 同 /1
  pagination?: { wordsPerPage: number | null; rows?: number[] | null };   // 每页词数；rows 是每页逐行的词数
}
interface ActiveWordV2 extends ActiveWord {     // ActiveWord 同 /1，mode 多三种
  mode: ActiveWord['mode'] | 'pop' | 'stretch' | 'glow';
  glow?: { color: string; radius: number };
}
interface EmphasisLookV2 extends EmphasisLook { // EmphasisLook 同 /1
  fill?: Fill;
  strokeColor?: string;
}
```

- **涂装栈的绘制次序**：外层描边 → 阴影 → 内层描边 → 字身 → 内阴影；发光画在所有层的最下面。它编译成场景节点的 `paints`（[动态字幕格式 §9.1](dynamic-caption-format-design.md#91-涂装栈)），渐变走 `caption-gradient-glyph/1` 或 `caption-gradient-space/1`，纹理走 `caption-image-paint/1`，内阴影走 `caption-glyph-distance-coverage/1`，发光走 `caption-glow-cascade/1`。
- **纹理只来自内置纹理库**。纹理是应用随附的一组 PNG（纸张、金属、霓虹管、粉笔、油墨），套用时作为资源冻结进视频；不接受用户在组合样式里引用任意图片（那是模板样式的事）。
- **当前词新增三种**：`pop` 是弹性超调放大（[动态字幕格式 §11](dynamic-caption-format-design.md#11-动画配方目录)「弹性超调入场」），`stretch` 是横向拉伸并按真实字号重排（「朗读词横向拉伸」），`glow` 是当前词发光。
- **动效新增六种**，都取自同一张配方目录：入场 `elastic-pop`（弹性超调，逐词，念到时）、`line-slide`（逐行滑入，带错开）、`feather`（羽化显现，逐字，页时钟）、`char-stagger`（逐字错峰）、`typewriter-cursor`（打字机带光标）；循环 `slow-push`（整页慢推）。
- **分页**：`wordsPerPage` 为 null 时按 LayoutProfile 换行（同 `/1`）；给了就是固定词数分页，`rows` 再给每页逐行的词数（如 `[2, 1]` 是两行，上二下一），编译到场景的 `pagination.wordLinePattern`。
- **描边只收纯色**。width 量的是这一圈露在外面的厚度，不是居中笔宽：三层描边各写各的厚度，叠起来就是最外一圈到字形的距离。
- **`/1` 升级到 `/2` 是机械的**：`surface.color` → `fill: solid`，`stroke` → `strokes[0]`（`/1` 的 width 是居中笔宽，升级时减半），`shadow` → `shadows[0]`，`glow {color, intensity, range}` → `glow {color, radius: range, strength: intensity}`，其余原样。打开 `/1` 正文时升级，保存写 `/2`。

编译目标从 Studio 改为场景：`compileCaptionStyle(body, ctx) → CaptionSceneStyleBody`，`ctx` 同[字幕样式模型 §8](caption-style-model-design.md#8-编译到内核新正文--studio-样式)。旧 Studio 编译保留到所有入口切换完成，期间 43 份旧预设两条编译路径的帧逐像素对拍。

## 5. 模板调整层 `adjust`

模板样式的调整写在样式正文上，由核心在场景编译前做一次纯函数预处理，模板正文本身不改：

```ts
interface CaptionSceneStyleBody {
  schema: 'baocut.caption-scene-style/1';
  scene: { kind: 'inline'; value: CaptionScene };
  parameters?: Record<string, CaptionParameterValue>;
  adjust?: CaptionSceneAdjust;            // 新增
  origin?: CaptionStyleOrigin;            // 新增，只做来源与还原，不参与渲染
}

interface CaptionSceneAdjust {
  colors?: { from: string; to: string }[];        // 按值换色，from 不重复
  fonts?: { from: string; to: { family: string; weight?: number; italic?: boolean } }[];  // from 是摘要里的字体键
  fontScale?: number;                              // 0.5–2，缺省 1
  placement?: { x?: number; y?: number; width?: number };   // 画布宽 / 高的比例，覆盖 layout 的常量
}

interface CaptionStyleOrigin {
  pack?: { id: string; version: string };
  template: { id: string; revision: number };
  sceneSha256: string;                    // 调整前场景的规范化摘要
}
```

规则：

- **换色按值，覆盖全部字面量位置**：节点 `style.fill`、涂装层、`paintStyleBindings`、`stateStyles`、动画关键帧与表达式里的颜色常量、材质参数。比较前把颜色规范成 `#RRGGBBAA`；`to` 没写透明度时保留原色的透明度。参数默认值里的颜色不换（参数用 `parameters` 改）。
- **换字体**重新整形与排版；字号、行框按新字体的度量重算。模板为某款字体调过的手工字距不跟着换，摘要（§6）对「字距调过」的模板给出提示，界面在换字体时说明。
- **`fontScale`** 乘到所有文字与装饰标签节点的字号（含字号绑定的结果），排版重算；以 em 表达的涂装宽度随字号走，以画布比例表达的长度不变。
- **`placement`** 只覆盖 `layout.x / y / width` 中的常量；某一项由参数或表达式决定时，这一项报 `CAPTION_ADJUST_UNSUPPORTED`，其余照常生效。
- 调整层不改变求值版本与能力集合；同一份正文在三个表面与导出得到同一帧。
- **时间倍率**（整体加快或放慢动画）暂不提供，见 §14。

`origin` 让界面做三件事：画廊勾选态、「已调整 · 还原」、样式包升级时提示「有新版本」。还原是删掉 `adjust`，不是重新下载模板。

## 6. 场景摘要

核心提供 `describeCaptionScene(scene, adjust?) → CaptionSceneSummary`，Runtime 与预览 WASM 都暴露它。界面的调整页、画廊的效果标签与适配判定只读它：

```ts
interface CaptionSceneSummary {
  colors: { value: string; uses: ColorUse[]; animated: boolean; area: number }[];  // area：在样张上的覆盖占比，用于排序
  fonts: { key: string; family: string; weight: number; italic: boolean; scripts: string[]; tunedSpacing: boolean }[];
  wordTags: string[];                     // 选择器读取的词标签，如 'keyword'
  behaviors: EffectTag[];                 // §8
  tiers: ('glyph-motion' | 'text-paint' | 'texture-effects' | 'derived-decoration')[];
  needsWordTiming: boolean;
  seeded: boolean;                        // 结果随 presentation.seed 变化
  pagination: { mode: 'auto' | 'fixed'; wordsPerPage?: number };
  layers: { nodeId: string; kind: 'fill' | 'stroke' | 'shadow' | 'inner-shadow' | 'glow' | 'plate' | 'box' | 'image' | 'material'; detail?: string }[];
  adjustable: { colors: boolean; fonts: boolean; placement: boolean; fontScale: boolean };
}
type ColorUse = 'text' | 'stroke' | 'shadow' | 'glow' | 'plate' | 'word-box' | 'active' | 'read' | 'unread' | 'keyword' | 'material';
```

- `uses` 从颜色出现的位置推出：字身填充是 `text`，扩张涂装是 `stroke`，带偏移的涂装是 `shadow`，`stateStyles.active` 与按 active 过滤的绑定是 `active`，按词标签过滤的绑定是 `keyword`，以此类推。同一颜色可以有多个用途。
- `scripts` 是字体覆盖的文字系统（ISO 15924），用于判定「字体不含这门语言的字」。
- 传了 `adjust` 时，颜色与字体条目照旧以模板原值为键，另带调整后的值 `to`；调整页的色块与字体行直接读 `to`，不必自己再套一遍调整。
- 摘要是派生数据，按场景摘要缓存，不落盘。

## 7. 样式包

样式包是一组模板样式的分发单位：

```ts
interface CaptionStylePackManifest {
  schema: 'baocut.caption-style-pack/1';
  id: string; version: string;
  name: LocalizedText; publisher?: string; license?: string;
  categories: { id: string; name: LocalizedText }[];   // 包自己的分区
  styles: {
    id: string; revision: number;
    name: LocalizedText; categories: string[]; tags?: EffectTag[];
    body: string;                       // 包内路径，baocut.caption-scene-style/1
    preview?: string;                   // 包内路径，动图，只做列表占位
    fonts: { family: string; sha256: string; path: string }[];
    resources: { sha256: string; path: string }[];   // PNG 与图片序列
  }[];
}
type LocalizedText = string | Record<string, string>;   // 语言标签 → 文字
```

- **安装位置**：应用数据（与下载的字体同处），不进项目。安装时核心逐条校验场景；不能渲染的（未知能力、超预算）照样列出，卡上标「这台设备不支持」并给出原因，不悄悄丢掉。
- **套用 = 冻结**：场景内联进视频的 `caption-style` 文档，字体与图片作为视频资产写入，场景里的资源引用改成这部视频的资产；视频因此可以脱离样式包打开、分享与导出。
- **品牌库存引用**：用户把一份模板样式存进品牌库时，存 `origin + adjust` 与样式包里的路径，不存整个场景（64 KiB 上限、资源跨视频两件事一起解决）；样式包被卸载后，这一条显示「样式包已移除」，已经套用到视频里的不受影响。
- 样式包的名称、分区与效果标签由包作者给；没给效果标签时用摘要的 `behaviors`。
- 样式包可以来自文件导入、应用内的下载源，或宿主应用随附；BaoCut 本身的仓库不随附第三方样式包。

## 8. 效果标签与适配判定

效果标签是画廊的筛选维度，描述「能看见什么」，不描述实现：

| 标签 | 名称 | 组合样式里的判据 | 场景里的判据（摘要） |
| --- | --- | --- | --- |
| `active-color` | 当前词变色 | `activeWord.mode` 为 color / scale / lift / pop / stretch | `active` 状态改填充色 |
| `active-box` | 当前词底块 | `mode: box` | active 过滤的形状或底框 |
| `sweep` | 扫色 | `mode: sweep` | 词内进度驱动的填充遮罩 |
| `word-pop` | 逐词弹出 | 入场 `pop / elastic-pop / scale-in / impact / stomp`，或当前词 `pop` | 词时钟驱动的缩放 |
| `reveal` | 逐字显现 | 入场 `typewriter / typewriter-cursor / feather / char-stagger`，或 `unspoken: hidden` | 字素或词的透明度显现 |
| `line-motion` | 整行入场 | 入场单位是 cue / line | 页或行时钟驱动的位移、缩放、透明度 |
| `loop` | 循环动效 | 有 `motion.loop` | 连续时间驱动的位移或旋转 |
| `stroke` | 描边 | `strokes` 非空 | 扩张涂装 |
| `shadow` | 阴影 | `shadows` 非空 | 偏移涂装、内阴影 |
| `glow` | 发光 | `glow` 或 `mode: glow` | 辉光材质、柔化扩张涂装 |
| `gradient` | 渐变 | 任一填充是 `linear` | 渐变涂装 |
| `texture` | 纹理 | 任一填充是 `texture` | 图片涂装 |
| `plate` | 底板 | `plate` 或 `wordBox` | 形状节点 |
| `keyword` | 关键词 | 有 `emphasis` | 读取词标签 |
| `multiline` | 多行排版 | `pagination.rows` 多于一行 | 固定行模式 |
| `decoration` | 表情装饰 | — | 派生装饰 |

**适配判定**对着「这一条轨」给出，不隐藏卡，只在卡上标：

- 需要词级时间而这条轨没有（译文、导入的字幕）：标「这条字幕没有逐词时间，逐词效果不动」。
- 模板样式的字体不覆盖这条轨语言的文字系统：标「字体不含这门语言的字，按回退字体显示」。组合样式的字体走应用的回退链，不标。
- 设备不支持某些能力：标「这台设备不支持」，卡照样陈列，但不可套用、不可编辑。

画廊的「只看合适的」开关把这三类都收起；它不算筛选，「清除筛选」不动它。

## 9. 界面

原型先改（`designs/baocut`），确认后同步 Electron / Web。轨条、「套到」、作用域（全部字幕 / 仅这一条）、双语、显示时间这些不属于样式的部分保持现状（产品设计 §5.9）。

### 9.1 样式库（画廊）

样式页从「分区平铺所有卡」改成**样式库**：

- **页头**：标题「字幕样式」、搜索框、「加宽」开关。加宽把样式库所在的那一栏拉到最大宽度（三到四列），再点回到原来的宽度：时间线视图拉右侧面板（面板宽度本来就可以拖，这只是一个快捷档），审片视图拉右侧栏。拉哪一栏由宿主决定，样式库只管开关。
- **来源**：一排分段——全部 / 内置 / 我的 / 每个已安装的样式包。选「全部」时按来源分区陈列；选一个来源时，下面出现这个来源自己的分区（内置是气质分区，样式包是包作者给的分区）。
- **效果标签**：一排可多选的标签（§8），与搜索、分区取交集；有筛选时列表顶部写「N 份样式 · 清除筛选」。
- **只看合适的**：开关，按 §8 的适配判定收起不合适的卡。
- **收藏与最近**：卡上一颗星；「我的」来源下有「收藏」「最近用过」两个分区。
- **卡片**：缩略图用这条轨当下这句的文字（没有当前句时用样张），在可见时才播放；角标说当前词模式；适配提示是卡底的一行小字；模板样式在名字旁标来源包名。悬停在画面上预览，点击套用（可撤销），铅笔进属性页——这三件沿用现状。
- 样式包有更新时，来源分段上出一个点；不自动升级已套用的样式。

### 9.2 组合样式的属性页

顶部预览条与作用域不变；下面换成三页（S2 Tabs）：

- **外观**：文字（字体、字号、字重、对齐、大小写、行高与字距）＋ **涂装栈**（一段「文字效果」）：字身填充（纯色 / 渐变 / 纹理）、描边（可加到三层，每层颜色与粗细，可上下挪）、阴影（可加到三层，含内阴影）、发光（一个开关）；底板与逐词底块仍在「背景」一段。每一层一行：色块、名字、摘要，点开改参数，可上下挪、可删；不设逐层开关——不要的层删掉，加回来是一键，栈最多三层。长度一律按「占字号的百分比」显示。
- 模板样式（场景样式）不分页，属性页换成调整页（§9.3）；动态排版这类自带整套参数的样式也不分页，沿用一列。
- **动画**：当前词（模式格，含新的弹出、拉伸、发光）与动效（入场 / 退场 / 循环），沿用现有两段。
- **排版**：分页（自动 / 每页几个词 / 逐行词数）、强调词（手动点词 ＋ 外观）、位置、双语、显示时间。

### 9.3 模板样式的调整页

属性页头写「模板样式 · 来自〈包名〉」，下面依次：

1. **颜色**：摘要里的每种颜色一个色块，按用途分组排序（字色、描边、阴影、发光、当前词、关键词、其他），色块旁写用途；改一个色块即一条 `from → to`。动画里用到的颜色标「动画中」。
2. **字体**：模板用到的每款字体一行，可换；换了之后若摘要说「字距调过」，行下写一句提示。
3. **大小**：字号倍率滑杆（50%–200%）。
4. **位置**：沿用组合样式的位置段，写进 `adjust.placement`。
5. **关键词**：模板读词标签时出现。手动点词，写进字幕实例的 `presentation.wordTags`，作用于这一条字幕层；不自动挑词。
6. **换一版**：模板随 seed 变化时出现，换 `presentation.seed`。
7. **构成**：只读，列出效果层（填充、描边、阴影、发光、纹理、材质）、分级与是否需要逐词时间，让用户知道这份样式为什么不能逐项改。
8. 页脚：「已调整 · 还原」与「存到品牌库」。

### 9.4 智能体

智能体与界面写同一份正文：`setCaptionStyle` 增加 `styleDocument` 直接给 `caption-scene-style/1`（含 `adjust`），并增加对 `presentation` 的补丁（`wordTags`、`seed`）。具体命令形状在命令与协议规范落地时定，本文只要求两条路径写同样的字段。

## 10. 内置样式扩充

分区仍只按气质分（[字幕样式模型 §7](caption-style-model-design.md#7-预设与分类)），增加四个：霓虹、电影、可爱、艺术。新增 60 份，合计 103 份：

| 分区 | 原有 | 新增 | 新增部分的特征 |
| --- | --- | --- | --- |
| 基础 | 3 | 2 | 细描边白字、柔和底板 |
| 社交 | 20 | 10 | 双层描边、弹性弹出、逐词底块、渐变当前词 |
| 霓虹 | — | 8 | 发光、霓虹管纹理、扫色 |
| 电影 | — | 8 | 细字距大写、逐行滑入、羽化显现、整页慢推 |
| 可爱 | — | 8 | 粗圆体、双层描边、波浪循环、弹跳 |
| 艺术 | — | 8 | 纸张与油墨纹理、渐变、内阴影、多行排版 |
| 商务 | 6 | 4 | 底板、逐字错峰、低对比当前词 |
| 复古 | 6 | 4 | 硬阴影、金属渐变、打字机光标 |
| 动效 | 7 | 8 | 弹性超调、逐行入场、多行页、关键词放大 |
| 动态排版 | 1 | 0 | 倒鸭子仍是一张卡 |

每份新预设显式写出 `activeWord`；颜色、名称与取值以原型的 `model-subpresets-rich.js` 为准，确认后搬进 `packages/ui`。新预设不复刻任何第三方模板，只组合 §4 的能力。

## 11. 归属、作用域与偏好

| 数据 | 存在哪里 | 「仅这一条」 | 存进品牌库 | 记住为下次的偏好 |
| --- | --- | --- | --- | --- |
| 组合样式的各维度 | 样式文档 | 可以（现有覆盖表） | 是 | 文字外观与位置记住（产品设计 §5.9） |
| 模板样式本身与 `adjust` | 样式文档 | 不可以，整条字幕层一份 | 存引用（§7） | 不记住：模板是一次选择，不是外观偏好 |
| 关键词标签、seed | 字幕实例 `presentation` | 关键词按词，天然逐条 | 否 | 否 |

模板样式不进 cue 级覆盖表：场景按页、跨词求值，单条覆盖会让同一页里前后两条长得不一样。需要某一条不一样时，用作用域「仅这一条」换成组合样式。

## 12. 落地顺序与验收

1. **原型**（本轮）：样式库、模板调整页、分层外观、60 份新预设、演示样式包。
2. **核心**：`adjust` 预处理、`describeCaptionScene`、`caption-style/2` 编译到场景、样式包校验。
3. **Runtime 与协议**：样式包安装与冻结、`setCaptionStyle` 收场景样式、`presentation` 补丁、转写与翻译流程接受场景样式。
4. **界面**：`packages/ui` 的样式库、调整页、分层外观与新预设；缩略图走真渲染器并带 `presentation`。

验收：

- 换色：同一份模板，换色前后只在被换的颜色处有像素差；动画里的颜色同样换掉。
- 换字体、字号倍率与位置：排版重算，三个表面与导出同一帧。
- 样式包：安装、套用、卸载、视频脱离样式包重开与导出一致；带图片的模板换一部视频套用资源齐全。
- 组合样式：43 份旧预设的 Studio 路径与场景路径逐像素一致后才切换默认编译；新 60 份各有一张黄金帧。
- 画廊：一千张卡时首屏可交互时间与滚动帧率达标（只有可见卡在渲染）。

## 13. 与现有规格、原型的差异

- [字幕样式模型 §7](caption-style-model-design.md#7-预设与分类)写「内置预设按现状整理，不新增」，本文新增 60 份与四个分区；§8 的编译目标从 Studio 改为场景。
- [视频格式 §5.6](../../spec/video-format-spec.md#56-layoutprofile样式与导出)：`CaptionSceneStyleBody` 增加 `adjust` 与 `origin`，新增诊断 `CAPTION_ADJUST_UNSUPPORTED`；落地时同步规范。
- 产品设计 §5.9「字幕属性」：样式列表改为样式库（来源、效果标签、搜索、加宽）；模板样式的调整不作为下次的偏好。落地时同步产品设计。
- 品牌库：模板样式存引用而不是正文。
- 原型（`designs/baocut`）是近似画法，不是真渲染：描边用四向 `drop-shadow` 链（方形膨胀）、内阴影是字身顶部一道渐变、纹理是 CSS 渐变代替随附 PNG。涂装栈存在轨的 `layers` 键，同时写回 v1 的字色、第一层描边、第一层阴影，旧读者照读。真实三端走核心场景渲染，以帧为准。
- 样式包、模板调整页与场景摘要（§5–§7、§9.3）在原型里是近似：清单按 `baocut.caption-style-pack/1` 的形状写，但每份样式内联一份**场景草图**（字体、涂装层、词状态、动画名、布局与分页），不是真场景；`describeCaptionScene` 与 `adjust` 预处理由 `app/model-sceneadjust.js` 在草图上模拟，套用时把草图换算成轨上的画法键照旧画。原型装两份通用演示包（`app/model-stylepack-demo.js`），其中一张故意要求设备没有的能力，演示「这台设备不支持」；BaoCut 仓库不随附第三方样式包。
- 原型的三处取舍，落地时以本文 §5、§11 为准：
  - 原型一条轨就是一层字幕，`presentation`（关键词、seed）记在轨上。
  - 套用模板不搬字幕的位置：落位以套用时轨的锚点为准（记作 `home`），「位置」写 `adjust.placement` 的同时写回轨的位置，「还原」回到 `home`。
  - 再点同一份模板（卡上的铅笔）保留已有调整；换一份模板或换回组合样式时，调整、字号倍率与模板落位一起退掉，关键词标签留着。

## 14. 待评审事项

1. **时间倍率**：整体加快或放慢模板动画。场景里的时钟有词时钟、页时钟、固定时长与表达式，统一缩放的语义（按真实词时间的动作不该缩）要逐类定义。
2. **换色的近似色**：模板里同一种视觉颜色有时写成相差一两个单位的几个值，按值相等会分成几个色块。是否在摘要里合并近似色（合并后换色作用于整组）待定。
3. **模板参数的命名**：样式包作者若愿意，可给参数加用途与名字，界面就能显示「速度」「强弱」这类滑杆。这需要扩展 `parameters[]`（现在不收未知字段），与调整层并存。
4. **表情装饰**：约 60 份模板按关键词贴表情，需要实例数据。界面给不给「这个词配哪个表情」的入口，待评审。
