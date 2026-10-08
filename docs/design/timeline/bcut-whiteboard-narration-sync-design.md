> 移植自 BaoCut v2；文中的数据模型名（timeline.json、Element、Source / Clip / Cut 等）指 v2 的模型，与 v3 序列、轨道、实例的对应见[元素模型对照](element-model-mapping.md)与[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# BaoCut 白板手绘动画：旁白同步与文字生成（设计稿）

> 状态：**P0 + P1 已落地 2026-09-18**（core：`bcutTimeline` 0.9、`bcut-render` natural / strict、`bcut whiteboard sync`、`plan` / `probe` 扩展、`transcribe --script`；App v2：属性页「节奏」/「每拍」/「分区」/「按旁白重新对齐」、时间轴拍点与定格纹、新建项目页磁贴文案；skill 与参考文档同步；Web 只读 0.9、有意不做属性页）。P2 笔迹质量未做。P3 BCF 路线词级锚定已落地 2026-09-23（§4 BCF 分支、§12）。原型先行 `cf9fa53ee`。审查基准 `main @ 17e329814`。
> 本文是 [`bcut-whiteboard-animation-design.md`](bcut-whiteboard-animation-design.md) 的续篇：修订 ADR-WB05 的时序语义，
> 给 `beats` 补显式窗口与词锚点，把已有的本地 TTS 与强制对齐接成「文字 → 白板视频」入口。
> 来源：用户 2026-09-17 的方案稿《旁白同步与文字生成视频技术方案》（下称「方案稿」），以及四个参考仓库
> `hi-nikola/hand-drawn-explainer-video-nikola`、`geeklee/srt-whiteboard-animation`、`ChenShuo2004/cs-board`、
> `masihsultani/whiteboard-animator`（审查结论见 §2，对方案稿的修正见 §3）。

## 0. 一句话

两个症状一个根：**镜与镜之间已经跟着句子走，镜内画多快仍由图片几何决定**。缺省画时
`min(0.8 × 时长, 自然画时)` 让简单图几秒画完、剩下十几秒静止；skill 又不写 `draw` / `beats`，
把这个缺省当成了成品。修法分三层：作者层立刻显式写「按旁白算出来的」画时与节拍（不改格式、不动老项目）；
格式层给 `beats` 补显式结束、词锚点与「自然速度画完后定格」的节奏，让节拍随转录自动重排；
入口层把 `bcut tts` → 建项 → 已知文本强制对齐 → 分镜 接成一条链，文字也能直接出白板视频。
目标是「讲到哪里，画面推进到哪里」，不是「每一帧都得有东西动」。

## 1. 现状核查（与代码对过）

| 事实 | 位置 | 后果 |
| --- | --- | --- |
| 缺省画时 `draw = min(0.8 × 时长, natural)`，再 `max(0.1)` | `bcut-timeline-render::element::whiteboard_draw_seconds` | 时长越长、图越简单，静止越久 |
| 自然画时 `(路径长 / 900 + 连通域 × 0.25).clamp(1, 15)` | `bcut-render::source::whiteboard::natural_draw_seconds` | 简单图 1–4 s 画完；上限 15 s 也罩不住 20 s 的镜 |
| 进度 `((t − start) / draw).clamp(0, 1)`，原点固定在元素 `start` | 同 `element.rs` | 有前导静音时 `draw` 必须从元素起点量起 |
| `beats[].at` 换算成 `at / draw` 再 clamp 到 1 | `element.rs::whiteboard_params` | 拍点晚于 `draw` 会被静默压成零宽窗 |
| beats 只是分组 + 起点：质心落入第一个 box、否则最近 box；组窗 `[at_g, at_{g+1}]`，末组到 `draw`；组内 √面积分配、墨线 0.7 / 色块 0.3 | `whiteboard.rs::analyze` / `group_window` | 组窗撑满（stretch）：窗长笔迹少就慢爬；没有停留概念；一条连线可把两个对象连成一个连通域提前泄露 |
| `plan` 每镜给 `start/end`（首尾相接）、`speechStart/speechEnd`、`sentenceIds`、`text`、`hint`；`probe` 给 `inkRatio/components/suggestedDraw/warnings/suitable` | `bcut-kernel::cmd::whiteboard` | 镜间已按句子切；缺「镜内哪个对象对应哪句」 |
| skill 第 4 步写「`suggestedDraw` 仅供参考、不必手工设置」，第 5 步 `element add` 不写 `draw` / `beats` | `skills/bcut-whiteboard-video/SKILL.md` | 每个新项目都落进缺省分支 |
| 三处同口径画时：`bcut-editor-core::whiteboard_lane::effective_draw`、App `engine/whiteboard_strip.rs`、原型 `model-whiteboard.js::effectiveDraw` | 时间轴画时带 / 缩略条 / 原型 | 改语义必须三处同改 |
| `bcut tts` 出 WAV；`TtsAudio { samples, sample_rate }` 无词级时间戳 | `bcut-tts`、`bcut-cli-server-reference/06/bcut-tts.md` | 时间戳要靠对齐，不靠 TTS |
| `ForcedAlignment::{align, align_long}` 已有；配音服务 `TimingRuntime::measure` 已经在「TTS 输出 + 已知文本 → VAD + 强制对齐」 | `bcut-speech-core::traits`、`bcut-kernel::services::dubbing::acoustic_timing` | 文字入口不必新建对齐引擎，直接复用 |
| 元素 `start` / `end` 已接受词锚点 `~<source>:<wordId>:start\|end±偏移`（`TimeValue::Anchor`），渲染宿主逐元素解析并报 `word-anchor-missing / cut / unmapped / ambiguous` | `bcut-timeline::anchors`、`bcut-subtitle-render::host_support` | 节拍跟随转录的机制**已经存在**，只是 `beats[].at` 还没用上 |
| 词 id 由 flow 构建时按序号生成 `w{index+1}` | `bcut-flow-core` | 同一份文稿重对齐得到同样的 id；文稿一变 id 就漂 |
| 源时间 → 输出时间投影 `TimelineProjection::source_to_timeline`（`arrange.rs`）/ `clamp_source_event`（`map.rs`） | `bcut-timeline` | 转录秒数不能直接塞 `beats.at`，要先投影再减元素起点 |

方案稿 §1 的代码核查（[B1]–[B11]）与仓库一致，本文不重复。它漏掉的两项现成能力是上表最后四行：
**词锚点**与 **`TimingRuntime`**，这两项决定了 §3 的多处修正。

## 2. 四个参考仓库审查

| 仓库 | 时间从哪来 | 镜内节奏模型 | 借 | 不借 |
| --- | --- | --- | --- | --- |
| nikola | 先复用 / 生成完整旁白，真实音频出 SRT，再按区域分 `startMs/durationMs` | 拉伸到区域窗；「笔迹仍过快就拆幕，不加快笔」 | 顺序纪律（声音先于排时）；4–8 s 一幕、拆幕优先；`check_drawable_regions` 的重叠 / 留白 / 跨区连通检查；`hand-follow` 只平滑手不改笔迹 | 火山 TTS 默认音色、Python 渲染器、HyperFrames 程序动画路线 |
| srt-whiteboard-animation | `annotation.json` 每区域 `sequence/startMs/durationMs/region/protectedRegions/subtitle` | 拉伸到区域窗；墨 : 色 = 2 : 1；结尾 ≥ 0.5 s 停留 | **允许掩码 = 本区域扣后续区域与保护区**；未开始的区域完全不可见；一支笔串行；已画内容常驻 | 状态化画布（依赖上一帧）；把 regions 持久化进项目 |
| cs-board | Whisper.cpp DTW 先出完整短语时间表；模型只引用短语 id；程序算 ms → 帧（`ceil` 到 30 fps）；覆盖率 < 72% 拒绝；禁均分兜底 | 事件驱动，非逐笔 | **模型选锚点、程序算秒**；对齐不足要报错不要假装 | Remotion / 30 fps 固定 / 72% 阈值 |
| whiteboard-animator | 默认前 70% 画完；region plan 用字符占比 70% + 面积 30% 估算，不做语音对齐；`element_plan` 才收显式 `start/end` | **自然时长画完后 hold，不拉伸笔迹**（`_schedule_semantic_objects`：`natural = 0.28 + √面积 / 190`，窗不够才整体压缩）；跨元素的结构性连通域归最早的元素；未匹配的连通域并入末元素，「一个都不能跳」 | 自然速度 + 定格的镜内模型；√面积、骨架、笔画分解；跨区连通域归属规则 | 70% / 75% 缺省与字数估时；OpenCV 离线烘片 |

四家分成两派：nikola / srt 把笔迹**拉伸**到旁白窗，whiteboard-animator 按**自然速度画完再定格**。
方案稿 §2.4 只看到 whiteboard-animator 的 70% 缺省不做对齐，漏掉了它底层这条「自然长度 + hold」——
恰恰是镜内该用的模型：窗口由旁白定（借 srt / cs-board），窗内按自然速度画、画完停住（借 whiteboard-animator），
窗装不下才压缩并报警（借 nikola 的「拆幕优先于加快笔」）。BaoCut 现状是「组窗撑满」的拉伸派，
所以简单图配长句会慢爬，复杂图配短句会赶工，两头都不自然。

## 3. 对方案稿的审查结论

保留的：三递进（作者层显式写 → 语义绑定 → 硬遮罩与笔迹）、不改历史项目缺省、三个时钟不混用、
「完成点 = min(scene.end, speechEnd)、draw 从元素起点量」的公式、诊断思路、测试矩阵、不用 `bcut frames` 验收、
不引 Remotion / Python 渲染器与第二套 TTS。以下是修正：

| 方案稿 | 问题 | 修正 |
| --- | --- | --- |
| §6.5 另建「作者层清单」（`authoringVersion / narration.audioSha256 / transcriptRevision / startAnchor.wordId`）+ 编译缓存 | 仓库已有词锚点语法与解析器、错误码、渲染宿主接线；再造一层清单 + 缓存 = 两份时间真相、一套新文件所有权 | `beats[].at` / `beats[].end` 直接接受 `TimeValue`（秒或 `~main:w12:start` 这种词锚点），解析复用 `resolve_word_anchor`；「配音换了自动重排」由锚点天然给出（§5、§10） |
| §8.3 新增 `regions[]` 分支，与 `draw/beats` 互斥 | 两条格式分支、两套渲染路径、属性页两种 UI；互斥规则本身就是「两套真相」的承认 | 对 `beats` 做增量扩展：`end`（显式结束）、元素级 `pace`（stretch / natural）、`strict`（硬遮罩）、`label`；老字段语义不变（§5） |
| §5.2 `displayText / spokenText / textMap` 三概念 | 本地 TTS 直接朗读原稿，skill 不改写读音；三概念是为「读稿 ≠ 显示稿」准备的，P1 用不上 | P1 规则「原稿即读稿」：`bcut tts` 与强制对齐吃同一份文本；要改读音只能改原稿。`textMap` 留到真有需求时（§13） |
| §1.5 / §11 「补已知文本的可复用编排服务」 | 已存在：配音的 `TimingRuntime::measure(samples, expected)` | 抽成 `bcut transcribe <project> --script <文件>`：已知文本强制对齐直接落 transcript，不跑 ASR（§7.3） |
| §7.1 白板流程加「文字 / 音频 / 当前文字稿」三来源面板 | 产品设计 §08 已裁决：新建项目页「白板教学动画」磁贴 → Agent + `bcut-whiteboard-video` skill；2026-09-14 裁决白板目录分节暂不上架 | 文字入口就是那张磁贴 + skill 的文字路线；App 不新造白板面板。编辑期入口只加属性页一枚「按旁白重新对齐」（§9） |
| §4.2 公式 | 正确，但少三条边界：`plan` 的 `end` 已含到下一句的空隙；纯静音镜；`draw > 时长` 按格式规则截断 | §6.1 补齐；`sync` 与 `lint` 校验 `at < end ≤ draw ≤ 时长`，不靠 `at / draw` 的 clamp |
| §6.2 `resolve_narration_anchors / schedule_whiteboard_scene` 两个新纯函数 | 前者 = `resolve_word_anchor` + 减元素起点；后者应落在既有 `analyze()` 里而不是新层 | 只加一个 `bcut whiteboard sync`（§7.4）和 `analyze()` 的 `pace/strict` 分支（§6） |
| §10.3 诊断名 camelCase、`staleNarrationBinding` | 仓库校验码惯例是 kebab-case；锚点失效已有 `word-anchor-*` 码 | §10 诊断码合流；「配音变了排时没变」= 锚点缺失或 `label` 与词文本不符，不另设一码 |
| §12 P0 「现有 TTS → 建项 → 转录 → 白板链路整合到同一入口」 | 今天 `bcut transcribe` 只有 ASR 路径；ASR 回写会改原稿标点与错字 | P0 允许 ASR 路径先跑通（文稿以 ASR 为准）；P1 上 `--script` 后 skill 切换 |
| §7.2 编辑器左 / 中 / 右 三栏联动 | 白板元素是 Timeline 的普通元素，编辑器没有「白板模式」 | 属性页节拍列表显示 `label` + 句时间、点击定位；不做专属三栏（§9） |

## 4. 架构：一条旁白准备链，三个时钟

```text
文字 ──bcut tts──► narration.wav ─┐
                                  ├─► project create --media --ptype a2v
音频 / 视频 ──────────────────────┘
                                  │
        已知文本 ── transcribe --script（强制对齐，P1）
        未知文本 ── transcribe（ASR，今天可用）
                                  ▼
                 transcript.json（words[] 唯一真相，id = w1, w2 …）
                                  │
        bcut whiteboard plan ─────► 分镜（每镜 sentenceIds + 词锚点 + 画时预算）
        Agent 出图 → probe ──────► 连通域包围盒（阅读序）
        Agent 把对象映到 box ────► beats（at/end 写词锚点，box 写百分比）
        bcut whiteboard sync ────► 写 draw / pace / beats 进元素（或只 --check 出诊断）
                                  ▼
        预览 / 缩略条 / 导出：同一 analyze() + whiteboard_frame(t)

BCF 手绘分支（无线稿位图时 skill 走这条，P3，2026-09-23）：

文字（清单 out/vo.json）
  └─ bcut tts --batch --align ──► assets/vo/<段>.wav + out/vo.json.words.json（段内词 / 句时刻，同一只强制对齐器）
       └─ @baocut/dsl narration()：place → cue / end / sceneDur / clips（场景内秒）
            └─ bcut lint narration-idle ──► 成片 ──► transcribe --script 台词稿 ──► 项目字幕轨
```

三个时钟（沿方案稿 §3.1）：**源时间**（WAV 采样位置、transcript 秒）→ **输出时间**（经
`TimelineProjection`，含裁切 / 变速 / 同源多次使用）→ **元素本地时间**（减元素 `start`）。
词锚点解析产出的是输出时间，`beats` 语义是元素本地时间，所以「锚点形式的 `at`」= 解析值 − 解析后的元素起点。
同一源在时间轴上出现两次时 `resolve_word_anchor` 返回 `word-anchor-ambiguous`，`sync` 照实报错，不猜。

音频仍可编辑（裁停顿、换音色、变速）：锚点跟着 `TimelineProjection` 走；文稿变了 id 漂，
靠 `label` 对拍发现（§10）。禁止为了「看起来同步」截声、加速或补静音。

## 5. 数据格式：`bcutTimeline` 0.8 → 0.9（全部可选、向后兼容）

```jsonc
"whiteboard": {
  "hand": "marker", "paper": "#FFFFFF",
  "draw": 12.0,                 // 不变：元素起点到全图完成的本地秒；缺省公式不变（老项目不变）
  "inkFirst": true,
  "pace": "natural",            // 新：stretch（缺省 = 现状，组窗撑满）| natural（自然速度画完后定格）
  "strict": true,               // 新：box 是硬遮罩（本 box 扣后续 box）；缺省 false = 现状的质心分组
  "beats": [
    { "at": "~main:w12:start", "end": "~main:w18:end", "box": [0, 0, 30, 100], "label": "太阳升起" },
    { "at": 4.1,               "end": 7.8,             "box": [35, 0, 30, 100] },
    { "at": "~main:w31:start",                         "box": [70, 0, 30, 100] }
  ]
}
```

规则（在 §3 原规则之上）：

- `beats[].at`、`beats[].end` 是 `TimeValue`：数字 = 元素本地秒；字符串 = 词锚点，解析后减元素起点。
  同一元素里两种写法可以混用。`end` 缺省 = 下一拍的 `at`，末拍缺省 = `draw`。
- 校验：解析后 `at_g < end_g ≤ at_{g+1}`（新码 `whiteboard-beat-window`），`end_末 ≤ draw ≤ 时长`
  （`whiteboard-beat-after-draw`）；锚点无法解析时沿用 `word-anchor-*` 码并报到 `elementId + field`（`beats[3].at`）。
  渲染宿主对解析失败的拍**整拍降级为几何顺序**并记错，不让整个元素消失。
- `pace:"natural"`：每组按自然速度画（§6.2），画完停到组窗结束；自然时长 > 组窗时压缩到组窗并出
  `whiteboard-window-too-short`。`stretch` 完全等于 0.8 的行为。
- `strict:true`：像素归属按 box 顺序决定，**重叠部分归后面的拍**（srt 规则：先画的区域不能提前露出后画的内容）；
  跨 box 的连通域按像素切开，各自在所属拍内做测地时间场；未被任何 box 覆盖的前景排到末拍之后
  （`whiteboard-unassigned-foreground`，warning）；扣空的 box 出 `whiteboard-empty-box`。`false` = 现状。
- `label` ≤ 80 字符，只做展示与对拍，不参与渲染。
- 版本：读 0.1–0.9，写 0.9；`specVersion` 相应 bump；`docs/generated/` 重新生成；
  JSON schema `$defs.whiteboardProps` 同步。0.8 文档不含新字段，读入即 0.9 语义（缺省值 = 老行为）。

不做的：不加 `regions` 分支（§3）；`draw` 不接受锚点（完成点由 `sync` 算成数字写入，一处真相）；
不加每拍独立 `draw`（原设计 §9 的开放问题由 `end` + `pace` 收口）。

## 6. 渲染算法变化（`bcut-render::source::whiteboard`）

### 6.1 组窗与完成点

- 组窗 `W_g = [at_g, end_g]`（§5 缺省规则），仍在 `[0, draw]` 内；`draw` 仍是唯一完成点。
- 无 beats：不变。
- `sync` 写入的 `draw = min(元素 end, 最后一句 end) − 元素 start`；首拍 `at = 首句 start − 元素 start`；
  纯静音镜（无句子落在窗内）不写 beats，`draw` 取自然画时（等于今天的行为）。

### 6.2 `pace:"natural"` 的组内分配

```text
natural_g = Σ_i(path_len_i / 900) + comps_g × 0.25          // 与 natural_draw_seconds 同口径，不再 clamp [1,15]
draw_g    = min(natural_g, |W_g|)                           // 装不下就压缩，报 window-too-short
组内：墨线占 [at_g, at_g + 0.7·draw_g]，色块占其后（inkFirst 时），√面积份额同 0.8
hold：[at_g + draw_g, end_g] 该组静止，手抬起（不画手或停在末笔）
```

组与组之间是抬笔阶段，手的位置从上一组末笔移到下一组首笔（线性，只是显示，不改落墨时间）。
`stretch` 保持 0.8 的公式一字不改，老项目逐字节不变（§11 对拍）。

### 6.3 `strict:true` 的像素归属

分析步骤 3（连通域）之后、步骤 4（排序）之前插入「所有权」：按拍顺序为每个像素标 owner
（后拍覆盖前拍），连通域被切成 `(域, owner)` 子域；步骤 5–6 在子域上做。膨胀 3 px 不得跨 owner 边界。
手位置仍取「刚显现像素质心」，因为子域已限定在 box 内，跨对象跳动消失。

### 6.4 记忆化键

`(source_id, 盒尺寸, props 哈希)` 不变；`pace / strict / beats.end / label` 进 props 哈希
（`label` 可以排除，避免改标签重算）。锚点形式的 `at/end` 在宿主解析成秒后再进哈希——转录一变，键自然失效。

## 7. CLI（`bcut whiteboard` 一条命令，四个子命令）

改哪条都同步 [`06/bcut-whiteboard.md`](../cli/bcut-cli-server-reference/06/bcut-whiteboard.md)、`serve_contract.rs`（如经 serve 暴露）与 `bcut spec`。

### 7.1 `plan`（扩展输出）

每镜增加：

```jsonc
{
  "start": 20.0, "end": 32.5, "speechStart": 20.2, "speechEnd": 32.0,
  "drawBudget": 12.0,                          // = min(end, speechEnd) − start；与 probe 的 suggestedDraw（自然画时）区分
  "anchors": { "start": "~main:w101:start", "speechEnd": "~main:w140:end" },
  "sentences": [                               // 本镜每句：给 Agent 映射对象用
    { "id": "s-w101", "text": "…", "localStart": 0.2, "localEnd": 3.9,
      "at": "~main:w101:start", "end": "~main:w108:end" }
  ]
}
```

`localStart/localEnd` 已经过 `TimelineProjection` 投影并减去 `start`；`at/end` 是可直接写进 `beats` 的锚点串。
镜的切法不变（`--seconds` 每镜目标 12 s、`--scenes` ≤ 64、句中不切）。加 `--max-seconds <N>` 硬上限：超过的镜按句拆，
落实 nikola 的「拆幕优先于加快笔」。

### 7.2 `probe`（扩展输出）

增 `boxes[]`：连通域按阅读序的包围盒（百分比 `[x,y,w,h]`）、`area`、`kind`（ink / color）、`natural`（秒）。
Agent 据此把「太阳 / 树叶 / 箭头」映到 box，不再靠肉眼估百分比。`suggestedDraw` 含义不变（自然画时），
文档改口为「几何参考，不是画时缺省」。

### 7.3 `bcut transcribe <project> --script <文件>`（P1，属于 transcribe 而不是 whiteboard）

已知文本 → 强制对齐 → transcript：复用 `TimingRuntime`（SileroVad + ForcedAligner，`align_long` 分块，
块偏移取最终 WAV 的真实采样位置），词落盘走 flow 的 build 路径，id 仍是 `w{index+1}`，
`--source-lang` 决定分词。与 `--model` 互斥；重做需 `--yes`。对齐质量记进阶段戳
（`aligned: { mode: "script", coverage, lowConfidence[] }`），覆盖率不足**报错退出**而不是回退均分（cs-board 规则）。
它对配音、任何「有稿的音频」都有用，不是白板专属。

### 7.4 `bcut whiteboard sync <project> [--element <id>…] [--beats <json>] [--pace natural|stretch] [--strict] [--check] [--yes] [--json]`

对每个白板元素（缺省全部，`--element` 筛选）：

1. 取元素窗内的句子（投影后），算 `draw`、首拍 `at`（§6.1）。
2. 有 `--beats`（Agent 给的 `{ elementId: [{ sentenceId | at, box, label? }] }`）：按句写 `at/end` 锚点 + box。
   没有：只写 `draw` + `pace`，并按**阅读序连通域累计 √面积 ∝ 句字数**把 box 分给句子，
   报 `whiteboard-beats-heuristic`（warning）——这是「对象 → 句」的兜底映射，时间仍来自真实语音，
   不是 cs-board 禁止的「均分时间」。
3. 校验 §5 规则，写回走 `element set` 同一写路径（可撤销、`docRev` 推进）。
4. `--check` 不写，只输出诊断（§10），作为「分析同步问题」。

P0 时格式还是 0.8，`sync` 写数字而非锚点；0.9 落地后缺省写锚点，`--seconds` 可强制写数字。

## 8. skill `bcut-whiteboard-video` 修改

- 输入扩为三种：音频 / 视频（现状）、**文字稿**（`bcut tts --text-file … --out narration.wav` → `project create --media narration.wav --ptype a2v` → P1 `transcribe --script`，P0 先 `transcribe`）、已有项目。
  音色 / 模型 / 语言全部沿用 `bcut tts` 的现有参数与模型表，不在 skill 里列音色。
- 第 2 步分镜：读 `drawBudget` 与 `sentences[]`；一镜超过约 15 s 或一句要画三个以上对象时拆镜（`--max-seconds`）。
- 第 3 步出图提示词加「对象之间留白、不用连线把对象连起来、每个对象独立成块」——为 box 划分与 `strict` 铺路。
- 第 4 步 `probe`：读 `boxes[]`，Agent 把本镜每句对应的对象映到 box，写成 `--beats` 文件；`suitable:false` 仍重画。
- 第 5 步入时间轴后**必须** `sync`：`bcut whiteboard sync <project> --element <id> --beats beats.json --pace natural --strict`
  （P0：`--beats` 给秒，不带 `--pace/--strict`）。删掉「不必手工设置」那句。
- 第 6 步核对：`sync --check` 无 error 级诊断 + 抽成片帧看三处（首句起笔、一次跨拍、末句完成）。
- 最小披露：只写命令与输入输出，不写 0.7 / 900 / 0.25 这些常数。

## 9. 三表面

按「多表面同步」规则，原型与 App v2 同批；Web 沿 2026-09-11 裁决不做（wasm 只保证读 0.9 不报错、按普通图片回退）。

| 表面 | 属性页 | 时间轴 | 其他 |
| --- | --- | --- | --- |
| 原型 `designs/baocut` | `panel-element-whiteboard.jsx`：画时段加「节奏」三档只读徽标（**跟随旁白** = beats 含锚点 / **自然速度** = 无 `draw` / **手动** = 手填 `draw`）；节拍列表显示 `label` + 本地起止；按钮「按旁白重新对齐」（演示态只弹 toast） | `timeline-whiteboard.jsx` 画时带上加拍点刻度；`model-whiteboard.js` 补 `pace` / `strict` / `end` / `label` 与校验，`effectiveDraw` 不变 | 变更记录 + 台账；product-design §14.4 / §12.6 改文案 |
| App v2 `apps/baocut` | `elements/panel.rs` 同上；「按旁白重新对齐」→ 内核 `whiteboard sync --element`，走元素补丁的现有写路径（可撤销、外部写检测照旧）；`--check` 结果以 toast / 面板小字显示 | `timeline/whiteboard.rs` 拍点刻度；`whiteboard_strip.rs` 的缩略条键含 `pace/strict/end`；`whiteboard_lane::effective_draw` 不变 | 新建项目页「白板教学动画」磁贴文案改为「一段文字或一段音频…」；i18n 15 语 |
| Web `apps/web` | 不做 | 不做 | 台账登记 |

## 10. 诊断码（`sync --check` / `lint` / 渲染宿主共用）

| 码 | 级别 | 含义 |
| --- | --- | --- |
| `whiteboard-speech-without-progress` | warning | 元素窗内有语音、连续 ≥ 1.5 s 没有揭示推进且不在任何拍的 hold 段（阈值先当实验值，用真实项目校准） |
| `whiteboard-window-too-short` | warning | 某拍自然时长 > 组窗（被压缩） |
| `whiteboard-beat-window` / `whiteboard-beat-after-draw` | error | §5 时序校验失败 |
| `word-anchor-missing / cut / unmapped / ambiguous` | error | 沿用；附 `elementId` 与 `beats[i].at|end` |
| `whiteboard-label-mismatch` | warning | `label` 与锚点词所在句文本不符——文稿变了、id 漂了 |
| `whiteboard-unassigned-foreground` / `whiteboard-empty-box` | warning | `strict` 下的归属问题 |
| `whiteboard-beats-heuristic` | warning | `sync` 没拿到 Agent 的对象映射，用了兜底 |
| `whiteboard-source-kind` / `element-props-mismatch` | error | 不变 |

「配音已换、排时未更」不单设码：同稿重对齐 id 不变 → 锚点自动跟随；稿变了 → `word-anchor-missing` 或 `label-mismatch`。

## 11. 对拍与测试

- `bcut-timeline`：0.9 往返；`beats.at/end` 两种写法与混用；校验码；0.8 文档读入后再写出与 0.9 缺省等价。
- `bcut-render`：(a) 0.8 fixture 在 `pace:"stretch"` 下逐字节不变；(b) `natural` 下 `frame(at_g + draw_g) == frame(end_g)`（hold 段稳定）且 `draw_g ≤ |W_g|`；(c) `strict` 下一条连线跨两个 box，第二拍开始前第二 box 内像素全透明；(d) 重叠归后拍；(e) 未覆盖前景排末尾。
- `bcut-timeline-render`：复现「12 s 镜、自然画时 4 s」缺省提前定格的回归测试；`sync` 写入后完成点 = `speechEnd`。
- `bcut-kernel`：`plan` 的 `drawBudget/anchors/sentences` 投影正确（含裁切、变速、同源两次 → ambiguous）；`sync --check` 诊断矩阵；`transcribe --script` 覆盖率门槛。
- 三表面：`whiteboard_lane` / `whiteboard_strip` / `model-whiteboard.test.js` 补 `pace/end` 用例；App 属性页快照钩子。
- 端到端：一段 60 s 文字 → `tts` → 建项 → 对齐 → 6 镜 → `sync --pace natural --strict` → 导出；检查首句起笔时刻、每句完成点、末句完整；乱序 seek 像素一致。
- 验收矩阵沿方案稿 §10.4，改三行：「新 regions」→「`strict` + `end`」；「staleNarrationBinding」→「同稿重对齐 id 不变 / 改稿报 missing 或 label-mismatch」；「换音色只让对齐失效」→ 记忆化键只含解析后的秒。

## 12. 分阶段

| 阶段 | 内容 | 格式 | 完成定义 |
| --- | --- | --- | --- |
| P0 作者层止血 | skill 三种输入 + 必写 `sync`；`plan` 加 `drawBudget/sentences`；`probe` 加 `boxes`；`bcut whiteboard sync`（写秒）；缺省公式回归测试；参考文档 | 0.8 不变 | 新流程的镜不再被自然画时截短；文字稿经 `tts` + ASR 路径能出成片；老项目零变化 |
| P1 格式与对齐 | 0.9：`pace/strict/end/label` + 锚点 `at/end`；`analyze()` natural / strict 分支；`transcribe --script`；`sync` 写锚点 + `--check`；属性页「节奏」+「按旁白重新对齐」+ 拍点刻度（原型 + App）；product-design §14.4 / §12.6 | 0.9 | 换音色 / 语速后 `sync` 复用图片重排；改稿能被诊断；`strict` 下无提前泄露；乱序 seek 一致 |
| P2 笔迹质量 | 骨架 / 端点路径替代扩散感揭示；抬笔手轨迹预计算；多边形 / alpha mask；如确有读稿 ≠ 显示稿的需求再做 `textMap` | 0.9+ | 观感，不影响时序 |
| P3 BCF 路线词级锚定（2026-09-23） | `bcut tts --align` 写 `<清单>.words.json`（`457469e95`，spec 1.191.0）；`@baocut/dsl` `narration()`（`core/runtime/dsl/bcf.tsx`）与 `bcut-core` lint `narration-idle`（`b1bf5f574`，spec 1.192.0）；skill `references/video/narration.md` 主路径、`create.md` / `qa.md` / `sketch.md` / `whiteboard.md`；总述见 [`bcut-whiteboard-animation-design.md`](bcut-whiteboard-animation-design.md) §10 | 不涉及 `bcutTimeline` | BCF 场景内每个画面动作锚到真实词时刻，缺 `words.json` 或短语对不上即编译错误；旁白在说、画面 > 4 s 不动由 lint 报出 |

顺序不能倒：先把时间依据和工作流立住，再做笔迹物理感。

## 13. 刻意不做

- 不改 `whiteboard_draw_seconds` 的缺省公式（老项目不变）；不把 0.8 改成 0.95 当方案。
- 不加 `regions` 分支、不加独立白板项目类型、不做白板专属三栏编辑器、不上架白板目录分节（2026-09-14 裁决不变）。
- 不用字数占比分配**时间**；不靠末帧延长、循环手抖、平移缩放、降帧率、`-shortest` 伪装同步。
- 不引 Remotion / Python / Chromium 渲染器、第二套 TTS、OCR。
- 不做 `displayText / spokenText / textMap`（P1 原稿即读稿）；不做 `TtsAudio` 词级时间戳（对齐负责）。
- 不用 `bcut frames` 验收（不含元素层）。

## 14. 来源

- 方案稿：用户 2026-09-17《BaoCut 白板手绘动画：旁白同步与文字生成视频技术方案》（基准 `main @ 17e329814`），其 [B1]–[B11] 代码引用已逐条核对。
- 仓库：`core/crates/bcut-timeline-render/src/element.rs`、`core/crates/bcut-render/src/source/whiteboard.rs`、`core/crates/bcut-kernel/src/cmd/whiteboard.rs`、`core/crates/bcut-timeline/src/{schema,anchors,arrange,map}.rs`、`core/crates/bcut-subtitle-render/src/host_support.rs`、`core/crates/bcut-kernel/src/services/dubbing/acoustic_timing.rs`、`core/crates/bcut-speech-core/src/{traits,refine}.rs`、`skills/bcut-whiteboard-video/SKILL.md`、[`product-design/08.md`](../product/product-design/08.md)、[`14/14.4.md`](../product/product-design/14/14.4.md)、[`12.md`](../product/product-design/12.md)。
- nikola `3ee5d1c0`：`SKILL.md`、`references/{voiceover,stroke-story-workflow,quality-and-delivery}.md`、`scripts/check_drawable_regions.py`、`vendor/srt-whiteboard-animation/scripts/render_stream_whiteboard.py`。
- srt-whiteboard-animation `696a724`：`SKILL.md`、`annotation.json` 契约。
- cs-board `e752abe`：`docs/semantic-timing-contract.md`、`scripts/semantic_timeline.py`。
- whiteboard-animator `e6e4dbc`：`README.md`、`whiteboard_animator/animator.py`（`_schedule_elements`、`_schedule_semantic_objects`）、`regions.py`。
