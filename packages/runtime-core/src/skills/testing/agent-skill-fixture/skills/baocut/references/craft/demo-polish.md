<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/demo-polish/ 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 示例润色

> 测试用的 craft：润色一份转写。只用于渲染器与同步脚本的测试。

动笔前先读 [底本与默认值](demo-polish/references/notes.md)：底本与默认值都在那里。

1. 用 `baocut documents read` 读出转写，确认 sourceBasis。
2. 一词对一词地改，用 `baocut documents put` 写回同一份文档；改完用 `baocut videos inspect` 核对版本。
3. 交付时用 downloads_save 把说明放进下载目录。
4. 章节交给 [demo-chapters](demo-chapters.md)，那一步用 `baocut edits apply` 的 setChapters。

## 同目录的文件

在 `references/craft/demo-polish/` 下，用到时再打开；代码与样例原样复制，按正文说的用法取用。

- [底本与默认值](demo-polish/references/notes.md)
