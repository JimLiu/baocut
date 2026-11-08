//! mesh-avatar 角色（格式规范 §2.5）：按包里的文件认出来、读不开时的错误代码、动作轨驱动嘴与表情、任意 seek 结果一样。

use std::sync::{Arc, OnceLock};

use puppet::{Character, CharacterPackage, ErrorKind, Player, Track, testing};

fn bytes() -> &'static [u8] {
    static BYTES: OnceLock<Vec<u8>> = OnceLock::new();
    BYTES.get_or_init(|| testing::zip(&testing::mesh_avatar_files()))
}

fn package() -> &'static CharacterPackage {
    static PACKAGE: OnceLock<CharacterPackage> = OnceLock::new();
    PACKAGE.get_or_init(|| CharacterPackage::from_zip(bytes()).unwrap())
}

fn track(json: serde_json::Value) -> Arc<Track> {
    Arc::new(Track::parse(&serde_json::to_vec(&json).unwrap()).unwrap())
}

fn player(track: Option<Arc<Track>>) -> Player {
    Player::new(Character::new(package()).unwrap(), track, 3, 0.0)
}

fn frame(p: &mut Player, t: f64) -> Vec<u8> {
    let mut px = vec![0u8; 96 * 144 * 4];
    p.render(t, 96, 144, &mut px);
    px
}

#[test]
fn packages_are_told_apart_by_their_files() {
    assert!(matches!(package(), CharacterPackage::Mesh(_)));
    assert_eq!(package().canvas(), [1024, 1536]);
    assert_eq!(CharacterPackage::inspect(bytes()).unwrap(), [1024, 1536]);
    let layered = CharacterPackage::from_zip(&testing::package_zip()).unwrap();
    assert!(matches!(layered, CharacterPackage::Layered(_)));
    assert_eq!(CharacterPackage::inspect(&testing::package_zip()).unwrap(), [testing::W, testing::H]);
}

#[test]
fn broken_packages_get_error_codes() {
    let without = |name: &str| {
        let files: Vec<_> = testing::mesh_avatar_files().into_iter().filter(|(n, _)| n != name).collect();
        CharacterPackage::from_zip(&testing::zip(&files)).unwrap_err().kind
    };
    assert_eq!(without("rig.json"), ErrorKind::MissingFile);
    assert_eq!(without("built/eye0_ball.png"), ErrorKind::MissingFile);
    let mut files = testing::mesh_avatar_files();
    files.iter_mut().find(|(n, _)| n == "built/base.png").unwrap().1 = b"not a png".to_vec();
    assert_eq!(CharacterPackage::from_zip(&testing::zip(&files)).unwrap_err().kind, ErrorKind::Image);
    let mut files = testing::mesh_avatar_files();
    files[0].1 = br#"{"format":"mesh-avatar","version":2,"name":"x"}"#.to_vec();
    assert_eq!(CharacterPackage::from_zip(&testing::zip(&files)).unwrap_err().kind, ErrorKind::Unsupported);
}

#[test]
fn seeking_anywhere_draws_the_same_frame() {
    let tr = track(serde_json::from_slice(&testing::talking_track(12.0)).unwrap());
    let mut straight = player(Some(tr.clone()));
    let at = frame(&mut straight, 11.0);
    assert!(at.chunks_exact(4).filter(|p| p[3] > 0).count() > 96 * 144 / 4, "the character is drawn");
    // 往回 seek：从第 10 秒的快照接着走；再回到开头之前：从头重放
    let mut back = player(Some(tr));
    frame(&mut back, 11.6);
    assert_eq!(frame(&mut back, 11.0), at);
    frame(&mut back, 0.1);
    assert_eq!(frame(&mut back, 11.0), at);
    assert_ne!(frame(&mut back, 10.2), at, "the head turns between frames");
}

#[test]
fn the_track_drives_the_mouth_and_expressions() {
    let held = |params: serde_json::Value, expressions: serde_json::Value| {
        track(serde_json::json!({
            "format": "baocut-puppet-track", "version": 1, "fps": 30, "duration": 2.0,
            "params": params, "expressions": expressions
        }))
    };
    let still = |p: serde_json::Value, e: serde_json::Value| frame(&mut player(Some(held(p, e))), 1.5);
    let shut = still(serde_json::json!({ "mouthOpen": [0.0, 0.0] }), serde_json::json!({}));
    let open = still(serde_json::json!({ "mouthOpen": [1.0, 1.0] }), serde_json::json!({}));
    assert_ne!(shut, open);
    let smiling = still(serde_json::json!({ "mouthOpen": [0.0, 0.0] }), serde_json::json!({ "smile": [1.0, 1.0] }));
    assert_ne!(shut, smiling);
    // 不认得的表情与权重不到一半的表情都按中性画
    let unknown = still(serde_json::json!({ "mouthOpen": [0.0, 0.0] }), serde_json::json!({ "pout": [1.0, 1.0] }));
    assert_eq!(shut, unknown);
    let faint = still(serde_json::json!({ "mouthOpen": [0.0, 0.0] }), serde_json::json!({ "smile": [0.3, 0.3] }));
    assert_eq!(shut, faint);
}
