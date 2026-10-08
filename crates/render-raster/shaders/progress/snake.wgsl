// `snake-v1` 的 WGSL 实现（元素方案 §7.4）。
//
// 一份源码覆盖 4 种：`snake` / `snake_spin`（solid，strict）、
// `snake_rainbow` / `snake_spin_rainbow`（hue 环，visual）。
// CPU 参照是 `src/source/progress/recipes/snake_v1.rs`。
//
// ## 这里是**逐度循环**，CPU 那边是扫掠并集的闭式
//
// P4 把参考实现的 `circleRing()` 收成了闭式（§13 P4 偏离 4）——矢量侧发 360 条
// 子路径既慢又没必要，圆心间距只有圆半径的十四分之一，叠加场在并集内部早就
// 饱和。GPU 侧没有这个理由：fragment 本来就要逐点求值，逐度累加正是参考实现的
// 做法，也是**唯一能逐字用上 `smoothing` 与 `boostSteps` 的写法**（P3/P4 记录
// 留给 P5 的那两个参数）。两条读法的半覆盖等值线相差约一个像素——累加场在并集
// 边界附近迅速饱和，这一点已在 P5b 的实测里核对。
//
// ## 坐标：**v 向上**
//
// 参考实现在 y 向下的 `texCoord` 里放圆心，起始角 270° 落在画面**下**方；
// CPU 参照的 `phi = −(π/2 + a)` 配 `polar` 的"自正上方顺时针"，起点在**上**方。
// 真相是 CPU，因此这里先做 P5a 偏离 4 的那次 v 翻转。

/// 配方参数。字段顺序 = Rust 侧 `pack_snake_v1` 的打包顺序。
struct SnakeRecipe {
    /// 小圆半径（归一化到内切正方形边长）。
    dotRadius : f32,
    /// 小圆的软边带宽。CPU 侧不读，GPU 侧逐字用上。
    smoothing : f32,
    /// 小圆圆心的轨道半径。
    orbitRadius : f32,
    startAngleDeg : f32,
    angleIncrementDeg : f32,
    /// 循环上限（参考实现的 360）。
    maxIterations : f32,
    /// `boostSteps`：圈数少于 `below` 时把 alpha 乘 `gain`。
    boostBelow0 : f32,
    boostGain0 : f32,
    boostBelow1 : f32,
    boostGain1 : f32,
    /// `spin.speedDegPerSec`；`spin: null` ⇒ 0。
    spinSpeed : f32,
    /// `colorMode.kind`：0 = solid、1 = rainbow。
    colorKind : f32,
    /// `colorMode.trackColor == "main"` ⇒ 1。
    trackIsMain : f32,
    /// rainbow 环的旋转速度（°/s）。
    rainbowSpeed : f32,
    _pad0 : f32,
    _pad1 : f32,
}

@group(3) @binding(0) var<uniform> u_recipe : SnakeRecipe;

/// 一枚小圆的软边覆盖率。圆心在 `−(cos a, sin a) · orbit`（参考实现的写法：
/// 它算的是 `length(pos + offset · dist)`）。
///
/// `smoothing = 0.032` 在 324 px 的方盒上有 10 px——那是**造型**不是抗锯齿：
/// 密集叠加下 `min(Σ, 1)` 会把并集的边界整体往外推两三个像素，而 CPU 参照的
/// 扫掠并集边界正是 `dotRadius` 本身（§13 P4 偏离 5）。`softEdgePixel` 因此把
/// 带宽夹到一个像素，边落在同一条线上。
fn snakeDot(pos : vec2f, angle : f32) -> f32 {
    let offset : vec2f = vec2f(cos(angle), sin(angle));
    let distance : f32 = length(pos + offset * u_recipe.orbitRadius);
    let pixel : f32 = 1.0 / max(min(u_dstRes.value.x, u_dstRes.value.y), 1.0);
    return 1.0 - softEdgePixel(u_recipe.dotRadius, u_recipe.smoothing, pixel, distance);
}

/// 参考实现的 `circleRing()`：自 `startAngleDeg + offset` 起每 `angleIncrementDeg`
/// 放一枚小圆，alpha 累加后 `min(·, 1)`。
///
/// 圈数 `angleTotal = round(一整圈的步数 × progress)`，循环体**画完这一圈才
/// break**，因此实际圈数是 `angleTotal + 1`，上限 `maxIterations`——CPU 侧的
/// `dot_count` 是同一条。进度 0 也留一颗圆点。
fn snakeRing(pos : vec2f, progress : f32, offsetDegrees : f32) -> f32 {
    let increment : f32 = u_recipe.angleIncrementDeg;
    let stepsPerTurn : f32 = 360.0 / abs(increment);
    let total : f32 = floor(clamp(progress, 0.0, 1.0) * stepsPerTurn + 0.5);
    let limit : f32 = max(u_recipe.maxIterations, 1.0);

    var accumulated : f32 = 0.0;
    var a : f32 = 0.0;
    for (var index : f32 = 0.0; index < limit; index = index + 1.0) {
        accumulated = accumulated + snakeDot(pos, radians(u_recipe.startAngleDeg + a + offsetDegrees));
        a = a + increment;
        if (index >= total) {
            break;
        }
    }
    // 圆太少时让它更显眼（`boostSteps`）。
    if (total < u_recipe.boostBelow0) {
        accumulated = accumulated * u_recipe.boostGain0;
    } else if (total < u_recipe.boostBelow1) {
        accumulated = accumulated * u_recipe.boostGain1;
    }
    return min(accumulated, 1.0);
}

/// hue 取自角度、饱和度取自半径的旋转彩虹（`snake_rainbow` 两种）。
fn snakeRainbow(uv : vec2f) -> vec3f {
    var transformed : vec2f = uv - 0.5;
    transformed = transformed * rotate2d(radians(u_time.value.x * u_recipe.rainbowSpeed));
    let angle : f32 = atan2(transformed.y, transformed.x);
    let radius : f32 = length(transformed) * 2.0;
    return hsbToRgb(vec3f(angle / TWO_PI + 0.5, radius, 1.0));
}

@fragment fn fragmentMain(in : VertexOutput) -> @location(0) vec4f {
    DiscardProgressClip(in.texCoord);

    let uv : vec2f = vec2f(in.texCoord.x, 1.0 - in.texCoord.y);
    let pos : vec2f = uv - 0.5;

    // 自转：`offset = −mod(t · speed, 360°)`，底环与进度环同一个偏移。
    var spin : f32 = 0.0;
    if (u_recipe.spinSpeed != 0.0) {
        spin = -glslMod(u_time.value.x * u_recipe.spinSpeed, 360.0);
    }

    // 底环（进度 1）在下，进度环在上——参考实现的 `mix(bot, top, top.a)`。
    var trackColour : vec4f = u_secondaryColor;
    if (u_recipe.trackIsMain > 0.5) {
        trackColour = u_mainColor;
    }
    let trackDistance : f32 = snakeRing(pos, 1.0, spin);
    let bottom : vec4f = vec4f(trackDistance * trackColour.rgb, trackDistance) * trackColour.a;

    let topDistance : f32 = snakeRing(pos, u_progress.value.x, spin);
    var top : vec4f;
    if (u_recipe.colorKind > 0.5) {
        // 彩虹环**不乘主色的 alpha**（参考实现如此：主色只管底环）。
        top = vec4f(topDistance * snakeRainbow(uv), topDistance);
    } else {
        top = vec4f(topDistance * u_mainColor.rgb, topDistance) * u_mainColor.a;
    }

    return alphaOver(top, bottom) * u_colourMultiplier;
}
