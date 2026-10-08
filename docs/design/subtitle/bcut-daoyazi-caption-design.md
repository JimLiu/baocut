> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# BaoCut「倒鸭子」字幕样式设计方案（审查修订版）

状态：**核心（阶段 A）与 App v2（阶段 B 的原生渲染 + 画廊卡 + 首发面板）已于 2026-09-17 落地**（core `bcut-subtitle-render/src/caption_sequence.rs`、描述符 `caption-daoyazi`、App 画廊「动态排版」组与属性页「倒鸭子」段；差异与未做项见台账 [2026-09-17-214000](../../changelog/prototype-ledger/2026-09-17-214000.md)），Web 未实现；交互原型已接进编辑器原型 `designs/baocut`（2026-09-17）；同日第二轮按 TypeMonkey（AE 脚本，倒鸭子这一族的源头）的 MonkeyCam 校准了相机、入场、排版走向与段间续接（§0 R2 / R6 / R8、§7.2、§8.3–§8.6）；**2026-09-18 第三轮对着 typeMonkey.js（网页移植，这一族里最还原的一份）重做了排版与取景**：行是最小单位、行在段里左对齐往下叠、段与段在上一行的左下 / 右下角 90° 枢转、镜头把当前行归一到同一屏宽、行从 0.3 倍以左中为原点弹入、停走档与弹入用 CSS `ease`（§0 R16、§6.3、§7.2、§8.2、§8.3、§8.5），原型与内核同步落地。本文是对 2026-09-17 原提案（`baocut-daoyazi-subtitle-design.md`，基线 `f22da874`）的**审查修订版**：§0 列出审查发现与改法，§1 起是吸收修订后的完整方案，可直接作为实施依据。字段、模块、能力名与默认参数仍待开发与验收。

代码核对基线：`main@17e329814`（2026-09-17）。本次只读代码、未运行构建。示例载荷在 [`bcut-daoyazi-caption-style.example.json`](bcut-daoyazi-caption-style.example.json)；交互原型集成在 [`designs/baocut/BaoCut.html`](../../../designs/baocut/BaoCut.html) 的「字幕 → 样式 → 动态排版」分区（画廊卡、属性页「倒鸭子」段、舞台 canvas；产品行为见 [product-design §16.5](../product/product-design/16.md#165-倒鸭子动态排版样式2026-09-17)）：求解器与相机采样的参考实现在 [`designs/baocut/app/model-daoyazi.js`](../../../designs/baocut/app/model-daoyazi.js)，`node --test` 用例在 [`model-daoyazi.test.js`](../../../designs/baocut/app/model-daoyazi.test.js)，舞台与面板视图在 [`daoyazi-stage.jsx`](../../../designs/baocut/app/daoyazi-stage.jsx) / [`panel-daoyazi.jsx`](../../../designs/baocut/app/panel-daoyazi.jsx)。

## 0. 审查结论

原提案的方向正确：倒鸭子是**跨句编排型 Designed Caption**，进 Rust 共享字幕内核，不复制文字与时序，不引入第二个动画运行时。下面按影响从大到小列出需要修订的地方；每条给出原提案怎么写、问题是什么、修订成什么。§1 之后的正文已按修订写。

| # | 主题 | 原提案 | 问题 | 修订 |
|---|---|---|---|---|
| R1 | 首发格式范围 | §5 一次定下 `captionSequences`、实例级 `caption` 替换、`blocks` 固定布局、`emphasisOverrides`、style `0.2`、caption schema 2、协议 capability | 把阶段 C/D 才需要的持久化提前写死，首发要跨 kernel / protocol / TS 生成 / 校验五层；style 文件升到 0.2 会让**整个项目**在旧版本里不可读，只为一个字幕样式 | 首发只写 `wordAnimation.caption`（schema 1 不变）新增 `seed` 与 `options.daoyazi`；现有代码已保留未知 `options` 往返 [R5]。`captionSequences` 推迟到阶段 C，独立 schema，读取器按「缺失即无」处理。能力门放在**配方描述符**的 `execution` 字段，不靠文件版本号（§5.1、§5.6） |
| R2 | 镜头时机 | §8.4「在新焦点对应的发言开始时启动镜头」 | 新块前 320 ms 有一半在画外，读者损失每个块的开头；这与「当前块必须完整可见」矛盾。原型第一版用 320 ms 短跳 + 提前量修正后仍不顺：每块一次「急停—停住—急跳」，和 TypeMonkey 的 Stop and Go Fast 档一样生硬 | 相机运动分两档（§8.4）：**平滑**（默认，MonkeyCam Smooth）——镜头在相邻焦点的整段间隔里飞，`[onset − travel, onset]`，到达即开口，`travel = clamp((1 − dwell) × 间隔, minTravel, maxTravel / speed)`；**停走**（MonkeyCam Stop and Go）——`[onset − lead, onset − lead + travel]`，`lead = anticipation × travel`。两档文字都在 `onset − pre` 才开始入场，镜头飞向的是空位，不暴露未来文字 |
| R3 | 逐词入场 | 阶段 D「可选逐词入场」 | 逐词出现是倒鸭子的身份特征，而且块的排版在编译期已完整求解，逐词只是可见性，零重排成本；放到阶段 D 会让首发看起来像「会转的整句字幕」 | `reveal: "word"` 是首发默认；只有句时间（SRT）或译文驱动时降级为 `"block"`（§8.5） |
| R4 | 视口裁剪 | §2.2 / §9.4 要求新增通用 `ClipRectGroup` 贯通 CPU / GPU / BCS / Web 才能提供「下方 / 局部区域」 | 核对 `scene.rs`：`GlyphRunUniform.clip` 已是「施加 run transform 之前的画布坐标裁剪矩形」，跟随 pose 运动且只改 uniform [R7]。倒鸭子叠加模式没有每块底板，纯色底就是视口矩形本身，固定译文在视口外走普通路径——首发不需要新的 scene 指令 | 首发用 run clip；`ClipRectGroup` 留到出现每块底板 / 阴影 blur 溢出视口时再加（§9.4） |
| R5 | 强调词的视觉映射 | 只说复用 normal / emphasis / hero 三档 | 没定义三档在这个样式里长什么样，也没说哪一档影响排版 | `emphasis` = 换色不重排；`hero` = 独立视觉块 + 1.5× 字号 + 第二强调色，进 shaping / 布局指纹（§6.4） |
| R6 | 布局求解 | §7.2 评分公式 `a…e` 未定候选集、权重与平局规则 | 无法落成确定性实现；也没有防「折回已看过区域」的项，世界会缠成一团 | 固定候选集（4 边 × 3 对齐 × 允许角度）、固定权重初值、平局取索引最小、**顺着走加分**（TypeMonkey：不转的词往下叠、转 90° 的往左叠）与回折惩罚、转向节流；正交排版下碰撞退化为 AABB（§7.2） |
| R7 | 确定性 | §7.3「stableHash」「随机算法版本化」 | 没指定 hash / RNG，也没说浮点如何跨 native / wasm 一致 | FNV-1a 64 + SplitMix64，整数域抽样；世界坐标量化到 1/64 参考单位；角度只取 {0, 90, 180, 270}，编译期不用三角函数（§7.3） |
| R8 | 段间过渡 | 未定义 | 段尾「停住」之后下一段怎么开始没说，实现会各自发明；原型第一版按「硬切 + 200 ms 淡出」做，演示项目几乎每句一段，看起来就是每句闪一下 | 段不是切点：每段世界接在上一段世界旁边（同一张画布，顺着上一段最后的走向、隔约 0.6 个视口、与所有既有世界不重叠），镜头从上一段末姿态**飞过去**，到达后上一段在 `fadeMs`（默认 200）内淡出；淡出块计入节点预算（§8.6） |
| R9 | zoom 边界 | 「对 zoom 设正值下限和上限」 | 抽象数值无法调参 | 用可读性表达：当前块正文屏幕字号在参考画布高的 3.2%–20% 之间、单块高 ≤ 视口高 85%，由此反推 zoom 区间（§8.2） |
| R10 | 竖屏画幅 | 视口固定 `{0.06, 0.08, 0.88, 0.72}` | 9:16 与 1:1 下 fit / 折行 / 密度都不同；现有配方已有 `layoutTokens.wide / square / vertical` 机制 [R3] | 视口与密度按画幅档取 `layoutTokens`，用户覆盖只写差值（§5.3） |
| R11 | 属性面板首发 | 面板顶部就是「应用范围：整轨 / 当前动画段 / 当前选区」+「固定这一段版式」 | 这些依赖阶段 C 的实例记录；首发画出来就是空控件 | 首发面板 = 动感、配色、换一版（整轨）、「镜头与排版」折叠区；作用域与固定版式随阶段 C 出现（§3.3） |
| R12 | 注册表落点 | 「在既有字幕资源注册表中增加 `caption-daoyazi-v1`」 | 注册表有两处：core 的 `CAPTION_RECIPE_FILES`（编译期内嵌，渲染契约）与 App 的 `assets/captions/registry.json`（画廊），Web 另有副本；只加画廊会陈列一个渲染不了的样式 | 三处同一任务加；带 `execution` 的描述符在不支持的客户端里**不陈列**、已保存的项目显示为普通字幕并报诊断（§5.2） |
| R13 | `seed` 的现状 | 「保留已有 seed 语义」 | 当前 `caption_registry::payload` 只写 schema / content / palette / intensity / speed / style，`seed` 不存在；描述符只有 `seeded` 布尔标记 [R5] | `seed` 是本方案**新增**字段，默认由文档 revision 派生一次后落盘；换配方保留（§5.3） |
| R14 | 段长预算 | 「8 个 cue、12 秒」 | 只按 cue 数会让长 cue 段过重、短 cue 段过碎 | 三个预算取先到者：12 s、16 行（2026-09-18 起块 = 行，此前 10 个视觉块）、48 个词；行数是主预算（§6.2） |
| R16 | 排版与取景的形状（2026-09-18） | §7.2 候选评分求解、§8.2 整块取景 | 对着 typeMonkey.js 校对：它的行（`tm-row`）是最小单位、行在段（`tm-block`）里左对齐往下叠、段与段在上一行的一个下角 90° 枢转（`rotate: 'lb' | 'rb'`）、镜头把**当前行**放成同一屏宽（`scale = conWidth / rowWidth`，最短两个字宽）。候选评分求出来的世界像地砖，块内折行 + 整块取景又让每块屏幕字号忽大忽小，都不是倒鸭子的样子 | 行是块：不折行、词左对齐、取景宽 = max(文字宽, 2 em)、行高 1.2；列式排版：顺着当前段往下叠，转向 = 绕上一行的左下 / 右下角枢转 ±90°，撞到已有行就换边或跳到世界外另起一段；逐行取景：`zoom = 视口宽 × fit / 行取景宽`，屏幕字号上限抬到 30%；弹入从 0.3 倍、原点左中、CSS `ease`；停走档相机也用 CSS `ease`；历史按行留 8 行、50%（§6.3、§7.2、§8.2、§8.3、§8.5） |
| R15 | 舞台拾取 | 「点击文字只选择对应字幕」 | 历史块也在画面上，点到历史块选谁没说 | 只有当前块与历史块的**可见词**可拾取，拾取用逆相机矩阵；历史块点击 = 选中该 cue 并 seek 到它的 onset（§3.4） |

保留不变的核心决策（§1）：不嵌 HTML / FFCreator / 第二播放器；不新增 ElementKind；`CaptionSequencePlan` 复用 `MotionProgram`；文本与时序只读投影；三表面共享编译结果。

## 1. 核心决策

把倒鸭子做成一种**跨句编排型 Designed Caption**。用户仍从「字幕 → 样式」选择它，仍编辑原来的字幕、时间和强调词；内部新增一个能同时考虑多条字幕的编译计划，而不是给每条字幕分别叠旋转特效。

画面模型：若干文字块放在一个持续存在的二维世界里，词随发言逐个出现，相机随发言在块之间平移、旋转、缩放；当前块保持可读，旧块留在空间中成为背景。相机只作用于字幕世界，不作用于主视频、贴纸、画中画、水印或另一条固定字幕轨。

1. **不嵌入 HTML、FFCreator 或第二个视频播放器。** 原型（`designs/baocut` 里的倒鸭子卡与 `app/model-daoyazi.js`）是视觉与交互参考，也是求解器的可执行说明；生产实现进入 `bcut-subtitle-render`。
2. **不新增 `ElementKind`、字幕媒体类型或持久化的逐帧关键帧文件。** 它是字幕的表现方式。
3. **新增 `CaptionSequencePlan`，复用 `MotionProgram`。** 前者负责跨句排版、焦点和生命周期；后者仍是曲线与采样的唯一内核。
4. **文本与时序只读 Transcript / Timeline 投影。** 保存的是样式、种子与（阶段 C 起）人工约束。
5. **App、Web、CLI 导出共享同一份编译结果和采样规则。** UI 只产生编辑意图。
6. **分阶段落盘。** 首发只动 `wordAnimation.caption`；实例记录、固定布局、实例强调是阶段 C 的独立 schema（R1）。

## 2. 当前工程已经具备什么

| 现有入口 | 已核实的能力 | 本次使用方式 |
|---|---|---|
| `bcut-subtitle-render` | 共用字幕排版、逐词状态、Designed Caption、`OverlayRenderPlan`、CPU/GPU 场景输出、`cueStyles` 逐条覆盖 | 加入 sequence 编译分支，普通字幕原路径不动 |
| `wordAnimation.caption` | `schema / content / style / palette / intensity / speed`，未知 `options` 换配方时保留 [R5] | 继续作为启用入口；新增 `seed` 与 `options.daoyazi` |
| `captionEmphasis` | 文档级按词 `normal / emphasis / hero` | 复用；本样式给三档定义视觉映射（§6.4） |
| `caption_recipe.rs` | 16 份描述子，`layoutTokens.wide/square/vertical`、`visibility`、`seeded`、`fonts` | 描述符新增 `execution`；按画幅档复用 `layoutTokens` |
| `bcut-motion` | 无 I/O 的确定性曲线、`PropertyTrack`（同轨 segments 不重叠 [R10]）、`InterpolatorSpec::{Linear, Step, Angle, Color}` | 相机四通道与词级通道 lower 到它；对数缩放需新增插值器（§8.3） |
| `bcut-timeline` 与共享投影 | source / clip / cuts / rate、词锚与输出时间映射 | 先得到成片中的字幕实例，再编排 |
| `bcut-timeline-render::scene` | glyph / vector 节点、`ScenePose`、`SceneMotion`（六分量直接插值）、`GlyphRunUniform.clip`、`next_change` / `active_until`、1024 run / 4096 node 预算 [R7] | 复用 pose 与 run clip；新增分解变换不改旧 `SceneMotion` |
| `bcut-compositor` | 共享 wgpu 合成 | 不引入新运行时 |
| `bcut-editor-core`、`bcut-protocol` | App/Web 共享编辑语义，协议生成 TS | 样式操作只写一份 |

### 2.1 不是「只增加一个配方 JSON」

`caption_recipe.rs` 以 cue / 词为中心，返回逐词的位移、缩放、旋转、颜色、透明度。倒鸭子另外需要跨 cue 分组、全部块的静态布局、共享相机、历史块的可见性——这是编排层，注册表加名字给不了。

### 2.2 两个必须明确的底层事实

**相机插值不能走 `SceneMotion`。** `SceneMotion::sample()` 对六个仿射分量直接插值 [R7]：0° → 180° 的中间帧会退化成零矩阵，0° → 90° 会非预期缩小。相机必须先分别采样位置、角度、正缩放再合成矩阵；不修改旧 `SceneMotion` 的语义。

**视口裁剪首发不需要新指令（R4）。** `GlyphRunUniform.clip` 是画布坐标裁剪矩形，随 pose 运动、只改 uniform [R7]。叠加模式下画面只有字形，纯色底是视口矩形本身，固定译文在视口外走普通路径。通用 `ClipRectGroup` 留到出现每块底板或 blur 溢出时。

## 3. 产品交互

### 3.1 默认工作流

转录或导入字幕后，进入「字幕 → 样式 → 动态排版」，选择「倒鸭子」。画廊卡片悬停时播放**当前句前后几句**的连续预览（临时试穿，不写盘）；点击应用后仍停留在字幕工作流。

第一次应用不弹向导。属性页首屏是三个主要入口：**动感、配色、换一版**，下面是「镜头与排版」折叠区。没有字幕时提示先识别 / 导入；只有一句时仍可使用，并提示「连续两句以上可看到镜头穿行」。

默认外观「倒鸭子·叠加」：透明底，不改变视频可见性与声音。另一外观「倒鸭子·纯文字舞台」在字幕层内绘制不透明底色，明确写明「覆盖此范围内的视频画面」，不删素材、不改主轨静音。

首发只有一个样式族，两档运动预设「标准 / 轻动感」。黑底、配色、字幕区域是这个样式的选项，不是十几个名字不同的预设。

### 3.2 应用范围（阶段 C）

| 范围 | 用户预期 | 持久化行为 |
|---|---|---|
| 整条字幕轨（首发唯一） | 目标轨统一使用倒鸭子 | 改目标行的 `wordAnimation.caption` |
| 当前动画段 | 只调当前连续编排的一段 | 把该段的词锚范围物化为实例记录，保存显式覆盖 |
| 当前选区 | 只影响选中的成片内容 | 按 source / clip 实例与剪口拆成若干绑定，一次事务保存 |
| 仅这一条 | 不影响邻句 | 单句范围；沿用 `cueStyles` 的外观能力，不偷偷扩成整段 |

非连续选择生成独立片段，相机绝不飞过未选中、被剪掉或其他说话人的字幕。绑定重叠时编辑器切分 / 替换 / 合并成不重叠分区；底层校验拒绝未规范化的重叠。`cueStyles` 是 sourceItemId 级覆盖，同一素材重复出现时不能假设它只影响某一个 clip；新的段 / 选区以成片实例为边界。

### 3.3 属性面板

首发（阶段 A–B）：

```text
字幕 / 倒鸭子                         [标准 | 轻动感]
[当前 6 句的连续预览]

动感        轻柔 ─────●──── 强烈
配色        文字色 / 强调色 / 第二强调色
布局        [换一版]   种子 137

镜头与排版 ▾
  旋转        不旋转 / 直角转向
  镜头运动    平滑 / 停走              （camera.motion；下面一行提示语随之变）
  镜头速度    慢 ───●─── 快
  镜头停留    0 ───●─── 60%           （平滑档：camera.dwell）
  镜头提前量  0 ───●─── 满            （停走档：camera.anticipation；两行只出其一）
  文字占屏    小 ───●─── 大          （camera.fit）
  文字密度    疏 ───●─── 密
  逐词出现    开
  历史文字    保留 6 块 · 32%
  字幕区域    居中 / 下方 / 全画面
  背景        透明 / 纯色
  段落结束    停住 / 有空余时间时拉远
```

阶段 C 追加：面板顶部「应用范围：整轨 | 当前动画段 | 当前选区」、布局行的「调整布局」「固定这一段版式」、每段独立的「换一版」。

`designs/baocut` 的原型把阶段 C 的这几样一并画出来了（换一版的「换给：整轨 / 当前动画段」、主角词 chip 与「在这一条前另起一段」、调整布局编辑态的拖动 / 旋转 / 固定 / 恢复自动），作为交互与文案参考。App v2 已于 2026-09-18 落地（`stylepane/daoyazi.rs`）：「换给：整轨 / 当前动画段」（段级种子写 `captionSequences.seeds`）、「在这一条前另起一段」开关（`sequenceBreakBefore`）、逐词出现、历史行数、背景、段落结束，以及「调整布局」编辑态（拖动钉行 / 旋转 90° / 固定 / 解除固定 / 恢复自动）。主角词在 App 里不在本段选：复用字幕面板的强调词 chip（`captionEmphasis`，`hero` 角色），本段只留一句提示。

控件语义：

- 「镜头速度」只缩放镜头运动窗口，不改语音、cue 时间、视频速率和总时长。
- 「换一版」只更新本作用域种子，一步撤销；不换文稿、不改强调词。首发作用域只有整轨。
- 「文字占屏」映射 `camera.fit`。自动取景会抵消「整块放大字号」的屏幕效果，所以**不保留一个普通字号滑杆**；普通 `fontSize` 作为基础度量 / 兼容值保留，局部强调才用相对字号。
- 普通字幕的 x / y / rotation、入场动画与倒鸭子的视口 / 相机不是同一坐标层。倒鸭子生效时不叠加旧整句入场；原值保留，退出后恢复。
- 改字体、相对字号、行宽、密度会重排；改纯填充颜色不重排。
- 旋转、间距、镜头参数属于动画段；「仅这一条」的外观页不得暗中改整段。

### 3.4 舞台

默认点击文字 = 选中对应 cue，进入既有文稿编辑。只有**当前块与历史块的已显示词**可拾取，未来词不可见也不可拾取；拾取用相机矩阵的逆变换。点历史块 = 选中该 cue 并把播放头移到它的 onset（R15）。

布局编辑态（阶段 C）：双击文字或点「调整布局」进入。暂停相机，用可缩放的**文字地图**展示本段全部块，拖动块、固定位置、旋转 90°、恢复自动。退出后恢复播放头；一次拖拽一个撤销项。时间轴上的「动画段括号」是派生显示，不新增轨、不持久化第二套时序。

App v2 落地形状（2026-09-18）：舞台的行层来自 `bcut-editor-core` 几何侧车的 `LayoutFrame.sequence`（`SequenceLayout` / `SequenceRow`，帧内四角 + 段局部中心），侧车只在**暂停**时请求，所以 R15 点行跳转与拾取在播放中不可用。编辑态由属性页的「调整布局」按钮进入（App 未接双击）；进入即暂停；拖动经 `CaptionSequenceEdit { seq, drag: (key, 段局部中心) }` 走引擎的 `SequenceEdit` 通道实时预览，松手把四舍五入到 1/64 的中心写进 `captionSequences.pins`，一次 Blob 写回即一个撤销项；旋转 / 固定 / 解除固定 / 恢复自动同一条写路径。文字地图没有缩放：编辑态直接停在当前段的整体取景（`edit_mode` 由 core 的 `caption_sequence.rs` 求相机）。

### 3.5 预览、撤销与并发

沿用画廊临时文档试穿：悬停 / 键盘焦点不写盘、不进撤销、不影响导出；退出、换范围、文档 revision 改变即清除 [R11]。

重排可放工作线程，编译输入必须冻结。任务键至少含项目、文档 revision、样式摘要、画幅与字体指纹；旧结果不得覆盖新结果。撤销 / 重做恢复 seed 与人工约束，不重新抽随机数。

**seek 即采样。** 播放头跳到 t 时画面 = `sample(t)`，不从上一帧姿态过渡；顺播、seek、倒放到同一 t 逐位一致。

### 3.6 双语与减少动态效果

首发：原文倒鸭子 + 译文固定显示。固定译文在相机外，用既有翻译投影；字幕世界的视口避让译文行（视口高度由译文轨的 `y` / `verticalAlign` 派生）。

译文驱动是下一阶段，必须用真实译文 cue 或对齐块时序；只有句级译文时 `reveal` 降级为 `block`。缺译按现有缺译策略显示为空。

「不旋转」/「轻动感」是可保存、进导出的样式选项；系统「减少动态效果」只影响编辑器自动试穿。两轨同时穿行不在首发范围。

## 4. 领域对象

- `CaptionSequenceBinding`（阶段 C）：用户保存的作用范围、覆盖与人工约束，是作者意图。
- `CaptionSequencePlan`：从当前投影编译出的世界布局、焦点与动画轨，是派生产物。
- `CaptionSequenceFrame`：给定成片时刻的可见块、变换、颜色、裁剪与拾取几何，是采样结果。

一个绑定（首发即整轨）可因剪口、停顿或预算编译为多个连续 sequence。文字块的「展示期」不同于字幕的「发言期」：一个词结束发言后其块还可作为历史文字出现。不改 `cue.end`，不用当前 active cue 集合作为全部渲染输入。

## 5. 格式设计

### 5.1 唯一持久化位置

沿用 `studio/style.json`，不改 Transcript 的文字 / 时间，不进 `timeline.json` 顶层。**首发不改 `bcutStudioStyle` 版本、不改 caption schema**（R1）。

| 信息 | 存放处 | 阶段 | 作者真相 |
|---|---|---|---|
| 文本、词 id、词时间 | Transcript | 既有 | 是，不复制 |
| 剪口、clip、变速、顺序 | Timeline | 既有 | 是，不复制 |
| 样式引用、palette、intensity、speed | `wordAnimation.caption` | 既有 | 是 |
| `seed`、`options.daoyazi` | `wordAnimation.caption` | **A** | 是 |
| 单条字体、描边等 | `cueStyles` | 既有 | 是 |
| 全局强调词 | `captionEmphasis` | 既有 | 是 |
| 范围 / 人工布局 / 实例级覆盖 | `captionSequences` | **C** | 是，稀疏 |
| 世界坐标、相机轨、glyph layout | `CaptionSequencePlan` / 可删除缓存 | — | 否 |

### 5.2 配方描述符

三处同一任务加入 `caption-daoyazi-v1`（R12）：core `CAPTION_RECIPE_FILES`（渲染契约）、App `assets/captions/registry.json` + `styles/`（画廊）、Web 的资源副本。描述符在现有 `baocut-caption-style/1` 之上新增：

```json
{
  "schema": "baocut-caption-style/1",
  "id": "caption-daoyazi-v1",
  "version": 1,
  "title": "倒鸭子",
  "family": "kinetic",
  "cjk": "good",
  "seeded": true,
  "layers": ["glyphs"],
  "layoutTokens": {
    "wide":     { "viewport": [0.06, 0.08, 0.88, 0.72], "density": 0.65, "fit": 0.60 },
    "square":   { "viewport": [0.06, 0.10, 0.88, 0.70], "density": 0.60, "fit": 0.62 },
    "vertical": { "viewport": [0.06, 0.14, 0.88, 0.62], "density": 0.55, "fit": 0.66 }
  },
  "execution": { "scope": "sequence", "compiler": "typography-world", "version": 1 }
}
```

- `execution` 缺失的旧描述符继续按 cue 级逻辑。声明 `sequence` 的描述符必须命中已注册 compiler。
- **能力门在描述符，不在文件版本**：不认识 `execution.compiler` 的客户端不陈列该样式；打开已保存的项目时按普通字幕渲染并给出「此版本不支持倒鸭子，已按普通字幕显示」的诊断，不改写文件。`caption_recipe_design_descriptor` 现在对未知 id 返回 `None`，实现时要确认这条回退路径落到「普通字幕 + 诊断」而不是空白。
- `cjk: good` 只能在真实 CJK 字体与断行测试通过后发布。
- `family` 是画廊分组，`execution.scope` 是执行能力；不让 UI 分类字符串隐式决定算法。
- `layoutTokens` 复用现有 wide / square / vertical 三档机制 [R3]，值是首版起点。

### 5.3 样式载荷（阶段 A）

```json
{
  "schema": 1,
  "content": "orig",
  "style": { "id": "caption-daoyazi", "version": 1 },
  "palette": { "primary": "#FFFFFF", "accent": "#FF9B42", "secondary": "#59BAF2" },
  "intensity": 60,
  "speed": 1.0,
  "seed": 137,
  "options": [{ "kind": "object", "key": "daoyazi", "value": {
      "preset": "standard",
      "sequence": { "maxDurationMs": 12000, "maxBlocks": 16, "maxWords": 48,
                    "pauseThresholdMs": 800, "breakOnSourceCut": true, "breakOnSpeakerChange": true,
                    "fadeMs": 200 },
      "layout":   { "mode": "column", "density": null, "turnEvery": 2 },
      "camera":   { "motion": "smooth", "dwell": 0.25, "minTravelMs": 120, "maxTravelMs": 1600,
                    "travelMs": 300, "anticipation": 0.5, "maxTurnDeg": 90, "fit": null, "zoomLog": true },
      "entrance": { "durMs": 300, "pre": 0.5 },
      "reveal":   "block",
      "presentation": { "mode": "overlay", "viewport": null, "background": "#00000000",
                        "history": { "maxBlocks": 8, "opacity": 1 },
                        "ending": "hold", "translation": "fixed" }
  } }]
}
```

- 2026-09-17 落地修订：`options` **保持既有的数组形状**（每条 `{ kind, key, … }`，与 `caption-texture` 等配方同一套读写路径），倒鸭子的参数块是其中一条 `{ "kind": "object", "key": "daoyazi", "value": {…} }`，不另开对象形 `options.daoyazi`；`value` 里只写用户改过的键，缺省取配方与画幅档的默认。描述符 id 是 `caption-daoyazi`（与其他配方一样不带 `-v1`，文件名仍是 `caption-daoyazi-v1.json`）。

- `seed` 是本方案新增字段（R13）：首次应用时由文档 revision 派生一次后落盘，固定宽度无符号 32 位；换配方保留；「换一版」只改它。
- `null` 表示取当前画幅档的 `layoutTokens`；用户在面板上改过才写具体值（R10）。
- `intensity` 只调局部入场幅度与转向概率，参数映射固定在版本化配方里，不改词时间、不改种子。
- `camera.motion` 两档（R2，§8.4）：`smooth`（默认）用 `dwell`（间隔里停在旧块上的比例）、`minTravelMs`、`maxTravelMs`，`speed` 缩放 `maxTravelMs`；`stopAndGo` 用 `travelMs`（首选时长，按可用窗口缩短，`speed` 缩放它）与 `anticipation ∈ [0, 1]`（提前量占 travel 的比例）。常数对着 TypeMonkey：Stop and Go 的 pre 0.167 s / dur 0.334 s，即 `travelMs` × `anticipation: 0.5`；2026-09-18 起 `travelMs` 默认 300（typeMonkey.js 的 `.tm-wrap transition: all .3s`），停走档三个通道走 CSS `ease`（§8.3）。
- `entrance` 是词（或块）入场：`durMs` 是缩放 + 透明度的时长（`speed` 缩放），`pre` 是其中落在 onset **之前**的比例（TypeMonkey 的入场都在 marker 前 `pre` 起步，Fast Scale 是 0.167 / 0.333）。
- `layout.turnEvery`：转过一次之后至少隔这么多**行**才允许再转（默认 2；TypeMonkey `rotationThrottle`）。`layout.mode` 只有 `column`（2026-09-18 起；旧文件里的 `orthogonal`、`maxLines`、`gapEm` 读到即忽略）。
- `presentation.history.maxBlocks` 按**行**计（typeMonkey.js 念过的行全留在画面上，这里默认留 8 行、50%）。
- `sequence.maxBlocks` 也按行计，默认 16（行比旧的视觉块短，同样 48 词的预算下行数约多七成）。
- `maxTurnDeg` 限制**相邻镜头**的角度变化，不限制世界的绝对角度。
- 「轻动感」预设 = `maxTurnDeg: 0`、`dwell: 0.35`、`anticipation: 0.3`、`intensity ≤ 40`，是保存进文件的值，不是 UI 临时隐藏。没有「超调」这一项：位置 / 角度 / 缩放三个通道共用一条 ease（§8.3）。

### 5.4 项目级稀疏记录（阶段 C）

```json
{
  "captionSequences": {
    "schema": 1,
    "instances": [
      {
        "id": "cseq-01",
        "target": { "context": "sub", "role": "source" },
        "binding": { "sourceId": "main", "clipId": "clip-01", "firstWordId": "w41", "lastWordId": "w80" },
        "seed": 9021,
        "sequenceBreakBefore": ["w58"],
        "blocks": [
          { "id": "cblock-01", "firstWordId": "w49", "lastWordId": "w56", "lineBreaksAfter": ["w52"],
            "placement": { "mode": "pinned", "center": [620.0, 240.0], "rotationDeg": 90.0 } }
        ],
        "emphasisOverrides": { "w51": { "role": "hero" } },
        "caption": null
      }
    ]
  }
}
```

- **2026-09-18 App v2 实际落地的是精简形状**（core `caption_sequence.rs` 读、App `stylepane/daoyazi.rs` 写），存在 studio 样式根（`style.captionSequences`），不进样式库：

```json
{ "captionSequences": { "schema": 1, "sequenceBreakBefore": ["w58"], "seeds": { "<seq key>": 3 }, "pins": { "<row key>": { "center": [620.0, 240.0], "rotationDeg": 90.0 } } } }
```

  段键与行键由 core 按词范围派生（`SequenceIntent`），段级种子是在轨种子上叠加的偏移；`instances[]` / `blocks[]` / `emphasisOverrides` / `caption` 的完整形状留到需要选区级绑定与局部样式替换时再上，届时按下面的规则迁移。
- 它不包含字幕正文、输出秒数或排版包围盒。`binding` 首末词在源词序上形成闭区间，实际渲染取该范围在指定 clip 中仍可见的输出投影；重复播放必须带 `clipId`。
- `blocks` 只记录人工分块、人工折行或固定布局；自动块不写。固定坐标用短边 540 的世界参考单位，不是输出像素。
- `emphasisOverrides` 复用现有强调值类型：实例覆盖 > 已消歧的文档强调 > 自动建议；显式 `normal` 压过上层，删除条目 = 恢复继承。
- `caption`：缺失 = 继承轨样式；对象 = 局部完整替换；`null` = 该范围关闭 sequence 效果。同一操作不得同时写 `cueStyles` 与 `instance.caption`。
- 相机 / 视口 / 种子 / 执行版本变化切开序列；纯颜色与局部字号变化不拆。

### 5.5 单位、版本与校验

- 世界位置用短边 540 参考系，量化到 1/64 单位；最终画布缩放只做一次。
- 视口用 [0, 1] 归一化矩形，字段名 `viewport`；序列运行时用输出秒，JSON 调参用 `Ms`；作者层角度 `Deg`。
- `opacity`、`fit`、`density`、`anticipation` 有明确范围；浮点必须有限；zoom 严格大于零。
- 阶段 A 不改任何文件版本，不新增协议 capability；阶段 C 的 `captionSequences` 自带 `schema`，协议 capability 命名 `captionSequenceV1`，同任务更新协议版本、生成 TS 与参考文档。**2026-09-18 状态**：App v2 经既有 `StyleAction::Blob` 整份样式写回，未新增协议 capability 与 `bcut-protocol` 字段；`captionSequenceV1` 留到 Web / `bcut serve` 需要按字段读写时再加。
- 校验至少覆盖：实例范围重叠、锚缺失、绑定跨素材、人工块词范围重叠、人工块跨强制分段边界、非法颜色 / 浮点、块数 / 节点预算、未知 compiler / version、缩放为零、重复实例 id。读取阶段返回诊断，不写盘「修复」。

### 5.6 样式同步与模板

`style_sync` 必须保住 `wordAnimation.caption.seed` 与 `options.daoyazi` 的完整往返；`captionSequences` 留在根，不复制进 `voiceInkContexts`。新增样式应用须更新现有白名单与快照代码 [R6]。

「我的字幕样式」只保存配方引用、字体、通用参数、配色与 `options.daoyazi`；排除 `seed`、`cueStyles`、`captionSequences`、`captionEmphasis`、词锚与世界坐标。

## 6. 编译流水线

```text
Transcript + Timeline + 当前 style（+ 阶段 C 的稀疏实例意图）
        ↓ 既有共享投影：删除、剪口、变速、排序、重复实例 → 成片时间
        ↓ 解析有效样式、目标轨、范围、强调词、画幅档 layoutTokens
        ↓ Sequence 划分 → 视觉分块（hero 独立块）
        ↓ 同一 TextEngine shaping → 块内行布局与真实边界
        ↓ 有界世界排版（确定性候选评分）→ 相机焦点与运动窗口
        ↓ CaptionSequencePlan（量化静态几何 + MotionProgram + 资源 / 诊断）
        ↓ sample(outputTime) → CaptionSequenceFrame
        ↓ 现有 SceneFrame / DrawOp + glyph run clip
        ↓ App / Web-WASM / CLI 导出
```

### 6.1 先投影，再编排

输入是成片时序而不是源文件时间；共享投影已处理 source / clip / cuts / rate，不另写 `(sourceTime − in) / rate` [R9]。编译输入显式携带：

```rust
struct CaptionOccurrence {
    source_id: SourceId,
    clip_id: ClipId,
    source_item_id: SourceItemId,
    occurrence_key: OccurrenceKey,   // sourceId + clipId + 原始词 id（跨可见片段时再加片段身份）
    output_window: TimeRange,
    words: Arc<[ProjectedWord]>,
    effective_style: EffectiveCaptionStyle,
}
```

不把派生实例 id 写回 `word.id`；不存在或不可解析的锚返回诊断，不回落到第 0 秒。

### 6.2 序列边界

强制边界：目标轨 / 语言改变、效果类型改变、显式「从这里重新开始」、实例范围结束、clip 实例改变、源剪口。默认还在停顿 ≥ `pauseThresholdMs`、说话人改变处分段。

软预算三个取先到者（R14）：`maxDurationMs` 12 s、`maxBlocks` 16（行）、`maxWords` 48；另有节点 / glyph 硬预算。超预算确定性拆段或返回诊断。纯颜色、普通字号的局部变化不断段；相机、视口、种子、执行版本不同则断段。

### 6.3 视觉分块不是修改字幕

一个长 cue 可派生多个视觉块，一组紧密的短 cue 可共享一个焦点。保留 cue / word 映射和每词真实时间，不执行 transcript split / merge。

分块顺序（2026-09-18 起，块 = **行**，typeMonkey.js 的 `tm-row`）：先按 hero 词切独立行；再按标点、词边界与字符预算切行——预算 `2.5 + 5 × density` 个 CJK 单位（density 0.65 → 5.75，中文四五个字、英文一两个词），句读处满四成预算就断。行**不折行**：词左对齐从 0 起一路排过去；行的取景宽 = max(文字宽, 2 em)（typeMonkey.js `minWidthNum`），行高 = 1.2 × 字号；行盒量化到 1/32 参考单位，半宽 / 半高与段内累计高度都落在 1/64 网格上。不机械按字符数切断英文单词、emoji、连写字形或数字单位。

人工块边界落在词锚上；词内折行共享原词时序。只有句时间或句级译文时整块按句入场（`reveal: "block"`），不合成假的词时间。

### 6.4 强调词（R5）

优先级：实例显式覆盖 > 文档 `captionEmphasis` > 用户接受的自动建议 > normal。

| 角色 | 颜色 | 字号 | 排版影响 |
|---|---|---|---|
| `normal` | `primary` | 1× | 无 |
| `emphasis` | `accent` | 1× | 无；只改帧键 |
| `hero` | `secondary` | 撑到列宽，封顶 2.75×（算法 v3 前固定 1.5×） | 强制独立视觉块，进 shaping / 布局指纹 |

当前发言词在任何角色上都用 `accent` 高亮（`emphasis` 词在发言时不变色，靠入场缩放区分）。自动建议首版只用数字、用户选词等可解释规则；若引入 AI，模型只返回受限的词 id 与角色建议，由正常编辑事务写入。

## 7. 文字度量与世界排版

### 7.1 只保留一份 shaping

复用 TextEngine / cosmic-text，「测量块」与「绘制字形」建立在同一份 shaped runs 上；不得 Web 先 `measureText()` 排一遍再让 Rust 重排 [R1][R2]。布局中保留 word → 文本范围 → cluster / glyph 范围的映射（连字、组合符号、RTL）[W2]。缓存键含文本、face 指纹、fallback 集、字重 / 轴、方向 / 语言、字号、字距、`density`。字体未就绪时只能用标明状态的临时预览。

### 7.2 静态世界布局（R6，2026-09-18 改为列式 + 枢转）

只做正交排版：行角度 ∈ {0, 90, 180, 270}，所有行在世界里是轴对齐矩形（90 / 270 时宽高互换），碰撞退化为 AABB 相交测试，不需要 OBB / SAT。世界的形状对着 typeMonkey.js：

- **段（paragraph，它的 `tm-block`）**：若干行左对齐往下叠成一列，整段一个角度。段有局部原点（首行左上角的世界位置）、角度与已叠高度；第 k 行的中心 = 原点 + R(角度)·(w/2, 已叠高度 + h/2)，`R` 是直角旋转（顺时针为正、y 向下），编译期不用三角函数。
- **顺着走**：平常一行接一行往下叠（typeMonkey.js 的 `top = −rowHeight × n`）。第一段从原点开始，角度接上一动画段的末角度（列跨段续接）。
- **转向 = 枢转**（它的 `rotate: 'lb' | 'rb'`）：新段绕上一行的一个下角转 90°——`lb` 绕**左下角**，新段顺时针 +90°，新首行的左下角就是那个角（它 `transform-origin: left bottom` + 上一段 `rotate(−90deg)` 的逆）；`rb` 绕**右下角**，新段逆时针 −90°，新首行的右下角就是那个角（`originX × 100% bottom` + `rotate(90deg)` 的逆）。角取的是行**取景宽**的角（与它按 `minWidthNum` 夹取后的 `cur.width` 定位一致）。
- **什么时候转**：上次转向之后至少隔 `layout.turnEvery` 行（默认 2），用行种子抽一次「转不转」：cue 边界或上一行以句读收尾处概率 `0.55 × min(intensity / 60, 1.6)`，行中间 `0.2 × …`（`maxTurnDeg < 90` 恒否）。默认动感下约每 4 行竖一次——TypeMonkey 的 `rotatePct` 25% 是按词算的，typeMonkey.js 的作者标 lb / rb 也不看句读；第三轮首发时只在句读处抽 25%、隔 3 行，35 行只转两三次，用户反馈「垂直翻转太少」（2026-09-18 调高）；转的话先抽方向：第一次 50/50，之后 70% 与上一次相反（typeMonkey.js 的作者也是 lb / rb 交替着标）；抽到的方向撞上已有行就换另一边。
- **撞了怎么办**：顺着叠会撞上别的段（同向连转三次会往里卷）时，节流允许就转（两个方向都试），不允许就把新段**跳**到世界包围盒外顺着走的那一侧（隔 0.6 个视口，按本行取景 zoom 换算），角度不变，记 `layout-jump` 诊断。不接受重叠。

种子只在「转不转」「往哪转」两处进入布局求解，算法 v3 起另有一处定行色（每行 `blockSeed` 依次抽 seedHex / turnRoll / dirRoll / toneRoll，原型与内核同序）；「换一版」改变布局只经前两个入口，顺带换一套逐句配色。历史行不在新行出现时重排；位置一旦在计划中确定，后续相机只改取景。世界包围盒上限 = 参考画布 6 × 6 倍，超出记诊断。pinned 行（阶段 C）先登记进碰撞表，自动行绕开；轮到它时按固定姿态另起一段。

第二轮（2026-09-17）的候选评分求解（4 边 × 3 对齐 × 角度、顺着走加分、回折惩罚）已废：它把世界排成地砖，转向处新块贴在旧块侧边，而不是倒鸭子那种「一列念完、绕角一转、再念一列」。

### 7.3 稳定随机（R7）

```text
blockSeed = fnv1a64(recipeVersion ‖ algorithmVersion ‖ userSeed ‖ sourceId ‖ clipId ‖ blockAnchorWordId)
rng       = SplitMix64(blockSeed)          // 只在整数域抽样：rng.next() % n
坐标      = round(x × 64) / 64             // 世界参考单位，量化后写入 plan
角度      ∈ {0, 90, 180, 270}              // 编译期不调用 sin / cos
```

不用数组索引、时间、内存地址、HashMap 次序作为种子或平局规则。自动块以稳定首词为身份，人工块用保存的 id；同一字幕在不同 clip 的实例因 `clipId` 不同得到独立但确定的布局。

改稿通常只影响本段，但不保证绝对：修改停顿、删边界词、换字体、改分段阈值可能重算到下一个强制边界。UI 提示真实影响范围；需要绝对稳定的段，用户在阶段 C 保存手动边界与布局约束。

### 7.2.1 同列等宽与逐句换色（2026-09-18，算法版本 3）

用户反馈「动画效果不太好」，对着参考片（整句一行、一列的行左右两边都齐、逐句换色、念过的行不淡）改了三处，原型与内核同口径：

- **同列等宽**：列宽 = `基础字号 × (2.5 + 5 × density)`，也就是分块时的每行字数预算。每行先按基础字号量自然宽，再把这一行的字号乘上 `rowScale = clamp(列宽 / 自然宽, 0.75, 2)`（主角行封顶 2.75，量化到 1/64）。短句字大、长句字小，一列的左右两边都齐；行距收到 1.12 倍字号，行与行贴着才像一块字。主角行不再固定 1.5×。
- **逐句换色**：每行在 `dirRoll` 之后再抽一次 `toneRoll`（三表面同序）。换到新 cue 时定色：`< 0.5` 主色、`< 0.78` 强调色、其余次强调色；抽到与上一句相同的强调档就回主色，两档强调色不连着出。一句的各行同色。行内的强调词 / 主角词取「另一档」，撞上行色就让到剩下那一档。
- **整行入场、历史不淡**：`reveal` 默认改 `"block"`，`history.opacity` 默认改 1。中文 transcript 常常一字一词，逐字弹入又逐字换高亮色在屏幕上就是一片碎闪。整行入场从 0.7 倍起（逐词档仍是 0.3 倍），整行档不标「正在说」。逐词档保留，属性页那颗开关照旧。

`fit` 三档 token 同步调低（0.60 / 0.62 / 0.66）：同列等宽之后每行都是满列宽，0.78 会把整列顶到视口边，上一列转过去之后看不到。

### 7.2.2 防「快闪」：并块与块内折行（2026-09-18，算法版本 4）

用户反馈：有些文字时间太短，刚出来镜头就走了，像快闪；折行没关系。按预算切行会留下只有一两个字的尾巴，语速快的句子每行也只有半秒，一个字的短句（「哦」）更是一闪而过。

- **并块**：分段之后逐块量停留时间（下一块首词开口 − 本块首词开口；段尾块 = 末词收声 − 首词开口）。不足 **0.7 s** 的块并进相邻块。并块总是保住较早的那个入场时刻：字可以早一点出来，不能念完了才出来。邻块挑字数少的那个，一样多取前一块，所以一串都很短的块两两成对，不会滚成一大块。可以跨 cue 并（块的 `cueId` 取首词所在的 cue）。主角块不参与，换说话人不并，并完不超过 3 行的字数。词序与词时间一个都不动。
- **块内折行**：块的字数超过「预算 ÷ 0.75」（字号缩到下限也装不下一行）时，按字数均分折成 `ceil(字数 / 预算)` 行，每行各自撑到列宽（§7.2.1），行高累加。看上去与几个单行块一样，只是一起入场、镜头只停一次。`SeqBlock.lines` 记行数，`font` 取块里最小的那行字号，取景的可读性区间按它算（不再从块高反推）。
- 固定块（§7.4）按首词 id 记，并块后首词变了的 pin 会失配，按既有规则回到自动。

### 7.4 人工约束（阶段 C）

固定块优先于自动求解，其他块绕开它。改字体后固定块碰撞时提示「固定布局与新文字冲突」，允许重排未固定块或解除约束，不擅自移动锁定块。读取、编译或缓存失效不得静默删除人工约束。

## 8. 相机与动画求值

### 8.1 变换约定

列向量，世界与屏幕坐标 x 向右、y 向下，角度顺时针为正。完整变换：

```text
Mscreen = MoutputScale × T(viewportCenter) × S(zoom) × R(−cameraAngle) × T(−cameraCenter) × Mblock × MwordLocal
Mblock  = T(blockCenter) × R(blockAngle) × T(−blockWidth/2, −blockHeight/2)
```

`MoutputScale` 把短边 540 的参考画布转成输出像素，只乘一次。当前块角度等于相机角度时块在屏幕上正立。底色与固定译文在屏幕空间，不参与相机矩阵。调用 `post_concat_mat6` 时注意其「先 first 后 second」约定 [R7]。

### 8.2 焦点与取景（R9，2026-09-18 改为逐行归一）

镜头对着**当前行**（typeMonkey.js 的 `scale = conWidth / rowWidth`，`conPercent` 0.8）：

```text
zoom = viewportW × fit / rowW          rowW = max(文字宽, 2 em)，即行的取景宽
```

短行大、长行小，每行都占同一屏宽，行盒在视口居中，相机角度 = 行角度。算法 v3 起行本身已经同列等宽（§7.2.1），所以一列之内镜头几乎不变焦，只在碰到字号上下限的行上才动；可读性区间按**这一行自己的字号**算（`行高 / 1.12`），不再按基础字号。zoom 夹在可读性区间内：下限使当前行屏幕字号 ≥ 参考画布高的 3.2%（1080p 下约 35 px）；上限取两者较小：单行高 ≤ 视口高 × fit，且屏幕字号 ≤ 参考画布高的 **30%**（两个字的行也能占满屏宽；第二轮的 20% 是为整块取景定的，逐行取景下会把短行压小）。阅读态当前行四角在视口内；移动过程中允许旧行出画。局部弹跳、描边扩张计入安全预算，不只检查结束帧。

### 8.3 相机通道

相机四个独立通道 x、y、rotation、zoom；局部文字用既有 opacity / dx / dy / scale / rotation。统一 lower 到 `bcut-motion`。

- 三个通道**共用一条 ease**：平滑档 `ease(u) = u²(3 − 2u)`（首尾速度为零的 Hermite，就是 AE 表达式 `ease()`，TypeMonkey 的位置 / X / Y / Z 旋转 / dolly 全用它）；停走档 CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1)（typeMonkey.js 的 `transition`，起步快、落地软，`x(t)` 用 8 步牛顿法反解，原型与内核同一份常数与步序）。位置、角度、缩放同时起步、同时停下；不叠「超调」回弹——第一版位置通道单独叠了一段中途鼓包，与角度 / 缩放曲线不同步，是「不顺」的直接来源之一。
- 位置：`lerp(from, to, ease(u))`。
- 角度：编译期已选定转向（cw / ccw 写进 plan），插值只在 [from, from + Δ] 上做，不在运行时求最短路；180° 平局固定取 cw。
- 缩放：`zoomLog: true` 时 `zoom(u) = exp(lerp(log z0, log z1, ease(u)))`，需要在 `bcut-motion` 新增并测试 `LogPositive` 插值器——现有 `InterpolatorSpec` 没有它 [R10]。首个闭环可先用线性正缩放。

不对合成后的 Mat6 做 tween。

### 8.4 运动窗口与语音（R2）

对第 i 个焦点（块），`onset_i` = 块首词在成片中的开始时间，`prevEnd` = 上一段镜头停下的时刻（上一相机段的 `t1`；本段第一块取上一动画段的末段 `t1`）：

```text
平滑（camera.motion = "smooth"，默认；MonkeyCam Smooth）
  travel_i  = clamp((1 − dwell) × (onset_i − onset_{i−1}), minTravelMs, maxTravelMs / speed)
  travel_i  = min(travel_i, onset_i − prevEnd)
  segment_i = [onset_i − travel_i, onset_i]                 （到达即开口）

停走（camera.motion = "stopAndGo"；MonkeyCam Stop and Go）
  travel_i  = min(travelMs / speed, 0.45 × (onset_{i+1} − onset_i))
  lead_i    = min(anticipation × travel_i, 0.3 × (onset_i − onset_{i−1}))
  segment_i = [onset_i − lead_i, onset_i − lead_i + travel_i]，且不早于 prevEnd
```

平滑档里镜头在两个焦点之间一直在飞、用整段间隔的 `1 − dwell` 做运动（TypeMonkey 是整段），到达时刻正好是新块开口；间隔很长时封在 `maxTravelMs / speed`（默认 1.6 s）里，免得镜头爬两三秒。停走档保留第一版的短跳（默认 0.3 s、提前一半），是 TypeMonkey 的 Fast 档 / typeMonkey.js 的 0.3 s transition。两档下新块文字都在 `onset_i − pre` 才开始入场（§8.5），镜头飞向的是空位。窗口短于 `minTravelMs` 时去掉旋转（角度突变最刺眼）；不推迟词时间。

所有相机段按输出时间排序并消除重叠（`PropertyTrack` 要求 [R10]）：`segment_i.start ≥ segment_{i−1}.end`，平滑档缩 `travel_i`，停走档先缩 `lead_i` 再缩 `travel_i`。新段的 `from` 是上一段的 `to`（相机姿态在段边界连续）。静止段有明确 hold；不用依赖上一帧状态的弹簧积分。

### 8.5 文字生命周期（R3）

每个块有：首次可见时刻（= 首词 onset − pre）、焦点窗口、历史可见窗口、所在 sequence 的结束时刻。`reveal: "word"` 时块内每个词在自己的 `onset − pre` 开始入场（`pre = entrance.pre × entrance.durMs / speed`，默认 0.15 s；入场 = `durMs`（默认 300 ms）内从 `popFrom` 倍放大到 1 并淡入，原点在**左中**——逐词时是词的左边、整块时是行的左边（typeMonkey.js 的 `zoomIn` + `transform-origin: left center`），曲线是 CSS `ease`；`popFrom = 1 − 0.7 × min(intensity / 60, 1)`，动感 60 从 0.3 倍起、动感 0 不缩放），到 onset 时已站住大半——TypeMonkey 的全部入场预设都在 marker 之前起步，这样词不会「慢半拍」；`"block"` 时整块按首词计。「在念」（高亮）仍严格是 `[start, end)`，与入场分开处理。

默认保留最近 `history.maxBlocks` 行历史（默认 8 行；透明度算法 v3 起默认 100%，此前 50%），按稳定规则降到 `history.opacity`；更早的行不绘制。未来块即便已编译也不绘制。历史块用自身最终局部姿态与样式，不被当前 cue 的颜色或入场计时器覆盖。

### 8.6 段尾与段间（R8）

默认停在最后焦点。`ending: "overviewIfRoom"` 只消费范围内已有的非发言余量（≥ 1.2 s 时拉远到本段世界包围盒，最长 1.5 s），没有余量就停住，不压缩末词阅读时间、不延长 project duration。

段与段在**同一张画布**上：每段世界先在自己的局部坐标里排好，再接到上一段世界旁边——顺着上一段最后的走向（§7.2 的「下方」），隔 0.6 个视口（按首块取景的 zoom 换算），与所有既有世界不重叠（不行就换边、加倍间距，最后放到最右远处）；块的 `center` 是全局值，`localCenter` 与 pins 是局部值（重排上一段不该挪走这一段固定的块）。下一段的第一个相机段是从上一段末姿态（含总览）出发的 `enter` 段，按 §8.4 的规则定窗口、到达即开口，`cutAt` 就是它的起飞时刻；飞行途中上一段仍用**同一台相机**画在画面上，从起飞到到达后 `fadeMs` 走一条 ease 淡掉，淡出中的块计入节点预算。第一段是硬切到首块。TypeMonkey 只有一张无限画布、镜头一路飞，这里的「段」只是排版局部性的单位，不是切点。用户主动选择「增加片尾总览」是明确的剪辑操作，由 Timeline / 导出层负责补尾段，不由字幕 renderer 补帧；可后置。

## 9. 共享渲染落地

### 9.1 内部接口

新增模块 `core/crates/bcut-subtitle-render/src/caption_sequence/`（`model / resolve / segment / layout / camera / sample`），不新建 crate，不放进 `apps/baocut`。

```rust
pub struct CaptionSequencePlan {
    pub identity: PlanIdentity,
    pub groups: Vec<SequenceGroup>,
    pub resources: ResourceRequirements,
    pub diagnostics: Vec<CaptionDiagnostic>,
}
pub fn compile_sequence(input: &ProjectedCaptionInput, style: &ResolvedSequenceStyle,
                        metrics: &PreparedTextMetrics) -> Result<CaptionSequencePlan, CaptionError>;
pub fn sample_sequence(plan: &CaptionSequencePlan, output_time: f64) -> CaptionSequenceFrame;
```

`sample_sequence` 不读文件、不探测字体、不做网络、不生成随机数。

### 9.2 OverlayRenderPlan 集成

编译时按有效样式建立普通 cue 计划与 sequence 计划两类；渲染时 sequence 拥有的 cue 不再画普通字幕，固定译文仍走普通路径。CPU 图像、GPU scene、拾取几何、字体需求、可见边界、诊断都从同一份 `CaptionSequenceFrame` 派生。

### 9.3 GPU 路径与最小可行方案

首个闭环：编译一次 shaped geometry；每个采样时刻从相机通道算一次矩阵，与可见块 / 词姿态组合后写进现有 glyph pose 与逐词 uniform（含 `clip`）。动态帧执行**轻量 sample**，不是重新 compile；`next_change` 指向下一次需要采样的时刻（运动中 = 下一帧；静止 = 下一个词 onset / 段边界）。

后续把静态 scene 与动态 pose 更新拆开，结构边界才重建 scene；那时再用 `active_until` 表达持续运动，并为 retained scene 加通用的**分解变换** motion（新类型 / 新编码能力，保持旧 `SceneMotion` 不变）。native 与 Web 的 compositor 不各写一套相机。

### 9.3.1 清晰度：按屏幕字号光栅 + 自动描边（2026-09-18）

用户反馈「字有点糊，还不如视频里烧进去的字幕清楚」。根因在 GPU 路径：atlas 里的 glyph mask 按**世界字号**（约 30 px）光栅，再被镜头 zoom 放大两三倍采样。CPU 路径走轮廓填充，本来就是清楚的。

- **按屏幕字号光栅**：每个词取「行变换 ∘ 相机」的实际缩放，向上量化到 2^(1/4) 一档（变焦途中不至于每帧换一套 mask），在 `字号 × 倍率` 下整形并取 mask，实例变换里再乘 `1 / 倍率` 缩回行内坐标。光栅字号封顶 144 px（一帧的字形要装进 2048² 的 atlas），下限 0.25 倍。
- **区域外不出字形**：行盒四角过变换后的包围盒（四周留一行高）与字幕区域不相交的行整行跳过，GPU 省 atlas，CPU 省填充。
- **自动描边**：叠在视频上（不是「舞台模式 + 不透明底色」）时，序列层给每个字描一圈深色边，单侧 0.045 em。GPU 是排在填充 run 之前的另一个 glyph run，用 `glyph_stroke_atlas_render` 的 stroke mask（宽度量化到 0.5 px）；CPU 先整层 `stroke_path`（圆角连接）再整层填充，两遍分开，后一个字的描边不会压在前一个字上。描边的不透明度取词不透明度的平方，入场时比填充晚一点显出来。涂装里的描边 / 阴影仍不读（§3.4），这一圈不是用户可调项。

### 9.4 视口裁剪（R4）

首发：把视口矩形（屏幕空间，编译期量化为整数输出像素）写进每个 glyph run 的 `clip`。GPU 与当前 scissor 求交；CPU 对整个字幕子场景应用同一边界；正确保存 / 恢复原有 scissor。需要 `ClipRectGroup` 的条件：出现每块底板 / 装饰 vector、或阴影 / blur 溢出视口。届时同步 BCS 编解码、Web reader 与 fallback preflight。

### 9.5 层级与排除开关

字幕层内部绘制顺序：可选屏幕底色 → 历史块 → 当前块 → 固定译文。整体仍在现有字幕与 timeline 元素的合成位置。`--no-subs` 排除全部倒鸭子内容；`--no-texts` 不把它当文本元素删；轨隐藏与 burn-in mode 一致 [R2]。

### 9.6 缓存身份和调度

四层：文本 shaping 缓存；世界布局缓存（块尺寸、种子、约束、画幅、算法版本）；时间计划缓存（输出投影、分段、镜头窗口）；帧身份（相机矩阵、可见块 / 词状态、颜色、裁剪）。`subtitle_key` 不能只看当前 cue id；`draw_op_fingerprint` 代表整幅 overlay；`next_change` 与 `active_until` 分清 [R2][R7]。不把 PNG 当缓存；Web CPU fallback 处理 straight alpha。倒鸭子可能覆盖整个画布，不沿用「字幕只占底部窄条」的假设。

### 9.7 性能边界

首版不做 motion blur、3D 透视、物理碰撞、动态字重轴。按可见区域剔除历史块（AABB 扩张效果范围）。遵守 1024 run / 4096 node 预算 [R7]，达到上限拆段、缩历史或走已声明 fallback。性能指标分开记：计划编译耗时、每帧 sample、glyph 上传量、fallback 次数、1080p / 4K 峰值内存。

## 10. 编辑联动与失效规则

| 操作 | 保留 | 重新计算 / 诊断 |
|---|---|---|
| 只改文字颜色 | 世界位置、相机、shaping | 帧键 |
| 改字幕文字 | 稳定词身份、其他段 seed | 当前块 shaping；本段布局与镜头 |
| 改字号 / 字体 / 字距 / 密度 | 文稿、seed、人工意图 | 度量、碰撞、fit；固定块冲突提示 |
| 改 `hero` 角色 | 文稿、seed | 视觉分块、本段布局与镜头（R5） |
| 改 `emphasis` 角色 | 一切几何 | 帧键 |
| 拆分 / 合并 cue | 原始词 id | 视觉块与作用域；不按 cue 数组索引绑定 |
| 隐藏字幕词 | 音视频剪辑 | 可见集合与焦点；隐藏词不留作历史 |
| 剪掉媒体片段 | 未剪部分的意图 | 新输出投影；剪口前后独立序列 |
| 修改 clip 速率 | 静态几何 | 相机窗口、词级动画时间、分段 |
| 移动 clip | 内容与实例 id | 输出时间偏移；不按绝对秒追踪 |
| 复制 clip | 源文稿 | 新实例身份；显式复制或不复制约束 |
| 修改画幅 | 文稿、seed、相对视口 | 画幅档 tokens、折行、碰撞、镜头 |
| 重新识别生成新词 id | 不猜配对 | 有编辑映射则显式重绑；无则标记孤儿 |
| 撤销 / 重做 | seed、作用域、约束 | 确定性重编译 |

词锚迁移复用现有编辑映射，作为共享事务的一部分；不在读取时靠时间或相似文本静默重绑。清理孤儿是显式可撤销操作。

### 10.1 事务入口

阶段 A：`ApplySequenceStyle(scope = track, preset)`、`ReseedSequenceStyle(scope = track)`、既有 `SetCaptionEmphasis`。阶段 C 追加：`SetSequenceCaption(instanceId, caption)`、`SetSequenceBoundary(wordAnchor)`、`PinTypographyBlock(blockSpan, placement)`、`SetInstanceEmphasis(wordAnchor, role)`、`ClearSequenceOverride(scope, section)`。

通过现有 Kernel / workspace 样式事务落盘；协议扩展从 Rust 定义生成 TS。`style/apply` 与 Transcript 用 studio 文档 revision，Timeline 另有 revision [R12]。为选区分割重叠范围、生成实例 id、保存样式与约束必须一次提交；新 id 在事务里分配，不在 `sample(t)` 中生成。

## 11. 输出与兼容

- **MP4 / 本机视频**：沿用 `OverlayRenderPlan` 与既有装配、合成、编码管线。按 `t = n / fps` 取样，不累加墙钟；总帧数沿用统一时长策略。
- **SRT / VTT / ASS**：来自成片字幕的语义投影，不输出历史残留，不写坐标；重复 clip 按成片出现次数重复。ASS 首发明确提示「文本与时间可导出，倒鸭子效果不保留」[R4]。
- **可编辑 NLE 工程**：接入 `bcut-editable` 预检；三选一：保留普通可编辑字幕 / 目标格式支持时烘焙该范围的字幕层 / 取消。未验证的透明视频导出不写成已有能力。
- **BCF 作者层**：不改造成 BCF 特殊节点。未来提供显式「冻结 / 烘焙」把字幕投影与计划输出为作者格式的文字、变换与时间轨，副本与原字幕解绑并在 UI 说明。

## 12. 具体改动清单

| 类型 | 位置 | 改动 | 阶段 |
|---|---|---|---|
| 新增 | `bcut-subtitle-render/src/caption_sequence.rs`（落地时合成一个文件，随 `lib.rs` 的 `include!` 平铺） | 跨句输入、分段、视觉分块、世界排版、镜头与采样 | A（2026-09-17 已做） |
| 新增 | `bcut-subtitle-render/src/caption_sequence_demo.rs` | 画廊小样：三句固定样例过同一条序列编译 / 采样 / 真字形，App `stylepane/sequence_thumb.rs` 后台按 30 fps 排帧 | C（2026-09-18 已做） |
| 扩展 | `bcut-subtitle-render/src/{document,caption_recipe,render_plan,transition}.rs` | 按 `execution.scope` 分派；scene / CPU 共用 sequence frame；动态键与 fallback；run clip 写视口 | A–B（2026-09-17 已做；拾取未接） |
| 扩展 | `bcut-subtitle-render/src/style_sync.rs` | `seed` 与 `options.daoyazi` 无损往返 | A |
| 新增 | core `CAPTION_RECIPE_FILES`、`apps/baocut/assets/captions/`、Web 资源副本 | `caption-daoyazi` 描述符与 `execution`（core 与 App 两份副本 2026-09-17 已做，Web 未做） | A |
| 扩展 | `bcut-motion/src/{program,interpolate,sample}` | `LogPositive` 插值器与测试；不改旧曲线 | A（可后置） |
| 扩展 | `bcut-editor-core/src/style_library.rs`、`apps/baocut/src/host/style_library.rs`、`apps/baocut/src/app/editor/stylepane/daoyazi.rs` | 注册 / 保存 / 换一版（整轨）；画廊按注册表 `family == "kinetic"` 分组（2026-09-17 已做）；作用域与段级换一版、断段、逐词 / 历史行数 / 背景 / 段落结束、调整布局编辑态（2026-09-18 已做；`captionSequences` 列入样式库排除键） | A、C（已做） |
| 扩展 | `bcut-compositor` / CPU scene 执行器 | 每帧 pose 采样、run clip 与 scissor 求交、预算与 fallback | B |
| 扩展 | `bcut-wasm-subtitle`、`bcut-wasm-editor` | 计划 / 意图的 wasm 出口 | B |
| 扩展 | `apps/web` 字幕渲染与属性页、`apps/baocut` 字幕样式 / 舞台 | 只传数据与控制预览；同名操作；布局编辑态（App 2026-09-18 已做：`stage/sequence.rs` 行层 + `StageGesture::SequenceRow`，几何侧车 `LayoutFrame.sequence`；Web 未做） | B–C |
| 扩展 | `bcut-timeline-render/src/scene.rs` 及编解码 | 分解变换 motion（retained 优化时）；`ClipRectGroup`（按需） | D |
| 扩展 | `bcut-protocol`、Kernel 写路径 | `captionSequences`、`captionSequenceV1`、校验、TS / docs 重生成 | C（未做：App 走整份 Blob 写回，见 §5.5） |
| 扩展 | `bcut-editable` 与导出 preflight | 不支持效果时的明确选择（2026-09-18 已做：预检码 `caption-sequence` warning，原文轨按普通行进 `tr-subs`；由 kernel 按原文行配方判定） | B（已做） |
| 扩展 | `designs/baocut` | 画廊「动态排版」区的倒鸭子卡、属性页「倒鸭子」段、舞台 canvas 与布局编辑态（2026-09-17 已接入，含阶段 C 的控件） | 已做（原型） |
| 扩展 | 文档与 fixtures | 样式契约、协议变化、产品行为、golden | 各阶段 |

不引入 `ffcreator`、React 动画引擎、浏览器录屏 API 或新的服务端渲染服务。

## 13. 分阶段实施与验收

### 阶段 A：格式与纯编译闭环

2026-09-17 已落地（core `caption_sequence.rs` + `render_plan.rs`；`cargo test -p bcut-subtitle-render` 里 `caption_sequence_tests` 与 `daoyazi_sequence_takes_over_the_original_track_on_both_render_paths` 钉住确定性、seek 一致、视口裁剪与 GPU / CPU 两条路径）。native / wasm 逐字节一致尚未在 wasm 侧验证。

交付：描述符 `execution`、`seed` / `options.daoyazi` 往返、source + clip 实例投影、分段、真实字体度量、确定性世界布局、相机轨（含提前量）、逐词生命周期。先用全画布、单语、普通填充、有限直角运动，用已有 CPU / Scene 输出验证。

退出条件：固定输入在顺播、seek、倒放取样时逐位一致；改色不重排；改一段不随机改变无关段；剪切 / 变速 / 重复 clip 不错词、不串组；同一 seed 在 native 与 wasm 得到同一份量化 plan。没有 UI 之前先把这些不变量写成测试。

### 阶段 B：原生与 Web 渲染

2026-09-17 原生侧已落地（App v2 舞台走共享 `OverlayRenderPlan`，画廊「动态排版」组与属性页「倒鸭子」段）；Web 渲染、导出预检未做。

交付：GPU glyph pose 路径、run clip 视口、CPU fallback、动态缓存 / `next_change`、画廊门控、导出预检。

退出条件：原生预览、Web、正式导出对同一时刻使用同一布局 / 相机 / 生命周期；不支持的 GPU 条件明确回退不漏层；局部 viewport 不漏字、不误裁其他层。

### 阶段 C：样式交互与编辑

2026-09-18 App v2 已落地：画廊卡真跑小样（选中后按用户色板 / 种子排帧）、整轨 / 当前段两档「换给」、`captionSequences`（精简形状，见 §5.4）、断段、逐词出现 / 历史行数 / 背景 / 段落结束控件、调整布局编辑态（拖动钉行 / 旋转 / 固定 / 恢复自动，一次拖拽一个 Blob 写回即一个撤销项）、舞台点行跳转（R15，仅暂停时）、导出预检 warning。未做：当前选区 / 仅这一条两档范围、双击进入编辑态、画廊悬停试穿（选中即真跑，不做悬停临时文档）、Web、协议 capability；「字幕修改联动」（改词后 pins 键失配即回到自动）与「复开项目保持布局」只有单元测试，未在真实项目上端到端验证。

交付：画廊连续预览、整轨 / 本段 / 选区范围、`captionSequences`、固定版式与布局编辑态、每段换一版、撤销 / 重做、字幕修改联动。双语「原文动态、译文固定」。

退出条件：每次操作只影响声明范围；试穿不污染导出；取消、撤销、复开项目保持同样布局；App / Web 共享操作结果一致。

### 阶段 D：质量和高级能力

交付：样片调参、对数缩放、段尾总览、译文驱动、实例迁移、retained scene / atlas 优化、`ClipRectGroup`。译文驱动、AI 关键词建议、手动相机关键帧、3D、运动模糊、多轨同时穿行不阻塞首发。

## 14. 测试矩阵

### 14.1 确定性与几何

- 相同输入、字体、算法版本、seed 与采样时刻重复渲染一致；native / wasm 量化 plan 逐字节一致。
- 顺播到 7.2 s、直接 seek 7.2 s、从 10 s 倒退到 7.2 s 一致。
- 0 → 90 → 180 转向无矩阵塌缩；转向方向与 plan 记录一致；`maxTurnDeg: 0` 时全程角度为 0。
- 行是最小单位：每块单行、词左对齐从 0 起不回头、取景宽 ≥ 2 em 且 ≥ 文字宽、行高 = 1.2 × 字号、行盒落在 1/32 网格；一个字的行取景宽恰好 2 em。
- 逐行取景：阅读态 `zoom × 行取景宽 = 视口宽 × fit`（除非碰到 30% 字号上限），镜头中心 = 行中心。
- 枢转几何：`lb` 后新段角度 +90、新首行左下角与上一行左下角重合；`rb` 后 −90、右下角重合；同段相邻行紧贴、左对齐；相邻段角度差只有 ±90 或 0（跳段）。
- CSS `ease`：`cssEase(0.5) ≈ 0.802`、`cssEase(0.25) ≈ 0.409`，单调，端点归零归一；停走档运动中点走到 `cssEase(0.5)`；弹入起点 = `popFrom`、原点 = 词的左边（整块时行的左边）。
- zoom 全程在可读性区间内；极短句、单字、标点、空块无 NaN / Inf。
- 阅读态当前块四角在视口内；平滑档新块首词 onset 时镜头已到达（`t1 = onset`），停走档提前量 ≤ 0.6 × travel。
- 位置 / 角度 / 缩放同一条 ease：平滑档运动中点三者都恰好走一半，位置不越过两端（无超调）。
- 段与段：各段世界包围盒互不重叠；`center = localCenter + origin`；`enter` 段起点等于上一段末姿态、不早于其停下时刻；`cutAt` 前后一瞬相机姿态连续。
- 排版顺着走：多数行落在上一行坐标系的「下方」（≥ 60%），两次转向之间至少隔 `turnEvery` 行。
- 竖过来的频率：默认动感下转向不少于行数的 15%，且行中间（非句读、同一 cue 内）也会转（2026-09-18 调高转向概率后的下限）。
- 布局：任意两块 AABB 不相交；pinned 块位置不变；hero 词单独成块。
- 像素 golden 只在固定软件后端与字体下做；CPU / GPU 用边界位置、透明度与阈值误差。

### 14.2 时间和内容

- 24 / 25 / 30 / 60 / 30000⁄1001 fps；边界前一帧 / 边界帧 / 后一帧。
- 首尾从句中裁切、连续超短 cue、长停顿、多人接话、原词跨剪口。
- 同源多 clip、同词两次出现、`sourceItemId` 相同但 `sourceId` 不同。
- 无词时间的 SRT（`reveal` 降级）、句级译文、缺译、隐藏原文或译文、仅译文。
- 历史残留不改 SRT；未来块不在 `onset − pre` 之前曝光，onset 前已在入场但不算「在念」；总览不延长输出；上一段在 `enter` 段到达后 `fadeMs` 内淡完。
- `--no-subs` / `--no-texts` / `--no-audio` / 导出窗口组合。

### 14.3 文字与格式

- 中英混排、CJK 标点、组合字符、emoji、RTL、连字、数字单位、超长单词。
- 字体 fallback、字体丢失 / 补齐、换字体后缓存失效。
- 旧 style / caption 读取结果不变；不认识 `execution` 的读取器不陈列、按普通字幕渲染并报诊断；style / context 往返不丢 `seed` 与 `options.daoyazi`。
- 模板不含 `seed` 与项目词锚；阶段 C 的 `instance.caption` 缺失 / null / 对象各自正确。

### 14.4 性能与调度

- 纯相机运动但 cue 未变时连续重绘；运动结束且无变化时停止空转。
- 缓存命中后不重复 shaping、不重复上传相同 glyph mask。
- 1080p / 4K、横竖屏、CPU fallback、无 GPU、预算溢出。
- 长文稿编译不让全部世界与历史字形永久驻留显存；普通字幕无性能或像素回归。

建议新增 `core/fixtures/caption-sequence/`：短样片、长文稿、双语、重复片段、快速语音、hero 密集、固定布局冲突各一份，同时记录 normalized plan、选定时刻几何与参考图。原型的 `designs/baocut/app/model-daoyazi.test.js` 已覆盖确定性、无重叠、seek 一致与 zoom 区间四条不变量，可作为 Rust 测试的对照。

## 15. 原型如何迁移

| 原型部分 | 可借鉴 | 生产替换 |
|---|---|---|
| `designs/baocut/app/model-daoyazi.js` 的分段 / 分块 / 候选评分 / 相机窗口 | 算法与权重初值、不变量测试 | Rust 实现，接共享投影与 TextEngine 度量 |
| Canvas `measureText` | 调视觉密度的参考 | 同一 TextEngine 的 shaping 与缓存 |
| FNV-1a + SplitMix64 | 直接对照 | 同算法、整数域 |
| 属性面板、试穿、布局编辑态 | 交互与文案 | App / Web 现有字幕样式工作流与共享编辑意图 |
| 计划检视（plan JSON） | 调试与测试快照 | 不成为作者真相 |

## 16. 推荐首发边界

首发链路：**选择已有字幕 → 应用倒鸭子 → 调动感和颜色 → 改文稿仍自动跟随 → 原生 / Web 预览 → 正式视频输出**。

必要能力：跨句世界、逐词出现、带提前量的正确镜头、输出时间投影、稳定随机、run clip 视口、字体一致性、撤销与共享导出。可延后：实例作用域与固定版式、3D、自由相机、AI 编舞、两轨同时运动、透明视频全格式导出。

最终守住一句话：用户换的是「字幕的表现形式」，不是进入另一个生成视频的软件。

---

## 核对来源

仓库来源固定于 `17e329814`；引用号沿用原提案。

- [R1] `core/README.md`；`core/crates/bcut-subtitle-render/src/lib.rs`。
- [R2] `core/crates/bcut-subtitle-render/src/{document,render_plan,transition}.rs`。
- [R3] `core/crates/bcut-subtitle-render/src/caption_recipe.rs`：`CaptionRecipeDescriptor`、`layoutTokens`、`caption_recipe_design_descriptor` 对未知 id 返回 `None`。
- [R4] `docs/changelog/core/2026-09-15-070821.md`：`cueStyles` 与 ASS sidecar 限制。
- [R5] `core/crates/bcut-editor-core/src/caption_registry.rs`：`payload()` 只写 schema / content / palette / intensity / speed / style，换配方保留其余键；`captionEmphasis` 读写。
- [R6] `core/crates/bcut-editor-core/src/{style_library,stylepane}.rs`；`bcut-subtitle-render/src/style_sync.rs`。
- [R7] `core/crates/bcut-timeline-render/src/scene.rs`：`SceneMotion::sample` 六分量插值、`post_concat_mat6`、`GlyphRunUniform.clip`、`GLYPH_RUN_UNIFORM_LIMIT = 1024`、`SCENE_NODE_LIMIT = 4096`。
- [R8] `core/crates/bcut-render/src/drawop.rs`：`ClipPath` / `PopClip`（v3）。
- [R9] `core/crates/bcut-timeline/src/schema.rs`；`bcut-subtitle-render/src/host_support.rs`。
- [R10] `core/crates/bcut-motion/src/{lib,program,value,interpolate}.rs`：`PropertyTrack` segments 不重叠；`InterpolatorSpec::{Linear, Step, Angle, Color}`。
- [R11] `apps/web/docs/subtitle-tab-redesign.md`。
- [R12] `core/crates/bcut-editor-core/src/edits.rs`；`AGENTS.md`。
- [R13] `apps/baocut/src/assets.rs`：`CAPTION_REGISTRY` / `CAPTION_STYLES` 内嵌画廊资源。
- [W1] TypeMonkey 产品说明 `https://aescripts.com/typemonkey/`：视觉范式参考。
- [W2] HarfBuzz clusters 文档 `https://harfbuzz.github.io/clusters.html`。
