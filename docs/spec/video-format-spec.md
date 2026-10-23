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
- [9. 工作区快照与版本文件](#9-工作区快照与版本文件)
- [10. 待补全项](#10-待补全项)

---

## 1. 范围与约定

### 1.1 类型的地位

文中的类型用 TypeScript 写法表达，是交换用的 DTO 概要。

- 语义与校验由 Rust 实现单源定义；TypeScript 的 DTO 与 JSON Schema 由它生成（架构设计 §13.2）。
- DTO 不规定数据库的实体布局。素材版本与文档版本引用不可变的内容；一次视频响应不需要带上几万个词或全部源码（§4.4）。
- 标注「本规范补全」的类型在原始设计中只有名称或用法，其字段由本规范给出，列入 §10 待评审。

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
- 视频的 `id`（`videoId`）在它的 `video.db` 里，不另放标记。`video.db` 的元数据另记两项，它们不属于视频的修订内容：写它们不产生新版本，不进撤销历史，也不出现在 `VideoSnapshot` 里。版本记录的簿记同样记在元数据里（§9.7）。
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
  brief?: VideoBrief;                 // 视频速览；没写过时省略
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

**视频速览** `brief` 是站在观众角度对这部视频的说明：出处（标题、作者、时长、语言、链接，平台简介按作者原话引用）、讲什么、出场的人与要点。智能体转录之后写（产品设计 §3.2.2），给人看，也给之后的会话读，不参与渲染：

```ts
interface VideoBrief {
  markdown: string;                   // Markdown，去掉首尾空白后 1–20000 个 Unicode 标量值；不带「视频速览」标题
  language?: string;                  // 正文的语言，BCP 47
}
```

- 存在视频实体里，与名字一样随视频撤销与重做，打包时一起带走；只经 `setVideoBrief` 整份替换或清掉（命令与协议规范 §4.2）。新建的视频没有它；派生子视频不继承父视频的速览。
- 正文里指向这部视频某一刻的链接写成 `?t=<秒>`（序列时间，十进制秒），不带视频 ID：视频被复制或从便携包导入时换了 ID，链接仍指向它自己。给人看、给智能体读时换回 `/videos/<videoId>?t=<秒>`（`@baocut/protocol` 的 `expandBriefLinks`）；指向别的视频的链接原样保存。
- 它是写下那一刻的说明，之后重新转录、剪辑不会自动更新它；时间链接按序列时间解释，剪辑之后可能偏移。只增加可以忽略的字段，不加格式版本（§1.4）。

视频的内容只有两张表：

- **素材**是 bytes：一个文件或一个目录。代码包不另设一张表，它是 `kind: 'bundle'` 的素材（§4.3）。
- **文档**是结构化的文稿：转写、译文、字幕、字幕样式、剪辑提案、配音计划、声音事件表等。它们共用一张表，用开放的 `kind` 区分（§4.4、§4.6）。增加一种文稿不需要升级视频格式。

### 3.2 Sequence

```ts
interface Sequence {
  id: Id;
  revision: Revision;
  name: string;
  nameRef?: MessageRef;              // name 还是引擎起的缺省名时它的消息引用；改名后没有
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

- 名字：新建视频时根序列的缺省名由引擎起，存英文 `name: 'Main sequence'` 与 `nameRef: { key: 'engine.mainSequence' }`（命令与协议规范 §11.1 的消息引用）；`updateSequence` 给了 `name` 就是用户起的名字，去掉 `nameRef`。给人看时按 `localizeText(name, nameRef)` 用读者的语言显示，用户起的名字原样（`@baocut/protocol` 的 `sequenceDisplayName`）。有 `nameRef` 之前新建的视频存的是 `name: '主序列'`、没有引用：引擎读写都不补，原样保留（撤销按存下的原样比对）；显示时把这个字面值也当缺省名。只增加可以忽略的字段，不加格式版本（§1.4）。
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
  focalPoint?: FocalPoint;             // §3.5
  panels?: VideoPanel[];               // §3.5 分屏：2–4 格，只用于全屏 cover；省略时一整幅
  embeddedAudio: EmbeddedAudio;        // 内嵌音频的路由（§3.9）
}

interface VideoPanel {
  rect: { x: number; y: number; w: number; h: number };  // 画布百分比：左上角与宽高
  focalPoint: FocalPoint;              // 这一格的取景点与放大，「铺满」指铺满这一格
}

interface ImageItem extends VisualItemBase, MediaFields {
  type: 'image';
  assetRef: VersionRef;
  crop?: Crop;
  focalPoint?: FocalPoint;
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
  - `crop`、`focalPoint`：视频与图片。
  - `panels`：只用于 `mode` 为 `fullscreen`、`fit` 为 `cover`（或省略）的视频。
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
interface FocalPoint { x: number; y: number; zoom?: number }   // cover 留下哪一段，[0, 1]；zoom 在铺满之上再放大，[1, 4]
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
- **取景点**（`focalPoint`）决定 `cover` 裁掉多余部分时留哪一段，同 CSS `object-position` 的百分比：`x`、`y` 各在 [0, 1]，0 贴左（上）、0.5 居中、1 贴右（下），多出来的部分按它分到两边。它在裁剪之后定位，只对 `cover` 起作用，不改框，也不裁源画面：换画幅时多出来的画面还在。省略时居中，与没有这个字段的文档一样。`zoom` 是在刚好铺满之上再放大多少，在 [1, 4]，缺省 1；1 不保存（写 1 时去掉这个字段）。放大围着取景点：`cover` 的倍率乘上 `zoom`，源画面上 (`x`, `y`) 那一点仍落在框里的 (`x`, `y`) 处，所以画面始终铺满、不露底；它同样只对 `cover` 起作用，不改框。放大不借用 `place.scale`：`place.scale` 是可以打关键帧的整体倍率，铺满时按框中心放大，与取景点无关；取景的放大跟着取景点走，换画幅时随取景点一起重算。换画幅的取景（剪成短视频）写取景点而不是把左右或上下裁掉；`videos.derive` 收到裁剪时，全屏加 `cover` 的视频按派生画布换成取景点，铺满方向上多出来的那一边不裁，另一边的裁剪（放大、去黑边）留着，看到的画面不变。
- **分屏**（`VideoItem.panels`）把一件全屏铺满的视频画成 2–4 格：每格是画布上的一个百分比矩形（`rect`，`w`、`h` 大于 0，落在 [0, 100] 之内，两两不重叠，可以贴边），画同一帧源画面——先按实例的 `crop` 取源区域，再按这一格的 `focalPoint` 铺满这一格（同上面的取景点与 `zoom`，只是「刚好铺满」指铺满这一格），裁到格子之内。有 `panels` 时实例自己的 `focalPoint` 不参与渲染（保留着，去掉 `panels` 时回到它）。整件仍是一个画面实例：声音、时间映射、剪口、字幕投影、转场与不透明度都按实例算，滤镜与效果作用在每一格的源画面上；格子是固定的，实例的遮罩、翻转、入场 / 出场与循环动画、关键帧在分屏时不参与；转场把几格合成的整幅当作一个铺满画布的画面。`setStyle` 的 `panels` 整份替换（`null` 去掉）；`mode` 或 `fit` 改得不再是全屏 `cover` 时 `panels` 一并去掉；写入与读取时格数、矩形或取景点不合法的拒绝。常用版式（短视频分屏设计 §3.1、§11）：两格上下各一半，三格三行 33.333 / 33.334 / 33.333，三格「上一下二」（上格整宽、下面左右各半），四格田字格；人按在原片里从左到右的次序排进格子，「上一下二」的上格放主讲的那人。格子之间可以留间距：间距是画布短边的百分比（0–10），横竖两个方向在画布上的像素一样宽，由矩形本身体现（格式不另记间距），间距里露出下层轨道；`@baocut/protocol` 的 `panelRects(layout, count, gap, canvas)` 按版式与间距给出矩形（三位小数，左右、上下对称；间距为 0 时与上面的版式一致），`panelLayoutOf` 反过来认出版式与间距。导出交给编码的源尺寸不按画布缩小（格子取一块再放大）。
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

- **文字样式**。`style` 是 v2 的文字样式对象，没有 `schema` 包装。它的键与取值由渲染核心的文字样式类型定义，随渲染核心移植后写进本节（§10）；文字预设数据里用到的键有 `fontFamily`、`fontSize`、`fontWeight`、`fontStyle`、`italic`、`underline`、`fontColor`、`lineHeight`、`letterSpacing`、`textAlign`、`textTransform`、`backgroundColor`、`backgroundPadding`、`backgroundStyle`、`borderRadius`、`textOutline`、`dropShadow`。在那之前引擎按对象保存、不解释；渲染器认不出的键要报告，不得悄悄跳过。
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
- **贴纸**。`source: 'template'` 画贴纸目录里的矢量；`'asset'` 画 `assetRef` 指向的图片、视频或 Lottie 素材。`loop` 只对视频、Lottie 与动图（GIF、APNG）素材起作用：`loop` 循环，`once` 播一次停在末帧，`hold` 停在首帧。`fillOverrides` 在绘制前把 SVG 或 Lottie 里的原色换成目标色（Lottie 的渐变不参与；位图与视频素材不换色）。GIF 与 APNG 是图片素材，按帧的延时播放，没有单独的种类；图片实例里的动图按自己的总时长循环。APNG 只按 `.apng` 扩展名认（`mediaType` 为 `image/apng`），扩展名是 `.png` 的动画 PNG 记成 `image/png`，按第一帧的静态图画。
- **声波**。`audio_envelope` 是新建音频视频与 Agent 未指定样式时的默认款；已保存的其他 `style` 不迁移。画面由声音的分析缓存驱动：`audio` 指定取哪一路声音，按序列时刻映射到那一路的源时刻取样；`speaker` 只在这位说话人的词区间里动。
  - `audio_envelope` 使用每个分析帧时域样本的 RMS：样本字节先以 128 为中心除以 128；取平方均值的平方根，再按 `min(1, (RMS / 0.32)^0.65)` 压缩、量化到 0–255。在当前取样时刻两侧各取 60 个样本，间距 0.045 秒（共 121 根）；片段起点前、终点及之后、缓存覆盖外都按静音，不延长首末帧。说话人筛选、剪口、速度、音量与混音先按下面的声音路由求好，再取包络。`minDb`、`maxDb`、`smoothing`、`gain` 不改变包络；它们只用于频谱款。
  - 包络样式的参考框是 1632×340：细柱从 x=12 到 1620，宽 5.5、圆角 2.7，高 `3 + 168×幅度`，围绕 y=130 上下对称；中线 x=816 固定，左侧（含中线）用 `mainColor`（缺省 `#7FE0CF`），右侧用 `secondaryColor`（缺省 `#54616B`）。y=279 的细进度线与下方 `mm:ss` 读数显示实例本地时间与总长，随框等比缩放或按用户几何拉伸；中线透明度为主色的 22%。默认创作摆位是中心 x=50、y=54、宽 85%，`scaleY = (画布宽 × 0.85 × 340) / (1632 × 画布高 × 0.2)` 保持参考框比例，避开字幕；通用元素的缺省几何表保持不变。预览、导出与跳播共用纯函数求值，不整段烘焙，不依赖字体或系统时间。
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
- **预渲染替身**。`prerender` 是把这段合成渲染好的视频。它与合成共用 `timeMap`：合成的局部时间就是替身视频的源时间。合成的运行环境不可用，或来不及实时渲染时，预览与导出用替身代替；能运行时以代码为准。替身不是源：改了参数或换了代码包版本，替身就过期了；过期的判定与后果见代码包规范 §7.4。
- **声音**。合成发出的声音（用替身时是替身视频的音轨）由 `audio` 路由。时间线上另有同一段声音的音频实例时（例如渲染结果里已经混入了配音，配音又单独放在音频轨道上），必须关掉 `audio.enabled`，不得两处同时出声。合成与这些音频实例写进同一个音画联动组（`linkGroupId`，§3.4）表示组里的音频是合成声音单独放的一份：引擎写入时核对，同一条序列里组内有音频实例时，组内合成的 `audio` 必须省略或 `enabled: false`。替身是混好的成片，只扣掉其中几句做不到，整条关掉。

字段来源：`schema.rs` 的 `CounterProps`、`StickerProps`、`VisualizerProps`、`ProgressProps`、`DrawProps`、`PlaceholderProps`、`ConfettiProps`、`WhiteboardProps`、`WhiteboardBeat` 及其 `validate`；缺省落位见 `geometry.rs`。

### 3.8 字幕实例

```ts
interface CaptionItem extends ItemBase {
  type: 'caption';
  span: FrameSpan;
  documentId: Id;                      // kind 为 caption 的文档（§4.6）
  presentation?: CaptionPresentation; // 动态场景的实例参数、标签与 seed，见 §5.6
  styleDocumentId?: Id;                // kind 为 caption-style 的文档
  scopeItemIds?: Id[];
}
```

- 字幕实例只在字幕轨道上。它没有 `place`：字幕的位置与排版由样式文档决定（§5.6）。
- 它引用文档的 **ID** 而不是某个版本：字幕跟随文档的当前版本，改字不需要改时间线。
- **时钟**。字幕文档里的时间要么在源素材的时钟上，要么已经是序列时间，由文档自己声明。`scopeItemIds` 列出把字幕投影到序列上的实例：一行字幕的源时间落在某个实例取用的源区间里，就经过那个实例的 `timeMap` 映射到序列时间；落在所有实例之外的行（被剪掉的话）不显示。`scopeItemIds` 省略表示文档里的时间已经是序列时间。
- `span` 限定显示的范围：投影之后落在 `span` 之外的行不显示。
- 一个字幕实例显示一份文档。双语字幕是两条字幕轨道上的两个实例，各自启用或停用；原文与译文不要求逐行对应（§5.1）。
- **说话人**。一句的说话人是字幕文档里这一句的 `speaker`（显示名），没写时取这一句第一个词在转写里的说话人（转写 `speakers` 里的 `name`，没有名字时是说话人 ID）。Studio 样式的 `speakerLabel: { on, scale?, color? }` 打开时，有说话人的句子在字幕块最上面多画一行名字：字号是最上面那行的 `scale` 倍（缺省 0.62，夹在 0.3–1），颜色缺省 `#BBBBBB`，其余跟那一行一样，不带逐词与文字动画，随整块出入场；双语时取原文行的说话人。缺省关，没有说话人的句子不画。原声片段的「说话人 + 译文 + 原话」就是双语两层字幕加这个开关。
- **句子的词**。字幕文档（`baocut.caption/1`）的一句可以用 `words`（`{ first, last }` 或 `{ wordIds }`）指向文档头 `sourceDocumentId` 那份转写（`kind: speech`）里的词，生成字幕时写上。逐词动画、逐词高亮与设计字幕的强调（样式里按词 ID 写的 `captionEmphasis`）按这些词推进，词取自有效词流（§5.7）：隐藏的词与剪掉的词不画，句子里有词因此被拿掉时按留下的词重拼文字（认词上的「贴前」标记），一个也不剩的句子不画；多字的 CJK 词按转写落盘的规则逐字拆开，时间按字符权重分摊，子 ID 是 `<词 ID>~<k>`（第一个字沿用词 ID），写在整个词上的强调落到它拆出来的每个字上。逐句样式（样式里的 `cueStyles`）按字幕文档里的句子 ID 找。在源素材时钟上的字幕用词自己的源时刻；在序列时钟上的字幕用词投到序列上、与这一句重叠的那一处。没写 `words` 的句子取时刻落在句子里的词，文字不动。从转写生成的原文字幕，句子的文字就是它的词按切条的拼法（认「贴前」）拼成的；智能体之后改了转写的词文本（润色的 `updateWords`），Runtime 在同一笔事务里把文字还对得上的句子按改过的词重拼，时间与切条不动，手改过文字的句子不动（命令与协议规范 §4.2）。译文字幕、导入的字幕与不派生自转写的字幕没有词，逐词动画按空白切分推算，不冒充词时间（§5.6）。

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

保存版本（§9.6）在库里是一个检查点，在版本记录里是一个钉住的 `save` 版本，头部写着检查点 ID：用户与智能体只看到「版本」一个概念。删除保存的版本时一起删掉它的检查点。检查点不写进工作区快照（§9.2）。

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
- 章节固定在序列时间上：移动、裁切、删除实例、波纹删除与插入（`removeRange`、`insertRange`，以及带 `ripple` 的 `replaceCodeBundle`）都不改变它的帧。例外是剪口：应用与恢复剪口时章节跟着内容走（§6.7）。
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
- 台标的 `file` 是项目里的相对路径（相对视频所在的来源目录：项目，或会话的工作目录），`brandLogo` 是品牌库里的图片 id；用到时按素材登记（§4.1）。Runtime 在写模板（`setTemplate`，任何行为者的提交）的同一笔事务里补上视频里还没有的台标图片，一步撤销：品牌库的图片拷进视频（`managed`，`provenance` 与 `library.applyToVideo` 的图片相同，记着 `{ library: 'brand', entryId }`）；项目里的文件按路径链接（`linked`，`provenance` 为 `{ origin: 'template-logo', source: { templateLogo: { file } } }`，§4.5）。库里已经没有的、解开链接后在来源目录之外的、不在了的与扩展名不是 png、jpg、jpeg、webp、gif、svg 的不登记，模板照写。渲染按来源找：品牌库的台标取当前修订的来源是品牌库这一条的图片素材里库版本最新的，同版本取 ID 小的，找不到时这一层画不出来（`template-logo-asset-missing`）；路径台标取当前修订的来源是 `template-logo`、`file` 相同的图片素材里 ID 小的，找不到时画不出来（`template-logo-file-missing`）。导入的字节与视频里已有的素材相同时引擎复用那个素材（`importAsset` 不新增记录）、不改它的来源，这时按来源认不出，同样画不出来。这样登记的素材算被模板用着，不当作没用的素材清掉。存进品牌库的模板不留路径：视频里登记了的那张图存成品牌库的图片（库里已有同样字节的就用那一条），台标改成 `{ brandLogo }`；没登记的照旧留着路径。
- **时间**。章节条按序列上 `kind: 'chapter'` 的标记（§3.13）分段，当前段高亮；没有章节时整条是一段。进度线的进度是 clamp(t / 序列长度, 0, 1)。
- **文字变量**。文字层里的 `{chapter}`、`{n}`、`{count}`、`{time}`、`{remain}`、`{total}`、`{percent}`、`{title}` 按当前时刻替换：当前章节名、序号、章节数、已播时间、剩余时间、总长、百分比、视频标题。认不出的变量原样显示。
- **字幕避让**。`subsAvoid` 为 true 时，打开的、`y` ≥ 50 的整宽横条（章节条、进度线）把字幕抬起来：字幕的锚线（样式的 `y`，画面高的百分比）不低于 `y − 2`，几条横条取最高的一条。只挪位置，不改字号、宽度与底板；双语的两行一起挪，居中摆放的字幕不动。
- **画幅**。`ratio` 只在套用模板时改一次序列的画布；`lockRatio` 生效时，改序列画幅的命令只接受与 `ratio` 相同的画幅，要改先解锁。`ratio` 是 `W:H` 时由引擎拒绝不同比例的 `updateSequence`（`INVALID_OPERATION`，`details.rule: 'template-ratio-locked'`，`details.ratio` 与 `details.template` 指明锁定的画幅与模板名；比值差 0.01 以内算同一档）；`ratio` 是 `original` 时要看源尺寸，由界面把关。套用模板时先写 `setTemplate` 再改画布，同一笔事务里新模板锁的就是这一档。
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
- 颜色信息（`ColorInfo`）与许可状态（`LicenseState`）尚未纳入（§10）。

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
- 导入的 bytes 与视频里某个素材当前版本的相同时，复用那个素材，不新增记录，也不改它的来源。例外是烘焙出的预渲染替身（§4.5 的 `composition-bake`）：来源记的 `sourceBundleRef` 与那个版本的不同（另一个代码包版本烘出了相同的画面）时，那个素材加一个版本，bytes 相同，来源是这次的烘焙记录（代码包规范 §7.4）。
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
  assetRefs?: VersionRef[];             // 引擎从正文派生的冻结素材依赖，包含历史版本的保留关系
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
- 从链接下载的素材，`origin` 为 `link-import`（架构设计 §7.9），`source` 记：`url`（脱敏的链接）、`webpageUrl`、`platform`、`mediaId`、`title`、`uploader`、`uploadDate`、`durationSec`、`description`（页面简介，去掉首尾空白，最多 20000 个字符）、`chapters`（平台给的章节 `[{ start, end?, title }]`，源时间秒：丢掉起点不是有限非负数的与空标题，标题合并空白、最多 160 个字符，按起点排序、同起点只留第一条，最多 400 条；`end` 只在大于 `start` 时写；yt-dlp 给没标题的章节填的 `<Untitled Chapter N>` 照原样记下，读取时当作只有分界、没有标题，见架构设计 §7.9）、`tool`（`{ name, version, source }`）、`downloadedAt` 与流程的 `jobId`。平台没有给简介或章节时这两个字段省略，之前的版本导入的素材也没有它们。简介与章节是作者写的参考：读取视频的摘要列出它们，`chapters_adopt` 把章节吸附到转写后写成序列的章节（§3.13）；素材本身不因它们改变。
- 从用户库拷进来的素材，`origin` 为 `library`，`source.library` 记下条目所在的库、条目 ID、版本、内容摘要、名字与种类（架构设计 §5.9）；之后库里的修改与删除不改变这个素材。
- 从随应用分发的贴纸拷进来的素材（元素面板的贴纸与动态贴纸，命令与协议规范 §4.1 的 `stickers.applyToVideo`），`origin` 为 `sticker-pack`，`source.stickerPack.id` 记贴纸 ID（`<包>-<文件>`，如 `featured-01.svg`）；文件以 `managed` 拷进视频，之后应用升级换了这张贴纸也不改变这个素材。
- 元素面板里的 Codex Pets 拷进来的素材（命令与协议规范 §4.1 的 `pets.applyToVideo`），`origin` 为 `codex-pet`，`source.codexPet` 记 `{ source, slug, name, author, license, version }`：`source` 是 `community`（awesome-codex-pet 的社区 pet），`version` 是图集版本（1 或 2），`license` 是作者自报的许可原文。素材是待机那一行编成的循环 APNG（`image/apng`，§3.7），以 `managed` 拷进视频，之后上游换了图集也不改变这个素材。
- 叠加模板按路径引用的台标（§3.17 的 `src: { file }`）登记成的素材，`origin` 为 `template-logo`，`source.templateLogo.file` 记模板里的那个相对路径；文件以 `linked` 留在项目里，渲染按这个来源找到它。
- 用户上传的媒体只记录已知的出处；上传不代表拥有第三方素材的全部权利。
- 临时 URL、blob URL、签名地址、浏览器对象和 GPU 句柄不得进入视频格式。
- 生成的素材应在 `source` 里记下任务、供应方、模型、输入输出的摘要与费用；费用未知时写 `unknown`，不从估算伪造实付金额。这些字段的结构，以及派生关系、授权与许可状态，待生成与授权功能加入时确定（§10）。

### 4.6 文档的种类

`kind` 是开放的。下表是已经在用的种类，以及本规范后面的章节计划的种类。

| `kind` | 内容 | 正文的 `schema` | 定义 |
| --- | --- | --- | --- |
| `speech` | 一段录音的转写：词、说话人、句子、章节 | `baocut.speech/1` | §5.2 |
| `translation` | 一种目标语言的译文单元 | `baocut.translation/2`（按 §5.3，新写入一律用它）；`baocut.translation/1`（旧项目导入，只读兼容） | §5.3 |
| `caption` | 一种语言的字幕行 | `baocut.caption/1` | §5.4 |
| `caption-style` | 字幕的样式与布局 | `baocut.legacy-studio-style/0.1`（Studio 样式）；`baocut.boxed-caption-style/<N>`（定位框样式，`<N>` 是来源格式的版本号）；`baocut.caption-scene-style/1`（动态场景） | §5.6 |
| `library-selection` | 视频里启用的用户库条目：每一步的术语表、说话人的音色 | `baocut.library-selection/1` | 见下 |
| `export-record` | 导出过的成片与字幕文件在哪里 | `baocut.export-record/1` | — |
| `import-record` | 这部视频从别的格式导入时的明细 | `baocut.import-record/1` | — |
| `editorial-proposal` | 口播剪辑提案 | 已实现 | §6.2 |
| `cut-set` | 一个源素材上被口播剪辑删掉的区间 | `baocut.cut-set/1` | §6.7 |
| `derivation` | 派生子视频的来源：父视频、版本、区间与区间之外的剪口 | `baocut.derivation/1` | 见下 |
| `production-plan` | 制作计划放上时间线的记录：每个段落、实拍片段、卡片与水印对应哪个片段，用的是哪一版内容 | `baocut.production-plan/1` | 见下 |
| `dubbing-plan` | 配音计划 | 计划 | §7.2 |
| `sound-cue-sheet`、`narration-cue-sheet` | 声音事件表、旁白事件表 | 计划 | §7.9、§7.10 |
| `chapter-sheet` | 章节表：一个序列的每一章的脚本、配音、代码包与它编译成的实例与标记 | `baocut.chapter-sheet/1`（今天只有界面读脚本，编译未实现） | §7.12 |
| `script` | 做视频时写下的整份脚本（Markdown），版本就是文档的版本 | `baocut.script/1` | §7.13 |

- 时间在正文里用整数表示，并写明时间基与时钟：`timescale`（每秒的刻度数）与 `clock`（`source-asset`：这份文档或它的来源文档的 `sourceAssetId` 所指素材的时钟；`sequence`：序列时间）。不用浮点秒。
- 引擎只核对 `baocut.speech/1` 与 `baocut.translation/2` 里 §5.2、§5.3 补充的字段：出现时形状必须对（类型、枚举值与取值范围），引用的词在不在不查；`baocut.cut-set/1` 按 §6.7 的约束整份核对。其余正文不校验。带 `/1` 的几种格式是导入旧项目时定下来的，比 §5 描述的模型简单；二者怎么统一列在 §10。
- `export-record` 与 `import-record` 是这台机器上的记录：正文里有本机路径（成片写到了哪里、旧项目原来在哪里）。它们不参与渲染，也不是任何实例的输入；打包成便携包时不带出去，或去掉路径之后再带（§8）；这两种记录还没有实现，现在正文里有本机路径的文档一律在导出便携包时拒绝（§8.2，架构设计 §14）。
- 读到不认识的 `kind` 或 `schema`：文档头照常显示，正文不解释，写回时保留。
- `derivation` 记这部视频是从哪个视频的哪一段派生的（`videos.derive`，架构设计 §3.5「派生子视频」）：派生时写一份，正文与文档头的 `summary` 相同（Space 的内容索引只读 `summary`），名字「派生来源」（按当前语言）。之后不随父视频或子视频的修改更新，只记派生那一刻。正文：

  ```ts
  interface DerivationBody {
    schema: 'baocut.derivation/1';
    parentVideoId: Id;
    parentRevision: string;            // 派生时父视频的版本
    range: { start: number; end: number };  // 父视频剪辑后时间线上的秒，已对到帧
    primaryAssetId: Id | null;         // 记剪口的主素材（父视频里的 ID）；没有可剪的媒体时 null
    cuts: Array<{ assetId: Id; from: number; to: number }>;  // 区间之外的剪口：主素材源时钟上的秒
    settings: { width: number; height: number; fit: 'cover' | 'contain' | null; crop: Crop | null;
                captions: boolean; translations: boolean; chapters: boolean;
                crops?: Array<{ from: number; to: number } & (Crop | { layout: 'rows' | 'grid' | 'spotlight'; panels: Crop[]; main?: number; gap?: number })> };
                                       // 分段取景：父视频剪辑后时间线上的秒，已对到帧、截到区间；分屏段的各格已按区域从左到右排好，
                                       // spotlight 的上格排在最前（记下的 main 是 0）；间距为 0 时不写 gap
    framing?: {                        // 分段取景落在主素材源时钟上的样子：给了 crops 且有主素材时才有
      assetId: Id;                     // 主素材（父视频里的 ID）
      shots: Array<{ from: number; to: number; crop: Crop | null;              // 区间里主素材的每一段：源时钟上的秒与它用的裁剪
                     layout?: 'rows' | 'grid' | 'spotlight'; panels?: VideoPanel[] }>;  // 分屏段：版式与写到片段上的格子（crop 为 null；间距已在矩形里）
    };
    key: string;                       // 幂等键：父视频、版本、区间与设置的 sha256 前 12 位（settings.crops 有才算进来）
    hook?: string;                     // 开头一句：派生时调用方给了才有
    reason?: string;                   // 为什么挑这一段
    notes?: string[];                  // 提示牌：几句短提醒
  }
  ```

  `settings.crops` 与 `framing` 也是加上去的可选字段：派生时给了分段取景才写，旧文档没有它们照常读，按只有 `crop` 一份取景理解。`framing` 留给以后恢复剪口时按镜头补拆片段用；子视频里各片段的 `crop` 与 `focalPoint` 才是当前状态（全屏加 `cover` 的片段按 §3.5 换成取景点，`settings` 与 `framing` 记的仍是给的裁剪）。

  `hook`、`reason`、`notes` 是加上去的可选字段（派生时调用方给了才写，不参与幂等键），旧文档没有它们照常读；界面没有 `hook` 时取子视频保留段的第一句，没有 `reason`、`notes` 时不显示。

  子视频复制了父视频的时间线与文稿，区间之外的部分是记在主素材剪口集合（`cut-set`，§6.7）里的剪口，恢复它们就回到父视频的样子；`cuts` 只是派生时记下的那几个，剪口集合才是当前状态。

- `production-plan` 是 `edits_assemble`（Agent 面设计 §4.3）把制作计划放上时间线之后写的记录：每个视频至多一份，有几份时只认 ID 最小的一份，名字「制作计划」（按当前语言）。重跑时靠它认出哪些段落、片段与卡片已经放好、内容没变，只动变了的；中途失败时写到失败之前放好的部分。正文：

  ```ts
  interface ProductionPlanBody {
    schema: 'baocut.production-plan/1';
    tracks: { scenes: Id; narration: Id; footage: Id | null; cards: Id | null; watermarks: Id | null };  // 放到了哪几条轨；没有这一类时 null
    segments: Array<{
      id: string;                 // 计划里段落的 id
      contentHash: string;        // 时间线上那个代码画面用的代码包的内容摘要
      sceneItem: Id;              // 代码画面的片段
      narration: string | null;   // 旁白：'artifact:<产物 ID>' 或 'sha256:<文件内容摘要>'；没有旁白时 null
      narrationItem: Id | null;   // 旁白的片段
    }>;
    clips: Array<{ id: string; key: string; item: Id }>;          // 实拍片段：key 是源（路径、文件大小与修改时间）、入点、长度、画面、声音与转场的 sha256
    cards: Array<{ id: string; contentHash: string; item: Id }>;  // 卡片：代码包的内容摘要
    watermarks: Array<{ id: string; key: string; item: Id }>;     // 水印：key 是图片（路径、文件大小与修改时间）、长度、位置与放法的 sha256
  }
  ```

  记录里只有摘要与 ID，没有本机路径，便携包照常带出去。重跑时按记录里的片段 ID 找，不按名字。`tracks.watermarks` 与 `watermarks` 是后加的，没有它们的记录按没有水印读。实拍片段、卡片、水印或旁白被手动删掉时重新放；代码画面被连同时间一起删掉（`removeRange`）时当作中间插进的段落放回，只删了片段、留下空隙时后面的段落对不上记录，以 `LAYOUT_MISMATCH` 拒绝。

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

**`baocut.speech/1` 的正文**。已落盘的转写正文是下面的形状（与目标模型的差别列在 §10）。时间是整数刻度，单位是 `timescale`，时钟是 `sourceAssetId` 所指的素材（§4.6）：

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

- 词不存词间的空格：拼接时按文字的规则现算（中文、日文不加，拉丁字母之间加，谚文按词加）。`glue` 记住规则答不对的地方，拼接、量宽与断行都认它：贴前的词缝两侧都是写空格的文字的字母或数字时（转写把 `Transformer` 切成 `Tra` + `nsformer`），这是同一个词的内部，切字幕条与断行都不在这里断，用户明确要断的除外。没有词时间的整段按宽度切、译文按比例切时，一串西文也整串挪动，只有它自己就放不下时才切开。转写流程写入的词可能自带前导空格，读的一方照原样处理，不改写。
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
  reuse?: { fromVideoId: Id; unitId: Id };   // 翻译记忆沿用的译文：取自哪部视频的哪个单元
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
- `reuse` 记这句的自然译句沿用了用户另一部视频里已有的译文（翻译记忆，创作辅助集成设计 §3.7）：`fromVideoId` 是那部视频，`unitId` 是那份译文里的单元。只是来源的记录，不影响对齐、字幕与配音；写入方改了 `naturalText`（编辑、改为重译）就去掉它，只改显示改写时保留。引擎核对它的形状（两个字符串），不核对引用的视频在不在。
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
- 旧项目导入的译文是 `baocut.translation/1`：`{ schema, sourceLanguage, units: [{ id, text, display?, source?, alignment? }] }`，单元的 `id` 就是源 SpeechDocument 的句子 ID，`display` 是字幕显示用的改写，`source` 与 `alignment` 原样保留旧项目的指纹与对齐（格式与 §5.3 的指纹、对齐块不同，不能换算）。它只为已经导入的视频读取：导出的双语合并认它（按句子 ID 配，成员取 SpeechDocument 的句子），新写入的译文一律是 `/2`。派生子视频（架构设计 §3.5）把它升级成 `/2` 再复制：不换算旧的指纹与对齐，只取译句，按单元的词（SpeechDocument 存下的同 ID 句子，没有时取 `source` 的首末词）与按本节规则派生的句子配对（共有的词不少于较短一句的一半，先配共有词最多的一对），词相同的单元 `draft`、变了的 `stale`（译句留着），对齐写成句级降级记录，`display` 不带（没有改写依据的指纹）；配不上的旧单元不带，没有旧译文的句子不写单元。
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

#### 动态字幕场景正文

`caption-style` 支持 `baocut.caption-scene-style/1`：`scene: { kind: 'inline', value: CaptionScene }` 加可选 `parameters`。场景使用 `schema: 'baocut.caption-scene/1'` 和 `evaluationVersion: 1`。完整 DTO 见 [`packages/protocol/src/caption-scene.ts`](../../packages/protocol/src/caption-scene.ts)，严格解析及语义验证由 [`caption-scene`](../../crates/caption-scene/README.md) 统一执行，模板预检和帧求值不各写一套语义。可运行的正文见 [word-pop.json](../../crates/caption-scene/tests/fixtures/word-pop.json)。

`CaptionItem.presentation` 可保存实例参数、`cueOverrides`（cueId 及可选 occurrenceId）、`wordTags`（wordId 到标签数组）和 16 位十六进制 `seed`。seed 省略时固定为零。参数合并次序为模板默认值、样式参数、实例参数、cue 覆盖、匹配 occurrence 的覆盖；未知参数、错误类型和越界值拒绝。样式与内容仍由各自文档拥有，实际词时间只从有效词流取得；新场景保留源词组，旧样式继续既有拆字路径。

当前共享 CPU 执行档的字段和能力：

| 领域 | 生效合同 |
| --- | --- |
| 节点 | `text/group/shape/image/repeat` 及显式能力开启的 `label`；稳定 ID、zIndex 与子节点顺序；text 绑定当前 cue 或 `{ source: 'static', text }`；repeat 引用文字选择器，生成 shape/image/label 装饰 |
| 布局 | `layoutEvaluation: 'static' | 'per-sample'`；width/x/y 使用 `{value,basis,offset}`，basis 为 absolute/canvasWidth/canvasHeight/canvasShortEdge；可选 parameter 引用已声明 scalar，长度为 value × parameter × basis + offset，在准备布局时求值；按 Unicode 换行并由 maxLines 与 maxUnitsPerPage 分页；超长词按 grapheme 断行；leadingGap 为 show/hide |
| 字体与涂装 | 每个文字节点的 fontFamily、可选fontSource（`caption-font-source/1`）、fontSize（明确长度）、fontWeight、italic、letterSpacing（em）、lineHeight；fill 为十六进制 RGBA；可选 stroke 为 width（px）和 color；`caption-text-transform/1` 开放 textTransform `none/uppercase/lowercase`，按与语言无关的 Unicode 默认大小写映射在排版前改写绑定文字（含 label），词、选择器与词时间都绑定到映射后的文字，长度变化（ß → SS）不拆词；复用宿主注入的同一字体字节与字体解析机制 |
| 字体行框 | `caption-font-line-box/1` 开放 style.lineBox 可选对象：`minAscent/minDescent` 为有限 0–4 em 下限（默认 0）、`metricSource: 'font' | 'typographic'`（默认 font）、`fallbackProbe` 为可选单个 Unicode scalar 字符，只允许 typographic，显式 null/数组/未知字段拒绝。逐实际 glyph 的 fontId/weight/解析字号读取度量，分别对 ascent 与向下 descent 取最大值并应用各字形 em 下限，保留基线的正 descent 存储；font 用字体引擎默认度量，typographic 优先原 OS/2 sTypoAscender/Descender，缺失/无效或总高度小于该 face 显式 probe 的 outline 高度时用 hhea，再退默认度量，缺 probe 字符可用同 face 的 .notdef。行高为 max(字体上下包络之和，实际最大字号×lineHeight)，上端加最大 ascent 得基线；普通换行、固定行成员、逐采样字号/字体重排、Label 共用测量，分页成员和词时间不变。空白行仅用空格测已选字体，不新增正文或词。Label 仍用自身单行上下包络，不应用排版 leading。省略字段保留旧帧和序列化。测量只读已注入字体并共用有界 glyph path cache；逐采样/Label 共用帧预算，静态每个页/行组有独立准入预算，不因缓存命中减免 |
| 图片 | resources 项声明 id、assetRef（id/revision）和 contentHash（sha256: 小写摘要）；image 节点以 resourceId 引用，fit 为 contain/cover/stretch，默认 contain；只读 PNG 静态图，保留预乘 alpha |
| 有序涂装 | style.paints 按数组顺序覆盖普通 fill/stroke；每层有稳定 id、paint、strokeWidth（0 为填充，大于 0 为居中描边）、offset；paint 为 solid 或 linear，渐变 from/to 是基础视觉行框的归一化坐标；色标有序且在 0–1。与 fill 动画、stateStyles 或旧 stroke 同用时拒绝，避免隐式覆盖。`caption-paint-effects/1` 另开放：`unit: 'px' | 'em'`（em 为该字形解析后的字号，作用于 strokeWidth/offset/spread/blur）；`spread`（与 strokeWidth 互斥，把填充与该半宽外扩轮廓合成一份覆盖）；`blur`（对该层合并覆盖做高斯模糊，值为标准差）；paint `{ kind: 'node-fill' }` 取字形当前解析的填充（含 fill 动画与 stateStyles），带 node-fill 的节点不再与 fill 动画、stateStyles 冲突，旧 stroke 仍冲突。未声明 mask 的 spread/blur 层内同一声明 paint 与不透明度的连续字形先合成再整体应用 alpha，不重复叠加；不同字形的局部渐变端点不拆 opacity run，node-fill 的已解析 RGB 不同则拆开；spread 的渐变色标须不透明。上限：px 单层宽度/模糊 256、偏移 4096；em 分别为 4 与 16；单层模糊面超过 16M 像素报 `CAPTION_BUDGET_EXCEEDED` |
| 渐变空间与域 | `caption-gradient-space/1` 开放 linear paint 的静态 `space: 'local' | 'normalized'` 与 `domain: 'line' | 'page'`。省略分别为 local/line，序列化省略默认字段，保留旧像素路径。端点 from/to 始终由所选基础视觉框的归一化坐标定义；local 将端点映射到文字局部像素后做欧几里德投影，normalized 先将采样点变成 UV，再按 `t=dot(uv-from,to-from)/dot(to-from,to-from)` 投影。normalized 的宽高变化影响梯度协向量，不能把端点向量直接非均匀缩放后投影当作等价。domain=line 使用字形所属行框；page 使用同文字节点当前页全部基础视觉行框的包围框（含排版行高/leading，无 paint 外扩或动画 pose），跨行连续且每个分页独立；label 两种 domain 都使用自身单行框。逐采样排版按本次实际框更新，之后字形 pose/父变换正常作用于 paint。normalized 或 page 要声明新能力；未知枚举/null 拒绝。新空间被转换成同一 `PaintData::Linear` 端点，不引入重复投影语义；具体 GPU 路径仍遵循宿主对渐变涂装的准入限制；框无正宽高或端点在 f32 像素中不可表示时明确拒绝，不退成恒色 |
| 逐字形渐变域 | `caption-gradient-glyph/1` 开放 linear paint 的 `domain: 'glyph'` 与 `glyphOutset`（数值，单位为该字形解析后的字号 em，每侧，0–4，默认 0 且序列化省略）。glyph 域取每个矢量字形原始轮廓的字形局部控制框（与图片涂装 glyph-normalized 同一框），四边各外扩 `glyphOutset` em，再像 line/page 一样定义 from/to 与 local/normalized 投影；不含 paint 的 spread、strokeWidth 或 offset，因此同一字形的填充、描边、外扩、阴影层与图片 base 共用一个域，offset 层的色带随轮廓一起平移。Label 也按自身每个字形取域。`glyphOutset` 非 0 而 domain 不是 glyph、超出范围、非有限或 null 都拒绝；glyph 域缺少此能力报 `CAPTION_CAPABILITY_REQUIRED`，与 normalized 同用时两个能力都要声明。仍转换成同一 `PaintData::Linear` 端点，GPU 不新增语义；彩色位图字形不受涂装；normalized 下零宽或零高的框按上一行明确拒绝 |
| 覆盖率重映射 | `caption-paint-coverage/1` 开放 paint 层的可选 `coverage: {lo, hi}`，静态有限数且 `0 <= lo < hi <= 1`，未知字段拒绝。未声明 mask 时，每个同 paint/opacity 的连续字形 run 先生成不透明填充/描边/外扩轮廓，在设备空间按 blur 做 Gaussian，再将覆盖率 c 映射为 `clamp((c-lo)/(hi-lo), 0, 1)`。之后乘 paint alpha 与字形 opacity；不对已经变淡的 alpha 重映射，半透明投影不会变成不透明。预乘 RGB 随 alpha 比例缩放并量化为 RGBA8，零覆盖保持透明。solid、node-fill 和不透明色标 linear 支持，半透明色标 linear 拒绝；blur=0 也可以显式重映射抗锯齿覆盖。各 run 按源顺序合成，单 paint 层所有 run 的离屏表面累计不超过 16M 像素，超限拒绝。省略字段保留旧执行路径与序列化；该能力由共享 CPU 场景计划产生位图，供预览/导出及 GPU DrawOp 合成复用，未宣称 GPU 原生计算轮廓模糊 |
| 逐字形涂装遮罩 | `caption-paint-mask/1` 开放仅 Text/Label 的 paint 层可选 `mask: {kind:'glyph-fill',spread?:number,offset?:[number,number],inverted?:boolean,rasterization?:'canvas'|'glyph-bounds'}`。对象必须显式 kind，未知字段/kind、null、字符串、数组拒绝；spread 为有限非负静态数，默认 0，序列化省略零值，单位沿用所属层 unit（默认 px），上限 px 256、em 4；em 按该实际字形解析字号求值。遮罩取同一矢量字形填充并仅应用 mask 自己的 spread 与局部 offset，使用与该字形相同的动画/节点/父仿射变换，不继承 paint 的 offset、strokeWidth、spread、blur 或 coverage。paint offset 仅移动涂装，mask offset 独立移动遮罩轮廓，两者都在同一字形仿射变换之前应用。mask offset 与 spread 沿用 layer.unit，必须是恰好两个有限数，分量范围 px±4096、em±16；默认 [0,0] 且序列化省略。inverted 必须为 boolean，默认 false 且序列化省略；true 使用 AlphaInverted，将 matte 因子换为 255-maskAlpha，不反转 paint 的 RGB 或 alpha。非零 mask offset 或 inverted=true 必须额外声明 `caption-paint-mask-transform/1`，原 `caption-paint-mask/1` 始终必需；省略或显式默认值不要求 transform 能力。offset/inverted 的显式 null、错误类型、未知字段及越界值严格拒绝。每个字形先完成既有 paint 的 spread/blur/coverage 和透明度流程，再与该字形自己的白色 alpha matte（或其反相因子）求交，之后按源字形顺序合成该 paint 层，所有字形完成后才进入下一 paint 层；不得先将所有字形 union 后求交，以免相邻字形串色。solid、linear、node-fill 和 image 共用 matte；预乘 RGBA8 四通道各按 `(value * factor + 127) / 255` 整数除法缩放（默认 factor=maskAlpha，反相为 255-maskAlpha），不额外改变既有取整先后；字形 opacity、图片 compositeOpacity 和父组 opacity 沿原流程各只应用一次。缺少能力报 `CAPTION_CAPABILITY_REQUIRED`；彩色位图字形在运行时明确拒绝。共享 CPU 与 GPU Draw-source 均执行 alpha matte；GPU 对既有 Alpha／AlphaInverted／Luma／LumaInverted 模式使用同像素RGBA8整数运算、独立输入／输出表面。GPU 把四通道与factor相乘后复制回当前隔离组，后续绘制继续source-over；matte自身不应用父组opacity。模式、栈、深度、组合与显存预算必须在提交前校验。GPU隔离表面深度至多32（线性paint另用一个coverage scratch）、全帧至多128个组合／matte回写slot，512Mi工作和256MiB总预算；每个matte另计32×canvasPixels工作及16bytes uniform保守预留。既有影像涂装或模糊录制路径的CPU准备不因此变成GPU滤镜或原生SDF实现。默认 `rasterization: 'canvas'`（省略时同值，序列化省略）使用全画布 matte：每次 mask 录制的画布不超过 16Mi 像素，每次录制按 `2 * canvasPixels * outlineGlyphCount * maskedLayerCount` 预留工作，同一帧所有 cue、节点、Repeat 实例与历史采样共享一个 Budget，累计不超过 128Mi 像素。乘法与累计使用 checked arithmetic，工作溢出或超限报 `CAPTION_BUDGET_EXCEEDED`（paint mask work），失败不得增加计数。这是涂装与 matte 双表面的保守工作预算，在录制前对完整节点检查并预留，不能先录部分操作或在每个节点重置帧预算；彩色位图字形也在录制前拒绝。既有 paint/资源/模糊预算仍生效。省略 mask 保持旧执行路径和序列化 |
| 逐字形轮廓距离覆盖 | `caption-glyph-distance-coverage/1` 开放 Text/Label paint 层的可选 `distanceCoverage`：由同一原字形轮廓的 1–2 个有符号距离带相乘替代普通 glyph 覆盖率，保留原涂装坐标与单次 alpha；完整字段、共享导数和预算见下方「轮廓距离覆盖」。省略字段保持旧路径与序列化 |
| 图片涂装 | `caption-image-paint/1` 增加仅 Text/Label 的 paint `{kind:'image',resourceId,uvTransform:[a,b,c,d,e,f],space,wrap?,filter?,opacity?,compositeOpacity?,base?,phase?,phaseOffset?}`，引用 scene.resources 声明的冻结 PNG；uvTransform/space 必须显式，资源、空间、采样、相位与一次覆盖合成合同见下文「图片涂装」。共享 CPU 录制有界位图，GPU 沿现有 DrawBitmap 合成，不宣称 GPU 原生 texture shader |
| 静态逐词涂装 | `scene.paintStyleBindings` 以同一 Text 的静态 word selector 选择可选 fill 和完整 paints 替换；须声明 `caption-paint-style-bindings/1`，最多 64 条。所有候选 stack 合并为无环的全局层顺序，默认最多 16 个不同 layer ID，详见下文「逐词静态涂装样式」 |
| 绘制顺序 | 文字节点按层整体绘制：每个 paint 层（或旧 stroke，然后 fill）覆盖该节点全部字形后再画下一层，描边与投影不会盖住相邻字形的填充。静态逐词涂装沿合并后的全局 layer ID 顺序绘制，同层再按完整 PaintLayer 定义分组，不能先画完一组词的完整 stack；彩色字形位图最后绘制，不参与描边和投影 |
| 选择器 | cue/page/line/word/grapheme；all、state、tag、range、parity、and/or/not；按基础文字整形的 cluster 归属单元，不把字形拆开 |
| 状态 | stateStyles 的 unit 为 word，active/read/unread 各为 `{fill}`；gapPolicy 为 none/hold-previous，tailPolicy 为 none/hold-last；timingPolicy 默认 require-word-timing，可显式 estimated |
| 动态属性 | transform.x/y/scale/scaleX/scaleY/rotation、opacity、fill（声明 `fillPaint` 的 shape 除外）；shape 另支持 width/height/radius，image 支持 width/height，label 支持 fontSize（length）；角度为弧度、表达式长度为解析后的 px |
| 关键帧 | 明确语义 clock、start/end、精确 offset/duration/stagger；归一化 at；linear/step/ease-out-quad 或 `{ 'cubic-bezier': {x1,y1,x2,y2} }`；fill.before/after 为 none/hold；repeat 用 iterations 与 loop/yoyo，窗口边界无需顺序播放；可选 `tail` 为 none/clamp/repeat（`caption-clock-tail/1`） |
| 表达式 | 带类型 literal/read/call/if；scalar/integer/length/time/angle/bool/color；无环纯函数，时间/单元/基础布局/参数只读；共享数学曲线、连续 sin/cos、带 seed 的 random/noise；if 惰性求值，非法运算返回诊断 |
| 合成 | replace/add/multiply 与 priority/声明顺序；颜色只允许 replace；乘法通道为无量纲数；父子变换及离屏组 opacity 通过共同 DrawOp 光栅执行 |

**局部遮罩录制**。声明 `caption-paint-mask-local/1` 后，mask 可显式选择 `rasterization: 'glyph-bounds'`。它在共享场景录制阶段，把每个字形的完整涂装与其遮罩在整数设备像素窗口内烘焙为普通预乘 RGBA8 `DrawBitmap`；CPU、WASM 和 GPU 消费同一位图，不新增 BCOP opcode，也不声称是 GPU 原生遮罩滤镜。窗口包围涂装内容（含独立 paint offset、spread／stroke、变换后模糊 reach 和 AA 边缘）并裁到输出画布；反相模式同样按完整涂装内容取窗，不能只按原遮罩框裁剪。全局渐变／图片域、页内相位与模糊源 halo 保持原定义，输出窗口仅改变最后的遮罩重放分配。无法处理的内部绘制指令明确拒绝。位图字形继续拒绝。

局部窗口采用自己的设备坐标光栅化；曲线细分与抗锯齿可能随坐标原点产生边缘量化差异，不保证与全画布路径逐字节相同。它先完成字形内部遮罩，再由调用方对输出位图施加外层裁剪；外部 AA clip 对位图作用一次，不继承旧 matte 在 content／mask 两次绘制上分别作用 clip 的数值。场景当前文本录制本身不打开外层 ClipPath。需要旧 AA／clip 合同的文档继续使用默认 canvas。仅声明新 capability、没有选择新模式，不改变旧指令或像素。

录制前对整个节点预计算窗口并原子预留三账本：所有 mask 的工作仍共用 128Mi 像素上限，canvas 按旧公式、local 按每窗口 `2P` 计；local 另在既有 image-paint 的 16Mi RGBA8 等效像素槽预算计 `4P`（base／content／matte 与不可变输出），在其 256Mi work 预算计 `8P`（遮罩通道乘法及输出传输）。任一超限或 checked arithmetic 溢出不改变三计数；原有 paint／PNG／模糊／扩展栈预算仍另计。GPU 接收的是小位图，适用既有位图尺寸与总预算门；不为满足 GPU admission 缩小或截断纹理。没有逐字形全画布 GPU matte 临时表面，但最终帧与材质所需的全画布目标仍保留。

`requiredCapabilities` 当前可声明 `caption-render-layers/1`、`caption-layer-add/1`、`caption-image-sequence/1`、`caption-noisy-sweep/1`、`caption-bound-label/1`、`caption-scene/1`、`caption-text-context/1`、`caption-ink-context/1`、`caption-glyph-envelope/1`、`caption-page-envelope/1`、`caption-unit-context/1`、`caption-cue-word-context/1`、`caption-speech-phase/1`、`caption-first-page-context/1`、`caption-cue-unit-context/1`、`caption-active-word-context/1`、`caption-line-neighbor-context/1`、`caption-line-unit-quota/1`、`caption-word-line-tail-join/1`、`caption-remaining-word-page-plan/1`、`caption-fixed-line-wrap/1`、`caption-fixed-line-fit/1`、`caption-fixed-line-font-box/1`、`caption-page-line-context/1`、`caption-page-tag/1`、`caption-line-box-context/1`、`caption-shape-paint/1`、`caption-expressions/1`、`caption-permutation/1`、`caption-function-dag/1`、`caption-bezier-expression/1`、`caption-exponential-expression/1`、`caption-rounding-expression/1`、`caption-modular-expression/1`、`caption-power-expression/1`、`caption-list-pick/1`、`caption-clock-tail/1`、`caption-unit-animation/1`、`caption-image-png/1`、`caption-image-paint/1`、`caption-paint-stack/1`、`caption-paint-style-bindings/1`、`caption-paint-effects/1`、`caption-paint-coverage/1`、`caption-paint-mask/1`、`caption-paint-mask-transform/1`、`caption-paint-mask-local/1`、`caption-glyph-distance-coverage/1`、`caption-image-distance-coverage/1`、`caption-gradient-space/1`、`caption-gradient-glyph/1`、`caption-font-line-box/1`、`caption-font-source/1`、`caption-font-hinting/1`、`caption-font-shaping/1`、`caption-image-phase-float32/1`、`caption-image-page-phase/1`、`caption-text-transform/1`、`caption-blur/1`、`caption-feedback/1`、`caption-feedback-mean/1`、`caption-wave-displace/1`、`caption-wave-context/1`、`caption-soft-band/1`、`caption-noise-palette-mix/1`、`caption-noise-displace/1`、`caption-angular-sample-blend/1`、`caption-affine-sample-blend/1`、`caption-affine-over/1`、`caption-gaussian-uv/1`、`caption-gradient-smear/1`、`caption-gaussian-axis/1`、`caption-gaussian-spacing-ramp/1`、`caption-gaussian-sampling/1`、`caption-glow-cascade/1`、`caption-glow-linear/1`、`caption-glow-tint/1`、`caption-glow-color-matrix/1`、`caption-layout-per-sample/1`、`caption-page-window/1`、`caption-layout-clock/1`、`caption-unit-font-size/1`、`caption-unit-font-reflow/1`、`caption-unit-font-style/1`、`caption-word-line-layout/1`、`caption-word-page-layout/1`、`caption-text-line-layout/1`、`caption-pattern-select/1`、`caption-keyword-isolation/1`、`caption-tag-run-isolation/1`、`caption-scalar-cluster-layout/1`。未知能力、属性或字段拒绝；artifact 形式的场景引用、非 PNG 图片、任意 shader、无限递归反馈、节点级材质栈及改变分页成员的时间布局尚未开放，不能保存为成功后在渲染中忽略。完整扩展方向仍按[设计文档](../design/subtitle/dynamic-caption-format-design.md)维护。

`caption-layout-clock/1` 可选增加 `layout.clock: { time: Expression }`。表达式结果为 `time`，表示 cue 起点之后的采样秒数；缺省不改旧路径。外层 cue／时间线激活仍按原始半开时间窗决定，表达式只在活跃 cue 内执行。先用未映射的 cue 上下文求时钟一次，再用 `cue.start + result` 统一选择页、计算词状态、逐采样字号／布局、绘制 pose 和同 cue 材质（含关键帧）；它不会改写正文、词时间或外层 occurrence 时钟。负值或落在页窗之外可产生空画面，结果必须有限且绝对值不超过 1,000,000 秒，异常明确报错，不夹紧。

时钟只能读静态参数、画布、cue `unit.index/count`、未映射的 `time.seconds/elapsedSeconds/durationSeconds/cueDurationSeconds/progress/clampedProgress`，以及 `time.inputFirstWordStartSeconds/inputFirstWordEndSeconds/inputLastWordStartSeconds/inputLastWordEndSeconds` 和 `unit.inputFirstWordTimed/inputLastWordTimed`。后六项直接来自 cue 输入记录端点，以 cue 起点为零；缺失或无效时为零与 false，不冒充显示绑定或估算词时间。这些字段也在后续采样上下文提供，须声明该能力。时钟可以调用纯函数；函数间接读取已生成的页、行、字形、bounds、选中状态或其他采样单元字段同样拒绝，避免反馈。重播、逆向 seek 和多周期采样均重新计算，无历史累积。

例如 `t - floor(t / period) * period`（t 为 `time.seconds`）可循环已有词页，period 可由显式正输入端点求出；动画关键帧重复本身不会改变页选择，不能代替此布局时钟。分页 gap 比例为精确 0 或 1 时直接复用相应输入端点，避免浮点抵消使共享边界偏移一个 ULP；中间比例沿用原计算。

**图片涂装**。Image paint 的 resourceId 必须引用 scene.resources 中的静态 PNG，不能引用图片序列；复用资源摘要和 PNG 解码检查。矩阵采用 Canvas 约定：先按 space 取 `(x,y)`，再 `U=a*x+c*y+e,V=b*x+d*y+f`，没有隐式 contain/cover/fit。六系数有限且绝对值不大于4096；令 `m=max(abs(a),abs(b),abs(c),abs(d))`，要求 `m>0` 且 `abs((a/m)*(d/m)-(b/m)*(c/m))>1e-12`，拒绝奇异或近奇异变换。

space 为 glyph-em（原始填充 outline 墨迹框中心为原点，两个方向均除以该实际 glyph 的解析字号）、glyph-normalized（同一墨迹框 min/max 映射0/1）、line-normalized 或 page-normalized（沿用渐变的基础行/页框，Label 两者均使用自身单行框）。框不含 paint 外扩或动画 pose；paint offset 随同轮廓和涂装移动，节点/父 pose 在其后应用。wrap 为 clamp/repeat/mirror，默认clamp；filter 为 nearest/bilinear，默认bilinear。UV 的 clamp 为0..1夹取、repeat 为模1、mirror 为模2后折返到0..1。nearest 使用 `floor(U*W)`，bilinear 使用 texel-center 坐标 `U*W-0.5`（V 同理）；各 tap 按 clamp/repeat/mirror 取索引，mirror 边界复制 edge，repeat 的边界 tap 按像素尺寸取模。采样在预乘 RGBA 上插值。

opacity 默认1且在0..1，仅乘图片采样 T 的预乘 RGBA。可选 base 只允许一层 solid/linear/node-fill，禁止另一个 image；base 保留自身颜色/渐变 alpha，node-fill 取当前解析的填充并沿用 fill 动画规则，不包含待最后应用的 glyph opacity。compositeOpacity 默认1且在0..1，独立缩放图片与 base 的合成结果，不得提前改写 T.alpha 或 base.alpha，也不能用两边预乘替代。无 spread/blur 时，先在同一采样点计算 `C=T+base*(1-T.alpha)`，保留 f64 的 C，乘 compositeOpacity、设备 mask 的 U8/255 覆盖率与 clamp 后 glyph opacity 后，四分量各只四舍五入一次到 RGBA8；节点/父层级 opacity 沿既有组最终应用，不得对 base 重复应用。未声明 mask 时，spread/blur 的连续共同 glyph-opacity run 先不乘 glyph opacity 与 compositeOpacity，按一次 coverage 合成各字形涂装并隔离整 run，再模糊；最终 DrawBitmap.opacity 为共同 clamp 后 glyph opacity × compositeOpacity，整体只应用一次；UV/phase变化不拆同opacity run，未外扩/模糊的涂装沿逐glyph source-over语义。无 base 时半透明图片保持半透明，不能拆成两层涂装而重复抗锯齿。base normalized/page gradient 仍须声明渐变能力。spread 沿用轮廓外扩，blur 沿既有 RGBA 涂装模糊合同；image 与 coverage 组合拒绝。无 mask 时彩色 glyph 位图保持原行为，不被图片涂装；声明 mask 时按逐字形涂装遮罩合同明确拒绝。

phase 可显式声明 `{period:1..4096整数,source:'cue-scalar-index'|'page-scalar-index',arithmetic?,indexOffset?}`：缺省arithmetic='integer-modulo'、indexOffset=0，保持旧整数index%period再f64除period；integer-modulo不接受非零indexOffset。显式arithmetic='float32'必须声明caption-image-phase-float32/1，indexOffset是有限数、绝对值≤131072；先分别把index/offset转f32、以f32相加，再f32除f32(period)，最后q-floor(q)转f64加到矩阵后的U。负输入也用floor，不用trunc；每步可观察到的舍入是合同，不用整数余数或一个静态offset代替。arithmetic 只决定选定索引后的算序，不要求整个UV矩阵以f32求值；phaseOffset 是0..1静态偏移，默认0，另加到U。cue-scalar-index 的 index 为本 Text 完整 textTransform 后绑定文本（cue 或自己的 static 字符串）的 Unicode scalar 起始逻辑索引，分页不重置。page-scalar-index 必须另声明 caption-image-page-phase/1：从同一完整 transformed 文本的逻辑 scalar 索引中，减去对应 layout page.source_range.start 在该文本中的 scalar origin，再按上述 integer-modulo 或 float32 算序处理 indexOffset、除法与 fract。页内逻辑 source 范围的全部空白/换行仍计数，包括显示排版隐藏的分隔空白；不得按可见墨迹或物理 glyph 数重新编号。两种 source 的 cluster/ligature 均取起始 scalar，RTL 保持逻辑顺序；Label 使用自身解析并 textTransform 后的完整静态字符串，视为单页。该索引不声明任何外部来源 ordinal 等价。CPU 录制、编译计划、隔离涂装与 layer capture 必须消费同一个 source 选择和逻辑索引。按需建立 scalar 起点表，全局起点与页起点的字节位置均必须严格命中同一文本的边界，不把缺失映射猜成0。图片涂装累计至多16Mi RGBA8 等效像素槽/帧，计设备输出表面、每glyph临时mask、向FrameOps复制的位图，以及Gaussian每pixel四个f32通道所占四槽；这使涂装表面/传输/blur row scratch累计分配至多64MiB（PNG解码另计）。请求的设备sigma大于256px明确拒绝，不截断kernel冒充。清零每output pixel计1工作，glyph ROI每pixel预留32采样/域/base工作，Gaussian每有效通道tap预留1工作，累计至多256Mi工作/帧；超限在相应扫描或分配前拒绝，不降低采样。两种 source 共用同一 scalar 起点表和既有相位表预算，不为 page-scalar-index 另建第二张索引表。相位表累计至多131072 slots/帧，所有 cue、材质与历史重录共享同一帧 Budget，不能在每字形、每页或每cue重置；超限报 `CAPTION_BUDGET_EXCEEDED`。PNG 解码另有64MiB累计 RGBA 字节预算；加载器建立预乘像素约束，采样热路径不在每次paint扫描整张资源。未知字段/枚举、显式null、非法资源/base/相位/矩阵拒绝；可选默认字段省略时序列化不增加字段。该能力的共享 CPU 录制产生有界位图，供 GPU DrawBitmap 合成，不能据此宣称原生纹理采样或外部来源保真验收通过。

显式 `maxUnitsPerPage` 按词配额人为切页时，第 2 个及后续词块开头若只有水平 Unicode 空白组成的词间分隔 run，该 run 不参与显示排版；空格、tab、NBSP、Unicode 空格均适用。若 run 含 CR/LF、VT/FF、NEL、LS 或 PS，则整段保留，不吞显式换行及其缩进。原始 cue 开头的缩进、默认按宽度换行均不变。源文本/页范围/字素索引保留分隔字节，空白装饰定位新页逻辑行首；逐采样重排使用冻结的显示起点，不恢复已隐藏的分隔空白。

`caption-line-unit-quota/1` 开放 `pagination.maxUnitsPerLine`（1–4096 的整数，单位为词），只用于按宽度换行的页，与 `wordLinePattern`、`textLinePattern`、`remainingWordPagePlans` 互斥；未声明能力时返回 `CAPTION_CAPABILITY_UNAVAILABLE`，越界或与固定行模式同用返回 `CAPTION_SCENE_INVALID`。一行在第 maxUnitsPerLine+1 个词开始之前结束；更早的词若会越过行宽，仍按原规则在它之前换行。计数取该行范围内开始的词（与分页使用同一词绑定），每行重新计数，显式换行照常结束行；从超长词中间折出的续行不重复计入该词，单个超宽字素仍按原回退保留。页仍按 maxLines 收行；同时声明 `maxUnitsPerPage` 时先按页配额切块，再在块内按行配额折行。逐采样排版与 `caption-unit-font-reflow/1` 的重排使用同一配额。示例见 [line-unit-quota.json](../../crates/caption-scene/tests/fixtures/line-unit-quota.json)。

`caption-text-line-layout/1` 显式启用按文字数量冻结行成员的 `pagination.textLinePattern: { unit, lines: number[][] }`，与 `wordLinePattern`、`maxUnitsPerPage`、`lastPageRule` 互斥。unit 必填；基础模式为 `unicode-scalar`（Unicode scalar value 数）或 `grapheme`（扩展字素簇数），另有下述显式规则 `scalar-cluster` 模式。这些模式都不把 UTF-8 字节数或 UTF-16 码元数当作计数。例如 `e` 加组合重音为 2 个 scalar、1 个 grapheme；Emoji ZWJ 序列通常也是多个 scalar、1 个 grapheme。分页的语义 unit 仍为 word。计数只覆盖各完整词的源字节范围；词间分隔空白不计入限额，不凭字体或语言猜计数模式。

lines 外层是循环页计划，内层是该页每行的正字数上限：1–256 个页计划、每页 1–maxLines 行，每项范围 1–65536。按原词顺序贪心装行：整词放入会超限且当前行非空则先结束当前行；单词自身超限时完整独占一行；放入后恰好达到限额也立即结束行。词间分隔中的 CR/LF、VT/FF、NEL、LS、PS 强制下一个词另起一行；连续或首尾换行仅作为成员边界，不产生无词空页。完整词不可拆，若单个输入词内部含显式换行则返回 `CAPTION_LAYOUT_INVALID`，不静默吞换行或切词。

文字限额模式复用固定词行的形状、空白归一化、源字节/字素索引、词时间与跨页上下文。来源文字和词成员不改写，分隔标点仍保留显示；未属于某个词字节范围的字符不计入词限额。`overflow:error` 拒绝绘制宽度超限，visible 保留整行，不按宽度重新拆成员。逐采样重排只更新冻结行的绘制几何；`caption-cue-unit-context/1` 同样识别为固定行数模式，无需重排隐藏页来获得行总数，预算沿用固定词行路径。示例见 [text-line-layout.json](../../crates/caption-scene/tests/fixtures/text-line-layout.json)。

`caption-scalar-cluster-layout/1` 在同时声明 `caption-text-line-layout/1` 时增加 `unit:'scalar-cluster'`，并要求显式 `clusterRules` 对象。规则只用于每个完整词的分页配额计数，不强制合并、替换或切分实际整形 glyph，也不声明遵循 Unicode 字素分割算法。`clusterRules` 由 `attachments`、`consumeFollowingAfter`、`joiners` 组成，三个列表缺省为空；显式 `{}` 表示每个 scalar 单独一组。其他 unit 不允许提供 clusterRules。

每个 attachment 为 `{next: [[low,high],…], previous?: ranges, headExcluded?: ranges}`。所有 ranges 为闭区间，按提供顺序进行短路匹配，不排序；重叠区间允许。第一轮从一个 scalar 起组，反复追加下一个 scalar，当它匹配某项 attachment 的 next、且（提供 previous 时）当前组末 scalar 匹配 previous、且（提供 headExcluded 时）固定组首 scalar 不匹配 headExcluded。随后只检查这时的组末：若属于 consumeFollowingAfter 且还有输入，则无条件额外吞入恰好一个 scalar。吞入后不重启 attachment 或 consume。第二轮从当前第一轮组开始，仅当紧接的组恰有一个 scalar、该 scalar 属于 joiners 且再后面还有一组时，合并这两个后续组并重复；多 scalar 的组、缺少后续组的末尾 joiner 不触发合并。最终组数即该词计数，词与词之间不拼簇。

规则最多 32 项 attachment，每项 next 必填且非空；各范围列表最多 32 个区间，所有列表总计至多 256 个区间，joiners 最多 32 个 scalar。区间必须升序端点且只含有效 Unicode scalar，任何触及 surrogate 的区间（包括端点位于两侧的跨越区间）均拒绝；joiner 也必须是有效 scalar。可选 previous/headExcluded 的显式空集按普通空集语义处理。

每个 TextLayout（单个文字节点的整个 cue）共享 1,048,576 次计数操作预算，不逐词重置：读取 scalar、开始/输出组、检测 attachment、测试区间或 joiner、追加 scalar、检查及拼接后续组均计费，规则按数组顺序短路。超限返回 `CAPTION_BUDGET_EXCEEDED`，不截断单词或返回部分计数。成员冻结后逐采样重排不重跑计数；旧 scalar/grapheme 模式不变。通用玩具规则示例见 [scalar-cluster-layout.json](../../crates/caption-scene/tests/fixtures/scalar-cluster-layout.json)。

`caption-word-page-layout/1` 增加独立的页词数计划 `pagination.wordPagePattern: number[]`。正整数依次循环，例如 `[2,3]` 将语义词分为 2／3／2／3…词页，末页截断；必须是 word 单元。模式非空、长度最多 4096，每项 1–4096，配额总和不超过 4096；与其他分页规划字段互斥。页的词成员和完整源文本范围先固定，再在该页内按宽度折行；超宽单词仍可按字素拆为多行。`maxLines` 不再产生额外页：超过行数或宽度时，`overflow: 'error'` 返回 `CAPTION_LAYOUT_OVERFLOW`，`visible` 保留该页全部行。首段缩进与后续页边界空白沿用词配额的绘制规则，原文与词字节范围不改写。配合 `caption-unit-font-reflow/1` 时可重排页内行，页成员、范围和时间保持不变；不提供本字段时旧分页语义保持不变。契约探针见 [word_page_layout.rs](../../crates/caption-scene/tests/word_page_layout.rs)。

`caption-word-line-layout/1` 增加固定词行分组，启用时使用 `pagination.wordLinePattern: number[][]`：外层为依次循环的页模式，内层每个正整数为该行词数。例如 `[[2,3]]` 表示每页两行，分别取两个词和三个词；`[[1],[2,1]]` 交替使用一词页与两行三词页。该字段与 `maxUnitsPerPage` 互斥，unit 必须是 word；模式1–256项，各页1–maxLines行，每行配额1–4096。未提供时保留原有硬换行、按宽度换行和分页行为。

词行模式将连续源空白折叠成一个显示空格时，每个被折叠的源空白字素仍保留原索引，并共享该显示空格的 advance/caret 几何；剥离空白按源串逻辑顺序定位到相邻字形的 caret 边：行首使用首字形前沿，行尾使用末字形后沿，并沿用整形器给出的 BiDi 方向（LTR 前沿在左，RTL 前沿在右），避免逐字装饰跳至后面的词。

可选 `pagination.lastPageRule: { ifRowCountIs, previousPageLines }` 只对至少两页的初始计划生效：按实际词数截断各行/页后，若最后页任一非空行词数等于 ifRowCountIs，替换倒数第二页的行配额，再从头重消费词。规则只执行一次，不对重消费后的末页重复触发；词尾后的空行/空页丢弃。replacement的每行配额和行数受相同限制，总配额不得小于任何页模式的总配额，保证不丢词。`[[2,3]]` 加 `{ifRowCountIs:1,previousPageLines:[2,4]}` 在6/8/13词时分别得到 `[[2,4]]`、`[[2,4],[2]]`、`[[2,3],[2,4],[2]]`。

`caption-word-line-tail-join/1` 开放可选 `pagination.tailWordRule: 'join-previous-line'`，必须与 `wordLinePattern` 同用，与 `lastPageRule` 互斥；未声明能力时返回 `CAPTION_CAPABILITY_UNAVAILABLE`，缺少词行模式或同时声明 lastPageRule 返回 `CAPTION_SCENE_INVALID`。按页模式分组并按实际词数截断后，已填满的页保持原计划；若末页未填满（词数少于它所用页模式的总配额）且最后一个非空行只有一个词，该词并入它前面的一行：末页还有别的行时并入同页上一行，否则末页移除、并入上一页的最后一行。只有一个词的 cue 保持不变。规则只执行一次；被并入的行可比配额多一个词，行数不变。`[[4,3,2]]` 在 5/8/9/10/14 词时分别得到 `[[5]]`、`[[4,4]]`、`[[4,3,2]]`、`[[4,3,3]]`、`[[4,3,2],[5]]`；`[[2,1]]` 在 3 词时保持 `[[2,1]]`（单词行填满了页），4 词时得到 `[[2,2]]`。示例见 [word-line-tail-join.json](../../crates/caption-scene/tests/fixtures/word-line-tail-join.json)。

`caption-remaining-word-page-plan/1` 开放 `pagination.remainingWordPagePlans: number[][]`：按「还没分页的词数」查表选择下一页的行计划。第 i 项（从 1 数）是剩余 i 个词时下一页每行的词数；剩余词数超过表长时一律使用最后一项。表长 1–256，每项 1–maxLines 行、每行 1–4096 词，且第 i 项总词数不得超过 i，因此每页都按计划取满，不需要截断。分页从 cue 全部词数开始反复查表、扣除本页词数，直到没有剩余词；查表结果只取决于剩余词数，不依赖文本内容、字宽或随机数。与 `maxUnitsPerPage`、`maxUnitsPerLine`、`wordPagePattern`、`wordLinePattern`、`textLinePattern`、`lastPageRule`、`tailWordRule` 互斥。未声明能力时返回 `CAPTION_CAPABILITY_UNAVAILABLE`，越界或与其他分页字段同用返回 `CAPTION_SCENE_INVALID`。行成员按固定词行冻结，下文固定模式的时间、空白归一化、逐采样重排及 `fontSizeBindings`、`pageWindow` 的固定成员要求同样适用。`[[1],[2],[1,1,1],[1,1,1,1]]` 在 3/10 词时分别得到 `[[1,1,1]]`、`[[1,1,1,1],[1,1,1,1],[2]]`。示例见 [remaining-word-page-plan.json](../../crates/caption-scene/tests/fixtures/remaining-word-page-plan.json)。

`caption-fixed-line-wrap/1` 开放 `pagination.fixedLineOverflow: 'wrap'`：固定行（`wordLinePattern`、`textLinePattern` 或 `remainingWordPagePlans`）比 `layout.width` 宽时，在行内按宽度续到下一显示行；不声明时保持下文的单行冻结语义。续行规则与按宽度换行的页相同：先按下文把行内空白归一化，再在 Unicode 断行机会处折行，超宽单词按字素回退，单个超宽字素保留在自己一行；每个续行从它的第一个可见字符的源字节开始，分隔空白和标点留在前一显示行，只含空白的显示行并入前一行。行、页的词成员和页显示时间不变，不会因此增加页或把词移到别的行；显示行依次堆叠，行高与其他固定行相同，`maxLines` 只限制计划行数，显示行可以更多。line 单元、行序号、行时钟和 `pageLineBox*` 槽位都按显示行计，所以一行折成两行时就是两个 line 单元。逐采样排版先把同一固定行的显示行拼回原行，再按当次宽度重新折行。`overflow: 'error'` 只在折行后仍有显示行超宽（单个字素比行宽还宽）时返回 `CAPTION_LAYOUT_OVERFLOW`。`fontSizeBindings`、`fontStyleBindings` 和 `pageWindow` 依赖每个固定行只有一行，与本字段互斥。未声明能力时返回 `CAPTION_CAPABILITY_UNAVAILABLE`，没有固定行模式或与上述字段同用返回 `CAPTION_SCENE_INVALID`。示例见 [fixed-line-wrap.json](../../crates/caption-scene/tests/fixtures/fixed-line-wrap.json)。

`caption-fixed-line-fit/1` 开放 `pagination.fixedLineFit: {lastLineWidthRatio, lastLineMaxScale, extraLineHeight}`：每页的固定行（`wordLinePattern`、`textLinePattern` 或 `remainingWordPagePlans`）先按节点字号 `fs` 排版，量出各行内容宽 w_i（按下文归一化后的整行字形宽度，与 `layout.width` 无关），取最宽行宽 W。第 i 行的缩放 s_i = W / w_i；末行若 w < W × `lastLineWidthRatio`，取 s = min(s, `lastLineMaxScale`)；内容宽为 0 的行 s = 1；任何行的字号 fs × s_i 不超过 4096 px，超过时按 4096 截断。每行按 fs × s_i 重新排版（字间距随字号缩放），行高为 fs × s_i × (`lineHeight` + `extraLineHeight` / S)，其中 S = max(1, max s_i)；各行按自己的行高自上而下堆叠，整页按行高总和在 `layout.y` 处居中，水平对齐照常按各行缩放后的宽度。缩放只作用于本页，页与页互不影响；单行页 s = 1，但仍加 `extraLineHeight`。行、页成员和时间不变，每个固定行仍只有一条显示行，`pageLineBox*`、`pageMaxFontSize` 等上下文读到的是缩放后的行。逐采样排版按当次字号和行宽重新测量并缩放。`overflow: 'error'` 对缩放后宽于 `layout.width` 的行返回 `CAPTION_LAYOUT_OVERFLOW`。`lastLineWidthRatio` 取 [0, 1]，`lastLineMaxScale` 取 [1, 100]，`extraLineHeight` 取 [0, 10]。缩放后的行不再续行，测量也不考虑逐单元字号或字体，所以与 `fixedLineOverflow`、`fontSizeBindings`、`fontStyleBindings` 互斥；省略 `caption-fixed-line-font-box/1` 时，缩放后的行高不取字体行框，文字节点不能同时声明 `style.lineBox`。显式声明该组合能力与既有 `caption-font-line-box/1` 后，可以保留文字节点的 `style.lineBox`：在各行缩放字号下分别求字体 ascent/descent，行高为 `max(fs × s_i × lineHeight, ascent + abs(descent)) + fs × s_i × extraLineHeight / S`，基线仍为该行顶部加 ascent；按这些实际行高之和居中整页。字体行框不参与行宽缩放因子的计算。组合能力未声明时保留原拒绝行为，单独声明但未使用该组合不改变旧结果。`pageWindow` 可以同用。未声明能力时返回 `CAPTION_CAPABILITY_UNAVAILABLE`，没有固定行模式、与上述字段同用或数值越界返回 `CAPTION_SCENE_INVALID`。示例见 [fixed-line-fit.json](../../crates/caption-scene/tests/fixtures/fixed-line-fit.json)。

`caption-page-tag/1` 开放 `pagination.pageTags`：与 `wordLinePattern` 等长的整数列表，每项取 0–65535，第 i 项是计划第 i 页的标签。一条 cue 的第 p 页（零基）由计划第 p mod n 项（n 为计划页数）排出，读第 p mod n 个标签；`lastPageRule` 改写的页保留它所在位置的标签，`tailWordRule` 只去掉末页，都不移动其余页的标签。表达式读取 `unit.pageTag`（scalar）：每种单元及其 repeat 装饰都读当前页的标签，页身份与 `unit.pageIndex` 一样按冻结的源文本范围匹配。标签只取决于页序号，不依赖排版，字号绑定可以读取。核心不解释标签：导入器把来源按页选定的样式编号写成标签，由场景表达式分支，同样的页形状因此可以有不同样式。未声明能力时 `pagination.pageTags` 与 `unit.pageTag` 返回 `CAPTION_CAPABILITY_UNAVAILABLE`；没有 `wordLinePattern`、长度与计划页数不等或标签越界返回 `CAPTION_SCENE_INVALID`；声明了能力但没有 `pageTags` 时读取 `unit.pageTag` 也返回 `CAPTION_SCENE_INVALID`。示例见 [page-tag.json](../../crates/caption-scene/tests/fixtures/page-tag.json)。

固定模式下，词成员、页显示时间与行原始字节范围在准备阶段冻结，除声明 `fixedLineOverflow: 'wrap'` 的行内续行外，不能因宽度不足额外折行、拆词或增加页。`overflow: error` 对超宽行返回 `CAPTION_LAYOUT_OVERFLOW`；visible 允许越过声明行宽。每页行数必须不超过 maxLines。页从首词时间开始（leadingGap仍适用），到下一页首词开始，末页到cue结束；无词时间时沿用已声明的估算/可用时钟策略。

固定模式的显示行折叠已有空白（包括自然换行）为一个空格，并隐藏行首尾空白；原本没有空白的词之间不会插入空格。标点不删除：行边界位于下一行首词的起始字节，词间非空白分隔符保留在前一行。源正文、词ID/byte range/span保持原样；shape使用临时规范化字符串，glyph cluster必须映射回原始行字节，因此 `unit.textIndex/textCount`、pageText索引及空白选择器继续以原文的字素为准，不变成显示字符串索引。逐采样布局复用相同的行shape及映射流程，只重算几何，不改变已冻结的词、行、页范围或时间。示例见 [word-line-layout.json](../../crates/caption-scene/tests/fixtures/word-line-layout.json)。

`caption-pattern-select/1` 开放分页程序 `pagination.patternSelect: { by: 'word-count' | 'seed', candidates: [{ id, wordLinePattern, lastPageRule?, minWords?, maxWords? }] }`，在准备阶段为每个 cue 的每个文字节点从候选固定词行模式中选一个，再按上述 `wordLinePattern`/`lastPageRule` 合同消费词。未声明能力返回 `CAPTION_CAPABILITY_REQUIRED`；与 `wordLinePattern`、`textLinePattern`、`maxUnitsPerPage` 和顶层 `lastPageRule` 互斥，也不与 `wordPagePattern`、`maxUnitsPerLine`、`tailWordRule`、`remainingWordPagePlans`、`fixedLineOverflow`、`fixedLineFit`、`pageTags` 同用（返回 `CAPTION_SCENE_INVALID`）。候选 1–64 个，id 唯一且符合标识规则，每个候选的模式与可选 lastPageRule 受与直接模式相同的限制（含每页行数不超过 maxLines）。`word-count` 以该文字节点 TextLayout 的词数 `n` 选择：除最后一个外每个候选必须声明闭区间 `minWords<=n<=maxWords`（0–4096，区间互不重叠），最后一个候选不得声明区间，作为兜底；按声明顺序取第一个命中者。`seed` 模式的候选都不得声明区间，以实例 `presentation.seed`（64 位）、cue id 为键并固定通道，用表达式 `random` 的同一哈希得到 `u∈[0,1)`，取下标 `min(floor(u*count), count-1)`；同一 seed 与 cue 在任何词数、时刻与执行端得到同一候选，同一 cue 的各文字节点也选同一候选。选择只依赖冻结输入，不读时间、不写回实例；每个选中结果以诊断 `CAPTION_PATTERN_SELECTED`（path 为 cue id，detail 为 `node=<节点id> candidate=<候选id> words=<n>`）报告，不中断绘制。例如候选 `[0,2]→[[2]]`、`[3,3]→[[3]]`、`[4,4]→[[2,2]]`、`[5,5]→[[1,1,1,1,1]]`、`[6,6]→[[1,1,4]]`、`[7,7]→[[2],[1,1,1,1,1]]`、`[8,8]→[[2],[1,1,4]]`、兜底 `[[3],[2,2]]`，在 1/7/10 词时分别得到 `[[1]]`、`[[2],[1,1,1,1,1]]`、`[[3],[2,2],[3]]`。示例见 [pattern-select.json](../../crates/caption-scene/tests/fixtures/pattern-select.json)。

`caption-keyword-isolation/1` 开放 `pagination.isolation: [{ tag, mode: 'none' | 'line' | 'page' }]`（1–32 项，tag 非空、不超过 64 字节且唯一），只读取 `presentation.wordTags` 的显式标签，不从文案、字体或样式推断关键词；未声明能力返回 `CAPTION_CAPABILITY_REQUIRED`。它只用于固定词行（`wordLinePattern` 或 `patternSelect`），不能与 `textLinePattern`、默认分页或任何 `lastPageRule` 同用，也不与 `wordPagePattern`、`maxUnitsPerLine`、`tailWordRule`、`remainingWordPagePlans`、`fixedLineOverflow`、`fixedLineFit`、`pageTags` 同用。一个词带多个命中标签时取最强模式（page > line > none）。隔离在候选页构造前、只在词边界插入硬边界，不拆词：`line` 结束当前行，被隔离的词独占一行，其后的词从下一行配额开始；`page` 结束当前页，被隔离的词独占只有一行的一页，其后的词从下一页开始。被提前结束的行或页仍各占用一个行配额或一个页模式，行配额用尽即换页；因此边界只会缩短行和页，不会超过行配额或 maxLines，也不静默放宽上限，被隔离词超宽时仍按 overflow 处理（error 返回 `CAPTION_LAYOUT_OVERFLOW`）。选择器的 index/count 按最终成员计算。例如 `[[2,2]]` 加 5 个词、第二个词隔离：line 得到 `[[1,1],[2,1]]`，page 得到 `[[1],[1],[2,1]]`；`[[3]]` 中第二个词 line 隔离得到 `[[1],[1],[3]]`。示例见 [keyword-isolation.json](../../crates/caption-scene/tests/fixtures/keyword-isolation.json)。

`caption-tag-run-isolation/1` 开放 `pagination.tagRuns: { tag, mode: 'line' | 'page' }`，只读取 `presentation.wordTags` 的显式标签：词带 `tag` 为标记状态，否则为普通状态，相邻两个词状态不同的位置是一个段边界（第一个词之前没有边界），不从文案、字体或样式推断；未声明能力返回 `CAPTION_CAPABILITY_REQUIRED`，`tag` 非空且不超过 64 字节。它只用于按宽度换行的默认分页，可与 `maxUnitsPerPage`、`maxUnitsPerLine` 同用；不能与 `wordLinePattern`、`patternSelect`、`textLinePattern`、`wordPagePattern`、`remainingWordPagePlans`、`lastPageRule`、`tailWordRule`、`fixedLineOverflow`、`fixedLineFit`、`pageTags` 或 `isolation` 同用，`pageWindow` 本身要求固定行或词页模式，因此也不可同用。与 `isolation` 的区别：`isolation` 让被隔离的词独占一行或一页，两个连续的标记词会各占一行；`tagRuns` 让连续同状态的词（一段）留在一起，只在状态变化处断开，段内仍按宽度和 `maxUnitsPerLine` 换行。`line`：任何显示行都不跨越段边界，边界处结束当前行，下一段从新行开始；强制结束的行仍占用页内行配额，行配额用尽即换页。`page`：在段边界结束当前页，下一段从新页开始，`maxUnitsPerPage` 在每段内重新计数，页内状态单一，页内换行照常。折行规则在冻结布局、逐采样布局（`caption-layout-per-sample/1`）和单元字号重排（`caption-unit-font-reflow/1`）中相同：页成员在基础字号下冻结，之后每次重排只在页内重新折行，且仍不跨越段边界。边界只缩短行和页，不放宽上限，不拆词；被拆开的超长词仍按字素回退，边界只落在词起点。例如 `Alpha beta gamma delta epsilon zeta` 中 `beta gamma delta` 带标签：`line` 得到三行 `Alpha` / `beta gamma delta` / `epsilon zeta`，`page` 得到三页；`page` 配合 `maxUnitsPerPage: 2` 得到成员 `[0] [1,2] [3] [4,5]`，而不带 `tagRuns` 的同一配额得到 `[0,1] [2,3] [4,5]`。示例见 [tag-run-isolation.json](../../crates/caption-scene/tests/fixtures/tag-run-isolation.json)。

`caption-function-dag/1` 显式选择纯函数依赖图的编译验证预算：每个根表达式及每个函数 body 的物理 AST 分别最多 4096 个节点；一个根可达的唯一函数依赖图连同根表达式最多 16384 个节点，每个函数 body 只计一次。每次调用点的参数 AST 仍在所属根/body 中逐项计数、检查类型与参数个数；已验证函数的类型摘要可复用，使用中的函数再次被访问时拒绝递归。所有声明函数即使未被使用，也独立检查参数、返回类型及依赖。展开求值路径深度最多 64，复用摘要时仍把函数内部深度计入调用点，不能通过共享函数绕过限制。未声明此能力时仍按旧规则重复展开计入 4096 节点预算，不静默放宽旧场景。此能力只改变编译验证的计数方式；执行时每个节点仍照常消耗共享 65536 次操作预算，不缓存函数求值结果或提高运行预算。布局/材质的提前依赖检查同样按唯一函数遍历，仍拒绝读取尚未产生的布局或单元状态。

表达式内置 `shuffle-index(index, count, seed)` 接受三个 scalar，返回 scalar 类型的零基置换值；index/count 必须是整数且 `1 <= count <= 8192`、`0 <= index < count`，seed 必须有限，否则返回诊断。seed 先向零截断，再按 2³² 取非负余数作为状态；不使用实例 seed 或稳定键暗中混入随机性。初始化数组 `[0, 1, …, count−1]`，按 `current = count−1 … 1` 执行 Fisher–Yates：每步状态为零时先替换成 123459876；计算 `state = 16807 × (state % 127773) − 2836 × floor(state / 127773)`，负值加 2147483647；`random = (state % 2147483647) / 2147483647`，`j = floor(random × (current+1))`，交换 array[current]/array[j]。该函数返回 array[index]；相同参数在任意播放/seek 顺序下相同，模板应声明 `caption-permutation/1`。

置换首次生成除表达式节点预算外，收取 count 次初始化与 count−1 次交换预算，先核对预算再分配/计算。同一个求值 Budget 可缓存规范化 `(count, seed)` 的结果，最多 16 项、总共 16384 个 u16 索引；命中后仍收取通常的调用与参数节点成本，缓存满时重新计算并照常收费。缓存仅属于本次预算，不跨帧共享，不改变置换结果；超限返回 `CAPTION_BUDGET_EXCEEDED`，不返回部分置换。

表达式内置 `cubic-bezier(progress, x1, y1, x2, y2)` 接受五个 scalar，返回 scalar，复用共享 motion 求解器。progress 在两端截为 0/1，x 控制点必须在 [0,1]，y 允许超调；参数非有限或 x 越界返回诊断。可与 `elapsedSeconds / min(durationSeconds, 固定时间)` 组合，实现随单元时长自适应的曲线，不依赖播放历史。使用该函数的模板应声明 `caption-bezier-expression/1`。

表达式内置 `exp(scalar)` 返回 scalar，计算自然指数 `e^x`，使用共享 `libm::exp` 的 f64 结果。必须显式声明 `caption-exponential-expression/1`；普通及 DAG 类型验证、函数间接调用和直接求值均检查该能力，缺失返回 `CAPTION_CAPABILITY_UNAVAILABLE`。只接受一个 scalar，不隐式转换 integer、time 或其他单位；函数名保留，不能由自定义函数覆盖。输入非有限或结果溢出为非有限时返回 `CAPTION_SCENE_INVALID`，不截断为最大值；负指数下溢得到有限的零是合法结果。与其他函数共用 AST、深度和执行预算，任意 seek 时重新求值，不作关键帧采样近似。

取整、取模、幂与列表取值四组内置函数各自按能力门控；普通及 DAG 类型验证、函数间接调用（含未被引用的函数体）和直接求值都检查对应能力，缺失返回 `CAPTION_CAPABILITY_UNAVAILABLE`。名称 `round/mod/fract/pow/pick` 保留，不能由自定义函数覆盖；参数只接受 scalar（`pick` 的序号另见下文），不隐式转换 integer、time 或其他单位。native 与 WASM 使用同一 f64 实现，结果非有限时返回 `CAPTION_SCENE_INVALID`。

| 函数 | 能力 | 合同 |
| --- | --- | --- |
| `round(x)` | `caption-rounding-expression/1` | 取最近整数，恰在 .5 时远离零（`round(2.5)=3`、`round(-2.5)=-3`），使用 `libm::round` |
| `mod(a, b)` | `caption-modular-expression/1` | 向下取整取模：结果与除数同号，`b>0` 时落在 `[0,b)`，`b<0` 时落在 `(b,0]`；先 `fmod` 再按除数符号补一个 b，补后恰等于 b 的结果（如 `mod(-1e-20, 2)`）归零。`b=0` 返回 `CAPTION_SCENE_INVALID`（zero divisor） |
| `fract(x)` | `caption-modular-expression/1` | 定义为 `mod(x, 1)`，结果在 `[0,1)`；负数 `fract(-0.25)=0.75` |
| `pow(base, exponent)` | `caption-power-expression/1` | 两个 scalar，使用 `libm::pow`；负底数配非整数指数返回 `CAPTION_SCENE_INVALID`，`pow(0, 负数)` 与溢出走非有限结果拒绝；`pow(0,0)=1` |
| `pick(list, index)` | `caption-list-pick/1` | 第一个参数必须是 `{op:'read', path:'params.<id>'}` 且该参数声明为列表；返回元素类型。index 为 scalar 或 integer，值必须是有限整数，按欧几里得取模 `index mod count`（负数从末尾回绕，`-1` 取最后一项）；非整数返回 `CAPTION_SCENE_INVALID` |

列表参数在 `parameters[]` 上写 `list: true`，`type` 为元素类型（scalar/integer/length/time/angle/bool/color 均可），`default` 是 1–256 个同类型元素的 JSON 数组，`min/max` 逐元素检查。声明列表参数必须同时声明 `caption-list-pick/1`。样式、实例与 cue 覆盖按普通参数的次序整体替换列表，可以改变长度，但仍须是非空、同类型、不越界的数组；空数组、非数组、混合类型返回诊断。全部列表参数解析后的元素总数不超过 1024，超出返回 `CAPTION_BUDGET_EXCEEDED`。列表参数只能经 `pick` 读取：直接 `read` 返回 `CAPTION_EXPRESSION_TYPE`，长度字段的 `parameter` 不能引用列表参数。`list` 省略即 false，序列化时省略，旧正文逐字节不变。`pick` 与 `shuffle-index` 组合即按 seed 置换后取值，两者都不读取时间。可运行示例见 [builtin-expressions.json](../../crates/caption-scene/tests/fixtures/builtin-expressions.json)。

关键帧 clock 可写 `tail: 'none' | 'clamp' | 'repeat'`，决定原点之后的周期进度 `u`；省略即 `none`，序列化时不写出，旧文档字节与像素不变。非 `none` 必须显式声明 `caption-clock-tail/1`，缺失返回 `CAPTION_CAPABILITY_REQUIRED`；与 `clock.repeat` 同时出现返回 `CAPTION_SCENE_INVALID`（两者都改写周期进度，不叠加）。`none`：`u=(t-origin)/D`，可超过 1。`clamp`：原点之后取 `min(t-origin, D)/D`，与表达式字段 `time.clampedProgress` 的上端一致，原点之前不改写；零时长仍是一步跳变。`repeat`：原点之后取 `mod(t-origin, D)/D`（向下取整取模，同 `mod` 函数），落在 `[0,1)`，周期右端点 `t=origin+kD` 属于下一周期、取 `u=0`；没有终点，原点之前不回绕。固定零时长在验证时返回 `CAPTION_SCENE_INVALID`，`unit-span` 在采样时取得零时长同样返回该诊断。`tail` 只决定数值，是否参与仍由 `fill` 决定：`u` 小于首个 key 用 `fill.before`，`u` 不小于末个 key 用 `fill.after`。因 key 的 `at` 位于 `[0,1]`，`clamp` 的取值与 `none` 一致，声明它只表明意图；`repeat` 末个 key 早于 1 时，各周期尾段仍按 `fill.after` 参与或不参与。示例见 [clock-tail.json](../../crates/caption-scene/tests/fixtures/clock-tail.json)。

`caption-text-context/1` 增加 `unit.textIndex/textCount`（当前文字节点完整内容中的 Unicode 字素位置/数量）和 `unit.pageTextIndex/pageTextCount`（当前页的源文本范围内位置/数量）；空格、换行和组合字素按原文计数，重排不改变它们。`time.cueDurationSeconds` 是整个 cue 的时长，`time.pageElapsedSeconds/pageDurationSeconds` 是当前页经过的时间/时长，类型均为 time，repeat 装饰继承所绑定单元的上下文。旧 `unit.index/count` 的局部含义保持不变。

选择器可显式设置 `includeWhitespace: true`，仅用于 grapheme。默认 false，保持既有选择集合。开启后空白字素也可绑定装饰；行尾未成形的空白定位于前一行末端，无真实词时间，grapheme 时钟继承行窗口。字素上下文按源顺序编号，不依赖装饰是否可见。布局前只允许 cue 时间字段，禁止读取页时钟或排版产生的字素字段。内置 `sqrt(scalar)` 返回 scalar，负输入报诊断；模板应声明上述能力。

`caption-unit-context/1` 增加 `unit.pageIndex/pageCount`（scalar，文字节点固定分页中的零基页序号/总页数），每种单元和其 repeat 装饰都可读取。页身份使用冻结的源文本范围匹配，因此逐采样重排产生新的行或页副本后也不会回到第零页；原有 `unit.index/count` 仍表示当前单元类型的局部序号。

`caption-cue-word-context/1` 提供原始输入词边界：`time.cueFirstWordStartSeconds/cueFirstWordEndSeconds/cueSecondWordStartSeconds` 为相对 cue 起点的 time，分别对应 `cue.words` 输入顺序中非空文本 token 的第一词起止与第二词开始；`unit.cueFirstWordTimed/cueSecondWordTimed` 为对应 bool 可用标记。所有单元和绑定装饰读取同一份 cue 信息，不随分页改变，也不按时间重新排序；静态文字节点可以读取所属 cue 的这组元信息。

真实绑定的 Word/Grapheme 及其 repeat 装饰另有 `unit.wordTimed`，以及跨分页、按全局原词成员顺序查下一词的 `time.nextWordStartSeconds`（相对 cue 起点）与 `unit.nextWordTimed`。cue/page/line 和未绑定词的空白单元，其 current/next 标记始终 false，next 时间为 0；静态文字和 estimated 推导词时间也不会被标成真实绑定。任何缺失的对应输入时间均返回 0/false，真实负边界、零边界和零时长完整保留，因此模板必须看 bool 区分缺失。核心不延长 word.end，不填平真实 gap；需要按下一词开始调整外部效果窗口的模板自行用只读字段计算。上述新增字段均禁止布局前读取。示例见 [cue-word-context.json](../../crates/caption-scene/tests/fixtures/cue-word-context.json)。

`caption-speech-phase/1` 开放朗读区间的只读布尔，和 active/read/unread 三态并存，不形成第四个词状态；未声明时读取返回 `CAPTION_CAPABILITY_UNAVAILABLE`，布局前与字号求值直接或间接读取返回 `CAPTION_DEPENDENCY_CYCLE`。cue 级 `cue.speechPhase.beforeFirst/reading/afterLast` 由该 cue 全部非空输入词的最早开始 `S` 与最晚结束 `E` 决定：`t<S` 为 beforeFirst，`S<=t<E` 为 reading（词间空隙仍算 reading），`t>=E` 为 afterLast；有依据时三者恰有一个为 true，所有单元（含 repeat 装饰与材质页上下文）读到同一值。`word.inSpan` 只在绑定词的 Word/Grapheme 单元及其 repeat 装饰上按该词区间 `start<=t<end` 判断，重叠词可同时为 true，零时长词不为 true；cue/page/line 与空白字素恒为 false，不改变活动词选择。没有真实词时间时遵循 timingPolicy：`require-word-timing` 下四个 cue 字段与 `word.inSpan` 都为 false，准备阶段对该 cue 推送 `CAPTION_TIMING_UNAVAILABLE`（不中断绘制）；显式 `estimated` 下 `S/E` 取 cue 起止、`word.inSpan` 使用均分的估算词区间，并以 `cue.speechPhase.estimated=true` 与 `unit.wordTimed=false` 标记估算，不冒充真实词时间。示例见 [speech-phase.json](../../crates/caption-scene/tests/fixtures/speech-phase.json)。

`caption-cue-unit-context/1` 必须显式声明后才能读取整段逻辑单元索引；未声明时验证返回 `CAPTION_CAPABILITY_UNAVAILABLE`，不隐式启用额外排版。`unit.cueWordIndex/cueWordCount`（scalar）以当前文字节点 TextLayout 的全部词成员为零基顺序，Word 碎片和其 Grapheme 跨行/跨页保持同一词序号；由 `unit.cueWordBound`（bool）标识有效绑定。词成员可来自真实输入或显示分词，此标记与 `unit.wordTimed` 的时间真实性不同，不以全文字素索引代替词序号。`unit.cueLineIndex/cueLineCount` 按整个 cue 所有页的视觉行逻辑顺序计数，Line/Word/Grapheme 及空白装饰继承所属行，由 `unit.cueLineBound` 标识。对应没有词/行绑定的单元返回 index=0、count=0、bound=false；原 `unit.index/count`、`selectedIndex/selectedCount` 含义不变。

`unit.cueSelectedIndex/cueSelectedCount`（scalar）及 `unit.cueSelectionAvailable`（bool）只在动画 target 或 repeat 明确绑定 word 选择器，且整个 filter 仅含 All、Tag 及 And/Or/Not 组合时有效：按全 cue 所有匹配词排序，包括当前不可见页。Tag 只读取 `Presentation.word_tags`，不从文案、字体、颜色或动画推断关键词。State、Range、Parity、含这些条件的组合、非 word 选择器或未明确绑定均返回 0/0/false。普通属性不借用其他选择器；repeat 子装饰继承其选择器，动画逐条重新绑定，不泄漏前一轨的选集。各选择器匹配表按文字节点在本次求值中共享，每个词及布尔过滤节点计入操作预算。

只在声明本能力的场景中，逐采样排版才在同一时刻重排整个 cue 的全部页，以计算真实全局行前缀及总数；前后页均计入既有重排预算，不能静默采用旧行数。固定 `wordLinePattern` 使用冻结行数，只重排当前页的绘制几何。未声明能力的场景继续仅重排当前页。所有新增字段禁止布局前读取，见 [cue-unit-context.json](../../crates/caption-scene/tests/fixtures/cue-unit-context.json)。

`caption-first-page-context/1` 暴露当前文字节点固定第一页成员的真实输入边界：`time.firstPageFirstWordStartSeconds`、`time.firstPageLastWordEndSeconds`、`time.firstPageNextWordStartSeconds`，以及对应 `unit.firstPageFirstWordTimed/firstPageLastWordTimed/firstPageNextWordTimed`。另提供当前页的 `time.pageFirstWordStartSeconds/pageNextWordStartSeconds` 与 `unit.pageFirstWordTimed/pageNextWordTimed`。所有 time 均相对 cue 起点；next 指页末词之后的下一全局原词，不受当前页显示窗口或采样位置限制。当前页所有单元及其绑定装饰共享这些值，逐采样重排保持固定成员身份。静态文字、estimated 或缺少对应输入词时返回 0/false；零、负边界及真实 gap 保持不变。第一页末词结束与页面显示结束明确区分，不把延至下一页或 cue 结束的显示窗口当作词结束。上述字段均禁止布局前读取，见 [first-page-context.json](../../crates/caption-scene/tests/fixtures/first-page-context.json)。

`time.lineElapsedSeconds/lineDurationSeconds`（time）提供所属行的词时间窗口，line/word/grapheme 及其装饰继承同一组值。cue/page 没有唯一所属行时明确回退到自身窗口。无词时间的行使用当前页显示窗口供视觉定时，但不据此伪造朗读状态。elapsed 不截断，持续时间可为零，表达式需自行保护除法。上述页序号和行时钟均禁止在布局前读取。

line 的 active/read/unread 状态按该行词成员求值：当前选中的活动词属于该行即 active，继承 gapPolicy/tailPolicy 的保持策略；没有活动词时，只有该行所有词都有时间且均已结束才为 read，其余为 unread。没有真实词时间且未显式启用 estimated 时保持 unread。此修正也适用于既有行选择器。示例见 [unit-context.json](../../crates/caption-scene/tests/fixtures/unit-context.json)。

`caption-ink-context/1` 增加六个 length 类型的只读布局字段：`layout.inkX/inkY/inkWidth/inkHeight` 是当前单元字形填充墨迹的包围框；`layout.lineInkY/lineInkHeight` 是所属完整视觉行的墨迹顶部与高度，适合让光标和底框不受行间距、当前字母大小写影响。坐标为排版后的画布像素，尚未施加动画变换；不包含描边、阴影、发光、材质或字色/opacity。矢量轮廓使用曲线的紧包围框，彩色字形使用非零 alpha 像素的边界；按现有 cluster 归属聚合，不拆连字。旧 `layout.x/y/width/height/baseline` 保持 advance 与行框含义。

空白或无可绘制墨迹的单元，其 inkX/inkWidth 保留原有 advance/caret，inkY/inkHeight 继承所属行的墨迹框；整行无墨迹时使用该行字体的 ascent/descent 框，不使用 lineHeight。cue/page 的墨迹框是当前页各个有墨迹行的并集，此时 lineInkY/lineInkHeight 同该并集；当前页全为空白才使用各行字体框并集。逐采样重排同时更新这些值，读取墨迹不会改变固定分页成员和时间。布局前表达式禁止读取这些字段，避免循环依赖。示例见 [ink-context.json](../../crates/caption-scene/tests/fixtures/ink-context.json)。

`caption-glyph-envelope/1` 必须显式声明后才能读取以下布局后字段；未声明返回 `CAPTION_CAPABILITY_UNAVAILABLE`，布局前直接或间接读取仍返回依赖诊断。它使用现有行字体度量和未涂装字形墨迹，不修改 `layout.width/height`、ink 字段、原排版或像素。

- `layout.lineEnvelopeY/lineEnvelopeHeight`（length）给出所属整行的垂直包络。以基线 B、该行既有 ShapedLine 字体 ascent/descent、实际 glyph 墨迹 top/bottom 计算：`up=max(0,ascent,B−minInkTop)`、`down=max(abs(descent),maxInkBottom−B)`，Y=B−up、Height=up+down。无墨迹时仅用字体度量。该框不含 leading、描边、阴影、材质或动画变换，也不因当前词字母较矮而缩小。
- `layout.firstInkLeft/lastInkRight`（length）给出当前单元范围内首个/末个有墨迹字形的水平边缘。按 UTF-8 源 cluster.start 升序选择，同一 cluster 保留原 shaped glyph 次序，归属条件为 cluster.start 落在该范围内。端点不是 advance，也不是范围内全部墨迹的 union；中间字形 overhang 不扩展两端。RTL 或重叠字形可能使 firstInkLeft 大于 lastInkRight，内核不交换、不取绝对值来伪造正宽矩形。
- `unit.lineEnvelopeAvailable/rangeInkAvailable`（bool）分别表示行绑定和范围内墨迹是否存在。Line/Word/Grapheme 使用其所属行，跨行词按当前行碎片计算；空白等无墨迹范围返回水平 0/0、rangeInkAvailable=false，但仍具有所属行的垂直包络。Cue/Page 没有唯一行绑定，四个数值为 0、两个标记均为 false，即使当前恰好只显示一行也不隐式绑定。合字归属于 cluster 起点所在单元，后续单元不能借用同一字形。

repeat 装饰继承绑定单元的包络；逐采样排版与反馈历史在各自时刻重新从同一排版结果构建字段。只有声明能力的场景执行附加的每行字形排序/单元查询，并按字形与单元计入操作预算；未声明场景保持原记录和像素路径。当前矢量墨迹来自 tight Bézier bounds，彩色字形来自非零 alpha 像素框；字体度量沿用共享排版器的取值规则。这是明确的内部几何合同，不承诺与其他字体 API、字体表原始 bbox 或不同 ligature/RTL 切分结果相同。示例见 [glyph-envelope.json](../../crates/caption-scene/tests/fixtures/glyph-envelope.json)。

`caption-page-envelope/1` 显式开放当前页的布局后度量，供材质和普通单元表达式共享；未声明时读取返回 `CAPTION_CAPABILITY_UNAVAILABLE`：

- `layout.pageEnvelopeY/pageEnvelopeHeight`（length）：将当前页每行的字体与未涂装字形垂直包络求并集。每行公式与 lineEnvelope 相同；包含行基线之间的实际距离，但不加入第一行上方/末行下方的 lineHeight 余量，不包含涂装、节点/动画变换。它不是 page ink union，也不覆盖现有 `layout.height`。
- `layout.pageMaxFontSize`（length）：当前页实际求值后的最大字号；普通排版取 resolved fontSize，逐单元字号布局取与各行源字节范围相交的已覆盖 size runs 的最大值。空格、空白行以及规范化时不绘制的源空白仍保留其有效字号；不能从可见 glyph 的 cache key 推断，也不能退回旧 base fontSize。记录该字段不改变已有行高计算。
- `unit.pageLineCount`（scalar）是当前页实际排版行数；`unit.pageEnvelopeAvailable`（bool）表示存在当前页行度量。有占行的空白行使用实际字体 ascent/descent，标记 true；若规范化空串的缓存 shape 尚无字体度量，则用该行实际字号、family/weight/italic 测量空格，以该行 bounds.y 为字体框顶部，仅补充本能力的包络，不修改原 baseline/ink。没有页/行绑定时三个 length 与 count 均为 0，标记 false。

Cue/Page/Line/Word/Grapheme 及 repeat 绑定单元均继承同一份当前页结果；它与所选词/字是否有墨迹无关。绑定唯一 Text 的材质页上下文同样可读，不通过猜测唯一行来改写旧 lineEnvelope 的不可用合同。逐采样排版、字号重排、反馈历史采样各自在该时刻重新构建结果；每页计算一次、单元共享，新增工作按行与单元计入预算，字号区间查询另按访问的 run 计费。布局和字号求值前禁止直接或通过函数读取这些字段（包括 count/available），避免循环依赖。省略能力不增加该度量查询工作，也不改变旧场景像素。示例见 [page-envelope.json](../../crates/caption-scene/tests/fixtures/page-envelope.json)。

**显式页/行显示窗口**。可选 `layout.pageWindow` 必须声明能力 `caption-page-window/1`，仅接受显式固定 `wordLinePattern`/`textLinePattern`/`remainingWordPagePlans` 或固定页词成员的 `wordPagePattern`、`leadingGap: 'hide'` 和 `speechState.timingPolicy: 'require-word-timing'`；`wordPagePattern` 仍须声明 `caption-word-page-layout/1`。普通按宽度分页与 `maxUnitsPerPage` 不在此能力的接纳范围。字段全部必填：

```typescript
pageWindow: {
  gapThreshold: { ticks: number; timescale: number };
  shortGap: { before: number; after: number };
  longGap: { before: number; after: number };
  boundary: 'start-inclusive-end-exclusive' | 'first-start-inclusive-end-inclusive';
}
```

threshold 是非负、安全整数刻度的时间，timescale 必须大于零；两组 before/after 均须有限且在 [0,1]，各自之和不超过 1。实际所有绑定词必须有真实输入时间、正时长、按成员顺序单调且无重叠；独立全空白词记录、缺少时间、estimated/static 字词或非法窗口返回 `CAPTION_PAGE_WINDOW_INVALID`，不能先修正输入再继续。此能力的输入接纳范围比普通字幕更窄，不改变其他场景对零时长或未计时单元的合同。

对于相邻原始词，令前词原始结束为 e、后词原始开始为 s、gap=s−e。gap≤threshold 时使用 shortGap，其他情况使用 longGap；前词的显示结束为 `e+gap×after`，后词的显示开始为 `s−gap×before`。当 before+after 恰为 1，两侧必须共用同一个 `cut=e+gap×after`，避免独立浮点计算形成伪重叠。无前词的首开始、无后词的末结束保留原边界；不将首窗口提前到 cue 起点，也不将末窗口延至 cue 尾部。

固定页及其行分别取成员顺序首词的显示开始和末词的显示结束作为派生窗口；必须为正有限时长，邻接页/行不能重叠。`wordPagePattern` 保留原页词成员和完整源范围，包括页首分隔空白；显示窗口不重分配源字节。若页内折行导致相邻行的派生窗口重叠，同样明确拒绝。派生窗口保留未裁的时间供 page/line 时钟使用；真正绘制仍先受到外层 cue 的 `[start,end)` 约束。该功能不改词/字素的原始 span、真实首末词/下一词上下文或朗读状态；空白字素也保留原来的原始行时间 fallback。只有 page/line 显示时钟改用派生范围，因此不能将页显示结束读成末词原始结束。

`start-inclusive-end-exclusive` 对所有页使用 `t>=start && t<end`。`first-start-inclusive-end-inclusive` 对第一页使用 `t>=start && t<=end`，其余页使用 `t>start && t<=end`：共享边界属于前页，后页的孤立精确 start 也不显示，中间留空的长 gap 不继承上一页。页按固定顺序查找；最终 cue.end 始终受外层半开区间约束。窗口在编译时固定，普通逐采样重排及混合字号重排只继承对应行的窗口，成员变化拒绝，反馈历史按每个请求时刻重新查询同一组窗口。

未提供 pageWindow 时保留既有页时间、leadingGap、缺词时间回退和半开边界行为，序列化不新增空字段。该能力不开放任意调度脚本、输入词纠错或未声明的字宽分页。示例见 [page-window.json](../../crates/caption-scene/tests/fixtures/page-window.json)，需同时提供真实词时间。

**绑定文字装饰**。能力 `caption-bound-label/1` 增加 `type: 'label'`，只能作为 `repeat` 的直接子节点。它是 leaf，必须使用 `text: { source: 'static', text }`；正文最多 4096 UTF-8 字节，拒绝 CR/LF、VT/FF、NEL、Unicode line/paragraph separator 等硬换行。不能绑定 cue、声明自己的 selector/resource/children/stateStyles，也不接受 width/height/radius。它继承 Repeat 所选源单元的语义时钟、选择器与几何上下文，不另建 cue、page、word、grapheme 或命中框；selector 的文字目标仍只能是 Text。

label 的静态 `TextStyle` 包含自己的字体族、字重、斜体、字距、填色、描边与有序 paints，沿用文字的 paint 冲突规则。基础字号来自 `style.fontSize: Length`，可由 label 专用 `properties.fontSize` 或指向 label 的动画覆盖；动态字号类型为 length，最终必须在 1..4096 像素内，超限报错而不 clamp。布局字号绑定仍只能指向 Text。字号先在绑定源单元上下文计算，再用共享字体引擎整形单行；自身 advance 宽度和 ascent + abs(descent) 字体高度的中心与绑定框中心重合，`lineHeight` 不给这个单行装饰增加 leading。之后按同一个绑定中心应用变换与 opacity；字号变化不挤动源词或改变分页。

后置 label pose 可读 `layout.labelWidth`（advance）、`layout.labelHeight`（字体包络高度）、`layout.labelMaxGlyphInkWidth/labelMaxGlyphInkHeight`（各实际 glyph 的填充墨迹宽/高分别取最大值，length）及 `unit.labelInkAvailable`（bool）。无墨迹返回 0/0/false。它们不包含描边、paint 偏移或变换，也不等同带 padding 的字形纹理框。旧 `layout.*` 字段仍描述绑定的源单元。上述 own metrics 仅在 label 的非字号绘制属性/动画可用；直接或通过函数用于字号、其他节点、布局或材质都拒绝，避免两阶段求值的循环。

整形复用以文字、字体、字号、字重、斜体、字距为键的有界共享缓存；每次访问仍对文字字节、glyph 与 paint 收取操作预算，单行度量不得超过 65536 像素。字体依赖在准备时登记，未显示的标签也不会漏报缺字体。矢量字形与普通 Text 共用描边/paint 记录；彩色字形保留自身 RGBA，不用 fill RGB 重染，节点 opacity 在外层应用一次。反馈历史在各采样点重新求字号和 pose。示例见 [bound-label.json](../../crates/caption-scene/tests/fixtures/bound-label.json)。

**逐采样布局**。`layout.bindings` 是最多 64 项的 `{ nodeId?, property, value: DynamicValue }` 数组。同一目标/属性不能重复。无 nodeId 的目标是场景的 width/x/y（length）；指定文字节点时可改 fontSize（length）、letterSpacing（scalar，em）与 lineHeight（scalar）。只有 `per-sample` 模式接受 bindings。静态字段先确定基础页成员、源文本字节区间及显示起止时间；每次采样只重新布局当前页，不将溢出文字移到新页。`overflow: 'error' | 'visible'` 默认 error：超过 maxLines 或单个字形仍超宽则报 `CAPTION_LAYOUT_OVERFLOW`；visible 保留所有页成员并允许更多行，最终仍按画布裁剪。

布局表达式（包括间接调用的纯函数）只可读取参数、cue 时钟、cue 的稳定 index/count 与画布尺寸；不能读 layout、活动词或动态选择集合，关键帧只能使用 cue 时钟。布局阶段禁止依赖自身产生的行、页或框。动态字号限 1–4096 px、行高 0.1–10、字距 −2–10 em；非法采样结果拒绝。共享文字缓存已有字节预算，变化的字号不会无限累积缓存。行/词/字形框及装饰节点在重排后从同一结果计算。

**按语义单元重排字号**。显式能力 `caption-unit-font-size/1` 开放 `layout.fontSizeBindings: [{id,nodeId,selectorId,value}]`，最多 64 项、id 唯一，value 为 length 类型 DynamicValue，字号限 1–4096 输出像素。目标必须是 Text，选择器必须引用同一 Text 的 page/line/word；不支持 grapheme 或额外 composite/priority。非空绑定要求 `layoutEvaluation: 'per-sample'`，且显式使用 `wordLinePattern`、`textLinePattern` 或 `remainingWordPagePlans` 固定页/行成员，或者声明 `caption-unit-font-reflow/1` 让按宽度换行的页逐采样重新折行（见下文）。不能借此按动态字宽重新分页。

每次采样先执行既有 cue 级 `layout.bindings`，取得当前整节点基础字号/字距/行高，再基于编译时冻结的源字节、词、逻辑行、页和显示时间创建语义单元。字号绑定按数组顺序 replace，重叠范围由最后一个有值的绑定获胜；未匹配或关键帧 fill 无值的范围保留先前绑定结果，未被任何绑定覆盖的文字/空白保持本次整节点基础样式。不累计上一帧字号，不暗做整数取整；没有输入词窗口且未启用 estimated 时跳过需要该窗口的字号关键帧，并沿用词时间缺失诊断。

字号表达式只可读取 params/args/canvas/time/unit 的已定义字段；禁止任何 `layout.*` 及 `unit.lineEnvelopeAvailable/rangeInkAvailable`，包括通过纯函数间接读取。`unit.selectedIndex/selectedCount` 从当前页、同一文字节点、该绑定选择器匹配的冻结语义集合计算；状态筛选仅由冻结词时间和 gap/tail 策略决定，不读取缩放后的几何。显式 whole-cue 选集字段仍遵守其自身能力及静态 tag 条件。语义时钟、分页索引、单元 ID 和 source bytes 不因字号变化而改变。无法取得的必填时钟读数仍报诊断，不伪造朗读时间。

解析后的字号区间完整覆盖页面源文本，包括未选文字和间隙；每页至多 8192 个合并后区间。固定行显示空白继续按原规则归一化，并将字号区间同时映射到显示 UTF-8 字节：折叠空格取其第一个源字节所在区间的样式，行末被去掉的空白不生成字形。相邻相同样式区间合并后交给共享 `shape_rich`，保留可共享的 kerning/ligature，不通过逐词独立 shaping 或绘制期 transform.scale 模拟字号。每个区间的 em 字距乘该区间字号换算为像素；字体族、字重、italic 及涂装仍沿用节点定义，不将固定像素描边/装饰尺寸自动按字号缩放。输出 glyph.cluster 映回原源字节，用于词、字素、命中框和装饰绑定。

各行使用富文本整形得到的最大字体 ascent A、descent D，以及该行显示区间最大字号 F，行高 `H=max(A+abs(D), F×lineHeight)`；基线为行顶部+A，额外 leading 留在行底。页面按各行 H 之和在 y 锚点居中，行宽与水平对齐按本次实际 shaping 结果计算。全空白行用有效字号区间中的最大字号测量空格字体度量，随后保持无 glyph、零显示宽度；字号仍能改变其占行高度。冻结成员准备阶段不因尚未采样的基础字号超宽提前拒绝这些目标；实际每帧按 overflow:error 检查固定行宽，超限报 `CAPTION_LAYOUT_OVERFLOW`，visible 保留行/页身份并允许超出画布。取值或执行预算非法分别报告 `CAPTION_LAYOUT_INVALID`/`CAPTION_BUDGET_EXCEEDED`，不自动缩字、拆词或改页。

字形位置、基线、行框、词框、ink 与 glyph envelope 都在重新整形后从同一结果计算；repeat 装饰随之更新。反馈历史每个采样点都重新求字号规则与布局。选择器遍历、布尔条件、区间切分/合并及文本 shaping 输入均计入共享 65536 操作预算，区间和字体缓存有界，不因缓存命中放宽输入工作预算。无字号绑定的目标继续原重排路径，空字段不写入已有样式的序列化输出。此能力只新增通用固定成员字号重排，未提供页面 case 元数据；同页兄弟行的字素数与行框见 `caption-page-line-context/1`；按剩余词数查表的分页见 `caption-remaining-word-page-plan/1`，按文本内容生成任意分页计划仍未开放。示例见 [unit-font-size.json](../../crates/caption-scene/tests/fixtures/unit-font-size.json)。

**按宽度换行页的逐单元字号重排**。`caption-unit-font-reflow/1` 只用于没有 `wordLinePattern`/`textLinePattern`/`remainingWordPagePlans` 的页，并要求非空 `fontSizeBindings`，否则返回 `CAPTION_SCENE_INVALID`。页成员、页显示时间和页数仍在编译时按基础字号冻结；每次采样先按上面的规则求出字号区间，再用实际字号对当前页的源文本按同一按词换行规则重新折行，行数可以变化，词不会移到别的页。折行后超过 `maxLines` 时，`overflow:error` 返回 `CAPTION_LAYOUT_OVERFLOW`，visible 保留全部行；单行超宽与固定行相同。字号选择与字号表达式仍在准备阶段的基础行上求值。重新折行的行在采样之间没有稳定身份，因此场景不得声明 line 选择器、按 range/parity 筛选的 word 选择器或 line 时钟，也不得读取 `time.lineElapsedSeconds/lineDurationSeconds`，违者返回 `CAPTION_SCENE_INVALID`；页窗本来就要求固定行。绘制阶段 word 的 `unit.index/count` 按当次采样的行计算。`fontStyleBindings` 仍要求固定行。同时声明 `caption-cue-unit-context/1` 时，所有页按同一时刻重新折行后再计全局行数。重新折行的测量计入共享操作预算。示例见 [unit-font-reflow.json](../../crates/caption-scene/tests/fixtures/unit-font-reflow.json)。

**关联颜色与发光位图传输**。共享 DrawOp 的 `DrawEmissiveBitmap { bitmap, opacity, tf, blend }` 使用位图侧表的四个独立 RGBA8 UNORM 分量，RGB 可以大于 alpha，甚至在 alpha 为零时仍贡献光。当 blend 为 source-over 时使用 BCOP v6 的 tag 14，旧编码逐字节不变；screen 使用 v7 的 tag 15，add 使用 v9 的 tag 21，payload 相同：bitmap u32、opacity f32、六个仿射 f32（均 little-endian），侧表布局沿用 v5。详见[DrawOp 二进制规范](drawop-binary-spec.md)。仅实际含关联 source-over 的帧提升到 v6，含关联 screen 的帧提升到 v7，含关联 add 的帧提升到 v9；普通 v3/v4/v5 帧的编码不变。普通 `DrawBitmap` 仍要求预乘像素，不能暗中承载发光分量。

CPU/native/WASM 对发光位图执行同一个 source-over：`Cout = Cs + (1−As)Cd`、`Aout = As + (1−As)Ad`。逆仿射在目标像素中心求源坐标，源像素中心使用双线性过滤，图外为透明零，不夹到边缘；opacity 和 clip 覆盖率同时乘源的全部四个分量。合成结果各分量独立按最近整数舍入并限于 0–255，不将 RGB 限到 alpha。离屏组、遮罩和透明内容判定不能仅因 alpha 为零而丢弃非零 RGB。含发光分量时，未定义的非 Normal 混合返回 `EMISSIVE_BLEND_UNSUPPORTED`；尚未支持关联分量的通用滤镜/转场返回明确能力错误，不默用普通预乘路径。当前执行器为共享 CPU reference；GPU feature 尚不可用，未宣称额外 GPU 支持。

预览 ABI 的 `bc_render` flags 数值 1 为字幕、2 为透明背景、4（`RENDER_ASSOCIATED_RGBA = 1 << 2`）为原始关联 RGBA8 输出；例如 7 返回透明字幕的关联分量，并在结果 JSON 标记 `pixelFormat: "associated-rgba8"`。原有 flags 3 仍输出非预乘透明 RGBA，但若实际输出含 RGB > alpha，返回 `EMISSIVE_STRAIGHT_ALPHA_UNSUPPORTED` 并使 `bc_frame_len` 为零，避免返回截断颜色或上一帧。原始关联分量须由宿主按上述 source-over 合到查看背景，不能直接当作 straight-alpha ImageData；背景不属于渲染取样数据。不透明背景最终输出与旧普通帧行为不变。

**字形整形策略**。Text/Label 的 `style.fontShaping` 可选 `advanced/nominal`，缺省advanced且省略序列化，保持既有OpenType整形。nominal必须声明 `caption-font-shaping/1`，对已解析字体段按Unicode scalar映射cmap，不跨scalar应用kerning／连字／上下文替换；它不是字素分组、源应用字符组或完整复杂文字整形的替代。实际glyph family／face、字重变量location、斜体与字号沿既有解析；富文本字体边界不得被字素边界吞掉。Unicode方向／换行仍按共享排版处理，源字节cluster及词时间保持，测量／普通分页／fixed rows／混合字号／逐采样布局／Label使用同一策略。公开文本测量style对象也接收此字段：source-aware严格入口在选择字体前校验，即使未传fontSource也拒绝非法策略；遗留infallible入口保留容错。两者保留旧padding/ceil口径，宿主计算动态几何必须同时传入策略。nominal的tab保留原单字节cluster并使用一个空格advance，不按tab stop展开；Unicode方向控制符参与整行BiDi但不产生可见glyph／advance。变量advance使用同一有效location的设计单位，再按字号/UPEM浮点缩放，不使用sized metrics的固定点scale。省略策略的旧请求／文档／帧行为不变；非法值/null拒绝，非文字节点不接受nominal。Glyph hinting／轮廓坐标精度与shaping是独立量，关闭hinting不会自动关闭kerning或ligature。

**字形 hinting**。Text/Label的 `style.fontHinting` 可选 `default/none`，缺省或default保持原引擎行为且省略序列化；none必须声明 `caption-font-hinting/1`，关闭轮廓／atlas的hinting，沿用同一实际字体、整形结果、advance、cluster、词时间与分页成员。unhinted的TrueType glyf/gvar和标准FontMatrix的非CID CFF1轮廓从实际face的浮点设计坐标按字号/UPEM缩放，glyf/gvar直接复用与整形同一实际face/index/weight生成的有效normalized location（含avar），保留选定wght、其他轴缺省和既有合成斜体；不经另一个parser的字重归一化重选坐标，不先落到像素26.6或整font-unit网格。CFF2、CID／自定义FontMatrix、VARC、parser不支持的轴数及avar2输出超出parser可保真表达范围的normalized坐标等沿用既有unhinted scaler，仍可能保留缩放量化，不承诺与其他字体后端逐字节一致。当前Caption Scene的CPU／GPU共用录制路径；独立legacy glyph atlas API的填充mask仍由原scaler产生，不能把此路径精度承诺扩展到该API。普通／逐采样排版、混合字号字体、Label、paint坐标／ink／envelope、投影与模糊消费同一组glyph cache key；策略在cache key中隔离，不修改基础整形缓存，不在未知值／null时静默回退。非文字节点不接受none。该策略没有选择字体provider，也不替代显式fontSource或整形分段。

**显式字体来源**。Text/Label的 `style.fontSource` 为可选 `{sha256,faceIndex?}`，必须声明 `caption-font-source/1`；sha256为64个小写十六进制字符，faceIndex为0–1023整数、缺省0，指字体集合内的face。显式null、未知字段、非法摘要或索引拒绝。Group/Shape/Image/Repeat不接受该字段。引用指定已注册字体字节的确切face，不按同名字体的加载顺序替换；缺少字节或该face在排版前返回错误，不悄悄回退到同族另一个版本，也不读取系统文件补齐。host显式注入完整来源字节；导出冻结文件的原摘要／collection index保持，不以抽取或重排后的单face字节冒充原文件。可通过独立source-only资源库注入，只有显式引用的face进入内部族；未引用资源不进入普通family或fallback候选，普通具名族匹配不变。显式引用后未覆盖字形仍按既有引擎fallback处理，不承诺任意混合字体场景的缺字结果独立于已引用face。内容摘要不等同字体family或PostScript名。原生FrameRenderer提供独立source-only注入；当前WASM沿既有bc_add_font注入普通Binary字体，再由来源引用精确选择face，未开放额外source-only注册ABI。

指定来源时，fontFamily保留为展示／搜索提示，primary face由来源决定；fontWeight／italic仍按既有整形属性处理，但不选择另一个资源face。该face未覆盖的字符保留既有确定性script fallback，因此来源绑定不代表全字符串无fallback。内核在排版、lineBox、Label和逐单元字体patch之前解析为独立内部族，最多缓存1024个来源绑定；普通族名、省略字段的旧文档和旧帧策略不变。来源资源库最多1024份字节／256 MiB／4096个face，批量注册失败原子回滚；摘要缓存独立上限1024份／256 MiB，重复引用复用摘要。绑定只查询已注册Binary字体，不在采样或resolve中新增I/O。

fontStyleBindings可提供fontSource单独替换primary face，并额外声明该cap；后声明的source覆盖先前family/source，后声明的fontFamily切回普通命名族。仅覆盖weight／italic继续继承此前face。来源引用与原文本字节成员／词时钟无关，不能改变分页语义。

宿主的 `bc_measure_text` 也接受同类型 `style.fontSource`，在共享TextEngine中先解析确切face再量字，缺失／非法来源明确失败；省略时保留旧测量结果。这是独立测量请求，不是scene声明，因此不另带requiredCapabilities。原生 `FrameRenderer::measure_text_with_source` 提供同一有错误返回的入口，旧measure_text接口保持普通family合同。调用方必须把来源与字号等一起传递，并计入测量缓存身份；独立装饰字形的测量不能误继承主文字来源。

**分单元静态字体样式**。`layout.fontStyleBindings` 是可选有序列表，每条为 `{id,nodeId,selectorId,style:{fontFamily?,fontSource?,fontWeight?,italic?}}`，必须声明 `caption-unit-font-style/1`。最多64条，id在此列表内唯一；selector必须指向同一个Text的page/line/word单元；要求`layoutEvaluation: per-sample`和明确固定word/text行成员，不因换字体重划分页。style至少提供一个字段，全部为静态typed值：fontFamily为非空、至多256 UTF-8字节且无控制字符的字符串；fontWeight为1–1000整数；italic为bool。省略表示继承，显式null、表达式、未知字段拒绝，不开放任意字符串函数。

基础节点样式及cue字号先建立完整原文byte-range runs，随后执行fontSizeBindings，再按声明顺序逐字段应用fontStyleBindings；后声明规则仅覆盖它实际提供的字体字段，不清除未提供的字段或已求得的字号。两组绑定互相独立，不把字号变化实现成绘制scale。单元选择使用冻结语义成员、时间状态与显式标签，没有关键词推断；最终run边界不得拆开extended grapheme。相邻同字体/字号/字重/斜体的runs合并，原文空白覆盖完整，再经既有规范化映射一次性shape_rich整行，保留上下文整形、kerning、ligature、BiDi与源cluster索引。最多8192个run，选择、切分、映射与整形准备共享预算。

保留下来的空白使用对应run字体；全空白行按各实际字体run测量空格的ascent/descent并取包络，保持零宽/无glyph，不以基础字体代替。被规范化删除的首尾空白不制造可见glyph，既有pageMaxFontSize继续包含原文空白的字号。可见行宽、基线、font/glyph包络和邻词位置由实际rich shaping更新；位置与图层仍由既有节点/单元变换另行声明。无绑定及等效绑定保留原路径，不将此能力当作原始富文本或生成图层已自动导入。

编译时保守清点所有静态字体patch的可能face组合，包括首帧不活跃的分支；后续partial patch可能组合先前family、weight、italic，去重后至多4096项。清点进入既有used_faces/missing_fonts边界，无排字、文件读取或自动下载，字体加载/缺失回退仍由冻结文档字体协议负责。未激活的字体也可能被列作依赖，不能只清点当前活跃词。示例见 [unit-font-style.json](../../crates/caption-scene/tests/fixtures/unit-font-style.json)。

**扩展涂装栈**。旧场景每个stack及同节点候选layer ID并集最多16层。显式声明 `caption-paint-stack-extended/1` 时两者上限为64，整个场景全部节点基础stack与所有静态绑定stack累计最多4096条声明，未选中的定义也计入。它不自动删除或合并层。每个采样帧的扩展表面与采样预算共用image-paint总账：至多16Mi RGBA8等效像素槽（64MiB）和256Mi工作，包含隔离、传输及滤波暂存；checked arithmetic拒绝溢出，双计数预查全部成功后才提交计数，失败保持原值。glyph mask的128Mi工作与轮廓距离的128Mi查询工作仍分别计入其既有全帧预算。未声明扩展能力时保留旧16层、序列化和执行预算路径。

**逐词静态涂装样式**。`Scene.paintStyleBindings` 是可选有序列表，类型为 `PaintStyleBinding[]`，缺省为空列表，序列化省略空列表；非空时必须声明 `caption-paint-style-bindings/1`。条目结构如下：

```ts
interface PaintStyleBinding {
  id: string;
  nodeId: string;
  selectorId: string;
  style: PaintStylePatch;
}
interface PaintStylePatch {
  fill?: string;             // 静态十六进制 RGBA；省略时沿用普通 fill 继承路径
  paints: PaintLayer[];      // 必填，完整替换有序涂装，不逐层合并
}
```

整个场景最多64条绑定，绑定id在本列表内唯一。nodeId必须引用Text节点，selectorId必须引用同一Text的word选择器；过滤器只接受静态all/tag/range/parity及其and/or/not组合，递归出现state即拒绝，不以当前时刻是否匹配放宽。目标必须有显式非空基础`style.paints`且没有旧`style.stroke`。每条patch的paints缺省必须包含1–16层（显式扩展能力见下文），沿用PaintLayer的完整类型、层内唯一id、数值范围和资源合同；fill可省略，但显式null、动态值、未知字段及非法颜色拒绝。字体、字号、字重与斜体继续由已有字体和字号绑定提供，不进入此patch。

按字形原有cluster归属查询语义词，按声明顺序选择最后一个匹配绑定，并把其style作为完整patch应用；没有匹配时使用基础节点样式。不是逐字段叠加多个绑定：后一个匹配patch省略fill时沿用节点、父级及既有页填充等普通继承路径，不保留前一个patch的fill，也不强制擦除合法页填充；paints始终整组替换，因此允许增加或删除层。先得到静态绑定fill，再应用word stateStyles，最后应用fill动画的既有priority/composite规则；node-fill读取这个最终fill。基础stack和所有绑定stack均沿用既有paint与fill输入的兼容性检查。若某绑定stack不含node-fill，则该绑定不得声明fill，且该Text不得声明任何stateStyles、fill property或fill动画；违反任一项即拒绝。node-fill也可位于image paint的base中。基础stack同样必须满足既有guard，不能静默丢弃fill，也不能用未活跃分支绕过拒绝。绑定不改变advance、整形、行页成员、词时间或命中几何；显式标签来自实例wordTags，不推断关键词。

对每个目标Text，基础stack与所有绑定stack中不同layer ID的并集缺省最多16个（显式扩展能力见下文）。每个stack的数组顺序均形成层间偏序，准备阶段合并全部偏序并作稳定拓扑排序；任何矛盾环均拒绝，即使有关绑定当前不匹配。拓扑排序遇到多个可选层时，按它们首次出现的顺序取层：先扫描基础stack，再按绑定声明顺序扫描各stack；不能靠字典顺序或当前匹配词决定。共享纯函数`paint_style_order(scene: &Scene, node_id: &str) -> Result<Vec<String>>`向渲染器提供相同的层顺序和失败语义。

绘制以这个全局layer ID顺序为外层。对于当前layer ID，未包含该层的字形跳过；包含该层的字形按相同完整PaintLayer定义聚为一组，组按其首个字形在原字形序列中的首次出现顺序排列，组内保留原字形顺序，再复用原paint录制流程。不能按完整style把词分组后逐组画完全部层，否则一组的描边或投影会盖住另一组已画的填充；所有stack声明的后层必须在共同前层完成后才绘制。同一个layer ID可有不同完整定义，其分组不改变该层相对于其他layer ID的位置。彩色位图字形仍沿用既有最后绘制规则。

同一个global layer ID内不同完整定义的group共同累计16Mi像素的blurred surface allowance，下一个layer ID才重置；绑定匹配中的binding、selector搜索与递归filter求值均计入共享操作budget。彩色字形只在全部轮廓涂装层之后绘制一次位图，不随stack长度重复；实际选中mask的彩色字形仍明确拒绝。

准备阶段清点基础stack和所有静态patch的资源引用及能力需求，未活跃分支也必须有效；所有颜色、图片、渐变、coverage、mask与paint数值检查，以及字形、表面、采样和操作预算复用现有合同。涂装差异不拆成额外Text节点，同一个Text只进入原有材质capture一次，保留其材质、裁切与合成顺序。无绑定时继续原执行路径，空字段不写入旧场景，序列化与像素行为均保持不变。

例如，给Text `caption`的静态词选择器`keywords`（`filter: {kind: 'tag', value: 'keyword'}`）提供绑定；以下为场景片段，基础stack须同样显式声明`outline`在`fill`之前，并声明所用paint能力：

```json
{
  "paintStyleBindings": [
    {
      "id": "keyword-paint",
      "nodeId": "caption",
      "selectorId": "keywords",
      "style": {
        "fill": "#FFD700FF",
        "paints": [
          { "id": "outline", "paint": { "kind": "solid", "color": "#000000FF" }, "strokeWidth": 2 },
          { "id": "fill", "paint": { "kind": "node-fill" } }
        ]
      }
    }
  ]
}
```

**模糊、发光、位移、遮罩与反馈材质**。场景的 `materials` 按数组顺序执行，逐 cue 隔离，作用于该 cue 的完整文字和装饰合成；最多 8 项，每项 id 唯一。材质输出使用 sRGB 关联 RGBA8；普通颜色满足 RGB ≤ alpha，显式发光分量允许 RGB > alpha，输出记录为相应 DrawOp 位图，精确预览与导出共用；点击几何来自当前时刻的文字，不把拖尾当作可编辑文字。

| kind | 字段与执行合同 |
| --- | --- |
| blur | radius 为 length 类型 DynamicValue，使用与布局相同的只读 cue 上下文；范围 0–64 输出像素，按 `floor(radius + 0.5)` 量化；passes 为 1–3，默认 1。每遍执行已有确定性预乘 box blur，不冒称 Gaussian。零半径跳过滤镜 |
| wave-displace | amplitude 为 length 类型 DynamicValue，范围 −256–256 输出像素；wavelength 为 length 类型 DynamicValue，范围 1–1,000,000 输出像素；phase 为有限 angle 类型 DynamicValue（弧度）；axis 必填 x 或 y。三个动态值默认使用只读 cue 上下文；可选 contextNodeId 须声明 `caption-wave-context/1`，指向唯一 Text（规则同 soft-band），三个动态值改用该节点当前页的排版后上下文，可读页/墨迹字段，无当前页输出透明。按预乘 RGBA 双线性逆采样，画布外为透明；幅度为零时返回输入，但仍检查其余 uniform |
| soft-band | contextNodeId 必填且明确引用唯一 Text；允许 Group 祖先与空 Group，拒绝其他 Text、Image、Shape 或 Repeat，即便其当前 opacity 为零。axis 必填 x/y；center、halfWidth、feather、amount、opacity 均为必填 scalar DynamicValue，范围依次为 [−4,4]、[0,4]、[0,4]、[0,1]、[0,1]；使用指定文字节点当前页的排版后上下文，允许页/墨迹字段。无有效关键帧值时回退到 .5/.5/0/0/1；无当前页则输出透明，不借用其他节点上下文 |
| gaussian-uv | 唯一 Text 页上下文、显式input ROI/output域、二维signed stepUv向量、samples/sigmaUv/rgbGain；关联RGBA沿两方向Gaussian权重累积，RGBgain不改变alpha |
| gaussian-axis | contextNodeId 指向场景唯一 Text；axis 为 x/y；samples、stepUv、sigmaUv 为 scalar DynamicValue，范围分别为 [0,1024]、[0,1]、[0,1024]；gamma 为固定有限数 [0.1,8]；boundary 必填 normalize/replicate/transparent。尺寸保持原画布，采用下述独立分量高斯合同 |
| glow-cascade | contextNodeId 指向场景唯一 Text；levels 为 1–7 个 `{horizontal, vertical}`；每个 stage 是 `{scale:{num,den}, samples, stepUv, sigmaUv}`，后三项同高斯动态参数，scale 要求 `1 <= num <= den <= 4096`；gamma 为固定有限数 [0.1,8]，作用于每个 pass 及强度映射；intensity、originalOpacity 为 scalar DynamicValue，分别限 [0,16]、[0,1]；可选 glowTint 为 color DynamicValue，省略为白，四通道均须在 [0,1]，只使用 RGB；可选 glowColorMatrix 为行优先的 9 个有限数，省略为 RGB 3×3 单位矩阵；composite 必填 screen/source-over-glow。声明 `caption-glow-linear/1` 时 levels 可为 1–8，并可选 gammaChannels（rgb/rgba，默认 rgb）、aggregation（encoded/linear，默认 encoded）、levelGains（与 levels 等长的静态有限数，各 [0,2]，仅 linear）、levelColor（color DynamicValue，仅 linear），composite 增加 original-over-screen |
| noise-palette-mix | contextNodeId 指向唯一 Text；paletteResourceId 引用冻结 PNG；palettePosition/phase 为 scalar DynamicValue；domain 的 x/y/width/height 为显式画布 length DynamicValue。固定噪声与色条混合保持 alpha，完整数值/范围见下文 |
| noise-displace | contextNodeId 指向唯一 Text；domain 为显式画布 length DynamicValue；noiseScale 为静态二元组；phase/brightness/contrast/strength 为 scalar DynamicValue。固定 v1 噪声驱动两轴相同的归一化 UV 位移，预乘双线性透明边界采样；仅 CPU 执行 |
| angular-sample-blend | contextNodeId 指向唯一 Text；domain 显式给出局部纹理画布长度；aspect 为独立正 scalar DynamicValue，angle 为弧度 angle DynamicValue；固定60次角向采样，以平均alpha混合原图，不等于旋转或普通模糊 |
| affine-over | 唯一 Text 的当前页上下文、必填输入 ROI/输出域、前景/背景各六个 scalar UV 系数、背景 opacity/RGB scale、replicate 或 transparent 边界；同一不可变前缀纹理采样两次，前景 over 背景 |
| affine-sample-blend | contextNodeId 指向唯一 Text；sampling 必填输入 texel ROI 与输出 quad；transforms 为 2–32 个归一化 UV 仿射矩阵，每个系数为 scalar DynamicValue；sampleRange/distanceRange 为静态有界二元组，boundary 必填 normalize/replicate/transparent。按端点 UV 距离选择均匀样本数，再沿分段仿射路径等权平均独立 RGBA，完整数值合同见下文 |
| gradient-smear | contextNodeId 指向唯一 Text；domain 为局部纹理画布长度；rectScale、evolution、seed、stretch、progress、strength 为动态 scalar；noise 为冻结梯度噪声参数，uvY 明确 up/down。固定128次线段采样，不降低为高斯模糊 |
| feedback | samples 为 1–16 个过去样本，step 为正的 `{ticks,timescale}`，总历史窗口至多 2 秒；decay 为 0–1，offset 为每个样本的像素位移（各轴绝对值不超过 256）。第 i 个样本重新求值 `t − i × step` 时刻的前缀材质栈，权重为 decay 的 i 次方、位移为 i × offset；按最远历史到当前帧 source-over 合成，当前帧权重为 1。可选 composite 默认 decay-over 即上述合成（省略时不写出）；`mean` 需声明 `caption-feedback-mean/1` 且 decay 必须为 1，改为等权平均，见下文 |

**二维 UV Gaussian**。`gaussian-uv` 必须声明 `caption-gaussian-uv/1`，复用唯一 Text 当前页与显式采样域合同。`samples` scalar DynamicValue 范围 [0,1024]，循环采用 floor；`stepUv` 为两个 scalar DynamicValue，各分量 [-1,1]，保留符号和二维方向；`sigmaUv` scalar 范围 [0,16]，floor(samples)≥1时必须正数；`rgbGain` scalar [0,10]。常量及关键帧字面范围提前拒绝，插值/表达式再执行检查；缺值、null、非法维度不能默认或夹值。

输出像素中心归一化UV=U，先中心权重1，再i=1..floor(samples)，按 `U-i*stepUv` 后 `U+i*stepUv` 的顺序采样；权重 `exp(-.5*(hypot(stepUv)*i/sigmaUv)^2)`。不将向量改成轴向，不把连续samples取整后用作步长参数。normalize拒绝闭[0,1]²外tap且不加分母；transparent越界tap为零但权重加入分母；replicate先夹UV。域内ROI texel-center夹边后按 byte-valued f64双线性读取，四关联分量独立；除总权重后仅RGB乘gain，各自floor(.5+clamp(v,0,255))写UNORM8，不gamma/解预乘/RGB≤alpha夹制。无side tap仍中心采样并应用RGBgain。输出分配、输入扫描、权重计算和实际tap工作在执行前计费；可用非零RGBA支持范围加最大UV位移保守减少空白工作，replicate触边保留全域。CPU/导出/WASM支持，GPU material-plan当前明确不支持此command。

**同输入仿射前景与背景合成**。`affine-over` 必须声明 `caption-affine-over/1`。它复用唯一 Text 当前页上下文、GaussianSamplingDomain 的显式整数 input ROI、像素中心、output 域与工作量/表面预算合同；Group 祖先可用，无当前页输出透明。`foreground` 与 `background` 各为 `[a,b,c,d,tx,ty]` 六个必填 scalar DynamicValue，直接从输出归一化 UV 映到同一输入 ROI 的 UV，不求逆、不重新光栅化文字，也不读取上一帧。各系数有限且绝对值≤10000；`backgroundOpacity` 和 `backgroundRgbScale` 为必填 scalar DynamicValue、范围 [0,1]。常量与关键帧字面值在验证时检查，插值与表达式结果在执行时检查；缺样本、null、未知字段、非法维度/系数明确拒绝，不夹参数继续画。

`boundary` 仅允许 transparent/replicate。transparent 将闭 [0,1]² 外的整个采样视作四分量零；replicate 先把 UV 夹到 [0,1]。域内采样按 `input.xy+UV*input.wh-.5` 映到 texel 中心，并先夹到 ROI 首末中心再双线性读取，不能泄漏相邻 backing 像素。输出域外透明，画布外 output 裁切；不猜 margin 或纹理扩展，不增加 padding。

令前景采样 F、背景采样 B（四分量均按关联值独立读取），背景 opacity=p，RGB scale=k。输出 RGB=`F.rgb+B.rgb*p*k*(1-F.a)`，alpha=`F.a+B.a*p*(1-F.a)`。RGB scale 只影响背景颜色，不影响其覆盖率；不解预乘、不做 gamma、不夹 RGB≤alpha，保留零 alpha 发光。CPU reference 的矩阵采用 f64；双线性插值在 0–255 字节值域按先横向两行、再纵向计算，合成也保持字节值域直到最终写入。设字节值前景/背景为 F/B、r=`1-F.a/255`，RGB 按左结合 `F.rgb+((B.rgb*p)*k)*r`，alpha 按 `F.a+(B.a*p)*r` 求值；最后各自 `floor(.5+clamp(c,0,255))` 写 UNORM8。不先除255再乘回、不重排乘法，避免半字节舍入阈值漂移。输出分配、输入支持扫描、两次矩阵求值与所有可能 texel 读取在工作预算中收费，读取前拒绝超限。可按输入非零 RGBA 支持范围，用两个矩阵的保守逆边界减少空白像素工作；逆矩阵仅用于工作范围，不改变正向采样。当矩阵退化/精度不适合或 replicate 触及 ROI 边缘时保留完整 output 范围。当前 CPU/导出/WASM 场景路径支持此材质；GPU material-plan 尚未接此 command，明确返回 CAPTION_MATERIAL_PLAN_UNSUPPORTED，不声称原生 GPU 支持。

**显式仿射路径采样混合**。`affine-sample-blend` 必须声明 `caption-affine-sample-blend/1`。`contextNodeId` 明确绑定唯一 Text 的当前页排版后上下文，允许 Group 祖先及空 Group，拒绝其他视觉节点；render layer 仍按该层的输入子树验证唯一 Text。无当前页输出透明。所有系数及域在当前请求时刻求值，无有效动态采样值返回 `CAPTION_MATERIAL_INVALID`，不得回退为单位矩阵、零系数或当前变换，也不读取先前帧。

必填 `sampling:{input,output}` 复用 GaussianSamplingDomain 的长度、像素中心与区域合同，但不另要求 `caption-gaussian-sampling/1`。input 的 x/y/width/height 求值后均为非负整数，尺寸为正，矩形必须完全落在实际输入纹理内；output 的 x/y 允许分数及画布外坐标，width/height 至少 0.001，所有坐标与尺寸沿用 MaterialDomain 的有限范围。画布外 output 被裁切，域外输出透明，不增加 padding 或分配；域必须显式提供，不推测字体框、纹理 margin 或节点变换。

`transforms` 必须含 2–32 个矩阵，每个为 `[a,b,c,d,tx,ty]` 六个 scalar DynamicValue；每项求值须有限且绝对值不超过10000。矩阵直接将输出归一化 UV 映到输入 ROI 的归一化 UV：`T(u,v)=(a*u+c*v+tx, b*u+d*v+ty)`，不是待求逆的节点 pose。`sampleRange:[min,max]` 是静态整数且 `2 <= min <= max <= 256`；`distanceRange:[lo,hi]` 是静态有限数且 `0 <= lo < hi <= 16`。未知字段、null、错误数组长度与非法常量拒绝；动态系数的关键帧字面值同样受范围约束，表达式结果及插值后的范围在执行时再检查，不能夹参数继续绘制。

对 output 内画布像素中心 q，先求 `U=(q-output.xy)/output.wh`，Y 向下。令首末矩阵变换的 UV 为 `A=T0(U)`、`B=T(M-1)(U)`，欧氏 UV 距离 `D=sqrt((Bx-Ax)^2+(By-Ay)^2)`；`p=clamp((D-lo)/(hi-lo),0,1)`，`s=p*p*(3-2*p)`，样本数 `N=floor(min+(max-min)*s)`。距离在 UV 中计算，不乘输入或输出纹理尺寸、不改为路径总长度；首末相同时使用 min，即便中间控制点绕行。相同 min/max 合法，不作额外的整数取整。

第 i 个样本（`i=0..N-1`）取 `w=i/(N-1)`，包含首末端点。将控制点按数组顺序等距分布在 [0,1]；令 `h=w*(M-1)`、`j=min(floor(h),M-2)`、`f=h-j`，样本 UV 为 `Q=(1-f)*Tj(U)+f*T(j+1)(U)`。最后端点明确取最后控制点。此式插值的是当前像素经各矩阵变换后的 UV，等价于逐系数线性插值后直接应用矩阵；不得插值 pose 后求逆、按弧长重排或省略中间控制点。

`boundary` 按 Q 的两个分量是否都在闭区间 [0,1] 内判断。normalize 丢弃越界样本并将剩余等权样本重新归一，全部越界输出四通道零；transparent 将越界样本视作四通道零，仍以 N 为分母；replicate 将 UV 夹到 [0,1] 后读取。域内 Q 映为源 texel 中心坐标 `input.xy+Q*input.wh-.5`，双线性采样前先在 input ROI 的首末 texel 中心夹边，读取只限 ROI 内实际 texel，不能读取相邻像素或让透明边界泄漏邻接纹理。

每个样本对四个独立关联 RGBA 分量双线性读取，随后等权平均；不做 gamma、解预乘、alpha 混合原图或 RGB≤alpha 钳制。共享 CPU reference 的仿射、距离、分段插值及累加使用 f64；最终四分量各自按 `floor(.5+255*clamp(value,0,1))` 写 UNORM8，保留零 alpha 发光。非有限中间坐标或其他非法动态参数报 `CAPTION_MATERIAL_INVALID`。输入 texel 读取、控制点变换、输出分配/清零/写入都进入共享工作量与表面预算，超限返回 `CAPTION_BUDGET_EXCEEDED`，不减少样本、控制点或分辨率。

共享材质录制与 CPU 执行使用同一排版后参数求值，GPU 可在有序材质链中原生执行仿射路径，保持中间 RGBA8 量化及一次帧提交。GPU 上传高／低 f32 参数对，并用有运行时整数舍入屏障的补偿运算保留决定离散采样数和闭区间 UV 边界的低位；颜色过滤和累加为 GPU f32，按最终量化像素与 reference 验证，不假定所有源绘制操作均支持 GPU。CPU reference 不改变。

GPU 提交前检查范围／资源／精度：不支持的源操作、f32 坐标域或距离区间折叠、不能保留的参数范围明确失败并由宿主完整回退 CPU。可变采样密度接近内部整数阈值时，先用同一 f64 连续密度检查；若不能可靠区分离散结果，返回 `gpu-affine-density-precision`，不猜测采样数、不上传 CPU 密度图。固定采样数、相同首末矩阵及已夹到最小／最大密度的情况不含该内部阈值歧义。失败不提交或呈现半帧。无系统时钟、随机数或播放历史，seek 和任意请求顺序按同一冻结输入重算。

`gaussian-axis.spacingRamp` 是可选的空间采样间距场，显式使用时必须声明 `caption-gaussian-spacing-ramp/1`；省略字段保持原像素和序列化不变，null 拒绝。字段为 `domain`（同 MaterialDomain）、`axis`（x/y）、`start`/`end`（scalar DynamicValue，范围 [-1024,1024]，求值后必须 end>start）、`reverse`（boolean）和 `evaluation`（center/previous-sample）。域和时间参数在当前页排版后求值；start/end 无有效关键帧时分别使用 0/1，域缺少有效值报错。输入像素中心映射到域的指定轴归一坐标 u，reverse=true 时取 1-u；采样间距乘以 `1-smoothstep(start,end,u)`，权重仍按原始 k×stepUv / sigmaUv 计算，不改变 sigma、样本数量或 RGB-only gamma。

center 模式每次从映射后的输入采样中心求场；previous-sample 模式先从该中心求场，随后按 k=1..floor(samples)、默认负向再正向的固定顺序，把刚计算的采样坐标作为下一次求场的位置，跨 k 保留；replicate 边界在保留位置前夹到纹理边界，其他边界保留计算位置。此递推只在单个像素的核内发生，不依赖前一帧、其他输出像素或渲染顺序。偏移始终从原像素中心计算。场范围固定为 [0,1]，有效区域用原始最大半径保守扩张；动态采样工作按区域内每 tap 最多四次读取保守计费。GPU 直接求场并完成滤波，不生成逐帧 CPU 场贴图。

`gaussian-axis.sampling` 可选指定 `{input: MaterialDomain, output: MaterialDomain}`，显式使用必须声明 `caption-gaussian-sampling/1`。input 的 x/y/width/height 都是像素 length DynamicValue，求值后必须是整数，x/y 非负、尺寸为正，且矩形完全位于输入画布内；不自动舍入或截短。output 可以是分数像素矩形，尺寸至少 0.001，坐标和尺寸范围沿用 MaterialDomain；画布外部分被裁切，不增大分配。两者均在当前页排版后求值，缺少有效值时报错。省略 sampling 保留旧的整面语义和序列化；显式 null 拒绝。

对 output 内像素中心 q，输入采样中心为 `(q-output.xy)/output.wh*input.wh+input.xy-.5`；output 外输出透明。stepUv/sigmaUv 乘 **input 子区域** 的宽/高，边界规则和双线性夹取都以该子区域为界，不泄漏相邻像素。ramp.domain 仍使用输入后备纹理的绝对像素坐标；若要让场覆盖整个子区域，就显式将它设为 input。每一 pass 仍写原画布大小的表面，保留 RGBA8 量化再交给下一 pass。这样可先从局部子纹理采样到整面，再在下一 pass 直接映射到局部输出 quad；不在 Gaussian 前后悄悄插入额外双线性重采样。GPU 对 output 设置 scissor，CPU 按输出域作有界遍历；工作量保守按区域每 tap 四次读取计费。

`spacingRamp.sampleOrder` 可选为 `negative-first` / `positive-first`，显式使用同样要求 `caption-gaussian-sampling/1`；省略为 negative-first 且不新增序列化字段，null/未知值拒绝。顺序影响 previous-sample 递推，reverse 只反转空间场，不会自动反转采样顺序。中心仍固定，不累积位移，不引入帧历史。参考 [gaussian-local-sampling.json](../../crates/caption-scene/tests/fixtures/gaussian-local-sampling.json)。

仅有矩形 input/output 重映射时，固定高斯核的读取量仍可按两轴分别求和后相乘：计入 ROI 夹边、边界丢弃、实际非零分量支持框以及每个双线性采样的1/2/4个有效 texel。输出分配／清零与导入支持扫描另计，不用整张输出乘每 tap 四读取代替实际读取量。存在 spacingRamp 时继续按保守上界计费。此优化只修正预算估算，不改核、分辨率、采样坐标、权重、量化或工作量上限。

`gaussian-axis` 和 `glow-cascade` 分别必须显式声明 `caption-gaussian-axis/1`、`caption-glow-cascade/1`，缺失返回 `CAPTION_CAPABILITY_REQUIRED`。`contextNodeId` 必须明确指向场景中唯一的 Text；允许 Group 祖先及空 Group，拒绝其他 Text、Shape、Image、Repeat，包括当前不可见的节点。动态参数在该文字节点当前页排版完成后求值，可读取已开放的页、词时间和墨迹上下文；无当前页时输出透明。无有效关键帧值时 samples/stepUv/sigmaUv/intensity 回退为 0、originalOpacity 回退为 1，glowTint 回退为白色；显式使用 glowTint 还必须声明 `caption-glow-tint/1`，该值使用同一个 contextNodeId 排版后的页上下文与共享表达式预算，不能提前从未完成的排版求值；省略字段不新增求值操作或序列化字段。显式使用 glowColorMatrix 必须声明 `caption-glow-color-matrix/1`；该矩阵为静态数据，不接受动态值对象，null、非 9 元素或非有限数拒绝。显式写出 gammaChannels、aggregation、levelGains、levelColor，使用第 8 级或 `original-over-screen` 时必须声明 `caption-glow-linear/1`。levelGains 和 levelColor 只能与 `aggregation: linear` 同用；levelGains 是静态数组，长度须等于 levels，每项为 [0,2] 有限数，null、非数组或动态值拒绝。levelColor 是 color DynamicValue，与 glowTint 使用同一排版后页上下文和表达式预算，四通道须在 [0,1]；无有效关键帧值时视同省略、不着色，不能回退为白色。这些字段省略时不新增求值操作，序列化与旧像素不变。求得非法数值报 `CAPTION_MATERIAL_INVALID`，不能夹到合法范围继续执行。示例见 [gaussian-axis.json](../../crates/caption-scene/tests/fixtures/gaussian-axis.json)、[glow-cascade.json](../../crates/caption-scene/tests/fixtures/glow-cascade.json)、[glow-linear.json](../../crates/caption-scene/tests/fixtures/glow-linear.json)。

**独立分量高斯**。材质入口从前缀合成结果截取原始画布，忽略其他材质预留的 padding；本材质不增加边界，最终结果写回相同画布区域。取 `N=floor(samples)`，中心权重为 1，沿指定轴两侧第 i 个样本偏移 `i×stepUv`，权重 `exp(−.5×(i×stepUv/sigmaUv)²)`，i=1…N。N≥1 时 sigmaUv 必须大于 0；N=0 只执行已声明的区域／尺寸映射，不做 gamma 编解码；未指定 sampling 且同尺寸时为复制。stepUv/sigmaUv 均以**该 pass 输入纹理**的指定轴归一化维度为单位，先乘输入宽或高换算为像素；不能误乘输出维度。重采样以像素中心 `(outIndex+.5)×inputSize/outputSize−.5` 对齐，同尺寸轴直接使用整数中心。

每个纹理读取先对四个独立关联分量做双线性插值；随后仅 RGB 做 `pow(channel,gamma)`，alpha 保持原值。加权平均后仅 RGB 做 `pow(channel,1/gamma)`，每个输出分量独立按 `floor(.5+255×clamp(value,0,1))` 写入 UNORM8。RGB 不受 alpha 上限约束；不能改成插值前 gamma、解预乘后滤波、RGB≤alpha 钳制或跨 pass 只量化一次。glow-cascade 声明 `gammaChannels: rgba` 时，alpha 与 RGB 一起做上述 `pow(channel,gamma)` 和 `pow(channel,1/gamma)`，其余步骤不变；gaussian-axis 和默认 rgb 仍只对 RGB 编解码。指数与幂运算使用共享确定性 libm 实现。

boundary 按样本 UV 是否在闭区间 [0,1] 判断：normalize 丢弃越界样本及其权重，保留样本重新归一；transparent 保留越界样本权重但贡献四通道零值；replicate 将越界 UV 夹到边缘。落在 [0,1] 内的双线性读取在首末像素中心处夹边，因此 transparent 不等于四个相邻 texel 各自透明补零。上述边界是原画布或当前缩放纹理的边界，不随外层 padding 改变。

**多尺度级联发光**。每级先 horizontal 高斯，再 vertical 高斯；首级输入是入口原图，其后各级输入是上一级 vertical 输出，并保留每级 vertical 图用于最终合成。每个 stage 的宽高分别为 `max(1,floor(originalCanvasDimension×num/den))`，始终相对入口原画布计算，不能在上一 stage 尺寸上再次乘 scale。每个 stage 的采样步距及 sigma 仍乘自身**输入**纹理尺寸，固定使用 replicate 边界，沿用上述逐 pass gamma 与 UNORM8 量化。

最终将原图及各级 vertical 图按像素中心双线性采样回原画布。令 `gain=(intensity×.5)^(1/gamma)`，各级分量为 `Lk`，则 `G=clamp((1−Πk(1−clamp(Lk×gain,0,1)))×max(gain,1),0,1)`；聚合及 clamp 完成后，若声明 glowTint，将 `G.rgb` 逐通道乘 `glowTint.rgb`，保持 `G.a`；tint 的 alpha 不参与乘法或合成。随后以行优先 glowColorMatrix 乘这份 RGB 向量，对所得 RGB 各分量 clamp 到 [0,1]，继续保留 `G.a`；默认或显式单位矩阵跳过该步算术，保持旧像素。顺序固定为聚合 clamp → tint → matrix → RGB clamp → composite，矩阵不得提前作用到各级纹理或原图，也不得在最终合成后执行。矩阵乘法若因有限但过大的系数产生非有限中间值，报 `CAPTION_MATERIAL_INVALID`，不将 NaN/overflow 当作颜色继续输出。矩阵是每输出像素固定的 9 次乘法与 6 次加法，不创建额外表面或纹理采样，仍受既有输出像素预算约束。令 `O=original×originalOpacity`，包括 alpha 也同乘。screen 对每个 RGBA 分量分别执行 `1−(1−G)×(1−O)`；source-over-glow 执行 `O+G×(1−Oalpha)`。最后独立量化四个通道，不添加其他未声明的着色、饱和度或背景；glowTint 省略或 RGB 为白时保持原有像素。intensity=0 时 G=0，originalOpacity=1 时结果为原图；发光结果通过前述 `DrawEmissiveBitmap` 和关联 RGBA ABI 传输。

**线性聚合**。`aggregation: linear` 不使用上述 gain。各级 vertical 图按像素中心双线性采样回原画布得 `Lk`；若有 levelColor `c`，先令 `Lk.rgb=c.rgb×c.a×Lk.a`，`Lk.a` 不变。随后对 gammaChannels 指定的分量做 `dk=pow(Lk,gamma)`，其余分量 `dk=Lk`。`D` 从 0 开始逐级执行 `D=1−(1−D)×(1−wk×dk)`，wk 为 levelGains 第 k 项（省略为 1）。因为 wk∈[0,2]、dk∈[0,1]，每个因子在 [−1,1]，D 落在 [0,2]，不会出现负底数。指定分量 `G=clamp(pow(D×intensity,1/gamma),0,1)`，其余分量 `G=clamp(D×intensity,0,1)`；之后照旧执行 glowTint、glowColorMatrix 和合成。intensity 为 0 或 levelGains 全为 0 时 G=0。

**original-over-screen**。O 仍为乘过 originalOpacity 的原图。先得 `S=1−(1−G)×(1−O)`（四个分量），结果 RGB 为 `(O.a>0 ? O.rgb : 0)+(1−O.a)×S.rgb`，alpha 为 `O.a×O.a+(1−O.a)×S.a`。O.a 为 1 时输出 RGB 等于原图且 alpha 为 1；O 全透明时输出等于 G。这一合成可与两种聚合同用。

**组件滤镜预算与有效区域**。两种材质仍受整个材质栈 256 MiB 暂存/输出表面上界、256 Mi 单次采样工作量与共享表达式预算约束；级联另核对入口原图、已保留 vertical 层、暂存 horizontal/vertical 层及最终输出的峰值。工作量同时计入实际需要的源 texel 读取、入口非零区域扫描、各输出面的像素分配/清零/写入，以及画布裁切/回填；整数中心或边缘退化的双线性读取按实际 1/2/4 个 texel 计费，不虚构统一四次读取。有效区域以**任何 RGBA 分量非零**判断，不能用 alpha-only 框；后续 pass 保守传播滤波支持范围，写输出时同步更新区域。区域优化只跳过可证明为零的输入/输出，不截断可能存在的低亮度或零 alpha 发光。预检超限返回 `CAPTION_BUDGET_EXCEEDED`，不减少层数、抽样或分辨率。

soft-band 固定以原始画布归一化坐标计算，`U = (x + .5 − padding) / canvasWidth`，y 轴相应使用 y/canvasHeight。令 c=center、h=halfWidth、f=feather，遮罩 `B = smoothstep(c−h−f,c−h,U) × (1−smoothstep(c+h,c+h+f,U))`，RGBA 每个预乘通道乘 `((1−amount)+amount×B)×opacity`，按 `floor(value+.5)` 回到 RGBA8。smoothstep 使用三次式 `t²(3−2t)`；f=0 时明确为 step，左边界包含、右边界不包含（h=f=0 时为空）。本材质不增加 padding，只消耗一次整面像素遍历；其他材质带来的 padding 不改变 UV。指定文字节点的静态/逐采样排版与文字录制使用同一解析过程，各个反馈历史时刻都重新求当前 cue 的页；非法动态值返回 `CAPTION_MATERIAL_INVALID`，不截断参数继续绘制。

`caption-soft-band/1` 同时提供 `time.pageLastWordElapsedSeconds/pageLastWordDurationSeconds`（time）和 `unit.pageLastWordTimed`（bool），所有单元及装饰继承当前页成员顺序中最后一个词的输入时间。无输入词时间（包括 estimated 推导时间、静态文字）时返回 0/0/false，不虚构真实词时间；输入明确给出零时长时 Timed 仍为 true、Duration 为零，模板必须保护除法。elapsed 不截断，可在末词开始前为负。这些字段禁止在布局前读取。示例见 [soft-band.json](../../crates/caption-scene/tests/fixtures/soft-band.json)。

`caption-active-word-context/1` 必须显式声明后才能读取当前页的活动词时钟，未声明时验证返回 `CAPTION_CAPABILITY_UNAVAILABLE`。同一文字节点的所有单元及装饰得到相同的值：`unit.activeWordAvailable`（bool）、`unit.activeWordIndexInPage`（scalar，当前页冻结词成员中的零基序号）、`time.activeWordElapsedSeconds` 与 `time.activeWordDurationSeconds`（time）。活动词与 `unit.active` 使用同一选择（`speechState` 的 gap/tail 策略，以及 estimated 时序），只在当前页成员内取。窗口是包含采样时刻、该词连续保持活动的区间：被保持的空隙和尾段计入，终点不超过页的显示结束；被开始更晚的词重叠打断后又恢复的词开始新窗口。没有活动词时返回 false/0/0/0；零时长词不会成为活动词。窗口只依赖冻结的页成员和词时间，因此布局绑定读取它返回 `CAPTION_DEPENDENCY_CYCLE`，`fontSizeBindings` 可以读取。示例见 [active-word-context.json](../../crates/caption-scene/tests/fixtures/active-word-context.json)。

`caption-line-neighbor-context/1` 必须显式声明后才能读取同一视觉行内的上一个词，未声明时验证返回 `CAPTION_CAPABILITY_UNAVAILABLE`。word 单元、属于它的 grapheme 单元及绑定它们的 repeat 装饰读取 `unit.previousWordInLine`（bool）与 `layout.previousWordX/Y/Width/Height`（length）：当前页同一视觉行中按源文本顺序紧挨在前的词的布局矩形，坐标与 `layout.x/y/width/height` 相同（画布像素，advance 与行框，尚未施加动画变换），逐采样布局时随同一采样重排。行首词以及 line、page、cue 与空白单元读取 false/0。它让装饰从上一个词滑到当前词，例如活动词底框按 `time.elapsedSeconds` 在两个矩形之间插值。该值依赖排版结果，布局绑定与字号绑定读取均返回 `CAPTION_DEPENDENCY_CYCLE`。示例见 [line-neighbor-context.json](../../crates/caption-scene/tests/fixtures/line-neighbor-context.json)。

`caption-line-box-context/1` 必须显式声明后才能读取单元所属视觉行的行框，未声明时验证返回 `CAPTION_CAPABILITY_UNAVAILABLE`。line 单元、属于该行的 word、grapheme 与空白单元及绑定它们的 repeat 装饰读取 `layout.lineBoxX/Y/Width/Height`（length）：当前页该视觉行的布局矩形，即 line 单元自己的 `layout.x/y/width/height`，坐标同样是画布像素、advance 与行框、尚未施加动画变换，逐采样布局时随同一采样重排。page 与 cue 单元读取 0。它让行内单元知道自己在本行中的相对位置，例如整行扫带从左到右扫过时，字素在 `layout.x − layout.lineBoxX` 小于扫过宽度后才显现。该值依赖排版结果，布局绑定与字号绑定读取均返回 `CAPTION_DEPENDENCY_CYCLE`。示例见 [line-box-context.json](../../crates/caption-scene/tests/fixtures/line-box-context.json)。

`caption-page-line-context/1` 必须显式声明后才能按页内行号读取当前页的各行，未声明时验证返回 `CAPTION_CAPABILITY_UNAVAILABLE`。字段路径以零基行号结尾：`layout.pageLineBoxX.<k>`、`layout.pageLineBoxWidth.<k>`（length）是当前页第 k 行的行框左边与宽度，即该 line 单元自己的 `layout.x/width`（画布像素、advance 与行框、尚未施加动画变换，逐采样布局与字号重排后的结果）；`unit.pageLineGraphemeCount.<k>`（scalar）是第 k 行源文本范围内非空白 extended grapheme 的个数，空格、换行等空白字素不计。k 写成不带前导零的十进制，必须小于 `layout.maxLines` 且小于 16，否则返回 `CAPTION_EXPRESSION_TYPE`；k 不小于当前页实际行数时三个字段都读 0。同一文字节点的所有单元及装饰读取同一份当前页结果，因此每一行都能看到兄弟行，例如把首行右缘对齐到第二行、按全页最宽行决定各行左右错开。行框依赖排版结果，布局绑定与字号绑定读取均返回 `CAPTION_DEPENDENCY_CYCLE`；字素数只依赖冻结的行成员，字号绑定可以读取（取准备阶段的基础行），布局绑定读取仍返回 `CAPTION_DEPENDENCY_CYCLE`。每页统计一次、单元共享，按行和字素计入操作预算；未声明能力的场景不做这项统计。示例见 [page-line-context.json](../../crates/caption-scene/tests/fixtures/page-line-context.json)。

`caption-shape-paint/1` 必须显式声明后 shape 节点才能使用 `fillPaint`，未声明时验证返回 `CAPTION_CAPABILITY_REQUIRED`。`fillPaint` 与 `style.paints` 的 paint 相同：`{ kind: 'solid', color }` 或 `{ kind: 'linear', from, to, stops }`，渐变校验规则一致（from 与 to 不同、坐标绝对值不超过 16、2–32 个严格递增且在 0–1 内的色标）。linear 的 from/to 是 shape 本帧实际绘制矩形的归一化坐标：原点为单元框左上角，宽高取 width/height 姿态（缺省为单元框），在节点变换之前；因此宽高动画拉伸渐变，transform 同时移动、缩放、旋转形状与渐变。圆角与普通填充相同。节点 opacity 按既有离屏层施加一次，paint 自身的颜色 alpha 照常参与。宽或高为 0 时不绘制。`fillPaint` 替代 fill：同一 shape 声明 `fill` 属性或被 fill 动画指向时拒绝；text、label、group、image、repeat 节点声明 `fillPaint` 也拒绝，shape 的 `style` 仍只属于文字。省略 `fillPaint` 的文档序列化不变。示例见 [shape-paint.json](../../crates/caption-scene/tests/fixtures/shape-paint.json)。

波纹位移的坐标为左上原点、向右/向下为正的画布像素中心 `(x, y)`，不随离屏 padding 改变。`axis: y` 从 `(x, y + amplitude × sin(2π × x / wavelength + phase))` 读取源图；`axis: x` 从 `(x + amplitude × sin(2π × y / wavelength + phase), y)` 读取源图。相位先以确定性 `libm::fmod` 按 2π 归一，正弦使用 `libm::sin`；四个源像素的预乘通道分别加权后按 `floor(value + .5)` 转回 RGBA8。不夹到边缘像素，不在透明边界重新归一权重。点击几何仍来自未位移的基础文字。

页相对波纹声明 `caption-wave-context/1` 并给出 `contextNodeId`：位移核、坐标原点与采样合同不变，只是 amplitude、wavelength、phase 在该文字节点当前页排版完成后求值，`layout.x/y/width/height` 为当前页各行盒的并集。例如把源纹理定义为“页矩形四周各扩出半个画布”时，可写 `wavelength = k × (layout.width + canvas.width)`、`amplitude = a × (layout.height + canvas.height)`，`phase` 减去 `2π × (layout.x − canvas.width / 2) / wavelength` 把正弦原点放到该纹理左缘。字段省略时不新增求值操作，序列化与旧像素不变；显式 `null` 或非字符串拒绝。

反馈前缀不包含它自身和后续材质，因此无无限递归；相同时间的输入、布局和前缀滤镜都重新按冻结数据计算，不读取先前播放缓存。多个反馈相乘的最坏基础采样数不得超过 32。仅采样同一 cue 的有效区间，cue 结束时拖尾也结束；变帧率不改变秒级历史窗口。模糊放在反馈前时，各历史样本使用各自时刻的半径；放在反馈后时，使用当前半径模糊合成结果。

**显式局部纹理的噪声色条混合**。

`noise-palette-mix` 材质必须声明 `caption-noise-palette-mix/1` 和 `caption-image-png/1`。`contextNodeId` 指向场景唯一 Text（可有 Group 祖先）；`paletteResourceId` 引用已冻结 PNG。`palettePosition` 是 [0,1] 的 scalar DynamicValue，`phase` 是 [-1000000,1000000] 的 scalar DynamicValue，均在当前页排版后求值；无有效关键帧值回退为0，无当前页输出透明。

必填 `domain:{x,y,width,height}` 均为 length DynamicValue，指定画布坐标中的轴对齐局部纹理范围；x/y 限 ±1000000，width/height 限 [0.001,1000000]。它不自动跟随节点变换，也不从墨迹框、词宽或 advance 推断；调用方必须显式给出变换后的坐标。任一 domain 分量在当前采样没有有效值时输出透明，非法有限范围报 `CAPTION_MATERIAL_INVALID`。domain 外的像素清零，内部按像素中心转换为 `uv=(canvasPixelCenter-domain.xy)/domain.wh`，Y 随画布坐标向下增加。

色条在 `(palettePosition,.5)` 对已经解码的预乘 RGBA PNG 做双线性 clamp 采样，取 RGB；alpha 不参与后续乘法。不执行 gamma 变换，也不重新预乘。phase 转 f32 后按 `phase-floor(phase/289)*289` 归一。固定空间核坐标 `x=(uv*.4-103.15)*2.3*1.35`，取两个三角网格噪声之和 `a=N(x+(0,phase))+N(-x+(0,phase+2.6))`，再令 `n=clamp((clamp(a*.5+.5,0,1)-.5)*1.5+.5,0,1)`。噪声 N 的完整 v1 系数与运算顺序由共享实现 `scene/noise_palette.rs` 及数值回归固定：角点支持项 `.4-dot(x,x)` 的四次方，梯度 `fract(p/41)-1`、归一化 `3.79284291400159-.85373472095314*(a0*a0+h*h)`，最终系数130；不得换成任意通用 noise 函数。

最终 RGB 为 `mix(input.rgb*(2*palette.rgb-.5), vec3(input.a), n)`，alpha 保持原输入；RGB独立夹到[0,1]并写RGBA8，不强制RGB≤alpha。像素计算使用 f32、共享 libm floor，无系统时间/随机数/帧历史。输出可直接进入 `gaussian-axis`/`glow-cascade`，并遵循相同独立颜色/覆盖分量合成路径。固定核按每个目标像素32工作单位计费；复用冻结图片资源和既有材质内存/工作预算。此合同不承诺任意外部引擎的字体框、投影或 GPU 浮点逐像素等价。示例见 [noise-palette-mix.json](../../crates/caption-scene/tests/fixtures/noise-palette-mix.json)。

**反馈等权平均**。feedback 的 `composite:"mean"` 必须声明 `caption-feedback-mean/1`，且 `decay` 必须为 1（否则 `CAPTION_SCENE_INVALID`）；省略 composite 或写 `decay-over` 保持上表的衰减 source-over，旧文档逐字节不变。mean 沿用 samples/step/offset、2 秒窗口与合计 32 样本预算：i=0…samples 中采样时刻 `t − i × step` 落在当前 cue `[start,end)` 内的样本才参与，各自按 i × offset 以与衰减模式相同的放置路径画到独立透明面，再对预乘 RGBA8 逐字节求和，以参与样本数 k 做整数四舍五入 `(Σ + floor(k/2)) / k`；不在 cue 内的样本既不贡献也不计入分母，k=0 时透明。等权平均不依赖已播放帧，任意时刻可独立求值；每个参与样本额外计一次画布面积工作量。GPU `record_material_plan` 对 feedback（含 mean）返回 `CAPTION_MATERIAL_PLAN_UNSUPPORTED`。示例见 [feedback-mean.json](../../crates/caption-scene/tests/fixtures/feedback-mean.json)。

**噪声 UV 位移**。`noise-displace` 必须声明 `caption-noise-displace/1`，复用唯一 Text 当前页上下文（可有 Group 祖先）及 noise-palette-mix 的 `domain` 合同：domain 外像素清零，内部按像素中心取 `uv=(canvasPixelCenter-domain.xy)/domain.wh`；无当前页或任一 domain 分量无有效值时输出透明。`noiseScale:[x,y]` 为静态有限数，各在 [0.001,1000]；`phase` 限 [-1000000,1000000]，`brightness` 限 [-16,16]，`contrast` 限 [0,1000]，`strength` 限 [-16,16]，均为排版后求值的 scalar DynamicValue，无有效关键帧值时都回退 0；越界报 `CAPTION_MATERIAL_INVALID`。噪声源复用上文 noise-palette-mix 的固定 v1 核：phase 同样转 f32 并按 289 归一，`n0=noise(f32(uv.x*noiseScale.x), f32(uv.y*noiseScale.y))`，不换成任意通用 noise。随后按 f64 求 `n=(n0+brightness-0.5)*contrast*10+0.5`、`d=(n-0.5)*strength*domain.width/domain.height`、`uv'=uv+(d,d)`（同一标量加到两轴），再在输入纹理的 `domain.xy+uv'*domain.wh` 处做预乘 RGBA 双线性采样：纹理外 texel 透明，四舍五入回 RGBA8，不重新预乘、不 clamp 坐标。`strength=0` 或 `contrast=0` 时 d=0，domain 内输出与输入逐字节相同。不增加 padding；每个目标像素计 36 工作单位，复用既有材质内存/工作预算。此材质仅由共享 CPU 光栅执行：`record_material_plan` 遇到它返回 `CAPTION_MATERIAL_PLAN_UNSUPPORTED`，GPU 端不得近似替代。示例见 [noise-displace.json](../../crates/caption-scene/tests/fixtures/noise-displace.json)。

**固定角向采样混合**。`angular-sample-blend` 必须显式声明 `caption-angular-sample-blend/1`，复用唯一 Text 的排版后页上下文、显式 `MaterialDomain`、独立关联 RGBA 输出及共享预算。`aspect` 是 [0.0001,10000] 的 scalar DynamicValue，独立于 domain 的宽高比；`angle` 是 [-10000,10000] 弧度的 angle DynamicValue。无有效关键帧值分别回退1和0。domain 同噪声色条材质的有限长度约束，无当前页或任一 domain 分量无有效采样值时输出透明；非法动态值报 `CAPTION_MATERIAL_INVALID`。

对 domain 内每个目标像素中心求归一化 UV=(u,v)。i=0…59，θᵢ=angle×(3.5−2i/59)，令 a=aspect；逆向样本坐标为 `Qx=.5+cos(θ)*(u−.5)+sin(θ)*a*(v−.5)`、`Qy=.5−sin(θ)/a*(u−.5)+cos(θ)*(v−.5)`。域外 Q（任一分量不在闭区间[0,1]）贡献四通道零，仍计入固定分母60；域内 Q 映回前缀画布的像素中心坐标。先在 domain 的首末虚拟 texel 中心夹边（某轴不足一像素时取该轴中点），再做双线性读取；超出实际画布的邻居为透明零，只读取非零权重邻居。原图 I 使用同一个 UV/双线性合同。domain 外的输出为零，不扩大材质边界。

均值 R=Σsample(Qᵢ)/60，输出逐独立RGBA分量为 `.6*I*(1−R.a)+R*R.a`，不做gamma，最后独立 UNORM8 夹取/最近整数舍入，不施加RGB≤alpha约束。angle=0 也执行60次累加及同一混合，不是恒等捷径：理想半透明白(.5,.5,.5,.5)得到(.4,.4,.4,.4)。核中坐标、三角函数、累加与混合使用f32和共享libm；主格式角度统一为弧度，外部角度单位须显式转换。不同纹理分辨率、投影与GPU小数采样精度不因此自动等价。

执行区域是显式domain与画布的交集，包含整个旋转可能覆盖的区域，不只遍历原图非零像素。内存由既有材质表面峰值上界保护；输出表面计一遍清零/写入工作，每个目标像素另计60次变换及原图/旋转样本实际1/2/4个有效源texel读取。读取前扣除共享工作预算，超限停止并返回错误，不输出半张图、减少tap或动态降低质量。可运行夹具见 [angular-sample-blend.json](../../crates/caption-scene/tests/fixtures/angular-sample-blend.json)。

**独立渲染层与真实背景合成**。`caption-render-layers/1` 启用可选 `scene.renderLayers`，最多8项，按数组顺序输出；同一层内按原始cue顺序绘制所有当前活跃cue，重叠cue也不改变层的先后。每项具有唯一 `id`、`source`、最多8个 `materials` 和显式 `blend: source-over|screen|add`（add 另须声明 `caption-layer-add/1`，否则 `CAPTION_CAPABILITY_REQUIRED`）；此时全局 `scene.materials` 必须为空。`source.kind=nodes` 通过 `nodeIds` 选取不重复的场景根节点，每个源只栅格化该子树，未选节点仍参与布局与时钟求值。层内组件材质须绑定该层唯一 Text；不同层可以选择同一文字形成独立处理链，也可以引用不同文字。材质标识在整个场景唯一。旧场景省略 renderLayers 时行为不变。

source-over 使用上述关联分量公式；screen 对每个 RGBA 分量使用 `S+D×(1−S)`，add 对每个 RGBA 分量（含 alpha）使用 `S+D` 并钳到 RGBA8，opacity 与 clip 同乘四个源分量，逐次写目标均独立量化。输出层必须直接作用到真实背景；先在透明底合并再 source-over 会改变结果。共享 `ScenePlan.render_outputs` 保留有序输出，frame-render 逐层合成，字幕实例 opacity 逐输出层应用。单图 `ScenePlan.render` / `CaptionPlan.render` 遇 screen 或 add 明确返回 `CAPTION_BACKDROP_REQUIRED`。通用 DrawOp 的 screen 与 add 只允许根目标（可带仿射与 clip），PushLayer 或 PushMatte 内明确拒绝，不能隐式更改隔离语义。GPU 材质计划把 add 层映射为 RGBA 四分量 One/One 加法混合，写入 RGBA8 目标时同样钳制。示例见 [layer-add.json](../../crates/caption-scene/tests/fixtures/layer-add.json)。材质工作的256Mi采样预算在各层共享，256MiB表面预算包含暂存输出和传输副本，不能每层重置。

**有界图片序列**。`caption-image-sequence/1` 启用 `scene.sequences`：最多64个逻辑序列，每个含唯一 `id`、1..256个标准 `ImageResource` 帧、显式 `premultiply: rounded|shifted-byte`。帧 id 在序列内唯一，assetRef 与 SHA-256 进入正式素材依赖、缺失检查及打包。全部压缩帧限制32MiB；加载时取得所有字节并验证摘要及PNG头，实际选中帧才完整解码。解码输出为RGBA8：调色板及灰度输入接受合法1/2/4/8位，RGB、灰度加alpha及RGBA输入接受8位，拒绝16位；低位深与调色板先展开，再执行预乘。rounded 使用最近整数的 `C×A/255`；shifted-byte 使用整数 `(C×(A+1))>>8`，alpha保持原值；均在双线性采样前执行，不能二次预乘。

层源 `kind=image-sequence` 声明 `sequenceId`、唯一 Text 的 `contextNodeId`、scalar 动态 `frame`、画布长度 `domain` 及静态 `uvScale` / `uvOffset`。frame 必须在 `[0,帧数−1]`，取 floor，不循环、不夹取非法索引。无当前页时该源透明；取帧由时间与输入确定，不保持上一实际播放帧。domain 限制同下述材质；像素中心在域内才绘制，UV按 `(uv−.5)/uvScale+.5+uvOffset` 变换后先局部 clamp，再线性采样。uvScale 各分量范围[.001,1024]，uvOffset限±1024。全局最多4帧LRU，普通图片与所有仍被引用的已解码序列像素共同受64MiB约束；解码临时内存预先计入预算，缺失、坏摘要、坏选中帧及超限明确报错，不复用上一成功帧掩盖错误。

**固定噪声扫过遮罩**。`caption-noisy-sweep/1` 启用 `noisy-sweep`：`id`、`contextNodeId`、`domain`、scalar 动态 `position`（±1024）、静态 `maskScale`（各[.001,1024]）、`reveal`、`uvY:up|down` 均显式给出。domain 使用画布长度：x/y限±1000000，width/height限[.001,1000000]。在domain内计算局部UV，uvY控制纵向；maskScale=[1,1]直接保留UV，否则maskUV=(UV−.5)/maskScale+.5，原图读取位置不变。令s=position，`B=smoothstep(s−.09,s,u)×smoothstep(1−s−.05,1−s,1−u)`，`N=fract(sin(dot(.3×UV,[12.9898,78.233]))×333.5453)`，边缘为`step(1.2,N+B)`。reveal开启时将`u<=s`与边缘取并集。计算固定f32/libm；域外透明，可见像素原始RGBA字节保留。每帧计整面初始化、域内每像素64工作单位及可见像素复制，不跨帧累积状态。

**梯度噪声方向采样**。`gradient-smear` 必须声明 `caption-gradient-smear/1`，复用唯一 Text 的排版后页上下文及 `MaterialDomain` 的单位、边界和无值语义。`rectScale:[x,y]` 为两个 [0.001,10000] 的 scalar DynamicValue，明确噪声各轴的相对尺寸，不从字体或纹理猜测。`evolution`、`seed` 均限 ±100000，`stretch` 限 ±2，`progress` 限 [0,1]，`strength:[x,y]` 各限 ±16。无有效值时 rectScale 回退1，其余回退0；无当前页或 domain 无有效值时输出透明。非法动态数值与非有限中间坐标报 `CAPTION_MATERIAL_INVALID`。

必填冻结 `noise` 包含 complexity [1,10]、cycle [0,10000]、brightness [−4,4]、range [0,16]、scale1/scale2（各两个 [0.001,10000] 数）、offset/subOffset（各两个 ±10000 数）、rotation/subRotation（各 ±10000 弧度）、subImpact [0,1]、subScale [1,10000]。所有字段有限且必填，不接受任意函数、着色器或可调 tap 数。`uvY` 必填 `up` 或 `down`，同时决定噪声坐标与逆采样方向；画布 domain 始终向下为正。

固定 v1 核以 quintic 插值构造 evolving 二维梯度噪声，格点比为 `.5*rectScale`；每层先减 `subOffset/(50*rectScale)`，再旋转并乘 `100/subScale`，权重按 subImpact 递乘，末层保留 complexity 小数部分。seed 分别扰动两组频率及水平伸缩，progress<.5 翻转噪声方向；横轴噪声受 `clamp(1-abs(stretch),0,1)` 调制。噪声经过 brightness 与 strength 调整后，位移轴系数分别为 `clamp(scale1.x,.01,1)*range*13/rectScale.x` 和 `clamp(scale2.x,.01,1)*range*2.6/rectScale.y`。旋转的纵向比例调整在减去 `.5` 中心之前发生，不能替换成通常的绕中心等比旋转。完整固定 hash、系数与运算顺序由 [gradient_smear.rs](../../crates/subtitle-render/src/scene/gradient_smear.rs) 实现及数值夹具共同锁定。

从噪声位移坐标到原 UV 等距读取128次，包含两个端点（i/127）；每次按同角向材质的局部域 bilinear/透明越界合同读取独立 RGBA，越界仍计入分母128，最后独立 UNORM8 舍入。零 strength 也执行同一累加，不加入额外淡入、颜色覆盖或全局 alpha。只遍历 domain 与画布交集，域外输出透明；不按原图非零像素裁窄拖影。

像素数学使用 f32 与共享 libm，无上一帧或系统随机数。每个输出像素先扣 `32+64*(ceil(complexity)+1)` 噪声工作单位，再扣128次变换和实际1/2/4个有效源texel读取；清零/输出表面另计一次，使用同一256 Mi工作预算和256 MiB表面预算。超限失败，不减少tap或返回半张图。不同GPU的融合运算、sin/pow精度或字形投影不属于逐像素一致承诺。可运行夹具见 [gradient-smear.json](../../crates/caption-scene/tests/fixtures/gradient-smear.json)。

box blur、波纹位移与反馈按各自传播范围预留透明边界；独立分量高斯/级联发光则按上述固定原画布边界执行，不扩大滤镜输入；波纹常量幅度按 `ceil(abs(amplitude))` 预留，动态幅度按上限 256 像素预留，最后才裁回画布，避免画布边缘的滤镜截断。执行前核对暂存/输出表面的保守上界（256 MiB），每次采样共享表达式预算，材质光栅/模糊/混合总像素工作量不超过 256 Mi 像素；波纹按每个输出像素四次源像素读取计费，soft-band 按一遍输出像素计费，其排版后上下文解析同样使用共享表达式/重排预算。超限报 `CAPTION_BUDGET_EXCEEDED`，不减少样本或降低效果。该预算是准入限制，不保证复杂反馈场景实时运行。

资源声明在写文档时与视频里的素材版本、内容摘要及 MIME 核对，`DocumentRevision.assetRefs` 由引擎生成。导出计划把文档依赖加入冻结素材集合；预览宿主只按该修订的依赖加载字节，不取素材的最新版本。清理保护仍被历史文档修订引用的资源，便携包恢复时重新核对正文、索引与素材；索引被删改也拒绝。字体清点只执行文字准备，不要求图片在线。

图片绘制前验证 SHA-256、PNG 签名、尺寸和解码预算；每张编码图最多 16 MiB，所有解码图合计最多 64 MiB，最多 64 个资源。资源准备原子完成，缺失/不匹配时整层报告，不画成空白。图片和文字都进入同一 DrawOp 流。彩色字形继续使用字体自身的色彩位图，有序涂装仅作用于轮廓字形；图片不接受文字 fill/描边参数。

没有真实词时间时，默认不产生朗读高亮并跳过需要词时钟的关键帧；cue 入退场仍可用。显式 estimated 才均分显示词的时序，不写回转录。无词时间而需要多页显示时按页均分 cue 展示区间，这仅是分页时间，不是朗读时间。场景语义时钟由既有 source/sequence/occurrence 映射提供；页面窗口裁剪显示，不累计 deltaTime。渲染同一时刻不依赖已画过的帧。

当前预算：每场景最多 256 个模板节点、128 个参数和纯函数、1024 条动画；每条轨最多 1024 个关键帧，每个 cue 最多 4096 个词；每帧最多 65536 次表达式/记录操作，画布最多 16777216 像素。预算和错误作为执行合同，不截断后继续画。共享样式的不同实例各自绑定参数与 occurrence，不按 style ID 把它们合并成一个场景。

**已落盘的样式正文**。`CaptionStyleBody` 还没有落盘，落盘时由一层确定的编译折成 Studio 样式（设计稿 §8），内核不换；旧字幕样式文档继续支持下面两种正文，与上面的动态场景分支并存：

- Studio 样式（`baocut.legacy-studio-style/0.1`）：`style` 是 v2 的字幕样式，逐词动画写在 `style.wordAnimation`（或 `style.anim`）里，`catalogId` 指逐词动画目录的一格。
- Studio 样式的摆放：`style.y` 是锚线高度（画布高度的百分比，缺省 86），`style.verticalAlign`（`top` | `center` | `bottom`，缺省 `center`）说字幕块的上边、中线或下边落在锚线上，折成多行时往另一边长；`style.x` 是块中心（画布宽度的百分比，缺省 50）；`style.width` 是最大行宽（画布宽度的百分比，[5, 100]，缺省 80），烧录与预览在这个宽度里折行；`style.fontSize` 是 540 短边下的字号（缺省 30，按画布短边等比放大）。`origStyle` / `transStyle` 里的同名键只挪那一行。切字幕条按 LayoutProfile，不看这些键。智能体用 `captions_create` 的 `style` 与 `edits_apply` 的 `setCaptionStyle` 写同一组键（架构设计 §3.5）。
- Studio 样式在分屏段的摆放：`style.panelSeam`（缺省 true）开着时，一句字幕开始的那一刻画面上是分屏的视频（§3.5 的 `panels` 起作用），这一句整块的中线落在离 `style.y` 最近的一条横向接缝上（一格的下边与另一格的上边相接处：上下两格、田字格与「上一下二」是 50，三行是 33.333 或 66.667；格子之间留了间距时，接缝是间距的中线——下面那格的上边离上面那格的下边不到画布高度的 10%、两格横向有重叠，取两边的中点，三位小数，例如 9:16 三行间距 2 是 33.146 与 66.855，「上一下二」仍是 50），到这一句结束都不动，片段中途换回一人也不动。「开始的那一刻」是字幕文档里这一句的开始，不含 `displayTiming.leadIn` 提前显示的那一段（镜头切到全景通常正落在下一句开头）；源素材时钟上，这一刻被剪掉时取它之后第一次显示的地方。那一刻不是分屏、或格子之间没有横向接缝时照 `style.y` 与 `verticalAlign` 摆。按块的中线而不是 `verticalAlign` 那条边落到接缝：底边钉在接缝上，几行字都长在上一格人的胸口上。只挪位置，不改字号、宽度与底板；双语的两行一起挪，按两行里先开始的那一句定；居中摆放的字幕、逐句样式 `cueStyles` 里自己写了 `y` 的那一句、`origStyle` / `transStyle` 里写了 `x`、`y` 单独摆的那一行不挪；模板避让（§3.17）照样作用。位置不写进文档，跟着片段当下的 `panels`：换回一人、改格子、整份重套字幕样式之后都不用补写。定位框样式与动态场景不挪，导出的字幕文件（SRT、VTT、ASS）不受影响。
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

### 7.12 ChapterSheet

章节表（[动效视频设计](../design/motion-video/motion-video-design.md) §2）：一章一行，把这一章的脚本、配音、代码包版本与落在时间线上的实例和标记绑在一起。存为 `kind: 'chapter-sheet'` 的文档，正文 `schema` 为 `baocut.chapter-sheet/1`；一个序列最多一张，多于一张时读的一方取最新写入的那份。

```ts
interface ChapterSheetBody {
  schema: 'baocut.chapter-sheet/1';
  sequenceId: Id;
  kind: 'explainer' | 'music-video' | 'custom';
  inputs?: { audioRef?: VersionRef; lyricsRef?: VersionRef; scriptRef?: VersionRef };
  chapters: Array<{
    id: Id;                                   // 稿里的章节号（s01、s04b…）；重做不换
    title: string;
    script?: { markdown: string; imageRefs?: VersionRef[] };
    narration?: { assetRef: VersionRef; speechRef?: VersionRef };
    section?: { start: MediaTime; end: MediaTime };
    bundle?: { assetRef: VersionRef; revision: Revision };
    duration: { owner: 'narration' | 'section' | 'bundle' | 'user'; frames: number; tail?: number };
    status: 'planned' | 'narrated' | 'built' | 'placed' | 'stale';
    stale?: Array<'script' | 'narration' | 'bundle' | 'placement'>;
  }>;
  compiled: Record<Id /* chapterId */, { itemId: Id; markerId: Id; audioItemIds: Id[]; viaTransactionId: Id }>;
}
```

- `chapters` 的顺序是播放顺序；字段的含义、时长归属与过期链见动效视频设计 §2.2–§2.4。
- 今天的实现：章节表由写入方（智能体、拼装脚本）经 `putDocument` / `documents_put` 写入，`compiled` 由写入方按它放上时间线的实例与 `chapter` 标记填；Runtime 不编译、不核对正文（与 §4.6 其余正文一样）。读的一方只有轻量视图的侧栏：`compiled[章节 ID].markerId` 对到序列上的章节标记，「台词」页那一段显示这一章的 `script.markdown`（只读），「脚本」页按这个对应把正在播的那一段对到整份脚本（§7.13）里以章节 ID 开头的小节（[轻量编辑器设计](../design/lite-editor/lite-editor-design.md) §3「侧栏」）；`sequenceId` 不是这个序列、或 `schema` 不认识时整份不读。
- `chapters_compile`、过期传播与 §7.10 的取代随动效视频设计 §11 第 2 阶段补。

### 7.13 Script

做这部视频时写下的整份脚本：存为 `kind: 'script'` 的文档，正文 `schema` 为 `baocut.script/1`。一部视频通常一份；多于一份时读的一方取当前版本最新写入的那份。

```ts
interface ScriptBody {
  schema: 'baocut.script/1';
  markdown: string;          // 整份脚本；小节用 Markdown 标题，标题第一个词写章节表的章节 ID（`## s02 聊天 AI 在写作文`）时能对到章节
  file?: string;             // 生成方那边的文件名（`脚本.md`），只用来显示
}
```

- 脚本的版本就是这份文档的版本（§4.4）：生成方（智能体、拼装脚本）重写一次，经 `putDocument` / `documents_put` 写成新的一版；不另造版本记录。写入的事务按修改历史找到是谁写的。
- 回到某一版：把那一版的正文原样写成新的一版，文档版本的 `summary` 记 `{ restoredFrom: <那一版的 Revision> }`；之前的版本都还在。正文与当前版本相同时不写。
- 只换脚本：回到版本不改时间线、旁白、字幕与章节表；要按脚本重做哪一段由智能体另做。
- `markdown` 不是字符串、或 `schema` 不认识时正文不解释，文档头照常（§4.6）。Runtime 不核对正文。
- 读的一方今天是轻量视图侧栏的「脚本」页与「脚本的版本」页（[轻量编辑器设计](../design/lite-editor/lite-editor-design.md) §3「侧栏」）：小节对章节先比标题第一个词与章节表的章节 ID（§7.12 的 `compiled[章节 ID].markerId`），再比标题与段名；版本列表按与前一版逐块（空行与标题切块）比对写标题。

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

`entries` 是每个素材版本与文档版本一项。收进包的单个文件，它在 `files` 里的 sha256 就是版本的 `contentHash`；目录素材的 `contentHash` 是按 §4.2 的规则算出的目录摘要，由引擎打开时重算。`files` 与归档里的文件一一对应。素材按内容放（`assets/<摘要>`），bytes 相同的几个版本的条目指向同一个文件，那个文件只写一次。

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

## 9. 工作区快照与版本文件

项目里的视频在自己的目录里另有一份当前状态的文本，叫**工作区快照**，旁边是最近的若干**版本**：每个版本是一份从上一版到这一版的 diff，开头列出这一版做了什么。它们不依赖 git，有 git 时可以随快照一起提交。产品取舍见[版本记录设计](../design/version-history/version-history-design.md)，存储与调度见[架构设计 §5.12](../architecture/architecture-design.md#512-视频的版本记录)。

快照与版本是派生物：`video.db` 仍是唯一的权威，只有持有写锁的引擎从已提交的状态生成它们，不是第二个写入端。读回来只用于重建（§9.7）、回到版本（§9.5）与导入外部改动（§9.8）；导入也是作为一笔事务提交进库，不绕过它。

### 9.1 布局

```text
<video-dir>/
  video.db, video.lock, blobs/
  .bcut-snapshot/
    video.json                    # 快照的主文件（§9.2）
    documents/<documentId>.json   # 每个文档当前版本的正文，一个文档一个文件
    history/
      000001.patch …              # 版本文件，一版一个（§9.4）
      000012.base                 # 只有打开着的最新一版有：这一版开始时的快照
```

- 点目录：Space 的扫描、文件列表与文件监视都跳过点开头的名字，快照不作为用户内容出现。物理删除视频时它与 `video.db`、`blobs/` 一样归视频（架构设计 §5.7）。
- 文档文件名不带版本号：改一句话是同一个文件里改一行。便携包的 `documents/<id>/<revision>.json`（§8）不同。
- 每个文件先写同目录的临时文件 `.<名字>.partial`，再改名替换。快照文件的写入顺序是先文档、再 `video.json`，最后删掉不再有的文档文件；版本文件在快照之后写（§9.4）。
- 文件都是 UTF-8 文本，换行 LF，以换行结尾；路径一律 `/` 分隔、相对 `.bcut-snapshot/`。读快照文件时 CRLF 当作 LF（§9.8）。
- 只有项目里的视频有快照与版本。不属于项目的视频（会话文件夹里的）不写，保存、回到与删除版本以 `VERSIONS_NEED_PROJECT` 拒绝。
- 只有 `.bcut-snapshot/video.json`、没有 `video.db` 的目录仍是一部视频，状态是待重建（§9.7）。

### 9.2 快照

```ts
interface WorkspaceSnapshot {
  format: 'baocut.workspace-snapshot';
  schemaVersion: 1;
  videoSchemaVersion: number;              // 本规范的 schemaVersion
  timeContractVersion: number;             // §2.3
  videoId: Id;
  video: JsonValue;                        // 视频实体：名字、根序列、速览
  sequences: Record<Id, JsonValue>;        // 序列头
  tracks: Record<Id, PlacedRow>;
  items: Record<Id, PlacedRow>;
  transitions: Record<Id, PlacedRow>;
  markers: Record<Id, PlacedRow>;
  ducking: Record<Id, PlacedRow>;
  assets: Record<Id, JsonValue>;           // 素材记录，整条
  documents: Record<Id, JsonValue>;        // 文档头，只留当前版本
  documentFiles: Record<Id, string>;       // 每个文档文件的 'sha256:<hex>'
}
interface PlacedRow { sequenceId: Id; body: JsonValue }
```

**投影**：`video.json` 是实体在库里的存储形式按种类、按 ID 排开的扁平投影，不是 `VideoSnapshot`（§3.1）的嵌套形式。

- 实体原样写，不补默认值、不丢可选字段。修订号、事件序号这类每次提交都变的计数不在实体里，不写；写入时的修订号记在库的 meta 里（§9.7）。
- 文档头只留当前版本，正文也只写当前版本。
- 素材记录整条保留，包括它的全部素材版本。
- 检查点与保护不写：保存的版本在版本记录里（§9.6）；回到版本时两者保持现状（§9.5）。
- 不写 `projectId` 与 `previousVideoIds`：它们不属于修订内容（§1.3）。
- 链接素材的路径：项目内的本来就相对视频目录（§4.2）；项目外、用户主目录下的写成 `~/` 开头，读回时按读的一方的主目录展开；其余（外接盘、网络共享）保留绝对路径。快照因此会带上项目外素材的路径；完全不想带路径时用便携包分享（§8.2）。
- 快照里没有撤销历史、回执与 outbox。

**行稳定的排版**：快照与版本文件都由引擎生成，Runtime 只读不重写。

- 对象的键按字典序。
- 根对象与它的容器成员展开：每个成员一行，缩进两个空格。第三层起每个值压成一行键有序的紧凑 JSON。于是一个实例、一个标记、一个素材各占一行；转录正文里一个句段连同它的词时间占一行。
- 同一状态必须得到逐字节相同的文本。改一个实例的入点，diff 是一行。

**读**：任何一项不符都以 `SNAPSHOT_INVALID` 拒绝，不导入半成品。

- `format` 是 `baocut.workspace-snapshot`；`schemaVersion`、`videoSchemaVersion`、`timeContractVersion` 都等于读的一方支持的版本。
- 字段按上面的类型，不认识的字段拒绝。
- `documentFiles` 与 `documents` 列的文档一致，每个文档文件存在、摘要相符；正文按 §4.4 的规则核对，按存下的原文算出的内容摘要与长度等于文档版本的记录。
- 实体满足提交时的规则（ID 唯一、引用都在、不重叠、转场成立）。

**往返不变**：从快照重建（§9.7）或导入（§9.8）之后立即写出的快照，必须与读入的逐字节相同。投影与读都不能补默认值、丢可选字段或改顺序，否则最新一版的摘要对不上，保留的版本全部回不去（§9.5）。

**何时写**（调度属于 Runtime，架构设计 §5.12）：

- 打开视频时立即写一次：没有快照的写下基线，上次没来得及写的补上，没有变化时什么也不改。
- 最后一笔修改之后 10 秒写一次（去抖）。
- 关闭视频时，在放下写锁之前写。
- 保存版本、回到版本与删除保存的版本之前，引擎自己先写一次。

每次写只重写内容变了的文件，相同的不碰。磁盘上有快照文件与上次写下的都不同（被外部改过，例如 `git pull`、同步盘、手改）时不写、不覆盖，报 `SNAPSHOT_CONFLICT` 并列出这些文件，由 §9.8 导入或等用户选；磁盘上的恰好等于库里的状态时不算，照常写。

### 9.3 版本的边界

每部视频的最新一版是**打开**的：之后的写可以并进来。每次写快照时，引擎判断这次的改动并入它还是开一个新版本，满足任一条件就开新版本：

| 条件 | 说明 |
| --- | --- |
| 安静满 5 分钟 | 最新一版最后一次更新距现在超过 5 分钟 |
| 最新一版满 30 分钟 | 一直在改时，30 分钟切一版 |
| 最新一版不是普通的一段 | 保存、回到版本、重建、导入外部改动各自单独成版，之后的改动另开一版 |
| 新回合 | `versions.cadence` 是 `turn` 时，智能体新回合的第一次有改动的写（`boundary: 'turn'`，由 Runtime 传入） |

- 第一次写（还没有版本）只写基线，不产生版本：打开时立即写一次，之后的第一笔修改才成为版本 1。
- 内容没有变化时不写文件、不开版本；最新一版还开着时，这段修订仍记进它的动作清单。
- 关闭视频不封存版本。5 分钟内重新打开继续改，改动并入同一版。
- 保存与回到版本先把手上的改动按上面的规则写掉，再单独成版。
- 5 分钟与 30 分钟是可调的产品参数，不是保证。

### 9.4 版本文件

`history/<序号>.patch`。序号是这部视频里递增的十进制数，至少 6 位、前面补零，不复用：下一个序号记在库的 meta 里（§9.7），版本文件全删了也不回头。内容是头部、一个空行，再接一份标准 unified diff：

```text
BaoCut-Version: 12
Kind: segment
Started-At: 2026-10-17T09:41:07.000Z
Updated-At: 2026-10-17T10:02:55.000Z
Revisions: 40..57
Summary: Trim clip and more (14 changes)
Summary-Ref: {"key":"engine.labelMoreChanges","params":{…}}
Action: agent:claude | Cut pauses | 3
Action: user_local | Trim clip | 11
Action-Ref: {"key":"engine.labelTrimClip"}
Conversation: conv_8f2 | Launch rough cut
File: video.json sha256:3f1a… sha256:9c0d…
File: documents/doc_5b1.json - sha256:41b8…

--- a/video.json
+++ b/video.json
@@ -12 +12 @@
-    "itm_…": {"body":{…},"sequenceId":"seq_…"},
+    "itm_…": {"body":{…},"sequenceId":"seq_…"},
```

头部每行 `键: 值`，键固定为英文；值里的 `\`、换行、回车写成 `\\`、`\n`、`\r`。读的一方跳过不认识的键；读不出 `BaoCut-Version`、它与文件名的序号不同或者 diff 读不出来的文件是**读不出的版本**。

| 键 | 值 |
| --- | --- |
| `BaoCut-Version` | 序号 |
| `Kind` | `segment`（普通的一段）、`save`（保存的版本，§9.6）、`restore`（回到版本，§9.5）、`rebuild`（重建，§9.7）、`external`（导入的外部改动，§9.8） |
| `Started-At`、`Updated-At` | 这一版开始与最后一次更新的时间，RFC 3339 UTC |
| `Revisions` | `<开始>..<结束>`：这一版开始时快照的修订号与结束时的修订号 |
| `Summary` | 给人看的一句话，写英文缺省文字 |
| `Summary-Ref` | 可选。摘要的多语言引用（JSON）：界面按当前语言显示，没有时显示 `Summary`。普通的一段由动作清单按模板拼出，不调用模型；保存的版本是它的名字 |
| `Action` | 每行一个操作：`执行者 | 标签 | 次数`，取自 `Revisions` 范围里的事务，同一执行者、同一标签合在一起计数，按首次出现的顺序。执行者是事务的操作者 ID（`user_local`、`agent:<name>`、`external:<serviceId>`、`system:…`）。有 `labelRef` 的标签写英文缺省文字，智能体给的自由文本原样保留 |
| `Action-Ref` | 可选，紧跟在它说明的 `Action` 后面：标签的多语言引用（JSON） |
| `Actions-Omitted` | 可选。超过 50 行之后只计数的事务数 |
| `Conversation` | 这一版里改过视频的会话：`会话 ID | 标题` |
| `Name`、`Note`、`Checkpoint` | 只有保存的版本有：名字、可选的说明、对应的检查点 ID |
| `File` | 每个改动文件一行：`路径 之前的摘要 之后的摘要`，不存在的一侧写 `-` |

**diff**：从上一版结束时的快照到这一版结束时的快照，覆盖 `video.json` 与 `documents/` 下的文件；路径加 `a/`、`b/` 前缀，新建与删除的一侧写 `/dev/null`，上下文 3 行。`patch` 与 `git apply` 都跳过 diff 之前的文字，所以在 BaoCut 之外也能用 `patch -R` 逐版退回快照文本。

**打开着的版本**：最新一版旁边有 `<序号>.base`，是这一版开始时的快照（JSON：`{ "files": { 路径: 文本 } }`）。

- 并入这一版时，diff 从它重算，崩溃后也能重算。
- 开新版本时先写新的起点文件：它在，这一版就开了；写完新版本再删掉上一版的。
- 起点文件只属于最新一版；持有写锁时发现别的版本旁边有，是崩溃留下的，删掉。

**保留与清理**：只在写快照开了新版本时进行。

- 保留最近 `versions.keep`（默认 10）个未命名的版本，最新一版计在里面，加上全部保存的版本。最新一版总是留着。
- `history/` 的总大小超过 64 MiB 时，再从最旧的未命名版本删起，直到降到上限的 90%。
- 删掉最旧的一段直接删文件。删掉中间的版本时，紧接着的那一版的 diff 改为从被删的一段之前直接算到它自己：还原出两端的快照重新求差，头部的开始时间与修订号取最早被删的一版，动作清单与会话合在一起。版本链对不上（§9.5）时，需要合并的那些留着不删。

**素材的引用**：版本文件与起点文件里出现的内容摘要都是 GC 的引用（架构设计 §5.5）：保留的版本能回到的状态用到的 blob 不被清理。快照与版本文件被删、被改，只会让 GC 留下更少，不会让库里当前用到的素材丢失。

### 9.5 回到版本

可以回到一个版本**结束时**的状态，也可以回到它**开始之前**（`before`），所以最旧的保留版本之前也回得去。

1. 先写一次快照：手上的改动按 §9.3 并入或成版。
2. 从最新快照开始，按序号从新到旧逐版反向应用 diff，直到目标：
   - 每一步先核对 `File` 行之后一侧的摘要，反向应用要求精确匹配，应用后再核对之前一侧的摘要；
   - 两个读得出的版本之间夹着读不出的版本，链断在读不出的那一版。
3. 任何一步对不上就停下，以 `VERSION_CHAIN_BROKEN` 拒绝，`details.brokenAt` 是断开的序号：它及更早的状态都回不去，视频不变。目标是读不出的版本，同样拒绝；没有这个序号是 `VERSION_NOT_FOUND`。
4. 还原出的快照按 §9.2 读出，按提交时的规则检查。内容实体（视频本身、序列、轨道、实例、转场、标记、闪避、素材、文档）换成目标的；检查点与保护保持现状。
   - 文档版本在库里有、内容相同的直接引用；库里没有的连正文一起写入；同一版本号在库里是别的内容时换一个新号。
5. 结果与当前状态相同时不提交，也不产生版本。否则作为**一笔**可撤销的事务提交：
   - 标签是「回到版本 N」或「回到版本 N 之前」；
   - 智能体任务的保护范围照常检查（§3.10），触碰的被拒绝；
   - 提交后单独成一个 `restore` 版本。
6. 同一个 `commandId` 重试时返回第一次的结果，不再产生版本。

目标用到的素材已经不在时，按 §9.4 本不该发生；万一发生，与重建一样标为缺失（§9.7）。

### 9.6 保存与删除版本

**保存版本**把当前状态存成一个具名版本：

1. 先写一次快照，手上的改动按 §9.3 并入或成版。
2. 建一个检查点（§3.11），事务标签是「保存版本」。
3. 单独成一个 `save` 版本，头部写 `Name`、可选的 `Note` 与 `Checkpoint`；它的 diff 通常是空的。

- 保存的版本不计入 `versions.keep`，也不被大小上限清理，只能由用户或智能体删除。
- 同一个 `commandId` 重试时返回已有的版本。

**删除版本**只能删保存的版本，别的种类以 `INVALID_OPERATION` 拒绝：

- 它是最新一版时，变回普通的一段：去掉名字、说明与检查点，之后的改动可以并进来。
- 否则按 §9.4 合并两侧的 diff 后删掉文件；版本链对不上时不删，以 `VERSION_CHAIN_BROKEN` 拒绝。
- 它的检查点还在时，作为一笔事务删掉，标签是「删除保存的版本」。

### 9.7 簿记、状态与重建

**簿记**记在 `video.db` 的 meta 里。它们不属于修订内容：写它们不产生新修订，不进撤销历史，不出现在快照里。

| 键 | 内容 |
| --- | --- |
| `snapshotRevision` | 最后一次写快照时的修订号 |
| `snapshotFiles` | 那一次写下的每个快照文件的摘要（JSON 对象：路径 → `sha256:<hex>`） |
| `snapshotDigest` | 整份快照的摘要：`路径 摘要` 按路径排序逐行拼接后的 sha256 |
| `snapshotPending` | 正在写的那组文件的摘要：写文件之前记下，写完与 `snapshotFiles` 一起换掉。崩溃后磁盘上是旧的或新的都认得，不当作外部改动 |
| `versionsNext` | 下一个版本序号 |

**状态**（`videos.versions.status`）：

| 状态 | 条件 |
| --- | --- |
| `rebuild`（待重建） | 没有 `video.db`，有 `.bcut-snapshot/video.json` |
| `external` | 磁盘上有快照文件与 `snapshotFiles`、`snapshotPending` 都不同，列在 `changedPaths`，库里没有还没写进快照的改动，快照读得出：只有快照被外部改过，发现时导入（§9.8） |
| `conflict` | 同上，但库里也有还没写进快照的改动（`conflict: 'both-changed'`），或快照读不出（`conflict: 'invalid'`）：不导入、不覆盖，等用户选（§9.8） |
| `missing` | 还没写过快照，或 `video.json` 不在 |
| `pending` | 正在写，或 `snapshotRevision` 落后于库的修订号，或磁盘上的快照正是库里的状态而簿记还没跟上（中断的写）：几秒内会写 |
| `synced` | 快照等于库里的状态 |

**重建**：待重建的目录在打开项目时（与认领视频同一个预处理）或打开它时就地建库：

- 保留快照里的 `videoId`。快照不记所属项目，重建的视频由第一次认领它的项目写入，之后照常按 §1.3 认领。这与打开便携包不同，便携包总给新的 `videoId`（§8）。
- 修订号从 1 开始，撤销历史从重建开始。文档按当前版本导入，正文按 §9.2 核对。
- 收进来的素材在 `blobs/` 里有就引用，没有就是缺失；链接素材照常解析，找不到也是缺失，由用户或智能体 `relinkAsset`（§4.2）。
- `snapshotFiles` 与 `snapshotDigest` 取自读入的文件。
- 目录里还有版本文件时（整个文件夹被拷过来而 `video.db` 丢了），追加一个 `rebuild` 版本，diff 通常为空，更早的版本照常可以回到。没有版本文件时（git 克隆，版本文件默认不进 git），只写基线，版本记录从重建开始。
- 目录里已经有 `video.db` 时拒绝。

### 9.8 外部改动

用户 `git pull`、切换分支、`git checkout -- <path>`，同步盘覆盖了文件，或者手改了快照，磁盘上就会有快照文件与 `snapshotFiles`、`snapshotPending` 都不同（§9.7）。只少了文件不算：下一次写补回来。

- **换行**：读快照文件时 CRLF 当作 LF，摘要按换行统一后的文本算。Windows 上 `core.autocrlf=true` 检出的快照不算外部改动，也不被改写回 LF。JSON 字符串里的回车总是转义的，文件里的 CRLF 只会是行尾。
- **库里有还没写进快照的改动**按内容判断：当前状态的投影与 `snapshotFiles` 不同。只建检查点这类不进快照的修改不算。

| 情形 | 状态（§9.7） | 处理 |
| --- | --- | --- |
| 磁盘上的正是库里的状态（中断的写或导入之后） | `pending` | 不算外部改动，下一次写补上簿记 |
| 只有快照被改，快照读得出 | `external` | 导入 |
| 两边都改了 | `conflict`，`conflict: 'both-changed'` | 不导入、不覆盖，等用户选 |
| 快照读不出（§9.2「读」） | `conflict`，`conflict: 'invalid'` | 不导入、不覆盖，只能保留 BaoCut 里的 |

**导入**（引擎命令 `videos.applySnapshot`）：

1. 磁盘上的快照按 §9.2 读出，按提交时的规则检查；读不出以 `SNAPSHOT_INVALID` 拒绝，视频不变。
2. 内容实体换成快照里的，按实体与文档求差，与回到版本相同（§9.5 第 4 步）：检查点与保护保持现状，文档版本按同样的规则引用或写入。
3. 作为**一笔**可撤销的事务提交：标签是「外部变更」，操作者是 `system:history`。
4. 单独成一个 `external` 版本，diff 从导入前库里的状态算到磁盘上的快照，版本链不断；之后的改动另开一版。
5. 簿记换成磁盘上的文件。按往返不变（§9.2），快照文件不被改写；只差排版的文件写回规范的文本。
6. 内容没有变化（例如只改了缩进）时不提交、不产生版本，只写回规范的文本。
7. 同一个 `commandId` 重试时返回第一次的事务，不再产生版本。

快照引用的收进来的素材在 `blobs/` 里没有（`blobs/` 不进 git）、链接素材找不到时，与重建一样是缺失（§9.7）。

**撤销导入**：撤销这笔事务后库领先，下一次写把快照写回撤销后的状态，成为普通的一段，相当于拒绝了这次外部改动。撤销按操作者分开，调用者的 `target: 'undo'` 撤不到 `system:history` 的这笔，要用 `edits.undo` 的 `target: { transaction }` 指定它（命令与协议规范 §8.3）。

**两边都改了时的选择**（`videos.versions.resolve`）：

- **保留 BaoCut 里的**（`keep: 'video'`）：立即写快照，覆盖磁盘上的。外部改动不进版本记录；它在 git 或同步盘里的历史由它们保留。版本照常按 §9.3 并入或开新版本，diff 从上一版结束时算起。
- **用磁盘上的**（`keep: 'snapshot'`）：先把库里还没写进快照的改动封存成一版，再按上面导入。
  - 封存只写版本文件，不动磁盘上的快照。最新一版是普通的一段、还在 §9.3 的时限里时并入它，否则开新版本；`external` 版本从它结束时算起。
  - BaoCut 里的改动因此仍在版本记录里，回到 `external` 版本之前（`before`）就能找回，也仍在撤销历史里。
  - 还没有任何版本时不另封存：`external` 版本直接从库里的状态算起，回到它之前同样找回这些改动。
- 快照读不出时只能保留 BaoCut 里的；选用磁盘上的以 `SNAPSHOT_INVALID` 拒绝。
- 用户选之前，这部视频的快照不被重写，编辑照常进行；选完照常去抖写入。
- 什么时候发现外部改动由 Runtime 决定（架构设计 §5.12）。

---

## 10. 待补全项

以下类型或规则由本规范补全，或仍有空缺，需要在实现前评审。

| 事项 | 状态 | 需要决定什么 |
| --- | --- | --- |
| 文字样式与图形模型（§3.6） | 已定：图形取 v2 的 `shape` 参数与形状目录；文字样式取 v2 的样式对象，字体按 §3.14 引用；文字样式的键表还没有写进本规范 | 随渲染核心移植写入文字样式的键、单位与取值；文字框固定还是随内容撑开 |
| 关键帧与元素动画（§3.15） | 已定：关键帧的属性白名单、百分比时刻、`motion` 的缓动表；入场、出场、循环三槽作为正式字段保存，由 `motion` 取样，不展开成关键帧；`animationBindings` 与 `animate` 都未实现 | 字幕动画是否沿用同一套槽 |
| 圆角的单位（§3.5） | 已定：540 短边下的像素，四角各自的值 `cornerRadii` | — |
| 留边底色与画布背景（§3.2、§3.5） | 已定：实例的 `bg` 在全屏加 `contain` 时铺满画布；画布背景是纯色 | — |
| `Crop`（§3.5） | 已定：四边各裁掉的比例，在 `fit` 之前，只用于视频与图片 | — |
| `FocalPoint`（§3.5） | 已定：`cover` 留下哪一段，[0, 1]，省略时居中，只用于视频与图片 | — |
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
| 模板层（§3.17） | 已定：套用、存进品牌库、版面编辑与画幅锁（`template-ratio-locked`）已实现 | `ratio` 与画幅版本（§7.7）怎么共处 |
| v2 的 `bcfClip`（音频元素） | 已定：配音认领代码合成里的口播句子，落成合成与配音的音画联动组（§3.7「声音」）；认领的句子 ID 不进格式 | 合成能实时运行时，是否按句只扣掉认领的声音 |
| 可变帧率（§2.11） | 规则已定，未实现 | 现在按标称帧率处理 |
| HDR | 首版只支持 SDR 严格导出 | HDR 输入的 tone-map 策略 |
| 变速曲线、倒放、`preserve=frames` | 未纳入 | 是否以及何时开放 |
| 工作区快照与版本（§9） | 已实现：快照、版本的边界与文件、保留与清理、回到版本、保存与删除版本、从快照重建、导入外部改动与两边都改了时的选择（§9.8，选择的界面未做） | 快照的格式版本升级后旧快照怎么读（现在要求相等）；同一项目里两个目录重建出同一个 `videoId` 时是否当作副本换标识 |
