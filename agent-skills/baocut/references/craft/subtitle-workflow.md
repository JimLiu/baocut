<!-- 由 tools/sync-agent-skill.ts 从 skills/subtitle-workflow/ 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 转录与字幕

> 用户给了视频链接或本机音视频，要转录、加字幕、做译文字幕或双语字幕时用：建可编辑视频并导入，转写、润色，需要时翻译，把字幕层放到画面上，再按需导出字幕文件或成片。有媒体时「转录」「加字幕」「翻译成某种语言」都按这个流程。不用于与视频无关的文字翻译。

成品是一个可编辑视频：素材在时间线上，转写润色过，需要时有译文，字幕层放在画面上；用户要文件时再从视频导出。不要只交一个下载下来再改过的字幕文件。

全程按这个顺序：确认 → 建视频并导入 → 转写 → 润色（含说话人实名） → 章节（旁路） → 翻译 → 建字幕层 → 导出 → 交付说明。每一步等工具的回执或任务完成再走下一步；跨回合接着做时，先 `baocut videos inspect` 看已经做到哪一步，从那里接着做，不重复已完成的步骤。

## 1. 先确认

- **交付物**：原文字幕、译文字幕还是双语字幕；要不要文件（字幕文件、带字幕的成片）。用户说「翻译成某种语言」是要译文字幕，说「双语」是双语字幕；只说转录、加字幕时是原文字幕。
- **目标语言**：用 BCP 47 标签（如 `zh-Hans`、`en`、`ja`、`es`）。要翻译、用户又没说译成什么时问一次。
- **原文语言、人名与术语**：用户说了就记下，转写和润色都用得上；没说的让转写自动识别。
- **来源元数据**：从链接导入的素材，`baocut videos inspect` 的 `assets[].source` 有标题、发布者、简介（`description`，最多 1200 字符）与作者的章节（`chapters`）；转写或下载完成时 `pipeline.summary.description` 与 `pipeline.summary.sourceChapters` 也给出简介和作者章节的条数。润色、说话人实名、章节都用它。
- **在哪个视频上做**：编辑器里打开的或用户点名的视频就在它上面做；`baocut videos inspect` 看已有的素材、转写、译文与字幕层，已有的接着用。
- 用户明确只要一个字幕文件、不要视频或项目时，不走这个流程，按 `translate-subtitles` 的文件一节做（只转录不翻译时就交下载目录里的文稿）。

## 2. 建视频并导入

- **链接**：`baocut transcribe` 给 `url`（可给 language、hint、name、noCaptions），它新建视频、下载导入、放上时间线、转写并建字幕层；用户说了原文语言或给了人名术语时带上 language 与 hint。`baocut download` 给 `newVideo: true` 与 `transcribe: true` 也新建视频并转写，但只用默认设置、不建字幕层。`baocut jobs inspect` 等到 completed：`pipeline.summary.videoId` 是新视频，`pipeline.summary.assetId` 是素材。新建的视频在之后的步骤失败时保留，不要再建一次。
- **本机文件**：`baocut transcribe` 给 `file`（可给 language、hint、name），它新建视频、导入、放上时间线并转写；第 3 步的转写就在这一步里。只要建视频不要转写时，`baocut videos create` 新建视频（名字取文件名；竖屏素材给竖屏的宽高），用 `baocut assets import` 导入并放上时间线（给 place）。
- 链接下载失败时照 error.details.remedy 告诉用户怎么补救，不要用别的方式下载。

## 3. 转写

- 第 2 步用 `baocut transcribe` 或带了 `transcribe: true` 的 `baocut download` 时已经在转；已有视频要转写、或要带 language、hint 时用 `baocut transcribe` 给 video（可给 asset；先 `baocut models capabilities` 看有没有可用的转写服务）。
- 要润色时给 `baocut transcribe` 加 `noCaptions: true`：字幕层在润色之后由第 7 步建（`baocut transcribe` 默认转完就建一层，润色前建的要删掉重建）。
- `baocut jobs inspect` 等到 completed：`pipeline.summary.documentId` 是新转写（`baocut transcribe` 给 url 或 `baocut download` 带 `transcribe: true` 时同样在 `pipeline.summary.documentId`）。
- 返回 CAPABILITY_NOT_CONFIGURED 时照它的 next 告诉用户要启用哪项服务，停在这里。

## 4. 润色

按 `polish-transcript` 的做法润色转写，写回同一份转写。默认只改错字、术语与标点；用户说不要润色时跳过。润色必须在翻译之前：它会改分句。

按它的做法，来源元数据当背景参考用（人名、术语的准确写法只在说话人明显在说它时才照改，不往文稿里加东西）；润色写回后给占位名的说话人实名（有证据才写，拿不准留着占位名）。用户说不要润色时，说话人实名照样做。

## 5. 章节（旁路）

每次转写默认给视频分章，除非用户说不要，或 `baocut videos inspect` 看到视频已经有章节（不覆盖；用户要重分时按 `video-chapters` 先问清替换还是调整）。章节是旁路：不阻塞翻译、字幕层和导出；失败不致命，最多重试一次，仍不行就在交付说明里如实写原因，接着做后面的步骤。

- **有作者章节**（`assets[].source.chapters` 不为空，或 `pipeline.summary.sourceChapters` 大于 0，或简介里有 `0:00 开场` 这类时间戳大纲）：用 `baocut chapters adopt` 给 video，把作者的章节吸到文稿的段落或句子起点上并写进视频，不用自己分；`chapters` 是空的、简介里却看得到时间戳大纲时，把那段大纲给 `outline`。读回执的 `sourceChapters`：matched、ambiguous、unanchored 各几条，交付时说明。
- **没有作者章节**（`baocut chapters adopt` 返回 `NO_SOURCE_CHAPTERS` 也是这种情况，不算失败）：按 `video-chapters` 的做法自己分。
- 用户要你自己写的章节，或要和作者大纲不同的粗细时，也按 `video-chapters` 自己分，作者大纲当参考。
- 返回 `ASSET_NOT_PLACED` 时素材还不在时间线上：先放上时间线再做。

## 6. 翻译

需要译文或双语时，按 `translate-subtitles` 的做法翻译。润色写回之后重新 `baocut documents read` 读转写，用那时的 translationBasis 翻译；已有同一语言的译文时在它上面更新，不新建第二份。

## 7. 建字幕层

用 `baocut captions create` 把字幕放到画面上，BaoCut 按句对齐时间、按宽度切成字幕条：

- 原文字幕：documentId 给转写文档。
- 译文字幕：documentId 给译文文档。
- 双语字幕：给译文文档并带 `bilingual: true`。

同一份文档每调用一次就多建一层，不覆盖。调用前先 `baocut videos inspect` 看这份文档是不是已经有字幕层：有了就不重复建；用户要重做时先说明会多出一层，问清是否删掉旧的。回执给出 transactionId 和字幕条数，说给用户。

## 8. 导出

用户要文件时用 `baocut export`，等 `baocut jobs inspect` 到 completed，把 outputs 里的 path 告诉用户：

- 双语字幕文件：kind `subtitles`，`bilingual: true`（主文档是转写，副文档是译文，每句一条）。
- 只要译文的字幕文件：kind `subtitles`，给 language；要求画面上已有这种语言的字幕层（第 7 步）。
- 原文字幕文件：kind `subtitles`，主文档是转写。
- 带字幕的成片：导出 mp4 或 webm，画面上的字幕层会画进去。

## 9. 交付说明

- 视频在哪：名字与所在位置；是新建的还是用户原来的。
- 字幕层：建了哪几层（原文、译文、双语），各多少条。
- 文件：导出的路径。
- 润色改了什么、统一了哪些术语；译文的目标语言与句数。
- 说话人：给谁实名了；哪些没有证据、仍是占位名。
- 章节：几章；用的是作者的章节还是自己分的；作者章节里没对上的条目（ambiguous、unanchored）；没做或失败时说明原因。
- 哪里拿不准：没改成的转写错误、不确定的译法、识别质量差的段落。
