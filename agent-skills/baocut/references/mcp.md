# 走 MCP：接法、工具名与差异

<!-- surface: agent -->
会话内不需要这一页：你用的工具就是 BaoCut 的工具目录。
<!-- /surface -->
<!-- surface: cli -->
BaoCut 的 MCP 服务与 CLI 是同一份工具目录。宿主里接好 MCP 之后，可以不开子进程、直接调工具；做法、craft 与硬规则都不变。CLI 能用时两条路任选其一，同一个任务里不要混着用。

## 1. 接上

一条命令接好（要用户同意，它会改宿主的 MCP 配置）：

```text
baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <客户端名>] [--yes]
```

它开启 MCP 服务（并设为随 BaoCut 的 Runtime 启动），在 BaoCut 里为这个宿主新建一个客户端，把地址与令牌写进宿主的 MCP 配置，然后提示重启宿主。令牌的去向：Claude Code 放进它的环境变量段、配置里只写引用；Codex、Cursor、Gemini CLI 明文写在配置文件里。问用户时把这一点说清楚。宿主配置里已有 `baocut` 条目时它不覆盖，要替换加 `--yes`（同样先问）。`baocut help mcp` 看这台机器上的版本支不支持；还不支持时用下面的手动接法。

手动接法（都是本机管理命令，逐条先问用户）：

1. `baocut services start mcp` 开启 MCP 服务；`baocut services configure mcp --level ask` 设访问等级（`read` 只读；`ask` 写入与任务逐次由用户在 BaoCut 里确认，默认；`auto` 直接执行），`--videos` 限定开放的视频。
2. `baocut services mcp add-client <名字>` 为这个宿主建令牌（只显示一次，让用户自己保存）。
3. `baocut services mcp connection <clientId>` 打印地址与可以粘进宿主 MCP 配置的片段（令牌是占位符），请用户填好令牌、重启宿主。

服务只监听本机回环地址；令牌一个宿主一个，可以单独吊销。

## 2. 工具名就是 `a_b`

MCP 工具 `<名词>_<动词>` 就是 CLI 的 `baocut <名词> <动词>`，参数同名（MCP 用字段名本身，`documentId`；CLI 是 `--document-id`）。一级动词两边同名。这份 skill 里写成 `baocut …` 的命令，在 MCP 上按这条规则换成工具名即可，错误里的 `next` 已经写成工具名。

工具名对照（由目录生成）：

<!-- generated: tool-map -->
| MCP 工具 | CLI 命令 | 效果 |
| --- | --- | --- |
| `assets_import` | `baocut assets import` | mutation |
| `assets_prune` | `baocut assets prune` | mutation |
| `captions_create` | `baocut captions create` | mutation |
| `chapters_adopt` | `baocut chapters adopt` | mutation |
| `compositions_import` | `baocut compositions import` | mutation |
| `compositions_preview` | `baocut compositions preview` | mutation |
| `documents_put` | `baocut documents put` | mutation |
| `documents_read` | `baocut documents read` | query |
| `download` | `baocut download` | job |
| `dub` | `baocut dub` | job |
| `edits_apply` | `baocut edits apply` | mutation |
| `edits_ops` | `baocut edits ops` | query |
| `edits_undo` | `baocut edits undo` | mutation |
| `export` | `baocut export` | job |
| `image` | `baocut image` | job |
| `jobs_cancel` | `baocut jobs cancel` | mutation |
| `jobs_inspect` | `baocut jobs inspect` | query |
| `jobs_list` | `baocut jobs list` | query |
| `jobs_retry` | `baocut jobs retry` | job |
| `jobs_wait` | `baocut jobs wait` | query |
| `library_list` | `baocut library list` | query |
| `library_show` | `baocut library show` | query |
| `models_capabilities` | `baocut models capabilities` | query |
| `models_list` | `baocut models list` | query |
| `projects_list` | `baocut projects list` | query |
| `skills_list` | `baocut skills list` | query |
| `skills_read` | `baocut skills read` | query |
| `space_list` | `baocut space list` | query |
| `space_search` | `baocut space search` | query |
| `speak` | `baocut speak` | job |
| `transcribe` | `baocut transcribe` | job |
| `translate` | `baocut translate` | job |
| `videos_create` | `baocut videos create` | mutation |
| `videos_frames` | `baocut videos frames` | mutation |
| `videos_history` | `baocut videos history` | query |
| `videos_inspect` | `baocut videos inspect` | query |
| `videos_list` | `baocut videos list` | query |

只在 CLI 里、MCP 上没有的：`baocut artifacts save`、`baocut models install`、`baocut models test`、`baocut projects create`、`baocut transcode`、`baocut videos delete`、`baocut videos import-package`。
<!-- /generated -->

## 3. 等任务：`jobs_wait` 要循环

返回任务的工具（`transcribe`、`export`、`download`、`dub` 等）立即返回 `jobId`，不会等：

- 调 `jobs_wait { jobId }`：阻塞到终态或超时，`timeoutSec` 最多 50 秒（避开常见客户端 60 秒的请求超时）。
- `settled` 为 `false` 不是错误：照 `next` 再调一次 `jobs_wait`，直到 `state` 为终态。
- 不要用 `jobs_inspect` 反复轮询。

## 4. MCP 上没有的工具

这些只在 CLI 与 BaoCut 自己的会话里，MCP 服务不开放：

| 工具 | 改用 |
| --- | --- |
| `transcode` | CLI 的 `baocut transcode` |
| `videos_import_package` | CLI，或请用户在 BaoCut 里打开便携包 |
| `videos_delete` | 请用户在 BaoCut 里删除 |
| `projects_create` | CLI，或请用户在 BaoCut 里新建项目 |
| `artifacts_save` | 产物要放进视频直接用 `assets_import` 给 `artifactId`；要文件用 `export` |
| `models_install`、`models_test` | CLI，或请用户在 BaoCut 的设置里装 |

管理命令（设置、服务、凭据、授权）一个都不在 MCP 上。

网页版编辑器也不在 MCP 上：要看合成后的画面、拖拽调整或请用户在编辑器里审，用 CLI 的 `baocut web open --video <videoId>`（见 [web](catalog/web.md)）。

## 5. 与 CLI 的差异

| | CLI | MCP 服务 |
| --- | --- | --- |
| 身份 | 用户本人 | 一个外部客户端，受访问等级与视频范围约束 |
| 确认 | 宿主的权限提示负责；`destructive` 要 `--yes` | `ask` 等级下由用户在 BaoCut 里逐次确认，50 秒没确认就超时 |
| 路径 | 相对当前目录，用户的全部文件 | 相对视频所属项目；导出与产物只写进项目的 `exports/` |
| 新建视频 | 不给项目时从当前目录找 | `videos_create`、`download` 的 `newVideo` 都必须给 `project`（`projects_list` 取）；建好的视频自动进你的范围 |
| 转写的输入 | 链接、本机文件或视频 | 视频，或链接加 `project`；不能给本机文件（`file`、`outDir`） |
| 下载的落点 | 不给时进下载目录 | 必须给 `video`（范围之内的）或 `project`；只给 `url` 被拒绝 |
| 长任务 | 默认等到完成 | `jobId` + `jobs_wait` 循环 |
| 大结果 | 写进 `.baocut-out/` | 字节预算与游标：照结果里的说明分段取 |
| 看得到的任务 | 全部 | 自己提交的 |

## 6. 被拒时

- 返回审批被拒或超时：用户没同意，不要换个说法重试，先问用户。
- 访问范围之外的视频对你不可见：请用户在 BaoCut 里把它加进范围，不要找别的路径去读。
- `read` 等级下写入与任务都会被拒：请用户调高等级，或改走 CLI。
<!-- /surface -->
