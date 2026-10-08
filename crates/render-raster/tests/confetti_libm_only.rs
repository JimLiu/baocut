//! confetti 取样核的超越函数只走 `libm` crate（道理同 `bcut-motion/tests/libm_only.rs`）。
//!
//! `bcut-wasm` 的 `confettiSample` 把 `confetti_particles` 的 f64 粒子表原样序列化给 JS，
//! 这条路径上一个 `sin` 差 1 ULP，Web 缩略图、目录格拿到的坐标就与 native 不同；修复前
//! 十款里九款对不上（`apps/web/tests/unit/render/wasm-motion-parity.test.ts`）。
//!
//! 取样路径是 `kernel.rs`（闭式运动核）与 `shapes.rs`（单位形；星形顶点经 `path_d` 出边界），
//! 两份整文件扫描，一处 std 超越函数都不许有。`draw.rs` 的 `confetti_frame` 把粒子转角
//! 变成 f32 仿射（`sin_cos`），属于合成层：规范 §15.1 对 DrawOp 承诺的是逐像素确定，
//! 与 `bcut-timeline-render` 的 `element_transform` 同一批留在 std。这里把它钉成
//! `draw.rs` 唯一的一处，`confetti_particles` 里新添的调用照样会红。
//!
//! 扫描是文本级的，跳过注释行；`draw.rs` 那一处同时是扫描器认得 `sin_cos` 的正例，
//! `kernel.rs` / `shapes.rs` 里的 `libm::sin(` 是它不误报的反例。

use std::fs;
use std::path::Path;

/// std 上会落到平台数学库的 `f32` / `f64` 方法。
const TRANSCENDENTAL: &[&str] = &[
    "sin", "cos", "tan", "sin_cos", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh",
    "asinh", "acosh", "atanh", "exp", "exp2", "exp_m1", "ln", "ln_1p", "log", "log2", "log10",
    "powf", "hypot", "cbrt", "gamma", "ln_gamma",
];

const HINT: &str = "改调 libm：同名的直接换（`x.sin()` → `libm::sin(x)`），`ln` → `log`，\
                    `ln_1p` → `log1p`，`exp_m1` → `expm1`，`sin_cos` → `sin` + `cos`，\
                    `powf` → `pow`，底数为 2 的写 `exp2`";

/// 一行里调到的 std 超越函数：方法调用 `x.sin(`，或路径 `f64::sin`（调用或当函数值传）。
fn std_calls(line: &str) -> Vec<&'static str> {
    TRANSCENDENTAL
        .iter()
        .copied()
        .filter(|name| {
            line.contains(&format!(".{name}("))
                || ["f64::", "f32::"].iter().any(|ty| {
                    let path = format!("{ty}{name}");
                    line.match_indices(&path).any(|(at, _)| {
                        !line[at + path.len()..]
                            .starts_with(|c: char| c.is_alphanumeric() || c == '_')
                    })
                })
        })
        .collect()
}

/// `src/source/confetti/<file>` 里调 std 超越函数的 `(行号, 函数名)`，以及 `libm::` 出现次数。
fn scan(file: &str) -> (Vec<(usize, &'static str)>, usize) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/source/confetti")
        .join(file);
    let text =
        fs::read_to_string(&path).unwrap_or_else(|err| panic!("读 {}：{err}", path.display()));
    let mut hits = Vec::new();
    let mut libm_calls = 0;
    for (index, line) in text.lines().enumerate() {
        if line.trim_start().starts_with("//") {
            continue;
        }
        libm_calls += line.matches("libm::").count();
        for name in std_calls(line) {
            hits.push((index + 1, name));
        }
    }
    (hits, libm_calls)
}

#[test]
fn confetti_sampling_calls_transcendental_functions_through_libm_only() {
    for file in ["kernel.rs", "shapes.rs"] {
        let (hits, libm_calls) = scan(file);
        assert!(
            libm_calls > 0,
            "confetti/{file} 里一处 libm 调用都没有，扫描目标还对吗？"
        );
        assert!(
            hits.is_empty(),
            "confetti/{file} 调了 std 的超越函数（行号, 函数名）{hits:?}，\
             `confettiSample` 在 native 与 wasm32 末位会不同。{HINT}"
        );
    }
}

#[test]
fn the_only_std_transcendental_in_confetti_draw_is_the_render_layer_rotation() {
    let (hits, _) = scan("draw.rs");
    let names: Vec<_> = hits.iter().map(|&(_, name)| name).collect();
    assert_eq!(
        names,
        ["sin_cos"],
        "confetti/draw.rs 的 std 超越函数（行号, 函数名）{hits:?}：取样路径\
         （`confetti_particles` 与它调的帮手）一律{HINT}；合成层新添的一处要在这里登记"
    );
}
