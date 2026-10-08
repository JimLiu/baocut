# BaoCut 系统架构设计

> 一个对外业务入口，一个视频写入方。Node Runtime 承接所有客户端；Rust 视频引擎独占视频的事务与持久化。

本文定义 BaoCut 的模块、进程、状态所有权与运行机制。用户可见的行为见[产品设计](../product/product-design.md)；持久格式、DTO 与数值规则见 [`spec/`](../spec/video-format-spec.md)；通过标准见[验收与测试](../acceptance/acceptance-spec.md)。用语与范围标记见[文档约定](../README.md#文档约定)，术语见[术语表](../glossary.md)。

文中的类型与接口是目标合同，用 TypeScript 写法表达概要。

## 目录

- [1. 总体架构](#1-总体架构)
- [2. 进程与生命周期](#2-进程与生命周期)
- [3. Agent Harness](#3-agent-harness)
- [4. 业务协议](#4-业务协议)
- [5. 存储与素材](#5-存储与素材)
- [6. Models](#6-models)
- [7. Jobs 与调度](#7-jobs-与调度)
- [8. 代码运行时](#8-代码运行时)
- [9. 渲染、预览与导出](#9-渲染预览与导出)
- [10. 依赖更新与最小改动](#10-依赖更新与最小改动)
- [11. 客户端架构](#11-客户端架构)
- [12. 安全与隔离](#12-安全与隔离)
- [13. 代码组织与版本合同](#13-代码组织与版本合同)
- [14. 待评审事项](#14-待评审事项)

---

## 1. 总体架构

技术栈：Electron、React、TypeScript、Node.js、Rust、WebAssembly。界面组件用 React Spectrum 2（`@react-spectrum/s2`），Renderer 的客户端状态用 Zustand（§11.1）。

### 1.1 三个业务模块，一个对外 Runtime

```text
桌面应用（Home / Space） / CLI / 外部智能体
                 |
          @baocut/client / Tools
                 |
      WebSocket：Command / Query / Subscribe
                 |
        Node Runtime Worker
        Auth / Policy / API Gateway
                 |
   +-------------+----------------+
   |             |                |
Agent Harness   Video            Models
AgentManager    VideoService   ModelCatalog / Router
TaskController  Review / Render  Online Providers
Context / Tools Artifact 管理    Local Model 管理
   |             |                |
   +-------------+----------------+
     Jobs / Storage / ProcessHost
     （含 Space 目录）
                 |
     +-----------+----------------------+
     |           |                      |
Rust Engine Host 原生计算 Worker        Code Runtime
VideoEngine    Render / Media / ML    Browser / Remotion
VideoStore
```

Runtime 内的业务模块通过进程内接口直接调用，不为了形式一致而套一层内部 HTTP。Engine Host 是 Video 模块私有的基础设施，不是界面要连接的第二个后端。

### 1.2 模块职责

| 模块 | 唯一职责 | 不承担 |
| --- | --- | --- |
| Agent Harness | 用户任务、会话、上下文、工具、审批协调、交付整理 | 精确切点与取整、视频数据库写入、模型权重执行 |
| Video | 视频命令外观、修改审阅、引擎连接、预览、导出与素材引用 | 智能体原生会话、模型供应商协议 |
| Models | 能力目录、路由、Provider 适配、模型安装与执行计划 | 直接改时间线、宣告视频已交付 |
| VideoEngine / VideoStore | 领域校验、时间与编辑语义、视频锁、事务、回执、视频事件 | 聊天、费用购买、网络模型请求 |
| JobManager | 执行账本、应用账本、输入冻结、重试与对账、资源准入 | 把模型文本当任务真相、长期锁住视频 |
| Storage | Runtime Store、Artifact / Blob Store、Space 目录 | 独立改变视频版本 |

### 1.3 每份状态只有一个权威

| 状态 | 权威拥有方 | 其他组件可以持有 |
| --- | --- | --- |
| 视频实体、版本、事务与撤销记录 | VideoEngine / VideoStore | 界面的只读投影、智能体的冻结上下文 |
| 视频事件 `eventSeq` 与变更 outbox | VideoStore，与事务同时落盘 | Runtime 的投递游标、界面的去重游标 |
| 会话、Task、Run、审批、授权、视频记忆 | Runtime Store | 对话卡片的投影 |
| Job、外部任务 ID、预算预留、Application 状态 | Job Ledger | 进度卡、审阅页 |
| 源媒体、文档与代码包的 bytes | 不可变的 Artifact / Blob Store | 内容摘要与受限的资源句柄 |
| 素材与代码包的视频引用 | VideoStore | 资源清单与缓存索引 |
| Space 条目 | 无独立权威：由以上各项派生（§5.7） | 可重建的索引 |
| Space 的用户标记（收藏、回收、显示名） | Runtime Store | — |
| 拖拽、选区、播放头、草稿、面板布局 | Renderer | 提交时冻结的 `ContextSelection` |
| GPU 纹理、解码器、已加载的模型与浏览器会话 | 对应的执行器 | 受生命周期管理的句柄 |
| 窗口、菜单、系统权限与服务所有权 | Electron Main 与 Supervisor 各自 | 宿主状态摘要 |

Node 不凭缓存副本独立增加视频版本；Rust 不把模型任务状态复制成第二份账本。任务产物入库与视频应用之间用幂等回执对账，不要求跨数据库的分布式事务。

### 1.4 TypeScript 与 Rust 的边界

**TypeScript** 实现界面、Runtime、智能体 Driver、在线 Model Provider、任务与预算、协议网关和视频服务外观。

**Rust** 实现 VideoEngine / VideoStore、媒体时间、剪辑、字幕与锚点语义、RenderGraph、合成、编解码和本地推理。

纯语义模块可以编译为 WASM，供界面做交互预测；预测不取得写入权。纯语义的 WASM 与有状态的原生 Engine Host 是两回事。耗时的编辑预检、解码、推理和渲染不得阻塞 Node 的控制线程。

是否把小型原生能力以内嵌绑定的方式优化，需要单独测量与验证；不得因此恢复 Node 与 Rust 双写。

### 1.5 领域对象

| 对象 | 定义 | 权威 |
| --- | --- | --- |
| Project | 项目：一个目录，也是智能体的工作目录；包含一个或多个视频 | 目录本身，标识在目录里的 `.bcut/project.json`（§5.1）；Runtime Store 保存登记（标识到路径的索引）与会话绑定 |
| Video / Revision | 视频：项目下的一个子目录，可编辑的时间线及其已提交版本 | VideoStore |
| Conversation | 用户与智能体的协作记录；可以属于一个项目，也可以不属于任何项目 | Runtime Store |
| AgentSession | 某个 Driver 的原生会话 | Driver；Runtime Store 保存恢复句柄 |
| Turn | 一次模型回合 | Driver |
| Task / TaskContract | 一次结果委托及其约定 | Runtime Store |
| Run | 任务的一次执行尝试，带执行代 `runGeneration` 与预算状态 | Runtime Store |
| Job | 一次计算：识别、生成、构建、渲染等 | Job Ledger |
| Artifact | Job 发布的不可变结果 | Artifact Store |
| Application | 把某个结果应用到视频的动作，有独立的幂等键与回执 | Job Ledger |
| ChangeSet / Transaction | 待提交的修改 / 经校验后原子执行的合同 | VideoEngine |
| Candidate | 待选方案。未应用不能冒充工作稿 | Artifact Store + Runtime Store |
| Checkpoint / Variant | 命名的历史状态 / 明确的衍生输出配置 | VideoStore |

Task 是界面上的「任务」；Job 面向用户时称为具体的步骤。一个生成 Job 结束不能把整个委托标为完成。

### 1.6 关键设计决定

| ID | 决定 | 理由与约束 | 展开 |
| --- | --- | --- | --- |
| D01 | Node 的 VideoService 是唯一对外业务入口；Rust 的 VideoEngine / VideoStore 是唯一的视频事务与持久化权威 | Node 不直接写视频实体，也不自行增加版本 | §4.3、§5 |
| D02 | Engine Host 是 Runtime 私有管理的有状态宿主 | 它不向界面或 CLI 暴露平级的产品 API；每个视频独立加锁，按需驻留 | §2.3 |
| D03 | Task、Run、Turn、Job、Application 分别建模 | 结果委托、执行尝试、模型回合、计算、结果应用各有自己的 ID 与状态 | §1.5、§7.1 |
| D04 | 主停止按钮执行 `tasks.stop` | 先禁止新的调用与自动提交，再请求取消子 Job；`agents.interrupt` 与 `jobs.cancel` 是明确的次级操作 | §7.4 |
| D05 | P0 严格校验视频版本，冲突不自动重基 | 保留 readSet；P1 只对已验证相互独立的修改开放重基 | 命令与协议规范 §3 |
| D06 | 版本号与 `eventSeq` 是十进制字符串；`commandId` 是公共幂等键；`actor` 只由可信的 Runtime 注入 | 避免 64 位整数在 JSON 中丢精度；避免客户端伪造身份 | §4.2 |
| D07 | Job 执行、Artifact 就绪、Application 应用各自独立记录 | 渲染与纯分析可以没有视频应用；一个产物可以应用到多个视频 | §7.1 |
| D08 | P0 至少有一个完成双闭环的 Driver | 多 Driver 的能力边界保留；其余按验证程度开放，不伪称功能等价 | §3.3 |
| D09 | 由代码画出来的画面，持久的实例类型统一为 `composition` | 浏览器合同与 Remotion 引擎分别适配；框架名称只是提示，不扩张实例类型 | §8.1 |
| D10 | 新视频格式不依赖任何旧格式 | 旧版项目导入是独立的单向转换；不存在长期的双写或兼容层 | §13.4 |
| D11 | 关闭视图不取消任务 | 退出桌面应用时明确选择继续后台或停止服务；服务停止、休眠与远端计费分别说明 | §2.2 |
| D12 | 「完成」由 TaskContract 指定的交付阶段判定 | 预览任务交候选，应用任务必须有回执，成片任务必须有校验后发布的文件 | §7.1、§9.11 |
| D13 | Home 与 Space 是同一个 Runtime、同一批对象的两个视图 | 两边的修改走同一个命令入口，遵守同样的版本检查、保护与权限；不存在两套业务逻辑 | §11.2 |
| D14 | Space 目录是派生索引，不是第二份存储 | 条目来自 VideoStore、Artifact Store 与 Job Ledger；索引可重建；删除服从引用图 | §5.7 |
| D15 | BaoCut 向其他程序开放的每一个入口都是 Runtime 里一个受管的「对外服务」 | 各有自己的监听面、认证与访问策略，默认关闭；外部请求以服务主体进入同一个命令入口，不另设业务逻辑 | §4.8、§12.8 |
| D16 | 跨视频复用的用户数据放在 Runtime Home 的用户库，进入视频时拷贝 | 视频不随库里条目之后的变化而变（§5.9）；删改库里的条目不改变任何已有视频 | §5.9 |
| D17 | 不是由 Agent 发起的计算同样是 Job | 工具页、对外服务与固定流程提交的任务走同一个 JobManager，只是没有 Task；冻结、校验、发布与应用的规则不变 | §7.9 |

---

## 2. 进程与生命周期

### 2.1 进程树

```text
Electron Main
  +-- Renderer(s)：React + WASM 预测与预览
  +-- 发现或启动 BaoCut Supervisor（可脱离界面运行）
        +-- Runtime Worker：Node，三个业务模块
              +-- Engine Host：Rust，视频单写
              +-- Agent 进程：按会话
              +-- Render / Media Workers：按任务池
              +-- Model Workers：每个常驻模型包一个进程，按需启动（§6.5）
              +-- Browser / Remotion Workers：按代码包与隔离域复用
```

一个 Runtime Home 对应一个 Supervisor。多个窗口复用同一个 Runtime。不同的 Home 打开同一个视频时，仍然必须竞争视频级的操作系统锁，不能因为 Home 不同而绕过单写。只读打开可以单独协商；含有未知必需能力的视频不得以可写方式打开。

### 2.2 启动、所有权与退出

**发现**。Electron 只管理由它创建且身份仍然匹配的服务。发现信息包含 `instanceId`、`home`、`supervisorPid`、`startedAt`、`endpoint`、`runtimeVersion` 和 `protocolVersion`。启动分为 `acquiring-lock`、`starting`、`ready`、`degraded` / `failed`；进程存在不等于可以接收业务。

**监管**。Supervisor 启动 Worker、发布 ready、处理重启与停止，不依赖视频与模型代码。运行期崩溃可以有界重启并退避；启动失败则报告错误，不无限拉起。只有在旧的 Worker 与 Engine Host 已确认失去写入与执行能力之后，替代者才能取得执行权与写入权。PID、启动身份和代（generation）必须一起验证。

**退出**。关闭视图只解除订阅；关闭会话不归档视频，也不取消任务。退出桌面应用时如果有活动任务，由用户选择「继续在后台运行」或「停止服务及相关的本地执行」，并显示仍可能在远端运行或计费的任务。后台模式依赖服务进程与设备存活，不承诺关机、休眠或服务停止之后本地渲染仍然继续。桌面端经它起 Runtime 时带的 IPC 通道发 `{ type: 'stop' }` 请 Runtime 按 §2.4 停下（各平台一样；Windows 上 `SIGTERM` 等于直接结束进程，处理不到），等 8 秒，超时强杀；Runtime 自己另有 15 秒的兜底退出。开始退出之后桌面端不再拉起 Runtime：自己的 Runtime 停下后窗口可能还开着，界面重连时得到「应用正在退出」的错误，不会起一个没人再停、主进程退出后成为孤儿的 Runtime。开发时 Runtime 把日志同时回显到终端；终端关了或管道断了、写不出去时只停止回显，日志照常写进文件。通道断开（桌面端崩溃、开发时主进程重启）不算停止请求，Runtime 留着，下一次启动经发现文件找回它。

**CLI 拉起的 Runtime**。CLI 要连 Runtime 而 `BAOCUT_HOME` 里没有在跑的时，默认在后台拉起一个（脱离终端，输出写到 `<BAOCUT_HOME>/logs/cli-runtime.log`），等它写出发现文件再连；`--no-start` 不拉起，以退出码 3 报 `RUNTIME_UNAVAILABLE`。入口依次是环境变量 `BAOCUT_RUNTIME_ENTRY`、装好的 BaoCut 应用（以 `ELECTRON_RUN_AS_NODE` 跑包里的 Runtime）、仓库里的 `apps/runtime`。拉起时带 `--launched-by cli --idle-exit`：发现信息与 `runtime.info` 的 `launchedBy` 记为 `cli`（桌面端与 `npm run runtime` 起的为 `null`），并且空闲满设置 `runtime.idleExitMinutes`（默认 10 分钟，§5.10）时按 §2.4 的顺序自己停下。空闲是：本机网关上没有在用的桌面端、CLI 或智能体连接，没有排队或运行中的任务，没有开着的对外服务；网关端口上的 HTTP 请求（会话里的智能体经工具桥调用工具、媒体与附件）也把空闲计时清零。已认证的桌面端与智能体连接一连上就算在用；CLI 连接从它发出第一个 `runtime.status`、`runtime.info` 以外的请求起才算，所以只查状态的连接（`baocut runtime status`）来去都不改空闲计时，`runtime.status` 报出的 `idleSince` 是查询之前的值；在用的连接断开后不再有人在用时，空闲从断开时算起。`runtime.status` 报告连接数、任务数、开着的服务与空闲退出的状态（只给 `cli` 与 `desktop` 连接）。`runtime.stop` 只停 CLI 拉起的那一个：不是 CLI 拉起的 `forbidden`（`RUNTIME_NOT_OWNED`）；还有人在用时 `conflict`（`RUNTIME_IN_USE`）：有桌面端连着、调用者之外还有 CLI 连着，或有排队与运行中的任务。空闲退出时先撤掉自己的发现文件再按 §2.4 停下，此后新来的 CLI 不再找到它；已经读到发现文件、却在它退出途中连接失败的 CLI 看到那个进程不在了（或发现文件不再指向它）时重新找或拉起一次，拉起的新实例因实例锁还没放开而退出时，等锁放开后再拉起一次。桌面端启动时找到的若是 CLI 拉起的 Runtime，照常经发现文件连上并复用它，连着期间它不会空闲退出。CLI 的命令见 `baocut runtime ensure|status|stop`（Agent 能力面设计 §5.6）。

### 2.3 Engine Host 的所有权屏障

VideoEngine 是有状态的、按需打开视频的宿主，不是每次工具调用启动一次的命令。每个视频持有一把操作系统文件锁；每次打开获得一个 `ownerGeneration`。Runtime 与 Engine Host 之间使用私有 IPC 或受限套接字，不开放公共的产品端口。

Runtime 失联时，Engine Host 停止接受新的修改并进入受限关闭。替代的宿主不得只因为租约超时就去抢写同一个文件：必须先证明旧进程已经退出，或通过实际可执行的隔离手段撤销它的写能力，然后才取得视频锁。无法证明时阻断写入并报告，不以「两边都认为自己已过期」来冒险。

### 2.4 正常停止的顺序

```text
停止接纳新业务
  → 把 Task / Run 标记为 stopping，建立调用与应用的屏障
  → 结算仍在提交边界内的视频事务
  → 请求取消或中断本地 Job 与 Agent Turn
  → 持久化任务、候选、审批与外部任务 ID
  → 关闭执行器与 Engine Host
  → Worker 退出，Supervisor 释放实例锁
```

超过优雅退出的期限可以升级为终止进程树，但必须保留「未确认取消」和「待对账」的记录。服务崩溃恢复不是通用的任务断点续跑；恢复矩阵见 §7.5。进程隔离是稳定性边界，不自动构成安全沙箱（§12）。

### 2.5 各生命周期结束的含义

| 对象 | 结束的结果 | 不等于 |
| --- | --- | --- |
| 界面连接 | 解除观察，服务状态保留 | 取消所有任务 |
| Agent Turn | 本轮模型输出终止 | 撤销已应用的修改 |
| AgentSession | 释放智能体进程，可以保留原生恢复句柄 | 删除视频与产物 |
| Run / Task | 停止后续步骤与自动应用 | 云端已经停止计费 |
| Job | 计算结算或待对账 | 产物已经应用 |
| Engine Host | 释放视频的写入权与锁 | 视频被删除 |
| Runtime 服务 | 本地业务与执行器关闭 | 远端任务必然取消 |

空闲的智能体会话可以在安全时释放，以控制资源占用。能否释放取决于 Driver 是否存在待批请求、后台工具或不能恢复的原生工作。恢复只承诺已持久化的上下文，不承诺原执行栈续跑。这一策略须明确到每个 Driver 的能力。

### 2.6 应用更新

桌面应用的更新由 Electron Main 负责：检查更新源、后台下载、校验签名与摘要。Runtime 不参与下载，也不自己替换二进制。v3 的应用身份为 `com.baocut.app`；更新清单为仓库 `apps/desktop/releases/appcast-<target>[-<variant>].json` 的已发布版本钉，经 `raw.githubusercontent.com/jimliu/baocut/main/` 读取，归档地址指向 GitHub Releases 的不可变版本/build 文件。发布时先验证公开归档，再提交与推送清单。历史 skill 的 GitHub Latest 保持原状，新 App release 使用 `--latest=false`；不把旧 `com.jimliu.baocut` 的官网更新源指向新身份。

- **只有一个分发渠道**。桌面应用通过 GitHub Releases 直接分发，macOS 签名并公证，自带更新；不提供应用商店版本。应用商店的沙箱不允许启动用户安装的智能体运行时、向其他智能体的目录安装 Skill、下载并执行受管外部工具（§12.9），设计不为它保留降级路径。
- **一个版本一套二进制**。`engine-host`、`model-worker` 与 Runtime 随桌面应用同版发布，不单独更新。模型权重、受管外部工具（§12.9）与内置 Skill 不属于这一套，各有自己的版本。
- **安装前过停止屏障**。安装需要替换正在运行的 Runtime：先走正常停止（§2.4）。「重启并更新」在有活动任务时由用户选择「等任务结束后安装」或「现在停止并安装」，并显示仍可能在远端运行或计费的任务。
- **退出即安装，从不自动重启**。已下载时正常退出应用，Runtime 与后台任务照常停下之后顺手换上新版本，装完不重新打开，下次启动就是新版本；退出本来就停后台任务，不另加确认。只在能自动换包时做，有 5 秒时限，做不了或出错只记日志、照常退出。静默检查在途时退出照样安装。
- **「已下载」即已校验、已就位**。下载并核对大小与 sha256 之后立即做平台的校验，过了才进已下载；界面上这一段是进度 100% 处的「正在校验」，可以取消，取消即丢掉安装包与解开的目录。启动时缓存里已有同一 build 的完整安装包，也先过这一段再进已下载。
- **换包按平台**。macOS 在校验段把新包解开到缓存目录（`unpack-<build>`），校验 bundle 标识、版本、签名与公证；安装时只核对解开的 `.app` 还在、标识未变，由脚本等应用退出后换掉 `.app`，「重启并更新」换完再打开，退出时安装不打开。解开的包不在了：「重启并更新」重做一遍校验段，退出时不装。Windows 只自动更新安装器装的那一份：应用正常退出、Runtime 停下之后才静默起安装器，由它换文件；「重启并更新」装完重新打开应用，退出时安装不打开。换不了的（zip 版、`.app` 所在目录不可写等）显示安装包并打开下载页。打包时没写 build 号的包不检查更新。
- **已下载后照常检查**。自动检查在有新版本与已下载时都静默进行，不显示「正在检查」：更新源仍是同一 build，或有更新的 build 但本机系统不够时，留在已下载；有了另一个 build 时作废旧下载（删安装包与解开的目录），按新版本走；更新源里已没有比当前新的版本时删掉下载，回到已是最新；检查失败保持原样。
- **版本不一致时不混跑**。新版外壳发现的 Runtime 若 `runtimeVersion` 与自己不同，只读取其状态并提示重启服务，不向它发送业务命令；`protocolVersion` 不兼容时连接被拒绝（§13.3）。后台模式下留着的旧 Runtime 不会被新外壳静默接管。
- **分批推送（可选）**。清单可以带 `rolloutHours`（小时，大于 0）与 `releasedAt`（发布时刻，带时区的 ISO 8601），旧版应用当未知键忽略。自动检查时，从 `releasedAt` 起按经过的时间线性放开（之前为 0，满 `rolloutHours` 为 1），本机的位置小于已放开的比例才推，否则这次检查不推它并记日志：静默检查（有新版本、已下载）保持原样，其余（含带着版本的出错）当作已是最新；位置由第一次用到时随机生成、存在用户数据目录里的安装标识得出，每台安装固定。手动检查不受限。检查前的状态已带着同一 build（手动检查找到过、下载过或下载失败）时照推，不收回用户已经拿到的更新。两个字段缺一或不成形时按不分批处理，清单照读：写错了宁可全量推，也不让所有人收不到更新。
- **更新偏好**（自动检查、自动下载）属于偏好设置（§5.10）。校验失败的下载被丢弃并报告，不安装。

---

### 2.7 历史版本的启动迁移

Runtime 取得 Home 实例锁后检测 v1 / v2 数据：macOS 的 `~/Library/Application Support/BaoCut`、其中历史 `cli` 子目录及同级 `bcut`；Windows 仅有 v2，检测 `%APPDATA%/bcut` 与 `%APPDATA%/BaoCut`；Linux 的 `$XDG_CONFIG_HOME/bcut`（未设时 `~/.config/bcut`）。桌面端默认的开发 Home（仓库下 `.dev/baocut-home`）与生产 Home 都自动检测：主进程给 Runtime 带 `BAOCUT_LEGACY_AUTO_DETECT=1`，因此开发 Home 不会被误判为测试沙盒。调用者显式指定其他 `BAOCUT_HOME` 时默认隔离；默认生产 `~/.baocut` 仍自动检测；设 `BAOCUT_LEGACY_ROOT` 时只迁指定目录，不读取真实 UserDefaults / 钥匙串。

设置与服务配置只在尚未迁过时先迁入，再构造模型目录、节点共享与对外服务；启动不读取项目索引、不枚举项目目录。项目发现、云凭据和已配对远端节点的凭据在 Runtime 就绪后执行，发现结果原子写入 `store/legacy-upgrade/<来源摘要>.json`，失败重启复用清单，只处理未完成项。导入器与其引擎以低于正常的优先级串行运行，启动下一项前若有模型或导出等后台任务则等待；仍缺素材的项目仅异步检查上次报告里的缺失路径，不启动引擎。迁移进行时不触发 CLI 空闲退出；等用户回答导入询问时不算在内。退出时先取消迁移、等待导入子进程退出，再释放实例锁。项目转换由随桌面构建分发的 `legacy-import-worker.js` 执行，源码模式从 `packages/legacy-import` 启动；写视频仍只经 `engine-host` 的公开协议。设置、服务配置、云凭据与远端节点照旧自动迁入；项目要等用户在导入询问里确认。所有客户端共享这次 Runtime 迁移。

- **项目发现**：合并旧 `projects.json`、`archive/projects.json`、根下 `projects/` 和配置的 `projects.dir`，索引里的外部项目路径也读取；按真实路径去重。目录有 `project.json` 时走 v2 转换；macOS 的 `doc.json` 走 v1 适配再转换，Windows 不扫描 v1 文档、不读取 UserDefaults，也不运行 v1 转换器。Windows 路径保留盘符、UNC 共享、空格与反斜杠，项目索引仍可指向其他卷。v1 的词时刻还原到源时间，迁入转写、译文、字幕、剪口和可识别的画面元素；源媒体不在而有 `audio16k.pcm` 时，在新视频目录的 `legacy-media/` 生成永久 WAV，旧 PCM 保留。
- **导入询问**：发现还没导入的项目、完成标记里又没有决定时，Runtime 不自己导入，在 `legacy-import` 主题上给出询问：项目清单（旧标题、上次编辑，最近的在前）与默认目录。桌面界面问一次（[命令协议 §4.1](../spec/command-protocol-spec.md#41-方法)）：「导入」带目录，默认是系统文稿 / 文档文件夹下的 `BaoCut`（桌面端经 `BAOCUT_DOCUMENTS_DIR` 传入 `app.getPath('documents')`，认得 Windows 移动过的已知文件夹；没有时用 `~/Documents`）；目录须是绝对路径、能创建并可写，且不在 Runtime Home 与历史根里。「跳过」并勾「不再提醒」回答 `never`：以后不再导入，各来源的项目部分直接记完成、不再发现。只点「跳过」或关掉对话框不发请求：询问留在 Runtime 里，界面这次启动不再弹，下次启动再问；Runtime 不记跳过。没有桌面界面回答（只有 CLI）时项目一直等着，不导入。Web 不问：远端浏览器选不了本机目录，`legacyImport.*` 与该主题不在 Web 服务的白名单里（§4.8）。
- **放置**：新导入归入用户选的导入目录，这个目录本身登记成一个 project（名字取目录名，默认 `BaoCut`）。每个旧项目转换成其中的 `legacy-<来源真实路径摘要>/` 视频目录，视频显示名保留旧标题；跨历史根共享一个 project，相同标题也不会碰撞。首个视频导入成功后才登记该 project。早期版本已经开始导入（标记里有项目记录）而没有决定时不再询问：沿用当前项目默认目录下的 `Imported/` project（生产通常是 `~/BaoCut/Imported`，`BAOCUT_PROJECTS_DIR` 与隔离 Home 沿用默认目录规则，§2.1），并把它记成决定。素材按原路径链接；不移动、不删除、不改写旧项目与旧配置。转换警告、缺失素材和未导入字段写入各视频目录的 `import-report.json`。已有迁移记录仍沿用原目标目录与布局，不移动已导入或已编辑的视频；转换边界沿用[导入器说明](../../scripts/legacy-import/README.md)。
- **设置**：读 `config.json`（优先）与 `config.toml`，v2 应用的偏好 `app-v2-settings.json`；macOS 还读 `VoiceInk.plist`、`com.jimliu.baocut.plist` 中相关 v1 偏好。迁移模型目录、默认保存目录（v2 应用的 `vk-url-savedir` 优先，即「下载视频」的保存位置，迁成 `downloads.directory`）、语言、自动下载更新，以及 Agent 的默认提供方、模型、推理强度和访问模式。路径展开 `~/` 并经新设置 schema 校验，新版本已有的有效用户值优先。保存目录是旧版默认的主目录下 `Downloads`（v2 写的 `~/Downloads`）时不迁：留空，新版本用主机的下载文件夹（认得 Windows 移动过的已知文件夹，§7.9）。模型镜像迁入 HF 或兼容的 HTTP(S) 基址；ModelScope/CDN 的旧协议不能当作新镜像 URL，记为未迁移。主题、窗口尺寸等没有 Runtime 对应项的旧界面偏好只记字段名，不强行写入新界面。
- **云模型**：旧 `secrets.json` / `secrets.debug.json`、macOS v2 `BaoCut/__provider-vault-v1` 及早期独立条目经当前 `CredentialStore` 写入。v1 由凭据助手只枚举 `BaoCut` / `VoiceInk` 两个历史服务的账号属性（`legacy-accounts` 请求，`key` 只能是这两个服务，响应是 `accounts` 字符串数组、不含密钥）；按 `vk-keyinuse-<provider>` 标签、服务优先级与稳定标签顺序选择，再精确读取密码。保留 API 端点、MiniMax 中国接入点、支持的自定义 OpenAI 兼容模型声明和云模型默认值；已有 v3 Provider 优先。密钥不进入迁移报告或日志，不删除旧钥匙串条目，不发模型 API 请求。无法读取或写入的密钥留待重启重试，不回退凭据后端；Windows v2 的密钥按 `key-masks.json` 定位，由助手的只读 `legacy-get` 操作读取 `bcut` 服务（目标名 `<provider>.bcut`，保持 keyring 的 UTF-16 JSON 编码），再写入新版 Windows Credential Manager；不删除旧条目，不回退明文。助手缺失、旧条目不存在或访问失败时不记完成，重启重试。
- **服务与远端算力**：读取 v2 的 `runtime/services.json`、`integrations-policy.json` 与 `worker/` 状态。迁入 MCP / Web 的自动启动和端口；较早的 Web 设置从 `app-v2-settings.json` 的 `serveEnabled` / `servePort` 补入。新版已有对应服务项或共享状态文件时保留新版值。共享算力迁入开关、节点身份、显示名、上次端口和转录能力开关；其他 v2 任务开关、并发限制、开放配对模式与节点选择没有等价 v3 配置时只记录字段名。MCP 保留 `read` / `ask` / `auto` 等级；旧项目范围不能当作视频 ID，存在范围限制或禁用工具时先收紧为空视频名单，禁用工具同时收紧为只读，记录需要重设的权限项。旧 MCP / Web 登录与共享端客户端的令牌格式不兼容，须在新服务重新授权 / 配对，不导入旧运行时管理令牌。`remote.nodes.<alias>.*` 迁入节点标识、别名、名称、HTTP 主机、端口与配对时间；同标识的 v3 节点优先。节点令牌从 `remote-<nodeId>` 的旧凭据经当前安全存储写入，不进节点配置、报告或日志，读取失败重启重试；不对远端发起探测、配对或任务，旧节点是否兼容由正常使用时的协议门判断。旧 `remote.default` 仅指节点、没有 v3 默认模型必需的模型 ID，因此记为未迁移，由用户重新选择。
- **完成标记**：`<runtime-home>/store/legacy-upgrade.json`（0600、原子写）按来源分别记录设置、云配置、服务配置、远端节点和每个项目的完成状态，顶层的 `projectImport` 记项目导入的决定（`import` 带目录，或 `never`）。已完成的早期标记缺少服务 / 节点检查点时只补迁这些配置，不重新发现或导入项目。设置与云配置成功后，项目失败不会导致它们被重复覆盖；项目只有引擎转换无失败、无缺失素材且已登记后才完成。不存在的历史根也记录为已检查；所有来源完整完成后写全局 `complete: true`。此后每次启动只读这一个标记，不再打开设置文件、读取旧索引、枚举目录、查询 UserDefaults 或钥匙串，也不启动迁移子进程。用户之后重置设置、删除密钥或删除新项目不会使旧数据复活。未完成项目重启后沿同一目标目录和事务 ID 续跑，不自动使用 `--replace` 覆盖用户编辑。未知标记版本不覆盖，失败只记录迁移待重试，不阻止正常启动。


## 3. Agent Harness

### 3.1 模块与 Driver ABI

```text
AgentManager / DriverRegistry / SessionStore
ConversationStore / TaskController / ContextBuilder / VideoMemory
ToolCatalog / ApprovalService / ConversationProjector
CapabilityRegistry / GuidanceRegistry
Quality checkpoints / Completion inbox
```

`AgentDriver` 连接一个完整的智能体运行时；`ModelProvider` 执行一次结构化的模型能力。两者分别注册，不混在一张 Provider 表里。

Driver 使用机器协议，不解析终端屏幕。统一的操作是：创建或恢复会话、`startTurn`、`steer`、`interrupt`、`respondToApproval`、`subscribe`、`describePersistence`、`close`。

```ts
interface AgentSession {
  id: Id;
  capabilities: VerifiedAgentCapabilities;
  startTurn(input: AgentInput, context: RunContext): Promise<{ turnId: Id }>;
  steer?(turnId: Id, input: AgentInput): Promise<'accepted' | 'unavailable'>;
  interrupt(turnId: Id): Promise<InterruptReceipt>;
  respondToApproval(id: Id, response: ApprovalResponse): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  describePersistence(): AgentPersistenceHandle | null;
  close(): Promise<void>;
}
```

Driver 把原生事件映射成驱动无关的会话条目（`AgentEvent`）。改文件的工具调用（`tool-call`，`tool: 'file-change'`）成功时，`output` 是 unified diff：原生事件带了 diff 的照用，没带的由 Driver 从工具输入合成；失败时 `output` 是错误文本。`detail` 仍是动作与路径。

Driver 声明图片输入、原生工具、审批、恢复、后台工作与 steer 等能力；经过集成测试才能开放。

Driver id 是开放的字符串（`^[a-z][a-z0-9-]*$`，不超过 63 个字符）。内置的 id 是 `claude`、`codex`、`copilot`、`pi`、`opencode`、`gemini`、`cursor`、`grok`、`kimi`（`BUILTIN_DRIVER_IDS`），其余 id 留给用户添加的 ACP 智能体（§3.11）；内置 id 有 Driver 实现才注册，没有注册的 id 与不存在一样。已实现的 Driver：Codex（`codex app-server` 的机器协议）、Claude Code（Claude Agent SDK）、Pi（`pi --mode rpc`，stdio 上的 JSON 行命令与事件）、OpenCode（`opencode serve` 的 v2 HTTP API 与事件流），以及经 Agent Client Protocol（ACP，stdio 上的 JSON-RPC）接入的 GitHub Copilot、Gemini CLI、Cursor Agent、Grok、Kimi Code 与用户添加的智能体。ACP 的这些是同一份实现，按预设区分启动命令、环境变量、登录方式与访问模式的映射（GitHub Copilot 的会话模式 id 是 URL 形式，「全部放行」是配置项 `allow_all`：完全访问取 `#agent` 并打开它，别的模式关掉它；`#autopilot` 比完全访问还宽，不用）；用户添加的预设只有启动命令与环境变量，不查版本、没有安装与登录命令，模型表与访问模式取会话应答里的。具体接口按各自的官方文档确认；Driver ABI 不因此带上某个引擎特有的概念。

ACP 的共享实现在真机上跑通了完整会话，按 D08 算验证、可以开会话（§3.11）：这次是经 claude-code-acp 适配器（把本机已登录的 Claude Code 包成 ACP 智能体）验证的，覆盖探测、新建、审批、追问、中断后再继续、`session/load` 恢复，以及经 Runtime 的一轮完整对话（命令与改文件的审批、BaoCut 工具通道、事件进会话存储）。内置预设与用户添加的智能体各自还没有在 BaoCut 上实测过（`tested` 为 false），只作提示，不阻断。改文件的步骤成功时，`output` 是由 ACP 的 `diff` 内容块（`oldText` → `newText`）生成的 unified diff；智能体只给改动片段时，行号相对片段。BaoCut 自己的工具（开会话时传过去的 MCP 服务）来问时原生侧直接放行，由工具通道按访问模式把关（§3.12），与 Claude Code 的 Driver 一致；认得出的工具名是 `mcp__<服务>__<工具>`（claude-code-acp 实测）与 `<工具> (<服务> MCP Server)`（Gemini CLI，按源码推断，未实测）两种；认不出时照常询问。它的已知限制：工具通道（§3.5）只交给声明支持 HTTP 的智能体（`mcpCapabilities.http`），不支持的会话里用不了 BaoCut 的工具，开始时提示；开发者指令附在新会话第一轮输入的前面（`session/new` 没有这个字段）；没有 steer；访问模式映射到智能体的会话模式，两边取更严的；「本会话放行」由 Driver 自己记，不选智能体原生的「总是允许」；不支持受限的一次性调用（§6.9）。

Pi 的 Driver 的协议路径已用真实的 pi（1.0.4）与脚本化的模型服务验证（写、改、命令、读，steer、中断、恢复，MCP 与开发者指令），按 D08 放开（`verified: true`）；还没有用真实的模型账号实测（`tested: false`）。最低版本 0.84.4：用到的命令里最晚出现的是 `clear_queue`；`steer` 与 `agent_settled` 另有退路（回「Unknown command」时报不支持，没有 `agent_settled` 时以 `agent_end` 收尾），`get_available_models`、`--extension` 与 `registerMcpServer` 等没有查到出现的版本，只在 1.0.4 上实测过。它没有审批（`approvals: false`）：pi 执行命令、改文件之前从不问人，BaoCut 管不了它的原生权限，所以只能在「完全访问」下运行，别的模式由 Harness 以 `AGENT_ACCESS_MODE_UNSUPPORTED` 拒绝（§3.12）；BaoCut 自己的工具仍由 ApprovalService 按访问模式把关。每个会话一个 `pi --mode rpc` 进程，恢复句柄是 pi 的会话文件（`--session <文件>`；pi 有了第一条回复才写这个文件，文件不在时新建并提示）。登录状态按 `get_available_models` 是否为空判断：它只列有可用凭据的模型；pi 每次启动都会建一个内容为 `{}` 的 `auth.json`，文件在不代表登录了。能力：有 steer（`steer` 命令，当前这批工具调用之后交给模型）、能恢复、收图片（模型的 `input` 不含 image 时改附本机路径）。开发者指令经 `--append-system-prompt` 交给它；工具通道（§3.5）经一个临时扩展用 `registerMcpServer` 注册（`exposure: 'direct'`），接不上时提示。pi 的 `turn_start` / `turn_end` 是一次模型调用，一个 BaoCut 回合是一次 `prompt` 到 `agent_settled`。扩展要用户作答的请求（`extension_ui_request`）一律取消并提示；不支持受限的一次性调用（§6.9）。

OpenCode 只接 2.x（1.x 报版本过低）：每个会话起一个只监听 127.0.0.1、随机密码的 `opencode serve`，经它的 v2 HTTP API 与事件流驱动，访问模式写成会话的权限规则、原生来问的动作由 Harness 查表回答，MCP 服务与开发者指令登记在该会话上；已在真机（opencode 2.0.24）以免费模型验证（`verified`、`tested` 都为 true）；已知限制：拒绝一个工具后 OpenCode 结束整轮（记为完成并提示），`external_directory` 按越界处理，plan 模式下连读取工作目录外的文件也会被拒，比 Codex 的只读沙箱严，3.x 会被报成版本不符（outdated），不支持受限的一次性调用（§6.9）。

- 缺少 steer 时，补充输入排队，或由用户显式中断后再执行。
- 原生取消是否成功未知时，不能立即放行替代的 Turn。
- Driver 崩溃时报告真实状态。重复的唤醒与完成通知按事件 ID 去重。

### 3.2 TaskContract

```ts
interface TaskContract {
  taskId: Id;
  revision: number;                     // 从 1 起，每次修改加一
  conversationId: Id;
  videoId: Id | null;
  baseVideoRevision: Revision | null;
  goal: string;
  scope: ContextSelection;
  constraints: ConstraintRef[];
  protectedRefs: ProtectionRef[];
  deliverables: Array<{
    kind: 'preview' | 'video-change' | 'video-file' | 'subtitle' | 'audio' | 'package';
    requiredStage: 'candidate-ready' | 'committed' | 'published';
    language?: string;
    variantId?: Id;
  }>;
  autonomy: 'plan' | 'ask' | 'autoAcceptEdits' | 'auto' | 'fullAccess'; // §3.12
  permissionScopeRef: Id;               // 会话绑定的项目；不属于项目的会话是会话自己
  budgetPolicyRef: Id | null;           // 任务预算（§7.8）
  acceptanceChecks: CheckDefinition[];
  supersedes: { taskId: Id; previousWork: 'stop' | 'keep' } | null;
  change: { by: 'user' | 'agent' | 'runtime'; reason: 'created' | 'updated' | 'mode' | 'goal'; fields: string[]; at: string };
}

interface ContextSelection {             // 「这个」「这里」指的对象
  videoId: Id | null;
  videoRevision: Revision | null;       // 用户发出任务时看到的版本
  sequenceId: Id | null;                // 不给时是根序列
  itemIds: Id[];                        // 选中的时间线实例
  timeRange: { fromSeconds: number; toSeconds: number } | null; // 输出时间；没有时是整个视频
}

interface ConstraintRef {               // 自然语言约束，交给智能体
  constraintId: Id;
  kind: 'content' | 'style' | 'duration' | 'format' | 'language' | 'other';
  text: string;
}

interface ProtectionRef {
  protectionId: Id;
  videoId: Id;
  target:
    | { kind: 'video' }
    | { kind: 'entity'; entityId: Id }
    | { kind: 'property'; entityId: Id; propertyPaths: string[] }  // 点分隔：text、style.fontSize
    | { kind: 'interval'; sequenceId: Id; span: FrameSpan; trackIds?: Id[] };
  origin: { by: 'user'; revision: number; at: string };          // 用户在哪个修订加上的
  note?: string;
}

interface CheckDefinition {
  checkId: Id;
  kind: 'review' | 'quality';           // quality 留给 QualityService（§14）
  description: string;
  required: boolean;
}
```

目标、范围、内容约束、风格节奏、时长画幅、语言声音、交付阶段、权限预算和「不要改动」由自然语言整理而来；默认值对用户可见。

**建立**。合同随任务（Run）建立，`tasks.create` 与 `conversations.send` 是同一个入口，可以带上合同的输入。没有给出的部分由 Runtime 补默认值：目标是用户的消息，范围来自发送时的编辑器上下文，有打开的视频时交付是写进视频（`video-change` / `committed`），没有约束、保护与检查，预算不限。默认合同以 `change.by = 'runtime'` 记下，经会话里任务条目上的 `contract` 与任务中心的 `contractRevision` 对用户可见。早先没有合同的任务读入时补上默认合同。

**存放与修订**。合同按会话存在会话记录里（`tasks[taskId]`：全部修订与验收检查的结果），与会话的条目一起写盘。修订只追加：每次修改产生新的 `revision`，`change` 记下谁、因为什么、改了哪些字段，旧的修订按 `revision` 可查。修改要带 `expectedRevision`，不是最新修订时以 `CONTRACT_REVISION_CONFLICT` 拒绝；任务结束（或正在停止）之后不能再改（`TASK_NOT_RUNNING`）。尚未启动的步骤采用新约束：保护范围在每次提交时取当时的修订，预算在每次接纳时取当时的上限；已经冻结输入的 Job 不在执行中更换内容。

**访问模式就是 `autonomy`**。合同不另设一套自治等级：`autonomy` 是会话此刻的访问模式（§3.12）。改合同的 `autonomy` 等于切换会话的模式；切换会话的模式时，进行中任务的合同记一个 `reason: 'mode'` 的修订。

**谁能改什么**。用户（界面、CLI 之外的 RPC 入口、Web 非只读）可以改全部字段。任务里的智能体经工具（`tasks_contract`、`tasks_update_contract`、`tasks_record_check`）读自己的合同，只能细化范围、约束、交付与验收检查，修订记为 `change.by = 'agent'`、用户看得到；`autonomy`、预算、保护范围与权限范围只由用户决定，带上它们时整次以 `CONTRACT_FIELD_READONLY` 拒绝。权限范围随会话的项目绑定，不经合同修改。CLI 只查看（`baocut tasks contract`），Web 只读模式只能查看，MCP 服务不开放合同（对外服务没有任务）。

**改变目标**。`tasks.changeGoal` 选择旧工作的处理：`stop` 停止旧任务并取消它提交、还没结束的 Job；`keep` 只停下旧任务的回合，已经提交的 Job 照常完成、产物留作候选。旧任务结束后以新目标建立新的 Run，合同由旧合同派生（范围、约束、保护、交付、检查与预算上限照搬，预算用量从零计），`supersedes` 指向旧任务。

**验收检查**。合同定义检查，结果按记录先后保留（`tasks.recordCheck`，标明由用户还是智能体记录，任务结束后也能记录）。首版只定义与记录，QualityService 不自动执行（§14）。

**保护范围是领域状态，只对这个任务生效**。`ProtectionRef` 分解到 video / entity / property / interval，记录授权来源（加上它的修订），有效范围是这个任务，直到被移除。Runtime 在任务里的写入时把任务合同此刻对这个视频的保护随事务交给 VideoEngine，引擎在提交之前对照这笔事务的实体变化检查，触碰时整笔拒绝，什么都不写：

- `video`：这个视频的任何变化；
- `entity`：这个实体本身的创建、修改与删除，不含子实体；
- `property`：实体上的几个属性（实体 JSON 里点分隔的路径），删除实体算触碰；
- `interval`：序列上的一段帧区间，修改前或修改后与它相交的时间线实例（音频按精确起止时刻）；`trackIds` 限定轨道。

拒绝的错误码是 `TASK_PROTECTED`（`after-user-action`），`entityIds` 是被触碰的实体，`details.protections` 列出被触碰的保护（`protectionId`、`target` 与实体）。

「任务里的写入」与不受限制的写入：

- 受检查：智能体带任务的提交与撤销（撤销只看操作者是智能体）；任务下的 Job 与流程把结果应用到视频（经提交者找到所在的任务，同 §7.8 的任务预算）。后者的行为者仍是 `system:jobs`、`system:pipeline`，事务带上 `taskId`；引擎对带 `taskId` 的非用户写入检查。
- 不受限制：用户与手动的修改；不在任务里的 Runtime 写入（界面、CLI、Web 与对外服务提交的 Job 与流程）；用户对任务结果的决定（`jobs.reconcile apply`）。
- 保护取合同的最新修订；任务已经不在了（会话删掉了）时没有保护。重启后补做的应用等 Harness 就绪之后再取。

后台写入被拒时，Job 的应用记为 `rejected`，错误码 `TASK_PROTECTED`（`details.protections`）；Job 以 `APPLY_FAILED` 失败，`details.reason` 是 `TASK_PROTECTED`。产物留作候选，要不要应用由用户用 `jobs.reconcile apply` 决定。流程没有应用记录：停在写视频的那一步，以 `TASK_PROTECTED` 失败（`details.step`），前面步骤的输出留着；`pipelines.retry` 仍在原任务里，同样受保护。智能体只能启动从链接导入（§7.9）。

QualityService 比较未授权属性的差异。不可避免的联动先给出最小变更提案。因渲染缓存失效而重新求帧，不等于允许重新设计内容。

用户可见的语义见产品设计 §6。

### 3.3 一个执行主体，多个受控步骤

P0 由一个用户可以理解的执行主体对结果负责。内部的分析与素材生成可以并行，视频提交按视频有序。计划以产物阶段组织，不要求用户理解框架或多个智能体。

能力选型优先使用已有素材、原生对象和当前已验证的模型，避免为改一个标题重新购买生成。首版只要求一个端到端验证的 Driver；其余 Driver 逐步接入同一合同。

切换执行引擎时，向新引擎提供目标、约束、当前视频状态与最近回执的摘要，不宣称原生会话可以逐字迁移。

### 3.4 上下文与检查覆盖

`ContextBuilder` 提供：`videoRevision`、`sequenceId`、选中的 item / occurrence / 词 ID、有效文稿、当前的源时间与输出时间、必要的帧和相关约束。

- 先摘要与检索，再按需扩展，不默认把完整视频和全文外发。
- 只读到文件名不能声称理解了内容。`ContextEvidence` 记录实际读取的范围与方法。
- 检查记录包含 `method`、`inputRefs`、`coveredRanges`、`uncoveredRanges`、`findings` 和 `confidence`；它不是被展示出来的内部推理。

智能体的循环是：理解 → 查看材料 → 计划 → 制作或编辑 → 看与听 → 修正 → 交付。自动质量修复默认最多两轮，之后转人工；这是可修改的产品默认值。付费重试另受独立预算限制。修复不能越过保护范围，也不能把主观风格自动当成硬错误。

### 3.5 工具目录

`ToolCatalog` 使用领域化的输入与输出，适配原生工具、MCP、SDK 和 CLI 四种接入方式。每个目录项写全这几项，各个面都由它派生、不另抄清单：标题；说明，第一句是一行摘要；输入 schema，每个字段有说明，枚举值都写进说明；`effect`（`query` 只读、`mutation` 同步写入、`job` 立即返回 `jobId`、`destructive` 删除或不可撤销），与 `annotations` 一致（`query` 即 `readOnlyHint`，`destructive` 必带 `destructiveHint`）；一到三个能通过 schema 的 `examples`；`surfaces`，即出现在哪些面（`agent` 会话的工具桥、`mcp` 对外的 MCP 服务、`cli`），写全不省略；可选的 `positional`，CLI 的位置参数。

```text
videos.list / videos.create / videos.inspect / videos.history / videos.frames / videos.importPackage / videos.delete / timeline.query / speech.search / previews.capture
documents.read / documents.put / assets.import / captions.create
edits.propose / edits.prepareBatch / edits.applyPrepared / edits.apply / edits.ops / edits.undo
models.capabilities / speak / image
transcribe / translate / dub / transcode
code.build / code.publish / code.inspect
jobs.inspect / jobs.wait / jobs.list / jobs.cancel / jobs.retry / artifacts.save / downloads.save / export / download
tasks.contract / tasks.updateContract / tasks.recordCheck / tasks.stop / grants.request
models.list / models.install / models.test
projects.list / projects.create / skills.list / skills.read / library.list / library.show
space.list / space.search
```

- 编辑工具生成或提交合法的 `EditOperation`。
- `videos_create` 新建一个空视频，位置与固定流程新建的视频相同（§7.9「新建视频是流程的一步」）；调用成功后会话里多一条 `video-created`（§11.3）。新建不是一笔修改，没有变更卡与撤销。可选的 `project` 指定建在哪个已登记的项目（项目 id，或项目目录的路径）：会话里给了就要是会话所属的项目；对外服务没有会话，必须给，不给时 `INVALID_ARGUMENTS`（带 `next`，§4.8）。
- 模型工具立即返回 `jobId`；查询状态不触发新的计算。`provider` 与 `model` 参数可选，不给时用这种能力的默认值（§6.2）；`models.capabilities` 列出每种能力可用的 Provider、模型与默认值，供智能体先查再选。`generateText` 列在其中却没有提交它的工具：智能体本身就是文本模型，`generateText` 只供 BaoCut 自己的流程在进程内调用（§7.9）。
- 能力没有配置时，模型工具返回 `CAPABILITY_NOT_CONFIGURED` 与补救方式（§6.2），智能体向用户说明而不是换一种办法绕过。给智能体的结果带上 `remedy` 的 `hint`、与 CLI 打印的同一组补救命令，以及一句 `next`：转告用户到设置里的模型配置或用 `baocut models configure` 启用，不用 shell 命令、脚本或别的 API 提供方绕过。Provider 被停用同样是 `CAPABILITY_NOT_CONFIGURED`（补救是重新启用）；缺音色（模型没有默认音色、或没有所给的音色）在提交时以 `invalid-request` 拒绝，带模型的音色清单，由智能体从中选或请用户给出账号里的音色 ID。智能体的工具不能启用或配置 Provider、不能设默认值，也没有读写凭据的工具：启用是用户对数据外发的持续授权（§6.8），只由用户做。
- 生成工具（`speak`、`image`）与 CLI、界面用同一组参数：文本或提示词，可选的音色、尺寸、张数与 `videoId`。文本超过模型的单次上限时在提交时拒绝（智能体的工具以 `INPUT_TOO_LONG` 返回，带长度与上限），由智能体自己分段提交，不由 Runtime 截断或切块。给了 `videoId` 时结果导入为候选素材，放上时间线是另一次编辑。`jobs.inspect` 返回冻结的 Provider、模型、参数与每个输出（`artifactId`、媒体事实、`assetId`；转写是 `documentId`）。不给视频时结果只是产物（`artifactId`）：
  - 之后要放进视频，`edits_apply` 的 `importAsset` 用 `artifactId` 代替 `path`。Runtime 从产物库解析出文件，交给引擎现有的按路径导入；bytes 收进视频（`managed`，§5.1），来源与提交时给了视频的导入相同（任务、Provider、模型、参数摘要与输入 hash），不重新生成、不再调用 Provider。同样的 bytes 已在视频里时复用原素材。只接受生成的媒体与只下载的从链接导入的媒体，转写结果不能导入为素材。下载的媒体不进产物库：`artifactId` 是下载目录里那个文件的内容摘要，Runtime 按任务输出登记的 `path` 找到它，大小与摘要都对得上才用（挪走、删掉或改过都是 `ARTIFACT_NOT_FOUND`），来源与流程自己导入时相同（`origin: 'link-import'`）。
  - 需要文件本身时，`artifacts_save { artifactId, path, overwrite? }` 把产物复制成范围的写文件目录（会话是工作目录，终端是 `cwd`；对外服务没有它）里的一个文件。路径按真实路径判断，不能经 `..`、绝对路径或符号链接写到目录以外；目标本身是符号链接时拒绝；不写进视频目录（含 `video.db`）与 `.bcut`；已有文件只有 `overwrite` 才替换；扩展名与产物一致（省略时补上）。它只复制产物库里的一个文件，不是通用的导出。
  - 两者都只用看得到的任务（与 `jobs_inspect` 相同，见下表）的产物，其他一律 `ARTIFACT_NOT_FOUND`；失败但保留了产物的任务（导入视频失败）也算。
- `downloads_save { path, name? }` 把会话工作目录里的一个文件复制到下载目录（与从链接导入同一个：设置 `downloads.directory`，否则主机的下载文件夹，§7.9），交给用户：不属于项目的会话的工作目录用户看不到，智能体自己做出的结果（例如译好的字幕）经它交出。源按真实路径判断，不能经 `..`、绝对路径或符号链接指到工作目录以外，必须是普通文件，不在视频目录（含 `video.db`）与 `.bcut` 里，不超过 200 MB；只新建、不覆盖，重名时加序号；文件名按下载的文件同一套规则清理，扩展名沿用源文件的。写操作，规划模式下拒绝；目录项的 `surfaces` 只有 `agent`：MCP 服务与 CLI 没有会话工作目录，都没有它。
- 对象的读写有几件 sugar，编译成 `edits_apply` 的操作，走同一条提交路径（产物解析、秒数换算、对外服务的素材路径限制、译文补对齐），返回同样的回执：`documents_put { video, document? | kind, name?, language?, sourceDocument?, sourceAsset?, body, revision? }` 编译成一个 `putDocument`（替换时 kind 取原来的；新建译文要给 `language` 与 `sourceDocument`），回执另带 `documentId`；`assets_import { video, path | artifactId, name?, storage?, place?: { track?: 'main' | <trackId>, at?: <秒> | 'end' }, revision? }` 编译成 `importAsset`，给了 `place` 时同一笔再加 `addItem`（`main` 与 `end` 是省略 `trackId` 与 `at`：第一条未锁定的同类轨道、接在末尾），回执另带 `assetId` 与 `itemId`；`assets_prune { video, assetIds?, apply?, revision? }` 列出没有引用的素材，给 `apply: true` 时编译成 `removeAssets`（代码包与它的预渲染替身成对）；`chapters_adopt { video, asset?, document?, outline?, label?, revision?, dryRun? }` 把素材来源自带的章节（或显式大纲）吸附到转写的段落、句子起点，再从源时间投影到时间线，编译成一个整个替换章节的 `setChapters`，回执另带每章的吸附结果 `sourceChapters`（规则见 §7.9「采用来源章节」）；三个面都有（[命令与协议规范 §4.2](../spec/command-protocol-spec.md#42-编辑操作)）。`revision` 不给时用最新的版本。`edits_ops { op? }` 按操作族列出 `edits_apply` 的每个操作的说明、参数的 JSON Schema 与一个示例；`edits_apply` 的操作说明由同一张表拼成。
- `videos_history { video, limit? }` 列出修改历史（默认 20 笔）与检查点。`videos_import_package { file, project?, name? }` 打开便携包（与 `videos.importPackage` 同一个入口，同步完成，`mutation`），位置同 `videos_create`；只在 `agent` 与 `cli` 面。
- `videos_frames { video, at? | range + count?, format?, maxWidth? }` 取帧（[Agent 能力面设计 §4.3](../design/agent-surface/agent-surface-design.md#43-名词组对象的读与写)）：时间线上的时刻按根序列的帧率落到帧，取盖住它的、启用的、轨道可见的视频片段里最上层的那个（视觉轨 `order` 越大越靠上，同轨按 `paintOrder`），按它的时间映射换成素材时间，从素材取那一帧（与素材库缩略图同一份缓存与 ffmpeg）。不合成：字幕、文字、叠加与画中画的摆法、效果都不在帧里，结果的 `composited: false` 与 `note` 说明；没有视频片段的时刻 `file` 为 null。单次最多 24 帧，默认 PNG、长边不超过 1280。文件写进范围的写文件目录（会话与终端是 `cwd`，对外服务是视频所属项目的 `exports/`）下的 `.baocut-out/frames/<videoId>/at-<毫秒>ms.<png|jpg>`，按真实路径不出这个目录、不进视频目录与 `.bcut`。不改视频，风险等级 `read`，规划模式下也能用；写文件所以 `effect` 是 `mutation`（幂等）。
- `documents_read` 读转写（`speech`）时另带 `translationBasis`：写译文要用的 `sourceBasis` 与按字幕与翻译核心的规则切好的句子（ID、指纹、文本、词），智能体自己翻译时照填（视频格式规范 §5.3），不自己切句、算指纹。每句的 `alignment` 写句级对齐 `{ basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: <那一句的 wordIds> }`；`textHash` 由 Runtime 补。`edits_apply` 的 `putDocument`（或 `documents_put`）写 `baocut.translation/2` 时，Runtime 在交给引擎之前按单元的 `sourceSentenceId` 在它译自的转写里找到那一句（同一套规则），`alignment` 为 null 或缺 `sourceWordIds`、`textHash` 的补成句级对齐，句级、没有块的对齐的 `textHash` 按译文重算；句子找不到、指纹与单元记下的不同、单元已过期的不动，转写读不了或句子的 WASM 没有构建时只补对齐对象缺的 `textHash`。回执的 `filledAlignments` 是补了几句。这样写的译文导出双语字幕与建字幕层都拿得到每句的成员词。读转写是为了自己翻译时给 `translateTo`（目标语言，BCP 47）：Runtime 登记一条 `agentTranslate` 任务记录（`submitter` 是这条会话与这一回合，`translation` 记译自的转写、目标语言与切好的句数；没有 Worker、不排队，`progress` 为 null），让视频卡、字幕面板的翻译与任务页看得到「正在翻译」，结果另带 `translationJob`。同一回合同一份转写同一门语言沿用同一条；写入这门语言的译文（`putDocument` 的 `kind: 'translation'`、`sourceDocument` 是这份转写）时完成，结果指向译文；回合结束还没写的记为中断，用户停止的记为取消，下一回合接着翻译时上一条中断、重新登记。它跟着回合走，取消这条记录不会停下智能体，所以界面上不给「取消」。`translateTo` 只用于转写，别的文档是 `INVALID_ARGUMENTS`；它是要写的意图，规划模式下不登记。
- `captions_create { video, documentId, bilingual?, layoutProfileId? }` 把一份转写或译文做成字幕层（§7.9「字幕层」），与固定流程的 `captions` 一步同一份算法（`planCaptionLayer`），一笔可撤销的事务。转写建原文字幕；译文按单元的句级对齐取原句成员词的时间、按显示宽度切条（与编辑器的「放到画面上」相同，不经 Speech Worker），有 `alignment` 为 null 的单元时以 `TRANSLATION_UNALIGNED` 拒绝；`bilingual` 只用于译文，译文为主、原文为辅，转写上给 `bilingual: true` 是 `INVALID_ARGUMENTS`。`layoutProfileId` 是 `default` 或 `two-line`（缺省 `default`），两者源侧的切条参数相同，结果里回显；字幕层还不记 profile（视频格式规范 §5.4 的 `CaptionProgram` 没有落盘）。同一份文档已有字幕层时不覆盖，照样新建一层（「不覆盖」），结果的 `existing` 与 `note` 说明；素材不在时间线上是 `CAPTIONS_NOT_ON_TIMELINE`，没有可显示的字幕条是 `CAPTIONS_EMPTY`。`bilingual: true` 而时间线上还没有这份转写的原文字幕层时，同一笔事务里先给转写建原文字幕层（与转写的 `captions_create` 同样切条与放置），再建译文的一层，两层共用新建的样式，撤销时一起撤；译文已有一层显示着（新的一层停用着放上去）时不顺带建。返回 `transactionId`、`revision`、新字幕文档的 `documentId`、`trackId`、`itemIds`、`cueCount`、`enabled`，译文另有 `bilingual` 与配对的原文字幕层 `pairedOriginal: { documentId, itemIds, created } | null`（`created` 为 true 是这次顺带建的；null 时 `bilingualNote` 说明只显示了译文）。提交前版本冲突时按新的状态重新算，最多三次。三个面都有：对外服务给范围之内的视频建字幕层，与会话里相同。
- 一级动词（Agent 面设计 §4.2）各自启动一条固定流程（§7.9），立即返回 `jobId`，参数沿用流程的、改成工具的写法：`transcribe`（转录：输入三选一，`video` 可给 `asset`、`file` 是本机媒体、`url` 走 `download` 的同一段；默认新建视频与字幕层，`noVideo` 只写 TXT 与 SRT 文稿，`noCaptions` 不建字幕层；`video` 已有文稿时 `target` 选落点：`'new-video'`（缺省）在同一项目新建一部视频，链接同一份素材，名字「<原名> · 重新转录」、可用 `name` 另给，`'replace'` 换用文稿（§6.6），`translations: 'carry' | 'discard'` 只用于 `replace`（缺省 `carry`），`acceptEdited: true` 越过手工修改闸门（`TRANSCRIPT_EDITED`）；没有文稿的视频两种都直接写进它。工具的 `target` 就是流程参数的 `destination`。CLI 写作 `--replace`、`--discard-translations`、`--accept-edited`，不给 `--replace` 就是新建视频）、`translate`（配置好的文本模型翻译：`video` + `to` 写新译文并建字幕层，`file` + `to` 译 SRT / VTT 文件；没有文本模型时以 `CAPABILITY_NOT_CONFIGURED` 拒绝，`next` 指向智能体自己翻译的路径）、`dub`（翻译配音，给了 `translation` 时不调用文本模型）、`transcode`（文件到文件的压缩、合并与取音轨，只有本机文件这一种输入，不在 MCP 面）。`file`、`files`、`outDir` 按范围的文件基准解析（会话是工作目录，终端是 `cwd`）；对外服务没有本机路径，给了以 `INVALID_ARGUMENTS` 拒绝。外发授权由流程检查（`GRANT_REQUIRED` 时照统一的 `next`），确认里不代发授权。会话里的智能体优先用一级动词，指导里写明（§3.8）。
- 模型工具与视频工具经同一个入口（工具桥与 MCP 服务是 MCP 端点，终端是 `catalog.call`）、以同一个主体调用。工具名多数是网关方法把点换成下划线（`jobs_inspect`、`models_capabilities`），常用的几个用短名（`speak`、`image`、`export`、`download`，以及上面的一级动词），参数与网关方法相同，只是视频参数与视频工具一样按范围指代（下表「视频的指代」），范围以外的拒绝。`jobs_inspect` 只看范围看得到的任务（下表），其他一律 `JOB_NOT_FOUND`。会话里，智能体提交的 Job 记 `submitter: { kind: 'agent', id: <会话 ID>, taskId }`（§7.9），`jobs_cancel` 只取消本会话提交的，主停止一并取消本会话还没结束的（§7.4）；对外服务只取消自己提交的，终端哪个都能取消。提交、取消与 `artifacts_save` 是写操作，规划模式下拒绝；查看能力与任务是只读的。
- `jobs_wait { jobId, timeoutSec? }` 阻塞到任务终结或超时，返回与 `jobs_inspect` 相同的记录，另加 `settled`；`timeoutSec` 是 1 到 50 秒（缺省 50），上限避开常见 MCP 客户端 60 秒的请求超时，超时不算错（`settled: false`），没等到就再调一次。等任务用它，不反复调 `jobs_inspect` 轮询。`jobs_list { video?, state?, limit? }` 列出看得到的任务的摘要（新的在前，固定流程的步骤折叠在父任务下）：会话是 `jobs_inspect` 看得到的那些，对外服务是自己提交的，终端是全部。`jobs_retry { jobId }` 从失败的那一步重跑一个固定流程（网关的 `pipelines.retry`，同一个 `jobId`，`attempt` 加一），只能重跑自己提交的、已经结束的流程，按 `command` 确认。
- 登记类的查询（三个面都有，规划模式下也能用）：`models_list` 列出本地模型包与安装状态（不给本机路径）；`projects_list` 列出看得到的项目（会话只有所属的项目，对外服务是范围之内的视频所属的项目且不给路径，终端是全部）；`skills_list` 列出 skill 的 id、名字、一行说明与开关，正文用 `skills_read` 取；`library_list` / `library_show` 读用户库（§5.9）的术语表、音色与品牌素材，写入、导入与克隆不在目录里。`models_test { bundleId }` 检查一个已安装的模型包（任务，按 `command` 确认）；`projects_create { path, name? }` 在一个目录上新建并登记项目（相对会话的工作目录或终端的 cwd，工作目录之内按 `edit`、之外按 `high` 确认），会话不会因此换到新项目里。这两个只在工具桥与 CLI。
- Space 工具只读（`space_list`、`space_search`，§5.7、§5.11）：会话里的智能体只看本会话来源目录里的条目与视频，对外服务只看访问策略范围之内的视频与由它们生成或导出的条目（§4.8），终端与 Space 界面看到的相同；会话里的结果不带来源目录的绝对路径，条目用相对路径与 `videoId` 指明，检索命中带视频、文档、时间与片段，要精确定位再用 `videos_inspect` / `documents_read` 读当前版本。工具目录里没有 `space_get`，条目详情用 `space_list` 的过滤取。
- 候选、回执、检查报告都以稳定 ID 返回。
- 本机工具直接调用进程内接口；智能体进程经原生工具桥或 MCP 进入同一个 Runtime。CLI 是薄客户端，不在每次调用时启动重型的视频宿主。
- 其他应用里的智能体经对外的 MCP 服务（§4.8）使用同一份目录里 `surfaces` 含 `mcp` 的工具；它们不属于任何会话，权限由服务的访问策略决定。
- 工具权限同时检查调用主体、视频、TaskContract、`runGeneration`、授权与预算，不依赖模型自觉遵守。

同一份目录服务三种主体，工具实现相同，区别只在主体与范围（`ToolScope`）；Runtime 里只有一份 `ToolCatalog`，工具组经 `ScopeRouter` 按主体的种类转给各自的范围，各接入方式拿的是它的视图（`ToolCatalogView`）。第三种是终端里的用户本人：CLI（或桌面界面）的网关连接经 `catalog.list` / `catalog.call`（§4.1）按名调用，主体是 `LocalPrincipal { connectionId, client, cwd, projectDir }`，范围是 `LocalScope`（[Agent 能力面设计 §3](../design/agent-surface/agent-surface-design.md#3-主体与权限)）。

| | 会话里的智能体（工具桥） | 对外服务的客户端（MCP 服务） | 终端里的用户本人（`catalog.call`） |
| --- | --- | --- | --- |
| 主体与范围 | `AgentPrincipal`、`AgentScope`：会话的来源目录与 TaskContract | `ServicePrincipal`、`ServiceScope`：访问策略的视频名单与等级 | `LocalPrincipal`、`LocalScope`：用户能访问的一切；相对路径（素材、导出目标、视频目录）按 `cwd` 解析，绝对路径照收，没有目录约束 |
| 视频的指代 | 相对来源目录的路径或 `videoId` | `videoId` 或 `<projectId>/<相对路径>` | 视频目录（绝对或相对 `cwd`）→ `videoId` → Space 条目 id；没打开的挂在发起调用的连接上打开，连接断开时随之放下 |
| 新建视频 | 会话所属的项目或会话的工作目录 | 必须给 `project`（已登记的项目）；访问策略是视频名单时，新视频写进名单（§4.8） | `projectDir`（显式给，或从 `cwd` 向上找 `.bcut/project.json`，用到时登记）；没有时在默认项目目录下的 `CLI` 项目里，结果的 `note` 说明 |
| 写入的 actor | `agent:<会话>` | `external:<serviceId>` | `user_local`，与桌面界面共用撤销栈 |
| 确认 | 按访问模式与风险在会话里等用户 | `ask` 下生成服务审批 | 不走 BaoCut 的审批，确认由 Agent 宿主负责；没有授权覆盖的外发以 `GRANT_REQUIRED` 拒绝，不替用户发放授权 |
| 任务的提交者 | `{ kind: 'agent', id, taskId }` | `{ kind: 'service', id, clientId }` | `{ kind: 'connection', id: <连接> }`，与桌面端连接提交的相同 |
| 看得到的任务与产物 | 本会话提交的与来源目录里已打开视频上的 | 自己提交的 | 全部（与任务中心相同），都能取消 |

### 3.6 能力快照与合同指纹

Runtime 提供按主体与视频过滤的 `CapabilitySnapshot`：

```ts
interface CapabilitySnapshot {
  contractHash: string;             // 标识合同形状，不是授权凭证，也不证明运行健康
  generatedAt: string;
  driverVersions: Record<string, string>;
  adapterVersions: Record<string, string>;
  entries: Array<{
    capability: string;
    level: 'declared' | 'verified' | 'effective';
    parametersSchemaRef?: string;
    limits?: JsonValue;             // 批大小、上下文预算、检查样本上限等
    verifiedEnvironment?: string;
    unavailableReason?: 'not-configured' | 'not-installed' | 'not-connected' | 'no-permission' | 'unsupported' | 'resource';
    requiredPermissions?: string[];
  }>;
}
```

能力分三层：

| 层 | 含义 |
| --- | --- |
| 声明能力 | 实现者声称支持 |
| 验证能力 | 在指定环境中测试通过 |
| 有效能力 | 此刻的安装、资源、策略与授权都允许 |

模型能力的条目来自 `models.capabilities`（§6.8）：每种能力一条，`limits` 里带默认的 Provider 与模型。

工具定义、界面控件和 CLI 帮助从同一个注册源派生，但三者不必暴露完全相同的功能面。发布新的 Driver 或 Adapter、重新加载配置之后更新快照。使用过期合同的调用返回明确的合同或能力变化错误，不默默改变参数的解释。

**CLI 的派生**。`baocut` 的工具命令不手写：命令树、旗标、`help` 与 `spec` 都从工具目录（§3.5）里 `surfaces` 含 `cli` 的工具派生（[Agent 能力面设计 §5](../design/agent-surface/agent-surface-design.md#5-cli-约定)）。工具名 `<名词>_<动词>` 是 `baocut <名词> <动词>`（多词动词 `_` → `-`），没有下划线的是一级动词；输入 schema 的字段是旗标（`camelCase` → `--kebab-case`，布尔 `--x` / `--no-x`，数组可重复，对象与数组也接受 JSON、`@文件` 或 `-`），目录项的 `positional` 是唯一的位置参数；`effect: 'destructive'` 的要 `--yes`，`job` 的默认等到终态。有正在运行的 Runtime 时读它的 `catalog.list`（与它同版本）；`help` 与 `spec` 不为此拉起 Runtime，没有在跑的时用离线快照，拼错的命令也按快照报 `UNKNOWN_COMMAND`、不拉起。快照在构建时由 `tools/catalog-snapshot.ts` 在进程内生成：用 `ToolCatalog(allToolSets())`（依赖为空，只读 schema 与目录项）按 `cli` 视图列出，形状与 `catalog.list` 相同，另带 `edits_ops` 的操作目录，写到 `apps/cli/src/generated/catalog.json`（生成物，不入库）。快照与 Runtime 的接口版本（`interfaceVersion`）不同时以 Runtime 为准；真正调用总是经 `catalog.call`，不按快照解释参数。给人用的本机管理命令（凭据、默认值、设置、对外服务等）不在目录里，是 CLI 手写的管理桶（`apps/cli/src/admin/`）。使用过期合同的调用返回明确的合同或能力变化错误，不默默改变参数的解释。

### 3.7 按范围读取，按意图批量编辑

**读取**。`videos.inspect`、`timeline.query`、`speech.search` 支持字段选择、时间范围、对象类型、分页游标和字节预算。默认返回与当前任务相关的片段及稳定 ID；读取全文是显式调用。响应标明覆盖范围、是否被截断、版本与继续读取的游标。被预算截断的数据不能被当成完整的视频。

**工具面**。面向智能体保留少量稳定的领域工具，复杂性放进有 Schema 的操作族与类型化的产物里，不为每种视觉风格增加一套近义工具。

**批量**。相邻的低风险修改可以组合成同一个 `EditBatch`，预检后一次提交（命令与协议规范 §7）。长时间的模型计算和跨视频写入不得塞进一个长事务。批大小、上下文预算和检查样本上限由版本化的限制返回，经测试后配置。

### 3.8 分层、渐进加载的创作指导

`GuidanceRegistry` 是版本化的，把能力说明与业务工具的实现分开：

| 层 | 内容 | 何时载入 |
| --- | --- | --- |
| 入口 | 任务分流与读取规则 | 每个任务 |
| 工作流 | 当前制作阶段的做法 | 进入该阶段时 |
| 能力指南 | 某类素材或技术能力的用法 | 需要该能力时 |
| 工具手册 | 精确的调用合同 | 调用该工具前 |

`ContextBuilder` 记录实际载入的条目 ID、版本、内容 hash 与用途。

- 对已有视频改一处字不加载完整的视频制作流程。
- 给定配音时不自动改用语音合成。
- 已经明确的画幅、声音、风格不重复提问。
- 先用已有的转录和少量相关帧建立证据，不足时再扩展视频或音频分析。
- 比较不同长度的版本时，按叙事锚点而不是相同的秒数。

外部代码包里的 README、注释或用户材料不是受信任的指导条目；读取它们不扩大权限。模型不可用时只保留实际可执行的路径，不用指导文字代替执行事实。

**Agent skill**。skill 是教内置 Agent 按某种方法做事的一个文件夹：根目录有一份 `SKILL.md`（front matter 里有 `name`、`description`，可选 `version`，正文是做法），可以带参考文件。类型与上限在 `@baocut/protocol` 的 `skill.ts`，方法见命令与协议规范 §4.1 的 `skills`。

- **两层目录**。内置层随应用发布（打包资源里的 `skills/`，开发时为仓库根的 `skills/`，环境变量 `BAOCUT_SKILLS_DIR` 可以指定，桌面应用打包后由主进程经它告诉 Runtime；现有的内置 skill 与新增办法见 [`skills/README.md`](../../skills/README.md)）；用户层是 `<Runtime Home>/skills/<id>/`，由添加与导入写入（§12.9）。目录每次调用都重新读，不缓存。
- **id 与跳过**。id 由文件夹名得出：Unicode NFC、小写，连续的非字母数字换成一个 `-`，最长 64 个字符，不限拉丁字母。不合规的文件夹（缺 `SKILL.md`、front matter 缺字段、含符号链接或特殊文件、超过上限）跳过并在 `diagnostics` 里给出原因；同一层里 id 相同的都跳过；用户层与内置层同 id 时内置的生效。不跟随符号链接：文件夹本身或里面的条目是符号链接时整个跳过。点开头的文件与目录不算 skill 的内容。
- **来源与开关**。来源是 `builtin`（内置）、`personal`（从本地文件夹添加）、`third-party`（从 GitHub 导入），来源记录在 skill 目录里的 `.baocut-skill.json`。默认开关：内置与个人的开着，第三方的关着，看过再开。开关只把与默认值不同的差量存在 Runtime Home 的 `store/skill-prefs.json`；移除一个 skill 时一并忘掉它的开关。
- **交给智能体**。Harness 每次创建原生会话（新建，以及会话空闲被收起、Runtime 重开、换执行引擎之后的恢复）时，把 skill 的索引（id、名字与截短的描述）附在开发者指导后面：先是下面「给外部 Agent 的说明书」一段的说明书页，再是开着的 skill。正文不进索引：智能体用只读工具 `skills_read { id, path? }` 取 `SKILL.md` 或同目录的文本文件，风险等级 `read`，规划模式下也能用；对外的 MCP 服务同样提供这个只读工具（§4.8）。用户在消息上点选的 skill（`conversations.send` 的 `skill`，开着、关着的都行）由 Runtime 把正文与文件清单附在这条消息交给智能体的文字后面（在模板段之后），会话里记下 skill 标记。受限的一次性调用（智能体作为 Provider，§6.9）不附 skill。
- **生效时间**。开关、添加与移除从下一次创建原生会话起改变索引；已经在跑的原生会话保留开始时的索引，不中途改写它的指导。点选与 `skills_read` 总按当前的目录：已移除的 skill 返回 `SKILL_NOT_FOUND`，关掉的 skill 仍能点选和读取。
- **信任边界**。skill 是指导，不是授权：用户层的 skill 来自用户添加或导入的文件夹，按本节上一段的规则对待，读取它不扩大权限，与访问模式、审批和 BaoCut 的规则冲突时以规则为准。索引与点选段里对用户层的 skill 写明这一点。BaoCut 从不执行 skill 里的任何文件。

**给外部 Agent 的说明书**。「怎么用 BaoCut」（启动、能力目录、硬规则、交付）的单一来源是仓库根的 `agent-skills/baocut/`（`SKILL.md` + `references/`），不属于上面的两层目录；其中 `references/craft/<id>.md` 由 `tools/sync-agent-skill.ts` 从 `skills/<id>/` 合成，生成块从工具目录与 CLI 的退出码表填充，`build:agent-skill`（`--check` 核对）。`packages/runtime-core/src/skills/agent-skill-renderer.ts` 把同一份正文渲染成两个面（标记法见 [Agent 能力面设计 §8.6](../design/agent-surface/agent-surface-design.md#86-一个说明书两个读者)）：CLI 面经 `catalog.agentSkill`（命令与协议规范 §4.1）交给 `baocut skill install`，写进外部 Agent 宿主的 skills 目录；工具桥面给会话内的智能体：Runtime 启动时按工具桥的工具目录渲染一次（`agent-tools/guidance.ts`），`SKILL.md` 正文是每个原生会话的开发者指导；`references/catalog/*.md`、`workflows.md` 与 `conventions.md` 成为内置的说明书页（`baocut-catalog-<页>`、`baocut-workflows`、`baocut-conventions`，描述取各页 front matter 的 `description`），只给会话内的智能体：总在会话的 skill 索引里、能用 `skills_read` 读（终端与 MCP 服务读它们得到 `SKILL_NOT_FOUND`，那边用装好的 CLI 面），不进 `skills.list`、不能开关；`skills/` 或用户层用了同样 id 的不加载，记 `builtin-conflict`。找不到说明书目录或渲染失败（未闭合的标记、工具桥面没有的工具名等）时 Runtime 启动失败，不带着空的或过期的指导开会话。查找顺序与 `skills/` 相同：`BAOCUT_AGENT_SKILLS_DIR` → 打包资源里的 `agent-skills/` → 仓库根的 `agent-skills/`。

### 3.9 视频记忆与下一轮上下文

`VideoMemory` 保存已确认的方向、术语、参考样稿、声音选择与保护范围，以及它们指向的稳定对象引用。

- 视频事实优先于旧聊天。
- 记忆可查看、删除，也可按任务覆盖。
- 跨视频复用品牌、声音或术语需要显式选择。

### 3.10 会话与项目的绑定

`ConversationStore` 在 Runtime Store 中保存会话、消息、卡片投影所需的事件，以及会话与项目的绑定。会话是一次独立的智能体任务：它可以属于一个项目（目录），也可以不属于任何项目。会话不绑定、也不锁定任何一个视频：一个会话可以创建多个视频，可以修改所在项目下的任意视频，也可以一个视频都不涉及。

- 会话与视频之间只有事实记录：会话里的任务创建或修改过哪些视频，由任务的回执得出，用于在会话头与 Space 里互相跳转。这份记录不是写入权，也不限制会话之后操作别的视频；每次写入的目标由当次工具调用给出，权限按 TaskContract 检查（§3.5）。
- 一个视频可以被多个会话修改。从视频发起对话时，默认新建一个属于该项目的会话并把这个视频作为引用带入；继续已有的会话由用户选择。

**持久形态**：每个会话一个只追加的日志 `store/conversations/<id>.jsonl`。第一行是文件头 `{"op":"header","formatVersion":2}`，第二行是 `snapshot`（完整记录：`conversation`、`items`、`seq`、`agent`、`tasks`），之后按顺序重放：`item` 行按 `item.id` 原地替换、没见过的追加到末尾（流式回复与工具调用的状态更新都是替换）；`meta` 行整体替换给出的 `conversation` / `seq` / `agent`，`tasks` 按 taskId 整体替换。内存为主，150ms 合并窗口到期时只追加变化了的行，不 fsync。新会话、item 被删或换序、任务被删、以及日志超过阈值（行数超过 4 ×（items + tasks）+ 64，或字节超过 4 × 记录大小 + 256 KB）时，原子替换成「文件头 + 一行快照」（压缩）；追加与压缩在同一个会话的串行写链上。读取：末尾残行跳过、这次不记落盘副本、下次保存整份写快照；中间认不出的行跳过并记日志；文件头或快照认不出时改名 `.corrupt-<时间>` 保留并跳过；`formatVersion` / `schemaVersion` 不认识时原样留着、跳过。旧的整文件 `<id>.json` 启动时导入为快照并改名 `.json.migrated`。

- `Conversation.projectId` 可空。可以从空绑定一次（下一条），之后不改绑到另一个项目。项目目录被移动或改名后，会话随项目的标识留在它下面，工作目录换到新路径；复制出来的目录是另一个项目，不带走会话（§5.1）。
- 无项目的会话在 Runtime Home 的 `scratch/<会话 id>/` 里工作，视频不建在那里。首次需要新建视频（智能体的 `videos_create`、从链接导入与转录的 `create` 目标、`videos.create` / `videos.importPackage`）时，`Harness.ensureConversationProject` 先在默认项目目录下建立项目（名字取会话标题，没有就是默认名）并登记，把会话绑定到它（`projectId` 从空变为该项目，`cwd` 换成项目目录，落盘），把工作目录里已有的东西按相对路径原样搬进项目（会话里指向旧目录的视频卡改指向项目），然后才在项目里创建视频。项目的登记与会话绑定是 Runtime Store 的记录，创建视频是 VideoEngine 的事务。幂等键是工作目录里的意图文件 `.baocut-binding.json`：选定项目目录之后、建目录之前写下它，崩溃后再试读到它就沿用同一个目录，不产生第二个项目；同一会话并发的调用合并成一趟。回合进行中绑定时，旧路径先换成指向项目目录的链接（Windows 是 junction），回合结束后删掉链接、把回合里新写的搬过去，并关掉原生会话，下一轮在项目目录里起（原生 CLI 按目录存会话，上下文会丢，与移动项目相同）。打开着的视频目录不搬（Windows 上改名会失败），留到下次启动。
- 启动时（客户端连上之前）收拾 `scratch/`：仍有会话、没有项目、目录里有视频的会话按上一条建项目并绑定；已经属于项目的会话留下的链接或目录清掉、剩下的东西搬进项目；没有对应会话的目录，有视频的把不隐藏的条目搬进「恢复的视频」项目（按界面语言命名，已有同名的沿用）再删掉，没有视频的直接删掉。一个目录出错不影响别的，记日志后下次再试。
- 新会话继续旧项目时，上下文来自其中视频的当前状态与 `VideoMemory`，不来自其他会话的聊天历史。
- 删除会话只删除 Runtime Store 中的会话记录与它在 `scratch/` 下的工作目录；工作目录里还有视频时先按上面的规则建项目搬进去再删。它不删除项目、视频、Artifact 或已提交的事务；仍被任务或授权审计引用的记录按保留政策处理。

### 3.11 Driver 的发现与健康

Driver ABI（§3.1）描述一个已经可用的智能体运行时。它是否可用，由 `DriverRegistry` 对每个已注册的 Driver 做探测后给出：

```ts
interface DriverStatus {
  driverId: string;
  state: 'ready' | 'not-installed' | 'outdated' | 'signed-out' | 'error' | 'disabled';
  version?: string;
  minVersion: string;                 // 低于它不开放，原因是机器协议不兼容
  latestVersion?: string;             // 只作提示；有新版本不影响使用
  executable?: string;                // 探测到的路径；用户可以指定
  account?: { plan?: string };        // 只有 Driver 自己报告的摘要，不含凭据
  models: Array<{ id: string; label: string; efforts?: string[] }>;
  detail?: string;                    // state 不是 ready 时的原因
  verified: boolean;                  // 可以开始会话（D08）；Driver 这一版的事实，不随本机的安装或登录变化
  tested: boolean;                    // 这个 Driver 本身在 BaoCut 里跑通过完整的真机会话
}
```

- **探测只读**。探测执行 Driver 自带的版本与状态命令，读取它的机器协议，不读取它的凭据文件，不解析终端屏幕。ACP 的 Driver 起一个临时进程做 `initialize` 与 `session/new`（不连工具、不调模型），从应答里读模型表；`session/new` 回「需要登录」（-32000）时记为 `signed-out`。Claude Code 的模型表要起一个不发消息的 Query 问 `supportedModels()`，比版本与登录状态两个短命令重得多：Driver 按可执行文件、版本与 `settings.json` 的修改时间在内存里记住它，不设时效，同一个 claude 在一个 Runtime 里只问一次，升级或改了设置后的下一次探测才重问；问不到时退回内置的精简表，失败不记。
- **结果按 Driver 缓存，没有时效**。每个 Driver 最近一次探测的本机事实（状态、版本、可执行文件与真实位置、账号、模型表、配置里的模型、最新版本、问题描述、探测时间，以及探测时用的用户指定可执行文件）存在 Runtime Home 的 `store/agent-probes.json`；名字、命令、最低版本、安装方式、`verified`、`tested`、能力这些 Driver 这一版的常量不存，读回来时由 Driver 补上（ACP 的能力来自 `initialize` 应答，读回来时先是保守值，后台探测完换成真实的）。Runtime 启动时先用上次的结果，同时在后台把每个 Driver 重新探测一遍。每个 Driver 独立探测、各自完成各自生效：完成一个就写进缓存、落盘，并在 `agents` 主题上推送新视图，慢的（ACP 智能体的冷启动可达十几秒）不拖累快的；探测失败记为这个 Driver 的 `error`，不影响别的；刷新期间旧结果照常显示。文件损坏、Driver 没有注册、条目的可执行文件与当前设置不一致时，那部分缓存作废。
- **什么时候重新探测**。只在这些时候，不做周期性刷新：Runtime 启动（后台一轮）；`agents.detect`（「重新检测」，强制，Driver 自己的模型表与登录缓存也不用）；用户改了某个 Driver 的可执行文件（只探那一个，旧结果立即丢掉）；应用内的安装或升级命令结束（只探那一个，§12.9）；运行中出了说明缓存过时的错——会话开始或回合以 `AGENT_AUTH_REQUIRED`、`AGENT_NOT_INSTALLED`、`AGENT_OUTDATED`、`AGENT_MODEL_UNAVAILABLE` 失败，或原生会话起不来（`driver-unavailable`）——以及缓存说不可用、回合却跑通了：Harness 在后台强制探测那个 Driver，不直接改写缓存里的状态，探测是唯一的事实来源。另有一条便宜的纠正：`agents.list` 与 `conversations.create` 时，Driver 结果不是 `ready` 且超过 60 秒没探过的，后台再探一次（探测要拉起智能体进程的不做：ACP、Pi、OpenCode，Driver 以 `slowProbe` 声明）；桌面界面在窗口重新获得焦点时拉一次 `agents.list`，用户去终端登录或安装后回来就能触发它。同一个 Driver 同时到来的探测共用一次；强制探测顶替进行中的普通探测，被顶替的结果丢掉。
- **`agents.list` 不等慢的探测**。有结果的 Driver 立即返回缓存；还没有任何结果的（首次启动、刚改了可执行文件），探测快的等它探完（首次启动 Claude Code、Codex 约 1 秒），要拉起智能体进程的（`slowProbe`：ACP、Pi、OpenCode）不等、列在 `AgentsView.checking`，探完经 `agents` 主题推送。`agents.detect { driverId? }` 强制探测（给了 `driverId` 只探那一个），探完才返回，返回前也推送一次。会话创建时校验模型与强度读缓存，不等探测（还没有结果时不校验）；发图片时判断 Agent 支持与否同样读缓存，只在经过集成测试的 Driver 还没有任何结果时等它。
- **推送**。`agents` 主题的快照就是 `agents.list` 的视图；每个 Driver 的探测完成，以及 Agent 偏好的任何变化（启用、默认模型与强度、可执行文件、放行策略、「总是允许」规则的增删、偏好设置里的默认 Agent `agent.defaultDriver`）都推送整份新视图（`agents.updated`），客户端整体替换。
- **登录在 Driver 自己的界面完成**。BaoCut 不接收、不保存智能体运行时的账号与密码；未登录时只给出登录的方式。运行中出现的认证失败与模型不可用是结构化的错误（`AGENT_AUTH_REQUIRED`、`AGENT_MODEL_UNAVAILABLE`），会话保留，补救之后可以继续。
- **安装与升级**是 §12.9 的受管安装动作，不是 Driver 的职责。
- **默认值**。默认 Driver、每个 Driver 的默认模型与推理强度属于偏好设置（§5.10）；会话创建时冻结自己的选择，之后改默认值不影响已有会话。模型与推理强度经 `RunContext` 交给 Driver，Driver 不支持的取值在创建会话时拒绝。
- **默认模型与推荐模型**（2026-09-29 用户裁决）。新会话没指定模型时依次取：这个 Driver 的 Agent 偏好里设过的默认模型、默认 Driver 的偏好设置 `agent.defaultModel`、推荐模型。推荐模型按这一版 CLI 自己的模型表次序取（`recommendedDriverModel`）：Claude Code 取第一个 id 含 `sonnet` 的，Codex 取第一个 id 以 `-sol` 结尾的（隐藏的模型不在表里），其余几家（以及表里没有这一系列时）取第一个标 `balanced` 的，再不然是 Agent 标的默认，再不然是第一个；模型表还没有时不传模型。这样默认不会随 CLI 配置落到 Opus、Fable 这类最贵的模型上。只有用户明确选了「Agent 默认模型」才不传模型、按 CLI 配置走：会话上是 `model: null`（`conversations.create` 显式给 `model: null`），偏好里是 `agents.configure { defaultModel: null }`，存成 `AGENT_DEFAULT_MODEL`（`__agent-default__`，偏好设置 `agent.defaultModel` 也认它）；存储里的 null 是没设过，旧文件里的 null 也按没设过、用推荐模型。设过的模型不在当前模型表里时新会话改用推荐模型。`DriverInfo.defaultModel` 是新会话起手的模型：设过的原样给出（不在表里也给，界面标成已不在模型表里），没设过是推荐模型，明确选了「Agent 默认模型」为 null。

- **用户添加的智能体**。`agents.addProvider { id, name, command, env? }` 把一个 ACP 智能体加进注册表：`command` 是启动它的 ACP 模式的程序与参数（不经 shell），`env` 是额外的环境变量。id 不能是内置 id，也不能与已有的重复（`conflict`，`AGENT_PROVIDER_EXISTS`）。列表存在 Runtime Home 的 `store/agent-providers.json`（`{ schemaVersion, providers: [{ id, name, command, env?, addedAt }] }`，权限 0600，串行原子写入；文件损坏或条目不合法时按没有处理），Runtime 启动时先注册它们再读探测缓存。加进来后立即在后台探测。`agents.removeProvider { id }` 只移除用户添加的（内置的以 `invalid-request`、`AGENT_PROVIDER_BUILTIN` 拒绝）：用着它的进行中的任务以失败结束、原生会话关闭，它的 Agent 偏好、探测缓存，以及指向它的 `agent.defaultDriver` 一并清掉；之后往这些会话发送以 `driver-unavailable` 拒绝，会话本身保留。两个方法都返回新的 `AgentsView` 并推送。视图里每个 Driver 带 `source`（`builtin` 或 `custom`）；用户添加的另带 `custom`（命令、环境变量的名字与添加时间），环境变量的值不出 Runtime。这两个方法不对浏览器与对外服务开放。与 `agents.configure` 分开，是因为后者只改已注册的 Driver 的偏好，而它们改的是注册表本身与能执行的命令。

`agents` 命名空间为此提供 `list`、`detect`、`setDefault`、`configure`、`addProvider`、`removeProvider`；`setDefault` 只接受已注册的 Driver。多个 Driver 的开放程度仍按 D08：未经集成测试的 Driver（`verified: false`）只显示探测结果，不能用来开始会话，发送时 Harness 以 `driver-unavailable` 拒绝。一份共用的协议实现（如 ACP）有一个智能体在真机上跑通完整会话，就算这份实现经过验证（ACP 的验证经过见 §3.1）：用它的其他预设与用户添加的智能体都能开始会话，没有以自家智能体亲自跑通的（`tested: false`）在界面上标「未在 BaoCut 实测」，不拦截。

### 3.12 访问模式

访问模式是 Agent Harness 的权限设置，决定智能体的动作在什么情况下需要用户确认。每个会话有自己的访问模式，随时可以切换，对之后的动作生效：

| 模式 | 名称 | 行为 |
| --- | --- | --- |
| `ask` | 逐项询问（监督） | 执行命令或修改文件、视频之前都先征求许可 |
| `autoAcceptEdits` | 自动接受修改 | 工作目录内的文件与视频的修改自动批准；其他动作先询问 |
| `auto` | 自动（默认） | 常规动作自动批准；高风险动作仍然询问 |
| `fullAccess` | 完全访问 | 不再逐次确认 |

`plan`（先给方案）是另外一档：只读，修改一律拒绝（工具返回 `PLAN_ONLY`），智能体说明打算怎么改，等用户切换模式。它和四档共用同一个字段与同一张决策表。

**没有逐次审批通道的 Driver 只能用 `fullAccess`**。探测结果（没有时用 Driver 声明的能力）里 `capabilities.approvals` 为 `false` 的 Driver 不会来问，BaoCut 无从执行别的模式。建会话、切换会话的模式时显式给出别的模式，以及发送时生效的模式（显式给出的、会话的或设置里的）不是 `fullAccess`，都以 `conflict` 拒绝，`details` 带 `code: 'AGENT_ACCESS_MODE_UNSUPPORTED'`、`driverId`、`mode` 与 `supportedModes: ['fullAccess']`；不建任务，也不替用户改模式。

**风险等级**。每个待批准的动作先得到一个风险等级：

| 等级 | 含义 | 例子 |
| --- | --- | --- |
| `read` | 只读 | 查询类工具；不经过审批 |
| `edit` | 可撤销的修改，结果留在工作目录或视频里 | 视频的编辑与撤销、新建视频、导出、把产物存为新文件、本机模型的生成、工作目录内的文件修改 |
| `command` | 执行命令，或把数据交给已经授权的服务 | Driver 的命令、取消任务、交给已启用的在线或节点 Provider 的生成 |
| `high` | 高风险 | 越出沙箱或工作目录、不可撤销的覆盖、需要新授权的数据外发与付费调用（§12.5） |

**决策表**。模式 × 风险得出自动允许、询问或拒绝；`read` 在任何模式下都直接执行：

| 模式 | `edit` | `command` | `high` |
| --- | --- | --- | --- |
| `plan` | 拒绝 | 询问 | 拒绝 |
| `ask` | 询问 | 询问 | 询问 |
| `autoAcceptEdits` | 允许 | 询问 | 询问 |
| `auto` | 允许 | 允许 | 询问 |
| `fullAccess` | 允许 | 允许 | 允许 |

`plan` 下命令仍然询问而不是拒绝：Driver 在只读沙箱里也需要运行查看类的命令，由用户逐条决定。

**BaoCut 工具的风险**（§3.5）：

| 工具 | 风险 |
| --- | --- |
| `edits_apply`、`edits_undo`、`captions_create`、`videos_create`、`export` | `edit`；`export` 覆盖已有文件时 `high` |
| `artifacts_save` | 存为新文件 `edit`，覆盖已有文件 `high`。路径先检查，不合法的直接拒绝，不生成审批 |
| `speak`、`image` | 本机模型是 `edit`（结果是候选素材或产物，不改时间线，可以删掉）；交给已配对的节点、或有 Grant 覆盖这次外发的在线与智能体 Provider 是 `command`；启用了但没有 Grant 覆盖（没有、已撤销或到期、金额上限估不出）的外发是 `high`，审批带上要授权的数据（§12.5）。覆盖它的 Grant 额度用完时在审批之前就以 `BUDGET_EXCEEDED` 拒绝，任何模式都一样。Provider 没有启用或解析不到时按 `command`，提交时以 `CAPABILITY_NOT_CONFIGURED` 拒绝，数据不外发 |
| `grants_request` | `high`：一次申请这个任务要用的几项外发（每项是能力、Provider、视频、次数与用途），合并成一条审批（§12.5）。`surfaces` 只有 `agent`，MCP 服务与 CLI 都没有它 |
| `jobs_cancel` | `command` |
| `downloads_save` | `command`：写的是工作目录以外的新文件，`autoAcceptEdits` 下照样询问；但只进下载目录、不覆盖（重名加序号），与 `download` 把下载的新文件放进下载目录同级，不是 `high` 的越界写入或不可撤销的覆盖。路径先检查，不合法的直接拒绝，不生成审批 |
| `tasks_contract`、`tasks_update_contract`、`tasks_record_check` | 不确认，`plan` 下也可用：只读写这个任务自己的合同与检查结果，不碰视频、不外发；改动记为智能体的修订，用户能看到；不能改的字段以 `CONTRACT_FIELD_READONLY` 拒绝（§3.2）。只给会话里的智能体，不在 MCP |
| （`jobs.reconcile`） | 不是工具，按 `high` 只由用户决定（§7.5）：`retry` 是一次新的外发调用（新的预留，可能再次计费），`discard` 放弃一个可能已经计费的结果，`apply` 写用户的视频。智能体在 `jobs_inspect` 里看得到 `needs-reconciliation`、`applications` 与 `cancellation`，`next` 让它告诉用户 |
| `transcribe`、`translate`、`dub`、`transcode` | `command`：启动固定流程（§7.9）；外发授权由流程检查，没有覆盖时以 `GRANT_REQUIRED` 拒绝，确认里不代发授权。`transcribe` 给 `url` 时按 `download` 确认 |
| `download` | 用已同意的 yt-dlp 下载是 `command`（执行用户已同意的工具，不外发视频或文稿，结果是下载目录里的新文件；只给 `project` 的下载与对外服务的下载在归属项目的 `downloads/` 里）；`newVideo` 新建视频不提高风险（新建视频是 `edit`）。还没有 yt-dlp 时改为审批 `external_tools_install`（`high`：下载并执行第三方程序，审批摘要带来源、版本、大小与许可）；同意没有或撤回过时审批 `external_tools_consent`（`high`）。链接不合规、严格离线、工具不能下载时直接拒绝，不生成审批（§7.9、§12.9） |
| 其余查询工具 | `read` |

「是否已授权」由 `GrantService.plan` 得出（§12.5）：按这次调用外发的数据种类、接收方、视频与任务匹配 Grant，并检查额度，不预留；本机模型与已配对的节点不需要 Grant。启用在线 Provider 时发放一条默认的持续 Grant（§6.8 的迁移规则），所以之前「启用即可用」的调用风险不变；用户撤销它之后，这类调用回到 `high`。

**带外发的审批**。`high` 的模型工具审批带 `grants`（`GrantRequestItem`：能力、数据种类、接收方、视频、用途、为什么要授权、费用状态与估算）。`approvals.respond` 允许时可以带 `grant`（`ApprovalGrantChoice`）：不给或 `{ persist: false }` 是「只这一次」，发放一条只覆盖这次调用、金额未知的 Grant；`{ persist: true, scope?, maxCalls?, budgetCap?, expiresAt? }` 同时发放一条持续 Grant（默认只覆盖这个视频）。带外发的审批没有「这个任务里不再问」：`accept-for-session` 与 `forSession` 对它不生效，会话里已经免问的同名工具遇到没有覆盖的外发也照样询问。不带外发的审批给了 `grant` 时以 `invalid-request` 拒绝。`fullAccess` 下审批自动允许，同样只发放「只这一次」的 Grant；它免除的是确认，预算照样生效（额度用完的在任何模式下都是 `BUDGET_EXCEEDED`）。CLI：`baocut approvals` 列出审批里要授权的数据，`baocut approvals allow <id> --persist [--scope all] [--max-calls N] [--budget 金额 --currency 币种] [--expires 时间]` 允许并发放持续 Grant。

**由 `ApprovalService` 执行**。它在 Harness 里，会话与对外服务（§4.8）共用：

- 会话里的 Driver 审批与 BaoCut 工具调用都先查表。自动允许或拒绝的在会话里留一张已决定的审批卡（`decidedBy: 'auto'`）；要询问的放一张待处理的审批卡，同时进统一的待处理列表，等用户处理。
- **会话审批没有时限**，用户处理、停止任务、停止回复（`agents.interrupt`）或任务结束时才结束；停止与打断把待处理的一律取消，Driver 收到取消，等待中的工具调用返回 `APPROVAL_CANCELLED`。拒绝返回 `APPROVAL_DENIED`（带 `mode` 与 `risk`，说明是用户拒绝的还是模式不允许）。服务审批有时限（§4.8）。
- **一处列出全部待处理的审批**：`tasks` 主题的快照带 `approvals`（`PendingApproval`：主体是会话或服务与客户端，动作、目标、摘要、风险、依据的模式或服务等级、到期时间），出现与结束发 `approval.upsert` 与 `approval.removed`；`approvals.list` 与 `approvals.respond { approvalId, decision: 'allow' | 'deny' }` 读取与处理。原有的入口照常可用，处理的是同一条：会话审批用 `agents.respondToApproval`，服务审批用 `services.respondToApproval` 与 `services` 主题。
- CLI：`baocut approvals` 列出待处理的会话与服务审批，`baocut approvals allow|deny <id>` 处理一条；`baocut chat --mode ask|auto-accept-edits|auto|full-access|plan` 切换会话的模式，回合里遇到审批时在终端里问。
- `agents.respondToApproval` 的 `accept-for-session` 对 Driver 原样转交；对 BaoCut 工具是「这个任务里同一个工具不再问」，只在内存里，任务结束即失效。

**Driver 的审批按同一张表**。Driver 报告的动作这样定风险：工作目录内的文件修改是 `edit`，有任何文件在工作目录之外是 `high`，命令是 `command`；Driver 说明这个请求是越出沙箱的升级时（Codex 在 `on-request` 策略下来问的都是）是 `high`。Driver 自带的权限设置按模式给出，两边不一致时取更严的一方：Driver 不来问的动作 BaoCut 无从拦截，所以 Driver 侧不能比 BaoCut 的模式更宽。Codex 的映射：

| 模式 | `approvalPolicy` | `sandbox` | 说明 |
| --- | --- | --- | --- |
| `plan` | `untrusted` | `read-only` | 只读沙箱，不可信的命令都来问 |
| `ask`、`autoAcceptEdits` | `untrusted` | `workspace-write` | 命令与文件修改都来问；`autoAcceptEdits` 下工作目录内的修改由 Harness 自动接受 |
| `auto` | `on-request` | `workspace-write` | 沙箱内直接执行，越出沙箱时来问（`high`，交给用户） |
| `fullAccess` | `never` | `workspace-write` | 不来问；沙箱仍然生效 |

BaoCut 工具经 Codex 的 MCP 调用会等审批，Codex 默认 60 秒就放弃一次工具调用，所以会话给 BaoCut 的 MCP 服务配置 `tool_timeout_sec` 为一天。

**切换**。会话记录上的 `accessMode` 是这个会话切换过的模式，`null` 表示跟随偏好设置 `agent.defaultAccessMode`（§5.10，默认 `auto`）。

- `conversations.update { accessMode }` 切换，`null` 回到跟随设置；`conversations.send` 显式给出 `accessMode`（旧名 `autonomy`）等于先切换再发送。不给时用会话的模式，会话没有切换过时用设置。
- 切换立即作用于之后的动作，任务进行中也是：BaoCut 工具调用与 Driver 的审批按新模式查表，已经在等用户的审批不变。Driver 自带的权限设置要到下一次建立原生会话（下一条消息）时才换。
- 生效的模式变了时，会话里记一条提示（`notice`，带 `modeChange { from, to }`）；会话还没有任何内容时只记在会话上。

**记下动作发生时的模式**。任务卡片带 `autonomy { mode, source }`（`source`：`request` 发送时给出、`conversation` 会话切换过的、`setting` 来自设置、`default` 内置默认）；审批卡带 `risk`、`mode` 与 `decidedBy`（`auto` 或 `user`）；BaoCut 工具的结果带 `approval { mode, risk, decidedBy }`。这些都在 Runtime 记录里，不进视频的回执，引擎不需要知道模式。

**旧值**。早期版本的三档（`plan`、`controlled`、`authorized`）按 `controlled` → `ask`、`authorized` → `fullAccess` 换成新值：协议参数（`conversations.send` 的 `autonomy` 与 `accessMode`、`conversations.update`、`settings.set`）照收旧值；设置文件与会话记录里存着的旧值在读取时换掉；Runtime 发出的一律是新值。旧界面（桌面界面与挂载同一套界面的 Web 客户端）每次发送都带三档之一的 `autonomy`（输入框里选，默认 `controlled`），所以它发过消息的会话固定为 `plan`、`ask` 或 `fullAccess`，到不了 `autoAcceptEdits`、`auto` 与跟随设置。

- **高风险的定义不随模式放宽到没有**：除 `fullAccess` 外，`auto` 下仍然询问的动作包括项目目录之外的写入（下载目录里新建文件除外：`download`、`downloads_save` 是 `command`）、删除视频或项目、不可撤销的覆盖、需要新授权的数据外发与付费调用（§12.5）。
- **模式不是授权**。任何模式都不授予数据外发、预算、声音克隆或公开发布的权限，这些仍由 Grant 逐项给出；`fullAccess` 只免除逐次确认，不改变保护范围与版本校验，也不改变 §12.4 关于隔离的说明。

---

## 4. 业务协议

### 4.1 一个公共 SDK，一个业务入口

`@baocut/client` 暴露这些命名空间：

| 命名空间 | 内容 |
| --- | --- |
| `videos` | 视频的创建、打开与按范围读取 |
| `timeline` | 按序列、时间范围与对象类型读取时间线 |
| `speech` | 在文稿中检索词、句与 occurrence |
| `edits` | 编辑事务：提案、批量预检、提交与撤销 |
| `code` | 代码包的构建、发布与检查 |
| `conversations` | 会话的创建、列表、消息、绑定与归档 |
| `tasks` | 任务合同、停止、状态 |
| `agents` | Driver、会话、审批 |
| `models` | 能力目录、Provider 配置、本地模型 |
| `jobs` | 步骤状态、取消、对账 |
| `artifacts` | 产物查询与资源句柄 |
| `previews` | 取帧、检查、预览会话 |
| `exports` | 导出草稿、创建、状态 |
| `space` | Space 目录的查询、整理与二次编辑入口 |
| `projects` | 项目的登记、打开、重命名、置顶与归档 |
| `library` | 用户库：术语表、音色、品牌库（§5.9） |
| `settings` | 偏好设置（§5.10） |
| `services` | 对外服务的开关、配置与状态（§4.8） |
| `nodes` | 局域网节点的发现、配对与本机共享（§6.7） |
| `externalTools` | 受管外部工具的状态与安装动作（§12.9） |
| `catalog` | Agent 面的工具目录（§3.5）：`list` 列出工具（参数的 JSON Schema、说明、注解与风险）与接口版本，`call` 以终端主体（`LocalPrincipal`）按名调用。只给 `cli` 与 `desktop` 连接，不在 Web 服务的白名单里 |

界面、CLI 与外部智能体统一发送 Command、Query 和 Subscription。Renderer 到本机 socket 或 pipe 可以经 Electron IPC 转发，但不因此增加另一套业务 API。

命令信封、命令表面与错误合同见命令与协议规范。

### 4.2 可信身份

公共请求不得携带 `actor`、`trusted=true` 或任意的 `budgetApproved`。Runtime 从已认证的连接构造 `TrustedPrincipal`，并把 `commandId` 映射为视频内的 `idempotencyKey`。`transactionId`、`actor`、可用权限和 `runGeneration` 由服务端确定。

同一个 video / key / payloadHash 返回同一份回执；用同一个 key 提交不同的 payload 必须被拒绝。

### 4.3 命令与内部引擎合同

`VideoService.execute()` 是公共的写入口。授权之后转发给私有的 `VideoEngine.applyTransaction()`。Engine 再做版本、锁定、领域规则和资源可用性检查，并在原子提交之后返回回执。Node 不做「先验版本、稍后盲写」这种存在检查后使用竞态的流程。

读请求要么指定版本，要么取 latest；长任务必须先拿到冻结的 `snapshotRef` 再执行。只有明确的管理导入与恢复命令允许整份快照替换；普通的界面与智能体不能提交任意路径的 JSON Patch。

### 4.4 事件、快照与重连

每个视频事件包含 `videoId`、`eventSeq`、`videoRevision`、`transactionId`、`changedIds` 和可以直接消费的投影变化。`eventSeq` 与视频版本在 VideoStore 中持久化；Runtime epoch 只标识服务的运行代。会话序号、Job 序号与视频事件序号分别管理，不共用一个含糊的游标。

- 订阅必须取得同一水位的快照与其后的事件。
- 视频变更与 outbox 在同一事务中落盘。Runtime 从已提交的 outbox 推送，允许至少一次投递，由客户端按 video / eventSeq 去重。
- Runtime 在提交之后、广播之前崩溃，不得丢掉已确认编辑的恢复路径。
- 客户端发现序号缺口时暂缓提交，补事件或重取快照；不能在缺事件的镜像上继续修改。
- 候选与界面的临时手势单独保存；重连失败不得用旧的全量快照覆盖服务端。

### 4.5 控制通道与媒体通道分离

WebM 播放通过 `media.playback { url, playable? }` 取播放地址：`url` 必须是当前媒体通道已签发、未过期的受限句柄，不能用本机路径或其他来源的 URL。`playable` 是客户端按 `canPlayType` 测出的、能原生解码的 WebM 编码（`vp8`、`vp9`、`av1`、`opus`、`vorbis`）；Runtime 用 ffprobe 探测源文件首条画面与声音的编码（按源身份记住），都在其中时直接回原句柄，不做副本、不必等待（Chromium 与 Electron 走这条）。否则准备兼容副本：Runtime 再检查源文件真实路径，在 `<home>/cache/media/playback/` 按源真实路径、大小、纳秒 mtime 与编码配方修订生成 H.264/yuv420p + AAC MP4。最长边不超过 1280，保持比例与源时间，音轨存在时保留；无声视频和纯音频 WebM 同样支持。后台单槽编码、重复申请合并、校验可解码后原子发布；源变化重建，失败不发布半成品，Runtime 关闭时停止子进程。缓存只用于播放，项目素材、下载与导出仍引用原文件。

副本未就绪时立即返回 `{ status: 'pending', retryAfterMs: 250, progress? }`（`progress` 是按 ffmpeg 报的输出时刻除以探测到的源时长得出的 0–1，探测不到时长时省略），完成返回 `{ status: 'ready', media: MediaHandle }`，失败沿用已有媒体错误。客户端以短请求轮询，不把整片编码挂在一条 RPC 上；独立播放器、聊天中的媒体预览和编辑器素材地址共用准备流程，保留已有的定位、音量、倍速和暂停语义。Electron 与 Web 共用同一 UI；Web 用自己的受限句柄表与同源地址，只读模式也可生成派生缓存。非 WebM 与客户端能原生解码的 WebM 直接复用原句柄。尚未发送附件的 `blob:` / `data:` 地址留在浏览器中，不请求 Runtime 转换或上传。`media.resolve` 与 `?download=1` 始终提供原始 bytes。

每个客户端到每个 Runtime 一条多路复用的业务 WebSocket；视频、会话和任务按资源订阅。视频与音频的 bytes、预览帧和缩略图经过认证的 HTTP Range、受限句柄或专门的媒体通道传输，不把每一帧的 Base64 塞进对话事件。小于 1 MB 的单张缩略图可以走请求的响应（时间线胶片条的 `media.thumbnail`、Space 卡片的 `space.thumbnail`，§5.7）：客户端按需请求，不进事件流，也不随订阅推送。

`media.resolve` 在 `resolveInside` 的真实路径与权限检查之后，读取至多 64 KiB 前缀识别内容类型。目标是视频条目（`{ entryId }`，视频是一个目录）时，给它的主素材：封面那一帧所在的素材版本，与 Space 缩略图同一个来源，不打开视频、不取写锁；它是素材原片，没有套用时间线上的剪辑、字幕与叠加，会话里的视频卡就地播放用（产品设计 §3.2.2）；没有封面时 `not-found`。`MediaHandle` 可附带 `contentKind`（text/image/pdf/audio/video/archive/binary）与 `textEncoding`（UTF-8、带 BOM 的 UTF-16LE/BE），HTTP MIME 与检测结果一致；字段缺省时旧客户端行为保持兼容。压缩包只认头部，不为预览解压。文本载入时再次限制实际接收字节数，并以严格解码拒绝截断编码或后续出现的二进制控制字符；媒体依然走受限 Range 通道，采样不扩大可读目录。同一受限句柄的 `?download=1` 返回带 UTF-8 文件名的附件响应，下载大视频直接走流式传输，不先把完整文件读进界面内存。

播放时钟和拖动留在界面本地。`requestGeneration` 保证旧的异步帧不会覆盖新的 seek。流式文本可以合并小块，但保留消息身份与完成边界；终态事件和权限事件不可因节流而丢失。客户端可以显示缓存，但「已连接」不等于「数据已追平」。

### 4.6 ContextBarrier：发送前同步

用户提交自然语言请求之前，建立显式的读后写屏障，保证「我刚改的内容，智能体看得到」。

```text
用户提交请求
  → 捕获选区，以及相关的 pending commandId 与文本编辑会话
  → 结算已经结束的相关手势和可提交的文本
  → 等待这些命令的持久回执，或返回失败 / 冲突
  → 把本窗口相关的视频投影追平到所需水位
  → 从 Engine 取得该版本的上下文快照与 occurrence 引用
  → 绑定 ContextSelection，再启动 Task / Turn
```

屏障返回：

```ts
interface ContextBarrierResult {
  contextSnapshotRef: Id;
  videoRevision: Revision;
  eventSeq: string;
  includedCommandIds: Id[];
  selectionHash: string;
  candidateRef?: Id;        // 引用的是候选而非工作稿时必须显式给出
}
```

规则：

- 屏障只等待本次请求所依赖的本地修改，不无限等待其他窗口或后台的全部工作。
- 正在进行且不能安全结束的手势、输入法组合文本：提示等待、取消发送或明确排除。不得为了发送消息而偷偷提交半个拖拽。
- 命令失败时，不得发送看似成功的旧上下文。
- 屏障解决的是「读到自己的写」，不取消其后的版本检查：另一个窗口随后提交时，智能体的结果仍然要对照最新版本检查。
- 不涉及视频的纯聊天可以不建立屏障。
- 屏障对 Home 与 Space 两个入口的请求同样适用。

界面行为见产品设计 §3.2.4。

### 4.7 时间输入属于业务合同

界面与智能体不自行算帧。

- 视觉时间命令接受 `TimelineTimeInput`：`seconds` 与 `frames` 互斥；`sequenceId` 与 `expectedRevision` 确定所属的网格。
- 词、句、occurrence 锚点是口播与语义编辑的优先输入。
- Runtime 负责认证与转发；Rust 统一解析、映射、量化，并返回 `TimeQuantizationReceipt`。
- 协议区分请求的格式化值、规范的精确时间和实际的帧坐标。只含裸 frame 而无法确定 Sequence 与 Rate 的命令一律拒绝。
- 修改输出帧率使用 `exports.create` / `exports.updateDraft` 的 `ExportSettings`；修改编辑帧率使用带影响报告的 `changeSequenceFrameRate`。两者不共用一个含糊的 fps 更新接口。

类型定义见视频格式规范 §2 与命令与协议规范 §6。

### 4.8 对外服务

本机网关（§4.1、§12.2）服务的是 BaoCut 自己的界面、CLI 与它启动的智能体。**对外服务**是 Runtime 向其他程序与设备开放的入口，由 `ServiceManager` 统一管理：

| 服务 | 面向 | 监听 | 内容 |
| --- | --- | --- | --- |
| `mcp` | 其他应用里的智能体 | 本机回环 | 工具目录里 `surfaces` 含 `mcp` 的工具（§3.5）：读视频与取帧、新建视频、改文稿与译文、剪片段、建字幕层、启动转录 / 翻译 / 配音 / 导出 / 从链接下载、合成语音与生成图片、导入与预览代码画面、只读地查 skill 与用户库 |
| `model-api` | 支持 OpenAI 接口的程序 | 本机回环 | 用本机已经配置好的模型能力转写、合成语音、生成图片与文本 |
| `web` | 本机浏览器 | 本机回环 | Web 客户端与它连接的网关入口 |
| `node` | 局域网里的其他 BaoCut | 局域网 | 能力共享（§6.7） |

**统一的生命周期**。每个服务有同一组状态 `off`、`starting`、`on`、`stopping`、`error`，默认 `off`，由用户显式开启。配置（是否随 Runtime 启动、端口、访问策略、已发放的客户端）持久化在 Runtime Home 的 `store/services.json`（0600，临时文件加改名写入），启动时恢复；端口被占用时进入 `error` 并说明原因，不换一个端口悄悄启动，也不影响 Runtime 启动。服务随 Runtime 停止（§2.4），停止顺序里排在任务之前。`services.list`、`services.start`、`services.stop`、`services.configure` 管理它们；状态变化经 `services` 主题送达，Rail 上的角标读它。节点服务已有的 `nodes.share.*` 是这组方法在节点服务上的专用形式：节点服务的状态只有 `NodeService` 一个来源，`services.*` 读到的是它的投影，端口、能力与配对仍用 `nodes.share.*` 配置。这个版本四个服务都提供；以后某个版本或平台不提供的服务照样列出，状态为 `off`，开启时以 `SERVICE_NOT_AVAILABLE` 拒绝。

**服务主体**。外部请求没有会话，也没有 TaskContract。Runtime 为每个通过认证的外部连接构造 `TrustedPrincipal { kind: 'service', serviceId, clientId }`，之后的写入以 `external:<serviceId>` 为 `actor` 进入同一个命令入口：同样的版本校验、保护范围、撤销与回执（§4.2、§4.3）。`actor.kind` 沿用 `agent`（引擎的操作者种类不变），`actor.id` 为 `external:<serviceId>`。外部请求不能冒充界面连接，也拿不到本机网关的令牌：服务主体只由对外服务的认证构造，网关的 `hello` 不能声明它。外部提交的 Job 记 `submitter: { kind: 'service', id: <serviceId>, clientId }`（§7.9），一个客户端只看得到自己提交的 Job 与它们的产物。Web 服务是例外：浏览器里操作的是用户本人，不是外部程序，它的主体是 `{ kind: 'web', sessionId }`，写入的 `actor` 是 `user_local`（与桌面界面相同，共用撤销栈），Job 与桌面界面一样按连接提交；版本校验、保护范围、撤销与回执不变。`web` 主体同样只由服务的认证构造，`hello` 不能声明。

**访问策略**取代 TaskContract 在权限检查里的位置（§3.5 最后一条），由三部分组成：

- **范围**：可以访问哪些视频，全部或一份 `videoId` 名单，只在已登记的项目里。范围之外的视频对这个服务不存在：列表里没有，按 ID 访问返回「不存在」而不是「无权限」，也不会因此被打开或生成审批。默认是全部视频。
- **操作等级**：`read`（只有查询：目录里只露 `readOnlyHint` 的工具）、`ask`（写入、任务与生成在 BaoCut 里逐次确认）、`auto`（直接执行）。等级不够的工具不出现在目录里，而不是调用时才失败。默认是 `ask`。
- **确认**：`ask` 下的请求生成一条服务审批，显示调用方、工具、目标视频与参数摘要，由用户在 BaoCut 里允许或拒绝；审批有时限（50 秒，比常见 MCP 客户端 60 秒的请求超时短，调用方能收到明确的拒绝），超时按拒绝处理。服务审批由会话共用的 `ApprovalService`（§3.12）产生，依据是服务等级与工具的风险（§3.12 的工具风险表）；它没有会话可挂：待处理的审批是 `services` 主题快照的一部分，用 `services.respondToApproval` 回答，同一条也出现在 `tasks` 主题的统一列表里（主体为服务与客户端），用 `approvals.respond` 回答是一回事。拒绝、超时与取消（服务停止或调用方断开）都以 `SERVICE_APPROVAL_DENIED` 回答调用方。

数据外发与预算仍然另行检查：外部请求触发在线 Provider 时，要求该 Provider 已由用户启用（§6.4），并且有 Grant 覆盖这次外发（§12.5）。访问策略里的 `auto` 不等于对任何在线调用的授权：`auto` 下没有 Grant 覆盖的外发直接以 `GRANT_REQUIRED` 拒绝（带补救），不生成审批；`ask` 下它是一条 `high` 的服务审批，带上要授权的数据，允许时按 `approvals.respond` 的 `grant` 发放（§3.12）。额度用完时两种等级都在审批与提交之前以 `BUDGET_EXCEEDED` 拒绝。MCP 工具与模型接口服务的路由检查之后才轮到这一步。

**对外的名字是合同。** MCP 的工具名与参数、模型接口服务的路径、CLI 的命令与 Skill 的名字一旦被别的程序使用，改名就是破坏性变更。它们一律使用术语表里的名字（可编辑的实体是 `video`，目录是 `project`），不沿用原型或旧版的叫法；每个服务在握手或元数据里报告自己的接口版本，破坏性变更升版本。

**MCP 服务**与智能体的工具桥（§3.5）共用同一个工具实现与 MCP 端点代码，区别只在主体：工具桥的令牌绑定到一个会话与它的 TaskContract，MCP 服务的连接绑定到服务主体与访问策略。两者的差别收在同一个范围接口里（会话的来源目录与 TaskContract，或服务的访问策略），工具本身不分来源。耗时的工具立即返回 `jobId`，状态用查询工具读取。MCP 服务监听 `127.0.0.1`，默认端口 47620；它是无状态的 Streamable HTTP 端点，每个请求单独认证。开放的工具由目录项的 `surfaces` 推出，含 `mcp` 的才开放；协议常量 `MCP_SERVICE_TOOL_NAMES` 列出同一份（名字、标题与 `effect`），测试核对两者一致，界面的工具清单读它。查询是 `videos_list`、`videos_inspect`、`videos_history`、`documents_read`、`edits_ops`、`models_capabilities`、`models_list`、`jobs_inspect`、`jobs_wait`、`jobs_list`、`projects_list`、`space_list`、`space_search`、`skills_list`、`skills_read`、`library_list`、`library_show`（Space 条目与跨视频检索只看访问策略范围之内的视频、由它们生成或导出的条目，任务产物只看自己提交的）；写入、任务与生成是 `videos_create`（必须给 `project`，建在那个已登记的项目里；访问策略是视频名单时，新视频写进名单）、`edits_apply`（剪片段、改文稿与译文、导入项目里的素材）、`documents_put`、`assets_import`（素材只能是项目目录里的文件）、`edits_undo`、`captions_create`、`videos_frames`（帧写进视频所属项目的 `exports/.baocut-out/frames/<videoId>/`）、`compositions_import`（导入代码画面：验证、烘焙预渲染、导入两个素材并放一个合成片段，两笔可撤销的修改；`path` 只能是项目目录里的目录）、`compositions_preview`（预览代码画面：按合成的局部时间取帧，帧写进视频所属项目的 `exports/.baocut-out/frames/<videoId>/`；`path` 同样只能在项目目录里）、`transcribe`、`translate`、`dub`（给 `video`；`file`、`outDir` 以 `INVALID_ARGUMENTS` 拒绝，`next` 指向 `video` 与 `url`；`transcribe` 给 `url` 时与 `download` 同样的落点规则）、`speak`、`image`、`export`（导出字幕、文稿、音频与成片；文件只能写进视频所属项目的 `exports/` 及其中已有的子目录）、`download`（从链接下载，落点只能是范围之内的已有视频 `video` 或已登记的项目 `project`，文件放进归属项目的 `downloads/`（§7.9）；`newVideo` 要同时给 `project`（与 `videos_create` 相同），流程新建的视频在父任务记下它时登记进服务的范围（访问策略是视频名单时写进名单），之后 `videos_list`、`videos_inspect` 看得到；不给落点、`newVideo` 不给 `project` 以 `INVALID_ARGUMENTS` 拒绝，`next` 指向 `projects_list` 的 `projectId`；下载进的已有视频时间线还空着时素材同时放上主轨，§7.9；yt-dlp 没有安装或用户没有同意使用时直接拒绝，不代为安装或同意，§12.9）、`jobs_cancel`（只取消自己提交的任务）、`jobs_retry`（只重跑自己提交的流程）。等任务用 `jobs_wait`（一次最多 50 秒，没等到就再调，§3.5），不反复轮询 `jobs_inspect`。`surfaces` 不含 `mcp` 的不开放：删除视频（`videos_delete`）、把产物写成文件（`artifacts_save`）、复制到下载目录（`downloads_save`）、打开便携包（`videos_import_package`）、文件转码（`transcode`，只有本机文件这一种输入）、安装与检查本地模型包（`models_install`、`models_test`）、新建项目（`projects_create`）、申请授权（`grants_request`）与任务合同的工具。接口版本在 `initialize` 的 `serverInfo.version` 与 `_meta['baocut.interfaceVersion']` 里报告，现在是 `2`：开放清单改为按 `surfaces` 推出，并且改了名，`models_transcribe` → `transcribe`（固定流程形态）、`exports_create` → `export`、`link_import_start` → `download`、`skill_read` → `skills_read`、`models_synthesize_speech` → `speak`、`models_generate_image` → `image`，旧名不保留。之后新开放的工具（`videos_frames`、`videos_history`、`documents_put`、`assets_import`、`edits_ops`、`jobs_wait`、`jobs_list`、`jobs_retry`、`models_list`、`projects_list`、`skills_list`、`library_list`、`library_show`、`compositions_import`、`compositions_preview`）只是增加，不升版本。

**接到外部 Agent**。`baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <客户端名>] [--yes]`（CLI 管理桶）一次做完接入：先读宿主的 MCP 配置，已有 `baocut` 条目又没给 `--yes` 时拒绝，不发令牌；再把 MCP 服务设为随 Runtime 启动（给了 `--level` 时一并改等级，不给不改，服务默认 `ask`）并开启；为这个宿主新建一个客户端（名字默认是宿主名）拿到令牌，`services.mcp.connectionInfo` 取地址，写进宿主的用户级 MCP 配置（条目名 `baocut`），提示重启宿主。Runtime 里还没有任何已登记项目时（新装、没开过 App），在发令牌之前登记默认项目目录下的 `CLI` 项目（`projects.open`，与终端没有项目时新建视频用的同一个），结果的 `defaultProject` 写明：对外服务新建视频必须给已登记的项目，没有项目时外部 Agent 无处可建。写配置失败时吊销刚建的客户端；`--yes` 替换了已有条目时，从旧条目的令牌认出它用的客户端（令牌的前段就是 `clientId`），新条目写好后吊销它并在结果里写明，认不出（例如手写的令牌）时才列出同名的客户端让用户处理。令牌的去向按宿主：Claude Code 放进它 `settings.json` 的 `env`（`BAOCUT_MCP_TOKEN`），`.claude.json` 的条目只写引用 `Bearer ${BAOCUT_MCP_TOKEN}`（PATH 上有 `claude` 时经 `claude mcp add --scope user --transport http` 写）；Codex（`config.toml` 的 `[mcp_servers.baocut]`，`url` + `http_headers`）、Cursor（`~/.cursor/mcp.json`）、Gemini CLI（`~/.gemini/settings.json`）没有可用的环境变量段，令牌明文写在配置里（安全处理见 §12.8）。服务只在 Runtime 开着时可用。`baocut mcp status` 列服务状态、地址、客户端与各宿主有没有这一项，不显示令牌。

**模型接口服务**把 OpenAI 形状的请求映射为一次没有视频的能力调用（§7.9）：转写、合成、生图与文本生成分别进入对应的能力，每个请求是一个 Job（`submitter: { kind: 'service', id: 'model-api', clientId }`，`videoId: null`），它的记录与产物就是这次调用的生成记录；Job 终结后结果直接作为响应返回。它监听 `127.0.0.1`，默认端口 47621，按客户端发放令牌（与 MCP 服务的令牌各自一套，互不通用；共用同一份客户端与令牌的实现，管理方法是 `services.modelApi.*`，与 `services.mcp.*` 同形）。端点：

| 端点 | 内容 |
| --- | --- |
| `GET /v1/models`、`GET /v1/models/{model}` | 服务此刻能路由到的模型：别名在前，然后是 `<providerId>/<modelId>`；只列可用的，`baocut` 字段带能力与 Provider |
| `POST /v1/audio/transcriptions` | multipart：`file`、`model`、`language`（按断言处理）、`prompt`（术语提示）、`response_format` 为 `json`、`text`、`srt`、`vtt` 或 `verbose_json`，`timestamp_granularities[]` 为 `word`、`segment` |
| `POST /v1/audio/speech` | `input`、`voice`、`instructions`、`speed`、`response_format` 为 `mp3`、`wav` 或 `flac`；响应是音频字节 |
| `POST /v1/images/generations` | `prompt`、`n`、`size`、`output_format`；`response_format` 只有 `b64_json`：这个服务不托管图片，要 `url` 时回答 400 `UNSUPPORTED_PARAMETER` |
| `POST /v1/chat/completions` | `messages`（`system`、`developer`、`user`、`assistant`，纯文本）、`temperature`、`max_tokens` / `max_completion_tokens`（后者优先）、`seed`、`reasoning_effort`、`response_format` 为 `json_object` 或 `json_schema`；工具调用、`n > 1` 与 `logprobs` 回答 400 `UNSUPPORTED_PARAMETER`。`stream: true` 不做真正的增量：整段结果作为一个内容块的 SSE 返回，随后是结束块（`stream_options.include_usage` 时再加用量块）与 `[DONE]` |
| `GET /v1/baocut/info` | 接口版本、端点、路由开关、等级与上限 |

每个回答都带 `X-BaoCut-Interface-Version` 头（首版 `1`），生成请求的回答另带 `X-BaoCut-Job-Id`（JSON 回答在 `baocut.jobId`）。错误用 OpenAI 的错误体 `{ error: { message, type, code } }`，`code` 是封闭的错误码（命令与协议规范 §11.3）：401 没有或错误的令牌；403 带 `Origin`、`Host` 不是回环、`read` 等级下的生成请求、审批被拒绝或超时，以及没有授权或授权已撤销的外发（`GRANT_REQUIRED`、`GRANT_REVOKED`）；409 授权的预算用完或无法保证（`BUDGET_EXCEEDED`、`BUDGET_UNVERIFIABLE`）；404 不认识的模型；413 超过上传或请求体上限；429 超过每个客户端的并发上限，或供应商限速（原样转出 `Retry-After`）；400 参数不对或不支持；503 这种能力此刻没有可路由的模型（`CAPABILITY_NOT_CONFIGURED`，说明怎么开启）。

模型名的解析顺序：别名表里的别名；规范写法 `<providerId>/<modelId>`；能力视图里的模型名（多个 Provider 都有时按视图的顺序，本机在前）。别名表属于服务配置，默认只有一条 `whisper-1` → 本机 Provider 的默认转写模型包；`services.modelApi.setAlias` / `removeAlias` 修改它。路由：这个服务默认只路由到 `local`；在线 Provider、局域网节点与智能体 Provider 各有一个开关（`routing: { online, nodes, agent }`，默认全关），关着的那一类对这个服务不存在：不在 `/v1/models` 里，按名请求是 404，这种能力一个可路由的模型都没有时是 503。开关只决定这个服务能不能用它们，在线 Provider 仍要求用户已经启用（§6.4）。等级：`read` 只有 `GET` 端点；`ask` 每个生成请求一条服务审批（工具名是端点，摘要只有模型、字数与大小，不含正文）；`auto` 直接执行；视频范围对这个服务没有意义，忽略。每个客户端同时在途的生成请求有上限（默认 4，可配置），超出的立即回答 429。调用方在拿到结果之前断开时取消它的 Job；停止服务不算断开。

**Web 服务**提供与桌面界面相同的客户端协议：浏览器取得的是一个作用域受限的连接，能力集合由服务配置给出，不包含设置、凭据与对外服务的管理。它在产品范围之内（产品设计 §1.4）；首版的取舍见 §14。

- **一个端口，三样东西**。服务监听 `127.0.0.1`，默认端口 47622，提供 Web 客户端的静态文件（`apps/web` 的构建产物）、网关入口 `/ws` 与媒体通道 `/media/…`。网关入口与桌面界面用同一套协议与处理函数，只是连接在升级时按会话认证、方法与主题按白名单过滤；媒体用这个服务自己的句柄表，地址是同源的相对路径，取内容同样要会话。浏览器拿不到桌面网关的端口与令牌。构建产物按 `BAOCUT_WEB_DIST`、打包后的 `<resources>/web`、仓库里的 `apps/web/dist` 的顺序找；没有时开启服务进入 `error` 并说明，不影响 Runtime。
- **登录**。`services.web.createAccessLink` 发一个一次性代码，放在链接的 fragment 里（`http://127.0.0.1:<端口>/#code=…`；fragment 不发给服务器，不进访问日志与 Referer）。`createAccessLink { video }`（videoId）让链接直达这个视频的编辑器：Runtime 把 videoId 解析成界面打开它用的文件目标（已打开的视频或 Space 登记的位置：项目或会话的工作目录 + 相对路径），链接的路径与查询是界面内链接 `/home?video=<JSON 的 FileTarget>`（`@baocut/protocol` 的 `webVideoHref`，界面的路由与它共用一个构造函数），fragment 里仍只有代码；找不到时 `not-found`（`VIDEO_NOT_FOUND`）。未登录时页面只有一张登录页（根路径与界面内链接都是；界面内链接是最后一段没有扩展名、不在 `/media/`、`/_auth/`、`/assets/` 下的路径，登录后同样给客户端页面），它的脚本取出代码、立即从地址栏抹掉，用 `POST /_auth/session` 换一个会话 cookie，然后回到原来的路径与查询，客户端启动时按它去对应的界面、再把地址栏改回根路径；登录页也有一个输入框，粘贴代码（或整条链接）同样能登录。`baocut web open [--video <videoId>]` 打印链接；`--launch` 不把带代码的链接交给浏览器（打开浏览器要经 `open`、`xdg-open` 或 `cmd` 的进程参数，本机别的用户与程序在进程列表里看得到），而是打开不带代码的登录页（保留路径与查询），代码只打在终端里，由用户粘进去。代码两分钟内有效，第一次兑换（不论成败）就作废；Runtime 只存代码与会话令牌的哈希。会话 12 小时有效，只在内存里，服务停止即全部作废；`services.web.listSessions` 列出，`services.web.revokeSession` 吊销并立即断开它的连接。
- **为什么是 cookie**。`<video>`、`<img>` 不能带请求头，只有 cookie 能让媒体请求与 WebSocket 用同一个会话认证、吊销时一起失效，令牌也不必进 URL。cookie 是 `HttpOnly`（页面脚本读不到）、`SameSite=Strict`（别的站点发起的请求不带）、`Path=/`，名字带端口（`baocut_web_<端口>`）。
- **能力集合**是一份方法白名单（方法名或 `<命名空间>.*`），在网关分发之前检查，白名单之外回答 `forbidden`（`WEB_METHOD_NOT_ALLOWED`）。默认集合是桌面界面的协议减去：`settings.set`；`models.configure`、`models.removeProvider`、`models.enable`、`models.setDefault` 等模型服务的配置与凭据，含 API 提供方账号的写方法（`models.addAccount`、`models.updateAccount`、`models.removeAccount`、`models.arrangeAccounts`）与查余额（`models.checkBalance`，它用账号的密钥向 API 提供方发请求）；`services.*`（含 `services.mcp.*`、`services.modelApi.*` 与访问链接的发放）；`nodes.pair`、`nodes.remove`、`nodes.share.*`；本地模型包的安装管理（`models.install`、`models.repair`、`models.cancelInstall`、`models.remove`、`models.test`，§6.3：从网络下载几百 MB、删掉本机的转写能力是这台机器的管理，浏览器只看状态与进度）；Agent skill 的添加、导入与移除（`skills.add`、`skills.importGithub`、`skills.remove`，§12.9：要读本机文件夹或从网络取内容，写进这台机器的指导）。查询、会话、编辑、转写与生成（含 `models.generateText`）、模型用量（`models.usage`，只读，也在只读集合里；§6.10）、任务与导出（`exports.*`）、工具目录与候选输入（`tools.list`、`tools.candidates`，也在只读集合里）、创作模板目录（`templates.*`，也在只读集合里；模板包规范 §6，句柄只发给清单登记的封面、预览与素材）、Agent skill 的查看与开关（`skills.list`、`skills.get`、`skills.readFile`、`skills.setEnabled`，前三个也在只读集合里；§3.8）可用；目录里执行方法不在白名单的工具对浏览器标为不可用，外部工具的问题只给错误码与工具名。白名单逐项或按命名空间写出，名字不在里面的方法浏览器一律调不了：固定流程（`pipelines.*`，§7.9）不开放：文件转码的输入与输出目录是任意的绝对路径，不受项目目录约束；要开放得先给它加上与 `exports.create` 同样的路径约束；从链接导入也在其中。受管外部工具（`externalTools.*`，§12.9）整个不开放，连 `list` 也不开放：下载并执行第三方程序是这台机器的管理，状态里还有本机路径。主题按对应的读取方法过滤（`services` 主题要 `services.list`，所以默认不可订阅），拒绝时 `WEB_TOPIC_NOT_ALLOWED`。服务配置可以在默认集合之内收紧（`methods`），或设为只读（`readOnly`，只剩一份逐个列出的查询方法，如 `videos.assetStatus`、`exports.get`、`exports.list`；写入回答 `WEB_READ_ONLY`）；配置不能把默认集合之外的方法加进来。配置一改，已有的浏览器连接断开，按新的白名单重连。
- **没有项目目录之外的文件访问**。`projects.open` 只接受已登记的项目（`PROJECT_NOT_REGISTERED`），新项目只能用 `projects.create` 建在默认项目目录下；`edits.apply` 里 `importAsset` / `relinkAsset` 的路径按真实路径必须在视频所在的项目目录（或无项目会话的工作目录）里（`PATH_OUTSIDE_PROJECT`）；`exports.create` 的目标目录同样按真实路径必须在这个目录里、不能是视频目录（含 `video.db`）或 `.bcut`，不给时是项目的 `exports/`（它若是指到别处的符号链接同样拒绝）。浏览器不给出本机文件路径；选目录、按本机路径导入素材与「在文件夹中显示」不可用。会话附件允许选择或拖入文件：通过 `attachments.prepare` 登记，Web 服务把 Runtime 上传地址换成绑定登录会话的单次同源地址；PUT 必须同时通过 Origin、cookie、会话归属与当前方法/只读配置校验，字节数和 MIME 继续由附件仓库核对。单文件上限 20 MiB、每条消息最多 8 个，地址十分钟过期。图片附件按 Driver 图片能力发送，普通附件只把安全存储路径作为文件上下文传给 Agent，不扩大其权限。附件预览仍核对所属会话；浏览器得不到桌面上传端口与令牌。
- 写入类调用记入服务的最近请求（方法、目标视频与结果，不记参数正文）。

安全要求见 §12.8。

---

## 5. 存储与素材

### 5.1 存储分层

| 存储 | 写入方 | 内容 |
| --- | --- | --- |
| VideoStore | Rust VideoEngine，单写 | 视频实体、文档版本、事务、回执、撤销、outbox、素材与代码包引用、依赖边 |
| Runtime Store | Node Runtime | 会话、Task / Run、审批、授权、视频记忆、Space 用户标记、项目登记、偏好设置（§5.10）、对外服务配置（§4.8） |
| 用户库 | Node Runtime | 跨视频复用的用户数据：术语表、音色、品牌库（§5.9） |
| Job Ledger | Node JobManager | Job、外部任务 ID、预算预留、Application |
| Artifact / Blob Store | 发布流程（staging → 校验 → 原子发布） | 内容寻址的不可变 bytes |
| 派生缓存 | 各执行器 | 代理、缩略图、波形、帧缓存、Space 索引；全部可以删除后重建 |

VideoStore 用 SQLite，表至少包括 `videos`、`entities`、`document_versions`、`transactions`、`receipts`、`asset_versions`、`bundle_versions`、`dependency_edges`。Job Ledger 单独管理任务表。二者不能各自成为同一个视频的写入方。

建议的磁盘布局（待评审，见 §14）：

```text
<runtime-home>/
  instance.json / instance.lock     # Supervisor 的发现信息与实例锁
  store/                            # Runtime Store 与 Job Ledger：一存储一文件。小而整体读入内存的（项目登记、Space 标记、设置、授权等）是整文件原子重写的 JSON；按条记账、只改几条的是只追加的 JSONL 加压缩：store/conversations/<id>.jsonl（会话，§3.10）、store/jobs.jsonl 与 store/applications.jsonl（任务与应用账本，§7.3）。旧格式导入后留下 *.migrated，认不出的改名为 *.corrupt-<时间> 保留
  artifacts/                        # 内容寻址的 Artifact / Blob Store：<sha256>.<扩展名>；后台清扫没有引用的文件（§7.3）
  staging/                          # 发布前的临时写入
  cache/                            # 派生缓存，可整体删除；总大小有上限（设置 cache.maxSizeMiB，默认 2 GiB），超限按修改时间删最旧的到 90%，content-index/ 与 baocut-composition-host/ 不删
  workspaces/<bundleId>/            # 代码创作工作区（草稿）
  models/                           # 本地模型
  store/                            # 模型服务配置与凭据（§6.8）、节点与共享的状态（§6.7）、偏好设置（§5.10）、对外服务的配置（§4.8）、外部工具的登记（external-tools.json，§12.9）、从链接导入的原始链接（link-sources.json，0600，§7.9）、在线调用的用量账本（usage.jsonl，0600，§6.10）
  library/                          # 用户库（§5.9）
  tools/                            # 受管外部工具：<工具>/<版本>/ 与下载中的 .staging/（§12.9）
  fonts/                            # 按需下载的字体：files/<族>/、index.json 与下载中的 .staging/（§9.1）
  outputs/                          # 不属于任何项目的生成结果与链接下载（§7.9）
  logs/

<project-dir>/                      # 项目：一个目录。默认位于 <runtime-home>/projects/<projectId>/
  .bcut/                            # 项目标记目录
    project.json                    # 项目的标识：format、schemaVersion、projectId、createdAt
  <video-dir>/                      # 视频：项目下的一个子目录，一个视频一个
    video.db                        # VideoStore
    video.lock                      # 视频级操作系统锁
    blobs/                          # 收进来的 bytes：用户选择复制的素材，以及没有原文件的生成结果
  .bcut-trash/<trashId>/<video-dir>/  # 删除了的视频，整个目录原样移进来，恢复时移回（§5.7）
  …                                 # 项目里的其他文件：原始素材、脚本、导出的成片等
```

**素材默认留在原处。** 视频文件普遍很大，导入默认只登记定位（`linked`），不复制 bytes；用户在导入时或之后选择「复制到视频里」才收进 `blobs/`（`managed`，视频格式规范 §4.2）。没有原文件可以指向的内容（模型生成的结果、录制与粘贴的内容、代码包）直接收进来。项目目录里的文件按相对视频目录的路径链接，整个项目移动或改名之后仍然有效；项目外的文件按绝对路径链接（视频格式规范 §4.2）。因此视频目录**不是**自包含的：单独拷走一个视频目录，链接的素材要在新位置重新链接；需要带走全部内容时用「收集素材」或导出便携包（§5.8）。同一个文件被多个视频链接时只有一份 bytes，不需要另外的去重机制。

**项目的标识在目录里。** `.bcut/project.json` 保存项目的标识：`{ "format": "baocut.project", "schemaVersion": 1, "projectId", "createdAt" }`（RFC 3339），原子写入。Runtime Store 的登记只是「标识 → 最后见到的路径」的索引，加上显示名、置顶与归档，可以由标记重建。标记目录只放 BaoCut 自己的项目级状态，不放用户内容，目前只有这一个文件；Space 不列出它，也不往里走。

- **只在新建与打开项目时写标记**（`projects.create`、`projects.open`），总在登记之前写。Space 扫描、会话与任务不写；启动时加载登记也不写，登记里的项目照常列出。需要写标记而目录不可写（只读卷、没有权限）时打开失败（`PROJECT_DIR_READ_ONLY`），不登记一个没有标记的项目。
- **打开时的判定顺序**：
  1. 有标记、登记里有这个标识：登记的路径就是当前目录，是同一个项目。登记的路径已不存在，或那里的标记不再是这个标识：目录被移动或改名，更新登记的路径，标识不变，会话仍然挂在它下面、工作目录跟着换；显示名原来等于旧目录名的换成新目录名，用户改过的保留。视频里按相对路径链接的项目内素材照常有效；按绝对路径登记的旧链接不迁移、不猜测，按缺失报告，由用户或智能体重新链接（视频格式规范 §4.2）。登记的路径还在、那里的标记仍是这个标识：当前目录是副本，Runtime 给它写入新的 `projectId`、作为新项目登记。原项目与它的会话、Space 用户标记不受影响，副本不继承它们。
  2. 有标记、登记里没有这个标识（登记被删、换了机器）：沿用标记里的标识与创建时间登记。标记优先：同一路径上如果还有别的旧登记，保留它与它的会话，不合并。
  3. 没有标记：登记里已有这个路径（升级前登记的项目）时沿用登记的标识，否则是新项目；写入标记。因此删掉标记再从同一路径打开，得到的仍是原来的标识；换一个登记里没有的位置才是新项目。
- **认不出的标记**（不是 JSON、`format` 不对、缺字段）先改名保留为 `project.json.corrupt-<时间>`，再按没有标记处理，不静默覆盖。`schemaVersion` 高于已知版本时拒绝打开（`PROJECT_MARKER_UNSUPPORTED`），不改写它。
- **视频跟着项目换标识。** 视频的标识在各自的 `video.db` 里，不另放标记；项目下的视频由扫描子目录里的 `video.db` 得出。`video.db` 的元数据记下它所属的 `projectId`（不属于修订内容：写它不产生新版本，不进撤销历史；视频格式规范 §1.3）。Runtime 打开或新建项目里的视频时把项目的标识交给 VideoEngine：库里没有所属项目（升级前的视频）时采用它，`videoId` 不变；相同时什么也不做；不同时这是副本或被搬到了另一个项目，VideoEngine 分配新的 `videoId`，旧的追加到 `previousVideoIds`（来历），记下新的 `projectId`，内容、修订号与历史不变。这一步在一个数据库事务里完成，崩溃后要么全做要么没做。不属于项目的视频（会话工作目录里的）不认领。
- **打开项目时预处理它的视频。** `projects.open` 之后 Runtime 在后台扫描项目目录里的视频，逐个交给 VideoEngine 认领：每个视频只短暂地取一次写锁；正被打开的跳过（打开时已经认领过），被别处锁着的留到下次，打开视频时还会再认领一次。只处理已登记项目目录里的视频。`videoId` 只经 VideoEngine 打开视频进入 Runtime，所以同一个 `videoId` 不会同时指向两个目录；万一出现（打开期间被移动，或无从区分的副本），保留先打开的那一个并记日志。
- **限制**：两个都还没有记所属项目的旧视频互为副本（例如升级之前就复制过的项目）时无法区分：各自采用所在的项目，保持同一个 `videoId`；两个同时打开时按上一条只保留先打开的那一个。

不变量：视频的权威状态只在它的 `video.db` 与它引用的素材版本里；项目目录里的其他文件不是视频的权威数据；Runtime Home 中的任何数据都不能独立改变视频版本；缓存目录被整体删除后，视频仍然可以打开、预览与导出；链接的素材找不到时视频照常打开，素材标为缺失，由 `videos.assetStatus` 报告（命令与协议规范 §4.1）。

### 5.2 写入、发布与崩溃一致性

- 视频实体、版本、幂等结果、回执、撤销记录和 outbox 由同一个 Rust 数据库事务提交。
- 返回给用户的回执只能来自持久化成功之后的提交。写入失败时保留旧版本；磁盘不足不得返回「已保存」。
- 耗时的分析、下载与媒体计算在事务之外完成；提交时重新验证输入。
- 新的 bytes 先写入 staging，校验摘要与格式之后原子发布到不可变的 Blob Store，然后才在数据库事务中增加引用。
- 崩溃可能留下未被引用的 blob，由带宽限期的 GC 清理。GC 必须考虑在建任务的租约、冻结中的导出、历史引用和宽限期，不能立刻清掉刚发布而尚未进入事务的产物。
- 视频级的 blob GC 在引擎里（`Video::gc_blobs`，内部命令 `videos.gcBlobs { path }`）：只在持有写锁时执行，按 §5.5 的引用集合删掉 `blobs/` 里没有记录提到的条目，`blobs/.staging/` 里最近修改时间超过宽限期（1 小时）的残留一并删掉；读引用集合失败时什么都不删，单个条目删不掉只记进回执。何时调用由 Runtime 决定：正常关闭视频（打开者走光或空闲）且没有冻结任务租约时在放下写锁前跑一次；被删除或引擎出错的视频不跑。导出与便携包导入在关闭之外完成，不与它交错。
- 整文件 JSON 的 Runtime Store（项目登记、Space 标记与产物记录、设置、偏好等，`store-file.ts`）读文件按同一条规则：不是 JSON、顶层不是对象或结构认不出时改名保留 `<文件>.corrupt-<时间>`、记日志、从默认值开始；空文件按不在处理；版本字段高于已知时按空处理但不改名、之后不再写它（改动只留在内存里），免得降级运行时覆盖新版本的数据；文件系统读不了时启动失败，偏好与缓存类除外（按空处理且只读）。不能静默丢的例外：授权账本与对外服务的配置读不了时启动失败；模型凭据读不了时每个操作报 `unavailable`、文件不动；节点共享读不了时共享按关着处理且不能修改。
- 不能出现数据库指向未发布 bytes 的已确认视频。

### 5.3 素材版本与导入信息

每个 `AssetRevision` 必须记录：内容摘要、媒体类型、时长与 timebase、视频的显示尺寸 / 旋转 / 像素宽高比、音频的采样率与声道、已知的颜色信息、原始或生成的来源。可变帧率的索引、代理、缩略图、波形、反向 conform 都是派生产物。

素材的 bytes 默认留在原处、只记下定位（`linked`），也可以由用户选择收进视频目录（`managed`）；代码包是目录素材。存储位置不属于版本的身份：把链接素材收进来、给挪了地方的文件换定位，都不产生新版本（视频格式规范 §4.2、§4.3）。

源路径变化与源内容变化是两种事件：

- 重新链接到相同的 bytes，不改变语义版本。
- 同一路径出现新的 bytes，必须产生新的 revision，并经显式的 `replaceAssetVersion` 影响选定的实例。
- 禁止悄悄用「文件的最新内容」替换冻结导出中的素材。

记录格式见视频格式规范 §4。

### 5.4 来源、生成与费用事实

生成的媒体记录 `jobId`、`provider`、`model`、`modelVersion`、`inputHashes`、`outputHash`，可用时记录 seed，以及实际成本与账单状态。费用未知时保存 `unknown`，不从估算伪造实付。

用户上传的媒体记录已知的出处。授权、许可与声音使用确认可以关联到素材，但不得假定「上传即拥有第三方素材的一切权利」。

外部 URL 必须在发布或导出之前解析为冻结的素材。已过期的签名地址不能充当永久的源。

### 5.5 引用图与资源清理

- 删除时间线上的实例不删除原素材。
- 删除素材必须检查所有序列、撤销历史、冻结中的任务和已发布代码包的引用。
- GC 以引用图与保留政策为准，不以「最近没有显示过」为准。视频目录 `blobs/` 的引用集合是库里提到过的全部内容摘要：素材的每个版本（不只当前版本，撤销能把删掉的素材放回来）、代码包版本、当前实体与撤销记录正文里的摘要；不按存储方式筛（`collectAssets` 收进来的链接素材版本记录仍写着 `linked`），多算进来的摘要在 `blobs/` 里没有对应条目。`blobs/` 里名字不是 `<sha256>.<ext>` 或 `<sha256>/` 的条目不归视频管理，GC 不动。版本记录与撤销记录本身从不删除，所以这个 GC 只回收崩溃留下的孤儿与过期的 staging；已删除素材的 bytes 随版本记录保留（§14）。
- Space 中的删除（§5.7）走同一张引用图。
- 删除视频不删除用户的原文件。链接素材的 bytes 在视频目录之外，删除与物理删除都不碰它们；物理删除只删视频自己管理的文件（视频数据库及其日志与锁、`blobs/`）。视频目录里有不归视频管理的文件时不删，交给用户处理。

### 5.6 ResourceResolver、临时授权与 bytes 冻结

视频只保存 Asset、Bundle、Font 的稳定版本引用。运行时由解析器提供受控的句柄或短期地址：

```ts
interface ResourceResolver {
  resolve(
    ref: VersionRef,
    purpose: 'interactive-preview' | 'inspection' | 'export' | 'authoring',
    principal: TrustedPrincipal,
  ): Promise<{
    handle: ResourceHandle;         // 受控句柄或短期 URL
    availability: 'ready' | 'missing' | 'denied' | 'expired';
    contentHash: string;
    scope: GrantScope;
    expiresAt?: string;
  }>;
}
```

- blob URL、签名地址和浏览器对象不写入 `VideoSnapshot`。链接素材的本机路径记在素材版本的 `storage.locator` 里；从本机媒体新建的视频，素材的来源也记着原文件的路径（§7.9）。两处打包成便携包时都不带出去（视频格式规范 §4.2、§4.5、§8）。
- 链接的媒体素材按视频登记的那一个文件放行，不放行它所在目录里别的东西；不是媒体的链接素材不经媒体通道。
- 查询媒体元数据与获取实际 bytes 分开；时间线只加载可见的资源。
- 过期的地址可以在有效授权之内刷新。授权被拒绝时显示权限问题，不能替换成同名或相似的文件。
- 句柄限定到视频、素材版本和使用方，不能借一个 URL 遍历其他视频。
- 路径解析要防逃逸、防符号链接变化、防检查后使用的竞态。日志不暴露敏感的本机路径或凭据。

**冻结语义**。文件大小与 inode 可以作为廉价的变化提示，但同大小的原位写入不会改变它们，所以冻结不能建立在这种判断上：

1. 先取得可以保证不再变化的受管理 bytes（经过验证的复制、写时复制，或受控的对象存储）；
2. 校验 hash；
3. 发布为不可变的 `AssetRevision`。

打开一个文件描述符并不会让文件内容变成不可变。冻结中的任务只引用已经验证的受管理版本。链接素材是默认情形，冻结时为它建立任务快照：所在的卷支持写时复制时用克隆，不占额外空间；不支持时在任务开始与结束各核对一次内容摘要，不一致则任务失败并说明，不为此复制整份文件。不能用「跑完再看 mtime」来掩盖中途混入新 bytes 的风险。

运行中的任务是否持有独立的授权、撤销授权是否取消它，必须在 Grant 合同中明确（§12.5）。权限撤销不得被自动刷新地址绕过。

### 5.7 Space 目录

Space 目录（`SpaceCatalog`）是共享存储层里的一个派生索引，把视频与用户可见的产物统一成一张可查询的列表。它没有自己的权威数据。

```ts
interface SpaceEntry {
  id: Id;                                  // 视频条目用 videoId；产物条目用 artifactId。kind 里 'video' 是可编辑的视频，'video-file' 是视频素材
  kind: 'video' | 'export' | 'video-file' | 'image' | 'audio'
      | 'subtitle' | 'document' | 'package' | 'template';
  name: string;
  ref: { videoId: Id } | { artifactRef: VersionRef };
  origin: {
    source: 'generated' | 'imported' | 'exported' | 'edited';
    projectId?: Id;                        // 所在项目；不属于任何项目时为空
    videoId?: Id;
    videoRevision?: Revision;            // 产物对应的冻结版本
    conversationId?: Id;
    taskId?: Id;
    jobId?: Id;
    provider?: { providerId: string; modelId: string };
    cost?: { state: 'estimate' | 'reported' | 'unknown' | 'free-local';
             amount?: string; currency?: string };
    derivedFrom?: VersionRef;              // 二次编辑的来源条目
    derivedFromVideo?: { videoId: Id; range?: TimeRange };  // 视频条目：从哪个视频派生（切出的短片、副本）
  };
  status: 'generating' | 'candidate' | 'applied' | 'published'
        | 'source-changed' | 'missing' | 'failed';
  media?: { duration?: MediaTime; width?: number; height?: number };
  previewRef?: Id;
  lastActivityAt: string;
  user: { favorite: boolean; displayName?: string; trashedAt?: string };
}
```

**数据来源**

| 条目字段 | 来自 |
| --- | --- |
| 视频条目、视频名、当前版本、封面 | VideoStore（经 VideoService 查询与视频事件） |
| 产物条目、bytes、媒体信息 | Artifact Store |
| `generating` 占位、来源任务、费用状态 | Job Ledger |
| `candidate` / `applied` | Application 记录 |
| `published` | 导出 Job 的发布回执 |
| `user.*` | Runtime Store |

**规则**

- **可见性**。Artifact 发布时带有用途标记。只有可交付的产物（成片、生成的图片 / 音频 / 视频、字幕文件、文档、便携包、模板）进入目录；代理、缩略图、波形、帧缓存和检查截图不进入。
- **状态是派生的**。目录不保存独立的状态字段，只缓存派生结果。`source-changed` 的判定：产物记录的输入指纹与视频当前对应输入的指纹不一致。`missing` 的判定：`ResourceResolver` 报告 bytes 或外部依赖不可用。
- **可重建**。删除索引后，从 VideoStore、Artifact Store、Job Ledger 与 Runtime Store 重建，结果必须一致；`user.*` 不因重建丢失。
- **更新**。目录订阅视频事件、Job 事件与 Artifact 发布事件，增量更新；提供自己的序号供客户端订阅与去重。
- **二次编辑不覆盖**。对产物的修改发布为新的 Artifact，`origin.derivedFrom` 指向原条目。对视频的修改是普通事务。
- **从成片回到视频**。`space.openForEdit` 返回来源视频、成片冻结的 `videoRevision` 与视频当前版本；二者不同时由客户端提示差异。没有来源视频时返回「以此素材新建视频」的选项，不伪造图层。
- **删除**。移入回收站只写 `user.trashedAt`。物理删除走 §5.5 的引用图：仍被视频、历史、冻结任务或模板引用的唯一 bytes 不删除，并返回阻止删除的引用列表。删除视频是 VideoService 的显式命令，不是目录操作的副作用。
- **权限**。目录查询按主体过滤。目录不提供绕过 `ResourceResolver` 取得 bytes 的途径。
- **项目归属**。条目的 `projectId` 来自它所在的目录：视频取自所属项目，产物取自产生它的视频或会话所属的项目。没有项目的条目（独立工具与对外服务的生成结果，§7.9）`projectId` 为空，bytes 在 Runtime Home 的 `outputs/`。
- **项目里不属于视频的文件**。直接导入到项目的素材、会话写出的文档，bytes 的权威是项目目录里的文件本身；目录只索引 Runtime 登记过的文件（经 `space.import` 或由 Job 发布），不扫描整个项目目录。文件被外部移动或删除后，条目显示为 `missing`。
- **生成的产物**。`synthesizeSpeech` 与 `generateImage` 的每个输出是一个 Artifact，条目的 `kind` 为 `audio` / `image`，`origin` 取 `source: 'generated'`、`jobId` 与 `provider`（来自 Job Ledger）。生成参数（含原文与提示词）只在 Job 记录的 `generation` 里：条目与视频里素材的来源只记参数摘要与输入 hash，不复制原文。给了视频时输出导入为素材，条目状态是 `candidate`；没有视频时条目不属于任何视频。
- **失败的生成**。失败的生成 Job 在目录里留一条 `failed` 的占位，带原因与重试入口；用户清除或重试成功后消失。它没有 bytes，不能被引用。
- **派生的视频**。从一个视频切出的短片与副本是独立的视频，`derivedFromVideo` 只记录来源，用于筛选与提示；源视频之后的修改不传播给它，删除源视频也不删除它。

`space` 命名空间的命令：`list`、`get`、`search`、`import`、`rename`、`setFavorite`、`trash`、`restore`、`purge`、`openForEdit`、`continueInConversation`、`rebuildIndex`。`list` 可以按 `projectId`（含「不属于任何项目」）、`kind`、`status` 与来源视频筛选；`import` 把文件登记为某个项目的素材而不放进任何视频；`search` 见 §5.11。

**这个版本的实现**（`packages/runtime-core/src/space-catalog.ts` 与 `space/`；与上面不同的地方记在 §14）：

- **派生**。条目由一个纯函数从全部输入整体算出（`space/space-derive.ts`），再与上一次的结果比较，只发变了的条目（`entry.upsert` / `entry.removed`）；首次扫描、重扫与重建发一条 `catalog.replaced`。增量与重建因此走同一条路径，结果一致。输入是：来源目录的扫描（登记的项目目录、不属于项目的会话的工作目录；会话绑定项目时来源从 `conv:<id>` 换成 `project:<id>`，条目 id 随来源键变化，用户标记与 `space.json` 里旧来源键下的回收站记录不跟过去）、`space.import` 的登记与用户标记（Runtime Store 的 `space.json`）、Job Ledger（`JobManager.list()` 与它的变化通知），以及内容索引（§5.11）里每个视频的 videoId、当前版本、时间线上用到的素材、链接素材指向的文件，与根序列的时长和画布尺寸。
- **条目的 `id`**。扫描到的文件与视频目录是来源键与相对路径的摘要（`sp_…`），视频条目另带 `ref: { videoId }` 与 `media`（根序列的时长 `durationSec` 与画布的 `width`、`height`，界面「时长或尺寸」一列用；内容索引读到之后，回收站里的视频没有）；生成与导出的产物是 artifactId；`generating` / `failed` 占位是 jobId。`ref` 是 `{ videoId }`、`{ artifactId }` 或 `{ jobId }`。
- **来源与项目**。不在来源目录里的条目（产物、占位、发布到来源目录之外的导出）`source` 为空，所属项目记在 `origin.projectId`（取自产生它的视频所在的项目，或提交它的会话所属的项目）；`list` 的 `projectId` 按 `source.projectId ?? origin.projectId` 筛。
- **状态**。`generating`：排队与运行中的生成、导出，带进度。`failed`：失败或中断的，带原因与错误码；`space.purge` 清除，或同一能力、同样输入（`inputHash`）的任务后来成功了就不再显示。`candidate` / `applied`：导入了视频的生成输出，时间线（任何序列）上用着那个素材时是 `applied`。`published`：导出发布的文件；发布到来源目录里的与扫描到的文件合成一个条目（`kind` 按导出设置，`ref.artifactId` 是导出的产物）。`source-changed`：导出冻结的 `videoRevision` 与视频的当前版本不同。`missing`：产物文件、发布的文件或登记的项目文件不在了。普通文件与视频没有状态（`null`，`list` 里用 `none` 筛）。
- **可交付**。生成的图片、音频、文本与导出进入目录；转写的原始结果、导出的冻结快照不进入；代理、缩略图、波形本来就不在 Artifact Store 里。固定流程（§7.9）的父任务与步骤不进入：发布到来源目录里的转码结果经扫描出现。
- **bytes**。`media.resolve` 给 `entryId` 时由目录定位：来源目录里的条目限定到来源目录，产物与来源目录之外的导出限定到那一个文件；占位与缺失的条目没有 bytes。
- **`space.import`**。项目目录里的文件原地登记；项目之外的复制进项目的 `imports/`（重名时加序号），返回 `copied: true`。视频目录里、隐藏目录与依赖目录里的文件，以及认不出类型的文件拒绝（`SPACE_IMPORT_UNSUPPORTED`）。
- **`space.openForEdit`**。视频条目返回 `video`；有来源视频的返回 `source-video`，带冻结版本、当前版本与 `changed`；没有来源视频的返回 `new-video` 与建议的项目。只回答去哪里，不打开视频。
- **`space.thumbnail`**（`space/space-thumbnails.ts`）。网格卡片与列表名称列的缩略图，客户端在条目可见时按需取。回答 `image`（宽不超过 320、高不超过宽的 3 倍、不放大；PNG、GIF、WebP 来源输出 PNG 保留透明，其余 JPEG）、`text`（开头约 1.5 KB 的 UTF-8 文字，截在字符边界上）或 `none`，不含本机路径；条目不在或看不到是 `not-found`，主体规则与 `space.get` 相同，Web 只读模式下照常可用。各种类的取法：
  - 视频：工作稿的封面那一帧（与界面的海报帧同一条规则，`@baocut/protocol` 的 `posterFrame`）。素材版本与时间取自内容索引的视频事实（§5.11），还没有索引时让索引先读这一个（至多等 15 秒）。素材文件经 Engine Host 的内部只读查询 `videos.resolveAsset { path, assetId, revision? }`（不在网关的方法表里）找：已经打开的视频用打开的那一份，没有打开的只读打开、找完就放下，不取写锁；复制进来的素材的存放方式是引擎内部的约定，不在 Runtime 里另算一份，链接素材照引擎的长度与位置检查，再照媒体通道的规则放行。回收站里的视频与时间线上没有画面的视频是 `none`。
  - 成片与视频文件：1 秒与时长的 10% 中较早的那一帧，取不到（视频更短）时退回第一帧。图片取第一帧。只认扩展名对应的解复用器（MP4/MOV、WebM/MKV、AVI；PNG、JPEG、WebP、GIF、BMP 强制按格式读），SVG、HEIC、AVIF 是 `none`。
  - 文档与字幕：Markdown、纯文本与字幕（SRT、WebVTT、ASS/SSA）取开头的文字，去掉 BOM；字幕只留台词（去掉序号、时间码、头部、样式与标签）。认 UTF-8 与带 BOM 的 UTF-16，别的编码与二进制是 `none`；PDF、Word、RTF 是 `none`。
  - 音频、包、模板与占位、缺失、失败的条目是 `none`。

  取帧经媒体分析（`media-analysis.ts`）：与胶片条同样的解复用器白名单、只读本地文件、20 秒时限、1 MB 输出上限与 3 个并发名额，失败记 60 秒。缓存在 `<home>/cache/media/`：视频封面按素材的内容摘要、时间与宽（`<摘要>/thumb-<毫秒>-w<宽>.jpg`，缓存命中时不去找文件），文件按真实路径、大小、修改时间、宽与时间的摘要（`files/<摘要>.jpg|png`），文件被覆盖之后重新取。读不了、解不了的都答 `none`，不报错。
- **`space.rebuildIndex`**。重扫全部来源、重查文件，内容索引删掉缓存后在后台重读；返回时目录已经重建完，`pendingVideos` 是还要重读的视频数。用户标记与登记不动。
- **权限**。网关上的主体（界面、CLI、Web）都是用户本人。会话里的智能体与对外服务经工具 `space_list` / `space_search` 访问（§3.5、§4.8）：智能体看会话来源目录里的条目与归属同一来源的产物；对外服务只看范围之内（已登记项目里、在名单上）的视频、由它们生成或导出的条目，任务的产物与占位只看自己提交的。Web 的 `space.import` 只能登记项目目录里的文件（按真实路径，`PATH_OUTSIDE_PROJECT`）。
- **CLI**。`baocut space [list]` 按种类、状态、来源视频、收藏与回收站列条目，`baocut space search` 跨视频检索（命中带视频、时间、文档种类与说话人，索引不完整时说明），另有 `rescan`、`rebuild`、`trash`、`restore` 与 `purge`（有引用时列出引用并以非零状态退出），`delete-video` 删除视频，`continue [--conversation <id>]` 从条目继续会话。改名、收藏、导入与回到视频编辑这一版只在界面里。
- **删除视频**（`videos.delete`，入口还有 `space.trash` / `space.update { trashed: true }` 对视频条目的调用）。整个视频目录在同一个卷上改名进所在来源目录的回收站 `.bcut-trash/<trashId>/<目录名>`，不复制、不删除；跨卷时以 `VIDEO_TRASH_CROSS_DEVICE` 拒绝。视频目录是某个来源目录本身（用户把视频目录当成项目打开了）或装着某个来源目录时，改名会挪走那个项目或会话的目录，删除在关闭视频、写记录、移动目录之前以 `VIDEO_TRASH_SOURCE_ROOT` 拒绝。移动期间持有视频的写锁，别的进程锁着时是引擎的 `VIDEO_LOCKED`。别的连接打开着时 `VIDEO_IN_USE`；Runtime 内部还用着（任务、导出的租约）或有排队、运行中的任务时 `VIDEO_BUSY`（带 `jobIds`）；只有调用方自己打开着时先替它关闭，订阅者收到 `video.closed`（`reason: 'deleted'`）。先在 `space.json` 里记下删除（`trashedVideos`：原来的条目 id 与相对路径、回收站里的位置、videoId、名字），再移动目录；启动时按目录实际在哪里核对，中途崩溃不留下对不上的记录。回收站里的视频是一个视频条目，`id` 由来源与它在回收站里的位置决定（原来的位置可能放进别的视频），用户标记跟过去；删除之前的 `id` 仍然可以拿来撤销与恢复。回收站目录以点开头，不被扫描成视频；`videos.open` 打不开回收站里的路径（`VIDEO_TRASHED`）。由它导出、生成的条目留在原处，结果的 `related` 列出它们。
- **恢复视频**（`videos.restore`，或对删除了的视频调用 `space.restore` / `space.update { trashed: false }`）。目录移回原来的相对路径；那里已经有东西时加序号（`renamed: true`）。项目或会话已经不在时无法恢复。
- **`space.purge`**。来源目录里的视频条目以 `invalid-request` 拒绝（`SPACE_PURGE_VIDEO`，先删除视频）；进行中的占位以 `conflict` 拒绝（`SPACE_PURGE_RUNNING`，先 `jobs.cancel`）；失败的占位直接清除；其余只删回收站里的（否则 `SPACE_NOT_TRASHED`）。删除前查引用：链接着这个文件的视频素材（`video-asset`）、用着这个产物的进行中任务（`job`）；有视频此刻读不了或索引还没跟上时无法确认，按有引用处理（`unverified`）。删除了的视频另查：别的视频链接着它目录里的文件（`video-asset`）、它的排队、运行中与等对账（`needs-reconciliation`，结果可能还要写进它）的任务（`job`）、目录里不归视频管理的文件（`user-file`）；都没有时只删归视频管理的文件，再删掉空目录（§5.5）。有引用时什么也不删，返回 `{ status: 'blocked', references }`。删掉的产物与导出记下清除标记，之后不以 `missing` 再出现。
- **回收站的保留期**。偏好设置 `space.trashRetentionDays`（1–3650，默认 30）。Space 首次扫描之后清一次，之后每 6 小时一次，天数每次取当时的设置：移入回收站超过保留期的条目逐个走 `space.purge` 的同一条路径，有引用的留着、写日志，下次再试。只写了回收站标记的来源目录里的视频（这个版本之前的记录）不在其中。
- **产物记录**（Runtime Store 的 `store/space-artifacts.json`）。Job Ledger 只留最近的若干个任务（§7.5），修剪掉的任务的产物 bytes 还在 Artifact Store 里，条目却会跟着消失。Space 另留一份产出产物的任务（生成、导出，以及文件到文件的流程：文件转码与字幕文件的翻译，只记流程名）的派生用事实（`SpaceJobFacts`：种类、状态、videoId、Provider 与模型、输入 hash、提交者、时间、错误、输出列表、导出的设置摘要与发布文件名、最后一次应用的状态）：任务结束且有结果时写入，启动时也从 Ledger 补一遍；派生时与 Ledger 合并，Ledger 里还有的以 Ledger 为准。生成参数（原文、提示词）、警告、授权与取消的细节不在里面。一条记录的产物全部物理删除或清除之后去掉它（Ledger 里也没有了时连清除标记一起去掉）。它不是缓存，`space.rebuildIndex` 不删；读坏的行跳过，整个文件读不了时改名留存、从空的开始。同一个文件另存**只为清扫保留的引用**（`references`：任务结束时取它的结果、流程步骤的产出与应用里出现的全部产物 id，配音、翻译、说话人与写进视频的转写等不进目录的任务也记）与清扫起点 `sweepSince`（开始保留引用的时刻，旧文件读入时补上并落盘，不后移）；这些引用不参与派生，不显示成条目，目前也不释放。
- **`space.continueInConversation`**。放进哪个会话：给了 `conversationId` 时用它，它要看得到这个条目（与智能体的 `space_list` 同一条规则），否则 `SPACE_CONVERSATION_MISMATCH`；没给时，属于项目的条目在那个项目里新建会话（项目里的会话各有话题，不猜该接哪一个，§3.10），不属于项目的条目回到它所在或产生它的会话，那个会话不在了时新建一个不属于项目的会话。带的只有条目的引用（`SpaceEntryReference`：`entryId`、种类、名字、项目、来源目录里的相对路径、videoId、artifactId、状态、来源的能力、jobId、会话与冻结版本），不读文件内容，不带生成参数。引用记在会话的 `pendingReferences` 上（同一条目只留一份，最多 20 个），不启动任务；用户下一次 `conversations.send` 时附在发给智能体的文字后面（`<baocut-space-references>` 段，只有元数据，要内容时智能体经工具按 id 取），记在那条用户消息的 `references` 上，然后清空；`conversations.update { pendingReferences: null }` 去掉。回收站里的条目拒绝（`SPACE_ENTRY_TRASHED`）。`commandId` 重试时回答同一个会话。
- **入口**。桌面连接与 CLI 都能删除、恢复视频与从条目继续会话。Web 在默认集合里（`videos.*`、`space.*`）；只读配置下这些都是写入，拒绝（`WEB_READ_ONLY`，`space.update` / `space.trash` 也在内，不能借它们绕过）。会话里的智能体有工具 `videos_delete`（风险 `high`，按访问模式询问；只能删会话来源目录里的视频，范围之外的与不存在的一样回答 `VIDEO_NOT_FOUND`）；没有恢复与物理删除的工具。MCP 对外服务的工具目录里没有删除视频。

界面行为见产品设计 §4。

### 5.8 便携包

便携包是一个自包含的 `.baocut` 文件：视频的快照、全部文档版本的正文与全部素材版本的 bytes，连同逐个文件的长度与 sha256。别的机器上的 BaoCut 打开它，得到一个内容相同的新视频。格式见视频格式规范 §8。

- **形式**。已定：只有单文件的 `.baocut`，是不压缩的 POSIX ustar 归档（只有普通文件；路径不超过 255 字节，单个文件小于 8 GiB；不用 pax 扩展）。系统自带的 `tar` 能列出与解开。文件夹形式不做（§14）。
- **冻结**。导出是 `exports.create` 的 `portable` 种类，与其他导出一样冻结、预检、staging 与发布（§9.11）。引擎在一次请求里给出当前的快照、每个文档版本存下的正文原文与每个素材版本此刻的位置；引擎宿主按顺序处理请求，所以它们对应同一个视频版本。不复制带有未 checkpoint 的 WAL 的工作数据库，之后的编辑不影响已经冻结的导出。
- **内容**。快照里的素材全部改成收进视频（`managed`）：链接的素材按登记的摘要核对后复制进来，收进视频的 blob 原样复制。不带密钥、授权、任务账本、应用账本、会话与用户库的数据（音色的参考录音只有已经是视频里的素材时才在包里）。
- **本机路径**。包里不能出现本机的绝对路径。快照里链接素材的位置换掉；其余字段里出现本机根目录（主目录、视频目录与它的上一级、来源目录、素材所在目录、素材来源记下的原文件所在目录，以及它们的真实路径）的字符串换成占位，并记警告 `PACKAGE_LOCAL_PATH_REMOVED`。文档正文按原文收（摘要按原文算，改不了），出现这些根目录时在预检里逐项拒绝（`EXPORT_PACKAGE_LOCAL_PATH`）。有测试打开导出的包逐个文件核对。
- **预检**。提交时检查，同一种问题逐项列出（`details.items`），不只报第一个：素材读不到（不在、读不了、已经不是登记时的内容，`ASSET_MISSING` 的 `details.items`）、写不进 ustar 的文件（`EXPORT_PACKAGE_UNSUPPORTED`）、目标盘空间不够（`EXPORT_INSUFFICIENT_SPACE`，按全部文件的大小加 64 MB 余量）、给定的文件名已经存在（`EXPORT_DESTINATION_EXISTS`；默认文件名重名时加序号）。`missingAssets: 'skip'` 时读不到的素材不收进包，清单里如实标 `missing`，快照里它们是只有文件名的链接素材，每项一条 `PACKAGE_ASSET_MISSING` 警告；打开包之后由 `videos.assetStatus` 列为缺失，用 `relinkAsset` 找回。
- **写出与发布**。归档先写到目标目录里的隐藏临时文件，清单最后写；写完按读入时同样的规则从头读一遍，逐个文件核对长度与摘要，并核对清单与写入的一致，通过后才发布（与成片相同的硬链接发布，§9.11）。链接素材在复制时变了以 `ASSET_CHANGED` 失败；写满盘以 `EXPORT_INSUFFICIENT_SPACE` 失败。取消与失败都删掉临时文件，不留半个包。进程被强杀时可能留下目标目录里的隐藏临时文件（`.<输出文件名>.<8 位十六进制>.tmp`），Space 不列以点开头的条目，下次导出不受影响；下次启动时按下面「残留清理」删掉。
- **打开**。`videos.importPackage` 在项目目录里把包建成一个新视频（没有项目的会话先绑定到新项目，§3.10）：在来源目录里的隐藏暂存目录边核对边解开（格式与打包版本、每个文件的长度与 sha256、路径不越出包、条目种类只能是普通文件），再由引擎建成新视频。新视频有新的 `videoId`，实体的 ID 与修订号沿用包里的；引擎不信任清单，按登记的摘要重算文档与素材，按提交时的规则检查快照。更高的打包版本、摘要不符、路径越界（`..`、绝对路径、符号链接与硬链接条目）、清单与归档不一一对应都拒绝，不留下视频目录；暂存目录（`.baocut-import-<8 位十六进制>`）在任何结局下都删掉，进程被强杀时留下的由下次启动时的残留清理删掉。目录名取包里的视频名，重名时加序号。
- **残留清理**。Runtime 启动、Space 首次扫描之后在后台清一次上次被强杀留下的东西，只删同时满足三条的：名字符合 BaoCut 自己的命名；修改时间早于 1 小时（刚开始的导出与打开，包括别的进程里的，不会被删）；没有进行中的任务用着。导出的隐藏临时文件只在 Ledger 里还在的导出任务记下的目标目录里找，只认这些任务的输出文件名，排队、运行中的导出用到的文件名不碰；Ledger 已经剪掉的导出留下的临时文件找不到，留着。打开便携包的暂存目录只在来源目录的第一层找，跳过这个进程里进行中的打开。种类按 `lstat` 判断（临时文件是普通文件、暂存目录是目录），符号链接一律不碰，不往下找别的目录；回收站（`.bcut-trash`）与用户的文件名字对不上，不会被删。删不掉只记日志，不影响启动。所有成片、字幕等导出的发布都用同一种隐藏临时文件（§9.11），一并清理。
- **入口**。导出：`exports.create`（界面、CLI 的 `baocut export --kind portable`、Web 与智能体的导出工具，风险分级与其他导出相同）。打开：`videos.importPackage` 只开给桌面界面、CLI（`baocut import-package`）与 Web（文件必须在项目或会话工作目录里，按真实路径，`PATH_OUTSIDE_PROJECT`）；智能体工具与对外服务没有这个入口。
- **Space**。导出的便携包是一个导出得到的条目（种类 `package`，来源 `exported`，带文件大小，§5.7）；别处导出、放进来源目录的 `.baocut` 也按扩展名认作 `package`。

### 5.9 用户库

有些数据属于用户而不属于某一个视频，要在所有视频里复用。它们集中在 Runtime Home 的 `library/`，只经 Runtime 读写：

| 库 | 条目 | 被谁使用 |
| --- | --- | --- |
| 术语表 | 转写术语（规范写法与常见误听）；翻译术语（原文、译文、语言方向） | 转写的提示、文稿润色、翻译 |
| 音色 | 一段参考录音、它的原文、语言、来源与本人声明 | `synthesizeSpeech` 的音色参数、翻译配音 |
| 品牌库 | 叠加模板、贴纸与动态贴纸、图片与视频素材、品牌色、字体、字幕样式 | 编辑器的取用面板 |

规则对所有的库相同：

- **进入视频时拷贝**。视频使用库里的条目时，把它当时的内容拷进视频：素材走普通的素材导入并收进视频（`managed`：库里的文件不是用户的原文件，不能链接，§5.1），样式与模板成为视频里的实体，并在 Provenance 里记下来自哪个库条目的哪个版本。之后修改或删除库条目，不改变任何已有的视频。「用库里的新版本更新这个视频」是一次显式的编辑事务。拷贝是 `library.applyToVideo`，一笔普通的编辑事务，操作者按发起的连接认定（界面与 CLI 是用户）：图片、视频、贴纸、字体经 `importAsset` 以 `managed` 收进视频目录，Provenance 的 `origin` 为 `library`，`source.library` 记下 `library`、`entryId`、`version`、`contentHash`、`name` 与 `kind`；字幕样式经 `putDocument` 成为 `caption-style` 文档，扩展 `baocut.library` 记下同样的出处，给了 `captionItemIds` 时在同一笔事务里 `setCaptionStyle`。术语表、音色与颜色不是视频里的实体，拷贝以 `LIBRARY_ENTRY_NOT_APPLICABLE` 拒绝；它们由使用它们的步骤按引用冻结（见下）。
- **启用是视频自己的事**。库只保存内容。一个视频的哪一步用哪几张术语表、哪个说话人用哪个音色，记录在视频里；新视频的默认勾选是库条目上的一个标记（`defaultEnabled`）。记录的位置是视频里一份 `library-selection` 文档（视频格式规范 §4.6，每个视频至多一份）：按步骤列出启用的术语表（`transcribe` 只放转写用，`translate` 只放翻译用，靠前的优先），以及说话人的音色绑定（哪份转写的哪位说话人用哪个音色）。它记的是条目 ID，不是内容：用到时读当时的版本并冻结。没有这份文档等于什么都没启用。
  - **新视频**（`videos.create`，不含打开便携包）采用库里标了 `defaultEnabled` 的术语表：建好之后写一份这样的文档，行为者是 `system:library`，不进用户的撤销栈；没有默认启用的条目时不写；对外服务的客户端建的视频不采用。采用失败不影响新建，只记日志。
  - **读写**。`library.getVideoSelection` 读；`library.setVideoSelection` 改，是一笔普通的编辑事务（操作者按发起的连接认定，能撤销），给了的字段整体替换、没给的照旧。写入时只校验这次给的：术语表在库里、种类与步骤相符（否则 `LIBRARY_ENTRY_NOT_APPLICABLE`），`library:` 音色在库里且不带 `providerId`，说话人在那份转写里。之后库里删了的条目留在文档里，用到时再处理：转写跳过；翻译跳过并在摘要里列出；配音不合成那位说话人的句子并逐句报告（§7.9）。
  - **谁来用**。转写调用没有给 `glossaries` 时用视频启用的转写术语表（网关的 `models.transcribe` 与转录流程、智能体的 `transcribe` 相同）；翻译与配音的用法见 §7.9。对外服务的客户端不读这份文档。
- **条目有版本**。内容每变一次产生新的整数版本号与内容摘要 `contentHash`（规范化 JSON 的 SHA-256，键排序；文件以自己的摘要参与）；内容不变的 `put` 不产生新版本，`expectedVersion` 不符时 `LIBRARY_VERSION_CONFLICT`。任务冻结的是条目的版本与内容摘要（§6.2），不是「当前的库」：`JobRecord.library.entries` 记下它用到的每个条目，任务运行期间固定（pin）这些版本，固定期间旧版本保留可读；任务结束解除固定，旧版本在下一次写入这个条目或下次启动时清理。固定只在内存里：重启之后没有在跑的任务，只留当前版本。
- **可以交换**。每种条目有一种单文件的交换格式用于导入与导出（见下）。导入按文件内容判断类型并校验，不信任扩展名；导出不覆盖已有的文件。
- **外发单独授权**。音色的参考录音上传到在线 Provider 建立克隆，是一次数据外发：按 §12.5 逐个 Provider 授权，没有本人声明的音色不上传。上传前的唯一检查是 `assertVoiceUploadAllowed(voice, providerId)`（`@baocut/runtime-storage/library`），没有声明（`consent.declared` 与 `declaredAt`）时抛 `VOICE_CONSENT_REQUIRED`。Provider 侧的克隆标识记录在条目上（`clones`：`providerId → { voiceId, state: valid | stale, referenceHash, createdAt }`，`referenceHash` 是上传的那份参考录音的摘要），参考录音更换或条目删除后标为 `stale`；有克隆的音色删除后留下只含克隆记录的条目头，供删除请求使用。`synthesizeSpeech` 的 `voice: 'library:<id>'` 在提交时解析为这个条目在所选 Provider 上的有效克隆，Job 冻结音色条目；没有克隆或克隆已失效时以 `VOICE_CLONE_REQUIRED`（`details.reason`：`missing`、`stale`）拒绝，不换成别的声音。
- **克隆的建立与删除**。`library.createVoiceClone { id, providerId, name? }` 提交一个普通任务（`kind: 'voiceClone'`），进度、取消与失败都在任务里；同一音色的同一版本在同一 Provider 上的克隆还在排队或在跑时，返回那个任务。提交时依次检查，不通过时不建任务：对外服务的客户端不能用（`LIBRARY_ENTRY_NOT_APPLICABLE`）；要有本人声明（`VOICE_CONSENT_REQUIRED`）；Provider 要有克隆接口（`VOICE_CLONE_UNSUPPORTED`，首版只有 ElevenLabs 的即时克隆，§6.4）并且已启用（`CAPABILITY_NOT_CONFIGURED`）；参考录音没变的有效克隆已经存在时 `VOICE_CLONE_EXISTS`；上传参考录音是数据种类 `audio` 的外发，要有覆盖它的 Grant（§12.5，不发起审批）。执行时固定提交时的版本（已经不在时 `LIBRARY_ENTRY_GONE`），再按条目的当前版本查一次声明，排队期间撤回了声明就不上传；按 Grant 预留、上传（只发一次，不重发，重发可能在供应商那边多建一个克隆）、结算。建好后记进 `clones[providerId]`；上传期间参考录音换了，记下的直接是 `stale`。被替换的旧克隆随后请求远端删除，删不掉不让任务失败，留告警 `VOICE_CLONE_OLD_NOT_DELETED`（带旧的 `voiceId`）。结果是一份回执产物（`baocut.voice-clone/1`：冻结的音色版本、Provider、远端的 `voiceId`、参考录音摘要与适配器版本）。Runtime 停止或崩溃时在跑的克隆任务中断，不重新排队（§7.5）。`library.removeVoiceClone { id, providerId, localOnly? }` 先请求远端删除，删掉或远端已经没有（`remote`：`deleted`、`not-found`）才清掉记录；远端失败时记录保留，以 Provider 的错误码报告；`localOnly` 只清本地记录（`remote: 'skipped'`），用于 Provider 已经不可用的情况。条目删除时不自动删除远端克隆。
- **不进 Space**。库条目不是产物，不出现在 Space 目录里；从 Space 的产物「存到库」是一次拷贝（`library.put` 的 `source: { artifactId }`）。
- **不对外部程序开放**。库是本机用户的数据，按最小暴露只给本机的界面、CLI 与会话里的智能体：MCP 服务没有 `library.*` 工具；对外服务的客户端（MCP、模型接口服务，提交者 `kind: 'service'`）在转写里引用术语表、在合成里用 `library:<id>` 音色，都在 JobManager 里以 `LIBRARY_ENTRY_NOT_APPLICABLE`（`details.reason: 'service-client'`）拒绝，不创建任务；模型接口服务在审批之前就以 400 `INVALID_REQUEST` 拒绝 `library:` 开头的 `voice`。

**存储**。每个条目一个目录；JSON 都是临时文件加 rename 写入，没有条目头的目录（写到一半崩溃）在启动时删除。大文件按内容摘要命名，同一条目的各版本共享。

```
library/
  <glossaries | voices | brand>/<entryId>/   # entryId 的前缀：gls_、voc_、brd_
    entry.json                               # 条目头：当前版本、保留的版本、删除时间、音色的克隆
    versions/<n>.json                        # 每个版本的内容与摘要
    files/<sha256 hex>.<ext>                 # 参考录音、图片、视频、贴纸、字体
```

**条目**。

| 库 | 内容 | 校验与上限 |
| --- | --- | --- |
| 术语表 | `name`、`kind`、`defaultEnabled`、`terms`。转写用（`transcription`）：可选的 `language`，每条是规范写法 `canonical` 与误听写法 `misheard[]`；翻译用（`translation`）：可选的 `sourceLanguage`、必填的 `targetLanguage`，每条是 `source`、`target` 与可选的 `note` | 语言是合法的 BCP 47 标签；规范写法或原文不重复、不含换行 |
| 音色 | `name`、`language`、参考录音的逐字稿 `transcript`、`origin`（`recorded`、`imported`）、`consent`（`declared`、`declaredAt`、`statement`）、参考录音 | wav、mp3 或 flac，≤ 20 MiB，文件头相符且 ffprobe 能解码出声音；改声明文字时更新 `declaredAt` |
| 品牌库 | `name` 与 `kind`：`image`、`video`、`sticker`（图片或 Lottie）、`font`（ttf、otf、woff2）带一个文件；`color` 是 `#RRGGBB` 或 `#RRGGBBAA`；`captionStyle` 是带字符串 `schema` 的样式对象（≤ 64 KiB），拷进视频时成为文档正文 | 图片、贴纸、字体 ≤ 50 MiB，Lottie ≤ 10 MiB，视频 ≤ 4 GiB；`overlayTemplate` 只保留种类，`put` 以 `LIBRARY_KIND_RESERVED` 拒绝（§14） |

**交换格式**。导入时按内容认：front matter 里有 `format: baocut.glossary` 的文本是术语表；`format` 为 `baocut.voice-package` 的 JSON 是音色包；`baocut.library-item` 的 JSON 是品牌库的颜色或字幕样式；Lottie 的 JSON 与 `.lottie` 压缩包（zip 的中央目录里有 `animations/*.json` 或 `a/*.json`）是贴纸；png、jpeg、gif、webp 是图片（贴纸导入之后再改种类）；mp4、mov、webm、mkv 是视频；ttf、otf、woff2 是字体。单独的音频文件不能导入（音色还要逐字稿与授权声明），其余一律 `LIBRARY_FORMAT_INVALID`。

- **术语表**是 UTF-8 的 Markdown，≤ 4 MiB。front matter 里 `format: baocut.glossary`、`version: 1`、`name`（JSON 字符串或纯文本，省略时用文件名）、`kind`，转写用的可选 `language`，翻译用的可选 `source` 与必填 `target`，`default: true | false`（省略为 false）。正文恰好一张表，表前可以有说明文字；表头不分大小写，转写用是 `| Term | Misheard |`，翻译用是 `| Source | Target | Note |`。单元格里 `\|` 与 `\\` 转义；误听写法以 `,`、`，` 或 `、` 分隔，写法本身含分隔符时用 `\` 转义。

  ```markdown
  ---
  format: baocut.glossary
  version: 1
  name: "产品名"
  kind: transcription
  language: zh-CN
  default: true
  ---

  | Term | Misheard |
  | --- | --- |
  | BaoCut | 宝卡特, 包剪 |
  ```

- **音色包** `.bcvoice` 是一个 UTF-8 的 JSON 文件，参考录音以 base64 内嵌：`format: "baocut.voice-package"`、`version: 1`、`name`、`language`、`transcript`、`origin`、`consent`、`reference: { fileName, mediaType, sha256, byteLength, data }`。整个文件 ≤ 32 MiB，录音 ≤ 20 MiB。导入时校验格式与版本、字段、base64、解出的长度与摘要、文件头是 wav、mp3 或 flac 且与 `mediaType` 一致，最后用 ffprobe 解码一遍；包里的声明时间沿用。各 Provider 上的克隆不导出：换机器或换账号都要重新克隆。
- **品牌库**带文件的条目导出原文件；颜色与字幕样式导出 `{ "format": "baocut.library-item", "version": 1, "library": "brand", "content": { … } }`。

**转写用术语表**。`models.transcribe` 的 `glossaries: [{ id, version? }]`（最多 20 张，只能是转写用的，否则 `LIBRARY_ENTRY_NOT_APPLICABLE`）在提交时解析并冻结；解析在 JobManager 里，网关的 `models.transcribe` 与转录流程（智能体的 `transcribe` 工具，用视频启用的术语表）走同一条路，合成的 `library:<id>` 音色同样。模型接受提示（`acceptsHint`）时，各表的规范写法按顺序去重、用「、」连接，接在用户提示的下一行，整体不超过 1200 字，放不下的写法舍去并计数；不接受提示时忽略术语表，不报错。`JobRecord.library.glossaryHint` 记下 `status`（`sent`、`unsupported`）、送出的条数与舍去的条数。误听写法不进提示，留给文稿润色。

`library` 命名空间提供 `list`、`get`、`put`、`remove`、`import`、`export`、`applyToVideo`、`getVideoSelection`、`setVideoSelection`、`createVoiceClone`、`removeVoiceClone` 与短期文件句柄 `openHandle`（命令与协议规范 §4.1）；变化经 `library` 主题送达（快照是全部条目的摘要，之后是 `entry.upsert` 与 `entry.removed`）。CLI 是 `baocut library`（克隆是 `baocut library voice-clone <id> --provider <p>` 与 `voice-clone-remove <id> --provider <p> [--local-only]`；视频里启用的条目是 `baocut library video-selection <videoId>`，带 `--transcribe-glossaries`、`--translate-glossaries`、`--speaker-voice <转写>:<说话人>=<音色>[@<Provider>]` 时改）。

由测量得到的统计（例如各合成模型在各语言下的语速分布）是派生数据，放在缓存里，可以删除后重建，不属于用户库。

### 5.10 偏好设置

偏好设置分两处存放，按「谁需要读它」划分：

- **Runtime 持有**：影响任务、CLI 与智能体结果的设置。例如字幕的目标行长、转写完成后的后续动作、默认保存位置、默认 Driver 与模型（§3.11）、能力默认值（§6.8）、更新与诊断的开关。保存在 Runtime Store，经 `settings.get`、`settings.set` 读写，变化经 `settings` 主题送达；任务在创建时冻结它用到的取值。
- **界面持有**：只影响这一个界面呈现的设置。例如界面语言、外观、快捷键绑定、面板布局。保存在界面自己的存储里，不经过 Runtime。
- **新字幕属性偏好**由客户端自己的存储记住（产品设计 §5.9），桌面端与 Web 各自保存。只记成功提交的属性修改，原文与译文的外观覆盖分别记；打开已有视频不修改偏好，也不覆盖它的样式文档。生成、翻译、导入新字幕时，把偏好写进视频的 `caption-style` 文档，与字幕实例同一笔事务；CLI 与智能体未指定样式时仍用默认预设。
- **界面语言**两处都有：界面在自己的存储里保存偏好（`system` 或一种出货语言），按它与系统语言解析出当前语言；桌面端同时把偏好写进 Runtime 的 `ui.language`，Runtime 与 CLI 生成的文字（错误、任务说明、通知）按它取语言；连上时以界面的偏好为准，之后别处（CLI）改了 `ui.language`，桌面界面跟着换。Web 客户端只改自己的界面。`system` 时 Runtime 看桌面端拉起它时传的 `BAOCUT_SYSTEM_LANGUAGES`，再看 POSIX 区域设置；系统语言没有对应的出货语言时用英文。`BAOCUT_LOCALE` 优先于一切（测试与排查用）。
- **已经存下的文字也跟着语言换**：Runtime 给人看的文字除了生成时语言的文本，还带消息引用（`key` + `params`，字段 `foo` 旁的 `fooRef`），记录与事件里一起存。界面与 CLI 按自己的当前语言用引用重新生成，认不出的引用或没有引用的旧记录照用文本。约定见[仓库约定 §5](../repo-conventions.md#5-文案与多语言)。

设置项的注册表是合同的一部分（`@baocut/protocol` 的 `settings.ts`，校验用的 schema 在 `schemas.ts`）：每个键有稳定的名字（点分的小写名，发布后不改名）、schema、默认值与一句说明。

- **整批校验，原子生效**。`settings.set { values }` 里有一个未知的键或一个不合 schema 的值，整批以 `invalid-request` 拒绝，一个也不保存。校验通过后写临时文件再改名，写盘成功才换内存、发通知；写入串行执行，崩溃不留半份文件。
- **`null` 恢复默认值**。等于默认值的取值不另存，文件只记与默认值不同的取值，所以「是默认值」就是「没有改过」。`settings.get { keys? }` 返回 `{ settings, defaults }`（有效值与默认值，不给 `keys` 时是全部键）；`settings.set` 返回新的完整视图。
- **`settings` 主题**。订阅时先给全部键的快照，之后每次有效值变化发一条 `settings.updated`，只带变了的键与新的有效值；没有变化的修改不发。
- **文件**：`<runtime-home>/store/settings.json`，带 `schemaVersion`。读到不合 schema 的取值（手工改坏的）按默认值处理；读到不认识的键（更新的版本写下的）原样保留、不生效；文件整个不是合法的 JSON 时 Runtime 启动失败，与其他 Store 文件一致。
- **冻结**。任务与会话创建时按键取一份副本连同来源（用户设的或默认值），之后改设置不影响它们：新会话冻结默认 Driver，Driver 没有注册时以 `driver-unavailable` 拒绝创建，不改用别的；新任务冻结访问模式，记在任务卡片上（`autonomy.source`：`request` 发送时显式给出、`conversation` 会话切换过的、`setting` 来自 `agent.defaultAccessMode`、`default` 内置默认）。发送时显式给出的优先于会话的模式，会话的模式优先于设置；任务进行中切换会话的模式时，任务改用新模式（§3.12）。
- **不在这里的**：凭据（§6.8），注册表不放密钥、令牌或密码；模型能力的默认 Provider 与模型由 `models.setDefault` 管（§6.8）。

首批键：

| 键 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `agent.defaultDriver` | Driver id 或 `null` | `null`（内置默认 `codex`） | 新会话用的 Driver（§3.11） |
| `agent.defaultModel` | 模型 id、`__agent-default__` 或 `null` | `null`（推荐模型） | 新会话的模型：只用于默认 Driver 的会话，且该 Driver 的 Agent 偏好里没有默认模型时；`null` 用推荐模型（Claude Code 的 Sonnet、Codex 的 `-sol`），`__agent-default__` 不传模型、按 Agent 自己的 CLI 配置；会话创建时冻结，每轮交给 Driver（§3.11「默认模型与推荐模型」） |
| `agent.defaultEffort` | 推理强度或 `null` | `null`（Driver 自己的默认） | 新会话的推理强度，规则同上 |
| `agent.defaultAccessMode` | `plan` `ask` `autoAcceptEdits` `auto` `fullAccess` | `auto` | 没有切换过模式的会话用它（§3.12）。写入时也接受旧值 `controlled`、`authorized`，按 `ask`、`fullAccess` 保存；文件里存着的旧值读出时同样换掉 |
| `ui.language` | `system` 或一种出货语言（`LOCALES`：`zh-Hans` `zh-Hant` `en` …） | `system` | Runtime 与 CLI 生成文字用的语言；桌面端随界面语言偏好写入（见上） |
| `captions.maxLineLength` | `{ cjk, other }`（字符数） | `{ cjk: 16, other: 42 }` | 自动断行的目标行长：中日韩文字与其余文字分开 |
| `transcribe.afterComplete` | `open-video` `notify` `nothing` | `open-video` | 转写完成后的后续动作 |
| `downloads.directory` | 绝对路径或 `null` | `null`（运行主机的下载文件夹，§7.9） | 默认保存位置：工具没有视频的结果、从链接下载的媒体与 `downloads_save` 交出的文件都放这里；给了时一律用它（§7.9「保存位置」） |
| `models.downloadEndpoint` | `http(s)://` 基址或 `null` | `null`（公共模型仓库 `https://huggingface.co`） | 本地模型的下载来源（镜像）；不带凭据、查询参数与片段；环境变量 `BAOCUT_MODELS_ENDPOINT` 优先（§6.3） |
| `models.dir` | 绝对路径或 `null` | `null`（`<runtime-home>/models`） | 本地模型目录。只能经 `models.setDir` 改（`settings.set` 以 `invalid-request`、`SETTING_MANAGED` 拒绝），因为要先查在用、卸 Worker、选移动还是只换位置；环境变量 `BAOCUT_MODELS_DIR` 优先，这时只读（§6.3） |
| `tools.downloadEndpoint` | `http(s)://` 基址或 `null` | `null`（清单里的官方发布地址） | 受管外部工具的下载来源（镜像），地址为 `<基址>/<工具>/<版本>/<文件名>`；不带凭据、查询参数与片段；环境变量 `BAOCUT_TOOLS_ENDPOINT` 优先（§12.9） |
| `fonts.autoDownload` | 布尔 | `true` | 预览与导出用到字体目录里有、本机没有的族时自动下载（§9.1）；关掉时照回退字体画，导出给出 `FONT_NOT_DOWNLOADED` 警告 |
| `fonts.cssEndpoint` / `fonts.fileEndpoint` | `https://` 基址或 `null` | `null`（`https://fonts.googleapis.com` / `https://fonts.gstatic.com`） | 按需下载字体的样式表接口与字体文件主机（镜像）；只接受 `https`，不带凭据、查询参数与片段；文件地址必须在文件主机的基址之下（§9.1） |
| `updates.autoCheck` / `updates.autoDownload` | 布尔 | `true` / `true` | 应用更新的偏好（§2.6） |
| `cache.maxSizeMiB` | 256–1048576 的整数（MiB） | `2048` | `<runtime-home>/cache/` 的总大小上限：启动后与每小时核一次，超限按修改时间删最旧的降到 90%（§5.1） |
| `space.trashRetentionDays` | 1–3650 的整数（天） | `30` | Space 回收站的保留期：移入回收站超过这么多天的条目在没有引用时物理删除（§5.7） |
| `resources.capacity` | `{ memoryMiB, gpuMemoryMiB, cpuThreads }`（每项可为 `null`）或 `null` | `null`（按本机探测） | 高级：覆盖资源调度看到的容量；某项为 `null` 时照旧自动（§7.6） |
| `runtime.idleExitMinutes` | 1–1440 的整数（分钟） | `10` | CLI 拉起的 Runtime 空闲（没有在用的本机网关连接、没有排队或运行中的任务、没有开着的对外服务；只查状态的 CLI 连接不算在用）满这么久自己退出（§2.2）；桌面端与手动启动的不受影响 |
| `diagnostics.enabled` | 布尔 | `false` | 匿名使用统计与性能摘要（§12.6） |
| `offline.strict` | 布尔 | `false` | 严格离线（目前拒绝本地模型的下载（§6.3）、受管外部工具的下载（§12.9）、字体的下载（§9.1）与从链接导入（§7.9）；尚未拦截在线调用；产品设计 §12） |

CLI 的 `baocut settings`（列出键、当前值、是否默认）、`settings get <键>`、`settings set <键> <值>`（值按 JSON 解析，解析不了按字符串）与 `settings reset <键>` 用的是同一组方法。

### 5.11 跨视频的内容检索

`speech.search` 检索的是一个已打开的视频（§3.7）。在所有视频里按文稿、译文、章节与说话人查找，用 Runtime 维护的一份内容索引：

- 它是派生缓存（§5.1），按视频保存「索引时的视频版本」；视频提交新版本后，该视频的条目增量重建。索引整体删除后可以重建，重建期间检索结果标明不完整。
- 索引由 Runtime 经 VideoService 的只读查询生成，不直接读 `video.db`；没有打开的视频也可以被检索，检索不打开视频，也不占视频的写锁。
- `space.search` 返回视频、文档种类、时间位置与片段，按主体与对外服务的范围过滤（§4.8）。命中带的时间位置以索引时的版本为准，打开视频后由客户端按当前版本重新定位。

**这个版本的实现**（`packages/runtime-core/src/space/content-*.ts`）：

- **读取**。Engine Host 的内部只读查询 `videos.readContent`（不在网关的方法表里）给出视频快照与文字类文档（转写、字幕、译文）的当前正文，转写与字幕另带根序列上的时间线投影（与导出同一个 `plan_text`）。已经打开的视频用打开的那一份，没有打开的以只读方式打开、读完就放下，不取写锁。
- **缓存**。一个 SQLite 库 `<home>/cache/content-index/index.db`（Node 内置的 `node:sqlite`，WAL，另有 `-wal` / `-shm` 旁文件）：`videos` 表每个视频一行（目录真实路径为主键，记 videoId、索引时的版本、目录的修改时间与视频事实 JSON）；`segment_rows` 表是可检索的段落（原文、NFKC 小写后的正文、时间、种类、说话人，按目录建索引）；`segments` 是建在正文上的 FTS5 外部内容表（trigram 分词），由触发器同步。每个视频的段落在一个事务里整体替换。一次只读一个视频。格式版本记在 `PRAGMA user_version`：不符、文件不是库或打不开时关掉连接、删库（含旁文件）重建、全部重读，不迁移；旧的 `<摘要>.json` 启动时删掉。`space.rebuildIndex` 不删库：全部标成待重建后排队重读，重读完之前旧段落照样可查、结果标明不完整。库打不开时降级：记录与事实只留在内存，检索没有命中，记一条警告。
- **匹配**。NFKC 与小写，按空白切词，同一段里全部出现才算命中（AND），中文不分词，不排相关度，按调用方给的视频顺序（最近活动在前）、视频内按时间。三个码点以上的词走 FTS5 MATCH（每词一个加引号的短语），更短的词（常见的两字中文）trigram 用不上，退回 `instr` 子串过滤；`kinds` 用 `IN`，说话人按规范化后的子串。候选段落最后都按同一套子串规则再核对一遍并生成片段，所以结果与子串匹配等价。
- **视频事实**。Space 目录要用的（时间线上用到的素材、链接素材，§5.7），与工具的候选输入要用的（§7.9），后者都从 `videos.readContent` 已经给出的正文、投影与快照里取：
  - 文稿（`speech` 文档）：文档 ID、语言、有没有逐词时间（有可见的词，且没有一个词的 `timingQuality` 是 `estimated` 或 `missing`）、在不在时间线上（根序列上的投影有内容）。
  - 译文：文档 ID、目标语言、译自的文稿（文档头的 `sourceDocumentId`，或正文 `sourceBasis` 里的转写）、单元数与过期的单元数。过期按配音的规则（§7.9）：标成过期、原句不在了、指纹不符、译文为空；`/1` 的译文没有指纹，只数标成过期的与空的；译自的文稿不在视频里时全部算过期。术语表改过（`glossary-changed`）要读用户库，索引里不判断，配音时照样会查。
  - 配音组：组 ID、语言、配音计划、用的译文与它译自的文稿、时间线上的配音实例数。`dubbing-plan` 文档（摘要里的 `groupId`）与带 `baocut.dub` 扩展的实例合起来，分离出的背景声与人声不算实例。
  - 封面（`space.thumbnail` 用，§5.7）：封面那一帧的素材 ID、版本、源时间，与那个版本的内容摘要、媒体类型和时长；不记文件路径。没有可见画面时为 null。
  - 时长与画布尺寸（视频条目的 `media`，§5.7）：根序列的时长（最晚结束的实例，按序列帧率换成秒；与智能体工具的视频摘要同一个 `sequenceDurationFrames`，不看 `durationPolicy`）与画布的宽高。快照不全时为 null。
- **增量**。视频目录来自 Space 目录的扫描：新出现的读一次；修改时间变了先用 `videos.inspect` 看版本，版本没变只记下新的修改时间；已打开的视频提交新版本时由 VideoService 的变化通知触发重读。从来源目录里消失的视频连同缓存文件删掉。要某个还没有当前索引的视频（`space.thumbnail`）时把它排到队首，只等这一个。
- **重建**。`space.rebuildIndex` 删掉缓存，全部视频排队重读；重读完之前旧的记录仍可检索，但算作待索引。读不了的视频（引擎不可用、旧版引擎没有 `videos.readContent`、库损坏）也算待索引，等下一次变化或重建再试。有待索引的视频时结果 `complete: false`，`pendingVideos` 是个数。
- **段落**。转写与字幕按导出的句子切分（`segmentsOf`），时间是序列时间；文档对应的素材不在时间线上（投影为空或出错）时退回源时间（`clock: 'source'`）。译文借用转写那一句的时间：`baocut.translation/2` 按 `sourceSentenceId`，转写没有存句子时按对齐的词或句子 ID 里的首词；`/1` 按单元 ID；过期的单元不收。章节是根序列上 `kind: 'chapter'` 的标记的标题与简介。说话人取转写或字幕里的名字。
- **匹配**。不引入检索库：文字做 NFKC 与小写之后逐段子串匹配，空白隔开的几个词都要在同一段里出现；可以只按说话人找。中文不分词，子串本身就是按字符的匹配（「剪辑」能找到「视频剪辑」），代价是没有词边界（「剪」也会命中「剪刀」）。没有相关度排序：按视频的最近活动，同一个视频里按时间。每次检索线性扫一遍范围内的全部段落；几千个视频、每个几百段时在几十毫秒以内，再大时换成按二元组（bigram）的倒排索引，接口不变。

---

## 6. Models

### 6.1 能力 × 来源

Models 模块把模型服务组织成两条互相独立的轴：**能力**说明要做什么，**Provider** 说明由谁来做。同一能力不绑定某一个供应商。

**能力**。每种能力有一份能力合同：输入参数、`outputContract`（§6.4）与应用到视频的方式。

| 能力 | 输出合同 | 应用到视频 |
| --- | --- | --- |
| `transcribe` | `baocut.asr-result/v1`（§6.6） | 写一份 `speech` 文档 |
| `synthesizeSpeech` | 音频文件，附时长、采样率、声道与可选的词时间 | 导入为音频素材，作为候选；不自动放上时间线 |
| `generateImage` | 图片文件，附尺寸与可用的 seed | 导入为图片素材，作为候选 |
| `generateText` | 纯文本，或符合给定 JSON Schema 的结构化文本（译文、润色结果、章节、标题与简介候选） | 由发起它的流程校验后写入对应的文档，或作为候选（§7.9） |
| `separateAudio` | 人声与背景两条音频，与输入等长、采样率相同 | 由配音流程校验后作为背景声与人声两轨放上时间线（§7.9）；执行者只有本地 Provider |
| `analyzeVision` | 按用途的时间化标注：人物位置、发言人判断、内容区域 | 作为分析产物，供智能裁剪等流程读取；不直接改视频 |

强制对齐、语音分析、说话人分离、视频生成按同一模式加入：一份能力合同，加上实现它的 Provider。不能让模型编造精确的视频帧。

- **`generateText`** 是文本模型的调用：输入是有序的消息与输出格式（纯文本，或 JSON Schema 约束的结构化输出），结构化输出必须通过 schema 校验（§6.4）。翻译、润色、分章这类逐句或逐段的工作用它完成，不为每一句创建完整的 AgentSession。它有两个入口，走同一条执行路径：`models.generateText` 提交一个 Job，结果发布为文本产物并留下生成记录（§7.9）；Runtime 里的流程经进程内的 `TextGenerator` 直接调用，不建 Job，与 Job 共用每个 Provider 的并发上限与重试，并累计调用、重试与失败的次数。它的 Provider 首批只有在线 API，局域网节点不共享它（§6.7）；默认模型、推理强度与并发上限是这种能力的配置（§6.8）。同一件事由谁完成取决于入口：从会话发起的由智能体完成，从工具入口发起的由 `generateText` 完成（§7.9）。两条路写入视频时走同一种编辑事务。
- **`separateAudio`** 只在配音流程里使用，执行者接口是 `DubSeparator`（输入转写来源素材的文件，输出人声与背景两个文件）。它的实现是本地 Provider：模型是 `separate` 本地模型包（目前只有 HTDemucs-FT，§6.3），按 §6.2 选——用户默认值，否则出厂默认（已安装、可用、没停用的第一个，按 ID），选不出可用的就当没有执行者。配音提交时选定并冻结模型包（`separatorModel`）与它的权重估计，重试照用；执行时那个模型包已不可用，这一步以 `CAPABILITY_NOT_CONFIGURED` 失败，不换别的。在它的 Model Worker 里整段分离（Model Worker 协议规范 §2.5.4），输出采样率取输入音轨的；Provider 的失败换成这一步的错误码（`MODEL_LOAD_FAILED`、`MODEL_WORKER_CRASHED`、`INPUT_UNREADABLE`、`MODEL_OUTPUT_INVALID`；输出写不进 staging 是 `STAGING_WRITE_FAILED`，不算崩溃）。能力视图列出 `separateAudio`（只有本地 Provider），默认值经 `models.setDefault` 设置；在线分离服务没有接入，也没有单独的分离命令，API 提供方（§6.4）、自建端点声明的模型与对外模型接口（§4.8）不涉及它。输出合同：人声与背景各一条 ffprobe 能解码的音频，时长与输入相差不超过 20 毫秒，采样率与输入相同。容器时长由最长的流决定，Worker 按音轨写出的两路与它相差超过 20 毫秒时，执行者用 ffmpeg 把两路补齐到容器时长（短了补静音，长了截掉）。不合约定是 `MODEL_OUTPUT_INVALID`（`details.problems` 逐项列出），不重试。没有可用的分离模型包时，要求分离的配音照常接受，分离这一步记为 `skipped`，如实报告，不改用别的处理（§7.9）。
- **`analyzeVision`** 按用途分别选择模型：每种用途（人物定位、发言人判断、内容区域）有自己的默认模型，互不替代。
- **`synthesizeSpeech` 的音色**有三种给法，由 Provider 描述声明支持哪几种：预设音色的 ID；参考录音加原文（克隆，来自用户库的音色或视频里的一段，§5.9）；一段文字描述。不支持某种给法的模型在提交时拒绝，不换成别的声音。模型描述的 `voiceModes` 声明接受 `preset`（模型自带、`voices` 里列出的音色）还是 `custom`（供应商账号里的音色 ID，原样交给供应商核对）；`defaultVoice` 为 null 的模型必须给出音色。读音标注（多音字）是输入文本的一部分（`<字|读音>`，读音写声调数字或带调拼音，解析时规范成声调数字，写法见 Model Worker 协议规范 §2.5.2），由适配器转成各模型自己的写法；模型不支持时如实报告，不静默丢弃。
- **本地合成**（`provider: 'local'`）的模型是 `synthesize` 的本地模型包（§6.3），模型描述另带 `local`：模型族、原生采样率、慢不慢、内置音色是录音还是描述、参考录音的建议时长与读不读原文、描述是自由文本还是封闭词表、接不接受语气说明与情绪、旋钮（`speed`、`cfg`、`steps`）的范围、时长上限、读音标注的写法（同音字、行内拼音、标注或不支持）与许可；念不了的读音标注不让任务失败，按表面文字合成，结果带 `reading-dropped` 警告。三种给法对应请求的 `voice`（模型的说话人或内置音色）、`reference`（参考录音文件加可选的原文；`library:<id>` 直接用音色库条目的录音，不需要在线克隆）与 `voiceDescription`，至多给一个。声音在提交时决定并冻结：不指定时克隆模型用内置音色（随应用分发的一段录音，按请求的语言挑，没有那种语言时取第一只），说话人模型用默认说话人；参考录音（含内置音色的）在提交时读出摘要与长度冻结进 `generation.reference`，执行前按摘要再核对一次，变了或读不出时任务以 `ASSET_MISSING` 失败，不换声音。输出是 WAV。不可商用的模型（OmniVoice 的权重是 CC-BY-NC）在 `license.commercialUse: false` 里说明，由界面在选用前提示。
- **本地生图**（`provider: 'local'`）的模型是 `image` 的本地模型包（§6.3）。模型描述：一次一张、只出 PNG、不收参考图、接受 `seed`、免费；尺寸只取模型包列出的几档（Qwen-Image-2.1 是长边 1024 的 1:1、16:9、9:16、4:3、3:4、2.35:1，默认 1:1；另收不进画幅菜单的 512×512，供设置页「试画」），请求可以给 `size` 或宽高比，别的在提交时拒绝；提示词至多 1024 个码点；`notes` 提示它在本机生成、要几分钟（candle 在 CPU 上时照实提示要几个小时，§6.5）。`seed` 在提交时冻结：请求没给就抽一个（0..2^32-1）写进 `generation`，重试与重新执行得到同一张图。去噪步数是请求的 `steps`，范围由模型描述的 `local.steps` 给出（Qwen-Image-2.1 为 8–40，界面一次加减 4），不给时用模型的默认值（20）；给了就冻结进 `generation`，在线模型收到 `steps` 在提交时拒绝。不可商用的模型（Qwen-Image 的许可只许研究与评估）同样在 `license` 里说明。

**Provider**。来源分三类，实现同一个按能力划分的接口，输出同一份合同；JobManager 之后的校验、发布与应用不分来源（§7.1）。

| 来源 | `providerId` | 在哪里执行 | 实现 |
| --- | --- | --- | --- |
| 本地 | `local` | 本机的 Model Worker（§6.5） | TypeScript 的本地 Provider 加 Rust Worker |
| 局域网节点 | `node:<nodeId>` | 另一台机器的 Model Worker（§6.7） | TypeScript |
| 在线 API | API 提供方目录里的 `openai`、`anthropic`、`google`、`deepseek`、…（§6.4），以及用户自定义的兼容端点 | 供应商的服务 | TypeScript（§6.4） |
| 智能体 | `agent:<driverId>`，首版只有 `agent:codex` | 本机已安装并登录的智能体运行时 | TypeScript（§6.9） |

在线 Provider 按 **API 提供方**组织：一个 `providerId` 是一家模型厂商、一个中转平台或一个自建端点的接入，它的账号（密钥）对这家提供方实现了的全部能力共用（§6.4、§6.8）。能力与 Provider 仍是两条轴：同一把 OpenAI 的密钥既用于 `generateText`，也用于 `transcribe`、`synthesizeSpeech` 与 `generateImage`，每种能力的默认值照旧各自设置。

**Provider 描述**。每个 Provider 向注册表声明：支持哪些能力；每种能力下有哪些模型；每个模型的限制与特性（输入大小与时长上限、语言、是否返回词级时间、是否接受提示词、音色、图片尺寸、费用状态）；此刻是否可用以及不可用的原因。路由之前按描述检查语言、时间标记、音色、格式、图像输入、输出大小、权限与预算；不满足的在提交时拒绝，不在执行到一半时失败。Provider 之间的差异只出现在描述里：例如在线转写不返回词级时间时，结果的 `timingQuality` 标为 `estimated`，与本地没有对齐器时相同（§6.6）。

返回统一的领域产物，并归档可审计的原始响应。

### 6.2 选择、默认值与失败策略

**选择的顺序**。一次调用用哪个 Provider 与模型，按下面的顺序确定，取第一个给出的：

1. 调用参数里显式给出的 `provider` 与 `model`；
2. 用户为这种能力设的默认 Provider 与默认模型（§6.8）；
3. 出厂默认：只有 `transcribe` 与 `separateAudio` 有，本机已安装可用的本地模型包时用 `local`（`separateAudio` 取按 ID 的第一个）。`synthesizeSpeech`、`generateImage` 与 `generateText` 没有出厂默认，本地 Provider 提供它们之后也没有；
4. 都没有：调用以 `CAPABILITY_NOT_CONFIGURED` 拒绝。

没有自动的本地优先、云端兜底或故障转移。出厂默认不指向任何在线 Provider：素材离开本机必须出自用户的配置或显式选择。

细则：只给 `provider` 时，用户默认值指向它就用默认值的模型，否则用它的默认模型；只给 `model` 时，先看默认的 Provider（用户默认值或出厂默认）有没有它，再看 `local`，再看唯一列出它的 Provider，多个 Provider 都有时要求同时给出 `provider`。选中的 Provider 或模型不可用时直接拒绝，不往下一条落，也不换 Provider；显式给出而不存在的 Provider 或模型是 `not-found`。节点写作 `node:<nodeId>`，也接受 `node:<别名>`，选中后换成 `nodeId` 冻结；节点没有列出的模型包照样放行，交给节点的预检（§6.7）。

实际任务冻结 `providerId`、`modelId`、版本或 manifest、参数、输入和策略决策。生成任务在提交时按模型描述检查并补全全部参数（音色、语言、格式、语速、尺寸、张数、seed），冻结在 Job 记录的 `generation` 里；执行与恢复只读这一份。

- 重试不得无提示更换模型或音色。生成任务不自动重试：在线 Provider 的有界重试（§6.4）之后仍然失败就是失败，再生成是一个新的任务。
- 从免费转付费、从本地转云端，都必须重新验证授权（§12.5）。
- 不可用的能力准确显示原因：没有配置、缺密钥、缺安装、未连接、权限不足或不支持。此时手工编辑与其他本地能力仍然可用。

**没有配置时**。`CAPABILITY_NOT_CONFIGURED` 是结构化的结果而不是泛化的错误：`details` 给出能力、原因（`no-default`、`missing-credential`、`not-installed`、`signed-out`、`outdated`、`not-paired`、`not-connected`、`disabled`、`unsupported`；`signed-out` 与 `outdated` 只出自智能体 Provider，§6.9）与可行的补救（`remedy.action`：`configure-provider`、`enable-provider`、`set-default`、`install-model`、`pair-node`、`setup-agent`，附一句给人看的 `hint`）。它在提交时给出，不创建任务。智能体据此向用户说明，界面给出进入设置的入口。没有默认值（`no-default`）时：已有可用的 Provider 是 `set-default`；`transcribe` 与 `synthesizeSpeech` 有没装的本地模型包时是 `install-model`；`generateImage` 即使有没装的文生图模型包也是 `configure-provider`——界面开页只回落到已连接的云端模型，本机生图要用户自己选或设为默认。

设置中分别显示 Agent Driver 的配置与各模型能力的配置，按任务需要引导。

### 6.3 本地模型管理

Node 管理模型目录、版本、下载计划、校验与资源准入；Rust Worker 持有权重和设备上下文。

状态：`not-installed`、`downloading`、`installed`、`loading`、`ready`、`busy`、`unloading`、`error`。具体进度未知时不伪造百分比。`models.list` 与 `models` 主题里的模型包状态另带 `estimatedBytes`（必需组件按内置清单的下载大小，装没装都给，供下载前显示大小；不知道时为 null）、`components`（每个组件的仓库、版本、装没装、大小、与哪些模型包共用，登记了自己许可的组件另带许可）、`install`（安装进度：`queued`、`downloading`、`verifying` 或 `paused`，已收到与总共的字节，总数未知时为 null）与 `selfTest`（最近一次检查）。`models` 主题的快照是 `{ capabilities, bundles }`，模型包的状态变化发 `bundle.updated`。

**目录与组件**。模型目录按能力分类列出可安装的模型包：`transcribe` 的识别模型包（Qwen3-ASR 的 0.6B 与 1.7B，MLX；Whisper large-v3 与 large-v3-turbo，Core ML；MOSS-Transcribe-Diarize，MLX 8 bit）、`synthesize` 的合成模型包（Qwen3-TTS 的五个变体、IndexTTS2、IndexTTS 2.5、GPT-SoVITS v2、VoxCPM2、OmniVoice）与 `image` 的文生图模型包（Qwen-Image-2.1 的 MLX 4bit 包，一个约 9.8 GB 的仓库，文本编码器、DiT 与 VAE 都在里面；Apple Silicon 以外的平台列同一个仓库的 candle 变体 `qwen-image-2.1@candle`，加载时反量化，§6.5）与 `separate` 的分离模型包（HTDemucs-FT；上游 `facebookresearch/demucs` 的代码与权重是 MIT；Apple Silicon 以外的平台列同一个仓库的 candle 变体 `htdemucs-ft@candle`，fp16 权重加载时升成 f32，§6.5）与 `diarize` 的「说话人区分」模型包（`speaker-diarization@mlx`，Apple Silicon 以外的平台列同一批仓库的 `speaker-diarization@candle`；Pyannote segmentation-3.0 分段，上游 MIT，加 WeSpeaker ResNet34-LM 声纹，两个组件都必需）；合成只有 MLX，只在 Apple Silicon 的 macOS 上可用，别的平台报告为 `error` / `unsupported`。模型包的状态带名字与许可（`label`、`license`）。一个模型包由自己的权重与若干公共组件组成（例如多个识别模型共用的 VAD、对齐器，五个 Qwen3-TTS 共用的语音编解码器，IndexTTS 2.5 借用的 IndexTTS2 仓库）。公共组件安装一次，按引用计数保留，最后一个使用它的模型包被删除时一起回收；缺组件的模型包报告为不完整（`not-installed`、`reason: 'incomplete'`，`detail` 点名缺的组件），安装只补缺的部分，不整包重下。几个模型包共用、后来才加进来的组件（对齐器、说话人模型）可以登记为**可选**：安装与修复照样下载它，但缺它时模型包仍算装好（组件状态带 `optional: true`），交给 Worker 时略去，已经装好的模型包不因为登记里多了它而变得不完整。五个识别模型包都带可选的强制对齐器（`Qwen3-ForcedAligner-0.6B` 的 MLX 4bit 包）：装了，本地识别的词时间是对齐出来的，`local` Provider 才报告原生词级时间；没装时报告没有词级时间。MOSS 只对齐长于 5 秒的行，装了对齐器也报告没有词级时间；它没有识别提示的通道，报告不收提示。组件可以带与主模型不同的许可：对齐器取上游的 Apache-2.0；说话人模型（WeSpeaker ResNet34-LM，MOSS 模型包的可选组件、「说话人区分」模型包的必需组件，同一个仓库装一份）取上游 pyannote 的 CC-BY-4.0，须署名 WeSpeaker 与 pyannote.audio——MLX 转换包的模型卡标 MIT，以上游为准；署名（作品 `wespeaker-voxceleb-resnet34-LM`、出处 WeSpeaker 与 pyannote.audio、许可、MLX 格式转换）写在组件许可的 `summary` 里。组件状态带上组件自己的许可（`license`）；界面在模型详情的「许可」行列出权重的许可，再给要署名（CC-BY）或许可与权重不同的组件各列一条。对齐器的 Apache-2.0 与 whisper.cpp GGML 转换的 MIT 只在再分发时要求附许可与 NOTICE，BaoCut 不分发权重（从上游下载），对齐器的仓库也没有 NOTICE 文件，所以都不需要另加提示。组件可以只取仓库里的一个子目录（`subdir`，例如一个仓库放着多个 Whisper 变体）：安装、校验与装没装好照旧按整个仓库算，交给 Worker 的是这个子目录与其下的文件。引用由模型目录里的安装记录（`.bcut-installs.json`）算出：一个组件的持有者是用到同一仓库与版本、在记录里或文件齐全的模型包；仓库目录里是别的版本时不删。

**说话人区分模型包**。它没有检查（`models.test` 以 `unsupported` 拒绝），也不单独提交任务；只有给已有转写区分说话人的 `speakers` 流程（§6.6）单独起一个只装它的 Worker。Qwen3-ASR 与 Whisper 的识别模型包登记用哪个（Core ML 的 Whisper 用 MLX 的，GGML 的 Whisper 与 candle 的识别模型包用 candle 的；MOSS 自己区分，不用它）：它的必需组件都装好时，交给这些模型包 Worker 的组件里多出 `segmentation` 与 `speaker`，Worker 常驻量的估计也把它们算进去；没装好时不带。装好之后用它的识别模型包空闲的 Worker 先卸下，下一个任务重新加载时带上；正在跑的任务不打断，照没有组件处理。删除它时，用它的识别模型包有任务在用（排队或进行中）以 `MODEL_IN_USE` 拒绝，空闲的 Worker 先卸载再删。`local` Provider 给每个转写模型报告能不能区分说话人（`TranscribeModelInfo.speakers`：`native` 是自己区分，`pack` 是装了这个模型包，`none` 是不能），转写不给 `diarize` 时按它决定（§6.6）；登记了这个模型包的转写模型另报 `diarizationPack`（它的 `bundleId`，装没装都报），界面据此在没装时给下载。

**安装**。`models.install`、`models.cancelInstall`、`models.repair`、`models.remove`、`models.test` 管理本地模型（命令与协议规范 §4.1）：

- **先给大小，再确认**。不带 `confirmBytes` 时只返回计划：每个组件下载还是保留、要下载的文件与字节数（大小未知时为 null，另给估计值）、暂存区里已有的字节、可用空间与来源，不创建任务。调用方把计划里的 `confirmBytes` 原样交回才提交；与新的计划不符时以 `conflict`（`MODEL_INSTALL_SIZE_CHANGED`，带新计划）拒绝。已经装好时不提交；同一个模型包正在安装时返回那个任务。
- **安装是普通的 Job**（`kind: 'modelInstall'`，没有 Task，§7.9），排在一个串行的队列里：进度在 `jobs` 主题（`progress.unit: 'bytes'`），模型包的状态（`downloading` 与进度）在 `models` 主题。
- **来源**。基址先取环境变量 `BAOCUT_MODELS_ENDPOINT`，再取设置 `models.downloadEndpoint`（§5.10），都没有时是公共模型仓库 `https://huggingface.co`。文件的地址是 `<基址>/<owner>/<repo>/resolve/<revision>/<文件路径>`，逐段 URL 编码、`/` 保留；镜像按同样的路径提供文件即可。基址只能是 `http(s)://`，不带凭据、查询参数与片段，下载请求不带认证头。
- **下载、校验与发布**。按内置清单（Model Worker 协议规范 §4）逐文件下载到模型目录里的暂存区 `.bcut-staging/<owner>/<repo>@<revision>/`，逐个核对大小与 sha256；一个组件的文件齐了，写清单，整个目录原子地换上。组件发布之后才算装好：中途失败时已发布的组件保留，下次只补缺的。开始前按要下载的字节检查可用空间。
- **暂停与续传**。取消安装（`models.cancelInstall`，或取消它的 Job）就是暂停：暂存区留着，模型包报告 `install.state: 'paused'`；再次安装按 HTTP Range 从断点续传，核对过的文件不再下载。`discard: true` 时删掉暂存区。连不上、5xx 与断流有限次退避重试，断开前有进展时重新计数；续传出的文件不符时从头再下一次。
- **失败**。错误码各带补救（`details.remedy`）：`MODEL_DOWNLOAD_NO_SPACE`、`MODEL_DOWNLOAD_NETWORK`、`MODEL_DOWNLOAD_INTEGRITY`（坏文件已删除）、`MODEL_DOWNLOAD_SOURCE`（来源没有这个文件或拒绝访问）、`MODEL_MANIFEST_INCOMPLETE`（内置清单缺可信的哈希；不会下载了再算）。
- **修复**与安装同样两步，但把每个文件的 sha256 读一遍，只重下坏的与缺的，好文件原样复用。
- **严格离线**（`offline.strict`）时安装与修复以 `conflict`（`OFFLINE_STRICT`）拒绝。
- **删除**。有任务在用这个模型包（排队或进行中的转写、检查、安装）时以 `conflict`（`MODEL_IN_USE`）拒绝；Worker 空闲时先卸载再删。删除之后，没有出厂默认的能力里指向它的默认值一并清除（`transcribe` 与 `separateAudio` 的保留，§6.8）。

**检查**。每个已安装的模型包可以跑一次检查：用随包的固定样本走完整的 Worker 流程并核对输出。检查是一个普通的 Job（`kind: 'modelTest'`），与这个模型包的转写排同一个队列，结果与时间记录在模型状态里（`selfTest`）；它证明这个包在这台机器上能跑，不证明质量。转写模型包的样本是一段英文录音，结果要含固定的短语（英文的个位数词与阿拉伯数字视作相同，Whisper 把数念成数字）；合成模型包用默认声音合成一句固定的短句，输出要能解码、时长合理、不是静音、没有削波（判定见 Model Worker 协议规范 §4.3），合成的 WAV 作为产物留存；文生图模型包用固定的提示词、256×256、4 步、固定 seed 画一张，输出要是尺寸对的 PNG、不是一整片纯色，PNG 作为产物留存；分离模型包把转写用的同一段样本（只有人声）分成两路，要两路都能解码、与样本等长，人声不是静音且至少比背景高 6 dB（Model Worker 协议规范 §4.3），人声的 WAV 作为产物留存。只有可用的模型包能检查。没通过时结论带一个稳定的代码（命令协议规范 §11.3 的 `MODEL_SELF_TEST_FAILED`）与给技术详情的事实行，代码由 Worker 失败的种类与核对哪一步没过决定；修复能不能帮上忙只由代码决定（`@baocut/protocol` 的 `modelCheckRepair`），界面与 CLI 不各自判断。随应用分发的样本或录音缺失（`APP_FILE_MISSING`）是安装 BaoCut 本身的问题，不记进 `selfTest`，修复模型包也帮不上。界面只给认得的代码配说法，认不得的按通用失败显示，并把 Runtime 的原话放进技术详情。

**模型目录**。生效的目录先取 Runtime 启动时的环境变量 `BAOCUT_MODELS_DIR`，再取设置 `models.dir`（§5.10），都没有时是 `<runtime-home>/models`。`models.getDir` 给出路径、来源（`env`、`setting`、`default`）、缺省路径、在不在、能不能写、已用与可用空间、认出的模型包数与进行中的移动；`models.inspectDir` 只读地查看一个文件夹：在不在、能不能写、与当前目录是否互相包含、里面按清单（`<owner>/<repo>/.bcut-manifest.json`）认出的模型、移动要写的字节与在不在同一块盘上。`models.setDir` 更改目录（命令与协议规范 §4.1）：

- **两种方式**。`switch` 只换位置：写设置、换模型目录的根，新位置里已有的模型直接可用，原目录不动。`move` 把当前目录里认得的模型搬过去：是一个 Job（`kind: 'modelsMove'`，队列 `models:dir`，`progress.unit: 'bytes'`），搬完、校验完才写设置、换根，再删原目录里搬走的文件；没有要搬的东西时等同 `switch`。
- **只搬认得的**。只搬登记过的模型包用到的仓库与版本（带合法清单）和安装记录（`.bcut-installs.json`，合并进目标的记录，两边都有的模型包用原来的那条）。目标里已有同一版本的不再搬；同名仓库是别的版本时留在原处。暂存区里没下完的、别的程序放的文件留在原目录。
- **同一块盘**逐个仓库改名过去；**跨盘**先复制到目标里的 `.bcut-moving/`，逐个文件按清单核对大小与 sha256，齐了再改名到位。开始前在原目录写一份日志 `.bcut-move.json`。
- **回滚**。中途失败、取消或写不了设置时撤回：同一块盘改名回来，跨盘删掉复制出来的；设置与模型目录不变，Job 以 `MODELS_DIR_MOVE_FAILED`（磁盘写满时 `MODELS_DIR_NO_SPACE`）失败。Runtime 在移动中途退出时，下次启动按日志回滚。换过去之后原目录里删不掉的文件留着，Job 带警告 `MODELS_DIR_SOURCE_KEPT`。
- **先停下再改**。有任务在用本地模型（排队或进行中的、带模型包的任务，以及安装、检查、移动）时以 `conflict`（`MODEL_IN_USE`，带 `jobIds`）拒绝；没有时卸下所有空闲的 Worker，有忙的同样拒绝。移动期间每个模型包报告 `error` / `relocating`，不能提交新的本地任务，安装、删除、检查也以 `MODEL_IN_USE` 拒绝。换根之后模型包的状态按新目录重算，`models` 主题对每个模型包发 `bundle.updated`，能力视图重算。
- **拒绝**。环境变量指定时 `MODELS_DIR_ENV_LOCKED`；文件夹不在（外置盘没接上）`MODELS_DIR_MISSING`；不能写 `MODELS_DIR_NOT_WRITABLE`；与当前目录互相包含 `MODELS_DIR_NESTED`；跨盘移动放不下 `MODELS_DIR_NO_SPACE`（带 `requiredBytes`、`availableBytes` 与补救）。都是 `conflict`。生效的目录不在时安装与修复以 `MODELS_DIR_MISSING` 拒绝，不在别处凭空建出同名的目录。
- **入口**。设置里各能力页「本机模型」一节顶部的模型目录卡片（产品设计 §7.6）与 CLI `baocut models dir [--set <path> --move|--switch | --reset]`。Web 服务的白名单与 MCP 对外服务都不含这三个方法：更改要搬动几 GB 的文件、卸下本机的 Worker，是这台机器的管理；浏览器的设置页不显示这张卡片。

**入口**。智能体在缺模型时可以把「下载模型」作为任务的前置步骤提交（`models_install`）：先做计划，按 `command` 风险确认（§3.12），确认的说明写明大小与来源，结果带大小；检查一个已安装的模型包（`models_test`）同样按 `command` 确认，用 `jobs_wait` 等结果。MCP 对外服务不提供安装、检查与删除，只能用 `models_list` 看状态；Web 服务的白名单也不含安装管理（§4.8）：下载几百 MB、删掉本机的转写能力是这台机器的管理，浏览器只看得到状态与进度，`jobs.cancel` 能停下一个安装（等于暂停）。CLI：`baocut models install <bundleId> [--yes]`（先显示大小，只有 `--yes` 跳过确认）、`models cancel`、`models repair`、`models test`、`models remove`，`models bundles` 显示组件、进度与最近一次检查。

模型按 backend / device / model-version / compatibility 复用，不为每个视频各加载一份。资源预算是基于估计与实测的软约束，外部程序仍然可能占用 GPU。内存不足时排队或安全卸载，不能在生成过程中无提示地降低最终结果的质量。

### 6.4 在线适配与输出合同

在线 Provider 全部用 TypeScript 实现，每家 API 提供方一组适配器（按能力各一个），处理参数、认证、提交、轮询、取消、结果下载和错误归一化。它们不经过 Model Worker，不占本地模型的队列；每个 Provider 有自己的并发上限。供应商的输入上限由适配器处理：超过单次请求上限的音频由适配器切片提交并把时间合并回素材时钟，切片边界落在静音处。

**API 提供方目录**。在线 Provider 由下面这张目录定义。目录在 Runtime 里只有一份：Provider 注册表、设置界面与原型都读同一张表，`providerId` 不得另起别名（`gemini`、`dashscope`、`zai`、`volcano`、`volcano-ark` 这些旧名不再使用，火山的语音与方舟合并为 `volcengine`）。「目录声明」是这家提供方开放、界面可以展示的能力；「实现」是 Runtime 真正能调用的子集。Provider 描述（§6.1）只报告实现了的能力：标 P1 的能力在实现之前不得报告为可用，也不得成为默认值的可选项。每家的内置模型表（2–4 个当前主力模型，取自官方文档）随目录维护，本文不逐一列出；下面的适配器表只写有专门适配器的模型。

| `providerId` | 显示名 | `kind` | 目录声明的能力 | 实现 | 基址（国际 / 中国） | 认证 | 图标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `openai` | OpenAI | `vendor` | `generateText`、`transcribe`、`synthesizeSpeech`、`generateImage` | 全部 | `https://api.openai.com/v1` | Bearer | `openai`（单色） |
| `anthropic` | Anthropic | `vendor` | `generateText` | 全部（Messages 原生适配器） | `https://api.anthropic.com` | `x-api-key` 与 `anthropic-version` | `anthropic`（单色） |
| `google` | Google Gemini | `vendor` | `generateText`、`transcribe`、`generateImage` | 全部 | `https://generativelanguage.googleapis.com/v1beta` | `x-goog-api-key` | `gemini-color` |
| `elevenlabs` | ElevenLabs | `vendor` | `synthesizeSpeech`（含音色克隆） | 全部 | `https://api.elevenlabs.io/v1` | `xi-api-key` | `elevenlabs`（没有时用首字母头像） |
| `deepseek` | DeepSeek | `vendor` | `generateText` | 全部（兼容） | `https://api.deepseek.com/v1` | Bearer | `deepseek-color` |
| `moonshot` | Kimi（Moonshot） | `vendor` | `generateText` | 全部（兼容） | `https://api.moonshot.ai/v1` / `https://api.moonshot.cn/v1` | Bearer | `kimi`（单色） |
| `qwen` | 阿里云百炼（Qwen） | `vendor` | `generateText`；`synthesizeSpeech`、`transcribe` 为 P1 | `generateText`（兼容） | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` / `https://dashscope.aliyuncs.com/compatible-mode/v1` | Bearer | `qwen-color` |
| `zhipu` | 智谱 GLM（Z.ai） | `vendor` | `generateText` | 全部（兼容） | `https://api.z.ai/api/paas/v4` / `https://open.bigmodel.cn/api/paas/v4` | Bearer | `zhipu-color` |
| `minimax` | MiniMax | `vendor` | `generateText`；`synthesizeSpeech` 为 P1 | `generateText`（兼容） | `https://api.minimax.io/v1` / `https://api.minimaxi.com/v1` | Bearer | `minimax-color` |
| `volcengine` | 火山引擎（豆包） | `vendor` | `generateText`；`synthesizeSpeech`、`generateImage` 为 P1 | `generateText`（兼容，方舟） | `https://ark.cn-beijing.volces.com/api/v3` | Bearer | `volcengine-color` |
| `xai` | xAI（Grok） | `vendor` | `generateText`；`generateImage` 为 P1 | `generateText`（兼容） | `https://api.x.ai/v1` | Bearer | `xai`（单色） |
| `mistral` | Mistral | `vendor` | `generateText` | 全部（兼容） | `https://api.mistral.ai/v1` | Bearer | `mistral-color` |
| `groq` | Groq | `vendor` | `generateText`；`transcribe` 为 P1 | `generateText`（兼容） | `https://api.groq.com/openai/v1` | Bearer | `groq`（单色） |
| `openrouter` | OpenRouter | `relay` | `generateText` | 全部（兼容） | `https://openrouter.ai/api/v1` | Bearer | `openrouter`（单色） |
| `siliconflow` | 硅基流动（SiliconFlow） | `relay` | `generateText`；`synthesizeSpeech`、`transcribe` 为 P1 | `generateText`（兼容） | `https://api.siliconflow.cn/v1` | Bearer | `siliconcloud-color` |
| `custom:<名字>` | 用户起的名字 | `custom` | 用户声明 | 用户声明的（兼容） | 用户填写 | Bearer，密钥可选 | 首字母头像 |
| `agent:codex` | Codex | `agent` | `generateImage` | 全部（§6.9） | — | 没有密钥 | `codex-color` |

- **`kind`** 是 `vendor`（模型厂商）、`relay`（中转平台）、`custom`（自建端点）或 `agent`（智能体，§6.9）。`agent` 的 Provider 没有账号，不在 API 提供方列表里，只出现在能力的模型选择里。
- **一家提供方一组适配器**。表里标「兼容」的文本提供方共用一个 OpenAI 兼容的 Chat Completions 适配器（与 `custom:<名字>` 同一份实现），彼此只差基址与内置模型表；Anthropic 用自己的 Messages 适配器。`custom:<名字>` 的机制不变：用户给出地址、密钥与模型名，接入其他供应商或自建服务，能力描述由用户声明，按 `declared` 层对待（§3.6）。音色克隆（§5.9）只接 ElevenLabs；`separateAudio` 没有在线适配器（§6.1）。
- **基址**。有国际与中国两个基址的提供方按账号的 `region`（`global` 或 `cn`，§6.8）取用；提供方与账号都可以改写基址，账号的改写优先，其次是提供方的，最后是目录的预设。
- **图标**取自 lobe-icons（MIT），按 `providerId` 重命名后随界面分发，许可与清单见仓库的 `THIRD_PARTY_NOTICES.md`；各厂商的标志只用于标识 API 提供方。缺图标的用首字母头像。

`JobSpec` 固定 `outputContract`，例如语言、采样率、声道、对齐质量、必需的实体 ID、图片尺寸。返回的格式、bytes 与时长不通过校验，就不能注册为就绪的产物。

**外发与凭据**。在线调用把素材或文本送出本机：首次向某个 Provider 发送某类数据需要授权（§12.5），付费调用过预算准入（§7.8）。API key 只出现在发往该 Provider 端点的请求头里：不进日志、任务记录、事件与错误详情，下载结果时不传给任意的重定向地址。

来源记录保留 provider / model / version / 输入 hash / 输出 hash、可用的 seed，以及 `estimate` / `reported` / `unknown` 的费用状态；没有可信的报告时不写伪精确的实付金额。转写结果里，每一次请求都报告了用量才是 `reported`（`usage` 为供应商原样的用量），有一块没报告就是 `unknown`。

**请求与错误**。所有在线请求经同一个 HTTP 层：每次请求有期限（按音频时长估），连不上、超时与 5xx 退避重试，一共 3 次，仍然失败是 `PROVIDER_UNAVAILABLE`；4xx 不重试：401/403 是 `PROVIDER_AUTH_FAILED`，429 是 `PROVIDER_QUOTA_EXCEEDED`，其余是 `PROVIDER_REJECTED`（命令与协议规范 §11.3）。重定向手动跟随，至多 3 跳：认证头只发往原始请求的源，跨源时去掉；带请求体的请求不跟随跨源重定向，素材不被转送到别处。供应商的错误正文写进错误说明之前去掉密钥并截短。取消立即中止在途请求。每个在线 Provider 默认并发 2，自定义端点各自计数；文本请求另按 Provider 限流，上限是 `generateText` 的能力参数（默认 4，§6.8）。

响应带 `Retry-After` 时按它等待（至多 30 秒）：5xx 用它代替退避；429 只在它不超过 30 秒时等过后重试（计入同样的 3 次），没带或更久的立即失败，额度用尽（OpenAI 的 `insufficient_quota`）从不重试；429 失败时 `details.retryAfterSec` 记下供应商给的秒数。`PROVIDER_UNAVAILABLE` 带 `details.reason`：`unreachable`、`timeout` 或 `server-error`。文本适配器再细分 4xx：上下文过长是 `INPUT_TOO_LONG`（`details.reason: 'context-length'`），不重试；`PROVIDER_QUOTA_EXCEEDED` 的 `details.reason` 为 `rate-limited` 或 `insufficient-quota`，`PROVIDER_REJECTED` 为 `content-filter` 或 `model-not-found`。

**转写的音频准备**。在线转写在 Runtime 里用 ffmpeg 把选定音轨解成 16 kHz 单声道的母带（只允许与 Worker 相同的 demuxer 白名单，请求了范围时只解那一段），没有音轨时直接是 `no-audio-track`，不请求供应商。母带超过模型的单次上限（字节或时长，取较紧的一个并留 10% 余量）时，用 silencedetect 找静音，在每块后半段里最靠后的静音中点处切开，找不到静音才硬切；每块编码成适配器要的格式（OpenAI 用 AAC/M4A，兼容端点用 WAV，Google 用 FLAC），按顺序提交，进度按已处理的秒数报告。切片从母带按需编码、提交后即删，母带与切片都在该任务的 staging 里，尝试结束时删除。上传用文件流（multipart），不把整段素材读进内存；Google 的请求体要求内联 base64，只缓冲当前这一块（不超过 12 MB）。

**首批的转写适配器**。

| Provider | 端点 | 模型 | 词时间 |
| --- | --- | --- | --- |
| `openai` | `POST {base}/audio/transcriptions`（multipart，Bearer） | `whisper-1`（默认）、`gpt-4o-transcribe`、`gpt-4o-mini-transcribe` | `whisper-1` 取 `verbose_json` 的段与词时间（`provider`）；另两个只返回文本，按 120 秒切块，词时间插值（`estimated`） |
| `google` | Gemini Interactions API：`POST {base}/interactions`（`x-goog-api-key` 请求头，从不放在 URL 里） | `gemini-3.5-transcribe`（默认，词级时间标注）、`gemini-3.8-flash`（通用模型，按 JSON Schema 返回段） | 前者 `provider`，后者 `estimated` |
| `custom:<名字>` | 用户给出的 OpenAI 兼容基址；密钥可选 | 用户声明（`declared`），限制取保守的默认值 | 声明为 `native` 的请求 `verbose_json`，否则 `estimated` |

**生成的请求**。`synthesizeSpeech` 与 `generateImage` 的一次尝试是一次（图片按张数可以是几次）同步请求，期限 5 分钟；响应体按字节读，不超过 64 MB。参数的检查都在提交时（§6.2）：文本或提示词按 Unicode 码点计，超过模型上限直接拒绝，不截断、不切块、不改写；音色、语言、格式、尺寸、张数、语速、`instructions` 与 `seed` 不在模型描述里的都拒绝。适配器把冻结的参数换成供应商的写法，按请求的格式把输出写进 staging（`output-<n>.<扩展名>`），声明媒体类型、长度与 sha256；响应的类型或张数与请求不符是协议错误，供应商只回文字不回图片是 `PROVIDER_REJECTED`。只认响应体里的字节，不去下载响应给出的任意地址。

**首批的生成适配器**。

| Provider | 能力与端点 | 模型 | 要点 |
| --- | --- | --- | --- |
| `openai` | `synthesizeSpeech`：`POST {base}/audio/speech`（JSON，Bearer），响应体是音频 | `gpt-4o-mini-tts`（默认，13 个音色，默认 `marin`，接受 `instructions` 与账号音色 `{ id }`）、`tts-1-hd`、`tts-1`（9 个音色，默认 `alloy`） | 4096 字符；mp3、wav、flac；语速 0.25–4；没有 seed |
| `openai` | `generateImage`：`POST {base}/images/generations`，取 `data[].b64_json` | `gpt-image-2`（默认，另有 16:9、9:16 与 2K 尺寸）、`gpt-image-1.5`、`gpt-image-1`、`gpt-image-1-mini` | 尺寸 1024x1024、1536x1024、1024x1536，不给时由供应商决定；一次 1–10 张；png、jpeg、webp；提示词 32000 字符；没有 seed |
| `elevenlabs` | `synthesizeSpeech`：`POST {base}/text-to-speech/{voice_id}?output_format=…`（`xi-api-key` 请求头） | `eleven_multilingual_v2`（默认）、`eleven_v4`、`eleven_v3`、`eleven_flash_v2_5` | 音色属于账号，没有预置音色与默认音色，必须给出；字符上限按模型（10000、10000、5000、40000）；mp3（`mp3_44100_128`）、wav（`wav_24000`）；`language_code` 只发给接受它的模型；接受 seed |
| `google` | `generateImage`：Gemini Interactions API `POST {base}/interactions`，`response_format.type: 'image'` | `gemini-3.1-flash-image`（默认）、`gemini-3-pro-image`、`gemini-3.1-flash-lite-image`、`gemini-2.5-flash-image` | 尺寸按各模型的宽高比 × 分辨率表，请求里换成 `aspect_ratio` 与 `image_size`；一张一次请求，一次任务最多 4 张；只取 `model_output` 里的最后一张图，不取 `thought` 的中间图；png、jpeg；没有 seed |
| `custom:<名字>` | 与 `openai` 相同的两个端点；图片请求加 `response_format: 'b64_json'` | 用户声明 `capability` 为 `synthesizeSpeech` / `generateImage` 的模型 | 限制按声明，没声明的取保守值：语音 4096 字符、mp3，声明了音色时第一个是默认音色、其他音色 ID 也原样交给端点，没声明时必须给出音色；图片 1024x1024、一次 1 张、png、提示词 4000 字符 |

**音色克隆的请求**。ElevenLabs 的即时克隆是 `POST {base}/voices/add`（multipart：`name`、一个参考录音 `files`、可选的 `description`；`xi-api-key` 请求头），取响应的 `voice_id`；只发一次（重发可能多建一个克隆），期限 2 分钟。删除是 `DELETE {base}/voices/{voice_id}`，404 当作远端已经没有。没有离线核对过的细节列在 §14。

**生成的输出合同**。发布之前逐个输出校验：文件在 staging 里，长度与 sha256 与声明一致，媒体类型是请求的格式，文件头认出的类型与之相同；再用 ffprobe 按该格式的解复用器完整解码一遍：音频要有正的时长、采样率与声道数，图片要有正的宽高。任何一项不过，整个任务失败为 `MODEL_OUTPUT_INVALID`，不发布、不重试，原始文件移到 `logs/diagnostics/<jobId>/`（§6.5）。校验得到的媒体事实写进结果的每个输出。内容相同的输出是同一个 Artifact。

**文本的请求**。`generateText` 的一次尝试是一次同步请求，期限 10 分钟。请求是有序的消息（`system`、`user`、`assistant`；Chat Completions 原样传，Gemini 把 `system` 移进系统指令）、输出格式（`text`，或 `json` 加一份以对象为根的 JSON Schema）、`maxOutputTokens`（不给时取模型的上限）、可选的推理强度、`temperature` 与 `seed`。提交时检查：消息至少有一条非空的 `user` 或 `assistant`；输入按字符粗估明显超过上下文时以 `INPUT_TOO_LONG` 拒绝（精确的判断在供应商那里）；`maxOutputTokens` 超过模型上限、模型不接受的 `temperature` 或 `seed`、模型不支持的结构化输出、不合法的 schema 都是 `invalid-request`。推理强度是 `minimal`、`low`、`medium`、`high` 四档：模型不支持请求的那一档时用最接近的一档（一样近时取高的），模型不能调节时忽略；两种情况都写进结果的 `notes`。

**首批的文本适配器**。

| Provider | 端点 | 模型 | 要点 |
| --- | --- | --- | --- |
| `openai` | Chat Completions：`POST {base}/chat/completions`（JSON，Bearer） | `gpt-6.1-sol`（默认）、`gpt-6-astra`、`gpt-6-luna` | 输出上限用 `max_completion_tokens`，推理强度是 `reasoning_effort`；结构化输出发 `json_schema` 且 `strict: false`（严格模式只接受 schema 的子集，校验由 Runtime 做）；不接受 `temperature` 与 `seed` |
| `google` | `POST {base}/models/{model}:generateContent`（`x-goog-api-key` 请求头） | `gemini-3.8-flash`（默认）、`gemini-3.7-flash`、`gemini-3.6-flash`、`gemini-3.5-flash`、`gemini-3.5-flash-lite`、`gemini-3.1-flash-lite` | 系统消息进 `systemInstruction`；结构化输出用 `responseMimeType: 'application/json'` 与 `responseJsonSchema`；推理强度是 `thinkingConfig.thinkingLevel`；不取 `thought` 的部分；接受 `temperature` 与 `seed` |
| `anthropic` | Messages：`POST {base}/v1/messages`（`x-api-key` 与 `anthropic-version` 请求头） | 目录的内置模型表 | 系统消息放进顶层的 `system`；输出上限 `max_tokens` 必须给出（不给时取模型的上限）；结构化输出与推理强度按模型描述声明，不支持的按上面的规则拒绝或换档 |
| 兼容的文本提供方（`deepseek`、`moonshot`、`qwen`、`zhipu`、`minimax`、`volcengine`、`xai`、`mistral`、`groq`、`openrouter`、`siliconflow`） | 与 `custom:<名字>` 相同的端点，基址取目录 | 目录的内置模型表 | 限制按内置模型表；结构化输出、`temperature`、`seed` 与推理强度只在模型描述声明支持时发出 |
| `custom:<名字>` | 与 `openai` 相同的端点，输出上限用 `max_tokens` | 用户声明 `capability` 为 `generateText` 的模型 | 限制按声明，没声明的取保守值：上下文 32768、单次输出 4096 token |

**文本的输出合同**。执行者把全文写进 staging（`output-1.txt` 或 `output-1.json`），声明长度与 sha256；结束原因归一为 `stop`、`length`、`content-filter`。内容过滤是 `PROVIDER_REJECTED`（`content-filter`），不发布。`length` 不是完整的成功：文本仍然发布，带 `output-truncated` 警告；结构化输出到了上限一律失败。结构化输出在发布之前按 schema 校验：不是 JSON 或不符合 schema 是 `MODEL_OUTPUT_INVALID`（`details.reason` 为 `schema`、`length` 或 `empty`，`details.problems` 列出前几处），不重试。发布前 JobManager 再核对摘要与长度、按 UTF-8 严格解码，结构化输出再校验一次 schema。产物是 `.txt`（`text/plain`）或 `.json`（`application/json`）；结果里另有前 2000 个码点的预览、用量、模型与版本、结束原因与 `notes`。

基址都可以改写（代理、网关）；测试用本机的假服务，从不连真实的供应商。

### 6.5 Model Worker（本地推理进程）

**粒度**。一个 Model Worker 进程承载一个**常驻模型包**：一个主模型（某个模型版本在某个 backend 上的构建）及其固定的依赖（VAD、强制对齐器、说话人嵌入）。同一个模型包在同一台机器上最多一个进程；不同的模型包各自一个进程。不按设备分进程，也不按视频或任务分进程。推理后端的设备上下文（Metal、CoreML、CUDA）崩溃是进程级的；按模型包隔离，一次 SIGABRT 只丢掉一个模型，不清空其他能力，也不伤及 Engine Host 与 Runtime。Worker 里不运行任何视频代码。

**代码分层与后端**。所有本地推理能力共用一个库 crate `model-runtime` 与一个二进制 crate `model-worker`；不为每种能力各写一个进程程序。库里放与能力无关的部分：IPC 协议与消息类型、父进程看护与退出、权重加载与 manifest 校验、后端抽象（设备上下文与张量运行时）、音频解码与重采样、秒到 tick 的换算、分段结果的写入。`transcribe`、`align`、`synthesize` 等能力各自只实现模型与流水线；VAD、对齐器、说话人嵌入这类共享子模型是库里的模块，模型包声明了依赖才加载。后端按 Cargo feature 划分（`backend-mlx` 仅 Apple Silicon；`backend-candle` 全平台 CPU，`cuda` 在它之上加 CUDA；`backend-coreml` 仅 Apple Silicon 的 macOS，给按目录加载的 Core ML 模型（Whisper），设备记为 `ane`；识别流水线的 VAD 仍跑在 MLX 上，所以它依赖 `backend-mlx`；`whisper-ggml` 全平台，给 whisper.cpp 的单文件 GGML 权重（Whisper），VAD 与对齐器借 candle 的，所以它依赖 `backend-candle`，`whisper-ggml-cuda` 在它之上加 ggml 的 CUDA 后端、`whisper-ggml-vulkan` 加 Vulkan 后端（两个可以同时开，运行期 CUDA 优先），构建要 CMake 与 C++ 编译器（CUDA 另要 CUDA Toolkit，Vulkan 另要 Vulkan SDK）；`cuda`（candle）与 `whisper-ggml-cuda`（Whisper）是两个独立的 feature；`model-worker` 默认只开 MLX 与 Core ML，Windows、Linux 与 Intel Mac 的构建用 `--no-default-features --features backend-candle,whisper-ggml`（有 NVIDIA 时再加 `cuda,whisper-ggml-cuda`，AMD / Intel 显卡让 Whisper 用 Vulkan 时加 `whisper-ggml-vulkan`）；`npm run build:engine` 按平台选好，`BAOCUT_WORKER_FEATURES` 追加 feature），模型目录为每个模型包登记支持的后端，Runtime 按平台选择；每个后端在所有平台都必须能编译，只是没有对应硬件时不可用。

**后端矩阵**。同一个模型在不同后端上是不同的模型包（`qwen3-asr-0.6b@mlx-4bit` 与 `qwen3-asr-0.6b@candle`），仓库、组件与给人看的名字相同；Whisper 在 Core ML 与 GGML 上的权重是不同的转换，仓库不同。Whisper 在 Apple Silicon 上另有 MLX 的模型包（`whisper-large-v3@mlx` 与 `whisper-large-v3-turbo@mlx`，`whisper-mlx` 族，读 mlx-community 的 fp16 转换，分词器与 Core ML 的共用），Worker 能加载，但暂不列出：换不换 Core ML 待定（§14「Apple Silicon 上 Whisper 的后端」）。Runtime 按平台只列一种，默认的转写模型包也随平台：

| 平台 | 列出的模型包 | 设备 | 默认转写模型包 |
| --- | --- | --- | --- |
| macOS（Apple Silicon） | MLX：Qwen3-ASR 0.6B / 1.7B、MOSS、语音合成；Core ML：Whisper | `metal`；`ane` | `qwen3-asr-0.6b@mlx-4bit` |
| Windows、Linux、Intel Mac | candle：Qwen3-ASR 0.6B / 1.7B、MOSS（都带可选的对齐器，MOSS 带可选的说话人模型）、语音合成；GGML：Whisper large-v3 / large-v3 Turbo（带可选的对齐器） | `cuda` 或 `cpu`；`cuda`、`vulkan` 或 `cpu` | `qwen3-asr-0.6b@candle` |

candle 读与 MLX 相同的量化权重，加载时反量化：CPU 上算 f32，CUDA 上算权重的半精度；Silero VAD 总在 CPU 上。GGML 的 Whisper 按量化原样加载（whisper.cpp），VAD 与对齐器跑在 candle 的 CPU 上。Worker 在 `worker.hello` 里按后端报告设备（首选在前），candle 与 GGML 模型包登记的设备是 `cpu`，Runtime 用 Worker 报告的首选设备交给 `model.load` 并显示在模型包状态上。Windows 上按显卡分三档安装包（§14「Windows 安装包」）：NVIDIA（Ampere / RTX 30 起）用 CUDA 安装包，candle 与 GGML 的 Whisper 都在 CUDA 上（`cuda` 加 `whisper-ggml-cuda`）；AMD、Intel 显卡（以及不支持 CUDA 13 的 NVIDIA 显卡）用 Vulkan 安装包，Whisper 在 Vulkan 上（`whisper-ggml-vulkan`），candle 与其余模型在 CPU 上；都没有时用标准包，全部在 CPU 上。一个安装包在运行期自选 CUDA 或 Vulkan 现在做不到（§14「单一 GPU 安装包在运行期自选后端」）。GGML 运行期的设备规则只有一条：取 ggml 枚举到的第一个 GPU 设备（与 whisper.cpp 用的是同一台），ggml 先登记 CUDA、后登记 Vulkan，所以两个后端都编进来时 NVIDIA 机器上选 CUDA，没有 NVIDIA 驱动时 CUDA 报 0 个设备、选 Vulkan；设备名按所选 GPU 的后端报 `cuda` 或 `vulkan`，`model.load` 只收 `cpu` 与这一个。Whisper 的 CUDA 与 Vulkan 都尚未实测（§14）。环境变量 `BAOCUT_GPU` 设为 `off`、`0`、`false`、`cpu` 或 `no` 时 Worker 不初始化 GPU（candle 与 GGML 都强制 CPU）；CUDA 或 Vulkan 初始化失败时退回 CPU 并在 stderr 说明一次（GGML 编进了 GPU 后端却没枚举到 GPU 时点名编进来的后端）；CUDA 显存不足的错误附上换小模型或设 `BAOCUT_GPU=off` 的提示。Apple Silicon 上 candle 与 GGML 照样能编译能跑（对拍测试用 candle），只是不列出。语音合成的六个引擎族写在 `synthesize::tensor` 门面上（v2 同一份适配层）：Apple Silicon 带 MLX 的构建是 MLX，其他带 `backend-candle` 的构建是 candle，一个构建只编其一；所以 Apple Silicon 上同时编进 candle 时，candle 的合成模型包在 `model.load` 被拒绝（`engine-unavailable`）。candle 的合成把张量固定在进程的首选设备上，模型包的设备不是首选设备时同样拒绝（`unsupported-device`）。合成在 CPU 上把浮点与量化权重都换成 f32；在 CUDA 上浮点保持 checkpoint 的精度，量化权重反量化成缩放因子的精度（半精度）。内存压力信号、进程优先级这类系统调用集中在一个平台模块里，非 macOS 先给保守实现。权重不跨进程共享：ASR 与 TTS 各自的模型包若依赖同一个辅助模型，各加载一份；资源共享只发生在 `ResourceScheduler` 的租约层。

**ggml 的 CPU 指令集基线**。whisper.cpp 由 `whisper-rs-sys` 0.15 用 CMake 静态编进 Model Worker，ggml 的 `GGML_NATIVE` 缺省是 ON（只有交叉编译或设了 `SOURCE_DATE_EPOCH` 时是 OFF）：MSVC 上它由 `FindSIMD.cmake` 在构建机上实际运行探测程序，探到 AVX-512 就给整个 ggml-cpu 加 `/arch:AVX512`，探到 AVX2 就加 `/arch:AVX2`；GCC / Clang 上是 `-march=native`。安装包在 CI 的 runner 上编，runner 的 CPU 比用户的新（常带 AVX-512）时，用户机器上一跑 ggml-cpu 就非法指令崩溃，而 ggml 在这里没有运行期的指令集检查。所以打包脚本给三个变体都设 `GGML_NATIVE=OFF` 与 `GGML_AVX2=ON`（`whisper-rs-sys` 把 `GGML_*` 环境变量交给 CMake），ggml-cpu 按固定基线编：MSVC 上是 `/arch:AVX2` 加 FMA、F16C 与 BMI2，相当于 Intel Haswell（2013）与 AMD Zen 起；显式给 `GGML_AVX2` 是为了不依赖 ggml 的缺省推导（设了 `SOURCE_DATE_EPOCH` 时它会退到 SSE2）。取舍：带 AVX-512 的机器少了 AVX-512 内核，Whisper 在 CPU 上会慢一些；没有 AVX2 的 CPU（Sandy / Ivy Bridge，以及不少 Pentium / Celeron / Atom）仍会崩溃，要覆盖它们只能把基线降到 `GGML_AVX2=OFF`（`/arch:AVX`）或更低，所有人都更慢，现在不做。按 CPU 在运行期选内核的 `GGML_CPU_ALL_VARIANTS` 要 `GGML_BACKEND_DL`，后者要 `BUILD_SHARED_LIBS`，而 `whisper-rs-sys` 写死 `BUILD_SHARED_LIBS=OFF` 并静态链接 `ggml-cpu`，环境变量改不了，要用它得改 `whisper-rs-sys` 并随包带各档 `ggml-cpu-*.dll`。`whisper-rs-sys` 不随 `GGML_*` 环境变量重跑构建脚本，换基线要清掉它的产物（CI 的缓存 key 带着基线）。Rust 部分没有设 `target-cpu`，按 rustc 缺省的 x86-64 基线编，不受影响；`npm run build:engine` 的开发构建仍是 native。以上按 `whisper-rs-sys` 的 build.rs 与 ggml 的 CMakeLists 核对，未实测：带这组变量的 Windows 构建、构建日志里确为 `/arch:AVX2`、在只有 AVX2 的机器上运行，工作流也还没有核对实际参数。要核对，看 `target/<三元组>/release/build/whisper-rs-sys-*/out/build/` 下 CMake 生成的文件：`CMakeCache.txt` 里 `GGML_NATIVE` 为 OFF、`GGML_AVX2` 为 ON，ggml-cpu 的编译参数是 `/arch:AVX2`（Visual Studio 生成器写在 `ggml-cpu.vcxproj` 的 `EnableEnhancedInstructionSet` 里）、没有 `/arch:AVX512`；build.rs 开的 verbose 输出在同目录上一级的 `output` 文件里，cargo 不加 `-vv` 时不打到控制台。Linux 还没有打包流程，将来同样要设这组变量（GCC 上是 `-mavx2 -mfma -mf16c -mbmi2` 等）。

**MLX 的构建**。`backend-mlx` 用 `pmetal-mlx-rs` / `pmetal-mlx-sys`，整个 workspace 只用同一版，只链一份 libmlx；部署目标 macOS 14.0 由 `.cargo/config.toml` 统一设定。`pmetal-mlx-sys` 构建时调用 Metal 编译器（`xcrun -sdk macosx metal`）编出 `mlx.metallib`，并展开运行时 JIT 内核用的源码前导。构建机的 `xcode-select` 必须指向完整的 Xcode（Command Line Tools 不带 Metal 编译器），且已装好该 Xcode 的 Metal Toolchain 组件（`xcrun -sdk macosx metal --version` 能运行）；Xcode 26 与 Xcode 27 都按上游原样构建，不给 MLX 打补丁。前导脚本不检查编译器是否成功：`metal` 不可用时构建照样通过，产出的库在运行时编译 JIT 内核失败（如 `unknown type name 'bfloat16_t'`），而且 CMake 视这些前导为最新，装好工具链后也不会重新生成。所以换 Xcode、改 `xcode-select` 或补装 Metal Toolchain 之后，用过的每个 target 目录都先 `cargo clean -p pmetal-mlx-sys`，再全新构建。

**来源**。本地推理的实现从 v2 原样移植（语音识别、强制对齐、说话人、人声分离、语音合成、文生图），连同它们离线可跑的测试，不重写；v3 只改边界：一个模型包一个进程、Worker 只读清单列出的文件（引擎不自己扫描模型目录）、清单与哈希由 Node 侧管理（§6.3）。在线 Provider 仍然全部用 TypeScript（§6.4），v2 的云端 Rust 代码只作参考。分批见 §14。

**启动**。Worker 由 `process-host` 按需启动，不随 Runtime 启动预热。

1. Node 的 `models` 模块解析模型包：显式的权重文件路径、manifest hash、backend、device、Worker 合同版本。Worker 不自己扫描目录，不联网，不下载。
2. 以与 Engine Host 相同的 stdio JSON-line 通道启动，消息形状见 Model Worker 协议规范。Runtime 的首个请求是 `worker.hello`，回应给出 Worker 版本、合同版本、可用后端与能力；合同版本不匹配就立即关闭。合成的模型包要求 Worker 声明 `synthesize`，文生图的要求 `image`（且模型族在 `imageFamilies` 里），分离的要求 `separate`（且模型族在 `separateFamilies` 里），没有时不加载，任务以 `MODEL_LOAD_FAILED`（`unsupported`）失败，模型包不停用。
3. 加载权重是显式的 `model.load` 请求，不是启动的一部分。加载只上报阶段（`loading-weights`、`compiling`、`warming-up`），不伪造百分比。
4. 与 §6.3 状态的对应：进程未起或权重未加载 = `installed`；`model.load` 进行中 = `loading`；加载完成 = `ready`；有任务 = `busy`；卸载中 = `unloading`。

**执行**。Worker 一次只执行一个任务。排队、公平性、深度上限全部在 Runtime 的 JobManager 与 `ResourceScheduler`（§7.6、§7.7）；Worker 不维护第二份任务账本。任务请求携带 `jobId`、`runGeneration`、冻结的参数、输入路径与期望的输出合同。Worker 以事件流回报阶段、进度、分段结果与警告，最后用一条 `job.result` 给出 staging 文件的路径、sha256 与长度；Runtime 校验之后才发布（§7.3）。本地合成与本地生图走同一个进程管理与同一个模型包队列，输出（staging 里的 `speech.wav`、`image.png`）按生成任务的规则校验与发布（§6.4，Model Worker 协议规范 §5.1）。本地分离同样如此，输出是 staging 里的 `vocals.wav` 与 `background.wav`（协议规范 §2.5.4），由配音流程或检查校验。

**优先级与资源**。Worker 以低于前台的调度优先级运行（macOS 为 utility QoS，Windows 为推理线程的 `THREAD_PRIORITY_BELOW_NORMAL`），线程数由 Runtime 按准入结果传入。每个 Worker 的常驻内存与显存是一个租约（§7.7）。识别与分离模型包按提交时要加载的组件（必需组件与已经装好的可选组件）估计加载后的常驻量：MLX 与 Core ML 是权重的存储字节（分离模型包的权重存成 16 位、加载时升成 32 位，按存储字节的两倍算；HTDemucs-FT 实测常驻 673 MB，文件 336 MB），GPU 内存是它加 1 GiB，至少 2 GiB，进程内存 1 GiB；candle 把权重都换成计算精度，常驻量是参数个数 × 4（CPU 的 f32）或 × 2（CUDA 的半精度），在 CUDA 上同样计入 GPU 内存，在 CPU 上计入进程内存（常驻量加 1 GiB，至少 1 GiB，不占 GPU 内存）；candle 的分离模型包例外：HTDemucs-FT 在 CPU 与 CUDA 上都按 f32 算（同 v2），常驻量同样按存储字节的两倍，池随设备；GGML 的常驻量是 GGML 权重文件的存储字节（大小未知时用清单的估计值）加上 VAD 与对齐器在 candle CPU 上的常驻量（参数个数 × 4），设备是 `cpu` 时计入进程内存，是 GPU（`cuda` 或 `vulkan`）时整个计入 GPU 内存（VAD 与对齐器其实在进程内存里，这部分记错了池，待实测再拆）。参数个数登记在组件上（`parameters`，按 safetensors 头数出来）；没有时按存储字节 × 计算位宽 / 存储位宽（`weightBits`）估计，量化包里不量化的部分会让它偏大。实测 CPU 上 Qwen3-ASR 0.6B 加载后约 3.7 GiB、用过对齐器约 6.3 GiB，1.7B 约 6.4 GiB，MOSS 约 2.8 GiB。HTDemucs-FT 的 candle 变体在本机 CPU 上（`--release`，candle 编在 macOS 上只为测量）分离 3.7 秒的混音用 42 秒（约 1.9 个核；一个 7.8 秒的窗口每个子模型约 10 秒），进程峰值（phys_footprint）2.6 GB；按此推算（未实测）半小时的素材在 CPU 上要三个多小时，实用要靠 CUDA（未在本机验证）。candle 的合成模型包同样按参数个数估计（每个组件都登记了 `parameters`；Qwen3-TTS 共用的编解码器存成 f32，1.7 亿参数），MLX 的合成模型包与不知道权重多大的模型包用固定值（内存 1 GiB、GPU 内存 2 GiB）。candle 合成在本机 CPU 上（`--release`，candle 编在 macOS 上只为测量；测量时系统内存吃紧、交换区用了约 10 GB，常驻集偏低、耗时偏长）的实测，常驻是进程的最大常驻集（含映射的权重文件页）：Qwen3-TTS 0.6B Base 估计 4.3 GB，Worker 加载 5 秒、加载后 2.1 GB、峰值 2.6 GB，克隆 2.9 秒的英文用 162 秒；0.6B CustomVoice 估计 4.3 GB、峰值 3.5 GB，5.0 秒的中文用 268 秒；GPT-SoVITS 估计 2.2 GB、峰值 3.8 GB，两句共 9 秒用 56 秒（含加载）；OmniVoice 估计 3.3 GB、峰值 4.2 GB，五句共 22 秒用 646 秒；IndexTTS 2.5 估计 6.7 GB、峰值 5.2 GB，每句 3.4–4.9 秒用 420–625 秒（已在交换）。IndexTTS2（估计 7.7 GB）与 VoxCPM2（9.5 GB）在这台 16 GiB 的机器上没有实测。除 GPT-SoVITS 外峰值都在估计加 1 GiB 之内；GPT-SoVITS 超出约 0.5 GB，最大常驻集也算上了映射的 16 位权重文件页（约 1.1 GB）。合成在 CPU 上只用到 1–2 个核（v2 原样），比实时慢：Qwen3-TTS 约 55 倍、IndexTTS 2.5 约 120–145 倍、OmniVoice 约 30 倍、GPT-SoVITS 约 6 倍；CUDA 没有在本机验证。所以与文生图一样，candle 合成模型包的模型描述在设备是 `cpu` 时带 `notes`，照实说比实时慢多少（没有实测的 Qwen3-TTS 1.7B 的三个变体、IndexTTS2 与 VoxCPM2 写「这只没有实测」），有 CUDA 时应该快得多（未实测）；Worker 报告 CUDA 时不带，与 MLX 的同一只模型一样。设置里试听前的那一句先用它。文生图模型包的三段权重（约 9.8 GB）逐层流式读入、从不同时驻留，GPU 内存按模型包登记的实测峰值（`image.peakBytes`，Qwen-Image-2.1 为 2 GiB）计，不按权重总量，也不套用上面识别的常驻量估计，Worker 也不按预算拒绝加载；本机实测进程峰值 256² 约 0.7 GB、1024² 约 1.0 GB（MLX 的峰值 0.6–0.9 GB，与 v2 一致）。读过的权重留在系统的文件缓存里，可回收、不计进进程内存；缓存被挤掉时 DiT 那段（约 4 GB）每一步都要从磁盘重读，只慢不失败。candle 的变体（`qwen-image-2.1@candle`，Apple Silicon 以外的平台）读同一个仓库，照 v2 原样流式：文本编码器逐层、每个投影用到时反量化、用完即丢（词嵌入先按 token 取行再反量化）；DiT 只留一层反量化后的矩阵（约 2.2 亿参数，f32 约 0.9 GB），每一步都重新反量化整个 DiT；VAE 的卷积按需读入，按行带解码。计算精度 CPU 上 f32、CUDA 上 bf16。峰值按设备登记：CPU 上计进程内存（`image.peakBytes` 6 GiB，不占 GPU 内存），CUDA 上计 GPU 内存（`image.devicePeakBytes.cuda` 4 GiB）；`ModelCatalog.imagePeak` 按 Worker 握手报告的设备取值与池，峰值已含激活，不另加 1 GiB。CPU 的数字是本机（Apple M 系列 8 核、16 GiB，`--release`，candle 编在 macOS 上只为测量）实测的进程峰值（phys_footprint）：256² 2.4 GB、1024² 4.7 GB（出在 VAE 解码；DiT 那段 3.3 GB）；常驻集还算上映射的权重页（1024² 4.9 GB），那部分与 MLX 一样是可回收的文件缓存，不计——只是 candle 每一步都重读整个 DiT，缓存被挤掉时每一步都慢。6 GiB 留给长边 1536 与抖动；16 GiB 的机器前后台都放得下，8 GiB 的机器只有交互优先级放得下。CUDA 的 4 GiB 不是本机实测：v2 同一管线在 NVIDIA 显卡（compute capability 8.6）上实测 1024×576 二十步整卡显存峰值 3.57 GiB（含桌面约 1.2 GB），1024² 没有测。CPU 很慢：文本编码 70–150 秒；256² 每步约 75 秒（首步冷读 120–160 秒），几乎都是反量化与转置；1024² 一步 614 秒（冷读、内存吃紧时），VAE 解码 165 秒。按此推算（未实测）1024² 二十步约三小时、512² 约一小时，自检（256²、4 步）约 7 分钟。进程在 256² 时只用到约 1.3–1.6 个核、1024² 时 2.4–4.7 个核：反量化与 `weight.t().contiguous()` 的复制是单线程的，更多的核只缩短矩阵乘与卷积那部分。所以模型描述的 `notes` 在 CPU 上照实说要几个小时；CUDA 上 v2 实测 1024×576 二十步约 11 分钟（debug 构建）。同一 seed 在 candle 与 MLX 上出不同的图（噪声各用各的随机数生成器），同一后端逐字节复现（本机 256² 两次生成逐字节相同）。配音的分离一步另算自己的内存与 staging（各 2 GiB，解出的整段音频与两路输出）。加载新的模型包之前，先确认要让出的 Worker 已经退出，而不是只发出了卸载请求。

**失败分类与恢复**。

| 失败 | 判定 | 处理 |
| --- | --- | --- |
| 加载失败 | `model.load` 返回错误 | 不重试。错误码 `MODEL_LOAD_FAILED`，按原因归类为 `not-installed`（校验不过）、`unsupported`（后端或设备不支持）或 `error`（资源不足）；Job 失败并给出可用的动作：安装、换模型、换后端 |
| 运行时崩溃 | 进程异常退出、stdout 关闭、心跳超时 | 当前 Job 标为 `interrupted`，按 `模型包 + 输入 hash + Worker 版本` 自动重试一次；第二次仍崩溃则 Job 失败，错误码 `MODEL_WORKER_CRASHED`，附 stderr 尾部。同一模型包在 M 分钟内崩溃 N 次后，该能力标为不可用（原因 `resource` 或 `unsupported`），不再自动拉起，直到用户重新启用 |
| 输出不合合同 | Runtime 校验 staging 结果失败 | 不重试；Job 失败，错误码 `MODEL_OUTPUT_INVALID`；原始文件移到诊断目录供上报 |
| 取消 | `jobs.cancel` 或停止屏障（§7.4） | 发 `job.cancel`，Worker 在分段边界停下并 ack，之后仍是 `ready`，权重不丢。超过 ack 期限（默认 5 秒）则 kill 进程，模型包回到 `installed`，下一个任务再按需启动 |

**孤儿与自保**。Worker 在 stdin 关闭时退出，并周期性检查父进程仍然存在且与启动时相同，否则自行退出（Unix 比对 `getppid`；Windows 打开父进程的句柄等它结束，句柄钉住进程对象，PID 不会被复用，创建得比 Worker 晚的进程不当作父进程）。新的 Runtime 不认领上一代的 Worker，不凭 PID 复用（§7.7）。Runtime 正常停止时 Worker 属于 §2.4 中的「执行器」：先取消其任务，再关闭 stdin，超过宽限期 SIGKILL。

**空闲与内存压力**。任务完成后不立即卸载。Runtime 维护空闲计时器（默认 10 分钟），到期发 `model.unload`，Worker 卸载后退出。Runtime 订阅系统内存压力（macOS 为 `kern.memorystatus_vm_pressure_level`，其他平台用等价信号），压力升高时按最近最少使用卸载空闲的 Worker；正在执行的任务不被中断，但该 Worker 不再接新任务。用户可以在设置中把某个模型固定为常驻。

**暂存与清理**。每个 Job 的解码音频、分段结果与最终结果都写在 `<runtime-home>/staging/jobs/<jobId>/`，Worker 只写这个目录，不写 `artifacts/`、`models/` 或视频目录。Runtime 校验通过并发布为 Artifact 后删除目录；Job 失败或取消也删除；崩溃或校验失败时只把 stderr 尾部、任务元数据与不合合同的原始文件移到 `logs/diagnostics/<jobId>/`。这些文件含有转写文本，导出诊断时按 §12.6 预览与脱敏，不默认进入产品分析。Runtime 启动时扫描 `staging/jobs/`：Job Ledger 中不存在或已终结的目录超过宽限期后删除；有合法检查点的目录保留供续跑（§7.5）。

### 6.6 语音识别流水线

**能力**。`transcribe`（媒体 → 带词级时间的转写）与 `align`（媒体 + 已知文本 → 词级时间）是两个独立的能力。云端返回不带词时间的转写时，用本地 `align` 补齐；用户修正文字之后重新对齐也走 `align`。

**本地流水线**。一次 `transcribe` Job 在 Worker 内按以下顺序执行；步骤 1 到 3 流式进行，内存不随媒体长度线性增长。自己切段并给出说话人的模型（MOSS）跳过步骤 2、3，由模型一次给出分段；步骤 5 只对齐长于 5 秒的行，步骤 7 用说话人模型把各块内的说话人合并成全局的，没有说话人模型时保留块内标签并带 `diarization-unavailable`（Model Worker 协议规范 §2.5.1）。Worker 在 `worker.hello` 里按模型族声明能识别什么（`transcribeFamilies`），没声明的模型族 Runtime 不加载。

1. 解码：Worker 用 ffmpeg 管道（`model-runtime` 的 `audio.rs`；16 kHz 的 PCM WAV 走纯 Rust 路径，不要 ffmpeg）把素材的选定音轨解码为 16 kHz 单声道 f32，分块写进 staging 再按需读取；解封装只允许白名单的 demuxer（与 Runtime 的素材分析一致），只读本地文件。没有音轨的素材在此以 `no-audio-track` 结束。
2. VAD：流式语音活动检测，输出语音区间。全程没有语音的以 `no-speech` 结束。两者都是报告给用户的事实，不是空的成功。
3. 分段：按语音区间与模型的最大段长切分。段是进度、取消、检查点与重试的单位。
4. 识别：逐段送入 ASR 模型。语言由任务参数决定：**断言**（用户指定，模型不得更改）或**偏好**（自动检测，结果带检测到的语言）。自动检测在第一段识别出文字的段上定下任务的语言：优先用模型自报的语言名，其次按累计的文本推断；识别结果为空的段不算，模型在这样的段上自报的语言不采信。定下之后推送一次 `job.language`，结果的 `language` 也是它；但它不强加给之后的段，每段仍由模型自己判断（v2 把它锁给之后的段：Whisper 在给定的语言下会把另一种语言翻译过来，中英混说的素材整段变成一种语言）。对齐与估计词时间用模型在这一段上自报的语言，报不出时用任务的语言。代价是很短、含糊的段可能被单独判错语言。一段之内先说一种语言、不停顿接着说另一种时，两个识别模型都只按一种语言解码，可能丢掉另一种（模型的局限，v2 相同）。本地模型都不给语言的置信度，`confidence` 为 null。
5. 强制对齐：ASR 本身给不出可信的词时间时用对齐器补齐（逐段，在这段的音频上对齐识别出的文本，词标 `aligned`）；模型包没有对齐器时，词按字符长度在段内插值并标 `estimated`；某一段对齐出错或对不出词时这一段同样退回估计，并带 `alignment-failed` 警告，任务不失败。
6. 单调修正：词时间在段内单调、不越段、不超过媒体时长；被修正的词保留原来的 `timingQuality` 并附警告。
7. 说话人：要说话人（`diarize`）时，识别与对齐完成之后在整段音频上跑说话人区分（`diarizing` 阶段，进度单位 `steps`）：Pyannote segmentation-3.0 按 10 秒窗、5 秒步长逐帧判断窗内最多 3 个本地说话人，每个本地说话人用 WeSpeaker 提取声纹，带约束的凝聚聚类（合并阈值 0.715）合成全局说话人，再投影到词上（逐词按重叠打分，连续发言段内按时长加权投票统一，够长的插话保留自己的说话人；段取词的说话时长最多的那个）。`speakerId` 按首次出现编号 `spk-1`、`spk-2`……，同一 Job 内稳定，跨 Job 不承诺一致；`job.segment` 与 `segments.jsonl` 里的段还没有说话人。算法、阈值与测试从 v2 原样移植，Pyannote 有 MLX 与 candle 两份（MLX、Core ML 后端用 MLX 的，candle、GGML 后端用 candle 的）。模型包没有 `segmentation` 与 `speaker` 组件（没装「说话人区分」模型包，§6.3），或者加载、推理出错时不区分，带 `diarization-unavailable` 警告，转写照常发布（v2 是让整个任务失败）。说话人区分的耗时计入 `asrMs`。

Worker 内部用 f32 秒计算，输出一律换算为声明 `timescale` 的整数 tick；秒与 tick 的边界只在 Worker 内。

**已有转写的说话人区分**（AI 工具「识别说话人」）。不重新转写：固定流程 `speakers`（§7.9）把视频里一份 `speech` 文档的词时间与它的素材交给只装「说话人区分」模型包的 Worker（`job.run` 的 `diarize`，Model Worker 协议规范 §2.5.5），算法与第 7 步相同，结果是每个词的说话人。Runtime 再整理成提案：按重叠时长复用已有的说话人（保留 ID 与名字，库里的音色绑定与配音的说话人绑定不断），复用不上的新建；经字幕与翻译核心试算一次应用，得出每位说话人的句数与试听片段，以及会重切的译文条数。提案存成产物，摘要给界面的确认页，流程本身不改视频。用户确认（可以改名）后由 `edits.applySpeakers` 应用，一笔可撤销的编辑：转写写新版本，`baocut.translation/2` 的译文按新的说话人边界重切、写新版本（不重译）；字幕层不重新生成，与改原文相同由界面提示过期。文稿或参与试算的译文在识别之后改过时拒绝应用（`STALE_JOB_INPUT`），要重新识别。参数、摘要与拒绝见命令与协议规范 §4.1（`pipelines`、`edits`）。这一步只在本机跑；智能体与 MCP 对外服务暂不提供，工具页的「交给 Agent」发的是意图句。

**任务规格**。`models.transcribe` 的 JobSpec 冻结：素材版本引用与内容 hash、音轨选择、可选的时间范围、语言（断言或偏好）、Provider 与模型包、是否区分说话人（`diarize`；不给时按模型：`speakers` 是 `native` 或 `pack` 的区分）、术语提示、`outputContract: 'baocut.asr-result/v1'`。输入 hash 由这些字段计算；相同输入 hash 的已发布 Artifact 直接复用（§7.3）。

**输出合同 `baocut.asr-result/v1`**。字段与校验规则见 Model Worker 协议规范 §6。要点：所有时间是整数 tick，`clock: 'source-asset'`；`outcome` 区分 `transcribed`、`no-audio-track`、`no-speech`；每个词带 `timingQuality`；结果带 `coverage`、结构化 `warnings` 与完整的 `provenance`。Runtime 在发布前执行校验，失败按 §6.5 处理。

**云端识别**。在线 Provider（§6.4）用 TypeScript 实现并输出同一合同：时间换回素材时钟的整数 tick（切片的起点与请求范围的起点都加回去）；供应商给了词时间的标 `provider`；只给段或只给文本时，词按字符长度在段内插值并标 `estimated`，与本地没有对齐器时相同；只给词时按停顿（> 0.8 秒）、句末标点与段长（> 30 秒）分段；单调修正与警告的规则与本地相同。`align` 实现之后（P1），由 JobSpec 中的 `postAlign` 决定是否追加本地 `align` Job。在线结果的 `bundleId` 为 null，`backend: 'online'`，`device: 'remote'`。准备音频时切片编码失败或 ffmpeg 超时按「运行时崩溃」处理，自动重试一次；素材解不出音频是输入错误，不重试；找不到 ffmpeg 时任务失败并提示安装。

**应用到视频**。Application（§7.1）把 `asr-result` 转为 `speech` 文档：`PutDocument`，kind `speech`，schema `baocut.speech/1`，`sourceAsset` 指向素材版本，`clock: 'source-asset'`；原始结果以内容寻址写入 `<runtime-home>/artifacts/`，其 ID 写入文档扩展（`rawResultArtifactId`），summary 写词数、说话人数与语言。视频已有这份素材的 `speech` 文档时，落点由转录流程的 `destination` 决定（§7.9「转录」），不在同一部视频里并存两份：`new-video`（缺省）由流程先在同一项目里新建一部视频、链接同一份素材，文档写进新视频，原视频与它的译文、字幕、配音不动；`replace` 是**换用文稿**，一笔事务里写已有文档的新版本、把视频换用它，并结转依赖它的内容——各语言译文各写一个新的 TranslationDocumentVersion（规则见视频格式规范 §5.3「源文稿换版本时的结转」；流程参数 `translations: 'discard'` 时不结转，译文留在旧版本上），派生自这份文稿与译文的字幕层按新文稿重新切条（与 §7.9「字幕层」同一份算法，profile 不变），字幕 pin 按时间重锚（视频格式规范 §5.5），配音计划随译文结转（视频格式规范 §7.2）。这笔事务的回执 `impact` 给出各语言保留（其中已审）、过期与没配上的句数，重锚与 `orphaned` 的 pin 数，各语言配音保留与过期的单元数，字段与转录流程摘要的 `translations`、`captionPins`、`dubs` 相同（命令与协议规范 §4.1 `pipelines`）；撤销一次回到换用之前的全部版本。当前文稿的全文指纹与 `stages.asr`（视频格式规范 §5.5）不符，说明用户改过原文：`replace` 以 `TRANSCRIPT_EDITED` 拒绝，除非调用方给了 `acceptEdited`，那是 §10.3 的接受警告，接受记录绑定提交时的文稿指纹与视频版本，应用前再查一次，指纹又变了照样拒绝。没有 `speech` 文档的视频两种落点都直接写进它。`baocut.speech/1` 与格式规范 §5.2 模型的统一见格式规范 §9，本节不另立字段。

**实时文稿**。识别途中 Worker 每完成一段推送一次 `job.segment`（Model Worker 协议规范 §3），JobManager 把它换成素材时钟上的秒，记在这个在跑的任务上，经 `jobs` 主题的 `job.segments` 增量推给客户端；快照的 `liveSegments` 给中途才订阅的客户端补齐（命令与协议规范 §10.4）。编辑器据此在时间线、文稿面板与字幕面板里先画出已识别的段落，没有说话人与词时间；第一次转录时预览还把它们当一层临时字幕叠进送给渲染内核的序列（只在预览引擎里，导出不经过）。实时段落是任务事件流的投影，不是项目内容：不进文档、不进撤销栈、不落盘，任务离开 `running`（完成、失败、取消、中断）就丢掉，完成时由应用到视频的 `speech` 文档接替；崩溃后的自动重试从头识别，段落也从头再来。不流式的来源在那之前什么也不显示：在线 Provider 收尾时一次给出全部段落，远端节点不转发段落，自分段的模型（MOSS）整段识别完才给出分段。

**取消与续跑**。取消在分段边界生效；已识别的段写入结果，但被取消的 Job 不发布。P0 的崩溃恢复是整个 Job 重跑（§6.5 的一次自动重试）。P1 的 Worker 以 append-only JSONL 逐段写结果，每条带段 id、输入 hash 与 Worker 版本；崩溃后 Runtime 校验 JSONL 前缀与当前输入一致，从下一段续跑（§7.5）。检查点不合法就整个 Job 重跑，不拼接。

**阶段**。P0：本地 `transcribe`（单一 backend）、云端 `transcribe`、校验与 Application、整 Job 重试、空闲卸载、staging 清理。P1：`align`、说话人分离、分段检查点续跑、内存压力驱逐、多 backend 选择。

### 6.7 远端节点（能力共享）

**定位**。一台机器可以把自己的本地模型能力共享给局域网或 VPN 内的其他机器。共享的是**能力**（`transcribe`、`align`、`synthesizeSpeech`、…），不是视频：提交任务的 Runtime 始终是视频的唯一写入方，远端节点只收到媒体与参数，返回与本地 Worker 相同的输出合同（§6.6），由发起方校验并应用。远端节点不是 MCP：MCP 与原生工具桥是智能体进入**本机** Runtime 的入口（§3.5），只监听本机回环；把能力共享到另一台机器只走本节的节点协议。

**两个角色，一个实现**。节点端是 Runtime 内的一个独立监听面「节点服务」，与本机网关（§4、§12.2）分开端口、分开认证，用户显式开启；它提交的任务与本机任务进入同一个 JobManager 与 `ResourceScheduler`（§7.6），使用同样的 Model Worker、staging 与清理规则（§6.5）。发起端是 Models 模块的一个 Provider（§6.1 的「经过验证的远端节点」），与在线 Provider 并列：参数、提交、事件、取消、结果下载与错误归一化都在 TypeScript 里。

**协议**。字段与端点见[节点协议规范](../spec/node-protocol-spec.md)。HTTP/1.1 + JSON；媒体流式上传并按内容摘要核对；进度是带递增 `seq` 的 NDJSON 事件流，断线后用 `since` 续接；结果按文件取回，附 sha256，支持 Range 续传。每个任务有 `clientJobId` 作幂等键，重复提交返回同一个任务。版本门：请求头携带 `nodeProtocolVersion`，不满足最低版本的直接拒绝并报告所需版本。健康端点无需认证，只报告节点身份、版本、后端、各能力的开关与忙碌度，不报告模型以外的本机信息。

**信任**。配对码（6 位、10 分钟有效、错 5 次锁 10 分钟）换取长期 Bearer 令牌；节点只保存加盐哈希，比较用常量时间；令牌在发起端经凭据存储保存（§6.8）。请求先过来源 IP 门（默认只允许私有网段、链路本地与回环，只看套接字对端，不信任转发头），再过版本门，再验令牌。管理操作（配对码、吊销、开关）只经本机网关，节点服务上没有管理端点。首版不加密，威胁模型与局域网打印机相同；公网暴露是明确的非目标，`allowAnySource` 仅用于 VPN，不提供隧道。发现用 mDNS（`_baocut-node._tcp`），TXT 记录只用于展示，不构成信任；macOS 用系统 DNS-SD。

**路由与失败**。用哪台机器由用户显式选择（模型 ID 带节点别名，或任务参数指定节点），没有自动的本地优先或远端优先，也没有自动故障转移：节点失联时任务失败为 `REMOTE_NODE_LOST`，界面提供「改用本机」的一次性动作，不得静默在弱机器上加载大模型。提交前预检：健康、版本、能力开关、模型就绪。事件流断开后重连 60 秒仍失败视为失联。取消向节点发出并等待确认，之后分别展示「本地不再等待」「节点已取消」「资源已释放」三个事实（§7.4）。

**节点端的资源与清理**。远端任务是普通 Job：按能力开关准入，受队列深度与每客户端并发上限约束（默认每客户端 1 个运行中、队列 8），磁盘低于阈值拒收。上传的媒体写在该任务的 staging 目录，任务终结即删；结果在取回后或超过保留期（默认 10 分钟）删除；节点不记录转写文本：远端任务的结果不进产物库，也不写入任何视频。节点重启后，内存中的远端任务一律标为 `interrupted`，由发起端决定重试。节点服务随 Runtime 的开关状态持久化并在启动时恢复；节点服务自身崩溃走 Runtime 的有界重启（§2.2），不单独无限拉起。

**阶段**。P1：`transcribe` 的节点服务与 Provider、配对、mDNS、界面中的「计算节点」与「共享这台电脑」。P2：其他能力、OpenAI 兼容端点、TLS 与证书固定。

### 6.8 模型服务配置

模型服务配置是 Runtime Home 里的一份持久状态，只经 Runtime 读写：

- **Provider 配置**：每个在线 Provider（API 提供方，§6.4）是否启用、提供方级的端点改写、自定义端点的显示名与声明的模型，以及它的账号。密钥与其余配置分开存放，经下面的凭据存储读写；读取配置的方法只报告掩码与「已配置」，不回显密钥。配置文件是 `<runtime-home>/store/model-services.json`（`formatVersion: 2`：开关、启用时间、端点、各 Provider 的 `accounts`、各能力的默认值），0600、临时文件加改名写入。启用时记下启用时间，并发放一条默认的持续 Grant（迁移规则，§12.5）：接收方是这个 Provider，数据种类是它提供的能力默认外发的（转写是音频；合成、生图是文本；文本生成是文本与文稿，翻译流程经它交出文稿），全部视频、按次计、金额未知、不限次数，来源记为 `provider-enable`。这保持了之前「启用即同意外发」的行为，但它现在是一条看得见、可以撤销的 Grant：用户撤销之后不会补发，之后的调用回到需要授权；停用或移除 Provider 时撤销它，重新启用（新的启用时间）时再发放一条。早期版本的配置没有启用时间，同样发放一次。这条 Grant 属于 Provider，不属于账号：增删账号、调整账号的先后都不发放也不撤销它（§12.5）。自定义端点的 `providerId` 是 `custom:<名字>`，名字为小写字母、数字与连字符。智能体 Provider（§6.9）只有开关与启用时间：它不用密钥，没有账号，配置视图的 `credential` 报告为 `none`；`models.configure` 给它密钥、端点、模型或 `verify` 时拒绝，账号方法同样拒绝。移除 API 提供方（`models.removeProvider`）对自定义端点删除整个配置；对目录里的提供方是停用它并删掉全部账号与凭据，回到没有添加的状态。两种情况下指向它的默认值都保留并报告为不可用（见下面的「能力默认值」）。
- **账号**：一个账号是一家 API 提供方的一把密钥。`accounts` 是有序的列表，每个账号存 `accountId`（随机的短 id）、`label`（用户起的名字，可以为空）、`masked`（掩码）、`enabled`、可选的 `region`（目录里有中国与国际两个基址的提供方，§6.4）与 `endpoint`（这个账号自己的基址改写，少见）、`addedAt`、`lastUsedAt` 与 `status`。配置视图的 `ProviderConfigView.accounts`（`ProviderAccountView[]`，按顺序）报告同样的字段，没有密钥。
  - **掩码**在写入密钥时算好存下：前 3 个字符、`…`、后 4 个字符（`sk-…ab12`），8 个字符以内的密钥整个换成 `•`。之后显示只用存下的掩码，任何方法、事件与日志都不回显密钥。
  - **选用**：一次调用用第一个启用且有密钥的账号，同一次调用的有界重试（§6.4）用同一个账号。调用失败不换到别的账号：密钥无效、限速与额度用尽都按 §6.4 的错误码失败，与 §6.2 的没有自动回退、重试不换一致。先后由用户决定，界面的「设为首选」是 `models.arrangeAccounts`。
  - **状态**只记录最近一次真实调用或验证的结果：成功是 `ok`；401/403 是 `invalid-key`；429 限速是 `rate-limited`，`until` 由 `Retry-After` 推出（没有时为空）；额度用尽（`insufficient-quota`）是 `quota-exhausted`；没有调用过是 `unknown`。另有时间 `at` 与不含密钥的 `detail`。状态只给人看：不据此跳过账号，也不改变选用。
  - **可用**：配置视图的 `credential` 保留，含义是有没有至少一个启用且带密钥的账号（`set` 或 `missing`；智能体 Provider 为 `none`）。没有时 Provider 报告不可用，调用以 `CAPABILITY_NOT_CONFIGURED`（`missing-credential`）拒绝。删掉最后一个账号不等于移除 API 提供方：它仍然启用，只是 `credential: 'missing'`。
  - **方法**：`models.addAccount`、`models.updateAccount`、`models.removeAccount`、`models.arrangeAccounts`，都返回这个 Provider 的视图（`ProviderView`，描述加配置；参数与错误见命令与协议规范 §4.1）。`addAccount` 与改了密钥的 `updateAccount` 带 `verify: true` 时先用新的密钥验证（见下面的「连通性测试」），不通过就不保存。`models.configure` 的 `credential` 仍然接受，供 CLI 与之前的调用使用：有账号时替换第一个账号的密钥，没有时建一个 `accountId` 为 `main` 的账号。账号的变化与其他配置一样经 `models` 主题的 `capabilities.updated` 送达。浏览器能调用哪些方法见 §4.8。
  - **迁移**：读到第 1 版的 `model-services.json` 时，每个有 `provider:<providerId>` 凭据的 Provider 建一个账号（`accountId: 'main'`，`label` 为空，掩码由读出的密钥算出）：先把密钥写到新键，写成功后写第 2 版的配置文件，最后删掉旧键；旧键删不掉时留到下次打开再删，不影响使用。没有凭据的 Provider 不建账号。文件与钥匙串两种后端同样处理；中途失败时旧键与第 1 版的文件都还在，下次打开重新迁移。
- **凭据存储**：在线 Provider 的密钥与节点的令牌（节点协议规范 §11）都经 `CredentialStore` 读写，Runtime 里只有一个实例。接口只有 `get`、`set`、`delete`、`has`，没有列出密钥的方法；键带命名空间：`provider:<providerId>/<accountId>`（自定义端点是 `provider:custom:<名字>/<accountId>`；第 1 版的 `provider:<providerId>` 只在迁移时读）、`node:<nodeId>`。移除 Provider 同时删除它全部账号的凭据，移除账号删除那一个，移除节点删除它的令牌；写入先落凭据，再改其余配置。后端由构建类型决定，不是用户设置也不是运行时的开关：
  - **文件**（开发版本）：`<runtime-home>/store/model-credentials.json`，内容 `{ formatVersion: 2, credentials: { "<键>": "<密钥>" } }`，只放密钥，0600、临时文件加改名写入。第 1 版的文件（以 `providerId` 为键、只有 Provider 的密钥）照原样读出。
  - **系统安全存储**（正式版本，构建参数仍称 `keychain`）：macOS 使用钥匙串通用密码条目，service 固定为 `com.baocut.runtime`，account 是键；Windows 使用 Credential Manager 的通用凭据，目标名为 `<键>.com.baocut.runtime`，经 keyring 的 Windows 原生后端读写。条目不区分 Runtime Home。Runtime 是普通的 Node 进程，经随应用签名的原生组件 `credential-helper`（§13.1）访问：每个操作起一次助手，stdin 写一行 JSON 请求（`{ op, key, secret? }`，`op` 为 `get`、`set`、`delete`、`has`，只有 `set` 带 `secret`），stdout 读一行 JSON 响应（成功是 `{ ok: true }`，`get` 另带 `secret`、`has` 另带 `exists`；失败是 `{ ok: false, error, message }`）。错误码是封闭集合：`not-found`、`denied`、`unavailable`、`unsupported`、`internal`；macOS 与 Windows 以外助手对一切操作答 `unsupported`。助手的位置依次是 `BAOCUT_CREDENTIAL_HELPER`、`BAOCUT_BIN_DIR`（随应用分发的原生程序所在的目录，Windows 上带 `.exe`；设了就不再往下找）、开发时 cargo 产物目录里的构建结果；桌面端的正式版本由主进程把 `BAOCUT_BIN_DIR` 设为 `<resources>/bin` 交给 Runtime，各 Worker 也按同样的顺序找。
  - **迁移**：钥匙串后端每次启动先把明文文件里遗留的凭据逐个写进钥匙串，写成功的从文件里删掉，全部迁完删除文件；迁不进去的留在文件里等下次启动，日志只记键与原因。之前版本存在 `nodes.json` 里的节点令牌同样逐个迁走（节点协议规范 §11）。
  - **不可用**：钥匙串不可用（助手缺失、被拒绝访问、超时）时不回退到明文文件，也不读迁移留下的密钥。依赖它的 Provider 报告不可用（`unavailableReason: 'missing-credential'`，`detail` 以「凭据不可用」开头并带原因），节点报告读不到令牌（探测为 `unpaired`）；写入或删除凭据的方法（`models.configure`、`models.addAccount`、`models.updateAccount`、`models.removeAccount`、`models.removeProvider`、`nodes.pair`、`nodes.remove`）以 `conflict` 拒绝，`details.code` 是 `CREDENTIAL_UNAVAILABLE`、`details.reason` 是上面的错误码，其余配置不变。
- **能力默认值**：每种能力的默认 `providerId` 与默认 `modelId`，可以为空。Provider 被停用、节点被移除或模型包被卸载后，指向它的默认值保留但报告为不可用，不悄悄改指别处。例外是删除本地模型包（`models.remove`，§6.3）：没有出厂默认的能力（`synthesizeSpeech`、`generateImage`、`generateText`，§6.2）里指向它的默认值一并清除，回到未设置；`transcribe` 与 `separateAudio` 有出厂默认，指向它的默认值仍然保留并报告为不可用，不落到出厂默认。

- **能力参数的默认值**：只属于某一种能力的调用参数，例如 `generateText` 的推理强度与并发上限。经 `models.setCapabilityParameters` 设置，给出的字段替换、null 恢复默认；`models.capabilities` 在这种能力下报告当前值。推理强度为空时交给模型自己的默认；并发上限默认 4（1–32），按 Provider 计，任务与进程内调用共用，改动对下一次取得名额生效。
- **连通性测试与模型发现**：`models.configure`、`models.addAccount` 与 `models.updateAccount` 带 `verify: true` 时，保存之前用新的密钥与端点向供应商发一个只读请求（列模型），不通过就不保存；它只证明凭据与端点可用，不证明某个模型或音色可用，只在用户要求时执行。`models.refreshProvider` 向供应商取可用的模型与音色列表，缓存在配置里并记录时间；取不到时保留内置的列表并标明。取到的列表只用来标注内置的模型，不替换它们：不在列表里的内置模型报告为不可用（`unsupported`，`detail` 写明刷新的时间），默认值指向它时同样不可用而不改指；ElevenLabs 账号里的音色补进没有预置音色的模型。适用于目录里的在线提供方与自定义端点（OpenAI 与兼容的提供方列 `{base}/models`，Anthropic 列 `{base}/v1/models`），用第一个启用且有密钥的账号；`local`、节点与智能体 Provider 以 `invalid-request` 拒绝。取不到时（`ok: false` 与不含密钥的原因）上一次的结果也一并丢弃，回到内置的列表；它从不改动开关、凭据与默认值。

`models.capabilities` 是这份状态的只读视图：每种能力下各 Provider 的模型、限制、默认值、此刻是否可用与不可用的原因（`generateImage` 的本地 Provider 排在在线与智能体之后，与界面的模型菜单同序）。界面的设置页、CLI 与智能体的工具读同一个视图；它也是能力快照里模型能力条目的来源（§3.6）。配置变化经 `models` 主题送达（`capabilities.updated`，带完整的新视图），进行中的任务不受影响（它们已经冻结了选择，§6.2）。CLI 的 `baocut models`、`models configure`（密钥只从标准输入读）与 `models default` 用的是同一组方法；`baocut speak` 与 `baocut image` 提交生成任务、等它结束，并经 `artifacts.openHandle` 把产物另存到 `--out`。`baocut text` 同样提交 `models.generateText`：没有 `--out` 时正文写到标准输出、Provider 与用量写到标准错误，`--json-schema <文件>` 要求结构化输出；`baocut models refresh <providerId>` 与 `baocut models parameters generateText [--effort] [--concurrency]` 对应上面两个方法。

本地的 `synthesizeSpeech` 由 `local` Provider 提供（§6.1），模型是合成的本地模型包（§6.3），与在线 Provider 一样要显式选择或设为默认值；本地的 `generateImage` 同样由 `local` Provider 提供，模型是文生图的本地模型包，没有出厂默认、也没有「自动选择」。节点共享这两种能力属于 P2（§6.7）。

### 6.9 智能体作为 Provider

有些能力可以由用户已经订阅的智能体运行时完成，不需要 API key。首版只有一种：用 Codex 生成图片，`providerId` 是 `agent:codex`，能力是 `generateImage`。

`AgentDriver` 与 `ModelProvider` 仍然分别注册（§3.1）。智能体 Provider 来自第四种 Provider 来源（`kind: 'agent'`），与本地、节点、在线来源并列；它只在注册了对应的 Driver 时列出。它是一个普通的 `ModelProvider`，在内部经同一个 Driver 的机器协议发起一次受限的调用（不另写一份协议实现），对外遵守 `generateImage` 的全部合同：

- **一次调用一个专用的原生会话**。它不属于任何用户会话，不带视频上下文与对话历史，也不恢复旧的线程；输入只有提示词、参考图与输出要求（开发者指令说明任务与输出文件，回合的输入是提示词原文）。工作目录是该 Job 的 staging 目录；不给 MCP 服务，没有 BaoCut 的工具。访问模式固定为「只写工作目录」（Driver 的 `confinement: 'cwd-write-only'`）：Codex 用 `workspace-write` 沙箱，去掉默认可写的 `/tmp` 与 `$TMPDIR`、不加别的可写目录、命令不联网，审批策略为 `never`；会话仍然发来的审批请求一律拒绝，因为没有人来批。一次调用只发一个回合，回合结束（完成、失败、超时、取消）后原生会话关闭；取消 Job 时先中断回合再关闭会话。一个回合的期限是 10 分钟，到时中断、关闭，Job 以 `PROVIDER_UNAVAILABLE` 失败。原生运行时自己保存的会话记录（例如 Codex 的会话目录）不由 BaoCut 管理。
- **输出同样校验**。约定的输出是工作目录里的 `output.png`；没有它时取 staging 里唯一的一张图片（子目录也找，只收普通文件，不跟随符号链接），有多张时全部交出，由张数校验拒绝。声明的媒体类型是请求的格式，之后与其他 Provider 一样由 JobManager 核对摘要与长度、按文件头与 ffprobe 解码校验（§6.4、§7.1），实际的像素尺寸作为事实记在输出里，再发布为产物；给了视频时导入为候选素材，与其他 Provider 相同。智能体的文字回复不是输出：没有图片时 Job 以 `PROVIDER_REJECTED` 失败（`details.reason: 'no-image'`，附回复的摘录）；回合失败或被中断也是 `PROVIDER_REJECTED`（`turn-failed`、`turn-interrupted`）；写下的文件不是合格的 PNG 时是 `MODEL_OUTPUT_INVALID`。不重试，不换 Provider。
- **描述如实声明限制**：一个模型（`image-gen`，实际的图片模型由智能体运行时与账号决定），`maxCount` 为 1，只有 `png`，`sizes` 与 `aspectRatios` 为空、`defaultSize` 为 null，`acceptsSeed` 为 false，费用状态是 `subscription`（「订阅内，额度未知」），`notes` 一句话说明串行、耗时与额度。不支持的参数在提交时拒绝，不标为被忽略：给了尺寸或宽高比、seed、多于一张、别的格式都是 `invalid-request`，不创建任务。队列按 Provider 划分，同一时间只运行 1 个任务。
- **可用性来自 Driver 的状态**（§3.11），按顺序：没有安装（`not-installed`）、没有登录（`signed-out`）、Driver 别的不可用（`unsupported`）、版本低于这个 Provider 要求的最低版本（`outdated`；`agent:codex` 要求 0.158.0，即协议对照的版本）、用户没有启用（`not-configured`）。前四种的补救是 `setup-agent`：在智能体运行时自己的界面里安装、登录或升级，`hint` 给出做法；最后一种是 `enable-provider`。`models.capabilities` 只探测这个 Provider 对应的 Driver：Driver 注册表（§3.11）里 10 秒之内的结果直接用，否则只重新探测这一个 Driver 并等它，结果写回注册表的缓存（也经 `agents` 主题推送），不等别的 Driver 的探测；选择与视图只在用户启用了它时探测，没启用时用最近一次的结果，不为没启用的 Provider 启动外部命令。执行前再确认一次：排队期间被停用、退出登录或卸载的，不再开会话，Job 以 `MODEL_LOAD_FAILED` 失败。
- **启用是唯一的配置**（§6.8）：用户在模型服务配置里显式启用它；没有密钥、端点与模型声明，用的是智能体运行时自己的登录。启用即同意把提示词与参考图交给该智能体运行时登录的账号与服务方，用的是用户自己的订阅额度。
- **选择规则不变**（§6.2）：它可以被显式指定，也可以被设为 `generateImage` 的默认；出厂默认不指向它。
- 其他能力与其他 Driver 按同一模式加入，各自经过验证后开放。

### 6.10 用量账本

在线与智能体 Provider 的每一次真实调用记一条用量，供设置里的「用量」页与 API 提供方详情查看（产品设计 §7.6）。它回答用了多少、大概花了多少，不是预算：授权与预算的账本是 `store/grants.json`（§7.8、§12.5），准入不读这份账本。

**文件**。`<runtime-home>/store/usage.jsonl`，只追加，0600，一行一条记录。读到坏的行跳过。

```ts
interface UsageRecord {
  at: string;                         // ISO 时间，调用结束时
  providerId: string;
  accountId: string | null;           // 智能体 Provider 与没有保存的验证为 null
  capability: ModelServiceCapability | null;   // source 为 'verify' 时为 null，其余必填
  modelId: string | null;                      // 同上
  source: 'job' | 'inline' | 'agent-tool' | 'verify';
  ref?: { jobId?: string; taskId?: string; conversationId?: string };
  units: UsageUnits;
  cost: { kind: 'reported'; amount: string; currency: 'USD' | 'CNY' } | { kind: 'unknown' };   // 估算不写进账本
  durationMs: number;
  status: 'ok' | 'error';
  error?: string;                     // 错误码与一句说明，不含密钥
}
interface UsageUnits { inputTokens?: number; outputTokens?: number; cachedTokens?: number; audioSeconds?: number; chars?: number; images?: number }
```

**写入点**。在线 Provider 的每次调用在结束处（成功或失败）写一条：转写、语音合成、生图与文本生成各一处。文本生成的两个入口都记，`models.generateText` 的 Job 是 `job`，进程内 `TextGenerator` 的调用是 `inline`；智能体工具直接发起的是 `agent-tool`。一次调用内部的切块（§6.4）与有界重试合成一条，用量相加。验证密钥（`verify`）也记一条：它不属于某种能力或某个模型，`capability` 与 `modelId` 为 null（其余来源都必须给出），`units` 为空、不计费用；验证不通过、账号没有保存时 `accountId` 为 null。智能体 Provider（`agent:codex`）同样记录，`accountId` 为 null，费用是 `unknown`。本地与局域网节点的调用不记：它们不计费，数据也不离开用户自己的设备。

**用量**按能力填：文本是输入、输出与缓存命中的 token，转写是音频秒数，语音合成是字符数（按 Unicode 码点，与 §6.4 的上限同一口径），生图是张数。供应商报告了的用报告的，没有报告的项留空，不估算用量。

**费用**。账本只记 API 提供方报告的金额（`reported`，原样的币种）；没有报告时是 `unknown`。估算不写进账本，在读的时候按价目表算：`packages/models/src/model-prices.ts` 是一张常量表，按 `providerId/modelId` 给出每百万输入、输出与缓存 token、每分钟音频、每千字符与每张图的单价和币种，每个单价在注释里写明官方价目页与查阅日期，拿不准的不填。价目表更新之后，过去的估算按新表重算：估算只是参考，不是账单。

金额分三种：提供方报告（`reported`）、按标价估算（`estimated`）与未知（`unknown`），不得合成一个数掩盖其中的差别。一条记录有报告就用报告；否则价目表里有这个模型的单价、所需的用量也齐全时算出估算；否则是未知，计入未知的次数。不同币种分别汇总，不换算。

**读取**。`models.usage { period, providerId? }` 返回 `UsageReport`；`period` 是 `today`、`7d`、`30d` 或 `all`，按 Runtime 所在机器的本地日期划分，`providerId` 只看一家 API 提供方。

```ts
interface UsageReport {
  period: { from: string; to: string };
  totals: { calls: number; failed: number; units: UsageUnits; cost: { estimated: Money[]; reported: Money[]; unknownCalls: number } };
  byDay: Array<{ day: string; calls: number; units: UsageUnits; byCapability: Partial<Record<ModelServiceCapability, number>> }>;
  byProvider: UsageRow[]; byCapability: UsageRow[]; byModel: UsageRow[]; byAccount: UsageRow[];
}
interface UsageRow {
  key: string; label: string; providerId?: string;
  calls: number; failed: number; units: UsageUnits;
  cost: Money[];                                      // 按币种，一种一项；没有可计的金额时为空
  costKind: 'reported' | 'estimated' | 'mixed' | 'unknown';
}
```

`Money` 是 `{ amount, currency }`，金额是十进制字符串（与 §7.8 相同）。`costKind` 说明这一行的金额从哪里来：全部报告、全部估算、两者都有，或一个都没有。账号的 `label` 为空时用掩码；已经删掉的账号仍按 `accountId` 列出。用量不进视频，也不进 Space。

**余额（P1）**。`models.checkBalance { providerId, accountId? }` 用账号的密钥向 API 提供方查余额，返回余额（按币种）与查询的时间；`accountId` 不给时用第一个启用且有密钥的账号。只有开放了查询接口的提供方才支持：DeepSeek（`/user/balance`）、OpenRouter（`/api/v1/credits`）与 Moonshot（`/v1/users/me/balance`）；其余的以 `invalid-request` 拒绝。查到的余额不写进用量账本，也不参与预算。

---

## 7. Jobs 与调度

### 7.1 执行与应用分开

「产物就绪 → 等待应用 → 已应用」在产品上是一个流程，但数据库不把它压成所有 Job 共用的一条状态链。一个 Artifact 可以多次应用到不同的视频；导出与分析类的 Job 可以没有视频应用。

```text
Job：
created → awaiting-approval → queued → running
   → succeeded | failed | interrupted
   → cancel-requested → cancelled | needs-reconciliation

Artifact：
staging → validated → published（不可变）

Application：
pending → validating → committed
                  → stale-input | rejected | cancelled

Task / Run：
planned → running → needs-review / stopping
        → completed | partially-completed | failed | stopped
```

Job `succeeded` 只说明输出合同成立。Task `completed` 按 TaskContract 的 `deliverables` 与阻断问题结算：

| `requiredStage` | 结算条件 |
| --- | --- |
| `candidate-ready` | 有真实可以打开的候选 |
| `committed` | 有目标版本的回执 |
| `published` | 有经过校验并已发布的文件 |

界面可以组合显示「音频已生成，待应用」，但不把两个事实合并成一个有误导性的状态。

生成任务（`synthesizeSpeech`、`generateImage`）的阶段：`queued → starting → generating → validating → publishing →（给了视频时）applying → done`，进度按已拿到的输出个数（`unit: 'outputs'`）。给了视频时，发布之后由 Runtime 以 `system:jobs` 的身份用一笔事务把全部输出导入为素材：只是候选，不放上时间线；素材来源记 `origin: 'generated'` 与任务、Provider、模型、输入 hash、产物与参数摘要，不记原文与提示词。视频在读与写之间被改过时换一个 `commandId` 重读重试，至多 3 次；导入失败时任务失败为 `APPLY_FAILED`（视频已经关闭时为 `STALE_JOB_INPUT`），已发布的产物保留在结果里。没有视频时发布即完成，冻结的参数就是生成记录（§7.9）。提交时给出的视频必须已经打开，任务期间保持打开。

实现里的 Job 状态是 `queued`、`running`、`completed`、`failed`、`cancelled`、`interrupted`、`needs-reconciliation`。`needs-reconciliation` 与后四种一样是终结状态：不再执行，等用户用 `jobs.reconcile` 决定（§7.5）。Application 的状态集合封闭，就是上图的六种，没有别的。转写与生成每次把结果写进视频都是一条 Application；任务记录的 `applications` 按先后列出它们，任务的 `state` 是执行与最近一次应用合起来的结论：

| 最近一次应用 | 任务 | 产物 |
| --- | --- | --- |
| `committed` | `completed`，`result` 补上文档或素材 ID | 已应用 |
| `stale-input` | `failed`（`STALE_JOB_INPUT`） | 保留在 `result` 里，是候选 |
| `rejected` | `failed`（`APPLY_FAILED`；回执查不到时 `details.reason` 为 `RECEIPT_UNKNOWN`） | 同上 |
| `cancelled` | `cancelled`（停止之后不再自动应用，§7.4） | 同上 |

### 7.2 任务规格与应用记录

```ts
interface JobSpec {
  id: Id;
  taskId: Id;
  runId: Id;
  runGeneration: string;
  capability: string;
  inputVersionRefs: VersionRef[];
  frozenInputRef: Id;
  parameters: JsonValue;
  providerSelection: ResolvedProviderSelection;
  permissionGrantRef: Id;
  budgetReservationRef?: Id;
  outputContract: string;
}

interface ApplicationRecord {
  applicationId: Id;
  jobId: Id;
  /** 已发布的不可变产物。 */
  artifactIds: string[];
  videoId: Id;
  /** 与 `artifactIds` 一一对应的目标：转写是素材 ID，生成是导入操作的 ref（`output1`……）。 */
  targetRefs: string[];
  /** 校验时读到的视频版本；还没有校验时 null。 */
  baseVideoRevision: Revision | null;
  /** 最近一次提交用的命令；还没有提交时 null。 */
  commandId: Id | null;
  state: ApplicationState;
  /** `recovered`：回执是重启或对账之后按 `commandId` 向引擎查回来的。 */
  receipt: { transactionId: Id | null; videoRevision: Revision | null; refs: Record<string, Id>; recovered?: true } | null;
  error: JobError | null;
  createdAt: string;
  updatedAt: string;
}
```

`inputVersionRefs`、权限和预算由服务端冻结。任务不能执行到一半改成读取「当前视频」；变更输入需要新的尝试。

应用记录的权威是 `<home>/store/applications.jsonl`（应用账本，与任务账本分开）；任务记录里的 `applications` 是它的投影，任务从账本里淘汰时它的应用一并删除。`JobSpec` 里的 `taskId` 没有实现。`runId` 与 `runGeneration` 只用于引擎侧的停止屏障（§7.4），不进任务记录，由 Runtime 在提交时算出：Task 与 Run 实现之前，任务自己就是它的执行，`runId` 是任务 ID，`runGeneration` 是任务的 `attempt`；固定流程的步骤用父任务的。

生成任务的输入是文本或提示词本身：`contentHash` 是它的 sha256，`inputHash` 是能力、Provider、模型与冻结参数的规范 JSON 的 sha256。相同的输入摘要不复用已有的结果（生成不保证可复现，再生成就是要一个新的结果）；同一个 `commandId` 的重复提交返回同一个任务。

长调用立即返回 `jobId`。异步完成的通知进入持久化的 inbox，按事件去重；检查 Task 未停止、授权与预算仍然成立之后，才能唤醒后续的 Agent Turn。

### 7.3 从产物到视频的可恢复闭环

```text
冻结输入 → 执行 → staging bytes → 校验并原子发布 Artifact
  → 创建 Application → 读取当前视频 → 检查目标与输入
  → 提交幂等的 Transaction → 持久回执 → 标记 committed
```

- 视频已提交而 Node 尚未记录成功就崩溃：恢复时以 `commandId` 向 Engine 查询回执，不得重复插入素材。
- 结果已发布但目标已被删除：保留候选并标记 `stale-input`，不猜测邻近的对象。
- 相同内容可以复用时不重新购买；内容已变时不能强行套用旧的声音。

**落账的顺序**：

1. 产物写进产物库之前，先把发布意图写进任务账本：将要写的产物 ID、结果、应用的目标与警告。产物库按内容寻址，ID 在写入之前就算得出。
2. 产物发布之后，先把结果、预算的结算与一条 `pending` 的应用写进两本账（同时清掉发布意图），再开始校验。
3. 每次提交之前换一个新的 `commandId`（`cmd_<applicationId>_<n>`），与 `baseVideoRevision` 一起记为 `validating`，等落盘之后才提交事务。同一个命令带不同的载荷会被引擎当作幂等冲突，所以重新校验之后从不复用旧命令。
4. 事务提交之后记回执（`committed`）。

**认领已写好的产物**：重启时任务带着发布意图，说明产物可能已经写进产物库、结果还没有落账。

- 意图里的产物都在、按 sha256 核对无误时认领：记下结果，有目标时新建一条应用补做（同「产物已发布，应用没有结束」），没有目标时任务完成。不重新推理，不重新请求供应商；预算按完成结算一次。
- 产物缺了或对不上时丢掉意图，按「在跑」恢复（§7.5）。
- 意图记在任务账本里，不给产物附任务的元数据：产物库按内容去重，同样的 bytes 只有一个文件，附元数据与这条规则冲突，恢复时还要扫产物库。代价是每次发布之前多一次账本的持久写入。

**账本的持久性**：任务与应用两本账是只追加的 JSONL（`store/jobs.jsonl`、`store/applications.jsonl`）。第一行是文件头 `{"op":"header","formatVersion":2}`，之后每行一个操作：`{"op":"put", ...记录}` 写入或替换一条，`{"op":"remove","jobId"|"applicationId":…}` 删一条；账本记住每条上次落盘的样子，只追加变化了的行，每次追加都 fsync 文件（新建时再 fsync 目录），发布意图的顺序靠它。重放时任务按创建先后留在原位，应用再次写入移到最后（旧的在前）。行数超过 max(4 × 存活记录数, 256)，或字节超过 8 MiB 且超过存活记录的两倍时，把存活记录整份压缩成新文件（临时文件 + fsync + 改名 + fsync 目录）；追加与压缩在同一条串行写链上，写失败后下一次写整份压缩。读取：末尾残行与认不出的行跳过并记日志、下一次写压缩掉；文件头认不出时改名 `.corrupt-<时间>` 保留、从空开始；旧的整文件 `jobs.json` / `applications.json` 启动时导入并改名 `.migrated`。授权账本仍用持久的原子替换（先写临时文件并 fsync，再改名，最后 fsync 目录）。别的文件（设置、会话等）只做原子替换或追加，不 fsync。产物库的写入是临时文件写完（或克隆完）fsync、改名、再 fsync 目录：账本引用的产物在记账之前已经落盘（macOS 上 Node 的 fsync 不是 `F_FULLFSYNC`，这个保留说明同样适用）；认领时仍按 sha256 核对，兜住更早写下的产物、磁盘自己的写缓存与外部改动。

**产物库的清扫**（`StorageGc`，`runtime-core/src/storage-gc.ts`）：`artifacts/` 里没有引用、修改时间超过 1 小时、又不早于清扫起点（§5.7 的 `sweepSince`）的文件删掉，残留的 `.tmp` 超过 1 小时同样删掉。引用集合按文本找全部 `sha256:<hex>`：账本里任何状态的任务（记录、冻结的规格、执行参数、发布意图）与应用账本，加上 Space 产物记录（含只为清扫保留的引用，以及磁盘上留存的 `space-artifacts.json.corrupt-*` 里的）。1 小时宽限的来由是产物先写进库、后记账；重新发布已有内容时刷新文件的修改时间。时机：Space 从账本补齐记录之后跑一轮，之后每次账本淘汰任务后等 30 秒合并成一轮；有排队或运行中的任务时整轮跳过（流程在步骤完成前只在暂存目录里记着刚写的产物），由下一次淘汰或每小时的定时补跑；产物记录整个读坏、从空开始的这次运行不清。

**按命令查回执**：引擎的回执在视频目录里持久化，Engine Host 重启后照样可查（`receipts.byCommand`）。

- 重启时还没结束（`pending`、`validating`）的应用，先按记下的 `commandId` 查回执。查到就补记，不再写；没有就从记录与产物重建同样的操作，重新校验后换新命令提交。
- 提交出错而不知道事务有没有落下时（连接断开、引擎重启），也先查回执。
- 查询本身失败（引擎不可用）时不换命令重写：应用记为 `rejected`（`RECEIPT_UNKNOWN`），留给 `jobs.reconcile apply`。`apply` 同样先查回执，查不了时以 `busy` 拒绝。
- 视频在读与写之间被改过（`conflict`）时换命令重试，至多 3 次。
- 引擎的任务保护拒绝（`TASK_PROTECTED`，§3.2）与停止屏障（§7.4）一样没有开事务：不查回执，不重试，应用记为 `rejected`。

**预算**：在产物发布时按完成结算。之后应用成不成功、是重启补做还是对账时 `apply`，都不再调用供应商，不再结算。

**视频的位置**：提交时记下视频的位置（来源目录、相对路径与所属的项目或会话）。重启后视频没有打开时，以 `system:jobs-recovery` 的身份按位置重新打开，持有租约，应用结束后释放。目录不在了、或那里已经是别的视频时，应用是 `stale-input`。

**测试**：`JobManager` 的 `faults`（Runtime 的 `jobFaults`）在这些时刻模拟崩溃或插入动作：

- `artifact-stored`：产物已写进产物库，结果还没有落账（只有发布意图）；
- `artifact-published`：产物已发布，还没有应用；
- `application-recorded`：账本已写下命令，还没有提交；
- `application-committed`：已经提交，还没有记回执；
- `application-submitting`：Node 侧的检查都过了，还没有交给引擎。测试在这里取消任务，模拟停止与提交赛跑。

端到端测试用真实引擎，在同一个 `BAOCUT_HOME` 上重启 Runtime。

### 7.4 停止屏障与取消

主按钮 `tasks.stop`：

1. 把当前 Run 标为 `stopping` 并提升 `runGeneration`，新的工具准入和自动应用立即被拒绝；
2. 向 Agent Turn 与子 Job 发出取消。子 Job 是这个会话里智能体提交、还在排队或运行的 Job（`submitter` 为这个会话，不限于本次 Task 提交的，§7.9），走与 `jobs.cancel` 相同的路径；已经结束的 Job 保留结果，别的会话与用户提交的 Job 不受影响。请求取消了几个记在会话的一条提示里。

所有待应用的命令必须校验 `runGeneration`。已经进入不可分割提交段的事务先线性化完成并给出回执；停止确认同时列出这些已经完成的修改。

**屏障不能只是 Node 内存里的一个布尔值。** Runtime 经私有通道向 Engine Host 提交 `runGeneration` 失效控制；Engine 在同一个视频的串行提交入口检查该代。`tasks.stop` 的「本地停止生效」响应必须等到屏障被确认；已排队但尚未线性化的旧代自动应用一并拒绝。Engine 重启或连接换代之后，旧的授权句柄全部失效，由新的 Runtime 显式重新登记；不能凭旧命令携带的 generation 自行恢复授权。重新登记没有实现（§14）：Engine Host 重启之后只有 Node 侧的屏障。

**停止被接受不等于远端已取消。** 未能取消的外部结果可以保留为候选，但不自动应用。本地停止的性能目标（验收与测试 §4）指的是停止新的调用与自动应用，不是供应商已停止计费。已提交的编辑不会因为停止而自动消失。

**Node 侧的屏障**是任务的取消请求：`jobs.cancel`，以及 `tasks.stop` 对子 Job 的取消。应用在校验之前与提交之前各检查一次：

- 已经停下的不再提交：应用记为 `cancelled`（`APPLICATION_CANCELLED`），任务 `cancelled`，产物保留为候选，由用户 `jobs.reconcile apply`；
- Node 侧检查之后才停下的那一笔由引擎侧的屏障拒绝；引擎已经线性化的照常完成，给出回执；
- 重启之后，智能体提交的任务不自动应用，因为它的 Run 已经随重启结束：先查回执，没有提交过就记为 `cancelled`。

**引擎侧的屏障**只管任务与固定流程写视频的提交。用户与智能体的普通编辑、`jobs.reconcile apply` 都不受它影响。

- 这些提交（`edits.apply`）带 `run { runId, runGeneration }`。
- 取消时，Runtime 在任何等待之前经私有通道发出 `runs.invalidate { videoId, runId, runGeneration }`。Engine Host 记下这个视频上这个执行失效到的代，只增不减。
- Engine Host 在视频的串行提交入口检查：提交的代不大于失效的代、这个命令又没有回执时，以 `TASK_STOPPED` 拒绝，不开事务，不写回执。已有回执的命令照样返回原回执，幂等不受影响。
- Node 把 `TASK_STOPPED` 记为应用 `cancelled`（`APPLICATION_CANCELLED`，`details.barrier: 'engine'`）。它不是 `rejected`：不查回执，也不重试。
- Engine Host 按顺序逐条处理请求。所以 `runs.invalidate` 得到确认时，先于它交给引擎的提交都已经有了结果，之后到的都被拒。`tasks.stop` 等子 Job 的屏障确认之后才回答，至多等 5 秒。引擎卡住时不再等，之后到的提交只有 Node 侧的屏障。
- 失效记录有界：视频关闭时清掉，每个视频至多记 1024 个执行，超出时丢最早的。视频没有打开时不记，因为没有打开的视频收不到提交。
- Engine Host 重启时失效记录丢失，回退到 Node 侧的屏障。新的 Runtime 不重新登记失效。

**取消的三件事实**记在任务记录的 `cancellation`（`JobCancellation`）里，界面与 CLI 分开显示，不合成一个「已取消」：

- `localStoppedAt`：本地不再等待的时刻。
- `remote`：
  - `not-applicable`：本机计算，或结果已经拿到；
  - `not-submitted`：还没有发出；
  - `cancelled`：节点确认停下了；
  - `cancel-unsupported`：在线 Provider，断开请求不等于供应商停下；
  - `unknown`：不知道。
- `cost`：
  - `none`；
  - `possible`：可能已经计费；
  - `charged`：结果已经拿到，费用已经产生。

次级操作：

| 操作 | 作用 |
| --- | --- |
| `agents.interrupt` | 只停当前的回复，不建立屏障，不取消 Job |
| `jobs.cancel` | 只取消一项计算 |
| 停止并撤销 | 先建立屏障，再逐项验证补偿；不回滚整份旧视频 |
| 暂停 | 只有真正支持安全续跑的任务才提供 |

### 7.5 对账与恢复矩阵

| 失联点 | 恢复行为 | 禁止 |
| --- | --- | --- |
| Job 尚未被领取 | 重新入队之前校验 Task 与权限 | 执行已停止的旧 Run |
| 本地分段任务有合法的检查点 | 验证输入与状态后继续 | 把部分中间文件当作完整结果 |
| 本地推理或编码没有恢复能力 | 标为 `interrupted`，允许新的尝试 | 伪称可以暂停续跑 |
| Model Worker 崩溃 | 当前 Job 标为 `interrupted`，按 §6.5 有界自动重试；超过阈值停用该模型包 | 无限拉起同一个崩溃的模型；把部分段结果当作完整转写 |
| 云端已提交，有任务 ID | 查询远端后接续 | 自动重新购买 |
| 云端提交结果未知，且不可查询 | `needs-reconciliation`，由用户决定 | 把超时当作从未提交 |
| 远端节点失联 | 重连 60 秒；仍失败则任务失败为 `REMOTE_NODE_LOST`，提供「改用本机」 | 自动换到另一台机器或本机 |
| Artifact 已发布，尚未应用 | 复用产物并重新验证 Application | 重新生成并重复计费 |
| 视频已提交，回执响应丢失 | 用同一幂等键查询原回执 | 重复添加字幕或片段 |
| Agent 是否接受了输入不明 | 查询原生会话，或标为不确定 | 盲目重发同一指令 |

服务恢复、会话恢复、任务恢复分别测量。取消涉及的三个事实——本地不再等待、远端已取消、费用已产生——分别展示（§7.4）。

**实现**：启动时读账本，按每个任务停在哪里处理。要等授权与模型服务就绪的（重新排队、补做应用、查询远端）在启动之后进行。

| 停在哪里 | 处理 |
| --- | --- |
| 排队，没有被领取（连接、Runtime 或对外服务提交的转写与生成） | 旧的预留释放。按记下的位置重新打开视频，读素材并核对内容，重新选择 Provider，重新准入授权与预算，通过后以同一次尝试重新排队。输入不在了是 `failed`（`STALE_JOB_INPUT`）；Provider、授权或预算此刻不成立是 `interrupted` |
| 排队，预留却已经记为开始（「已开始」落盘之后、记下 `running` 之前崩溃） | 按下面「结果不明」处理：`needs-reconciliation`，预算保守结算，不重新排队 |
| 排队，智能体提交 | `interrupted` |
| 本机或节点在跑 | `interrupted` |
| 在线或智能体 Provider 在跑，有可查询的远端任务 ID | 查询远端：`failed` 失败，`not-found`（请求没有到达）`interrupted`，其余 `needs-reconciliation`。只有接口（`RemoteTaskQuery`，§14） |
| 在线或智能体 Provider 在跑，结果不明 | `needs-reconciliation`（`JOB_NEEDS_RECONCILIATION`）。预留按保守规则结算：开始执行过的计一次调用并扣下估算，与授权账本的 `conservative` 相同（§7.8）。从不自动重发 |
| 产物已发布，应用没有结束 | 复用产物，先按 `commandId` 查回执，再补做应用（§7.3） |
| 产物写进了产物库，结果没有落账（任务带发布意图） | 核对产物之后认领，同上一行；产物不全时丢掉意图，按任务停在哪里处理（§7.3） |
| 固定流程的父任务与步骤；不经模型的任务（导出、模型与工具安装、音色克隆）；远端节点代执行的；没有视频的转写 | `interrupted` |

正常停止（§2.4）同样不留悬而未决的记录：

- 排队的是 `interrupted`，下次启动不重新排队；
- 在跑的本机与节点任务是 `interrupted`；
- 在跑的在线调用是 `needs-reconciliation`，因为断开请求不等于供应商没有执行；不能由用户重试的（上表最后一行）仍是 `interrupted`，预算照样按开始与否结算。

**`jobs.reconcile`** 的决定只有三种，集合封闭。不合法时以 `conflict` 拒绝（`RECONCILE_NOT_ALLOWED`，`details` 给出 `state`、`decision` 与 `allowed`）。

| 决定 | 合法的状态 | 结果 |
| --- | --- | --- |
| `retry` | `needs-reconciliation` 或 `interrupted` 的、有视频的转写，以及生成（不是固定流程的步骤，也不是节点代执行的） | 同一个任务回到 `queued`，`attempt` 加一，重新准入：这是新的一次调用与预留，上一次的结算留在 `grant.retries`。有视频时视频要已经打开（`VIDEO_NOT_OPEN`） |
| `discard` | `needs-reconciliation` | `cancelled`，在线调用的 `cancellation` 为 `remote: unknown`、`cost: possible`。保守扣下的预算不退 |
| `apply` | `failed` 或 `cancelled`，有视频与结果，最近一次应用是 `stale-input`、`rejected` 或 `cancelled` | 先按最近的 `commandId` 查回执；没有提交过才新建一次应用，重新校验后提交。视频要已经打开 |

没有「标为已提交 / 未提交」：用户的判断无从核实，不拿它退预算或重放请求。

对账只由用户决定。各个入口：

- 智能体：在 `jobs_inspect` 里看得到状态、`applications` 与 `cancellation`，但没有对账的工具（§3.12）；
- MCP 服务：同样没有对账的工具；
- Web 服务：按 `jobs.*` 开放，只读时拒绝；
- CLI：`baocut jobs reconcile <jobId> retry|discard|apply`。

### 7.6 调度与资源

渲染、语音识别、语音合成、图像生成与浏览器会话共用同一个 `ResourceScheduler`。按 CPU、内存、GPU、磁盘与下载、外部并发限制做准入。相互独立的任务可以并行；视频事务短且有序，不在等待网络时持有视频锁。

前台预览优先，但不假定可以强行抢占：只有执行器支持安全中断才抢占。模型与浏览器实例按兼容性和安全域复用；禁止跨用户或跨不相容的授权复用含有私有状态的实例。使用有界的帧窗口、背压、显式的 surface 释放和空闲回收；不按 CPU 核数等比例启动浏览器。

目前接入调度的是 JobManager 里的任务：本机转写与模型包检查、成片与音频导出、模型下载，以及固定流程（§7.9）里声明了需求的步骤（目前是文件转码）。其余（Render Worker 的代码会话、浏览器会话、图像生成）尚未接入。规则：

- **队列并发是调度的一个约束**。每个 Provider 或执行器的队列（同一个模型包、同一个在线 Provider、同一个远端节点）照旧按先后、不超过它的并发上限；不另设一套并发系统。在线 Provider 与远端节点的调用只受这一个约束，不计本机资源。
- **容量**只用 Node 标准库：内存 `os.totalmem()`，CPU 线程 `os.availableParallelism()`，staging 所在卷的可用空间 `fs.statfs`（后台至多每 2 秒刷新，准入只读缓存的值）。Apple 芯片按统一内存估计 GPU 能用的量（32 GiB 及以下取内存的 2/3，以上取 3/4），GPU 的需求同时计入内存；其余机器 GPU 报告未知，不按它准入。偏好设置 `resources.capacity`（§5.10）可以覆盖内存、GPU 内存与线程数，改了立即重新准入。
- **预留**：系统预留谁都不用（内存的 25%、至少 2 GiB；4 个线程以上留 1 个；磁盘 1 GiB）；交互预留后台工作不用（1 GiB 内存、512 MiB GPU 内存、线程数的四分之一、至多 2 个）。
- **交互优先**：任务带优先级 `interactive` 或 `background`（默认）。交互的可以用交互预留，并排在所有后台等待者前面；不抢占正在执行的工作。目前只有模型包检查是交互的。

### 7.7 峰值工作集准入、租约与实际资源释放

`ExecutionAdmission` 根据冻结的 RenderGraph 估计**峰值时同时活跃**的代码会话、解码 surface、内存与 GPU、磁盘 staging 和外部并发，返回可执行、可等待，或不可满足及其原因。

- 9 个顺序出现的场景可以在容量为 2 的池中逐段执行，不要求先租下 9 个会话。
- 转场需要两个场景同时活跃时，按重叠的工作集准入，或选择已验证的中间片段方案。
- 不能先拿到一半资源，再无限等待另一半而形成死锁。

**租约**包含：所有者的实例与 worker generation、资源维度、上限、实际分配、TTL 和续期状态。

- TTL 过期只阻止新增分配并开始清理。尚未退出的浏览器或 GPU 资源仍计入 occupied / quarantined。
- 只有确认进程已退出或资源句柄已实际释放，这部分才允许重新分配。发出释放请求不等于资源已经归还。

**公平性**：预览保底、后台任务 aging、可取消的等待、空闲缓存驱逐。不允许等待中的导出永久挡住预览，也不允许预览无限占用。优先级不代表可以安全地强行抢占正在执行的推理；不支持暂停的任务在自然边界释放。

磁盘空间在昂贵的生成或导出之前检查；预算只是估计，执行中仍要监测并安全失败。

每个浏览器实例的创建、排队、失效、退出和所持租约都可追踪。失联之后，新的 Runtime 不复用未经验证的旧进程句柄，也不仅凭 PID 认领。

准入是资源机制，不能用来绕过任务预算与用户授权。

当前实现（`ResourceScheduler`，在 `packages/jobs`）：

- **需求**按四个维度声明：内存、GPU 内存、CPU 线程、staging 磁盘。各种任务的峰值估计集中在 `resource-profiles.ts`，都是保守的初始值、待校准（§14）。CPU 线程的需求按后台能用的线程数封顶，只限并发、不会被拒绝。
- **准入**：队列有空位、所有维度放得下才开始，拿到租约；放不下时排队，`JobRecord.wait` 写明在等什么（`concurrency` 或 `resources`、缺的维度、前面还有几个），随 `jobs.updated` 推送；提交时就要排队的任务，推送的第一条 `queued` 记录已经带着 `wait`。单个需求比这个优先级最多能用的量（容量减预留）还大时直接失败，错误码 `RESOURCE_ADMISSION_UNSATISFIABLE`，`details.dimensions` 列出缺的维度，不无限等。导出、模型下载与模型包检查在提交时就被拒绝（`conflict`，带同样的错误码），转写在准入时失败，固定流程的步骤在步骤准入时失败。磁盘的上限按最近一次 `statfs` 加上之后租出的量算，不因为自己占用的 staging 误判超限。
- **不插队，不半拿**：一次准入拿全部维度。等在某些维度上的工作挡住之后到来的、也要这些维度的工作；只要不碰这些维度的可以先开始。同一队列严格先后。
- **共用进程（holder）**：一个模型包的 Model Worker 被同一模型包的任务先后使用，量只计一次。任务的租约与进程各持一份；任务结束后进程还在时仍计入，进程真的退出（子进程 `close`）后才归还。没有任务在用的 holder 在有工作等它占着的维度、且没有等待者要用它时按最久未用驱逐（卸载这个模型包）。
- **租约的释放**在执行真正结束之后：任务的执行函数返回、Provider 停下（取消时 Model Worker 被杀掉并退出、导出的进程组确认不存在）才归还；Runtime 停止时等所有执行结束。异常退出或被取消的导出 worker 先杀掉整个进程组（取消时 worker 自己退出也一样，它可能留下 ffmpeg），确认组内进程都已退出（至多等 5 秒）才算结束。固定流程的步骤在步骤开始前准入、步骤结束（含失败与取消）后归还，等待原因同时写在步骤与父任务上。
- **可见性**：`jobs.resources` 返回容量（与来源）、预留、已租出、两种优先级的可用量、租约、holder 与等待队列；CLI `baocut jobs resources`；智能体 `jobs_inspect` 的摘要带 `waiting`，在等资源时提示不要重复提交、不要取消重来。
- 尚未实现：后台任务的 aging（交互的始终排在前面）、TTL 与续期（租约只在本进程内，随执行结束归还）、按冻结的 RenderGraph 估计。

### 7.8 预算准入

预算同时覆盖候选、重试和并行的 Job。调度之前在账本中原子地预留本次可验证的额度或调用次数；结算后释放余额。多个并行任务不能各自看到相同的剩余预算而超额。

没有可靠的金额上界时，只提供「批准这一次明确的调用，金额未知」或阻断，不能宣称存在硬金额上限。

**账本**。预算记在 Grant 上（§12.5），账本与 Grant 一起存在 Runtime Home 的 `store/grants.json`（0600）。两种度量：调用次数（`maxCalls`，可以不限）与金额（`budgetCap`，只有 `estimate-cap` 的 Grant 有）。金额只按模型描述里的价格（`ModelPrice`：金额、币种与计价单位）估算，不编造：只有按次、按张与按千字符这几种在提交时就能算出上界的单位能估，按分钟、按 token 计价或没有价格的模型估不出。金额是十进制字符串，账本内按百万分之一的整数计算，不用浮点数；币种不同算估不出。

**接纳**。在线与智能体 Provider 的 Job 在 `JobManager` 创建记录的同一步里经 `JobAdmission` 接纳：匹配 Grant、检查额度、预留一次调用与估算的金额，整个过程是同步的，中间没有等待，所以并行的提交不会各自看到同一份余额（测试：上限 3 次时 8 个并行提交恰好 3 个成功）。本机模型与局域网节点不经过账本。不通过时提交以错误拒绝，Job 不创建：

| 错误码 | 类别 | 含义 | 补救（`details.remedy`） |
| --- | --- | --- | --- |
| `GRANT_REQUIRED` | `forbidden` | 没有 Grant 覆盖这次外发 | 用户发放 Grant，或在会话里批准这一次 |
| `GRANT_REVOKED` | `forbidden` | 覆盖它的 Grant 已撤销、到期，或在排队期间被收紧 | 用户重新授权；不自动恢复 |
| `BUDGET_EXCEEDED` | `conflict` | 次数或金额不够这次调用（`details.measure`） | 用户调高上限，或等进行中的调用结算 |
| `BUDGET_UNVERIFIABLE` | `conflict` | Grant 有金额上限，这个模型估不出金额 | 用户逐次批准（金额未知），或改用按次计的 Grant |

`details` 另有接收方、数据种类、视频、Grant 与用量，以及可以照抄的 CLI 命令；智能体的工具结果带 `next`，要它把补救转告用户，不换 Provider 绕过。

**开始与结算**。Job 真正开始执行（数据交出）之前再核对一次 Grant 的代（§12.5），不符时 Job 以 `GRANT_REVOKED` 失败、预留释放，数据没有交出。核对通过之后，预留记为「已开始」，持久写进授权账本（§7.3）之后才交出数据。写不进磁盘时 Job 以 `INTERNAL` 失败、预留释放，数据同样没有交出。结束时结算，依据写进 Job 记录的 `grant.settled.basis`：

- `released`：还没开始就结束（排队中取消、开始前被撤销、Runtime 停止），不计；
- `reported`：完成，服务报告了费用，按报告计；
- `estimate`：完成，服务没有报告，按预留的估算计（有金额上限时）；
- `unknown`：完成，金额未知，只计次数；
- `conservative`：已经开始、却失败、取消或中断：数据可能已经交出、可能已经计费，按一次调用加预留的估算计。

Runtime 启动时把上次没有结算的预留按 `conservative` 结算（上次进程退出时它们可能已经开始）。自动重试也消耗预算：上一次尝试按 `conservative` 结算，记在 `grant.retries` 里，重试在同一条 Grant 上重新预留；额度不够时不再重试，Job 以 `BUDGET_EXCEEDED` 失败。因此「只这一次」的 Grant 不覆盖自动重试。固定流程（§7.9）的逐批翻译是进程内的调用，不建 Job，它经同样的账本逐批预留与结算；流程开始之前先检查一遍覆盖与额度。

**任务预算**。任务合同的 `budgetPolicyRef` 指向一条任务预算：这个任务里所有外发调用跨 Provider 合计的调用次数（`maxCalls`）与金额（`cap`），`null` 表示这一项不限。「任务里的调用」是智能体在任务里提交的 Job、任务里启动的固定流程，以及流程的子步骤与进程内调用（经父 Job 的提交者找到所在的任务）。界面、CLI、对外服务与节点提交的不在任务里，不受任务预算限制。

- 每次调用先通过 Grant 的接纳，再通过任务预算，两者在同一步里同步预留；任何一个不通过，Job 不创建，也不进审批。任务预算不放宽 Grant：Grant 不覆盖的照样要授权。
- 次数按已结算加预留中的调用计。
- 流程的启动不预先检查任务预算：流程在每一步外发时接纳，超出时停在那一步，流程以 `TASK_BUDGET_EXCEEDED` 失败，`details.step` 是停下的步骤；之前不外发的步骤（下载、导入）照常完成，结果留着。智能体只能启动从链接导入（§7.9），它的外发只有转写一步。
- 金额上限只接受能按上限的币种估出上界的调用。下列情形算无法保证（`TASK_BUDGET_UNVERIFIABLE`）：这次调用估不出金额或币种不同；已经有金额未知的调用，或按别的币种结算过；预留中有估不出金额或别的币种的调用。服务报告的费用按报告的币种记，币种与上限不同之后金额上限就无法保证。其余按已用加预留加这次的估算对照上限，超出是 `TASK_BUDGET_EXCEEDED`（`details.measure` 是 `calls` 或 `amount`）。
- 预留、开始与结算复用 Grant 账本的持久记录：任务预算的预留与 Grant 的预留是同一条，一起写盘，开始之前持久记下「已开始」。结算时任务预算只记一次：没开始的释放；完成且服务报告了费用的按报告计，否则按预留的估算计，估不出的只计次数并记为金额未知；已经开始却失败、取消或中断的按一次调用加估算计。崩溃之后，启动时对孤儿预留的结算同样只记一次；已经结算过的预留不再计。
- 任务预算记在 `store/grants.json` 的 `taskBudgets` 里，按任务一条，最多保留最近的 1000 条。

| 错误码 | 类别 | 含义 | 补救 |
| --- | --- | --- | --- |
| `TASK_BUDGET_EXCEEDED` | `conflict` | 任务预算的次数或金额不够这次调用 | 用户在任务合同里调高预算，或等进行中的调用结算 |
| `TASK_BUDGET_UNVERIFIABLE` | `conflict` | 任务预算有金额上限，而总额无法按同一币种保证 | 用户去掉金额上限（只留次数上限），或换用有单价的模型 |

`details` 带 `taskId` 与这条任务预算（上限与用量），以及查看合同的 CLI 命令。用户修改任务预算只改上限，用量照旧；智能体不能修改。

### 7.9 没有 Task 的 Job 与固定流程

**下载视频工具（更新）**：界面入口名称与图标为“下载视频”/ S2 Download，复用 `link-import` 固定流程。无目标时不建视频，`transcribe: true` 可直接提交文件转写 Job，发布 TXT/SRT；所选模型和转录目录在提交时冻结。`projectId` 可选，只关联转录文稿与字幕的项目归属，不改变路径。视频、TXT、SRT 都保存到 `downloads.directory` 或主机的下载文件夹；Space 保留项目关联，任务记录修剪后也不丢失。旧 `videoId` / `target` 参数保留供已有流程使用。`cookieBrowsers` 仅接受支持的浏览器名（按尝试的顺序），默认不传；解析与下载均传 `--cookies-from-browser`，不接收原始 Cookie、任意参数或配置文件。分类报错引导检测、按安装来源更新、登录或修复 Cookie 读取；勾了多个时只在读不到 Cookie 或网站仍要求登录时换下一个（见下文「从链接导入」）。下载成功后转录失败可以只重试转录，已有文件保留。


§7.2 的 `JobSpec` 描述的是 Agent 在一个 Task 里发起的计算。Job 还有三种发起方，它们没有 Task，其余规则不变：

| 发起方 | 例子 | `submitter` |
| --- | --- | --- |
| 界面或 CLI 的直接操作 | 工具页的生成语音、生成图片、文本生成；模型的安装与检查（§6.3） | `connection` |
| 对外服务 | MCP 服务的 `start_transcribe`；模型接口服务的一次请求；节点收到的远端任务 | `service` |
| 固定流程 | 转录、翻译字幕、翻译配音、从链接导入（工具页与编辑器里的同名操作都走流程） | `pipeline` |

- `taskId`、`runId`、`runGeneration` 只在发起方是 Agent 时存在：智能体经工具提交的 Job 记 `submitter: { kind: 'agent', id: <会话 ID>, taskId }`，同一会话后来的任务也能查看与取消它（§3.5），主停止一并取消它（§7.4）；其他发起方的 Job 记录 `submitter` 与发起它的连接、服务或流程。`permissionGrantRef` 对所有发起方都必须存在：直接操作由用户的这次点击与已启用的 Provider 构成授权，对外服务由访问策略与服务审批构成（§4.8）。
- **没有视频的 Job**。输入是一个文件或一段文字，输出不应用到任何视频。产物发布后进入 Space（§5.7），连同参数、seed、模型与来源组成一条**生成记录**（Job 记录的 `generation` 与 `result.outputs`）；之后「加到视频」是一次普通的素材导入（智能体用 `importAsset` 的 `artifactId`，来源仍是这条生成记录，§3.5），「以此新建视频」走 `space.openForEdit`。节点收到的远端任务是例外：结果不进产物库（§6.7）。
- **进度里的调用事实**。按片段或逐句调用模型的 Job 在进度事件里报告调用数、重试数与失败数；它们是事实计数，不是百分比的替代。

**固定流程（Pipeline）**是步骤固定、不需要模型做规划的多步工作。它是 Runtime 里的一段确定性的编排，执行主体是 `system:pipeline`，不创建 AgentSession：

- 一个流程是一个父 Job（`kind: 'pipeline'`），每一步是它的子 Job（`kind: 'pipeline-step'`，带 `parentJobId`），各有自己的冻结输入、产物与失败状态。父 Job 的 `submitter` 是发起它的连接或服务，子 Job 记 `submitter: { kind: 'pipeline', id: <父 Job> }`。父 Job 的进度按步骤报告，阶段与调用计数跟着在跑的那一步。参数在提交时校验并冻结，执行与重试都只读这一份。
- **子 Job 折叠**。`jobs.list` 默认只列父 Job，步骤折叠在父 Job 的 `pipeline.steps` 里（每一步的状态、最近一次的子 Job、执行次数与产出）；`children: true` 时一并列出子 Job。`jobs` 主题推送全部记录，由客户端决定怎样折叠。
- **记录保留**。任务账本只保留 200 条终结的顶层 Job，按结束时间从旧到新淘汰；子 Job 不计数，随父 Job 一起保留与淘汰，没有结束的 Job 与它的子 Job 不淘汰。还能重试的流程（失败、取消或中断）最新的 50 条另外保留，不占 200 条的名额；更旧的按普通 Job 淘汰，淘汰之后不能再重试。
- 步骤可以带条件（不满足时记为 `skipped`，例如可选的人声分离），一步也可以派生多个子 Job（例如逐句合成），步骤的形状因此能容纳翻译配音与从链接导入。
- 步骤之间只通过已发布的产物与视频的已提交版本传递结果；一步失败时已完成的步骤保留，流程停在这一步，可以从这一步重试。取消走 §7.4 的屏障：先不再启动新的步骤，再取消在跑的子 Job。
- **重试语义**。`pipelines.retry` 只接受失败、取消或中断的流程，沿用同一个父 Job（`attempt` 加一）与冻结的参数，先重新检查提交时的前提（文本模型的配置、ffmpeg）。从第一个产出不再有效的步骤开始：之前完成的步骤，产出的产物还在、它依据的输入没有变（源文档仍是冻结的那个版本，输入文件的长度与修改时间未变）时复用，否则从那一步重做，其后的步骤一律重做。重做的步骤换新的子 Job，旧的留在列表里。
- **中断**。Runtime 停止或崩溃时没有结束的流程记为 `interrupted`（`JOB_INTERRUPTED`，停在在跑的那一步），重启后不自动续跑，由用户重试。
- 流程写入视频时与 Agent 相同：经 Application 提交编辑事务，受版本校验与保护范围约束。流程不能做 TaskContract 才能授权的事，例如自动覆盖用户的手工修改。
- **入口决定执行者**。同一件事（翻译、润色、分章、写作）有两种执行者：智能体，或由流程调用文本模型（`generateText`）。两者的产物与写入方式相同。会话里提出的由智能体完成：智能体本身就是文本模型，自己翻译、润色，不经 `generateText`，文本模型没有配置也不影响；会话不属于项目时，它做出的文件（例如译好的字幕）用 `downloads_save` 放进下载目录交给用户。工具入口（Rail 的工具页、CLI）只走流程，不启动智能体。编辑器里的工具入口缺省把这组参数作为一条消息发给这部视频的会话，由智能体完成；用户显式改选「直接调模型」时走流程（产品设计 §5.10）。执行者在发起时确定，之后不换：流程在文本模型没有配置时返回 `CAPABILITY_NOT_CONFIGURED`，不改交智能体，失败时也不自动改交；没有可用的智能体时，编辑器入口说明原因，不静默改走流程。


**工具（Tool）**是固定流程与直接任务在产品上的目录（产品设计 §2.7）。工具不是另一套执行机制：每个工具对应一个固定流程或一种直接提交的 Job，目录只声明它接受什么输入、产出什么。

- **目录**。每个工具声明：稳定的 ID、组（`speech` 语音与字幕、`text-image` 文字与图片、`video-file` 视频文件；产品设计 §2.7）、输入的种类（`file`、`link`、`text`、`video`、`document`）、结果的种类（`video` 或 `artifact`）、执行方式（流程名，或直接任务的方法与能力）、一定要的与只在某些输入下才用的能力和外部工具、要不要联网下载。声明是一份静态注册表（`@baocut/jobs` 的 `TOOL_CATALOGUE`），`tools.list` 再加上此刻的可用性：能力按提交时的同一套选择判断，外部工具用上次探测的结果，严格离线（`offline.strict`）看要不要联网；原因沿用已有的错误码。一定要的依赖不满足时不可用，只在某些输入下才用的记为限制、照样可用。界面读这份目录；CLI 不另设列出它的命令，固定流程在 CLI 上是从工具目录（§3.5）派生的一级动词。
- **目标的三种写法**。视频工具的流程参数用同一个 `target`：`{ videoId }`（已打开的视频）、`{ entryId }`（Space 里的视频条目，不要求已打开）、`{ create: { projectId | conversationId, name?, media } }`（新建视频：在项目里，或在会话的来源目录里，两者给一个；`media` 是本机媒体文件的绝对路径，或上一步下载的产物）。顶层的 `videoId` 等同 `{ videoId }`，两者都给时要指同一个视频。`entryId` 在提交时解析成 `videoId`，记成流程的第一步 `target`（解析目标）；`create` 由接受它的流程在自己的步骤里新建（从链接导入在发布之后，`media` 是它下载的，不收参数里的；转录必须给 `media`，提交时确认文件在）；之后的步骤只认 `videoId`。每个流程声明接受哪些写法：翻译与配音不新建，`create` 以 `PIPELINE_TARGET_UNSUPPORTED` 拒绝。
- **代开视频**。目标没有打开时，流程以 Runtime 的租约打开它（与重启恢复用的是同一条路径，§7.5），整个流程期间持有，结束、取消或失败后放下。别的连接正开着时直接用那一份，版本校验照常；被别的进程锁住时 `pipelines.start` 以 `VIDEO_LOCKED` 拒绝，不建任务，也不建任何东西。回收站里的视频（`SPACE_ENTRY_TRASHED`）与不是视频的条目（`SPACE_ENTRY_NOT_VIDEO`）同样在提交时拒绝。租约只在内存里：Runtime 崩溃或停止后流程是 `interrupted`，不会有视频一直开着；重试先按记下的位置重新打开（位置上已经不是原来的视频时 `STALE_JOB_INPUT`），再从停下的那一步继续。
- **新建视频是流程的一步**。`create` 在项目目录里新建视频（与 `videos.create` 同一条路径，名字默认取媒体的标题；给的是会话时与智能体的 `videos_create` 放在同一处：会话属于项目时在项目里，否则先把会话绑定到新项目（§3.10）再在项目里建；只下载不建视频的目标同样先绑定，运行时按会话当时绑定的项目解析）、以链接方式导入 `media`、放上时间线（第一条同类轨道，从 0 开始、覆盖整段媒体，与导入在同一笔事务里），这一步完成后视频就在 Space 里，流程持有它的租约。之后的步骤失败时视频保留，重试从失败的那一步开始；新建这一步完成过就不再执行，即使之前的步骤要重做。新建与导入在崩溃之后也不重复：先在项目（或会话的来源目录）里占下一个目录并记进流程的 staging，重试认回这个目录（里面已有视频就打开它，没有就在这里新建），导入用固定的 `commandId`、按回执认回已经应用的那次。
- **候选输入**。输入选择器要的事实来自内容索引（§5.11）与 Space 目录（§5.7），不打开视频：每个视频的文稿（语言、是否有逐词时间、是否在时间线上）、译文（目标语言、译自哪份文稿、单元数与过期的单元数）、配音组（语言、用的译文与文稿）。`tools.candidates` 按工具的规则返回可选的视频条目：转录与从链接导入是回收站之外的全部视频；翻译与配音只列有文稿的视频，带每份文稿与已有的译文、配音。范围规则与 `space.list` 相同。还没有索引的视频照样列出并标明（不能断定它没有文稿），结果与 `space.search` 一样说明是否完整。
- **结果的来源**。工具写进视频的文档与实例、发布的产物，Provenance 都记这次运行的父 Job 与工具 ID；新建的视频条目的来源是这次运行；Space 的产物索引留着新建一步完成了的流程记录，Job Ledger 淘汰这次运行之后来源照样在。Space 据此显示来源，也据此给出「下一步」能接的工具。
- **保存位置**。没有视频的结果（文件到文件的流程、无目标的转录与下载、直接任务的生成物）都落在一个目录里：流程参数 `outDir` 给了用它，没给时用设置 `downloads.directory`，它为 `null` 时是运行主机的下载文件夹（桌面应用启动的 Runtime 用系统给出的下载文件夹，别的方式启动的用 `~/Downloads`）；`tools.list` 把解析好的目录作为 `saveDirectory` 返回给桌面界面（浏览器不给）。直接任务（`synthesizeSpeech`、`generateImage`、`generateText`）只在给了 `saveDir` 时才另存副本：工具页总是传它（界面上的保存位置），智能体与别的调用方不传就只进产物库、不写文件。目录在提交时确定并冻结，不存在时创建，不能写入是 `OUTPUT_DESTINATION_UNAVAILABLE`（从链接导入沿用 `LINK_DESTINATION_UNAVAILABLE`）。文件名可读（取标题、源文件名或提示词的开头，清理规则与下载的文件相同），不覆盖已有的文件，重名时加序号。流程直接把结果文件写在那里，这个文件就是产物（挪走或删掉后条目是 `missing`）；直接任务的 bytes 权威仍是产物库，发布之后在 `saveDir` 写一份可读名字的副本，路径记在 `result.outputs[].path`（文本生成给了 `saveDir` 时结果里也有 `outputs`），「在文件夹中显示」用它；副本写不成只记 `save-copy-failed` 警告、任务不失败，副本不在时界面说明不在了、条目不算缺失。Space 目录按 `result.outputs[].path` 为保存位置里的结果给出位置（`entryPath`）。
- **Space 条目作输入**。收 `file` 的参数（转录的 `file`、转码的 `inputs`、翻译字幕文件的 `input`、生成语音与文本生成的材料）都接受 `{ entryId }` 代替绝对路径：提交时由 Space 目录解析成那个条目的文件（来源目录里的文件、发布的产物、保存位置里的结果），回收站里的 `SPACE_ENTRY_TRASHED`，没有文件的（占位、缺失、可编辑视频）`SPACE_ENTRY_NO_FILE`，种类不对的 `SPACE_ENTRY_UNSUPPORTED`；解析出的路径冻结进参数，之后与给了路径一样。候选条目的列表就是 `space.list` 按种类筛的结果，不另设方法。
- **不覆盖**。译文、字幕层与配音组只新增：目标视频已有同类结果时照样新增一份并在结果里说明；选用哪一份是编辑器里的决定。新增的原文字幕层不和已经显示着的同一素材的原文字幕叠在画面上：它以停用放上去，由用户在编辑器里换用。文稿不同：已有文稿的视频再转录，结果进一部新建的视频，或换用文稿取代当前的（下文「转录」，§6.6），一部视频里不并存两份。
- **当场授权**。在场的用户（主网关上的桌面界面连接）启动流程或直接提交任务时，缺授权、授权已撤销、额度不够或估不出金额的拒绝（`GRANT_REQUIRED`、`GRANT_REVOKED`、`BUDGET_EXCEEDED`、`BUDGET_UNVERIFIABLE`）另带待批准的项（`details.pendingGrants`，§12.5 的 `GrantRequestItem`：能力、收件方、数据种类、视频、原因、费用与估算），一次覆盖流程的全部几种外发（例如配音的翻译与合成），`remedy` 的命令照旧。用户确认后客户端经 `grants.create` 逐项发放，再用同一个 `commandId` 重新提交：拒绝发生在创建任务之前，重新提交就是第一次提交。Runtime 不自动发放、不放宽任何授权；任务预算不够时不给待批准项（批准外发放宽不了任务预算）。CLI、智能体与浏览器会话照旧只有拒绝与要执行的命令；对外服务沿用服务审批（§4.8）。
- **入口**。桌面界面、CLI 与编辑器里的同名操作走同一个流程。Web 服务能读目录与候选输入，执行方法不在白名单的工具标为不可用；Web 的 `tools.list` 不给保存位置，工具页没有保存位置一行、直接任务不带 `saveDir`（只进产物库、不写副本）；保存位置不在已登记的项目目录之内时，结果只落在保存位置的流程工具标为不可用（`PATH_OUTSIDE_PROJECT`），结果也能写进视频的标为受限（只能写进视频），直接任务不受影响。MCP 服务不提供目录，只有它已有的子集。结果页与任务详情的「交给 Agent」用 `space.continueInConversation` 把结果条目的引用放进会话（§5.7），输入框里的草稿由界面预填、由用户发送，不加新方法。

工具与流程的对应：

| 工具 | 输入 | 结果 | 执行 |
| --- | --- | --- | --- |
| 转录 | `file`、`video` | `artifact`（缺省）、`video` | `transcribe` 流程。只给 `file`（本机媒体或 Space 里的媒体条目）、不给 `target`：转写 → 在保存位置发布 TXT 与 SRT，结果是文档与字幕两个产物（与从链接导入的 `transcribe` 同一形状，`downloadTranscript`）；给 `target`：解析目标（按需新建视频）→ 转写 → 建立字幕层；链接先走从链接导入 |
| 翻译字幕 | `video`（有文稿）、`file`（SRT、VTT：本机文件或 Space 里的字幕条目） | `video`、`artifact` | `translate` 流程；视频目标在写入译文之后建立目标语言的字幕层。字幕文件走 `translate-subtitles` 流程（目录按输入种类声明另一种执行，`executionByInput`） |
| 翻译配音 | `video`（有文稿） | `video` | `dub` 流程 |
| 下载视频 | `link` | `artifact` | `link-import` 流程，可选生成 TXT / SRT |
| 提取音频 | `file` | `artifact` | `transcode` 流程（`action: 'extract-audio'`） |
| 压缩、合并视频 | `file` | `artifact` | `transcode` 流程 |
| 生成语音、文本生成 | `text`、`document`（Space 里的文档或字幕：生成语音取它的文字，文本生成作为材料附在提示后面） | `artifact` | 没有视频的 Job（`models.synthesizeSpeech`、`models.generateText`），结果发布到保存位置 |
| 生成图片 | `text` | `artifact` | 没有视频的 Job（`models.generateImage`），结果发布到保存位置 |

首批流程：

| 流程 | 步骤 |
| --- | --- |
| 转录 | 有目标：解析目标 → 可选的新建视频并导入本机媒体 → 转写（`transcribe` Job，Job 自己应用语音文档）→ 建立字幕层（同一份文稿已有字幕层时跳过）。只有文件：转写（`jobs.submitFile`）→ 发布 TXT 与 SRT 到保存位置，不建视频。流程名 `transcribe` 与它的转写步骤同名：流程是父 Job（`kind: 'pipeline'`），转写是它的一个子步骤 |
| 翻译字幕 | 冻结原文 → 在 `speech-worker` 里翻译（每次模型调用经 `text.generate`）→ 核对译文 → 应用译文文档 → 用 Worker 投影好的字幕条建立目标语言的字幕层 |
| 翻译字幕文件 | 读取并严格解析 → 逐批翻译（`generateText`）→ 写出再读回、核对条数与时间码 → 发布；文件到文件，不碰视频（`translate-subtitles`） |
| 翻译配音 | 缺译文时翻译（同「翻译字幕」，在 `speech-worker` 里）→ 核对译文 → 可选的人声与背景分离（`separateAudio`）→ 逐句合成（`synthesizeSpeech`）→ 时间对齐 → 在一笔事务里作为新的一组配音应用 |
| 从链接导入 | 解析目标 → 解析链接 → 下载媒体与可选的字幕 → 校验可解码 → 放进下载目录 → 可选的新建视频 → 可选的导入（新建的或已有的视频）→ 可选的转写与字幕层 |
| 文件转码 | 压缩、合并视频文件或提取音频，文件到文件，不建视频 |
| 识别说话人 | 冻结文稿与版本 → 在只装「说话人区分」模型包的 Model Worker 里按声纹区分（`diarize`）→ 整理成提案（复用已有的说话人、试算句数与译文重切）；不改视频，确认后由 `edits.applySpeakers` 一笔可撤销的编辑应用（`speakers`，§6.6） |

**字幕与翻译的核心**来自 BaoCut v2，不在 v3 里另写一套：分句、源字幕断行、翻译的分页与校验、译文的展示切分与对齐、译文字幕的时间投影、字幕导出与质量检查，都由 `speech-doc` crate 实现（原样移植自 v2 的 `bcut-flow-core`，连同它的测试集；设计依据在 [docs/design/subtitle](../design/subtitle/)）。规则只有这一份，各端不各写各的：

- **确定性的部分**（派生句子与字幕、时间投影、导出、检查）是纯函数。VideoEngine 直接链接 `speech-doc`；Node 与界面经 WASM（`bindings/editor-wasm`，TS 一侧是 `@baocut/editor-wasm`）用同一份实现。原文字幕的断行还是 Node 里手工移植的（`caption-cues.ts`、界面的 `speech-cues.ts`），改用 crate 之后删除：两份的参数除了没有最短显示时长，与 crate 的 `CueParams::default()` 相同，但另有 crate 的 `derive_cues` 没有的断行（一条不超过 7 秒，按存下的句子或超过 1 秒的停顿断开，没有词时间的整段拆成带 `~n` 的几块），换成 crate 会改变字幕条与它们的 ID，所以与原文字幕层改用 crate 一起换。
- **要调用模型的部分**（润色与分段、翻译、对齐、定向修复）由单独的 Worker 进程 `speech-worker` 执行，做法与 Render Worker 相同：流程的一步启动一个进程，结束即退出。位置：环境变量 `BAOCUT_SPEECH_WORKER`；不设时用 `engine-host` 旁边的 `speech-worker`；再找不到时在 cargo 产物目录里找（`npm run build:engine` 一并构建）。协议是 stdio 上的 JSON 行 `speech-worker/1`（命令协议规范 §4.5）：`hello` 之后一个 `translate` 请求，带冻结的输入与这一步的 staging；Worker 推 `llm.request`、`progress`、`checkpoint`、`resumed` 事件，以 `translate` 的结果或错误结束；stdin 关闭等同取消，收尾之后进程退出。Worker 只读冻结的输入、只写 staging，不写视频目录。crate 自己驱动多轮调用与降级（整页两次、对半拆页、单元补做），这套重试语义原样保留。现在有的是翻译：简报（文档放得进一页时跳过）、分页翻译、质量门与补做、对齐、收尾轮，再把目标语言的字幕条投影回转写的时钟。
- **模型调用的路径**。Worker 不联网、不持有凭据，它的环境里也没有：一次调用是一个 `llm.request`（`kind`、`attempt`、`system`、`user`、`temperature`、`maxOutputTokens`；提示词与文件契约的信封归 Worker，§13.6）。Runtime 经流程的 `text.generate` 执行它——能力与 Provider 的选择、授权与预算的预留和结算、调用记录、停止屏障都在这条路上——按冻结的模型去掉不接受的温度、把输出上限夹到模型的上限，再以 `llm.reply` 交回文本或分类过的失败：输出不合约定或被截断是 `malformed`（核心重发），取消是 `cancelled`，其余（缺授权、超预算、任务已停止、Provider 拒绝，以及 HTTP 层有界重试之后仍不可用，§6.4）是 `terminal`。终止性的失败之后核心不再发起调用，立即收尾，这一步以 Runtime 一侧原样的错误对象失败（`pendingGrants` 等细节不丢）。一个 `llm.request` 记一次调用，`attempt` 大于 0 的另记一次重试，以失败交回的记一次失败。
- **断点**。检查点由 Worker 写在这一步的 staging 里（`checkpoint.json`，crate 的 `PipelineStatus` 外壳）：键是原文的词、目标语言、风格提示与术语的指纹，任何一个变了整份作废；内容是目标语言的译文与对齐几张表和定下的简报，以句子 ID 为单位；每完成一页、主对齐之后、收尾轮之后各原子地写一次。失败、取消或中断之后重试，表放回文档再调引擎：已经译好、原文没变的句子不再发送，简报不重做，主对齐之后中断的从收尾轮继续（指纹判断是 crate 自带的）。取消时 Runtime 发 `cancel`、中止在途的调用，Worker 停在下一次调用或退避之前；随后关 stdin，宽限期之后强杀。staging 按流程的规则在完成与取消时删除，失败与中断时保留。
- **接线的状态**。`translate` 流程（连同配音缺译文时的翻译）的翻译一步经 `@baocut/jobs` 的 `runSpeechTranslate` 在 Worker 里执行；`captions` 一步用 Worker 投影回转写时钟的字幕条（条的 ID 是 `q-<单元 ID>`，刻度与转写相同），写入只经 VideoEngine。翻译字幕文件（`translate-subtitles`）与原文的字幕层还没有改用 crate。
- **句子与原文指纹**。只有 crate 的一套（视频格式规范 §5.3）：`speech-doc-bridge` 的 `source_sentences` 从转写正文的词派生句子（停顿不少于 1.8 秒、分号不断句，正文里存下的 `sentences` 不参与），指纹是 `<词数>:<首词 ID>:<末词 ID>:<FNV-1a>`。Worker 直接链接它；翻译流程冻结原文与核对源变没变、配音判过期、内容索引数过期的单元（Node）与界面的逐句对照（浏览器）经 `bindings/editor-wasm` 调同一份。WASM 的边界是 `baocut.speech/1` 正文的 JSON，句子的起止是正文 `timescale` 下的整数刻度，不经浮点秒。WASM 没有构建时，翻译与配音流程用到句子的那一步以 `EDITOR_WASM_UNAVAILABLE` 失败（先 `npm run build:wasm`），内容索引只按单元自己的状态数过期，界面把原文当作读不出。
- **数据模型**。crate 内部用 v2 的 `TranscriptDoc`。它与 v3 的 `speech`、`translation` 文档之间是一个无损的双向映射（`speech-doc-bridge`，纯函数；`speech-doc` 本身不依赖 v3 的 crate），在 Worker 与 VideoEngine 的边界上转换：读出时连同素材的事实换成 `TranscriptDoc`，写回时以读出的正文为底稿，`TranscriptDoc` 装不下的字段按 ID 从底稿带回。v3 的文档格式补上了映射要的字段（视频格式规范 §5.2、§5.3），秒与刻度的互换按视频格式规范 §2.10。

**翻译配音**（`dub`）把视频里的一份 `speech` 文档配成另一种语言。一组配音是一条新的配音轨、轨上逐句的配音实例与一份配音计划（`dubbing-plan` 文档，视频格式规范 §7.2），在一笔编辑事务里应用。流程自己调用模型，不启动智能体：

- **参数**。`videoId`（已打开），或 `target`（`{ videoId }`、`{ entryId }`，见上文「工具」）；`targetLanguage` 与 `translationId` 至少给一个。给了已有的译文时，语言取译文的，再给就要一致；这时翻译用的 `textProvider`、`textModel`、`style`、`glossary`、`glossaries`、`batchSize` 不适用，给了以 `invalid-request` 拒绝。可选的 `documentId`：不给时取唯一的 `speech` 文档，给了译文时取译文的来源。合成用 `voice`（预置音色、账号里的音色 ID 或 `library:<id>`；只用于视频里没有绑定音色的说话人，见「逐句合成」）、`provider`、`model`。原声 `originalAudio`：`duck`（默认，压低 `duckDb` dB，1–60，默认 18）、`mute` 或 `keep`。另有可选的 `separateBackground`。
- **提交时**。选定语音合成的 Provider 与模型，按模型检查音色、语言与格式。格式优先 WAV，因为对齐按采样数计算。`library:<id>` 没有这个 Provider 上的有效克隆时 `VOICE_CLONE_REQUIRED`，不改用别的声音。给的译文不是 `baocut.translation/2`、译自别的文稿或语言不符时拒绝。外发要有覆盖的 Grant，否则以 `forbidden` 拒绝，不建任务（在场的用户经工具页当场授权后重新提交，见上文「工具」）：合成外发译文（数据种类 `transcript`），缺译文时翻译另外外发原文（同样是 `transcript`）。语音合成的 Provider 启用时的默认 Grant 不含 `transcript`（§12.5），所以第一次配音通常在这里被拒：拒绝的 `details.remedy` 说清楚下一步，`hint` 说明配音要外发文字稿、默认授权不含它、发放之后重新执行，`commands` 是要执行的那条 `baocut grants create --recipient <Provider> --data transcript --video <videoId> --purpose "<用途>"`；`baocut dub` 原样打印。视频里给这份转写的说话人绑定的音色在提交时读出、随参数冻结（指定了别的 Provider 的绑定不用）。
- **译文**。缺译文时，前四步（读取原文、翻译、组装、写入）就是 `translate` 流程的步骤（见下文「翻译」），新增一份译文文档。给了 `translationId` 时直接用它，不改它。之后逐句核对，下面几种句子是过期的，不合成，在结果与配音计划里如实列出（`DUB_UNITS_STALE`）：
  - 单元标成 `stale`（`marked-stale`）；
  - 原句已经不在文稿里（`sentence-gone`）；
  - 原句的指纹与单元的 `sourceFingerprint` 不同（`source-changed`）；
  - 译文记下的库里的术语表（`glossaryRef`，视频格式规范 §5.3）改了，改动涉及这句原文里出现的术语（`glossary-changed`）：记下的译法变了或删了，或新加的术语出现在这句里；整张表删了时，含它的术语的句子都过期。比较的是库里的当前版本；调用时直接给的术语不受库的影响；
  - 译文为空（`empty`）。

  一句都不剩时 `DUB_NOTHING_TO_DUB`。
- **分离**（可选，§6.1）。提交时按 §6.2 选定分离模型包并冻结；没有执行者时这一步 `skipped`：结果 `separation: 'not-configured'`，告警 `DUB_SEPARATION_NOT_CONFIGURED`。提交时有、执行时没了，这一步以 `CAPABILITY_NOT_CONFIGURED` 失败。编辑器的配音设置有「分离背景声」开关（本机有可用的分离模型时默认打开），与 CLI 的 `--separate-background` 一样传 `separateBackground: true`。`keep` 时原声不动，分出的两路无处可用，不分离（结果 `not-requested`）。分离成功后，`duck` 与 `mute` 都用分离出的背景声：见「应用」。没有分离而 `mute` 时，原声里的音乐与环境声一起被静音，告警 `DUB_BACKGROUND_MUTED`；没有分离而 `duck` 时，原声整条压低。
- **逐句合成**。每句一个子 Job、一个产物，同时最多 2 个调用。每次调用（含重发）都经 Grant 与预算预留、结算（§7.8、§12.5）；`library:<id>` 每次都重新换成当时有效的克隆。失败按种类处理：
  - 之后每句都会遇到的失败：授权、预算、凭据、额度、能力或音色（`GRANT_*`、`BUDGET_*`、`PROVIDER_AUTH_FAILED`、`PROVIDER_QUOTA_EXCEEDED`、`CAPABILITY_NOT_CONFIGURED`、`VOICE_*` 等；说话人绑定的音色失效除外，见下）。出现后不再发起新的调用，在途的调用照常结束；这一步以这个错误码失败，`details` 带已合成与剩下的句数。
  - 不可用、超时、限流与输出不合约定：这一句重发一次。
  - 其余单句的失败先记下，全部跑完后以 `DUB_SYNTHESIS_FAILED` 失败。

  合成好的句子按文本、语言与音色的摘要记在 staging 的清单里，重试只合成没有合成好的句子。
- **按说话人选音色**。每句的音色依次取：视频里给这句的说话人绑定的（`library-selection` 的 `speakerVoices`，只看这份转写的绑定，§5.9），参数 `voice`，模型的默认音色。绑定的音色在合成这一步（含重试）逐个换算与检查，`library:<id>` 走与参数相同的检查：本人声明（`VOICE_CONSENT_REQUIRED`）、这个 Provider 上的有效克隆（`VOICE_CLONE_REQUIRED`，`missing`、`stale`）、库里还在（`VOICE_NOT_FOUND`）。不可用的绑定不换成别的音色：这位说话人的句子不合成，逐句列进结果（错误码与原因），配音计划里这些单元是 `failed`（视频格式规范 §7.2），告警 `DUB_VOICE_UNAVAILABLE`；合成途中才失效的，这位说话人余下的句子不再调用。别的说话人照常合成；一句都合成不了时这一步以第一个原因的错误码失败。修好音色（重新克隆、补上声明）后 `pipelines.retry` 重新检查，只合成没合成的句子。原声的静音与闪避不作用在只有这种句子的实例上；`mute` 时这种句子与有配音的句子在同一个实例里，原声随之一起静音，告警 `DUB_MUTED_UNVOICED`。
- **时间对齐**（`fit-fixed-slot`，视频格式规范 §7.3）。每句的时间窗是原句在序列上的一次出现，取自引擎文字计划的投影：同一句被剪成几段、前后相连时算一次出现，隔着别的句子再出现时再配一次；整句不在时间线上的不放（`DUB_UNITS_OFF_TIMELINE`）。依次判断：
  1. 不比时间窗长：从原句的起点放，不变速。
  2. 比时间窗长：加速（ffmpeg `atempo`，保持音高），倍率向上取到千分位，最多 1.25。
  3. 加速到上限仍放不下：可以一直占用到下一句（任何一句）的起点或序列的终点。
  4. 仍放不下：不放（`overlong`，`DUB_UNITS_OVERLONG`），报告超出多少秒。

  绝不截断，也绝不压到下一句上；比较按实测的采样数。没有一句能放时 `DUB_NOTHING_PLACED`。
- **应用**。一笔事务完成下面几件事：
  - 每个音频以 `managed` 导入。Provenance 是 `origin: 'generated'`，记下流程与 `jobId`、Provider、模型、音色、语言、单元与倍率。
  - 新建音频轨「配音（<语言>）」。
  - 插入实例：`role: 'dub'`，`extensions['baocut.dub']` 记 `groupId`、语言与译文单元；素材经 `assetImportRef` 引用同一事务里的导入（命令与协议规范 §4.2）。
  - 写入配音计划。
  - 处理原句所在、带声音的实例：`duck` 加一条闪避，以配音轨为触发（经 `trackRefs` 引用新轨），以这些实例为目标；`mute` 静音它们，并在配音计划里记下这次才静音的实例（`mutedItemIds`，之前已经静音的不算）；`keep` 不动。
  - 分离过时（`duck` 或 `mute`），素材是转写来源、正在发声的那些原句实例换成分离出的两路：这些实例静音并记进 `mutedItemIds`；新建「背景声（<语言>）」轨，在每个实例的位置放一段背景声，源区间、时间映射与音量照原实例，不压低，所以配音之间与配音期间的音乐、环境声都和原来一样响。`duck` 再新建「人声（<语言>）」轨，同样放人声，闪避的目标是这条轨（经 `trackRefs`）而不是原实例：只有原来的人声被压低。不直接压低原实例再叠背景，因为闪避只在配音发声时生效，句间背景会叠成两份；视频实例的内嵌声音也不能换成别的素材，所以人声单独成轨。背景与人声实例的 `extensions['baocut.dub']` 是 `{ groupId, stem }`，导出的「只要原声」、撤销与编辑器里切回原声都按配音计划的 `mutedItemIds` 与这个标记处理。素材不是转写来源的原句实例（例如另放的录音）照无分离时处理。

  版本冲突时重读、重试，最多 3 次。对齐之后视频改过时以 `STALE_JOB_INPUT` 结束，重试按当前的时间线重新对齐，合成照样复用。
- **一组配音**。`groupId` 是 `dub_<父 Job 的 ID 去掉 job_>`。每次执行都新增一组，不替换已有的配音轨与给定的配音，也不把给定的配音换成语音合成。导出按 `groupId` 选「只要某一组配音」（§9.13）。
- **结果**。`summary` 带以下内容：
  - 语言与用的译文（新建的或已有的）；
  - 配音计划、配音轨与 `groupId`；
  - 句数：总数、放上、过期、不在时间线、变速、占用静音、放不下、音色不可用；
  - 过期、放不下与音色不可用的单元；
  - 各说话人用的音色、来源（`video`、`params`、`default`）、是否可用与句数；
  - 合成的调用、重发、失败与复用次数；
  - 缺译文时翻译用到的术语表；
  - 原声的处理与分离的状态。
- **入口**。`pipelines.start`（`pipeline: 'dub'`）与 CLI `baocut dub`。智能体与 MCP 服务经一级动词 `dub` 一步提交整条流程（Agent 面设计 §4.2、§11）；会话里零散的配音由智能体用 `speak` 与编辑事务完成（「入口决定执行者」，§14）。Web 服务不提供。

**从链接导入**（`link-import`）的下载由受管外部工具 yt-dlp 执行（§12.9），在视频事务之外完成（§5.2）：

- **参数**。`url`；下载目标是项目、会话或视频之一（`projectId`、`conversationId`、`videoId` 或 `target`，都可以不给；`target.create` 在它的项目或会话的来源目录里新建可编辑视频，下载仍使用指定目录；同时给的顶层 `projectId`、`conversationId` 要与它一致）；可选的 `audioOnly`、`subtitleLanguages`、`transcribe`（无视频目标时生成独立文稿与字幕）；转写的 `language`、`provider`、`model`、`hint` 只与 `transcribe` 一起给，`diarize` 与 `captions`（默认 false，转写之后建字幕层）还要有视频目标，含义与 `transcribe` 流程的同名参数相同：Provider 与模型在提交时选定并冻结，转进视频时套用视频里启用的转写术语表（对外服务启动的不套）。下载目录在提交时确定并冻结：设置 `downloads.directory` 给了时一律用它；否则是运行主机的下载文件夹：桌面应用启动的 Runtime 用系统给出的下载文件夹（认得 Windows 移动过的已知文件夹与 Linux 的 XDG 目录），别的方式启动的 Runtime 用主目录下的 `~/Downloads`。项目默认只决定归属，不影响保存目录；`saveTo: 'project'`（默认 `downloads`）时保存到归属项目（`projectId`、`videoId` 所在的或 `target.create` 的项目）里的 `downloads/`，归属是不属于项目的会话时仍是下载目录。界面与 CLI 不给 `saveTo`；智能体的 `download` 只在只给 `project`（只下载到项目）时给它，对外服务的 `download` 有落点就给（对外服务只能写进项目，§12.8）。不存在的项目或会话以 `not-found` 拒绝。
- **前提**。启动时与每一步之前都确认 yt-dlp 已安装、版本够新、用户的同意有效，撤回之后重试也被拒绝（`TOOL_*`）；严格离线时拒绝（`OFFLINE_STRICT`）；`transcribe` 而转写没有配置时拒绝（`CAPABILITY_NOT_CONFIGURED`）。提交时的拒绝不创建任务。
- **链接检查**。只接受 `http(s)://`；以 `-` 开头、带用户名或密码、没有主机名的以 `LINK_UNSUPPORTED` 拒绝。主机是本机、链路本地或内网地址的以 `LINK_PRIVATE_ADDRESS` 拒绝：字面的 IPv4 与 IPv6（含 IPv4 映射与 NAT64 的写法、整数写法）、`localhost`、`.local` 等本地后缀、没有点的单段主机名。提交时再把主机名解析一遍，任何一个地址落在这些范围里同样拒绝，解析不了是 `LINK_NETWORK_ERROR`。**这些检查管不到的**：提交时的解析与 yt-dlp 自己的解析之间的 DNS 变化；yt-dlp 跟随的重定向；提取器另外请求的接口与 CDN 地址。这些请求由 yt-dlp 直接发出，Runtime 不经手，所以链接检查防的是输错与明显的滥用，不是网络隔离（§14）。
- **脱敏**。存储、日志、任务记录、事件、错误详情与 Provenance 里只出现规范化之后的链接：主机名小写，去掉用户信息与片段，查询参数只留下标识内容的 `v`、`list`、`index`、`t`、`start`、`p`、`page`、`id`、`bvid`、`aid`（按名字排序），其余（跟踪参数、签名、令牌）一律去掉，路径原样保留；yt-dlp 报告的页面地址与错误输出里的链接同样处理。规范化改变了链接时，原始链接只存在 Runtime Home 的 `store/link-sources.json`（0600），冻结的参数按 `sha256:<摘要>` 引用它，交给 yt-dlp 的是原始链接。流程完成时删掉这一条；Runtime 启动时清掉不再被未完成、还能重试的流程引用的条目，之后重试以 `LINK_SOURCE_EXPIRED` 失败。
- **执行**。参数以数组交给进程，不经 shell，链接在 `--` 之后、是最后一个参数；总是带 `--ignore-config`、`--no-plugin-dirs` 与 `--no-playlist`，播放列表与直播以 `LINK_UNSUPPORTED` 拒绝。输出模板固定为 staging 里的 `dl/media.%(ext)s`，标题不进路径。默认要 MP4：画面与声音优先挑 MP4 与 M4A 的流、合并成 MP4（`-f bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b`），只要声音时优先 M4A（`ba[ext=m4a]/ba/b`），浏览器与 Electron 直接播放、不用先准备兼容副本；网站没有时退回最好的任意格式，合并的容器依次试 MP4、WebM、MKV（`--merge-output-format mp4/webm/mkv`，取第一个装得下这些编码的）。进度是 yt-dlp 按 BaoCut 给的模板报告的已下载与总字节（`progress.unit: 'bytes'`），几路流累计，总数未知时不报百分比。yt-dlp 在自己的进程组里运行，取消时整组先 SIGTERM、宽限之后 SIGKILL，等它退出。
- **发布**。只发布认得的媒体与字幕扩展名。文件名取自标题：去掉路径分隔、控制与保留字符，不以点或 `-` 开头，最长 120 个字符，空的用 `download`；不覆盖已有的文件，重名时加序号；按真实路径确认落在下载目录里。下载目录不存在时创建，不能写入是 `LINK_DESTINATION_UNAVAILABLE`。结果是没有视频的生成记录（`result.outputs`），`summary` 带脱敏的链接、标题、平台、作者、时长、文件、工具与版本、用上的浏览器 Cookie（`cookieBrowser`，匿名时 null）、下载时间、导入的视频与素材、转写任务。
- **导入与转写**。给了 `target` 时作为链接素材导入，文件留在保存目录里（默认下载目录，`saveTo: 'project'` 时项目的 `downloads/`）。`target` 与视频工具相同（见上文「工具」）：`{ videoId }`、`{ entryId }` 或 `{ create: { projectId | conversationId, name? } }`；`create` 新建一个视频并把下载的媒体放上时间线，名字默认取页面标题。下载视频界面不提供视频目标或新建视频。智能体与对外服务的 `download` 把落点写成三选一（Agent 面设计 §4.2）：`video`（导入已有视频，流程的 `videoId`；它的时间线还空着（根序列上没有片段）时同一笔事务把素材放上主轨，与新建的视频一样，已经有片段时只导入素材）、`newVideo`（新建，流程的 `target.create`，可给 `project`、`name`）、`project`（只下载到项目）。智能体导入视频（`video`、`newVideo`）的下载与界面、CLI 一样留在下载目录，视频里的素材链到那里；只给 `project` 时给 `saveTo: 'project'`，文件进那个项目的 `downloads/`。对外服务的落点一律给 `saveTo: 'project'`，文件进归属项目的 `downloads/`。智能体的目标限在会话的来源目录里；`newVideo` 与 `videos_create` 建在同一处：会话属于项目时在那个项目里（`projectId` 默认是它，别的项目回答 `PROJECT_NOT_FOUND`、不生成审批），否则在会话的工作目录里（流程参数是 `create: { conversationId }`），之后 `videos_list`、`videos_inspect` 看得到；不属于项目的会话的文件仍在下载目录。智能体不给落点时也可以 `transcribe`，生成独立的文稿与字幕；只下载之后要放进视频，用结果里媒体的 `artifactId` 经 `edits_apply` 的 `importAsset` 导入（§3.5）。Provenance 记 `origin: 'link-import'` 与 `source`：脱敏的链接与页面地址、平台、媒体 ID、标题、作者、发布日期、时长、页面简介（`description`，最多 20000 个字符）与平台给的章节（`chapters`，清洗过的 `[{ start, end?, title }]`，最多 400 条；这两项没有时省略）、工具的名字、版本与来源、下载时间、流程的 `jobId`（视频格式规范 §4.5）。`summary` 另带截到 1200 个字符的 `description` 与章节条数 `sourceChapters`。字幕只作为文件放在媒体旁边，不导入视频。没有给 `target` 时下载并可选直接转录文件，结果是 Space 里的视频文件、文稿与字幕。给了目标时，`transcribe` 在导入之后提交转写并等它结束，摘要的 `documentId` 是写入的 speech 文档；`captions` 为 true 时最后一步 `captions` 按它建字幕层（与 `transcribe` 流程同一步，摘要的 `captions` 同形）。
- **采用来源章节**。平台的章节与简介里的时间戳大纲是作者写的，`videos_inspect` 在素材的 `source` 里列出（简介截到 1200 个字符，章节未吸附），智能体用 `chapters_adopt`（§3.5）把它们变成视频的章节。解析与吸附在字幕与翻译核心（`bc_source_chapters`，与旧版本同一套规则），时间都是素材的源时间：
  - 来源章节：显式大纲（`outline`）优先；否则先取结构化 `chapters[]`（认 `start_time | start`、`end_time | end`、`title`），没有时从简介解析时间戳大纲（至少两行）。
  - 吸附：作者的时间戳只精确到秒、常比话题真正开始早几秒，所以每一条 t 吸到转写最近的结构起点，层级是段落 > 句 > cue > 词。先在近窗 `[t-1, t+2]` 秒（含两端）里依次找段落、句子、cue 的起点，第一个有候选的层定结果：只有一个是 `matched`，有几个是 `ambiguous`（取离 t 最近的，同样近取 t 之后的；最多留 4 个候选）；都没有时放宽到 `[t-4, t+6]` 秒，只认段落与句子起点、取最近的（`snapped`）；再没有时找近窗里的词起点（同样是 `matched` 或 `ambiguous`）；都没有就保留原时间（`unanchored`）。没有转写或不吸附时全部 `unanchored`。
  - 清洗：丢空标题、按起点排序、同一起点只留一条、首章钳到 0、丢掉非严格递增的；终点是下一章的起点，末章到素材时长。
  - 投影（Runtime）：源时间经这个素材在根序列上的启用片段（只认线性时间映射）换成时间线秒，同一段素材放了几次取时间线上最早的；落在剪掉部分的章节标 `offTimeline`、记 `unanchored`，落到源时间上之后最近的片段起点（之后没有时落到之前最近的那个）；对齐到帧，首章钳到 0，与前一章落在同一帧的丢掉（回执的 `dropped`）。
  - 编译成一个 `setChapters`（标题与时间，不写摘要），整个替换现有章节，一笔可撤销的修改；`dryRun` 只返回计划。来源没有章节时 `NO_SOURCE_CHAPTERS`，素材不在时间线上时 `ASSET_NOT_PLACED`（命令与协议规范 §4.2）。
- **失败与重试**。失败的原因是一个封闭的集合，每一种带 `remedy`：`LINK_UNSUPPORTED`、`LINK_LOGIN_REQUIRED`、`LINK_COOKIES_UNAVAILABLE`、`LINK_TOOL_UPDATE_REQUIRED`、`LINK_UNAVAILABLE`（已删除、地区限制）、`LINK_NETWORK_ERROR`、`LINK_DISK_FULL`、`LINK_DOWNLOAD_FAILED`、`LINK_DOWNLOAD_UNREADABLE`、`LINK_DESTINATION_UNAVAILABLE`、`LINK_SOURCE_EXPIRED`，以及工具的 `TOOL_*`（命令与协议规范 §11.3）。取消时 staging 随之删除；失败与中断时保留，`pipelines.retry` 让 yt-dlp 接着 `.part` 续传。
- 下载工具不随应用分发：首次使用时说明工具的名字、来源、版本、大小与许可，用户同意后才下载（§12.9）。Cookie 默认关闭；用户为本次下载勾选一个或多个浏览器（`cookieBrowsers`，按尝试的顺序），即允许 yt-dlp 在本机读取这些浏览器的 Cookie 并用于访问目标网站。界面只列出本机检测到的浏览器（`externalTools.cookieBrowsers`）：按 yt-dlp 的查找规则看各浏览器的 Cookie 库在不在（Chromium 系是数据目录下 `[<Profile>/][Network/]Cookies`，Firefox 是 `cookies.sqlite`，Safari 是固定位置的 `Cookies.binarycookies`，没有权限看时照样列出、时间未知）与修改时间，最近改过的在前；只 `stat`，不打开、不读内容，不运行下载工具。解析链接时按顺序逐个用：读不到这个浏览器的 Cookie（`LINK_COOKIES_UNAVAILABLE`）或网站仍要求登录（`LINK_LOGIN_REQUIRED`）时换下一个，别的失败直接失败；都没成功时有一个是要求登录就报 `LINK_LOGIN_REQUIRED`、否则 `LINK_COOKIES_UNAVAILABLE`，`details.attempts` 是每个浏览器的结果。用上的那个记在解析步骤的结果里，下载沿用它；下载失败不再换浏览器，重试从下载继续、仍用它。最后不加一次不带 Cookie 的尝试：勾了浏览器就是要用登录信息。只保存浏览器名，不保存 Cookie 内容，不读未勾选的浏览器。之前只给一个 `cookieBrowser` 的写法与冻结参数照样接受，等同只有它的列表。下载不代表取得使用许可，界面按产品设计 §5.9 提示。

**文件转码**不经过视频的渲染管线：输入与输出都是媒体文件，由 `media-core` 或受管的 ffmpeg 执行，执行器在结果里报告；流复制只在片段的编码参数确实一致时使用，否则重新编码并说明。

- 步骤：读取输入（ffprobe）→ 编码 → 校验输出（时长、视频轨，重新编码时还有编码与高度）→ 发布。执行器是 PATH 里的 ffmpeg（`BAOCUT_FFMPEG` / `BAOCUT_FFPROBE` 可以指定），结果报告它的版本与实际命令的参数摘要（路径只留文件名；输出写的是发布后的最终文件名，含重名时加的序号，不是 staging 里的临时名字）。
- **流复制的判定**。只有合并才可能流复制：每个片段都有视频，视频编码、分辨率、帧率、像素格式一致，都有或都没有音频且音频编码、采样率、声道一致，并且编码能直接放进 MP4（视频 H.264、HEVC；音频 AAC、MP3、ALAC）。任何一项不符就重新编码，`reason` 列出哪些参数不一致：画面按第一个片段的尺寸缩放并加黑边，帧率与采样率统一，没有音频的片段补静音。压缩总是重新编码。
- 输出写在所选的目录（`outDir`），默认是保存位置（上文「保存位置」）；从不覆盖已有的文件，重名时加序号。输出记为没有视频的生成记录（`result.outputs` 带输出文件的路径）。
- **提取音频**（`action: 'extract-audio'`）。每个输入一个输出：有音频轨时去掉画面，音频编码是 AAC、MP3、Opus 或 FLAC 的流复制进对应容器（`.m4a`、`.mp3`、`.ogg`、`.flac`），其余重新编码为 AAC（`.m4a`）并说明；没有音频轨的输入以 `TRANSCODE_NO_AUDIO` 失败。校验只看时长与音频轨。

**翻译**把一份 `speech` 文档逐句译成一份新的 `translation` 文档（视频格式规范 §5.3），由 `speech-worker` 执行（上文「字幕与翻译的核心」）：分页、重发、补做与对齐归 crate，参数 `batchSize` 照收、不再使用；原文与目标语言的主子标签相同时启动就拒绝（例如 `zh` 译 `zh-Hant`）。补做之后仍缺句子时这一步以 `MODEL_OUTPUT_INVALID` 失败（`details` 带缺的与译好的句数），检查点保留、不写半份文档，重试不重做译好的页。每次执行都新增一份译文文档，不替换已有的（它们可能有手工修改，§10.3）；源文档在执行期间变了，写入这一步以 `STALE_JOB_INPUT` 失败，重试从当前的源重新开始。

- **术语表**。术语依次来自调用时直接给的 `glossary`、调用时给的库里的术语表 `glossaries: [{ id, version? }]`（最多 20 张）与视频里启用的翻译用术语表（§5.9）；同一个原文写法（不分大小写）只取最先出现的那条。调用时给的库里的表不合（不在库里 `not-found`；转写用的、语言不符或重复 `LIBRARY_ENTRY_NOT_APPLICABLE`）时启动就拒绝，不建任务；视频启用的删了或语言不符时跳过，列在摘要的 `skipped` 里（`removed`、`language`）。语言按 BCP 47 的子标签前缀相配（`en` 与 `en-US` 相配，`zh-Hans` 与 `zh-Hant` 不配）。对外服务的客户端不能用库里的术语表，视频启用的也不读。
- **冻结与固定**。启动时冻结每张表的版本与 `contentHash`，记在父任务的 `library.entries` 上，并以父任务为持有者固定（pin）到流程结束；表的内容在第一步之前就写进一份快照产物，之后不再读库，重试也读这份快照（Runtime 重启后再固定一次，已经清理的版本跳过）。
- **进提示词**。去重之后的术语全部交给 Worker，写在每次翻译调用的系统消息里（「优先」的译法，不锁定），不按批截断；摘要沿用的 `cappedBatches` 总是 0。提示词与文件契约的版本是 Worker 协议的版本 `speech-worker/1`（记在译文的 `engine.promptVersion`）。
- **记录**。译文文档的 `glossaryRef`（视频格式规范 §5.3）记下用的库里的表与版本、调用时直接给的术语的摘要与条数，以及原文里出现过的术语与当时的译法；配音核对译文时据此判断哪几句因术语表改了而过期（`glossary-changed`）。摘要的 `glossary` 列出用的表（来源 `explicit` 或 `video`）、跳过的表、术语条数与 `cappedBatches`。
- **字幕文件**（`translate-subtitles`）。输入是一个 SRT 或 WebVTT 文件，输出是同样条数、同样时间码的新字幕文件，记为没有视频的生成记录，进 Space（§5.7）；不建视频、不写文档。外发的数据种类同样是 `transcript`（没有视频的授权），术语只来自调用时给的（没有视频启用的表）。读不准的文件启动时就拒绝、不建任务（`SUBTITLE_FILE_INVALID`、`SUBTITLE_FILE_TOO_LARGE`）：解析是严格的，宁可拒绝也不猜时间；容忍的是编码（BOM、UTF-16、GBK）、换行、WebVTT 的头与块、cue settings、多行与样式标签，有上限（4 MiB、10000 条、每条 1000 字）。每条只换文本，不合并、不拆分、不重新分句：一条就是模型的一句，按 ID 对回；写出之后重新解析，与原文件逐条比较条数与起止时间（同一格式时连时间行逐字比较），不符时这一步以 `MODEL_OUTPUT_INVALID` 失败，不发布。行内标记不带进译文，WebVTT 转 SRT 时 cue settings 与块放不下，都计数并告警；双语是原文在上、译文在下的同一条。输出写在所选的目录（`outDir`），默认是保存位置（上文「保存位置」），名字是 `<源文件名>.<目标语言>[.bilingual].<格式>`，从不覆盖。合同见命令协议规范的 `pipelines`。
- **字幕层**。写入译文之后的一步 `captions` 在参数 `captions: true` 时建立目标语言的字幕层，规则见下文「转录」的字幕层；`bilingual`（默认 false）只在 `captions: true` 时可以给。流程参数默认不建，工具入口（工具目录里 `translate-subtitles` 的视频输入在 `execution.params` 里带上）、CLI 与编辑器的「翻译成…」（连同用户选的 `bilingual`）带上 `captions: true`：不给时这一步跳过，与没有这一步时一样。摘要的 `captions` 说明建了没有、为什么；新建时带上建层那笔事务的 `transactionId`，编辑器按它撤销。加这一步之前的流程记录重试时，步骤按名字对齐，新的一步按 `pending` 补做、按冻结的参数决定。CLI：`baocut translate` 默认建，`--no-captions` 不建，`--bilingual` 双语。

**转录**（`transcribe`）是转录工具的后端，与 `models.transcribe` 提交的转写 Job 同名、不是一回事：流程是父 Job，它的「转写」一步提交一个 `transcribe` Job（`submitter` 是这个流程）并等它结束。

- **参数**。目标见上文「工具」：`{ videoId }`、`{ entryId }` 或 `{ create: { projectId, name?, media } }`（名字默认取文件名）；或者不给目标、只给 `file`（本机媒体的绝对路径或 Space 里媒体条目的 `{ entryId }`），这时可选 `outDir`（上文「保存位置」），`captions` 不能给；可选的 `assetId`、`language`（断言）、`hint`（识别提示，最多 1200 字，视频里启用的转写术语表照样并进去）、`provider`、`model`、`captions`（默认 true）；目标视频已有文稿时的 `destination`（`'new-video' | 'replace'`，缺省 `new-video`；工具与 CLI 叫 `target`，§3.5）、`name`（新建视频的名字，只用于 `new-video`）、`translations`（`'carry' | 'discard'`，缺省 `carry`，只用于 `replace`）与 `acceptEdited`（越过手工修改闸门，§6.6），这几个只配 `{ videoId }`、`{ entryId }` 目标。提交时选定并冻结 Provider 与模型，没有配置时 `CAPABILITY_NOT_CONFIGURED`；`media` 不是绝对路径时 `invalid-request`，文件不在时 `INPUT_NOT_FOUND`；都不建任务。链接不是它的输入：先走从链接导入。
- **素材**。不给 `assetId` 时取根序列主轨上的素材：主轨是 `order` 最小、有音视频片段的画面轨，没有时音频轨。主轨上不止一个素材时转写这一步以 `TRANSCRIBE_ASSET_AMBIGUOUS` 失败（`details.assetIds` 列出它们），没有时 `TRANSCRIBE_ASSET_NOT_FOUND`，给出 `assetId` 重新执行。
- **步骤**。有目标：`target` →（新建时）`create` → `transcribe` → `captions`。转写 Job 自己把新的 `speech` 文档应用到视频（§7.3），所以「应用」并在转写里，没有单独的一步。新建的视频 Provenance 记 `origin: 'file-import'`、文件路径与这次运行。目标视频已有文稿而 `destination` 是 `new-video` 时 `create` 同样执行：在原视频所在的项目（或会话的来源目录）里新建视频，名字默认「<原名> · 重新转录」，以链接方式导入目标素材的文件并放上时间线，之后的步骤都对新视频做；目标视频没有文稿时跳过、直接写进它。`replace` 的换用在 `transcribe` 一步里完成：转写 Job 应用结果就是 §6.6 的换用文稿事务（新版本、换用、结转），应用前再查一次手工修改闸门；字幕层已在这笔事务里重新切过，`captions` 一步按已有字幕层的规则 `skipped`，原来没有字幕层的照常建。只有文件：单步 `transcribe`（文件转写 Job，转写之后同一步在保存位置写 `<源文件名>.txt` 与 `.srt`，与从链接导入的 `transcribe` 步骤同一段实现；重名时两个文件一起换序号，重试认回已有结果、不覆盖），结果是没有视频的生成记录，Space 显示为文档与字幕两个条目（产物记录的文件流程里多一个 `transcribe`）；界面的「以此新建视频」把字幕配上媒体走 `space.openForEdit`。
- **落点**。视频已有文稿时按 `destination` 新建视频或换用文稿，不在这部视频里新增第二份。`replace` 而文稿全文指纹与 `stages.asr` 不符、又没有 `acceptEdited` 时，提交时以 `TRANSCRIPT_EDITED` 拒绝、不建任务；提交之后、应用之前文稿又被改了，`transcribe` 一步以它失败（`acceptEdited` 只覆盖提交时的指纹）。摘要的 `target` 是 `new-video`、`replace` 或 `first`（原来没有文稿、直接写进去）；`newVideo { videoId, name }` 是新建的视频，`replaced { documentId, previousVersion, transactionId }` 是换用前的文稿版本与可撤销的事务；`translations[] { language, kept, keptReviewed, stale, unmatched }`、`captionPins { reanchored, orphaned }` 与 `dubs[] { language, kept, stale }` 是换用回执 `impact` 的数，界面据此写结果、给出「刷新过期译文」与撤销。摘要的 `speakerCount` 是新文稿区分出的说话人数（取文档版本的概要），转录工具的结果页据此写区分出几位。
- **重试不重复**。转写认回这次运行提交过、还在跑或已完成而文档还在的 Job；文档被删了时重新转写。每次重试提交的转写 Job 用新的 `commandId`，不会被认回失败的那一次。从链接导入的新建、导入与转写是同一份实现。
- **字幕层**（产品设计 S01）。一笔编辑事务：写一份 `caption` 文档（派生自那份文稿或译文，`extensions.pipeline` 记这次运行），在根序列上放一个字幕实例，作用于时间线上取用这个素材的片段。同一份文稿（译文）已有字幕层——根序列上有实例引用派生自它的字幕文档，编辑器建的与流程建的一样算——时这一步 `skipped`。时间线上没有取用这个素材的片段时不建，告警 `CAPTIONS_NOT_ON_TIMELINE`；切不出字幕条时告警 `CAPTIONS_EMPTY`。原文字幕层放在第一条空着、没锁的字幕轨上，这个素材已有原文字幕层显示着时以停用放上去（见上文「不覆盖」）。译文与编辑器的「放到画面上」相同：新建一条这门语言的字幕轨，只看译文时把配对的原文字幕层停用（不删），双语时两层共用一份字幕样式、原文放回画面。智能体的 `captions_create`（§3.5）用同一份算法，不同之处：已有字幕层时不跳过、照样新建一层（「不覆盖」），同一份译文已有的一层显示着时新的一层以停用放上去、不动配对的原文；字幕文档不写 `extensions.pipeline`；译文没有 Worker 的字幕条，按单元的句级对齐（`alignment.sourceWordIds`）取原句成员词的时间、按显示宽度切条（`translationCues`，编辑器同名函数的移植）。
- **新建样式**。`transcribe` 与 `translate` 可给 `captionStyle`（视频格式规范 §5.6 的 Studio 样式文档，`schema` 与对象 `style`），仅建字幕层时可用；转录只给文件时不可给。编辑器在提交时把客户端保存的字幕属性冻结进这个参数。新建样式时套用，与字幕在同一笔事务保存；译文共用已有原文样式时保留视频样式，不被偏好覆盖。没有参数时用默认预设。
- **入口**。CLI 与智能体用目录里的 `transcribe` 工具（§3.6 的派生，`baocut transcribe`）。编辑器的「生成字幕」与「重新转录」也走这个流程（`{ videoId, assetId }` 与用户选的语言、Provider、模型与落点），按摘要的 `captions` 报告结果，`created` 时按 `transactionId` 撤销；用视频里已有的转写生成字幕不经过它。

---

## 8. 代码运行时

代码合成让智能体与作者用 p5.js、Three.js、Canvas、Remotion 等技术制作动画，并作为时间线上的一个实例参与合成。代码包的清单、实例字段与作者合同见代码包规范；本章说明运行机制。

### 8.1 两种合成

- 嵌套序列引用 BaoCut 自己的结构化序列，可以继续逐个元素编辑（尚未纳入实例类型，视频格式规范 §3.4）。
- 代码合成（`composition` 实例，来源是代码包）引用一个作者环境及其代码包。BaoCut 只理解实例属性、公开参数和执行合同。

持久类型不为每个 JavaScript 库增加一种实例类型。浏览器代码统一声明 `engine: 'browser'`，用 `contract` 区分 BaoCut Web Adapter、HyperFrames 等；`frameworkHints` 只用于开发提示。Remotion 使用独立的 `engine`。这样增加一个新的图形库不需要升级整个视频的实例类型集合。

### 8.2 创作工作区与发布

代码草稿放在独立的创作工作区。发布的步骤是：构建 → 检查 → 采样验证 → 计算摘要并登记为不可变的版本 → 通过事务把指定的实例从旧版本切到新版本。

- 用户在草稿里保存文件，不会直接改变正在导出的已发布代码包。
- 构建草稿不是 live Video，不通过文件监听自动覆盖已发布的代码包。
- 源码发布、视频应用和缓存失效是三个分开的事件。

### 8.3 Adapter 接口

```ts
interface CompositionAdapter {
  inspect(bundle: CodeBundleManifest): Promise<VerifiedCapabilities>;
  prepare(input: FrozenCompositionInput, signal: AbortSignal): Promise<Session>;
  sampleVisual(session: Session, request: SampleRequest): Promise<FrameSurface>;
  renderVisualRange?(session: Session, request: RangeRequest): Promise<RenderArtifact>;
  renderAudioRange?(session: Session, request: AudioRangeRequest): Promise<AudioArtifact>;
  dispose(session: Session): Promise<void>;
}
```

- `SampleRequest` 包含精确的 `localTime`、输出尺寸、采样策略、`quality` 和 `requestGeneration`。不能只给一个没有上下文的浮点秒。
- `VerifiedCapabilities` 至少包含：随机访问方式、透明度、音频、可独立输出的层、支持的采样与编码、实际可用的 GPU 能力，以及沙箱状态。声明与实测不一致时拒绝或降级能力，不盲信清单。
- `FrameSurface` 包含尺寸、有效区域、PTS、`pixelFormat`、`colorSpace`、`alphaMode` 和受控的二进制句柄。GPU 纹理只在已协商的设备与进程共享合同内有效，不把 WebGLTexture 对象直接交给 Rust。P0 允许 CPU RGBA 或缓存的中间片段；零拷贝不是前置条件。

第一期由 `packages/code-runtime`（§13.1 的 `code-runtime`）实现其中的子集：`VerifiedCapabilities` 只有合同、随机访问、透明、音频、实际的宽高帧率与时长、执行环境（Electron 离屏窗口）以及网络是否被实际拦截；可独立输出的层、采样与编码、GPU 能力尚未测量。

### 8.4 FrameTicket、就绪握手与同页串行

```ts
interface FrameTicket {
  requestId: Id;
  requestGeneration: string;
  sessionGeneration: string;
  snapshotHash: string;
  itemId: Id;
  bundleRef: VersionRef;
  parametersHash: string;
  timeMapHash: string;
  sampleDomain: 'sequence' | 'export';
  sequenceId: Id;
  editFps: Rate;
  sequenceTime: MediaTime;
  localTime: MediaTime;
  outputSample?: {
    frameIndex: number;
    fps: Rate;
    time: MediaTime;          // 相对导出起点
    exportRangeStart: MediaTime;
  };
  samplingPolicyHash: string;
  quality: 'draft' | 'interactive' | 'export-exact';
  outputProfileHash: string;
}
```

**就绪握手**。Adapter 会话先等待依赖、字体、纹理和初始媒体；每次求帧再等待目标媒体实际解码并呈现、图形实际提交。`renderAt` 的 resolve 必须满足已验证的呈现合同，不能只意味着变量已更新或 seek 已发出。Surface 回执带回票据身份、实际采样时间、完整的颜色与 alpha 信息，以及 bytes 或句柄的元数据。

依靠「等两次 requestAnimationFrame」的实现只能是候选的等待策略；没有通过媒体与纹理就绪测试，就不能开放 Export-Exact。

**串行**。同一个页面上的取帧串行执行；并行来自相互隔离的会话，或经过证明的无状态执行器。新的交互 seek 可以淘汰尚未开始的旧请求和旧返回；导出范围不得丢帧。`sequential` 的源只能按合法的重放或检查点进度推进。不为每一帧重建浏览器和视频。

**末尾行为**必须显式选择：取可用帧、hold，或报告越界。默认不把超出源码时长的请求自动当作成功的 hold。允许的时间误差来自精确的视频与素材 timebase 及所选的采样策略，不使用一个固定的容差常数；高帧率场景必须验证末帧以及相邻帧可以区分。

**第一期的子集**（`packages/code-runtime`）。`FrameTicket` 只有 `requestId`、`bundleRef`、`compositionId`、`localTime`、`frameIndex`、`fps`、`width`、`height`、`parametersHash`、`quality`；`FrameReceipt` 带回实际采样与请求的秒数、是否被夹到时长上，以及帧 bytes 的 sha256。捕获在 Adapter 等两个动画帧之外，还在 `invalidate()` 之后等待离屏窗口的 `paint` 事件，然后用 `capturePage` 取帧（`paint` 事件自带的图像可能滞后一帧，不直接用）；这仍是上文所说的候选等待策略，对 Export-Exact 的限制不变。同一会话的取帧请求串行执行；采样帧用 sha256 比较，作为确定性的证据。`hyperframes/1` 的末尾行为与 seek 回读容差见代码包规范 §4.7：容差是采样帧率下的半帧，帧率取取帧票据的 `fps`（没有票据时取包的 `intrinsic.fps`），不是固定常数。

### 8.5 混合帧率与精确局部时间

`FrameTicket.sequenceTime` 与 `localTime` 是请求的真相。`sampleDomain='export'` 时 `outputSample` 必填；`sampleDomain='sequence'` 时不伪造输出帧。接收端验证各字段的一致性，不接受彼此矛盾的多个时钟。

- 连续的浏览器动画与原生动画在精确的 `localTime` 上求值。
- 帧驱动的代码使用 `Bundle.intrinsic.fps` 选择局部帧；Adapter 返回 `actualLocalTime`、实际的源帧或 PTS，以及 `samplingPolicy`。
- `sequential` / `checkpointed` 的 `fixedStep` 是仿真步率，不随输出帧率改变；输出取样只决定读取哪些时刻。
- 帧驱动的第三方区间接口只在边界上转换右开与闭区间的规则。
- 不能把视频帧或输出帧直接当作 Remotion 的 composition frame，也不能通过改写已发布代码包的 fps 来支持新的导出帧率。
- 是否支持插值、hold 或 nearest，必须经过能力验证；不支持时拒绝或明确降级。

### 8.6 SceneRecipe 与 BuildLedger

`SceneRecipe` 组织一组场景的作者意图：场景的稳定 ID、目标序列与实例、叙事或语音锚、作者入口、参数、共享依赖、时间策略和待生成的资源。`BuildLedger` 保存每次构建的输入 hash、工具链、输出的代码包、验证报告和应用回执。

```text
TaskContract / NarrationCueSheet
  → SceneRecipe（作者意图）
  → 隔离构建 + 冒烟 / seek / 声音检查
  → 不可变的 BundleRevision
  → 对选定实例的 replaceCodeBundle 事务
  → 回执 / 预览 / 证据
```

- SceneRecipe 不是可写的主时间线。已发布实例的位置以 Video 为准。
- 更换场景默认保留 `itemId`、lineage、外部字幕锚和用户的 pin。「删掉旧片段再批量新建」不是常规的更新路径；结构确实变化时才显式建立映射。
- 共享的源码、字体或主题改动，使引用它们的代码包重新构建或重新发布。作者只要求改变某个场景时，更新选定的引用，其他场景继续使用原版本。

**时间依赖必须声明。** 把场景分成多个独立的包，并不证明移动实例之后可以复用全部缓存：场景代码可能读取自己在主时间线上的起点，或读取全局时钟。代码包因此声明经过验证的 `timeDependencies`（代码包规范 §5）。冻结的 `CompositionInput` 必须包含这些依赖的值与版本。移动 `local-only` 的实例复用内部求帧结果；移动依赖 placement 或 cue 的实例则重新求值。未声明或未验证时保守失效，不从代码文件的 hash 推断局部影响。

### 8.7 CreativeCatalogue

`CreativeCatalogue` 让界面与智能体检索同一批经过验证的原生模板与代码配方。条目包含：稳定的 `templateId`、类型、标签、参数 Schema、语言与画幅 variants、所需能力、依赖素材、许可状态和 `previewRef`。

- `previewRef` 必须绑定准确的模板或代码包版本及参数，不能出现旧预览配新代码。
- 首批只制作少量原创或明确授权的 P0 模板，用它们验证公开参数、横竖版、音频与离线依赖的合同。模板数量不是首版目标。
- 许可状态为 unknown 时不冒称可商用。
- 模板变更产生新版本；已经使用的实例不自动升级。
- 缺依赖或版本不兼容时，关闭选用或给出明确的替代。

### 8.8 适配的开放范围

文中的第三方接口名称是集成参考，不是当前可用性的保证。实现必须锁定框架、浏览器与 renderer 的版本，取得 `VerifiedCapabilities` 之后才开放功能。

- **P0**：受控 Web 合同（`baocut/1`）与 HyperFrames 合同（`hyperframes/1`）的导入、验证、取帧与烘焙；执行环境是 Electron 离屏窗口。p5 / Three / Canvas 按各自被支持的子集接入。HyperFrames 合同进入第一期，是 2026-10-07 用户开始实现任务时采纳的计划建议，不是更早的裁决。
- **P1**：外部 Remotion 代码的导入；更丰富的独立层输出；检查点；Playwright 或无头 Chromium 的执行环境。模板渲染成功不能被夸大为支持所有既有代码。
- **Remotion 只认不产**。BaoCut 自带的模板、创作指导与 CreativeCatalogue 不使用 Remotion，智能体默认按浏览器合同写代码；用户要求、智能体写出或从外部导入的 `engine: 'remotion'` 代码包必须能被识别、预览与渲染。BaoCut 不分发 Remotion：Adapter 使用代码包自己依赖里的 Remotion，许可由代码包的作者负责（代码包规范 §4.6）。

实例、参数和源码的变更在界面、命令与回执中始终分开。

---

## 9. 渲染、预览与导出

### 9.1 统一编译，分后端执行

```text
冻结的 Video + 选定的语言版本
              ↓ 校验 / 解析依赖
       RenderComposition / RenderGraph
              ├─ 原生媒体 / 文字 / 字幕 / 形状 / 效果
              ├─ 嵌套序列
              ├─ 代码合成 → adapter → 帧 / 片段缓存
              └─ 音频路由 → 采样时间线
              ↓
       合成器 + 混音器
              ↓
       编码 / 封装 → 经校验的产物
```

VideoStore 的格式与 RenderGraph 是不同的层。RenderGraph 是派生的执行计划，包含显式依赖、活跃区间、timeMap、渲染顺序与后端选择；用户不维护它。

**帧计划**是 RenderGraph 在一个时刻的切面：哪些层叠成画面、每层怎么摆、取源的哪一刻，以及哪些声音在响、各自的增益。它只有一份实现（`render-graph`），编辑器预览经 WASM 调用，导出直接链接。计划的字段只增不改，消费方忽略不认识的字段；`layers` 本身始终是硬切的结果，不认识新字段的合成器画出「没有转场、没有效果」的画面，不会出错。合成器按下面的方式消费转场、效果与闪避，语义见视频格式规范 §3.5、§3.9：

- 层的 `transition` 说明这一刻它在一个转场里：`role` 是它在出场还是入场的一侧，`partner` 是另一侧的完整的层（自己的变换、`sourceRect`、取源时刻与效果），`eased` 是画面用的进度。按 `kind` 与 `params` 把两层合成在这一层的位置上。单侧转场没有 `partner`，缺的一侧透明。带 `unsupported` 的按硬切画，并报告。
- 层的 `effects` 按顺序作用，停用的不在里面；带 `unsupported` 的跳过并报告，不静默。裁剪已经折进 `sourceRect` 与摆放，合成器不另外处理。
- 声音的 `gainDb` 已经包含交叉淡化与闪避，直接使用；`unduckedGainDb` 是闪避之前的值，供界面显示压低了多少；带 `transitionId` 的声音正在交叉淡化。
- 章节不进帧计划。

已定：画面只有一份实现，移植自 v2 的渲染核心（`bcut-render` 及其元素层、字幕渲染与运动库），预览与导出共用。帧计划决定这一刻有哪些层、各自取源的哪一刻；每一层按它的元素参数编成 DrawOp 指令流，光栅器重放指令流得到画面。导出直接链接这份实现，预览经 WASM 调用同一份，不另写一套绘制。DrawOp 指令流有确定的二进制编码与指纹，预览与导出对同一帧的指纹必须相同。v3 自己的外壳不变：冻结、预检、Worker 进程与协议、暂存与发布（§9.11），有理数时间与帧计划，硬件编码的显式协商（§9.6）。

现状：预览与导出都经 `crates/frame-render` 画。它把帧计划的每一层换成渲染内核的元素（`subtitle-render` 的元素管线，光栅在 `render-raster`）画出来：原生导出（`export-worker`）直接链接，预览经 `bindings/preview-wasm`（`wasm-safe`，开 SIMD）调用同一份；`render-core` 与界面的 Canvas 2D 画法已删掉。

- 画得出来的：摆放与几何、关键帧绑定、元素动画的三个槽、遮罩与平铺、`fx`（视频格式规范 §3.9 的固定顺序）、文字样式与图形、生成类元素（计时、声波、进度条、彩纸、手绘、占位框、模板贴纸与素材贴纸、Lottie）、白板、模板层、规范 §3.9 的全部转场、字幕（Studio 样式与定位框样式，含显示时机、逐词动画与设计字幕的配方）。字幕的各行缺省在字幕块自己的宽里对齐、块居中在锚点上（与 v2 的 Studio 样式相同）；定位框样式换算成 Studio 样式时带上根样式的 `alignWithinWrap`，各行改在折行宽度（框宽减两侧留白）里按 `textAlign` 对齐，左对齐贴框的左边、右对齐贴右边，底板跟着行走，与文字元素相同。字幕的词（视频格式规范 §3.8）由 `frame_render::caption_words` 从字幕文档派生自的转写取，去留按有效词流（`render_graph::text_plan::plan_text`，作用实例是显示这份字幕的实例的 `scopeItemIds`）；交给内核的句子保留文档里的句子 ID，设计字幕的强调（`captionEmphasis`）与逐句样式（`cueStyles`）按这些 ID 找：同一组里撞了的句子 ID 补后缀，`sourceItemId` 仍是文档里的 ID；写在多字词上的强调落到它拆出来的每个字上。序列的模板层交给字幕计划只为避让（视频格式规范 §3.17），模板本身仍由模板层画。导出由引擎 `exports.plan` 把这份转写冻结进 `documents`（字幕文档带着文档头的 `sourceDocumentId`、`sourceAssetId`），预览由界面经 `bc_set_speech` 送同一份，WASM 把它并进渲染器的文档。字幕的编译结果按取用素材的实例与字幕实例缓存，剪辑变了就重编。
- 画不出来的逐层报出原因（`frame_render::support`，预检与合成问同一处；原因见命令与协议规范 §4.4 的成片导出），不画占位框、不画成空白：预览跳过它并列在预览的状态里，导出预检拒绝或按选项跳过。内核的提示（例如跳过的元素参数、没有频谱的声波）预览列在同一处，导出是 `EXPORT_RENDER_NOTE` 警告。
- 字体先用随内核发布的那一套（`render-raster/assets/fonts`，38 份，思源黑体兜底）：导出链进二进制；预览的 WASM 不内嵌字体，由构建拷给界面、界面按同一次序读出来注入。样式指名的字体族不在这套里时，到本机字体里找那一个 face（`crates/font-files`，移植自 v2 的本机字体库；系统字体目录，测试经环境变量 `BAOCUT_FONT_DIRS` 换成临时目录）：排字时记下点了名的「族名、字重、斜体」，报缺的族里的这些 face 按与排版引擎同一套 CSS 字体匹配挑（族名先精确、再不分大小写、再按 PostScript 名），只找画面真用到的，不列也不上传整个字体目录。挑中的 face 抽成单独的字体（新的文件头加这个 face 的各张表，字体集合里别的 face 不带；抽出来超过 96 MB 的不载），预览与导出装的是同样的字节。导出见 §9.11 的「字体」；预览在 WASM 里读不到本机字体，由界面把报缺的族里点了名的 face 交给 Runtime 的 `fonts.resolve`（命令与协议规范 §4.1，一次至多 32 个），引擎宿主给出所在文件、第几个与抽法（第一次用时扫一遍本机字体的名字表，本机约 0.1–0.6 秒；引擎宿主把 `fonts.resolve` 放在单独的线程上答，扫的期间别的请求照常处理，它的响应晚到、按 `id` 配对；扫好的索引只留在进程里，不缓存到盘，v2 也不缓存），Runtime 发读取句柄，界面按区间（`Range`，只认 206 且长度对得上的回应）只取这个 face 的表拼起来，经 `add_font` 注入、重画——一个 78 MB、24 个 face 的苹方集合只下载、注入用到的那一个 face（约 13 MB）。字节拷进 WASM 之后界面不留副本：内核陷阱后重新载入、缩略图另分实例时按同一个 face 重新要一次（要回来之前不算重新载入好），之后送进来的本机字体也送给已经分出去的缩略图实例。每个 face 一次；报过缺的族记在预览引擎上（同一族后来才排到的粗体照样去要），这个族后来下载好了（字体条的「下载」、重试、导出里下载的）时再要一次，画面不必重新打开视频就换上。在取的时候预览不报这个族缺字体；哪里都找不到的族照回退规则画，文字元素与字幕在预览的每一帧、导出的结果里都报同一句提示（「字体 "…" 在当前字体库中不可用，将使用 Noto Sans SC fallback」）。桌面端打包后的页面在 `file://` 下：字体是渲染进程产物旁的单独文件，按相对地址（`new URL(文件名, import.meta.url)`）用 XHR 读。整个渲染进程都靠 Electron 给 `file://` 页面读同为 `file://` 的文件的权限（fuse `GrantFileProtocolExtraPrivileges`，缺省开着）：关掉之后不只字体，页面的模块脚本也读不到，界面起不来。所以打包配置不得关这个 fuse（Runtime 经 `ELECTRON_RUN_AS_NODE` 启动，`RunAsNode` 同样不得关）；要关就得把整个渲染进程改由自定义协议供给。渲染进程的生产构建核对每一份字体都进了产物、`base` 是相对的，不对就构建失败（`apps/desktop/electron.vite.config.ts` 的 `checkPreviewFonts`）；`npm run check:file-fonts`（`apps/desktop/tools/check-file-fonts.mjs`）在 Electron 的隐藏窗口里以 `file://` 打开生产构建的 `index.html`，经随产物构建、应用自己不加载的自检入口（`src/renderer/kernel-check.ts`）走预览同一条载入路，核对内核注入了产物里的每一份字体、经内核量得出文字框。Windows 的打包（`apps/desktop/tools/package-desktop.mjs`）不设 fuse，用 Electron 缺省值；这项检查对的仍是生产构建加缺省的 fuse，还没有改为对打包出的应用跑（§14）。
- 按需下载的字体（Google Fonts）：随内核的、本机的都没有，而字体目录里有的族，由 Runtime 下载到 Runtime Home 的 `fonts/`（不进项目目录），之后与本机字体一样经引擎挑 face、抽法与读取句柄，预览与导出用的是同一个文件。解析的次序是随内核 → 本机 → 下载缓存 → 下载：本机装了的族只用本机的、不下载，随内核的族从不下载；要的字重先按目录对到这个族实际有的字重（与引擎挑 face 同一套 CSS 匹配），缓存里有那个 face 就不再下载。字体目录（`packages/runtime-core/src/fonts/google-fonts-catalogue.json`，约 1900 个族：族名、分类、字符子集、字重与斜体、是否可变、许可）由 `scripts/google-fonts-catalogue/` 的脚本从公开元数据生成、随源码签入，不带字体文件；许可只有 OFL-1.1、Apache-2.0 与 UFL-1.0，每个族的许可记在目录里，选字时显示、下载记录里带上。
  - **下载**。不要 API key：向公开的样式表接口 `<fonts.cssEndpoint>/css2?family=<族名>:wght@<字重>`（斜体时 `ital,wght@`）要一个 face，请求只带族名、字重与斜体，User-Agent 固定为 `BaoCut`——对不像浏览器的 User-Agent，接口给的是每个 face 一个完整的 TrueType 文件（中日韩字体也是一个文件，约 5–20 MB），不切 `unicode-range` 分片、不给 WOFF2，所以不用解 WOFF2、不用合并分片；回应里是分片的、或文件地址不在 `fonts.fileEndpoint` 的 https 基址之下的，都当作字体服务没给这个 face（`FONT_DOWNLOAD_SOURCE`）。不跟随重定向；样式表上限 256 KiB，字体文件上限 64 MiB（声明的与实际收到的都查）；连不上、5xx、429 与读到一半断开按退避重试三次，30 秒收不到字节算停滞。下载写到 `fonts/.staging/` 的临时文件，再由引擎宿主的 `fonts.inspect` 按渲染用的同一套解析核对（读得出字体、文件里有这个族名），过了才改名进 `fonts/files/<族>/<族>-<字重>[i]-<摘要前 12 位>.ttf`、记进 `fonts/index.json`（族、字重、斜体、许可、sha256、大小、下载时间；不记地址）；核对不过的删掉（`FONT_DOWNLOAD_INTEGRITY`），磁盘满是 `FONT_DOWNLOAD_NO_SPACE`。日志只记族名，不记地址。下载缓存里的字体只当字体解析，不执行别的。
  - **任务与并发**。下载是 JobManager 里的 `fontDownload` 任务（一个族的几个 face，进度按字节经 `jobs` 主题，取消用 `jobs.cancel`），队列 `font-download` 同时两个；同一个 face 同时只下载一次，后来的请求等同一个下载。取消（`jobs.cancel`）的下载任务以 `CANCELLED` 结束，选字列表里这个族是 `failed`、`error.code` 为 `CANCELLED`（界面显示「已取消」，可重试）。下载归开始它的那一方：选字、打开视频与预览开始的是 `fontDownload` 任务；导出任务里下载的 face 不另建任务，进度记在导出任务上（阶段 `downloading`），取消导出只停导出自己开始的下载，别处已经在下的同一个 face 导出只是等它，取消导出不取消它。自动下载失败的 face 十分钟内不再自动重试，`fonts.download` 手动下载就是重试；取消（取消下载任务、取消导出、删除）不算失败，下一次要用这个 face 时照样自动下载。预览等下载时再问 `fonts.resolve` 不带 `download`，只等已经开始的下载，不把刚取消的重新开始。下载之前查设置：`fonts.autoDownload` 关着或 `offline.strict` 开着时不自动下载。
  - **预览**。界面的 `fonts.resolve` 带 `download: true`：本机没有、目录里有的 face 开始下载、记为 `downloading`，界面隔 1.5 秒再问那几个，下载结束（成功、失败或取消）再交给预览引擎注入并重画（`packages/ui/src/render/font-downloads.ts`；这期间照回退字体画、不报缺字体）。同一批里本机就有的、已经下载好的与先下完的 face 先注入（`onPartial`），不等这一批里还在下载的。触发下载的除了预览帧与缩略图报缺的 face，还有打开视频时的清点（下一条）。
  - **清点与样张**。`fonts.usage` 清点一个视频用到的字体：用到的族散在文字元素、动画预设、模板生成的内容与字幕样式里，所以与成片导出同一份冻结交给 Render Worker 排一遍字（`export-worker census`，只排字、不画）；这份冻结不带素材（`exports.plan` 的 `skipAssets`），缺素材、素材文件不见了或变了的视频照样清点。按族给出点了名的 face、此刻的状态与内核此刻用什么画它（回退族，随内核的为思源黑体 `Noto Sans SC`）；带 `download: true` 时还没下载的 face 按自动下载的同一条规则开始下载（关着、严格离线、十分钟内失败过的不下，取消的不算失败）。打开视频时界面带 `download: true` 调一次（下不下由 Runtime 按设置定），导出面板打开时再调一次（不带，不下载）。`fonts.sample` 给选字列表的样张：一个目录里的族、只含族名里那几个字的子集（样式表接口的 `text` 参数），请求只带族名、常规字重与这几个字，与下载同一套接口设置、主机限制与上限，存在 `fonts/samples/`，`fonts.clear` 不删；严格离线时不取。
  - **界面**（产品设计 §5.9；原型 `panel-font-picker.jsx`、`font-downloads.jsx`、`settings-fonts.jsx`）。选字框（文字、计时与生成器元素的样式，字幕样式，舞台工具条）是一张虚拟滚动的整表：视频里用到 → 最近用过 → 全部字体，检索或筛选（分类、文字）时合成搜索结果；打开时的次序冻结住，状态随 `jobs` 主题与 `fonts.catalogue` 实时变（内置、本机、已下载、可下载、下载中带百分比与取消、失败带重试、已取消），ⓘ 是详情与许可。选中还没下载的族立即生效、开始下载并提示。舞台上方的字体条是打开视频时这件事唯一的地方：进行中（第几个、族名与进度，跳过这个、全部取消）、全到了（3 秒后收起）、没取到（族 → 回退字体 · 原因，可重试）、自动下载关着（下载、设置）。设置 › 字体：自动下载、两个只接受 https 的镜像地址（不合规的当场说、不保存）、已下载的字体（导出在用的标出来、删不了）、总大小与全部清空。导出面板见 §9.11。浏览器会话没有 `fonts.*`：Web 入口保留只列随内核字体的旧选字框，不显示字体条、设置里没有「字体」、导出面板不提示字体，不放占位界面。
  - **引擎**。引擎宿主的字体线程收 `cacheDir`（`<home>/fonts/files`）：本机没有这个族时到这个目录挑，答复带 `source: 'downloaded'`；`fonts.families` 给本机已装的族名（选字列表用），`fonts.inspect` 核对下载的文件（只读、有上限）。
  - **删除**。`fonts.remove` 与 `fonts.clear` 删缓存里的文件；还没结束的导出冻结了的文件或在等的 face 不删（`FONT_IN_USE`，清空时留下），导出结束才解除。已经画好的成片不受影响。
  - **测试**。测试不碰网络：Runtime 的 `fonts` 选项注入字体目录与 fetch（把 Google 的地址改写到本机的假服务）；没注入时 vitest 带着 `BAOCUT_FONT_DOWNLOADS=off`（字体目录为空、什么也不下载）。
- 新建文字时量文字框（没写 `w` 时框宽取量出来的字宽）也经同一个 WASM 模块（`bc_measure_text`，`frame_render::text_measure`），与画字同一台排版引擎、同一批字体。没有别的量法：内核还没载入时新建等它载入；量到一半内核陷阱、正在重新载入（`PLANNER_CRASHED`）时等它好了把这一组整个重量（最多三次）；内核载入或重新载入失败就提示、不新建（`packages/ui/src/components/editor/text-measure.ts`）。框按新建那一刻的序列算，等的期间序列变了就按变了之后的。文字预设卡的缩略图由画它的内核实例量。
- 编辑器的缩略图（元素格、字幕样式卡、文字预设卡、品牌库的 Lottie 贴纸）用同一个 WASM 模块的另一个实例画成透明底的帧，与落到画面上的一样。
- SVG 图片（素材版本的 `mediaType` 是 `image/svg+xml`，图片、贴纸、占位框里的都算）在内核里画：`FrameRenderer` 从素材字节按输出的长边光栅（`render_raster::svg`，resvg），贴纸带 `fillOverrides` 时先按换色表改 SVG 文本（`timeline::svg_fill::apply_overrides`，与贴纸面板的色卡同一份分组），按素材版本与换色表缓存，改输出尺寸时重光栅。预览把 SVG 素材的字节送进 WASM（与 Lottie 同一条路），不读图片元素的像素；导出从冻结的文件读字节，预检用同一个函数判断解不解得开（`asset-undecodable`）。预览的 WASM 只带 resvg 的光栅、不带它的文字排版，导出的 resvg 字体库是空的：两边 SVG 里的 `<text>` 都不画。不是 UTF-8 的 SVG 换不了色，按原色画并给提示。
- GIF 图片（`mediaType` 是 `image/gif`，范围与 SVG 相同）也在内核里画：`frame_render::load_gif` 从素材字节解出全部帧（`render_raster::source::AnimatedImage`，每帧的显示时长取 GIF 的延时），按「这一刻减去实例的开头」取帧：图片实例按 GIF 自己的总时长循环，素材贴纸按 `loop`（`loop` 循环、`once` 停在末帧、`hold` 停在首帧）。帧数超过 2048 或解出来的像素超过 128 MiB 时只画第一帧，并给提示；总时长为 0 或只有一帧的也画第一帧。上限预览与导出是同一份（`frame_render::GIF_BUDGET`），按素材版本缓存解出来的帧。预览把 GIF 的字节送进 WASM（与 SVG 同一条路），导出从冻结的文件读字节，预检用同一个函数判断解不解得开（`asset-undecodable`）。位图不换色。
- Lottie 素材的字节是 bodymovin JSON 或 `.lottie` 压缩包，两边都在内核里读（`render_raster::source::lottie`）。压缩包只读 zip 的中央目录：只认存储与 deflate（miniz_oxide），加密、ZIP64、分卷、带 `..` 或绝对路径的名字一律拒绝，单项解压后 ≤ 64 MiB、合计 ≤ 256 MiB、至多 4096 项，大小与 CRC 都要对得上。画清单（`manifest.json`）的 `activeAnimationId`（第 2 版是 `initial.animation`），没有就取 `animations` 的第一项，再没有就取按名字排在最前的 `animations/*.json` 或 `a/*.json`；只写路径的图片子资源在包里按「路径本身（去掉开头的 `/`）、`images/<文件名>`、`i/<文件名>`、`<文件名>`」找。图片子资源是位图（PNG、JPEG、GIF 首帧、WebP）或 SVG（data URI 可以是 base64，也可以是百分号编码的文本；包里的文件也一样），SVG 按资源声明的 `w`×`h` 光栅（resvg，不画 `<text>`）。读不开的包是 `lottie-unreadable`，包里也找不到或解不开的图片仍是 `lottie-asset-missing`。导入素材时引擎用同一份读法（`video-engine` 依赖不开 `media` 的 `render-raster`）认 Lottie、取尺寸与时长，见视频格式规范 §4.1。
- 声波的频谱（BCS1）由素材的声音算出：按素材版本各算一次（48 kHz 单声道、FFT 1024、每秒 60 帧，`waveform::dsp`），`frame_render::spectrum` 按声音计划拼成每个声波实例在序列时间上的一条，预览与导出同一份拼法。导出由 Render Worker 解码冻结的素材文件（Symphonia，解不了的交给 ffmpeg），成片的冻结包含声波听到的素材；预览由界面用 Web Audio 解码后，分块送进预览 WASM 里同一份分析（`bc_spectrum_begin/push/finish`），结果按素材版本进素材缓存，算好之前声波按静止的样子画、不报提示。超过 512 MB 的素材预览不分析，声波按静止的样子画并报出来。`speaker` 与 `alwaysShow: false`（视频格式规范 §3.7）也在 `frame_render::spectrum` 里施加在拼好的那一条上：各说话人的区间由 `render_graph::audio_plan::speaker_activity` 从视频里的转写求出，预览由界面把转写送进 WASM（`bc_set_speech`，序列上有写了 `speaker` 的声波或按文稿触发的闪避时才送；转写正文还在取时不报「没有转写」那两句说话人提示，取到之后暂停中也在下一次重画时送上），导出由引擎 `exports.plan` 的 `video` 计划带上（`speakers`），交给 Render Worker。
- 预览与导出逐字节一致：同一份输入按导出的路子（原生构建）画出的帧摘要记成夹具（`crates/frame-render/tests/fixtures/parity.json`），编出来的预览 WASM 画同一份输入必须得到相同的字节，不留容差。浏览器解码的画面（视频、位图）与声音不在这个范围里：两边送进渲染器的是解好的画面与算好的频谱；SVG 与 Lottie 两边都从素材字节在内核里画，在范围里。
- 叠层的捷径只能与整幅画逐字节相同：整数平移、像素只有全不透明与全零的层（整幅视频）原样拷（`render_raster::raster::copy_over`，有一个半透明像素就整层交回管线，目标一个字节都不动）；别的层（一行字、一张贴纸、字幕层）只在非零像素的外包矩形里叠（`render_raster::plan::composite_bounded`），只收源全零时不动底下的九种混合方式，别的混合方式整幅画。预览与导出走同一条路。
- 速度（`tools/preview-bench.ts`，Node、开 SIMD）：视频加双语字幕 960×540 一帧约 11–12 ms，1920×1080 约 45–60 ms；视频加多种元素 960×540 约 28–30 ms，1920×1080 约 110–115 ms；载入字体后的第一帧约 45 ms（建排版引擎），之后改尺寸或换文档时引擎复用。

待补：浏览器解码有损格式与 Symphonia 不逐样本相同，预览的频谱与导出接近但不逐字节相同；导出的声波听的是文档里这条序列的声音，不随导出时选的音轨变；转场另一侧的元素动画按夹到它自己区间里的时刻取。

普通视频加原生字幕的路径必须可以不启动代码浏览器 Worker；浏览器只负责真正需要它的合成。不因为 HTML 标签叫 video 或 text 就把任意的 CSS / JS 自动编译成原生元素：只有受控的领域对象，或已经验证的明确子集，才进入原生路径。

### 9.2 合成边界与背景依赖

代码合成默认以完整的 composition 为边界，而不是任意的 DOM 节点。混合模式、backdrop、滤镜和嵌套遮罩会形成背景依赖；拆层会改变画面时，必须保留相应的依赖子图。

需要背景输入的代码 Adapter 必须声明并接受一个明确的 backdrop frame。无法表达时，使用经过验证的同后端组合方案，或拒绝该效果。不能声称把任意原生效果移到浏览器里就必然等价。

### 9.3 颜色与 alpha

首版严格导出先收敛到 SDR。源的色彩信息、工作空间、浏览器输出的色彩、编码目标各自声明。已定：颜色、混合与 alpha 的规则以 v2 渲染核心的契约与它的基准图为准，预览与导出走同一份实现（§9.1），两者的一致由同一份代码保证，不靠两套实现各自对齐。渲染核心（`render-raster`，下列文件都在它的 `src/` 下）的规则：

- 像素缓冲一律是 sRGB 编码值上的预乘 RGBA8（tiny-skia 的格式），混合不换到线性空间。帧计划的 surface 只有 `srgb-premultiplied`、u8 这一种（`plan/surface.rs` 的 `SurfacePlan::canvas`，契约 `ColorContract::SRGB_U8` 在 `motion`）；线性预乘只在词汇里，没有执行器用它。
- DrawOp 里的颜色与渐变色标是非预乘的 0..1 RGBA，超界的分量夹到 0..1，绘制时由 tiny-skia 预乘；位图侧表是已预乘的 RGBA8（`drawop.rs`、`raster.rs`）。非预乘的输入（图片、动图、解出的视频帧、sbix / CBDT 彩色字形）进来时一律用 tiny-skia 的 `ColorU8::premultiply` 换算，取整规则只有这一份；COLR 彩色字形的输出本来就是预乘的，不再乘（`source/animated_image.rs`、`media.rs`、`fonts.rs`）。
- 层画在全透明的离屏画布上，回贴时按层的不透明度与混合模式合成；混合模式逐一对应 tiny-skia（normal 即 source-over，另有 multiply、screen、overlay、darken、lighten、difference、exclusion、plus，`effects/composite/blend.rs`）。裁剪作用在层内的每一次绘制上，回贴不再裁剪；遮罩把遮罩层的 alpha 或亮度（Rec.709 整数权重）当作 0..255 的定点因子，按 `(c × f + 127) / 255` 乘到预乘的四个分量上（`raster.rs`）。
- 颜色类滤镜先反预乘到 f64，在 0..255 域运算、夹紧，再乘回 alpha 四舍五入，alpha 不变，亮度权重是 Rec.709（`effects/filters/color_adjust.rs`）。交叉淡化与按逐像素覆盖率合成的转场（划像、圆形、墨迹）在预乘值上做整数插值 `(f × (255 − a) + t × a + 127) / 255`，覆盖率为 0、1 的像素逐字节拷贝输入（`effects/transitions/mod.rs`）；超采样与运动模糊在预乘数域里求平均（`imgcmp.rs`、`motion_blur.rs`）。
- 交给只收非预乘像素的一方时，按 tiny-skia 的取整反预乘（`c / (a / 255) + 0.5`，`effects/pixel_format.rs`）。

现状：预览与导出都经 `frame-render` 用 `render-raster` 画（§9.1），上面的规则两边相同；转场把两侧画好的层合起来也在 sRGB 编码值上混合（`frame-render` 的 `transition.rs`）。交给界面的透明帧（缩略图）按上面的取整反预乘。素材按 ffmpeg 的缺省换成 RGB，成片编码为 BT.709 标记的 yuv420p（`colorspace`、`color_primaries`、`color_trc` 都写 bt709）。浏览器像素作为带明确标记的输入做转换，不能只改 BT.709 标签而不转换像素。

Alpha 必须声明 straight 或 premultiplied；格式转换由 `FrameSurface` 的接收端统一完成。透明边缘、文字阴影、半透明转场要有专门的基准图像。HDR 输入无法完整保持时，必须提示显式的 tone-map 或拒绝，不能无提示地当作普通 SDR。

### 9.4 预览层级

| 层级 | 用途 | 规则 |
| --- | --- | --- |
| Draft | 快速看方向 | 可以用低分辨率代理或低质量的代码预渲染 |
| Interactive | 编辑时的响应 | 保持交互流畅，可以丢帧 |
| Export-Exact | 与导出一致 | 使用冻结的版本与导出的求值规则，允许较慢 |

界面不得把代理预览标成精确的最终结果。

现状（编辑器预览，`packages/ui/src/components/editor/preview-engine.ts`）：

- 停住时（暂停、定位之后）是 Export-Exact：内核按画布像素（显示尺寸乘设备像素比，不超过序列画布）画出的帧就是导出的那一帧。停下来时按原尺寸重画停住的那一帧。
- 播放中是 Interactive：画同一份计划、同一份内容，只把输出降到像素预算之内（`PLAYBACK_PIXELS`，960×540，`packages/ui/src/render/playback-quality.ts`），由画布的 CSS 尺寸放大。与导出的差别只能是分辨率与时机，不能是内容。
- 播放中一个视频帧只画一次：显示器刷新比视频帧率高时不重画；文档、素材、字体、频谱或尺寸变了，同一帧也重画。
- 停着定位（拖动播放头、点时间线、逐帧）不等视频定位落地：还在定位的视频先用它上一张读出的画面马上画，接连定位按播放的像素预算画。这是时机上的差别；最后一次定位之后 200 ms（`SCRUB_SETTLE_MS`）没再定位、媒体都对准了，再按原尺寸画精确的那一帧。引擎的 `exact` 只在画布上是这一帧时为真。
- 预览 WASM 按输出尺寸留两台渲染器（播放一台、停住一台），来回切不重建排版、字幕编译与素材缓存；送进来的字体、文档、转写与频谱对每一台都生效，声波拼好的频谱轨（与尺寸无关）换台时带过去，不重拼。`parity.test.ts` 在几种尺寸来回画之后核对停住的那一帧仍与导出逐字节相同。

待补：60 fps 的 1080p 素材播放中只出到每秒 37–48 帧（30 fps 素材到 30 帧）；内核里每个元素都分配、清空、拷贝一整幅的层（`subtitle-render` 的叠层入口），元素多时这是大头；每帧把视频画面经 Canvas 2D 读回再送进 WASM（`drawImage` 加 `getImageData`）约 8–9 ms，要省掉得让视频不经内核、由 GPU 合成在底下（只在视频是最底一层、上面全是内核画的层时成立）；打开后第一张精确帧最慢约 1.5 秒（等视频载入）；播放中画面与声音的偏差 p95 约 30–50 ms。

记录 `requestedFrame`、`renderedFrame`、`displayedFrame` 和 `requestGeneration`。新的 seek 到来之后，旧的异步解码或捕获结果只能丢弃，不能覆盖新画面。交互可以丢帧，导出不允许丢帧。

共享的 Rust 语义与可复用的渲染模块是减少差异的手段，但不保证 DOM 预览、WebGPU、原生 WGPU 与不同 GPU 之间的像素天然一致。严格验收按固定环境与声明的容差测试，不口头承诺绝对的所见即所得。

### 9.5 缓存键与失效

```text
cacheKey = hash(
  bundle/source revision + 全部传递依赖的素材 + 字体 bytes + 依赖锁
  + adapter / runtime / browser 版本 + 参数 + seed + 局部时间范围
  + 尺寸 + editFps / outputFps / bundleFps + 采样与帧数政策
  + 颜色 / alpha / 质量设置
  + 必需的 backdrop 依赖 + 仿真检查点或状态版本
)
```

- 普通素材的缓存键也必须包含素材版本、timeMap 与效果状态，不能只有 frameIndex。
- 帧率不是一个含糊的字段：明确区分编辑帧率、输出帧率、代码包固有帧率、源 timebase，以及实际的采样时间与量化、帧数政策。等价的有理时间规范化之后建键。实际的样本可以复用；编码产物按输出合同另行建键。
- 不能从「一个源码文件改了」推断「只有某两秒变化」。P0 对发生变化的代码包保守地失效整个本地合成。P1 只在作者声明了依赖范围并验证通过，或结构化的场景足以推导时，启用局部失效。用户手工指定局部渲染区间是受约束的操作，不是编译器证明。
- `sequential` 的仿真在修改时间点之后的依赖尾部全部失效；只有合法的检查点或独立的子场景才能缩小范围。
- 全局字体、主题参数或共享函数的变化可能影响所有场景。

### 9.6 资源与性能策略

优化的优先顺序：

1. 避免重复计算；
2. 复用已生成的动画；
3. 缩小必须由浏览器处理的区间；
4. 降低跨进程复制；
5. 合理并发；
6. 优化编码。

约束：

- 浏览器与 Remotion 会话按代码包与运行时复用，受内存预算控制。
- 使用有界队列与背压；GPU surface 必须显式释放。
- 1080p RGBA 单帧为 1920 × 1080 × 4 = 8,294,400 bytes。内存随窗口与池的上限受控，不随视频总帧数线性增长；整条片子的裸帧常驻不是可接受的缓存策略。
- 实际可用的 GPU 内存未知时报告未知，不伪造准确的剩余显存。
- 硬件编码、跨进程 GPU 共享、局部缓存、代理播放都必须协商并报告；不把预览的降质悄悄带进导出。硬件编码是可协商的快速路径，失败时不得静默改变 codec 或画质合同。
- GPU 零拷贝是后续的性能视频，不是首版正确性的假设。

### 9.7 字幕与播放的共享真相

界面 Stage 的本地 Clock 只负责呈现。精确的源时间、序列时间与局部时间之间的换算，来自 Rust 与 WASM 的同一套语义。导出使用冻结的 RenderGraph。

音频只归一条混音路径所有：Adapter 内部的音频与外部的旁白不能重复播放。

改变整片的文字或字幕不应无条件清空全部代码合成的内部缓存。但「未变的代码无需重新求帧」的前提是它的传递依赖、运行环境与背景输入确实没有变化；带 backdrop 的代码合成必须按依赖失效，不能为了让调用数为 0 而复用错误的画面。

### 9.8 检查服务与证据

`InspectionService` 产出不可变的 `InspectionArtifact`。检查请求必须明确：是源媒体还是最终合成（`source-media` / `final-composite`）、`snapshotRef`、序列与版本、帧或区间、`quality` 和目的。

**最终合成的检查必须经过与目标 RenderGraph 一致的合成路径。** 只截一个 HTML 子场景，或只返回源视频的缩略图，都不算。

```ts
interface EvidenceReceipt {
  snapshotHash: string;
  videoRevision: Revision;
  sampleId: Id;
  requestedTime: MediaTime;
  actualTime: MediaTime;
  visibleItemIds: Id[];
  samplingPolicy: string;
  frame: { width: number; height: number; colorSpace: string; alphaMode: string };
  contentHash: string;
  byteLength: number;
  renderPath: string;               // 实际执行的渲染路径
  covered: RangeRef[];
  uncovered: RangeRef[];
}
```

- 收到二进制证据时校验尺寸、格式、字节上限和摘要，不只相信 worker 声明的元数据。
- 任务继续编辑之后，旧版本的证据可以保留为历史或候选，但不能标成「当前已检查」。不可变的快照用来识别旧证据并明确其归属；需要当前状态时重新申请证据。
- 关键帧检查、短片段播放和音频试听是不同的方法。单帧不能证明运动节奏；核对文本不能证明真实发音。质量记录只承认实际的检查覆盖。
- 检查不改变视频，不为失败的截图伪造成功的产物；它受同样的资源准入、隐私外发与日志策略约束。

### 9.9 RenderExecutionPlan 与同帧切换

`RenderExecutionPlan` 为每个时间区间记录：所需能力、选择的后端、证据版本、输入快照、代理或精确等级、回退原因和资源估计。它是派生的执行计划，与存储的视频分离。

**交互预览**可以使用已验证的媒体直显或 DOM overlay 快速路径；遇到复杂的字幕动画、遮罩、backdrop、混合、嵌套或三维变换时，转到完整的合成路径。不能只看实例类型就判定两条路径等价。切换时保持相同的 `FrameTicket` 与音频主时钟；新的 surface 就绪之前，不能把不匹配的旧画面标成新帧。失败时可以保留带明确状态的旧预览，或显示错误。

**Export-Exact 与最终合成检查**使用冻结的计划和验证过的基线路径。某条快速路径失败时，只能退到满足同一输出合同的后端；改变 codec、画质、音轨或透明度必须重新确认或拒绝，不能静默降级。只含原生字幕的视频，代码浏览器的启动数应为 0（桌面界面自身使用 Chromium 不在此列）。

**packet remux** 需要单独证明资格：没有必须重绘的视觉变化、音频路由可以直通、剪切边界与封装和编码兼容、时间戳处理满足输出合同；否则编码。不能因为「只是剪两刀」就保证 stream copy。

### 9.10 输出采样链

导出按下面的链条单向求值：

```text
outputFrame → outputTime → sequenceTime → composition / sourceTime → actual sample
```

中间的序列与嵌套层不得反复取整。连续的原生曲线允许在半个视频帧上采样；离散的源只在 Adapter 或解码的边界上选择实际帧。预览的 Clock 可以产生近似的宿主时刻，但 Export-Exact 以冻结的 Rate 和精确的索引为准。

范围不能被输出帧时长整除时，`exact-grid` 拒绝；`cover-range` 把尾端差异写入预检与产物。不偷偷改变声音速度，不向源请求越界的帧。缓存与 `EvidenceReceipt` 同时记录视频时刻与输出帧身份，不能只用 frameIndex 比较不同帧率的结果。

**基准例子**：30 fps 的视频中，一个从 x=0 到 x=100、持续 1 秒的线性原生动画。以 60 fps 导出时，第 1 帧的采样时刻是 t=1/60，x=5/3；而不是先取整回视频第 0 帧得到 x=0。源视频仍然可以按声明的策略重复帧，但不能据此认为连续动画也应该重复。

数值规则见视频格式规范 §2。

### 9.11 冻结导出与发布

**冻结**。导出启动时冻结：视频版本、选定的 variant、全部文档 / 素材 / 代码包的版本、字体、渲染配置、输出范围和 adapter 版本。`ExportSnapshot` 还包含 `editFpsBySequence`、`outputFps`、精确的 `rangeStart` 与 `rangeDuration`、`frameCountPolicy`、采样与量化合同的版本，以及音频输出策略。导出期间用户可以继续编辑；这个导出 Job 不读取新的状态，用户改帧率也不影响它。

**预检**必须检查：缺失的媒体或字体、已失效的翻译或配音、孤立的锚点、越界的片段、未授权的网络访问、未实现的效果和不兼容的输出。

**发布**。导出写入 staging 路径；校验帧数、时长、音轨、可解码性和必要的采样截图之后，再原子发布。磁盘不足、Worker 崩溃、编码失败都不能覆盖已有的成功文件。覆盖已有的输出仍然需要明确的权限。

发布校验至少记录：逻辑范围、`frameCount`、首末 PTS、`encodedVideoDuration`、`audioDuration`、采样率和尾端差异。

**快速路径**。满足条件的纯 remux 可以不重新编码；精确的非关键帧剪切、缩放、烧字幕和复杂转场不能笼统承诺 stream copy。所选的快速路径与回退必须写入报告。只导出字幕文件完全不需要渲染视频。

**快速修正**。成片导出之后只改了少数片段时，可以只重渲受影响的区间、其余沿用上一次导出的编码结果（移植自 v2）。它依赖保留上一次导出的基线产物，基线放在哪里、何时清理待定（§14）；优先级低于渲染核心的移植。

**尾端政策**。精确的 10 秒范围以 30000/1001 fps 做 `cover-range` 导出，得到 300 帧、10.010 秒的视觉尾端：这是已声明的政策，不得声称容器的所有轨严格等于 10.000 秒。`exact-grid` 则在启动前拒绝。改帧率不是补帧、去重、变速或自动拉伸声音的授权。

**这个版本的实现**（字幕、文稿与音频；命令与协议规范 §4.4）。导出是 JobManager 里的 `export` 任务，与模型任务共用账本、取消与重启后的查询，不经过模型与 Worker：

- 冻结：`exports.create` 用一次引擎请求（`exports.plan`）在同一个视频版本上算出全部范围的计划——时间线换算（剪切、变速、作用实例）在 Rust 里做完，Runtime 只按计划写文件、拼 ffmpeg 的滤镜图。计划、文档与素材的版本、链接素材的位置与摘要、目标目录与文件名存成 `ExportSnapshot` 产物，任务记录引用它。音频与成片的声音来源（§9.13）先换成实例的选择 `audioItems`（停用哪些实例、取消哪些实例的静音），随同一个请求交给引擎，只作用在这一次的声音计划上；成片的画面计划与冻结给 Worker 的序列不受影响。`audioItems` 只接受这两种。成片另外冻结的内容见下面的「成片的实现」。
- 预检在提交时完成，不通过就不建任务：素材缺失、链接素材的内容摘要与登记的不符（`ASSET_CHANGED`，执行前文件的长度或修改时间变了再核对一次）、空范围、没有可导出的文字、目标目录不可写或指定的文件已存在、缺 ffmpeg。
- 生成在任务的 staging 里，每个文件各自校验（字幕与文稿重新解析、核对条数与时间；音频用 ffprobe 解码，时长在容差内：WAV 0.01 秒、有损 0.1 秒），校验通过的才发布。发布先复制进目标目录里的隐藏临时文件，再硬链接到最终的名字：名字已存在时链接失败，不会覆盖别人的文件，也不会有写了一半的文件出现；不支持硬链接的卷退回「确认不存在再改名」（§14）。发布开始之后不再响应取消，已经发布的文件就是结果；之前取消的清掉 staging，不留文件。进程被强杀留下的隐藏临时文件由下次启动时的残留清理删掉（§5.8）。
- 音频的混音与预览同一套声音语义：增益、音量包络、静音、淡入淡出、恒定变速（`atempo`，变速不变调，与预览的播放速率一致）、转场的声音交叉淡化与闪避。`render-graph` 的 `audio_plan` 把逐帧计划的声音按区间写出来：交叉淡化给两侧各挂一条等功率曲线，并在实例区间之外补上取 handles 的段；音量包络由 `render-graph::envelope` 求值（取代 `volume`，带缓动的段按 v2 `volume_curve` 以 0.02 秒烘焙成折线），逐帧计划取这一刻的值，区间计划把同一条折线换到范围的时钟写进段的 `envelope`，段的 `gainDb` 记 0；闪避用 `ducking.rs` 同一份包络展开成折点，按文稿触发的闪避的有效词流由 `audio_plan::speech_activity` 投出，导出（`exports.plan`）与预览（把转写送进 WASM 的逐帧计划）交给它的是同一批转写。Runtime 把包络、淡变、交叉淡化与闪避乘成一个逐样本的振幅表达式（`aeval`，折线按二分嵌套的 `if` 选区间），任一时刻的增益与帧计划的 `gainDb` 相同（`render-graph` 的测试逐时刻对照两份计划）。混音的滤镜图写进 staging 里的文件交给 ffmpeg（7.0 起是 `-/filter_complex <文件>`，更早的版本是 `-filter_complex_script`，按 `ffmpeg -h long` 的说明挑），不放在命令行上：烘焙得很密的包络与闪避能让它超过单个参数或整条命令行的长度上限。预览按刷新节拍改音量、导出逐样本施加，是采样上的差别，不报告。与预览不一致的地方写进任务的 warnings：增益或包络的最高点高于 0 dB（预览最高到 0 dB）、定格不出声、交叉淡化要的 handles 超出素材（缺的部分导出为静音）。响度标准化见下文。

**成片的实现**（`video` 种类；命令与协议规范 §4.4）。冻结、预检与发布同上，画面由单独的 Render Worker 进程（`export-worker`）画：

- 冻结：`exports.plan` 对 `video` 种类另给逐帧求计划要的那部分视频（这条序列与它引用的素材记录）、每段的画面概览与声音计划，以及字幕要读的文档（字幕文档与样式文档）的冻结正文；序列上有写了 `speaker` 的声波、视频里又有转写时还给各说话人在序列上说话的区间（`speakers`）；还有输出尺寸与画面在其中的位置（`output`，`render_graph::video_plan::output_geometry`，规则见命令与协议规范 §4.4）。带 `skipAssets` 时不冻结素材（`assets` 为空，不查文件在不在、变没变），只给清点字体用（§9.1）；导出不带。Worker 按 `t_k = start + k / 输出帧率` 逐帧调用 `render-graph` 的同一个帧计划（输出帧率与编辑帧率不同时按输出帧的精确时刻取，§9.10）。Worker 读的是 Runtime 写进 staging 的冻结输入文件，导出期间的编辑不影响它（AT-25）。
- 预检在提交时由 Worker 跑一次（`preflight`），不通过就不建任务：画不出来的内容逐项列出（`EXPORT_UNSUPPORTED_CONTENT`，`details.items` 每项是实例、粒度、层的种类、原因与说明）；素材用 ffprobe 确认解得出画面；缺编码器时 `EXPORT_TOOL_MISSING`。`onUnsupported: 'skip'` 时这些项改成任务警告（`EXPORT_CONTENT_SKIPPED`），整层不画、跳过那个效果或转场按硬切。
- 输出的宽高比与画布不同（宽高都给）时，Worker 按画面那一块的尺寸画（与只改输出高度一样是整体缩放，排版不重排），逐行贴进不透明黑底的输出帧再交给编码；SVG 光栅的长边也按那一块。与画布同比例时直接交出渲染结果，不多一次复制。
- 画面：每个视频实例一条 ffmpeg 顺序解码流（原始 RGBA 经管道读出，帧时刻来自 `showinfo`，取不晚于目标时刻的最后一帧，与预览的媒体元素一致），倒退或向前跳得远时重开；图片解一次；SVG 与 GIF 由帧光栅从素材字节画（SVG 按输出的长边光栅，GIF 按时刻取帧；§9.1，与预览同一份，解不开是 `asset-undecodable`）。合成结果经管道交给 ffmpeg 编码：MP4 是 H.264（缺省）或 HEVC 加 AAC，WebM 是 VP9 加 Opus；质量是 CRF 或目标码率。声音用音频导出的混音，最后与画面封装在一起。 源编码不按输出编码的可选值筛选：本机 FFmpeg 可解码的 SDR VP8、VP9、AV1 素材（包括 MP4、WebM 与 Opus / Vorbis 音轨）可按缺省 MP4 配置导出，不必先改写源文件；没有剪辑的整片也走同一条解码与合成链。
- Worker 的位置：环境变量 `BAOCUT_EXPORT_WORKER`；不设时用 `engine-host` 旁边（同一目录）的 `export-worker`；再找不到时与 `engine-host` 一样在 cargo 产物目录里找（`CARGO_TARGET_DIR`、`.cargo/config*.toml` 的 `build.target-dir`、仓库里的 `target/`，`release` 先于 `debug`）。每次导出时现找；找不到时成片导出与开了响度标准化的音频导出以 `EXPORT_TOOL_MISSING` 拒绝，其他导出不受影响。提交之后、任务里再启动时 Worker 不见了，任务以 `EXPORT_TOOL_MISSING` 失败，`missing` 为 `export-worker`、补救说的是构建或指定 Worker（按启动失败的是哪个工具给，不笼统叫人装 ffmpeg）。`npm run build:engine` 同时构建两者。
- 进度以帧计（`progress.unit: 'frames'`）。取消经 stdin 通知 Worker（或 stdin 关闭，Runtime 退出时也是这样），Worker 停下解码与编码进程再退出，staging 整个删掉。Worker 崩溃只让这个任务失败（`EXPORT_RENDER_FAILED`），不影响 Runtime。POSIX 上 Worker 自成一个进程组，它启动的 ffmpeg 都在组里；Worker 没有正常结束（崩溃、被强杀、取消超时）时，Runtime 先杀掉整个组、再删 staging，ffmpeg 不会留成孤儿，也不会在 staging 删掉之后还往里写。
- 发布前用 ffprobe 校验：两条流都在、帧数与期望相差不超过一帧、尺寸、帧率、编码与画面时长（容差一帧）、声音时长与画面等长（另加 50 ms 的编码器补齐）。
- 画面由 `frame-render` 画，与预览同一份实现（§9.1 的现状列了画得出来的与待补的）；画不出来的内容在预检里逐项列出，原因与预览报的相同。内核的提示是 `EXPORT_RENDER_NOTE` 警告，`detail` 写实例 ID 与提示。
- **字体**。先用随渲染内核发布的字体（`render-raster/assets/fonts`，与预览同一套）；样式指名的族不在这套里时用本机字体，按 face 冻结，与素材一样记位置与摘要：预检时 Render Worker 把范围里出现的每个画面层（每个实例按第一次出现的样子，字幕排全部句子，不画视频、图片、Lottie 与声波）用随内核的字体排一遍字，报出点了名、随内核的字体里没有的「族名、字重、斜体」；Runtime 经引擎的 `fonts.resolve` 在本机挑好 face（§9.1，与预览同一份解析与抽法），把所在文件、文件里第几个与整个文件的 `sha256` 摘要和字节数记进冻结快照（`ExportSnapshot.fonts`，几个 face 共用一个字体集合时只算一次摘要），找不到的记 `fallback`。按需下载的字体（§9.1）：下载缓存里已有的照样记文件（`source: 'downloaded'`）；字体目录里有、还没下载的记 `download`，导出任务开始画之前在任务里下载（阶段 `downloading`，进度按字节，取消随导出），下载好的按同样的写法冻结进这次渲染、钉住到任务结束；`fonts.autoDownload` 关着、严格离线或下载失败时记 `fallback: 'not-downloaded'`，照回退字体画、警告 `FONT_NOT_DOWNLOADED` 说明原因（`font` 带族、字重、斜体、回退族与原因），不拒绝导出，也不要用户先选替代字体（产品设计 §12 已定）。导出面板在导出前按 `fonts.usage` 提示还在下载（导出先等）、下载失败（用回退字体代替，可重试）与没下载的族（自动下载开着时导出开始先下载，关着时用回退字体导出，可以现在下载）；阶段 `downloading` 时念「下载字体 · 族 百分比」；完成后按 `FONT_NOT_DOWNLOADED` 列出族 → 回退字体 · 原因。执行时 Worker 在画第一帧之前按摘要核对这些文件、只抽出记下的 face 装进渲染器，之后不再去本机找：文件不见了或变了，整个任务以 `FONT_MISSING`（「字体无法复现」）失败，成片不悄悄换成别的字体；冻结时就没找到的族照回退规则画、结果里有提示。引擎宿主开着时新装的字体：有找不到的 face、而字体目录在扫过之后变过时重扫一遍再答。哪里都没有时按内核的回退规则画（缺字整段换同一款回退字体，思源黑体兜底），文字元素与字幕都报缺字体的提示。塑形、折行与双向文字都在内核里（cosmic-text），与预览相同。

与预览的差异只剩取画面的来源：预览的视频帧从媒体元素读出（按铺满输出缩小后送进 WASM，播放中允许偏一点），导出按输出帧的精确时刻解码；SVG 预览由浏览器解码，导出用 `render-raster` 光栅。其余（排版、转场、效果、字幕、认不出的样式）两边是同一份代码。

**证据**。视频卡上导出的那一行（产品设计 §3.2.2）引用 `EvidenceReceipt` 和经过发布校验的导出 Artifact，分别显示视频版本、检查方法、采样范围与渲染路线。文件的媒体检查与抽样的视觉检查是不同的覆盖，不互相冒充。源码复用、同名的渲染入口或几张相似的截图，都不是跨设备像素一致的证明。

### 9.12 可观测性能

分别记录 queue / setup / decode / seek / draw / capture / transfer / compose / audio / encode / mux 的耗时、缓存命中、峰值 RSS、可获得的显存信息和回退原因。用数据定位瓶颈，不把所有的慢都归因于浏览器。

在冻结的环境中检验：帧时间、独立的随机 seek 与顺序渲染、单 Worker 与多 Worker、透明边缘、音画时长。跨环境只能给出定义过的容差等级，不默认逐 byte 相同。

### 9.13 导出的种类

冻结、预检与发布（§9.11）适用于所有种类的导出。种类之间的差别只在输出什么：

| 种类 | 输出 | 说明 |
| --- | --- | --- |
| 视频文件 | 一个视频文件 | 画面、所选的字幕轨与元素烧入；导出时的轨道开关只对这次导出生效，不改视频。已实现：MP4（H.264 / HEVC + AAC）与 WebM（VP9 + Opus），输出宽高（比例与画布不同时加黑边）、帧率、CRF 或码率、范围与是否烧字幕是参数；画不出来的内容默认拒绝并逐项列出（§9.11 的「成片的实现」） |
| 音频 | WAV、MP3 或 M4A | 只走声音的渲染路径，不渲染画面；可以选成品混音、只要原声或只要某一组配音（`source`：`mix`、`original`、`{ dubGroupId }`）。都已实现，采样率、声道、码率与响度标准化是参数。来源只改这一次导出的声音计划，不改视频：「只要原声」停用带 `baocut.dub` 标记的实例（配音与分离出的背景声、人声），并取消这条序列上各配音计划记下的 `mutedItemIds` 的静音；配音加的闪避随触发的实例一起失效。「只要某组配音」只留这一组的配音实例，其余的实例全部停用；序列上没有这一组时以 `DUB_GROUP_NOT_FOUND` 拒绝。视频文件的导出接受同样的 `source`，只换成片的声音，画面照旧 |
| 字幕与文稿 | SRT、VTT、ASS、带词时间的 JSON；Markdown 或纯文本 | 不渲染视频（§9.11 的快速路径）；双语合并、章节小标题与时间码是导出参数。已实现：时间是时间线时间，剪掉的词不出现；一行的宽度（全角算 2）与每条最多两行、最长 7 秒，长句在词之间拆开；双语按句配译文（译文 `baocut.translation/2` 按 `sourceSentenceId` 与它的词成员配，转写没有存句子时也按这些成员切句；旧项目导入的 `/1` 按句子 ID 配；被剪得不完整的句子与过期的单元不配，视频格式规范 §5.3）或按时间配另一种语言的字幕；ASS 做基础的样式映射，表达不了的样式写进 warnings；逐词时间只在全部可信时写出（AT-05）；文稿（Markdown、纯文本）按段落写，分段与编辑器的文稿面板同一套规则（`TRANSCRIPT_PARAGRAPH`：标了段首、换了说话人、停顿 2 秒以上时断，句末处这段满 240 字、或停顿 0.6 秒以上且满 60 字时也断），开着说话人时每段段首都写（只有一位也写，冒号固定半角）；可选段末时间码、按序列上章节标记写的章节小标题、Markdown 的文首元信息，以及不跳过剪掉的部分（剪之前的原文、素材时间），写法见命令与协议规范 §4.4 |
| 工程 | 其他剪辑软件的工程文件 | 见下。已实现：Final Cut Pro 7 XML（`xmeml`），一条序列 |
| 便携包 | 一个 `.baocut` 文件 | 已实现，§5.8 |

- **字幕与文稿的正文预览**。`exports.renderText` 不写文件、不建任务，按与 `exports.create` 相同的冻结、预检与写法排出字幕或文稿的正文（命令与协议规范 §4.4），与同样设置导出的文件逐字节相同；界面导出面板的文稿页拿它显示预览、复制全文。
- **范围**。整片、若干章节、若干片段或自定义的入出点。不相邻的选择可以接成一个文件，也可以各出一个文件；后者是一个导出 Job 的多个产物，各自校验、各自发布，部分失败如实报告。
- **用途**。所有种类的 `ExportSettings` 接受 `purpose: 'deliverable' | 'preview'`，省略按 `deliverable`。`preview` 仅用于智能体内部检查，不进入会话视频卡及会话产物列表与计数；后台任务与导出文件保留。用途随设置冻结、存入快照与 Job 记录，不改变渲染、校验或发布。用户要求的预览、短片与分段是交付，不按文件名、范围或时长自动改成内部检查；未标记的历史记录保持交付语义。
- **多语言声音**。有多组配音时，视频导出可以只混入选定的一种语言，也可以每种语言各写一条音轨并标注语言。每条音轨各自混音、各自校验时长。
- **响度标准化**是音频输出策略的一部分，冻结在 `ExportSnapshot` 里：目标积分响度（−70 到 0 LUFS，默认 −16）与真峰值上限（−20 到 0 dBTP，默认 −1.2）。它在最终混音之后做，属于导出而不是视频的修改；默认关闭，关闭时按视频里的混音原样导出。音频导出与成片的声音同一条链，是 v2 的母带（`audio-dsp`）：BS.1770 积分响度归一（静音或不足 400 ms 时不动）与真峰值限幅（上限是目标减 0.1 dB）交替三轮，最后按 4 倍过采样的真峰值静态兜底到上限以下、夹到 [−1, 1]。它是确定的：Render Worker 的 `master` 子命令按 4 秒的窗口流式处理（中间结果落在任务的 staging），结果与对整段一次算逐位相同；超越函数只走 libm，同一份混音在各平台得到逐位相同的样本。按输出的采样率与声道数算，单声道按一个声道测响度（与 ffmpeg `ebur128` 相同）。母带前与母带后的积分响度、母带后的真峰值和各轮静态增益之和写入发布校验；测不出响度（例如全静音）时只做真峰值兜底，并提醒（`LOUDNESS_NOT_MEASURABLE`）。
- **用哪台机器导出**。导出默认在本机执行。交给局域网节点导出需要把冻结的输入整体送过去，超出了节点「只共享能力，不共享视频」的边界（§6.7），是否提供待定（§14）。

**工程导出**把视频的时间线换成其他剪辑软件能打开的工程（例如剪映草稿、Final Cut 与 Premiere 的 XML）。它是单向的、有损的交换，不是渲染：

- 只导出目标格式能表达的对象：片段的入出点与位置、音轨、字幕文本与时间、基础的变换。目标格式表达不了的对象（代码画面、模板、逐词动效等）要么先渲染成媒体文件再作为素材引用，要么略去；每一项的处理写入导出报告，不静默丢弃。
- 素材按引用或拷贝两种方式之一写出，由用户选择；工程里的路径必须在目标机器上可解析。
- 导出的工程不能再导回 BaoCut 成为同一个视频。

已实现的是最基础的一种：`{ kind: 'project', format: 'xmeml', sequenceId? }`，把一条序列（默认主序列）写成 Final Cut Pro 7 XML（xmeml v5），Premiere Pro 与 DaVinci Resolve 能导入，文件名是「视频名.xmeml.xml」。

- 写出的：序列的帧率与画幅；画面轨（按 `order` 从下到上）上视频与图片实例的位置与入出点，有预渲染替身的合成按替身写出；声音轨上的音频实例，以及视频实例自带的声音（另起声音轨）；停用与静音的实例和轨道照样标出。
- 素材只按引用写出：链接素材写它的本机路径，收进视频的写 `blobs/` 里的路径（`file://localhost/` 加逐段编码的绝对路径）。工程文件因此只在这台机器上、素材还在原处时能直接打开。
- 表达不了的逐项写成任务警告 `PROJECT_ITEM_OMITTED`（文字、图形、字幕、没有替身的合成、转场、效果、裁剪、不铺满画布的变换、不透明度、增益与淡入淡出、变速与定格、读不到的素材），警告里写实例的 ID 与名字。序列上没有能写出的片段时以 `EXPORT_NOTHING_TO_EXPORT` 拒绝；给的序列不存在时以 `EXPORT_SOURCE_NOT_FOUND` 拒绝。
- 拷贝式、FCPXML 与剪映草稿、先渲染成媒体再引用，推迟（§14）。Space 里工程文件与便携包同属「包」这一种类（`package`）。

---

## 10. 依赖更新与最小改动

每个派生产物都记录输入的指纹。「移动了但内容没变」与「内容变了但 ID 没变」分别判断；不能只有一个粗糙的 `videoDirty` 标志。

### 10.1 修改影响表

| 修改 | 立即更新 | 标为过期或重新验证 | 保持复用 |
| --- | --- | --- | --- |
| 字幕颜色、字号 | 字幕布局或样式 | 新布局的阅读与安全区检查 | 语音识别、自然译文、语音合成、未变的代码动画 |
| 原文错字 | SpeechDocument 版本、有效句的指纹 | 相应的译句、对齐、配音 | 未涉及的句子与源视频 bytes |
| 源字幕换行 | 用户 pin、原文的 Cue 与 Line | 显示检查 | 自然译文、目标语言的声学对齐 |
| 自然译句 | TranslationUnit 版本 | 目标块、显示改写、关联的配音 | 原转录、未关联的语言 |
| 只改配音脚本 | DubbingUnit 版本 | 该单元的音频、对齐、响应声音的动画 | 未变的自然译句与视觉元素 |
| 平移完整的口播句 | 片段位置、字幕与语义锚的投影 | 句间节奏与覆盖物 | 完整句的文本与译文内容 |
| 句内删词 | 编辑语音视图、片段与 lineage | 翻译、配音、语义块、句锚 | 原始的完整转录 |
| 平移代码实例 | `fromFrame`、外部合成 | 依赖主时间或外部 cue 的包需要检查 | 只依赖 localTime 的已渲染图像 |
| 代码参数 | 实例参数 | 与参数相关的代码缓存 | 其他实例、原音频 |
| 代码的共享函数或字体 | 新的代码包版本 | 保守失效全部本地范围 | 未引用该包的原生内容 |
| 源媒体 bytes 改变 | 新的 AssetRevision | 对齐、代理、转录、全部依赖 | 与旧版本绑定的历史与冻结任务 |
| 转场 | 转场对象 | 窗口里两侧实例的帧；`audioCrossfade` 时窗口里的混音 | 窗口之外的帧、其他实例 |
| 效果栈或裁剪 | 实例的效果栈或 `crop` | 这个实例出现的帧，包括以它为一侧的转场窗口 | 源媒体与解码缓存、其他实例 |
| 闪避规则，或移动、裁切触发它的实例 | 规则、实例位置 | 目标组在新旧触发区间（前后加 attack、release）里的混音 | 全部画面、触发组自己的声音 |
| 章节 | 章节标记 | 导出的章节信息 | 全部画面与声音 |

### 10.2 两种影响不能混同

`ImpactReport` 同时表达 `semanticChanges`、`retimeOnly`、`staleDependencies`、`renderInvalidation` 和 `preservedRefs`。

- 只改一处可能导致整段代码重新渲染，但不能因此重新设计整片。
- 反过来，ID 没变而内容指纹变了，语义依赖仍然必须过期。
- 用户意图的范围与渲染失效的范围始终分开：为了渲染正确而让整段缓存失效，不等于获得了重写整段创作内容的授权。

每份 TranslationUnit、DubbingUnit 和图表锚都绑定到有效词视图或明确的源。失效不删除旧结果，而是给出审阅、重做或保留为候选的入口。尚未开放自动修复的功能也必须显示 `stale` / `orphaned` / `needs-fit`；严格导出检查出的内容阻断项不能被忽略。

### 10.3 保护用户的手工修改

人工 pin、手动构图、已确认的术语、选用的声音和禁改范围都是视频事实。自动排版、生成修复和源内容替换不得悄悄恢复模型的旧值。

替换素材的影响按选中的实例计算；同一媒体的其他 occurrence 保持不变，除非用户明确要求批量更新。

用户接受警告之后，接受记录绑定到当时的输入指纹与视频版本。相关依赖变化之后重新检查；一次历史上的同意不是永久豁免。转录换用文稿的手工修改闸门（§6.6，`acceptEdited`）是它的一例。

### 10.4 场景与声音的依赖规则

| 修改 | 必须更新或失效 | 可以复用的前提 |
| --- | --- | --- |
| 移动 `local-only` 的场景 | 外部合成的位置与时间 | 内部参数、素材、环境与背景输入都没变 |
| 移动依赖 placement 的场景 | 冻结的 placementContext、内部求帧缓存 | 只有不依赖该上下文的独立部分可以复用 |
| 更新外部 cue 表 | 读取该 `cueRef` 的动画与声音编译 | 其余明确无依赖的场景不变 |
| 替换选中场景的源码 | 新的代码包引用、参数兼容性与相应缓存 | `itemId`、lineage 与未触及的用户属性保留 |
| 手动拖动一个音效 | 对应的 AudioItem 与 pin / override | 相同的素材 bytes 及其他 cue 实例保留 |
| 重新编译 SoundCueSheet | 未 pin 的相关实例、孤立锚检查 | 已确认的手工修改不被全量覆盖 |

### 10.5 编辑帧率与输出帧率的失效范围

| 修改 | 必须更新或检查 | 应当保留 |
| --- | --- | --- |
| 只改 `ExportSettings.fps` | 输出采样计划、帧数与尾端、编码缓存、质量证据 | 视频版本、源媒体、转录与译文、语音合成结果、声音速度 |
| `changeSequenceFrameRate`，`preserve=time` | FrameSpan、视觉关键帧与转场、音频的粗帧余数、投影与量化影响 | 精确的音频与词时间、源 AssetRevision、未改的代码包 |
| 请求同一个实际的局部时刻 | 校验全部传递依赖与采样合同 | 依赖相同的源码帧缓存可以复用 |
| 更改代码包的作者帧率 | 新的代码包版本、参数与时长的兼容性、实例换版与缓存 | 仍然引用旧代码包的其他实例与旧导出 |

只设置导出帧率不需要重译或重新配音。代码如果真实依赖输出采样的步数，这个依赖必须显式冻结，不能错误地复用缓存。

---

## 11. 客户端架构

### 11.1 Renderer 的职责

Renderer 用 React 实现界面，持有的权威状态只有界面状态：拖拽、选区、播放头、草稿、面板布局。视频数据是只读投影（Replica），所有修改经 `@baocut/client` 提交给 Runtime。

界面组件用 React Spectrum 2（`@react-spectrum/s2`）；样式经它的 `style` 宏在构建时生成，产品自己的布局与颜色也用同一套设计令牌。

客户端状态用 Zustand，按职责分成几个 store：

| Store | 内容 | 来源 |
| --- | --- | --- |
| connection | 连接状态、Runtime 信息、Driver 能力快照（各 Driver 最近一次的探测结果与首次探测中的 Driver） | 客户端连接事件、`agents` 主题的快照与 `agents.updated`（`agents.list` 同一份视图） |
| directory | 项目与会话的列表投影 | `directory` 主题的快照与增量 |
| timeline | 会话内容，按会话 ID 存放 | `conversation:<id>` 主题的快照与增量 |
| shell | 导航、侧栏宽度与展开状态、按会话保存的草稿、访问模式与功能区标签 | 只在本机；除当前页面外都持久化到 localStorage |

- Runtime 推来的快照整体替换镜像，增量经 `@baocut/client` 的纯函数归约；未变化的条目保持同一引用。
- store 不直接发请求。请求、订阅与重连由一个 `RuntimeSession` 负责：它持有 `BaoCutClient`，把主题事件写进 store，组件经 React Context 拿到它来提交命令。
- 主进程不转发业务请求：Renderer 经 preload 取得 Runtime 的地址与令牌，直接连 WebSocket；preload 另外只提供选目录、在文件夹中显示这类原生能力。输入框的统一附件选择器只返回系统对话框刚选中的文件或目录：目录不递归读取，普通文件只带本机路径；Agent 支持附图时，主进程按消息附件的格式、大小与张数上限读取图片字节，Renderer 继续经 `attachments.prepare` 与一次性上传地址把它交给 Runtime。非图片引用按会话草稿保存，发送时把路径逐行加引号附入正文；发送失败保留草稿，成功后清掉本次发出的引用。

Rust 的纯语义模块编译成 WASM，在 Renderer 中做交互预测（例如拖动时的吸附、量化结果预览）。预测结果在收到回执后以回执为准。

### 11.2 外壳：Rail、Home 与 Space

```text
App Shell
  ├─ Rail（一级：Home / Space / 工具；二级：服务 / 后台任务；底部：设置；归属原则见产品设计 §2.1）
  ├─ Home Surface
  │    ├─ Sidebar：conversations + projects 的列表投影
  │    ├─ Conversation：ConversationProjector 的卡片投影 + Composer
  │    └─ Panel：编辑器组件 + 产物查看器 + 任务详情
  └─ Space Surface
       ├─ Catalog：SpaceEntry 的列表投影
       ├─ Viewers：按 kind 的查看器
       └─ Editor：左侧会话 + 编辑器组件（与 Home 的 Panel 相同）
```

- Home 与 Space 是同一个应用外壳里的两个界面，共用一条到 Runtime 的连接和同一组客户端存储。
- **视频 Replica 按 `videoId` 共享**。同一个视频同时出现在 Home 的功能区和 Space 的编辑器里时，两处读的是同一份投影，订阅同一条视频事件流；一处提交的修改，另一处按事件更新。
- **编辑器组件只有一套，布局也只有一种**。Home 的功能区与 Space 打开视频时都是会话在左、完整编辑器在右；选区、播放位置与未提交的草稿按 `videoId` 保存，在两个入口之间切换时保持。
- 每个界面各自保存自己的导航状态与布局。切换界面不取消订阅正在运行的任务。
- 多个窗口各有自己的 Renderer 与界面状态，连接同一个 Runtime。

**功能区的标签页**。智能体会产生各种格式的文件，也需要用户查看网页，所以功能区按标签打开四类内容：视频（编辑器）、文件查看器、项目文件浏览与网页。标签的集合与顺序按会话保存在界面状态里。

- **项目文件浏览**读取 `projects.files.list` 与 `projects.files.read`：只读，路径限定在该会话所属项目的目录之内，解析符号链接后仍须在目录内，否则拒绝；不属于任何项目的会话限定在它自己的工作目录。文件内容经媒体通道的受控句柄取得（§5.6），按实际内容选择查看器：未知后缀的文本仍可阅读，不支持的二进制显示基本信息与「在文件夹中显示」；不存在与读取失败另行报告。
- **新建网页**（新标签页起始页的工具卡）调用 `projects.files.create`：根目录与项目文件浏览相同（也可直接按 `projectId` 指定项目目录）；`dir` 解析符号链接后仍须在根目录内，且不在隐藏、依赖或视频目录里；文件名只取最后一段，拒绝空名、`.`、`..` 与以 `.` 开头的名字；以独占方式创建，不覆盖已有文件，重名时依次改为「名字 2.扩展名」「名字 3.扩展名」。属于项目时返回按项目的定位，与项目文件里打开的是同一个标签。
- **网页标签**的安全要求见 §12.10。

界面设计见产品设计 §2–§5。

### 11.3 会话投影

`ConversationProjector` 把 Driver 事件投影成线程条目（消息、推理、工具步骤、审批）；Task 条目由 Harness 在收发消息时写入，视频回执（`video-created`、`video-change`）由工具落到会话里。Job 记录不投影成条目：要显示的卡片由客户端按下面的规则从记录推出（产品设计 §6.5）。

- 卡片状态来自事件与回执，不来自模型的自然语言。
- 卡片保存的是稳定引用（`taskId`、`jobId`、`artifactRef`、`receiptId`、`candidateRef`）；点击时由功能区按引用打开对应的视图。
- 流式文本可以合并小块；终态与权限事件不可丢失。Runtime 在发出 `item.append` 前按条目与字段合并窗口（默认 60 ms）内的文本增量：窗口开头的第一块立即发出，之后到达的攒到窗口结束再发一条；发出同一会话的任何其他事件、答复 `conversations.get` 与落盘之前，先把攒着的增量发出去，记录里的 `seq` 与文本同一水位。
- 线程里的视频卡与下载卡（产品设计 §3.2.2）服务端不做卡片投影：客户端从智能体提交的 Job 记录（`submitter.kind === 'agent'`，`submitter.taskId` 把 Job 连到会话里引用它的消息；一部视频一张卡，挂在最后的引用之后，Job 还没结束时按 `endedAt` 比之后回合的开始时刻跟到更晚的回合；固定流程的步骤是 `parentJobId` 指向父任务、`submitter.kind === 'pipeline'` 的子记录）加会话里的 `video-created` / `video-change` 回执推出。`video-created` 记视频 ID、名字、打开编辑器的位置（与变更卡的 `target` 同一个写法）与新建时的版本，只记智能体经 `videos_create` 新建的视频；固定流程（从链接导入、转录的 `target.create`）新建的视频不另记，看父任务记录的 `videoId`：视频一建出来（导入媒体之前）就写进父任务并落盘，随 `jobs` 主题推给客户端（§7.9）。
- 侧栏的状态徽标由会话的活动 Task 状态汇总得到。

### 11.4 索引化的 Replica

Renderer 为权威投影建立可重建的索引：`itemsByTrackId`、时间区间索引、词与句的 occurrence 索引、选区查找表。它们是只读的派生结构，不增加任何视频写入权。

组件按需要的 ID 与字段订阅。一条字幕的变化不应迫使整条时间线和整段文稿重绘。

在 Zustand 里，这意味着：store 按 ID 存放（`byConversationId`、以后的 `byVideoId`），组件用 selector 只取自己需要的那一条或那几个字段；索引、分组、侧栏汇总这类派生是输入不变就结果不变的纯函数，在组件里按需计算并缓存，不写回 store。

验证的是更新粒度、事件一致性与交互预算；Zustand 只是实现这些约束的工具，换掉它不应改变 Replica 的语义。

### 11.5 可见窗口

时间线、字幕文稿、波形和缩略图使用「可见窗口 + 预留区」的虚拟化。缩放、横向滚动和后台事件按帧预算分批处理。预算与窗口大小按设备实测确定。

- 资源加载可以提前预取。
- 虚拟化不能丢失键盘焦点、输入法状态、辅助功能语义或正在进行的手势。
- 选中的对象滚出屏幕之后仍然有逻辑身份；回到可见区时不重新提交编辑。
- **没有挂载的实例同样参与导出、冲突与依赖计算。** DOM 不是视频数据的全部。

实现约束（字幕列表、译文列表、文稿面板与时间线）：

- 纵向列表（字幕、译文、文稿）只挂视口前后各一屏的行，其余折成占高度的空白段；行留在正常文档流里，DOM 次序等于行的次序，Tab 顺序与读屏顺序因此不变。行外层不带外边距，行上标 `aria-setsize` 与 `aria-posinset`。时间线轨道少，不做纵向虚拟化，只按可见时间窗（左右各多一屏）横向裁剪片段、配音块、剪口带与刻度。
- 有状态的行或件不管在不在窗口里都挂着：正在编辑的、查找命中的、焦点所在的（纵向列表连同前后各一行）、菜单或行内输入框开着的、选区两端所在的、正在拖动或做了指针捕获的。卸掉它们会丢掉没提交的文字、输入法组字、焦点或手势。选中状态存在 store 里，不需要钉住。
- 依赖 DOM 的行为（播放跟随、查找跳转、键盘定位）一律先按 model 算出下标或时间，滚到那里，等目标挂上后再在行内对准；不在 DOM 里查找可能没挂上的元素。
- 行高按行的 key 缓存实际量到的高，没量过的按内容估计；容器内容宽度或显示视图变了，没挂着的行的旧高作废。浏览器自带的滚动锚定关闭，视口上方的行量出与估计不同的高时手动补偿 scrollTop。
- 列表自己写入的滚动（锚点补偿、滚到某行后的修正）不能被当成用户滚动。播放跟随只把滚轮、触摸拖动与按在滚动条上当作用户滚开。
- 正确性不依赖 `requestAnimationFrame`（窗口在后台时它不触发）：测量走 ResizeObserver 回调与布局阶段的同步读取，可见范围在滚动与尺寸变化时当场重算。
- 由文档派生的投影（段落行表、字幕在序列上的位置、阅读速度）按文档版本缓存在组件之外，面板重新挂载时不重算。

### 11.6 高频状态与低频文档分离

播放头、悬停和拖拽的临时层独立于低频的文档版本更新。播放时不触发文档级的重新渲染；文档版本变化时不重置播放状态。

Space 的列表同样虚拟化；缩略图（`space.thumbnail`）只为可见的卡片与行请求，同时在途的请求有上限，滚出去的不再等；预览经媒体通道按需加载。

### 11.7 时间显示

显示用的秒与时码、精修用的视频帧，读的是同一个权威位置。屏幕上的截断与补零只影响呈现；复制与提交使用精确值。界面行为见产品设计 §5.8。

---

## 12. 安全与隔离

### 12.1 桌面外壳

Electron Renderer 关闭 Node integration，启用 context isolation 与 sandbox。preload 只暴露桌面所需的最小能力。

### 12.2 本机连接

本机的 WebSocket 仍然需要认证、Origin 校验与作用域校验。媒体通道的句柄限定到视频、素材版本和使用方（§5.6）。

### 12.3 视频写入权

Engine Host 只接受 Runtime 的私有授权通道。智能体进程、模型进程和代码 Worker 不获得 VideoStore 的路径与写权限。

### 12.4 不可信的执行面

代码的构建、依赖安装与渲染都是不可信的执行面。不能只因为代码在一个 iframe 里画图就宣称安全。

- 已发布代码包的清单声明 `permissions.network: 'deny'` 与允许访问的素材 ID；运行环境必须实际强制这些限制。
- 文件中的字幕、网页、元数据、代码注释与 README 是任务材料，不是指令，也不扩大权限。
- 拥有与用户相同的广泛 shell 权限的可信开发模式存在旁路风险；工具白名单与提示词都不能提供强文件隔离。
- **系统无法满足沙箱要求时，拒绝不可信执行，或显式切换到受信模式并停止声称强隔离。** 不静默降级成全权限之后继续称为安全。

进程隔离是稳定性边界，不自动构成安全沙箱。

### 12.5 授权（Grant）

```ts
interface Grant {
  grantId: Id;
  dataKinds: Array<'transcript' | 'frames' | 'audio' | 'video' | 'document' | 'context'>;
  recipient: string;                  // 接收方：Provider（openai、custom:<名字>、agent:codex…）
  scope: { videoId: Id | null };      // null 为全部视频
  purpose: string;
  budgetMode: 'estimate-cap' | 'per-call-unknown-cost' | 'free-local';
  budgetCap: { amount: string; currency: string } | null;
  maxCalls: number | null;
  expiresAt: string | null;
  generation: number;
  taskId: Id | null;
  once: boolean;                      // 「只这一次」
  origin: 'user' | 'approval' | 'provider-enable';
  approvalId: Id | null;
  state: 'active' | 'expired' | 'revoked' | 'exhausted';   // 读取时算出
  createdAt: string; updatedAt: string; revokedAt: string | null;
  usage: { calls: number; reservedCalls: number; amount: string | null; reservedAmount: string | null; unknownCostCalls: number };
}
```

- 批准缩略图不等于批准原视频。授权按数据种类、接收方、范围与目的逐项绑定。
- 同一任务所需的授权可以合并呈现。
- 用户撤销授权之后，禁止新的调用与自动应用；`generation` 提升使旧代的调用被拒绝。已经外发或已经计费的部分，无法只靠本地撤销抹除，界面要如实说明。
- 智能体的对话数据流与模型能力的数据流分别授权（产品设计 §7.3）。
- 接收方是 Provider，不是它的账号（§6.8）：一家 API 提供方换用哪个账号、增删账号，都不改变授权的匹配。

**存放**。Grant 与预算账本在 Runtime Home 的 `store/grants.json`（0600，临时文件加改名写入），只经 Runtime 的 `GrantService` 读写；已结束（撤销、到期、用完）的 Grant 只保留最新的 200 条，还有预留的不清。不进视频，不进 Space。

**谁需要 Grant**。在线与智能体 Provider 的调用需要，按外发的数据种类匹配：翻译配音逐句合成外发译文，是 `transcript`；音色克隆上传参考录音，是 `audio`（§5.9、§7.9）。启用 Provider 时的默认 Grant 不覆盖它们：语音合成的默认 Grant 只有 `document`，不含文字稿。已定：不放宽（§14）——配音交出的是用户的文字稿，按外发最小化要用户明确发放；第一次配音因此在提交时以 `GRANT_REQUIRED` 被拒，拒绝里说明要发哪一条授权（`remedy.commands`）与发放之后重新执行（§7.9）；本机模型（`free-local`，数据不离开这台机器）与已配对的局域网节点（用户自己的设备，配对即授权，§6.7）不需要，行为不变。`context`（智能体对话的上下文）只在模型里保留，本版还不接入 Driver。

**匹配**。一次调用外发的数据种类、接收方、视频与任务一起和 Grant 匹配：接收方相同；调用的每一种数据都在 Grant 的 `dataKinds` 里；Grant 的视频为空（全部视频）或等于调用的视频；Grant 的任务为空或等于调用的任务；没有撤销、没有到期。「只这一次」的 Grant 只被点名使用它的那一次调用匹配。多条都覆盖时依次优先只属于这个任务的、只属于这个视频的、全部视频的，同一级里取新的；额度用完的不算覆盖，换下一条。调用外发哪些数据由能力决定（转写是音频；合成、生图、文本生成是文本），调用方知道得更具体时另给（翻译流程交出的是文稿）。

**发放**。四个来源：

- 用户在设置或 CLI 里发放（`grants.create`，`baocut grants create`）；
- 审批时一并发放（§3.12）：默认「只这一次」，金额未知；选择持续时另发一条持续 Grant，它的次数上限只取用户的选择，不继承任务申请的次数。持续 Grant 有金额上限、这个模型却估不出金额时，这一次调用另用一条「只这一次」的 Grant；
- 合并的申请：智能体用 `grants_request` 一次列出这个任务要用的几项外发（每项是能力、Provider、视频、次数与用途），用户在一条 `high` 的审批里一起批准；每项发放一条只属于这个任务、次数上限是申请次数的 Grant（选择持续时按上一条）。已有覆盖或不需要授权的项不进审批；
- 启用在线或智能体 Provider 时的默认 Grant（迁移规则，§6.8）。

审批时发放的「只这一次」的 Grant，如果之后的提交被拒（参数不对、模型不可用、并发下额度被占完），这次调用没有发生，它随即撤销，不留在列表里。

**撤销、收紧与代**。`grants.revoke` 撤销之后禁止新的调用；`grants.update` 缩小数据种类或范围、降低上限、提前到期都算收紧。两者都使 `generation` 加一：之前按旧代接纳、还在排队的 Job 在开始执行时以 `GRANT_REVOKED` 失败，预留释放，数据没有交出；已经在执行的照常结束并结算（数据已经交出）。撤销的结果如实列出已经计入的调用、金额与金额未知的次数（`alreadySent`）以及正在执行的 Job，并说明这些无法靠本地撤销抹除。默认 Grant 被撤销后不会自动补发，只有重新启用 Provider 才再发放。

**记录**。Job 记录带 `grant`（`JobGrantUse`）：用的是哪条 Grant 的哪一代、外发的数据种类、预留与结算（§7.8）。`grants.usage` 列出一条 Grant 的用量与用过它的 Job。`grants` 主题推送 Grant 的变化。Grant 的管理只给桌面界面与 CLI：Web 服务的浏览器白名单不含 `grants.*` 与 `grants` 主题，MCP 服务的工具目录里没有它们，智能体只能经 `grants_request` 申请。

**Grant 与任务预算**。Grant 回答「能不能把这些数据交给这个接收方」，任务预算（§3.2、§7.8）回答「这个任务总共可以调用多少次、花多少钱」。Grant 上的 `taskId` 只限定哪些调用能匹配它（`grants_request` 与审批发放的只属于一个任务），任务预算按任务合同的 `budgetPolicyRef` 另记，跨这个任务用到的全部 Grant 合计。任务预算只收紧、不授权：没有 Grant 覆盖的调用照样要授权。任务预算由用户在任务合同里设置与修改（桌面界面与 Web 非只读都可以，它只能在 Grant 之内再收紧）；Web 只读模式只能查看，MCP 服务没有合同，智能体只能读。

预算的准入见 §7.8。

### 12.6 日志与诊断

默认不收集原视频、声音、完整字幕、提示词或密钥。产品分析以必要的事件与性能摘要为限，非必要的采集可以关闭。导出诊断之前可以预览、脱敏并显示范围。日志不记录敏感的本机路径或凭据。密钥与令牌只出现在发往供应商或节点的认证头里，以及凭据助手的 stdin 与 stdout 上（§6.8）：不进命令行参数、环境变量、日志、事件、Job 记录与错误详情。

崩溃报告先落在本机的待发送队列里，逐条由用户决定是否发送，发送前可以查看内容；「自动发送」是一个默认关闭的偏好设置。使用统计只含功能使用的计数，不含媒体、文本与路径，可以关闭。清空派生缓存是一个显式的命令，只删除可以重建的数据（§5.1）。

### 12.7 局域网节点

节点服务是唯一允许绑定非回环地址的监听面，并且只在用户开启共享时存在。它的来源门、配对与令牌规则见 §6.7；节点服务不暴露视频、会话、Space 或本机文件系统，只接受能力任务。网关、MCP 与媒体通道始终只监听回环。

### 12.8 对外服务

§4.8 的对外服务增加了 Runtime 的攻击面，统一遵守：

- **默认关闭，默认回环**。除节点服务（§12.7）外，所有对外服务只监听本机回环地址，没有改成监听其他地址的开关。
- **认证**。每个服务用自己的令牌，与本机网关的令牌无关，只经 BaoCut 的界面或 CLI 交给用户。MCP 服务与模型接口服务按客户端发放令牌（两个服务的令牌互不通用）：每个外部应用一个，`Authorization: Bearer` 携带；明文只在创建时显示一次，Runtime 只存加盐的哈希，重启后仍然有效，可以单独吊销，吊销立即生效。没有令牌或令牌不对时回答 401。带浏览器 `Origin` 的请求默认拒绝（Web 服务只接受自己的来源），防止网页经回环地址调用；`Host` 不是回环地址的请求同样拒绝，防止 DNS 重绑定。无令牌的本机连接如果提供，必须是一个显式的、有风险说明的选项；首版不提供（§14）。
- **写进宿主配置的令牌**。`baocut mcp install`（§4.8）是令牌离开 BaoCut 的界面与终端的唯一出口：能放进宿主自己的环境变量段时放那里、配置里只写引用（Claude Code）；不能时明文写进宿主的用户级配置文件（Codex、Cursor、Gemini CLI），命令的 `--help` 与结果都写明这一点，建议用 `ask` 等级，并给出吊销的命令。写配置一律读、改、原子替换：只动 `baocut` 这一项，其余键原样保留，读不懂的配置报错、不覆盖；新建的文件只给本人读写，已有文件保留原权限；已有条目不覆盖，除非 `--yes`。JSON 配置沿用原文件的缩进与换行符；Claude Code 写条目失败时把 `settings.json` 里原来的令牌放回去。每次安装是一个新客户端；替换条目时从旧令牌认出旧客户端并吊销，认不出时结果里列出同名的客户端，由用户吊销。
- **Web 服务的浏览器**。会话 cookie 是 `HttpOnly`、`SameSite=Strict`，由一次性、两分钟有效、只存哈希的访问代码换得（§4.8）。访问代码出现在链接的 fragment 与发起命令的终端里：这是「令牌只进认证头」的例外，以一次性、短时效、不进日志、URL 查询串与进程参数来约束（`--launch` 让浏览器打开不带代码的登录页，代码由用户从终端粘贴）。回环地址上的 cookie 不按端口隔离（本机其他端口的服务也会收到），所以 WebSocket 升级与登录必须带 `Origin` 且等于服务自己的来源（`http://127.0.0.1:<端口>` 或 `http://localhost:<端口>`），`Host` 必须是这两者之一；浏览器标明是别的站点发起的请求（`Sec-Fetch-Site` 不是 `same-origin` 或 `none`）拿不到需要会话的内容。每个响应带 `Content-Security-Policy`（客户端页面只允许自身来源，脚本不放行内联与 `eval`，只放行编译 WebAssembly；`frame-ancestors 'none'`）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 与 `X-Frame-Options: DENY`。浏览器会话能执行的事与桌面界面相同（包括让智能体运行与回答审批），只是少了白名单之外的管理面；剩下的风险是本机上能控制浏览器的程序，与能控制桌面界面的程序同级。
- **最小表面**。对外服务不提供设置、凭据、对外服务自身的管理、项目目录之外的文件访问，也不提供任意命令执行。可用的方法是一份白名单，不是网关方法的全集。
- **MCP 服务碰到的文件只在项目里**。MCP 服务开放了会读写本机文件的工具（清单见 §4.8），路径一律按真实路径判断，经 `..` 或符号链接指到外面的都算在外面：
  - **读**：导入素材（`edits_apply` 的 `importAsset`、`assets_import`）只接受视频所在项目目录里的文件，之外的以 `PATH_OUTSIDE_PROJECT` 拒绝。
  - **写**：只写视频所属项目里的固定子目录。导出（`export`）在 `exports/` 及其中已有的子目录，取帧（`videos_frames`）在 `exports/.baocut-out/frames/<videoId>/`，从链接下载（`download`、`transcribe` 给 `url` 时）在归属项目的 `downloads/`；都不进视频目录（含 `video.db`）与 `.bcut`。不针对某个视频、写到别处的工具（`artifacts_save`、`downloads_save`）不开放。
  - **本机路径参数**：`file`、`files`、`outDir` 一类参数对服务一律以 `INVALID_ARGUMENTS` 拒绝，文件只能经范围之内的视频、项目里的素材或链接进来；只收本机文件的 `transcode` 不开放。
  - **新建视频**：`videos_create` 必须给已登记的项目，访问策略是视频名单时新视频写进名单，名单不因此放宽到别的视频。

  理由：MCP 客户端是另一个程序，凭一枚令牌进来，它读到的文本还可能带着提示注入。把它能碰的文件收在用户已经交给 BaoCut 的项目目录里，令牌泄露或客户端被诱导时，损失也不出项目，不能借 BaoCut 读走或改写用户的其他文件；产物落在项目的固定子目录，用户知道去哪里找。新视频要写进名单，是因为名单之外的视频对服务不存在，不写进去客户端就看不到自己建的视频。yt-dlp 的安装与同意不经 MCP（§12.9）。
- **来自外部的内容是材料**。外部请求里的文本与文件按 §12.4 处理：不是指令，不扩大权限。
- **大小与并发有上限**。模型接口服务的上传至多 256 MiB，JSON 请求体至多 8 MiB，超出时回答 413（`Content-Length` 已经超出时一个字节也不读），并关闭这条连接；上传边读边写到 Runtime Home 的 `staging/model-api/`，请求结束后删除，服务开启时清掉上次留下的。每个客户端同时在途的生成请求有上限，超出的回答 429。它不接受任何文件路径参数：输入只来自请求体。
- **可审计**。每个外部请求记录调用方、工具或端点、目标与结果，不记录正文、媒体内容与令牌；用户可以在界面里看到最近的请求与当前的连接，并随时停止服务。停止服务立即断开已有连接，取消待处理的服务审批；由它发起且仍在运行的 Job 照常跑完，由用户在任务中心决定是否取消。

### 12.9 受管外部工具与安装动作

BaoCut 依赖一些不随应用发布的外部程序，也会替用户在系统里安装东西。这些动作不是模型推理，也不是代码包的执行面，单独约束：

**受管外部工具**（例如 ffmpeg、视频下载工具）：

- 不随应用分发的工具，BaoCut 不在后台自行下载。首次需要时显示工具的名字、用途、来源（下载地址）、版本、大小与许可，用户同意后才下载；同意只对这个工具有效。
- **登记表**。首批只有 yt-dlp（从链接导入，§7.9）；ffmpeg 不由 BaoCut 下载，仍按 `BAOCUT_FFMPEG` 与 PATH 解析，只在状态里列出。每个工具有清单：用途、探测命令、最低版本、是否要用户同意；能下载的还有发布：版本、各平台的文件名、大小与 sha256、官方地址、许可与主页。
- **状态**。`externalTools.list` 报告每个工具的状态：`installed`（路径、版本与来源：`env` 环境变量、`user` 用户指定、`managed` BaoCut 下载的副本、`system` PATH）、`missing`、`outdated`（低于最低版本）、`unavailable`（不能运行），以及原因、补救、同意与下载说明（`offer`）。`externalTools.detect` 重新探测。探测只在本机执行 `--version`，不联网。解析顺序：环境变量（只有 ffmpeg）→ 用户指定的路径（`externalTools.setPath`）→ 受管副本 → Runtime 工具环境的 PATH（Windows 上和命令行一样按 `PATHEXT` 补扩展名；找到的是 `.cmd`、`.bat` 之类的脚本时报告为不可用，指定路径也不收——BaoCut 不经命令行解释器执行工具）；用户指定的路径不能运行时报告为不可用，不悄悄换成别的。指定路径不代表同意。
- **同意**。要同意的工具（下载工具）记下同意的时间与途径（`app`、`cli`、`agent-approval`），可以撤回（`externalTools.consent`）；撤回之后用它的流程在提交、每一步之前与重试时都拒绝（`TOOL_CONSENT_REQUIRED`）。同意、用户指定的路径与受管副本的登记在 Runtime Home 的 `store/external-tools.json`。
- **下载**（`externalTools.install`）。没有显式的 `consent: true` 时以 `TOOL_CONSENT_REQUIRED` 拒绝并给出 `offer`，不下载；给了就记下同意，提交 `kind: 'toolInstall'` 的任务。清单里 sha256 未知时以 `TOOL_MANIFEST_INCOMPLETE` 拒绝：摘要不编造，宁可不能下载（§14）。任务把文件下载到 `tools/.staging/`，按真实的字节报告进度，核对大小与 sha256（不符时删掉坏文件，`TOOL_DOWNLOAD_INTEGRITY`），设可执行位（0755），原子地改名到 `tools/<工具>/<版本>/`，再执行一次 `--version` 确认能运行。取消时下了一半的文件保留，下次续传。严格离线时拒绝（`OFFLINE_STRICT`）。首版不校验上游的签名（§14）。
- **下载来源**。默认是清单里的官方发布地址；设置 `tools.downloadEndpoint` 或环境变量 `BAOCUT_TOOLS_ENDPOINT`（优先）可以指向镜像，地址为 `<基址>/<工具>/<版本>/<文件名>`，基址只能是不带凭据、查询参数与片段的 `http(s)://`。镜像下载的文件同样按清单核对。
- **更新系统里的那一份**（`externalTools.update`，属于下面的「安装动作」）。探测时按可执行文件的真实位置（跟随符号链接）判断它是怎么装的，在状态的 `update` 里给出办法与完整命令：Homebrew（真实位置在 `<前缀>/Cellar/<formula>/<版本>/` 下，用同一个前缀的 `brew upgrade`，从源码装的开发版加 `--fetch-HEAD`）、pipx（`pipx/venvs/<包>/` 下，`pipx upgrade`）、pip（入口脚本，用它 shebang 里的解释器 `-m pip install -U`，用户目录里的加 `--user`；Windows 上入口是 Scripts 目录里的 `.exe` 启动器，解释器取自启动器里 `#!` 的那一行，指向 pipx 的 venv 时按 pipx，入口不在解释器旁边时加 `--user`）、Windows 的包管理器（入口是复制出来的 `.exe` shim 或符号链接，在认独立程序之前认出来：winget 的真实位置在 `WinGet\Packages\<包 ID>_<源>\` 下，用 PATH 里（或 `%LOCALAPPDATA%\Microsoft\WindowsApps` 下应用执行别名）的 winget 不交互地升级这一个包、只查 winget 源，全机范围的要管理员权限；Scoop 的入口在 `<Scoop 目录>\shims\` 下且旁边有同名的 `.shim`，或在 `apps\<app>\<版本>\` 下，照 Scoop 自己的 `scoop.cmd` 用 System32 的 powershell.exe 执行 `scoop.ps1 update <app>`，全局安装只给 `scoop update <app> --global`；Chocolatey 的在 `bin\` 或 `lib\<包>\` 下，总要管理员权限，只给 `choco upgrade <包>`）、官方独立程序（二进制文件或 zipapp，执行它自带的 `-U`）；判断不了的（自己写的包装脚本、uv 装的工具——它的环境里没有 pip）与 BaoCut 下载的副本没有办法，界面列出常见做法。确认分两步：没交回 `command` 或与此刻的办法不同时以 `TOOL_UPDATE_CONFIRM_REQUIRED` 拒绝并交出办法，用户看过完整命令、交回同一条（界面上就是点所显示命令旁的执行按钮）才提交 `kind: 'toolUpdate'` 的任务；不重新拼命令，不接受调用方给的参数。完整命令按 Runtime 主机的平台写，能直接粘进那里的终端：Windows 按 PowerShell 的引号规则（第一个词带引号时前面加 `&`），其他系统按 POSIX shell。命令不经 shell，自成进程组，标准输入关闭，带关掉颜色与提示的环境变量，15 分钟超时；停止时整组终止（Windows 没有进程组，用 `taskkill /T /F` 结束整棵进程树，没有先请它退出的一步）。输出去掉终端颜色、`\r` 改写的行只留最后一次，末尾约 32 KB 随任务记录（`JobRecord.command`）推给界面，完整输出与前后版本写进任务的产物并记日志。结束后不管结果都重新探测；退出码不是 0 时任务以 `TOOL_UPDATE_FAILED` 失败（winget 没有可升级的版本时以 0x8A15002B 退出，算成功；为负或超过 0xFFFF 的退出码按十六进制给人看），原来的那一份由安装它的工具负责，BaoCut 不动。要改写的位置当前用户不能写时不代为执行（`TOOL_UPDATE_MANUAL`）：独立程序给出带 `sudo` 的命令（Windows 上说明用管理员身份打开终端执行），其余只给原命令并说明原因；Windows 上看不出访问控制列表，按位置判断，Program Files、ProgramData 与 Windows 目录下的都算要管理员权限。更新期间用它的流程拒绝启动（`TOOL_UPDATING`），严格离线时拒绝（`OFFLINE_STRICT`）。
- BaoCut 自己下载的副本不修改系统里已有的安装，也不加入用户的 `PATH`。`externalTools.remove` 只删受管副本，有任务在安装、更新或使用它时拒绝（`TOOL_IN_USE`）。
- 工具以最小的参数集执行：参数是数组、不经 shell，输入输出限定在任务的目录；yt-dlp 总是带 `--ignore-config` 与 `--no-plugin-dirs`，在自己的进程组里运行，取消时整组终止（Windows 上用 `taskkill /T /F` 结束进程树）。它的输出是数据，不是指令。工具的名字、版本与来源记入使用它的 Job。
- **谁能用**。只有桌面界面与 CLI。Web 服务不开放 `externalTools.*` 与 `pipelines.*`（§4.8），处理函数对浏览器会话与对外服务再拒绝一次；MCP 服务不提供工具的安装与同意；它的 `download` 只在用户已经在 BaoCut 里装好 yt-dlp 并同意之后可用，落点限于范围之内的已有视频或已登记的项目（`newVideo` 要给 `project`，新建的视频登记进服务的范围，§4.8、§14）。智能体在会话里用 `download`，风险按 §3.12：下载是 `command`，需要先下载 yt-dlp 或补上同意时是 `high`，审批摘要带来源、版本、大小与许可；智能体没有更新工具的工具。
- CLI：`baocut external-tools [list]`、`external-tools detect [名字]`、`external-tools install <名字> [--yes]`、`external-tools update <名字> [--yes]`、`external-tools path <名字> <文件>`（`--clear` 清除）、`external-tools remove <名字>`、`external-tools consent <名字> [--revoke]`。`install` 先打印来源、版本、大小与许可，`update` 先打印安装方式与完整命令，都在终端里问一次；不在终端里又没有 `--yes` 时拒绝。`update` 执行时逐行打出输出，结束后说更新到了哪个版本。从链接导入是派生命令 `baocut download <链接> [--project …] [--video …] [--transcribe] [--subs en,zh-Hans] [--audio-only]`。
- **本机浏览器**（`externalTools.cookieBrowsers`）。给下载视频的「网站登录」列出这台机器上有 Cookie 库的浏览器（§7.9），只看文件在不在与修改时间，不读 Cookie、不运行下载工具；结果带上 Runtime 所在主机的平台，界面按它提示系统授权（macOS 的钥匙串与完全磁盘访问权限），Windows 上则提示先完全退出 Chromium 内核的浏览器、Chrome、Edge、Brave 用应用绑定加密时读不到。与 `externalTools.*` 一样不对 Web 服务开放。
- 依赖缺失时，用到它的功能报告为不可用并给出补救（§6.2 的方式），其余功能照常。

**安装动作**（安装或升级智能体运行时、安装系统的包管理器依赖、把内置 Skill 安装到其他智能体的目录）：

- 都由用户逐次确认后执行。确认时显示将要执行的完整命令或将要写入的路径；执行过程的输出原样显示并记入日志。
- 需要管理员权限的动作不在 BaoCut 里提权：交给系统终端由用户自己执行，BaoCut 只在之后重新探测。
- **Skill 的安装**把随应用发布的 Skill 以链接或副本的方式放进其他智能体的 Skills 目录（全局或某个项目）。Skill 带版本，并声明它需要的 CLI 与协议版本；副本落后于应用时报告为过期。安装只写 Skill 自己的那个目录，目标位置已有别的内容时拒绝覆盖。应用内的会话不依赖安装：Harness 在每次会话开始时直接提供同一份指导（§3.8）。
- 这些动作由持有用户目录写权限的进程执行，经 Runtime 的命令发起并留下记录；Renderer 不直接写用户目录（§12.1）。

**添加与导入 Agent skill**（与上面「Skill 的安装」方向相反：把别处的 skill 放进 BaoCut 自己的用户层目录，§3.8）：

- **谁能用**。`skills.add`（本地文件夹）、`skills.importGithub`（GitHub）与 `skills.remove` 只对桌面界面与 CLI 开放；Web 服务的白名单里没有它们（`WEB_METHOD_NOT_ALLOWED`），智能体也没有对应的工具。只复制文件、不执行任何内容，所以用户发起的这一次请求就是确认，不再另外弹出确认；界面在发起前显示来源，结果与错误都带目标目录（`path`）与来源（`source` 或 `url`）。
- **只写自己的目录**。目标是 `<Runtime Home>/skills/<id>/`，`id` 默认由文件夹名（导入时是子目录名或仓库名）得出，可以另给。目标已存在或已有同 id 的 skill（含内置的）时以 `SKILL_EXISTS` 拒绝，不覆盖；这一步在复制或联网之前检查。内容先在 `skills/.staging/` 里拼好，校验 `SKILL.md`、写上来源记录，再原子地改名到目标；任何一步失败都删掉暂存目录，不留下半个 skill。
- **上限**。一个 skill 最多 200 个文件、共 8 MiB，`SKILL.md` 最大 64 KiB，相对路径最长 300 个字符；超过时 `SKILL_TOO_LARGE`。`skills.readFile` 与 `skills_read` 一次最多读 256 KiB 的文本。符号链接、特殊文件、缺 `SKILL.md` 时 `SKILL_INVALID`；本地添加不能指向用户层目录本身或其中的文件夹。
- **GitHub**。接受 `owner/repo`、仓库地址与 `…/tree/<ref>/<子目录>`（`ref` 取 `tree/` 之后的一段；名字带 `/` 的分支换成提交 sha 或标签）。只用公开接口、匿名访问：没写 `ref` 时取默认分支，先把 `ref` 解析成提交，之后都按这个提交取；沿子目录逐级找到目标目录、递归列出它的条目，条目里有符号链接、缺 `SKILL.md`、超过上限或列表被截断时在下载任何文件之前拒绝；子模块与点开头的条目不取。每个请求 30 秒超时，整次导入 2 分钟；重定向只跟到 GitHub 自己的主机。来源记录里有地址、`ref`、提交与子目录。限流时 `SKILL_GITHUB_RATE_LIMITED`（带 `retryAt`），网络问题 `SKILL_GITHUB_NETWORK`，不存在或私有 `SKILL_SOURCE_NOT_FOUND`；不自动重试。严格离线时拒绝（`OFFLINE_STRICT`）。
- **移除**只删用户层里这个 skill 的目录；内置 skill 不能移除（`SKILL_BUILTIN_NOT_REMOVABLE`），可以关掉。
- CLI：`baocut skills [list]`、`skills show <id>`、`skills add <文件夹> [--id <id>]`、`skills import <地址> [--id <id>]`、`skills enable|disable <id>`、`skills remove <id>`；`baocut chat --skill <id>` 点选一个 skill 发送。

### 12.10 应用内网页

功能区的网页标签显示的是不可信的外部内容，与应用自己的界面严格分开：

- 每个网页标签是一个独立的、沙箱化的浏览上下文，使用与应用界面不同的会话分区：没有 Node 能力，没有 preload，拿不到 Runtime 的端点与令牌，也不能访问 `file:` 与应用自己的来源。
- 只允许 `http` 与 `https`。地址里带的账号与密码被去掉。指向本机回环地址的导航默认拒绝，防止网页借应用访问本机的 Runtime 与对外服务（§12.8）；用户自己的开发服务器需要逐个来源允许。
- 新窗口、下载与权限请求（摄像头、麦克风、位置、通知）默认拒绝；下载交给系统浏览器。「在浏览器中打开」始终可用。
- 网页里的内容是材料，不是指令（§12.4）。智能体读取网页用它自己的工具，不经过这个标签；用户把网页内容交给会话是一次显式的引用。
- 网页标签的登录状态只留在它自己的分区里，可以在设置里清除；它不与系统浏览器共享。
- 桌面宿主负责页内查找、忽略缓存刷新和设备视口模拟：每个标签保留状态，查找结果只接收最新请求编号；网页获得焦点时的快捷键转回所属窗口。原生视图就绪后才启用或撤销设备模拟；菜单与弹层出现时隐藏视图，避免盖住界面。弹窗不启动外部应用，拒绝权限与转交下载会发出可关闭的提示。
- 文件查看器不经网页标签读取文件：沿用 `media.resolve` 的受限句柄。PDF.js 的 Worker、CMap、标准字体与图像解码 WASM 随客户端打包，使用本地 Blob Worker 和内嵌二进制资源，Electron 的 `file://` 与 Web 使用相同路径；只解析与渲染，不执行 PDF 动作。HTML 经静态清理后在无权限 sandbox 的 `srcdoc` 中显示，CSP 禁止网络、脚本、表单，链接导航属性被移除。

---

## 13. 代码组织与版本合同

### 13.1 目标目录

```text
apps/
  desktop/          Electron Main / preload / 界面入口
  runtime/          Supervisor / Node Worker 入口
  cli/              薄客户端
  web/              浏览器客户端：与 desktop 同一个界面包的静态构建，由 Web 服务提供（§4.8）
packages/
  ui/               React 界面：外壳、Home、Space、编辑器组件（React Spectrum 2 + Zustand）
  client/           Command / Query / Subscribe SDK
  protocol/         线上协议：信封、方法、主题事件、领域类型与运行时校验
  runtime-core/     装配、网关、身份、服务生命周期
  harness/          Conversation / Task / Run / AgentSession / Context
  agent-drivers/    智能体机器协议适配
  video/            VideoService 外观、Review、RenderService
  models/           能力合同、Provider 接口与注册表、模型包目录、模型服务配置
  providers/        在线 Provider 的适配器：每个供应商一个目录（§6.4）；智能体 Provider（`agent/`，§6.9）经 Driver 执行
  nodes/            局域网能力共享（§6.7）：节点服务（配对、来源门、能力任务的 HTTP 面）与发起端（节点客户端、远端节点 Provider、已配对节点、发现）
  services/         对外服务（§4.8）：ServiceManager、MCP 服务、模型接口服务、Web 服务的监听面与访问策略
  jobs/             Job / Application / 预算与资源调度、固定流程（§7.9）
  tools/            与传输无关的工具目录
  code-runtime/     Browser / Remotion、隔离构建
  runtime-storage/  会话、任务、审批、事件账本、Space 目录、用户库（§5.9）、偏好设置（§5.10）、内容索引（§5.11）、凭据存储的接口与两个后端（§6.8）
  process-host/     进程、租约、私有执行器通道（JSON 行的 Worker 客户端），随应用分发的原生程序的查找（`BAOCUT_BIN_DIR`，开发时 cargo 产物），缺少外部程序时按平台给的安装提示
  editor-wasm/      `bindings/editor-wasm` 的同步载入：转写的句子与原文指纹、舞台的框、引擎的取值区间、元素的样式目录；Node 从文件读、浏览器由 Vite 内联，jobs、Runtime 与界面共用（§7.9、§13.2）
  contracts-generated/   生成的 Rust DTO / Schema
crates/
  editor-semantics/ 时间、裁切、锚点、选择
  video-model/      视频交换 DTO：引擎、渲染计划与 WASM 预览共用
  video-engine/     视频事务、权限范围复验、回执
  video-store/      SQLite / revision / outbox / Blob 引用
  speech-doc/       字幕与翻译的核心（移植自 v2）：words / sentence / block / cue / line，翻译与对齐的引擎，字幕导出与检查（§7.9）；`speech-worker` 与 `bindings/editor-wasm` 经 `speech-doc-bridge` 链接，`translate` 流程经 Worker 用它（§7.9）
  speech-doc-bridge/ v2 TranscriptDoc 与 v3 speech / translation 正文的无损映射，转写的句子与原文指纹，纯函数（§7.9；视频格式规范 §5.2、§5.3）
  speech-worker/    Worker 进程：要调用模型的字幕步骤（现在有翻译：简报、分页翻译、质量门、对齐与译文字幕的时间投影），模型调用交给 Runtime（§7.9；协议见命令协议规范 §4.5）
  render-graph/     冻结输入的编译与依赖
  frame-render/     帧光栅：按帧计划把每一层换成渲染内核的元素画成一帧 RGBA（`fx` 的顺序、转场、字幕组、模板层、画不出来的判断）。原生导出直接链接，预览经 `bindings/preview-wasm` 用同一份（§9.1）
  render-raster/    CPU 渲染核心：DrawOp 指令 IR 与指纹、tiny-skia 光栅化重放、文本引擎（cosmic-text）、效果 / 滤镜 / 蒙版 / 转场、程序化源（Lottie、彩纸、进度、可视化、手绘）、帧计划的 CPU 执行器、BCF 布局与录制、图像比较；内置字体在 crate 的 `assets/fonts/`（移植自 v2 `bcut-render`）。经 `frame-render` 接线（§9.1）；缺省开 `media`（资源加载、帧供给、混音与封装、内置字体打进二进制），进 WASM 的构建关掉它；`program` 资产与 GPU 两组 feature 源码在、开不了（§13.6）
  timeline-render/  时间线元素的绘制层：形状、贴纸、可视化、进度、彩纸、手绘等元素编成 DrawOp 指令流与同源的实时 scene 节点，外部媒体的 texture 节点（`external-media-scene`）与 BCS2 scene 线格式（`scene-wire`）。纯函数，导出与预览共用（移植自 v2 `bcut-timeline-render`）；经 `subtitle-render` 的元素管线接线（§9.1）
  subtitle-render/  字幕 overlay 渲染内核：排版与样式投影、逐词动画、Designed Caption 配方、字幕转场、模板层、时间线元素合成、DrawOp 指纹与 CPU 光栅、ASS 样式头；内置字幕样式与贴图在 crate 的 `assets/`，字体读 `render-raster` 的内置字体（移植自 v2 `bcut-subtitle-render`）。经 `frame-render` 接线（§9.1）；缺省开 `host`（项目读取、媒体解码、系统字体），进 WASM 的构建换成 `wasm-safe`
  motion/           共享动画内核：缓动与弹簧、关键帧取样、动画 / 效果 / 文字预设与形状、贴纸、可视化、进度、彩纸的注册表（内置配方在 crate 的 `presets/`，编译时嵌入）、flow 编译与逐词动效。纯函数，超越函数只走 libm（移植自 v2 `bcut-motion`）；经 `timeline` 与渲染内核接线
  scene-primitives/ 渲染核心的确定性原语：缓动、颜色、SVG 路径与笔触风格、时间表达式、通道取样、文字排版与字格、SVG 动画、混音常量、内容指纹、静态布局，以及 v2 渲染入口要吃的 BCF 解析（resolve → `Ir`）与检查（移植自 v2 `bcut-core`）；随渲染内核接线，BCF 部分没有调用方
  timeline/         时间线语义与元素模型：源级剪口、片段排布与时间映射、语义跟随与词锚点、口播剪口的检测与判据、关键帧、按语音闪避，元素的 schema 与校验、几何、效果与转场的换算、模板层、画面文字。纯函数，算法内部是浮点秒（移植自 v2 `bcut-timeline`）；VideoEngine 的剪口与关键帧、`render-graph` 的闪避与 `frame-render` 的几何、关键帧、效果与模板层调用它（§14）
  audio-dsp/        离线音频 DSP 原语：滤波、合成、混响、闪避、BS.1770 响度与真峰值限幅、母带（移植自 v2 `bcut-audio-dsp`）；响度、真峰值与限幅由 Render Worker 的响度母带使用（§9.13），其余尚未接线（§14）
  waveform/         音频派生数据的纯函数格式层：BCW1 峰值包络、BCS1 频谱、节拍检测（移植自 v2 `bcut-waveform`；STFT 与节拍在 `dsp` feature 后，只读 BCS1 的消费方关掉它进 WASM）；渲染内核读 BCS1 频谱，产出方还没有接（§9.1）
  media-core/       PTS、解码、音频、代理；ffmpeg / ffprobe 子进程的解码、编码与探测
  media-probe/      纯 Rust 的媒体探测：容器、几何、时长、alpha 与 edit list，可选 ffprobe 兜底（移植自 v2 `bcut-media-probe`）；已移植，尚未接线（§14）
  media-native/     平台原生编解码，不启动 ffmpeg：单帧提取、顺序帧流、H.264 + AAC 的 MP4 写入；macOS 用 AVFoundation / VideoToolbox，Windows 用 Media Foundation（另有 D3D11 播放帧），其余平台报不可用、由调用方回落 ffmpeg（移植自 v2 `bcut-media-native`）；已移植，`render-raster` 的 `media` 经它取帧与编码，尚未接线（§14）
  export-worker/    Worker 进程：Render Worker（成片导出的预检与逐帧合成、导出的响度母带）
  model-runtime/    本地推理：解码喂入、VAD、ASR、对齐、说话人的后端抽象与流水线（库）；移植自 v2 `bcut-speech-core` / `bcut-speech`，按批补齐（§14「本地模型的移植」）
  engine-host/      Worker 进程：Engine Host
  model-worker/     Worker 进程：Model Worker（§6.5）
  credential-helper/ 凭据助手：经 stdin / stdout 读写系统的安全存储（§6.8）；macOS 以外只答 unsupported
bindings/           WASM / Engine IPC / Worker 合同：`preview-wasm`（编辑器预览：帧计划与帧光栅，与导出同一份）、`editor-wasm`（界面与 Node 共用的编辑语义：句子与原文指纹、舞台的框、取值区间、样式目录）
tools/              构建与代码生成脚本
fixtures/           时间、编辑、语言、渲染、安全、恢复
```

这是逻辑上的责任划分，不要求机械地拆出所有的包。目录的放置与命名规则见[仓库约定](../repo-conventions.md)。

依赖方向：

- UI / CLI → Client → Protocol；
- Harness → Tools → Video / Models / Jobs；
- Video → 私有的 Engine Client；
- Rust 不依赖 Electron、聊天渲染或任何商业 Provider。

### 13.2 契约单源

视频与语义类型由 Rust 生成 TypeScript DTO 与 JSON Schema。Runtime 的 Task / Job / Driver 协议由 TypeScript 单源生成运行时校验器。公共信封包装这两类领域 payload；不允许再手写一份稍有差异的 `TimeMap`。

Rust 是 `MediaTime` / `Rate` / `TimeDomain`、秒解析、帧量化、音频采样与时间映射的语义单源；TypeScript 只使用生成的 DTO 与绑定。

界面与 Node 要用的编辑规则、常量与内置目录也只在 Rust，经 `bindings/editor-wasm` 同步调用，TypeScript 不另存一份数字或表：转写的句子与原文指纹；舞台的框与 `place` 的互换、种类的缺省落位（与帧计划画层同一个实现，`render_graph::item_box`）；效果、闪避、音量、关键帧、动画与彩纸的取值区间与缺省值；声波、进度条与彩纸的样式目录（`motion` 的内置配方）。留在 TypeScript 的只有界面自己的设计：文案（款名、色板名、形状名）、滑杆的常用范围、步长与读数倍率、手势与吸附。还没有换过来的副本列在 §14「编辑语义的待定项」。

### 13.3 版本合同

以下版本彼此独立演进：

| 版本 | 标识什么 |
| --- | --- |
| `videoSchemaVersion` | 视频格式（视频格式规范） |
| `bundleSchemaVersion` | 代码包清单（代码包规范） |
| `adapterContractVersion` | 代码合成 Adapter 的执行合同 |
| `eventProtocolVersion` | 业务协议与事件（命令与协议规范） |
| `timeContractVersion` | 十进制秒的语法、各边界的舍入规则与采样政策 |
| `runtimeVersion` | Node Runtime |
| `engineVersion` | Rust VideoEngine |

规则：

- Worker 握手时协商能力；冻结的任务记录全部与执行相关的版本。
- 遇到未知的必需能力：拒绝执行，或只读打开。不得忽略之后再写回。
- 可选的 vendor extensions 保留在自己的命名空间里；读到不认识的可选扩展时，写回不得丢失它。
- 每个版本的升级都要有明确的兼容检查。升级 `timeContractVersion` 不得改变已有视频中任何已提交位置的含义。

### 13.4 旧版项目导入

新视频使用 `baocut.video` 格式，核心设计中没有对任何旧格式的长期兼容层。唯一的例外是发布前改名留下的旧布局：只有 `movie.db`、格式标识为 `baocut.movie` 的视频目录，在打开时就地升级一次（文件、表与键改名，内容不变），升级后与新建的视频没有区别；Space 的列表也认得这种目录。同样，升级前的项目目录没有 `.bcut/project.json`、视频没有记所属项目：项目首次打开时按登记的路径沿用原来的标识并写入标记，视频首次被认领时采用所在的项目，`videoId` 不变（§5.1）。

旧版项目导入是独立的单向转换任务：备份旧的源 → 冻结转换规则 → 校验目标 → 打开、预览与关键编辑的回归通过 → 交付新视频。不允许旧的写入器与新的 Engine 同时写同一个视频。

- 转换时不从 JSON number 静默推断精确的时间语义。旧数据如果只有视觉上的 `durationFrames`，按旧帧率求得已知的播放长度，并标记这个值的精度来源；不凭空补出未知的声学精度。
- 导入是否完成，由能力与行为测试判断，不以「JSON 能解析」为准。
- 不支持的合同拒绝写回。

**元素模型沿用 v2**。画面元素的种类与参数（文字、图形、贴纸、生成类元素、滤镜、蒙版、转场、关键帧与元素动画、逐词动效、字幕样式）直接采用 v2 的元素模型，作为视频格式的正式字段，变的只是容器（序列、轨道、实例、文档与有理数时间）。v3 尚未发布，这次改动不为现有的 v3 视频保留兼容，也不再把 v2 的元素数据存成 `baocut.legacy-*` 的旧数据或放进 `extensions`。v3 的视频到渲染核心的转换因此是逐类型对应的薄适配层，旧版项目导入也按同一套字段写入。

### 13.5 逻辑组件的归属

`CapabilityRegistry`、`GuidanceRegistry`、`ContextBarrier`、`InspectionService`、`ExecutionAdmission`、`ResourceResolver`、`CreativeCatalogue` 与 `SpaceCatalog` 是 Runtime 之内的逻辑服务，不各自成为独立的守护进程。Video 的作者层包含 `SceneRecipe` / `BuildLedger` 与 SoundCueSheet 的编译器。

- `FrameTicket`、`EvidenceReceipt`、`CapabilitySnapshot` 归属于各自的版本化合同。
- Video、时间与音频实例仍然由 Rust 单源定义。
- `ResourceResolver` 的授权决策在 Node；引用与版本关系在 VideoStore。
- SoundCueSheet 的应用仍然经过 VideoEngine。
- 浏览器页面的取帧队列与捕获握手位于 Adapter 之内，不进入视频格式。

### 13.6 从 v2 移植

v3 是 v2（`baocut-app`）的架构重做。成熟的领域实现从 v2 原样移植，连同测试、夹具与内置数据，不重写；v3 的架构只在边界上适配。动手写一个领域模块之前先查 v2 的 `core/crates/`。

**边界上的适配**，适用于每一个移植来的模块：

- **时间**。v2 的算法内部用浮点秒，移植时不改。进出 crate 的地方换成 v3 的有理数时间与帧网格，由 VideoEngine 统一量化并给出量化回执（视频格式规范 §2）。
- **网络与在线服务**。Rust 不联网、不认识任何商业 Provider（§1.4）。v2 里用 Rust 写的在线适配（云端转写、合成、文生图、素材库）不移植，只参考它们的端点、限额与重试策略，在 `packages/providers` 里用 TypeScript 实现；能带进 Rust 的只有规则，例如素材的许可判定与来源记录的形状。
- **模型推理**放进 Model Worker（§6.5）：一个模型包一个进程，只读清单列出的文件。需要调用语言模型的步骤把调用交回 Runtime（§7.9）。
- **写入**。v2 里直接读写工程目录的代码不移植，写入只经 VideoEngine（§1.3）；带走的是它们里面的规则。
- **界面要用的纯语义**编成 WASM 给界面调用（§13.2），不在 TypeScript 里另写一份。界面里已经照 v2 或原型手写的副本（口播剪口、预设数据、可视化、舞台姿态、导出范围、术语表等）在对应模块移植后换成调用同一份 Rust。纯界面的几何与状态留在 TypeScript。
  - `editor.wasm` 的打包：界面（渲染进程与网页版）由 Vite 以 `?inline` 内联；Runtime 打进 `out/main/runtime.js` 之后，桌面构建把它放在 bundle 旁边（`out/main/generated/editor.wasm`），载入时先找那里，找不到再沿目录往上找仓库里的 `packages/editor-wasm/src/generated/`。没有构建时用到它的调用报 `EDITOR_WASM_UNAVAILABLE`。
  - 内置配方只解析界面要用的那几类（`motion::preset_registry::parse_builtin_catalogue`），整张注册表不链接进 `editor.wasm`。
- **元素模型**沿用 v2（§13.4），**画面**只有一份实现（§9.1）。

**清单**。「原样」指整个 crate 带来；「拆」指只带领域部分，宿主部分由 v3 已有的模块替代；「不移植」指 v3 的架构已经有替代，或者那是 v2 特有的东西。

| v2 crate | 处理 | v3 落点 |
| --- | --- | --- |
| `bcut-flow-core` | 原样 | `speech-doc`（已移植） |
| `bcut-speech-core`、`bcut-speech`、`bcut-transcribe` | 原样（`model-runtime` 现有的识别是它们的删减移植，补齐对齐、说话人、Qwen3 1.7B、Whisper、MOSS） | `model-runtime`、`model-worker` |
| `bcut-tts`、`bcut-tts-core` | 原样（本地引擎；领域模块随配音处理） | `model-runtime` 的合成后端 |
| `bcut-separate`、`bcut-image-local` | 原样 | `model-runtime` 的分离、文生图后端 |
| `bcut-models` | 拆：固定的文件清单与哈希带走，下载与存储由 `packages/models` 承担 | `packages/models` |
| `bcut-lang` | 原样 | 随用到它的 crate |
| `bcut-cloud-stt`、`bcut-image-cloud`、`bcut-audio-gen`、`bcut-image`、`bcut-qwen-image` | 不移植，只作参考 | `packages/providers` |
| `bcut-motion` | 原样，内置配方（`core/presets/builtin`）随 crate 带来 | `motion`（已移植） |
| `bcut-render` | 原样，打过补丁的 resvg（`core/vendor/bcut-resvg`）随 crate 带在 `vendor/`，与 v2 一样是 workspace 成员。缺省开 `media`（资源加载、帧供给、ffmpeg 与原生的混音与封装、内置字体打进二进制），与 v2 相同；进 WASM 的构建一律 `--no-default-features --features wasm-safe`，根 `Cargo.toml` 的登记处是 `default-features = false`，引用方不显式要 `media` 就拿不到。`media` 用到的 `bcut-exec` 那一小块（命令构造、ffmpeg / ffprobe 查找、本进程路径）收进 crate 内的 `exec` 模块，查找规则跟 v3：先 `BAOCUT_FFMPEG` / `BAOCUT_FFPROBE`（显式给的不可用时不换别的来源），再 `PATH`，不补猜测的目录；用户指定的路径只在 Runtime 那里，接线时由调用方传入。`bcut-compile` 在 v2 是 `media` 的一部分、只服务 `program` 资产，这里拆成占位的 `program` feature：不开时 `program` 资产加载即报错，打开则编译失败。GPU 的 feature 等 GPU 合成那一批引入 wgpu | `render-raster`（已移植，经 `frame-render` 接线，已取代 `render-core` 与界面的 Canvas 绘制，§9.1） |
| `bcut-timeline-render` | 原样，feature 表不变（`media`、`wasm-safe`、`external-media-scene`、`scene-wire`）；进 WASM 的构建用 `wasm-safe`，GPU 与字幕合成器的产物再加 `scene-wire` | `timeline-render`（已移植，经 `subtitle-render` 的元素管线接线，§9.1） |
| `bcut-subtitle-render` | 原样，feature 表不变（缺省 `host`，另有 `wasm-safe`、`external-fonts`），根 `Cargo.toml` 的登记处是 `default-features = false`。内置数据带在 crate 的 `assets/`：字幕样式配方（`core/assets/captions/styles`）、配方用的六张贴图与它们的许可说明、`subtitle-designs.json`；字体不另带，按相对路径读 `render-raster/assets/fonts/`；本 crate 不读的 `subtitle-gallery.json` 不带。v2 内核之外依赖它的两块也落在这里：ASS 样式头（`bcut-kernel` 的 `ass_style_sheet`）与检查的 `place_out_of_canvas`（`bcut-engine`），`speech-doc` 不反向依赖渲染 | `subtitle-render`（已移植，经 `frame-render` 接线，§9.1） |
| `bcut-compositor` | 原样 | 随「GPU 合成与预览 WASM」那一批；预览 WASM 已先用 CPU 内核接上（§9.1） |
| `bcut-core` | 原样：`bcut-render` 的入口与它的音频、帧计划都吃 BCF 解析后的 `Ir`，解析又连着组合、编辑路径、素材需求、程序化源，拆不开。BCF 专属的模块（`resolve`、`lint`、`events`、`migrate`、`composition`、`editpath`、`assets`、`program_path`）只因渲染入口而带来，渲染入口改吃 v3 的帧计划（元素层与适配层那一批）之后去掉；`bcut-protocol` 只用到 BCF 的两个版本常量，收进 crate 内 | `scene-primitives`（已移植） |
| `bcut-media-native`、`bcut-media-probe` | 原样 | `media-native`（已移植，导出循环那一批成为 `media-core` 的原生编解码路径）、`media-probe`（已移植） |
| `bcut-wasm`、`bcut-wasm-gpu`、`bcut-wasm-subtitle`、`bcut-wasm-editor` | 不移植，沿用它们的出口方式 | `bindings/` |
| `bcut-timeline` | 原样，`bcut-protocol` 用到的模板层、品牌类型与版本常量收进 crate 内；数据模型在接线时适配到序列、轨道、实例 | `timeline`（已移植）。先是独立的 crate；接线时时间线语义（口播剪口、语义跟随、关键帧、按语音闪避）由 `editor-semantics` 与 VideoEngine 调用或并入，元素模型成为视频格式的字段，校验与换算给渲染适配层和编辑器用 |
| `bcut-editor-core` | 拆：时间线、剪口、短片、动画、舞台、元素、导出选项、字幕排版与样式库、术语表、章节带走；界面外壳、智能体、远端计算不移植 | `bindings/editor-wasm` 与对应的领域 crate |
| `bcut-audio-dsp` | 原样 | `audio-dsp`（已移植） |
| `bcut-waveform` | 原样（波形、频谱、节拍） | `waveform`（已移植） |
| `bcut-score` | 原样 | `score`（配乐合成与分轨） |
| `bcut-keyframe` | 原样（镜头切点、挑帧） | `media-analysis` |
| `bcut-reframe` | 拆：计划与跟踪带走，检测模型的推理进 Model Worker | `reframe` |
| `bcut-editable` | 原样，输入改成 v3 的视频 | `project-export`（剪映草稿、FCPXML、Premiere、Resolve、MLT、Kdenlive） |
| `bcut-videotool-core` | 拆：压缩、合并、失败归因的规划带走 | `media-tools` |
| `bcut-dubbing` | 拆：配音的计划、摆放、质检带走，推理进 Model Worker。v2 自己尚未完成，排在最后 | `dubbing` |
| `bcut-engine` | 拆：各流程的提示词与应答校验带走，模型执行不移植 | `speech-worker` |
| `bcut-workspace` | 拆：词级编辑、口播清理的审阅模型带走，写事务不移植 | `speech-doc`、VideoEngine |
| `bcut-kernel` | 拆：时间写法的解析、数值参数表、命令影响表、短片的吸附与候选、封面与挑帧、素材许可、配乐入轨、读音标注、画面文字的扫描与翻译、旧项目升级的规则带走；命令行、服务、远端与集成不移植 | 各自的领域 crate |
| `bcut-protocol`、`bcut-config`、`bcut-project` | 拆：模板校验、参数单位、品牌规则、带旋转的显示尺寸带走 | 各自的领域 crate |
| `bcut-executor` | 不移植；其中独立的 FLAC 编码器可以带走 | — |
| `bcut-serve`、`bcut-agent`、`bcut-jobs`、`bcut-runtime-client`、`bcut-client`、`bcut-secrets`、`bcut-exec`、`bcut-proc`、`bcut-videotool`、`bcut-skill-link` | 不移植；`bcut-exec` 里渲染核心用到的一小块收进 `render-raster`（见上） | Runtime、Harness、Jobs、`process-host`、凭据助手 |
| `bcut-compile`、`bcut-bcf-host` | 不移植：BCF 是 v2 的代码画面格式，v3 用代码包（§8）；`render-raster` 的 `program` feature 因此只是占位 | — |

内置数据与夹具随用到它们的 crate 带来：`core/presets/builtin`（动画、滤镜与蒙版、转场、文字、图形、进度、可视化的预设）、`core/assets`（字体、元素、字幕样式）、`core/fixtures`。夹具放在各 crate 的 `tests/fixtures/` 下。第三方素材带着它们的许可文件与署名一起来。v2 的设计文档随对应的模块复制到 `docs/design/` 下，文中的数据模型名指 v2。

**分批**。依赖在前，互不依赖的并行；每批都带测试，接线单独成批。

| 线 | 顺序 |
| --- | --- |
| 字幕与翻译 | crate 移植；与 v3 文档的映射；翻译、字幕层与检查接线；转录后处理（§14「字幕与翻译核心的接线」） |
| 本地模型 | 加回被删的接口与清单适配；对齐与说话人；更多识别模型；人声分离；语音合成；文生图 |
| 渲染与导出 | 基础库（音频处理、波形、媒体探测）；运动库与 `bcut-core` 的确定性原语；元素模型进视频格式；CPU 渲染核心与字体；元素层与适配层；字幕渲染；原生编解码与导出循环；GPU 合成与预览 WASM；响度母带；工程导出；快速修正 |
| 编辑语义 | `bcut-timeline`：crate 移植；与 v3 元素模型的对照；口播剪口、语义跟随、关键帧、按语音闪避的接线（§14「时间线语义的移植」）；`bcut-editor-core` 的领域部分经 WASM 给界面，替换界面里手写的副本 |
| 分析与工具 | 镜头切点与挑帧；智能重构图；压缩与合并工具；配乐；短片；术语表的深度规则；配音的计划与质检 |

---

## 14. 待评审事项

下表的事项按「当前文档的假设」执行；假设写着未定的，在实现到那里时再定。

| 事项 | 需要决定什么 | 当前文档的假设 |
| --- | --- | --- |
| 两份价格（§6.10、§7.8） | 用量估算的价目表（`model-prices.ts`）与预算准入读的模型描述 `ModelPrice` 是否合成一份 | 暂时分开：价目表只用于事后的估算；`ModelPrice` 只给能在提交时算出上界的单位，内置模型目前都没有。合并时模型描述的价格由价目表派生 |
| Rust 持久化与 Engine Host 的边界（D01、D02） | 是否接受「Node 唯一入口 + Rust 单写」带来的 IPC 成本；小型原生能力是否内嵌绑定 | 独立的 Engine Host 进程；内嵌绑定需单独测量 |
| 磁盘布局（§5.1） | 链接素材在任务快照里的处理：不支持写时复制的卷上是否提供「先复制再导出」的选项 | 已定：素材默认留在原处，用户选择才复制进视频目录；视频目录不自包含。不支持写时复制时按摘要核对，不复制 |
| 项目的登记（§1.5、§3.10） | 项目与视频的标识放在哪里；目录被移动、复制、删掉标记时怎么认；副本换标识时，Space 的用户标记与生成记录是否跟到副本；无项目会话的产物放在哪里 | 已定：标识在项目目录的 `.bcut/project.json`，只在新建与打开项目时写，登记只是可重建的索引；移动保留标识，复制出的目录得到新标识，没有标记时按登记的路径沿用（升级路径）。`video.db` 记下所属的 `projectId`，副本里的视频换新 `videoId` 并记下 `previousVideoIds`；两个旧视频互为副本时无法区分（§5.1）。副本不继承会话与用户标记。无项目会话的产物：第一次新建视频时会话绑定到新项目，视频与工作目录里的文件都进项目，`scratch/` 只在会话没有视频时存在（§3.10） |
| 首版 Driver（D08） | Codex 机器协议的具体接口；其余 Driver 何时接入 | 已定：Codex 与 Claude Code 经过集成测试；GitHub Copilot、Gemini CLI、Cursor Agent、Grok、Kimi Code 与用户添加的智能体经同一份 ACP 实现接入，共享实现经 claude-code-acp 适配器跑通完整的真机会话，都能开始会话，各家智能体本身未亲自跑通的标「未在 BaoCut 实测」；Pi 经 `pi --mode rpc` 接入，协议路径已验证、已放开，未用真实模型账号实测；OpenCode 经 `opencode serve` 接入，真机以免费模型验证（§3.1、§3.11） |
| ContextBarrier 的等待策略（§4.6） | 最长等待时间、输入法组合文本与进行中手势的默认处理 | 提示用户选择；时限未定 |
| 检查证据的保留政策（§9.8） | `InspectionArtifact` 保留多久、是否计入 Space | 不进入 Space；保留期未定 |
| 租约的公平性与资源估计（§7.7） | aging 参数、预览保底的额度、估计偏差的处理 | 机制已定，参数待基准。实现的简化：交互的任务始终排在后台前面，没有 aging；交互预留是固定的量（§7.6）；执行中不监测实际用量，估计偏差不纠正。识别模型包的 Model Worker 按权重估计（§6.5），系数只对过 Qwen3-ASR 两个模型包加载后的常驻量（0.6B 约 0.71 GB、1.7B 约 2.46 GB）。未定：合成模型包仍用固定的需求，按模型包估计要先实测各引擎加载后的常驻量与推理峰值 |
| 各种任务的峰值估计（§7.7） | Model Worker、导出、转码、模型下载的内存、GPU 内存、线程与 staging 的量 | 保守的初始估计，集中在 `packages/jobs/src/resource-profiles.ts`，没有经过基准测量，待按真实机器校准；偏小时可以用 `resources.capacity` 调小容量 |
| `timeDependencies` 的验证方法（§8.6） | 如何验证代码包声明的时间依赖属实 | 未验证即保守失效 |
| SoundCueSheet 与 pin 的合同 | 重新编译遇到 pin 冲突时的默认行为 | 保留 pin 并提示冲突 |
| Space 目录的可见性标记（§5.7） | 用途标记的枚举；候选何时从 Space 消失 | 可交付产物进入；被丢弃的候选移入回收站 |
| Space 与视频删除的保留期 | 回收站多久之后物理删除；GC 宽限期 | 已定：偏好设置 `space.trashRetentionDays`，默认 30 天；启动后与每 6 小时按 `space.purge` 的引用检查清理到期的条目，有引用的留着（§5.7）。Artifact Store 里没有引用的产物由后台清扫按 §7.3 的规则删除 |
| 视频素材版本与撤销历史的保留政策（§5.3、§5.5） | 已删除素材的 bytes 什么时候可以回收；撤销记录保留多久 | 未定。`asset_versions` 与 `undo_records` 从不删除，视频关闭时的 blob GC 只回收崩溃残留与过期 staging，已删除素材的 bytes 随版本记录一直留着 |
| Space 条目的标识与引用（§5.7） | 视频条目的 `id` 用 videoId 还是位置；产物的引用是 `artifactRef: VersionRef` 还是 artifactId | 实现的简化：视频条目的 `id` 是来源与相对路径的摘要（`sp_…`），videoId 放在 `ref.videoId`（副本在打开换标识之前与原视频同一个 videoId，引擎不可用时也要列出视频；用户标记跟着位置）；产物条目的 `id` 与 `ref.artifactId` 是 artifactId，不是 `VersionRef` |
| Space 目录的来源（§5.7） | 「只索引登记过的文件、不扫描整个项目目录」与界面的文件列表怎样共存 | 实现的简化：仍扫描项目目录与无项目会话的工作目录（有深度与数量上限），界面与会话的文件列表依赖它；`space.import` 的登记另外记在 Runtime Store，文件不在了显示 `missing`。项目之外的文件复制进项目的 `imports/` |
| Space 派生状态的精度（§5.7） | `source-changed` 按什么指纹判定；`candidate` / `applied` 的权威是什么；费用与派生关系从哪里来 | 实现的简化：`source-changed` 只比较导出冻结的 `videoRevision` 与视频当前版本，视频有任何提交就算变了；Application 记录只用于结果没有应用的任务：最近一次应用没有提交（`stale-input`、`rejected`、`cancelled`）的输出列为 `candidate`，`statusDetail` 带原因；`applied` 看时间线（任何序列）上是否用着导入得到的素材，在内容索引重读视频之后才更新；`origin` 没有 `cost`、`derivedFrom`、`derivedFromVideo`；固定流程（§7.9）的输出不单独成条，发布到来源目录里的经扫描出现 |
| Space 与 Job Ledger 的保留（§5.7） | Ledger 修剪旧记录之后，只在 Artifact Store 里的产物怎样留在目录里 | 已定：Space 另存产物记录（`store/space-artifacts.json`，只有派生用的事实），派生时与 Ledger 合并；产物全部删除后去掉记录。被修剪的任务在 `jobs.inspect` 里查不到，失败占位随 Ledger 消失；对外服务看产物要 Ledger 里的提交者，只在产物记录里的产物对它们不可见。这个版本之前已经被修剪的任务找不回来 |
| Space 物理删除的引用检查（§5.5、§5.7） | 引用图覆盖哪些引用；删除视频的命令 | 实现的简化：只查视频链接的素材文件（内容索引里的事实）与进行中任务用到的产物；有视频读不了或索引落后时按有引用处理。历史、冻结快照、模板与用户库的引用没有查。产物文件直接从 Artifact Store 的目录删除（Artifact Store 没有删除接口）。已定：删除视频是 `videos.delete`（移进来源目录的回收站），物理删除删除了的视频时另查别的视频的链接、它的进行中与等对账的任务、目录里不归视频管理的文件，只删视频管理的文件，链接素材的原文件不动（§5.5、§5.7）。确认锁时引擎短暂以写模式打开视频 |
| 跨视频检索的匹配与更新（§5.11） | 分词、排序与倒排索引；没有打开的视频怎样发现变化 | 实现的简化：NFKC 与小写之后的子串匹配，多词 AND，不分词，不排相关度；三个码点以上的词经 SQLite FTS5 trigram 索引取候选，更短的词逐段子串过滤，再按子串规则核对；没有打开的视频靠 `video.db` 与 WAL 的修改时间发现变化，再比较版本 |
| `space.continueInConversation`（§5.7） | 从条目继续一段会话：带哪些上下文、放进哪个会话 | 已定：给了会话时要看得到条目；属于项目的条目在项目里新建会话，不属于项目的回到它所在或产生它的会话（不在了时新建）。只带条目的标识与元数据，记在会话上，随下一条消息发出（§5.7）。不属于项目、又没有来源会话的条目（例如对外服务生成的）放进新会话之后，智能体经 `space_list` 看不到它 |
| Model Worker 的进程粒度（§6.5） | 一个模型包一个进程在显存紧张的机器上是否过于浪费；是否允许同一进程承载多个模型 | 一包一进程；共享进程只作为后续优化 |
| Model Worker 的崩溃阈值与期限（§6.5） | N 次 / M 分钟的具体取值；自动重试的次数；取消 ack 期限 | 重试 1 次；ack 5 秒；阈值未定 |
| 分段检查点续跑（§6.6） | P1 的 JSONL 检查点格式与有效性判定 | P0 整个 Job 重跑 |
| 非 macOS 的推理后端矩阵（§6.5） | Windows / Linux 上 ASR、VAD、对齐的后端与设备选择，以及内存压力信号 | 已定：非 Apple Silicon 上 Qwen3-ASR 0.6B / 1.7B 与 MOSS 走 candle，与 MLX 共用同一批模型仓库，加载时反量化；设备按 CUDA（`cuda` feature，只限 NVIDIA）、CPU 的顺序选，`BAOCUT_GPU` 关掉 GPU，Silero 固定 CPU；Whisper（GGML）在 NVIDIA 上走 ggml 的 CUDA（`whisper-ggml-cuda`），AMD / Intel 显卡只给 Whisper 用（GGML，Vulkan），按显卡分安装包（§6.5）。资源估计按参数量：CPU 每参数 4 字节记系统内存，CUDA 每参数 2 字节记显存。现状：candle 批已完成，在本机用真实权重跑过与 MLX 的对拍（要 `--release`：dev 档构建的 MLX 在夹具的品牌名上与 release 构建差一个 token，v2 同样如此；candle 两档一致）、端到端与 Worker 的 CPU 转写测试；带 `scales` 的权重与 MLX 一样只认 4 或 8 位；`x86_64-pc-windows-gnu` 上 `--no-default-features --features backend-candle` 能通过 `cargo check`（`onig_sys` 等 C 构建脚本要 MinGW 交叉编译器）。未验证：`cuda` 的构建与运行、Windows / Linux 实机。`model-worker` 的默认 feature 仍是 MLX + Core ML，`npm run build:engine` 在 Apple Silicon 以外的平台换成 `backend-candle,whisper-ggml`（`BAOCUT_WORKER_FEATURES=cuda,whisper-ggml-cuda` 让 candle 与 Whisper 用 CUDA，`whisper-ggml-vulkan` 让 Whisper 用 Vulkan）。Whisper（GGML）批也已完成：v2 的 whisper.cpp 后端（`whisper-rs` 0.16）连同测试原样移植到 `backend/ggml/`，后端 `ggml`、设备 `cuda`、`vulkan` 或 `cpu`（按所选 GPU 的 ggml 后端名报；两者都编进来时 CUDA 先于 Vulkan）；登记了 `whisper-large-v3@ggml`（`ggml-large-v3-q5_0.bin`）与 `whisper-large-v3-turbo@ggml`（`ggml-large-v3-turbo-q8_0.bin`），两个文件在 `ggerganov/whisper.cpp` 的同一版本里，large-v3 的清单登记在兄弟目录 `ggerganov/whisper.cpp-large-v3`、下载仍取自上游（清单的 `sourceRepo`），两个模型包各装各删（同 v2）；sha256 取自 v2，大小在安装计划时向来源要。验证了单元测试、Worker 的握手与加载检查（`--features whisper-ggml`），以及 `x86_64-pc-windows-gnu` 上 `--no-default-features --features backend-candle,whisper-ggml` 的 `cargo check`（whisper.cpp 的 bindgen 要 `BINDGEN_EXTRA_CLANG_ARGS_x86_64_pc_windows_gnu` 指向 MinGW 的 sysroot，否则退回不匹配的内置绑定）。设备选择与标签（CUDA 优先、只有 Vulkan 时标 `vulkan`、`BAOCUT_GPU=off` 时 `cpu`）有单元测试，`whisper-ggml-cuda` 只核对了 feature 解析。未验证：真实权重的转写（没有下载权重）、`whisper-ggml-cuda` 与 `whisper-ggml-vulkan` 的构建与运行（本机没有 nvcc 与 Vulkan SDK）、Windows / Linux 实机。文生图（Qwen-Image）的 candle 变体（`qwen-image-2.1@candle`，同一仓库、加载时反量化）在 Apple Silicon 以外的平台列出，峰值与耗时见 §6.5：CPU 上能出图但 1024² 要几个小时，实用要靠 CUDA（未在本机验证）。语音合成的十个模型包也各有 candle 变体（`…@candle`，同一仓库），在 Apple Silicon 以外的平台列出，常驻量与耗时见 §6.5：CPU 上能合成但一句要几分钟，实用要靠 CUDA（未在本机验证）。人声分离（HTDemucs-FT）的 candle 变体（`htdemucs-ft@candle`，同一仓库，权重升成 f32）在 Apple Silicon 以外的平台列出，CPU 的峰值与耗时见 §6.5；`cuda` 未在本机验证。Windows 的打包见下面「Windows 安装包」，Linux 还没有安装包流程；内存压力信号见下面「Model Worker 在 Windows 上的看护与优先级」 |
| 单一 GPU 安装包在运行期自选后端（§6.5） | Windows 能不能只发一个 GPU 安装包，在用户机器上按显卡自选 CUDA 或 Vulkan | 现在做不到，按显卡分 CUDA 版与 Vulkan 版两个包（§6.5、「Windows 安装包」）。原因：candle 的 `cuda` 经 cudarc 的 `dynamic-linking` 链 CUDA 的导入库，model-worker.exe 直接依赖驱动的 `nvcuda.dll` 与 cudart / cublas，在没有 NVIDIA 驱动的机器上进程根本起不来，轮不到运行期选择；whisper-rs-sys 把 ggml 与它的后端静态链接进 exe，静态链接的 ggml-cuda 同样直接依赖 `nvcuda.dll`、cudart 与 cublas（所以只给 Whisper 开 CUDA 也一样），ggml 的动态后端（`GGML_BACKEND_DL`，每个后端一个 `ggml-*.dll`、运行期按可用性加载）在这条构建链上走不通。将来的路径：whisper.cpp 改用 ggml 的动态后端 DLL（`backend/ggml` 里的 `load_sidecar_backends()` 已经预留，会加载 exe 旁边的 `ggml-*.dll`），candle / cudarc 改用 `dynamic-loading`（运行期用 `LoadLibrary` 找驱动，找不到就报 CUDA 不可用而不是起不来）；两者都做到之后一个包可以同时带 CUDA 与 Vulkan，ggml 按登记顺序先选 CUDA。都未实测 |
| 内置模型清单的哈希与大小（§6.3） | 默认转写模型包（Qwen3-ASR 0.6B MLX 4bit 与 Silero VAD）的 sha256 取自旧版 BaoCut 为同一版本固定的值，本仓库没有联网重新核对；文件大小没有离线可信的来源 | 照用旧值，待评审时对上游重新核对（核对前不当作已验证）。大小在做计划时向来源发 HEAD 取得，取不到时报告为未知，按估计值（约 680 MiB 与 1.2 MiB）确认。清单缺哈希的模型包拒绝安装，不会下载了再算 |
| 本地模型的下载与离线（§6.3） | 严格离线时是否允许从局域网镜像下载；暂存区留着的部分多久清理；多个模型包能否并行下载 | 严格离线一律拒绝下载与修复（含镜像）；暂停的暂存区一直保留，直到再次安装、丢弃（`discard`）或删除模型包；安装串行，一次一个 |
| 安装管理的入口（§6.3、§4.8） | 浏览器与对外服务能否安装、删除本地模型 | 已定：MCP 对外服务与 Web 服务都不提供；智能体只能经会话里的 `models_install` 下载、`models_test` 检查，都按 `command` 确认，不能删除与修复 |
| 在线 Provider 的首批名单（§6.4） | 每种能力先接哪几家；各家模型的默认选择 | 转写 OpenAI、Google；合成 OpenAI、ElevenLabs；文生图 OpenAI、Google；文本 OpenAI、Google；另有 OpenAI 兼容端点 |
| 凭据的存放（§6.8） | Windows 与 Linux 上用哪种安全存储 | 已定：正式版本进操作系统的安全存储（经 `credential-helper`），开发版本存本机文件，由构建类型决定；不可用时不回退到文件。macOS 钥匙串已实现；Windows Credential Manager 和 v2 凭据的只读迁移已实现并通过 Windows MSVC 目标交叉编译，原生运行待验证。Linux Secret Service 未实现，助手回 `unsupported`，不回退到文件 |
| Windows 安装包（§13.1） | 签名；什么时候发布（更新见下一行） | 有了打包脚本（`npm run package:win`，NSIS 按用户安装与 zip，x64）与手动触发的 `desktop-windows` 工作流，标准版、CUDA 版与 Vulkan 版各一个包，按显卡选（§6.5）；不签名，SmartScreen 会拦。三个版本都带 whisper.cpp 的 Whisper（`whisper-ggml`）。CUDA 版是 NVIDIA 专用：Model Worker 开 `cuda`（candle 的 CUDA 后端）与 `whisper-ggml-cuda`（Whisper 的 ggml-cuda，静态链接，打包脚本给 `CMAKE_CUDA_ARCHITECTURES=80-virtual;86-real;89-real;120-real`，与 candle 的 `CUDA_COMPUTE_CAP=80` 同一口径；按 whisper-rs-sys 与 ggml 的构建脚本核对，ggml-cuda 用到的 cudart、cublas、cublasLt 已在随包的运行库里，驱动的 `nvcuda.dll` 不随包）。Vulkan 版给 AMD / Intel 显卡与不支持 CUDA 13 的 NVIDIA 显卡：用 `whisper-ggml-vulkan`（构建装 v2 钉死的 LunarG Vulkan SDK，运行时只要显卡驱动的 `vulkan-1.dll`），candle 仍在 CPU 上；工作流默认三个版本都出。都还没有构建过；CUDA 版因为多编 ggml-cuda 会明显变慢，工作流 150 分钟的 timeout 可能不够，等实际跑一次再定。只在 macOS 上交叉编译（`x86_64-pc-windows-gnu`）出包核对过结构；MSVC 构建、CUDA、NSIS 安装、在 Windows 上起 Runtime 与各 Worker 都还没有实测，`check:file-fonts` 也还没有对打包出的应用跑 |
| Windows 的应用更新（§2.6） | 更新源与安装器放在哪里；v3 的 build 号怎样接上 v2；v2 的 Inno 安装版怎样迁过来 | 已做：exe 旁边有 NSIS 的 `Uninstall BaoCut.exe` 才算安装版（不读注册表的 InstallLocation：要解析 `reg.exe` 的输出，这里测不到；装到别处又被挪动过的副本会被认错，可以以后补）。安装器在应用正常退出（`before-quit` 里经 IPC 停 Runtime）之后、`will-quit` 时起，「重启并更新」用 `/S --updated --force-run`，已下载时正常退出用 `/S --updated`（装完不打开）：带 `--updated` 的安装器只等应用约 1.3 秒就结束安装目录里还在跑的进程，先起会截断 Runtime 的收尾；不是这个应用起的 Runtime（例如上次崩溃留下的）会被它强行结束。「重启并更新」装完以 `--updated` 重新打开，一分钟后清掉缓存里这次启动之前的安装包；退出时装的，留下的安装器在之后检查到已是最新时清掉。zip 版退回手动下载。清单仍是 schema-1、`format: exe`，按变体分开（`appcast-x86_64-pc-windows-msvc[-cuda\|-vulkan].json`；三个安装包共用一个 appId，清单写了 `variant` 时必须与本构建一致）。打包脚本按 `--build` 把 build 号与变体写进应用、产物名带 `build.<n>`，写发布报告（安装器与 zip 的文件名、大小、sha256），给了 `--download-base-url` 时再写更新源并用应用的解析器读回；没有 build 号的包不检查更新（设了 `BAOCUT_UPDATE_APPCAST` 时照常检查，演练用；它也认 Windows 的盘符路径与 `file:///C:/…`）。不签名，真伪只靠 HTTPS 与清单里的 sha256；应用自己下载的安装器不带网络来源标记，静默运行应当不经 SmartScreen（未实测）。已定：v3 更新源与下载页改用 GitHub（§2.6），build 号接着既有 App 发布递增；只有实际出包的平台才发布对应的更新清单。v2 的 Inno 安装版装在 `%LOCALAPPDATA%\Programs\BaoCut`，与 NSIS 的 `…\Programs\baocut` 不分大小写是同一个目录，两边的静默参数互不认（v2 起安装器用 `/SILENT`，NSIS 认 `/S`），迁移要单独设计。没有在 Windows 上实测应用内更新；原生候选工作流包含 `/S --updated` 同版覆盖与自检；`desktop-windows-publish` 只接受通过原生 job 的候选，与已发布 Mac 的源提交对拍后追加不可变 Windows 资产，公开读回通过才写 Windows 更新清单，Mac 资产与历史 skill Latest 不变（桌面端 README「GitHub Actions 发布」） |
| Windows 上停止 Runtime | 桌面端退出时 Runtime 的收尾 | 已改：主进程经 IPC 通道发 `{ type: 'stop' }`，Runtime 照 §2.4 收尾，8 秒不退再强杀（§2.2）；Runtime 停 Worker 靠关 stdin 与 `cancel`，不靠信号。还没有在 Windows 上实测。中止 ffmpeg / yt-dlp 用的 `SIGTERM` 在 Windows 上是强杀，输出本来就丢弃 |
| Model Worker 在 Windows 上的看护与优先级（§6.5） | 父进程看护、推理线程降优先级与内存压力信号的 Windows 实现 | 看护与降优先级已有（§6.5），只交叉编译、链接过，没有在 Windows 上跑过。内存压力信号还没有（旧版也只有 macOS）：读不到时恒为正常，内存按 `os.totalmem()` 估；候选是系统的低内存通知（`QueryMemoryResourceNotification`）或按 `GlobalMemoryStatusEx` 的占用率定阈值，要先在 Windows 上量过 |
| 缺少外部工具时的提示 | `ffmpeg` 一类外部工具的安装提示按平台给 | 已改：Runtime 按它所在的平台给（`process-host` 的 `ffmpegMissingRemedy`；macOS `brew`、Windows `winget`、Linux `apt`，其余给官网），界面用 Runtime 给的那句，没有时只说装什么。Windows 上 PATH 在启动时就定了（不读登录 shell），装好后要重新打开 BaoCut，提示里写明。yt-dlp 由 BaoCut 下载，不涉及 |
| 本地语音合成与文生图（§6.1、§6.3） | 模型与后端的选择；模型包的大小与资源准入 | 已定：从 v2 原样移植（语音合成六个引擎族、文生图 Qwen-Image），先做 MLX 路径，依赖 libtorch 的后端与非 macOS 后端放后面；分批与进度见「本地模型的移植」。语音合成的骨架已完成：十个合成模型包登记在目录里（每个文件有 sha256 与大小，Qwen3-TTS 的编解码器共用一份），能列出、下载、修复、删除、设为默认、提交与检查；Worker 合同（`job.run` 的 `synthesize`、阶段与 `steps` 进度、`baocut.speech-wav/v1`）两侧一致，本地 Provider 在 Worker 进程里执行并复用生成任务的校验。Worker 已接上全部六个引擎族（Qwen3-TTS、IndexTTS2 与 2.5、VoxCPM2、OmniVoice、GPT-SoVITS）的合成，十个模型包都用真实权重合成并通过检查：`worker.hello` 按引擎在 `synthesizeFamilies` 里声明模型族，Runtime 只把列出的模型族交给 Worker，没列出的以 `capability-missing` 失败、不停用模型包；念不了的读音标注在任务里报 `reading-dropped` 警告。设置里的「语音合成」页（Electron 与 Web 共用）能下载（含许可确认）、试听、设默认与管理音色；模型目录可在设置里更改（§6.3）。本地合成输出的峰值限在 −1 dBFS、不放大（Model Worker 协议规范 §5.1），检查在削波样本超过 0.1% 时失败；Qwen3-TTS Base 偏响出在 x-vector（只用说话人嵌入、不带录音原文）这条路：0.6B Base 用内置音色实测，x-vector 的原始峰值高出满幅约 3–5 dB，限幅之后门限电平仍在 −10 到 −12 dB；带原文的 ICL 跟着参考录音的电平走（zh-female −26.8 dB，录音本身 −24.9 dB；en-female −18.4 dB，录音本身 −19.1 dB），生成速度相同。v2 在 Base 上对内置音色走 x-vector；这里内置音色连同录音原文交给 Worker、走 ICL，所以内置音色不偏响，仍偏响的只有不填原文的克隆。已定：内置音色保持 ICL，不回到 v2 的 x-vector；1.7B Base 没有实测。相对 v2 有意不带、原型里也没有界面的选项：逐次请求的采样参数（temperature、top_k、top_p、repetition_penalty、max_tokens），各引擎用自己的默认值；VoiceDesign 点名内置音色时另加的语气说明（v2 把两句接起来）；Qwen3-TTS 的北京话、四川话（语言表只有十种语言）。要加回时先改原型。目标时长还不在 Worker 合同里。未定：IndexTTS 2.5 的辅助权重借用整个 IndexTTS2 仓库，只装 2.5 时多下约 2.2 GB 的 IndexTTS2 主权重，是否拆出只含辅助文件的清单；本地合成单次 2000 个码点的上限待实测校准；情绪控制还不在请求里。文生图（Qwen-Image-2.1，MLX 4bit）已接上：管线从 v2 原样移植，模型包登记在目录里（20 个文件都有 sha256 与大小），能下载、检查、设默认，`models.generateImage` 的 `local` Provider 可用；本机用真实权重在 Worker 里生成并逐字节复现。candle 路径已从 v2 原样移植（`image/qwen_image/candle/`，连同单元测试），登记为 `qwen-image-2.1@candle`，本机用真实权重在 CPU 上跑过 256² 两步（两次逐字节相同）与 1024² 一步，峰值与耗时见 §6.5；`cuda` 只有 v2 的实测。待做：CPU 上每一步都重新反量化整个 DiT、`proj` 每次都把权重转置复制一遍，且是单线程（v2 原样），可以按层缓存反量化与转置后的矩阵或并行反量化来提速。合成的 candle 路径也已完成：v2 的 `synthesize::tensor` 门面与 candle 适配层连同单元测试原样移植，六个引擎族都在门面上编译（MLX 的路径数值不变，十个模型包的真实权重测试重跑通过）；每个 MLX 模型包登记一个 `…@candle` 变体，Worker 按参数个数估计常驻量；本机在 CPU 上用真实权重跑过 Qwen3-TTS 0.6B（Worker 端到端与引擎测试）、GPT-SoVITS、OmniVoice 与 IndexTTS 2.5，IndexTTS2 与 VoxCPM2 内存不够没有跑，`cuda` 没有编译与运行。待做：candle 合成在 CPU 上只用 1–2 个核、比实时慢 6–145 倍。模型描述已像文生图那样照实提示耗时：设备是 `cpu` 时 `notes` 按模型写比实时慢多少（见 §6.5），设置里试听前的那一句先用它，没有加新的界面元素；下载前的行上看不到这句（文生图也一样，那一行没有放说明的位置） |
| 本地模型的移植（§6.5、§13.6） | 分批；移植来的引擎怎样找模型文件 | 已定：分批为前置（加回 v3 删掉的接口、纯逻辑模块、清单适配）；对齐与说话人；更多识别模型（Qwen3-ASR 1.7B、Whisper、MOSS）；人声分离；本地语音合成；本地文生图。v2 引擎按「模型目录 + 相对路径」找文件的写法，移植时换成 `bundle.rs` 的清单查询：按组件取文件集，按相对路径取文件，按目录与扩展名取（不递归），取子目录的视图；只看清单列出的文件，不扫描目录。缺文件是 `MODEL_NOT_INSTALLED`、缺组件是 `MODEL_UNSUPPORTED`，后端加载失败时原样透传，不改报成加载失败。现状：前置批已完成。`model-runtime` 加回了 Qwen3 文本解码器的 1.7B 配置与无 KV cache 的前向（含末层前、层融合、逐层流式）、音频塔的 1.7B 与强制对齐器配置、Thinker 文本骨干的过滤与流式量化读取、按键过滤的 safetensors 读取、Metal 探针、MOSS 的 mel 前端、Silero 的整段检测；`Qwen3Config` 认 1.7B 的结构。纯逻辑的 `refine`、`timestamp`、`speaker_cluster`、`vad_binarize`、`moss_parse`、`hint` 与强制对齐的输入布局连同测试带来；`vad_binarize` 是整段的批量二值化，与流式转写用的 `vad_stream` 状态机并存，结构体只有一份。契约批也已完成：`worker.hello` 按模型族声明 `transcribeFamilies`，模型包按 `asr` 的 family 检查组件（Whisper 要分词器，MOSS 不要 VAD），加了 `tokenizer` 组件、按目录交出 `.mlmodelc` 的清单查询、占位的 `coreml` 后端、自分段的执行方式，以及可选组件；语言表按模型族各一张（Qwen3-ASR 30 种、Whisper 100 种、MOSS 101 种，取自 v2），Rust 与 TypeScript 各一份；登记了 Qwen3-ASR 1.7B（MLX 8bit），预先登记了对齐器、说话人模型、Whisper、MOSS 各仓库的清单。0.6B 与 1.7B 在本机用真实权重跑过 Worker 的转写测试。Whisper 批也已完成：`whisper.rs` 连同测试原样移植到 `backend/coreml/`，`objc2-core-ml` 放在 `backend-coreml` feature 后、只在 Apple Silicon 的 macOS 上编译；登记了 `whisper-large-v3@coreml`（`argmaxinc/whisperkit-coreml` 的 `openai_whisper-large-v3_947MB/` 子目录）与 `whisper-large-v3-turbo@coreml`（带前缀预填模型），分词器取自 `openai/whisper-large-v3`；两者在本机用真实权重跑过 Worker 的转写测试与自测。Turbo 的 context prefill 模型按「语言 × 2 + task」查表，每种语言第 0 行是转写、第 1 行是翻译；v2 给 `task` 传的是 1，查到的是翻译那一行（Turbo 基本不会翻译，所以输出看不出错），这里改为 0，与逐 token 播种的转写前缀逐值核对过。对齐与说话人批也已完成：强制对齐器与 WeSpeaker 嵌入原样移植到 `backend/mlx/`（`aligner.rs`、`wespeaker.rs`，fbank 与对齐的公共部分在 `speech/`）；对齐器登记为四个识别模型包的可选组件，MLX 与 Core ML 两个后端都会加载它，流水线逐段对齐、出错退回估计并带 `alignment-failed`（v2 是让整个任务失败，这里按本节第 5 步）；Worker 提供 `align` 能力。四个识别模型包在本机用真实权重跑过带对齐器的转写测试。WeSpeaker 移植了加载与嵌入（MOSS 的说话人合并用它）；Pyannote 分段当时没有移植，后来随说话人区分批移植（见下）。更多识别模型批也已完成：MOSS 的 MLX 引擎（`backend/mlx/moss.rs`）、分块生成与重复检测（`speech/moss_common`）与跨块说话人合并（`speech/moss_speakers.rs`）连同测试原样移植，阈值不变；登记了 `moss-transcribe-diarize@mlx-8bit`，量化固定为 8 bit，可选的对齐器与 WeSpeaker 用到时才加载、任务结束即卸下，系统内存吃紧时先卸下 MOSS（同 v2）；在本机用真实权重跑过转写、两人分离与自测。非 macOS 的 candle 批也已完成：v2 的 candle 后端（Qwen3-ASR、Silero、对齐器、MOSS、WeSpeaker）连同对拍与端到端测试原样移植到 `backend/candle/`，见「非 macOS 的推理后端矩阵」；文生图的 candle 路径（`bcut-image-local` 的 `candle` 模块）移植到 `image/qwen_image/candle/`，与 MLX 共用分词、调度与 RoPE 表，见「本地语音合成与文生图」。非 macOS 的 Whisper 批也已完成：v2 的 GGML 后端（whisper.cpp）连同测试原样移植到 `backend/ggml/`，同见该行；还没有用真实权重跑过。人声分离批的 MLX 路径也已完成：HTDemucs-FT（四个子模型的组合，STFT 与 Transformer 编解码）连同 v2 的单元测试原样移植到 `model-runtime` 的 `separate/`，Worker 提供 `separate` 能力与 `separateFamilies`；登记了 `htdemucs-ft@mlx`（`aufklarer/HTDemucs-FT-MLX`，清单的大小与 sha256 按本机已装的仓库核对过），只在 Apple Silicon 的 macOS 上列出；本机用真实权重跑过分离测试与 Worker 测试。人声分离的 candle 路径也已完成：v2 的 candle 张量适配层连同单元测试原样移植，与 MLX 共用同一份模型图（两个后端各编一份，可以编进同一个构建）；登记了 `htdemucs-ft@candle`（同一个仓库），只在 Apple Silicon 以外的平台列出，是那里人声分离的默认；本机用真实权重在 CPU 上跑过分离测试，与 MLX 的输出对拍（同一段混音，人声与背景的 SDR 约 125 dB）。未实现：术语提示按模型给预算（原型里前置提示式的模型 180 字、上下文式 1200 字、没有提示通道的 0；现在 Runtime 与界面一律按 1200 字拼术语，Worker 按模型族处理见 Model Worker 协议规范 §2.5.1）；本地语音合成批的 candle 路径也已完成，见「本地语音合成与文生图」：合成的 candle 模型包按参数个数估计 Worker 的资源需求。说话人区分批也已完成：v2 的 Pyannote 分段（MLX 与 candle 两份、共用的后处理与聚类）与说话人区间到词的投影连同单元测试原样移植到 `backend/mlx/pyannote.rs`、`backend/candle/pyannote.rs`、`speech/pyannote_common.rs` 与 `speech/speaker_projection.rs`，阈值不变；登记了「说话人区分」模型包（§6.3），Qwen3-ASR 与 Whisper 在四个后端上都能区分说话人（§6.6 第 7 步）；本机用真实权重跑过 MLX 的 Qwen3-ASR 0.6B、Core ML 的 Whisper large-v3 与 candle CPU 的 Qwen3-ASR 0.6B 的两人区分，candle 与 MLX 的分段对拍。已有转写的说话人区分（AI 工具「识别说话人」，§6.6）也已完成：Worker 单独装这个模型包区分已有转写，`speakers` 流程出提案、`edits.applySpeakers` 应用（可撤销），桌面应用的工具页走它；本机用真实权重跑过 MLX 的两人区分。暂缓：MLX 的合成模型包按模型包估计 Worker 的资源需求。组件许可的显示（WeSpeaker 的 CC-BY-4.0 署名）已定：放在模型详情的「许可」行，列权重的许可，再给要署名或许可与权重不同的组件各列一条。原型已做（MOSS 与说话人区分包列出 WeSpeaker 的署名）；模型包状态的组件已带 `license`（§6.3）。桌面应用与 Web 的界面待用户确认原型后再改 |
| Apple Silicon 上 Whisper 的后端（§6.5） | 用 MLX 替换 Core ML 的 Whisper，还是两者并存 | 未定。MLX 的 Whisper 已实现（`backend/mlx/whisper.rs`，按 mlx-examples 的 `mlx_whisper`（MIT）的结构用 mlx-rs 自写，解码与 Core ML 共用 `speech/whisper_decoding.rs`：同样的前缀、抑制、重复词检测与提示预算），登记了 `whisper-large-v3@mlx` 与 `whisper-large-v3-turbo@mlx`，暂不列出。本机（M4、16 GiB，`--release`，161 秒的样本，turbo）实测：整段直接识别 MLX 6.8 秒、Core ML 6.7–6.9 秒，持平；Worker 转写流水线（VAD 切出 18 段）的 `asrMs` MLX 16.2–16.4 秒、Core ML 12.3–12.4 秒，MLX 慢约 1.3 倍。差在编码器：每段不足 30 秒也要补满 30 秒窗，MLX 在 GPU 上每窗约 750 毫秒（与 Python 的 mlx-whisper 728 毫秒持平），Core ML 在神经网络引擎上更快；把段长上限从 14.5 秒放到 29 秒（15 段）两边都快，比值不变（约 1.33 倍）。两个后端的流水线都比整段直接识别慢近一倍，根源在流水线逐段补满 30 秒窗：把相邻的短段拼进同一个 30 秒窗、再按段切回文本（要时间戳 token 或对齐器的词时间）能让两边的编码器都少跑一半以上，MLX 也更可能追平——这是流水线层的改动，另行评审。加载：MLX 0.6–1.9 秒加预热约 1 秒，Core ML 换新构建后第一次加载要编译约 95 秒、之后 0.6–3.6 秒。转写文字两边基本一致（短夹具上品牌名各错一点）。large-v3 的 MLX 没有用真实权重跑过（3 GB 没下载）。MLX 的 Whisper 要分词器仓库里的 `generation_config.json`，所以 `openai/whisper-large-v3` 的清单多了这个文件；装没装好按磁盘上的清单判断，早先装好的分词器组件照样算装好（Core ML 不受影响）但没有它，交给 MLX 包时 Worker 报 `MODEL_NOT_INSTALLED`：列出 MLX 包之前要让旧安装补下这个文件 |
| 生成素材的落点（§6.1） | 合成的音频与生成的图片是否允许一步放到时间线 | 只导入为候选素材，由后续编辑放置 |
| 远端节点的配对与加密（§6.7） | 以后是否增加加密与证书固定 | 已定：首版明文，与局域网打印机同等威胁模型；协议有版本门，之后可以加 |
| 导入素材后是否预热（§6.6） | 导入时是否自动启动 Worker 并预解码 | 不预热，按需启动 |
| `baocut.asr-result/v1` 与 `baocut.speech/1` 的关系（§6.6） | 应用时的字段映射；与格式规范 §5.2 模型的统一（格式规范 §9） | 结果与文档是两种 schema；文档只在扩展里引用原始结果 |
| 严格离线、退出后台策略、诊断数据保留 | 见产品设计 §12 | 同上 |
| 性能与第三方能力 | 目标数值与各 Adapter 的实际能力 | 以固定版本的实测为准（验收与测试 §4、§5） |
| 接口中只给出名称的类型 | `AgentInput`、`AgentEvent`、`RunContext`、`SampleRequest`、`FrameSurface`、`VerifiedCapabilities`、`FrozenCompositionInput`、`ResourceHandle`、`GrantScope` 等的字段 | 正文用文字说明了它们必须包含的内容；完整的 Schema 随契约单源（§13.2）生成 |
| 任务级的预算策略（§7.8、§12.5） | 一个任务（任务合同）总共可以花多少、跨 Provider 怎么合计；Grant 上的 `taskId` 与任务合同怎么对应 | 已定：任务合同的 `budgetPolicyRef` 指向一条任务预算，记调用次数与金额上限，跨 Provider 合计；任务里的每次外发（智能体的 Job、任务里启动的流程与它的子步骤）在 Grant 之外还要通过它，复用 Grant 账本的预留、开始与结算，崩溃之后只结算一次；金额上限只接受同一币种可估的调用，金额未知或混合币种算无法保证（§7.8）。Grant 的 `taskId` 只限定匹配，不承担任务预算（§12.5） |
| 验收检查的执行（§3.2、§9.8） | `quality` 种类的检查由 QualityService 怎样执行、何时执行、结果怎样回写；「必过」的检查没有通过时任务能否结算为完成 | 只定义与记录：检查与结果存在任务合同里，结果由用户或智能体记录；QualityService 不执行，任务的结算不看检查结果 |
| 任务保护的覆盖面（§3.2） | 应用后台 Job 的结果（转写写入、生成素材导入）与流程写视频是否也按所在任务的保护检查 | 已定：同样检查；被拒的 Job 结果留作候选，由用户 `jobs.reconcile apply` 决定，流程停在写视频的那一步（§3.2） |
| 实体保护的范围（§3.2） | 实体保护是否连带子实体（轨道上的实例、文档里的段落） | 不含子实体，保护轨道上的内容用 `interval` 加 `trackIds` |
| 进程内文本生成的预算（§7.8） | 智能体 Provider 内部、或以后的其他进程内 `generateText` 调用要不要逐次经账本 | 只有固定流程的翻译（Speech Worker 的每次模型调用）经账本；Job 都经账本 |
| 固定流程步骤的授权记录（§7.9） | 流程的步骤记录是否像 Job 一样带 `grant` | 不带：用量记在 Grant 上，步骤记录里没有 |
| 服务报告的费用（§7.8） | 各在线 Provider 的响应里哪些带费用、怎么换成金额 | 首版都不报告：完成的调用按估算或金额未知结算 |
| `context` 数据种类（§12.5） | 智能体对话上下文的外发怎么经 Grant 授权、Driver 怎么报告 | 只在模型里保留，不接入 Driver |
| 长期允许规则（§3.12） | 原型里审批卡片的「总是允许此命令前缀」：规则的匹配对象、作用域（会话、项目、全局）、存放与撤销 | 访问模式已定（§3.12）；长期规则未定 |
| 访问模式的细节（§3.12） | 任务进行中切换后 Driver 自带的权限设置何时跟上；本机模型的生成算 `edit` 还是 `command`；工具的「本任务内不再问」是否持久化；Codex 工具调用的时限；旧界面每次发送都带三档之一；Web 服务的浏览器随会话订阅 `tasks` 主题，会看到对外服务的审批（客户端名与摘要） | Driver 侧到下一条消息重建原生会话时才换；本机模型算 `edit`；只在内存里；`tool_timeout_sec` 一天（按 Codex 文档的配置项，未对真实二进制验证）；旧界面发过消息的会话固定为它选的那一档（默认 `ask`），界面迁移到四档后去掉；浏览器暂时看得到服务审批但处理不了（`approvals.*` 不在 Web 白名单里），对外服务的管理面收进浏览器之前要按连接过滤掉 |
| 导出草稿 `exports.updateDraft`（§9.11、§9.13） | 草稿存在视频里还是 Runtime 里；按视频还是按序列；与界面导出面板的同步 | 推迟：调用方在 `exports.create` 里给全部设置。输出帧率在 `video` 种类的 `ExportSettings` 里 |
| 便携包的其他形式（§5.8） | 文件夹形式；pax 扩展（超长路径、8 GiB 以上的文件）、压缩与签名；链接式的包（清单的 `linked` / `excluded-license`，接收方按摘要重新链接） | 只有单文件、不压缩、不签名的 ustar `.baocut`，全部素材收进包；写不进 ustar 的预检拒绝 |
| 便携包与本机记录（§5.8） | 正文里有本机路径的文档（例如以后的导出记录、导入记录）打包时去掉、改写还是拒绝 | 预检逐项拒绝（`EXPORT_PACKAGE_LOCAL_PATH`）；这两种记录还没有实现 |
| 便携包打开的暂存（§5.8） | 暂存目录放在来源目录里，进程被强杀时会留下以点开头的隐藏目录；是否改到 Runtime Home 并在启动时清理 | 已定：留在来源目录里（与新视频在同一个卷上，建成时直接改名），Space 不列；启动时的残留清理删掉够旧的、没在用的暂存目录与导出的隐藏临时文件（§5.8「残留清理」） |
| 工程导出的其余部分（§9.13） | 拷贝式（素材复制到工程旁边）；FCPXML 与剪映草稿；文字、字幕、代码画面与效果先渲染成媒体再引用；转场与音量包络的映射 | 只有 `xmeml`、只按引用；表达不了的逐项警告 `PROJECT_ITEM_OMITTED` |
| 成片导出的字体与排版（§9.11） | 字体是否进冻结快照（按摘要核对）；中文、日文折行要不要引入词典分词以对齐预览；彩色 emoji 与双向文字 | 已定：随渲染内核发布的字体随二进制走，不进快照；用到的本机字体按 face 冻结——预检排一遍字报出用到的 face，Runtime 在本机挑好、把文件、第几个与整个文件的摘要记进冻结快照，执行时 Worker 核对摘要后只装这些 face，变了以 `FONT_MISSING` 失败，冻结时找不到的照回退字体画并提示（§9.11 的「字体」）。预览与导出同一份解析与抽法（§9.1）；塑形、折行与双向文字在内核里，两边相同。按需下载的字体（§9.1）：字体目录里有、本机没有的族在导出任务里下载、按同样的写法冻结；不下载或下载不成时照回退字体画并警告 `FONT_NOT_DOWNLOADED`。打开视频时按全片清点要下载的字体（`fonts.usage`，与导出预检同一次排字，§9.1）；下载失败时直接用回退字体导出，给出警告。未定：要不要带彩色 emoji 字体（现在随内核的字体里没有）；品牌库字体怎样注入；浏览器会话没有 `fonts.*`，预览只用随内核的字体 |
| 成片导出的输出比例（§9.11） | 导出的宽高比与序列画布不同时：加黑边、裁切还是按新比例重排 | 已定：加黑边。画面按画布比例放到放得下的最大，居中，其余是黑色；排版按画布缩放，不重排（规则见命令与协议规范 §4.4）。界面的导出面板可选 16:9、9:16、1:1、4:5，缺省跟随画布；CLI 与智能体的导出工具都能给宽高 |
| 成片导出画不出来的内容（§9.11） | 内置生成器（声波、进度条等）与代码包合成何时有原生画法 | 拒绝并逐项列出，用户同意时跳过；GIF 动画与 SVG 已在内核里画（§9.1） |
| Render Worker 被强杀时的子进程（§9.11） | Windows 上没有进程组；Runtime 与 Worker 同时被强杀时谁来收 ffmpeg | POSIX 上 Runtime 杀 Worker 的进程组（有测试）；Windows 只杀 Worker，ffmpeg 留到它读写管道失败为止；两者同时被强杀时 ffmpeg 同样靠管道断开退出，不另设看门狗。从链接导入的 yt-dlp 同理：Windows 上取消只结束 yt-dlp，它合并音视频起的 ffmpeg 可能多活一会儿 |
| 导出的发布在不支持硬链接的卷上（§9.11） | exFAT 等卷上「确认不存在再改名」有很短的竞态窗口，是否改用独占创建再流式复制 | 接受这个窗口；同一目录同时导出同名文件的情况罕见 |
| 音频导出与预览的差异（§9.11） | 音量包络何时两边一起施加；增益高于 0 dB 时预览是否也放大；交叉淡化的 handles 不够时（素材比登记的短）怎么补 | 已定：音量包络、淡变、交叉淡化与闪避两边同一份计划（§9.11）。增益高于 0 dB 时导出按计划施加、预览不放大，handles 不够的部分静音；差异写进任务的 warnings |
| 远端下载与远端导出（§6.7） | 原型里节点还可以代为下载视频、导出视频。下载要节点主动访问外网，导出要把视频的冻结输入送到另一台机器 | 不做；节点只共享模型能力，每种能力由节点主人分别开关（节点协议规范 §10） |
| 文本模型的首批 Provider（§6.1） | `generateText` 先接哪几家 | 已定：OpenAI、Google、OpenAI 兼容端点 `custom:<slug>` |
| Web 服务（§4.8） | 浏览器客户端首版的能力集合；是否允许编辑与导出，还是只读与会话 | 已定：进入产品范围，只监听回环，默认端口 47622。首版的能力集合是桌面界面的协议减去设置的修改、模型服务的配置与凭据、本地模型包的安装管理、对外服务的管理（含访问链接的发放）、节点的配对与共享，以及任意路径的 `projects.open`（只能打开已登记的项目，或在默认项目目录下新建）；查询、会话、编辑、转写与生成、导出可用。白名单在服务配置里，可以收紧到只读。浏览器里的写入算用户本人（`user_local`），不是 `external:web`。选目录、按本机路径导入素材与「在文件夹中显示」在浏览器里不可用；会话图片和文件附件经同源、绑定会话的上传地址提供（§4.8），不开放任意本机路径。访问链接只由 CLI（`baocut web open`）发放，桌面界面的入口以后再加 |
| 模型接口服务的路由（§4.8） | 是否允许把外部请求转给在线 Provider 或节点；别名表的默认内容 | 已定：默认只到 `local`；在线 Provider、节点与智能体 Provider 各有一个默认关闭的开关，关着的那一类不在 `/v1/models` 里、按名请求 404；别名表默认只有 `whisper-1` → 本机的默认转写模型包；回环 `127.0.0.1:47621`，令牌按客户端发放，与 MCP 服务的互不通用；`stream: true` 以一个内容块的 SSE 返回；图片只有 `b64_json` |
| MCP 服务的令牌、审批与默认值（§4.8、§12.8） | 令牌按服务发放还是按客户端发放、是否跨重启；服务审批的时限；默认的端口、等级与范围；停止服务时在途的 Job | 已定：回环 `127.0.0.1:47620`；令牌按客户端发放，明文只显示一次，只存加盐哈希，跨重启有效，可单独吊销；审批 50 秒，超时按拒绝；默认 `ask` 与全部视频；停止服务断开连接并取消待处理的审批，已提交的 Job 照常跑完。无令牌的本机连接未定，首版不提供 |
| 固定流程的记录保留（§7.9） | 任务账本按条数裁剪旧记录时，子 Job 是否计入；失败的流程会不会被挤出账本、之后无法重试 | 已定：只数顶层 Job（200 条），子 Job 随父 Job；还能重试的流程最新 50 条另外保留 |
| 引擎侧的停止屏障（§7.4） | `runGeneration` 失效控制怎样经私有通道交给 Engine Host，在视频的串行提交入口检查 | 已定：取消时经 `runs.invalidate` 让这次执行失效。Engine Host 在提交入口以 `TASK_STOPPED` 拒绝，不开事务；Node 记为应用 `cancelled`。`tasks.stop` 等屏障确认，至多 5 秒。剩余缺口：Engine Host 重启时失效记录丢失、每个视频超过 1024 个执行时丢最早的，这两种都回退到 Node 侧的屏障，新的 Runtime 不重新登记；Task 与 Run 没有实现，执行代是任务的尝试序号；固定流程提交的转写任务另有自己的执行，取消父任务时经取消子任务失效 |
| 可查询的远端任务（§7.5） | 在线 Provider 给出远端任务 ID 之后，怎样续取结果 | 只有接口（`RemoteTaskQuery`）：现有的在线适配器都是一次同步请求，没有远端任务 ID。查到 `pending`、`running`、`succeeded` 一律 `needs-reconciliation`，不续取 |
| 正常停止时在跑的在线调用（§2.4、§7.5） | 退出前是否等在线请求返回 | 不等：标为 `needs-reconciliation`，预算保守扣。用户带着在跑的在线生成退出之后，每次都要对账 |
| 发布与应用之间的崩溃窗口（§7.3） | 产物写进产物库之后、结果与应用落账之前崩溃时，怎样认领这个产物 | 已定：写产物之前先在任务账本记下发布意图。重启时核对产物后认领：不重新推理，不重发请求，预算结算一次。剩余缺口：导出与固定流程自己的产物不走发布意图；意图记下了、产物还没写完就崩溃时，任务仍按「在跑」恢复。产物库里没有引用的文件由后台清扫删除（§7.3） |
| 产物引用的释放（§5.7、§7.3） | 账本裁掉的任务留下的产物引用（配音句子音频等，视频文档里还指着它们）什么时候可以释放；一直有排队任务时清扫永远推迟；缓存按修改时间淘汰、命中不刷新；不删的 `content-index/` 也计入缓存上限 | 未定。目前引用只增不减，清扫起点之前的产物一律保留 |
| 账本的持久性（§7.3、§7.8） | 任务、应用与授权账本写入后是否 fsync；预留的「已开始」是否落盘之后才开始执行 | 已定：三本账 fsync 文件与目录；「已开始」落盘之后才交出数据。排队的任务重启时预留已经开始的，按结果不明对账。剩余缺口：macOS 上 Node 的 fsync 不是 `F_FULLFSYNC`，断电时数据可能还在磁盘缓存里；产物库与别的文件不 fsync |
| 重试与续跑的范围（§7.5） | 哪些任务可以重新排队或 `retry`；本地分段任务能否从检查点续跑 | 只有有视频的转写与生成。没有视频的转写（模型接口服务）、节点代执行的、固定流程的步骤（用 `pipelines.retry`）与不经模型的任务不行。不从 staging 续跑，本地任务一律重新开始 |
| 对账时视频没有打开（§7.5） | `retry`、`apply` 是否替用户打开视频 | 不打开：以 `VIDEO_NOT_OPEN` 拒绝，用户先打开。只有重启恢复会按记下的位置重新打开 |
| 固定流程中断后的重复写入（§7.9） | 中断发生在写入视频或发布文件的途中，重试时怎样认出上一次已经写成 | 不认：重试重做这一步，可能多出一份译文文档或一个带序号的输出文件 |
| 从链接导入的范围（§7.9） | 支持的平台名单；登录状态的同意按次还是按站点记住 | 已定：进入产品范围；下载工具不随应用分发，用户同意后下载；读取浏览器登录状态要用户同意。本次下载显式选择浏览器，不按站点自动启用 |
| 受管外部工具的发布清单（§12.9） | yt-dlp 的版本、各平台文件的大小与 sha256、许可的写法 | 版本 2026.07.04 取自开发机上 Homebrew 安装的稳定版，没有对照上游核实；文件名与许可按它随附的 README。大小与 sha256 没有离线核实，留空，所以内置清单下 `externalTools.install` 一律以 `TOOL_MANIFEST_INCOMPLETE` 拒绝，不编造摘要；发布前由人对照上游的校验和文件填入 |
| 受管外部工具的签名（§12.9） | 是否校验上游发布的签名 | 首版只核对清单里的大小与 sha256，不校验签名 |
| 对外服务里的从链接导入（§4.8、§12.9） | MCP 服务是否提供工具安装与从链接导入 | 已定：工具的安装与同意不提供：它们下载并执行第三方程序，对外服务的审批不足以说明来源、版本与许可，只在桌面界面、CLI 与会话的智能体工具里提供。接口版本 2 起提供从链接下载（`download`）：只在用户已经装好 yt-dlp 并同意之后，下载进范围之内的一个已有视频或已登记的项目，按工具风险经服务审批（`ask`），没装或没同意时直接拒绝。之后放开 `newVideo`（与 `transcribe` 给 `url`）：要同时给已登记的 `project`，流程新建的视频登记进服务的范围（Agent 面设计 §11） |
| 从链接导入的首版范围（§7.9） | 是否新建视频；何时实现读取浏览器的登录状态 | 已定：放开。`link-import` 接受 `target`，可以新建视频、写进已有的视频或只下载；Runtime 与目录里的 `download` 工具（智能体与 CLI 共用）都已支持；转写进视频之后可以建立字幕层（`captions`，`transcribe` 给 `url` 时默认建）。下载界面只下载文件，可选转录；支持勾选一个或多个本机检测到的浏览器 Cookie、按顺序逐个尝试，读取失败以 `LINK_COOKIES_UNAVAILABLE` 提示处理 |
| 下载工具自己的网络请求（§7.9） | 是否把 yt-dlp 的请求限制在公网（固定解析结果、经本地代理检查每个请求） | 只在提交时检查链接与它的解析结果；DNS 变化、重定向与提取器另外请求的地址不在检查范围内 |
| 从网络取用的贴纸资源 | 原型从社区站点拉取动态贴纸目录与文件。来源的许可、校验与缓存 | 只用随应用发布的与用户自己上传的 |
| 云端账号 | 原型的隐私页有「删除云端账号数据」；本文没有 BaoCut 自己的云端账号 | 不存在云端账号；该项不做 |
| 用户库条目的交换格式（§5.9） | 音色包、术语表文件的具体格式与版本 | 已定：术语表是带 front matter 的 Markdown 表格（`baocut.glossary` 版本 1）；音色包是内嵌录音的 JSON（`baocut.voice-package` 版本 1，≤ 32 MiB）；颜色与字幕样式是 `baocut.library-item` 版本 1（§5.9） |
| 品牌库的叠加模板（§5.9） | 模板的内容格式、参数与拷进视频之后成为什么实体 | 只保留种类 `overlayTemplate`：`library.put` 以 `LIBRARY_KIND_RESERVED` 拒绝，等视频格式定义模板之后再开放 |
| 用户库条目在视频里的启用（§5.9） | 视频的哪一步用哪几张术语表、哪个说话人用哪个音色记在视频的什么位置；新视频怎样采用 `defaultEnabled` | 已定：视频里一份 `library-selection` 文档（视频格式规范 §4.6），记条目 ID 不记内容，经 `library.getVideoSelection` / `setVideoSelection` 读写；新建的视频由 `system:library` 写入默认启用的术语表，不进撤销栈。转写、翻译与配音在调用没有显式给出时用它；翻译用到的版本记在译文的 `glossaryRef`（§5.3） |
| 音色克隆的建立与删除（§5.9） | 何时、经哪个方法把参考录音上传给 Provider 建立克隆；条目删除或录音更换后怎样请求 Provider 删除旧克隆 | 已定：`library.createVoiceClone` 是一个 `voiceClone` 任务，`library.removeVoiceClone` 先删远端再清记录；重新克隆之后请求删除被替换的旧克隆，删不掉时告警。条目删除时不自动删除远端克隆，由用户 `removeVoiceClone` |
| ElevenLabs 克隆接口的细节（§6.4） | 按公开文档写成，离线没能核对：远端已经没有这个音色时删除返回的状态码；`requires_verification` 为 true 的克隆能不能立即用于合成；单个文件与总上传大小的上限 | 删除的 404 当作远端已经没有；需要验证的克隆照常记为有效，合成失败时如实报告；参考录音只受库的上限（20 MiB）约束 |
| 克隆上传途中崩溃（§5.9、§7.5） | Runtime 在上传之后、记下 `voiceId` 之前崩溃时，远端可能多出一个没有记录的克隆 | 任务中断，不重新排队，也不查询远端；多出的克隆由用户在供应商那边删除 |
| 配音外发的默认授权（§7.9、§12.5） | 启用语音合成的 Provider 时，默认 Grant 是否覆盖 `transcript` | 已定：不覆盖。ElevenLabs 的默认 Grant 只有 `document`；配音交出用户的文字稿，按外发最小化与明确同意由用户另外发放覆盖 `transcript` 的 Grant。没有时 `pipelines.start` 与 `baocut dub` 以 `forbidden`（`GRANT_REQUIRED`）拒绝，`remedy` 给出要执行的 `baocut grants create … --data transcript` 与发放之后重新执行的说明；桌面界面的拒绝另带待批准的项（`pendingGrants`，见「工具页的当场授权」），CLI 与对外服务不变 |
| 人声与背景分离的执行者（§6.1） | 用哪个本地模型或在线服务实现 `separateAudio`；能力视图怎样显示「没有配置」 | 已定：移植 v2 的本地人声分离（HTDemucs-FT）作为执行者，接到配音流程已有的分离接口。现状：MLX 与 candle 路径都已接入（§6.1），装了 `htdemucs-ft@mlx`（Apple Silicon）或 `htdemucs-ft@candle`（别的平台）时配音的分离由它执行，没装时跳过这一步，结果带 `separation: 'not-configured'` 与告警；`separateAudio` 在能力视图里，有出厂默认与用户默认值（设置页「音源分离」的「自动选择」与各模型包），编辑器的配音设置能打开分离。未实现：单独的分离命令与工具；分离交给局域网节点；整段解进内存，很长的素材内存占用随时长增长 |
| 配音的说话人与音色绑定（§7.9） | 多说话人的视频怎样逐个说话人选择音色；配音计划的 `speakerBindingId` 指向什么 | 已定：视频里的绑定（`library-selection` 的 `speakerVoices`）优先，其次参数 `voice`，最后模型的默认音色；绑定的音色不可用时那位说话人的句子不合成、逐句报告，不换成别的音色。`speakerBindingId` 是用了视频里绑定的说话人 ID，其余为 `null`（视频格式规范 §7.2） |
| 配音的入口（§7.9、§4.8） | 智能体是否另有翻译配音的工具；MCP 服务与 Web 服务是否提供 | 已定：没有单独的工具，会话里由智能体用语音合成与编辑事务完成（「入口决定执行者」）；MCP 服务与 Web 服务都不提供 `pipelines.*` |
| 配音轨的语言（§7.9） | 轨道要不要有语言字段 | 已定：不改格式。语言写在轨道名「配音（<语言>）」、实例的 `extensions['baocut.dub'].language` 与配音计划里 |
| 重新配音（§7.9） | 同一语言再配一次时替换旧的一组，还是新增一组 | 新增一组，旧的不动，由用户删除；导出按 `groupId` 选择 |
| 音频导出的来源在其他入口（§9.13） | 智能体的导出工具与视频导出是否接受 `source` | 已定：视频导出与智能体的 `export`（风险分级不变）都接受与音频导出相同的 `source`，只换这一次导出的声音计划，不改视频。多语言音轨（每种语言一条）未实现 |
| 视频格式待补的对象 | 原型里已有、视频格式规范还没有定义的可持久对象，逐批评审后进入格式。之后各批：逐词动效与逐条字幕样式覆盖、跨句动态排版、短片的交付标记、配乐分轨、逐句合成的多次取样、读音标注 | 已定：能确定性渲染的才进格式。首批的片段转场、元素的效果栈与裁剪、章节、声音闪避已进入格式（视频格式规范 §3.5、§3.9、§3.13）。元素模型一批按十五项裁决进入格式：整段运动（关键帧与元素动画，§3.15）、白板手绘与粒子元素、可视化元素（声波、进度、计时）（§3.7）、模板的画幅锁与字幕避让（§3.17）、口播剪口（§6.7）。没进格式的先由代码合成实现 |
| 渲染核心的移植（§9.1、§9.3） | 颜色与一致性以谁为准；预览是否共用实现；分批 | 已定：以 v2 为准，预览与导出共用移植来的同一份实现，v2 的基准图沿用。分批：基础库（音频处理、波形、媒体探测）；运动库与确定性原语；CPU 渲染核心与字体；元素层与 v3 的适配层；字幕渲染；原生编解码与导出循环；GPU 合成与预览 WASM；响度母带与工程导出。现状：纯基础库里的 `audio-dsp`、`waveform`、`media-probe`，运动库 `motion`、确定性原语 `scene-primitives`、CPU 渲染核心 `render-raster`（连同内置字体）、元素层 `timeline-render` 与字幕渲染 `subtitle-render`（连同字幕样式数据）已从 v2 原样移植（算法、常量、公共接口与测试不变，算法内部仍是浮点秒；夹具在各 crate 的 `tests/fixtures/`，内置配方在 `motion/presets/`）。适配层一批已接线：`frame-render` 把帧计划画成帧，导出与预览（经 `preview-wasm`）共用，`render-core` 与界面的 Canvas 画法删掉（§9.1）；`audio-dsp` 只有 Render Worker 的响度母带引用（§9.13），`media-probe` 仍没有进程引用，素材探测仍走 `media-core` 的 ffprobe 子进程。对拍 v2 预览壳、v2 编辑器生成物与 BCF 规范的测试保留源码、标为 ignore。原生编解码 `media-native` 同样原样移植，导出循环未接。`render-raster` 缺省开 `media`（帧供给与成片编码都是平台原生优先、ffmpeg 兜底），v2 的测试与基准图按 v2 的判据通过；不编译的只有门在 `program`（`bcut-compile` 不移植）与 GPU feature 之后的测试（§13.6）。需要 ffmpeg 的测试在没有 ffmpeg 时跳过；`media-native` 的写入测试在没有原生编码器时跳过，`render-raster` 的成片编码测试回落 ffmpeg、两者都没有才跳过；Lottie 语料的指纹测试要 `BCUT_LOTTIE_CORPUS` 指向仓库外的语料，没有时跳过。`timeline-render` 与 `subtitle-render` 的测试按 v2 的各 feature 组合通过，字幕的基准图、帧哈希、契约与对拍原型（`designs/` 里的 `model-subanim.js`，要 node）都按 v2 的判据；标为 ignore 的是读 v2 贴纸库（`apps/baocut/assets/stickers`，元素素材未带来）的五条、点名 v2 样式画廊源文件的一条，；「字幕排版不许有第二份实现」门禁里扫到 `render-core` 的两条已随 `render-core` 删掉而打开。响度母带一批已接线：v2 导出的母带链（积分响度归一与真峰值限幅交替三轮、真峰值静态兜底）移植进 `export-worker` 的 `master`，测试与 v2 对整段的算法逐位对拍（§9.13）。未实现：原生编解码与导出循环、GPU 合成与工程导出各批 |
| 元素模型（§13.4） | v3 原生新建的视频怎样对上 v2 的元素 | 已定：视频格式直接采用 v2 的元素种类与参数，不保留对现有 v3 视频的兼容；字段已写进视频格式规范 §3.4–§3.9、§3.15–§3.17 与 §6.7，`schemaVersion` 升到 3，版本 1–2 拒绝打开（规范 §1.4）。未实现：`video-model`、`packages/protocol`、VideoEngine 与编辑器要一起改，单独成一批，排在渲染核心的元素层之前。字段对照、十五项裁决与分批见 [元素模型对照](../design/timeline/element-model-mapping.md) |
| 时间线语义的移植（§13.6） | `bcut-timeline` 移植了什么；v2 的元素模型怎样对上 v3 的视频格式；接线的顺序 | 已定：`crates/timeline` 是 v2 `bcut-timeline` 的原样移植，算法、常量与公共名字不变，测试与它们读的夹具全部带来（夹具在 `crates/timeline/tests/fixtures/`），依赖 `motion` 与 `scene-primitives`；`bcut-protocol` 里用到的模板层、水印换算读的四个品牌类型与 `timeline.json` 的版本常量收成内部的 `protocol` 模块，模板层的 JSON Schema 导出没有带来。画面文字（`screentext`）随 crate 带来，不接线（见「画面文字」）。v2 元素模型与 v3 格式的逐项对照、时间的换算与量化、旧数据的去向、受影响的模块与分批、待裁决的问题在 [`docs/design/timeline/element-model-mapping.md`](../design/timeline/element-model-mapping.md)，v2 的设计记录在同一目录，文中的数据模型名指 v2。分批：crate 移植；格式裁决；元素模型进视频格式（见「元素模型」）；旧版项目导入改写并重新导入；渲染适配层；剪口、跟随、关键帧与闪避的接线；界面经 WASM 调用。对照文档第 7 节的问题已裁决（对照文档 §7.1），格式裁决一批已写进视频格式规范。旧版项目导入已改写：写第 3 版视频，元素字段落到正式字段，剪口集合存成文档，规则与还没有对应的字段在对照文档第 5 节。编辑语义一批已接线：VideoEngine 的手动剪口与恢复（`addCuts`、`restoreCut`）调 `timeline::cuts`，拆分、修剪、波纹与合并（`joinItems`）的关键帧换算调 `timeline::keyframes`；闪避的增益曲线（含按文稿触发）由 `render-graph` 调 `timeline::duck`；`follow-cuts`、`sequence-fixed`、到序列末尾、`item-local` 与 `speech-anchor` 已实现，剪辑建议的检测与接受（`proposeCuts`、`acceptCutSuggestions`）调 `timeline::detect`，界面的文稿剪辑、恢复与剪口带改范围发 `addCuts`、`restoreCut`；留下的见「编辑语义的待定项」。渲染适配层一批已接线（`frame-render`，§9.1）。界面一批已接线：经 `bindings/editor-wasm` 调舞台的框、引擎的取值区间与缺省值、声波、进度条与彩纸的样式目录（§13.2）；留下的见「编辑语义的待定项」 |
| 编辑语义的待定项（§13.6） | 编辑语义一批没有做完、或按假设做了的部分 | 已定：按时刻放置的实例从新建起缺省 `follow-cuts`，有没有剪口集合都一样，`sequence-fixed` 要显式选择（`updateItem` 也能改），早先没写策略的实例读作缺省，不做迁移（视频格式规范 §3.16）。已定：`addCuts` 的素材时长由引擎读当前素材版本的探测数据，调用方不传，没有已知时长时拒绝。已定：剪辑提案是最小的文档 `baocut.editorial-proposal/1`（视频格式规范 §6.2）：建议剪掉的源区间、类别、文字与置信度。`proposeCuts` 移植 v2 的口癖与停顿检测（`timeline::detect`，缺省参数同 v2），v2 没有重复片段的检测，不提出；`acceptCutSuggestions` 编译成带 `ref` 的 `addCuts` 并在同一笔事务里标成 `accepted`，转写改过之后拒绝（`proposal-stale`）。已定：`speech-anchor` 已接线（`video-engine` 的 `anchors`）：每笔事务最后按与按文稿闪避相同的词投影（`render_graph::text_plan`）与 `timeline::anchors` 的规则重求并摆放，出现处按 v2（中点映射到不止一处即歧义，`occurrenceId` 指明作用实例或它拆分前的实例），求不出、摆不下的留在原处，列在回执的 `orphanedAnchors` 与 `videos.inspect`，不落盘（视频格式规范 §3.16）。已定：`item-local` 已接线（`video-engine` 的 `item_local`）：每笔事务最后按目标前后的变化与拆分的 lineage 补算，带源时钟的目标按源时刻跟、拆开跟锚点所在的一段，起点修剪越过锚点时到新起点，目标删掉时一起删并列在回执的 `removedWithTarget`（视频格式规范 §3.16）。已定：`explicit-link-group` 不在这一版的范围，只保存与校验形状，编辑时不移动；它是 v3 自己的，联动规则未定。同一个剪口在音画两条轨道上映射成部分重叠的区间时整笔拒绝（`scope-misaligned`），假设错开放置的音画由用户先对齐。到序列末尾的实例锁着也跟着更新（规范 §3.16）。`durationPolicy` 的 `fixed` 还没有操作能写。已定：界面的文稿剪辑、恢复与剪口带的改范围都走素材的剪口集合：选中的词换成素材秒编成一笔 `addCuts`；恢复按剪口集合找盖住选中的词（或时间线上那处接缝）的剪口，编成 `restoreCut`，整个剪口放回；改范围是同一笔事务里的 `restoreCut` 加 `addCuts`，撤销一步回去。原来按实例摆放算区间的 `removeRange` 与 `moveItems` 加 `trimItem` 的路径连同它们的测试已去掉。不是剪口剪掉的（拖片段边缘裁掉的、剪口集合出现之前剪的）恢复时照实拒绝（`untracked`），改范围还要剪口在半帧之内正好盖住接缝（不然 `partial`）。与原来的差别：恢复的粒度是整个剪口，不再只露到选中的词为止；`addCuts` 只在播放这个素材的实例所在的轨道上波纹删除，别的轨道只移动 `follow-cuts` 的实例，所以与被剪的实例链接（`linkGroupId`）、又显式选了 `sequence-fixed` 的实例会与它错开；横跨剪口的字幕按 `follow-cuts` 缩短，不拆开。剪掉一章（`chapters.ts`）还是 `removeRange` 加删标记、前移后面的章，没有记进剪口集合。字幕断行没有统一成 crate 的 `derive_cues`：换过去会改变字幕条与它们的 ID，差别见 §7.9。转场时长的上限（10 秒）与配音变速的区间（0.1–10）还是 `video-engine` 里的字面量，`editor-wasm` 不依赖 VideoEngine，界面各抄一份，挪成 `timeline` 或 `video-model` 的常量之后再换。文字预设的 51 条仍是界面的数据：v2 配方的 ID 与样式字段和界面的不同，要先逐条对照，解析文字预设又要连带动画与图形的整张注册表。新建文字时量框仍用 Canvas 2D：渲染量字的那份在 `render-raster` 内部，要放进 `preview-wasm`（字体在那里）得先把它公开 |
| 快速修正（§9.11） | 基线产物放在哪里、保留多久、何时失效 | 已定：保留这项能力，优先级低，排在渲染核心移植之后。存放规则未定 |
| 移植代码的许可（§13.6） | v2 是专有许可，v3 的原创代码与移植代码按仓库当前许可分发 | 已定：v3 采用 [BaoCut Community License 1.0](../../LICENSE)，许可边界见[根 README](../../README.md#许可)；v2 仍是私有的。移植来的文件不带 v2 的许可声明；第三方组件保留自己的许可，已按 Apache-2.0 授出的历史材料权利不撤回 |
| 内置字体与元素（§13.6） | 字体（约 25 MB）与元素素材是否随应用发布；CC BY 素材的署名放在哪里 | 已定：字体与元素素材随渲染核心一起带来、随应用发布，带着各自的许可文件与署名。现状：字体随 CPU 渲染核心带来（`render-raster/assets/fonts/`，含 `LICENSES/`、`NOTICE.md`、`README.md` 与来源清单 `verified-sources.json`、`subtitle-design-fonts.json`）；字幕渲染读的字幕样式（`core/assets/captions/styles`、配方贴图及其许可说明、`subtitle-designs.json`）随 `subtitle-render` 带在它的 `assets/`，字体不另带。元素素材（v2 `core/assets/elements` 与应用里的贴纸库 `apps/baocut/assets/stickers`）与样式画廊的 `subtitle-gallery.json` 没有模块读，留给用到它们的批次。未定：署名在应用里的呈现位置 |
| 画面文字（§13.6） | v2 的画面文字扫描与翻译（约 3700 行）在 v3 的产品设计里没有对应的功能 | 已定：要这个功能，优先级低，排在各条移植线之后；产品设计与视频格式里的落点在移植前补上。未实现 |
| 工具目录与视频目标（§7.9） | `tools.list`、`tools.candidates`、流程参数的 `target`（`entryId`、`create`）与代开视频 | 已定：`tools.list` 是静态注册表加此刻的可用性，`tools.candidates` 按工具的规则从内容索引与 Space 目录给出可选的视频与文稿，不打开视频；合同见命令协议规范 §4.1。内容索引的缓存（版本 2）记下文稿、译文与配音组的事实（§5.11），旧版本的缓存读回后排队重读。`translate`、`dub`、`link-import`、`transcribe` 接受 `target`（`videoId`、`entryId`，`link-import` 与 `transcribe` 另有 `create`，`transcribe` 的 `create.media` 是本机媒体文件）并代开视频，合同见命令协议规范的 `pipelines`。`transcribe` 流程已实现，目录里的输入是 `file`、`video`；链接经 `link-import`。翻译字幕的字幕文件输入走 `translate-subtitles`（见「字幕文件的翻译」）。未实现：索引里的译文过期不判断术语表的改动 |
| 转录工具的字幕层（§7.9，产品设计 S01） | 转写应用之后由谁建立字幕层；已有字幕层时怎样避免重复 | 已定：`transcribe` 与 `translate` 流程的最后一步 `captions` 在一笔事务里建立字幕文档与字幕实例，同一份文稿（译文）已有字幕层时跳过；新的原文字幕层在同一素材已有原文字幕显示着时以停用放上去。`transcribe` 默认建；`translate` 的流程参数默认不建，工具入口（工具目录的 `execution.params`）、CLI 与编辑器的「翻译成…」（`translate-run`，连同 `bilingual`）带上 `captions: true`；编辑器的「生成字幕」「重新转录」（`transcribe-run`）走 `transcribe` 流程。编辑器都按摘要的 `captions` 报告结果，新建时按它的 `transactionId` 撤销。`link-import` 转写进视频之后同样有 `captions` 一步，流程参数默认不建；`transcribe` 给 `url` 时带上 `captions: true`（`noCaptions` 时不带），`download --transcribe` 不建 |
| 字幕文件的翻译（§7.9） | SRT、VTT 直接翻译时的时间与分句；「以此新建视频」时作为低精度文稿还是字幕文档导入 | 已定：文件到文件的 `translate-subtitles` 流程，逐条翻译、不重新分句，时间码原样保留并在发布前读回核对；读不准的文件提交时拒绝。合同见命令协议规范的 `pipelines`。未实现：「以此新建视频」（计划按没有逐词时间的低精度文稿导入，产品设计 S01）；行内样式标记不保留 |
| 工具新建视频的默认项目（产品设计 §2.7） | 第一次使用、还没有任何项目时放在哪里 | 未定：默认上次用的项目；没有项目时先让用户选一个目录建项目，不自动在素材旁边建 |
| 工具页的当场授权（§7.9、§12.5） | 待批准项的返回形状；一次同意覆盖流程里的几种外发 | 已定：`details.pendingGrants` 是 `GrantRequestItem` 的数组（`reason` 多了 `exhausted`），只给在场的用户（主网关上的桌面界面连接）的 `pipelines.start` 与直接任务；一次拒绝覆盖流程的全部几种外发，`remedy.commands` 合并保留；客户端逐项 `grants.create` 之后用同一个 `commandId` 重新提交。Runtime 不自动发放、不放宽；CLI、智能体、浏览器会话与对外服务不变（§7.9）。未实现：桌面界面还没有接上待批准项 |
| 字幕与翻译核心的移植（speech-doc） | 第一批移植了什么、哪些留在 v2 | 已定：`crates/speech-doc` 是 v2 `bcut-flow-core` 的原样移植，算法、阈值、公共类型与函数名不变，它的测试全部带来：转录后处理（词化、断句、分段、说话人）、翻译与对齐的载体和引擎（`filepipe`、`engines`、`align_block`）、字幕切分与排版（`cue`、`split`、`layout`）；另把 v2 `bcut-speech-core` 的 `RowIn`、`WordIn` 与 `word_breaks`、`bcut-protocol` 的转录版本常量收成内部模块；`export` 是 v2 内核的字幕导出（srt / vtt / ass / json-words，双语按源 Cue 与译片边界的并集分段，缺译不回退原文），只依赖 `TranscriptDoc` 与纯数据；`check` 只有报告摘要，`translate_flow` 是 translate 收尾轮的纯判定。v2 里读写工程目录、走时间线投影、调用 Provider 的部分没有带来（含 `check_verdict`、`align_params_for`、`render_project_timeline_subtitles` 与只给它用的 `timeline_timed_words`、读 `project.json` 的 `ass_play_res`）。依赖字幕渲染或时间线 schema 的两块纯函数在 `subtitle-render`：按项目样式生成 ASS 样式头的 `ass_style_sheet`（产出本 crate 的 `AssStyleSheet`，画幅由调用方传入）与检查的 `place_out_of_canvas`；本 crate 不反向依赖渲染。测试夹具在 `crates/speech-doc/tests/fixtures/`；模型应答的离线回放在 `crates/speech-doc/bench/`（不调用模型）；设计记录在 `docs/design/subtitle/`，文中的模型名指 v2。未定：没带来的部分在接线时怎样补。现在 `speech-worker` 与 `bindings/editor-wasm`（经 `speech-doc-bridge`）引用这个 crate，映射与接线见下一行 |
| 字幕与翻译核心的接线（§7.9） | `speech-doc` 接进流程的顺序 | 已定：整个 crate 原样移植，不用 TypeScript 重写；要调用模型的引擎放在 `speech-worker` 进程里，模型调用交回 Runtime。分四批：crate 与测试集的移植；`TranscriptDoc` 与 v3 文档的映射及格式补充；`translate`、`translate-subtitles` 与字幕层改用 crate（翻译简报、阅读预算、质量门、对齐、译文字幕的时间投影、检查），同时让从链接导入的转写建字幕层、给智能体建字幕层的操作；转录后处理（润色、分段、说话人修复）。第二批已完成：`crates/speech-doc-bridge` 的 `to_transcript_doc` 与 `from_transcript_doc`；`baocut.speech/1` 补了 `glue`、`userBreaks`、`autoBreaks`、`layoutProfileId`、`paragraphBreaks`、`stages`，`baocut.translation/2` 补了 `displayRewrite.naturalFingerprint`、`alignment.split`、块的 `confidence` 与 `flags`（视频格式规范 §5.2、§5.3），`video-model` 有了这两种正文的 DTO，引擎核对补充字段的形状；v2 的样例与现有流程写出的正文往返无损。已定：句子派生与源句指纹统一成 crate 的那一套（v2 的规则），第三批里翻译流程与界面改为调用它，不再各算各的；`baocut.translation/1` 不保留，旧项目导入直接写 `/2` 与补充的字段；没有块的块级对应按 v2 的语义保留，规范随第三批改。第三批的前半已完成：`crates/speech-worker`（协议 `speech-worker/1`，命令协议规范 §4.5）在一个进程里跑翻译（简报、分页翻译、质量门与补做、对齐、收尾轮、`derive_trans_cues` 的时间投影），经映射写出 `baocut.translation/2` 正文与目标语言的字幕条，每页一个检查点、续跑不重做；`@baocut/jobs` 的 `runSpeechTranslate` 启动它、把每次模型调用经 `text.generate` 发出并交回，`npm run build:engine` 一并构建。与原来翻译一步的差别（已生效）：原文与目标语言的主子标签相同时拒绝（v2 的行为，例如 `zh` 译 `zh-Hant`）；补做之后仍缺的句子以 `MODEL_OUTPUT_INVALID` 失败、检查点保留；术语不按批截断；不做 v2 的分析一轮。已定：界面与 Node 经 `bindings/editor-wasm` 调 crate 的分句与指纹（边界是 `baocut.speech/1` 正文，时间是整数刻度）。第三批的翻译一步已接线：`translate`（连同配音缺译文时的翻译）经 Worker 翻译，`captions` 用 Worker 的字幕条；翻译流程、界面的译文核对、配音的过期判断与内容索引都按 crate 的句子与指纹核对，`baocut.sentences/1` 与 `sha256:` 指纹删除，不兼容。给智能体建字幕层的操作已完成：`captions_create`（§3.5），译文按句级对齐与显示宽度切条、不经 Worker，智能体写的译文的对齐由 Runtime 按句子补上。未实现：`translate-subtitles` 与原文字幕层改用 crate（原文字幕断行的差别见 §7.9）；从链接导入的转写建字幕层；检查；第四批；映射的其余调用方，旧项目导入不写补充的字段（换行与分段仍在 `legacy` 里），`baocut.translation/1` 不能换算 |
| 阅读速度表（§7.9） | v2 里有三份口径不同的表：切分用的、翻译预算用的、排版按文字系统的 | 已定：统一成切分用的那一份（zh 9、ja 与 ko 13、th 15、ar 与 hi 18、其他 21）。现有测试集对泰语、阿拉伯语、印地语的翻译预算没有覆盖，统一之前先补这几种语言的用例。未实现 |
