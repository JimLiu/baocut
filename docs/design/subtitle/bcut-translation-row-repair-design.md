> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# 译文黏结检测与二次校正技术方案（translation row repair）

状态：**M1–M3 已完成（2026-08-26）；M5 自动收尾轮已完成（2026-08-28）**。M2 经 review 发现并修复了两处语义缺陷：`refine-align` 的密度三态判据写反，以及 paired 放宽只落在草稿路径、未进入真实 `pair_cost` 调用链；M3 四表面的条件 3 已统一为排除 `align-stale` 降级集合。CLI/serve 契约测试的既有编译阻塞也已修复并完成验证。M4 真实样本校准尚未开始。里程碑与完成标准见 §9。
范围：`bcut check` 的对齐判据、align 引擎的每句切分密度语义、`bcut refine-align`
闭环、Mac/App v2/Studio/原型四个消费表面。
不改：`words[]` 真相、Sentence 派生、`trans` 句级译文真相、翻译主提示与忠实度契约、
`derive_trans_cues` 的派生规则本身。

关联文档：
[bcut-alignment-block-subtitle-split-design.md](bcut-alignment-block-subtitle-split-design.md)（四层分离与对齐块模型，本方案的上位契约）、
[bcut-ai-pipeline-design.md](bcut-ai-pipeline-design.md) §8–§9（translate/align 引擎与波次）、
[bcut-cli-server-reference.md](../cli/bcut-cli-server-reference.md) §4.5 / §8（serve 白名单与 `translate` 参数表）、
[bcut-transcript-v03-design.md](bcut-transcript-v03-design.md) §4（`transAlign` 不变量）、
[product-design.md](../product/product-design.md) §13.2（Subtitle · Edit 的 statbar 与多对一卡）。

## 0. 结论摘要

### 修复优先级与预算一致性（2026-09-12）

`refine-align` / auto 精修共用硬故障优先的有界轮：存在 overflow、stale 或
degraded fallback 时只做 `table + auto`，先重新确定自然译文片；不同时追加
paired 密度，也不重建 brief 或嵌套 row repair。复查后再决定是否需要独立的
黏结修复；不能把修复请求已提交视为实际字幕已改善。未处理的热点在
`deferred` 中显式报告，未解决的本轮目标在 `remaining` 中报告。

真正的 paired 表格轮把同一建议片数写入载荷预算（2026-09-24 起只作指导语，最终验收改按
驻留谓词，见 §4.3 ④），禁止改写译文；不再出现提示要求至少 8 片而表格建议最多 4 片的自相矛盾。派发前校验
结构化预算与冻结目标片的一致性；Agent submit 和 provider 引擎共用此校验，
矛盾输入报 `input-conflict`，不交给模型试错。任意自由文本指令是否可满足不在
纯函数预检能力内，语义自然度仍由模型与共享验收负责。

以下历史阶段说明不改变这些当前编排优先级。CLI 精确语义见
[`refine-align` 参考](../cli/bcut-cli-server-reference/06/bcut-refine-align.md)。

用户报告的现象是：转录 + 翻译跑完后，**一条中文压着好几条英文字幕**，中文行数远少于
英文行数，希望能"二次校正"。

复核代码后的结论分两半：

1. **多对一本身是有意设计，不是缺陷。** 译文一行放得下时，几条短源短语共享一条译文
   正是 BaoCut 两阶段模型的默认形态（[`align.rs:700–711`](../../../core/crates/bcut-flow-core/src/engines/align.rs)
   的注释是显式裁决）。因此判据不能是"译文 cue 数 ≠ 源 cue 数"。
2. **但现有护栏留下了一条可精确刻画的黑洞**：`no_entry_needed` 的四项豁免
   （[`align.rs:725–728`](../../../core/crates/bcut-flow-core/src/engines/align.rs)）与
   `source_ceiling` 的三项抑制条件（[`align.rs:3325–3334`](../../../core/crates/bcut-flow-core/src/engines/align.rs)）
   叠加后，**译文短于 10 个阅读单位的句子完全不受源侧宽度与时长约束**，最长可以让
   一条中文钉在屏幕上 7 秒、盖住任意多条英文 cue，而 `bcut check` 一条警告都不出。
   这就是用户看到的黏结带。

本方案做四件事：

1. **M1 检测**：新增确定性、零 LLM 的 `bcut check` 判据 `align-row-deficit`，判的是
   **驻留失衡**（一条译文覆盖 ≥2 条源 cue 且长时间独占屏幕）而不是数量差；判据函数落在
   `bcut-flow-core`，引擎、check 与四个表面共用同一谓词，不复制阈值。
2. **M2 修复**：新增每句级切分密度指令 `density: paired`（CLI 面板 `--align-density
   paired`，默认 `auto` 行为完全不变）。被标记的句子绕过 `no_entry_needed`、关掉宽度触发的
   行合并、换一段"每源组尽量一行"的提示变体，并按驻留谓词验收（2026-09-24 前是纯算术最小片数验收，见 §4.3 ④）。
3. **M3 UI**：Mac / App v2 statbar 与句卡右键给出"N 处黏结 → 按源行重新对齐"的入口；
   Studio 与 `designs/` 原型只出只读计数（Studio 没有任何 AI 下单通道，见 §1.4）。
4. **M4 验收**：五种黏结形态 golden + 短片/长片真跑对拍，校准唯一的可调阈值。

最关键的一条规则：**修复只改 `transAlign`，永不触碰 `trans`**——二次校正是重新切分
展示层，不是重新翻译。

## 1. 现状复核（代码事实，作为设计前提）

以下均以当前 `main`（`7a70c595`）为准。

### 1.1 黏结的三条产生链

| 链 | 位置 | 形态 |
| --- | --- | --- |
| A. 引擎主动不写条目 | [`align.rs:725–763`](../../../core/crates/bcut-flow-core/src/engines/align.rs) `no_entry_needed` | 四项全满足 ⇒ `removals.push`（无投影时）或写一条单片条目（有投影时）。此后 [`split.rs:1191–1206`](../../../core/crates/bcut-flow-core/src/split.rs) `derive_trans_cues` 为该句产出**一条覆盖整句时窗**的译文 cue |
| B. 模型/引擎把行并回去 | [`translate.rs:1392–1411`](../../../core/crates/bcut-flow-core/src/engines/translate.rs) `fusion_rows_prompt_section` + [`align_block.rs:1477–1549`](../../../core/crates/bcut-flow-core/src/align_block.rs) `merge_short_rows` | 契约明写 "A sentence of four groups usually wants two rows, not four"、短组（<1.5s 或 <6 units）要求并邻、语序排不开时 "emit a single span covering `1-N`"；落库前引擎再按读速/时长/宽度确定性合并 |
| C. 兜底降级成整句 | [`align_block.rs:1214`](../../../core/crates/bcut-flow-core/src/align_block.rs) `sentence_level_entry`；[`align_block.rs:1274–1313`](../../../core/crates/bcut-flow-core/src/align_block.rs) `plan_sentence` 的三个 `SentenceLevel` 出口；[`align.rs:1043–1061`](../../../core/crates/bcut-flow-core/src/engines/align.rs) `plan_sentence_rows` 失败静默回落常规 fusion | `correspondence: "sentence"`、一块一片、整句静态上屏 |

链 A 的四项豁免（全部满足才跳过）：

```rust
// core/crates/bcut-flow-core/src/engines/align.rs:725
let no_entry_needed = !exceeds_one_line_fit(&translation, &options.lang, params.fit)  // zh fit = 16
    && crate::split::piece_display_units(&translation, &options.lang) <= params.hard   // zh hard = 20
    && dwell <= LONG_DWELL_SECONDS                                                     // 7.0s，align.rs:87
    && source_ceiling.is_none();
```

链 B 的确定性合并（[`align_block.rs:1488–1516`](../../../core/crates/bcut-flow-core/src/align_block.rs)）触发条件：
`too_fast` = 读速 > `ROW_MAX_CPS`（6.0，[`align_block.rs:1434`](../../../core/crates/bcut-flow-core/src/align_block.rs)）、
`too_small` = 时长 < `min_duration_sec`（1.0s）**或**宽度 < `ROW_MIN_UNITS`（6，[`align_block.rs:1436`](../../../core/crates/bcut-flow-core/src/align_block.rs)）；
由"太快"触发时合并守卫放宽到 `hard`(20)，只由"太小"触发时仍守 `fit`(16)。

### 1.2 已有护栏覆盖到哪里、漏在哪里

`source_ceiling`（[`align.rs:3307–3343`](../../../core/crates/bcut-flow-core/src/engines/align.rs)
`source_ceiling_issues`，经 [`align.rs:3576`](../../../core/crates/bcut-flow-core/src/engines/align.rs)
`whole_sentence_source_ceiling_issue` 被 `no_entry_needed` 门与 `bcut check` **共用同一谓词**）
的判据是：

```text
words ≥ PAIRED_MIN_SOURCE_WORDS(4)                    // align.rs:103
&& target_units ≥ PAIRED_TARGET_MIN_UNITS(10)         // align.rs:100
&& ( source_units > source_piece_hard(fit)            // en: 42*3/2 = 63 字符
   || seconds > PAIRED_SOURCE_HARD_SECONDS(6.0) )     // align.rs:97
```

也就是说，**译文短于 10 个阅读单位的句子对源侧长度完全免疫**。把它与 §1.1 的四项豁免
合并，得到 `no_entry_needed` 放行的残余集合：

- **R1（主因）**：`target_units < 10`（一条不到十个字的中文），源侧可以是任意宽度、
  任意条数的 cue，只要整句时窗 ≤ 7s。用户截图里"一条中文压三条英文"绝大多数落在这里。
- **R2**：`target_units ∈ [10, 16]` 且源侧 ≤63 字符且 ≤6s——大致是"一条半英文 cue"的量级，
  黏结程度轻。
- **R3**：源词数 < 4 的极短句，按定义豁免。

check 侧的覆盖同样有洞：

| 已有码 | 位置 | 判据 | 对黏结的覆盖 |
| --- | --- | --- | --- |
| `align-stale` | [`check.rs:947–959`](../../../core/crates/bcut-engine/src/flows/check.rs) | `TransCue.fallback`，而 fallback 只在 **"译文超出单行 fit"** 时为真（[`split.rs:1200–1202`](../../../core/crates/bcut-flow-core/src/split.rs) 的注释是显式裁决：「翻译流不读取源 Cue 数量」） | **零覆盖**：R1/R2 的译文按定义放得下一行，`fallback = false` |
| `align-source-ceiling` | [`check.rs:986–1005`](../../../core/crates/bcut-engine/src/flows/check.rs)（无条目分支）+ [`:1114`](../../../core/crates/bcut-engine/src/flows/check.rs)（有条目分支） | 同 §1.2 谓词 | 覆盖"源行过宽/过长且译文够长"，正是 R1 的补集 |
| `align-paired-density` | [`check.rs:1249`](../../../core/crates/bcut-engine/src/flows/check.rs) + [`align.rs:3603`](../../../core/crates/bcut-flow-core/src/engines/align.rs) | 源行**过密**且译文片自身已有自然缝 | 方向相反：管的是"源行太多太挤"，不是"译文太少" |
| `align-sentence-level` | [`check.rs:1492`](../../../core/crates/bcut-engine/src/flows/check.rs) | `correspondence == sentence` 计数，info 档 | 覆盖链 C，但不分辨该句盖了几条源 cue |

**全仓没有任何"译文 cue 数 vs 源 cue 数"的比较。** 这是有意的设计选择（避免把多对一
判成错误），也正是二次校正要补的那一个洞——补的方式不是恢复数量比较，而是引入驻留判据。

### 1.3 用户可见的五种黏结形态

| 形态 | 数据特征 | 产生链 |
| --- | --- | --- |
| F1 无条目 | `transAlign[lang]` 无该句键 | A |
| F2 单片 sentence 级 | 一片、`correspondence: "sentence"` | C |
| F3 片数少于源 cue 数 | 多片但每片跨多条源 cue | B |
| F4 条目失效 | `align_entry_valid`（[`split.rs:983`](../../../core/crates/bcut-flow-core/src/split.rs)）不成立 ⇒ 派生时 `fallback: true` | 编辑后漂移 |
| F5 independent 无锚 | `mode == independent`、`from = null` | 独立切分路径 |

F4 已被 `align-stale` 完整覆盖，本方案不重复报（§3.2 的排他规则）。F5 没有源词区间，
无从计数源 cue，只在 metrics 里记形态、不进判据。

### 1.4 现成可复用资产

**引擎与 CLI**

- `bcut refine-align` 闭环（[`refine.rs:272`](../../../core/crates/bcut-engine/src/flows/refine.rs)
  `run_refine_round`）：`check_verdict` → `hotspot_keys`（[`refine.rs:31`](../../../core/crates/bcut-engine/src/flows/refine.rs)，
  按码收集句 key，`align-source-*`/`align-paired-density`/`align-bilingual-anchor`/
  `align-degraded-fallback` 各 40 上限，`align-overfit`/`align-stale` 不设限）→
  `align_instructions`（[`refine.rs:155`](../../../core/crates/bcut-engine/src/flows/refine.rs)，
  逐句诊断转定向复审说明，每句 ≤3 条、整体 ≤3000 字符）→ 一次
  `translate --align-only --sentences <热点>`（[`refine.rs:303–311`](../../../core/crates/bcut-engine/src/flows/refine.rs)，
  固定 `align_fusion = "rows"`、`align_mode = "many-to-one"`）→ 复核 check 算
  `refined` / `remaining`。**新判据只要进 `hotspot_keys` 与 `align_instructions`，
  refine-align 立刻获得修复能力，不需要新 flow。**
- 定向请求形状已就位：`--align-only --sentences`，且 `AlignOptions.force = options.align_only`
  （[`translate.rs:209`](../../../core/crates/bcut-engine/src/flows/translate.rs) 与
  [`:1008`](../../../core/crates/bcut-engine/src/flows/translate.rs)）——**只要是 `--align-only` 轮，
  force 恒为真**，现有有效切分会作为载荷 draft 基准（[`align.rs:854–879`](../../../core/crates/bcut-flow-core/src/engines/align.rs)）。
  `AlignOptions` 已有 `sentences` / `targeted` / `force` 三个定向字段，新增 `density` 是同族扩展。
- serve 已注册 `refine-align` job kind（[`supervisor.rs:975–992`](../../../core/crates/bcut-serve/src/supervisor.rs)），
  `translate` kind 已白名单 `alignOnly` / `sentences` / `alignFusion`
  （[`supervisor.rs:839–860`](../../../core/crates/bcut-serve/src/supervisor.rs)）。
- 方法论范本：speaker-repair 波次（[`speaker_repair.rs:1–52`](../../../core/crates/bcut-flow-core/src/engines/speaker_repair.rs)）
  的六件套——确定性筛候选 → 开窗 → 索引契约 → 纯算术验收 → 确定性改动上限（超限整窗忽略）→
  轮次耗尽即原样。

**表面**

- **Mac**：`OrigLineView.sourceRuns(_:cueIdByWord:)`
  （[`TranslateCardOriginalLineView.swift:127`](../apps/mac/Sources/VoiceInk/Translation/Card/TranslateCardOriginalLineView.swift)
  = `sourceCueRuns` + `mergeShortRuns`）已经在**每条译文片内部按源 cue 切子行**并吸收
  ≤2 词碎渣；它的 `.count` 就是"这一条中文覆盖了几条英文字幕行"——现成度量，被
  [`TranslatePaneTable.swift:68`](../apps/mac/Sources/VoiceInk/Translation/Pane/TranslatePaneTable.swift)
  用来画子行，但**从未被用作诊断信号**。同一套规则在
  [`subtitle-rendering.js:226`](../skills/baocut/templates/studio/subtitle-rendering.js) 与
  `designs/baocut-mac/app/translate-model.js` 有逐条一致的镜像，三者必须同进同退。
- Mac 统计条 `TransStatBar`（[`TranslatePaneSupport.swift:336`](../apps/mac/Sources/VoiceInk/Translation/Pane/TranslatePaneSupport.swift)）
  已有一个可点的统计项（stale → `openSetup(lang, staleOnly: true)`，
  [`TranslatePaneView.swift:274`](../apps/mac/Sources/VoiceInk/Translation/Pane/TranslatePaneView.swift)），
  点击区、优先级降级、警示色三套机制齐备，新增一项是同构扩展。
- Mac 定向入口：AI 菜单「Re-align %@ lines…」（[`TranslatePaneActions.swift:59`](../apps/mac/Sources/VoiceInk/Translation/Pane/TranslatePaneActions.swift)）、
  句卡右键「Re-align this line」（[`TransSentenceCardView.swift:365`](../apps/mac/Sources/VoiceInk/Translation/Card/TransSentenceCardView.swift)）、
  卡片徽章 `TranslateCardBadge`（[`TranslateCardBadge.swift:9–15`](../apps/mac/Sources/VoiceInk/Translation/Card/TranslateCardBadge.swift)：
  `.realigning` / `.refreshing` / `.outOfDate` / `.timingSplit` / `.speakerSplit` / `.rewritten`）。
  请求装配在 [`Contracts.swift:458–464`](../apps/mac/Sources/BaoCutCore/Contracts.swift)：
  `kind = "translate"` + `alignOnly: true` + `sentences[]`。
- **App v2**：`AlignSpec::Scoped { language, sentences, align_only }`
  （[`ai/mod.rs:114–125`](../../../apps/baocut/src/app/editor/ai/mod.rs)），句卡已有
  `SentenceOp::Realign` / `Retranslate` / `Edit`（[`lists/translate.rs:2146–2196`](../../../apps/baocut/src/app/editor/lists/translate.rs)）
  与右键 `TranslateCardAction::Realign`（[`lists/translate.rs:2224–2250`](../../../apps/baocut/src/app/editor/lists/translate.rs)）。
- **Studio web**：`skills/baocut/templates/studio` **没有任何 AI 任务下单通道**——
  全部 `fetch` 端点只有 `__bcut/{healthz,projects,put,undo,redo,restore,history,media,
  waveform,spectrum,filmstrip,thumb,upload,transcript/apply,timeline/apply,studio/poll,ws,export/*}`，
  没有 `jobs`。因此 Studio 只能做**只读提示**，不能提供修复按钮。
- **designs/baocut**：产品设计文档 §13.2（[`product-design/13/13.2/README.md`](../product/product-design/13/13.2/README.md)）
  已经规定了「多对一卡」形态——原文侧渲染成虚线分隔子行 + chip「1 行译文 · 对应 2 条原文字幕」+
  注「几条短原文共享一条紧凑译文是多对一的默认形态……不是对齐错了」。**黏结提示必须与这张卡
  共存而不打架**：chip 说的是"这是正常的"，新提示说的是"这一条超时了"，两者的分界线正是 §3 的判据。
- **apps/windows**：无翻译/对齐 UI，本方案不适用；该表面已于 2026-08-26 归档删除。

## 2. 设计原则与不变量

- **P1 检测确定性、零 LLM。** 判据只读 `transcript.json` 与派生 cue 流，可在 UI 线程
  同步算，不产生调用成本。
- **P2 复用 refine-align 闭环，不新造 flow/波次。** 新增的是一个 check 码与一个每句级
  指令位，不是新的 job kind、新的 lane、新的阶段戳。
- **P3 修复必须换语义。** 见 §4.1：同参数重跑会撞上同一个 `no_entry_needed` 门与同一套
  合并偏置，结果逐字节相同。这是本方案必须改引擎的唯一理由。
- **P4 验收纯算术、耗尽即原样。** 沿用 speaker-repair 的裁决：修复结果必须过一条可算的
  下限，不过就**保留原状并记账**，绝不写一个更差的切分。
- **P5 只改 `transAlign`。** `trans` 是句级译文真相，`transAlign` 是展示切分覆盖层；
  二次校正是重切，不是重译，不得写 `trans`，也不得走 `transDisplay` 改写通道
  （改写是"语序交叉且超 hard"的窄任务，与黏结无关）。
- **P6 数量不匹配不是缺陷。** 判据的输出必须让 §1.4 那张「多对一卡」上的文案继续成立。

## 3. M1 检测判据：`align-row-deficit`

### 3.1 裁决：判驻留失衡，不判数量差

三个候选判据与取舍：

| 候选 | 问题 |
| --- | --- |
| 译文 cue 数 < 源 cue 数 | 直接违反 P6，会把全部合法多对一报成缺陷（真跑项目里这是多数句） |
| 译文 cue 数 / 源 cue 数 < 比例阈值 | 比例对短句极不稳定（1:2 与 2:4 同比例但观感差别巨大），且阈值无法从既有常量派生 |
| **单条译文 cue 覆盖 ≥2 条源 cue 且驻留 ≥ D 秒** | 直接对应用户体感（"钉在屏幕上"），与既有 `LONG_DWELL_SECONDS` 同族，只引入一个可校准参数 |

取第三个。它的物理含义是：**观众读完这一行中文之后，还要盯着它看很久，而屏幕另一半
的英文已经翻过两三条了。**

### 3.2 判据定义

对语言 `lang` 的每个已翻译句 `s`，令：

- `src_rows(s)` = 该句锚定词区间覆盖的**源 cue 段数**，按
  `OrigLineView.sourceRuns` 的同一规则计算：先按源 cue id 分段，再用 `mergeShortRuns`
  （≤2 词的段并入相邻段，首段前并、末段后并、中段并入较短侧、平局取前、级联）吸收碎渣。
  用 `mergeShortRuns` 而不是裸 cue 数是有意的：句首/句尾切在半条 cue 上产生的一两个词的
  残段不是黏结，Mac 已经在渲染层把它们吞掉了，判据必须与用户看到的子行数一致。
- `trans_cues(s)` = `derive_trans_cues` 为该句产出的译文 cue 列表。

判 `align-row-deficit` 命中，当且仅当同时满足：

1. `src_rows(s) ≥ 2`（单源行无从谈黏结）；
2. `trans_cues(s).len() < src_rows(s)`（确实少）；
3. 该句**不在** `align-stale` 的降级集合里（即没有一条 `TransCue.fallback == true`）——
   F4 归 `align-stale`，不重复报；
4. 且满足下列任一：
   - **(a) 驻留失衡**：存在一条译文 cue，其 `end - start ≥ D`，且它覆盖的源行数 ≥2；
   - **(b) 整句降级且源行多**：`correspondence == "sentence"` 且 `src_rows(s) ≥ S`。

命中项的载荷（供 UI 与 `align_instructions` 使用）：

```jsonc
{
  "sentence": "s12", "key": "s12",
  "sourceRows": 3,          // src_rows
  "transCues": 1,           // trans_cues.len()
  "maxDwellSec": 6.4,       // 最长的那条译文 cue 的驻留
  "targetUnits": 8,         // 该 cue 的阅读单位数，用来解释为何 source_ceiling 没兜住
  "reason": "dwell" | "sentence-level"
}
```

档位：**warning**（与 `align-source-ceiling` 同档，进 `next` 的 fix 串）。只满足
`src_rows ≥ 2 && trans_cues < src_rows` 而不满足 (a)/(b) 的句子**不报**，只在 metrics 里
计数——它们正是 §1.4 那张「多对一卡」描述的合法形态。

`fix` 串与既有码同形，并带上 §4 的新开关：

```text
bcut translate <project> --lang <lang> --align-only --align-density paired --sentences a,b,c
```

### 3.3 阈值与校准

两个参数，初值与依据：

| 参数 | 初值 | 依据 |
| --- | --- | --- |
| `D`（单条译文 cue 的驻留上限） | **5.0s** | `LONG_DWELL_SECONDS = 7.0` 是"必须请 LLM 切"的门；5–7s 这一段正是被 7s 门放过、又已经明显超过舒适阅读时长的区间。取 5.0 让判据只咬进这条缝，不与 7s 门重叠 |
| `S`（整句降级时的源行下限） | **3** | 整句对应盖 2 条源行是 `sentence_level_entry` 的常见正常形态（语序交叉）；盖 3 条起才值得请用户复核 |

两者都以 `pub const` 落在 `bcut-flow-core`，**不允许任何表面复制字面量**。校准方法（M4）：
在既有真跑项目上导出 `(src_rows, maxDwellSec, targetUnits)` 三元组的联合分布，
按 `src_rows` 分层看 `maxDwellSec` 的分位数；`D` 取"人工盲评认为黏结"的那一簇的下四分位。
初值先按 §1.2 的残余集合推理给出，**M4 前不得当作已定案数值写进任何用户可见文案**。

### 3.4 实现位置与共用契约

- **判据函数**：`bcut-flow-core` 新增 `pub fn row_deficit_issues(doc, sentences, lang, cues)
  -> Vec<RowDeficitIssue>`，与 `source_ceiling_issues_for_ranges` /
  `paired_density_issue_for_ranges` 并列，放在 `engines::align`。
  源行分段（`source_cue_runs` + `merge_short_runs`）作为 `pub fn` 一并上移到 flow-core：
  **今天这段逻辑只存在于三个表面的三份镜像里，判据一旦引用它，Rust 侧必须成为第四份，
  那就应该反过来让 Rust 成为规范来源**，三份 JS/Swift 镜像的注释改为指回 flow-core。
  规则一字不改，三方现有测试（[`subtitle-rendering.test.js:201`](../skills/baocut/templates/studio/subtitle-rendering.test.js)
  一族）保持通过。
- **check 接入**：[`check.rs`](../../../core/crates/bcut-engine/src/flows/check.rs) 已在 `:477`
  派生源 cue、在 `:940` 派生译文 cue 流，两份都现成；新增码只是多一个收集与 push 块。
- **metrics**：`SentenceAlignMetrics`（[`metrics.rs:740–770`](../../../core/crates/bcut-flow-core/src/metrics.rs)）
  增 `source_rows: usize`、`trans_cues: usize`、`max_dwell_sec: f64`；
  `AlignMetrics` 增 `row_deficit_rate: f64`（命中句 / 已翻译句）。这是 M4 校准的数据来源，
  也让 `--json` 汇总在不改 check 档位的前提下先跑起来。
- **refine 接入**：[`refine.rs:95–124`](../../../core/crates/bcut-engine/src/flows/refine.rs) 的
  码列表加 `align-row-deficit`（上限 `ROW_DEFICIT_MAX_KEYS = 40`，与同族一致）；
  [`refine.rs:196–218`](../../../core/crates/bcut-engine/src/flows/refine.rs) 的 `note` 表加一条
  英文说明，例如
  `"one translation row covers {sourceRows} source rows for {maxDwellSec}s — split it along the source rows"`。

M1 到此为止**不改任何引擎行为、不改 UI、不 bump spec**：`bcut check` 多一条警告，
`bcut refine-align` 多一类热点。这一步可以独立发布并立即让用户拿到诊断。

## 4. M2 修复语义：paired 重切

### 4.1 为什么必须改引擎

假设 M1 报出热点后直接跑现有的 `bcut translate --align-only --sentences <热点>`：

1. R1 类句子（译文 <10 units）进入 `align_sentences` 后，第一个碰到的就是
   [`align.rs:725`](../../../core/crates/bcut-flow-core/src/engines/align.rs) 的 `no_entry_needed`——
   四项判定与上一轮**逐字节相同**（译文没变、词时间没变、参数没变），于是再一次
   `removals.push`，条目再一次不存在。
2. R2/F3 类句子即使进了 LLM 轮，走的也是 `--align-only` 恒用的
   [`align_edges_system_prompt`](../core/crates/bcut-flow-core/src/engines/align.rs:1753)（要求"切成最小自然语义块"，
   与融合草稿的 `fusion_rows_prompt_section` 是两段不同提示、这一步不受
   `--align-density` 影响）；即便模型这次给出更细的块，落库前仍要经过同一个
   `bilingual_dp` 用同一个 [`pair_cost`](../core/crates/bcut-flow-core/src/align_block.rs:1040)
   计价——`((units - soft) / soft).powi(2)` 对偏窄和偏宽两个方向同罚，DP 天然会把
   细块焊回接近 `soft` 宽度的那几片，参数不变则代价函数不变，结果不变。

**结论：同参数重跑是空操作。** 修复必须以"这一句换一套切分密度"的方式表达，这是
本方案唯一必须改引擎的地方，也是 P3 的全部内容。

**修复入口走的是 dedicated edges 轮，不是 rows 草稿轮。** `--align-only` 定向修复、
`bcut check` 的 fix 串、`refine-align`、Mac/App v2 的定向按钮，全部命中现存的有效
`transAlign`（或 `no_entry_needed` 短路的整句写入），因此在 `run_align_with_drafts_and_artifacts`
里没有新草稿可接受，`accept_fused_drafts` 直接落空，句子进入
[`plan_sentence`](../core/crates/bcut-flow-core/src/align_block.rs:1310) → `bilingual_dp` →
`pair_cost` 这条常规块规划路径。只有**全新翻译**（`bcut translate` 未加
`--align-only`、这一句此前没有译文）才会先产出 `--align-fusion rows` 草稿，交给
`plan_sentence_rows` → `merge_short_rows`。下一个实施者改 paired 语义时，改错管道
（`merge_short_rows`）不会报错、也不会被 M2 的黄金测试挡住——它只是在一条黏结修复
永远不会实际经过的代码上生效，必须先认清这个岔路口。

### 4.2 `density` 指令位

```rust
/// core/crates/bcut-flow-core/src/engines/align.rs
pub enum AlignDensity {
    /// 现状：多对一是默认形态，短译文不因源长而拆。
    Auto,
    /// 二次校正：这一句尽量做到"每源行一条译文行"。
    Paired,
}
```

- `AlignOptions` 新增 `density: AlignDensity`（缺省 `Auto`）与
  `density_sentences: BTreeSet<String>`（为空时 `density` 作用于全部定向句）。
  之所以是**每句级**而不是整轮开关：refine-align 一轮会同时携带 `align-overfit`、
  `align-source-ceiling` 等其它热点，那些句子不该被强行拆密。
- CLI：`bcut translate <project> --lang <l> --align-only --align-density <auto|paired>`；
  枚举值、默认值、与 `--align-fusion` / `--align-mode` 的关系写进
  [`bcut-cli-server-reference.md`](../cli/bcut-cli-server-reference.md) §8 的 translate 参数表。
  `--align-density paired` 仅在 `--align-mode many-to-one` 下有意义（`independent` 无源锚），
  组合非法时报错而不是静默忽略。
- `bcut refine-align` 对**因 `align-row-deficit` 入选**的句子自动带上 `paired`，
  其余热点句保持 `auto`；这正是 `density_sentences` 存在的理由。

### 4.3 `Paired` 与 `Auto` 的五条差异

对被标记的句子：

1. **绕过 `no_entry_needed`**（[`align.rs:725`](../../../core/crates/bcut-flow-core/src/engines/align.rs)）：
   `density == Paired` 时该门恒为 `false`，句子必然入队产出条目。这一条单独就治好了 R1。
2. **把密度语义下推到 `pair_cost`**：真实入口不经过 `merge_short_rows`
   （见 §4.1），因此放宽必须落在 `bilingual_dp` 逐片计价的
   [`pair_cost`](../core/crates/bcut-flow-core/src/align_block.rs:1040) 里——paired 下
   取消"窄于 `soft`"方向的宽度二次惩罚（`((units - soft) / soft).powi(2)` 目前对准和
   偏窄两个方向同罚，paired 只免掉偏窄那一半，鼓励切成更多短片）；其余代价项原样
   不动：超 `fit` 的二次递增罚、`units > hard` 硬约束、源侧宽度/时窗罚
   （`SOURCE_OVER_FIT_PENALTY` / `PAIRED_SOURCE_MAX_SECONDS` / `PAIRED_SOURCE_HARD_SECONDS`）、
   阅读时长缺口罚（`DURATION_DEFICIT_WEIGHT`）与超停留罚（`DURATION_EXCESS_WEIGHT`）、
   缝罚（`seam_costs` / `BLOCKING_SEAM_PENALTY`）、块合并罚（`BLOCK_MERGE_PENALTY`）、
   置信度罚，一律照旧。`merge_short_rows` 的 `too_small` 保留按 `input.density` 放宽
   `units < ROW_MIN_UNITS` 判据（[`align_block.rs:1522–1526`](../../../core/crates/bcut-flow-core/src/align_block.rs)），
   但那只服务 §4.1 说的 rows 草稿轮，不是 paired 修复的生效路径；`too_fast`
   （读速硬守卫）在两条路径上都**原样保留**——读速是生理上限，不是排版偏好，放开它
   只会制造读不完的行。

   **已知边界（实测，M4 需带数据复核）**：宽度项的节省上限不到 1.0，因此当某个切点
   的缝价明显更高时，paired 仍然切不开。两类句子会因此稳定落进 `rowRepair.rejected`：
   一是任何两分法都会产生 ≤ `MIN_PIECE_CHARS` 碎片的极短译文——`target_cut_candidates`
   （[`split.rs`](../../../core/crates/bcut-flow-core/src/split.rs) 的 `SeamLintClass::FlashFragment`）
   给这类缝盖 `BLOCKING_SEAM_PENALTY`，**这是有意保留的**：放开它等于允许两三个字的
   闪片字幕，比黏结更糟，这类句保持多对一并记 `rejected` 正是 P4「耗尽即原样」的
   正确出口。二是没有任何标点或语义缝可用的句子（缝价按 `NO_SEAM_PENALTY` 计）。
   反过来，源侧时窗 > `PAIRED_SOURCE_HARD_SECONDS` 的句子 auto 本来就会切，
   paired 在那一段没有增量。paired 真正改变结果的区间大致是「缝价便宜（≈0.3）
   且源侧时窗落在软硬阈值之间或只触发 `SOURCE_OVER_FIT_PENALTY`」——因此
   `rejected` 的基线会明显高于零，**不能把 `rejected > 0` 当失败**，M4 校准时应
   分别统计上述两类的占比，再决定是否调整 §4.3④ 的下限式。
3. **提示段落在 `AlignOptions.instructions` 通道**：`fusion_rows_prompt_section`
   （[`translate.rs:1392`](../../../core/crates/bcut-flow-core/src/engines/translate.rs)）本身
   一字不改——它是 `bcut translate` 生成初次译文时的融合草稿提示，align-only 定向
   修复根本不会再调用它（见 §4.1）。paired 的措辞改动落在
   [`paired_prompt_instructions`](../core/crates/bcut-flow-core/src/engines/align.rs:356)：
   命中 paired 的句子逐句拼出"这些句子至少要 N 个对齐块（`aim for at least N blocks`，
   要的是沿相邻源区间给出更多更细的块、不要塌成整句一块；**行数由引擎的 DP 决定，
   模型在 edges 载体上控制不了行**）、保留自然译文原文、
   只在读速超标或时长不足 1 秒时才并行、不得为这次修复改写或挪动译文"的追加说明，
   经 `AlignOptions.instructions` 附加在 edges/table 载体的契约末尾——这是定向 refine
   本来就有的"为什么/怎么切"通道（[`AlignOptions.instructions`](../core/crates/bcut-flow-core/src/engines/align.rs:421)），
   不是新开的通道。原文那条约束保留：不得改变 `<span data-src>` 的行分区载体形状，
   Agent 与 provider 仍必须共用同一个 `is_row_partition` 校验，不允许分叉。
   **已知边界**：`bcut translate --align-density paired`（不带 `--align-only`）命中的
   句子若此前没有译文，会先走 `bcut translate` 的初次翻译，那一步用的还是
   `fusion_rows_prompt_section`（"四组通常想要两行"），paired 的追加说明要等到后续
   align 轮才会附加，在这条路径上近乎不起作用。CLI 校验层已把 paired 钉死为
   **必须**配 `--sentences`（详见 §4.2/CLI 参考文档），
   缩小误用面，但不强制要求 `--align-only`——真正有效的组合仍是
   `--align-only --align-density paired --sentences …`。
4. **按驻留谓词验收（2026-09-24 修订）**：原先的纯算术最小片数验收

   ```text
   pieces.len() ≥ min( src_rows, max(2, ceil(target_units / ROW_MIN_UNITS)) )
   ```

   把"消除了黏结但片数少一片"的好答案也拒掉了（s-g9.0：7 个 chunk 的答案被引擎合成 2 片、要求 4 片 ⇒
   `below-minimum`；worker 第 2 轮 3 行答案同样被拒）。现在这个数只进提示（"aim for about N
   blocks"）与 `rejections[].required`，是指导语不是配额。验收改用与 `align-row-deficit`
   同一个驻留谓词 `row_dwell_deficit`（驻留 ≥`ROW_DEFICIT_DWELL_SECONDS`(5s) 且覆盖 ≥2 条
   合并后的源行）逐句比较新旧形态（黏结行数、最长驻留、最大跨源行数）：
   - 新形态无黏结 ⇒ 接受，不看片数；
   - 仍有黏结但**严格更好**（三项都不变差且至少一项改善），或原条目缺失/已失效（曾有条目
     但与当前译文不匹配，或译文整句超 fit/hard）而新形态不变差 ⇒ 接受，保留
     `align-row-deficit` 告警并在 violations 记 `accepted a partial fix`；
   - 否则 `rejected`，`reason: "not-improved"`，**保留原条目/原状**（P4）。
   - 例外在前：修复调用没拿到可用答案、预算尾巴落下的是模型缺席切法
     （`deterministic/1` 等宽切、`anchor/1` 纯锚点）时，只要原条目是模型给的
     `llm-*` 对齐就直接 `rejected`，`reason: "model-free"`，不进驻留谓词——等宽切
     清掉黏结行只是因为切得更碎，不是更对的对应（2026-09-30 现场：stanford 一批
     `align-edge-ordinal` 拒收把同批 4 句 `llm-lines` 对齐换成了等宽切 / 纯锚点，
     其中一句驻留只从 6.8s 缩到 6.5s）。原条目缺失、失效或本身就是模型缺席切法时
     照常验收。

   引擎规划层同步用这个谓词：`bilingual_dp` 第一遍方案若仍黏结，第二遍给黏结片加罚分，并只
   放开可读片（≥`ROW_MIN_UNITS` 单位、时长 ≥ 最小时长、读速 ≤ `ROW_MAX_CPS`）作新切点；
   `merge_short_rows` 不再为"太窄"把两片并回一条黏结行。
5. **碎渣防线不放**：结果仍必须过 `align_entry_valid`（[`split.rs:983`](../../../core/crates/bcut-flow-core/src/split.rs)）、
   `source_fragment_issues`（≤2 词源区间配 ≥8 units 译文的"窄源配宽译"，
   [`align.rs:3513–3527`](../../../core/crates/bcut-flow-core/src/engines/align.rs)）与块层 I3/I4。
   paired 放开的是"译文行可以短"，不是"源锚可以碎"。

### 4.4 记账

`AlignOutcome` 增一个 `row_repair` 信封，随 translate 的 `--json` 与 report 输出
（与已有的 `rowsMerged` 并列，[`translate.rs:568`](../../../core/crates/bcut-engine/src/flows/translate.rs)）：

```jsonc
"rowRepair": {
  "candidates": 37,   // 带 paired 标记入队的句数
  "repaired": 29,     // 过了 §4.3 ④ 验收并落库
  "rejected": 6,      // 新形态仍黏结且不比原来好，保留原状
  "capped": 2,        // 被 40 句上限截掉、留给下一轮
  "rejections": [     // 被拒句逐句明细，最多 40 条
    {
      "sentence": "s-g21.1",
      "reason": "not-improved",   // | "no-write" | "rewritten-basis" | "model-free"
      "sourceRows": 4,            // 该句当前占用的源字幕行数
      "targetUnits": 14,          // 译文显示单位数（中日韩按全角计）
      "required": 3,              // 提示建议片数（指导语）= min(sourceRows, max(2, ceil(targetUnits / 6)))
      "delivered": 1,             // 本轮实际交付片数
      "unitsPerRow": 3.5          // targetUnits / sourceRows
    }
  ],
  "rejectionsTruncated": 0        // 超出 40 条上限、只计数的被拒句
}
```

`rejected` 非零不是失败，是 P4 的正常出口。但只有计数时「38 候选 → 38 拒 → 0 修」
判断不了是验收式过严还是这批句在目标语下本就切不出那么多片，所以逐句把算出
`required` 的两个度量一并写下来：`unitsPerRow` 明显低于 `ROW_MIN_UNITS`(6) 就是
「译文没有足够字数铺满源行」的结构性不可满足，改提示词没有用。

### 4.5 契约同步义务（硬性）

提示段与验收器的任何改动都必须**同时**落在两条路径上：本地 Agent 与 Cloud
Model/provider。两者共用同一份解析器与行分区校验器
（[`translate_html.rs:87`](../../../core/crates/bcut-flow-core/src/filepipe/translate_html.rs)
`is_row_partition`，经 [`filepipe/mod.rs:68`](../../../core/crates/bcut-flow-core/src/filepipe/mod.rs) 导出），
因此 paired 变体**不得**引入新的载体形状——只改提示措辞与落库后的验收阈值，
`<span data-src="a-b">` 的行分区形状原样不动。共享回归测试同批更新。

## 5. M3 四表面 UI

统一口径：**"黏结"计数一律来自 §3.4 的共用判据，不读 `check` 报告文件。** 表面自己
（Swift/Rust/JS）按同一规则同步计算，或消费引擎导出的 metrics；`jobs.json` 仍是任务态
唯一真相，表面不另存进度。

### 5.1 apps/mac

- **statbar**：`TransStatBar.stats` 增 `stuck: Int`，新增一个警示色统计项「N 处黏结」，
  优先级排在 `untrans` 与 stale 之间（窄条时先掉原始计数、后掉可操作警告，沿用
  [`TranslatePaneSupport.swift:400`](../apps/mac/Sources/VoiceInk/Translation/Pane/TranslatePaneSupport.swift)
  的 `Stat.priority` 机制）。点击 → `onRepairRows`，与既有 `onRetranslate` 同构。
- **确认对话**：复用 `AlignSetupBody`（[`AlignSetupBody.swift`](../apps/mac/Sources/VoiceInk/AI/Flows/Translate/AlignSetupBody.swift)），
  标题改为「按源行重新对齐」，脚注行的 `≈N lines` 用黏结句数；确认后走
  `startAlign(keys:)`（[`TranslatePaneActions.swift:72`](../apps/mac/Sources/VoiceInk/Translation/Pane/TranslatePaneActions.swift)）。
- **请求装配**：[`Contracts.swift:458`](../apps/mac/Sources/BaoCutCore/Contracts.swift) 的
  `alignOnly` 分支增 `result["alignDensity"] = .string("paired")`（仅在按黏结入口发起时）。
- **句卡右键**：在「Re-align this line」下方加「按源行拆分对齐」
  （[`TransSentenceCardView.swift:365`](../apps/mac/Sources/VoiceInk/Translation/Card/TransSentenceCardView.swift)），
  同一路径带 `density = paired`。
- **卡片徽章**：`TranslateCardBadge` 增 `.rowStuck`（warning 档），文案「N 条原文共用一行」，
  与 `.realigning` 互斥（运行中优先）。**它必须与 §1.4 的多对一 chip 并存**：chip 说明
  这是默认形态，徽章只在判据命中时出现。
- Result 阶段、Undo、运行态头（`TransRunInfo`）全部沿用现状，不新增分支。

### 5.2 App v2（apps/baocut）

- `AlignSpec::Scoped` 增 `density: AlignDensity`（[`ai/mod.rs:112`](../../../apps/baocut/src/app/editor/ai/mod.rs)），
  `start_align` 增一个 `start_align_paired` 入口；下单时透传 `alignDensity`。
- 句卡右键 `TranslateCardAction` 与悬停 `SentenceOp` 各增一项 `RealignPaired`
  （[`lists/translate.rs:2157`](../../../apps/baocut/src/app/editor/lists/translate.rs) 与
  [`:2224`](../../../apps/baocut/src/app/editor/lists/translate.rs)），沿用"不弹设置窗直接跑"的既定裁决
  （[`product-design/13/13.2/13.2.13.md:29`](../product/product-design/13/13.2/13.2.13.md)）。
- statbar 同 Mac 加一项黏结计数；v2 的运行态头不改。

### 5.3 Studio web（skills/baocut/templates/studio）

Studio **没有任何 AI 任务下单端点**（§1.4），因此：

- `translate-pane.js` 的统计条只增一个**只读**「黏结 N」计数（警示色，不可点），
  与「不画不可点的假动作」的既有裁决不冲突——不可点的计数是静态事实，
  不可点的**动作**才是假动作。
- 计数复用 `subtitle-rendering.js` 已有的 `mergeShortRuns`（[`:226`](../skills/baocut/templates/studio/subtitle-rendering.js)）
  与译文 cue 投影，规则与 flow-core 逐条一致，新增 `subtitle-rendering.test.js` 用例锁死。
- 不新增 fetch 端点、不新增按钮。

### 5.4 designs/ 原型

- [`designs/baocut/`](../../../designs/baocut/README.md)：Subtitle · Edit 画板的
  statbar 增黏结计数项；四张块语义演示卡增第五张「黏结卡」——形态 = 多对一卡 + 警示 chip +
  注「这一条中文停留 6.4s、覆盖 3 条原文字幕，超过了舒适阅读时长」。同轮更新
  [`product-design.md`](../product/product-design.md) §13.2 与该目录 README 的轮次日志（这是
  `designs/baocut` 的强制同步规则）。
- [`designs/baocut-mac/`](../designs/baocut-mac/CLAUDE.md)：`app/translate-model.js` 的
  `mergeShortRuns` 注释改为指回 flow-core；statbar 同步计数项。

### 5.5 apps/windows（已归档）

无翻译/对齐 UI，**不适用**，不创建占位实现。2026-08-26 该目录已归档删除，本节只留作
M3 表面清点的记录。

## 6. M4 验收、校准与过渡方案

### 6.1 单元测试

- **五种形态 golden**（§1.3 F1–F5 各一条 fixture）：F1/F2/F3 必须报 `align-row-deficit`
  （在满足 (a)/(b) 时），F4 只报 `align-stale`、不重复报，F5 不报。
- **合法多对一负例**：译文 12 units、覆盖 2 条源行、驻留 3.2s ⇒ **不得**命中（P6 的锁）。
- **paired plan 探针**：真实入口是 `plan_sentence` → `bilingual_dp` → `pair_cost`
  （见 §4.1），不是 `plan_sentence_rows` + `merge_short_rows`（那条只服务 rows 草稿）。
  同一条 fixture 分别以 `Auto` / `Paired` 跑 `plan_sentence`，断言 `Auto` 产 1 片、
  `Paired` 产 ≥2 片、且两者 `concat(pieces) == target`（paired 不改写译文）；再单独
  探 `pair_cost`，断言 `units ≥ soft` 时 `Auto`/`Paired` 逐字节同代价、只有
  `units < soft` 的窄侧代价被 paired 免掉。
- **建议片数**：构造一条 6 units / 3 源行的译文，断言提示建议片数被 `min` 夹到 2 而不是 3。
- **驻留验收**（2026-09-24）：s-g9.0 源词 + 7 个 chunk 的答案 ⇒ ≥3 行无黏结；少于建议片数但无黏结 ⇒
  接受；严格更好的部分修复 ⇒ 接受并告警；不改善 ⇒ `not-improved`（`align.rs` 的 `sg9_*` 测试）。
- **解析器共享测试**：paired 提示变体产出的回答仍过 `is_row_partition`；
  Agent lint 与 provider 解析走同一断言集（§4.5）。
- **镜像一致性**：flow-core 的 `merge_short_runs` 与
  [`subtitle-rendering.test.js:201`](../skills/baocut/templates/studio/subtitle-rendering.test.js)
  一族的既有用例逐条对齐（同输入同输出）。

### 6.2 真跑对拍

两个项目：短片（IBM 9min，既有对拍基准）与一个长片（≥1h）。各跑
`before`（现状）/ `after`（M2 全开 + refine-align 一轮），对比：

| 指标 | 来源 | 期望方向 |
| --- | --- | --- |
| `src_rows ≥ 2 且 maxDwellSec ≥ D` 的句数 | 新 metrics | 显著下降 |
| cps > 6 的译文 cue 比例 | 既有对拍口径 | **不上升**（paired 保留读速硬守卫，这是它的验证点） |
| overFit（超 `fit` 片比例） | 既有 | 允许小幅上升（片变短本应下降；若上升说明合并守卫写反了） |
| `align-sentence-level` 句数 | check | 不上升 |
| `rowRepair.rejected / candidates` | 新 --json | 记录，用于判断验收式是否过严 |
| 盲评忠实度 | 人工 | 不下降（paired 不改 `trans`，理论上恒等；抽样验证没有走漏改写通道） |

校准产出：`D` 与 `S` 的定案值，以及 §4.3 ④ 的分母是否该从 `ROW_MIN_UNITS` 调整。

### 6.3 过渡方案（M2 落地前用户能做什么）

现状下用户已经可以：

```bash
bcut check <project> --lang zh          # 看 align-stale / align-source-ceiling / align-overfit
bcut refine-align <project> --lang zh   # check → 定向重对齐 → 复核
bcut translate <project> --lang zh --align-only --sentences s12,s13
```

Mac 侧对应 AI 菜单「Re-align … lines…」与句卡「Re-align this line」。

**但这只能部分缓解，且治标不治本**，原因是 §4.1 的两条：R1 类句子（译文 <10 units）
重跑时会再次命中同一个 `no_entry_needed` 门，结果完全相同；能被改善的只有已经有条目、
且被其它码（`align-overfit` / `align-source-ceiling`）捞出来的句子。用户观感上"重新
对齐了一遍，最黏的那几条还是没变"正是这个机制的直接后果。这一段必须写进
release note，避免把过渡方案当成解法。

## 7. 注册与同步清单

| 事项 | 触发里程碑 | 位置 |
| --- | --- | --- |
| 新 check 码 `align-row-deficit` | M1 | [`check.rs`](../../../core/crates/bcut-engine/src/flows/check.rs)；`bcut check` 的码表文档 |
| `hotspot_keys` / `align_instructions` 新分支 | M1 | [`refine.rs:95`](../../../core/crates/bcut-engine/src/flows/refine.rs) / [`:196`](../../../core/crates/bcut-engine/src/flows/refine.rs) |
| metrics 新字段 | M1 | [`metrics.rs`](../../../core/crates/bcut-flow-core/src/metrics.rs)；`--json` 形状变化需在 reference 文档记一笔 |
| CLI `--align-density` | M2 | [`core/crates/bcut-kernel/src/cmd/ai.rs:380`](../../../core/crates/bcut-kernel/src/cmd/ai.rs) 附近（与 `align_fusion` 同族）；`bcut spec` 自动回显 |
| serve 白名单 `alignDensity` | M2 | [`supervisor.rs`](../../../core/crates/bcut-serve/src/supervisor.rs) `translate` kind 的 options 表 + [`contract.rs`](../../../core/crates/bcut-kernel/src/serve_contract.rs) 契约测试 |
| **spec 版本 bump 1.34.0 → 1.35.0** | M2 | [`core/crates/bcut-kernel/src/cmd/spec.rs:7`](../../../core/crates/bcut-kernel/src/cmd/spec.rs)。新增 job option 是协议面变化，必须 bump |
| CLI/serve 参考文档 | M2 | [`bcut-cli-server-reference.md`](../cli/bcut-cli-server-reference.md)：§4.5 的 `translate` 行加 `alignDensity`:`string` → `--align-density`；§8 的 translate 参数表加枚举、默认值、与 `--align-mode` 的冲突规则；`--json` 的 `rowRepair` 信封 |
| 四表面 UI | M3 | §5 各条；`apps/windows` 明确不适用（且已于 2026-08-26 归档删除） |
| 产品设计文档 | M3 | [`product-design.md`](../product/product-design.md) §13.2（statbar 计数项 + 黏结卡）；`designs/baocut/README.md` 轮次日志 |
| CLI `--no-row-repair` + serve 白名单 `noRowRepair` + **spec bump 1.35.0 → 1.36.0** | M5 | [`core/crates/bcut-kernel/src/cmd/ai.rs`](../../../core/crates/bcut-kernel/src/cmd/ai.rs) `TranslateArgs` / [`supervisor.rs`](../../../core/crates/bcut-serve/src/supervisor.rs) `translate` kind / [`contract.rs`](../../../core/crates/bcut-kernel/src/serve_contract.rs) 契约测试 / [`spec.rs:7`](../../../core/crates/bcut-kernel/src/cmd/spec.rs)；三个 `specVersion` 断言的集成测试同步 |
| `--json` 新增 `rowRepairAuto` / `rowRepairAutoSkipped` | M5 | [`translate.rs`](../../../core/crates/bcut-engine/src/flows/translate.rs) 两个变体的 summary；[`bcut-cli-server-reference.md`](../cli/bcut-cli-server-reference.md) §8 的 `--json` 汇总段 |
| 本文档回链 | M1 | [`AGENTS.md`](../../../AGENTS.md) 的文档路由表加一行 |

**不需要**的注册：新 job kind、新 lane、新 `AIFlowKind`、新阶段戳、新指纹、transcript
版本号变更（`transAlign` 形状不变）。

## 8. 被否决的方案

- **新独立 flow / 波次 kind（`row-repair`）。** 注册面很大：job kind 白名单、lane、
  阶段戳、四个表面的 kind 映射（[`FlowLiveProjector.swift:22`](../apps/mac/Sources/VoiceInk/Adapters/FlowLiveProjector.swift)、
  [`task_kind.rs:451`](../apps/baocut/src/adapters/task_kind.rs)、
  [`progress-status.js:33`](../skills/baocut/templates/studio/progress-status.js)）、
  spec、reference 文档全要动。而 `refine-align` 的闭环骨架（check → 热点 → 定向 → 复核）
  与本方案需要的形状**逐条同构**，本方案只需要往里加一个码和一个指令位。用注册成本换
  一个语义上完全重复的 kind 不划算。
- **把源 cue 数直接塞进翻译主 prompt。** 违背既有裁决"翻译对齐一律先按目标语独立确定并
  冻结译文 Cue，再映射到源文词区间"——让模型在翻译时就照着源行数写译文，会为了凑行数
  拉长或切碎句子，全局劣化忠实度，而黏结只是少数句的问题。付出的是全篇代价，换回的是
  局部收益。
- **无差别调低 `LONG_DWELL_SECONDS` 或 `TransParams.fit`。** 这两个常量是全局阈值，
  调低会把**全部**合法多对一打碎：`LONG_DWELL` 从 7s 降到 5s 会让大量 5–7s 的正常整句
  入队请 LLM 切分（调用量与降级率同时上升），`fit` 从 16 降下来则直接改变全部语言的
  单行容量与派生 cue 形状。判据要的是"只咬进残余集合"，全局阈值做不到这件事。
- **Mac 端本地拆行、不写回 transcript。** 表面上最省事：反正 Mac 已经会算 `sourceRuns`，
  照着源行把译文按比例切开显示就行。但这违背单一真相——切分结果不进 `transAlign`，
  导出（SRT/烧录）、Studio、App v2、CLI 全都看不到，同一个项目在不同表面显示不同行数，
  且下一次 `bcut check` 依然报同样的问题。展示切分必须是落盘的覆盖层。
- **把判据做成 `align-stale` 的一个新 `reason`。** `align-stale` 的语义是"条目缺失或
  失效导致降级"，其 fix 是重建条目；黏结句的条目往往是**有效的**，只是密度不对。
  混进同一个码会让 `hotspot_keys` 的无上限分支吞掉全部黏结句（该分支不设 40 上限），
  一轮 refine 的定向句集会失控。

## 9. 实施里程碑与任务拆分

每个里程碑独立可验收、可单独发布。

### M1 · 判据与诊断（不动 UI、不 bump spec）

内容：`source_cue_runs` / `merge_short_runs` 上移 flow-core；`row_deficit_issues`；
check 新码；metrics 新字段；refine 接入；§6.1 的单测（除 paired 探针外全部）。

完成标准：在既有真跑项目上 `bcut check --json` 能列出黏结句及其
`sourceRows/transCues/maxDwellSec`；合法多对一负例不命中；三份 JS/Swift 镜像的既有测试
全绿。

```bash
cd core
cargo fmt --all -- --check
cargo test -p bcut-flow-core
cargo test -p bcut-engine
cd ../skills/baocut/templates/studio && node --test subtitle-rendering.test.js
```

### M2 · paired 重切语义（引擎 + CLI + serve + 文档）

内容：`AlignDensity`；`no_entry_needed` 旁路；`merge_short_rows` 的 paired 分支；
提示变体；最小片数验收；`rowRepair` 记账；`--align-density`；serve 白名单 + 契约测试；
spec bump 1.35.0；reference 文档三处。

完成标准：`--align-density paired --sentences <黏结句>` 对 R1 类句子必产出 ≥2 片或
明确 `rejected` 记账；`auto` 路径的 golden 输出**逐字节不变**（零行为漂移是本里程碑的
第一验收项）；serve 契约测试覆盖新 option；`bcut spec` 回显新枚举。

```bash
cd core
cargo fmt --all -- --check
cargo test -p bcut-flow-core
cargo test -p bcut-engine
cargo test --workspace          # 跨 crate：serve 契约测试在 apps/cli
```

### M3 · 四表面 UI

内容：§5.1–§5.4。Mac、App v2、Studio、两个原型目录 + `product-design.md`。

完成标准：四个适用表面各自显示同一个黏结计数（同一项目、同一数值）；Mac 与 App v2
能发起 paired 定向重跑并在运行态头/徽章上反映；Studio 只读；`apps/windows`（已归档）在最终
回复中明确标注不适用。各表面按风险跑自己的测试（Swift 单测、`cargo test -p baocut`、
`node --test`、原型视觉检查 + `check-conformance.mjs`）。

### M4 · 校准与真跑验收

内容：§6.2 两个项目的 before/after 对拍；`D` / `S` 定案；必要时回头收紧 §4.3 ④ 的验收式；
release note 写清 §6.3 的过渡方案边界。

完成标准：黏结句数显著下降且 cps>6 比例不上升；盲评忠实度不降；阈值以定案值写回
`pub const` 与用户可见文案。

真跑属重活，遵守"不并行跑重活"的既有纪律：短片与长片串行，`--llm-concurrency` 保持默认。

### M5 · 翻译收尾的自动重切（2026-08-28 已完成）

M2 交付的是**手动**修复通道：`bcut check` 报 `align-row-deficit` → 用户自己抄
`bcut translate --align-only --align-density paired --sentences …` 或跑 `bcut refine-align`。
M5 把这条通道接进 `bcut translate` 自身，让用户翻译完就看不到黏结，不需要任何手动命令。

**形态**：单文档 `translate_cmd_core_with_analysis` 的每语言循环里，主对齐轮拿到
`align_outcome` 之后、`cancel_point` / `save_doc` 之前，插一次固定单轮的 paired 定向重切
（[`translate.rs`](../../../core/crates/bcut-engine/src/flows/translate.rs) 的
`plan_row_repair_tail` + `run_row_repair_tail`）。必须在 flow 内做：review 模式下 doc
不落盘，候选包本身要包含修复结果，拒绝时整包回滚。

**检测**：复用 check 的唯一谓词入口 `row_deficit_issues`，确定性、零 LLM，不复制阈值。
译文 cue 必须在主对齐**之后**重新 `derive_trans_cues`——它读 `trans` / `transAlign`，
两者刚被主轮改过，复用主轮之前的派生会得到空命中集、收尾轮永不触发。

**四条跳过判据**（命中任一即跳过，不产生第二次调用）：`--no-row-repair`、本轮
`--align-density` 已是 `paired`、本轮零写入（`translated == 0 && aligned == 0`，保证重复
跑 translate 仍是 no-op）、检测无命中。跳过原因回显在 `--json` 的 `rowRepairAutoSkipped`。

**选择**：命中集与本轮 `--sentences` 取交集（定向重翻只收尾自己碰过的句，历史遗留黏结
仍归 check + `refine-align`），截断到 `ROW_DEFICIT_MAX_KEYS`（40，与 refine 的黏结轮共用
同一个 `pub const`，禁止两份字面量）作为 `sentences`；**完整**命中集整份作为
`density_sentences`，差额由引擎算进 `row_repair.capped` 留给下一轮。

**执行**：第二次 `run_align_with_drafts_and_artifacts`，`density: Paired`、`targeted: true`、
`force: true`、`repair_calls: 0`、空 `FusionDrafts`（paired 走专门的 edges 轮），其余字段
沿用主轮同源取值。`force: true` 不是可选项：命中句按定义都已有**有效**的 ManyToOne 条目，
非 force 轮会在 [`align.rs` 的「已有同 mode 有效条目：非 force 跳过」](../../../core/crates/bcut-flow-core/src/engines/align.rs)
处把整批命中句跳过，收尾轮会变成零调用的空转。审计工件 run mode 为 `row-repair-tail`，
与主轮 manifest 分开。

**验收记账**：`rowRepairAuto` 是四计数对象，形状恒定（跳过或不适用时四个 `0`），消费方
不必分支 `null`。引擎自带"切不动就保持原状"（驻留验收不过 ⇒ `rejected`，原条目不变），
因此 `rejected > 0` 不是失败。收尾轮的 violations 以 `<lang> (row-repair-tail): …` 前缀
并入 advisory。只写 `transAlign`，绝不触碰句级译文真相 `trans`。

**调用方**：`bcut auto` 内嵌的 translate 轮传 `false`（fast 模式直接受益）；
`refine-align` 内部的定向 `translate --align-only` 轮传 `true`——它自己就是修复轮，
防修复套修复（其 `align_density` 本就常为 `paired`，两道闸互为冗余）。

**时间线变体不做（V1 明确跳过，不静默）**：`translate_timeline_cmd_core` 按素材调
`run_align_projected`，对齐建立在**可见词投影**上；而 `row_deficit_issues` 的 `source_rows`
来自整篇 doc 的 cue 派生，会把剪掉的词一并算进源行——两者口径不一致，硬接会得到错误的
命中集。该变体的 summary 记 `rowRepairAutoSkipped: "timeline-unsupported"`、
`rowRepairAuto` 四个 `0`，并附一条 advisory 指向 `bcut check` + `bcut refine-align`。
接通它需要先给 `row_deficit_issues` 一条投影入参，属独立里程碑。

**测试**：整条 translate flow 在进程内自建 LLM（`make_llm` 对 agent 模式直接构造
`AgentLlm`），没有注入夹具的缝，因此测试直接打在收尾轮本体与它的纯判定上，而不是把整条
flow 跑起来：`core/crates/bcut-engine/src/flows/tests.rs` 的 `row_repair_tail_tests`
覆盖「黏结句被重切成 ≥2 片、恰好 1 次调用（force 生效的哨兵）、`trans` 逐字节不变」、
「切不动则 `rejected` 且原条目原封不动」、四条跳过判据各一例、`--sentences` 交集、
45 句命中的 40 截断。
