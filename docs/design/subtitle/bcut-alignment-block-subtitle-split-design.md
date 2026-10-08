> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# 字幕切分四层分离与最小单调对齐块技术方案

状态：**已确认（2026-08-16，D1–D6 全部采用默认建议），实施中**。实施记录见 §12。
范围：源字幕 Cue 切分优化器、双语字幕对齐数据模型、对齐 LLM 契约、多表面消费端；
不改 `words[]` 真相、Sentence 派生、`trans` 句级真相、Cue §18.5 派生算法本身。
关联文档：[bcut-transcript-v03-design.md](bcut-transcript-v03-design.md)（v0.3 数据模型）、
[bcut-ai-pipeline-design.md](bcut-ai-pipeline-design.md) §8–§9（translate/align 引擎）、
[bcut-file-contract-subtitle-ai-design.md](bcut-file-contract-subtitle-ai-design.md) §8（HTML 对齐表契约）、
[bcut-subtitle-agent-workflow.md](bcut-subtitle-agent-workflow.md) §4（对齐内部策略）、
[baocut-format-spec.md](../bcf/baocut-format-spec.md) §18.4–§18.7。
外部参考：FBK IWSLT 2026 Subtitling 系统论文（`2026.iwslt-1.7`，句级感知两阶段管线）、
Netflix Timed Text Style Guide、SimAlign / awesome-align、SubER。

## 0. 结论摘要

字幕"切分"是四个不同层的问题，今天有两处被压在同一层里：

```text
words[]                       词级文本与时间真相（不变）
   ↓
Sentence                      语义单元：翻译什么（不变，sentence.rs）
   ↓
Alignment Block   ← 新增      双语单元：哪段译文对应哪段源词（单调、可合并、不可再拆）
   ↓
Cue / Piece                   时间单元：什么时候显示（源：§18.5 + 优化器；译：transAlign.pieces）
   ↓
Line                          排版单元：一条字幕内部在哪里换行（渲染期投影，不落盘）
```

本方案做四件事，按依赖顺序：

1. **源 Cue 优化器与用户意图分离**：优化器结果从 `breaks` 挪到按 `LayoutProfile`
   键控的 `autoBreaks[profile]`；§18.5 贪心派生保持规范性不变，三端只多做一次
   "用户 pin 覆盖自动 pin"的合并。同时把 `layout.rs` 的局部成对修复升级为
   候选断点全局 DP。
2. **引入 Alignment Block 层**：`transAlign` 条目新增 `blocks[]`——由源词↔译文的
   对齐边经"单调闭包"确定性求出的最小单调对齐块。`pieces[]` 继续是展示切分，
   但每片边界必须落在块边界上；`crossing` 由 `correspondence: "block" | "sentence"`
   取代。
3. **对齐边来源与 LLM 任务瘦身**：LLM 不再同时切两列并解决交叉；它只输出
   "译文语义块 → 源词序号集合"的对齐边（融合进 translate 调用，dedicated align
   兜底），块合并、双语 DP、时间分配全部是确定性代码。语序交叉先合并，合并后
   仍超 hard 才触发一个窄任务"单调化显示改写"，写入独立的 `transDisplay`，
   不覆盖自然译句 `trans`；再不行降级整句对应，绝不伪造逐行一一对应。
4. **验收与评测**：`bcut check` 新增对齐覆盖率、交叉率、安全边界比例、句级降级率、
   改写触发率；离线评测加 SubER。

最关键的一条规则：**只允许在没有任何高置信度对齐边跨越的位置建立双语字幕边界。**

## 1. 现状复核（代码事实，作为设计前提）

以下均以当前 `main` 为准，与用户分析报告的判断逐条对照：

| 报告判断 | 代码事实 | 结论 |
| --- | --- | --- |
| Cue 派生是贪心单遍 | [`cue.rs:125`](../../../core/crates/bcut-flow-core/src/cue.rs) `derive_cues`：只看 `next` 一个词；`min_cue_display_sec` 在派生里根本没被读取 | 属实 |
| 优化交给"后续优化器"并写进 `breaks` | [`layout.rs`](../../../core/crates/bcut-flow-core/src/layout.rs) `balanced_cue_breaks` → 最小 pin 集写 `doc.breaks`；`ensure_balanced_cue_layout` **只要 `breaks` 非空就整篇跳过** | 属实，且比报告更糟：用户手动动过任一断点后，全篇不再优化 |
| 优化器是局部启发式 | `fix_pair` 对相邻两条尝试所有内部切点打分，`repartition_for_reading_time` 迭代到收敛 | 属实，非全局最优 |
| 没有 LayoutProfile | `CueParams`（源，语言无关 42 格）、`TransParams`（译，按语言 fit/soft/hard）、CPS 阈值三份常量（`layout.rs` 13/21、`split.rs::target_reading_cps`、`apps/gpui/.../subtitle_list.rs` 9/13/17/21）互不共享 | 属实 |
| Cue 内部无 1/2 行决策 | Cue = 一条 42 格逻辑行；换行是渲染期 `bcut-core::layout_captions`（字体度量）与编辑器 `subtitle-rendering.js::sourceDisplayLines`（格宽 DP）两处投影 | 属实，Line 层已天然分离，只是没有被命名 |
| `transAlign` 同时承担语义对齐、时间映射、显示切分 | `TransPiece{from,to,text}`：`from/to` 是句内源词区间，`align_entry_valid` 要求 `from == expected` 连续全覆盖——**非单调映射不可表达** | 属实 |
| 交叉靠 `data-crossing` 声明 | `align_table.rs::parse_group` 读 `data-reordered/data-crossing`（互斥）；`crossing` 落 `TransAlign.crossing`，check 只出 info 级 `align-bilingual-anchor-crossing`；`reordered` 通过 ±max(25%,4) 护栏后**回写 `trans`** | 属实；`doc.rs` 注释已把 `crossing` 标为"旧版仅读"，但 `align.rs:4262` 仍在写——文档与实现已漂移 |
| 当前先按源 Cue 逐条翻译 | 否：翻译单位已是 Sentence，源 Cue/`breaks` 不进对齐载荷 | 报告的"错误流程"BaoCut 已避免，无需改 |
| 双语渲染要求第一行对第一行 | 否：`stage.jsx:136–172` / `render_plan.rs::active_layouts` 是两条独立时间流各自折行；配对只存在于编辑器 `.tg-pair` 行 | 渲染层无需改，本方案只改配对语义与时间窗来源 |

已存在、可直接复用的部件：目标语切分 DP（`split.rs::split_independent_impl`，缝罚分 0/0.3/0.8/NO_SEAM）、缝 lint（`seam.rs::lint_pieces` / `is_objective_blocking`）、双语锚点检查（`align.rs::anchor_token_colocation` / `unique_anchor_bindings`）、时间平滑（`split.rs::smooth_trans_cue_times` / `pad_trans_cue_times`）、翻译融合通道（`data-align-*` 属性）、HTML 载体编解码（`filepipe/align_table.rs`，两条执行路径共用一个校验器）。

## 2. 目标模型与不变量

五条不变量（全部可机器判定，进 `bcut check`）：

- **I1 词真相**：`words[]` 仍是唯一文本/时间真相；Block、Cue、Line 都是派生或覆盖层。
- **I2 句级译文**：`trans[lang][sid]` 是完整自然译句；任何为字幕改写的文本不得覆盖它。
- **I3 块单调**：一句的 `blocks[]` 源侧是互不重叠、按序连续的词区间，目标侧是互不重叠、按序连续的字符区间；块之间按顺序单调推进；块内允许任意多对多与局部乱序。
- **I4 边界只落在块上**：`pieces[]` 每片 = 若干**连续**块的并；不得在块内部切开。
  `correspondence: "sentence"` 时整句只有一个块。
- **I5 用户意图分离**：`breaks` 只保存用户显式意图；优化器结果只写 `autoBreaks[profile]`。

## 3. 源字幕：LayoutProfile、autoBreaks 与全局 DP

### 3.1 `LayoutProfile`（bcut-flow-core 新模块 `layout_profile.rs`）

把三套散落阈值收成一个表驱动结构，作为优化器、对齐 DP、check 与各表面 CPS 着色的共同来源：

```rust
pub struct LayoutProfile {
    pub id: String,                       // "default" | "portrait" | "netflix-2line" …
    pub source: CueParams,                // 现有结构，maxChars 等
    pub target: fn(lang) -> TransParams,  // 现有 fit/soft/hard 表
    pub max_lines: u8,                    // 每条字幕最多几行；M1 保持 1
    pub cps: CpsBudget,                   // 按语言：warn / bad（统一 9/13/17/21 与 target_reading_cps）
    pub min_duration_sec: f64,            // 1.0（现 min_cue_display_sec）
    pub max_duration_sec: f64,            // 7.0（现 LONG_DWELL_SECONDS）
    pub lead_in_sec: f64, pub tail_sec: f64, // 0.5 / 1.0（现 SUB_TIMING）
}
```

- `default` profile 的数值 = 今天的全部常量，保证首个里程碑零行为漂移。
- transcript 顶层记 `layoutProfile`（缺省 `default`；实施时从 project.json 挪到 transcript，
  让三端只读 transcript 就能确定合并哪份 `autoBreaks`）；CLI `--layout-profile`。
- Netflix 简中 16 字/行、双行、≤7s 等只是另一份 profile 数据，不进算法。

### 3.2 `autoBreaks[profile]`：优化器输出与用户意图分离

```jsonc
"breaks":     { "g3.7": "break" },                       // 只剩用户显式意图
"autoBreaks": { "default": { "g5.2": "break", "g9.1": "nobreak" } }
```

- 消费端替换规则：§18.5 派生时以 `pins = autoBreaks[profile] ⊕ breaks`（用户键覆盖自动键）代替今天的 `breaks`。这是所有实现（Rust `derive_cues`、Swift `TranscriptProjectionAdapter.deriveCues`、`designs/baocut-mac/app/transcript-model.js`、gpui 经 `data.json`）唯一需要的改动——一次 map 合并；派生算法与契约夹具 `cueDerivations[]` 不变，只需新增"用户 pin 覆盖自动 pin"的 case。
- 优化器改为**总是运行**（不再"breaks 非空就跳过"），把用户 `breaks` 与 `paraBreaks` 视为硬边界。
- 迁移：现有项目的 `breaks` 全部视为用户意图（无法区分来源，宁可保守）；只有当 `stages.asrLayout` 指纹显示无人工版式干预时，升级器可把整表迁入 `autoBreaks.default`。
- `patchTranscript` 增加 `autoBreaks` 顶层稀疏表；`stages.asrLayout` 指纹只算 `breaks`（用户版式意图）。指纹由 `bcut_flow_core::layout::layout_fingerprint` 统一产出。

### 3.3 候选断点全局 DP（替换 `repartition_for_reading_time`）

保留 §18.5 六条规则作为**候选生成器**与最终重放器，优化器不再逐对修补而是整体选择：

```text
硬边界（必断）：用户 break、说话人切换、paraBreaks、章节、（M3 起）timeline cut
禁止边界：用户 nobreak、锁定术语内、数字与单位间、Latin 词内、
          冠词/助动词/否定词与其后成分之间（seam.rs 已有客观语病判据，源语侧补英文规则）
软候选：句末标点 0 < 从句标点 0.3 < 停顿 ≥ pauseSec 0.5 < 普通词间 0.8   （沿用 split.rs 罚分标尺）

dp[j] = min over i<j, [i..j) 合法 of dp[i] + cueCost(words[i..j))
cueCost = 行宽超限重罚（英文短从句可用尾标点余量，见下文）
        + 阅读速度罚（cps 超 warn 线性、超 bad 平方；时窗用 lead_in/tail 借静音口径）
        + 时长过短（< min_duration）/ 过长（> max_duration）罚
        + 接缝罚（上表）
        + 孤立短尾罚（末段 < minClauseChars 且前段不满）
        + 两段长度失衡罚
```

- 输出仍是**最小 pin 集**：与 `auto_break` 重放不一致处才写 `autoBreaks[profile]`（沿用 `balanced_cue_breaks` 的 diff 逻辑）。因此三端不需要 DP，只需重放。
- 英文（`en` / `en-*`）源 Cue 先通过 `source_boundary::english_cue_boundary_issue` 排除已识别的悬挂功能词、修饰语、否定/助动词、固定词组内部边界，再在剩余候选间优化宽度和 CPS。此函数复用翻译对齐原有的源边界判断并叠加 Cue 规则；对齐调用仍使用原判据，本地 Agent 与 Cloud 的 polish/segment 写回共用同一个布局入口。
- 有足够正文和时长、且后接新从句的英文从句标点是保护边界，优化器不得仅为平衡宽度或 CPS 写 `nobreak` 压住它。短填充语、枚举逗号仍由普通布局处理，用户显式 `break` / `nobreak` 保持优先。
- 英文短从句不足以容纳两条最短展示时长时，可使用现有 `overflowSlack` 收入尾标点，避免将 `I think that's very dangerous for the world.` 拆出闪现的 `I think`。不可拆词组本身超出预算时保留完整单位，由宽度检查暴露问题，不退回非法切点。
- 英文判断是有界词窗上的保守规则，不声称覆盖任意英文句法或所有专名；其他语言的候选与评分不变。已有项目的自动断点在下次运行布局写路径时重新计算，读项目与回放不隐式改写。截图回归夹具为 `core/fixtures/align/source-cue-boundaries.json`。
- 复杂度 O(n·W)（W = 单条最大词数），逐句/逐段独立求解。
- `apps/mac` 的 Swift 镜像 `applyBalancedCues` 删除：优化只在 CLI 后端跑（mac-port 设计 §4.2 本就要求）。

### 3.4 Line 层：命名但不新增落盘

`max_lines = 1` 时与今天完全一致。`max_lines = 2` 的 profile（M4）在 Cue DP 内部再跑一次行内换行 DP（复用 `subtitle-rendering.js::sourceDisplayLines` 的均衡+边界罚分口径，移植为 Rust `line_break_plan`），只用于给 `cueCost` 打"两行失衡"分；换行位置仍由渲染期投影决定，不落盘。这样"Cue 边界（新时间事件）"与"Line 边界（同一事件内视觉换行）"是两个结果、两个来源，且不会互相污染。

## 4. 双语字幕：Alignment Block

### 4.1 流程

```text
Sentence → trans（完整自然译句，已有）
        → 对齐边 edges：源词序号 ↔ 译文字符区间           §4.2
        → 安全边界判定 + 最小单调对齐块 blocks             §4.3
        → 双语 DP：块 → pieces（每片 = 连续块的并）        §4.4
        → 决策树：合并 / 单调化改写 / 整句对应             §4.5
        → 时间分配、缝 lint、写回 transAlign               §4.6
```

### 4.2 对齐边来源：`WordAligner` 抽象

```rust
pub struct AlignEdge { pub src: usize /* 句内词序 */, pub tgt: Range<usize> /* 规范化 trans 字符区间 */, pub weight: f32, pub hard: bool }
pub trait WordAligner { fn align(&self, src_words: &[&str], tgt: &str, ctx: &AlignCtx) -> Vec<AlignEdge>; }
```

两个实现按置信度叠加，硬边优先（**没有本地对齐器**：曾预留的 `ModelAligner` 槽位由本地评分器填过，2026-08-18 已随本地文本模型功能整体移除，历史设计见[语义评分器方案](../../archive/subtitle/bcut-semantic-reranker-alignment-design.md)（**已归档**））：

| 实现 | 边的类型 | 成本 | 状态 |
| --- | --- | --- | --- |
| `AnchorAligner`（确定性） | 数字、日期、URL、原样 Latin 片段、brief 锁定术语、人名 → `hard` | 0 | 复用 `unique_anchor_bindings` / `anchor_token_colocation` 的匹配逻辑，改成产出边 |
| `LlmChunkAligner`（默认） | LLM 输出"译文语义块 → 源词序号集合"，程序展开成边，`weight` 由块大小与是否被锚点佐证决定 | 融合进 translate 调用；失败时 dedicated `align-edges` 调用 | 新增，见 §6 |

LLM 块级对齐比词级更稳：模型不需要给出 token 下标，只需把译文切成尽量小的语义块并列出每块对应的源词序号（可不连续、可乱序、可为空）。协议约束：源词序号每个最多归属一块（可不归属）；译文块按字符区间**恰好**划分整句。这是一个二部划分而不是任意二部图，校验简单，且天然表达"一对多 / 多对一 / 省译"。

### 4.3 安全边界与最小单调块（确定性核心）

设译文候选切点在字符位 k（只取目标语合法缝：标点、空白、非客观语病的 CJK 字界，复用 `seam.rs`）：

```text
leftMax(k)  = max{ e.src | e.tgt.end ≤ k }        切点左侧译文对齐到的最大源词序
rightMin(k) = min{ e.src | e.tgt.start ≥ k }      切点右侧译文对齐到的最小源词序
k 是安全边界  ⇔  leftMax(k) < rightMin(k)
```

- 只统计 `hard` 边与 `weight ≥ τ` 的软边（τ 可配，默认 0.5）；低置信度软边不参与判定，避免一条误判把整句合并成一块。
- 对每个安全边界，源侧断点在 `(leftMax, rightMin]` 区间内选：优先句末/从句标点、停顿、句法缝，其次靠近理想长度比例——这就是"目标片冻结后再映射连续源词区间"的现行两阶段纪律，只是判定从模型自觉改为代码保证。
- 相邻两个安全边界之间就是一个**最小单调对齐块**：源侧 `[srcFrom, srcTo]`、目标侧 `[tgtFrom, tgtTo)`。未被任何边覆盖的源词（冠词、省译）并入前一块（句首并入后一块）。
- 语序交叉的区域自动落进同一块（`I didn't go / because I was sick` ↔ `因为我病了，所以没去` 整句一块；`the plan we discussed yesterday` ↔ `我们昨天讨论的计划` 名词短语一块而句子其余部分仍可切）——这是对报告 §五"局部交叉不必合并整句"的直接实现。
- 块的 `confidence` = 支撑该块两侧边界的边权最小值；`flags`：`local-reorder`（块内存在交叉边）、`anchor`（含硬锚）、`weak`（仅软边）。

### 4.4 双语 DP：块 → pieces

以块为原子，`pieces` = 连续块的并；一片同时受两种语言约束：

```text
dp[j] = min over i<j of dp[i] + pairCost(blocks[i..j))
pairCost = targetLayoutCost（超 fit 阶梯、超 hard 无穷、贴近 soft；沿用 split.rs 罚分与 TransParams）
         + sourceLayoutCost（源区间宽度 > 单行预算或时窗 > 4s/6s：沿用 source_ceiling 判据）
         + sharedDurationCost（时窗 < 目标语 target_required_seconds ⇒ 罚；> max_duration ⇒ 罚）
         + targetSeamPenalty + sourceSeamPenalty（seam.rs 客观语病 = 无穷；悬垂连词/「的」尾等阶梯）
         + blockMergePenalty（合并多个块时轻罚，鼓励细粒度对照）
         + lowConfidencePenalty（在 weak 边界上切开加罚）
硬约束：不切块内部；不切锁定术语；不跨说话人/paraBreak/timeline cut；两侧都不超绝对上限；目标 CPS ≤ hard
```

三条量级裁决（2026-08-18，来自 9 分钟真跑 s-g40.34 / s-g7.0 / s-g38.25 的复盘）：

- `targetLayoutCost` 的超 fit 阶梯按超出幅度**二次递增**——刚过 fit 付 `OVER_FIT_PENALTY`
  （灰带低端不改既有取舍），顶到 hard 付三倍。平罚时「整行卡在 hard 上」（1.5）永远
  轻于源侧一个悬垂系词的坏缝（`BLOCKING_SEAM_PENALTY` + 0.8），DP 便宁可保留一条
  20 单位的整行；而 check 的 `align-paired-density` 恰恰要求在那个译文缝上切开，
  refine 重跑只会得到同一组块、白费一轮调用。hard 是天花板不是目标。
- `sourceSeamPenalty` 里从句标点封住的缝是合法缝：`Generally speaking, though, | the …`
  的 `though` 虽在前附词元表里，逗号已把插入语收口，行尾停在这里没有悬垂；只有
  未封口的词元才按前附判非法。
- `targetSeamPenalty` 里的顿号与 `seam::lint_pieces` 同口径：并列项被拆开、左右两片
  合并后仍 ≤ hard 时顿号不是缝（按 `BLOCKING_SEAM_PENALTY` 计）。候选缝表按
  「左片 | 整个余下部分」计价，余下部分几乎总是超 hard，顿号因此总显得便宜；DP 在
  `pairCost` 里知道右片的真实宽度，左片取 dp 已为块 i 选定的前驱片，两者之和 ≤ hard
  就按阻塞缝计——否则 check 会把这一刀报成 `align-target-seam`，refine 白跑一轮。

因为块已经保证语义单调，DP 输出的每一片自然满足"这行中文确实翻译这行英文"，`degenerate_paired_row` / `paired_density` / `bilingual_anchor` 这些今天用来事后拒收的检查变成 DP 的代价项或按构造成立。

### 4.5 决策树

```text
blocks 求出
 ├─ 所有块 ≤ hard 且 DP 有解            → correspondence: "block"，落 pieces
 ├─ 存在局部交叉块，但合并后仍 ≤ hard    → 同上（只是片更长）
 ├─ 某块 > hard（合并后放不下）          → 触发「单调化显示改写」窄任务（§6.3）
 │       改写通过 → 写 transDisplay，重新对齐（edges→blocks→DP）
 │       改写被拒 / 幅度超护栏           ↓
 └─ 仍无解 或 整句块 confidence < τ_s    → correspondence: "sentence"：整句一块，
        源按词时间逐词高亮，译文整句静态显示，明确标记，不伪造逐块对应
```

与现行的差异：现在是"先让模型 reorder 改写，改写不自然才 crossing"；本方案是**先合并（零改写、零调用）**，合并后确实超硬上限才改写，改写也不行才整句对应。改写触发率会显著低于今天的 `reordered` 率。

**2026-09-24 修订（crossing best-effort 与降级不超 hard）**：

- 模型自报 `data-crossing="true"` 不再把整句降级为 `correspondence: "sentence"`。worker 已按契约「在目标语自然缝上切、源侧取 best-effort 单调切点」给出行，引擎保留这些行与源切点（`correspondence` 仍是 `block`），只在 violations 记一条 `declared word-order crossing … row-level correspondence is approximate`。原因：整句降级在 paired 收尾轮里等于交回 1 片，必然被拒，而旧条目又已因译文变化失效，最终显示成超 `hard` 的整句单 cue（s-g9.0 第 3 轮：28 字一行，`align-stale` + `translation-overflow`）。
- 上图最后一支「整句对应」若译文整句超 `hard`，不得产出单行：先在 `seam::preferred_target_split` 给出的确定性目标缝上切两片（两片都 ≤ `hard` 才采用），否则走按源词时长比例的确定性兜底切分；记 fallback（`aligner: deterministic/1`），violation 追加 `cut at a deterministic target seam`。展示投影 `derive_trans_cues` 在**完全没有条目**时的整句 fallback cue 不属于对齐降级路径，不受此条约束（仍由 `align-stale` / `translation-overflow` 报出）。

### 4.6 时间与写回

- 每片 `at = 块内最早源词 t0`，`until = 块内最晚源词 t1`；随后沿用 `smooth_trans_cue_times` / `pad_trans_cue_times`：只借相邻字幕之间真实存在的静音或媒体尾部空白补足 `min_duration`，绝不覆盖下一条。
- `correspondence: "sentence"` 的时间窗 = 整句词时窗，译文单片。
- 写回顺序仍是 `trans`（不动）→ `transDisplay`（若有）→ `transAlign`。

## 5. 数据结构变更（transcript `0.4`，0.3 可读）

```jsonc
{
  "bcutTranscript": "0.4",
  "breaks":     { "g3.7": "break" },
  "autoBreaks": { "default": { "g5.2": "break" } },
  "trans":        { "zh": { "s-g1.0": "因为我病了，所以没去。" } },
  "transSrc":     { "zh": { "s-g1.0": "8:g1.0:g1.7:ab12cd34" } },
  "transDisplay": { "zh": { "s-g1.0": {                       // 仅在触发单调化改写时存在
      "text": "我没去，因为我病了。",
      "basis": "monotonic-rewrite",
      "transFingerprint": "…"                                  // 对应 trans 文本指纹，不符 ⇒ display-stale
  } } },
  "transAlign": { "zh": { "s-g1.0": {
      "mode": "manyToOne",
      "words": ["g1.0", "…", "g1.7"],
      "correspondence": "block",                                // block | sentence
      "textBasis": "display",                                   // trans | display：pieces 拼接等于哪份文本
      "aligner": "llm-chunk+anchor/1",
      "blocks": [
        { "src": [0, 2], "tgt": [0, 4],  "confidence": 0.9, "flags": [] },
        { "src": [3, 7], "tgt": [4, 10], "confidence": 0.8, "flags": ["local-reorder"] }
      ],
      "pieces": [
        { "from": 0, "to": 2, "text": "我没去，" },
        { "from": 3, "to": 7, "text": "因为我病了。" }
      ]
  } } }
}
```

不变量与失效语义（在 v0.3 §4 之上增补）：

- 拼接不变量改为 `normalize(concat(pieces.text)) == normalize(textBasis == "display" ? transDisplay.text : trans)`。
- `blocks` 满足 I3；`pieces` 满足 I4（每片 `from/to` 与 `text` 区间都是若干连续块的并）。违反 ⇒ `align-stale`，降级整句上屏（现行语义）。
- `transDisplay.transFingerprint` 与当前 `trans` 不符 ⇒ `display-stale`：删除 `transDisplay` 与该句 `transAlign`，回到自然译句整句上屏。
- `crossing: true` 的旧条目读入时映射为 `correspondence: "sentence"`（保留 pieces 时间，不再宣称逐片对应）；`oneToOne`/`cues` 处理不变。
- `independent` 模式不含 `blocks`（无对齐主张），`correspondence` 缺省 `"sentence"`。
- 对齐边（`edges`）不进 transcript：作为可重算 AI 工件写 `ai/align/<lang>/vNNN/edges/<sid>.json`，供审阅与重跑。
- 编辑语义（v0.3 §8 表）增补：改译文行文本 → 写对应 `textBasis` 文本并保持拼接不变量，块的目标字符区间按前缀差量平移；移动行边界 → 只允许吸附到块边界，跨块拖动等于块合并/拆分并即时重跑 DP；改整句译文 → 删 `transDisplay` + `transAlign`（现行）。
- `patchTranscript` 新增 `autoBreaks`、`transDisplay` 顶层表与 `transAlign` 内 `blocks/correspondence/textBasis` 字段。

## 6. LLM 契约变更（本地 Agent 与 Cloud Model 同步）

### 6.1 融合翻译：`data-align-*` 从"两列表格"改为"块对齐边"

现行融合应答是 `data-align-target="片1 | 片2"` + `data-align-breaks='["b7"]'`（模型同时决定译文切点与源切点）。改为模型只标注语义块与源词归属，例如：

```html
<p data-sid="s-g1.0" data-align-words="1:the 2:plan 3:we 4:discussed 5:yesterday …">
  <span data-src="3 4 5">我们昨天讨论的</span><span data-src="1 2">计划</span>…
</p>
```

- 正文文本仍是完整自然译句（`<span>` 只是包裹，剥离后逐字等于 `<p>` 正文；解析失败只丢草稿不拒译文——沿用现行原则）。
- `data-src` 为源词序号集合，可乱序、可空；每个序号最多出现一次。
- 契约同时保留"顺句驱动"偏好（同样自然时贴近源语小句顺序），从源头减少交叉。
- 融合失败或未启用融合的句走 dedicated `align-edges/1` 载体（同一微格式，独立请求），替代现行 `align-table/1` 作为**默认**对齐载体。
- **融合草稿是可选通道**（`bcut translate --align-fusion rows|on|off`，默认 `rows`）：`off` 时提示不带 `data-align-*`、不挂融合契约段，回到纯译文契约（更短、约束更少）；解析侧不变，回答里即使仍带 `<span data-src>` 也只当译文文本，不拒页。

**`rows` 模式（默认）**：契约不再要模型标语义块，而是要求它把整句译文直接按源词顺序切成**显示行**——`<span data-src="a-b">` 的 `a-b` 是唯一一段连续递增区间，相邻行首尾相接、合起来恰好覆盖 `1..N`。载体额外携带 `data-align-groups`（`firstOrdinal-lastOrdinal@startSec-endSec`，分号分隔、序号 1-based 闭区间、秒数相对句首取一位小数），是确定性算出的源侧分组提示：种子取源字幕 Cue 的行首词，再按从句标点/静音 ≥ 0.35s 补切、小组并邻、大组（> 5s 或 > 14 词）在最大内部停顿处再切。行必须是一个组或若干相邻组的并，不能切在组内部；每行 ≤ `fit`、绝不超 `hard`，读速 ≤ 6 单位/秒。

行分区落库走独立入口 `align_block::plan_sentence_rows`（§4.3 的最小单调块改为**按行分组**：候选切点集合并入各行起点，`minimal_monotonic_blocks` 求出的块起点必须恰好命中每个行起点，否则说明行边界被锚点横跨、整句返回 `None`；行内超 `hard` 才在该行的块子序列上单独跑 §4.4 的双语 DP，绝不跨行合并，行内无解同样整句 `None`）。成功时块与显示行一一对应，`aligner` 写新标签 `llm-rows+anchor/1`、`correspondence` 仍是 `Block`，I3/I4 块层不变量不变——块粒度从"语义块"变粗成"显示行"而已。任何一步不成立就静默回落到 `on` 模式的常规块合并路径，坏草稿不拒译文；行边界没能落在 `data-align-groups` 组边界上（`on_groups=false`）不算失败，只计入 `--json` 的 `alignFusionRowsOffGroup` 观测分组命中率。`data-align-groups` 只是提示属性，不落盘进 transcript。

按行分组之后、`plan_entry` 之前有一道**确定性短行合并**（`merge_short_rows`）：模型实测基本按源侧分组一对一切行（每句均行数明显多于常规融合），契约里"偏向合并"的措辞对其无效，因此改由引擎收口。判据对同句相邻两片，任一片"太快"（读速 > 6 单位/秒）或"太小"（时长 < 1.0s 或宽度 < 6 单位）即触发，但**合并守卫分级**：由"太快"触发的合并允许合并后宽度到 `hard`（zh 20）——读速没有更便宜的补救手段，只能靠拉长时窗；只由"太小"触发的仍守 `fit`（zh 16）。两级都还要求合并后时长 ≤ 7s。这是有意的"宽度换读速"取舍，与 §4.4 双语 DP 的口径一致（`pairCost` 里超 fit 只是罚分阶梯、只有超 hard 才是硬约束）——第四轮对拍里 rows 的 overFit 已压到 1–2%，cps>6 仍有 12–13%（`on` 中位 7.9%），让宽度给读速正是缺的那一步。两侧都能合时取合并后读速更低的一侧（平局取左，保证确定性）；迭代到没有合法合并为止。**只合并片（`groups`），不动 `blocks`**——块仍逐行记录模型给出的源词↔译文对应，下游双语高亮不因合并变粗；被行内 DP 因超 `hard` 切出的碎片不会被这一步粘回去（两级守卫都 ≤ `hard`，那些碎片正是因为合起来超 `hard` 才被切开的）。合并掉的行数计入 `AlignOutcome.rows_merged`（`--json` 为 `rowsMerged`），不落盘进 transcript。

**整页缺行的软重发**：一页里请求了行（`data-align-groups` 非空）的句子 ≥3 且其中拿到合格行分区的不足 30% 时，判定整页放弃了行标注（模型偶尔交回结构完整、只留 `id` 的答案却一个 `<span data-src>` 都不给），引擎原样重发该页一次（同一份 system/user，`retry_reason` 换成强调"上一次一个 display row 都没有"的版本）。这是软重试：不占用页级错误重试预算、不拒页，每页最多 1 次；第二次仍缺行或传输失败就保留第一次结果，第二次可用则译文与行草稿都以第二次为准。provider/agent 同一份判据；`routed`（最终时间线）翻译不适用。次数计入 `--json` 的 `rowsPageRetries`。

### 6.2 `align-table/1` 降级为审阅与修复载体

现行 HTML 双列表继续保留：给人类/Agent 看低置信度块（`weak`、`local-reorder`、`sentence` 降级）以及 `refine-align` 定向修复。表格行改为按块渲染，附 `data-block-confidence`；`data-reordered/data-crossing` 从可写属性移除。

### 6.3 新窄任务：`align-rewrite/1`（单调化显示改写）

只在 §4.5 第三分支触发。输入：源句（带词序号）、自然译句、超限块及其源区间、`TransParams`、锁定术语；输出：**一个**新的目标语句子。契约一句话：

> 在不丢失任何事实、否定、数字、专名和锁定术语的前提下，把这句译文改写成尽量接近源语义顺序、并使每个对齐块都能放进 hard 预算的字幕译文。只输出改写后的整句。

验收：现行 ±max(25%, 4 单位) 幅度护栏、锁定术语与数字锚点必须全部保留、逐片 AutoCorrect；通过后写 `transDisplay`，然后**重新跑对齐边与块**（不信任模型自报的单调性）。

### 6.4 同步义务

`filepipe/align_table.rs` 旁新增 `filepipe/align_edges.rs`（渲染/解析/反解析三件套 + 往返测试），`engines/align.rs` 的 `accept_answers` 前置一层 `edges → blocks → DP`；`core/crates/bcut-kernel/src/cmd/task.rs` 的提交期 lint 与引擎共用同一个字符串级校验器（沿用 `file_contract_lint_and_engine_share_one_string_level_checker` 的一校验器原则）；`skills/baocut/references/agent-tasks.md` 的对齐载体表、错误码表同步；`ai/state`、`ai/align/<lang>/vNNN` 工件加 `edges/`。

## 7. 消费端与多表面同步

`--align-fusion rows` 只改变 §6.1 里 blocks 怎么算出来（块粒度从语义块变粗成显示
行），不引入新字段、不改变 `blocks[]` / `pieces[]` / `correspondence` 的形状；下表
各消费端读到的仍是同一套 `TransAlign`，无需为 rows 模式单独适配——`aligner` 字段
里的 `llm-rows+anchor/1` 只是诊断信息，不参与消费端渲染决策。

| 表面 | 影响 | 处理 |
| --- | --- | --- |
| CLI `data.json` / JSON 导出 | `sentences[].trans[lang]` 增 `correspondence`、`textBasis`、`blocks[]`；`crossing` 保留一版兼容并标弃用 | `studio.rs::derive_project_rows`、`media.rs::build_json_export_payload` |
| Web Studio `skills/baocut/templates/studio` | `SentenceCard` 的 `语序交叉` 芯片改为 `整句对应`；配对行 `.tg-pair` 之间显示块刻度与 `weak` 标记；行边界拖动吸附块边界；画布 lanes 不变 | `panes.jsx`、`store.jsx`、`subtitle-rendering.js` |
| `apps/mac` | `TransSentenceCardView` / `TranslateCardOriginalLineView` 同步芯片与块刻度；`deriveCues` 合并 `autoBreaks`；删除 Swift `applyBalancedCues` 镜像 | 见 §3.2、§3.3 |
| `designs/baocut-mac` 原型 | `transcript-model.js` 合并 `autoBreaks`（`optimizeBreaks` 保留为原型内参考但不再作为生产对拍源）；`translate-model.js` 同步 | 使用 baoyu-design 工作流 |
| `apps/gpui` | 只经 `data.json` 消费 Cue；`TransCue` 结构加字段；尚无双语配对面板 → 配对 UI 不适用 | `projection/doc.rs` |
| `apps/windows` | 未实现翻译对齐功能 → 不适用 | — |
| 导出（SRT/VTT/ASS/MP4） | 目标语单语导出取 `textBasis` 文本；双语并集分段逻辑不变 | `derive_trans_cues` |
| `bcut check` | 新 lint 见 §8；`align-bilingual-anchor-crossing` 退役 | `ai/check.rs` |

CLI/serve 参考文档同步项：`--layout-profile`、`autoBreaks`/`transDisplay` patch 键、`bcut spec` 的 `align` 阶段 `writes` 增 `transcript.transDisplay`、`transcript.autoBreaks`（写在 `align`/`polish`/`segment` 各自条目）。

## 8. 验收指标与评测

`bcut check` 与 `alignDiag` 新增（按语言汇总 + 逐句明细）：

| 指标 | 定义 |
| --- | --- |
| `align-coverage` | 被 ≥1 条 hard/软边覆盖的源词占比、译文字符占比 |
| `align-crossing-rate` | 含 `local-reorder` 块的句占比；块内交叉边对数 / 总边数 |
| `align-safe-boundary-ratio` | 目标语合法缝中安全边界的占比 |
| `align-sentence-degrade-rate` | `correspondence: "sentence"` 句占比（区分：低置信 / 超硬无解 / independent） |
| `align-rewrite-rate` | 触发 `align-rewrite` 的句占比及通过率 |
| `align-manual-edit-rate` | 用户改动过块边界/行边界的句占比（由 apply 记账） |
| 现有 | CPS/CPL/fit/soft/hard、seam defect、`align-overfit` 等保持 |

离线评测：`core/fixtures/align/` 建立含人工确认双语字幕的 golden 集（先从 `examples/` 三个项目各取一段），实现 SubER（TER 变体，同时惩罚文本、分段与时间偏移）作为回归指标，与 `align-*` 结构指标一起进 `verify.sh` 的可选步骤。目标：与现行 many-to-one 相比，在相同 LLM 与相同 fixture 上 SubER 不劣化、`sentence-degrade` 与 `rewrite-rate` 均低于现行 `crossing + reordered` 之和、`bilingual-anchor` 错配为 0（按构造）。

## 9. 实施里程碑

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| **M0 规范** | 本方案定稿；format-spec §18.4/§18.5/§18.7 增补 `autoBreaks`/`transDisplay`/`blocks`/`correspondence`；v0.3 设计文档标注被取代条款 | 文档评审 |
| **M1 LayoutProfile + autoBreaks + 源 DP** | `layout_profile.rs`；`autoBreaks` 表与 patch；`layout.rs` 全局 DP 替换 `repartition_for_reading_time`；三端合并规则 + 契约夹具新增 case；升级器迁移策略 | `cargo test -p bcut-flow-core`；`cueDerivations` 夹具三端通过；`default` profile 下现有 fixture 输出零漂移或差异逐条解释 |
| **M2 Block 核心（纯函数）** | `align_block.rs`：`AlignEdge`、安全边界、最小单调块、双语 DP；`TransAlign` 新字段与校验；`crossing` 兼容映射；`derive_trans_cues` 消费 `textBasis` | 表驱动测试覆盖报告中的全部例句（因果倒装、定语从句、局部交叉、省译、数字锚） |
| **M3 LLM 契约** | `align_edges.rs` 载体 + 融合翻译改协议 + `align-rewrite/1`；`AnchorAligner`/`LlmChunkAligner`；两条执行路径与提交期 lint 同步；agent-tasks 文档；`align-table/1` 降为审阅载体 | 共享回归夹具；translate→align 端到端测试；`fused draft` 零调用路径仍通过 |
| **M4 消费端** | studio / mac / gpui / designs 同步；导出；check 新 lint 与指标；`--layout-profile`；两行 profile 的 `line_break_plan` | 各表面测试或视觉验证；serve 契约测试 |
| **M5 评测与可选对齐器** | golden 集 + SubER；`ModelAligner` 可行性（模型体积、MLX/Candle 推理时延、与 LLM 块对齐的一致率） | 评测报告；决定是否默认启用 |

M1 与 M2 互不依赖，可并行；M3 依赖 M2；M4 依赖 M1+M3。

## 10. 风险与待决策项

风险：

- **LLM 块对齐质量**：省译、意译处模型可能给空归属或错归属。缓解：硬锚点校验（数字/术语必须同块）、低权重边不参与安全边界判定、`sentence` 降级出口、审阅表暴露 `weak` 块。
- **回归面大**：`align.rs` 近 9k 行、验收判据密集。缓解：M2 先以纯函数落地并用现有判据做交叉验证（DP 结果必须通过今天全部 blocker 级检查），M3 再切换默认路径并保留 `--align-carrier table` 一版回退开关。
- **`transDisplay` 增加"哪份文本"的心智负担**。缓解：只在改写触发时存在；UI 默认显示字幕用文本并标注"已为字幕改写"，句卡可展开自然译句。
- **profile 切换成本**：切 profile 需重跑源 DP 与双语 DP，均为确定性、零 LLM。

待你决策（默认建议加粗）：

- **D1** `autoBreaks` 是否按 profile 键控：**是**（否则竖屏/双行 profile 又要覆盖同一张表）。
- **D2** 对齐边默认来源：**LLM 块级对齐融合进 translate**（零新增模型）vs. 本地 SimAlign 模型优先。
- **D3** 改写文本落 `transDisplay` 独立表 vs. 沿现行回写 `trans` 并加 provenance：**独立表**（I2 不变量、可审计"译文为何如此"）。
- **D4** `align-table/1` 是否彻底下线：**保留为审阅/修复载体**，不再作为默认对齐协议。
- **D5** 版本号：**升 `0.4`，0.3 只读兼容**（`crossing` 语义变化不宜静默）。
- **D6** 两行 profile（`max_lines = 2`）是否进本轮：**进 M4 但默认 profile 仍单行**。

## 11. 论文与外部方案对照

- **FBK IWSLT 2026（`2026.iwslt-1.7`）**：两阶段——先 VAD+Whisper 出时间对齐字幕并逐条字幕翻译（contrastive-1），再聚合长音频用 Voxtral 转录、按强标点切句、句级 MADLAD 翻译，最后用 mweralign（Levenshtein 重分段）把句级译文塞回第一阶段的 SRT 时间模板。结论是"句级重审分段"是主要增益来源，en-de/es 上翻译质量与 SubER 同时改善。可取：句级翻译单位（BaoCut 已如此）；SubER 作为兼顾文本/分段/时间的评测；CPS/CPL 阈值按语言（zh 9 cps/16 字，ja 4 cps/13 字，其他 21 cps/42 字）作为 profile 数据。**不可取**：把译文按**源字幕时间模板**重分段——论文 Table 5 的 primary 输出 `Die Erwartungen in Bezug auf / die Kürzungen der Fed haben sich sehr verfestigt.` 正是切在介词后的模板驱动切点；对 zh/ja 这类语序差异大的目标语，模板重分段就是本方案要用对齐块取代的东西。他们的读速修复也只是"延长结束时间到下一条开始"，弱于 BaoCut 借真实静音的做法。
- **Netflix TTSG**：语法单元优先、两行、简中 16 字/行、单条 ≤ 7s——进 `LayoutProfile`，不进算法。
- **SimAlign / awesome-align**：无监督/微调的多语言词对齐；对应 `ModelAligner`，作为 LLM 块对齐之外的第二来源与一致性校验。
- **短语翻译的对齐一致性约束（Koehn et al. 2003）**：短语对不得与词对齐矛盾——`leftMax < rightMin` 就是把它改造成字幕边界判据。
- **AppTek 字幕压缩（IWSLT 2025）**：把受长度约束的译文改写当作独立环节——对应 `align-rewrite/1` 与 `transDisplay` 的分离。
- **SubER（IWSLT 2022）**：同时考虑文本、分段与时间的编辑率——M5 评测基线。

## 12. 实施记录

- 2026-08-16 数据模型（commit `0261dc1`）：`bcutTranscript` 升 `0.4`，`0.3` 只读兼容
  （`SUPPORTED_TRANSCRIPT_VERSIONS`，`from_json` 读入即升版本号）；`TranscriptDoc`
  新增 `autoBreaks` / `layoutProfile` / `transDisplay` 与 `effective_breaks(profile)`；
  `TransAlign` 新增 `correspondence` / `textBasis` / `aligner` / `blocks` 及
  `TransAlign::new` / `correspondence()`（旧 `crossing:true` ⇒ `sentence`）；
  `bcut upgrade` 把 0.3 版本号写成 0.4。
- 2026-08-16 M1（commit `9e3c810`）：`layout_profile.rs`（`LayoutProfile::default_profile()` 等于旧常量，
  `CpsBudget{warn,bad,reading}` 统一三处 CPS 阈值）；`derive_cues` 读 `effective_breaks`；`layout.rs`
  候选断点全局 DP 替换 `repartition_for_reading_time`，最小 pin 集只写 `autoBreaks[profile]`，
  优化器总是运行；Swift/JS 三端合并 `autoBreaks ⊕ breaks`，删除 Swift `applyBalancedCues` 镜像；
  契约夹具 `cueDerivations[]` 新增两例；`bcut upgrade` 在 `stages.asrLayout` 未变时把旧 `breaks`
  迁入 `autoBreaks.default`；`patchTranscript` 支持 `autoBreaks`/`layoutProfile`。
  已知偏差：宽度 > `maxChars` 在 DP 中按禁止处理，贪心的"延长一词收标点"行会被重切。
- 2026-08-16 M2（同一 commit）：`align_block.rs`（`AlignEdge`/`AnchorAligner`/`safe_boundaries`/
  `minimal_monotonic_blocks`/`bilingual_dp`/`plan_sentence`）；`split.rs` 的 `basis_text`、I3/I4
  块校验、显式 `sentence` 对应派生单条 cue、`display-stale` 清理。实现细节偏差：安全边界另加
  "边不得横跨切点"规则；块置信度取边界与块内边权最小值；`plan_sentence` 先判 τ_s 再判超 hard。
- 2026-08-16 M5 指标（commit `a0bf2b9`）：`metrics.rs` SubER（对拍 AppTek 参考实现 102 例，
  ja/ko 逐字切为已知偏差）与 `align_metrics`；golden 集与 `ModelAligner` 评估待后续。
- 2026-08-16 M3 LLM 契约：新增缺省对齐载体 `filepipe/align_edges.rs`
  （`align-edges/1` 渲染/解析/反解析三件套 + 往返与 property 测试；模型只标注
  `<span data-src>` 语义块 → 源词序号，新增闭集码 `align-edge-ordinal` /
  `align-edge-text`）与窄任务 `align-rewrite/1`（同形表 + `data-over-hard`，改写 +
  span 一次给出，±max(25%,4) 与硬锚保留在同一解析器里校验）；translate 融合协议改为
  `data-align-words="[1]…"` + `data-align-needed` 与 `<p>` 内 span 块标注
  （`FusionDraft { chunks }`）；`engines/align.rs::run_align_with_projection` 按
  `AlignOptions.carrier`（`AlignCarrier::Edges` 缺省 / `Table` 审阅）分流：融合草稿 →
  dedicated `align-edges`（首轮 `b…` + 一次全局修复 `r…`）→ `align-rewrite` 轮（`w…`，
  通过写 `transDisplay{basis:"monotonic-rewrite"}` + `text_basis: display`，否则整句
  对应）→ 纯 `AnchorAligner` 块对齐 → 确定性兜底；`purge_stale_display` 前置、
  `align_entry_valid_for_lang` 判既有条目；表格载体 `data-crossing` 改落
  `correspondence: sentence`（整句一块一片，不再写 `crossing`；2026-09-24 起改为保留 worker 行 best-effort，见 §4.5 修订）、`data-reordered` 改写
  改落 `transDisplay{basis:"table-reorder"}` 不再覆盖 `trans`；`AlignOutcome` 新增
  `rewritten_sentences` / `sentence_level_sentences`；CLI 注册 kind `align-edges` /
  `align-rewrite`（HTML 载体、`<tbody data-sid>` 计数、high effort）、`task submit` 按
  kind 路由到 `lint_agent_answer_edges` / `lint_agent_answer_rewrite`、
  `bcut spec` 的 `align` 阶段 `writes` 加 `transcript.transDisplay` 与 `carriers`、
  `translate` / `refine-align` 增 `--align-carrier edges|table`、`bcut check` 的
  `align-bilingual-anchor-crossing` 改读 `correspondence() == sentence`；同步
  `agent-tasks.md`、ai-pipeline §8.6/§9.2、file-contract §8.5、agent-workflow §4.1、
  CLI 参考。
- 2026-08-16 M4（commit `4913746` + 本次）：data.json/JSON 导出携带 `correspondence`/`textBasis`/
  `displayText`/`aligner`/`blocks`（`crossing` 派生并弃用）；studio/mac/designs 同步"整句对应"
  "已为字幕改写"芯片、块刻度、拆分吸附块边界；apply/patch 维护块层与 `transDisplay`；gpui 投影
  加字段（无双语面板，UI 不适用；`apps/windows` 无翻译功能，不适用）。`bcut check` 输出
  `alignMetrics[lang]` 与 `align-sentence-level` / `align-weak-block` / `align-display-rewrite`，
  退役 `align-bilingual-anchor-crossing`；`--layout-profile`（`default` / `two-line`，
  `cue_params_for_doc` 统一各消费点）；`line_break_plan` 移植 `sourceDisplayLines` 并以
  `lineBreaks[]` 夹具三端对拍，`two-line` profile 在 DP 中按 `max_lines×maxChars` 预算 + 行间
  失衡罚；`verify.sh` 可选 `BCUT_VERIFY_METRICS=1` 跑全量 SubER 对拍。

## 13. M5 评估结论：golden 集与 `ModelAligner`

### 13.1 golden 集与 SubER 基线

- 已落地：`metrics.rs` 的 SubER（词级/字级）与 `align_metrics`，参考值夹具
  `core/fixtures/align/suber-cases.json`（102 例，与 AppTek `subtitle-edit-rate` 0.4.0
  逐例一致；ja/ko 逐字切为已知偏差）。
- 未落地（需要真实 LLM 运行与人工确认，本机无法编译 `bcut`/无 provider）：从
  `examples/` 三个项目各取一段、跑 `edges` 载体、人工确认双语字幕后固化为
  `core/fixtures/align/golden/<project>/<lang>.json`（字幕块 + `alignMetrics` 期望值）。
  验收口径不变：与 `--align-carrier table` 相比 SubER 不劣化、`sentence-degrade` +
  `rewrite-rate` 低于旧 `crossing + reordered` 之和、`bilingual-anchor` 错配为 0。
  首次生成 golden 时同时记录 `align-edges` 首轮通过率与修复轮触发率，作为 D2 的复核依据。

### 13.2 `ModelAligner`（SimAlign 式本地词对齐）可行性

结论：**接口保留（`WordAligner` trait），本轮不实现，不默认启用。** 依据：

> 后续（2026-08-18）：这个槽位后来由本地文本模型方案实现过一版（嵌入粗评 + cross-encoder 精评），
> 又因质量与维护成本整体移除——见 [`archive/bcut-semantic-reranker-alignment-design.md`](../../archive/subtitle/bcut-semantic-reranker-alignment-design.md)（**已归档**）。
> 现状：**无本地对齐器**，对齐证据只来自 `AnchorAligner` 与 `LlmChunkAligner`。


| 维度 | 评估 |
| --- | --- |
| 模型与体积 | SimAlign 需多语言上下文编码器：mBERT ~700 MB、XLM-R base ~1.1 GB、LaBSE ~1.8 GB（fp32）、multilingual-MiniLM-L12 ~470 MB。BaoCut 模型目录目前只有 ASR/说话人/VAD 族，没有文本编码器；需要新增模型族 + tokenizer + BERT 前向（MLX 与 Candle 各一份） |
| 推理成本 | 单句毫秒级，可忽略；主要成本是首次下载与常驻内存 |
| 质量 | SimAlign（mBERT argmax/itermax）在 en-zh 词对齐 AER 约 0.2–0.3，弱于 en-de/en-fr；awesome-align 微调后更好但需平行语料微调产物。对块层而言只需"边界处无跨越边"，词级噪声在 τ 过滤后影响有限，但对省译/意译的召回低于 LLM 块级对齐 |
| 与现有默认路径的关系 | 默认路径已经把对齐边融合进 translate 调用（零额外调用），`ModelAligner` 的价值在于：① 无 provider 的离线重对齐（用户改译文后即时重算块）；② 作为第二来源与 LLM 边做一致率校验并降低 `weak` 块比例。二者都属于优化项，不阻塞交付 |
| 触发条件 | 当 golden 集显示 `align-weak-block` 或 `sentence-degrade` 明显偏高、或用户侧离线重对齐需求明确时再立项；届时优先评估 multilingual-MiniLM（体积最小）+ Candle 实现，MLX 复用同一权重 |

