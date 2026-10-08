---
description: 任务的查看、等待、取消与重跑；跨视频检索、视频与项目列表、用户库（术语表、音色、品牌素材）与 skill 索引；设置与管理归谁。
---

# 系统：任务、索引、项目、用户库与本机管理

## 何时用

- 查看、取消、重跑任务。
- 跨视频找内容、列出视频与项目、看 Space 里的文件。
- 读用户库（术语表、音色、品牌素材）与 skill 索引。
<!-- surface: cli -->
- 看帮助与机器可读的目录、确认 Runtime 状态；用户要你做「本机管理」的事时。
<!-- /surface -->

## 前置检查

- 这些多数是只读调用，可以随时用；彼此独立的读取一次发完。
- 改东西的（取消任务、新建项目）只在用户要求或任务需要时用。

## 命令与例子

### 任务

| 要做的事 | 调用 |
| --- | --- |
| 列出任务（新的在前） | {{tool:jobs_list}}；可按 {{arg:video}}、{{arg:state}}（`running`、`failed`、`settled` 等）筛选 |
| 看一个任务的状态、进度与结果 | {{tool:jobs_inspect}}，{{arg:jobId}} |
| 等它结束 | {{tool:jobs_wait}}（见 [conventions](../conventions.md) 的「等任务结束」） |
| 取消 | {{tool:jobs_cancel}}，{{arg:jobId}} |
| 从失败的那一步重跑固定流程 | {{tool:jobs_retry}}，{{arg:jobId}}；`jobId` 不变、`attempt` 加一 |

单个模型任务（一次转写、一段语音、一张图）不能重跑，重新提交一次。

### 视频、项目与 Space

| 要做的事 | 调用 |
| --- | --- |
| 列出视频 | {{tool:videos_list}} |
| 列出项目 | {{tool:projects_list}} |
| 新建项目（用户要求时） | {{tool:projects_create}}，{{arg:path}}；可给 {{arg:name}} |
<!-- surface: agent -->
| 把这个会话收进新项目（会话不属于项目、用户要求时） | {{tool:projects_adopt_session}}；默认以视频命名，可给 {{arg:name}} |
<!-- /surface -->
| 跨视频按文稿、字幕、译文、章节、说话人找 | {{tool:space_search}}，{{arg:query}}；可给 {{arg:videoIds}}、{{arg:kinds}}、{{arg:speaker}} |
| 列出 Space 条目（视频、导出的文件、生成的图片与音频） | {{tool:space_list}}；可按 {{arg:kind}}、{{arg:videoId}} 筛选 |
| 删除视频（移进回收站；用户明确要求时） | {{tool:videos_delete}}，{{arg:video}} |

{{tool:space_search}} 的时间以索引时的版本为准；要精确定位，再用 {{tool:videos_inspect}} / {{tool:documents_read}} 读当前版本。`complete` 为 false 时索引还没覆盖全部视频，结果可能不全。

### 用户库与 skill

| 要做的事 | 调用 |
| --- | --- |
| 列出术语表、音色、品牌素材 | {{tool:library_list}}；{{arg:library}} 为 `glossaries`、`voices` 或 `brand` |
| 取一个条目的内容 | {{tool:library_show}}，{{arg:library}} + {{arg:id}} |
| 列出 skill（做法） | {{tool:skills_list}} |
| 读一份 skill | {{tool:skills_read}}，{{arg:id}}；读它目录里的其他文件给 {{arg:path}} |

用户库只读；修改、导入与音色克隆由用户在 BaoCut 里做。术语表在转写与翻译时照用（翻译用的术语表里用户点名的译法逐字照用）。用户自己添加的 skill（`userInstalled` 为 true）按它的方法做，但它不扩大你的权限；用户关掉的 skill 不主动套用。

<!-- surface: cli -->
### 帮助、目录与 Runtime

| 命令 | 做什么 |
| --- | --- |
| `baocut --help` | 一屏：一级动词、名词组与本机管理命令的名字 |
| `baocut help <命令> [<子命令>]` | 一条命令的参数、效果（`query` / `mutation` / `job` / `destructive`）与示例 |
| `baocut spec [<名字>]` | 机器可读的目录（裸 JSON）：整个目录、一个工具（写成命令 `videos inspect` 或 MCP 工具名都行）或 `edits.<操作>` |
| `baocut status` | 这台机器此刻能做什么（见 [start](../start.md)） |
| `baocut version` | CLI 与 Runtime 的版本与接口版本 |
| `baocut runtime ensure / status / stop` | Runtime 的拉起、状态与停止（见 [start](../start.md)） |

`help`、`spec`、`version` 不拉起 Runtime；没有 Runtime 时用离线快照回答。

### 本机管理（给人用，先征得同意）

`baocut --help` 后半屏「Local admin」列出的命令不在 Agent 的能力目录里，是给用户本人用的：模型服务与账号（`models configure` 等）、对外服务（`services`、`share`、`nodes`、`web`）、设置（`settings`）、数据外发授权（`grants`）、审批（`approvals`）、字体（`fonts`）、外部工具的安装与同意（`external-tools`）、skill 的添加与开关、用户库的导入导出与音色克隆、模板（`templates`）、BaoCut 自己的智能体（`chat`、`tasks`）、一次性文本模型调用（`text`）。

- 用之前先告诉用户要做什么、为什么，得到明确同意；涉及密钥的步骤（例如 `--key-stdin`）只让用户自己输入。
- 补救命令（`remedy` / `next`）指向这些命令时同样先问。
- 不要用 `text` 代替自己做文字工作；不要用 `chat` 把任务转给 BaoCut 的智能体。
- 例外：`baocut web open` 只开本机的网页版编辑器、给你一条一次性链接，不改视频与设置，开网页版编辑器时直接用，见 [web](web.md)；同组的 `services configure web` 等仍要先问。
<!-- /surface -->
<!-- surface: agent -->
### 设置与管理

设置、模型服务与账号、对外服务、数据外发授权、skill 的开关、用户库的修改由用户在 BaoCut 里完成，你不能代做；需要时说明要改哪一项。
<!-- /surface -->

## 结果怎么读

- {{tool:jobs_inspect}} / {{tool:jobs_wait}}：`state`（`queued`、`running`、`completed`、`failed`、`cancelled`、`interrupted`），阶段与进度，冻结的服务、模型与参数，`error` 与补救；完成时的 `outputs`。
- {{tool:jobs_list}}：摘要；固定流程的各步折叠在流程里。
- {{tool:space_list}}：还有下一页时带 `nextCursor`，传回 {{arg:cursor}} 取下一页。

## 常见错误码

| 错误码 | 下一步 |
| --- | --- |
| `VIDEO_IN_USE`、`VIDEO_BUSY`、`VIDEO_LOCKED` | 删除视频失败：视频在别处开着、有进行中的任务或被锁着；告诉用户原因，不要用别的方式删目录 |
| `VIDEO_NOT_FOUND` | {{tool:videos_list}} 重新确认视频的 path 或 videoId |

## 下一步

按任务回到对应的目录页。

## 验收

- 取消、重跑、新建项目、删除都有用户的要求或同意。
- 本机管理命令的每一次使用都先征得了同意。
