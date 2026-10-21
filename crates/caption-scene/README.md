# caption-scene

动态字幕的持久合同、严格验证和确定性表达式求值，包含版本锁定的 PNG 资源与有序文字涂装。纯 Rust，无文件、网络、系统时钟或 UI 依赖；视频模型、共享渲染和 WASM 使用同一实现。

- 生效格式与当前执行能力：[视频格式 §5.6](../../docs/spec/video-format-spec.md#56-layoutprofile样式与导出)。
- 完整目标：[动态字幕格式设计](../../docs/design/subtitle/dynamic-caption-format-design.md)。
- 可运行样式：[word-pop.json](tests/fixtures/word-pop.json)、[image-paint.json](tests/fixtures/image-paint.json)。
- 验证入口：`parse_style`、`validate_presentation`；动态值入口：`infer`、`evaluate`、`sample_value`。
- 渲染入口：`subtitle_render::scene::ScenePlan`；由 `frame-render` 的新样式分支接入预览与导出。

`cargo test --locked -p caption-scene` 验证类型、单位、函数调用、关键帧、循环与数值语义。实际像素测试在 `subtitle-render/tests/scene.rs`，跨 native/WASM 夹具在 `frame-render/tests/fixtures/parity.json`。

离线生成示例帧：

```sh
cargo run --locked -p subtitle-render --no-default-features --features wasm-safe --example caption_scene -- /tmp/baocut-dynamic-caption-frames
```

该命令使用内存字体和共享 CPU 光栅器，在指定目录写六张 PNG；不需要启动编辑器。

在示例命令末尾添加 `--rich`，生成包含按词重复图片、线性渐变和描边的字幕帧。图片字节来自随示例维护的 PNG 夹具，并按场景声明的摘要校验。

`--feedback` 使用 [reflow-feedback.json](tests/fixtures/reflow-feedback.json)，演示逐采样行宽/字号、预乘模糊与有界历史拖尾。基础分页和时间保持固定，所有历史画面在请求时刻重新求值；额外写入深色背景的 preview PNG，便于检查透明边缘。

表达式 `cubic-bezier(progress, x1, y1, x2, y2)` 与关键帧共用 motion 曲线求解器，允许将语义时钟、单元时长和参数组合成连续曲线；能力名为 `caption-bezier-expression/1`。

`caption-exponential-expression/1` 提供 `exp(scalar) -> scalar`，以共享 `libm::exp` 连续求自然指数；支持负指数衰减，非有限输入或溢出结果明确拒绝。普通及 DAG 验证与直接求值都要求该能力，复用现有执行预算；可与 `sin/cos` 组合描述连续衰减振荡。

`caption-rounding-expression/1` 提供 `round`（半数远离零），`caption-modular-expression/1` 提供结果与除数同号的 `mod(a,b)` 与 `fract(x)=mod(x,1)`（零除数拒绝），`caption-power-expression/1` 提供 `pow`（负底数配非整数指数拒绝）；均只接受 scalar，与 `exp` 同样在两条类型路径和直接求值中检查能力。`caption-list-pick/1` 允许参数声明 `list: true`（1–256 个同类型元素，总计不超过 1024），只能经 `pick(params.<id>, index)` 按欧几里得取模读取；覆盖层整体替换列表。示例见 [builtin-expressions.json](tests/fixtures/builtin-expressions.json)。

`caption-clock-tail/1` 为关键帧 clock 开放 `tail: none|clamp|repeat`：`clamp` 在原点后取 `min(elapsed, D)/D`，`repeat` 取 `mod(elapsed, D)/D`，周期右端点归下一周期；`tail` 只定数值，参与仍由 `fill` 决定。不能与 `clock.repeat` 同用，零周期拒绝；省略即 `none`，旧文档字节不变。示例见 [clock-tail.json](tests/fixtures/clock-tail.json)。

`caption-speech-phase/1` 开放布尔 `cue.speechPhase.beforeFirst/reading/afterLast/estimated` 与 `word.inSpan`：cue 阶段按全部非空输入词的最早开始与最晚结束划分，词间空隙算 reading；`word.inSpan` 按绑定词 `start<=t<end`，重叠词可同时为真，不改变 active/read/unread 的唯一选择。缺真实词时间时默认全为 false 并提示 `CAPTION_TIMING_UNAVAILABLE`，显式 estimated 以 cue 起止为区间并标记估算。布局前与字号求值禁止读取。示例见 [speech-phase.json](tests/fixtures/speech-phase.json)。

`caption-text-context/1` 提供整段/分页字素索引、cue/page 时钟和 `sqrt`；grapheme 选择器可显式包含空白，用于连续光标与错开显现。示例见 [text-context.json](tests/fixtures/text-context.json)。

`caption-ink-context/1` 提供单元填充墨迹框 `layout.inkX/inkY/inkWidth/inkHeight` 与所属行的 `layout.lineInkY/lineInkHeight`；光标高度与底框位置可按真实字形求值，旧行框/advance 不变。空白继承行的视觉高度，重排同步更新；不包含描边、材质或动画变换。示例见 [ink-context.json](tests/fixtures/ink-context.json)。

`caption-unit-context/1` 提供稳定的 `unit.pageIndex/pageCount` 与所属行的 `time.lineElapsedSeconds/lineDurationSeconds`；行朗读状态遵循词时间及 gap/tail 策略。页序号在逐采样重排后保持不变，repeat 装饰继承所绑定单元，见 [unit-context.json](tests/fixtures/unit-context.json)。

`caption-wave-displace/1` 提供有界 cue 级正弦波纹位移，幅度/波长/相位支持动态值；以画布像素中心为基准，预乘双线性采样保留透明边界，不依赖播放历史。示例见 [wave-displace.json](tests/fixtures/wave-displace.json)。`caption-wave-context/1` 允许可选 `contextNodeId` 指向唯一 Text，三个动态值改在该节点当前页排版后求值，可按页尺寸定义波长、幅度和相位原点；无当前页输出透明。

`caption-soft-band/1` 提供单文字子树的画布归一化柔边遮罩，参数绑定明确文字节点的当前页上下文；同时提供页末词的输入时间及可用标记。静态/逐采样布局和反馈历史都使用共同的页解析路径。示例见 [soft-band.json](tests/fixtures/soft-band.json)。

`caption-word-page-layout/1` 用 `wordPagePattern` 固定每页语义词成员，页内保留宽度折行与超长词字素折行。行数只控制 error/visible 溢出，不额外分页；实际字号重排不改变页成员与时间。合同测试见 [word_page_layout.rs](tests/word_page_layout.rs)。

`caption-word-line-layout/1` 提供循环词行配额和一次性的末页调整；行、页成员与时间冻结，超宽按 error/visible 处理。显示空白可折叠，源文本字素索引及词字节范围保持不变；逐采样布局重用同一shape映射。示例见 [word-line-layout.json](tests/fixtures/word-line-layout.json)。

`caption-pattern-select/1` 的 `pagination.patternSelect` 在准备阶段按文字节点词数闭区间（末项为兜底）或按实例 seed 与 cue id 从候选固定词行模式中选一个，结果只依赖冻结输入，并以 `CAPTION_PATTERN_SELECTED` 诊断报告。示例见 [pattern-select.json](tests/fixtures/pattern-select.json)。

`caption-keyword-isolation/1` 的 `pagination.isolation` 按 `wordTags` 在固定词行分组前插入硬边界：`line` 让词独占一行，`page` 让词独占一页；边界只缩短行和页，不放宽配额，不与 `lastPageRule` 同用。示例见 [keyword-isolation.json](tests/fixtures/keyword-isolation.json)。

`caption-cue-word-context/1` 提供 cue 首两词原始输入边界、真实绑定词标记与跨页下一词开始时间；保留负值、零值和真实 gap，不延长词结束，也不把 estimated 时序冒充输入。所有边界配有可用标记，见 [cue-word-context.json](tests/fixtures/cue-word-context.json)。

`caption-first-page-context/1` 提供固定第一页与当前页的真实首词/末词/下一原词输入边界及可用标记，按文字节点绑定继承，区别真实词结束与延长的页面显示窗口。见 [first-page-context.json](tests/fixtures/first-page-context.json)。

`caption-cue-unit-context/1` 显式启用整段词/行索引，以及由真实 word tags 驱动的静态词选集索引；碎片跨页保持源词身份，per-sample 全局行数按同一时刻重排所有页并计入预算。未绑定有明确 bool 标记，旧局部索引不变，见 [cue-unit-context.json](tests/fixtures/cue-unit-context.json)。

`caption-active-word-context/1` 让同一文字节点的所有单元读取当前页活动词的页内序号、已进行时长和窗口时长；窗口沿用 `speechState` 的保持策略并止于页显示结束，没有活动词时为 false/0。布局绑定不能读取，字号绑定可以。见 [active-word-context.json](tests/fixtures/active-word-context.json)。

`caption-line-neighbor-context/1` 让 word、grapheme 单元及其装饰读取同一视觉行内上一个词的布局矩形；行首词和其他单元为 false/0，布局与字号绑定都不能读取。见 [line-neighbor-context.json](tests/fixtures/line-neighbor-context.json)。

`caption-line-box-context/1` 让 line 单元及该行的 word、grapheme、空白单元和它们的装饰读取所属视觉行的行框 `layout.lineBoxX/Y/Width/Height`；page、cue 为 0，布局与字号绑定都不能读取。见 [line-box-context.json](tests/fixtures/line-box-context.json)。

`caption-page-line-context/1` 让同一文字节点的所有单元按页内行号读取当前页各行：`layout.pageLineBoxX.<k>`、`layout.pageLineBoxWidth.<k>` 是第 k 行的行框，`unit.pageLineGraphemeCount.<k>` 是该行非空白字素数；k 小于 maxLines 且小于 16，超出实际行数读 0。行框只能在绘制阶段读取，字素数还可用于字号绑定。见 [page-line-context.json](tests/fixtures/page-line-context.json)。

`caption-page-tag/1` 开放 `pagination.pageTags`：与 `wordLinePattern` 等长、每项 0–65535 的整数列表，第 p 页读第 p mod n 个标签；每种单元读 `unit.pageTag`（scalar），字号绑定也可读取。没有 `wordLinePattern` 或长度不等时拒绝，核心不解释标签。见 [page-tag.json](tests/fixtures/page-tag.json)。

`caption-shape-paint/1` 让 shape 节点用 `fillPaint` 填充：`solid` 或 `linear`，渐变 from/to 是 shape 实际绘制矩形（宽高姿态之后、节点变换之前）的归一化坐标。只用于 shape，不能与 `fill` 属性或 fill 动画同用；节点 opacity 只作用一次。见 [shape-paint.json](tests/fixtures/shape-paint.json)。

`caption-line-unit-quota/1` 开放 `pagination.maxUnitsPerLine`：按宽度换行的页里一行最多取这么多词，下一个词会超宽时仍提前换行，页仍按 `maxLines` 收行；与固定行模式互斥。见 [line-unit-quota.json](tests/fixtures/line-unit-quota.json)。

`caption-word-line-tail-join/1` 开放 `pagination.tailWordRule: 'join-previous-line'`：固定词行模式下，未填满的末页若最后一行只有一个词，该词并入前一行（可以是上一页的最后一行）；与 `lastPageRule` 互斥。见 [word-line-tail-join.json](tests/fixtures/word-line-tail-join.json)。

`caption-remaining-word-page-plan/1` 开放 `pagination.remainingWordPagePlans`：按还没分页的词数查表，第 i 项是剩余 i 个词时下一页的行词数，超过表长用最后一项；第 i 项最多 i 个词，页总是取满。行成员按固定词行冻结，与其他分页字段互斥。见 [remaining-word-page-plan.json](tests/fixtures/remaining-word-page-plan.json)。

`caption-fixed-line-wrap/1` 开放 `pagination.fixedLineOverflow: 'wrap'`：固定行比行宽宽时在行内按宽度续到下一显示行，行、页成员和时间不变；line 单元按显示行计，与 `fontSizeBindings`、`fontStyleBindings`、`pageWindow` 互斥。见 [fixed-line-wrap.json](tests/fixtures/fixed-line-wrap.json)。

`caption-fixed-line-fit/1` 开放 `pagination.fixedLineFit`：每页固定行按基础字号量宽，各行放大到最宽行宽（末行窄于 `lastLineWidthRatio` 时最多放大 `lastLineMaxScale`），行高随行字号变化并加 `extraLineHeight` / 页最大缩放；行仍是一条显示行，与 `fixedLineOverflow`、`fontSizeBindings`、`fontStyleBindings` 互斥。见 [fixed-line-fit.json](tests/fixtures/fixed-line-fit.json)。

`caption-gaussian-axis/1` 与 `caption-glow-cascade/1` 提供单 Text 上下文的独立 RGBA 分量滤波：高斯采样按输入纹理 UV、多尺度 pass 按原画布有理比例定尺寸，明确边界及逐 pass gamma/量化。级联保留各尺度图，按声明的 screen 或 source-over-glow 合成；允许 RGB > alpha，须按视频格式 §5.6 使用关联输出。有效区域包含零 alpha 发光，采样与内存预算超限会拒绝。示例见 [gaussian-axis.json](tests/fixtures/gaussian-axis.json)、[glow-cascade.json](tests/fixtures/glow-cascade.json)。

`caption-text-line-layout/1` 用显式 Unicode scalar 或 extended grapheme 数限制每行，按完整词贪心分组并循环页计划；分隔空白不计，超长词独占行，显式换行强制成员边界。与其他分页策略互斥，复用固定词行的时间、几何与逐采样路径，见 [text-line-layout.json](tests/fixtures/text-line-layout.json)。

`caption-glyph-envelope/1` 提供不含 leading 的整行字体/墨迹垂直包络，以及源 cluster 顺序首/末墨迹横端点，附行绑定与范围墨迹可用标记。它不等同 advance 或墨迹 union，保留 RTL 逆序端点；repeat、逐采样排版和反馈共用结果，不改旧 bounds/像素。示例见 [glyph-envelope.json](tests/fixtures/glyph-envelope.json)。

`caption-page-envelope/1` 提供当前页的字体/字形垂直包络、实际最大字号、行数及可用标记。空白行保留字体度量，混合字号保留实际 run 字号；材质和所有绑定单元共享排版后结果，反馈按历史采样重算。这些字段禁止反向驱动布局或字号，见 [page-envelope.json](tests/fixtures/page-envelope.json)、[空白行夹具](tests/fixtures/page-envelope-whitespace.json)。

`caption-scalar-cluster-layout/1` 为 textLinePattern 增加显式规则的两轮 scalar-cluster 计数；只用于完整词分页配额，不改实际 glyph 整形。规则区间有严格 Unicode/数量验证，同一 TextLayout 所有词共享有界计数预算，见 [scalar-cluster-layout.json](tests/fixtures/scalar-cluster-layout.json)。

`caption-unit-font-size/1` 通过 `layout.fontSizeBindings` 在冻结 page/line/word 成员上求字号，完整映射文字与空白后调用共享 rich shaping；重叠规则按声明顺序 replace。要求 per-sample 和显式固定行布局，禁止字号读取其产出的布局几何，真实更新行宽、基线、ink/envelope，反馈历史也重新求值。示例见 [unit-font-size.json](tests/fixtures/unit-font-size.json)。

`caption-unit-font-reflow/1` 把 `fontSizeBindings` 开放给按宽度换行的页：页成员按基础字号冻结，每次采样按实际字号只对当前页重新折行，当前词放大可以把邻词挤到下一行再回来。重新折行的行没有稳定身份，line 选择器、按序号筛选的 word 选择器、line 时钟和行时间字段都被拒绝。见 [unit-font-reflow.json](tests/fixtures/unit-font-reflow.json)。

`caption-glow-tint/1` 允许 glow-cascade 可选 `glowTint` 颜色动态值：在级联聚合后、合成原图前仅乘发光 RGB，忽略 tint alpha，不影响原图或发光 alpha。省略为白，保持旧序列化及像素；复用同一文字节点的排版后页上下文与表达式预算。

`caption-noise-palette-mix/1` 在唯一文字节点的页上下文求值固定空间噪声与冻结 PNG 色条，保持输入 alpha；局部纹理 domain 必须显式给出画布坐标，不推断 ink/advance 范围。数值核、边界和预算见视频格式规范，示例见 [noise-palette-mix.json](tests/fixtures/noise-palette-mix.json)。

`feedback` 默认按 decay 的 i 次方从旧到新 source-over 合成；声明 `caption-feedback-mean/1` 后可写 `composite:"mean"`（decay 必须为 1），对落在 cue 内的历史样本做预乘 RGBA 等权平均（整数四舍五入，cue 外样本不计入分母），用于有界运动模糊；省略 composite 的旧文档不变。示例见 [feedback-mean.json](tests/fixtures/feedback-mean.json)。

`caption-noise-displace/1` 的 `noise-displace` 在唯一文字节点页上下文与显式 domain 内，以固定 v1 空间噪声 `n0=noise(uv*noiseScale, phase)` 求 `n=(n0+brightness-0.5)*contrast*10+0.5`、`d=(n-0.5)*strength*width/height`，把 `uv+(d,d)` 处的输入做预乘双线性采样，画面外透明、domain 外清零；仅 CPU 执行，GPU 材质计划显式返回不支持。示例见 [noise-displace.json](tests/fixtures/noise-displace.json)。

`caption-glow-color-matrix/1` 提供 glow-cascade 的可选静态 `glowColorMatrix`，以行优先 3×3 矩阵在 tint 后变换辉光 RGB，再 clamp 后合成。alpha 和原图不参与变换；省略/单位矩阵保持旧输出。

`caption-glow-linear/1` 把 glow-cascade 扩到 1–8 级，并开放 `gammaChannels: rgba`（每个 pass 连 alpha 一起做 gamma）、`aggregation: linear`（各级解码到线性域后按静态 `levelGains` 做 screen 累积，再乘强度、编码回去）、可选 `levelColor`（按级 alpha 换成指定颜色，无值时不着色）和 `original-over-screen` 合成。旧文档省略这些字段，序列化与像素不变；GPU 材质计划明确拒绝这些字段，由 CPU 光栅执行。示例见 [glow-linear.json](tests/fixtures/glow-linear.json)。

`caption-angular-sample-blend/1` 在显式局部domain内执行60次角采样，aspect独立、angle为弧度；透明越界仍使用固定分母，再按平均alpha混合原图。零角度不是恒等操作，读取/变换均计入共享预算。示例见 [angular-sample-blend.json](tests/fixtures/angular-sample-blend.json)。

`caption-gradient-smear/1` 提供固定128次梯度噪声方向采样，显式局部domain、UV纵向、噪声相对尺寸和有界静态octave参数；seed/evolution/stretch/progress/strength按页求值。保留独立RGBA与固定透明分母，超限失败，不降低质量。示例见 [gradient-smear.json](tests/fixtures/gradient-smear.json)。

`caption-page-window/1` 通过 `layout.pageWindow` 按相邻真实词的短/长 gap 分配固定页/行显示窗口，显式指定边界归属；不改原始词/字素时间。要求固定行、leadingGap hide 与正时长无重叠输入，重排继承窗口，反馈按时刻查询。示例见 [page-window.json](tests/fixtures/page-window.json)，需提供真实词时间。

`caption-bound-label/1` 提供 Repeat 直接子节点 `label`：静态单行内容用自己的字体整形，继承绑定单元时钟/布局；字号先求值，own advance/font/ink 度量只供后置 pose，直接或函数间接的字号循环均拒绝。复用字体缓存、缺字体登记、彩色字形与 paint 路径，不创建独立页或命中框，见 [bound-label.json](tests/fixtures/bound-label.json)。

`caption-unit-font-style/1` 通过 `layout.fontStyleBindings` 对固定page/line/word成员应用静态字体族、字重、斜体patch，与字号runs合并后整体rich shaping，真实更新行宽/基线。未活跃face也进入字体依赖清点，不推断关键词。示例见 [unit-font-style.json](tests/fixtures/unit-font-style.json)。

`caption-render-layers/1` 将根节点子树或 `caption-image-sequence/1` 的有界PNG序列拆成独立处理链，按数组顺序合成。`ScenePlan.render_outputs` 保留关联 source-over / screen / add（add 需 `caption-layer-add/1`，四分量 `S+D` 钳制，示例 [layer-add.json](tests/fixtures/layer-add.json)）；screen 与 add 必须直接合到真实背景，单图 render 明确拒绝。`caption-noisy-sweep/1` 提供固定f32噪声扫过遮罩。详见视频格式 §5.6；层间共享采样/表面预算，序列缓存与普通图片共享解码预算。

`caption-paint-coverage/1` 通过 paint 层 `coverage: {lo, hi}` 对模糊后的轮廓覆盖率做线性区间重映射，再应用颜色/实例透明度。支持纯色、node-fill 和不透明渐变；零模糊可用于抗锯齿边缘，省略保留旧路径。严格范围、隔离 run 与表面预算见视频格式 §5.6；像素验证在 `subtitle-render/tests/scene.rs`。

`caption-gradient-space/1` 支持 linear paint 的 `space: normalized`（在归一化 UV 域投影）和 `domain: page`（当前页各行共用基础视觉框）。默认 local/line 保持旧端点、序列化和像素行为；任意色标与现有隔离/覆盖率路径共用。共享渲染把 UV 协向量转换成同一 CPU/GPU `PaintData::Linear`，详见视频格式 §5.6。

`caption-gradient-glyph/1` 支持 linear paint 的 `domain: glyph`：每个字形以自身轮廓控制框为域，可用 `glyphOutset`（该字形解析字号的 em，每侧，0–4，默认 0 省略）向四边外扩；同一字形的各涂装层（含 spread/stroke/offset 层与图片 base）共用此域，所以每个字形各自走完整色带。与 `space: normalized` 组合时两个能力都要声明。详见视频格式 §5.6。

`caption-font-line-box/1` 显式开启 `style.lineBox`，按实际字形 face/字号的字体度量和可选 em 下限生成行框，保留词/页成员和时钟；typographic 可通过显式 glyph probe 选择 hhea fallback。静态、固定行、字号重排与 Label 共用测量，省略维持旧路径；完整数值合同见视频格式 §5.6。

`caption-affine-sample-blend/1` 定义必填输入 ROI／输出 quad 与有界归一化 UV 仿射路径。样本数由端点 UV 距离决定，沿等距控制点分段插值，等权平均独立 RGBA；没有矩阵或域缺值回退。合同、边界和预算见视频格式 §5.6；共享 CPU reference 与 GPU 有序链使用同一排版后参数，GPU 无法可靠处理的精度／源操作在提交前明确回退完整 CPU 场景。

`caption-font-hinting/1` 开放 Text/Label 的 `style.fontHinting: "none"`，同一实际字形在轮廓与atlas路径关闭hinting，保留整形/advance/分页语义；缺省保持旧行为。策略隔离glyph cache key，不修改基础shape缓存。可解析的glyf/gvar及标准非CID CFF1使用浮点设计轮廓，其他格式保留既有unhinted scaler；字体provider与整形分段需另外声明。

`caption-font-shaping/1` 开放 Text/Label 的 `style.fontShaping: "nominal"`，在解析字体段内按Unicode scalar映射字形，不跨scalar做OpenType kern／ligature；advanced缺省保持旧行为。测量、分页、富文本字号重排和Label共用策略，独立于hinting。

`caption-image-phase-float32/1` 允许图片phase显式选择float32索引转换／输入偏移／除法／fract；缺省保持整数余数与f64相位。它不改变逻辑scalar索引归属，独立于UV仿射矩阵的计算精度。
