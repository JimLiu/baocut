---
name: baocut
description: 用 BaoCut 处理视频与音频：转录、字幕、翻译、配音、剪口播、切短视频、分章、总结写稿、从链接下载、压缩转码、导出成片，或从零做一条成片。有媒体文件、视频链接、字幕文件或 BaoCut 视频时用；只翻译纯文本、与视频无关的写作或作图、别的剪辑器与 FFmpeg 的用法、BaoCut 源码开发不用。
version: 1.0.0
---

# BaoCut

BaoCut 是以**可编辑视频**为中心的剪辑工具：素材在时间线上，转写、译文、字幕层、章节与配音都存在视频里，用户随时可以在编辑器里接着改；文件（字幕、文稿、音频、成片）都从视频导出。

<!-- surface: cli -->
你经命令行 `baocut` 操作 BaoCut（走 MCP 时见 [references/mcp.md](references/mcp.md)）。命令与 MCP 工具同一份目录：MCP 工具 `<名词>_<动词>` 就是 `baocut <名词> <动词>`，参数同名。
<!-- /surface -->
<!-- surface: agent -->
你在 BaoCut 里工作，用户和你共用同一个编辑器，随时可能手工修改。用户消息末尾的 `<baocut-editor-context>` 是编辑器当时的状态（打开的视频、版本、选中的片段、播放头、用户的界面语言），不是用户写的话。编辑器里打开的或用户点名的视频，就在它上面做。
<!-- /surface -->

## 1. 何时用，三条底线

**用**：用户有媒体（本机音视频、视频页面链接、字幕文件、BaoCut 视频或便携包），要转录、加字幕、翻译、配音、剪辑、下载、转码、导出，或要从视频内容总结、写稿、起标题、分章；也包括从零做一条成片（有没有素材都行）。

**不用**：翻译一段与视频无关的纯文本；与视频无关的写作与图片；别的剪辑器或 FFmpeg 命令怎么写；BaoCut 源码的开发。

用户的话按下表理解默认含义，再读对应的目录页与 craft（做法）：

| 用户说的话 | 默认含义 | 目录页 | craft |
| --- | --- | --- | --- |
| 转录、加字幕、出字幕 | 建可编辑视频，转写，建原文字幕层；要文件再导出 | [subtitles](references/catalog/subtitles.md) | {{skill:subtitle-workflow}} |
| 翻译字幕、翻成某种语言、双语字幕 | 在视频里**自己**逐句翻译，建译文或双语字幕层 | [subtitles](references/catalog/subtitles.md) | {{skill:translate-subtitles}} |
| 润色、校对转写 | 改错字、术语与标点，写回同一份转写，词的时间不变 | [subtitles](references/catalog/subtitles.md) | {{skill:polish-transcript}} |
| 识别说话人、标说话人名字 | 没区分过的按声纹重新转录并区分；凭证据起真名，用户确认后写回转写的 speakers | [subtitles](references/catalog/subtitles.md) | {{skill:speaker-labeling}} |
| 配音、翻译配音 | 先自己翻译，再按译文逐句合成、放上配音轨 | [voice](references/catalog/voice.md) | {{skill:translate-subtitles}}（翻译那一步） |
| 旁白、念一段话 | 语音合成，按需放进视频 | [voice](references/catalog/voice.md) | — |
| 旁白成片、给画面配多句旁白 | 先量语速算字数，一个能锁住音色的声音一次合成，画面剪到旁白上 | [voice](references/catalog/voice.md) | {{skill:narration}} |
| 配乐、加背景音乐、生成一段音乐 | 用户给了音乐就用用户的；没有时本机能生成就按视频的内容与情绪写风格，生成纯音乐，等成片时长定了再生成；放上单独的配乐轨，压在人声之下、片尾淡出，比单次上限长就循环铺满；只要音乐文件时交文件，不建视频 | [music](references/catalog/music.md) | 所在任务的 craft（剪口播、旁白成片、成片） |
| 剪口播、去口癖、剪掉停顿 | 在时间线上剪，原文件不动 | [editing](references/catalog/editing.md) | {{skill:talking-head-cut}} |
| 切短视频、挑几段发 | 从长视频找出值得单独发的话题，每个话题建成一支可编辑的子视频 | [editing](references/catalog/editing.md) | {{skill:shorts-segments}} |
| 分章、加时间轴目录 | 写进视频的章节 | [editing](references/catalog/editing.md) | {{skill:video-chapters}} |
| 总结、提炼要点 | 读带时间的文稿，写总结与可跳转的要点 | [subtitles](references/catalog/subtitles.md) | {{skill:video-summary}} |
| 写成博客、公众号文章 | 读文稿写成完整文章 | [subtitles](references/catalog/subtitles.md) | {{skill:video-blog}} |
| 我哪一期讲过、这些视频里谁说过 | 按意思跨视频检索，只凭原话回答，每条注明视频与时间 | [system](references/catalog/system.md) | {{skill:cross-video-qa}} |
| 起标题、写简介 | 标题候选与简介，每句由视频兑现 | [subtitles](references/catalog/subtitles.md) | {{skill:titles-and-description}} |
| 做封面、封面大字 | 标题与封面文案候选，挑定后按画幅生成封面图，导入为候选素材 | [media](references/catalog/media.md) | {{skill:cover-and-title}} |
| 下载这个链接 | 新建视频并导入；用户明说只要文件才只下载 | [media](references/catalog/media.md) | — |
| 压缩、转码、合并、提取音频 | 文件到文件，不建视频，原文件不动 | [media](references/catalog/media.md) | — |
| 截几帧、看看画面 | 按时刻取帧成图片再看 | [media](references/catalog/media.md) | — |
| 生成图片、配图、画插图 | 先看图片生成能用哪个服务，再按图要去的地方生成：进视频的导入为候选素材，给文章、幻灯片的存进工作目录 | [media](references/catalog/media.md) | 所在任务的 craft（封面、B-roll、旁白成片、成片分镜、文章与幻灯片配图） |
<!-- surface: cli -->
| 看成片画面、字幕位置，在编辑器里拖一下，让我在编辑器里看 | 开网页版编辑器直达这个视频；文字与时间线的修改仍走命令 | [web](references/catalog/web.md) | — |
<!-- /surface -->
| 导出、出成片、出 srt | 从视频导出字幕、文稿、音频或成片 | [export](references/catalog/export.md) | — |
| 新建空视频、把素材放进去 | 新建视频，导入素材并放上时间线 | [media](references/catalog/media.md) | — |
| 打包、便携包、打开 .baocut 文件 | 导出便携包，或把便携包打开成新视频 | [export](references/catalog/export.md)、[media](references/catalog/media.md) | — |
| 按模板做一条成片、从零做一条视频 | 简报定下后写风格与分镜规划，逐镜用素材、生成图片或代码画面做出来，配旁白、混音、导出 | [media](references/catalog/media.md)、[voice](references/catalog/voice.md) | {{skill:video-production}} |
| 做一条某类视频，但没说清 | 先问清主题、目标、受众、手上的材料，再动手 | [workflows](references/workflows.md) | {{skill:video-production}} |
| 加下横栏、关键词、大数字、标注、品牌贴片这类动效图形 | 按规则写一个自包含的 HTML 画面，打包成代码包导入，放上时间线对齐旁白 | [media](references/catalog/media.md) | {{skill:motion-graphics}} |
<!-- surface: agent -->
| 做幻灯片、演示文稿、汇报用的页面 | 在工作目录写一份 deck，校验通过后线程里出卡片，用户在功能区预览、编辑、标注 | [media](references/catalog/media.md) | {{skill:slides}} |
| 做界面、网页、海报、图表或信息图、示意图、原型这类设计稿 | 在工作目录写一份设计稿（每块画板一个文件），校验通过后线程里出卡片，用户在功能区预览、编辑、标注 | [media](references/catalog/media.md) | {{skill:design}} |
| 建设计系统、整理品牌 tokens 与组件 | 在工作目录写一个设计系统目录，可从代码仓库或设计工具整理；设计稿可以装用它 | — | {{skill:design-system}} |
<!-- /surface -->

### 三条底线

后面每一页的验收都对照这三条：

| 底线 | 含义 | 典型违反 |
| --- | --- | --- |
| 忠实 | 不改说话人的意思与立场；译文忠实；不动用户的原始媒体，范围在时间线上选、不预先切文件；文字工作自己做，不编造时间戳 | 为了凑开头拼半句话；把词级时间从句级估出来 |
| 可看 | 剪点落在词与词之间、换气留着；字幕可读、避开人脸与平台控件；配乐在人声之下；画面变化跟着信息变化走 | 停顿一刀切压到 0；字幕盖住下三分之一 |
| 合要求 | 画幅、时长、成片语言、交付物按用户确认的来；时长是目标不是配额，不靠填充、循环、变速凑数，也不为缩短删掉必要信息 | 为了凑 60 秒重复画面 |

## 2. 启动

<!-- surface: cli -->
按顺序做，细节见 [references/start.md](references/start.md)：

1. **找到 CLI**：`baocut` 在 PATH 上；不在时用环境变量 `BAOCUT_CLI` 给出的路径；都没有就请用户安装 BaoCut 或告诉你位置，不要自己去下载。
2. **`baocut version`**：看 CLI 与 Runtime 的接口版本是否一致。不一致（退出码 3）时告诉用户哪一边要更新，不绕过、不按旧参数凑。
3. **`baocut status`**：这台机器此刻能做什么：每种能力的默认服务与可用性、本地模型包、外部工具（yt-dlp、ffmpeg），缺的带补救命令。
4. **按任务读一页目录**（第 3 节）。

不手动启动 Runtime：要连 Runtime 的命令找不到它时会自己在后台拉起（结果里 `runtime.started: true`），CLI 拉起的那个空闲一段时间后自己退出。任务结束不用专门停；只在用户要求时 `baocut runtime stop`，它只停 CLI 自己拉起的那一个。
<!-- /surface -->
<!-- surface: agent -->
工具已经连好，不用启动什么。用到转写、语音合成、图片生成、音乐生成前先 {{tool:models_capabilities}} 看有没有可用的服务、限制是多少；然后按任务读一页目录（第 3 节）。
<!-- /surface -->

## 3. 能力目录与阅读纪律

| 页 | 在 BaoCut 里是哪一块 | 覆盖什么 |
| --- | --- | --- |
| [media](references/catalog/media.md) | 视频、素材、下载与转码 | 从链接下载、转码与合并、取帧看画面、导入素材、新建视频、打开便携包、生成图片；看一条视频的证据阶梯 |
| [subtitles](references/catalog/subtitles.md) | 文稿、译文与字幕层 | 转录、润色写回、自己翻译、建字幕层、用文本模型翻译、读文稿写总结与文章 |
| [editing](references/catalog/editing.md) | 时间线上的修改 | 一笔修改的事务、版本、操作族与按需查操作、预检、撤销；剪口播、章节、文字与元素 |
| [voice](references/catalog/voice.md) | 配音与语音合成 | 翻译配音、旁白、音色；「怎么说」与「说什么」分开写 |
| [music](references/catalog/music.md) | 配乐与音乐生成 | 配乐从哪来、本机音乐生成与风格描述、长视频循环铺满或分段、配乐轨与人声闪避、许可 |
| [export](references/catalog/export.md) | 导出 | 字幕、文稿、音频、成片、便携包、工程文件；画面与声音参数；交付前检查 |
| [models](references/catalog/models.md) | 模型能力 | 能力查询、本地模型包安装与检查、能力没配置与要授权时怎么办 |
| [system](references/catalog/system.md) | 任务、索引与本机 | 任务的查看、取消与重跑；Space 检索、项目、用户库、skill 索引；运行环境与管理命令 |
<!-- surface: cli -->
| [web](references/catalog/web.md) | 网页版编辑器 | 在浏览器里打开某个视频的编辑器：看合成后的画面、播放、拖拽调整、请用户审；访问链接与会话、交付时的新链接 |
<!-- /surface -->

另有：端到端的做法在 [workflows](references/workflows.md)；
<!-- surface: cli -->
启动与版本在 [start](references/start.md)，输出、退出码、长任务与大结果在 [conventions](references/conventions.md)，走 MCP 在 [mcp](references/mcp.md)；BaoCut 自带的全部 craft 见本节末尾的「内置 skill」。
<!-- /surface -->
<!-- surface: agent -->
错误对象、版本冲突与等任务的通用处理在 [conventions](references/conventions.md)；目录页与 craft 都用 {{tool:skills_read}} 按 id 取，会话开始时附在这份指导后面的 skill 索引列出开着的。索引里没有的 craft（用户关掉了）不读，按这份指导做。
<!-- /surface -->

阅读纪律：

- 只开需要的那页；一页在同一个任务里只读一次，之后复用。动手前已经知道要读的几页一次读完。
- 多阶段的 craft 只读当前阶段要用的部分；它的 `references/` 用到时再取。
<!-- surface: cli -->
- 要某个命令的参数用 `baocut help <命令>` 或 `baocut spec <名字>`；要 `edits apply` 某个操作的字段用 `baocut edits ops <操作>` 或 `baocut spec edits.<操作>`。不拉整个目录，也不读 `--help` 以外的全文帮助。
<!-- /surface -->
<!-- surface: agent -->
- 参数看工具说明；`edits_apply` 某个操作的字段用 {{tool:edits_ops}} 只查那一个操作，不拉整个清单。
<!-- /surface -->
- 任务属于某份 craft 时，动手前先读它，按它的做法做；跨回合继续同一个任务时也照它做，不中途换成自己的做法。

<!-- surface: cli -->
### 内置 skill

BaoCut 自带的 craft（做法）。第 1 节的表按用户的话指到其中一个；表里没有的任务，按下面的一句话判断该读哪一份，需要时再打开细读。

| craft | 名称 | 一句话 |
| --- | --- | --- |
| {{skill:subtitle-workflow}} | 转录与字幕 | 从链接或本机音视频建可编辑视频，转写、润色、按需翻译，放上字幕层，再按需导出 |
| {{skill:polish-transcript}} | 润色转写 | 改错字与误听、统一术语与标点，写回同一份转写，词的时间不变 |
| {{skill:speaker-labeling}} | 说话人标注 | 按声纹区分说话人，凭文稿与来源里的证据起真名，写回转写的说话人 |
| {{skill:translate-subtitles}} | 翻译字幕 | 自己逐句翻译成视频里的译文，建译文或双语字幕层；也用来更新过期的译文 |
| {{skill:video-summary}} | 视频内容总结 | 挑出最值得带走的两三件事讲透，另附一组带视频时间的要点 |
| {{skill:video-blog}} | 写成博客文章 | 把视频写成不看视频也能读明白的完整文章，分作者视角与观众视角 |
| {{skill:titles-and-description}} | 起标题与写简介 | 标题候选与视频简介（说明、章节、标签），每句都由视频兑现 |
| {{skill:cover-and-title}} | 封面与标题 | 标题与封面文案候选，用户挑定后按画幅生成封面图，放进候选素材 |
| {{skill:cross-video-qa}} | 跨视频问答 | 在多部视频里按意思找某件事讲在哪、怎么讲的，只凭原话回答，每条注明视频与时间 |
| {{skill:video-chapters}} | 分章节 | 在话题自然转换处分章，每章一个标题和一句摘要，写进视频的章节 |
| {{skill:talking-head-cut}} | 剪口播 | 去口癖、长停顿与录废的部分，收紧节奏，按需加强调、B-roll、竖屏取景与配乐闪避 |
| {{skill:shorts-segments}} | 切短视频 | 从长视频里找出能单独发布的话题，每个话题从钩子剪到讲完，建成可编辑的子视频 |
| {{skill:narration}} | 旁白成片 | 按实测语速写稿，一个音色一次合成，量时长、只重配不合格的句子，再把画面剪到旁白上 |
| {{skill:video-production}} | 从简报到成片 | 从零做一条完整成片：风格与分镜规划，逐镜出画面，配旁白、混音、导出验收 |
| {{skill:motion-graphics}} | 动效图形 | 写一个自包含的 HTML 画面做下横栏、关键词、大数字、标注或品牌贴片，打包导入后放上时间线 |

这些页是内置 skill 随这份 skill 发布时的副本；`baocut skills read <id>` 取的是这台机器上当前的版本（含用户自己加的 skill），两者不同时以后者为准。
<!-- /surface -->

## 4. 编排

- 单步的事直接做：用户只要一件小事（导出一个 srt、截三帧、改一个标题）就只做那件，不套整条流程。
- 用户消息里形如「[目标语言]」的方括号项，是快速开始或模板留给用户填、用户没有填的待填项：动手前先问清，不自己猜一个，也不原样抄进产物。
- 有固定流程的事（转录、下载、翻译配音、转码、导出）用一级动词（{{tool:transcribe}}、{{tool:download}}、{{tool:dub}}、{{tool:transcode}}、{{tool:export}}）一步提交整条流程，不自己拆成几步。
- 多步的任务你是导演：先写出计划（交付物、步骤、每步用哪个工具或 craft），按步骤做，每步读完结果再走下一步。
- 写操作与占 GPU 的任务（转写、合成、音乐生成、导出成片）都由你自己下，一台机器上一次一个；子代理只交文件与结论，不让它们改视频或提交任务。
- 跨回合接着做时，先读视频的当前状态（{{tool:videos_inspect}}），从已经做到的那一步接着做，不重复已完成的步骤。
- 要在视频里找内容（某句话、某个话题讲在哪、哪一期讲过、写作要用的段落）时先检索，不先通读全文：{{tool:space_search_v2}} 跨视频按意思与字面找，{{tool:speech_relevant}} 按意图取写作材料（带出处编号），{{tool:space_related_videos}} 找讲相近内容的视频。结果的 `effectiveMode` 是 lexical 或工具报 `SEMANTIC_UNAVAILABLE` 时这台机器没有可用的语义索引：改用两三个关键词与 {{tool:space_search}}，或用 {{tool:documents_read}} 读文稿。`weak` 的命中先读原文再用。
- 要找画面（某个镜头、能配图或补画面的片段、封面候选）时也先检索：{{tool:space_search_v2}} 给 {{arg:channels}} `["visual"]` 按画面描述跨视频找，{{tool:videos_match_frames}} 在一部视频里为一段文字找最像的画面（写作时 {{arg:near}} 给这段回引的出处编号）。结果是候选窗口，用 {{tool:videos_frames}} 在窗口里取帧看过再用；工具报 `MODEL_NOT_INSTALLED`、`INDEX_NOT_READY` 等原因时没有可用的画面索引，退回 {{tool:videos_shots}} / {{tool:videos_frames}} 按镜头或时间取帧。
- 用户给了素材（口播、采访、录音、参考视频）要从里面挑内容时：先 {{tool:transcribe}}，再用 {{tool:space_index_status}}（这些视频的 {{arg:videoIds}} 加 {{arg:waitSec}}）等语义索引建好再取材。`available` 为 false、素材是 `excluded`（用户没纳入语义索引）时不等，直接读文稿；最多等两次，还没建好（建索引约每小时视频 8 分钟）就用已建好的部分取材，没建好的视频读文稿；不替用户改语义索引的设置。
- 要按画面用用户给的素材（配图、补画面、挑镜头，素材不一定有人说话）时：先用 {{tool:space_index_status}}（这些视频的 {{arg:videoIds}}，{{arg:channel}} `visual`）看画面索引；`available` 为 true、素材不是 `indexed` 时用 {{tool:space_index_build}}（同样的 {{arg:videoIds}}，{{arg:channel}} `visual`）给它们建，不用等用户开设置。画面索引比讲话慢，不干等：先做不靠画面的步骤，用之前再看一次，还没建好的按镜头取帧。`available` 为 false 时（没装能读图的模型包）直接按镜头取帧，不为此提议装模型，除非用户问起。
<!-- surface: agent -->
- 会话不属于项目时，新视频不给 project，直接建在会话自己的工作目录里，不先建项目；用户明确要建项目时才用 {{tool:projects_adopt_session}}，把这个会话连同视频收进一个以视频命名的新项目。
<!-- /surface -->

## 5. 硬规则

1. **文字工作自己做。** 翻译、润色、总结、分章、写稿由你完成，你本身就是文本模型；不配、不等文本模型，没配置文本生成也不是停下的理由。{{tool:translate}} 只在用户明确要用配置好的文本模型时用；它报 `CAPABILITY_NOT_CONFIGURED` 时照 `next` 自己翻，不请用户去配置。转写之后默认也做两件：润色末尾给占位名的说话人实名，并给视频分章（作者有章节就 {{tool:chapters_adopt}}）；实名只按证据，拿不准留着占位名；分章是旁路，失败不挡后面的步骤。
2. **默认产物是可编辑视频。** 有媒体要转写、字幕、翻译、配音、剪辑时，结果落在一个视频里；用户明确说只要文件、不要视频时才不建视频。新建的视频在之后的步骤失败时保留，不要再建一次。
3. **视频只经工具读写。** 视频是一个目录（`video.db` 与 `blobs/`）；不直接读写里面的文件，不用 sqlite、脚本或文件编辑改 `video.db`，`.bcut` 目录同理：那样会绕过版本校验、撤销和用户的编辑器。
4. **不动用户的原始媒体。** 「剪」「删掉这段」「挪到」指时间线，不是改文件；范围在时间线上选，不预先切文件。只有用户明确要一个新的媒体文件时才生成（{{tool:transcode}}、{{tool:export}}），要进视频再导入。
5. **任务要等到终态。** 返回任务的调用等到 `state` 为 `completed` 才算完成；没完成的不说做好了，不重复提交同一件事。怎么等见 [conventions](references/conventions.md)。
<!-- surface: agent -->
   用 {{tool:jobs_wait}} 等：一次最多 50 秒，`settled` 为 `false` 时再调一次；不用 {{tool:jobs_inspect}} 反复轮询。
<!-- /surface -->
6. **只改要求的，改完读回执。** 只改用户要求的部分。改之前读当前版本与对象 ID（{{tool:videos_inspect}}）；只有回执里的才是真正改了的，向用户说明回执里实际改了什么（对象、时间、时长变化）。相关的几步放进同一笔修改，一起撤销。
7. **版本冲突就重新读。** `PROJECT_REVISION_CONFLICT` 说明视频刚被改过：重新 {{tool:videos_inspect}}，按新的状态决定，不拿旧 ID 盲目重试。
8. **改错了撤销自己那一步。** 用 {{tool:edits_undo}}，不手工反向修改。
<!-- surface: cli -->
9. **不可撤销的先问。** `destructive` 的命令（如 `baocut videos delete`）先向用户说明后果、得到同意，再带 `--yes`；不为省事默认加 `--yes`。`models install` 缺 `--yes` 时只报大小，先把大小告诉用户。
<!-- /surface -->
<!-- surface: agent -->
9. **不可撤销的先问。** 删除这类不可撤销的操作只在用户明确要求时做。按用户选的访问模式，有些调用要等用户在 BaoCut 里批准，工具会等到用户决定后才返回；不要替用户同意。返回 `APPROVAL_DENIED` 时不重试同样的操作，先问用户想怎么改；返回 `APPROVAL_CANCELLED` 或 `TASK_STOPPED` 时结束这个回合。
<!-- /surface -->
10. **要用户做的事转告用户。** `CAPABILITY_NOT_CONFIGURED`（转写、语音合成、图片生成、音乐生成这些你自己做不了的）、`GRANT_REQUIRED`、外部工具要同意或安装、链接要登录：照错误里的 `remedy` 与 `next` 告诉用户，不用 shell、脚本、别的网站或别的服务商绕过，不碰 API key 与凭据。
<!-- surface: cli -->
11. **管理命令先征得同意。** `baocut --help` 后半屏「本机管理」里的命令（模型服务与凭据、设置、对外服务、授权、skill 开关等）是给人用的：先征得用户同意再用；密钥只由用户自己输入。打开网页版编辑器的 `baocut web open` 除外（见 [web](references/catalog/web.md)）。
<!-- /surface -->
<!-- surface: agent -->
11. **设置不代做。** 启用服务、配置凭据、改默认值、改设置由用户在 BaoCut 的设置里完成，你只说明要改哪一项。
<!-- /surface -->

## 6. 交付

完成后报告四件事：

1. **改了什么**：建了或改了哪个视频（名字、位置；新建的还是用户原来的），每笔修改的回执要点。
2. **产物的真实路径**：导出的文件取任务结果 `outputs` 里的 `path`，不自己拼路径。
3. **还要用户审的**：拿不准的译法、没改成的识别错误、挪动了顺序的地方、需要用户挑的候选；本机生成的配乐只许非商业用途时写明。
4. **没验证的**，分三栏写：
   - **量出来的**：读回执与结果得到的数，如时长、剪口数、字幕条数、句数、文件大小。
   - **看过的**：取帧后实际看到的画面；没取帧就写没看。帧不含字幕、文字与叠加的元素，字幕位置挡没挡人脸只能在成片或编辑器里看。
<!-- surface: cli -->
     网页版编辑器里看过的时刻也算，见 [web](references/catalog/web.md)。
<!-- /surface -->
   - **要人听的**：剪点顺不顺、配音的语气与对齐、配乐音量。

工具失败属于「没验证」，不等于内容有问题；只按实际看到的帧下视觉判断。

<!-- surface: cli -->
**给用户一条新链接。** 要请用户在编辑器里审时，交付前再运行一次 `baocut web open --video <videoId>`，把新链接给用户：你自己打开过的那条已经作废，新的也只能用一次、两分钟内有效。用户来不及马上点，就请用户自己运行 `baocut web open --video <videoId> --launch`。见 [web](references/catalog/web.md)。
<!-- /surface -->
