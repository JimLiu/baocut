> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# bcut 字幕 Agent 工作流内部参考

> 内部开发资料。本文保存从可分发 skill 移出的编排、性能、契约与恢复经验。
> CLI 返回的 contract、payload、JSON 状态和测试始终优先；不要把这些内部细节
> 复制回 `skills/`。
> 模型内容协议已改用 TXT / Markdown / HTML 的文件契约（file-v1），方案见
> [文件化字幕 AI 管线重设计](bcut-file-contract-subtitle-ai-design.md)，已于 2026-08
> 单轨化执行（`--contract` 参数与 json 分支已删除）。本文描述的 `json-v0` 工作流
> 仅作为历史资料与未迁移单轮 kind（polish-retry/segment/segment-index/
> cleanup/broll）的参考保留（chapters 已于 2026-08 迁到 file-v1 HTML 载体并分页
> Map/Reduce，见 AI 管线设计 §7）。

整理来源是 `3992b2d^` 时点的 `skills/bcut-subtitle-studio/SKILL.md` 和
`references/workflow.md`。需要逐字追溯时可用 `git show 3992b2d^:<path>`。

相关资料：[Studio Web 实现](bcut-studio-web-implementation.md)、
[AI 管线设计](bcut-ai-pipeline-design.md)、
[字幕管线实现](bcut-subtitle-pipeline-implementation.md)。

## 1. 项目现场

典型项目：

```text
<name>.bcut/
  project.json
  transcript.json
  ai/
  tasks/<taskId>/
    contracts/
    payloads/
    requests/
    responses/
    claims/
  checks/
  exports/
  studio/
    data.json
    edits.json
    progress.json
  .bcut/history/
```

关键所有权：

- `transcript.json` 只能经 CLI/flow/Studio apply 写。
- 确定性的 Transcript 检索与替换优先使用 `bcut transcript find/replace`；用
  `find.total` 作为 `replace --expect`，正文与说话人显示名同时改时使用
  `--scope all`。不得为了字面检索或替换启动浏览器编辑。
- AI 中间结果与阶段 stamp 用于续跑，不以“文件存在”单独判断 fresh。
- `studio/data.json` 是派生投影；`studio/edits.json` 是尚未应用的页面覆盖层。
- Studio 页面代码保留在 skill 中，由共享 `bcut serve` 实时提供，不属于项目包。
- 一个项目同时只跑一个 flow。

开始前：

```bash
<repo>/scripts/dev/prepare-bcut.sh          # 源码更新后、任务计时前执行
BCUT=$(<repo>/scripts/dev/prepare-bcut.sh --check)
$BCUT --json doctor --quick
$BCUT --json model list
$BCUT --json project show $PROJ
$BCUT --json check $PROJ --lang <lang>
```

`prepare-bcut.sh` 在源码更新后预构建并核对 commit/target/profile；媒体阶段只使用
已核对的 release binary。`bcut` 是薄客户端，命令都在同级 `bcut-serve`（Runtime）里执行，
脚本同时构建并核对这两只；机器上已有别的 Runtime 在跑时 `bcut` 会用它（commit 不同时
stderr 提示一句），要计时本次构建就先 `$BCUT serve --stop`，下一条命令会拉起同级的新 Runtime。只诊断在线视频下载时改用 `doctor --url-only`，不加载
推理运行时或模型缓存。常规 `doctor --quick` 只检查模型就绪状态，不执行权重深度
哈希或模型推理；深度完整性检查仍使用无参数 `doctor`。

Windows URL 输入先运行 skill 的 `prepare-url-deps.ps1 -Mode Plan`。缺依赖时只展示一次
汇总计划并取得明确授权，再以 `-Mode Install -Confirmed` 执行；拒绝授权就停止。创建
共享项目后，先幂等执行 `serve --background`，从 `serve --status` 读取实际 URL 并确认
项目页 HTTP 200。模型未就绪时先独立运行 `model download <id> --jsonl`，完成后再次
确保 preview，再启动 `auto`；task 续接与最终交付前也重复同一 preview 自愈检查。

## 2. 转录与直播

普通转录：

```bash
$BCUT transcribe <media> --project $PROJ
```

页面直播：

```bash
$BCUT transcribe <media> --project $PROJ --jsonl \
  > $PROJ/studio/live.jsonl

$BCUT studio sync $PROJ \
  --live-jsonl $PROJ/studio/live.jsonl \
  --phase transcribing
```

JSONL 事件包括：

- `progress`：模型、下载、解码、VAD、识别、精修与写入阶段。
- `segment`：已识别的临时文本和时间。
- `language`：语言检测。
- `done`：正式 transcript 已提交。

首次模型下载的 progress 可带文件字节、已续传字节、组件阶段、model/repo/path；常规
JSONL 每秒最多一次，边界事件立即发送。stdout 消费者断开会协作式取消而非 panic，
partial 保留供下一次显式下载续传。`auto`/`transcribe` 仍兼容自动准备模型，但 Agent
工作流用独立下载避免首次约 1.62 GB 冷启动与转录共用一个不透明超时窗口。

直播 sync 原先按约 5 秒节拍执行；这是 UI 刷新策略，不属于 transcript 语义。
正式写入完成后，CLI 提交钩子会刷新 Studio，正式 Cue 替换 live Cue。

重转录会覆盖现有 transcript，必须使用显式确认参数，并先保留可恢复现场。

## 3. 阶段依赖与默认链

内部依赖图：

```text
transcribe
  → polish（同一结果派生 paragraph）
  → translate
  → 对齐候选过滤
  → 批量 LLM 对齐
  → check 残余热点
  → 定向 refine-align
```

性能结论：

- 首次 polish 已从通过校验的 paragraph/sentence 结果派生 `paraBreaks` 与
  segment stamp；普通翻译任务不应预先再跑 standalone segment。
- translate 的硬前置是 `polish=fresh`。`segment=stale` 可能只是 polish 改词后的
  正常状态，不应因此重复分段。
- 页面文本编辑 apply 后，使用 `auto --polish` 明确重新验证润色前置。
- chapters 只在用户要求导航章节时运行，不替代 paragraph。
- 默认 translate 增量处理缺失或源文变化的句；`--force` 才全量重翻。

默认链：

```bash
rm -f $PROJ/studio/worker_stop
$BCUT --json auto $PROJ --polish --lang zh &
```

普通链路直接把所有长句批量交给 many-to-one LLM，首轮完成拆分与对齐；
`refine-align` 只处理 check 后仍残留的顽固句，不是固定第二阶段。兼容参数
`--align-local` 已弃用，即使传入也不会绕过长句 LLM。显式全量
`--align-only --yes` 仍保留给对齐实验。

## 4. 对齐内部策略

### 4.1 many-to-one

**缺省载体：块对齐边（`align-edges/1`，对齐块设计 M3）。** 引擎先过滤无需拆分的
句；translate 融合草稿（`<p>` 内 `<span data-src>` 块标注）先走确定性块核，落不了
的句再进 dedicated 轮。dedicated 载荷是一张 HTML 表：`td.src` 是带 `[N]` 序号的
句内源词，`td.tgt` 是完整自然译句；模型只把 `td.tgt` 改成
`<span data-src="4-7">因为我病了，</span><span data-src="1 2 3">所以没去。</span>`
——最小自然语义块按译文自身顺序，`data-src` 列源词序号（可乱序、可不连续、可空，
一句内每序号至多一块）。它不切源、不切译、不解决交叉。之后全是代码：块 → 软边
（0.75）+ 数字/URL/原样 Latin/术语硬边 → 安全边界（`leftMax < rightMin`）→
最小单调块 → 双语 DP → `correspondence: block` + `blocks[]`。语序交叉自动落进同一
块（`因为我病了，所以没去。` 整句一块仍是块级对应）；某块超 hard 才发一次
`align-rewrite/1` 窄任务（同形表，`data-over-hard` 指出超限块与源词序号区间；模型
按源语小句顺序改写整句并同时标 span；验收 ±max(25%,4) 阅读单位、锁定术语与数字/
URL/Latin 锚不得丢、目标 AutoCorrect、改写文本上重跑块核必须成立 ⇒ 写
`transDisplay{basis:"monotonic-rewrite"}` + `text_basis: display`，`trans` 不动；改写轮
无修复），再不行整句对应（`correspondence: sentence`）。首轮失败句共享一次全局修复
（问题码：`align-edge-ordinal` / `align-edge-text` / `missing-id` …），预算耗尽先试
纯锚点块对齐，最后才是确定性目标语切分兜底。提交期 lint 与引擎共用
`parse_align_edges` 一份校验器；`bcut translate --align-carrier table` 切回下面的
两列切分表作审阅/修复载体（自报 `data-crossing` 落整句对应，`data-reordered` 改写
落 `transDisplay{basis:"table-reorder"}`）。

**审阅/修复载体：两列切分表（`align-table/1`）。** 需要 LLM 的句按序连续分批，页数取三条约束的最大值：

- `atomize::word_count`：Latin 按词、CJK 按字、依附标点不单算；执行器预算目前
  都是 2000 词并带 10% slack；
- 每页最多 40 个待对齐项，防止许多短句堆进一个超长人工任务；
- 每页 16000 的确定性复杂度预算，近似 HTML 正文、建议片数、术语和双语锚点成本。

页界再按复杂度均衡且保持句序连续；`BCUT_LLM_PAGE_WORDS` 只覆盖第一条词数约束。
全量、`--align-only`、`--sentences` 定点修复以及唯一的全局修复轮共用这套算法，
worker 槽位不改变页形。每项包含：

```json
{
  "key": "s-…",
  "source": "…",
  "target": "…",
  "lengthPlan": {
    "pieceCount": {"min": 2, "max": 3, "recommended": 2},
    "source": {"lang": "en", "unit": "word", "total": 24, "preferredPerPiece": [9, 15]},
    "target": {"lang": "zh", "unit": "readingCharacter", "total": 30, "preferredPerPiece": [11, 19]},
    "targetDisplayUnits": 30,
    "targetHardDisplayUnits": 20
  },
  "sourceBreakCandidates": [
    {"id": "b8", "after": "developers,", "before": "a", "seam": 3, "pause": 0, "risky": false}
  ],
  "draftSource": "… | …",
  "draftTarget": "… | …",
  "draftSourceUnits": [8, 16],
  "draftTargetUnits": [14, 16],
  "draftWidths": [12, 14],
  "data-target-frozen": [],
  "sourceWordUnits": [4, 6, 8],
  "draftReady": true,
  "budgets": {}
}
```

`lengthPlan` 同时分析源语、目标语长度：英文等空格分词语言以词数为主；中文、日文
和泰文以阅读字符为主；韩文以 eojeol（空格词组）为语义单位，并另受显示字符 hard
约束。目标块数综合两侧 fit/soft 后给出 min/max/recommended，
每侧另给每片建议范围。范围只指导均衡，不能凌驾于完整短语、语序交叉和双语语义。
source 中可注入停顿提示：

| 标记 | 词间 gap |
| --- | --- |
| `⏸` | ≥ 0.25s |
| `⏸⏸` | ≥ 0.6s |
| `⏸⏸⏸` | ≥ 1.2s |

模型先审阅确定性草稿：草稿已满足交付约束且语义映射正确时只返回
`{"key":"…","useDraft":true}`；需要调整时从 `sourceBreakCandidates` 选择有序
`sourceBreaks`，并只在 target 插入 ` | `：

- 两侧段数相同。
- source 不由模型重抄；切点只能是程序给出的完整词边界 id。
- target 逐字覆盖完整译句。
- 严格按 target-first 两阶段执行：先仅按目标语自然度、术语与 fit/hard 预算确定并
  冻结译文片，再把固定译文片映射到连续 source 词区间。source 的停顿/小句提示只服务
  第二阶段映射，不能反向移动译文切点。
- 非空 `data-target-frozen` 表示融合目标片已经单独通过验收、仅源锚失败；worker 必须逐字
  保留 `draftTarget` 及全部分隔符，只返回新的 `sourceBreaks`。此类句豁免
  `pieceCount.min`：既然译文片不可改动，就不会被要求"再加一刀"。
- 源跨度超过单行预算或约 4s 时，只有目标片自身已有完整小句/并列动作缝才继续拆；
  完整并列动作可用顿号缝，普通名词列表不能仅为对称而拆。
- 语义完整优先；在语义允许时靠近双侧建议长度并满足目标语 hard 预算。
- 单行宽度（fit）是硬约束，不是长度偏好。片超出单行视觉宽度且存在**自由缝**时
  必须在该缝切开，`draftBlockers` 会连同切点两侧的文本一起给出。自由缝的判据
  四条同时成立：切开后两侧都不再超 fit、两侧都不是闪现碎片、不触发任何客观
  阻塞缝判据，且缝本身由原文的标点或**原文里真实存在的空白**背书——CJK 与
  拉丁文交界处渲染时补出的空格不是缝（「担心 | AI 会抢走…」切的是动词和它的
  宾语从句）。不存在自由缝的超 fit 片保持整片：那是译文改写要解决的问题，强切
  只会把超行换成悬垂尾。
- 裸尾片（无标点收尾）不得落在仍需后续成分的尾形上。判据是形态类而不是封闭
  词表：处置式（把/将 + NP 后无谓语）、及物动词 + 趋向/结果补语（到/掉/出/成）
  后缺宾、未闭合的方位框架（在/从/对… + 上/里/中/下/内/间）、兼语式（让/使/叫
  + NP 后无谓语）、光动词（来/去 + 单音节重叠动词）缺宾、系词「是」缺表语；
  另含结构助词「得」、副词（如何/只是/同时/预先）、助动词「可以」、待中心语的
  量词短语（一系列/一块）、光动词 + 「了」（采用了/内置了/提供了）。「剩余的
  35% 得 | 支撑…」「输出质量在数学上 | 与…相同」一律回炉；切点后移一到两字或
  整片保留。成词陷阱（「心得」「以上」「即将」「把握」这类）走白名单豁免。
  语境相关的光动词缺宾（知道/占用/生成）只记 advisory。
- 不得切在并列连词 `和`/`及`/`与` 之前（「它们是 KV 缓存 | 和 PagedAttention」）；
  只有前片以标点收尾时并列连词才可作片首。这是「片尾悬垂连词」的对称面。
  对称的另一半同样禁止：不得切在**第二个并列项之后**而把定中结构的中心语甩到
  下一片（「Key 和 Value | 矩阵」）。
- 退化配对行：≥8 显示单位的译文片必须至少配 3 个源词；源词不够分配（或源区间
  有 ≥2 词且宽度已达译文片 40%）时豁免，否则让相邻短语共享一片，不把源侧切成
  碎屑；单词区间不吃宽度豁免，高亮按词推进只有一步。
- 停顿是参考，不是强制切点。

程序把 source 片回锚连续词区间并派生展示时间。批内通过的句立即收下；所有首轮
批次的失败句合并后共享一个全局修复轮，仍不合格才确定性兜底。按当前复杂度预算，
约 120–130 个典型待切句通常是 5 个首轮调用，修复轮只重发失败集合并沿同一规则
扇出，不会整篇重发。

修复调用只用于不可交付的结构错误：未知或重复 key、非法源词边界、双侧片数不等、
源词或译文未完整覆盖、空片、无效区间、目标片超过 hard、未完成中文数量短语、
裸尾片落在不可停顿的弱尾形上、并列连词起首、退化配对行、
冻结目标片漂移，以及存在目标语自然缝的双语源行过密。目标片因 hard 被确定性续拆后，若比例源锚会落进绑定短语则直接改为 independent，
不为机械重锚再耗一次调用。soft 超限和仅由自然语序交叉造成的片长不均仍记 advisory，
不会单独触发昂贵返工。

### 4.2 其他模式

- `independent`：目标语独立切行，零 LLM，适合单语自然排版。
- `many-to-one`：所有源语或目标语超长句进入批量 LLM。

翻译 Cue 与 transcript/subtitle 的源 Cue 完全独立。两种模式都从 Sentence 的词序列
与词时间窗派生目标 Cue；源 Cue 只服务原文流，不能参与翻译对齐或失效判断
（编辑器原文列的只读展示分组除外，见 Transcript v0.3 §5.2）。`breaks` 改变后
译文片文本、词跨度和指纹必须保持不变。历史 `one-to-one` 模式
因依赖源 Cue 已停用。本地 Agent task 与 Cloud Model/provider 共用这一契约；任一侧的
prompt、schema 或验收变化必须同步另一侧并以同一回归夹具验证。

模式按句保存，可定向重跑：

```bash
$BCUT --json translate $PROJ \
  --lang zh \
  --align-only \
  --sentences s-a,s-b \
  --align-mode many-to-one
```

全量 `--align-only` 需要显式确认，一般只用于对齐实验。

需要修正完整译句时省略 `--align-only`：

```bash
$BCUT --json translate $PROJ --lang zh --sentences s-a,s-b
```

该命令只重翻并重新对齐显式句集，其他 fresh 译句保持不变。

## 5. refine-align

```bash
$BCUT refine-align $PROJ --lang <lang>
```

它优先读取 check 的全量 `warnings[].allItems` / `allSentences` / `allPieces`，
而不是只复制人类可读摘要或 `check.next` 里的截断修复命令：

- `align-overfit`
- `align-stale`
- `translation-overflow` 所属句
- `align-source-ceiling` / `align-source-fragment`
- `align-source-seam` / `align-target-seam`
- `align-paired-density` / `align-bilingual-anchor` / `align-degraded-fallback`
- `align-row-deficit`（译文黏结：一条译文压住多条源行且驻留超限）
  （只保证整句对应的条目与引擎放行口径一致，不报锚点错位，改由 `infos[]` 的
  `align-sentence-level` 列出；`align-weak-block` / `align-display-rewrite` 与
  `alignMetrics[lang]` 同为结构事实，不产生 fix、不进热点）

默认把全量热点组成一次定向任务，只跑一轮 LLM；显式 `refine-align` 仅当这一轮
空转（仍失败的句源几何与入轮逐字相同）或被扇出上限截断时，再把**这些 no-op /
deferred 句**补发至多一轮，不再重发已改变几何却仍顽固的句（`rounds` 因此可能是
0/1/2）。`auto` 的收尾没有额外续轮，并把内部 repair 预算设为 0，避免在主 align
之后重置全阶段预算。结束时写
`studio/worker_stop`，用于区分“阶段间队列暂空”和“整条链结束”。

输出：

- `status=clean`：可结束。
- `status=residual`：`remaining[]` 是仍无法合法 recut 的句。

对 residual 不重复相同 recut。可选：

1. 通过 Studio sentence rewrite 缩短译文。
2. apply 后只重对齐该句。
3. 无法消除时作为已知残留报告。

## 6. Agent claim/submit

flow 使用 `--llm agent` 时阻塞等待应答。首批请求挂出后先查看队列规模：

```bash
$BCUT --json task status $PROJ
```

worker 一律按需拉起：启动 producer 时只随之起**一个**无 kind 过滤的 catch-all
worker（媒体处理与串行 analysis/polish/translate-brief 阶段只需要它），不提前养
任何额外 worker——空转 worker 占着一整个模型会话，成本远高于一次晚起的启动开销。
调用挂出后的 `batch-dispatch.workerPlan` 与 `task status` 中的 `workerPlans[]` 按
`task + kind` 给出 `execution`、`suggestedWorkers`、`claimKinds`、
`recommendedEffort`、`poolKey` 和 `maxLeaseSec`。`recommendedEffort` 对 align（含
同 kind 的全局 repair）为 `high`，其余阶段为 `medium`；编排者应按这个提示选择
worker 推理档位，旧 worker 忽略该字段仍可正常认领。并行阶段建议数为
`min(上限, pendingCount)`，上限默认 3、可由
`BCUT_LLM_MAX_WORKERS` 覆盖（0 表示按 `pendingCount` 全开）；未显式覆盖且同 task
已交付调用的 worker 时长中位数（`observedWorkerSec`）≥ 90 s 时，上限自动放大为
`ceil(pendingCount/2)` 并夹在 3..16——agent 会话每页数分钟的慢 worker 池不再被
钉在 3 路。plan 里的 `maxWorkers` 是当前生效上限（不限时 `null`），
`expectedWaves = ceil(pendingCount/suggestedWorkers)` 是按建议数起 worker 的预计波次数；
串行阶段恒为 1。
`suggestedWorkers` 是按实际待办算出的**上限提示**，不是必须凑满的下限：编排者看到
并行批次后把在跑的 worker 补到 `min(pendingCount, 可用槽数)`，没有待办就不补。
长视频 translate 与 align 通常会把建议数吃满——批次之间互相独立，worker 明显少于
批数时墙钟由排队而非应答时间决定。阶段边界不需要提前备人：worker 用 `submit --next`
在同一会话内直接续认领下一批（含 align 与全局修复调用）；claim 超时且队列为空即
退出，不做常驻热备，下一个并行批次出现时重新拉起。worker 在整条 flow 内可持续复用，
但每次必须按 `claimKinds` 显式重新分配，仍以 `worker_stop` 作为退出信号。

编排端实际可用槽数不等于默认 3 时，起 `bcut` 前先
`export BCUT_LLM_MAX_WORKERS=<真实槽数>`：该值决定 `suggestedWorkers` 和实际
并发消费上限，但不改变分页形状。translate 默认（`--align-fusion rows`）按
800 源文词预算（+10% slack）形成页面，`ceil(源文词数/880)`；`--align-fusion
on|off` 回退到 2000 词预算（`/2200`），详见 AI 管线设计 §8.6.1/§10.4。align 的预计页数取
`ceil(源文词数/2200)`、`ceil(待对齐项/40)` 与
`ceil(复杂度总成本/16000)` 的最大值——这一档不随 `--align-fusion` 取值改变。
编排者应以实际 `workerPlans[]` 为准，真实
槽数取 `min(预计页数, 能同时跑的 worker 会话数)`。

认领：

```bash
$BCUT --json task claim $PROJ \
  --worker <worker-id> \
  --timeout 240
```

典型返回：

```json
{
  "status": "prompt",
  "callId": "cNNNN",
  "kind": "polish",
  "leaseId": "lXXX",
  "task": "t-…",
  "contract": "…/contracts/polish.md",
  "payload": "…/payloads/cNNNN.json",
  "problems": []
}
```

作答后：

```bash
$BCUT --json task submit $PROJ \
  --call cNNNN \
  --lease-id lXXX \
  --task t-… \
  --file /tmp/answer.json \
  --next
```

要点：

- 首次遇到 kind 时读取 contract；每次读取 payload。
- contract 是本次答案 shape 的权威来源。
- `--task` 防止不同 task 下相同 callId 撞名。
- 答案文件放临时目录，不放仓库或项目根。
- submit 省略 `--worker` 时按本次租约的持有者记账，`--next` 也用这个 id 续认领；
  不要为了省事传一个跟 claim 不一致的 id，否则续认领会落到别的 worker 身上。
- rejected 后按 `problems` 修正，同租约重交；历史上同一调用最多允许 3 次。
- `--next` 合并 submit 与下一次认领，并给依赖请求约 2 秒落盘窗；返回 empty 时看
  同一应答里的 `producerState`/`activeTasks`：`alive` 说明 producer 仍在跑（阶段间
  串行段或引擎计算），再做一次有界 `claim --timeout 300` 保活，避免下一波次冷启动；
  `gone` 说明登记过的 producer 已全部退出，不会再挂出调用，直接退出；`unstarted`
  说明项目里还没有任何 producer 记录——flow 多半仍在下载或转录，第一波 AI 调用尚未
  派发，与 t=0 起跑的基线 worker 同处正常空档，继续有界等待。`producerAlive` 是
  `producerState == "alive"` 的兼容布尔，它的 `false` 同时覆盖 `gone` 与 `unstarted`，
  不能单独用作退出判据。
- worker 崩溃后重新 claim；租约和幂等性由 CLI 管理。

租约按 payload 大小分档：短载荷 600 秒、中载荷 900 秒、长载荷 1800 秒。认领后
应连续完成读取、作答和提交，避免把无关工作插入租约窗口。

历史答案 shape：

| kind | 形状与关键约束 |
| --- | --- |
| `analysis` / `brief` | `summary`、`terms[]`、`namedEntities[]` |
| `polish` | `paragraphs[].sentences[]`；拼接完整覆盖输入，句边界语义完整 |
| `polish-retry` | `sentences[].startWordIndex/correctedText` |
| `segment` | `paragraphs[]`；逐字保留，只调整标点和边界 |
| `segment-index` | `paragraphs[].startWordIndex/endWordIndex` |
| `chapters` | NDJSON `{title,startSeg}`（历史；现为 file-v1 HTML `<h2>` + 概要 + `<p id>` 首段锚，见 AI 管线设计 §7） |
| `translate` | `translations{sentenceId:text}`；每个请求句恰好一次 |
| `align` | `sentences[].key/sourceBreaks/target`；源侧选候选 id，目标侧仅插 ` | ` |

运行时 contract 可能演进，表格只用于理解历史设计，不能替代读取 contract。

## 7. Worker 失联恢复

长回答期间 worker 可能失联。可同时运行：

```bash
$BCUT task watch $PROJ
```

观察到 pending 调用长时间没有 claim 活动时，watch 历史上以 exit 3 唤醒编排者。

恢复顺序：

1. 若已有完成答案，重新 claim 后立即 submit。
2. 若无答案，编排者读取 contract/payload 后作答。
3. 需要继续批量处理时重建持久 worker。
4. 处理完重新启动 watch。

旧实践使用 `<task>-<callId>.json` 命名答案，避免跨 task 覆盖。认领后应尽快完成
作答和提交，不在租约中间穿插无关工作。

质量经验：

- polish 句边界保持一个完整问句或陈述句。
- translate 译句自然、简洁、术语一致，产品名保留原文。
- align 切在标点和语义缝，片长尽量均衡。
- 自产 JSON 字符串注意引号转义；要求逐字抄回的字段不得改写引号。

## 8. 进度提交

LLM 阶段：

- flow 启动时创建 `studio/progress.json`。
- task 派发/submit 分别刷新模型调用分母/分子；`callsDone` / `callsTotal` 可直接显示
  `x/y`。
- `flow` / `lang` / `taskId` 标识当前外部 flow，失败时 `error` 保留可见错误；这些
  均为可选增量字段，旧消费者应宽容解码。
- translate 先批量挂出全部页面；任一页面结果就绪并通过校验后立即 checkpoint，先
  刷新 `studio/data.json`，再推进 progress，不等待同批其他页面，也不改变逐页提交
  约束。失败页面独立进入下一轮重试。
- data/progress 都带 `contentFingerprint`。
- 指纹不一致时页面显示 syncing，不显示完成。
- Studio 约每秒轮询 progress，所以调用计数与阶段变化可以实时出现。

转录仍走 JSONL + `studio sync --live-jsonl`。

内容投影成功是阶段前进的提交门。不能先报完成、后写正文。

## 9. 交付门

```bash
$BCUT --json project show $PROJ
$BCUT --json check $PROJ --lang <lang>
```

历史判断：

- 润色交付要求 `polish=fresh`。
- 翻译交付要求 polish 与目标语言翻译 fresh。
- 翻译与 `align-edges` 的 Agent submit 是不可穿透硬门：只有结构与内容质量都通过的答案才会结算；目标脚本错误、占位、源文复制、异常短译和批次短串塌缩不能靠 lint 次数 force-through。hedge 采用首个完整质量门通过者，而不是首个写出 HTML 者。
- 翻译载体的 `data-validator` 属于应答复用键的一部分；校验器版本变化后不得人工搬运旧 response 绕过自动失效。
- `segment=stale` 不必在 polish 后机械重跑。
- `chapters=never` 只表示没有章节导航。
- blockers 必须消除；warnings 要报告影响。

check 常见项：

| 诊断 | 动作 |
| --- | --- |
| `translation-stale` | 增量重跑 translate |
| `align-stale` | 定向 align-only |
| `align-overfit` | 定向重切 |
| `align-source-fragment` | 定向重切（译文片挂在一两个源词的碎渣上） |
| `polish-fallback` | **blocker**：`ai/polish.json` 里 `fallback: true` 的句在润色时被引擎退回原文（整页/单句校验未通过后保留原词），实际未经润色；`polish=fresh` 不代表这些句润过。按 `fix`（`bcut polish <project> --paragraphs <p-…>`，已进 `next[]`）定向重润，修好即消失 |
| `polish-false-sentence-end` | 句末标点落在悬垂词上（假句末；合法的英语 wh 前置宾语 + 介词悬置除外）；只报不自动修，必要时按 `fix` 定向重润色 |
| `translation-overflow` | 重切或改写译文 |
| 孤儿键 | 核对是否由文本回写产生并报告 |

导出只有在用户明确要求时执行：

```bash
$BCUT --json export $PROJ \
  --to srt \
  --mode original|translated|bilingual \
  --lang <lang>
```

无人值守 provider 模式使用：

```text
--llm provider:<vendor>/<model>
BCUT_API_KEY_<VENDOR>
```

它绕过 Agent claim/submit，适合明确要求的自动化运行，但失去逐调用人工质量控制。

## 10. 断点续跑

决策：

1. 项目不存在：新建。
2. transcript 缺失但 live JSONL 存在：转录被打断；ASR 推理仍从头重跑，但有效的
   模型 `.part` 会按 sidecar 身份校验并从文件中点续传。
3. 翻译中断：先验证 polish fresh，再增量 translate。
4. pendingCalls 存在：先确认原 flow 是否仍活着；活着则恢复 worker，已退出则重启
   对应 flow，复用已提交结果。
5. `studio/edits.json` 有未应用编辑：先 apply。
6. 用户要求重来：明确会丢弃哪些结果，再使用显式覆盖选项。

不要仅凭某个产物文件存在或翻译覆盖数判断阶段完成；以 stage fingerprint、
`project show` 和 `check` 为证据。

## 11. BaoCut 老项目升级

```bash
$BCUT --json upgrade-baocut <id> [--root <BaoCut 数据根>]
```

原位升级语义：

- words、speakers、chapters、breaks、paraBreaks 尽量保留。
- 导入端展示片归并为 bcut 句级 `trans`，源跨度写入 `transAlign`。
- 两端指纹体系不互认，因此不继承旧 `transSrc` 和 stage stamps。
- 原媒体存在时保持相对或外部引用且不复制；否则从项目内音频缓存生成 `media/main.m4a`。
- 旧 JSON/JSONL 在新文件全部写成后移入项目 `archive/`；可用 `--dry-run` 先审查损失。

升级会生成 Studio 投影并登记项目；随后按普通项目运行 `studio sync` 与检查。
