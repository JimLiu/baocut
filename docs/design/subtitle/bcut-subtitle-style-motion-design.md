> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# 字幕样式与分层文字动画扩展方案

状态：已按合并方案落地。用户后续确认执行，并要求合并 BaoCut 既有样式与参考样式、略增默认字号。§13 为最终实施口径，§14 记录实际验证和未完成的检查；§3–§11 保留研究数据和原始验收目标。

## 1. 目标与结论

以 31 套字幕/文字设计作为行为参考，为 BaoCut 的字幕样式库补齐完整外观、入场、退场、循环与说话词强调。保持 BaoCut 的 Transcript 真相、编辑作用域和共享 Rust 渲染路径；参数与行为由本仓库实现，研究用第三方代码和预览保存在仓库外；采用的 OFL 字体随许可打包。

本次核对安装包与本地代码后的目录数量：

- **10 套完整字幕设计**，其中 Clean Line 静态、其余 9 套有动画。
- **16 套当前文字预设**。截图露出前 12 套，下面还有 Handwritten、Typewriter、Lower Third、Label；其中 12 套动画、4 套静态。Basic 区域不等于全部静态。
- **5 套静态字幕预设**，由另一套 caption preset 接口提供。
- 因而当前迁移分析覆盖 **31 套**。Bundle 还保留 13 个较早 text template ID，不能据此把它们当作当前新增 13 套；它们应作为旧工程兼容审计对象。
- 底层是 **17 个文字动画原语＋独立的逐词强调**。10 张字幕卡是这些原语、字体与配色的组合，不能机械映射到 BaoCut 现有逐词动画目录。

推荐先扩展共享文字动画编译与渲染，再按数据注册预设。不能只加卡片或在 Web 写 CSS 动画，否则预览、导出、逐词时序和原生 App 会分叉。

## 2. 研究证据与覆盖范围

分析资料保存在仓库外的 `subtitle-research/` 目录。

| 证据 | 提取内容 |
| --- | --- |
| 插件 `dist/shared/subtitle-presets/subtitle-animation.mjs` | 10 套完整样式参数与 createSubtitleAnimationMotion |
| 同目录 `subtitle-design-metadata.mjs` | 10 套名称/用途、5 套静态字幕 |
| 编辑器 `feature-editing-core-DdQnU3jr.js` | 16 套文字预设、17 个原语、时间窗口/分词/渲染逻辑 |
| `subtitle-research/source/editor-features.pretty.js` | 格式化后的上述 bundle；原语约 32940 行，文字预设约 33190 行，采样约 66230 行，字幕映射/绘制约 79920 行 |
| `subtitle-research/*.json` | 由 AST 白名单读取数据字面量，未执行被分析的代码；含完整数值 |
| `subtitle-research/previews/` | 10 段原始 MP4 与 10 张海报 |
| `animation-contact-sheet.jpg` | 每段在 0.1 / 0.4 / 0.8 / 1.9 / 3.9s 抽帧，共 50 帧，已人工查看 |
| `reference-fonts/` | 应用随附字体与许可快照，仅用于研究；实施时核对字体版本、字重、许可及跨端打包 |

这些是安装包证据，不是对服务端能力的推测。视觉抽帧确认了入场、静态保持、强调与尾段行为；它不替代连续播放速度验收，也未完成和 BaoCut 输出逐像素对拍。

## 3. 十套字幕设计的准确语义

尺寸口径：`H` 为画布高，`W` 为画布宽，`S=min(W,H)`，`F=round(H×fontSizeRatio)`。`yRatio` 从画布中心向下偏移；例如 0.28 对应中心位于高度 78%。字距 ratio 乘字号 F；描边 ratio 乘短边 S。

| 原 ID / 名称 | 字体、基础色、布局 | 动画与时序 |
| --- | --- | --- |
| `zoom-punch` · Zoom Punch（强调冲击） | Anton / normal / normal；#FFFFFF；F=0.073H，宽=0.78W，y=0.28H，行高=0.95 | 整句常显；当前词粉色 #FC75E9，1.18→1 缩放，0.20s，ease-out；停顿保持前词 |
| `reveal` · Clean Line（清晰整句） | Inter / medium / normal；#FFFDF7；F=0.052H，宽=0.82W，y=0.29H，行高=1.08 | 无动画；完整暖白文本保持静止（名字 reveal 不代表逐词揭示） |
| `pulse` · Accent Pulse（轻量强调） | Poppins Black / bold / normal；#FFFDF7；F=0.06H，宽=0.82W，y=0.29H，行高=1 | 整句常显；当前词黄色 #FFE15A，1.10→1，0.16s，ease-out；停顿保持前词 |
| `glass` · Word Blocks（逐词底块） | Inter / medium / normal；#FFFDF7；F=0.048H，宽=0.86W，y=0.29H，行高=1.12 | 每个词都有黑底块；当前块 #FFD84D、字 #191919；当前文字 1.04→1，0.14s；底块不跟随文字缩放 |
| `drop-in` · Word Drop（逐词落入） | Poppins Black / bold / normal；#232323；F=0.058H，宽=0.76W，y=0.29H，行高=1.04 | 逐词一次性 cascade 入场：0.22s、错开 0.04s、强度 0.85、ease-out；完成后静止，整句绿底板保持稳定 |
| `typewriter` · Typewriter（纸面打字） | Roboto Mono / medium / normal；#241F1A；F=0.042H，宽=0.7W，y=0.28H，行高=1.16 | 逐字符阶跃揭示：单元时长 1/30s，错开 0.04s，linear；全文预排版，纸色底板稳定 |
| `slide-mask` · Line Swipe（逐行滑入） | Poppins Black / bold / normal；#FFF8F2；F=0.058H，宽=0.82W，y=0.27H，行高=1 | 按最终视觉行入场：0.36s，错开 0.08s，强度 0.92，ease-out；文字从左侧框外移动进固定裁切框 |
| `whisper` · Soft Focus（柔焦显现） | Inter / medium / normal；#FFFDF7；F=0.048H，宽=0.82W，y=0.29H，行高=1.1 | 整句 blur-in：0.38s，强度 0.55，ease-out；透明度上升，文字模糊消退，无循环 |
| `rise-fall` · Rise & Settle（升起与落定） | Playfair Display / normal / italic；#F5E6CF；F=0.058H，宽=0.82W，y=0.27H，行高=1.12 | 整句 rise 入场 0.36s、强度 0.5、ease-out；fade-down 退场 0.22s、强度 0.35、ease-in |
| `kinetic-wave` · Kinetic Wave（字符波浪） | Oswald / bold / normal；#FFFFFF；F=0.066H，宽=0.86W，y=0.27H，行高=0.98 | 逐字符 wave-in：0.32s/错开0.025s/强度0.62；入场后 wave 循环：周期0.96s/错开0.03s/强度0.32 |

### 3.1 不能省略的外观细节

- **Zoom Punch**：全大写、Anton；硬黑阴影，黑描边；当前词始终在完整句子中强调。
- **Accent Pulse**：Poppins Black、全大写、暖白、黄色强调；幅度与时长均小于 Zoom Punch。它的 ID `pulse` 与底层持续循环原语 `pulse` 同名，但这张卡没有 loop。
- **Word Blocks**：所有词持续带 `rgba(18,18,19,0.84)` 底块；paddingX=0.2F、paddingY=0.1F、radius=0.12F。当前块变黄；不是只画一个移动的高亮药丸，也不是按字从左到右填充黄色。
- **Word Drop**：整句 `#C7FF5A` 底板与深色文字，底板不因词尚未出现而缩窄；词从上方落入，入场由句开始＋序号错开，不等同于按 ASR 说话时间触发。
- **Typewriter**：Roboto Mono、`#F4EBDD` 纸色整句底板、左对齐。先排完整句子，再控制可见性；不能在每一帧截取字符串重新排版。
- **Line Swipe**：暖白文字、珊瑚红硬阴影。源码通过 `dx=-(1-p)×boxWidth×0.92` 移动各视觉行，并裁到固定 text box；它不是文字不动而裁切宽度增长的擦除效果。预览早期先看到移动中的行尾，正是这一机制的结果。
- **Soft Focus**：整句透明度与文字模糊同时变化；不是只把投影的 shadowBlur 调小。
- **Rise & Settle**：Playfair Display 斜体、奶油色；入场整体上升，退场整体向下淡出。
- **Kinetic Wave**：Oswald Bold、青色硬阴影、黄色描边；只在这一套里持有持续 wave。幅度=0.18F×0.32≈0.0576F。

截图的黑色卡片底、参考视频的深蓝画布是展示底色，不应误写成每套字幕的全屏背景。

### 3.2 活动词与时间规则

1. 字幕 cue 映射成有独立起点和时长的文字 item；每句重新起动画时钟。
2. Zoom Punch / Accent Pulse / Word Blocks 使用真实词开始时间转帧得到 `unitStartFrames`。
3. 活动词取最后一个 `startFrame <= currentFrame` 的词。开始时间之间一直保持前词，不以 endFrame 提前取消强调；最后一个词保持到 cue 结束。
4. 无词时间时参考实现会均分 unitStartFrames。这是展示推算，不是真实 ASR 时间，BaoCut 如采用必须明确标为估算，不得写回 Transcript。
5. 三套强调的缩放按固定 0.20/0.16/0.14 秒衰减，而非拉伸为每个词的发音时长。ease-out 是二次函数 `p(2-p)`，不是默认 CSS ease-out，也不是 spring。
6. 其余入场主要使用句开始＋单元顺序错开；不能给所有动画强制加说话词同步。
7. 单次 in/out 窗口为 `duration + stagger×maxOrder`，超过 cue 一半时同比压缩 duration 和 stagger，使首尾不互相侵占。out 在尾窗优先；loop 在入场完成后开始，进入退场窗后停止。
8. 波浪用绝对时间正弦采样，随机顺序有固定 seed；拖动、倒放和乱序采样不应依赖之前播放过哪些帧。

### 3.3 多语言：保留目标效果，修正参考实现的限制

参考实现的 word 单元优先 Intl.Segmenter；无此能力时按空白切词。其 character 路径使用 JS 字符迭代/Array.from（Unicode code point），不是完整 grapheme cluster；全大写与部分匹配显式使用 en-US。

BaoCut 继续使用 Unicode grapheme 与 shaping cluster，避免把组合重音、印度文字、emoji ZWJ 或阿拉伯连写拆坏。`word` 在有转录时优先稳定 word ID；没有时间戳的内容采用显示切分，明确它是展示单元。`line` 必须按排版后的视觉行分组，不能直接用换行符切串。RTL 要明确 logical/visual order，默认跟阅读顺序；未知语言保持通用 Unicode 行为。

原文、译文都可以使用外观与 cue/line/grapheme 入退场；只有真实可用的词时间才能驱动“跟随朗读”。译文不得伪装成拥有译语逐词对齐，也不能借迁移修改 trans / transAlign 真相。

## 4. 十六套文字预设（完整 Basic 区）

这些是普通文字 item 的预设，包含布局、演示文字和动画。借鉴到字幕时只应用外观/动效，不覆盖字幕文本，不自动写入人名、引号或署名。Quote 和 Lower Third 的第二行属于不同富文本角色；原样复现应保留在文字元素预设，同时提供去掉演示文案的字幕适配款。

这里的字号是 `clamp(round(H×ratio), min, max)`，并乘用户 styleScale；阴影、描边、间距等主要为像素参数，与上一节的比例参数不同。Basic 动画的 durationFrames 默认是帧数，未按 fps 换成固定秒；BaoCut 应显式记录基准 fps 或标准化为秒，不能隐藏这种差异。

| ID / 名称 | 字体与主色 | 字号 H 比例（min–max px） | 动画单元 / 原语 |
| --- | --- | --- | --- |
| `basic-text` · Basic Text | Inter normal / #ffffff | 0.056（36–84） | 静态 |
| `basic-heading` · Heading | Montserrat bold / #ffffff | 0.09（58–136） | whole-clip / fade-up |
| `social-tiktok` · Word Pop | TikTok Sans bold / #ffffff | 0.072（48–108） | word / pop |
| `social-bold-caption` · Bold Caption | Poppins bold / #facc15 | 0.074（48–112） | word / fade-up |
| `social-hook` · Hook | Anton normal / #ffffff | 0.112（72–164） | whole-clip / pop |
| `social-outline` · Outline | Montserrat bold / #ffffff | 0.082（54–124） | 静态 |
| `title-poster` · Poster | Anton normal / #fef3c7 | 0.11（72–164） | whole-clip / blur-in |
| `title-cinematic` · Cinematic | Bebas Neue normal / #f8e6b8 | 0.11（72–164） | line / fade-up |
| `title-condensed` · Condensed | Oswald bold / #ffffff | 0.096（64–146） | line / slide-mask |
| `title-neon` · Neon | Roboto Mono medium / #67e8f9 | 0.086（56–132） | whole-clip / blur-in |
| `editorial-elegant` · Elegant | Playfair Display bold / #fff7ed | 0.084（56–128） | line / fade-up |
| `editorial-quote` · Quote | Playfair Display normal / #fafaf9 | 0.072（48–108） | 静态 |
| `editorial-handwritten` · Handwritten | Caveat bold / #fde68a | 0.082（54–124） | character / wave-in |
| `utility-typewriter` · Typewriter | Roboto Mono medium / #86efac | 0.056（36–84） | character / typewriter |
| `utility-lower-third` · Lower Third | Inter semibold / #ffffff | 0.058（38–88） | line / slide-mask |
| `utility-label` · Label | Montserrat bold / #111827 | 0.046（30–70） | 静态 |

四套非截图可见的预设分别是手写字、绿色终端打字、姓名职务条、黄色胶囊标签。基础目录包含 4 个静态设计：Basic Text、Outline、Quote、Label；其余都有入场。

## 5. 五套静态字幕

它们的 ID 保留了历史品牌名称，当前显示名称已更通用；BaoCut 应使用自己的稳定 ID 和本地化显示名，避免同现有样式混名。

| 原 ID / 显示名 | 字体、主色、底板 | 字号/位置 |
| --- | --- | --- |
| `netflix` · Classic Box | Inter semibold / #ffffff / rgba(0, 0, 0, 0.55) | F=0.04H，y=0.36H，宽=0.7W |
| `youtube` · Soft Shadow | Roboto medium / #ffffff / 无底板 | F=0.045H，y=0.34H，宽=0.85W |
| `bold-yellow` · Bold Yellow | Roboto Slab bold / #FFD400 / 无底板 | F=0.05H，y=0.38H，宽=0.85W |
| `minimal-stroke` · Outlined | Manrope medium / #ffffff / 无底板 | F=0.04H，y=0.34H，宽=0.85W |
| `tiktok` · Bold Center | Anton normal / #ffffff / 无底板 | F=0.075H，y=0H，宽=0.9W |

## 6. 十七个底层动画原语

以下是动画表达层，不必把每一个都新增成一张字幕样式卡，但完整文字动画编辑器需要保留这些组合能力。

| 阶段 | 原语 | 主要通道 |
| --- | --- | --- |
| in | typewriter | 字符 alpha 阶跃 |
| in | fade-up | alpha＋0.25F×intensity 的纵移 |
| in | rise | alpha＋0.6F×intensity 的纵移 |
| in | cascade | alpha＋从上方 0.8F×intensity 落入 |
| in | pop | alpha＋scale，可 overshoot |
| in | blur-in | alpha＋soften，模糊半径 0.4F×intensity |
| in | slide-mask | 横移，固定框裁切 |
| in | wave-in | alpha＋按单元序号 sin(index×0.9) 变化的入场纵移 |
| out | fade-down / sink | alpha＋向下纵移 |
| out | pop-out | alpha＋缩小 |
| out | blur-out | alpha＋模糊增加 |
| out | typewriter-erase | 反向字符 alpha 阶跃 |
| loop | pulse | scale=1+0.06×intensity×sin(2πp) |
| loop | wave | dy=0.18F×intensity×sin(2πp) |
| loop | shimmer | 单元确定性亮度强调 |
| loop | swing | rotation=0.09×intensity×sin(2πp)，Canvas 使用弧度；转为 BaoCut 的度制通道时乘 180/π |

除 in/out/loop 外，wordEmphasis 作为独立叠加层乘缩放并覆盖活动词颜色。原语支持 whole-clip、line、word、character 单元，顺序 forward/backward/center/random，intensity、easing、seed。三个阶段按时间选择，不能无条件同时叠加。

## 7. BaoCut 当前可复用能力与真实缺口

以下基于当前源码静态审计；不是新增实现已通过验收的声明。

| 能力 | 当前状态 | 本次迁移需要的补充 |
| --- | --- | --- |
| 字体、字重、大小写、字距、行高、描边、阴影、底板、圆角 | LineStyle、line_style 已有 | 加配方数据与单位适配；准确字体覆盖单独核对 |
| 原文说话词着色和变形 | WordAnimation / word_motion 已有 19 项，三态＋连续轨 | 补固定秒强调、hold-previous、与独立入退场组合；不要改旧 ID 的时间语义 |
| Designed Caption | 已有按 word/group 触发的 channel 配方与复杂描画 | 可以复用数据/采样思路，不能声称已覆盖所有 line/grapheme 语义 |
| 字符、词、行分片 | bcut-motion::text_parts 已有 Char/Word/Line；PartMap 可处理 cluster 起点 | 当前 line 主要按显式换行；新增排版后视觉行映射，字幕词 run 内的字符映射也要补 |
| 普通文字元素分片动画 | render_plan/raster 已接 animation_parts | chunk_part_delta 目前只取 opacity/dx/dy；完整 scale/rotation/blur/clip 需要统一 pose |
| 整句模糊/缩放 | transition 与共享 effect 栈已有基础，GPU glyph scene 也有回退 | 现有 caption transition 不是完整 in/out/loop 文字动画；字幕整句 blur 要正确传到渲染及缓存 |
| 每词底板 | 现有 WordVisual/药丸底板基础 | 增加 idle/active 持续底块、独立 X/Y padding、稳定几何；现有 active box 不能直接冒充 |
| 整句纸色/绿底板 | 已有底板 | 底板必须用完整布局，字符揭示不能触发重排/宽度变化；现有横纵 padding 比例固定需解耦 |
| 静态/动态缩略图 | App 有共享 Rust word_motion_demo；Web Thumb.tsx 还有 CSS 投影 | 新样式预览必须从同一 sampler 或共享渲染产物生成，不再另写一套近似帧表 |
| 译文 | layout_motion 当前限 Original；译文无真实词时间 | 保留无词时间边界，支持 cue/line/grapheme 自由入场，并明确强调时钟来源 |
| 多语言 shaping | Rust shaping 与 unicode-segmentation 已有 | 先完整 shaping，再关联 cluster 和动画单元；不能按字符逐个独立 shape 打断连写 |

### 7.1 字体审计

当前 bundled_studio_fonts 可见 Montserrat、Anton、Bebas Neue、Poppins（400/500/600/800）等。完整匹配还需核对 Inter、Poppins 900、Oswald、Playfair Display（含斜体）、Roboto Mono、TikTok Sans、Caveat，以及静态款的 Roboto/Roboto Slab/Manrope。

系统字体可能使某台 Mac 看起来已有这些字体，但不能作为 Web、Windows 和导出的可靠来源。实施时固定字体文件、family alias、字重与许可证，并经现有字体注入链路分发；研究目录已有原包字体/许可供核对，但不要直接依赖用户机器目录。

`Poppins Black` 需映射到 Poppins 的真实 900 字重，不能因名字中包含 Black 就只设置 bold=700。未覆盖文字用现有按 script 回退，保留各语言的 shaping 与方向；不统一当成英文。

### 7.2 参数不能直接照抄

- 参考实现的完整字幕字号按 H 比例，BaoCut 当前 logical fontSize 按 `min(W,H)/540 × scale` 放大。指定画布时可换算：`logicalF = round(H×ratio) / (min(W,H)/540×scale)`；改变画幅后要按声明的 basis 重算，不能只保存第一次换算值。
- 参考实现从中心偏移，BaoCut 行位置是中心百分比：`x%=50+100×xRatio`、`y%=50+100×yRatio`。还要明确 verticalAlign=center，避免旧双语接缝锚点改变结果。
- 参考实现的字距为 `letterSpacingRatio×F`，BaoCut 为 `letterSpacing×F/30`，比例配方可写 `letterSpacing=30×ratio`。Basic 固定像素要另外转换。
- **描边有两重倍率**：参考实现的 renderer 把 stroke.width 乘 2 作为 Canvas lineWidth；BaoCut 当前居中 stroke 为 `textOutline.width×F/200`。若匹配同一笔画线宽，则 `textOutline.width=400×refStrokeWidth/F`。要用真实描边图确认外扩，不能直接复制 0.006 或像素数。
- 阴影 ratio 的 X 乘 W、Y 乘 H、blur 乘 S，BaoCut distance/blur 当前按字号。可先求目标 dx/dy，再转 `distance=hypot(dx,dy)/F`、`rotation=atan2(dy,dx)×180/π`、`blur=blurPx/F`。浏览器与 CPU 的模糊核仍需视觉容差验收。
- BaoCut backgroundPadding 当前推导固定横纵比 1.4；参考实现的整句 padding 与逐词 padding 可以独立。新增显式 paddingX/paddingY 时，缺省仍走旧公式。
- 不把 CSS rgba alpha 直接塞进内部 SubtitleColor.a：内部保存透明度方向与常见 opacity 不同，必须走现有 parse/paint 换算。

## 8. 建议的数据和模块设计（尚未落地）

### 8.1 持久数据分层

在每条字幕样式作用域上增加可选的版本化 `textMotion`，拆成 `in`、`out`、`loop` 和 `emphasis`。外观仍由现有 style 字段承担，必要时增加明确尺寸 basis 和独立词底块配置。下例是设计草案，当前 CLI/工程不支持，不能作为现成命令使用：

```json
{
  "textMotion": {
    "version": 1,
    "in": {"preset": "rise", "unit": "cue", "durationSeconds": 0.36, "intensity": 0.5, "easing": "easeOutQuad"},
    "out": {"preset": "fade-down", "unit": "cue", "durationSeconds": 0.22, "intensity": 0.35, "easing": "easeInQuad"}
  }
}
```

时钟应区分句区间、视觉错开与真实说话词；词间 gapPolicy 独立建模。数据先写秒，编译到项目 fps 时量化；如导入精确帧配方必须带 referenceFps。预设 ID 与 UI 标题分开，建议 `caption.zoom-punch@1` 这样的命名，最终命名在实现前与现有注册表检查冲突。

所有时钟先经现有剪辑投影映射到输出时间，包含裁切、拼接与变速；不能把原媒体 word.start 直接当作成片时刻。句级入场使用有效显示区间，朗读强调使用投影后的真实词开始时间；已有 lead-in/tail 作为显示配置保留，参考片对拍时显式固定它们，避免把提前显示误判成采样偏移。

应用预设原子替换这一作用域的 appearance/motion 组，清理不兼容的旧 wordAnimation/transition/caption 状态；不能残留旧弹跳又叠新波浪。新字段未提供时旧项目保持字节语义。只改字体/颜色时保留动画；换静态款显式清除动效。记录出处/版本，用户改外观后保留可编辑性，不靠字符串名称判定行为。

样式库、品牌库、cueStyles、原文/译文局部覆盖都必须保存新字段；在任何序列化白名单处截断都会导致“当前预览正常、重新打开退回静态”。未知版本保留原数据并给出不支持提示，不能默默覆盖成默认样式。

### 8.2 编译与采样复用

1. 用当前 TextEngine 做整段 shaping 和稳定折行，保留源 word ID、UTF-8 范围、grapheme/cluster 及最终视觉行索引。
2. 在 bcut-subtitle-render 增加文字动画编译适配，把这些语义目标映射到 bcut-motion 的 MotionProgram/曲线/组合能力；不在 GPUI 和 React 各写 sampler。
3. cue/line/word/grapheme 的单元共用 `TextUnitPose`：opacity、translation、scale、rotation、blur、clip、color、word-plate state。缓存几何，只更新每帧 pose/uniform。
4. in/out/loop 使用单元顺序和短 cue 窗口规划；emphasis 单独读真实词 starts，以明确次序与 base pose 组合。
5. 文字、描边、阴影跟随文字姿态；静态底板与逐词底块独立于字形缩放。slide-mask 的固定 text-box 裁切在移动之后施加。
6. CPU reference 与 retained glyph scene 使用同一采样结果与坐标系。支持的变换/裁切用现有 uniforms；blur 使用有界离屏图层或已支持效果栈，必要时按 cue 回退，不把整个视频每帧退成全画幅 CPU 光栅。
7. 缓存键纳入 textMotion、字体版本、几何、时钟来源；入场结束后无 loop 的款式应进入静态缓存，不能一直刷新。

目前 bcut-motion 已有基本曲线、PartMap 与 stagger，字幕层也有样式、glyph 及 effect 能力。本方案的重点是补齐统一的语义目标与编译连接，而非再建一个与 BCF/Timeline 脱节的动画引擎。

### 8.3 三个表面与产品流程

- 样式卡仍走 BaoCut 的现有字幕画廊。不要复制参考实现的 Media/Text/Transcript 外壳，也不把它的 Basic 文字菜单原样塞进字幕内容编辑。
- 10 套主设计放字幕精选分组，5 套静态作为基础外观；16 套文字预设在文字元素库保留完整角色结构，字幕库提供内容无关的适配款。对字幕点击任何卡都只改选定作用域的样式，不改原文和译文。
- Preview、保存到品牌库、复制样式、全局/单 cue、原文/译文切换必须用同一 payload。
- App/Web/原型使用本地化名称与说明。所有新增键各语言齐全，字幕画面颜色属于作品内容，UI chrome 继续遵守 Spectrum 2。
- Web 在 §22 范围内适用：样式/动画属于已有编辑 Tab，不引入 AI 入口。
- 原型与两份入口同步，共享组件及缓存戳一起更新；实施时同步产品规格 §13/§16 与 prototype changelog/ledger。

## 9. 具体代码落点

所有“新增”都指下一次实施任务，本次未创建这些 Rust/TS/JS 功能。

| 模块 | 文件 / 目录 | 工作 |
| --- | --- | --- |
| 配方数据 | core/assets/ 或 core/presets/ 的现有注册体系 | 保存版本化外观、动画和声明的尺寸 basis，避免把数值复制进三个 UI |
| 基础运动 | [bcut-motion](../../../core/crates/bcut-motion/src/lib.rs)、[text_parts](../../../core/crates/bcut-motion/src/text_parts.rs) | 复用 MotionProgram 与曲线；扩展最终布局单元绑定和窗口策略的纯函数 |
| 字幕语义 | [document.rs](../../../core/crates/bcut-subtitle-render/src/document.rs)、[word_motion.rs](../../../core/crates/bcut-subtitle-render/src/word_motion.rs)、新增 text_motion 模块 | 新字段解析、时钟来源、活动词 gap 规则、组合姿态；旧 word motion 保持兼容 |
| 几何与渲染 | [raster.rs](../../../core/crates/bcut-subtitle-render/src/raster.rs)、[render_plan.rs](../../../core/crates/bcut-subtitle-render/src/render_plan.rs) | cluster/视觉行索引、固定底板、词块、遮罩、模糊、CPU/GPU 一致 |
| 样式持久化 | [style_sync.rs](../../../core/crates/bcut-subtitle-render/src/style_sync.rs)、[style_library.rs](../../../core/crates/bcut-editor-core/src/style_library.rs)、[stylepane.rs](../../../core/crates/bcut-editor-core/src/stylepane.rs) | 注册31份设计、转换、作用域、保存和恢复、清除旧动画组 |
| WASM 接口 | [bcut-wasm-editor style_pane](../../../core/crates/bcut-wasm-editor/src/api/style_pane.rs)、core/crates/bcut-wasm-subtitle | 输出样式目录及预览能力；同步声明与必要的 schema |
| App | [stylepane](../../../apps/baocut/src/app/editor/stylepane/)、[host style_library](../../../apps/baocut/src/host/style_library.rs)、apps/baocut/locales/ | 字幕/文字库、预览、参数编辑、i18n |
| Web | [subtitle/style](../../../apps/web/src/features/editor/panes/subtitle/style/) | 目录、作用域、真实动画缩略图，重建对应 WASM |
| 原型 | designs/baocut/app/model-substyle.js、model-subanim.js、panel-substyle.jsx | 共享目录与模型语义、控件、两份入口预览；不要用近似原型宣称生产引擎完成 |
| 字体 | [fonts.rs](../../../core/crates/bcut-render/src/fonts.rs)、core/assets/fonts/ 及各宿主字体链路 | 字体族别名、精确字重、fallback、许可与固定摘要 |
| CLI/skill | docs/design/cli/bcut-cli-server-reference/、skills/baocut 字幕样式入口 | 如样式写入/校验/枚举契约改变，同步参考与实际 spec；用户 skill 只加使用入口，不复制内部算法 |

如果新增公开字段影响协议 schema/spec，按协议单源生成，不能手改 docs/generated。样式字段是松散 JSON 也必须校验输入及保存能力，不能因为无需新增 Rust enum 就跳过契约文档。

## 10. 实施顺序与完成条件

| 阶段 | 交付 | 完成条件 |
| --- | --- | --- |
| A：冻结参考 | 全31套机器目录、字体与10段时序参考、对应参数表 | 本次已完成研究提取；旧13 ID 单独列为兼容，不重复算新模板 |
| B：样式与布局基础 | 单位/basis转换、字重、独立padding、稳定底板、word plate | 31套静态外观在横竖屏和多语言样本可读；旧项目像素基线不变 |
| C：统一文字运动 | cue/line/word/grapheme、in/out/loop、emphasis、短句窗口、glyph映射 | 10套字幕的运动行为逐帧对拍；17个原语有边界测试，不沿用错误近似动画 |
| D：全目录接入 | 10主设计＋5静态＋16文字/字幕适配、完整保存/撤销 | App/Web/原型都能选择、修改、保存恢复；预览和导出走同一内核 |
| E：跨端/导出验收 | 字体、混排、长文稿、动态缩略图、输出限制说明 | 所有矩阵通过后才能称完整迁移；SRT/ASS/外部NLE不支持的高级动画须能力预检并明确降级/烘焙策略 |

把静态外观先接好只是中间阶段，不能以“31张卡都能点”为完成标准。需要一起交付可用能力与正确预览；尚未实现的卡不提前显示成已支持。

## 11. 必须覆盖的验证矩阵

### 时间与版面

- fps：24/25/30/50/60/120；横屏1920×1080、竖屏1080×1920、方形；检查按H与按短边的差别。
- cue：0.2s、1s、正常4s、长句；0/1/多词、长静音、零长度或相同 starts、缺少词时间、最后词结束后仍可见。
- 每套至少 start−ε、start、入场中点、入场结束、活动词切换前后、词间gap、loop两周期、exit中点、end−ε/end；随机seek和顺序播放逐帧一致。
- 一行/自动折行/手动换行/超长词；typewriter 固定全文布局与纸板；line swipe 按视觉行且被固定框裁切；词块在变色/缩放时不挤动相邻词。
- 语言：拉丁、中文、日文、阿拉伯RTL、印度文字、泰文、组合重音、emoji ZWJ、双语混排；规则不依赖其中某一种语言。emoji/连字允许定义的cluster原子性，但必须说明与参考的codepoint区别。

### 编辑与持久化

- 原文/译文、单cue/全局、双语独立摆位、保存品牌库、样式复制、撤销/重做、关闭重开均保持。
- 动态→静态清旧动效；静态→动态不带旧颜色/底板/transition；改颜色字体不重置动画。
- 有/无字体与系统字体变化：固定包输出一致，缺字有定义fallback，不能静默用错误字重。
- 大文稿和大样式库虚拟化；只采样当前cue与可见预览卡，缓存有界；不扫描全片每帧、不创建每字一个持久化timeline元素。

### 渲染与输出

- CPU reference、retained glyph scene、App实际舞台、Web WASM、MP4烧录使用同一个时间点；PNG检验不能被DOM缩略图代替。
- clean line 完全静态；9套动态中仅 kinetic-wave 常循环；检查pause/reduced-motion仅影响UI预览，不改输出作品。
- crop/clip不能切掉应保留的描边/阴影；soft focus为文字模糊；背景和word-box是否参与变换由明确规则决定。
- 原生App截图与实际播放验收，记录显示缩放率；阴影blur允许明确的像素容差，时序和文本内容不允许靠容差糊过去。
- 对不支持复杂动画的字幕文件/可编辑工程导出，列出支持矩阵并预检；MP4烧录为完整效果基准。

计划检查命令（下一次实现后执行，本次未运行）：

```bash
cd core
cargo fmt --all -- --check
cargo test -p bcut-motion -p bcut-subtitle-render -p bcut-editor-core
# 回到仓库根，单独执行：
node scripts/dev/doc-seam-check.mjs
```

App 按影响范围运行 cargo test 与原生快照；Web 重建编辑/字幕 WASM，跑 typecheck/lint/test/ds:check 及字幕端到端回归；原型跑 Spectrum 闸门、node --test、两份入口的 HTTP 预览。如 CLI 公开契约改变，再核对 help/spec、bcut-serve 对拍及产品 skill 目录。

## 12. 首次分析交付与边界（实施前记录）

首次分析只提交方案与目录索引，未修改渲染器、样式库、UI、协议、字体或产品 skill，也未部署。产品 UI 尚无变化，因此本次不提前修改三个表面的原型或产品规格；这些是 D 阶段的强制同步项。

已执行：静态源码检查；AST 提取并核对 10/16/5 个预设与17个原语；10段预览视频的50帧解码/人工查看；研究资料复制一致性与文档链接检查。没有执行代码测试、跨端视觉回归、31套BaoCut导出对拍，因为本次没有产品实现。


## 13. 合并后的实施口径

### 13.1 一起整理既有与参考目录

画廊从原来的 33 个家族归并为 9 个代表，再补 8 个不重复的行为配方，共 **17 个入口**。倒鸭子保持独立：它改变跨句排版和镜头，不能当成颜色变体。原有高级 Caption 配方维持原来的兼容入口，不因配色相近而删除。

| 代表家族 | 合并的外观 / 语义 |
| --- | --- |
| classic | prettymarketer、slay、kitty、hustle、grape、sprout、snugle、mint、rizz：当前词变色 |
| shorts | 保留画面尺寸适配和 Shorts 布局 |
| ali | matcha、beans、diego：朗读明暗；highlight 仍可在原有动画属性切换 |
| karl | flex、vinta、yeet：旧的按朗读时间浮入 |
| lime | boba、boo、plain、slant：旧的按朗读时间落入 |
| phantom / bulb / vegas | 分别保留移动高亮块、朗读揭示、翻页行为 |
| simple | shadeplay、casper、corpo、capri、lowkey，以及 Clean Line / 5 套静态参考：静态外观由属性编辑 |
| studio-focus | Zoom Punch + Accent Pulse：强调颜色、缩放、时长可调 |
| studio-word-tiles | Word Blocks：所有词都有固定底块，当前词独立强调 |
| studio-word-drop | Word Drop：按整句时钟错开入场，区别于原有朗读 Drop |
| studio-paper-typewriter | 固定全文排版后按字形簇揭示，底板稳定 |
| studio-line-swipe | 按真实折行的行滑入并裁切 |
| studio-soft-focus | 文字柔焦入场 |
| studio-rise-settle | 整句升起与落定、尾段退出 |
| studio-kinetic-wave | 字符入场及持续波浪 |
| studio-ktv | KTV 歌词：已唱逐字扫色、跳动引导点、双行预告下一句（2026-09-30 增补，见 §15） |

原有全部 ID 留在注册表，按 ID 加载、最近使用、存档、品牌样式和项目快照仍可恢复原外观；归并只影响画廊展示和代表卡选中态。不是将旧项目改写成代表卡。Basic 的 16 套是文字角色与外观组合，复用 BaoCut 已有 27 套文字预设及字体、底板、描边属性，不另加 16 个字幕类型。

机器真相：`core/assets/subtitle-gallery.json`（代表和别名）、`subtitle-designs.json`（8 份参数）。原型由 `scripts/dev/sync-subtitle-designs.mjs` 同步数据。

### 13.2 时间、存储与渲染

- `textMotion.version=1` 表达入场、退场、循环、独立词强调；17 个原语由 `bcut-motion::text_motion` 编译到共享 MotionProgram 进度曲线并采样。支持 cue / line / word / grapheme 和确定性顺序。
- 排版在动画前完成，复用已有 shaping；不拆开组合字、连字或 emoji 的字形簇。短句压缩入退场窗口；绝对时间采样支持倒放和随机跳转。
- `wordBackground` 独立于文字缩放；`backgroundPaddingY` 可单独指定；`fontSizeBasis: height` 明确按画布高折算。未写 basis 的旧项目沿用短边。
- 真实时间戳驱动词强调。译文和派生占位时间戳禁用词强调，按句播放的进出场仍生效。
- 样式写入前校验版本和参数；作用域覆盖、复制/保存、切换样式沿用原有事务。换回旧样式清掉新动画字段。
- 新动画的像素只有一份实现：共享 CPU 光栅（`text_motion_raster.rs`），native / WASM / MP4 同一实现，尚未直接编码成 retained glyph scene。只对活动 cue 采样，静止区间复用缓存；大字号超过临时图层预算时保留静态字形和底块。
- 回退按帧判，且只回退**字幕层**：只有本帧真正画出来的那一行（整条轨叠逐条覆盖后）带 `textMotion` / `wordBackground` 时，字幕 glyph scene 才报 `WordAnimation`；没有动效 cue 活动的帧照常走 glyph scene，静态准入（`subtitle_scene_static_fallback*`、`compositor_scene_support`）不再因新动画判死整片。
  - 桌面合成器（App GPU 预览、`studio export` 离屏 GPU）：动效帧的字幕层由 `render_subtitle_frame` 出图，按非零 alpha 包围盒裁成 1:1 纹理节点（整数矩形、恒等变换，窗宽高取整到 64 的倍数以复用纹理），放在原字幕节点的 z 序位置；槽名按计划稳定，不逐帧换名。视频、贴纸、形状等元素与模板仍是 GPU 节点，导出信封保持 `render_backend: "gpu"`。非 Normal 复合的动效帧仍回退。
  - 带 `textMotion` 的文字元素（`bcut element style --patch` 可写入）同样作为元素位置上的一张 CPU 光栅纹理进场景。只在动的帧（入场、退场、循环，或元素另带 `animation`）逐帧重建；入场结束到退场开始的静止段按编译后动效的 `boundary_windows` / `changing_at`（与光栅同一口径：局部钟吸到帧、时长 = end − start、文字元素没有词时间、units = 显示文字字素数）判定，`next_change` 直接指到退场开始前半帧（没有退场就是元素 end），Structural 身份与纹理采样钟取静止段起点、不混进时刻，整段一张图、不重光栅也不重传。字幕层纹理的采样钟同样固定，身份只随帧键（动的帧带帧号、静止时 `@settled`）变。
  - Web 预览不变：只要片里有动效字幕，字幕层整层走 `renderSubtitleRaster`，元素仍在 GPU（逐帧判定会让首个动效帧空一帧字幕）。
- 字幕文件不携带这些效果；可编辑工程预检使用现有 `attr-animation` 警告，MP4 为完整效果输出。

### 13.3 字号与界面

系统默认单语字号 34，双语按位置取上行 32、下行 20，与语言无关。默认译文在上、原文在下，种子比例为 `20/34`、`32/20`；缺少比例键的渲染回退以根字号 30 为基线，使用 `20/30`、`32/20`。原型默认轨集同样使用上行 32、下行 20，倒转叠法时交换位置与字号。已保存的自定义项目样式和用户默认不改写；跟随系统默认的项目在投影刷新后使用新值。

三个表面的属性页都编辑同一份时长、错开间隔、强度、强调颜色/缩放和词块颜色。普通字体、底板、描边、阴影仍用现有控件。新卡片像素使用共享 Rust 渲染器，Web 与原型先构建字幕 WASM；原型运行资源通过 `--runtime` 拷入被忽略的 `.runtime/subtitles/`。

六份增补字体及 OFL 正文见 `core/assets/fonts/subtitle-design-fonts.json`；CJK 及其他缺字仍走原有回退，不把示例文字语言设为用户内容默认。


## 14. 实际验证与限制

- 原生 App `cargo check --bin baocut` 通过。未替换当前安装的 App，未做 GPUI 实机快照或全量 App 测试。
- `bcut-motion` 180 项、`bcut-editable` 43 项通过。本轮已构建的原生测试程序中，字幕渲染 248 项、workspace 158 项通过。
- editor-core 首轮 2,333 项通过、2 项失败：新双语配方误带固定字号已修复；新增保存恢复测试将单行 partial 当作根样式读取，已按单语 UI 的 Both 写路径修正。新版 editor WASM 的样式/作用域/写入/字体 60 项回归全部通过，包含双语比例链和合并目录。
- 原型 1,515 项模型测试通过；App/Web 两入口经 HTTP 检查卡片、双语舞台和参数编辑，入场时长可以改为 0.5 秒，轨道名称和内容保持。未以这些浏览器画面代替 GPUI 抗锯齿验收。
- Web typecheck、lint、两表面设计系统检查、目录生成对拍、文档链接、6 份字体 SHA-256 / 许可及新增 15 键 × 15 语言覆盖检查通过；产品 skill 审计及目录检查通过。
- 生产字幕 WASM 渲染 8 家族 × 5 时刻，共 40 帧；另测 1080p 四词样张每家族前 12 帧。在当时机器并发编译负载下，平均约 10–38ms/帧；模糊和多词场景可能更慢，不能据此承诺全部项目 30/60fps。裁去临时图层透明边缘后，较初版每帧 220–620ms 显著下降。
- 此前 4 项 native wasm-safe 渲染集成测试通过。最后新增的缺词时间、尾段退出、相邻词块确定性等扩展为 7 项的原生集成重跑，以及 editor-core 原生全量重跑，受全机 30 多个 Cargo 的到达顺序排队影响未完成；已停止本任务仍在排队的两条命令，未中断其他会话。不能将它们记为通过。

- 2026-09-28 逐帧回退修正（不再因新动画整片关 GPU）：字幕渲染 lib 254 项（含新增 `text_motion_subtitles_rasterize_into_a_texture_node_per_frame`、`text_elements_with_text_motion_become_texture_nodes`、`text_motion_elements_hold_one_identity_while_still`（0.6 秒 rise 入场的 0–3 秒元素：t=1.0 与 2.0 的 Structural 身份与像素相同、`next_change` 指到 end，t=0.1 与 0.3 身份不同），纹理字节等于 CPU 帧的裁剪、窗外为空、槽名跨帧稳定、无动效 cue 的帧仍是 glyph scene）通过，集成测试除并行会话改光栅后未重生成的 `text_motion_frames_match_golden` 外通过；wasm-safe `text_motion` 8 项通过；`bcut-compositor --features gpu --test gpu_target` 37 项通过 2 项 ignored，新增 `compositor_text_motion_subtitle_texture_matches_cpu_and_plain_cues_stay_glyphs` 在本机 Metal 上真跑，GPU 回读与 CPU 参考逐字节一致（`max_deviation == 0`）；kernel `text_motion_subtitles_keep_auto_export_on_the_gpu` 用 auto 后端实际编码，回执 `render_backend: "gpu"`、`fallbacks: []`。`cargo check -p bcut-kernel`、`bcut-wasm-subtitle` 的 wasm32 check、App `cargo check --bin baocut` 通过。未做 Windows / D3D、Web 浏览器实机与 GPUI 快照。
- 2026-09-28 逐帧光栅减负（[core 日志](../../changelog/core/2026-09-28-204033.md)）：1080p 入场窗口、改前 / 改后交替取均值，八套设计 0.40–3.98ms/帧（改前 0.58–4.23），30 字素模糊 8.7 → 1.56ms、加阴影 15.4 → 5.5ms、加发光 17.1 → 6.4ms；324 帧 SHA-256 与改前逐字节一致。其后平移父变换下改为子像素光栅、其余 Bilinear 贴图，像素有意改变，`text_motion_frames_match_golden` 已据此重生成；回退上限改为画布面积 × 4（夹在 16 Mpx 到 8192²），8K 全宽一行不再退成静态。

仍可补跑的检查：

```bash
cd core
cargo test -p bcut-editor-core -p bcut-subtitle-render -p bcut-workspace --lib
cargo test -p bcut-subtitle-render --features wasm-safe --test text_motion
cargo run -p bcut-subtitle-render --example subtitle_design_sheet -- /tmp/subtitle-designs
```

未执行：上述最终原生重跑、原生示例程序、完整 MP4 编码链路、Windows、全量 Web E2E。新动画字幕层的 CPU 光栅和外部可编辑工程的动画降级是已知边界，见 §13.2。效果图与采样耗时已放回本机分析目录 `subtitle-research/baocut-implementation/`。

## 15. KTV 歌词（2026-09-30 增补）

需求四条对照现有能力：深色描边配亮色填充与阴影已有（样式本身的 `textOutline` / `dropShadow`），所以新卡只写这组参数；逐字变色、交界引导点、双行预告此前都没有，补进 `textMotion.karaoke`，画廊增加一张代表卡 `studio-ktv`（共 18 个入口）。

```json
{"textMotion":{"version":1,"karaoke":{"color":"#FF6A1A","guide":true,"nextLine":true}}}
```

- **扫字**：已唱完的词整词换成 `color`；正在唱的词按它自己的真实起止时间推进，词内按字素簇均分，交界那个字素画两遍（底色一遍，已唱色裁到交界左侧再叠一遍），所以一个字可以唱到一半。描边、阴影不变色。词与词之间的停顿保持已唱部分。时间只来自原文真实词时间。译文没有自己的词时间，译文行借同一时段里的原文真实词（词中点落在译文这条的时段内）：原文唱到第几个词、唱到几分，译文就按同样的比例在自己的全部字素上扫，两行同起同止（`TextMotionItem.karaoke_words` → `LineLayout.karaoke_words`）。借不到原文真实词的行（没有词时间、只有派生占位词）不扫，保持底色，也不触发逐帧重画。算法在 `bcut-motion::text_motion::CompiledTextMotion::karaoke_sung`，像素在共享 CPU 光栅 `text_motion_raster.rs`，App 预览、Web 预览与 MP4 导出同一份实现。
- **引导点**（`guide`）：扫字交界处、行顶上方一颗已唱色的小圆点，外圈用描边色；双语叠放时下面那一行把点画在行底下方、往下跳（`LineLayout.guide_below`），不压上一行的字。点只跟原文行，借时间扫的译文行不画点，免得两颗点抢拍；每越过一个字素跳一下（`karaoke_guide_hop`，用 `libm` 保证各平台逐字节一致）。第一个词开唱之前不画。
- **双行预告**（`nextLine`）：只在单行模式（仅原文或仅译文）下生效。正在唱的这句排在上面，同一轨的下一条 用同一份样式、全底色排在下面（`LineLayout.preview`），不采样动效、不扫字，也不进帧缓存键（由当前句唯一决定）。下一句在当前句结束 8 秒之后才出场的（间奏）不预告。双语模式下画面已经是两行，不再叠第三行。几何侧车里预告行照常是一条 `orig` 行，点它选中的是下一条 cue。
- 属性页三个表面都编辑同一份：已唱颜色、引导点开关、预告下一句开关；字体、描边、阴影仍用原有控件。双语套装的译文行保留 `karaoke`（只去掉朗读强调），所以选 KTV 卡后原文、译文两行一起扫。
- 已知边界：扫字交界按排版位置计算，只叠加 `dx` 位移；若同一份样式另外叠了缩放、旋转类入场动画，交界在动画进行中会略偏，动画结束后准确。字幕文件与可编辑工程不携带扫字（沿用 §13.2 的 `attr-animation` 警告），完整效果用 MP4。
