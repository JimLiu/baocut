//! 程序化源 `proc`（规范 §6.12）的取样与几何只走 `libm`：与
//! `confetti_libm_only.rs` 同一道理与同一台扫描器——闭式求值的全部意义在于
//! 任意机器、任意目标（native / wasm32）同一 `(t, seed)` 同一批字节。
//! 这里整目录扫描 `src/source/proc/*.rs`，一处 std 超越函数都不许有
//! （`sqrt` / `floor` / `round` 在 IEEE 754 下逐位确定，不在名单里）。

use std::fs;
use std::path::Path;

const TRANSCENDENTAL: &[&str] = &[
    "sin", "cos", "tan", "sin_cos", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh",
    "asinh", "acosh", "atanh", "exp", "exp2", "exp_m1", "ln", "ln_1p", "log", "log2", "log10",
    "powf", "powi", "hypot", "cbrt", "gamma", "ln_gamma",
];

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

#[test]
fn proc_sources_call_transcendental_functions_through_libm_only() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/source/proc");
    let mut files: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .collect();
    files.sort();
    assert!(files.len() >= 5, "扫描目标还对吗？{files:?}");
    let mut libm_calls = 0;
    let mut hits = Vec::new();
    for path in &files {
        let text = fs::read_to_string(path).unwrap();
        for (index, line) in text.lines().enumerate() {
            if line.trim_start().starts_with("//") {
                continue;
            }
            libm_calls += line.matches("libm::").count();
            for name in std_calls(line) {
                hits.push((path.file_name().unwrap().to_owned(), index + 1, name));
            }
        }
    }
    assert!(libm_calls > 0);
    assert!(
        hits.is_empty(),
        "proc 源调了 std 的数学函数（文件, 行号, 函数名）{hits:?}；改调 libm（`x.sin()` → `libm::sin(x)`）"
    );
}
