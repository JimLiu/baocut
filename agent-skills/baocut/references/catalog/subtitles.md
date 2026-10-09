---
description: 文稿与字幕的机制：转录、润色写回、自己翻译并写成译文、建字幕层、用配置好的文本模型翻译、读文稿写总结与文章。转写、润色、翻译或建字幕层之前读。
---

# 文稿与字幕：转录、润色、翻译、字幕层

## 何时用

- 有媒体（链接、本机文件、已有视频）要转录、加字幕。
- 转写要润色或校对。
- 要译文字幕或双语字幕；原文改过之后要更新译文。
- 要从视频内容写总结、文章、标题与简介（读文稿）。

怎么润色、怎么译、怎么写总结是 craft 的事：{{skill:subtitle-workflow}}、{{skill:polish-transcript}}、{{skill:translate-subtitles}}、{{skill:video-summary}}、{{skill:video-blog}}、{{skill:titles-and-description}}。这一页只讲调用与回执。

## 前置检查

- 在哪个视频上做：{{tool:videos_inspect}} 看文档清单。kind 为 `speech` 的是转写，`translation` 是译文，`caption` 是字幕层的文档。已有的接着用：已有转写不再转一遍，已有同一语言的译文在它上面改。
- 要转写时先 {{tool:models_capabilities}}（能力 `transcribe`）看有没有可用的转写服务。
- 原文语言、人名与术语：用户说了就记下。语言转写时给 {{tool:transcribe}} 的 {{arg:language}}；人名与术语只在转写模型收识别提示时给 {{arg:hint}}：{{tool:models_capabilities}} 里要用的模型（不给模型时是默认的那只）`acceptsHint` 为 true 才给。默认的 MOSS 不收，带了也照常转写，但提示被忽略、转写任务带 `hint-ignored` 提醒；这时人名与术语留给润色，不为了用上提示换模型。
- 来源元数据：从链接导入的素材在 {{tool:videos_inspect}} 的 `assets[].source` 里有标题、发布者、简介与作者章节（见 [media](media.md)）。润色时当背景参考，说话人实名时当证据之一。

## 命令与例子

### 转录

| 输入 | 调用 |
| --- | --- |
| 链接 | {{tool:transcribe}}，{{arg:url}}：新建视频、下载、放上时间线、转写、建字幕层 |
| 本机文件 | {{tool:transcribe}}，{{arg:file}}；可给 {{arg:name}} |
| 已有视频 | {{tool:transcribe}}，{{arg:video}}；素材不止一个时给 {{arg:asset}} |
| 要先润色再上字幕 | 加 {{arg:noCaptions}}：字幕层等润色之后再建 |
| 用户明说只要文稿文件 | 加 {{arg:noVideo}}：只写 TXT 与 SRT，不建视频；本机文件可给 {{arg:outDir}} |

可选 {{arg:language}}（不给时自动识别）、{{arg:hint}}（人名、术语、专有名词；只给收提示的模型，见前置检查）、{{arg:diarize}}（区分说话人）。视频里这份素材已有文稿时不在同一部视频里加第二份：缺省（{{arg:target}} 为 new-video）另建一部视频，链接同一份素材；{{arg:target}} 为 replace 时取代当前文稿，一笔可撤销的事务里结转译文、字幕与配音（{{arg:translations}} 为 discard 时不结转译文）。文稿在转录之后被用户改过时取代以 `TRANSCRIPT_EDITED` 拒绝：先问用户，确认丢掉那些修改再加 {{arg:acceptEdited}}。

重转（另建视频或取代）与换模型只在用户要求时做：不因为自己觉得识别得不够好就重转，少量错字、人名与术语听错在润色时改（{{skill:polish-transcript}}）。结果不能用（空的、语言认错、大段乱码）时先问用户再重转。

### 润色写回

1. {{tool:documents_read}} 读转写（{{arg:documentId}} 给 speech 文档）。
2. 按 {{skill:polish-transcript}} 改正文，词的时间不动。
3. {{tool:documents_put}} 写回**同一份**：{{arg:document}} 给它的 documentId，{{arg:body}} 是改好的完整正文。要防并发改动时带 {{arg:revision}}：这里是**视频**的版本（{{tool:videos_inspect}} 或上一次写命令回执里的 `revision`），不是 {{tool:documents_read}} 结果里同名的文档版本；给错了以 `PROJECT_REVISION_CONFLICT` 拒绝。

### 说话人实名

转写的正文有 `speakers[]`（每位 `id` 与 `name`），词的说话人指向它的 `id`。区分说话人后自动起的名字是占位名：「说话人 n」及它在别的界面语言里的对应（`Speaker 1`、`Sprecher 1` …）、识别服务的编号标签（`SPEAKER_00`、`S1`、`spk-1`）、空、等于 id。多位说话人还有占位名时，润色末尾按 {{skill:polish-transcript}} 找证据实名，拿不准就留着占位名。写回仍用 {{tool:documents_put}} 写同一份转写，只改 `speakers[].name`，`words` 与其他字段照读到的原样；只覆盖占位名，用户起的名字不动；同一个人被拆成几个 id 时给同一个名字，不合并 id。

### 自己翻译（默认路径）

翻译由你自己做，不用 {{tool:translate}}：

1. **润色写回之后再读一次转写。** {{tool:documents_read}} 读 speech 文档，结果里的 `translationBasis` 给出 `sourceBasis` 与切好的句子（每句 `id`、`fingerprint`、`text`、`wordIds`）。润色会改分句与指纹，所以润色之后必须重新读。
2. **逐句翻译**，按 {{skill:translate-subtitles}}：一句对一句，不合并、不拆分、不漏。
3. **写成译文。** {{tool:documents_put}} 新建：{{arg:kind}} `translation`，{{arg:language}} 为目标语言（BCP 47），{{arg:sourceDocument}} 为转写的 documentId，{{arg:body}} 照 {{tool:documents_read}} 说明里的形状（`baocut.translation/2`），`sourceBasis` 用这次读到的。每句的 `alignment` 照说明填，或写 null 让 Runtime 按句补上句级对齐。已有同一语言的译文时给 {{arg:document}} 更新它，不新建第二份。
4. **建字幕层。** {{tool:captions_create}}，{{arg:documentId}} 给译文；双语加 {{arg:bilingual}}（译文为主、原文为辅，转写还没有原文字幕层时同一笔里一起建）。
5. **要文件再导出。** {{tool:export}}，{{arg:kind}} `subtitles`，{{arg:format}} `srt` 等；双语加 {{arg:bilingual}}（见 [export](export.md)）。

<!-- surface: cli -->
正文大，写进文件再用 `--body @zh.json` 传，不塞进命令行（见 [conventions](../conventions.md) 的「参数怎么写」）。
<!-- /surface -->
<!-- surface: agent -->
一次 {{tool:documents_put}} 写完整份译文，不分几次写。
<!-- /surface -->

原文改过（润色、剪辑）之后译文会过期：重新读转写，句子 `id` 与 `fingerprint` 都对得上的单元原样保留，其余重译，再写回同一份译文。

### 建字幕层

{{tool:captions_create}}，{{arg:documentId}} 给转写（原文字幕）或译文（译文字幕）；双语给译文并带 {{arg:bilingual}}。BaoCut 按句对齐时间、按宽度切成字幕条，不要自己写字幕文档或拼字幕实例。

同一份文档每调用一次就多建一层，不覆盖：调用前先 {{tool:videos_inspect}} 看是不是已经建过；用户要重做时先说明会多一层，问清是否删掉旧的。

### 用配置好的文本模型翻译（只在用户明确要求时）

{{tool:translate}}：{{arg:video}} + {{arg:to}} 写成新译文并建字幕层；或 {{arg:file}}（SRT / VTT）+ {{arg:to}} 译成新文件，不碰视频。可选 {{arg:style}}、{{arg:glossary}}、{{arg:bilingual}}。没有配置文本模型时它以 `CAPABILITY_NOT_CONFIGURED` 拒绝：照 `next` 改走上面的自译路径，不请用户去配置。

### 读文稿写总结、文章、标题

纯文字的产出不写回视频（除非用户要章节，见 [editing](editing.md)）：

- 带时间码的文稿：{{tool:export}}，{{arg:kind}} `transcript`，{{arg:format}} `md`，{{arg:timestamps}}；读结果里文件的 `path`。这里的时间是剪辑后时间线上的时间，要点的时间就取它，不自己估。
- 只要正文：{{tool:export}}，{{arg:kind}} `transcript`，{{arg:format}} `txt`；或 {{tool:documents_read}} 读转写的句子。
- 有几份文稿时导出会以 `EXPORT_SOURCE_AMBIGUOUS` 拒绝并列出候选，用 {{arg:documentId}} 指定。

## 结果怎么读

- {{tool:transcribe}} 完成：`pipeline.summary.documentId` 是新转写，`summary.captions` 是字幕层，新建视频时 `summary.videoId` 是视频。给 url 时找不到 documentId 就 {{tool:videos_inspect}} 找来源素材是这段素材的 speech 文档；给 url 时另有 `summary.description`（截断的简介）与 `summary.sourceChapters`（作者章节的条数），大于 0 时分章用 {{tool:chapters_adopt}}（见 [editing](editing.md)）。
- {{tool:documents_put}}：与修改相同的回执（新版本 `revision`、`transactionId`），另有文档的 `documentId`；`filledAlignments` 是 Runtime 补了几句对齐。正文与原来相同时不产生新版本。
- {{tool:captions_create}}：`documentId`（字幕文档）、`trackId`、`itemIds`、`cueCount`（字幕条数）、`enabled`；双语另有 `pairedOriginal`（`created` 为 true 是这次顺带建的原文层）。`existing` 不为空说明这份文档原本已有字幕层。

## 常见错误码

| 错误码 | 下一步 |
| --- | --- |
| `CAPABILITY_NOT_CONFIGURED`（转写） | 没有可用的转写服务：照 `next` 转告用户，或按 [models](models.md) 装本地模型包；停在这里 |
| `CAPABILITY_NOT_CONFIGURED`（{{tool:translate}}） | 文本模型没配：自己翻译，不请用户去配 |
| `TRANSLATION_UNALIGNED` | 译文有 `alignment` 为 null、Runtime 补不上的句子：重新读转写，核对句子 `id` 与 `fingerprint` 后再写一次译文 |
| `CAPTIONS_NOT_ON_TIMELINE` | 文档来源的素材不在时间线上：先放上时间线，或换一份文档 |
| `CAPTIONS_EMPTY` | 没有可显示的字幕条：检查文档是不是空的 |
| `PROJECT_REVISION_CONFLICT` | 见 [conventions](../conventions.md) 的「版本冲突」 |
| `EXPORT_SOURCE_AMBIGUOUS` | 文档不止一份：用 `candidates` 里的 documentId 指定 |

## 下一步

- 字幕层建好、用户要文件：去 [export](export.md)。
- 要配音：去 [voice](voice.md)，带上刚写的译文。
- 要剪口播或分章：去 [editing](editing.md)。

## 验收

- 转写、译文、字幕层都在视频里，没有重复的转写与重复的字幕层；没有用户没要求的重转或换模型。
- 润色在翻译之前，翻译用的是润色之后重新读到的句子。
- 多位说话人时，证据够的都实名了；留着占位名的在报告里说明。
- 译文句数等于转写句数；术语与专名全文一致。
- 字幕层的条数（`cueCount`）报告给用户；字幕在画面上的位置要在编辑器或导出的成片里看，帧里看不到。
