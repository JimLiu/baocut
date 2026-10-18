# 制作脚本：配音、对齐、打包、摆上时间线、建字幕

`SKILL.md` 第 5 节的细则。讲解片按段做（一段旁白一个代码包），每期都要的五步已经写成 `scripts/` 下的脚本，有命令行环境时拷过去用，不再每期重写。脚本只调 baocut CLI（配音、转写、导入、修改都走它），不碰 API Key；内容相关的设定都在一份配置里。

## 1. 适用

- 适用：整段画面由代码画（`baocut/1` 代码包，见 `video-production` 代码场景细则），旁白按段配，一段旁白对一个代码包，首尾相接排在一条视觉轨与一条音频轨上。
- 不适用：画面以实拍、录屏、生成的视频为主；整片一条旁白不分段；没有命令行环境（这时照第 5 节「分段做、分段改」手动做）。
- 依赖：Node 18 以上，能运行 baocut CLI。`align.mjs --chunk` 切段时要本机有 ffmpeg。

## 2. 拷过去、写配置

1. 把本 skill 的 `scripts/` 整个拷进工程，例如 `<工程>/tools/`：能直接读到文件时拷目录，读不到时用 `skills_read` 读本 skill 的 `scripts/` 下每个文件，原样写进去。五个脚本都 import 同目录的 `lib.mjs`，要拷全。
2. 照 `scripts/explainer.example.json` 在工程根目录写 `explainer.json`（脚本从当前目录往上找它，也可以 `--config <文件>`；工程根目录 = 配置所在目录，配置里的路径都相对它）。

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
| `voice` | `provider`、`model`、`voice`、`instructions`、`format`；`attach` 为 true 时配音结果同时作为候选素材进视频 |
| `asr` | 对齐用的转写：`provider`、`model`、`chunkSeconds`（大于 0 时长段切块转写） |
| `names.narration` | 旁白素材与转写文稿的名字前缀，用成片语言写 |
| `bundle` | 打包规则：`pick`（只拷场景里提到的文件的子目录，默认 `img`）、`keep`（总拷）、`exclude`（不拷）、`scripts`（入口加载的共享脚本，默认 `shared/` 顶层的 `.js`） |
| `tracks` | 可选，`visual` 与 `audio` 轨道 ID；不给时用第一条视觉轨与第一条音频轨 |

旁白稿的写法：`## <段落 id> 标题` 开一段（id 要在 `order` 里），段内每个非空行是一句旁白，一句一个画面节拍；别的一、二级标题或单独一行的 `---` 结束这一段，所以来源、简化说明、分镜草案可以写在同一个文件里。

工程目录：`scenes/<id>.js`（每段的场景代码）、`shared/`（各段共用的引擎、字体、图片），脚本生成 `audio/`、`timing/`、`bundles/`、`.baocut-out/`，记录 `audio/voice.json`、`timeline.json`、`captions.json`。场景代码从 `window.TIMING` 读这一段的时长与逐句、逐字时间（`{dur, lines:[{text, start, end, chars}]}`，`chars[k]` 是第 k 个字符开始被说到的秒数），在 `window.__baocutCompositions[<compositionId>]` 上注册（默认 `main`）。

## 3. 按顺序跑

| 步骤 | 命令 | 做什么，看什么 |
| --- | --- | --- |
| 配音 | `node tools/voice.mjs <id …>` 或 `--missing` | 一段一次合成，存 `audio/<id>.<格式>`，记 `voice.json`（连同当时的稿子原文）。`--missing` 只配没配过或稿子改过的段 |
| 对齐 | `node tools/align.mjs <id …>` | 转写后用编辑距离把字时间对到稿子原文，写 `timing/<id>.json`；打印每句的语速（偏离中位数 15% 标 RATE）、句间停顿（超过 0.8 秒标 GAP）、多念、漏念与念错的字。读错的处理照 `SKILL.md` 第 5 节「读音核对」。提示时间塌了时 `--fresh --chunk 14` 重转 |
| 打包 | `node tools/build.mjs [id …]` | 打成 `bundles/<id>/`，时长 = 对齐出的时长 + `hold`，对齐到整帧。还没对齐的段按估算时长打包，只用于配音前的样帧 |
| 预览 | 见 `video-production` 代码场景细则第 7 节 | 烘焙前给用户看会动的画面 |
| 排时间线 | `node tools/assemble.mjs --dry`，再 `node tools/assemble.mjs` | `--dry` 不连 Runtime，打印每段的起始帧、帧数和要做的事；确认后去掉 `--dry` 执行。每段导入后打印并记下 `bake` 的 `renderer`、`fps`、`seconds` |
| 字幕 | `node tools/captions.mjs --dry`，再 `node tools/captions.mjs` | 用稿子原文加对齐时间写转写文稿、建字幕层，专名照稿子的写法上屏 |

- 第一段导入后先看 `bake`：走成 `browser-pixels` 时脚本停下并打印原因，按代码场景细则第 2.1 节改好、重新打包再跑，它会原地换包。确认走指令后，其余段可以加 `--background` 在后台排队烘焙，之后 `assemble.mjs --verify` 把烘焙结果补进记录并核对首尾相接。
- 烘全片前照代码场景细则第 2.1 节算时间与磁盘空间。
- 每个脚本都能重跑：已经做完、没有变化的段跳过。

## 4. 改一段

改完稿子或画面，只重做受影响的那几段，然后照常跑 `assemble.mjs`：

- 改了旁白：`voice.mjs <id>` → `align.mjs <id> --fresh` → `build.mjs <id>`。
- 只改了画面：`build.mjs <id>`。
- 插一段：加进 `order` 与稿子，照第 3 节做这一段。

`assemble.mjs` 对照 `timeline.json` 找出变化，`--dry` 先看它打算怎么做：

- 帧数变了：照代码场景细则第 7 节，带 `replace: { itemId, ripple: true }` 换包。引擎把这一段旧终点之后各轨的片段（画面、旁白、字幕、音效、音乐）一起挪 Δ 帧；变短时落在多出那段里的内容被删掉、伸进来的被裁短。几段一起变时从最后一段往前做，结果的 `replaced.rippleFrames` 与包算出的 Δ 不符时停下报错。
- 帧数没变、包的内容变了：原地换包，Δ 为 0，什么都不挪。
- 旁白换了：删掉旧的旁白片段，在同一起点放新的；之后跑 `captions.mjs`，它发现旁白片段或字时间变了，会删掉这段旧的字幕片段再重建。
- 插入的段：先用一笔 edits apply 的 `insertRange` 在上一段终点腾出它的帧数（只列之后还有片段的轨道），再放进去。
- 从 `order` 里删掉的段不自动处理：脚本报错，先在 BaoCut 里用 `removeRange` 波纹删掉它的时间段（代码场景细则第 7 节），再删掉 `timeline.json` 里的那一项。
- 跨过改动点的片段（全片音乐、在某段中间开始的音效）留在原处、不剪开；章节也不跟着挪，之后的章节另用 `upsertChapter` 改 `at`。做完脚本会核对各段首尾相接，其余自己看一遍。
