# 内置 skill

BaoCut 随应用分发的内置 Agent skill，也叫 craft（做法）：一件事怎么判断、按什么步骤做。由 Runtime 从这个目录加载（[架构设计 §3.8](../../../docs/architecture/architecture-design.md) 的「Agent skill」），一个 skill 一个目录，目录名就是 skill 的 `id`。内置 skill 默认开着，用户可以关，不能移除。

这个目录在说明书 [`skills/baocut/`](../../README.md) 下面。说明书讲通用的「怎么用 BaoCut」（启动、能力目录、硬规则、交付），由渲染器按面分别交给会话内智能体与外部 Agent：按任务类型列出动手前要读哪个 skill 的路由在 [`SKILL.md`](../SKILL.md) 的 §1，全部 craft 的一句话目录在 §3 末尾的「内置 skill」（只给 CLI 面；会话内智能体看会话开始的 skill 索引）。外部 Agent 读到的是同步脚本生成的副本（`../references/craft/<id>.md`），单一来源仍是这里。`baocut-` 开头的 id 留给说明书页（`baocut-catalog-*`、`baocut-workflows`、`baocut-conventions`），这里不用。

## 索引

「名称」是 `.baocut-meta.json` 里的简体中文名称；「一句话」是给维护者看的概括，界面显示的一句话介绍以 `.baocut-meta.json` 为准。

| id | 名称 | 一句话 |
| --- | --- | --- |
| [`subtitle-workflow`](subtitle-workflow/SKILL.md) | 转录与字幕 | 从链接或本机音视频建可编辑视频，转写、润色、按需翻译，放上字幕层，再按需导出 |
| [`polish-transcript`](polish-transcript/SKILL.md) | 润色转写 | 改错字与误听、统一术语与标点，写回同一份转写，词的时间不变 |
| [`speaker-labeling`](speaker-labeling/SKILL.md) | 说话人标注 | 按声纹区分说话人，凭文稿与来源里的证据起真名，写回转写的说话人 |
| [`translate-subtitles`](translate-subtitles/SKILL.md) | 翻译字幕 | 自己逐句翻译成视频里的译文，建译文或双语字幕层；也用来更新过期的译文 |
| [`video-summary`](video-summary/SKILL.md) | 视频内容总结 | 挑出最值得带走的两三件事讲透，另附一组带视频时间的要点 |
| [`video-blog`](video-blog/SKILL.md) | 写成博客文章 | 把视频写成不看视频也能读明白的完整文章，分作者视角与观众视角 |
| [`titles-and-description`](titles-and-description/SKILL.md) | 起标题与写简介 | 标题候选与视频简介（说明、章节、标签），每句都由视频兑现 |
| [`cover-and-title`](cover-and-title/SKILL.md) | 封面与标题 | 标题与封面文案候选，用户挑定后按画幅生成封面图，放进候选素材 |
| [`cross-video-qa`](cross-video-qa/SKILL.md) | 跨视频问答 | 在多部视频里按意思找某件事讲在哪、怎么讲的，只凭原话回答，每条注明视频与时间 |
| [`video-chapters`](video-chapters/SKILL.md) | 分章节 | 在话题自然转换处分章，每章一个标题和一句摘要，写进视频的章节 |
| [`talking-head-cut`](talking-head-cut/SKILL.md) | 剪口播 | 去口癖、长停顿与录废的部分，收紧节奏，按需加强调、B-roll、竖屏取景与配乐闪避 |
| [`shorts-segments`](shorts-segments/SKILL.md) | 切短视频 | 从长视频里挑出能单独发布的几段，每段建成可编辑的子视频 |
| [`narration`](narration/SKILL.md) | 旁白成片 | 按实测语速写稿，一个音色一次合成，量时长、只重配不合格的句子，再把画面剪到旁白上 |
| [`explainer-video`](explainer-video/SKILL.md) | 知识讲解视频 | 把概念、新闻或资料讲成外行也看得懂的动画讲解：核实资料，从观众的疑问写稿，定视觉比喻与动效预算，按需另出语言或画幅版本，写发布文案；制作照从简报到成片 |
| [`video-production`](video-production/SKILL.md) | 从简报到成片 | 从零做一条完整成片：风格与分镜规划，逐镜出画面，配旁白、混音、导出验收 |
| [`motion-graphics`](motion-graphics/SKILL.md) | 动效图形 | 写一个自包含的 HTML 画面做下横栏、关键词、大数字、标注或品牌贴片，打包导入后放上时间线 |
| [`slides`](slides/SKILL.md) | 幻灯片 | 在工作目录写一份 deck，校验通过后在线程里出卡片，用户在功能区预览、编辑与标注（只给会话内智能体） |
| [`design`](design/SKILL.md) | 设计稿 | 在工作目录写一份设计稿（界面、网页、海报、图表、示意图、原型），校验通过后在线程里出卡片，用户在功能区预览、编辑与标注（只给会话内智能体） |
| [`design-system`](design-system/SKILL.md) | 设计系统 | 在工作目录写一个设计系统目录（tokens、品牌手册、组件、素材），可从代码仓库或设计工具整理，供设计稿装用（只给会话内智能体） |
| [`docs`](docs/SKILL.md) | 协作文档 | 经 docs 工具在工作目录建一份协作文档（报告、提案、计划、信件、手册），先发骨架再逐节填，线程里出卡片，用户在功能区编辑、评论，评论可以发给智能体（只给会话内智能体） |

## 新增或修改一个 skill

1. 新建 `skills/baocut/built-in-skills/<id>/`，`id` 用 kebab-case，不与已有目录重名。
2. 写 `SKILL.md`：front matter 的 `name`（与目录名相同的 id 式名字）、`description`（做什么、什么时候用、什么时候不用；会话开始的索引只取前 300 个字符）、`version`；正文是做法，保持精炼。长的细则放进 `references/`（一个主题一页），由智能体用 `skills_read` 按需取；要原样拷走或运行的代码、模板与样例写成真实的文件（`examples/`、`scripts/`、`scaffold.html` 这类），不包在 Markdown 的代码块里，正文用 skill 内的相对路径提到它们。Markdown 里的代码块只放说明用的短片段。这三项都是给智能体的，界面不直接显示 `description`。
3. 写 `.baocut-meta.json`：界面上的名称（`name`）与一句话介绍（`summary`），各是「语言 → 文字」的对象，键按 `@baocut/protocol` 的 `LOCALES` 顺序写全部出货语言。名称是用户看得懂的短名（不超过 `SKILL_LIMITS.labelName` 个字符），介绍是一行、说这个 skill 帮用户做成什么（不超过 `SKILL_LIMITS.labelSummary` 个字符），不写给智能体的触发条件与步骤；用词对照[术语表](../../../docs/glossary.md#界面英文用词)与界面已有的译文。它只给设置 › Skills 与输入框「+ › 使用 Skill」用，不进文件清单，不交给智能体。
4. skill 之间不互相引用文件，每个 skill 自包含；共享的模型资料与参考表放在说明书 `references/catalog/`，用 `skills_read` 读 `baocut-catalog-<页>`，同步脚本会为外部 Agent 改成目录页链接，不复制数据。正文只引用 Agent 真实拥有的 baocut 工具与文档类型，不重复说明书（入口指导）已经说过的通用规则。
5. 做法对任意语言的视频与目标语言都适用，不假定中文或英文。
6. 不放符号链接；除了 `.baocut-meta.json`，不用点开头的文件（不算 skill 的内容）；上限见 `@baocut/protocol` 的 `SKILL_LIMITS`。
7. 运行 `npm test -- packages/runtime-core/src/skills`：`builtin-skills.test.ts` 会加载这里的全部 skill，并核对清单、上限、每个 skill 的 `.baocut-meta.json` 写全了全部出货语言、上面的索引与说明书「内置 skill」表；新增或改名时同步更新测试里的清单、上面的索引、说明书 SKILL.md §1 的路由与 §3 的「内置 skill」表（之后运行 `npm run build:agent-skill` 重新生成 craft 副本）与[产品设计 §6.9](../../../docs/product/product-design.md#69-skillag-07) 的「来源」一条。
