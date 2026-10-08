# Agent 面端到端验收记录（2026-10-06）

> [Agent 面设计 §10「验收」](../design/agent-surface/agent-surface-design.md#验收)的一次执行记录：外部 Agent 只装 BaoCut skill，完成「链接 → 转录 → Agent 自译 → 双语字幕层 → 导出 mp4 与 srt」，再换 MCP 走同一条链路。

本文是执行记录，不是通过标准；标准见设计 §10 与[验收与测试](acceptance-spec.md)。证据不入库，下文记作 `<E>`：留存的一份在本机的 `.dev/acceptance-evidence/agent-surface-e2e-2026-10-06/`（CLI 与 MCP 两腿的 stream-json 与走查记录在 `evidence/`，网页编辑器的截图在 `web-editor/`，烧录字幕前后的帧在 `caption-render/`）；令牌只在 `<E>/mcp-config.json`（0600），本文不收。

## 1. 结论

| # | 验收条目 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | 只读 `baocut --help` 以外按需的 `help <命令>` 或 `spec`，不读帮助全文 | 通过 | `<E>/evidence/cli-leg.stream.jsonl` |
| 2 | 没手动起 Runtime，结束时按归属规则退出或保留 | 通过 | `<E>/evidence/cli-leg.stream.jsonl`、`<E>/home/logs/runtime.log`、`<E>/evidence/cli-leg.runtime-exited-at` |
| 3 | 每条写命令的回执被读回并出现在交付报告里 | 通过 | `<E>/evidence/cli-leg.stream.jsonl`、`<E>/evidence/cli-leg.final-report.md`、`<E>/home/projects/CLI/NASA Zero Gravity Research/video.db` |
| 4 | 换成 MCP 也能走通，工具名与参数不用改写 | 这次运行未通过；修了两处阻塞缺陷，修复后用脚本客户端走通全链路；还要用 Claude Code 复跑一次 | `<E>/evidence/mcp-leg.stream.jsonl`、`<E>/evidence/mcp-walk-1-before-placement-fix.jsonl`、`<E>/evidence/mcp-walk.jsonl` |
| 5 | 外部 Agent 的 `web open --video` 经登录直达视频的编辑器（设计 §8.8，2026-10-06 晚补做） | 通过 | `<E>/web-editor/shot-4-fresh-login-editor.jpg`、`shot-6-editor-expanded-at-2s.jpg` 与 `frame-cli-at-2000ms.png` |

## 2. 环境

- 仓库：分支 `agent/e2e-acceptance`（worktree），CLI 用 worktree 的 `apps/cli/src/main.ts`，经 PATH 里的 `baocut` 包装脚本调用。没有装打包的 App，`resolveRuntimeLaunch` 落到仓库的 `apps/runtime/src/main.ts`。
- Runtime：隔离的 `BAOCUT_HOME`，CLI 一腿 `<E>/home`，MCP 一腿 `<E>/home-mcp`（各自复制了 yt-dlp 的同意记录）；`BAOCUT_MODELS_DIR` 指向本机已有的权重，engine-host 与 model-worker 只读复用已构建的二进制，没有构建。下载目录 `<E>/downloads`、`<E>/downloads-mcp`。
- 外部 Agent：Claude Code 2.1.292，`claude -p … --output-format stream-json --verbose --setting-sources project --no-session-persistence`，cwd 是只装了 BaoCut skill 的项目目录（`baocut skill install --dir <项目>/.claude/skills`）。stream-json 的 init 记下的模型：CLI 一腿 claude-fable-5-1，MCP 一腿 claude-opus-5-5（两腿模型不同，没有查明原因）。
- 视频：NASA Langley 的「How Do We Do Research in Zero Gravity? We Asked a NASA Expert」，Wikimedia Commons 上的公有领域 webm，132 秒，1920×1080（`https://upload.wikimedia.org/wikipedia/commons/c/ce/How_Do_We_Do_Research_in_Zero_Gravity_-_We_Asked_a_NASA_Expert.webm`）。
- 任务原文（两腿相同，MCP 一腿前面多一句「BaoCut 已经作为 MCP 服务（baocut）接到你这里了」）：转录英文原声；字幕由你自己翻译成简体中文；在视频里建一个中英双语字幕层；导出带双语字幕的 mp4 成片，以及双语 srt 字幕文件；做完给交付报告。

### 与「没开 App、只装 skill」的偏差

- 桌面 App 实际开着（开发态 Electron，用的是另一个 BAOCUT_HOME），两腿的 Runtime 与它互不相干；本机 ASR 与它共用 GPU。
- `claude -p` 用的是用户自己的 Claude Code 登录：放在临时目录的 `CLAUDE_CONFIG_DIR` 读不到钥匙串里的登录，所以只有 `baocut mcp install` 写进临时配置目录，Agent 运行本身没有换配置目录；MCP 一腿因此用 `--mcp-config <E>/mcp-config.json --strict-mcp-config` 接入，不碰用户的 MCP 设置。用户的 `~/.claude/skills` 里另有一份 `baocut` skill，`--setting-sources project` 下没有加载（stream-json 的 init 里只列出项目里的那份与 Claude Code 自带的 skill）。
- 加了 `--no-session-persistence`，Claude Code 仍把一次超大的工具结果（`baocut status` 的 52 KB 输出）存到了用户的 `~/.claude/projects/<cwd 编码>/tool-results/`；没有写 `~/.claude.json` 里的 MCP 配置（`<E>/evidence/user-config-shasum.before.txt` 与 `.after.txt`：`~/.claude/settings.json`、`~/.codex/config.toml`、`~/.gemini/settings.json` 前后一致；`~/.claude.json` 的摘要变了，是并行的 Claude Code 会话自己在写，里面没有 `baocut` 的 MCP 条目）。
- MCP 一腿另起一份 home，`baocut mcp install --agent claude-code --level auto`（自动级，验收里不弹审批）。

## 3. 逐条

### 3.1 只按需读帮助（通过）

CLI 一腿 25 次 Bash 调用里，帮助只有 `help transcribe`、`help download`、`help documents put`、`help documents read`、`help captions create`、`help export | head -60`；没有执行 `baocut --help`、不带命令的 `help` 或 `spec`。skill 的页面按需读了 `start.md`、`conventions.md`、`catalog/media.md`、`catalog/subtitles.md`、`catalog/export.md` 与三页 craft。

### 3.2 Runtime 的归属（通过）

- Agent 的第一条命令是 `baocut version; baocut status --json`，回答里 `runtime.started: true`、`launchedBy: cli`：CLI 自动拉起（`--launched-by cli --idle-exit`），Agent 与我都没有手动起。
- 退出：Agent 的最后一个连接在 22:25:55（UTC）断开；之后我自己的两次 `runtime status` 在 22:27:25 断开；22:37:32 Runtime 记下「收到停止信号」`signal: idle` 并停止（`<E>/home/logs/runtime.log`），发现文件随之删除。CLI 拉起、没有连接、没有任务、没有开着的服务，满 10 分钟退出，符合架构设计 §2.2。
- MCP 一腿的 Runtime 同样是 CLI 拉起（`mcp install` 时），MCP 服务开着，按规则保留（`runtime status` 的 `runningServices: ["mcp"]`）。之后为了换上修复的代码做脚本复核，我用 `baocut runtime stop` / `runtime ensure` 重启过它，复核完再停掉，这些都在两次 Claude Code 运行之外。

### 3.3 回执读回进报告（通过）

| 写命令 | 回执 | 报告里的那一行 |
| --- | --- | --- |
| `download --new-video` | 视频与素材、1920×1080、132.37 秒 | 下载并导入时间线 |
| `transcribe <video> --asset …` | 文档、416 词、1 位说话人 | 英文转写 |
| `documents put`（润色） | 版本 2→3、`updatedIds` | 润色转写，改 21 个词 |
| `documents put --kind translation` | 版本 3→4、`filledAlignments: 22` | 写入简体中文译文，22 句 |
| `captions create --bilingual` | 版本 4→5、`cueCount: 50`、`pairedOriginal` | 建双语字幕层 |
| `export --kind video` / `--kind subtitles` | 任务的 `outputs` 路径 | 导出的文件（路径取自任务结果）与 ffprobe 校验 |

`video.db` 里的五笔事务（下载 0→1、转写 1→2、润色 2→3、译文 3→4、字幕层 4→5）与报告一致。失败的三次写（`transcribe --url` 带参数被拒、润色带错 `--revision` 冲突、导出 srt 时来源有歧义）没有产生修改，Agent 读了错误的 `next` 改正后重试。产物：`<E>/project/exports/NASA_Zero_Gravity_Research.bilingual.mp4`（93 MB，1920×1080，3971 帧）与 `.en-zh.srt`（22 条）。报告里「共 4 笔修改」与表里的 5 行对不上（小错）。

### 3.4 MCP 链路（这次运行未通过 → 修复 → 脚本复核走通）

1. **Claude Code 一腿**（36 秒）：接上了 33 个 `mcp__baocut__*` 工具；`projects_list` 是空的，`download` 不收 `newVideo`，`videos_create` 给目录路径回答 `PROJECT_NOT_FOUND`，`projects_create` 不在 MCP 上，Agent 照规矩停下报告。原因：新 home 的项目登记表是空的，对外服务又必须给已登记的项目。**修复 1**：`baocut mcp install` 在一个项目都没有时登记默认项目目录下的 `CLI` 项目（结果带 `defaultProject`），见设计 §6.2、§11 与架构设计 §4.8。
2. **修复 1 之后的脚本复核**（`<E>/mcp-walk.mjs`，官方 MCP SDK 直连同一个端点与令牌，工具名与参数照 Claude Code 一腿的写法）：`projects_list` 有了 `CLI`；照错误的 `next` 先 `videos_create {name, project}` 再 `download {url, video}`，下载成功，但素材只导入、没放上时间线，`transcribe {video}` 以 `TRANSCRIBE_ASSET_NOT_FOUND` 失败（`<E>/evidence/mcp-walk-1-before-placement-fix.jsonl`）；就算给了 `assetId`，导出的也是空片。**修复 2**：从链接导入到已有的视频时，它的时间线还空着就同一笔事务放上主轨，与 `newVideo` 一样（架构设计 §7.9）。
3. **修复 2 之后的脚本复核**（重启了 MCP 一腿的 Runtime 换上新代码）：`projects_list` → `videos_create` → `download {url, video}` → `jobs_wait` → `transcribe {video, language, hint, noCaptions}` → `jobs_wait` → `videos_inspect` → `documents_read`（45 KB，在 MCP 的预算之内，带 `translationBasis`，22 句）→ `documents_put`（译文，`alignment: null` 由 Runtime 补齐）→ `captions_create {bilingual: true}`（50 条）→ `export` mp4 → `export` srt。全部成功：成片 `<E>/home-mcp/projects/CLI/exports/NASA Zero Gravity Research (MCP).mp4`（h264 + aac，1920×1080，3971 帧，132.37 秒，抽帧可见中英两层字幕）与 `.en-zh-Hans.srt`（22 条，英文在上、中文在下）；导出的路径取自任务的 `outputs`（`<E>/evidence/mcp-walk.jsonl`、`<E>/evidence/mcp-walk-frame-20s.png`）。
4. **还差的一步**：修复之后没有再用 Claude Code 跑 MCP 一腿（每腿只跑一次）。建议编排者合并后复跑一次，确认 Agent 照说明书走得通。

「工具名与参数不用改写」只部分成立：工具名与 CLI 一一对应，但对外服务的 `download` 不收 `newVideo`（流程新建的视频进不了服务的视频名单），要新视频得先 `videos_create` 再下载进去，步骤与 CLI 的 `download --new-video` 不同。这是设计里定好的差别（架构设计 §4.8），没有在这里改；是否让对外服务在给了 `project` 时也收 `newVideo`，留给设计裁决。之后已裁决放开（见 §4 末条）。

### 3.5 网页版编辑器（通过，补做）

设计 §8.8 落地后在隔离的 Runtime（自己的 `BAOCUT_HOME`，Web 端口 47652，验完停掉）上复核：先停 Web 服务清掉会话，`baocut web open --video <videoId>` 给出的链接在应用内置浏览器里打开，经登录页落在那个视频的编辑器（`<E>/web-editor/shot-4-fresh-login-editor.jpg`）；播放头停在 00:02.0 时的画面与 `videos frames --at 2` 取出的帧一致（`shot-6-editor-expanded-at-2s.jpg`、`frame-cli-at-2000ms.png`）；1024 与 800 宽、清空 localStorage 后重新登录都落在视频标签（`shot-7`、`shot-8`、`shot-9`）；会话还在时不带 `#code` 的地址不用重新登录（`shot-3-session-reuse.jpg`）；`--video video_nope` 回答 `VIDEO_NOT_FOUND`、退出码 1。观察：浏览器面板第一次打开时出现过一次停在会话标签上（`shot-1-narrow-800.jpg`），之后三次复测没有复现，推测是面板加载中先宽后窄、焦点在输入框里时按 Home 的规则选中了会话标签；说明书 `web.md` 写了「视频标签没被选中时点它」。没有实测的：`--launch` 回到原路径与查询只有单元测试；浏览器连着时 Runtime 的空闲退出。

## 4. 发现（不阻塞）与处置

处置写在每条末尾：「已修」带提交、「改规格」是规格原来没写或与裁决不同而按裁决一并改了、「记录，不改」写明原因。

- `baocut status` 的 stdout 有 52 KB，其中 48 KB 是 `capabilities`；Agent 只能另写脚本过滤，Claude Code 还因此把结果存成了文件。——已修，改规格（e71d9909）：默认只给每项能力的默认值、可用的服务与数量和模型包的状态，`--full` 才带完整内容；命令协议与 Agent 面设计同步。
- `transcribe --url`（两条面都一样）不收 `language`、`hint`、`noCaptions`、`name`，带上就被拒，两腿的 Agent 都先撞上这条再改成两步。——已修（c07f41c7）：设计 §4.2 本来就列了这些参数，实现违背；现在连同 `provider`、`model`、`diarize` 都透传给 `link-import` 流程，转写进视频之后默认建字幕层；流程规格（命令协议、架构设计 §7.9）补上新参数与 `captions` 一步。
- skill 文案「带上读到时的 `--revision`」容易被读成 `documents read` 返回的文档版本，而 `documents put --revision` 要的是视频版本；Agent 因此撞了一次 `PROJECT_REVISION_CONFLICT`。——已修（93f3eb64）：说明书与 `documents_put` 的说明写明是视频的 revision（`videos inspect` / 写命令回执里的），不是文档版本。
- `export --wait` 的回答顶层 `state` 是提交时的快照（`queued`/`running`），`job.state` 才是 `completed`，读的人容易误判。——已修（c787878b）：设计 §5.4 已规定 `--wait` 等到终态，所有返回 `jobId` 的命令带 `--wait` 时顶层 `state` 换成终态。
- 从转写导出的双语 SRT 按句一条，最长约 10.5 秒、6 行。——记录，不改：规格未限（视频格式规范 §5.6 的阅读预算没有给每条时长与行数的上限）。
- `EXPORT_SOURCE_AMBIGUOUS` 的候选只列字幕文档，不列转写。——已修（7b3df2bc）：候选同时列出显示着的字幕与转写文档。
- `runtime status` 的 `idleExit.idleSince` 总是 null：查状态本身是一次连接，会把空闲计时清零，每查一次也推迟退出。——已修，改规格（963f07a3）：`runtime.status`、`runtime.info` 之外没有别的请求的 CLI 连接不算在用，`idleSince` 报查询之前的值；架构设计 §2.2 原来写的是「没有 CLI 连接」，按裁决改了。
- 新 home 上 `projects_list` 为空时，`next` 仍说「把 projectId 作为 videos_create 的 project」，没有出路（修复 1 之后不再出现，`baocut mcp install` 之外的情形仍在）。——已修（ceb8551e）：为空时按面给出路（对外服务请用户登记项目或 `mcp install`，本机面说明默认落点）。
- 下载完成的 `next` 写着「新建的视频已放上时间线」，下载进已有视频时（`createdVideo: false`）也这么说。——已修（d3439f20）：按 `createdVideo` 分开说。
- 烧进画面的中文字幕把标点渲染成空格（SRT 里标点完整）；第 88 秒一条中文字幕在「国际空间」处切条，「站」落到下一条。
  - 已处置（标点）：不是字形或排字的缺陷。字幕层建的样式文档正文是 `style: {}`，Studio 样式的 `punct` 没写时为 true，内核按这个开关把逗号、句号换成空格（属性页「标点」那一项，测试 `video_plan_projects_punctuation_in_every_language_and_honors_the_style_switch` 钉着）。改的是缺省：默认预设写 `punct: false`（视频格式规范 §5.6「默认预设」），没有样式文档的字幕与新建的字幕样式照原文画标点；`frame-render` 的 `unstyled_captions_draw_the_default_preset` 用只有「，」「。」「，。？！」的句子与「其实，宇航员。」核对。已有项目里的 `style: {}` 画法不变。
  - 记录不改（切条）：这份译文是智能体写的，按句级对齐与显示宽度切条（`translationCues`，架构设计 §3.5、§7.9）。「我们就把栖息舱搬到国际空间站上本来就可能有风扇的地方，」显示宽度 54（汉字与全角标点各算 2），超过一条的 42，按宽度切成差不多一样宽的两块（26 与 28），正好切在「空间｜站」。§3.8 允许 CJK 词逐字拆开，切条规则里没有「不在词内切」的约定（中文没有分词词典，Worker 对齐那套词内缝的判断没接到这里），所以是断句质量而不是违规；要改须先定切条规则。
- 烧进画面的字幕在浅色画面上看不清：第 20 秒白字压在白色色带上，几个字几乎消失（`<E>/evidence/mcp-walk-frame-20s.png`），默认样式没有描边或底衬。
  - 已处置：默认预设是「经典」涂装（白字、黑色描边（`textOutline.width` 14，随字号缩放）、黑色投影，底板关着），没有样式文档的字幕按它画，编辑器、智能体与固定流程新建字幕样式时种这一份（视频格式规范 §5.6）；预览与导出走同一个内核。有样式文档的照它画，已有的 `style: {}` 不变，要在旧项目里看到效果得套一次「经典」或重建字幕层。
- 设计里说对外目录约 35 个工具，实际开放 33 个。——已修（afca44f8）：设计 §6.2 写成实际的 33 个。
- （§3.4 末段）对外服务的 `download` 不收 `newVideo`。——改规格（c07f41c7）：架构设计 §4.8 与 Agent 面设计 §11 原来明文不收，按裁决放开：要同时给已登记的 `project`，流程新建的视频登记进服务的范围；不给落点仍拒绝。`transcribe` 给 `url` 同理。
