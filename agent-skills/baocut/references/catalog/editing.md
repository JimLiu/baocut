---
description: 时间线修改的机制：一笔修改的事务与版本、预检、按需查操作、常用操作的例子、剪口播的提案与剪口、章节、撤销与读回执。第一次改时间线之前读。
---

# 编辑：时间线上的修改

## 何时用

- 剪辑：放素材、裁切、拆分、挪动、删除、波纹删除、变速、转场。
- 剪口播：去口癖与长停顿、删掉录废的部分（剪口）。
- 章节、文字与元素、画面摆法与外观、效果、声音与闪避、画布尺寸。
- 写文档（转写、译文）也是一笔修改，但通常用 {{tool:documents_put}}（见 [subtitles](subtitles.md)）；作者的章节用 {{tool:chapters_adopt}} 写进视频（见下面的「章节」）。

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
| 波纹 | `removeRange` | 删掉一段时间并让后面的前移；要一起动的配音、字幕轨都要列上 |
| 画面 | `setTransform`、`setStyle`、`setEffects`、`setSpeed` | 位置与大小、铺满或画中画、裁切与外观、调色与效果、恒定变速 |
| 文字 | `setText` | 改文字片段的文字或改成计时读数 |
| 声音 | `setAudioMix`、`setDucking`、`removeDucking` | 音量、静音、淡入淡出；人声响起时压低配乐 |
| 转场 | `setTransition`、`removeTransition` | 片段之间或单侧的转场 |
| 章节 | `setChapters`、`upsertChapter`、`removeChapter` | 整个替换或逐章修改章节 |
| 剪口 | `proposeCuts`、`acceptCutSuggestions`、`addCuts`、`restoreCut` | 生成口癖与停顿的剪辑提案、接受建议、直接剪、恢复 |
| 轨道与画布 | `addTrack`、`updateTrack`、`updateSequence` | 加轨道、锁定与隐藏、画布尺寸与底色 |
| 文档与历史 | `putDocument`、`createCheckpoint`、`renameVideo` | 写文档、留检查点、改视频名 |

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

字幕层用 {{tool:captions_create}} 建，不是这里的操作；剪掉一段并让后面前移用 `removeRange`，口播的剪口用 `addCuts`。其余操作与每个字段的写法用 {{tool:edits_ops}} 取。
<!-- /generated -->

### 剪口播的机制

1. `proposeCuts`（给素材 ID，`detect` 里选口癖、停顿与目标停顿长度）生成剪辑提案：一份 kind 为 `editorial-proposal` 的文档，不改时间线。
2. {{tool:documents_read}} 读提案：`suggestions` 每条有 `id`、`kind`（filler 或 pause）、源区间、`text`、`reason`。
3. `acceptCutSuggestions` 只接受该删的那些；要改区间就直接 `addCuts`（素材自己的秒）并把建议 ID 写进 `ref`。
4. 提案不检测说了两遍的句子：录废重来的自己按转写的词时间用 `addCuts` 剪。
5. 剪口可以 `restoreCut` 恢复；剪口集合是 kind 为 `cut-set` 的文档。

转写在提出提案之后改过时，接受会失败（`details.rule` 为 `proposal-stale`）：重新 `proposeCuts`。

### 章节

- **自己分的章节**：`setChapters` 整个替换章节列表（按时间严格递增，第一章通常在 0）；只改一章用 `upsertChapter`。怎么分见 {{skill:video-chapters}}。
- **作者的章节或用户贴的大纲**：{{tool:chapters_adopt}}，不手工对时间。给 {{arg:video}}（可给 {{arg:asset}}、{{arg:document}}）时取素材的作者章节（`assets[].source.chapters`）；给 {{arg:outline}}（`[{ at, title }]` 或大纲原文）时用用户的大纲。它把每条吸到文稿最近的段落或句子起点（段落、句子、字幕条、词依次退），清洗标题后以 `setChapters` 写入；{{arg:dryRun}} 只看结果不写。回执的 `sourceChapters` 给出 `entries`、`matched`、`ambiguous`（附近几个起点，取了离作者时间最近的）、`snapped`、`unanchored`（对不上，保留原时间）与逐条的 `rows`，没对上的告诉用户。`NO_SOURCE_CHAPTERS`：没有作者章节，改按 {{skill:video-chapters}} 自己分；`ASSET_NOT_PLACED`：素材不在时间线上。

章节固定在时间线的时刻上，不跟着片段移动：剪辑之后要重新核对。

### 撤销与历史

- {{tool:edits_undo}}：撤销你自己最近的一笔；也可以给 {{arg:transactionId}} 指定一笔。撤销本身也是一笔新修改，返回同样的回执。
- {{tool:videos_history}}：列出历史（谁改的、改完的版本、能不能撤销）与检查点。
- 改错了就撤销自己那一步，不手工反向修改；用户改的那几笔不要替他撤。

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
