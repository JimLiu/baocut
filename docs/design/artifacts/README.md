# docs/design/artifacts/ — 作品（Open Artifact）

幻灯片、文档、设计稿、设计系统、表格、白板、数据看板这类可以评论与协作的成品由 [Open Artifact](https://github.com/JimLiu/open-artifact) 提供，BaoCut 的 Runtime 是它的一个适配器。

| 文件 | 内容与状态 |
| --- | --- |
| [`artifacts-design.md`](artifacts-design.md) | **已实现**：范围、daemon 的连接与随应用带的运行时、三个作品工具与按动作的审批、作品回执与评论唤醒、作品标签与宿主桥、`artifacts` skill 与 `/artifacts` 命令、旧数据的处理、已知限制 |

协议见[命令协议规范 §4.1](../../spec/command-protocol-spec.md#41-方法) 的 `artifacts` 一行与 `@baocut/protocol` 的 `artifacts.ts`；实现在 `packages/runtime-core/src/artifacts/` 与 `agent-tools/artifact-tools.ts`，界面在 `packages/ui/src/components/workspace/artifact-pane.tsx`。
