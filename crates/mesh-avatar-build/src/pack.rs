//! 把项目目录打成 `.mavatar`：条目不压缩的 zip，根上是 `avatar.json`、`rig.json` 与 `built/`，再加可选的
//! 缩略图与原图。只收播放要的文件（清单、rig、`layers.json` 与 `sprites.json` 列出的层、叠加物、底图与头发遮罩），
//! 草稿、变体与中间文件不进包。移植自 mesh-avatar-studio 的 `tools/pack-avatar.mjs`（`packProjectAvatar`）。

use std::collections::BTreeSet;
use std::fs;
use std::io::{Cursor, Write};
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};
use mesh_avatar_core::format::AvatarPackage;
use serde_json::Value;

fn layer_name_ok(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn entry_name_ok(name: &str) -> bool {
    let b = name.as_bytes();
    !name.is_empty()
        && !name.starts_with('/')
        && !name.contains(['\\', '\0'])
        && !(b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':')
        && !name.split('/').any(|s| s == "..")
}

/// 读项目里的一个普通文件（不跟符号链接）；没有返回 `None`。
fn read(project: &Path, name: &str) -> Result<Option<Vec<u8>>> {
    let path = project.join(name);
    match fs::symlink_metadata(&path) {
        Ok(m) if m.is_file() => Ok(Some(fs::read(&path).with_context(|| format!("cannot read {name}"))?)),
        Ok(_) => bail!("{name}: not a regular file"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("cannot read {name}")),
    }
}

fn json(name: &str, bytes: &[u8]) -> Result<Value> {
    serde_json::from_slice(bytes).with_context(|| format!("{name}: invalid JSON"))
}

/// 打包 `project`；`include_source` 为假时不带原图（清单里的 `source` 一并去掉）。返回 zip 的字节，打好后按
/// 播放器的读法读一遍。
pub fn pack_project(project: &Path, include_source: bool) -> Result<Vec<u8>> {
    let mut manifest = match read(project, "avatar.json")? {
        Some(bytes) => json("avatar.json", &bytes)?,
        None => {
            let name = project
                .canonicalize()
                .ok()
                .and_then(|p| p.file_name().and_then(|n| n.to_str()).map(str::to_owned))
                .unwrap_or_else(|| "Avatar".into());
            serde_json::json!({ "format": "mesh-avatar", "version": 1, "name": name })
        }
    };
    let field = |key: &str, default: &str| -> Result<String> {
        let v = manifest.get(key).and_then(Value::as_str).unwrap_or(default).to_owned();
        ensure!(entry_name_ok(&v), "avatar.json.{key}: unsafe path {v}");
        Ok(v)
    };
    let (source, thumbnail) = (field("source", "source.png")?, field("thumbnail", "thumbnail.png")?);
    if !include_source && let Some(m) = manifest.as_object_mut() {
        m.remove("source");
    }
    let rig = read(project, "rig.json")?.context("rig.json: missing file")?;
    let mut wanted = BTreeSet::from(["built/base.png".to_owned(), "built/hairmask.png".to_owned(), thumbnail]);
    if json("rig.json", &rig)?.get("cloth").and_then(Value::as_array).is_some_and(|c| !c.is_empty()) {
        wanted.insert("built/base_cloth.png".into());
    }
    if include_source {
        wanted.insert(source);
    }
    for (meta, prefix) in [("built/layers.json", "built/"), ("built/sprites/sprites.json", "built/sprites/")] {
        let Some(bytes) = read(project, meta)? else {
            continue;
        };
        wanted.insert(meta.into());
        if let Some(layers) = json(meta, &bytes)?.get("layers").and_then(Value::as_object) {
            for name in layers.keys() {
                ensure!(layer_name_ok(name), "{meta}.layers.{name}: invalid layer name");
                wanted.insert(format!("{prefix}{name}.png"));
            }
        }
    }
    const OVERLAYS: &str = "built/overlays/overlays.json";
    if let Some(bytes) = read(project, OVERLAYS)? {
        wanted.insert(OVERLAYS.into());
        for item in json(OVERLAYS, &bytes)?.get("overlays").and_then(Value::as_array).into_iter().flatten() {
            let file = item.get("file").and_then(Value::as_str).unwrap_or("");
            ensure!(
                file.ends_with(".png") && layer_name_ok(file.trim_end_matches(".png")),
                "{OVERLAYS}: invalid overlay file name"
            );
            wanted.insert(format!("built/overlays/{file}"));
        }
    }
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .last_modified_time(zip::DateTime::default());
    let mut put = |name: &str, bytes: &[u8]| -> Result<()> {
        writer.start_file(name, options)?;
        writer.write_all(bytes)?;
        Ok(())
    };
    put("avatar.json", &serde_json::to_vec_pretty(&manifest)?)?;
    put("rig.json", &rig)?;
    for name in &wanted {
        if let Some(bytes) = read(project, name)? {
            put(name, &bytes)?;
        }
    }
    let bytes = writer.finish()?.into_inner();
    AvatarPackage::from_archive(Cursor::new(&bytes)).context("the packed avatar does not load")?;
    Ok(bytes)
}
