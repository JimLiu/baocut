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

/// Every decode step reallocates each layer's KV cache. Under the 128 MiB
/// limit those freed buffers stay resident beside the transformer weights.
pub(super) struct GenerationCache {
    #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
    previous: usize,
}
impl GenerationCache {
    pub fn new() -> Result<Self> {
        crate::synthesize::tensor::host::clear_memory_cache()?;
        Ok(Self {
            #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
            previous: crate::synthesize::tensor::memory::set_cache_limit(16 << 20),
        })
    }
}
impl Drop for GenerationCache {
    fn drop(&mut self) {
        #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
        crate::synthesize::tensor::memory::set_cache_limit(self.previous);
    }
}

/// Opt-in diagnostics for tuning the allocation budget; never sent to the UI.
pub(super) fn trace(stage: &str) {
    #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
    if crate::backend::speech_timing_enabled() {
        let (active, cache, peak) = crate::backend::mlx::runtime::memory_snapshot();
        let mut usage: libc::rusage_info_v4 = unsafe { std::mem::zeroed() };
        // SAFETY: `usage` is a writable rusage_info_v4 matching RUSAGE_INFO_V4.
        unsafe {
            libc::proc_pid_rusage(
                libc::getpid(),
                libc::RUSAGE_INFO_V4,
                (&mut usage as *mut libc::rusage_info_v4).cast(),
            )
        };
        eprintln!(
            "[fish-s2-pro] stage={stage} active={active} cache={cache} peak={peak} footprint={} footprint_peak={}",
            usage.ri_phys_footprint, usage.ri_lifetime_max_phys_footprint
        );
    }
    #[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
    let _ = stage;
}
