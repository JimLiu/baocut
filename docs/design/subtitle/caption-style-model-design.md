# 字幕样式模型：按维度组合，预设只是取值

状态：提案，原型先行（2026-10-09）。本文定义 v3 字幕样式的**目标合同** `baocut.caption-style/1`，并给出它与已落盘的 Studio 样式、渲染内核各键的对应。原型按本文改；Electron / Web 与内核的改动等用户确认原型后再做（[开发流程 §3](../../development-workflow.md#3-多端同步)）。规范入口在[视频格式规范 §5.6](../../spec/video-format-spec.md#56-layoutprofile样式与导出)。

## 目录

1. [目标与结论](#1-目标与结论)
2. [现状：一份样式里五套写法](#2-现状一份样式里五套写法)
3. [模型：七个维度](#3-模型七个维度)
4. [当前词（activeWord）：每份样式自带的高亮](#4-当前词activeword每份样式自带的高亮)
5. [KTV 模式](#5-ktv-模式)
6. [倒鸭子：`layout.mode = 'sequence'`](#6-倒鸭子layoutmode--sequence)
7. [预设与分类](#7-预设与分类)
8. [编译到内核：新正文 → Studio 样式](#8-编译到内核新正文--studio-样式)
9. [界面：画廊与属性页](#9-界面画廊与属性页)
10. [落地顺序与验证](#10-落地顺序与验证)
11. [与现有规格、原型的差异](#11-与现有规格原型的差异)

## 1. 目标与结论

一份字幕样式不再是一张「卡」，而是七个彼此独立的维度各取一个值：**字体、涂装、落位、当前词、动效、强调词、排版模式**。画廊里的预设只是这七个维度上的一组默认取值；用户换掉其中任何一个维度，其他维度不动。这样 20 份涂装 × 8 种当前词 × 10 种入场就是上千种字幕，而不用再往画廊里堆卡。

三条硬规则：

- **每份预设必须自带当前词样式**（`activeWord`）。黄底药丸配黄色当前词等于没有当前词，所以当前词颜色不能留全局默认；没有词级时间的轨（译文、导入字幕）当前词恒为 `none`。
- **KTV 是当前词的一种模式**（`activeWord.mode = 'sweep'`）：播放到哪，文字的颜色就从底色逐渐扫成另一种颜色。它不是「卡拉 OK 预设」，任何涂装都能配它。
- **倒鸭子是排版模式**（`layout.mode = 'sequence'`），不是逐词动画：它接管整条源语言轨的排版、镜头与颜色，自己的设置项挂在 `layout.sequence` 下；涂装与落位的大部分键对它不生效。

渲染内核**不换**。`baocut.caption-style/1` 由一层纯函数编译成内核现在读的 Studio 样式（§8）；三个表面（原型、Electron、Web）与导出走同一份编译，画廊缩略图、画布预览与成片才会是同一个样子。

## 2. 现状：一份样式里五套写法

v3 现在落盘的是 v2 的 Studio 样式（`baocut.legacy-studio-style/0.1`），一张扁平表。同一件事「念到的词长什么样」在里面有五种写法，彼此不知道对方的存在：

| 写法 | 键 | 谁在读 | 说明 |
| --- | --- | --- | --- |
| 逐词动画目录 | `wordAnimation` / `anim`（19 格，`catalogId`） | 内核 `word_animation()`、画廊缩略图 | 高亮方式、入场动作、颜色三件事压成一格；`karaoke` 一格实际是「没念到的词变淡」 |
| 文字动效 | `textMotion {in, out, loop, emphasis, karaoke}` | 内核 `crates/motion` | `emphasis` 是当前词变色放大；`karaoke` 才是真正的 KTV 扫色 |
| 逐词底块 | `wordBackground {color, activeColor, …}` | 内核 `LineStyle` | 当前词底块换色，与上两套无关 |
| 强调词 | `captionEmphasis {<wordId>: {role, color, emoji}}` | 内核，只对动效字幕配方生效 | 用户手点的主角词 |
| 规格草案 | `CaptionStyle.highlight {mode: 'word' \| 'none', color}` | 无 | 未落盘 |

后果：真实编辑器的预设只写「涂装」，套一张卡会把动画整个丢掉（`packages/ui/src/model/caption-presets.ts` 的 `PAINT_KEYS`）；`wordAnimation` 键缺席时内核画 `Color` + `#8CAAFF`，有键但没名字时画 `None`；倒鸭子在原型里有、在编辑器里进不去。

## 3. 模型：七个维度

```ts
// 目标合同。写法沿用规格的 DTO 概要，不代表已生成的 Schema。
interface CaptionStyleBody {
  schema: 'baocut.caption-style/1';
  typography: Typography;
  surface: Surface;
  layout: Layout;
  activeWord: ActiveWord;          // §4，必填；无词时间的轨写 { mode: 'none' }
  motion?: Motion;                 // 省略 = 静态
  emphasis?: EmphasisLook;         // 强调词的外观；哪些词是强调词记在实例上
  preset?: { id: string; revision: number };   // 来源卡，只做选中态与「还原」，不参与渲染
}
```

所有长度都是**比例**，不是像素：字号占画布短边的比例，其余占字号的比例（em）。同一份样式在 13 px 的缩略图和 1080p 的成片上才是同一个形状。

### 3.1 字体 `typography`

```ts
interface Typography {
  fontFamily: string;              // 族名；字重单独给，不编进族名
  fontWeight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  italic: boolean;
  size: number;                    // 占画布短边的比例，如 0.055
  lineHeight: number;              // 行高倍数
  letterSpacing: number;           // em，可为负
  casing: 'none' | 'upper' | 'lower' | 'title';
  align: 'left' | 'center' | 'right';
}
```

### 3.2 涂装 `surface`

```ts
interface Surface {
  color: string;                                            // 字色，CSS 色
  stroke?: { color: string; width: number };                // width 为 em
  shadow?: { color: string; offset: [number, number]; blur: number };   // em
  glow?: { color: string; intensity: number; range: number };
  plate?: { mode: 'line' | 'block'; color: string; opacity: number;
            padding: [number, number]; radius: number };    // 底板，em
  wordBox?: { color: string; padding: [number, number]; radius: number };   // 逐词底块，em
}
```

`plate` 是整条字幕的底板（`line` 逐行贴底、`block` 整条一块），`wordBox` 是每个词各一块；两者可同时存在，但预设不应同时给。当前词在底块上的颜色写在 `activeWord.box`，不写在这里。

### 3.3 落位 `layout`

```ts
interface Layout {
  mode: 'line' | 'sequence';       // 'sequence' 见 §6
  anchor: 'top' | 'center' | 'bottom';
  y: number;                       // 锚点离画布上沿的比例（0–1）
  width: number;                   // 行宽占画布宽的比例
  maxLines: 1 | 2 | 3;
  sequence?: SequenceOptions;      // mode = 'sequence' 时有效
}
```

Shorts 那种「大字贴安全框底 72%」是落位，不是涂装：同一份涂装抄到译文轨上时落位要按画面上有几条轨一起算。

### 3.4 当前词 `activeWord`

见 §4。

### 3.5 动效 `motion`

```ts
interface Motion {
  in?: Effect;
  out?: Effect;
  loop?: Effect;
}
interface Effect {
  preset: string;                  // 入场：typewriter fade-up rise cascade pop blur-in slide-mask wave-in
                                   //       drop-in float-in-top float-in-bottom scale-in impact flip stomp stack
                                   // 退场：fade-down sink pop-out blur-out typewriter-erase
                                   // 循环：pulse wave shimmer swing
  unit: 'cue' | 'line' | 'word' | 'grapheme';
  trigger: 'enter' | 'spoken';     // enter：字幕出现时按 stagger 依次入场；spoken：每个词念到时才入场
  durationSeconds: number;
  staggerSeconds?: number;         // trigger = 'enter' 时有效
  intensity: number;               // 0–2
  easing: 'linear' | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad' | 'overshoot';
  order?: 'forward' | 'backward' | 'center' | 'random';
  seed?: number;
}
```

`trigger: 'spoken'` 是逐词动画目录里 `dropIn` / `floatInBottom` / `scaleIn` / `impactPop` / `flipClock` / `stomp` / `stack` 那几格的真身：它们是「每个词念到时做一个入场动作」，与当前词的高亮方式正交。目录把「念到时落入」和「当前词变黄」压成一格，这里拆开，所以「落入 + 底块高亮」「翻页 + 扫色」都能组合。

### 3.6 强调词 `emphasis`

```ts
interface EmphasisLook {
  color?: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  scale: number;                   // 0.8–1.6
}
```

哪些词是强调词是**实例数据**（`captionEmphasis`，按词 ID，角色 `emphasis` / `hero`，视频格式规范 §3.8），不是样式；样式只说强调词长什么样。倒鸭子的「主角词」用同一份数据。

### 3.7 排版模式 `layout.mode`

`line` 是普通字幕：一句一条，按落位摆。`sequence` 是倒鸭子（§6）。将来的「动效字幕」配方（`caption-*` 16 份，原型第 74 轮下架）如果重新上架，也落在这个维度上（`mode: 'recipe'`），不另开一套键。

## 4. 当前词（activeWord）：每份样式自带的高亮

```ts
interface ActiveWord {
  mode: 'none' | 'color' | 'box' | 'scale' | 'lift' | 'underline' | 'sweep';
  color?: string;                  // color / underline / sweep 的目标色；box 的字色
  scale?: number;                  // scale：当前词放大倍数（1.04–1.3）；其他模式可叠加
  box?: { color: string; radius: number; padding: [number, number] };   // box：当前词底块，em
  lift?: number;                   // lift：当前词上抬，em
  sweep?: Sweep;                   // §5
  durationSeconds?: number;        // 进入当前态的过渡时长，默认 0.16
  spoken: 'keep' | 'tint' | 'dim';         // 念过的词：不变 / 染成 spokenColor 并下划线 / 变淡
  unspoken: 'keep' | 'dim' | 'hidden';     // 没念到的词：不变 / 变淡 / 不画（逐词显现）
  spokenColor?: string;
  dimOpacity?: number;             // dim 的不透明度，默认 0.5
}
```

规则：

- 当前词按**最后一个 `start ≤ t` 的词**判定，词与词之间的空隙保持上一个词（`hold previous`），一句的最后一个词保持到句尾。
- `mode` 只决定当前词本身；`spoken` / `unspoken` 是两根独立的小轴。逐词动画目录里的 `reveal`（没念到的不画）就是 `mode: 'none', unspoken: 'hidden'`，`karaoke` 那一格是 `mode: 'none', unspoken: 'dim'`，`highlight`（荧光笔）是 `spoken: 'dim', unspoken: 'dim'`，`paint`（刷过）是 `spoken: 'tint'`。
- `scale` 可以叠在 `color` / `box` 上（`mode: 'color', scale: 1.1` 是「变色并微放大」），这是参考实现里最常见的组合。
- 预设必填 `activeWord`；译文轨与无词时间的导入字幕由编译层强制改成 `{ mode: 'none' }`，缩略图上也不画。

**19 格逐词动画目录的对应**（内核目录不变，这是编译层的查表）：

| 目录格 | activeWord | motion.in（trigger: spoken, unit: word） |
| --- | --- | --- |
| `none` | `none` | — |
| `colourHighlight` | `color` | — |
| `boxHighlight` / `stack` | `box` | — / `stack` |
| `highlight`（荧光笔） | `none`, spoken `dim`, unspoken `dim` | — |
| `karaoke` | `none`, unspoken `dim` | — |
| `reveal` | `none`, unspoken `hidden` | — |
| `bounce` | `lift` 0.22 | — |
| `paint` | `none`, spoken `tint` | — |
| `dropIn` / `floatInTop` / `floatInBottom` / `scaleIn` / `impact` / `impactPop` / `stomp` | `color` | `drop-in` / `float-in-top` / `float-in-bottom` / `scale-in` / `impact` / `impact`（intensity 1.3） / `stomp` |
| `flipClock` / `rotateFlipClock` / `rotateHighlight` | `color` / `color` / `color` + `tilt` | `flip` / `flip` + `tilt` / — |

`tilt` 是「随机旋转位」：目录里 `rotate*` 三格与不带 rotate 的同名格只差这一位，没有它往返查表回不来。

## 5. KTV 模式

`activeWord.mode = 'sweep'`：

```ts
interface Sweep {
  unit: 'grapheme' | 'word';       // 颜色按字符还是按词推进；默认 grapheme
  guide?: boolean;                 // 扫到的位置画一个引导点
  nextLine?: boolean;              // 下一句排在当前句下方预告（双语画面不叠加）
}
```

行为：

- 每个词有 `[start, end]`，扫色进度在词内按时间线性推进（`unit: 'grapheme'` 时按字符数等分词内时间；`unit: 'word'` 时整词在 `start` 瞬间换色）。扫过的部分是 `activeWord.color`，没扫到的是 `surface.color`；词之间的空隙保持上一个词扫满的状态。
- 没有词级时间的轨不扫（编译成 `none`），不按句时长伪造进度。
- 内核已落地：`textMotion.karaoke {color, guide, nextLine}`，`karaoke_sung(t)` 给出扫到第几个词的小数位置（`crates/motion/src/text_motion.rs`）。`unit: 'grapheme'` 对应现状，`unit: 'word'` 待实现（§10）。
- 它与 `motion.in` 正交：「逐词落入 + 扫色」是合法组合；与 `spoken: 'tint'` 互斥（扫色本身就是染过）。

## 6. 倒鸭子：`layout.mode = 'sequence'`

倒鸭子（v2 `caption-daoyazi`）是跨句的动态排版：字幕的词铺在一张无限画布上，镜头飞到、转向、缩放到正在念的那一块。它接管源语言轨整条的排版、颜色与镜头，所以放在 `layout` 维度上；`typography.fontFamily / fontWeight` 仍生效（字重至少 700），`surface.color` 作为主色，`activeWord` 固定为「当前词换一种强调色」（由配色决定），`motion` 与 `layout.anchor / y / width / maxLines` 不生效。

```ts
interface SequenceOptions {
  preset: 'standard' | 'light';    // light：不转向、提前量 0.3、停留 0.35、动感上限 40
  intensity: number;               // 0–100，默认 60
  speed: number;                   // 0.35–2，默认 1
  palette: { primary: string; accent: string; secondary: string; background: string };
  seed: number;                    // 换一版 = 换 seed
  reveal: 'block' | 'word';        // 整块弹出 / 逐词出现，默认 block
  camera: { motion: 'smooth' | 'stopAndGo'; dwell: number; anticipation: number; maxTurnDeg: 0 | 90; fit?: number };
  layout: { density?: number; turnEvery: number };
  presentation: { viewportMode: 'center' | 'bottom' | 'full'; background: 'transparent' | 'solid';
                  history: { maxBlocks: number; opacity: number }; ending: 'hold' | 'overviewIfRoom' };
  sequence: { maxDurationMs: number; maxBlocks: number; maxWords: number; pauseThresholdMs: number; breakOnSpeakerChange: boolean };
}
```

内置配色四套（v2 原值，名字改为英文标识）：

| id | primary | accent | secondary | background |
| --- | --- | --- | --- | --- |
| `classic` | `#FFFFFF` | `#FF9B42` | `#59BAF2` | `#111214` |
| `neon` | `#F4F4F4` | `#C6FF3D` | `#FF4FD8` | `#0B0B12` |
| `paper` | `#F6EFE4` | `#FF6A3D` | `#7FD1FF` | `#2A211C` |
| `ice` | `#E8F4FF` | `#4CC9FF` | `#FFD166` | `#0E1A26` |

逐段的编辑（从这句另起一段、某段换 seed、把某行钉在画布某处并旋转）是实例数据 `captionSequences`，不是样式（[倒鸭子设计 §5.4](bcut-daoyazi-caption-design.md)）。

属性页的设置项与 v2 一致（[倒鸭子设计 §3.3](bcut-daoyazi-caption-design.md)）：预设、动感、速度、配色、换一版（整轨 / 当前段）、从这句另起一段、逐词出现、镜头运动、镜头停留、提前量、最大转向、字幕区域、历史行数、历史透明度、背景、段落结束、疏密、贴合、调整布局（旋转 90°、固定位置、恢复自动）。没有字号与每行词数：「贴合」顶替字号，「疏密」决定每行塞多少。

内核已落地：`crates/subtitle-render/src/caption_sequence.rs`（编译器 `typography-world`）与配方描述 `assets/captions/styles/caption-daoyazi-v1.json`；对应键见 §8。

## 7. 预设与分类

预设 = 七个维度各一个取值 + 一个分类标签 + 一张能看出当前词的缩略图。分类是画廊的分区，**只按气质分**，不按技术分；一份预设用了什么当前词、什么入场，在卡角落用小标记标出。

| `category` | 画廊分区 | 装什么 |
| --- | --- | --- |
| `basic` | 基础 | 经典、Shorts、简洁——新建项目与竖屏发布的默认 |
| `social` | 社交 | 大字、全大写、高饱和当前词色 |
| `business` | 商务 | 底板、小字、低对比当前词 |
| `retro` | 复古 | 斜体、黄字、硬阴影 |
| `motion` | 动效 | 以入场为主的设计：逐词落入、打字机、逐行滑入、柔焦、升起落定、字符波浪、KTV 歌词 |
| `kinetic` | 动态排版 | 倒鸭子（一张卡；配色与镜头是它属性页里的选项，不拆成多张卡） |

内置预设按现状整理，不新增，共 43 份：基础 3（经典、Shorts、简洁）、社交 20（现有社交 18 份加朗读强调、逐词底块）、商务 6、复古 6、动效 7、动态排版 1。每份预设的 `activeWord` 必须显式写出；下面是基础区与动效区的取值，其余按 §8 的查表从现有数据机械换算：

| 预设 | activeWord | motion.in | 备注 |
| --- | --- | --- | --- |
| 经典 | `color #18E1D6` | — | 新建项目默认 |
| Shorts | `lift 0.22, color #FFE14D` | — | 落位 `anchor bottom, y 0.72` |
| 简洁 | `color #FFFFFF, scale 1.06` | — | 商务底板样式的无底板版 |
| 朗读强调 | `color #FC75E9, scale 1.18, durationSeconds 0.2` | — | |
| 逐词底块 | `box {#FFD84D}, color #191919, scale 1.04` | — | `surface.wordBox` 常驻深底 |
| 逐词入场 | `color` | `cascade, word, enter, 0.22s, stagger 0.04` | |
| 逐字显现 | `none, unspoken hidden` | `typewriter, grapheme, enter` | |
| 逐行滑入 | `color` | `slide-mask, line, enter, 0.36s` | |
| 柔焦显现 | `color` | `blur-in, cue, enter, 0.38s` | |
| 升起落定 | `color` | `rise, cue` + `out: fade-down` | |
| 字符波浪 | `color #FFE547` | `wave-in, grapheme` + `loop: wave` | |
| KTV 歌词 | `sweep #FF6A1A, guide, nextLine` | — | |
| 倒鸭子 | 由 `layout.sequence.palette` 决定 | — | `layout.mode sequence` |

用户在属性页里改过任一维度后，卡的选中态仍亮（按 `preset.id` 判），旁边显示「已修改 · 还原」。用户保存的样式进品牌库，形状与内置预设相同。

## 8. 编译到内核：新正文 → Studio 样式

一层纯函数 `compileCaptionStyle(body, ctx) → StudioStyle`，`ctx` 带画布尺寸、轨角色（源语言 / 译文）、有没有词级时间。三个表面与导出共用；原型里先用 JS 写（`model-captionstyle.js`，`node --test`），确认后移到 `packages/ui` 与内核旁各留一份对拍测试。

| 新键 | Studio 键 | 状态 |
| --- | --- | --- |
| `typography.fontFamily / fontWeight / italic` | `fontFamily`、`fontWeight`、`italic`、`bold = weight ≥ 700` | 已落地 |
| `typography.size` | `fontSize = round(size × 540)`（参考短边 540） | 已落地 |
| `typography.lineHeight / letterSpacing / casing / align` | `lineHeight`、`letterSpacing`（em × 字号）、`textTransform`、`textAlign` | 已落地 |
| `surface.color / stroke / shadow / glow` | `fontColor`、`textOutline`、`dropShadow`、`glow` | 已落地 |
| `surface.plate` | `background`、`backgroundColor`、`backgroundStyle wrap/block`、`backgroundPadding`、`backgroundPaddingY`、`borderRadius` | 已落地 |
| `surface.wordBox` + `activeWord.box` | `wordBackground {color, activeColor, paddingXEm, paddingYEm, radiusEm}` | 已落地 |
| `layout.anchor / y / width` | `verticalAlign`、`y`、`width` | 已落地 |
| `layout.maxLines` | — | 待落地（内核按 LayoutProfile 换行，样式不限行数） |
| `activeWord.mode color / scale / lift / underline`, `spoken`, `unspoken` | `wordAnimation {animationId, animationName, spoken, active, unspoken}`（目录格 + 三态覆盖） | 已落地 |
| `activeWord.scale` 叠加、`durationSeconds` | `textMotion.emphasis {color, scale, durationSeconds}` | 已落地 |
| `activeWord.mode sweep` | `textMotion.karaoke {color, guide, nextLine}` | `grapheme` 已落地；`word` 待落地 |
| `motion.in/out/loop`（`trigger: enter`） | `textMotion.in/out/loop` | 已落地（预设名一一对应） |
| `motion.in`（`trigger: spoken`） | 逐词动画目录对应格（§4 表）；目录没有的组合待落地 | 部分 |
| `emphasis` | 原型 `highlight {color, font, bold, italic, scale}`；内核只对配方读 `captionEmphasis` 的颜色 | 待落地（普通字幕的强调词外观） |
| `layout.mode sequence` + `layout.sequence` | `wordAnimation.caption {schema 1, content 'orig', style {id 'caption-daoyazi', version 1}, palette, intensity, speed, seed, options: [{kind:'object', key:'daoyazi', value:{preset, sequence, layout, camera, entrance, reveal, presentation}}]}` | 已落地（v2 键原样） |

编译是确定的、无副作用的；同一份正文在三个表面得到同一份 Studio 样式，这是「缩略图 = 画布 = 成片」的依据。反向（Studio → 新正文）只做「尽力」解析，用于打开旧项目：解析不出的键保留在 `legacy` 下原样回写，不丢。

## 9. 界面：画廊与属性页

原型先改（`designs/baocut`），确认后同步 Electron / Web。

**画廊**（字幕样式）：按 §7 的六个分区排卡；每张卡的缩略图用这份预设自己的 `activeWord` 与 `motion` 循环播放，不再借当前文档的动画。卡角落一枚小标记标出当前词模式（色块 / 底块 / 扫色 / 上抬 / 无）。

**属性页**分段对应七个维度，顺序：

1. 文字（typography）
2. 外观（surface：颜色、描边、阴影、发光、底板、逐词底块）
3. **当前词**（activeWord）：一排模式格（无 / 变色 / 底块 / 放大 / 上抬 / 下划线 / 扫色），每格用当前轨的文字实时演示；下面是颜色、放大、过渡、「念过的词」「没念到的词」两个三选一；扫色时多出「按字 / 按词」「引导点」「预告下一句」
4. 动效（motion）：入场 / 退场 / 循环三格，各自一个选择器，带单位、触发（出现时 / 念到时）、时长、强弱
5. 强调词（emphasis）：点词 + 外观
6. 落位（layout）
7. 双语、提前 / 滞后、标点、作用范围（全部 / 仅这一条）——不属于样式，保持现状

`layout.mode = 'sequence'` 时，2–6 段替换成倒鸭子那一段（§6 的设置项，分「样式」「镜头与排版」「主角词与断段」「调整布局」四组）。

## 10. 落地顺序与验证

1. **原型**：`model-captionstyle.js`（七维模型、§8 编译、§4 查表、31 + 12 份内置预设的换算）+ `node --test`；画廊按 §7 分区；属性页按 §9 分段，新段各自一个 `panel-*.jsx`；`WordLine` 支持 `sweep`（按字符渐进换色）与 `spoken` / `unspoken` 三态。App 与 Web 两个入口都过，控制台无报错。
2. 用户确认原型后：`packages/ui` 新增 `caption-style-body.ts`（类型 + 编译 + 解析）、预设表改为新正文、画廊与属性页同步、`applyPreset` 不再只写涂装；倒鸭子属性页进编辑器；内核补 `sweep.unit = 'word'`、普通字幕的强调词外观、`maxLines`。
3. 验收：缩略图、画布、导出三处对同一份正文的渲染一致（像素抽样）；31 份旧预设经编译后与 v2 的 Studio 样式逐键相等（回归表）；换当前词模式不改涂装、换涂装不改当前词（属性互不串）；译文轨当前词恒 `none`；倒鸭子的 16 项设置往返内核键无损。

## 11. 与现有规格、原型的差异

- 视频格式规范 §5.6 的 `CaptionStyle` 草案（`highlight {mode: 'word' | 'none'}`）由本文的 `CaptionStyleBody` 取代；规格正文已改为引用本文（同一任务）。
- 规范 §5.6 的 19 格目录继续作为**内核合同**存在；新正文不直接暴露目录 id，由编译层查表。
- 原型现状：画廊分区「我的品牌库 / 默认 / Shorts / 动态排版 / 社交 / 商务 / 复古」改为 §7；「字幕动画」一行（19 格）拆成「当前词」与「动效」两段；`look.activeColor` 并入 `activeWord.color`；`wordAnim` / `caption` / `textMotion` / `wordBackground` / `highlight` 这几个轨键由新正文派生，`CUE_KEYS` 的分组随之调整。
- 动效字幕配方（`caption-*` 16 份）仍下架（第 74 轮用户裁决），本文只给它留 `layout.mode: 'recipe'` 的位置。
- 倒鸭子的示例载荷 `bcut-daoyazi-caption-style.example.json` 与内核不一致（`options` 应为数组、`reveal` 默认 `block`、历史透明度默认 1.0），本文以内核为准。
