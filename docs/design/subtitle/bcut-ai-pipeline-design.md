> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# bcut 转录后处理 AI 管线技术方案（润色 / 分段 / 分章节 / 翻译 / 字幕对齐）

> **版本**：实现对齐版 v0.4（2026-08-01）
> **状态**：P0–P5 与最终时间线跨源翻译已实现；代码与测试是算法参数的权威来源
> **后续重构提案**：模型内容协议从 JSON 改为 TXT / Markdown / HTML 的方案见
> [文件化字幕 AI 管线重设计](bcut-file-based-subtitle-ai-design.md)。本文继续描述当前已实现行为，
> 在该提案落地前仍是实现参考。
> **关联文档**：
> - [baocut-format-spec.md](../bcf/baocut-format-spec.md) —— §17 Project 容器 / §18 Transcript 词原子规范（本方案的数据层）
> - [bcut-cli-design.md](../cli/bcut-cli-design.md) —— §8 LLM 双执行模式 / task 应答循环（本方案的执行层）
> - [bcut-transcribe-port-plan.md](../speech/bcut-transcribe-port-plan.md) —— 本地 ASR 栈移植计划（本方案的上游）
> **参考实现**：voice-ink（Swift 版 BaoCut）的 Pipeline / Translation / AI 目录——本方案大量继承其经过实战检验的机制，并在文末（§13）列出刻意差异。
>
> **v0.3 收口**：翻译与对齐的数据结构已按
> [bcut-transcript-v03-design.md](bcut-transcript-v03-design.md) 重设计——句子
> （sentence）一等公民、`trans` 句级真相 + `transAlign` 对齐覆盖层、两种对齐
> 策略（independent / manyToOne）、fit/soft/hard 三阈值。翻译 Cue 只从 Sentence
> 派生，与源 Cue 完全独立。最终时间线项目还按 `(srcId, sentenceId)` 路由，使用
> cut 后可见词指纹、跨源上下文与源级散写；§8/§9 以下已按当前实现统一描述。

---

## 目录

本文已按章拆分（2026-09-10）：正文在 [`bcut-ai-pipeline-design/`](bcut-ai-pipeline-design/) 下，一章一个文件，超长的章再按节拆成子目录（子目录的 `README.md` 是该章导言与节目录）。引用写「§N」仍指下表第 N 章；改哪节就编辑哪个文件，新增章节新建文件并在这里加一行，**不要把正文写回本文件**。

- [1. 背景与现状](bcut-ai-pipeline-design/01.md)
- [2. 总体架构](bcut-ai-pipeline-design/02.md)
- [3. 数据与状态](bcut-ai-pipeline-design/03.md)
- [4. 阶段〇：词级时间戳与强制对齐](bcut-ai-pipeline-design/04.md)
- [5. 阶段一：润色（polish）](bcut-ai-pipeline-design/05.md)
- [6. 阶段二：分段（segment）](bcut-ai-pipeline-design/06.md)
- [7. 阶段三：分章节（chapters）](bcut-ai-pipeline-design/07.md)
- [8. 阶段四：翻译（translate）](bcut-ai-pipeline-design/08.md)
- [9. 阶段五：展示切分与字幕对齐（display split / align）](bcut-ai-pipeline-design/09.md)
- [10. LLM 调用层](bcut-ai-pipeline-design/10.md)
- [11. 编排、进度与 CLI 命令面](bcut-ai-pipeline-design/11.md)
- [12. 实施状态](bcut-ai-pipeline-design/12.md)
- [13. 与 voice-ink 的对照与刻意差异](bcut-ai-pipeline-design/13.md)
