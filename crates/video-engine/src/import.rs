//! 导入素材：探测媒体信息、算摘要，然后按存储方式处理 bytes（视频格式规范 §4.2）。
//! - 受管理（managed）：写入 staging、原子发布到 `blobs/`（架构设计 §5.2）；
//! - 链接（linked）：bytes 留在原处，只记下定位与指纹。
//!
//! 调用方不指定时，文件默认链接，目录（代码包）默认收进来（架构设计 §5.1）。
//!
//! 这些耗时的工作在事务之外完成；事务里只增加引用。崩溃可能留下没有被引用的 blob，
//! 由之后的 GC 清理，不会出现数据库指向未发布 bytes 的情况。

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use editor_semantics::{MediaTime, Rate, Ratio, parse_decimal_seconds};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{EngineResult, ErrorBody, Text, msg};
use crate::model::{AssetKind, AssetStorage, AudioInfo, FileLocator, FrameRateInfo, TreeInfo, VideoInfo};

/// 目录素材的媒体类型。
pub const DIRECTORY_MEDIA_TYPE: &str = "inode/directory";

/// `.lottie` 压缩包的媒体类型（zip）。只有 Lottie 压缩包会记成它。
pub const LOTTIE_ARCHIVE_MEDIA_TYPE: &str = "application/zip";

/// Lottie 素材的大小上限：再大就不是贴纸动画了（与 Runtime 放行链接 Lottie 的上限相同）。
pub const LOTTIE_MAX_BYTES: u64 = 32 << 20;

/// 导入时 bytes 怎么放。调用方不指定时由 [`prepare_import`] 按来源决定（视频格式规范 §4.2）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorageMode {
    /// 复制进视频目录的 `blobs/`。
    Managed,
    /// 留在原处，只记定位。
    Linked,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProbeInfo {
    pub duration: Option<MediaTime>,
    pub timebase: Option<Rate>,
    pub video: Option<VideoInfo>,
    pub audio: Option<AudioInfo>,
}

/// 一份已经就位（发布到 `blobs/`，或确认过原处可读）的 bytes 及其媒体信息，等待事务引用。
#[derive(Clone, Debug, PartialEq)]
pub struct PreparedAsset {
    pub kind: AssetKind,
    pub content_hash: String,
    pub byte_length: u64,
    pub media_type: String,
    pub original_name: String,
    pub probe: ProbeInfo,
    pub storage: AssetStorage,
    pub tree: Option<TreeInfo>,
}

/// 按扩展名认媒体类型。认不出的不导入，免得把任意文件当成视频。
pub fn media_type_of(path: &Path) -> Option<(AssetKind, &'static str)> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "mp4" | "m4v" => (AssetKind::Video, "video/mp4"),
        "mov" => (AssetKind::Video, "video/quicktime"),
        "webm" => (AssetKind::Video, "video/webm"),
        "mkv" => (AssetKind::Video, "video/x-matroska"),
        "mp3" => (AssetKind::Audio, "audio/mpeg"),
        "m4a" | "aac" => (AssetKind::Audio, "audio/mp4"),
        "wav" => (AssetKind::Audio, "audio/wav"),
        "flac" => (AssetKind::Audio, "audio/flac"),
        "ogg" | "oga" | "opus" => (AssetKind::Audio, "audio/ogg"),
        "png" => (AssetKind::Image, "image/png"),
        "jpg" | "jpeg" => (AssetKind::Image, "image/jpeg"),
        "webp" => (AssetKind::Image, "image/webp"),
        "gif" => (AssetKind::Image, "image/gif"),
        "svg" => (AssetKind::Image, "image/svg+xml"),
        "ttf" => (AssetKind::Font, "font/ttf"),
        "otf" => (AssetKind::Font, "font/otf"),
        "woff2" => (AssetKind::Font, "font/woff2"),
        "srt" => (AssetKind::Caption, "application/x-subrip"),
        "vtt" => (AssetKind::Caption, "text/vtt"),
        "ass" => (AssetKind::Caption, "text/x-ass"),
        // 读出来是 Lottie 动画的 JSON 在 [`prepare_import`] 里改记成 `lottie`，别的 JSON 仍是 `other`。
        "json" => (AssetKind::Other, "application/json"),
        "lottie" => (AssetKind::Lottie, LOTTIE_ARCHIVE_MEDIA_TYPE),
        _ => return None,
    })
}

/// blob 的扩展名由媒体类型决定，便于媒体通道按扩展名给出 MIME。
pub fn blob_extension(media_type: &str) -> &'static str {
    match media_type {
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        "video/x-matroska" => "mkv",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "audio/wav" => "wav",
        "audio/flac" => "flac",
        "audio/ogg" => "ogg",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/svg+xml" => "svg",
        "font/ttf" => "ttf",
        "font/otf" => "otf",
        "font/woff2" => "woff2",
        "application/x-subrip" => "srt",
        "text/vtt" => "vtt",
        "text/x-ass" => "ass",
        "application/json" => "json",
        LOTTIE_ARCHIVE_MEDIA_TYPE => "lottie",
        _ => "bin",
    }
}

/// 视频目录里一份 blob 的相对路径：文件是 `blobs/<sha256>.<ext>`，目录是 `blobs/<sha256>/`。
pub fn blob_rel_path(content_hash: &str, media_type: &str) -> PathBuf {
    let hex = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);
    if media_type == DIRECTORY_MEDIA_TYPE {
        return PathBuf::from("blobs").join(hex);
    }
    PathBuf::from("blobs").join(format!("{hex}.{}", blob_extension(media_type)))
}

fn hex(digest: impl AsRef<[u8]>) -> String {
    digest.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

fn rfc3339(time: SystemTime) -> Option<String> {
    let secs = time.duration_since(SystemTime::UNIX_EPOCH).ok()?;
    Some(crate::ids::rfc3339_from_unix(secs.as_secs(), secs.subsec_millis()))
}

/// 路径所在卷的名字（macOS 的 `/Volumes/<名字>/…`）。只作提示用。
fn volume_of(path: &Path) -> Option<String> {
    let mut parts = path.components().skip(1);
    match (parts.next()?.as_os_str().to_str()?, parts.next()) {
        ("Volumes", Some(name)) => name.as_os_str().to_str().map(str::to_string),
        _ => None,
    }
}

/// 项目标记（架构设计 §5.1）。引擎只看它在不在，不解析内容。
pub const PROJECT_MARKER: &str = ".bcut/project.json";

/// 视频所在的项目目录：视频目录的父目录链上带项目标记的最近一层；都没有时是视频目录的父目录
/// （视频格式规范 §4.2）。按 `video_dir` 的写法逐级向上找，不解析符号链接。
pub fn project_dir_of(video_dir: &Path) -> PathBuf {
    let parent = video_dir.parent().unwrap_or(video_dir);
    parent
        .ancestors()
        .find(|dir| dir.join(PROJECT_MARKER).is_file())
        .unwrap_or(parent)
        .to_path_buf()
}

/// 按字面规范化路径：去掉 `.`，`..` 抵掉前一段，不访问文件系统、不解析符号链接。
/// 越过根的 `..` 留在根上（与操作系统的行为一致）。
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => match out.components().next_back() {
                Some(Component::Normal(_)) => {
                    out.pop();
                }
                Some(Component::RootDir | Component::Prefix(_)) => {}
                _ => out.push(".."),
            },
            other => out.push(other),
        }
    }
    out
}

/// 从目录 `from` 到 `to` 的相对路径，用 `/` 分隔（两者都是规范化的绝对路径）。
fn relative_between(from: &Path, to: &Path) -> String {
    let from: Vec<_> = from.components().collect();
    let to: Vec<_> = to.components().collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let parts: Vec<String> = std::iter::repeat_n("..".to_string(), from.len() - common)
        .chain(to[common..].iter().map(|c| c.as_os_str().to_string_lossy().into_owned()))
        .collect();
    if parts.is_empty() { ".".into() } else { parts.join("/") }
}

/// 一个绝对路径（已规范化）若在视频所在的项目目录里，返回相对视频目录的写法。
fn project_relative(video_dir: &Path, target: &Path) -> Option<String> {
    let project = project_dir_of(video_dir);
    target.starts_with(&project).then(|| relative_between(video_dir, target))
}

/// 链接时登记的路径（视频格式规范 §4.2）：调用方给的路径（绝对，或相对视频目录）按字面规范化之后，
/// 在项目目录里就记相对视频目录的路径（可以有 `..`，但不会越出项目目录），整个项目移动或改名后仍然有效；
/// 在项目目录外就记绝对路径。文件本身是符号链接时不解析它：项目里的那个链接跟着项目走。
///
/// 先按调用方的写法比较；比不上时再按两边所在目录的真实路径比较一次（例如 `/var` 与 `/private/var`）。
/// 都不在项目里时记调用方写法的绝对路径。返回登记的路径与按字面求出的绝对路径。
pub fn link_path(video_dir: &Path, given: &Path) -> (String, PathBuf) {
    let video_dir = normalize(video_dir);
    let absolute = normalize(&video_dir.join(given));
    if let Some(relative) = project_relative(&video_dir, &absolute) {
        return (relative, absolute);
    }
    let real_dir = fs::canonicalize(&video_dir).ok();
    let real_target = match (absolute.parent(), absolute.file_name()) {
        (Some(parent), Some(name)) => fs::canonicalize(parent).ok().map(|p| p.join(name)),
        _ => None,
    };
    if let (Some(dir), Some(target)) = (real_dir, real_target)
        && let Some(relative) = project_relative(&dir, &target)
    {
        return (relative, absolute);
    }
    (absolute.to_string_lossy().into_owned(), absolute)
}

/// 登记的路径此刻指向哪里：绝对路径照用；相对路径相对视频目录求值，结果越出项目目录时拒绝，
/// 免得一个别处拿来的视频用 `../../..` 读项目外的文件（视频格式规范 §4.2）。
pub fn locate_linked(video_dir: &Path, asset_id: &str, path: &str) -> EngineResult<PathBuf> {
    let given = Path::new(path);
    if given.is_absolute() {
        return Ok(normalize(given));
    }
    let video_dir = normalize(video_dir);
    let resolved = normalize(&video_dir.join(given));
    if !resolved.starts_with(project_dir_of(&video_dir)) {
        return Err(
            ErrorBody::asset_missing(
                asset_id,
                msg!(
                    "engine.linkOutsideProject",
                    "The relative path of the linked asset goes outside the project directory, so it is not read"
                ),
            ).details(serde_json::json!({
                "path": path, "reason": "outside-project",
            })),
        );
    }
    Ok(resolved)
}

/// 链接素材的定位：登记的路径（见 [`link_path`]），以及按实际文件记下的修改时间与卷名。
pub fn link_locator(video_dir: &Path, given: &Path) -> (FileLocator, PathBuf) {
    let (path, resolved) = link_path(video_dir, given);
    let locator = FileLocator {
        path,
        modified_at: fs::metadata(&resolved).and_then(|m| m.modified()).ok().and_then(rfc3339),
        volume: volume_of(&resolved),
    };
    (locator, resolved)
}

/// 不复制，只算一个文件的摘要与长度。
pub fn hash_file(source: &Path) -> EngineResult<(String, u64)> {
    let mut input = File::open(source).map_err(|e| ErrorBody::asset_missing(
            "",
            msg!(
                "engine.fileUnreadable",
                "Cannot read file {path}: {error}",
                path = source.display().to_string(),
                error = e.to_string()
            ),
        ))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut total = 0u64;
    loop {
        let n = input.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((format!("sha256:{}", hex(hasher.finalize())), total))
}

/// 目录里属于素材的文件，按相对路径排序。跳过隐藏文件与符号链接；`include` 限定只收哪些文件或子目录。
pub fn tree_files(root: &Path, include: Option<&[String]>) -> EngineResult<Vec<(String, PathBuf)>> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<(String, PathBuf)>) -> EngineResult<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let rel = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
            let kind = entry.file_type()?;
            if kind.is_dir() {
                walk(&entry.path(), &rel, out)?;
            } else if kind.is_file() {
                out.push((rel, entry.path()));
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(root, "", &mut files)?;
    if let Some(include) = include {
        files.retain(|(rel, _)| {
            include.iter().any(|inc| {
                let inc = inc.trim_end_matches('/');
                rel == inc || rel.strip_prefix(inc).is_some_and(|rest| rest.starts_with('/'))
            })
        });
    }
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    Ok(files)
}

/// 目录的摘要：每个文件一行 `<sha256> <长度> <相对路径>`，按路径排序后整体再求 sha256（视频格式规范 §4.3）。
pub fn hash_tree(root: &Path, include: Option<&[String]>) -> EngineResult<(String, u64, u32)> {
    let files = tree_files(root, include)?;
    if files.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!("engine.directoryEmpty", "The directory has no files to import")));
    }
    let mut manifest = String::new();
    let mut total = 0u64;
    for (rel, path) in &files {
        let (hash, len) = hash_file(path)?;
        manifest.push_str(&format!("{} {len} {rel}\n", hash.trim_start_matches("sha256:")));
        total += len;
    }
    Ok((
        format!("sha256:{}", hex(Sha256::digest(manifest.as_bytes()))),
        total,
        files.len() as u32,
    ))
}

/// 把目录按内容地址复制进 `blobs/<sha256>/`。已有同样的目录时不重复复制。
pub fn publish_tree(video_dir: &Path, root: &Path, include: Option<&[String]>, content_hash: &str) -> EngineResult<()> {
    let target = video_dir.join(blob_rel_path(content_hash, DIRECTORY_MEDIA_TYPE));
    if target.is_dir() {
        return Ok(());
    }
    let staging = video_dir.join("blobs").join(".staging").join(crate::ids::new_id("tree"));
    let result = (|| -> EngineResult<()> {
        for (rel, path) in tree_files(root, include)? {
            let to = staging.join(&rel);
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&path, &to)?;
        }
        fs::rename(&staging, &target)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// 把一个文件按内容地址发布进 `blobs/`，并核对摘要与素材版本登记的一致（收纳链接素材时用）。
pub fn publish_verified(video_dir: &Path, source: &Path, media_type: &str, expected_hash: &str) -> EngineResult<()> {
    let (hash, _) = publish_blob(video_dir, source, media_type)?;
    if hash != expected_hash {
        let _ = fs::remove_file(video_dir.join(blob_rel_path(&hash, media_type)));
        return Err(
            ErrorBody::asset_missing(
                "",
                msg!("engine.linkedFileChanged", "The file at the original location no longer matches what was linked"),
            ).details(serde_json::json!({
                "path": source, "expected": expected_hash, "actual": hash,
            })),
        );
    }
    Ok(())
}

/// `given` 是调用方给的路径：绝对路径，或（仅链接时）相对视频目录的路径。链接时登记的定位按 [`link_path`]
/// 规范化：项目目录里的记相对视频目录的路径，项目外的记绝对路径。
///
/// 不指定 `mode` 时：文件留在原处（`linked`）；目录是代码包，没有原文件可以指向，收进视频（`managed`）。
/// 收进视频（显式或按默认）要求绝对路径：相对路径只用于链接，视频与素材一起移动时仍然有效。
pub fn prepare_import(
    video_dir: &Path,
    given: &Path,
    ffprobe: &Path,
    mode: Option<StorageMode>,
    include: Option<&[String]>,
) -> EngineResult<PreparedAsset> {
    let relative = !given.is_absolute();
    if relative && mode == Some(StorageMode::Managed) {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.managedPathRelative",
            "An import copied into the video (managed) needs an absolute path; relative paths are only for links"
        )));
    }
    // 按字面规范化后的绝对路径：读文件与判断在不在项目里用同一个写法。
    let resolved = normalize(&video_dir.join(given));
    let source = resolved.as_path();
    let meta = fs::metadata(source).map_err(|e| ErrorBody::asset_missing(
        "",
        msg!("engine.importUnreadable", "Cannot read the file to import: {error}", error = e.to_string()),
    ))?;
    let original_name = source.file_name().and_then(|n| n.to_str()).unwrap_or("素材").to_string();
    let mode = mode.unwrap_or(if meta.is_dir() { StorageMode::Managed } else { StorageMode::Linked });
    if relative && mode == StorageMode::Managed {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.directoryPathRelative",
            "An imported directory is copied into the video by default, so its path must be absolute; to link the directory, pass storage: 'linked'"
        )));
    }
    if meta.is_dir() {
        let (content_hash, byte_length, file_count) = hash_tree(source, include)?;
        let storage = match mode {
            StorageMode::Managed => {
                publish_tree(video_dir, source, include, &content_hash)?;
                AssetStorage::Managed
            }
            StorageMode::Linked => AssetStorage::Linked {
                locator: link_locator(video_dir, given).0,
                frozen: false,
            },
        };
        return Ok(PreparedAsset {
            kind: AssetKind::Bundle,
            content_hash,
            byte_length,
            media_type: DIRECTORY_MEDIA_TYPE.to_string(),
            original_name,
            probe: ProbeInfo {
                duration: None,
                timebase: None,
                video: None,
                audio: None,
            },
            storage,
            tree: Some(TreeInfo {
                file_count,
                include: include.map(<[String]>::to_vec),
            }),
        });
    }
    if !meta.is_file() {
        return Err(ErrorBody::invalid_operation(msg!("engine.importNotFile", "Only files or directories can be imported")));
    }
    let (mut kind, media_type) = media_type_of(source).ok_or_else(|| ErrorBody::invalid_operation(msg!("engine.fileTypeUnsupported", "This kind of file is not supported")))?;
    // JSON 读出来像 Lottie 动画（有版本、帧率、帧范围与图层）就按 Lottie 收。
    if kind == AssetKind::Other && media_type == "application/json" && meta.len() <= LOTTIE_MAX_BYTES && looks_like_lottie_json(source) {
        kind = AssetKind::Lottie;
    }
    // 只有 ffprobe 认得的媒体才探测；矢量图、字体、字幕与数据文件没有可探测的流。Lottie 用内核的读法取尺寸与时长。
    let probe = if kind == AssetKind::Lottie {
        if meta.len() > LOTTIE_MAX_BYTES {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.lottieTooLarge",
                "The Lottie animation is over {size} MiB, too large for a sticker animation",
                size = LOTTIE_MAX_BYTES >> 20
            )));
        }
        probe_lottie(source, &original_name)?
    } else if matches!(kind, AssetKind::Video | AssetKind::Audio) || (kind == AssetKind::Image && media_type != "image/svg+xml") {
        probe(source, ffprobe, kind)?
    } else {
        ProbeInfo {
            duration: None,
            timebase: None,
            video: None,
            audio: None,
        }
    };
    // 视频容器里只有声音时按音频处理。
    if kind == AssetKind::Video && probe.video.is_none() {
        if probe.audio.is_none() {
            return Err(ErrorBody::probe_failed(msg!("engine.noPictureOrSound", "The file has no usable picture or sound")));
        }
        kind = AssetKind::Audio;
    }
    if matches!(kind, AssetKind::Video | AssetKind::Audio) && probe.duration.is_none() {
        return Err(ErrorBody::probe_failed(msg!("engine.durationUnreadable", "Cannot read the duration of the asset")));
    }
    let ((content_hash, byte_length), storage) = match mode {
        StorageMode::Managed => (publish_blob(video_dir, source, media_type)?, AssetStorage::Managed),
        StorageMode::Linked => (
            hash_file(source)?,
            AssetStorage::Linked {
                locator: link_locator(video_dir, given).0,
                frozen: false,
            },
        ),
    };
    Ok(PreparedAsset {
        kind,
        content_hash,
        byte_length,
        media_type: media_type.to_string(),
        original_name,
        probe,
        storage,
        tree: None,
    })
}

/// 边复制边算摘要，写入 staging 并落盘，再改名为内容地址。已有同样的 blob 时丢掉这一份。
fn publish_blob(video_dir: &Path, source: &Path, media_type: &str) -> EngineResult<(String, u64)> {
    let staging_dir = video_dir.join("blobs").join(".staging");
    fs::create_dir_all(&staging_dir)?;
    let staging = staging_dir.join(crate::ids::new_id("import"));
    let result = (|| -> EngineResult<(String, u64)> {
        let mut input = File::open(source)?;
        let mut output = File::create(&staging)?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1 << 20];
        let mut total = 0u64;
        loop {
            let n = input.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            output.write_all(&buf[..n])?;
            total += n as u64;
        }
        output.sync_all()?;
        let hash = format!("sha256:{}", hex(hasher.finalize()));
        let target = video_dir.join(blob_rel_path(&hash, media_type));
        if target.exists() {
            fs::remove_file(&staging)?;
        } else {
            fs::rename(&staging, &target)?;
            if let Ok(dir) = File::open(video_dir.join("blobs")) {
                let _ = dir.sync_all();
            }
        }
        Ok((hash, total))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staging);
    }
    result
}

/// JSON 文件是不是 Lottie 动画的样子：顶层有版本 `v`（字符串或数）、数值的 `fr`/`ip`/`op` 与图层数组（与素材库认
/// Lottie 贴纸的判断相同）。像的交给内核读，读不开就不收；读不出来或不是 JSON 都算不是，仍按普通 JSON 收。
fn looks_like_lottie_json(source: &Path) -> bool {
    let Ok(bytes) = fs::read(source) else {
        return false;
    };
    let Ok(Value::Object(doc)) = serde_json::from_slice::<Value>(&bytes) else {
        return false;
    };
    doc.get("v").is_some_and(|v| v.is_string() || v.is_number())
        && ["fr", "ip", "op"]
            .iter()
            .all(|key| doc.get(*key).and_then(Value::as_f64).is_some_and(f64::is_finite))
        && doc.get("layers").is_some_and(Value::is_array)
}

fn lottie_recovery() -> Text {
    msg!(
        "engine.lottieRecovery",
        "Make sure the file is a Lottie animation: JSON exported by bodymovin, or a .lottie archive"
    )
}

/// Lottie 素材的尺寸与时长：用内核读 Lottie 的同一份实现（[`render_raster::source::Lottie::parse`]，JSON 或 `.lottie`
/// 压缩包）。显示尺寸是动画声明的宽高，帧率是动画的帧率，时长是帧范围除以帧率（毫秒取整，与内核取帧一致）；没有音轨。
/// 读不开、用了内核不支持的特性、没有时长时不收。
fn probe_lottie(source: &Path, name: &str) -> EngineResult<ProbeInfo> {
    let bytes = fs::read(source).map_err(|e| ErrorBody::asset_missing(
        "",
        msg!("engine.importUnreadable", "Cannot read the file to import: {error}", error = e.to_string()),
    ))?;
    let lottie = render_raster::source::Lottie::parse(name, name, &bytes)
        .map_err(|e| ErrorBody::probe_failed(msg!(
            "engine.lottieUnreadable",
            "Not a readable Lottie animation: {error}",
            error = format!("{e:#}")
        ))
        .recovery(lottie_recovery()))?;
    let meta = lottie.metadata();
    let total_ms = meta.total_ms();
    if total_ms <= 0 {
        return Err(ErrorBody::probe_failed(msg!(
            "engine.lottieNoDuration",
            "The Lottie animation has no duration (its frame range is empty)"
        ))
        .recovery(lottie_recovery()));
    }
    let duration = Ratio::new(total_ms as i128, 1000)
        .and_then(|d| MediaTime::from_ratio(d, "duration").ok())
        .ok_or_else(|| ErrorBody::probe_failed(msg!("engine.lottieDurationRange", "The duration of the Lottie animation is out of range")))?;
    let fr = lottie.frame_rate();
    // 帧率按千分之一取有理数并约分（29.97 记成 2997/100），整数帧率原样。
    let rate = Ratio::new((fr * 1000.0).round() as i128, 1000)
        .and_then(to_rate)
        .ok_or_else(|| ErrorBody::probe_failed(msg!("engine.lottieFrameRate", "The Lottie animation has an invalid frame rate: {rate}", rate = fr)))?;
    let video = VideoInfo {
        display_width: meta.width,
        display_height: meta.height,
        rotation: 0,
        pixel_aspect_ratio: Rate { num: 1, den: 1 },
        frame_rate: FrameRateInfo::Cfr { rate },
        pts_origin: MediaTime::zero(),
        has_alpha: true,
    };
    Ok(ProbeInfo {
        duration: Some(duration),
        timebase: None,
        video: Some(video),
        audio: None,
    })
}

/// 用 ffprobe 读媒体信息。时长与 PTS 用流的整数 timebase 精确换算，不走浮点。
pub fn probe(source: &Path, ffprobe: &Path, kind: AssetKind) -> EngineResult<ProbeInfo> {
    let output = Command::new(ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(source)
        .output()
        .map_err(|e| ErrorBody::probe_failed(msg!(
            "engine.ffprobeNotRunnable",
            "Cannot run ffprobe ({path}): {error}",
            path = ffprobe.display().to_string(),
            error = e.to_string()
        )))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ErrorBody::probe_failed(msg!(
            "engine.ffprobeFailed",
            "ffprobe cannot read this file: {error}",
            error = stderr.trim()
        )));
    }
    let json: Value =
        serde_json::from_slice(&output.stdout).map_err(|e| ErrorBody::probe_failed(msg!(
            "engine.ffprobeOutputInvalid",
            "The output of ffprobe cannot be parsed: {error}",
            error = e.to_string()
        )))?;
    Ok(parse_probe(&json, kind))
}

fn parse_rational(text: &str) -> Option<Ratio> {
    let (n, d) = text.split_once('/').or_else(|| text.split_once(':'))?;
    let (n, d): (i128, i128) = (n.trim().parse().ok()?, d.trim().parse().ok()?);
    if n <= 0 || d <= 0 {
        return None;
    }
    Ratio::new(n, d)
}

fn to_rate(r: Ratio) -> Option<Rate> {
    Rate::new(i64::try_from(r.num()).ok()?, i64::try_from(r.den()).ok()?).ok()
}

/// 一个流的精确时长：`duration_ts × time_base`，没有时退回十进制的 `duration`。
fn stream_duration(stream: &Value) -> Option<Ratio> {
    let time_base = stream.get("time_base").and_then(Value::as_str).and_then(parse_rational);
    if let (Some(tb), Some(ts)) = (time_base, stream.get("duration_ts").and_then(Value::as_i64))
        && ts > 0
    {
        return Ratio::from_int(ts as i128)?.checked_mul(tb);
    }
    decimal(stream.get("duration"))
}

fn decimal(value: Option<&Value>) -> Option<Ratio> {
    let text = value?.as_str()?;
    parse_decimal_seconds(text, "duration").ok().filter(|r| !r.is_negative())
}

pub fn parse_probe(json: &Value, kind: AssetKind) -> ProbeInfo {
    let streams = json.get("streams").and_then(Value::as_array).cloned().unwrap_or_default();
    let is = |s: &&Value, t: &str| s.get("codec_type").and_then(Value::as_str) == Some(t);
    let attached = |s: &&Value| s.get("disposition").and_then(|d| d.get("attached_pic")).and_then(Value::as_i64) == Some(1);
    let video_stream = streams
        .iter()
        .find(|s| is(s, "video") && (kind == AssetKind::Image || !attached(s)));
    let audio_stream = streams.iter().find(|s| is(s, "audio"));

    let video = video_stream.and_then(|s| {
        let width = s.get("width")?.as_u64()? as u32;
        let height = s.get("height")?.as_u64()? as u32;
        let rotation = rotation_of(s);
        let (display_width, display_height) = if rotation % 180 == 90 { (height, width) } else { (width, height) };
        let r = s.get("r_frame_rate").and_then(Value::as_str).and_then(parse_rational);
        let avg = s.get("avg_frame_rate").and_then(Value::as_str).and_then(parse_rational);
        let frame_rate = match (r.and_then(to_rate), avg) {
            (Some(rate), Some(avg)) if r == Some(avg) => FrameRateInfo::Cfr { rate },
            (nominal, _) => FrameRateInfo::Vfr { nominal },
        };
        let time_base = s.get("time_base").and_then(Value::as_str).and_then(parse_rational);
        let pts_origin = match (time_base, s.get("start_pts").and_then(Value::as_i64)) {
            (Some(tb), Some(pts)) => Ratio::from_int(pts as i128).and_then(|p| p.checked_mul(tb)),
            _ => None,
        }
        .unwrap_or(Ratio::ZERO);
        let pixel_aspect_ratio = s
            .get("sample_aspect_ratio")
            .and_then(Value::as_str)
            .and_then(parse_rational)
            .and_then(to_rate)
            .unwrap_or(Rate { num: 1, den: 1 });
        let pix_fmt = s.get("pix_fmt").and_then(Value::as_str).unwrap_or("");
        let has_alpha = pix_fmt.starts_with("yuva")
            || pix_fmt.contains("rgba")
            || pix_fmt.contains("argb")
            || pix_fmt.contains("bgra")
            || pix_fmt.starts_with("ya");
        Some(VideoInfo {
            display_width,
            display_height,
            rotation,
            pixel_aspect_ratio,
            frame_rate,
            pts_origin: MediaTime::from_ratio(pts_origin, "ptsOrigin").unwrap_or_else(|_| MediaTime::zero()),
            has_alpha,
        })
    });
    let audio = audio_stream.and_then(|s| {
        Some(AudioInfo {
            sample_rate: s.get("sample_rate")?.as_str()?.parse().ok()?,
            channels: s.get("channels")?.as_u64()? as u32,
            layout: s.get("channel_layout").and_then(Value::as_str).map(str::to_string),
        })
    });

    let main = if kind == AssetKind::Audio || video.is_none() {
        audio_stream
    } else {
        video_stream
    };
    let duration = if kind == AssetKind::Image {
        None
    } else {
        main.and_then(stream_duration)
            .or_else(|| decimal(json.get("format").and_then(|f| f.get("duration"))))
    };
    let timebase = main
        .and_then(|s| s.get("time_base"))
        .and_then(Value::as_str)
        .and_then(parse_rational)
        .and_then(to_rate);
    ProbeInfo {
        duration: duration.and_then(|d| MediaTime::from_ratio(d, "duration").ok()),
        timebase,
        video,
        audio,
    }
}

fn rotation_of(stream: &Value) -> u32 {
    let from_matrix = stream
        .get("side_data_list")
        .and_then(Value::as_array)
        .and_then(|list| list.iter().find_map(|d| d.get("rotation").and_then(Value::as_f64)));
    let from_tag = stream
        .get("tags")
        .and_then(|t| t.get("rotate"))
        .and_then(Value::as_str)
        .and_then(|r| r.parse::<f64>().ok());
    let degrees = from_matrix.or(from_tag).unwrap_or(0.0).round() as i64;
    (degrees.rem_euclid(360) / 90 * 90) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn probe_uses_exact_stream_timebase() {
        let json = json!({
            "streams": [
                { "codec_type": "video", "width": 1920, "height": 1080, "r_frame_rate": "30000/1001", "avg_frame_rate": "30000/1001",
                  "time_base": "1/30000", "duration_ts": 300300, "start_pts": 0, "pix_fmt": "yuv420p",
                  "side_data_list": [{ "rotation": -90 }] },
                { "codec_type": "audio", "sample_rate": "48000", "channels": 2, "channel_layout": "stereo", "time_base": "1/48000" }
            ],
            "format": { "duration": "10.010000" }
        });
        let info = parse_probe(&json, AssetKind::Video);
        assert_eq!(
            info.duration,
            Some(MediaTime {
                ticks: "1001".into(),
                timescale: 100
            })
        );
        let video = info.video.unwrap();
        assert_eq!((video.display_width, video.display_height, video.rotation), (1080, 1920, 270));
        assert_eq!(
            video.frame_rate,
            FrameRateInfo::Cfr {
                rate: Rate { num: 30000, den: 1001 }
            }
        );
        assert_eq!(info.audio.unwrap().sample_rate, 48000);
    }

    #[test]
    fn variable_frame_rate_keeps_only_a_nominal_rate() {
        let json = json!({ "streams": [{ "codec_type": "video", "width": 720, "height": 1280,
            "r_frame_rate": "30/1", "avg_frame_rate": "2997/100", "time_base": "1/600", "duration_ts": 6000 }] });
        let info = parse_probe(&json, AssetKind::Video);
        assert_eq!(
            info.video.unwrap().frame_rate,
            FrameRateInfo::Vfr {
                nominal: Some(Rate { num: 30, den: 1 })
            }
        );
        assert_eq!(
            info.duration,
            Some(MediaTime {
                ticks: "10".into(),
                timescale: 1
            })
        );
    }

    /// 一份最小的 Lottie：64×48，25 帧每秒，帧范围 0–50（2 秒），一个纯色图层。
    fn lottie_json() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "v": "5.7.4", "fr": 25, "ip": 0, "op": 50, "w": 64, "h": 48,
            "layers": [{ "ty": 1, "ind": 1, "ip": 0, "op": 50, "st": 0, "sw": 64, "sh": 48, "sc": "#ff0000",
                "ks": { "a": { "a": 0, "k": [0, 0] }, "o": { "a": 0, "k": 100 }, "p": { "a": 0, "k": [0, 0] },
                        "r": { "a": 0, "k": 0 }, "s": { "a": 0, "k": [100, 100] } } }]
        }))
        .unwrap()
    }

    /// 手拼一个只用「存储」方式的 zip（`(名字, 内容)`）。
    fn stored_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let crc32 = render_raster::source::lottie::archive::crc32;
        let (mut out, mut central) = (Vec::new(), Vec::new());
        for (name, data) in files {
            let (offset, crc, len) = (out.len() as u32, crc32(data), data.len() as u32);
            out.extend(0x0403_4b50u32.to_le_bytes());
            out.extend([20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            out.extend(crc.to_le_bytes());
            out.extend(len.to_le_bytes());
            out.extend(len.to_le_bytes());
            out.extend((name.len() as u16).to_le_bytes());
            out.extend([0, 0]);
            out.extend(name.as_bytes());
            out.extend(*data);
            central.extend(0x0201_4b50u32.to_le_bytes());
            central.extend([20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            central.extend(crc.to_le_bytes());
            central.extend(len.to_le_bytes());
            central.extend(len.to_le_bytes());
            central.extend((name.len() as u16).to_le_bytes());
            central.extend([0u8; 12]);
            central.extend(offset.to_le_bytes());
            central.extend(name.as_bytes());
        }
        let (start, size) = (out.len() as u32, central.len() as u32);
        out.extend(central);
        out.extend(0x0605_4b50u32.to_le_bytes());
        out.extend([0, 0, 0, 0]);
        out.extend((files.len() as u16).to_le_bytes());
        out.extend((files.len() as u16).to_le_bytes());
        out.extend(size.to_le_bytes());
        out.extend(start.to_le_bytes());
        out.extend([0, 0]);
        out
    }

    fn import(dir: &Path, name: &str, bytes: &[u8]) -> EngineResult<PreparedAsset> {
        let file = dir.join(name);
        fs::write(&file, bytes).unwrap();
        prepare_import(dir, &file, Path::new("/nonexistent/ffprobe"), Some(StorageMode::Linked), None)
    }

    fn assert_lottie_probe(prepared: &PreparedAsset) {
        assert_eq!(prepared.kind, AssetKind::Lottie);
        assert_eq!(
            prepared.probe.duration,
            Some(MediaTime {
                ticks: "2".into(),
                timescale: 1
            })
        );
        let video = prepared.probe.video.as_ref().unwrap();
        assert_eq!((video.display_width, video.display_height), (64, 48));
        assert_eq!(
            video.frame_rate,
            FrameRateInfo::Cfr {
                rate: Rate { num: 25, den: 1 }
            }
        );
        assert!(prepared.probe.audio.is_none());
    }

    #[test]
    fn a_lottie_json_imports_as_lottie_with_size_and_duration_from_the_kernel_reader() {
        let dir = tempfile::tempdir().unwrap();
        let prepared = import(dir.path(), "wave.json", &lottie_json()).unwrap();
        assert_lottie_probe(&prepared);
        assert_eq!(prepared.media_type, "application/json");
    }

    #[test]
    fn a_dotlottie_archive_imports_as_lottie() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = br#"{"version":"1","animations":[{"id":"wave"}]}"#;
        let archive = stored_zip(&[("manifest.json", manifest), ("animations/wave.json", &lottie_json())]);
        let prepared = import(dir.path(), "wave.lottie", &archive).unwrap();
        assert_lottie_probe(&prepared);
        assert_eq!(prepared.media_type, LOTTIE_ARCHIVE_MEDIA_TYPE);
        assert_eq!(blob_rel_path("sha256:ab", &prepared.media_type), PathBuf::from("blobs/ab.lottie"));
    }

    #[test]
    fn other_json_stays_other_and_unreadable_lottie_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let other = import(dir.path(), "data.json", br#"{"name":"not an animation"}"#).unwrap();
        assert_eq!(other.kind, AssetKind::Other);
        assert!(other.probe.video.is_none());

        let broken = import(dir.path(), "broken.lottie", b"PK\x03\x04 not really a zip").unwrap_err();
        assert_eq!(broken.code, "MEDIA_PROBE_FAILED", "{broken:?}");
        let empty = import(dir.path(), "empty.lottie", &stored_zip(&[("manifest.json", b"{}")])).unwrap_err();
        assert_eq!(empty.code, "MEDIA_PROBE_FAILED", "{empty:?}");

        let mut shaped: Value = serde_json::from_slice(&lottie_json()).unwrap();
        shaped["op"] = json!(0);
        let no_duration = import(dir.path(), "still.json", &serde_json::to_vec(&shaped).unwrap()).unwrap_err();
        assert_eq!(no_duration.code, "MEDIA_PROBE_FAILED", "{no_duration:?}");
    }
}
