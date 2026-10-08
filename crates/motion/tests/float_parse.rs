//! 内置 preset 与文档里的十进制数必须读成正确舍入的 double。
//!
//! serde_json 默认的快速路径对 17 位有效数字的数可能读偏 1 ULP，所以
//! `core/Cargo.toml` 在 workspace 层给它开了 `float_roundtrip`。feature 按构建图
//! 合并：`cargo test --workspace` 里别的 crate 也会把它带进来，看不出声明丢没丢；
//! `cargo test -p bcut-motion` 的构建图只有本 crate 与 `bcut-core`，声明一丢这里就红。
//! 真正的 wasm32 产物由 `apps/web/tests/unit/render/wasm-float-parse.test.ts` 守。

use std::path::{Path, PathBuf};

use serde_json::Value;

/// 按 preset 注册表的读法（`from_str` → `Value` → `as_f64`）读一个数字字面量。
fn serde_f64(literal: &str) -> f64 {
    serde_json::from_str::<Value>(literal)
        .ok()
        .and_then(|value| value.as_f64())
        .unwrap_or_else(|| panic!("{literal} 不是 JSON 数"))
}

fn assert_correctly_rounded(literal: &str, context: &str) {
    let exact: f64 = literal.parse().expect("std 能读的十进制");
    assert_eq!(
        serde_f64(literal).to_bits(),
        exact.to_bits(),
        "{context}：serde_json 把 {literal} 读成了 {}，正确舍入是 {exact:?}。\
         检查 core/Cargo.toml 的 serde_json 是否还开着 float_roundtrip",
        serde_f64(literal)
    );
}

/// 快速路径实测会读偏的贴帧秒值 `k / fps`（最短往返十进制，JS `JSON.stringify`
/// 与 ryu 写出的就是这串）。元素活跃窗是 `start <= t < end`，t 由 JS 以精确 double
/// 传进 wasm；起止时刻读大 1 ULP，元素就在自己的起始帧缺席、在结束帧多画一帧。
#[test]
fn frame_snapped_seconds_read_as_correctly_rounded_doubles() {
    for (literal, frame) in [
        ("0.23333333333333334", "30fps 第 7 帧"),
        ("0.11666666666666667", "60fps 第 7 帧"),
        ("0.20833333333333334", "24fps 第 5 帧"),
        ("0.10010000000000001", "29.97fps 第 3 帧"),
        ("0.37537499999999996", "23.976fps 第 9 帧"),
    ] {
        assert_correctly_rounded(literal, frame);
    }
}

#[test]
fn every_builtin_preset_float_reads_as_the_correctly_rounded_double() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("presets/builtin");
    let mut files = Vec::new();
    json_files(&root, &mut files);
    let mut floats = 0;
    for file in &files {
        let text = std::fs::read_to_string(file).expect("读 preset");
        for (line, literal) in number_literals(&text) {
            if literal.contains(['.', 'e', 'E']) {
                floats += 1;
                let context = format!("{}:{line}", file.display());
                assert_correctly_rounded(literal, &context);
            }
        }
    }
    // `timeline.loop.elSway3d` 的 `0.9659258262890683` 是快速路径唯一读偏的内置常量。
    assert!(
        files.len() > 300 && floats > 3000,
        "只扫到 {} 个文件、{floats} 个浮点字面量，目录找错了？",
        files.len()
    );
}

fn json_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("preset 目录") {
        let path = entry.expect("目录项").path();
        if path.is_dir() {
            json_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "json") {
            out.push(path);
        }
    }
}

/// 文档序抽出字符串以外的数字字面量，带行号。
fn number_literals(text: &str) -> Vec<(usize, &str)> {
    let bytes = text.as_bytes();
    let (mut out, mut i, mut line) = (Vec::new(), 0, 1);
    while i < bytes.len() {
        match bytes[i] {
            b'\n' => line += 1,
            b'"' => {
                i += 1;
                while i < bytes.len() && bytes[i] != b'"' {
                    i += if bytes[i] == b'\\' { 2 } else { 1 };
                }
            }
            b'-' | b'0'..=b'9' => {
                let start = i;
                while i < bytes.len()
                    && matches!(bytes[i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
                {
                    i += 1;
                }
                out.push((line, &text[start..i]));
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    out
}
