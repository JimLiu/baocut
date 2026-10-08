# BaoCut 代码包规范

> 代码合成让作者与智能体用 p5.js、Three.js、Canvas、Remotion 等技术制作动画，并作为时间线上的一个实例参与合成。本规范定义代码包的清单、实例字段、作者必须遵守的合同、时间依赖的声明，以及 Bake。

格式标识：`baocut.code-bundle`，`schemaVersion: 1`（即 `bundleSchemaVersion`）。

本规范定义**包的格式与作者合同**。Adapter、取帧票据、构建账本等运行机制见[系统架构设计](../architecture/architecture-design.md) §8；视频中的其他数据见[视频格式规范](video-format-spec.md)；修改实例的命令见[命令与协议规范](command-protocol-spec.md)。用语见[文档约定](../README.md#文档约定)，术语见[术语表](../glossary.md)。

## 目录

- [1. 范围与约定](#1-范围与约定)
- [2. 清单](#2-清单)
- [3. 实例与三层编辑](#3-实例与三层编辑)
- [4. 作者合同](#4-作者合同)
- [5. 时间依赖](#5-时间依赖)
- [6. 验证与发布](#6-验证与发布)
- [7. Bake 与降级](#7-bake-与降级)
- [8. 开放范围](#8-开放范围)
- [9. 待评审事项](#9-待评审事项)

---

## 1. 范围与约定

### 1.1 两种合成

| 类型 | 引用什么 | BaoCut 理解到哪一层 |
| --- | --- | --- |
| 嵌套序列 | BaoCut 自己的结构化序列 | 全部：可以继续逐个元素编辑（尚未纳入视频的实例类型，视频格式规范 §3.4） |
| 代码合成 | 一个作者环境及其代码包 | 实例属性、公开参数、执行合同 |

本规范只涉及代码合成：来源是代码包的合成实例（`type: 'composition'`，`source.kind: 'bundle'`，视频格式规范 §3.7）。代码包本身是视频里的一个目录素材（`kind: 'bundle'`，视频格式规范 §4.3）：它的版本、存储位置与内容摘要都按素材的规则走，本规范只定义清单与执行合同。

### 1.2 不为每个库增加类型

视频的实例类型集合里，由代码画出来的画面只有 `composition` 一种。浏览器代码统一声明 `engine: 'browser'`，用 `contract` 区分不同的作者合同；`frameworkHints` 只用于开发提示。Remotion 使用独立的 `engine`。增加一个新的图形库不需要升级视频格式。

### 1.3 类型的地位

类型用 TypeScript 写法表达，是 DTO 概要。标注「本规范补全」的类型在原始设计中只有名称或用法，字段由本规范给出，列入 §9。基础类型 `Id`、`Revision`、`VersionRef`、`JsonValue`、`Rate`、`MediaTime` 见视频格式规范 §1.2 与 §2.3。

### 1.4 三条贯穿的原则

1. **代码包不可变。** 已发布的版本不在原地修改。改源码产生新版本，再显式替换引用。
2. **声明不等于能力。** 清单里写的随机访问、透明、音频与时间依赖，都要经过实测验证才开放（§6）。
3. **实例、参数、源码三层分开。** 在界面、命令与回执中始终是三种不同的修改（§3.4）。

---

## 2. 清单

### 2.1 CodeBundleManifest

```ts
interface CodeBundleManifest {
  format: 'baocut.code-bundle';
  schemaVersion: 1;
  bundleId: Id;
  revision: Revision;
  contentHash: string;
  runtime:
    | { engine: 'browser'; contract: string; entry: string; frameworkHints: string[] }
    | { engine: 'remotion'; entry: string; compositionId: string };
  source: { filesManifest: string; dependencyLock: string; buildRecipe: string };
  intrinsic: { width: number; height: number; fps: Rate; durationFrames: number };
  output: { alpha: boolean; colorSpace: string; audio: 'none' | 'stems' | 'mixed' };
  timing: { access: 'random' | 'sequential' | 'checkpointed'; fixedStep?: Rate };
  timeDependencies?: Array<
    | { kind: 'local-only' }
    | { kind: 'placement' }
    | { kind: 'cue-track'; ref: VersionRef }
    | { kind: 'sequence-clock' }
  >;                                   // 省略表示未知，不等于 local-only
  parametersSchemaRef?: string;
  exposedLayers?: Array<{ id: Id; isolation: 'independent' | 'requires-backdrop' }>;
  permissions: { network: 'deny'; assetIds: Id[] };
}
```

### 2.2 字段

| 字段 | 含义 | 规则 |
| --- | --- | --- |
| `bundleId` | 代码包的身份 | 跨版本稳定 |
| `revision` | 可读的版本号 | 用于关联；发布后不可在原地修改 |
| `contentHash` | 实际 bytes 的摘要 | 用于验证；与 `revision` 一起构成缓存与冻结的身份；算法见本节末 |
| `runtime.engine` | 执行引擎 | `browser` 或 `remotion` |
| `runtime.contract` | 浏览器作者合同的标识与版本 | 格式 `<合同名>/<主版本>`，不兼容的变化提升主版本；`adapterContractVersion` 取同一个值。首版提供 `baocut/1`（§4.1）与 `hyperframes/1`（§4.7） |
| `runtime.entry` | 入口文件 | 包内的相对路径 |
| `runtime.frameworkHints` | 使用的库 | 只是提示，不参与执行决定 |
| `source.filesManifest` | 源文件清单 | 列出每个文件的路径与摘要 |
| `source.dependencyLock` | 依赖锁 | 只固定版本，不提供离线 bytes（§2.4） |
| `source.buildRecipe` | 构建配方 | 工具链版本、命令与输入 |
| `intrinsic` | 作者设定的尺寸、帧率与时长 | `fps` 是包的局部帧率，不是序列或导出的帧率（§5.4） |
| `output.alpha` | 是否输出透明 | 必须由代码真正实现（§4.5） |
| `output.colorSpace` | 输出的颜色空间 | 首版只支持 SDR |
| `output.audio` | 是否带声音，以什么形式 | `stems` 交给主混音；`mixed` 是明确的混合音轨（§4.8） |
| `timing.access` | 取帧方式 | §5.3 |
| `timing.fixedStep` | 仿真步率 | `sequential` / `checkpointed` 时必填；不随输出帧率改变 |
| `timeDependencies` | 画面依赖哪些外部时间 | §5 |
| `parametersSchemaRef` | 公开参数的 Schema | §3.2 |
| `exposedLayers` | 可以独立输出的层 | `requires-backdrop` 的层不能脱离背景单独缓存 |
| `permissions.network` | 网络权限 | 首版恒为 `deny` |
| `permissions.assetIds` | 可以读取的素材 | 只有列出的素材可以被解析 |

**`contentHash` 的算法**（本规范补全）。`contentHash = 'sha256-' + sha256(JSON.stringify(entries))`。`entries` 是包内文件按 `path` 排序的数组，每项为 `{ path, size, sha256 }`：键按这个顺序，紧凑 JSON；`path` 是 `/` 分隔的相对路径，`size` 是字节数，`sha256` 是小写十六进制。`bundle.manifest.json`、`files.manifest.json` 与 `verification.json` 不计入：清单含有摘要本身，文件清单列出的就是这组条目（计入就要列出自己的摘要），报告在摘要之后才写出，三者计入都成了循环。`files.manifest.json`（`source.filesManifest`）的内容就是 `entries`。这个值是清单的字段，与目录素材版本的树摘要（视频格式规范 §4.3）算法不同，不是同一个值（§9）。

### 2.3 身份与不可变

- 发布之后的版本不可在原地修改。任何改动产生新的 `revision` 与新的 `contentHash`。
- 旧版本留给历史、撤销和冻结中的任务使用，在没有任何引用之后才可以回收。
- 缓存键、冻结快照与导出记录使用 `bundleId + revision + contentHash`，不使用文件修改时间。
- 导入与验证时按 §2.2 重新计算 `contentHash`，与清单不一致时拒绝（`BUNDLE_HASH_MISMATCH`，§6.3）。

### 2.4 源码与离线

- 源码、构建输入、依赖锁、字体与静态素材必须可以定位。**只有一个 MP4，不能称为可编辑的代码包。**
- 依赖锁只固定版本，不自动提供离线 bytes。离线的包还必须包含可以合法分发的构建产物或 vendor 依赖，或者引用一个已验证存在的运行时依赖仓库。
- 缺少离线 bytes 时阻断离线重建。不得临时联网补齐，却仍然声称是断网渲染。
- 远程字体、脚本与素材在发布时固定为 bytes，登记进清单；渲染时不再访问网络。

### 2.5 包的布局

```text
<bundle>/<revision>/
  bundle.manifest.json      # 本章的清单
  src/                      # 作者源码
  dist/                     # 构建产物（入口在这里或由清单指明）
  vendor/                   # 离线依赖的 bytes
  assets/                   # 包内的静态素材与字体
  parameters.schema.json    # 公开参数的 Schema（如果有）
  files.manifest.json       # 每个文件的路径与摘要
  dependency.lock           # 依赖锁
  build.recipe.json         # 构建配方
  verification.json         # §6 的验证报告
```

`bundle.manifest.json`、`files.manifest.json` 与 `verification.json` 三个文件名在首版固定，放在包的根目录。其余目录名与文件名是建议的默认值，由清单中的路径字段最终决定。本节为本规范补全。

### 2.6 权限

- 代码包在隔离的执行环境里运行，默认没有网络、没有视频目录之外的文件访问、没有主机能力（架构设计 §12）。
- 包只能通过受控的解析器读取 `permissions.assetIds` 中列出的素材，拿到的是只读的 bytes 或受控句柄，不是机器路径。
- 清单不能给自己提升权限。超出清单声明的访问被拒绝，并记录为验证失败。

---

## 3. 实例与三层编辑

### 3.1 合成实例

实例的定义在视频格式规范 §3.7，这里只列出与代码包有关的字段：

```ts
interface CompositionItem extends VisualItemBase {
  type: 'composition';
  source: { kind: 'bundle'; assetRef: VersionRef };   // 指向一个确定的代码包版本
  parameterValues: JsonValue;          // 实例的参数值
  timeMap: TimeMap;                    // 实例时间 → 合成的局部时间
  prerender?: VersionRef;              // 预渲染替身：渲染好的视频素材
  audio?: EmbeddedAudio;               // 合成自己发出的声音的路由
}
```

`span`、`transform`、`opacity` 等来自 `VisualItemBase`；`TimeMap`、`Transform` 见视频格式规范 §2.5 与 §3.5。

预渲染替身与 Bake（§7）的关系：替身是「这段合成已经有一份渲染好的视频」这个事实，运行环境不可用时预览与导出用它代替；Bake 是产生这样一份视频的受控流程，带着输入指纹与验证记录。`audioRoute` 的声部模式、`qualityPolicy` 与 `BakeRecord` 尚未进入实例的字段（§9）；首版的 `BakeRecord` 记在烘焙素材的来源里（§7）。

### 3.2 参数

- 参数是**实例的值**。同一个包的两个实例可以使用不同的标题与颜色。
- 修改参数不产生新的源码版本，但会改变渲染缓存键。
- 参数由 `parametersSchemaRef` 指向的 JSON Schema 描述。界面只显示 Schema 允许的控件；没有公开的内部对象不能假装可以拖拽编辑。
- 参数值必须通过 Schema 校验才能提交。校验失败的参数不写入视频。

Schema 中建议为每个参数提供：类型、默认值、取值范围或枚举、显示名称、分组，以及是否影响时长或布局。影响时长的参数改动必须触发时长的重新检查（§3.3）。

### 3.3 替换版本

- 替换代码包时必须做**参数 Schema 的兼容检查**。参数被重命名时，不得悄悄回到默认值；要么提供映射，要么列出丢失的参数并等待确认。
- 同一个包有多处引用时，默认只替换用户选中的实例。「更新全部实例」是显式的批量操作。
- 新版本的时长变短、旧实例超出了可用时段时，必须明确处理，不得静默拉长最后一帧：方案有裁短实例、保持最后一帧，或重新编排；首期的 `replaceCodeBundle` 默认裁短并在回执里写明（见下），其余方案待 `fit` 选项。
- 更换场景默认保留 `itemId`、lineage、外部字幕锚和用户的 pin。
- 源码发布、视频应用和缓存失效是三个分开的事件（架构设计 §8.2）。

首期的替换是编辑操作 `replaceCodeBundle`（[命令与协议规范 §12.6](command-protocol-spec.md#126-原地替换代码画面)），一次替换一个实例；智能体经 `compositions_import` 的 `replace` 调用它（重新打包、验证、烘焙之后，第二笔修改不新放实例而是替换）：

- **只换源**：写入新的 `source.assetRef` 与 `prerender`（`null` 或省略是不要替身），可选整个替换 `parameterValues`。实例 ID、轨道、起点、几何与不透明度、效果、遮罩、名字、开关与锁、跟随策略、关键帧、声音路由与 lineage 都不变。`timeMap` 回到从 0 开始、速率 1 的线性映射：新版本从头播放。
- **长度跟新版本走**：有替身时取替身的长度（向下取整到实例所在序列的帧），没有替身时取清单的 `intrinsic.durationFrames` 按 `intrinsic.fps` 换算到实例所在序列的帧率。两者都拿不到时拒绝。`compositions_import` 替换时也按这个序列的帧率烘焙替身。
- **变短就裁短实例**：这是上面三种方案中默认采用的一种，不保持最后一帧、不重新编排；裁短不静默，回执 `impact.codeEdits` 给出前后的帧数。关键帧跟着窗口变短，与裁切同一条规则。
- **变长不推开别人**：变长后与同一轨道上的实例重叠时以 `TIMELINE_OVERLAP` 拒绝，`recovery` 提示先用 `moveItem` 挪开或 `deleteItems` 删掉后面的实例再替换。
- **参数闸门**：实例的 `parameterValues` 不为空，而新版本的清单没有 `parametersSchemaRef` 或与旧版本的不同，又没有同时给出新的 `parameterValues` 时，以 `INVALID_OPERATION` 拒绝（`details.rule` 为 `parameters-incompatible`），不把旧值套到新 Schema 上。Schema 引用相同时保留旧值；按 Schema 内容校验参数仍未实现（§3.2）。
- 实例不是合成、素材不是代码包、替身不是视频、实例或轨道被锁定时拒绝，错误与 `setCodeParameters`、`insertItems` 的相同。
- **回执标明层**：`impact.codeEdits` 每项写 `layer: 'source'`（§3.4 的源码编辑），以及替换前后的代码包版本、替身与帧数。
- **旧版本留在视频里**：替换不删素材。回执的 `previousBundleRef` 与撤销还要用到旧版本，引擎导入时按内容去重，留着不会重复占用。不再被引用的旧代码包与替身用通用的清理删掉：编辑操作 `removeAssets` 只删没有引用的素材，代码包与它烘焙出的替身成对删除；智能体用 `assets_prune` 先列出、确认后再删（[命令与协议规范 §4.2](command-protocol-spec.md#42-编辑操作)、[§12.7](command-protocol-spec.md#127-清理换下来的旧版本)）。

未定：是否提供 `fit` 选项（新版本更长或更短时保持实例长度、保持最后一帧或按比例变速），以及「更新全部实例」的批量替换。

### 3.4 三层编辑

| 层 | 例子 | 写到哪里 |
| --- | --- | --- |
| **实例编辑** | 晚两秒出现、缩小、加透明度、拆分 | `CodeCompositionItem` |
| **参数编辑** | 地球的转速、标题、主题色、粒子数量 | `item.parameterValues` |
| **源码编辑** | 增加一颗卫星、改变运动算法、重构镜头 | 新的代码包版本，再显式替换引用 |

三层在界面、命令与回执中始终分开。回执必须说明这次修改属于哪一层。

对于参数做不到的复杂修改，界面提供「交给智能体修改这个合成」。交给智能体的上下文包含：代码包版本、选中的实例、时间范围、当前参数和截图。

### 3.5 拆分与变速

- 拆分一个代码合成实例得到两个实例，它们引用同一个代码包版本，各自的 `timeMap` 指向原来的局部时间区间。拆分不复制源码。
- 变速与裁切只改 `timeMap`。`sequential` 的包在变速之后仍然按 `fixedStep` 仿真，输出取样只决定读取哪些时刻（§5.3）。
- 画幅版本（视频格式规范 §7.7）通过参数覆盖适配响应式的包。包没有声明响应式能力时，明确使用 contain 或 cover，或者提出重构；改变纵横比不等于相机会自动重新构图。

---

## 4. 作者合同

### 4.1 浏览器合同

BaoCut Web 合同的作者接口：

```ts
interface AuthoredComposition {
  initialize(ctx: CompositionContext): Promise<void>;
  renderAt(time: MediaTime, params: JsonValue): Promise<void>;
  dispose(): void;
}

// 本规范补全
interface CompositionContext {
  target: HTMLCanvasElement | HTMLElement;     // 可捕获的绘制目标
  width: number;
  height: number;
  pixelRatio: number;
  intrinsicFps: Rate;
  durationFrames: number;
  seed: string;                                // 确定性的随机种子
  assets: { resolve(assetId: Id): Promise<{ url: string; mime: string }> };   // 只读、已冻结的 bytes
  fonts: { ready(): Promise<void> };
  placement?: { sequenceStart: MediaTime; sequenceFps: Rate };                // 只有声明了 placement 依赖才提供
  cueTracks?: Record<Id, JsonValue>;                                          // 只有声明了 cue-track 依赖才提供
}
```

**`initialize`** 必须等到字体、图片、模型、纹理和必要的异步初始化全部完成后才 resolve。

**`renderAt`** 的 resolve 表示**这个时刻的画面已经提交到可捕获的目标上**，不能只代表修改了变量或发出了 seek。宿主需要处理视频的解码与呈现同步，不能把 `seeked` 事件一概当作已经显示了新的一帧。

**`dispose`** 释放全部资源。会话被取消或替换时，宿主调用它并等待资源真正释放（架构设计 §7.7）。

**发现**。这个合同的标识是 `baocut/1`。入口页面在 `window.__baocutCompositions[<compositionId>]` 上暴露 `AuthoredComposition`。根元素带 `data-composition-id`，以及 `data-width`、`data-height`、`data-fps` 与 `data-duration`（秒），与 `hyperframes/1`（§4.7）相同，两种合同用同一条规则找根元素。找不到根元素报告 `COMPOSITION_ROOT_MISSING`；根元素的尺寸、帧率或时长与清单的 `intrinsic` 不一致时报告 `COMPOSITION_INTRINSIC_MISMATCH`（§6.3）。

`renderAt(time, params)` 的 `time` 是局部时间（`MediaTime`），`params` 是参数值（§3.2，首版为空对象）；只在这一帧提交之后 resolve。

### 4.2 确定性

同一个代码包版本、同样的参数、同样的局部时间、同样的输出配置，必须得到相同的画面。

- 画面只能由 `renderAt` 收到的 `time` 和 `params`，以及已经声明的时间依赖（§5）决定。
- 不得读取墙上时钟（`Date.now()`、`performance.now()`）或真实的运行时长来决定画面。
- 随机数必须来自 `ctx.seed` 派生的确定性随机源。应用还必须固定自己的噪声源与调用顺序；只给 `Math.random` 设种子，不能声称全部确定。
- 不得依赖网络、用户输入或宿主的窗口尺寸。
- 没有声明的时间依赖不会被提供；代码不得从其他途径取得自己在主时间线上的位置。

### 4.3 p5.js

- 新的作者模板使用 `noLoop()`，由 Adapter 调用受控的绘制，使用明确的局部时间，而不是真实的运行时长。
- 使用 `randomSeed` / `noiseSeed`，并固定自己的随机源与调用顺序。
- 已有的、带状态的草图可以声明 `sequential`：从初始状态按固定步长重放到目标帧（§5.3）。

### 4.4 Three.js

- 用局部时间直接求出对象的状态，再渲染场景。
- 动画片段可以通过 `AnimationMixer.setTime` 驱动。但这不等于所有的物理、粒子和异步资源都天然可以随机访问；带状态的部分要么改写成时间的纯函数，要么声明 `sequential`。

### 4.5 Canvas 与透明

- Canvas 内部的像素不是 DOM 对象。一个 canvas 里的标题与图表，不能只凭 CSS 选择器拆成两个可编辑的元素。可编辑的内容要么暴露为参数，要么主动实现独立的层输出（`exposedLayers`），要么保留为整体。
- 透明输出必须由代码真正把背景清成透明，并使用支持 alpha 的目标。配置 `alpha: true` 不能自动移除已经画上去的背景。
- 声明 `output.alpha: true` 的包在验证时检查 alpha 是否真实（§6.2）。

### 4.6 Remotion

- **只认不产**。BaoCut 自带的模板与创作指导不使用 Remotion；`engine: 'remotion'` 的代码包来自用户的要求或外部导入，必须能被识别、预览与渲染。
- BaoCut 不分发 Remotion。Adapter 使用代码包自己依赖里的 Remotion（Player 与 renderer），版本以包的锁文件为准；包里没有可用的 Remotion 时合成报告为不可用并说明，有预渲染替身的用替身（§3.1）。Remotion 的许可由代码包的作者负责，界面在导入时提示一次。
- 预览可以使用 Remotion Player；参数映射为 `inputProps`；导出使用它的 renderer 的批量或区间接口，不为每一帧重复启动一次渲染进程与浏览器。
- Player 与 renderer 是两个分别存在的集成表面。Adapter 必须显式冻结相同的 props 与构建输入。
- 单独适配 Remotion 是为了保留它的 frame / React / audio 语义，不是承诺导出更快。它内部的视频与音频处理需要在 Adapter 的能力测试中验证。
- BaoCut 的区间统一右开。调用第三方 renderer 时，在边界上转换它的 `frameRange` 端点规则；禁止漏掉最后一帧或多输出一帧。
- 父序列与 Remotion 的帧率不同时，按源时间映射采样，并声明 hold 或 nearest 等策略。不能在每次界面 seek 时随意取整。
- 不能把视频帧或输出帧直接当作 Remotion 的 composition frame，也不能通过改写已发布代码包的 `fps` 来支持新的导出帧率。
- 透明视频与音频导出的具体容器和路径，按实际可用的版本与许可验证；不承诺所有模式默认可用。

### 4.7 HyperFrames

合同标识 `hyperframes/1`，对应 HyperFrames（Apache-2.0，https://github.com/hyperframes/hyperframes）的公开合同。本节只写 Adapter 依赖的部分，合同本身以上游为准。

- **发现**。根元素与 §4.1 相同：`[data-composition-id]`，带 `data-width`、`data-height`、`data-fps`、`data-duration`。Adapter 等待 `window.__timelines[<compositionId>]` 出现：一条暂停的、可以 seek 的时间线，提供 `seek(秒)`，以及 `time()`，或者 `progress()` 与 `duration`。等不到时报告 `COMPOSITION_TIMELINE_MISSING`。
- **取帧**。Adapter 先调用 `pause()`，之后每一帧调用 `seek(t)` 并回读时间线的实际时间。回读与 `t` 相差超过采样帧率下的半帧，即 1 / (2 × fps) 时，报告 `COMPOSITION_SEEK_MISMATCH`。fps 取取帧票据的 `fps`：烘焙按序列或导出的帧率（§7），验证与预览按秒取帧时票据带包的 `intrinsic.fps`；没有票据时取包的 `intrinsic.fps`。30 fps 时容差为 1/60 s。误差不到半帧时，回读的时间与 `t` 仍落在同一帧上；容差随帧率收紧，不用固定常数（架构设计 §8.4）。seek 之后等两个动画帧再捕获；这个等待策略的地位见架构设计 §8.4。
- **末尾**。请求的时刻达到或超过时长时，夹到时长上取帧，并在回执里标明已夹取。这是这个合同对架构设计 §8.4 末尾行为的显式选择：取可用帧并报告，不当作成功的 hold。
- **音频**。首版不从这个合同取声音，`output.audio` 必须为 `none`。

这个合同有自己的 composition 与 seek 合同，不同时再用 BaoCut 的第二个时钟去驱动其中的媒体。它区分 HTML 时序与可 seek 的动画，适配时保留这个分工。

### 4.8 音频

合成内部含有音频时，必须在两种方式里选择一种：

- **`stems`**：由 Adapter 输出独立的分轨，交给主混音。
- **`mixed`**：作为一条明确的混合音轨。

不得同时播放合成内部的音频与同一份外部旁白。Adapter 内部的音频不得同时再进入外部混音。

不在 `renderAt` 里随机播放音效。旁白、配乐与音效由 SoundCueSheet 组织，编译成普通的音频实例（视频格式规范 §7.9）。

---

## 5. 时间依赖

### 5.1 为什么要声明

把一段动画分成多个独立的包，并不证明移动实例之后可以复用全部缓存。场景代码可能读取自己在主时间线上的起点（例如用 `start + t` 驱动背景），也可能读取全局时钟或外部的声音事件。只有知道画面依赖哪些时间，才能判断一次修改之后哪些帧仍然有效。

### 5.2 四种依赖

| `kind` | 画面依赖什么 | 移动实例之后 | 改 cue 或文稿之后 |
| --- | --- | --- | --- |
| `local-only` | 只依赖局部时间与参数 | 复用内部的求帧结果 | 不受影响 |
| `placement` | 依赖实例在序列中的位置 | 重新求值 | 不受影响 |
| `cue-track` | 依赖某个外部的 cue 轨（带版本引用） | 取决于 cue 是否随之变化 | 被引用的版本改变时重新求值 |
| `sequence-clock` | 依赖序列的全局时钟 | 重新求值 | 序列时序变化时重新求值 |

规则：

- **省略 `timeDependencies` 表示未知，不等于 `local-only`。** 未声明或未验证时保守失效。
- `local-only` 必须与其他依赖互斥。
- 冻结的合成输入必须包含这些依赖的值与版本（架构设计 §8.6）。
- 不从代码文件的 hash 推断局部影响。
- 声明要经过验证（§6.2）：声明为 `local-only` 的包，在不同的放置位置上求同一个局部时间，必须得到相同的画面。

### 5.3 取帧方式

| `timing.access` | 含义 | 局部重渲染 |
| --- | --- | --- |
| `random` | 任意局部时间都可以直接求值 | 可以只重渲染受影响的区间 |
| `sequential` | 必须从初始状态按 `fixedStep` 重放到目标帧 | 修改某个时刻的状态可能影响其后的所有帧，不得只重渲染局部 |
| `checkpointed` | 可以从保存的检查点继续重放 | 从受影响时刻之前最近的检查点开始 |

- `fixedStep` 是仿真的步率，不随输出帧率改变。输出取样只决定读取哪些时刻。
- 检查点只在代码能够完整保存仿真状态、随机状态和必要的资源恢复信息时启用。任意的 JS 堆或 WebGL 状态不能自动被当作可保存的检查点。
- 对 `sequential` 的包做远处的随机 seek 时，可以先展示缓存的预览，再计算正确的帧；不能把旧帧标记为已经精确求值。

### 5.4 局部帧率

- `intrinsic.fps` 是代码包自己的帧率。它与 `Sequence.fps`、`ExportSettings.fps` 相互独立（视频格式规范 §2.11）。
- 连续的动画在精确的局部时间上求值，不先取整到某个帧网格。
- 帧驱动的代码用 `intrinsic.fps` 选择局部帧；Adapter 返回实际的局部时间、实际的源帧或 PTS，以及使用的采样策略。
- 是否支持插值、hold 或 nearest 必须经过能力验证。不支持时拒绝或明确降级。
- 请求超出包的时长时，必须显式选择：取可用帧、hold，或报告越界。默认不把越界的请求当作成功的 hold。

---

## 6. 验证与发布

### 6.1 发布流程

```text
创作工作区里的草稿
  → 构建（隔离环境，固定工具链）
  → 静态检查（清单、Schema、权限、依赖是否齐全）
  → 采样验证（§6.2）
  → 计算摘要，登记为不可变的版本
  → 通过事务把选定的实例从旧版本切到新版本
```

- 草稿放在独立的创作工作区。保存草稿文件不会改变已发布的代码包，也不会改变正在导出的内容。
- 构建草稿不是视频。不通过文件监听自动覆盖已发布的版本。
- 每次构建的输入 hash、工具链、输出的代码包、验证报告和应用回执记录在构建账本里（架构设计 §8.6）。

**导入**。从一个目录导入代码包，同样经过静态检查与采样验证（§6.2）：

- 用 `lstat` 列出文件，拒绝符号链接。
- 只收白名单内的扩展名：`html` `htm` `js` `mjs` `cjs` `css` `json` `map` `txt` `md` `svg` `png` `jpg` `jpeg` `webp` `gif` `avif` `woff` `woff2` `ttf` `otf` `mp3` `wav` `ogg` `m4a` `mp4` `webm` `mov` `wasm` `lock`，以及有固定名字的清单文件（§2.5）。
- 上限：4096 个文件，单个文件 64 MiB，合计 256 MiB，相对路径不超过 512 个字符。
- 静态扫描网络引用：`src`、`href`、`url()`、`@import`、`fetch`、`new URL` 中的 `http(s)://`、`ws(s)://` 与协议相对 URL（`//` 开头）；XML 命名空间 URI 不算。发现即拒绝。
- 没有 `bundle.manifest.json` 的包，导入方可以按入口页面根元素的 `data-*` 属性（§4.1）或调用方给出的覆盖值合成一份清单。合成的清单写进暂存副本，不写回源目录；`revision` 默认为 `1`（`Revision` 是非负十进制整数字符串，视频格式规范 §1.2）。
- 通过的包按 `bundleId/revision` 不可变地存成托管的目录素材（视频格式规范 §4.3），清单放在素材版本的 `bundle` 字段里。

### 6.2 验证项

清单的声明经过实测才生效。验证结果是 `VerifiedCapabilities`（架构设计 §8.3），与清单不一致时拒绝，或把能力降级。

| 验证项 | 检查什么 |
| --- | --- |
| 就绪 | `initialize` 完成后字体、纹理、媒体确实可用；首帧不是空白或占位 |
| 确定性 | 同一个局部时间重复求值，画面一致 |
| 随机访问 | 声明 `random` 的包：乱序求值与顺序求值的结果一致 |
| 顺序重放 | 声明 `sequential` / `checkpointed` 的包：从头重放与从检查点重放的结果一致 |
| 时间依赖 | 声明 `local-only` 的包：改变放置位置，同一个局部时间的画面一致 |
| 末帧 | 第一帧、最后一帧和相邻帧可以区分；越界行为与声明一致 |
| 透明 | 声明 `alpha` 的包：背景确实透明，边缘没有预乘错误 |
| 音频 | 声明带音频的包：长度、采样率与声道符合声明；没有与外部混音重复 |
| 权限 | 运行期间没有访问网络或未声明的素材 |
| 参数 | 默认参数通过 Schema；边界值不崩溃 |

验证没有通过的能力不开放。没有通过就绪与确定性验证的包不能用于 Export-Exact。

**验证报告**是包根目录的 `verification.json`（本规范补全）：

```ts
interface CodeBundleVerificationReport {
  format: 'baocut.code-bundle-verification';
  schemaVersion: 1;
  bundleId: Id;
  revision: Revision;
  contentHash: string;
  verifiedAt: string;
  status: 'passed' | 'failed';
  capabilities: VerifiedCapabilities | null;   // 架构设计 §8.3
  checks: Array<{ id: CodeBundleCheckId; status: 'passed' | 'failed' | 'skipped'; code?: CodeBundleErrorCode; detail?: string }>;
  sampledFrames: Array<{ seconds: number; sha256: string }>;   // 验证时取过的帧，供复核
}
```

首版的检查项（`CodeBundleCheckId`）：

| `id` | 检查什么 |
| --- | --- |
| `manifest` | 清单符合 §2.1，或已由导入方合成（§6.1） |
| `files` | 扩展名白名单、符号链接与大小上限（§6.1） |
| `content-hash` | 重新计算的 `contentHash` 与清单一致（§2.2） |
| `network-static` | 静态扫描没有网络引用（§6.1） |
| `network-runtime` | 运行期间，不是包目录下的 `file:`、也不是 `data:`、`blob:`、`about:` 的请求一律取消并计数；计数不为零即失败 |
| `root` | 找到根元素，`data-*` 与清单的 `intrinsic` 一致（§4.1） |
| `timeline` | 合同的取帧入口出现（§4.1、§4.7） |
| `seek` | seek 之后回读的时间与请求一致（§4.7） |
| `determinism` | 同一个局部时间渲染两次，两帧的 sha256 相同 |
| `alpha` | 声明 `output.alpha` 的包：测量透明像素；采样帧全部不透明即失败 |
| `duration` | 末帧与越界行为符合声明（§5.4） |

首版报告没有覆盖上表中的就绪、随机访问（乱序与顺序一致）、顺序重放、时间依赖、音频与参数；权限只检查网络，不检查未声明的素材；透明也不检查预乘边缘。这些能力按本节的规则不开放，没有就绪验证的包也不能用于 Export-Exact。

### 6.3 失败时

- 构建或验证失败时不产生新版本，已发布的版本与引用它的实例保持不变。
- 失败报告指出具体的验证项、采样时刻和证据，交还给作者或智能体修正。
- 沙箱不可用时，代码合成的预览与渲染关闭，并说明原因；不以降低隔离为代价继续执行。

错误码：

| 错误码 | 含义 |
| --- | --- |
| `BUNDLE_MANIFEST_INVALID` | 清单无法解析或不符合 §2.1，且没有合成 |
| `BUNDLE_FILE_NOT_ALLOWED` | 包里有白名单之外的文件 |
| `BUNDLE_SYMLINK` | 包里有符号链接 |
| `BUNDLE_TOO_LARGE` | 超出文件数、单个文件、合计大小或路径长度的上限 |
| `BUNDLE_NETWORK_REFERENCE` | 静态扫描发现网络引用 |
| `BUNDLE_HASH_MISMATCH` | 重新计算的 `contentHash` 与清单不一致 |
| `BUNDLE_ENTRY_MISSING` | `runtime.entry` 指向的文件不存在 |
| `BUNDLE_CONTRACT_UNSUPPORTED` | `runtime.contract` 不是已开放的合同 |
| `COMPOSITION_ROOT_MISSING` | 入口页面没有 `[data-composition-id]` 根元素 |
| `COMPOSITION_TIMELINE_MISSING` | 等不到合同的取帧入口 |
| `COMPOSITION_SEEK_MISMATCH` | seek 之后回读的时间超出容差 |
| `COMPOSITION_INTRINSIC_MISMATCH` | 根元素的尺寸、帧率或时长与清单不一致 |
| `COMPOSITION_NONDETERMINISTIC` | 同一个局部时间两次渲染的画面不同 |
| `COMPOSITION_NETWORK_BLOCKED` | 运行期间有请求被拦截 |
| `COMPOSITION_SCRIPT_ERROR` | 页面脚本抛出未处理的错误 |
| `COMPOSITION_RENDER_TIMEOUT` | 初始化或取帧超时 |
| `COMPOSITION_HOST_UNAVAILABLE` | 执行环境无法启动或已退出 |

---

## 7. Bake 与降级

`bakeCodeItem` 把一个代码合成实例渲染成普通媒体。

```ts
// 本规范补全
interface BakeRecord {
  bakedAssetRef: VersionRef;           // 渲染得到的普通媒体
  sourceBundleRef: VersionRef;         // 原代码包版本
  parameterValuesHash: string;
  timeMapHash: string;
  outputProfileHash: string;
  bakedAt: string;
  status: 'current' | 'stale';         // 源码包、参数或 timeMap 改变后为 stale
  encoding: { container: 'mov'; codec: string; pixelFormat: string; alpha: boolean; fps: Rate; frames: number };
}
```

- 烘焙按实例所在序列或导出的帧率取帧：第 k 帧的局部时间是 `t = k / fps`，不按包的 `intrinsic.fps`（§5.4）。`compositions_import` 新放置的实例在根序列上，用根序列的帧率；`replace` 用被替换实例所在序列的帧率。
- **编码**。首版输出 QuickTime `.mov`：`output.alpha` 为 true 时用 ProRes 4444（`yuva444p10le`），否则用 ProRes 422 HQ。烘焙结果作为普通的视频素材导入，`hasAlpha` 如实记录。
- **记录位置**。`BakeRecord` 记在烘焙素材的来源里：`provenance` 为 `{ origin: 'composition-bake', source: BakeRecord }`（视频格式规范 §4.5）。合成实例上还没有对应的字段（§3.1、§9）。首版的 `bakedAssetRef` 与 `sourceBundleRef` 先写代码包清单的 `bundleId/revision`：素材 ID 要等导入事务的回执才知道（§9）。
- 新建的合成实例用 `prerender` 指向烘焙素材，导出走已有的预渲染替身路径（视频格式规范 §3.7）。
- 首版分两次事务：先导入代码包与烘焙素材，再用 `insertItems` 放置合成实例。两步合起来不是原子的：第二步失败时，已导入的两个素材留在视频里，没有实例引用它们。并成一笔的做法见 §9。

- Bake **保留**源代码包、参数、映射和来源，并提供「回到可编辑的源码」。Bake 不是删除源文件。
- Bake 之后修改参数或替换版本，烘焙结果标记为 `stale`；界面提示重新烘焙，或继续使用实时求值。
- 只有源成片、没有作者代码时，不得把一个普通 MP4 包装成「可编辑的 Remotion 合成」。
- Bake 与「只有成片的输入」是两回事：前者保留回到源码的引用，后者不能伪装成源视频。

**降级**。运行环境不满足包的要求时（例如缺少 GPU 能力、Adapter 版本不兼容、沙箱不可用）：

| 情况 | 行为 |
| --- | --- |
| 有当前的烘焙结果 | 使用烘焙结果播放与导出，并标注来源 |
| 只有过期的烘焙结果或预览缓存 | 可以用来浏览，标注为过期；不能用于 Export-Exact |
| 都没有 | 显示占位与原因；阻断依赖这个实例的严格导出 |

降级必须是可见的。不得用一张静态图或空白画面静默替代。

---

## 8. 开放范围

文中的第三方接口名称是集成参考，不是当前可用性的保证。实现必须锁定框架、浏览器与 renderer 的版本，取得验证过的能力之后才开放功能。

| 阶段 | 范围 |
| --- | --- |
| **P0** | 受控 Web 合同（`baocut/1`）与 HyperFrames 合同（`hyperframes/1`）的导入、验证、取帧与烘焙；执行环境是 Electron 离屏窗口。p5.js、Three.js、Canvas 按各自被支持的子集接入 |
| **P1** | 导入外部的 Remotion 代码；更丰富的独立层输出；检查点；Playwright 或无头 Chromium 的执行环境 |
| **G** | 三层编辑的区分、不可变版本、时间依赖的保守失效、Bake 保留源码引用，对任何已开放的合同都生效 |

HyperFrames 合同进入第一期，是 2026-10-07 用户开始实现任务时采纳的计划建议，不是更早的裁决。

模板渲染成功不能被夸大为支持所有既有视频。

---

## 9. 待评审事项

| 事项 | 状态 | 需要决定什么 |
| --- | --- | --- |
| `CompositionContext`（§4.1） | 本规范补全 | 绘制目标的形式；素材解析的接口；是否提供音频上下文 |
| 合成实例的字段（§3.1） | `audioRoute`、`qualityPolicy`、`bake` 未纳入 | 声部模式与质量政策的取值；Bake 记录是否从烘焙素材的来源（§7）移到实例上，与预渲染替身如何衔接、替身何时过期 |
| 包的目录布局（§2.5） | 部分已定 | 已定：首版固定 `bundle.manifest.json`、`files.manifest.json`、`verification.json` 三个文件名。待定：其余文件名是否强制；文件名固定之后 `source.filesManifest` 是否还需要 |
| `BakeRecord`（§7） | 已定 | 首版编码为 QuickTime `.mov`，带 alpha 用 ProRes 4444，否则 ProRes 422 HQ；记录放在烘焙素材的 `provenance` 里（§7）。是否进入实例字段见上面「合成实例的字段」 |
| 参数 Schema 的约定（§3.2） | 只有原则 | 支持的 JSON Schema 子集；界面控件的映射；影响时长的标记方式 |
| `runtime.contract` 的命名与版本 | 已定 | 格式 `<合同名>/<主版本>`，不兼容的变化提升主版本，`adapterContractVersion` 取同一个值（§2.2）；第一期同时提供 `baocut/1` 与 `hyperframes/1` |
| `contentHash` 的覆盖范围（§2.2） | 部分已定 | 已定：`files.manifest.json` 不计入 `entries`（计入则不能列出自己的摘要）。待定：清单的 `contentHash` 与目录素材的树摘要（视频格式规范 §4.3）算法不同，是否统一或写明两者的关系 |
| 导入的原子性（§7） | 首版两笔事务 | 原子导入的路径：让合成实例的 `ItemInput` 接受 `assetImportRef`（命令与协议规范 §4.2 已允许视频、图片、白板与音频实例这样引用同一事务里 `importAsset` 的 `ref`），届时导入与放置并成一笔事务。在此之前 `BakeRecord` 的 `bakedAssetRef` 与 `sourceBundleRef` 用代码包清单的 `bundleId/revision` 占位，不是素材引用 |
| `cue-track` 的数据形式 | 未定 | 传给代码的 cue 数据的结构 |
| 检查点的格式 | 未定 | 作者如何声明与实现可保存的状态 |
| Remotion 的许可与透明导出 | 待验证 | 已定：不随应用分发，用代码包自己的依赖（§4.6）。透明导出按实际版本确认可用的模式 |
| 首批 P0 模板 | 未定 | 数量、类型与许可 |
