> 移植自 BaoCut v2；文中的数据模型名（timeline.json、Element、Source / Clip / Cut 等）指 v2 的模型，与 v3 序列、轨道、实例的对应见[元素模型对照](element-model-mapping.md)与[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# BaoCut 剪口播技术方案（原型第 192–197 轮 → 内核 / serve / App v2 / Web）

> **状态**：v0.3 实施对账（2026-09-07）。P0 审阅已为 reviewVersion 5；P1 共享语义与 API 23 Web 绑定已接通；**P2 App v2 已按原型第 192–197 轮全部落地**（§14，提交链 `dfccdfc7e` → `ab873450f` → `553421dac` → `e318281e8`）；P3 Web 只落到第 192–193 轮（§13），第 196–197 轮的 Web 缺口登记在 **§15 Web 待补齐台账**。本文早期盘点保留作背景，当前落地与验证边界以 §13–§15 为准。
> **问题**：[`designs/baocut`](../../../designs/baocut/README.md) 第 192–193 轮把「剪口播」画成了一套完整交互——AI / Agent 找口癖、停顿、重复起句写成**建议**，逐条或整批接受 / 忽略；文稿里拖选一段字按 ⌫ 手动剪；已剪的段在文稿与时间轴上都看得见、点一下恢复；每一步可撤销；文稿选区同步画到时间轴并标时码；选区上方浮一条工具条。本方案把它落到真实代码：内核已经有媒体层无损剪切、本地检测器、LLM cleanup flow 与审阅事务，缺的是**建议的持久逐条状态、建议与手动剪并存、两端的剪辑模式 UI、选区同步与 Web 的写路径**。
> **对标**：Descript 的 script-driven editing（拖选文字即选中时间轴、删字即剪片、Show/Hide deleted）。
> **关联文档**：
> - [`docs/design/cli/bcut-edit-domain-design.md`](../cli/bcut-edit-domain-design.md)——两层剪辑模型、`sources[].cuts[]`、三层时间域、`timeline/apply` op 表、`ai/cuts.json` 溯源。本方案不改这些契约，只在其上加建议层与 UI。
> - [`docs/design/bcf/baocut-format-spec.md`](../bcf/baocut-format-spec.md) §18.6 WordSpan（词区间 → 源时间的呼吸垫与帧对齐）、§19 Product Timeline。
> - [`docs/design/subtitle/bcut-ai-pipeline-design.md`](../subtitle/bcut-ai-pipeline-design.md)——「时间戳永不进 LLM」、指纹与增量语义；cleanup flow 服从同一纪律。
> - [`docs/design/editor/bcut-editor-interaction-port-design.md`](bcut-editor-interaction-port-design.md)——两薄视图共享 `bcut-editor-core` 厚语义、`SelectionSet`、键表、两视图对拍 fixture。本方案的剪辑模式沿用同一分层。
> - [`docs/design/architecture/bcut-v2-architecture-redesign.md`](../architecture/bcut-v2-architecture-redesign.md) ADR-3 协议单源、ADR-4 内核常驻优先——决定了审阅写路径必须从 App 子进程改成 `Kernel::dispatch`。
> - [`docs/design/product/product-design.md`](../product/product-design.md) §9（clean 入口与实验项目）、§12.6「剪口覆盖层」「文稿选区同步到时间轴」、§13.1「改字 / 剪辑两态」、§15.3「找可剪的口」——原型侧权威描述。

---

## 目录

本文已按章拆分（2026-09-10）：正文在 [`bcut-talking-head-cut-design/`](bcut-talking-head-cut-design/) 下，一章一个文件，超长的章再按节拆成子目录（子目录的 `README.md` 是该章导言与节目录）。引用写「§N」仍指下表第 N 章；改哪节就编辑哪个文件，新增章节新建文件并在这里加一行，**不要把正文写回本文件**。

- [0. 一页概要](bcut-talking-head-cut-design/00.md)
- [1. 目标与范围](bcut-talking-head-cut-design/01.md)
- [2. 现状盘点（2026-09-07，逐文件核实）](bcut-talking-head-cut-design/02.md)
- [3. 关键裁决](bcut-talking-head-cut-design/03.md)
- [4. 数据模型](bcut-talking-head-cut-design/04.md)
- [5. 共享语义：`bcut-editor-core::cut_mode`](bcut-talking-head-cut-design/05.md)
- [6. 检测流：`cleanup` 的增量语义与词表](bcut-talking-head-cut-design/06.md)
- [7. 写路径与协议](bcut-talking-head-cut-design/07.md)
- [8. 视图落地](bcut-talking-head-cut-design/08.md)
- [9. 播放、试听与导出](bcut-talking-head-cut-design/09.md)
- [10. 分阶段实施计划](bcut-talking-head-cut-design/10.md)
- [11. 刻意不做与开放问题](bcut-talking-head-cut-design/11.md)
- [12. 对既有文档的修订清单](bcut-talking-head-cut-design/12.md)
- [13. Web 落地对账（2026-09-07）](bcut-talking-head-cut-design/13.md)
- [14. App v2 落地对账（2026-09-07，第 192–197 轮）](bcut-talking-head-cut-design/14.md)
- [15. Web 落地台账（第 196–201 轮）](bcut-talking-head-cut-design/15.md)
