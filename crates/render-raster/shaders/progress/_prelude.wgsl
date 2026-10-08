// progress domain 的 binding 面与顶点着色器（设计 §8.1 / §8.2）。
//
// 与 visualizer 的 `_prelude.wgsl` 是**两份**而不是一份：`@group(1)` 的布局不同
// （progress 9 项、多 `u_progress` / `u_srcRes`、少 `u_textureSize`），而且
// progress **没有 `@group(2)`**——它的内容由播放头推导，不是素材源。

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) texCoord : vec2f,
}

// ── §8.1 `@group(0)`：顶点变换。
@group(0) @binding(0) var<uniform> u_transform : mat4x4f;
@group(0) @binding(1) var<uniform> u_texTransform : mat3x3f;

// ── §8.2 `@group(1)`：progress 的 9 项，**顺序冻结**。
// WebGL2 没有 `BUFFER_BINDINGS_NOT_16_BYTE_ALIGNED`，故 scalar / vec2 的
// binding 类型显式补到 16 B；binding 数量、名字和顺序仍与冻结表逐项相同。
struct ScalarUniform { value : vec4f }
struct Vec2Uniform { value : vec2f, _padding : vec2f }
@group(1) @binding(0) var<uniform> u_progress : ScalarUniform;
@group(1) @binding(1) var<uniform> u_time : ScalarUniform;
@group(1) @binding(2) var<uniform> u_mainColor : vec4f;
@group(1) @binding(3) var<uniform> u_secondaryColor : vec4f;
@group(1) @binding(4) var<uniform> u_canvasRes : Vec2Uniform;
@group(1) @binding(5) var<uniform> u_srcRes : Vec2Uniform;
@group(1) @binding(6) var<uniform> u_dstRes : Vec2Uniform;
@group(1) @binding(7) var<uniform> u_colourMultiplier : vec4f;
@group(1) @binding(8) var<uniform> u_clip : vec4f;

// ── `@group(3)`：配方参数（见 visualizer 侧同名段落的理由）。

/// §8.5 的四边裁剪，progress 侧的名字。
fn DiscardProgressClip(texCoord : vec2f) {
    var clipped : bool = false;
    if (texCoord.x <= u_clip[0]) { clipped = true; }
    if (texCoord.y <= u_clip[1]) { clipped = true; }
    if (texCoord.x >= 1.0 - u_clip[2]) { clipped = true; }
    if (texCoord.y >= 1.0 - u_clip[3]) { clipped = true; }
    if (clipped) { discard; }
}

/// §8.1：单 quad + y-flip，与 visualizer 侧逐字相同。
@vertex fn vertexMain(@location(0) pos : vec2f, @location(1) uv : vec2f) -> VertexOutput {
    var output : VertexOutput;
    output.position = u_transform * vec4f(pos.x, -pos.y, 0.0, 1.0);
    let transformed : vec3f = u_texTransform * vec3f(uv, 1.0);
    output.texCoord = transformed.xy;
    return output;
}
