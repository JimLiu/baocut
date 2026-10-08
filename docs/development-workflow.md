# 开发流程

按任务读取相关章节。全局完成门见[根 AGENTS.md](../AGENTS.md#强制完成门)，目录与命名见[仓库约定](repo-conventions.md)，领域规范从[文档阅读路线](README.md#阅读路线)进入。

## 目录

- [1. 规范与实现](#1-规范与实现)
  - [1.1 提交分类](#11-提交分类)
  - [1.2 合并前提交整理](#12-合并前提交整理)
- [2. 验证](#2-验证)
- [3. 多端同步](#3-多端同步)
- [4. 语言与平台](#4-语言与平台)
  - [4.1 跨平台系统集成](#41-跨平台系统集成)
- [5. 工作区与产物](#5-工作区与产物)
  - [5.3 开发态数据与会话记录](#53-开发态数据与会话记录)

## 1. 规范与实现

开始改动前，找到该行为所属的规范章节、实现与相邻测试。文档中的目标合同和当前实现状态分开判断，不能仅凭规格里有定义就宣称功能已实现。

- 有意修改协议、格式或公开行为时，同一任务更新对应规范、实现与测试；涉及使用方式时同步相关 README。参数、默认值、错误码、退出语义和 JSON 输出都属于公开行为。
- 修复实现以满足现有规范时，不机械改写规范。发现规格缺漏、相互冲突或已有实现偏离时，说明对应章节和差异；超出任务授权的产品决定交由用户裁决，不通过改规格掩盖缺陷。
- 业务语义与状态所有权遵守[架构设计 §1](architecture/architecture-design.md#1-总体架构)；不在 UI、脚本或多个客户端复制权威逻辑。
- 文档按[写作规则](README.md#写作规则)整合到所属主题，一事一处、一个主题一篇，正文保留目录；不为本流程建立独立变更日志，也不往 README 追加过程记录。

### 1.1 提交分类

自动与手动提交都使用 `type(scope): summary`；type 与 scope 用英文，summary 与正文默认用英文，用户明确指定其他语言时按要求处理。scope 是二级分类，使用稳定的模块或功能主题名（lowercase-dashed），如 `file-location`、`preview`、`release`。同一类修复的多个提交必须沿用同一个 scope，优先复用已有分类，不在每个提交中换名称；其他无法合理归属的单独事项可省略 scope。按实际变更目的选类型，便于发布时从 commits／PR 整理日志：

| type | 适用变化 |
| --- | --- |
| `feat` | 新增或扩展产品能力、用户可见行为 |
| `fix` | 修复缺陷，使行为符合预期 |
| `docs` | 文档、规范、开发代理指令或 skill 的说明变更 |
| `refactor` | 重构实现，不改变外部行为 |
| `perf` | 改善性能 |
| `test` | 仅新增或调整测试 |
| `build` | 构建、打包机制或依赖变化 |
| `ci` | 持续集成与发布工作流变化 |
| `chore` | 不属于以上类型的日常维护，如版本号与已验证发布版本钉更新 |
| `revert` | 撤销既有变更；正文注明被撤销的 commit 与原因 |

summary 写清动作、对象及关键结果，不使用 `update`、`fix some issues`、`auto commit` 等空泛摘要。例如同类文件定位修复统一为 `fix(file-location): handle Windows extended paths`、`fix(file-location): handle directory names with spaces`；发布说明使用 `docs(release): require complete batched changelog summaries`。需要解释原因、影响或兼容性时写进正文；破坏兼容的变化在类型／scope 后加 `!`，并在正文用 `BREAKING CHANGE:` 写明影响与迁移方式。

每个 commit 表达一个可理解的变更目的。一个功能或修复及其对应文档、测试同属一个提交，类型按主要目的选择；互不相关的改动分开提交，不为分类拆散同一变更。发布日志仍须核对实际内容，不能仅凭类型跳过来源或推断用户影响。

### 1.2 合并前提交整理

任务分支或 worktree 合并回 `main` 前，先审阅该分支相对合入基线的全部改动，把开发过程中的尝试、补丁、修正和对应测试／文档归并为 1–N 条有意义的事项提交。数量由独立事项决定：同一功能或同一修复通常一条，多个独立事项保留少量分开的提交；不按原始提交数量机械保留，也不把互不相关的内容压成一条笼统的「合并分支」。同一 scope 只辅助归类，不代表所有修复都必须压成一条。

整理后的每条提交按 §1.1 命名，摘要描述最终交付结果，正文列出需要保留的具体修复、限制、迁移要求与 PR／issue 依据，使它可以直接作为 changelog 的来源。已撤销的尝试不写成最终能力；独立修复不能在归并时丢掉。PR squash 合入时，PR 标题与 squash 正文也遵循这些要求，不能沿用临时分支名或流水账。

可以在本任务独占分支中 squash／rebase，或在合入时生成整理后的提交。整理仅限本任务尚未合入的内容，不改写 `main` 或已发布 tag 的历史；共享分支与他人提交保留原历史，通过合入时归并达到相同结果。核对整理前后的净改动等价，处理冲突后按实际影响重新验证，并在合入后确认提交边界与摘要。分支整理不包含 push 或 force push 授权；worktree、分支与专用 target 的清理仍遵守根 AGENTS.md。

## 2. 验证

先根据改动范围选检查，再执行。行为变化补充或调整能覆盖该行为的测试；修 bug 优先覆盖原失败场景。通过标准与测试层次见[验收与测试](acceptance/acceptance-spec.md)，下表只提供当前仓库的执行入口。

命令默认从仓库根运行，`<受影响 crate>`、`<测试文件>` 替换为实际名称或路径。

| 改动范围 | 检查入口与范围 |
| --- | --- |
| TypeScript / React | `npm run typecheck`；`npm test -- <测试文件>` 跑受影响测试，跨模块影响难以收窄时跑 `npm test` |
| Rust | `cargo fmt --all -- --check`；`cargo test --locked -p <受影响 crate>`，跨 crate 时覆盖相关消费者，广泛改动再跑 `cargo test --locked --workspace` |
| Rust ↔ WASM | `npm run build:wasm`，并验证实际消费方；仅宿主 Rust 测试通过不足以证明 WASM 可构建、可加载 |
| Electron 装配或打包 | `npm run build`；渲染进程的资源加载（字体、WASM、`base`）、Electron 版本、fuse 或打包配置有变化时跑 `npm run check:file-fonts`（会先构建）；Runtime 按路径读的随应用分发的数据（`packages/models/assets` 等）、主进程的构建入口或打包配置有变化时跑 `npm run check:model-assets`（会先构建；用 Electron 的 Node 运行产物里的自检入口，原地与模拟打包各核对一遍每个文件都解析得到）；用 `npm run dev` 或 `npm start` 检查受影响流程，按任务选择开发态或打包后的运行方式；改了开发态的进程监管（`apps/desktop/tools/dev-runner.mjs`、`dev-process-group.mjs`）时跑 `node --test apps/desktop/tools/dev-process-group.test.mjs`，并在终端里按 Ctrl+C、关掉终端各停一次，确认 electron-vite、Electron 与 Runtime 都退出 |
| Windows 安装包 | 改了打包脚本、`<resources>` 布局、随应用分发的原生程序或 Runtime / Worker 的路径解析时跑。Windows 上在 MSVC 环境里 `npm run package:win`（CUDA 版 `npm run package:win:cuda`，NVIDIA 专用、candle 与 Whisper 都走 CUDA，要 CUDA Toolkit 13.1；Vulkan 版 `npm run package:win:vulkan`，给 AMD / Intel 显卡、Whisper 走 Vulkan，要 Vulkan SDK）出 NSIS 与 zip 到 `apps/desktop/dist/<变体>`，再 `node apps/desktop/tools/check-packaged-app.mjs <win-unpacked 或安装目录>` 起一遍每个 Worker 并核对 Runtime 的解析；没有 Windows 机器时手动触发 `desktop-windows` 工作流。macOS 上只能用 `--target x86_64-pc-windows-gnu --bin-dir <交叉编译的目录>` 核对包的结构，不能代替 Windows 上的自检。细节见[桌面端 README](../apps/desktop/README.md#windows-打包) |
| 预览性能（可选） | 改预览的出帧路径（`preview-engine`、`render-planner`、预览 WASM、frame-render 与光栅）时可跑。内核逐帧：`npm run build:wasm` 后 `node tools/preview-bench.ts`，缺省画一致性夹具拼成的合成场景，按阶段（求计划、送画面、画帧、取帧）报 p50/p95 并逐层消融；`--video <视频目录>` 量本机的视频（先 `cargo build -p engine-host`，只用副本），`--wasm` 给两份时逐帧轮流画，比改动前后。机器忙时绝对值会飘，看输出里的负载，比值以轮流画的为准。端到端：`npm run bench:preview`（会先构建，要 `engine-host`）在 Electron 的隐藏窗口里以生产构建连隔离的 Runtime（临时 Home、不注册智能体、不碰钥匙串、只放行本机请求），打开视频，拖几下播放头、跳一下再放一段，报画上去的帧率、掉帧、长任务、每个 tick 的主线程时间、媒体元素的偏差与重新定位，以及拖动与跳转到第一次画上去、到画上精确那一帧的时间；缺省场景是 ffmpeg 生成的合成素材，`-- --video <视频目录>` 量本机视频的副本 |
| 面板性能（可选） | 改虚拟列表（字幕、译文、文稿）、时间线的裁剪与缩放、页签切换、字幕查找替换等面板的渲染路径时可跑（M12）。`npm run bench:panels`（会先构建，要 `engine-host` 或 `BAOCUT_ENGINE_HOST`、ffmpeg 与 ffprobe、Google Chrome 或 `BAOCUT_CHROME`）用渲染进程的真实生产构建（`electron-vite build` 的产物原样由本地 HTTP 服务提供），在系统临时目录里起隔离的 Runtime（临时 Home、不注册智能体、不碰钥匙串，网关只放行这个本地来源），程序化合成大小两档夹具（ffmpeg 生成的纯色素材、逐词转写、字幕、译文、剪口与配音块），用无头 Chrome 经 CDP 注入宿主桥后打开，屏蔽 Typekit；每档 3 次新载入，每次载入前等 1 分钟负载降到 3 以下（最多等 3 分钟），量各面板挂载数、连续滚动的帧间隔 P95、页签切换、时间线缩放一步与整片入镜、字幕全部替换与撤销的最长任务，输出环境、两档规模和与[验收与测试 §4](acceptance/acceptance-spec.md#4-性能目标) M12 基线逐行对应的表。`-- --tier small --runs 1` 只跑一档一次，`-- --json <文件>` 另存每次的原始结果；临时目录与 Chrome 用户目录都在仓库外，结束时删掉。负载高时操作的绝对值会飘，挂载数应与基线一致 |
| Web 装配或共享 UI | `npm run build:web`；依赖的 WASM 有变化或尚未生成时先跑 `npm run build:wasm`，再通过实际 Web 入口验证 |
| 原型 | 按[局部协议「验证」](../designs/baocut/AGENTS.md#验证)执行构建、测试、设计系统检查与 HTTP 预览，不在这里维护第二份命令清单 |
| 文档 | 审阅 diff，核对改动涉及的相对链接与锚点、路径、命令及术语；纯文档任务可跳过代码测试 |

- 构建成功、自动测试通过和视觉验收分别报告。UI 变化打开实际页面检查目标状态、交互与控制台；按影响覆盖主题、尺寸、弹层与键盘焦点。原型截图不能证明 Electron 或 Web 实现通过。
- 共享 Rust 代码涉及宿主 / WASM feature 边界或其他平台时，覆盖受影响的目标配置；本机无法验证的目标明确列为未测，不用本机通过代替跨平台结果。
- 需要工具链、模型、凭据或特定平台而无法执行时，报告跳过项及原因。验收条目是定义，不能当作已经执行的记录。
- 开发启动脚本可能在引擎或 WASM 构建失败后继续启动；必须检查构建结果，不能以窗口打开判定相关能力通过。
- 检查通过后，只在新增修改、失败或仍有疑点时扩大或重复验证。交付说明报告实际检查结果与已知未测项。

## 3. 多端同步

用户可见的布局、视觉、交互、文案或状态行为变化，先在原型定稿，再审计以下已有表面的对应功能：

| 表面 | 实现与约束入口 |
| --- | --- |
| 原型 | `designs/baocut`；先读[局部协议](../designs/baocut/AGENTS.md)，共享组件变化按其规则检查 App / Web 入口 |
| Electron | `apps/desktop` 装配，公共界面在 `packages/ui` |
| Web | `apps/web` 装配，复用 `packages/ui`；范围以当前产品与架构规范及入口能力限制为准 |

- **原型先行**：用户可见的设计变化先只在原型里做，验证、提交后交用户确认；确认之前不改 Electron 与 Web 的实现（`packages/ui`、`apps/desktop`、`apps/web`）。交付说明写明真实页面尚未改动、等待确认；用户确认原型后，再按确认的结果改 Electron / Web 并完成下面的审计。原型里没有对应界面的改动，以及不改变设计的缺陷修复，说明原因后可以直接改实现。
- 同步适用的对应功能，复用公共组件和语义，不做目录级复制。共享 UI 已覆盖多个客户端时仍分别验证各入口，关注宿主能力、权限与资源加载差异。
- 某表面没有对应功能或不在其范围内，不补占位实现；在交付说明中写明不适用及依据。不沿用其他仓库的 Web 冻结或桌面端迁移状态。
- 纯协议、架构、引擎或后台改动尚未改变用户可见 UI 时，不因将来可能接入某个表面而提前同步。
- 原型与规格的差异按其[同步纪律](../designs/baocut/AGENTS.md#同步纪律)列明。任务已授权改变产品行为时同步对应规格；否则先报告差异，不擅改产品决定。
- 图标的尺寸、语义与同步检查统一引用[仓库约定 §4](repo-conventions.md#4-界面图标)。

## 4. 语言与平台

代理回复语言遵守[根规则](../AGENTS.md#阅读与语言)，产品处理的媒体、文稿、译文与配音可以是任何语言，两者分别判断。

- 产出语言优先采用用户明确要求，其次采用已记录偏好，再从任务上下文推断。不得因代码、文档或例子使用某种语言，就把它设为产品缺省。
- 提示词、任务合同、长度、语速与断行规则采用适合目标语言的度量；数字若只适用于某种文字，写明范围与其他语言的处理方式。
- 按语言或文字分支时，未列语言必须有明确兜底，不悄悄当成英文。新增或修复此类行为时覆盖对应语言及兜底路径；模型支持语言等客观限制照实保留。
- 给人看的文字走统一的多语言机制（[仓库约定 §5](repo-conventions.md#5-文案与多语言)），英文与每种出货语言同时写；布局不假定固定字数或文字方向。
- 平台专属 API、依赖与后端通过目标配置或能力检测隔离，避免无条件引入 Apple-only 等接口。平台不可用时有明确行为，不静默更换用户指定的后端。
- 修改提示词、缺省值、语言校验或平台分支后，审阅改动中的语言与平台假设，按 §2 验证相关路径并报告未覆盖环境。

### 4.1 跨平台系统集成

修改文件或目录的打开、定位、选择、拖入，以及系统菜单、外部程序启动等宿主能力时，必须审计 Windows、macOS 与 Web 的适用性，不以开发机上的表现推断其他平台。

- **文案与动作一致**：文件管理器定位统一采用[术语表](glossary.md#界面英文用词)的「在文件夹中显示 / Show in Folder」，不在共享界面写死 Finder 等平台名称。区分「在 BaoCut 中打开」「用系统默认应用打开」与「在文件夹中显示」；项目未登记或当前格式不能在应用内打开，不等于磁盘上的文件或目录不能被定位，提示须写清受限的是哪种动作。
- **路径跨边界检查**：追踪 Runtime / Rust 返回的路径、界面拼接与宿主调用，分别检查文件与目录。Windows 覆盖盘符路径、UNC 网络共享、`\\?\C:\…` 与 `\\?\UNC\server\share\…` 扩展路径、混合分隔符，以及空格和非 ASCII 名称；macOS 覆盖 POSIX 路径。使用目标平台的路径规则与既有转换入口，不把 `path.normalize` 当作移除 Windows 扩展命名空间的保证，不盲目删除未知命名空间前缀。
- **按宿主能力提供入口**：桌面端通过宿主桥调用系统接口；Web 不能定位 Runtime 所在电脑的本机目录，不提供暗示可用的操作。其他平台缺失的能力有明确的隐藏、禁用或解释行为，不显示可点却静默无效的按钮。
- **覆盖原失败场景**：除路径单元测试外，在目标系统分别定位源文件、项目目录与视频目录，覆盖 CLI 创建后进入桌面端、关闭后重开，以及不存在或不可访问的目标；检查实际打开的文件管理器与选中的目标、失败提示和控制台。路径转换测试或 IPC 调用成功不足以证明系统文件管理器已打开。
- **如实报告验证边界**：按 §2 执行与影响相称的检查；没有 Windows / macOS 实机时仍验证可执行的路径分支，并明确列出未测的系统交互，不把本机或模拟测试结果写成跨平台通过。

## 5. 工作区与产物

### 5.1 依赖与生成物

- 依赖变化使用对应包管理器更新并提交 lockfile，不手工编辑。根 npm workspace 对应 `package-lock.json`，Cargo workspace 对应 `Cargo.lock`；独立目录（如原型）维护自己的 lockfile。
- 构建产物按[仓库约定](repo-conventions.md#2-放置规则)处理；原型中需要入库的生成物按[局部协议](../designs/baocut/AGENTS.md#验证)重建并提交，不手改。已有历史生成物不在无关任务中顺手暂存。
- 临时答案、截图、渲染帧、测试项目与媒体放仓库外的临时目录；有意维护的测试夹具放所属测试目录，不把用户素材、模型权重或临时输出当作夹具提交。

### 5.2 worktree 与预览

- 在当前任务所属检出中工作，不切回主检出修改或验证另一份代码；任务前已有或并发出现的改动属于用户，不覆盖、不用裸 `git stash` 收走。
- 每个 worktree 使用独立的 `CARGO_TARGET_DIR`，不与主检出或其他 worktree 共享。先核对主检出的本机 target 配置与可用空间；需要外置盘时，在同一存储位置创建以 worktree 名命名的专用目录。
- 本机配置模板见 [`.cargo/config.local.toml.example`](../.cargo/config.local.toml.example)。被忽略的本机配置不会自动进入 worktree；构建前用 `cargo metadata --format-version 1 --no-deps` 核对返回的 `target_directory`，同一任务的构建与验证沿用该路径。
- 预览服务必须指向当前检出，使用独立端口，并读取本次修改的资源确认服务来源。原型的 HTTP 预览细节见[局部协议](../designs/baocut/AGENTS.md#验证)；不能以另一个检出的页面作为本次验收证据。
- 收尾停止本任务启动的预览服务；worktree、分支与专用 target 目录按[强制完成门](../AGENTS.md#强制完成门)处理，只清理本任务拥有的资源。

### 5.3 开发态数据与会话记录

要复盘「刚才那次运行做了什么」（智能体调了哪些工具、参数是什么、改了视频哪里、产物在哪）时，直接读 Runtime 的数据目录，不凭界面截图或智能体的自述推断。

- **位置**：开发态（`npm run dev` 启动的 Electron、从仓库启动的 Runtime）把 BaoCut 主目录放在仓库里被忽略的 `.dev/baocut-home/`（见 `apps/desktop/src/main/index.ts`，`BAOCUT_HOME` 可覆盖）；打包后的应用用 `~/.baocut`，用户项目目录是 `~/BaoCut`（`packages/runtime-storage/src/home.ts`）。`~/Library/Application Support/BaoCut/` 是 v2 的数据，与 v3 无关。
- **会话记录**：`store/conversations/conv_<id>.jsonl`，只追加的日志（架构设计 §3.10）：第一行是文件头，第二行是快照（完整记录），之后的 `item` 行按 `item.id` 替换或追加、`meta` 行替换元数据，不能整文件 `JSON.parse`。`grep -l` 找文件照常有效；要完整记录时先重放，例如 `node -e 'const L=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}});const r=L[1];const ix=new Map(r.items.map((x,i)=>[x.id,i]));for(const l of L.slice(2)){if(l.op==="item"){const i=ix.get(l.item.id);i===undefined?(ix.set(l.item.id,r.items.length),r.items.push(l.item)):r.items[i]=l.item}else if(l.op==="meta"){Object.assign(r,{...l,op:undefined,tasks:{...r.tasks,...l.tasks}})}}console.log(JSON.stringify(r))' <文件>`。`.json.migrated` 是迁移前的旧文件，`.corrupt-*` 是认不出而保留的文件。重放后顶层是 `conversation`（标题、`cwd`、`driverId`、时间）与 `items[]`；`items[].kind` 有 `user-message`、`agent-message`、`reasoning`、`task`、`tool-call`、`video-created`、`video-change`。工具调用的字段是 `tool`（`mcp` / `command` / `web-search`）、`title`（MCP 工具名，如 `baocut.speak`）、`detail`（参数 JSON 字符串）、`output`（结果）、`status`、`durationMs`；视频改动有 `label`、`transactionId`、前后 `videoRevision` 与 `durationSeconds`。按标题或 `grep -l` 关键词找到文件后用脚本按 `kind` 过滤，不要整文件读。
- **任务与产物**：`store/jobs.jsonl` 是任务记录（只追加：第一行文件头，之后 `put` / `remove` 行，同一个 `jobId` 以最后一条 `put` 为准、遇到 `remove` 就删掉，例如 `jq -c 'select(.op=="put")'` 后按 `.record.jobId` 取最后一条；应用账本 `store/applications.jsonl` 同理）；产物在 `artifacts/<sha256>.<扩展名>`（合成的音频、导出的字幕、保存的 JSON 都在这里，`artifactId` 去掉 `sha256:` 前缀就是文件名）；没有项目的会话在 `scratch/conv_<id>/` 里工作，智能体保存到工作目录的文件与导出都在里面；会话第一次新建视频时会绑定到一个新项目，目录里的东西搬进项目、`scratch/` 下的目录消失（架构设计 §3.10）；运行日志在 `logs/runtime.log`。
- **边界**：这些是用户的数据，只读；需要加工时把结果写到仓库外的临时目录。
