<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/virtual-host/references/art.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 角色包：正面像、改图与打包

角色包是一张底图加一组局部补丁。补丁从「只改了嘴（或眼睛）的整张改图」里裁出来，所以每张改图必须和底图逐像素对齐：头的位置、大小、发型、衣服、颜色都不变。这一页给出能做到这点的提示词，以及 `host-pack.mjs` 怎么检查。

## 1. 正面像

一张、正面、半身、纯色底，后面所有改图都以它为输入。提示词写清这几件事（按这期的角色改人物与画风，别的照写）：

```text
A cartoon presenter character for <channel / topic>.
Character: <who: age, hair, glasses, clothes, colours>.
Style: clean flat 2D vector illustration, thick even dark outlines, soft cel shading, limited palette.
Head-and-shoulders, facing the camera straight on, head centered, eyes open looking at the viewer,
neutral relaxed expression, mouth gently closed.
Plain solid #00B140 green background, no shadow on the background, no text, no props.
Square 1024x1024. The face should take about 45% of the image height.
```

- 底色用饱和的纯色，角色身上不能有这个颜色（绿色衣服就换 `#0047FF` 蓝或 `#FF00B4` 品红）。
- 嘴闭着、表情放松：这张就是不说话时的样子（口型 X）。
- 画面下沿切在肩膀以下：主播贴着画面下沿放，切边藏在画外。
- 一次出两张给用户挑；不满意就改描述重出，形象定了再往下，改图之后再换形象要全部重画。

## 2. 改图

每张改图都以定下的正面像为输入（`image` 的 `images` 给它的 entryId；生成的图的 artifactId 就是 Space 的 entryId），尺寸与正面像相同，一次出一张。嘴的模板：

```text
Edit the attached character image. Change ONLY the mouth. Keep everything else pixel-identical:
same head position and size, same eyes, eyebrows, hair, glasses, clothes, colors, outlines, lighting and background.
Do not move, zoom, crop or re-draw anything outside the mouth area.
New mouth: <描述>. Draw it in exactly the same line weight and colors as the original.
```

眼睛的模板把 mouth 换成 eyes and eyebrows，`same eyes, eyebrows` 换成 `same mouth`，并加一句 `Keep the mouth closed as in the original.`，结尾写 `New eyes: <描述>`。

| 名字 | 组 | 描述（英文照写） | 用在 |
| --- | --- | --- | --- |
| `A` | mouth | lips pressed firmly together, as when saying "m" or "b" | b p m，闭唇 |
| `B` | mouth | teeth almost closed and visible, lips slightly parted and stretched sideways, as in "ee" or "s" | 大多数辅音、i |
| `C` | mouth | mouth medium open, relaxed, as in "eh" | e、轻读的 a |
| `D` | mouth | mouth wide open, jaw dropped, as in "ah" | a |
| `E` | mouth | lips rounded into a medium oval, as in "oh" | o |
| `F` | mouth | lips pushed forward into a small round pucker, as in "oo" | u ü w |
| `G` | mouth | upper teeth resting on the lower lip, as in "f" | f v |
| `half` | eyes | both eyes half closed, the upper eyelids lowered to cover the top half of each eye, as in the middle of a blink | 眨眼的中间帧 |
| `closed` | eyes | both eyes fully closed in a relaxed blink, drawn as gently curved closed eyelid lines | 眨眼 |
| `smile` | face | happy smiling eyes curved into gentle crescents, eyebrows relaxed and slightly raised（用眼睛的模板） | 表情 |

- 扁平画风里 D 常常没有下巴下沉、F 的嘴很小，看得清就能用；想要更明显就在描述里加 `clearly larger` 这类词重画。
- 表情放在 `face` 组，只改眼睛和眉毛；笑着说话时嘴照样换口型。表情要连嘴一起变（不说话时咧嘴笑），再画一张只改嘴的，放进 `mouth` 组，名字与表情相同（`mouth.smile`），不说话时用它。
- 表情、眼睛的改动区域不要碰到嘴的框，否则补丁互相盖住。
- 实测（GPT Image 2.6 Sunburst，扁平矢量）：10 张改图全部对齐在原位（位移 0、缩放 1），框外改动都在 1.5% 以内，接缝看不出。别的模型先试两三张，看 `proof.png` 再决定。

## 3. 打包

照 [`examples/host.example.json`](../examples/host.example.json) 写 `host.json`，图片路径相对这个文件：

| 字段 | 说明 |
| --- | --- |
| `base` | 正面像 |
| `variants` | `mouth`、`eyes`、`face` 三组，每组 `{名字: 图片}`；嘴的名字是大写的 A–G，再加和表情同名的嘴（`smile`）；眼睛是 `half`、`closed`；表情的名字自取，`faces.json` 里用同一个名字 |
| `key` | 底色：`auto`（取画面边上一圈的颜色，缺省）、`#rrggbb`，或 `false`（图已经是透明的） |
| `scale` | 输出缩放，缺省 1：按画面上要画多大定，比如 1024 的图画成约 450 像素高时写 0.5，画面不糊、包也小 |
| `boxes` | 可选。某组的补丁框 `[x, y, w, h]`（正面像的像素）；不给时从改动里自己找 |
| `feather` | 补丁边缘的羽化宽度（像素），缺省 8 |
| `out` | 输出目录，缺省 `pack` |
| `var`、`srcBase` | `host-data.js` 里的变量名（缺省 `HOST_PACK`）与图片路径前缀（缺省 `pack/`） |

`node host-pack.mjs host.json` 做这几步：用同一种底色把每张抠成透明；在 ±32 像素、0.97–1.03 倍的范围里把每张对齐到底图；找出和底图不同的区域，一组取一个共同的框（去掉面积大得离谱的那张）；框内的颜色按边缘一圈校正，羽化后存成补丁；底图裁到角色的外框。

终端先打印每组的框（`found from the changes` 是从改动里找的，`from host.json` 是 `boxes` 给的），再每张一行：`ok` 或 `FIX`，对齐的位移与缩放、框外改动的比例、颜色校正量；`FIX` 的下面一行是原因：

| 报告 | 意思与改法 |
| --- | --- |
| `no visible change` | 改图和底图一样：描述写得更具体再画 |
| `changed a much larger area than the other … images` | 这张改的范围比同组其他张大得多（脸、头发也重画了）：重画 |
| `… outside the … box changed too` | 框外超过 3% 的画面也变了：重画；只是框偏小（嘴张大时下巴动了）就在 `boxes` 里放大这组的框 |
| `colour around the box is off` | 改图整体偏色，按边缘校正不回来：重画 |
| `moved a lot against the portrait` | 模型重新构图了（缩放超过 2.5% 或位移超过 24 像素）：看 `proof.png`，接缝明显就重画，提示词强调 same head position and size |

`proof.png` 每格是底图贴上一个补丁的样子，绿框能用、红框重画；`proof.txt` 列出各格的名字。重画某一张后整包重跑：同一组的补丁共用一个框，框由这组所有改图一起定，所以不单独重做一张。
