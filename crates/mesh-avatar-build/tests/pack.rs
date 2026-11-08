//! `pack`：只收播放要的文件、条目不压缩，打出来的包 BaoCut 的播放器直接能读。

use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;

use mesh_avatar_build::pack::pack_project;
use puppet::{CharacterPackage, testing};

fn project() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mesh-avatar-pack-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    for (name, bytes) in testing::mesh_avatar_files() {
        let path = dir.join(&name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    // 原图、草稿与变体：只有原图按选项进包
    fs::write(dir.join("source.png"), b"source").unwrap();
    fs::write(dir.join("rig.draft.json"), b"{}").unwrap();
    fs::create_dir_all(dir.join("variants")).unwrap();
    fs::write(dir.join("variants/eyes_closed.png"), b"variant").unwrap();
    dir
}

fn entries(bytes: &[u8]) -> Vec<(String, zip::CompressionMethod, Vec<u8>)> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut f = zip.by_index(i).unwrap();
            let mut data = Vec::new();
            f.read_to_end(&mut data).unwrap();
            (f.name().to_string(), f.compression(), data)
        })
        .collect()
}

#[test]
fn a_packed_project_plays_and_leaves_drafts_out() {
    let dir = project();
    let bytes = pack_project(&dir, true).unwrap();
    let files = entries(&bytes);
    let names: Vec<&str> = files.iter().map(|f| f.0.as_str()).collect();
    assert_eq!(names[..2], ["avatar.json", "rig.json"]);
    assert!(names.contains(&"source.png") && names.contains(&"built/hairmask.png"));
    assert!(names.contains(&"built/sprites/sprites.json") && names.iter().any(|n| n.starts_with("built/sprites/eyes")));
    assert!(!names.iter().any(|n| n.starts_with("variants/") || *n == "rig.draft.json"));
    assert!(files.iter().all(|f| f.1 == zip::CompressionMethod::Stored));
    let package = CharacterPackage::from_zip(&bytes).unwrap();
    assert!(matches!(package, CharacterPackage::Mesh(_)));
    assert_eq!(package.canvas(), [1024, 1536]);

    let bytes = pack_project(&dir, false).unwrap();
    let files = entries(&bytes);
    assert!(!files.iter().any(|f| f.0 == "source.png"));
    let manifest: serde_json::Value = serde_json::from_slice(&files[0].2).unwrap();
    assert_eq!(manifest["name"], "xiaoli");
    assert!(manifest.get("source").is_none());

    fs::remove_file(dir.join("rig.json")).unwrap();
    let error = pack_project(&dir, true).unwrap_err().to_string();
    assert!(error.contains("rig.json"), "{error}");
    fs::remove_dir_all(&dir).unwrap();
}
