<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/character-animation/ 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 角色动画

> 做角色演出来的动画片时用：每镜一个插画场景，角色走路、指向、拿东西、做反应，文字写在场景里的牌子和黑板上，科普、故事、历史、品牌小剧场都行。把生成的图抠成可动的部件，用代码绑定骨骼按旁白的字演出来。不用于：贴在实拍上的动效图形，图解为主没有角色的讲解片，只要一张插图。

一条人物动画由四样东西撑起来：**成套生成的图**、**抠好的部件**、**一个能按时间算出姿势的绑定**、**对到字上的时间**。这份做法只管这四样怎么做对；片子长什么样、讲什么、怎么讲，每期自己定，不套模板。

它是 `video-production` 的一种形态：简报、能力盘点、分镜、审片、烘焙、导出都按那份做法，这里只补角色动画特有的部分。动手前先读 `video-production` 第 1–3 节；旁白按 `narration`。

## 1. 每期定什么，什么不变

| 每期自己定（见 [风格与讲法：每期自己定的部分](character-animation/references/style-and-story.md)） | 不变的手艺（有现成代码） |
| --- | --- |
| 画风、色板、字体、角色比例，人、动物、机器人都行 | 只认连到边框的底色，抠图不漏进深色衣服（[`scripts/cutout.mjs`](character-animation/scripts/cutout.mjs)） |
| 画幅（16:9、9:16、1:1）、语言、时长 | 头、手、腿切开并补上缺口，转头不露缝 |
| 故事结构：钩子怎么开、讲几个地方、结尾怎么收 | 两段骨骼的手臂：肘部朝向自动选，切换姿势平滑（[`rig-kit/rig-kit.js`](character-animation/rig-kit/rig-kit.js)） |
| 换镜节奏、转场形状、运镜幅度 | 走路脚不打滑，眨眼、点头、呼吸 |
| 动作与反应的设计，埋梗与回收 | 文字逐字落在场景里的牌子上；每个剪点、牌子与手势都落在旁白的字上 |
| 音效配方与配乐 | 手臂、节奏、跳变的自动检查（[`scripts/rig-check.mjs`](character-animation/scripts/rig-check.mjs)、[`scripts/jump-scan.mjs`](character-animation/scripts/jump-scan.mjs)） |

同一系列连着几期，至少换掉左栏里的两三项。

## 2. 步骤

1. **定方向，先给用户看**：按 [风格与讲法：每期自己定的部分](character-animation/references/style-and-story.md) 写风格说明（含色板、字体与比例）、讲法与镜头表（每镜：场景、谁在做什么、落在哪个字、用哪些部件）。把稿子和镜头表给用户过目，再花钱花时间。用户说过「直接做」时不停，附在交付里。
2. **盘点能力**：`baocut models capabilities` 看图片生成与语音合成。要读文件、跑脚本的步骤需要命令行环境；没有时告诉用户这个形态做不了，改用 `video-production` 的其他画面来源。
3. **出图**：按 [出图与抠图](character-animation/references/art.md) 出一张试画的角色和一张场景底图，确认风格后再出全套。
4. **抠图**：写清单，跑 `cutout.mjs`，**看 `rig-proof.png`**：脖子红线、肩窝蓝点、眼睛黄点、衣摆绿线都对才往下走。
5. **配旁白、拿字时间**：按 [旁白、字时间与声音](character-animation/references/timing-and-sound.md)。先有旁白再写镜头代码，所有时刻都从字来。
6. **写场景**：拷 [`rig-kit/rig-kit.js`](character-animation/rig-kit/rig-kit.js) 与 `examples/mini-film/` 进工程，一个函数一镜。API 见 [绑定库 API](character-animation/references/rig.md)。先把开头两三镜做到成片水准给用户看（`video-production` 第 5 节「开头样段」）。
7. **自检**：按 [自检](character-animation/references/checks.md) 跑 `rig-check.mjs`，取接触表逐镜看。
8. **放上时间线给用户审**：`baocut compositions import` 带 `live: true`，旁白、配乐、音效放好，请用户在预览里看（`video-production` 第 6 节）。
9. **定稿**：用户说可以后不带 `live` 再导入一次走指令烘焙，导出时开响度标准化。导出后跑 `jump-scan.mjs`。

## 3. 容易错的地方

- **手臂**：指向用 `aim` 不写死坐标，手就不会举到脸旁或把手臂拉直；一只手要横穿身体才够得着目标时，换另一只手。
- **世界坐标的手**：角色跳起时，写 `x, y` 的手留在原地。只有手要碰场景里的东西（拉杆、桌子）才用它，其余用 `at` 或 `aim`。
- **重复的词**：`R.cue` 遇到说了不止一次的词会报错，给 `{ nth }` 指明第几次，剪点才不会落到别的句子上。
- **牌子上的字**：写在 `R.board()` 量出来的空白牌子上，不在画面上另浮一张卡。底图出图时就要留空白牌子。
- **字体**：指令烘焙只认 TTF、OTF。WOFF2 在浏览器里正常，烘焙时报 `font-parse`。
- **动态模糊**：`blur` 大于 1 会让指令烘焙崩溃，只能配 `bake: "pixels"`（约 7 帧/秒，比指令慢十倍以上）。默认不开；要顺滑先把帧率提到 60。
- **动作只看单帧看不出来**：手势前后两秒密集取帧，再按正常速度看一遍预览。
- **模型的差别**：`agent:codex` 不收尺寸、种子与参考图，一致性只能靠逐字复用同一段描述；图比画布小时用 `upscale` 放大（第一次要下载权重，先告诉用户）。

## 4. 交付

按说明书第 6 节写任务总结，并多报这几项：`rig-check.mjs` 与 `jump-scan.mjs` 的结果、是否走了 `drawop-cpu`、用了哪个图片与语音服务；哪些没听过（发音、音乐、音效平衡）；配乐的署名要求。

## 同目录的文件

在 `references/craft/character-animation/` 下，用到时再打开；代码与样例原样复制，按正文说的用法取用。

- [`examples/mini-film/art.example.json`](character-animation/examples/mini-film/art.example.json)
- [`examples/mini-film/index.html`](character-animation/examples/mini-film/index.html)
- [`examples/mini-film/scene.js`](character-animation/examples/mini-film/scene.js)
- [出图与抠图](character-animation/references/art.md)
- [自检](character-animation/references/checks.md)
- [绑定库 API](character-animation/references/rig.md)
- [风格与讲法：每期自己定的部分](character-animation/references/style-and-story.md)
- [旁白、字时间与声音](character-animation/references/timing-and-sound.md)
- [`rig-kit/rig-kit.js`](character-animation/rig-kit/rig-kit.js)
- [`scripts/cutout.mjs`](character-animation/scripts/cutout.mjs)
- [`scripts/jump-scan.mjs`](character-animation/scripts/jump-scan.mjs)
- [`scripts/place-sfx.mjs`](character-animation/scripts/place-sfx.mjs)
- [`scripts/rig-check.mjs`](character-animation/scripts/rig-check.mjs)
