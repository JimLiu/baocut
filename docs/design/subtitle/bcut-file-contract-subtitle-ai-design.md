> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# BaoCut 文件契约字幕 AI 管线设计（File-Contract Pipeline, v0.3）

> 状态：**M0–M4 已实现**（提交 `4be5a153..37c0baf9`），本文档自 v0.3 起是**实现规范**而非纯设计稿。本方案把润色/分段、翻译、对齐三个 LLM 阶段的**交换格式**从 JSON 换成"可直接编辑的文件"（txt / HTML / HTML 表格），由代码负责渲染与解析回写。**JSON 只作为 LLM 契约被替换；`words[]` / `trans` / `transAlign` 仍是项目真相，写入规则不变。**
>
> v0.2 已对照 `docs/bcut-file-driven-ai-pipeline-design.md`（下称参考 A）与 `docs/bcut-file-based-subtitle-ai-design.md`（下称参考 B）完成决策合并；主要决策对照见附录 §18。
>
> **2026-08 弃用执行说明**：§17.2 的「JSON 契约弃用」已执行——`--contract` 参数整体移除，五个迁移 kind（polish/translate/align/analysis/translate-brief）**恒走 file-v1**，无灰度开关；`ContractMode`、`TRANSLATE_WORDS`/`TRANSLATE_FUSED_WORDS`、json 版 `run_polish`/`run_analysis`/`run_translation_brief`、carry-over 及融合切分草稿的 json 分支一并删除。timeline 路由的 align 也走 file-v1。文中描述「json-v0 路径保留/并存」的段落自此为**历史记录**；仍然有效的 json-v0 语义只剩两条：未迁移单轮 kind（polish-retry/segment/segment-index/cleanup/broll）保持 JSON 信封（chapters 已于 2026-08 迁到 file-v1 HTML 载体 `chapters-source/1` / `chapters-outline/1` 并分页 Map/Reduce，见 AI 管线设计 §7；其 json-v0 只剩历史任务目录），以及 §9.6 的「历史 task 的 json-v0 归旧 runner 解释，本版本对其提交不 lint、原样放行」。`ai/brief.json` / `ai/polish.json` 双写与 Mac 读点迁移（§13.1（一））尚未拆除，仍按原文执行。
>
> **2026-08 分页统一说明**：analysis、segment、translate 与 align 已统一使用 `atomize::word_count`；Latin 按词、CJK 按字、依附标点不计数。analysis/segment/translate/align 的起始压测预算均为 8000 源文词，align 定点修复与全量轮共用同一预算。句数、序列化字符数与 worker 槽数不再改变页形；polish 仍使用 2200 核心词 + 两侧各最多 200 词上下文。
>
> **v0.3 变更说明**：按"实现即规范"原则，把文档与 M0–M4 落地代码对齐。v0.2 的历史结论一律保留，只改被实现推翻的部分，被改处以「**M1–M4 实现裁决**」一句注明；实现中有意为之的偏差集中记在 §13.1，未实现项一律指向 §17。读本文时的判据是：**未标注实现状态的段落 = 已按字面实现**。

---

## 目录

本文已按章拆分（2026-09-10）：正文在 [`bcut-file-contract-subtitle-ai-design/`](bcut-file-contract-subtitle-ai-design/) 下，一章一个文件，超长的章再按节拆成子目录（子目录的 `README.md` 是该章导言与节目录）。引用写「§N」仍指下表第 N 章；改哪节就编辑哪个文件，新增章节新建文件并在这里加一行，**不要把正文写回本文件**。

- [1. 目标与动机](bcut-file-contract-subtitle-ai-design/01.md)
- [2. 不变的部分（红线）](bcut-file-contract-subtitle-ai-design/02.md)
- [3. 总体架构：契约换轨](bcut-file-contract-subtitle-ai-design/03.md)
- [4. 目录布局与版本化](bcut-file-contract-subtitle-ai-design/04.md)
- [5. 阶段 0：analysis —— 摘要与术语表](bcut-file-contract-subtitle-ai-design/05.md)
- [6. 阶段 1：润色 + 分段（txt 契约）](bcut-file-contract-subtitle-ai-design/06.md)
- [7. 阶段 2：翻译（HTML 契约）](bcut-file-contract-subtitle-ai-design/07.md)
- [8. 阶段 3：对齐（HTML 表格契约）](bcut-file-contract-subtitle-ai-design/08.md)
- [9. 执行层：Agent 与 Cloud Model 的统一文档接口](bcut-file-contract-subtitle-ai-design/09.md)
- [10. 错误分类、重试记账与降级阶梯](bcut-file-contract-subtitle-ai-design/10.md)
- [11. 增量、指纹与 provenance](bcut-file-contract-subtitle-ai-design/11.md)
- [12. 分页与预算参数表（8000 词起始压测值）](bcut-file-contract-subtitle-ai-design/12.md)
- [13. 迁移、兼容与受影响面](bcut-file-contract-subtitle-ai-design/13.md)
- [14. 实施里程碑](bcut-file-contract-subtitle-ai-design/14.md)
- [15. 测试与验收](bcut-file-contract-subtitle-ai-design/15.md)
- [16. 安全与输入隔离](bcut-file-contract-subtitle-ai-design/16.md)
- [17. 开放问题与已知缺口](bcut-file-contract-subtitle-ai-design/17.md)
- [18. 附录：与两份参考方案的主要决策对照](bcut-file-contract-subtitle-ai-design/18.md)
