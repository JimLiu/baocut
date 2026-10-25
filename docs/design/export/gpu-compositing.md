# 导出合成上 GPU（方案稿）

成片导出（`export-worker render`，架构设计 §9.11）的合成现在全在 CPU 上（`frame-render` → `subtitle-render` 的 `OverlayRenderPlan` → `render-raster` 的 tiny-skia 执行器）。本文是把合成搬上 GPU 的方案：范围、接缝、像素一致性、回读与硬件编码的衔接、回落。**只是设计，没有实现**；改默认导出路径前要按 §7 量过、经用户确认。

相关：[Windows 导出媒体路径待办](windows-media-path-todo.md) 的 W9（合成线程是瓶颈）、W5（硬件解码）、W3（编码输入直写）；架构设计 §9.1（预览与导出逐字节一致）、§9.3（在 sRGB 编码值上混合）、§9.4（GPU 之间按声明的容差验收）、§9.6（硬件路径协商并报告，零拷贝不是首版假设）；动态字幕格式设计 §10.1（字幕的 GPU 执行另有合同）。

## 目录

1. [现状](#1-现状)
2. [目标与不做的事](#2-目标与不做的事)
3. [现有的 GPU 部件](#3-现有的-gpu-部件)
4. [方案](#4-方案)
5. [像素一致性](#5-像素一致性)
6. [回落与报告](#6-回落与报告)
7. [验证与上线门槛](#7-验证与上线门槛)
8. [分期](#8-分期)
9. [待评审事项](#9-待评审事项)

## 1. 现状

RTX 3060 主机、1080p30 双语字幕夹具（`tools/export-bench.ts`）：NVENC 在编码（`nvidia-smi` 的编码器占用平均约 32%），解码在 CPU 上，合成线程是瓶颈，编码器在等它（W9）。W9 之后合成线程每帧约 7.7 ms（空闲；之前 8.3 ms），常见形状（整幅视频加字幕）每帧还剩这些整帧大小的 CPU 遍历：

| 步骤 | 在哪 | 做什么 |
| --- | --- | --- |
| 解码 | `media-native` 的 Source Reader | 软件解码与 YUV→RGB32，再整帧搬成 RGBA（W1、W2、W5） |
| 视频层 | `render-raster` 的 `copy_over` | 解出的画面扫一遍、拷进内核的画布（画布跨帧复用，源画面共享不复制） |
| 接管 | `frame-render` 的 `composite` | 扫一遍 alpha，整幅不透明就直接接管成帧 |
| 字幕 | `composite_caption_layer` | 只在非零像素的外包矩形里混合 |
| 编码输入 | `encode_windows.rs` 的 `rgba_to_nv12` | 编码线程上换成 NV12，再整帧拷进 Media Foundation 的缓冲（W3） |

GPU 合成只有在它**去掉**这些遍历时才有收益；如果只是把 CPU 画好的帧传上去再读回来，就多了一次上传和一次回读。

## 2. 目标与不做的事

- 目标：合成线程每帧的 CPU 时间明显下降，机器满载时导出不慢于 CPU 路径；像素差在 §5 的容差内。
- CPU 实现保持为规范实现与回落。预览的 WASM 不能开 `render-raster` 的 `gpu` feature（wasm32 上编译报错），继续走 CPU。
- 不做：字幕的 GPU 排版与光栅（动态字幕格式设计 §10.1 的范围，这里字幕仍是 CPU 光栅好再上传）；第一版不在 GPU 上做 `fx`、元素遮罩、转场与层效果（描边、阴影），这些层继续 CPU 光栅；不改编码合同（码率、GOP、profile、VUI）。

## 3. 现有的 GPU 部件

- **`render-raster` 的 `gpu` feature**：wgpu 30（Metal、Vulkan、DX12）。`GpuExecutor` 只执行 `ShaderQuad`（14 种进度条着色器），没有 GPU 的 `PassExecutor`（这个 trait 按 `tiny_skia::Pixmap` 定型，唯一的实现是 `CpuExecutor`）。设备选择在 Windows 上先试 DX12、macOS 上先试 Metal，拒绝软件适配器；也能接宿主给的设备（`from_device`）。回落原因的分类在 `plan/gpu_fallback.rs`，CPU 与 GPU 对拍的容差分级在 `imgcmp.rs`。
- **`compositor` crate**（`gpu` feature，从 v2 移植）：retained scene 执行器，有字形图集、矢量、带源效果的纹理、模糊、Screen 的固定管线混合、Difference / Exclusion 的采样目标混合，以及接平台纹理的 `ExternalTextureImporter`（CoreVideo、DXGI、Web，带租约，防止解码器在 GPU 还在采样时复用表面）。`OfflineCompositor` 是给导出用的：持久的目标纹理加按行对齐的回读缓冲，`render_rgba`、`render_over_bgra`、`render_over_black` 回读，`render_over_texture_at` 不回读。**目前没有 crate 依赖它**。
- **`subtitle-render` 的 `compositor_scene_frame`**：把 `OverlayRenderPlan` 的一帧变成与渲染器无关的场景（图片与视频是 `TextureNode`）；`compositor_scene_support` 是静态的准入检查。只有测试在用。
- **对拍测试**：`compositor/tests/gpu_target.rs` 用 CPU 的 `render_rgba` 作参考，按容差比 GPU 的输出；`BAOCUT_REQUIRE_GPU=1` 时没有 GPU 算失败。
- **导出路径不碰 GPU**：`export-worker`、`media-core` 与 `media-native` 的导出部分都只交换 CPU 内存里的帧。D3D11 的共享纹理池与共享 fence 只在播放的 frame server（`media-native` 的 `playback_windows.rs`）。

## 4. 方案

### 4.1 接缝：帧级的合成目标

不做 GPU 的 `PassExecutor`（帧计划里的 Filter、Mask、Backdrop 等都要各写一份 GPU 实现，且 trait 按 `Pixmap` 定型），也不整帧换成 `compositor_scene_frame`（`frame-render` 每层用一个只含一个实例的内核计划画，转场、层效果、字幕分组都在 `frame-render` 这一层）。接缝放在 `FrameRenderer::render` 的层循环：今天每层画成一幅 CPU 画布再 `composite` 到 `self.frame`，字幕用 `composite_caption_layer` 叠上去。把「帧」抽成合成目标，两种实现：

- **CPU 目标**：现在的 `frame: Pixmap`、`composite` 与 `composite_caption_layer`，逐字节不变。
- **GPU 目标**：`compositor` 的离屏目标纹理。每层以两种形态之一交给它：
  - `Placed`：源画面（`Arc<Pixmap>`，与 `LayerMedia::picture` 共享的那一份）加仿射、不透明度与盒子。只给内核会画成「源画面的一次仿射拷贝」的层：`render_media_element` 里没有 `fx`、元素遮罩、虹膜、平铺、姿态模糊，背景板只有黑或纯色。同一解码帧（`generation` 不变）只上传一次。
  - `Raster`：CPU 照今天这样光栅好的层（字幕、文字、模板、矢量、带效果或转场的层），只上传非零像素的外包矩形（与 `composite_bounded` 同一个矩形）；字幕层按字幕的光栅键缓存，没变就不重传（`studio-color` 的 300 帧只光栅 79 次）。

`frame-render` 加一个可选的 `gpu` feature（依赖 `compositor/gpu`），`preview-wasm` 不开；`export-worker` 在 Windows 与 macOS 上开，运行时按 §6 选择。

### 4.2 帧流水线与回读

- 合成线程提交第 k 帧后去收第 k−2 帧的回读：上传槽、目标纹理与回读缓冲各 3 份轮换，从不对刚提交的那一帧 `poll(wait)`。`map_async` 的回调由合成线程每帧 `poll(Poll)` 推进。
- 在 GPU 上把 RGBA 换成 NV12（Y 与交错 UV 两个平面），回读 3.1 MB 而不是 8.3 MB，编码线程的 `rgba_to_nv12` 随之去掉（编码输入按 W3 直写进 Media Foundation 的缓冲）。
- 回读的 `bytes_per_row` 要按 256 字节对齐：1920×4 恰好对齐，NV12 的 Y 平面 1920 字节不对齐，按对齐的行拷出再逐行去掉补齐（`OfflineCompositor` 已经这样做）。
- 上传不是免费的：`queue.write_texture` 要把解出的画面拷进 wgpu 的暂存区，代替了今天的 `copy_over`（同样是一次整帧拷贝）。所以 §4.3 的甲级不减少视频层的拷贝次数，收益只来自去掉接管扫描、字幕混合与 NV12 转换；这正是要先量的原因。

### 4.3 与硬件编码的衔接

分三级，每一级都要量过才进下一级：

| 级 | 输入 | 输出 | 每帧经 CPU 的整帧数据 | 依赖 |
| --- | --- | --- | --- | --- |
| 甲 | CPU 解出的 RGBA，上传 | GPU 上转 NV12，回读进编码器的内存缓冲 | 上传 8.3 MB + 回读 3.1 MB | W3 |
| 乙 | 同甲 | NV12 直接写进与编码器共享的 D3D11 纹理（macOS：IOSurface 的 `CVPixelBuffer`），不回读 | 上传 8.3 MB | 共享纹理与跨 API 同步 |
| 丙 | 硬件解出的 NV12 纹理，经 `ExternalTextureImporter` 导入，在 GPU 上转 RGB | 同乙 | 0 | W5（像素会变） |

- **乙级（Windows）**：wgpu 跑在 DX12 上；输出纹理用 `D3D11_RESOURCE_MISC_SHARED_NTHANDLE` 在 D3D11 设备上建，在 DX12 一侧打开、经 `create_texture_from_hal` 交给 wgpu；Sink Writer 配 `MF_SINK_WRITER_D3D_MANAGER`（`IMFDXGIDeviceManager`），sample 用 `MFCreateDXGISurfaceBuffer` 包这块纹理，NVENC 直接读。两个 API 之间用共享 fence 同步（播放的 frame server 已有 D3D11 共享纹理池加共享 fence 的写法）；另一条路是 v2 用过的 D3D11On12。纹理池至少三块，编码器释放 sample 之前不复用。
- **乙级（macOS）**：从 `AVAssetWriterInputPixelBufferAdaptor` 的池里取 IOSurface 支撑的 `CVPixelBuffer`，经 `CVMetalTextureCache` 得到 Metal 纹理，再经 wgpu-hal 的 Metal 导入当目标。
- **丙级**：解码器的表面在 GPU 采样完之前不能被复用（租约）。硬件解码与 GPU 上的 YUV→RGB 都会改像素，与 W5 一同要用户确认。

## 5. 像素一致性

- GPU 导出是另一个声明了容差的后端（架构设计 §9.4）。§9.1 的「预览与导出逐字节一致」继续约束 CPU 导出；GPU 导出与 CPU 参考按 `imgcmp` 的严格档对拍：平坦区每通道差 ≤ 2/255、边缘像素占比 ≤ 20%、4 倍下采样后 SSIM ≥ 0.98，能更严的地方更严。导出缺省改走 GPU 会改变成片的像素，必须经用户确认。
- 能逐字节的地方必须逐字节：恒等摆放（整幅视频、恒等画中画）用纹理到纹理的拷贝或整数偏移的最近邻采样；目标格式用 `Rgba8Unorm`（不是 `Rgba8UnormSrgb`），在编码值上混合（§9.3）；预乘的 `One, OneMinusSrcAlpha`。
- 已知的差异来源，都要进对拍清单：
  - 双线性的权重：tiny-skia 的定点与 highp 管线，与 GPU 采样器的 8 位小数权重、纹素中心约定不同；
  - 缩小采样：CPU 在某一轴倍率低于 0.5 时先按面积平均再双线性（架构设计 §9.3）；GPU 合成器的采样器是 `Linear`、纹理只有一级 mip，缩到一半以下的层会混叠。这样的层要先在 GPU 上做同样的整数面积平均，或由 CPU 缩好再上传，否则不进 §4.1 的形态；
  - 混合的取整：unorm8 的就近取整与 tiny-skia lowp 的 `div255` 近似；
  - 关联 alpha（发光分量 rgb > a、Screen 混合）：CPU 走 `composite_associated`，GPU 要走 `compositor` 的关联 RGBA 路径；
  - 不透明度：CPU 的 `multiply_premultiplied_alpha` 按通道在 f64 里取整；
  - NV12 转换：GPU 着色器、`rgba_to_nv12` 与 libswscale 三者不同；
  - 厂商之间采样精度不同：对拍要在 NVIDIA、AMD、Intel 各跑一遍（W7 的三台机器）。
- 一次导出里不换后端：中途从 GPU 换回 CPU 会在换的那一帧看出跳变。

## 6. 回落与报告

- 每次导出在预检时定一次：有硬件适配器、建得了设备；计划里每一层都在 §4.1 的形态里（否则整次导出走 CPU）；尺寸不超过设备的最大纹理边长。
- `BAOCUT_EXPORT_GPU=0` 强制走 CPU（与 `BAOCUT_EXPORT_NATIVE` 同一种开关）。§7 的门槛过了、用户确认之前，缺省仍是 CPU，GPU 只在 `BAOCUT_EXPORT_GPU=1` 时开。
- 导出中途设备丢失或出错：这次尝试作废，从头按 CPU 重导，不在文件中间换后端。
- `done.video` 增加合成后端（`cpu`，或 `gpu` 加图形 API 与适配器名）与回落原因（`gpu_fallback` 的分类），与编解码后端一样协商并报告（架构设计 §9.6）。
- 显存：1080p 三份轮换约 3 ×（8.3 + 8.3 + 3.1）MB ≈ 60 MB，4K 是四倍；拿不到可用显存时报告未知，不猜。

## 7. 验证与上线门槛

- **对拍**：`frame-render` 的一致性夹具（`tests/fixtures/parity.json`）每一帧分别用 CPU 目标与 GPU 目标画，按 §5 的容差比；恒等拷贝的层逐字节比。有 GPU 的机器上设 `BAOCUT_REQUIRE_GPU=1`。
- **导出**：`tools/export-bench.ts --baseline` 交替跑 CPU 与 GPU，空闲与满载（起超过核数的忙进程）各一组，在 RTX 3060 主机与一台 Mac 上；夹具除了整幅视频加 `studio-color` 字幕（CPU 路径的最好情形），再加一个重的：画中画、转场、`studio-transition` 字幕。
- **门槛**：甲级要让合成线程每帧时间下降至少 30%，且满载时输出帧率不低于 CPU；达不到就不发甲级，直接做乙级。
- **编码合同**：`ffprobe -show_streams -show_frames` 核对 profile、GOP、BT.709 的 VUI 与码率不变。

## 8. 分期

| 期 | 内容 | 像素 |
| --- | --- | --- |
| G0 | CPU 路径去掉多余的整帧拷贝与分配（W9，已完成），量剩下的成本 | 不变 |
| G1 | 在 `frame-render` 里抽出合成目标，只有 CPU 实现 | 不变（`framemd5` 逐帧比） |
| G2 | GPU 目标的甲级，`BAOCUT_EXPORT_GPU=1` 才开，加对拍测试 | 容差内 |
| G3 | 乙级：Windows 的编码器共享纹理，之后 macOS | 容差内 |
| G4 | 丙级：随 W5 的硬件解码 | 会变，要确认 |

## 9. 待评审事项

- GPU 导出与预览只在容差内一致，产品上能不能接受；能接受的话，架构设计 §9.1 要写明这条例外。
- 乙级的 D3D11 设备与播放的 frame server 共用一份，还是导出单独建。
- 甲级值不值得做：G2 量完再定，结果不过门槛就跳到乙级。
