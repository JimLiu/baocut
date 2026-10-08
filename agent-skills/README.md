# agent-skills

「怎么用 BaoCut」的说明书（BaoCut skill）：教 Agent 何时用 BaoCut、怎么启动、每类任务用哪个工具、硬规则与怎么交付。设计见 [Agent 能力面设计 §8](../docs/design/agent-surface/agent-surface-design.md#8-baocut-skill)。

```text
agent-skills/
  baocut/
    SKILL.md              入口：何时用与三条底线、启动、能力目录与阅读纪律、编排、硬规则、交付
    references/
      start.md            找到 CLI、版本门、status 预检、Runtime 的归属
      conventions.md      输出与退出码、错误对象、版本冲突、等任务、大结果、时间与 ID
      catalog/*.md        按任务分的目录页：media、subtitles、editing、voice、export、models、system、web（web 只给 CLI 面）
                          声音参考独立为 voice-language-rates.md、voice-<模型系列>.md，由 voice 与 craft 引用
      workflows.md        端到端的做法
      mcp.md              走 MCP 时怎么接、工具名映射、差异
      craft/              从 skills/<id>/ 同步来的做法（生成，不手写）
```

## 与 `skills/` 的关系

| | `skills/<id>/` | `agent-skills/baocut/` |
| --- | --- | --- |
| 是什么 | craft：一种做法（润色、翻译、分章、剪口播…） | 怎么用 BaoCut：机制、目录、硬规则、交付 |
| 单一来源 | 是 | 是；craft 只引用，不复制正文 |
| 给谁 | 会话内智能体直接加载；外部 Agent 经同步副本读 | 两种读者，同一份文稿按面渲染 |

`skills/` 由 Runtime 整体加载给会话内智能体，这份说明书放进去会被当成 craft 读到，所以单独成目录。

## 一份文稿，两个面

同一份正文渲染成两面（[§8.6](../docs/design/agent-surface/agent-surface-design.md#86-一个说明书两个读者)）：

- **CLI 面**：外部 Agent（Claude Code、Codex、Cursor、Gemini CLI 等）经命令行或 MCP 使用。整个 `baocut/` 随 CLI 与桌面端分发，由 CLI 的安装命令复制进宿主的 skills 目录。
- **工具桥面**：BaoCut 自己的会话内智能体。Runtime 启动时渲染：SKILL.md 正文是会话指导的「工作方式」，目录页、workflows 与 conventions 成为内置的说明书页（`baocut-catalog-<页>`、`baocut-workflows`、`baocut-conventions`；整页在 `cli` 块里、工具桥面正文为空的页不登记，如 `web`），总在会话的 skill 索引里，按需 `skills_read`。渲染失败时 Runtime 启动失败。

## 怎么改：标记法速查

- 不写死任一面的命令或工具名，用占位符：

  | 写法 | CLI 面 | 工具桥面 |
  | --- | --- | --- |
  | `{{tool:documents_read}}` | `baocut documents read` | `documents_read` |
  | `{{tool:transcribe}}`（一级动词） | `baocut transcribe` | `transcribe` |
  | `{{arg:expectedRevision}}` | `--expected-revision` | `expectedRevision` |
  | `{{skill:polish-transcript}}` | `references/craft/polish-transcript.md` 的链接 | 「`polish-transcript`（用 `skills_read` 读）」；紧跟在「读」后面时是「用 `skills_read` 读 `polish-transcript`」 |

  工具名必须在目录里（`spec` 的工具清单），参数必须是同一小节里出现的工具的字段，craft id 必须是 `skills/` 下的目录名。只在会话里有的工具（`downloads_save`）在 CLI 面换成不提工具名的兜底写法（渲染器的 `SESSION_ONLY_TOOLS`）。
- 只属于一个面的段落用独占一行的 `<!-- surface: cli -->` … `<!-- /surface -->`（或 `agent`）包住，可以包段落、列表项、表格行或代码块，不嵌套；没标的两面都有。找 CLI、`runtime`、版本门、`--yes`、退出码、`--result-file` 与 `.baocut-out/`、MCP 接法这些 CLI 专属内容，以及元命令（`status`、`help`、`spec`、`version`）只在 `cli` 块里直接写 `baocut …`；会话审批、编辑器上下文这些只在 `agent` 块里写。
- 硬规则（SKILL.md 第 5 节）两面条数必须相同：一条只属于一个面时，`cli` 块与 `agent` 块各写一条等价的。
- 生成块 `<!-- generated: <名字> -->` … `<!-- /generated -->` 的内容由同步脚本从目录生成，不手改：`common-ops`（editing.md）、`error-codes`（conventions.md）、`tool-map`（mcp.md）。
- 页面互相引用用相对链接（`catalog/subtitles.md`、`../conventions.md`），由渲染器按面改写。
- 共享参考表只在目录页维护一份。craft 用 `skills_read` 读 `baocut-catalog-<页>`，同步成 CLI 面时改为该页链接，不把数据展开进 craft 附录；其他目录页直接用相对链接引用。模型专属音色表一套模型系列一个文件，并在 `voice.md` 登记入口。
- 写法按 [§8.7](../docs/design/agent-surface/agent-surface-design.md#87-说明书的写法)：方法（craft、workflows）与机制（conventions、catalog）分层；catalog 页按「何时用 → 前置检查 → 命令与例子 → 结果怎么读 → 常见错误码 → 下一步 → 验收」；workflows 每条按「适用与不适用 → 判断表 → 步骤 → 完成标准」；参数不抄旗标说明，指向帮助或工具说明。
- SKILL.md 正文不超过 300 行，front matter 的 `description` 不超过 300 个字符。目录页、`workflows.md` 与 `conventions.md` 也带只有 `description` 的 front matter（一句话：讲什么、什么时候读），它是会话 skill 索引里这一页的说明。
- 全部以中文写作；做法对任意语言的视频与目标语言都适用。
