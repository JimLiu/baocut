//! 系统内存压力探针（移植自 v2 的执行器）。MOSS 推理结束、要装说话人模型或对齐器之前问一次：有压力就先卸掉
//! MOSS 的权重，不让三份权重叠在一起；这一条任务的输出不变，代价是下一条任务要重装（架构设计 §6.6）。

/// 值为 `0` 时一律报 `Normal`（探针在某台机器上不可信时的逃生口）；`warning` / `critical` 强制报对应级别
/// （诊断与端到端验证用，不读系统）。
pub const PRESSURE_ENV: &str = "BAOCUT_MEMORY_PRESSURE";

/// 系统内存压力级别。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryPressure {
    Normal,
    Warning,
    Critical,
}

/// 系统此刻的内存压力（macOS 的 normal / warning / critical）；其他平台恒为 `Normal`。
pub fn system_memory_pressure() -> MemoryPressure {
    match std::env::var(PRESSURE_ENV).as_deref() {
        Ok("0") => MemoryPressure::Normal,
        Ok("warning") => MemoryPressure::Warning,
        Ok("critical") => MemoryPressure::Critical,
        _ => read_system(),
    }
}

#[cfg(target_os = "macos")]
fn read_system() -> MemoryPressure {
    // 1 = normal，2 = warning，4 = critical。
    let mut level: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    // SAFETY: 名字是 NUL 结尾的静态串；`level` / `size` 指向本栈帧上大小匹配的可写内存；不写新值（newp 为空、
    // newlen 为 0）。
    let status = unsafe {
        libc::sysctlbyname(
            c"kern.memorystatus_vm_pressure_level".as_ptr(),
            (&raw mut level).cast(),
            &raw mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    match (status, level) {
        (0, 4..) => MemoryPressure::Critical,
        (0, 2..) => MemoryPressure::Warning,
        _ => MemoryPressure::Normal,
    }
}

/// 其他平台还没有压力信号（v2 也只有 macOS）。Windows 的候选是系统自己的低内存通知（`QueryMemoryResourceNotification`）
/// 或按 `GlobalMemoryStatusEx` 的占用率定阈值，都没有测量过，见架构设计 §14。
#[cfg(not(target_os = "macos"))]
fn read_system() -> MemoryPressure {
    MemoryPressure::Normal
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 不设覆盖时读系统：读得出就是三档之一，不会 panic。
    #[test]
    fn reads_a_level_without_an_override() {
        if std::env::var_os(PRESSURE_ENV).is_none() {
            let level = system_memory_pressure();
            assert!(matches!(
                level,
                MemoryPressure::Normal | MemoryPressure::Warning | MemoryPressure::Critical
            ));
        }
    }
}
