//! `ShaderQuad` pass（元素方案 ADR-E06 / §8.1–§8.5）。
//!
//! 一个 `ShaderQuad` = **一次单 quad 的 fragment 绘制**：几何全部在 shader 里
//! 程序化生成，没有逐图元 draw call。当前只有 progress 走这条 pass；visualizer
//! 的 10 款自 2026-09 重设计起全部是 CPU 矢量配方（`visualizer_frame`），GPU
//! 后端把它当普通矢量层合成。[`VisualizerUniforms`] / [`AudioTexture`] 与
//! `_prelude.wgsl` 作为 §8.2 / §8.3 的冻结契约保留，给未来的 GPU 声波配方留位。
//!
//! ## 为什么它现在不是 `RenderPass` 的第五个变体
//!
//! motion 阶段 4 的 `FramePlan` / `PassExecutor` **已经落地**（本方案 §10 P5 写
//! 「未开工」的记载已过时）。给 `RenderPass` 加变体会连带动 `FRAME_PLAN_VERSION`
//! 与计划编码，而 DrawOp v3 / 计划编码是 motion 阶段 4 的地盘，P5 不得单方面改
//! （§10 P5 的最后一句）。因此 P5a 让 `ShaderQuad` 作**独立的 pass 描述**：
//! [`GpuExecutor`](super::executor_gpu) 直接执行它，CPU 侧不受影响；等两条线
//! 合流时把它并进 `RenderPass` 即可——本模块的字段就是那个变体的字段。
//!
//! ## 本模块不挂 `gpu` feature
//!
//! uniform 的**打包顺序**是 §8.2 冻结的跨文档契约，它必须在没有 GPU 的构建里
//! 也能被测试钉住。真正需要 wgpu 的只有执行。
//!
//! ## §8.2 的顺序在这里是可执行的
//!
//! [`VisualizerUniforms::BINDINGS`] / [`ProgressUniforms::BINDINGS`] 是两张
//! `(binding, 名字)` 表，[`UniformBinding`] 按同一顺序产出字节。WGSL 侧的
//! `_prelude.wgsl` 与它逐行对拍（`tests/shader_wgsl.rs`）。

use anyhow::{Result, bail};
use motion::preset_registry::{
    BinWidth, CatalogueRecipe, ProgressAspect, ProgressBody, RecipeAlgorithm,
};
use serde_json::Value;

use super::shader_source::{ShaderDomain, ShaderSource, shader_for};
use crate::drawop::{Color4, Mat6};
use crate::source::kernel::DrawBox;
use crate::source::progress::ProgressParams;
use crate::source::visualizer::{VizFrame, freq_row, time_row};

/// §8.3：音频纹理的行数。
pub const AUDIO_TEXTURE_ROWS: u32 = 2;

/// 一条 `@group(1)` uniform 的字节。
///
/// 每一项是**独立的 binding**（§8.2 的表就是按 binding 编号写的），不是一个
/// 打包 struct——这一点采纳自参考实现的 WGSL 侧约定，改成 struct 就会让
/// §8.2 的"顺序冻结"失去可校验的形式。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UniformBinding {
    pub binding: u32,
    pub name: &'static str,
    pub bytes: Vec<u8>,
}

fn vec_bytes(values: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len() * 4);
    for value in values {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

/// WebGL2/downlevel 的 uniform binding 类型大小必须是 16 B 的倍数。§8.2
/// 仍保留每项独立 binding，只把 scalar / vec2 的尾部补零；vec4 本来就是 16 B。
fn uniform_bytes(values: &[f32]) -> Vec<u8> {
    let mut out = vec_bytes(values);
    out.resize(out.len().div_ceil(16) * 16, 0);
    out
}

fn f32_bytes(value: f32) -> Vec<u8> {
    uniform_bytes(&[value])
}

/// §8.1 `@group(0)`：顶点变换。
///
/// `u_transform` 是 4×4 列主序，`u_texTransform` 是 3×3（uniform 里每列补齐到
/// 16 字节）。单位阵 = "quad 顶点已经在 NDC 里、纹理坐标原样透传"，
/// 执行器就是这么发的。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TransformUniforms {
    pub transform: [f32; 16],
    pub tex_transform: [f32; 9],
}

impl Default for TransformUniforms {
    fn default() -> Self {
        TransformUniforms {
            #[rustfmt::skip]
            transform: [
                1.0, 0.0, 0.0, 0.0,
                0.0, 1.0, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 1.0,
            ],
            #[rustfmt::skip]
            tex_transform: [
                1.0, 0.0, 0.0,
                0.0, 1.0, 0.0,
                0.0, 0.0, 1.0,
            ],
        }
    }
}

impl TransformUniforms {
    pub const BINDINGS: [(u32, &'static str); 2] = [(0, "u_transform"), (1, "u_texTransform")];

    /// **亚像素放置**：把 NDC 单位 quad 映到画布上一只**可以带小数**的矩形
    /// （P5b 定案 3）。
    ///
    /// §8.1 冻结的顶点数据是 `[-1, 1]²` 的四个角，[`Default`] 那个单位阵的含义是
    /// "quad 铺满整只渲染目标"。真实合成里元素盒的落点几乎从不落在整数像素上
    /// （几何默认表是百分比，1080p 上 `85% × 1080 = 918` 只是碰巧整），而
    /// [`QuadTarget`] 的宽高必须取整——渲染目标只能是整数纹素。**小数部分因此
    /// 由这里的变换承担**：内容在目标纹理内平移半个像素，而不是靠合成期再挪一次
    /// （那会多一次重采样，把 shader 好不容易算准的边糊掉）。
    ///
    /// `rect` 与 `surface` 都是**像素**、原点左上、y 向下；返回的是列主序 4×4。
    /// 顶点着色器里那句 `-pos.y` 已经把顶点数据反成 **y 向上的 NDC**，因此这里
    /// 只需把画布坐标换算成 y 向上的 NDC（`ndc_y = 1 − 2·y/H`）。
    ///
    pub fn place(rect: (f64, f64, f64, f64), surface: (f64, f64)) -> TransformUniforms {
        Self::place_affine(rect, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0], surface)
    }

    /// 把元素本地 quad 先放进画布矩形，再应用 DrawOp 同口径的二维仿射。
    /// `affine = [a,b,c,d,tx,ty]` 表示
    /// `(x',y') = (a·x+c·y+tx, b·x+d·y+ty)`；旋转、镜像与动画 pose 因此与
    /// CPU reference 共用 [`Mat6`]，实时合成器不再退化为轴对齐放置。
    pub fn place_affine(
        rect: (f64, f64, f64, f64),
        affine: Mat6,
        surface: (f64, f64),
    ) -> TransformUniforms {
        let (x, y, w, h) = rect;
        let (sw, sh) = (surface.0.max(1.0), surface.1.max(1.0));
        let [a, b, c, d, tx, ty] = affine.map(f64::from);
        let center_x = x + w / 2.0;
        let center_y = y + h / 2.0;

        // 顶点着色器收到的局部坐标是 q=(pos.x,-pos.y)：左上=(-1,+1)。
        // 先映到像素 (cx+w/2*qx, cy-h/2*qy)，再走 Mat6，最后换到 NDC。
        let m00 = a * w / sw;
        let m10 = -b * w / sh;
        let m01 = -c * h / sw;
        let m11 = d * h / sh;
        let ndc_x = 2.0 * (a * center_x + c * center_y + tx) / sw - 1.0;
        let ndc_y = 1.0 - 2.0 * (b * center_x + d * center_y + ty) / sh;
        TransformUniforms {
            #[rustfmt::skip]
            transform: [
                m00 as f32,  m10 as f32, 0.0, 0.0,
                m01 as f32,  m11 as f32, 0.0, 0.0,
                0.0,         0.0,        1.0, 0.0,
                ndc_x as f32, ndc_y as f32, 0.0, 1.0,
            ],
            tex_transform: TransformUniforms::default().tex_transform,
        }
    }

    pub fn bindings(&self) -> Vec<UniformBinding> {
        // mat3x3f 在 uniform 地址空间里每列占 16 字节（列后补 4 字节）。
        let mut tex = Vec::with_capacity(48);
        for column in self.tex_transform.chunks(3) {
            tex.extend_from_slice(&vec_bytes(column));
            tex.extend_from_slice(&0f32.to_le_bytes());
        }
        vec![
            UniformBinding {
                binding: 0,
                name: "u_transform",
                bytes: vec_bytes(&self.transform),
            },
            UniformBinding {
                binding: 1,
                name: "u_texTransform",
                bytes: tex,
            },
        ]
    }
}

/// §8.2 的 visualizer 8 项，**顺序冻结**。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VisualizerUniforms {
    /// 元素本地时刻，秒。
    pub time: f32,
    pub main_color: Color4,
    pub secondary_color: Color4,
    /// 画布分辨率（像素）。
    pub canvas_res: [f32; 2],
    /// 本 quad 的输出分辨率（像素）。算 1px 线宽用。
    pub dst_res: [f32; 2],
    /// 元素透明度与入出场动画的乘子——GPU 路径与 `MotionProgram` 的唯一接缝
    /// （§8.5：**不在 shader 里重算动画**）。
    pub colour_multiplier: Color4,
    /// 四边裁剪，归一化 `[left, top, right, bottom]`。
    pub clip: [f32; 4],
    /// 音频纹理尺寸；只有 bicubic 采样的样式读它。
    pub texture_size: [f32; 2],
}

impl VisualizerUniforms {
    /// §8.2 冻结表（visualizer 列）。
    pub const BINDINGS: [(u32, &'static str); 8] = [
        (0, "u_time"),
        (1, "u_mainColor"),
        (2, "u_secondaryColor"),
        (3, "u_canvasRes"),
        (4, "u_dstRes"),
        (5, "u_colourMultiplier"),
        (6, "u_clip"),
        (7, "u_textureSize"),
    ];

    pub fn bindings(&self) -> Vec<UniformBinding> {
        let payloads: [Vec<u8>; 8] = [
            f32_bytes(self.time),
            uniform_bytes(&self.main_color),
            uniform_bytes(&self.secondary_color),
            uniform_bytes(&self.canvas_res),
            uniform_bytes(&self.dst_res),
            uniform_bytes(&self.colour_multiplier),
            uniform_bytes(&self.clip),
            uniform_bytes(&self.texture_size),
        ];
        zip_bindings(&VisualizerUniforms::BINDINGS, payloads)
    }
}

/// §8.2 的 progress 9 项，**顺序冻结**。多 `u_progress` / `u_srcRes`，
/// 少 `u_textureSize`。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProgressUniforms {
    /// host 每帧从 `from/to` + 播放头推导，闭区间 `[0, 1]`。
    pub progress: f32,
    /// 元素本地时刻，秒（`t − element.start`，P4 已定的口径）。
    pub time: f32,
    pub main_color: Color4,
    pub secondary_color: Color4,
    pub canvas_res: [f32; 2],
    pub src_res: [f32; 2],
    pub dst_res: [f32; 2],
    pub colour_multiplier: Color4,
    pub clip: [f32; 4],
}

impl ProgressUniforms {
    /// §8.2 冻结表（progress 列）。
    pub const BINDINGS: [(u32, &'static str); 9] = [
        (0, "u_progress"),
        (1, "u_time"),
        (2, "u_mainColor"),
        (3, "u_secondaryColor"),
        (4, "u_canvasRes"),
        (5, "u_srcRes"),
        (6, "u_dstRes"),
        (7, "u_colourMultiplier"),
        (8, "u_clip"),
    ];

    pub fn bindings(&self) -> Vec<UniformBinding> {
        let payloads: [Vec<u8>; 9] = [
            f32_bytes(self.progress),
            f32_bytes(self.time),
            uniform_bytes(&self.main_color),
            uniform_bytes(&self.secondary_color),
            uniform_bytes(&self.canvas_res),
            uniform_bytes(&self.src_res),
            uniform_bytes(&self.dst_res),
            uniform_bytes(&self.colour_multiplier),
            uniform_bytes(&self.clip),
        ];
        zip_bindings(&ProgressUniforms::BINDINGS, payloads)
    }
}

fn zip_bindings<const N: usize>(
    table: &[(u32, &'static str); N],
    payloads: [Vec<u8>; N],
) -> Vec<UniformBinding> {
    table
        .iter()
        .zip(payloads)
        .map(|(&(binding, name), bytes)| UniformBinding {
            binding,
            name,
            bytes,
        })
        .collect()
}

/// `@group(1)` 的两种形态。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum QuadUniforms {
    Visualizer(VisualizerUniforms),
    Progress(ProgressUniforms),
}

impl QuadUniforms {
    pub fn domain(&self) -> ShaderDomain {
        match self {
            QuadUniforms::Visualizer(_) => ShaderDomain::Visualizer,
            QuadUniforms::Progress(_) => ShaderDomain::Progress,
        }
    }

    pub fn bindings(&self) -> Vec<UniformBinding> {
        match self {
            QuadUniforms::Visualizer(uniforms) => uniforms.bindings(),
            QuadUniforms::Progress(uniforms) => uniforms.bindings(),
        }
    }
}

/// `@group(3) @binding(0)`：配方参数。
///
/// §8.2 冻结的是 `@group(1)` 的顺序，配方数字挤不进去；BaoCut 因此把它们放进
/// 自己的 group。字节序 = 各样式 WGSL 里那份 struct 的字段顺序。
///
/// **shader 不含配方数字**这条纪律与 Rust 内核同源（motion 阶段 1 的
/// `loop_kernel` 起）：`barCount` 是数据，写死在 WGSL 里就等于给 `bars-v1`
/// 家族六种各抄一份源码。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecipeUniform {
    pub bytes: Vec<u8>,
}

impl RecipeUniform {
    fn from_floats(values: &[f32]) -> RecipeUniform {
        RecipeUniform {
            bytes: vec_bytes(values),
        }
    }
}

/// `#RRGGBB` 之外的一种颜色写法：配方里的 `[r, g, b, a]`（0..1 直通色）。
fn color_floats(value: &Value) -> [f32; 4] {
    let array = value.as_array();
    let channel = |slot: usize| {
        array
            .and_then(|list| list.get(slot))
            .and_then(Value::as_f64)
            .unwrap_or_default() as f32
    };
    [channel(0), channel(1), channel(2), channel(3)]
}

/// 把一串 f32 补 pad 到 16 字节的整数倍（WGSL uniform struct 的对齐要求）。
fn padded(values: &mut Vec<f32>) {
    while values.len() % 4 != 0 {
        values.push(0.0);
    }
}

/// `frame-v1` 的配方 uniform（`shaders/progress/border.wgsl`）。
pub fn pack_frame_v1(body: &ProgressBody) -> Result<RecipeUniform> {
    let recipe = &body.recipe;
    let (Some(border_size), Some(smoothing), Some(fill), Some(background), Some(mode)) = (
        recipe.number("borderSize"),
        recipe.number("smoothing"),
        recipe.text("fill"),
        recipe.flag("background"),
        recipe.object("colorMode"),
    ) else {
        bail!("frame-v1 配方缺必填参数");
    };
    let kind = mode.get("kind").and_then(Value::as_str).unwrap_or("solid");
    let color_kind = match kind {
        "solid" => 0.0,
        "rainbow" => 1.0,
        "strobe" => 2.0,
        other => bail!("frame-v1 的 colorMode.kind 未知：{other}"),
    };
    let number = |key: &str| mode.get(key).and_then(Value::as_f64).unwrap_or_default() as f32;
    let mut values = vec![
        border_size as f32,
        smoothing as f32,
        if fill == "reverse" { 1.0 } else { 0.0 },
        if background { 1.0 } else { 0.0 },
        color_kind,
        number("hueSpeed"),
        number("mixBias"),
        number("mixGain"),
        number("speed"),
    ];
    padded(&mut values);
    let mut corners = [[0f32; 4]; 4];
    if let Some(list) = mode.get("corners").and_then(Value::as_array) {
        for (slot, entry) in list.iter().enumerate().take(4) {
            corners[slot] = color_floats(entry);
        }
    }
    for corner in corners {
        values.extend_from_slice(&corner);
    }
    Ok(RecipeUniform::from_floats(&values))
}

/// `ring-v1` 的配方 uniform（`shaders/progress/circle.wgsl`）。
///
/// `featherPx` / `edgeFeatherPx` **不乘 `pixel_scale`**：它们是"几个像素的抗锯齿"
/// 而不是"参考短边上的几个像素"，shader 拿 `u_dstRes` 就地折算（与 `bar-v1` 的
/// `radiusPx` 是两种量，那一个才是长度）。
pub fn pack_ring_v1(body: &ProgressBody) -> Result<RecipeUniform> {
    let recipe = &body.recipe;
    let (Some(feather), Some(edge_feather), Some(inner), Some(direction)) = (
        recipe.number("featherPx"),
        recipe.number("edgeFeatherPx"),
        recipe.number("innerRadius"),
        recipe.text("direction"),
    ) else {
        bail!("ring-v1 配方缺必填参数");
    };
    Ok(RecipeUniform::from_floats(&[
        feather as f32,
        edge_feather as f32,
        inner.clamp(0.0, 1.0) as f32,
        if direction == "ccw" { 1.0 } else { 0.0 },
    ]))
}

/// `snake-v1` 的配方 uniform（`shaders/progress/snake.wgsl`）。
pub fn pack_snake_v1(body: &ProgressBody) -> Result<RecipeUniform> {
    let recipe = &body.recipe;
    let (
        Some(dot),
        Some(smoothing),
        Some(orbit),
        Some(start_angle),
        Some(increment),
        Some(max_iterations),
        Some(mode),
    ) = (
        recipe.number("dotRadius"),
        recipe.number("smoothing"),
        recipe.number("orbitRadius"),
        recipe.number("startAngleDeg"),
        recipe.number("angleIncrementDeg"),
        recipe.integer("maxIterations"),
        recipe.object("colorMode"),
    )
    else {
        bail!("snake-v1 配方缺必填参数");
    };
    if increment == 0.0 {
        bail!("snake-v1 的 angleIncrementDeg 不能是 0");
    }
    let mut boosts = [0f32; 4];
    if let Some(list) = recipe.array("boostSteps") {
        for (slot, step) in list.iter().enumerate().take(2) {
            boosts[slot * 2] = step
                .get("below")
                .and_then(Value::as_f64)
                .unwrap_or_default() as f32;
            boosts[slot * 2 + 1] =
                step.get("gain").and_then(Value::as_f64).unwrap_or_default() as f32;
        }
    }
    let spin = recipe
        .object("spin")
        .and_then(|object| object.get("speedDegPerSec"))
        .and_then(Value::as_f64)
        .unwrap_or_default() as f32;
    let kind = mode.get("kind").and_then(Value::as_str).unwrap_or("solid");
    let color_kind = match kind {
        "solid" => 0.0,
        "rainbow" => 1.0,
        other => bail!("snake-v1 的 colorMode.kind 未知：{other}"),
    };
    let track_is_main = if mode.get("trackColor").and_then(Value::as_str) == Some("main") {
        1.0
    } else {
        0.0
    };
    let rainbow_speed = mode
        .get("rotationSpeedDegPerSec")
        .and_then(Value::as_f64)
        .unwrap_or_default() as f32;
    let mut values = vec![
        dot as f32,
        smoothing as f32,
        orbit as f32,
        start_angle as f32,
        increment as f32,
        max_iterations.max(1) as f32,
        boosts[0],
        boosts[1],
        boosts[2],
        boosts[3],
        spin,
        color_kind,
        track_is_main,
        rainbow_speed,
    ];
    padded(&mut values);
    Ok(RecipeUniform::from_floats(&values))
}

/// `bar-v1` 的配方 uniform。字段顺序与 `shaders/progress/normal.wgsl` 的
/// `struct BarRecipe` 逐字对应。
///
/// `radiusPx` 在这里就乘上 host 的 `pixel_scale`（`canvas_short_edge /
/// REFERENCE_SHORT_EDGE`）——与 CPU 侧 `bar_v1::draw` 同一条折算；再夹到
/// "半个短边"是 shader 的事（它手上才有 `u_dstRes`）。
pub fn pack_bar_v1(body: &ProgressBody, pixel_scale: f64) -> Result<RecipeUniform> {
    let recipe = &body.recipe;
    let Some(direction) = recipe.text("direction") else {
        bail!("bar-v1 配方缺 direction");
    };
    let radius_px = recipe
        .object("corner")
        .filter(|corner| corner.get("kind").and_then(Value::as_str) == Some("capsule"))
        .and_then(|corner| corner.get("radiusPx"))
        .and_then(Value::as_f64)
        .map(|pixels| pixels * pixel_scale)
        .unwrap_or(0.0)
        .max(0.0);
    Ok(RecipeUniform::from_floats(&[
        if direction == "rtl" { 1.0 } else { 0.0 },
        radius_px as f32,
        0.0,
        0.0,
    ]))
}

/// `w × 2` 的 `R8Unorm` 音频纹理（§8.3）。
///
/// **row 0 = 时域，row 1 = 频域，无 flip。** 行主序，`data.len() == width × 2`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioTexture {
    pub width: u32,
    pub rows: u32,
    pub data: Vec<u8>,
}

impl AudioTexture {
    /// 一帧频谱 → 纹理字节。
    ///
    /// 两条行在 `VizFrame` 里**宽度不同**（BCS1 的 128 / 512），纹理要求同宽：
    /// 频域行按配方的 `binWidth` 取窗（§8.4，直接取最低段、不做频率补偿），
    /// 时域行按 clamp-to-edge 纹素中心规则重采样到同宽。
    ///
    /// **重采样是行语义的一部分**，CPU 参照走同一个
    /// [`crate::source::visualizer::time_row`]（P5b 定案，见该函数文档：
    /// `beam` 上两条读法不重合就是平坦区 255 的偏差）。
    pub fn from_frame(frame: &VizFrame, bin_width: BinWidth) -> AudioTexture {
        let freq = freq_row(frame, bin_width);
        let width = freq.len().max(1);
        let mut data = Vec::with_capacity(width * AUDIO_TEXTURE_ROWS as usize);
        data.extend_from_slice(&time_row(frame, bin_width));
        data.extend_from_slice(freq);
        if freq.is_empty() {
            data.push(0);
        }
        AudioTexture {
            width: width as u32,
            rows: AUDIO_TEXTURE_ROWS,
            data,
        }
    }

    /// 第 `row` 行的字节（`row 0` 时域 / `row 1` 频域）。
    pub fn row(&self, row: u32) -> &[u8] {
        let width = self.width as usize;
        let start = row as usize * width;
        &self.data[start..start + width]
    }
}

/// quad 的输出矩形：画布上的落点 + 整数像素尺寸。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QuadTarget {
    pub x: f64,
    pub y: f64,
    pub width: u32,
    pub height: u32,
}

impl QuadTarget {
    /// 落点的**小数部分**（像素）。
    ///
    /// 渲染目标只能是整数纹素，而元素盒的落点几乎从不落在整数像素上。P5b 定案 3：
    /// 这半个像素由 §8.1 的 `u_transform` 承担（[`TransformUniforms::place`]），
    /// **不**由合成期再挪一次——那会多一次重采样。`QuadTarget` 的整数尺寸只服务
    /// 离屏 conformance 目标（夹具的落点归零，小数部分恒为 0）。
    pub fn subpixel_offset(&self) -> (f64, f64) {
        (self.x - self.x.floor(), self.y - self.y.floor())
    }

    /// 元素盒 → 输出矩形。尺寸取整到像素（GPU 的渲染目标只能是整数）。
    pub fn from_box(bbox: DrawBox) -> QuadTarget {
        QuadTarget {
            x: bbox.x,
            y: bbox.y,
            width: bbox.w.round().max(1.0) as u32,
            height: bbox.h.round().max(1.0) as u32,
        }
    }

    fn res(&self) -> [f32; 2] {
        [self.width as f32, self.height as f32]
    }
}

/// 一次 `ShaderQuad` pass 的完整描述。
///
/// 字段就是 ADR-E06 写的那三件事 —— `shader_id` / `uniforms` / `data_texture`
/// —— 外加输出矩形与 `@group(3)` 的配方包。
#[derive(Debug, Clone, PartialEq)]
pub struct ShaderQuad {
    /// 源码登记项。`ShaderQuad` 拿的是**已经解析好的**源，而不是一个字符串 id：
    /// "这个样式还没有 WGSL" 必须在建 quad 时就是 `Err`，不能等到编译期。
    pub shader: &'static ShaderSource,
    /// 样式面值 id（诊断与缓存键）。
    pub style: String,
    pub transform: TransformUniforms,
    pub uniforms: QuadUniforms,
    pub recipe: RecipeUniform,
    /// §8.3 的音频纹理位。progress 恒为 `None`；visualizer 当前不走 quad，
    /// 字段保留给未来的 GPU 声波配方。
    pub data_texture: Option<AudioTexture>,
    pub target: QuadTarget,
}

impl ShaderQuad {
    pub fn domain(&self) -> ShaderDomain {
        self.uniforms.domain()
    }

    /// 一帧 progress → 一个 quad。
    #[allow(clippy::too_many_arguments)]
    pub fn progress(
        recipe: &CatalogueRecipe,
        params: &ProgressParams,
        progress: f64,
        time: f64,
        bbox: DrawBox,
        canvas: (f64, f64),
    ) -> Result<ShaderQuad> {
        let Some(body) = recipe.progress() else {
            bail!("{} 不是 progress 配方", recipe.id);
        };
        let Some(shader) = shader_for(ShaderDomain::Progress, &recipe.id) else {
            bail!("progress 样式 \"{}\" 还没有 WGSL 实现", recipe.id);
        };
        let bbox = match body.aspect {
            ProgressAspect::Square => bbox.inscribed_square(),
            ProgressAspect::Bar | ProgressAspect::Frame => bbox,
        };
        let recipe_uniform = match body.recipe.algorithm {
            RecipeAlgorithm::BarV1 => pack_bar_v1(body, params.pixel_scale)?,
            RecipeAlgorithm::FrameV1 => pack_frame_v1(body)?,
            RecipeAlgorithm::RingV1 => pack_ring_v1(body)?,
            RecipeAlgorithm::SnakeV1 => pack_snake_v1(body)?,
            other => bail!("算法 {:?} 不是 progress 配方", other),
        };
        // 非有限值的处置与 `progress_frame` 逐字相同：不 panic，按 0 读。
        let progress = if progress.is_finite() {
            progress.clamp(0.0, 1.0)
        } else {
            0.0
        };
        let time = if time.is_finite() { time } else { 0.0 };
        let target = QuadTarget::from_box(bbox);
        Ok(ShaderQuad {
            shader,
            style: recipe.id.clone(),
            transform: TransformUniforms::default(),
            uniforms: QuadUniforms::Progress(ProgressUniforms {
                progress: progress as f32,
                time: time as f32,
                main_color: params.main_color,
                secondary_color: params.secondary_color,
                canvas_res: [canvas.0 as f32, canvas.1 as f32],
                src_res: target.res(),
                dst_res: target.res(),
                colour_multiplier: [1.0, 1.0, 1.0, 1.0],
                clip: [0.0, 0.0, 0.0, 0.0],
            }),
            recipe: recipe_uniform,
            data_texture: None,
            target,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use motion::preset_registry::timeline_progress;

    const BOX: DrawBox = DrawBox {
        x: 0.0,
        y: 0.0,
        w: 480.0,
        h: 120.0,
    };

    fn frame() -> VizFrame {
        VizFrame {
            time: (0..128).map(|i| i as u8).collect::<Vec<_>>().into(),
            freq: (0..512).map(|i| (i % 256) as u8).collect::<Vec<_>>().into(),
        }
    }

    /// 亚像素放置（P5b 定案 3）：`u_transform` 把单位 quad 映到一只**带小数**的
    /// 画布矩形。四条一起钉：铺满整只画布 == 单位阵；一半宽的框缩一半；
    /// **半个像素的位移就是半个像素**（这一条才是"亚像素"三个字的意思）；
    /// y 轴的朝向与顶点着色器那句 `-pos.y` 对得上。
    #[test]
    fn the_transform_places_the_quad_at_subpixel_precision() {
        let identity = TransformUniforms::default().transform;
        assert_eq!(
            TransformUniforms::place((0.0, 0.0, 1920.0, 1080.0), (1920.0, 1080.0)).transform,
            identity
        );

        // 左上四分之一：缩一半，中心落在 NDC 的 (−0.5, +0.5)。
        let quarter =
            TransformUniforms::place((0.0, 0.0, 960.0, 540.0), (1920.0, 1080.0)).transform;
        assert_eq!((quarter[0], quarter[5]), (0.5, 0.5));
        assert_eq!((quarter[12], quarter[13]), (-0.5, 0.5));

        // 半个像素的位移：NDC 上正好是 `2 · 0.5 / 1920`（x）与 `−2 · 0.5 / 1080`（y）。
        let base =
            TransformUniforms::place((100.0, 50.0, 480.0, 270.0), (1920.0, 1080.0)).transform;
        let moved =
            TransformUniforms::place((100.5, 50.5, 480.0, 270.0), (1920.0, 1080.0)).transform;
        // 容差取 f32 的量级：两个 ~0.65 的 f32 相减，绝对误差在 1e−7 上下。
        assert!((f64::from(moved[12] - base[12]) - 1.0 / 1920.0).abs() < 1e-6);
        assert!((f64::from(moved[13] - base[13]) + 1.0 / 1080.0).abs() < 1e-6);
        // 缩放不受落点影响。
        assert_eq!((moved[0], moved[5]), (base[0], base[5]));

        // `QuadTarget` 只取整数尺寸，小数部分交给上面那条变换。
        let target = QuadTarget::from_box(DrawBox {
            x: 100.25,
            y: 50.75,
            w: 480.0,
            h: 270.0,
        });
        assert_eq!((target.width, target.height), (480, 270));
        let (dx, dy) = target.subpixel_offset();
        assert!((dx - 0.25).abs() < 1e-9 && (dy - 0.75).abs() < 1e-9);
        // 夹具的整数盒：小数部分恒为 0。
        assert_eq!(QuadTarget::from_box(BOX).subpixel_offset(), (0.0, 0.0));
    }

    #[test]
    fn the_transform_applies_the_same_affine_as_drawops() {
        let rect = (100.0, 50.0, 200.0, 100.0);
        let affine = [2.0, 0.0, 0.0, 0.5, 10.0, 20.0];
        let matrix = TransformUniforms::place_affine(rect, affine, (1000.0, 500.0)).transform;
        let project = |qx: f32, qy: f32| {
            (
                matrix[0] * qx + matrix[4] * qy + matrix[12],
                matrix[1] * qx + matrix[5] * qy + matrix[13],
            )
        };
        let close = |left: f32, right: f32| (left - right).abs() < 1e-6;

        // Mat6 把像素盒 [100,300]×[50,150] 变成 [210,610]×[45,95]。
        let top_left = project(-1.0, 1.0);
        assert!(close(top_left.0, -0.58));
        assert!(close(top_left.1, 0.82));
        let bottom_right = project(1.0, -1.0);
        assert!(close(bottom_right.0, 0.22));
        assert!(close(bottom_right.1, 0.62));

        assert_eq!(
            TransformUniforms::place_affine(rect, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0], (1000.0, 500.0),),
            TransformUniforms::place(rect, (1000.0, 500.0))
        );
    }

    /// §8.2 的顺序是**冻结的跨文档契约**：这条测试就是它的可执行形式。
    #[test]
    fn the_group1_uniform_order_is_frozen() {
        assert_eq!(
            VisualizerUniforms::BINDINGS.map(|(_, name)| name),
            [
                "u_time",
                "u_mainColor",
                "u_secondaryColor",
                "u_canvasRes",
                "u_dstRes",
                "u_colourMultiplier",
                "u_clip",
                "u_textureSize",
            ]
        );
        assert_eq!(
            ProgressUniforms::BINDINGS.map(|(_, name)| name),
            [
                "u_progress",
                "u_time",
                "u_mainColor",
                "u_secondaryColor",
                "u_canvasRes",
                "u_srcRes",
                "u_dstRes",
                "u_colourMultiplier",
                "u_clip",
            ]
        );
        // binding 编号 = 表里的下标，两张表各自连续。
        for (index, (binding, _)) in VisualizerUniforms::BINDINGS.iter().enumerate() {
            assert_eq!(*binding as usize, index);
        }
        for (index, (binding, _)) in ProgressUniforms::BINDINGS.iter().enumerate() {
            assert_eq!(*binding as usize, index);
        }
    }

    /// §8.2 每项仍是独立 binding；scalar / vec2 也补到 WebGL2 要求的 16 B。
    #[test]
    fn the_uniform_payloads_match_their_wgsl_types() {
        let quad = ShaderQuad::progress(
            timeline_progress("normal").unwrap(),
            &ProgressParams {
                main_color: [1.0, 0.0, 0.0, 1.0],
                secondary_color: [0.0, 0.0, 1.0, 1.0],
                pixel_scale: 1.0,
            },
            0.5,
            0.0,
            BOX,
            (1920.0, 1080.0),
        )
        .unwrap();
        let sizes: Vec<usize> = quad
            .uniforms
            .bindings()
            .iter()
            .map(|binding| binding.bytes.len())
            .collect();
        assert_eq!(sizes, vec![16; 9]);
        // `@group(0)`：mat4x4f 64 字节、mat3x3f 每列补到 16 ⇒ 48 字节。
        let transform: Vec<usize> = quad
            .transform
            .bindings()
            .iter()
            .map(|binding| binding.bytes.len())
            .collect();
        assert_eq!(transform, vec![64, 48]);
        // `@group(3)`：`struct BarRecipe` 四个 f32。
        assert_eq!(quad.recipe.bytes.len(), 16);
        assert!(quad.data_texture.is_none(), "progress 没有音频纹理");
    }

    /// §8.3 的行语义：row 0 = 时域、row 1 = 频域、无 flip。
    ///
    /// GLSL 参考实现开了 `UNPACK_FLIP_Y_WEBGL`，行序与 WGSL 相反；这条断言就是
    /// 挡住"移植 GLSL 时忘了翻回来"的那一道门。
    #[test]
    fn the_audio_texture_rows_are_time_then_frequency_without_a_flip() {
        let frame = frame();
        let texture = AudioTexture::from_frame(&frame, BinWidth::Half);
        assert_eq!(texture.rows, 2);
        assert_eq!(texture.width, 512);
        assert_eq!(texture.data.len(), 1024);
        // 频域行原样搬运（`half` = 整条 512）。
        assert_eq!(texture.row(1), &frame.freq[..]);
        // 时域行是重采样过的，但**中心化到 128 的语义不变**：首字节仍来自
        // 时域行而不是频域行。翻转了行序的话 `row(0)` 会等于频域行。
        assert_ne!(texture.row(0), &frame.freq[..]);
        assert_eq!(texture.row(0).len(), 512);

        // `binWidth == "64"`：频域取最低 64 个 bin（§8.4，不做频率补偿）。
        let narrow = AudioTexture::from_frame(&frame, BinWidth::Fixed64);
        assert_eq!(narrow.width, 64);
        assert_eq!(narrow.row(1), &frame.freq[..64]);
    }

    /// 行宽相同时时域行**逐字节恒等**（不因为"走了一趟重采样"而漂移）。
    #[test]
    fn the_time_row_is_verbatim_when_the_widths_agree() {
        let frame = VizFrame {
            time: (0..64).map(|i| (i * 3) as u8).collect::<Vec<_>>().into(),
            freq: vec![7u8; 64].into(),
        };
        let texture = AudioTexture::from_frame(&frame, BinWidth::Fixed64);
        assert_eq!(texture.row(0), &frame.time[..]);
        assert_eq!(texture.row(1), &frame.freq[..]);
    }

    /// **14 个 progress 样式一个不漏都建得出 quad**：源码在、配方打包臂在、几何合法。
    ///
    /// 反过来那一半（"没有 WGSL 的样式必须是 `Err`，host 据此回退 CPU 而不是拿到
    /// 一个画不出东西的 quad"）由 `plan::shader_source` 的查表测试守住——那里能
    /// 造出一个不存在的样式 id，这里不能。
    #[test]
    fn every_progress_style_builds_a_quad() {
        let progress_params = ProgressParams {
            main_color: [1.0, 0.0, 0.0, 1.0],
            secondary_color: [0.0, 0.0, 1.0, 1.0],
            pixel_scale: 1.0,
        };
        for recipe in motion::preset_registry::timeline_progresses() {
            let quad =
                ShaderQuad::progress(recipe, &progress_params, 0.5, 0.25, BOX, (1920.0, 1080.0))
                    .unwrap_or_else(|error| panic!("progress/{}: {error}", recipe.id));
            // `@group(3)` 的配方包必须是 16 字节的整数倍（WGSL uniform 对齐）。
            assert_eq!(quad.recipe.bytes.len() % 16, 0, "{}", recipe.id);
            assert!(quad.data_texture.is_none(), "progress 没有音频纹理");
        }
    }

    /// 配方包的字节长度逐个家族对上各自 WGSL 里那份 struct 的大小。
    /// 改了字段又忘了改另一侧，这条立刻红。
    #[test]
    fn the_recipe_payload_sizes_match_their_wgsl_structs() {
        use motion::preset_registry::timeline_progress;
        let prog = |id: &str| timeline_progress(id).unwrap().progress().unwrap();
        assert_eq!(pack_bar_v1(prog("normal"), 1.0).unwrap().bytes.len(), 16);
        assert_eq!(
            pack_frame_v1(prog("rainbow_border")).unwrap().bytes.len(),
            // 12 个 f32 + `array<vec4f, 4>`
            48 + 64
        );
        assert_eq!(pack_ring_v1(prog("donut")).unwrap().bytes.len(), 16);
        assert_eq!(pack_snake_v1(prog("snake_spin")).unwrap().bytes.len(), 64);
    }

    /// 非有限进度值与 `progress_frame` 同一条处置（按 0 读，不 panic）。
    #[test]
    fn a_non_finite_progress_reads_as_zero() {
        let params = ProgressParams {
            main_color: [1.0, 0.0, 0.0, 1.0],
            secondary_color: [0.0, 0.0, 1.0, 1.0],
            pixel_scale: 1.0,
        };
        let quad = ShaderQuad::progress(
            timeline_progress("normal").unwrap(),
            &params,
            f64::NAN,
            f64::INFINITY,
            BOX,
            (1920.0, 1080.0),
        )
        .unwrap();
        let QuadUniforms::Progress(uniforms) = quad.uniforms else {
            unreachable!()
        };
        assert_eq!(uniforms.progress, 0.0);
        assert_eq!(uniforms.time, 0.0);
    }
}
