//! 推理线程的调度优先级（架构设计 §6.5「优先级与资源」）：转写不抢界面，机器忙时也不被后台任务挤掉。
//!
//! macOS 上把调用线程的 QoS 设为 default：低于界面线程（user-interactive），与编译、批处理同档。不用 utility：推理线程要逐步
//! 建图、提交 Metal 命令，降到 utility 后机器一忙就被默认档的进程挤掉，GPU 跟着空等（验收与测试 §4「转写的调度优先级与提交方式」）。
//! Windows 上把线程优先级降为 `THREAD_PRIORITY_BELOW_NORMAL`；其他平台先不做（保守实现）。只影响调用它的线程，所以要在
//! 推理线程自己里面调用。

/// 设置调用线程的推理优先级。失败只记日志：优先级是尽力而为，不影响任务能不能跑。
#[cfg(target_os = "macos")]
pub fn set_inference_thread_priority() {
    // SAFETY: 只改调用线程自己的 QoS，参数是合法的类别与相对优先级 0。
    let code = unsafe { libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_DEFAULT, 0) };
    if code != 0 {
        eprintln!("[model-worker] cannot set the inference thread QoS to default (error {code})");
    }
}

#[cfg(windows)]
mod windows_thread {
    use std::ffi::c_void;

    pub const THREAD_PRIORITY_BELOW_NORMAL: i32 = -1;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub fn GetCurrentThread() -> *mut c_void;
        pub fn SetThreadPriority(thread: *mut c_void, priority: i32) -> i32;
        #[cfg(test)]
        pub fn GetThreadPriority(thread: *mut c_void) -> i32;
    }
}

/// 设置调用线程的推理优先级。失败只记日志：优先级是尽力而为，不影响任务能不能跑。
#[cfg(windows)]
pub fn set_inference_thread_priority() {
    use windows_thread::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL};
    // SAFETY: GetCurrentThread 返回调用线程的伪句柄（不需要关闭）；只改调用线程自己的优先级。
    if unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL) } == 0 {
        let error = std::io::Error::last_os_error();
        eprintln!("[model-worker] cannot lower the inference thread priority ({error})");
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn set_inference_thread_priority() {}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// 调用线程当前的 QoS 类别。读成 u32：返回值不一定是枚举里的某一项。
    fn current_qos() -> u32 {
        let mut class: u32 = 0;
        let mut relative: libc::c_int = 0;
        // SAFETY: 查询自己的线程；`qos_class_t` 是 repr(u32)，输出指针指向有效的 u32。
        let code = unsafe {
            libc::pthread_get_qos_class_np(
                libc::pthread_self(),
                (&mut class as *mut u32).cast::<libc::qos_class_t>(),
                &mut relative,
            )
        };
        assert_eq!(code, 0);
        class
    }

    #[test]
    fn sets_only_the_calling_thread_to_default_qos() {
        let before = current_qos();
        let inside = std::thread::spawn(|| {
            set_inference_thread_priority();
            current_qos()
        })
        .join()
        .unwrap();
        assert_eq!(inside, libc::qos_class_t::QOS_CLASS_DEFAULT as u32);
        assert_eq!(current_qos(), before);
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::windows_thread::{GetCurrentThread, GetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL};
    use super::*;

    fn current_priority() -> i32 {
        // SAFETY: 查询调用线程自己的优先级。
        unsafe { GetThreadPriority(GetCurrentThread()) }
    }

    #[test]
    fn lowers_only_the_calling_thread_to_below_normal() {
        let before = current_priority();
        let inside = std::thread::spawn(|| {
            set_inference_thread_priority();
            current_priority()
        })
        .join()
        .unwrap();
        assert_eq!(inside, THREAD_PRIORITY_BELOW_NORMAL);
        assert_eq!(current_priority(), before);
    }
}
