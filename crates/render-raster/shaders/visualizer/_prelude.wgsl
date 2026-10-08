// visualizer domain 的 binding 面与顶点着色器（设计 §8.1 / §8.2 / §8.3）。
//
// 本文件是 §8 冻结契约在 WGSL 侧的落点：改这里就是改跨文档契约。Rust 侧的
// 对应真相是 `src/plan/shader_quad.rs` 的 `VisualizerUniforms::BINDINGS`
// 与 `source/visualizer::AUDIO_TEXTURE_ROW_{TIME,FREQ}`，两处由
// `tests/shader_wgsl.rs` 对拍。

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) texCoord : vec2f,
}

// ── §8.1 `@group(0)`：顶点变换。
@group(0) @binding(0) var<uniform> u_transform : mat4x4f;
@group(0) @binding(1) var<uniform> u_texTransform : mat3x3f;

// ── §8.2 `@group(1)`：visualizer 的 8 项，**顺序冻结**。
// WebGL2 没有 `BUFFER_BINDINGS_NOT_16_BYTE_ALIGNED`，故 scalar / vec2 的
// binding 类型显式补到 16 B；binding 数量、名字和顺序仍与冻结表逐项相同。
struct ScalarUniform { value : vec4f }
struct Vec2Uniform { value : vec2f, _padding : vec2f }
@group(1) @binding(0) var<uniform> u_time : ScalarUniform;
@group(1) @binding(1) var<uniform> u_mainColor : vec4f;
@group(1) @binding(2) var<uniform> u_secondaryColor : vec4f;
@group(1) @binding(3) var<uniform> u_canvasRes : Vec2Uniform;
@group(1) @binding(4) var<uniform> u_dstRes : Vec2Uniform;
@group(1) @binding(5) var<uniform> u_colourMultiplier : vec4f;
@group(1) @binding(6) var<uniform> u_clip : vec4f;
@group(1) @binding(7) var<uniform> u_textureSize : Vec2Uniform;

// ── §8.1 `@group(2)`：音频数据纹理 + 采样器（linear / clamp-to-edge）。
@group(2) @binding(0) var u_audio : texture_2d<f32>;
@group(2) @binding(1) var uSampler : sampler;

// ── `@group(3)`：**配方参数**。§8.2 冻结的是 `@group(1)` 的顺序，配方数字不能
//    挤进去；BaoCut 因此把它们放在自己的 group 里，一份 struct 一个 binding。
//    struct 的字段表由各样式文件声明，Rust 侧的打包顺序必须与之逐字对应。

/// 归一化 `texCoord` 的四边裁剪（§8.5）：`u_clip = [left, top, right, bottom]`，
/// 超出即 `discard`。
fn DiscardClip(texCoord : vec2f) {
    var clipped : bool = false;
    if (texCoord.x <= u_clip[0]) { clipped = true; }
    if (texCoord.y <= u_clip[1]) { clipped = true; }
    if (texCoord.x >= 1.0 - u_clip[2]) { clipped = true; }
    if (texCoord.y >= 1.0 - u_clip[3]) { clipped = true; }
    if (clipped) { discard; }
}

// ── §8.3 音频纹理的行语义：**row 0 = 时域，row 1 = 频域，无 flip**。
//
// 参考实现的 GLSL 版开了 `UNPACK_FLIP_Y_WEBGL`，`v = 0` 在那边是频域行，与
// WGSL 版**相反**。BaoCut 采纳 WGSL 侧语义，移植 GLSL 参考实现时必须翻转行
// 索引，否则得到静默的错误图像（时域行是"静音 ≈ 128"的中心化波形，拿它当频域
// 用只会画出一排半高的柱子，看起来"像在工作"）。
//
// `v = 0.0` / `v = 1.0` 配 clamp-to-edge 后落在**纹素中心之外**，因此纵向被夹到
// 该行本身，两行不会互相插值——这一点对下面的 bicubic 尤其重要。
const AUDIO_ROW_TIME : f32 = 0.0;
const AUDIO_ROW_FREQ : f32 = 1.0;

fn sampleTemporal(x : f32) -> f32 {
    return textureSampleLevel(u_audio, uSampler, vec2f(x, AUDIO_ROW_TIME), 0.0).r;
}

fn sampleFrequency(x : f32) -> f32 {
    return textureSampleLevel(u_audio, uSampler, vec2f(x, AUDIO_ROW_FREQ), 0.0).r;
}

/// 一条行的 **bicubic 采样**：`textureBicubic` 的一维版本。
///
/// ## 为什么不是参考实现那个二维取样（P5b 移植的头号陷阱）
///
/// 参考实现的 `textureBicubic` 在 `w × 2` 的纹理上做**二维** bicubic。代进去
/// 算：取频域行时 `v = 1`，纵向被 clamp-to-edge 救了回来；可取**频域行**的那条
/// 路径在 CPU 侧的对应实现里 `v = 0` 时 `fract(0·2 − 0.5) = 0.5`，纵向权重成了
/// `0.9792 × row0 + 0.0208 × row1`——2.1% 的时域行渗进了另一行的取值。静音时
/// （时域行 ≈ 128）这一项就有 `0.0208 × 0.5 ≈ 2.65/255`，**单这一处渗漏就吹掉
/// strict 级 ≤ 2/255 的全部预算**。
///
/// 那是"两条语义无关的行挤进一张纹理再做二维插值"的产物，不是样式的一部分：
/// 配方的 `row` 字段已经把该读哪条行说清楚了。CPU 侧
/// （`source/kernel.rs::sample_row_bicubic`）因此**只沿 u 轴插值**，本函数与它
/// 逐字同构——`row` 参数原样传给纵向坐标，纵向永远被 clamp 到那一行。
///
/// 换算沿用参考实现的"两次 linear 取样 + 一次 mix"，而不是四点卷积：两条读法
/// 逐点恒等（CPU 侧有测试钉住），留与 shader 对得上的那一份。
fn sampleRowBicubic(x : f32, row : f32) -> f32 {
    let width : f32 = u_textureSize.value.x;
    let coord : f32 = x * width - 0.5;
    let base : f32 = floor(coord);
    let w : vec4f = cubicWeights(coord - base);
    let low : f32 = w.x + w.y;
    let high : f32 = w.z + w.w;
    // 权重和恒为 1 且两个部分和恒 ≥ 1/6，除法安全。
    let left : f32 = (base - 0.5 + w.y / low) / width;
    let right : f32 = (base + 1.5 + w.w / high) / width;
    let mixing : f32 = low / (low + high);
    let a : f32 = textureSampleLevel(u_audio, uSampler, vec2f(right, row), 0.0).r;
    let b : f32 = textureSampleLevel(u_audio, uSampler, vec2f(left, row), 0.0).r;
    return mix(a, b, mixing);
}

/// §8.1：单 quad，几何全部在 fragment shader 里程序化生成；顶点着色器只做
/// **y-flip**（匹配 OpenGL 约定）与纹理坐标变换。纹理坐标原点左上。
@vertex fn vertexMain(@location(0) pos : vec2f, @location(1) uv : vec2f) -> VertexOutput {
    var output : VertexOutput;
    output.position = u_transform * vec4f(pos.x, -pos.y, 0.0, 1.0);
    let transformed : vec3f = u_texTransform * vec3f(uv, 1.0);
    output.texCoord = transformed.xy;
    return output;
}
