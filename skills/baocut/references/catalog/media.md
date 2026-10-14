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
<!-- surface: agent -->
- 要做幻灯片：给 deck 导入图片、校验整份 deck。
- 要做设计稿：给设计稿导入图片与字体、校验整份设计稿。
<!-- /surface -->

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
| 视频要登录才能看 | 默认按用户在设置 › 视频下载选的浏览器；用户指明浏览器时加 {{arg:cookieBrowsers}}（例如 `["chrome"]`，按顺序尝试）；{{tool:transcribe}} 给 {{arg:url}} 时同样 |

{{arg:video}}、{{arg:newVideo}}、{{arg:project}} 三选一。只取单个视频，不取播放列表。

网站登录：不给 {{arg:cookieBrowsers}} 时按用户在 BaoCut 设置 › 视频下载里选的浏览器（默认所有检测到的），提交时冻结；给 `[]` 是匿名。只在用户说了用哪个浏览器时给，确认时会列出这些浏览器。对外服务（MCP）不能给，要登录的视频请用户在 BaoCut 里下载。

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
- 每帧顺带做人脸检测（本机，随应用的 YuNet 模型）：`faces` 是人脸框，坐标按帧的宽高归一化到 0–1、对应素材画面。按人定构图（比如竖屏裁框跟着发言人）时读 `faces`，不靠看图估位置；`detector` 为 null 时检测不可用，`faces` 为空不代表没人，这时再看图。
<!-- surface: cli -->
  也可以在网页版编辑器里看合成后的画面、拖着调整，见 [web](web.md)。
<!-- /surface -->
- 那个时刻没有视频片段时 `file` 为 null，不报错。

### 新建视频、导入素材、打开便携包

| 要做的事 | 调用 |
| --- | --- |
| 新建空视频 | {{tool:videos_create}}，{{arg:name}}；竖屏素材给竖屏的宽高（如 1080×1920），帧率按素材 |
| 导入并放上时间线 | {{tool:assets_import}}，{{arg:path}} + {{arg:place}}（不给 place 只登记为素材） |
| 导入生成的产物（语音、图片、音乐的 WAV 等） | {{tool:assets_import}}，{{arg:artifactId}}（不重新生成） |
| 复制进视频 | {{tool:assets_import}} 加 {{arg:storage}} `managed` |
| 和别的修改放进同一笔 | {{tool:edits_apply}} 的 `importAsset` + `addItem`，用 `ref` 连起来（见 [editing](editing.md)） |
| 打开便携包 | {{tool:videos_import_package}}，{{arg:file}}；可给 {{arg:name}} |
| 新建项目 | {{tool:projects_create}}，{{arg:path}}（只在用户要求时） |

导入默认**链接**原文件、不复制：之后移动或删除那个文件，素材就缺失了。用户要求复制进视频，或文件是你生成之后会清理的临时文件时，给 `managed`；已经链接的素材要收进视频，用 {{tool:edits_apply}} 的 `collectAssets`。

### 生成图片

{{tool:image}}：{{arg:prompt}}；可给 {{arg:size}}、{{arg:count}}、{{arg:seed}}、{{arg:provider}}、{{arg:model}}、{{arg:video}}（结果导入为那个视频的候选素材，不放上时间线）、{{arg:images}}、{{arg:imageMode}}、{{arg:strength}}（输入图，见下）。什么时候画、画成什么样由各 craft 决定（封面、B-roll、旁白成片的画面、分镜、文章与幻灯片的插图），这一节只讲怎么画。

**先看能力**：{{tool:models_capabilities}}，{{arg:capability}} 给 `generateImage`。`effective` 是不指定服务时用谁（null 时不指定服务的调用会被拒），`usableProviders` 是能用的服务；再看要用的模型的 `sizes`、`aspectRatios`、`maxCount`、`maxPromptChars`、`acceptsSeed`、`cost` 与 `notes`。各服务差别很大：

- **用哪个服务**：用户没点名模型时不给 {{arg:provider}} 与 {{arg:model}}，用 `effective`——用户在设置里设的默认，没设时按出厂顺序取第一个能用的：以 ChatGPT 订阅登录的 Codex（`agent:codex`）› 本机模型（Turbo 在前）› OpenAI › Google Gemini › 其余已连接的服务。用户点名了服务或模型（「用 OpenAI 画」「用本机的 Turbo」）才照着给 {{arg:provider}} 与 {{arg:model}}；别为了快或省自己换服务。
- 本机（`local`）模型的提示词上限可能只有一千字左右，一次一张，一张要几分钟到十几分钟。
- Codex 用 API key 而不是 ChatGPT 订阅登录时，它的 `cost` 为 `unknown`、`notes` 写明可能画不了，出厂顺序会跳过它；用户点名要它时照样可以给。
- 智能体服务（如 `agent:codex`）可能不收尺寸与种子：`sizes` 与 `aspectRatios` 都为空的模型不给 {{arg:size}} 和 {{arg:seed}}，在提示词里写明横竖与构图，用的时候再裁。
- `maxCount` 为 1 的模型要几张就分几次提交；一次只跑一个任务的服务会排队。张数多或模型慢时，先告诉用户大约要等多久。

**输入图**：用户要按某张图改、照某张图的样子画时给 {{arg:images}}，按顺序列出：Space 里的图给 `{ entryId }`（{{tool:space_list}} 找 `kind` 为 `image` 的条目），视频素材库里的图给 `{ assetId }` 并同时给 {{arg:video}}；不收本机路径，工作目录里的图先 {{tool:assets_import}} 进视频再用素材 id。先看模型的 `referenceImages`：为 null 的模型不收输入图；`max` 是张数上限；`edit` 为 true 的模型按提示词改图（第一张是要改的图），否则只作参考。{{arg:imageMode}} 默认 `ref`（所有图一起出图）；`img2img` 以图为底按 {{arg:strength}} 重画，只有 `img2img` 不为 null 的模型接受，张数是底图的组数（每 `img2img.max` 张一组），不给 {{arg:count}}。改动幅度小（只调色、换细节）给小的强度，要大改给大的。

**尺寸**：按图要去的地方选比例：视频画面按画幅（`16:9`、`9:16`、`1:1`），幻灯片与文章按图框。{{arg:size}} 用模型 `aspectRatios` 里的比例或 `sizes` 里的尺寸；没有正好的取最接近的一种，放上去时裁掉多出的部分。

**提示词怎么写**，按这个顺序：主体 → 外观或材质 → 场景 → 光 → 机位与构图 → 风格与质量 → 一句保真夹子（不要改什么、不要出现什么）。

- 写画得出来的具体东西（「一盏台灯照着摊开的笔记本」），不写抽象词（「效率」「增长」）。
- 一个系列的图（同一条视频、同一份幻灯片）先写一段两三句的风格说明：画面类型、色彩（有色板时写进色值）、线条与光、细节密度。每张逐字带上，不每次重新措辞；模型 `acceptsSeed` 时同一系列用同一个 {{arg:seed}}。整条提示词不超过 `maxPromptChars`。
- 不让模型在图里写字：生成的字常常写错。保真夹子里写明不要文字、字母、水印与标志；要字时用字幕、动效图形或页面里的文字叠上去，构图里给它留出干净的一侧。
- 不用真实的品牌、作品、艺术家与真人做风格参照。生成的图只会「像」：不把它画成或说成用户真实的产品、界面、人物、地点或数据，要真东西时用用户的素材、截图或取帧。

**结果放哪**：提交后是一个任务，用 {{tool:jobs_wait}} 等它结束再读结果。给了 {{arg:video}} 时每张图导入为那个视频的候选素材（结果里有 `assetId`），要用再放上时间线；没给时只得到产物（`outputs` 里每张图的 `artifactId`），要文件用 {{tool:artifacts_save}} 存进工作目录（同名文件已经存在时换个名字），要进视频用 {{tool:assets_import}} 的 {{arg:artifactId}}，不重新生成。

**用之前看一眼**：能看图时用 {{tool:artifacts_save}} 存成文件再读一遍，看主体与构图、该留白的地方、颜色，以及有没有冒出来的字、水印、变形的手与脸。不合格的改提示词重画一次；还不行就不用它，换别的画面来源。没看的在交付时说没看过。

**画不了时**：没有可用的服务，或报 `CAPABILITY_NOT_CONFIGURED`、`GRANT_REQUIRED`、`BUDGET_EXCEEDED`。图只是这次交付的一部分时，停下的是画图这一步：照所在 craft 的退路把其余做完（不放图、换别的画面来源、留出位置），交付时一句话说明图片生成没能用、哪里本来要图，附上 `settingsHref` 的设置链接；用户就是来要图的，照 [models](models.md) 的处理转告用户。

**花费与交付**：生成要花时间，用在线服务时还要花钱（看 `cost`）：只画用得上的，不一张张试着画，也不反复重画。交付时说清哪些图是生成的、用的哪个服务与模型、存在哪里或进了哪个视频的素材。
<!-- surface: agent -->

### 幻灯片

一份幻灯片是工作目录里的一个 deck 目录（`deck.json` 加 `slides/<id>.html`），页面用文件工具直接写；怎么做、格式是什么见 {{skill:slides}}。只有两步要用工具：

| 要做的事 | 调用 |
| --- | --- |
| 把工作目录里的图片或字体放进 deck | {{tool:slides_import_asset}}，{{arg:deck}} + {{arg:path}}；同一份只存一份 |
| 校验整份 deck，通过后线程里出卡片 | {{tool:slides_check}}，{{arg:path}} 是 deck 目录；改完页面再校验一次 |

页面要插图时用 {{tool:image}} 生成（不带 {{arg:video}}），{{tool:artifacts_save}} 存进工作目录，再按上表导入 deck；哪几页画、提示词与尺寸见 {{skill:slides}}。

### 设计稿

一份设计稿是工作目录里的一个目录（`canvas.json` 加每块画板一个 `.dc.html`），文件用文件工具直接写；怎么做、格式是什么见 {{skill:design}}，设计系统见 {{skill:design-system}}（只是文件，没有工具）。只有两步要用工具：

| 要做的事 | 调用 |
| --- | --- |
| 把工作目录里的图片或字体放进设计稿 | {{tool:design_import_asset}}，{{arg:canvas}} + {{arg:path}}；设计稿目录里要先有 `canvas.json`；同一份只存一份 |
| 校验整份设计稿，通过后线程里出卡片 | {{tool:design_check}}，{{arg:path}} 是设计稿目录；改完文件再校验一次 |

css、js、json 这类支持文件不导入，直接写进设计稿目录，用相对路径引用。
<!-- /surface -->

### 找镜头切换

{{tool:videos_shots}}：{{arg:range}}（`起:止`，剪辑后时间线上的秒，最长 20 分钟）里画面在哪里切换。换了片段、画面接不上的地方是 `edit`；片段里的画面突变按场景分数检测，是 `scene`。漏报时调低 {{arg:threshold}}（默认 0.3），多报时调高；{{arg:minShot}}（默认 0.8 秒）以下的镜头并进前一个。

- 只看画面突变，不认人：叠化、推拉会漏，闪光可能多报。拿不准的切换点用 {{tool:videos_frames}} 取它前一帧与它本身看一眼。
- 每个镜头的 `sampleAt` 是 3 个时刻，直接交给 {{tool:videos_frames}} 的 {{arg:at}}；一次最多 24 帧，也就是 8 个镜头。

## 结果怎么读

- {{tool:download}} / {{tool:transcribe}}：`pipeline.summary.videoId` 是新视频，`assetId` 是素材；`outputs` 里有下载的文件与文稿的 `path`。给链接时 summary 另有 `description`（截断的简介）与 `sourceChapters`（作者章节的条数）。
- 链接导入的素材：{{tool:videos_inspect}} 的 `assets[].source` 是来源元数据：`platform`、`webpageUrl`、`uploader`（发布者）、`uploadDate`、`title`、`description`（最多 1200 字符，被截断时 `descriptionTruncated` 为 true）、`chapters`（作者的章节 `[{ at, title }]`，平台给的或从简介的时间戳大纲解析出的，没有时 `[]`）。它是背景参考，不是文稿内容：润色时人名与术语的写法只在说话人明显在说它时照改，说话人实名时只在它唯一指明某一位时算证据（见 [subtitles](subtitles.md)）；作者章节用 {{tool:chapters_adopt}} 写进视频（见 [editing](editing.md)）。
- {{tool:transcode}}：`outputs` 的 `path`（`pipeline.summary.files`）是输出文件，把位置告诉用户。
- {{tool:videos_frames}}：`frames` 每帧有 `at`、`file`、`width`、`height`、`faces` 与取自哪个片段（`item`）、哪个素材（`asset`）。读 `file` 这张图片。`faces` 是 `[{x, y, w, h, score}]`：框的左上角与宽高，按帧的宽高归一化到 0–1，`score` 0–1，按 score 从高到低；顶层 `detector` 是 `yunet`，检测器不可用时为 null（`faces` 都是空数组）。`file` 为 null 的帧没有 `faces`。
- {{tool:videos_shots}}：`cuts` 每处有 `at`（新镜头第一帧的秒）、`score`（`edit` 为 null）与 `kind`；`shots` 每个有 `start`、`end` 与 `sampleAt`。
- {{tool:assets_import}}：回执里有 `assetId`、`itemId`（没放上时间线时为 null）与新版本。
- {{tool:videos_create}} / {{tool:videos_import_package}}：返回与 {{tool:videos_inspect}} 相同的摘要，含 `videoId`。
- {{tool:image}}：`outputs` 里每张图的 `artifactId`；带了 video 时还有 `assetId`。
- {{tool:music}}（见 [music](music.md)）：`outputs` 里是一个 WAV 的 `artifactId`；带了 video 时还有 `assetId`；到了时长预算时 `warnings` 里有 `output-truncated`。
<!-- surface: agent -->
- {{tool:slides_import_asset}}：`src` 形如 `/_blob/<id>`，图片原样写进 `<img src>`，字体原样写进 `deck.json` 里 `faces` 那一项的 `src`；另有 `bytes` 与 `contentType`。
- {{tool:slides_check}}：`problems` 是问题总数，为 0 时线程里记一张幻灯片卡片；否则 `slides` 列出每页的 `problems`，`deckProblems` 是 `deck.json`（含字体与设计系统的记录）与 `ds/` 的问题，`orphans` 是不在 `order` 里的页面文件。每页的 `notes` 不算问题，其中以「排版」开头的是放不下或互相压住的提示，尽量改掉。
- {{tool:design_import_asset}}：`src` 形如 `/_blob/<id>`，原样写进 `<img src>`、`<helmet><style>` 里的 `url(…)` 或 `@font-face`；另有 `bytes` 与 `contentType`。
- {{tool:design_check}}：`problems` 是问题总数，为 0 时线程里记一张设计稿卡片；否则 `issues` 每条有 `file`（相对设计稿目录，`.` 是整个目录）与 `message`，列不下时 `more` 说还有几条。`notChecked` 说明没查的部分：画板脚本能不能跑、排版与视觉效果。
<!-- /surface -->

## 看一条视频的证据阶梯

要理解一条视频（剪什么、哪里是重点、画面上有什么）时按这个顺序，证据够了就停：

1. **先完整导入原件，复用已有转写。** 缺转写的批量转录（{{tool:transcribe}}）。
2. **在转写里按文字定位片段。** {{tool:documents_read}} 读转写；知道要找什么意思、不知道原话时用 {{tool:space_search_v2}}（给 {{arg:videoIds}} 只在这部里找），跨视频找也用它。
3. **再按时间批量取帧**，拼成带时间戳的接触表看构图与镜头分布（{{tool:videos_frames}} 给 range 与 count）；可疑区间加密采样，单帧细看。
4. 仍不知道剪点在哪时，再找镜头切换（{{tool:videos_shots}}），按镜头取帧细看。
5. 视频理解模型（配置了的话）放最后：问具体问题、要时间戳，并对照原片核实。

彼此独立的读取一次发完，不要一帧一问。改动先做一段有代表性的，读回核对后再批量做；大改之后重新核对，没动的结果复用。

## 常见错误码

| 错误码 | 下一步 |
| --- | --- |
| `LINK_LOGIN_REQUIRED`、`LINK_COOKIES_UNAVAILABLE` | 视频要登录才能看：请用户先在浏览器里登录这个网站，再到设置 › 视频下载确认勾了那个浏览器（用 `error.details.settingsHref` 写成设置链接），然后重新提交；用户说了用哪个浏览器时也可以带上 {{arg:cookieBrowsers}} 重新提交（{{tool:jobs_retry}} 沿用原来的参数，改了设置也不变）。读不到 Cookie 时照 `remedy` 请用户处理。不要自己找 cookies |
| `LINK_UNSUPPORTED` | 这个网站不支持：告诉用户，请他换链接或给本机文件 |
| `LINK_NETWORK_ERROR` | 网络问题：可以重试一次，仍不行告诉用户 |
| `LINK_DISK_FULL` | 磁盘满：告诉用户，不要自己删文件 |
| `TOOL_CONSENT_REQUIRED`、`LINK_TOOL_UPDATE_REQUIRED` | yt-dlp 要用户同意下载或更新：转告用户，照 `next` 做 |
| `EXPORT_TOOL_MISSING`、`MEDIA_TOOL_UNAVAILABLE` | 缺 ffmpeg：照 `remedy` 转告用户 |
| `ASSET_MISSING` | 链接的原文件被移动或删除：请用户放回原处或给新位置 |
| `INPUT_TOO_LONG` | 图片提示词超长：缩短后重提 |
| `CAPABILITY_NOT_CONFIGURED` | 没有可用的图片模型：见 [models](models.md) |
<!-- surface: agent -->
| `DECK_NOT_FOUND`、`NOT_A_DECK` | 路径不是 deck 目录（没有 `deck.json`，或它不是幻灯片的索引）：核对路径 |
| `SLIDES_COMPILER_UNAVAILABLE` | 这台机器上的 BaoCut 没带幻灯片编辑器：deck 文件照样写好，告诉用户没法校验、也没法在 BaoCut 里打开，不要自己找编译器 |
| `CANVAS_NOT_FOUND`、`NOT_A_CANVAS` | 路径不是设计稿目录（没有 `canvas.json`，或它不合格式）：核对路径；导入素材前先写好 `canvas.json` |
| `UNSUPPORTED_ASSET_TYPE` | 只能导入 png、jpg、gif、webp、avif、svg 图片；设计稿另收 woff2、woff、ttf、otf 字体 |
<!-- /surface -->

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
