// BaoCut 元素 shader 的**无 binding 公共件**（设计 §8.6）。
//
// 这里只放纯函数：常量、区间重映射、缓动、三次 B 样条权重、两个 SDF。
// 任何读 `@group(…)` 的东西（`DiscardClip`、音频行采样助手、顶点着色器）都住在
// 各自 domain 的 `_prelude.wgsl` 里——visualizer 与 progress 的 `@group(1)` 布局
// 不同（§8.2：8 项 vs 9 项），公共件不能假设某个 binding 存在。
//
// 组装方式是**构建期字符串拼接**（`include_str!` 前缀合并，见
// `src/plan/shader_source.rs`），不引入 shader 预处理器：`#include` 是参考实现
// 自己的指令，BaoCut 不复制那套机制（§8.6）。
//
// 许可纪律（§8.6）：本文件按语义重新实现，不逐字复制任何参考着色器；
// 配方数字一个都不在这里，全部经 `@group(3)` 的 recipe uniform 注入。

const PI : f32 = 3.14159265358979323846;
const TWO_PI : f32 = 6.28318530717958647692;

/// 元素盒的**纵向中线**（归一化 v）。四份曲线 shader 的 `texCoord.y − 0.5`
/// 说的都是这一件事：盒子中线，不是某种样式的取舍。Rust 侧的孪生是
/// `kernel::MID_V`。
const MID_V : f32 = 0.5;

/// 矢量边所在的等值线：`factor == 0.5`（Rust 侧孪生是 `kernel::COVERAGE`）。
/// **不是配方参数**——它是"连续 factor 场 → 矢量边"这条换算规则本身。
const COVERAGE : f32 = 0.5;

/// `[a1, a2]` → `[b1, b2]` 的线性重映射（不夹端点，与 CPU 侧同口径）。
fn mapRange(value : f32, a1 : f32, a2 : f32, b1 : f32, b2 : f32) -> f32 {
    return b1 + (value - a1) * (b2 - b1) / (a2 - a1);
}

/// GLSL 的 `mod`（结果与除数同号），WGSL 的 `%` 是截断取余，两者对负数不同。
fn glslMod(x : f32, y : f32) -> f32 {
    return x - y * floor(x / y);
}

/// 配方里的 `{"edge0": a, "edge1": b}` 斜坡。
///
/// **不用 WGSL 内建的 `smoothstep`**：`edge0 > edge1`（下降斜坡，`gapCurve` 就是
/// 这样）在 WGSL / MSL / GLSL 的规范里都写着"结果未定义"，实际行为靠各家实现的
/// 善意。CPU 参照（`source/kernel.rs::smoothstep`）对两个方向都有定义、并把
/// `edge0 == edge1` 定死成阶跃；conformance 要求两边逐点一致，因此这里逐字重写
/// 同一条定义，而不是赌驱动。
fn ramp(edge0 : f32, edge1 : f32, x : f32) -> f32 {
    if (edge0 == edge1) {
        return select(1.0, 0.0, x < edge0);
    }
    let t : f32 = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn easeOutQuad(x : f32) -> f32 {
    let inv : f32 = 1.0 - x;
    return 1.0 - inv * inv;
}

fn easeOutCubic(x : f32) -> f32 {
    let inv : f32 = 1.0 - x;
    return 1.0 - inv * inv * inv;
}

fn easeOutSine(x : f32) -> f32 {
    return sin(x * PI * 0.5);
}

fn easeOutExpo(x : f32) -> f32 {
    if (x >= 1.0) {
        return 1.0;
    }
    return 1.0 - exp2(-10.0 * x);
}

fn easeInOutQuad(p : f32) -> f32 {
    if (p < 0.5) {
        return 2.0 * p * p;
    }
    return (-2.0 * p * p) + (4.0 * p) - 1.0;
}

fn easeInOutCubic(p : f32) -> f32 {
    if (p < 0.5) {
        return 4.0 * p * p * p;
    }
    let q : f32 = 2.0 * p - 2.0;
    return 0.5 * q * q * q + 1.0;
}

/// 配方的 `easing` 字段（封闭枚举）经 recipe uniform 下来的**数值编码**。
/// 编码表的唯一真相是 Rust 侧的 `ShaderEasing`（`src/plan/shader_quad.rs`），
/// 这里只做分派；WGSL 里因此没有"哪个样式用哪条缓动"的知识。
fn applyEasing(code : f32, x : f32) -> f32 {
    if (code < 0.5) {
        return x;
    }
    if (code < 1.5) {
        return easeOutQuad(x);
    }
    if (code < 2.5) {
        return easeOutSine(x);
    }
    if (code < 3.5) {
        return easeOutCubic(x);
    }
    return easeOutExpo(x);
}

/// 配方 `envelope.ease` 的**数值编码**（0 = `easeInOutQuad`、1 = `easeInOutCubic`）。
/// 唯一真相是 Rust 侧的 `kernel::EnvelopeEase::code()`，这里只做分派；
/// 与 [`applyEasing`] 分成两个函数，是因为两个字段的取值域互不相交
/// （顶层 `easing` 是 `easeOut*`、包络是 `easeInOut*`），合成一张表反而会让
/// "哪个码属于哪个字段"变成一句注释。
fn applyEnvelopeEase(code : f32, p : f32) -> f32 {
    if (code < 0.5) {
        return easeInOutQuad(p);
    }
    return easeInOutCubic(p);
}

/// CPU 参照的 `Envelope::apply`：`f = u·span`、`(1 − |center − f| / radius) · gain`、
/// `min(·, 1)`、缓动。**刻意不夹下界**——参考实现只做了 `min(p, 1)`，`p < 0` 时
/// `2p²` / `4p³` 照样算，曲线族两端因此留着一丝极小的包络值。
fn envelopeAt(u : f32, code : f32, span : f32, center : f32, radius : f32, gain : f32) -> f32 {
    let scaled : f32 = u * span;
    let value : f32 = (1.0 - abs(center - scaled) / radius) * gain;
    return applyEnvelopeEase(code, min(value, 1.0));
}

/// 三次 B 样条基（和恒为 1），`t ∈ [0, 1)`。
///
/// 参考实现用 `n = (1,2,3,4) − t`、`s = n³` 再逐项差分算同一组权重；本实现直接
/// 写基函数本身——两者逐点恒等，写基函数少一层间接。CPU 侧的 `cubic_weights`
/// （`source/kernel.rs`）是同一组数。
fn cubicWeights(t : f32) -> vec4f {
    let inv : f32 = 1.0 - t;
    let w0 : f32 = inv * inv * inv;
    let w1 : f32 = 3.0 * t * t * t - 6.0 * t * t + 4.0;
    let w2 : f32 = -3.0 * t * t * t + 3.0 * t * t + 3.0 * t + 1.0;
    let w3 : f32 = t * t * t;
    return vec4f(w0, w1, w2, w3) * (1.0 / 6.0);
}

/// 中心在原点、半边长 `b` 的矩形 SDF（外正内负）。
fn sdBox(p : vec2f, b : vec2f) -> f32 {
    let d : vec2f = abs(p) - b;
    return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

/// 线段 `ab` 的 SDF。
fn sdSegment(p : vec2f, a : vec2f, b : vec2f) -> f32 {
    let pa : vec2f = p - a;
    let ba : vec2f = b - a;
    let h : f32 = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

/// 一条**以 CPU 的半覆盖等值线为中心**的软边：`x < threshold` 侧为 0，
/// `x > threshold` 侧为 1，过渡带宽 `width`，半覆盖恰好落在 `threshold`。
///
/// ## 为什么不照抄参考实现的 `smoothstep(threshold, threshold + width, x)`
///
/// 那一条是**单侧**的：半覆盖点落在 `threshold + width/2`，几何边因此整体挪了
/// 半个带宽。`formation_circle` 的 `smoothing = 0.01` 在 324 px 的方盒上就是
/// 1.6 px，两端各挪一次，一根径向柱子会比 CPU 参照短 3 px——这不是抗锯齿，是
/// **几何偏移**，strict 判据（GPU vs CPU 逐像素可比）容不下它。
///
/// BaoCut 因此把这一档参数读成"**边的带宽**"而不是"边的起点"：CPU 参照按
/// [`COVERAGE`] 把边画在 `threshold` 上（它索性不读带宽，§13 P3 偏离 2），
/// GPU 在同一条线上铺开一条对称的过渡带。两边的边**重合**，差别只剩过渡带
/// 本身——那正是修正后 §8.7 判据留出余量的东西。
fn softEdge(threshold : f32, width : f32, x : f32) -> f32 {
    let half : f32 = width * 0.5;
    return ramp(threshold - half, threshold + half, x);
}

/// [`softEdge`] 的**夹到一个像素**版本。
///
/// 参考实现的"软边宽度"这一族参数分两类：
///
/// * 带宽本来就在**一两个像素**量级（`ring-v1` 的 `featherPx = 4/res`、
///   `frame-v1` 的 `smoothing = 0.0032`）——那就是抗锯齿，原样用；
/// * 带宽**显著大于一个像素**（`snake-v1` 的 `smoothing = 0.032`、
///   `bars-polar-v1` 的 `0.01`，在 324 px 的方盒上是 10 px / 3 px）——那是**造型**
///   而不是抗锯齿。CPU 参照按 [`COVERAGE`] 把边画在等值线上、索性不读带宽
///   （§13 P3 偏离 2 / P4 偏离 5），strict 判据要求 GPU 与它逐像素可比，
///   于是这里把带宽夹到一个像素：边的位置不变，过渡带收成光栅器那一档。
///
/// 这条与 `beam` / `harmony` 那边"`lineWidth` 读成实心带子"是**同一条家族规则**
/// （见 `bandCoverage`）：软边参数一律服从 CPU 已经冻结的几何。
fn softEdgePixel(threshold : f32, width : f32, pixel : f32, x : f32) -> f32 {
    return softEdge(threshold, min(width, pixel), x);
}

/// 一条**有确定宽度的带子**在 `value` 轴上的覆盖率，两端各留 `w` 宽的过渡。
///
/// P4 把参考实现里 `lineWidth = −0.04` 那一档软边定案读成"带宽 `|lineWidth|/2`
/// 的实心带子"（§13 P4 偏离 3）——那是 **BaoCut 自己的语义**，不是抗锯齿：
/// 0.04 归一化高在 1080p 的横条元素上有 9 px，照抄渐变会让 strict 的过渡带预算
/// 被单一样式吃光。曲线族的 WGSL 因此实现 CPU 的两块式读法，`w` 只承担
/// **一个像素以内**的抗锯齿（调用方传 `1/u_dstRes.y` 一族）。
fn bandCoverage(value : f32, low : f32, high : f32, w : f32) -> f32 {
    return ramp(low - w, low + w, value) * ramp(high + w, high - w, value);
}

/// 直通色 → premultiplied：`(rgb · a, a)`。
///
/// 参考实现好几处写的是 `colour * colour.a`——那把 **alpha 也乘了一遍**，得到
/// `a²`。`a == 1`（默认）时两种读法逐字相同，半透明元素上参考实现会画淡一倍；
/// §13 P4 偏离 6 已经就 `harmony` 定过这条案，本函数是它的通用形式。
fn premultiplied(colour : vec4f) -> vec4f {
    return vec4f(colour.rgb * colour.a, colour.a);
}

/// premultiplied alpha 的 source-over：`src` 画在 `dst` 之上。
///
/// 用在**同一条线自己的两块**（面与镶边，互不重叠）以及 `beam` 这种单层样式上。
/// 线与线之间不走这里：参考实现是 `colour +=` 加色，`envelope-lines-v1` 两侧一起
/// 照做（矢量侧是每条线一层 + `Plus`），见 [`storablePremultiplied`]。
fn alphaOver(src : vec4f, dst : vec4f) -> vec4f {
    return src + dst * (1.0 - src.a);
}

/// 预乘贡献色 → **可存**的预乘色：`rgb > a` 时把 alpha 抬到 `max(rgb)`。
///
/// 参考实现的 fragment 是浮点的，把几条线 `colour += ...` 进同一个像素后可以留下
/// `rgb > a` 的**超亮**预乘色（`simi` 的三条固定色就是：`(1, 0.2, 0.2)` 配
/// `a = 1/3`）。BaoCut 的 CPU 参照落在 tiny-skia 的**预乘 u8** Pixmap 上，那种色
/// 存不下；两侧必须画同一幅图，因此**两侧一起**抬 alpha——rgb 逐位保住，代价是那
/// 一段不再透出背景。矢量侧的孪生是
/// `source/visualizer/recipes/envelope_lines_v1.rs::storable_color`。
fn storablePremultiplied(contribution : vec4f) -> vec4f {
    let opaque : f32 = max(
        contribution.a,
        max(contribution.r, max(contribution.g, contribution.b))
    );
    return vec4f(contribution.rgb, opaque);
}

/// screen 混合（`echo_lines` 的回声层）。
fn screenBlend(a : vec4f, b : vec4f) -> vec4f {
    return vec4f(1.0) - (vec4f(1.0) - a) * (vec4f(1.0) - b);
}

/// 四角双线性渐变（progress 的 rainbow / strobe 共用）。
fn fourCornerGradient(uv : vec2f, a : vec4f, b : vec4f, c : vec4f, d : vec4f) -> vec4f {
    let top : vec4f = mix(a, b, uv.x);
    let bot : vec4f = mix(c, d, uv.x);
    return mix(top, bot, uv.y);
}

/// HSV → RGB（Iñigo Quílez 的经典写法），alpha 直通。
fn hsvToRgb(hsv : vec4f) -> vec4f {
    let k : vec4f = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p : vec3f = abs(fract(hsv.xxx + k.xyz) * 6.0 - k.www);
    return vec4f(hsv.z * mix(k.xxx, clamp(p - k.xxx, vec3f(0.0), vec3f(1.0)), hsv.y), hsv[3]);
}

/// RGB → HSV，alpha 直通。
fn rgbToHsv(colour : vec4f) -> vec4f {
    let k : vec4f = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p : vec4f = mix(vec4f(colour.bg, k.wz), vec4f(colour.gb, k.xy), step(colour.b, colour.g));
    let q : vec4f = mix(vec4f(p.xyw, colour.r), vec4f(colour.r, p.yzx), step(p.x, colour.r));
    let d : f32 = q.x - min(q.w, q.y);
    let e : f32 = 1.0e-10;
    return vec4f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x, colour[3]);
}

/// HSB → RGB（饱和度取自半径的彩虹环用；与 [`hsvToRgb`] 是两条不同的写法，
/// 参考实现两处各用一条，逐字保留以免"看起来一样其实差一点"）。
fn hsbToRgb(c : vec3f) -> vec3f {
    var rgb : vec3f = clamp(
        abs(glslMod3(c.x * 6.0 + vec3f(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
        vec3f(0.0),
        vec3f(1.0)
    );
    rgb = rgb * rgb * (3.0 - 2.0 * rgb);
    return c.z * mix(vec3f(1.0), rgb, c.y);
}

fn glslMod3(x : vec3f, y : f32) -> vec3f {
    return x - y * floor(x / y);
}

fn rotate2d(angle : f32) -> mat2x2f {
    return mat2x2f(cos(angle), -sin(angle), sin(angle), cos(angle));
}
