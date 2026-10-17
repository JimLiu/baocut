# DrawOp 关联 RGBA 位图协议

本文补充[视频格式规范](video-format-spec.md)的共享 CPU/native/WASM 绘制传输合同。实现入口为 `crates/render-raster/src/drawop.rs`；这里的版本指 BCOP 二进制信封，与场景求值版本独立。

`DrawEmissiveBitmap { blend, bitmap, opacity, tf }` 使用位图侧表中的四个独立 RGBA8 UNORM 分量。RGB 可以超过 alpha，alpha 为零时 RGB 仍可非零。`AssociatedBlend` 有 `SourceOver` 与 `Screen` 两种取值。

| 混合方式 | 最低信封版本 | opcode | 后续 payload |
| --- | --- | --- | --- |
| SourceOver | 6 | 14 | bitmap u32、opacity f32、tf 的六个 f32 |
| Screen | 7 | 15 | bitmap u32、opacity f32、tf 的六个 f32 |

所有数值为 little-endian。没有额外的 blend 字节；opcode 本身指定混合方式。位图侧表与 v5 相同。编码器根据实际操作选择最低所需版本：仅 SourceOver 发光位图仍写 v6，历史 opcode 14 的全部字节不变；不含新操作的 v3/v4/v5 编码也不变。解码器接受 v2–v8，低于 v7 的信封不得包含 opcode 15；解出的旧 opcode 14 明确为 SourceOver。

逆仿射以目标像素中心求源坐标，随后按源像素中心进行双线性采样。源范围外采样为透明零，不延伸边缘。opacity 钳制到 [0,1]，与 clip 覆盖率相乘并同时作用于源 RGBA 全部分量。非有限 opacity 或仿射值拒绝，奇异仿射不绘制；clip 尺寸必须与目标一致。

令覆盖率作用后的源为 `S`，当前真实绘制目标为 `D`，各分量均以 [0,1] 表示：

- SourceOver：`out.rgb = S.rgb + D.rgb × (1 − S.a)`，`out.a = S.a + D.a × (1 − S.a)`。
- Screen：对 RGBA 每个分量分别计算 `out = S + D × (1 − S)`。

Screen 不使用源 alpha 去缩放 RGB，也不执行普通预乘 alpha Screen 的颜色还原步骤。所有结果独立按最近整数舍入并钳制到 RGBA8 范围，不把 RGB 限到 alpha。

Screen 必须在最终绘制目标上执行。不得先把它画到透明字幕图，再将整图 SourceOver 到视频背景；这两种运算不等价。当前 DrawOp 执行器拒绝任何 `PushLayer` 或 `PushMatte` 内的 Screen 操作，返回 `ASSOCIATED_SCREEN_OFFSCREEN_UNSUPPORTED`，包括不透明度为 1、Normal 的离屏组。根级 `ClipPath` 及仿射变换可用。调用方若需要组不透明度、非 Normal 父混合、遮罩或其它离屏效果，必须有明确的最终背景合成实现，否则应拒绝该组合。

BCF 预览缩放只变换 `tf` 的六个分量，保留 bitmap、opacity 与 blend。时间线场景引用合并重映射位图侧表 ID，保留上述其余字段。协议与运算不依赖平台；GPU 实现及厂商纹理采样精度不在本合同内。

## Canvas 2D 原语（v8）

代码包的指令烘焙（[代码包规范 §7.2](code-bundle-spec.md#72-指令烘焙)）把 Canvas 2D 录制转成 DrawOp，需要 Canvas 的投影、虚线、混合模式与图案。它们只在 v8 信封里出现；帧里用到任何一项才写 v8，其余帧仍按原规则选最低版本，v2–v7 的编码逐字节不变。解码器在低于 v8 的信封里遇到 opcode 16–20 或 paint kind 3 一律拒绝。

| opcode | 操作 | 后续 payload |
| --- | --- | --- |
| 16 | `PushShadow` | color（直通 RGBA 四个 f32）、sigma f32、offset 两个 f32、window 四个 i32 |
| 17 | `PopShadow` | 无 |
| 18 | `StrokePathDash` | path u32、paint u32、width f32、cap u8、join u8、miter f32、dash 个数 u32 与各段 f32、dash_offset f32、tf 的六个 f32 |
| 19 | `PushBlend` | blend u8（与 `PushLayer` 的混合码相同） |
| 20 | `PopBlend` | 无 |

- **投影组**（16/17）。两者之间的绘制画进一块透明的设备空间窗口 `[x, y, w, h]`（整数像素；内部绘制的 `tf` 按窗口原点平移，不带裁剪）。`PopShadow` 对窗口的 alpha 做 σ = `sigma` 设备像素的高斯模糊，用 `color` 着色，按 `offset`（设备像素）合成，再合成窗口本身；两次合成都受当时的裁剪与混合约束。窗口必须容纳内部绘制的全部像素外加 3σ 的模糊范围。
- **虚线描边**（18）。等同 `StrokePathPaint` 加虚线：`dash` 以路径局部单位计，个数为非零偶数、总和为正；`dash_offset` 是相位。cap 0/1/2 为 butt/round/square，join 0/1/2 为 miter/round/bevel。
- **混合组**（19/20）。到匹配的 `PopBlend` 为止，每次填充、描边、位图与 `PopShadow` 都按这个混合模式直接合到当前目标上（不开离屏层）。嵌套在离屏层或投影窗口里的绘制仍是 SourceOver，由外层组带着这个模式合成。
- **图案**（paint kind 3）。payload 是 bitmap u32（位图侧表，预乘）、repeat u8（非零平铺，零则边缘像素延伸）、quality u8（0 最近邻、1 双线性、2 双三次）、opacity f32、transform 的六个 f32（位图像素 → 路径局部坐标）。

## 视频字幕输出边界

`CaptionPlan::render_layers` 交付按声明顺序排列的字幕平面；场景平面显式携带 `AssociatedBlend`，旧样式保留普通预乘混合类型。视频帧渲染器把每个平面直接合到当时的实际画面上。Screen 无论是否检测到 RGB > alpha 都走独立 RGBA 合成，不能根据像素内容改走另一种合同。

字幕实例及样式不透明度的乘积逐平面作用于源四分量，再执行该平面的混合；它不等于先拍平整个字幕组再淡出。已有普通单平面字幕继续使用原有合成及像素范围优化。兼容接口 `CaptionPlan::render` 可以返回旧单平面，或合并多个 SourceOver 平面；遇到非空 Screen 平面返回 `CAPTION_BACKDROP_REQUIRED`，调用方须使用有序输出接口。
