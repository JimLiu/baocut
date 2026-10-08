<!-- surface: cli -->
# 走 MCP

用 `baocut mcp install --agent <宿主>` 接上；工具名与 CLI 命令一一对应：

<!-- generated: tool-map -->
| MCP 工具 | CLI 命令 | 效果 |
| --- | --- | --- |
| `assets_import` | `baocut assets import` | mutation |
| `captions_create` | `baocut captions create` | mutation |
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
<!-- /surface -->
