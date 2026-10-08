//! 动画取样的超越函数只走 `libm` crate，不调 std 的同名方法。
//!
//! `f64::sin` / `cos` / `exp` / `powf` 这类函数在 macOS native 调系统 libm，在 wasm32 调
//! compiler-builtins 自带的那份，末位不同。本 crate 的缓动、弹簧与循环波形是 Web 预览
//! （wasm32）与导出、`MotionProgram` 烘焙（native）共用的取样核：差 1 ULP，两边姿态就
//! 不同，违背规范 §14.1、§15.1 对动画采样承诺的字节级确定。`libm` 是纯 Rust 的 musl
//! 移植，每个目标跑同一份算法。
//!
//! 底数为 2 的幂写 `libm::exp2(x)`，**不写** `libm::pow(2.0, x)`：LLVM 早把 std 的
//! `2f64.powf(x)` 改写成了 `exp2`，写 `exp2` 时 wasm32 一位不动；换成 `pow`，缓动的
//! 指数区间 `[-10, 0]` 上有 9.7% 的点要差 1 ULP。
//!
//! 扫描是文本级的：跳过注释行，针是 `x.sin(` 与路径 `f64::sin` 两种写法。四则运算、`sqrt`、
//! `floor` / `round`、`abs`、`to_radians`、`mul_add` 是 IEEE 正确舍入的基本运算；`powi`
//! 只用 2、3 次幂，两个目标都是同序乘法。这些都不在针里。wasm32 真产物由
//! `apps/web/tests/unit/render/wasm-motion-parity.test.ts` 对拍
//! （`core/fixtures/motion/wasm-parity.json`）。

use std::fs;
use std::path::{Path, PathBuf};

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

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("源码目录") {
        let path = entry.expect("目录项").path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn the_scanner_sees_both_call_forms_and_ignores_libm() {
    assert_eq!(std_calls("let y = (t * PI / 2.0).sin();"), ["sin"]);
    assert_eq!(
        std_calls("let (s, c) = a.to_radians().sin_cos();"),
        ["sin_cos"]
    );
    assert_eq!(std_calls("f64::exp2(x) + 2f64.powf(x)"), ["exp2", "powf"]);
    assert_eq!(std_calls("xs.iter().copied().map(f64::cos)"), ["cos"]);
    assert!(std_calls("libm::exp2(-10.0 * t) * libm::sin(x)").is_empty());
    assert!(std_calls("f64::sinh_table + x.sine(1)").is_empty());
}

#[test]
fn motion_sampling_calls_transcendental_functions_through_libm_only() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    rust_files(&src, &mut files);
    files.sort();
    let mut hits = Vec::new();
    let mut libm_calls = 0;
    for file in &files {
        let text = fs::read_to_string(file).expect("读源码");
        for (index, line) in text.lines().enumerate() {
            if line.trim_start().starts_with("//") {
                continue;
            }
            libm_calls += line.matches("libm::").count();
            for name in std_calls(line) {
                hits.push(format!("{}:{}: {name}", file.display(), index + 1));
            }
        }
    }
    assert!(
        files.len() > 20 && libm_calls >= 10,
        "只扫到 {} 个文件、{libm_calls} 处 libm 调用，目录找错了？",
        files.len()
    );
    assert!(
        hits.is_empty(),
        "取样核调了 std 的超越函数，native 与 wasm32 末位会不同。{HINT}：\n{}",
        hits.join("\n")
    );
}
