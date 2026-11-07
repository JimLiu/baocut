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

/// 框伸出画面时（宿主给出看得见的画面底边在框的第几行），半身角色往上最多跳到切口齐着画面底边：余量够时整段上去，
/// 不够时停在余量处；画面底边就是框的底边、或框整个在画面里时照旧只往下。平移交给宿主时角色画在原处。
#[test]
fn a_cut_edge_below_the_frame_lets_the_move_lift_up_to_it() {
    let pkg = package();
    let make = |v: f64| Player::new(Puppet::new(&pkg).unwrap(), Some(offsets("moveY", v)), 2, 0.0);
    let lift = |v: f64, bottom: f64| {
        let [x, y] = make(v).shift(1.0, 128, 192, bottom);
        assert_eq!(x, 0.0);
        -y
    };
    // 画面底边在第 152 行：切口在画面外 40 行，moveY 0.1（19.2 行）整段上去，0.3（57.6 行）停在 40 行
    assert!((lift(0.1, 152.0) - 19.2).abs() < 1e-4);
    assert!((lift(0.3, 152.0) - 40.0).abs() < 1e-4);
    // 画面底边就是框的底边、框整个在画面里：不往上；往下照常
    assert_eq!(lift(0.3, 192.0), 0.0);
    assert_eq!(lift(0.3, 260.0), 0.0);
    assert!((lift(-0.1, 192.0) + 19.2).abs() < 1e-4);
    // 宿主拿走平移：画在原处；把平移原样还回来就是 render 的那一帧
    let mut px = vec![0u8; 128 * 192 * 4];
    make(0.3).render_shifted(1.0, 128, 192, [0.0, 0.0], &mut px);
    assert_eq!(px, frame(&mut make(0.0), 1.0));
    let mut p = make(-0.1);
    let shift = p.shift(1.0, 128, 192, 192.0);
    p.render_shifted(1.0, 128, 192, shift, &mut px);
    assert_eq!(px, frame(&mut make(-0.1), 1.0));
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

/// 表情自己画的眉毛（`brow_tex`）在最后一个 `brows` 层之后画，盖在刘海上；表情关着时不画。表情补丁本身在刘海下面，
/// 在眉毛底下是不透明的脸（网格只铺在层贴图不透明的地方）。
#[test]
fn an_expression_draws_its_brows_over_the_bangs() {
    use puppet::testing::{model, png};
    // 刘海是模型的 70..186 × 30..70。中性眉毛（第 66–69 行）与表情画的眉毛（第 58–63 行）都压在刘海上
    let bar = |y0: f64, y1: f64, rgb: [u8; 3]| {
        png(64, 16, move |_, y| if (y0..y1).contains(&(y + 56.0)) { [rgb[0], rgb[1], rgb[2], 255] } else { [0, 0, 0, 0] })
    };
    let mut m = model();
    m["expressions"] = serde_json::json!([{ "id": "smile" }, { "id": "surprised" }]);
    let layers = m["layers"].as_array_mut().unwrap();
    let bangs = layers.iter().position(|l| l["id"] == "front_hair").unwrap();
    layers.insert(bangs, serde_json::json!({ "id": "expr_surprised", "role": "expr", "expression": "surprised", "texture": "textures/patch.png",
        "brow_tex": "textures/surprised_brows.png", "x": 96, "y": 56, "w": 64, "h": 16, "group": "head" }));
    layers.push(serde_json::json!({ "id": "brows", "texture": "textures/brows.png", "x": 96, "y": 56, "w": 64, "h": 16, "group": "head" }));
    let mut fs = files("");
    fs[0].1 = serde_json::to_vec(&m).unwrap();
    fs.push(("textures/patch.png".into(), png(64, 16, |_, _| [250, 220, 200, 255])));
    fs.push(("textures/brows.png".into(), bar(66.0, 70.0, [20, 20, 20])));
    fs.push(("textures/surprised_brows.png".into(), bar(58.0, 64.0, [200, 30, 200])));
    let pkg = Package::from_zip(&zip(&fs)).unwrap();
    let on = track(serde_json::json!({
        "format": "baocut-puppet-track", "version": 1, "fps": 30, "duration": 2.0,
        "expressions": { "surprised": vec![1.0; 61] }
    }));
    let mut p = Player::new(Puppet::new(&pkg).unwrap(), Some(on), 1, 0.0);
    let px = frame(&mut p, 1.0);
    // 画面缩一半，头随待机动一两个像素：脸中线上从上往下是刘海、表情画的眉毛、中性眉毛、脸
    let rows = |px: &[u8], rgb: [u8; 4]| (20..40).filter(|&y| at(px, 64, y) == rgb).collect::<Vec<_>>();
    let (up, flat) = (rows(&px, [200, 30, 200, 255]), rows(&px, [20, 20, 20, 255]));
    assert!(!up.is_empty() && !flat.is_empty() && up.last() < flat.first(), "{up:?} {flat:?}");
    assert_eq!(at(&px, 64, up[0] - 2), [100, 70, 50, 255]);
    let mut p = Player::new(Puppet::new(&pkg).unwrap(), None, 1, 0.0);
    let px = frame(&mut p, 0.0);
    assert!(rows(&px, [200, 30, 200, 255]).is_empty());
    assert!(!rows(&px, [20, 20, 20, 255]).is_empty());
}

/// 眨眼最后一段（睁开一成左右）：压扁的眼睛不透明，画在闭眼层上，再闭就只剩闭眼层；没有半透明的眼睛叠半透明的闭眼层
/// （一条灰带）。
#[test]
fn a_nearly_shut_eye_is_a_thin_opaque_eye_not_a_grey_band() {
    use puppet::testing::{model, png};
    // 左眼（模型的 95..123 × 110..126）压向中线第 118 行；闭眼层是同一块地方的一片深色
    let mut m = model();
    let layers = m["layers"].as_array_mut().unwrap();
    for l in layers.iter_mut() {
        if l["id"] == "eye_L" || l["id"] == "iris_L" {
            l["pivot"] = serde_json::json!([109, 118]);
        }
    }
    let eye = layers.iter().position(|l| l["id"] == "eye_L").unwrap();
    layers.insert(
        eye,
        serde_json::json!({ "id": "eye_L_closed", "role": "lid_L", "texture": "textures/lid.png",
        "x": 95, "y": 110, "w": 28, "h": 16, "group": "head" }),
    );
    let mut fs = files("");
    fs[0].1 = serde_json::to_vec(&m).unwrap();
    fs.push(("textures/lid.png".into(), png(28, 16, |_, _| [30, 20, 20, 255])));
    let pkg = Package::from_zip(&zip(&fs)).unwrap();
    let mut p = Puppet::new(&pkg).unwrap();
    // c 在 a 与 b 之间（两种颜色的混合）
    let between = |c: [u8; 3], a: [f64; 3], b: [f64; 3]| {
        let d: Vec<f64> = (0..3).map(|k| b[k] - a[k]).collect();
        let t = ((0..3).map(|k| (f64::from(c[k]) - a[k]) * d[k]).sum::<f64>() / d.iter().map(|v| v * v).sum::<f64>()).clamp(0.0, 1.0);
        (0..3).map(|k| (f64::from(c[k]) - a[k] - t * d[k]).powi(2)).sum::<f64>().sqrt() <= 10.0
    };
    // 只有眼睛：眼珠与眼白之间（压扁后缩小取样，眼珠会混进一点眼白）；没有眼睛：闭眼层与脸之间（闭眼层也淡入）
    let eye_only = |c: [u8; 3]| between(c, [40.0, 60.0, 120.0], [255.0, 255.0, 255.0]);
    let no_eye = |c: [u8; 3]| between(c, [30.0, 20.0, 20.0], [250.0, 220.0, 200.0]);
    // 画面是画布的 4 倍（合成眼睛小）：眼睛中线那一列（x 436），第 440–503 行里只有眼睛的行数、眼睛与闭眼层混色的行数
    let mut rows = |open: f64| {
        p.params.eye_l_open = open;
        p.update(0.0, true);
        let mut px = vec![0u8; 1024 * 1536 * 4];
        p.render(1024, 1536, &mut px);
        let col: Vec<[u8; 3]> = (440..504)
            .map(|y| {
                let k = 4 * (y * 1024 + 436);
                [px[k], px[k + 1], px[k + 2]]
            })
            .collect();
        let eye = col.iter().filter(|&&c| eye_only(c)).count();
        let mixed = col.iter().filter(|&&c| !eye_only(c) && !no_eye(c)).count();
        (eye, mixed)
    };
    // 越闭越扁，一直是不透明的眼睛，只有上下边缘的一两行混色；睁开不到 0.08 就只剩闭眼层
    let half = rows(0.4);
    for open in [0.1, 0.09] {
        let r = rows(open);
        assert!(half.0 > r.0 && r.0 >= 3 && r.1 <= 4, "open {open}: {r:?}, half {half:?}");
    }
    for open in [0.07, 0.06] {
        assert_eq!(rows(open), (0, 0), "open {open}");
    }
    // 合上：只有闭眼层
    assert_eq!(rows(0.0).0, 0);
}

/// 表情自己的眼睛（`expr_eye_L`）和中性的眼睛一样眨：朝 `pivot` 那一行压扁，睁开不到 0.08 就不画；它底下先画这一边的
/// 闭眼层，盖在表情补丁上。表情关着时既不画它，也不在补丁上多画闭眼层。
#[test]
fn an_expression_s_own_eyes_blink() {
    use puppet::testing::{model, png};
    // 左眼（模型的 95..123 × 110..126）压向第 118 行；表情补丁是盖住整只眼睛的一片皮肤，表情的眼睛是绿的
    let mut m = model();
    m["expressions"] = serde_json::json!([{ "id": "smile" }, { "id": "surprised" }]);
    let layers = m["layers"].as_array_mut().unwrap();
    for l in layers.iter_mut() {
        if l["id"] == "eye_L" || l["id"] == "iris_L" {
            l["pivot"] = serde_json::json!([109, 118]);
        }
    }
    let eye = layers.iter().position(|l| l["id"] == "eye_L").unwrap();
    layers.insert(
        eye,
        serde_json::json!({ "id": "eye_L_closed", "role": "lid_L", "texture": "textures/lid.png",
        "x": 95, "y": 110, "w": 28, "h": 16, "group": "head" }),
    );
    let mouth = layers.iter().position(|l| l["id"] == "mouth").unwrap();
    layers.insert(mouth + 1, serde_json::json!({ "id": "expr_surprised", "role": "expr", "expression": "surprised",
        "texture": "textures/patch.png", "x": 88, "y": 102, "w": 44, "h": 32, "group": "head" }));
    layers.insert(mouth + 2, serde_json::json!({ "id": "expr_surprised_eye_L", "role": "expr_eye_L", "expression": "surprised",
        "texture": "textures/surprised_eye.png", "x": 95, "y": 110, "w": 28, "h": 16, "group": "head", "pivot": [109, 118] }));
    let mut fs = files("");
    fs[0].1 = serde_json::to_vec(&m).unwrap();
    fs.push(("textures/lid.png".into(), png(28, 16, |_, _| [30, 20, 20, 255])));
    fs.push(("textures/patch.png".into(), png(44, 32, |_, _| [250, 220, 200, 255])));
    fs.push(("textures/surprised_eye.png".into(), puppet::testing::ellipse(28, 16, [40, 160, 60])));
    let pkg = Package::from_zip(&zip(&fs)).unwrap();
    let mut p = Puppet::new(&pkg).unwrap();
    let near = |c: [u8; 3], t: [u8; 3]| (0..3).all(|k| c[k].abs_diff(t[k]) <= 12);
    // 画面是画布的 4 倍：眼睛中线那一列（x 436），第 440–503 行里表情的眼睛、闭眼层、中性的眼珠各占几行（闭眼层是
    // 一整块深色，眼睛压向它找到的那条睫毛线）
    let mut rows = |surprised: f64, open: f64| {
        p.set_expression("surprised", surprised);
        p.params.eye_l_open = open;
        p.update(0.0, true);
        let mut px = vec![0u8; 1024 * 1536 * 4];
        p.render(1024, 1536, &mut px);
        let col: Vec<[u8; 3]> = (440..504)
            .map(|y| {
                let k = 4 * (y * 1024 + 436);
                [px[k], px[k + 1], px[k + 2]]
            })
            .collect();
        let n = |t: [u8; 3]| col.iter().filter(|&&c| near(c, t)).count();
        // 闭眼层是深色的（快闭上时它还差一点没完全不透明）
        let lid = col.iter().filter(|c| c.iter().all(|&v| v < 70)).count();
        (n([40, 160, 60]), lid, n([40, 60, 120]))
    };
    // 睁着：表情的眼睛，补丁盖住了中性的眼睛和闭眼层
    let open = rows(1.0, 1.0);
    assert!(open.0 >= 40 && open.1 == 0 && open.2 == 0, "{open:?}");
    // 快闭上：压扁的绿眼睛叠在闭眼层上
    let thin = rows(1.0, 0.1);
    assert!(thin.0 >= 3 && thin.0 < open.0 / 4 && thin.1 >= 20 && thin.2 == 0, "{thin:?}");
    // 合上：只有闭眼层
    let shut = rows(1.0, 0.0);
    assert!(shut.0 == 0 && shut.1 >= 40 && shut.2 == 0, "{shut:?}");
    // 表情关着：中性的眼睛照常
    let off = rows(0.0, 1.0);
    assert!(off.0 == 0 && off.1 == 0 && off.2 > 0, "{off:?}");
}
