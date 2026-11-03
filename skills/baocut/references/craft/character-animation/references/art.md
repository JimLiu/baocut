<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/character-animation/references/art.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 出图与抠图

出图、写抠图清单时读。怎么调用图片生成、看能力、存文件见 `baocut-catalog-media`「生成图片」；这里只讲这种片子要什么样的图。

## 1. 先试一张

先出一张角色和一张底图，用户点头后再出全套：风格只有落到画面上才知道对不对。用户给了参考图且模型收输入图时（`referenceImages` 不为 null），先裁掉里面的标志再作为 `images` 给它。模型不收时全靠逐字复用同一段描述。

每张提示词的结尾都写：不要文字、字母、数字、标志与水印。

## 2. 要哪几种图

| 种类 | 什么时候用 | 提示词要点 |
| --- | --- | --- |
| 场景底图 `plate` | 每个地方一张 | 正对画面，地面开阔、占下面三分之一，没有人；牌子、屏幕、黑板全部空白。按画幅写明横竖 |
| 不带手臂的正面角色 `front` | 要指向、挥手、拿东西的角色 | 没有手臂和手，躯干两侧是平滑的圆形肩窝；从头到脚全身居中，四周留边 |
| 侧面固定姿势 `side` | 坐着、伏案。要代码画一只手臂时不带手臂；要握笔涂写时把手画出来并切开（`handBox`） | 严格的侧面，朝向写明 |
| 走路的角色 `walk` | 进出场景的人 | 严格的侧面朝右，手臂自然下垂；两条腿并拢垂直露在衣摆下面，脚放平，好把腿切开。要穿比腿宽的上衣或外套 |
| 固定姿势 `plain` / 群演 `row` | 不用动手的路人，一张图里几个并排 | 从背后、弯腰这类特殊姿势也画成这种 |
| 道具网格 `grid` | 一套物件 | 3×3，每格一个、互不重叠、不出格 |

角色、道具都画在纯色底上：默认绿 `#00B140`，写明「整张纯色、边到边，没有阴影、地面，主体上没有这个颜色」。主体要用绿色时换品红 `#FF00FF`。

## 3. 让模型照做

- 有的模型会无视「不带手臂」。出来带手臂时改用 `plain`，或换一个听话的模型，不要硬切。
- 同一角色的不同姿势逐字复用同一段外貌描述。不同模型一致性差很多，出完放在一起看。
- `agent:codex` 不收尺寸：在提示词里写横竖；一次任务一张。
- 底图要 2K 以上才经得起相机推近。小了用 `upscale` 放大（第一次要下载权重，先告诉用户）；用户说不用就直接用，清单里给 `width` 按 Lanczos 放大。

## 4. 清单

`art.json`（样例见 [`examples/mini-film/art.example.json`](../examples/mini-film/art.example.json)），路径相对清单所在目录：

| 字段 | 含义 |
| --- | --- |
| `out`、`data`、`proof` | 部件目录（默认 `shared/img`）、写出的 `rig-data.js`、核对图 `rig-proof.png` |
| `plates[]` | `name`、`file`；`board`：缺省找亮的空白牌子，`"dark"` 找黑板（取最大一块），`"none"` 没有牌子；`boards` 手写牌子（画面比例 0–1 的 `x, y, w, h`）；`width` 放大到这个宽；`fx, fy` 裁切焦点（底图与画幅比例不同时） |
| `sprites[]` | `kind`：`front`、`side`、`walk`、`plain`、`prop`、`grid`、`row`；`name` 或 `names`（`grid`、`row`）、`file` |
| 覆盖项 | `neck`、`shoulders`（`{ y, lx, rx }`）、`shoulder`（`{ x, y }`）、`hem`、`sleeve`、`trouser`、`facing`（`side`）、`handBox`（`side`，比例 `[x0, y0, x1, y1]`）、`rows`、`cols`（`grid`） |
| 抠图 | `key`（底色，缺省取边框中位色）、`dist`、`distEnclosed`、`dominance`；`bleed: true` 表示主体有意贴边；`keepFragments: true` 保留不相连的小块 |
| `meta` | 合并进这个部件的数据（如 `{ "hand_": "paw", "edge": false }`） |

```bash
node cutout.mjs art.json
node cutout.mjs art.json --only viewer,lab
```

## 5. 看核对图

每张图都要看 `rig-proof.png`：

- 红线在下巴与脖子之间。戴围巾、披长发时常常算错，在清单里写 `neck` 重跑。
- 蓝点在肩窝里。
- 黄点在两只眼睛上；找不到时（非点眼的风格）这个角色不眨眼，脚本会提示。
- 绿线在衣摆下沿。
- 边缘干净，没有绿边；身上没有被抠掉的洞。

脚本的警告都要处理：`touches the image edge`（被裁掉了，重画留边）、`dropped N piece(s)`（冒出来的字，看一眼）、`neck row looks wrong`、`no blank board measured`。

## 6. 不合适的时候

- 模型总画不出干净的纯色底：换模型，或把角色当整张卡片用，放弃手臂。
- 用户的片子要真实人物或品牌：用真实素材，别让模型仿画。
