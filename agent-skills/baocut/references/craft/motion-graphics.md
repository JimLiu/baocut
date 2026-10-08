<!-- 由 tools/sync-agent-skill.ts 从 skills/motion-graphics/ 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 动效图形

> 要在视频上加一段动效图形时用：下横栏（姓名职务）、关键词字幕、大数字与图表、标注与引导、品牌贴片与片尾、倒计时与进度。不选模板，按规则写一个自包含的 HTML 画面（时间的纯函数），打包成代码包导入后放上时间线。只加静态文字、贴纸或已有的文字动画预设时不用；整条成片的规划看「从简报到成片」。

一段动效图形就是**一个按时间 seek 的纯函数画面**：给它第 t 秒，它画出第 t 秒该有的样子。不从模板库里挑，而是按本 skill 的规则把骨架的三个槽填上：结构（有哪些元素）、布局（放在哪）、动效（每个元素怎么进、停、出）。同一份槽换一行布局就是竖版，换三个颜色 token 就是另一套皮肤。顺序：

1. 定类别、时长、画幅与合成方式（第 1 节）。
2. 读骨架与一个最接近的范例（第 2 节）。
3. 按语法填三个槽：结构 → 布局 → 动效，再套时间包络与颜色（第 3 节）。
4. 自检：lint、抽帧、换长文案（第 4 节）。
5. 打包导入，放上时间线，对齐旁白（第 5 节）。
6. 验收（第 6 节）。

## 1. 定类别与时长

四类图形与它们的节奏；时长是目标，由旁白节点与可读性决定：

| 类别 | 用途 | 时长 | 要点 |
| --- | --- | --- | --- |
| 下横栏 | 姓名职务、来源、地点 | 3–4 s | 说话人开口后 0.5 s 内出现；左下或右下安全区 |
| 关键词 | 强调一句话里的一个词、一句口号 | 1.5–3 s | 跟旁白里那个词同时弹出；停留够读两遍 |
| 数据 | 一个数字、一条趋势、几项对比 | 3–5 s | 数字 count-up 1–1.6 s，结论句在数字之后 |
| 品牌贴片 | 标志进场、片尾、合作标识 | 2–3 s | 标志最后一个到位（lock），其余元素先就位 |

- **可读停留**：任何带文字的元素，入场结束到出场开始至少 1.2 s；一句话以上的文案 ≥ 2 s。
- **合成方式**：叠在视频上的图形用透明根（`alpha: true`），只画元素不画底；全画幅（片头、片尾、纯图形镜头）才给根上底色（`alpha: false`）。
- **画幅**：按视频的画幅写，16:9 用 1920×1080，9:16 用 1080×1920，1:1 用 1080×1080；帧率与视频一致（通常 30）。
- 画面里的事实（数字、姓名、引语）只用用户给的，不编；不用未经授权的商标与形象。

## 2. 骨架与范例

- 骨架：读本页的附录「骨架」，里面是完整可运行的单文件 HTML，三个槽用 `/* slot:layout */`（`<style>` 末尾的 CSS）、`<!-- slot:scene -->`（`<section id="scene">` 里的 HTML）、`/* slot:motion */`（`renderScene(time)` 里统一出场那行之后的代码）标出；其余部分（根元素属性、辅助函数、可 seek 的时间线、`window.__timelines`、`window.__GRAPHICS_QA__`）**原样保留**，不改。
- 范例在本 skill 的 `exemplars/<id>/16x9.html` 与 `9x16.html`（会话内按路径取；外部 Agent 的副本里没有这些文件，骨架加语法已经够写），每个只是填好槽的骨架，横竖两版只差布局槽：

| id | 类别 | 展示的动词 |
| --- | --- | --- |
| `lower-third` | 下横栏 | slide 错峰、backOut 弹出 |
| `big-number` | 数据 | count-up、scaleX sweep |
| `keyword-caption` | 关键词 | token 弹出换色、描线 |
| `callout-pin` | 标注 | pulse、path 描线、clip unfold |
| `logo-sting` | 品牌贴片 | 多块汇聚、lock、rise |

读一个最接近的范例就够，不必全读。范例的文案、颜色与布局数值都只是示例，按本次需求换。

## 3. 填三个槽

动词、角色词汇、位置族、安全区、幅度与颜色的完整表：读本页的附录「动效图形的语法」。填槽的顺序：

**结构槽**：先写元素清单，一个图形 2–6 个可动元素。每个元素一个角色（mark、headline、label、card、rail、node、badge、chip、note…），用 `id` 命名；主文案标 `data-copy-primary`、次文案标 `data-copy-secondary`，文字容器加 `class="copy"`。常用组合：`mark + headline + tagline`（品牌）、`name + role + org`（下横栏）、`value + unit + takeaway`（数据）、`label + track + state`（进度）、`headline + items[3–4] + active`（列表）、`anchor + line + label`（标注）。

**布局槽**：选一个位置族（lower-safe、centered、top-rail、side-rail、split、grid、cluster、radial、corner、full-frame-transparent），写绝对定位的像素值。安全区：16:9 左右 ≥ 70 px、上下 ≥ 100 px；9:16 左右 ≥ 60 px、上 ≥ 180 px、下 ≥ 230 px（避开评论与操作栏）。字号：说明 15–18 px，次级 20–24 px，主标题 42 px，大数字 68–80 px。文案容器一定要有 `max-width`，长文案靠省略号而不是溢出。竖版只改这一段：横向 grid 改纵向，卡片宽 ≈ 画布宽 − 2×边距，文字块顶对齐。

**动效槽**：每个元素一个时间窗 `range(time, start, end)` 配一个缓动与 1–2 个属性：位移配 easeOut，弹出配 backOut，描线与出场配 easeInOut。写法固定为 `prop: (1 - p) * 幅度`、`scale: 起点 + (1 - 起点) * p`、`opacity: p`。幅度：元素级位移 30–120 px，画外面板 340–560 px，rotate ≤ 25°，弹出的 scale 起点 0.2–0.45，容器 settle 的起点 0.75–0.95。同一元素不同时 slide 又 pop。

**时间包络**（默认 4 s，其他时长按比例缩放入场段，出场固定）：

| 项 | 规则 |
| --- | --- |
| 第一元素 | 0.02–0.05 s 起步，不从 0 开始 |
| 单元素窗口 | 0.5–0.8 s（描线 0.6–1.0 s，count-up 1.0–1.6 s） |
| 错峰 | 相邻元素起点相差 0.1–0.4 s；同类元素 stagger 0.1–0.3 s |
| 入场结束 | 最后一个入场在总时长一半之前结束（4 s 时 ≤ 2.2 s） |
| 停留 | 入场结束到出场开始 ≥ 1.2 s；停留期可以有 pulse（±2%）或连续计数 |
| 统一出场 | 骨架已写好：结束前 0.62 s 到 0.05 s，整个 `#scene` 用 easeInOut 淡出；不另写每个元素的出场 |

**颜色**：只用 `--ink`（深色、文字）、`--panel`（浅底）、`--accent`（强调）三个 token，半透明用 `color-mix(in srgb, var(--ink) N%, transparent)`。用户或成片的风格说明里有色板时按它填；没有时从 附录「动效图形的语法」 的调色里挑一组。字体只用骨架的系统字体栈，它覆盖中日韩与拉丁字符；不引外部字体。

## 4. 自检

写完先检查，再导入：

- **lint**：有命令行环境时跑 `node <skill 目录>/scripts/build-bundle.mjs --html <index.html> --out <目录> --lint-only`，它核对根元素属性、统一出场、停留时长、时间窗范围、无外链与无随机、三个 token、`.copy` 与 `data-copy-primary`；加 `--verify` 时用 Electron 实际 seek 五个时刻截图，检查确定性、透明根、文案在安全区内、换长文案后不溢出。没有命令行环境时按同一份规则自己对照一遍（规则列在 附录「动效图形的语法」 末尾）。
- **抽帧看**：导入后用 `baocut compositions preview` 在 0 s、入场结束、停留中点、结束前 0.3 s 各抽一帧看：元素都在安全区内、文字不溢出、停留帧上所有文字可读、末帧已淡出。
- **换文案**：`__GRAPHICS_QA__.setCopy('long')` 与 `setCopy('cjk')` 对应的情况要能放下：成片语言的真实文案长度和一句很长的备选都试一次。
- 不通过就改槽，不改骨架；改完重新 lint。

## 5. 导入与上时间线

- **打包**：有命令行环境时用 `build-bundle.mjs --html … --out … --bundle-id <图形名>-<画幅>`（不带 `--lint-only`；横竖两版要给不同的 bundle-id）产出 `<out>/1/`（目录名是 revision，不给 `--revision` 时为 `1`）：`index.html`、`bundle.manifest.json`、`files.manifest.json` 等，再把这个目录交给 `baocut compositions import`。没有命令行环境时直接把 `index.html` 以内联文件交给 `baocut compositions import`，由它计算哈希、写清单并做同样的校验。
- **导入即上时间线**：`baocut compositions import` 默认验证、烘焙，并把图形放到时间线上：从 0 s 开始、铺满画布、放在最上面的视觉轨（那条轨在这段时间被占着或锁着时新建一条）。它返回素材 id、尺寸、时长、是否透明，以及片段的 itemId 与 trackId。只想登记素材、先不放时，传 `register: true`。
- **对齐写在 `place` 上**：`place.at` 是时间线上的开始时间，`place.track` 指定轨道；导入时就给好，不必导入后再用 `baocut edits apply` 挪。开始时间对齐旁白里对应的节点：下横栏在说话人开口后 0.5 s 内；关键词与旁白里那个词同时；数据图形在旁白说到数字前 0.3 s 进。长度就是图形的时长，不拉伸。图形之间至少隔 0.5 s，不叠两个带文字的图形。
- **叠加层**与视频一起导出时不需要额外设置；全画幅图形当作一个镜头放。
- **改文案或改色**：改 HTML 里对应的槽，用新的 `--revision`（例如 `2`）重新打包，再用 `baocut compositions import` 导入并传 `replace: { itemId }`（上一版片段的 itemId）：片段原地换成新版本，位置、轨道、不透明度、名字都保留。不传 `replace` 会在时间线上再放一段，两版叠在一起。新版本更短时片段跟着变短；更长且撞上后面的片段时导入会报错，先挪开后面的片段再换。不在时间线上改。换完版本、确认不再回退之后，用 `baocut assets prune` 列出没有引用的素材，带 `apply: true` 和旧版代码包的 assetId 删掉它（它的预渲染替身一起删）；用户导入的素材不在此列。

## 6. 验收

- 对照用户要求：类别、文案、画幅、时长、位置、与旁白的对齐都按要求；事实只来自用户材料。
- 读回：`baocut videos inspect` 核对图形实例的起止时间与旁白节点的差值；抽帧看过的时刻写「看过」，没看的写没看。
- 报告分三栏：**量出来的**（时长、起止时刻、安全区边距）、**看过的**（抽过帧的时刻与看到的内容）、**要人看的**（动效快慢是否合适、颜色与成片是否搭）。lint 与 `--verify` 的结果原样附上，跳过的检查写明。

## 附录：动效图形的语法

三个槽各有一套词汇。这里的数值来自对大量叠加式动效图形的统计，是默认值，不是上限；用户的风格说明优先。

### 1. 动效动词（motion）

每个动词 = 1–2 个属性 + 一个缓动 + 一个时间窗。写法固定：`prop: (1 - p) * 幅度`、`scale: 起点 + (1 - 起点) * p`、`rotate: (1 - p) * 角度`、`opacity: p`，其中 `p` 是缓动后的进度。

| 动词 | 属性与写法 | 缓动 | 幅度 | 窗口 |
| --- | --- | --- | --- | --- |
| slide（滑入） | `x` 或 `y` 从幅度到 0，同步 `opacity` | easeOut | 元素 30–120 px；画外面板 340–560 px | 0.57–0.7 s |
| rise（升起） | `y` 从正值到 0 + `opacity` | easeOut | 32–100 px | 0.5–0.6 s |
| pop（弹出） | `scale` 从起点到 1，可叠 `rotate` | backOut | 起点 0.2–0.45；角度 −10°～−25° | 0.5–0.6 s |
| settle（落定） | 容器级 `scale` 从起点到 1 + `opacity` | easeOut | 起点 0.88–0.95 | 0.5–0.7 s |
| lock（锁定） | 最后入场的标志或核心：`scale` 0.2→1 叠小角度 rotate | backOut | 角度 ≤ 10° | 0.5–0.6 s |
| stagger（错峰） | 同类元素同一动词，起点递增 | 同元素 | 相邻 0.1–0.3 s | 3–4 个 |
| draw（描线） | `path(id, p)`，SVG 元素带 `data-length` | easeInOut | — | 0.6–1.0 s |
| unfold / reveal（展开） | `clip` 0→1，或 `scaleY` 0→1（transform-origin 顶部） | easeOut | — | 0.5–0.7 s |
| sweep / underline（扫过） | `scaleX` 0→1（transform-origin 左侧） | easeInOut | — | 0.5–0.8 s |
| count（计数） | `text(id, 格式化(目标 × p))`，位数固定、单位不动 | easeOut | — | 1.0–1.6 s |
| pulse（脉动） | 停留期内 `scale` 乘 `1 + 0.02 * Math.sin(range(time, a, b) * 2π)` | 线性 | ±2% | 一个周期 1.2–1.3 s |
| travel（移动） | `x` 线性插值，`y` 叠 `Math.sin(p * π) * 弧高` 走弧线；进度条上的元素用 `style(id, 'left', 'calc(…)')` 跟随 | easeInOut | 弧高 30–90 px | 0.8–1.2 s |
| highlight / active（高亮） | 当前项换 accent 色、描边或 `scale` 1.05，跟随 stagger 的当前索引 | — | — | 与 stagger 同步 |
| fade / crossfade（淡入淡出） | 只 `opacity` | easeInOut | — | 0.3–0.5 s |

规则：

- 一个元素一次入场只组合 1–2 个属性（`x + opacity`、`scale + rotate`），不同时 slide 又 pop。
- 位移配 easeOut，弹出配 backOut，描线、扫过与出场配 easeInOut。
- 出场由骨架统一处理（整个 `#scene` 淡出），不给单个元素写出场；需要某个元素先走时用 `1 - range(...)` 的 opacity。
- 需要随机感（粒子、散点）时用固定种子的伪随机（例如 mulberry32），不用 `Math.random`。

### 2. 时间包络

默认总时长 4 s，30 fps。

| 项 | 规则 |
| --- | --- |
| 第一元素起步 | 0.02–0.05 s |
| 单元素窗口 | 0.5–0.8 s（描线 0.6–1.0 s，count 1.0–1.6 s） |
| 错峰 | 相邻元素起点相差 0.1–0.4 s |
| 元素数 | 每个图形 2–6 个时间窗，列表类 3–4 项 |
| 入场结束 | 最后一个入场在总时长一半之前结束（4 s 时 ≤ 2.2 s） |
| 停留 | 入场结束到出场开始 ≥ 1.2 s；带整句文案 ≥ 2 s |
| 统一出场 | 结束前 0.62 s 到 0.05 s，easeInOut |

时长不是 4 s 时：出场固定贴末尾；入场段按 4 s 的比例缩放，但单窗口不短于 0.3 s、不长于 0.8 s；停留吃掉剩余时间。连续动效的图形（计数到结尾、走马灯）根元素加 `data-motion-continuous="true"`，停留检查改为人工看。

### 3. 结构角色（structure）

- 角色词：mark（标志、图标）、headline、label、card、rail（横条、轨道）、node（节点）、badge、chip、pill、note、divider、track（进度轨）、state（状态字）、anchor（锚点）、cursor、token（被强调的词）。
- 数量：一个图形 2–6 个可动元素；列表 3–4 项；对比 2 项。
- 文案：一条主文案 `data-copy-primary`、一条次文案 `data-copy-secondary`，其余是固定装饰字；文字容器加 `class="copy"`。
- 常用组合：

| 组合 | 用途 |
| --- | --- |
| mark + headline + tagline | 品牌贴片、片尾 |
| name + role + org | 下横栏 |
| value + unit + takeaway | 大数字 |
| label + track + state | 进度、倒计时 |
| headline + items[3–4] + active | 列表、步骤、要点 |
| anchor + line + label | 标注、引导 |
| quote + source | 引语 |
| kicker + headline + summary | 标题卡 |

### 4. 位置族与安全区（layout）

| 位置族 | 放哪 | 常见类别 |
| --- | --- | --- |
| lower-safe | 底部安全区内，左对齐或居中 | 下横栏、关键词字幕 |
| centered | 画面中央的卡片或大字 | 大数字、引语、标题 |
| top-rail | 顶部横条 | 新闻条、章节 |
| side-rail | 左侧或右侧竖列 | 列表、聊天流 |
| split | 左右或上下两栏 | 对比、价格 |
| grid / cluster | 几块卡片成组 | 多项指标 |
| radial | 中心一个、周围几个 | 功能环绕 |
| corner | 某个角 | 标志、徽章、水印 |
| full-frame-transparent | 整幅散布但中心留空 | 庆祝、粒子 |

安全区（元素的包围盒不得越过）：

| 画幅 | 左右 | 上 | 下 |
| --- | --- | --- | --- |
| 16:9（1920×1080） | ≥ 70 px | ≥ 100 px | ≥ 100 px |
| 9:16（1080×1920） | ≥ 60 px | ≥ 180 px | ≥ 230 px |
| 1:1（1080×1080） | ≥ 60 px | ≥ 100 px | ≥ 160 px |

字号：说明 15–18 px，次级 20–24 px，主标题 42 px，大数字与海报式标题 68–80 px。文案容器有 `max-width`、`overflow:hidden`、`text-overflow:ellipsis`。

竖版重排只改布局槽：横向 grid 改纵向（`1fr 320px` → `1fr / 1fr 190px`）、卡片宽 ≈ 画布宽 − 2×边距（9:16 约 920–960 px）、文字块 `left:0; right:0` 顶对齐、底部元素上移到下边距之上；结构槽与动效槽不动。

### 5. 颜色与皮肤

只用三个 token，定义在 `#root` 上：`--ink`（深色、文字）、`--panel`（浅底）、`--accent`（强调）。半透明用 `color-mix(in srgb, var(--ink) N%, transparent)`。

可直接用的调色：

| 名字 | `--accent` | `--ink` | `--panel` |
| --- | --- | --- | --- |
| 暖橙 | `#f0583a` | `#24221f` | `#f9f6ef` |
| 亮黄 | `#ffd43b` | `#1a1714` | `#fff8e6` |
| 青蓝 | `#2bc4ee` | `#0f2230` | `#eaf7ff` |
| 薄荷 | `#7fe0cf` | `#16212c` | `#f2fbff` |
| 草绿 | `#a6ef5e` | `#181612` | `#fdfcf3` |
| 珊瑚 | `#ff6252` | `#2a241e` | `#fff8e8` |

皮肤 = 调色 + 形态，形态参数写在布局槽里：

| 皮肤 | 圆角 | 阴影 | 字体 | 其他 |
| --- | --- | --- | --- | --- |
| clean（编辑感） | 16–18 px | 柔阴影或无 | 系统无衬线 | 细分割线、letter-spacing 0.04em |
| bold（海报感） | 28 px 以上或 0 | 无 | 粗体大字 68–80 px | 大色块 |
| glass（半透明） | 24–28 px | 柔阴影 | 系统无衬线 | 面板用 color-mix 70–85% |
| brutal（硬边） | 0–4 px | 硬阴影 `6px 6px 0 var(--ink)` | 粗体 | 2–3 px 实线描边 |
| tech（界面感） | 6–10 px | 无 | 等宽 `ui-monospace, Menlo, monospace` | 细线、角标、全大写小字 |
| sketch（手绘感） | 不规则（用 SVG 路径） | 无 | 系统无衬线 | 描线、轻微 rotate 1–3° |

### 6. 自检清单（与 lint 一致）

1. 根元素（`id="root"`）有 `data-composition-id="main"`、`data-start="0"`、`data-width`、`data-height`、`data-fps`、`data-duration`、`data-aspect-ratio`，以及三层描述 `data-structure`、`data-layout`、`data-motion`（英文短语）；`<meta name="viewport">` 的宽高与根元素一致。
2. `window.__timelines.main` 存在，`renderScene(time)` 是纯函数：画面只由 `time` 决定。
3. 统一出场那行在，结束前 0.62 s 开始、0.05 s 结束。
4. 所有 `range(time, a, b)`：a、b 只用数字、`DURATION` 与四则运算（否则 lint 只能给警告）；第一个 a ≥ 0.02；每个 0.2 ≤ b − a ≤ 2.0，且不越出 0–duration；最后一个入场的 b ≤ 出场开始 − 1.2（连续动效除外）。写在 `Math.sin(...)` / `Math.cos(...)` 参数里的 `range`（pulse 这类停留期动效）不算入场窗口。
5. 没有 `http://`、`https://`、`//` 开头的地址，没有 `<script src>`、`<link>`、`@import`、`fetch(`、`XMLHttpRequest`、`WebSocket`、`EventSource`、动态 `import(`。
6. 没有 `Date.now`、`performance.now`、`Math.random`、`new Date(`；`requestAnimationFrame` 只在时间线的 `play()` 里。
7. `#root` 定义了 `--ink`、`--panel`、`--accent`；透明图形的根没有底色。整个文件不超过 512 KB。
8. 至少一个 `data-copy-primary`；文字容器用 `.copy`。
9. 抽帧看：0 s、入场结束、停留中点、结束前 0.3 s；换长文案与中日韩文案后不溢出、仍在安全区内。

## 附录：骨架

动效图形的自包含 HTML 骨架，与 skill 目录里的 `scaffold.html` 逐字节一致。只填三个槽：布局槽 `/* slot:layout */`（`<style>` 末尾的 CSS）、结构槽 `<!-- slot:scene -->`（`<section id="scene">` 里的 HTML）、动效槽 `/* slot:motion */`（`renderScene(time)` 里统一出场那行之后的代码），并按需改 `#root` 的尺寸、三个颜色 token 与 `data-*` 属性；其余部分原样保留。槽里现有的 `demo` 内容只是占位，替换掉即可。

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920,height=1080">
<title>Motion graphic</title>
<style>
/* 骨架样式：不要改。画面相关的 CSS 全部写进下面的布局槽。 */
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif;-webkit-font-smoothing:antialiased}
*,*::before,*::after{box-sizing:border-box}
#root{position:relative;width:1920px;height:1080px;overflow:hidden;background:transparent;color:var(--ink);--ink:#17191e;--panel:#f7f4ed;--accent:#ff6b3d}
#scene{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.copy{max-width:100%;overflow:hidden;text-overflow:ellipsis}
svg{overflow:visible}
/* slot:layout */
.demo{position:absolute;left:120px;right:120px;bottom:140px;display:flex}
.demo-line{display:block;white-space:nowrap;padding:14px 28px;border-radius:18px;background:var(--panel);font-size:48px;font-weight:700}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="4" data-fps="30" data-aspect-ratio="16:9" data-structure="single headline placeholder" data-layout="lower-safe left aligned" data-motion="headline rises then holds">
<section id="scene">
<!-- slot:scene -->
<div class="demo"><p class="copy demo-line" id="demo-line" data-copy-primary>Replace this line</p></div>
</section>
</div>
<script>
(() => {
  'use strict';
  const root = document.getElementById('root');
  const scene = document.getElementById('scene');
  const COMPOSITION_ID = root.dataset.compositionId;
  const WIDTH = Number(root.dataset.width);
  const HEIGHT = Number(root.dataset.height);
  const DURATION = Number(root.dataset.duration);

  // ---- 辅助函数：全是纯函数或只改指定元素的样式，不读时钟、不随机 ----
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  // time 落在 [start, end] 里的进度，两端夹到 0 和 1。
  const range = (t, start, end) => (end <= start ? (t >= end ? 1 : 0) : clamp((t - start) / (end - start)));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const backOut = (p) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  };
  const node = (id) => document.getElementById(id);
  const style = (id, prop, value) => {
    const el = node(id);
    if (el) el.style.setProperty(prop, String(value));
  };
  const text = (id, value) => {
    const el = node(id);
    if (el && el.textContent !== String(value)) el.textContent = String(value);
  };
  // 一次写全 transform：没给的属性回到默认值，所以同一时刻重复调用结果相同。
  // preserveCenter 为真时保留 baocut translate(-50%,-50%)，用于以中心点定位的元素。
  const applyEl = (el, props = {}, preserveCenter = false) => {
    if (!el) return;
    const s = props.scale ?? 1;
    const parts = [];
    if (preserveCenter) parts.push('baocut translate(-50%, -50%)');
    parts.push(`baocut translate(${props.x ?? 0}px, ${props.y ?? 0}px)`);
    if (props.rotate) parts.push(`rotate(${props.rotate}deg)`);
    parts.push(`scale(${s * (props.scaleX ?? 1)}, ${s * (props.scaleY ?? 1)})`);
    el.style.transform = parts.join(' ');
    if (props.opacity !== undefined) el.style.opacity = String(clamp(props.opacity));
    // clip：0 全遮住，1 全露出，从左向右展开。
    if (props.clip !== undefined) el.style.clipPath = `inset(0 ${((1 - clamp(props.clip)) * 100).toFixed(3)}% 0 0)`;
  };
  const apply = (id, props, preserveCenter) => applyEl(node(id), props, preserveCenter);
  // 描线：按 data-length（不短于路径真实长度）设置虚线，progress 0 不可见，1 画满。
  const path = (id, progress) => {
    const el = node(id);
    if (!el) return;
    const len = Number(el.dataset.length) || 0;
    const p = clamp(progress);
    el.style.strokeDasharray = `${len} ${len}`;
    el.style.strokeDashoffset = String(len * (1 - p));
    el.style.visibility = p > 0 ? 'visible' : 'hidden';
  };

  // ---- 画面：只由 time 决定 ----
  function renderScene(time) {
    const exit = 1 - easeInOut(range(time, DURATION - 0.62, DURATION - 0.05)); scene.style.opacity = String(exit);
    /* slot:motion */
    const line = easeOut(range(time, 0.03, 0.6));
    apply('demo-line', { y: (1 - line) * 48, opacity: line });
  }

  // ---- 可 seek 的时间线：渲染与导出只用 seek()，play() 只给预览 ----
  class SeekableTimeline {
    constructor(duration, render) {
      this._duration = duration;
      this._render = render;
      this._time = 0;
      this._rate = 1;
      this._frame = 0;
      this._last = null;
    }
    duration() {
      return this._duration;
    }
    time() {
      return this._time;
    }
    seek(seconds) {
      this._time = clamp(Number(seconds) || 0, 0, this._duration);
      this._render(this._time);
      return this;
    }
    progress(p) {
      if (p === undefined) return this._duration > 0 ? this._time / this._duration : 0;
      return this.seek(clamp(Number(p) || 0) * this._duration);
    }
    timeScale(rate) {
      if (rate === undefined) return this._rate;
      this._rate = Math.max(0, Number(rate) || 0);
      return this;
    }
    pause() {
      if (this._frame) cancelAnimationFrame(this._frame);
      this._frame = 0;
      this._last = null;
      return this;
    }
    play() {
      if (this._frame) return this;
      // 用 rAF 回调给的时间戳推进，不读墙上时钟。
      const tick = (stamp) => {
        if (this._last !== null) this.seek(this._time + ((stamp - this._last) / 1000) * this._rate);
        this._last = stamp;
        if (this._time >= this._duration) {
          this.pause();
          return;
        }
        this._frame = requestAnimationFrame(tick);
      };
      this._frame = requestAnimationFrame(tick);
      return this;
    }
  }

  const timeline = new SeekableTimeline(DURATION, renderScene);
  window.__timelines = { [COMPOSITION_ID]: timeline };

  // ---- QA：外部检查用，不影响画面 ----
  const SAFE_DEFAULT = HEIGHT > WIDTH ? { left: 60, right: 60, top: 180, bottom: 230 } : { left: 70, right: 70, top: 100, bottom: 100 };
  // 停留期里的检查时刻：出场开始前 0.3 s（停留不短于 1.2 s，入场一定已经结束）。
  const HOLD_AT = DURATION - 0.92;
  const QA_COPY = {
    long: 'This replacement line is deliberately long so the check can prove the layout trims overflow instead of spilling outside the safe area',
    cjk: '这是一段刻意写长的替换文案，用来检查排版会不会溢出安全区；日本語の長い文章も混ぜて、省略記号まで確かめます',
  };
  const originals = new Map();
  const copies = () => Array.from(document.querySelectorAll('.copy, [data-copy-primary], [data-copy-secondary]'));
  const transparent = (el) => {
    const bg = getComputedStyle(el).backgroundColor;
    return bg === 'transparent' || /^rgba\(.*,\s*0\)$/.test(bg);
  };
  window.__GRAPHICS_QA__ = {
    holdAt: HOLD_AT,
    seek(seconds) {
      timeline.seek(seconds);
      return timeline.time();
    },
    // mode：'long' 长英文，'cjk' 中日混排长句，'original' 换回原文。
    setCopy(mode) {
      for (const el of document.querySelectorAll('[data-copy-primary]')) {
        if (!originals.has(el)) originals.set(el, el.innerHTML);
        if (mode === 'original') el.innerHTML = originals.get(el);
        else if (QA_COPY[mode]) el.textContent = QA_COPY[mode];
        else throw new Error(`unknown copy mode: ${mode}`);
      }
      timeline.seek(HOLD_AT);
      return HOLD_AT;
    },
    inspect(safe) {
      const s = { ...SAFE_DEFAULT, ...(safe || {}) };
      const base = root.getBoundingClientRect();
      const eps = 0.5;
      const boxes = copies()
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.id || el.className, left: r.left - base.left, top: r.top - base.top, right: r.right - base.left, bottom: r.bottom - base.top, w: r.width, h: r.height };
        })
        .filter((b) => b.w > 0 && b.h > 0);
      const within = (b, l, t, r, btm) => b.left >= l - eps && b.top >= t - eps && b.right <= r + eps && b.bottom <= btm + eps;
      const outsideRoot = boxes.filter((b) => !within(b, 0, 0, WIDTH, HEIGHT));
      const outsideSafe = boxes.filter((b) => !within(b, s.left, s.top, WIDTH - s.right, HEIGHT - s.bottom));
      return {
        copyCount: document.querySelectorAll('[data-copy-primary], [data-copy-secondary]').length,
        insideRoot: outsideRoot.length === 0,
        insideSafeArea: outsideSafe.length === 0,
        transparentRoot: [document.documentElement, document.body, root, scene].every(transparent),
        safe: s,
        outsideSafe: outsideSafe.map((b) => b.id),
      };
    },
  };

  timeline.seek(0);
  if (location.hash === '#play') timeline.play();
})();
</script>
</body>
</html>
```
