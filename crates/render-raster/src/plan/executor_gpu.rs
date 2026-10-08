//! wgpu 后端的 `ShaderQuad` 执行器（元素方案 ADR-E06 / §10 P5）。
//!
//! **CPU tiny-skia 是 strict reference，本执行器只是加速器**（ADR-M05）：起不来、
//! 编不过、过不了 conformance，一律记进 [`GpuBackendReport`] 并回退 CPU，画面
//! 不受影响。整个模块挂在 `gpu` feature 上，默认关闭。
//!
//! ## 与 `PassExecutor` 的关系
//!
//! motion 阶段 4 的 [`super::PassExecutor`]（`draw` / `filter` / `transition` /
//! `composite`）**已经落地**。`ShaderQuad` 不是那四条里的任何一条，而 §10 P5
//! 明写"P5 不得单方面改 BCOP / DrawOp v3 是阶段 4 的决定"——给 `RenderPass`
//! 加第五个变体会连带动 `FRAME_PLAN_VERSION` 与计划编码。因此 P5a 的做法是：
//! [`GpuExecutor`] 是一个**独立的 quad 执行器**，与 `PassExecutor` 并存不冲突；
//! 两条线合流时，把 [`GpuExecutor::render_quad`] 挂成第五条 pass 方法即可。
//!
//! ## 一次 quad 的执行路径（§8.1 / §8.3 / §8.5）
//!
//! 1. 单 quad（4 顶点、triangle strip），几何全部在 fragment 里程序化生成；
//! 2. 顶点着色器做 **y-flip**，纹理坐标原点左上；
//! 3. 音频数据以 `R8Unorm`、`w × 2`、**row 0 = 时域 / row 1 = 频域、无 flip**
//!    的纹理上传；采样器 linear + clamp-to-edge；
//! 4. `@group(1)` 按 §8.2 的冻结顺序逐 binding 发独立 uniform buffer；
//! 5. 输出 **premultiplied alpha**，渲染目标是 `Rgba8Unorm`（**非 sRGB**：
//!    §8.5 说 uniform 与输出均为 linear RGBA，而 tiny-skia 的 `Pixmap` 也是
//!    linear 预乘字节，两边因此是同一个数域，回读不做任何色彩变换）。

use std::collections::HashMap;

use anyhow::{Result, bail};
// 只有 naga 校验（与带它的 native `gpu`）用得到。
#[cfg(feature = "wgsl-validate")]
use anyhow::{Context, anyhow};
#[cfg(feature = "gpu")]
use tiny_skia::Pixmap;

use super::gpu_fallback::GpuBackendReport;
#[cfg(feature = "gpu")]
use super::gpu_fallback::GpuFallbackReason;
#[cfg(feature = "gpu")]
use super::shader_quad::QuadUniforms;
use super::shader_quad::{AudioTexture, ShaderQuad, UniformBinding};
use super::shader_source::{FRAGMENT_ENTRY, ShaderDomain, ShaderSource, VERTEX_ENTRY};

/// 回读缓冲的行对齐（wgpu 的硬要求）。
#[cfg(feature = "gpu")]
const COPY_ALIGN: u32 = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;

/// 单 quad 的顶点：`(pos.xy, uv.xy)`。
///
/// `pos` 已经在 NDC 里（`u_transform` 是单位阵），**并且预先按顶点着色器那句
/// `-pos.y` 反了一次**——于是 `uv.y == 0` 落在画面顶边，纹理坐标原点左上
/// （§8.1）。§8.1 冻结的是那句 y-flip，配它的顶点数据就是这四个。
#[rustfmt::skip]
const QUAD_VERTICES: [f32; 16] = [
    -1.0, -1.0, 0.0, 0.0, // 左上
     1.0, -1.0, 1.0, 0.0, // 右上
    -1.0,  1.0, 0.0, 1.0, // 左下
     1.0,  1.0, 1.0, 1.0, // 右下
];

/// wgpu 设备 + 管线缓存。
pub struct GpuExecutor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    backend: String,
    adapter_name: String,
    sampler: wgpu::Sampler,
    vertices: wgpu::Buffer,
    group0: wgpu::BindGroupLayout,
    group1_visualizer: wgpu::BindGroupLayout,
    group1_progress: wgpu::BindGroupLayout,
    group2_audio: wgpu::BindGroupLayout,
    group2_empty: wgpu::BindGroupLayout,
    group3_recipe: wgpu::BindGroupLayout,
    pipelines: HashMap<String, wgpu::RenderPipeline>,
    live_bindings: Vec<LiveBindings>,
    live_binding_rebuilds: u64,
    report: GpuBackendReport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LiveBindingSignature {
    domain: ShaderDomain,
    recipe_bytes: usize,
    audio: Option<(u32, u32)>,
}

struct LiveUniformGroup {
    buffers: Vec<wgpu::Buffer>,
    bind_group: wgpu::BindGroup,
}

enum LiveDataGroup {
    Audio {
        texture: wgpu::Texture,
        bind_group: wgpu::BindGroup,
    },
    Empty(wgpu::BindGroup),
}

struct LiveBindings {
    signature: LiveBindingSignature,
    group0: LiveUniformGroup,
    group1: LiveUniformGroup,
    group2: LiveDataGroup,
    group3: LiveUniformGroup,
}

struct LiveBindingLayouts<'a> {
    group0: &'a wgpu::BindGroupLayout,
    group1: &'a wgpu::BindGroupLayout,
    group2_audio: &'a wgpu::BindGroupLayout,
    group2_empty: &'a wgpu::BindGroupLayout,
    group3: &'a wgpu::BindGroupLayout,
    sampler: &'a wgpu::Sampler,
}

struct LiveBindingPayload<'a> {
    transform: &'a [UniformBinding],
    uniforms: &'a [UniformBinding],
    recipe: &'a [UniformBinding],
    audio: Option<&'a AudioTexture>,
}

impl GpuExecutor {
    /// 初始化设备。**每个平台先探它自己的原生后端**，拿不到再退别的；
    /// 一个都没有就是 `Err`，调用方回退 CPU。
    ///
    /// 顺序不只是「哪个快一点」——它决定了平台直达编码路径能不能用：
    ///
    /// - **Windows**：Media Foundation 的直达编码（`bcut-kernel` 的
    ///   `studio_export/video_windows.rs`：D3D11On12 ＋ `IMFDXGIDeviceManager`）
    ///   只能从 **DX12** 的 wgpu device 借出 `ID3D12Device` / `ID3D12CommandQueue`。
    ///   挑中 Vulkan 时那边的 `raw_dx12()` 当场失败、整条直达路径静默作废，导出
    ///   于是退回「每帧 GPU 合成 → 回读 8 MB 到 CPU → CPU 转 NV12 → 内存样本」。
    ///   代价没有单独拆出来过（`BCUT_EXPORT_PROFILE` 把回读算在「GPU 合成+回读」
    ///   里），能确定的是它每帧多一次全画面回读加一次 CPU NV12 转换——后者在
    ///   720p / 1799 帧 / RTX 3060 上实测 1.1 ms/帧。
    ///   而 Windows 上 Vulkan **总是**先于 DX12 命中（NVIDIA/AMD 驱动都带
    ///   Vulkan），所以原来的固定顺序等于让那条路永远走不到。
    /// - **macOS**：先只开 Metal 探一次。`Backends::all()` 在 macOS 上也可能挑到
    ///   别的后端（例如经 MoltenVK 的 Vulkan），而我们要的是原生那条。
    ///
    /// 探不到的档会立刻失败并落到下一个，所以每个平台把不存在的后端留在列表里
    /// 是无害的；这样三条分支形状一致，也不会漏掉「新机器上只有某一个」的情况。
    #[cfg(feature = "gpu")]
    pub fn new() -> Result<GpuExecutor> {
        let order = if cfg!(target_os = "macos") {
            [
                wgpu::Backends::METAL,
                wgpu::Backends::VULKAN,
                wgpu::Backends::DX12,
            ]
        } else if cfg!(target_os = "windows") {
            [
                wgpu::Backends::DX12,
                wgpu::Backends::VULKAN,
                wgpu::Backends::METAL,
            ]
        } else {
            [
                wgpu::Backends::VULKAN,
                wgpu::Backends::DX12,
                wgpu::Backends::METAL,
            ]
        };
        for backends in order {
            match GpuExecutor::with_backends(backends) {
                Ok(executor) => return Ok(executor),
                Err(_) => continue,
            }
        }
        bail!("gpu-backend-unavailable: Metal / Vulkan / DX12 都拿不到 adapter")
    }

    #[cfg(feature = "gpu")]
    fn with_backends(backends: wgpu::Backends) -> Result<GpuExecutor> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        }))
        .map_err(|error| anyhow!("request_adapter 失败：{error}"))?;
        let info = adapter.get_info();
        // On Windows, WARP would add texture uploads/readbacks around a CPU
        // rasterizer. Let auto callers use the native CPU reference instead.
        // Explicit host devices (from_device) remain usable for conformance.
        #[cfg(target_os = "windows")]
        if info.device_type == wgpu::DeviceType::Cpu {
            bail!("gpu-backend-unavailable: software adapter {}", info.name);
        }
        // **取 adapter 的实际限值**而不是 `downlevel_defaults()`：后者的
        // `max_texture_dimension_2d` 只有 2048，连 1080p 的横条元素（1920 宽）
        // 都刚好卡在门槛上，超采样更是直接越界。本执行器的资源就是"一张
        // 目标纹理 + 一张 w×2 的音频纹理 + 十来个小 uniform buffer"，用不着
        // 靠限值来约束自己；真正要挡住的是"目标比设备能画的还大"，那一条在
        // [`Self::render_quad_at`] 里显式检查并回退，见那里的注释。
        //
        // P6 的 WebGL2 路径限值更严（那条线上要重新评估这里的取值），不在 P5a。
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("bcut-render.gpu"),
            required_limits: adapter.limits(),
            ..Default::default()
        }))
        .map_err(|error| anyhow!("request_device 失败：{error}"))?;
        // 自建 device 的校验失败不该 panic 掉整个进程——回退 CPU 是既定策略。
        // 注入的宿主 device 则保留宿主自己的 uncaptured-error handler。
        device.on_uncaptured_error(std::sync::Arc::new(|error| {
            eprintln!("bcut-render gpu: 未捕获的 wgpu 错误：{error}");
        }));

        Ok(GpuExecutor::from_device(
            device,
            queue,
            format!("{:?}", info.backend).to_lowercase(),
            info.name,
        ))
    }

    /// 复用宿主已经创建的 wgpu device/queue。实时合成器必须与目标纹理属于
    /// 同一设备；另起一个 adapter/device 会让 IOSurface/共享纹理无法直接作为
    /// render attachment。headless conformance 仍走 [`Self::new`]。
    pub fn from_device(
        device: wgpu::Device,
        queue: wgpu::Queue,
        backend: impl Into<String>,
        adapter_name: impl Into<String>,
    ) -> GpuExecutor {
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("bcut.audio.sampler"),
            // §8.1：linear 采样 + clamp-to-edge。CPU 参照的
            // `kernel::sample_row_linear` 就是这一对的等价实现。
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });

        let vertices = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("bcut.quad.vertices"),
            size: std::mem::size_of_val(&QUAD_VERTICES) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&vertices, 0, bytemuck_cast(&QUAD_VERTICES));

        let group0 = uniform_layout(&device, "bcut.group0", 2, wgpu::ShaderStages::VERTEX);
        let group1_visualizer =
            uniform_layout(&device, "bcut.group1.viz", 8, wgpu::ShaderStages::FRAGMENT);
        let group1_progress =
            uniform_layout(&device, "bcut.group1.prog", 9, wgpu::ShaderStages::FRAGMENT);
        let group3_recipe = uniform_layout(
            &device,
            "bcut.group3.recipe",
            1,
            wgpu::ShaderStages::FRAGMENT,
        );
        let group2_audio = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("bcut.group2.audio"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        // progress 没有 `@group(2)`，但 `@group(3)` 要求布局数组是连续的：
        // 中间补一个空布局（对应一个空 bind group）。
        let group2_empty = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("bcut.group2.empty"),
            entries: &[],
        });

        GpuExecutor {
            device,
            queue,
            backend: backend.into(),
            adapter_name: adapter_name.into(),
            sampler,
            vertices,
            group0,
            group1_visualizer,
            group1_progress,
            group2_audio,
            group2_empty,
            group3_recipe,
            pipelines: HashMap::new(),
            live_bindings: Vec::new(),
            live_binding_rebuilds: 0,
            report: GpuBackendReport::default(),
        }
    }

    /// 合成器的目标纹理与 executor 必须来自这只 device。
    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }

    /// 提交实时合成命令的队列。
    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }

    /// 实际拿到的后端标识（`"metal"` / `"vulkan"` / `"dx12"`）。
    pub fn backend(&self) -> &str {
        &self.backend
    }

    /// adapter 名字。**不承诺跨设备逐位一致**（ADR-E06），报告里带上它是为了
    /// 让 conformance 的实测数字有归属。
    pub fn adapter_name(&self) -> &str {
        &self.adapter_name
    }

    /// 本次会话的回退报告。
    pub fn report(&self) -> GpuBackendReport {
        let mut report = self.report.clone();
        report.backend = Some(self.backend.clone());
        report
    }

    /// 执行一个 `ShaderQuad`，返回该 quad 自己那块画面（premultiplied RGBA8）。
    #[cfg(feature = "gpu")]
    pub fn render_quad(&mut self, quad: &ShaderQuad) -> Result<Pixmap> {
        self.render_quad_at(quad, 1)
    }

    /// 超采样版：渲染目标放大 `factor` 倍，再做**盒式**降采样。
    ///
    /// 为什么需要它：CPU 参照是矢量路径 + 光栅器解析抗锯齿，而参考 shader 在
    /// 若干处是**硬阶跃**（`bars-v1` 的 `yFactor` 就是 `select(0,1,·)`），1× 渲染
    /// 出来的柱顶是锯齿边。要拿两边的边缘做逐通道比较，就得先让 GPU 侧也有
    /// 一条可比的抗锯齿。`factor == 1` 时这条路径与 [`Self::render_quad`] 逐字
    /// 相同（不多一次分配）。
    #[cfg(feature = "gpu")]
    pub fn render_quad_at(&mut self, quad: &ShaderQuad, factor: u32) -> Result<Pixmap> {
        let factor = factor.max(1);
        let width = quad.target.width.max(1);
        let height = quad.target.height.max(1);
        let (rw, rh) = (width * factor, height * factor);

        // 越界要变成一条**可读的 `Err`**（调用方据此回退 CPU），而不是一条
        // "TextureView is invalid" 的未捕获校验错误——后者会让整帧静默变黑，
        // 是本阶段实测踩到过的坑：超采样把 1920 宽的横条元素放大到 7680，
        // 一举越过了当时用的 `downlevel_defaults()` 那 2048 的上限。
        let max = self.device.limits().max_texture_dimension_2d;
        if rw > max || rh > max {
            bail!("gpu-execution-failed: 渲染目标 {rw}x{rh}（{factor}× 超采样）超出设备上限 {max}");
        }

        let pipeline = self.pipeline(quad.shader, wgpu::TextureFormat::Rgba8Unorm, false)?;
        let bind0 = self.bind_uniforms(&self.group0, &quad.transform.bindings(), "group0");
        let group1_layout = match quad.uniforms {
            QuadUniforms::Visualizer(_) => &self.group1_visualizer,
            QuadUniforms::Progress(_) => &self.group1_progress,
        };
        let bind1 = self.bind_uniforms(group1_layout, &quad.uniforms.bindings(), "group1");
        let bind3 = self.bind_uniforms(
            &self.group3_recipe,
            &[super::shader_quad::UniformBinding {
                binding: 0,
                name: "u_recipe",
                bytes: quad.recipe.bytes.clone(),
            }],
            "group3",
        );
        let bind2 = match &quad.data_texture {
            Some(audio) => self.bind_audio(audio),
            None => self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("bcut.group2.empty"),
                layout: &self.group2_empty,
                entries: &[],
            }),
        };

        let target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("bcut.quad.target"),
            size: wgpu::Extent3d {
                width: rw,
                height: rh,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            // 非 sRGB：§8.5 的 linear RGBA，与 tiny-skia 的字节同一个数域。
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = target.create_view(&wgpu::TextureViewDescriptor::default());

        let padded = padded_bytes_per_row(rw);
        let readback = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("bcut.quad.readback"),
            size: u64::from(padded) * u64::from(rh),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("bcut.quad.encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("bcut.quad.pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        // 透明底：quad 只画自己，合成交给调用方。
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &bind0, &[]);
            pass.set_bind_group(1, &bind1, &[]);
            pass.set_bind_group(2, &bind2, &[]);
            pass.set_bind_group(3, &bind3, &[]);
            pass.set_vertex_buffer(0, self.vertices.slice(..));
            pass.draw(0..4, 0..1);
        }
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &target,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(rh),
                },
            },
            wgpu::Extent3d {
                width: rw,
                height: rh,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit(Some(encoder.finish()));

        let slice = readback.slice(..);
        let (sender, receiver) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|error| anyhow!("等待 GPU 回读失败：{error:?}"))?;
        receiver
            .recv()
            .context("回读通道断开")?
            .map_err(|error| anyhow!("缓冲映射失败：{error}"))?;
        let mapped = slice
            .get_mapped_range()
            .map_err(|error| anyhow!("取回读区间失败：{error}"))?;
        let mut rgba = Vec::with_capacity((rw * rh * 4) as usize);
        for row in 0..rh {
            let start = (row * padded) as usize;
            rgba.extend_from_slice(&mapped[start..start + (rw * 4) as usize]);
        }
        drop(mapped);
        readback.unmap();

        let rgba = if factor == 1 {
            rgba
        } else {
            box_downsample(&rgba, rw, rh, factor)
        };
        into_pixmap(rgba, width, height)
    }

    /// 把一个 quad 直接画进调用方的 render target。实时路径只走这条：不创建
    /// readback buffer、不调用 `map_async`，输出始终留在 GPU。
    ///
    /// `clear = true` 清透明底；否则保留目标并以 premultiplied source-over 合成。
    pub fn render_quad_to_view(
        &mut self,
        quad: &ShaderQuad,
        view: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        clear: bool,
    ) -> Result<()> {
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("bcut.compositor.quad.encoder"),
            });
        self.encode_quad_to_view(0, quad, view, format, clear, &mut encoder)?;
        self.finish_live_frame(1);
        self.queue.submit(Some(encoder.finish()));
        Ok(())
    }

    /// 把 quad pass 追加到调用方的 command encoder。共享合成器用这条把整帧
    /// 的矢量与 shader node 合进一次 queue submit；目标与 encoder 必须来自
    /// 创建本 executor 的同一只 device。
    pub fn encode_quad_to_view(
        &mut self,
        slot: usize,
        quad: &ShaderQuad,
        view: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        clear: bool,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        let pipeline = self.pipeline(quad.shader, format, true)?;
        self.update_live_bindings(slot, quad)?;
        let bindings = &self.live_bindings[slot];

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("bcut.compositor.quad.pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if clear {
                            wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT)
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &bindings.group0.bind_group, &[]);
            pass.set_bind_group(1, &bindings.group1.bind_group, &[]);
            pass.set_bind_group(2, bindings.group2.bind_group(), &[]);
            pass.set_bind_group(3, &bindings.group3.bind_group, &[]);
            pass.set_vertex_buffer(0, self.vertices.slice(..));
            pass.draw(0..4, 0..1);
        }
        Ok(())
    }

    /// 丢弃这一帧没再用到的尾部槽位。稳定场景的 Vec 与每个槽位内的
    /// buffer/bind group 跨帧保留；节点数缩小时资源会随尾部截断释放。
    pub fn finish_live_frame(&mut self, used_quad_slots: usize) {
        self.live_bindings.truncate(used_quad_slots);
    }

    /// 从 executor 创建以来累计重建了多少个实时绑定槽位，供合成器性能门禁使用。
    pub fn live_binding_rebuilds(&self) -> u64 {
        self.live_binding_rebuilds
    }

    fn update_live_bindings(&mut self, slot: usize, quad: &ShaderQuad) -> Result<()> {
        let signature = LiveBindingSignature {
            domain: quad.domain(),
            recipe_bytes: quad.recipe.bytes.len(),
            audio: quad
                .data_texture
                .as_ref()
                .map(|audio| (audio.width, audio.rows)),
        };
        match (signature.domain, signature.audio) {
            (ShaderDomain::Visualizer, None) => {
                bail!("gpu-quad-bindings-invalid: visualizer 缺少音频纹理")
            }
            (ShaderDomain::Progress, Some(_)) => {
                bail!("gpu-quad-bindings-invalid: progress 不接受音频纹理")
            }
            _ => {}
        }
        let transform = quad.transform.bindings();
        let uniforms = quad.uniforms.bindings();
        let recipe = [UniformBinding {
            binding: 0,
            name: "u_recipe",
            bytes: quad.recipe.bytes.clone(),
        }];
        let rebuild = self
            .live_bindings
            .get(slot)
            .is_none_or(|bindings| bindings.signature != signature);
        if rebuild {
            let group1_layout = match signature.domain {
                ShaderDomain::Visualizer => &self.group1_visualizer,
                ShaderDomain::Progress => &self.group1_progress,
            };
            let bindings = LiveBindings::new(
                &self.device,
                &self.queue,
                signature,
                LiveBindingLayouts {
                    group0: &self.group0,
                    group1: group1_layout,
                    group2_audio: &self.group2_audio,
                    group2_empty: &self.group2_empty,
                    group3: &self.group3_recipe,
                    sampler: &self.sampler,
                },
                LiveBindingPayload {
                    transform: &transform,
                    uniforms: &uniforms,
                    recipe: &recipe,
                    audio: quad.data_texture.as_ref(),
                },
            );
            if slot == self.live_bindings.len() {
                self.live_bindings.push(bindings);
            } else if slot < self.live_bindings.len() {
                self.live_bindings[slot] = bindings;
            } else {
                bail!(
                    "gpu-quad-slot-invalid: requested {slot}, next is {}",
                    self.live_bindings.len()
                );
            }
            self.live_binding_rebuilds += 1;
        } else {
            self.live_bindings[slot].write(
                &self.queue,
                LiveBindingPayload {
                    transform: &transform,
                    uniforms: &uniforms,
                    recipe: &recipe,
                    audio: quad.data_texture.as_ref(),
                },
            )?;
        }
        Ok(())
    }

    fn pipeline(
        &mut self,
        source: &'static ShaderSource,
        format: wgpu::TextureFormat,
        alpha_over: bool,
    ) -> Result<wgpu::RenderPipeline> {
        let key = format!(
            "{}:{format:?}:{}",
            source.label(),
            if alpha_over { "over" } else { "replace" }
        );
        if let Some(pipeline) = self.pipelines.get(&key) {
            return Ok(pipeline.clone());
        }
        let wgsl = source.assemble();
        // 先过 naga：源码错误在这里变成一条可读的 `Err`，而不是 wgpu 内部的
        // 未捕获校验错误（那条路会打日志然后给出一个不可用的管线）。Web 的
        // WebGPU 产物不开 `wgsl-validate`：shader 都是内置源码、native 测试逐个
        // 校验过，浏览器自己的校验错误经 uncaptured error 让宿主回落 CPU。
        #[cfg(feature = "wgsl-validate")]
        validate_wgsl(&wgsl).with_context(|| format!("{key} 的 WGSL 校验失败"))?;
        let module = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(&key),
                source: wgpu::ShaderSource::Wgsl(wgsl.into()),
            });
        let group1 = match source.domain {
            ShaderDomain::Visualizer => &self.group1_visualizer,
            ShaderDomain::Progress => &self.group1_progress,
        };
        let group2 = match source.domain {
            ShaderDomain::Visualizer => &self.group2_audio,
            ShaderDomain::Progress => &self.group2_empty,
        };
        let layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(&key),
                bind_group_layouts: &[
                    Some(&self.group0),
                    Some(group1),
                    Some(group2),
                    Some(&self.group3_recipe),
                ],
                immediate_size: 0,
            });
        // native conformance 需要同步收集 pipeline 校验错误；浏览器实时
        // 路径不能用 pollster 阻塞 JS event loop，由 device 的 uncaptured
        // error handler 记录并让 host 回退 CPU。
        #[cfg(feature = "gpu")]
        let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(&key),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some(VERTEX_ENTRY),
                    compilation_options: Default::default(),
                    buffers: &[Some(wgpu::VertexBufferLayout {
                        array_stride: 16,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &[
                            wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32x2,
                                offset: 0,
                                shader_location: 0,
                            },
                            wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32x2,
                                offset: 8,
                                shader_location: 1,
                            },
                        ],
                    })],
                },
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::TriangleStrip,
                    cull_mode: None,
                    ..Default::default()
                },
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some(FRAGMENT_ENTRY),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        // 输出已经是 premultiplied；离线对拍覆写透明 target，
                        // 实时合成路径则在既有 target 上做 source-over。
                        blend: alpha_over.then_some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
        #[cfg(feature = "gpu")]
        if let Some(error) = pollster::block_on(scope.pop()) {
            self.report.push(
                None,
                GpuFallbackReason::ShaderCompile,
                format!("{key}: {error}"),
            );
            bail!("gpu-shader-compile-failed: {key}: {error}");
        }
        self.pipelines.insert(key.clone(), pipeline.clone());
        Ok(pipeline)
    }

    #[cfg(feature = "gpu")]
    fn bind_uniforms(
        &self,
        layout: &wgpu::BindGroupLayout,
        uniforms: &[super::shader_quad::UniformBinding],
        label: &str,
    ) -> wgpu::BindGroup {
        let buffers: Vec<wgpu::Buffer> = uniforms
            .iter()
            .map(|uniform| {
                let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some(uniform.name),
                    size: uniform.bytes.len() as u64,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                self.queue.write_buffer(&buffer, 0, &uniform.bytes);
                buffer
            })
            .collect();
        let entries: Vec<wgpu::BindGroupEntry> = uniforms
            .iter()
            .zip(&buffers)
            .map(|(uniform, buffer)| wgpu::BindGroupEntry {
                binding: uniform.binding,
                resource: buffer.as_entire_binding(),
            })
            .collect();
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(label),
            layout,
            entries: &entries,
        })
    }

    /// §8.3：`R8Unorm`、`w × 2`、row 0 = 时域 / row 1 = 频域、**无 flip**。
    #[cfg(feature = "gpu")]
    fn bind_audio(&self, audio: &super::shader_quad::AudioTexture) -> wgpu::BindGroup {
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("bcut.audio"),
            size: wgpu::Extent3d {
                width: audio.width,
                height: audio.rows,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        write_audio_texture(&self.queue, &texture, audio);
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("bcut.group2.audio"),
            layout: &self.group2_audio,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        })
    }
}

impl LiveUniformGroup {
    fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        layout: &wgpu::BindGroupLayout,
        uniforms: &[UniformBinding],
        label: &str,
    ) -> Self {
        let buffers: Vec<wgpu::Buffer> = uniforms
            .iter()
            .map(|uniform| {
                let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some(uniform.name),
                    size: uniform.bytes.len() as u64,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                queue.write_buffer(&buffer, 0, &uniform.bytes);
                buffer
            })
            .collect();
        let entries: Vec<wgpu::BindGroupEntry> = uniforms
            .iter()
            .zip(&buffers)
            .map(|(uniform, buffer)| wgpu::BindGroupEntry {
                binding: uniform.binding,
                resource: buffer.as_entire_binding(),
            })
            .collect();
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(label),
            layout,
            entries: &entries,
        });
        Self {
            buffers,
            bind_group,
        }
    }

    fn write(&self, queue: &wgpu::Queue, uniforms: &[UniformBinding]) -> Result<()> {
        if self.buffers.len() != uniforms.len() {
            bail!(
                "gpu-live-uniform-shape-changed: {} buffers != {} uniforms",
                self.buffers.len(),
                uniforms.len()
            );
        }
        for (buffer, uniform) in self.buffers.iter().zip(uniforms) {
            if buffer.size() != uniform.bytes.len() as u64 {
                bail!(
                    "gpu-live-uniform-size-changed: {} is {} bytes, expected {}",
                    uniform.name,
                    uniform.bytes.len(),
                    buffer.size()
                );
            }
            queue.write_buffer(buffer, 0, &uniform.bytes);
        }
        Ok(())
    }
}

impl LiveDataGroup {
    fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        audio_layout: &wgpu::BindGroupLayout,
        empty_layout: &wgpu::BindGroupLayout,
        sampler: &wgpu::Sampler,
        audio: Option<&AudioTexture>,
    ) -> Self {
        let Some(audio) = audio else {
            return Self::Empty(device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("bcut.live.group2.empty"),
                layout: empty_layout,
                entries: &[],
            }));
        };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("bcut.live.audio"),
            size: wgpu::Extent3d {
                width: audio.width,
                height: audio.rows,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        write_audio_texture(queue, &texture, audio);
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("bcut.live.group2.audio"),
            layout: audio_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(sampler),
                },
            ],
        });
        Self::Audio {
            texture,
            bind_group,
        }
    }

    fn write(&self, queue: &wgpu::Queue, audio: Option<&AudioTexture>) -> Result<()> {
        match (self, audio) {
            (LiveDataGroup::Audio { texture, .. }, Some(audio)) => {
                write_audio_texture(queue, texture, audio);
                Ok(())
            }
            (LiveDataGroup::Empty(_), None) => Ok(()),
            _ => bail!("gpu-live-audio-shape-changed: binding cache signature mismatch"),
        }
    }

    fn bind_group(&self) -> &wgpu::BindGroup {
        match self {
            LiveDataGroup::Audio { bind_group, .. } | LiveDataGroup::Empty(bind_group) => {
                bind_group
            }
        }
    }
}

impl LiveBindings {
    fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        signature: LiveBindingSignature,
        layouts: LiveBindingLayouts<'_>,
        payload: LiveBindingPayload<'_>,
    ) -> Self {
        Self {
            signature,
            group0: LiveUniformGroup::new(
                device,
                queue,
                layouts.group0,
                payload.transform,
                "bcut.live.group0",
            ),
            group1: LiveUniformGroup::new(
                device,
                queue,
                layouts.group1,
                payload.uniforms,
                "bcut.live.group1",
            ),
            group2: LiveDataGroup::new(
                device,
                queue,
                layouts.group2_audio,
                layouts.group2_empty,
                layouts.sampler,
                payload.audio,
            ),
            group3: LiveUniformGroup::new(
                device,
                queue,
                layouts.group3,
                payload.recipe,
                "bcut.live.group3",
            ),
        }
    }

    fn write(&self, queue: &wgpu::Queue, payload: LiveBindingPayload<'_>) -> Result<()> {
        self.group0.write(queue, payload.transform)?;
        self.group1.write(queue, payload.uniforms)?;
        self.group2.write(queue, payload.audio)?;
        self.group3.write(queue, payload.recipe)?;
        Ok(())
    }
}

/// `write_texture` 的 `bytes_per_row` 就是 `width`：数据是行主序、逐行紧排，
/// **上传顺序即行号**，没有任何翻转。
fn write_audio_texture(queue: &wgpu::Queue, texture: &wgpu::Texture, audio: &AudioTexture) {
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &audio.data,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(audio.width),
            rows_per_image: Some(audio.rows),
        },
        wgpu::Extent3d {
            width: audio.width,
            height: audio.rows,
            depth_or_array_layers: 1,
        },
    );
}

fn uniform_layout(
    device: &wgpu::Device,
    label: &str,
    count: u32,
    visibility: wgpu::ShaderStages,
) -> wgpu::BindGroupLayout {
    let entries: Vec<wgpu::BindGroupLayoutEntry> = (0..count)
        .map(|binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        })
        .collect();
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some(label),
        entries: &entries,
    })
}

/// naga 静态校验：`wgsl-in` 解析 + `Validator` 全量能力。
///
/// 与 `tests/shader_wgsl.rs` 是同一条路径——测试里多跑一遍 GLSL ES 300 转译。
#[cfg(feature = "wgsl-validate")]
pub fn validate_wgsl(source: &str) -> Result<naga::Module> {
    let module = naga::front::wgsl::parse_str(source)
        .map_err(|error| anyhow!("WGSL 解析失败：{}", error.emit_to_string(source)))?;
    let mut validator = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::default(),
    );
    validator
        .validate(&module)
        .map_err(|error| anyhow!("WGSL 校验失败：{}", error.emit_to_string(source)))?;
    Ok(module)
}

#[cfg(feature = "gpu")]
fn padded_bytes_per_row(width: u32) -> u32 {
    let unpadded = width * 4;
    unpadded.div_ceil(COPY_ALIGN) * COPY_ALIGN
}

/// 盒式降采样。**在 premultiplied 数域里做平均**才是对的：非预乘平均会把
/// 透明像素的颜色算进来。
#[cfg(feature = "gpu")]
fn box_downsample(rgba: &[u8], width: u32, height: u32, factor: u32) -> Vec<u8> {
    let (out_w, out_h) = (width / factor, height / factor);
    let area = f32::from(factor as u16) * f32::from(factor as u16);
    let mut out = Vec::with_capacity((out_w * out_h * 4) as usize);
    for y in 0..out_h {
        for x in 0..out_w {
            let mut sums = [0f32; 4];
            for dy in 0..factor {
                for dx in 0..factor {
                    let sx = x * factor + dx;
                    let sy = y * factor + dy;
                    let base = ((sy * width + sx) * 4) as usize;
                    for channel in 0..4 {
                        sums[channel] += f32::from(rgba[base + channel]);
                    }
                }
            }
            for sum in sums {
                out.push((sum / area).round().clamp(0.0, 255.0) as u8);
            }
        }
    }
    out
}

#[cfg(feature = "gpu")]
fn into_pixmap(mut rgba: Vec<u8>, width: u32, height: u32) -> Result<Pixmap> {
    // 防御：premultiplied 不变式是 `rgb ≤ a`。着色器的输出天然满足它，
    // 但降采样的舍入可能让某个通道多出 1，`Pixmap::from_vec` 会因此拒收。
    for pixel in rgba.chunks_exact_mut(4) {
        let alpha = pixel[3];
        for channel in &mut pixel[..3] {
            *channel = (*channel).min(alpha);
        }
    }
    let size = tiny_skia::IntSize::from_wh(width, height)
        .ok_or_else(|| anyhow!("非法的 quad 尺寸 {width}x{height}"))?;
    Pixmap::from_vec(rgba, size).ok_or_else(|| anyhow!("回读字节无法构成 Pixmap"))
}

/// `&[f32]` → `&[u8]`（小端）。为了一个四顶点的常量数组拉一条 bytemuck
/// 依赖不值当。
fn bytemuck_cast(values: &[f32]) -> &[u8] {
    // SAFETY: `f32` 没有 padding、没有不变式，任意位模式都是合法的 `u8`。
    unsafe {
        std::slice::from_raw_parts(values.as_ptr().cast::<u8>(), std::mem::size_of_val(values))
    }
}

#[cfg(all(test, feature = "gpu"))]
mod tests {
    use super::*;

    #[test]
    fn the_readback_row_padding_follows_the_copy_alignment() {
        assert_eq!(padded_bytes_per_row(64), 256);
        assert_eq!(padded_bytes_per_row(65), 512);
        assert_eq!(padded_bytes_per_row(1), 256);
    }

    #[test]
    fn the_box_downsample_averages_in_the_premultiplied_domain() {
        // 2×2 → 1×1：三个全透明 + 一个不透明白，平均正好是 1/4 覆盖。
        let rgba = vec![
            0, 0, 0, 0, 255, 255, 255, 255, //
            0, 0, 0, 0, 0, 0, 0, 0,
        ];
        assert_eq!(box_downsample(&rgba, 2, 2, 2), vec![64, 64, 64, 64]);
    }

    #[test]
    fn the_pixmap_conversion_repairs_a_rounding_overshoot() {
        let pixmap = into_pixmap(vec![200, 10, 10, 128], 1, 1).unwrap();
        assert_eq!(pixmap.data()[0], 128, "rgb 被夹回 alpha 以内");
    }
}
