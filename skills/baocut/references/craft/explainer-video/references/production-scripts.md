<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/explainer-video/references/production-scripts.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 制作脚本：配音、对齐、打包、预览、摆上时间线、建字幕、叠实拍

`SKILL.md` 第 6 节的细则。代码画面为主的讲解片按段做（一段旁白一个代码包），每期都要的五步（配音、对齐、打包、摆上时间线、建字幕）和几个可选步骤（预览页配置；实拍片段与水印；给原声片段在旁白里留白）已经写成 `scripts/` 下的脚本，有命令行环境时拷过去用，不再每期重写。脚本只调 baocut CLI（配音、转写、导入、修改都走它），不碰 API Key；内容相关的设定都在一份配置里。

## 1. 适用

- 适用：整段画面由代码画（`baocut/1` 代码包，见 `video-production` 代码场景细则），旁白按段配，一段旁白对一个代码包，首尾相接排在一条视觉轨与一条音频轨上。
- 不适用：画面以实拍、录屏、生成的视频为主；整片一条旁白不分段；没有命令行环境（这时照 `SKILL.md` 第 6 节「分段做、分段改」手动做）。
- 依赖：Node 18 以上，能运行 baocut CLI。`align.mjs --chunk` 切段、`gaps.mjs` 留白与压停顿、 `overlay.mjs` 剪片段时要本机有 ffmpeg（烧双语字幕要带 libass 的 `subtitles` 滤镜）。

## 2. 拷过去、写配置

1. 把本 skill 的 `scripts/` 整个拷进工程，例如 `<工程>/tools/`：能直接读到文件时拷目录，读不到时读 `scripts/` 下每个文件，原样写进去。脚本都 import 同目录的 `lib.mjs`，要拷全；`*.example.json` 是配置样例，不用拷。
2. 照 [`scripts/explainer.example.json`](../scripts/explainer.example.json) 在工程根目录写 `explainer.json`（脚本从当前目录往上找它，也可以 `--config <文件>`；工程根目录 = 配置所在目录，配置里的路径都相对它）。

| 字段 | 是什么 |
| --- | --- |
| `video` | 成片视频的 ID。另一种语言或画幅的版本是另一部视频、另一个工程目录、另一份配置 |
| `bc` | 调 CLI 的命令，默认 `["baocut"]`；开发版或包装脚本写它的路径（`./` 开头相对工程根目录） |
| `language` | 旁白语言（BCP 47），配音、转写、转写文稿都用它 |
| `fps`、`canvas` | 帧率与画幅（`width`、`height`、`background`），和视频的序列一致 |
| `order` | 段落 id 按播放顺序；固定开场不一定在第一个（钩子之后再进开场很常见） |
| `script` | 旁白稿：`path` 与 `notePrefixes`（这些字符开头的行是备注，默认全角、半角括号、`>`、`<!--`） |
| `fixedLines` | 不从稿子读的段（固定开场、结尾口播），逐字照用户给的写 |
| `hold` | 某段在最后一句之后多停的秒数，例如片尾卡 |
| `estimateRate` | 还没配音时估时长用的语速（单位/秒：汉字、假名一个字一个单位，其余文字一个词一个单位）；首稿取实测值 |
| `voice` | `provider`、`model`、`voice`、`instructions`、`format`；`attach` 为 true 时配音结果同时作为候选素材进视频；`maxPause`（秒）给了时 `gaps.mjs` 把句间长于它的静音压到这么长，短档给 0.3（`length-and-pace.md` 第 2 节），中档、长档可以不给，留自然的停顿 |
| `asr` | 对齐用的转写：`provider`、`model`、`chunkSeconds`（大于 0 时长段切块转写） |
| `names.narration` | 旁白素材与转写文稿的名字前缀，用成片语言写 |
| `bundle` | 打包规则：`pick`（只拷场景里提到的文件的子目录，默认 `img`）、`keep`（总拷）、`exclude`（不拷）、`scripts`（入口加载的共享脚本，默认 `shared/` 顶层的 `.js`）、`module`（为 true 时 `scene.js` 按 ES 模块加载，能 `import` 包里的库，例如 Three.js）、`fonts`（`{ 字体族名: 包内相对路径 }`，写成入口里的 `@font-face`） |
| `tracks` | 可选，`visual` 与 `audio` 轨道 ID；不给时用第一条视觉轨与第一条音频轨 |
| `names.footage`、`names.watermark` | 可选，实拍片段与水印所在轨道、素材的名字，用成片语言写 |
| `preview.caption` | 可选，预览页上字幕带的样式（与字幕样式同一套键：`y`、`verticalAlign`、`fontSize`、`width`） |
| `footage` | 可选：`clips`（片段清单，默认 `clips.json`）、`font`（来源标签用的字体文件）、`label`（`size`、`margin`，像素）、`loudness`（原声的响度，LUFS，默认 -17）、`subs`（双语字幕：`fontsDir` 字体目录、`font` 与 `size` 成片语言那行、`trFont` 与 `trSize` 原话那行、`whoSize` 说话人、`marginV` 离底边的像素；字体写字体族名） |
| `watermark` | 可选：`file`（图片）、`dur`（每次几秒）、`w`、`y`、`x.left`、`x.right`（画面宽高的百分比）、`at`（每次出现的位置：`{ seg, line, cue?, side }` 跟着旁白走，或 `{ t, side }` 写死时间线秒数） |

旁白稿的写法：`## <段落 id> 标题` 开一段（id 要在 `order` 里），段内每个非空行是一句旁白，一句一个画面节拍；别的一、二级标题或单独一行的 `---` 结束这一段，所以来源、简化说明、分镜草案可以写在同一个文件里。

工程目录：`scenes/<id>.js`（每段的场景代码）、`shared/`（各段共用的引擎、字体、图片），脚本生成 `audio/`、`timing/`、`bundles/`、`.baocut-out/`，记录 `audio/voice.json`、`timeline.json`、`captions.json`、`overlay.json`，预览页读 `preview.json`。有实拍时写一份 `clips.json`（样例 [`scripts/clips.example.json`](../scripts/clips.example.json)）：每个片段的原片起止秒数，放在哪一段的哪一句（`line` 从 0 数），可选从这句里哪几个字开始（`cue`）、保留原声（`audio`：`true`，或 0–1 的音量）、旁白在这里停下单独放（`gap`，这时 `line` 是插在哪一句之前，等于句数时放在段尾；几个 `gap` 片段给同一个 `line` 时按清单先后背靠背连放）、紧接上一个片段放（`follow`：不看 `line` / `cue`，接在清单里上一个片段的原长之后，几段素材连成一块、中间硬切）、双语字幕（`subs`：`[{ from, to, text, tr, who? }]`，原片秒数）、单侧转场（`in`、`out`：`{ kind, dur?, easing? }`，`kind` 取 `dissolve`、`wipe`、`slide`、`zoom`、`iris`，`dur` 默认 0.5 秒，`easing` 默认 `ease-in-out`）、裁边与放法（`crop`：`[x, y, w, h]` 原片像素；`fit`：默认 `cover` 铺满裁切，`contain` 整幅放进、补黑边；`pip`：`{ x, y, w }` 放成画中画，`x`、`y` 是框中心、`w` 是框宽，都是画布的百分比，高按原片裁过之后的宽高比，不能和 `subs` 一起用）、另一个来源文件与标签。场景代码从 `window.TIMING` 读这一段的时长与逐句、逐字时间（`{dur, lines:[{text, start, end, chars}]}`，`chars[k]` 是第 k 个字符开始被说到的秒数），在 `window.__baocutCompositions[<compositionId>]` 上注册（默认 `main`）。

## 3. 按顺序跑

| 步骤 | 命令 | 做什么，看什么 |
| --- | --- | --- |
| 配音 | `node tools/voice.mjs <id …>` 或 `--missing` | 一段一次合成，存 `audio/<id>.<格式>`，记 `voice.json`（连同当时的稿子原文）。`--missing` 只配没配过或稿子改过的段。任务被 Runtime 重启打断时自动重试；`--seed` 只对收 seed 的模型有用，不收的模型直接重跑就是另一次合成 |
| 对齐 | `node tools/align.mjs <id …>` | 转写后用编辑距离把字时间对到稿子原文，写 `timing/<id>.json`；打印每句的语速（偏离中位数超过 15% 标 RATE；两秒以内的短句容差放宽到 0.3 秒 / 句长，免得句首句尾的误差句句都标）、句间停顿（超过 0.8 秒标 GAP）、多念、漏念与念错的字。读错的处理照 `SKILL.md` 第 6 节「读音核对」。提示时间塌了时 `--fresh --chunk 14` 重转 |
| 留白与压停顿 | `node tools/gaps.mjs [id …]`（有 `gap` 片段或给了 `voice.maxPause` 时） | 在 `gap` 片段所在那句之前插一段静音（片段长 + 0.35 秒；同一句前的几个 `gap` 片段共用一段，长度是它们的总长 + 0.35 秒），后面的句子整体后挪；给了 `maxPause`（或 `--max-pause 秒数`）时，把句与句之间长于它的静音压到这么长，句内的停顿、留白的接缝与固定口播的段不动。写 `audio/<id>.gaps.<格式>`，`timing/<id>.json` 改成挪过的时间并带上 `gaps`、`tightened` 与 `gapAudio`，原始对齐存成 `timing/<id>.voice.json`，可以反复跑。之后打包、预览、排时间线、字幕都按留过白的时间走，`assemble.mjs` 导入留好白的那份旁白 |
| 打包 | `node tools/build.mjs [id …]` | 打成 `bundles/<id>/`，时长 = 对齐出的时长 + `hold`，对齐到整帧。还没对齐的段按估算时长打包，只用于配音前的样帧 |
| 预览 | `node tools/overlay.mjs --preview`（有实拍时），再 `node tools/preview.mjs` | `--preview` 只剪新的或来源、起止、裁法改过的片段（`--force` 全部重剪）；段里最后一个片段超出段尾时两个脚本都会提示，截到段尾，要么改短 `to`，要么把它往前挪。写 `preview.json`：各段的代码包、旁白、句子时间、稿子里的备注与叠在上面的实拍。把 `video-production` 的 `examples/bundle-preview.html` 拷到工程根目录，在根目录起静态服务打开（代码场景细则第 7 节）。页面跟着旁白画、叠实拍，能连播。烘焙前给用户看 |
| 排时间线 | `node tools/assemble.mjs --dry`，再 `node tools/assemble.mjs` | `--dry` 不连 Runtime，打印每段的起始帧、帧数和要做的事；确认后去掉 `--dry` 执行。每段导入后打印并记下 `bake` 的 `renderer`、`fps`、`seconds` |
| 字幕 | `node tools/captions.mjs --dry`，再 `node tools/captions.mjs` | 用稿子原文加对齐时间写转写文稿、建字幕层，专名照稿子的写法上屏。字幕默认比第一个字早约半秒出现，从 0 秒起的那段建好后把字幕片段起点裁到第一个字，封面上不带字幕 |
| 实拍与水印 | `node tools/overlay.mjs --dry`，再 `--render`，再 `--place` | `--dry` 打印每段实拍与每次水印在时间线上的起止、留白、原声、字幕条数与转场；`--render` 按 `crop`、`fit` 放进画幅（`pip` 的片段剪成框的像素大小）、对到整帧，把来源标签烧进右上角、双语字幕烧在底部，原声按转场长度淡入淡出、响度对到 `footage.loudness`；`--place` 新建两条视觉轨（名字取 `names`），导入片段铺满放好（`pip` 的用 `setStyle` 的 `mode: 'pip'` 加 `setTransform` 的 `x`、`y`、`w` 放成画中画，转场作用在框上），数字的 `audio` 用 `setAudioMix` 设音量，`in`、`out` 用 `setTransition` 设成单侧转场，水印放成画中画。放之前看一眼水印会不会压到画面上的字，压到了改 `at` |

- 第一段导入后先看 `bake`：走成 `browser-pixels` 时脚本停下并打印原因，按代码场景细则第 2.1 节改好、重新打包再跑，它会原地换包。确认走指令后，其余段可以加 `--background` 在后台排队烘焙，之后 `assemble.mjs --verify` 把烘焙结果补进记录并核对首尾相接。
- 烘全片前照代码场景细则第 2.1 节算时间与磁盘空间。
- **用 WebGL 画的段**（Three.js 等）走不了指令，一开始就带 `--allow-pixels`。实测 1080p 约 7–18 帧/秒：八分钟、一万四千多帧的片子约 25 分钟，先告诉用户。
- **旁白产物被清掉**：Runtime 会清理旧的配音产物，隔了一段时间再排时间线时按 artifactId 导入会报 `ARTIFACT_NOT_FOUND`。`assemble.mjs` 这时改导入 `voice.mjs` 存下的 `audio/<id>.<格式>`（同一份音频），不用重配。
- 自己调 CLI 读 JSON 时只读标准输出：任务进度一律写在标准错误，`2>&1` 合在一起就解析不了。`assets import` 的 `place.at` 写秒数字符串（`atOf` 算好的整帧秒数）。
- **单侧转场**：`setTransition` 只给一侧，入场给 `rightItemId`、出场给 `leftItemId`，`params` 给 `{}`；`duration` 写 `{ unit: 'frames', value: <帧数> }`，同时要写 `alignment: 'exact-frame'`。长度超过片段的一半时引擎缩短生效长度，列在回执的 `impact.shortenedTransitions` 里；脚本先按一半夹好，和后一个片段首尾相接的那一侧不设（同一条轨上背靠背只能硬切），与预览页的画法一致。放完导出一小段看转场与字幕（`footage.md` 第 5 节）。
- 每个脚本都能重跑：已经做完、没有变化的段跳过。

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
- 跨过改动点的片段（全片音乐、在某段中间开始的音效）留在原处、不剪开；章节也不跟着挪，之后的章节另用 `upsertChapter` 改 `at`。做完脚本会核对各段首尾相接，其余自己看一遍。
- 实拍片段与水印在改动点之后的会跟着波纹一起挪；之后跑 `overlay.mjs --check`，对照视频里的位置与现在按段落算出的起点。改动所在那一段里的片段，以及改了 `clips.json` 或 `watermark.at` 的，在 BaoCut 里删掉旧片段、删掉 `overlay.json` 里对应的记录，再 `--render`、`--place`。
- 试烘焙、试导出用的临时视频，交付前列给用户；删除（`videos delete --yes`）要用户同意后再做。
