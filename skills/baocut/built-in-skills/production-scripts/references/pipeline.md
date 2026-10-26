# 制作脚本：配音、对齐、打包、预览、摆上时间线、建字幕、叠实拍

`SKILL.md` 第 2–4 节的细则。按段做的旁白片（一段旁白一个代码包），每部都要的五步（配音、对齐、打包、摆上时间线、建字幕）和几个可选步骤（预览页配置；实拍片段与水印；给原声片段在旁白里留白；量画面占比）已经写成 `scripts/` 下的脚本，有命令行环境时拷过去用，不再每部重写。脚本只调 baocut CLI（配音、转写、导入、修改都走它），不碰 API Key；内容相关的设定都在一份配置里。脚本是一条省事的路，不是形态的定义：形态和它不合时照 `video-production` 用 BaoCut 的工具或 CLI 自己做。代码场景的细则（打包、烘焙、波纹）在 `video-production` 里，下文简称「代码场景细则」：用 `skills_read` 读 `video-production`，再按它第 5 节「代码画面」一条读。

## 1. 适用

- 适用：旁白按段配，一段旁白对一个代码包，首尾相接排在一条视觉轨与一条音频轨上。代码包可以是整段的画面（动画打底，实拍叠在上面），也可以是透明的叠层（实拍打底铺在下面一条轨上，包里只画卡片、标注；`footage.layer` 为 `under`，`bundle.alpha` 为 true）。
- 不适用：整片一条旁白不分段；画面不按段切（一条长录屏配旁白）；没有命令行环境（这时照 `video-production` 与代码场景细则第 7 节手动分段做、分段改）。
- 依赖：Node 18 以上，能运行 baocut CLI。`align.mjs --chunk` 切段、`gaps.mjs` 留白与压停顿、`overlay.mjs` 量原声响度（只读，不写文件）、`quotes.mjs` 切原声、`level.mjs` 拉平老录音时要本机有 ffmpeg。

## 2. 拷过去、写配置

1. 把本 skill 的 `scripts/` 整个拷进工程，例如 `<工程>/tools/`：能直接读到文件时拷目录，读不到时用 `skills_read` 读本 skill 的 `scripts/` 下每个文件，原样写进去。脚本都 import 同目录的 `lib.mjs`，要拷全；`*.example.json` 是配置样例，不用拷。
2. 照 `scripts/explainer.example.json` 在工程根目录写 `explainer.json`（也可以叫 `production.json`，两个名字都认，先找 `production.json`；脚本从当前目录往上找它，也可以 `--config <文件>`；工程根目录 = 配置所在目录，配置里的路径都相对它）。

| 字段 | 是什么 |
| --- | --- |
| `video` | 成片视频的 ID。另一种语言或画幅的版本是另一部视频、另一个工程目录、另一份配置 |
| `bc` | 调 CLI 的命令，默认 `["baocut"]`；开发版或包装脚本写它的路径（`./` 开头相对工程根目录） |
| `language` | 旁白语言（BCP 47），配音、转写、转写文稿都用它 |
| `fps`、`canvas` | 帧率与画幅（`width`、`height`、`background`），和视频的序列一致 |
| `order` | 段落 id 按播放顺序；固定开场不一定在第一个（钩子之后再进开场很常见） |
| `script` | 旁白稿：`path` 与 `notePrefixes`（这些字符开头的行是备注，默认 `@`、全角、半角括号、`>`、`<!--`；画面意图行用它们开头） |
| `fixedLines` | 不从稿子读的段（固定开场、结尾口播），逐字照用户给的写 |
| `hold` | 某段在最后一句之后多停的秒数，例如片尾卡 |
| `estimateRate` | 还没配音时估时长用的语速（单位/秒：汉字、假名一个字一个单位，其余文字一个词一个单位）；首稿取实测值 |
| `voice` | `provider`、`model`、`voice`、`instructions`、`format`；`attach` 为 true 时配音结果同时作为候选素材进视频；`pitchHz`（参照音高，缺省取其他段的中位数）与 `pitchTolerance`（缺省 0.05）给 `voice.mjs` 的音高检查用；`maxPause`（秒）给了时 `gaps.mjs` 把句间长于它的静音压到这么长，要快节奏的短片给 0.3，不赶时间的可以不给，留自然的停顿 |
| `asr` | 对齐用的转写：`provider`、`model`、`chunkSeconds`（大于 0 时长段切块转写） |
| `names.narration` | 旁白素材与转写文稿的名字前缀，用成片语言写 |
| `bundle` | 打包规则：`pick`（只拷场景里提到的文件的子目录，默认 `img`）、`keep`（总拷）、`exclude`（不拷）、`scripts`（入口在 `scene.js` 之前以经典 `<script>` 加载的共享脚本，默认 `shared/` 顶层的 `.js`；`module` 为 true 时默认为空）、`module`（为 true 时 `scene.js` 按 ES 模块加载，能 `import` 包里的模块与库，例如 `./engine.js`、Three.js；`shared/` 里的模块由场景自己 `import`，不能再当经典脚本加载，只挂全局变量的经典脚本要用时列进 `scripts`）、`fonts`（`{ 字体族名: 包内相对路径 }`，写成入口里的 `@font-face`）、`alpha`（为 true 时包是透明的：根元素 `data-alpha="true"`、页面底色透明，场景只画要叠在实拍上的东西，不铺底色；配 `footage.layer: "under"` 用） |
| `tracks` | 可选，`visual` 与 `audio` 轨道 ID；不给时用第一条视觉轨与第一条音频轨 |
| `names.footage`、`names.watermark`、`names.quote` | 可选，实拍片段、水印、只有声音的原声片段所在轨道与素材的名字，用成片语言写 |
| `captions` | 可选，旁白字幕：`style`（字幕样式的键：`y`、`verticalAlign`、`x`、`width`、`fontSize`，以及 `fontWeight`、`fontFamily`、`fontColor`、`textOutline`、`dropShadow`、`background`、`backgroundColor`，外加 `sungColor`：KTV 念过部分的颜色。字幕不逐字高亮；给了 `sungColor` 时念过的部分从 `fontColor` 渐变成它，两个颜色都从这期色板取：浅底上 `fontColor` 取浅一档的灰、`sungColor` 取墨色，深底上 `fontColor` 取暗一点的中间调、`sungColor` 取更亮或更暖的强调色；不给时按默认样式，锚线在 `y` 86，竖版落在平台控件区里，要给。`fontSize` 按 540 短边算：1080 高的画面上 88 px 的字写 44，和按像素写的 `footage.label.size` 不同。默认样式带黑描边与投影，浅色底上写 `textOutline: { on: false }`、`dropShadow: { on: false }` 关掉）、`displayTiming`（`{ leadIn, tail }`，字幕比第一个字早出现、说完后多停的秒数，默认 0.5 与 1，原声留白不够时自动收短） |
| `preview.caption` | 可选，预览页上字幕带的样式（与字幕样式同一套键：`y`、`verticalAlign`、`fontSize`、`width`）；不给时用 `captions.style` |
| `footage` | 可选：`clips`（片段清单，默认 `clips.json`）、`layer`（`over` 默认，实拍轨压在代码画面上面；`under` 时实拍轨挪到代码包那条轨的下面当底，包要透明，实拍之外的时刻露出画布底色）、`font`（来源标签用的字体文件）、`label`（`size`、`margin`，像素）、`loudness`（原声的响度，LUFS，默认 -17）、`subs`（双语字幕：`fontsDir` 字体目录、`font` 与 `size` 成片语言那行、`trFont` 与 `trSize` 原话那行、`whoSize` 说话人、`marginV` 离底边的像素；字体写字体族名） |
| `watermark` | 可选：`file`（图片，放成画中画）或 `text`（一行字，放成文字片段），二者给一个；文字水印另有 `style`（文字样式的键：`fontFamily`、`fontSize`、`fontWeight`、`fontColor` 等；`fontSize` 和字幕一样按 540 短边算）、`opacity`（缺省 0.6）、`fade`（淡入淡出秒数，缺省 0.8，0 为硬切），`w` 是文字框宽。`dur`（每次几秒）、`w`、`y`、`x.left`、`x.right`（画面宽高的百分比）、`at`（每次出现的位置：`{ seg, line, cue?, side }` 跟着旁白走，或 `{ t, side }` 写死时间线秒数；单个可以另给 `x`、`y` 放在别处，穿插在片中、换着位置放，裁掉一角也去不掉） |
| `prepend` | 可选，片头补在已有视频的前面（视频里已经有正片的录音、字幕、实拍与章节）：`true`，或 `{ chapter: { title, summary? } }` 同时在第 0 帧加一章。第一次放段落之前，`assemble.mjs` 用一笔事务在第 0 帧给有片段的轨道腾出 `order` 各段的总帧数，原有的片段与章节一起后移，核对后记进 `timeline.json` 的 `prepended`，不重复做；`--dry` 先打印这一步要腾多少帧、加不加章。之后片头变长变短照常波纹，正片跟着走。加了一章以后，正片里写成文字的章节序号（跟着章节走的 `01`）都会多一：要保留原来的序号，把那条序号文字换成每章一段的静态文字。正片的原声片段保持原来的音量，片头里的原声引用按 `footage.loudness` 量过、通常更响，切到正片前比一比两边的响度，差得多就调正片录音片段的音量；调到上限 4 倍还差（几十年前的录音常比旁白低二十分贝），就修录音文件再换进去（用 `skills_read` 读 `history-video`，再读它的「老录音」参考）。正片的水印从正片起点开始，片头上没有：要角标时给片头另配一条 `watermark`，颜色按片头的底色选 |
| `fonts` | 可选，`fonts.mjs` 裁字体子集：`faces`（`{ 族名: { src, index?, axes?, file, subset? } }`）、`out`、`text`、`unicodes`、`features`（缺省去掉 `locl`，原因见脚本开头）。写出的路径要和 `bundle.fonts` 一致 |
| `sources` | 可选，`sources.mjs` 的出处表（条目可带 `match`：地图数据这类场景不按文件名引用的，写场景源码里认它的字样，例如全局名 `GEO110`；不给时 `shared/` 下有这个文件就记作每个包都带着）：`file`（缺省 `sources.json`）、`csv`（缺省 `sources.csv`）、`columns`（表头的显示名，成片给哪种语言的观众就用哪种语言写） |

旁白稿的写法：`## <段落 id> 标题` 开一段（id 要在 `order` 里），段内每个非空行是一句旁白，一句一个画面节拍；别的一、二级标题或单独一行的 `---` 结束这一段，所以来源、简化说明、分镜草案可以写在同一个文件里。

工程目录：`scenes/<id>.js`（每段的场景代码）、`shared/`（各段共用的引擎、字体、图片；场景的起点可以拷本 skill 的 `scene-kit/`），脚本生成 `audio/`、`timing/`、`bundles/`、`.baocut-out/`，记录 `audio/voice.json`、`timeline.json`、`captions.json`、`overlay.json`，预览页读 `preview.json`。有实拍时写一份 `clips.json`（样例 `scripts/clips.example.json`）：每个片段的原片起止秒数，放在哪一段的哪一句（`line` 从 0 数），可选从这句里哪几个字开始（`cue`）、保留原声（`audio`：`true`，或 0–1 的音量）、旁白在这里停下单独放（`gap`，这时 `line` 是插在哪一句之前，等于句数时放在段尾；几个 `gap` 片段给同一个 `line` 时按清单先后背靠背连放）、紧接上一个片段放（`follow`：不看 `line` / `cue`，接在清单里上一个片段的原长之后，几段素材连成一块、中间硬切）、双语字幕（`subs`：`[{ from, to, text, tr, who? }]`，原片秒数）、单侧转场（`in`、`out`：`{ kind, dur?, easing? }`，`kind` 取 `dissolve`、`wipe`、`slide`、`zoom`、`iris`，`dur` 默认 0.5 秒，`easing` 默认 `ease-in-out`）、裁边与放法（`crop`：`[x, y, w, h]` 原片像素；`fit`：默认 `cover` 铺满裁切，`contain` 整幅放进、补黑边；`focus`：`[s, dx, dy]` 放大 s 倍、画面中心挪到离正中 dx%、dy%（正数往左、往上），换成取景点；`pip`：`{ x, y, w }` 放成画中画，`x`、`y` 是框中心、`w` 是框宽，都是画布的百分比，高按原片裁过之后的宽高比）、另一个来源文件与标签。来源也可以是一张图片（png、jpg、webp、bmp、tif；截图、海报、照片）：`from`、`to` 只定时长（写 `0` 和秒数），不能带 `audio`，整段停在这张图上；图片推拉（旧版的 `motion`）眼下没有时间线上的写法，带 `motion` 的片段报错。片段的起点还可以写成 `after`：从这一段第几句念完的时刻放（从 0 数，负数从末句倒数，`true` 是末句），用在段尾 `hold` 里放一句原声；`offset`（秒，可正可负）在任何起点之上再挪。**只有声音的片段**：来源是录音文件（mp3、wav、m4a、aac、flac、ogg、opus），或视频片段写 `video: false`；要带 `audio`，放在 `names.quote` 那条音频轨上，起点精确到帧内，不能带画中画、裁剪、取景与转场，来源标签只在片段自己写了 `label` 时放。`asset` 写已在视频里的素材 ID（例如正片的录音）时不再导入，`source` 仍用来量响度。`words: true` 时 `quotes.mjs` 给它对出逐词时间，`said` 是原话（校对用的文本）、`text` 是成片语言的译文。场景代码从 `window.TIMING` 读这一段的时长与逐句、逐字时间（`{dur, lines:[{text, start, end, chars}]}`，`chars[k]` 是第 k 个字符开始被说到的秒数），以及 `build.mjs` 写进去的 `clips`（这一段的片段，按 `overlay.mjs` 同一套算法排好：`at` / `end` 是相对段首的秒数，`box` 是画中画框在画布上的像素，`words` 是相对段首的逐词时间，`said`、`text`）与 `credits`（`{ 文件名: 画面上的出处 }`，来自 `sources.json`；`scene-kit/scene-kit.js` 读的就是这几样，改它们的格式时一起改它），在 `window.__baocutCompositions[<compositionId>]` 上注册（默认 `main`）。

## 3. 按顺序跑

| 步骤 | 命令 | 做什么，看什么 |
| --- | --- | --- |
| 配音 | `node tools/voice.mjs <id …>` 或 `--missing` | 一段一次合成，存 `audio/<id>.<格式>`，记 `voice.json`（连同当时的稿子原文）。`--missing` 只配没配过或稿子改过的段。任务被 Runtime 重启打断时自动重试；`--seed` 只对收 seed 的模型有用，不收的模型直接重跑就是另一次合成。同一音色、同一套说明，模型仍会偶尔整段漂成另一种嗓音（偏高偏亮，长段更容易），拼进片子一听就换了人：每段配完量中位音高（浊音帧自相关），和参照差超过 `pitchTolerance` 就重配，最多 `--takes` 次（缺省 3）留最接近的，记进 `voice.json` 的 `pitchHz`；全部配完对全片量一遍，报出离群的段。`--check` 只量不配，旧工程补量也用它。量出离群不一定错（开场激昂、结尾放低），先听再决定重配 |
| 对齐 | `node tools/align.mjs <id …>` | 转写后用编辑距离把字时间对到稿子原文，写 `timing/<id>.json`；打印每句的语速（偏离中位数超过 15% 标 RATE；两秒以内的短句容差放宽到 0.3 秒 / 句长，免得句首句尾的误差句句都标）、句间停顿（超过 0.8 秒标 GAP）、多念、漏念与念错的字。读错的处理照 `explainer-video` 第 6 节「读音核对」（用 `skills_read` 读 `explainer-video`）。提示时间塌了时 `--fresh --chunk 14` 重转 |
| 留白与压停顿 | `node tools/gaps.mjs [id …]`（有 `gap` 片段或给了 `voice.maxPause` 时） | 在 `gap` 片段所在那句之前插一段静音（片段长 + 0.35 秒；同一句前的几个 `gap` 片段共用一段，长度是它们的总长 + 0.35 秒），后面的句子整体后挪；给了 `maxPause`（或 `--max-pause 秒数`）时，把句与句之间长于它的静音压到这么长，句内的停顿、留白的接缝与固定口播的段不动。写 `audio/<id>.gaps.<格式>`，`timing/<id>.json` 改成挪过的时间并带上 `gaps`、`tightened` 与 `gapAudio`，原始对齐存成 `timing/<id>.voice.json`，可以反复跑。之后打包、预览、排时间线、字幕都按留过白的时间走，`assemble.mjs` 导入留好白的那份旁白 |
| 字体 | `node tools/fonts.mjs`（给了 `fonts` 时） | 按场景、稿子、片段与出处里出现的字裁子集，写进 `shared/` 下；报出哪款字体都没有的字，`bundle.fonts` 的路径对不上时提醒。字体一变，引用它的包全部重烘，定稿后加字先想好 |
| 原声逐词 | `node tools/quotes.mjs [片段 id …]`（有 `words: true` 的片段时） | 用 ffmpeg 切出片段那一段原声，转写后按 `said` 对出逐词时间，写 `quotes.json`；对上的不到八成、或最后一个词碰到片段终点时提醒（片段的 `to` 可能切早了）。转写听成别的字（口音、旧录音）的地方按位置取时间，照样点亮，只是不算「对上」。没有 `said` 时打印转写结果，校对后写进 `said` 再跑 |
| 出处 | `node tools/sources.mjs`；`--check` 只查 | 对照场景引用的图片、影像与片段用到的原片，查 `sources.json` 漏了哪些、缺不缺 `url` 与 `license`、要署名的许可有没有 `credit`；写 `sources.csv`（带 BOM，最后一列是用在哪几段）。`build.mjs` 从同一份表取画面上的出处 |
| 录音波形 | `node tools/envelope.mjs <录音> --out shared/<名>.js [--var 名] [--bars 240] [--from 秒] [--to 秒]`（场景要画原声的波形时） | 用 ffmpeg 把录音量成一排 RMS 条，按 95 分位归一，写成 `window.<名> = { dur, bars }`；场景用 `scene-kit` 的 `K.bars()` 画，可以随进度画出、把正在讲的那几秒标成强调色、带播放头。不读配置、不连 Runtime |
| 老录音 | `node tools/level.mjs <录音> --out <拉平后.wav>`；`node tools/level.mjs --lag <原录音> <处理后> [--at 15,600,1800]` | 不读配置、不连 Runtime。拉平：每 100 ms 量一次短时响度，把每一处前后 45 秒里讲话部分的中位数往全片的 75 分位拉（最多提 `--lift` 9 dB、压 `--cut` 2 dB，前后 `--smooth` 15 秒平滑），比讲话响得多的掌声、碰话筒另外压回去；增益写成 asendcmd 命令文件，输出 32 位浮点 wav，不改时间。`--lag` 量降噪、滤波带来的延迟：几个时刻各取 8 秒互相关，打印处理后晚了几个采样，照它 `atrim` 挪回去再量。修录音的整套做法（滤波链、提响与限幅、换进视频、剪开头的空白）在 `history-video` 的「老录音」参考 |
| 打包 | `node tools/build.mjs [id …]` | 打成 `bundles/<id>/`，时长 = 对齐出的时长 + `hold`，对齐到整帧。还没对齐的段按估算时长打包，只用于配音前的样帧。给了 `bundle.fonts` 时顺带查字形：场景与 `shared/` 顶层 `.js` 的字符串里有字体都没有的字，打一行 `warn <id>: fonts lack …`（烘焙会因此退回像素，按代码场景细则第 2.1 节改；只提醒，不停） |
| 排时间线 | `node tools/assemble.mjs --dry`，再 `node tools/assemble.mjs --live` | `--dry` 不连 Runtime，打印每段的起始帧、帧数和要做的事；确认后去掉 `--dry` 执行。`--live` 用 `compositions import --live` 放代码包：不烘焙、不排任务，几秒一段，编辑器预览时由实时层现画；`timeline.json` 里这些段记 `live: true`。实时层眼下只画铺满画幅、垫在最底下的代码包：`footage.layer` 为 `under`（透明卡片叠在实拍上）时审片视图提示这些段画不出来，只能先不带 `--live` 烘焙再看，或者先给 BaoCut 补上叠层的实时层（`video-production` 代码场景细则第 7 节） |
| 字幕 | `node tools/captions.mjs --dry`，再 `node tools/captions.mjs` | 用稿子原文加对齐时间写转写文稿、建字幕层，专名照稿子的写法上屏。字幕默认比第一个字早约半秒出现，从 0 秒起的那段建好后把字幕片段起点裁到第一个字，封面上不带字幕。给了 `captions.style` 时用 `setCaptionStyle` 把它写进旁白的字幕样式文档（没有就建一份，各段字幕都挂上），重跑只改和配置不同的键；视频里原有的字幕（前插项目的正片字幕、`overlay.mjs` 的原声字幕）用的样式不算旁白的，不改。默认样式会把念到的字染成青色，所以什么都不给也建样式文档，写 `wordAnimation: { catalogId: "none" }`；`sungColor` 写成 `textMotion.karaoke.color`，当前词一起换成 none，`textMotion` 原有的入场、出场保留。显示时长 `displayTiming` 不是 `setCaptionStyle` 的键，脚本用 `patchDocument` 写。双语字幕的译文行也跟着扫，进度按整句摊开，不和原话逐词对应 |
| 实拍与水印 | `node tools/overlay.mjs --dry`，再 `--place [段 …]` | `--dry` 不连 Runtime，打印每段实拍与每次水印在时间线上的起止、留白、原声、字幕条数、裁剪与转场。`--place` 不剪、不转码：每个原片 `assets import --storage linked` 一次（素材 ID 记在 `overlay.json` 的 `assets`）；按段一笔 `insertItems` 写入这一段的视频片段——`timeMap.sourceIn` 是原片起点，`crop` 由像素框按素材记录里的原片宽高换成四边比例，`focus` 换成 `focalPoint`，`pip` 写 `mode: 'pip'` 与 `place`，`embeddedAudio` 带音量与淡入淡出（跟着转场长度，没有转场时 0.15 / 0.3 秒）；音量 = 10^((`footage.loudness` − 实测 LUFS) / 20)，实测用 ffmpeg 的 `ebur128` 只读地量放上去的那一段，夹在 0–4，结果缓存在 `overlay.json` 的 `loudness`。同一笔里写来源标签：标签轨（在最上面）上一个文字片段，和镜头同起同止，位置按 `footage.label.corner` 与 `inset` 固定、画中画时贴在框的一角。再一笔给 `in`、`out` 设单侧转场。一个原片的片段都放好后，把它的 `subs` 写成一份转写（原话，词时间按各条的起止摊开，每条一段）和一份译文，先对转写 `captions create`（带 `footage.subs` 的样式）单建原文层，再对译文 `captions create --bilingual` 配上它（转写没有原文层时，双语会配上画面上的旁白字幕、改掉旁白样式，脚本核对配对不对就报错）：成片语言在上、原话在下、`speakerLabel` 在最上面写说话人，样式文档与旁白字幕分开（`footage.subs` 的 `y`、`fontSize`、`font`、`speaker`）。水印放成画中画。放之前看一眼水印会不会压到画面上的字，压到了改 `at`。旁白字幕的 `captions.mjs` 认 `captions.json` 的 `_style`；视频里有了原声字幕的样式文档之后，没记 `_style` 的工程要先记上 |
| 给用户看 | `baocut web review --video <videoId>` | 在宿主的浏览器面板里打开链接，整条给用户（见 baocut 说明书 web 页「请用户审片」）。`--help` 把 `web` 列在本机管理命令下，`web review` 只开审片页，照常跑。用户逐段提意见，照第 4 节重做改到的段，再 `assemble.mjs --live`，请用户刷新；用户说可以之前不烘焙、不导出 |
| 定稿烘焙 | `node tools/assemble.mjs --dry`，再 `node tools/assemble.mjs` | 用户说可以之后不带 `--live` 再跑：`--dry` 里 live 的段标 `bake (was live)`，执行时原地换成烘焙过的包（`replace`，Δ 为 0 不挪）。每段导入后打印并记下 `bake` 的 `renderer`、`fps`、`seconds`；结尾还有没烘的段时打印 `live (not baked)`。先带 `--bake ops` 跑：只用指令烘焙，几秒一段，画不出的段 Runtime 拒绝、视频不动，脚本列出原因接着做别的段；按代码场景细则第 2.1 节改好再跑，改不了的不带 `--bake ops`（加 `--allow-pixels`）退回截图。之后再导出 |
| 交付字幕 | `node tools/srt.mjs --dry`，再 `node tools/srt.mjs [--lang zh-Hans,en] [--dir 目录] [--name 前缀]` | 字幕导出一次只取一份文档，同一语言有几份（片头每段旁白一份、正片一份、原声片段各一份）时按语言导出会以 `EXPORT_SOURCE_AMBIGUOUS` 拒绝。脚本取时间线上在用的字幕文档，按语言分组（`zh`、`zh-CN`、`zh-Hans` 归 `zh-Hans`，`en-US` 归 `en`），逐份导出后按时间合并、重新编号，每种语言写一个 `<前缀>.<语言>.srt`（缺省写到工程的 `export/`、前缀是视频名）；前后重叠的条打印出来。`--max-chars <n>` 是一行的最大宽度（全角字算 2，导出缺省 42），要和旧版字幕一样不折行时给大一些。`--dry` 只列每组的文档与条数 |
| 量画面占比 | `node tools/coverage.mjs`（或 `--from <videos inspect 存下的 JSON>` 不连 Runtime；`--json` 出机器可读的结果） | 读时间线，报每一帧最上面铺满的是实拍、代码画面还是空的各占多少、画中画占多少，镜头数与中位长度、最长一个镜头、最长一段没有实拍，实拍片段数、带原声的几段、同一素材用了几次，再按分钟列一条实拍占比。只报数不判对错：对照这期定下的形态看数对不对（`SKILL.md` 第 4 节）。在工程里跑时自动按各段代码包的 `data-alpha` 判断透明叠层，不带配置时用 `--alpha` 告诉它 |

- 定稿烘焙时第一段导入后先看 `bake`：走成 `browser-pixels` 时脚本停下并打印原因，按代码场景细则第 2.1 节改好、重新打包再跑，它会原地换包。确认走指令后，其余段可以加 `--background` 在后台排队烘焙，之后 `assemble.mjs --verify` 把烘焙结果补进记录并核对首尾相接。
- 烘全片前照代码场景细则第 2.1 节算时间与磁盘空间。
- **用 WebGL 画的段**（Three.js 等）走不了指令，一开始就带 `--allow-pixels`。实测 1080p 约 7–18 帧/秒：八分钟、一万四千多帧的片子约 25 分钟，先告诉用户。
- **旁白产物被清掉**：Runtime 会清理旧的配音产物，隔了一段时间再排时间线时按 artifactId 导入会报 `ARTIFACT_NOT_FOUND`。`assemble.mjs` 这时改导入 `voice.mjs` 存下的 `audio/<id>.<格式>`（同一份音频），不用重配。
- 自己调 CLI 读 JSON 时只读标准输出：任务进度一律写在标准错误，`2>&1` 合在一起就解析不了。`assets import` 的 `place.at` 写秒数字符串（`atOf` 算好的整帧秒数）。
- **单侧转场**：`setTransition` 只给一侧，入场给 `rightItemId`、出场给 `leftItemId`，`params` 给 `{}`；`duration` 写 `{ unit: 'frames', value: <帧数> }`，同时要写 `alignment: 'exact-frame'`。长度超过片段的一半时引擎缩短生效长度，列在回执的 `impact.shortenedTransitions` 里；脚本先按一半夹好，和后一个片段首尾相接的那一侧不设（同一条轨上背靠背只能硬切），与预览页的画法一致。放完导出一小段看转场与字幕。
- 每个脚本都能重跑：已经做完、没有变化的段跳过。
- **备选预览页**：还没建视频、或编辑器打不开时，`node tools/preview.mjs` 写 `preview.json`（各段的代码包、旁白、句子时间与稿子里的备注；实拍不再预先剪成小片段，备选预览页不叠实拍）。预览页用 `skills_read` 读 `video-production`，取它的 `examples/bundle-preview.html` 拷到工程根目录，在根目录起静态服务打开（代码场景细则第 7 节），页面跟着旁白画、叠实拍，能连播。有视频时用实时层，不用它。

## 4. 改一段

改完稿子或画面，只重做受影响的那几段，然后照常跑 `assemble.mjs`：

- 改了旁白：`voice.mjs <id>` → `align.mjs <id> --fresh` →（这段有 `gap` 片段或给了 `voice.maxPause` 时）`gaps.mjs <id>` → `build.mjs <id>`。漏了留白时 `overlay.mjs`、`assemble.mjs` 报错停下。
- 加、删或改了 `gap` 片段：`gaps.mjs <id>` → `build.mjs <id>`，段落变长变短照下面的波纹处理，旁白换成新留白的那份。
- 只改了画面：`build.mjs <id>`。
- 插一段：加进 `order` 与稿子，照第 3 节做这一段。

`assemble.mjs` 对照 `timeline.json` 找出变化，`--dry` 先看它打算怎么做：

- 帧数变了：照代码场景细则第 7 节，带 `replace: { itemId, ripple: true }` 换包。引擎把这一段旧终点之后各轨的片段（画面、旁白、字幕、音效、音乐）一起挪 Δ 帧；变短时落在多出那段里的内容被删掉、伸进来的被裁短。几段一起变时从最后一段往前做，结果的 `replaced.rippleFrames` 与包算出的 Δ 不符时停下报错。
- 帧数没变、包的内容变了：原地换包，Δ 为 0，什么都不挪。
- 旁白换了（重配过，或重跑过 `gaps.mjs` 留白、停顿变了）：波纹做完后，先把所有要换的旧旁白片段一起删掉，再逐段在段首放新的。不逐段边删边放：旧旁白可能比段首早一帧，波纹带不走它，前一段变长的新旁白会撞上它（`TIMELINE_OVERLAP`）。导入只能按秒数放，偶尔落到前一帧，脚本放好后核对起点，不在段首就按整帧挪回去。之后跑 `captions.mjs`，它同样先删掉所有旁白片段或字时间变了的段的旧字幕，再逐段重建；新字幕被挤到另一条字幕轨时打印出来，用 `moveItems` 并回原轨、删掉空轨。
- 插入的段：先用一笔 edits apply 的 `insertRange` 在上一段终点腾出它的帧数（只列之后还有片段的轨道），再放进去。
- 从 `order` 里删掉的段不自动处理：脚本报错，先在 BaoCut 里用 `removeRange` 波纹删掉它的时间段（代码场景细则第 7 节），再删掉 `timeline.json` 里的那一项。
- 跨过改动点的片段（全片音乐、在某段中间开始的音效）留在原处、不剪开。引擎挪片段时章节不动，脚本每次波纹、腾位置之后把起点不早于改动点的章节一起挪过去（`upsertChapter`）。做完脚本会核对各段首尾相接，其余自己看一遍。
- 实拍片段与水印在改动点之后的会跟着波纹一起挪；之后跑 `overlay.mjs --check`，对照视频里的位置与现在按段落算出的起点。改动所在那一段里的片段，以及改了 `clips.json` 或 `watermark.at` 的，在 BaoCut 里删掉旧片段、删掉 `overlay.json` 里对应的记录，再 `--place`。改了某个原片的 `subs` 时，`--check` 会报出来：删掉那层原声字幕片段与 `overlay.json` 里 `bites` 的那一项，再 `--place`。
- 在时间线上手工改过脚本放的东西（换了录音素材、改了原声音量或字幕样式）以后，先把改动写回配置与 `clips.json`（`asset`、`source`、`captions.style`），再重跑 `overlay.mjs --place` 或 `captions.mjs`；不然脚本按旧的设定放回去。
- 试烘焙、试导出用的临时视频，交付前列给用户；删除（`videos delete --yes`）要用户同意后再做。
