# v2 元素模型与 v3 视频格式的对照

本文是 `crates/timeline` 接线各批的移植输入，记录 v2 `timeline.json` 0.12 与 v3 视频格式逐项的差异与去向；规则以[架构设计](../../architecture/architecture-design.md)（§13.4、§13.6）与[视频格式规范](../../spec/video-format-spec.md)为准，两处与本文不一致时改本文。

## 1. 范围

`crates/timeline` 是 v2 `bcut-timeline` 的原样移植（v2 的规范见 [`bcut-timeline-json-spec.md`](bcut-timeline-json-spec.md)）。它分两半，落点不同：

| 半边 | 模块 | 接线后的落点 |
| --- | --- | --- |
| 时间线语义 | `cuts`、`arrange`、`map`、`follow`、`anchors`、`words`、`match_text`、`detect`、`rules`、`patch`、`keyframes`（取样、拆分、合并、重开窗）、`duck`（区间与曲线） | `editor-semantics` 与 VideoEngine 调用：剪口、语义跟随、关键帧的编辑、按语音闪避 |
| 元素模型 | `schema`、`elements`、`geometry`、`effects`、`animations`、`motion`、`video_elements`、`video_transitions`、`template`、`svg_fill`、`lottie_fill`、`protocol`；`screentext`（画面文字，暂不接线） | 字段进入视频格式与 `video-model`；校验、几何与效果的换算给渲染适配层与编辑器用 |

标记的含义：

- **一致**：v3 有同一个概念，字段可以逐个对上，最多换单位。
- **v3 缺**：v2 有，v3 的格式与 `video-model` 都没有。
- **v3 有而 v2 无**：v3 已经有的字段，v2 没有对应。
- **语义不同**：两边都有，但含义、取值或作用范围不同，需要裁决（见第 7 节）。

`video-model` 指 `crates/video-model/src/` 现有的类型；「规范 §x」指视频格式规范的章节。

## 2. 元素种类

v2 的 `ElementKind` 是封闭枚举，props 与种类一一对应（`schema.rs`）。v3 按用户看到的东西分实例类型，生成类画面统一是合成实例的内置生成器（规范 §3.4、§3.7）。

| v2 `kind` | v3 实例 | 标记 | 说明 |
| --- | --- | --- | --- |
| `video` | `VideoItem`（`TimelineItem::Video`） | 一致 | 只有声音的源导入为 `AudioItem` |
| `image` | `ImageItem` | 一致 | |
| `audio` | `AudioItem` | 一致 | 采样级位置（规范 §2.10） |
| `text` | `TextItem` | 语义不同 | `style` 两边都是不定型的对象；v2 的键由渲染器约定，v3 现在存 `baocut.legacy-text-style/0`（第 5 节） |
| `text` + `counter` | `CompositionItem`，内置 `baocut.counter` | 语义不同 | v2 是文字元素的一种写法，与 `text` 互斥；v3 是生成器，参数合同未定义（规范 §9） |
| `shape` | `ShapeItem` | 语义不同 | `shape` 两边都不定型；v3 现在存 `baocut.legacy-shape/0` |
| `sticker` | `StickerItem`：模板贴纸画目录里的矢量，素材贴纸指向图片、视频或 `lottie` 素材 | 语义不同 | v2 一种元素三种来源；v3 的 Lottie 是一种素材（§7.1 第 10 条） |
| `visualizer` | `CompositionItem`，内置 `baocut.audio-visualizer` | 语义不同 | 参数合同未定义 |
| `progress` | `CompositionItem`，内置 `baocut.progress` | 语义不同 | 同上 |
| `draw` | — | v3 缺 | 导入写成 `baocut.legacy.draw`，渲染器画不出来 |
| `placeholder` | — | v3 缺 | 同上 |
| `confetti` | — | v3 缺 | 规范没有列这个生成器；界面已经在用 `baocut.confetti` |
| `whiteboard` | — | v3 缺 | 同上，规范里没有 |
| — | `CaptionItem` | v3 有而 v2 无 | v2 的字幕不是时间线元素，在文稿与 Studio 数据里 |
| — | `CompositionItem`（`bundle` 来源） | v3 有而 v2 无 | 代码包；v2 对应的是 BCF |

规范 §3.7 没有列出、却已经在用的生成器名：界面的 `baocut.confetti`（由 `render-raster` 的彩纸画法画），导入写的 `baocut.animated-sticker`（非 Lottie 的动态贴纸素材）。

## 3. 字段逐项对照

### 3.1 实例的公共字段（规范 §3.4）

| v2 | v3 | 标记 | 说明 |
| --- | --- | --- | --- |
| `id` | `ItemBase.id` | 一致 | |
| `name` | `ItemBase.name` | 一致 | |
| `role`（`broll`、`watermark`、`screentext`、`overlay`、`frame`，封闭） | `ItemBase.role`（开放词表） | 语义不同 | v2 的角色参与跟随与认领（`follow.rs` 规则 1 排除 `broll`、`watermark`）；v3 的角色「不改变渲染」，也不参与编辑。导入把 `broll` 写成 `b-roll` |
| `hidden` | `ItemBase.enabled`（取反） | 一致 | |
| — | `locked`、`paintOrder`、`lineage`、`linkGroupId` | v3 有而 v2 无 | v2 的叠放顺序是数组顺序 |
| `start`、`end`（`TimeValue`：成片秒或词锚点） | `span`（`FrameSpan`），音频是 `fromFrame` + `subframeOffset` + `playDuration` | 语义不同 | 见第 4 节。v2 可以不写 `end`（到片尾）；v3 的区间必须是确定的 |
| `ai`（不定型） | — | v3 缺 | AI 生成的来源说明；可以放进 `extensions` 或素材的 `provenance` |
| — | `extensions` | v3 有而 v2 无 | v2 的元素是 `deny_unknown_fields` |

### 3.2 几何与外观（规范 §3.5）

| v2 | v3 | 标记 | 说明 |
| --- | --- | --- | --- |
| `place.x`、`place.y`：中心在画布上的百分比 | `transform.x`、`transform.y`：锚点相对画布中心的像素偏移 | 语义不同 | 单位与原点都不同；换算要画布尺寸 |
| `place.w`：画幅宽的百分比（正方类元素量短边，`geometry::width_basis`）；高由天然宽高比推出（`geometry.rs`） | `transform.width`、`transform.height`：像素，两个都显式 | 语义不同 | v2 换画幅时自动跟着重排；v3 的像素框不跟 |
| `place.scale`、`place.scaleY` | — | 语义不同 | v3 没有缩放，只有框的尺寸；关键帧的 `scale` 因此没有落点 |
| `place.rot`（度） | `transform.rotation`（度，绕锚点顺时针） | 一致 | 旋转中心：v2 是元素中心，v3 是 `anchor`（导入固定 `[0.5, 0.5]`） |
| `place.opacity` | `VisualItemBase.opacity` | 一致 | |
| `place.flipX`、`place.flipY` | `transform.flipX`、`transform.flipY` | 一致 | |
| `place.radius`（540 短边下的像素，`effects::REFERENCE_SHORT_EDGE`）、`place.cornerRadii`（四角） | `cornerRadius`（单值，单位待定） | 语义不同 | v2 只在画中画或平铺时生效；v3 只给视频与图片。四角独立 v3 缺 |
| `verticalAlign`（文字块钉在 `place.y` 的哪条边） | `transform.anchor` 的纵向分量 | 语义不同 | 可以换算，但 v2 的是文字专用、与样式分开 |
| `mode`（`fullscreen`、`pip`） | — | 语义不同 | v3 用铺满画布的 `transform` 表达全屏 |
| `fit`（`cover`、`contain`） | `fit`（`contain`、`cover`、`stretch`） | 一致 | `stretch` 是 v3 有而 v2 无 |
| `bg`（`blur`、`black`、`#RRGGBB`） | `backdrop`（`black`、`blur`） | 语义不同 | 纯色 v3 缺；v2 的 `bg` 铺满画布，v3 的 `backdrop` 只在实例的布局框里（规范 §9） |
| `tile`（平铺：角度、间距、错行） | — | v3 缺 | |
| `mask`（`ellipse` + `feather`） | — | v3 缺 | 遮罩在规范里只是 RenderGraph 的一类依赖 |
| — | `crop` | v3 有而 v2 无 | |

### 3.3 效果（规范 §3.9）

v2 的 `fx` 是固定字段的结构，按固定顺序换成效果栈（`effects::lower_element_effects`：调色、模糊、形状遮罩、进度遮罩）；v3 是有序的效果数组，顺序由用户决定。

| v2 `fx` | v3 `Effect` | 标记 | 说明 |
| --- | --- | --- | --- |
| `brightness`、`contrast`、`saturation`（[−1, 1]） | `color-adjust` 的同名参数（[−1, 1]） | 语义不同 | 区间相同，公式要逐个核对：v2 的饱和度是 `1 + s`，亮度在 `filter.colorAdjust` 里 |
| `hue`（[−1, 1]） | `color-adjust.hue`（[−180, 180] 度） | 一致 | v2 换算时乘 180 |
| `blur`（0–100，540 短边下的像素） | `gaussian-blur.radius`（标准差，画布像素，[0, 200]） | 语义不同 | 基准不同；是否同为标准差要对照渲染核心 |
| `grayscale`、`exposure`、`sharpen`、`noise`、`vignette` | — | v3 缺 | |
| `filterPreset`（`calm1`–`peckham3` 共 12 种） | — | v3 缺 | 预设由 `motion` 的配方展开 |
| `effectPreset` + `effectIntensity`（`invert`、`night_vision`、`old`、`bokeh_blur` 等 9 种） | — | v3 缺 | 同上 |
| — | `temperature`、`drop-shadow`、`stroke` | v3 有而 v2 无 | v2 的阴影与描边在文字样式里 |
| — | 效果的 `id`、`enabled` | v3 有而 v2 无 | |

### 3.4 转场（规范 §3.9）

| v2 `transitions` | v3 `Transition` | 标记 | 说明 |
| --- | --- | --- | --- |
| 挂在视频元素上的 `in`、`out`，各一侧 | 序列上的对象，`rightItemId` / `leftItemId` | 语义不同 | v2 只有单侧，在元素自己的区间里取样；v3 的单侧转场对应它，另有两侧转场 |
| `k`：`dissolve`、`wipe`、`slide`、`zoom`、`iris` | `crossfade`、`dip-to-color`、`slide`、`push`、`wipe`、`zoom` | 语义不同 | `iris` v3 缺；`dip-to-color`、`push` v3 有而 v2 无。v2 的 `slide` 同时淡入、方向固定；v3 的 `slide` 带方向、不淡入。`zoom` 两边都是 0.75 → 1 并淡入 |
| `dur`（0.1–2 秒，缺省 0.5；取样时不超过元素长度的一半） | `durationFrames`（≥ 1，≤ 10 秒） | 语义不同 | v2 自动缩短；v3 越界就拒绝或删除转场 |
| 线性 | `easing`（4 种）、`placement`、`audioCrossfade` | v3 有而 v2 无 | |

### 3.5 关键帧与元素动画（规范 §3.15）

| v2 | v3 | 标记 | 说明 |
| --- | --- | --- | --- |
| `keyframes`：属性 → `[{t, v, ease?}]`，属性闭集 `x`、`y`、`scale`、`scaleY`、`rot`、`opacity`、`radius`、`volume`，每个最多 256 帧 | `Sequence.animationBindings`：`{targetId, propertyPath, keyframes[{localFrame, value, easing}], interpolation}` | 语义不同 | `video-model` 里只是 `Vec<Value>`，引擎写空数组，没有实现；`propertyPath` 的白名单未定义 |
| `t`：元素局部秒，或 `"N%"`（元素时长的比例，修剪之后跟着走） | `localFrame`：序列编辑网格上的帧 | 语义不同 | 百分比写法 v3 缺 |
| 缓动写在目标帧上，名字来自 `motion` 的缓动表 | `easing: string`（未知的拒绝） | 语义不同 | 缓动名的集合要定 |
| 取样值取代静态值，入场、出场、循环再叠在上面 | 未定义 | v3 缺 | |
| `volume` 关键帧（线性倍数，0–4） | `AudioMix.envelope`（`at` 精确时刻，`gainDb`） | 语义不同 | 可以换算；外部项目导入（`external-project.ts`）已经这样写 |
| 拆分、合并、修剪时重开窗（`keyframes::split_keyframes`、`join_keyframes`、`rewindow`）；露底判定（`keyframes_uncover`） | — | v3 缺 | 编辑操作要调这些函数 |
| `animate`：`enter`、`exit`、`loop` 三槽，每槽 `{preset, presetVersion, dur, delay, intensity, ease, stagger, staggerFrom, period, phase, seed}`；`typewriter`、`riseWords` 只用于文字 | — | v3 缺 | 规范 §9 列着「预设做成内置生成器还是展开成关键帧」；导入把它留在 `extensions` |
| `stylePresetId` | — | v3 缺 | 文字样式预设的来源 |

### 3.6 跟随、锚点与剪口（规范 §3.16、§6）

| v2 | v3 | 标记 | 说明 |
| --- | --- | --- | --- |
| 时钟：`clips[]` 加 `sources.<id>.cuts` 是唯一真相，元素在成片时钟上 | 实例的 `span` 与 `timeMap` 就是时间线，没有派生的时钟 | 语义不同 | 见第 4 节 |
| `Source.cuts[]`：`{id, t0, t1, ref?}`，源时钟上的剪除，可以恢复 | — | 语义不同 | v3 把剪口落成实例的拆分与移动，恢复是新的事务（规范 §6.2）；剪口集合本身没有持久的位置 |
| `follow_clock` 的四条规则：片段的画面跟着段走；按数字放的元素经「旧成片时刻 → 源时刻 → 新成片时刻」换算；词锚点与不设终点的不动 | `FollowPolicy`：`sequence-fixed`、`item-local`、`speech-anchor`、`explicit-link-group` | 语义不同 | `video-model` 只实现了 `sequence-fixed`。v2 按数字放的元素**默认跟着剪口走**；v3 说「第 10 秒」默认 `sequence-fixed`（不动） |
| 词锚点 `~<源>:<词 id>[:start\|:end][+偏移]` | `SemanticAnchor.word`：`{speechRef, wordId, occurrenceId?, edge}` | 语义不同 | v3 没有偏移，只有 `item` 锚点带 `localOffset`；v2 的源是 `srcId`，v3 指向文稿版本 |
| 锚点的错误：`word-anchor-invalid`、`-missing`、`-cut`、`-unmapped`、`-ambiguous` | 被剪掉的进入 `orphaned` | 语义不同 | v3 只定义了被剪掉的情况 |
| `CutProposal`：`{id, kind: filler \| silence, t0, t1, wordIds, afterWord, reason, detail}` | `EditorialProposal.suggestions[]`：`kind` 为 `filler`、`pause`、`false-start`、`repeat`、`manual-range`，锚在词 ID 上，带 `status` | 语义不同 | `silence` 对 `pause`；v2 没有 `false-start`、`repeat` 的检测；v3 的建议不带时间，由引擎算切点 |
| 检测参数：`DEFAULT_WORD_PAD` 0.05、`CUT_MERGE_GAP` 0.02、`MIN_AUDIBLE_FILLER_SEC` 0.05；停顿压缩 `threshold` 0.8、`compressTo` 0.3、`sentenceCompressTo` 0.4、`maxGap` 3.0 | 「呼吸垫、量化由引擎计算」（规范 §6.1、§6.3） | v3 缺 | 常量随 crate 原样带来，接线时直接用 |

### 3.7 闪避（规范 §3.9）

| v2 `duck`（挂在被压低的音频、视频元素上） | v3 `DuckingRule`（序列上） | 标记 | 说明 |
| --- | --- | --- | --- |
| `under: "speech"`：文稿里的词（已投影到成片时钟） | — | v3 缺 | v3 的触发只能是轨道与实例 |
| `under: <轨道 id>` | `trigger.trackIds` | 一致 | 方向相反：v2 写在目标上，v3 一条规则连两组 |
| `depth`（dB，0–60，缺省 10） | `reductionDb`（(0, 60]，缺省 10） | 一致 | 0 在 v3 不合法 |
| `attack`、`release`（0–5 秒，缺省 0.02、0.35） | `attack`、`release`（`MediaTime`，0–10 秒，缺省相同） | 一致 | |
| 相邻区间间隔不超过 `max(0.5, attack + release)` 时合并 | 只合并重叠或相接的 | 语义不同 | |
| 斜坡在线性增益上从 1 降到 `10^(−depth/20)` | 斜坡在 dB 上线性 | 语义不同 | 两条曲线的形状不同，导出的声音不同 |
| 增益 = 音量（或 `volume` 关键帧）× 淡化 × 闪避 | 从实例增益（含淡化与包络）里减去压低量 | 一致 | |

### 3.8 各种类的 props（规范 §3.6、§3.7）

| v2 | v3 | 标记 | 说明 |
| --- | --- | --- | --- |
| `style`（文字样式，不定型；键来自 v2 渲染器：`fontFamily`、`fontSize`、`fontColor`、`fontWeight`、`textOutline`、`dropShadow`、`background*`、`textMotion`、`lineHeight`、`letterSpacing` 等） | `TextItem.style` | 语义不同 | 类型定义在 v2 的渲染器（`bcut-timeline-render`、`bcut-subtitle-render`、`bcut-editor-core`），随渲染核心移植。字体要按规范 §3.14 引用，不只存字体名 |
| `ShapeProps`：`shape`（`rect`、`ellipse`、`line`、`arrow` 与注册表里的轮廓）、`fill`、`stroke`、`strokeWidth`、`cornerRadius[4]`、`h`、`x1`–`y2`、`head` | `ShapeItem.shape` | 语义不同 | `h` 是画面高的百分比，决定布局框的高 |
| `StickerProps`：`source`（`template`、`asset`）、`templateId`、`path`、`loop`（`loop`、`once`、`hold`）、`fillOverrides` | 合成参数 | 语义不同 | 素材引用在参数里，引擎不跟踪（规范 §9） |
| `VisualizerProps`：`style`、两种颜色、`fftSize`、`minDb`、`maxDb`、`smoothing`、`gain`、`audio`、`speaker`、`alwaysShow` | 合成参数 | 语义不同 | `audio`（取哪路声音）指向 v2 的项目混音 |
| `ProgressProps`：`style`、两种颜色、`startProgress`、`endProgress` | 合成参数 | 语义不同 | |
| `CounterProps`：`mode`（倒数、正数）、`format`（`s`、`mm:ss`、`hh:mm:ss`） | 合成参数 | 语义不同 | |
| `DrawProps`、`PlaceholderProps`、`ConfettiProps`、`WhiteboardProps` | — | v3 缺 | 白板的 `beats[].at`、`end` 可以是词锚点 |
| `source`（`file`、`html`）、`html`（图片水印的 HTML 片段） | — | v3 缺 | |
| `srcId`、`srcStart`、`rate` | `assetRef`、`timeMap.linear {sourceIn, rate}` | 一致 | 速率从浮点换成有理数 |
| `muted`、`volume`（线性倍数）、`audioFadeIn`、`audioFadeOut`（0–5 秒） | `AudioMix` / `EmbeddedAudio`：`muted`、`gainDb`、`fadeIn`、`fadeOut` | 一致 | 音量换成 dB |
| `bcfClip`（旁白导入为轨时认领的 BCF 音频片段） | `linkGroupId`：合成与配音的音画联动组 | 语义不同 | v3 没有 BCF，只留合成与配音的关系，合成的声音整条关着（§5） |

### 3.9 文档级对象

| v2 | v3 | 标记 | 说明 |
| --- | --- | --- | --- |
| `bcutTimeline` 版本（读 0.1–0.11，写 0.12，读时就地升级） | `VideoSnapshot.schemaVersion` | 语义不同 | v3 不保留对旧 v3 视频的兼容（§13.4） |
| `sources{}`：`path`、`hash`、`kind`（`video`、`image`、`audio`、`lottie`）、`duration`、`naturalW/H`、`hasAudio`、`poster`、`origin`、`provenance` | `AssetRecord` 与它的版本 | 一致 | `lottie` 种类 v3 缺；时长与尺寸由探测得到，v2 的值只用来核对 |
| `clips[]`：`{id, srcId, in, out, rate}` | 主轨上的 `VideoItem` | 语义不同 | 见第 4 节 |
| `tracks[]`：`{id, kind: overlay \| audio, name, hidden, locked, muted, elements}` | `Track`：`{id, order, kind: visual \| audio \| subtitle, name, locked, visible, muted, solo}` | 一致 | v2 同一轨道上的元素可以重叠，v3 不可以（导入时拆成几条轨道） |
| `main`：`{detached, place, muted, background, sourceDuration}` | — | 语义不同 | v3 没有「主视频」：主轨是一组 `role: 'a-roll'` 的视频实例。`background` 对应 `canvas.background`（只有颜色） |
| `template`：`TemplateDoc`，模板层（章节、进度、Logo、文字）按画幅百分比摆放 | — | v3 缺 | 规范 §9 的「模板的画幅锁与字幕避让」 |
| — | `markers`（章节） | v3 有而 v2 无 | v2 的章节在文稿与 Studio 数据里 |

## 4. 容器与时间

v2 的成片时钟是派生出来的：源时钟上的 `cuts` 先挖掉，`clips` 再把各段按顺序排起来（`arrange.rs`），元素的 `start`、`end` 在这条成片时钟上。v3 没有派生的时钟：主轨就是一串首尾相接的视频实例，每个实例用 `timeMap` 指回源；所有时刻是有理数，视觉的位置在帧网格上（规范 §2）。

**换算规则**：进出 crate 的地方从浮点秒换成有理数，量化由 VideoEngine 统一做，并给出量化回执（规范 §2.9，架构 §13.6）。浮点秒按最短的十进制写法读成有理数（`editor-semantics::parse_decimal_seconds`），不经过浮点乘法；量化用 `quantize_frame` 与 `FrameAlignment`。

| v2 字段 | 时钟 | v3 字段 | 换算 | 量化 |
| --- | --- | --- | --- | --- |
| `Source.duration` | 源 | `AssetRevision.duration` | 不换算，以探测为准 | 不量化 |
| `Cut.t0`、`t1` | 源 | 没有对应字段：保留下来的源区间成为实例的 `timeMap.sourceIn` 与长度 | 秒 → 精确有理数 | `sourceIn` 不量化；实例在序列上的位置量化到帧（见下一行） |
| `Clip.in`、`out`、`rate` | 源 | `VideoItem.timeMap.linear {sourceIn, rate}`、`span` | `rate` 按十进制写成有理数（1.19 → 119/100）；成片长度 = 源长度 ÷ 速率，首尾相接 | 起止各取最近的帧（同距取早），至少 1 帧；起点挪了多少，`sourceIn` 按速率同步挪，源区间不越过素材末尾（向下取整） |
| `Element.start`、`end`（数字） | 成片 | 视觉：`span.fromFrame`、`durationFrames`；音频：`fromFrame` + `subframeOffset`、`playDuration` | 秒 → 精确有理数 | 视觉取最近的帧；音频起点取前一帧加精确的子帧偏移，长度保留精确值 |
| `Element.start`、`end`（词锚点） | 文稿 | `followPolicy: speech-anchor` 加解析出来的 `span` | `anchors::resolve_time_value` 求成片时刻 | 同上；锚点本身不量化，每次按当前时间线求值 |
| `Element.end` 缺省（到片尾） | 成片 | `untilSequenceEnd: true` 加 `span` | `span` 取写入时的片尾 | 同上 |
| `srcStart`、`rate` | 源 | `timeMap.linear {sourceIn, rate}` | 同 `Clip` | `sourceIn` 不量化 |
| `audioFadeIn`、`audioFadeOut` | 元素局部 | `fadeIn`、`fadeOut`（`MediaTime`） | 秒 → 精确有理数 | 不量化 |
| `volume` | — | `volume`（线性倍数，[0, 4]） | 不换算 | — |
| `keyframes.*[].t`（秒或百分比） | 元素局部 | `AnimationBinding.keyframes[].localFrame`；`volume` 进 `envelope[].at` | 百分比按当时的长度换成秒 | 视觉属性量化到帧（取最近）；包络的 `at` 不量化 |
| `transitions.in/out.dur` | 元素局部 | `Transition.durationFrames` | 秒 × 帧率 | 取最近的帧，至少 1 帧 |
| `duck.attack`、`release` | — | `DuckingRule.attack`、`release` | 秒 → 精确有理数 | 不量化 |
| `animate.*.dur`、`delay`、`period` | 元素局部 | 未定（第 7 节） | — | 作为预设参数时不量化（按精确的局部时刻取样）；展开成关键帧时量化到帧 |
| `whiteboard.beats[].at`、`end` | 元素局部或词锚点 | 合成参数 | 不换算 | 不量化：生成器按局部时间取样 |
| `CutProposal.t0`、`t1` | 源 | `EditorialProposal` 不带时间，只锚 `wordIds` | 切点由引擎重算 | 接受建议时按上面的实例规则量化 |

**现状与规则不一致**：VideoEngine 的 `insertItems` 收的是已经在帧网格上的 `span` 与精确的 `MediaTime`，不量化也不回执。所以旧版项目导入仍在 TypeScript 里（`scripts/legacy-import/exact-time.ts`）按上面的规则换算与量化，最大吸附误差与被截短的尾巴（`maxSnapMs`、`clampedTails`）写在 `import-record` 文档里；词锚点的成片时刻也由导入按剪口求出（`bcut-project.ts`），不经 `anchors::resolve_time_value`。按 §13.2，秒的解析与帧的量化以 Rust 为单源：引擎有了收秒、回执量化的写入操作之后，导入改用它，`exact-time.ts` 只留给预演。

## 5. 旧数据的去向

架构 §13.4 已定：v2 的元素数据作为正式字段进入视频格式，不存成 `baocut.legacy-*`，也不放进 `extensions`。旧版项目导入（`scripts/legacy-import`）按下面的规则写视频格式第 3 版（`schemaVersion: 3`）。实例、关键帧、转场、闪避规则、剪口集合、模板层都经 VideoEngine 的操作写入，校验照常生效，不写引擎不收的视频。

**元素**（`.bcut` 的 `timeline.json`）：

| v2 | v3 | 规则 |
| --- | --- | --- |
| `kind` | 同名的实例类型 | `text` 带 `counter` 时写 `counter`、不写 `text`；模板贴纸写 `template`，素材贴纸指向图片、视频或 Lottie 素材，`sticker` 的 `loop`、`fillOverrides` 原样；贴纸的 `srcStart`、`rate` 没有对应（贴纸从源的开头按原速播），不是 0 与 1 时计入「没有写进去的」；未知种类不导入 |
| `place` | `place` | 已知键原样；`opacity` 夹到 [0, 1]；`flipX`、`flipY` 只写 `true`；未知键丢掉 |
| `mode`、`fit`、`bg`、`mask`、`fx`、`tile`、`animate` | 同名字段 | 原样 |
| `style`、`stylePresetId`、`verticalAlign`、`source`、`html`、`ai` | 同名字段 | 原样 |
| `role` | `role` | 保留 v2 的值（如 `broll`）；音频没有角色时取轨道的 `dub`、`music`；主媒体上的视频元素缺省 `a-roll` |
| `hidden` | `enabled: false` | — |
| `start`、`end`（数字） | `span`；音频是 `fromFrame`、`subframeOffset`、`playDuration` | 第 4 节。有剪口集合时，不在它作用范围里的实例写 `followPolicy: follow-cuts`（§7.1 第 12 条；没写时引擎也读作 `follow-cuts`）；不设终点的写 `sequence-fixed`（v2 里它们不跟剪口） |
| `start`、`end`（词锚点 `~源:词[:start\|:end][±n]`） | `followPolicy: speech-anchor`，`speechRef` 指向转写文档的当前版本 | 缺省端点是词头，偏移写 `offset`；`span` 是跨过剪口求出的成片时刻；求不出（词不存在、落在剪口里）的元素不导入，报告计数 |
| `end` 缺省 | `untilSequenceEnd: true` | `span` 到写入时的片尾；没有终点的音频取片尾，计入「估算的」 |
| `keyframes` 的 `x`、`y`、`scale`、`scaleY`、`rot`、`opacity`、`radius` | 序列的关键帧绑定 | 秒落到实例内的帧，落到同一帧的只留第一个；百分比保留；`opacity` 夹到 [0, 1]，`radius` 不小于 0；缓动不在 `motion` 缓动表里的按线性；每个属性最多 256 个；音频上的这些关键帧丢掉 |
| `keyframes.volume` | `mix.envelope`、`embeddedAudio.envelope` | 值夹到 [0, 4] |
| `volume`、`muted`、`audioFadeIn`、`audioFadeOut` | `mix`、`embeddedAudio` 的 `volume`（线性倍数）、`muted`、`fadeIn`、`fadeOut` | `volume` 夹到 [0, 4]；淡入淡出夹到 [0, 5] 秒 |
| `transitions.in`、`out`（视频元素） | 单侧转场：`in` 在实例开头（`rightItemId`），`out` 在结尾（`leftItemId`） | 种类 `dissolve`、`wipe`、`slide`、`zoom`、`iris`，其他丢掉；长度夹到 [0.1, 2] 秒；实例不到转场的两倍长时引擎缩短生效长度，回执里的 `shortenedTransitions` 逐条进报告；其他元素上的转场丢掉 |
| `duck` | 序列的闪避规则 | `under: 'speech'` 按文稿触发；`under: <轨道>` 按那条轨道导入后的轨道触发；`depth` 夹到 [0, 60] dB，`attack`、`release` 夹到 [0, 5] 秒；触发与参数相同的实例归成一条；非音频元素上的丢掉 |
| `srcStart`、`rate` | `timeMap` | 第 4 节 |
| `bcfClip` | 合成与配音的音画联动组 `linkGroupId`（规范 §3.7「声音」） | 有认领的项目里，带替身的合成实例与认领它口播的配音实例写同一个 `narration:<合成 ID>`，合成的声音关掉；认领的句子 ID 留在 `extensions["baocut.import"].bcfClip` 作来源说明。合成没有导入（没有替身）时配音按普通音频导入，计入「不适用」。v2 跟着认领的行为不移植：合成的声音按句扣掉认领的那几句（替身是混好的成片，扣不了单句，整条关掉）、认领的配音钉在代码编译出的位置上不能拖动、删除改成静音、复制粘贴去掉认领、代码改版后按编译结果重排、按种子重新生成与恢复配音版本——这些都要代码在 v3 里运行，v3 的合成只有预渲染替身 |

**容器**：

| v2 | v3 | 规则 |
| --- | --- | --- |
| 项目 `title` | 视频 `name` | 去掉首尾空白，空值取目录名；超过 200 个 Unicode 标量值时取前 200 个并计入 `clamped.video-name`，完整原标题保留在报告与 `import-record` 的 `name` 中 |
| 主媒体与 `clips` | 按剪口拆开的 `video` 实例（只有声音时是 `audio`），`role: 'a-roll'` | 默认位置写 `mode: 'fullscreen'`、`fit: 'contain'`、`bg` 取 `main.background`（缺省 `black`）；挪过位置的写 `pip`，`main.background` 的颜色进画布背景；`main.detached` 时不建主轨 |
| `main.background`（没有主轨实例承载时） | 画布背景（`updateSequence.background`） | 只收 `#RRGGBB`；黑色不写 |
| `sources.*.cuts` | 每个有剪口、登记了素材的源一份剪口集合文档（`baocut.cut-set/1`，`clock: source-asset`） | 刻度是十进制秒的精确值，`timescale` 取最大分母（超过 10⁹ 时退回微秒，计入「夹住」）；超出素材的剪口夹到素材内，空的与重叠的丢掉；`scopeItemIds` 是这个源的音视频实例；`ref` 原样 |
| `tracks[]` | 轨道 | 同一轨道上重叠的元素拆到相邻的轨道；`hidden`、`muted`、`locked` 写成轨道的 `visible: false`、`muted`、`locked`，锁定最后写 |
| `template` | 序列的模板层（`setTemplate`） | 原样；Logo 层的 `src.file` 没有素材引用，报告警告 |
| 转写与字幕行 | 转写文档、字幕文档与字幕实例 | 句子的词成员优先取 `sourceWordIds`；缺省或空时按 `cueIds` 引用的字幕行恢复。引用的字幕行缺失、词列表为空或词已不存在时，不导入对应的句子或字幕行投影并报告，原始转写照常导入。连续词成员写 `first` / `last`，其他写 `wordIds`。`breaks`、`autoBreaks`、`paraBreaks`、`stages` 与词的 `glue` 按视频格式规范 §5.2 写入正式字段（`nobreak` → `no-break`，分段只取值为 `true` 的词），不再放进 `legacy`；字幕样式仍是 `baocut.legacy-studio-style/0.1` 文档 |
| 代码项目（`entry`、`data.json`、`out/doc.json`） | `composition` 实例，`source` 是代码包素材，`prerender` 是渲染出来的成片 | 成片取 `media` 记着的项目内文件（`provenance.origin: 'render'`）；没记或文件不在时，取项目根与 `out/` 下不以 `.` 开头的唯一视频文件，有几个时取文件名等于合成 ID（`out/doc.json` 的 `meta.id`）的那一个，仍不唯一就算没有。新格式的代码合成要有预渲染替身：没有成片的合成不导入，代码包不登记，计入「没有写进去的」（`没有预渲染替身的代码合成`），警告里写出项目与合成 ID；只有这种合成的项目照样导入成视频（可以是空的） |
| Lottie 源（`kind: 'lottie'`） | `lottie` 素材 | 和别的源一样登记；引擎按内容认成 Lottie，尺寸与时长用渲染内核读出（规范 §4.1），没有被元素用到的也登记 |

**外部视频项目**：

| 外部项目 | v3 | 规则 |
| --- | --- | --- |
| `hyperframes` 实例（代码合成） | — | 不导入：外部项目不记代码包的渲染结果，合成都没有预渲染替身，按与代码项目相同的规则计入「没有写进去的」（`没有预渲染替身的代码合成`），警告里写出项目、合成与代码包；代码包哪个版本都不登记（「没有导入」里写出版本数），只放合成的轨道不建。外部项目没有配音认领合成的字段，音频都按普通音频导入 |
| `transform`（像素框） | 字幕样式文档的定位框 | 保持像素 |
| `volume`（dB）与音量关键帧 | `volume`（线性倍数）与 `envelope` | 夹到 [0, 4]；有包络时静态音量取 1。关键帧的帧号是实例局部的。外部项目的缓动记在一段的起点（左边的关键帧管到下一帧），包络记在终点：第 i 个点取第 i−1 帧的缓动，最后一帧的缓动丢掉；不在缓动表里的（`ease-in`、`ease-out`、`ease-in-out`、`hold` 等）按线性，只在它管着一段时报告 |
| 轨道 `visible`、`muted`、`locked` | 轨道的同名字段 | `solo` 与轨道音量没有对应，丢掉 |
| 字幕（每句一个实例，各带一份样式） | 一份字幕文档（`clock: sequence`）、一份定位框样式文档（`baocut.boxed-caption-style/<N>`，规范 §5.6）、一个字幕实例 | 样式取第一句的，与它不同的单句样式留在那一句的扩展里，计入「没有对应字段」；`animationPresetId` 不带过来：外部工具的预设名不说明逐词动画的画法，成片里也没有逐词效果；按不动画导入，计入「没有写进去的」（`外部项目的字幕动画预设（成片里没有逐词效果）`），每个预设一条警告。预设不同不算单句自己的样式 |
| 位置关键帧、转场、标记 | — | 丢掉，报告计数 |

**导入扩展**：`extensions["baocut.import"]` 只放来源说明：`sourceId`（字幕实例的 `scopeItemIds`、剪口集合的作用实例、转场与闪避都用它连回去）、`bcfClip`、`mediaId`、`itemCount`，不放元素数据。`baocut.dub`、`pipeline` 等其他扩展不受影响。

**超出范围与写不进去**：取值超出第 3 版范围的夹到范围里，计入报告的「夹到范围里的值」；新格式不收的丢掉，计入「没有写进去的」，逐条说明在警告里。引擎退回一个实例时，逐组去掉可选字段重试，去掉的组同样计入「没有写进去的」，都去掉还写不进去才算失败。`verify.ts` 核对导入结果：版本是 3、实例类型认识、没有 `baocut.legacy` 包装的样式与图形、导入扩展只有来源说明、词锚点指向的文档存在、剪口集合的正文成立。

**还没有对应的**（不改引擎语义，留给后面的批次）：

- 秒的量化与词锚点的求值仍在导入里（第 4 节「现状与规则不一致」）。
- 贴纸的 `srcStart`、`rate`：v3 的贴纸按离实例开始过了多久取源，没有取源起点与速度。
- 模板层 Logo 的 `src.file` 没有对应的素材引用。
- 只有主媒体按剪口拆成实例；放在其他有剪口的源上的元素不拆，剪口只记在剪口集合里。
- 原主媒体被重构图等派生文件替代、时间线上不再使用原素材时，文稿仍属于原素材；缺少可靠的来源时钟映射就只保留字幕文档，不自动挂到派生素材上。来源映射的格式见视频格式规范 §9 的待评审项。
- 字幕样式的 `baocut.legacy-studio-style/0.1` 文档与 `baocut.translation/1` 保持原样：渲染、界面、runtime-core 与 jobs 都在读，不在元素模型的范围里。
- 外部项目像素单位的位置关键帧、转场与标记不导入。

## 6. 受影响的模块与分批

规模是相关的行数，不是文件总行数；数字是 2026-10-04 的粗略统计。

| 模块 | 文件 | 规模 | 改什么 |
| --- | --- | --- | --- |
| `crates/video-model` | `lib.rs`、`effect.rs`、`transition.rs`、`ducking.rs`、`marker.rs` | 约 1100 行 | 实例内容的类型：文字样式、图形、生成类元素、几何、效果、转场、关键帧、动画、跟随策略 |
| `crates/video-engine` | `ops.rs`（`InsertItems`、`SetStyle`、`SetText`、`SetCodeParameters`、`SetTransition`、`SetEffects`、闪避）、`effects.rs`、`transitions.rs`、`ducking.rs`、`task_guard.rs`（属性路径）、`state.rs`、`store.rs` 与 `package.rs`（版本门） | 源码约 1300 行，测试约 1500 行（`properties.rs`、`materials.rs`、`effects_chapters_ducking.rs`、`transitions.rs`、`task_protection.rs`） | 校验与写入；剪口、跟随、关键帧编辑调 `timeline`；`schemaVersion` 升级 |
| `crates/render-graph` | `lib.rs`（`LayerContent`、实例到层的映射）、`text_plan.rs`、`audio_plan.rs`、`ducking.rs` | 源码约 450 行，测试约 400 行，夹具 `tests/fixtures/video.json` | 层的内容改成正式字段；闪避曲线 |
| `crates/render-core` | `text.rs`、`shape.rs`、`shape_outlines.rs`、`support.rs`、`compositor.rs`、`effects.rs`、`transition.rs` | 约 1000 行 | 已删掉，由 `crates/frame-render` 接到移植来的 `render-raster`（v2 `bcut-render`）取代（架构 §9.1） |
| `export-worker`、`engine-host`、`bindings/preview-wasm` | `preflight.rs`、`exports.rs` | 不到 60 行 | 随上游重新编译；`preview-wasm` 随渲染适配层多了帧光栅 |
| `packages/protocol` | `src/video.ts`（实例类型、编辑操作、`applyVideoEvent`） | 约 350 行 | 与 Rust 类型同步（§13.2 要求由 Rust 生成） |
| `packages/ui` | 画面：`render/` 下的 Canvas 画法（`content-painter.ts`、`compositor.ts`、`generators.ts`、`lottie.ts`、`effects.ts`、`transitions.ts` 等）已随渲染适配层删掉，预览与缩略图改经 `preview-wasm` 画，留下的 `elements.ts`、`text-style.ts`、`confetti.ts`、`progress.ts`、`visualizer.ts` 只给属性面板与舞台用（文字框由内核量，界面一侧的近似排版已删）；模型：`property-values.ts`、`text-presets.ts`、`text-preset-data.ts`、`element-catalog.ts`、`item-draft.ts`、`new-items.ts`、`stage-pose.ts`、`stage-toolbar.ts`、`effects-panel.ts`、`transition-panel.ts`、`ducking-panel.ts`、`transcript-cut.ts`；组件：`inspector-*.tsx`、`stage-*.tsx`、`text-panel.tsx` | 约 40 个文件、4000 行逻辑加 2041 行预设数据；约 12 个测试 | 属性面板、舞台、预设改用正式字段；舞台的框、引擎的取值区间与缺省、声波、进度条与彩纸的目录经 WASM 调同一份 Rust（架构 §13.2）；文稿剪辑与恢复发 `addCuts`、`restoreCut`，由引擎按剪口集合做；文字预设仍是界面的（架构 §14「编辑语义的待定项」） |
| `packages/runtime-core` | `exports/project-export.ts`、`agent-tools/video-tools.ts`、`agent-tools/video-digest.ts` | 约 150 行，测试 `portable.test.ts`、`video-export.test.ts` | 智能体工具的操作说明与摘要 |
| `packages/jobs` | `pipelines/caption-layer.ts`、`pipelines/dub.ts` | 约 40 行，只碰 `extensions` | 不受影响；`baocut.dub`、`pipeline` 等扩展在去掉 `baocut.import` 时要保留 |
| `scripts/legacy-import` | `bcut-project.ts`、`external-project.ts`、`video-plan.ts`、`video-writer.ts`、`verify.ts` | 约 250 行 | 第 5 节（已完成） |
| `crates/editor-semantics` | — | 0 | 不改；接线时由它或 VideoEngine 调 `timeline` |

**建议的分批**，与架构 §13.6「渲染与导出」「编辑语义」两条线对齐：

1. **格式裁决**（已完成）：第 7 节的问题按 §7.1 定下来，正式字段写进规范 §1.4、§3.2、§3.4–§3.9、§3.15–§3.17、§4.1、§4.6 与 §6.7。只改文档。
2. **元素模型进视频格式**（已完成）：`video-model`、`packages/protocol`、VideoEngine 的校验与写入、版本门；校验调 `timeline` 的 `schema` 与 `elements`。现有的旧画法暂时按新字段读，保证这一批之后预览与导出不退化。版本门在这一批改成只接受 3，测试夹具随这一批改写成版本 3；本机已导入的版本 2 视频在第 3 批之后重新导入，中间不可打开。命令与协议规范里 `setEffects`、`setStyle` 与转场种类的条目随这一批改。架构 §14「元素模型」已定它排在渲染核心的元素层之前。
3. **旧版项目导入**改写（已完成）：按第 5 节写第 3 版视频，已经导入的视频用 `--replace` 重新导入。还没有对应的字段列在第 5 节末尾。
4. **渲染适配层**（已完成，现状与待补见架构 §9.1）：`render-graph` 的层吃正式字段，由 `crates/frame-render` 接到 `render-raster`，导出直接链接、预览经 `preview-wasm` 用同一份。`render-core` 与界面的旧画法已去掉。
5. **编辑语义**（已完成，留下的见架构 §14「编辑语义的待定项」）：手动剪与恢复剪口（`addCuts`、`restoreCut`）、`follow-cuts` 与到序列末尾、关键帧随拆分修剪与合并（`joinItems`）换算、按文稿的闪避，由 VideoEngine 调 `timeline`。`item-local` 与 `speech-anchor` 的移动在每笔事务最后补算；剪辑建议的检测与接受（`proposeCuts`、`acceptCutSuggestions`）读写剪辑提案文档（规范 §6.2）。
6. **界面**（已完成，留下的见架构 §14「编辑语义的待定项」）：经 WASM（`bindings/editor-wasm`）调同一份 Rust，替换手写的副本；属性面板与舞台改用正式字段；文稿剪辑、恢复与剪口带改范围改发 `addCuts`、`restoreCut`。

第 4 批与第 5 批互不依赖，可以并行。

## 7. 待裁决的问题

1. **闪避的模型**。v2 写在被压低的元素上，可以「压在说话下面」（按文稿的词，不分析声音）；v3 是序列上的规则，只能按轨道与实例触发，曲线在 dB 上线性、不按 0.5 秒合并、`depth` 不能为 0。选哪边：给 v3 的规则加文稿触发并改用 v2 的曲线，还是改用 v2 写在元素上的形状？两者导出的声音不同。
2. **转场**。v2 只有挂在视频元素上的单侧转场（按秒，`iris`，`slide` 带淡入，自动缩到元素长度的一半）；v3 是序列上的单侧与两侧转场（按帧，越界拒绝）。v2 的 `in`、`out` 是否就落成 v3 的单侧转场？`iris` 与两种 `slide` 的差别怎么处理？
3. **关键帧**。`propertyPath` 的白名单是否就是 v2 的 8 个属性；v3 的几何没有 `scale`、`scaleY`，这两个属性落在哪里；百分比时刻（修剪后跟着走）是否保留；缓动名用 `motion` 的缓动表还是 v3 的 4 种。
4. **元素动画**。`animate` 的三槽是作为正式字段保存、渲染时由 `motion` 取样，还是写入时展开成关键帧（规范 §9）。§13.4 要求沿用 v2 的元素模型，倾向前者。
5. **几何的存法**。v2 存画幅百分比（换画幅自动重排，正方类元素量短边，高由宽高比推出）；v3 存像素框。§13.4 说元素的参数沿用 v2、变的只是容器：`place` 算参数还是算容器？
6. **圆角的单位**。v2 的 `place.radius` 是 540 短边下的像素（`REFERENCE_SHORT_EDGE`），另有四角独立的 `cornerRadii`；可以直接回答规范 §9 里 `cornerRadius` 单位待定的问题。是否采用，四角是否进格式？
7. **背景色**。`bg: #RRGGBB` 与 `main.background` 的纯色：`Backdrop` 加颜色，还是用画布背景？`bg` 铺满画布与 `backdrop` 只在布局框里的差别（规范 §9）一并定。
8. **效果栈**。v2 的 `fx` 是固定字段、固定顺序；v3 是自由排序的数组。v2 独有的灰度、曝光、锐化、噪点、暗角、12 种滤镜预设、9 种特效预设怎么进：作为 v3 的新效果种类，还是整体换成 v2 的 `fx`？`blur` 的基准（540 短边下的像素 / 画布像素的标准差）以谁为准？
9. **遮罩与平铺**。`mask`（椭圆加羽化）与 `tile` 进格式的位置；遮罩在规范里有后向依赖的约束（§3.9 末尾）。
10. **生成类元素**。`draw`、`placeholder`、`confetti`、`whiteboard` 以及 `counter`、`visualizer`、`progress`、`sticker`：做成 v3 的内置生成器（规范 §3.7，要定参数合同与版本），还是各自成为实例类型？规范没有列的 `baocut.confetti`（界面）与 `baocut.animated-sticker`（导入）要一并登记或改名。Lottie 是否成为 `AssetKind`？
11. **剪口存在哪里**。v2 的剪口是源上的持久集合，时钟由它派生，可以逐条恢复；v3 把剪口落成实例的拆分，恢复是新的事务。剪口集合（含手动剪的 `manual-range`）是否另存一份文档，供恢复与重新验证用？v2 `Cut.ref` 指向的建议对应 `EditorialProposal` 的哪一项？
12. **跟随的缺省**。v2 按数字放的元素缺省跟着剪口走（经源时刻换算）；v3 说「第 10 秒」缺省 `sequence-fixed`（不动），也只实现了这一种。口播剪辑时叠加元素的缺省策略取哪一种？v2 的「片段的画面」认领规则（`follow.rs` 规则 1）在 v3 里对应什么——v3 的主轨实例本身就是画面。
13. **词锚点的偏移与开放终点**。`SemanticAnchor.word` 没有偏移，v2 的 `+offset` 放哪里；不设终点的元素（到片尾）在 v3 里是否需要一种「到序列末尾」的跟随。`bcfClip` 这类「配音片段认领代码合成里的句子」的关系放在哪里。
14. **模板层**。`template`（章节、进度、Logo、文字层，按画幅百分比摆放）在 v3 里是序列上的对象，还是一组普通实例？
15. **轨道内重叠**。v2 允许同一轨道上的元素重叠，v3 不允许；导入拆成几条轨道的做法是否就是定论，编辑器写入时是否同样拆。

### 7.1 裁决

依据是架构 §13.4：元素的种类与参数沿用 v2，变的只是容器。凡是元素自己的参数取 v2，凡是容器（序列、轨道、实例、文档、时间）取 v3。编号对应上面的问题。

1. 闪避取 v2 的语义与曲线：可以按文稿的词触发，增益线性、0.5 秒内合并。形状留在 v3 的序列规则里，规则加「按文稿」这种触发；按轨道与实例触发保留。
2. v2 的 `in`、`out` 落成 v3 的单侧转场，补上 `iris`，`slide` 按 v2 的画法；v3 的两侧转场保留。时间按帧，越界时按 v2 缩到元素长度的一半并在回执里说明。
3. 关键帧的属性白名单取 v2 的 8 个；几何补 `scale`、`scaleY`；百分比时刻保留；缓动名取 `motion` 的缓动表。
4. 元素动画的三槽作为正式字段保存，渲染时由 `motion` 取样，不展开成关键帧。
5. 几何按 v2 存画幅百分比，`place` 算元素的参数。
6. 圆角取 v2 的单位（540 短边下的像素），四角独立的值进格式。
7. 背景色按 v2：画布背景是纯色，`bg` 铺满画布。
8. 效果整体取 v2 的 `fx`（固定字段、固定顺序、滤镜与特效预设），`blur` 的基准取 v2；v3 现有的四种效果并进去。
9. `mask` 与 `tile` 作为实例的字段进格式，遮罩遵守规范 §3.9 的后向依赖约束。
10. 生成类元素各自是实例的种类，与 v2 的 `ElementKind` 一一对应；Lottie 是一种素材。
11. 时间线仍是 v3 的实例。剪口集合另存一份文档，供逐条恢复与重新验证；应用与恢复都是 VideoEngine 的事务。
12. 口播剪辑里按数字放的叠加元素缺省跟着剪口走（v2 的缺省）；v3 的 `sequence-fixed` 保留为可选。
13. 词锚点加偏移；加「到序列末尾」的终点。`bcfClip` 的认领落成合成与配音的音画联动组，合成的声音关着（规范 §3.7「声音」）；句子 ID 只作来源说明。
14. 模板层是序列上的对象。
15. 同一轨道内不重叠是容器的规则，保留；导入与编辑器写入时拆到相邻的轨道。

