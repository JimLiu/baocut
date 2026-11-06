<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/virtual-host/ 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 虚拟主播

> 做会说话的卡通虚拟主播时用：一个卡通角色（半身像）跟着旁白自动对口型、眨眼、点头、换表情，常驻在画面角落讲解，或在代码场景里出镜。先生成角色正面像，再改图生成各口型与闭眼的局部补丁，口型按读音与音量逐帧算出，成品是叠在视频上的透明代码画面。中文、日文、韩文、英文按读音出闭唇、咬唇、圆唇，别的拉丁字母语言按拼写粗略推，其他文字只按音量开合。不用于：真人照片或实拍视频对口型、换脸与写实数字人；角色走动、拿东西的表演（character-animation）；只要一张插图。

一个虚拟主播由四样东西组成：**角色包**（一张底图，加上口型、眨眼、表情的局部补丁）、**口型时间轴**（逐帧的口型，外加眨眼、点头、每句的朝向与表情区间）、**主播代码包**（按时间轴把补丁画到底图上）、**时间线上的位置**（叠在哪一段、从第几秒开始）。

它是 `video-production` 的一种形态：简报、能力盘点、审片、烘焙、导出照那份做法（动手前读它第 1–3 节），旁白照 `narration`；这里只补主播特有的部分。

本 skill 的 `scripts/` 要命令行环境：Node 18 以上与 ffmpeg，不调 API、不碰 API Key。用时把整个目录拷进工程（例如 `<工程>/tools/virtual-host/`）：能直接读到文件时拷目录，读不到时读 `scripts/` 下每个文件原样写进去；几个脚本互相 import，要拷全。没有命令行环境时这条路走不通，如实告诉用户。

## 1. 先定下来

| 项 | 缺省 | 说明 |
| --- | --- | --- |
| 角色 | 原创卡通角色 | 用户要照自己的照片或已有形象画时可以（本人或有授权）；不画真实的他人。正面像先给用户看，定了再生成补丁 |
| 画风 | 扁平矢量、粗描边 | 补丁贴在底图上：色块平、线条清楚的画风接缝最看不出；写实、厚涂、头发挡脸的画风容易露边 |
| 出镜 | 右下角常驻，整帧透明 | 也可以左下角、整镜出镜（画在自己的代码场景里）、两人对话（两套包、两条时间轴） |
| 表情 | 不加 | 要笑、惊讶时每种多一张补丁，按句写进 `faces.json` |
| 预算 | 约 11 次图片调用 | 正面像 1 次（出 2 张挑）、口型 7、眼睛 2、每种表情 1，再留两三次重画；按 `baocut models capabilities` 的 `cost` 估价写进计划 |

口型按读音定闭唇（b p m）、咬唇（f v）、圆唇（o u w）这些特征，按音量定张多大。中文、日文假名、韩文、英文有读音规则，西班牙文、德文这类拉丁字母语言按拼写粗略推；日文汉字、生僻字与俄文、阿拉伯文这类文字读不出读音，只按音量开合，需要时用读音表补（第 3 节）。做中、日、韩、英以外的语言时先告诉用户这一点。

## 2. 角色包

1. 用 `baocut image` 生成正面像：纯色饱和底（如 `#00B140` 绿，角色身上不能有这种颜色）、正面半身、眼睛睁开看镜头、嘴自然闭着、脸占画面高度约 45%。一次出两张给用户挑。
2. 以选定的正面像为输入（`images` 给它的 entryId）逐张改图：口型 A–G、眼睛 `half` 与 `closed`，要表情时再加。提示词要求只改嘴（或眼睛），别处一个像素不动；模板与每张的描述在 [角色包：正面像、改图与打包](virtual-host/references/art.md)。各张互不依赖，可以同时提交。
3. 用 `baocut artifacts save` 把图存进工程，照 [`examples/host.example.json`](virtual-host/examples/host.example.json) 写 `host.json`，运行 `node host-pack.mjs host.json`。它抠掉底色，把每张对齐到底图，找出改动的区域裁成补丁，写出 `pack/`（`host-data.js`、底图与补丁）、`pack/proof.png` 与 `pack/pack-report.json`。
4. 看 `proof.png` 和终端里每张的一行报告：`ok` 能用；`FIX` 按下一行的原因重画那一张，再整包重跑（同组补丁共用一个框，要一起算）。缺了某个口型也能用（借最接近的口型），但 A、D、F 三个最好都有。

## 3. 口型时间轴

1. 旁白先定稿配好（`narration`）。逐字时间来自 `production-scripts` 的 `timing/<段>.json`；或者给配音单独转写一次：`baocut transcribe` 给 `file` 并带 `noVideo: true`，`baocut jobs inspect` 等到 completed，`pipeline.summary.transcribeJobId` 是内层转写任务，再 `baocut jobs inspect` 它，用 `baocut artifacts save` 把转写结果存成 `<名>.words.json`（`baocut.asr-result/v1`）。
2. 运行 `node lipsync.mjs --words intro.words.json --audio intro.wav --out host/host-track.js --lang zh-CN`（timing 用 `--timing`）。一定给 `--audio`，而且是放进视频的那份配音：音量决定静音时闭嘴、轻读时嘴小，也兜住对齐误差。选项、`faces.json` 与读音表的写法在 [口型时间轴：输入、选项与核对](virtual-host/references/lipsync.md)。
3. 读同目录的 `lipsync-check.txt`：每个字的读音、读音给的口型和画面上实际出的帧。读音不对（多音字、日文汉字、品牌名、缩写）写进读音表、带 `--readings` 重跑；`?` 是读不出的字，按音量张嘴。

## 4. 代码包与时间线

1. 新建包目录：拷 `examples/corner-host/` 的 `index.html` 与 `scene.js`、[`host-kit/host-kit.js`](virtual-host/host-kit/host-kit.js)、`pack/` 里的 PNG 与 `host-data.js`、`host-track.js`。`index.html` 的 `data-duration` 写配音时长（时间轴的 `offset + dur`），尺寸与帧率照视频。位置与大小在 `scene.js` 里改；画法、嵌进别的代码场景、两个主播的写法在 [主播代码包：HostKit 的画法与摆放](virtual-host/references/kit.md)。
2. 用 `baocut compositions preview` 取几帧看：闭唇的字、张大嘴的字、一次眨眼、表情的进出。主播在画面里很小，把那块裁出来拼成一张看。
3. 用 `baocut compositions import` 导入：整帧透明，默认放在最上面一条视觉轨；`place.at` 写配音在时间线上的起点（或者 lipsync 时给 `--offset`、包从 0 秒放）。透明的主播叠在实拍或别的代码画面上，实时层画不出（`video-production` 代码场景细则第 7 节），所以这个包导入时就烘焙；它只画补丁，走指令烘焙很快。改了时间轴或位置时用 `replace: { itemId }` 重新导入这一个包。
4. 导出前照 `video-production` 审片：请用户在编辑器里听着看一遍主播那块，闭唇的字要闭上、长元音要张开、句间停顿要闭嘴。用户看过再导出。

## 5. 常见问题

| 现象 | 原因与改法 |
| --- | --- |
| 嘴整体比声音早或晚一截 | 包的位置与配音不一致：`place.at` 对齐配音的起点，或按配音的起点给 `--offset` 重算 |
| 整句嘴都半张、停顿也不闭 | 没给 `--audio`，或给的不是放进视频的那份配音 |
| 某个字口型不对 | 先看核对表：读音错了补读音表；读音对、帧不对多半是逐字时间偏了，重新对齐或重新转写 |
| 补丁边上一圈色差、线条断开 | 那张改图动了框外的像素：重画；或在 `host.json` 的 `boxes` 里放大这组的框 |
| 眨眼时眉毛、眼镜跳一下 | 眼睛那组的改图动了眉毛或眼镜：重画，提示词写明它们不动 |
| 角色晃得太多或太僵 | `HostKit.host(pack, track, { motion: 0.5 })` 调小，`motion: 0` 只眨眼不动 |

## 同目录的文件

在 `references/craft/virtual-host/` 下，用到时再打开；代码与样例原样复制，按正文说的用法取用。

- [`examples/corner-host/index.html`](virtual-host/examples/corner-host/index.html)
- [`examples/corner-host/scene.js`](virtual-host/examples/corner-host/scene.js)
- [`examples/host.example.json`](virtual-host/examples/host.example.json)
- [`host-kit/host-kit.js`](virtual-host/host-kit/host-kit.js)
- [角色包：正面像、改图与打包](virtual-host/references/art.md)
- [主播代码包：HostKit 的画法与摆放](virtual-host/references/kit.md)
- [口型时间轴：输入、选项与核对](virtual-host/references/lipsync.md)
- [`scripts/host-pack.mjs`](virtual-host/scripts/host-pack.mjs)
- [`scripts/image-io.mjs`](virtual-host/scripts/image-io.mjs)
- [`scripts/lipsync.mjs`](virtual-host/scripts/lipsync.mjs)
- [`scripts/pinyin-table.mjs`](virtual-host/scripts/pinyin-table.mjs)
- [`scripts/visemes.mjs`](virtual-host/scripts/visemes.mjs)
