# `core/fixtures/progress/` —— progress 元素的 conformance 夹具

[`docs/design/bcf/bcut-element-render-foundation-design.md`](../../../docs/design/bcf/bcut-element-render-foundation-design.md)
§7.4（14 种 progress 登记表）与 §11（测试策略）的产物。

一句话：**输入固定在 `cases.json`，每个阶段各自追加自己的 expected 文件。**
P3 钉的是 6 种 strict 样式的 DrawOp 指令流，P4 加上了 `snake` / `snake_spin`；
P5（rainbow / strobe 四种 + GPU 对拍）复用同一份输入。

**这些文件不是手写的，也不要手改。**

```bash
cd core
cargo test -p bcut-render --test progress_draw                # 校验（含 up-to-date 门禁）
cargo test -p bcut-render --test progress_draw -- --ignored   # 确认过再重生成
```

生成器就是 `crates/bcut-render/tests/progress_draw.rs` 自己——生成端与消费端
共用同一批函数，`the_progress_fixtures_are_up_to_date` 因此是「当场重算再逐字节比」
的真门禁。

## 为什么与 `../visualizer/` 分开

progress **没有素材源**：内容完全由播放头推导，
`progress = clamp((t − start) / (end − start), 0, 1)`（真相在
`bcut_timeline::geometry::progress_at`）。因此它的输入里没有 BCS1、没有时刻表、
没有乱序序列，只有 `(progress, 元素盒, 两个颜色)`。硬塞进 visualizer 的
`cases.json` 会让那份文件长出一半用不上的字段，而那份文件是 P2 冻结的。

## 布局

| 路径 | 内容 |
| --- | --- |
| `cases.json` | **输入**：五个进度值（+ 与之配对的五个时刻）+ 三种元素盒 + 两个颜色 + 像素折算系数 + 14 个样式 id |
| `expected-draw.json` | **P3/P4 的 golden**：14 种样式 × 5 个 (进度, 时刻) 的 DrawOp 条数 / path 数 / 指纹 |

## 元素盒与像素单位

三只盒子直接来自 `bcut_timeline::geometry` 的默认几何表在 1920×1080 上的像素：

| aspect | 盒子 | 用在 |
| --- | --- | --- |
| `bar` | 画幅 80% × 5%，居中 | `normal` / `rounded` |
| `square` | 画幅 30% × 30%，居中 | `circle` / `donut` / `snake*` |
| `frame` | 画幅 100% × 100% | `*border` 六种 |

`times` 是 **P4 追加**的一列，与 `progress` 一一配对，含义是**元素本地时刻**
（`t − element.start`，秒；对应参考实现的 `u_time`）。P3 的六种与时刻无关，加上
这一列它们的指纹逐字未变；只有 `snake_spin` 的自转相位读它。取值刻意不是
`progress × 7.2 s`（50 °/s 下的一整圈）——那样自转会被进度正好抵消，等于没测。

`pixelScale = 2.0` 是 `short_edge(1080) / REFERENCE_SHORT_EDGE(540)`：配方里的
像素单位参数（`rounded` 的 `corner.radiusPx`）按 P0 已定的长度口径折算，与
`strokeWidth` / `cornerRadius` / `lower_element_effects` 逐字相同。

## 矢量与 shader 的换算

参考 shader 逐像素算 alpha，矢量侧没有
"半个像素"。因此：

- 颜色/几何的边画在 **`factor == 0.5` 的半覆盖等值线**上
  （`bcut_render::source::kernel` 的模块文档给出闭式反解）；
- 纯抗锯齿参数（`intervalPx` / `insetRatio` / `alphaEdge` / `featherPx` /
  `edgeFeatherPx`，以及 `snake` 的 `smoothing` / `boostSteps`）**不读**——矢量边由
  光栅器抗锯齿。P5 的 WGSL 会逐字用上它们。
- `snake` 的逐度循环换成**扫掠并集的闭式**（`kernel::swept_arc_subpath`）：
  圆心间距只有圆半径的十四分之一，叠加场在并集内部早已饱和，半覆盖等值线就是
  并集的边界。`maxIterations` / `angleIncrementDeg` / `startAngleDeg` 仍是数据
  真相，它们决定**圈数与起止角**，几何本身不再逐圆画。

## 后续阶段怎么接

| 阶段 | 新增文件 | 比什么 |
| --- | --- | --- |
| P4 | 复用 `expected-draw.json`（`cases.json` 追加 `times` 一列） | `snake` / `snake_spin` 的 `ops` 从 0 变成真实条数 |
| P5 | 复用 + `expected-gpu.json` | rainbow / strobe 四种上线；GPU 与 CPU 参照的 SSIM / 最大偏差（§8.7） |
| P6 | 复用 `expected-draw.json` | wasm 里跑同一批输入，指令流必须逐字节相同 |

新增 expected 文件时**不要动 `cases.json`**——输入一改，前面阶段的 golden 全部
失去可比性。确实需要新输入就往末尾追加，让既有编号不动。
