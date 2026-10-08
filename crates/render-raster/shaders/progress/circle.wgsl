// `ring-v1` 的 WGSL 实现（元素方案 §7.4）：`circle` / `donut`。
//
// CPU 参照是 `src/source/progress/recipes/ring_v1.rs`：底环（整圆 / 整环，副色）
// + 进度扇区（饼形 / 环形扇区，主色）。`innerRadius` 是**相对外半径**的比例。
//
// ## 角度：自正上方顺时针，在 **v 向上**的坐标里算
//
// 参考实现写的是 `atan2(−centred.x, −centred.y) + π`，配它自己那套 y 向下的
// `texCoord`。BaoCut 的真相是 CPU 参照（`kernel::polar` 的零角在正上方、顺时针
// 为正），因此这里先做 P5a 偏离 4 的那次 v 翻转，再用 `atan2(x, y)` 直接得到
// "自正上方顺时针"的角——两条写法在各自的坐标系里是同一件事，但只有这一条与
// CPU 逐像素对得上。
//
// `featherPx` / `edgeFeatherPx` 是 shader 的抗锯齿**带宽**，CPU 侧不读（矢量边
// 由光栅器抗锯齿）。GPU 侧经 `softEdge` 把过渡带对称地铺在 CPU 那条边上，
// 而不是照抄参考实现的单侧 `smoothstep`——理由见 `common.wgsl` 里 `softEdge`
// 的文档（单侧读法会让圆整体缩小半个带宽）。

/// 配方参数。字段顺序 = Rust 侧 `pack_ring_v1` 的打包顺序。
struct RingRecipe {
    /// 外/内圆边缘的羽化半径，**像素**。
    featherPx : f32,
    /// 颜色分界的羽化半径，**像素**。
    edgeFeatherPx : f32,
    /// 内圈半径（相对外半径）；0 = 实心饼。
    innerRadius : f32,
    /// `direction`：0 = `cw`，1 = `ccw`。
    ccw : f32,
}

@group(3) @binding(0) var<uniform> u_recipe : RingRecipe;

@fragment fn fragmentMain(in : VertexOutput) -> @location(0) vec4f {
    DiscardProgressClip(in.texCoord);

    // 羽化半径与分辨率挂钩；单维度上取两边的平均（参考实现的口径）。
    let res : f32 = (u_dstRes.value.x + u_dstRes.value.y) * 0.5;
    let feather : f32 = u_recipe.featherPx / res;

    let uv : vec2f = vec2f(in.texCoord.x, 1.0 - in.texCoord.y);
    let centred : vec2f = uv * 2.0 - 1.0;
    let len : f32 = length(centred);

    // 自正上方顺时针的一周编号。`atan2(x, y)` ∈ (−π, π]，负半周补一圈。
    var percent : f32 = atan2(centred.x, centred.y) / TWO_PI;
    if (u_recipe.ccw > 0.5) {
        percent = -percent;
    }
    if (percent < 0.0) {
        percent = percent + 1.0;
    }

    let featherFactor : f32 = u_recipe.edgeFeatherPx / res / max(len, 0.01);
    let mixFactor : f32 = 1.0 - softEdge(u_progress.value.x, featherFactor, percent);
    var colour : vec4f = mix(u_secondaryColor, u_mainColor, mixFactor) * u_colourMultiplier;

    var mask : f32 = 1.0 - softEdge(1.0, feather, len);
    if (u_recipe.innerRadius > 0.0) {
        mask = mask * softEdge(u_recipe.innerRadius, feather, len);
    }

    // §8.5：premultiplied alpha。
    let alpha : f32 = colour.a * mask;
    return vec4f(colour.rgb * alpha, alpha);
}
