// `frame-v1` 的 WGSL 实现（元素方案 §7.4）。
//
// 一份源码覆盖 6 种：`border` / `reverse_border`（solid，strict）、
// `rainbow_border` / `reverse_rainbow_border`（hue 循环，visual）、
// `strobe_border` / `reverse_strobe_border`（频闪，visual）。差别全在配方的
// `fill` / `background` / `colorMode` 三项里。
// CPU 参照是 `src/source/progress/recipes/frame_v1.rs`。
//
// ## 坐标：**v 向上**
//
// 参考实现的四个 box 注释写着 "BL to BR" / "BL to TL"——它假设 `uv` 原点在
// **左下**。§8.1 冻结的 `texCoord` 原点在左上，因此这里先做 P5a 偏离 4 的那一次
// 翻转，再按参考实现摆四条边；CPU 参照的 `Edge::{Bottom,Top,Left,Right}` 与
// 翻转后的四个 box 逐条对应。
//
// ## 边框粗细
//
// `barSize = borderSize · sourceAspect.yx` 绕这一圈就是为了让横竖两条边在像素上
// **一样粗**（都等于 `borderSize · max(w, h)`）。CPU 侧直接用这个结论，
// 这里逐字照抄那条换算——它同时决定了 SDF 的各向异性 smoothing 带宽。

/// 配方参数。字段顺序 = Rust 侧 `pack_frame_v1` 的打包顺序。
struct FrameRecipe {
    borderSize : f32,
    /// SDF 软边带宽（归一化）。CPU 侧不读（矢量边由光栅器抗锯齿），GPU 侧用上。
    smoothing : f32,
    /// `fill`：0 = `forward`，1 = `reverse`。
    reverse : f32,
    /// `background`：底框画不画。
    background : f32,
    /// `colorMode.kind`：0 = solid、1 = rainbow、2 = strobe。
    colorKind : f32,
    /// rainbow 的 hue 循环速度。
    hueSpeed : f32,
    /// 混色量 `mixBias + (sin(t)·0.5 + 0.5) · mixGain`。
    mixBias : f32,
    mixGain : f32,
    /// strobe 的频闪速度。
    strobeSpeed : f32,
    _pad0 : f32,
    _pad1 : f32,
    _pad2 : f32,
    /// rainbow 的四角基色。
    corners : array<vec4f, 4>,
}

@group(3) @binding(0) var<uniform> u_recipe : FrameRecipe;

/// 中心在原点、半边长 `b` 的矩形 SDF 软边（1 = 内部）。
///
/// 过渡带**对称地**骑在 `sdBox == 0` 这条边上（`softEdge`），不是参考实现那条
/// 单侧的 `smoothstep(0, smoothing, d)`——单侧读法会把每条边加宽半个带宽
/// （480 px 宽的框上是 1.5 px），而 CPU 参照画的是精确矩形。
fn frameBar(pos : vec2f, size : vec2f) -> f32 {
    return 1.0 - softEdge(0.0, u_recipe.smoothing, sdBox(pos, size));
}

/// 底框：四条整边的并集（`clamp(b1+b2+b3+b4, 0, 1)` 就是并集）。
fn backgroundFrame(uv : vec2f, size : vec2f) -> f32 {
    let b1 : f32 = frameBar(uv, vec2f(1.0, size.y));
    let b2 : f32 = frameBar(uv, vec2f(size.x, 1.0));
    let b3 : f32 = frameBar(uv - vec2f(0.0, 1.0), vec2f(1.0, size.y));
    let b4 : f32 = frameBar(uv - vec2f(1.0, 0.0), vec2f(size.x, 1.0));
    return clamp(b1 + b2 + b3 + b4, 0.0, 1.0);
}

/// `fill: "forward"`：周长按 `w : h` 分成两段，两条臂**同时从左下角出发**，
/// `progress == 1` 时在右上角会合。
fn forwardFrame(uv : vec2f, size : vec2f) -> f32 {
    let span : f32 = u_srcRes.value.x + u_srcRes.value.y;
    let across : f32 = u_srcRes.value.x / span;
    let up : f32 = u_srcRes.value.y / span;
    let progress : f32 = u_progress.value.x;

    var b1 : f32 = 0.0;
    var b2 : f32 = 0.0;
    var b3 : f32 = 0.0;
    var b4 : f32 = 0.0;
    if (progress > 0.0) {
        b1 = frameBar(uv, vec2f(clamp(progress / across, 0.0, 1.0), size.y));
        b2 = frameBar(uv, vec2f(size.x, clamp(progress / up, 0.0, 1.0)));
    }
    if (progress >= up) {
        b3 = frameBar(uv - vec2f(0.0, 1.0), vec2f(clamp((progress - up) / (1.0 - up), 0.0, 1.0), size.y));
    }
    if (progress >= across) {
        b4 = frameBar(uv - vec2f(1.0, 0.0), vec2f(size.x, clamp((progress - across) / (1.0 - across), 0.0, 1.0)));
    }
    return clamp(b1 + b2 + b3 + b4, 0.0, 1.0);
}

/// `fill: "reverse"`：用 `1 − progress` 当长度，从左下与右上两个角各伸出一个
/// L 形。这一支**没有**周长归一化，如实照搬。满进度时整圈消失。
fn reverseFrame(uv : vec2f, size : vec2f) -> f32 {
    let reach : f32 = 1.0 - u_progress.value.x;
    if (!(reach > 0.0)) {
        return 0.0;
    }
    let flipped : vec2f = vec2f(1.0) - uv;
    var bars : f32 = frameBar(uv, vec2f(reach, size.y));
    bars = bars + frameBar(uv, vec2f(size.x, reach));
    bars = bars + frameBar(flipped, vec2f(reach, size.y));
    bars = bars + frameBar(flipped, vec2f(size.x, reach));
    return clamp(bars, 0.0, 1.0);
}

/// `sin(u_time) · 0.5 + 0.5` 再线性映到 `[mixBias, mixBias + mixGain]`。
fn frameMixAmount() -> f32 {
    return u_recipe.mixBias + (sin(u_time.value.x) * 0.5 + 0.5) * u_recipe.mixGain;
}

/// hue 沿 `sin(u_time) · hueSpeed` 循环的一枚角色。
fn hueCycled(colour : vec4f) -> vec4f {
    var hsv : vec4f = rgbToHsv(colour);
    hsv.r = hsv.r + sin(u_time.value.x) * u_recipe.hueSpeed;
    return hsvToRgb(hsv);
}

/// 进度框的颜色。`dist` 是覆盖率，返回值已经是 premultiplied 形态。
fn frameProgressColour(uv : vec2f, dist : f32) -> vec4f {
    if (u_recipe.colorKind < 0.5) {
        // solid：主色 × 覆盖率。
        return vec4f(dist * u_mainColor.rgb, dist) * u_mainColor.a;
    }
    var gradient : vec4f;
    if (u_recipe.colorKind < 1.5) {
        // rainbow：四角基色各走一趟 hue 循环，再按 uv 双线性。
        gradient = fourCornerGradient(
            uv,
            hueCycled(u_recipe.corners[0]),
            hueCycled(u_recipe.corners[1]),
            hueCycled(u_recipe.corners[2]),
            hueCycled(u_recipe.corners[3])
        );
    } else {
        // strobe：两枚元素色轮流，**采样点是常数** `(s, −s)`，因此整框同色。
        let s : f32 = sin(u_time.value.x * u_recipe.strobeSpeed) * 0.5 + 0.5;
        gradient = fourCornerGradient(
            vec2f(s, -s),
            u_mainColor,
            u_secondaryColor,
            u_mainColor,
            u_secondaryColor
        );
    }
    let amount : f32 = frameMixAmount();
    let rgb : vec3f = mix(vec3f(dist), gradient.rgb, amount * dist);
    return vec4f(rgb, dist) * u_mainColor.a;
}

@fragment fn fragmentMain(in : VertexOutput) -> @location(0) vec4f {
    DiscardProgressClip(in.texCoord);

    // 见文件头：参考实现的四个 box 摆在 v 向上的坐标里。
    let uv : vec2f = vec2f(in.texCoord.x, 1.0 - in.texCoord.y);
    let aspect : vec2f = u_srcRes.value / min(u_srcRes.value.x, u_srcRes.value.y);
    let size : vec2f = vec2f(u_recipe.borderSize) * aspect.yx;

    var progressDistance : f32;
    if (u_recipe.reverse > 0.5) {
        progressDistance = reverseFrame(uv, size);
    } else {
        progressDistance = forwardFrame(uv, size);
    }
    let progressColour : vec4f = frameProgressColour(uv, progressDistance);

    var backgroundColour : vec4f = vec4f(0.0);
    if (u_recipe.background > 0.5) {
        let distance : f32 = backgroundFrame(uv, size);
        backgroundColour = vec4f(distance * u_secondaryColor.rgb, distance) * u_secondaryColor.a;
    }

    // `mask(bg, prog)` = `mix(bg, prog, prog.a)`，正是 premultiplied 的
    // source-over：CPU 侧就是"先画底框、再画进度框"。
    return alphaOver(progressColour, backgroundColour) * u_colourMultiplier;
}
