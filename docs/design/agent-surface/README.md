# docs/design/agent-surface/ — 面向外部 Agent 的能力面

BaoCut 向其他 Agent 开放能力的三样东西的设计：命令行 `baocut`、对外的 MCP 服务，以及教外部 Agent 使用它们的 BaoCut skill。机制上三者共用 Runtime 里的工具目录（[架构设计 §3.5](../../architecture/architecture-design.md#35-工具目录)、[§4.8](../../architecture/architecture-design.md#48-对外服务)）。

| 文件 | 内容与状态 |
| --- | --- |
| [`agent-surface-design.md`](agent-surface-design.md) | **方案稿（2026-10-06，未实现）**：CLI 成为工具目录的第三个消费者；`LocalPrincipal` 与三种主体的权限对照；一级动词 + 名词组 + 元命令的 Agent 面目录与 MCP `a_b` ↔ CLI `a b` 的映射规则；CLI 的信封、退出码、`--wait`、大结果落盘与 Runtime 归属；MCP 的开放清单与 `jobs_wait`；现有 CLI 命令的去向；`agent-skills/baocut/` 的结构与 SKILL.md 大纲；要修订的规范条目与分阶段实施顺序 |

v2 的对应设计（`bcut` CLI 与 skill）在 baocut-app 仓库的 `docs/design/cli/` 与 `skills/baocut/`，只作参考，不兼容。
