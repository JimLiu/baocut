//! 测试钩子：设了 `BAOCUT_FONT_DIRS` 时本机字体库只扫它列出的目录。环境变量是进程级的，这个文件只放这一个测试。

use font_files::{FONT_DIRS_ENV, FaceQuery, FontLibrary, Missing};

#[test]
fn the_font_dirs_variable_replaces_system_scanning() {
    let dir = tempfile::tempdir().unwrap();
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../render-raster/assets/fonts/PermanentMarker-Regular.ttf");
    std::fs::copy(source, dir.path().join("marker.ttf")).unwrap();
    let empty = tempfile::tempdir().unwrap();
    let dirs = std::env::join_paths([empty.path(), dir.path()]).unwrap();
    // SAFETY: 这个测试二进制里只有这一个测试，设变量时没有别的线程读环境。
    unsafe { std::env::set_var(FONT_DIRS_ENV, dirs) };
    let library = FontLibrary::system();
    let face = |family: &str| {
        library.resolve_face(&FaceQuery {
            family: family.into(),
            weight: 400,
            italic: false,
        })
    };
    assert_eq!(face("Permanent Marker").unwrap().path, dir.path().join("marker.ttf"));
    // 本机装着的字体一个也不扫。
    assert_eq!(face("Helvetica"), Err(Missing::NotFound));
    assert_eq!(face("Arial"), Err(Missing::NotFound));
}
