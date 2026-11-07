<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/virtual-host/ 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 虚拟主播

> 做会说话的卡通虚拟主播时用：一个卡通角色（半身像）跟着旁白自动对口型，会眨眼、呼吸、点头转头、头发跟着晃，可以换表情，常驻在画面角落讲解或整镜出镜。先生成角色正面像，再改图得到光头底图、几种嘴型、闭眼与表情，脚本拆成分层的角色包；口型按读音与音量算成动作轨；放上时间线是一个角色贴纸，预览与导出直接画，不用烘焙。中文、日文、韩文、英文按读音出闭唇、咬唇、圆唇，别的拉丁字母语言按拼写粗略推，其他文字只按音量开合。不用于：真人照片或实拍视频对口型、换脸与写实数字人；角色走动、拿东西的表演（character-animation）；只要一张插图。

一个虚拟主播是时间线上的一个**角色贴纸**，它指着两份素材：

- **角色包**（`.bcpuppet`）：一张正面像拆成的分层角色。头发、眼睛、眉毛、嘴、身体各在一层，引擎按物理画出转头点头、头发跟着晃，以及眨眼、呼吸、视线这些待机动作。
- **动作轨**（`baocut-puppet-track` 的 JSON）：嘴张多大、圆嘴扁嘴、转头点头与表情随时间的曲线，由配音算出来。

预览与导出都由引擎直接画这个贴纸，不经代码画面，不用烘焙。

它是 `video-production` 的一种形态：简报、能力盘点、审片、导出照那份做法（动手前读它第 1–3 节），旁白照 `narration`；这里只补主播特有的部分。

本 skill 的 `scripts/` 要命令行环境：Node 22 以上与 ffmpeg，不调 API、不碰 API Key。用时把整个目录拷进工程（例如 `<工程>/tools/virtual-host/`）：能直接读到文件时拷目录，读不到时读 `scripts/` 下每个文件（含 `scripts/puppet/`）原样写进去；脚本互相 import，要拷全。没有命令行环境时这条路走不通，如实告诉用户。

## 1. 先定下来

| 项 | 缺省 | 说明 |
| --- | --- | --- |
| 角色 | 原创卡通角色 | 用户要照自己的照片或已有形象画时可以（本人或有授权）；不画真实的他人。正面像先给用户看，定了再改图 |
| 画风 | 扁平矢量、粗描边、平涂色块 | 脚本按颜色分出头发、皮肤、眼白和线条：厚涂、写实、渐变多的画风分不开。能做的范围见第 2 节第 1 步 |
| 出镜 | 右下角常驻 | 也可以左下角、整镜出镜（放大放到画面中间）、两人对话（两个角色包、两条动作轨） |
| 表情 | 不加 | 要笑时多一张改图，按句写进 `faces.json` |
| 预算 | 约 9 次图片调用 | 正面像 1 次（出 2 张挑）、光头重绘 1、嘴 4、闭眼 1、每种表情 1，再留两三次重画；按 `baocut models capabilities` 的 `cost` 估价写进计划 |

口型按读音定闭唇（b p m）、咬唇（f v）、圆唇（o u w）这些特征，按音量定张多大。中文、日文假名、韩文、英文有读音规则，西班牙文、德文这类拉丁字母语言按拼写粗略推；日文汉字、生僻字与俄文、阿拉伯文这类文字读不出读音，只按音量开合，需要时用读音表补（第 3 节）。做中、日、韩、英以外的语言时先告诉用户这一点。

## 2. 角色包

1. 用 `baocut image` 生成正面像，提示词在 [角色包：正面像、光头重绘、改图与打包](virtual-host/references/art.md) 第 1 节，一次出两张给用户挑。脚本能拆的范围：纯色饱和底；正面；有头发（光头角色还不支持）；两只眼睛睁开、露出眼白；嘴闭成一条线；皮肤是浅的暖色（别的肤色在 `character.json` 写 `skin`）；描边是一种深色（黑、深棕都行）。
2. 用 `baocut artifacts save` 把选定的图存进工程，照 [`examples/character.example.json`](virtual-host/examples/character.example.json) 写 `character.json`（字段见 [角色包：正面像、光头重绘、改图与打包](virtual-host/references/art.md) 第 4 节），运行 `node puppet-mask.mjs character.json`。它找出头发，写出 `hair-mask.json`（`baocut retouch` 的选区）和 `hair-mask.png`（白色是头发）。看一眼 PNG：白色应该正好盖住头发，不带耳朵、脸的轮廓。
3. 光头重绘：`baocut retouch` `op: "repaint"`，`files` 给正面像，`mask` 给 `hair-mask.json` 的内容，`prompt` 照 [角色包：正面像、光头重绘、改图与打包](virtual-host/references/art.md) 第 2 节。结果（`<原名>-repainted.png`）是头发下面的头皮：头发晃开、转头时露出来的就是它。写进 `bald`。
4. 改图：以正面像为输入（`images` 给它的 entryId），出 4 种嘴（`half`、`open`、`round`、`wide`）、闭眼（`lids`）和要的表情，模板与每张的描述在 [角色包：正面像、光头重绘、改图与打包](virtual-host/references/art.md) 第 3 节。各张互不依赖，可以同时提交。存进工程，写进 `character.json`。
5. 运行 `node puppet-build.mjs character.json`。每项检查打一行：`ok` 能用，`FIX` 后面写着重画哪一张、为什么；有 `FIX` 时退出码是 1。重画那一张后整个重跑（几秒到半分钟）。全部 `ok` 后看 `puppet/rest-diff.png`：几乎全黑才对，亮的地方是静止时和正面像不一样的地方。成品是 `puppet/<name>.bcpuppet`。每项检查的读法在 [角色包：正面像、光头重绘、改图与打包](virtual-host/references/art.md) 第 4 节。

## 3. 动作轨

1. 旁白先定稿配好（`narration`）。逐字时间来自 `production-scripts` 的 `timing/<段>.json`；或者给配音单独转写一次：`baocut transcribe` 给 `file` 并带 `noVideo: true`，`baocut jobs inspect` 等到 completed，`pipeline.summary.transcribeJobId` 是内层转写任务，再 `baocut jobs inspect` 它，用 `baocut artifacts save` 把转写结果存成 `<名>.words.json`（`baocut.asr-result/v1`）。
2. 运行 `node lipsync.mjs --words intro.words.json --audio intro.wav --out host/intro.track.json --lang zh-CN`（timing 用 `--timing`）。一定给 `--audio`，而且是放进视频的那份配音：音量决定静音时闭嘴、轻读时嘴小，也兜住对齐误差。轨的 0 秒是配音的 0 秒。选项、`faces.json` 与读音表的写法在 [动作轨：输入、选项与核对](virtual-host/references/lipsync.md)。
3. 读同目录的 `lipsync-check.txt`：每个字的读音、读音给的口型和画面上实际出的口型。读音不对（多音字、日文汉字、品牌名、缩写）写进读音表、带 `--readings` 重跑；`?` 是读不出的字，按音量张嘴。

## 4. 放上时间线

用 `baocut edits apply` 一笔做完：两次 importAsset（角色包与动作轨，`storage: "managed"`，各给一个 `ref`），加一条 insertItems。主播放在最上面一条视觉轨（没有空的就同一笔 addTrack，用 `trackRef`）：

```json
{ "type": "insertItems", "items": [{
  "type": "sticker", "trackId": "<视觉轨>", "span": { "fromFrame": 0, "durationFrames": 900 },
  "place": { "x": 84, "y": 74, "w": 30 },
  "sticker": { "source": "asset" }, "assetImportRef": "host", "motionImportRef": "intro",
  "motionIn": { "ticks": "0", "timescale": 1 }
}] }
```

- **对齐配音**：`motionIn` 是贴纸开头对着动作轨的第几秒。贴纸和配音同时开始写 0；贴纸比配音早 2 秒出现（先待机再开口）写 `{"ticks": "-2", "timescale": 1}`（`ticks` 是整数字符串，负半秒写 `{"ticks": "-1", "timescale": 2}`）。嘴早了或晚了一截，多半是这里没对上。
- **位置**：贴纸的框是正方形，宽是画布宽的 `w`%。16:9 画面放右下角约 `{"x": 84, "y": 74, "w": 30}`，下沿压在画外；9:16 约 `{"x": 74, "y": 86, "w": 50}`。整镜出镜放中间，`w` 加大。
- **长度**：`span` 盖住要出镜的整段。动作轨之外（配音前、配音后）角色照样眨眼呼吸，嘴闭着。
- **换配音**：重新算动作轨，replaceItemAsset 给这个贴纸和新动作轨的 `assetImportRef`：只换动作轨，位置与长度不变。换角色同样用 replaceItemAsset，给新的角色包。
- **两个主播**：两个角色包、两条动作轨、两个贴纸；`--seed` 给不同的值，免得点头同步。

审片照 `video-production`：`baocut videos frames` 取的帧不含贴纸，看主播要在编辑器的预览里看（直接画），或者用 `baocut export` 导出那一段的预览（`purpose: "preview"`，`range`）。请用户听着看一遍主播那块：闭唇的字要闭上、长元音要张开、句间停顿要闭嘴。用户看过再导出成片。

## 5. 常见问题

| 现象 | 原因与改法 |
| --- | --- |
| 嘴整体比声音早或晚一截 | `motionIn` 没对上配音：贴纸开头比配音早几秒就写负几秒 |
| 整句嘴都半张、停顿也不闭 | 算动作轨时没给 `--audio`，或给的不是放进视频的那份配音 |
| 某个字口型不对 | 先看核对表：读音错了补读音表；读音对、口型不对多半是逐字时间偏了，重新对齐或重新转写 |
| 只眨眼、不说话 | 贴纸没挂动作轨（`motionRef`），或 `motionIn` 让配音落到了贴纸之外 |
| `puppet-mask` 或 `puppet-build` 第一行就是 `FIX portrait` | 正面像不在能拆的范围（第 2 节第 1 步）：照后面的原因重画正面像，或在 `character.json` 写 `skin`、`line`、`hair` |
| 转头、头发晃开时露出头发的残影或一块底色 | 光头重绘不干净：照 `FIX bald repaint` 的原因重画，或重跑 `puppet-mask` 再重画 |
| 说话时嘴边一圈色块、线条断开 | 那张嘴的改图动了嘴外面的像素：重画那一张 |
| 笑的时候脸上一块颜色不对 | 表情的改图动了脸的别处：重画，提示词强调只改嘴 |
| 主播太小看不清嘴 | 加大 `w`；1024 像素的角色画到 300 像素以下时嘴型很难看出来 |

## 同目录的文件

在 `references/craft/virtual-host/` 下，用到时再打开；代码与样例原样复制，按正文说的用法取用。

- [`examples/character.example.json`](virtual-host/examples/character.example.json)
- [角色包：正面像、光头重绘、改图与打包](virtual-host/references/art.md)
- [动作轨：输入、选项与核对](virtual-host/references/lipsync.md)
- [`scripts/lipsync.mjs`](virtual-host/scripts/lipsync.mjs)
- [`scripts/pinyin-table.mjs`](virtual-host/scripts/pinyin-table.mjs)
- [`scripts/puppet/align.mjs`](virtual-host/scripts/puppet/align.mjs)
- [`scripts/puppet/edits.mjs`](virtual-host/scripts/puppet/edits.mjs)
- [`scripts/puppet/eyes.mjs`](virtual-host/scripts/puppet/eyes.mjs)
- [`scripts/puppet/layers.mjs`](virtual-host/scripts/puppet/layers.mjs)
- [`scripts/puppet/ops.mjs`](virtual-host/scripts/puppet/ops.mjs)
- [`scripts/puppet/parts.mjs`](virtual-host/scripts/puppet/parts.mjs)
- [`scripts/puppet/png.mjs`](virtual-host/scripts/puppet/png.mjs)
- [`scripts/puppet/seg.mjs`](virtual-host/scripts/puppet/seg.mjs)
- [`scripts/puppet/segment.mjs`](virtual-host/scripts/puppet/segment.mjs)
- [`scripts/puppet/zip.mjs`](virtual-host/scripts/puppet/zip.mjs)
- [`scripts/puppet-build.mjs`](virtual-host/scripts/puppet-build.mjs)
- [`scripts/puppet-mask.mjs`](virtual-host/scripts/puppet-mask.mjs)
- [`scripts/visemes.mjs`](virtual-host/scripts/visemes.mjs)
