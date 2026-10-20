---
name: production-scripts
description: 有命令行环境、旁白按段配、画面按段上时间线的片子（讲解、解说混剪、旁白片、歌词视频……）要跑脚本时用：配音、对齐字时间、把场景代码打成代码包、按段摆上时间线并处理变长变短的波纹、按稿子建字幕、剪实拍与水印叠上去或垫在底下、量画面占比。脚本是一条省事的路，不规定片子的形态；形态和它不合时用 baocut CLI 自己写。只是加一段动效图形或配一句旁白时不用。
version: 1.0.0
---

# 制作脚本

一条旁白片做到后半程，重复的活都长一个样：每段旁白合成一次、转写拿字时间、把这一段的画面打成代码包、按整帧排到时间线上、按稿子建字幕、把实拍片段剪好放上去、改一段时把后面的东西一起挪。本 skill 的 `scripts/` 把这些写成了脚本，只调 baocut CLI（配音、转写、导入、修改都走它），不碰 API Key；内容相关的设定都在一份配置里，有命令行环境时拷进工程就能用。

**它是工具，不是形态。** 脚本假定的只有一件事：旁白按段配，每段配一个代码包，首尾相接排在一条视觉轨与一条音频轨上；代码包可以是整段的画面（动画打底，实拍叠在上面），也可以是透明的叠层（实拍铺在下面一条轨上当底，包里只画卡片、标注）。这期片子的底是什么、讲法是什么，由组合入口（用 `skills_read` 读 `video-production`）与相应的手艺页定；定下的形态和脚本不合（整片一条旁白不分段、画面是一条长录屏、你有更顺手的做法）时，照 `video-production` 用 BaoCut 的工具或 CLI 自己做，不为了用脚本把片子做成脚本的形状。

目录：1 计划文件　2 按顺序跑　3 改一段　4 量一遍　5 自检

## 1. 计划文件

脚本读的东西合起来就是这部片子的**制作计划**，先把它写全，再跑脚本：

| 文件 | 写什么 |
| --- | --- |
| `explainer.json`（也认 `production.json`） | 视频 id、CLI 命令、语言、帧率与画幅、段落顺序、旁白稿的位置、配音与转写的模型、打包规则、轨道与名字、实拍与水印的设定。字段表用 `skills_read` 读本 skill 的 `references/pipeline.md` 第 2 节 |
| 旁白稿（Markdown） | `## <段落 id> 标题` 开一段，段内每个非空行是一句旁白，一句一个画面节拍；`@`、括号、`>`、`<!--` 开头的行是备注（画面意图写在这里，不配音） |
| `scenes/<id>.js` + `shared/` | 每段的场景代码与共用的引擎、字体、图片；场景从 `window.TIMING` 读这一段的时长与逐句、逐字时间 |
| `clips.json`（可选） | 实拍片段与照片：来源文件与原片起止，放在哪一段的哪一句、从哪几个字起（`cue`），保留原声、旁白留白（`gap`）、背靠背（`follow`）、双语字幕、单侧转场、裁边与放法、画中画、照片的推拉（`motion`） |
| `watermark`（配置里，可选） | 水印图片、每次出现的位置与时刻 |

计划定下后，剩下的就是把它摆上时间线：`assemble.mjs` 摆旁白与代码包，`captions.mjs` 建字幕，`overlay.mjs` 剪并摆实拍与水印。改计划只重做受影响的段（第 3 节）。

## 2. 按顺序跑

1. 把本 skill 的 `scripts/` 整个拷进工程（例如 `<工程>/tools/`）：能直接读到文件时拷目录，读不到时用 `skills_read` 读本 skill 的 `scripts/` 下每个文件原样写进去。脚本都 import 同目录的 `lib.mjs`，要拷全；`*.example.json` 是配置样例。依赖 Node 18 以上与 baocut CLI；切段转写、留白压停顿、剪实拍要本机有 ffmpeg。
2. 照 `scripts/explainer.example.json` 在工程根目录写配置（脚本从当前目录往上找它，也可以 `--config <文件>`），有实拍时照 `scripts/clips.example.json` 写 `clips.json`。
3. 按顺序跑，每个脚本都能重跑，做完、没变化的段跳过：

| 步骤 | 命令 | 做什么 |
| --- | --- | --- |
| 配音 | `voice.mjs <id …>` 或 `--missing` | 一段一次合成，记稿子原文，`--missing` 只配没配过或稿子改过的段 |
| 对齐 | `align.mjs <id …>` | 转写后用编辑距离把字时间对到稿子原文，打印语速、停顿与读错 |
| 留白与压停顿 | `gaps.mjs [id …]` | 有 `gap` 片段或给了 `voice.maxPause` 时：在旁白里插静音给原声让位、把过长的句间停顿压短 |
| 打包 | `build.mjs [id …]` | 打成代码包，时长 = 对齐出的时长 + `hold`，对到整帧 |
| 预览 | `overlay.mjs --preview`（有实拍时），`preview.mjs` | 写 `preview.json`；预览页用 `skills_read` 读 `video-production`，取它的 `examples/bundle-preview.html` 拷到工程根目录，起静态服务打开，烘焙前给用户看会动的画面 |
| 排时间线 | `assemble.mjs --dry`，再 `assemble.mjs` | `--dry` 不连 Runtime 只打印；确认后执行，每段导入后看 `bake.renderer` |
| 字幕 | `captions.mjs --dry`，再 `captions.mjs` | 用稿子原文加对齐时间建字幕层，专名照稿子上屏 |
| 实拍与水印 | `overlay.mjs --dry`，`--render`，`--place` | 剪到画幅、烧来源标签与双语字幕、对响度；新建实拍轨与水印轨放好（`footage.layer` 为 `under` 时实拍轨挪到代码包轨下面当底） |

每一步的参数、配置字段、烘焙走指令还是截图、WebGL 的段、产物被清掉怎么办：用 `skills_read` 读本 skill 的 `references/pipeline.md`。

## 3. 改一段

改了稿子或画面只重做那几段：改旁白是 `voice.mjs <id>` → `align.mjs <id> --fresh` →（有留白时）`gaps.mjs <id>` → `build.mjs <id>`；只改画面是 `build.mjs <id>`；插一段是加进 `order` 与稿子后照常做这一段。然后 `assemble.mjs --dry` 看它打算怎么挪：帧数变了带 `replace.ripple` 换包，后面各轨一起挪；插入的段先 `insertRange` 腾位置；旁白换了先删旧的再放新的；之后 `captions.mjs` 重建变过的段的字幕，`overlay.mjs --check` 核对实拍位置。细则在 `references/pipeline.md` 第 4 节。

## 4. 量一遍

`node tools/coverage.mjs`（在工程里，自动读配置判断哪些代码包是透明叠层；也可以 `node coverage.mjs <videoId>` 不带配置，透明包用 `--alpha` 告诉它；`--from <videos inspect --limit 1000 --json 存下的文件>` 不连 Runtime；`--json` 出机器可读结果）。它报每一帧最上面铺满的是实拍、代码画面还是空的各占多少、画中画占多少，镜头数与中位长度、最长一个镜头、最长一段没有实拍，实拍片段数、带原声的几段、同一素材用了几次，再按分钟列一条实拍占比。它只报数不判对错：对不对看这期定的形态要的是什么（实拍打底的片子通常实拍八九成、中位镜头 3–6 秒；代码画面打底的讲解片代码画面八成以上是设计使然）。

## 5. 自检

- 第一段导入后先看 `bake.renderer`：该走指令的包回退成 `browser-pixels` 时按 `video-production` 代码场景细则第 2.1 节改好再烘其余各段；烘全片前先算时间与磁盘。
- 排完用 `videos inspect` 核对各段首尾相接、总长等于各段帧数之和；`assemble.mjs --verify` 补后台烘焙的结果并核对。
- 自己调 CLI 读 JSON 时只读标准输出，任务进度在标准错误。
- 试烘焙、试导出用的临时视频，交付前列给用户，删除要用户同意。
- 报告里写明跑了哪些脚本、哪些段重做过、量出来的数字；没听过的旁白接缝写「没听过」。
