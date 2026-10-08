//! `check` 报告里不依赖工程状态的纯函数。
//!
//! 移植自 BaoCut v2 `bcut-engine` 的 `flows/check.rs`。那里的 `check_verdict` 读
//! `transcript.json` / `timeline.json` / `ai/*.json`、落盘 `checks/check-*.json`，
//! lint 码以字符串字面量写在它的判定分支里，没有单独的定义表；它与只给它用的
//! `cps_bad`、`read_polish_fallback_records`、输出信封的 `run_check` 都不在本 crate；依赖时间线
//! schema 的 `place_out_of_canvas` 在 `subtitle-render` 的 `check`。这里只带对报告 JSON
//! 做摘要的 [`align_metrics_summary_lines`]。各阶段答案的 lint（`lint_agent_answer_*`、
//! [`crate::language_quality`]、载体的 `Problem` / `Warning` 码）本来就在本 crate 里。

use serde_json::Value;

pub fn align_metrics_summary_lines(report: &Value) -> Vec<String> {
    let Some(table) = report["alignMetrics"].as_object() else {
        return Vec::new();
    };
    let pct =
        |value: &Value| -> String { format!("{:.0}%", value.as_f64().unwrap_or(0.0) * 100.0) };
    table
        .iter()
        .filter(|(_, metrics)| metrics["aligned"].as_u64().unwrap_or(0) > 0)
        .map(|(lang, metrics)| {
            format!(
                "align {lang}: {}/{} 句已对齐 · 覆盖 源 {} / 译 {} · 安全边界 {} · 整句对应 {} · 改写 {} · 弱块 {} · 局部乱序 {} · 意思未核对",
                metrics["aligned"],
                metrics["sentences"],
                pct(&metrics["coverageSrc"]),
                pct(&metrics["coverageTgt"]),
                pct(&metrics["safeBoundaryRatio"]),
                pct(&metrics["sentenceDegradeRate"]),
                pct(&metrics["rewriteRate"]),
                pct(&metrics["weakBlockRate"]),
                pct(&metrics["crossingRate"]),
            )
        })
        .collect()
}
