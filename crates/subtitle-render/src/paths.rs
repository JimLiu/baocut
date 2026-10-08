//! 项目媒体路径与派生缓存路径的**唯一**解析实现。
//!
//! 三段内容分别搬自 `core/crates/bcut-kernel/src/project_source_path.rs`（整文件）、
//! `core/crates/bcut-kernel/src/services/waveform.rs`（`project_media_path` / `media_fingerprint`）
//! 与 `core/crates/bcut-kernel/src/services/spectrum.rs`（`cache_path` / `CACHE_SUFFIX`）。
//!
//! 它们必须跟渲染内核在同一个 crate 里：`bcut spectrum`、
//! `GET /__bcut/spectrum`、导出与 App 预览都按同一条路径去找 BCS1 缓存，
//! 换一条解析就会算出另一个文件名——「命令刚生成过、渲染却说找不到」就是
//! 这么来的。注入它等于要求每个 host 自己复刻弱指纹与命名，那正是 D2 禁止的
//! 第二份实现，而且扫描测试抓不到。CLI 侧的 `waveform` / `spectrum` 从这里转发。
//!
//! The timeline contract stores relative source paths from the project root
//! (`media/...`). BaoCut Mac 1.0.7 briefly wrote image-watermark sources as
//! media-directory-relative paths (`watermark/...`). Prefer the canonical path,
//! but fall back to that legacy spelling so existing projects remain exportable.

use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub fn resolve(project: &Path, raw: &str) -> PathBuf {
    let declared = PathBuf::from(raw);
    if declared.is_absolute() {
        return declared;
    }

    let canonical = project.join(&declared);
    if canonical.is_file() || declared.starts_with("media") {
        return canonical;
    }

    let legacy = project.join("media").join(&declared);
    if legacy.is_file() { legacy } else { canonical }
}

/// 缓存文件名的 BCS1 类型后缀（原 `spectrum::CACHE_SUFFIX`）。
pub const SPECTRUM_CACHE_SUFFIX: &str = ".spectrum.bin";

/// 项目媒体文件：main 来自 project.json；附加源来自 timeline.json sources。
pub fn project_media_path(root: &Path, source_id: &str) -> Result<PathBuf> {
    let raw = if source_id == "main" {
        let manifest_path = root.join("project.json");
        let manifest: Value = serde_json::from_slice(
            &std::fs::read(&manifest_path)
                .with_context(|| format!("项目缺少 {}", manifest_path.display()))?,
        )
        .with_context(|| format!("解析 {}", manifest_path.display()))?;
        manifest
            .pointer("/media/path")
            .and_then(Value::as_str)
            .filter(|path| !path.is_empty())
            .context("project.json 缺少 media.path")?
            .to_owned()
    } else {
        let timeline_path = root.join("timeline.json");
        let timeline: timeline::TimelineDocument = serde_json::from_slice(
            &std::fs::read(&timeline_path)
                .with_context(|| format!("项目缺少 {}", timeline_path.display()))?,
        )
        .with_context(|| format!("解析 {}", timeline_path.display()))?;
        timeline
            .sources
            .get(source_id)
            .and_then(|source| source.path.clone())
            .filter(|path| !path.is_empty())
            .with_context(|| format!("source 不存在或没有媒体路径：{source_id}"))?
    };
    let path = resolve(root, &raw);
    if !path.is_file() {
        bail!("source {source_id} 的媒体文件不存在：{}", path.display());
    }
    Ok(path)
}

/// 路径 + 大小 + mtime 的快速媒体指纹。避免为 GB 级媒体计算内容 hash。
pub fn media_fingerprint(path: &Path) -> Result<String> {
    let metadata =
        std::fs::metadata(path).with_context(|| format!("读取媒体元数据 {}", path.display()))?;
    let modified = metadata
        .modified()
        .with_context(|| format!("读取媒体修改时间 {}", path.display()))?
        .duration_since(std::time::UNIX_EPOCH)
        .with_context(|| format!("媒体修改时间早于 Unix epoch：{}", path.display()))?
        .as_secs();
    let lossy = path.to_string_lossy();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for part in [
        lossy.as_bytes(),
        &metadata.len().to_le_bytes()[..],
        &modified.to_le_bytes()[..],
    ] {
        for &byte in part {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    Ok(format!("{hash:016x}"))
}

/// `<project>/cache/{media_stem}.{fingerprint}.spectrum.bin`。
///
/// 指纹是路径 + 大小 + mtime 的弱指纹（与 BCW1 同一实现），**只用于选文件**；
/// 进渲染指纹的是 BCS1 header 里的内容 hash。
pub fn spectrum_cache_path(project: &Path, media: &Path) -> Result<PathBuf> {
    let fingerprint = media_fingerprint(media)?;
    let stem = media
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("media");
    Ok(project
        .join("cache")
        .join(format!("{stem}.{fingerprint}{SPECTRUM_CACHE_SUFFIX}")))
}

#[cfg(test)]
mod tests {
    use super::resolve;

    #[test]
    fn resolves_canonical_and_legacy_media_relative_sources() {
        let project = tempfile::tempdir().unwrap();
        let media = project.path().join("media/watermark");
        std::fs::create_dir_all(&media).unwrap();
        let logo = media.join("logo.png");
        std::fs::write(&logo, b"png").unwrap();

        assert_eq!(resolve(project.path(), "media/watermark/logo.png"), logo);
        assert_eq!(resolve(project.path(), "watermark/logo.png"), logo);
    }

    #[test]
    fn prefers_the_project_root_when_both_spellings_exist() {
        let project = tempfile::tempdir().unwrap();
        let canonical = project.path().join("overlay.png");
        let fallback = project.path().join("media/overlay.png");
        std::fs::create_dir_all(fallback.parent().unwrap()).unwrap();
        std::fs::write(&canonical, b"root").unwrap();
        std::fs::write(&fallback, b"media").unwrap();

        assert_eq!(resolve(project.path(), "overlay.png"), canonical);
    }

    #[test]
    fn keeps_the_declared_path_when_no_candidate_exists() {
        let project = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve(project.path(), "missing/logo.png"),
            project.path().join("missing/logo.png")
        );
    }
}
