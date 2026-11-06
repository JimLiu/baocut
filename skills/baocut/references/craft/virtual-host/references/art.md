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
neutral relaxed expression, mouth gently closed. The neck shows between the chin and the collar,
and the hair does not fall over the shoulders.
Plain solid #00B140 green background, no shadow on the background, no text, no props.
Square 1024x1024. The face should take about 45% of the image height.
```

- 底色用饱和的纯色，角色身上不能有这个颜色（绿色衣服就换 `#0047FF` 蓝或 `#FF00B4` 品红）。
- 嘴闭着、表情放松：这张就是不说话时的样子（口型 X）。
- 画面下沿切在肩膀以下：主播贴着画面下沿放，切边藏在画外。
- 脖子露出来、头发不搭在肩上：打包时从脖子处把头和身体分开，说话时只有头点、头转，身体不跟着晃（第 3 节）。
- 一次出两张给用户挑；不满意就改描述重出，形象定了再往下，改图之后再换形象要全部重画。

## 2. 改图

每张改图都以定下的正面像为输入（`image` 的 `images` 给它的 entryId；生成的图的 artifactId 就是 Space 的 entryId），尺寸与正面像相同，一次出一张。嘴的模板：

```text
Edit the attached character image. Change ONLY the mouth. Keep everything else pixel-identical:
same head position and size, same eyes, eyebrows, hair, glasses, clothes, colors, outlines, lighting and background.
Do not move, zoom, crop or re-draw anything outside the mouth area.
Keep the mouth centered on the same spot as the original closed mouth.
New mouth: <描述>. Draw it in exactly the same line weight and colors as the original.
```

眼睛的模板把 mouth 换成 eyes and eyebrows，`same eyes, eyebrows` 换成 `same mouth`，并加一句 `Keep the mouth closed as in the original.`，结尾写 `New eyes: <描述>`。

| 名字 | 组 | 描述（英文照写） | 用在 |
| --- | --- | --- | --- |
| `A` | mouth | lips pressed together in a flat closed line, as when saying "m" or "b"; the same width as the original closed mouth | b p m，闭唇 |
| `B` | mouth | mouth barely open, as in "ee" or "s": the lips parted by a narrow gap that shows a thin strip of the upper teeth; about as wide as the original closed mouth, the opening about one fifth as tall as it is wide | 大多数辅音、i、轻声的字 |
| `C` | mouth | mouth half open and relaxed, as in "eh": a soft opening about as wide as the original closed mouth and about half as tall as it is wide, dark inside with a hint of the upper teeth | e，音量中等的 a |
| `D` | mouth | mouth open wide, as in "ah": a little wider than the original closed mouth and about three quarters as tall as it is wide, dark inside with the tongue showing; a talking mouth, not a laugh or a shout | 响亮的 a |
| `E` | mouth | lips rounded into an open oval, as in "oh": the lips clearly drawn around a dark oval opening, about two thirds as wide as the original closed mouth and a little taller than it is wide; larger than the "oo" pucker, not a dark dot | o |
| `F` | mouth | lips pushed forward into a small round pucker, as in "oo": about half as wide as the original closed mouth, a small round opening with the lips clearly drawn around it; smaller than "oh" but not a dot | u ü w |
| `G` | mouth | upper teeth resting on the lower lip, as in "f" or "v": about as wide as the original closed mouth, the upper teeth showing above the lower lip | f v |
| `half` | eyes | both eyes half closed, as in the middle of a blink: the upper eyelids lowered to cover the top half of each iris, the lower half of the iris still showing; eyebrows unchanged | 眨眼的半闭帧 |
| `closed` | eyes | both eyes fully closed in a relaxed blink: each eye becomes the single line of the lowered upper eyelid, curving gently downward like a shallow "u" where the lower half of the open eye was; not the upward "^" arcs of a laughing face; eyebrows unchanged | 眨眼 |
| `smile` | face | a warm friendly look: the eyes stay open and look at the viewer with the same irises and pupils, the lower eyelids lifted slightly by smiling cheeks, eyebrows relaxed and raised a little（用眼睛的模板） | 表情 |

- 嘴要成梯度：B、C、D 一级比一级张得开，E 比 C 窄、F 比 E 小但不是一个点。说话时音量决定在同一类里取哪一档（轻声 B，中等 C，响亮 D），梯度断了（B 是咬紧的牙，D 是大笑）嘴就一跳一跳。`host-pack.mjs` 量每张嘴的大小，不成梯度的标出来（第 3 节）。
- 闭眼是放松地闭上：上眼皮落下来的一条往下弯的线。往上弯的「^ ^」是笑眯眼，用来眨眼像在突然发笑。
- 表情放在 `face` 组，只改眼睛和眉毛，眼睛要睁着：表情期间照常眨眼，眨眼的补丁盖在表情上。笑着说话时嘴照样换口型。表情要连嘴一起变（不说话时咧嘴笑），再画一张只改嘴的，放进 `mouth` 组，名字与表情相同（`mouth.smile`），不说话时用它。
- 表情、眼睛的改动区域不要碰到嘴的框，否则补丁互相盖住。
- 实测（GPT Image 2.6 Sunburst，扁平矢量）：两轮共 20 张改图全部对齐在原位（位移 0、缩放 1），框外改动都在 1.5% 以内，接缝看不出；E 有一次画成了一个黑点，照表里的描述重画一次就好。别的模型先试两三张，看 `proof.png` 再决定。

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
| `neck` | 可选。脖子的上沿、下沿 `[y1, y2]`（正面像的行）：上沿以上的头整块动，到下沿之间的脖子跟着弯；不给时自己找，`false` 表示不分头和身体 |
| `out` | 输出目录，缺省 `pack` |
| `var`、`srcBase` | `host-data.js` 里的变量名（缺省 `HOST_PACK`）与图片路径前缀（缺省 `pack/`） |

`node host-pack.mjs host.json` 做这几步：用同一种底色把每张抠成透明；在 ±32 像素、0.97–1.03 倍的范围里把每张对齐到底图；找出和底图不同的区域，一组取一个共同的框（去掉面积大得离谱的那张）；框内的颜色按边缘一圈校正，羽化后存成补丁；底图裁到角色的外框；再从脖子处把头和身体分开，存成 `head.png`、`body.png`。

找脖子的办法：从嘴往下看每一行角色有多宽，变窄的一段是脖子，宽度突然翻到 1.5 倍以上的那一行是肩膀。头是从嘴连到脖子的那一整块，身体是剩下的部分。找不到脖子、或者头发搭在肩上把头和肩膀连成一片时不分，整个角色一起动（说话时身体会跟着点头，看着不自然），终端会说明原因：重画正面像让脖子露出来，或者用 `neck` 直接给出脖子的两行。

终端先打印每组的框（`found from the changes` 是从改动里找的，`from host.json` 是 `boxes` 给的），再每张一行：`ok` 或 `FIX`，对齐的位移与缩放、框外改动的比例、颜色校正量；`FIX` 的下面一行是原因：

| 报告 | 意思与改法 |
| --- | --- |
| `no visible change` | 改图和底图一样：描述写得更具体再画 |
| `changed a much larger area than the other … images` | 这张改的范围比同组其他张大得多（脸、头发也重画了）：重画 |
| `… outside the … box changed too` | 框外超过 3% 的画面也变了：重画；只是框偏小（嘴张大时下巴动了）就在 `boxes` 里放大这组的框 |
| `colour around the box is off` | 改图整体偏色，按边缘校正不回来：重画 |
| `moved a lot against the portrait` | 模型重新构图了（缩放超过 2.5% 或位移超过 24 像素）：看 `proof.png`，接缝明显就重画，提示词强调 same head position and size |

接着是嘴的尺寸与头和身体的分法：

| 报告 | 意思与改法 |
| --- | --- |
| `mouth sizes (w x h px): A …` | 每张嘴张开部分的宽和高（改图的像素），用来看 A–G 是不是一级比一级开 |
| `size C opens barely more than B` / `D opens barely more than C` | 两级张得差不多，说话时看不出开合：照第 2 节的表重画开得不够的那张 |
| `size D opens …x as tall as C (a laugh …)` | D 张得太大，像在大笑：重画 D，强调 a talking mouth |
| `size E is as wide as D`、`F is not smaller than E`、`F is only …% as wide as D (a dot)`、`F is larger than C` | 圆嘴的大小不对：E 要比 D 窄，F 整体比 E 小又要看得见嘴唇；重画对应的那张 |
| `head/body split: the head moves above row …, the neck bends down to row …` | 分好了，数字是正面像的行 |
| `head/body: not split (…)` | 没分，括号里是原因（见上一段） |

尺寸提示不挡打包：模型不会照比例画，差一点能接受，差得多再重画。

`proof.png` 每格是底图贴上一个补丁的样子，绿框能用、红框重画；`proof.txt` 列出各格的名字。分了头和身体时多一格：头染成蓝色，是点头、转头时动的部分；黄线到红线之间是会弯的脖子。蓝色漏到肩上或者缺了一块头发，就用 `neck` 给出脖子的两行再跑。重画某一张后整包重跑：同一组的补丁共用一个框，框由这组所有改图一起定，所以不单独重做一张。
