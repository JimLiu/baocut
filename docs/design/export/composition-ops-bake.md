# 代码包的指令烘焙（Canvas 录制 → DrawOp）

状态：第一期已实现（2026-10-17）。规范性的内容在[代码包规范 §7.1–§7.3](../../spec/code-bundle-spec.md#7-bake-与降级) 与 [DrawOp 协议 v8](../../spec/drawop-binary-spec.md#canvas-2d-原语v8)，这里记为什么这样做、实测数据与第二期。

## 1. 问题

整镜由代码画的讲解片，每段都是 `baocut/1` 的 Canvas 代码包，导入时要烘焙成 ProRes。像素烘焙每帧经过 seek → 等 paint → `capturePage` → PNG → base64 → JSON 行 → ffmpeg `image2pipe`，约 0.37 秒一帧（M2，1080×1920，2.7 帧/秒），一部 8 段、9000 多帧的片要烘焙近一小时。时间几乎都在 Electron 主进程的截图与 PNG 编码上，页面画一帧本身很快。

下游（导出、编辑器预览、项目导出）只读预渲染 `.mov`，换渲染器不必改下游。

## 2. 做法

1. **录制**（`packages/code-runtime/src/canvas-recorder.ts`）：在离屏宿主里包装 `CanvasRenderingContext2D.prototype`，照常调用原方法，同时把主画布上的调用记成指令。状态直接读真实 context，只自己跟踪路径与裁剪栈；每帧带上延续下来的路径与裁剪（`init`），各帧可以并行转换。录制不等 rAF、不截图，一次宿主调用录 30 帧。
2. **对拍**：同一会话里照常截 5 帧样本，Worker 先光栅这几帧用 `imgcmp` 比较，通过才整段光栅。
3. **转换与光栅**（`crates/render-raster/src/canvas2d/`，`export-worker canvas-bake`）：录制按帧转成 `FrameOps`，多线程 tiny-skia 光栅，RGBA 按帧序直接写进 Worker 启动的 ffmpeg，不经过 Node。
4. **编码**：macOS 能用 `prores_videotoolbox` 时用硬件编码（1080×1920 HQ 约 243 帧/秒，`prores_ks` 约 45 帧/秒），否则 `prores_ks`；产物的配置与像素格式与像素烘焙相同。Windows 与 Linux 走 `prores_ks`，Worker 的子进程隐藏控制台。
5. **回退**：录制里有不支持的调用、样本对不上、没有 Worker 或 Worker 失败时整段回退像素烘焙，原因写进结果的 `bake.fallback`。不按帧混用两种渲染器：同一段里画面的细微差别会在切换处闪一下。
6. **工作目录**：录制与预渲染放在视频所在卷的 `blobs/.staging/` 下（导入时同卷复制），不占系统盘。

## 3. 取舍

- **文字**：对齐与基线偏移用 Chromium 的 `measureText`，Rust 用包里的字体整形成轮廓。实验表明 Chromium 不给 OS/2 字重 ≥ 600 的字体文件再加合成粗体（即使 `@font-face` 声明 400）；给常规体加粗时，加粗量在 68px 约为 Skia 公式的一半、20px 几乎为零，且随平台变化。所以真正的合成粗体判为不支持，合成斜体按 0.25 的切变还原。中文里「》（」这类相邻全角标点，Chromium 默认按 `text-spacing-trim: normal` 挤掉半个字宽（Blink 的 HanKerning，靠字体的 `chws` / `halt`），Rust 侧照搬了它的分类与成对规则，否则宽度对不上整段回退。
- **字形平滑**：macOS CoreText 让 Chromium 的文字比 tiny-skia 粗约 7%，文字边缘的逐像素偏差能到 200 以上。不追这个差别：对拍用 4× 降采样 SSIM、平坦区偏差与过渡带占比，不用逐像素最大偏差。
- **渐变**：两圆径向渐变的一般情况逐像素解二次方程生成位图并跨帧缓存；同心与 `r0 = 0` 直接用 tiny-skia。Chromium 的渐变带抖动，平坦区阈值放到 4/255。
- **投影**用局部窗口，不开整幅层（1080×1920 一层 8 MB）。

## 4. 实测（s02：730 帧，1080×1920，30 帧/秒，不透明；M2 8 核）

| 路线 | 总用时 | 平均帧率 |
| --- | --- | --- |
| 像素烘焙 | 262 s | 2.8 |
| 指令烘焙 | 13.4 s | 54.5 |

指令烘焙的各阶段：录制 1.07 s（680 帧/秒），截 5 帧样本 1.74 s，对拍 1.35 s，光栅加编码 10.6 s（82 帧/秒；8 线程光栅的容量约 96 帧/秒，写进编码器时有 53% 的时间在等 ffmpeg，编码与格式转换是下一个瓶颈）。

画面：均匀取的 20 帧与 Chromium 截图相比，SSIM 0.989–0.995，4× 降采样 SSIM ≥ 0.9957，平坦区最大偏差 ≤ 3，过渡带占比 ≤ 1.05%。两份成片逐帧比较（ffmpeg，含两边的编码损失）：730 帧 SSIM 最低 0.9942、平均 0.9965，PSNR 最低 36.7 dB、平均 40.5 dB。

没有在 Windows 实机上验证。

## 5. 第二期

- GPU DrawOp 执行器（wgpu），导出直接渲染指令，不经 ProRes 中间文件；VideoToolbox 零拷贝。
- 编码成为瓶颈时按帧区间分段并行编码再拼接（ProRes 帧内编码，可以无损拼接）。
- 像素路线本身的提速（不经 PNG、并行取帧）。
- 多张画布、DOM 文字层、`filter`、局部 `clearRect` 的支持。
