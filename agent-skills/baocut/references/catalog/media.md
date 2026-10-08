---
description: 媒体的机制：从链接下载、转码与合并、取帧看画面、导入素材（链接还是复制）、新建视频、打开便携包、生成图片，以及看一条视频的证据阶梯。下载、导入、取帧或生成图片之前读。
---

# 媒体：下载、转码、取帧、素材与新建视频

## 何时用

- 用户给了视频页面的链接，要下载、导入或在它上面做事。
- 本机文件要压缩、转码、按顺序合并、提取音轨（文件到文件，不建视频）。
- 要看画面：构图、镜头分布、字幕会不会挡住内容、剪点前后是什么。
- 要新建一个空视频、把素材导入视频并放上时间线、打开便携包（`.baocut` 文件）。
- 要生成图片放进视频。

要转写的链接与本机文件直接用 {{tool:transcribe}}（见 [subtitles](subtitles.md)）：它一步做完新建视频、下载或导入、放上时间线与转写。

## 前置检查

- 下载要 yt-dlp，转码与导出要 ffmpeg：缺了会以错误返回并带补救（见下面的错误码）。
<!-- surface: cli -->
  `baocut status` 一次看清两者在不在。
<!-- /surface -->
- 已有视频先 {{tool:videos_list}} / {{tool:videos_inspect}}：素材是不是已经导入过、有没有转写，已有的接着用，不重复导入。
- 生成图片先 {{tool:models_capabilities}}（能力 `generateImage`）看有没有可用的模型、尺寸与张数的范围。

## 命令与例子

### 从链接下载

| 要做的事 | 调用 |
| --- | --- |
| 下载并新建视频（默认） | {{tool:download}}，{{arg:url}} 给链接，{{arg:newVideo}}；可给 {{arg:name}}、{{arg:project}} |
| 新建视频并转写 | 同上再加 {{arg:transcribe}}（或直接 {{tool:transcribe}} 给 {{arg:url}}） |
| 导入到已有视频 | {{tool:download}}，{{arg:url}} + {{arg:video}} |
| 只下载到项目 | {{tool:download}}，{{arg:url}} + {{arg:project}} |
| 只要文件（用户明说） | {{tool:download}} 只给 {{arg:url}}：落到下载目录 |
| 同时取平台字幕 | 加 {{arg:subs}}（语言列表），字幕文件放在媒体旁边、不导入视频 |
| 只要音频 | 加 {{arg:audioOnly}} |

{{arg:video}}、{{arg:newVideo}}、{{arg:project}} 三选一。只取单个视频，不取播放列表。

要转写时知道语言或有人名、术语，直接用 {{tool:transcribe}} 给 {{arg:url}}，带上 {{arg:language}}、{{arg:hint}}（也可给 {{arg:provider}}、{{arg:diarize}}）：它下载、新建视频、转写并建字幕层；{{tool:download}} 的 {{arg:transcribe}} 只用默认设置转写、不建字幕层。

### 转码、合并、提取音轨

{{tool:transcode}} 只吃本机文件，输出新文件，原文件不动，不建视频：

| 要做的事 | 关键参数 |
| --- | --- |
| 压缩（默认逐个） | {{arg:files}}；{{arg:maxHeight}}（如 1080）、{{arg:crf}}（越小越清晰、文件越大）、{{arg:codec}}（h264 或 hevc） |
| 按顺序合并成一个 | {{arg:files}} 按要的顺序排，{{arg:merge}} |
| 逐个取出音轨 | {{arg:extractAudio}}（能流复制时不重新编码） |
| 指定输出目录 | {{arg:outDir}}；不给时是下载目录 |

### 取帧看画面

{{tool:videos_frames}}：{{arg:at}} 列出时间线上的时刻，或 {{arg:range}}（`起:止`）加 {{arg:count}} 等间隔取；一次最多 24 帧，{{arg:maxWidth}} 缩小、{{arg:format}} 选 png 或 jpeg。

- 帧取的是那个时刻最上层视频片段的素材画面，**不是合成后的成片**：字幕、文字、贴纸与叠加的元素不在里面，画中画的位置、裁剪与效果也没套用。要核对字幕位置或叠加效果，导出一小段成片（{{tool:export}} 给 range）再看。
<!-- surface: cli -->
  也可以在网页版编辑器里看合成后的画面、拖着调整，见 [web](web.md)。
<!-- /surface -->
- 那个时刻没有视频片段时 `file` 为 null，不报错。

### 新建视频、导入素材、打开便携包

| 要做的事 | 调用 |
| --- | --- |
| 新建空视频 | {{tool:videos_create}}，{{arg:name}}；竖屏素材给竖屏的宽高（如 1080×1920），帧率按素材 |
| 导入并放上时间线 | {{tool:assets_import}}，{{arg:path}} + {{arg:place}}（不给 place 只登记为素材） |
| 导入生成的产物 | {{tool:assets_import}}，{{arg:artifactId}}（不重新生成） |
| 复制进视频 | {{tool:assets_import}} 加 {{arg:storage}} `managed` |
| 和别的修改放进同一笔 | {{tool:edits_apply}} 的 `importAsset` + `addItem`，用 `ref` 连起来（见 [editing](editing.md)） |
| 打开便携包 | {{tool:videos_import_package}}，{{arg:file}}；可给 {{arg:name}} |
| 新建项目 | {{tool:projects_create}}，{{arg:path}}（只在用户要求时） |

导入默认**链接**原文件、不复制：之后移动或删除那个文件，素材就缺失了。用户要求复制进视频，或文件是你生成之后会清理的临时文件时，给 `managed`；已经链接的素材要收进视频，用 {{tool:edits_apply}} 的 `collectAssets`。

### 生成图片

{{tool:image}}：{{arg:prompt}}；可给 {{arg:size}}、{{arg:count}}、{{arg:video}}（结果导入为那个视频的候选素材，不放上时间线）。不接受参考图。

**提示词怎么写**，按这个顺序：主体 → 外观或材质 → 场景 → 光 → 机位与构图 → 风格与质量 → 一句保真夹子（不要改什么、不要出现什么）。不用真实品牌与真人做风格参照；一个系列的图沿用同一套风格描述。

## 结果怎么读

- {{tool:download}} / {{tool:transcribe}}：`pipeline.summary.videoId` 是新视频，`assetId` 是素材；`outputs` 里有下载的文件与文稿的 `path`。给链接时 summary 另有 `description`（截断的简介）与 `sourceChapters`（作者章节的条数）。
- 链接导入的素材：{{tool:videos_inspect}} 的 `assets[].source` 是来源元数据：`platform`、`webpageUrl`、`uploader`（发布者）、`uploadDate`、`title`、`description`（最多 1200 字符，被截断时 `descriptionTruncated` 为 true）、`chapters`（作者的章节 `[{ at, title }]`，平台给的或从简介的时间戳大纲解析出的，没有时 `[]`）。它是背景参考，不是文稿内容：润色时人名与术语的写法只在说话人明显在说它时照改，说话人实名时只在它唯一指明某一位时算证据（见 [subtitles](subtitles.md)）；作者章节用 {{tool:chapters_adopt}} 写进视频（见 [editing](editing.md)）。
- {{tool:transcode}}：`outputs` 的 `path`（`pipeline.summary.files`）是输出文件，把位置告诉用户。
- {{tool:videos_frames}}：`frames` 每帧有 `at`、`file`、`width`、`height` 与取自哪个片段（`item`）、哪个素材（`asset`）。读 `file` 这张图片。
- {{tool:assets_import}}：回执里有 `assetId`、`itemId`（没放上时间线时为 null）与新版本。
- {{tool:videos_create}} / {{tool:videos_import_package}}：返回与 {{tool:videos_inspect}} 相同的摘要，含 `videoId`。
- {{tool:image}}：`outputs` 里每张图的 `artifactId`；带了 video 时还有 `assetId`。

## 看一条视频的证据阶梯

要理解一条视频（剪什么、哪里是重点、画面上有什么）时按这个顺序，证据够了就停：

1. **先完整导入原件，复用已有转写。** 缺转写的批量转录（{{tool:transcribe}}）。
2. **在转写里按文字定位片段。** {{tool:documents_read}} 读转写；跨视频找用 {{tool:space_search}}。
3. **再按时间批量取帧**，拼成带时间戳的接触表看构图与镜头分布（{{tool:videos_frames}} 给 range 与 count）；可疑区间加密采样，单帧细看。
4. 仍不知道剪点在哪时，再找镜头切换（有这类手段时才用）。
5. 视频理解模型（配置了的话）放最后：问具体问题、要时间戳，并对照原片核实。

彼此独立的读取一次发完，不要一帧一问。改动先做一段有代表性的，读回核对后再批量做；大改之后重新核对，没动的结果复用。

## 常见错误码

| 错误码 | 下一步 |
| --- | --- |
| `LINK_LOGIN_REQUIRED`、`LINK_COOKIES_UNAVAILABLE` | 视频要登录才能看：照 `remedy` 请用户处理，不要自己找 cookies |
| `LINK_UNSUPPORTED` | 这个网站不支持：告诉用户，请他换链接或给本机文件 |
| `LINK_NETWORK_ERROR` | 网络问题：可以重试一次，仍不行告诉用户 |
| `LINK_DISK_FULL` | 磁盘满：告诉用户，不要自己删文件 |
| `TOOL_CONSENT_REQUIRED`、`LINK_TOOL_UPDATE_REQUIRED` | yt-dlp 要用户同意下载或更新：转告用户，照 `next` 做 |
| `EXPORT_TOOL_MISSING`、`MEDIA_TOOL_UNAVAILABLE` | 缺 ffmpeg：照 `remedy` 转告用户 |
| `ASSET_MISSING` | 链接的原文件被移动或删除：请用户放回原处或给新位置 |
| `INPUT_TOO_LONG` | 图片提示词超长：缩短后重提 |
| `CAPABILITY_NOT_CONFIGURED` | 没有可用的图片模型：见 [models](models.md) |

<!-- surface: cli -->
不要自己运行 yt-dlp 或 ffmpeg 来绕过这些错误。
<!-- /surface -->
<!-- surface: agent -->
不要用 shell 自己运行下载程序或 ffmpeg 来绕过这些错误。
<!-- /surface -->

## 下一步

- 新建了视频并转写：去 [subtitles](subtitles.md) 润色、翻译、建字幕层。
- 素材放上了时间线：去 [editing](editing.md) 剪辑。
- 要文件：去 [export](export.md)。

## 验收

- 视频是新建的还是用户原来的，名字与位置说清楚；没有重复建视频、重复导入素材。
- 转码、合并的输出文件真实存在（取结果里的 `path`），原文件没动。
- 只按真正取到并看过的帧下视觉判断；帧不含字幕与叠加元素这一点写进交付报告。
