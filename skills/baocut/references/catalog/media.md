---
description: 媒体的机制：从链接下载、检索与下载网上素材、转码与合并、取帧看画面、导入素材（链接还是复制）、新建视频、打开便携包、生成图片（含成套的角色姿势与场景底图），以及看一条视频的证据阶梯。下载、导入、取帧或生成图片之前读。
---

# 媒体：下载、网上素材、转码、取帧、素材与新建视频

## 何时用

- 用户给了视频页面的链接，要下载、导入或在它上面做事。
- 片子要真实的地点、事件、人物或产品画面，用户素材不够：主动检索网上素材。
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
| 放到别处（外置盘、某个文件夹） | 加 {{arg:outDir}}（任意目录，不存在时建好），代替下载目录；导入视频时素材链到那里。不请用户去改设置。只给 {{arg:project}} 时不能给，对外服务不能给 |
| 同时取平台字幕 | 加 {{arg:subs}}（语言列表），字幕文件放在媒体旁边、不导入视频 |
| 只要音频 | 加 {{arg:audioOnly}} |
| 视频要登录才能看 | 默认按用户在设置 › 视频下载选的浏览器；用户指明浏览器时加 {{arg:cookieBrowsers}}（例如 `["chrome"]`，按顺序尝试）；{{tool:transcribe}} 给 {{arg:url}} 时同样 |

{{arg:video}}、{{arg:newVideo}}、{{arg:project}} 三选一。只取单个视频，不取播放列表。

网站登录：不给 {{arg:cookieBrowsers}} 时按用户在 BaoCut 设置 › 视频下载里选的浏览器（默认所有检测到的），提交时冻结；给 `[]` 是匿名。只在用户说了用哪个浏览器时给，确认时会列出这些浏览器。对外服务（MCP）不能给，要登录的视频请用户在 BaoCut 里下载。

要转写时知道语言或有人名、术语，直接用 {{tool:transcribe}} 给 {{arg:url}}，带上 {{arg:language}}、{{arg:hint}}（也可给 {{arg:provider}}、{{arg:diarize}}）：它下载、新建视频、转写并建字幕层；{{tool:download}} 的 {{arg:transcribe}} 只用默认设置转写、不建字幕层。

### 找网上素材

| 要做的事 | 调用 |
| --- | --- |
| 找视频素材（三处都查） | {{tool:assets_search}}，{{arg:query}} 用英文写要拍到的东西、地点或事件 |
| 找图片或音频 | 加 {{arg:kind}} `image` 或 `audio`（只查 Commons 与 Internet Archive） |
| 成片要商用 | 加 {{arg:commercial}}：去掉只许非商业用途的 |
| YouTube 只要知识共享的 | 加 {{arg:creativeCommons}} |
| 先看画面再挑 | 加 {{arg:preview}}：缩略图拼成一张接触表 |
| 下载 Commons / Internet Archive 的一条 | {{tool:assets_download}}，{{arg:source}} 与 {{arg:id}} 照抄，{{arg:video}} 给目标视频；要放上时间线加 {{arg:place}}；视频太大时给小一点的 {{arg:maxHeight}} |
| 只要文件、存到某个文件夹 | {{tool:assets_download}}，{{arg:source}} 与 {{arg:id}} 照抄，{{arg:outDir}} 给目录、不给 {{arg:video}}：重名时编号，不覆盖，不导入视频；对外服务不能给 |
| 下载 YouTube 的一条 | {{tool:download}}，{{arg:url}} 给候选的 `pageUrl`，{{arg:video}} 给目标视频 |

候选的 `downloadWith` 说用哪个工具下载。Commons 与 Internet Archive 的许可清楚：public-domain 与 cc0 随便用，cc-by 要署名，cc-by-sa 还要求成片用同样的许可（先告诉用户），带 nc 的只许非商业用途。YouTube 的许可多半没写（`license.class` 为 `unknown`，版权归上传者）：下载前把要用的几条（标题、频道、链接）告诉用户，由用户决定。

网站登录：YouTube 的检索与 {{tool:download}} 一样按设置 › 视频下载里选的浏览器带 Cookie（对外服务匿名）。检索结果的 `errors` 里 youtube 报 `LINK_LOGIN_REQUIRED`（YouTube 要求登录或确认不是机器人）或 `LINK_COOKIES_UNAVAILABLE` 时，媒体库的结果照用，同时提醒用户在浏览器里登录 YouTube、到设置 › 视频下载勾选那个浏览器（用 `settingsHref` 写成设置链接），弄好后再检索。

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
- 本机（`local`）模型的提示词上限可能只有一千字左右，一次一张，一张要几分钟到十几分钟，大尺寸的可到半小时。本机任务共用 CPU：生图期间导出、烘焙、转写都会排队（任务里的 `waiting` 写 `Waiting for resources`），所以生图最先提交，等的时候写稿、写代码。
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

**成套素材**：代码画面要让角色、道具动起来，或者要换背景时，素材要成套地画：

- **先定角色设定图**：每个角色先出一张设定图（正面全身，加几种表情），看过脸、手与轮廓再定稿。之后的姿势、换装都以它为准：模型收输入图时把它放进 {{arg:images}}，提示词写明同一角色、同一风格，一次只改一处；不收时逐字复用同一段角色描述。不凭文字从头再画一次同一个角色。
- **姿势与贴图画成一张网格**：同一角色的几种姿势、表情，或一套小道具，一次画进一张网格（例如 3×3）。一张网格只画一个角色：两个角色的互动在代码里摆，画在一起的只用于封面、海报。提示词里写明：格数，每格一个、互不重叠、不出格，手脚伸到最远也留着边；朝向与占格子高度的比例；纯色底，选角色身上没有的饱和色，默认品红 `#FF00FF`，角色带粉、紫时改用绿 `#00B140`；不要阴影与地面。角色的整段描述与风格说明各张逐字复用。同一张图里的角色比分开画的更像同一个，调用次数也少。
- **抠图与切开**：按与底色的距离抠成透明，边缘留几个像素的半透明过渡，并去掉底色溢到边上的颜色；再按连通块的中心归到各格，逐个裁出。切完看一遍，粘连、缺件或带底色边的重画那一张。图里冒出和角色不相连的字或图案时，只留角色所在的那个连通块（从躯干上取一点作起点）；字压在身体、头发上的抠不干净，重画。
- **纯色底靠不住的模型**：本机模型常不按「纯品红底」出图（格子里是别的底色，抠不了）：先抠一张试试，不行就把格子裁成卡片直接用，或改用代码画矢量。
- **场景底图**：按画幅画，提示词写明不要人物、不要文字，字幕所在的那一条留暗、留干净。用的时候铺满裁切，慢慢推拉，压暗到前景看得清。
- **动起来**：角色动画靠换姿势，加上代码里的位移、旋转、挤压，不逐帧生成。图标、光效这类简单元素直接用代码画（SVG 或 Canvas 路径），不用系统 emoji。
- **读不进时**：个别服务产出的 PNG 带非标准的数据块，有的解码器读不进：重新编码一遍再用。

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

### 文档

一份文档是工作目录里的一个目录（`doc.json`、每个标签页一份 `tabs/<id>.json`、`comments.json` 与 `assets/`），**不用文件工具写**：全部经 `docs_*` 工具，每个都带 {{arg:doc}}（文档目录）；怎么做见 {{skill:docs}}。

| 要做的事 | 调用 |
| --- | --- |
| 新建一份文档（骨架），或在文档上原子地执行一组改动 | {{tool:docs_batch}}；新建时 `container.create`，线程里出文档卡片 |
| 读文档、标签页的大纲、一段、搜索或某个 rev 以来的变化 | {{tool:docs_read}} |
| 改正文，或标签页的名字、顺序与层级 | {{tool:docs_update}} |
| 评论与回复、下拉选项、标签页 | {{tool:docs_create}}；列评论线程 {{tool:docs_query}}，删除 {{tool:docs_delete}} |
| 把工作目录里的图片或文件放进文档 | {{tool:docs_upload}}，{{arg:doc}} + {{arg:path}}；正文用 `blob/<id>` 引用 |
| 导出 Markdown | {{tool:docs_export}}；带 {{arg:to}} 时写成工作目录里的 `.md` |
<!-- /surface -->

### 找镜头切换

{{tool:videos_shots}}：{{arg:range}}（`起:止`，剪辑后时间线上的秒，最长 20 分钟）里画面在哪里切换。换了片段、画面接不上的地方是 `edit`；片段里的画面突变按场景分数检测，是 `scene`。漏报时调低 {{arg:threshold}}（默认 0.3），多报时调高；{{arg:minShot}}（默认 0.8 秒）以下的镜头并进前一个。

- 只看画面突变，不认人：叠化、推拉会漏，闪光可能多报。拿不准的切换点用 {{tool:videos_frames}} 取它前一帧与它本身看一眼。
- 每个镜头的 `sampleAt` 是 3 个时刻，直接交给 {{tool:videos_frames}} 的 {{arg:at}}；一次最多 24 帧，也就是 8 个镜头。

## 结果怎么读

- {{tool:download}} / {{tool:transcribe}}：`pipeline.summary.videoId` 是新视频，`assetId` 是素材；`outputs` 里有下载的文件与文稿的 `path`。给链接时 summary 另有 `description`（截断的简介）与 `sourceChapters`（作者章节的条数）。
- 链接导入的素材：{{tool:videos_inspect}} 的 `assets[].source` 是来源元数据：`platform`、`webpageUrl`、`uploader`（发布者）、`uploadDate`、`title`、`description`（最多 1200 字符，被截断时 `descriptionTruncated` 为 true）、`chapters`（作者的章节 `[{ at, title }]`，平台给的或从简介的时间戳大纲解析出的，没有时 `[]`）。它是背景参考，不是文稿内容：润色时人名与术语的写法只在说话人明显在说它时照改，说话人实名时只在它唯一指明某一位时算证据（见 [subtitles](subtitles.md)）；作者章节用 {{tool:chapters_adopt}} 写进视频（见 [editing](editing.md)）。
- {{tool:videos_inspect}} 的 `brief`：写过视频速览时有，`markdown` 是正文（时间链接已换成完整的 `/videos/<videoId>?t=<秒>`），`language` 是正文的语言；没写过时没有这一项。章节（`chapters`）每章带 `href`，写速览的要点时照抄。
- {{tool:transcode}}：`outputs` 的 `path`（`pipeline.summary.files`）是输出文件，把位置告诉用户。
- {{tool:videos_frames}}：`frames` 每帧有 `at`、`file`、`width`、`height`、`faces` 与取自哪个片段（`item`）、哪个素材（`asset`）。读 `file` 这张图片。`faces` 是 `[{x, y, w, h, score}]`：框的左上角与宽高，按帧的宽高归一化到 0–1，`score` 0–1，按 score 从高到低；顶层 `detector` 是 `yunet`，检测器不可用时为 null（`faces` 都是空数组）。`file` 为 null 的帧没有 `faces`。
- {{tool:videos_shots}}：`cuts` 每处有 `at`（新镜头第一帧的秒）、`score`（`edit` 为 null）与 `kind`；`shots` 每个有 `start`、`end` 与 `sampleAt`。
- {{tool:assets_import}}：回执里有 `assetId`、`itemId`（没放上时间线时为 null）与新版本。
- {{tool:assets_search}}：`candidates` 每条有 `source`、`id`、`title`、`kind`、尺寸与时长（archive 与 youtube 没有尺寸）、`author`、`license`、`attribution`（一行署名）、`pageUrl`、`thumbnailUrl` 与 `downloadWith`；`excluded` 是因许可去掉的条数；`sheet` 是接触表（`sheet.cells[i].at` 是候选的序号）；`errors` 是出错的来源。
- {{tool:assets_download}}：回执里有 `assetId`、`itemId`、`license`、`attribution` 与实际下载的 `file`；给 {{arg:outDir}} 时没有素材，`path` 是存下的文件。网上素材与链接导入的素材在 {{tool:videos_inspect}} 的 `assets[].credit` 里有 `attribution`：成片片尾的署名照它写。
- {{tool:videos_create}} / {{tool:videos_import_package}}：返回与 {{tool:videos_inspect}} 相同的摘要，含 `videoId`。
- {{tool:image}}：`outputs` 里每张图的 `artifactId`；带了 video 时还有 `assetId`。
- {{tool:music}}（见 [music](music.md)）：`outputs` 里是一个 WAV 的 `artifactId`；带了 video 时还有 `assetId`；到了时长预算时 `warnings` 里有 `output-truncated`。
<!-- surface: agent -->
- {{tool:slides_import_asset}}：`src` 形如 `/_blob/<id>`，图片原样写进 `<img src>`，字体原样写进 `deck.json` 里 `faces` 那一项的 `src`；另有 `bytes` 与 `contentType`。
- {{tool:slides_check}}：`problems` 是问题总数，为 0 时线程里记一张幻灯片卡片；否则 `slides` 列出每页的 `problems`，`deckProblems` 是 `deck.json`（含字体与设计系统的记录）与 `ds/` 的问题，`orphans` 是不在 `order` 里的页面文件。每页的 `notes` 不算问题，其中以「排版」开头的是放不下或互相压住的提示，尽量改掉。
- {{tool:design_import_asset}}：`src` 形如 `/_blob/<id>`，原样写进 `<img src>`、`<helmet><style>` 里的 `url(…)` 或 `@font-face`；另有 `bytes` 与 `contentType`。
- {{tool:design_check}}：`problems` 是问题总数，为 0 时线程里记一张设计稿卡片；否则 `issues` 每条有 `file`（相对设计稿目录，`.` 是整个目录）与 `message`，列不下时 `more` 说还有几条。`notChecked` 说明没查的部分：画板脚本能不能跑、排版与视觉效果。
- `docs_*`：结果与 Claude Docs 连接器相同（回执的 `lids`、读到的 `<doc rev=…>` xml、`files[]`、评论的 `rows`）；被拒时错误码就是连接器的拒绝码（`guard_mismatch`、`find_none`、`missing_guard`……），什么也没改，按 {{skill:docs}} 改好后重发整个调用。{{tool:docs_upload}} 返回 `blob`（`blob/<id>`）、`bytes` 与 `contentType`；{{tool:docs_export}} 不带 {{arg:to}} 时返回 `markdown`（太长时 `truncated`）。
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
| `OPEN_MEDIA_LICENSE_EXCLUDED`、`OPEN_MEDIA_LICENSE_UNVERIFIED` | 这条许可不允许剪辑或认不出：换一条检索结果 |
| `OPEN_MEDIA_TOO_LARGE` | 换一条更短的，或给小一点的 {{arg:maxHeight}} |
| `OPEN_MEDIA_UNAVAILABLE` | 来源暂时连不上：稍后重试一次，仍不行换来源 |
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
