---
name: baocut
description: 测试用的说明书：用 BaoCut 转录、翻译、剪辑与导出视频。
---

# BaoCut

有媒体要转录、翻译、剪辑或导出时用。

## 启动

<!-- surface: cli -->
1. 找到 CLI：`baocut` 在 PATH，或 `BAOCUT_CLI`。细节见 [start](references/start.md)，走 MCP 见 [mcp](references/mcp.md)。
2. `baocut version`；退出码 3 时请用户更新，不绕过。
3. `baocut status` 看这台机器能做什么。
<!-- /surface -->
<!-- surface: agent -->
工具已经接好，直接按任务读一页目录。
<!-- /surface -->

## 目录

| 页 | 覆盖什么 |
| --- | --- |
| [editing](references/catalog/editing.md) | 时间线上的修改 |
| [media](references/catalog/media.md) | 素材与取帧 |

端到端的做法在 [workflows](references/workflows.md)，错误怎么处理见 [conventions](references/conventions.md#错误码之后做什么)，启动细节在 [start](references/start.md)。

## 硬规则

- 文字工作自己做：先 {{tool:documents_read}}，译完用 {{tool:documents_put}} 写回，不配文本模型。
- 真相文件只经命令写，不碰 `video.db`。
<!-- surface: cli -->
- 不可撤销的命令先问用户，用户同意后再加 `--yes`。
<!-- /surface -->
<!-- surface: agent -->
- 不可撤销的操作先问用户，用户同意后再做。
<!-- /surface -->
- 版本冲突时重新 {{tool:videos_inspect}}，再按新的 {{arg:revision}} 提交（字段写成 `{{arg:expectedRevision}}`）。
- 润色的做法见 {{skill:demo-polish}}。

调用的样子：

```text
{{tool:edits_apply}} {{arg:expectedRevision}} 12
```

## 交付

报告改了什么、产物的真实路径、还要用户审的、没验证的。
