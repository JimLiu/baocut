# skills

这里只放 craft（做法）：一件事怎么判断、按什么步骤做。通用的「怎么用 BaoCut」（启动、能力目录、硬规则、交付）在 [`agent-skills/baocut/`](../agent-skills/README.md)，由渲染器按面分别交给会话内智能体与外部 Agent；它引用这里的 skill，外部 Agent 读到的是同步脚本生成的副本（`agent-skills/baocut/references/craft/<id>.md`），单一来源仍是这里。

随应用分发的内置 Agent skill：教内置 Agent 按某种方法做事的说明，由 Runtime 加载（[架构设计 §3.8](../docs/architecture/architecture-design.md) 的「Agent skill」）。一个 skill 一个目录，目录名就是 skill 的 `id`。内置 skill 默认开着，用户可以关，不能移除。按任务类型列出动手前要读哪个 skill 的路由在说明书 [`agent-skills/baocut/SKILL.md`](../agent-skills/baocut/SKILL.md) 的 §1（会话内智能体的指导与外部 Agent 的 skill 由它渲染），新增、改名或改变用途时同步那张表。`baocut-` 开头的 id 留给说明书页（`baocut-catalog-*`、`baocut-workflows`、`baocut-conventions`），这里不用。

| id | 名称 |
| --- | --- |
| `subtitle-workflow` | 转录与字幕 |
| `polish-transcript` | 润色转写 |
| `translate-subtitles` | 翻译字幕 |
| `video-summary` | 视频内容总结 |
| `video-blog` | 写成博客文章 |
| `titles-and-description` | 起标题与写简介 |
| `video-chapters` | 分章节 |
| `talking-head-cut` | 剪口播 |
| `shorts-segments` | 切短视频 |
| `narration` | 旁白成片 |
| `video-production` | 从简报到成片 |
| `motion-graphics` | 动效图形 |

## 新增或修改一个 skill

1. 新建 `skills/<id>/`，`id` 用 kebab-case，不与已有目录重名。
2. 写 `SKILL.md`：front matter 的 `name`（界面直接显示的短名）、`description`（做什么、什么时候用、什么时候不用；会话开始的索引只取前 300 个字符）、`version`；正文是做法，保持精炼。长的细则放进 `references/`，由智能体用 `skills_read` 按需取。
3. skill 之间不互相引用文件，每个 skill 自包含；共享的模型资料与参考表放在说明书 `references/catalog/`，用 `skills_read` 读 `baocut-catalog-<页>`，同步脚本会为外部 Agent 改成目录页链接，不复制数据。正文只引用 Agent 真实拥有的 baocut 工具与文档类型，不重复说明书（入口指导）已经说过的通用规则。
4. 做法对任意语言的视频与目标语言都适用，不假定中文或英文。
5. 不放符号链接，不用点开头的文件（不算 skill 的内容）；上限见 `@baocut/protocol` 的 `SKILL_LIMITS`。
6. 运行 `npm test -- packages/runtime-core/src/skills`：`builtin-skills.test.ts` 会加载这里的全部 skill，并核对清单与上限；新增或改名时同步更新测试里的清单、上表、说明书 SKILL.md §1 的路由（之后运行 `npm run build:agent-skill` 重新生成 craft 副本）与[产品设计 §6.9](../docs/product/product-design.md#69-skillag-07) 的「来源」一条。
