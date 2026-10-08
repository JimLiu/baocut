# 面向外部 Agent 的能力面：CLI、MCP 与 BaoCut skill

> 方案稿，2026-10-06，未实现。目标：让别的 Agent（Claude Code、Codex、Cursor、Gemini CLI 等）不经 BaoCut 自己的智能体，也能用 BaoCut 的能力完成转录、翻译字幕、配音、剪辑、下载、转码与导出。三样东西一起设计：命令行 `baocut`、对外的 MCP 服务，以及教外部 Agent 使用它们的 `baocut` skill。
>
> 本文是设计，不是参考手册：命令与工具的精确参数以实现后 `baocut spec` 的输出为准，这里只定名字、分层、约定与边界。不考虑与 v2（`bcut`）或现行 v3 CLI 的兼容；v2 的 CLI 设计与 skill 只作参考。

## 目录

1. [问题与目标](#1-问题与目标)
2. [一个目录，三个消费者](#2-一个目录三个消费者)
3. [主体与权限](#3-主体与权限)
4. [Agent 面的能力目录](#4-agent-面的能力目录)
5. [CLI 约定](#5-cli-约定)
6. [MCP 约定](#6-mcp-约定)
7. [现有 CLI 命令的去向](#7-现有-cli-命令的去向)
8. [BaoCut skill](#8-baocut-skill)
9. [要修订的规范条目](#9-要修订的规范条目)
10. [实施顺序与验收](#10-实施顺序与验收)
11. [已决事项与未决问题](#11-已决事项与未决问题)

---

## 1. 问题与目标

### 1.1 现状

v3 已经有三个面向程序的入口，但只有两个共用实现：

| 入口 | 实现 | 消费者 |
| --- | --- | --- |
| 工具桥（会话里的智能体） | `ToolCatalog` + `ToolSet`（zod schema、说明、按主体分发）+ `McpEndpoint`，`packages/runtime-core/src/agent-tools/` | Codex、Claude 等原生会话 |
| 对外 MCP 服务 | 同一份 `ToolCatalog`，加 `ServiceScope` 与 `MCP_SERVICE_TOOLS` 的视图 | 其他应用里的智能体 |
| CLI | `apps/cli/src/main.ts` 手写：2800 行，400 行 `USAGE`，逐个命令直接调网关方法 | 人、脚本，以及凑合着用的 Agent |

架构设计 §3.6 写着「工具定义、界面控件和 CLI 帮助从同一个注册源派生」，CLI 一直没有兑现。后果是 Agent 视角下的三处摩擦：

- **同一件事三个名字。** 转写在工具桥是 `models_transcribe`，在 CLI 是 `baocut transcribe <videoId> <assetId>` 与 `baocut transcribe --file`，参数名也不同；Agent 在 skill 里学到的叫法换一个入口就对不上。
- **帮助是给人读的长文。** `baocut --help` 一次打出 400 行，没有机器可读的自描述，Agent 要从中找一个旗标就得把整段读进上下文。
- **「tools」撞名四处。** 协议的 `tools.*` 是工具页目录，`baocut tools` 是 yt-dlp / ffmpeg，`baocut toolbox` 又是工具页目录，而智能体的 `ToolCatalog` 叫工具目录。

另外对外 MCP 服务按 §4.8 不开放新建视频、建字幕层、取消任务与从链接导入，外部 Agent 靠它做不完「链接 → 转写 → 翻译 → 字幕 → 导出」这一条最常见的链路；现有 CLI 又默认连桌面端拉起的 Runtime，App 没开时什么也做不了。

### 1.2 目标

- **一个目录。** CLI 成为 `ToolCatalog` 的第三个消费者：命令名、参数、帮助与错误都从目录派生，手写的 `USAGE` 整段消失。新能力在目录里登记一次，三个面同时出现。
- **一条映射规则。** MCP 工具 `a_b` 就是 CLI `baocut a b`，参数同名；skill 与错误里的 `next` 只要说一次这条规则，Agent 在哪个入口都能照做。
- **Agent 在有限上下文里快速找到指令。** 一屏的 `--help`、按需的 `help <命令>`、机器可读的 `spec`、带 `next` 的错误、按任务分类的 skill 目录页；深度靠按需展开，不靠一次读完。
- **不开 App 也能用。** CLI 自己能拉起 Runtime，用完按归属规则收尾。
- **范围。** 本机模型能力（转写、语音合成、本地模型包）、视频渲染与导出、视频下载、视频编辑与剪辑、转码；文稿与译文的读写（Agent 自己做文字工作）。会话、模板、对外服务管理、凭据等仍在 CLI 里给人用，但不进 Agent 面。

---

## 2. 一个目录，三个消费者

```text
                    ┌────────────────────────────────────────────┐
                    │ ToolCatalog（Runtime 进程内）              │
                    │  ToolSet × n：schema · 说明 · 风险 · dispatch │
                    │  ToolCatalogView：按主体过滤与改写说明      │
                    └──────┬───────────────┬──────────────┬──────┘
                           │               │              │
   AgentPrincipal          │ ServicePrincipal             │ LocalPrincipal（新）
   AgentScope              │ ServiceScope                 │ LocalScope（新）
                           │               │              │
                 McpEndpoint（工具桥）  McpEndpoint（MCP 服务）   网关方法 catalog.list / catalog.call
                           │               │              │
                   会话里的智能体     其他应用里的 Agent      baocut CLI（终端里的 Agent 与人）
```

### 2.1 不新发明共用层

共用层就是现有的 `ToolCatalog`。本方案不再抽一层「操作注册表」给 CLI 与 MCP 共用，而是补齐三件事：

1. **CLI 的主体与范围**：`LocalPrincipal` 与 `LocalScope`（§3）。
2. **网关方法** `catalog.list` 与 `catalog.call`：列出目录（含 JSON Schema、说明、风险与注解）；按名调用，参数是 JSON。两者走现有的 WebSocket 网关与本机令牌，CLI 已有的 `BaoCutClient` 直接用，任务进度经同一个连接的 `jobs` 主题订阅。
3. **CLI 的派生层**：从目录派生命令树、旗标解析、`--help`、`spec` 与输出渲染（§5）。

不选「CLI 直接做本机 `McpEndpoint` 的客户端」：那个端点的令牌绑定会话（`AgentGrants`），CLI 没有会话；而且 CLI 还要订阅进度、调用本机管理方法，网关连接本来就要有。

### 2.2 目录项的形状

每个目录项（工具）在现有 `ToolDefinition` 之上补齐这些字段，三个面都用：

| 字段 | 用途 |
| --- | --- |
| `name` | `<名词>_<动词>` 或一级动词（§4.1）。对外合同，改名升接口版本 |
| `title`、`description` | `description` 第一句是一行摘要（`--help` 与 MCP 列表只取它），后面才是细则 |
| `inputSchema` | zod → JSON Schema。每个字段有 `description`，枚举列全，CLI 旗标由它派生 |
| `annotations` | MCP 标准的 `readOnlyHint`、`destructiveHint`、`idempotentHint` |
| `risk` | `TOOL_RISK` 的等级（`read` / `command` / `high` …），三个主体各自据此决定要不要确认 |
| `effect` | `query`（只读）、`mutation`（进撤销栈）、`job`（返回 `jobId`）、`destructive`（不可撤销）。skill 的硬规则按它说话：`job` 要等、`mutation` 要读回执、`destructive` 要 `--yes` |
| `examples` | 一到三个最小调用示例（JSON 参数），`help <命令>` 与 `spec` 带出 |
| `surfaces` | 在哪些面出现：`agent`（工具桥）、`mcp`、`cli`。默认三个都有；只给会话里的智能体的（`tasks_*`、`grants_request`、`downloads_save`）标 `agent` |

`effect` 与 `examples` 是新字段，其余已有。现有 `MCP_SERVICE_TOOLS` 的 `read` / `write` 由 `annotations.readOnlyHint` 推出，不再单独维护一张表。

### 2.3 生成与快照

- **运行时**：`catalog.list` 是真相。CLI 连上 Runtime 后按它解析参数，Runtime 版本不同时帮助自然跟着变。
- **离线**：`baocut --help`、`baocut help <命令>`、`baocut spec` 在没有 Runtime 时也要能用（Agent 常先看帮助再决定要不要启动）。构建时把目录导出成 `apps/cli/src/generated/catalog.json`（生成物，`tools/` 的脚本写出，不进 git），测试断言它与 `ToolCatalog` 当前的输出一致。
- **一致性测试**：每个目录项必须有 `description` 首句、每个字段必须有 `description`、`examples` 必须通过自己的 schema；CLI 派生的命令树里不得出现目录之外的 Agent 面命令。

---

## 3. 主体与权限

### 3.1 三种主体

| | 会话里的智能体 | MCP 服务的客户端 | CLI |
| --- | --- | --- | --- |
| 主体 | `AgentPrincipal { conversationId }` | `ServicePrincipal { serviceId, clientId }` | `LocalPrincipal { client: 'cli', cwd, projectDir? }`（新） |
| 范围 | 会话的来源目录与 TaskContract | 访问策略：视频名单 + `read` / `ask` / `auto` | 用户本人能访问的一切：按 `cwd` 或 `--project` 解析相对路径，视频用 `videoId` 或目录 |
| 写入的 actor | `agent` | `agent`，`external:<serviceId>` | `user_local`：与桌面界面相同，共用撤销栈 |
| 确认 | 按访问模式与风险在会话里等用户 | `ask` 下生成服务审批，50 秒超时 | **不走 BaoCut 的审批。** CLI 是用户本人在终端里操作，或用户授权的终端 Agent；确认由 Agent 宿主（Claude Code、Codex 自己的权限提示）负责。`destructive` 的调用要 `--yes` |
| 外发数据 | Grant 覆盖，否则审批 | Grant 覆盖，`auto` 下无 Grant 即拒绝 | 与桌面界面相同：在线 Provider 已由用户启用即可（启用是持续授权，架构设计 §6.4） |
| 任务的提交者 | `{ kind: 'agent', id: 会话, taskId }` | `{ kind: 'service', id, clientId }` | 与桌面界面的连接提交相同；审计里记 `client: 'cli'` |
| 看得到的任务 | 本会话提交的与来源目录里已打开视频上的 | 自己提交的 | 全部（与任务中心相同） |

### 3.2 LocalScope 的规则

- **路径**。素材导入、导出目标、转码输出按 `cwd` 解析相对路径，绝对路径照收；视频目录（含 `video.db`）与 `.bcut` 仍然不可写（这是引擎的保护，不是范围的限制）。没有 `PATH_OUTSIDE_PROJECT` 一类的目录约束：终端里的用户本来就能读写自己的文件。
- **视频的指代**。`video` 参数接受 `videoId`、视频目录的路径（绝对或相对 `cwd`）或 Space 条目 id；解析顺序是目录 → `videoId` → 条目。没打开的视频由 Runtime 在调用期间打开，调用完不强制关闭（与工具页相同）。
- **项目**。`--project <目录>` 显式给；不给时从 `cwd` 向上找 `.bcut/project.json`；再没有时按「无项目」处理，新建视频落到 `BAOCUT_PROJECTS_DIR` 并在结果里说明。
- **不能做的事**。CLI 的 Agent 面同样不提供设置、凭据、服务管理、任意命令执行；这些在 CLI 的管理桶里（§7），不进目录，skill 里写明要先征得用户同意。

### 3.3 终端 Agent 的责任

CLI 不区分「人敲的」与「Agent 敲的」。要让 Agent 宿主的权限提示能起作用，CLI 做三件事：

- 每条有副作用的命令在 `--help` 首句与 `spec.effect` 里标出效果，宿主的提示规则（例如 Claude Code 按命令前缀允许）能据此分类。
- `destructive` 的命令没有 `--yes` 时打印将要做的事并以退出码 4 拒绝，不进交互确认（没有 TTY 的 Agent 等不到）。
- `edits apply` 接受 `--dry-run`（走 `prepareBatch`，只返回影响），让 Agent 先看后提交。

---

## 4. Agent 面的能力目录

### 4.1 命名规则

- **MCP 工具名 `<名词>_<动词>`，CLI `baocut <名词> <动词>`**；一级动词没有名词，两边同名。多词动词 MCP 用 `_`、CLI 用 `-`：`captions_create` ↔ `baocut captions create`，`import_package` ↔ `import-package`。
- **名词用协议命名空间的复数形式**（`videos`、`documents`、`edits`、`captions`、`assets`、`jobs`、`models`、`space`、`projects`、`artifacts`、`skills`），与网关方法 `videos.*`、`jobs.*` 机械对应，不再发明第三套名字。`space` 本身是单数专名。
- **参数名同一套**：目录字段名按 kebab-case 直接成为 CLI 旗标：`video` → `--video`，`documentId` → `--document-id`，`layoutProfileId` → `--layout-profile-id`；MCP 面用字段名本身。每个工具最多一个位置参数，由目录项的 `positional` 字段指定（通常是 `video`、`url` 或 `file`）。
- 名字一律用术语表的词：可编辑的实体是 `video`，目录是 `project`，时间线上的是 `item`，媒体文件是 `asset`。

### 4.2 一级动词：固定流程与生成

都是 `effect: 'job'`，返回 `jobId`；CLI 默认 `--wait`（§5.4），MCP 配 `jobs_wait`（§6.2）。参数沿用现有固定流程与模型工具的，这里只列入口与关键选项。

| 名字 | 做什么 | 关键参数 |
| --- | --- | --- |
| `transcribe` | 转录流程（架构设计 §7.9）：按需新建视频 → 转写成新文稿 → 建字幕层 | 输入三选一：`file`（本机媒体）、`url`（链接，含下载）、`video`（已有视频，可给 `asset`）；`project`；`no-video`（只出 `.txt` 与 `.srt` 文件，不建视频）；`language`、`provider`、`model`、`diarize`、`glossary`；`no-captions` |
| `translate` | 由**配置好的文本模型**翻译一份转写或字幕文件，写成新译文并建字幕层 | `video` + `to`，可选 `document`、`style`、`glossary`、`bilingual`、`no-captions`；或 `file`（SRT / VTT）+ `to`。没有文本模型时以 `CAPABILITY_NOT_CONFIGURED` 拒绝，`next` 指向 Agent 自译路径（§4.4） |
| `dub` | 翻译配音：缺译文先翻译，逐句合成，对齐，加配音轨 | `video`、`to`、`voice`、`translation`、`original`、`separate-background`、`provider`、`model` |
| `download` | 从链接下载媒体（yt-dlp），可导入视频或新建视频并转写（现 `import-link`） | `url`；落点三选一：`project`（只下载）、`video`（导入已有视频，时间线还空着时同时放上主轨）、`new-video`（新建并放上时间线）；`transcribe`、`subs`、`audio-only`、`name` |
| `export` | 导出字幕、文稿、音频、成片、便携包或工程 | `video`、`kind`、`format`、`out`、`range`、`document`、`bilingual`、成片的 `codec` / `width` / `height` / `fps` / `crf` / `burn-captions` 等（现 `export` 全部选项） |
| `transcode` | 文件到文件：压缩、按顺序合并、提取音轨（不建视频）；只有本机文件这一种输入，不在 MCP 面 | `files`、`merge`、`extract-audio`、`codec`、`max-height`、`crf`、`out-dir` |
| `speak` | 合成语音 | `text` / `text-file`、`voice`、`provider`、`model`、`video`（导入为候选素材）、`out` |
| `image` | 生成图片 | `prompt`、`size`、`count`、`provider`、`model`、`video`、`out` |

`text`（调一次文本模型）不进 Agent 面：Agent 自己就是文本模型。它留在 CLI 给人用（§7）。

### 4.3 名词组：对象的读与写

| 名词 | 动词 | 效果 | 说明 |
| --- | --- | --- | --- |
| `videos` | `list` | query | 范围内的视频：`videoId`、名字、项目、路径 |
| | `inspect` | query | 当前版本、序列、轨道、实例、素材、文档清单；字段选择、时间范围与字节预算（架构设计 §3.7） |
| | `create` | mutation | 新建空视频（现 `videos_create`） |
| | `frames` | mutation | **新增**：按时刻或区间取帧写成 PNG，返回路径（`previews.capture` 在 §3.5 的目录里却一直没有工具）。Agent 不看画面就剪不了 |
| | `history` | query | 版本历史与检查点 |
| | `delete` | destructive | 移进回收站（现 `videos_delete`），要 `--yes` |
| | `import-package` | mutation | 打开便携包建成新视频（同步完成，不是任务）；只在工具桥与 CLI |
| `documents` | `read` | query | 读转写、译文、章节等：`video`、`documentId`、可选 `revision`；转写（speech）另带 `translationBasis`（`sourceBasis` 与切好的句子）；超过预算写文件（§5.5） |
| | `put` | mutation | **新增 sugar**：写一份文档（新建或替换），编译成 `edits_apply` 的一个 `putDocument`。Agent 自译、润色与分章的落点 |
| `edits` | `apply` | mutation | 一笔事务：`ops`（JSON 数组、`@文件` 或 stdin）+ `revision`；`dry-run` 走预检 |
| | `undo` | mutation | 撤销最近一笔 |
| | `ops` | query | 列出操作族与每个操作的 schema、示例（命令协议 §4.2）；`spec edits.<op>` 同源 |
| `captions` | `create` | mutation | 把转写或译文做成字幕层（现 `captions_create`），`bilingual`、`layout-profile` |
| `assets` | `import` | mutation | **新增 sugar**：导入一个文件或 `artifactId`，可选 `place`（同一事务里 `addItem` 到主轨末尾或指定时间）。编译成 `importAsset` [+ `addItem`] |
| `jobs` | `list` / `inspect` / `wait` / `cancel` / `retry` | query / query / query / mutation / job | `wait` 阻塞到终态或超时；`retry` 是现 `pipelines retry` |
| `models` | `capabilities` | query | 每种能力可用的 Provider、模型、默认值、限制与不可用原因；`settingsHref` 是对应能力的设置路径，提示用户配置时将它写成 Markdown 链接（产品设计 §3.2.2） |
| | `list` | query | 本地模型包与状态（现 `models bundles`） |
| | `install` / `test` | job | 安装本地模型包（先报大小，`--yes` 跳过确认）；跑样本检查。两者只在工具桥与 CLI，不开放给 MCP |
| `space` | `list` / `search` | query | 条目与跨视频检索（只读） |
| `projects` | `list` / `create` | query / mutation | 项目的登记与新建 |
| `artifacts` | `save` | mutation | 把任务产物复制成文件（`cwd` 下的路径） |
| `skills` | `list` / `read` | query | 内置与用户层 craft skill 的索引与正文（§8.3 的「现取」路径） |
| `library` | `list` / `show` | query | 术语表、音色、品牌素材（只读） |

**sugar 的规则**：`documents_put` 与 `assets_import` 是编译到核心操作的便捷工具，在共用层实现，三个面都有；MCP 服务的视图可以默认隐藏它们以保持工具数少，但不得只在 CLI 里实现。第一版只加这两个，不加 `clips` / `cuts` 一类剪辑动词：先看 Agent 用 `edits apply` + `edits ops` 的自描述够不够，够就不加。

### 4.4 Agent 自己做文字工作

这是 v3 会话内智能体的既定做法（说明书的硬规则 1，§8.6），也是 v2 skill 的硬规则：翻译、润色、总结、分章由 Agent 自己完成，不去配文本模型。目录与 skill 都把它作为默认路径：

```text
documents read --video V --document-id D                    → 转写正文 + translationBasis（sourceBasis 与切好的句子：id、指纹、文本、词）
（Agent 逐句翻译）
documents put --video V --kind translation --language zh-CN --source-document D --body @zh.json
captions create --video V --document-id <新译文 id> --bilingual
export --video V --kind subtitles --format srt --bilingual
```

- 润色写回同一份 speech 文档（`documents put --document D`），之后**重新** `documents read` 再翻译：润色改变分句与指纹。
- 分章用 `edits apply` 的 `setChapters`；总结、博客、标题、简介是纯文字，`export --kind transcript --format txt` 取纯文本，或 `documents read` 读句子。
- `translate` 一级动词只在用户明确要用配置好的文本模型时用。skill 把这条写进硬规则。

### 4.5 元命令

| 命令 | 做什么 |
| --- | --- |
| `baocut` / `baocut --help` | 一屏：按任务分组列出一级动词与名词组各一行摘要，末尾一行说 `help <命令>` 与 `spec` |
| `baocut help <命令> [<子命令>]` | 该命令的参数、效果、示例（从目录派生） |
| `baocut spec [<名字>]` | 机器可读：整个目录或一项的 JSON（schema、`effect`、`risk`、`examples`、接口版本）；`spec edits.<op>` 给操作的 schema |
| `baocut status` | Runtime 在不在、版本、此刻能做什么：每种能力的默认 Provider 与可用性、本地模型包、外部工具（yt-dlp、ffmpeg）；不可用的带补救命令。能力与模型包默认是摘要（每种能力此刻用哪个、哪些 Provider 能用；每个包的状态），`--full` 时是 `models_capabilities` 与 `models_list` 的完整结果（各 Provider 的模型、参数与限制）。替代 v2 的 `doctor --quick` |
| `baocut runtime ensure|status|stop` | §5.6 |
| `baocut version` | CLI、Runtime 与接口版本 |

`spec` 与 `version` 输出裸 JSON；其余命令按 §5.1 的信封。

---

## 5. CLI 约定

### 5.1 输出

- `--json`：结构化结果到 stdout。stdout 不是 TTY 时默认开启，Agent 不用记得加。人读的渲染只是 JSON 的另一种格式化。
- 成功：薄信封 `{ ok: true, result, next? }`，`result` 就是工具的结果对象（与 MCP 工具结果的 JSON 相同）；`next` 是建议的下一条命令（例如 `transcribe` 之后给 `captions create` 或 `export`）。
- 失败：`{ ok: false, error: { code, message, retryability?, recovery?, remedy?, next? } }`，与 `ToolCatalog.errorBody` 完全相同。`code` 是封闭的错误码（命令协议 §11），`next` 用 CLI 的写法（`baocut models install …`），MCP 面上同一条 `next` 写成工具名——两种写法由共用层按主体渲染，不手写两份。
- `CAPABILITY_NOT_CONFIGURED` 的 `remedy.settingsHref` 提供对应能力的设置路径；Agent 按 `next` 用它写出可点击的设置链接，不猜地址。
- 进度到 stderr：`--progress jsonl` 时每行一个事件（`progress` / `artifact` / `warning` / `done`，带 `jobId`、`stage`、`pct`），默认按 TTY 给人读的一行刷新。

### 5.2 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 成功（含 `--wait` 等到的任务完成） |
| 1 | 失败或取消（任务终态是 `failed` / `cancelled`，或引擎拒绝） |
| 2 | 要用户做事才能继续：`CAPABILITY_NOT_CONFIGURED`、`GRANT_REQUIRED`、外部工具未同意等；输出里有 `remedy` 与 `next` |
| 3 | Runtime 不可用或版本不兼容（接口版本不同、`runtime ensure` 失败） |
| 4 | 参数不对（`INVALID_ARGUMENTS`），或 `destructive` 命令缺 `--yes` |

### 5.3 参数

- 旗标由目录字段派生：`camelCase` → `--kebab-case`；布尔是开关，`false` 用 `--no-x`；数组可重复（`--glossary a --glossary b`）或逗号分隔（schema 标 `csv` 时）；嵌套对象与操作数组用 JSON 字面量、`@文件` 或 `-`（stdin）。
- 一个位置参数（`positional`），其余全是旗标；位置参数与同名旗标二选一。
- 时间是十进制秒的字符串（`"12.5"`），范围 `a:b`；引擎对齐到帧并在回执的 `timeResolution` 里报告。
- 大文本（`speak --text`、`documents put --body`）接受 `@文件` 与 stdin，不鼓励塞进命令行。
- 密钥只从 stdin 读（管理桶里的 `models configure --key-stdin` 不变），Agent 面没有任何读写凭据的命令。

### 5.4 长任务

- 返回 `jobId` 的命令默认 `--wait`：阻塞到终态，退出码按终态，结果里带 `outputs`（文件路径、`documentId`、`assetId`、`artifactId`）与终态的任务记录 `job`；提交回执里的 `state` 换成终态，与 `job.state` 一致。`--no-wait` 立即返回 `jobId`。`--timeout <秒>` 到时打印 `jobId` 与最近进度，以退出码 1 返回，任务继续跑。
- Ctrl-C 取消任务（现有行为），`--no-wait` 后用 `jobs cancel`。
- 进度走 stderr，不污染 stdout 的 JSON。

### 5.5 大结果落盘

`documents read` 的全文、`videos inspect` 的完整时间线、`space search` 的大量命中可能超过 Agent 愿意读进上下文的量。两个面同一规则：

- 结果超过预算（默认 64 KiB，`--max-bytes` 可改）时，CLI 写到 `cwd` 下的 `.baocut-out/<工具>-<时间>.json`（或 `--result-file <文件>`），stdout 只给摘要、路径与 `truncated: true`；MCP 面沿用架构设计 §3.7 的字节预算与游标。
- 被截断的结果不能当完整的视频用：摘要里写明覆盖范围与继续读取的参数。

### 5.6 Runtime 的归属

- 每条要连 Runtime 的命令先按 `BAOCUT_HOME` 的发现文件找正在跑的 Runtime；找不到时**默认自动拉起**一个（后台、脱离终端），结果里带 `runtime: { started: true }`。`--no-start` 关掉自动拉起（CI 或只想看状态时）。
- `baocut runtime ensure` 显式做同一件事并打印 `started` / `reused`；`runtime status` 打印进程、端口、版本、是否有桌面端连接着；`runtime stop` 只停 CLI 自己拉起的那一个，桌面端连接着时拒绝并说明。
- CLI 拉起的 Runtime 空闲（没有在用的连接、没有任务）满设置 `runtime.idleExitMinutes`（默认 10）自动退出，Agent 忘了停也不留后台进程。`baocut runtime status` 只查状态，不算在用：查询不推迟退出，报出的 `idleSince` 是查询之前的值。
- 版本门：CLI 与 Runtime 的接口版本不同时以退出码 3 拒绝并说明哪一边要更新；不默默按旧参数解释。

### 5.7 帮助的形态

`baocut --help` 的全部内容必须在一屏（约 40 行）以内，形如：

```text
baocut — 用 BaoCut 转录、翻译、剪辑、配音与导出视频。先 `baocut status` 看这台机器能做什么。

流程（返回任务，默认等到完成）
  transcribe   转录：文件、链接或视频 → 文稿 + 字幕层        translate   用配置的文本模型翻译文稿或字幕文件
  dub          翻译配音                                       download    从链接下载，可导入或新建视频
  export       导出字幕 / 文稿 / 音频 / 成片 / 便携包 / 工程   transcode   压缩、合并、提取音轨（文件到文件）
  speak        合成语音                                       image       生成图片
对象
  videos       list · inspect · create · frames · history · delete · import-package
  documents    read · put            edits     apply · undo · ops        captions  create
  assets       import                jobs      list · inspect · wait · cancel · retry
  models       capabilities · list · install · test              space   list · search
  projects     list · create         artifacts save               skills  list · read      library  list · show
本机管理（给人用；Agent 先征得同意）
  models configure|accounts|default|…   services   share   nodes   settings   grants   approvals   fonts   external-tools
  skills add|import|enable|disable|remove   library import|export|remove|voice-clone   templates   chat   text   web
更多
  help <命令>    参数、效果与示例        spec [<名字>]    机器可读的目录        status / runtime / version
```

---

## 6. MCP 约定

### 6.1 不变的部分

Streamable HTTP、回环监听、按客户端发令牌、`Host` 与 `Origin` 检查、访问策略（范围 + 等级）、服务审批与 50 秒超时、`initialize` 报告接口版本：全部沿用架构设计 §4.8 与 §12.8。

### 6.2 变化

- **开放清单改为按目录项的 `surfaces` 与 `annotations` 推出**，不再手维护 `MCP_SERVICE_TOOLS`。`read` 等级只露 `readOnlyHint` 的工具。
- **补进对外目录**：`videos_create`、`captions_create`、`download`（现 `link_import_start`）、`transcribe`（流程）、`jobs_cancel`、`jobs_wait`、`videos_frames`、`documents_put`、`assets_import`、`projects_list`、`skills_list` / `skills_read`、`jobs_list` / `jobs_retry`、`models_list`、`library_list` / `library_show`、`videos_history`、`edits_ops`。`projects_create`、`videos_import_package`、`models_install` / `models_test`、`transcode`、`artifacts_save`、`videos_delete` 不开放。没有这些，外部 Agent 做不完最常见的链路。`artifacts_save` 与导出的文件仍只写进视频所属项目的 `exports/`（`ServiceScope.exportBase`）。
- **`jobs_wait { jobId, timeoutSec ≤ 50 }`**：阻塞到终态或超时，返回与 `jobs_inspect` 相同的记录。上限避开常见 MCP 客户端 60 秒的请求超时；没等到就再调一次。
- **工具数**：对外目录（`ask` 与 `auto` 等级）37 个（含后来开放的代码画面 `compositions_import` / `compositions_preview`、清理换下来的旧版本用的 `assets_prune` 与采用素材来源章节的 `chapters_adopt`；`compositions_import` 带 `replace: { itemId }` 时把时间线上已有的代码画面实例原地换成新版本，见[代码包规范 §3.3](../../spec/code-bundle-spec.md#33-替换版本)），其中 `read` 等级露出的只读工具 17 个；清单是协议常量 `MCP_SERVICE_TOOL_NAMES`，测试核对它与目录推出的一致。管理面一个都不进。
- **接口版本升到 `2`**：工具改名（`models_transcribe` 的流程形态改叫 `transcribe`、`link_import_start` → `download`、`exports_create` → `export`）与参数统一是破坏性变更。工具桥不对外，不受版本约束，但名字同时改。
- **`baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <客户端名>] [--yes]`**（另有 `baocut mcp status`）：新建一个客户端，把地址与令牌写进该 Agent 宿主的 MCP 配置，提示重启宿主。宿主有自己的环境变量段时令牌放那里、配置里只写引用（Claude Code 的 `settings.json` `env`）；没有时明文写入（Codex、Cursor、Gemini CLI），`--help` 与结果里说明风险并建议 `ask` 等级。BaoCut 里还没有任何已登记项目时（新装、没开过 App），一并登记默认项目目录下的 `CLI` 项目（与终端没有项目时用的同一个），结果的 `defaultProject` 写明：对外服务新建视频必须给已登记的项目、又不能自己建项目，没有它外部 Agent 无处新建视频。细节见架构设计 §4.8、§12.8。对应 v2 skill 的 `bin/connect`。`mcp` 是 CLI 的管理桶命令，不在目录里。

### 6.3 CLI 与 MCP 的差异只剩这些

| | CLI | MCP 服务 |
| --- | --- | --- |
| 主体 | 本机用户 | 外部客户端 + 访问策略 |
| 确认 | 宿主负责，`destructive` 要 `--yes` | `ask` 下服务审批 |
| 路径 | 相对 `cwd`，用户的全部文件 | 相对视频所属项目，`exports/` 之内 |
| 长任务 | 默认 `--wait` | `jobId` + `jobs_wait` |
| 大结果 | 落盘到 `.baocut-out/` | 预算 + 游标 |
| 管理面 | 有（管理桶） | 无 |

---

## 7. 现有 CLI 命令的去向

现有约 30 个顶层命令逐个归桶。**Agent 面**进目录、镜像到 MCP；**管理桶**只在 CLI、手写实现保留但按名词组整理、不进 `--help` 的前半屏；**撤**的删掉。

| 现在 | 去向 | 说明 |
| --- | --- | --- |
| `transcribe <videoId> <assetId>`（直接提交） | 并入 `transcribe --video V --asset A` | 一个入口两种形态合一 |
| `transcribe --video|--entry|--file`（流程） | Agent 面 `transcribe` | |
| `translate`、`dub`、`export`、`transcode`、`speak`、`image` | Agent 面，同名 | |
| `import-link` | Agent 面 `download` | 术语表没有「import-link」这个词 |
| `import-package` | Agent 面 `videos import-package` | |
| `pipelines`、`pipelines retry` | `pipelines` 撤；`retry` → `jobs retry` | 「固定流程」是实现概念，Agent 只认任务 |
| `jobs`、`jobs resources`、`jobs reconcile` | `jobs list/inspect/wait/cancel/retry` 进 Agent 面；`resources`、`reconcile` 管理桶 | |
| `models`、`models bundles`、`install`、`cancel`、`repair`、`test` | `capabilities`、`list`、`install`、`test` 进 Agent 面；`cancel`、`repair` 管理桶 | |
| `models configure|accounts|usage|default|remove|refresh|parameters|dir` | 管理桶 | 凭据与默认值只由用户改 |
| `space list|search` | Agent 面 | |
| `space rescan|rebuild|trash|restore|purge|delete-video|continue` | 管理桶 | |
| `library glossaries|voices|brand|show` | Agent 面 `library list|show` | |
| `library import|export|remove|voice-clone*|video-selection` | 管理桶 | |
| `skills list|show` | Agent 面 `skills list|read` | 外部 Agent 现取 craft 指导（§8.3） |
| `skills add|import|enable|disable|remove` | 管理桶 | |
| `toolbox` | 撤 | 工具页目录是界面的事；自描述由 `spec` 与 `status` 承担 |
| `tools …`（yt-dlp、ffmpeg） | 管理桶，改名 `external-tools` | 与协议 `externalTools.*` 对应；`status` 里报它们的可用性 |
| `fonts` | 管理桶 | 导出时缺字体由任务报错并带补救，Agent 不主动下载字体 |
| `text` | 管理桶（给人用） | Agent 自己是文本模型 |
| `chat`、`approvals`、`grants`、`tasks` | 管理桶 | 这些是 BaoCut 自己的智能体的事 |
| `templates` | 管理桶 | 模板是给 BaoCut 智能体的简报，外部 Agent 用 skill |
| `settings`、`services`、`share`、`nodes`、`web` | 管理桶 | `web open [--video <videoId>]` 例外：它是外部 Agent 进网页版编辑器的门，只在本机开服务、给一次性链接，不改视频与设置，说明书允许 Agent 不先问就用（§8.8，`catalog/web.md`）；改端口的 `services configure web` 等仍要先问 |
| `status` | 元命令，扩成 §4.5 的样子 | |
| 旧写法 `--bundle`、`--node`、`--autonomy` | 撤 | 不考虑兼容 |

管理桶的实现方式：保留现有的 `*-output.ts` 与手写解析，但整理成每个名词一个文件、共用 §5.1 的信封与 §5.2 的退出码；`--help` 后半屏只列名字，细节在 `help <命令>`。管理桶不派生自目录，也不要求派生——它们不是 Agent 面。

---

## 8. BaoCut skill

### 8.1 定位

skill 是给外部 Agent 的说明书：何时用 BaoCut、怎么启动、每类任务用哪条命令、prompts 与最佳实践、硬规则、怎么交付。它不复制参数（参数以 `spec` 为准），不描述 BaoCut 内部。

它与仓库现有的 `skills/` 不是一回事：

| | `skills/<id>/`（10 个 craft skill） | BaoCut skill |
| --- | --- | --- |
| 读者 | BaoCut 自己的会话内智能体 | 其他 Agent（Claude Code、Codex、Cursor…） |
| 内容 | 一种做法（润色、翻译、分章、剪口播…），引用工具桥的工具名 | 怎么用 CLI / MCP 操作 BaoCut，加上 craft |
| 加载 | Runtime 读目录，索引附在会话指导后 | 宿主的 skills 目录，由 `baocut skill install` 写入 |

### 8.2 放哪里

**不放进 `skills/`**：那个目录由 Runtime 整体加载给会话内智能体，`builtin-skills.test.ts` 核对清单，一份教人用 CLI 的 skill 放进去会被会话内智能体读到，而内容对它是错的（它该用工具桥，不该开子进程跑 `baocut`）。

新开顶层目录 `agent-skills/baocut/`，在仓库约定的目录表加一行；随 BaoCut 发布（桌面端打进 `<resources>/agent-skills/`；CLI 不另带一份，经 Runtime 的 `catalog.agentSkill` 取渲染结果），由 `baocut skill install --agent <宿主> [--dir <目录>]` 复制到宿主的 skills 目录（Claude Code `~/.claude/skills/baocut/`、Codex `~/.codex/skills/baocut/`、Cursor `~/.cursor/skills/baocut/`、Gemini CLI `~/.gemini/skills/baocut/`）。复制的是 CLI 面的渲染结果，不是源目录；`--link` 时渲染结果写进 `<Runtime Home>/agent-skills/baocut/`，宿主里放指向它的链接，之后对任一宿主再装一次就一起更新。`skill install` 是管理桶命令。

### 8.3 内容结构

```text
agent-skills/baocut/
  SKILL.md                      入口（见 8.4）
  references/
    start.md                    找到 CLI、runtime ensure、版本门、status 预检、没有 Runtime 时怎么办
    conventions.md              JSON 信封、退出码、--wait 与 jobs wait、错误 code → 下一步、大结果、时间与 ID、CLI↔MCP 映射
    catalog/
      media.md                  下载、转码、取帧、导入素材、新建视频、便携包；看一条视频的证据阶梯（§8.7）
      subtitles.md              转录 → 润色 → 翻译 → 字幕层 → 导出；Agent 自译是默认路径
      editing.md                edits apply 操作族、剪口播、章节、文字与元素、撤销与读回执；常用操作的生成块（§8.7）
      voice.md                  配音、语音合成、音色；「怎么说」与「说什么」分开写（§8.7）
      export.md                 导出种类、画面与声音参数、交付前检查
      models.md                 能力查询、本地模型包安装、CAPABILITY_NOT_CONFIGURED 与 GRANT_REQUIRED 的处理
      system.md                 runtime、spec、status，以及管理桶命令（要用户同意）
      web.md                    网页版编辑器：web open --video、链接与会话、浏览器用来看与拖、交付时的新链接（只给 CLI 面，§8.8）
    workflows.md                端到端 recipe：链接 → 转录 → 双语字幕 → 成片；润色后翻译；翻译配音；剪口播；切短视频；总结与写稿；每条按 §8.7 的骨架写
    craft/                      由 skills/<id>/ 同步来的 10 份 craft（prompts、步骤、best practice）
    mcp.md                      走 MCP 时怎么接、工具名映射、jobs_wait 的用法
```

**craft 不 fork。** `skills/<id>/SKILL.md` 与它们的 `references/` 就是用户要的 prompts、workflow 与最佳实践，单一来源仍是 `skills/<id>/`。两条路把它们交给外部 Agent：

1. **同步副本**：构建脚本 `tools/sync-agent-skill.ts`（`npm run build:agent-skill`，`--check` 核对）把每个内置 skill 复制成 `references/craft/<id>.md`（合并它的 `references/`），并把其中的工具桥工具名按 §4.1 的规则改写成 CLI 命令（`documents_read` → `baocut documents read`，一级动词 `speak` → `baocut speak`；连着 `-`、`/`、`.` 或后跟 `:` 的字面量是文件名或字段，不改）；craft 引用共享目录页时，`用 skills_read 读 baocut-catalog-<页>` 改写为该目录页的相对链接，不把参考表展开进附录；目标页必须存在。只在会话里有、终端没有对应命令的工具（`downloads_save`）换成不提工具名的兜底写法（终端里直接把文件路径告诉用户）。测试断言副本与源一致。
2. **现取**：`baocut skills read <id>` 随时能取当前 Runtime 里的版本（含用户自己添加的 skill）。SKILL.md 说明两者的关系：副本是随 skill 发布时的版本，现取是这台机器上的版本。

### 8.4 SKILL.md 的大纲

照 v2 的形态，入口只做六件事，正文不超过 300 行：

1. **何时用 / 何时不用，以及三条底线**。有媒体（文件、链接、字幕文件、`.bcut` 项目）要转录、字幕、翻译、配音、剪辑、下载、导出、总结写稿时用；翻译纯文本、与视频无关的写作与图片、别的剪辑器与 FFmpeg 的用法、BaoCut 源码的开发不用。一张「用户说的话 → 默认含义 → 目录页 → 对应 craft」的表。紧接着是三条底线（§8.7）：忠实、可看、合要求；后面每页的验收都对照它们。
2. **启动**。按顺序：定位 CLI（`baocut` 在 PATH，或 `BAOCUT_CLI`）；`baocut version`（版本门，退出码 3 时请用户更新，不绕过）；`baocut status`（这台机器能做什么，缺的怎么补）；按任务读一页目录。不手动起 Runtime，CLI 自己会；任务结束按 `runtime` 的归属规则决定要不要停。
3. **能力目录与阅读纪律**。八行表（`catalog/*.md`；`web` 一行只在 CLI 面，§8.8）：在 BaoCut 里是哪一块、覆盖什么、读哪页。只开需要的那页；一页在同一任务里只读一次，之后复用；动手前已知要读的几页一次读完；多阶段的 craft 只读当前阶段；要某个操作的字段用 `edits ops <op>` 或 `spec <名字>`，不拉整个清单。
4. **编排**。单步的事直接做；多步的任务 Agent 是导演：写计划、自己下所有写命令与占 GPU 的命令（机器上一次一个）、子代理只交文件与结论。
5. **硬规则**。文字工作自己做，不配文本模型；真相文件只经命令写（不碰 `video.db` 与视频目录）；不动用户的原始媒体；`job` 要等到终态、`mutation` 要读回执、`destructive` 要先问用户再 `--yes`；`CAPABILITY_NOT_CONFIGURED` / `GRANT_REQUIRED` 转告用户照 `next` 做，不用 shell、脚本或别的服务商绕过，不碰 API key；版本冲突重新 `inspect` 再改；管理桶命令先征得同意。
6. **交付**。报告四件事：改了什么、产物的真实路径、还要用户审的、没验证的。「没验证的」按三栏分：量出来的（时长、剪口数、字幕条数等读回执得到的）、看过的（取帧实际看到的；没看就写没看）、要人听的（剪点顺不顺、配音语气、配乐音量）。工具失败是「没验证」，不是内容有问题；只按实际看到的帧下视觉判断。

参数一律写「见 `baocut help <命令>` / `spec`」，不抄旗标：CLI 变了 skill 不用改。

### 8.5 什么时候写

SKILL.md 与 `references/` 的正文等 §10 的第 2 阶段（CLI 切到目录）落地后再写，否则写的是不存在的命令。第 1 阶段只定本节的结构与大纲。

### 8.6 一个说明书，两个读者

用户的补充要求（2026-10-06）：BaoCut 自己的会话内智能体也要用这一套——给它一个任务，它也是按同一份 skill 的说法、调同一份工具目录完成；BaoCut agent 与 Codex / Claude Code 读的是同一套 skills，背后是同一套工具。

机制上这已经成立一半：工具桥、MCP 与 CLI 是同一份 `ToolCatalog`，会话内智能体调的工具名就是 `a_b`，与 CLI 只差 §4.1 那条映射。差的是说明书这一层：原来会话内的指导是手写的 `guidance.ts` 加内置 skill 索引，外部 Agent 的是 §8.3 的 `agent-skills/baocut/`，两份必然漂移。决定收成**一个来源、两种渲染**：

| | 外部 Agent（CLI 面） | BaoCut 的会话内智能体（工具桥面） |
| --- | --- | --- |
| 来源 | `agent-skills/baocut/`（SKILL.md + `references/`） | 同一份 |
| 形态 | 一个 skill，整体装进宿主的 skills 目录 | SKILL.md 正文渲染成 system prompt 的「工作方式」段（取代 `guidance.ts` 手写的内容）；`references/catalog/*.md`、`workflows.md` 与 `conventions.md` 成为内置的说明书页（`baocut-catalog-<页>`、`baocut-workflows`、`baocut-conventions`；工具桥面正文为空的页除外，§8.8），craft 照旧是内置 skill；索引附在指导后，按需 `skills_read` |
| 工具的写法 | `baocut documents read` | `documents_read` |
| 不适用的段落 | — | 找 CLI、`runtime ensure`、版本门、`--yes`、退出码、落盘到 `.baocut-out/`、MCP 接法、网页版编辑器（§8.8） |
| craft | `references/craft/<id>.md`（从 `skills/<id>/` 同步，§8.3） | `skills/<id>/` 本身 |

写法上用两个标记，不写两份文稿：

- **按面取舍**：只属于一个面的段落包在 `<!-- surface: cli -->` … `<!-- /surface -->`（或 `agent`）里；没标的两面都有。
- **工具名占位**：正文里的工具写 `{{tool:documents_read}}`，渲染时按面输出 `baocut documents read` 或 `documents_read`；参数名同理用字段名，CLI 面渲染成 `--kebab-case`。craft 同步脚本（§8.3）与这里共用同一个渲染函数。
- **craft 占位**：引用一份 craft 写 `{{skill:polish-transcript}}`，CLI 面渲染成 `references/craft/polish-transcript.md` 的链接，工具桥面渲染成「`polish-transcript`（用 `skills_read` 读）」（紧跟在「读」后面时是「用 `skills_read` 读 `polish-transcript`」，不说两遍「读」）。入口与 workflows 用它指向方法，不写死任一面的路径。

落地：`packages/runtime-core/src/skills/` 加一个渲染器，Runtime 读 `agent-skills/baocut/`（随应用分发在 `<resources>/agent-skills/`，开发时读仓库，与 `skills/` 的解析顺序相同）按工具桥面渲染出指导与内置 skill；`guidance.ts` 退化成渲染器的调用方，不再手写内容；工具名按 Runtime 真实的工具桥目录核对，找不到说明书或渲染不了时 Runtime 启动失败。说明书页只给会话内智能体（终端与 MCP 的 `skills_read` 读不到，那边读装好的 CLI 面），总在会话的 skill 索引里（排在 craft 前面），不进设置里的 skill 列表、不能开关：它们是入口指导引用的机制，关掉会让指导指向读不到的页；用户或内置 skill 用了同样的 id 时不加载那一份，记 `builtin-conflict`。`skills/` 目录只剩 craft（做法），「怎么用 BaoCut」的通用指导全部进 `agent-skills/baocut/`。测试：CLI 面的渲染里不出现 `a_b` 形式的工具名与 `skills_read` 的「现取」说法以外的工具桥用语；工具桥面的渲染里不出现 `baocut ` 命令、`--yes`、退出码；两面渲染出的硬规则条数相同；工具桥面正文为空（整页在 `cli` 块里）的目录页不登记成说明书页，指导或别的页在 `cli` 块外链到它时渲染失败。

不做的事：不让会话内智能体开子进程跑 `baocut`（它有工具桥）；不 fork craft；不为两个面各写一份硬规则。

顺序：§10 第 3 阶段写 `agent-skills/baocut/` 时就按标记法写；之后单独一个任务把 `guidance.ts` 切到渲染器（第 3 阶段第 4 条），切换时逐段比对旧指导，确认没有丢规则。已完成（2026-10-06）：旧指导里只属于会话面的规则（编辑器上下文不是用户的话、编辑器里打开的视频、`jobs_wait` 的等法、审批会等用户决定、索引里没有的 craft 不读）补进 SKILL.md 的 `agent` 块，有固定流程的事用一级动词一步提交写进两面共有的编排一节；其余规则在说明书里已有对应。渲染出的指导约 108 行、6.5K 字符（旧的手写版约 50 行、4K 字符），多出的主要是入口路由表与「用 `skills_read` 读」的写法。

### 8.7 说明书的写法

几条贯穿 `agent-skills/baocut/` 全部页面的写法，§10 第 3 阶段按此写，评审按此查：

**方法与机制分层。** craft（`skills/<id>/`，同步成 `references/craft/`）与 `workflows.md` 只讲判断与步骤：何时剪、留哪句、停顿多长、先声后画；点名用哪个工具或操作（经 `{{tool:…}}`），但不抄旗标与参数字段，不解释机制。`conventions.md` 与 `catalog/*.md` 只讲机制：命令、回执怎么读、错误码之后做什么、上限；不替 Agent 做创作判断。两边用 `{{tool:…}}` / `{{skill:…}}` 互相指，不复制对方的内容。一页里同时出现「为什么这样剪」和「这个旗标怎么给」，就是放错了地方。

**三条底线。** 入口开头给出，所有验收对照：

| 底线 | 含义 | 典型违反 |
| --- | --- | --- |
| 忠实 | 不改说话人的意思与立场；译文忠实；不动用户的原始媒体，范围在时间线上选、不预先切文件；文字工作自己做、不编造时间戳 | 为了凑开头拼半句话；把词级时间从句级估出来 |
| 可看 | 剪点落在词与词之间、换气留着；字幕可读、避开人脸与平台控件；配乐在人声之下；画面变化跟着信息变化走 | 停顿一刀切压到 0；字幕盖住下三分之一 |
| 合要求 | 画幅、时长、成片语言、交付物按用户确认的来；时长是目标不是配额，不靠填充、循环、变速凑数，也不为缩短删掉必要信息 | 为了凑 60 秒重复画面 |

**页面骨架。** 两类页面各一个固定骨架，读者在任何一页都知道往哪看：

- `catalog/*.md` 每页：何时用 → 前置检查（能力在不在、素材多长、要不要先 `inspect`）→ 命令与例子 → 结果怎么读（回执里哪几个字段决定下一步）→ 常见错误码 → 下一步 → 验收。
- `workflows.md` 的每条 recipe 与每份 craft：适用于什么、什么情况下不走这条（用户只要求一件小事就直接做那件）→ 判断表（信号 → 处理 → 原因）→ 完整步骤（编号，每步指向 `{{tool:…}}` 或 `{{skill:…}}`）→ 完成标准。

**生成块。** `catalog/editing.md` 里最常用的七八个 `edits apply` 操作（放素材、裁剪、挪动、删除、加字幕、加文字、调音量、分割）各给一句说明加一个例子，放在 `<!-- generated: common-ops -->` … `<!-- /generated -->` 之间，由 craft 同步脚本（§8.3）从 `edits_ops` 的 schema 与目录项的 `examples` 生成，一致性测试核对它没过期；其余操作让 Agent 用 `edits ops <op>` 取。手写正文不抄参数的规则（§8.4）不变：生成块不是手抄。同样的生成块可以出现在 `conventions.md`（JSON 信封与错误码表）与 `mcp.md`（工具名映射表）。

**看一条视频的证据阶梯。** `catalog/media.md` 与 `workflows.md` 用同一个顺序：先完整导入原件、复用已有转写，缺的批量转录；在转写里按文字定位片段；再按时间批量取帧拼成带时间戳的接触表看构图与镜头分布，可疑区间加密采样、单帧细看；仍不知道剪点才做镜头切换检测；视频理解模型（如果配置了）放最后，问具体问题、要时间戳、对照原片核实。证据够了就停，彼此独立的读取一次发完。改动先做一段有代表性的，读回核对后再批量做，大改之后重新核对，没动的结果复用。

**配音与生成的提示。** `speak` 的 `instructions` 与 `text` 是两件事：`instructions` 只写怎么说（语气、语速、场景、角色），`text` 只写说什么，两者方向一致（紧张的指令配紧张的台词）。指令不过度规定，模型会自然补全；不用真实品牌与真人做风格参照；同一角色全片用同一音色与同一基线。`instructions` 的语言按模型说明或已有试读证据选择，模型要求或更适合英文时用英文，否则用用户的语言；说明语言不改变台词的目标语言。表演可以要求缓慢或急促，能力与效果按模型判断，不承诺精确时长、不靠加速塞进预算。音色参考表按模型系列独立成 `catalog/voice-<模型系列>.md`，写明适用条件，由声音目录页引用；语言语速表只在 `catalog/voice-language-rates.md` 维护，craft 与目录页引用它，不再内嵌数据副本。`image` 的提示按固定顺序写：主体 → 外观或材质 → 场景 → 光 → 机位与构图 → 风格与质量 → 一句保真夹子（不要改什么）。通用提示规则放在 `catalog/voice.md` 与 `catalog/media.md` 的「怎么填这个字段」一节，不另立 craft；长到一屏放不下时再独立成 `skills/<id>/`。

**模板与说明书的关系。** 场景模板（模板包规范 §5.2）的简报引导已经是「先问清主题、目标、受众、材料，再动手」；说明书不重写一份，入口只在「用户要做某类成片但没说清」那行指向它：有模板目录可用时选一个场景模板走它的简报，没有就按同样四项问。模板正文是用户侧的话，不含任一面的工具名，两个面不用渲染。

**单一作者语言。** 说明书与 craft 都以中文写作并直接分发，不维护第二种语言的同步副本；做法对任意语言的视频与目标语言适用（AGENTS.md）。将来需要别的语言的渲染，由 §8.6 的渲染器加 `--lang` 产出，仍是一个来源。

### 8.8 看与改：外部 Agent 的网页版编辑器

用户的补充要求（2026-10-06）：外部 Agent 要看画面、看成片、做所见即所得的调整、请用户审片时，也要能用上编辑器。

**两种读者只在这里不同。** 会话内智能体与用户共用桌面编辑器，编辑器已经在用户面前，看画面用 `videos_frames`，不开网页。外部 Agent 只有 skill 与 CLI，没有编辑器：经 `baocut web open` 开本机的 Web 服务（架构设计 §4.8），在宿主的浏览器工具里打开网页版编辑器。所以说明书的 `catalog/web.md` 整页包在 `<!-- surface: cli -->` 里；渲染器跳过工具桥面正文为空的目录页，不登记成说明书页（§8.6），入口能力目录里这一行也在 `cli` 块里。

**命令。** `baocut web open --video <videoId>` 开启 Web 服务（没开时）并打印一条直达该视频编辑器的访问链接；不给 `--video` 时落到首页。videoId → 文件目标的解析在 Runtime 侧（`services.web.createAccessLink { video? }`，命令协议规范 §4.1）；链接里的路径与查询由 `@baocut/protocol` 的 `webVideoHref` 构造，界面的路由（`paneQuery` / `parseHref`）用同一个函数，CLI 与 Runtime 都不手拼 URL。没有 `web status`：`baocut services status` 已给出 Web 服务的 `endpoint`。

**链接的生命周期。** 一次性代码在 URL fragment 里，两分钟内有效、只能用一次；登录页用它换成浏览器会话（12 小时，cookie 绑端口），然后回到原来的路径与查询，界面按它打开那个视频。会话还在时不带代码的地址可以再打开。服务重启后旧会话作废。一个任务里 `web open` 一次、复用同一个标签；只在看到登录页 / 401 或连接被拒时重新发链接。

**CLI 优先，浏览器用来看与拖。** 文字与时间线上确定的修改（改字、翻译、剪口、挪到某秒、章节）走命令；网页用于播放、看合成后的画面与字幕位置（帧不是合成后的画面）、所见即所得的拖拽，以及请用户审。网页上的改动与命令写同一份真相、同一份修改历史，所以网页里改过之后，下一条写命令之前重新 `videos inspect`。不在网页上操作 BaoCut 自己的智能体对话与设置。宿主有内置浏览器就在里面打开，否则把链接交给用户；说明书不对任何宿主下断言。

**交给用户的链接。** Agent 自己打开过的链接已经作废。交付时再 `web open` 一次，把新链接给用户，说明只能用一次、两分钟有效；用户来不及马上点时，请用户自己运行 `baocut web open --video <videoId> --launch`：它在系统浏览器里打开登录页（保留路径与查询），代码从终端粘进去。

**失败处理。** 登录页或 401 → 再 `web open`；连接被拒 → 再 `web open`（它会把服务开起来；`services status` 的端口变了就用新的）；端口被占 → 服务报错、不换端口，Agent 不自己改端口也不结束占用的进程，告诉用户；Web 客户端没有构建 → 告诉用户，改用取帧与导出一小段成片；`VIDEO_NOT_FOUND` → `videos list`。

**与硬规则的关系。** `web` 在管理桶（§7），但 `web open` 只在本机回环地址开服务、给一次性链接，不改视频与设置：说明书把它列为「管理命令先征得同意」的例外，在硬规则第 11 条、`catalog/system.md` 与 `catalog/web.md` 写明；改端口等其余 Web 服务命令仍要先问。不加新的硬规则。MCP 上没有 Web 服务的入口，`mcp.md` 指回 CLI。

---

## 9. 要修订的规范条目

实现时按 AGENTS.md 的规则在同一任务同步规范、实现与测试。本方案涉及：

| 文档 | 条目 | 改什么 |
| --- | --- | --- |
| 架构设计 §3.5 | 工具目录 | 加 `LocalPrincipal`；目录项加 `effect`、`examples`、`surfaces`；`captions_create`、`downloads_save`、`skill_read` 等「只给会话里的智能体」的句子按 `surfaces` 重写；工具名表更新 |
| 架构设计 §3.6 | 能力快照 | 「从同一个注册源派生」补上 CLI 的派生与离线快照 |
| 架构设计 §4.1 | 公共 SDK | 加 `catalog` 命名空间（`list`、`call`） |
| 架构设计 §4.8 | 对外服务 | MCP 开放清单改为按 `surfaces` 推出并列出新开放的工具；加 `jobs_wait`；接口版本 `2`；`mcp install` |
| 架构设计 §12.8 | 对外服务安全 | 新开放的写工具的路径约束（仍在项目 `exports/` 内）；`mcp install` 写配置文件的令牌处理 |
| 架构设计 §2.2 | 启动与所有权 | CLI 拉起的 Runtime 的归属与空闲退出 |
| 命令与协议规范 §4.1 | 方法 | `catalog.list` / `catalog.call`；`jobs.wait` |
| 命令与协议规范 §11 | 错误合同 | 退出码表；`next` 按主体渲染 |
| 产品设计 §2.7、§6.9 | 工具、Skill | 「对外服务看不到 skill」改为只读可见；CLI 面的说明 |
| 仓库约定 §1 | 顶层目录 | 加 `agent-skills/` |
| `skills/README.md` | | 说明与 `agent-skills/` 的关系与同步脚本 |
| 根 README | 命令表 | 改为指向 `baocut --help` 与本设计，不再逐条列旗标 |
| 术语表 | | 「工具目录」「Agent 面」「管理桶」「BaoCut skill」四个词 |

---

## 10. 实施顺序与验收

### 阶段 1：目录与主体（Runtime 侧）— 已完成（2026-10-06）

1. `ToolDefinition` 加 `effect`、`examples`、`surfaces`、`positional`；现有工具逐个补齐，测试断言完整。
2. 新工具：`jobs_wait`、`videos_frames`、`documents_put`、`assets_import`、`jobs_retry`、`projects_list` / `projects_create`、`skills_list`、`library_list` / `library_show`、`models_list` / `models_install` / `models_test` 的目录形态；`transcribe` / `translate` / `dub` / `download` / `export` / `transcode` / `speak` / `image` 以一级动词登记（内部仍调固定流程与模型工具）。
3. `LocalPrincipal` + `LocalScope`；网关 `catalog.list` / `catalog.call`。
4. MCP 服务按 `surfaces` 出目录；接口版本 `2`；工具改名。
5. 规范同步（§9 的架构设计与命令协议条目）。

### 阶段 2：CLI 切到目录 — 已完成（2026-10-06）

评审后的修订一并落地：`jobs wait` 走订阅等待、`models install` 缺 `--yes` 只报大小、结果落盘旗标改 `--result-file`、空闲退出先撤发现文件、`runtime.stop` 在有人用时拒绝；管理桶 `admin/` 的内联文案 i18n 与 CLI 拉起 Runtime 时的下载目录环境变量留作后续。

1. `tools/` 加目录快照生成；CLI 派生层：命令树、旗标解析、`--help`、`help`、`spec`、信封、退出码、`--wait`、落盘、自动拉起 Runtime。
2. 管理桶按 §7 整理；删除 `USAGE` 与旧写法。
3. 根 README、CLI 的测试（派生层按快照测，管理桶照旧）。

### 阶段 3：skill 与安装 — 已完成（2026-10-06）

第 1–3 项合入时一并落地：craft 副本里的一级动词（`speak`、`export`）也按 §4.1 改写成 CLI 命令，连着 `-`、`/`、`.` 或后跟 `:` 的字面量不算工具名；`mcp install --yes` 自动撤销旧的客户端令牌（替换了条目却认不出它用的客户端时不吊销，结果带 `previousClientUnknown: true` 并说明怎么查与吊销）；`AGENT_SKILL_NOT_FOUND` / `AGENT_SKILL_INVALID` 退出码 1。

1. `agent-skills/baocut/` 按 §8.3 与 §8.6 的标记法写出；craft 同步脚本与一致性测试。
2. `baocut skill install`、`baocut mcp install`。
3. 规范同步（§9 其余条目）。
4. 会话内智能体的指导切到 §8.6 的渲染器，`guidance.ts` 不再手写内容；`skills/` 只剩 craft。已完成（2026-10-06）。
5. 外部 Agent 的网页版编辑器（§8.8）：`services.web.createAccessLink` 加 `video`、`baocut web open --video`、链接经登录回到原路径与查询、`catalog/web.md` 与渲染器跳过工具桥面为空的页。已完成（2026-10-06）。

### 验收

端到端一条：在一台装了 BaoCut、没开 App、只装了 skill 的机器上，用 Claude Code（不接 BaoCut 的智能体）完成「链接 → 转录 → Agent 自译 → 双语字幕层 → 导出 mp4 与 srt」，过程中：

- Agent 没有读过 `baocut --help` 以外的帮助全文，只按需 `help <命令>` 或 `spec`；
- 没有手动起 Runtime，结束时 Runtime 按归属规则退出或保留；
- 每条写命令的回执被读回并出现在交付报告里；
- 同一条链路换成 MCP（`mcp install` 到 Claude Code）也能走通，工具名与参数不用改写。
- 外部 Agent 要请用户审片时，`baocut web open --video <videoId>` 给出的链接在浏览器里经登录直达那个视频的编辑器（§8.8）；会话内智能体的说明书里没有这一页。

---

## 11. 已决事项与未决问题

已决：

- 共用层是现有 `ToolCatalog`，CLI 经网关方法消费它，不做 MCP 客户端，不另抽一层。
- 一级动词 + 名词组 + 元命令；名词取协议命名空间的复数；MCP `a_b` ↔ CLI `a b`。
- CLI 不走 BaoCut 审批，`destructive` 要 `--yes`；确认的责任在 Agent 宿主。
- 第一版 sugar 只有 `documents_put` 与 `assets_import`。
- Agent 自译是默认路径，`translate` 是显式选择。
- 外部 skill 放 `agent-skills/`，craft 以 `skills/<id>/` 为单一来源同步，不 fork。
- 不考虑与 v2、现行 v3 CLI 的兼容；接口版本升到 `2`。
- 说明书一个来源两种渲染（§8.6）：BaoCut 自己的智能体与外部 Agent 读同一份 `agent-skills/baocut/`，craft 仍以 `skills/<id>/` 为源。
- 说明书的写法（§8.7）：方法与机制分层、三条底线、固定页面骨架、从目录生成常用操作块、看视频的证据阶梯、配音指令与台词分开、交付报告的三栏；说明书以中文为单一作者语言。
- 阶段 1 实现时的裁决：`models_install` / `models_test`、`projects_create`、`videos_import_package`、`transcode`、`artifacts_save`、`videos_delete` 不开放给 MCP；`videos_frames` 与 `videos_import_package` 同步完成、算 `mutation`；`LocalScope` 对没有授权覆盖的外发以 `GRANT_REQUIRED` 拒绝、不代发授权；无项目时新建视频落到默认项目目录下的 `CLI` 项目；`jobs_retry` 沿用同一个 `jobId`（`attempt` 加一）。
- 旁白成片（2026-10-06 复盘一次资讯快评的配音后定）：方法进 craft `narration`（旁白成片），会话内由 SKILL.md §1 的路由表指过去（两面同一张表）、外部面另由 `workflows.md` 第 8 条指过去；机制（引擎按约 60 个单元切块逐块合成、`speed` 只有 `speedRange` 不为 null 的模型接受、`seed` 是重配的旋钮）写在 `catalog/voice.md`。模板只在 `ai-news-take` 的示例请求里加一句「同一个声音、正常语速、太长就删词、不靠加速凑时长」；其余含旁白的 15 个模板不逐个改，靠 craft 路由覆盖。
- 空项目登记表上的 MCP（2026-10-06 端到端验收发现，记录见[验收记录](../../acceptance/agent-surface-e2e.md)）：`videos_create` 与 `download` 的新视频对外服务仍必须给已登记的项目、`projects_create` 仍不开放给 MCP；由 `baocut mcp install` 在一个项目都没有时登记默认项目目录下的 `CLI` 项目补上入口。没选的另一条路是让对外服务不给 `project` 时落到默认项目（同 `LocalScope`），那要改 §6.3 与说明书 `mcp.md` 的「必须给 project」。
- 下载进已有的空视频（同一次验收发现）：当时对外服务不收 `newVideo`（后一条已放开），要新视频只能先 `videos_create` 再 `download` 给 `video`；原来导入已有视频只导入素材、不放上时间线，接着的 `transcribe` 以 `TRANSCRIBE_ASSET_NOT_FOUND` 失败、导出也是空片。改为导入的视频时间线还空着（根序列上没有片段）时同一笔事务放上主轨，与 `newVideo` 一样（架构设计 §7.9）；已经有片段时仍只导入素材。终端与会话里的 `download --video` 同样适用。
- 对外服务的 `download newVideo`（2026-10-06 端到端验收第二轮）：放开，条件是同时给已登记的 `project`（与 `videos_create` 相同），不给落点仍拒绝；流程新建的视频在父任务记下 `videoId` 时登记进服务的范围（访问策略是视频名单时写进名单，与 `videos_create` 一样），之后 `videos_list`、`videos_inspect` 看得到。`transcribe` 给 `url` 同理。依据是架构设计 §12.9「落点限于范围之内的已有视频或已登记的项目」：新视频建在已登记的项目里，不越出范围。原来「先 `videos_create` 再下载进去」的两步仍然可用。
- `transcribe` 给 `url`（同一轮）：`language`、`hint`、`provider` / `model`、`diarize`、`name`、`noCaptions` 都透传给 `link-import` 流程，转写进视频之后默认建字幕层，与给 `video`、`file` 时相同（§4.2）；`download --transcribe` 仍用默认值、不建字幕层。
- `mcp install` 在宿主没有环境变量段时明文写入令牌，`--help` 与结果里说明风险并建议 `ask` 等级：实际只有 Claude Code 能放进 `settings.json` 的 `env` 再引用；Codex 的 `bearer_token_env_var` 要在启动它的 shell 里导出，Gemini CLI 会滤掉名字像令牌的环境变量，Cursor 的配置没有可供请求头引用的环境变量段，这三家明文（Codex、Cursor、Gemini CLI 的接入未实际连通验证）。
- 一级动词在工具桥里也露出（2026-10-06）：工具桥面的目录里有 `transcribe`、`download`、`dub`、`transcode`、`export` 这些一级动词，原来设想的 `models_transcribe`、`link_import_start` 不在任何一面的目录里；说明书在两面共有的编排一节写明有固定流程的事用一级动词一步提交整条流程，不自己拆成几步。
- `documents read` 只有 `video`、`documentId`、可选 `revision`（2026-10-06）：转写另带 `translationBasis`，没有 `for` / `format`；纯文本用 `export --kind transcript --format txt`。§4.3 / §4.4 已按实现改正，不改实现。
- 外部 Agent 经网页版编辑器看与改（2026-10-06，§8.8）：会话内智能体不开网页，`catalog/web.md` 整页只给 CLI 面，渲染器跳过工具桥面正文为空的目录页；`web open --video` 直达视频的编辑器，URL 由 `@baocut/protocol` 的 `webVideoHref` 构造、videoId 在 Runtime 侧解析；不加 `web status`；一个任务开一次、复用标签，登录页 / 401 / 连接被拒才重发；交付时给用户新链接，`--launch` 留给用户；CLI 优先，网页用于播放、看合成画面、拖拽与审片，网页改过后重新 `videos inspect`；`web open` 是管理命令先问的例外，端口被占不换端口。
- 会话内智能体的指导由说明书渲染（2026-10-06，§8.6）：渲染失败时 Runtime 启动失败；目录页、`workflows.md`、`conventions.md` 是总在索引里的内置说明书页，只给会话内智能体（终端与 MCP 的 `skills_read` 读不到，那边读装好的 CLI 面），不进设置里的 skill 列表、不能开关。

未决（实现阶段裁决，默认按括号里的）：

- CLI 自动拉起 Runtime 时用哪个 Node 与哪份 Runtime 入口：打包后是桌面端资源里的，开发时是 `apps/runtime`（按 `BAOCUT_RUNTIME_ENTRY` → 打包资源 → 仓库的顺序找，照随应用分发的数据文件的解析办法）。
- MCP 面大结果的落盘：对外服务能否把 `documents_read` 的全文写进项目 `exports/`（可以，与导出同一约束；第一版先只做预算与游标）。
- `videos_frames` 的输出位置与大小上限（`cwd` 下 `.baocut-out/frames/`，单次最多 24 帧、长边 1280）。
- 模板是否露到 CLI / MCP：把现有的 `templates.list` / `templates.get` 包成 `templates_list` / `templates_show`（query），让外部 Agent 也能从场景模板的简报起步（露出，放进 §4.3 的名词组；第 3 阶段与 skill 一起做）。
- `template.json` 要不要一个可选的 `skills: [id]` 提示，指向做这类成片该读的 craft（先不加；是模板包规范的改动，等说明书写出来看入口那张表够不够）。
