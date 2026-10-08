//! `BAOCUT_GPU` 开关（从 v2 的 `BCUT_GPU` 移植）：一个环境变量约束全部非 Apple 的 GPU 推理线（candle CUDA，以及
//! Whisper 的 ggml CUDA / Vulkan 线）。
//!
//! 驱动异常时用户需要一个不改构建就能强制 CPU 的逃生口；各条 GPU 线共用一个名字，文档只需解释一次。

/// 强制 CPU 的环境变量名。
pub const GPU_ENV: &str = "BAOCUT_GPU";

/// `BAOCUT_GPU` 是否显式关闭了 GPU 推理（`off` / `0` / `false` / `cpu` / `no`，不分大小写）。
pub fn gpu_disabled_by_env() -> bool {
    gpu_disabled_by_value(std::env::var(GPU_ENV).ok().as_deref())
}

pub fn gpu_disabled_by_value(value: Option<&str>) -> bool {
    matches!(
        value.map(|v| v.trim().to_ascii_lowercase()).as_deref(),
        Some("off" | "0" | "false" | "cpu" | "no")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpu_env_values() {
        for value in ["off", "0", "false", "cpu", "no", " OFF "] {
            assert!(gpu_disabled_by_value(Some(value)), "{value}");
        }
        for value in ["on", "1", "auto", ""] {
            assert!(!gpu_disabled_by_value(Some(value)), "{value}");
        }
        assert!(!gpu_disabled_by_value(None));
    }
}
