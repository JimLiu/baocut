> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# ASR Segment 初始软分段设计（修订版）

> 状态：已实施（2026-08-26）。本版在初稿基础上按代码核查结果修订，修订点见 §11。

## 0. 核心结论

模型返回的 segment 用于"转录完成后的初始段落展示"，但不直接写入 `transcript.json` 的 `paraBreaks`，也不盖 `stages.segment`。后续 polish/segment 仍负责生成正式语义分段。

初始 segment 是**可提升的投影**，不是第四种持久分段真相：

- 立即获得比"单说话人整篇一段"更好的初始效果；
- 不把模型的解码分块误认为最终段落；
- polish 保留完整的重新合并/拆分自由度。

三条修订前提（详见 §11）：

1. 段落层（`derive_paras`）的现有派生规则只有 pin / 说话人切换 / 章节切换三个边界（[cue.rs:235](../../../core/crates/bcut-flow-core/src/cue.rs)），**不存在停顿规则**——1.8 秒是 Sentence 层常量。停顿边界必须由初始分段算法自己产出。
2. Web Studio 只 poll 磁盘上的 `studio/data.json`（serve 端 `POLL_FILES`，[media.rs:723](../../../core/crates/bcut-serve/src/endpoints/media.rs)），不调用投影函数。初始边界必须随 `projection::refresh` **落进 data.json**，"仅内存克隆"对 Web 不可见。
3. `derive_paras` 只认 **Cue 首词**上的 pin；正式拆分因此成对写 `paraBreaks[next]=true` + `breaks[prev]="break"`（[source_paragraph.rs:92](../../../core/crates/bcut-flow-core/src/source_paragraph.rs)）。初始边界的注入与提升都必须复用同一配对语义，单写 `paraBreaks` 会被静默忽略或在提升后丢失边界。

## 1. 数据流

```text
ASR 模型
  │
  ├─ 原始 segments ──────────────► ai/asr-rows.json
  │                                  审计真相（engine.segmentation 标注来源）
  ▼
RowIn[]
  │
  ├─ build_doc ──────────────────► transcript.json words[]
  │                                  持久真相，不写 paraBreaks
  │
  └─ derive_initial_segment_plan ─► InitialSegmentPlan（纯函数、确定性）
                                          │
                                projection::refresh / project_language
                                成对注入克隆体 paraBreaks+breaks
                                          │
                                     studio/data.json 落盘
                                （transcript.json 不动；data.json 本就是派生缓存）
                 ┌────────────────────────┴────────────────────┐
                 ▼                                              ▼
          用户未编辑、运行 polish                    用户提交任何 Cue/Para 级 op
                 │                                              │
       LLM 重新合并/拆分并写                          原子化提升为正式
       paraBreaks + stages.segment                   paraBreaks+breaks + segment 戳
       （初始投影自动退出）                            （随后应用该 op）
```

## 2. 数据模型

V1 不修改 `transcript.json` 0.4 结构，不新增持久化分段真相。

### 2.1 `ai/asr-rows.json` 的来源标注

在 `TranscriptEngine`（[transcript.rs:6](../../../core/crates/bcut-speech-core/src/transcript.rs)）中新增可选字段：

```rust
pub struct TranscriptEngine {
    pub id: String,
    pub aligner: Option<String>,
    pub vad: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segmentation: Option<RowSegmentation>,
}

#[serde(rename_all = "lowercase")]
pub enum RowSegmentation {
    Model,     // MOSS 原生时间戳 segment（本地与远端）
    Provider,  // OpenAI segments[]、Volcano utterances[]
    Host,      // 宿主从 provider 词流合成的行（ElevenLabs 三条件切行）
    Vad,       // Qwen/Whisper 的 Silero VAD span——声学窗口，非语义边界
    Synthetic, // 整段 text 合成行、DashScope 固定时长切窗
}
```

约束：

- **必须进结构体**，不能只写进 JSON：`seed-transcript` 回写是类型化重序列化（[project.rs:1020](../../../core/crates/bcut-kernel/src/cmd/project.rs)），结构体外的键会被抹掉（顶层 `remote` 戳今天就是这样丢的）。
- `version` 维持 `"0.1"`；`Transcript` 无 `deny_unknown_fields`，老读者对新字段静默忽略，兼容。
- 来源在**各 parse 分支按实际路径填写**，不按 provider 一刀切：OpenAI `segments[]` 为空退化成合成单行时必须填 `Synthetic` 而非 `Provider`。
- 只有 `Model` 与 `Provider` 默认参与初始软分段；`Host` 默认参与但单独标注（见 §7）；`Vad`/`Synthetic` 不参与。

### 2.2 首个生产读者的契约义务

当前全仓**没有任何生产代码从磁盘读取** `ai/asr-rows.json`（唯一消费者 `seed-transcript` 从 stdin 读同契约）。投影层成为第一个生产读者，必须一并处理：

- [docs/design/subtitle/bcut-ai-pipeline-design.md](bcut-ai-pipeline-design.md) 宣称审计产物带 `fingerprint` 字段且"读取方必须校验"，但 `Transcript` 结构体没有该字段。本任务修正文档口径：同源校验以 `media.hash` 对账（见 §5），不引入新指纹字段。
- 降级路径显式化：文件缺失、解析失败、`validate()` 不过、`version` 不识别、`segmentation` 缺失或不在启用集合——一律**静默禁用初始投影**，回退现状（不报错、不阻塞投影构建）。

### 2.3 运行时结构（不落主文档）

```rust
pub struct InitialSegmentPlan {
    pub source: RowSegmentation,
    pub input_fingerprint: String,       // id_fingerprint(words)，提升时一致性校验
    pub boundaries: Vec<InitialBoundary>,
}

pub struct InitialBoundary {
    pub para_word_id: String,            // 段落首词 id（paraBreaks 键）
    pub break_after_word_id: String,     // 前一词 id（breaks 键，成对语义）
    pub strength: BoundaryStrength,
    pub evidence: Vec<BoundaryEvidence>,
}
```

`InitialBoundary` 直接携带成对键，注入与提升共用，避免两处各自换算。

## 3. 初始分段算法

新增 `bcut-flow-core::initial_segment`：输入 `TranscriptDoc + ASR RowIn[] + RowSegmentation`，输出确定性的 `InitialSegmentPlan`。纯函数、无 I/O、无随机。

### 3.1 行号 → 词 id 反查

复用而非重写：从 [speaker.rs:253](../../../core/crates/bcut-flow-core/src/speaker.rs) 的 `realign_to_row_speakers` 抽取公共映射逻辑（行序重放 + `row_index_of`）。四个已知坑均由该实现覆盖：

1. 文件行序 ≠ `gN` 序：必须重放 `build_doc` 同一套"去空行 + 按 start 稳定排序"。
2. 行首词列号不保证是 0（`enumerate` 在 `filter` 之前）：段落锚取该行在 `words[]` 中**最小列号**的词，不构造 `g{N}.0`。
3. 有的行占了行号却不产词（`build.rs` 的 `continue`）：这类行不产生边界，锚滑到下一个可映射行。
4. rebind 后 id 失去 `gN` 形态：由 §5 启用条件天然排除，算法内不处理。

### 3.2 候选边界与聚合

候选边界来自相邻模型 row 的接缝；每个候选按证据分级：

1. 说话人切换——**不写**：Para 层现有规则已产生该边界，重复写 pin 只增加提升时的噪音。
2. 完整句末标点 + 接缝停顿 ≥ 1.8s（最强）；
3. 完整句末标点；
4. 接缝停顿 0.6–1.8s；
5. 从句标点；
6. 普通模型 segment 接缝（最弱）。

注意第 2/4 级的停顿证据是**算法自己产出的**，不依赖任何 Para 层派生规则（该规则不存在，见 §0）。

聚合策略：不把每个模型 segment 都变成段落。连续 row 先聚合，满足最小内容量后才接受强边界；达到最大长度时，从窗口内选择等级最高的候选兜底。首版内部常量（不新增 CLI 参数，用真实语料校准）：

```rust
MIN_PARAGRAPH_SECONDS   = 8.0
MIN_CJK_CHARS           = 24
MIN_LATIN_WORDS         = 12
TARGET_PARAGRAPH_SECONDS = 20.0
MAX_PARAGRAPH_SECONDS   = 45.0
MAX_CJK_CHARS           = 240
MAX_LATIN_WORDS         = 120
```

硬上限对齐 segment 引擎现有兜底常量（soft 200 / hard 400 字符、1.2s，[segment.rs:43](../../../core/crates/bcut-flow-core/src/engines/segment.rs)）的量级；初稿引用的"Latin 300 / CJK 500"在代码中无出处，弃用。

预期效果：MOSS 每 2–4 秒一条的 segment 聚合成约 10–30 秒的初始段落。

## 4. 投影语义

### 4.1 注入位置

修改共享投影层 [projection.rs](../../../core/crates/bcut-workspace/src/studio/projection.rs)（`studio/data.json` 的唯一构建实现），在 `build` 的派生入口前统一注入：

- `refresh`（写盘路径）：注入后随 `data.json` 落盘——Web 靠 poll 读文件，这是它看到初始段落的唯一方式；
- `project_language`（App 换显示语言的内存重投影）：同一注入，否则切语言后初始段落消失。

注入方式：克隆 `TranscriptDoc`，对每个 `InitialBoundary` **成对**写入克隆体：

```rust
clone.para_breaks.insert(b.para_word_id, true);
clone.breaks.insert(b.break_after_word_id, BreakOverride::Break);
```

磁盘 `transcript.json` 不动。注入改变克隆体的 `effective_breaks`，从而保证锚词成为 Cue 首词、pin 被 `derive_paras` 读到。

### 4.2 启用条件（全部满足才注入）

- `stages.segment` 不存在，或已过期（`!= id_fingerprint(words)`）；
- `ai/asr-rows.json` 存在、可解析、`validate()` 通过，且 `media.hash` 与 `DocMedia.hash` 一致（两边写的是同一个 `sha256-…` 字符串，可直接字符串比对）;
- `segmentation ∈ {model, provider, host}`；
- **结构判据**：`words[]` 的 id 全部为 `gN.*`（含 `~k` 原子）形态。polish rebind 产出的 `w…` id 天然使其失效。不用 `stages.asr == fingerprint(words)` 作主判据——那是文本内容指纹，老项目升级会回填（[upgrade.rs:434](../../../core/crates/bcut-kernel/src/cmd/upgrade.rs)）、`patch_stages` 可任意改写，且它证明的是文本未变而非 id 结构未变；
- `para_breaks` 为空。用户经 `patchTranscript.set.paraBreaks` 旁路写过任何零散 pin（该旁路真实可达，有契约测试），即视为已有人工分段意图，初始投影退出，避免混合语义。

### 4.3 投影元数据

```json
{
  "initialSegments": {
    "active": true,
    "source": "model",
    "provisional": true,
    "paragraphs": 86
  }
}
```

App 与 Web 消费同一份 `data.json`，段落 id（`p-<首词id>`）、Cue/Sentence 派生完全一致，无跨端算法漂移。

## 5. 与 polish/segment 的关系

初始计划不影响正式 AI 阶段：

- polish 输入仍来自 `words[]`，不把初始边界当作硬约束，可自由合并或拆分模型段。
- polish 完成后按现有逻辑写正式 `paraBreaks` 并盖 `stages.segment`（仅当 `stages.segment.is_none()` 且非退化，[polish.rs:3470](../../../core/crates/bcut-flow-core/src/engines/polish.rs)）；同时 rebind 使词 id 脱离 `gN` 形态——两个条件各自都会让初始投影退出，双保险。
- **不提前盖 `stages.segment`**，否则 polish 会跳过其分段派生。
- `run_segment` 无 guard、无条件重跑且 pin 只增不减（[segment.rs:971](../../../core/crates/bcut-flow-core/src/engines/segment.rs)）：用户提升后再显式跑 segment，会在提升结构上继续加钉——这是现有语义，属预期行为，验收中明确。
- V1 不写 `autoBreaks`：那是 LayoutProfile 相关的字幕 Cue 布局产物（layout 优化器专有，`autoBreaks ⊕ breaks` 合并、不入版式指纹），与段落证据语义不同。

## 6. 用户编辑提升

### 6.1 触发面：所有以 Cue、Para 或 Sentence 寻址的主源 op

初始投影中的段落 id 在磁盘文档里不存在，而服务端 `apply_source_paragraph_operation` 从**磁盘 doc** 重派生后按 id 定位 + `baseText` CAS（[apply.rs:625](../../../core/crates/bcut-workspace/src/studio/apply.rs)）。因此不仅拆分/合并，**段落正文编辑（`edit` kind）同样会 409**——它以 `paraId + baseText` 寻址，磁盘派生的段落比投影段落长。

**同样的死锁也发生在 Cue 级 op 上，这是本次修订的动因。** Cue id 是 `q-<首词id>`（[cue.rs:151](../../../core/crates/bcut-flow-core/src/cue.rs)），注入的成对 break 会改变 Cue 派生，于是每个注入边界两侧的 Cue 在投影与磁盘上是两批不同的 `q-` id。客户端拿投影 id 发出的 `sourceText` / `timing` / `sourceStructure` / `deleteOriginalCue` 必然 404 或 CAS 409（`timing` 双重失配：边界处的 Cue 端点时间也不同），而这些 op 原本不触发提升，投影每次 `refresh` 又重新注入同一批边界——客户端重试永远失败。不丢数据，但是死锁。

Sentence 也属于同一类：`derive_sentences` 会在下一词被 `paraBreaks` 钉住时闭合，id 又是 `s-<首词id>`，因此注入边界下方会出现只存在于投影的 `s-` id。代码核查确认旧整句 `translation` 没有校验 sid 是否属于当前派生 Sentence：当 `base=""` 时会直接写入 `trans[lang][sid]`，把投影 id 静默落成孤儿键；piece 与 `translationStructure` 虽依赖 `transAlign`，若已有孤儿 alignment 也可能继续改写。现统一先校验 sid 属于真实派生 Sentence，不存在时整笔 409 且不写入。`translationParagraphMerge` 原本已有 Sentence 存在性与相邻性校验。

因此触发集合为 **`sourceParagraph | sourceText | timing | sourceStructure | deleteOriginalCue | translation | translationStructure | translationParagraphMerge`**，即所有以派生 Cue / Para / Sentence 为寻址对象的主源 op。刻意不含 `sourceSpan`（按词 id 寻址，注入不影响）、`patchTranscript` / `replaceTranscript`（整文档写入口，落盘后投影按 §4.2 自动退出）、非 `main` 源路由（附加源没有初始投影）。translation 接入提升的语义是：用户编辑的是当前 provisional 投影中的 Sentence，成功提交即把这份已参与寻址的边界作为同一事务的正式结构；它不是无条件由“输入一句译文”触发全文重分段，只有 §4.2 的初始投影仍有效时才提升一次。

判定收敛到唯一函数 `studio::initial_segments::op_triggers_promotion`，由两个调用点共用：`apply::apply_transcript` 用它决定 journal 是否拆成两条共 group 的记录，`studio::apply::apply_inline_locked` 用它决定是否在该 op 应用之前提升。两处集合漂移会让 journal 记录与实际写入对不上，所以不允许各写一份 kind 列表。

提升逻辑挂在这些 kind 的统一入口前，**在该 op 应用之前**（提升后磁盘派生 id 才与投影 id 对齐）：

1. 服务端检测启用条件成立（同 §4.2，此刻磁盘 doc 应满足）；
2. 重算 `InitialSegmentPlan`，校验 `input_fingerprint == id_fingerprint(words)`。不一致（并发编辑已改写 words）→ 409 `conflict`，客户端刷新重取投影；
3. 同一事务内，把全部初始边界**成对**写入真实 `paraBreaks` + `breaks`；
4. 应用用户的原始 op（此时投影 id 与磁盘派生 id 已一致，正常走 CAS）；
5. 盖 `stages.segment = id_fingerprint(words)`；
6. journal 以 `group` 归并为一步（`promote-asr-segments` + 原 op label），undo 一次回退全部。

提升发生在**逐 op 循环内部**而不是循环之前：同一事务里若有更早的 op（如 `sourceSpan`）改写了 `words`，第 2 步的指纹校验必须能看见它并整体 409。把提升上提到循环外会绕开这个判据。

带 `syncTranslationSource` 标记的 op 需要与客户端看到相同的分段才能解析原文词区间，因此 `bilingual_replace_plan` 在「投影仍生效 + 本批确有触发 op」时先在克隆体上预注入再计算；其余路径不多付一份文档拷贝。

### 6.2 载体

- 事务保证复用现状：App 走单写者线程直调 `apply_transcript`；serve 无写线程，靠 `ProjectLock + baseRev CAS`。两端并发**结构不同、保证等价**，提升逻辑放在共享的 `bcut-workspace` 层，两端自动获得。
- 不接受客户端提交整张初始 pin 表：服务端重算是唯一提升来源，防止旧投影覆盖新文档。既有旁路（`patchTranscript.set.paraBreaks`、`replaceTranscript`）不因此封禁，但它们写入后 `para_breaks` 非空，初始投影按 §4.2 自动退出。

## 7. 后端策略

| 后端 | 行边界实际来源 | `segmentation` | 默认参与 |
|---|---|---|---:|
| MOSS 本地 | 模型原生 `[start][speaker]text[end]` | `model` | 是 |
| Remote MOSS | 远端 MOSS rows 原样透传 | `model` | 是 |
| OpenAI-compatible | `response.segments[]` | `provider` | 是 |
| OpenAI（`segments[]` 为空退化） | 整段 text 合成单行 | `synthetic` | 否 |
| Volcano | `utterances[]` | `provider` | 是 |
| ElevenLabs | **宿主**从词流合成（换人 / >0.8s 停顿 / 12s+句末标点，[bcut-cloud-stt/src/lib.rs](../../../core/crates/bcut-cloud-stt/src/lib.rs)），非 provider 原生行 | `host` | 是 |
| Qwen3/Whisper 本地 | Silero VAD span——声学窗口 | `vad` | 否 |
| DashScope | 固定时长切窗（`DASHSCOPE_WINDOW_SECONDS`，与语音内容无关） | `synthetic` | 否 |

ElevenLabs 单列 `host`：其行边界与本算法的启发式高度重叠（本质是同类信号），默认参与但保留独立关闭开关的余地；若语料校准发现它不提供增量信息，降为 `synthetic` 只需改一处映射。

## 8. 实施拆分

### 第一阶段：核心与契约

- `TranscriptEngine` 新增 `segmentation` 字段（结构体内、`serde(default)`）；各 parse 分支按实际路径填写（含 OpenAI 空 segments 退化分支）。
- 实现 `derive_initial_segment_plan` + 从 `speaker.rs` 抽取共享的行号↔词 id 映射。
- 修正 [bcut-ai-pipeline-design.md](bcut-ai-pipeline-design.md) 中 `fingerprint` 字段的失实描述。
- CLI、App 进程内、远端、云端路径统一填来源；不改变现有转录输出行为。

### 第二阶段：共享投影 + 多表面同步

- `projection::build` / `project_language` 统一注入（成对 pin+break），输出 `initialSegments` 元数据；降级路径按 §2.2。
- App（`apps/baocut`）与 Web Studio（`skills/baocut/templates/studio`）展示 `provisional` 状态。
- **多表面同步义务**：同一任务内更新 `designs/baocut` 原型的对应交互与 [product-design.md](../product/product-design.md) 章节 + README 轮次日志，并过设计系统闸门。
- 正式导出、翻译、质量检查仍读真实 transcript，不读临时计划。

### 第三阶段：编辑提升与默认启用

- §6.1 触发集合全 kind 的原子提升 + `input_fingerprint` 409 分支 + journal group 撤销。
- 真实访谈语料校准 §3.2 阈值。
- 对 MOSS / Remote MOSS / OpenAI / Volcano / ElevenLabs 默认开启。

## 9. 验收标准

- 转录结束后，单说话人长视频不再显示为一个超长段落；**停顿边界由算法自产**（不存在 Para 层停顿规则可依赖）。
- 2–4 秒模型 segment 不会一条变成一个段落。
- 纯转录完成后 `transcript.json` 无新增 `paraBreaks`、`stages.segment` 为空；初始边界只出现在 `studio/data.json`。
- **Web 端可见**：serve poll 拿到的 `data.json` 含初始段落与 `initialSegments` 元数据。
- polish 可自由合并模型边界；polish 完成后初始投影退出（segment 戳 + rebind 双条件）。
- 任一 §6.1 触发集合中的 op 触发提升，结果为成对的正式 `paraBreaks + breaks`，一步 undo 可整体回退；提升后段落边界与提升前投影**逐段一致**。
- Cue 级 op（`sourceText` / `timing` / `sourceStructure` / `deleteOriginalCue`）用**只在投影里存在**的 `q-` id 提交时一次成功，不再需要客户端重试；用例必须先断言该 id 确实不在磁盘派生 Cue 集合中，否则是假通过。
- Sentence 级 `translation` 用**只在投影里存在**的 `s-` id 提交时先提升再恰好命中；不存在的 sid（包括非 provisional 路径）统一 409，不得写入 `trans` / `transAlign` 孤儿键。同事务更早的 op 改变词结构时整体 409，一步 undo 同时回退提升与译文。
- 提升后显式跑 segment 在既有结构上增量加钉（现有语义），不报错。
- Qwen/Whisper VAD span 与 DashScope 切窗不被误认为语义段。
- `ai/asr-rows.json` 缺失/损坏/旧版时投影静默回退现状。
- CLI 转录与 App 进程内转录生成完全相同的初始计划（同一写盘代码 + 纯函数派生）。
- 不新增 LLM 调用，不改变 `words[]` 文本与时间。

## 10. 明确不做（V1）

- 不新增 `transcript.json` 字段或 `asr-rows.json` 指纹字段。
- 不写 `autoBreaks`。
- 不封禁 `patchTranscript.set.paraBreaks` / `replaceTranscript` 旁路（靠 §4.2 的 `para_breaks` 为空条件自然互斥）。
- 不为阈值新增 CLI 参数。
- Web 端显示语言钉死在 `data.json` 当前投影语言——既有限制，与本方案无关，不在此处理。

## 11. 相对初稿的修订记录

| # | 初稿表述 | 修订 | 依据 |
|---|---|---|---|
| 1 | "≥1.8s 停顿仍由现有派生规则处理，不重复写软边界" | 停顿边界改为算法自产；说话人切换维持不写 | Para 层边界仅 pin/换人/换章（cue.rs），1.8s 是 Sentence 层常量（sentence.rs） |
| 2 | "投影时克隆注入……不修改磁盘"（暗示不落盘） | 注入结果随 `refresh` 落进 `data.json`；`project_language` 同步注入 | Web 只 poll 磁盘 `data.json`，serve 不调投影函数 |
| 3 | 注入与提升只写 `paraBreaks` | 一律成对写 `paraBreaks + breaks`；`InitialBoundary` 直接携带成对键 | `derive_paras` 只认 Cue 首词 pin；正式拆分即成对语义（source_paragraph.rs） |
| 4 | 提升触发面 = 拆分/合并 | 扩为全部 `sourceParagraph` kind（含 `edit`），补 `input_fingerprint` 409 分支 | `edit` 同样按 paraId+baseText 寻址，磁盘重派生必 409 |
| 5 | 启用判据 `stages.asr == fingerprint(words)` | 改为结构判据：id 全 `gN.*` 且 `para_breaks` 为空 | 文本指纹不证 id 结构；upgrade 回填与 patch_stages 可伪造 fresh |
| 6 | ElevenLabs 标 `provider`；DashScope 归"整段 text fallback" | ElevenLabs 单列 `host`（宿主合成行）；DashScope 为固定切窗归 `synthetic`；OpenAI 空 segments 退化按分支填 `synthetic` | cloud_stt.rs 各 parse 实现 |
| 7 | `segmentation` 仅描述为 JSON 字段 | 必须进 `TranscriptEngine` 结构体（`serde(default)`） | seed-transcript 类型化回写会抹掉结构体外的键 |
| 8 | "硬质量门复用 Latin 300 / CJK 500" | 改为对齐 segment 引擎实测常量量级（200/400/1.2s），原数字无代码出处 | segment.rs 兜底常量 |
| 9 | 未提 | 补 §2.2 首个生产读者契约义务、§5 `run_segment` 增量加钉预期、§8 多表面同步义务 | asr-rows.json 现无生产读者；CLAUDE.md 多表面规则 |
| 10 | 提升触发面 = 全部 `sourceParagraph` kind | 扩为所有以 Cue/Para 寻址的主源 op（新增 `sourceText`/`timing`/`sourceStructure`/`deleteOriginalCue`），判定收敛到共享的 `op_triggers_promotion` | Cue id 是 `q-<首词id>`，注入改变 Cue 派生 → 投影 q-id 在磁盘上不存在；这些 op 原本不触发提升且投影每次 refresh 重新注入，客户端重试永远失败（UX 死锁） |
| 11 | `s-` 寻址的 translation 系列暂不扩，等待核实孤儿行为 | `translation` / `translationStructure` / `translationParagraphMerge` 全部接入提升；translation 写通道先校验真实 Sentence 存在性 | 注入的 `paraBreaks` 同样改变 Sentence 派生；旧整句 `translation` 在 sid 不存在且空 base 时会静默写孤儿键，不能只靠 provisional 窗口通常较短来规避 |

### 裁决：`s-` 寻址的 translation 系列接入提升

核查结论是旧整句 `translation` 走 `current.unwrap_or_default()` 后只做 base CAS：不存在的 sid 与“尚无译文的有效 Sentence”都会得到空串，`base=""` 随后无条件 `insert`，真实结局是**静默孤儿键**，不是 404/409，也不是恰好命中。`translationStructure` 的 `seedUnaligned` 路径会检查 Sentence，但已有 `transAlign` 的路径原本只检查 alignment；`translationParagraphMerge` 已通过 `derive_sentences` 检查两句存在且相邻。

正式决定是先把 `translation` 与 `translationStructure` 的所有 sentence / piece 写路径收紧为“sid 必须属于当前真实派生 Sentence，否则事务 409”，再把三个 translation kind 都纳入 `op_triggers_promotion`。投影边界下方的 `s-` id 在提升后由同一首词稳定派生，所以原 op 会恰好命中；提升、原 op 与 `stages.segment` 原子提交，并以同一 history group 一步撤销。虽然 provisional 窗口通常早于译文出现，但这只能降低频率，不能为死锁或孤儿写入提供正确性保证；用户以 provisional Sentence 为对象编辑时，原子固化该投影结构是可解释且可回退的提交语义。
