<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/virtual-host/references/art.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 角色包：正面像、光头重绘、改图与打包

角色包是一张正面像拆成的层。拆层要知道头发下面、嘴张开、眼睛闭上是什么样，这些都来自「只改了一处」的整张改图：光头重绘只改头发，嘴的改图只改嘴，闭眼只改眼睛。所以每张改图都要和正面像逐像素对齐：头的位置、大小、发型、衣服、颜色都不变。这一页给出能做到这点的提示词，以及 `puppet-build.mjs` 怎么检查。

## 1. 正面像

一张、正面、半身、纯色底，后面所有改图都以它为输入。提示词写清这几件事（按这期的角色改人物，别的照写）：

```text
A cartoon presenter character for <channel / topic>.
Character: <who: age, hair, glasses, clothes, colours>.
Style: clean flat 2D vector illustration, thick even dark outlines, flat colours with at most one darker shade per colour, limited palette.
Head-and-shoulders, facing the camera straight on, head centered, eyes open looking at the viewer with the whites showing, eyebrows clearly visible,
neutral relaxed expression, mouth gently closed as one short line.
Plain solid #00B140 green background, no shadow on the background, no text, no props.
Square 1024x1024. The face should take about 45% of the image height.
```

- 底色用饱和的纯色，角色身上不能有这个颜色（绿色衣服就换 `#0047FF` 蓝或 `#FF00B4` 品红）。
- 平涂色块：脚本按颜色分出头发、皮肤、眼白、线条与衣服，厚涂、渐变、写实光影分不开。描边是一种深色，黑色、深棕都行。
- 眼睛睁开、露出眼白：眼睛靠「挨着皮肤的白色」找，眼珠在眼白里能转动。
- 嘴闭成一条线：这张就是不说话时的样子，脚本把眼睛和下巴之间的那条线当嘴。
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

| `character.json` 里 | 模板 | 描述（英文照写） | 用在 |
| --- | --- | --- | --- |
| `mouths.half` | 嘴 | barely open, as in "ee" or "s": the lips parted by a narrow gap that shows a thin strip of the upper teeth; about as wide as the original closed mouth, the opening about one fifth as tall as it is wide | 小声、大多数辅音、i |
| `mouths.open` | 嘴 | open in a relaxed "ah": the dark inside of the mouth with the upper teeth and the tongue showing; about as wide as the original closed mouth and about half as tall as it is wide | 响亮的 a、e |
| `mouths.round` | 嘴 | lips rounded into an oval, as in "oh": about two thirds as wide as the original closed mouth and about as tall as it is wide, dark inside | o u w |
| `mouths.wide` | 嘴 | upper teeth resting on the lower lip, as in "f" or "v": about as wide as the original closed mouth, the upper teeth showing above the lower lip | f v |
| `lids` | 眼睛 | both eyes fully closed in a relaxed blink: each eye becomes the single line of the lowered upper eyelid, curving gently downward like a shallow "u" where the lower half of the open eye was; not the upward "^" arcs of a laughing face | 眨眼 |
| `expressions.smile` | 嘴 | a gentle happy smile with the lips closed: a little wider than the original closed mouth, both corners curving up into a soft upward arc; no teeth showing | 表情 |

- `half` 与 `open` 必须有，`round`、`wide` 没有时用 `half` 或 `open` 代替（圆唇、咬唇就看不出来）。`open` 要比 `half` 张得开，打包时检查（`mouth ladder`）。
- 闭眼是放松地闭上：上眼皮落下来的一条往下弯的线。往上弯的「^ ^」是笑眯眼，用来眨眼像在突然发笑。没有 `lids` 时眨眼只把睁着的眼睛压扁。
- 表情只取眼睛下沿以下的改动（嘴、脸颊）：表情里照常眨眼、看向别处；说话时嘴照样换口型，表情的嘴只在不说话时出现。别的表情（惊讶、为难）照 `smile` 的写法换描述，名字自取，`faces.json` 里用同一个名字。
- 实测（GPT Image 2.6 Sunburst，扁平矢量，两个角色各 4 种嘴、闭眼、笑，加光头重绘，共 14 张）：全部对齐在原位（位移 0、缩放 1），没有一张要重画。别的模型先试两三张，打包看结果再决定。

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

`node puppet-build.mjs character.json` 抠掉底色，把每张改图对齐到正面像，拆出前后头发、脸、眉毛、两只眼睛与眼珠、嘴的几帧、表情、眼镜、身体，写出 `puppet/`：

- `<name>.bcpuppet`：角色包，导入它。`package/` 是同样的文件解开放着。
- `rest.png`：所有层静止时叠起来的样子；`rest-diff.png`：它和正面像差在哪里，越亮差得越多，几乎全黑才对。
- `report.json`：每项检查与每层的位置。加 `--debug` 时 `work/` 里另有中间结果。

终端每项检查一行，`ok` 或 `FIX`：

| 报告 | 意思与改法 |
| --- | --- |
| `portrait: 1024x1024, key …, skin …, line …, hair …, glasses` | 量到的底色、皮肤、描边、头发颜色，有没有眼镜。没戴眼镜却写着 `glasses`：`character.json` 写 `"glasses": false` |
| `FIX portrait: …` | 正面像不在能拆的范围，后面写着缺什么（皮肤色、头发、睁开的眼睛、闭着的嘴）：照第 1 节重画，或给 `skin`、`line`、`hair` |
| `bald repaint: …% of the character changed away from the hair` | 重绘改了头发以外的地方，超过 1% 时 `FIX`：用 `hair-mask.json` 做选区重画 |
| `<名> lines up: residual …, shift …, scale …` | 改图对齐到正面像后，要改的那块之外还差多少（0–255 的平均灰度差，6 以内算对上）。`FIX` 是模型把别处也重画了：重画那一张 |
| `closed eye L/R: … px` | 闭眼的改图在这只眼睛的位置画了多少。`FIX` 是这只眼睛没闭上：重画 `lids` |
| `mouth <名>: …x… px` | 这张嘴的宽和高。`FIX … drew no mouth` 是嘴的位置什么也没画：重画 |
| `mouth ladder` | `open` 要比 `half` 高，否则说话时看不出开合：重画开得不够的那张 |
| `expression <名>: …x… px patch` | 表情改动的范围。`FIX … changed nothing below the eyes`：重画 |
| `rest matches the portrait: … px off …, … px of them in patches …` | 静止时和正面像差得多的像素。沿着轮廓的一两像素细线是边缘重新抠图的误差，不算；成块的（3 像素以上厚）超过角色的 0.05%，或者全部加起来超过 1% 时 `FIX`：看 `rest-diff.png` 亮在哪里，多半是某张改图或光头重绘没对上，重画那张 |
| `package: … layers` | 角色包合规。`FIX` 时后面是不合规的地方，是脚本的问题，如实告诉用户 |

重画某一张后整个重跑，不单独补一层。全部 `ok` 后放上时间线，在预览里看转头、点头、眨眼和说话（SKILL.md 第 4 节）。
