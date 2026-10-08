//! Lottie 属性求值：静态值、关键帧、bezier 缓动、hold、位置空间曲线。
//!
//! 与 `bcut-motion` 的 `sample(t)` 同一语义——**绝对时间进、值出**，没有增量
//! 时钟、没有"上一次求到哪"的状态。时间单位是**合成帧**（`f64`），不是秒：
//! bodymovin 的关键帧时刻 `t` 本来就是帧号，先转秒再转回来只会引入取整。
//!
//! 确定性：全部运算是 f64 四则 + 固定迭代次数的 Newton/二分，没有 `Date`、
//! 没有随机、没有平台相关的超越函数（`sin`/`cos` 只出现在星形与椭圆的
//! 常量几何里，输入是解析出来的常量或已求值的属性，跨平台同值）。

use anyhow::{Result, bail};
use serde_json::Value;

/// 一条缓动曲线的一端（bodymovin 的 `i` / `o`）。按维度存：AE 允许每个分量
/// 各有自己的缓动，长度 1 时全维共用。
#[derive(Debug, Clone, Default)]
pub struct Ease {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
}

impl Ease {
    fn at(&self, dim: usize, fallback: f64) -> (f64, f64) {
        let pick = |v: &Vec<f64>| -> f64 {
            if v.is_empty() {
                fallback
            } else if v.len() == 1 {
                v[0]
            } else {
                *v.get(dim).unwrap_or(&v[v.len() - 1])
            }
        };
        (pick(&self.x), pick(&self.y))
    }
}

#[derive(Debug, Clone)]
pub struct Keyframe {
    /// 关键帧时刻（合成帧号）
    pub t: f64,
    pub start: Vec<f64>,
    /// bodymovin 5.x 之前把段末值写在本帧的 `e` 里；之后用下一帧的 `s`。
    pub end: Option<Vec<f64>>,
    pub hold: bool,
    pub out: Ease,
    pub inn: Ease,
    /// 位置属性的空间切线（相对起点 / 终点）
    pub to: Option<Vec<f64>>,
    pub ti: Option<Vec<f64>>,
}

#[derive(Debug, Clone)]
pub enum Animated {
    Static(Vec<f64>),
    Keyframed(Vec<Keyframe>),
}

impl Animated {
    pub fn constant(values: Vec<f64>) -> Animated {
        Animated::Static(values)
    }

    /// 该属性在整段时间里恒定吗——静止帧判定用它。
    pub fn is_static(&self) -> bool {
        match self {
            Animated::Static(_) => true,
            Animated::Keyframed(frames) => frames.len() <= 1,
        }
    }

    pub fn value(&self, frame: f64) -> Vec<f64> {
        match self {
            Animated::Static(v) => v.clone(),
            Animated::Keyframed(frames) => sample_keyframes(frames, frame),
        }
    }

    pub fn scalar(&self, frame: f64) -> f64 {
        self.value(frame).first().copied().unwrap_or(0.0)
    }

    pub fn point(&self, frame: f64) -> [f64; 2] {
        let v = self.value(frame);
        [
            v.first().copied().unwrap_or(0.0),
            v.get(1).copied().unwrap_or(0.0),
        ]
    }
}

/// 关键帧采样。段内按 `o`/`i` 的三次 bezier 缓动；`h == 1` 保持段首值；
/// 有空间切线时位置走空间 bezier。两端之外一律 clamp 到端点值。
fn sample_keyframes(frames: &[Keyframe], frame: f64) -> Vec<f64> {
    if frames.is_empty() {
        return Vec::new();
    }
    if frame <= frames[0].t {
        return frames[0].start.clone();
    }
    let last = &frames[frames.len() - 1];
    if frame >= last.t {
        return tail_value(frames);
    }
    // frames[i].t <= frame < frames[i+1].t
    let idx = frames
        .partition_point(|k| k.t <= frame)
        .saturating_sub(1)
        .min(frames.len() - 2);
    let a = &frames[idx];
    let b = &frames[idx + 1];
    let end = a.end.clone().unwrap_or_else(|| b.start.clone());
    if a.hold {
        return a.start.clone();
    }
    let span = b.t - a.t;
    let raw = if span > 0.0 {
        (frame - a.t) / span
    } else {
        0.0
    };
    let raw = raw.clamp(0.0, 1.0);

    // 空间曲线：`to` / `ti` 是相对起点 / 终点的控制点偏移（只用第一维的缓动）
    if let (Some(to), Some(ti)) = (&a.to, &a.ti)
        && a.start.len() >= 2
        && end.len() >= 2
        && (to.iter().any(|v| *v != 0.0) || ti.iter().any(|v| *v != 0.0))
    {
        let (ox, oy) = a.out.at(0, 0.0);
        let (ix, iy) = a.inn.at(0, 1.0);
        let eased = bezier_ease(ox, oy, ix, iy, raw);
        let dims = a.start.len().min(end.len()).min(3);
        let mut out = Vec::with_capacity(dims);
        for d in 0..dims {
            let p0 = a.start[d];
            let p3 = end[d];
            let p1 = p0 + to.get(d).copied().unwrap_or(0.0);
            let p2 = p3 + ti.get(d).copied().unwrap_or(0.0);
            out.push(cubic(p0, p1, p2, p3, eased));
        }
        return out;
    }

    let dims = a.start.len().max(end.len());
    let mut out = Vec::with_capacity(dims);
    for d in 0..dims {
        let p0 = a.start.get(d).copied().unwrap_or(0.0);
        let p1 = end.get(d).copied().unwrap_or(p0);
        let (ox, oy) = a.out.at(d, 0.0);
        let (ix, iy) = a.inn.at(d, 1.0);
        let eased = bezier_ease(ox, oy, ix, iy, raw);
        out.push(p0 + (p1 - p0) * eased);
    }
    out
}

/// 末端取值。
///
/// 新格式的末关键帧自带 `s`；**老格式（`{s, e, t}` 成对）的末项是纯终止符**
/// ——只有一个 `t`，那一段的终值写在**前一帧**的 `e` 里。踩过一次：末项按
/// 「`s` 缺席就取自己的 `e`」处理，而它连 `e` 都没有，于是整条属性在末端
/// 归零（语料里 7 个文件、46 条属性中招）。
fn tail_value(frames: &[Keyframe]) -> Vec<f64> {
    let Some(last) = frames.last() else {
        return Vec::new();
    };
    // 末项自带 `s`（新格式）⇒ 就是它。
    if !last.start.is_empty() {
        return last.start.clone();
    }
    if let Some(end) = &last.end {
        return end.clone();
    }
    // 末项是纯终止符 ⇒ 往回找最后一个带值的关键帧，取它的**段末值** `e`。
    // 这里的优先级和上面反过来是有意的：终止符前那一帧的 `s` 是它自己那段的
    // **起**值，取它等于把整段动画倒放回起点。
    for frame in frames.iter().rev().skip(1) {
        if let Some(end) = &frame.end {
            return end.clone();
        }
        if !frame.start.is_empty() {
            return frame.start.clone();
        }
    }
    Vec::new()
}

fn cubic(p0: f64, p1: f64, p2: f64, p3: f64, t: f64) -> f64 {
    let u = 1.0 - t;
    u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3
}

/// 三次 bezier 缓动 `(0,0) (x1,y1) (x2,y2) (1,1)`：给 x 求 y。
///
/// 固定 12 次 Newton + 30 次二分兜底——**迭代次数是常量**，因此同一输入在
/// 任何平台上走同样多步、得同样的位。收敛阈值不参与提前退出。
pub fn bezier_ease(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    // 线性缓动的直通：AE 的默认导出就是 (0,0)-(1,1)
    if (x1 - y1).abs() < f64::EPSILON && (x2 - y2).abs() < f64::EPSILON {
        return x;
    }
    let curve_x = |t: f64| cubic(0.0, x1, x2, 1.0, t);
    let curve_y = |t: f64| cubic(0.0, y1, y2, 1.0, t);
    let slope = |t: f64| {
        let u = 1.0 - t;
        3.0 * u * u * x1 + 6.0 * u * t * (x2 - x1) + 3.0 * t * t * (1.0 - x2)
    };
    let mut t = x;
    for _ in 0..12 {
        let d = slope(t);
        if d.abs() < 1e-9 {
            break;
        }
        t -= (curve_x(t) - x) / d;
        t = t.clamp(0.0, 1.0);
    }
    // 二分兜底：Newton 在 S 形极端控制点上会跑偏，这一段无条件跑满
    let (mut lo, mut hi) = (0.0f64, 1.0f64);
    let mut u = t;
    for _ in 0..30 {
        let cx = curve_x(u);
        if cx < x {
            lo = u;
        } else {
            hi = u;
        }
        u = (lo + hi) * 0.5;
    }
    curve_y(u)
}

// ── 解析（serde_json::Value → Animated）─────────────────────────────

/// 取数组或标量为 `Vec<f64>`。
fn numbers(value: &Value) -> Vec<f64> {
    match value {
        Value::Number(n) => vec![n.as_f64().unwrap_or(0.0)],
        Value::Array(items) => items
            .iter()
            .map(|v| match v {
                Value::Number(n) => n.as_f64().unwrap_or(0.0),
                Value::Bool(b) => f64::from(u8::from(*b)),
                _ => 0.0,
            })
            .collect(),
        Value::Bool(b) => vec![f64::from(u8::from(*b))],
        _ => Vec::new(),
    }
}

fn ease(value: Option<&Value>) -> Ease {
    let Some(Value::Object(map)) = value else {
        return Ease::default();
    };
    Ease {
        x: map.get("x").map(numbers).unwrap_or_default(),
        y: map.get("y").map(numbers).unwrap_or_default(),
    }
}

/// `{a, k, x?}` → [`Animated`]。`path` 只用于报错定位。
///
/// 表达式（非空字符串 `x`）在这里就是硬错误：它需要一个 JS 求值器，而那与
/// BCF 的确定性承诺（禁 `Date` / 未播种随机 / 计时器）直接冲突。
pub fn parse_property(path: &str, value: &Value) -> Result<Animated> {
    let Some(map) = value.as_object() else {
        // 有的素材把常量直接写成裸数组 / 裸数字
        return Ok(Animated::Static(numbers(value)));
    };
    if let Some(Value::String(expr)) = map.get("x")
        && !expr.trim().is_empty()
    {
        bail!(
            "lottie-unsupported-feature: {path} 带表达式（\"x\"）；\
             表达式需要运行期 JS 求值器，与 BCF 的确定性承诺冲突（首版不支持）"
        );
    }
    let k = map.get("k").unwrap_or(&Value::Null);
    // **动画性按结构判定，不看 `a` 标志**：`k` 是关键帧字典数组就是关键帧。
    // lottie-web 的 `PropertyFactory` 就是这么判的（`k.length && typeof k[0]
    // === 'object'`），因为 `a` 在真实素材里可能整个缺席、也可能写成 0 却带着
    // 关键帧。踩过一次：某导出器省略 `a`，属性被当成常量，而 `numbers()` 对
    // 一串对象取不出数 → **静默变 0**（语料里 10 个文件中招：图层不透明度归零
    // 整层不画、旋转归零、时间重映射归零使预合成定格）。
    // 这条规则同时覆盖了「`a: 1` 但 `k` 是裸数组」——那是常量，走 Static。
    let keyframed = k
        .as_array()
        .is_some_and(|items| items.first().is_some_and(Value::is_object));
    if !keyframed {
        return Ok(Animated::Static(numbers(k)));
    }
    let items = k.as_array().expect("keyframed 已保证 k 是数组");
    let mut frames = Vec::with_capacity(items.len());
    for item in items {
        let Some(obj) = item.as_object() else {
            continue;
        };
        frames.push(Keyframe {
            t: obj.get("t").and_then(Value::as_f64).unwrap_or(0.0),
            start: obj.get("s").map(numbers).unwrap_or_default(),
            end: obj.get("e").map(numbers).filter(|v| !v.is_empty()),
            hold: obj.get("h").and_then(Value::as_i64).unwrap_or(0) == 1,
            out: ease(obj.get("o")),
            inn: ease(obj.get("i")),
            to: obj.get("to").map(numbers).filter(|v| !v.is_empty()),
            ti: obj.get("ti").map(numbers).filter(|v| !v.is_empty()),
        });
    }
    if frames.is_empty() {
        return Ok(Animated::Static(Vec::new()));
    }
    // AE 导出保证 t 单调不减；防御性排序保证二分查找的前提成立
    if frames.windows(2).any(|w| w[0].t > w[1].t) {
        frames.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
    }
    Ok(Animated::Keyframed(frames))
}

/// 可选属性：缺席时给缺省常量。
pub fn parse_property_or(path: &str, value: Option<&Value>, default: &[f64]) -> Result<Animated> {
    match value {
        Some(v) if !v.is_null() => parse_property(path, v),
        _ => Ok(Animated::Static(default.to_vec())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_static_property_ignores_time() {
        let p = parse_property("t", &json!({"a": 0, "k": [1.0, 2.0]})).unwrap();
        assert_eq!(p.value(0.0), vec![1.0, 2.0]);
        assert_eq!(p.value(999.0), vec![1.0, 2.0]);
        assert!(p.is_static());
    }

    #[test]
    fn linear_keyframes_interpolate_and_clamp_at_both_ends() {
        let p = parse_property(
            "t",
            &json!({"a": 1, "k": [
                {"t": 0, "s": [0.0], "o": {"x": [0.0], "y": [0.0]}, "i": {"x": [1.0], "y": [1.0]}},
                {"t": 10, "s": [100.0]}
            ]}),
        )
        .unwrap();
        assert_eq!(p.scalar(-5.0), 0.0);
        assert!((p.scalar(5.0) - 50.0).abs() < 1e-9);
        assert_eq!(p.scalar(10.0), 100.0);
        assert_eq!(p.scalar(50.0), 100.0);
    }

    #[test]
    fn a_hold_keyframe_does_not_interpolate() {
        let p = parse_property(
            "t",
            &json!({"a": 1, "k": [
                {"t": 0, "s": [0.0], "h": 1},
                {"t": 10, "s": [100.0]}
            ]}),
        )
        .unwrap();
        assert_eq!(p.scalar(9.999), 0.0);
        assert_eq!(p.scalar(10.0), 100.0);
    }

    #[test]
    fn spatial_tangents_bend_the_position_path() {
        let p = parse_property(
            "p",
            &json!({"a": 1, "k": [
                {"t": 0, "s": [0.0, 0.0], "to": [0.0, 50.0], "ti": [0.0, 50.0],
                 "o": {"x": [0.0], "y": [0.0]}, "i": {"x": [1.0], "y": [1.0]}},
                {"t": 10, "s": [100.0, 0.0]}
            ]}),
        )
        .unwrap();
        let mid = p.point(5.0);
        assert!((mid[0] - 50.0).abs() < 1e-9, "x 仍然线性：{mid:?}");
        assert!(mid[1] > 30.0, "y 应当被空间切线拱起来：{mid:?}");
    }

    #[test]
    fn the_ease_curve_is_monotone_and_pinned_at_both_ends() {
        assert!((bezier_ease(0.6, 0.0, 0.4, 1.0, 0.0)).abs() < 1e-9);
        assert!((bezier_ease(0.6, 0.0, 0.4, 1.0, 1.0) - 1.0).abs() < 1e-9);
        let mut prev = -1.0;
        for i in 0..=100 {
            let y = bezier_ease(0.6, 0.0, 0.4, 1.0, f64::from(i) / 100.0);
            assert!(y >= prev - 1e-12, "缓动必须单调：{i} → {y}");
            prev = y;
        }
        // 缓入缓出：中点仍是 0.5，两侧被压/拉
        assert!((bezier_ease(0.6, 0.0, 0.4, 1.0, 0.5) - 0.5).abs() < 1e-6);
        assert!(bezier_ease(0.6, 0.0, 0.4, 1.0, 0.25) < 0.25);
    }

    #[test]
    fn keyframes_are_detected_by_structure_not_by_the_a_flag() {
        // 真实素材里 `a` 可能整个缺席（语料 10 个文件），也可能写成 0 却带着
        // 关键帧。判据只看 `k` 的形状——信 `a` 的话属性会静默变 0。
        for property in [
            json!({"k": [
                {"t": 0, "s": [0.0], "o": {"x": [0.0], "y": [0.0]}, "i": {"x": [1.0], "y": [1.0]}},
                {"t": 10, "s": [100.0]}
            ]}),
            json!({"a": 0, "k": [
                {"t": 0, "s": [0.0], "o": {"x": [0.0], "y": [0.0]}, "i": {"x": [1.0], "y": [1.0]}},
                {"t": 10, "s": [100.0]}
            ]}),
        ] {
            let p = parse_property("t", &property).unwrap();
            assert!(!p.is_static(), "缺 / 假的 `a` 标志不得把关键帧降成常量");
            assert!(
                (p.scalar(5.0) - 50.0).abs() < 1e-9,
                "实际 {}",
                p.scalar(5.0)
            );
            assert_eq!(p.scalar(10.0), 100.0);
        }
        // 反向：`a: 1` 但 `k` 是裸数组，那是常量
        let p = parse_property("t", &json!({"a": 1, "k": [12.0, 34.0]})).unwrap();
        assert!(p.is_static());
        assert_eq!(p.value(7.0), vec![12.0, 34.0]);
    }

    #[test]
    fn legacy_start_end_keyframes_hold_their_final_value() {
        // 老格式：值成对写在 `s`/`e` 里，**末项是纯终止符**（只有 `t`）。
        // 末端取值必须回到前一帧的 `e`，而不是归零。
        let p = parse_property(
            "tm",
            &json!({"a": 1, "k": [
                {"t": -25, "s": [0.0], "e": [2.135],
                 "o": {"x": [0.167], "y": [0.167]}, "i": {"x": [0.833], "y": [0.833]}},
                {"t": 39}
            ]}),
        )
        .unwrap();
        assert_eq!(p.scalar(-30.0), 0.0, "起点之前取首值");
        assert!(p.scalar(0.0) > 0.0 && p.scalar(0.0) < 2.135, "段内插值");
        assert!(
            (p.scalar(39.0) - 2.135).abs() < 1e-9,
            "实际 {}",
            p.scalar(39.0)
        );
        assert!((p.scalar(999.0) - 2.135).abs() < 1e-9, "末端之后冻结在终值");
    }

    #[test]
    fn a_trailing_terminator_never_wins_over_a_real_final_value() {
        // 新格式的末项自带 `s`，不能被"往回找"的兜底逻辑改写
        let p = parse_property(
            "t",
            &json!({"a": 1, "k": [
                {"t": 0, "s": [1.0], "e": [9.0]},
                {"t": 10, "s": [5.0]}
            ]}),
        )
        .unwrap();
        assert_eq!(p.scalar(50.0), 5.0);
    }

    #[test]
    fn expressions_are_refused_by_name() {
        let error = parse_property("layer.ks.p", &json!({"a": 0, "k": [0], "x": "value*2"}))
            .unwrap_err()
            .to_string();
        assert!(error.contains("lottie-unsupported-feature"), "{error}");
        // 空字符串的 `x` 是导出器噪声，不算表达式
        assert!(parse_property("p", &json!({"a": 0, "k": [0], "x": ""})).is_ok());
    }

    #[test]
    fn sampling_is_order_independent() {
        let p = parse_property(
            "t",
            &json!({"a": 1, "k": [
                {"t": 0, "s": [0.0], "o": {"x": [0.3], "y": [0.0]}, "i": {"x": [0.7], "y": [1.0]}},
                {"t": 12, "s": [40.0], "o": {"x": [0.3], "y": [0.0]}, "i": {"x": [0.7], "y": [1.0]}},
                {"t": 30, "s": [-10.0]}
            ]}),
        )
        .unwrap();
        let times: Vec<f64> = (0..=30).map(f64::from).collect();
        let forward: Vec<f64> = times.iter().map(|t| p.scalar(*t)).collect();
        let backward: Vec<f64> = times.iter().rev().map(|t| p.scalar(*t)).collect();
        assert_eq!(
            forward,
            backward.into_iter().rev().collect::<Vec<_>>(),
            "乱序采样必须逐位等于顺序采样"
        );
    }
}
