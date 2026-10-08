> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# bcut 字幕数据结构 v0.3 设计：句子一等公民与独立翻译 Cue 流

状态：**已确认**（2026-07-28：默认策略 manyToOne、句键 `s-` 前缀、无需
0.2 兼容/迁移——格式未发布，0.3 直接成为当前格式、independent 的 LLM
review 默认关；2026-07-31 起翻译 Cue 与源 Cue 完全独立）。

> **2026-08-16 增补（transcript 0.4）**：对齐块方案
> [bcut-alignment-block-subtitle-split-design.md](bcut-alignment-block-subtitle-split-design.md)
> 在本文之上新增 `autoBreaks[profile]`、`transDisplay`、`transAlign.blocks /
> correspondence / textBasis / aligner`，并取代以下条款：§4 的 `crossing` 交叉标记
> （新写入不再产生，读入按 `correspondence = sentence` 解释）；§5.2 里"语序无法顺切
> 优先由 align worker 直接重排译句并回写句级 `trans`"（改为先合并交叉块，合并后
> 超 hard 才触发窄任务改写并写入 `transDisplay`，`trans` 保持自然译句）；§8 表中
> "改译文行边界"现在只能吸附到对齐块边界。其余条款继续有效。参考 voice-ink `Sources/VoiceInk/Models`（Doc/Word/
BreakOverride/trans/transBreaks）与 `skills/baocut/references/alignment.md`
（两阶段翻译模型、fit/aim/hard 预算），在 bcut 现有 §18 词原子模型
（`bcut-flow-core/src/{doc,cue}.rs`、`engines/{translate,align}.rs`）之上重新
设计翻译与对齐的数据结构。

## 1. 动机：现模型（0.2）装不下需求

现状（transcript 0.2）：

- `words[]` 原子 → `Cue`（派生，六条断行规则）→ `Para`（派生，章节×说话人
  ×paraBreaks）。层级健全。
- **句子（sentence）不是一等公民**：翻译组（≈句）只在 translate 引擎内部临时
  派生（`translation_groups`），不出现在 doc 模型与 cue 模块里。
- **译文按源 Cue 键落盘**：`trans[lang][源cueId] = 已切好的展示文本`。这把
  「译文行必须锚定在源 Cue 边界上」焊死在了存储层：
  1. **各自对齐做不了**——译文行的边界不能落在源 Cue 起点以外的位置；
  2. **多对一的跨度信息丢失**——一片跨 Cue 2..3 时只写首 Cue、其余留空，
     渲染端无法区分「这片覆盖到哪」与「后面真的没有译文」（今天导入
     voice-ink 项目时 26 条「未翻译」占位正是这个语义漏洞）；
  3. **句级真相缺位**——整句自然译文只活在 `ai/sentences-<lang>.json` 缓存里
     （指纹一失效就没了），用户在页面上改一行译文后，句子级重对齐无从谈起。
- 阈值只有单一 advisory `fit`（CJK 16/Latin 42），没有 voice-ink 的
  soft aim（给 LLM 的建议）与 hard ceiling（代码强制）之分。

需求（本次重设计的验收标准）：

- 明确层级：**word → cue → sentence → paragraph → chapter → subtitle**；
- 翻译对齐的单位是**句子**：源句 1:1 译句，源段落 1:1 译段落；
- 句内翻译 Cue 支持**两种策略**（各自对齐 / 词级多对一），两者都只从 Sentence
  派生，对齐决策不读取源 Cue 边界（编辑器原文列的只读展示分组除外，§5.2）；
- 拆分阈值分**软**（给 LLM 的建议值）与**硬**（代码检测的上限）。

## 2. 层级模型

| 层级 | 存储 | id | 派生规则 |
| --- | --- | --- | --- |
| **word** | ✅ 持久化（唯一文本+时间真相） | `g1.4` / `wXXX-n` | — |
| **cue** | 派生 | `q-<首词id>` | §18.5 六条断行规则（不变） |
| **sentence** | 派生；**译文以它为键持久化** | `s-<首词id>` | 1..N 个连续可见词；Cue 仅回填展示元数据，见 §3 |
| **paragraph** | 派生 | `p-<首词id>` | 章节×连续同说话人×paraBreaks（不变） |
| **chapter** | ✅ 持久化（`chapters[]`） | `ch1` | — |
| **subtitle** | 投影（渲染/导出层） | — | 语言流 × 样式 × 双语配对，见 §7 |

`cue` 与 `sentence` 是同一可见词流上的两个独立投影：word 分别被二者覆盖，
sentence 不从 cue 聚合，源 Cue 重排不得改变 sentence。sentence 仍不跨 paragraph /
chapter；无显式 `nobreak` 时句末标点也会封 Cue，但这只是原文展示规则。

翻译侧的对应关系：

- **句子 1:1**：每个源 sentence 恰有一个译句（`trans[lang][s-…]`）；
- **段落 1:1**：paragraph 由源结构派生、sentence 不跨 paragraph（§3 保证），
  译句随源句归入同一段落 ⇒ 自动 1:1，无需额外存储；
- **句内 cue 不保证 1:1**：语序不同，由对齐策略决定（§5）。

## 3. Sentence 一等公民化

把 `translation_groups` 从 `engines/translate.rs` 挪进 core（新
`sentence.rs`），改名 `derive_sentences(doc, cues) -> Vec<Sentence>`：

```rust
pub struct Sentence {
    /// "s-" + 首词 id。首词不变则跨重派生稳定。
    pub id: String,
    pub cue_indices: Vec<usize>,   // 指回 derive_cues 结果
    pub word_indices: Vec<usize>,
    pub src_fingerprint: String,   // 组内词切片指纹（transSrc 基准，算法不变）
}
```

封口条件（在现有四条上**新增两条**，保证 sentence ⊂ paragraph）：

1. 末词 `sentence_end`（。．！？!?…）
2. 与下一可见词间 gap ≥ 1.8s（强停顿；0.6–1.2s 只用于 Cue 断行/软标记，
   不等同于语义句界）
3. 说话人切换
4. 组内词数 ≥ 80（无标点长流兜底；避免在介词、助词或谓语中间硬切）
5. **新增**：下一可见词被 `paraBreaks` 钉住（段落边界）
6. **新增**：下一可见词跨章节边界

键从 0.2 的 `q-<首词id>`（借用首 Cue id）改为 `s-<首词id>`：句与 Cue 是两个
命名空间，借用容易混淆（0.2 的 `trans` 表里 Cue 键和组键长得一样但语义不同，
正是导入时「键重挂」补丁的根源）。迁移时机械改写。

## 4. 翻译数据 v0.3：句级真相 + 对齐覆盖层

`trans` 改为**句级真相**，新增 `transAlign` 覆盖层：

```jsonc
{
  "bcutTranscript": "0.3",
  // Phase-1 真相：完整自然译句（目标语自身语序，不含换行）
  "trans":     { "zh": { "s-g1.0": "你过的就是2028年人们会过的生活。" } },
  // 句源文指纹（脏检测，语义不变，键改 s-）
  "transSrc":  { "zh": { "s-g1.0": "8:g1.0:g1.7:ab12cd34" } },
  // Phase-2 覆盖层：这句译文如何切成展示行
  "transAlign": {
    "zh": {
      "s-g1.0": {
        "mode": "manyToOne",            // independent | manyToOne
        "words": ["g1.0", "g1.1", "g1.2"],        // manyToOne 的源词快照
        "pieces": [
          { "from": 0, "to": 0, "text": "你过的就是" },
          { "from": 1, "to": 2, "text": "2028年人们会过的生活。" }
          // manyToOne：from/to = Sentence 内源词序
        ]
      }
    }
  }
}
```

不变量与失效语义（全部可机器判定，进 `bcut check`）：

- **拼接不变量**：`normalize_chars(concat(pieces.text)) ==
  normalize_chars(trans[lang][key])`。违反 ⇒ `align-stale`（blocker 前置态：
  降级整句上屏，提示重对齐）。
- **词锚快照**：新版 manyToOne 的 `transAlign.words` 必须等于当前句内词 id
  序列。旧 `cues` 字段只为读取历史项目保留，校验和投影都必须忽略；新写入省略。
- **交叉标记**：`crossing` 仅为旧项目读取兼容保留；新对齐恒写 false，缺字段
  按 false。即使旧条目为 true，也不能放宽目标片的 hard 上限。
- **句指纹**：`transSrc` 与当前 `src_fingerprint` 不符 ⇒ `translation-stale`
  （连译句一起重翻，行为同 0.2）。
- **无 transAlign 条目** = 未对齐，合法中间态：展示端降级**整句上屏**
  （单片覆盖该 Sentence 的词时间窗）。今天 align 的「跨 Cue 片写首 Cue、其余留空」
  降级从此有了显式表达，不再靠空条目暗示。

`translate` 引擎从「不写 doc」改为**逐页落 `trans` + `transSrc`**（句子翻完
即持久化）——`ai/translate-*_status.json` 只剩进度快照职责，断点续跑直接从
doc 读已译句。CJK 译句在落 `trans` 后、进入 align 前先做幂等 AutoCorrect，
使标点、混排间距和技术词大小写成为句级真相的一部分；`align` 引擎随后只写
基于该最终字符流的 `transAlign`。

## 5. 两种对齐策略

### 5.1 `independent` — 各自对齐（确定性，零 LLM）

源、译各按自己语言的拆行习惯切，不建立句内对应：

> you are living the way, / somebody in twenty twenty eight / is going to live.
> 你过的就是 / 2028年人们会过的生活。

**切分**：对译句文本跑「目标语切分器」（§6.2）：候选缝按 句末标点 > 子句标点
（，、；：…）> 空白 > CJK 字界 排序，DP 选缝使每片 ≤ hard、贴近 soft、
优先高等级缝。禁切位：Latin 词内、闭标点前/开标点后、受保护词条内。

**时间锚定**：先由译文累计阅读单位占比 → 源句词序列累计权重占比 → 最近的
源词边缘，建立 `wordSpan` 语义锚。展示投影随后可在句内平滑相邻片边界；若
整句总时长足够，就保证每片达到 `max(1s, 阅读单位/CPS)`；不够时按各片所需
时长比例分摊整句时窗——短缺由所有片均担，而不是让碰巧配了短源片的行独自
闪过。最后只借用相邻字幕之间真实存在的静音或媒体尾部空白补时，绝不覆盖
下一条字幕。持久化词锚不变，
`words[]` 仍是唯一时间来源。极端情况下目标片数多于源词数，无法给每片分配
非空 `wordSpan`；此时按各片阅读单位在整句词时窗内比例分配连续展示时间，
`wordSpan` 留空，明确表示不建立逐片双语对应。

### 5.2 `manyToOne` — 多对一（LLM pieces 协议，现 align 引擎）

一个目标语语义片对应连续源词区间。该区间的原文在**展示层**分两级换行：先按它
覆盖的源 Cue 边界分组成子行（跨 N 条源 Cue 就显示 N 条子行——这正是"多对一"的
可见形态），单条子行仍超列宽时，再在词原子边缘按宽度换行。两级都只是
**非持久展示投影**（本节末段），不写回任何字段：

> Production deployments have seen fifty   ←源 Cue A
> percent throughput improvement,          ←源 Cue B
> 生产部署已观察到 50% 的吞吐量提升，

例中两条源子行来自两条源 Cue，它们不是新的对齐条目，也不改变这一条 manyToOne
配对行的时间窗。

LLM 是首选切分器：它直接决定目标语自然语义缝，并把每片映射到连续源词区间。
`{"from","to","text"}` 必须连续全覆盖全部源词、片文本拼接等于整句译文；
词级停顿/小句缝只作为源词映射提示，绝不能强迫目标语模仿源 Cue。程序只做确定性
对账；连续重试失败后才启用目标语确定性切分 + 源词比例锚定兜底。这是
**默认策略**。交付预算对简中先做展示投影：两个 Latin 半角格约等于一个汉字
阅读单位，普通逗号/句号不占 hard/CPS 预算。

片数由译文阅读需求驱动：源语长度只影响锚定与载荷建议，不抬高片数下限，
"几条短源短语共享一条紧凑译文"是多对一的默认形态。译句一行放得下时仅当
整句语音时窗超停留护栏（~7s）才入队切分。语序无法顺切的句子优先由 align
worker 直接重排译句（`reordered: true`——worker 自身具备语言能力，在不改变
语义的前提下按源语小句顺序重组译文；验收带长度带宽护栏，通过后回写句级
`trans` 真相并附审阅 advisory）。重排也不自然时才自报 `crossing: true` 落库
（仅 `manyToOne` 词锚条目合法），审阅端据此标注"行间语义有意不一一对应"，
展示端可按长度比例排时。

对齐执行顺序是规范性的：先只按目标语自然度、protected terms 与 fit/hard 预算
确定并冻结目标片，再把每片映射到 Sentence 的连续源词区间。源词停顿和小句缝只用于
后一步映射；原始 Cue id/边界与 `breaks` 既不进入载荷，也不得被模型推断，或被消费端
反向套用成对齐决策（片数、切点、`from`/`to`、时间窗）。融合草稿若仅源锚失败，已经
通过目标侧验收的片必须跨 dedicated align 保留，该轮只能重选源词区间。重排或
crossing 也不能用来模仿源 Cue。这条禁令的作用域是**决策层**——模型载荷、align
引擎与 `transAlign` 语义；只读、不落库的按源 Cue 分组展示不在其内，见本节末段。

双语配对可读性是 target-first 的次级护栏：源跨度本身不能创造目标切点；只有源片超过
语言感知单行预算或约 4s，且对应目标片自身已经存在完整小句/并列动作缝时，才要求沿该
目标语自然缝继续拆分。完整并列动作可在此条件下使用顿号缝，普通名词列表仍保持内聚。

编辑器与 Web Studio 的原文列另有一层**非持久展示投影**，两级，顺序固定：

1. **按源 Cue 分组子行**：把该片的源词区间与各源 Cue 的词集合求交，跨 N 条源
   Cue 就渲染 N 条子行，让"多对一"在界面上可见（2026-08-08 用户决策；6fb2fd1
   在解耦对齐决策时连展示层分组一并删除，该展示层条款就此推翻，其决策层结论
   继续有效）。分组按 `cues[].words[].id` 与片的 `sourceWordIds` 求交，不按时间
   命中，也不引入源 Cue 的文本或 `breaks`。
2. **子行内宽度换行**：单条子行仍超列宽时，在词原子边缘平衡换行，以完整显示
   原文并提高扫读性。

两级都在渲染期计算：不新增译文片、不改变 `from`/`to`、不写 `breaks` /
`transAlign`、不在 `data.json` 落新字段；点击回到该子行首词的时间点，配对行本身
的时间窗不变。因此"原文视觉上有多行"不等于"多了一条语义对齐"。降级是单调的：
词 id 索引完全不可用时（源 Cue 全无 `words[]`）退化为纯宽度换行，与未分组前逐字
节一致；索引部分缺失时（个别词 id 对不上，例如本地编辑过的 Cue）未映射词并入前
一组，分组变粗但绝不丢词——任何情况下子行词序列拼接必须等于该片完整源词区间。
重新打开项目可由词快照确定性重建相同展示。

### 5.3 策略对比与选择

| | independent | manyToOne（默认） |
| --- | --- | --- |
| LLM 调用 | 0（可选 review） | 长句批量调用 |
| 译行边界 | 目标语自身习惯 | 目标语语义缝 + Sentence 内源词边界 |
| 双语逐行对照 | ❌ 两条独立流 | 可按词区间近似对应 |
| 断句质量 | 目标语最自然 | 语义对应最好 |
| 适用 | 单语字幕、竖排/短行 | 双语字幕 |

`oneToOne` 仅为旧 JSON 的枚举反序列化兼容保留。CLI 不再接受该模式，旧条目
因直接锚定源 Cue 而视为无效，并降级为 Sentence 整句投影，直到重新对齐。

粒度：项目级默认（`translate --align-mode X`，记入 `project.json`），句级
可覆盖（`transAlign[key].mode` 就是每句一份；studio 里对单句重对齐时可换
策略）。策略间切换 = 重跑该句的 Phase-2，句级译文真相不动。

## 6. 阈值体系与目标语切分器

### 6.1 三个数：fit / soft / hard

沿用 voice-ink 语义（alignment.md 的 `budgets: {s, t, f}`），按**目标语言**
分级，全部进 `TransParams`（类比 `CueParams`，规范性缺省）：

| | CJK（zh/ja/ko） | 其他（Latin） | 语义 |
| --- | --- | --- | --- |
| `fit` | 16 | 42 | **触发**：译句 ≤ fit 且未超 hard ⇒ 整句一行，不拆 |
| `soft` | 14 | 30 | **建议**：拆分时的目标片长；写进 LLM prompt，切分器的 DP 目标 |
| `hard` | 20 | 42 | **绝对硬上限**：任何目标片 > hard ⇒ `bcut check` blocker；确定性切分器按构造不产出 |

计数口径：hard/CPS 用交付投影后的 `target_cps_chars`（简中普通逗号/句号投影
掉、去空白，再按两个半角格约等于一个汉字阅读单位）；fit 触发对简中另用完整
视觉宽度（CJK/全角=2 cells）。soft 与 hard 之间是「可整句保留区」：一片落在
(soft, hard] 且没有安全缝时允许不拆——这是软硬分离的意义，避免为凑数硬切
坏句子。CLI：`--fit N` 覆盖 fit，soft/hard 按比例跟随（soft = fit−2 下限 4；
hard = max(fit, round(soft×1.4))）。

按交付收窄（`1.276.0`）：`project.json` 的 `delivery` 为 `shorts` 时，缺省三阈值换成
`TransParams::for_shorts`——`fit` 取竖屏字幕块的一行（块宽 60% 画宽 ÷ 译文字号 5.5% 画宽
≈ 10.9 em：中日韩 10；其余语言按内置 Noto Sans SC 字重 800 量得每个非空白字符 0.58–0.65 em，取
17），`soft` / `hard` 与上表同档同比例缩放（中日韩 10/9/13，其余 17/12/17），不改
`OVER_FIT_PENALTY` 与缝罚分的标定。`--fit` 仍优先。预算不写进 `transAlign`，有效性判据不看
预算，所以已有切分不会因交付变化自动重切（否则切不开的超长片每轮都重跑 LLM），要重切用
`bcut translate --align-only --yes`。`bcut check` 的 `translation-overflow` 与切分器的兜底告警
仍按 `for_lang` 判，不随交付收紧。

超硬 / 缝质量按策略分工：independent 切分器按构造不超；manyToOne 的目标片
也必须全部满足 hard，语序交叉、语义完整、
产品名或短语内聚都不能豁免。LLM 首轮优先选择自然缝；若响应仍留有超 hard 片，
程序在同一次响应内按目标语自然缝继续确定性拆分，并按长度重新锚定连续源词，
不额外调用 LLM。若目标片多于源词，则直接转为 independent，并在整句时窗内
按阅读长度排时。此时允许逐行语义不完全对应：交付字数上限优先于双语对应。
覆盖、区间、译文逐字拼接和空片仍是硬错误；悬垂连接词、黏着助词、短片与长度
均衡属于 advisory，不单独触发昂贵返工。
manyToOne 对所有长句以 32 句/批执行一次首轮语义审阅，批内合格句立即收下，
各批失败句聚合为至多一次全局修复；仍失败才降级「目标语确定性切分 + 源词比例
锚定」，并对兜底结果做缝 lint 合并修复；只有片数多于源词时改记
`mode=independent`，避免为满足锚定而重新合并出超 hard 片。

### 6.2 目标语 tokenizer（atomize 扩展）

译文没有词原子，需要一个纯文本 tokenizer 支撑切分器与吸附：

- Latin：按空白切 token，标点附着（与 apply 脚本 §分词规则一致）；
- CJK：逐字，但**禁切位**由字符类推出（闭标点前、开标点后、数字+单位间、
  Latin 混排 token 内）；
- 受保护词条：从 `ai/brief.json` 词表来（有则用，无则空）——bcut 暂无
  brief 阶段，留接口不阻塞。
- CJK 词内缝（「构|建」类）：Rust 侧无 NLTokenizer，v0.3 不做词典分词；
  independent 模式提供可选 `--review` 让 LLM 审一遍切缝（默认关）。

## 7. subtitle 投影：展示与导出

- **单语（目标语）**：译文 Cue 流 = 各句 pieces 按时序展开。SRT/VTT 直接
  逐片一条。
- **双语**：源 Cue 流和翻译 Cue 流始终独立派生；只在最终双语 SRT/VTT 投影时
  取两条时间流的**边界并集分段**，相邻内容相同的段自动合并（避免闪变）。
- studio `data.json` 增加句层：`sentences: [{id, cueIds, trans, mode,
  alignStale}]`，Translate 面板从「组键猜测」改为直读句结构；译文行编辑
  落到 piece（§8）。

## 8. 编辑与回写语义（studio / apply 脚本）

| 用户操作 | 落点 | 连锁 |
| --- | --- | --- |
| 改某条**译文行**文本 | 该句 `transAlign.pieces[i].text` | 同步重写 `trans[key]` = 拼接结果（拼接不变量保持）；`transSrc` 不动——人工译文编辑不算过期 |
| 改**整句译文**（句级编辑） | `trans[key]` | 删该句 `transAlign` ⇒ 确定性策略立即重切；manyToOne 标记待重对齐，降级整句上屏 |
| 移动译行**边界**（independent） | 相邻两 piece 间字符搬移 | 拼接不变量自动保持 |
| 改**源文本 / breaks** | words / breaks（现语义） | 句指纹变 ⇒ `translation-stale`（重翻）；仅 Cue 结构变化不影响翻译 Cue |

apply 脚本的 trans 编辑通道从「cueId → 文本」改为「pieceRef → 文本」，
base 失效语义不变。

## 9. 导入（无 0.2 迁移负担）

格式未发布，**不做 0.2 兼容**：`bcutTranscript` 直接升 `0.3`，解析端只认
0.3；仓库里现存的 0.2 项目（examples/、e2e fixture）用改造后的导入器/流程
重新生成。

**voice-ink 导入**（`import_baocut.py` 改造，直出 0.3）：其 `trans` 键=
展示单元首词 id，天然是片而非句 ⇒ 按本方案句派生归句：条目落在 Cue i、其后
连续空缺到下一条目（或句尾）⇒ 还原为片 `{from: i, to: 缺口末}`（找回
0.2 式存储丢掉的跨度），`trans[s-…]` = 片文本按序拼接，`mode =
"manyToOne"`。删掉现在的「键重挂」补丁（它把跨度片强行拼进首 Cue，正是
cue 键存储逼出来的变通）。`transBreaks`（voice-ink 的译行断点覆盖）不导入，
v0.3 的 piece 边界已显式持久化。examples/ 三个项目重导验证。

## 10. 实施计划

1. **core 数据层**：`sentence.rs`（derive_sentences + 新封口条件）、`doc.rs`
   v0.3 字段/校验/迁移、`TransParams`（fit/soft/hard）；
2. **确定性切分器**：atomize 目标语 tokenizer + independent 切分 DP +
   Sentence 词时间锚定；全部纯函数、表驱动测试；
3. **引擎改造**：translate 逐页落 trans/transSrc；align 收 `--mode`，
   manyToOne 走现协议落 transAlign，independent 零 LLM；prompt 注入
   soft/hard；
4. **消费端**：export（单语/双语并集分段）、check（align-stale /
   translation-overflow 新 lint）；
5. **serve/studio/skill**：data.json 句层、apply 脚本 pieceRef 通道、
   studio_sync/SKILL.md/references 同步；
6. **验证**：voice-ink 重导 examples 三项目 + E2E（两种模式各跑一遍
   p130 的一段）。
