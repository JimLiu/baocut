//! 父进程看护（协议规范 §1）：启动时立刻检查一次，之后每 2 秒检查一次父进程仍然存在、且就是启动时
//! 传入的 `--parent-pid`；不是就退出。
//!
//! Unix 上比较 `getppid()`：父进程一死，本进程就被 init/launchd 收养，`getppid()` 随之改变，
//! PID 被复用也不会骗过它。
//!
//! Windows 没有收养：启动时按 PID 打开父进程并一直拿着句柄（句柄钉住的是那一个进程对象，之后 PID 被复用也认得出），
//! 打开时再比一次创建时间，比本进程晚创建的不可能是父进程（父进程在本进程启动前就死了、PID 已被复用）。之后看句柄
//! 有没有变成已结束。打不开（进程不在、PID 不对）就当父进程不在了。
//!
//! 其他平台没有实现，看护不生效（stdin EOF 仍会退出）。

use std::time::Duration;

/// 检查间隔。
pub const CHECK_INTERVAL: Duration = Duration::from_secs(2);

/// 父进程仍是启动时那一个。
#[cfg(unix)]
pub fn parent_alive(parent_pid: u32) -> bool {
    // SAFETY: getppid 没有参数，总是成功。
    let actual = unsafe { libc::getppid() };
    i64::from(actual) == i64::from(parent_pid)
}

/// 父进程仍是启动时那一个：打得开、不比本进程晚创建、还没有结束。
#[cfg(windows)]
pub fn parent_alive(parent_pid: u32) -> bool {
    windows_parent::Parent::open(parent_pid).is_some_and(|parent| parent.running() != Some(false))
}

#[cfg(not(any(unix, windows)))]
pub fn parent_alive(_parent_pid: u32) -> bool {
    true
}

/// 启动看护线程。父进程不在时调用 `on_orphaned`（它负责让进程退出）。
#[cfg(not(windows))]
pub fn spawn(parent_pid: u32, on_orphaned: impl FnOnce() + Send + 'static) -> std::io::Result<()> {
    std::thread::Builder::new().name("parent-watchdog".into()).spawn(move || {
        loop {
            if !parent_alive(parent_pid) {
                on_orphaned();
                return;
            }
            std::thread::sleep(CHECK_INTERVAL);
        }
    })?;
    Ok(())
}

/// 启动看护线程。父进程不在时调用 `on_orphaned`（它负责让进程退出）。句柄从启动时一直拿到线程结束。
#[cfg(windows)]
pub fn spawn(parent_pid: u32, on_orphaned: impl FnOnce() + Send + 'static) -> std::io::Result<()> {
    std::thread::Builder::new().name("parent-watchdog".into()).spawn(move || {
        if let Some(parent) = windows_parent::Parent::open(parent_pid) {
            // 等待失败（None）算不知道，接着看；只有确认结束才退出。
            while parent.wait_for_exit(CHECK_INTERVAL) != Some(true) {}
        }
        on_orphaned();
    })?;
    Ok(())
}

#[cfg(windows)]
mod windows_parent {
    use std::ffi::c_void;
    use std::time::Duration;

    type Handle = *mut c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    const SYNCHRONIZE: u32 = 0x0010_0000;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_TIMEOUT: u32 = 0x102;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit_handle: i32, pid: u32) -> Handle;
        fn GetCurrentProcess() -> Handle;
        fn GetProcessTimes(
            process: Handle,
            creation: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> i32;
        fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    /// 进程的创建时间（自 1601 年起的 100 纳秒数）；读不到时 None。
    fn creation_time(process: Handle) -> Option<u64> {
        let mut creation = FileTime::default();
        let mut exit = FileTime::default();
        let mut kernel = FileTime::default();
        let mut user = FileTime::default();
        // SAFETY: `process` 是有效的进程句柄（打开的或当前进程的伪句柄），四个输出指针指向本栈帧上的 FILETIME。
        let ok = unsafe { GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) };
        (ok != 0).then(|| (u64::from(creation.high) << 32) | u64::from(creation.low))
    }

    /// 打开的父进程句柄。
    pub struct Parent(Handle);

    impl Parent {
        /// 按 PID 打开父进程。进程不在、不让打开，或者它比本进程晚创建（PID 已被复用）时为 None。
        /// 创建时间读不到时不据此判断（宁可多活，也不误退）。
        pub fn open(pid: u32) -> Option<Self> {
            // SAFETY: 普通的 Win32 调用；失败返回空指针。
            let handle = unsafe { OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
            if handle.is_null() {
                return None;
            }
            let parent = Parent(handle);
            // SAFETY: GetCurrentProcess 返回不需要关闭的伪句柄。
            let ours = creation_time(unsafe { GetCurrentProcess() });
            match (creation_time(parent.0), ours) {
                (Some(theirs), Some(ours)) if theirs > ours => None,
                _ => Some(parent),
            }
        }

        /// 等它结束，最多 `timeout`：结束了 `Some(true)`，还在 `Some(false)`，等待失败 None。
        pub fn wait_for_exit(&self, timeout: Duration) -> Option<bool> {
            let millis = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX - 1);
            // SAFETY: 句柄由本对象持有、在 Drop 之前一直有效，带 SYNCHRONIZE 权限。
            match unsafe { WaitForSingleObject(self.0, millis) } {
                WAIT_OBJECT_0 => Some(true),
                WAIT_TIMEOUT => Some(false),
                _ => None,
            }
        }

        /// 还在运行：`Some(true)`；已经结束：`Some(false)`；查询失败：None。
        pub fn running(&self) -> Option<bool> {
            self.wait_for_exit(Duration::ZERO).map(|exited| !exited)
        }
    }

    impl Drop for Parent {
        fn drop(&mut self) {
            // SAFETY: 句柄由本对象独占，只关一次。
            unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn parent_is_the_process_that_spawned_us() {
        // SAFETY: 同上。
        let parent = unsafe { libc::getppid() } as u32;
        assert!(parent_alive(parent));
        assert!(!parent_alive(parent.wrapping_add(1)));
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn a_process_created_after_us_is_never_the_parent() {
        // 比本进程晚创建的进程（模拟父进程死后 PID 被复用）不算父进程，哪怕它还活着。
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "ping", "-n", "5", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        assert!(!parent_alive(child.id()));
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn an_exited_process_is_not_alive() {
        let mut child = std::process::Command::new("cmd").args(["/C", "exit", "0"]).spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        assert!(!parent_alive(pid));
    }

    #[test]
    fn a_running_older_process_is_alive() {
        // 本进程自己：同一个创建时间、还在运行。
        assert!(parent_alive(std::process::id()));
    }
}
