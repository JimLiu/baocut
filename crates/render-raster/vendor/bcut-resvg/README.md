# bcut-resvg

[resvg](https://github.com/linebender/resvg) **0.45.1**（crates.io 发布包，Apache-2.0 OR MIT，许可正文见同目录 `LICENSE-APACHE` / `LICENSE-MIT`）加六处 BaoCut 补丁：四处修正确性，两处只提速、输出逐字节不变。包名改成 `bcut-resvg`、库名仍是 `resvg`，只由 `bcut-render` 以 `resvg = { package = "bcut-resvg", … }` 引用，调用处照旧写 `resvg::…`。不走 `[patch.crates-io]`：`apps/baocut` 的 GPUI 另用 resvg 0.46，全局换包会碰到它。

去掉了上游的命令行程序（`src/main.rs`）、示例与它们专用的 `pico-args` 依赖，其余源码逐字保留。

## 补丁

用 `diff -r ~/.cargo/registry/src/*/resvg-0.45.1/src src` 可以看到全部改动，每处都带 `bcut-resvg:` 注释。

| 位置 | 改了什么 | 为什么 |
| --- | --- | --- |
| `src/render.rs` `render_group` | 子节点渲染时，把钳位矩形 `max_bbox` 平移到当前图层的像素坐标（`translate(-ibbox.x, -ibbox.y)`），`mask::apply` 也用平移后的那份 | 上游把画布坐标的矩形原样传进嵌套图层。图层离画布原点越远，被裁得越多：内层图层比它的滤镜区域小，`feDisplacementMap` 断言源图、位移图、目标三者同尺寸时 panic；没有 panic 的帧也会在画面边缘少一截（实测 `program` 元素一帧右缘 32 px 变黑） |
| `src/render.rs` `layer_clamp_rect`、`src/lib.rs` | 钳位矩形从画布 −2W..3W（5 倍）收到四周各留长边的 1/4 | 5 倍画布的图层是可见区 25 倍的内存与模糊耗时。更远的像素只有经位移超过这段余量的滤镜才能进画面；实测 1/8、1/2、2 倍三档输出逐字节相同 |
| `src/filter/mod.rs` `apply_inner` | 滤镜区域与图层尺寸不一致时，改用图层的整幅 `(0, 0, w, h)` | 图层被钳位或取整差一像素后，各原语拿到的图像尺寸不一；统一成图层尺寸后每个原语都在同一幅图上算 |
| `src/filter/mod.rs` `apply_displacement_map` | 只把画布缩放传给 `displacement_map::apply`（它自己再乘 `scale`）；位移图先去预乘再读通道 | 上游传的是 `scale × 画布缩放`，`scale` 被平方：`scale="30"` 把像素挪出最多 450 px 而不是 15 px，烟雾、火焰一类被撕成碎块并整体偏向右下。上游还拿预乘过的位移图读通道（规范与该函数的注释都要求不预乘），`feTurbulence` 这种半透明噪声会让所有像素一齐往左上偏。0.46.0 同样有这两处 |
| `src/filter/iir_blur.rs` | 四个通道交错进同一块 `[f64; 4]` 缓冲一起算；纵向一趟从逐列改成逐行扫所有列 | 上游逐通道、逐列跨行访问，每次取样都不命中缓存，σ < 2 的模糊是 `program` 元素一帧里最重的一项。各通道、各列互不读取，每个值经历的运算与顺序不变，所以输出逐位相同 |
| `src/filter/box_blur.rs` `box_blur_vert` | 纵向滑窗从逐列改成每列一个整数累加器、逐行推进 | 同上的跨行访问；两侧补零时每个输出就是窗口内现存各行的整数和，整数和与求和顺序无关，结果逐位相同 |

## 验证

`cargo test -p bcut-resvg`（从 `core/` 运行）：

- 普通文档（无滤镜、画布内滤镜、遮罩、裁剪、透明组，以及走 IIR 与盒模糊两条路径、含盒半径超过区域高度的高斯模糊；不含 `feDisplacementMap`）与上游 0.45.1 逐字节相同；
- 嵌套透明组的内容从画布外伸进来时不再被裁掉；
- 滤镜区域大于图层钳位的 `feTurbulence` + `feDisplacementMap` 不再 panic；
- `feDisplacementMap` 按 `scale × (C − 0.5)` 移动像素（不透明与半透明位移图、带缩放的组），与 Chrome 一致。

升级上游版本时：换源码、逐条重放上表补丁、重跑上面三组测试，并更新本表的版本号。
