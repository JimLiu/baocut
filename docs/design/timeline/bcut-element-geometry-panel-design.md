> 移植自 BaoCut v2；文中的数据模型名（timeline.json、Element、Source / Clip / Cut 等）指 v2 的模型，与 v3 序列、轨道、实例的对应见[元素模型对照](element-model-mapping.md)与[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# BaoCut 元素几何面板设计（位置 · 大小 · 钉点对齐，模板层与全部元素统一）

> 状态：**已落地**（2026-09-13）。§10 全部按推荐裁决：钉点不落盘、维持 %、换画幅不重排、多选只读、
> 版面编辑器补八把手 + 吸附、有向偏移、`subs_bottom` 不动；§8.1 可选的 CLI `--pin` 暂缓未做。
> 提交：核心 `3d00de6dc` `af611b4f4`、规范说明 `e5caa621f`、原型 `85cc73c40`、App v2 `f0f41ab55` `72ebf9a64`、
> Web `559e7218f`。落地日志：[`core`](../../changelog/core/2026-09-13-130829.md)、
> [`prototype`](../../changelog/prototype/2026-09-13-134903.md)（台账 [`ledger`](../../changelog/prototype-ledger/2026-09-13-134903.md)）、
> [`app-v2`](../../changelog/app-v2/2026-09-13-140518.md)、[`web`](../../changelog/web/2026-09-13-143324.md)。
> 与本稿的主要偏差：模板层吸附用 `geometry_panel::layer_snap_box` 而非 `stage_snap::SnapBox::from_top_left`；
> wasm 以 `GeometryPanel` 类导出而非四个散函数；九宫钉点三表面都画圆点、未新增图标；元素 ⌥ 精调只接 ⌥↑↓
> （⌥←→ 已是时间微调）；「贴齐钉点」两轴一起归零，取代原四枚单轴 chip（用户可见行为变化）。
> 以下正文保留交接时的原文，现状以代码与各表面日志为准。
> 上游依据：[`product-design/14/14.5.md`](../product/product-design/14/14.5.md)（模板系统与版面编辑器）、
> [`product-design/14/14.2.md`](../product/product-design/14/14.2.md)（元素画布把手与吸附）、
> [`product-design/14/14.4.md`](../product/product-design/14/14.4.md)（第 83 轮元素属性页撤下位置 / 尺寸）、
> [`baocut-format-spec/19.md`](../bcf/baocut-format-spec/19.md) §19（`place`）与
> [`baocut-format-spec/20.md`](../bcf/baocut-format-spec/20.md) §20（模板 `box`）、
> [`app-v2/template-layers.md`](../../archive/app-v2/template-layers.md)（App v2 模板层落地台账）。

## 0. 一句话

给**模板层与所有 Timeline 元素**一个同一份的「几何」面板：**九宫钉点**（选把位置从画面哪条边或
中心量起）＋ **X / Y 偏移** ＋ **宽 / 高**（可锁比）＋ 旋转与翻转；面板是**编辑投影**，落盘真相仍是
今天的 `place.x/y/w`（中心制）与 `box.x/y/w/h`（左上制），**协议零改动**；单位维持画面百分比、
一位小数，不改成像素。截图里「贴底后进度线跑到画面外」是渲染 / 版式缺陷，不是数据越界，§11 给复现配方。

## 1. 背景与问题

### 1.1 触发

用户在 App v2 版面编辑器（Edit layout）里给「Progress line」层点「Snap bottom」，面板显示
Left 0.0% / Top 99.2% / Width 100.0% / Height 0.8%，舞台上进度线却画在画布**下方**。用户的诉求：

1. 面板只有「左 / 上」，想贴右、贴底只能心算 `100 − w` / `100 − h`，不方便。
2. 想要 Xcode 那种「先选对齐到哪一边，再填距离」的位置编辑，并且**所有元素**都用同一套，
   在舞台上摆好后能手工微调。
3. 不只是对齐：希望所有元素有**统一的位置、大小设置**。
4. 疑问：位置目前按百分比，是否该像字号那样统一成「数字」。

### 1.2 现状里的五处不一致（探查结论）

| # | 不一致 | 后果 |
|---|---|---|
| ① | **三套位置 UI**：版面编辑器是 `− 值 +` 手搓步进器（%，一位小数，步长 0.5 / 0.2）；字幕样式页是 `drag_slider`（%，零位小数，步长 1）；通用元素属性页**没有**位置 / 尺寸输入（第 83 轮撤下） | 用户在三个地方学三种手势；元素只能靠画布把手 |
| ② | **两套坐标制**：模板 `LayerBox{x,y,w,h}` 左上原点 + 真 `h` + 硬夹硬校验；元素 `Place{x,y,w,scale,scaleY,rot}` 中心原点 + **无 `h`**（裁决 D2）+ 只查 `is_finite` | 同一个「对齐」控件不能直接跨两者 |
| ③ | **吸附只有元素有**：元素走 `stage_drag`（±1.5% 中线）+ `stage_snap`（6px 多线 + 导引线 + ⌥ 关）+ 15° 旋转栅格；模板 `drag_box` / `resize_box` 路径上一条吸附都没有 | 版面编辑器拖层不吸边、不吸中 |
| ④ | 四枚 chip 语义不正交：三枚管垂直（贴顶 / 贴底 / 整宽其实管水平）、`Center` **只居中 x**；chip 永不高亮，没有「当前对齐到哪」的状态 | 没有贴左 / 贴右 / 垂直居中 |
| ⑤ | 全仓**唯一**持久空间锚点是 `Element.vertical_align`（仅垂直、仅文本、stringly-typed）；水平方向与模板层没有任何对应物；唯一成套的锚点 UI 先例在字幕样式页 | 新面板要与它对齐，不能再造第二个垂直锚点 |

### 1.3 这份设计推翻的既有裁决

第 83 轮（[`14.4.md`](../product/product-design/14/14.4.md) 「位置 / 尺寸 / 层级 / 替换来源四段一并退场」）
把元素属性页的位置 X/Y 与尺寸 宽/高 撤下，理由是画布把手已够用。本稿**正面反转**：
用户明确要求手工微调与统一设置。实施时必须同步改 [`14.2.md`](../product/product-design/14/14.2.md)
「一份真相」段、[`14.4.md`](../product/product-design/14/14.4.md) 第 83 轮段与
[`14.5.md`](../product/product-design/14/14.5.md) 版面编辑器段，并在 `docs/changelog/prototype-ledger/` 新建一条分歧台账
记录反转（见 §8.5）。

## 2. 现状事实（按表面，行号对应 2026-09-13 `main`）

### 2.1 核心（`core/`）

**模板层**

- 形状：[`bcut-protocol/src/template.rs`](../../../core/crates/bcut-protocol/src/template.rs) `LayerBox{x,y,w,h}` :54（doc「画面百分比」，x/y 是**左上角**）、`TemplateLayer` :203（serde `box`）、`TemplateDoc` :228、`LayerKind` :133（`chapters|progress|logo|text`，各 kind 内 `size` = **画面高的 %**）、`TextAlign{Left,Center,Right}` :82（只管文字排版）、`MIN_W = 4.0` :14、`MIN_H = 0.6` :16、`check_box` :437-456（**报错不夹取**，EPS 0.051）。
- 几何：[`bcut-timeline/src/template.rs`](../../../core/crates/bcut-timeline/src/template.rs) `Frame` :15、`r1` :73、`clamp_box` :91（**先夹尺寸再夹位置**，一位小数）、`drag_box` :103、`resize_box` :112（只改 w/h）、`hit_test` :121、`subs_bottom` :249（判据 `on && kind.is_strip() && y >= 50` → `100 − y + 2`，**不看 x/w/h**）、新建层默认落位 :512-548（chapters `0,91,100,9`；progress `0,98,100,2`；logo `2,4,14,8`；text `4,14,40,6`）。
- 编辑语义：[`bcut-editor-core/src/template.rs`](../../../core/crates/bcut-editor-core/src/template.rs) `update_layer` :143、`move_box` :151（内部再 `clamp_box` 一次）、`StudioSession{base,draft,sel,instance}` :203-283（撤销粒度 = 整份文档一次 `setTemplate`）、`KindMeta.strip` :31。
- 写路径只有整份 `setTemplate`（[`bcut-kernel/src/cmd/template.rs`](../../../core/crates/bcut-kernel/src/cmd/template.rs) :24-60 五个整套动词），没有逐层 op。
- 协议生成物：`LayerBox` / `TemplateDoc` 在 [`docs/generated/protocol-schema.json`](../../generated/protocol-schema.json)（:4790 / :5646），同步测试 [`bcut-protocol/src/schema.rs`](../../../core/crates/bcut-protocol/src/schema.rs) :667 `generated_files_are_in_sync_with_the_source`；Web 侧类型经 `npm run protocol:gen` 生成到 [`apps/web/packages/protocol/index.ts`](../../../apps/web/packages/protocol/index.ts)。

**元素**

- [`bcut-timeline/src/schema.rs`](../../../core/crates/bcut-timeline/src/schema.rs) `Place{x,y,w,scale,scale_y,rot,opacity,radius,corner_radii,flip_x,flip_y}` :1892-1911（**无 `h`**）、`Place::validate` :1936-1967（只查 `is_finite`）、`Element.vertical_align: Option<String>` :375-384（`"top"|"center"|"bottom"`，缺席 = center；`Element` 是 `deny_unknown_fields`）、`CONFETTI_ORIGIN_RANGE = (-20,120)` :1338（**盒内 %**，第四套基准）。
- [`bcut-timeline/src/geometry.rs`](../../../core/crates/bcut-timeline/src/geometry.rs)（ADR-E01 唯一几何来源）：`DEFAULT_ELEMENT_W=20 / X=50 / Y=50`、`STICKER_BOX_HEIGHT_RATIO=0.62` :16-25；`width_basis` :214（正方款按**短边**量 `w`）；`element_height` :231；`static_box` :274（中心制 → 左上像素盒）。
- 舞台数学：[`bcut-editor-core/src/stage_drag.rs`](../../../core/crates/bcut-editor-core/src/stage_drag.rs)（百分比空间）`SNAP_DISTANCE=1.5` :18、`TEXT_X_LIMITS=(3,97)` / `TEXT_Y_LIMITS=(4,96)` :62-63、`BROLL_*_LIMITS=(6,94)` :65-66、`corner_scale_about` :113、`EdgeResize` :170、`PlaceResize{x,y,w,scale_y}` :290、`place_resize_on` :327（`h_pct = w_pct × aspect × scaleY`）；[`stage_snap.rs`](../../../core/crates/bcut-editor-core/src/stage_snap.rs)（像素空间）`SNAP_THRESHOLD_PX=6` :30、`ROTATION_STEP_DEG=15` :33、`SnapBox::from_center` :56、`edges_x/edges_y` :66-71（左中右 / 上中下六条线——事实上的九宫几何，但只活在一次手势里）。
- 默认宽度：[`bcut-editor-core/src/elements.rs`](../../../core/crates/bcut-editor-core/src/elements.rs) :583-607（Shape 15、Sticker 18、Counter 28、其余 30）。
- 单位契约声明：[`bcut-motion/src/preset_registry/textpreset.rs`](../../../core/crates/bcut-motion/src/preset_registry/textpreset.rs) :22-25「`place.x/y` 是画幅百分比、`style.fontSize` 是参考短边 540 上的像素、`place.rot` 是角度，运行期没有第二套单位」；`REFERENCE_SHORT_EDGE=540` [`effects.rs`](../../../core/crates/bcut-timeline/src/effects.rs) :33；`REFERENCE_FONT_SIZE=30` [`bcut-subtitle-render/src/document.rs`](../../../core/crates/bcut-subtitle-render/src/document.rs) :64，折算 :1995-2016。
- `vertical_align` 消费点：[`render_plan.rs`](../../../core/crates/bcut-subtitle-render/src/render_plan.rs) :1423、:3407、:4114、:5995；[`raster.rs`](../../../core/crates/bcut-subtitle-render/src/raster.rs) :903-918 `anchor_block / seam_align`。
- 内核 CLI：[`bcut-kernel/src/cmd/timeline.rs`](../../../core/crates/bcut-kernel/src/cmd/timeline.rs) `ElementPatchArgs` :242-259（`--x --y --w --opacity`，无 h / 锚点 / rot）。
- 门禁与 golden：`bcut-editor-core/tests/purity_gate.rs`（新增 gpui-free 几何模块必过）、`bcut-subtitle-render/tests/no_second_implementation.rs`、`bcut-subtitle-render/tests/golden/template-layer-frames.json`（`BCUT_UPDATE_GOLDEN=1`）、`bcut-wasm-editor/tests/api_shape.rs` :1614-1667 与 :2373-2409（`element_geometry` 逐值对拍）、`core/fixtures/editor/*.json`。

### 2.2 App v2（`apps/baocut/`）

- 版面编辑器 [`elements/template_studio.rs`](../../../apps/baocut/src/app/editor/elements/template_studio.rs)：四条 `box_line` :455-495（步长 left/top/width 0.5、height 0.2，读数 `{value:.1}%`，写 `ta::studio_set_box`），`box_line` 实现 :499（手搓 24×22 `−`/`+`，**不是** `drag_slider`——提交 `c0c24465b` 的滑杆统一没碰这里，门禁 [`tests.rs`](../../../apps/baocut/src/tests.rs) :2016 是黑名单式所以不报警）；四枚 chip :437-450（`rows::chip(…, false, …)` 永不高亮，testid `template-studio-snap-{full|top|bottom|center}`）。
- 判据 [`template_actions.rs`](../../../apps/baocut/src/app/editor/template_actions.rs)：`Snap` :768-775、`studio_set_box` :1044（clamp）、`studio_snap` :1050、`snapped` :1061-1073（`Bottom ⇒ y = 100 − h`，`Center ⇒ x = (100 − w)/2` 只居中 x）、手势 `studio_begin_gesture` :1218 / `studio_update_gesture` :1245-1271（`drag_box` / `resize_box`，无吸附）；单测 :1328 `snaps_move_the_box_along_one_axis_only`（Bottom → y 92、Center → x 35，**没断 y**）。
- 舞台 [`stage/studio.rs`](../../../apps/baocut/src/app/editor/stage/studio.rs)：每层一块命中盒（`chrome::layer_rect` = `box × frame_size`，[`stage/chrome.rs`](../../../apps/baocut/src/app/editor/stage/chrome.rs) :29-37），1px `0xFFFFFF55` 边，选中时**只有右下一枚**把手（12px 圆，`studio_begin_gesture(…, true)`），字幕引导线 :108-140。
- 元素属性页 [`elements/panel.rs`](../../../apps/baocut/src/app/editor/elements/panel.rs) :1-45 文件头登记「位置 / 尺寸退场（台账 #90）」；唯一几何行 `rotate_row` :435（`ve::Slot::Rotation`，−180..180，翻转经 `toolbar::commit_flip`）；[`value_edit.rs`](../../../apps/baocut/src/app/editor/elements/value_edit.rs) 47 个 `Slot` :48-175 **没有 X/Y/W/H**；彩纸自定起点三行 :2852-2892 是唯一的元素 x/y 数值行（盒内 %）。
- 舞台手势 [`stage/objects.rs`](../../../apps/baocut/src/app/editor/stage/objects.rs)：`StageGesture::{Move,Width,Rotate,Corner,Edge,…}`、`snapped_position` :392、`snapped_width` :436、`snap_guide_lines` :468、`:2220`「±1.5% 中心吸附先落，再叠 §5 的 6px 边 / 中线吸附」、旋转 15° 栅格 :2301-2305；方向键微调 [`stage/marquee.rs`](../../../apps/baocut/src/app/editor/stage/marquee.rs) `nudge_subtitle`。
- 字幕样式页 [`stylepane/sections.rs`](../../../apps/baocut/src/app/editor/stylepane/sections.rs)：`POSITION_RANGE = (0,100,1.0)` :149；`block_position` ≈:1838 = 三档 Segmented（`subtitle-position-quick`，y 10/50/90 + `verticalAlign`）+ `style-y` 滑杆（`%`，0 位小数）+ 脱栈行 `style-linex` / `style-liney` + 锚线三图标 `style-lineanchor`（`icons/align-{top,middle,bottom}.svg`）——**全仓唯一成套的锚点 UI 先例**。
- 公共滑杆 [`ui/slider.rs`](../../../apps/baocut/src/ui/slider.rs)：`SliderRange::new(min,max,step)`、`drag_slider` :275、`drag_slider_with_release` :284。
- 文案 [`locales/template.yml`](../../../apps/baocut/locales/template.yml)：`template.studio.pos.{left,top,width,height}` :1253-1301、`template.studio.snap.{full,top,bottom,center}` :1317-1365（15 语全译；[`apps/web/scripts/build-locales.mjs`](../../../apps/web/scripts/build-locales.mjs) :69 已把 `apps/baocut/locales/*.yml` 打进 Web bundle）。
- 快照钩子 [`app-v2/guide/snapshot-hooks.md`](../../guide/app-v2/snapshot-hooks.md)：`BCUT_GPUI_TEMPLATE='apply=<id>;studio'`、`VK_ELPROPS=<选择子>`、`BCUT_GPUI_SNAPSHOT=editor:<子串>:<png>`；`apply=` 真写 `timeline.json`，需要媒体在盘的项目。
- App 内 `anchor` 一词已被文本选区（`ui/selectable_text.rs`）、弹层定位（`ui/overlay.rs`、`ToolbarAnchor`）占用；core 内被时间域占用（`TimeValue::Anchor` [`schema.rs`](../../../core/crates/bcut-timeline/src/schema.rs) :357、`anchors.rs`、`align.rs`）。

### 2.3 Web（`apps/web/`）

- **没有版面编辑器**：[`panes/elements/TemplateProps.tsx`](../../../apps/web/src/features/editor/panes/elements/TemplateProps.tsx) 只有画幅锁开关 + 「Web 暂不提供」页脚（:1-8 裁决）；模板写路径 [`editor-core/template-lock.logic.ts`](../../../apps/web/src/editor-core/template-lock.logic.ts) `setTemplateOp` :83-85 整份替换。
- 元素属性页 [`panes/elements/ElementProps.tsx`](../../../apps/web/src/features/editor/panes/elements/ElementProps.tsx) :159-182 只有旋转 / 翻转 / 不透明度；文本 [`panes/text/TextProps.tsx`](../../../apps/web/src/features/editor/panes/text/TextProps.tsx) :112-134 / :234-259 在 `<details>` 里有宽度 % 与旋转。
- 字幕样式 [`panes/subtitle/style/Props.tsx`](../../../apps/web/src/features/editor/panes/subtitle/style/Props.tsx) :63-71 / :159-186：预设 Segmented（top/center/bottom ↔ y 10/50/90）+ `ValueRow` y% + 锚线 Segmented，脱预设时 `value=''`；逻辑 [`style/style.logic.ts`](../../../apps/web/src/features/editor/panes/subtitle/style/style.logic.ts) :161-224。
- 几何逻辑：[`editor-core/element-box.logic.ts`](../../../apps/web/src/editor-core/element-box.logic.ts) :37-43 / :56-58 / :87-113；[`editor-core/stage-pose.logic.ts`](../../../apps/web/src/editor-core/stage-pose.logic.ts) :23-45、Caps :52-73、`fitPose` :169、`subClampY` :182；舞台 [`stage/InteractionLayer.tsx`](../../../apps/web/src/features/editor/stage/InteractionLayer.tsx) :49-72 / :197-266 / :288-300 / :341-350；写路径 [`apps/web/src/state/actions/elements.ts`](../../../apps/web/src/state/actions/elements.ts) :22-82（`patch / place / placeMany / nudge / flip` atoms，接受任意 `place` 差分）。
- 控件 [`apps/web/src/ui/`](../../../apps/web/src/ui/)：`Segmented.tsx`、`Field.tsx`、`Stepper.tsx`、`Slider.tsx`、`IconBtn.tsx`、`Toggles.tsx`——**没有** NumberField / 九宫选择器；`panes/elements/PropRows.tsx` 的 `ValueRow`（滑杆 + 数字）与 `subtitle/style/rows.tsx` 的 `ValueRow`（−/+ 滑杆 数字 单位）是两份。组件页 [`features/components/ComponentsPage.tsx`](../apps/web/src/features/components/ComponentsPage.tsx) :163-190；DS 门禁 `scripts/ds-check.mjs`。

### 2.4 原型（`designs/baocut/`）

- [`app/model-template.js`](../../../designs/baocut/app/model-template.js)：`MIN_W/MIN_H` :82、`clampBox` :85-89、`dragBox/resizeBox` :136-140、`subsBottom` :190-199；导出块 :257-264 **没有 snap 助手也没有 `COLORS`**。
- [`app/panel-template-studio.jsx`](../../../designs/baocut/app/panel-template-studio.jsx)：四条 `window.ValueRow` :50-53（步长 0.5/0.5/0.5/0.2）；四枚 `Btn` 内联箭头函数 :54-58（无纯模型、无 `node --test`，违反 [`designs/baocut/AGENTS.md`](../../../designs/baocut/AGENTS.md) :34「算出来的东西下沉到 `.js`」）；**现存 bug** :42 `const C = TPL.COLORS` 未定义，选 chapters 层点「底色」深 / 浅 / 无会抛 TypeError。
- [`app/template-render.jsx`](../../../designs/baocut/app/template-render.jsx)：盒子直接 `%` 做 CSS :104；字号 `Math.max(7, p/100*fh)` :18；`TemplateStudioStage` :168-203 按 **`ctx.ratio`（项目画幅）而不是 `tpl.canvas`** 取景 :180。
- [`app/model-pose.js`](../../../designs/baocut/app/model-pose.js)（`BC_POSE`，`stage_drag.rs` / `stage_snap.rs` 的纯层孪生）：`POSE0={x:50,y:50,w:20,scale:1,rot:0}` :53、`SNAP_PX=6 / CENTER_SNAP=1.5 / ROT_STEP=15 / MIN_W=2 / MIN_PX=10`、`TEXT_LIMITS / BROLL_LIMITS / CLIP_LIMITS={x:[-50,150],…}`（主轨片段**故意允许出框**）、`VALIGN_ITEMS` :408、`fitPose`、`handlesFor`；文件头 :17-18 与 [`14.2.md`](../product/product-design/14/14.2.md) 记 `pose.h` 只在 `free` 档存在（第 122 轮），核心用 `scaleY`。
- 舞台 [`app/stage-objects.jsx`](../../../designs/baocut/app/stage-objects.jsx) `startMove` :165-183、`startCorner` :186-200；落位 [`app/stage-elements.jsx`](../../../designs/baocut/app/stage-elements.jsx) :534-537（`translate(-50%,-50%)` 即中心制）。
- 属性页：[`app/panel-element-edit.jsx`](../../../designs/baocut/app/panel-element-edit.jsx) :72-73、:202 与 [`app/panel-element-style.jsx`](../../../designs/baocut/app/panel-element-style.jsx) :184-185 三处白纸黑字「位置 / 尺寸不在这一页」；唯一几何输入 `RotateRow` :78-110。
- 字幕 [`app/panel-subprops.jsx`](../../../designs/baocut/app/panel-subprops.jsx) :363-400 四件套（预设 Segmented + `<details>` 内 `ValueRow` y + 锚线 Segmented + 注释），:380-381 有意叫「锚线位置」不叫「垂直对齐」（**对齐是结果不是设定**）；历史教训：曾经的 `anchor + offset(0–30)` 组合被推翻，因为「把两者绑死了，量纲也对不上」（第 49 轮）。
- 控件 [`app/ui.jsx`](../../../designs/baocut/app/ui.jsx)：`Segmented` :265-288（item `{k,label,icon,tip}`，纯图标走 `seg__b--icon`）、`Stepper` :353-360（无输入框）；[`app/panel-shared.jsx`](../../../designs/baocut/app/panel-shared.jsx) `ValueRow` :49-75（敲字不夹取、失焦 / 回车才 parse + clamp、Esc 回滚）。**没有紧凑数值网格与九宫控件**，新控件须先进 `ui.jsx` → `Components.html` → 屏幕，几何对 `_ds/adobe-spectrum-2/components/control-geometry.json`。
- 原型无 i18n，全部内联中文；字号 `B.SIZES = [12,14,…,140]`（[`app/model-toolbar.js`](../../../designs/baocut/app/model-toolbar.js) :262）离散 px 档位。

## 3. 目标与非目标

**目标**

- G1 一套面板、一套数学：模板层与所有带 `place` 的元素（sticker / shape / text / counter / image / video / visualizer / progress / confetti / whiteboard / B-roll）共用「几何」段。
- G2 钉点可选：九宫任一点作参照，X / Y 是到参照边（或中心）的距离，「贴底」= 钉点选底、Y 填 0，永远不会越界。
- G3 手工微调：字段可键入、步进、方向键，精度一位小数；与舞台把手是同一份真相，互相实时跟随。
- G4 三表面同步（原型 / App v2 / Web），Web 一并补上元素几何段；Web 版面编辑器仍不建（见非目标）。
- G5 纯模型下沉：投影 / 反投影 / 默认钉点 / 夹取全部是 gpui-free、DOM-free 的纯函数，一处实现（`bcut-editor-core`）+ wasm 导出 + 原型 `.js` 镜像 + 单测对拍。

**非目标**

- N1 不改 `place` / `LayerBox` 的落盘语义，不新增渲染期字段（备选方案见 §6.3，需另立裁决）。
- N2 不把位置单位改成像素（§5）。
- N3 不重做字幕样式页的位置四件套（它已是本设计的先例；只把图标与文案键对齐）。
- N4 不给 Web 建版面编辑器（[`TemplateProps.tsx`](../../../apps/web/src/features/editor/panes/elements/TemplateProps.tsx) :1-8 的裁决不动）。
- N5 不做多选对齐 / 分布（对齐到彼此），不做画幅切换时按钉点重排（§10 Q3）。
- N6 不统一模板 `size`（画面高 %）与元素字号（参考 540 px）两套字号单位（§5.3 只登记）。

## 4. 概念模型

### 4.1 术语

- **画布盒 `B = (l, t, w, h)`**：元素或层在画布上的可见矩形，四值都是画布百分比（`l,w` 相对画幅宽，`t,h` 相对画幅高），左上原点。这是面板内部的公共中间表示，不落盘。
- **钉点 `pin = (px, py)`**，`px ∈ {left, center, right}`，`py ∈ {top, middle, bottom}`，九宫。名字用 **钉点 / pin**：避开时间域的 `anchor`、文字排版的 `align`、Confetti 的 `origin`；与既有文案「`place.y` 钉住文本块的哪条边」（[`schema.rs`](../../../core/crates/bcut-timeline/src/schema.rs) :375-384）同一动词。
- **面板值 `V = (X, Y, W, H)`**：用户看见并键入的四个数。`X` / `Y` 是盒子到钉点参照的有向距离；`W` / `H` 就是 `w` / `h`。

### 4.2 投影：画布盒 → 面板值

```
X = l                     若 px = left      （距左边）
X = (l + w/2) − 50        若 px = center    （横向偏移，0 = 居中，右正左负）
X = 100 − (l + w)         若 px = right     （距右边）

Y = t                     若 py = top       （距顶边）
Y = (t + h/2) − 50        若 py = middle    （纵向偏移，0 = 居中，下正上负）
Y = 100 − (t + h)         若 py = bottom    （距底边）
```

反投影是同一组式子解出 `l, t`。四个数全部一位小数（`r1`），投影往返在一位小数内无损。

### 4.3 两种宿主到画布盒的换算

| 宿主 | `B` 怎么来 | 反写回什么 |
|---|---|---|
| 模板层 `LayerBox` | `l=x, t=y, w, h` 直接取 | `x=l, y=t, w, h`，过 `clamp_box` |
| 元素 `Place`（非文本，或 `vertical_align` 缺席 / center） | `w' = 画布宽百分比的显示宽`（`w × scale`；正方款经 `width_basis` 把短边基准换成画幅宽基准），`h' = element_height(...)` 换成画幅高百分比；`l = x − w'/2, t = y − h'/2` | `x = l + w'/2, y = t + h'/2`；`w` 反解回自身基准；`h'` 只对 free 档写 `scaleY`（`place_resize_on` 的逆式），其余档 H 只读 |
| 文本 / 计时元素带 `vertical_align = top / bottom` | `t = y`（top）或 `t = y − h'`（bottom），其余同上 | `y = t`（top）/ `y = t + h'`（bottom） |

`h'` 一律由核心 `static_box` / `element_height` 量出（舞台已在做），面板不自己算高度。文本内容变化导致 `h'` 变化时，面板值随之刷新，这与今天把手的行为一致。

### 4.4 钉点从哪来（不落盘）

钉点是**编辑投影的参照系**，不是数据。每个元素 / 层在一次编辑会话里记住用户最后选的钉点
（App：编辑器状态里的 `HashMap<String, Pin>`；Web：jotai atom；原型：`ctx` 一张表），首次打开用
`default_pin(B)`：每个轴取盒子三条候选线里离画布对应线最近的那条（`left: l`、`center: |l + w/2 − 50|`、`right: 100 − l − w`；纵向同理），平手优先 `left` / `top`。
文本元素纵向例外：`py` 直接取 `vertical_align`（缺席 = middle），选纵向钉点时**同时写 `verticalAlign`**（它本来就是渲染语义，见 §6.2）。

### 4.5 夹取与限位

- 模板层：写回后过 `clamp_box`（先尺寸后位置），钉点任何一格 + `X = Y = 0` 都在框内。**这就是截图那类问题的正解**：面板不再让用户对着 `100 − h` 心算。
- 元素：沿用 `stage_drag` 的现有限位（文本 3–97 / 4–96，B-roll 6–94，其余不限位、允许出框），面板写回与拖拽同一道 `position` 限位函数；`W` 下限 `MIN_W 2%` 与 `MIN_PX 10`（原型 `BC_POSE` 与核心一致）。
- 键入过程不夹取，失焦 / 回车 parse 后夹取，Esc 回滚（照抄 `panel-shared.jsx` `ValueRow` :30-75 与 App `value_edit.rs` 的语义）。

### 4.6 各类元素的可编辑矩阵

| 宿主 | 钉点 | X / Y | W | H | 锁比 | 旋转 / 翻转 |
|---|---|---|---|---|---|---|
| 模板层（4 kind） | ✓ | ✓ | ✓ | ✓ | ✓（默认关） | — |
| sticker / shape / image / video（`corner` / `free` 档） | ✓ | ✓ | ✓ | free 档 ✓（写 `scaleY`），corner 档只读 | free 档 ✓ | ✓（现有行并入） |
| text / counter（`text` 档，高随内容） | ✓（纵向 = `verticalAlign`） | ✓ | ✓ | 只读 | — | ✓ |
| visualizer / progress / confetti / whiteboard | ✓ | ✓ | ✓ | 同 kind 的把手档 | 同左 | 同左 |
| B-roll | ✓ | ✓（6–94 限位） | ✓ | 只读 | — | 现有条子 |
| 字幕 | 不换宿主，保留四件套 | — | — | — | — | — |

「把手档」以 [`14.2.md`](../product/product-design/14/14.2.md) 的 `BC_POSE.handlesFor` 三档为准，实施时不要另立表。

## 5. 单位裁决：百分比 vs 「数字」

### 5.1 现状里的四套基准

| 量 | 单位 | 出处 |
|---|---|---|
| 模板 `box`、元素 `place.x/y`、字幕 `y` | 画布百分比 | §2.1 |
| 元素 `place.w` | 画幅**宽**百分比（正方款按短边） | `geometry.rs` :214 |
| 模板层 `size` | 画面**高**百分比，下限 7px | `bcut-protocol/template.rs` :7-8、`template_layer.rs` :204-207 |
| 字幕与文字元素 `fontSize` | **参考短边 540 上的逻辑像素**（不是输出像素） | `textpreset.rs` :22-25、`document.rs` :64 |
| Confetti `origin` | 盒内百分比，可超 0–100 | `schema.rs` :1338 |

字号那套「数字」其实也是**虚拟单位**：`30px` 意味着 540p 参考画面上 30 像素，导出 1080p 时是 60 像素。它不是「真像素」。

### 5.2 裁决：位置与大小**维持画布百分比**，面板统一到一位小数

理由：

1. 画幅是项目级可变量（16:9 ↔ 9:16、模板 `ratio` / `lockRatio`），百分比在换画幅时语义不变；像素（哪怕是参考 540 像素）的**长边数值随画幅改变**（16:9 是 960，9:16 是 540），同一个 `X = 40` 在两种画幅下意思不同。
2. 渲染、导出指纹、golden、wasm 对拍、Web / 原型的 CSS 落位全部按百分比；改单位等于改契约，收益只是显示。
3. 用户的痛点是「不方便对齐」与「三处不一致」，钉点 + 统一面板已解决，换单位不解决。
4. `x` 与 `y` 的像素比例尺不同（一个乘画幅宽一个乘画幅高），面板显示像素反而让「X 与 Y 同为 10」的直觉失真。

**统一的是精度与手势，不是单位**：所有几何字段一位小数；步进 `±0.5`、⇧ `±5`、⌥ `±0.1`；方向键微调沿用 1% / ⇧ 5%（[`19.md`](../product/product-design/19.md) :34），新增 ⌥ 0.1%；字幕样式页的 y 滑杆从零位小数改为一位小数（步长 1 不变）。

### 5.3 可选的显示单位（默认关，§10 Q2）

若用户仍希望看见像素，加一个**只影响显示**的偏好「几何单位：% / px」，px = 参考 540 像素（与字号同一把尺），落盘不变。不建议第一期做。模板 `size`（画面高 %）与元素字号（参考 540 px）的合并另立设计，本稿不动。

## 6. 数据模型与协议

### 6.1 推荐：方案乙——面板是投影，协议零改动

- 落盘真相不变：`Place{x,y,w,scale,scaleY,rot,…}` 中心制、`LayerBox{x,y,w,h}` 左上制、`Element.vertical_align`。
- 钉点不落盘（§4.4）。
- 因而：`docs/generated/protocol-schema.json` 不变、`timelineSchema` 不变、golden 不变、导出指纹不变、`bcut-kernel` 的 `--x/--y/--w` 语义不变。
- 新增的只有一处纯函数模块（§8.1）与三表面 UI。

### 6.2 `vertical_align` 的归属

它今天已经是「`place.y` 钉住哪条边」的渲染语义，正好就是文本元素的纵向钉点。本稿不改名、不扩成对象，只在面板里把它当 `py` 读写；缺席 = middle。`Element` 是 `deny_unknown_fields`，Web 的 `timelineSchema` 是 `additionalProperties:false`——**任何**新增字段都要同步这两处，这也是不新增字段的另一个理由。

### 6.3 备选：方案甲——钉点进真相（`x,y` 改为钉点坐标）

把 `vertical_align` 的思路推到二维和全部元素：新增 `place.pin{x,y}` / `box.pin{x,y}`，`x,y` 定义为钉点坐标。好处是换画幅时钉点语义天然保留、面板与数据一一对应。代价：

- `geometry.rs::static_box`、`stage_drag` 限位（`TEXT_X_LIMITS` 按中心算）、`stage_snap::SnapBox::from_center`、Web `element-box.logic.ts` / `stage-pose.logic.ts`、原型 `stage-elements.jsx` 的 `translate(-50%,-50%)`、`bcut-motion` 各 preset 读 `place.x/y` 的地方、白板 `beats.box`、wasm `api_shape` 对拍、fixtures、golden、协议 schema 与 Web 生成类型、`Element` / `timelineSchema` 的字段白名单，全部要动。
- 老文档迁移：无 `pin` 视为 center（元素）/ top-left（模板），读侧兜底可做，但两种缺省本身就是新的不一致。

结论：第一期不做；若 §10 Q3「换画幅按钉点重排」被要求，再回到这里评估。

### 6.4 命名避让

- `anchor`：时间域（`TimeValue::Anchor`、`anchors.rs`、`align.rs` 243 处）与 UI 弹层定位已占用。
- `align`：`TextAlign` / `ALIGNS` / `cntAlign` 文字排版已占用；字幕面板有意不叫「对齐」。
- `origin`：Confetti 发射起点已占用。
- 采用：概念叫 **钉点（pin）**；i18n 键前缀 `geometry.*`（新建 `apps/baocut/locales/geometry.yml`，15 语），文案见 §7.4。

## 7. UI 规格

### 7.1 面板「几何」段（三表面同一版式）

```
几何                                             [ % ]（第一期不出现，§5.3）
┌─────────┐   钉点        X  距左   [ 12.0 ] %      W  [ 40.0 ] %
│ ○ ○ ○ │              Y  距顶   [  4.0 ] %      H  [  6.0 ] %   [🔒]
│ ○ ● ○ │   (九宫)
│ ○ ○ ○ │              [贴齐钉点]  [整宽]  [整高]
└─────────┘
旋转  [   0 ] °   [⟷] [⇕]
```

- **九宫钉点**：3×3 图标 Segmented（原型 `Segmented` 纯图标模式；App `seg_icons`；Web `Segmented`），当前格实心。点击只换参照系、**不移动元素**，X / Y 读数随之重算。图标：复用 `align-top / align-middle / align-bottom` 与 `align-left / align-center / align-right` 的几何拼成九格（新图标只在 `designs/baocut/app/icons.jsx` 加，走 `scripts/dev/sync-ui-icons.mjs`）。
- **X / Y 标签随钉点变**：`距左 / 横向偏移 / 距右`、`距顶 / 纵向偏移 / 距底`；偏移是有向数（0 = 居中）。
- **数值格**：紧凑数字框（键入 / 方向键 / 滚轮），后缀单位；三表面**新增**一个 `NumField`（原型 `ui.jsx` + `Components.html`；Web `ui/NumField.tsx` + 组件页；App 复用 `value_edit` 的槽位机制新增 `Slot::{GeomX,GeomY,GeomW,GeomH}`）。不用滑杆：位置 / 尺寸没有自然的滑动范围（元素允许出框）。
- **锁比**：只在 H 可编辑的宿主出现（§4.6）；开时改 W 同步 H（模板层按当前 `w/h`，元素按 `aspect × scaleY`）。
- **快捷动作**：`贴齐钉点`（X = Y = 0）、`整宽`（钉点横向改 left、X = 0、W = 100）、`整高`（同理纵向；只对模板层与 free 档出现）。它们取代今天的四枚 chip：`贴顶` = 钉点 top + 贴齐，`贴底` = 钉点 bottom + 贴齐，`居中` = 钉点 center/middle + 贴齐（**两个轴一起**，修掉 ④）。
- **旋转 / 翻转**：把现有 `rotate_row` / `RotateRow` / Web 的旋转翻转行搬进本段末行，不重写。
- 元素属性页放在样式段之前、动画段之后；版面编辑器 `LayerProps` 的四条 `ValueRow` + 四枚 `Btn` 整段替换。

### 7.2 舞台

- 元素：把手、吸附、导引线、15° 栅格全部不变；面板与把手同一份真相（`place`），拖动时面板读数实时跟随（App 的 `style_writes_repaint_too…` 已保证重绘）。
- 模板版面编辑器：**补齐到元素的水平**——四角 + 四边把手（走 `bcut-timeline::template` 新增 `resize_box_from(box0, handle, dx, dy, frame)`，对边锚定，`clamp_box` 收尾）、拖动时接入 `stage_snap::snap_move`（画布三线 + 其它层边线，6px，⌥ 关）；旋转不做（模板层无 `rot`）。
- 方向键：1% / ⇧ 5% 不变，新增 ⌥ 0.1%（元素与模板层都接）。

### 7.3 交互细节

- 键入非法值不写；越界值在提交时夹取并回显夹取后的数。
- 模板层的撤销粒度不变（整份 `setTemplate`）；元素每次提交一笔 `patch_element_op`，连续步进按现有滑杆惯例合并为一步撤销（`1e0d2c87d` 的规则）。
- 文本元素改纵向钉点 = 写 `verticalAlign`，并把 `place.y` 换算到新钉点，使画面不动（与字幕样式页的锚线 Segmented 行为一致）。
- 多选：面板显示第一个元素的值，写入对所有选中元素按各自钉点应用同一 X / Y（第一期可只做单选，多选灰掉；§10 Q4）。

### 7.4 文案键（`geometry.yml`，en / zh-CN 示例，15 语全译）

| 键 | en | zh-CN |
|---|---|---|
| `geometry.section` | Geometry | 几何 |
| `geometry.pin` | Pin | 钉点 |
| `geometry.pin.tip` | Measure position from this point | 位置从这个点量起 |
| `geometry.x.left` / `.center` / `.right` | From left / Offset X / From right | 距左 / 横向偏移 / 距右 |
| `geometry.y.top` / `.middle` / `.bottom` | From top / Offset Y / From bottom | 距顶 / 纵向偏移 / 距底 |
| `geometry.w` / `geometry.h` | Width / Height | 宽 / 高 |
| `geometry.lock_ratio` | Lock ratio | 锁定比例 |
| `geometry.snap_to_pin` | Snap to pin | 贴齐钉点 |
| `geometry.full_width` / `geometry.full_height` | Full width / Full height | 整宽 / 整高 |

`template.studio.pos.*` 与 `template.studio.snap.*` 在版面编辑器换版后不再被引用，删除（15 语一起删，`locale_placeholders_match_english_in_every_language` 会核对）。

## 8. 分表面实施计划

顺序：8.1 核心纯函数 → 8.2 原型（含产品规格与台账）→ 8.3 App v2 → 8.4 Web → 8.5 文档收尾。每一步单独提交；核心与三表面可以并行开 worktree，但同一时刻只跑一个 cargo（共享 `core/target`）。

### 8.1 核心：`bcut-editor-core::geometry_panel`（gpui-free，过 `purity_gate`）

新文件 `core/crates/bcut-editor-core/src/geometry_panel.rs`：

```rust
pub enum PinX { Left, Center, Right }   pub enum PinY { Top, Middle, Bottom }
pub struct Pin { pub x: PinX, pub y: PinY }
pub struct CanvasBox { pub l: f64, pub t: f64, pub w: f64, pub h: f64 }   // 画布百分比
pub struct PanelValues { pub x: f64, pub y: f64, pub w: f64, pub h: f64 } // 一位小数
pub fn project(b: CanvasBox, pin: Pin) -> PanelValues;
pub fn unproject(v: PanelValues, pin: Pin) -> CanvasBox;
pub fn default_pin(b: CanvasBox) -> Pin;
pub fn layer_box(b: &LayerBox) -> CanvasBox;              // 模板宿主
pub fn layer_from(b: CanvasBox) -> LayerBox;              // 过 clamp_box
pub fn element_box(place, kind, vertical_align, frame) -> CanvasBox;   // 经 geometry::static_box
pub fn element_from(b: CanvasBox, prev: &Place, kind, vertical_align, frame) -> PlaceResize; // 复用 stage_drag::PlaceResize
pub fn pin_y_from_vertical_align(&Option<String>) -> PinY;  pub fn vertical_align_for(PinY) -> Option<String>;
```

- 单测：投影 / 反投影往返（九格 × 若干盒）、`default_pin` 平手规则、贴底贴右永不越界、文本 `vertical_align` 三态换算、正方款短边基准往返；把 [`template_actions.rs`](../../../apps/baocut/src/app/editor/template_actions.rs) :1328 那条单测的语义（Bottom → y 92）搬到这里并**补断 y 的居中**。
- `bcut-timeline::template` 新增 `resize_box_from(box0, handle: Handle, dx, dy, frame)`（八把手，对边锚定）与测试；`stage_snap` 增加 `SnapBox::from_top_left` 供模板层使用。
- wasm：`bcut-wasm-editor` 导出 `geometryProject / geometryUnproject / geometryDefaultPin / layerResizeFrom`，`tests/api_shape.rs` 逐值对拍。
- 内核 CLI（可选，同一提交或后置）：`bcut timeline element patch` 增加 `--pin <lx|cx|rx>-<ty|my|by> --px --py`，内部经同一模块换算；[`bcut-cli-server-reference/`](../cli/bcut-cli-server-reference/) 第 6 章对应文件同步。
- 验证：`cd core && cargo fmt --all -- --check && cargo test -p bcut-editor-core -p bcut-timeline -p bcut-wasm-editor`；golden 不应变化，若变化即为实现错误。

### 8.2 原型 `designs/baocut`（先于生产表面，按 [`designs/baocut/AGENTS.md`](../../../designs/baocut/AGENTS.md)）

- `app/model-geometry.js`（`BC_GEOM`）：镜像 8.1 的 `project / unproject / defaultPin / layerBox / layerFrom / elementBox / elementFrom`，`model-geometry.test.js` 用同一批数字对拍。
- `app/model-template.js`：把四枚快捷钮下沉为 `snap(box, mode)`（镜像 Rust `snapped`，修掉「居中只居中 x」）、新增 `resizeBoxFrom`，补 `node --test`；顺手修 §2.4 的 `TPL.COLORS` 未定义 bug（另开一条 changelog 记录）。
- `app/ui.jsx`：新增 `NumField`（紧凑数字框：键入 / ↑↓ / ⇧ / ⌥ 步进、失焦提交、Esc 回滚）与 `PinGrid`（3×3 图标 Segmented 变体）；`Components.html` 各加一格；几何对 `control-geometry.json`。
- `app/panel-shared.jsx`：新增 `GeometrySection`（§7.1 版式）供模板 / 元素 / 文本三张面板复用。
- `app/panel-template-studio.jsx` :50-58 整段换成 `GeometrySection`；`app/template-render.jsx` 加八把手与吸附（`BC_POSE.snapMove` 已有，传左上盒）。
- `app/panel-element-edit.jsx` / `panel-text.jsx` / `panel-element-style.jsx`：加回几何段，改掉三处「不在这一页」注释。
- `app/editor-keys.jsx`：⌥ 方向键 0.1%。
- `BaoCut.html` 改过的 `<script>` 换 `?v=YYYYMMDD-HHMM`。
- 文档：改 [`14.2.md`](../product/product-design/14/14.2.md)（一份真相段补「面板是投影」）、[`14.4.md`](../product/product-design/14/14.4.md)（第 83 轮段加反转注记）、[`14.5.md`](../product/product-design/14/14.5.md)（版面编辑器段换成钉点版式）；新建 `docs/changelog/prototype/<时刻>.md` 与 `docs/changelog/prototype-ledger/<时刻>.md`（记录反转第 83 轮、Web 无版面编辑器的差异）。
- 验证：三条闸门（DS 检查器打出 `ok:`、`node --test designs/baocut/app/*.test.js`、HTTP 预览；worktree 里自起 `python3 -m http.server 4326 --directory designs` 并 `curl` 验明新文件）。

### 8.3 App v2 `apps/baocut`

- `elements/template_studio.rs` :437-495：删四条 `box_line` 与四枚 chip，换成新模块 `elements/geometry_section.rs::render(host: GeometryHost, …)`；`box_line` 步进器实现 :499 删除。
- `elements/geometry_section.rs`（新）：九宫 `seg_icons`、四个 `value_edit` 数字格（新 `Slot::GeomX/GeomY/GeomW/GeomH`，范围由宿主给）、锁比开关、三枚快捷 `rows::chip`，宿主枚举 `GeometryHost::{TemplateLayer(id), Element(id)}`。钉点会话表挂在编辑器状态上：`geometry_pins: HashMap<String, Pin>`。
- `template_actions.rs`：`Snap` 枚举与 `snapped` :768-775 / :1061-1073 删除，改为 `studio_set_panel(id, pin, values)` → `geometry_panel::unproject` → `studio_set_box`；`studio_snap` 改经同一路径；手势 :1245-1271 接 `resize_box_from` + `stage_snap`；单测 :1328 迁到核心后删除或改为调用核心。
- `stage/studio.rs`：右下角单把手 :77-103 换成八把手（复用 `objects::` 的把手绘制），拖动时画导引线（复用 `snap_guide_lines`）。
- `elements/panel.rs`：几何段插到旋转行位置，`rotate_row` :435 并入；文件头 :1-45 与台账 #90 的注记改写。
- `text/props.rs`：同样接入几何段（纵向钉点写 `verticalAlign`）。
- `stage/marquee.rs`：⌥ 方向键 0.1%。
- `locales/geometry.yml` 新建（15 语），`template.yml` 删 `template.studio.pos.*` / `snap.*`。
- 验证：`cargo test`（`apps/baocut/`，含 `locale_placeholders_match_english_in_every_language`、`single_value_sliders_go_through_the_shared_drag_slider`、`stage_toolbar_layer_contract`）；快照：`BCUT_GPUI_TEMPLATE='apply=tpl-chapter-bar;studio' BCUT_GPUI_SNAPSHOT=editor:demo:/tmp/geom-studio.png ./run.sh`、`VK_ELPROPS=<sticker id> BCUT_GPUI_SNAPSHOT=editor:demo:/tmp/geom-el.png ./run.sh`、`VK_TEXTVIEW=<text id>:props …`；需要媒体在盘的项目，锁屏出黑图。
- 落地日志：`docs/changelog/app-v2/<时刻>.md`；[`app-v2/template-layers.md`](../../archive/app-v2/template-layers.md) §1 加一行提交、§4 移除「版面编辑器无吸附」类缺口。

### 8.4 Web `apps/web`

- `apps/web/src/ui/NumField.tsx`、`apps/web/src/ui/PinGrid.tsx` 新增并进 `ComponentsPage.tsx`，过 `npm run ds:check`。
- `panes/elements/GeometrySection.tsx`（新）：吃 `place` + kind + `verticalAlign` + 舞台量出的盒（`element-box.logic.ts` 已有），换算走 wasm 导出的 `geometryProject / geometryUnproject`（**不在 TS 里再写一份公式**，避免第二实现）；写回经 `placeElementAtom`。
- `ElementProps.tsx` :159-182、`TextProps.tsx` :112-134 接入；`TextProps` 里 `<details>` 的宽度 % 行并入几何段。
- `TemplateProps.tsx` 不动（N4）；若用户后续要 Web 版面编辑器，几何段可直接复用。
- `InteractionLayer.tsx`：⌥ 方向键 0.1%（`nudge` atom 加步长参数）。
- 验证：`npm run wasm`（核心导出变化后）、`npm run typecheck`、`npm run lint`、`npm test`（补 `GeometrySection.test.tsx` 与 `element-ops.test.ts` 的往返用例）、`npm run ds:check`、需要时 `test:e2e`。
- 落地日志：`docs/changelog/web/<时刻>.md`。

### 8.5 文档与规范收尾

- [`baocut-format-spec/19.md`](../bcf/baocut-format-spec/19.md) / [`20.md`](../bcf/baocut-format-spec/20.md)：各加一段「编辑器面板以钉点投影展示，落盘不变」的说明（契约不变，只是说明）。
- [`bcut-cli-server-reference/`](../cli/bcut-cli-server-reference/)：若 8.1 做了 `--pin`，同步 `element patch` 那一条。
- 本稿文首状态行改为「已落地」并链到各表面提交。
- `skills/`：不涉及分发 skill 的命令与模板，不适用（最终回复说明依据：`skills/baocut` 不暴露元素几何编辑）。

## 9. 交接清单（实施 agent 起手照此走）

1. 读本稿 §4–§7 与 §10 的裁决结果；再按 [`AGENTS.md`](../../../AGENTS.md) 任务路由读 [`14.2.md`](../product/product-design/14/14.2.md)、[`14.5.md`](../product/product-design/14/14.5.md)、[`app-v2/template-layers.md`](../../archive/app-v2/template-layers.md)。
2. `git status` 确认工作区；开 worktree；同一时刻只跑一个 cargo。
3. 先落 8.1（核心纯函数 + 测试 + wasm 导出），提交；golden 与 fixtures 不应变化。
4. 落 8.2 原型（含 `Components.html`、三条闸门、product-design 三处小节、changelog 与 ledger 各一条），提交。
5. 落 8.3 App v2（含 `geometry.yml` 15 语、快照三张、changelog），提交。
6. 落 8.4 Web（含组件页、单测、changelog），提交。
7. 8.5 文档收尾，提交；最终回复报告各提交 hash、实际跑过的门禁、跳过项、skill 不适用依据。

关键文件一览（改动最集中的十处）：
`core/crates/bcut-editor-core/src/geometry_panel.rs`（新）、`core/crates/bcut-timeline/src/template.rs`、`core/crates/bcut-editor-core/src/stage_snap.rs`、`apps/baocut/src/app/editor/elements/template_studio.rs`、`apps/baocut/src/app/editor/template_actions.rs`、`apps/baocut/src/app/editor/stage/studio.rs`、`apps/baocut/src/app/editor/elements/panel.rs`、`designs/baocut/app/panel-template-studio.jsx`、`designs/baocut/app/panel-element-edit.jsx`、`apps/web/src/features/editor/panes/elements/ElementProps.tsx`。

## 10. 开放问题（请用户裁决）

| # | 问题 | 推荐 |
|---|---|---|
| Q1 | 钉点是否落盘（方案乙 vs 甲，§6） | **乙**：不落盘，会话内记忆 + `default_pin`；文本纵向沿用 `verticalAlign` |
| Q2 | 单位：维持 %（§5.2）；是否加「显示为 px」偏好（§5.3） | **维持 %**，px 偏好不做 |
| Q3 | 换画幅（16:9 ↔ 9:16、套模板 `ratio`）时是否按钉点重排元素 | **第一期不做**；需要时再评估方案甲 |
| Q4 | 多选时几何段是否可写（对所有选中按各自钉点应用同一 X / Y） | **第一期只读**（显示第一个，字段灰掉） |
| Q5 | 模板版面编辑器是否补齐八把手 + 吸附（§7.2） | **补**，与元素平价 |
| Q6 | 居中偏移的读数：有向偏移（0 = 居中）还是中心坐标（50 = 居中） | **有向偏移**，与「贴齐 = 0」一致 |
| Q7 | `subs_bottom` 不看 x/w：一条 `x=40,w=10` 的短进度线仍抬字幕，是否顺手改成看水平重叠 | 本稿不动，另立小任务 |

## 11. 截图缺陷：贴底后进度线画到画布外（待复现）

数据层不可能越界：`snapped` 写 `y = 100 − h = 99.2`，`studio_set_box` 与 `move_box` 各夹一次，`clamp_box` 的 y 上限恰是 `100 − h`（[`template.rs`](../../../core/crates/bcut-timeline/src/template.rs) :91-98），单测 :699 与 [`template_actions.rs`](../../../apps/baocut/src/app/editor/template_actions.rs) :1332-1336 都锁着。面板读数 Top 99.2 / Height 0.8 也证实盒子在框内。所以问题在**舞台绘制**，三个候选：

1. `stage/studio.rs` 的命中盒 `border_1()` 与 `selection_outline` 在 `h = 0.8%`（约 2–3 px）时外扩绘制，视觉上压过画布底边；把手圆（12px）也以盒右下角为中心，一半在画布外。
2. `chrome::layer_rect` 用的 `frame_size` 与实际画出的画布（等比夹取后的画面框，见 [`bcut-app-preview-canvas-aspect-clamp`](../../changelog/app-v2/README.md) 一系）不是同一个矩形，底边对不上。
3. 模板 `canvas` 与项目画幅不一致时舞台按项目画幅取景（原型 `template-render.jsx` :180 同款），层按所见帧百分比落位，底边看起来在「另一张画布」之外。

复现配方（需媒体在盘的项目）：
`BCUT_GPUI_TEMPLATE='apply=tpl-chapter-bar;studio' BCUT_GPUI_SNAPSHOT=editor:demo:/tmp/tpl-studio-bottom.png ./run.sh`，进入后对 progress 层点贴底再拍；对照 `bcut render` 同一 `timeline.json` 的导出帧（`bcut-subtitle-render::template_layer` 直绘）看盒子是否在框内。实施 8.3 时先修这一条，并在 changelog 写明根因。
