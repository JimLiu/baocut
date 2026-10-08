//! 视频目录里 `blobs/` 的 GC（架构设计 §5.2、§5.5）：按引用图删掉没有任何记录提到的 blob，清掉过了宽限期的 staging 残留。
//!
//! - 引用集合来自视频库（[`crate::store::Store::referenced_content_hashes`]）：素材的全部版本、代码包版本、
//!   当前实体与撤销记录里出现的摘要。撤销能把删掉的素材放回来，所以历史版本也算引用。
//! - `blobs/<sha256>.<ext>` 与 `blobs/<sha256>/` 按摘要匹配，摘要不在引用集合里才删；名字不是这个样子的条目
//!   不归视频管理，不碰。
//! - `blobs/.staging/` 里最近修改时间早于宽限期的条目删掉；宽限期内的留着（可能正在写入）。
//! - 只有持有写锁的引擎调用（[`crate::Video::gc_blobs`]）：同一时刻没有别的写入者往 `blobs/` 发布新的 bytes，
//!   这个视频自己的导入在同一个 `&mut Video` 上串行完成，不会与 GC 交错。
//! - 冻结中的任务租约、导出与便携包导入在引擎之外：何时调用由 Runtime 决定（还有租约时不调用）。
//!
//! 删除失败（权限、文件被占）记日志、计入回执的 `failed`，不让整次 GC 失败。

use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

/// staging 条目的缺省宽限期：比这新的可能还在写入，留着。
pub const STAGING_GRACE: Duration = Duration::from_secs(60 * 60);

const HASH_PREFIX: &str = "sha256:";
const HASH_HEX_LEN: usize = 64;

/// 一次 GC 删掉的一个条目。`path` 相对视频目录，用 `/` 分隔。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedEntry {
    pub path: String,
    pub bytes: u64,
}

/// 删不掉的条目与原因。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GcFailure {
    pub path: String,
    pub error: String,
}

/// 一次 GC 的回执。
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobGcReport {
    /// 没有引用、已删掉的 blob。
    pub removed: Vec<RemovedEntry>,
    /// 过了宽限期、已删掉的 staging 条目。
    pub staging_removed: Vec<RemovedEntry>,
    /// 以上两类一共释放的字节数。
    pub freed_bytes: u64,
    /// 仍被引用、留着的 blob 数。
    pub kept: u64,
    /// 宽限期内、留着的 staging 条目数。
    pub staging_kept: u64,
    /// 不像 blob 的条目（不归视频管理），没有动。
    pub skipped: Vec<String>,
    pub failed: Vec<GcFailure>,
}

/// 从一段文本（库里存的 JSON 或摘要列）里收集所有 `sha256:<64 位小写十六进制>`，只记十六进制部分。
pub(crate) fn collect_hashes(text: &str, out: &mut HashSet<String>) {
    let mut rest = text;
    while let Some(at) = rest.find(HASH_PREFIX) {
        let tail = &rest[at + HASH_PREFIX.len()..];
        let hex: &str = tail.get(..HASH_HEX_LEN).unwrap_or("");
        if is_hash_hex(hex) && !tail[HASH_HEX_LEN..].starts_with(|c: char| c.is_ascii_hexdigit()) {
            out.insert(hex.to_string());
            rest = &tail[HASH_HEX_LEN..];
        } else {
            rest = tail;
        }
    }
}

fn is_hash_hex(text: &str) -> bool {
    text.len() == HASH_HEX_LEN && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `blobs/` 里一个条目名对应的摘要：文件是 `<hex>.<ext>`，目录是 `<hex>`。不是这个样子的返回 `None`。
fn blob_hash(name: &str, is_dir: bool) -> Option<&str> {
    if is_dir {
        return is_hash_hex(name).then_some(name);
    }
    let (stem, ext) = name.split_once('.')?;
    (is_hash_hex(stem) && !ext.is_empty() && ext.bytes().all(|b| b.is_ascii_alphanumeric())).then_some(stem)
}

/// 条目占用的字节数：目录按里面的文件累加。不跟随符号链接。
fn entry_size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return 0;
    };
    if !meta.is_dir() {
        return meta.len();
    }
    fs::read_dir(path)
        .map(|entries| entries.flatten().map(|e| entry_size(&e.path())).sum())
        .unwrap_or(0)
}

/// 条目里最近的修改时间：目录取它自己与所有后代中最新的（往深层目录写文件不更新顶层目录的时间）。
fn newest_mtime(path: &Path) -> Option<SystemTime> {
    let meta = fs::symlink_metadata(path).ok()?;
    let mut newest = meta.modified().ok();
    if meta.is_dir()
        && let Ok(entries) = fs::read_dir(path)
    {
        for entry in entries.flatten() {
            if let Some(time) = newest_mtime(&entry.path()) {
                newest = Some(newest.map_or(time, |n| n.max(time)));
            }
        }
    }
    newest
}

fn remove_entry(path: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn rel(video_dir: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(video_dir).unwrap_or(path);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// 删一个条目，结果记进回执；失败只记日志与 `failed`。
fn sweep(video_dir: &Path, path: &Path, removed: &mut Vec<RemovedEntry>, report_freed: &mut u64, failed: &mut Vec<GcFailure>) {
    let bytes = entry_size(path);
    let shown = rel(video_dir, path);
    match remove_entry(path) {
        Ok(()) => {
            *report_freed += bytes;
            removed.push(RemovedEntry { path: shown, bytes });
        }
        Err(error) => {
            eprintln!("video-engine: GC 删不掉 {}：{error}", path.display());
            failed.push(GcFailure {
                path: shown,
                error: error.to_string(),
            });
        }
    }
}

/// 按给定的引用集合清理 `video_dir/blobs/`。`referenced` 是摘要的十六进制部分（不带 `sha256:`）。
///
/// 调用方必须持有视频的写锁（见模块说明）；一般经 [`crate::Video::gc_blobs`] 调用。
pub fn gc_blob_dir(video_dir: &Path, referenced: &HashSet<String>, staging_grace: Duration, now: SystemTime) -> BlobGcReport {
    let mut report = BlobGcReport::default();
    let blobs = video_dir.join("blobs");
    let entries = match fs::read_dir(&blobs) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return report,
        Err(error) => {
            eprintln!("video-engine: GC 读不了 {}：{error}", blobs.display());
            report.failed.push(GcFailure {
                path: "blobs".into(),
                error: error.to_string(),
            });
            return report;
        }
    };
    let mut doomed = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            report.skipped.push(rel(video_dir, &entry.path()));
            continue;
        };
        if name == ".staging" {
            continue;
        }
        let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
        match blob_hash(name, is_dir) {
            Some(hash) if referenced.contains(hash) => report.kept += 1,
            Some(_) => doomed.push(entry.path()),
            None => report.skipped.push(rel(video_dir, &entry.path())),
        }
    }
    doomed.sort();
    for path in doomed {
        sweep(video_dir, &path, &mut report.removed, &mut report.freed_bytes, &mut report.failed);
    }

    let staging = blobs.join(".staging");
    if let Ok(entries) = fs::read_dir(&staging) {
        let mut expired = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            // 读不到时间的当作刚写的，时间在将来的当作刚写的：宁可多留一轮。
            match newest_mtime(&path) {
                Some(time) if now.duration_since(time).unwrap_or(Duration::ZERO) >= staging_grace => expired.push(path),
                _ => report.staging_kept += 1,
            }
        }
        expired.sort();
        for path in expired {
            sweep(
                video_dir,
                &path,
                &mut report.staging_removed,
                &mut report.freed_bytes,
                &mut report.failed,
            );
        }
    }
    report.skipped.sort();
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn hashes_are_found_in_json_and_bare_columns() {
        let mut out = HashSet::new();
        collect_hashes(
            &format!(r#"{{"before":{{"contentHash":"sha256:{A}"}},"x":"sha256:abc","y":"sha256:{A}0"}}"#),
            &mut out,
        );
        assert_eq!(out, HashSet::from([A.to_string()]));
        let mut out = HashSet::new();
        collect_hashes(&format!("sha256:{}", A.to_uppercase()), &mut out);
        assert!(out.is_empty(), "大写的不是引擎写的摘要");
    }

    #[test]
    fn blob_names_are_recognised() {
        assert_eq!(blob_hash(&format!("{A}.png"), false), Some(A));
        assert_eq!(blob_hash(A, true), Some(A));
        assert_eq!(blob_hash(A, false), None, "没有扩展名的文件不是 blob");
        assert_eq!(blob_hash(&format!("{A}.png"), true), None);
        assert_eq!(blob_hash("notes.txt", false), None);
        assert_eq!(blob_hash(&format!("{A}.tar.gz"), false), None);
    }
}
