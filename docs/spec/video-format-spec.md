# BaoCut 视频格式规范

> 视频是权威的可编辑对象；导出的成片与导入的视频文件都不是它。本规范定义它的数据模型：时间、序列与实例、素材与文档、语音与字幕、口播剪辑、配音与版本，以及便携包。

格式标识：`baocut.video`，`schemaVersion: 3`。

本规范定义**数据与数值规则**。修改视频的命令见[命令与协议规范](command-protocol-spec.md)；代码合成包见[代码包规范](code-bundle-spec.md)；存储、渲染与依赖失效的机制见[系统架构设计](../architecture/architecture-design.md)。本规范是草案。画面元素的种类与参数采用 v2 的元素模型（`crates/timeline`），逐项对照与裁决见[元素模型对照](../design/timeline/element-model-mapping.md)。用语见[文档约定](../README.md#文档约定)，术语见[术语表](../glossary.md)。

## 目录

- [1. 范围与约定](#1-范围与约定)
- [2. 时间模型](#2-时间模型)
- [3. 视频](#3-视频)
- [4. 素材与文档](#4-素材与文档)
- [5. 语音、字幕与翻译文档](#5-语音字幕与翻译文档)
- [6. 口播剪辑](#6-口播剪辑)
- [7. 配音、版本与声音事件](#7-配音版本与声音事件)
- [8. 便携包](#8-便携包)
- [9. 待补全项](#9-待补全项)

---

## 1. 范围与约定

### 1.1 类型的地位

文中的类型用 TypeScript 写法表达，是交换用的 DTO 概要。

- 语义与校验由 Rust 实现单源定义；TypeScript 的 DTO 与 JSON Schema 由它生成（架构设计 §13.2）。
- DTO 不规定数据库的实体布局。素材版本与文档版本引用不可变的内容；一次视频响应不需要带上几万个词或全部源码（§4.4）。
- 标注「本规范补全」的类型在原始设计中只有名称或用法，其字段由本规范给出，列入 §9 待评审。

### 1.2 基础类型

```ts
type Id = string;
type Revision = string;                          // 非负十进制整数字符串
interface VersionRef { id: Id; revision: Revision }
type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };
```

`Revision` 与事件序号用十进制字符串，避免 64 位整数在 JSON 中丢失精度。比较按数值，不按字符串。

时间类型 `Rate`、`MediaTime`、`FrameSpan` 见 §2.3。

### 1.3 身份规则

- 所有实体使用稳定 ID。
- 素材 ID 标识资源的身份；素材版本标识一份确定的 bytes 与元数据。
- 实例 ID 标识时间线上的一次使用。同一素材在时间线上出现三次是三个实例，不是同一个实例的三个位置。
- 同一素材的多处使用、同一代码包的多个参数实例、嵌套序列和语言覆盖，都必须有各自稳定的 ID。
- ID 与内容指纹是两回事：ID 不变不代表内容没变（§5.2）。
- 视频的 `id`（`videoId`）在它的 `video.db` 里，不另放标记。`video.db` 的元数据另记两项，它们不属于视频的修订内容：写它们不产生新版本，不进撤销历史，也不出现在 `VideoSnapshot` 里。
  - `projectId`：视频所属的项目。没有记时（升级前的视频、不属于项目的视频）由第一次认领它的项目写入，`id` 不变。
  - `previousVideoIds`：这个视频曾经用过的 `id`，JSON 数组，旧的在前。视频被认领到与记下的不同的项目时（项目目录被复制，或视频被搬到另一个项目）换成新的 `id`，旧的追加进来；内容、修订号与历史不变。换 `id` 是一个数据库事务：所有表里的视频 `id`、视频自身实体的 id，以及回执、事件与撤销记录里引用它的地方一起改。
- 项目是一个目录，它的标识在项目目录的 `.bcut/project.json`，与视频分开（架构设计 §5.1）：

  ```ts
  interface ProjectMarker {
    format: 'baocut.project';
    schemaVersion: 1;            // 高于已知版本时拒绝打开，不改写
    projectId: Id;
    createdAt: string;           // RFC 3339
  }
  ```

### 1.4 未知字段与扩展

- 遇到未知的**必需**字段或能力：只读打开，或拒绝。不得忽略之后写回。
- 可选的 vendor extensions 保留在自己的命名空间；读到不认识的可选扩展时，写回不得丢失它。
- 能力矩阵决定哪些实例类型与效果当前可以编辑。尚未实现的类型不得被静默当成普通图片或空白。
- 视频的 `schemaVersion`（§3.1）是格式版本（架构设计 §13.3 的 `videoSchemaVersion`），当前为 3。新增的对象会改变渲染结果、旧版本的程序读到会画错时（例如把转场画成硬切），版本加一；只增加可以忽略的字段时不加。高于已知版本时拒绝打开，不改写。
- 版本 3 的画面元素采用 v2 的元素模型（§3.4–§3.9、§3.15–§3.17）。按架构设计 §13.4，它不为版本 1–2 的视频保留兼容：读取只接受 3；版本 1–2 的视频拒绝打开并说明版本已不受支持，不改写；它们的内容从原来的旧项目重新导入。这一条就是这次升级的兼容检查（架构设计 §13.3）。

---

## 2. 时间模型

**一句话：用户意图用秒或语义锚点；视觉编辑网格用帧；精确运算用 `MediaTime`；素材按 PTS；音频按采样；导出从输出帧直接求采样时刻。**

同一个位置只有一个可写的权威值。其他单位只是输入形式、显示投影或回执，不得各自修改。

### 2.1 规则总览

| ID | 规则 | 展开 |
| --- | --- | --- |
| TIME-01 | 秒是单位，不等于浮点存储。`MediaTime` 用整数比值；时间域另行绑定 | §2.3、§2.4 |
| TIME-02 | 命令接纳十进制秒字符串或显式的视频帧；词句编辑优先使用稳定的语义锚点 | §2.8 |
| TIME-03 | 一个请求只量化一次；舍入政策明确；回执报告请求值、实际值与偏差；禁止同时写入秒与帧 | §2.6、§2.9 |
| TIME-04 | 音频与原始语音时间不提前量化到视频帧；视觉投影与采样级时长各有权威 | §2.10 |
| TIME-05 | 编辑帧率、素材时间基、代码帧率、输出帧率分别管理；输出帧直接求精确的视频时刻 | §2.11 |
| TIME-06 | 更改 `Sequence.fps` 是带影响报告的视频事务，不是修改导出设置，也不是裸改字段 | §2.12 |
| TIME-07 | 时间类型、量化、映射与取样规则由共享的 Rust 语义实现；只在边界转成宿主数值 | §2.13 |
| TIME-08 | 时间合同独立版本化（`timeContractVersion`）；改变舍入或采样规则必须升级版本，并由 TM01–TM20 验收 | §2.13、验收与测试 §6 |

### 2.2 按层选择单位

不全用帧，也不全用浮点秒。

| 位置 | 表达 | 权威与限制 |
| --- | --- | --- |
| 用户与智能体的命令 | 十进制秒、视频帧、词 / 句 / 对象锚点 | 输入可以多样；归一化之后只有一份视频事实 |
| 视觉片段、视觉关键帧、转场 | 整数帧，绑定 `Sequence.fps`；关键帧也可以写实例长度的百分比（§3.15） | 不能把视频帧当成源帧或代码帧 |
| 源视频取样 | 源 PTS + timebase | 可变帧率不用平均帧率反推真实的展示位置 |
| 转录、词锚、字幕的原始时序 | 精确的源时间 + `timingQuality` | 不提前舍入到视频帧；低精度的证据不能伪装成准确 |
| 音频剪切、混音、淡化 | 采样位置与精确时长 | 不受视频最短一帧的限制 |
| 代码合成与嵌套合成 | 精确的局部时间 | Adapter 根据已验证的能力转成秒、帧或仿真步 |
| 最终导出 | 输出帧索引 + `ExportSettings.fps` | 不改变 `Sequence.fps`，也不改变源内容的速度 |

一个裸的 `frame: 300` 没有完整的含义：30 fps 下它是 10 秒，60 fps 下是 5 秒。必须同时知道所属的时间域与帧率。秒也一样：源的第 10 秒、剪辑后的第 10 秒和动画内部的第 10 秒不能直接比较。

### 2.3 基础类型与唯一权威

```ts
interface Rate { num: number; den: number }               // 正有理数，约分
interface MediaTime { ticks: string; timescale: number }  // ticks / timescale 秒
interface FrameSpan { fromFrame: number; durationFrames: number }
```

**`MediaTime`**。`ticks` 是有符号的十进制整数字符串；`timescale` 是大于 0 的安全整数。同一个数值可以有不同的时间基（1.5 秒可以写成 1500/1000）；比较按有理数的值，不比较 JSON 字符串。用于内容键时统一成约分后的规范值；原媒体的 PTS 与 timebase 原样保存在素材元数据里，以便追溯。

**`Rate`**。`num` 与 `den` 是大于 0 的安全整数，读写都校验上限。视频帧率用精确的 `Rate`，例如 30000/1001。界面可以显示「29.97」，但只有选择明确的帧率预设才映射到 30000/1001；API 收到精确小数 29.97 时不得把它默默当成另一个有理数。导出帧率使用同一个类型。

**运算**。Rust 内部使用检查溢出的整数与有理数运算；超限返回错误，不退化为浮点数。不同分母相乘除之前先约分，并检查中间值。

**`FrameSpan`** 只规定视觉网格对象的位置与长度，不强制音频、词和 Cue 继承整数帧。

- 帧号从 0 开始。`fromFrame` 非负，`durationFrames` 为正；二者及其和都必须在安全整数范围内。
- N 帧的序列，可显示的帧索引是 [0, N)，边界索引是 [0, N]。第 N 个边界是结束点，不是另一张可显示的帧。

**唯一权威**。同一个视觉位置只保存 `fromFrame`，它的秒值由所属 `Sequence.fps` 推导；不另外保存一个可写的 `startSeconds`。`MediaTime` 是值，不自带来源：每个字段由所属的实体或显式的 `TimeDomain` 指定坐标系。位置（Position）、时长（Duration）与偏移（Offset）在 Schema 与类型中区分用途；不能把持续时长当成绝对时刻。

### 2.4 时间域

```ts
type TimeDomain =
  | { kind: 'sequence'; sequenceId: Id }
  | { kind: 'source'; assetRef: VersionRef }
  | { kind: 'composition'; itemId: Id; bundleRef: VersionRef }
  | { kind: 'audio'; assetRef: VersionRef; sampleRate: number };

interface TimePoint { domain: TimeDomain; time: MediaTime }
```

- 序列时间由上下文的视频版本与序列版本固定；源时间由素材版本固定；合成时间还绑定选中的实例、代码包与 timeMap。
- 只有同一个时间域里的点才可以直接相减。跨域必须经过显式的映射；不能仅仅因为 `timescale` 相同就比较或覆盖。
- 所有区间统一为**左闭右开 [start, end)**。
- 视频中的逻辑位置不为负。素材的原始 PTS 可能有负的 origin；导入时保存原始的 origin 与 edit list，并建立归一化的展示时间，不丢弃原始信息。
- 相对移动量可以为负，但要先算出目标再验证范围。内部的 handles 与预滚时刻不代表允许保存负的视觉片段位置。

### 2.5 映射与非整数帧求值

每个实例只保存一个 `timeMap`，不同时保留可能相互矛盾的 in / out / speed / duration 四套事实。

```ts
type TimeMap =
  | { kind: 'linear'; sourceIn: MediaTime; rate: Rate }
  | { kind: 'hold'; sourceAt: MediaTime };
```

给定任意精确的视频时刻 t（不要求落在整数帧上）：

```text
itemStart  = item.fromFrame × sequence.fps.den / sequence.fps.num
localTime  = t − itemStart
sourceTime = sourceIn + localTime × rate.num / rate.den
```

这是有理数的运算关系，不是要求用 JS number 逐步计算。视觉帧在网格上的求值只是它的特例：t = sequenceFrame × fps.den / fps.num。关键帧之间按精确的局部时刻插值（§3.15）。

- `sourceOut` 是由映射与播放时长推导的结果，不是另一份可以独立编辑的数据。
- 首版的 `linear` 只支持正速率；`hold` 默认不重复播放音频。
- 倒放与变速曲线在实现之前一律拒绝；不能把未知的映射当成 1 倍速。
- 嵌套序列逐层传递精确时间，不在每一层入口吸附一次帧网格。只有实际由帧驱动的源或 Adapter 边界，才按其声明的采样策略取离散样本。

**例**。30 fps 的视频，视觉片段 `fromFrame=90`、`durationFrames=60`、`sourceIn`=2 秒、`rate`=3/2。视频播放区间是 [3, 5) 秒，源区间是 [2, 5) 秒。视频时刻 4 秒（第 120 帧）映射到源 3.5 秒。导出在 4 + 1/60 秒采样时也直接计算，不先取整回第 120 帧。

### 2.6 量化、区间与可变帧率取样

**编辑量化**决定用户请求的秒如何落在视觉编辑网格上。**媒体取样**决定某个精确的源时刻使用哪一张真实的源图像。二者不同：不能在选到最近的源样本之后，偷偷修改已提交的切点。

```ts
type FrameAlignment = 'exact-frame' | 'nearest-frame' | 'floor-frame' | 'ceil-frame';
```

| 政策 | 规则 | 适用 |
| --- | --- | --- |
| `exact-frame` | 必须恰好落在目标网格上，否则拒绝 | 精确位置或严格的脚本 |
| `nearest-frame` | 取最近的边界；恰好居中时取**较早**的边界 | 普通视觉移动的默认值 |
| `floor-frame` | 取不晚于请求的边界 | 显式要求向前对齐 |
| `ceil-frame` | 取不早于请求的边界 | 显式要求向后对齐 |

规则：

- 对齐政策由命令规定，不存在全局默认的「四舍五入」。
- 口播删除先根据可信的词锚与声学边界生成安全的候选，再量化，并校验不会吞掉相邻的词。
- 区间操作显式声明边界政策。公共的拼接边界只量化一次；不得分别取整每一段的长度再累加，也不得默认扩大删除范围。
- 量化导致零长度或超出范围时拒绝，不自动补一帧。
- 相对移动：先由当前的权威位置加上精确的偏移得到绝对目标，再量化。不能先把每个增量舍入再累计。
- 一次事务产生最终的 `FrameSpan` 与量化回执。下游不得把显示用的秒值再转一次帧。

**可变帧率**。素材按 PTS 索引和真实的展示区间 [pts_i, pts_next) 取帧。最后一个样本的终点来自明确的样本时长或素材终点，不假定一定有下一条 PTS。遇到 gap、重叠或 discontinuity，由导入与采样合同显式处理。不能用 DTS、平均帧率或最近的关键帧代替正确的展示样本。精确的非关键帧编辑需要解码与重编码，或者明确拒绝快速路径；不悄悄移动视频的切点。

### 2.7 拆分、裁切与运动相位

- 视觉拆分点满足 0 < `splitLocalFrame` < `durationFrames`。右片段的 `sourceIn` 由旧的 timeMap 在精确的拆分时刻求值，不从格式化之后的秒字符串重建。
- 音频拆分按音频的采样与时间合同，不套用视频的整数帧限制。
- 裁切要明确是 trim、slip、ripple 还是 rateStretch。
- 移动保留局部动画。左裁切与拆分保留原相位和真实的子曲线，不重新启动同一条 easing。
- rateStretch 必须显式选择是否缩放关键帧、音频、字幕和语义锚，并返回依赖影响。「延长外壳」不等于「放慢内容」。

### 2.8 时间输入：秒优先，帧可选，锚点更优先

```ts
type TimelineTimeInput =
  | { unit: 'seconds'; value: string }
  | { unit: 'frames'; value: number };

interface MoveItemInput {
  itemId: Id;
  sequenceId: Id;
  at: TimelineTimeInput;
  alignment: FrameAlignment;
}
```

- `frames` 只表示命令所属序列的视频帧；不接受裸的源帧或代码帧。其他时间域使用各自的 Schema 与 `VersionRef`。
- `seconds` 是十进制字符串，精确解析。不接受 NaN、Infinity、科学计数法，也不接受直接用 JS number 冒充精确输入。界面可以用浮点数交互，但提交时调用共享的格式化与解析合同。
- 绝对位置 `at` 非负；相对偏移使用独立的字段，允许负值。
- 显示的小数位数不改变已保存的精度。
- 「晚两秒」不要求智能体计算帧号。「跟着这句话」优先发送句、词或 occurrence 的锚点，由引擎解析当前的视频关系。禁止按逐词的数目平均分配出伪精确的时间。

```json
{
  "type": "moveItem",
  "itemId": "scene-2",
  "sequenceId": "main",
  "at": { "unit": "seconds", "value": "12.5" },
  "alignment": "nearest-frame"
}
```

在 30 fps 的 `main` 序列中，上例归一化为 `fromFrame=375`。用户直接传 `frames=375` 的结果相同。命令不会同时写入 `startSeconds=12.5` 与 `startFrame=375`。

### 2.9 量化回执

```ts
interface TimeQuantizationReceipt {
  domain: { kind: 'sequence'; sequenceId: Id };
  sequenceRevision: Revision;
  editFps: Rate;
  requested: TimelineTimeInput;
  requestedTime: MediaTime;
  actualFrame: number;
  actualTime: MediaTime;
  delta: MediaTime;             // actual − requested，可以为负
  policy: FrameAlignment;
}
```

**例**。在 30000/1001 fps 的视频中请求 10.000 秒，`nearest-frame` 得到第 300 帧；实际时间是 1001/100 秒，即 10.010 秒；偏差是 +1/100 秒，即 +10 毫秒。这是帧网格的量化，不是数值计算的误差。对同一请求使用 `exact-frame` 则返回 `TIME_NOT_ON_FRAME_GRID`，并给出最近的合法边界，不自动提交。

- 同一个意图用同一个 `commandId` 重试，返回原回执；同一个 key 换了 payload 则拒绝。
- 界面可以同时显示请求值与实际落点。之后的读取必须使用 `actualFrame` 或权威的时间，不从格式化的文本反推。

### 2.10 音频、转录与字幕保留子帧精度

48 kHz 下，10 毫秒的淡化是 480 个采样；30 fps 的一帧是 1600 个采样。音频的最短时长、采样点与淡化不受视觉最短一帧的约束。

**音频实例**

- 精确的开始位置表示为 `fromFrame` + `subframeOffset`。前者是所属序列上的粗网格位置；后者是 `MediaTime`，范围是 [0, 一帧时长)。
- 播放长度由显式的 `playDuration: MediaTime` 表示。整数的 `durationFrames` 不是采样级长度的权威。
- 界面上音频条的帧宽只是派生的投影。
- 纯音频片段不需要人为补足一帧。纯音频导出以明确的精确音频范围为准，不继承序列视觉尾端的补帧。视频内嵌音频的路由与视觉边界，另按联动合同约束。
- `actualSamples` / `sampleRate` 表示生成音频的真实源长度；`playDuration` 表示这个实例在视频中经过裁切与变速之后的播放长度。二者经 timeMap 关联，不是可以任意并行修改的两份数据。
- 更改编辑帧率时，保留精确的音频开始与长度，再重建「粗帧 + 余数」的表示。

**语音与字幕**

- `SpeechWord.sourceSpan`、对齐结果和源字幕时序使用精确的源时间与 `timingQuality`。
- 字幕的可见性按精确的投影区间在输出时刻上求值。在界面的帧网格上拖动字幕可以产生显式的 override，但不回写原始的词时间。
- 目标语言的字幕如果依据新配音，使用实际的目标采样与对齐结果。
- 改变输出帧率不重新识别、翻译或购买语音合成。
- 时间输入在数值上精确，不等于证据准确：`estimated` / `provider` / `aligned` / `missing` 的质量标记始终保留。
- 十进制浮点秒与整数刻度的互换（旧项目导入的微秒、字幕与翻译核心的 `TranscriptDoc`，§5.2）只用一条规则。刻度 → 秒：`ticks / timescale` 的最近 f64（两数都不超过 2^53 − 1，是真实商的正确舍入）。秒 → 刻度：取这个 f64 的最短十进制写法（能读回同一个数的最少位数），精确乘以 `timescale`，取最近的整数，正好一半时远离零；非有限数与超出安全整数的结果报错。这条规则不同于 §2.13 的 pts 取整（一半取偶）与编辑吸附，只用于这两处边界。由此 |ticks| < 2^51 时刻度 → 秒 → 刻度回到原值；秒 → 刻度 → 秒在十进制值乘以 `timescale` 为整数时回到原值，否则偏差不超过半个刻度，写回的一方报告发生取整的个数与最大偏差。

**外部字幕格式**。导出 SRT、VTT 等格式时，才按该格式允许的精度和固定的端点规则转换，并报告发生的量化或重叠修复；不修改视频里的原始时间。两个相邻 Cue 共用的边界统一转换，防止分别舍入造成缝隙。

### 2.11 编辑帧率与输出帧率严格分离

```ts
interface ExportSettings {
  fps: Rate;                                   // 输出采样网格，不是 Sequence.fps
  frameCountPolicy: 'exact-grid' | 'cover-range';
  // 分辨率、编码、音频等字段见导出合同
}
```

输出帧率默认继承根序列的 `Sequence.fps`，但保存进冻结的导出快照之后独立存在。30 fps 的视频里一个 300 帧的片段是 10 秒；以 60 fps 导出得到 600 个输出帧，视频仍然是 30 fps / 300 帧，声音不变速。

```text
t0 = 导出范围的精确起点
D  = 导出范围的精确时长
N  = 按 frameCountPolicy 计算 D × outputFps
outputTime(n)   = n × outputFps.den / outputFps.num
sequenceTime(n) = t0 + outputTime(n),   0 ≤ n < N
contentTime(n)  = mapToContentTime(sequenceTime(n))
```

输出帧直接取精确的视频时刻，再映射到各层。不得先 floor 或 round 到视频帧之后再插值连续的原生动画。30 → 60 fps 时，可以连续求值的原生曲线应在半个视频帧处求值；源视频与帧驱动的代码则按已验证的策略重复或选择其离散帧。仅仅提高导出帧率不会创造出真实的源运动。

**帧数政策**

| 政策 | 规则 |
| --- | --- |
| `exact-grid` | 要求 D × outputFps 是整数，否则返回 `EXPORT_RANGE_NOT_ON_OUTPUT_GRID` |
| `cover-range` | N 取上整。最后一个输出帧的起点仍然小于逻辑终点，但在恒定帧率的容器里，视觉的展示尾端可能延长不到一个输出帧 |

使用 `cover-range` 时，预检与交付记录必须说明 `requestedDuration`、`frameCount`、`encodedVideoDuration` 与 `audioDuration`。逻辑音频区间不会为了强行对齐尾端而加速或截词。输出合同另外要求等长时，只能在显式授权下用静音安全补齐，或者拒绝；不改动已有的讲话内容。

**例**。精确的 10 秒以 30000/1001 fps 导出：`cover-range` 得到 300 帧，画面展示时长 10.010 秒，音频仍然可以是 10 秒；`exact-grid` 则拒绝。末帧的展示延长不是向源码请求越界的帧，也不授权修改主视频的时长。

交互场景默认使用可见的 `cover-range`；严格的机器任务可以指定 `exact-grid`。不得暗中切换政策。

### 2.12 修改 `Sequence.fps` 是显式的视频事务

改变导出帧率不修改视频。改变编辑帧率必须使用 `changeSequenceFrameRate`，带上 `expectedRevision`、新旧 `Rate`、`preserve` 策略、对齐政策、影响范围、锁定处理和必要的确认。禁止直接 `setProperty(fps)` 之后让所有的帧号换一种含义。

| `preserve` | 语义 | 必须处理 |
| --- | --- | --- |
| `time`（默认） | 保留真实时间；帧坐标重采样到新的编辑网格 | 报告量化偏差、零长度、转场、关键帧、锚点与嵌套的影响 |
| `frames`（显式的高级操作） | 保留视觉帧计数；真实时长按新网格变化 | 必须联动规划 timeMap、音频与字幕；没有实现完整 retime 时拒绝 |

- P0 可以只实现 `preserve=time`。`preserve=frames` 必须受能力门控制，不以裸改 fps 作为退化实现。
- 30 → 60 fps、`preserve=time`：视觉的 `fromFrame` 与 `durationFrames` 在整数比的情况下乘 2；音频的绝对采样时刻不变。
- 30 → 25 等非整数比：公共边界统一量化，可能影响最短的片段与锁定范围。事务必须先给出差异报告；无法满足硬约束时拒绝。
- 原生视觉关键帧先从旧网格求出精确时间，再转换到新网格，并保留原曲线的语义。量化使关键点合并或无法保持形状时，必须报告或拒绝；不承诺任意改帧率都无损。
- 精确的音频、语音证据和源素材的帧率不被改写。
- `CodeBundle.intrinsic.fps` 是不可变的作者合同，不随视频设置原地修改。
- 嵌套序列的 fps 默认不递归更改；调用者显式选择目标序列的集合。
- 导出中的旧快照继续使用原来的全部 `Rate`。

### 2.13 边界数值、宿主转换与缓存

精确时间只在浏览器 draw、媒体 API、编码器这些要求原生数值的边界上，才转换成浮点秒、微秒或整数采样。

用输出帧率生成编码时间戳时使用绝对索引：

```text
pts(n)      = round(n × outputFps.den / outputFps.num × 1_000_000)
duration(n) = pts(n+1) − pts(n)
```

- 这里 `round` 的 tie 规则是 **nearest-ties-to-even**，并固定在 `timeContractVersion` 里。它与编辑吸附的 `nearest-frame`（取较早边界）是两个不同接口的规则，不可混用。
- 每帧的 duration 可以相差 1 微秒。不得把舍入之后的单帧 duration 重复累加。
- 音频的采样边界同样从绝对的有理时刻求出；实际的采样量化偏差写入结果合同。

**共享实现**。Rust 与 WASM 导出同一套 `parseDecimalSeconds`、`compareTime`、`mapTime`、`quantizeFrame`、`timestampAt`、`sampleAt` 语义。JS 不另外手写一套 `Math.round` 转换。JS number 只能承载经过范围检查的宿主近似值，不用作精确的 ID、hash 或数据库去重值。

**缓存**。缓存键必须区分编辑帧率、输出帧率、代码包与素材的时间基、采样策略、实际的局部采样点和帧数政策。参数、依赖与实际局部时刻完全一致的源码样本可以复用；不同输出帧率的编码产物不是同一个产物。对 1500/1000 与 3/2 这样等价的时间，缓存使用规范的有理值；原始 PTS 的来源字段另行保留。

### 2.14 硬不变量

1. 视觉的 `FrameSpan`、精确的音频时长、语音的源时序，各有唯一的权威。
2. 单位转换、编辑量化、源取样三者分别可追踪。
3. 导出帧率不改变视频时间，也不改变声音速度。
4. 可以连续求值的对象不在中间层多次吸附。
5. 可变帧率不伪造平均帧号。
6. 代码包的帧率不等于主时间线的帧率。
7. 回执反映实际落点，而不是只回显请求。

本规范不包含完整的变速曲线、倒放、光流补帧，以及任意保留帧数的 retime。它们是否开放由能力门与测试决定。

---

## 3. 视频

### 3.1 VideoSnapshot

```ts
interface VideoSnapshot {
  format: 'baocut.video';
  schemaVersion: 3;                   // §1.4
  timeContractVersion: number;
  id: Id;
  name: string;
  revision: Revision;
  rootSequenceId: Id;

  sequences: Record<Id, Sequence>;
  assets: Record<Id, AssetRecord>;            // 文件与目录：媒体、字体、代码包（§4.1–§4.3）
  documents: Record<Id, DocumentRecord>;      // 文稿类内容的文档头（§4.4）；正文不在快照里

  fonts: Record<Id, FontRecord>;
  localizationSets: Record<Id, LocalizationSet>;
  canvasVariants: Record<Id, CanvasVariant>;
  syncGroups: Record<Id, SyncGroup>;

  protections: Record<Id, ProtectionRecord>;
  checkpoints: Record<Id, Checkpoint>;
  links: DependencyLink[];
}
```

`VideoSnapshot` 是权威状态的可交换快照。工作态由 VideoStore 持有；快照不是第二个写入端。视频名称 `name` 去掉首尾空白后必须为 1–200 个 Unicode 标量值（不按 UTF-8 字节数或 UTF-16 编码单元计数）；创建、改名和便携包导入使用同一限制。

视频的内容只有两张表：

- **素材**是 bytes：一个文件或一个目录。代码包不另设一张表，它是 `kind: 'bundle'` 的素材（§4.3）。
- **文档**是结构化的文稿：转写、译文、字幕、字幕样式、剪辑提案、配音计划、声音事件表等。它们共用一张表，用开放的 `kind` 区分（§4.4、§4.6）。增加一种文稿不需要升级视频格式。

### 3.2 Sequence

```ts
interface Sequence {
  id: Id;
  revision: Revision;
  name: string;
  fps: Rate;                         // 编辑网格。输出帧率见 ExportSettings.fps
  canvas: {
    width: number;
    height: number;
    workingSpace: 'linear-rec709';
    background: string;              // 画布底色，'#RRGGBB'，缺省 '#000000'
  };
  durationPolicy: { kind: 'derived' } | { kind: 'fixed'; frames: number };
  tracks: Track[];
  items: SequenceItem[];                // §3.4
  animationBindings: AnimationBinding[];
  transitions: Transition[];         // §3.9，按 ID 排序
  markers: Marker[];                 // §3.13，按帧排序，同帧按 ID
  ducking: DuckingRule[];            // 闪避规则（§3.9），按 ID 排序
  template?: TemplateLayers;         // 模板层（§3.17）；没有时省略
}
```

- `derived`：先求所有可计时对象的精确终点，再向上投影为序列的整数帧长度。音频可能有子帧的尾端；它的真实长度不被这个视觉边界反向覆盖。
- `fixed`：允许片尾留白；超出终点的内容必须显式裁切或延长序列。
- 恒定帧率输出的尾帧政策见 §2.11；不能为了编码方便而偷偷修改视频时长。
- 画布的宽与高必须是正整数。编码对尺寸的约束在导出校验中处理。
- `canvas.background` 是纯色，不透明，铺满画布，画在所有轨道下面；画面没有盖满画布的地方露出它。读入时大小写不限，写出一律大写。实例自己的留边底色是 `bg`（§3.5），不是画布背景。

### 3.3 Track

```ts
interface Track {
  id: Id;
  order: number;
  kind: 'visual' | 'audio' | 'subtitle';
  name?: string;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  solo: { enabled: boolean; group: 'audio' | 'visual' };
}
```

- `order` 越大，越靠后合成（画面上越靠上）。视觉轨道与字幕轨道在同一叠里按 `order` 统一排序，字幕不自动在最上，画面轨道挪到字幕轨道之上就盖住字幕；音频轨道的 `order` 只排声音轨道之间的次序。画面的叠放次序就是轨道的上下：用户在画布上「前移一层 / 后移一层 / 移到最前 / 移到最后」改的是实例所在的轨道（命令协议规范 §4.2 `arrangeItem`：共用轨道的实例拆到相邻新建的轨道上，独占轨道的实例整条轨道挪位），在时间线上拖动轨道换的是 `order`（`moveTrack`）。`order` 在序列内唯一，可以有空洞；删轨道不重排。
- 同一轨道内的实例在时间上不重叠（§3.4），`paintOrder` 由引擎在写入时取轨道内最大值加一，只用来给边界恰好相接或由旧数据带来的重叠排一个确定的先后；没有操作直接改它，禁止依赖数据库的返回顺序。
- 锁定阻止修改，不等于隐藏。
- 静音不等于删除源音频。
- Solo 必须声明作用于音频组还是视觉组。

### 3.4 实例（Item）

实例是素材或文档在序列上的一次使用。画面元素的种类与参数采用 v2 的元素模型：种类与 `crates/timeline` 的 `ElementKind` 一一对应，参数的字段名、取值与范围以它为准；实例的身份、所在的轨道与时间是 v3 的容器（§2、§3.2、§3.3）。

```ts
type ItemType =
  | 'text' | 'image' | 'video' | 'audio' | 'shape' | 'sticker'
  | 'visualizer' | 'progress' | 'draw' | 'placeholder' | 'confetti' | 'whiteboard'   // v2 的元素种类
  | 'composition' | 'caption';                                                       // 代码合成、字幕

// 所有实例共用的字段
interface ItemBase {
  id: Id;
  type: ItemType;
  trackId: Id;
  name?: string;
  enabled: boolean;                    // 停用的实例不出画面也不出声
  locked: boolean;
  paintOrder: number;
  followPolicy: FollowPolicy;          // §3.16
  lineage?: ItemLineage;               // 拆分、裁切后的来源关系
  linkGroupId?: Id;                    // 音画联动组
  role?: string;                       // 实例在视频里的作用，见下
  ai?: JsonValue;                      // 生成来源的说明；引擎不解释，原样保留
  untilSequenceEnd?: true;             // 终点跟着序列末尾（§3.16）；不是时省略
  extensions?: Record<string, JsonValue>;   // 命名空间下的扩展（§1.4）
}

interface ItemLineage {
  originItemId: Id;                    // 最初的实例
  parentItemId?: Id;                   // 直接来源
  viaTransactionId: Id;
}

// 画面实例：位置与长度在帧网格上
interface VisualItemBase extends ItemBase {
  span: FrameSpan;
  place: Place;                        // 几何（§3.5）
  animate?: Animation;                 // 元素动画的三槽（§3.15）
}

// 视觉媒体的公共字段：视频、图片、占位框、白板、素材贴纸
interface MediaFields {
  mode?: 'fullscreen' | 'pip';         // §3.5，缺省 'pip'
  fit?: 'cover' | 'contain';           // §3.5，缺省 'cover'
  bg?: Background;                     // §3.5，缺省 'black'
  mask?: Mask;                         // §3.9
  fx?: Fx;                             // §3.9
}

interface VideoItem extends VisualItemBase, MediaFields {
  type: 'video';
  assetRef: VersionRef;
  timeMap: TimeMap;
  crop?: Crop;                         // §3.5
  embeddedAudio: EmbeddedAudio;        // 内嵌音频的路由（§3.9）
}

interface ImageItem extends VisualItemBase, MediaFields {
  type: 'image';
  assetRef: VersionRef;
  crop?: Crop;
  tile?: Tile;                         // §3.5
  source?: 'file' | 'html';            // 图片的编辑来源；渲染只用 assetRef
  html?: string;                       // source 为 'html' 时保留的原始片段
}

// 音频实例：采样级的位置与长度（§2.10）
interface AudioItem extends ItemBase {
  type: 'audio';
  assetRef: VersionRef;
  fromFrame: number;
  subframeOffset: MediaTime;           // [0, 一帧时长)
  playDuration: MediaTime;
  timeMap: TimeMap;
  mix: AudioMix;                       // §3.9
}

type SequenceItem =
  | VideoItem | ImageItem | AudioItem
  | TextItem | ShapeItem                                     // §3.6
  | StickerItem | VisualizerItem | ProgressItem | DrawItem
  | PlaceholderItem | ConfettiItem | WhiteboardItem          // §3.7
  | CompositionItem                                          // §3.7
  | CaptionItem;                                             // §3.8
```

| 类型 | 轨道 | 内容 | 编辑语义 |
| --- | --- | --- | --- |
| `video` | 视觉 | 素材版本、timeMap、几何、内嵌音频的路由 | 裁切、移动、拆分、恒定速率、音画关联 |
| `image` | 视觉 | 素材版本、几何、展示长度 | 移动、缩放、旋转、平铺 |
| `audio` | 音频 | 素材版本、timeMap、`fromFrame` + `subframeOffset`、`playDuration`、混音 | 采样级的裁切与长度、音量、淡化、包络；条形的帧宽只是投影 |
| `text` | 视觉 | 一段文字或计时读数，加文字样式（§3.6） | 改字、样式 |
| `shape` | 视觉 | 形状目录里的一款，加填充、描边与端点（§3.6） | 基础图形 |
| `sticker`、`visualizer`、`progress`、`draw`、`placeholder`、`confetti`、`whiteboard` | 视觉 | 贴纸、声波、进度条、手绘笔迹、占位框、彩纸、白板手绘（§3.7） | 参数编辑；占位框可以换成媒体 |
| `composition` | 视觉 | 由代码包按局部时间画出来的画面，加参数（§3.7） | 实例编辑、参数编辑、源码换版 |
| `caption` | 字幕 | 一份字幕文档在一段序列时间里的显示（§3.8） | 内容、语言、断句、样式分层编辑 |

- **种类封闭**。认不出的 `type` 按 §1.4 处理，不得当成空白画过去。
- **字段的适用范围**，不适用的字段写入时拒绝：
  - `place`、`animate`：全部画面实例；音频实例与字幕实例没有。音频实例也不能有 `animate`。
  - `mode`、`fit`、`bg`：视频、图片、占位框、白板，以及 `sticker.source` 为 `'asset'` 的贴纸（下称视觉媒体）。`mask`、`fx` 用于视觉媒体与合成实例。
  - `tile`：文字与图片。
  - `crop`：视频与图片。
  - `source`、`html`：只用于图片；有 `html` 时 `source` 必须是 `'html'`。
- **`role`** 说明实例的作用，供界面分组与智能体理解，不改变渲染。词表开放，读到不认识的取值照常保留。其中五个值写入时校验与种类的搭配：`broll`（图片、视频）、`watermark`（文字、图片、视频、贴纸）、`screentext`（文字）、`overlay` 与 `frame`（图片、视频、贴纸）。其余常用的取值：`a-roll`、`narration`、`dub`、`music`、`sfx`；字幕实例用 `source`、`translation`。
- **`extensions`** 的键是命名空间（例如 `baocut.import`）。引擎不解释其中的内容，写回时原样保留。画面元素的参数一律写正式字段，不放进这里（架构设计 §13.4）；这里只放说明来源的数据，例如导入时的原始 ID。
- **时间**。画面实例的 `span` 在序列的帧网格上。以秒给出的时刻（v2 的元素时间、命令里的秒）按最短的十进制写法读成精确有理数，取最近的帧，等距时取较早的（§2.6），长度至少 1 帧，并给出量化回执（§2.9）。音频实例的位置与长度按 §2.10，不量化。挂在词上的起止写成 `followPolicy` 的 `speech-anchor`，不设终点写成 `untilSequenceEnd`（§3.16）；这两种实例的 `span` 由引擎按当前的时间线求出，同样量化到帧。
- 同一条轨道上的实例在时间上不重叠，需要叠在一起的画面放在不同的轨道上。导入与编辑器写入遇到重叠时，把后来的实例放到相邻的轨道上（没有空位就新建一条），不改它的时间。
- 嵌套序列（`nested-sequence`）与调整层（`adjustment`）不在当前的类型集合里，等有了真实的需求再加入。

字段来源：`crates/timeline/src/schema.rs` 的 `Element`、`ElementKind`、`ElementRole` 与 `Element::validate`。

### 3.5 视觉坐标

画面实例的几何按画幅的百分比保存：换画幅时元素按比例重排，不跟着像素走。

```ts
interface Place {
  x?: number;                          // 框中心的横坐标，画布宽的百分比，左边为 0；缺省 50
  y?: number;                          // 框中心的纵坐标，画布高的百分比，上边为 0；缺省按种类，见下
  w?: number;                          // 框宽，宽度基准的百分比；缺省按种类，见下
  scale?: number;                      // 整体倍率，缺省 1
  scaleY?: number;                     // 纵向再乘的倍率，缺省 1
  rot?: number;                        // 度，绕框中心顺时针，缺省 0
  opacity?: number;                    // [0, 1]，缺省 1
  radius?: number;                     // 四角相同的圆角，540 短边下的像素，≥ 0，缺省 0
  cornerRadii?: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };   // 四角各自的圆角，单位同 radius，≥ 0
  flipX?: boolean; flipY?: boolean;    // 内容在框里镜像；为 false 时省略
}

type Background = 'blur' | 'black' | string;   // string 是 '#RRGGBB'

interface Tile {
  on: true;                            // 不平铺时整个 tile 省略，不写 on: false
  angle?: number;                      // 整片网格的旋转，度，顺时针为正；缺省 -30
  gapX?: number;                       // 横向间距，画布宽的百分比，缺省 8，小于 2 按 2
  gapY?: number;                       // 纵向间距，画布高的百分比，缺省 10，小于 2 按 2
  stagger?: boolean;                   // 奇数行错开半格，缺省 true
}

interface Crop { left: number; top: number; right: number; bottom: number }   // 四边各裁掉的比例
```

- 数值都必须是有限数。`x`、`y` 可以落在画布之外。
- **框的宽**是 `宽度基准 × w% × scale`。宽度基准一般是画布宽；像素正方的种类量的是画布短边：没有显式高度的声波、进度条、手绘与占位框。
- **框的高**是种类决定的自然高再乘 `scaleY`。自然高：图形有 `shape.h` 时是画布高 × `h`% × `scale`，没有时等于框宽；模板贴纸 `box` 是框宽 × 0.62，其余贴纸等于框宽；声波、进度条、手绘、占位框、彩纸按缺省落位给出的高（横条、铺满或正方）；视觉媒体由素材的显示宽高比推出；文字由排版决定。
- **缺省落位**（`x` 都是 50）：文字、图形、贴纸 `w` 20、`y` 50；视频与图片 `w` 34；声波横条 `w` 100、高 20%、`y` 85，正方款 `w` 30；进度条横条 `w` 80、高 5%，正方款 `w` 30，边框款 100 × 100；手绘与彩纸 100 × 100；占位框 42 × 24。新建实例按它写入 `place`，「恢复默认」也用它。
- **视觉媒体**。`mode: 'fullscreen'` 时框就是整张画布，`x`、`y`、`w` 不参与；`'pip'` 时按上面的规则。`fit` 决定素材怎样放进框：`cover` 铺满并裁掉多余的部分，`contain` 完整放进框里。`bg` 只在 `fullscreen` 加 `contain` 时起作用，铺满整张画布、画在素材下面：`black` 是黑色，`'#RRGGBB'` 是这种颜色，`blur` 是同一画面放大模糊；读入时颜色大小写不限，写出一律大写。
- **圆角**。`radius` 与 `cornerRadii` 的单位是画布短边为 540 时的像素，渲染时乘 `短边 / 540`；两者都有时 `cornerRadii` 优先。圆角只裁视觉媒体，且只在 `pip` 或平铺时生效。图形自己的圆角在 `shape.cornerRadius`（§3.6），与这里的裁切是两件事。
- **平铺**。实例的画面按网格重复铺满画布：网格以画布中心为原点，排好点位后整体旋转 `angle`；横向步长是单格宽加 `gapX`% 的画布宽，纵向同理。点位由 `timeline::geometry::tile_stamp_points` 给出，预览与导出共用。
- 文字的纵向钉点是 `TextItem.verticalAlign`（§3.6），不在 `place` 里。
- **裁剪**（`crop`）从源的显示画面（已按旋转元数据摆正）四边各裁掉一个比例：每边在 [0, 1)，左右之和、上下之和都小于 1。四边都是 0 等于没有裁剪，不保存。裁剪在 `fit` 之前：留下的区域当作源画面，它的宽高比参与框的高与 `fit`。
- 选中框、命中框与露底检查读静态的 `place`；关键帧与元素动画叠在它上面（§3.15）。

字段来源：`schema.rs` 的 `Place`、`CornerRadii`、`VisualMode`、`Fit`、`Background`、`Tile`；`geometry.rs` 的 `default_place`、`width_basis`、`static_box`、`media_box`、`tile_stamp_points`。

### 3.6 文字与图形

```ts
interface TextItem extends VisualItemBase {
  type: 'text';
  text?: string;                       // 与 counter 二选一，必须有其一
  counter?: CounterProps;              // 计时读数（§3.7）
  style?: TextStyle;                   // 文字样式，见下
  stylePresetId?: string;              // 样式取自的样式库条目或文字预设
  verticalAlign?: 'top' | 'center' | 'bottom';   // place.y 钉住文字块的哪一处，缺省 'center'
  tile?: Tile;                         // §3.5
}

type TextStyle = Record<string, JsonValue>;

interface ShapeItem extends VisualItemBase {
  type: 'shape';
  shape: ShapeProps;
}

interface ShapeProps {
  shape: string;                       // 形状目录里的一款，非空
  fill?: string;                       // '#RRGGBB' 或 '#RRGGBBAA'
  stroke?: string;                     // 同上
  strokeWidth?: number;                // ≥ 0，540 短边下的像素，缺省 2
  cornerRadius?: [number, number, number, number];   // 左上、右上、右下、左下，≥ 0，单位同 strokeWidth，缺省全 0
  h?: number;                          // 框的自然高，画布高的百分比；省略时框是正方
  x1?: number; y1?: number; x2?: number; y2?: number;   // 线与箭头的端点，框内的百分比，缺省 (0, 50) → (100, 50)
  head?: 'arrow' | 'none';             // 箭头的头
}
```

- **文字样式**。`style` 是 v2 的文字样式对象，没有 `schema` 包装。它的键与取值由渲染核心的文字样式类型定义，随渲染核心移植后写进本节（§9）；文字预设数据里用到的键有 `fontFamily`、`fontSize`、`fontWeight`、`fontStyle`、`italic`、`underline`、`fontColor`、`lineHeight`、`letterSpacing`、`textAlign`、`textTransform`、`backgroundColor`、`backgroundPadding`、`backgroundStyle`、`borderRadius`、`textOutline`、`dropShadow`。在那之前引擎按对象保存、不解释；渲染器认不出的键要报告，不得悄悄跳过。
- 文字的描边、阴影与底色在 `style` 里，`fx` 与 `mask` 不用于文字。
- `stylePresetId` 只记样式的来源，渲染只读 `style`；它指向的条目不存在时不影响渲染。
- 文字用到的字体按 §3.14 引用：`style.fontFamily` 按族名在视频的字体记录里解析，解析不到时按缺字体处理。
- `text` 与 `counter` 互斥，必须有其一。计时读数见 §3.7。
- **图形**。`shape` 是预设注册表形状目录里的 id（首批 `rect`、`ellipse`、`line`、`arrow`，其余是目录里的轮廓）。写入只要求非空；目录里没有这个名字时渲染报 `preset-unknown`，这个实例画不出来，不得画成空白。这一款不用的参数（例如线没有填充）不读。端点与 `head` 只对 `line`、`arrow` 有意义。
- `strokeWidth` 与 `cornerRadius` 渲染时乘 `短边 / 540`，再夹到框的半边长以内。`shape.cornerRadius` 是图形自己的轮廓，不与 `place` 的圆角裁切（§3.5）合并。
- 旧版的 `baocut.legacy-text-style/0` 与 `baocut.legacy-shape/0` 两种形态已取消，从 v2 导入的文字与图形直接写本节的字段。

字段来源：`schema.rs` 的 `Element`（`text`、`style`、`stylePresetId`、`verticalAlign`）、`ShapeProps`、`SHAPE_STROKE_WIDTH_DEFAULT`；单位见 v2 `bcut-timeline-render/src/draw.rs`。

### 3.7 生成类元素与代码合成

生成类元素的画面由渲染核心按实例的局部时间算出来。参数对象与种类同名、一一对应：带了别的种类的参数对象，或缺了自己的，写入时拒绝（`element-props-mismatch`）。

```ts
interface CounterProps {               // TextItem.counter
  mode: 'countdown' | 'countup';
  format?: 's' | 'mm:ss' | 'hh:mm:ss';   // 缺省 's'
}

interface StickerItem extends VisualItemBase, MediaFields {   // MediaFields 只用于素材贴纸
  type: 'sticker';
  assetRef?: VersionRef;               // 素材贴纸必有：图片、视频或 Lottie 素材（§4.1）
  sticker: StickerProps;
}
interface StickerProps {
  source: 'template' | 'asset';
  templateId?: string;                 // 模板贴纸：贴纸目录里的一款
  path?: string;                       // v2 的字段，原样保留，渲染不读
  loop?: 'loop' | 'once' | 'hold';     // 动态素材的取帧方式，缺省 'loop'
  fillOverrides?: Record<string, string>;   // 原色 → 目标色，键与值都是颜色
}

interface VisualizerItem extends VisualItemBase {
  type: 'visualizer';
  visualizer: VisualizerProps;
}
interface VisualizerProps {
  style: string;                       // 声波目录里的一款
  mainColor?: string; secondaryColor?: string;   // 缺省取这一款的配色
  fftSize?: 256 | 512 | 1024 | 2048;   // 缺省 1024
  minDb?: number; maxDb?: number;      // dB，缺省取这一款的值；minDb < maxDb（没写的一端按 -80、40 比较）
  smoothing?: number;                  // [0, 1)，缺省 0.8
  gain?: number;                       // ≥ 0，缺省 1
  audio?: string;                      // 'project'（缺省，这条序列混好的声音）或一个音频、视频素材的 ID
  speaker?: string;                    // 只在这位说话人说话时动，非空
  alwaysShow?: boolean;                // 没有声音或说话人不在时仍画静止的样子，缺省 true；false 时静了 0.5 秒就不画
}

interface ProgressItem extends VisualItemBase {
  type: 'progress';
  progress: ProgressProps;
}
interface ProgressProps {
  style: string;                       // 进度条目录里的一款
  mainColor?: string; secondaryColor?: string;
  startProgress?: number;              // [0, 1]，缺省 0
  endProgress?: number;                // [0, 1]，缺省 1；可以小于 startProgress（倒走）
}

interface DrawItem extends VisualItemBase {
  type: 'draw';
  draw: DrawProps;
}
interface DrawProps {
  brush: 'round' | 'sliced';
  color: string;
  size: number;                        // 笔宽，540 短边下的像素，[1, 40]
  alpha?: number;                      // [0, 1]
  strokes?: Array<{ points: Array<[number, number]> }>;   // 每个点是框内的百分比，每维 [0, 100]
}

interface PlaceholderItem extends VisualItemBase, MediaFields {
  type: 'placeholder';
  assetRef?: VersionRef;               // 换上的媒体；没有时画占位的外观
  placeholder: { variant: 'camera' | 'media' | 'screen'; notes?: string };   // notes 不超过 2048 字节
}

interface ConfettiItem extends VisualItemBase {
  type: 'confetti';
  confetti: ConfettiProps;
}
interface ConfettiProps {
  style: string;                       // 彩纸目录里的一款配方；其余字段缺省时取配方的值
  seed?: number;                       // 非负整数，缺省 0；新建时写入随机值
  colors?: string[];                   // 1–8 个颜色
  shapes?: string[];                   // 1–12 个，取自 rect strip circle ellipse triangle diamond star starlet sparkle heart petal ribbon
  size?: number; speed?: number;       // 对配方的倍率，[0.25, 4]
  gravity?: number;                    // 倍率，[-2, 4]
  drift?: number; spin?: number;       // 倍率，[0, 3]
  wind?: number;                       // 水平加速度，540 短边下的像素 / 秒²，[-600, 600]
  opacity?: number;                    // [0, 1]
  emit?: {
    mode?: 'continuous' | 'burst';
    rate?: number;                     // continuous：每秒的粒数，[1, 400]
    count?: number;                    // burst：每次的粒数，[1, 500]
    interval?: number;                 // burst：间隔秒，[0, 60]；0 只放一次
    settle?: boolean;                  // 实例结束前留出一段粒子寿命，不再发射
  };
  origin?: { x: number; y: number };   // 发射点，框内的百分比，每维 [-20, 120]；给出时替换配方的发射器
  angle?: number;                      // 发射方向，度，[-180, 180]；0 向右，-90 向上，90 向下
  spread?: number;                     // 扇面，度，[0, 360]
}

interface WhiteboardItem extends VisualItemBase, MediaFields {
  type: 'whiteboard';
  assetRef: VersionRef;                // 一个图片素材
  whiteboard: WhiteboardProps;
}
interface WhiteboardProps {
  hand?: 'marker' | 'pen' | 'none';    // 缺省 'marker'
  paper?: string;                      // 纸色；缺省透明，露出下面的画面
  draw?: number;                       // 画完全图的秒数，> 0；缺省 min(0.8 × 实例长度, 自然时长)，超过实例长度按实例长度
  inkFirst?: boolean;                  // 先墨线后色块，缺省 true
  pace?: 'stretch' | 'natural';        // 缺省 'stretch'
  strict?: boolean;                    // box 是硬遮罩，缺省 false
  beats?: WhiteboardBeat[];            // 最多 64 拍
}
interface WhiteboardBeat {
  at: MediaTime | string;              // 这一拍开始：实例局部时间，或词锚点（§3.16）
  end?: MediaTime | string;            // 缺省是下一拍的 at，末拍是 draw
  box: [number, number, number, number];   // [x, y, 宽, 高]，画布的百分比；x、y 在 [-100, 200]，宽、高在 (0, 300]
  label?: string;                      // 不超过 80 个字，只展示，不参与渲染
}

type CompositionSource = { kind: 'bundle'; assetRef: VersionRef };   // 代码包素材的一个版本（§4.3、代码包规范）

interface CompositionItem extends VisualItemBase {
  type: 'composition';
  source: CompositionSource;
  parameterValues: JsonValue;          // 实例的参数值
  timeMap: TimeMap;                    // 实例时间 → 合成的局部时间
  prerender?: VersionRef;              // 预渲染替身：一个视频素材版本
  audio?: EmbeddedAudio;               // 合成自己发出的声音的路由；没有声音的合成不写
  mask?: Mask;                         // §3.9
  fx?: Fx;                             // §3.9
}
```

- **款式引用**。`shape`、`templateId`、`visualizer.style`、`progress.style`、`confetti.style` 都是预设注册表里对应目录的 id。预设是数据，内容在 `crates/motion/presets/builtin/` 下，本规范只规定引用：写入只要求非空；渲染时目录里找不到报 `preset-unknown`，这个实例画不出来，要报告，不得画成空白。款式给出的缺省（配色、纵横比、配方参数）只在实例没写这个字段时用。
- 颜色一律 `#RRGGBB` 或 `#RRGGBBAA`。
- **计时读数**。读数在毫秒栅格上求值，单位秒：倒计时是 ⌈实例终点 − t⌉，正计时是 ⌊t − 实例起点⌋，按 `format` 显示。实例是半开区间，终点那一刻已不可见。计时文字沿用普通文字的 `style`、`place` 与 `animate`，但不能用 `typewriter`、`riseWords`。
- **贴纸**。`source: 'template'` 画贴纸目录里的矢量；`'asset'` 画 `assetRef` 指向的图片、视频或 Lottie 素材。`loop` 只对视频、Lottie 与 GIF 素材起作用：`loop` 循环，`once` 播一次停在末帧，`hold` 停在首帧。`fillOverrides` 在绘制前把 SVG 或 Lottie 里的原色换成目标色（Lottie 的渐变不参与；位图与视频素材不换色）。GIF 是图片素材，按帧的延时播放，没有单独的种类；图片实例里的 GIF 按自己的总时长循环。
- **声波**。画面由声音的频谱驱动：`audio` 指定取哪一路声音，按序列时刻映射到那一路的源时刻取样；`speaker` 只在这位说话人的词区间里动。
  - `'project'` 是这条序列混好的声音：每一刻在响的每一段声音（与导出混音同一份声音计划，音量、淡变、交叉淡化与闪避都算进去）各取它源时刻的频谱，频域按功率相加；按文稿触发的闪避不算进去，预览与导出相同。
  - 素材 ID 只听这个素材：取这一刻正在播它的那一段的源时刻（两段相接时取后一段），不乘音量；这一刻没有在播它就是静音。
  - 序列里没有声音时按静止的样子画，不报告；听的素材读不出声音时也按静止的样子画，并报告。
  - `speaker`：说话的区间来自视频里的转写投到这条序列上的有效词流（§3.9 按文稿触发的闪避用的同一份）里这位说话人的词；同一位说话人两个词相隔不超过 0.5 秒算一直在说。区间外按静音画。视频里没有转写、或转写里没有这位说话人在这条序列上说的话时整条按静音画，并报告。
  - `alwaysShow: false`：这一刻和它之前 0.5 秒里都静音（`speaker` 不在说话也算静音）时不画，一出声就画；没有频谱时也不画。缺省一直画。
- **进度条**。进度 p = clamp((t − 实例起点) / (实例终点 − 实例起点), 0, 1)，显示的值是 `startProgress + p × (endProgress − startProgress)`。它只取决于播放头，不读媒体。
- **手绘**。一个实例最多 256 条笔迹，合计最多 16384 个点。
- **占位框**。没有 `assetRef` 时画 `variant` 对应的占位外观；有时在同一个框里按视觉媒体画。只能换成视频或图片素材。
- **彩纸**。粒子由 `seed` 确定性地求出：任意时刻只计算还活着的粒子，与实例总长无关，实例可以随意拉长缩短。
- **白板**。按素材图片推导揭示的顺序（先墨线后色块，按阅读顺序），画到 `draw` 秒画完，之后整图静止到终点；推导出的揭示顺序不保存。`beats` 把画面分成按时间揭示的几拍：落在 `box` 里的笔画归这一拍，从 `at` 画到 `end`。数字 `at` 单调不减，`end` 晚于 `at` 且不晚于下一拍的 `at`，末拍的 `end` 不晚于 `draw`。词锚点解析到序列时刻后减去实例起点；解析不到的锚点让这一拍退回几何顺序并报告。`pace: 'stretch'` 每拍撑满自己的窗口，`'natural'` 按自然速度画完后停住；`strict` 时 `box` 是硬遮罩，重叠处的像素归后一拍。
- **生成类元素的秒**（`draw`、`interval`、拍的时刻、`wind` 里的秒）都是实例局部时间，按最短的十进制写法读成精确有理数，不量化，渲染按精确的局部时刻取样（§2.5）。
- **代码合成**。`bundle` 指向一个确定的代码包版本，执行合同见代码包规范。原来的内置生成器（`baocut.counter`、`baocut.sticker`、`baocut.lottie`、`baocut.audio-visualizer`、`baocut.progress`）已由上面的种类取代，不再是合成的来源。运行环境不可用的代码包不得画成空白之后当作成功：有预渲染替身就用替身，没有就报告这个实例画不出来。
- **预渲染替身**。`prerender` 是把这段合成渲染好的视频。它与合成共用 `timeMap`：合成的局部时间就是替身视频的源时间。合成的运行环境不可用，或来不及实时渲染时，预览与导出用替身代替；能运行时以代码为准。替身不是源：改了参数或换了代码包版本，替身就过期了。
- **声音**。合成发出的声音（用替身时是替身视频的音轨）由 `audio` 路由。时间线上另有同一段声音的音频实例时（例如渲染结果里已经混入了配音，配音又单独放在音频轨道上），必须关掉 `audio.enabled`，不得两处同时出声。合成与这些音频实例写进同一个音画联动组（`linkGroupId`，§3.4）表示组里的音频是合成声音单独放的一份：引擎写入时核对，同一条序列里组内有音频实例时，组内合成的 `audio` 必须省略或 `enabled: false`。替身是混好的成片，只扣掉其中几句做不到，整条关掉。

字段来源：`schema.rs` 的 `CounterProps`、`StickerProps`、`VisualizerProps`、`ProgressProps`、`DrawProps`、`PlaceholderProps`、`ConfettiProps`、`WhiteboardProps`、`WhiteboardBeat` 及其 `validate`；缺省落位见 `geometry.rs`。

### 3.8 字幕实例

```ts
interface CaptionItem extends ItemBase {
  type: 'caption';
  span: FrameSpan;
  documentId: Id;                      // kind 为 caption 的文档（§4.6）
  styleDocumentId?: Id;                // kind 为 caption-style 的文档
  scopeItemIds?: Id[];
}
```

- 字幕实例只在字幕轨道上。它没有 `place`：字幕的位置与排版由样式文档决定（§5.6）。
- 它引用文档的 **ID** 而不是某个版本：字幕跟随文档的当前版本，改字不需要改时间线。
- **时钟**。字幕文档里的时间要么在源素材的时钟上，要么已经是序列时间，由文档自己声明。`scopeItemIds` 列出把字幕投影到序列上的实例：一行字幕的源时间落在某个实例取用的源区间里，就经过那个实例的 `timeMap` 映射到序列时间；落在所有实例之外的行（被剪掉的话）不显示。`scopeItemIds` 省略表示文档里的时间已经是序列时间。
- `span` 限定显示的范围：投影之后落在 `span` 之外的行不显示。
- 一个字幕实例显示一份文档。双语字幕是两条字幕轨道上的两个实例，各自启用或停用；原文与译文不要求逐行对应（§5.1）。
- **句子的词**。字幕文档（`baocut.caption/1`）的一句可以用 `words`（`{ first, last }` 或 `{ wordIds }`）指向文档头 `sourceDocumentId` 那份转写（`kind: speech`）里的词，生成字幕时写上。逐词动画、逐词高亮与设计字幕的强调（样式里按词 ID 写的 `captionEmphasis`）按这些词推进，词取自有效词流（§5.7）：隐藏的词与剪掉的词不画，句子里有词因此被拿掉时按留下的词重拼文字（认词上的「贴前」标记），一个也不剩的句子不画；多字的 CJK 词按转写落盘的规则逐字拆开，时间按字符权重分摊，子 ID 是 `<词 ID>~<k>`（第一个字沿用词 ID），写在整个词上的强调落到它拆出来的每个字上。逐句样式（样式里的 `cueStyles`）按字幕文档里的句子 ID 找。在源素材时钟上的字幕用词自己的源时刻；在序列时钟上的字幕用词投到序列上、与这一句重叠的那一处。没写 `words` 的句子取时刻落在句子里的词，文字不动。译文字幕、导入的字幕与不派生自转写的字幕没有词，逐词动画按空白切分推算，不冒充词时间（§5.6）。

### 3.9 混音、转场与效果

```ts
interface AudioMix {
  volume: number;                      // 线性倍数，[0, 4]，缺省 1
  muted?: boolean;                     // 为 false 时省略
  fadeIn?: MediaTime;                  // [0, 5] 秒
  fadeOut?: MediaTime;                 // [0, 5] 秒
  envelope?: EnvelopePoint[];          // 音量关键帧；有它时取代 volume
}

interface EnvelopePoint {
  at?: MediaTime;                      // 实例局部的精确时刻
  percent?: number;                    // 实例长度的百分比，[0, 100]；与 at 二选一
  volume: number;                      // 线性倍数，[0, 4]
  ease?: EaseName;                     // 进入这一点的那一段的缓动（§3.15），缺省 'linear'
}

// 视频实例的内嵌音频、合成实例自己的声音
interface EmbeddedAudio {
  enabled: boolean;
  volume: number;                      // 同 AudioMix
  fadeIn?: MediaTime;
  fadeOut?: MediaTime;
  envelope?: EnvelopePoint[];
}

interface Transition {
  id: Id;
  leftItemId?: Id;                     // 出场的一侧：画面从它离开
  rightItemId?: Id;                    // 入场的一侧：画面进入它。两个至少有一个
  kind: TransitionKind | string;       // 认不出的种类原样保留
  params?: Record<string, JsonValue>;  // 按种类；空的时候省略
  durationFrames: number;              // 单侧 0.1–2 秒（v2 的区间）取最近的帧，至少 1 帧；两侧 1 帧到 10 秒
  easing: Easing;
  placement: 'center' | 'start-at-cut' | 'end-at-cut';
  audioCrossfade?: boolean;            // 两侧自带的声音等功率交叉淡化；为 false 时省略
}

type TransitionKind = 'dissolve' | 'wipe' | 'slide' | 'zoom' | 'iris' | 'dip-to-color' | 'push';
type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

interface Fx {
  filterPreset?: FilterPreset;         // 缺省 'none'
  effectPreset?: EffectPreset;         // 缺省 'none'
  effectIntensity?: number;            // [0, 1]，缺省 1
  grayscale?: number;                  // [0, 1]
  brightness?: number;                 // [-1, 1]
  exposure?: number;                   // [-1, 1]
  contrast?: number;                   // [-1, 1]
  saturation?: number;                 // [-1, 1]
  hue?: number;                        // [-1, 1]，乘 180 度
  temperature?: number;                // [-1, 1]
  blur?: number;                       // [0, 100]，540 短边下的像素
  sharpen?: number;                    // [0, 1]
  noise?: number;                      // [0, 1]
  vignette?: number;                   // [0, 1]
  shadow?: { offsetX: number; offsetY: number; blur: number; color: string; opacity: number };   // 长度是 540 短边下的像素
  stroke?: { width: number; color: string };                                                     // 同上
}

type FilterPreset = 'none' | 'calm1' | 'calm2' | 'calm3' | 'clean1' | 'clean2' | 'clean3'
  | 'cottage1' | 'cottage2' | 'cottage3' | 'peckham1' | 'peckham2' | 'peckham3';
type EffectPreset = 'none' | 'invert' | 'night_vision' | 'thermal_vision' | 'old' | 'polaroid'
  | 'filmic' | 'snowy' | 'box_blur' | 'bokeh_blur';

interface Mask {
  shape: 'ellipse';                    // 椭圆遮罩，内切于框
  feather?: number;                    // 羽化，540 短边下的像素，≥ 0，缺省 0
}

interface DuckingRule {
  id: Id;
  name?: string;
  enabled: boolean;
  trigger: { kind: 'speech' } | ({ kind: 'items' } & DuckingGroup);   // 有人说话时，或这些实例发声时
  target: DuckingGroup;                // 被压低的
  depth: number;                       // 压低的 dB，[0, 60]，缺省 10
  attack: MediaTime;                   // 触发开始之前多久开始下降，[0, 5] 秒，缺省 0.02
  release: MediaTime;                  // 触发结束之后多久恢复，[0, 5] 秒，缺省 0.35
}

interface DuckingGroup { trackIds?: Id[]; itemIds?: Id[] }   // 轨道上的全部实例，加上点名的实例
```

**混音**

- 音量是线性倍数，1 是原声，0 无声。界面与命令可以按 dB 显示与输入，换算是 `dB = 20·log10(volume)`，0 对应 −∞；保存的一律是倍数。
- 实例上保存的增益只有 `volume`。§7.6 与 §7.9 的 `gainDb` 是声音计划（v3 的容器）上的偏移，不是实例的字段：混音时乘 `10^(gainDb / 20)`，不写回实例。
- 淡入淡出与包络的时刻都是实例局部的精确时间，按最短的十进制写法读成有理数，不量化到帧。淡入从实例起点在 `fadeIn` 内由 0 线性升到 1，淡出在终点前 `fadeOut` 内线性降到 0。
- **包络**。点按时刻严格递增，一条包络只用一种时刻写法（`at` 或 `percent`），最多 256 个点。第一个点之前取它的值，最后一个点之后取最后一个点的值；`at` 超出实例终点的点不生效。相邻两点之间按后一点的 `ease` 在线性倍数上插值，带缓动的段按 0.02 秒烘焙成折线（与闪避的斜坡相同）。百分比的点随实例的裁切伸缩。
- 实例的增益 = 音量（`envelope` 的取样值，没有包络时是 `volume`）× 淡入淡出 × 闪避（见下）。导出与预览用同一个求值函数。
- 音频的微淡化与视觉的 dissolve 是不同的对象。不能只为了消除爆音而改变视频总长。

字段来源：`schema.rs` 的 `volume`、`audioFadeIn`、`audioFadeOut`、`AUDIO_FADE_RANGE`；`keyframes.rs` 的 `VOLUME_RANGE`、`volume_at`；`duck.rs` 的 `volume_curve`、`element_gain_envelopes`。

**转场**

- 两侧转场连接同一条轨道上首尾相接的两个视觉实例：左侧的终点等于右侧的起点，这一帧是剪切点 `cut`。只有 `rightItemId` 的是这个实例的入场转场，只有 `leftItemId` 的是出场转场。一个实例的开头与结尾各最多一个转场：设置新的转场替换同一条边上已有的；同一对实例沿用原来的 ID。
- 种类：`dissolve`、`wipe`、`slide`、`zoom`、`iris` 可以单侧也可以两侧；`dip-to-color`、`push` 只用于两侧。
- **单侧转场**作用在实例自己的框上。入场的窗口从实例起点开始，出场的窗口在实例终点结束，只能 `center`，不能 `audioCrossfade`。`durationFrames` 缺省是 0.5 秒取最近的帧；生效的长度是 min(D, ⌊L / 2⌋)，L 是实例的帧数：实例变短时转场随之变短，不删除，变短的转场在回执的 `impact.shortenedTransitions` 里列出（ID、写入的长度、生效的长度）。⌊L / 2⌋ 为 0 时这一头按硬切画。
- 两侧转场的窗口是 `[start, start + D)`，`D = durationFrames`：`center` 时 `start = cut − ⌊D/2⌋`，`start-at-cut` 时 `start = cut`，`end-at-cut` 时 `start = cut − D`。窗口不得越出两侧实例合起来的范围。
- 两侧转场在窗口里要同时画两侧：左侧在剪切点之后继续按自己的 timeMap 取源（尾部 handles），右侧在剪切点之前同样（头部 handles）。只有线性 timeMap 的视频实例与有预渲染替身的合成受素材长度限制：头部可用的帧数是实例起点映射到的源时刻除以速率，尾部是素材时长减去实例终点映射到的源时刻、再除以速率，都向下取整到帧。图片、文字、图形、生成类元素、定格、没有预渲染替身的合成以及素材时长未知的实例不受限制。
- **handles 不够时拒绝**（`TRANSITION_HANDLES_INSUFFICIENT`，说明哪个实例的哪一头缺几帧），不自动缩短两侧转场，也不移动实例。
- 每笔事务的操作全部执行之后，引擎检查全部转场，删掉不再成立的，并在回执的 `impact.removedTransitions` 里给出原因：`item-deleted`（实例没了，或不再是视觉实例）、`not-adjacent`（两侧不在同一轨道上或不再相接）、`too-long`（两侧转场的窗口越出实例）、`handles-insufficient`、`overlap`（同一个实例上两个转场的窗口重叠：按窗口起点、再按 ID 排序，先开始的留下）。移动、裁切、删除都按这一条处理。
- 拆分实例时，以它为左侧的转场改挂到右半上，以它为右侧的留在左半。
- 撤销之后会留下不成立的转场时，撤销被拒绝（命令与协议规范 §8.3）。
- 进度：`p = (t − start) / (end − start)` 是线性进度；`e` 是 `easing` 作用之后的进度：`ease-in` 为 p²，`ease-out` 为 1 − (1 − p)²，`ease-in-out` 为 p²(3 − 2p)。画面按 `e`，声音按 `p`。
- **入场的画法**，作用在进入的实例 B 上，框、旋转与镜像都是 B 自己的：
  - `dissolve`：B 的不透明度乘 e。
  - `wipe`：只露出 B 的框里从左边起 e 的部分（框自己的坐标，随旋转与镜像）。
  - `slide`：B 沿框自己的横轴从左边移入，位移 (e − 1) × 框宽，不透明度乘 e。
  - `zoom`：B 以框中心为原点缩放 0.75 + 0.25 × e，不透明度乘 e。
  - `iris`：只露出以框中心为圆心、半径为 e × 框对角线一半的圆里的部分。
- 单侧出场按同一种画法作用在离开的实例上，进度改用 p′ = (end − t) / (end − start)，即从 1 走到 0，再作用 `easing`；缺的一侧是透明的，露出下面的轨道。两侧转场先照常画 A，再把 B 按入场的画法盖在上面。两侧专用的种类：
  - `dip-to-color`（`params.color` 为 `#RRGGBB`）：e < 0.5 时从 A 混向这种颜色（比例 2e），之后从颜色混向 B（比例 2e − 1）。
  - `push`（`params.direction` 为 `left`、`right`、`up`、`down`，是运动的方向）：B 从画布外沿这个方向推入，A 同时沿同一方向被推出；B 剩余的位移是 (1 − e) 个画布宽或高，A 已走的位移是 e 个。
- 转场不成立、另一侧停用、所在轨道隐藏或画不出来时，这一刻按硬切画。认不出的种类保留在视频里，渲染按硬切并报告不支持。
- `audioCrossfade` 只用于两侧都是视频实例的转场，且两侧都启用：两段自带的声音在窗口里等功率交叉淡化，左侧乘 cos(p·π/2)，右侧乘 sin(p·π/2)。在自己区间之外的一侧按它的 timeMap 取 handles 里的声音，不套它自己的淡入淡出。有一侧停用时按硬切。轨道隐藏不影响声音，只看静音与 Solo。

字段来源：`video_transitions.rs` 的 `PRESETS`、`DURATION_RANGE`、`DURATION_DEFAULT` 与单侧的取样、画法。

**效果**

- `fx` 用于视觉媒体与合成实例（§3.4），不用于文字、图形与其余生成类元素：文字的描边、阴影在 `style` 里（§3.6），图形的在 `shape` 里。
- 字段是固定的，每个字段越界时拒绝写入，省略或等于恒等值时不产生效果。渲染按下面的固定顺序作用在这一层画好的结果上，与字段在对象里的书写顺序无关，之后再乘 `place.opacity`、与下面的层混合：
  1. `filterPreset`：滤镜预设，展开成固定的一串调色。
  2. `effectPreset`：特效预设，强度乘 `effectIntensity`。
  3. `grayscale` 与 `brightness`（`filter.colorAdjust@1`）。
  4. `exposure`（`filter.brightness`，量为 exposure × 2/3）。
  5. `contrast`（`filter.contrast`）。
  6. `saturation`（`filter.saturation`，量为 1 + saturation）。
  7. `hue`（`filter.hueRotate`，hue × 180 度）。
  8. `temperature`：红乘 1 + 0.2 × temperature、蓝乘 1 − 0.2 × temperature，夹到 [0, 1]。
  9. `blur`（`filter.blur@1`，半径 blur / 540 × 短边）。
  10. `sharpen`、`noise`、`vignette`（`filter.sharpen`、`filter.noise`、`filter.vignette`）。
  11. 圆角或椭圆遮罩（`mask.shape@1`）：`place` 的圆角（§3.5）或 `mask`，只在 `pip` 或平铺时生效。
  12. 动画的揭示（`mask.progress@1`，§3.15）。
  13. `stroke`：沿 alpha 轮廓的外侧画一圈，`width` 在 (0, 100]。
  14. `shadow`：alpha 轮廓平移、模糊、填色，画在画面下面；`blur` 在 [0, 200]，`opacity` 在 [0, 1]，向右、向下为正。
- 作用的位置：1–10 作用在素材画面上（裁剪之后、放进 `place` 的框之前），11–12 在元素的画法里，13–14 作用在这一层画好的结果上、沿它的 alpha 轮廓：描边贴着转过之后的轮廓，阴影的 `offsetX`、`offsetY` 按画布的右与下，不随 `place.rot` 转（实例转 90 度，`offsetX` 为正的阴影仍在画面右边）。
- 每一步的公式以配方为准（`render-raster` 的 `filter.*`、`mask.*` 配方与 `effects.rs` 的滤镜预设表），本规范不另写一份。
- 长度一律按画布短边为 540 时的像素保存，渲染时乘 `短边 / 540`。
- 遮罩、调整层、混合模式这类有后向依赖的效果进入 RenderGraph；不能逐个元素独立渲染之后假定可以无损拼回。`mask` 与圆角遮罩都受这一条约束。

字段来源：`schema.rs` 的 `Fx`、`FX_AMOUNT_RANGE`、`FX_ADJUST_RANGE`、`FX_BLUR_RANGE`、`FilterPreset`、`EffectPreset`、`Mask`；`effects.rs` 的 `lower_element_effects`、`REFERENCE_SHORT_EDGE`。`temperature`、`shadow`、`stroke` 是 v3 原有的三种效果并入 `fx` 的字段。

**闪避**

- 闪避规则存在序列上：触发时，目标组里的实例压低 `depth` dB。按时间线上的区间算，不看信号电平：结果只取决于时间线，逐帧确定，预览与导出一致。
- **按文稿触发**（`kind: 'speech'`）：触发区间是当前有效词流（§5.7）里每个词在序列上的区间；没有词级时间的词用它所在的句或 cue 的区间。视频没有文稿或有效词流为空时不压低，并报告 `duck-no-speech`（导出警告里是 `DUCK_NO_SPEECH`）。有效词流取视频里每份转写文档投到序列上的词：剪掉的、定格的、不在时间线上的不算。
- **按实例触发**（`kind: 'items'`）：触发区间是组里这些实例在序列上的区间（音频按采样精度，§2.10）：启用、所在轨道发声（没有静音，符合 Solo），而且本身发声——没有静音的音频实例、内嵌音频启用且素材有音轨的视频实例、有预渲染替身且声音启用的合成。组里引用的轨道不存在时报告 `duck-track-missing`。
- 触发区间先合并：间隔不超过 max(0.5 秒, attack + release) 的相邻区间并成一段。每段 `[s, e]` 展开成增益曲线上的四个点：(s − attack, 1)、(s, g)、(e, g)、(e + release, 1)，g = 10^(−depth / 20)，点之间在线性增益上插值，段外是 1。`attack`、`release` 小于 0.001 秒时按 0.001 秒算。
- 闪避增益与实例的音量、淡入淡出相乘；一个实例落在几条规则的目标组里时，各条的增益相乘。逐帧计划与导出读同一串压低量折点（dB）：各段的四个点之外，斜坡按 0.02 秒（`ENVELOPE_BAKE_STEP`）等分取样，折点之间在 dB 上线性。
- 取值：`depth` 在 [0, 60]；`attack`、`release` 在 [0, 5] 秒，是精确时间，不量化。目标组不能空，按实例触发时触发组也不能空，各最多 256 项；轨道须是视觉或音频轨道，实例须是音频、视频或合成实例；同一条轨道或实例不能同时在两组里。目标组里有锁定的轨道或实例时，不能设置或删除这条规则。
- 拆分组里点名的实例时，右半一起进组；合并（`joinItems`）时被并掉的一半从组里换成留下的那一件。组里引用的轨道或实例被删掉之后，那一项留着、不匹配任何实例；修改规则时只校验这次给出的组。

字段来源：`duck.rs` 的 `Duck`、`DUCK_DEPTH_DEFAULT`、`DUCK_DEPTH_RANGE`、`DUCK_TIME_RANGE`、`DUCK_MERGE_GAP`、`DUCK_MIN_RAMP`、`duck_curve`、`speech_intervals`、`track_intervals`；缺省的 attack 与 release 来自 `scene_primitives::audio_mix`。

### 3.10 保护与锁（本规范补全）

```ts
interface ProtectionRecord {
  id: Id;
  level: 'confirmed' | 'locked';
  target:
    | { kind: 'video' }
    | { kind: 'entity'; entityId: Id; propertyPaths?: string[] }
    | { kind: 'interval'; sequenceId: Id; span: FrameSpan; trackIds?: Id[] };
  origin: { by: 'user' | 'task'; taskId?: Id; conversationId?: Id; at: string };
  note?: string;
}
```

- `locked`：提交时强制检查；触碰它的事务被拒绝，必须显式解锁。
- `confirmed`：表示已确认的方向；自动流程不得无故重做，触碰时需要提案。
- 视频里保存的是持久的保护。只对一个任务生效的保护范围（「这次其他别动」）属于 TaskContract，由 Runtime 在提交时随授权上下文交给引擎一并检查，不写入视频。
- 轨道与实例上的 `locked` 字段是保护的快捷形式，语义等同于对该实体的 `locked` 保护。

### 3.11 检查点（本规范补全）

```ts
interface Checkpoint {
  id: Id;
  name: string;
  videoRevision: Revision;
  createdAt: string;
  origin: { by: 'user' | 'task' | 'system'; taskId?: Id };
  note?: string;
}
```

检查点是对某个已提交版本的命名引用，不复制媒体。被检查点引用的版本及其引用的素材版本不被 GC。

### 3.12 依赖链接

```ts
interface DependencyLink {
  from: VersionRef;                    // 派生物
  to: VersionRef;                      // 输入
  kind: 'derived-from' | 'aligned-to' | 'translated-from' | 'rendered-from' | 'anchored-to';
  inputFingerprint: string;
}
```

每个派生产物都记录输入的指纹。失效规则见架构设计 §10。

### 3.13 Marker

```ts
interface Marker {
  id: Id;
  frame: number;                       // 序列的帧
  durationFrames?: number;
  label: string;                       // 章节的标题
  kind?: 'chapter' | 'note' | 'todo';
  summary?: string;                    // 章节的摘要
  thumbnail?: VersionRef;              // 章节的缩略图：一个图片素材版本
}
```

- 章节是 `kind: 'chapter'` 的标记，不另设对象。序列的章节表就是按帧排序的章节标记。
- 章节固定在序列时间上：移动、裁切、删除实例与波纹删除（`removeRange`）都不改变它的帧。例外是剪口：应用与恢复剪口时章节跟着内容走（§6.7）。
- 章节的帧不小于 0，严格递增（同一帧不能有两章）。标题 1–200 个字符（去掉首尾空白），摘要不超过 2000 个字符，一个序列最多 1000 章。缩略图是写入时那个图片素材的当前版本。
- 整表替换章节时，其他种类的标记不动。章节不受轨道与实例的锁定影响。
- 章节不进帧计划，不影响画面与声音。

### 3.14 字体

字体使用视频资源引用与精确的样式标识，不只保存机器上的字体名。

```ts
interface FontRecord {
  id: Id;
  assetRef: VersionRef;               // 字体文件 bytes
  family: string;
  style: { weight: number; italic: boolean; stretch?: number };
  postscriptName?: string;
  license?: LicenseState;
}
```

缺字体时预览可以警告并使用替代字体；严格导出必须要求用户显式接受替代，或补齐字体。

现状：视频里还没有 `FontRecord`，文字样式与字幕样式只写字体族名（`fontFamily`）。渲染时先找随渲染内核发布的字体；不在其中的族按族名到本机字体里找（族名不分大小写，或按 PostScript 名精确匹配），预览与导出用同一份解析，同一个族名落到同一组文件（架构设计 §9.1）。哪里都找不到的族用替代字体画，文字元素与字幕在预览与导出里都报同一句提示；导出不拒绝，也不要求显式接受。本机字体不进视频，换一台机器画出来可能不同。

### 3.15 关键帧与元素动画

画面实例的运动有三层，自下而上叠加：静态的 `place`（§3.5），关键帧取样之后的基础姿态，元素动画（`animate`）与单侧转场（§3.9）。

**关键帧**

```ts
interface AnimationBinding {
  id: Id;
  targetId: Id;                        // 一个画面实例
  propertyPath: 'x' | 'y' | 'scale' | 'scaleY' | 'rot' | 'opacity' | 'radius';
  keyframes: Keyframe[];               // 1–256 个
}

interface Keyframe {
  localFrame?: number;                 // 实例局部的帧，序列编辑网格，≥ 0
  percent?: number;                    // 实例长度的百分比，[0, 100]；与 localFrame 二选一
  value: number;
  ease?: EaseName;                     // 进入这一帧的那一段的缓动，缺省 'linear'
}

type EaseName =
  | 'linear'
  | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeInQuart' | 'easeOutQuart' | 'easeInOutQuart'
  | 'easeInExpo' | 'easeOutExpo' | 'easeInOutExpo'
  | 'easeInSine' | 'easeOutSine' | 'easeInOutSine'
  | 'easeInBack' | 'easeOutBack' | 'easeInOutBack'
  | 'easeOutElastic';
```

- 属性与 `place` 的同名字段一一对应，单位相同：`x`、`y` 是画布的百分比，`scale`、`scaleY` 是倍率，`rot` 是度，`opacity` 在 [0, 1]，`radius` ≥ 0（540 短边下的像素）。值越界时拒绝写入。音量的关键帧是混音的包络（§3.9），不在这里。
- 适用范围：`radius` 只用于视觉媒体，其余属性用于全部画面实例。同一个实例的同一个属性至多一条绑定。
- 一条绑定里的帧只用一种时刻写法，时刻严格递增。`localFrame` 跟着内容走；`percent` 跟着实例的长度伸缩，裁切之后仍落在同样的比例上。
- **取样**。在实例局部的精确时刻取样（§2.5），不先量化到帧。第一帧之前取第一帧的值，最后一帧之后取最后一帧的值；`localFrame` 超出实例长度的帧不生效。帧 i − 1 到帧 i 之间按帧 i 的 `ease` 插值，缓动函数以 `motion` 的缓动表为准。
- 取样值**取代** `place` 的同名静态值，成为基础姿态；`radius` 的取样值取代四个角的全部圆角（包括 `cornerRadii`）。元素动画与单侧转场叠在基础姿态上。
- **露底检查**。静态位置盖满画布的视频或图片带画面关键帧时，引擎按帧网格与每个关键帧时刻取样，运动中露出画布超过 0.5 像素就在回执里提醒，不拒绝。
- **拆分、合并与裁切**。拆分时两半各自保留落在自己窗口里的帧，并在接缝处各补一帧取样值，看得见的动画不变。合并是拆分的逆：能还原成同一串帧时合并，否则拒绝。裁切或跟随剪口改变实例的窗口时，`localFrame` 按内容的位移换算，落到窗口外的帧去掉并在新边界补一帧取样值；`percent` 原样保留。以上换算的结果按 §2.6 量化到帧。
- 以秒给出的关键帧时刻（v2 的 `t`、命令里的秒）换算成 `localFrame` 时取最近的帧，并给出量化回执；百分比原样保存。改变 `Sequence.fps` 时按 §2.12 的事务转换。
- 认不出的属性或缓动名写入时拒绝。拖动带关键帧的对象时，命令要说明是「改基础姿态」还是「在当前帧加关键帧」。
- 代码合成内部的关键帧由代码包自己管理，不在这里。

字段来源：`keyframes.rs` 的 `KEYFRAME_PROPS`、`KEYFRAMES_MAX_PER_PROP`、`KeyTime`、`Keyframe`、`KeyframeCaps`、`sample`、`place_at`、`keyframes_uncover`、`UNCOVERED_TOLERANCE_PX`、`rewindow`、`split_keyframes`、`join_keyframes`；缓动名见 `crates/motion/src/curve.rs` 的 `EASE_NAMES`。

**元素动画**

```ts
interface Animation {
  enter?: AnimationSlot;               // 入场
  exit?: AnimationSlot;                // 出场
  loop?: AnimationSlot;                // 循环
}

interface AnimationSlot {
  preset: string;                      // 这一槽的预设名，见下
  presetVersion?: number;              // 预设的版本，当前为 1
  dur?: number;                        // 秒，[0.1, 2]；只用于入场、出场，缺省取预设的值
  delay?: number;                      // 秒，≥ 0，缺省 0
  intensity?: number;                  // [0, 1]，缺省 1
  ease?: EaseName;                     // 缺省取预设的曲线
  stagger?: number;                    // 逐字、逐词错开的秒数，> 0；只用于入场、出场
  staggerFrom?: 'start' | 'end' | 'center';   // 只用于入场、出场
  period?: number;                     // 秒，[0.2, 6]；只用于循环，缺省取预设的值
  phase?: number;                      // 秒，有限数；只用于循环，缺省 0
  seed?: number;                       // 非负整数；只用于循环，缺省取预设的值
}
```

- 三个槽是实例的正式字段，原样保存，不展开成关键帧。渲染时由 `motion` 按实例局部的精确时刻取样（`timeline::motion::compile_animation`），三端同一个结果。
- `preset` 是封闭的名字表，写入时校验：入场取 `ENTER_PRESETS`，出场取 `EXIT_PRESETS`（旧名 `EXIT_LEGACY_PRESETS` 可以读），循环取 `LOOP_PRESETS`。预设的配方是数据，在 `crates/motion/presets/builtin/motion/` 下；本规范只规定按 `preset` 与 `presetVersion` 引用。渲染时找不到这一对的配方，这一槽跳过并报告，实例的其余部分照常画。
- 不适用于这一槽的字段写入时拒绝。
- 没写出场槽时，按入场预设的镜像推出出场，时长是入场的有效时长 × 0.75；出场写 `preset: 'none'` 关掉这个推导。入场、循环写 `'none'` 等于删掉这一槽。
- `typewriter`、`riseWords` 只用于文字，不用于计时读数。音频实例没有 `animate`。
- 秒都是实例局部的精确时间，不量化。

字段来源：`schema.rs` 的 `Animation`、`AnimationSlot`、`ENTER_PRESETS`、`EXIT_PRESETS`、`EXIT_LEGACY_PRESETS`、`LOOP_PRESETS`；`animations.rs` 的 `ANIMATION_PRESET_VERSION` 与各区间常量；出场的推导见 `crates/motion/src/lower_timeline.rs` 的 `effective_exit`。

### 3.16 FollowPolicy 与语义锚

每个附属元素声明它跟着什么移动：

```ts
type FollowPolicy =
  | { kind: 'sequence-fixed' }                         // 固定在序列时间上，例如片头 Logo
  | { kind: 'follow-cuts' }                            // 跟着剪口移动与缩短，见下
  | { kind: 'item-local'; itemId: Id }                 // 跟着指定的片段移动，见下
  | { kind: 'speech-anchor'; start?: SemanticAnchor; end?: SemanticAnchor }   // 起点、终点挂在词或句上，至少一个
  | { kind: 'explicit-link-group'; groupId: Id };      // 音画成组，按规则联动

// 本规范补全
type SemanticAnchor =
  | { kind: 'word'; speechRef: VersionRef; wordId: Id; occurrenceId?: Id; edge: 'start' | 'end'; offset?: MediaTime }
  | { kind: 'sentence'; speechRef: VersionRef; sentenceId: Id; occurrenceId?: Id; edge: 'start' | 'end' }
  | { kind: 'item'; itemId: Id; localOffset: MediaTime }
  | { kind: 'sequence'; sequenceId: Id; frame: number };
```

- **到序列末尾**。`ItemBase.untilSequenceEnd` 为 true 的实例没有自己的终点：终点是序列里其余对象的最晚终点，`durationPolicy` 为 `fixed` 时是固定的长度。它与任何 `FollowPolicy` 都可以同时使用，`speech-anchor` 有 `end` 时不能用。
  - 引擎在每笔编辑事务的最后按最终的时间线求终点，写回 `span`；写入时给的长度与直接修剪它的终点都不算数。
  - 其余对象是序列上其余实例（包括停用的），它们精确终点的最大值向上取整到帧；到序列末尾的实例互不计入。
  - 同一条轨道上后面还有实例时，终点截到那个实例的起点。长度至少 1 帧。带线性 `timeMap` 的不超出素材。
  - 终点是求出来的，不是对实例的编辑：实例或轨道锁着也照样更新。任务保护按改动核对（命令与协议规范 §3.4），改到受保护的这种实例时整笔拒绝。
  - 关键帧按起点不动的窗口换算（§3.15）。
- **`speech-anchor`**。已定：每笔编辑事务的最后（求到序列末尾的终点之前），引擎按最终的时间线重新求每个锚点并摆放实例；起点、终点各自求值，没有锚点的一端：只有起点时保持长度，只有终点时起点不动。求出的时刻按 §2.6 的 `nearest-frame` 量化到帧，摆放按移动起点、再修剪终点（关键帧按 §3.15 换算）。
  - 词的投影与按文稿闪避相同（§3.9）：作用实例是转写素材在序列上的视频、音频实例，按起点、再按 ID 排，同一刻只取第一个；隐藏的词与没有文字的词不投影。投影决定词出现在哪里，时刻按那个实例的线性映射与词的刻度精确求。
  - 词的中点落在素材的剪口里（§6.7）算被剪掉。端点落在剪口里时向保留下来的部分靠：起点推到剪口之后，终点拉到剪口之前；端点被修剪掉时靠到中点所在实例的边上。词锚点的 `offset` 是带符号的精确时长，在映射到序列时间之后加上；结果为负时这个锚点无效。
  - 出现处：中点映射到不止一处时有歧义。`occurrenceId` 是作用实例的 ID，或拆分之前的那个（`lineage.originItemId`），按它只取那一处。
  - 句子锚点用存下来的 `sentences`（§5.2）：起点是第一个求得出的成员词的开头，终点是最后一个求得出的成员词的结尾；文档没有存句子时求不出。`item` 锚点是那个实例的起点加 `localOffset`；`sequence` 锚点就是那一帧，序列不是实例所在的序列时求不出。
- 锚点求不出来时（已定）：
  - 词被剪掉、词或句子不存在、词在当前的时间线上没有出现、偏移之后为负、求出的终点不晚于起点，或者求出的位置摆不下（与同一轨道上的实例重叠、超出素材），实例留在上一次的位置，进入 `orphaned` 状态；不得静默地挂到相邻的句子上，也不得跑到 0 秒。之后的事务照样重求，求得出、摆得下时回到锚点上。
  - `orphaned` 不落盘，按时间线现算：每笔事务的回执在 `impact.orphanedAnchors` 列出这时的 `orphaned` 实例，`videos.inspect` 列出实例与原因（原因码同 `anchors.rs`：`word-anchor-missing`、`-cut`、`-unmapped`、`-ambiguous`、`-invalid`，另有 `sentence-anchor-missing`、`item-anchor-missing`、`sequence-anchor-mismatch`、`anchor-range-empty`、`anchor-blocked`）。渲染不看这个状态，实例照常输出。
  - 这笔事务里写下（新建或改了跟随策略）的锚点有歧义、或指向不存在的转写文档版本时整笔拒绝（`INVALID_OPERATION`，`details.rule` 是原因码）；锚点的形状不对时同样在写入时拒绝。早先写下的锚点后来有了歧义时只进入 `orphaned`，不拒绝那笔编辑。
  - 实例或轨道锁着、而锚点要移动它时整笔拒绝（`TARGET_LOCKED`），与 `follow-cuts` 相同。
- **`item-local`**。已定：实例保持它相对目标实例起点的位置，每笔编辑事务的最后按目标在这笔事务里的变化补算；只移动，不改长度。锚点时刻是跟随者的起点。
  - 目标带线性 `timeMap` 时，锚点换成目标上的源时刻，在事务之后的目标与由它拆出来的实例（lineage）上找回：落在哪一段里就跟着那一段，`itemId` 改指那一段；源时刻被修剪或剪掉时移到它之后最近那一段的起点；在所有段之后时按最后一段外推。合并（`joinItems`）之后改指留下的那件。
  - 没有 `timeMap` 的目标：整体移动时跟着移动；只改起点时不动，起点越过锚点时移到目标的新起点；拆开时跟着锚点所在的那一段。
  - 跟随者在目标起点之前时，保持到目标新起点的距离。
  - 目标被删掉（拆出来的也一段不剩）时，跟随者在同一笔事务里一起删掉，列在回执的 `impact.removedWithTarget`；跟着它的实例再一起删。
  - 跟随者自己在这笔事务里被移动或修剪过、或者跟随策略是这笔事务写下的，不再补算。写下时目标必须在同一个序列上，否则拒绝（`INVALID_OPERATION`，`details.rule: 'item-local-target'`）。跟随者锁着而要移动或删掉时整笔拒绝（`TARGET_LOCKED`）；移动之后与同轨道的实例重叠时按 §3.10 拒绝。
- **`explicit-link-group`**。已定：这一版不做联动，只保存与校验形状，编辑时不移动。
- **`follow-cuts`**。应用或恢复剪口（§6.7）的事务里，这样的实例按剪口之前与之后的时间线移动：
  - 起点与终点各自先从旧的序列时刻映射回被剪素材上的源时刻，再映射到新的序列时刻。
  - 落进被删掉的区间时，起点推到下一个保留的时刻，终点拉到上一个保留的时刻；终点不晚于起点时删掉这个实例，在回执里列出。
  - 起点被推后时，带 timeMap 的实例的源起点同步后移（推后的长度乘速率）。
  - 跨过剪口的实例只缩短，不在中间开洞，也不拆开。
  - 落在被剪素材所有实例之后的实例，保持它到序列末尾的距离。
  - 恢复剪口时，起点在接缝处或之后的后移放回的长度；跨过接缝的延长这么长（带 timeMap 的不超出素材）；终点正好在接缝处的不动。
  - 结果按 §2.6 量化到帧；关键帧按 §3.15 换算。
  - 被剪的轨道（§6.7）上的实例随波纹删除与插回移动，不看自己的 `FollowPolicy`。
- **缺省**。已定：按时刻放置的实例从新建起缺省 `follow-cuts`，视频有没有剪口集合都一样：文字、形状、贴纸、图片与视频画中画、字幕、生成类实例、取自另一素材的音频。`sequence-fixed` 要显式选择（`insertItems` 或 `updateItem` 写明）。播放被剪素材本身的实例照旧随剪口重排，不看策略。早先版本没有写 `followPolicy` 的实例读作缺省的 `follow-cuts`，不另做迁移；早先按旧缺省显式写成 `sequence-fixed` 的实例与用户选的分不开，保持不动。用户说「跟着这句话」时使用 `speech-anchor`。
- 「全局 ripple」必须在命令中点明受影响的轨道集合与锁定轨道的处理方式。不能把全部轨道都左移，也不能只改主视频却让字幕和旁白留在旧的时间上。

字段来源：`anchors.rs`（锚点文法、`start`/`end` 边界、偏移、落在剪口里的靠边规则、`word-anchor-invalid`、`-missing`、`-cut`、`-unmapped`、`-ambiguous`）；`follow.rs` 的数字元素规则与 `COMPOSE_EPS`；开放的终点见 `motion.rs` 里按项目末尾取值的分支。

### 3.17 模板层

模板层是序列上的一组固定版面：章节条、进度线、台标、文字。它画在所有轨道之上，坐标是画面的百分比，时间是序列时钟。

```ts
interface TemplateLayers {
  id: string;
  name: string;                        // 非空
  hue: string;                         // 目录卡片的色相：purple cyan orange yellow magenta blue gray red green pink；缺省 'gray'
  group?: string;                      // 目录分组
  canvas: '16:9' | '9:16';             // 版面按哪种画幅画，缺省 '16:9'
  ratio?: string;                      // 套用时把序列画布改成的画幅：'original' 或 'W:H'
  lockRatio?: boolean;                 // 与 ratio 同时给出时，锁住序列的画幅；为 false 时省略
  builtin?: boolean;                   // 内置目录里的定义为 true；为 false 时省略
  tag?: string;                        // 'watermark' 表示水印类
  imported?: string;                   // 'watermark' 表示由旧水印预设导入
  desc?: string;
  font?: string;                       // 整套的字体族；省略时跟随字幕样式的字体
  from?: string;                       // 实例来源的定义 id
  subsAvoid?: boolean;                 // 字幕避让底部横条，缺省 true
  layers: TemplateLayer[];             // 数组顺序就是叠放顺序，靠后的在上
}

type TemplateLayer = {
  id: string;                          // 在这套模板里唯一
  on?: boolean;                        // 缺省 true
  box: { x: number; y: number; w: number; h: number };   // 画面的百分比，左上为原点
} & (
  | { kind: 'chapters'; fill?: 'bar' | 'dim'; bg: string; color: string; accent: string; colorDone?: string; divider?: boolean; size?: number }
  | { kind: 'progress'; accent: string; track: string }
  | { kind: 'logo'; src?: 'text' | { brandLogo: string } | { file: string }; text?: string; bg?: string; color: string;
      shape?: 'badge' | 'plain'; align?: 'left' | 'center' | 'right'; size?: number; pad?: number; tile?: boolean; opacity?: number }
  | { kind: 'text'; text: string; color: string; bg?: string; align?: 'left' | 'center' | 'right'; size?: number;
      pad?: number; mono?: boolean; weight?: number }
);
```

- 颜色一律 `#RRGGBB` 或 `#RRGGBBAA`。`size` 与 `pad` 是画面高的百分比：章节条缺省 `size` 2.6、台标 3.0、文字 2.8；`pad` 缺省按字号推。文字的 `weight` 在 [100, 900]，缺省 700。章节条的 `fill` 缺省 `bar`，`divider` 缺省 true。台标的 `src` 缺省 `'text'`，`shape` 缺省 `badge`，`align` 缺省 `center`，`opacity` 读时夹到 [0.05, 1]、缺省 1；文字的 `align` 缺省 `left`。
- 盒子：`x`、`y` ≥ 0，`w` ≥ 4，`h` ≥ 0.6，`x + w` ≤ 100，`y + h` ≤ 100，容差 0.051。
- 台标的 `file` 是项目里的相对路径，`brandLogo` 是品牌库里的图片 id；用到时按素材登记（§4.1）。
- **时间**。章节条按序列上 `kind: 'chapter'` 的标记（§3.13）分段，当前段高亮；没有章节时整条是一段。进度线的进度是 clamp(t / 序列长度, 0, 1)。
- **文字变量**。文字层里的 `{chapter}`、`{n}`、`{count}`、`{time}`、`{remain}`、`{total}`、`{percent}`、`{title}` 按当前时刻替换：当前章节名、序号、章节数、已播时间、剩余时间、总长、百分比、视频标题。认不出的变量原样显示。
- **字幕避让**。`subsAvoid` 为 true 时，打开的、`y` ≥ 50 的整宽横条（章节条、进度线）把字幕抬起来：字幕的锚线（样式的 `y`，画面高的百分比）不低于 `y − 2`，几条横条取最高的一条。只挪位置，不改字号、宽度与底板；双语的两行一起挪，居中摆放的字幕不动。
- **画幅**。`ratio` 只在套用模板时改一次序列的画布；`lockRatio` 生效时，改序列画幅的命令只接受与 `ratio` 相同的画幅，要改先解锁。
- 模板层是序列的参数，不是实例：不在轨道上，没有 `span`，不参与 `durationPolicy`。

字段来源：`crates/timeline/src/protocol/template.rs` 的 `TemplateDoc`、`TemplateLayer`、`LayerBox`、`LayerKind`、`MIN_W`、`MIN_H`、`VAR_NAMES`、`HUES`、`MIN_OPACITY`、`validate`、`ratio_lock`；派生规则见 `crates/timeline/src/template.rs` 的 `progress`、`segments`、`vars`、`fill`、`subs_bottom`。

---

## 4. 素材与文档

### 4.1 AssetRecord

素材是视频用到的 bytes：一个文件，或一个目录。

```ts
interface AssetRecord {
  id: Id;
  kind: 'video' | 'audio' | 'image' | 'lottie' | 'font' | 'caption' | 'document' | 'bundle' | 'other';
  name: string;
  currentRevision: Revision;
  revisions: Record<Revision, AssetRevision>;
}

interface AssetRevision {
  revision: Revision;
  contentHash: string;                // 文件的 sha256；目录的树摘要（§4.3）
  byteLength: number;
  mediaType: string;                  // 目录是 inode/directory
  storage: AssetStorage;              // §4.2
  duration?: MediaTime;
  timebase?: Rate;
  video?: {
    displayWidth: number;
    displayHeight: number;
    rotation: 0 | 90 | 180 | 270;
    pixelAspectRatio: Rate;
    frameRate: { kind: 'cfr'; rate: Rate } | { kind: 'vfr'; nominal?: Rate };
    ptsOrigin: MediaTime;             // 原始 origin；可以为负
    hasAlpha: boolean;
  };
  audio?: { sampleRate: number; channels: number; layout?: string };
  tree?: { fileCount: number; include?: string[] };   // 素材是目录时（§4.3）
  bundle?: JsonValue;                 // 代码包的清单（代码包规范 §2）
  provenance: Provenance;             // §4.5
}
```

- 素材 ID 标识资源的身份；素材版本标识一份确定的 bytes 与元数据。版本一旦写入不再修改。
- `contentHash` 必填，登记时算好。不存在「摘要待定」的素材版本。
- `kind: 'lottie'` 是一个 Lottie 动画文件，只能被素材贴纸引用（§3.7）；它没有音轨，显示尺寸取动画声明的宽与高。素材是一份 bodymovin JSON（`mediaType` 是 `application/json`），或一个 `.lottie` 压缩包（`application/zip`，画清单里的当前动画，没有清单时画第一段）。导入时 `.lottie` 文件，以及读出来像 Lottie 的 `.json`（顶层有版本 `v`、数值的 `fr`、`ip`、`op` 与图层数组）记成 `lottie`，别的 JSON 仍是 `other`；版本记下 `video`（动画声明的宽高、帧率，像素比 1，`hasAlpha`）与 `duration`（帧范围除以帧率，按毫秒取整），都用渲染内核读 Lottie 的同一份实现读出。读不开、用了内核不支持的特性或帧范围为空的不收（`MEDIA_PROBE_FAILED`），超过 32 MiB 的不收（`INVALID_OPERATION`）。图片子资源可以是 PNG、JPEG、GIF（首帧）、WebP 或 SVG（按资源声明的宽高光栅，`<text>` 不画），要么内嵌成 data URI，要么放在同一个压缩包里；只写了路径、包里也没有的外部图片读不到，这个实例画不出来，报 `lottie-asset-missing`。
- `kind: 'caption'` 与 `kind: 'document'` 是**文件**（一个 SRT、一份 PDF），不是 §4.4 的文档。导入字幕文件时，文件是素材，解析出来的字幕行是文档，文档用 `sourceAssetId` 指回文件。
- 可变帧率的索引、代理、缩略图、波形和反向 conform 都是派生产物，不属于素材版本。
- 颜色信息（`ColorInfo`）与许可状态（`LicenseState`）尚未纳入（§9）。

### 4.2 存储位置

bytes 放在哪里是素材版本的属性，不属于版本的身份。

```ts
type AssetStorage =
  | { mode: 'managed' }                                      // 在视频目录的 blobs/ 里，按内容寻址
  | { mode: 'linked'; locator: FileLocator; frozen: boolean };   // 留在原处，视频只记下去哪里找

interface FileLocator {
  path: string;                       // 文件在项目目录里时是相对视频目录的路径（`/` 分隔），否则是绝对路径
  modifiedAt?: string;                // 链接时文件的修改时间，用来便宜地发现「文件可能变了」
  volume?: string;                    // 所在卷的名字，文件找不到时提示「请接上某个盘」
}
```

- 导入默认是 `linked`（留在原处）；用户选择「复制到视频里」时是 `managed`。没有原文件可以指向的内容（模型生成的结果、录制与粘贴的内容）总是 `managed`；目录（代码包）不指定时也是 `managed`。`importAsset` 不给 `storage` 时按这条决定：文件 `linked`，目录 `managed`。`managed` 的导入要给绝对路径；`linked` 可以给绝对路径，也可以给相对视频目录的路径。**任何素材都可以链接，任何链接素材都可以随时收进来**：`collectAssets` 把链接素材的 bytes 复制进 `blobs/`，`storage` 从 `linked` 变成 `managed`。
- **定位跟着项目走。** 链接时（`importAsset` 与 `relinkAsset`）引擎把调用方给的路径按字面规范化（去掉 `.`、抵掉 `..`，不解析符号链接），再看它在不在视频所在的**项目目录**里：在就记相对视频目录的路径，可以有 `..`，但不越出项目目录；不在就记绝对路径。整个项目目录移动或改名之后，项目里的链接照样有效。项目目录是视频目录的父目录链上带 `.bcut/project.json` 的最近一层（引擎只看这个文件在不在）；都没有时是视频目录的父目录。路径的写法不同（例如经过符号链接的上级目录）时，再按两边所在目录的真实路径比较一次；文件本身是符号链接时不解析它，项目里的那个链接跟着项目走。
- **相对定位不越出项目目录。** 解析时相对路径按视频目录求值，结果越出项目目录就不读（`ASSET_MISSING`，`reason: 'outside-project'`），收进来（`collectAssets`）也一样，免得一个别处拿来的视频用 `../../..` 读项目外的文件。只拷走视频目录而不带项目时，项目里的链接会落空或越界，要重新链接。绝对路径的链接素材按下文的预览类型检查把关。
- 已经按绝对路径登记、其实在项目里的链接（这条规则之前导入的）不批量迁移，也不从旧路径猜测新位置：项目被移动之后它们按缺失报告，用 `relinkAsset` 重新指向，定位随之改成相对路径。
- 文件挪了地方用 `relinkAsset`：核对新位置上的内容与登记的 `contentHash` 一致，然后更新定位。
- 收进来与重新链接都**不产生新版本**，引用这个版本的实例不受影响。
- 同一路径上出现了不同的 bytes 是**新版本**，不是重新链接：必须经显式的替换素材版本，并由它影响选定的实例（架构设计 §5.3）。`relinkAsset` 遇到内容不一致时拒绝。
- 链接的文件找不到时，视频照常打开，素材标为缺失；用到它的实例不得画成空白之后当作成功。缺失经 `videos.assetStatus` 报告（命令与协议规范 §4.1）：每个素材的当前版本与实例引用的版本里，此刻读不到的逐个列出，原因是 `missing`（不在了）、`changed`（已经不是登记时的文件）或 `outside-project`（相对定位越出了项目目录），与取用时 `ASSET_MISSING` 的 `details.reason` 相同。它只看文件在不在、长度对不对，不重算摘要。
- `linked` 且 `frozen = false` 的素材不能用于严格的冻结导出（架构设计 §5.6）。
- 定位素材只看 `storage.locator` 里的本机路径。从本机媒体新建视频时，来源也记下原文件的路径（§4.5）。两处都是这台机器上的事实，不进入便携包（§8）。
- 应用把链接素材交给界面预览时，只放行视频登记的那一个文件，不放行它所在目录里别的东西；而且只放行预览用得到的类型（图片、音视频、字体、确认是 Lottie 的 JSON、中央目录里确实有动画的 `.lottie` 压缩包），登记的媒体类型要与文件实际的扩展名相符。字幕文件与目录不经这条路给出。
- 导出的成片可以写到任何位置。视频不要求导出物在视频目录里，只记下它去了哪里（`export-record` 文档，§4.6）。
- `blobs/` 里归视频管理的只有 `<sha256-hex>.<ext>`（文件素材）与 `<sha256-hex>/`（目录素材）；`blobs/.staging/` 是发布前的临时区，里面修改时间超过宽限期（1 小时）的残留由引擎的 blob GC 清掉（架构设计 §5.2）。名字不是这个形状的条目不归视频管理，GC 与物理删除都不碰。

### 4.3 目录素材与代码包

素材可以是一个目录。代码包就是目录素材：`kind: 'bundle'`，清单放在版本的 `bundle` 字段里。

- **树摘要**。目录的 `contentHash` 这样求：每个文件一行 `<sha256> <字节数> <相对路径>`，按路径排序，整体再求 sha256。`byteLength` 是各文件字节数之和，`tree.fileCount` 是文件数。
- **只收一部分**。`tree.include` 列出收入的文件与子目录（相对路径）；省略表示整个目录。树摘要只覆盖收入的文件。源码目录里常有依赖缓存、渲染输出与工作文件，它们不属于代码包。
- 目录素材同样可以 `managed` 或 `linked`，同样可以收进来或重新链接。
- 代码包的每个版本不可变。改源码产生新版本，再显式替换合成实例的引用（代码包规范 §3）。
- 清单的字段、作者合同与验证见代码包规范。视频格式只保证清单随版本原样保存。

### 4.4 文档

文档是结构化的文稿。转写、译文、字幕、样式、提案、计划都是文档。

```ts
interface DocumentRecord {
  id: Id;
  kind: string;                       // 开放词表（§4.6）
  name: string;
  language?: string;                  // BCP 47
  sourceAssetId?: Id;                 // 这份文档描述的素材，例如转写对应的录音
  sourceDocumentId?: Id;              // 这份文档派生自哪份文档，例如译文对应的转写
  currentRevision: Revision;
  revisions: Record<Revision, DocumentRevision>;
  extensions?: Record<string, JsonValue>;
}

interface DocumentRevision {
  revision: Revision;
  contentHash: string;
  byteLength: number;
  createdAt: string;
  createdBy: Id;                      // 写入这个版本的事务
  summary?: JsonValue;                // 正文的概要：词数、句数、行数等
}
```

- **正文不在快照里。** 快照只带文档头。正文是一个 JSON 值，按版本保存在视频的存储里，需要时按 `(文档 ID, 版本)` 读取。一部六小时的视频有几万个词，打开视频、列出文档、给智能体看概要都不应该为此读入全部正文。
- `summary` 让列表与智能体不必读正文就知道文档有多大、有什么。
- 每次写入产生一个新版本，旧版本留给历史、撤销与冻结中的任务。当前版本是后续计算的依据。
- 正文带 `schema` 字段，写明它的格式与版本（§4.6）。
- 文档之间、文档与素材之间的派生关系用 `sourceDocumentId`、`sourceAssetId` 表达；带版本与指纹的依赖用 §3.12 的依赖链接。
- 实例引用文档的 ID（字幕实例，§3.8），跟随文档的当前版本。

### 4.5 来源

```ts
interface Provenance {
  origin: string;                     // 开放词表：user-import、file-import、generated、derived、baked、template、library……
  importedFrom?: { originalName: string; importedAt: string };
  source?: JsonValue;                 // 已知的出处：来源网址、原平台的元数据、生成记录
}
```

- 来源可以记本机路径。从本机媒体新建的视频（转录流程，`origin: 'file-import'`，架构设计 §7.9），`source.path` 是原文件的绝对路径，`source.jobId` 是这次运行。它只说明素材从哪里来，不用来定位：读素材只看 `storage.locator`（§4.2），文件之后移动、改名或重新链接，来源都不跟着改。打包成便携包时这个路径换成占位（§8）。
- 从链接下载的素材，`origin` 为 `link-import`（架构设计 §7.9），`source` 记：`url`（脱敏的链接）、`webpageUrl`、`platform`、`mediaId`、`title`、`uploader`、`uploadDate`、`durationSec`、`description`（页面简介，去掉首尾空白，最多 20000 个字符）、`chapters`（平台给的章节 `[{ start, end?, title }]`，源时间秒：丢掉起点不是有限非负数的与空标题，标题合并空白、最多 160 个字符，按起点排序、同起点只留第一条，最多 400 条；`end` 只在大于 `start` 时写）、`tool`（`{ name, version, source }`）、`downloadedAt` 与流程的 `jobId`。平台没有给简介或章节时这两个字段省略，之前的版本导入的素材也没有它们。简介与章节是作者写的参考：读取视频的摘要列出它们，`chapters_adopt` 把章节吸附到转写后写成序列的章节（§3.13）；素材本身不因它们改变。
- 从用户库拷进来的素材，`origin` 为 `library`，`source.library` 记下条目所在的库、条目 ID、版本、内容摘要、名字与种类（架构设计 §5.9）；之后库里的修改与删除不改变这个素材。
- 用户上传的媒体只记录已知的出处；上传不代表拥有第三方素材的全部权利。
- 临时 URL、blob URL、签名地址、浏览器对象和 GPU 句柄不得进入视频格式。
- 生成的素材应在 `source` 里记下任务、供应方、模型、输入输出的摘要与费用；费用未知时写 `unknown`，不从估算伪造实付金额。这些字段的结构，以及派生关系、授权与许可状态，待生成与授权功能加入时确定（§9）。

### 4.6 文档的种类

`kind` 是开放的。下表是已经在用的种类，以及本规范后面的章节计划的种类。

| `kind` | 内容 | 正文的 `schema` | 定义 |
| --- | --- | --- | --- |
| `speech` | 一段录音的转写：词、说话人、句子、章节 | `baocut.speech/1` | §5.2 |
| `translation` | 一种目标语言的译文单元 | `baocut.translation/2`（按 §5.3，新写入一律用它）；`baocut.translation/1`（旧项目导入，只读兼容） | §5.3 |
| `caption` | 一种语言的字幕行 | `baocut.caption/1` | §5.4 |
| `caption-style` | 字幕的样式与布局 | `baocut.legacy-studio-style/0.1`（Studio 样式）；`baocut.boxed-caption-style/<N>`（定位框样式，外部项目导入，`<N>` 是来源格式的版本号） | §5.6 |
| `library-selection` | 视频里启用的用户库条目：每一步的术语表、说话人的音色 | `baocut.library-selection/1` | 见下 |
| `export-record` | 导出过的成片与字幕文件在哪里 | `baocut.export-record/1` | — |
| `import-record` | 这部视频从别的格式导入时的明细 | `baocut.import-record/1` | — |
| `editorial-proposal` | 口播剪辑提案 | 已实现 | §6.2 |
| `cut-set` | 一个源素材上被口播剪辑删掉的区间 | `baocut.cut-set/1` | §6.7 |
| `dubbing-plan` | 配音计划 | 计划 | §7.2 |
| `sound-cue-sheet`、`narration-cue-sheet` | 声音事件表、旁白事件表 | 计划 | §7.9、§7.10 |

- 时间在正文里用整数表示，并写明时间基与时钟：`timescale`（每秒的刻度数）与 `clock`（`source-asset`：这份文档或它的来源文档的 `sourceAssetId` 所指素材的时钟；`sequence`：序列时间）。不用浮点秒。
- 引擎只核对 `baocut.speech/1` 与 `baocut.translation/2` 里 §5.2、§5.3 补充的字段：出现时形状必须对（类型、枚举值与取值范围），引用的词在不在不查；`baocut.cut-set/1` 按 §6.7 的约束整份核对。其余正文不校验。带 `/1` 的几种格式是导入旧项目时定下来的，比 §5 描述的模型简单；二者怎么统一列在 §9。
- `export-record` 与 `import-record` 是这台机器上的记录：正文里有本机路径（成片写到了哪里、旧项目原来在哪里）。它们不参与渲染，也不是任何实例的输入；打包成便携包时不带出去，或去掉路径之后再带（§8）；这两种记录还没有实现，现在正文里有本机路径的文档一律在导出便携包时拒绝（§8.2，架构设计 §14）。
- 读到不认识的 `kind` 或 `schema`：文档头照常显示，正文不解释，写回时保留。
- `library-selection` 记视频启用了用户库里的哪些条目（架构设计 §5.9）：每个视频至多一份，有几份时只认 ID 最小的一份，名字「启用的库条目」。它记条目 ID，不记内容；条目的内容在用到时冻结，记在用到它的文档或任务上（例如译文的 `glossaryRef`，§5.3）。正文：

  ```ts
  interface LibrarySelectionBody {
    schema: 'baocut.library-selection/1';
    glossaries: {
      transcribe: Id[];   // 转写用术语表，按顺序，靠前的优先；最多 20 张
      translate: Id[];    // 翻译用术语表，同上
    };
    speakerVoices: Array<{  // 最多 200 条；同一份转写的同一位说话人只有一条
      documentId: Id;       // 哪份转写（kind: 'speech'）
      speakerId: string;    // 转写里说话人的 ID
      voice: string;        // 'library:<音色 id>'，或 Provider 的音色 ID
      providerId?: string;  // Provider 的音色 ID 只在这个 Provider 上用；library: 音色不给
    }>;
  }
  ```

  读的时候 `schema` 不对就当作什么都没启用，不合的项丢掉；条目在库里删了不改这份文档，用到时跳过并报告。它只经 `library.setVideoSelection` 整份重写（命令与协议规范 §4.1），新建的视频由 Runtime 写入默认启用的术语表。不参与渲染，打包时照常带走（便携包里的条目 ID 在另一台机器的库里可能没有，用到时同样跳过）。

---

## 5. 语音、字幕与翻译文档

本章的文档都按 §4.4 保存：一种文稿一个 `kind`，正文按版本存放，快照里只有文档头。下面的 `SpeechDocumentVersion`、`TranslationDocumentVersion` 等类型描述的是正文的目标模型；字幕在时间线上由字幕实例显示（§3.8）。

### 5.1 五个层次

字幕不是一个 chunks 数组。它分五层，自然译句与显示改写分开保存：

```text
SpeechDocument.words                 词级的文本与源时间
          ├─ Sentence               翻译的语义单元
          │    └─ naturalTranslation 完整的自然译句
          │          ├─ AlignmentBlocks 语义对应
          │          ├─ displayRewrite  必要时的字幕显示改写
          │          └─ DubbingScript   为口语与时长适配的配音脚本
          └─ Source Cue             源语言的展示时间单元
Target Cue                          从目标语言与块边界独立派生
Line                                按字体、画幅与样式排出的行；渲染投影
```

原文与译文的 Cue 数量不要求相同。一个源句可以对应多个目标 Cue。双语画面是两条独立的时间流；界面可以展示句级或块级的对应，但不得伪造逐行一一对应。

### 5.2 SpeechDocument

```ts
interface SpeechWord {
  id: Id;
  text: string;
  sourceSpan: { start: MediaTime; end: MediaTime } | null;
  timingQuality: 'aligned' | 'provider' | 'estimated' | 'missing';
  speakerId?: Id;
}

interface SpeechDocumentVersion {
  id: Id;
  revision: Revision;
  language: string;
  sourceAssetRef: VersionRef;
  words: SpeechWord[];
  structure: { paragraphBreaks: Id[]; chapters: unknown[] };
  userBreaks: Record<Id, 'break' | 'no-break'>;
  autoBreaks: Record<string, Record<Id, 'break' | 'no-break'>>;
  derivationVersion: string;
  rawResultArtifactId: Id;
}
```

- 必须保存可追溯的词 ID、说话人 ID、文本、源时间区间、时间质量和词的来源。
- 原始的识别结果归档为不可变的产物（`rawResultArtifactId`）。人工校正产生新的 SpeechDocument 版本；当前版本是后续计算的文本与时间依据。不能一边改归档，一边在 Cue 里另外藏一份不同的原文。
- 句子由稳定的词锚与结构规则派生。句子的 **ID 与内容指纹分离**：只要句子的文本、词成员或语义边界改变，关联的译句就要做失效判断；不能因为 ID 没变就认为仍然有效。
- 手工添加的标题不需要 SpeechDocument。

**`baocut.speech/1` 的正文**。已落盘的转写正文是下面的形状（与目标模型的差别列在 §9）。时间是整数刻度，单位是 `timescale`，时钟是 `sourceAssetId` 所指的素材（§4.6）：

```ts
interface SpeechBody {
  schema: 'baocut.speech/1';
  clock: 'source-asset';
  timescale: number;                    // 读的时候没有就按 1 000 000
  engine: JsonValue | null;             // 识别引擎的说明，内容开放
  createdAt?: string | null;
  speakers: Array<{ id: Id; name: string; hue?: number | null }>;
  words: Array<{
    id: Id;
    start: number;
    end: number;
    text: string;
    speaker?: Id;
    hidden?: true;
    timingQuality?: 'estimated' | 'missing';   // 没有这个字段表示时间可信
    glue?: true;                                // 与前一个词之间不加空格
  }>;
  sentences: Array<{ id: Id; first: Id; last: Id; paragraphStart?: true } | { id: Id; wordIds: Id[]; paragraphStart?: true }> | null;
  chapters: Array<{ id: Id; title: string; start: number; end: number }>;
  // 以下字段由字幕与翻译核心读写；没有时为空
  userBreaks?: Record<Id, 'break' | 'no-break'>;
  autoBreaks?: Record<Id, Record<Id, 'break' | 'no-break'>>;   // 键是 LayoutProfile 的 ID（§5.6）
  layoutProfileId?: Id;                                          // 没有时是 'default'
  paragraphBreaks?: Id[];
  stages?: {
    asr?: string;
    asrLayout?: string;
    polish?: string;
    segment?: string;
    chapters?: string;
    aligned?: { mode: 'script'; coverage: number; lowConfidence?: Id[] };
  };
}
```

- 词不存词间的空格：拼接时按文字的规则现算（中文、日文不加，拉丁字母之间加，谚文按词加）。`glue` 记住规则答不对的地方，拼接、量宽与断行都认它。转写流程写入的词可能自带前导空格，读的一方照原样处理，不改写。
- `userBreaks` 的键是词：`break` 在这个词之前强制换行，`no-break` 抑制这里的默认断点（§5.5）。`paragraphBreaks` 里的词开始一个新段落，段落边界也是句子的边界。两者引用的词被删掉之后条目留着，不生效。
- `hidden: true` 的词不进文本、句子与字幕，词与时间仍然保留。
- `sentences` 不为 null 时是存下来的句子，导出的双语合并按它配句（§5.3）；译文的句子与原文指纹不读它，一律按 §5.3 的规则从词派生。写回的一方改了词的 ID、顺序、隐藏或分段，就把它清成 null，不留过期的句子。
- 没有说话人的词不写 `speaker`；说话人的 ID 不能是空字符串。`hue` 为 null 与没有这个字段相同。
- `stages` 的含义见 §5.5。`engine` 是开放的：转写流程写 Provider 与模型，旧项目导入写旧格式的引擎对象，或 null；需要「词时间是不是真实对齐的」时，先看 `engine.alignedWords`，没有就看有没有 `estimated` / `missing` 的词。

**与字幕与翻译核心的映射**。字幕与翻译核心（`speech-doc`，架构设计 §7.9）在内存里用 v2 的 `TranscriptDoc`：时间是浮点秒，说话人、换行、分段、隐藏、译文都是按 ID 的表。两边的映射是无损的，规则如下：

- 刻度与秒的互换按 §2.10 的规则。写回时底稿里同一个词或章节的刻度换成秒正好等于新值的，沿用底稿的刻度。
- 素材的事实（ID、本机路径、内容摘要、时长、采样率）取自 `AssetRecord`（§4.1），只读入、不写回。文档头的 `language` 对应 `lang`，没有时是 `und`；语言标签两边原样照抄。
- 没有说话人的词在 `TranscriptDoc` 里归到保留的说话人 `""`，写回时去掉。`userBreaks` 的 `no-break` 对应 v2 的 `nobreak`；`paragraphBreaks` 与 `hidden` 对应 v2 的按 ID 的表，v2 里值为 false 的项与隐藏了不存在的词的项没有对应，写回时丢掉并报告。
- `engine` 读成名字（`name`，没有时 `provider`）、版本与 `alignedWords`；写回时这三项没变就保留底稿的 `engine` 原样，变了写成 `{ name, version?, alignedWords }`。写回的新词与改了时间的词，`alignedWords` 为假时标 `timingQuality: 'estimated'`，否则不标；时间没变的词沿用底稿的标记。
- 底稿里有、`TranscriptDoc` 没有的字段（不认识的字段、`legacy`、`sentences`、`clock`）按 ID 从底稿带回。v2 的 `readOnlyNote` 与格式版本号不写进正文。

**导入的字幕**。导入 SRT 或 VTT 时只有 Cue 级的时间，使用 `ImportedCaptionDocument`，不凭空制造逐词时间：

```ts
// 本规范补全
interface ImportedCaptionDocumentVersion {
  id: Id;
  revision: Revision;
  language: string;
  sourceAssetRef?: VersionRef;         // 对应的媒体素材，如果已知
  cues: Array<{ id: Id; text: string; span: { start: MediaTime; end: MediaTime } }>;
  originalFormat: 'srt' | 'vtt' | 'ass' | 'other';
  rawArtifactId: Id;
}
```

需要逐字高亮时增加对齐任务；没有可信的逐词结果，就降级为普通的整句字幕。

### 5.3 TranslationDocument

每个目标语言有独立的文档版本，保存：源 SpeechDocument 的版本、句子 ID、源内容指纹、完整的自然译句、术语表版本、审阅状态、对齐块，以及可选的显示改写。

```ts
interface TranslationDocumentVersion {
  id: Id;
  revision: Revision;
  language: string;
  sourceBasis: {                        // §5.7
    speechRef: VersionRef;
    sequenceId: Id;
    scopeLineage: Id[];
    editViewHash: string;
  };
  glossaryRef?: GlossaryRef;
  units: TranslationUnit[];
}

// 翻译时用的术语表（架构设计 §7.9）。调用时没给术语、视频里也没启用时没有这个字段。
interface GlossaryRef {
  entries: Array<{                    // 用到的库里的翻译用术语表与冻结的版本
    library: 'glossaries';
    id: Id;
    version: number;
    contentHash: string;              // 'sha256:<hex>'
    name: string;
  }>;
  inline: { contentHash: string; count: number } | null;   // 调用时直接给的术语的摘要与条数
  terms: Array<{                      // 原文里出现过的术语与翻译时的译法；entryId 为 null 是调用时直接给的
    entryId: Id | null;
    source: string;
    target: string;
  }>;
  termsTruncated?: true;              // 出现的术语多于 2000 条、没有记全
}

interface TranslationUnit {
  id: Id;
  sourceSentenceId: Id;
  sourceFingerprint: string;
  naturalText: string;
  displayRewrite?: {
    text: string;
    reason: string;
    reviewed: boolean;
    naturalFingerprint?: string;        // 改写依据的自然译句的指纹
  };
  alignment: {
    basis: 'natural' | 'display-rewrite';
    correspondence: 'block' | 'sentence';
    blocks: AlignmentBlock[];
    sourceWordIds: Id[];
    textHash: string;
    split?: AlignmentSplit;             // 字幕上的显示切分
  } | null;
  status: 'draft' | 'reviewed' | 'stale';
}

// 本规范补全
interface AlignmentBlock {
  id: Id;
  sourceWordRange: { firstWordId: Id; lastWordId: Id };   // 连续的词区间
  targetTextRange: { start: number; end: number };        // Unicode code point 索引，右开
  confidence?: number;                  // 0–1，支撑两侧边界的对齐边的最小权重；没有时未知或确定性构造
  flags?: string[];                     // 'local-reorder'（块内有交叉）、'anchor'（含硬锚）、'weak'（只有软边）等
}

interface AlignmentSplit {
  mode: 'independent' | 'many-to-one' | 'one-to-one';
  wordAnchored: boolean;
  correspondence?: 'block' | 'sentence';   // 写入方明写的粒度；没有时由 mode 推出
  aligner?: string;                        // 对齐边的来源，如 'deterministic/1'
  pieces: Array<{ text: string; from?: number; to?: number }>;   // 非空；from ≤ to
  legacy?: { crossing?: true; cueIds?: Id[] };                  // 旧项目留下的，只为无损导入保存
}
```

- 对齐块在源侧覆盖连续的词区间，在目标侧覆盖连续的文本区间；块与块之间单调，块内允许多对多。
- 展示上的切分只能落在块的边界上。语序交叉时优先合并块；确实存在显示预算问题时才提出 `displayRewrite`，它不得覆盖 `naturalText`。
- 缺少对齐时允许明确的句级降级（`correspondence: 'sentence'`）；不允许输出虚假的逐词同步。没有块的句级对齐写成 `{ basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: <源句的可见词>, textHash }`；智能体经 `edits_apply` 写入的单元 `alignment` 为 null 时，Runtime 按源句补成这样（架构设计 §3.5）。
- 字符区间用 Unicode code point 索引，禁止在 grapheme cluster 内部切分。界面的 UTF-16 偏移必须经过转换。
- 中文不假设空格等于词边界。标点与空格的规范化规则必须版本化，并由引擎共享。
- 对齐块表达语义对应，不等于目标语言实际的发音时间。
- `textHash` 是 `'sha256:' +` 自然译句 UTF-8 字节的 sha256（小写十六进制）。`targetTextRange` 有 `split` 时指各片文本按顺序拼起来的串，没有时指 `basis` 所指的文本（自然译句或显示改写）；片的拼接与它规范化之后相同，不要求逐字相同。块的 ID 在单元内唯一，写入方新造的块按顺序编为 `b1`、`b2`……
- `split` 记字幕上怎么把这句译文切成几片显示。`independent`：译文按目标语自己的习惯切，不与源词对应；`many-to-one`：每片对应一段连续的源词，`from`、`to` 是闭区间的下标；`one-to-one` 只出现在旧项目里，按整句对应读。`wordAnchored` 为真时，片的下标与块的源侧都指 `sourceWordIds`，那是对齐时句子的可见词（时间线剪过之后是剩下的子序列）；为假时片的下标指源句现在的可见词。没有明写 `correspondence` 时，`legacy.crossing`、`independent` 与没有词锚的片只按整句对应，其余按块对应；推出的值就是 `alignment.correspondence`。片的拼接与 `basis` 所指的文本规范化之后不同、或片的边界不落在块的边界上时，切分过期，显示降级为整句。
- `sourceFingerprint` 是字幕与翻译核心的内容指纹 `<词数>:<首词 ID>:<末词 ID>:<摘要>`（词数与首末词只算可见的词，摘要是句内可见词文本的 FNV-1a，36 进制）。空字符串表示没有记下指纹，不算过期；别的写法当作原句改过。
- `displayRewrite.naturalFingerprint` 是写改写时自然译句的指纹；自然译句的指纹与它不符，改写就过期（删掉改写与这句的切分）。没有这个字段时按过期处理。
- 与字幕与翻译核心的映射（§5.2）：一份译文对应 `TranscriptDoc` 的一种语言，`naturalText`、`displayRewrite`（`reason` 对应 v2 的 `basis`）、`split` 连同块、`sourceFingerprint` 分别对应 v2 按句子 ID 的 `trans`、`transDisplay`、`transAlign`、`transSrc`；`/1` 的译文不能换算。`status: 'stale'` 在 v2 里写成 `transSrc` 的 `stale:<sourceFingerprint>`，它不等于任何真实指纹，核心因此把这句当作原文改过；写回时去掉前缀、恢复 `stale`。写回时单元的 ID、`reviewed`、`status`、扩展字段从底稿按句子 ID 带回：译句与改写都没变的单元沿用底稿的状态，变了的是 `draft`。v2 没有切分的句子，底稿的对齐没有 `split` 时照用（译句变了只更新 `textHash`），底稿是 null 时仍是 null，其余写句级降级记录，`sourceWordIds` 取底稿的，没有底稿时取核心派生的源句的可见词。新单元的 ID 是 `t-<句子 ID>`，按首词的位置插进底稿的单元之间。新语言的 `sourceBasis` 由调用方给。
- 正文的 `schema` 为 `baocut.translation/2` 时，字段严格是上面的 `TranslationDocumentVersion`，除了上面标为可选的字段不多不少；`id` 与 `revision` 由文档记录给出，正文里不重复。整份转写一起翻译时 `sourceBasis.scopeLineage` 为空。源 SpeechDocument 的句子按字幕与翻译核心的规则从词得出（`speech-doc/sentences`，不读存下的 `sentences`）：句末标点之后断句，分号不算句末；停顿不少于 1.8 秒、换了说话人、句内满 80 个词、分段与章节的边界也断句；隐藏的词不进句子，句子 ID 是 `s-<首词 ID>`。`sourceFingerprint` 见上，`editViewHash` 是 `'sha256:' +` 派生规则的名字与全部句子的 ID、指纹的摘要。写译文的 Worker、核对译文的 Runtime 与界面用同一份实现（架构设计 §7.9）。没有对齐块时用句级降级。
- **源文稿换版本时的结转**。视频换用一份新转写的文稿（换用文稿，架构设计 §6.6）时，新文稿的词全是新 ID，句子 ID（`s-<首词 ID>`）与指纹随之全换，旧单元的 ID、`sourceFingerprint`、对齐块与 `sourceWordIds` 都失效。每种语言在换用的同一笔事务里写一份新的 TranslationDocumentVersion：同一份文档、新版本，`sourceBasis.speechRef` 指向新的文稿版本，`editViewHash` 按新句子重算，`glossaryRef` 原样带过去。单元按下面的规则产生：
  - **配对**。按素材时钟配。一句的时间区间是它首个可见词的起点到末个可见词的终点，旧句与新句相同。与旧句区间重叠的新句是它的候选；在全部候选对里先配重叠最长的一对，配上的两句不再参与，依次往下，所以一旧句只配一新句、一新句只配一旧句。重叠不到两句中较短那句时长的一半不算配上。按章或按范围局部重跑时只在范围内配：范围外的词 ID 不变，句子与单元原样带到新版本。
  - **规范化文本**。比较原文时取句子可见词拼成的文本，去掉标点与空白，做 NFKC，再做大小写折叠。
  - **配上、规范化原文相同**。保留 `naturalText`、`displayRewrite` 与 `status`（`reviewed` 仍是 `reviewed`，`draft` 仍是 `draft`）；对齐降为句级 `{ basis, correspondence: 'sentence', blocks: [], sourceWordIds: <新句的可见词>, textHash }`，`basis` 沿用，去掉 `split`；`sourceSentenceId`、`sourceFingerprint` 换成新句的，单元 ID 按上面的规则是 `t-<新句 ID>`。
  - **配上、原文变了**。保留 `naturalText` 给人参考，去掉 `displayRewrite` 与 `split`，`status: 'stale'`；对齐同样降为句级，ID 与指纹换成新句的。
  - **新句没配上**。新单元 `t-<新句 ID>`，`naturalText` 为空字符串，`status: 'stale'`，对齐降为句级。
  - **旧句没配上**。不结转；它留在旧版本里，撤销换用就回来。
  - 结转不调用模型。过期的单元由「刷新过期译文」重译（产品设计 §5.10）。
- 旧项目导入的译文是 `baocut.translation/1`：`{ schema, sourceLanguage, units: [{ id, text, display?, source?, alignment? }] }`，单元的 `id` 就是源 SpeechDocument 的句子 ID，`display` 是字幕显示用的改写，`source` 与 `alignment` 原样保留旧项目的指纹与对齐（格式与 §5.3 的指纹、对齐块不同，不能换算）。它只为已经导入的视频读取：导出的双语合并认它（按句子 ID 配，成员取 SpeechDocument 的句子），新写入的译文一律是 `/2`。
- 导出的双语合并读 `/2` 时按 `sourceSentenceId` 配到主文档的句子，译文取 `displayRewrite.text`，没有时取 `naturalText`；句子的成员取 `alignment.sourceWordIds`，剪剩的词与它不完全相同时不配；`alignment` 为 null 的单元，成员取按上面的规则从源 SpeechDocument 的词得出的、ID 为 `sourceSentenceId` 的那一句的可见词，`sourceFingerprint` 不为空又与那一句的指纹不同时按过期处理、不写出（派生要 `editor-wasm`，没有构建时导出失败，不悄悄少写译文）。源 SpeechDocument 没有句子时，导出按这些成员切句（与翻译时得出的句子相同）。`status: 'stale'` 的单元不写出。给没有 Worker 字幕条的译文建字幕层时同样按 `alignment.sourceWordIds` 取原句成员词的时间，有 `alignment` 为 null 的单元时不建。
- 术语表改了之后的过期：`glossaryRef.terms` 记下了每条出现过的术语当时的译法。单元的原文里出现的术语，按 `entries` 里那张表在库里的当前版本，译法变了、被删了，或那张表新加的术语出现在这句里，这个单元就因术语表过期（`glossary-changed`）；整张表删了时，含它的术语的单元都过期。只看术语出现的单元，别的单元不受影响；`inline` 的术语不受库的影响。过期是读的时候算出来的（翻译配音核对译文时，§7.2），不改写这份文档的 `status`。
- 文档头的 `sourceDocumentId` 指向源 SpeechDocument；由固定流程写入时，文档的 `extensions.engine` 记录 Provider、模型、模型版本与提示词版本，`extensions.pipeline` 记录流程、任务与执行主体。

### 5.4 CaptionProgram

CaptionProgram 是显示规则，不是另一份原文。

```ts
interface CaptionProgram {
  id: Id;
  revision: Revision;
  sequenceId: Id;
  source: {
    speechRef?: VersionRef;
    translationRef?: VersionRef;
    importedCaptionRef?: VersionRef;
  };
  language: string;
  scope: { itemIds: Id[] };              // 明确作用于哪些素材实例，不按同名文件猜测
  timingBasis: 'source-speech' | 'dubbing-audio' | 'imported-cues';
  layoutProfileId: Id;
  styleRef: VersionRef;
  userOverrides: CaptionOverride[];
}
```

**投影**。字幕解析器把「源词时间 → 指定素材实例的 timeMap → 序列时间」投影成 `ResolvedCaptionCue[]`。解析结果是派生缓存，不能与源词同时被独立修改。文档编辑、实例拆分、裁切、变速都经过事务更新引用，然后重新投影。

**occurrence**。同一素材被重复使用时，一个词可以产生多个展示 occurrence。每个 occurrence 由 `sourceWordId + itemLineage + occurrenceId` 标识，不能只用 `wordId`。拆分之后维护 lineage 映射；禁止把字幕自动挂到另一个恰好引用同一媒体的片段上。

**显示采样**。解析器先得到精确的序列区间，再按当前预览或导出的真实采样时刻判断 Cue 是否可见。改变导出帧率只改变显示采样，不产生新的语音或译文版本。

### 5.5 手工修改与显示覆盖

| 用户做了什么 | 写到哪里 |
| --- | --- |
| 改错字 | SpeechDocument 的新版本 |
| 改自然译句 | TranslationDocument |
| 改换行 | 用户 pin（`userBreaks` 或 `CaptionOverride`） |
| 拖动字幕的时间 | 有范围的 timing override |

```ts
// 本规范补全
interface CaptionOverride {
  id: Id;
  kind: 'line-break' | 'timing' | 'text-display' | 'hide';
  anchor:
    | { kind: 'source-word'; wordId: Id; occurrenceId?: Id }
    | { kind: 'item-local'; itemId: Id; localOffset: MediaTime }
    | { kind: 'sequence-fixed'; sequenceId: Id; span: FrameSpan };
  value: JsonValue;
  pinned: true;
}
```

- 用户 pin 的优先级高于自动排版。自动优化不能冲掉手工修改的边界。
- 每个 override 必须声明锚点。源词被剪掉时显示为 `orphaned`，默认不再输出；不得静默地跑到 0 秒。
- `sequence-fixed` 的字幕不随口播的波纹移动；界面用「固定时间」的标记提醒。
- 换用文稿（§5.3「源文稿换版本时的结转」）时 pin 在同一笔事务里按时间重锚：`source-word` 锚着的旧词，取它源时间区间的中点，落在哪个新词的区间里、且两词的规范化文本（§5.3）相同，就改锚到那个新词；否则这个 override 是 `orphaned`。旧词没有源时间时锚不上。转写正文的 `userBreaks` 与 `paragraphBreaks` 引用的词按同样的规则换成新词，换不上的条目留着、不生效（§5.2）。`item-local` 与 `sequence-fixed` 锚不随文稿变，不动。
- 转写正文的 `stages`（§5.2）记各自动步骤提交时的指纹，是「之后有没有人工修改」的依据：`asr`、`polish`、`chapters` 是转写完成、润色提交、章节提交时全文的内容指纹，`asrLayout` 是转写完成时换行、分段与隐藏的指纹，`segment` 是分段提交时词 ID 序列的指纹；当前的指纹与之不符，就说明之后有人改过，自动步骤不覆盖这部分。`aligned` 表示词时间来自文稿强制对齐（`coverage` 是对齐上的字符占文稿的比例，`lowConfidence` 是时长塌成 0、需要复核的词），重新识别时去掉。指纹的写法由写它的一方决定，读的一方只比较相等。

### 5.6 LayoutProfile、样式与导出

```ts
// 本规范补全
interface LayoutProfile {
  id: Id;
  language: string;
  maxLines: number;
  readingBudget: { soft: number; hard: number; unit: 'cps' | 'cpl' | 'wpm' };
  minDuration: MediaTime;
  maxDuration: MediaTime;
  safeArea: { left: number; top: number; right: number; bottom: number };   // 归一化
  breakRules: string[];
}

interface CaptionStyleBody {
  // 目标合同 `baocut.caption-style/1`：七个彼此独立的维度各取一个值，预设只是取值。
  // 维度定义、当前词模式（含 KTV 扫色）、倒鸭子的 `layout.sequence` 与到 Studio 样式的编译
  // 见 docs/design/subtitle/caption-style-model-design.md。
  schema: 'baocut.caption-style/1';
  typography: Typography;          // 字体、字重、字号（占短边比例）、行高、字距、大小写、对齐
  surface: Surface;                // 字色、描边、阴影、发光、底板、逐词底块
  layout: Layout;                  // mode 'line' | 'sequence'（倒鸭子）、锚点、y、宽、行数
  activeWord: ActiveWord;          // 必填：none | color | box | scale | lift | underline | sweep，
                                   // 外加念过 / 没念到的词的三态；无词时间的轨恒 none
  motion?: Motion;                 // 入场 / 退场 / 循环，trigger 'enter' | 'spoken'
  emphasis?: EmphasisLook;         // 强调词的外观；哪些词是强调词记在实例上（§3.8）
  preset?: { id: Id; revision: Revision };
}
```

- LayoutProfile 的数值是产品预设，不冒称某个平台现行的强制标准。预览、字幕列表、检查与导出使用同一个 profile。
- 源字幕的自动排版结果按 profile 分开保存：转写正文的 `autoBreaks[<profile ID>]`（§5.2），换一个 profile 不冲掉另一个的结果；当前用哪个 profile 记在 `layoutProfileId`，没有时是 `default`。同一个词上用户的 `userBreaks` 优先于自动的 pin。
- 样式与文字内容分开。改样式不重新识别；改源语言的换行不引起全文重译；改一句英文的显示文本不会自动下单整片的语音合成。
- 输出支持烧录、SRT 与 VTT；ASS 在 P1 以格式能力映射实现。只导出字幕文件不触发视频重编码。
- 烧录字幕必然是对画面的合成，不能描述为「不改视频码流」。
- 原片中已经烧录的字幕位于源像素里，只关闭新的字幕层不会让它消失；覆盖、重构或修复必须声明新操作的性质。
- 没有可信词时间的导入字幕可以作为普通字幕，不输出伪精确的逐词动画。

**已落盘的样式正文**。`CaptionStyleBody` 还没有落盘，落盘时由一层确定的编译折成 Studio 样式（设计稿 §8），内核不换；现在字幕样式文档的正文是下面两种之一，渲染内核都读：

- Studio 样式（`baocut.legacy-studio-style/0.1`）：`style` 是 v2 的字幕样式，逐词动画写在 `style.wordAnimation`（或 `style.anim`）里，`catalogId` 指逐词动画目录的一格。
- 定位框样式（`baocut.boxed-caption-style/<N>`）：`canvas` 是样式所在画布的像素尺寸，`box` 是字幕框（相对画布中心的像素），`style` 是字号、颜色、对齐、底板等外观；渲染时换算成等价的 Studio 样式。`style.animationPresetId` 选逐词动画，取值是目录的 id，按那一格画，与 Studio 样式选中同一格相同；省略表示不动画。
- 逐词动画目录有 19 格：`none`、`boxHighlight`、`flipClock`、`highlight`、`karaoke`、`impact`、`reveal`、`floatInTop`、`floatInBottom`、`scaleIn`、`dropIn`、`impactPop`、`colourHighlight`、`rotateFlipClock`、`rotateHighlight`、`stack`、`stomp`、`bounce`、`paint`。`reveal` 是逐字显现：没念到的词不画，念到一个就整个显出来。句子没有词时先应用显示间距，再按 §3.8 的空白切分推算；补间距后仍不带空格的一句是一个词、开头就整句显出来。
- 引擎写入定位框样式时核对：`style` 是对象，`style.animationPresetId` 出现时是目录里的 id，否则拒绝整份文档（`INVALID_OPERATION`）。Studio 样式的正文不核对；内核遇到认不出的 `catalogId` 按动画名画。

**显示间距**。预览与烧录在汉字、假名与 ASCII 字母数字直接相邻处补一个半角空格（如 `让Claude创建Artifact` → `让 Claude 创建 Artifact`）。原文、译文与导入字幕共用这条规则，不依赖语言标签、样式种类或 `punct` 开关；已有空白与换行保留，标点旁不额外补空格。按空格、LF、CR 分片，含谚文的片段以及路径、URL 沿用 v2 的保护规则，原样保留间距（如 `AI가`、`2박`、`600원`）；其他片段照常补间距。该投影不修改字幕正文、转写词 ID、词时刻、译文对齐范围或导出的 SRT、VTT。

**默认预设**。没有样式文档的字幕实例按默认预设画；新建字幕层时种下的 Studio 样式（编辑器里第一次改样式或套用画廊里的卡、把译文双语放上画面，智能体与固定流程建双语字幕层）也是这一份。它是新建项目的「经典」涂装加一个开关，不分语言：

- 白字、`fontWeight` 700，黑色描边 `textOutline: { on: true, color: '#000000', width: 14 }`（`width` 按字号的比例换算成笔宽，描边随字号缩放），黑色投影 `dropShadow: { on: true, distance: 0.08, rotation: 45, blur: 0.12, opacity: 0.9 }`；底板关着（`background: false`）。浅色画面上靠描边与投影看清。当前词变色 `wordAnimation: { animationId: 'magic-wbw', animationName: 'Color', catalogId: 'colourHighlight', active: { color: '#18E1D6' } }`（画廊里「经典」卡自带的当前词样式，[字幕样式模型设计](../design/subtitle/caption-style-model-design.md) §4），没有词时间的行照常整行画。
- `punct: true`：普通逗号、句号在烧录与预览里换成一个空格（数字、网址这类 ASCII 写法里的不换），只有标点的一句不画。Studio 样式的 `punct` 缺省（没写）也是 true；用户在属性页的「标点」里切换为 false 时照原文画。该投影不修改转写正文或导出的 SRT、VTT。界面新建字幕时可以用用户记住的属性覆盖预设（产品设计 §5.9）。
- 有样式文档时照它画，没写的键按内核的兜底（无描边、`punct` 为 true），不拿默认预设去补；已有项目里正文为空的样式文档（`style: {}`）因此画法不变。

**结果校验**。翻译任务返回缺句、重复 ID、漏数字或术语冲突时，只接受通过合同校验的部分，不无条件覆盖。术语按「任务覆盖 → 视频设置 → 显式共享的设置」的顺序解析，并显示来源。

### 5.7 EditedSpeechView

原始的 SpeechDocument 描述完整的源录音，不因为时间线上删掉一个片段就抹掉其中的词。

`EditedSpeechView` 是从当前序列的保留范围、timeMap 和 occurrence 派生出来的有效词流。它不是另一份可以随意改时间的转录。

| 情况 | 结果 |
| --- | --- |
| 源句完整保留，只是整体移动 | 自然译文可以复用；字幕时间重新投影 |
| 只保留源句的一部分、改变句序、或重复使用片段 | 为有效的句子与 occurrence 计算新的语义指纹 |

`TranslationUnit.sourceFingerprint` 绑定的是这份**有效句**，而不只是原始文档的版本。文档头记录 `sourceBasis`：`speechRef`、`sequenceId`、scope lineage 和 `editViewHash`。

已有的整句译文可以保留给其他实例使用，但不能不加检查地用于被剪成半句的输出。没有可用时间的词（时长为零、或没有文字）本来就进不了字幕与导出，它们缺席不算剪成半句，不妨碍配整句的译文；隐藏的词才算剪掉。配音脚本与语义图表的锚点同样绑定有效视图。纯粹的时间位移与实际的内容改变触发不同的失效范围（架构设计 §10）。

---

## 6. 口播剪辑

### 6.1 约束

- 建议可以逐条接受或忽略；在文稿中的选择对应到时间线；删除可以恢复；每一步都可以撤销。
- 智能体判断语义；切点、呼吸垫、量化和音画同步由引擎计算。
- 字幕翻译与语义剪辑建议的任务优先接收词与句的 ID 和文本。不让模型自由编造精确的时间戳。

### 6.2 EditorialProposal

剪辑提案是文档 `kind: 'editorial-proposal'`，`sourceAssetId` 指向被剪的素材，每个源素材至多一份。正文：

```ts
interface EditorialProposalBody {
  schema: 'baocut.editorial-proposal/1';
  timescale: number;                      // 每秒的刻度数
  clock: 'source-asset';                  // 时刻在被剪素材的时钟上
  speechRef: VersionRef;                  // 检测读的转写版本
  suggestions: Array<{                    // 按 t0 排序，可以互相重叠
    id: Id;
    kind: 'filler' | 'pause';
    t0: string;                           // 建议剪掉的源区间 [t0, t1)，整数刻度写成十进制字符串
    t1: string;
    wordIds?: Id[];                       // 口癖：区间里的词
    afterWordId?: Id;                     // 停顿：停顿之前的词
    text: string;                         // 区间里的文字；停顿为空
    reason: string;                       // 检测器写的短句，原样展示
    detail?: string;
    confidence?: number;                  // 0–1，检测器给不出时没有
    status: 'pending' | 'accepted';
  }>;
}
```

- 已定：提案只记建议剪掉的源区间、类别、对应的文字与置信度，是这里的最小形状；`putDocument` 写入时核对刻度、`0 ≤ t0 < t1`、排序、`confidence` 的范围与 ID 不重复。
- 已定：`proposeCuts` 按源素材的转写检测口癖与长停顿，沿用 v2 的检测（`timeline::detect`）与缺省参数：停顿 0.8 秒以上、3 秒以下，压缩到 0.3 秒（句末多留 0.1 秒，至多 0.5 秒），跨章节的停顿缺省不动；口癖按中英文的表，含只在断句处才算的软口癖。隐藏的词、没有时间的词不参与；已经整个落在剪口里的、超出素材时长的不提出。建议的 ID 由所在的词决定，重新提出时不变。再提出时整份替换，不改时间线。v2 没有重复片段与说错重来的检测，这两类不提出。
- 已定：`acceptCutSuggestions` 把接受的建议编译成剪口（同 `addCuts`，§6.7，剪口的 `ref` 是建议的 ID），并把它们标成 `accepted`，**用一笔事务提交**，撤销时一起回去。与已有剪口间隔不超过 0.02 秒的照 §6.7 并成一个，保留靠前那个的 ID 与出处，所以被并进去的建议不出现在剪口的 `ref` 里。
- 已定：转写在提出建议之后改过（当前版本不是 `speechRef`）时建议过期，接受时整笔拒绝（`details.rule: 'proposal-stale'`），须重新提出。恢复剪口不改提案里的状态；剪口集合才是剪掉了什么的依据。
- 剪辑建议不是视频的时间线。接受建议时，编译得到确定的剪切集合与普通的视频、音频实例变更，**用一笔事务提交**。
- EDL 用于交换与审阅，可以从当前的实例导出。首版不允许同时维护一份会自动覆盖界面时间线的、长期可写的 EDL。
- 建议记录保留理由与影响区间。之后手工改过片段，旧建议必须按最新的实例与 readSet 重新验证。
- 恢复已剪掉的内容是新的事务；不能拿一份旧的时间线快照覆盖后来添加的元素。

### 6.3 切点

模型指出「删这个口头禅」之后，引擎根据可信的词时间、VAD 与能量分析、上下文和可用的静音区选择切点。相邻的词连读、没有安全边界时，建议标记为「不推荐自动切」，而不是硬切。

- 视频默认硬切。音频可以在保留区间的内部做短的淡出与淡入。
- 需要重叠的 crossfade 时，必须显式使用 handles，并检查是否把已删除的词重新带了进来。
- 不假定视觉 dissolve、音频 crossfade 与 EDL 的保留时长天然等价。
- 音频的消爆淡化不隐式改变视觉总长。

### 6.4 波纹与语义依附

附属元素按 §3.16 的 `FollowPolicy` 决定是否随剪辑移动；按时刻放置的附属实例缺省 `follow-cuts`。剪辑命令必须声明受影响的轨道集合与锁定轨道的处理方式。

### 6.5 风险分级

明显的静音与观点的删改，风险不同。连读边界、否定词、单位词和前提条件必须经过审阅，不能只按字符串命中自动删除。批量接受时显示类别、数量、范围、锁定轨道的处理和语义影响。

文稿面板的模式（产品设计 §5.7）决定删除键的含义：只有「剪辑音画」模式才对词锚提出或执行剪辑。切换模式不会让一个旧的选区偷偷改变操作的含义。

### 6.6 复算例

12 秒、30 fps 的片段，删除源 [4, 6) 秒。

- 剩余的 [0, 4) 与 [6, 12) 拼成 10 秒：源 [0, 4) 位于视频 [0, 4)，源 [6, 12) 位于视频 [4, 10)。
- 源 [8.2, 9.0) 的字幕 occurrence 投影到视频 [6.2, 7.0)，对应帧 [186, 210)。
- 恢复剪辑产生新的事务，不从旧快照里抹去后来添加的补充画面。

### 6.7 剪口集合

口播剪辑删掉的区间记在一份剪口集合里，供逐条恢复与重新验证。时间线上仍是普通的实例：剪口集合说明哪些源区间被删了，实例的排布是它的结果。

```ts
// 文档 kind: 'cut-set'（§4.6），文档头的 sourceAssetId 指向被剪的源素材
interface CutSetBody {
  schema: 'baocut.cut-set/1';
  timescale: number;                   // 每秒的刻度数
  clock: 'source-asset';               // 时刻在被剪素材的时钟上
  scopeItemIds: Id[];                  // 按这份剪口排布的实例：源素材在序列上的视频、音频实例
  cuts: Cut[];                         // 按 t0 排序，互不重叠
}

interface Cut {
  id: Id;
  t0: string;                          // 删掉的源区间 [t0, t1)，整数刻度；0 ≤ t0 < t1 ≤ 素材时长
  t1: string;
  ref?: Id;                            // 出处：EditorialProposal 里一条建议的 ID（§6.2）
}
```

- 一个源素材至多一份剪口集合。
- **加入剪口**。新的剪口与已有的剪口间隔不超过 0.02 秒时并成一个，保留靠前那个的 ID 与出处。拖动一个剪口的边界不合并，只要求不与其他剪口重叠（贴边允许）。
- **应用与恢复**都是 VideoEngine 的事务：同一笔事务改剪口集合，并按新的保留区间重排 `scopeItemIds` 里的实例；附属实例按各自的 `FollowPolicy` 移动（§3.16，按时刻放置的缺省 `follow-cuts`）。恢复一个剪口是新的事务，不从旧快照里覆盖后来的修改。
- **范围**。剪口集合的实例是 `scopeItemIds` 里的实例与 lineage 指回它们的实例（拆出来的右段）；一个都不在序列上时，取序列上播放这个素材的全部视频、音频实例。它们的源时钟须是正速率的线性映射，否则整笔拒绝。写回时 `scopeItemIds` 是重排之后的实例，按序列起点、再按 ID 排。
- **重排**。这次新删掉的源区间经每个实例映射到序列上，起止各自量化到最近的帧，不足一帧的不动；同一条轨道上重叠的并成一段。产生这段区间的轨道是**被剪的轨道**，在它们上按 §6.4 波纹删除（盖住区间的拆开删掉中间，之后的前移）；其余轨道上的实例按 `FollowPolicy` 移动。同步放置的音画映射成同一段区间；不同轨道上的区间部分重叠时整笔拒绝（`INVALID_OPERATION`，`details.rule: 'scope-misaligned'`）。随剪口删掉的实例列在回执的 `impact.removedByCuts`。
- **章节跟着剪口**。已定：应用剪口时，序列的章节按这次拿掉的各段区间（重排之前的帧）移动：段后的章前移拿掉的长度，落在段里的回到段首；几章落到同一帧时只留原来起点最晚的那一章，其余删掉（它们整章都被剪掉了）。恢复剪口时，接缝之后的章后移放回的长度；正在接缝上的章不动——它可能是被剪掉开头的那一章，也可能是剪口之后挪到接缝上的那一章，引擎分不出来，留在原地不会让序列开头空出一段没有章。找不到接缝时章节不动。章节不受锁定影响（§3.13）。
- **恢复的接缝**。左边实例的源终点对着剪口起点、同一条轨道上紧接着的右边实例的源起点对着剪口终点时（各容差一帧，换到源时钟上），在接缝处放回两者之间的源区间：被剪的轨道上从接缝开始的实例后移，左边实例延长，两段按 `joinItems` 的规则能合并时接回一段，否则留成两段。只有左边时实例往后延长到剪口终点，只有右边时往前延长到剪口起点。同一处接缝在不同轨道上要放回的长度不同时整笔拒绝（`scope-misaligned`）。找不到接缝时只改剪口集合，剪口列在回执的 `impact.cutsNotRelaid`，实例不动。
- 轨道或要动的实例锁着时整笔拒绝（`TARGET_LOCKED`），不跳过。
- **重新验证**。实例在剪口之外被手工改过（裁切、移动、换素材）时，与剪口集合不一致的部分在回执里列出，由用户或智能体决定重新应用还是删掉对应的剪口；引擎不悄悄改回。
- 接受剪辑建议（§6.2）时写入的剪口带 `ref`；建议被忽略或恢复时按 `ref` 找到对应的剪口。
- 秒形式的输入（v2 的 `t0`、`t1`）按最短的十进制写法读成精确有理数，再换到 `timescale` 上；`timescale` 取能精确表示全部剪口的值，不舍入。

字段来源：`schema.rs` 的 `Cut`；`cuts.rs` 的 `CutSet`、`CUT_MERGE_GAP`、`insert_cut`、`restore_cut`、`retime_cut`；章节的移动见 `crates/video-engine/src/chapters.rs` 的 `close_spans`、`open_gap`。

---

## 7. 配音、版本与声音事件

### 7.1 三种文本分别保存

| 文本 | 负责什么 |
| --- | --- |
| `naturalTranslation` | 语义完整 |
| `subtitleDisplayRewrite` | 屏幕展示 |
| `dubbingScript` | 说出口、语气与时长 |

三者指向同一个来源句，互不覆盖。用户改英文字幕不必无条件购买一轮语音合成；用户明确要求「同步配音」时才产生任务提案。

### 7.2 DubbingPlan

```ts
interface DubbingUnit {
  id: Id;
  sourceSentenceIds: Id[];
  sourceFingerprint: string;
  script: { text: string; revision: Revision; reviewed: boolean };
  speakerBindingId: Id | null;
  targetAnchor: SemanticAnchor;
  timingPolicy: 'fit-fixed-slot' | 'ripple-visuals' | 'manual';
  voiceAssetRef?: VersionRef;
  alignmentRef?: VersionRef;
  actualSamples?: string;
  sampleRate?: number;
  status: 'draft' | 'generating' | 'ready' | 'needs-fit' | 'stale' | 'failed';
}

interface DubbingPlan {
  id: Id;
  revision: Revision;
  sequenceId: Id;
  language: string;
  translationRef: VersionRef;
  units: DubbingUnit[];
  originalDialoguePolicy: 'mute' | 'duck' | 'keep';
  backgroundPolicy: 'existing-stems' | 'separate-stems' | 'replace' | 'none';
}
```

- 语音合成返回的**真实采样长度**才是音频时长的依据。
- 字幕的逐词时间来自生成音频的时间标记，或对生成音频再做一次强制对齐；不得套用源语言的词时间。
- 对配音做 time-stretch 时，字幕对齐必须经过相同的映射。

**翻译配音写下的配音计划**（架构设计 §7.9）。文档种类 `dubbing-plan`，正文的 `schema` 是 `baocut.dubbing-plan/1`。`id` 与 `revision` 是文档记录的，不在正文里。与上面的接口相比：

- 计划多两个字段：`groupId`，即这一组配音的 ID，与实例上的相同；`extensions['baocut.dub']`，包括合成用的 `voice { providerId, modelId, voice }`（参数的或模型默认的音色，没有绑定的说话人用它）、各说话人用的音色 `speakers[] { speakerId, voice, voiceSource, available, units }`（`speakerId` 为 null 是没有说话人的句子；`voiceSource`：`video` 视频里的绑定、`params` 参数、`default` 模型默认），以及这次才静音的实例 `mutedItemIds`（原声静音时的原句实例，或分离过时换成两轨的原句实例；之前已经静音的不算）。`translationRef` 是用的那份译文与版本。`backgroundPolicy` 是 `separate-stems`（分离过）或 `none`。
- 每个译文单元一个配音单元，`id` 是 `d-<译文单元 ID>`。`sourceSentenceIds` 只有一句。`script` 是译文与译文的版本，`reviewed: false`；过期的单元 `script: null`。`speakerBindingId` 是这句用了视频里的说话人绑定（`library-selection` 的 `speakerVoices`，§4.6）时那位说话人的 ID，用参数或默认音色的句子与过期的单元是 `null`。`targetAnchor` 是原句的开头（`kind: 'sentence'`、`edge: 'start'`）。`timingPolicy` 总是 `fit-fixed-slot`。
- 换用文稿结转译文（§5.3）时，配音计划在同一笔事务里写新版本，`translationRef` 指向结转出的译文版本。原文相同、译句不变的单元换到新 ID `d-<新译文单元 ID>`，`sourceSentenceIds`、`sourceFingerprint`、`targetAnchor`、`extensions['baocut.dub'].translationUnitId` 与配音实例扩展里的 `unitId` 换成新句与新单元的，音频、实例与其余字段保留；`script.revision` 仍是合成时用的译文版本，与计划的 `translationRef` 不同，界面据此提示可能不一致（与改译文时同一种提示，产品设计 §5.7），不自动重新合成。原文变了、译文因此过期的单元 `status: 'stale'`、`script: null`，`staleReason: 'source-changed'`，已放上的音频实例留在时间线上。旧句没配上的单元与译文一样不结转。
- `actualSamples` 与 `sampleRate` 只写在放上时间线的单元上，是第一次出现的那段音频的实测值。`voiceAssetRef` 与 `alignmentRef` 不写：音频从实例找到，合成的产物 ID 在单元的扩展里。
- `status` 只用五种：`ready`（放上了）、`needs-fit`（加速到上限、占用之后的静音仍放不下）、`draft`（原句不在时间线上）、`stale`（译文过期：没有合成，或换用文稿之前合成过、音频已不代表现在的译文）、`failed`（说话人绑定的音色不可用，没有合成，也没有换成别的音色）。
- 单元的 `extensions['baocut.dub']`：`translationUnitId`；没有过期的单元有 `voice`（这句用的音色：`library:<id>` 或 Provider 的音色 ID）与 `voiceSource`；放上时有 `fit`（`fit`、`tempo`、`extended`）、`tempo` 与 `artifactId`；放不下时有 `overflowSeconds`；不在时间线上时有 `offTimeline: true`；音色不可用时有 `voiceUnavailable { speakerId, voice, code, reason }`（`code` 如 `VOICE_CLONE_REQUIRED`、`VOICE_CONSENT_REQUIRED`、`VOICE_NOT_FOUND`，`reason` 如 `missing`、`stale`、`no-consent`、`removed`）；过期时有 `staleReason`（`marked-stale`、`sentence-gone`、`source-changed`、`glossary-changed`、`empty`）。
- 配音实例是一条新音频轨（名字「配音（<语言>）」）上的 `audio` 实例，`role: 'dub'`，`extensions['baocut.dub']` 是 `{ groupId, language, unitId }`。分离过时，分离出的背景声在另一条音频轨（「背景声（<语言>）」）上，`role: 'music'`，扩展是 `{ groupId, stem: 'background' }`；原声压低时人声也单独成轨（「人声（<语言>）」），`role: 'a-roll'`，扩展是 `{ groupId, stem: 'vocals' }`，闪避以它为目标。两轨的实例与被替换的原句实例同位置、同源区间。轨道没有语言字段，语言写在轨道名、实例扩展与计划里。导出按这些标记选择声音来源（命令与协议规范 §4.4）。

### 7.3 长度适配

默认 `fit-fixed-slot`，即保留原画面的时长。流程：

```text
按术语与含义约束重写口语脚本 → 语音合成 → 测量
  → 有界的语速调整或时间拉伸 → 重新对齐 → 质量检查
```

调整的边界是用户或视频的策略（例如「最多调整若干比例」）。这个阈值只是产品规则，不保证听感。

仍然放不下时，返回 `needs-fit`，并给出明确的提案：重写脚本、延长允许延长的静态或代码画面，或创建节奏不同的语言版本。不得默认加速整段口播画面，也不得截断最后几个词。

### 7.4 生成与局部维护

- 给定的音频文件是默认的时间依据，不自动重新合成语音。
- 文字任务先确认脚本与声音；允许先试听有代表性的短段，再按明确的范围生成。
- 旧脚本的音频可以保留为候选，但不得标成与新脚本同步。
- 只有用户明确要求「同步声音」，或原任务合同已经包含这一步时，改配音文本才产生新的语音合成。
- 更换 Provider 不会默默更换声音身份。
- 剪口播之后：完整的句子只是移动时可以重新投影；句内删词需要检查有效语义。绝不能用源语言的剪点直接去裁目标语言的发音。
- 自动修复尚未开放时，`stale` 与 `needs-fit` 的提示仍然是全阶段约束。

### 7.5 音频的现实边界

- 源视频只有「人声 + 音乐 + 环境声」的混合轨时，静音它会让三者全部消失。要保留背景，必须使用已有的分轨，或新增分离任务并检查分离的伪影。不能声称关一个开关就能完美去掉原说话声。
- 译配的声音与原声默认不同时以同等音量播放。
- 说话人分离、声音身份与画面中的人物，是三个不同的推断。没有证据时保持未知身份，由用户绑定声音。
- 声音克隆与上传外部服务是独立的审批项，不由「翻译字幕」的请求隐式授权。

### 7.6 LocalizationSet

同一个画面序列可以有多个语言版本。每个版本选择字幕流、配音计划、文字覆盖与音频路由。

```ts
// 本规范补全
interface LocalizationSet {
  id: Id;
  revision: Revision;
  sequenceId: Id;
  language: string;
  captionProgramIds: Id[];
  dubbingPlanId?: Id;
  textOverrides: Array<{ itemId: Id; propertyPath: string; value: JsonValue }>;   // 仅白名单字段
  audioRouting: { originalDialogue: 'mute' | 'duck' | 'keep'; trackOverrides?: Record<Id, { muted: boolean; gainDb?: number }> };
}
```

- 覆盖只允许白名单内的字段：语言文本、字幕、配音与音频路由。
- 结构差异较大时，分叉出新的序列（`forkSequence`），并保存父版本与来源关系；不维护一套无限复杂的覆盖语言。
- 一个版本可以用源语言字幕，另一个用译文加译配。切换版本不得删除其他语言的资源。
- 只涉及画面变换的修改对共享的版本都生效；会改变时序的操作必须给出所有语言的依赖失效摘要。

### 7.7 CanvasVariant

```ts
// 本规范补全
interface CanvasVariant {
  id: Id;
  revision: Revision;
  baseSequenceRef: VersionRef;
  canvas: { width: number; height: number };
  layoutOverrides: Array<{ itemId: Id; place?: Place; crop?: Crop; mode?: 'fullscreen' | 'pip'; fit?: 'cover' | 'contain'; hidden?: boolean }>;   // §3.5
  parameterOverrides: Array<{ itemId: Id; parameters: JsonValue }>;      // 代码合成的响应式参数
  captionLayoutProfileId?: Id;
}
```

- 画幅版本引用基础序列，加上明确的画布、布局、裁切与参数覆盖。编译时生成派生的快照，而不是另一条可以随意写入的主时间线。
- 结构差异大时分叉序列，保留父版本。
- 用户说「只改英文竖版」时，命令必须携带 `variantId` 与覆盖范围。
- 共享的字体或自然译句改变时，相关的投影重新布局，不重做语音识别。影响时序的修改必须列出所有语言的依赖。
- 代码包没有声明响应式能力时，明确使用 contain 或 cover，或提出重构。改变纵横比不等于相机会自动重新构图。

### 7.8 SyncGroup

```ts
// 本规范补全。P1
interface SyncGroup {
  id: Id;
  masterClock: { assetRef: VersionRef } | { kind: 'sequence'; sequenceId: Id };
  members: Array<{
    assetRef: VersionRef;
    offset: MediaTime;                 // 相对主时钟
    timeMap?: TimeMap;
    confidence?: number;
    source: 'auto-audio' | 'timecode' | 'manual';
  }>;
}
```

- 自动同步是可以校正的分析产物。
- 切换视觉机位不切换主麦克风。画中画是两层。
- 删除语音段时，按显式的联动范围处理整个同步组。
- 混合帧率与可变帧率的素材各自按 PTS 映射。
- 未知的人物或声音身份由用户绑定，不猜测。

### 7.9 SoundCueSheet

旁白、配乐与音效分开组织。SoundCueSheet 是可以受控编辑的声音事件计划；不在代码合成的 `renderAt` 里随机播放音效。

```ts
interface SoundCue {
  id: Id;
  role: 'narration' | 'music' | 'sfx';
  assetRef: VersionRef;
  anchor: SemanticAnchor;
  offset: MediaTime;
  gainDb: number;
  followPolicy: FollowPolicy;
  userPinned: boolean;
}

interface SoundCueSheet {
  id: Id;
  revision: Revision;
  sequenceId: Id;
  cues: SoundCue[];
  compiled: Record<Id /* cueId */, { itemId: Id; viaTransactionId: Id }>;
}
```

- SoundCueSheet 是作者意图与构建记录，不是第二条可以独立演进的主音轨。
- 编译之后，每个 cue 以确定性的 ID 映射到一个普通的 `AudioItem`，经同一个事务写入。回执保留 cue → item 的映射与 lineage。
- 重复出现的同一个音效引用同一个素材版本，只创建多个音频实例，不重复下载或购买。
- 用户在时间线上移动、替换或静音某个音效之后，记录对应的 pin 或 override。之后重新编译时保留它、提示冲突，或由用户显式重置；不从旧的计划全量覆盖。
- 语音锚消失时进入 `orphaned`。固定的音效不跟随无关的 ripple。
- 旁白、配乐、音效各自路由。Adapter 内部的音频不得同时再进入外部混音。
- `gainDb` 不是响度的测量结果；是否过响需要通过真实的混音、峰值与响度检查以及试听来判断。
- 生成新的音乐或音效是独立的能力与费用授权。
- 复用原生 `AudioItem` 的能力属于 P0；更丰富的自动声音设计按验证的范围逐步开放。

### 7.10 NarrationCueSheet

用配音驱动画面时（产品设计 S04），旁白时序表记录句子、词锚、镜头意图与实际时间。

```ts
// 本规范补全
interface NarrationCueSheet {
  id: Id;
  revision: Revision;
  sequenceId: Id;
  audioRef: VersionRef;                 // 给定的或已确认的旁白音频
  speechRef?: VersionRef;               // 对齐得到的语音文档
  cues: Array<{
    id: Id;
    sentenceId?: Id;
    wordIds?: Id[];
    span: { start: MediaTime; end: MediaTime };     // 音频域的精确时间
    shotIntent?: string;
    sceneRef?: Id;                                  // 对应的场景或实例
  }>;
}
```

- 它是受控的输入与派生物，不是另一条会独立漂移的播放时钟。
- 保留真实的音频与词锚时序。只有在为视觉场景生成 `fromFrame` / `durationFrames` 时才量化，并记录偏差。
- 替换音频产生新版本；对齐结果与绑定的场景按依赖标记为过期。

### 7.11 音频事件与视频网格相互独立

`SoundCue`、语音合成的 `actualSamples`、对齐结果和淡化都使用采样或精确的时间。音频实例使用 §2.10 的精确开始位置与 `playDuration`；时间线上的帧宽只是界面投影。10 毫秒的淡化在 48 kHz 下是 480 个采样，不向上补成一个视频帧。

修改 `ExportSettings.fps` 不改变脚本、音频长度、采样率或声音身份。修改 `Sequence.fps` 需要保留音频精确的绝对位置，并重建它的「帧 + 余数」表示。

---

## 8. 便携包

视频可以导出为一个 `.baocut` 文件：不压缩的 POSIX ustar 归档，只有普通文件（架构设计 §5.8）。文件夹形式不做。

```text
video.snapshot.json              # 权威状态的可交换快照（§3.1）；不是第二个写入端。素材全部是 managed
documents/<id>/<revision>.json   # 文档正文的各个版本，按存下的原文（摘要按原文算）
assets/<sha256>.<ext>            # 收进来的素材：文件；扩展名由 mediaType 定，没有对应的是 bin
assets/<sha256>/<相对路径>        # 收进来的素材：目录（代码包的源码、清单、依赖锁与静态资源），逐个文件
video.manifest.json              # 打包版本与内容清单，归档里的最后一个文件
```

来源与生成说明在快照的 `provenance` 里，不另设目录。路径都是 `/` 分隔的相对路径，只能是上面这几种形式。

### 8.1 清单

```ts
// 本规范补全
interface PackageManifest {
  format: 'baocut.package';
  packageVersion: 1;
  videoSchemaVersion: number;
  timeContractVersion: number;
  videoId: Id;                           // 导出时的视频；打开包得到的视频有新的 videoId
  videoName: string;
  videoRevision: Revision;
  createdAt: string;
  entries: Array<{
    ref: VersionRef;
    kind: 'asset' | 'document';
    path?: string;                       // 包内的相对路径
    contentHash: string;
    byteLength: number;
    inclusion: 'included' | 'linked' | 'missing' | 'excluded-license';   // 现在只写 included 与 missing
    note?: string;
  }>;
  files: Array<{                         // 包里的每个文件（清单自己除外）
    path: string;
    byteLength: number;
    sha256: string;                      // 'sha256:<hex>'
  }>;
}
```

`entries` 是每个素材版本与文档版本一项。收进包的单个文件，它在 `files` 里的 sha256 就是版本的 `contentHash`；目录素材的 `contentHash` 是按 §4.2 的规则算出的目录摘要，由引擎打开时重算。`files` 与归档里的文件一一对应。

### 8.2 规则

- 打包使用一致性快照。不把带有未 checkpoint 的 WAL 的工作数据库直接复制出去当作完成的视频。
- 链接素材复制进包，快照里改成 `managed`。读不到的素材默认拒绝导出；用户选择跳过时清单标 `missing`，快照里是只有文件名、`frozen: false` 的链接素材，接收方用 `relinkAsset` 找回。「链接式」的包（`linked` / `excluded-license`，素材留在外面）以后再做。
- 包里不带本机的绝对路径（§4.2）：快照里出现本机根目录的字符串换成占位并警告，文档正文里出现时拒绝导出。
- 打开时逐项核对，任何一项不符都拒绝、不建视频：`format` 是 `baocut.package`；`packageVersion` 不高于读的一方支持的版本（更高的拒绝，`PACKAGE_VERSION_UNSUPPORTED`）；归档里只有普通文件，路径只能是上面的布局，不能有 `..`、绝对路径、反斜杠，符号链接与硬链接条目拒绝（`PACKAGE_PATH_UNSAFE`）；清单的 `files` 与归档一一对应、没有重复；每个文件的长度与 sha256 相符，收进包的单个文件的摘要等于版本的 `contentHash`（`PACKAGE_DIGEST_MISMATCH`）。引擎建视频时再按 `contentHash` 重算一次文档与素材，按提交时的规则检查快照。
- 只有预先渲染好的 MP4 是可播放的媒体，不是可编辑的源。
- 含源码的代码包固定依赖锁，并带上离线可用的 bytes。只有锁文件而没有 bytes，不能声称可以离线重建。
- 包里不包含密钥、受保护的机器路径或任务未授权的文件。
- 临时 URL、blob URL、浏览器对象和 GPU 句柄不得进入交换格式。
- 打开包时验证清单；缺失的资源明确列出。代理或预先渲染的预览可以让用户先浏览，但不能被当成已经恢复了可编辑的源。

压缩、签名、pax 扩展（路径超过 255 字节、单个文件 8 GiB 以上）与文件夹形式以后再做（架构设计 §14）。

---

## 9. 待补全项

以下类型或规则由本规范补全，或仍有空缺，需要在实现前评审。

| 事项 | 状态 | 需要决定什么 |
| --- | --- | --- |
| 文字样式与图形模型（§3.6） | 已定：图形取 v2 的 `shape` 参数与形状目录；文字样式取 v2 的样式对象，字体按 §3.14 引用；文字样式的键表还没有写进本规范 | 随渲染核心移植写入文字样式的键、单位与取值；文字框固定还是随内容撑开 |
| 关键帧与元素动画（§3.15） | 已定：关键帧的属性白名单、百分比时刻、`motion` 的缓动表；入场、出场、循环三槽作为正式字段保存，由 `motion` 取样，不展开成关键帧；`animationBindings` 与 `animate` 都未实现 | 字幕动画是否沿用同一套槽 |
| 圆角的单位（§3.5） | 已定：540 短边下的像素，四角各自的值 `cornerRadii` | — |
| 留边底色与画布背景（§3.2、§3.5） | 已定：实例的 `bg` 在全屏加 `contain` 时铺满画布；画布背景是纯色 | — |
| `Crop`（§3.5） | 已定：四边各裁掉的比例，在 `fit` 之前，只用于视频与图片 | — |
| 生成类元素（§3.7） | 已定：取消内置生成器，计时、贴纸、声波、进度条、手绘、占位框、彩纸、白板各是实例的种类或参数，Lottie 是一种素材（§4.1） | — |
| 预渲染替身的失效（§3.7） | 未跟踪 | 参数或代码包版本变化之后，替身怎么标为过期 |
| 嵌套序列、调整层（§3.4） | 未纳入 | 是否以及何时加入 |
| 替换素材版本（§4.2） | 操作未实现 | 代码包换版、源文件重新导出时如何登记新版本并影响选定的实例 |
| 派生媒体的源时钟（§4.5、§4.6） | 待评审：重构图等产物替代原素材后，仅有来源说明不足以把原素材上的转写自动投影到新素材实例 | 是否增加绑定素材版本的派生时间映射，以及恒等映射的显式声明；缺少映射时不能仅凭文件名或相近时长认定两份素材共用时钟 |
| 链接素材的失效检测（§4.2） | 只记了修改时间；缺失的报告已定：`videos.assetStatus` 列出读不到的素材版本与原因，视频照常打开 | 何时重新核对内容；`frozen` 的确切含义；缺失素材在导出里的表现 |
| 文档正文的校验（§4.4、§4.6） | 引擎只核对 `baocut.speech/1`、`baocut.translation/2` 补充字段的形状与定位框字幕样式的逐词动画（§5.6） | 哪些 `kind` 由引擎完整校验；`kind` 与 `schema` 的登记处 |
| §5 的模型与已落盘的正文格式（§4.6） | 不一致；译文按 §5.3 的是 `baocut.translation/2`，旧项目导入的 `/1` 只读兼容（§5.3），不迁移；`baocut.speech/1` 补上了字幕与翻译核心读写的字段，与 `TranscriptDoc` 无损互换（§5.2） | 句子与字幕行存结果，还是存派生算法的版本加人工钉子；过期如何发现。已定：译文的句子派生与原文指纹只有字幕与翻译核心的一套（§5.3），原来翻译流程的 `baocut.sentences/1` 与 `sha256:` 指纹删除 |
| `caption-style`（§5.6） | 已落盘的是 Studio 样式与定位框样式两种正文，引擎只核对定位框样式的逐词动画；`CaptionStyleBody`（按维度组合的目标合同，[设计稿](../design/subtitle/caption-style-model-design.md)）已在编辑器与原型落地（编译到 Studio 样式），尚未作为正文落盘。默认预设已落盘（§5.6「默认预设」）：一份不分语言的 Studio 样式 | 与 `LayoutProfile`、`CaptionStyle` 的关系；阅读预算的单位；是否按语言分开默认预设 |
| 导出记录与导入记录（§4.6） | 借用文档 | 产物记录是否成为一等概念；与依赖链接的衔接 |
| `Provenance` 的结构化字段、`LicenseState`、`ColorInfo`（§4） | 未纳入 | 生成记录、派生关系、授权与许可状态的字段；颜色元数据的字段 |
| 视频级的 `extensions`（§1.4） | 只有实例与文档有 | 是否需要 |
| `ItemBase`（§3.4） | 本规范补全 | `paintOrder` 与 `Track.order` 的组合规则 |
| `Sequence.canvas.workingSpace`（§3.2） | 引擎不限定取值 | 首版支持的工作空间 |
| `SemanticAnchor`、`FollowPolicy`（§3.16） | 已定：起止各自的锚点、词锚点的偏移、到序列末尾、`follow-cuts` 与它的缺省（按时刻放置的实例从新建起缺省）。已定：`speech-anchor` 每笔事务按时间线重求，出现处与歧义按 v2 的规则，求不出的留在原处、`orphaned` 现算不落盘。已定：`item-local` 按目标的源时刻跟随，拆开跟锚点所在的一段，起点修剪越过锚点时到新起点，目标删掉时一起删。已实现 `sequence-fixed`、`follow-cuts`（剪口事务里）、`speech-anchor`、`item-local` 与到序列末尾；`explicit-link-group` 不在这一版的范围，只保存与校验形状，不移动 | `explicit-link-group` 的联动规则 |
| `ProtectionRecord`（§3.10） | 本规范补全 | 持久保护与任务级保护的边界；`confirmed` 的强制程度 |
| `Checkpoint`（§3.11） | 本规范补全 | 检查点是否允许带分支 |
| `DependencyLink.kind`（§3.12） | 本规范补全 | 依赖种类的枚举 |
| `ImportedCaptionDocument`、`AlignmentBlock`、`CaptionOverride`（§5） | 本规范补全 | override 的种类与取值 |
| `LocalizationSet`、`CanvasVariant`、`SyncGroup`（§7） | 本规范补全 | 覆盖字段的白名单 |
| `NarrationCueSheet`（§7.10） | 本规范补全 | 是否与 `SoundCueSheet` 的 narration 角色合并 |
| `PackageManifest`（§8.1） | 已定：容器是 ustar，逐个文件的长度与 sha256 | 签名；压缩与 pax 扩展 |
| 章节（§3.13） | 已定：`kind: 'chapter'` 的标记，固定在序列时间上 | — |
| 效果、转场、easing 的白名单（§3.9） | 已定：转场 `dissolve`、`wipe`、`slide`、`zoom`、`iris`、`dip-to-color`、`push`，单侧按 v2 的画法；效果是 `fx` 的固定字段与固定顺序，加滤镜与特效预设；转场的 easing `linear`、`ease-in`、`ease-out`、`ease-in-out` | `temperature`、`shadow`、`stroke` 的配方；效果与转场参数的关键帧。已定不合并：转场的 easing 保持这四种，`motion` 的缓动表只用于关键帧与元素动画 |
| 闪避（§3.9） | 已定：按文稿或按实例触发，v2 的曲线与合并规则 | — |
| 剪口集合（§6.7） | 已定：加入、合并、恢复与重排已实现（`addCuts`、`restoreCut`） | 手工修改与剪口不一致时的提示方式 |
| 模板层（§3.17） | 已定，未实现 | `ratio` 与画幅锁和画幅版本（§7.7）怎么共处 |
| v2 的 `bcfClip`（音频元素） | 已定：配音认领代码合成里的口播句子，落成合成与配音的音画联动组（§3.7「声音」）；认领的句子 ID 不进格式 | 合成能实时运行时，是否按句只扣掉认领的声音 |
| 可变帧率（§2.11） | 规则已定，未实现 | 现在按标称帧率处理 |
| HDR | 首版只支持 SDR 严格导出 | HDR 输入的 tone-map 策略 |
| 变速曲线、倒放、`preserve=frames` | 未纳入 | 是否以及何时开放 |
