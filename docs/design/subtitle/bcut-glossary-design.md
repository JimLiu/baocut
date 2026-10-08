> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# 术语库设计稿（跨项目专名表）

> 状态：2026-09-20 原型先行（`designs/baocut`，产品规格 [§15.10](../product/product-design/15-glossary.md)），同日二次收口为**两种表**（转录术语表 / 翻译术语表，§2）。纯层与 App v2 已落地，CLI 与识别提示通道未做（§6）。

## 1. 为什么需要第二层

项目里已经有一张术语表：`ai/context.md` 的 `# Canonical Terms`（`Source | Category | Variants | Note | Lock | Origin`）与 `ai/context.<lang>.md` 的 `# Bilingual Glossary`（`Source | Target | Note | Lock | Origin`），由分析阶段的模型抽出、随项目走（[文件契约 §5](bcut-file-contract-subtitle-ai-design/05.md)）；翻译阶段读到的是它在 `ai/brief-<lang>.json` 里的投影 `glossary[]`（`GlossaryEntry { source, target, note, locked }`，`engines/brief.rs`）。它已经接上四道硬约束：

1. `Lock=yes` 的双语行编译进翻译 payload 的 `rt`（required targets）；
2. `validate_translated_page` 缺 `rt` 判 `Malformed`；
3. 本地 Agent 路径 `lint_agent_answer` 同判据；
4. `bcut … check` 汇总 `missingTargets`。

缺的是**用户自己的、跨项目的**那一层：专业领域的惯例（`commit` 在量价方法里是「突破确认」）既不会被模型猜中，也不该每个项目重抽一次。

**术语库是那张表的上游，不是并行机制。** 库只做一件事：把**本篇命中的**条目以 `Origin=user` 写进项目那张表。这样下游一行不改，`bcut lint` / `check` / 翻译校验的口径全部沿用；用户手改项目那张表仍然有效（`Origin=user` 的行在既有归并里已经优先于 `analyzed`）。

同一个理由决定了**库文件的格式就是同构的 Markdown 表**：人能读、能手改、能发给同事，导入导出不需要第二种格式，也不需要第二套解析器（复用 `filepipe::context_md`，用户文件走 `ParseMode::Strict`，剪贴板导入可放宽到 `Model` 并把消解过的地方作为警告报出来）。

## 2. 数据模型

**库里有两种表，一张表一个 Markdown 文件。**第一版把误识与译名记在同一条里，加一条词要填六格、译名按目标语各存一份、方向无处可写；二次收口拆开：

| 种类 | front matter | 正文 | 一条是什么 | 用在哪 |
| --- | --- | --- | --- | --- |
| 转录术语表 | `kind: transcribe`，可选 `lang`（口播语言，缺省 = 任意） | `# Canonical Terms` | 规范写法 + 常听错成（`Variants`，可空） | 转录的识别提示、润色纠正、翻译命中时借它的误识 |
| 翻译术语表 | `kind: translate`，`from`（可缺省 = 任意）、`to`（必填） | `# Bilingual Glossary` | 原文 → 译文，可选备注，`Lock` 默认 `yes` | 翻译；**只有方向对得上的表参与** |

```markdown
---
name: 交易 · 量价方法
kind: translate
from: en
to: zh
default: true
---

# Bilingual Glossary

| Source | Target | Note | Lock | Origin |
|---|---|---|---|---|
| Wyckoff | 威科夫 |  | yes | user |
| commit | 突破确认 | 量价语境，不是「提交」 | yes | user |
```

```markdown
---
name: 机器学习
kind: transcribe
lang: zh
default: true
---

# Canonical Terms

| Source | Category | Variants | Note | Lock | Origin |
|---|---|---|---|---|---|
| KV cache | other | 开维缓存, KV 换成 |  | no | user |
```

约束与项目那张表同源，不新增语义：

- 表格列沿用项目那张表的形状，所以解析器仍是 `filepipe::context_md` 那一套。**`Category` 不再让用户填**，库一律写 `other`（读入时闭集外的值降级为 `other` 并报警告）；转录表的 `Lock` 恒为 `no`。
- 归并键 = `term_merge_key`（小写、去空白、去 ASCII 标点）：`KV cache` / `kv-cache` / `KV Cache` 是同一条。
- `Variants` 只写**真的被听错过**的写法。这条是反幻觉条款：编出来的近义词会把本来正确的句子改坏，代价不对称。
- **翻译条目默认 `Lock=yes`**：用户自己写下的译文本来就是要求。`Lock=no` 在 UI 里叫「可变通」（优先用、语境不合时可以换）。翻译条目两格都必填，所以不存在「锁定却没有译名」的行。
- **方向匹配**：`from` 按主子标签比（`zh-Hans` / `zh-CN` / `zh` 同为 `zh`），缺省或 `auto` = 任意原文语言；`to` 按语言目录的规范 code 比（`zh` ≠ `zh-Hant`——译成简体与译成繁体是两张表）。语言 code 与名字一律取全 App 共用的语言目录（真身是无依赖的叶子 crate `bcut-lang`，`bcut-editor-core::translate_list::LANGS` 是它的翻译子集门面，原型镜像 `app/model-languages.js`），**术语库不自带语言表**——转录 / 翻译 / 配音读的也是同一份。
- **冲突只在同一方向内算**：同一方向里两张启用的表把同一个原文译成不同的词，启用顺序靠前的赢；不同方向互不相干。转录表之间没有冲突，`Variants` 取并集。
- **掉头**：翻译表可以生成反向表（原文译文互换、`from`/`to` 互换，掉头后归并键撞车的只留第一条，`from` 为任意时反向表的 `to` 无从得知，不提供）。生成的表默认不启用——译名不总是可逆的，要人过一眼。

**第一版的混合文件**（没有 `kind`、两个小节都有）读入时**无损拆成两张**：`# Canonical Terms` 进同名的转录表（`lang` 缺省），`# Bilingual Glossary` 进同名的翻译表（`from` 缺省，`to` 取旧 front matter 的 `targetLang`，没有就取 `targets` 的第一个）。只有一个小节的旧文件按小节定种类。磁盘上的旧文件在第一次写回时按新形状落盘（翻译那一半另起一个文件）。这同时裁决了旧 Q1 / Q2：**一张翻译表只有一个方向，一个方向一个文件**，不加语言列。

**批量录入的行格式**（UI 的「一次粘一批」、剪贴板导入、CLI `add --from-file` 共用一只解析）：一行一条，分隔符认 `=`、`→`、`->`、`=>`、Tab；第三格是备注；转录表右边用 `、` `,` `·` 分多个误识，只写规范写法也行；`|` 开头的按 Markdown 表行读，有表头就按表头找列（`Source / Target / Variants / Note`）。解析不了的行**连同原因一起返回**，不悄悄丢。

**存放位置**：用户数据目录（macOS `~/Library/Application Support/BaoCut/glossary/*.md`，Windows `%LOCALAPPDATA%\bcut\glossary\*.md`），App 与 CLI 共用一份，与 `tts-pace.json` 同级同规则。项目侧只存**启用了哪几张表**（id 数组，两种表共用一个），不复制内容；没定过的项目取 `default: true` 的那几张。

## 3. 编译进项目：只带命中的

跑润色或翻译前，按项目启用的、**这一步用得上的**表（润色 = 口播语言对得上的转录表；翻译 = 方向对得上的翻译表）合并出一份术语集合，再对本篇文稿求命中：

- 拉丁词看词边界（`(?<![A-Za-z0-9])…(?![A-Za-z0-9])`，`commitment` 里的 `commit` 不算命中），CJK 直接子串，大小写不敏感。
- **翻译命中时借转录表的误识**：翻译表本身不记误识，但文稿还没润色时正文里写的可能是「维科夫」而不是 `Wyckoff`。同一个归并键在启用的转录表里记过的错法也算命中。
- 命中的条目才写进 `ai/context.md`（转录表）/ `ai/context.<lang>.md`（翻译表），`Origin=user`。**不命中的不写**：整库灌进去会把一张给模型读的表撑成几百行噪声，会让 `ANALYSIS_MAX_TERMS`（400）的截断开始丢真正用得上的行。
- 模型抽出的同名行（`Origin=analyzed`）被库里的行覆盖，`Variants` 取并集。

**翻译提示词那一层也只带命中的。**项目那张表编译成 `ai/brief-<lang>.json` 的 `glossary[]` 后，`DocumentBrief::glossary_for_prompt(source_text, 80)` 过去只是**按命中次数排序再取前 80**——零命中的条目照样排在后面进了系统提示词（分析阶段抽出来、后来被剪掉的片段里的词就是这样混进去的）。2026-09-20 起改为**只留真的出现在原文里的条目**（与 `term_present` 同口径：拉丁词看词边界、CJK 子串），再按次数排序取前 80。`rt`（每页的 required targets）本来就按页判命中，不受影响。

**过期范围**：改一条术语只让**命中它的句子**过期。既有 `provenance.rs` 的 `term_hashes` 已经按句记录了当时命中的术语哈希（覆盖 `source / target / note / lock` 四元），库改动因此复用同一条通道，不需要新的 stale 语义，也不会触发全文重译。

## 4. 三个使用点

### 4.1 转录：识别提示（选表 + 自定义提示词，能力门）

| 通道 | 后端 | 预算 | 形态 |
| --- | --- | --- | --- |
| `prompt` | whisper.cpp / whisper-rs、`gpt-4o-transcribe` | ~224 token（UI 按约 180 字报） | initial prompt：模型把它当成**前文**来读，不是指令 |
| `context` | Qwen3-ASR | 宽得多（UI 按约 1200 字报） | 上下文文本，可以写这段录音在讲什么 |
| `none` | MOSS 等 | — | 没有这条通道 |

每次转录由用户决定两样东西（新建向导的「更多选项」与重新转录面板同一块）：**带哪几张转录术语表**（只列口播语言对得上的；没动过取默认那几张）与**一段自定义提示词**（可空）。没有通道的模型整块收成一句话，不给点了没用的控件。第一版那只全局开关（`glossaryHint`）撤掉。

**合成口径**（`hint_compose(custom, terms, budget)`，纯层，UI 与后端同一只）：自定义提示词在前、**一个字不截**；术语的规范写法用顿号拼在后面填满剩下的预算，按表的启用顺序，放不下的丢在末尾并**报出丢了几条**；提示词自己超预算时报 `over`（UI 转橙色写明超了多少，后端按通道自己的规则截尾）。JSON 回执里同样要有 `dropped / over`，不悄悄截。

**2026-09-20 已通电**（spec `1.153.0`）。落地形状与上面这张表一致，三件事各自的真身：

1. **后端入参**：`SpeechRecognition::transcribe_with_hint(audio, language, hint: Option<&TranscribeHint>)`，`transcribe` 变成它 `hint = None` 的那一支，既有调用方一行不用改。Whisper CoreML 把提示编成 `<|startofprev|> + BPE` 挂在解码前缀上（与生成共用 KV 缓存，超预算**截头不截尾**——截尾会把话说到一半，截头只丢最早的几条术语）；whisper.cpp 走 `initial_prompt`（`no_context` 在它之前清历史，两者并存，提示因此逐段都生效）；Qwen3-ASR 写 `Qwen3DecodingOptions.context`；MOSS 显式收下并丢弃。
2. **能力查询**：后端自报 `SpeechRecognition::hint_kind()`，与按模型 id 判的 `bcut_speech_core::asr_hint` 对照；编排层（`transcribe_all_hinted`）发现后端没通道就报一行「已忽略」，不悄悄丢。能力表有两份（语音一份、编辑器纯层一份，后者要编 wasm），`core/crates/bcut-kernel/tests/asr_hint_parity.rs` 逐只对拍，漂了就红。
3. **CLI / serve**：`bcut transcribe --prompt <TEXT>`（env `BCUT_TRANSCRIBE_PROMPT`），`bcut auto` 与 `bcut clip transcribe` 同名同义；serve 的 `POST /projects`、`POST /imports` 与任务 `options` 都多认一个 `prompt`；远端节点的 `POST /v1/asr/jobs` 的 `options.prompt` 与 OpenAI 兼容面的 `prompt` 表单字段都真的转发给引擎。

**没有做 `--glossary <pack,…>`**：`bcut glossary` 子命令族（§5）还不存在，CLI 这一侧认不出 pack id。契约取最简的那种——**收拼好的提示文本**，拼装仍由唯一一只 `hint_compose` 做（App 页面上写着送多少字，起任务时就送多少字）。`bcut glossary` 落地后再加 `--glossary` 作为「帮你拼」的糖，不改这条通道。

### 4.2 润色：逐处纠正 + 候选回流

润色任务在既有 prompt 之外带上命中的条目，并要求模型只按「误识 → 规范写法」改写、不扩大解释。确定性部分（哪一段有哪几处、替换后的整段）可以在 Rust 侧先算出来作为期望值与校验：一段一条建议，段内同一术语多次误识合成一条，两条术语咬住同一截文字时取靠前且更长的那条。

**候选回流**：润色同时给出「库里还没有、但本篇反复出现（≥2 次）的疑似专名」。判据应当由确定性代码给候选池（重复出现的未登记片段），模型只做筛选与归类；纯靠模型开列会把「嗯 / 论文 / 学习」也开进来（与 `ANALYSIS_MAX_TERMS_PER_PAGE` 那条实测教训同源）。

### 4.3 翻译：方向对得上的表、只带命中的

不新增机制：方向对得上的翻译表里**本篇命中的**条目进 `ai/context.<lang>.md`，`Lock=yes`（默认）的走既有 `rt` → `validate` → `lint` → `check` 四道，`Lock=no`（可变通）的只进提示词。UI 在设置态写明「N 张表 · M 条 · 本篇命中 K 条，只把命中的交给模型」并可展开看是哪几条；Agent 路径的意图句同口径（「翻译术语表里本篇命中的 K 条照着译，其中 J 条必须逐字照用」）。

## 5. CLI

CLI 今天**没有**任何术语相关命令（术语只能靠手改 `ai/context.md` 与 `ai/brief-<lang>.json`）。库需要一个自己的子命令族：

```
bcut glossary list
bcut glossary show <pack>
bcut glossary new <name> --kind transcribe [--lang <l>] | --kind translate [--from <l>] --to <l>
bcut glossary add <pack> <source> [<target 或 误识,…>] [--note <n>] [--flexible]
bcut glossary add <pack> --from-file <file|->   # 一行一条，与 UI 的「一次粘一批」同一只解析
bcut glossary reverse <pack>
bcut glossary import <file> [--pack <name>]
bcut glossary export <pack> [--out <file>]
bcut glossary enable <pack> --project <p> / disable
bcut glossary compile --project <p>     # 打印这一篇会被写进 context.md 的行
```

全部走稳定 JSON 信封；`compile --json` 是 skill 与 Agent 路径的接入点（[`skills/baocut`](../../../skills/baocut/SKILL.md) 的转录/翻译流程可以在这一步取到该用哪些术语，不必自己读用户目录）。新增任何命令与字段都要在同一任务同步 CLI 参考正文。

## 6. 三表面

| 表面 | 现状 | 计划 |
| --- | --- | --- |
| `designs/baocut` | 2026-09-20 已画（设置一节 + 项目内三处露面 + 能力门）；同日二次收口（两种表 / 两格加词 / 一次粘一批 / 翻译只带命中 / 转录选表与自定义提示词 / 共用语言目录） | — |
| `apps/baocut` | **2026-09-20 已落地**（[首版](../../changelog/app-v2/2026-09-20-050743.md)、[二次收口](../../changelog/app-v2/2026-09-20-161926.md)、[识别提示通电](../../changelog/app-v2/2026-09-20-201317.md)） | 设置一节（两种表 / 两格加词 / 一次粘一批 / 掉头 / 导入导出）+ 润色与翻译设置态一行（翻译写明本篇命中并可展开）+ **新建向导的转录设置与重新转录**两处同一只识别提示块（选表 + 自定义提示词，按模型能力收放，起任务时真的送进 `--prompt`）+ 结果里的术语卡与回流；语言取共用目录；纯层落在 `bcut-editor-core`，GPUI 侧只画 |
| `apps/web` | 无 | **不适用**：Web 没有任何 AI 入口与设置页（[§22](../product/product-design/22.md)） |
| `core` | **纯层已有**：`bcut-editor-core::glossary`（两种表 / 按语境归并 / 命中 / 提示拼装与预算 / 逐行解析 / 掉头 / 校对 / 候选 / 能力门 / Markdown 往返 / 编译行的生成，25 条单测）；翻译引擎的 `glossary_for_prompt` 只收命中条目；**识别提示通道 2026-09-20 通电**（`bcut_speech_core::hint`、各后端的 `transcribe_with_hint`、`--prompt` 与三条派发路径） | CLI 编排（`apps/cli` 的 `bcut glossary` 子命令族，§5） |

落地次序建议：**core 的库读写与编译 → CLI → App v2 → 识别提示通道 → Web**。识别提示排在后面是因为它是唯一需要动语音后端的部分，而前面三步已经能让库在润色与翻译两处真正生效。

**实际次序**（2026-09-20）：纯层与 App v2 一起做了，CLI 排到了后面——纯层的判据与磁盘格式已经冻在 `bcut-editor-core::glossary` 与 `apps/baocut/src/engine/glossary.rs`，`bcut glossary` 接的是同一份格式，先做哪个不改契约；先做 App 是因为库要长起来只能靠结果页的候选回流，那条路在 App 里。识别提示通道同日插到了 CLI 前面（原计划排在它后面）：它是「页面上的开关到底算不算数」这一问的答案，拖着就是一直在界面里写「这一版还没接」。剩下的只有 **CLI（`bcut glossary`）**；Web 不适用。

库的磁盘面今天在 `apps/baocut/src/engine/glossary.rs`（薄：目录扫描、原子写、编译落盘），判据全在纯层。做 `bcut glossary` 时把这一层挪进 core 即可，两边不各写一份。

## 7. 待裁决

- ~~Q1 一张表能不能跨语言共用~~ / ~~Q2 库文件的多语言载体~~：**已裁决（2026-09-20）**——一张翻译表一个方向、一个文件，见 §2。
- **Q3 命中的大小写与词形**：英文复数 / 所有格（`Wyckoff's`）目前不命中。是否加有限的词形归一（只做后缀 `s / 's`），还是一律要求用户把词形写进 `Variants`。
- **Q4 回流候选的来源**：确定性候选池的抽取算法（未登记的重复片段）尚未定；CJK 无空格分词是主要难点，可能需要先落一个保守版本（只收含拉丁字母或已知边界的片段）。
- **Q5 同步**：库在用户数据目录，换一台电脑就没了。是否给「导出全部 / 导入全部」之外的同步方式（例如放进用户指定的目录由他自己同步），需要产品裁决。
