# Bot 模式：技术方案

**状态：方案稿（2026-10-31）。** 需求与界面见[需求文档](bot-mode-requirements.md)，本文的需求编号（BOT-…）与决定（D1–D7）都指那里。本文写在现有的 Agent Harness、会话存储、完成收件箱、定时任务与工具桥之上要加什么、改什么；文中的代码位置以写作时的主干为准（`d96a1a9c`），实现时以代码为准。

## 目录

- [1. 设计取向](#1-设计取向)
- [2. 现有部件与落点](#2-现有部件与落点)
- [3. 总体结构](#3-总体结构)
- [4. 数据模型](#4-数据模型)
- [5. 存储](#5-存储)
- [6. 协调者](#6-协调者)
- [7. 线程](#7-线程)
- [8. ThreadRouter：简报、转交与回报](#8-threadrouter简报转交与回报)
- [9. 任务状态机](#9-任务状态机)
- [10. 智能体工具](#10-智能体工具)
- [11. 定时任务与 Make](#11-定时任务与-make)
- [12. 智能提示](#12-智能提示)
- [13. 上下文组装与转义](#13-上下文组装与转义)
- [14. 安全与授权的落点](#14-安全与授权的落点)
- [15. 后台服务](#15-后台服务)
- [16. 协议：方法、主题与事件](#16-协议方法主题与事件)
- [17. 界面实现](#17-界面实现)
- [18. 并发、限流与成本](#18-并发限流与成本)
- [19. 可观测与诊断](#19-可观测与诊断)
- [20. 测试](#20-测试)
- [21. 实施顺序与 PR 拆分](#21-实施顺序与-pr-拆分)
- [22. 风险](#22-风险)
- [23. 待评审事项](#23-待评审事项)

## 1. 设计取向

Bot 模式的形状照搬一种已经在长期运行的个人助理里验证过的做法，按用户从外面看得到的行为来实现：

- **每个频道一个常驻协调者**，在频道唯一的一条对话里回答、分派、转述；它不亲自做耗时的活。
- **每条任务一个后台线程**，线程只做这一条任务，到停点时写一份报告交给协调者。
- **任务是一等对象**：有状态、步骤、更新、结果和一个「等你回答的问题」；线程与协调者通过工具改它，界面从它画任务面板。
- **刷新**是一种不带新要求的叫醒：只看任务自己的来源有没有变化，没有就什么都不发。
- **定时任务与建议任务**都落成任务；建议只是建议，用户采纳才算数。
- **可点的提示**是预填的用户消息，点了才算用户说的。
- **记忆是文件**：频道一份记忆，线程一份工作笔记；都是给智能体读的数据，不是指令。

实现上的原则：

1. **不另起一套智能体引擎**。频道对话与线程都是 `Conversation`，回合都走 `Harness.send` / `#startRun`；Driver、访问模式、审批、预算、Job、完成收件箱原样复用。
2. **新状态放在新存储里**。频道与任务各有自己的存储；`Conversation` 只加几个可选字段，旧会话读写不变（BOT-NF-06）。
3. **跨会话的消息都由 Runtime 搬运**。协调者与线程互相看不到对方的原生会话；简报、转交、报告都是 Runtime 写进对方会话的条目，引用的用户消息由 Runtime 原文复制，不经智能体转述。
4. **权限不随消息流动**。用户的「同意」只来自用户自己的消息、按钮与表情；任何经智能体之手的文字（简报、报告、记忆、提示）都不能让审批变松（§14）。

## 2. 现有部件与落点

| 现有部件 | 位置 | Bot 模式怎么用 |
| --- | --- | --- |
| `Harness`：`createConversation`、`send`、`steer`、`stopTask`、`interrupt` | `packages/harness/src/harness.ts`（`send` :1580，`steer` :1873，`stopTask` :2504） | 频道对话与线程都由它建、由它跑；一条会话同一时刻只有一个任务（`#checkCanSend` 抛 `busy`），线程之间天然隔离 |
| 完成收件箱：`JobInbox` → `Harness.jobFinished` → `#deliverJobs` | `runtime-core/src/job-inbox.ts:18`；`harness.ts:1960`、`:1968` | 「不带用户消息叫醒一条会话」现在只有这一条路：插话（`steered`）、挂起到回合结束（`held`）、重开任务起新回合（`woke`）。§8 把它抽成通用的 `Harness.deliver`，线程回报与转交都走它 |
| `ConversationStore`：`<id>.jsonl` 只追加日志 | `runtime-storage/src/conversation-store.ts:86` | 频道对话与线程照用；WorkItem 日志沿用同一套「快照行 + 变更行 + 压缩」写法 |
| `TimelineItem` 联合类型 | `protocol/src/domain.ts:295` | 新增 `work-item-ref`、`relay`、`proposal`、`suggestions` 四种条目 |
| 分叉历史与上下文标签：`forkHistory`、`contextBlock`、`escapeContextTags` | `harness/src/fork.ts`、`harness/src/context-tags.ts` | 接力种子复用 `forkHistory`；新标签都以 `baocut-` 开头，自动落在现有转义规则里 |
| `folderOf` 共用工作目录 | `harness.ts:1090` | 线程不用 `folderOf`，直接以频道文件目录为 `cwd`（§7.1） |
| 提问卡（`approval` 条目，`request.kind: 'question'`）与 `conversations_ask` | `agent-tools/conversation-tools.ts`；`Harness.askQuestions` | 线程的「需要你输入」直接由提问卡与审批推出；提问卡选项同时生成答案提示（§12） |
| `todo.updated` → 任务条目的 `todo` | `harness/src/projector.ts:113` | 映射成 WorkItem 的步骤（BOT-TK-07） |
| `ScheduleService` | `runtime-core/src/schedules/schedule-service.ts:82`；`protocol/src/schedule.ts` | 新增一种目标：到点建 WorkItem 并开线程（§11.1） |
| 工具目录：`ToolSet`、`ToolCatalog`、`AgentGrants`、`McpEndpoint`、`AgentScope` | `runtime-core/src/agent-tools/` | 新增 `BotTools` 工具集；目前没有按会话过滤工具的能力，§10.1 补上 |
| `ApprovalService`、`decideApproval`、`GrantService` | `harness/src/approval-service.ts:64`；`protocol/src/access.ts`；`runtime-core/src/grants/grant-service.ts:141` | 无人在场的运行在判定时多一个条件（§14.2） |
| 文本生成：`TextGenerator.generate` | `packages/models/src/text-generation.ts:489`；`services.textGenerator()` | Make 生成候选、提示的兜底生成都走它，记入用量账本 |
| 进程：`RuntimeSupervisor`、`detach` + 空闲退出、退出时的「后台继续」 | `apps/desktop/src/main/runtime-supervisor.ts:89`；`apps/desktop/src/main/app-main.ts:352`；`apps/runtime/src/main.ts` | 已经能在窗口全关后继续跑完手头的活再退出；缺托盘、开机自启和「常驻不退」（§15） |
| 渲染端 Rail、`Tab`、`HomeSidebar`、`BaoCutClient` 与 reducers | `packages/ui/src/components/rail.tsx:79`；`state/shell-store.ts:58`；`packages/client/src/client.ts:107` | 新增 `bot` 页、频道与任务两个 store、两个订阅（§17） |
| 存储路径：`RuntimeHome` | `runtime-storage/src/home.ts:108` | 新增 `channelsFile`、`workItemsDir`、`channelsDir`（§5） |

## 3. 总体结构

```text
Renderer（packages/ui）
  BotPage ─ ChannelSidebar / ChannelView / TaskPanel / TaskDetail
     │ subscribe: channels、work-items:<channelId>、conversation:<id>、tasks
     │ rpc: channels.*、workItems.*、bot.*、conversations.send / steer
     ▼
Runtime（runtime-core）
  BotService（新）
   ├─ ChannelStore ─────────── store/channels.json
   ├─ ChannelFiles ─────────── <root>/channels/<id>/{MEMORY.md, files/, threads/, make-runs.jsonl}
   ├─ WorkItemStore ────────── store/work-items/<channelId>.jsonl
   ├─ WorkItemMachine ─ 状态机：唯一能改 WorkItem 状态的地方
   ├─ ThreadRouter ─── 开线程、转交、回报、并发闸门、重启对账
   ├─ CoordinatorKeeper ─ 协调者的会话指令、接力
   ├─ ActivityBridge ─── 订阅 directory / tasks，把线程活动推成任务子状态
   ├─ MakeService ─── 建议任务、周期任务模板（在 ScheduleService 之上）
   ├─ SuggestionService ─ 提示的写入、作废、核验
   └─ BotTools（ToolSet）── channel_* / work_items_* / thread_* / suggest_* / *_propose
  Harness（扩展）
   ├─ deliver()：通用的「不带用户消息投递」（插话 / 挂起 / 起回合）
   ├─ Conversation.role / channelId / workItemId / handoffGeneration
   └─ AgentToolAccess.sessionInstructions(conversationId)：按角色给指令
  ScheduleService（扩展 target: 'work-item'）
  工具风险（无人时 effectiveMode 降到 auto、付费调用升为 high，§14.2）
Desktop main（扩展）
  Tray / 菜单栏、开机自启、窗口全关后不退出、通知
```

`BotService` 在 `startRuntime()` 里与 `ScheduleService`、`JobInbox` 一起装配（`runtime.ts` :818–:866 附近），持有 `harness`、`schedules`、`textGenerator`、`log`。它不在 Harness 里：Harness 只负责会话与回合，Bot 的组织规则留在 runtime-core，方便单测。

## 4. 数据模型

所有新类型放在 `packages/protocol/src/bot.ts`，从 `protocol/src/index.ts` 导出；zod 模式放在 `protocol/src/schemas.ts` 里同名的 `*Schema`。

### 4.1 频道

```ts
type ChannelKind = 'main' | 'topic';

interface Channel {
  id: Id;                        // chan_…
  kind: ChannelKind;             // main 每个 Runtime 恰好一个
  name: string;                  // ≤ 40 字
  purpose: string;               // ≤ 2000 字，可空
  conversationId: Id;            // 频道对话（role: 'channel'）
  driverId: DriverId;            // 协调者与新线程的默认 Driver
  model: string | null;
  effort: string | null;
  defaultAccessMode: AgentMode | null;   // null = 跟随全局默认（auto）
  maxAccessMode: AgentMode | null;       // 线程与任务级覆盖的上限（BOT-SF-01）
  templateId: string | null;
  pinned: boolean;
  archived: boolean;
  archivedAt: string | null;
  limits: { concurrentThreads: number; dailyBudget: Money | null; monthlyBudget: Money | null };
  memoryVersion: number;         // MEMORY.md 的版本号，写入时校验
  createdAt: string;
  updatedAt: string;
}

interface ChannelSummary {       // channels 主题快照里每个频道一行
  channel: Channel;
  unread: boolean;
  counts: { needsYou: number; working: number; upNext: number; suggested: number };
  lastActivityAt: string;
}
```

频道没有 `projectId`（D4）。频道的文件目录与记忆位置由 id 推出，不存路径（§5）。

### 4.2 会话的新字段

```ts
type ConversationRole = 'chat' | 'channel' | 'thread';

interface Conversation {
  // 既有字段不变，新增（都可选，旧数据缺省等于 role: 'chat'）：
  role?: ConversationRole;
  channelId?: Id;                // role 为 channel / thread 时必填
  workItemId?: Id;               // role 为 thread 时必填
  handoffGeneration?: number;    // 协调者接力的代数（§6.3）
}
```

- `role: 'channel' | 'thread'` 的会话不进 `directory` 主题的 Home 列表：`directory` 快照与事件照常带上它们（不破坏订阅者），`HomeSidebar` 按 `role` 过滤。CLI 的 `conversations list` 默认也过滤，加 `--all` 显示。
- 频道对话与线程只能经 Bot 的方法改动。Harness 在入口处按 `role` 统一拒绝（`RpcError('invalid', code:'BOT_ROLE_LOCKED')`），不靠每个处理器各自记得：

  | 入口 | `channel` | `thread` | 原因 |
  | --- | --- | --- | --- |
  | `conversations.fork` | 拒绝 | 拒绝 | 频道对话只有一条（BOT-CV-01）；线程与任务一一对应 |
  | `conversations.delete` | 拒绝 | 拒绝 | 只能随频道或任务删 |
  | `conversations.update` 改 `archived`、`projectId`、`driverId`、`accessMode` | 拒绝 | 拒绝 | 分别走频道设置、任务设置（§16.1） |
  | `schedules.create` / `schedules.update`，`target:'conversation'` 指向它们 | 拒绝 | 拒绝 | 定时只能走 `work-item` 目标，否则会绕开 WorkItem 与状态机 |
  | `conversations.forkVideos`、导入到会话 | 拒绝 | 拒绝 | 同上 |
  | `conversations.send` / `steer` / `markRead` / `markUnread` | 允许 | 允许 | 正常对话 |

  Bot 自己的内部调用带一个只在 Runtime 进程内可得的令牌绕过这张表。新增 `conversations.*` 方法时，默认对这两种角色拒绝，在表里登记才放开。

### 4.3 新的会话条目

```ts
// 加进 TimelineItem 联合（domain.ts:295），基础字段 {id, createdAt, taskId}

interface WorkItemRefItem {      // 频道对话里的线程卡占位；卡片内容由界面从 WorkItem 实时画
  kind: 'work-item-ref';
  workItemId: Id;
  ackGroup: Id | null;           // 同一行确认下的多张卡共用（BOT-CV-03）
}

interface RelayItem {            // Runtime 搬进会话的、不是用户打的字
  kind: 'relay';
  direction: 'report' | 'brief' | 'relay' | 'refresh' | 'schedule' | 'make' | 'moved';
  workItemId: Id | null;
  reportId: Id | null;
  from: { role: 'coordinator' | 'thread' | 'system'; conversationId: Id | null };
  text: string;                  // 原文；界面默认折叠，智能体看到的是 §13 的标签块
  cited: CitedMessage[];         // Runtime 复制的用户原话
}

interface CitedMessage {
  messageId: Id;
  conversationId: Id;
  author: 'user' | 'coordinator';   // 由 Runtime 按条目 kind 填：user-message → user，agent-message → coordinator
  via: 'typed' | 'suggestion' | 'reaction' | 'notification' | null;   // 用户消息的来源；coordinator 为 null
  text: string;                  // 原文，超过 4000 字截断并标 truncated
  truncated: boolean;
  at: string;
}

interface ProposalItem {         // 智能体提出、等用户点的卡片
  kind: 'proposal';
  proposal:
    | { type: 'channel'; name: string; purpose: string; templateId: string | null }
    | { type: 'schedule'; name: string; cadence: ScheduleCadence; template: WorkItemTemplate; accessMode: AgentMode | null }
    | { type: 'suggestions'; workItemIds: Id[] };     // Make 建议卡，指向 status = suggested 的任务
  status: 'pending' | 'accepted' | 'declined' | 'stale';
  resultId: Id | null;           // 建好的频道 / 定时任务 id
}

interface SuggestionsItem {      // §12
  kind: 'suggestions';
  forItemId: Id;                 // 挂在哪条 agent-message / approval 下
  source: 'agent' | 'question' | 'system';
  chips: SuggestionChip[];       // ≤ 4
  state: 'open' | 'used' | 'stale';
  usedChipId: Id | null;
}

interface SuggestionChip {
  id: Id;
  label: string;                 // ≤ 12 字
  text: string;                  // 点了发出的完整句子，≤ 80 字
  kind: 'answer' | 'confirm' | 'decline' | 'next-step' | 'starter' | 'disambiguate';
  fillOnly: boolean;             // starter 为 true：只填进输入框
  recommended: boolean;
  answers: { approvalId: Id; optionIndex: number } | null;   // 来自提问卡的答案提示
  target: { workItemId: Id } | null;                         // 消歧提示
  action: { kind: 'resolve'; workItemId: Id } | null;        // 「标为完成」提示：点了由 Runtime 以用户身份关任务（§12.4）
}

// user-message 新增（都可选）：
interface UserMessageItem {
  via?: 'typed' | 'suggestion' | 'reaction' | 'notification';
  suggestionChipId?: Id;
  replyToItemId?: Id;            // 回复某张线程卡（BOT-EX-09）
}
```

### 4.4 任务（WorkItem）

```ts
type WorkItemStatus = 'suggested' | 'upNext' | 'scheduled' | 'active' | 'resolved';
type ActiveState = 'working' | 'needsReview' | 'needsInput' | 'blocked' | 'waitingOnOthers';
type Resolution = 'done' | 'dismissed' | 'merged';
type Actor = 'user' | 'coordinator' | 'thread' | 'system';

interface WorkItem {
  id: Id;                        // wi_…
  channelId: Id;
  title: string;                 // ≤ 140
  titleBy: 'user' | 'agent';     // 用户写的标题智能体不能改
  description: string;           // ≤ 280
  owner: 'agent' | 'user';
  status: WorkItemStatus;
  active: { state: ActiveState; reason: string | null; since: string } | null;   // status = active 时有
  resolution: { kind: Resolution; by: Actor; at: string; evidence: Evidence[] | null; confirmedBy: Id | null; mergedInto: Id | null } | null;   // Evidence 见 §9.5；confirmedBy 是用户确认那条消息的 id
  priority: 'high' | 'medium' | 'low';
  dueOn: string | null;          // YYYY-MM-DD，用户时区
  startAt: string | null;        // status = scheduled 时的开始时刻
  steps: WorkItemStep[];         // 剩下的，≤ 6
  finishedSteps: { text: string; result: string; at: string }[];
  updates: { text: string; at: string; by: Actor }[];      // 每条 ≤ 80 字，保留最近 50 条
  outcome: string | null;
  question: WorkItemQuestion | null;
  resources: ResourceRef[];      // ≤ 5
  outputs: ArtifactRef[];        // 线程做出的产物，同一产物只留最新版本
  dependsOn: Id[];               // BOT-EX-14
  overrides: { accessMode: AgentMode | null; driverId: DriverId | null; model: string | null; budget: Money | null } | null;
  suggestion: SuggestionMeta | null;     // status = suggested 时有
  source: { kind: 'conversation' | 'manual' | 'make' | 'schedule' | 'thread' | 'import'; messageId: Id | null; scheduleId: Id | null; runId: Id | null };
  threadId: Id | null;
  lastReportId: Id | null;
  createdAt: string;
  updatedAt: string;
}

interface WorkItemStep { text: string; state: 'pending' | 'active' }

interface WorkItemQuestion {
  text: string;                  // ≤ 140，提问在前
  kind: 'review' | 'input';
  options: { label: string; description: string | null }[];   // ≤ 4，可空
  pick: number | null;           // 智能体的推荐；risky 时必须为 null
  risky: boolean;                // 花钱、外发、不可撤销
  askedBy: 'thread' | 'coordinator' | 'system';
  approvalId: Id | null;         // 由审批或提问卡推出时指向它
}

type ResourceRef =
  | { kind: 'video'; projectId: Id; videoId: Id }
  | { kind: 'file'; path: string }                  // 绝对路径或频道文件目录下的相对路径
  | { kind: 'space'; entryId: Id }
  | { kind: 'doc' | 'slides' | 'design'; id: Id }
  | { kind: 'message'; conversationId: Id; itemId: Id }
  | { kind: 'work-item'; workItemId: Id };

type ArtifactRef = ResourceRef & { label: string; version: string | null };

interface SuggestionMeta {
  reason: string;                // 一句话
  evidence: ResourceRef[];       // ≤ 3
  trigger: 'manual' | 'channel-created' | 'item-resolved' | 'thread-report' | 'new-media';
  kindTag: string;               // 如 derive-shorts、add-captions；去重与偏好学习用
  subjectKey: string;            // kindTag + 对象 id 的哈希，14 天去重窗口的键
  expiresAt: string;
}

interface WorkItemTemplate {     // 周期任务每次到点建的任务
  title: string;
  description: string;
  owner: 'agent' | 'user';
  prompt: string;                // 线程简报的正文
  resources: ResourceRef[];
}

interface ThreadReport {
  id: Id;                        // rep_…
  workItemId: Id;
  threadId: Id;
  taskId: Id;                    // 线程里写报告的那个 Task
  stop: 'done' | 'needs-review' | 'needs-input' | 'blocked' | 'waiting';
  headline: string;              // 第一句结论，≤ 120，供通知与转述
  text: string;                  // 报告全文（线程里那条 agent-message 的原文）
  question: WorkItemQuestion | null;
  outputs: ArtifactRef[];
  userTodos: string[];           // 线程发现的、属于用户的事（BOT-TK-02）
  followUps: string[];           // 可以接着做的事 → 建议任务
  waitingFor: { jobIds: Id[]; workItemIds: Id[]; note: string | null } | null;
  createdAt: string;
  delivery: 'pending' | 'delivered' | 'superseded';
}

interface WorkItemTransition {
  workItemId: Id;
  from: WorkItemStatus | ActiveState | Resolution;
  to: WorkItemStatus | ActiveState | Resolution;
  actor: Actor;
  cause: string;                 // 机器可读：'report:needs-review'、'approval:pending'、'user:resolve'…
  note: string | null;           // 一行人话
  at: string;
}
```

字段长度与条数是硬限制，在 `WorkItemMachine` 与工具的 zod 模式里同时校验；超长不截断，返回 `ToolError('invalid')` 让智能体改写。

## 5. 存储

### 5.1 路径

`RuntimeHome`（`runtime-storage/src/home.ts`）新增三个字段：

| 字段 | 路径 | 内容 |
| --- | --- | --- |
| `channelsFile` | `<root>/store/channels.json` | `{ schemaVersion: 1, channels: Channel[] }` |
| `workItemsDir` | `<root>/store/work-items/` | 每个频道一份 `<channelId>.jsonl` |
| `channelsDir` | `<root>/channels/` | 每个频道一个目录（见下） |

```text
<root>/channels/<channelId>/
  MEMORY.md                       频道记忆，≤ 16 KiB
  files/                          频道文件目录：协调者与线程的 cwd
  threads/<threadId>/working-notes.md   线程工作笔记
  make-runs.jsonl                 Make 的运行记录，只留最近 50 条
```

`<root>/channels/` 不放在 `scratchDir` 下：scratch 目录是可清理的会话草稿，频道的文件要跟着频道活。

### 5.2 ChannelStore

- 条数少（几十个），沿用 `ScheduleStore` 的写法：整文件串行写，写临时文件后原子改名。
- `load()` 时若没有 `kind: 'main'` 的频道不自动建；主频道在用户第一次打开 Bot 页时由 `channels.ensureMain` 建（BOT-CH-01），避免不用 Bot 的用户多出会话（BOT-NF-06）。
- 所有写操作经 `ChannelStore` 的一把异步锁串行执行。`ensureMain` 在锁内先查后建，主频道用固定 id `chan_main`，频道对话的创建用 `commandId: 'channel:main'`（`createConversation` 现有的幂等键），两个窗口同时第一次打开也只建出一个。
- 删除频道：先停所有线程（`stopTask`），删定时任务，删 WorkItem 日志，再删频道对话与线程会话（走 Harness 的内部删除，绕过 §4.2 的拒绝），最后删 `<root>/channels/<id>/`；登记到 Space 的产物与项目里的视频不动。删除过程写一条日志 `bot.channel.deleted`，中途崩溃时启动对账（§8.6）把残留的会话与日志清掉。

### 5.3 WorkItemStore

- 每个频道一份 JSONL，格式照 `ConversationStore`：首行 `{op:'header', formatVersion:1}`，然后
  - `{op:'snapshot', items: WorkItem[], reports: ThreadReport[]}`（压缩后的首行），
  - `{op:'item', item: WorkItem}`（按 id 替换或追加），
  - `{op:'report', report: ThreadReport}`，
  - `{op:'transition', transition: WorkItemTransition}`，
  - `{op:'removed', workItemId}`。
- 写入分两种。`report`、`transition` 与改变 `status` / `active` / `resolution` 的 `item` 行**同步落盘**（追加并 `fsync` 后才返回），调用方在返回之后才能投递报告或发事件；其余字段的普通更新去抖 150 ms 合并写。这样报告一旦被投递，它和对应的状态转换一定已在磁盘上，崩溃后 §8.6 能找到它。
- 压缩阈值同会话日志（行数超过存活数 ×4+64 或体积超过存活体积 ×4+256 KB 时重写快照）。转换记录不压掉：快照里保留每条任务最近 100 条，更早的移到 `<channelId>.transitions.jsonl` 归档。
- 已解决超过 30 天的任务在压缩时只保留摘要字段（标题、结果、解决方式、线程 id），线程会话本身不删。
- 内存里每个频道一个 `WorkItemState`，提供 `get`、`list(filter)`、`upsert`、`appendReport`、`appendTransition`，每次变化在 `work-items:<channelId>` 主题发事件。

### 5.4 频道记忆与工作笔记

- `MEMORY.md` 由 `ChannelFiles` 读写：写入带 `ifVersion`（等于 `Channel.memoryVersion`），不等时返回当前内容让调用方合并重试；超过 16 KiB 拒绝写入并提示先整理（BOT-CH-05）。
- 用户在记忆页的编辑走 `channels.writeMemory`，同一个版本校验。
- 工作笔记由线程自己用文件工具读写（它在线程的 `cwd` 外面，所以单独给线程开一个可写路径，§7.1）。Runtime 不解析内容。
- 两份都是数据：注入上下文时包在标签块里并转义（§13）。

## 6. 协调者

### 6.1 频道对话的创建

`channels.create` / `channels.ensureMain`：

1. 建 `Channel` 记录与 `<root>/channels/<id>/files/`。
2. `harness.createConversation({ title: name, driverId, model, effort, accessMode: defaultAccessMode }, seed)`，`createConversation` 增加内部参数 `role`、`channelId`、`cwd`（只对 Runtime 内部调用开放，RPC 的 `conversations.create` 不接受这三项）。`cwd` 指定为频道文件目录，`projectId` 为 null。
3. 写 `channels.json`，发 `channel.upsert`。

### 6.2 指令

`AgentToolAccess.sessionInstructions(conversationId)`（`harness/src/driver.ts:173`）已经能按会话给开发者指令。`BotService` 实现一个 `RoleInstructions`，按 `role` 返回：

- **协调者**：角色说明（分辨消息、开线程、转述、何时只回表情、写任务的规则、不亲自做长活）、频道名与用途（包在 `<baocut-channel-purpose>` 里，转义）、可用的 Bot 工具清单的一句话用法。频道记忆不放进指令（会变），放进每回合的状态块（§13.2）。
- **线程**：角色说明（只做这一条任务、开场白、进度写清单不发消息、何时写报告、报告三部分、不开新活）、任务标题与描述。
- **chat**：不变。

指令变化（改了频道用途、换了 Driver）调用 `AgentManager.instructionsChanged()`，下一次 `ensure` 时生效。

### 6.3 接力（BOT-CV-07）

协调者的「可见对话」永远是同一条 `Conversation`，接力只换底层的原生会话：

- **触发**（在回合结束、`#finish` 之后检查，不打断回合）：
  - 本代以来出现了 3 次或以上 `notice.compaction`；
  - Driver 报告的上下文用量超过模型窗口的 70%（有用量的 Driver）；
  - 本代以来超过 400 个回合（没有用量信息的 Driver 的兜底）；
  - 用户换了频道的 Driver 或模型。
- **做法**：
  1. `AgentManager.forget(conversationId)` 丢掉原生会话句柄，`ConversationRecord.agent.persistence` 清空，下次 `ensure` 用 `resume: null`。
  2. `handoffGeneration += 1`，在会话里写一条 `notice`（`level: 'info'`，界面显示为分隔线；同 Driver 时文字为空、不显示，换 Driver 时显示「已换用 X 继续」）。
  3. 下一回合的输入前置一段 `<baocut-channel-handoff>`：频道记忆全文、未解决任务的紧凑列表、最近的对话原文（复用 `forkHistory(items, end, …)`，上限 40 000 字，从最旧的回合开始裁）、上一代最后一次 `todo`。只带一次，同 `forkHistoryBlock` 的规则：第一次没跑起来下一条再带。
- 接力对用户不可见：协调者在下一回合不重新打招呼（指令里写明）。

### 6.4 协调者被叫醒的来源

协调者的回合只有三种来源，每种在会话里留下不同的条目：

| 来源 | 写入的条目 | 入口 |
| --- | --- | --- |
| 用户在频道发消息、点提示、点表情 | `user-message`（`via` 区分） | `conversations.send`；表情走 `bot.react`（§12.4） |
| 线程报告 | `relay{direction:'report'}` | `ThreadRouter.deliverReport` → `Harness.deliver` |
| 定时任务、Make 产生的事件 | `relay{direction:'schedule' / 'make'}` | `MakeService` |

后两种都不是用户消息（刷新只投给线程，§9.2）：`relay` 条目不能作为任何审批的依据（§14.1）。

## 7. 线程

### 7.1 线程会话

`ThreadRouter.start(workItemId, brief)` 建线程会话：

- `createConversation({ role:'thread', channelId, workItemId, title: workItem.title, driverId: overrides.driverId ?? channel.driverId, model…, accessMode: min(overrides.accessMode ?? channel.defaultAccessMode, channel.maxAccessMode), cwd: <频道文件目录> })`。
- 同频道的线程共用 `cwd`（BOT-EX-15 的文件归属靠简报约束，不靠目录隔离）。线程的工作笔记路径 `threads/<threadId>/working-notes.md` 写进线程指令；它在 `cwd` 之外，`AgentScope` 的可写路径加上这一个文件。
- 资源里的视频不改变 `cwd`：线程通过现有的视频工具按 `projectId` + `videoId` 打开（BOT-VE-02），视频锁与版本校验照旧（架构设计 D05）。

### 7.2 第一回合

`ThreadRouter` 用 `Harness.deliver(threadId, { kind:'brief', … })` 起第一回合（会话空闲，起新任务）。投递的文字是 `<baocut-thread-brief>` 块（§13.1）：任务标题、描述、协调者写的简报、Runtime 复制的引用消息、资源列表、文件归属说明、频道记忆中与线程相关的「规则」一节。线程会话里同时写一条 `relay{direction:'brief'}` 条目，界面在任务详情里折叠显示「任务简报」。

线程的开场白是它在第一回合里发的第一条 `agent-message`（指令约束），Runtime 不另写。

### 7.3 用户在线程里说话

任务详情的输入框就是线程会话的输入框：

- 线程空闲：`conversations.send`（`via: 'typed'`）。任务若在 `needsReview` / `needsInput` / `blocked`，`ActivityBridge` 在 `task.upsert(running)` 时把它转回 `working`，转换记录的 note 写「你回答了：<前 40 字>」（BOT-EX-02）。
- 线程正忙：先 `conversations.steer`；返回 `unsupported` 时进界面队列（`message-queue-runner.ts`，现有逻辑），界面写明「会在这一步做完后看到」（BOT-EX-03）。
- 任务已解决：发送时**不**先重开，任务保持已解决，消息照常进线程。线程判断这是对结果的修改时，调用 `work_items_update({ event:{type:'reopen'} })` 再动手；状态机只在两种情况下接受线程的 reopen（§9.2）：这一回合由用户在线程里的 typed 消息发起；或者这一回合收到过协调者 `thread_relay` 转来的用户原话，即 Runtime 复制、`author:'user'`、`via:'typed'` 的引用。后一种情况下 `reopen` 要带 `citedMessageId`，必须在 `ActiveRun.userCitations` 里，转换记录存这个 id。转交里协调者自己的话、提示与表情发出的话都不算。只是一句问题时直接回答，任务状态不变（BOT-EX-05、需求 §8.2）。线程没有判断就动手改了东西（写了产物、提交了 Job），`ActivityBridge` 看到产物变化时补一次 reopen，cause 记 `implicit-reopen`。

### 7.4 线程到停点

线程在回合结束前调用 `thread_report`（§10.3）。Runtime 做三件事，在同一个 `WorkItemStore` 事务里：

1. 追加 `ThreadReport`（`delivery:'pending'`），更新 `lastReportId`、`outputs`、`question`；
2. 按 `stop` 走状态机（§9）；
3. 把 `userTodos` 建成 `owner:'user'` 的任务，`followUps` 交给 `MakeService` 做成建议（去重后）。

提交后 `ThreadRouter.deliverReport(reportId)` 把报告交给协调者（§8.3）。线程回合结束时没有调用 `thread_report` 的：

- 任务以 `completed` 结束 → `ActivityBridge` 写一条系统报告 `stop:'needs-review'`，headline 取最后一条 `agent-message` 的第一句；
- 以 `failed` 结束 → `stop:'blocked'`，reason 取错误码的人话；
- 以 `stopped` 结束（用户点了停止）→ 不写报告，状态由停止动作决定（§9.2）。

### 7.5 线程等后台 Job

线程提交长 Job 后结束回合、报告 `stop:'waiting'` 并带上 `waitingFor.jobIds`。任务进 `waitingOnOthers`。Job 结束时现有的完成收件箱把线程叫醒（`woke`），`ActivityBridge` 看到线程的任务回到 `running` 时把 WorkItem 转回 `working`（BOT-S03）。不需要新代码，只要在 `ActivityBridge` 里认这种转换。

### 7.6 停止与改向

- **停止**（BOT-EX-07）：`workItems.stop` → `harness.stopTask(thread.activeTaskId)`；任务转 `blocked`，reason「你停下了这件事」，带「继续」。
- **改向**：`workItems.redirect({ workItemId, text, oldWork: 'stop' | 'keep' })`。`stop` 时先 `stopTask`（会取消未完成的 Job）；`keep` 时不取消已提交的 Job，产物照常完成并挂成候选。随后把用户的新要求作为一条 `user-message` 发进线程（新 Task，沿用旧合同的范围与预算上限，同产品设计 §6.2「改变目标」）。仍是同一条 WorkItem。

## 8. ThreadRouter：简报、转交与回报

### 8.1 通用投递：`Harness.deliver`

把 `#deliverJobs`（`harness.ts:1968`）里「不带用户消息叫醒一条会话」的逻辑抽出来，供 Job、线程报告、转交、刷新共用：

```ts
interface Delivery {
  id: Id;                        // 幂等键：同一 id 只投一次
  conversationId: Id;
  item: RelayItem | NoticeItem;  // 先写进会话的条目（id = delivery id，重复投只有一条）
  agentText: string;             // 交给智能体的文字（已经组装好的标签块）
  wake: 'new-task' | 'reopen-task';   // 空闲时起新任务（报告、转交）还是重开原任务（Job）
  origin: 'relay' | 'refresh' | 'schedule';   // 起新任务时写进 task.origin；只由 Runtime 的调用方给，智能体碰不到
  reopenTaskId?: Id;
  accessMode?: AgentMode;        // 起新任务时的访问模式，默认会话的
  unattended: boolean;           // §14.2；Bot 角色的会话里，经 deliver 起的回合一律为 true
  onDelivered?: () => void;      // 智能体真正收到时调用：steered / woke / started 立即调用，held 等 #finish 带进回合时调用
}

type DeliveryResult = 'steered' | 'held' | 'woke' | 'started' | 'dropped';

Harness.deliver(d: Delivery): Promise<DeliveryResult>;
```

规则与现在的完成收件箱一致，只多一种「起新任务」：

| 会话此刻 | 结果 |
| --- | --- |
| 回合进行中，Driver 支持 `steer`，回合已开始 | `steer(turnId, agentText)` → `steered` |
| 回合进行中，不能插话 | 进 `#held`，回合结束后在 `#finish` 里按空闲处理 → `held` |
| 空闲，`wake: 'reopen-task'` | 现有的 `reopenTask` + 新 `ActiveRun` → `woke` |
| 空闲，`wake: 'new-task'` | 新建 `task` 条目（`goal` 取 `item` 的一行摘要，`origin` 取 `Delivery.origin`），新 `ActiveRun`，`#startRun(state, run, {text: agentText})` → `started`；不写 `user-message` |
| 会话归档、不存在、Driver 不可用、Runtime 正在退出 | `dropped` |

`task` 条目新增可选字段 `origin?: 'user' | 'relay' | 'refresh' | 'schedule'`，界面据此不把它画成「你发的消息」。报告与转交用 `relay`，刷新与巡检用 `refresh`，定时任务起的线程用 `schedule`。完成收件箱重开的任务保留原来的 `origin`，但回合本身按下一段算无人在场。

`ActiveRun` 新增 `attended: boolean`、`tainted: boolean` 与 `userCitations: Id[]`。`userCitations` 记 Runtime 在本回合投进来的 `author:'user'`、`via:'typed'` 的 `CitedMessage` 的 id，包括起回合的转交和回合中途 steer 进来的转交，只由 `deliver` 写入（§9.2 的 reopen 用它）。在 `role` 为 `channel` / `thread` 的会话里，**只有**用户的 typed 消息或用户按钮（提示、表情、通知里的选项）起的回合 `attended = true`；其余一切回合（Job 完成叫醒、报告、转交、刷新、定时）都是 `false`，不看是谁触发了上游。回合中途经 `steer` 插进任何 `relay` 文字时置 `tainted = true`，直到回合结束。`chat` 角色的会话不受这两个字段影响，行为与现在一致（BOT-NF-06）。`#checkCanSend` 的预算与授权检查在 `started` 时照做（与 `send` 一致），不通过时 `dropped` 并由调用方处理。

现有的 `jobFinished` 改为调用 `deliver`（`wake: 'reopen-task'`），行为不变，`job-finished.test.ts` 全部保留作回归。

### 8.2 开线程与转交（协调者 → 线程）

- `thread_start`（§10.3）：校验任务存在、`owner:'agent'`、还没有线程；通过并发闸门（§18.1）则建线程并投递简报，否则任务留在 `upNext`、返回 `{ queued: true, position }`。
- `thread_relay`：协调者把用户在频道里的补充转给线程。参数只有 `workItemId`、`note`（协调者的话）与 `citedMessageIds`（≤ 8，必须是本频道对话里的 `user-message` 或协调者自己的 `agent-message`）。Runtime 从频道对话里**原文复制**这些消息成 `CitedMessage`，并按条目填 `author` 与 `via`：只有 `user-message` 是 `user`，协调者自己的消息是 `coordinator`；用户消息的 `via` 照抄（typed / suggestion / reaction / notification）。渲染成 `<baocut-cited author="…" via="…">`，协调者的话不会冒充用户原话，点提示发出的话也标明是提示（§13.1）；组装 `<baocut-relay>` 块，`Harness.deliver(threadId, { wake:'new-task', … })`。投递 id = `relay_<cmsg>_<workItemId>`，同一条用户消息转给同一个线程只投一次。
- `cited` 里有 `author:'user'` 的消息时，`thread_relay` 在投递成功后对任务发 `user-replied`（任务在 `needsReview` / `needsInput` / `blocked` 时回到 `working`），与用户直接在线程里回答的效果一致（BOT-EX-09）。没有用户引用的转交不改状态。
- 任务已解决时 `thread_relay` 不重开任务，交给线程按 §7.3 的规则判断：转交里有用户 typed 的原话时，线程可以凭它的 `citedMessageId` 重开。

### 8.3 回报（线程 → 协调者）

`deliverReport(reportId)`：

1. 组装 `<baocut-thread-report>` 块：任务 id 与标题、stop、headline、正文、问题与选项、产物列表。正文转义（§13）。
2. `Harness.deliver(channel.conversationId, { id: 'report_' + reportId, item: relay{direction:'report'}, wake: 'new-task', unattended: <报告所在的运行是否无人在场> })`。
3. 结果为 `steered | started` 时把 `ThreadReport.delivery` 改为 `delivered`。结果为 `held` 时仍保持 `pending`：挂起只在内存里，还没进协调者的回合；等 `#finish` 真正把它带进新回合时，由 `Delivery.onDelivered` 回调再改成 `delivered`。这样在挂起期间崩溃，重启对账（§8.6）会把它重投，会话里已经写过的 `relay` 条目按 id 替换，不会重复。`dropped` 时也保持 `pending`，等频道对话可用（恢复归档、Driver 修好）时由 `ActivityBridge` 重投。
4. 同一任务在上一份报告还 `pending` 时又来新报告：旧的标 `superseded`，只投最新一份，转述时协调者能看到被覆盖的那份的 headline（块里列出）。

**合并**：频道对话正忙且不能插话时，`held` 的多份报告在 `#finish` 里合成一次投递（一个回合里多个 `<baocut-thread-report>` 块），满足 BOT-CV-05 的「回合结束后合并成一个回合转述」。

**协调者的转述**是协调者在那个回合里写的 `agent-message`。Runtime 在报告投递起的回合里检查：回合结束时协调者没有写任何 `agent-message` 也没有调用 `suggest_replies`，写一条系统兜底消息「<任务标题>：<headline>」，保证 BOT-CV-05 的「频道里一定出现转述」。

### 8.4 用户在频道里回复线程卡

用户回复一张线程卡（`replyToItemId` 指向 `work-item-ref`）或用 `#` 引用任务：消息照常进协调者的回合；同时 Runtime 在协调者的输入里加一行 `<baocut-reply-target work-item="wi_…"/>`。协调者据此调用 `thread_relay`。不由 Runtime 直接转给线程，因为用户有时是在问协调者「这个怎么样了」。

### 8.5 去重与幂等

| 动作 | 幂等键 |
| --- | --- |
| 投递简报 | `brief_<workItemId>_<threadStartCount>` |
| 转交 | `relay_<cmsgId>_<workItemId>` |
| 报告 | `report_<reportId>` |
| 刷新 | `refresh_<workItemId>_<分钟时间戳>` |
| 定时任务开任务 | `schedule_<runId>`（写进 `WorkItem.source.runId`，同一个 run 只建一条） |

会话条目的 id 就是幂等键，`ConversationState.upsert` 天然按 id 替换。

### 8.6 重启对账

完成收件箱只在内存里，重启前没交的不补交；报告不行，必须补。`BotService.start()` 做：

1. 所有 `role:'thread'` 的会话：原生回合在重启时已按架构设计 §2.5 标为失败。对应的 WorkItem 若是 `working`，转 `blocked`，reason「上次退出时中断」，带「继续」（BOT-NF-02）。
2. `delivery:'pending'` 的报告按时间顺序重投（§8.3）。
3. 有线程但线程会话不存在、或有线程会话但没有任务的，写诊断日志并修复：前者把任务转 `blocked`（「线程丢失」），后者把会话标记为孤儿并归档。
4. 并发闸门按当前 `working` 数重算，`upNext` 里可以开始的智能体任务按顺序开始。

## 9. 任务状态机

### 9.1 唯一的写入口

`WorkItemMachine.apply(workItemId, event, actor, ctx)` 是唯一能改 `status`、`active`、`resolution`、`question` 的地方。RPC、工具、`ActivityBridge`、定时器都只发事件；表外的事件被拒（`ToolError('transition-denied')`，带原因）。

```ts
type WorkItemEvent =
  | { type: 'accept'; start: boolean }                      // 采纳建议
  | { type: 'dismiss' }
  | { type: 'expire' }
  | { type: 'schedule'; startAt: string }
  | { type: 'unschedule' }
  | { type: 'start' }                                       // 接下来 → 进行中
  | { type: 'due' }                                         // 定时到点
  | { type: 'report'; report: ThreadReport }
  | { type: 'thread-activity'; activity: ConversationActivity; taskStatus: TaskStatus | null }
  | { type: 'approval'; approvalId: Id; pending: boolean }
  | { type: 'user-replied' }
  | { type: 'unblocked'; cause: string }
  | { type: 'resolve'; evidence: Evidence[] | null; confirmedBy?: Id }   // 用户关 evidence 为 null；线程刷新关必填（§9.5）；智能体替用户关带 confirmedBy
  | { type: 'reopen'; citedMessageId?: Id }                  // 线程凭转交来的用户原话重开时必填（§7.3）
  | { type: 'merge'; into: Id }
  | { type: 'set-owner'; owner: 'agent' | 'user' };
```

### 9.2 转换表

| 当前 | 事件 | 允许的 actor | 结果 | 副作用 |
| --- | --- | --- | --- | --- |
| suggested | accept(start=false) | user | upNext | 清 `suggestion` |
| suggested | accept(start=true) | user | active·working | 开线程 |
| suggested | dismiss / expire | user / system | resolved·dismissed | 记 `subjectKey` 进 14 天忽略表 |
| upNext | start | user；system（名额空出，仅 owner=agent） | active·working | 开线程或重开线程 |
| upNext | schedule | user；coordinator（仅当用户消息里说了时间，ctx 带 cited message） | scheduled | 建一次性定时 |
| scheduled（owner=agent） | due | system | active·working | 同 start |
| scheduled（owner=user） | due | system | upNext | 不开线程（BOT-TK-04）：写一条 `relay{direction:'make'}` 的提醒行，发 `bot.notification{reason:'reminder'}` |
| scheduled | unschedule | user | upNext | 删一次性定时 |
| active·working | report(needs-review / needs-input / blocked / waiting) | thread；system（兜底报告） | 对应子状态 | 设 `question`；需要用户时发通知 |
| active·working | report(done) | thread | active·needsReview | 线程不能直接关任务（§5.2 硬约束），`done` 一律落成待审阅 |
| active·working | approval(pending) / thread-activity(awaiting-*) | system | active·needsInput | `question` 从审批推出（`askedBy:'system'`） |
| active·needsInput | approval(settled) | system | 回到审批前的子状态 | — |
| active·needsReview / needsInput / blocked | user-replied | system（由线程收到 `via` 为用户的消息触发） | active·working | 清 `question`；note 写回答摘要 |
| active·blocked / waitingOnOthers | unblocked | system；thread | active·working | — |
| upNext / scheduled / active·*（建议除外） | resolve | user | resolved·done | 有线程时停掉未完成的回合；`owner:'user'` 的任务在 `upNext` 直接勾掉，不开线程（BOT-TK-04） |
| upNext / scheduled / active·* | resolve(confirmedBy) | coordinator 或 thread，且当前回合 `attended`、未 `tainted`，由 `confirmedBy` 那条 `author:'user'`、`via:'typed'` 的消息起（线程须是自己会话里的消息，协调者须是频道里的消息） | resolved·done | 用户在对话里说了「标完成吧」「这个做完了」：`resolution.by='user'`、`confirmedBy` 存那条消息的 id，界面写「你确认完成」；有线程时停掉未完成的回合 |
| active·* | resolve | thread，且当前回合 `task.origin = 'refresh'`，且 `evidence` 通过核验（§9.5） | resolved·done | `resolution.by='agent'`、`resolution.evidence` 存核验过的引用；报告照常交给协调者，频道里一句话告诉用户（D6） |
| 任一未解决 | dismiss | user | resolved·dismissed | 先停线程 |
| 任一未解决 | merge(into) | coordinator（需用户在本回合的消息里同意，ctx 带 cited message） | resolved·merged | 把本任务的线程挂到 `into` 的资源里 |
| resolved | reopen | user；thread（当前回合由用户 typed 消息发起，或本回合收到过 Runtime 复制的 `author:'user'`、`via:'typed'` 引用，§7.3）；system（`implicit-reopen`） | active·working 或 upNext（owner=user） | — |
| active·* | set-owner(user) | user | upNext | 停线程，保留线程与产物 |
| upNext（owner=user） | set-owner(agent) | user | upNext | 名额允许时随后 start |

`ctx.run` 是线程当前回合的 `ActiveRun`（`origin`、`attended`、`tainted`，§8.1）。工具调用里拿到的是 `AgentPrincipal.conversationId`，`BotTools` 再查这条会话正在跑的回合；这些字段都由 Runtime 在起回合时写定，智能体无法自己声称是刷新或有人在场。

**刷新由谁跑**：刷新总是投进**线程**（`Harness.deliver(threadId, {origin:'refresh'})`），由线程看自己的来源（BOT-EX-08）。触发者有两个：用户点任务卡上的「刷新」，或 `BotService` 的巡检定时器（需求里说的「定时巡检」，P1）。巡检不起协调者的回合。线程在刷新回合里能关任务，结果照常作为报告交给协调者，由协调者在频道里告诉用户。除此之外，协调者和线程都只能**替用户**关：要么用户点了「标为完成」提示（Runtime 直接以用户身份关，§12.4），要么用户在本回合亲手打了确认的话（`resolve(confirmedBy)`，上表）。Runtime 核对的是「这一回合由用户的 typed 消息起、没被插过转交」，核对不了「这句话的意思是完成」，后者靠指令（§14.6）；关错了用户可以重新打开。

### 9.3 子状态的自动推导：ActivityBridge

`ActivityBridge` 订阅 `directory`（`conversation.upsert`）与 `tasks`（`task.upsert`、`approval.upsert`、`approval.removed`）主题，只看 `role:'thread'` 的会话，把变化翻译成状态机事件：

| 观察到 | 事件 |
| --- | --- |
| 线程 `activity` 变为 `awaiting-approval` / `awaiting-answer` | `approval(pending)` |
| 对应审批 `approval.removed` | `approval(settled)` |
| 线程的 `task.upsert(running)` 且上一条是用户消息 | `user-replied` |
| `thread_relay` 投递了带用户引用的转交（§8.2） | `user-replied` |
| 线程的 `task.upsert(running)` 且由完成收件箱 `woke` | `unblocked('job-finished')` |
| 线程的任务 `completed` / `failed` 且本回合没有报告 | 兜底 `report`（§7.4） |
| `dependsOn` 里的任务全部解决 | 依赖它的任务 `unblocked('dependency')` 或 `start` |

审批与报告同时到时，`needsInput` 优先（需求 §5.3）：状态机在 `approval(pending)` 期间收到的 `report(needs-review)` 只记下报告、不改子状态，审批结束时再落到 `needsReview`。

### 9.4 「两个问题同时在等」

`WorkItem.question` 只有一个；线程在已有 `question` 时又提问，新问题覆盖旧问题，旧的写进 `updates`。频道层面：协调者收到用户一个裸的「好」，而本频道有两条以上任务在 `needsReview` / `needsInput`，`BotTools` 在协调者的输入里加 `<baocut-ambiguous-answer>` 列出候选，指令要求先消歧（BOT-S04）。Runtime 不替协调者猜。

### 9.5 关任务的证据

`resolve` 的 `evidence` 不是自由文字，是结构化引用，Runtime 逐条核验：

```ts
type Evidence =
  | { kind: 'export'; projectId: Id; videoId: Id; exportId: Id }      // 导出记录存在且已完成
  | { kind: 'job'; jobId: Id; attempt: number }                        // Job 以 completed 结束
  | { kind: 'video-version'; projectId: Id; videoId: Id; version: string }  // 视频当前版本等于它
  | { kind: 'past-date'; date: string };                               // 任务的截止日或事件日已过（只对 dueOn 有值的任务）
```

核验规则：引用的对象存在、属于任务的资源或由任务的线程产生（`past-date` 例外）、时间晚于任务最近一次进入 `active` 的时刻。全部通过才转 `resolved`；否则 `ToolError('evidence-rejected', 原因)`，任务不变。转换记录里存的是这些引用，界面渲染成「看到 11 月 3 日已导出成片」这类人话。Runtime 能核对「有这条导出记录」，核对不了「这次导出就是用户要的」，后者靠指令约束（§14.6）。

## 10. 智能体工具

### 10.1 按角色暴露

现在所有会话共享一个工具目录，没有按会话过滤（`AgentScope.authorize` 只看有没有进行中的任务和访问模式）。改动：

1. `ToolInfo` 新增可选 `roles?: ConversationRole[]`，缺省为全部角色。
2. `McpEndpoint` 在 `tools/list` 与 `tools/call` 时从 bearer token 解出 `AgentPrincipal.conversationId`，查会话的 `role`，用 `ToolCatalog.withView({ expose: (name, info) => !info.roles || info.roles.includes(role) })` 过滤；调用未暴露的工具返回 `ToolError('not-found')`。
3. `AgentScope.authorize` 再按 `roles` 校验一次（防止 token 被别的通道复用）。
4. `allToolSets()`（`all-tool-sets.ts`）同步加上 `BotTools`，现有的一致性测试会覆盖。

`BotTools` 的定义都是 `surfaces: ['agent']`，不进 CLI 与对外 MCP（第二期做 CLI 时另开 `bot` 命令组，走 RPC）。

### 10.2 协调者的工具

| 工具 | 参数（摘要） | 说明 |
| --- | --- | --- |
| `channel_read_memory` | — | 返回 `MEMORY.md` 全文与 `version` |
| `channel_write_memory` | `content`、`ifVersion` | 版本冲突返回当前内容；> 16 KiB 拒绝 |
| `channel_list` | — | 本用户全部频道的摘要（只读，BOT-CH-07） |
| `channel_peek` | `channelId` | 另一个频道的未解决任务与记忆的前 2 KiB（只读） |
| `channel_propose` | `name`、`purpose`、`templateId?` | 写一张 `proposal{type:'channel'}` 卡，用户点「建立」才建 |
| `work_items_list` | `channelId?`、`status?`、`query?` | 默认本频道；`query` 在标题、描述、结果里搜 |
| `work_items_create` | `title`、`description`、`owner`、`priority?`、`dueOn?`、`resources?`、`steps?`、`sourceMessageId`、`dependsOn?` | 建任务（`upNext`），返回 `id` 与 `duplicates`（§10.5）；`sourceMessageId` 必须是本频道的用户消息 |
| `work_items_update` | `id`、可改字段、`event?` | 改描述、步骤、资源、优先级、截止日、追加 `updates`；`event` 走状态机 |
| `thread_start` | `workItemId`、`brief`、`citedMessageIds`（≤ 8）、`fileOwnership?` | 开线程（§8.2）；返回 `threadId` 或排队位置 |
| `thread_relay` | `workItemId`、`note`、`citedMessageIds` | 转交（§8.2） |
| `thread_read` | `workItemId`、`tail?` | 读线程最近的条目（只读，用来回答「做到哪了」） |
| `suggest_replies` | `forItemId?`、`chips` | §12 |
| `schedule_propose` | `name`、`cadence`、`template`、`accessMode?` | 写一张 `proposal{type:'schedule'}` 卡 |
| `make_suggest` | `items[]`（标题、理由、依据、kindTag） | 协调者自己提的建议；同样过 §11.3 的去重与限额 |

协调者开线程的标准动作是 `work_items_create` → `thread_start`，两个调用；`thread_start` 允许直接带 `create` 参数一次完成，减少一个往返（BOT-NF-01 的 2 秒要求）。确认行与线程卡：`thread_start` 在频道对话里写 `work-item-ref` 条目（同一回合里的多张卡共用 `ackGroup`），确认行是协调者自己的 `agent-message`。

### 10.3 线程的工具

| 工具 | 参数（摘要） | 说明 |
| --- | --- | --- |
| `work_items_get` | — | 读自己的任务（绑定的 `workItemId`，不收参数） |
| `work_items_update` | 同上，只能改自己的任务 | 步骤、更新、资源、产物；`event` 只接受表里 actor 为 thread 的 |
| `thread_report` | `stop`、`headline`、`text?`、`question?`、`outputs?`、`userTodos?`、`followUps?`、`waitingFor?` | 写报告（§7.4）；`text` 缺省取本回合最后一条 `agent-message` |
| `suggest_replies` | 同上 | 挂在线程会话里 |

线程没有 `thread_start`、`channel_*` 写工具、`schedule_propose`、`make_suggest`：线程想开新活只能在报告的 `followUps` 里写，由 Make 去重后做成建议。

### 10.4 工具层面的校验

- 所有文字字段按 §4 的长度校验，超长报错而不是截断。
- 标题、描述、步骤、更新、问题、提示文字里出现 URL（`https?://`、`www.`）、电子邮件、连续 11 位以上数字（手机号、卡号、证件号的长度；`20261031` 这类日期与文件名里的编号不受影响）时报错 `ToolError('invalid', '不要在任务里写链接或号码，放进 resources')`。资源与产物走结构化的 `ResourceRef`。
- `titleBy:'user'` 的任务，智能体改 `title` 报错。
- `question.risky = true` 时 `pick` 必须为 null，`options` 里任何一项都不能被标推荐。

### 10.5 去重

`work_items_create` 在写入前比对本频道未解决的任务：标题与描述的字符 3-gram Jaccard ≥ 0.6，或资源完全相同且 `kindTag` 相同，就把候选放进返回值的 `duplicates`，**仍然建**——判断留给协调者（指令要求看到 `duplicates` 时改用 `thread_relay` 并把新建的任务 `merge` 掉）。Runtime 不自动合并，因为字面相似的两件事可能真的是两件事。

## 11. 定时任务与 Make

### 11.1 定时任务的新目标

`ScheduleTarget` 现在是 `'conversation' | 'new'` 字符串。为不改动已有数据，加一个取值和一个可选字段：

```ts
type ScheduleTarget = 'conversation' | 'new' | 'work-item';

interface Schedule {
  // 既有字段不变，新增：
  workItem?: { channelId: Id; template: WorkItemTemplate };   // target = 'work-item' 时必填
}
```

`ScheduleService` 的改动：

- `ScheduleHost` 加 `createWorkItem(channelId, template, runId): Promise<{ workItemId: Id }>` 与 `workItem(id): WorkItem | null`。
- `#decide`：
  - 频道归档或删除 → `pause`（`pauseReason: 'channel-archived'`，新增取值）；
  - 上一次 run 建的任务未解决 → `skip`（BOT-MK-05 的边界：不叠任务）；
  - 其他 → `run`。不走 `queue`：并发上限由 `upNext` 排队承担，定时任务这边只负责「到点建任务」。
- `#start`：`host.createWorkItem(...)`，任务 `source:{kind:'schedule', scheduleId, runId}`；owner 为 agent 时由 `ThreadRouter` 开线程（简报正文 = `template.prompt`），线程的第一个回合标 `unattended: true`。
- run 的结算从「会话任务结束」改为「WorkItem 到停点」：新增 `ScheduleService.workItemChanged(workItem)`，WorkItem 到 `needsReview` / `needsInput` / `blocked` / resolved 时把 run 记 `done`，`failed` 只在建任务本身失败时记。
- `conversationChanged` / `conversationRemoved` 对 `work-item` 目标不起作用。
- 迟到、错过、宽限期、`SCHEDULE_MAX_TIMER_MS` 都不变（D5：关窗口时后台服务照跑，只有进程不在时才会错过）。

周期任务卡（`proposal{type:'schedule'}`）被接受时由 `bot.proposals.respond` 调 `schedules.create`；第一期没有对话建周期任务，用户在定时任务页手动建时，「目标」下拉多一项「频道任务」，选频道并填模板。

### 11.2 一次性定时

`WorkItem.startAt` 不复用 `Schedule`：`BotService` 维护一个按 `startAt` 排序的定时器（同 `ScheduleService.#arm` 的写法，最长 1 小时一跳），到点发 `due` 事件。迟到超过 5 分钟宽限的，进程恢复后发一次 `due` 并在转换记录里写「迟了 N 分钟」，不算错过。

### 11.3 MakeService（P1）

```text
trigger ──► collect(channel) ──► generate ──► filter ──► persist ──► present
```

1. **触发**：`manual`（`bot.make.run`）、`channel-created`、`item-resolved`（状态机副作用）、`thread-report`（报告里有 `followUps`）、`new-media`（频道「关注的文件夹」的文件监视，复用现有的 `fs.watch` 封装，合并 5 分钟内的变化）。自动触发每频道每天 ≤ 3 次，计数存在 `make-runs.jsonl`。
2. **收集**：频道记忆、未解决任务与最近 14 天解决的任务（标题、结果）、频道对话最近 30 个回合里的用户消息（只取用户的话）、任务引用的视频的事实摘要（时长、有无转录 / 字幕 / 译文 / 导出、最近一次导出时间）、关注文件夹里的新文件名。素材内容（转录稿正文、网页）**不**进收集——只看事实，不看内容里的话（BOT-VE-06、BOT-SF-03）。
3. **生成**：`TextGenerator.generate({ system, input, schema })`，`source: 'bot-make'`。输出 JSON：`[{ title, reason, kindTag, evidence: [refIndex] }]`，最多 6 条候选。证据只能引用收集阶段给出的编号，生成的自由文字里的链接与号码按 §10.4 的规则过滤。
4. **过滤**：去掉与未解决任务重复的（§10.5 的同一判断）；去掉 `subjectKey` 在 14 天忽略表里的；去掉 `kindTag` 在频道记忆「不想要的建议」里的（BOT-MK-10）；去掉会花钱、外发、发布的（`kindTag` 白名单：只有本地编辑、转录、翻译草稿、整理类）。最多留 3 条，且频道里同时未处理的建议 ≤ 3。
5. **落地**：每条建成 `status:'suggested'` 的 WorkItem（带 `SuggestionMeta`，7 天过期）；在频道对话写一张 `proposal{type:'suggestions'}` 卡。不发系统通知。
6. **记录**：`MakeRun`（触发、候选数、展示数、Provider、用量）写 `make-runs.jsonl`，用量进 `store/usage.jsonl`。

没有可用的文本能力时 `bot.make.run` 返回 `RpcError('unavailable', reason)`，自动触发静默跳过并记一条 `MakeRun{shown:0}`。

### 11.4 提醒（BOT-MK-07）

`BotService` 每小时一次轻量扫描（无模型调用）：owner=user 的任务截止前一天未完成、`needsReview` 超过 3 天未看。命中的在频道对话写一条 `relay{direction:'make'}`（不起协调者回合，直接是界面上的一行系统消息），同一任务同一原因只提一次（记在 WorkItem 的 `updates` 里作为标记）。

## 12. 智能提示

### 12.1 来源

| 来源 | 谁写 | 怎么写 |
| --- | --- | --- |
| `agent` | 协调者或线程 | 在回合里调用 `suggest_replies({ forItemId?, chips })`；`forItemId` 缺省为本回合最后一条 `agent-message`（回合结束时再绑定，所以可以在写消息之前调用） |
| `question` | Runtime | 提问卡（`approval{request.kind:'question'}`）写入时，`SuggestionService` 从选项生成答案提示，`answers` 指向审批与选项下标 |
| `system` | Runtime | 不支持工具的 Driver 的兜底：确认类问句（规则识别「要我…吗」）补「好」「先不用」；起手提示由 `TextGenerator` 按频道用途生成，24 小时缓存 |

### 12.2 校验

`SuggestionService.validate(chips)`：

- 数量 ≤ 4；`label` ≤ 12 字，`text` ≤ 80 字；
- 不含 URL、邮箱、11 位以上数字（同 §10.4）；
- `text` 不以完成式描述外部动作（「已发送」「已发布」「已付款」等词表），不含「以后都」「总是」「永远」这类长期授权词；
- `kind:'confirm'` 只能在 `forItemId` 那条消息只有一个问句时出现（按问号数判断，半角 `?` 与全角 `？` 都算，超过一个拒绝）；
- 调用方标记了 `risky`（工具参数）时，所有提示的 `recommended` 强制为 false；
- `action:{kind:'resolve'}` 只能出现在 `kind:'confirm'` 的提示上，且 `workItemId` 指向的任务处于 `active·needsReview`，属于本频道（协调者）或就是线程自己的任务（线程）。

不合规的整组拒绝（`ToolError('invalid')`），不截断后硬发（需求 §7.5）。

### 12.3 作废

`SuggestionService` 订阅每个 Bot 会话的 `item.upsert`：出现新的 `user-message`，或 `forItemId` 之后有新的 `agent-message`，就把该会话所有 `open` 的 `suggestions` 条目改为 `stale`。会话里同时最多一组 `open`。

### 12.4 点提示与表情

- 点提示：界面调 `conversations.send({ text: chip.text, via:'suggestion', suggestionChipId })`。Runtime 在写 `user-message` 前核验：提示存在、属于这个会话、状态 `open`；否则 `RpcError('stale')`。通过后条目改 `used`。`action` 为 `resolve` 时，在同一个事务里写 `via:'suggestion'` 的用户消息，并以 actor `user` 对任务发 `resolve`（与用户在任务卡上点「标为完成」等价，`resolution.by='user'`、`confirmedBy` 为这条消息的 id）；任务此时已不在 `needsReview` 就拒绝（`RpcError('stale')`）。之后照常起回合，智能体只需确认一句。`answers` 不为空时改走 `agents.answerQuestion(approvalId, optionIndex)`，同时写一条 `via:'suggestion'` 的用户消息，两者在一个事务里。
- 起手提示 `fillOnly`：界面只填输入框，不调 RPC。
- 表情（BOT-EX-10，P1）：`bot.react({ conversationId, itemId, emoji })`。👍 / ✓ 落在「最新一条、只有一个问句、问句是确认类」的 `agent-message` 上时，等同发送 `via:'reaction'` 的「好」；👎 发一条 `via:'reaction'` 的「👎」并让智能体追问；其余表情只存在条目的 `reactions` 上，不起回合。

## 13. 上下文组装与转义

### 13.1 标签块

所有 Runtime 交给智能体的结构化文字都用 `contextBlock(open, bodyLines, close)`（`harness/src/context-tags.ts`），正文逐行 `escapeContextTags`，所以素材里出现的 `<baocut-…>` 一律变成 `&lt;baocut-…`，无法伪造块边界。

| 标签 | 谁收 | 内容 |
| --- | --- | --- |
| `<baocut-thread-brief>` | 线程 | 任务、简报、引用、资源、文件归属、频道规则 |
| `<baocut-relay>` | 线程 | 协调者的备注；`<baocut-cited author="user" via="typed" at="…">` 原文 |
| `<baocut-thread-report>` | 协调者 | 一份报告（可以一回合多个） |
| `<baocut-channel-state>` | 协调者 | 每回合前置：未解决任务的紧凑列表（id、标题、状态、问题）、本频道记忆的版本号与「规则」一节 |
| `<baocut-channel-handoff>` | 协调者 | 接力种子（§6.3） |
| `<baocut-channel-purpose>` | 协调者、线程 | 频道用途（指令里） |
| `<baocut-reply-target>` | 协调者 | 用户这条消息回复的是哪张线程卡 |
| `<baocut-ambiguous-answer>` | 协调者 | 消歧候选 |
| `<baocut-refresh>` | 线程 | 刷新：上次报告以来，任务来源的变化清单（Job 结束、视频版本变化、文件修改时间） |

`<baocut-cited author="user">` 只由 Runtime 在 `relay` 块里生成。引用标签用 `baocut-` 前缀，正是为了落进 `escapeContextTags` 的转义范围：简报、报告、引用正文里出现的 `<baocut-cited …>` 一律变成 `&lt;baocut-cited …`，伪造不出来。智能体指令写明：只有未转义的 `<baocut-cited author="user" via="typed">` 才是用户亲手打的原话；`via="suggestion"` / `"reaction"` 是用户点了智能体写的选项，只算对那一个问题的回答；`author="coordinator"` 是协调者的话；没有前缀的 `<cited>` 一类写法都不算。§20 的注入用例覆盖伪造 `<baocut-cited>` 与 `<cited>` 两种。

### 13.2 每回合的组装顺序（协调者）

```text
[developer instructions：角色 + 频道用途]          ← sessionInstructions，会话级
<baocut-channel-handoff>                           ← 仅接力后的第一回合
<baocut-channel-state>                             ← 每回合，≤ 6 000 字，超出时只列需要你的与工作中的
<baocut-thread-report> × n                         ← 报告投递的回合
<baocut-reply-target> / <baocut-ambiguous-answer>  ← 按需
用户消息（转义后）                                   ← 用户发起的回合
```

`<baocut-channel-state>` 由 `BotService` 通过 `Harness.send` 的 `context` 参数注入（`send` 已经有 `context`、`withEditorContext` 这类前置机制，照同一个口子加）。

### 13.3 记忆写入的约束

`channel_write_memory` 只在当前回合 `attended = true` **且** `tainted = false` 时可用（§8.1）：由用户 typed 消息或按钮发起、且回合中途没有插进过任何报告或转交。其余回合（报告、转交、刷新、定时、Job 叫醒，以及被插过 relay 的用户回合）调用时报错（BOT-SF-09），智能体可以在下一个干净的用户回合里再写。这是 Runtime 能硬性保证的那一半；「只记用户原话」靠指令约束。

## 14. 安全与授权的落点

### 14.1 什么算用户同意

| 来源 | 算不算 | 落点 |
| --- | --- | --- |
| `user-message`，`via` 为 typed / suggestion / reaction / notification | 算，只对它描述的那一步 | 现有审批流程不变：用户在授权卡上点，或在提问卡上选 |
| 授权卡、提问卡上的按钮 | 算 | `approvals.respond`、`agents.answerQuestion`，只接受本地用户主体（RPC principal 不是 agent） |
| `relay` 条目（报告、简报、转交、刷新、定时） | 不算 | 这些回合里的审批照常弹卡，等用户 |
| 频道记忆、工作笔记、用途 | 不算 | 只进标签块，不影响 `decideApproval` |
| `proposal` 卡 | 只有用户点「建立」才执行 | `bot.proposals.respond` 拒绝 agent 主体 |

审批本身不变：Bot 不新增「协调者替用户批」的路径，线程的审批卡出现在线程里，同时被 `ActivityBridge` 映射成任务的 `needsInput`，任务卡上的按钮直接调同一个 `approvals.respond`。

### 14.2 无人在场

「无人在场」就是 §8.1 的 `ActiveRun.attended = false`：Bot 角色的会话里，凡不是用户 typed 消息或用户按钮起的回合都算，默认从严。

- **不改 `decideApproval` 的签名**。它仍是两参 `(mode, risk)`（`protocol/src/access.ts:90`）；`ApprovalBasis` 仍是记在审批上的依据（`{kind:'mode', mode}`），不是判定的输入。改的是 Harness 传进去的 `mode`：无人在场的回合用 `effectiveMode = min(会话模式, 'auto')`，于是 `high` 一律 `ask`，`fullAccess` 在无人时不生效；审批上记的 `basis.mode` 就是这个 `effectiveMode`，审计看得出来是降级后判的。
- **没有逐次审批通道的 Driver 不能无人在场地跑**。这类 Driver 只能跑 `fullAccess`（`#checkAccessMode`，`harness.ts:1802`），它们自己的命令与文件修改不经过 `decideApproval`，降级也管不住。所以 `Harness.deliver` 起回合前检查 `#approvalsSupported(driverId)`：`attended = false` 且结果为 `false` 时不起回合（`dropped`，原因 `unattended-needs-approvals`），任务转 `needsInput`，问题是「这一步要你在场才能跑：X 不支持逐次审批。现在继续？」，用户点了就以有人在场的回合起。频道设置里给这类 Driver 一行提示：选它做周期任务的 Driver 时，每次到点都会停下等你。
- **付费调用无人时一律 `high`**。现在的 `modelCallRisk`（`agent-tools/outbound-grants.ts`）把有授权覆盖的在线调用定为 `command`，`auto` 下会直接放行；长期授权管的是「数据能不能外发」，不是「能不能花钱」。所以 `ToolScope` 加 `unattended`，模型工具的 `#risk`（`agent-tools/model-tools.ts`）在 `unattended` 时对所有在线调用（`grant.kind` 不是 `null`、不是 `local`）返回 `high`，不看有没有授权；本地模型不花钱，照旧 `edit`。以后新增会产生费用的工具，在工具定义上标 `paid: true`，`AgentScope` 在无人时同样升为 `high`，一致性测试检查所有调用在线模型的工具都带了这个标记。
- `GrantService.admit`：`unattended` 时不签发新的出站数据授权，也不使用「本次会话允许」的授权；已有的长期授权照用于判断数据能否外发，但不降低上一条的风险等级。
- 「询问」在无人时的含义：审批照常建出来并保持待处理，线程回合停在 `awaiting-approval`，任务转 `needsInput`，通知用户。**不**超时自动拒绝，也不自动同意。
- 无人在场的回合里 `channel_write_memory`、`channel_propose`、`schedule_propose` 不可用（§13.3）。

### 14.3 永不自动

BOT-SF-08 的清单（发布、上传、付款、删除源素材、覆盖用户手改）在现有的风险分级里都已经是 `high`；Bot 不放宽，只靠 §14.2 保证无人时也要问。付费生成在有长期授权时现有分级是 `command`，无人时由 §14.2 升为 `high`（BOT-SF-02）。覆盖用户手改由现有的视频版本校验与编辑保护（产品设计 §6.4）保证。

### 14.4 权限不传递

- 任务级的 `overrides.accessMode` 不得高于频道的 `maxAccessMode`（`workItems.update` 校验）。
- 「本次会话允许」（`sessionAllowed`）按线程会话隔离，天然不传给别的任务；任务解决时 `BotService` 清掉该线程会话的 `sessionAllowed`（BOT-SF-10）。

### 14.5 预算

频道的日 / 月预算挂在 `GrantService` 的预算上：线程的任务合同 `budget` 取 `min(任务预算, 频道剩余额度)`。超额时现有的预算检查让调用停下问，任务进 `needsInput`。频道的花费按线程会话汇总进 `usage.jsonl` 的维度（新增 `channelId` 字段）。

### 14.6 哪些规则由 Runtime 强制，哪些靠指令

Runtime 能核对的是「来源」：一条消息是谁写的、一个回合是谁起的、一个引用指向什么。它判断不了「内容」：一句话是不是同意、一次导出是不是用户要的。下表给每条规则标明落点，写测试时只对「Runtime 强制」的一栏写硬断言，「指令约束」的一栏用 BOT-S 场景做行为回归。

| 规则 | Runtime 强制的部分 | 靠指令约束的部分 |
| --- | --- | --- |
| 付费、外发、删除、覆盖要用户确认（BOT-SF-02、07、08） | 风险分级、`decideApproval`、无人时降到 `auto`、无人时付费调用升为 `high`、不支持审批的 Driver 不能无人跑（§14.2） | — |
| 用户同意只来自用户（BOT-SF-04） | 审批只接受本地用户主体；`proposal` 只接受用户点；`<baocut-cited>` 带作者与 `via`，伪造会被转义（§13.1） | 智能体不把转述、简报、记忆里的「用户同意了」当真 |
| 记忆只记用户原话（BOT-SF-09） | 只有 `attended` 且未 `tainted` 的回合能写（§13.3）；16 KiB 上限与版本校验 | 写进去的内容是用户的原话而不是转述 |
| 智能体关任务（D6） | 只有线程、只在 `refresh` 回合、证据逐条核验（§9.5） | 证据确实说明目的达成 |
| 智能体替用户关任务 | 「标为完成」提示由 Runtime 以用户身份关；`resolve(confirmedBy)` 要求本回合由那条 typed 用户消息起且未 `tainted`（§9.2、§12.4） | 那句话的意思确实是完成 |
| 线程不能自己关任务 | 状态机把 `report(done)` 落成 `needsReview`（§9.2） | — |
| 已解决任务里问一句不重开 | 线程的 reopen 只在用户 typed 回合，或凭本回合转交来的用户 typed 原话有效（§9.2） | 线程分辨「修改」还是「问题」 |
| 合并任务（`merge`）、协调者设定时 | 引用的消息必须是本频道 `author:'user'`、`via:'typed'` 的用户消息 | 那条消息的意思确实是同意合并或说了时间 |
| 任务文字里不放链接与号码 | URL、邮箱、11 位以上数字的模式校验（§10.4） | 不把素材里的指令改写成任务 |
| 提示不替用户做决定 | 长度、词表、问号数、`risky` 时不推荐、过时提示拒绝（§12.2–§12.4） | 选项本身合理、平列 |
| 素材是数据不是指令（BOT-SF-03） | 标签块转义；Make 不收集素材正文 | 智能体不照素材里的话做事 |
| 频道对话与线程只经 Bot 改 | `role` 拒绝表（§4.2） | — |

## 15. 后台服务

### 15.1 现状

- Runtime 已是独立进程（`RuntimeSupervisor.#spawn`，`ELECTRON_RUN_AS_NODE`），父进程崩溃不影响它，渲染端靠 `runtime.json` 重新找到它。
- 退出时的「后台继续」：`before-quit` 弹框，选 background 时 `supervisor.detach()`，Runtime 进入空闲退出（`runtime.idleExitMinutes`），手头的活做完后退出。
- 没有托盘、没有开机自启；非 macOS 上窗口全关即退出。

D5 要的「常驻」比现在多两点：没有活时也不退（定时任务要等到点），以及有一个常驻的入口显示状态。

### 15.2 方案：Electron 主进程常驻（推荐）

- **常驻条件**：设置 `bot.background`（新，默认开）为真，**且**有活要等：存在未暂停的 `work-item` 定时任务、`working` / `waitingOnOthers` 的任务、`owner:'agent'` 的 `upNext` 任务，或者设了开始时刻的任务。主频道永远在，所以「有频道」不能当条件。Runtime 在这些条件变化时经 `bot.status` 事件告诉主进程，条件不再成立时回到现在的空闲退出。满足时：
  - `window-all-closed` 不退出（所有平台）；
  - `before-quit` 的弹框文字改为「Bot 会在后台继续工作」，选项「保持后台」「彻底退出」「取消」；
  - Runtime 不进入空闲退出：Electron 主进程通过 IPC `{type:'resident', on:true}` 告诉 Runtime（`apps/runtime/src/main.ts` 新增消息），Runtime 在常驻时忽略 `idleExitMinutes`。
- **托盘 / 菜单栏**：`apps/desktop/src/main/tray.ts`（新）。用 Electron `Tray` + `Menu`：「打开 BaoCut」「正在工作的任务（n）」子菜单、「暂停全部自动运行」「退出后台服务」。图标角标（macOS `tray.setTitle`，Windows 叠加图标）是等你的任务数。
- **主进程订阅**：窗口全关时渲染端不在，主进程需要自己连 Runtime。复用 `packages/client` 的 `BaoCutClient`（Node 侧可用），只订阅 `channels` 主题（摘要里有计数），驱动托盘角标与通知。
- **通知**：主进程用 Electron `Notification`。来源是 `channels` 主题里 `needsYou` 计数的增加 + `bot.notification` 事件（§16.3，带任务 id、headline、问题与选项）。点通知：打开窗口并路由到任务详情。合并与免打扰（P1）在主进程里做：5 分钟窗口按频道合并，免打扰时段内攒着。
- **开机自启**：`app.setLoginItemSettings({ openAtLogin, openAsHidden: true })`，设置里的开关（默认关，需求 §11.8）；以隐藏方式启动时只起 Runtime 与托盘，不开窗口。Windows 用同一 API（注册表 Run 键），Linux 第一期不支持（只做 macOS 与 Windows 桌面）。
- **暂停全部自动运行**：Runtime 新方法 `bot.pauseAutomation({ paused })`，暂停时 `ScheduleService` 不 fire（记 `missed`）、Make 自动触发与刷新巡检不跑；进行中的线程不停。
- **退出后台服务**：先调 `bot.status` 拿到进行中的线程与即将到点的周期任务，弹框列出，确认后 `supervisor.stop()` 并 `app.exit()`。

### 15.3 备选：独立的系统服务

用 launchd agent / Windows 计划任务直接拉起 Runtime（无 Electron），另做一个极小的托盘进程。好处是内存更省（不留 Electron 主进程）；坏处是多一个可执行、多一套签名与升级路径，通知与托盘仍需原生代码。第一期不做，记在待评审事项里。

### 15.4 关机、休眠与恢复

- 休眠：Runtime 进程被挂起，定时器在唤醒后按 `#due` 的迟到规则处理（宽限期内补一次，其余记 `missed`）。进行中的线程回合可能因网络中断失败，按普通失败处理（任务转 `blocked`，可继续）。
- 关机或进程被杀：重启后走 §8.6 对账。

## 16. 协议：方法、主题与事件

### 16.1 方法

加进 `RpcMethods`（`protocol/src/methods.ts`）与 `methodParamSchemas`（`schemas.ts`），处理器在 `runtime-core/src/bot/bot-methods.ts`，在 `createHandlers` 里展开。

| 方法 | 参数 | 结果 | 主体 |
| --- | --- | --- | --- |
| `channels.list` | — | `ChannelSummary[]` | 用户 |
| `channels.ensureMain` | — | `Channel` | 用户 |
| `channels.create` | `name, purpose?, templateId?, driverId?, model?, effort?, defaultAccessMode?` | `Channel` | 用户 |
| `channels.update` | `id, patch` | `Channel` | 用户 |
| `channels.archive` / `channels.unarchive` | `id` | `Channel` | 用户 |
| `channels.delete` | `id, confirm: { threads: n, schedules: n }` | `{}` | 用户；`confirm` 与实时计数不符时拒绝 |
| `channels.readMemory` | `id` | `{ content, version }` | 用户 |
| `channels.writeMemory` | `id, content, ifVersion` | `{ version }` | 用户 |
| `workItems.list` | `channelId, status?` | `WorkItem[]` | 用户 |
| `workItems.get` | `id` | `{ item, transitions, reports }` | 用户 |
| `workItems.create` | `channelId, title, owner, …` | `WorkItem` | 用户（手动添加） |
| `workItems.update` | `id, patch` | `WorkItem` | 用户（标题、优先级、截止日、归属、任务设置） |
| `workItems.transition` | `id, event` | `WorkItem` | 用户（采纳、开始、完成、放弃、重新打开、设定时） |
| `workItems.stop` | `id` | `WorkItem` | 用户 |
| `workItems.redirect` | `id, text, oldWork` | `WorkItem` | 用户 |
| `workItems.refresh` | `id` | `{ delivered: DeliveryResult }` | 用户（P1） |
| `workItems.move` | `id, toChannelId` | `WorkItem` | 用户（P2） |
| `bot.proposals.respond` | `conversationId, itemId, accept, edits?` | `{ resultId }` | 用户 |
| `bot.make.run` | `channelId` | `{ runId, shown }` | 用户（P1） |
| `bot.react` | `conversationId, itemId, emoji` | `{}` | 用户（P1） |
| `bot.status` | — | `{ workingThreads, nextSchedules, paused }` | 用户、桌面主进程 |
| `bot.pauseAutomation` | `paused` | `{}` | 用户、桌面主进程 |

`conversations.send` 的参数加 `via?`、`suggestionChipId?`、`replyToItemId?`（`schemas.ts` 同步）。

### 16.2 主题

`Topic` 联合（`protocol/src/events.ts:47`）加两种，`handlers.subscribe` 里路由：

| 主题 | 快照 | 事件 |
| --- | --- | --- |
| `channels` | `{ channels: ChannelSummary[] }` | `channel.upsert{summary}`、`channel.removed{id}`、`bot.notification{…}` |
| `work-items:${channelId}` | `{ items: WorkItem[]; resolvedTail: number }` | `work-item.upsert{item}`、`work-item.removed{id}`、`work-item.transition{transition}`、`work-item.report{report}` |

两个主题都是 `TopicLog`（容量 2000），重连时按 `afterSeq` 补发，补不上时重取快照，与现有主题一致。`work-items` 快照里已解决的只给最近 20 条（`resolvedTail`），更多走 `workItems.list({status:'resolved'})` 分页。

### 16.3 通知事件

```ts
interface BotNotificationEvent {
  type: 'bot.notification';
  channelId: Id;
  workItemId: Id;
  reason: 'needs-review' | 'needs-input' | 'reminder' | 'unattended-approval';
  headline: string;              // 报告的第一句或提醒文字
  question: WorkItemQuestion | null;
  at: string;
}
```

只有这四种原因发（BOT-NF-08）。工作中、建议、转述不发。

### 16.4 客户端

`packages/client`：`subscribeChannels(handlers)`、`subscribeWorkItems(channelId, handlers)`，reducers `applyChannelsEvent`、`applyWorkItemsEvent`（`reducers.ts`）。会话条目新增的四种 kind 在 `applyConversationEvent` 里不需要特殊处理（按 id upsert）。

## 17. 界面实现

### 17.1 路由与入口

- `Tab` 加 `'bot'`，`Route` 加 `{ tab:'bot'; channelId: Id | null; workItemId: Id | null; view: 'channel' | 'task' | 'memory' }`（`state/shell-store.ts:58`）。
- `Rail`（`components/rail.tsx`）的 `PRIMARY` 在 `home` 后插入 `bot`，图标与徽标（`needsYou` 总和）；徽标数据来自 `channels-store`。
- 第一次进入时调 `channels.ensureMain`。

### 17.2 组件

新目录 `packages/ui/src/components/bot/`：

| 组件 | 内容 | 复用 |
| --- | --- | --- |
| `bot-page.tsx` | 三栏布局与窄屏收起逻辑 | `app-shell` 的分栏与拖宽 |
| `channel-sidebar.tsx` | 频道列表、新建、置顶、归档组 | `home-sidebar-rows` 的行样式 |
| `channel-view.tsx` | 频道头 + 消息流 + 提示芯片 + 输入框 | Home 会话的消息流与输入框组件 |
| `timeline/work-item-ref-card.tsx` | 线程卡：从 `work-items-store` 实时读状态 | — |
| `timeline/relay-row.tsx` | 报告、刷新等系统条目（默认折叠） | 现有 `notice` 渲染 |
| `timeline/proposal-card.tsx` | 建立频道、周期任务、建议卡 | 现有授权卡的按钮布局 |
| `timeline/suggestion-chips.tsx` | 提示芯片 | — |
| `task-panel.tsx` | 筛选、建议区、四段列表、行快捷动作 | — |
| `task-detail.tsx` | 头部、等你的问题、步骤、产物与资源、更新记录、线程消息 | 线程消息部分直接用会话视图组件，传入线程会话 id |
| `channel-memory-page.tsx` | 记忆编辑（P1） | 现有 Markdown 编辑组件 |
| `channel-dialog.tsx` | 新建与设置 | — |

状态：`state/channels-store.ts`、`state/work-items-store.ts`（Zustand，按频道懒订阅：只订阅当前打开的频道与有 `needsYou` 的频道）。

### 17.3 状态表达

任务状态图标、颜色、文字的对照表照需求 §11.5，集中在 `bot/work-item-status.ts` 一处，列表行、线程卡、任务详情、托盘菜单共用；不只靠颜色（产品设计 §2.6）。

### 17.4 原型先行

按开发流程，用户可见的界面先做原型并经用户确认。原型覆盖：三栏布局与窄屏、线程卡在消息流里的样子、任务面板四段与建议区、任务详情的「等你的问题」区、提示芯片的出现与淡出、托盘菜单。原型确认后再进实施的界面 PR（§21）。

## 18. 并发、限流与成本

### 18.1 并发闸门

`ThreadRouter.gate`：线程「占名额」的定义是线程会话 `activity ∈ {running, stopping}`（等审批、等回答、等 Job 的不占）。频道上限 `channel.limits.concurrentThreads`（默认 3），全局上限设置 `bot.maxConcurrentThreads`（默认 6）。

- 开线程时名额不够：任务留在 `upNext`，`thread_start` 返回排队位置。
- 名额释放（`ActivityBridge` 看到线程离开 running）：从 `upNext` 里按「优先级 → 截止日 → 创建时间」取第一条 `owner:'agent'` 且依赖已满足的任务开始。
- 用户在线程里发消息、回答审批、报告投递起的协调者回合、刷新都不受闸门限制（它们是对已有工作的推进，不是新工作）；只有「开始一条任务」受限。所以用户一口气答完几个审批后，同时运行的线程可以暂时超过上限，这是有意的：卡住用户刚答完的事比多占几分钟名额更糟。超出期间不再开始新任务，直到回落到上限以下。
- 判名额与开始任务在 `ThreadRouter` 的一把异步锁里串行执行（`thread_start`、名额释放后的自动开始、`workItems.transition(start)` 共用），两个并发的 `thread_start` 不会一起通过。

### 18.2 文本能力并发

`AgentTextGenerator` 的并发是 1（`agent:codex`）。Make 与起手提示的生成排在同一个队列里，优先级低于用户触发的生成（如字幕翻译）；Make 的单次超时 60 秒，超时记一条空 `MakeRun`。

### 18.3 成本可见（BOT-NF-04）

- 线程会话的用量（模型调用、付费生成）在 `usage.jsonl` 里带 `channelId`、`workItemId`。
- `ChannelSummary` 加 `spend: { today, month }`；任务详情显示该任务累计。
- 协调者自己的用量单独一行「频道对话」。

## 19. 可观测与诊断

- 结构化日志（现有 `log`）：`bot.channel.*`、`bot.workitem.transition`、`bot.thread.started`、`bot.report.delivered`、`bot.deliver`（带结果）、`bot.handoff`、`bot.make.run`、`bot.suggestions.rejected`（带原因）。
- 诊断页（P1，BOT-NF-09）新增「Bot」分区：按任务查转换记录、报告的投递状态、线程会话 id、最近的投递结果；按频道查 Make 运行与接力记录。
- 计数指标：投递结果分布、报告从写入到转述的延迟、线程卡出现延迟（BOT-NF-01 的 2 秒）、接力次数、每日 Make 展示与采纳率。

## 20. 测试

| 层 | 测什么 | 位置 |
| --- | --- | --- |
| 单元 | `WorkItemMachine` 的转换表：每一行允许与拒绝的 actor、`refresh` + evidence 的关闭规则、`done` 落成待审阅、`needsInput` 优先、用户任务到点回到 `upNext` 不开线程、线程凭转交来的用户原话重开（引用不在 `userCitations` 里时拒绝） | `runtime-core/src/bot/work-item-machine.test.ts` |
| 单元 | `WorkItemStore`：追加、压缩、崩溃后半行的容错、转换记录归档 | `runtime-storage/src/work-item-store.test.ts` |
| 单元 | `Harness.deliver`：五种结果；`jobFinished` 改走 `deliver` 后原有用例全部通过 | `harness/src/deliver.test.ts`、`job-finished.test.ts` |
| 单元 | `ThreadRouter`：幂等键、报告合并、`superseded`、重启对账、并发闸门排队与释放 | `runtime-core/src/bot/thread-router.test.ts` |
| 单元 | `SuggestionService`：校验规则逐条、作废、`stale` 拒绝、表情的认定 | `runtime-core/src/bot/suggestion-service.test.ts` |
| 单元 | 工具按角色暴露：chat 会话看不到 Bot 工具，线程看不到协调者工具；`allToolSets` 一致性 | `agent-tools/*.test.ts` |
| 单元 | `ScheduleService` 的 `work-item` 目标：建任务、上次未解决时 skip、频道归档时 pause、run 按 WorkItem 结算 | `schedules/schedule-service.test.ts` |
| 单元 | 无人在场：`effectiveMode` 在 `fullAccess` 时降为 `auto`，`high` 判为 `ask`；有长期授权的在线模型调用在 `unattended` 时为 `high`、在有人时仍为 `command`；`channel_write_memory` 在 relay 回合被拒；`resolve(confirmedBy)` 在 relay 回合或引用非本回合消息时被拒 | `protocol/src/access.test.ts`、`bot-tools.test.ts` |
| 集成 | 用假 Driver（现有测试 Driver）跑：频道发三件活 → 三张卡、三个线程；线程报告 → 协调者转述；线程提问 → 任务 `needsInput` → 用户在任务卡上答 → 继续 | `runtime-core/src/bot/bot.integration.test.ts` |
| 集成 | 注入：转录稿里含 `</baocut-thread-report>`、`<baocut-cited author="user">`、`<cited author="user">` 与「忽略之前的指令」→ 块边界不被打破、伪造的引用被转义或不被认、不产生任务与提示 | 同上 |
| 集成 | 无人在场：Job 叫醒、报告投递的回合 `attended = false`；`fullAccess` 降到 `auto`；不支持审批的 Driver 在定时任务里停在 `needsInput` | 同上 |
| 端到端 | 需求 §12 的 BOT-S01–S18 各写一条验收用例，与产品设计 §9 的 S01–S12 并列 | `docs/acceptance/` 与 e2e 套件 |
| 桌面 | 窗口全关不退出、托盘菜单、通知点击路由、退出确认列出的数目 | 手动验收清单（Electron 主进程难以自动化的部分） |

## 21. 实施顺序与 PR 拆分

每个 PR 可以单独合并，前一个不依赖后一个；界面 PR 在原型确认之后。

**第一期（P0）**

1. **协议与存储**：`protocol/src/bot.ts` 类型与模式、`Conversation` 新字段、四种新条目、`RuntimeHome` 新路径、`ChannelStore`、`WorkItemStore`。无行为变化。
2. **Harness.deliver**：抽出通用投递，`jobFinished` 改走它；`task.origin`。回归测试全绿。
3. **工具按角色暴露**：`ToolInfo.roles`、`McpEndpoint` 过滤、`AgentScope` 校验。
4. **BotService 骨架**：频道 CRUD、`channels.ensureMain`、频道对话的创建与指令、`channels` 主题。
5. **WorkItemMachine + ActivityBridge + work-items 主题**：状态机、自动推导、`workItems.*` 用户方法。
6. **ThreadRouter + 协调者 / 线程工具**：`work_items_*`、`thread_start`、`thread_relay`、`thread_report`、`thread_read`；投递、合并、兜底转述、重启对账、并发闸门。
7. **接力**：`CoordinatorKeeper`、`<baocut-channel-handoff>`、`<baocut-channel-state>`。
8. **智能提示基础**：`suggest_replies`、提问卡的答案提示、确认提示、作废与核验。
9. **定时任务目标 `work-item`**：`ScheduleService` 扩展、定时任务页的「频道任务」目标。
10. **无人在场与预算**：`effectiveMode` 降级、`ToolScope.unattended` 与付费调用升级、`GrantService`、频道预算。
11. **界面**（原型确认后）：Rail 入口、`bot-page`、频道侧栏与频道视图、线程卡、任务面板、任务详情。
12. **后台服务**：常驻 IPC、托盘、通知、退出确认、开机自启设置、暂停自动运行。

**第二期（P1）**：频道记忆工具与记忆页、工作笔记路径、刷新与巡检、Make 与建议卡、周期任务提议卡、一次性定时、提醒、表情、消歧与下一步与起手提示、任务依赖与文件归属、任务级设置、模板与品牌规范、诊断页、通知合并与免打扰；Web 端与 CLI `bot` 命令组。

**第三期（P2）**：跨频道移动任务、从普通会话导入、日报、外部来源、偏好学习、引用补全、通知里直接答、Space 分享、多语言批量任务。

## 22. 风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 协调者分辨不准：把问题当任务、把补充当新任务 | 任务列表冗余，线程白跑 | 去重候选返回给协调者（§10.5）；线程卡上「停止」成本低；转换记录可追溯；用 BOT-S 用例做提示词回归 |
| 不支持插话的 Driver 下报告转述延迟 | 用户在频道里等不到结果 | `held` 合并投递；转述兜底消息（§8.3）；线程卡本身实时显示状态，不依赖转述 |
| 接力丢信息 | 协调者忘掉早期的规矩 | 规则只存在记忆里而不是对话里（BOT-EX-11）；接力种子必带记忆全文；BOT-S13 验收 |
| 后台常驻的耗电与内存 | 用户反感 | 没有定时任务和进行中的活时不常驻（§15.2）；托盘可一键退出；Runtime 在没有进行中工作时释放原生会话（现有 10 分钟 `#scheduleIdle`） |
| 无人在场时停在审批，用户长期不看 | 周期任务堆积 | 上次未解决则 skip（§11.1）；`needsReview` 3 天提醒 |
| 素材注入 | 智能体被带偏 | 标签块转义；Make 不收集素材正文；记忆写入只在用户回合；所有外部动作仍过审批 |
| 文本能力并发为 1 | Make 拖慢用户的翻译 | Make 优先级最低、单次超时、每日限额 |

## 23. 待评审事项

- 后台服务用 Electron 主进程常驻（§15.2）还是独立系统服务（§15.3）；第一期按前者实现。
- `role:'channel' | 'thread'` 的会话是否也该出现在全局搜索与 Space 的来源筛选里；本文默认搜索里出现、标出所属频道。
- `<baocut-channel-state>` 每回合注入的长度上限（6 000 字）与裁剪顺序需要用真实频道调。
- 接力阈值（3 次压缩、70% 上下文、400 回合）需要按各 Driver 实测调整。
- 去重的相似度阈值（0.6）与「仍然建、交给协调者判断」的做法，是否改成 Runtime 直接拒绝明显重复。
- 线程能否用 `folderOf` 让同频道线程共享会话级的 scratch，还是保持只共享频道文件目录。
