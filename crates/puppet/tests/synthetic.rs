//! 合成角色（[`puppet::testing`]）的端到端：读包、按时刻出帧。

use std::sync::Arc;

use puppet::testing::{files, zip};
use puppet::{ErrorKind, Package, Player, Puppet, Track};

fn package() -> Package {
    Package::from_zip(&zip(&files(""))).unwrap()
}

fn track(json: serde_json::Value) -> Arc<Track> {
    Arc::new(Track::parse(&serde_json::to_vec(&json).unwrap()).unwrap())
}

fn talking() -> Arc<Track> {
    let n = 61;
    let mouth: Vec<f64> = (0..n).map(|i| if (i / 6) % 2 == 1 { 0.9 } else { 0.0 }).collect();
    let turn: Vec<f64> = (0..n).map(|i| 20.0 * (f64::from(i) / 10.0).sin()).collect();
    track(serde_json::json!({
        "format": "baocut-puppet-track", "version": 1, "fps": 30, "duration": 2.0,
        "params": { "mouthOpen": mouth, "angleX": turn }
    }))
}

fn frame(p: &mut Player, t: f64) -> Vec<u8> {
    let mut px = vec![0u8; 128 * 192 * 4];
    p.render(t, 128, 192, &mut px);
    px
}

fn at(px: &[u8], x: usize, y: usize) -> [u8; 4] {
    let k = 4 * (y * 128 + x);
    [px[k], px[k + 1], px[k + 2], px[k + 3]]
}

#[test]
fn draws_the_layers() {
    let pkg = package();
    let mut p = Player::new(Puppet::new(&pkg).unwrap(), None, 1, 0.0);
    let px = frame(&mut p, 0.0);
    // 画布 256×384 缩成 128×192：脸的中间是脸色，身体是蓝的，四角透明
    assert_eq!(at(&px, 64, 64)[3], 255);
    assert!(at(&px, 64, 64)[0] > 200);
    assert_eq!(at(&px, 64, 160), [60, 90, 160, 255]);
    assert_eq!(at(&px, 0, 0), [0, 0, 0, 0]);
    assert_eq!(at(&px, 127, 191)[3], 0);
}

#[test]
fn any_seek_order_gives_the_same_frame() {
    let pkg = package();
    let make = || Player::new(Puppet::new(&pkg).unwrap(), Some(talking()), 7, 0.0);
    let direct = frame(&mut make(), 1.5);
    let mut played = make();
    for k in 0..45 {
        frame(&mut played, f64::from(k) / 30.0);
    }
    assert_eq!(frame(&mut played, 1.5), direct);
    let mut back = make();
    frame(&mut back, 1.9);
    assert_eq!(frame(&mut back, 1.5), direct);
    // 同一时刻再画一次不再走物理
    assert_eq!(frame(&mut back, 1.5), direct);
}

#[test]
fn seeking_back_past_a_checkpoint_gives_the_same_frame() {
    let pkg = package();
    let n = 25 * 30 + 1;
    let mouth: Vec<f64> = (0..n).map(|i| if (i / 7) % 2 == 1 { 0.8 } else { 0.0 }).collect();
    let turn: Vec<f64> = (0..n).map(|i| 25.0 * (f64::from(i) / 17.0).sin()).collect();
    let long = track(serde_json::json!({
        "format": "baocut-puppet-track", "version": 1, "fps": 30, "duration": 25.0,
        "params": { "mouthOpen": mouth, "angleX": turn }
    }));
    let make = || Player::new(Puppet::new(&pkg).unwrap(), Some(long.clone()), 3, 0.0);
    let direct = frame(&mut make(), 21.0);
    let mut back = make();
    frame(&mut back, 24.0);
    // 往回走到 21 秒：从 19.5 秒的快照接着走，不从头
    assert_eq!(frame(&mut back, 21.0), direct);
    assert_eq!(frame(&mut back, 3.0), frame(&mut make(), 3.0));
}

#[test]
fn before_the_track_starts_the_character_idles() {
    let pkg = package();
    let mut talk = Player::new(Puppet::new(&pkg).unwrap(), Some(talking()), 5, -2.0);
    let mut idle = Player::new(Puppet::new(&pkg).unwrap(), None, 5, -2.0);
    assert_eq!(frame(&mut talk, -1.0), frame(&mut idle, -1.0));
    // 从 0 秒以后开始的条目只看时刻：与从 0 秒开始的画面一样（拆开的后一段接得上）
    let mut late = Player::new(Puppet::new(&pkg).unwrap(), Some(talking()), 5, 1.2);
    let mut early = Player::new(Puppet::new(&pkg).unwrap(), Some(talking()), 5, 0.0);
    assert_eq!(frame(&mut late, 1.4), frame(&mut early, 1.4));
}

#[test]
fn the_track_moves_the_mouth_and_ends_in_idle() {
    let pkg = package();
    let mouth_px = |px: &[u8]| (74..80).map(|y| (58..70).filter(|&x| at(px, x, y)[0] < 160).count()).sum::<usize>();
    let open = track(serde_json::json!({
        "format": "baocut-puppet-track", "version": 1, "fps": 30, "duration": 1.0, "params": { "mouthOpen": [1.0] }
    }));
    let mut talk = Player::new(Puppet::new(&pkg).unwrap(), Some(open), 1, 0.0);
    let mut idle = Player::new(Puppet::new(&pkg).unwrap(), None, 1, 0.0);
    let (a, b) = (frame(&mut talk, 0.8), frame(&mut idle, 0.8));
    assert!(mouth_px(&a) > mouth_px(&b) + 4, "open {} closed {}", mouth_px(&a), mouth_px(&b));
    // 动作轨结束 0.5 秒后完全交回待机动作
    assert_eq!(frame(&mut talk, 2.0), frame(&mut idle, 2.0));
}

#[test]
fn reads_a_package_inside_one_folder() {
    let pkg = Package::from_zip(&zip(&files("host/"))).unwrap();
    assert_eq!(pkg.model.layers.len(), 10);
}

#[test]
fn rejects_broken_packages() {
    let mut f = files("");
    f.retain(|(n, _)| n != "textures/iris.png");
    assert_eq!(Package::from_zip(&zip(&f)).unwrap_err().kind, ErrorKind::MissingFile);
    let mut f = files("");
    f[0].1 = br#"{"format":"livliv-model","version":4}"#.to_vec();
    assert_eq!(Package::from_zip(&zip(&f)).unwrap_err().kind, ErrorKind::Invalid);
    assert_eq!(Package::from_zip(b"not a zip").unwrap_err().kind, ErrorKind::NotZip);
}

/// `tests/fixtures/synthetic.bcpuppet` 是 [`puppet::testing::package_zip`] 的字节，给 Runtime 的端到端测试用（TS 那边
/// 拼不出贴图）。合成角色改了就跑 `BAOCUT_WRITE_FIXTURES=1 cargo test -p puppet --test synthetic` 重写它。
#[test]
fn the_package_fixture_matches_the_synthetic_package() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/synthetic.bcpuppet");
    let bytes = puppet::testing::package_zip();
    if std::env::var_os("BAOCUT_WRITE_FIXTURES").is_some() {
        std::fs::write(&path, &bytes).unwrap();
    }
    assert!(std::fs::read(&path).unwrap() == bytes, "rerun with BAOCUT_WRITE_FIXTURES=1 to refresh {}", path.display());
}

fn offsets(ch: &str, v: f64) -> Arc<Track> {
    track(serde_json::json!({
        "format": "baocut-puppet-track", "version": 1, "fps": 10, "duration": 2.0,
        "offsets": { ch: vec![v; 21] }
    }))
}

#[test]
fn offsets_add_to_the_idle() {
    let pkg = package();
    let mut idle = Player::new(Puppet::new(&pkg).unwrap(), None, 5, 0.0);
    let mut added = Player::new(Puppet::new(&pkg).unwrap(), Some(offsets("angleX", 6.0)), 5, 0.0);
    idle.seek(1.0);
    added.seek(1.0);
    let (a, b) = (idle.puppet().params.angle_x, added.puppet().params.angle_x);
    assert!((b - a - 6.0).abs() < 1e-9, "{a} + 6 != {b}");
    // 动作轨结束后渐渐交回待机
    idle.seek(3.0);
    added.seek(3.0);
    assert_eq!(idle.puppet().params.angle_x, added.puppet().params.angle_x);
}

#[test]
fn move_shifts_the_picture_but_never_lifts_a_cut_edge() {
    let pkg = package();
    let make = |tr: Option<Arc<Track>>| Player::new(Puppet::new(&pkg).unwrap(), tr, 2, 0.0);
    let still = frame(&mut make(None), 1.0);
    // 往右四分之一个画面：身体右边原来空着的地方现在是身体
    let right = frame(&mut make(Some(offsets("moveX", 0.25))), 1.0);
    assert_eq!(at(&still, 118, 180)[3], 0);
    assert_eq!(at(&right, 118, 180), [60, 90, 160, 255]);
    // 合成角色的身体到画布底边（被切开的半身）：往上移不显出切口，画面不变；往下移可以
    assert_eq!(frame(&mut make(Some(offsets("moveY", 0.2))), 1.0), still);
    let down = frame(&mut make(Some(offsets("moveY", -0.1))), 1.0);
    let top = |px: &[u8]| (0..40).flat_map(|y| (0..128).map(move |x| (x, y))).filter(|&(x, y)| at(px, x, y)[3] > 0).count();
    assert!(top(&down) < top(&still));
}

#[test]
fn seeking_back_during_idle_moves_gives_the_same_frame() {
    // 没有动作轨时待机自己做小动作（第一个在 6 秒后）：跨快照往回 seek 也逐位一样
    let pkg = package();
    let make = || Player::new(Puppet::new(&pkg).unwrap(), None, 9, 0.0);
    let times = [7.0, 12.5, 21.0, 27.0];
    let direct: Vec<Vec<u8>> = times.iter().map(|&t| frame(&mut make(), t)).collect();
    let mut p = make();
    frame(&mut p, 29.0);
    for (k, &t) in times.iter().enumerate().rev() {
        assert_eq!(frame(&mut p, t), direct[k], "at {t}");
    }
}
