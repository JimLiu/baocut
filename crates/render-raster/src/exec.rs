//! 外部二进制（ffmpeg / ffprobe）的查找与 `Command` 构造，只给 `media` 用。
//!
//! v2 由 `bcut-exec` 统一提供（搜索目录表、登录 shell 的 PATH 捕获、Homebrew / MacPorts
//! 等硬编码目录、`BCUT_REAL_EXE` 硬链接身份）；它在架构设计 §13.6 定为不移植，进程与
//! 工具的发现归 Runtime。这里只留 `media` 实际用到的三样：[`command`]、[`find_executable`]、
//! [`current_exe`]，名字与形状同 v2，查找规则跟 v3：
//!
//! 1. ffmpeg / ffprobe 先看环境变量 `BAOCUT_FFMPEG` / `BAOCUT_FFPROBE`（与 `media-core`、
//!    `model-runtime` 和 Runtime 的外部工具解析同一组变量）。绝对路径原样使用；裸名字在
//!    `PATH` 里找。给了却找不到时不换成别的来源（与 Runtime 一致：显式指定的不悄悄替换）。
//! 2. 否则在本进程的 `PATH` 里找。Runtime 拉起 Worker 时给的就是登录 shell 的 PATH，
//!    这里不再补任何猜测的目录，也不改写子进程的 `PATH`。
//!
//! 用户在设置里指定的路径与受管副本只在 Runtime 的登记表里（ffmpeg 没有受管副本），Rust 侧
//! 看不到；接线时由调用方把解析好的路径交进来（同 `media-core::Tools`）。

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Command;

/// 覆盖 ffmpeg 可执行文件的环境变量（与 `model-runtime::audio::FFMPEG_ENV` 同名）。
pub const FFMPEG_ENV: &str = "BAOCUT_FFMPEG";
/// 覆盖 ffprobe 可执行文件的环境变量。
pub const FFPROBE_ENV: &str = "BAOCUT_FFPROBE";

/// 构造启动 `program` 的 `Command`：按 [`find_executable`] 的规则解析出路径再启动。解析
/// 不到时让 spawn 照常失败（调用方据此回落或报错）：给了覆盖变量就用变量的值去启动，
/// 不退回 `PATH` 里的同名程序；没给才用原名。Windows 上隐藏子进程的控制台窗口。
pub fn command(program: impl AsRef<OsStr>) -> Command {
    let program = program.as_ref();
    let resolved = match program.to_str() {
        Some(name) => {
            let overridden = override_env(name).and_then(std::env::var_os);
            resolve_program(
                name,
                overridden.as_deref(),
                std::env::var_os("PATH").as_deref(),
            )
        }
        None => program.to_os_string(),
    };
    let mut command = Command::new(resolved);
    hide_console(&mut command);
    command
}

/// [`command`] 实际启动的程序：找得到就是找到的路径；找不到时是覆盖变量的值（有的话），
/// 否则是原名。
fn resolve_program(name: &str, overridden: Option<&OsStr>, path: Option<&OsStr>) -> OsString {
    if let Some(found) = find_executable_in(name, overridden, path) {
        return found.into_os_string();
    }
    match overridden.filter(|value| !value.is_empty()) {
        Some(value) => value.to_os_string(),
        None => name.into(),
    }
}

/// 找一个外部二进制，只接受裸命令名（不能含路径分隔符）。规则见模块文档。
pub fn find_executable(name: &str) -> Option<PathBuf> {
    let overridden = override_env(name).and_then(std::env::var_os);
    find_executable_in(
        name,
        overridden.as_deref(),
        std::env::var_os("PATH").as_deref(),
    )
}

/// 可注入环境的查找入口，供单元测试钉住规则。`overridden` 是对应环境变量的值。
fn find_executable_in(
    name: &str,
    overridden: Option<&OsStr>,
    path: Option<&OsStr>,
) -> Option<PathBuf> {
    if name.is_empty() || Path::new(name).components().count() != 1 {
        return None;
    }
    if let Some(value) = overridden.filter(|value| !value.is_empty()) {
        let given = Path::new(value);
        if given.is_absolute() {
            return is_executable_file(given).then(|| given.to_path_buf());
        }
        return given
            .to_str()
            .filter(|bare| Path::new(bare).components().count() == 1)
            .and_then(|bare| search_path(bare, path));
    }
    search_path(name, path)
}

/// ffmpeg / ffprobe 的覆盖变量；其余命令没有（Windows 的 `.exe` 后缀也认）。
fn override_env(name: &str) -> Option<&'static str> {
    let stem = name
        .strip_suffix(".exe")
        .or_else(|| name.strip_suffix(".EXE"))
        .unwrap_or(name);
    match stem {
        "ffmpeg" => Some(FFMPEG_ENV),
        "ffprobe" => Some(FFPROBE_ENV),
        _ => None,
    }
}

/// 按 `PATH` 的顺序找第一个具备平台意义上可执行性的文件。
fn search_path(name: &str, path: Option<&OsStr>) -> Option<PathBuf> {
    let candidates = candidate_names(name);
    std::env::split_paths(path.unwrap_or_default())
        .filter(|directory| !directory.as_os_str().is_empty())
        .find_map(|directory| {
            candidates
                .iter()
                .map(|candidate| directory.join(candidate))
                .find(|path| is_executable_file(path))
        })
}

/// Windows 上按 `.exe` → `.cmd` → `.bat` 尝试，不接受无扩展名文件（同 v2 `bcut-exec`）。
#[cfg(windows)]
fn candidate_names(name: &str) -> Vec<OsString> {
    let lower = name.to_ascii_lowercase();
    if [".exe", ".cmd", ".bat"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
    {
        vec![name.into()]
    } else {
        ["exe", "cmd", "bat"]
            .iter()
            .map(|extension| format!("{name}.{extension}").into())
            .collect()
    }
}

#[cfg(not(windows))]
fn candidate_names(name: &str) -> Vec<OsString> {
    vec![name.into()]
}

/// Windows 下避免为子进程弹出控制台窗口；非 Windows 为 no-op。
fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

/// 本进程可执行文件的真实路径：`std::env::current_exe()` 再 canonicalize（解开符号链接），
/// 解析失败时退回原值。v2 另认 `BCUT_REAL_EXE`（按角色名硬链接启动的 `bcut`），v3 没有这种启动方式。
pub fn current_exe() -> std::io::Result<PathBuf> {
    let raw = std::env::current_exe()?;
    Ok(std::fs::canonicalize(&raw).unwrap_or(raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Scratch {
            let root = std::env::temp_dir().join(format!(
                "render-raster-exec-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&root).unwrap();
            Scratch(root)
        }

        fn tool(&self, directory: &str, name: &str, executable: bool) -> PathBuf {
            let directory = self.0.join(directory);
            std::fs::create_dir_all(&directory).unwrap();
            #[cfg(windows)]
            let name = format!("{name}.exe");
            let file = directory.join(name);
            std::fs::write(&file, "#!/bin/sh\n").unwrap();
            #[cfg(unix)]
            if executable {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            #[cfg(not(unix))]
            let _ = executable;
            file
        }

        fn path(&self, directories: &[&str]) -> OsString {
            std::env::join_paths(directories.iter().map(|directory| self.0.join(directory)))
                .unwrap()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_path_is_searched_in_order_and_names_with_separators_are_rejected() {
        let scratch = Scratch::new("order");
        scratch.tool("a", "ffmpeg", false);
        let second = scratch.tool("b", "ffmpeg", true);
        scratch.tool("c", "ffmpeg", true);
        let path = scratch.path(&["a", "b", "c"]);

        assert_eq!(
            find_executable_in("ffmpeg", None, Some(&path)),
            Some(second)
        );
        assert_eq!(find_executable_in("nested/ffmpeg", None, Some(&path)), None);
        assert_eq!(find_executable_in("", None, Some(&path)), None);
        assert_eq!(find_executable_in("ffmpeg", None, None), None);
    }

    #[test]
    fn an_absolute_override_wins_and_is_not_replaced_when_unusable() {
        let scratch = Scratch::new("absolute");
        let on_path = scratch.tool("bin", "ffmpeg", true);
        let pinned = scratch.tool("pinned", "ffmpeg", true);
        let inert = scratch.tool("inert", "ffmpeg", false);
        let path = scratch.path(&["bin"]);

        assert_eq!(
            find_executable_in("ffmpeg", Some(pinned.as_os_str()), Some(&path)),
            Some(pinned)
        );
        #[cfg(unix)]
        assert_eq!(
            find_executable_in("ffmpeg", Some(inert.as_os_str()), Some(&path)),
            None,
            "显式指定的不可用时不悄悄换成 PATH 里的 {}",
            on_path.display()
        );
        #[cfg(not(unix))]
        let _ = (inert, on_path);
    }

    #[test]
    fn a_bare_override_is_searched_on_the_path() {
        let scratch = Scratch::new("bare");
        scratch.tool("bin", "ffmpeg", true);
        let custom = scratch.tool("bin", "ffmpeg-7", true);
        let path = scratch.path(&["bin"]);

        assert_eq!(
            find_executable_in("ffmpeg", Some(OsStr::new("ffmpeg-7")), Some(&path)),
            Some(custom)
        );
        assert_eq!(
            find_executable_in("ffmpeg", Some(OsStr::new("missing-ffmpeg")), Some(&path)),
            None
        );
    }

    #[test]
    fn a_command_never_falls_back_from_an_unusable_override_to_the_path() {
        let scratch = Scratch::new("command");
        let on_path = scratch.tool("bin", "ffmpeg", true);
        let path = scratch.path(&["bin"]);
        let missing = scratch.0.join("missing/ffmpeg");

        assert_eq!(
            resolve_program("ffmpeg", Some(missing.as_os_str()), Some(&path)),
            missing.into_os_string()
        );
        assert_eq!(
            resolve_program("ffmpeg", Some(OsStr::new("missing-ffmpeg")), Some(&path)),
            OsString::from("missing-ffmpeg")
        );
        assert_eq!(
            resolve_program("ffmpeg", None, Some(&path)),
            on_path.into_os_string()
        );
        assert_eq!(
            resolve_program("ffmpeg", None, None),
            OsString::from("ffmpeg")
        );
    }

    #[test]
    fn only_ffmpeg_and_ffprobe_have_override_variables() {
        assert_eq!(override_env("ffmpeg"), Some(FFMPEG_ENV));
        assert_eq!(override_env("ffprobe"), Some(FFPROBE_ENV));
        assert_eq!(override_env("ffmpeg.exe"), Some(FFMPEG_ENV));
        assert_eq!(override_env("yt-dlp"), None);
    }

    #[test]
    fn an_unresolvable_command_keeps_its_name_and_fails_to_spawn() {
        let command = command("render-raster-exec-no-such-tool");
        assert_eq!(command.get_program(), "render-raster-exec-no-such-tool");
        let mut command = command;
        let error = command.output().unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
    }
}
