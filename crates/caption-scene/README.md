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

`caption-text-context/1` 提供整段/分页字素索引、cue/page 时钟和 `sqrt`；grapheme 选择器可显式包含空白，用于连续光标与错开显现。示例见 [text-context.json](tests/fixtures/text-context.json)。

`caption-ink-context/1` 提供单元填充墨迹框 `layout.inkX/inkY/inkWidth/inkHeight` 与所属行的 `layout.lineInkY/lineInkHeight`；光标高度与底框位置可按真实字形求值，旧行框/advance 不变。空白继承行的视觉高度，重排同步更新；不包含描边、材质或动画变换。示例见 [ink-context.json](tests/fixtures/ink-context.json)。

`caption-unit-context/1` 提供稳定的 `unit.pageIndex/pageCount` 与所属行的 `time.lineElapsedSeconds/lineDurationSeconds`；行朗读状态遵循词时间及 gap/tail 策略。页序号在逐采样重排后保持不变，repeat 装饰继承所绑定单元，见 [unit-context.json](tests/fixtures/unit-context.json)。

`caption-wave-displace/1` 提供有界 cue 级正弦波纹位移，幅度/波长/相位支持动态值；以画布像素中心为基准，预乘双线性采样保留透明边界，不依赖播放历史。示例见 [wave-displace.json](tests/fixtures/wave-displace.json)。

`caption-soft-band/1` 提供单文字子树的画布归一化柔边遮罩，参数绑定明确文字节点的当前页上下文；同时提供页末词的输入时间及可用标记。静态/逐采样布局和反馈历史都使用共同的页解析路径。示例见 [soft-band.json](tests/fixtures/soft-band.json)。

`caption-word-line-layout/1` 提供循环词行配额和一次性的末页调整；行、页成员与时间冻结，超宽按 error/visible 处理。显示空白可折叠，源文本字素索引及词字节范围保持不变；逐采样布局重用同一shape映射。示例见 [word-line-layout.json](tests/fixtures/word-line-layout.json)。

`caption-cue-word-context/1` 提供 cue 首两词原始输入边界、真实绑定词标记与跨页下一词开始时间；保留负值、零值和真实 gap，不延长词结束，也不把 estimated 时序冒充输入。所有边界配有可用标记，见 [cue-word-context.json](tests/fixtures/cue-word-context.json)。

`caption-first-page-context/1` 提供固定第一页与当前页的真实首词/末词/下一原词输入边界及可用标记，按文字节点绑定继承，区别真实词结束与延长的页面显示窗口。见 [first-page-context.json](tests/fixtures/first-page-context.json)。

`caption-cue-unit-context/1` 显式启用整段词/行索引，以及由真实 word tags 驱动的静态词选集索引；碎片跨页保持源词身份，per-sample 全局行数按同一时刻重排所有页并计入预算。未绑定有明确 bool 标记，旧局部索引不变，见 [cue-unit-context.json](tests/fixtures/cue-unit-context.json)。

`caption-active-word-context/1` 让同一文字节点的所有单元读取当前页活动词的页内序号、已进行时长和窗口时长；窗口沿用 `speechState` 的保持策略并止于页显示结束，没有活动词时为 false/0。布局绑定不能读取，字号绑定可以。见 [active-word-context.json](tests/fixtures/active-word-context.json)。

`caption-line-neighbor-context/1` 让 word、grapheme 单元及其装饰读取同一视觉行内上一个词的布局矩形；行首词和其他单元为 false/0，布局与字号绑定都不能读取。见 [line-neighbor-context.json](tests/fixtures/line-neighbor-context.json)。

`caption-gaussian-axis/1` 与 `caption-glow-cascade/1` 提供单 Text 上下文的独立 RGBA 分量滤波：高斯采样按输入纹理 UV、多尺度 pass 按原画布有理比例定尺寸，明确边界及逐 pass gamma/量化。级联保留各尺度图，按声明的 screen 或 source-over-glow 合成；允许 RGB > alpha，须按视频格式 §5.6 使用关联输出。有效区域包含零 alpha 发光，采样与内存预算超限会拒绝。示例见 [gaussian-axis.json](tests/fixtures/gaussian-axis.json)、[glow-cascade.json](tests/fixtures/glow-cascade.json)。

`caption-text-line-layout/1` 用显式 Unicode scalar 或 extended grapheme 数限制每行，按完整词贪心分组并循环页计划；分隔空白不计，超长词独占行，显式换行强制成员边界。与其他分页策略互斥，复用固定词行的时间、几何与逐采样路径，见 [text-line-layout.json](tests/fixtures/text-line-layout.json)。

`caption-glyph-envelope/1` 提供不含 leading 的整行字体/墨迹垂直包络，以及源 cluster 顺序首/末墨迹横端点，附行绑定与范围墨迹可用标记。它不等同 advance 或墨迹 union，保留 RTL 逆序端点；repeat、逐采样排版和反馈共用结果，不改旧 bounds/像素。示例见 [glyph-envelope.json](tests/fixtures/glyph-envelope.json)。

`caption-page-envelope/1` 提供当前页的字体/字形垂直包络、实际最大字号、行数及可用标记。空白行保留字体度量，混合字号保留实际 run 字号；材质和所有绑定单元共享排版后结果，反馈按历史采样重算。这些字段禁止反向驱动布局或字号，见 [page-envelope.json](tests/fixtures/page-envelope.json)、[空白行夹具](tests/fixtures/page-envelope-whitespace.json)。

`caption-scalar-cluster-layout/1` 为 textLinePattern 增加显式规则的两轮 scalar-cluster 计数；只用于完整词分页配额，不改实际 glyph 整形。规则区间有严格 Unicode/数量验证，同一 TextLayout 所有词共享有界计数预算，见 [scalar-cluster-layout.json](tests/fixtures/scalar-cluster-layout.json)。

`caption-unit-font-size/1` 通过 `layout.fontSizeBindings` 在冻结 page/line/word 成员上求字号，完整映射文字与空白后调用共享 rich shaping；重叠规则按声明顺序 replace。要求 per-sample 和显式固定行布局，禁止字号读取其产出的布局几何，真实更新行宽、基线、ink/envelope，反馈历史也重新求值。示例见 [unit-font-size.json](tests/fixtures/unit-font-size.json)。

`caption-unit-font-reflow/1` 把 `fontSizeBindings` 开放给按宽度换行的页：页成员按基础字号冻结，每次采样按实际字号只对当前页重新折行，当前词放大可以把邻词挤到下一行再回来。重新折行的行没有稳定身份，line 选择器、按序号筛选的 word 选择器、line 时钟和行时间字段都被拒绝。见 [unit-font-reflow.json](tests/fixtures/unit-font-reflow.json)。

`caption-glow-tint/1` 允许 glow-cascade 可选 `glowTint` 颜色动态值：在级联聚合后、合成原图前仅乘发光 RGB，忽略 tint alpha，不影响原图或发光 alpha。省略为白，保持旧序列化及像素；复用同一文字节点的排版后页上下文与表达式预算。

`caption-noise-palette-mix/1` 在唯一文字节点的页上下文求值固定空间噪声与冻结 PNG 色条，保持输入 alpha；局部纹理 domain 必须显式给出画布坐标，不推断 ink/advance 范围。数值核、边界和预算见视频格式规范，示例见 [noise-palette-mix.json](tests/fixtures/noise-palette-mix.json)。

`caption-glow-color-matrix/1` 提供 glow-cascade 的可选静态 `glowColorMatrix`，以行优先 3×3 矩阵在 tint 后变换辉光 RGB，再 clamp 后合成。alpha 和原图不参与变换；省略/单位矩阵保持旧输出。

`caption-angular-sample-blend/1` 在显式局部domain内执行60次角采样，aspect独立、angle为弧度；透明越界仍使用固定分母，再按平均alpha混合原图。零角度不是恒等操作，读取/变换均计入共享预算。示例见 [angular-sample-blend.json](tests/fixtures/angular-sample-blend.json)。

`caption-gradient-smear/1` 提供固定128次梯度噪声方向采样，显式局部domain、UV纵向、噪声相对尺寸和有界静态octave参数；seed/evolution/stretch/progress/strength按页求值。保留独立RGBA与固定透明分母，超限失败，不降低质量。示例见 [gradient-smear.json](tests/fixtures/gradient-smear.json)。

`caption-page-window/1` 通过 `layout.pageWindow` 按相邻真实词的短/长 gap 分配固定页/行显示窗口，显式指定边界归属；不改原始词/字素时间。要求固定行、leadingGap hide 与正时长无重叠输入，重排继承窗口，反馈按时刻查询。示例见 [page-window.json](tests/fixtures/page-window.json)，需提供真实词时间。

`caption-bound-label/1` 提供 Repeat 直接子节点 `label`：静态单行内容用自己的字体整形，继承绑定单元时钟/布局；字号先求值，own advance/font/ink 度量只供后置 pose，直接或函数间接的字号循环均拒绝。复用字体缓存、缺字体登记、彩色字形与 paint 路径，不创建独立页或命中框，见 [bound-label.json](tests/fixtures/bound-label.json)。

`caption-unit-font-style/1` 通过 `layout.fontStyleBindings` 对固定page/line/word成员应用静态字体族、字重、斜体patch，与字号runs合并后整体rich shaping，真实更新行宽/基线。未活跃face也进入字体依赖清点，不推断关键词。示例见 [unit-font-style.json](tests/fixtures/unit-font-style.json)。

`caption-render-layers/1` 将根节点子树或 `caption-image-sequence/1` 的有界PNG序列拆成独立处理链，按数组顺序合成。`ScenePlan.render_outputs` 保留关联 source-over / screen；screen 必须直接合到真实背景，单图 render 明确拒绝。`caption-noisy-sweep/1` 提供固定f32噪声扫过遮罩。详见视频格式 §5.6；层间共享采样/表面预算，序列缓存与普通图片共享解码预算。
