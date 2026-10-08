# AGENTS.md

BaoCut 编码代理的通用规则。本文只保留全局约束和阅读入口；细则按任务加载，目录内的 `AGENTS.md` 补充局部约束。

## 阅读与语言

- 默认跟随用户输入的语言回复；代码标识符、命令与已有术语保持原样。
- 先按下表定位，再从相关文档目录选 1–3 个章节读，随后看目标目录的 README、局部 `AGENTS.md` 与相邻测试；不要通读 `docs/`。
- 根文件保持精简，不超过 80 行、6 KB；新增细则放到所属文档，在这里写明触发条件与链接，不复制正文。

## 按需阅读

| 何时 | 读什么 |
| --- | --- |
| 定位模块、运行项目 | [根 README](README.md)；目录与依赖边界见[仓库约定](docs/repo-conventions.md) |
| 新建文件、包或 crate | [仓库约定](docs/repo-conventions.md)（放置与命名） |
| 新增或修改代码标识、枚举、分类或结果键（必须用英文） | [仓库约定 §3](docs/repo-conventions.md#3-命名) |
| 产品、架构、格式、协议或领域行为 | [文档阅读路线](docs/README.md#阅读路线)，选择对应主题与章节 |
| 修改规范或其他文档 | [文档约定](docs/README.md#文档约定)；[开发流程 §1](docs/development-workflow.md#1-规范与实现) |
| 准备验证改动 | [开发流程 §2](docs/development-workflow.md#2-验证)；通过标准见[验收与测试](docs/acceptance/acceptance-spec.md) |
| 修改用户可见 UI（原型先行） | [开发流程 §3](docs/development-workflow.md#3-多端同步)；图标见[仓库约定 §4](docs/repo-conventions.md#4-界面图标) |
| 修改原型 | [原型 README](designs/baocut/README.md) → [原型局部协议](designs/baocut/AGENTS.md) |
| 启动或重启设计网页 | [原型局部协议「HTTP 预览」](designs/baocut/AGENTS.md#http-预览) |
| 修改提示词、语言处理或平台专属实现 | [开发流程 §4](docs/development-workflow.md#4-语言与平台) |
| 修改文件或目录的打开、定位、选择，或其他系统集成 | [开发流程 §4.1](docs/development-workflow.md#41-跨平台系统集成) |
| 新增或修改给人看的文字（界面、错误、CLI 输出） | [仓库约定 §5](docs/repo-conventions.md#5-文案与多语言)；用词见[术语表](docs/glossary.md#界面英文用词) |
| 修改依赖、生成物，或使用 worktree | [开发流程 §5](docs/development-workflow.md#5-工作区与产物) |
| 复盘某次运行：找会话记录、工具调用参数、产物 | [开发流程 §5.3](docs/development-workflow.md#53-开发态数据与会话记录) |

## 通用约束

- 协议、格式或公开行为有意变化时，在同一任务同步实现、对应规范与测试；发现冲突明确说明，不为迁就实现擅改规格。
- UI 变化先只改原型并交用户确认，确认后才改 Electron 与 Web（[开发流程 §3](docs/development-workflow.md#3-多端同步)）；届时审计三个表面的对应功能并同步适用部分，无对应功能说明原因。后台改动未改变用户可见行为时不触发 UI 同步。
- 验证按影响选择最小但充分的范围；视觉改动检查实际页面，文档改动核对链接、路径与命令，不把未执行的检查写成通过。
- 产品能力不假定中文或英文；语言分支有明确兜底，平台专属代码条件化；系统集成必须审计 Windows / macOS 与 Web 的能力差异，按[开发流程 §4.1](docs/development-workflow.md#41-跨平台系统集成)验证。
- 依赖变化同步相应 lockfile；生成物遵守所属目录规则，临时产物放仓库外的临时目录。

## 强制完成门

凡是修改文件的实现任务，都必须在最终回复前创建 git commit。

- 开始编辑前先检查 `git status`，把任务前已有或并发出现的工作区改动视为用户所有。
- 提交前审阅最终 diff，并按风险运行适量验证；始终报告实际执行的检查和已知跳过项。
- 只暂存本任务所属的文件或 hunk；`git add` 后复核 `git diff --cached`，不得夹带无关改动。
- 在当前分支按[提交分类](docs/development-workflow.md#11-提交分类)使用 `type(scope): summary`，同类修复使用统一 scope；提交信息默认英文，写明具体变化，不加署名行；最终回复报告 commit hash。
- 完成任务后只创建本地 commit，不得自动 push（包括 force push）。推送必须由用户针对当前任务另行明确要求，之前任务的推送授权不得沿用。
- 分支／worktree 合并回 `main` 前，按[合并前提交整理](docs/development-workflow.md#12-合并前提交整理)归并为一条或少量有意义的 commit；除上述整理或用户明确要求外，不得 amend 或改写历史。只读任务与没有文件改动的任务不得创建空提交。
- **worktree 不遗留**：在 worktree（含 subagent 的 `.claude/worktrees/agent-*`）里做的任务，完成时必须删除该 worktree 及其分支。它专用的 cargo target 目录一并删掉。删除前二选一：合并进 `main`；或不合并时先把未提交改动提交到该分支，打 `archive/<worktree 名>` tag 存档，再 `git worktree remove` + `git branch -D`。编排 subagent 的会话负责收尾它派生的 worktree。确需保留的（待用户裁决、有冲突待解）在最终回复里点名路径与原因，不得默默留下。
