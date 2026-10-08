# 动效图形的语法

三个槽各有一套词汇。这里的数值来自对大量叠加式动效图形的统计，是默认值，不是上限；用户的风格说明优先。

## 1. 动效动词（motion）

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

## 2. 时间包络

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

## 3. 结构角色（structure）

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

## 4. 位置族与安全区（layout）

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

## 5. 颜色与皮肤

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

## 6. 自检清单（与 lint 一致）

1. 根元素（`id="root"`）有 `data-composition-id="main"`、`data-start="0"`、`data-width`、`data-height`、`data-fps`、`data-duration`、`data-aspect-ratio`，以及三层描述 `data-structure`、`data-layout`、`data-motion`（英文短语）；`<meta name="viewport">` 的宽高与根元素一致。
2. `window.__timelines.main` 存在，`renderScene(time)` 是纯函数：画面只由 `time` 决定。
3. 统一出场那行在，结束前 0.62 s 开始、0.05 s 结束。
4. 所有 `range(time, a, b)`：a、b 只用数字、`DURATION` 与四则运算（否则 lint 只能给警告）；第一个 a ≥ 0.02；每个 0.2 ≤ b − a ≤ 2.0，且不越出 0–duration；最后一个入场的 b ≤ 出场开始 − 1.2（连续动效除外）。写在 `Math.sin(...)` / `Math.cos(...)` 参数里的 `range`（pulse 这类停留期动效）不算入场窗口。
5. 没有 `http://`、`https://`、`//` 开头的地址，没有 `<script src>`、`<link>`、`@import`、`fetch(`、`XMLHttpRequest`、`WebSocket`、`EventSource`、动态 `import(`。
6. 没有 `Date.now`、`performance.now`、`Math.random`、`new Date(`；`requestAnimationFrame` 只在时间线的 `play()` 里。
7. `#root` 定义了 `--ink`、`--panel`、`--accent`；透明图形的根没有底色。整个文件不超过 512 KB。
8. 至少一个 `data-copy-primary`；文字容器用 `.copy`。
9. 抽帧看：0 s、入场结束、停留中点、结束前 0.3 s；换长文案与中日韩文案后不溢出、仍在安全区内。
