---
description: 时间线修改的机制：一笔修改的事务与版本、预检、按需查操作、常用操作的例子、内置的声波与进度条、剪口播的提案与剪口、章节、撤销与读回执。第一次改时间线之前读。
---

# 编辑：时间线上的修改

## 何时用

- 剪辑：放素材、裁切、拆分、挪动、删除、波纹删除、变速、转场。
- 剪口播：去口癖与长停顿、删掉录废的部分（剪口）。
- 章节、文字与元素、画面摆法与外观、效果、声音与闪避、画布尺寸。
- 旁白按段配、画面按段上时间线的片子：把制作计划（各段的代码包与旁白、实拍片段、卡片）一次放好，改了只动变了的（下面的「一次放好制作计划」）。
- 写文档（转写、译文）也是一笔修改：已有文档的局部修改用 {{tool:edits_apply}} 的文档操作，新建或整体替换用 {{tool:documents_put}}（见 [subtitles](subtitles.md)）；作者的章节用 {{tool:chapters_adopt}} 写进视频（见下面的「章节」）。

剪哪里、留哪句、停顿多长是 craft 的事：{{skill:talking-head-cut}}、{{skill:video-chapters}}、{{skill:shorts-segments}}。这一页只讲怎么提交、怎么读回执。

## 前置检查

- {{tool:videos_inspect}} 拿当前版本（`revision`）与对象 ID（轨道、片段、素材、文档）。片段多时用 {{arg:fromSeconds}} / {{arg:toSeconds}} 读一段。
- 分清两种时钟：移动、裁切、拆分、波纹删除、章节用**时间线上的秒**；剪口（`addCuts`）用**素材自己的秒**。换算见 [conventions](../conventions.md) 的「时间」。
- 锁定的片段与轨道不能改；要动先问用户。

## 命令与例子

### 一笔修改：{{tool:edits_apply}}

- {{arg:operations}} 是按顺序执行的操作数组；**全部成功才提交**，任何一步失败整笔不生效、视频不变。
- {{arg:expectedRevision}} 带上 {{tool:videos_inspect}} 或上一次回执的版本；不一致时拒绝（`PROJECT_REVISION_CONFLICT`）。
- {{arg:label}} 写一句简短说明，显示在历史与撤销里（例如「删掉开头的寒暄」）。
- 相关的几步放进同一笔：用户说「不要那一批」时一次撤销就退回去。同一笔里后面的操作可以用 `ref` 引用前面 `importAsset` 导入的素材。
- 时间写秒数（`1.5`），也可以写 `{"unit":"frames","value":30}`。

已有文档只修改局部时用 `renameSpeakers`（姓名）、`updateWords`（词文本）或 `patchDocument`（字幕、译文、章节、换行、样式等）。先用 {{tool:edits_ops}} 查询操作格式，按稳定 ID 提交变化，保持 `expectedRevision` 与编辑依据一致。不要为改几个名字或校订几个词上传整份文稿；`putDocument` 留给新建或整体替换。

### 先预检

不确定操作写得对不对、会影响多少时，先给 {{tool:edits_apply}} 带上 {{arg:dryRun}} 提交一次：形态、参数、引用的对象与文件、版本对不上时与真正提交报同样的错，通过时返回补全后的操作与影响（`committed: false`），视频不变、不进历史。同轨重叠、锁定与任务保护只有真正提交时才知道。

### 按需查操作：{{tool:edits_ops}}

不要背操作清单，也不要一次拉全部。要用哪个操作就只查那一个：{{tool:edits_ops}} 给 {{arg:op}}（如 `removeRange`），返回它的说明、参数的 JSON Schema 与一个示例。
<!-- surface: cli -->
同样的内容也可以 `baocut spec edits.<操作>` 取。
<!-- /surface -->

操作族一览（字段一律按需查）：

| 族 | 操作 | 做什么 |
| --- | --- | --- |
| 素材 | `importAsset`、`collectAssets` | 登记素材（链接或复制进视频）；把链接的素材收进视频 |
| 片段 | `addItem`、`moveItem`、`moveItems`、`trimItem`、`splitItem`、`joinItems`、`deleteItems`、`updateItem` | 放上时间线、挪、裁、拆、合、删（留空隙）、改名与启用、跟随策略 |
| 波纹 | `removeRange`、`insertRange` | 删掉一段时间并让后面的前移，或空出一段时间让后面的后移；要一起动的配音、字幕轨都要列上 |
| 画面 | `setTransform`、`setStyle`、`setEffects`、`setSpeed` | 位置与大小、铺满或画中画、裁切与外观、调色与效果、恒定变速 |
| 文字 | `setText` | 改文字片段的文字或改成计时读数 |
| 声音 | `setAudioMix`、`setDucking`、`removeDucking` | 音量、静音、淡入淡出；人声响起时压低配乐 |
| 转场 | `setTransition`、`removeTransition` | 片段之间或单侧的转场 |
| 章节 | `setChapters`、`upsertChapter`、`removeChapter` | 整个替换或逐章修改章节 |
| 剪口 | `proposeCuts`、`acceptCutSuggestions`、`addCuts`、`restoreCut` | 生成口癖与停顿的剪辑提案、接受建议、直接剪、恢复 |
| 轨道与画布 | `addTrack`、`updateTrack`、`updateSequence` | 加轨道、锁定与隐藏、画布尺寸与底色 |
| 文档与历史 | `patchDocument`、`renameSpeakers`、`updateWords`、`putDocument`、`createCheckpoint`、`renameVideo`、`setVideoBrief` | 写文档、留检查点、改视频名、写视频速览 |

常用操作（由目录生成）：

<!-- generated: common-ops -->
**导入素材**（`importAsset`）：把媒体文件登记为视频的素材。

```json
{"type":"importAsset","path":"demo.mp4","ref":"clip"}
```

**放素材**（`addItem`）：把素材放到时间线上；省略 at 时接在轨道末尾，省略 trackId 时用第一条未锁定的同类轨道（视频、图片放视觉轨，音频放音频轨）。

```json
{"type":"addItem","asset":{"ref":"clip"},"at":1}
```

**裁剪**（`trimItem`）：裁切片段的开头或结尾，at 是这条边在时间线上的新位置。

```json
{"type":"trimItem","itemId":"item_1","edge":"end","at":8}
```

**挪动**（`moveItem`）：移动片段；at 是新的开始时间，offset 是相对移动（可为负），二选一。

```json
{"type":"moveItem","itemId":"item_1","at":5}
```

**删除**（`deleteItems`）：删除片段（不移动其他片段，留下空隙）。

```json
{"type":"deleteItems","itemIds":["item_1"]}
```

**分割**（`splitItem`）：在时间线上的这个位置把片段一分为二；关键帧按两半各自的窗口分开，裁切时关键帧跟着内容走。

```json
{"type":"splitItem","itemId":"item_1","at":3.5}
```

**调音量**（`setAudioMix`）：改音频、视频或有声合成的声音；volume 是线性倍数，在 0 到 4，1 为原音量（0.5 约 -6 dB，2 约 +6 dB）；淡变 0 表示去掉。

```json
{"type":"setAudioMix","itemId":"item_1","volume":0.5,"fadeOut":1}
```

**改文字**（`setText`）：改文字片段的文字，或改成计时读数；两者只给一个。

```json
{"type":"setText","itemId":"item_1","text":"第一章"}
```

字幕层用 {{tool:captions_create}} 建，不是这里的操作；剪掉一段并让后面前移用 `removeRange`，空出一段让后面后移用 `insertRange`，口播的剪口用 `addCuts`。其余操作与每个字段的写法用 {{tool:edits_ops}} 取。
<!-- /generated -->

### 一次放好制作计划：{{tool:edits_assemble}}

旁白按段配、画面按段上时间线的片子（讲解、解说混剪、旁白片）不用一段一段 `importAsset` 与 {{tool:compositions_import}}：把制作计划写成 {{arg:plan}}，或 {{arg:planFile}} 指向一份 JSON（里面的相对路径按它所在目录解析），一次放好。

- **段落**（`segments`）按播放顺序：每段一个代码包目录（包的长度就是段长），可带旁白（`narration` 给音频文件或配音产物的 `artifactId`）与对齐结果（`timing`：`{ lines: [{ text, start, chars? }], gaps? }` 或它的 JSON 路径，秒数从段首算）。段按整帧首尾相接放在 Scenes 轨，旁白在段首放在 Narration 轨；轨道按 `tracks` 给名字或 ID，没有就建。
- **实拍片段**（`clips`）属于某一段，起点按句子（`line`，加 `cue` 对到句里几个字被说到的时刻）、留白（`gap`，对到 `timing.gaps` 里给它留的那段）、紧跟上一个片段（`follow`）或段内秒数（`at`）定，截在本段下一个片段或段尾。`from`、`to` 是素材自己的秒（图片只有 `to`，当时长）；`audio` 留原声或给音量；`fit`、`crop`、`pip`（画中画）、单侧转场 `in`、`out`。{{arg:footageLayer}} 为 `under` 时实拍轨挪到 Scenes 下面当底，代码包要透明。
- **卡片**（`cards`）是透明代码包，按 `line` + `cue` 或 `at` 放在最上面的 Cards 轨，长度就是包的长度。
- **水印**（`watermarks`）是图片，`dur` 秒长：属于某一段时按 `line` + `cue` 或段内 `at` 定起点，不带 `seg` 时 `at` 是整片的秒；`pip` 给位置与宽度（不给就铺满），放在最上面的 Watermark 轨，彼此不能重叠，越过最后一段的尾巴截掉并给警告。
- 先带 {{arg:dryRun}} 看排布与每一步要做的事（place、resize、replace、keep、move、remove），再真正提交：一次确认覆盖整趟，每一步各自可撤销。代码包默认进后台烘焙任务，结果里每段、每张卡带 `bakeJobId`，导出前用 {{tool:jobs_inspect}} 核对；`background: false` 时当场烘焙，结果带 `bake`（渲染器、帧率、耗时），退回逐帧截图的会给警告。
- **重跑是增量的**：放好之后视频里存一份「制作计划」记录。段落变长变短或换了包走带波纹的换包，后面的内容一起挪；中间插进的段先腾位置；换了旁白文件或产物就换旁白；同一路径的素材文件重新剪过（大小或修改时间变了）也算变了；没变的片段、卡片与水印不动。要动的轨道或条目锁着时什么都不改，报 `TARGET_LOCKED`，解锁后重跑。计划里删掉已放好的段落会拒绝（`PLAN_SEGMENT_REMOVED`：先用 `removeRange` 删掉那段）；段落被手动挪得不再首尾相接时 `LAYOUT_MISMATCH`。
- 它不切素材、不配音、不对齐，也不烧来源标签、双语字幕或照片的推拉：这些在它之前做好，把剪好的文件当普通素材给它；有命令行环境时现成的脚本见 {{skill:production-scripts}}。

### 声波与进度条：内置元素

跟着声音起伏的声波和进度条是 BaoCut 的内置元素：引擎逐帧画，预览与导出一致，用户在编辑器的属性页里能换款、改色、挪位置。一笔 {{tool:edits_apply}} 的 `insertItems` 放上，马上出现在画面上。不要为它写代码包、自己分析音量或逐帧渲染：整段音频要渲染很久，用户也改不了。

- **声波**：`{"type":"visualizer","visualizer":{"style":…}}`。横条款有 `bars`、`bars_rounded`、`bars_bottom`、`spectrum_area`、`oscilloscope`、`ribbons`、`dots`，正方款有 `ring_bars`、`ring_wave`、`pulse_rings`。`mainColor`、`secondaryColor`（`#RRGGBB`）不写时用这一款的配色。缺省跟着整条序列混好的声音动；只在某位说话人说话时动给 `speaker`。
- **进度条**：`{"type":"progress","progress":{"style":…}}`，`style` 如 `normal`、`rounded`、`circle`；在片段时长里从头走到尾。
- **时长与轨道**：`span` 从第 0 帧铺到序列末尾（{{tool:videos_inspect}} 的 `sequence.durationFrames`）。同一条轨道上的片段不能重叠：画面轨上已有背景时，同一笔里先 `addTrack`（`kind` 为 `visual`，给 `ref`），再用 `trackRef` 指向它；新轨道排在最上面，盖在背景之上。
- **落位**（`place`）：`x`、`y` 是框中心在画面宽、高上的百分比，`w` 是框宽占画面宽的百分比（正方款按画面短边）。不写时按种类的缺省：声波横条宽铺满、高为画面的 20%，中心在 `y` 85，正好压在字幕的默认位置（中线在画面高 86%）上；正方款 `w` 30。画面上有字幕时把声波挪开，例如居中 `{"y":50,"w":70}`。

```json
[{"type":"addTrack","kind":"visual","ref":"wave"},
 {"type":"insertItems","items":[{"type":"visualizer","trackRef":"wave","span":{"fromFrame":0,"durationFrames":37840},"place":{"y":50,"w":70},"visualizer":{"style":"bars"}}]}]
```

{{tool:videos_frames}} 的帧里没有这些元素；要看画面就导出一小段（{{tool:export}}，{{arg:purpose}} 为 `preview`）再抽帧。

### 剪口播的机制

1. `proposeCuts`（给素材 ID，`detect` 里选口癖、停顿与目标停顿长度）生成剪辑提案：一份 kind 为 `editorial-proposal` 的文档，不改时间线。
2. {{tool:documents_read}} 读提案：`suggestions` 每条有 `id`、`kind`（filler 或 pause）、源区间、`text`、`reason`。
3. `acceptCutSuggestions` 只接受该删的那些；要改区间就直接 `addCuts`（素材自己的秒）并把建议 ID 写进 `ref`。
4. 提案不检测说了两遍的句子：录废重来的自己按转写的词时间用 `addCuts` 剪。
5. 剪口可以 `restoreCut` 恢复；剪口集合是 kind 为 `cut-set` 的文档。

转写在提出提案之后改过时，接受会失败（`details.rule` 为 `proposal-stale`）：重新 `proposeCuts`。

### 章节

- **自己分的章节**：`setChapters` 整个替换章节列表（按时间严格递增，第一章通常在 0）；只改一章用 `upsertChapter`。怎么分见 {{skill:video-chapters}}。先用 {{tool:speech_topic_boundaries}}（{{arg:video}}；可给 {{arg:minChapterSec}}、{{arg:maxChapters}}）取按意思找到的话题转折：`mode` 为 `topic` 时章节只落在 `first` 与 `candidates[].at`，可以合并不新增；为 `model` 时没有候选，读文稿自己判断。
- **作者的章节或用户贴的大纲**：{{tool:chapters_adopt}}，不手工对时间。给 {{arg:video}}（可给 {{arg:asset}}、{{arg:document}}）时取素材的作者章节（`assets[].source.chapters`）；给 {{arg:outline}}（`[{ at, title }]` 或大纲原文）时用用户的大纲。它把每条吸到文稿最近的段落或句子起点（段落、句子、字幕条、词依次退），清洗标题后以 `setChapters` 写入；{{arg:dryRun}} 只看结果不写。回执的 `sourceChapters` 给出 `entries`、`matched`、`ambiguous`（附近几个起点，取了离作者时间最近的）、`snapped`、`unanchored`（对不上，保留原时间）与逐条的 `rows`，没对上的告诉用户。`untitled` 的章节平台只给了分界（`Untitled Chapter N` 是占位名）：按转写起标题，连同其余各章用 {{arg:outline}} 再调用，直接采用会返回 `UNTITLED_SOURCE_CHAPTERS`。`NO_SOURCE_CHAPTERS`：没有作者章节，改按 {{skill:video-chapters}} 自己分；`ASSET_NOT_PLACED`：素材不在时间线上。

章节固定在时间线的时刻上，不跟着片段移动：移动、删除片段或波纹删除之后要重新核对。剪口播例外：`addCuts`、`acceptCutSuggestions` 与 `restoreCut` 让章节跟着内容走（剪掉的段后面的章前移，整章都剪掉的删掉；恢复时接缝之后的后移）。

### 派生子视频

{{tool:videos_derive}} 把父视频的一段建成旁边的一个可编辑子视频（做法见 {{skill:shorts-segments}}）。{{arg:hook}}、{{arg:reason}}、{{arg:notes}} 写进子视频的派生来源文档（notes 每条至多 80 字、至多 8 条）；结果原样回显文档里记下的 `hook`、`reason`、`notes`，没有的不带。认回已有的子视频（`reused` 为 true）时文档不改写，回显的是原来那份，不是这次传的。要再读一次就用 {{tool:documents_read}} 读结果的 `derivationDocumentId`。

按镜头分别取景时给 {{arg:crops}}：每段 `from`、`to` 是父视频剪辑后时间线上的秒（直接用 {{tool:videos_shots}} 的 `shots`），加这段的四边裁剪。主素材的片段在取景变化处拆开，各带自己的裁剪；结果的 `framing` 是对到帧、截到区间后实际采用的各段，`crops-adjusted` 说明有段被截过或丢掉，`animation-split` 说明拆开的片段有循环动画或音量包络、每段从头算。区间之前、之后的部分沿用第一段、最后一段的取景：恢复首尾的话时放回来的画面跟着那一段，那截若是另一个镜头取景就不对，要在提示牌里说。全屏加 `cover` 的片段里这些裁剪存成取景点（`focalPoint`）：画面一样，源画面不裁，用户之后把画布改回原画幅还能看到完整画面；要改单个片段的取景就用 `setStyle` 的 `focalPoint`；它的 `zoom`（1 到 4，缺省 1）是在铺满之上围着取景点再放大。用户在画布上对这种片段只能改放大，位置跟着取景点。

### 撤销与历史

- {{tool:edits_undo}}：撤销你自己最近的一笔；也可以给 {{arg:transactionId}} 指定一笔。撤销本身也是一笔新修改，返回同样的回执。
- {{tool:videos_history}}：列出历史（谁改的、改完的版本、能不能撤销）与检查点。
- 改错了就撤销自己那一步，不手工反向修改；用户改的那几笔不要替他撤。

### 版本记录

项目里的视频由 BaoCut 自动记版本（不依赖 git）：一段连续的修改合成一个版本，带着谁改的、在哪个会话里改的。

- 要了解一部视频最近改了什么，先用 {{tool:videos_versions}} 读版本记录，不必翻 {{tool:videos_history}}；某一版具体怎么改的用 {{tool:videos_version_diff}}（{{arg:version}}）。
- 用户要「回到之前那版」时用 {{tool:videos_restore_version}}：先在版本记录里找到版本号，拿不准时看 diff 或问用户；{{arg:before}} 为 true 是回到那一版开始之前。回到版本也是一笔修改，可以用 {{tool:edits_undo}} 撤销。
- 用户要存一版、或大改之前要留一个回得去的点时用 {{tool:videos_save_version}}（{{arg:name}}）；平时的修改会自动记下，不用每次都存。
- 不要手改视频目录里的 `.bcut-snapshot/`，也不要替用户对它 `git checkout` 或 `git reset`。BaoCut 之外的改动（`git pull`、同步盘）会自动导入为一笔「外部变更」；{{tool:videos_versions}} 的 `snapshot.state` 是 `conflict` 时，视频里也有还没写进快照的修改，或快照读不出：告诉用户，由用户选保留哪边，你照常编辑。

## 结果怎么读

回执是唯一的事实：只有回执里的才是真正改了的。

- `revision`：新的版本，下一笔修改带它。
- `transactionId`：这一笔，撤销时用。
- 创建、修改、删除的对象 ID：新片段的 `itemId` 从这里取。
- 时长变化：剪口播后报告给用户。
- `timeResolution`：时间实际对齐到哪一帧。
- 附带的说明：`removedTransitions`（转场不再成立被删）、`removedByCuts`（整个落在剪掉范围里的片段）、`shortenedTransitions`、`orphanedAnchors` 等，出现了就向用户说明。

## 常见错误码

| 错误码 | 下一步 |
| --- | --- |
| `PROJECT_REVISION_CONFLICT` | 视频刚被改过：重新 {{tool:videos_inspect}}，按新状态决定 |
| `TARGET_LOCKED` | 片段或轨道锁着：问用户要不要解锁，不要自己解 |
| `TRANSITION_HANDLES_INSUFFICIENT` | 剪切点两侧素材余量不够：`details` 给出缺几帧；裁短片段或缩短转场 |
| `INVALID_ARGUMENTS` | 操作写错：用 {{tool:edits_ops}} 查这个操作的 schema 后改 |
| `ASSET_MISSING` | 链接的素材文件不在了：请用户放回或给新位置 |

## 下一步

- 剪过之后转写的时间线视图变了，译文会过期：去 [subtitles](subtitles.md) 只重译变了的句子。
- 要看画面：去 [media](media.md) 取帧。
- 要文件：去 [export](export.md)。

## 验收

- 读回：{{tool:videos_inspect}} 看片段与时长，{{tool:documents_read}} 看剪口集合或章节，对照计划逐项核对：该删的删了，该留的还在。
- 剪点落在词与词之间，换气留着；停顿顺不顺要人听，导出一小段给用户听，并在报告里写明哪些只是量出来的。
- 挪过片段之后，别的轨道上的文字、放大、B-roll 要重新读一遍核对位置。
