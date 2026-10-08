# 对齐 golden 集（`bcut-align-golden/1`）

双语对齐的人工参考标注：Bead P/R/F1、Boundary F1、Path EM、sentence-level 降级率
都以它为判定基础。

术语与上游一致：Sentence / Alignment Block / AlignEdge / `plan_sentence` 见
[对齐块方案](../../../../docs/design/subtitle/bcut-alignment-block-subtitle-split-design.md) §4、§8–§10。

## 目录与命名

```text
core/fixtures/align/golden/<project>/<lang>.json
```

- `<project>` = `examples/<project>.bcut` 的目录名去掉 `.bcut` 后缀，也是 JSON 里的 `project`。
- `<lang>` = 目标语言的 BCP-47 主子标签，也是 JSON 里的 `lang`；源语言不写进文件，取 `examples/<project>.bcut/transcript.json` 的 `lang`。

当前内容：

| 文件 | 语言对 | 用例 | 说明 |
| --- | --- | --- | --- |
| `p130-what-is-an-agentic-harness/zh.json` | en→zh | 36 | 对谈口播，术语密集（harness / LLM / agent） |
| `p130-what-is-an-agentic-harness/ja.json` | en→ja | 31 | 同一段源文的日语标注，动词后置导致大量整块交叉 |
| `p839-building-with-chatgpt-voice-openai/zh.json` | en→zh | 29 | 演示口播，短句与碎片多，专名（Codex / Voice / Chat） |
| `p128-…-生成高级感分镜/en.json` | zh→en | 30 | 中文源（词原子是单字），数字与序数密集 |

## 文件格式

```jsonc
{
  "schema": "bcut-align-golden/1",
  "project": "p130-what-is-an-agentic-harness",
  "lang": "zh",
  "cases": [
    {
      "id": "p130-zh-012",
      "sentenceId": "s-g12.0",
      "sourceWords": ["I", "didn't", "go", "because", "I", "was", "sick"],
      "target": "因为我病了，所以没去",
      "tags": ["N:M", "causal-inversion"],
      "beads": [{ "src": [0, 7], "tgt": [0, 10] }],
      "hardAnchors": [{ "src": 3, "tgt": [0, 2] }],
      "expected": { "correspondence": "block", "minBlocks": 1 }
    }
  ]
}
```

### 字段语义

| 字段 | 语义 |
| --- | --- |
| `schema` | 恒为 `bcut-align-golden/1`。字段名已冻结，值可增补；改结构要同时升 schema。 |
| `project` / `lang` | 见上。必须与所在目录名 / 文件名一致。 |
| `cases[].id` | 全局唯一，`<项目短号>-<lang>-<三位序号>`。被 `hardNegativeOf` 引用，**不要重排**。 |
| `cases[].sentenceId` | 该 transcript 由 `derive_sentences` 真实派生出的句 id（`s-<首词 id>`）。源 Cue / `breaks` 不参与，改断行不会改变它。 |
| `cases[].sourceWords` | 句内可见词的文本，顺序即 `beads[].src` 的下标基准。必须与派生 Sentence 的词逐一相等（有测试守住）。 |
| `cases[].target` | 人工确认的目标语**整句**译文。`beads[].tgt` 是它的 `chars()` 下标，不是字节。 |
| `cases[].tags` | 现象标签，取值见下表。 |
| `cases[].beads` | 人工标注的最小单调对齐块划分。 |
| `cases[].beads[].src` | 源词下标**半开区间** `[start, end)`。 |
| `cases[].beads[].tgt` | 目标 `chars()` **半开区间** `[start, end)`。 |
| `cases[].hardAnchors` | 必须被任意对齐器判定为硬锚的 `(源词下标, 目标字符区间)`：数字、日期、原样 Latin、专名、锁定术语。该区间必须落在同一源词所属 bead 的目标区间内。 |
| `cases[].expected.correspondence` | 人工期望的对应粒度：`block` 可块级对照，`sentence` 只能整句对应。 |
| `cases[].expected.minBlocks` | 人工认为至少应达到的块数，`1 ≤ minBlocks ≤ beads.length`（当前一律等于 `beads.length`）。 |
| `cases[].expected.hardNegativeOf` | 可选。同一文件内另一条用例的 `id`：两条主题高度相似、模型必须能区分。 |

### bead 的硬约束

`beads` 是两侧的**划分**，不是任意二部图：

1. **连续**：第一条从 `src[0] = 0`、`tgt[0] = 0` 起，后一条的起点等于前一条的终点。
2. **全覆盖**：最后一条的 `src[1] == sourceWords.length`、`tgt[1] == target.chars().count()`。
3. **单调**：两侧同序递增（由 1 + 2 蕴含）。
4. **非空**：每条 bead 两侧区间都非空——禁止 `0:1` / `1:0`。省译的源词（冠词、填充词、重复）并入相邻 bead，句首的并入后一块；增译的目标片同理。
5. **交叉即合并**：源侧与目标侧语序交叉的区域必须落进**同一条** bead。`I didn't go / because I was sick` ↔ `因为我病了，所以没去` 整句一条；`the plan we discussed yesterday` ↔ `我们昨天讨论的计划` 只把该名词短语并成一条，句子其余部分仍可切。

这与 `bcut-flow-core` 的 `minimal_monotonic_blocks` 输出契约一致，所以 golden 与预测可以逐条对照。
校验代码在 [`core/crates/bcut-flow-core/src/golden.rs`](../../../crates/bcut-flow-core/src/golden.rs)。

## tag 取值

共覆盖 12 类现象；`omission` / `addition` 是"省译 / 增译"一类的两个方向，因此 tag 值共 13 个。
一条用例可以带多个 tag；**每个 tag 在整个 golden 集里至少 5 条**（测试断言）。

| tag | 含义 |
| --- | --- |
| `1:1` | 存在源侧单词 ↔ 单一译文片段的直接对应（bead 源区间长度为 1）。 |
| `1:N` | 某个源语单位在译文里展开成多个显示单位（一个源词对应长得多的译片）。 |
| `N:1` | 多个源词合并为单一译文单位（含虚词、系动词、助动词被吸收）。 |
| `N:M` | 存在多对多块：源侧多词与译侧多单位互相纠缠，无法再细分。 |
| `causal-inversion` | 因果 / 条件从句在两语中前后位置不同（`because` / `since` / `if` ↔ `因为…所以` / `如果…就`）。 |
| `attributive-reorder` | 定语、关系从句、`of` 短语、时间地点状语相对中心词换位。 |
| `negation` | 否定范围（`not` / `never` / `no` / `不` / `没`）在两语中的作用域或位置不同。 |
| `number` | 含数字、百分比、分辨率、日期或序数，必须逐一对上。 |
| `proper-noun` | 含人名 / 机构 / 产品专名（`Simon Williamson`、`Codex`、`Hyper Frames`）。 |
| `term` | 含技术术语（锁定术语候选：`harness` / `LLM` / `feature flag` / `pull request`）。 |
| `omission` | 源侧存在无对应译文的词，被并入相邻 bead。 |
| `addition` | 译文增补了源侧没有的显性成分（连接词、主语、量词、标点）。 |
| `hard-negative` | 与 `expected.hardNegativeOf` 指定的用例主题高度相似，必须能区分。 |

当前分布（`cargo test -p bcut-flow-core --test golden_align -- --nocapture` 会打印）：

```text
1:1 36 / 1:N 9 / N:1 31 / N:M 79 / causal-inversion 9 / attributive-reorder 59
negation 17 / number 14 / proper-noun 26 / term 65 / omission 18 / addition 8 / hard-negative 11
```

## 来源与确认记录

| 项 | 内容 |
| --- | --- |
| 源文 | `examples/<project>.bcut/transcript.json` 的 `words[]`（未改动；golden 不写回 examples） |
| 译文 | **由 agent 撰写，待人工确认**。`p130/zh` 与 `p839/zh` 参考了同项目已有的 `trans.zh`，但为覆盖标注现象做了改写与补全；`p130/ja` 与 `p128/en` 的译文 examples 中不存在，完全由 agent 撰写 |
| beads / hardAnchors / tags / expected | **由 agent 标注，待人工确认** |
| 标注日期 | 2026-08-16 |
| 人工确认者 | 待补（确认后把这一行改成姓名 + 日期，并在下方登记本轮修订） |

> 在人工确认完成前，基于本 golden 得出的数值只能作为**趋势对拍**。

## 消费方

- [`core/crates/bcut-flow-core/src/golden.rs`](../../../crates/bcut-flow-core/src/golden.rs)：serde 结构与纯校验（`GoldenFile::from_str`，无 I/O）。
- [`core/crates/bcut-flow-core/src/metrics.rs`](../../../crates/bcut-flow-core/src/metrics.rs)：`bead_prf`（`Strict` / `Lax`）、`boundary_f1`、`path_exact_match`、`beads_boundaries`、`beads_contiguous`。
  - `Strict`：预测 bead 与 golden bead 两侧区间**完全相等**才计命中。
  - `Lax`：两侧都有非空交集即计命中（切分粒度不同但对应关系正确时仍得分）。
  - 精确率以预测为分母、召回率以 golden 为分母，各自独立判定（沿用 Vecalign / Bertalign 的口径）。
- [`core/crates/bcut-flow-core/tests/golden_align.rs`](../../../crates/bcut-flow-core/tests/golden_align.rs)：唯一做文件 I/O 的一侧；加载全部 golden、校验约束、打印 `AnchorAligner` 基线。

```bash
cd core
cargo test -p bcut-flow-core --test golden_align -- --nocapture
```

基线数值**不设门槛**（只有 `AnchorAligner` 的确定性硬锚，没有 LLM），它的意义是给
后续对齐路径一个可以逐条比较的下界。2026-08-16 的快照：

```text
语言对           用例  strictP  strictR strictF1     laxP     laxR    laxF1 bndSrcF1 bndTgtF1   pathEM      句级率
p128 zh→en    30    0.035    0.069    0.045    0.795    0.853    0.812    0.324    0.388    0.000    0.467
p130 en→ja    31    0.000    0.000    0.000    0.734    0.882    0.781    0.205    0.030    0.000    0.806
p130 en→zh    36    0.010    0.013    0.012    0.656    0.769    0.688    0.331    0.118    0.000    0.750
p839 en→zh    29    0.297    0.303    0.299    0.805    0.810    0.802    0.572    0.502    0.241    0.862
总计           126    0.080    0.090    0.083    0.743    0.826    0.766    0.354    0.249    0.056    0.722

决策树：块级 27 / 需改写 8 / 整句 91（共 126）
硬锚命中：56/65
```

读法：只靠确定性锚点，72% 的句拿不到足够证据、直接退到整句对应，strict Path EM 只有 5.6%——
没有语义证据就切不出块。lax F1 明显高于 strict，说明 Anchor 划出的
少数块方向是对的、粒度太粗。`硬锚命中 56/65` 的缺口来自译文里被改写的专名（`Claude code` → `Claude Code`、
`anti-gravity` → `Antigravity`）与拼写体不一致的数字，属于 `AnchorAligner` 的已知边界，不是 golden 标注错误。

## 如何新增用例

1. 选句：从 `examples/<project>.bcut/transcript.json` 里挑，句 id 必须是 `derive_sentences` 当前派生出来的
   （最省事的做法是写一个临时测试调用 `derive_sentences` 打印 `id` + 词文本，标完就删掉）。
2. 写 `sourceWords`：直接抄该句的词文本，顺序不能改；测试会逐一对照，不一致直接失败。
3. 写 `target`：目标语自然整句译文。先按目标语的自然度决定译文，**再**去映射源词区间——不要为了对齐而扭曲译文，
   也不要让原始字幕 Cue 或 `breaks` 参与切分决策（上游纪律，见对齐块方案 §4.1）。
4. 切 bead：在译文的合法缝（标点、空白、CJK 字界）上切，切点两侧的源词区间不得交叉；交叉就往回合并成一条。
   逐条累加确认两侧连续、全覆盖、非空。
5. 标 `hardAnchors`：数字、原样 Latin、专名、锁定术语。目标区间必须落在该源词所属 bead 内。
6. 标 `tags`：照上表，至少一个；不确定就少标，不要为了凑数硬套。
7. 填 `expected`：`correspondence` 通常是 `block`；确实无法块级对照（整句都是一条 bead 且置信度低）才写 `sentence`。
   `minBlocks` 填 `beads.length`。
8. `id` 顺延本文件的最大序号，不要重排已有 id（`hardNegativeOf` 会引用）。
9. 跑测试：

   ```bash
   cd core
   cargo fmt --all -- --check
   cargo test -p bcut-flow-core --test golden_align -- --nocapture
   ```

10. 在上面的"目录与命名"表格与"来源与确认记录"里更新条数与确认状态。
