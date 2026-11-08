<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/virtual-host/references/art.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 角色包：正面像、光头重绘、改图与打包

角色包是一张正面像拆成的层。拆层要知道头发下面、嘴张开、眼睛闭上是什么样，这些都来自「只改了一处」的整张改图：光头重绘只改头发，嘴的改图只改嘴，闭眼只改眼睛。所以每张改图都要和正面像逐像素对齐：头的位置、大小、发型、衣服、颜色都不变。这一页给出能做到这点的提示词，以及 `puppet-build.mjs` 怎么检查。

## 1. 正面像

一张、正面、半身、纯色底，后面所有改图都以它为输入。提示词写清这几件事（按这期的角色改人物，别的照写）：

```text
A cartoon presenter character for <channel / topic>.
Character: <who: age, hair, glasses, clothes, colours>.
Style: clean flat 2D vector illustration, thick even dark outlines, flat colours with at most one darker shade per colour, limited palette.
Head-and-shoulders, facing the camera straight on, head centered, eyes open looking at the viewer with the whites showing, eyebrows clearly visible, the bangs ending above them,
neutral relaxed expression, mouth gently closed as one short line.
Plain solid #00B140 green background, no shadow on the background, no text, no props.
Square 1024x1024. The face should take about 45% of the image height.
```

- 底色用饱和的纯色，角色身上不能有这个颜色（绿色衣服就换 `#0047FF` 蓝或 `#FF00B4` 品红）。
- 平涂色块：脚本按颜色分出头发、皮肤、眼白、线条与衣服，厚涂、渐变、写实光影分不开。描边是一种深色，黑色、深棕都行。
- 眼睛睁开、露出眼白：眼睛靠「挨着皮肤的白色」找，眼珠在眼白里能转动。
- 嘴闭成一条线：这张就是不说话时的样子，脚本把眼睛和下巴之间的那条线当嘴。
- 戴眼镜时，镜框用一种和描边分得开的颜色（深蓝、玳瑁、酒红）：脚本顺着这个颜色把镜框连同两端的铰链、铆钉一起拆进眼镜层，铰链伸进鬓角的头发里也算，转头时整副眼镜一起动。镜框和描边同色时只拆到镜框外沿，伸出去的镜腿留在脸上。眉毛可以搭在镜框上沿。
- 要有头发：头发拆成前后两层，转头、点头时跟着晃；光头角色还不支持。头发可以垂到下巴、盖住脖子两侧（试过齐下巴的短发）；长发盖住肩膀没试过。
- 画面下沿切在肩膀以下：主播贴着画面下沿放，切边藏在画外。
- 一次出两张给用户挑；不满意就改描述重出。形象定了再往下，改图之后再换形象要全部重画。

## 2. 头发遮罩与光头重绘

`node puppet-mask.mjs character.json` 用和打包一样的办法找出头发，往外扩 4 像素，写出 `hair-mask.json`（`{ "strokes": [...] }`，`baocut retouch` 的选区，不超过 500 笔）和 `hair-mask.png`。白色要正好盖住头发：带上了耳朵或脸的轮廓，重绘时它们也会被重画，打包时对不上。

`baocut retouch`：`op: "repaint"`，`files` 给正面像，`mask` 给 `hair-mask.json` 的内容，`prompt`：

```text
the same cartoon <man / woman>'s bald head with no hair at all. The top of the head is a smooth bare scalp in exactly the same flat skin colour as the face, with no shading and no texture. The skull outline is one continuous thick dark line of the same weight as the face outline: it continues the face outline up from the temples and goes round the top of a normal round head, a little inside where the hair was. Where the hair covered the ears, cheeks or neck, draw them plainly in the same skin colour and outlines. Everywhere the hair stuck out beyond the head becomes the same flat green background. No hair strands, no stubble, no hat
```

- 背景色照正面像的底色改（`green` 换成实际的颜色）。
- 重绘只动选区，选区外一个像素不变；打包时检查头发以外的地方变了多少（第 4 节 `bald repaint`）。
- 本机的改图模型很慢（一张二十分钟以上），装了 OpenAI 这类在线 Provider 时给 `provider` 与 `model`（要能改图：`baocut models capabilities` 的 `generateImage` 里 `referenceImages.edit` 为 true）。

## 3. 改图

每张改图都以定下的正面像为输入（`image` 的 `images` 给它的 entryId；生成的图的 artifactId 就是 Space 的 entryId），尺寸与正面像相同，一次出一张。嘴的模板：

```text
Edit the attached character image. Change ONLY the mouth. Keep everything else pixel-identical:
same head position and size, same eyes, eyebrows, hair, glasses, clothes, colors, outlines, lighting and background.
Do not move, zoom, crop or re-draw anything outside the mouth area.
Keep the mouth centered on the same spot as the original closed mouth.
New mouth: <描述>. Draw it in exactly the same line weight and colors as the original.
```

闭眼的模板把 mouth 换成 eyes：`Change ONLY the eyes`，`same eyes, eyebrows` 换成 `same eyebrows, mouth`，`outside the mouth area` 换成 `outside the eyes`，并加一句 `Keep the mouth closed as in the original.`，结尾写 `New eyes: <描述>. Draw them in …`。没戴眼镜时去掉 `glasses`。

整脸表情（眼睛、眉毛、脸颊、嘴一起变）的模板：

```text
Edit the attached character image. Change ONLY the facial expression: the eyes, eyebrows, mouth and the cheeks. Keep everything else pixel-identical:
same head position and size, same face outline, hair, ears, nose, glasses, clothes, colors, outlines, lighting and background.
The hair does not change, even where it meets the eyebrows. Do not move, zoom, crop or re-draw anything outside the eyes, eyebrows, mouth and cheeks.
Keep the eyes and the mouth centered on the same spots as in the original; the eyebrows may move down or tilt, but stay above the eyes and below the hairline.
New expression: <描述>. Draw it in exactly the same line weight and colors as the original.
```

| `character.json` 里 | 模板 | 描述（英文照写） | 用在 |
| --- | --- | --- | --- |
| `mouths.half` | 嘴 | barely open, as in "ee" or "s": the lips parted by a narrow gap that shows a thin strip of the upper teeth; about as wide as the original closed mouth, the opening about one fifth as tall as it is wide | 小声、大多数辅音、i |
| `mouths.open` | 嘴 | open in a relaxed "ah": the dark inside of the mouth with the upper teeth and the tongue showing; about as wide as the original closed mouth and about half as tall as it is wide | 响亮的 a、e |
| `mouths.round` | 嘴 | lips rounded into an oval, as in "oh": about two thirds as wide as the original closed mouth and about as tall as it is wide, dark inside | o u w |
| `mouths.wide` | 嘴 | upper teeth resting on the lower lip, as in "f" or "v": about as wide as the original closed mouth, the upper teeth showing above the lower lip | f v |
| `lids` | 眼睛 | both eyes fully closed in a relaxed blink: each eye becomes the single line of the lowered upper eyelid, curving gently downward like a shallow "u" where the lower half of the open eye was; not the upward "^" arcs of a laughing face | 眨眼 |
| `expressions.smile` | 嘴 | a gentle happy smile with the lips closed: a little wider than the original closed mouth, both corners curving up into a soft upward arc; no teeth showing | 表情 |
| `expressions.shy` | 整脸 | shy and bashful: a soft pink blush on both cheeks with three short diagonal pink lines on each, the eyebrows raised a little at their inner ends into a gentle worried slant, both eyes glancing down and to one side with the upper lids slightly lowered, the mouth a small closed wavy line a little narrower than the original | 表情 |
| `expressions.angry` | 整脸 | angry: the eyebrows pulled down hard toward the nose into a sharp V, both eyes narrowed with the upper lids lowered into a flat straight line across the top of the iris, the mouth a closed frown with both corners turned down | 表情 |
| `expressions.sad` | 整脸 | sad: the inner ends of the eyebrows raised and the outer ends lowered, the upper eyelids drooping a little, the eyes glossy with one extra small highlight each but no tears running, the mouth a small closed curve with the corners turned down | 表情 |

- `half` 与 `open` 必须有，`round`、`wide` 没有时用 `half` 或 `open` 代替（圆唇、咬唇就看不出来）。`open` 要比 `half` 张得开，打包时检查（`mouth ladder`）。
- 闭眼是放松地闭上：上眼皮落下来的一条往下弯的线。往上弯的「^ ^」是笑眯眼，用来眨眼像在突然发笑。没有 `lids` 时眨眼只把睁着的眼睛压扁。
- 表情取改图在脸上改了的地方（眼睛、眉毛、脸颊的红晕、嘴），合成一块补丁盖在眼睛和嘴上、刘海下面。改了眼睛的，表情画的眼睛切成单独的层，带着表情也照常眨眼（第 5 节 `eyes L R blink`）。改了眉毛的，中性的眉毛跟着淡出。说话时嘴照样换口型，表情的嘴只在不说话时出现。别的表情（惊讶、为难）照上面的写法换描述，名字自取，`faces.json` 里用同一个名字。
- 实测（GPT Image 2.6 Sunburst，扁平矢量，两个角色各 4 种嘴、闭眼、笑，加光头重绘，共 14 张；再各加害羞、生气、难过 6 张）：全部对齐在原位（位移 0 到 0.25、缩放 1），没有一张要重画。别的模型先试两三张，打包看结果再决定。

## 4. 打包

照 [`examples/character.example.json`](../examples/character.example.json) 写 `character.json`，图片路径相对这个文件：

| 字段 | 说明 |
| --- | --- |
| `name` | 角色名，输出 `<name>.bcpuppet` |
| `portrait` | 正面像 |
| `bald` | 光头重绘（第 2 节） |
| `mouths` | `{ half, open, round?, wide? }`（第 3 节） |
| `lids` | 闭眼（可选，强烈建议有） |
| `expressions` | 可选。`{ 名字: 改图 }`，名字是 1–64 个字母、数字、`_` 或 `-` |
| `out` | 输出目录，缺省 `puppet` |
| `skin`、`line`、`hair` | 可选。皮肤色、描边色 `[r, g, b]`，不给时从图里量；`hair` 给头发色，`null` 表示头发就是描边色（黑发） |
| `glasses` | 可选。`false` 时不找眼镜（没戴眼镜却报了 `glasses` 时写它） |
| `partmap` | 可选。分区图（第 5 节）。有它时按分区图拆层，`skin`、`line`、`hair`、`glasses` 不用 |
| `profile` | 可选。`{ "id": "anime_half", "facing": "front", "glasses": false }`；`id` 是 `anime_half`、`chibi`（Q 版大头）、`mascot`、`painterly`（厚涂），写进角色包 |
| `livliv` | 可选。有分区图时缺省出 `.livliv`，`false` 不出 |
| `meta` | 可选。写进 `.livliv` 的 `meta`，例如 `{ "author": "…" }` |

`node puppet-build.mjs character.json` 抠掉底色，把每张改图对齐到正面像，拆出前后头发、脸、眉毛、两只眼睛与眼珠、嘴的几帧、表情、眼镜、身体，写出 `puppet/`：

- `<name>.bcpuppet`：角色包，导入它。`package/` 是同样的文件解开放着。
- `rest.png`：所有层静止时叠起来的样子；`rest-diff.png`：它和正面像差在哪里，越亮差得越多，几乎全黑才对。
- `report.json`：每项检查与每层的位置。加 `--debug` 时 `work/` 里另有中间结果。

终端每项检查一行，`ok` 或 `FIX`：

| 报告 | 意思与改法 |
| --- | --- |
| `portrait: 1024x1024, key …, skin …, line …, hair …, glasses` | 量到的底色、皮肤、描边、头发颜色，有没有眼镜。没戴眼镜却写着 `glasses`：`character.json` 写 `"glasses": false` |
| `FIX portrait: …` | 正面像不在能拆的范围，后面写着缺什么（皮肤色、头发、睁开的眼睛、闭着的嘴）：照第 1 节重画，或给 `skin`、`line`、`hair` |
| `brows: L … / R … px, … on the bangs` | 两边眉毛各多少像素（只算眼睛上方的笔画，镜框和眼旁垂下的发绺不算），`on the bangs` 是画在刘海上的（头发是自己的颜色时，刘海里和发丝线条不相连的深色笔画）。这些眉毛单独成层、画在刘海上面，底下的刘海用旁边的头发补上。`FIX brows: brow … not found` 是这边的眉毛找不到（被刘海盖住，或和刘海一个颜色），表情动不了它：照第 1 节重画，让眉毛露在刘海下面，或者加 `partmap`（第 5 节） |
| `bald repaint: …% of the character changed away from the hair` | 重绘改了头发以外的地方，超过 1% 时 `FIX`：用 `hair-mask.json` 做选区重画 |
| `<名> lines up: residual …, shift …, scale …` | 改图对齐到正面像后，要改的那块之外还差多少（0–255 的平均灰度差，6 以内算对上）。`FIX` 是模型把别处也重画了：重画那一张 |
| `closed eye L/R: … px` | 闭眼的改图在这只眼睛的位置画了多少。`FIX` 是这只眼睛没闭上：重画 `lids` |
| `mouth <名>: …x… px` | 这张嘴的宽和高，只量盖在原来闭着的嘴上的笔画（嘴两边下巴的阴影不算）。`FIX … drew no mouth` 是嘴的位置什么也没画，`FIX … drew the mouth away from the closed mouth's spot` 是嘴画到了别处、没盖住原来的嘴：都重画 |
| `mouth ladder` | `open` 要比 `half` 高，否则说话时看不出开合：重画开得不够的那张 |
| `neck line: … px above the chin (…% of the face)` | 头与脖子相接的那一行（`anchors.neck_y`），转头、歪头绕它转，应在下巴上面一点。高过脸高的 20% 时 `FIX`：脖子没找对，多半是领口、围巾或头发贴着下巴，看一眼正面像，重画让下巴下面露出一段脖子 |
| `expression <名>: …x… px patch: …` | 表情补丁的大小和里面有什么（`eyes` 或一只眼、`brows`、`blush`、`mouth`）。少了描述里要改的那处（比如生气却没有 `brows`），是改图没画出来：重画。`FIX … changed nothing on the face`：重画 |
| `expression <名>: …; eyes L R blink (lid)` | 表情改了眼睛，它画的眼睛切成单独的层（`expr_eye_L` `expr_eye_R`），带着这个表情也照常眨眼，像中性的眼睛一样上睫毛往下滑；`(… squashed: no opening found)` 是有一只眼找不到开口（上睫毛与下眼线之间），两只眼都退回整只压扁，不用处理；`.livliv` 包不切，补丁保持完整。`eyes … drawn shut, kept in the patch` 是这只眼睛在改图里是闭着的（眯成一条线、^ ^），没有眼白可眨，留在补丁里，不用处理 |
| `expression <名>: …; brows L … / R … px, … of them on the bangs` | 改了眉毛的表情，改过的眉毛单独切出（`brow_tex`），和中性眉毛一样画在刘海上面，也画在眨眼合上的眼皮上面：挪到刘海上也看得见，压到眼睛上的眉头眨眼时也是完整的。`brows kept in the patch (none found)` 是眉毛附近没找到眉毛，眉毛留在表情补丁里；眉毛压在刘海上时会被刘海盖住，看一眼成品，眉毛不见了就重画表情 |
| `rest matches the portrait: … px off …, … px of them in patches …` | 静止时和正面像差得多的像素。沿着轮廓的一两像素细线是边缘重新抠图的误差，不算；成块的（3 像素以上厚）超过角色的 0.05%，或者全部加起来超过 1% 时 `FIX`：看 `rest-diff.png` 亮在哪里，多半是某张改图或光头重绘没对上，重画那张 |
| `package: … layers` | 角色包合规。`FIX` 时后面是不合规的地方，是脚本的问题，如实告诉用户 |

重画某一张后整个重跑，不单独补一层。全部 `ok` 后放上时间线，在预览里看转头、点头、眨眼和说话（SKILL.md 第 4 节）。

## 5. 分区图：柔和阴影、厚涂与 Q 版

平涂的脚本靠颜色分部位；柔和阴影的动漫、厚涂、Q 版的阴影和高光会把颜色混在一起。这时多出一张**分区图**：把正面像的每个部位涂成一种规定的纯色，脚本对齐到正面像后按它拆层，画风不限。

正面像照第 1 节写，`Style` 一行换成这期的画风，例如：

```text
Style: a polished soft anime illustration: smooth gradient shading and warm highlights on skin and hair, a gentle rosy warmth on the cheeks, large glossy eyes with a colour gradient in the iris and two small bright highlights, thin dark line art that varies in weight, soft light from the upper left.
```

构图写成半身（头顶上方到腰，头占上面约 40%）、竖幅 1024x1536，并写 `Nothing in front of the face or the neck; the bangs end at or above the eyebrows`：刘海盖住眼睛时眼睛拆不出来。Q 版写大头、头占上面一半；厚涂写自然比例、柔和笔触、不要硬描边。

分区图是一张改图（以正面像为输入），提示词：

```text
Turn the attached character image into a flat colour-coded segmentation map of its parts, for a puppet rig.
Keep every part exactly where it is, with exactly the same outline and size: same head position, same hair silhouette, every hair strand and bang tip in place. Do not move, zoom, crop, simplify or redraw the shapes. Only replace the colours.
Paint each part in one flat solid colour, with no shading, no gradients, no outlines, no texture, no anti-aliasing halos:
- the bangs and all the hair on top of the head and in front of the forehead: pure red #FF0000
- the locks of hair hanging down beside the face and in front of the shoulders: pure magenta #FF00FF
- the hair behind the head, the neck and the shoulders (the back of the hair): pure blue #0000FF
- face skin and nose: pure yellow #FFFF00
- the ears: pink #FF80C0
- the neck and any other bare skin below the chin: orange #FF8000
- eyebrows: purple #8000FF, the whole eyebrow even where a strand of hair crosses it
- the whites of the eyes: pure white #FFFFFF
- irises and pupils, highlights included: cyan #00FFFF
- eyelashes and the dark upper and lower eye lines: pure black #000000
- the lips and the mouth line: dark red #800000
- all clothing (every garment, collar and button) and any accessory: mid grey #808080
- the background stays the same plain green #00B140.
The outlines of the drawing belong to the part they surround; draw no lines between parts.
```

- 背景色照正面像的底色改。画成别的绿（比如照抄 `#00B140`）也行：脚本从分区图四边量它自己的底色，什么是背景只看正面像。部位颜色画得不准（暗红画成偏橙）没关系，脚本按图里实际的颜色找最近的那种。
- 有了 `partmap` 再跑 `puppet-mask.mjs`：头发的选区按分区图的红、品红、蓝三块取。光头重绘的提示词把第 2 节的 `cartoon … flat skin colour … no shading` 换成 `the same character's head … in the same drawing style … the same skin colour and the same soft shading as the face`，并加一句头发盖住的肩膀、衣服照原样画出来。
- 嘴、闭眼、表情照第 3 节，`KEEP` 里加 `soft shading`；表情照第 3 节的整脸模板（`smile` 也用整脸），另可加 `surprised`（惊讶）。
- 实测（GPT Image 2.6 Sunburst，柔和阴影的动漫半身像，正面像、分区图、光头重绘、嘴 4、闭眼、表情 5，共 13 张）：一遍全部 `ok`。

`puppet-build.mjs` 看到 `partmap` 就按它拆，多出这几行检查：

| 报告 | 意思与改法 |
| --- | --- |
| `part map: shift …, scale …, residual …, …% of the character in no palette colour` | 分区图对齐到正面像的位移、缩放，和角色身上（正面像抠出的范围，底色不算）有多少像素不像任何一种规定色。位移大、缩放不是 1，或超过 2% 时 `FIX`：重出分区图 |
| `parts: eyes …, brows …, mouth … px wide, … px of brow under the hair, … over strands the map painted across it, … on the bangs, … px of skin between the strands over the brows` | 分区图里找到的眼睛、眉毛、嘴。`FIX part map: no face`、`FIX mouth: the map has no mouth` 是分区图没涂出脸或嘴：重出分区图。`under the hair` 是分区图涂成眉毛、原图里却是发丝盖在上面的像素，归头发；`over strands the map painted across it` 反过来，是分区图涂成发丝、原图里眉毛画在发丝上面的像素，归眉毛。`on the bangs` 是压在刘海上的眉毛像素，这些眉毛单独成层、画在刘海上面。`skin between the strands over the brows` 是眉毛上方两缕发丝之间露出的额头，被眉毛隔开、不和脸连在一起，仍算脸，不跟着头发动 |
| `expression <名>: …; eyes L R blink (lid)` | 表情改了眼睛，它画的眼睛切成单独的层（`expr_eye_L` `expr_eye_R`），带着这个表情也照常眨眼，像中性的眼睛一样上睫毛往下滑；`(… squashed: no opening found)` 是有一只眼找不到开口（上睫毛与下眼线之间），两只眼都退回整只压扁，不用处理；`.livliv` 包不切，补丁保持完整。`eyes … drawn shut, kept in the patch` 是这只眼睛在改图里是闭着的（眯成一条线、^ ^），没有眼白可眨，留在补丁里，不用处理 |
| `expression <名>: …; brows L … / R … px, … of them on the bangs` | 表情改过的眉毛单独切出（`brow_tex`），和中性眉毛一样画在刘海上面，也画在眨眼合上的眼皮上面。`brows kept in the patch (none found)` 是眉毛附近没找到眉毛，眉毛留在表情补丁里；眉毛压在刘海上时会被刘海盖住，看一眼成品，眉毛不见了就重画表情 |
| `bald repaint: …% of the scalp under the hair still looks like hair` | 光头重绘在头发底下还留着头发，超过 8% 时 `FIX`：重画。沿光头外缘往里约一条描边宽（按正面像的描边量）是第 2 节要的头骨轮廓线，不算头发，所以寸头这种薄薄一层头发也不会误报 |
| `neck line` | 同第 4 节。`FIX …: redo the map` 是分区图的脖子（橙色）从下巴下面一直连到了脸里：重出分区图，橙色只涂下巴以下。和脖子不相连的零星橙点（红刘海和黄脸交界处混出来的）不用管，按旁边的部位算 |
| `rest matches the portrait` | 同第 4 节 |

成品除了 `<name>.bcpuppet`，还有 `<name>.livliv`（LivLiv v4 角色包，`livliv/` 是解开的文件，带 `cover.png` 与 `avatar.png`）。两份是同一套层：LivLiv 播放器能开，就说明拆层是完整的。
