# BaoCut 文档

BaoCut 是一个源码可用（source-available）的 AI 视频智能体：用户用自然语言委托任务，智能体创作、剪辑并持续修改视频；所有结果落在可编辑的视频里，用户随时可以在独立界面中接管、精修和导出。许可摘要见[根 README](../README.md#许可)，正式条款见 [LICENSE](../LICENSE)。

本目录是 BaoCut 的产品、架构与格式规范的唯一来源。每个主题一篇完整文档，文首有目录，按任务跳到相关章节读。

## 目录

| 文档 | 内容 |
| --- | --- |
| [`product/product-design.md`](product/product-design.md) | **产品设计**：定位与范围、界面（Home / Space / 编辑器）、任务与对话、自主执行与权限、质量与交付、十二个端到端工作流、需求清单、发布路线与指标 |
| [`architecture/architecture-design.md`](architecture/architecture-design.md) | **系统架构设计**：模块与状态所有权、进程与生命周期、Agent Harness、业务协议、存储、模型、任务调度、代码运行时、渲染与导出、依赖失效、客户端、安全、代码组织 |
| [`spec/video-format-spec.md`](spec/video-format-spec.md) | **视频格式规范**：时间模型、视频与序列、素材与文档、语音与字幕、口播剪辑、配音与语言版本、便携包 |
| [`spec/code-bundle-spec.md`](spec/code-bundle-spec.md) | **代码包规范**：代码合成包的清单、实例、作者合同、时间依赖与 Bake |
| [`spec/command-protocol-spec.md`](spec/command-protocol-spec.md) | **命令与协议规范**：命令信封、编辑事务、回执、时间输入、批量预检、撤销、事件与错误合同 |
| [`spec/model-worker-protocol-spec.md`](spec/model-worker-protocol-spec.md) | **Model Worker 协议规范**：Runtime 与本地推理进程的 stdio 消息、模型包描述、staging 目录与 `baocut.asr-result/v1` 输出合同 |
| [`spec/node-protocol-spec.md`](spec/node-protocol-spec.md) | **节点协议规范**：局域网能力共享的 HTTP 端点、配对与令牌、任务与事件流、清理规则，以及本机网关的 `nodes` 方法 |
| [`spec/template-spec.md`](spec/template-spec.md) | **模板包规范**：Home 创作模板的目录布局、清单字段与分类、封面与预览、素材、路径与语言约束、场景模板的简报引导 |
| [`acceptance/acceptance-spec.md`](acceptance/acceptance-spec.md) | **验收与测试**：测试策略、发布门槛、性能目标、验收矩阵 |
| [`acceptance/agent-surface-e2e.md`](acceptance/agent-surface-e2e.md) | **Agent 面端到端验收记录**：2026-10-06 用 Claude Code 经 skill 与 MCP 走「链接 → 转录 → 自译 → 双语字幕 → 导出」的结论、证据位置、修复与发现 |
| [`design/subtitle/`](design/subtitle/README.md) | **字幕与翻译设计（移植自 v2）**：转录后处理、翻译载体、字幕对齐与切分、字幕导出的设计记录；实现在 `crates/speech-doc`，文中的数据模型名指 v2，与 v3 的对应见架构设计 §14 |
| [`design/brand/app-icon.md`](design/brand/app-icon.md) | **App 图标设计**：图形组成、三色配色与备选变体、外形模板、否决过的方向；绘制源码在 `tools/app-icon/` |
| [`design/timeline/`](design/timeline/README.md) | **时间线语义与元素模型（移植自 v2）**：v2 元素模型与 v3 视频格式的逐项对照（接线各批的输入），以及剪辑域、剪口播、元素几何、`timeline.json` 的设计记录；实现在 `crates/timeline`，文中的数据模型名指 v2 |
| [`design/agent-surface/`](design/agent-surface/README.md) | **面向外部 Agent 的能力面（方案稿）**：CLI、MCP 服务与 BaoCut skill 共用工具目录的设计，Agent 面的命令目录、CLI 与 MCP 约定、skill 的结构与实施顺序 |
| [`glossary.md`](glossary.md) | **术语表**：同一概念只用一个词 |
| [`repo-conventions.md`](repo-conventions.md) | **仓库约定**：顶层目录、代码放置与文件命名 |
| [`development-workflow.md`](development-workflow.md) | **开发流程**：规范与实现同步、验证入口、多端同步、语言与平台、工作区与产物；按任务读取相关章节 |

## 阅读路线

| 你想做什么 | 读 |
| --- | --- |
| 了解 BaoCut 是什么、首版做什么 | 产品设计 §1、§11 |
| 设计或实现界面 | 产品设计 §2–§5；架构设计 §11 |
| 实现智能体接入与工具 | 架构设计 §3–§4；产品设计 §6–§7 |
| 实现视频引擎与编辑语义 | 视频格式规范 §2–§4；命令与协议规范；架构设计 §5 |
| 实现字幕、翻译、口播剪辑、配音 | 视频格式规范 §5–§7 |
| 实现代码动画与渲染 | 代码包规范；架构设计 §8–§10 |
| 实现模型接入与长任务 | 架构设计 §6–§7；Model Worker 协议规范 |
| 实现局域网能力共享 | 架构设计 §6.7、§12.7；节点协议规范 |
| 实现对外服务（MCP 服务、模型接口、Web） | 架构设计 §4.8、§12.8 |
| 实现 CLI、MCP 工具或 BaoCut skill（给外部 Agent 的能力面） | [`design/agent-surface/`](design/agent-surface/README.md)；架构设计 §3.5、§4.8 |
| 实现用户库、偏好设置与跨视频检索 | 架构设计 §5.9–§5.11 |
| 实现工具页任务、固定流程与各种导出 | 架构设计 §7.9、§9.13 |
| 管理外部工具、安装动作与应用更新 | 架构设计 §12.9、§2.6 |
| 实现 Home 模板库、新增内置模板 | 模板包规范；产品设计 §3.2.1 |
| 写测试或判断能否发布 | 验收与测试 |
| 新建文件、包或 crate | 仓库约定 |
| 验证改动、同步多端、处理依赖或 worktree | 开发流程对应章节 |

## 文档约定

### 规范用语

- **必须 / 不得**：硬约束。违反即是缺陷。
- **应 / 不应**：默认做法。偏离需要写明理由。
- **可**：允许的选择。
- 「默认」「建议值」是可调的产品参数，不是保证。

### 范围标记

| 标记 | 含义 |
| --- | --- |
| P0 | 首个完整闭环必须具备 |
| P1 | 完整版扩展体验 |
| P2 | 后续的规模与协作 |
| G | 全阶段约束：对任何已开放的功能都生效，不因阶段而豁免 |

P0 / P1 的划分不授权删除已经稳定的能力。某项功能尚未接入智能体时可以保留手工入口，但对话不得宣称能够执行。

### 合同的状态

文档中的类型、接口、状态机与错误码是**目标合同**，用 TypeScript 写法表达 DTO 概要，不代表已生成的 SDK 或 Schema。性能数值是待基准校准的目标。验收条目是定义，执行状态由测试记录维护。

未知的源码可编辑性、未验证的图形一致性、缺失的沙箱、状态不明的外部计费，都不得用一个「成功」状态掩盖。这条贯穿全部文档。

### ID 体系

| 前缀 | 含义 | 定义位置 |
| --- | --- | --- |
| `AG` `UX` `SPC` `CON` `CRE` `EDT` `LNG` `AST` `COL` `AUT` `QUA` `OUT` `SET` `NFR` | 产品需求 | 产品设计 §10 |
| `S01`–`S12` | 端到端工作流 | 产品设计 §9 |
| `R0`–`R4` | 发布阶段 | 产品设计 §11 |
| `0.1`–`0.4` | 起步版本：R0 与 R1 前半的拆分 | 产品设计 §11.1 |
| `D01`–`D14` | 关键架构决定 | 架构设计 §1.6 |
| `TIME-01`–`TIME-08` | 时间模型规则 | 视频格式规范 §2.1 |
| `AT` `UI` `T` `A` `C` `M` `TM` | 验收条目 | 验收与测试 §6 |

ID 一经发布不复用、不改含义。废弃的条目保留编号并标注废弃。

### 版本轴

文档版本、`videoSchemaVersion`、`bundleSchemaVersion`、`adapterContractVersion`、`eventProtocolVersion`、`timeContractVersion`、`runtimeVersion`、`engineVersion` 彼此独立演进。正文中的「v1」指首版数据或执行合同。细则见架构设计 §13.3。

### 写作规则

- **一个主题一篇文档**。不按章拆成多个文件；文首维护目录，章节编号保持稳定，跨文档引用写「文档名 §章节号」。
- **一事一处**。每个事实只在一处定义，其他地方引用。发现要把同一段话写进两处时，其中一处改成引用。
- **整合，不追加**。行为变了就改写拥有该主题的那一节，不在文末补一段。
- **写规则，不写过程**。文档描述系统应该是什么，不记录讨论经过、修订历史或取舍来源；历史在 git 里。
- **放置规则**：用户可见的行为与范围 → 产品设计；服务、进程、机制 → 架构设计；持久格式、DTO、数值规则 → `spec/`；可判定的通过标准 → 验收与测试。
- 尚待评审、实验或用户研究确认的事项，写在所属文档末尾的「待评审事项」一章。
- 文档用中文撰写；代码标识符、协议字段与命令保持英文原样。产品本身与语言无关：媒体、文稿、译文和配音可以是任何语言，例子里出现的语言只是示意。
