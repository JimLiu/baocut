//! `program` 资产的路径规则（规范 §6.5.3）：`src`、`imports`、`files`、模块里的相对导入与
//! `asset()` 都以**文档所在目录**为边界，不能用 `..` 走出去。
//!
//! 规范化与越界消息只有这一份：`bcut lint` 查静态看得到的 `src` / `imports` / `files`，
//! 资源加载期（bcut-compile 的模块图、bcut-render 的 `asset()`）查只有求值时才知道的路径，
//! 两处报同一个码 [`PATH_ESCAPE`]、同一句话。纯函数，不碰磁盘；符号链接指到目录外属于
//! 读盘时才看得到的另一回事，由加载期按 `program-invalid` 报。

/// 路径用 `..` 越出文档所在目录。
pub const PATH_ESCAPE: &str = "program-path-escape";

/// [`normalize`] 拒绝的三种路径。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathError {
    /// 用了 `\` 分隔。
    Backslash,
    /// `..` 越出了文档所在目录（报 [`PATH_ESCAPE`]）。
    Escape,
    /// 规范化之后什么都不剩。
    Empty,
}

impl PathError {
    /// 不带码的说明；[`PathError::Escape`] 的完整说法用 [`escape_message`]。
    pub fn describe(self, rel: &str) -> String {
        match self {
            PathError::Backslash => format!("路径 \"{rel}\" 须用 / 分隔"),
            PathError::Escape => format!("路径 \"{rel}\" 越出文档所在目录"),
            PathError::Empty => format!("路径 \"{rel}\" 为空"),
        }
    }
}

/// `dir`（文档目录下的规范目录名，`""` 即文档目录本身）里的 `rel` → 规范名：`/` 分隔、
/// 没有 `.` / `..`、不越出文档目录。
pub fn normalize(dir: &str, rel: &str) -> Result<String, PathError> {
    if rel.contains('\\') {
        return Err(PathError::Backslash);
    }
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(PathError::Escape);
                }
            }
            part => parts.push(part),
        }
    }
    if parts.is_empty() {
        return Err(PathError::Empty);
    }
    Ok(parts.join("/"))
}

/// 只问「是否用 `..` 越出文档目录」：反斜杠、空路径等别的毛病不算（它们各有自己的码）。
pub fn escapes(dir: &str, rel: &str) -> bool {
    normalize(dir, rel) == Err(PathError::Escape)
}

/// [`PATH_ESCAPE`] 的消息（不带码）：边界是哪、违规的是哪条路径、怎么改。
/// `subject` 说明路径出自哪里，如 `src`、`imports.remotion`、`files[0]`、
/// `film/Film.tsx 里的 import`、`asset()`。
pub fn escape_message(subject: &str, rel: &str) -> String {
    format!(
        "{subject} 的路径 \"{rel}\" 用 .. 越出了文档所在目录。program 的 src、imports、files、\
         模块里的相对 import 与 asset() 都以文档（.bcut.tsx / .bcut.json）所在的目录为边界，\
         不能走到它外面；改法：把文档放到项目根，或放到模块旁边，让路径不必用 .. 出去"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_stays_inside_the_document_directory() {
        assert_eq!(normalize("a/b", "./c").unwrap(), "a/b/c");
        assert_eq!(normalize("a/b", "../c.ts").unwrap(), "a/c.ts");
        assert_eq!(normalize("", "./x/./y").unwrap(), "x/y");
        assert_eq!(normalize("a", "../../x"), Err(PathError::Escape));
        assert_eq!(normalize("", ".."), Err(PathError::Escape));
        assert_eq!(normalize("", "../film/X.tsx"), Err(PathError::Escape));
        assert_eq!(normalize("", "a\\b"), Err(PathError::Backslash));
        assert_eq!(normalize("", "./"), Err(PathError::Empty));
        // 先下去再上来、没出边界的不算越界
        assert_eq!(normalize("", "film/../x.tsx").unwrap(), "x.tsx");
        assert!(escapes("", "../x"));
        assert!(!escapes("", "a\\..\\x"), "反斜杠是另一种错");
    }

    #[test]
    fn the_escape_message_names_the_boundary_the_path_and_the_fix() {
        let message = escape_message("src", "../film/X.tsx");
        assert!(message.contains("\"../film/X.tsx\""));
        assert!(message.contains("文档所在目录"));
        assert!(message.contains("项目根"));
        assert!(message.contains("模块旁边"));
    }
}
