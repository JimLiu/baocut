---
name: 示例润色
description: 测试用的 craft：润色一份转写。只用于渲染器与同步脚本的测试。
version: 1.0.0
---

# 润色一份转写

动笔前先用 `skills_read` 读本 skill 的 `references/notes.md`：底本与默认值都在那里。

1. 用 documents_read 读出转写，确认 sourceBasis。
2. 一词对一词地改，用 documents_put 写回同一份文档；改完用 videos_inspect 核对版本。
3. 交付时用 downloads_save 把说明放进下载目录。
4. 章节交给 {{skill:demo-chapters}}，那一步用 {{tool:edits_apply}} 的 setChapters。
