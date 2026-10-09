# BaoCut 命令与协议规范

> 界面、CLI 与智能体通过同一套命令修改视频。本规范定义命令信封、编辑事务、回执、时间输入、批量预检、撤销、事件与错误合同。

协议版本：`protocolVersion: 1`（即 `eventProtocolVersion`）。

本规范定义**请求、响应与事件的形状及其语义**。传输、身份认证、订阅机制与进程边界见[系统架构设计](../architecture/architecture-design.md) §4；被修改的数据见[视频格式规范](video-format-spec.md)；代码合成见[代码包规范](code-bundle-spec.md)。用语见[文档约定](../README.md#文档约定)，术语见[术语表](../glossary.md)。

## 目录

- [1. 范围与约定](#1-范围与约定)
- [2. 信封与身份](#2-信封与身份)
- [3. 事务与严格的版本校验](#3-事务与严格的版本校验)
- [4. 命令表面](#4-命令表面)
- [5. 回执](#5-回执)
- [6. 时间输入与量化回执](#6-时间输入与量化回执)
- [7. 批量预检](#7-批量预检)
- [8. ChangeSet、检查点与撤销](#8-changeset检查点与撤销)
- [9. 手工交互](#9-手工交互)
- [10. 事件](#10-事件)
- [11. 错误合同](#11-错误合同)
- [12. 示例](#12-示例)
- [13. 待评审事项](#13-待评审事项)

---

## 1. 范围与约定

### 1.1 一个入口

所有修改视频的请求都走同一条路径：

```text
客户端（界面 / CLI / 智能体工具）
  → @baocut/client 的 Command
  → Runtime：认证、授权、幂等、构造事务
  → VideoEngine：校验、量化、原子提交
  → 回执 + 事件
```

界面手势、智能体的工具调用和自动应用的任务结果使用同一组 `EditOperation`，经过同样的校验。没有只给某一类调用方使用的旁路。

### 1.2 三类请求

| 类型 | 作用 | 是否改变状态 |
| --- | --- | --- |
| Command | 请求一次修改或启动一次执行 | 是 |
| Query | 读取某个版本或最新状态 | 否 |
| Subscription | 取得一个水位的快照与其后的事件 | 否 |

### 1.3 类型的地位

类型用 TypeScript 写法表达，是 DTO 概要，不代表已生成的 SDK 或 Schema。方法与操作的全集由契约单源生成（架构设计 §13.2）；本规范列出的是代表性的条目与必须满足的规则。标注「本规范补全」的类型在原始设计中只有名称或用法，列入 §13。

基础类型 `Id`、`Revision`、`VersionRef`、`JsonValue`、`Rate`、`MediaTime` 见视频格式规范 §1.2 与 §2.3。

### 1.4 边界上的数值

- `Revision`、`eventSeq`、`ticks` 是可检查的十进制整数字符串。
- 帧计数、帧率的分子与分母必须落在协议规定的安全整数范围内。
- 接口边界拒绝 NaN、Infinity、负时长、未约分的 `Rate` 和不合法的时间域。不尽量猜测。

---

## 2. 信封与身份

### 2.1 CommandEnvelope

```ts
interface CommandEnvelope<T> {
  protocolVersion: number;
  requestId: Id;                     // 只关联当前这次网络请求
  commandId: Id;                     // 重试时保持不变的业务操作 ID
  method: string;
  videoId?: Id;
  expectedRevision?: Revision;       // 十进制字符串
  taskId?: Id;
  payload: T;
}
```

- 修改视频的命令必须带 `videoId` 与 `expectedRevision`。
- 属于某个任务的命令带 `taskId`；服务端据此检查任务合同、授权与停止屏障。
- `method` 的形式是 `<命名空间>.<动作>`，例如 `edits.apply`、`tasks.stop`。

### 2.2 客户端不能声明的内容

公共请求**不得**携带 `actor`、`trusted=true` 或任意的 `budgetApproved`。带有这些字段的请求被拒绝，而不是被忽略。

这些内容由服务端确定：

| 内容 | 来源 |
| --- | --- |
| `actor`（谁在操作） | Runtime 从已认证的连接构造 |
| `transactionId` | 服务端分配 |
| 可用的权限与授权 | 服务端按主体、视频、任务合同解析 |
| `runGeneration` | 服务端按任务的当前执行代填入 |
| 预算是否已批准 | 服务端按授权记录判断 |

### 2.3 六种 ID

| ID | 标识什么 | 生命周期 |
| --- | --- | --- |
| `requestId` | 一次网络尝试 | 每次发送都不同 |
| `commandId` | 一次业务操作 | 重试同一个操作时复用 |
| `transactionId` | 一笔实际提交的视频事务 | 服务端分配 |
| `jobId` | 一次计算 | 服务端分配 |
| `applicationId` | 一次把产物应用到视频的动作 | 服务端分配 |
| `taskId` / `runId` | 一次委托及其一次执行尝试 | 服务端分配 |

**重试与新操作的区别**：同一个操作重试，复用 `commandId`。重新观察了新版本之后形成的新操作，分配新的 `commandId`，并保留它与旧操作的来源关系。

### 2.4 幂等

Runtime 把 `commandId` 映射为视频内的 `idempotencyKey`。

| 情况 | 结果 |
| --- | --- |
| 同一个 video + key + 相同的 payload hash | 返回同一份回执，不重复执行 |
| 同一个 video + key + 不同的 payload | 拒绝，`IDEMPOTENCY_CONFLICT` |
| 提交已成功，但响应在途中丢失 | 用同一个 `commandId` 重试，取回原回执 |

幂等记录与事务在同一次原子提交中落盘。

### 2.5 Query

- 读请求要么指定版本，要么取 `latest`。响应必须带上实际返回的版本。
- 读取支持字段选择、时间范围、对象类型、分页游标和字节预算。响应标明覆盖范围、是否被截断，以及继续读取的游标。被截断的数据不能被当成完整的视频。
- 长任务不读取「当前视频」。它先取得冻结的 `snapshotRef`，再基于它执行。

---

## 3. 事务与严格的版本校验

### 3.1 VideoTransaction

Runtime 在授权之后构造事务，交给 VideoEngine。这是内部的 DTO，公共客户端不能提交它。

```ts
interface VideoTransaction {
  id: Id;
  videoId: Id;
  baseVideoRevision: Revision;
  idempotencyKey: string;
  actor: { kind: 'user' | 'agent' | 'system'; id: Id };
  readSet: Array<{ entityId: Id; revision: Revision }>;
  label: string;
  operations: EditOperation[];
  provenance?: { sessionId?: Id; turnId?: Id; jobIds?: Id[]; proposalId?: Id };
}
```

### 3.2 严格的乐观并发

**P0 使用视频版本的严格乐观并发控制：版本不匹配就返回冲突，不自动重放。**

- `expectedRevision` 与视频的当前版本不一致时，返回 `PROJECT_REVISION_CONFLICT`。
- 调用方重新读取受影响的对象，重新形成操作，用新的 `commandId` 提交。
- `readSet` 从首版就保留：它记录这次操作依据了哪些实体的哪个版本。
- **P1** 才在经过测试的、互不相干的对象或字段上开放自动重基。

不能因为两条命令修改的是不同的字段，就忽略它们之间的隐式依赖。修改源素材的时长会影响字幕、转场和配音；这类依赖由引擎判断，不由调用方声明自己「互不相干」。

### 3.3 原子性

一次事务内的这些内容原子提交，要么全部成立，要么全部不成立：

- 领域校验的结果；
- 实体的变更；
- 视频版本与受影响实体版本的递增；
- 事务日志与幂等记录；
- 待发送的事件（outbox）；
- 时间输入的量化结果（§6）。

事务不部分落盘。一批操作中任何一个失败，整批拒绝。

### 3.4 校验在引擎里完成

版本、锁定、保护范围、领域规则和资源可用性，都在引擎的串行提交入口检查。Runtime 不做「先检查版本、稍后再盲写」的两步流程：检查与写入之间不留空隙。

事务提交时还检查：

- 任务的执行代是否仍然有效（停止屏障，架构设计 §7.4）。任务与固定流程的提交在 Engine Host 的私有通道上带 `run { runId, runGeneration }`，取消时 Runtime 先发 `runs.invalidate { videoId, runId, runGeneration }`；失效之后到的、还没有回执的提交以 `TASK_STOPPED` 拒绝，不开事务。用户与智能体的普通编辑不带 `run`。公共请求不能带 `run`；
- 授权是否仍然成立；
- 操作的目标是否落在任务合同的范围内，是否触碰保护范围或锁定的轨道。任务里的写入在 Engine Host 的私有通道上带 `taskId` 与 `protections`（任务合同里这个视频的保护，`protectionId` 与 `target`）：智能体的提交与撤销，以及任务下的 Job 与流程应用结果（行为者 `system:jobs`、`system:pipeline`，架构设计 §3.2）。引擎对照这笔事务的实体变化检查，触碰时以 `TASK_PROTECTED` 整笔拒绝（§11.2）；用户与手动的修改、不在任务里的写入、`jobs.reconcile apply` 不带。公共方法的参数里没有 `protections`；Engine Host 只对带 `taskId` 的非用户提交检查，别的提交带了也不生效。

批准一次修改不等于可以跳过冲突检查。所有低风险的自动应用也走同样的校验。

### 3.5 不接受任意的 Patch

- 调用方提交的是经过验证的 `EditOperation`，不是针对数据库的任意路径 JSON Patch。
- Patch 可以作为回执中的一种展示格式，但不是输入格式。
- 整份快照的替换只限于导入、恢复或显式的管理操作，并且必须做严格的版本检查。普通的界面操作与智能体不能提交整份快照。

### 3.6 长任务不持有视频

长时间的模型计算与网络等待不在事务之内，也不锁住视频。计算完成后，结果作为产物发布，再通过一笔独立的、幂等的事务应用到视频；应用时重新校验输入版本与目标（架构设计 §7.3）。

---

## 4. 命令表面

### 4.1 方法

以下是各命名空间的代表性方法。

媒体通道的 `media.playback { url, playable? }` 为当前通道已签发的文件句柄请求播放地址（架构设计 §4.5）。只接受 `url` 与可选的 `playable`（客户端能原生解码的 WebM 编码，取值 `vp8`、`vp9`、`av1`、`opus`、`vorbis`），未知字段拒绝；句柄伪造、过期、来源不符或源文件已丢失回 `not-found`。非 WebM，或 WebM 首条画面与声音的编码都在 `playable` 里时，直接返回 `{ status: 'ready', media: 原句柄 }`；否则准备兼容副本，未就绪时返回 `{ status: 'pending', retryAfterMs: 250, progress? }`（`progress` 为 0–1 的编码进度，不知道时省略），就绪时返回 `{ status: 'ready', media: MediaHandle }`。失败经现有 RPC 错误信封返回，FFmpeg 缺失、超时与不能解码沿用媒体分析的错误。派生缓存不进入文档历史或用户任务表；源文件下载继续通过 `media.resolve` 及原句柄的 `?download=1`。该方法在 Web 的只读白名单内，缓存句柄仍受 Web 会话和媒体权限约束，无独立 CLI / MCP 入口。

| 命名空间 | 代表性方法 | 说明 |
| --- | --- | --- |
| `videos` | `create` `open` `inspect` `close` `assetStatus` `delete` `restore` `importPackage` | 视频的生命周期与按范围读取。`delete`（`FileTarget` 或 `{ videoId }`）把视频目录移进所在来源目录的回收站，返回 `{ status: 'trashed', entryId, videoId, name, trashedAt, related }`（`entryId` 是回收站里的条目，`related` 是由它导出、生成而留在原处的条目）；已经删除的再删回答同一个结果。拒绝：别的连接打开着 `VIDEO_IN_USE`，有内部租约或排队、运行中的任务 `VIDEO_BUSY`（带 `jobIds`），别的进程锁着 `VIDEO_LOCKED`，跨卷 `VIDEO_TRASH_CROSS_DEVICE`，视频目录是某个来源目录（项目目录、会话的工作目录）本身或装着它 `VIDEO_TRASH_SOURCE_ROOT`，都是 `conflict`。只有调用方自己打开着时先替它关闭（`video.closed`，`reason: 'deleted'`）。`restore { entryId }`（回收站里的条目，或删除之前的条目 id）移回原处，原处有东西时加序号，返回 `{ entry, relPath, renamed }`；不是删除了的视频时 `VIDEO_NOT_TRASHED`。`open` 打不开回收站里的路径（`VIDEO_TRASHED`）。物理删除走 `space.purge`，保留期见设置 `space.trashRetentionDays`（架构设计 §5.7）。链接素材的原文件不删。`assetStatus({ videoId })` 返回已打开视频里此刻读不到的素材版本 `{ missing: [{ assetId, revision, reason, path?, volume? }] }`（`reason` 为 `missing`、`changed` 或 `outside-project`，视频格式规范 §4.2），只看文件在不在、长度对不对。缺了素材视频照常打开，界面在打开视频、收到 `video.replaced`、提交了素材类操作之后查一次，标出缺失的素材，不必等到 `media.resolve` 失败；不随快照下发，因为事件投影无法知道文件的状态。`importPackage({ projectId? \| conversationId?, path, commandId? })`（两个来源恰好给一个）把便携包（视频格式规范 §8）在项目目录或会话的工作目录里建成一个新视频，返回与 `videos.create` 相同的 `{ ref, ... }`：新的 `videoId`，目录名取包里的视频名（重名加「 2」这样的序号），素材全部收进视频；同一个 `commandId` 返回同一个结果。包逐个文件核对后才建视频，拒绝放在 `RpcError.details.code`（`invalid-request`）：`PACKAGE_INVALID`（不是 BaoCut 包、坏的归档头、清单与归档不一一对应、快照不自洽）、`PACKAGE_VERSION_UNSUPPORTED`（打包版本比这个版本高）、`PACKAGE_DIGEST_MISMATCH`（长度或摘要不符）、`PACKAGE_PATH_UNSAFE`（`..`、绝对路径、包的布局之外的路径、符号链接与硬链接条目）；文件不存在是 `not-found`（`PACKAGE_NOT_FOUND`）。只开给桌面界面、CLI 与 Web 服务；Web 的文件按真实路径必须在项目或会话的工作目录里（`PATH_OUTSIDE_PROJECT`，`forbidden`）。智能体工具与对外服务没有这个方法 |
| `timeline` | `query` | 按序列、时间范围与对象类型读取 |
| `speech` | `search` | 在文稿中检索词、句与 occurrence |
| `edits` | `propose` `prepareBatch` `applyPrepared` `apply` `undo` `applySpeakers` | 编辑事务（§3、§7、§8）。`applySpeakers { videoId, jobId, commandId, names? }` 应用一次识别说话人（`pipelines` 的 `speakers` 流程）的提案，返回与 `apply` 相同的 `EditResult`：一笔以调用者为行为者的事务，转写写新版本（词上的说话人、说话人表，概要的 `speakerCount`），参与试算的译文按新的说话人边界重切、写新版本（不重译，概要的 `unitCount` 跟着更新）；字幕层不重新生成（与改原文相同：由旧版文稿生成的字幕层留着，界面提示它过期）。`names` 是确认时改的名字（键是提案里的说话人 ID，名字去掉首尾空白后 1–100 字）。撤销与重做都是 `undo { transaction }`：撤销这笔，再撤销那笔撤销即重做（§8.3）。拒绝：任务不是 `speakers` 流程、不属于这个视频、`names` 里有提案之外的说话人或空名字是 `invalid-request`；流程还没完成是 `conflict`；提案产物已经清理、转写或参与试算的译文在识别之后改过（版本不同、译文增删）是 `conflict`（`STALE_JOB_INPUT`），要重新识别 |
| `conversations` | `create` `list` `update` `send` `archive` `delete` | 会话。访问模式（架构设计 §3.12）：`AgentMode` 为 `plan`、`ask`、`autoAcceptEdits`、`auto`、`fullAccess`；会话记录上的 `accessMode` 是切换过的模式，`null` 跟随设置 `agent.defaultAccessMode`。`update { conversationId, accessMode?, pendingReferences? }` 切换（`null` 回到跟随设置；`pendingReferences: null` 去掉从 Space 挂上、还没发出的条目引用，架构设计 §5.7），生效的模式变了时会话里记一条带 `modeChange { from, to }` 的 `notice`；`send { …, accessMode?, autonomy? }` 给出模式等于先切换再发送（`autonomy` 是旧名，两个都给时以 `accessMode` 为准）。参数照收旧值 `controlled`（= `ask`）与 `authorized`（= `fullAccess`），Runtime 发出的一律是新值。任务卡片的 `autonomy { mode, source }` 记发送时的模式与来源（`request`、`conversation`、`setting`、`default`）。`send` 可以带 `contract`（`TaskContractInput`，与 `tasks.create` 相同），任务卡片带建立时的合同 `contract`。`send` 可以带 `template { id, version?, assets?, language? }` 挂一个场景模板（模板包规范 §5.2）：Runtime 读目录里当前的模板，按 `language` 挑语言版本（没带时按 Runtime 的界面语言，模板包规范 §3.6），把简报引导前言、默认画幅与时长、正文与素材清单包成 `<baocut-template>` 段附在交给智能体的文字后面；会话里的用户消息仍是 `text`，另带 `template { id, version, title, kind, origin }` 标记（`version` 是实际用的版本，请求里的 `version` 只作参考；`title` 是所用语言版本的标题）。拒绝：没有这个模板 `TEMPLATE_NOT_FOUND`（`not-found`），作品示例 `TEMPLATE_NOT_SCENE`、`assets` 里有没登记的路径 `TEMPLATE_FILE_NOT_FOUND`（都是 `invalid-request`）。`steer` 与 `tasks.create` 不带模板。`send` 可以带 `skill { id }` 点选一个 Agent skill（架构设计 §3.8）：开着的、关着的都能点选；Runtime 读目录里当前的 skill，把它 `SKILL.md` 的正文与同目录的文件清单包成 `<baocut-skill>` 段附在交给智能体的文字后面（同时挂了模板时在模板段之后）；会话里的用户消息仍是 `text`，另带 `skill { id, name, origin }` 标记。没有这个 skill 或它没能加载时 `not-found`（`SKILL_NOT_FOUND`）。`steer` 与 `tasks.create` 不带 skill |
| `tasks` | `get` `stop` `steer` `answer` | 任务合同、停止、改向与回答问题。`stop` 先建立停止屏障，取消这个任务待处理的审批，再取消这个会话里智能体提交、还在排队或运行的 Job（已经结束的保留结果），请求取消了几个记在会话的一条 `notice` 里（架构设计 §7.4）。任务合同（架构设计 §3.2），类型在 `@baocut/protocol` 的 `tasks.ts`：`create { conversationId, goal, commandId, accessMode?, context?, contract? }` 以合同建立任务并开始，与 `conversations.send` 是同一个实现，返回 `{ taskId, contract }`，没有给出的部分按默认（会话还有任务在运行时 `busy`）；`getContract { taskId, revision? }` 返回 `TaskContractView`（这个修订、最新修订号与任务预算的上限和用量）；`listContracts { conversationId }` 是会话里每个任务的最新合同（新的在前），`{ taskId }` 是这个任务的全部修订（旧的在前）；`updateContract { taskId, expectedRevision, commandId, patch }` 产生新的修订，`patch` 给出的字段整体替换，`autonomy` 等于切换会话的访问模式，`budget { maxCalls, cap }` 设任务预算的上限（用量照旧）；`changeGoal { taskId, goal, previousWork: stop | keep, commandId }` 结束旧任务、以新目标建立新任务，返回 `{ taskId, previousTaskId, contract }`；`recordCheck { taskId, checkId, outcome: passed | failed | skipped, note?, commandId? }` 记录验收检查的结果，任务结束后也可以；`listChecks { taskId }` 返回 `{ checks, results }`。修改类方法同一个 `commandId` 只生效一次。CLI 用 `baocut tasks contract|history|list` 查看；Web 只读模式只开放 `getContract`、`listContracts`、`listChecks`；MCP 服务不开放 |
| `agents` | `interrupt` `respondToApproval` `list` `detect` `setDefault` `configure` | 只停当前回复（不取消 Job），待处理的审批按取消处理；`respondToApproval { conversationId, approvalId, decision: 'accept' \| 'accept-for-session' \| 'decline' }` 处理会话里的一条审批，与 `approvals.respond` 是同一个实现，返回 `accepted`、`declined` 或 `already-resolved`；Driver 的探测、健康与默认值（架构设计 §3.11）。`list` 返回 `AgentsView { drivers, checking, preferences }`：有探测结果的 Driver 立即用缓存（启动时来自 `store/agent-probes.json`，`checkedAt` 是那次探测的时间），还没有任何结果的里经过集成测试的等它探完，没验证的不等、列在 `checking`，探完经 `agents` 主题推送。`detect { driverId? }` 强制重新探测（不用缓存；给了 `driverId` 只探那一个，没注册时 `driver-unavailable`），探完才返回，返回前也推送一次。`configure { driverId, enabled?, defaultModel?, defaultEffort?, executable? }` 改一个 Agent 的偏好：`defaultModel: null` 是明确选了「Agent 默认模型」（不传模型、按 CLI 配置，存成 `__agent-default__`）；没设过时新会话用推荐模型（Claude Code 的 Sonnet、Codex 的 `-sol`），`DriverInfo.defaultModel` 给出新会话起手的模型，明确选了「Agent 默认模型」时为 `null`（架构设计 §3.11「默认模型与推荐模型」） |
| `approvals` | `list` `respond` | 统一的待处理审批（架构设计 §3.12、§4.8）：会话里要问用户的 Driver 审批与 BaoCut 工具调用，以及对外服务的审批。`list` 返回 `{ approvals: PendingApproval[] }`；`PendingApproval` 带 `approvalId`、`subject`（`{ kind: 'conversation', conversationId, conversationTitle, projectId, taskId }` 或 `{ kind: 'service', serviceId, clientId, clientName }`）、`action { kind: 'tool' \| 'command' \| 'file-change', name, targets, summary }`、`risk`（`read`、`edit`、`command`、`high`）、`basis`（`{ kind: 'mode', mode }` 或 `{ kind: 'service', level }`）、`createdAt` 与 `expiresAt`（会话审批为 `null`，没有时限）；涉及数据外发的审批另带 `grants`（`GrantRequestItem[]`：`capability`、`dataKinds`、`recipient`、`videoId`、`purpose`、`reason`（`none`、`revoked`、`unverifiable`；工具页的待批准项另有 `exhausted`，§11.3）、`cost`、`estimate`、`maxCalls`，架构设计 §12.5）。`respond { approvalId, decision: 'allow' \| 'deny', grant? }` 返回 `allowed`、`denied` 或 `already-resolved`（已处理、已超时、已取消或不存在）；`grant`（`ApprovalGrantChoice`）只对带 `grants` 的审批有效：`{ persist: false }`（默认，只这一次、金额未知）或 `{ persist: true, scope?: 'video' \| 'all', maxCalls?, budgetCap?, expiresAt? }`（同时发放持续授权），给不带 `grants` 的审批时 `invalid-request` |
| `grants` | `list` `create` `update` `revoke` `usage` | 数据外发的授权与预算账本（架构设计 §12.5、§7.8），类型在 `@baocut/protocol` 的 `grants.ts`。`list { recipient?, videoId?, includeEnded? }` 返回 `{ grants: Grant[] }`（新的在前；默认只列有效的，`includeEnded` 时连撤销、到期、用完的一起列；`videoId` 列出覆盖这个视频的，含全部视频的）。`create`（`dataKinds`、`recipient`、`purpose`、`budgetMode`：`estimate-cap` 或 `per-call-unknown-cost`；可选的 `scope { videoId }`、`budgetCap { amount, currency }`、`maxCalls`、`expiresAt`、`taskId`）返回 `{ grant }`：`free-local`、空的数据种类、`estimate-cap` 没有 `budgetCap`、`per-call-unknown-cost` 带 `budgetCap`、过去的到期时间以 `invalid-request` 拒绝。`update { grantId, dataKinds?, scope?, purpose?, budgetCap?, maxCalls?, expiresAt? }` 给出的字段替换，收紧时 `generation` 加一。`revoke { grantId }` 返回 `{ grant, alreadySent { calls, amount, unknownCostCalls }, runningJobs, note }`：已经交出、可能已经计费的如实列出。`usage { grantId }` 返回 `{ grant, jobs }`，`jobs` 是用过它、还保留在任务记录里的 Job 的预留与结算。不存在的 `grantId` 是 `not-found`，已撤销的不能修改（`conflict`）。浏览器（Web 服务）不开放这组方法与 `grants` 主题；MCP 服务没有对应的工具 |
| `models` | `capabilities` `transcribe` `synthesizeSpeech` `generateImage` `generateText` `configure` `setDefault` `setCapabilityParameters` `refreshProvider` `removeProvider` `addAccount` `updateAccount` `removeAccount` `arrangeAccounts` `usage` `checkBalance`（P1） `list` `enable` `install` `cancelInstall` `repair` `remove` `test` `getDir` `inspectDir` `setDir` | 模型能力，立即返回 `jobId`；`provider` 与 `model` 可选，不给时用该能力的默认值（架构设计 §6.2）；`provider` 为 `node:<nodeId 或别名>` 或 `transcribe` 给出 `node` 时交给那台局域网节点（节点协议规范 §9）；没有可用的 Provider 时在提交时以 `CAPABILITY_NOT_CONFIGURED` 拒绝，不创建任务（`synthesizeSpeech`、`generateImage` 与 `generateText` 没有出厂默认）。能力视图另列 `separateAudio`（人声与背景分离，只有本地 Provider，出厂默认是第一个可用的分离模型包；没有单独的提交方法，由配音流程使用），`setDefault` 同样接受它；对外模型接口的别名与自建端点声明的模型只接受有在线 Provider 的四种能力。`synthesizeSpeech`（`text`、可选的 `voice`、`language`、`format`、`instructions`、`speed`、`seed`；本地模型另有 `reference`（`{ file: 绝对路径, transcript? }`，参考录音与它的原文）、`voiceDescription`（一句声音描述）、`cfg`、`steps`，`voice`、`reference` 与 `voiceDescription` 至多给一个）与 `generateImage`（`prompt`、可选的 `size`（`WxH` 或 `W:H`）、`count`、`format`、`seed`；本地模型另有 `steps`）在提交时按模型描述检查，超过上限或模型不支持的参数以 `invalid-request` 拒绝，`details` 带模型的限制；给了 `videoId`（必须已经打开）时结果导入为候选素材，可选的 `name` 是素材名。`provider: 'local'` 的合成（架构设计 §6.1）：模型是 `synthesize` 的本地模型包，模型描述的 `local` 说明声音方式、参考录音、描述词表、旋钮、读音标注与许可；声音在提交时决定并冻结——不指定时用内置音色（按 `language` 挑）或模型的默认说话人，`reference` 的文件与内置音色的录音读出摘要（`reference` 的文件读不出时 `invalid-request`，`details.code` 为 `INPUT_UNREADABLE`；内置音色的录音读不出是安装不完整，`conflict`，`APP_FILE_MISSING`；执行前再核对一次，用户的文件变了是 `ASSET_MISSING`，内置音色的录音不见了是 `APP_FILE_MISSING`），`library:<id>` 直接用音色库条目的参考录音（不需要在线克隆）；模型不支持的声音方式、不读原文的模型收到 `reference.transcript`、不在词表里的描述都以 `invalid-request` 拒绝，不换成别的声音；文本原样冻结，读音标注由引擎处理，念不了的照表面文字合成、在任务的 `warnings` 里逐条报 `reading-dropped`；输出是 WAV，进度单位是 `steps`。`provider: 'local'` 的生图（架构设计 §6.1）：模型是 `image` 的本地模型包；一次一张 PNG，尺寸只取模型描述列出的几档（`size` 或宽高比），提示词至多 1024 个码点，`steps`（去噪步数）在模型描述的 `local.steps` 范围内（Qwen-Image-2.1 为 8–40，默认 20），别的以 `invalid-request` 拒绝；`seed` 不给时在提交时抽一个冻结进 `generation`，给了 `steps` 时一并冻结；进度单位是 `steps`。在线 Provider 收到 `reference`、`voiceDescription`、`cfg` 或 `steps` 时以 `invalid-request` 拒绝。`provider` 为 `agent:codex` 时由本机已登录的 Codex 生成图片（架构设计 §6.9）：一次一张 PNG、同一时间只跑一个，尺寸、宽高比、seed、多于一张与别的格式在提交时以 `invalid-request` 拒绝。`capabilities` 是只读视图；`configure`（在线 Provider 的开关、端点、只写的密钥，`verify` 时先向供应商验证一次；智能体 Provider 只接受 `enabled`，没有密钥，配置视图的 `credential` 为 `none`）、`setDefault`（`providerId: null` 清除）与 `removeProvider`（自定义端点删除整个配置；目录里的提供方停用并删掉全部账号与凭据；指向它的默认值都保留）改模型服务配置（架构设计 §6.8）；`list` 与 `enable` 是本地模型包的状态与重新启用；`list` 的模型包状态带 `capability`（`transcribe`、`synthesize`、`image`、`separate` 或 `diarize`；`diarize` 是「说话人区分」模型包，装好之后识别模型包带上它的组件，`speakers` 流程也单独用它，架构设计 §6.3）、可选的 `label` 与 `license`（`{ name, url, commercialUse, summary }`，不可商用的模型包 `commercialUse: false`）、`estimatedBytes`（必需组件按内置清单的下载大小，装没装都给，供下载前显示体积；有组件没有登记清单时 null）、`components`（`{ component, repo, revision, state: 'installed' \| 'missing', bytes, estimatedBytes, sharedWith, optional?, license? }`；`bytes` 是装好的组件占的字节（没装时 null），`estimatedBytes` 是这个组件按内置清单的下载大小（装没装都给，没有登记清单时 null），供缺组件时显示要下多少；`optional: true` 的组件缺了不算不完整；`license` 是登记了自己许可的组件（对齐器、说话人模型）的许可，形状同模型包的 `license`，要署名的许可把署名写在 `summary` 里）、`install`（`{ jobId, state: 'queued' \| 'downloading' \| 'verifying' \| 'paused', receivedBytes, totalBytes }`，总数未知时 `totalBytes` 为 null；`paused` 是暂存区里留着没下完的部分，`jobId` 为 null）与 `selfTest`（最近一次检查：`{ state: 'passed' \| 'failed', jobId, at, detail?, code?, facts? }`，没通过时 `code` 是检查结论的代码、`facts` 是给技术详情的 `key: value` 行，见 §11.3 的 `MODEL_SELF_TEST_FAILED`），只缺一部分必需组件时 `reason` 为 `incomplete`。本地模型包的安装管理（架构设计 §6.3）：`install({ bundleId, confirmBytes?, commandId? })` 不带 `confirmBytes` 时只返回 `{ plan, jobId: null }`（`plan`：每个组件的 `action`（`keep` 或 `download`）、要下载的 `files` 与 `bytes`，`downloadBytes`（未知时 null）、`estimatedBytes`、`confirmBytes`、`resumedBytes`、`availableBytes`、`source`、`upToDate`），带上计划里的 `confirmBytes` 才提交 `kind: 'modelInstall'` 的任务，返回 `{ plan, jobId }`；字节数与新的计划不符以 `conflict`（`details.code` 为 `MODEL_INSTALL_SIZE_CHANGED`，带新的 `plan`）拒绝，严格离线以 `conflict`（`OFFLINE_STRICT`）拒绝，内置清单缺可信的哈希以 `conflict`（`MODEL_MANIFEST_INCOMPLETE`）拒绝；已经装好（`upToDate`）不提交，正在安装时返回那个任务。进度是 `progress.unit: 'bytes'`。`repair` 同 `install`，但核对每个文件的 sha256，只重下坏的与缺的。`cancelInstall({ bundleId, discard? })` 取消安装任务（等于暂停，暂存区保留，再次 `install` 续传），`discard: true` 时删掉暂存区，返回 `{ bundle }`。`remove({ bundleId })` 删除这个模型包独有的组件，返回 `{ removed, kept: [{ repo, usedBy }], bundle }`；有任务在用它时以 `conflict`（`MODEL_IN_USE`，`details.jobIds`）拒绝（「说话人区分」模型包看的是用它的识别模型包的任务）；删除之后，没有出厂默认的能力（`synthesizeSpeech` 等）里指向它的默认值清除（发 `capabilities.updated`），`transcribe` 与 `separateAudio` 的保留并报告为不可用（架构设计 §6.8）。`test({ bundleId, commandId? })` 提交 `kind: 'modelTest'` 的检查任务，返回 `{ jobId }`；「说话人区分」模型包没有单独的检查，以 `unsupported` 拒绝；模型包不可用时以 `conflict`（`MODEL_UNAVAILABLE`）拒绝，随应用分发的输入（识别与分离的样本、合成默认声音的内置音色录音）读不出来时以 `conflict`（`APP_FILE_MISSING`）拒绝；完成后 `result` 为 `{ documentId: null, artifactId }`（识别模型包是样本的识别结果，合成模型包是合成的那段 WAV，文生图模型包是画出的那张 PNG，分离模型包是分出的人声 WAV），结论记在模型包的 `selfTest`（判定规则见 Model Worker 协议规范 §4.3）。这五个方法不在 Web 服务的白名单里，MCP 对外服务也不提供。`generateText`（`messages`：`{ role: 'system' \| 'user' \| 'assistant', content }` 的数组；可选的 `responseFormat`：`{ type: 'text' }`（默认）或 `{ type: 'json', schema, name? }`，schema 以对象为根；可选的 `maxOutputTokens`、`effort`（`minimal`、`low`、`medium`、`high`）、`temperature`、`seed`）只由在线 Provider 提供，局域网节点不提供；`maxOutputTokens` 超过模型上限、模型不接受的 `temperature`、`seed` 或结构化输出、不合法的 schema 以 `invalid-request` 拒绝，输入按字符粗估明显超过上下文时同样拒绝，`details.code` 为 `INPUT_TOO_LONG`。完成后 `result` 为 `{ documentId: null, artifactId, text }`：产物是 `.txt` 或 `.json`；`text`（`TextJobResult`）带媒体类型、字节数、码点长度、前 2000 个码点的 `preview` 与 `previewTruncated`、`finishReason`（`stop`、`length`、`content-filter`）、`usage`（`inputTokens`、`outputTokens`，可为 null）、`modelVersion` 与 `notes`（推理强度换档或被忽略的说明）；`length` 时带 `output-truncated` 警告，结构化输出遇到 `length` 失败（架构设计 §6.4）。`synthesizeSpeech`、`generateImage` 与 `generateText` 另收可选的 `saveDir`（本机绝对路径，保存位置，架构设计 §7.9）：提交时建好目录、确认能写（不能写时 `conflict`（`OUTPUT_DESTINATION_UNAVAILABLE`），不建任务），冻结在任务里、不进输入摘要；产物发布之后在那里复制一份可读名字的副本（取原文、提示词或最后一条用户消息的开头至多 40 个字，清理规则同下载的文件名；多张图片依次加 `-1`、`-2`；同名时再加序号，不覆盖），路径记在 `result.outputs[].path`（`generateText` 写了副本时 `outputs` 有一项 `media.kind: 'text'` 的文本输出）。副本写不成不算失败：那一项没有 `path`，任务带 `save-copy-failed` 警告。不给 `saveDir` 时不写副本。`synthesizeSpeech` 与 `generateText` 另收可选的 `material { entryId }`（Space 条目作为素材，架构设计 §7.9）：只收文档（.txt、.md、.markdown，按文字解码）与字幕（.srt、.vtt，去掉时间码与行内标记、每条一行）条目，至多 4 MiB；Runtime 在方法层读出文字——`synthesizeSpeech` 当 `text`（这时 `text` 必须是空字符串），`generateText` 接在最后一条用户消息后面（空一行、先写文件名）——再按同一套参数规则检查，任务里只有文字。条目不在 `not-found`，在回收站里 `conflict`（`SPACE_ENTRY_TRASHED`），种类或格式不合（视频、PDF、ASS 等）或超过上限 `invalid-request`（`SPACE_ENTRY_UNSUPPORTED`），没有可读的文件 `conflict`（`SPACE_ENTRY_NO_FILE`），字幕读不准时带它的错误码（`SUBTITLE_FILE_INVALID` 等），都不建任务。`setCapabilityParameters({ capability: 'generateText', effort?, concurrency? })` 设能力参数的默认值，给出的替换、null 恢复默认（`effort` 为模型自己的默认，`concurrency` 为 4，范围 1–32），返回 `{ parameters }`；`capabilities` 在 `generateText` 下报告 `parameters`。`refreshProvider({ providerId })` 向 OpenAI、Google、ElevenLabs 或自定义端点取模型与音色列表，返回 `{ provider, refreshed }`，`refreshed` 为 `{ at, ok, models?, voices?, error? }`，也记在配置视图里；取不到时 `ok: false`，照旧用内置的列表；`local`、节点、智能体 Provider 与没有密钥或端点的在线 Provider 以 `invalid-request` 拒绝，未知的 `providerId` 是 `not-found`（架构设计 §6.8）。`transcribe` 可带 `diarize`（区分说话人，架构设计 §6.6）：不给时按模型，能力视图里转写模型的 `speakers` 是 `native`（模型自己区分，MOSS）或 `pack`（装了「说话人区分」模型包，Qwen3-ASR 与 Whisper）的区分，`none` 或没有这一项的不区分；Qwen3-ASR 与 Whisper 另带 `diarizationPack`（要用的「说话人区分」模型包的 `bundleId`，装没装都给），界面据此知道装上它就能区分；给 `true` 而模型不能区分时照常转写，任务带 `diarization-unavailable` 警告；`diarize` 进输入 hash。说话人进 `speech` 文档的 `speakers`，每个词带自己的说话人。`transcribe` 可带 `glossaries: [{ id, version? }]`（最多 20 张转写用术语表；不给时用视频里启用的转写术语表，`library.getVideoSelection`，对外服务不用）：模型接受提示时规范写法接在 `hint` 之后，不接受时忽略，任务记录的 `library.glossaryHint` 说明结果（架构设计 §5.9）。`synthesizeSpeech` 的 `voice` 可以是 `library:<音色 id>`：在线 Provider 在提交时换成这个音色在所选 Provider 上的有效克隆，没有时以 `VOICE_CLONE_REQUIRED` 拒绝；本地模型直接用条目的参考录音。模型目录（架构设计 §6.3）：`getDir {}` 返回 `ModelsDirInfo`（`path`、`source: 'env' \| 'setting' \| 'default'`、`defaultPath`、`exists`、`writable`、`usedBytes`、`freeBytes`、`modelCount`、`moveJobId` 与 `moveTo`（进行中的移动与它的目标，没有时 null））；`inspectDir { path }`（绝对路径，`null` 是缺省目录）只读地返回 `ModelsDirInspection`（`exists`、`writable`、`freeBytes`、`problem: 'missing' \| 'not-writable' \| 'nested' \| 'same' \| null`、`found` 与 `current` 各是认出的仓库、模型包与字节，`move { requiredBytes, sameVolume, fits }`）；`setDir { path, mode: 'move' \| 'switch', commandId? }` 返回 `{ dir, jobId }`：`switch` 与没有要搬的 `move` 立即换过去，`jobId` 为 null；否则提交 `modelsMove` 任务（阶段 `moving`、跨盘时 `validating`、`publishing`，`progress.unit: 'bytes'`）。设置 `models.dir` 只能经 `setDir` 改。这三个方法不在 Web 服务的白名单里，MCP 对外服务也不提供。API 提供方账号（架构设计 §6.8）：配置视图 `ProviderConfigView` 带 `accounts`（`ProviderAccountView[]`，按顺序：`accountId`、`label`（可为 null）、`masked`、`enabled`、可选的 `region` 与 `endpoint`、`addedAt`、可选的 `lastUsedAt`、`status { state: 'ok' \| 'invalid-key' \| 'rate-limited' \| 'quota-exhausted' \| 'unknown', at?, until?, detail? }`），从不带密钥；`credential`（`set`、`missing`、`none`）表示有没有至少一个启用且带密钥的账号。`addAccount { providerId, credential, label?, region?, endpoint?, verify? }`、`updateAccount { providerId, accountId, label?, credential?, enabled?, region?, endpoint?, verify? }`（给出的字段替换，`label: null` 清掉名字）、`removeAccount { providerId, accountId }` 与 `arrangeAccounts { providerId, order }`（`order` 是这个 Provider 全部 `accountId` 的一个排列）都返回 `ProviderView`（这个 Provider 的描述与配置视图），并发 `capabilities.updated`。删掉最后一个账号不移除 API 提供方，它仍然启用、`credential` 为 `missing`。`configure` 的 `credential` 仍然接受：有账号时替换第一个账号的密钥，没有时建一个 `main` 账号。拒绝：`local`、节点与智能体 Provider 以 `invalid-request` 拒绝；`region` 不在目录给这家提供方的取值里、`order` 不是全部账号的排列、空的 `credential` 都是 `invalid-request`；未知的 `providerId` 是 `not-found`，未知的 `accountId` 是 `not-found`（`details.code` 为 `ACCOUNT_NOT_FOUND`）；`verify` 不通过与凭据存储不可用见 §11.3。`usage { period: 'today' \| '7d' \| '30d' \| 'all', providerId? }` 只读，返回 `UsageReport`（`period`、`totals`、`byDay`、`byProvider`、`byCapability`、`byModel`、`byAccount`；金额按币种分开，分报告、估算与未知，形状见架构设计 §6.10）。`checkBalance { providerId, accountId? }`（P1）返回这个账号的余额（按币种）与查询时间，只支持开放了查询接口的 API 提供方，其余以 `invalid-request` 拒绝；失败用 §11.3 的 `PROVIDER_*`。账号的写方法与 `checkBalance` 不在 Web 服务的白名单里，`usage` 在；MCP 对外服务都不提供 |
| `jobs` | `list` `inspect` `cancel` `reconcile` `resources` | 步骤状态、取消、对账；没有 Task 的 Job 与固定流程同样适用（架构设计 §7.9）。`list { videoId?, children? }` 默认不列固定流程的步骤（带 `parentJobId` 的子 Job），`children: true` 时一并列出；取消父 Job 先停止启动新的步骤，再取消在跑的子 Job。记录的 `submitter` 是提交它的主体：`connection`（本机连接）、`system`（Runtime）、`node`（经节点服务提交的远端任务，`id` 为发起端的 `clientId`）、`agent`（会话里的智能体经工具提交，`id` 为会话 ID，另带提交时的 `taskId`）或 `service`（经对外服务提交，`id` 为服务，另带 `clientId`；客户端只看得到自己提交的任务）。用到用户库的任务带 `library`：`entries` 是冻结的条目（`library`、`id`、`version`、`contentHash`），转写另有 `glossaryHint`（`status`：`sent`、`unsupported`，`terms`，`dropped`）。视频的转写（`kind: 'transcribe'`）带 `transcribe { language, diarize }`：提交时定下的语言（规范化后的 `LanguageRequest`）与生效的说话人区分（请求没给时按模型定下的值），会话视频卡上那一行模型与参数据此显示（产品设计 §3.2.2）；远端与只给文件的转写、之前的记录没有。交给在线或智能体 Provider 的任务带 `grant`（`JobGrantUse`）：`grantId`、接纳时的 `generation`、`reservationId`、`budgetMode`、外发的 `dataKinds`、`reserved { calls, amount }`、`settled { calls, amount, basis, at }`（`basis`：`reported`、`estimate`、`unknown`、`conservative`、`released`；进行中为 `null`）与自动重试之前几次的结算 `retries`（架构设计 §7.8）。`models.*` 的提交在接纳不通过时以 `GRANT_REQUIRED`、`GRANT_REVOKED`、`BUDGET_EXCEEDED` 或 `BUDGET_UNVERIFIABLE` 拒绝，不创建任务；`pipelines.start` 在开始之前同样检查翻译要用的授权。记录带 `applications`（`ApplicationRecord[]`，每次把结果写进视频的一条应用：`state` 为 `pending`、`validating`、`committed`、`stale-input`、`rejected` 或 `cancelled`，带 `commandId`、`baseVideoRevision`、`receipt { transactionId, videoRevision, refs, recovered? }` 与 `error`），以及取消的三件事实 `cancellation { requestedAt, localStoppedAt, remote, cost }`（架构设计 §7.1–§7.4）。`state` 多一种 `needs-reconciliation`：交给在线或智能体 Provider 的调用在 Runtime 停止或崩溃时结果不明，不再执行。`reconcile { jobId, decision }`（`retry`、`discard`、`apply`）返回处理之后的记录，合法的状态见架构设计 §7.5。不合法时 `conflict`（`details.code: RECONCILE_NOT_ALLOWED`，带 `state`、`decision`、`allowed`）；`retry` 与 `apply` 要视频已经打开（`not-found`，`VIDEO_NOT_OPEN`）；`apply` 查不了上次的回执时 `busy`（`RECEIPT_UNKNOWN`）。智能体与 MCP 服务没有对应的工具；Web 服务开放，只读时拒绝（`WEB_READ_ONLY`）。CLI：`baocut jobs reconcile <jobId> retry|discard|apply`。排队中的任务（与固定流程在等准入的步骤及其父任务）带 `wait { reason, dimensions?, ahead?, detail, since }`：`reason` 为 `concurrency`（队列的并发满了）或 `resources`（峰值需求放不下，`dimensions` 是缺的维度：`memory`、`gpuMemory`、`cpuThreads`、`scratchDisk`），开始执行或结束时去掉（架构设计 §7.6、§7.7）。`resources {}` 只读，返回 `ResourcesSnapshot`：`capacity`（四个维度的字节或线程数，未知为 `null`；`unifiedMemory`；每个维度的来源 `system`、`setting`、`unified-estimate`、`statfs`、`unknown`）、`reserves { system, interactive }`、`leased`、`available { interactive, background }`、`leases`、`holders`（共用进程，带 `users` 与 `processes`）与 `waiting`；Web 服务开放，CLI `baocut jobs resources` |
| `pipelines` | `list` `start` `retry` | 固定流程（架构设计 §7.9），执行主体是 `system:pipeline`，不创建智能体会话。`list` 返回 `{ pipelines }`，每项是名字、给人看的名字、说明、步骤（`name`、`label`、`optional`）与参数的 JSON Schema。`transcribe` 与 `translate` 建字幕层时可给 `params.captionStyle`（视频格式规范 §5.6 Studio 样式文档的 `schema` 与对象 `style`）；只新建时套用，已有共用样式保留，参数在提交时冻结；关掉字幕或只转录文件时不可给。`start { pipeline, params, commandId? }` 校验并冻结参数、检查前提，返回父 Job 的 `{ jobId }`；同一个 `commandId` 返回同一个任务。Space 条目作为文件输入（架构设计 §7.9）：`transcribe` 的 `file`、`transcode` 的 `inputs[]` 与 `translate-subtitles` 的 `input` 可以是 `{ entryId }`，`pipelines.start` 在提交时按 Space 目录换成条目的文件（来源目录里的文件、产物或保存位置里的结果），冻结的 `params` 里只有路径；媒体输入收视频文件、成片与音频条目，字幕输入收字幕条目。条目不在 `not-found`，在回收站里 `conflict`（`SPACE_ENTRY_TRASHED`），种类不合（含视频条目）`invalid-request`（`SPACE_ENTRY_UNSUPPORTED`），没有可读的文件（占位、缺失）`conflict`（`SPACE_ENTRY_NO_FILE`），都不建任务；不经 `pipelines.start` 直接交给流程的 `{ entryId }` 以 `invalid-request` 拒绝。未知的流程是 `not-found`，参数不合是 `invalid-request`，前提不满足在提交时拒绝、不创建任务：文本模型没有配置是 `CAPABILITY_NOT_CONFIGURED`，ffmpeg 不可用是 `MEDIA_TOOL_UNAVAILABLE`（都在 `RpcError.details.code`，`RpcError.code` 为 `conflict`）。`retry { jobId }` 让失败、取消或中断的流程从停下来的那一步继续，返回同一个 `{ jobId }`；其他状态以 `JOB_NOT_RETRYABLE` 拒绝（`conflict`）。视频工具（`translate`、`dub`、`link-import`、`transcribe`）的视频由 `target` 给出（`PipelineVideoTarget`）：`{ videoId }`（已打开的视频）、`{ entryId }`（Space 里的视频条目，不要求已打开）或 `{ create: { projectId, name?, media? } }` / `{ create: { conversationId, name?, media? } }`（新建视频，`projectId` 与 `conversationId` 给且只给一个：在项目里，或在会话的来源目录里——会话属于项目时是那个项目，否则是会话的工作目录、登记在会话范围；会话不存在 `not-found`；只有 `link-import` 与 `transcribe` 接受：`link-import` 不收 `media`，`transcribe` 必须给 `media`（本机媒体文件的绝对路径）；`translate`、`dub` 以 `invalid-request`（`PIPELINE_TARGET_UNSUPPORTED`）拒绝）。顶层的 `videoId` 仍然有效，等同 `target: { videoId }`；两者都给而指的不是同一个视频、或 `create` 与 `videoId` 同给时 `invalid-request`。`entryId` 在提交时解析，并以 Runtime 的租约打开视频（与重启恢复同一条路径；别的连接已经打开着时接上那一份），租约持有到流程完成、失败或取消，之后没有别的打开者时按宽限期关闭；条目不存在是 `not-found`，不是视频 `invalid-request`（`SPACE_ENTRY_NOT_VIDEO`），在回收站里 `conflict`（`SPACE_ENTRY_TRASHED`），被别的进程锁着 `conflict`（`VIDEO_LOCKED`），都不创建任务、不留下东西。这几个流程的第一步是 `target`（解析目标）：`entryId` 时记为完成，产出 `{ entryId, videoId, place }`，别的目标记为 `skipped`。`retry` 先按记下的位置重新打开流程持有的视频（被锁时同样以 `VIDEO_LOCKED` 拒绝，位置上已经不是原来的视频时 `conflict`（`STALE_JOB_INPUT`）），再从停下的那一步继续。父 Job 的记录是 `kind: 'pipeline'`，带 `pipeline`：`name`、冻结的 `params`、`steps`（每一步的 `name`、`label`、`status`（`pending`、`running`、`completed`、`skipped`、`failed`、`cancelled`、`interrupted`）、最近一次的子 Job `jobId`、执行次数 `attempts` 与产出 `output`）、在跑的步骤序号 `current`、停下来的步骤 `stoppedAt` 与完成时的 `summary`；进度单位是 `steps`，`calls` 是在跑的那一步的模型调用计数（`calls`、`retries`、`failures`）。子 Job 是 `kind: 'pipeline-step'`，带 `parentJobId` 与 `step`（`pipeline`、`name`、`label`、`index`），`submitter` 为 `{ kind: 'pipeline', id: <父 Job> }`；逐句的步骤进度单位是 `units`。失败时父 Job 的 `error.details.step` 是失败的那一步。首批流程：`transcode`（`inputs` 为绝对路径、`action` 为 `compress`、`merge` 或 `extract-audio`（逐个取出音轨：AAC、MP3、Opus、FLAC 流复制进 `.m4a`、`.mp3`、`.ogg`、`.flac`，其余重新编码为 AAC `.m4a`；没有音频轨的输入以 `TRANSCODE_NO_AUDIO` 失败；输出的 `media` 是 `audio`）、可选的 `codec`（`h264`、`hevc`）、`maxHeight`、`crf` 或 `videoBitrateKbps`、`audioBitrateKbps`、`outDir`（不给时是 Runtime 的保存位置：设置 `downloads.directory`，没有设置时主机的下载文件夹，提交时冻结进 `params.outDir`；不存在时创建，不能写入时以 `conflict`（`OUTPUT_DESTINATION_UNAVAILABLE`）拒绝、不建任务，发布前目录被挪走或改了权限时那一步以同一个错误码失败）；`summary` 是 `action`、`mode`（`stream-copy`、`re-encode`）、`reason`、`executor { tool, version, commands }` 与 `files`，`result.outputs` 的每项带输出文件的绝对路径 `path`，`providerId` 为 `ffmpeg`、`modelId` 为它的版本）与 `translate`（`videoId` 或 `target`、`targetLanguage`、可选的 `documentId`、`style`、`glossary`（`{ source, target, note? }` 的数组）、`glossaries`（库里的翻译用术语表 `{ id, version? }`，最多 20 张）、`provider`、`model`、`batchSize`（照收、不再使用：分页归字幕与翻译核心）、`captions`（默认 `false`）、`bilingual`（默认 `false`，只在 `captions: true` 时可以给，否则 `invalid-request`）；`summary` 是新文档的 `documentId`、源文档与版本 `source`、`targetLanguage`、`unitCount`、`providerId` 与 `modelId`，用了术语表时另有 `glossary`（`TranslateGlossaryUse`：`entries[] { id, version, contentHash, name, origin }`，`origin` 为 `explicit` 或 `video`；视频启用而没用的 `skipped[] { id, reason }`，`reason` 为 `removed` 或 `language`；去重之后的条数 `terms`；沿用的 `cappedBatches`（术语不再按批截断，总是 0）），以及字幕层 `captions`（`PipelineCaptionsSummary`，见下；没有这一步的旧记录没有），`result.documentId` 是新文档）。翻译每次执行都新增一份 `translation` 文档，不替换已有的。`write` 之后的一步 `captions` 在 `captions: true` 时建立目标语言的字幕层（不给或 `false` 时 `skipped`，与没有这一步时一样；流程参数默认不建，工具入口（工具目录里 `translate-subtitles` 的视频输入在 `execution.params` 里带上）、CLI 与编辑器的「翻译成…」（连同 `bilingual`）带上 `captions: true`）：一笔事务写一份 `caption` 文档（`extensions.pipeline` 记下这次运行）并在根序列上放一个字幕实例；只看译文时把配对的原文字幕层停用（不删），`bilingual` 时两层共用一份字幕样式、原文放回画面；同一份译文已有字幕层时 `skipped`。加这一步之前的流程记录重试时，新的这一步按 `pending` 补做，按冻结的参数决定（旧参数没有 `captions`，所以跳过）。`PipelineCaptionsSummary` 是 `status`（`created`、`existing`（已有，`documentId` 是已有的那份）、`disabled`、`not-on-timeline`（时间线上没有取用这个素材的片段，告警 `CAPTIONS_NOT_ON_TIMELINE`）、`empty`（切不出字幕条，告警 `CAPTIONS_EMPTY`））、`documentId`、`cueCount`、`enabled`（新建的一层是否显示）、译文的 `bilingual` 与 `transactionId`（`created` 时建字幕层的那笔事务，按它 `videos.undo`）。术语依次来自 `glossary`、`glossaries` 与视频里启用的翻译用术语表，库里的表在启动时冻结版本、固定到流程结束（父任务的 `library.entries`），译文的 `glossaryRef` 记下用的版本与出现过的术语（视频格式规范 §5.3，架构设计 §7.9）；`glossaries` 里的表不在库里是 `not-found`，转写用的、语言不符或重复是 `invalid-request`（`LIBRARY_ENTRY_NOT_APPLICABLE`），都不建任务。第三个流程 `link-import`（架构设计 §7.9）：`url`、可选的 `projectId`、`conversationId`、`videoId` 或 `target`、`audioOnly`、`subtitleLanguages`（语言代码，最多 10 个）、`transcribe`（可直接转录为 TXT/SRT）、`cookieBrowser`；转写的 `language`、`provider`、`model`、`hint` 只与 `transcribe` 一起给，`diarize` 与 `captions`（默认 `false`，转写之后建字幕层）还要有视频目标，否则 `invalid-request`，含义与 `transcribe` 流程的同名参数相同（Provider 与模型提交时冻结，转进视频时套用视频里启用的转写术语表）；不给视频目标时下载文件并可选转录。`target.create` 时在 `create.projectId` 的项目或 `create.conversationId` 的会话来源目录里新建可编辑视频，下载位置独立；同时给的顶层 `projectId`、`conversationId` 要与它一致，否则 `invalid-request`；`transcribe` 可以只配 `create`。链接不合规在提交时以 `invalid-request`（`LINK_UNSUPPORTED`、`LINK_PRIVATE_ADDRESS`）拒绝，yt-dlp 未安装、过旧、不能运行或没有同意以 `conflict`（`TOOL_*`）拒绝，严格离线以 `conflict`（`OFFLINE_STRICT`）拒绝。冻结的 `params.url` 是脱敏的链接，原始链接只按 `params.sourceRef` 引用；步骤是 `target`、`resolve`、`download`（进度单位 `bytes`）、`verify`、`publish`、`create`（`target.create` 时：与 `videos.create` 同一条路径在项目或会话的来源目录里新建视频，名字默认取页面标题，流程持有它的租约；完成之后重试不再新建，之后的步骤失败时视频保留）、`import`（有视频目标时；新建的视频在同一笔事务里把素材放上主轨，从 0 开始、覆盖整段媒体）、`transcribe`（`transcribe` 时）、`captions`（`captions` 时，与 `transcribe` 流程同一步；没有放上时间线或已有同一份文稿的字幕层时跳过）；`summary` 是 `url`、`title`、`platform`、`uploader`、`durationSec`、`description`（页面简介，截到 1200 个字符、截了时末尾加「…」，没有时 null；完整的最多 20000 个字符记在素材来源的 `source.description`，视频格式规范 §4.5）、`sourceChapters`（平台给的结构化章节的条数，没有时 0，简介里的时间戳大纲不算；之前的版本没有这两个字段）、`files { media, subtitles }`、`tool { name, version, source }`、`downloadedAt`、`videoId`（新建时是新视频）、`assetId`、`createdVideo`（新建了视频时为 `true`）、`transcribeJobId`、`transcriptFiles`（独立转录时）、`documentId`（转进视频时写入的 speech 文档）、`captions`（`captions` 时，同 `transcribe` 流程的 `summary.captions`），`result.outputs` 带下载的媒体文件及可选 TXT/SRT；媒体的 `artifactId` 是下载目录里那个文件的内容摘要（不进产物库），只下载之后智能体可以用它经 `edits_apply` 的 `importAsset` 导入（文件不在或改过时 `ARTIFACT_NOT_FOUND`）。新建的视频在 Space 里的 `origin` 是这次运行（`source: 'imported'`、`jobId`、`capability: 'link-import'`；智能体提交时带会话与任务）。第四个流程 `dub`（翻译配音，架构设计 §7.9）。参数（`DubParams`）：`videoId`（或 `target`，同上）；`targetLanguage` 与 `translationId` 至少给一个；可选的 `documentId`、`voice`、`provider`、`model`；缺译文时翻译用的 `textProvider`、`textModel`、`style`、`glossary`、`glossaries`、`batchSize`（给了 `translationId` 时以 `invalid-request` 拒绝）；`originalAudio`（`duck`、`mute`、`keep`，默认 `duck`）、`duckDb`（1–60，默认 18）与 `separateBackground`（`keep` 时不分离，冻结为 `false`）。分离成功后 `apply` 把转写来源上、正在发声的原句实例静音（记进配音计划的 `mutedItemIds`），在新轨「背景声（<语言>）」上同位置放分离出的背景声，不压低；`duck` 另建「人声（<语言>）」轨放人声，闪避以这条轨为目标（视频格式规范 §7.2）。提交时的拒绝：`library:<id>` 没有有效克隆时 `VOICE_CLONE_REQUIRED`；外发（合成与缺译文时的翻译，数据种类都是 `transcript`）没有覆盖的授权时 `forbidden`（`GRANT_REQUIRED` 等）；语音合成的 Provider 启用时的默认授权不含 `transcript`，配音被拒时 `details.remedy` 的 `hint` 说明这一点与发放之后重新执行，`commands` 是要执行的 `baocut grants create --recipient <Provider> --data transcript --video <videoId> --purpose "<用途>"`；几种外发都缺时一次拒绝列出全部，桌面界面的拒绝另带待批准的项（`pendingGrants`，§11.3）。音色：视频里给这份转写的说话人绑定的（`library.setVideoSelection` 的 `speakerVoices`）优先，其次 `voice`，最后模型的默认音色；绑定的音色在 `synthesize` 这一步检查，不可用（`VOICE_CLONE_REQUIRED`、`VOICE_CONSENT_REQUIRED`、`VOICE_NOT_FOUND`）时那位说话人的句子不合成、逐句报告，告警 `DUB_VOICE_UNAVAILABLE`，不换成别的音色；一句都合成不了时这一步以那个错误码失败。步骤是 `freeze-source`、`translate`、`assemble`、`write`（这四步只在缺译文时执行），之后是 `check-translation`、`separate`（只在要求分离、原声不是 `keep`、而且选得出分离模型包时执行，否则 `skipped`；提交时冻结 `separatorModel`，执行时它不可用是 `CAPABILITY_NOT_CONFIGURED`）、`synthesize`（每句一个子 Job，进度单位 `units`）、`align`、`apply`。`summary`（`DubSummary`）包括 `videoId`、`language`、`translation { documentId, revision, created }`、`planDocumentId`、`trackId`、`groupId`、`units { total, placed, stale, offTimeline, tempo, extended, overlong, voiceUnavailable }`、`staleUnits`、`overlongUnits[] { unitId, overflowSeconds }`、`voiceUnavailableUnits[] { unitId, speakerId, voice, code, reason }`、`speakers[] { speakerId, voice, voiceSource, available, units }`（`voiceSource`：`video`、`params`、`default`）、缺译文时翻译用到的术语表 `glossary`（同 `translate`）、`synthesis { providerId, modelId, voice, calls, retries, failures, reused }`、`originalAudio`，以及 `separation`（`completed`、`not-requested`、`not-configured`）。`result.documentId` 是配音计划。句级重配：`dub` 的参数 `regroup { groupId, units, seed? }`（`DubRegroup`）只重新合成已有一组配音里的这几句（`units` 是译文单元 ID，1–200 个、不重复），写回原来那一组：同一条配音轨、同一份配音计划的新版本，不新建一组、不动别的句子与原声的处理；不给 `regroup` 时行为不变。译文、语言、Provider、模型与音色都取自这一组的配音计划（用了视频里说话人绑定的句子照计划记下的音色），所以同时给 `translationId`、`targetLanguage`、`documentId`、`voice`、`provider`、`model`、翻译用的参数、`originalAudio`、`duckDb` 或 `separateBackground` 以 `invalid-request` 拒绝（`details.conflicting`）；文本读译文的当前版本，所以「改译文并重配」是先写译文文档的新版本、再以 `regroup` 只重配这几句。`seed` 是 `'new'`（默认，提交时随机取一个）或 0–4294967295 的整数；模型不接受种子时 `'new'` 记为 `null`、给数字以 `invalid-request` 拒绝。提交时的拒绝：这一组没有配音计划或在时间线上已经没有实例是 `invalid-request`（`DUB_GROUP_NOT_FOUND`），句子不在计划或译文里是 `invalid-request`（`details.missing`）；授权与 `dub` 相同（外发只有合成一项，桌面界面带 `pendingGrants`）。冻结的 `pipeline.params.regroup` 是 `FrozenDubRegroup { groupId, units, planDocumentId, trackId, seed }`，界面据此知道哪几句在重配。步骤同 `dub`（翻译三步与 `separate` 跳过），`check-translation` 只核对这几句，`align` 的时间窗仍按全部句子算；`apply` 在一笔事务里导入新音频、删掉这几句在这一组里的旧实例、在原来的配音轨上放新的（保留旧实例的音量与静音，速率回到 1）、以 `putDocument { documentId }` 写配音计划的新版本（`summary` 重新计数，`groupId` 不变）；合成了却放不下的句子不删旧的那一版。每句的版本记在计划单元的 `extensions['baocut.dub'].takes[]`（`DubPlanTake`：`k`、`seed`、`artifactId`、知道时的 `assetRef`、`samples`、`sampleRate`、`fit`、`tempo`、放不下时的 `overflowSeconds`、`text`、`jobId`、`at`），当前版本是同一处的 `take`（与 `seed`）；旧计划没有版本时，已经放上的那一版补记为第 1 版并记下它的素材；放上的新版本成为当前版本，实例的 `extensions['baocut.dub']` 也带 `take` 与 `seed`。切换版本由客户端在一笔可撤销的编辑里完成：删掉这句的实例、用那一版的 `assetRef`（引擎不回收素材；不知道时按素材 `provenance.source.artifactId` 找）放回原处、写计划的新版本（`take` 改成那一版）。完成时 `summary` 另有 `regroup { seed, units[] { unitId, status, take, seed } }`（`DubRegroupSummary`，`status`：`replaced`、`overlong`、`stale`、`voice-unavailable`、`off-timeline`），`groupId`、`trackId`、`planDocumentId` 是原来那一组的，`units.total` 是重配的句数。第五个流程 `translate-subtitles`（字幕文件的翻译，架构设计 §7.9）：文件到文件，不碰视频。参数（`TranslateSubtitlesParams`）：`input`（`.srt` 或 `.vtt` 的绝对路径）、`targetLanguage`，可选的 `sourceLanguage`、`style`、`glossary`、`glossaries`（同 `translate`；没有视频，不用视频里启用的术语表）、`provider`、`model`、`batchSize`、`format`（`srt`、`vtt`，默认与输入相同）、`bilingual`（默认 `false`，原文在上、译文在下）与 `outDir`（默认保存位置，见下；不存在时创建，不能写入时 `conflict`（`OUTPUT_DESTINATION_UNAVAILABLE`），不建任务）；不收 `videoId`、`target`。提交时严格解析，读不准的文件不建任务：文件不在是 `not-found`，格式不合是 `invalid-request`（`SUBTITLE_FILE_INVALID`，`details` 带 `file`、`line`、`problem`），超过上限是 `invalid-request`（`SUBTITLE_FILE_TOO_LARGE`）；上限是文件 4 MiB、10000 条，每条的文本最多 1000 字（超过算格式不合）。容忍 BOM、CRLF、UTF-16 与 GBK 编码、WebVTT 的文件头、cue settings 与 NOTE / STYLE / REGION 块、多行文本与样式标签；拒绝缺时间行、时间倒置、分秒越界、正文里的 `-->` 与没有一条有文本的文件。外发的数据种类是 `transcript`，接收方是文本模型的 Provider，没有视频（`videoId: null`），授权的拒绝与 `translate` 相同（`remedy`；桌面界面另带 `pendingGrants`）。步骤是 `read`（读取字幕，源文件的大小或修改时间变了时重试重新读取）、`translate`（按批翻译，每批的条数与 id 要对得上，不对时有界重发，仍不对是 `MODEL_OUTPUT_INVALID`）、`check`（写出再读回来核对：条数与每条的起止时间不变，同一格式时时间行逐字不变，送去翻译的条都有译文；不符是 `MODEL_OUTPUT_INVALID`，`details.problems`）与 `publish`。每条只换文本，不合并、不拆分；同一格式保留原来的序号、时间行、cue settings 与 WebVTT 的块，换格式时重写时间，WebVTT 转 SRT 丢掉的 cue settings 与块计数并告警 `SUBTITLE_SETTINGS_DROPPED`；行内标记（斜体、颜色、位置）不保留，告警 `SUBTITLE_MARKUP_STRIPPED`；空文本的条照原样留空、不送去翻译。输出是 UTF-8、LF、没有 BOM，发布为 `<原文件名去掉扩展名>.<目标语言>[.bilingual].<格式>`，不覆盖已有的文件（同名时加 `-2` 等后缀）。`summary`（`TranslateSubtitlesSummary`）是 `source { path, format, contentHash }`、`file`、`format`、`bilingual`、`targetLanguage`、`sourceLanguage`、`cueCount`、`translatedCount`、`markupStripped`、`droppedSettings`、`droppedBlocks`、`providerId`、`modelId` 与用到的 `glossary`；`result.outputs` 是发布的字幕文件（`media.kind: 'text'`、`entries` 是条数），在 Space 里是来源为生成的条目（`capability: 'translate-subtitles'`）。第六个流程 `transcribe`（转录，架构设计 §7.9），与 `models.transcribe` 提交的转写 Job 同名、不是一回事：它是父 Job，「转写」一步提交一个 `transcribe` Job（`submitter` 为这个流程）。参数（`TranscribeParams`）：`videoId` 或 `target`（`{ videoId }`、`{ entryId }`、`{ create: { projectId, name?, media } }`）、可选的 `assetId`、`language`（断言语言）、`hint`（识别提示，最多 1200 字，视频里启用的转写术语表照样并进去）、`provider`、`model`、`diarize`（区分说话人，同 `models.transcribe`，不给时按模型）、`captions`（默认 `true`），以及只配 `{ videoId }`、`{ entryId }` 目标、只在目标视频已有 `speech` 文档时起作用的 `destination`（`'new-video' | 'replace'`，默认 `'new-video'`；工具与 CLI 叫 `target`）、`name`（新建视频的名字，默认「<原名> · 重新转录」，只用于 `new-video`）、`translations`（`'carry' | 'discard'`，默认 `'carry'`，只用于 `replace`）与 `acceptEdited`（`true` 越过手工修改闸门，架构设计 §6.6）；配别的目标给了它们是 `invalid-request`。`destination: 'replace'` 而当前文稿的全文指纹与 `stages.asr`（视频格式规范 §5.5）不符、又没给 `acceptEdited` 时 `conflict`（`TRANSCRIPT_EDITED`），不建任务。提交时选定并冻结 Provider 与模型（没有配置时 `conflict`（`CAPABILITY_NOT_CONFIGURED`）），`media` 不是绝对路径时 `invalid-request`，文件不存在时 `not-found`（`INPUT_NOT_FOUND`），都不建任务。外发的数据种类是 `audio`，接收方是转写模型的 Provider：启动（与重试）前先判断授权与额度，不够时的拒绝与 `translate` 相同（`remedy`；桌面界面另带 `pendingGrants`，`target.create` 时项里的 `videoId` 为 `null`），不新建视频、不建任务；「转写」一步提交的 Job 照常预留与结算。转写套用视频里启用的转写术语表（与 `models.transcribe` 相同：提交转写时读出，库里删掉的或种类不符的跳过，版本由转写 Job 冻结；新建的视频此刻已采用库里默认启用的；对外服务的客户端启动的不套）。步骤是 `target`、`create`（`target.create` 时：在项目里新建视频，名字默认取文件名，`media` 以链接素材导入（文件留在原处）并在同一笔事务放上主轨；新视频在 Space 里的 `origin` 是 `file-import`，带文件路径与这次运行；目标视频已有文稿而 `destination` 是 `new-video` 时同样执行，在原视频所在的项目或会话来源目录里新建，以链接方式导入目标素材的文件，之后的步骤对新视频做）、`transcribe`（提交转写 Job 并等它完成；Job 自己把新的 `speech` 文档应用到视频，所以没有单独的 `apply` 一步；`replace` 时这次应用就是换用文稿的一笔事务，应用前再查一次手工修改闸门，文稿在提交之后又被改了时这一步以 `TRANSCRIPT_EDITED` 失败）、`captions`（规则同 `translate`，给新的文稿建字幕层；`transcribe` 的 `captions` 默认 `true`；`replace` 时字幕层已在换用的事务里重新切过，按已有字幕层跳过）。不给 `assetId` 时取根序列主轨（`order` 最小、有音视频片段的画面轨，没有时音频轨）上的素材：不止一个时这一步以 `TRANSCRIBE_ASSET_AMBIGUOUS` 失败（`details.assetIds`），没有时 `TRANSCRIBE_ASSET_NOT_FOUND`。视频已有文稿时按 `destination` 新建视频或换用文稿，不在同一部视频里新增第二份；没有文稿的视频两种都直接写进它。这个素材已有原文字幕层显示着时，新的一层停用放上去（`enabled: false`）。重试不多出视频、素材或转写：新建认回上次占下的目录，导入按回执，转写认回这次运行提交过的、还在跑或已完成（文档还在）的 Job；每次重试提交的转写 Job 用新的 `commandId`。`summary`（`TranscribeSummary`）是 `videoId`（`new-video` 新建了视频时是新视频，`result.documentId` 也在它里面）、`createdVideo`（`target.create` 或 `new-video` 新建了视频时为 `true`）、`assetId`、`transcribeJobId`、`documentId`、`language`、`providerId`、`modelId`、`speakerCount`（新文稿区分出的说话人数，没区分时 0，读不出时 null）、`captions`、`target`（`'new-video' | 'replace' | 'first'`；`first` 是原来没有文稿、直接写进去）、`newVideo?: { videoId, name }`、`replaced?: { documentId, previousVersion, transactionId }`（换用前的文稿版本与那笔可撤销的事务）、`translations: Array<{ language, kept, keptReviewed, stale, unmatched }>`（`unmatched` 是新句没配上的数）、`captionPins: { reanchored, orphaned }` 与 `dubs: Array<{ language, kept, stale }>`（后三项是换用回执的 `impact`，没换用时为空或 0）；`result.documentId` 是新的 `speech` 文档、`result.artifactId` 是转写 Job 的产物。流程新建的视频，`origin` 在 Job Ledger 修剪掉这次运行之后照样在（`link-import` 同）。只给文件（`TranscribeFileParams`）：不给 `videoId`、`target`，给 `file`（本机媒体文件的绝对路径，或 `{ entryId }`：Space 里有文件的条目，由 `pipelines.start` 在提交时换成文件路径，规则见下文的 Space 条目输入）与可选的 `outDir`、`language`、`hint`、`provider`、`model`；`assetId`、`captions`、`diarize` 与 `file` 同给时 `invalid-request`，`outDir` 只在给 `file` 时可以给。`outDir` 不给时是 Runtime 的保存位置（同 `transcode`），提交时冻结，不存在时创建，不能写入时 `conflict`（`OUTPUT_DESTINATION_UNAVAILABLE`），文件不在时 `not-found`（`INPUT_NOT_FOUND`），都不建任务。只有 `transcribe` 一步（其余步骤 `skipped`）：提交一个没有视频的转写 Job 并等它完成，把 `<源文件名>.txt` 与 `.srt` 独占写入输出目录，重名时两个文件一起换成 `<源文件名>-2` 等同一个序号；重试认回这次运行提交过的转写，已有内容正是这一份的文件照样认领，不覆盖用户改过的文件。`summary`（`TranscribeFileSummary`）是 `file`、`files`、`transcribeJobId`、`language`、`providerId`、`modelId`；`result.outputs` 是两个文本输出（带 `path`），`result.documentId` 为 `null`。有输出的这种运行在 Space 里与文件到文件的流程一样成条（`capability: 'transcribe'`），给了视频的转录不留产物条目。`baocut translate`（视频输入）默认建字幕层：显式传 `captions: true`，`--no-captions` 时传 `false`；另有 `--bilingual`（字幕文件的翻译不收 `--no-captions`）。第七个流程 `speakers`（识别说话人，架构设计 §6.6）：给视频里已有的一份转写按声纹重新区分说话人，不重新转写、不改视频。参数（`SpeakersParams`）：`videoId`（已打开的视频）与可选的 `documentId`（`speech` 文档；视频里只有一份时可以不给）。提交时冻结文稿与版本、它的素材和这台机器上的「说话人区分」模型包；拒绝、不建任务：视频没打开 `not-found`，文稿不属于视频里的素材 `invalid-request`，没有这个模型包或还没装好 `conflict`（`MODEL_UNAVAILABLE`，没装好时 `details.bundle` 是模型包状态，界面据此提供下载）。步骤是 `diarize`（区分：模型包单独加载，整条音轨与转写的词时间交给 Model Worker 的 `diarize`（Model Worker 协议规范 §2.5.5），子 Job 的阶段依次是 Worker 报的 `decoding`、`diarizing`、`finalizing`，再是 Runtime 核对结果的 `validating` 与存产物的 `finalizing`；结果存成产物）与 `propose`（整理：按重叠时长复用已有的说话人，保留 ID 与名字，复用不上的新建；试算一次应用，得出句数、试听片段与会重切的译文条数，提案存成产物）。执行时视频关了或转写已经不在视频里是 `STALE_JOB_INPUT`，转写没有词、有没有时间的词或素材的源文件找不到是 `INPUT_UNREADABLE`（识别期间文稿又改过不在这里拒绝，应用时核对）。`summary`（`SpeakersSummary`）是 `videoId`、`source { documentId, revision }`、`timescale`（片段时间的单位，同转写）、`speakers[]`（`ProposedSpeaker`：`id`、`name`、`isNew`、`words`、`seconds`、`sentences`、`clips[] { sentenceId, start, end, text }`，片段是 `timescale` 下的素材时间）、`relabeled`（换了说话人的词数，0 时应用只改名字）、`translationsSplit`（应用时按新边界重切的译文条数，各语言相加）、`skippedTranslations`（不是当前格式、不重切的译文份数，它们的句子会对不上、标为过期）、`proposalArtifactId`、`bundleId` 与 `diarizeMs`。流程完成后由 `edits.applySpeakers` 应用（见 `edits`），不应用就什么都不改。`pipelines.*` 不在 Web 服务的白名单里，MCP 对外服务不开放 `pipelines.*`，从链接导入只经 `download` 与 `transcribe` 给 `url`（落点见架构设计 §4.8），翻译配音经一级动词 `dub` 一步提交整条流程（Agent 面设计 §4.2，工具桥与 MCP 都有）；不提供识别说话人，智能体也没有识别说话人的工具 |
| `tools` | `list` `candidates` | 工具目录与候选输入（架构设计 §7.9），类型在 `@baocut/protocol` 的 `tool-catalogue.ts`。工具不是另一套执行机制：每个工具对应一个固定流程（`pipelines.start`）或一种直接提交的任务（`models.*`）。`list {}` 返回 `{ tools: ToolStatus[], saveDirectory? }`（`saveDirectory` 是解析好的保存位置，本机绝对路径，工具页显示它、直接任务把它作为 `saveDir` 传入；Web 服务不给）。`tools` 每项：静态声明，即 `id`（稳定，小写字母与连字符）、`label`、`description`、`category`（组：`speech` 语音与字幕、`text-image` 文字与图片、`video-file` 视频文件）、`inputs`（`file`、`link`、`text`、`video`、`document`）、`results`（`video`、`artifact`）、`execution`（`{ kind: 'pipeline', method: 'pipelines.start', pipeline, params? }`，`params` 是工具固定带上的参数；或 `{ kind: 'job', method, capability }`）、`executionByInput`（某种输入走另一种执行时，按输入种类给出那一种；没有列出的输入走 `execution`）、`capabilities` 与 `optionalCapabilities`、`externalTools` 与 `optionalExternalTools`、`network`（`required`、`optional`、`none`）、`candidates`（`videos`、`videos-with-transcript`，不接受视频输入时 `null`），加上此刻的 `available`、`problems` 与 `limitations`（`ToolProblem`：`code`、`message`，以及适用的 `capability`、`reason`、`tool`、`remedy`）。`code` 沿用已有的错误码：能力按提交时的同一套选择判断（`CAPABILITY_NOT_CONFIGURED`，带它的 `reason`），外部工具用上次探测的结果（`TOOL_NOT_INSTALLED`、`TOOL_UNAVAILABLE`、`TOOL_OUTDATED`、`TOOL_CONSENT_REQUIRED`、`TOOL_UPDATING`），严格离线 `OFFLINE_STRICT`。一定要的依赖进 `problems`（`available: false`），只在某些输入下才用的进 `limitations`（照样可用）。`list` 不联网、不启动任务。首批：`transcribe`（`inputs` 为 `file`、`video`，`results` 为 `artifact`、`video`：Space 里的视频写进视频；本机媒体文件给了项目时新建视频；不给项目时只转录成 TXT/SRT 写到保存位置，这时也收 Space 里的音视频文件条目；链接走 `link-import`）、`translate-subtitles`（视频与文稿走 `translate`，`execution.params` 是 `{ captions: true }`：从工具入口发起时建立目标语言的字幕层；字幕文件（`file`）走 `translate-subtitles`，结果是新的字幕文件 `artifact`）、`dub`、`link-import`、`compress-video`、`merge-video` 与 `extract-audio`（`transcode` 带 `action`）、`synthesize-speech` 与 `generate-text`（`inputs` 另有 `document`：Space 里的文档、字幕条目，经 `material` 提交）、`generate-image`。`candidates { toolId, projectId?, cursor?, limit? }`（`limit` 默认 100、最多 500；`projectId: null` 是不属于项目的视频）返回 `{ toolId, candidates, total, nextCursor, complete, pendingVideos, scanning }`：可选的视频按最近活动从新到旧，每项是 `entryId`、`videoId`、`name`、`projectId`、`lastActivityAt`、`indexed`、`indexedRevision` 与 `documents`。`videos` 规则列回收站之外的全部视频，`documents` 为空；`videos-with-transcript` 只列有文稿的视频，`documents` 是每份文稿（`kind: 'speech'`、`documentId`、`name`、`language`、`wordTiming`、`onTimeline`）与译自它的译文（`documentId`、`language`、`staleUnits`）和配音组（`groupId`、`language`、`translationId`）。事实来自内容索引（架构设计 §5.11），不打开视频；还没有索引、排队重读或读失败的视频照样列出并标 `indexed: false`（有文稿才列的工具不能断定它没有文稿），这时 `complete` 为 false，与 `space.search` 相同。范围按主体过滤，与 `space.list` 相同。不认识的 `toolId` 是 `not-found`。两个方法在 Web 服务的默认集合与只读集合里；浏览器里执行方法不在白名单的工具标为不可用（`WEB_METHOD_NOT_ALLOWED`，只读时 `WEB_READ_ONLY`）；保存位置不在任何已登记的项目目录里时，结果只有 `artifact` 的流程工具标为不可用、结果还有 `video` 的写进 `limitations`（都是 `PATH_OUTSIDE_PROJECT`），直接任务的结果在产物库里、不受影响；外部工具的问题只给错误码与工具名，不带本机路径与补救。MCP 对外服务不提供。 |
| `catalog` | `list` `call` `agentSkill` | Agent 面的工具目录（架构设计 §3.5、§4.1），与会话里的智能体（工具桥）、MCP 服务是同一份。`list {}` 返回 `{ interfaceVersion, tools: [{ name, title, description, inputSchema, annotations?, risk, effect, examples, surfaces, positional? }] }`：`interfaceVersion` 与 MCP 服务的接口版本是同一个号（`MCP_INTERFACE_VERSION`），`inputSchema` 是参数的 JSON Schema，`risk` 是动作的默认风险等级（取决于参数的以调用时为准），`effect`（`query`、`mutation`、`job`、`destructive`）、`examples`（一到三个 `{ title, args }`）、`surfaces` 与 `positional`（CLI 的位置参数对应的字段）供 CLI 派生命令（架构设计 §3.6）。`call { name, args, cwd, project? }` 以终端主体（`LocalPrincipal`）按名调用：`cwd` 是调用方的工作目录、`project` 是显式指定的项目目录，都必须是绝对路径（`--project` 的相对路径由 CLI 按 cwd 解析好），不给 `project` 时从 `cwd` 向上找 `.bcut/project.json`。返回 `{ ok: true, result }`（`result` 是工具的结果对象，与 MCP 工具结果的 JSON 相同）或 `{ ok: false, error: { code, message, … } }`（与 MCP 工具结果里的 `error` 是同一个对象：未知工具 `UNKNOWN_TOOL`，参数不合工具的 schema、`cwd` 或 `project` 不存在 `INVALID_ARGUMENTS`，其余照各工具与 §11）。`cli` 连接的结果与错误里顶层的 `next` 已按 CLI 的写法渲染（§11.7）。写入的操作者是 `user_local`，任务的提交者是这条连接，不生成审批。只给 `cli` 与 `desktop` 连接，其余（`agent`、浏览器、对外服务）是 `forbidden`；参数形状不对（`cwd` 不是绝对路径）是 `invalid-request`。`agentSkill {}` 返回给外部 Agent 的说明书（`agent-skills/baocut/`）按 CLI 面渲染好的文件：`{ interfaceVersion, id: 'baocut', sourceDir, files: [{ path, content }] }`，`path` 相对说明书根、用 `/` 分隔，供 `baocut skill install` 写进宿主的 skills 目录（架构设计 §3.8）；每次调用都重新读目录。找不到说明书目录是 `not-found`（`AGENT_SKILL_NOT_FOUND`），渲染失败（未知占位符、标记没闭合、链接指向不存在的页面）是 `conflict`（`AGENT_SKILL_INVALID`，带 `file` 与 `line`）；同样只给 `cli` 与 `desktop` 连接 |
| `runtime` | `info` `status` `stop` | Runtime 本身（架构设计 §2.2）。`info {}` 返回 `RuntimeInfo`（`instanceId`、`epoch`、`runtimeVersion`、`protocolVersion`、`home`、`projectsDir`、`logsDir`、`pid`、`startedAt`，以及 `launchedBy`：`cli` 是 CLI 拉起的，其余为 `null`）。`status {}` 返回 `RuntimeStatus { info, connections: { desktop, cli, agent }, activeJobs, runningServices, idleExit: { minutes, idleSince } \| null }`：连接只数本机网关上已认证的连接，`idleExit` 只有 CLI 拉起的 Runtime 有（`idleSince` 不空闲时为 `null`）；只发过 `runtime.status`、`runtime.info` 的 CLI 连接不算在用，查状态不让空闲计时清零，报出的 `idleSince` 是查询之前的值；只给 `cli` 与 `desktop` 连接，其余 `forbidden`。`stop {}` 请 CLI 拉起的 Runtime 按停止顺序停下，先返回 `{ stopping: true }` 再收尾；只给 `cli` 连接，不是 CLI 拉起的 `forbidden`（`details.code: RUNTIME_NOT_OWNED`）；还有人在用时 `conflict`（`RUNTIME_IN_USE`，`details` 带 `desktop`、`cli`、`activeJobs`）：有桌面端连接、调用者之外还有 CLI 连接，或有排队与运行中的任务。CLI：`baocut runtime status`、`baocut runtime stop` |
| `legacyImport` | `get` `answer` `retry` `setSkipped` | 旧版项目的导入询问与这次启动里的导入（架构设计 §2.7）。`get {}` 返回 `LegacyImportSnapshot { prompt, run }`，与 `legacy-import` 主题的快照相同：`prompt` 是 `LegacyImportPrompt { promptId, projects, defaultDirectory }`（`projects` 是 `{ path, title, editedAt }`，最近编辑的在前；`defaultDirectory` 是系统文稿 / 文档文件夹下的 `BaoCut`），没有在等的询问时为 `null`。`answer { promptId, decision: 'import', directory }` 导入到 `directory`（绝对路径，不存在时创建），`answer { promptId, decision: 'never' }` 记下以后不再导入；都返回 `{}`，决定写进迁移标记，之后不再询问。`promptId` 已经回答过或不是当前询问时 `not-found`；`directory` 不是绝对路径、在 Runtime Home 或旧版数据目录里、建不了或写不了时 `invalid-request`。「跳过」不发请求，下次启动再问。`run` 是 `LegacyImportRun { runId, directory, state, startedAt, finishedAt, items }`，没有要导入的时为 `null`：`state` 是 `importing`、`waiting`（其他任务在跑，等它们结束）或 `finished`；`items` 是这次启动开始时还没导入的项目（最近编辑的在前），每项 `state` 是 `queued`、`importing`、`imported`、`not-imported` 或 `skipped`，`problem` 是没导入的原因：`offline { volume: { root, name }, missing, missingCount }`（缺的文件所在的卷没接上）、`missing { missing, missingCount }`（`missing` 只列前几个）、`unreadable`、`failed { report }`（导入报告的路径或 `null`）。`retry { paths? }` 重新导入没导入的项目（缺省全部；点名的跳过项也重新导入并清掉跳过的记录），返回 `{ queued }`；`setSkipped { paths, skipped }` 跳过没导入的项目（以后不再自动导入）或撤销跳过，返回 `{ changed }`；不在这次导入里或状态不对的路径忽略，没有这次的导入时两者都返回 0。`answer`、`retry`、`setSkipped` 只给 `cli` 与 `desktop` 连接，其余 `forbidden`；整个命名空间与主题都不在 Web 服务的白名单里 |
| `artifacts` | `get` `openHandle` | 产物与受控的资源句柄；`openHandle({ artifactId })` 返回与 `media.resolve` 相同形状的短期本机 URL（`MediaHandle`），不存在的产物是 `not-found` |
| `fonts` | `resolve` `catalogue` `download` `downloaded` `remove` `clear` `usage` `sample` | 本机字体与按需下载的字体（架构设计 §9.1）：`resolve { faces: [{ family, weight, italic }] }`（1–32 个；族名非空、不超过 200 字，字重 1–1000）按与排版引擎同一套 CSS 字体匹配在本机字体里挑一个 face（族名先精确、再不分大小写、再按 PostScript 名），与成片导出冻结的是同一份解析，返回 `{ faces: [{ family, weight, italic, file, faceIndex, fileSize, size, header, tables: [{ from, length, to }] }], missing: [{ family, weight, italic, reason }] }`（重复的请求只答一次）：`file` 是所在文件的 `MediaHandle`（同 `media.resolve`，限定到那一个文件，支持 `Range`），`faceIndex` 是它在文件里第几个；把它抽成单独的字体是 `size` 字节，开头是 `header`（十六进制），每张表从文件的 `from` 起取 `length` 字节放到 `to`。`reason` 是 `not-found` 或 `too-large`（抽出来超过 96 MB）。编辑器预览只问报缺的族里排字点了名的 face，每个一次，按区间取表拼好注入预览的渲染内核。第一次调用要扫一遍本机字体目录（在引擎宿主单独的线程上，不挡别的请求）。本机没有的族再到下载缓存里找，答复的每个 face 带 `source`（`local` 或 `downloaded`）。`resolve` 带 `download: true` 时，Google Fonts 字体目录里有、还没下载的 face 按设置 `fonts.autoDownload` 开始下载（不是严格离线、十分钟内没有自动下载失败过；取消不算失败），记在 `missing` 里：`reason` 另有 `downloadable`（没下载，也没开始下载）、`downloading`（带 `jobId`，下载完再问一次就有）与 `download-failed`（带 `code`）。`catalogue { query?, category?, script?, families?, states?, offset?, limit? }` 是选字列表：字体目录、随内核与本机的族合在一起，每项是 `FontFamilyStatus`（`state` 为 `built-in`、`installed`、`downloaded`、`downloadable`、`downloading`（带 `job` 的字节进度）、`failed`（带 `error`）或 `unavailable`，以及分类、文字（`chinese`、`japanese`、`korean`、`latin` 等，按字符子集归类）、字重、斜体、许可与来源），返回 `{ total, families, catalogueDate }`，不联网。`download { family, faces?, commandId? }` 下载一个族（`faces` 不给时下常规与粗体，给了的字重按目录对到这个族实际有的字重），提交 `fontDownload` 任务并立即返回 `{ family, faces, jobId, status }`（都已下载好时 `jobId` 为 null，在下载时是那个任务）；失败之后再调就是重试，取消用 `jobs.cancel`：任务以 `CANCELLED` 结束，`catalogue` 里这个族是 `failed`、`error.code` 为 `CANCELLED`（界面显示「已取消」）。`downloaded {}` 返回 `{ faces, totalBytes, inUse }`（每个 face 的族、字重、斜体、许可、sha256、大小与下载时间，不含地址；`inUse` 是还没结束的导出用着、删不掉的族）。`remove { family, faces? }` 与 `clear {}` 删下载缓存，返回 `{ removed, freedBytes, kept }`：还没结束的导出冻结了或在等的 face，`remove` 以 `FONT_IN_USE` 拒绝、`clear` 留在 `kept`（`clear` 不删样张）。`usage { videoId, sequenceId?, burnCaptions?, download? }` 清点一个打开着的视频用到的字体：与成片导出同一份冻结交给 Render Worker 排一遍字（缺省整条根序列、烧字幕），只看文字与字幕、不冻结素材，所以视频没有素材、素材文件不见了或变了都照样给出清单，不以 `ASSET_MISSING` / `ASSET_CHANGED` 拒绝；返回 `{ families: [{ family, faces: [{ weight, italic }], status, fallback }], fallback, started }`——`status` 是 `FontFamilyStatus`，`fallback` 是此刻画不了这个族时代替它的族（随内核、本机或下载缓存里有这个族时为 null），顶层的 `fallback` 是内核的回退族（`Noto Sans SC`）；`download: true` 时还没下载的 face 按 `resolve` 的同一条规则开始下载，`started` 列出这次开始下载的族。`sample { family }` 返回选字列表的样张 `{ family, text, data, format, reason? }`：只含族名里那几个字（`text`）的字体子集，`data` 是 base64，`format` 按文件头认（`truetype`、`opentype`、`woff`、`woff2`）；请求只带族名、常规字重与这几个字，存进字体缓存、下次不再取；严格离线（`reason: 'offline-strict'`）与不在字体目录里的族（`not-in-catalogue`）`data` 为 null，取不到时以 `conflict` 报（`details.code` 是 `FONT_DOWNLOAD_*`）。只有桌面端与 CLI 的 Runtime 有这些方法，浏览器会话没有；Web 服务与 MCP 不开放下载、删除、样张与清点（`forbidden`），`resolve` 对它们不下载。CLI：`baocut fonts [downloaded]`、`baocut fonts search [文字] [--category] [--script] [--limit]`、`baocut fonts download <族名> [--weights 400,700] [--italic]`、`baocut fonts remove <族名>`、`baocut fonts clear` |
| `nodes` | `discover` `pair` `list` `remove` `share.start` `share.stop` `share.status` `share.pairingCode` `share.revoke` `share.setCapability` | 远端节点的发现、配对与本机共享（架构设计 §6.7；参数与结果见节点协议规范 §10） |
| `previews` | `capture` `inspect` | 取帧与检查 |
| `code` | `build` `publish` `inspect` | 代码包（代码包规范 §6） |
| `compositions` | `preview` `import` | 预览与导入代码画面（动态图形），保留给界面，目前没有界面调用；与工具 `compositions_preview` / `compositions_import` 共用同一个服务，参数相同；视频要已经打开，`path` 只能在视频的来源目录里，内联文件受网关 4 MiB 的请求上限约束，大的用 `path`。`preview` 的帧写在来源目录的 `.baocut-out/frames/<videoId>/`，返回媒体句柄；`import` 给了 `conversationId` 时每笔修改在会话里放一张变更卡；给了 `replace: { itemId }` 时第二笔修改用 `replaceCodeBundle` 原地替换那个合成实例（§12.6），不新放实例，与 `place`、`register` 互斥；结果的 `item` 给出实例的位置（`itemId`、`trackId`、`fromFrame`、`durationFrames`、`startSeconds`、`endSeconds`），替换时另有 `replaced`（回执 `impact.codeEdits` 的那一项）。类型在 `@baocut/protocol` 的 `code-bundle.ts` |
| `exports` | `create` `get` `list` `renderText` | 导出任务（§4.4）：`create` 冻结、预检，通过后立即返回 `jobId`；进度、取消与结果走 `jobs`（`jobs.cancel`）。`renderText` 不写文件，只返回字幕或文稿的正文。这个版本导出字幕、文稿与音频；`updateDraft`（导出草稿）推迟（§13） |
| `space` | `list` `get` `search` `thumbnail` `import` `rename` `setFavorite` `trash` `restore` `purge` `openForEdit` `continueInConversation` `rebuildIndex`（另有兼容的 `update` `rescan`） | Space 目录（架构设计 §5.7）；`search` 是跨视频的内容检索（架构设计 §5.11）；类型在 `@baocut/protocol` 的 `space.ts`。`list { projectId?, kind?, status?, videoId?, favorite?, trash?, cursor?, limit? }`：`projectId: null` 是不属于任何项目的条目（按 `source.projectId ?? origin.projectId`），`kind` 与 `status` 可给一个或数组（`status: 'none'` 是没有状态的条目），`videoId` 是这个视频本身与由它生成、导出的条目，`trash` 为 `exclude`（默认）、`only` 或 `include`；按最近活动从新到旧，`limit` 默认 100、最多 500，返回 `{ entries, total, nextCursor, issues, scanning }`。`get { entryId }` 返回 `{ entry }`。条目的 `file { path }`（可选）是结果写到磁盘上的文件，取自任务结果的 `outputs[].path`：文件到文件的流程、只给文件的转录与导出发布的文件，以及直接任务按 `saveDir` 另存的副本；文件不在了时没有，来源目录里扫描到的普通文件也没有（按来源目录与 `relPath` 拼）。`thumbnail { entryId }` 返回 `SpaceThumbnail`：`{ kind: 'image', mimeType: 'image/jpeg' \| 'image/png', data, width, height }`（`data` 是 Base64，宽不超过 720、高不超过宽的 3 倍）、`{ kind: 'text', excerpt }`（文档与字幕开头不超过 1536 字节的 UTF-8 文字，字幕只留台词）或 `{ kind: 'none' }`；读不了、解不了的都是 `none`，条目不存在或看不到是 `not-found`，结果不含本机路径，Web 只读模式下可用（取法见架构设计 §5.7）。`search { query, projectId?, videoIds?, kinds?, speaker?, limit? }`：空白隔开的词都要在同一段里出现，不区分大小写与全角半角，只给 `speaker` 时 `query` 可以为空；`kinds` 为 `speech`、`caption`、`translation`、`chapter`；`limit` 默认 50、最多 200；返回 `{ hits, complete, pendingVideos, truncated }`，每条命中带 `videoId`、`videoName`、`entryId`、`projectId`、`documentId`、`documentKind`、`language`、`time { clock: 'sequence' \| 'source', start, end }`（秒）、`snippet`、`highlights`（UTF-16 下标）、`speaker` 与 `indexedRevision`；内容索引没有覆盖范围内的全部视频（还没读、正在重建、读失败或落后于当前版本）时 `complete: false`。`import { projectId, path, name? }` 把文件登记为项目的素材，`path` 是绝对路径；项目之外的复制进项目的 `imports/`，返回 `{ entry, copied }`；视频目录里的、隐藏目录里的与认不出类型的文件以 `invalid-request` 拒绝（`SPACE_IMPORT_UNSUPPORTED`）。`rename { entryId, name }`（`null` 恢复文件名）、`setFavorite { entryId, favorite }`、`trash { entryId }`、`restore { entryId }` 写用户标记，返回 `{ entry }`；视频条目的 `trash` 与删除了的视频的 `restore`（`update { trashed }` 同样）转为 `videos.delete` / `videos.restore`，前提与错误相同，返回的是新位置上的条目。`purge { entryId }` 返回 `{ status: 'purged', entryId }` 或 `{ status: 'blocked', entryId, references }`（`references[].kind`：`video-asset`、`job`、`unverified`、`user-file`）；来源目录里的视频条目以 `invalid-request` 拒绝（`SPACE_PURGE_VIDEO`，先 `videos.delete`），删除了的视频查完引用后只删视频管理的文件，进行中的占位与不在回收站里的条目以 `conflict` 拒绝（`SPACE_PURGE_RUNNING`、`SPACE_NOT_TRASHED`）。`openForEdit { entryId }` 返回 `{ mode: 'video', videoId, target }`、`{ mode: 'source-video', videoId, target, frozenRevision, currentRevision, changed }` 或 `{ mode: 'new-video', source, projectId }`。`rebuildIndex {}` 返回 `{ entries, pendingVideos }`。`continueInConversation { entryId, conversationId?, commandId? }` 把条目的引用（`SpaceEntryReference`，只有标识与元数据）挂到一个会话上，返回 `{ conversation, created, reference }`，不启动任务；会话的选择见架构设计 §5.7，给的会话看不到条目时 `SPACE_CONVERSATION_MISMATCH`，回收站里的条目 `SPACE_ENTRY_TRASHED`（都是 `conflict`）。Web 服务里 `import` 的文件按真实路径必须在项目目录里（`PATH_OUTSIDE_PROJECT`）。`media.resolve { entryId }` 也能取产物与来源目录之外的导出的 bytes |
| `projects` | `create` `open` `list` `rename` `pin` `archive` `files.list` `files.read` | 项目的登记与整理；`create` 与 `open` 按目录里的 `.bcut/project.json` 认项目，没有时写入：移动后再打开是同一个项目，复制出来的目录是新项目（架构设计 §5.1）；`files.*` 是限定在项目目录内的只读查询（架构设计 §11.2） |
| `library` | `list` `get` `put` `remove` `import` `export` `applyToVideo` `getVideoSelection` `setVideoSelection` `openHandle` `createVoiceClone` `removeVoiceClone` | 用户库：术语表（`glossaries`）、音色（`voices`）、品牌库（`brand`），条目的内容、存储、版本与交换格式见架构设计 §5.9，类型在 `@baocut/protocol` 的 `library.ts`。`list({ library?, kind? })` 返回条目摘要 `LibraryEntrySummary`（ID、版本、`contentHash`、名字、种类，术语表另有条数与 `defaultEnabled`，音色另有是否声明授权与各 Provider 上克隆的状态）；`get({ library, id, version? })` 返回完整的 `LibraryEntry`（不给版本时是当前版本；只有当前版本与任务固定着的旧版本可读）。`put({ library, id?, expectedVersion?, content, source?, commandId? })` 新建（不给 `id`）或修改条目，返回 `{ entry, created, changed }`；内容不变时 `changed: false`、版本不变；带文件的条目（音色的参考录音，品牌库的图片、视频、贴纸、字体）必须给 `source`：本机文件的绝对路径 `{ path }`，或产物库里的产物 `{ artifactId }`（「存到库」），修改时不给 `source` 沿用原文件；音色的 `content.consent` 只有 `declared` 与可选的 `statement`，`declaredAt` 由 Runtime 记下。`remove({ library, id })` 删除条目，任务固定着的版本留到任务结束。`import({ path, commandId? })` 按内容识别交换文件并新建一个条目；`export({ entry, path })` 把条目的某个版本写到绝对路径 `path`，返回 `{ path, format, byteLength, entry }`（`format`：`glossary-markdown`、`voice-package`、`media`、`library-item`），目标已存在时 `conflict`、目录不存在时 `not-found`。`applyToVideo({ videoId, entry, commandId, expectedRevision?, name?, captionItemIds?, sequenceId? })` 把条目拷进一个已打开的视频，是一笔普通的编辑事务，返回 `EditResult` 加上冻结的 `entry` 与新素材的 `assetId` 或新文档的 `documentId`；视频没有打开时 `not-found`（`details.code: VIDEO_NOT_OPEN`）。`openHandle({ library, id, version? })` 返回条目文件的 `MediaHandle`（与 `artifacts.openHandle` 相同），没有文件的条目是 `not-found`。`createVoiceClone({ id, providerId, name?, commandId? })` 在一个 Provider 上克隆音色，立即返回 `{ jobId }`（任务 `kind: 'voiceClone'`，同一音色版本与 Provider 在排队或在跑时返回那个任务）；提交时的拒绝：没有本人声明 `VOICE_CONSENT_REQUIRED`（`conflict`），Provider 没有克隆接口 `VOICE_CLONE_UNSUPPORTED`（`invalid-request`），没有启用 `CAPABILITY_NOT_CONFIGURED`（`conflict`），参考录音没变的有效克隆已经存在 `VOICE_CLONE_EXISTS`（`conflict`），没有覆盖 `audio` 外发的授权 `forbidden`。任务的结果是回执产物（`baocut.voice-clone/1`），条目的 `clones[providerId]` 随之更新；被替换的旧克隆删不掉时任务告警 `VOICE_CLONE_OLD_NOT_DELETED`。`removeVoiceClone({ id, providerId, localOnly? })` 先请求远端删除，返回 `{ removed: true, remote }`（`deleted`、`not-found`，`localOnly` 时 `skipped`）；没有这个克隆时 `not-found`；远端删除失败时记录保留，以 `conflict` 报告 Provider 的错误码（`PROVIDER_*`）。两个方法都不对 MCP 与 Web 服务开放。`getVideoSelection({ videoId })` 返回视频里启用的条目 `{ videoId, documentId, revision, selection }`：`selection` 是 `{ glossaries: { transcribe, translate }, speakerVoices[] { documentId, speakerId, voice, providerId? } }`，记在视频的 `library-selection` 文档里（视频格式规范 §4.6），没有这份文档时 `documentId` 与 `revision` 为 null、`selection` 是空的。`setVideoSelection({ videoId, commandId, expectedRevision?, glossaries?: { transcribe?, translate? }, speakerVoices? })` 是一笔普通的编辑事务，给了的字段整体替换、没给的照旧，返回 `EditResult` 加上 `documentId` 与新的 `selection`；每一步最多 20 张、不重复，种类与步骤不符是 `LIBRARY_ENTRY_NOT_APPLICABLE`，库里没有的条目是 `not-found`；绑定的转写要在视频里、是 `speech`，说话人要在那份转写里，同一位说话人只绑一次，`library:` 音色要在库里且不带 `providerId`，否则 `invalid-request`。新建的视频由 Runtime 写入库里默认启用（`defaultEnabled`）的术语表（架构设计 §5.9）。视频没有打开时 `not-found`（`VIDEO_NOT_OPEN`）。CLI：`baocut library video-selection <videoId> [--transcribe-glossaries <id,…>] [--translate-glossaries <id,…>] [--speaker-voice <转写>:<说话人>=<音色>[@<Provider>]]… [--clear-speaker-voices]`。`library.*` 都不对 MCP 与 Web 服务开放 |
| `templates` | `list` `get` `openHandle` | 创作模板目录（模板包规范 §6），类型在 `@baocut/protocol` 的 `template.ts`。只读，每次调用都重新读目录。`list { language? }` 返回 `{ templates, diagnostics }`：`templates` 每项是 `{ manifest, origin: 'builtin' \| 'user', languages, files: { cover, preview, assets } }`（`manifest` 是按 `language` 挑出的语言版本，没带时按 Runtime 的界面语言，挑法见模板包规范 §3.6；`languages` 是这个模板有的语言；`files` 说有没有封面图、预览视频，带几项素材），顺序不是合同；`diagnostics` 是跳过的模板目录 `{ code, origin, dir, path, message, issues }`（`code`：`unsupported-schema`、`invalid`、`duplicate-id`、`builtin-conflict`）。`get { id, language? }` 返回 `{ template, prompt }`（同样挑语言版本；`prompt` 是 `prompt.md` 或那种语言译文的全文）；没有这个模板或它没能加载时 `not-found`（`TEMPLATE_NOT_FOUND`）。`openHandle { id, path }` 给清单登记的 `cover.file`、`preview.file` 或 `assets[].path` 发 `MediaHandle`（同 `artifacts.openHandle`）；别的路径（含 `prompt.md`）`not-found`（`TEMPLATE_FILE_NOT_FOUND`）。场景模板的使用走 `conversations.send` 的 `template` |
| `skills` | `list` `get` `readFile` `setEnabled` `add` `importGithub` `remove` | 内置 Agent 的 skill（架构设计 §3.8、§12.9），类型在 `@baocut/protocol` 的 `skill.ts`。每次调用都重新读目录。`list {}` 返回 `SkillListResult { skills, diagnostics }`：`skills` 每项是 `SkillSummary`（`id`、`name`、`description`、`version`、`origin: 'builtin' \| 'personal' \| 'third-party'`、`enabled`、`defaultEnabled`、`removable`、`path`、`source`（`local { path, addedAt }` 或 `github { url, owner, repo, ref, commit, path, importedAt }`，内置的为 `null`）、`fileCount`、`updatedAt`），顺序不是合同；`diagnostics` 是跳过的 skill 目录 `{ code, scope: 'builtin' \| 'user', dir, path, message, issues }`（`code`：`invalid`、`duplicate-id`、`builtin-conflict`）。`get { id }` 返回 `SkillDetail { skill, content, files }`（`content` 是 `SKILL.md` 全文，`files` 是目录里的文件 `{ path, size, text }`）。`readFile { id, path }` 返回目录里一个文本文件 `{ path, size, content }`；`path` 是 `/` 分隔的相对路径，绝对路径、`..`、反斜杠在参数校验时以 `invalid-request` 拒绝。`setEnabled { id, enabled }` 改开关，返回 `SkillChangeResult { skill, skills, diagnostics }`。`add { path, id?, commandId? }` 从本地文件夹添加、`importGithub { url, id?, commandId? }` 从 GitHub 导入，都返回 `SkillChangeResult`；`remove { id }` 返回 `SkillRemoveResult { removed: { id, path }, skills, diagnostics }`。`add`、`importGithub` 与 `remove` 只对桌面界面与 CLI 开放，不在 Web 服务的白名单里（`WEB_METHOD_NOT_ALLOWED`）；`list`、`get`、`readFile` 在只读的 Web 会话里也能用，`setEnabled` 在非只读的 Web 会话里能用。错误码见 §11.3；点选 skill 发送走 `conversations.send` 的 `skill` |
| `settings` | `get` `set` | Runtime 持有的偏好设置（架构设计 §5.10）。`get { keys? }` 返回 `{ settings, defaults }`（不给 `keys` 时是全部键）；`set { values }` 整批校验，未知的键或不合 schema 的值整批以 `invalid-request` 拒绝、不保存，`null` 恢复默认值，返回新的完整视图。键、schema 与默认值由协议包里的注册表定义 |
| `services` | `list` `start` `stop` `configure` `respondToApproval` `mcp.createClient` `mcp.listClients` `mcp.revokeClient` `mcp.connectionInfo` `modelApi.createClient` `modelApi.listClients` `modelApi.revokeClient` `modelApi.connectionInfo` `modelApi.setAlias` `modelApi.removeAlias` `web.createAccessLink` `web.listSessions` `web.revokeSession` | 对外服务的开关、配置与状态（架构设计 §4.8、§12.8）。服务是 `mcp`、`model-api`、`web`、`node`；`list` 返回每个服务的 `ServiceStatus`（状态、出错原因、端口、地址、是否随 Runtime 启动、访问策略、客户端的元数据、最近的外部请求），`start` / `stop { serviceId }` 与 `configure { serviceId, port?, level?, videos?, autostart?, routing?, maxConcurrentPerClient?, readOnly?, methods? }` 返回新的状态；端口被占用时 `start` 不抛错，状态为 `error` 并带原因。`routing { online?, nodes?, agent? }` 与 `maxConcurrentPerClient`（1 到 64）只适用于 `model-api`，给别的服务时 `invalid-request`；`model-api` 忽略 `videos`，它的 `ServiceStatus` 另带 `modelApi`（路由开关、别名表、并发与大小上限、接口版本）。`node` 是 `nodes.share.*` 的投影，`configure` 以 `invalid-request` 拒绝。`respondToApproval { approvalId, decision: 'allow' \| 'deny' }` 回答一条服务审批，返回 `allowed`、`denied` 或 `already-resolved`（已超时、已取消或已回答）。`mcp.createClient { name }` 返回客户端的元数据与令牌，令牌明文只在这里出现一次；`mcp.listClients`、`mcp.revokeClient { clientId }` 只有元数据；`mcp.connectionInfo { clientId? }` 返回地址、请求头的形状、可以粘进 MCP 客户端配置的片段与接口版本，令牌用占位符。MCP 服务在 `initialize` 的 `serverInfo.version` 与 `_meta['baocut.interfaceVersion']` 里报告接口版本。`modelApi.*` 的客户端方法与 `mcp.*` 同形（两个服务的令牌互不通用），`modelApi.connectionInfo` 返回 `baseUrl`、请求头的形状、`OPENAI_BASE_URL` / `OPENAI_API_KEY` 的写法与接口版本；`modelApi.setAlias { alias, capability, providerId, modelId? }`（不给 `modelId` 时是那个 Provider 的默认模型）与 `modelApi.removeAlias { alias }`（没有这条时 `not-found`）返回整张别名表。模型接口服务的端点与 HTTP 错误见架构设计 §4.8 与 §11.3Web 服务（默认端口 47622）没有访问等级与视频范围（`policy` 为 null，`configure` 带 `level` 或 `videos` 时 `invalid-request`），它的 `ServiceStatus.web` 是 `{ readOnly, methods }`：`configure { serviceId: 'web', readOnly?, methods? }` 设只读与方法白名单（方法名或 `<命名空间>.*`；`null` 恢复默认集合；默认集合之外的项以 `invalid-request` 拒绝），改了之后已有的浏览器连接断开重连；`clients` 是浏览器会话（`clientId` 为会话 ID）。`web.createAccessLink { video? }` 返回 `{ url, expiresAt }`：`url` 是 `http://127.0.0.1:<端口>/#code=<一次性代码>`，代码只在这里出现，两分钟内有效、兑换一次就作废（`baocut web open --launch` 让浏览器只打开 `#` 之前的登录页，代码打在终端里，由用户粘进登录页）；给 `video`（videoId）时链接直达这个视频的编辑器：Runtime 把它解析成文件目标，`url` 的路径与查询是 `/home?video=<JSON 的 FileTarget>`（`webVideoHref`，与界面内链接同一个构造函数），fragment 仍只有代码，登录之后回到这个路径与查询，找不到这个视频时 `not-found`（`details.code` 为 `VIDEO_NOT_FOUND`）；服务没开着时以 `SERVICE_NOT_RUNNING` 拒绝。`web.listSessions {}` 与 `web.revokeSession { sessionId }` 返回 `{ sessions: WebSession[] }`（会话 ID、登录、最近使用与到期时间、此刻的连接数、截短的 User-Agent；没有令牌），吊销立即断开这个会话的连接，没有这个会话时 `not-found`。浏览器经 Web 服务连上的网关只开放白名单里的方法与主题（架构设计 §4.8）：白名单之外 `forbidden`，`details.code` 为 `WEB_METHOD_NOT_ALLOWED`、`WEB_READ_ONLY` 或 `WEB_TOPIC_NOT_ALLOWED`；会话失效后连接上的请求以 `unauthenticated` 回答并断开 |
| `externalTools` | `list` `detect` `install` `update` `setPath` `remove` `consent` `cookieBrowsers` | 受管外部工具（架构设计 §12.9），首批是 yt-dlp，ffmpeg 只报告状态。`list` 与 `detect { name? }` 返回 `{ tools }`（`ExternalToolStatus`：`name`、`label`、`purpose`、`state`（`installed`、`missing`、`outdated`、`unavailable`）、`reason`、`path`、`version`、`source`（`env`、`user`、`managed`、`system`）、`minVersion`、`installable`、`offer`（`version`、`fileName`、`url`、`sizeBytes`、`estimatedBytes`、`sha256`、`license`、`homepage`、`blockedReason`）、`consentRequired`、`consent`（`state`：`granted` 或 `revoked`，`at`，`via`：`app`、`cli`、`agent-approval`）、`managed`、`userPath`、`installJobId`、`update`、`updateJobId`、`platform`（Runtime 所在主机的平台，`darwin`、`win32`、`linux` 等，界面判断不了安装方式时据此列常用命令）、`remedy`）；探测只在本机执行 `--version`，并按可执行文件的真实位置判断系统里那一份的安装方式：`update` 是 `{ method（homebrew、pipx、pip、standalone，Windows 上还有 winget、scoop、chocolatey）, argv, command, runnable, reason }`，`command` 是给人看、能粘进终端的完整命令（按 Runtime 主机的平台写：Windows 按 PowerShell 的引号规则，第一个词带引号时前面加 `&`；其他系统按 POSIX shell），`runnable: false` 时 `reason` 说明为什么不能代为执行（要管理员权限（Chocolatey 装的总要）、找不到同一个 Homebrew、pipx、winget 或 Scoop、解释器不在了）；BaoCut 下载的副本与判断不了安装方式的是 `null`。`install { name, consent?, via?, commandId? }` 不带 `consent: true` 时以 `TOOL_CONSENT_REQUIRED` 拒绝（`details.offer`），带了就记下同意并提交 `kind: 'toolInstall'` 的任务，返回 `{ tool, jobId }`，进度单位 `bytes`；同一个工具正在安装时返回那个任务。`update { name, command?, commandId? }` 按 `update` 代用户执行更新命令：没给 `command`、或与此刻的 `update.command` 不同时以 `TOOL_UPDATE_CONFIRM_REQUIRED` 拒绝并交出 `details.update`，交回用户确认过的同一条命令才提交 `kind: 'toolUpdate'` 的任务，返回 `{ tool, jobId }`；同一个工具正在更新时返回那个任务。命令不经 shell、不提权，阶段是 `downloading`（执行）与 `validating`（重新探测），输出写进 `JobRecord.command`（`line`、`output`（末尾约 32 KB，去掉终端颜色，`\r` 改写的行只留最后一次）、`lines`、`truncated`、`exitCode`，执行中约每 250 ms 更新一次）；结束后不管结果都重新探测，退出码 0 为完成（winget 没有可升级的版本时以 0x8A15002B 退出，也是完成），否则任务以 `TOOL_UPDATE_FAILED` 失败（`details.exitCode`、`details.remedy`）；完成与失败都在 `result.artifactId` 留一份 `baocut.tool-update/1` 记录（命令、前后版本、完整输出）。`setPath { name, path }`（`null` 清除）先执行一次 `--version` 核对，返回 `{ tool }`；`remove { name }` 只删受管副本；`consent { name, grant, via? }` 记下或撤回同意。`cookieBrowsers {}` 返回 `{ platform, browsers }`：`platform` 是 Runtime 所在主机的平台（`darwin`、`win32`、`linux` 等，界面据此提示系统授权）；`browsers` 是这台机器上找得到 Cookie 库的浏览器（`CookieBrowserInfo`：`id`（`cookieBrowsers` 的取值）、`label`、`lastUsedAt`（Cookie 库最近的修改时间，没有权限看时 null）），最近改过的在前；每次调用重新看，只看文件在不在与修改时间，不读 Cookie、不运行下载工具（架构设计 §7.9）。这八个方法不在 Web 服务的白名单里，浏览器会话与对外服务调用时以 `forbidden` 拒绝；MCP 对外服务不提供 |

下载视频界面使用 `link-import`，不发送 `target`。`transcribe: true` 在无视频目标时直接转录文件，`summary.transcriptFiles` 返回 TXT/SRT 路径。媒体和转录结果都写入提交时冻结的 `downloads.directory`（默认主机的下载文件夹，见架构设计 §7.9）。可选 `projectId` 只关联转录产物，不改变文件路径；`saveTo`（`downloads` 或 `project`，默认 `downloads`）为 `project` 时保存目录改为归属项目（`projectId`、`videoId` 所在的或 `target.create` 的项目）里的 `downloads/`，归属是不属于项目的会话时仍是下载目录，界面与 CLI 不发送它（智能体的 `download` 只在只给 `project` 时发送，对外服务的 `download` 有落点就发送）；`cookieBrowsers` 是按尝试顺序排列、不重复的浏览器列表，每项只接受 chrome、edge、firefox、safari、brave、chromium、opera、vivaldi、whale，不给或空时不读浏览器 Cookie。解析链接时按顺序逐个用：读不到 Cookie 或网站要求登录时换下一个，别的失败不换；都没成功时以 `LINK_LOGIN_REQUIRED`（有一个要求登录）或 `LINK_COOKIES_UNAVAILABLE` 失败，`error.details.attempts` 是每个浏览器的 `{ browser, code, message }`。用上的浏览器在 `summary.cookieBrowser`（匿名时 null），下载沿用它。旧写法 `cookieBrowser`（一个浏览器）照样接受，等同只有它的 `cookieBrowsers`，两者不能同时给。下载视频界面只列出 `externalTools.cookieBrowsers` 检测到的浏览器。


规则：

- 模型类的方法立即返回 `jobId`。查询状态不触发新的计算。
- 候选、回执、检查报告都以稳定的 ID 返回。
- 修改输出帧率使用 `exports.create` 的 `ExportSettings`（成片视频导出的种类 `video` 的 `fps`）；修改编辑帧率使用 `changeSequenceFrameRate` 操作。两者不共用一个含糊的 fps 更新接口。

### 4.2 编辑操作

`edits.apply` 的 payload 是一组 `EditOperation`：

```ts
// 本规范补全：操作以 type 区分，每个 type 有自己的 Schema
type EditOperation = { type: string; [field: string]: JsonValue };
```

操作按领域分族：

| 领域 | 代表性操作 | 回执必须说明 |
| --- | --- | --- |
| 素材 | `importAsset` `collectAssets` `removeAssets` `relinkAsset` `replaceAssetVersion` | 版本、受影响的实例、缺失的资源、删掉的素材记录 |
| 片段 | `addItem` `moveItems` `arrangeItem` `trimItem` `splitItem` `joinItems` `deleteItems` `removeRange` `updateItem` `setSpeed` | 新旧时间、lineage、联动的对象 |
| 样式 | `setText` `setTransform` `setStyle` `setProps` `setAnimation` `setKeyframes` `setAudioMix` | 属性校验的结果与改变的范围 |
| 转场与效果 | `setTransition` `removeTransition` `setEffects` | 被连带删掉的转场与原因、随实例变短的单侧转场 |
| 章节与闪避 | `setChapters` `upsertChapter` `removeChapter` `setDucking` `removeDucking` | 新建或改动的章节与规则 |
| 字幕 | `correctWords` `updateTranslation` `pinCaptionBreak` `setCaptionStyle` | 新的文档版本、失效的依赖 |
| 口播 | `addCuts` `restoreCut` `proposeCuts` `acceptCutSuggestions` | 安全切点、映射与审阅记录；随剪口删掉的实例、放不回去的剪口 |
| 代码 | `publishBundle` `setCodeParameters` `replaceCodeBundle` `bakeCodeItem` | 代码包版本、兼容性与缓存影响 |
| 配音 | `setDubbingScript` `attachVoiceResult` `chooseLanguageVariant` | 真实时长、对齐、待处理的单元 |
| 版本 | `forkSequence` `applyLocalizationOverride` | 来源关系、冲突 |
| 轨道与序列 | `addTrack` `deleteTrack` `updateTrack` `moveTrack` `updateSequence` `changeSequenceFrameRate` `setTemplate` | 量化偏差、受影响的范围、被拒绝的原因（视频格式规范 §2.12）、删掉的轨道 |
| 保护 | `setProtection` `clearProtection` `createCheckpoint` | 保护的范围与检查点的版本 |

智能体的 `edits_ops` 按已开放的操作返回目录；分组及操作条目的 `family` 使用稳定英文标识：`assets`、`items`、`styles`、`transitions-and-effects`、`chapters-and-ducking`、`speech`、`code`、`tracks-and-sequences`、`documents-and-versions`。这些值用于程序引用，与中文领域名称或操作说明分开。

每个操作必须：

- 用稳定的 ID 指明目标；不用「当前那一段」这样依赖界面状态的指代。
- 声明受影响的轨道集合，以及遇到锁定轨道时的处理方式（拒绝或跳过）。
- 涉及时间时使用 §6 的输入类型，或使用词、句、occurrence 的语义锚。
- 涉及代码合成时区分实例、参数和源码三层（代码包规范 §3.4）。

画面实例的字段、转场、效果、章节与闪避的语义见视频格式规范 §3.5–§3.9、§3.13、§3.15、§3.17，字段的取值与适用范围由引擎按元素模型校验（`crates/timeline`）。操作的约定如下：

- `setTransform` 改画面实例的 `place`：`x`、`y`、`w`、`scale`、`scaleY`、`rot` 只改给出的，给 `null` 去掉（回到按种类的缺省）；`flipX`、`flipY` 是布尔。字幕与音频没有 `place`。
- `setStyle` 只改给出的字段，给 `null` 去掉：`opacity`、`radius`、`cornerRadii` 写进 `place`；`mode`、`fit`、`bg`、`mask` 用于视觉媒体；`tile` 用于图片与文字；`style`、`stylePresetId`、`verticalAlign` 用于文字；`shape` 整个替换图形的参数；`crop` 用于视频与图片，给 `null` 去掉裁剪。
- `trimItem`、`splitItem` 与 `removeRange` 改了实例的窗口时，关键帧绑定与音量包络按视频格式规范 §3.15 跟着换算（`timeline::keyframes` 的 `rewindow`、`split_keyframes`）：`localFrame` 按内容的位移换算，窗口外的帧去掉并在新边界补一帧取样值，`percent` 原样；拆分时左半保留原来的绑定 ID，右半的绑定是新的。`removeRange` 里只缩短的静态实例按跟随剪口的规则换算（起点不动）。
- `joinItems` 给 `itemIds`（两个，同一条轨道上首尾相接）与可选的 `keep`（`first`、`second`，按 `itemIds` 的先后），是拆分的逆：种类相同；带源时钟的速率相同、源时间精确连续；其余字段一致（名字、身份与时间除外），关键帧与音量包络能用 `join_keyframes` 拼回同一串帧。字段不一致时须给 `keep`，取那一边的字段（关键帧拼不回时取那一边的原样）。留下时间上靠前的实例（ID、起点、源起点与 lineage），靠后的删掉，列在回执的 `deletedIds`；靠后那件的出场转场、闪避组与字幕的 `scopeItemIds` 改指留下的那件，两件之间的转场随靠后那件删掉，列在 `impact.removedTransitions`。不合时整笔拒绝（`INVALID_OPERATION`，`details.rule` 为 `kind`、`track`、`not-adjacent`、`rate`、`source-gap` 或 `attributes`，后者带不一致的字段名 `keys`）。
- `setText` 给 `text` 或 `counter`（只给一个），给了的那个替换另一个。`setProps` 整个替换生成类元素与图形的种类参数（与实例种类同名的那一个）。`setAnimation` 整个替换元素动画三槽，`null` 去掉。`setKeyframes` 给 `property` 与 `keyframes`，整个替换这个属性的关键帧，`null` 或空表去掉这条绑定。`setTemplate` 整个替换序列的模板层，`null` 去掉。
- `setAudioMix` 改音频实例的混音或视频、合成自带的那路声音：`muted`、`volume`（线性倍数，0–4）、`fadeIn`、`fadeOut`（十进制秒，`"0"` 去掉）。
- `setTransition` 给出 `sequenceId`、`leftItemId` 与 `rightItemId`（至少一个）、`kind`、`params`，可选 `duration`（§6 的时间输入；给了就要写明 `alignment`）、`easing`、`placement`、`audioCrossfade`。种类是 `dissolve`、`wipe`、`slide`、`zoom`、`iris`、`dip-to-color`、`push`，后两种只用于两侧。同一条边上已有的转场被替换。两侧转场必须给 `duration`，handles 不够时拒绝，不自动缩短；单侧转场不给 `duration` 时是 0.5 秒，生效的长度随实例变短（视频格式规范 §3.9），变短的列在回执的 `impact.shortenedTransitions` 里。
- `setEffects` 给 `fx`，整个替换视觉媒体或合成实例的效果（视频格式规范 §3.9），`null` 去掉。
- `updateSequence` 改序列的 `name`、`canvas`（`{ width, height }`，像素）与 `background`（`#RRGGBB`）。位置按画幅的百分比保存，改尺寸时实例跟着画布走。
- `setChapters` 整个替换序列的章节，其他标记不动；`chapterId` 沿用已有的章节。`upsertChapter` 不给 `chapterId` 时新建，须给 `at` 与 `title`；`summary`、`thumbnail` 给 `null` 去掉；给 `at` 时须写明 `alignment`。缩略图用 `{ assetId }` 或同一事务里 `importAsset` 的 `{ ref }`。
- `setDucking` 不给 `ruleId` 时新建，须给 `trigger` 与 `target`；给了只改给出的字段。`trigger` 是 `{ kind: 'speech' }`（有人说话时）或 `{ kind: 'items', … }`（这些轨道与实例发声时）；`depth` 是压低的分贝数（0–60）；`attack`、`release` 是十进制秒字符串。按实例触发的 `trigger` 与 `target` 除了 `trackIds`、`itemIds`，还可以用 `trackRefs` 引用同一事务里 `addTrack` 的 `ref`。
- `removeRange` 给出 `sequenceId`、`from`、`to`（§6 的时间输入）、`trackIds` 与 `alignment`，在列出的轨道上删掉 `[from, to)` 并让之后的内容前移（波纹删除，视频格式规范 §6.4）：盖住区间的视频、音频、合成实例拆开删掉中间，经它投影的字幕跟着右段走；图片、文字、形状、字幕实例缩短；整个落在区间里的删掉。没列出的轨道不动；列出的轨道或要动的实例锁着时整笔拒绝（`TARGET_LOCKED`），不跳过。口播剪辑接受建议时编译成它。
- `addCuts` 给 `sequenceId`、`assetId` 与 `cuts`（`{ from, to, ref? }`：被剪素材时钟上的十进制秒，`0 ≤ from < to ≤ 素材时长`；`ref` 是剪辑建议的 ID。已定：素材时长由引擎读当前素材版本探测到的时长，调用方不传；素材没有已知时长时拒绝），在这个素材的剪口集合里加入剪口（视频格式规范 §6.7，还没有时新建 `kind: 'cut-set'` 的文档），并在同一笔事务里重排：剪口集合的实例所在的轨道上波纹删除，其余实例按 `followPolicy` 移动（§3.16），章节跟着内容前移（视频格式规范 §6.7）。`restoreCut` 给 `sequenceId`、`assetId` 与 `cutId`，去掉这个剪口并在接缝处放回，接缝之后的章节后移。整个落在剪掉区间里的实例列在 `impact.removedByCuts`，放不回去的剪口列在 `impact.cutsNotRelaid`。音画在不同轨道上错开放置、同一个剪口映射成部分重叠的区间时整笔拒绝（`INVALID_OPERATION`，`details.rule: 'scope-misaligned'`）；轨道或要动的实例锁着时整笔拒绝（`TARGET_LOCKED`）。`putDocument` 写剪口集合时同样按 §6.7 核对。`proposeCuts` 给 `assetId`，可选 `speechDocumentId`（素材有几份转写时必须给）与 `detect`（`pauses`、`fillers`、`minPause`、`compressTo`、`maxGap`、`fillerLanguage`、`customFillers`、`trimChapterStarts`，秒数是十进制字符串），按转写检测口癖与长停顿，写出这个素材的剪辑提案（视频格式规范 §6.2，`kind: 'editorial-proposal'`，没有时新建、有时整份替换），不改时间线。`acceptCutSuggestions` 给 `sequenceId`、`proposalId`（提案文档的 ID）与 `suggestionIds`，把这些建议编译成剪口（同 `addCuts`，`ref` 是建议的 ID）并标成 `accepted`，一笔事务；不认识的建议 ID 整笔拒绝（`ENTITY_NOT_FOUND`），转写在提出之后改过时整笔拒绝（`INVALID_OPERATION`，`details.rule: 'proposal-stale'`）。要改区间时直接用 `addCuts`，把建议的 ID 写进 `ref`。
- 每笔编辑事务的最后，`untilSequenceEnd` 的实例按视频格式规范 §3.16 求出终点；随之改变的实例列在 `updatedIds`，锁定不挡这一步，任务保护照常核对。
- `insertItems` 的视频、图片、白板与音频实例给 `assetRef`（已有素材的版本），或给 `assetImportRef`（同一事务里 `importAsset` 的 `ref`，取那个素材的当前版本），二者只给一个；贴纸与占位框引用素材时同样。

`importAsset` 的 `storage` 不给时，文件链接（`linked`，bytes 留在原处），目录（代码包）收进视频（`managed`）；给 `storage: 'managed'` 才复制文件，已经链接的素材用 `collectAssets` 收进来（视频格式规范 §4.2）。`managed` 要求绝对路径，`linked` 可以给相对视频目录的路径；链接的定位由引擎规范化，项目目录里的文件记相对视频目录的路径，项目外的记绝对路径，`relinkAsset` 同样（视频格式规范 §4.2）。生成的结果（`artifactId`）总是 `managed`。

`removeAssets` 给 `assetIds`，从视频里删掉没有任何引用的素材记录。「有引用」与提交时核对引用的是同一张图，再加上文档的来源：任何序列上实例的 `assetRef` 与合成的预渲染替身 `prerender`、章节的缩略图、文档的 `sourceAssetId`（转写、剪口集合、剪辑提案描述的录音）。列出的素材有一个还有引用就整笔拒绝（`INVALID_OPERATION`，`details.rule: 'asset-in-use'`，`details.usedBy` 是素材 → 引用它的实例、标记与文档的 ID），不认识的 ID 是 `ENTITY_NOT_FOUND`。代码包与它烘焙出的预渲染替身成对处理（代码包规范 §3.3）：替身的来源记录（`provenance.origin: 'composition-bake'`）里的 `sourceBundleRef` 与代码包当前版本清单的 `bundleId`、`revision` 对上就是一对，列出其中一个、另一个也没有引用时一起删。删掉的素材列在回执的 `impact.removedAssets` 与 `deletedIds`。只删记录：`managed` 的 bytes 留在 `blobs/`，撤销历史与冻结中的任务用到的内容因此仍在，撤销能把记录放回来，之后由 GC 按引用图与保留政策回收（架构设计 §5.5）；`linked` 的原文件不动。引擎宿主的只读方法 `videos.unusedAssets { videoId }` 返回此刻没有引用的素材（`{ unused: UnusedAsset[] }`：`assetId`、`name`、`kind`、`mediaType`、当前版本的 `byteLength`、`storage` 与成对的 `pairedWith`），它不在网关上，供工具 `assets_prune` 用。

`deleteTrack` 给 `trackId`（`sequenceId` 可省略，给了要对得上），删掉一条空轨道。其他轨道的 `order` 不重排，与 `addTrack` 取最大值加一、不动已有轨道对称；之后新建的轨道照样排在最上面。轨道上还有实例时拒绝（`INVALID_OPERATION`，`details.rule: 'track-not-empty'`，`details.itemIds` 列出它们，`details.next: ['deleteItems', 'moveItem']`，`recovery` 是同样意思的说明），可以在同一笔事务里先删掉或移走实例再删轨道；被闪避规则的 `trigger` 或 `target` 引用时拒绝（`details.rule: 'track-in-ducking'`，`details.next: ['setDucking', 'removeDucking']`）；轨道锁着时 `TARGET_LOCKED`。删掉的轨道列在 `impact.removedTracks` 与 `deletedIds`。

`arrangeItem` 给 `itemId` 与 `direction`（`forward` 前移一层、`backward` 后移一层、`front` 移到最前、`back` 移到最后；`sequenceId` 可省略，给了要对得上），调整一个画面实例的叠放次序。叠放次序就是轨道的上下（视频格式规范 §3.3：画面轨道与字幕轨道是同一叠，声音轨道另一叠），操作不写 `paintOrder`：实例与别的实例共用一条轨道时，把它拆到相邻新建的一条同类轨道上（`forward` 在原轨道上面、`backward` 在原轨道下面、`front` 在所有轨道之上、`back` 在这一叠之下），别的实例留在原处，上面的轨道整体让一格、`order` 不出现负数，新轨道列在 `createdIds`，让位的轨道列在 `updatedIds`；实例独占一条轨道时，整条轨道在这一叠里挪位（`forward` / `backward` 与相邻那条互换，字幕轨道也算在内；`front` / `back` 挪到最上 / 最下、其余顺次让位），这一叠原有的那组 `order` 值按新次序重新分配，另一叠的轨道不动。独占轨道的实例已经在最前 / 最后时拒绝（`INVALID_OPERATION`，`details.rule: 'already-at-edge'`，`details.edge: 'front' | 'back'`）；实例或所在轨道锁着时 `TARGET_LOCKED`。拆出去之后与原来相邻实例之间的转场不再相接，按 §4.2 转场的规则删掉并列在 `impact.removedTransitions`。

`moveTrack` 给 `trackId`、`target`（作为参照的轨道，与要挪的轨道在同一叠：画面与字幕轨道一叠，声音轨道一叠）与 `position`（`above` 放在参照上面、`below` 放在下面；`sequenceId` 可省略，给了要对得上），把一条轨道挪到同一叠里另一条轨道旁边：这一叠原有的那组 `order` 值按新次序重新分配，另一叠不动，实例跟着轨道走、不换轨。参照不在同一叠或是自己时拒绝（`INVALID_OPERATION`）；要挪的轨道锁着时 `TARGET_LOCKED`。时间线上拖动行头换顺序用的就是它。

智能体清理素材用 `assets_prune { video, assetIds?, apply?, revision?, commandId? }`（`agent`、`mcp` 与 `cli` 三个面）。不给 `apply` 时只读：列出 `videos.unusedAssets` 的结果（给了 `assetIds` 时只列其中的，成对的另一半带上），另有 `managedBytes`，还有引用的 ID 在 `inUse`、不存在的在 `notFound`，不改视频、不要确认。`apply: true` 时，列出的素材有还在用或不存在的就不提交、直接拒绝（同 `removeAssets` 的错误）；否则确认之后编译成一个 `removeAssets`，返回与 `edits_apply` 相同的回执，另带 `removed`（删掉的清单）。风险等级与 `assets_import` 相同（`edit`）。

智能体采用素材来源自带的章节用 `chapters_adopt { video, asset?, document?, outline?, label?, revision?, dryRun? }`（`agent`、`mcp` 与 `cli` 三个面，风险等级 `edit`）。章节来自 `asset` 的来源（`provenance.source`，视频格式规范 §4.5）：先取结构化的 `chapters[]`，没有时解析 `description` 里的时间戳大纲（至少两行）；给了 `outline`（`[{ at, title }]`，源时间秒，或一段带时间戳的原文）时用它。不给 `asset` 时取视频里唯一带来源章节或简介的素材（几个都带时取其中唯一在时间线上的；给了 `outline` 时也可以是时间线上唯一的音视频素材），选不出一个时 `INVALID_ARGUMENTS`。吸附用的转写是 `document`（须是这个素材的 `speech`），不给时取这个素材唯一的那份（有几份时 `INVALID_ARGUMENTS`），没有转写时不吸附。规则（吸附、清洗与投影）见架构设计 §7.9「采用来源章节」。结果编译成一个 `setChapters`（每章 `at` 为时间线秒与 `title`，不写摘要），整个替换现有的章节；`label` 缺省是本地化的「采用来源章节」。提交前向用户确认，返回与 `edits_apply` 相同的回执，另带 `assetId`、`documentId`（用了转写时）、`notes` 与 `sourceChapters { entries, matched, ambiguous, snapped, unanchored, rows, dropped? }`：`entries` 是来源章节的条数，四个计数是采用的各章的状态，`rows` 每项 `{ title, at, sourceAt, status, anchor?: { tier, snippet }, offTimeline? }`（`at` 时间线秒、`sourceAt` 吸附后的源时间秒），`dropped` 是投影后与前一章落在同一帧而没有采用的。`dryRun: true` 时不确认、不提交，返回 `{ videoId, revision, committed: false, assetId, documentId?, chapters, sourceChapters, notes?, next }`。拒绝：素材的来源没有章节、简介里也没有大纲，或 `outline` 里没有可用的章节时 `NO_SOURCE_CHAPTERS`；素材不在根序列上（没有线性时间映射的启用片段）时 `ASSET_NOT_PLACED`；不认识的素材是 `ENTITY_NOT_FOUND`，不认识的文档是 `DOCUMENT_NOT_FOUND`；字幕与翻译核心没有构建时 `TOOL_UNAVAILABLE`。

### 4.3 需要授权的操作

普通的、可撤销的编辑，在用户直接要求时可以按授权策略直接执行。以下操作需要相应的提案或授权（产品设计 §7）：

- 批量重剪；
- 明显改写含义的修改；
- 付费生成；
- 上传到云端；
- 声音克隆；
- 替换源媒体；
- 覆盖已有的输出。

不把每一个无害的微操作都变成确认弹窗。

付费生成与上传到云端由授权（Grant）逐项给出：按数据种类、接收方、范围、用途与预算（架构设计 §12.5、§7.8）。访问模式与对外服务的等级只决定要不要逐次确认，不代替授权。

### 4.4 导出

导出是 `kind: 'export'` 的 Job（架构设计 §9.11）。类型在 `packages/protocol/src/exports.ts`，参数 Schema 在 `schemas.ts`。

```ts
type ExportSettings =
  | { kind: 'subtitles'; format: 'srt' | 'vtt' | 'ass' | 'json' } & ExportScope & TextExportOptions
  | { kind: 'transcript'; format: 'md' | 'txt' | 'json' } & ExportScope & TextExportOptions & TranscriptExportOptions
  | { kind: 'audio'; format: 'wav' | 'mp3' | 'm4a'; source?: AudioExportSource } & ExportScope & AudioExportOptions
  | { kind: 'video'; format: 'mp4' | 'webm'; source?: AudioExportSource } & ExportScope & VideoExportOptions
  | { kind: 'portable'; format?: 'baocut'; missingAssets?: 'fail' | 'skip' }   // 整个视频，没有范围
  | { kind: 'project'; format: 'xmeml'; sequenceId?: Id };                  // 一条序列，没有范围

type AudioExportSource = 'mix' | 'original' | { dubGroupId: string };   // 默认 mix；只有音频种类接受
interface ExportScope { sequenceId?: Id; range?: { start: number; end: number }; ranges?: { start: number; end: number }[] }
interface TextExportOptions {
  documentId?: Id; language?: string;
  bilingual?: boolean | { documentId?: Id; language?: string };
  maxCharsPerLine?: number;          // 显示宽度，全角算 2；默认 EXPORT_MAX_CHARS_PER_LINE = 42
  timestamps?: boolean;              // 文稿（md、txt）每段末尾写这一段开始的时间；默认 false
  scopeItemIds?: Id[];
}
interface TranscriptExportOptions {  // 只有文稿接受；字幕给了以 invalid-request 拒绝
  frontmatter?: boolean;             // md 开头的 YAML 元信息；默认 false，txt 与 json 不写
  chapters?: boolean;                // 按序列上 kind 'chapter' 的标记写章节小标题；默认 false
  speakers?: boolean;                // 每段写说话人；默认 true
  skipCut?: boolean;                 // 跳过剪掉的部分；默认 true。false 时是剪之前的原文，时间是素材时间
}
interface AudioExportOptions {
  sampleRate?: 22050 | 32000 | 44100 | 48000;   // 默认 48000
  channels?: 1 | 2;                              // 默认 2
  bitrateKbps?: number;                          // 32–320，mp3 / m4a，默认 192；wav 不接受
  loudness?: { integratedLufs: number; truePeakDb: number } | null;   // R128 母带，默认关闭；−70–0 LUFS，−20–0 dBTP
}
interface VideoExportOptions {
  codec?: 'h264' | 'hevc' | 'vp9';     // mp4 默认 h264，可选 hevc；webm 只有 vp9
  width?: number;                      // 输出宽度，16–7680；只给宽时高度按画布比例
  height?: number;                     // 输出高度，16–4320；只给高时宽度按画布比例；都不给是画布尺寸；宽高都取偶数
  fps?: { num: number; den: number };  // 默认序列帧率
  crf?: number;                        // h264 / hevc 0–51（默认 20 / 23），vp9 0–63（默认 32）；与 bitrateKbps 只给一个
  bitrateKbps?: number;                // 视频目标码率
  burnCaptions?: boolean;              // 默认 true
  onUnsupported?: 'fail' | 'skip';     // 默认 fail
  audio?: AudioExportOptions;          // 码率默认 mp4 192、webm 128；没有声音的范围也写一条静音音轨
}

exports.create({ videoId, settings, destination?: { dir?, fileName?, overwrite? }, commandId? }) → { jobId }
exports.get({ jobId }) → JobRecord          // 不是导出的任务 not-found
exports.list({ videoId? }) → { jobs: JobRecord[] }
exports.renderText({ videoId, settings }) → { outputs: RenderedTextOutput[]; warnings: JobWarning[] }   // settings 只能是 subtitles / transcript
// RenderedTextOutput = { fileName, format, mediaType, content, entries, durationSec, words, cjkCharacters }
```

- 范围是序列时间 `[start, end)`，秒；`ranges` 的每一段各出一个文件。时间都是时间线时间：剪切、变速与作用实例的换算在引擎里做（`exports.plan`），剪掉的词不出现。
- 视频必须已经打开（否则 `not-found`，`details.code` 为 `VIDEO_NOT_OPEN`）。`create` 在一个引擎请求里冻结视频版本与全部范围的计划（AT-25），存成 `ExportSnapshot` 产物（`baocut.export-snapshot/1`），再预检：缺失或被改动的素材、空范围、没有可导出的文字、目标目录不可写或指定的文件已存在、缺 ffmpeg、开了响度标准化却找不到 Render Worker（`EXPORT_TOOL_MISSING`，`missing: 'export-worker'`）。预检的拒绝放在 `RpcError.details.code`（§11.4），不创建任务。同一个 `commandId` 返回原来的任务。
- 目标：默认是视频来源目录下的 `exports/`，文件名是「视频名.后缀.扩展名」（后缀是字幕的语言、`subtitles`、`transcript` 或 `audio`；成片是画面里烧着的字幕的语言，没有时不加后缀；几段范围再加 `.partN`），重名加「 (2)」这样的序号，不覆盖已有文件。给了的 `dir` 必须是已经存在、可写的绝对路径；`fileName` 只在出一个文件时可用，已存在时除非 `overwrite` 拒绝。
- 任务在 staging 里生成每个文件，逐个校验（字幕与文稿：解析、条数、时间单调且在范围内；音频：ffprobe 解码的时长在容差内、采样率与声道），取消检查在发布之前；发布是复制进目标目录再硬链接到最终的名字，同时登记为产物。取消清掉 staging，不留半个文件。
- `JobRecord.export` 是 `{ settings, snapshotArtifactId, videoRevision, sequenceId, destination: { dir, files, overwrite } }`。完成时 `result.outputs` 每个文件一项：`artifactId`、`mediaType`、`byteLength`、`media`（字幕与文稿是 `{ kind: 'text', entries, durationSec }`，音频是 `{ kind: 'audio', durationSec, sampleRate, channels }`）、`path`（发布的绝对路径）、`format` 与 `validation`（`checks`、期望与实测的时长与条数、容差；响度标准化时 `loudness: { target, measured: { inputLufs, integratedLufs, truePeakDb }, gainDb }`：`inputLufs` 是母带前的积分响度，`integratedLufs` 与 `truePeakDb` 是母带后的，`gainDb` 是各轮响度归一的静态增益之和）。音频导出的进度是 `{ unit: 'seconds', done, total }`（各段输出的时长之和）；开了响度标准化时每段的一半给混音、一半给母带，各按自己的完成比例走，母带跑的时候进度照样前进。
- `exports.renderText` 只排字幕与文稿的正文，不写文件、不建任务、不碰目标目录（界面导出面板文稿页的预览与预览框右上角的复制）。它与 `create` 走同一段冻结、预检与写法，所以 `content` 与同样设置导出的文件逐字节相同；几段范围时每段一份，`fileName` 是默认目标下预计的名字（真正导出重名时再加序号），`warnings` 与导出任务的相同（几段时 `segmentId` 是那一份的文件名）。`entries`、`durationSec` 与导出结果的 `media` 同义；`words`、`cjkCharacters` 是主文档正文（不含标题、说话人、时间码与译文）里的拉丁词数与汉字数。预检的拒绝与 `create` 相同（`VIDEO_NOT_OPEN`、`EXPORT_SOURCE_*`、`EXPORT_NOTHING_TO_EXPORT`、`EXPORT_RANGE_EMPTY` 等；目标目录的那几项不会出现）；别的种类在参数校验就以 `invalid-request` 拒绝。它只读，在 Web 服务的只读集合里。
- 部分文件没有通过校验或发布失败：任务 `failed`，`error.code` 为 `EXPORT_PARTIALLY_PUBLISHED`，`error.details.failed` 列出每个文件与原因，`result.outputs` 仍然列出已经发布的文件。全部失败时按原因是 `EXPORT_VALIDATION_FAILED` 或 `EXPORT_RENDER_FAILED`。
- 音频的声音来源 `source`（架构设计 §9.13）：`mix` 是成品混音。`original` 停用带 `extensions['baocut.dub']` 的实例（配音与分离出的背景声、人声），并取消这条序列上各配音计划的 `mutedItemIds` 的静音。`{ dubGroupId }` 只留这一组的配音实例，其余全部停用，没有这一组时以 `invalid-request`（`DUB_GROUP_NOT_FOUND`）拒绝。来源换成引擎 `exports.plan` 的 `audioItems { disable, unmute }`，只改这一次的计划，不改视频。成片（`video`）接受同样的 `source`，只换声音计划，画面照旧；其他种类给 `source` 以 `invalid-request` 拒绝。智能体的 `export` 工具同样接受 `source`（`mix`、`original` 或 `{ dubGroupId }`），风险分级不变。CLI：`baocut export <视频> --kind audio|video --audio-source mix|original|dub:<groupId>`。
- 音频的混音与帧计划同一套声音语义（`render-graph`）：增益、音量包络（取代音量，视频格式规范 §3.9；区间计划的段带 `envelope` 折点 `[秒, 线性倍数]`，这时 `gainDb` 为 0）、静音、淡入淡出、变速、转场的声音交叉淡化（等功率，出场一侧取剪切点之后的 handles、入场一侧取之前的）与闪避的压低（v2 曲线在线性增益上展开，斜坡按 0.02 秒烘焙成 dB 折点，逐样本插值），预览与导出在同一时刻的增益相同。按说话触发的闪避：`exports.plan` 把视频里每份转写（`kind: speech`）投到序列上，词的区间就是触发区间（视频格式规范 §3.9、§5.7）；预览把同一批转写送进逐帧计划（`bindings/preview-wasm` 的 `bc_set_speech`），用同一份投法，转写正文取到之后两边压低得一样多。
- 与预览不一致的地方写在 `JobRecord.warnings`：音量或包络的最高点高于 1 即 0 dB（`GAIN_ABOVE_PREVIEW`，预览最高到 0 dB）、按说话触发的闪避因为有效词流为空没有压低（`DUCK_NO_SPEECH`）、定格不出声（`HOLD_IS_SILENT`）、交叉淡化要的 handles 超出素材、缺的部分导出为静音（`CROSSFADE_HANDLE_SHORT`）、ASS 表达不了的样式（`ASS_STYLE_UNMAPPED`）、按词估计的字幕拆点（`CUE_SPLIT_AT_ESTIMATED_TIMES`）、被剪得不完整的句子没有配译文（`TRANSLATION_SKIPPED_PARTIAL_SENTENCE`）、标成过期的译文单元没有写出（`TRANSLATION_SKIPPED_STALE`）、响度无法测量（`LOUDNESS_NOT_MEASURABLE`，这时只做真峰值兜底）等。
- 便携包（`portable`，架构设计 §5.8，视频格式规范 §8）：一个文件「视频名.baocut」，`mediaType` 为 `application/x-baocut-package`，`artifactId` 是整个文件的 sha256（包不复制进产物库）。预检的拒绝：读不到的素材版本 `ASSET_MISSING`（`conflict`，`details.items` 每项 `{ assetId, revision, name, reason }`，`reason` 例如 `missing`、`unreadable`、`changed`、`outside-project`）；正文里写着本机路径的文档 `EXPORT_PACKAGE_LOCAL_PATH`（`invalid-request`，`details.items` 每项 `{ documentId, revision }`）；写不进 ustar 的文件 `EXPORT_PACKAGE_UNSUPPORTED`（`invalid-request`）；目标盘空间不够 `EXPORT_INSUFFICIENT_SPACE`（`conflict`，`details.required` / `available`）；以及与其他种类相同的 `EXPORT_DESTINATION_EXISTS`。`missingAssets: 'skip'` 时读不到的素材不收进包，每项一条 `PACKAGE_ASSET_MISSING` 警告；快照里其余字段的本机路径换成占位时有 `PACKAGE_LOCAL_PATH_REMOVED` 警告。执行时链接素材变了是 `ASSET_CHANGED`，写满盘是 `EXPORT_INSUFFICIENT_SPACE`，写完重读核对不符是 `EXPORT_VALIDATION_FAILED`。进度是 `{ unit: 'bytes', done, total }`。`result.outputs[].media` 是 `{ kind: 'package', files, assets, missingAssets, documents }`，`validation.package` 是 `{ files, verifiedFiles, bytes }`。range、ranges 与 sequenceId 以 `invalid-request` 拒绝。
- 工程（`project`，架构设计 §9.13）：一条序列（默认主序列）写成 Final Cut Pro 7 XML，文件「视频名.xmeml.xml」，`mediaType` 为 `application/xml`。素材按本机路径引用。表达不了的每项一条 `PROJECT_ITEM_OMITTED` 警告（`detail` 写实例的 ID 与名字）；没有能写出的片段 `EXPORT_NOTHING_TO_EXPORT`，序列不存在 `EXPORT_SOURCE_NOT_FOUND`。`result.outputs[].media` 是 `{ kind: 'project', clips, omitted, durationSec }`。range 与 ranges 以 `invalid-request` 拒绝。
- 成片（`video`，架构设计 §9.11 的「成片的实现」）：文件名是「视频名.mp4」或「视频名.webm」；字幕烧进画面（`burnCaptions` 没有关掉）时加上这些字幕的语言，按时间线从上到下、去重后用 `-` 连起来（「视频名.zh-Hans.mp4」「视频名.en-zh-Hans.mp4」），只算这次画进画面的字幕轨（可见、独显规则同画面）上启用的字幕实例，文档没写语言的不算（`@baocut/protocol` 的 `burnedCaptionLanguages`）；几段范围加 `.partN`。MP4 是 H.264 或 HEVC 加 AAC，WebM 是 VP9 加 Opus，都是 BT.709 标记的 yuv420p。预检由 Render Worker 跑：画不出来的内容以 `EXPORT_UNSUPPORTED_CONTENT` 拒绝（`RpcError.code` 为 `invalid-request`），`details.items` 每项是 `{ itemId, scope, layerKind, effectId?, transitionId?, kind?, reason, message }`——`scope` 是 `layer`（整层不画）、`effect`（跳过这个效果）、`transition`（按硬切）或 `asset`（素材解不出画面，整层不画），`reason` 例如 `generator-not-implemented`、`bundle-without-prerender`、`asset-undecodable`、`preset-unknown`、`preset-missing`、`lottie-asset-missing`、`lottie-unreadable`、`template-missing`、`template-logo-image-not-supported`、`sticker-asset-not-supported`、`placeholder-asset-not-supported`、`effect-unknown-kind`、`transition-not-implemented`、`caption-document-missing`、`caption-unknown-document`、`caption-style-missing`、`caption-unknown-style`；判断与预览列出的是同一处（架构设计 §9.1）。`onUnsupported: 'skip'` 时不拒绝，每项一条 `EXPORT_CONTENT_SKIPPED` 警告。进度是 `{ unit: 'frames', done, total }`。`result.outputs[].media` 是 `{ kind: 'video', durationSec, width, height, videoCodec, audioCodec, frames, fps }`（与文件转码同一个变体；`frames`、`fps` 在成片导出里一定有，转码可以没有），`validation.video` 是 `{ expectedFrames, frames, width, height, fps, streams }`：帧数差不超过一帧，画面与声音的时长在一帧之内（声音另加 50 ms）。输出尺寸：`width`、`height` 只给一个时另一边按画布比例，画面铺满；两个都给时输出就是这个尺寸，画面按画布比例放到放得下的最大（放不满的一边取偶数），居中，其余是黑边（画布比输出宽是上下黑边，窄是左右黑边），画面里的排版按画布缩放、不按输出的比例重排；尺寸由引擎定（`exports.plan` 的 `output`），Runtime 与 Worker 照用。界面的导出面板在「画幅」里缺省「跟随画布」（不带宽高，只换分辨率时只给 `height`），可换 16:9、9:16、1:1、4:5（与画布同比例的档不列）：短边由分辨率档定、长边按画幅推并取偶数，宽高都给，面板写明是加黑边；CLI 的 `--width`、`--height` 与智能体导出工具的 `width`、`height` 照 `exports.create` 的规则（工具的审批摘要写出尺寸）。成片的警告：`EXPORT_SIZE_ADJUSTED`（宽高调成了偶数）、`EXPORT_RENDER_NOTE`（渲染内核的提示，例如跳过的元素参数、没有频谱的声波、太大只画第一帧的 GIF、内置与本机字体里都没有的字体族；`detail` 写实例 ID 与提示）、`EXPORT_CONTENT_SKIPPED`、`FONT_NOT_DOWNLOADED`（字体目录里有的族没下载或下载失败、照回退字体画，架构设计 §9.11；`detail` 是「「族」字重：原因，用「回退族」代替」，`font` 是 `{ family, weight, italic, fallback, reason }`；不拒绝导出，也不要求先选替代字体），以及与音频导出相同的混音警告。导出用到要下载的字体时，任务开始画之前有一段 `downloading` 阶段（进度按字节，这些下载不另建 `fontDownload` 任务）；取消导出只取消导出自己开始的下载，别处（选字、打开视频、预览）已经在下的同一个 face 导出只是等它，取消导出不取消它。
- 文稿的写法（架构设计 §9.13）：句子按编辑器文稿面板的规则（`TRANSCRIPT_PARAGRAPH`）分段，段落之间空一行。Markdown 以 `# 视频名` 开头，纯文本没有标题。
  - 时间码（`timestamps`）：段末加 ` [mm:ss]`（满一小时 `[hh:mm:ss]`），是这一段开始的时间，不加反引号；双语时跟在原文段末。
  - 说话人（`speakers`，默认开）：段里有说话人时每段都写，只有一位也写；Markdown `**名字:** 正文`，纯文本 `名字: 正文`，冒号固定是半角，不随界面语言；说话人没有名字时用「说话人 N」。关掉时 JSON 也不带 `speaker`。
  - 章节（`chapters`）：序列上 `kind: 'chapter'` 的标记，在这一章开始处断段，小标题写在这一章的第一段前：Markdown `## 章名 · mm:ss`（`timestamps` 关掉时只写章名），纯文本 `— 章名 —`；之后没有段落的章不写。JSON 不写章节。
  - 文首元信息（`frontmatter`，只有 Markdown）：`# 视频名` 之前一段 `---` 包住的 YAML，字段依次是 `title`、`description`、`source`、`author`、`published`、`platform`、`duration`、`language`、`translation`，缺的不写；之后 `speakers` 列出正文里出现的说话人（关掉说话人时不列），`chapters` 列出写了的章节（`"[mm:ss] 章名"`）。值都写成 JSON 字符串、换行折成空格。`source`、`author`、`published`（`YYYY-MM-DD`）与 `platform` 取主文档素材的链接导入来源，`duration` 是这份文稿的时长，`language` 与 `translation` 是主文档与双语副文档的语言；现在没有视频简介，`description` 不写。
  - 不跳过剪掉的部分（`skipCut: false`）：不经时间线投影，直接从文档正文取原文（转写的词、字幕层的句子；文稿里删掉即隐藏的词仍然不要），时间是文档自己的素材时钟，章节换到原文里对应的位置。没有范围时是整份文档；给了范围时取这段范围投影到的第一条与最后一条之间的原文，其间剪掉的也在。校验的时长取原文跨度与素材时长中较长的那个。
- 逐词时间只在每个词的时间都可信时写出（AT-05）：JSON 的 `wordTiming` 为 `word`、`partial` 或 `none`，句级文档与插值、缺失的词不写 `words`。

### 4.5 Speech Worker

字幕与翻译核心的私有 Worker（架构设计 §7.9、§13.1），不是客户端的命令面：固定流程的一步启动它，客户端看不到它。传输与 Model Worker 相同：stdio 上一行一个 JSON，Runtime 发 `{ id, method, params }`，Worker 回 `{ id, result }` 或 `{ id, error: { code, message, details? } }`，主动推 `{ event, params }`；一行裸的 `cancel` 等同 `cancel` 请求。协议名 `speech-worker/1`。Runtime 一侧在 `packages/jobs/src/pipelines/speech-worker.ts`（`runSpeechTranslate`），Worker 在 `crates/speech-worker`。

| 方向 | 消息 | 内容 |
| --- | --- | --- |
| Runtime → Worker | `hello` | 结果 `{ protocol: 'speech-worker/1', version, methods: ['translate'] }`；协议不符时 Runtime 不用这个 Worker（`WORKER_INCOMPATIBLE`） |
| Runtime → Worker | `translate { input, staging }` | 冻结的输入文件与这一步的 staging 目录，都是绝对路径。结果 `{ translation, cues, report, unitCount, cueCount, llmCalls }`，前三项是 staging 里的文件名 |
| Worker → Runtime | 事件 `llm.request` | `{ requestId, kind, attempt, system, user, temperature, maxOutputTokens }`：一次模型调用。`attempt` 是核心对这个 kind 的第几次重试（从 0 起）；`maxOutputTokens` 只有文件契约的 kind 有（按输入定标，4096–16384），其余为 null |
| Runtime → Worker | `llm.reply` | `{ requestId, text }` 或 `{ requestId, error: { code, message, class, status? } }`，结果 `{}`。不是在等的那次调用时 `UNEXPECTED_REPLY` |
| Worker → Runtime | 事件 `progress` | `{ stage, done, total }`，`stage` 为 `brief`、`translate`、`align`、`row-repair`、`write`；`translate` 的单位是句 |
| Worker → Runtime | 事件 `checkpoint` | `{ phase, pages, translatedSentences }`：检查点刚写好 |
| Worker → Runtime | 事件 `resumed` | `{ phase, translatedSentences, totalSentences }`：从上次的检查点继续 |
| Runtime → Worker | `cancel` | 结果 `{}`。在跑的任务停在下一次调用或退避之前，以 `CANCELLED` 结束，检查点保留 |

- 一次只跑一个任务；任务期间到的别的请求（`hello`、`cancel`、`llm.reply` 除外）排到任务结束之后处理。stdin 关闭等同取消，任务收尾之后进程退出（退出码 0）。带命令行参数启动时退出码 2。
- `class` 决定核心怎样处理一次失败：`retryable`（传输失败，`status` 是 HTTP 状态，核心按自己的退避重试）、`malformed`（答案不可用，核心重发、拆页或补做）、`terminal`（不再发起调用，任务以这个 `code` 失败）、`cancelled`（同 `cancel`）。Runtime 怎样分类见架构设计 §7.9。
- 错误码：`INVALID_PARAMS`（缺路径；原文与目标语言的主子标签相同）、`METHOD_NOT_FOUND`、`UNEXPECTED_REPLY`、`INPUT_UNREADABLE`（输入读不了、不合格式或没有可翻译的句子）、`STAGING_WRITE_FAILED`、`MODEL_OUTPUT_INVALID`（核心的重发与补做用完仍有句子没有合格的译文，`details.missingSentences` 列出；检查点保留，重试只补这些句子）、`PROVIDER_UNAVAILABLE`（`retryable` 的失败用完了核心的重试）、`CANCELLED`，以及 `terminal` 应答自己的 `code`（例如 `BUDGET_EXCEEDED`；没有时 `PROVIDER_REJECTED`）。任务的失败在 `details` 里带 `phase` 与 `translatedSentences`。

输入（`baocut.speech-worker.translate/1`，不认识的字段拒绝）：

```ts
interface SpeechTranslateInput {
  schema: 'baocut.speech-worker.translate/1';
  media: { assetId: Id | null; path?: string; contentHash: string; duration: MediaTime; sampleRate?: number };
  sourceLanguage: string | null;      // 转写的语言；不知道时 null
  speechRef: { id: Id; revision: string };
  sequenceId: Id;
  speech: SpeechBody;                 // baocut.speech/1 正文（视频格式规范 §5.2）
  targetLanguage: string;             // BCP 47
  glossary: { source: string; target: string; note?: string }[];   // 冻结、去重之后的术语
  glossaryRef: GlossaryRef | null;    // 原样写进译文
  params?: { instructions?: string; backoffScale?: number };       // 风格提示；退避时长的倍数，默认 1
}
```

产出都写在 staging 里，先写临时文件再改名：

- `translation.json`：`baocut.translation/2` 正文（视频格式规范 §5.3）。每次都是一份新的译文，不读已有的。句子按字幕与翻译核心的规则派生，`sourceFingerprint` 是核心的指纹，`sourceBasis.editViewHash` 是 `{ derivation: 'speech-doc/sentences', sentences: [[id, fingerprint], …] }` 的摘要。
- `cues.json`：`{ schema: 'baocut.speech-worker.cues/1', language, timescale, cues: { unitId, sentenceId, text, start, end, fallback }[] }`。时间是转写时钟（`timescale` 与转写相同）的整数刻度，夹在媒体时长之内，按时间排好、不重叠；空的与零长的不写。`fallback` 是对齐不可用、按句时长摊开的那几条。
- `report.json`：简报（`skipped`、`generated`、`degraded`、`resumed`）、分页、对齐、收尾轮、调用数与提示，供摘要与诊断。
- `checkpoint.json`：见架构设计 §7.9 的「断点」。

Runtime 读回之后核对：译文按视频格式规范 §5.3 的形状与冻结的 `speechRef`，字幕条按上面的规则；不合时这一步以 `WORKER_OUTPUT_INVALID` 失败，Worker 意外退出时以 `WORKER_FAILED` 失败。Worker 自己的错误照它的 `code` 成为这一步的错误，`terminal` 应答引起的失败改抛 Runtime 一侧原样的错误。

---

## 5. 回执

事务持久化成功之后返回回执。回执是「这次修改确实发生了」的唯一依据；界面与智能体都不得在收到回执之前宣称修改已完成。

```ts
// 字段集合为本规范补全
interface TransactionReceipt {
  transactionId: Id;
  commandId: Id;
  status: 'committed';
  videoId: Id;
  previousRevision: Revision;
  videoRevision: Revision;
  eventSeq: string;
  layer?: 'instance' | 'parameter' | 'source';     // 代码合成的修改属于哪一层
  createdIds: Id[];
  updatedIds: Id[];
  deletedIds: Id[];
  lineage: Record<Id, Id[]>;                       // 旧实例 → 由它产生的新实例
  impact: {
    oldDurationFrames?: number;
    newDurationFrames?: number;
    captionProjection?: 'unchanged' | 'recomputed';
    translationUnitsStale: Id[];
    dubbingUnitsStale: Id[];
    orphanedAnchors: Id[];                         // 语义锚求不出、摆不下而留在原处的实例（视频格式规范 §3.16）
    invalidatedCaches?: string[];
    removedTransitions?: { id: Id; reason: 'item-deleted' | 'not-adjacent' | 'too-long' | 'handles-insufficient' | 'overlap' }[];
    shortenedTransitions?: { id: Id; durationFrames: number; effectiveFrames: number }[];
    removedByCuts?: Id[];                          // 随剪口删掉的实例（视频格式规范 §6.7）
    cutsNotRelaid?: Id[];                          // 恢复了、找不到接缝放回去的剪口
    removedWithTarget?: Id[];                      // 跟着的目标（item-local）被删掉、一起删掉的实例（视频格式规范 §3.16）
    removedTracks?: Id[];                          // deleteTrack 删掉的空轨道（§4.2）
    removedAssets?: Id[];                          // removeAssets 删掉的素材记录，含成对带走的代码包或预渲染替身（§4.2）
  };
  timeResolution?: TimeQuantizationReceipt[];      // §6
  preserved: Id[];                                 // 明确保持不变的对象
  provenance?: { taskId?: Id; runId?: Id; jobIds?: Id[]; proposalId?: Id };
  undo: { available: boolean; token?: string; scope?: string; unavailableReason?: string; unavailableReasonRef?: MessageRef };
}
```

回执必须显示：

- 新建、更新与删除的对象 ID；
- lineage：拆分与裁切之后新旧实例的对应；
- 提交前后的版本；
- 时长的变化；
- 失效的依赖：哪些译句、配音单元、锚点需要处理；
- 被连带删掉的对象与原因：编辑之后不再成立的转场在 `impact.removedTransitions` 里（视频格式规范 §3.9），它们的 ID 也在 `deletedIds` 里；随实例变短的单侧转场在 `impact.shortenedTransitions` 里（写入的长度与生效的长度）；随剪口删掉的实例在 `impact.removedByCuts` 里；
- 来源：哪个任务、哪次执行、哪些计算；
- 可以撤销的范围；
- 明确保持不变的对象。

**删除实例通常只删除引用**，不删除原始媒体、识别结果、声音或已付费的产物。

失效的依赖必须如实报告。例如句间停顿的删除不改变译句的内容，`translationUnitsStale` 为空；句内的删除必须按有效句的指纹报告过期（视频格式规范 §5.7），不能固定返回空数组。

---

## 6. 时间输入与量化回执

类型 `TimelineTimeInput`、`FrameAlignment` 与 `TimeQuantizationReceipt` 的定义见视频格式规范 §2.8 与 §2.9。本章规定它们在协议中的用法。

### 6.1 输入

- 视觉时间命令接受 `TimelineTimeInput`。`seconds` 与 `frames` 是互斥的两种输入，不同时出现。
- 命令中的 `sequenceId` 与信封上的 `expectedRevision` 确定这个输入属于哪个帧网格。
- **只包含裸帧号、无法确定序列与帧率的命令一律拒绝**（`TIME_DOMAIN_MISMATCH`）。
- 词、句、occurrence 的锚点是口播与语义编辑的优先输入。「跟着这句话」发送锚点，由引擎解析当前的关系；不让调用方先换算成秒。
- 界面与智能体不自行算帧。「晚两秒」发送的是相对偏移，不是调用方算出的帧号。

### 6.2 三个值分开

协议区分三个值，三者都出现在回执里：

| 值 | 含义 |
| --- | --- |
| `requested` | 调用方发来的、格式化的输入 |
| `requestedTime` | 输入解析成的精确时间 |
| `actualFrame` / `actualTime` | 量化之后实际落在的帧与时间 |

`delta` 是实际值减去请求值。回执中的 `requestedTime`、`actualFrame`、`actualTime`、`delta` 与 `editFps` 不可缺失。之后的读取必须使用 `actualFrame` 或权威的时间，不从格式化的文本反推。

### 6.3 量化在事务内完成

- 引擎在读取本次基线版本之后解析时间输入，对视觉目标**量化一次**，并与编辑操作、依赖影响、回执和事件序号一起原子提交。
- 预检（§7）使用同样的算法，但不保留成功的承诺。
- 正式提交时，如果帧率或视频版本已经改变，必须返回冲突。**不按新的帧率悄悄重新解释旧的预览。**

### 6.4 量化不能扩大范围

请求的范围与实际的结果都参与权限、保护与锁定的检查。量化不能成为扩大删除范围、突破锁定轨道或吞掉一个词的理由。量化之后长度为零、越界或破坏了安全区间时，返回 `TIME_RANGE_COLLAPSED`，不自动补一帧，也不自动扩大删除。

### 6.5 修改编辑帧率

`changeSequenceFrameRate` 是一组有明确关联范围的编辑事务。没有通过 `preserve` 策略与依赖校验时，不能部分修改 `Sequence.fps`。规则见视频格式规范 §2.12。

---

## 7. 批量预检

智能体常常需要一次提交多个相关的修改。预检让它先看到这批修改的影响，再决定是否提交。**预检是提案，不是预留的成功。**

### 7.1 两个方法

```ts
// 本规范补全
interface PrepareBatchRequest {
  videoId: Id;
  baseRevision: Revision;
  operations: EditOperation[];
  label: string;
}

interface PreparedBatch {
  proposalHash: string;
  baseRevision: Revision;
  normalizedOperations: EditOperation[];
  readSet: Array<{ entityId: Id; revision: Revision }>;
  impact: JsonValue;                      // 与回执的 impact 同形
  timeResolution: TimeQuantizationReceipt[];
  warnings: Array<{ code: string; entityIds: Id[]; message: string }>;
  protectedObjects: Id[];
  estimatedCost?: JsonValue;
  failedOperationIndex?: number;          // 预检失败时
  failure?: ErrorBody;                    // §11.1
}

interface ApplyPreparedRequest {
  proposalHash: string;                   // 与批准的内容一致
}
```

`edits.applyPrepared` 通过普通的命令信封发送，带新的 `commandId` 与 `expectedRevision`。

### 7.2 prepareBatch

`edits.prepareBatch` 根据冻结的 `baseRevision` 执行领域校验，返回：标准化之后的操作、`readSet`、影响摘要、警告、受保护的对象、预计的成本和 `proposalHash`。

Agent 面的 `edits_apply` 另有一个较轻的预检 `dryRun: true`（它不是 `prepareBatch`，`prepareBatch` 还没有实现）：走提交路径里引擎之前的每一步——产物换成导入操作、补全操作、对外服务的路径限制、按 schema 检查每个操作、核对引用的已有对象与素材文件在不在、`expectedRevision` 是不是当前版本——出错时与引擎拒绝同一个错误码（版本对不上是 `PROJECT_REVISION_CONFLICT`，其余是 `INVALID_OPERATION`，带第一个出问题的操作与全部问题），通过时返回补全后的操作与影响（`committed: false`）。它不提交、不进历史、不要确认；同轨重叠、锁定与任务保护只有引擎在提交时才检查，预检通过不代表提交一定成功。CLI 是 `baocut edits apply … --dry-run`。

它**不**做这些事：

- 不增加视频版本；
- 不注册一个假的成功任务；
- 不长期持有锁；
- 不执行需要计算或购买的步骤——这些另起 Job。

### 7.3 applyPrepared

`edits.applyPrepared` 重新检查：

- 授权是否仍然成立；
- 任务的执行代是否仍然有效；
- 锁定与保护的对象；
- 视频的当前版本。

P0 下只要有任何版本冲突就拒绝。**不能因为预检曾经成功就盲写。**

- 一批中任何一个操作失败，返回 `failedOperationIndex` 与原因，整批不部分落盘。
- 相同的幂等键、相同的载荷，返回原回执。
- `proposalHash` 与当前要提交的内容不一致时拒绝。

### 7.4 上限与拆批

操作个数、输入体积和预检的计算量都有上限，由能力快照返回（架构设计 §3.6）。

超过上限需要拆批时，必须显式呈现为多个提交，并用共同的 `runId` 或 `changeGroup` 关联。不能伪称多个批次仍然是一个原子事务。

### 7.5 适用范围

- 相邻的、低风险的修改可以组成一批。
- 长时间的模型计算与跨视频的写入不得塞进一个批次。
- 人工手势仍然走单笔事务的路径（§9），不被强制包装成一次模型回合。

---

## 8. ChangeSet、检查点与撤销

### 8.1 ChangeSet

ChangeSet 是一组**待应用**的修改及其说明：操作、`baseRevision`、`readSet`、直接影响、需要联动检查的对象，以及保持不变的对象集合。

- ChangeSet 可以预览，但它不是一份可以独立演进的工作稿。
- 提交为事务之后才有正式的回执。
- 候选（Candidate）是一个可以打开查看的 ChangeSet 或独立版本。未应用的候选不是工作稿。

### 8.2 检查点

- 大幅度的结构变更之前保存检查点。
- **P0**：命名检查点、按顺序撤销、经过验证的单笔补偿。
- **P1**：完整的分支与合并。
- 「再做一版」创建候选或独立的版本。「恢复配色」只恢复目标属性，不回滚整个视频。

### 8.3 撤销是补偿事务

撤销是针对某一笔已提交事务的**补偿事务**，提交时检查目标对象的当前状态。

- 不用旧的全视频快照覆盖当前状态。用户撤销自己的一次修改，不会抹掉智能体之后添加的补充画面。
- 涉及外部资产的操作只撤销引用，不删除可能被其他对象使用的生成结果。
- 撤销不能撤回已经发生的云端计费。
- 没有安全的补偿实现的操作，不显示可用的撤销按钮；回执中 `undo.available` 为 `false`，并说明原因。
- 恢复已剪掉的内容也是一笔新的事务（视频格式规范 §6.2）。
- 补偿之后会留下不成立的转场时（视频格式规范 §3.9），撤销被拒绝（`UNDO_CONFLICT`，`details.removedTransitions` 列出这些转场与原因），不悄悄删掉它们。

### 8.4 任务级的撤销

一个长任务的多笔事务构成一组可以识别的操作（共同的 `taskId` / `runId`）。

- 可以「撤销这次字幕生成的应用」，而不要求删除原始的识别产物。
- 「停止并撤销」先建立停止屏障，再逐笔验证补偿；不回滚整份旧视频（架构设计 §7.4）。
- 网络等待期间不长时间锁住视频。

---

## 9. 手工交互

### 9.1 手势

```text
pointerdown  → 建立手势（gesture）
pointermove  → 更新临时覆盖层，不提交
pointerup    → 生成一笔事务
```

- 确认之前可以乐观显示。事务失败时回滚**这个手势**，不恢复整个旧视频。
- 选择与视口保存为界面偏好，不进入业务的撤销栈。
- 手势进行中的临时状态不进入视频，也不被智能体读到。

### 9.2 文本输入

- 文本输入合并成明确的编辑会话。光标移动不产生视频历史。
- 输入法的组合文本属于未完成的输入，不能被提交。
- 自动提交的节流值可以调节。但数据安全不能依赖「每隔几分钟保存一次全量快照」。

### 9.3 已确认即已落盘

向用户确认过的编辑，必须已经持久化。界面不得在收到回执之前显示「已保存」。

### 9.4 发送请求之前

用户提交自然语言请求之前，客户端先结算这次请求所引用的本地编辑，再冻结上下文（ContextBarrier，架构设计 §4.6）。有未能持久化的引用编辑时返回 `CONTEXT_PENDING_EDITS`，不静默读取旧版本。

发送给智能体的选区包含 `videoRevision`、`sequenceId`、实例 ID、词锚和可见的帧范围，不是一句「当前那一段」。任务完成之后重新校验输入的版本；旧的结果可以保留为产物，但不能自动套到新的选区上。

---

## 10. 事件

### 10.1 视频事件

```ts
// 字段集合为本规范补全
interface VideoEvent {
  videoId: Id;
  eventSeq: string;                  // 视频内单调递增
  videoRevision: Revision;
  transactionId: Id;
  changedIds: Id[];
  projection: JsonValue;             // 客户端可以直接消费的投影变化
  actor: { kind: 'user' | 'agent' | 'system'; id: Id };
  taskId?: Id;
}
```

- `eventSeq` 与视频版本在视频存储中持久化。Runtime 的运行代只标识服务的一次运行，不参与排序。
- 会话序号、Job 序号与视频事件序号**分别管理**，不共用一个含糊的游标。

### 10.2 投递

- 事件与视频变更在同一笔事务中写入 outbox。Runtime 从已提交的 outbox 推送。
- 投递语义是**至少一次**。客户端按 `videoId + eventSeq` 去重。
- Runtime 在提交之后、广播之前崩溃，重启后从 outbox 继续推送；已确认的编辑不会丢失恢复路径。

### 10.3 订阅与缺口

- 订阅取得同一水位的快照与其后的事件。
- 客户端按顺序应用事件。发现序号缺口时，暂缓提交，补取事件或重新取快照。**不在缺事件的镜像上继续修改。**
- 候选与界面的临时手势单独保存。重连失败时，不得用旧的全量快照覆盖服务端。
- 「已连接」不等于「数据已追平」。客户端在追平之前显示的是缓存。

### 10.4 其他事件流

| 流 | 内容 | 序号 |
| --- | --- | --- |
| 会话 | 消息、流式文本、任务卡片、审批卡与提示。审批卡（`approval`）的 `request` 是 `command`、`file-change` 或 `tool { tool, files, reason }`，带 `risk`、当时的 `mode` 与 `decidedBy`（`auto` 由决策表直接决定，`user` 由用户处理）。任务条目带最新的合同 `contract`，合同每次修订都更新这个条目 | 每个会话独立 |
| 任务（`tasks` 主题） | 快照是全部任务的摘要与待处理的审批（`{ tasks, approvals }`，`approvals` 见 §4.1 的 `PendingApproval`）；摘要带合同的最新修订号 `contractRevision`；任务变化（含合同的修订）发 `task.upsert` / `task.removed`；审批出现时发 `approval.upsert { approval }`，结束时发 `approval.removed { approvalId, outcome }`（`allowed`、`denied`、`timeout`、`cancelled`）。服务审批同样在这里，同时照旧经 `services` 主题送达 | 主题独立；客户端按 `approvalId` 增删审批 |
| 任务与 Job | 状态变化、进度、需要对账。Job 走 `jobs` 主题：快照是全部任务记录（新的在前），每次状态、阶段或进度变化发 `job.updated`，带完整的记录；转录任务新识别出段落时发 `job.segments { jobId, from, segments }`（`segments` 是 `{ start, end, text }`，素材时钟上的秒；`from` 是第一段在这个任务全部段落里的序号，崩溃后的自动重试从 0 重来），快照的 `liveSegments` 按 `jobId` 给出在跑的转录任务到目前为止的全部段落（没有时省略）；客户端已有的序号替换、`from` 越过已有段数时忽略这条等快照补齐，记录不再是 `running` 时丢掉这个任务的段落（架构设计 §6.6「实时文稿」）；生成任务的记录带冻结的 `generation` 参数，完成后 `result.outputs` 列出每个输出（`artifactId`、媒体类型、长度、媒体事实、导入得到的 `assetId`），进度单位是 `outputs`；文本生成的记录带冻结的消息与输出格式，结果是 `result.text`（§4.1） | 每个任务独立 |
| Space（`space` 主题） | 快照是 `{ entries, issues, scanning }`；条目新增或任何字段变化（扫描、用户标记、Job 状态与进度、视频版本带来的 `applied` / `source-changed`）发 `entry.upsert`，带完整的条目；移除发 `entry.removed { entryId }`；首次扫描完成、`space.rescan` 与 `space.rebuildIndex` 发 `catalog.replaced`，带新的快照（扫描问题只随快照下发）。内容索引的进度不发事件，以 `space.search` 结果的 `complete` 为准 | 主题独立；客户端按 `id` 替换条目，`catalog.replaced` 时整体替换 |
| 用户库（`library` 主题） | 快照 `{ entries }` 是全部条目的摘要（`LibraryEntrySummary`）；新建或修改（含音色克隆的变化）发 `entry.upsert`，带新的摘要；删除发 `entry.removed`，带 `library` 与 `id` | 主题独立 |
| 模型服务（`models` 主题） | 快照是 `{ capabilities, bundles }`：完整的能力视图（`models.capabilities` 的结果）与本地模型包的状态（`models.list` 的结果）；配置（含 API 提供方的账号与账号状态）、默认值、模型包或节点变化时发 `capabilities.updated`，带完整的新视图；一个模型包的状态变了（安装进度、暂停、装好、删除、检查、运行状态）发 `bundle.updated { bundle }` | 主题独立；能力视图不发增量，客户端整体替换；模型包按 `bundleId` 替换 |
| 授权（`grants` 主题） | 快照 `{ grants }` 是全部授权（含已撤销、到期、用完的，`grants.list` 加 `includeEnded`）；发放、修改、撤销、用量变化发 `grant.upsert { grant }`，带完整的新记录；被裁剪的旧授权发 `grant.removed { grantId }`。Web 服务的浏览器订阅不了（`WEB_TOPIC_NOT_ALLOWED`） | 主题独立；客户端按 `grantId` 替换 |
| Agent（`agents` 主题） | 快照是 `agents.list` 的视图（`AgentsView { drivers, checking, preferences }`，启动时是上次的探测结果）；每个 Driver 的探测完成（启动时的后台刷新、`agents.detect`、改可执行文件、安装结束、运行中出错后的纠正）、Agent 偏好的任何变化（含偏好设置里的 `agent.defaultDriver`）与用户添加或移除智能体（`agents.addProvider`、`agents.removeProvider`）发 `agents.updated { view }`，带完整的新视图。浏览器订阅要求白名单里有 `agents.list`（架构设计 §3.11） | 主题独立；不发增量，客户端整体替换 |
| 偏好设置（`settings` 主题） | 快照是全部键的有效值与默认值（`{ settings, defaults }`）；有效值变化时发 `settings.updated`，`changed` 只带变了的键与新的有效值（恢复默认时是默认值），没有变化的修改不发 | 主题独立；客户端把 `changed` 合进快照 |
| 旧版项目导入（`legacy-import` 主题） | 快照是 `legacyImport.get` 的结果（`{ prompt, run }`）；询问出现、被回答或 Runtime 不再等时发 `prompt.updated { prompt }`，导入每有进展（开始、一项有了结果、等待与继续、重试、跳过）发 `run.updated { run }`，都带完整的新状态。Web 服务的浏览器订阅不了（`WEB_TOPIC_NOT_ALLOWED`） | 主题独立；客户端整体替换 |
| 对外服务（`services` 主题） | 快照是全部服务的状态与待处理的服务审批（`{ services, approvals }`）；状态、配置、客户端或最近的请求变化时发 `service.updated`，带完整的 `ServiceStatus`；`ask` 等级下的请求发 `approval.requested`（调用方、工具、目标视频、参数摘要与到期时间），回答、超时或取消时发 `approval.resolved { approvalId, outcome }`（`allowed`、`denied`、`timeout`、`cancelled`）。事件里没有令牌，也没有 Web 服务的访问代码与会话令牌；浏览器会话的建立与吊销同样发 `service.updated` | 主题独立；客户端按 `serviceId` 替换状态，按 `approvalId` 增删审批 |

- 流式文本可以合并小块，但保留消息的身份与完成边界。
- 终态事件与权限事件不可因节流而丢失。
- 视频、音频、预览帧与缩略图不走事件通道（架构设计 §4.5）。

---

## 11. 错误合同

### 11.1 结构

```ts
interface ErrorBody {
  code: string;
  message: string;                   // 给人看的说明；程序不解析它
  entityIds: Id[];
  inputRevisions: VersionRef[];
  retryability: 'same-command' | 'after-refresh' | 'after-user-action' | 'never';   // 取值为本规范补全
  details: JsonValue;
  recovery?: string;                 // 建议的恢复方式
  messageRef?: MessageRef;           // message 的消息引用（§11.1 末尾）
  recoveryRef?: MessageRef;          // recovery 的消息引用
}
```

错误响应必须包含 `code`、`entityIds`、`inputRevisions`、`retryability` 与 `details`。不得只返回一段需要智能体去猜的 stderr。

| `retryability` | 含义 |
| --- | --- |
| `same-command` | 可以用同一个 `commandId` 原样重试 |
| `after-refresh` | 重新读取之后，形成新的操作再提交 |
| `after-user-action` | 需要用户补齐、授权或做出选择 |
| `never` | 这个请求不会成功 |

网关的错误 `RpcError` 是 `{ code, message, details?, messageRef? }`：`message` 按 Runtime 当前的语言（`ui.language`）生成，`messageRef` 是它的消息引用 `{ key, params? }`（参数是标量或嵌套的引用）。有 `messageRef` 时，界面与 CLI 用它按自己的语言重新生成说明；认不出的键（更新的 Runtime 发来的）照用 `message`。程序判断错误只看 `code` 与 `details`，不看这两项。引擎的 `ErrorBody` 同样带引用：`message` 与 `recovery` 是英文缺省文字，`messageRef` / `recoveryRef` 是它们的引用（键在 `engine.*`、`engineHost.*` 这些区域，实体种类、并列的多条原因用嵌套的引用）；Runtime 把它转成 `RpcError` 时按自己的语言展开 `message`、带上 `messageRef`，界面显示 `recovery` 用 `localizeText(recovery, recoveryRef)`。撤销不可用的原因同理：回执的 `undo.unavailableReason` 旁边是 `undo.unavailableReasonRef`。约定见[仓库约定 §5](../repo-conventions.md#5-文案与多语言)。

### 11.2 视频与编辑

| 错误码 | 含义 | 规定的恢复 |
| --- | --- | --- |
| `PROJECT_REVISION_CONFLICT` | 基于旧版本的视频提出修改 | 重新读取受影响的对象，形成新的提案 |
| `IDEMPOTENCY_CONFLICT` | 同一个幂等键带了不同的载荷 | 使用新的 `commandId` |
| `PROJECT_WRITER_UNAVAILABLE` | 视频的写入权没有得到确认 | 等待恢复；不绕过引擎写入 |
| `TASK_PROTECTED` | 任务里的写入触碰了任务合同的保护范围（架构设计 §3.2），整笔拒绝，什么都不写。智能体的提交或撤销：`entityIds` 是被触碰的实体，`details.protections` 列出被触碰的保护（`protectionId`、`target`、`entityIds`），`retryability` 为 `after-user-action`。任务下的 Job 应用结果时：出现在应用的 `error.code`（`details.protections`）与 `APPLY_FAILED` 的 `details.reason`（`details.protections` 同上）。流程写视频的一步：流程以它失败，`details.step` 是那一步 | 避开受保护的对象；需要改动时请用户在任务合同里调整保护范围，智能体不能自己移除。Job 被拒的结果由用户 `jobs.reconcile apply` 决定（不受任务保护限制）；流程的 `pipelines.retry` 仍在原任务里 |
| `CONTEXT_PENDING_EDITS` | 这次引用包含尚未持久化的编辑 | 等待、解决冲突，或明确排除；不静默读旧版本 |
| `ANCHOR_ORPHANED` | 源词或实例的锚已不存在 | 人工重新绑定，或删除附属元素 |
| `TRANSLATION_STALE` | 语义输入已改变 | 重译或审阅相关的句子 |
| `DUBBING_NEEDS_FIT` | 配音超出目标时窗 | 改脚本或适配策略；不截断 |
| `TRANSITION_HANDLES_INSUFFICIENT` | 转场需要的 handles 超出素材的范围（视频格式规范 §3.9）。`details` 给出 `itemId`、`edge`（`head` / `tail`）、`neededFrames`、`availableFrames` | 缩短转场、换放置方式，或先裁短实例留出余量；引擎不自动缩短 |
| `PROJECT_DIR_READ_ONLY` | `projects.open` / `projects.create` 需要写入项目标记 `.bcut/project.json`，而目录不可写（只读卷、没有权限）；或标记读不出来。放在 `RpcError.details.code`（`details.path`），`RpcError.code` 为 `forbidden`，项目不登记 | 换到可写的位置，或由用户修改权限后重试 |
| `VIDEO_NOT_FOUND` | 指明的视频找不到：工具目录里范围之外的与不存在的一样回答（工具结果的错误）；`services.web.createAccessLink { video }` 的 videoId 既不是已打开的视频、也不在 Space 的登记里（放在 `RpcError.details.code`，`RpcError.code` 为 `not-found`，带 `details.videoId`） | 不原样重试；用 `baocut videos list` 重新确认 videoId 或视频目录 |
| `VIDEO_IN_USE` | `videos.delete`：视频在别的连接里打开着（或同一个视频在引擎里以另一个路径开着）。`conflict` | 在那里关掉视频后重试 |
| `VIDEO_BUSY` | `videos.delete`：Runtime 内部还用着视频（任务、导出的租约），或有排队、运行中的任务（`details.jobIds`）。`conflict` | 等任务结束或取消后重试 |
| `VIDEO_TRASHED` | 视频已经删除（在回收站里）：`videos.open` 回收站里的路径、对它 `space.openForEdit` 或定位 bytes。`conflict` | 先 `videos.restore` |
| `VIDEO_NOT_TRASHED` | `videos.restore` 的条目不是删除了的视频。`invalid-request` | 不用恢复 |
| `VIDEO_TRASH_CROSS_DEVICE` | 视频目录与来源目录不在同一个卷上，不能改名进回收站。`conflict` | 把视频移回来源目录所在的卷，或在文件管理器里处理 |
| `VIDEO_TRASH_SOURCE_ROOT` | `videos.delete`：视频目录是某个来源目录（项目目录、没有项目的会话的工作目录）本身，或装着某个来源目录；改名会把那个项目或会话的目录整个挪走。在关闭视频、写回收站记录、移动目录之前拒绝。`conflict` | 先移除以它为目录的项目或会话，再从上一级的项目里删除这个视频 |
| `SPACE_TRASH_VIDEO` | 直接在 Space 目录上改视频条目的回收站标记（不经方法层）。`invalid-request` | 用 `videos.delete` / `videos.restore` |
| `SPACE_ENTRY_TRASHED` | `space.continueInConversation` 的条目、视频工具 `target.entryId` 的视频（`pipelines.start`，智能体的 `download`）、工具的 Space 条目输入（流程的 `{ entryId }` 文件输入，`models.synthesizeSpeech` / `models.generateText` 的 `material`）在回收站里。`conflict` | 先恢复 |
| `SPACE_ENTRY_UNSUPPORTED` | 工具的 Space 条目输入种类不合用（`details.kind`、`details.accepted`）：媒体输入给了视频、文档等，字幕输入给了别的，素材不是 .txt / .md 文档或 .srt / .vtt 字幕，或素材超过 4 MiB（`details.limit`）。`invalid-request`，不建任务 | 换一个合用的条目；视频用 `target` |
| `SPACE_ENTRY_NO_FILE` | 工具的 Space 条目输入没有可读的文件：还在生成的占位、失败的条目、文件已经不在（`missing`）。`conflict`，不建任务 | 等生成完，或恢复文件后再提交 |
| `SPACE_ENTRY_NOT_VIDEO` | 视频工具的 `target.entryId` 不是视频条目（`pipelines.start`，智能体的 `download`）。`invalid-request` | 给视频条目，或给 `videoId` |
| `PIPELINE_TARGET_UNSUPPORTED` | 流程不接受这种目标：`translate`、`dub` 的 `target.create`；Runtime 不能新建视频或按 Space 条目打开视频时的 `create`、`entryId`。`pipelines.start` 的 `invalid-request` | 给已有的视频（`videoId` 或 `entryId`）；要新视频先 `videos.create` |
| `SPACE_CONVERSATION_MISMATCH` | `space.continueInConversation` 给的会话看不到这个条目（属于项目的条目要放进同一个项目的会话）。`conflict` | 换一个会话，或不给会话让 Runtime 选 |
| `PROJECT_MARKER_UNSUPPORTED` | 项目标记的 `schemaVersion` 高于这个版本认识的（`details.schemaVersion`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict`；标记不改写 | 升级 BaoCut 后再打开 |

### 11.3 任务与执行

| 错误码 | 含义 | 规定的恢复 |
| --- | --- | --- |
| `TASK_STOPPED` | 旧执行代的调用被停止屏障拒绝。Engine Host 对已失效执行的提交同样以它拒绝（`RpcError.code` 为 `forbidden`，`details` 带 `runId`、`runGeneration`、`stoppedGeneration`），没有事务与回执；任务的应用把它记为 `cancelled`（`APPLICATION_CANCELLED`，`details.barrier: 'engine'`） | 不重试；由用户决定是否开始新的执行，或 `jobs.reconcile apply` |
| `PLAN_ONLY` | 会话是 `plan` 模式（只读），修改类的工具被拒绝 | 说明打算怎么改，等用户切换模式 |
| `APPROVAL_DENIED` | 会话里的工具调用没有被允许：用户拒绝了，或当前模式按决策表不允许（工具结果的错误带 `mode` 与 `risk`，架构设计 §3.12） | 不重试同样的调用；用户拒绝的先问用户，模式不允许的请用户切换模式 |
| `APPROVAL_CANCELLED` | 工具调用在等审批时被取消：停止任务、停止回复或任务结束（带 `mode` 与 `risk`） | 不重试；由用户决定是否继续 |
| `CONTRACT_REVISION_CONFLICT` | `tasks.updateContract` 的 `expectedRevision` 不是最新修订（`details.expectedRevision`、`details.currentRevision`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 重新读取合同，基于最新修订再改 |
| `CONTRACT_FIELD_READONLY` | 智能体要改它不能改的合同字段：`autonomy`、`budget`、`protectedRefs`、`permissionScopeRef`、`budgetPolicyRef`（`details.fields`），整次修改不生效。`RpcError.code` 为 `forbidden` | 不重试；需要时请用户修改 |
| `TASK_NOT_RUNNING` | `tasks.updateContract` 的任务已经结束或正在停止，合同不能再改（`details.taskId`）。`RpcError.code` 为 `conflict` | 要换目标用 `tasks.changeGoal`（已经结束的任务同样可以） |
| `STALE_JOB_INPUT` | 任务结果的目标或输入内容已改变（含生成任务要导入的视频已经关闭；固定流程冻结的源文档在写入前变了或被删，`details.frozenRevision`、`details.currentRevision`） | 保留产物，停止自动应用；视频打开之后可以 `jobs.reconcile apply`（重新校验，不猜相邻的对象）；固定流程可以重试，从当前的输入重新开始 |
| `JOB_INTERRUPTED` | Runtime 停止或崩溃时任务没有结束；固定流程的 `details.step` 是在跑的那一步。崩溃时还在排队的转写与生成不中断，重新校验后排队；重新排队之前 Provider、授权或预算不成立时同样是这个错误（架构设计 §7.5） | 不自动续跑。有视频的转写与生成用 `jobs.reconcile retry` 或重新提交，固定流程用 `pipelines.retry` |
| `JOB_NEEDS_RECONCILIATION` | 交给在线或智能体 Provider 的调用在 Runtime 停止或崩溃时没有结果：不知道远端有没有执行、有没有计费（任务 `needs-reconciliation`；查询过远端时带 `details.remoteTaskId`、`details.remote`） | 不自动重发。由用户 `jobs.reconcile retry`（新的一次调用）或 `discard` |
| `RECONCILE_NOT_ALLOWED` | `jobs.reconcile` 的决定在任务此刻的状态下不合法，或任务正在恢复、对账（`details.state`、`details.decision`、`details.allowed`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 按 `allowed` 选；为空时没有可做的决定 |
| `APPLICATION_CANCELLED` | 应用的 `error.code`：任务停止之后不再自动应用（停止屏障）；智能体提交的任务在重启后同样 | 产物保留为候选，由用户 `jobs.reconcile apply` |
| `RECEIPT_UNKNOWN` | 重启后按记下的 `commandId` 查不了回执（引擎不可用），不知道上次的事务有没有提交。出现在应用的 `error.code` 与 `APPLY_FAILED` 的 `details.reason`；`jobs.reconcile apply` 时放在 `RpcError.details.code`，`RpcError.code` 为 `busy` | 不换命令重写；引擎可用之后再 `jobs.reconcile apply`（先查回执） |
| `JOB_NOT_RETRYABLE` | `pipelines.retry` 的流程不是失败、取消或中断的状态（`details.state`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 不重试；流程还在跑或已经完成 |
| `ARTIFACT_NOT_FOUND` | 要用的产物不存在或不可见：智能体的工具引用了别的会话的产物；从链接导入下载的文件已经挪走、删掉或改过；固定流程的一步要读的前一步产物已经不在 | 重新生成产物或重新下载；固定流程用 `pipelines.retry`，产物不在的步骤会重做 |
| `TEMPLATE_NOT_FOUND` | `templates.get`、`templates.openHandle` 或 `conversations.send` 的 `template.id` 不在模板目录里，或那个模板没能加载（原因见 `templates.list` 的 `diagnostics`；`details.templateId`）。放在 `RpcError.details.code`，`RpcError.code` 为 `not-found` | 重新列出模板目录，选一个可用的 |
| `TEMPLATE_NOT_SCENE` | `conversations.send` 挂的是作品示例（`details.kind: 'example'`，模板包规范 §5.1）。`RpcError.code` 为 `invalid-request` | 不挂模板，把示例的正文放进输入框直接发送 |
| `TEMPLATE_FILE_NOT_FOUND` | `templates.openHandle` 的 `path`、`conversations.send` 的 `template.assets` 里有清单没登记的路径（`details.templateId`、`details.path`）。`templates.openHandle` 时 `RpcError.code` 为 `not-found`，发送时为 `invalid-request` | 只用清单里的 `cover.file`、`preview.file` 与 `assets[].path` |
| `SKILL_NOT_FOUND` | `skills.*` 或 `conversations.send` 的 `skill.id` 不在 skill 目录里，或那个 skill 没能加载（原因见 `skills.list` 的 `diagnostics`；`details.skillId`）。智能体的 `skills_read` 以同名的工具错误码返回。`RpcError.code` 为 `not-found` | 重新列出 skill，选一个可用的 |
| `SKILL_FILE_NOT_FOUND` | `skills.readFile` 或 `skills_read` 的 `path` 不是这个 skill 目录里的文件（含点开头的文件；`details.skillId`、`details.path`）。`RpcError.code` 为 `not-found` | 用 `skills.get` 的 `files` 里的路径 |
| `SKILL_FILE_TOO_LARGE` | 要读的文件超过读取上限（`details.limit`，字节）。`RpcError.code` 为 `invalid-request` | 在文件夹里直接查看 |
| `SKILL_FILE_NOT_TEXT` | 要读的文件不是 UTF-8 文本。`RpcError.code` 为 `invalid-request` | 在文件夹里直接查看 |
| `SKILL_SOURCE_NOT_FOUND` | `skills.add` 的 `path` 不是一个存在的文件夹，或 `skills.importGithub` 的仓库、`ref`、子目录在 GitHub 上不存在或是私有的（`details.path` 或 `details.url`）。`RpcError.code` 为 `not-found` | 核对路径或地址 |
| `SKILL_INVALID` | 要添加或导入的文件夹不是合规的 skill：根目录没有 `SKILL.md`、front matter 缺 `name` 或 `description`、含符号链接或特殊文件、得不出 id，或与 skill 目录重叠（`details.issues`、目标目录 `details.path`、来源 `details.source` 或 `details.url`）。`RpcError.code` 为 `invalid-request` | 按 `issues` 修好文件夹再添加 |
| `SKILL_TOO_LARGE` | 要添加或导入的 skill 超过文件数或总大小的上限（`details.files`、`details.bytes`、`details.limit { files, bytes }`），或 GitHub 没有列全目录。`RpcError.code` 为 `invalid-request` | 精简文件夹，或只导入其中的子目录 |
| `SKILL_EXISTS` | 目标目录已存在，或已有同 id 的 skill（含内置的；`details.skillId`、`details.path`、`details.source`）。不覆盖。`RpcError.code` 为 `conflict` | 先移除旧的，或另给 `id` |
| `SKILL_BUILTIN_NOT_REMOVABLE` | `skills.remove` 的是内置 skill（`details.skillId`）。`RpcError.code` 为 `invalid-request` | 用 `skills.setEnabled` 关掉它 |
| `SKILL_GITHUB_URL_INVALID` | `skills.importGithub` 的 `url` 不是 `owner/repo`、仓库地址或 `…/tree/<ref>/<子目录>`（`details.url`）。`RpcError.code` 为 `invalid-request` | 改成支持的写法；名字带 `/` 的分支换成提交 sha 或标签 |
| `SKILL_GITHUB_NETWORK` | 连不上 GitHub、超时、被重定向到 GitHub 以外的主机，或回应不合预期（`details.status` 可选）。没有自动重试，暂存的文件已删掉。`RpcError.code` 为 `conflict` | 检查网络后再导入一次 |
| `SKILL_GITHUB_RATE_LIMITED` | GitHub 的匿名访问次数用完（`details.retryAt` 可选）。`RpcError.code` 为 `conflict` | 到 `retryAt` 之后再导入 |
| `PROVIDER_STATUS_UNKNOWN` | 是否已提交、是否已计费不明 | 对账；不重新购买 |
| `GRANT_REQUIRED` | 没有授权覆盖这次数据外发（数据种类、接收方、视频或任务不符），或对外服务 `auto` 等级下没有授权覆盖（架构设计 §4.8、§12.5）。放在 `RpcError.details.code`，`RpcError.code` 为 `forbidden`；`details` 带 `recipient`、`dataKinds`、`videoId` 与 `remedy { action: 'create-grant', hint, commands }`；智能体的工具结果另带 `next`。工具页的当场授权（架构设计 §7.9）：在场的用户（主网关上的桌面界面连接）的 `pipelines.start` 与直接提交的任务（`models.*`）被这个错误或 `GRANT_REVOKED`、`BUDGET_EXCEEDED`、`BUDGET_UNVERIFIABLE` 拒绝时，`details` 另带 `pendingGrants`（`GrantRequestItem[]`，`PendingGrantsDetails`；`reason` 为 `none`、`revoked`、`unverifiable` 或 `exhausted`），一次列出流程的全部几种外发；`code`、`message` 与 `remedy` 取第一项，`remedy.commands` 合并全部几项。拒绝发生在创建任务之前，从不发放或放宽授权；任务预算不够（`TASK_BUDGET_*`）不给待批准项。CLI、智能体、浏览器会话与对外服务没有 `pendingGrants` | 不重试、不换 Provider 绕过；由用户发放授权，或在会话里批准这一次。带 `pendingGrants` 时，用户逐项确认后客户端调用 `grants.create`（`grantCreateParamsFor(item)`，可先改范围与上限），再用同一个 `commandId` 重新提交 |
| `GRANT_REVOKED` | 覆盖这次外发的授权已撤销或到期（提交时，`RpcError.code` 为 `forbidden`）；排队的任务开始执行之前授权被撤销、到期或收紧（`generation` 变了），任务以它失败，预留释放，数据没有交出（`JobRecord.error.details` 带 `grantId`、`generation`、`state`） | 不重试；告诉用户，由用户重新授权 |
| `BUDGET_EXCEEDED` | 授权的次数或金额不够这次调用（`details.measure`：`calls`、`amount`；另有 `grantId`、`usage`、`maxCalls`、`budgetCap` 与 `remedy { action: 'raise-budget' }`）；自动重试时额度不够，任务以它失败。提交时 `RpcError.code` 为 `conflict`，在审批之前检查 | 不重试；由用户调高上限，或等进行中的调用结算 |
| `BUDGET_UNVERIFIABLE` | 授权有金额上限，而这个模型没有可用的价格（或币种不同、计价单位在提交时估不出），无法保证上限。`RpcError.code` 为 `conflict`，`remedy.action` 为 `approve-once` | 由用户逐次批准（金额未知），或改用按次计的授权；不执行 |
| `TASK_BUDGET_EXCEEDED` | 授权够，但任务预算（任务合同的 `budgetPolicyRef`，跨 Provider 合计，架构设计 §7.8）的次数或金额不够这次调用（`details.measure`：`calls`、`amount`；另有 `taskId`、`taskBudget`（上限与用量）与 `remedy { action: 'raise-budget', commands }`）。在 Grant 的接纳之后、审批之前检查，Job 不创建。`RpcError.code` 为 `conflict` | 不重试，不换 Provider 绕过；由用户在任务合同里调高预算，或等进行中的调用结算 |
| `TASK_BUDGET_UNVERIFIABLE` | 任务预算有金额上限，而总额无法按同一币种保证：这次调用估不出金额或币种不同，或已经有金额未知、别的币种的调用（`details` 同上）。`RpcError.code` 为 `conflict` | 由用户去掉金额上限（只留次数上限），或换用有单价的模型；不执行 |
| `CAPABILITY_CONTRACT_CHANGED` | 调用所依赖的有效合同已变化 | 重新发现并验证；不扩大权限 |
| `RESOURCE_ADMISSION_UNSATISFIABLE` | 当前任务的峰值资源无法满足：单个需求超过这台机器在这个优先级下最多能给的量（容量减预留，架构设计 §7.6、§7.7；`details.dimensions` 每项带 `dimension`、`demand`、`limit`）。导出、模型下载与模型包检查在提交时以它拒绝（`RpcError.code` 为 `conflict`，放在 `details.code`），不创建任务；转写在准入时、固定流程的步骤在步骤准入时以它失败（`JobRecord.error.code`）。只是暂时放不下的不报错，排队并写 `wait` | 不原样重试；缩小范围、降低输出尺寸或并行度，或由用户在 `resources.capacity` 里改正容量 |
| `RESOURCE_LEASE_LOST` | 执行资源的所有权已失效 | 停止新的分配，清理并确认实际退出 |
| `RESOURCE_GRANT_REVOKED` | 资源访问的授权已撤销 | 按授权政策停止或限制任务；不通过刷新绕过 |
| `CAPABILITY_NOT_CONFIGURED` | 这种能力没有可用的 Provider：没有默认值、缺凭据、未安装模型包、节点未配对或连不上、Provider 已停用、不支持；智能体 Provider 的运行时没有安装、没有登录或版本太旧（`details.reason`：`no-default`、`missing-credential`、`not-installed`、`signed-out`、`outdated`、`not-paired`、`not-connected`、`disabled`、`unsupported`；另有 `details.capability`、`details.providerId` 与 `details.remedy`，`remedy.action` 为 `setup-agent` 时在智能体运行时自己的界面里安装、登录或升级，架构设计 §6.2、§6.9）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 向用户说明并引导到设置；不换一种办法绕过。CLI 打印补救办法并以退出码 2 结束 |
| `CREDENTIAL_UNAVAILABLE` | 凭据存储不可用，没能写入或删除密钥与节点令牌（`details.reason`：`denied`、`unavailable`、`unsupported`、`internal`；另有 `details.providerId` 或 `details.nodeId`，架构设计 §6.8）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 不重试同一请求；向用户说明凭据存储的问题，不改存到别处 |
| `ACCOUNT_NOT_FOUND` | 账号方法（`models.updateAccount`、`models.removeAccount`、`models.checkBalance`）给出的 `accountId` 不是这个 Provider 的账号（`details.providerId`、`details.accountId`）。放在 `RpcError.details.code`，`RpcError.code` 为 `not-found` | 重新读取配置视图，用其中的 `accountId` |
| `PROVIDER_AUTH_FAILED` | 在线 Provider 拒绝了凭据（HTTP 401/403，或供应商用别的状态码表达的密钥无效）；用的账号状态记为 `invalid-key` | 不重试，也不换别的账号；引导用户检查或更换密钥，或调整账号的先后 |
| `PROVIDER_QUOTA_EXCEEDED` | 在线 Provider 的限速或额度用尽（HTTP 429；文本请求的 `details.reason` 为 `rate-limited` 或 `insufficient-quota`；供应商给了 `Retry-After` 时 `details.retryAfterSec`） | HTTP 层只在 `Retry-After` 不超过 30 秒时等过再试，额度用尽从不重试；任务失败后不自动重试，由用户决定何时再提交，或改用其他 Provider |
| `INPUT_TOO_LONG` | 输入超过模型的上下文：供应商这样拒绝了文本请求（`details.reason: 'context-length'`），或提交时按字符粗估明显超出（放在 `RpcError.details.code`，`RpcError.code` 为 `invalid-request`，带 `contextTokens`）；语音与图片的文本超过上限在提交时是 `invalid-request`，智能体的工具同样以这个码返回 | 不重试同一输入；由调用方缩短或分段后再提交，Runtime 不截断 |
| `PROVIDER_REJECTED` | 在线 Provider 拒绝了这次请求（其余 4xx，如音频格式或参数不被接受；文本请求的 `details.reason` 为 `content-filter`（输入或输出被内容过滤）或 `model-not-found`），或要求把请求体重定向到另一个源；智能体 Provider 没有产出图片（`details.reason: 'no-image'`，`details.reply` 是回复的摘录）或回合失败、被中断（`turn-failed`、`turn-interrupted`） | 不重试同一输入；按 `message` 调整参数或换模型 |
| `PROVIDER_UNAVAILABLE` | 在线 Provider 连不上、超时或返回 5xx，有界重试后仍然失败（`details.attempts`、可选的 `details.status`，`details.reason`：`unreachable`、`timeout`、`server-error`）；智能体 Provider 的会话没有启动、意外退出或超过一次生成的期限（`details.reason`：`exited`、`timeout`） | 稍后重试，或改用其他 Provider；不自动换 Provider |
| `REMOTE_NODE_LOST` | 远端节点连不上，或失联超过重连期限（`details.reason`：`unreachable`、`stream-lost`、`node-restarted`） | 任务失败；由用户选择改用本机或重试，不自动换机器 |
| `REMOTE_NODE_REJECTED` | 节点拒绝：未配对、版本过旧、能力关闭、模型未就绪、队列满、磁盘不足等（`details.reason`，节点协议规范 §9） | 按 `details.reason` 引导配对、升级或换模型；`nodes.pair` 的失败同样用这两个码，放在 `RpcError.details.code` |
| `AGENT_AUTH_REQUIRED` | 智能体运行时未登录或登录已过期（`details.driverId`） | 会话保留；用户在该运行时自己的界面登录后继续（架构设计 §3.11） |
| `AGENT_MODEL_UNAVAILABLE` | 所选的模型对这个账号或这个版本的运行时不可用（`details.driverId`、`details.model`） | 换一个模型或升级运行时后继续 |
| `AGENT_NOT_INSTALLED` | 智能体运行时没有安装或找不到可执行文件 | 安装或在设置里指定位置后继续（架构设计 §3.11） |
| `AGENT_OUTDATED` | 智能体运行时的版本太旧，不支持 BaoCut 用到的机器协议 | 升级运行时后继续 |
| `AGENT_RATE_LIMITED` | 智能体运行时报告限流、服务过载或套餐用量到顶 | 稍后重试，或换一个模型 |
| `AGENT_BILLING_REQUIRED` | 智能体运行时的账号余额不足或付款有问题（Claude 的 `billing_error`） | 不自动重试；用户在服务商那边处理账单后继续 |
| `AGENT_EXITED` | 智能体进程在回合中意外结束，Driver 没有给出更具体的原因 | 重新发送；反复出现时检查运行时本身 |
| `AGENT_ACCESS_MODE_UNSUPPORTED` | 这个智能体运行时没有逐次审批通道（探测到的 `capabilities.approvals` 为 `false`），只能用 `fullAccess`；建会话、切换模式或发送时用了别的模式（`details.driverId`、`details.mode`、`details.supportedModes`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 不替用户改模式；由用户切到完全访问或换一个智能体（架构设计 §3.12） |
| `AGENT_PROVIDER_EXISTS` | `agents.addProvider` 的 id 已被用户添加的智能体占用（`details.driverId`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 换一个 id，或先移除原来的（架构设计 §3.11） |
| `AGENT_PROVIDER_BUILTIN` | `agents.removeProvider` 要移除内置的智能体（`details.driverId`）。放在 `RpcError.details.code`，`RpcError.code` 为 `invalid-request` | 不重试；内置的只能在设置里停用 |
| `SERVICE_APPROVAL_DENIED` | 对外服务的请求被用户拒绝、审批超时，或在回答之前被取消（服务停止、调用方断开）。工具结果的错误带 `serviceId` 与 `reason`（`denied`、`timeout`、`cancelled`） | 不重试；由调用方请用户留意确认后重新发起（架构设计 §4.8） |
| `SERVICE_NOT_AVAILABLE` | 这个版本或平台不提供这个对外服务（目前四个服务都提供，这个错误码留给以后），`services.start` 或 `services.configure` 被拒绝（`details.serviceId`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 不重试；等提供它的版本 |
| `SERVICE_NOT_RUNNING` | 要求服务开着的操作（`services.web.createAccessLink`）在服务关闭或出错时被拒绝（`details.serviceId`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 先开启服务（`baocut web open` 会先开启） |
| `WEB_METHOD_NOT_ALLOWED` | 浏览器会话调用了 Web 服务白名单之外的方法（`details.method`）。放在 `RpcError.details.code`，`RpcError.code` 为 `forbidden` | 不重试；在桌面应用或 CLI 里操作，或由用户放宽 Web 服务的白名单（不能超出默认集合） |
| `WEB_READ_ONLY` | Web 服务设为只读时，浏览器会话调用了写入类方法（`details.method`）。`RpcError.code` 为 `forbidden` | 不重试；由用户关掉只读 |
| `WEB_TOPIC_NOT_ALLOWED` | 浏览器会话订阅的主题要求的读取方法不在白名单里（`details.topic`）。`RpcError.code` 为 `forbidden` | 不重试；客户端不再重订这个主题 |
| `PROJECT_NOT_REGISTERED` | 浏览器会话用 `projects.open` 打开没有登记的目录。`RpcError.code` 为 `forbidden` | 在桌面应用里打开这个目录，或在浏览器里新建项目 |
| `PATH_OUTSIDE_PROJECT` | 对外服务或浏览器会话导入或重新链接的素材文件按真实路径不在视频所在的项目目录里；浏览器会话 `exports.create` 的目标目录按真实路径不在这个目录里，或是视频目录、`.bcut`；浏览器会话直接任务（`models.synthesizeSpeech`、`generateImage`、`generateText`）的 `saveDir` 按真实路径（还不存在时按最近的已有上级）不在任何已登记的项目目录里。浏览器会话的 `edits.apply`、`exports.create` 与这些直接任务以 `forbidden` 回答，`edits.apply` 的 `details.index` 是出错的操作下标。浏览器里的 `tools.list` 在保存位置不在项目目录里时也用这个码标出工具：结果只写到保存位置的流程进 `problems`（不可用），还能写进视频的进 `limitations` | 不重试；先把文件放进项目目录，或把保存位置（设置 `downloads.directory`）改到项目目录里 |
| `ACCESS_CODE_INVALID` | Web 服务登录（`POST /_auth/session`）用的访问代码不认识、已经用过或已经过期。不是网关错误：HTTP 401，正文 `{ "error": "ACCESS_CODE_INVALID" }` | 重新运行 `baocut web open` 取得新链接 |
| `MODEL_DOWNLOAD_NO_SPACE` | 安装本地模型时磁盘空间不足：开始前按要下载的字节检查（`details.requiredBytes`、`details.availableBytes`），或写入时磁盘满了（`details.file`） | 清理出空间（或换模型目录）后再安装；`details.remedy` 说明 |
| `MODEL_DOWNLOAD_NETWORK` | 下载本地模型时连不上、5xx 或断流，有界重试后仍然失败（`details.file`、`details.reason`：`connect`、`stalled`、`stream-broken`、`truncated`、`HTTP <状态>` 等，`details.attempts`） | 检查网络后再次安装，已下载的部分续传；或换镜像 |
| `MODEL_DOWNLOAD_INTEGRITY` | 下载的文件与内置清单的大小或 sha256 不符（`details.file`、`details.expectedSha256`）；坏文件已删除 | 换一个下载来源后再安装 |
| `MODEL_DOWNLOAD_SOURCE` | 下载来源没有这个文件或拒绝访问（404、401、403，`details.status`）；环境变量 `BAOCUT_MODELS_ENDPOINT` 不合规时 `models.install` 以 `invalid-request` 拒绝，`details.code` 是这个码 | 检查镜像是否完整、基址是否正确 |
| `MODEL_MANIFEST_INCOMPLETE` | 模型包的内置清单缺少可信的 sha256（`details.repo`、`details.files`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 不能安装；等待更新 BaoCut |
| `MODEL_INSTALL_SIZE_CHANGED` | `models.install` / `models.repair` 交回的 `confirmBytes` 与新的计划不符（`details.plan`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 向用户显示新的大小，重新确认 |
| `MODEL_IN_USE` | `models.remove` 时有任务在用这个模型包（`details.jobIds`），或它的 Worker 正忙；`models.setDir` 时有任务在用任一本地模型，或模型目录正在移动；移动期间的 `models.install`、`repair`、`remove`、`test`。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 等任务结束或取消之后再做 |
| `MODELS_DIR_ENV_LOCKED` | 模型目录由环境变量 `BAOCUT_MODELS_DIR` 指定时 `models.setDir`（`details.path`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 改环境变量并重启 BaoCut |
| `MODELS_DIR_MISSING` | `models.setDir` 的目标文件夹不在（外置盘没接上时也是这样），或生效的模型目录不在时 `models.install` / `models.repair`（不在别处凭空建出同名的目录）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 接好外置盘，或换一个文件夹 |
| `MODELS_DIR_NOT_WRITABLE` | `models.setDir` 的目标文件夹不能写（`details.path`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 换一个可写的文件夹，或先改它的权限 |
| `MODELS_DIR_NESTED` | `models.setDir` 的目标与当前的模型目录互相包含（`details.path`）。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict` | 换一个不在它里面、也不包含它的文件夹 |
| `MODELS_DIR_NO_SPACE` | 跨盘移动模型目录时目标磁盘放不下：`models.setDir` 开始前按要移动的字节检查（`details.requiredBytes`、`details.availableBytes`、`details.remedy`，`RpcError.code` 为 `conflict`），或移动时磁盘写满了（`modelsMove` 的 `JobRecord.error.code`，已回滚） | 清理出空间，换一个位置，或只切换位置 |
| `MODELS_DIR_MOVE_FAILED` | 移动模型目录时出了别的错（`details.reason`）；已回滚，原来的模型目录没有变化。是 `modelsMove` 的 `JobRecord.error.code` | 查看原因后再试 |
| `SETTING_MANAGED` | `settings.set` 改了有专门方法的键（`details.key`、`details.method`；目前是 `models.dir` → `models.setDir`）。`RpcError.code` 为 `invalid-request` | 改用 `details.method` |
| `MODEL_SELF_TEST_FAILED` | 模型包检查没通过：Worker 失败，或输出不合合同、识别结果不含样本的固定短语（`details.text`）、合成或分离结果判定不过。`details.check` 是结论的代码：`MODEL_FILES_DAMAGED`（加载时模型文件缺失或损坏）、`MODEL_OUTPUT_WRONG`（输出缺失、不合合同或判定不过）、`MODEL_OUT_OF_MEMORY`（加载时资源不足）、`MODEL_WORKER_FAILED`（其余 Worker 失败）；`details.facts` 是给技术详情的 `key: value` 行，不含 stderr、staging 与本机绝对路径。代码与 facts 一并记在模型包的 `selfTest`；新增的代码客户端认不得时按通用失败处理 | 修复（`models.repair`）只对 `MODEL_FILES_DAMAGED` 有用、对 `MODEL_OUTPUT_WRONG` 可能有用，修复后再检查；`MODEL_OUT_OF_MEMORY` 先关掉别的占内存的程序或换小一点的模型；其余换后端或上报 |
| `APP_FILE_MISSING` | 随应用分发的文件（识别检查的样本、内置音色的参考录音）缺失或读不出来：是安装不完整，不是用户的输入或模型的问题。`message` 不带路径，`details.asset` 是模型数据目录里的相对路径（不知道时 null），`details.file` 是期望的位置（找不到模型数据目录时 null）。`models.test` 与本地合成提交时放在 `RpcError.details.code`（`RpcError.code` 为 `conflict`），执行中发现的是任务的 `error.code`（带 `details.check: 'APP_FILE_MISSING'`，不记进模型包的 `selfTest`） | 重新安装 BaoCut；不重试同一请求 |
| `MODEL_INSTALL_FAILED` | 安装时出了下载与校验以外的错误（`details.reason`） | 再次安装；仍然失败时保留诊断上报 |
| `OFFLINE_STRICT` | 严格离线（设置 `offline.strict`）时请求了要联网的操作：目前是 `models.install`、`models.repair`、`externalTools.install`、`externalTools.update`、`fonts.download`、`skills.importGithub` 与 `link-import` 流程的启动、重试与每一步。放在 `RpcError.details.code`，`RpcError.code` 为 `conflict`；流程的一步以它失败时是 `JobRecord.error.code` | 关掉严格离线后再做，或从别处拷入模型 |
| `TOOL_UNKNOWN` | 没有这个外部工具（`details.tool`）。放在 `RpcError.details.code`，`RpcError.code` 为 `not-found` | 不重试；用 `externalTools.list` 列出的名字 |
| `TOOL_NOT_INSTALLED` | 要用的外部工具没有找到（`details.tool`、`details.remedy`、`details.offer`）；yt-dlp 执行时可执行文件不见了 | 用 `externalTools.install` 下载，或自己安装后用 `externalTools.setPath` 指定 |
| `TOOL_OUTDATED` | 外部工具的版本低于最低版本（`details.state`、`details.remedy`） | 更新工具，或下载受管的副本 |
| `TOOL_UNAVAILABLE` | 外部工具不能运行：`--version` 失败或读不出版本；用户指定的路径不是可执行文件（`setPath` 时 `invalid-request`）；下载的副本不能运行（安装任务失败） | 按 `details.remedy` 修复，或换一个路径 |
| `TOOL_CONSENT_REQUIRED` | 下载或使用要用户同意的工具而没有同意或已撤回：`externalTools.install` 没有 `consent: true`（`details.offer` 是来源、版本、大小与许可）；流程启动、重试或执行一步时同意不在 | 向用户显示来源、版本、大小与许可，同意之后再试；不代替用户同意 |
| `TOOL_MANIFEST_INCOMPLETE` | 内置清单没有这个工具在这台机器上的文件或可信的 sha256（`details.offer.blockedReason`） | 不能下载；自己安装后用 `externalTools.setPath` 指定，或等待更新 BaoCut |
| `TOOL_NOT_MANAGED` | 这个工具不由 BaoCut 管理（ffmpeg）：`externalTools.install`、`setPath`、`remove`、`consent` 以 `invalid-request` 拒绝 | 按 `details` 的说明自己安装 |
| `TOOL_IN_USE` | `externalTools.remove` 或 `externalTools.update` 时工具正在安装、更新或被流程使用（`details.jobIds`）。`RpcError.code` 为 `conflict` | 等任务结束或取消之后再删除或更新 |
| `TOOL_UPDATING` | 要用的外部工具正在按原安装方式更新（`details.remedy` 里有更新任务）：流程启动、重试或执行一步时 | 等更新任务结束后再试 |
| `TOOL_UPDATE_CONFIRM_REQUIRED` | `externalTools.update` 没给 `command`，或给的与此刻的办法不同（`details.update` 是办法与完整命令）。`RpcError.code` 为 `conflict` | 向用户显示安装方式与完整命令，确认之后交回同一条 `command`；不代替用户确认 |
| `TOOL_UPDATE_MANUAL` | 判断出了安装方式但不能代为执行（`details.update.reason`：要管理员权限（Chocolatey 装的、Scoop 的全局安装、winget 的全机范围都算）、找不到同一个 Homebrew、pipx、winget 或 Scoop、解释器不在了；`details.update.command` 是要用户自己执行的命令，要管理员权限的独立程序带 `sudo`，Windows 上不带、`reason` 说明用管理员身份执行）。`RpcError.code` 为 `conflict` | 让用户在终端里执行，完成后 `externalTools.detect` |
| `TOOL_UPDATE_UNSUPPORTED` | 没有能按安装方式更新的那一份：判断不了安装方式、用的是 BaoCut 下载的副本、或没有找到工具。`RpcError.code` 为 `conflict` | 按 `details.remedy`：自己按安装方式更新，或用 `externalTools.install` |
| `TOOL_UPDATE_FAILED` | 更新命令以非零退出、超时（15 分钟）、被信号终止或不能启动；是 `toolUpdate` 的 `JobRecord.error.code`（`details.exitCode`、`details.remedy`），输出留在 `JobRecord.command` 与 `result.artifactId` | 看输出，修好之后再更新，或在终端里执行同一条命令 |
| `TOOL_DOWNLOAD_NO_SPACE` / `TOOL_DOWNLOAD_NETWORK` / `TOOL_DOWNLOAD_INTEGRITY` / `TOOL_DOWNLOAD_SOURCE` | 安装工具的任务失败：磁盘不足；连不上或断流；大小或 sha256 与清单不符（坏文件已删除）；来源没有这个文件或拒绝访问。`tools.downloadEndpoint` 或 `BAOCUT_TOOLS_ENDPOINT` 不合规时 `externalTools.install` 以 `invalid-request` 拒绝，`details.code` 是 `TOOL_DOWNLOAD_SOURCE` | 按 `details.remedy`：清理空间、检查网络后再安装（下了一半的部分续传）、换一个下载来源 |
| `FONT_NOT_IN_CATALOGUE` | `fonts.download` 的族不在 Google Fonts 字体目录里（`details.family`）。`RpcError.code` 为 `not-found` | 不重试；用 `fonts.catalogue` 列出的族名 |
| `FONT_NOT_DOWNLOADABLE` | `fonts.download` 的族随渲染内核发布或本机已装，不下载（`details.family`）。`RpcError.code` 为 `conflict` | 直接用；同族只认本机或内置的 |
| `FONT_IN_USE` | `fonts.remove` 要删的 face 被还没结束的导出冻结了或在等它下载（`details.family`、`details.jobIds`）。`RpcError.code` 为 `conflict` | 等导出结束或取消之后再删 |
| `FONT_DOWNLOAD_NETWORK` / `FONT_DOWNLOAD_SOURCE` / `FONT_DOWNLOAD_INTEGRITY` / `FONT_DOWNLOAD_NO_SPACE` | 下载字体的任务失败（`fontDownload` 的 `error.code`，也是 `FontFamilyStatus.error.code` 与 `fonts.resolve` 的 `download-failed`）：连不上、超时或断流（重试三次之后，离线时也是它）；字体服务回了不成功的状态（`details.status`）、没给这个 face 的完整文件或文件地址不在配置的文件主机下；下载的不是能用的字体、族名对不上或超过 64 MiB（坏文件已删除）；写缓存时磁盘满了。`details` 带 `family` 与 `remedy`，不含地址。设置 `fonts.cssEndpoint`、`fonts.fileEndpoint` 不是 `https` 时 `settings.set` 以 `invalid-request` 拒绝 | 按 `details.remedy`：检查网络或换镜像后再下载（`fonts.download`）；清理空间；不重试坏文件 |
| `LINK_UNSUPPORTED` | 链接不是 `http(s)://`、以 `-` 开头、带用户名或密码（提交时 `invalid-request`）；下载工具不支持这个网站，或链接是播放列表、直播 | 换一个视频页面的链接 |
| `LINK_PRIVATE_ADDRESS` | 链接的主机或它解析出的任何一个地址是本机、链路本地或内网地址。提交时 `invalid-request` | 不重试；从本机文件导入 |
| `LINK_LOGIN_REQUIRED` | 网站要求登录、验证或访问权限；勾选的浏览器逐个试过、有一个仍要求登录（`details.attempts`） | 先在浏览器登录，再把那个浏览器加进本次下载的 `cookieBrowsers` |
| `LINK_COOKIES_UNAVAILABLE` | 浏览器 Cookie 数据库无法读取、被占用、没有权限或无法解密；勾选多个时是每个都读不到（`details.attempts`） | 完全退出占用数据库的浏览器、检查系统密钥权限（macOS 的 Safari 要完全磁盘访问权限；Windows 上 Chrome、Edge、Brave 用应用绑定加密时读不到，改用 Firefox）或选择其他浏览器 |
| `LINK_TOOL_UPDATE_REQUIRED` | 下载工具过旧、提取器或签名解析失败 | 按原安装方式更新 yt-dlp，重新检测后重试 |
| `LINK_UNAVAILABLE` | 视频已删除、不可用或有地区限制 | 不重试；换一个链接 |
| `LINK_NETWORK_ERROR` | 解析不了主机名（提交时 `conflict`），或下载时连不上、超时、断流 | 检查网络后用 `pipelines.retry`，已下载的部分续传 |
| `LINK_DISK_FULL` | 下载时磁盘满了 | 清理出空间后用 `pipelines.retry` |
| `LINK_DOWNLOAD_FAILED` | 下载工具以其他原因失败，或没有留下媒体文件（`details.exitCode`、脱敏的 `details.stderr`） | 用 `pipelines.retry`；仍然失败时更新下载工具 |
| `LINK_DOWNLOAD_UNREADABLE` | 下载得到的文件解码不了，或既没有画面也没有声音 | 重试，或改为只下载音频 |
| `LINK_DESTINATION_UNAVAILABLE` | 下载目录不能创建或写入，或发布的文件按真实路径不在下载目录里 | 检查设置 `downloads.directory` 指定的目录（默认主机的下载文件夹） |
| `LINK_SOURCE_EXPIRED` | 重试时原始链接已经不在了（Runtime 启动时清理过）。重试以 `conflict` 拒绝 | 重新开始一次导入 |
| `OUTPUT_DESTINATION_UNAVAILABLE` | 保存位置（流程的 `outDir`、直接任务的 `saveDir`，不给时是设置 `downloads.directory` 或主机的下载文件夹）不能创建或写入（`details.dir`、`details.reason`）。提交时 `conflict`、不建任务；发布前才发现时是那一步的错误码 | 换一个目录，或检查设置 `downloads.directory`；修好之后用 `pipelines.retry` |
| `MODEL_LOAD_FAILED` | 本地模型包无法加载：未安装、不支持或资源不足；智能体 Provider 在执行前已不可用（排队期间被停用、退出登录或卸载，`details.reason` 是不可用的原因） | 不重试；按原因安装、换模型或换后端 |
| `MODEL_WORKER_CRASHED` | 本地推理进程在有界重试后仍然崩溃 | 保留诊断；停用该模型包，由用户重新启用或换模型 |
| `MODEL_OUTPUT_INVALID` | 模型输出不满足 `outputContract`；翻译流程的一批在有界重发后仍不合约定（`details.reason: 'schema'`、`details.problem`）；生成任务的输出长度、摘要、媒体类型或文件头不符，或 ffprobe 解码不出有效的音频或图片（`details.problems`）；文本生成的结构化输出不是 JSON 或不符合 schema、到了输出上限被截断，或输出为空（`details.reason`：`schema`、`length`、`empty`） | 不重试同一输入；保留原始输出供上报 |
| `STAGING_WRITE_FAILED` | 本地 Model Worker 的输出写不进 staging（磁盘满或目录不可写，`details.file`）：配音的分离与合成、本地语音合成 | 腾出空间后重试；不算崩溃，不停用模型包 |
| `VOICE_CONSENT_REQUIRED` | 音色没有本人声明（`consent.declared` 与 `declaredAt`），不能把参考录音交给在线 Provider，也不能使用它的克隆（`details.id` 是音色条目，另有 `details.providerId`） | 由用户在音色库里补上声明；不绕过 |
| `VOICE_CLONE_REQUIRED` | `voice: 'library:<id>'` 在所选 Provider 上没有可用的克隆（`details.reason`：`missing` 没有建立过，`stale` 参考录音已更换或条目已删除；另有 `details.id`、`details.providerId`） | 先为这个 Provider 建立克隆（`library.createVoiceClone`），或换一个音色；不换成别的声音 |
| `VOICE_NOT_FOUND` | 翻译配音里说话人绑定的 `library:<id>` 音色在库里已经删了（`details.library: 'voices'`、`details.reason: 'removed'`） | 那位说话人的句子不合成、逐句报告；在视频里换一个音色，或删掉这条绑定后重试 |
| `APPLY_FAILED` | 结果已发布，但写入视频的事务被拒绝（转写写文档、生成导入素材、翻译流程写译文文档；`details.cause`；触碰任务保护时 `details.reason` 是 `TASK_PROTECTED`，带 `details.protections`） | 产物保留在 `result` 里；不自动重试。转写与生成由用户 `jobs.reconcile apply` 重新应用（先按上次的 `commandId` 查回执），固定流程用 `pipelines.retry` |
| `VOICE_CLONE_UNSUPPORTED` | `library.createVoiceClone` 的 Provider 没有克隆接口（首版只有 ElevenLabs；`details.providerId`） | 换一个 Provider |
| `VOICE_CLONE_EXISTS` | 这个音色在这个 Provider 上已经有参考录音没变的有效克隆（`details.id`、`details.providerId`） | 直接用 `library:<id>`；要重建先 `library.removeVoiceClone` |
| `LIBRARY_ENTRY_GONE` | 克隆任务开始时，提交时冻结的音色版本已经不在了（条目被删或版本已清理） | 重新提交 |
| `DUB_NOTHING_TO_DUB` | 翻译配音的译文里没有可以合成的句子：全部过期或为空 | 更新译文后重新配音 |
| `DUB_SYNTHESIS_FAILED` | 有的句子合成失败（`details.failed[] { unitId, code, message }`、`synthesized`、`remaining`、`calls`）；成功的句子已经保留 | `pipelines.retry` 只合成失败的句子 |
| `DUB_NOTHING_PLACED` | 没有一句配音能放进时间线：都放不下，或原句都不在时间线上 | 改写脚本或调整时间线后重试 |
| `INPUT_NOT_FOUND` | 转录流程（`transcribe`）新建视频时要导入的媒体文件不存在或不是普通文件：提交时 `not-found`，不建任务；提交之后文件没了时是 `create` 这一步的 `error.code` | 换一个文件，或把文件放回原处后 `pipelines.retry` |
| `TRANSCRIBE_ASSET_NOT_FOUND` | 转录流程没给 `assetId`，而根序列的主轨上没有音视频素材（任务的 `error.code`） | 先把素材放上时间线，或用 `assetId` 指明 |
| `TRANSCRIBE_ASSET_AMBIGUOUS` | 转录流程没给 `assetId`，而主轨上不止一个素材（`details.assetIds`；任务的 `error.code`） | 用 `assetId` 指明转写哪一个，重新启动 |
| `TRANSCRIPT_EDITED` | 转录流程 `destination: 'replace'`，而当前文稿的全文指纹与 `stages.asr` 不符：用户改过原文（`details` 带当前指纹与 `stages.asr`）。提交时 `conflict`，不建任务；提交之后文稿又被改了时是 `transcribe` 一步的 `error.code`，`acceptEdited` 不覆盖这次 | 改用 `destination: 'new-video'`，或确认丢掉这些修改后加 `acceptEdited: true` 重新启动 |

`VOICE_*` 在提交时拒绝，不创建任务，放在 `RpcError.details.code`，`RpcError.code` 为 `conflict`（`VOICE_CLONE_UNSUPPORTED` 为 `invalid-request`）；在任务执行时发现的（排队期间撤回了声明、克隆失效）是任务的 `error.code`。翻译配音的合成遇到授权、预算、凭据或额度的失败时停下，`details` 带 `synthesized` 与 `remaining`，`pipelines.retry` 只合成剩下的句子。

移动模型目录的告警（`JobRecord.warnings`）：`MODELS_DIR_SOURCE_KEPT`（换过去之后原目录里有文件没能删掉，`detail` 说几个；可以手动删除）。

翻译配音与音色克隆的告警（`JobRecord.warnings`）：`DUB_UNITS_STALE`（过期的译文没有合成）、`DUB_UNITS_OVERLONG`（放不下的句子没有放）、`DUB_UNITS_OFF_TIMELINE`（原句不在时间线上）、`DUB_BACKGROUND_MUTED`（静音原声而没有分离背景，背景一起没了）、`DUB_SEPARATION_NOT_CONFIGURED`（要求分离而没有执行者，这一步跳过）、`DUB_VOICE_UNAVAILABLE`（说话人绑定的音色不可用，那位说话人的句子没有合成，没有换成别的音色）、`DUB_MUTED_UNVOICED`（静音原声的实例里还有音色不可用、没有合成的句子，它们的原声一起静音了）、`VOICE_CLONE_OLD_NOT_DELETED`（被替换的旧克隆没有从远端删掉，`detail` 带它的 `voiceId`）。

模型接口服务（架构设计 §4.8）不走网关的 `RpcError`：错误以 HTTP 状态与 OpenAI 的错误体 `{ error: { message, type, code, param: null } }` 回答，`type` 按状态取 OpenAI 的写法，`code` 是下面的错误码之一，只带一句说明，不带 `details`：

| HTTP | `code` | 含义 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 请求体不是合法的 JSON 或 multipart、缺字段、取值不对 |
| 400 | `UNSUPPORTED_PARAMETER` | 认识但不支持的参数：`url` 形式的图片、流式语音与转写、工具调用、`n > 1`、`logprobs`、不支持的格式 |
| 400 | `PROVIDER_REJECTED`、`INPUT_TOO_LONG`、`ASSET_MISSING` | 任务以这些错误失败 |
| 401 | `AUTHENTICATION_REQUIRED` | 没有令牌、令牌不对或已吊销（带 `WWW-Authenticate: Bearer`） |
| 403 | `ORIGIN_NOT_ALLOWED`、`HOST_NOT_ALLOWED` | 带 `Origin` 的请求；`Host` 不是回环地址 |
| 403 | `SERVICE_READ_ONLY` | `read` 等级下的生成请求 |
| 403 | `SERVICE_APPROVAL_DENIED` | `ask` 等级下的审批被拒绝、超时或取消 |
| 403 | `GRANT_REQUIRED`、`GRANT_REVOKED` | 没有授权覆盖这次外发（`auto` 等级不生成审批），或授权已撤销、到期；任务开始前授权失效 |
| 403 | `FORBIDDEN` | 其余的拒绝 |
| 404 | `NOT_FOUND`、`MODEL_NOT_FOUND` | 没有这个端点；不认识或不可路由的模型（含能力不对的别名） |
| 405 | `METHOD_NOT_ALLOWED` | 端点不接受这个方法（带 `Allow`） |
| 409 | `JOB_CANCELLED` | 任务在 BaoCut 里被取消了 |
| 409 | `BUDGET_EXCEEDED`、`BUDGET_UNVERIFIABLE` | 授权的预算用完，或有金额上限而估不出金额；在审批与提交之前回答，请求到不了供应商 |
| 413 | `PAYLOAD_TOO_LARGE` | 上传或 JSON 请求体超过上限 |
| 429 | `TOO_MANY_REQUESTS` | 这个客户端在途的生成请求已经到上限（`Retry-After: 1`） |
| 429 | `PROVIDER_QUOTA_EXCEEDED` | 供应商限速或额度用尽；供应商给了 `Retry-After` 时原样转出 |
| 502 | `MODEL_OUTPUT_INVALID`、`PROVIDER_AUTH_FAILED`、`PROVIDER_UNAVAILABLE`、`REMOTE_NODE_REJECTED`、`REMOTE_NODE_LOST` | 任务以这些错误失败（结构化输出不符合 schema 是 `MODEL_OUTPUT_INVALID`） |
| 503 | `CAPABILITY_NOT_CONFIGURED`、`MODEL_UNAVAILABLE`、`RUNTIME_BUSY`、`JOB_INTERRUPTED` | 这种能力此刻没有可路由的模型（说明怎么开启）；Runtime 正在停止；任务被中断 |
| 500 | `INTERNAL` 或任务的错误码 | 其余的失败 |

`PROVIDER_*` 是任务失败时 `JobRecord.error.code` 的取值；`models.configure`、`models.addAccount` 与 `models.updateAccount` 带 `verify` 而验证不通过时同样用它们，放在 `RpcError.details.code`（`RpcError.code` 为 `conflict`），配置不保存。这些错误的 `message` 与 `details` 不含密钥：供应商回显的密钥替换为 `[REDACTED]`。

### 11.4 素材、代码与渲染

| 错误码 | 含义 | 规定的恢复 |
| --- | --- | --- |
| `ASSET_MISSING` / `ASSET_CHANGED` | 媒体缺失，或 bytes 与记录不符 | 重新链接，或显式换版本 |
| `FONT_MISSING` | 字体无法复现 | 补齐，或接受替代。成片导出冻结了用到的本机字体（文件、第几个 face 与整个文件的摘要，`ExportSnapshot.fonts`）：执行时文件不见了或与冻结时不同，整个任务以它失败，`details` 是 `{ family, weight, italic, path, reason }`（`reason` 为 `missing`、`changed` 或 `unreadable`）；补回原来的字体文件或重新导出（重新冻结）。冻结时随渲染内核的字体与本机字体里都没有的族不用这个码：按内核的回退规则画，在结果的 `warnings` 里报（`EXPORT_RENDER_NOTE`，文字元素与字幕都报），不拒绝导出。Google Fonts 字体目录里有的族在导出任务里下载（下载缓存里已有的照样冻结，`source: 'downloaded'`）；不下载（`fonts.autoDownload` 关着、严格离线）或下载失败时也不用这个码：照回退字体画，警告 `FONT_NOT_DOWNLOADED`（`detail` 写族、字重与原因） |
| `ADAPTER_CAPABILITY_MISSING` | 运行环境不支持所需的能力 | 更换 Adapter、显式 Bake，或拒绝 |
| `NONDETERMINISTIC_SOURCE` | 求帧的结果不满足声明 | 修改源码、改用 sequential，或在固定环境中 Bake |
| `CODE_SANDBOX_UNAVAILABLE` | 没有所要求的隔离环境 | 拒绝执行不可信的代码 |
| `FRAME_NOT_PRESENTED` | 目标帧没有达到验证过的呈现合同 | 受限重试、走基线路径，或报告失败 |
| `SOURCE_TIME_OUT_OF_RANGE` | 对源码或媒体的请求超出可用时段 | 显式裁短、hold 或重新编排；不默默 clamp |
| `EVIDENCE_SNAPSHOT_MISMATCH` | 证据不属于所请求的版本或质量 | 保留为历史；重新请求正确的证据 |
| `EXPORT_VALIDATION_FAILED` | 输出不满足合同（导出任务的 `error.details.failed[].problems` 是具体的检测项；文件转码的输出时长、视频轨、编码或高度不符时是 `details.problems`） | 保留旧的成功输出；报告具体的检测项 |
| `EXPORT_KIND_UNSUPPORTED` | 这个版本不能导出这个种类（`details.supported`）。放在 `RpcError.details.code`，`RpcError.code` 为 `invalid-request` | 换一个支持的种类；不用别的办法拼出成片 |
| `EXPORT_PACKAGE_LOCAL_PATH` / `EXPORT_PACKAGE_UNSUPPORTED` | 便携包预检：有文档的正文里写着本机路径；有文件写不进 ustar 归档（路径超过 255 字节或单个文件 8 GiB 以上）。`details.items` 逐项列出（`invalid-request`） | 告诉用户是哪些；改掉文档或文件之后重新导出 |
| `EXPORT_INSUFFICIENT_SPACE` | 目标盘空间不够（`details.required`、`available`，字节）。预检时放在 `RpcError.details.code`（`conflict`）；执行时写满盘是任务的 `error.code` | 由用户腾出空间或换目录 |
| `PACKAGE_INVALID` / `PACKAGE_VERSION_UNSUPPORTED` / `PACKAGE_DIGEST_MISMATCH` / `PACKAGE_PATH_UNSAFE` | `videos.importPackage` 拒绝打开的便携包（§4.1 的 `videos` 行）。放在 `RpcError.details.code`（`invalid-request`）；不留下视频目录 | 不重试同一个文件；向导出方要一个新的包，或升级 BaoCut |
| `EXPORT_RANGE_EMPTY` | 导出范围为空、倒置或在序列之外，或序列是空的 | 读取序列的时长后修改范围 |
| `EXPORT_SOURCE_NOT_FOUND` | 没有可导出的字幕或转写（按语言挑不到），或双语合并找不到另一份文档 | 先转写或给出 `documentId`；不伪造文本 |
| `EXPORT_SOURCE_AMBIGUOUS` | 能导出的文档不止一份（`details.candidates` 列出显示着的字幕与转写两组） | 用 `documentId`（或 `language`）指定一份 |
| `EXPORT_SOURCE_UNSUPPORTED` / `EXPORT_SOURCE_UNPLACED` / `EXPORT_SOURCE_INVALID` | 文档的种类不能导出为字幕或文稿；文档的来源素材不在这条序列上；文档的内容不完整（如缺 `timescale`） | 换一份文档、给出 `scopeItemIds`，或修正文档 |
| `DUB_GROUP_NOT_FOUND` | 音频导出的 `source: { dubGroupId }` 在这条序列上没有配音实例（`invalid-request`，`details.groupId`）；`dub` 的 `regroup` 指的那一组没有配音计划或在时间线上已经没有实例时同样拒绝 | 换一组配音，或导出成品混音；重配时整组重新配音 |
| `EXPORT_NOTHING_TO_EXPORT` | 范围里没有任何文字（都被剪掉了，或文档是空的）；工程导出的序列上没有能写出的片段 | 换一个范围；不导出空文件 |
| `EXPORT_DESTINATION_EXISTS` | 指定的文件名已经存在而没有要求覆盖（`details.path`）；发布时同样检查 | 换一个文件名，或明确要求 `overwrite`（覆盖已有的输出需要授权，§4.3） |
| `EXPORT_DESTINATION_UNWRITABLE` | 目标目录不存在、不是绝对路径、不可写，或发布时写不进去 | 换一个可写的目录，或由用户修改权限 |
| `EXPORT_TOOL_MISSING` | 音频导出要的 ffmpeg / ffprobe 不在（PATH 或 `BAOCUT_FFMPEG` / `BAOCUT_FFPROBE`），或缺所需的编码器；成片导出与响度标准化还要 Render Worker（`export-worker`）。`details.missing` 是缺的东西，`details.remedy` 按缺的是哪个给：提交之后 Render Worker 不见了（任务里再启动时找不到），`missing` 为 `export-worker`，补救是构建它或设 `BAOCUT_EXPORT_WORKER`，不叫人装 ffmpeg。预检时放在 `RpcError.details.code`（`RpcError.code` 为 `conflict`），执行时是任务的 `error.code` | 由用户安装 ffmpeg、构建 Render Worker 或设置环境变量；不自动下载 |
| `EXPORT_RENDER_FAILED` | ffmpeg 生成失败（`details.failed[].problems` 是 stderr 的摘录） | 不发布；报告原因 |
| `EXPORT_UNSUPPORTED_CONTENT` | 成片里有画不出来的内容（`details.items`，§4.4）。预检时放在 `RpcError.details.code`（`RpcError.code` 为 `invalid-request`）；执行时（冻结之后的再次预检）是任务的 `error.code` | 告诉用户是哪些；用户同意时带 `onUnsupported: 'skip'` 重新提交，或先改掉这些内容；不画成空白 |
| `EXPORT_DECODE_FAILED` / `EXPORT_ENCODE_FAILED` | 成片执行时素材的画面解不出来，或编码进程失败（`details.failed[].problems` 是原因与 stderr 的摘录） | 不发布；报告原因 |
| `EXPORT_PARTIALLY_PUBLISHED` | 几个文件里有的没有导出（`details.failed`），已经发布的在 `result.outputs` | 如实报告；需要时只重新导出失败的范围 |
| `LIBRARY_FORMAT_INVALID` | 用户库的导入文件或条目文件认不出、格式或版本不对、超过上限、摘要不符，或录音解码不出声音（`invalid-request`） | 按 `message` 修正文件后重新导入；不按扩展名猜 |
| `LIBRARY_KIND_RESERVED` | 品牌库的种类只保留、还不能写入（`overlayTemplate`，`invalid-request`） | 不重试；等格式开放（架构设计 §14） |
| `LIBRARY_VERSION_CONFLICT` | `library.put` 的 `expectedVersion` 不是条目的当前版本（`conflict`，`details.currentVersion`） | 重新读取条目，在新版本上修改 |
| `LIBRARY_ENTRY_NOT_APPLICABLE` | 条目不能用在这里：术语表、音色、颜色拷进视频；翻译用术语表交给转写，转写用术语表交给翻译，或语言与翻译的方向不符；视频里启用的术语表种类与步骤不符；对外服务的客户端引用用户库的术语表或音色（`details.reason: 'service-client'`）（`invalid-request`） | 换一个合适的条目或方法 |
| `INPUT_UNREADABLE` | 输入读不出来：ffprobe 解析不了文件或文件没有视频轨（`details.file`），或流程的源文档不是认识的格式、没有句子；本地合成的 `reference` 文件读不出来时放在 `RpcError.details.code`（`invalid-request`，`message` 说文件名，完整路径在 `details.file`） | 换一个输入；不重试同一输入 |
| `MEDIA_TOOL_UNAVAILABLE` | 固定流程（文件转码）找不到 ffmpeg / ffprobe，或它不能正常运行（导出用 `EXPORT_TOOL_MISSING`）。提交时检查到的放在 `RpcError.details.code`（`conflict`），执行中发现的是任务的 `error.code` | 安装 ffmpeg，或用 `BAOCUT_FFMPEG` / `BAOCUT_FFPROBE` 指定，然后重试 |
| `SUBTITLE_FILE_INVALID` | 字幕文件的翻译读不准输入：不是能严格解析的 SRT / WebVTT（`details.line`、`details.problem`），或没有一条有文本。提交时是 `invalid-request`（`details.code`、`details.file`），重试时源文件已经改坏是任务的 `error.code` | 修好文件或换一个；不重试同一输入 |
| `SUBTITLE_FILE_TOO_LARGE` | 字幕文件超过上限：4 MiB 或 10000 条（`details.limit`）。提交时是 `invalid-request` | 拆成几个文件分别翻译 |
| `TRANSCODE_FAILED` | ffmpeg 以非零状态退出（`details.exitCode`，`details.stderr` 是输出的结尾） | 按 stderr 调整参数或换输入；临时文件已清理 |
| `TRANSCODE_NO_AUDIO` | 提取音频（`transcode` 流程的 `action: 'extract-audio'`）的输入没有音频轨（`details.file`），停在读取这一步，是任务的 `error.code` | 换一个有声音的输入；不重试同一输入 |

`LIBRARY_*` 放在 `RpcError.details.code`，`RpcError.code` 是括号里的值。

字幕文件的翻译的告警（`JobRecord.warnings`）：`SUBTITLE_MARKUP_STRIPPED`（原文的行内标记没有带进译文）、`SUBTITLE_SETTINGS_DROPPED`（WebVTT 转 SRT 时 cue settings 与 NOTE / STYLE / REGION 块放不下）。

导出预检里的 `ASSET_MISSING` / `ASSET_CHANGED` 同样放在 `RpcError.details.code`（`RpcError.code` 为 `conflict`）：链接素材的内容摘要在预检时核对一次；排队之后文件的长度或修改时间变了，执行前再核对一次，不符时任务以同样的错误码失败。

### 11.5 时间

| 错误码 | 条件 | 规定的恢复 |
| --- | --- | --- |
| `TIME_DOMAIN_MISMATCH` | 裸帧、时间域不符，或把源时间与序列时间混用 | 读取作用域与 `Rate` 之后重建命令 |
| `INVALID_TIME_VALUE` | 非法的十进制、负的绝对位置、零 timebase | 修正输入；不静默猜测 |
| `TIME_ARITHMETIC_OVERFLOW` | 输入或中间的有理数超出合同上限 | 拒绝并报告字段与限额；不降级为浮点 |
| `TIME_NOT_ON_FRAME_GRID` | `exact-frame` 的请求不在合法的边界上 | 给出候选边界，由调用方用明确的策略重新提交 |
| `TIME_RANGE_COLLAPSED` | 量化之后长度为零、越界或破坏了安全区间 | 修改范围或策略；不自动补帧，不扩大删除 |
| `EXPORT_RANGE_NOT_ON_OUTPUT_GRID` | `exact-grid` 的输出不能整除 | 显式修改范围、帧率，或选择 `cover-range` |
| `EDIT_FPS_CHANGE_UNSUPPORTED` | `preserve` 策略或依赖重映射的能力没有经过验证 | 关闭这个操作；不把导出帧率当作替代写入 |

### 11.6 规则

- 数值上的不匹配不绕过普通的版本冲突、权限、锁定与目标检查。
- 错误码的细分不意味着新增平级的后台服务。
- 证据的 hash 不等于真实性的来源认证；合同的 hash 不等于权限；资源租约不等于任务授权。
- 新增错误码时，必须同时给出条件与规定的恢复。

### 11.7 CLI 的退出码与 `next`

CLI 把成功与失败都写成信封：成功 `{ ok: true, result, next?, runtime? }`（`next` 只在信封顶层出现一次：结果里的 `next` 提到顶层，不在 `result` 里重复），失败 `{ ok: false, error, runtime? }`，`error` 与 `catalog.call` 的错误对象相同，CLI 自己发现的问题（参数、缺 `--yes`、Runtime 不可用）也用这个形状；`runtime: { started: true }` 表示这次自动拉起了 Runtime。退出码只按错误码查一张表（`apps/cli/src/envelope.ts`），派生命令、元命令与管理命令共用（[Agent 能力面设计 §5.2](../design/agent-surface/agent-surface-design.md#52-退出码)）：

| 退出码 | 含义 | 错误码 |
| --- | --- | --- |
| 0 | 成功，含等到完成的任务 | — |
| 1 | 失败或取消：工具或引擎拒绝、任务终态 `failed` / `cancelled` / `interrupted` / `needs-reconciliation`、等待超时（`WAIT_TIMEOUT`，任务继续跑）、管理命令没做成（`COMMAND_FAILED` 等）、Runtime 不归这个 CLI 停或还有人在用、说明书找不到或写错（`catalog.agentSkill`） | `RUNTIME_NOT_OWNED` `RUNTIME_IN_USE` `AGENT_SKILL_NOT_FOUND` `AGENT_SKILL_INVALID`；表里没列出的错误码都是 1 |
| 2 | 要用户先做一件事：配置能力、授权或预算、同意或安装外部工具、登录、音色授权；输出带 `remedy` 与 `next`，Agent 转告用户，不自己绕过 | `CAPABILITY_NOT_CONFIGURED` `DUB_SEPARATION_NOT_CONFIGURED` `MODELS_DIR_MISSING` `CREDENTIAL_UNAVAILABLE` `AUTHENTICATION_REQUIRED` `OFFLINE_STRICT` `GRANT_REQUIRED` `GRANT_REVOKED` `BUDGET_EXCEEDED` `BUDGET_UNVERIFIABLE` `TASK_BUDGET_EXCEEDED` `TASK_BUDGET_UNVERIFIABLE` `TOOL_UNAVAILABLE` `TOOL_CONSENT_REQUIRED` `TOOL_UPDATE_CONFIRM_REQUIRED` `TOOL_UPDATE_MANUAL` `MEDIA_TOOL_UNAVAILABLE` `EXPORT_TOOL_MISSING` `LINK_LOGIN_REQUIRED` `LINK_COOKIES_UNAVAILABLE` `LINK_TOOL_UPDATE_REQUIRED` `VOICE_CONSENT_REQUIRED` `VOICE_CLONE_REQUIRED` |
| 3 | Runtime 不可用：连不上、`--no-start` 时没有在跑的、拉不起、协议或接口版本不同、离线时既没有快照也没有 Runtime | `RUNTIME_UNAVAILABLE` `RUNTIME_START_FAILED` `PROTOCOL_MISMATCH` `INTERFACE_VERSION_MISMATCH` `CATALOG_UNAVAILABLE` |
| 4 | 参数不对，或要确认的命令缺 `--yes`（不在终端里时不默认同意；`models install` 缺 `--yes` 时只报模型包与大小、不下载） | `INVALID_ARGUMENTS` `UNKNOWN_COMMAND` `UNKNOWN_TOOL` `CONFIRMATION_REQUIRED` |

任务以失败或取消结束时按任务的错误码查表，结果只会是 1 或 2。网关的 `RpcError` 取 `details.code`，没有时把 `code` 转成大写下划线再查。Ctrl-C 先取消正在等的任务，第二次直接退出（130）。

`next` 是建议的下一步。工具写 `next` 时用工具名（MCP 的写法，`jobs_wait`、`models_install`）；`catalog.call` 对 `cli` 连接把结果与错误顶层的 `next` 里目录中的 `<名词>_<动词>` 换成 `baocut <名词> <动词>`（多词动词 `_` → `-`），一级动词两边同名、不动；其他主体照原样。CLI 自己写的 `next`（`baocut runtime ensure`、`baocut jobs wait <jobId>`）本来就是命令。

---

## 12. 示例

以下是目标合同的示例。`actor` 由服务端注入。

### 12.1 用秒移动一个实例

视频里 `main` 序列的编辑帧率是 30000/1001，基线版本是 7。

请求：

```json
{
  "protocolVersion": 1,
  "requestId": "req-time-001",
  "commandId": "move-scene-2-to-10s",
  "method": "edits.apply",
  "videoId": "video-demo",
  "expectedRevision": "7",
  "payload": {
    "operations": [{
      "type": "moveItem",
      "itemId": "scene-2",
      "sequenceId": "main",
      "at": { "unit": "seconds", "value": "10.000" },
      "alignment": "nearest-frame"
    }]
  }
}
```

回执（节选）：

```json
{
  "transactionId": "tx-time-001",
  "videoRevision": "8",
  "timeResolution": [{
    "domain": { "kind": "sequence", "sequenceId": "main" },
    "sequenceRevision": "5",
    "editFps": { "num": 30000, "den": 1001 },
    "requested": { "unit": "seconds", "value": "10.000" },
    "requestedTime": { "ticks": "10", "timescale": 1 },
    "actualFrame": 300,
    "actualTime": { "ticks": "1001", "timescale": 100 },
    "delta": { "ticks": "1", "timescale": 100 },
    "policy": "nearest-frame"
  }]
}
```

- 视频版本与序列版本是两条不同的版本轴，上例中的 8 与 5 不要求相等。
- 实际落点是第 300 帧，即 10.010 秒，比请求晚 10 毫秒。这是帧网格的量化。
- 要以 60 fps 输出，在冻结的导出里声明 `fps: { "num": 60, "den": 1 }`，不调用 `changeSequenceFrameRate`。
- 「10 秒、600 帧」只在冻结的范围确实是 10 秒时成立；不能把视觉上的 10.010 秒写成 10 秒。

### 12.2 接受口播剪辑建议

这是 Runtime 交给引擎的**内部事务**。公共客户端只提交 `commandId`、`expectedRevision` 和领域操作，不能自行声明 `actor`。

```json
{
  "id": "tx-cut-001",
  "videoId": "video-demo",
  "baseVideoRevision": "7",
  "idempotencyKey": "accept-cut-proposal-001-v1",
  "actor": { "kind": "agent", "id": "agent-session-1" },
  "readSet": [
    { "entityId": "main", "revision": "4" },
    { "entityId": "talk-full", "revision": "2" },
    { "entityId": "speech-zh", "revision": "1" }
  ],
  "label": "删除已确认的长停顿",
  "operations": [{
    "type": "acceptCutSuggestions",
    "sequenceId": "main",
    "proposalId": "cut-proposal-001",
    "suggestionIds": ["cut-sl-w12"]
  }]
}
```

时间区间来自提案里这条建议记下的源区间，由引擎编译成剪口，不由这个请求另传一套秒数来覆盖（§4.2）；要改区间时用 `addCuts`，把建议的 ID 写进 `ref`。其余实例怎样移动看各自的 `followPolicy`（视频格式规范 §3.16），锁着的轨道或实例要动时整笔拒绝（`TARGET_LOCKED`）。

回执：

```json
{
  "transactionId": "tx-cut-001",
  "status": "committed",
  "previousRevision": "7",
  "videoRevision": "8",
  "createdIds": ["talk-a", "talk-b"],
  "updatedIds": ["main", "caption-zh"],
  "deletedIds": ["talk-full"],
  "lineage": { "talk-full": ["talk-a", "talk-b"] },
  "impact": {
    "oldDurationFrames": 360,
    "newDurationFrames": 300,
    "captionProjection": "recomputed",
    "translationUnitsStale": [],
    "dubbingUnitsStale": [],
    "orphanedAnchors": []
  },
  "undo": { "available": true, "token": "undo-tx-cut-001" }
}
```

这个例子删除的是句与句之间的停顿，译句的内容不变，所以过期列表为空。数值与视频格式规范 §6.6 的复算例一致：12 秒、30 fps 的片段删去 2 秒，360 帧变为 300 帧。

### 12.3 修改代码合成的参数

```json
{
  "type": "setCodeParameters",
  "itemId": "earth-instance-1",
  "expectedBundleRef": { "id": "earth", "revision": "3" },
  "values": { "rotationSpeed": 0.15 },
  "scope": "selected-instance"
}
```

参数 Schema 不允许的字段直接失败。替换源码使用 `replaceCodeBundle`，不复用这个操作。

### 12.4 提交配音的计算

```json
{
  "capability": "tts",
  "inputVersionRefs": [
    { "id": "dubbing-unit-3-script", "revision": "2" }
  ],
  "parameters": {
    "language": "en-US",
    "voiceBindingId": "speaker-1-en",
    "output": { "sampleRate": 48000, "channels": 1 }
  },
  "permissionGrant": "grant-tts-17",
  "outputContract": "baocut.voice-result/v1"
}
```

计算的结果不直接修改时间线。验证过真实的时长、并经过引擎的事务之后，才能显示「已应用」。

### 12.5 版本冲突

```json
{
  "code": "PROJECT_REVISION_CONFLICT",
  "message": "视频已更新到版本 9，请求基于版本 7。",
  "entityIds": ["scene-2"],
  "inputRevisions": [{ "id": "video-demo", "revision": "7" }],
  "retryability": "after-refresh",
  "details": { "currentRevision": "9", "changedSince": ["scene-2", "caption-zh"] },
  "recovery": "重新读取 scene-2，形成新的操作后用新的 commandId 提交。"
}
```

### 12.6 原地替换代码画面

下三分之一字幕条改了颜色，重新打包成第 2 版、烘焙出新的预渲染并作为素材导入之后，把时间线上的实例换成新版本（代码包规范 §3.3）。智能体经 `compositions_import` 的 `replace` 走到的就是这一步。

```json
{
  "type": "replaceCodeBundle",
  "itemId": "lower-third-1",
  "assetRef": { "id": "asset-lower-third-v2", "revision": "1" },
  "prerender": { "id": "asset-lower-third-v2-prerender", "revision": "1" }
}
```

回执（节选）：

```json
{
  "updatedIds": ["lower-third-1"],
  "impact": {
    "codeEdits": [{
      "itemId": "lower-third-1",
      "layer": "source",
      "previousBundleRef": { "id": "asset-lower-third-v1", "revision": "1" },
      "bundleRef": { "id": "asset-lower-third-v2", "revision": "1" },
      "previousPrerender": { "id": "asset-lower-third-v1-prerender", "revision": "1" },
      "prerender": { "id": "asset-lower-third-v2-prerender", "revision": "1" },
      "oldDurationFrames": 120,
      "newDurationFrames": 90
    }]
  }
}
```

- 实例 ID、轨道、起点、几何与不透明度、名字、效果与关键帧不变；`timeMap` 回到从 0 开始的线性映射。
- 新版本短 30 帧，实例从尾部裁短；`oldDurationFrames` 与 `newDurationFrames` 让裁短可见。新版本更长、撞上同一轨道后面的实例时以 `TIMELINE_OVERLAP` 拒绝，`recovery` 提示先 `moveItem` 或 `deleteItems`。
- 实例有参数而新清单去掉或换了 `parametersSchemaRef` 时，要同时给 `parameterValues`，否则以 `INVALID_OPERATION` 拒绝（`details.rule: "parameters-incompatible"`）。

### 12.7 清理换下来的旧版本

接着 §12.6：第 1 版的代码包与它的预渲染替身都没有引用了。`assets_prune`（不给 `apply`）列出它们，互相标出另一半；确认不再回退之后只列代码包也能删掉这一对。

```json
{ "type": "removeAssets", "assetIds": ["asset-lower-third-v1"] }
```

回执（节选）：

```json
{
  "deletedIds": ["asset-lower-third-v1", "asset-lower-third-v1-prerender"],
  "impact": { "removedAssets": ["asset-lower-third-v1", "asset-lower-third-v1-prerender"] }
}
```

- 列出的是第 2 版（实例还在用）时整笔拒绝：`INVALID_OPERATION`，`details: { "rule": "asset-in-use", "usedBy": { "asset-lower-third-v2": ["lower-third-1"] } }`。
- 只删记录：撤销这一笔，两个素材原样回来；bytes 由 GC 之后回收。

---

## 13. 待评审事项

| 事项 | 状态 | 需要决定什么 |
| --- | --- | --- |
| `TransactionReceipt` 的字段（§5） | 本规范补全 | `impact` 的完整结构；撤销范围的表达 |
| `PrepareBatchRequest` / `PreparedBatch`（§7.1） | 本规范补全 | 预检结果的有效期；`proposalHash` 覆盖哪些内容 |
| `VideoEvent.projection`（§10.1） | 本规范补全 | 投影变化的格式（按实体的补丁，或按视图的增量） |
| `ErrorBody.retryability` 的取值（§11.1） | 本规范补全 | 取值集合 |
| 方法全集（§4.1） | 只列出代表性条目 | `conversations`、`tasks`、`agents` 各方法的 payload |
| `EditOperation` 的全集与每个操作的 Schema | 只列出代表性操作 | 由契约单源生成；首版开放哪些 |
| 自动重基（§3.2） | P1 | 哪些对象或字段组合可以被证明相互独立 |
| 相对偏移的输入类型（§6.1） | 未定义 | 「晚两秒」这类相对输入的字段形式 |
| 批次上限（§7.4） | 待测 | 操作个数、体积与计算量的默认值 |
| 分支与合并（§8.2） | P1 | 检查点是否带分支；合并的冲突模型 |
| 安全整数范围（§1.4） | 未给出数值 | 帧计数、`Rate` 分子分母与 `ticks` 的上限 |
| `exports.updateDraft`（导出草稿，§4.1、§4.4） | 推迟 | 草稿保存在哪里（视频里还是 Runtime 里）、按视频还是按序列、与界面的导出面板怎样同步；这个版本由调用方在 `exports.create` 里给全部 `ExportSettings` |
| 工程与便携包导出的其余部分（§4.4） | 推迟 | 便携包的文件夹形式、压缩、签名与链接式；工程的拷贝式、FCPXML 与剪映草稿（架构设计 §14） |
