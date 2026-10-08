---
description: 通用机制：错误对象怎么用、版本冲突、等任务结束、大结果、时间的两种时钟、ID 与指代。遇到错误、要等任务或拿不准时间与 ID 时读。
---

# 约定：输出、错误、长任务与指代

这一页只讲机制。怎么判断、怎么剪、怎么译在 craft 与 [workflows](workflows.md) 里。

<!-- surface: cli -->
## 1. 命令与工具同名

目录里每个工具在 CLI 是一条命令：MCP 工具 `<名词>_<动词>` 就是 `baocut <名词> <动词>`，多词动词 `_` 换成 `-`（`import_package` ↔ `import-package`）；一级动词两边同名（`transcribe`、`export`）。参数同名：字段 `documentId` 是旗标 `--document-id`。完整对照见 [mcp](mcp.md)。

## 2. 输出是 JSON 信封

stdout 不是终端时默认输出 JSON（加 `--json` 也一样），不用解析给人看的文字。

- 成功：`{ "ok": true, "result": …, "next"?: "…", "runtime"?: { "started": true } }`。`result` 就是工具的结果对象；`next` 是建议的下一条命令，只在信封顶层出现。
- 失败：`{ "ok": false, "error": { "code", "message", "retryability"?, "recovery"?, "remedy"?, "next"? } }`。CLI 自己发现的问题（参数不对、缺 `--yes`、Runtime 不可用）也是这个形状。
- `baocut spec` 与 `baocut version` 输出裸 JSON，没有信封。
- 进度写在 stderr，不混进 stdout 的 JSON；`--progress jsonl` 时每行一个事件（`progress` / `artifact` / `warning` / `done`，带 `jobId`）。

## 3. 退出码

| 码 | 含义 | 你该做什么 |
| --- | --- | --- |
| 0 | 成功，含等到完成的任务 | 读 `result`，照 `next` 往下走 |
| 1 | 失败或取消：引擎或工具拒绝、任务以 `failed` / `cancelled` / `interrupted` 结束、`--timeout` 到时（`WAIT_TIMEOUT`，任务还在跑） | 看 `error.code`，按第 5 节处理 |
| 2 | 要用户先做一件事：配置能力、授权、同意或安装外部工具、登录、音色授权 | 把 `remedy` 与 `next` 转告用户，停下等用户；不自己绕过 |
| 3 | Runtime 不可用或版本不一致 | 见 [start](start.md) |
| 4 | 参数不对（`INVALID_ARGUMENTS`、`UNKNOWN_COMMAND`），或要确认的命令缺 `--yes`（`CONFIRMATION_REQUIRED`） | 参数错就 `baocut help <命令>` 核对后改；缺 `--yes` 就先问用户 |

Ctrl-C 先取消正在等的任务，第二次直接退出（130）。
<!-- /surface -->

## 4. 错误对象怎么用

失败时的 `error` 两个面相同：

- `code`：封闭的错误码，按它决定下一步，不按 `message` 的文字猜。
- `message`：给人看的说明，转告用户时可以引用。
- `remedy`：要用户做什么（例如启用哪项服务、装哪个模型包、去哪里同意）。有 `remedy` 的错误一般要停下来转告用户。
- `next`：建议的下一步调用，已经写成你这个面的写法，照着做即可。
- `retryability` / `recovery`：能不能原样重试、该怎么恢复。只有说可以重试时才重试；重试时带上与第一次相同的 {{arg:commandId}}（{{tool:edits_apply}} 与各一级动词都有这个字段），避免重复提交。
- `details`：细节，例如候选文档、缺几帧、哪一项画不出来；下一步要用到时从这里取。

常见错误码与下一步（由目录生成）：

<!-- generated: error-codes -->
<!-- surface: cli -->
| 错误码 | 退出码 | 下一步 |
| --- | --- | --- |
| `CAPABILITY_NOT_CONFIGURED` `DUB_SEPARATION_NOT_CONFIGURED` `MODELS_DIR_MISSING` `CREDENTIAL_UNAVAILABLE` `AUTHENTICATION_REQUIRED` `OFFLINE_STRICT` `GRANT_REQUIRED` `GRANT_REVOKED` `BUDGET_EXCEEDED` `BUDGET_UNVERIFIABLE` `TASK_BUDGET_EXCEEDED` `TASK_BUDGET_UNVERIFIABLE` `TOOL_UNAVAILABLE` `TOOL_CONSENT_REQUIRED` `TOOL_UPDATE_CONFIRM_REQUIRED` `TOOL_UPDATE_MANUAL` `MEDIA_TOOL_UNAVAILABLE` `EXPORT_TOOL_MISSING` `LINK_LOGIN_REQUIRED` `LINK_COOKIES_UNAVAILABLE` `LINK_TOOL_UPDATE_REQUIRED` `VOICE_CONSENT_REQUIRED` `VOICE_CLONE_REQUIRED` | 2 | 要用户先做一件事：配置能力、授权或预算、同意或安装外部工具、登录、音色授权。把 `remedy` 原样转告用户，用户做完后照 `next` 重试；不用脚本、别的服务商或手改配置绕过 |
| `RUNTIME_UNAVAILABLE` `RUNTIME_START_FAILED` `PROTOCOL_MISMATCH` `INTERFACE_VERSION_MISMATCH` `CATALOG_UNAVAILABLE` | 3 | Runtime 不可用或版本不同。先 `baocut runtime ensure`；接口版本不同时请用户更新 BaoCut 或 CLI，不绕过 |
| `INVALID_ARGUMENTS` `UNKNOWN_COMMAND` `UNKNOWN_TOOL` `CONFIRMATION_REQUIRED` | 4 | 参数不对：对照 `baocut help <命令>` 或 `baocut spec <名字>` 改；缺 `--yes` 时先问用户，用户同意后再加 |
| `RUNTIME_NOT_OWNED` `RUNTIME_IN_USE` | 1 | Runtime 不归这个 CLI 停，或还有人在用：不停它，留着 |
| `AGENT_SKILL_NOT_FOUND` `AGENT_SKILL_INVALID` | 1 | 说明书装不了：BaoCut 安装不完整或说明书写错了。把 `message` 原样告诉用户，请用户重装或更新 BaoCut；不自己拼装说明书 |
| 其他错误码 | 1 | 失败或取消。看 `retryability`：`after-refresh` 先重新读再提交（版本冲突 `PROJECT_REVISION_CONFLICT` 时重新 {{tool:videos_inspect}}）；`after-user-action` 转告用户；`never` 换做法。等待超时（`WAIT_TIMEOUT`）时任务还在跑，用 {{tool:jobs_wait}} 接着等 |
<!-- /surface -->
<!-- surface: agent -->
| 错误码 | 下一步 |
| --- | --- |
| `CAPABILITY_NOT_CONFIGURED` `DUB_SEPARATION_NOT_CONFIGURED` `MODELS_DIR_MISSING` `CREDENTIAL_UNAVAILABLE` `AUTHENTICATION_REQUIRED` `OFFLINE_STRICT` `GRANT_REQUIRED` `GRANT_REVOKED` `BUDGET_EXCEEDED` `BUDGET_UNVERIFIABLE` `TASK_BUDGET_EXCEEDED` `TASK_BUDGET_UNVERIFIABLE` `TOOL_UNAVAILABLE` `TOOL_CONSENT_REQUIRED` `TOOL_UPDATE_CONFIRM_REQUIRED` `TOOL_UPDATE_MANUAL` `MEDIA_TOOL_UNAVAILABLE` `EXPORT_TOOL_MISSING` `LINK_LOGIN_REQUIRED` `LINK_COOKIES_UNAVAILABLE` `LINK_TOOL_UPDATE_REQUIRED` `VOICE_CONSENT_REQUIRED` `VOICE_CLONE_REQUIRED` | 要用户先做一件事：配置能力、授权或预算、同意或安装外部工具、登录、音色授权。把 `remedy` 原样转告用户，用户做完后照 `next` 重试；不绕过 |
| `INVALID_ARGUMENTS` `UNKNOWN_TOOL` | 参数或工具名不对：对照工具的 schema 改；`edits_apply` 的操作字段用 {{tool:edits_ops}} 取 |
| 其他错误码 | 失败或取消。看 `retryability`：`after-refresh` 先重新读再提交（版本冲突 `PROJECT_REVISION_CONFLICT` 时重新 {{tool:videos_inspect}}）；`after-user-action` 转告用户；`never` 换做法 |
<!-- /surface -->
<!-- /generated -->

## 5. 版本冲突

视频有一个版本号（`revision`，十进制数字字符串），每笔修改加一。写操作带上你读到的版本：{{tool:edits_apply}} 与 {{tool:edits_undo}} 是 {{arg:expectedRevision}}，{{tool:documents_put}} 是 {{arg:revision}}。

返回 `PROJECT_REVISION_CONFLICT` 说明用户（或别的程序）刚改过视频：

1. 重新 {{tool:videos_inspect}} 读当前版本与对象 ID；改的是文档就重新 {{tool:documents_read}}。
2. 按新的状态重新决定要不要改、怎么改。用户刚改过的地方不覆盖。
3. 用新的版本提交。不要拿旧的 ID 与旧的正文盲目重试。

## 6. 等任务结束

一级动词（{{tool:transcribe}}、{{tool:translate}}、{{tool:dub}}、{{tool:download}}、{{tool:export}}、{{tool:transcode}}、{{tool:speak}}、{{tool:image}}）以及 {{tool:jobs_retry}}、{{tool:models_install}}、{{tool:models_test}} 返回任务（`jobId`）。`state` 为 `completed` 才算完成，结果在 `outputs`（文件的 `path`、`documentId`、`assetId`、`artifactId`）与流程的 `pipeline.summary` 里。

<!-- surface: cli -->
- **默认等。** 返回任务的命令默认阻塞到终态，退出码按终态给，结果里直接带 `outputs` 与终态的任务记录 `job`（顶层 `state` 也是终态）。`baocut jobs wait <jobId>` 同样等到终态。
- **给等待设上限。** 很多 Agent 宿主给一条命令几分钟的上限；长任务（转写长视频、导出成片、下载大文件、装模型包）要么加 `--timeout <秒>`、设得比宿主的上限短，要么 `--no-wait` 先拿 `jobId`。`--timeout` 到时打印 `jobId` 与最近进度，以退出码 1（`WAIT_TIMEOUT`）返回，任务继续跑；之后 `baocut jobs wait <jobId> --timeout <秒>` 接着等，照 `next` 循环到终态。
- **不要让宿主替你掐断。** 等待中的中断信号（Ctrl-C）会取消任务；靠 `--timeout` 自己返回，而不是被宿主的超时杀掉。
- 不要用 `baocut jobs inspect` 反复轮询；要取消已经 `--no-wait` 的任务用 `baocut jobs cancel <jobId>`。
<!-- /surface -->
<!-- surface: agent -->
- 用 {{tool:jobs_wait}} 等：一次最多 50 秒，`settled` 为 `false` 时再调一次接着等。不要反复用 {{tool:jobs_inspect}} 轮询。
- 要看进度或细节用 {{tool:jobs_inspect}}；要取消用 {{tool:jobs_cancel}}。
<!-- /surface -->
- 失败的固定流程（转写、翻译、配音、下载这类多步任务）可以 {{tool:jobs_retry}} 从失败的那一步重跑，前面完成的步骤复用；单个模型任务不能重跑，重新提交一次。
- 不要重复提交同一件事。网络断开等原因要重新提交同一次调用时，带上与第一次相同的 {{arg:commandId}}，不会建出第二个任务。

<!-- surface: cli -->
## 7. 大结果写进文件

{{tool:documents_read}} 的全文、{{tool:videos_inspect}} 的完整时间线、{{tool:space_search}} 的大量命中可能很大：

- 结果超过 `--max-bytes`（默认 64 KiB）时，完整结果写到 `cwd` 下的 `.baocut-out/<工具名>-<时间>.json`，stdout 只给 `truncated: true`、`path`、覆盖范围（`coverage`）与接着读的参数（`continueWith`）。
- `--result-file <文件>`：不管多大都写到指定文件。
- 被截断的结果不是完整的视频：要么读那个文件，要么照 `continueWith` 调大 `--max-bytes` 再取，要么缩小范围（{{tool:videos_inspect}} 给 {{arg:fromSeconds}} / {{arg:toSeconds}} / {{arg:limit}}）。不要只凭摘要下结论。
- `.baocut-out/` 是临时输出，交付给用户的文件要用导出或 {{tool:artifacts_save}} 写到正式位置。

## 8. 参数怎么写

- 旗标由字段派生：`camelCase` → `--kebab-case`。布尔是开关，`false` 写 `--no-x`。数组可以重复旗标（`--at 1 --at 12.5`）。
- 每条命令最多一个位置参数（通常是视频、链接、文件或 `jobId`），与同名旗标二选一。
- 嵌套对象与操作数组写 JSON 字面量，或 `@文件`、`-`（从 stdin 读）。大段文本（{{tool:documents_put}} 的正文、{{tool:edits_apply}} 的操作、{{tool:speak}} 的文本）写进文件用 `@文件`，不塞进命令行。
- 具体有哪些字段：`baocut help <命令>`，或 `baocut spec <名字>` 取 JSON Schema。
- `--yes`：`destructive` 的命令（{{tool:videos_delete}}）与要确认大小的 {{tool:models_install}} 没有它时，打印将要做的事并以退出码 4 拒绝，不会等交互确认。先问用户，同意后再带。
<!-- /surface -->
<!-- surface: agent -->
## 7. 大结果

{{tool:videos_inspect}} 片段多时用 {{arg:fromSeconds}} / {{arg:toSeconds}} 读一段、{{arg:limit}} 限条数，不要一次读整条时间线。{{tool:space_search}} 用 {{arg:videoIds}} 缩小范围。
<!-- /surface -->

## 9. 时间

- 时间一律写**十进制秒**（`"12.5"`），范围写 `起:止`（`"10:20"`），或照工具说明写成对象。引擎把时间对齐到帧，回执的 `timeResolution` 报告实际落在哪一帧；以回执为准，不要把对齐后的 10.010 秒说成 10 秒。
- 两种时钟不要混：
  - **时间线上的秒**：移动、裁切、拆分、波纹删除、章节、取帧、导出范围用它。
  - **素材自己的秒**：转写里词的 `start` / `end`（按 `timescale` 的刻度，秒 = 刻度 ÷ timescale）、剪口（`addCuts`）用它。
  - 换算：素材上的时刻 t 在时间线上 = 片段的 `startSeconds` +（t − `sourceInSeconds`），变过速的片段再除以速率。拿不准就重新 {{tool:videos_inspect}} 读片段，不凭感觉估。
- 导出与带时间码的文稿里的时间是剪辑后时间线上的时间，剪掉的词不在里面。

## 10. ID 与指代

| 东西 | 形态 | 从哪来 |
| --- | --- | --- |
| 视频 | `videoId`，或视频目录的路径 | {{tool:videos_list}}；新建视频的结果 |
| 文档（转写、译文、字幕、提案、剪口集合） | `documentId` | {{tool:videos_inspect}} 的文档清单；{{tool:transcribe}} 结果的 `pipeline.summary.documentId` |
| 素材 | `assetId` | {{tool:videos_inspect}} 的素材库；导入的回执 |
| 时间线上的片段 | `itemId` | {{tool:videos_inspect}} 的片段；回执里新建的对象 |
| 任务 | `jobId` | 一级动词的返回 |
| 产物（生成的音频、图片、转写 JSON） | `artifactId`（`sha256:…`） | 任务结果的 `outputs` |
| 版本 | `revision`（十进制数字字符串） | {{tool:videos_inspect}} 或上一次回执 |

ID 只从工具的结果里取，不自己编，不跨视频复用。

<!-- surface: cli -->
### 视频、项目与路径

- 各工具的 {{arg:video}}（{{tool:videos_inspect}}、{{tool:edits_apply}} 等）接受 `videoId`、视频目录的路径（绝对或相对当前目录）或 Space 条目 id，按「目录 → `videoId` → 条目」的顺序解析。没打开的视频会在调用期间打开。
- 相对路径（素材、导出目录、转码输出）都按**当前目录**解析，绝对路径照收。视频目录与 `.bcut` 不可写。
- 项目：`--project <目录>` 显式给；不给时从当前目录向上找 `.bcut/project.json`；都没有时新建的视频落到默认项目目录下的 `CLI` 项目，结果里会说明。用户在某个项目目录里工作时，在那个目录里运行命令即可。
- 导出不给目录时写到当前目录下的 `exports/`。
<!-- /surface -->
<!-- surface: agent -->
### 视频与路径

- 各工具的 {{arg:video}}（{{tool:videos_inspect}}、{{tool:edits_apply}} 等）接受 {{tool:videos_list}} 给出的 `path` 或 `videoId`。编辑器里打开的或用户点名的视频就在它上面做。
- 相对路径按会话的工作目录解析；导出不给目录时写到工作目录下的 `exports/`。
<!-- /surface -->
