//! Configure Fish Metal allocation/cache budgets; tiled operations bound workspaces.
//! MLX may transiently exceed its allocation setting; admission stays mandatory.
use anyhow::Result;
pub(super) struct MemoryGuard {
    #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
    previous: (usize, usize),
}
impl MemoryGuard {
    pub fn new() -> Result<Self> {
        #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
        {
            let physical = crate::backend::mlx::runtime::physical_memory_bytes()?;
            let memory = (5usize << 30).min(physical / 5 * 3);
            let previous = (
                crate::synthesize::tensor::memory::set_memory_limit(memory),
                crate::synthesize::tensor::memory::set_cache_limit(128 << 20),
            );
            Ok(Self { previous })
        }
        #[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
        {
            Ok(Self {})
        }
    }
}
impl Drop for MemoryGuard {
    fn drop(&mut self) {
        let _ = crate::synthesize::tensor::host::clear_memory_cache();
        #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
        {
            crate::synthesize::tensor::memory::set_memory_limit(self.previous.0);
            crate::synthesize::tensor::memory::set_cache_limit(self.previous.1);
        }
    }
}

/// Opt-in diagnostics for tuning the allocation budget; never sent to the UI.
pub(super) fn trace(stage: &str) {
    #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
    if crate::backend::speech_timing_enabled() {
        let (active, cache, peak) = crate::backend::mlx::runtime::memory_snapshot();
        eprintln!("[fish-s2-pro] stage={stage} active={active} cache={cache} peak={peak}");
    }
    #[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
    let _ = stage;
}
