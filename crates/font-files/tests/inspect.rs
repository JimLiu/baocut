//! 检查字体文件（下载之后核对用）与列出族名：用打包的字体，不依赖这台机器装了什么字体。

use std::path::{Path, PathBuf};

use font_files::{FontLibrary, inspect_file};

fn bundled(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../render-raster/assets/fonts")
        .join(name)
}

#[test]
fn a_font_file_reports_its_faces_names_weight_and_style() {
    let faces = inspect_file(&bundled("PlayfairDisplay-Italic.ttf"), 96 * 1024 * 1024).unwrap();
    assert_eq!(faces.len(), 1);
    assert_eq!(faces[0].index, 0);
    assert!(faces[0].names.matches("Playfair Display"), "{:?}", faces[0].names);
    assert!(faces[0].italic);
    let marker = inspect_file(&bundled("PermanentMarker-Regular.ttf"), 96 * 1024 * 1024).unwrap();
    assert_eq!(marker[0].weight, 400);
    assert!(!marker[0].italic);
}

#[test]
fn files_that_are_not_fonts_or_too_large_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let html = dir.path().join("page.ttf");
    std::fs::write(&html, b"<!DOCTYPE html><html>not a font</html>").unwrap();
    assert!(inspect_file(&html, 1024 * 1024).is_err());
    // 表目录指到文件之外：截断的下载。
    let bytes = std::fs::read(bundled("PermanentMarker-Regular.ttf")).unwrap();
    let cut = dir.path().join("cut.ttf");
    std::fs::write(&cut, &bytes[..bytes.len() / 2]).unwrap();
    assert!(inspect_file(&cut, 96 * 1024 * 1024).is_err());
    assert!(inspect_file(&bundled("PermanentMarker-Regular.ttf"), 1000).is_err());
    assert!(inspect_file(&dir.path().join("missing.ttf"), 1000).is_err());
}

#[test]
fn families_lists_each_family_once_without_paths() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["Poppins-Regular.ttf", "Poppins-Medium.ttf", "Anton-Regular.ttf"] {
        std::fs::copy(bundled(name), dir.path().join(name)).unwrap();
    }
    let library = FontLibrary::from_dirs(&[dir.path().to_path_buf()]);
    assert_eq!(library.families(), vec!["Anton".to_string(), "Poppins".to_string()]);
    assert!(FontLibrary::from_dirs(&[]).families().is_empty());
}
