> 移植自 BaoCut v2；文中的数据模型名（timeline.json、Element、Source / Clip / Cut 等）指 v2 的模型，与 v3 序列、轨道、实例的对应见[元素模型对照](element-model-mapping.md)与[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# 19. Product Timeline（`timeline.json`）规范

> 出自 [BaoCut 动画合成格式（BCF）技术规范](../baocut-format-spec.md)

> **规范状态**：生产契约。当前 `bcutTimeline` 为 `0.12`（写出一律 `0.12`，读取兼容 `0.1/0.2/0.3/0.4/0.5/0.6/0.7/0.8/0.9/0.10/0.11`）；字段扩展须遵循封闭 schema 与显式升版。

## 19.1 文档与两层模型

`timeline.json` 是产品项目剪辑域唯一真相，版本字段为 `"bcutTimeline":"0.12"`。
顶层字段封闭为 `sources`、`clips`、`tracks`、`main`、`template`；未知字段必须拒绝。最小合法文档：

```json
{"bcutTimeline":"0.12"}
```

文件尚未创建时采用缺省时间轴。为兼容旧版撤销把「文件不存在」恢复为零字节
文件的历史数据，项目读取与渲染也将空文件或纯空白内容按缺省时间轴处理；
只读打开不修写文件。此兼容不放宽 JSON schema，非空的损坏 JSON 仍然报错。

**版本语义（ADR-E02，零迁移）**：`0.1` 是 shape / sticker / visualizer / progress 四种元素
转正之前的文档，不含任何新字段，因此不存在迁移脚本——读取期在反序列化入口（所有读者的
唯一入口）把 `"0.1"` / `"0.2"` / `"0.3"` / `"0.4"` / `"0.5"` / `"0.6"` / `"0.7"` / `"0.8"` / `"0.9"` / `"0.10"` / `"0.11"` 原地替换为 `"0.12"`，不含新字段的文档升版后序列化输出与旧版只差版本
字符串。未知版本字符串原样保留、由语义校验报不支持，不在解析期吞掉。`bcut migrate` 只服务
BCF 文档（§4/§16 的 `bcut: 0.1 → 0.2`），与 Timeline 版本无关。

- `sources.<srcId>.cuts[]` 是源时间 `[t0,t1)` 上的无损假删除集合，按 `t0` 排序且互不
  重叠；写入时将相交或间距不超过 `0.02s` 的区间合并并保留较早 id。`main` 条目只能
  含 `cuts`，媒体身份仍唯一来自 `project.json.media`；`"main"` 这个源 id 保留的是
  **转写源身份**（源时钟、`cuts`、`transcription.audioSource`），不是画面或声音的特权——
  引用它的视频元素与引用附加源的元素在轨上完全平等；附加源保存 `path/hash/kind/
  duration/naturalW/naturalH/hasAudio/poster` 与自己的 `cuts`。`kind` 封闭
  `video|image|audio|lottie`（0.7 起加 `lottie`：bodymovin JSON 动画，`duration` 取
  `(op-ip)/fr` 秒、`naturalW/H` 取 `w/h`、`hasAudio` 恒 `false`，子图按 JSON 所在目录
  解析）；`lottie` 源只能被资产贴纸引用——不能做主轨 clip，也不能做 `image` /
  `video` / `audio` / `placeholder` 元素的 `srcId`，校验期直接报错。
- 附加源可选 `origin` 与 `provenance`（0.11 新增，缺席即不写出）：`origin` 封闭 `ai`，
  表示这条源是 BaoCut 生成的（第一个写入方是图像生成，见
  [图像生成设计 §7.5](../../image/bcut-image-generation-design/07.md#75-记录与素材落点)），
  界面据此给素材卡出 ✦ 徽标；`provenance` 是非空字符串，指向同名出处侧车（`<图>.json`，
  `{"kind":"image-gen","v":1,…}`，结构见 `bcut_image::ImageProvenance`），路径写法与
  `path` 相同。两者只是出处标注：解析、渲染、取帧与导出都不读它们，侧车缺失或读不懂
  也不报错；`origin` 不在闭集、`provenance` 为空串在校验期报错。
- `clips[]` 是主轨有序编排；每项只存 `{id, srcId="main", in, out, rate=1}`，其中
  `in/out` 是源时间，时间轴位置由有效视图时长的前缀和派生。clip 删除是真删除，撤销
  由 `.bcut/history` journal 承担。无显式 clips 时，**未分离**文档的隐式单 clip 覆盖主媒体
  全长。**旧式文档**的判定只有一条：`main.detached` 为 false 且有主轨片段（显式 `clips[]`
  或上述隐式 clip）；只有旧式文档才把主轨当作画面与声音的载体，其余文档的主轨只是字幕的
  源时钟（见下文 `detached`）。
  空白项目没有主媒体（`project.json.media` 为 `null` 或缺席），源时长为 0：不创建零长度
  隐式 clip，投影的 clips 为空；首次插入附加源也不先写入空 clip。显式无效片段或被 cuts
  全部扣除的片段仍然报错。**开放式项目**＝没有主轨片段也没有主媒体：没有片尾可以截断
  元素或播放头，内容时长完全由元素撑出（编辑器标尺在内容尾之后固定多留 10 秒空尾，
  只是展示口径，不落盘）。
- `tracks[]` 叠放顺序即数组序，kind 封闭为 `overlay|audio`。元素 kind 封闭为 12 值
  `text|image|video|audio|shape|sticker|visualizer|progress|draw|placeholder|confetti|whiteboard`（封闭枚举：未知 kind 在
  解析期报错，不做 open enum——静默渲染成空会让「我加的形状不见了」成为常态）；
  `audio` 元素只能落在 `audio` 轨，其余十一种只能落在 `overlay` 轨。带 props 的七种元素
  各带一个与 kind 同名的 props 子对象（§19.3）。时间接受时间轴秒或
  `~<srcId>:<wordId>[:start|:end][±offset]`；媒体元素只通过 `srcId` 引源，不接受裸路径。
  `place` 承载归一化几何（位置/缩放/旋转/不透明度/圆角），0.2 起增加 `flipX` / `flipY`
  ——**镜像是几何不是外观**（ADR-E01），归 `place` 而不是无 schema 的 `style`；不含镜像
  的旧文档序列化后与 0.1 逐字节相同。0.3 的 `cornerRadii {topLeft,topRight,bottomRight,bottomLeft}`
  优先于兼容 shorthand `radius`，四值均为非负有限数。
  编辑器面板的「几何」段（钉点 + X / Y / W / H，见
  [元素几何面板设计稿](../../elements/bcut-element-geometry-panel-design.md)）只是 `place` 的**投影**：
  钉点不落盘，面板读数由 `bcut-editor-core::geometry_panel` 按渲染盒现算，提交时换算回
  `place.x/y/w/scaleY`；文本元素的纵向钉点就是既有 `verticalAlign`。落盘契约不变。
- `role:"watermark"` 的图片元素可用 `source:"file"|"html"` 记录编辑来源；
  `source:"html"` 时可同时保存原始 `html` 片段。两者只是编辑 provenance，播放/导出
  始终消费 `srcId` 指向的一次性光栅图片；非图片元素不得携带 `source/html`，有 `html`
  时 `source` 必须为 `"html"`。
- `main` 含归一化 `place`、`muted`、`background: blur|black|#RRGGBB`（0.12 起接受纯色，见 §19.3「关键帧、纯色画布与闪避」）与可选 `detached`（缺省 false）。`detached: true` 表示视频画面与声音已转为普通 `kind: video` 元素；旧底片必须同时保持 `muted: true`、`place.opacity: 0`，校验拒绝重新启用。`clips` 仍承担源时间与字幕 OUTPUT 时间映射，不能用删除普通视频反向删除字幕。画布尺寸不落盘。
  分离文档（以及没有主轨片段的任何文档）**不再从 `clips[]` 派生画面语义**，三条口径统一如下（规范实现是 `bcut-timeline` 的 `rules` 模块，App / Web / 导出 / 配音落位读同一份）：
  - **成片长度**只由元素的显式 `end` 决定（取最大值；没有元素就是 0），不被 `clips[]` 源时钟撑到原片长度；只有旧式文档才取「剪后主轨片段 ∪ 元素区间」。
  - **原声**由每个 `kind: video` 元素自己承载（不分 `srcId` 与轨；源 `hasAudio: false` 的除外），静音逐元素写 `muted`；`main.muted` 只在旧式文档读写。
  - **分割**、导出的「按片段」范围、原声泳道的显示，都只看视频元素；旧式文档才按主轨 clips 计。
- App / Web 的编辑投影对旧视频项目按当前 clips 的 kept segments 生成普通视频元素，保留源、源起点、OUTPUT 起止、rate、静音和几何，非等比 `main.place.scaleY` 转为普通元素的相对竖向倍率。初始画面按源比例 contain 到画布，元素可独立移动、复制、删除和编辑完整视频属性；旧底片与其选中 UI 不再出现。只读投影不落盘，首次元素/元素轨编辑在同一事务中持久化转换及 `detached`，撤销恢复后仍可从旧文档确定性重建；已转换文档即使删光视频也不再生成。App / Web 的源 cut / clip 专属写入不主动转换，字幕源时间工作流继续保留；**命令行**（`clip *`、`cut *`、`element *` 等经 `mutate_timeline` 的写入）对视频项目的每一次时间轴写入先在同一事务里做同一套分离（`detach_video`，幂等），落盘的一律是分离文档；纯音频项目与没有主媒体的项目没有可分离的画面，保持原样。转换后的普通元素按其 OUTPUT 时间独立编辑。
- **元素跟随时钟**（1.283.0 起，规范实现 `bcut_timeline::follow_clock`）：`clips[]` 与 `sources.<id>.cuts` 仍是时钟的唯一真相，画面与声音只在元素上。凡是改变投影的写入（内核操作表的 `cutRange` `cutWords` `restoreCut` `retimeCut`（1.303.0 起） `addClip` `splitClip` `moveClip` `trimClip` `removeClip`，命令行的 `cut add / restore / detect --apply / match --apply`、`clip add / split / move / trim / set / remove`、`source remove --yes` 级联删片段，以及清理项接受 / 恢复），在同一个写事务里按下面四条把元素改到位，一步撤销一起退回；每一项以**这一项之前**的文档为基准：
  1. **片段的画面**：操作之前的**分离**文档里，`kind: video`、`role` 不是 `broll` / `watermark`、不在 `audio` 轨、`srcId` 与某个片段相同、`rate` 相等、`[start,end)` 落在该片段投影出的某一段之内且与源同步（`srcStart` 等于该段在 `start` 处的源时刻）的元素，归属于那个片段；容差是 `COMPOSE_EPS`（`1e-3` 秒，与 `compose_assignments` 同一个常量）。逐段判，不要求碎片齐全，也不要求一件铺满整段——跟随本身不合并碎片，恢复剪口后一段里可以有两件。被挪开（不再与源同步）或跨段的不算，按第 3 条处理。旧式文档没有片段画面。补一档**陈旧画面**（旧版本在分离文档上剪口时画面不跟留下的）：同样的条件改对片段**不计剪口**的时钟（清掉全部剪口后的投影）判，整件对得上、对不上折叠后的任何一段、且该片段一件跟得上的画面都没有，也归属于它，在下一次改时钟的写入里按第 2 条收到操作后的各段（等于补放历史剪口）；不改时钟的写入不碰它，修好之前不进 `picture_assignments`，`bcut check` 报 warning `picture-not-following-cuts`（规范实现 `bcut_timeline::stale_pictures`）。
  2. **片段画面随片段**：对操作之后的每一段投影（片段 c、源区间 `[a,b)`），取归属于 c（分割出的新片段沿用母片段的归属）且源区间与之相交的画面，各自收到交集上；只有**这次操作新露出**的源区间才补——由前一件延长，段首由后一件向前补，跨过旧空当的整段新区间照邻件复制一件——不自动合并相邻两件，不补用户原本留出的空当。每件保留自身全部属性；同一件被分到多段时源时间最靠前的保留原 id，其余取新 id（`el-N`）。整件落在剪掉或删掉的范围里的删除。新加的片段按分离缺省新建一件画面；原本没有画面（用户删过）的片段不补。
  3. **其它按数字时间放的元素**：起点与终点各自按「操作前的成片时刻 → 所在片段与源时刻 → 操作后的成片时刻」换算；落在被去掉的范围里时起点推到后面第一个保留的时刻、终点退到前面最后一个保留的时刻，换算后 `end ≤ start` 的删除。自带源的元素（B-roll、配乐）起点被推后时 `srcStart` 按 `rate` 同步前移；跨过剪口的只缩短、不挖洞；超出内容末尾的部分保持到末尾的距离。`clip move` 例外：只有起止都落在同一个片段里的元素跟着那个片段走，跨片段的留在原地。`clip split` 不改时钟，压在分割点上的元素在分割点切成两件。这一条对旧式文档同样生效。
  4. 词锚点（`~词`）与不设 `end` 的元素不动，它们本来就经投影求值。

  跟随在写事务的提交咽喉处把关：时钟（片段与各源剪口）变了却没有跟随的写入以 `internal` 拒绝，不落盘。整体替换时钟的写入（`replaceTimeline` `patchTimeline` `putSource` `setMain`）由调用方给出完整新真相，不做跟随。跟随的结果进回执：`{removed:[id…], created:[{id, from?, clipId?}…], retimed:N}`（命令行各命令的 `follow`、`edit_apply` 的 `applied[i].follow` 与合计 `EditApplied.follow`）。片段画面的归属（第 1 条同一份判定，`bcut_timeline::picture_assignments`）同时供 `clip list` 的 `elements`、`element list` 的 `clipId` 与导出 `--seam-fade-ms` 的剪缝判定使用。
- 可选 `main.sourceDuration`（0.10 新增，正有限数）记分离文档里普通视频元素所对齐的主源时长：转换时写入；读取时若主源时长变了（动画项目的主源是现场合成，改稿重渲一次就变），`srcId: "main"` 且源末端（`srcStart + (end − start) × rate`，只认秒数写法）正好落在记录值上的 `kind: video` 元素把 `end` 跟到新末端，剪短过的不动，再把记录刷成当前值。这是读时归一化（同副本源并回 `main`），不写盘，下一次时间轴写事务一并落盘；记录随文档进历史，撤销回旧文档再读也按当时的记录对账。缺席视为老文档：不跟随，读到即记下当前值。主源时长不是正有限值（无主媒体、合成未算出）时不对账也不改记录。规范实现 `bcut_timeline::video_elements::follow_main_duration`，入口 `ProjectTimeline::load`。
- 普通元素按声明层序合成，字幕叠在普通视频及其它普通元素上方，模板装饰前景最后合成；CPU 与 GPU / WASM 保持同序。转换后的全幅视频不会遮住字幕。

完整字段集、动画 preset 与数值边界由 `bcut spec` 的 `timelineSchema` 自描述；Rust
`bcut-timeline` 的反序列化与语义校验是规范实现。

## 19.2 三个时钟与规范映射

源时间是媒体文件时钟；视图时间是每个源折叠 cuts 后的连续时钟；时间轴时间是 clips
按数组序拼接后的输出时钟。时间轴上不存在 cut 段。

```
viewTime(src,t) = t - Σ dur(完全位于 t 前的 cut)   // t 在 cut 内则无映射
srcTime(src,v,bias)                                // seam: preceding|following
clipDuration(c) = Σ dur(kept ∩ [in,out)) / rate
tlStart(i) = Σ clipDuration(clips[0..<i])
tlTime(src,t) = tlStart(c) + keptOffset(c,t) / rate
```

cut 是半开区间。折叠 seam 上，UI 停留用 `preceding`，向前播放/导出用 `following`。
同一源区间可被多个 clip 复用，因此源到时间轴映射返回 `0..N` 个结果并保持 clip 声明
序；词锚点 0 个命中报 `word-anchor-unmapped`，多个命中报
`word-anchor-ambiguous`。字幕/元素事件先与 `kept ∩ clip` 逐段求交，输出不足 `10ms`
的片段丢弃，不能用首末保留点把中间 cut 桥接起来。映射结果按输出 fps 对齐帧网格，
相邻段缝合容差为 `1µs`。

跨端必须消费 [`core/fixtures/timeline-map-contract.json`](../../../../core/fixtures/timeline-map-contract.json)
对拍；CLI、serve、Studio 与原生 App 不得另造时间语义。

## 19.3 元素 props（0.2/0.3，规范性）

kind 与同名 props 子对象**一一对应且双向强制**：`shape` 元素必须带 `shape` props、
不得带其他五组，反之亦然；多带或缺失都是解析期硬错误 `element-props-mismatch`，
不静默忽略——静默忽略等于让用户的形状定义消失。样式 / 形状 id 的**真相是 preset
注册表的目录型配方**（`Domain::TimelineShape` / `TimelineSticker` / `TimelineVisualizer`
/ `TimelineProgress`，ADR-E05）；schema 层只要求非空字符串，引用未登记 id 是
lint / resolve 期的 `preset-unknown`，不是解析错误。目录内容、渲染契约、BCS1 频谱
格式与 GPU/WASM 双后端的完整规范见
[bcut-element-render-foundation-design.md](../bcut-element-render-foundation-design.md)。
颜色字段一律 `#RRGGBB` 或 `#RRGGBBAA`，在契约层收口校验。

- **`shape`（形状）**：`{shape, fill?, stroke?, strokeWidth?=2, cornerRadius?=[0,0,0,0],
  h?, x1?/y1?/x2?/y2?, head?}`。`cornerRadius` 四角独立（Mac 历史单值 `radius` 读取期
  换算成 `[r,r,r,r]`），与 `place.radius`（元素级圆角裁切）是两件事、不合并；`h` 是
  帧高百分比、缺省正方；端点四元组只对 `line` / `arrow` 有意义，缺省 `[0,50,100,50]`
  （盒子水平中线），`head` 封闭 `arrow|none`。目录现为 **24 款**（23 款基础形状
  ＋ BaoCut 自有 `line`；`line` / `arrow` 在编辑器 UI 归「批注」组，核心仍是
  同一个 `shape` kind）。
- **`sticker`（贴纸）**：`{source, templateId?, path?, loop?="loop", fillOverrides?}`。`source` 封闭
  `template|asset`，对应两条渲染通路：**内置模板库**（`core/presets/builtin/sticker/`，
  首批 10 款自绘归一化矢量，直出绘制指令）与 **timeline sources 里的资产**（PNG /
  JPEG / SVG / 带 alpha 的循环 WebM，host 解码）。**动态贴纸没有独立 kind**：它就是
  资产贴纸 ＋ 视频源——GIF / APNG / 动画 WebP 经 `bcut sticker` 转成带 alpha 的循环
  WebM、以 `kind:"video"` 登记进 `sources`，取帧时刻由 `loop` 决定：封闭
  `loop|once|hold`（循环 / 播一次停末帧 / 定格首帧），仅当资产是视频或 Lottie 时被消费。
  `fillOverrides` 是 SVG 原色到目标色的有序映射，键和值均按颜色契约校验；光栅与
  预览在解析 SVG 后、绘制前应用同一映射。**Lottie 贴纸**（0.7）同样没有独立 kind：
  bodymovin JSON 直接以 `kind:"lottie"` 登记进 `sources`（`bcut source probe` 原生识别，
  不经 ffmpeg 转码），元素仍是 `sticker` + `source:"asset"`，取样走 §6.5.2 的纯 Rust
  Lottie 渲染器，`loop` 语义与视频贴纸一致；`fillOverrides` 作用于 Lottie 的纯色填充 /
  描边与 solid 图层（原色按 8 位量化精确匹配，动画颜色的每个关键帧端点各自替换，
  渐变不参与），替换折进渲染指纹，原始 JSON 不改。可编辑工程导出（`bcut-editable`）
  尚无 Lottie 对应物：跳过该元素并报 `unsupported-element` 警告，不阻断导出。
- **`visualizer`（声波，音频频谱可视化）**：**顶层 kind，不是贴纸子类型**——数据源与
  属性面板都与贴纸无关（ADR-E02）。`{style, mainColor?, secondaryColor?, fftSize?=1024,
  minDb?=-80, maxDb?=40, smoothing?=0.8, gain?=1, audio?="project", speaker?,
  alwaysShow?=false}`。`fftSize` 封闭
  `{256,512,1024,2048}`；校验 `minDb < maxDb`、`smoothing ∈ [0,1)`、`gain ≥ 0`（`gain`
  是 BaoCut 自有字段）。`audio` 缺省 `"project"`＝整片输出音轨（解析为 `main`
  源），其他值为媒体源 id。像素由 **BCS1 频谱边车**驱动（固定 48 kHz / FFT 1024 /
  60 fps 分析，一份缓存服务所有参数组合，元素级 dB/smoothing/gain 在 host 预处理期
  重映射，格式见元素地基方案 §6）；`speaker` 过滤到指定说话人，`alwaysShow=true`
  时静音/无匹配段仍显示基线。采样时刻经时间轴→源时钟投影，cut 掉的间隙按静音帧
  处理。样式目录 **15 款**，每款配方声明默认主副色与 `numColors` / 控制区可用性。
- **`progress`（进度条）**：`{style, mainColor?, secondaryColor?, startProgress?=0,
  endProgress?=1}`。**数据源是播放头
  而不是音频**：`progress = clamp((t − start) / (end − start), 0, 1)`，纯函数、不需要
  任何媒体输入（ADR-E04），因此参数集只有样式与两个颜色。样式目录 **14 款**；每款
  配方声明 `numColors 0|1|2` 决定色板消费口径（`0`＝两款彩虹边框，颜色烘在配方里、
  色板不可编辑；`1`＝只消费 `mainColor`；`2`＝主副色齐用，标签对由配方给出）。
  `countdown` / `countup` **不在进度枚举里**：面板上的那两格建出来的是文字条目、
  不是 progress shader。输出为 `startProgress + p × (endProgress-startProgress)`；起点可
  大于终点，反向进度是正式语义。
- **Counter（文字派生能力）**：`kind:"text"` 携带 `counter {mode:
  countdown|countup, format:s|mm:ss|hh:mm:ss}`，与 `text` 严格互斥，沿用普通文字
  的 style、place 与 animate。倒计时值为 `ceil(end-t)`、正计时为 `floor(t-start)`；
  元素窗口半开，因此 `t=end` 起不可见。
- **`draw`（绘制）**：`{brush:round|sliced,color,size,alpha?,strokes[]}`；`size` 为
  `1..=40`，`alpha` 为 `0..=1`。每条 stroke 的 `points[]` 是画布归一化 `[x,y]`，
  每维在 `0..=100`；单元素至多 256 条笔迹、合计 16384 点。一个 draw 元素就是一个
  可独立计时、选择、动画、删除的绘制图层。
- **`placeholder`（占位框）**：`{variant:camera|media|screen,notes?}`，备注最多
  2048 字节；`srcId` 可选。无源时绘制对应占位外观，有源时在原 place 框内按媒体
  路径渲染。替换只接受项目/本地媒体，不定义录制入口。
- **`confetti`（彩纸，算法粒子；0.6）**：**顶层 kind**，不是贴纸子类型——它没有
  `srcId`，像素由确定性算法逐帧求值（同 `progress` 一样是 `VisualSource::None` 的纯函数）。
  `{style, seed?=0, colors?[1..8], shapes?[1..12], size?=1, speed?=1, gravity?=1,
  drift?=1, spin?=1, wind?=0, opacity?=1, emit?{mode, rate?, count?, interval?, settle?},
  origin?{x,y}, angle?, spread?}`。`style` 是配方 id，目录 **10 款**
  （`core/presets/builtin/confetti/<style>.json`，`recipe.algorithm:"confetti-v1"`，新 domain
  `TimelineConfetti`）：`rainbow-paper` / `pastel-fall` / `neon-streamers` / `golden-starburst` /
  `festival-fireworks` / `hearts-petals` / `party-cannons` / `curling-ribbons` / `geometric-pop` /
  `champagne-sparkle`；配方给出全部缺省，props 里只写用户改过的。`shapes` 取自封闭 12 值
  `rect strip circle ellipse triangle diamond star starlet sparkle heart petal ribbon`。
  `size/speed/gravity/drift/spin` 是对配方绝对值的**倍率**（`size/speed ∈ [0.25,4]`，
  `gravity ∈ [-2,4]`，`drift/spin ∈ [0,3]`），`wind` 是绝对加速度（px/s²，`[-600,600]`，
  按 `pixelScale = 短边/540` 缩放），`opacity ∈ [0,1]`。`emit.mode` 封闭 `continuous|burst`，
  `rate ∈ [1,400]`（粒/秒）、`count ∈ [1,500]`（每次爆发）、`interval ∈ [0,60]` 秒（0＝只爆一次）、
  `settle=true` 时最后 `lifeMax` 秒不再生成，让元素结束前粒子自然落尽；`origin` 为盒内
  百分比 `[-20,120]`（可落在画面外；非空时**替换**配方发射器为这一枚点），`angle ∈ [-180,180]`（度，0 向右、正向下）、`spread ∈ [0,360]`。
  `seed` 缺席按 0 求值，但**新建元素时写入随机值**；粒子 `i` 的第 `c` 个随机量取
  `splitmix64_unit(seed, i·16+c)`，任意时刻 `t` 只枚举生成时刻落在 `(t−lifeMax, t]` 的粒子，
  与元素总时长无关——元素可以任意拉长或缩短。`place` 走 aspect frame，缺省
  `{x:50,y:50,w:100,h:100}` 铺满画布。运动核、发射、通道表与配方参数见
  [bcut-confetti-element-design.md](../../elements/bcut-confetti-element-design.md)。
- **`whiteboard`（白板手绘；0.8，0.9 扩展）**：**顶层 kind**，走 image 同款的宿主光栅路线——必须有
  `srcId` 且源 `kind` 为 `image`（校验码 `whiteboard-source-kind`），像素由内核在渲染期从源图
  推导「揭示场」后逐帧求值（先墨线后色块、按阅读带顺序、时长 ∝ √面积、笔尖处画矢量手），
  不持久化任何派生物。`{hand?=marker, paper?, draw?, inkFirst?=true, pace?=stretch, strict?=false,
  beats?[0..64]}`：`hand` 封闭 `marker|pen|none`；`paper` 为十六进制纸色（缺席不铺纸色：源图自身不透明的纸面在未画到的笔画处照常显示，透明底才透出项目背景）；`draw` 是
  画完全图的秒数（`> 0`，缺席取 `min(0.8×时长, 自然时长)`，超过时长按时长截断），之后整图静止到
  `end`；`pace` 封闭 `stretch|natural`——`stretch`（缺席）每拍撑满自己的节拍窗，`natural` 每拍按
  自然速度画完后定格到窗尾；`strict` 为 `true` 时 `box` 是硬遮罩（像素归属按拍顺序、重叠归后拍、
  跨 `box` 的连通域按像素切开，没被任何 `box` 盖住的前景排到末拍之后）；`beats[]` 是节拍
  `{at, end?, box:[x,y,w,h], label?}`：`at` / `end` 是 **TimeValue**——数字为元素本地秒，字符串为词
  锚点 `~main:<wordId>:start|end`（宿主按 transcript 解析到成片时钟再减去元素起点；解析不到报
  `word-anchor-missing|cut|unmapped|ambiguous`，渲染时该拍退回几何顺序）；`end` 缺席 = 下一拍
  `at`（末拍 = `draw`），`end < at` 报 `whiteboard-beat-window`，`at > draw` 报
  `whiteboard-beat-after-draw`；数字 `at` 单调不减；`box` 为画面百分比且 `w,h>0`，落在框内的连通
  域归该节拍，框外的按几何顺序补在末尾；`label` ≤ 80 字，只展示。`place` 与 image 同：无 `h`，
  高度由源图比例决定；`mode` / `fit` / `mask` / `fx` / `transitions` / `animate` 全部可用。算法与
  三表面形态见 [bcut-whiteboard-animation-design.md](../../video/bcut-whiteboard-animation-design.md)，0.9
  的节奏 / 硬遮罩 / 词锚点与 `bcut whiteboard sync` 见
  [bcut-whiteboard-narration-sync-design.md](../../video/bcut-whiteboard-narration-sync-design.md)。

`role:"overlay"|"frame"` 复用 image/video/sticker 的媒体与贴纸渲染通路，不新增
Timeline kind；role 与其他 kind 组合必须拒绝。`audioFadeIn/audioFadeOut` 仅适用于
audio/video，单位秒、范围 `0..=5`。`fx` 的 0.3 字段为 brightness、contrast、
exposure、hue、saturation、sharpen、noise、blur、vignette、grayscale，另有 13 个
filter preset、10 个 effect preset 与 `effectIntensity`；具体封闭枚举和范围由
`bcut spec.timelineSchema` 自描述，预览与导出消费同一 lowering/注册表。

元素级公共字段的口径随 kind 收窄：媒体字段（`srcId/srcStart/rate/muted/volume/
mode/fit/bg/mask/fx`）仍限 text 之外的媒体元素，`text/style/stylePresetId` 仍限文字
元素；资产贴纸通过 `srcId` 引源。`animate {enter, exit, loop}` 在 schema 上对新四种
元素均合法（`typewriter` / `riseWords` 仍只限普通 text；Counter 禁止这两款），
Visualizer 自身频谱运动与元素动画分层。字段集与数值边界
仍由 §19.1 末尾的 `timelineSchema` 自描述契约兜底。

### 视频边界转场（0.5）

`video` 元素可选 `transitions`，与 `animate` 独立；其它 kind 不接受该字段。形状为
`{"in":{"k":"dissolve","dur":0.5},"out":{"k":"iris","dur":0.5}}`，两端均可省略。
`k` 为 `none/dissolve/wipe/slide/zoom/iris`，`dur` 缺省 0.5 秒、有限值且范围 0.1–2 秒。
每端实际时长取配置值与**解析锚点后的元素时长一半**的较小者；元素采用 `[start,end)` 窗口。
设端点进度为 `p`（进入 0→1，离开 1→0），叠化使用透明度 `p`，擦除为左侧横向揭示
比例 `p`，滑入沿视频自身旋转/翻转后的横轴移动 `(p-1)×宽度` 并乘透明度 `p`，缩放为
`0.75+0.25p` 并乘透明度 `p`，圆形展开以视频盒中心为圆心、半对角线乘 `p` 为半径。
转场与元素动画组合后作用于媒体内容，选中几何只读取静态摆位。CPU 导出、GPU 合成与
WASM 预览共用边界采样；静音、音量和 `audioFadeIn/audioFadeOut` 继续独立控制音频。
这是视频元素与底层画面的交接，也是**唯一**的视频转场契约：分离后的视频就是元素，相邻元素的接缝由各自的 `transitions` 表达；旧式文档主轨相邻 clip 的接缝没有转场，也不再规划。

### 关键帧、纯色画布与闪避（0.12）

**关键帧 `keyframes`**：元素可选 `{属性: [{t, v, ease?}, …]}`，属性闭集
`x/y/scale/scaleY/rot/opacity/radius/volume`（与 `place` 同名同单位；`volume` 为线性倍数）。
`x/y/scale/scaleY/rot/opacity` 限有画面的元素，`radius` 限图片 / 视频 / 占位 / 白板 / 素材贴纸，
`volume` 限 audio / video；不适用的属性、空对象、空数组都是校验错误。每个属性 1–256 帧，`t`
是元素本地秒（非负）或 `"N%"`（`0%`–`100%`，元素时长的比例），同一属性不得混用两种写法，时刻
严格递增；`v` 的区间与静态值相同（`opacity 0–1`、`volume 0–4`、`radius ≥ 0`）；`ease` 取 BCF
缓动名（`bcut_motion::curve::EASE_NAMES`），写在**目标帧**上，作用于进入该帧的那一段，缺省线性。
第一帧之前取第一帧的值，最后一帧之后取最后一帧的值；秒写法落在元素末尾之后的帧不生效。
百分比写法随元素时长走：裁剪、跟随剪口改了时长之后仍然从头跨到尾。

**关键帧与跟随（规范性）**：跟随时钟（§19.1）与分割改了元素窗口时，关键帧在同一写事务里对到新窗口，
规范实现 `bcut_timeline::keyframes::rewindow`：秒写法跟着内容走——片段画面按它分到的源区间换算
（倍速变了一并折算），其它元素按起点被推后的量平移，跨在元素中间的剪口不挪秒写法的帧；落到新窗口
之外的帧去掉，并在新起点 / 新末尾补一帧取样值，看得见的那一段动画不变。百分比写法在元素仍是一件时
原样（随新时长伸缩）；一件分成几件（`clip split` 切开压在分割点上的元素、剪口把一件片段画面切成
几段）时，每一件按自己分到的那一份改写百分比，两件在接缝处连续。`duck` 原样随元素复制；被某个
`duck.under` 引用的轨在跟随之后即使空了也保留。

**元素级分割 / 合并 / 修剪（规范性）**：`element split` 按分割点把元素窗口一分为二（没有结束时刻的元素
先取它解析出的末尾），关键帧经 `bcut_timeline::keyframes::split_keyframes` 切开：秒写法跟着内容走，
每一半在接缝处各补一帧取样值；百分比写法按各自分到的那一份改写（仍写百分比），两半在接缝处连续。
`duck` 与静态 `volume` 原样复制到两半。`element join` 是它的逆运算（`join_keyframes`）：两半的关键帧
去掉接缝补帧、百分比按合并后的时长重写，再切一次能逐帧还原两半时才算同一组动画，合并回去即原样；
还原不了（例如两件本来各自独立的渐变）时 `keyframes` 记作属性不同，须 `--keep` 指定保留哪一侧。
`element trim` 与跟随的修剪同一规则（`Rewindow::trim`）：秒写法跟着内容走，剪掉的头尾里的帧去掉并在
新起点 / 新末尾补取样帧；百分比写法原样，随新时长伸缩。

**叠加顺序（规范性）**：有关键帧的属性，取样值**取代**静态值成为这一刻的基础姿态
（`radius` 关键帧取代四角全部半径）；`animate` 的入场 / 出场 / 循环与 `transitions` 照旧叠在基础姿态
之上。没有关键帧的元素逐帧取样入口原样返回静态值，渲染逐位不变。选中框与几何面板读静态
`place`。规范实现 `bcut_timeline::keyframes`（`place_at` / `sample` / `volume_at`），CPU 导出、GPU
合成、WASM 预览与 App 预览都经它取值。

**露底检查**：静态位置盖满画布的图片 / 视频，关键帧运动的全过程也必须盖满（按帧网格与每个关键
帧时刻取样，容差 0.5 px）；写入口发现露底时报最早的本地时刻与差距像素并拒绝，显式放行
（命令行 `--allow-uncovered`）才写入。规范实现 `keyframes_uncover`。铺满模式（`mode: fullscreen`）的
盒位置不看 `x` / `y`，只有缩小、`scaleY` 与旋转会露底；画中画（如 `w: 100` 的盖满画布）的 `x` / `y` 平移同样受检。
静态就没盖满、平铺、或不是图片 / 视频的元素不查；`edit apply` 的 `patchElement` 不做这项检查。
判定按矩形盒（位置、缩放、`scaleY`、旋转）：圆角 `radius`、翻转 `flip` 与滤镜不改盒子，不进判定——
圆角切掉的四角是作者要的形状，不算露底。只改叠放（换轨、`order`）不动几何，不触发检查。

**纯色画布**：`main.background` 与媒体元素的 `bg` 在 `blur|black` 之外接受 `#RRGGBB`（读入大小写不限，
写出一律大写），画面没盖满时露出这一色；CPU、GPU、WASM 与 App 预览同一解析器
（`schema::Background::parse`）。

**闪避 `duck`**：audio / video 元素可选 `{under, depth?, attack?, release?}`：`under` 为 `"speech"`
（已投影到成片时钟的文稿词区间，词缺席时退回 cue 起止）或另一条轨的 id（该轨上未隐藏、未静音、源有音轨的 audio / video 元素的
出现区间；不能是自己所在的轨，也必须存在）；`depth` 是压低的分贝数，`0–60`，缺省 `10`；`attack` /
`release` 为秒，`0–5`，缺省 `0.02` / `0.35`（与 `bcut_core::audio_mix` 的旁白闪避同值）。闪避在活动区间起点前 `attack` 秒开始下压、终点后 `release` 秒回满；相邻活动
区间间隔不足 `max(0.5 s, attack + release)` 时合并。活动区间只从文档读，不分析音频；`under:"speech"` 而项目没有文稿时
闪避不生效并告警 `duck-no-speech`，引用的轨在运行时缺席告警 `duck-track-missing`。

**增益包络（规范性）**：元素最终增益 = 音量（静态或 `volume` 关键帧）× 淡入淡出 × 闪避。
`bcut_timeline::element_gain_envelopes` 把前后两项合成每个元素的分段线性包络（元素本地秒 →
线性增益，已含静态音量），只为带 `volume` 关键帧或生效闪避的元素产出；导出混音（原生逐采样，
ffmpeg 退路逐帧）、Web（经 wasm）与 App 预览都消费同一个函数，淡入淡出仍在各自混音器里乘上。
没有这两个字段的元素增益与 0.11 逐位相同。

## 19.4 Timeline 演进（非规范性）

0.12（2026-09-29）元素新增 `keyframes` 与 `duck`，`main.background` / `bg` 接受 `#RRGGBB`（§19.3「关键帧、纯色画布与闪避」）；升版原因同 0.11——元素与 `main` 是封闭 schema，旧读者见到新字段会报错；0.11（2026-09-25，core 已落地，写入方随图像生成 I1-B2 / I3 接上）附加源新增可选 `origin`（封闭 `ai`）与 `provenance`（出处侧车路径）；`0.10` 文档读入即 `0.11` 语义，不含新字段的文档写出只差版本串；升版原因是 `sources` 条目是封闭 schema（未知字段拒绝），旧读者见到新字段会报错；0.9（2026-09-18，core / App v2 已落地）白板笔迹跟旁白：`whiteboard` props 新增 `pace` / `strict` / `beats[].end` / `beats[].label`，`beats[].at / end` 接受词锚点串，宿主按 transcript 解析；`0.8` 文档读入即 `0.9` 语义，缺省画时公式不变；写入由 `bcut whiteboard sync` 与 App 属性页「按旁白重新对齐」承担；0.8（2026-09-11，core / App v2 已落地）新增顶层 kind `whiteboard` ＋ 同名 props（`hand` / `paper` / `draw` / `inkFirst` / `beats`），元素引 `image` 源、内核渲染期推导揭示场，不持久化派生物；0.7（2026-09-10，core 已落地）`sources.<id>.kind` 新增 `lottie`：Lottie 贴纸就是资产贴纸 ＋ Lottie 源，复用 `sticker.loop` / `fillOverrides`，无新元素 kind、无新 props；主轨 clip 与 `image` / `video` / `audio` / `placeholder` 元素拒绝 Lottie 源；0.6（2026-09-09，core / App v2 已落地）新增顶层 kind `confetti` ＋ 同名 props 与 preset 注册表 domain `TimelineConfetti`，取代第 223 轮的十张 Confetti 动态贴纸 SVG（后者退出目录，已存工程里的 `sticker` 实例仍按资产贴纸播放、不自动迁移）；0.5 落地视频元素的 `transitions`；0.4 落地顶层 `template`（模板层文档，§20）；0.3 已落地 Counter、Draw、Placeholder、overlay/frame role、媒体效果与音频淡化；
`clip.rate` 静态写入自 0.1 起开放（`bcut clip set --rate`），映射、字幕、音频与工程
导出继续消费同一三时钟换算。下列扩展留给后续版本，未升版前不得写入：

1. **转场**：视频元素的 `transitions` 已在 0.5 落地（§19.3），主轨 clip 级转场不再规划——
   主轨只是旧式文档的兼容层。后续若扩展转场词汇，直接复用 BCF §9 的 preset id、时长与
   easing 词汇，仍挂在元素上。
2. **音频关键帧与 ducking**：已在 0.12 落地（`keyframes.volume` 与 `duck`，§19.3）。
3. **多路视频与相机**：所有轨平等，视频就是 overlay 轨上的普通元素，多机位 / J-L cut
   用多个视频元素表达即可，不需要升版；主轨 `clips[]` 已退化为旧式文档的兼容层与字幕
   源时钟，不再作为「主视频」承担画面或声音。相机运动优先复用 BCF camera preset，
   不在 Timeline 发明第二套缓动方言。

**动画内核统一（持久格式不变）**：元素 `animate {enter, exit, loop}` 槽位
（`preset / presetVersion / dur / delay / intensity / ease / stagger / staggerFrom / period /
phase / seed`）与 `fx` / `mask` 自 [bcut-motion-render-upgrade-design.md](../bcut-motion-render-upgrade-design.md)
阶段 1 起不再由独立公式求值，而是经 lowering 进入与 BCF 相同的 MotionGraph → MotionProgram
（§7.5–§7.7）；`ENTER_PRESETS` / `EXIT_PRESETS` / `LOOP_PRESETS` 保持封闭枚举（枚举内加词不升版；exit 槽自 2026-09-05 起按出场配方表校验，借入场词表时代留下的无配方名由 `EXIT_LEGACY_PRESETS` 兼容读入），
已发布配方按 `(preset, presetVersion)` 冻结，像素输出不变。新增 canonical family
（§7.4、附录 B）、`animate.flow`、效果栈与 Surface Transition 未随 0.2 的元素升版落地，
改为对 0.2 之后的 Timeline 版本开放，并复用本规范的 preset id、曲线对象与 composite 语义。

---
