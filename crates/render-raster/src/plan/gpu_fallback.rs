//! GPU 后端的回退报告（元素方案 §8.7 最后一行 / ADR-M05）。
//!
//! 规矩只有一条：**GPU 只是加速器，跑不动就回退 CPU**。跑不动的形态有五种，
//! 全部在这里变成结构化记录，而不是一句 `eprintln!`。
//!
//! ## 为什么它现在不进 `PreflightReport`
//!
//! motion 文档 §6.5 的 `fallbacks[]` **信封**（`bcut render --json` / serve 任务
//! 信封的对外字段）尚不存在，而 [`super::PreflightDiagnostic`] 的 `rule` 字段
//! 按定义是"规范 §16 的码，与 `bcut lint` 同一张表"——往那里塞一个新码就触发
//! `bcut-core/src/lint.rs` 的 `LINT_RULES` 与 format-spec §16 的登记义务，
//! 顺带把 `docs/design/cli/bcut-cli-server-reference.md` 拉进来。P5a 的范围里**不动 CLI
//! 契约面**，因此本模块是 **crate 内部**的报告结构：
//!
//! * 现在：`GpuExecutor` 建不起来 / 样式没 WGSL / 编译失败 ⇒ 记一条，调用方
//!   照常走 CPU 路径，画面不受影响；
//! * P5b 或 motion 阶段 4 合流时：把 [`GpuBackendReport::records`] 映到
//!   `PreflightReport.fallbacks[]` 与对外 `fallbacks[]`，**同任务**登记诊断码
//!   并同步 CLI 参考文档 + `serve/contract.rs` + 契约测试（CLAUDE.md 硬规则）。
//!
//! 本模块不挂 `gpu` feature：没开 feature 的构建同样要能表达"本次渲染没有走
//! GPU，原因是编译时就没带这个后端"。

use std::fmt;

use super::shader_source::ShaderDomain;

/// 一次回退的原因。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuFallbackReason {
    /// 二进制根本没编进 `gpu` feature。
    FeatureDisabled,
    /// 有 feature，但这台机器上拿不到 adapter / device。
    BackendUnavailable,
    /// 样式没有 WGSL 实现（visualizer 10 款全部是 CPU 矢量配方，恒走这条）。
    ShaderMissing,
    /// WGSL 编译或管线创建失败。
    ShaderCompile,
    /// 配方参数打包还没落地（算法臂是 P5b 的）。
    RecipeUnsupported,
    /// 过不了 §8.7 的 conformance 容差。
    Conformance,
    /// 执行期出错（分配、回读、设备丢失…）。
    Execution,
}

impl GpuFallbackReason {
    /// 稳定的原因码。**crate 内部**标识，不是 §16 的 lint 码，也不进任何对外
    /// 信封——见模块文档。
    pub fn code(self) -> &'static str {
        match self {
            GpuFallbackReason::FeatureDisabled => "gpu-feature-disabled",
            GpuFallbackReason::BackendUnavailable => "gpu-backend-unavailable",
            GpuFallbackReason::ShaderMissing => "gpu-shader-missing",
            GpuFallbackReason::ShaderCompile => "gpu-shader-compile-failed",
            GpuFallbackReason::RecipeUnsupported => "gpu-recipe-unsupported",
            GpuFallbackReason::Conformance => "gpu-conformance-failed",
            GpuFallbackReason::Execution => "gpu-execution-failed",
        }
    }
}

impl fmt::Display for GpuFallbackReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// 一条回退记录。`target` 为 `None` = 整个后端不可用（不针对某个样式）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GpuFallbackRecord {
    pub target: Option<(ShaderDomain, String)>,
    pub reason: GpuFallbackReason,
    pub detail: String,
}

impl fmt::Display for GpuFallbackRecord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.target {
            Some((domain, style)) => {
                write!(
                    f,
                    "{}: {domain}.{style} 回退 CPU（{}）",
                    self.reason, self.detail
                )
            }
            None => write!(f, "{}: GPU 后端不可用（{}）", self.reason, self.detail),
        }
    }
}

/// 一次渲染的 GPU 后端报告。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GpuBackendReport {
    /// 实际拿到的后端标识（`"metal"` / `"vulkan"` …）；`None` = 没起来。
    pub backend: Option<String>,
    pub records: Vec<GpuFallbackRecord>,
}

impl GpuBackendReport {
    /// 编译期就没带 GPU 后端时的报告。
    pub fn feature_disabled() -> GpuBackendReport {
        GpuBackendReport {
            backend: None,
            records: vec![GpuFallbackRecord {
                target: None,
                reason: GpuFallbackReason::FeatureDisabled,
                detail: "本二进制未启用 bcut-render 的 `gpu` feature".to_owned(),
            }],
        }
    }

    /// 后端起来了、且**没有任何**样式回退。
    pub fn is_fully_accelerated(&self) -> bool {
        self.backend.is_some() && self.records.is_empty()
    }

    pub fn push(
        &mut self,
        target: Option<(ShaderDomain, String)>,
        reason: GpuFallbackReason,
        detail: impl Into<String>,
    ) {
        self.records.push(GpuFallbackRecord {
            target,
            reason,
            detail: detail.into(),
        });
    }

    /// 人读的一行一条；给 host 打日志用（**不是**对外信封）。
    pub fn lines(&self) -> Vec<String> {
        self.records
            .iter()
            .map(GpuFallbackRecord::to_string)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_disabled_feature_reports_one_backend_level_record() {
        let report = GpuBackendReport::feature_disabled();
        assert!(!report.is_fully_accelerated());
        assert_eq!(report.records.len(), 1);
        assert_eq!(report.records[0].target, None);
        assert_eq!(
            report.records[0].reason.code(),
            "gpu-feature-disabled",
            "原因码是稳定标识"
        );
    }

    #[test]
    fn a_style_level_fallback_names_its_target() {
        let mut report = GpuBackendReport {
            backend: Some("metal".to_owned()),
            records: Vec::new(),
        };
        assert!(report.is_fully_accelerated());
        report.push(
            Some((ShaderDomain::Visualizer, "bars".to_owned())),
            GpuFallbackReason::ShaderMissing,
            "P5b 才落地",
        );
        assert!(!report.is_fully_accelerated());
        let line = &report.lines()[0];
        assert!(line.contains("visualizer.bars"), "{line}");
        assert!(line.contains("回退 CPU"), "{line}");
    }
}
