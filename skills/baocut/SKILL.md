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
| 有哪些……的视频、播客，哪个视频讲了……，找一下…… | 先在用户的视频库里找，列出库里有的；库里没有、不够或用户要库外的才上网搜，网上的另列 | [system](references/catalog/system.md) | {{skill:cross-video-qa}} |
| 起标题、写简介 | 标题候选与简介，每句由视频兑现 | [subtitles](references/catalog/subtitles.md) | {{skill:titles-and-description}} |
| 做封面、封面大字 | 标题与封面文案候选，挑定后按画幅生成封面图，导入为候选素材 | [media](references/catalog/media.md) | {{skill:cover-and-title}} |
| 下载这个链接 | 新建视频并导入；用户明说只要文件才只下载 | [media](references/catalog/media.md) | — |
| 压缩、转码、合并、提取音频 | 文件到文件，不建视频，原文件不动 | [media](references/catalog/media.md) | — |
| 截几帧、看看画面 | 按时刻取帧成图片再看 | [media](references/catalog/media.md) | — |
| 生成图片、配图、画插图 | 先看图片生成能用哪个服务，再按图要去的地方生成：进视频的导入为候选素材，给文章、幻灯片的存进工作目录 | [media](references/catalog/media.md) | 所在任务的 craft（封面、B-roll、旁白成片、成片分镜、文章与幻灯片配图） |
<!-- surface: cli -->
| 看成片画面、字幕位置，在编辑器里拖一下，让我在编辑器里看 | 开网页版编辑器直达这个视频；给用户审片链接；文字与时间线的修改仍走命令 | [web](references/catalog/web.md) | — |
<!-- /surface -->
| 导出、出成片、出 srt | 从视频导出字幕、文稿、音频或成片 | [export](references/catalog/export.md) | — |
| 新建空视频、把素材放进去 | 新建视频，导入素材并放上时间线 | [media](references/catalog/media.md) | — |
| 打包、便携包、打开 .baocut 文件 | 导出便携包，或把便携包打开成新视频 | [export](references/catalog/export.md)、[media](references/catalog/media.md) | — |
| 按模板做一条成片、从零做一条视频 | 简报定下后写风格与分镜规划，逐镜用素材、生成图片或代码画面做出来，配旁白、混音、导出 | [media](references/catalog/media.md)、[voice](references/catalog/voice.md) | {{skill:video-production}} |
| 做科普、知识讲解、教学视频，把概念、新闻、论文讲明白 | 先在组合入口定这期画面的底是什么，核实资料，从观众的疑问找讲法，给这期找一个自己会讲道理的主体，再按成片做；要另一种语言或画幅的版本时主版本确认后再做 | [media](references/catalog/media.md)、[voice](references/catalog/voice.md) | {{skill:explainer-video}}、{{skill:video-production}} |
| 拿一条新闻、一件事、一段八卦或一个人物、产品的故事去搜素材、切原声、配旁白剪成片子；别的成片里要插一段这样的切片 | 从视频库与网上找真实画面与当事人原声，旁白配好后按字时间切画面，推文、引语、日期做成压在画面上的卡片，画面一直在动 | [media](references/catalog/media.md)、[voice](references/catalog/voice.md) | {{skill:clip-montage}} |
| 做一条某类视频，但没说清 | 先问清主题、目标、受众、手上的材料，再动手 | [workflows](references/workflows.md) | {{skill:video-production}} |
| 有命令行环境、旁白按段配的片子要跑脚本：配音、对齐、打包、摆上时间线、建字幕、叠实拍、量画面占比 | 拷走现成的脚本，写一份计划（配置、旁白稿、场景代码、实拍片段清单）按顺序跑，改一段只重做那一段；脚本不规定片子的形态。没有命令行环境时把定好的段落、实拍片段与卡片写成计划交给 {{tool:edits_assemble}} 一次放好 | [voice](references/catalog/voice.md)、[media](references/catalog/media.md)、[editing](references/catalog/editing.md) | {{skill:production-scripts}} |
| 加下横栏、关键词、大数字、标注、品牌贴片这类动效图形 | 按规则写一个自包含的 HTML 画面，打包成代码包导入，放上时间线对齐旁白 | [media](references/catalog/media.md) | {{skill:motion-graphics}} |
| 把音频做成视频、给播客配上画面与声波 | 建可编辑视频：背景、标题、声波与字幕的颜色按内容定成一套，背景可用 HTML；声波只用内置元素；转写、润色与字幕按对应做法 | [workflows](references/workflows.md)、[editing](references/catalog/editing.md) | {{skill:subtitle-workflow}}、{{skill:polish-transcript}}；HTML 背景按需读 {{skill:motion-graphics}} |
| 给一首歌做 MV、歌词视频；手上有歌词、讲稿或台词，要按声音对上时间 | 转写只取时间，文字以用户的原文为准、写回转写；按需译成双语字幕层，画面按成片做 | [workflows](references/workflows.md)、[subtitles](references/catalog/subtitles.md) | {{skill:polish-transcript}}、{{skill:video-production}} |
| 整镜整段用代码画：逐句配画面、角色小动画、Canvas 或 SVG 场景 | 画面是时间的纯函数，按段打包成代码包导入；角色与场景底图先成套生成，再在代码里动起来 | [media](references/catalog/media.md) | {{skill:video-production}}（代码场景） |
<!-- surface: agent -->
| 做幻灯片、演示文稿、汇报用的页面 | 在工作目录写一份 deck，校验通过后线程里出卡片，用户在功能区预览、编辑、标注 | [media](references/catalog/media.md) | {{skill:slides}} |
| 做界面、网页、海报、图表或信息图、示意图、原型这类设计稿 | 在工作目录写一份设计稿（每块画板一个文件），校验通过后线程里出卡片，用户在功能区预览、编辑、标注 | [media](references/catalog/media.md) | {{skill:design}} |
| 建设计系统、整理品牌 tokens 与组件 | 在工作目录写一个设计系统目录，可从代码仓库或设计工具整理；设计稿可以装用它 | — | {{skill:design-system}} |
| 写报告、提案、计划、信件、手册这类文档，或按文档里的评论改 | 经 docs 工具在工作目录建一份协作文档，先发骨架再逐节填，线程里出卡片，用户在功能区编辑、评论 | [media](references/catalog/media.md) | {{skill:docs}} |
<!-- /surface -->

### 三条底线

后面每一页的验收都对照这三条：

| 底线 | 含义 | 典型违反 |
| --- | --- | --- |
| 忠实 | 不改说话人的意思与立场；译文忠实；不动用户的原始媒体，范围在时间线上选、不预先切文件；文字工作自己做，不编造时间戳 | 为了凑开头拼半句话；把词级时间从句级估出来 |
| 可看 | 剪点落在词与词之间、换气留着；字幕可读、避开人脸与平台控件；配乐在人声之下；画面变化跟着信息变化走；要发布的片子关掉声音也看得懂开头（手机上多半静音开播） | 停顿一刀切压到 0；字幕盖住下三分之一；开头的钩子只在声音里 |
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
| [web](references/catalog/web.md) | 网页版编辑器 | 在浏览器里打开某个视频的编辑器：看合成后的画面、播放、拖拽调整；给用户长期有效的审片链接；访问链接与会话 |
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
| {{skill:explainer-video}} | 知识讲解视频 | 把概念、新闻或资料讲成没有背景的人也看得懂、看完能复述的讲解成片：从观众的疑问找讲法，给这期找一个自己会讲道理的主体，画面一直在动，按需另出语言或画幅版本 |
| {{skill:clip-montage}} | 解说混剪 | 拿一条新闻、一件事或一个故事，从网上与视频库里搜素材、切原声，配旁白剪成画面一直在动的片子，推文与引语做成压在画面上的卡片；题材不限 |
| {{skill:video-production}} | 从简报到成片 | 从零做一条完整成片：风格与分镜规划，逐镜出画面，配旁白、混音、导出验收 |
| {{skill:production-scripts}} | 制作脚本 | 有命令行环境时按段配旁白、对齐、打包代码画面、摆上时间线、建字幕、叠实拍、量画面占比的现成脚本，不规定片子的形态 |
| {{skill:motion-graphics}} | 动效图形 | 用自包含 HTML 定制音频视频的背景与标题，或做下横栏、关键词、大数字、标注与品牌贴片，导入后放上时间线 |

这些页是内置 skill 随这份 skill 发布时的副本；`baocut skills read <id>` 取的是这台机器上当前的版本（含用户自己加的 skill），两者不同时以后者为准。
<!-- /surface -->

## 4. 编排

- 单步的事直接做：用户只要一件小事（导出一个 srt、截三帧、改一个标题）就只做那件，不套整条流程。
- 用户消息里形如「[目标语言]」的方括号项，是快速开始或模板留给用户填、用户没有填的待填项：动手前先问清，不自己猜一个，也不原样抄进产物。
- 有固定流程的事（转录、下载、翻译配音、转码、导出）用一级动词（{{tool:transcribe}}、{{tool:download}}、{{tool:dub}}、{{tool:transcode}}、{{tool:export}}）一步提交整条流程，不自己拆成几步。
- 多步的任务你是导演：先写出计划（交付物、步骤、每步用哪个工具或 craft），按步骤做，每步读完结果再走下一步。
- 写操作与占 GPU 的任务（转写、合成、音乐生成、导出成片）都由你自己下，一台机器上一次一个；子代理只交文件与结论，不让它们改视频或提交任务。
- 跨回合接着做时，先读视频的当前状态（{{tool:videos_inspect}}），从已经做到的那一步接着做，不重复已完成的步骤。
- **下载与临时文件先看磁盘。** 要下载外部视频、网上素材，或要生成转码中间文件、试烘焙、试导出这类大的临时文件时，先按时长与码率估大小（1080p 视频每小时约 1–3 GB，ProRes 预渲染每分钟 1 GB 以上），再看要放的那块盘还剩多少：有 shell 时 macOS / Linux 用 `df -h <目录>`，Windows 用 PowerShell 的 `Get-PSDrive`；查不了就问用户。优先放非系统盘（macOS 的 `/Volumes/<盘名>`、Windows 的 C 盘以外、Linux 上不挂在 `/` 的盘）：下载给 {{arg:outDir}}，长片的视频建在那块盘上（见 [media](references/catalog/media.md)「从链接下载」）。用户指定了位置照用户的；只有系统盘时照常放；空余不到预估大小的两倍时先和用户定位置，不硬塞进系统盘。放在哪块盘、哪个目录在回复里说一句。要进视频的临时文件导入时给 `managed`，之后清掉原文件素材也不缺。
- 用户在找视频或内容（「有哪些……的视频、播客」「哪个视频讲了……」「找一下……」）时，没说「我的」「本地」也先在用户的视频库里找，不先上网：讲的内容用 {{tool:space_search_v2}}，人物外观、场景这类画面特征再给 {{arg:channels}} `["visual"]` 检一次，视频名用 {{tool:videos_list}} 对；回答先列库里找到的（视频名与时间）。库里没找到、不够，或用户要的明显在库外（外面的节目推荐、最新消息）时再上网搜，网上的结果另列一段并注明来自网络，不和库里的混在一起；用户明说要网上的就直接搜。
- 要在视频里找内容（某句话、某个话题讲在哪、哪一期讲过、写作要用的段落）时先检索，不先通读全文：{{tool:space_search_v2}} 跨视频按意思与字面找，{{tool:speech_relevant}} 按意图取写作材料（带出处编号），{{tool:space_related_videos}} 找讲相近内容的视频。结果的 `effectiveMode` 是 lexical 或工具报 `SEMANTIC_UNAVAILABLE` 时这台机器没有可用的语义索引：改用两三个关键词与 {{tool:space_search}}，或用 {{tool:documents_read}} 读文稿。`weak` 的命中先读原文再用。
- 要找画面（某个镜头、能配图或补画面的片段、封面候选）时也先检索：{{tool:space_search_v2}} 给 {{arg:channels}} `["visual"]` 按画面描述跨视频找，{{tool:videos_match_frames}} 在一部视频里为一段文字找最像的画面（写作时 {{arg:near}} 给这段回引的出处编号）。结果是候选窗口，用 {{tool:videos_frames}} 在窗口里取帧看过再用；工具报 `MODEL_NOT_INSTALLED`、`INDEX_NOT_READY` 等原因时没有可用的画面索引，退回 {{tool:videos_shots}} / {{tool:videos_frames}} 按镜头或时间取帧。
- 用户给了素材（口播、采访、录音、参考视频）要从里面挑内容时：先 {{tool:transcribe}}，再用 {{tool:space_index_status}}（这些视频的 {{arg:videoIds}} 加 {{arg:waitSec}}）等语义索引建好再取材。`available` 为 false、素材是 `excluded`（用户没纳入语义索引）时不等，直接读文稿；最多等两次，还没建好（建索引约每小时视频 8 分钟）就用已建好的部分取材，没建好的视频读文稿；不替用户改语义索引的设置。
- 要按画面用用户给的素材（配图、补画面、挑镜头，素材不一定有人说话）时：先用 {{tool:space_index_status}}（这些视频的 {{arg:videoIds}}，{{arg:channel}} `visual`）看画面索引；`available` 为 true、素材不是 `indexed` 时用 {{tool:space_index_build}}（同样的 {{arg:videoIds}}，{{arg:channel}} `visual`）给它们建，不用等用户开设置。画面索引比讲话慢，不干等：先做不靠画面的步骤，用之前再看一次，还没建好的按镜头取帧。`available` 为 false 时（没装能读图的模型包）直接按镜头取帧，不为此提议装模型，除非用户问起。
- 转写、图片生成与代码画面可以拆开来用，不只服务于字幕、封面与贴片：
  - **转写也是量时间的尺子。** 用户手上已有正确的正文（歌词、讲稿、台词）时，识别出的字只当对位线索：时间取转写，文字取原文，对不上的行不估时间。做法见 [subtitles](references/catalog/subtitles.md) 的「已有正文时」。
  - **图片生成是素材工厂。** 同一角色的一组姿势、一套道具画在一张纯色底的网格里再切开，场景底图不带人物与文字，之后在代码里让它们动起来，做法见 [media](references/catalog/media.md) 的「生成图片」。画面元素不用系统 emoji：各平台的字形不同，离屏渲染时还可能缺字。
  - **代码画面不止贴片。** 整镜、整段都可以用 Canvas 或 SVG 按时间画；进视频一律打包导入（{{tool:compositions_import}}），不自己渲染成视频文件再导入。整镜的场景全部画在一张 Canvas 上，导入时走指令烘焙，比浏览器逐帧截图快一二十倍；写法见 {{skill:video-production}} 的代码场景，导入后看结果的 `bake.renderer`。做片阶段默认先不烘焙：带 `live: true` 导入，片段直接放上时间线、由编辑器的实时层现画，给用户看、反复改都不等烘焙；用户看过说可以，再带 `replace` 不带 `live` 导入一次烘焙，然后导出。实时层眼下只画铺满画幅、垫在最底下、同一帧只有它一个的代码画面；透明卡片叠在实拍上这类形态画不出来，出路见 {{skill:video-production}} 代码场景细则第 7 节。只有用户要的就是一个由代码直接渲染的文件、不要可编辑视频时，才在 BaoCut 之外渲染。
- **成片的第一帧就是封面。** 你做出或剪出要发布的视频时（成片、剪口播、短视频、旁白片、MV），平台常取第一帧当缩略图，所以 0 秒的画面要完整、能代表这部视频：不黑场、不从空白淡入、不停在转场或闭眼的中途，第一个片段开头不设淡入。有标题与主视觉的（片头图形、代码场景）0 秒就都在位，停一两秒再进正片，全画幅的片头按 {{skill:motion-graphics}} 做；口播与短视频直接开在说话人干净的一帧上，不必加标题卡。取帧看不到叠加的文字与图形，核对第 0 帧要用 {{tool:compositions_preview}} 取 0 秒，或导出一小段预览来看。转写、翻译、配音别人的视频时不改它的开头。
<!-- surface: agent -->
- 会话不属于项目时，新视频不给 project，直接建在会话自己的工作目录里，不先建项目；用户明确要建项目时才用 {{tool:projects_adopt_session}}，把这个会话连同视频收进一个以视频命名的新项目。用户要把新视频放到指定的文件夹（外置盘上）或别的已登记项目里时，新建视频的工具直接给 {{arg:project}}（文件夹的绝对路径或 projectId）：确认之后会话连同视频放进那里，不请用户换项目、新开会话。
- **会话标题认不出内容时起一个。** 用户的第一句话是泛泛的指令（「转录这个视频并翻译」）、素材是本机文件或已有的视频时，读懂内容（文稿、速览）之后用 {{tool:conversations_set_title}} 起一个短标题：用用户的语言，一行、最多 40 个字符，点出视频讲什么、是谁的，不写「转录」「翻译」这类任务词。第一句话已经点明内容，或素材从链接下载（BaoCut 自动换成平台标题）时不起；返回的 `changed` 为 false 时不再调用，也不用告诉用户。
- **收到视频标注时的解读。** 用户消息末尾的 `<baocut-video-annotations video="…" revision="…">` 是用户在预览画面上圈出的位置，一帧一条：条头是那一帧的时刻（时间线时间，含毫秒）与几处标记（`N marks`），下面 `a.` `b.` …逐处给种类（box / arrow / text / pin / pen / line / ellipse / element / comment）、相对画面归一化的区域（0–1）与批注——同一条里的几处是用户在同一帧上一起圈的，合起来读；画的标记（框、箭头、画笔、直线、圆、编号、元素）可以没有批注，要改什么写在消息正文里。条头下可能带：`segment:` 是这一帧所在的段与句，`screenshot: attached (<文件名>)` 指随消息附上的那张图（括号里是附件的文件名），画着这一帧的全部标记（评论是印章），看图找它指的地方；`not attached` 是没截到图，按时刻与区域找。各处下面可能带：`style:` 是标记的颜色与粗细，`element:` 是点中的元素（`html region#<id>` / `html region` 是代码包页面登记的画布区域，多是画在 canvas 里的一行字，按 `name` 里的字到场景代码里找画它的那一处），`stamp:` 是评论印章在截图上的位置。带 `segment` 的标注优先用章节表的工具改那一章；带 `element` 的标注改的是那个元素（字幕行、合成层或 HTML 节点），不是它附近的画面。默认含义是**改源视频在这个时刻附近**——先 {{tool:videos_inspect}} 读当前版本（段上的 `revision` 落后时以当前为准），用 {{tool:videos_frames}} 看那一刻的画面，再在时间线上改那一处；区域只用来认位置（哪块字幕、哪个角标），不裁剪画面，也不拿截图去生成新片段。几条（几帧）各是各的时刻，不自动连成一段：段末的 `candidateBoundsMs` 只是最早到最晚那一帧的候选范围，不是要改的区间。批注要改的东西需要时间边界（「这段删掉」「从这里开始加」）而标注里没有时，先问一次起止，不替用户定；用户说了的就照说的做。
- **要用户看、听的图片与音视频直接嵌进回复。** 请用户挑选、审看或试听时（样音、候选封面、取帧、风格样张、试听片段，任务总结里要用户看、听的也算），每个文件单独一行写成 Markdown 图片 `![一句说明](路径)`，会话里就地显示成图片或播放器，用户不用去目录里找；不要只给目录再列裸文件名。前一行用文字点明是哪一个（播放器上只显示文件名）。路径照抄工具结果给出的（多是 `path`，取帧是每帧的 `file`），相对路径按工作目录；只有 `artifactId` 时先用 {{tool:artifacts_save}} 存进工作目录；路径带空格时用尖括号包住，如 `![样音 A](<voice tests/a.wav>)`。视频卡上已经能播的交付导出不再重复嵌；日志与只给自己检查的中间文件不嵌。
<!-- /surface -->

## 5. 硬规则

1. **文字工作自己做。** 翻译、润色、总结、分章、写稿由你完成，你本身就是文本模型；不配、不等文本模型，没配置文本生成也不是停下的理由。{{tool:translate}} 只在用户明确要用配置好的文本模型时用；它报 `CAPABILITY_NOT_CONFIGURED` 时照 `next` 自己翻，不请用户去配置。转写之后默认也做三件：润色末尾给占位名的说话人实名，给视频分章（作者有章节就 {{tool:chapters_adopt}}），再写视频速览；实名只按证据，拿不准留着占位名；分章与速览是旁路，失败不挡后面的步骤。转写只用来量时间（歌曲、已有正文的对位）时不做这三件。
   **视频速览**站在观众的角度，让没看过的人很快知道这部视频是什么，用用户的语言写：
   - 出处：标题、作者、发布日期、时长、语言、链接，只取 {{tool:videos_inspect}} 的 `source` 与视频事实，缺的不写、不猜；本机文件写文件名。平台简介是作者的话，单独引出来，不混进你的概括。
   - 正文：讲什么、适合谁看；出场的人与各自的角色只按文稿与来源里的证据，没报名字的照实说；要点几条，每条带时间链接，`href` 照抄工具结果（{{tool:videos_inspect}} 的章节、{{tool:speech_relevant}}、{{tool:speech_topic_boundaries}}），没有 `href` 的只写时间文字。
   - 用 {{tool:edits_apply}} 的 `setVideoBrief` 存到视频上（正文不带标题，`language` 写正文的语言），回复里在「视频速览」小标题下给出同样的正文。视频已有速览（{{tool:videos_inspect}} 的 `brief`）且文稿没变时不重写。
2. **默认产物是可编辑视频。** 有媒体要转写、字幕、翻译、配音、剪辑时，结果落在一个视频里；用户明确说只要文件、不要视频时才不建视频；转写只是给 BaoCut 之外的渲染量时间时，也可以用 {{tool:transcribe}} 的 {{arg:noVideo}} 只取文稿文件。新建的视频在之后的步骤失败时保留，不要再建一次。
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
11. **管理命令先征得同意。** `baocut --help` 后半屏「本机管理」里的命令（模型服务与凭据、设置、对外服务、授权、skill 开关等）是给人用的：先征得用户同意再用；密钥只由用户自己输入。打开网页版编辑器的 `baocut web open` 与发审片链接的 `baocut web review` 除外（见 [web](references/catalog/web.md)）。
<!-- /surface -->
<!-- surface: agent -->
11. **设置不代做。** 启用服务、配置凭据、改默认值、改设置由用户在 BaoCut 的设置里完成，你只说明要改哪一项。
<!-- /surface -->

## 6. 交付

完成后在回复末尾写任务总结（小标题「任务总结」，用用户的语言）：先一句话对上「你要的是什么 → 结果」，再按下面的顺序报告五件事。单步的小事两三句说清，不加小标题。

1. **改了什么**：建了或改了哪个视频（名字、位置；新建的还是用户原来的），每笔修改的回执要点。
2. **产物的真实路径**：导出的文件取任务结果 `outputs` 里的 `path`，不自己拼路径。
3. **还要用户审的**：拿不准的译法、没改成的识别错误、挪动了顺序的地方、需要用户挑的候选；本机生成的配乐只许非商业用途时写明。
4. **没验证的**，分三栏写：
   - **量出来的**：读回执与结果得到的数，如时长、剪口数、字幕条数、句数、文件大小。
   - **看过的**：取帧后实际看到的画面；没取帧就写没看。帧不含字幕、文字与叠加的元素，字幕位置挡没挡人脸只能在成片或编辑器里看。要发布的片子除了第 0 帧，每个剪点前后也各看几帧，查黑帧、冻住的帧、拉伸或露出画布底色的帧；叠加的元素与字幕只在导出的预览里看得到。请用户审片之前先自己看过这些，让用户的审看只花在口味上。
<!-- surface: cli -->
     网页版编辑器里看过的时刻也算，见 [web](references/catalog/web.md)。
<!-- /surface -->
   - **要人听的**：剪点顺不顺、配音的语气与对齐、配乐音量。
5. **可以清理的空间**：这次下载与生成、交付后用不到的文件（下载的原片、转码中间文件、试烘焙与试导出的视频、旧的预渲染），列出路径、大小与所在的盘，提醒用户清理；删除等用户同意后再做。还链接在视频里的素材删了会缺失，要么先收进视频（{{tool:edits_apply}} 的 `collectAssets`），要么不列进可删的。没产生这类文件时不写这一项。

工具失败属于「没验证」，不等于内容有问题；只按实际看到的帧下视觉判断。

<!-- surface: cli -->
**给用户审片链接。** 视频能预览了（不必等成片），运行 `baocut web review --video <videoId>`，把打印的链接整条原样给用户：同一部视频始终是同一条，用户在自己的浏览器里看、标记截图、改；之后再请用户看，让用户刷新原页面即可。有没烘焙的代码画面（`live: true` 放的）时，宿主自带的浏览器面板（例如 Claude 的内置浏览器）会拦掉实时层的沙箱页面，那些片段是黑的：请用户在系统浏览器里开这条链接，或在 BaoCut 桌面版打开这部视频、切到审片视图。见 [web](references/catalog/web.md)。
<!-- /surface -->
