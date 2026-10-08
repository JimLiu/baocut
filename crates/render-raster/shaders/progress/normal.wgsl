// `bar-v1` 的 WGSL 实现（元素方案 §7.4）。
//
// CPU 参照是 `src/source/progress/recipes/bar_v1.rs`：底色铺满整只盒子，
// `x < progress` 的部分换主色；胶囊形样式（`rounded`）再压一层圆角矩形裁剪。
// 颜色分界是**竖直硬边**，圆角只属于外轮廓——给进度块也加圆角会长出一个不该
// 存在的右圆头。
//
// 与 visualizer 侧同样的纪律：**本文件不含配方数字**，`direction` 与
// `radiusPx` 经 `@group(3)` 注入，因此同一份源码覆盖 `normal` 与 `rounded`
// （P5b 把 `rounded.json` 的 `shader` 指过来即可）。

/// 配方参数。字段顺序 = Rust 侧 `BarRecipeUniform` 的打包顺序。
struct BarRecipe {
    /// 0 = `ltr`，1 = `rtl`（注册表的封闭枚举，按数据分派而不是按 id）。
    direction : f32,
    /// 胶囊圆角半径，**像素**。host 已按 `pixel_scale`
    /// （`canvas_short_edge / REFERENCE_SHORT_EDGE`）折算，见 progress/draw.rs
    /// 的模块文档；0 = 直角。
    radiusPx : f32,
    _pad0 : f32,
    _pad1 : f32,
}

@group(3) @binding(0) var<uniform> u_recipe : BarRecipe;

@fragment fn fragmentMain(in : VertexOutput) -> @location(0) vec4f {
    DiscardProgressClip(in.texCoord);

    // 圆角裁剪：夹到"半个短边"以内，与 CPU 侧逐字同一条 clamp——一条 5% 高的
    // 进度条因此正好是胶囊形，而不是被 200 px 的原始半径撑成怪形状。
    let radius : f32 = min(u_recipe.radiusPx, min(u_dstRes.value.x, u_dstRes.value.y) * 0.5);
    if (radius > 0.0) {
        let pixel : vec2f = in.texCoord * u_dstRes.value;
        let half : vec2f = u_dstRes.value * 0.5;
        // 圆角矩形 = 收缩 r 的矩形 SDF 再外扩 r。
        let dist : f32 = sdBox(pixel - half, half - vec2f(radius)) - radius;
        if (dist > 0.0) { discard; }
    }

    // `rtl` 目前没有配方在用，但取值域是注册表的封闭枚举，实现补齐。
    var filled : bool;
    if (u_recipe.direction > 0.5) {
        filled = in.texCoord.x >= 1.0 - u_progress.value.x;
    } else {
        filled = in.texCoord.x < u_progress.value.x;
    }

    var colour : vec4f = u_secondaryColor;
    if (filled) {
        colour = u_mainColor;
    }
    colour = colour * u_colourMultiplier;

    // §8.5：premultiplied alpha。
    let alpha : f32 = colour.a;
    return vec4f(colour.rgb * alpha, alpha);
}
