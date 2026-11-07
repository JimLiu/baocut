//! 合成角色的端到端：程序画几张整块图层（后发、身体、脸、眼白与眼珠、三帧嘴、刘海、笑的表情），打成 zip，
//! 读包、按时刻出帧。不用任何第三方角色。

use std::sync::Arc;

use puppet::{ErrorKind, Package, Player, Puppet, Track};

const W: u32 = 256;
const H: u32 = 384;

fn png(w: u32, h: u32, f: impl Fn(f64, f64) -> [u8; 4]) -> Vec<u8> {
    let mut px = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            px.extend_from_slice(&f(f64::from(x) + 0.5, f64::from(y) + 0.5));
        }
    }
    let mut out = Vec::new();
    image::ImageEncoder::write_image(
        image::codecs::png::PngEncoder::new(&mut out),
        &px,
        w,
        h,
        image::ExtendedColorType::Rgba8,
    )
    .unwrap();
    out
}

/// 盒子里一个椭圆（边缘一像素软边）。
fn ellipse(w: u32, h: u32, rgb: [u8; 3]) -> Vec<u8> {
    let (rx, ry) = (f64::from(w) / 2.0 - 1.0, f64::from(h) / 2.0 - 1.0);
    png(w, h, |x, y| {
        let d = (((x - f64::from(w) / 2.0) / rx).powi(2) + ((y - f64::from(h) / 2.0) / ry).powi(2)).sqrt();
        let a = ((1.0 - d) * rx.min(ry)).clamp(0.0, 1.0);
        [rgb[0], rgb[1], rgb[2], (a * 255.0).round() as u8]
    })
}

fn crc32(b: &[u8]) -> u32 {
    let mut c = !0u32;
    for &x in b {
        c ^= u32::from(x);
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    !c
}

/// 不压缩的 zip（store）。
fn zip(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let (mut out, mut dir) = (Vec::new(), Vec::new());
    for (name, data) in files {
        let (crc, n, off) = (crc32(data), data.len() as u32, out.len() as u32);
        let head = |sig: u32, central: bool| {
            let mut h = sig.to_le_bytes().to_vec();
            if central {
                h.extend_from_slice(&20u16.to_le_bytes());
            }
            for v in [20u16, 0, 0, 0, 0] {
                h.extend_from_slice(&v.to_le_bytes());
            }
            for v in [crc, n, n] {
                h.extend_from_slice(&v.to_le_bytes());
            }
            h.extend_from_slice(&(name.len() as u16).to_le_bytes());
            h.extend_from_slice(&0u16.to_le_bytes());
            if central {
                for v in [0u16, 0, 0] {
                    h.extend_from_slice(&v.to_le_bytes());
                }
                h.extend_from_slice(&0u32.to_le_bytes());
                h.extend_from_slice(&off.to_le_bytes());
            }
            h.extend_from_slice(name.as_bytes());
            h
        };
        out.extend(head(0x0403_4b50, false));
        out.extend_from_slice(data);
        dir.extend(head(0x0201_4b50, true));
    }
    let (at, len, count) = (out.len() as u32, dir.len() as u32, files.len() as u16);
    out.extend(dir);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    for v in [0u16, 0, count, count] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&at.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

fn model() -> serde_json::Value {
    serde_json::json!({
        "format": "baocut-puppet", "version": 1, "name": "Synthetic", "canvas": [W, H],
        "profile": { "id": "anime_half", "facing": "front" },
        "anchors": {
            "head": { "cx": 128, "cy": 115, "rx": 55, "ry": 70 }, "face": [80, 60, 176, 182],
            "neck_y": 180, "top_y": 16, "bottom_y": 383, "hair_root_y": 40,
            "eyes": [[95, 110, 123, 126], [133, 110, 161, 126]],
            "jaw": { "top": 150, "chin": 182, "half": 2, "open": 4, "round": 3, "wide": 2 }
        },
        "expressions": [{ "id": "smile" }],
        "layers": [
            { "id": "back_hair", "texture": "textures/back_hair.png", "x": 48, "y": 16, "w": 160, "h": 200, "group": "hair_back" },
            { "id": "body", "texture": "textures/body.png", "x": 40, "y": 200, "w": 176, "h": 184, "group": "body" },
            { "id": "face", "texture": "textures/face.png", "x": 78, "y": 50, "w": 100, "h": 130, "group": "head" },
            { "id": "eye_L", "role": "eye_L", "texture": "textures/eye.png", "mask": "textures/eye.png", "x": 95, "y": 110, "w": 28, "h": 16, "group": "head" },
            { "id": "iris_L", "role": "iris_L", "clip": "eye_L", "texture": "textures/iris.png", "x": 102, "y": 109, "w": 14, "h": 18, "group": "head" },
            { "id": "eye_R", "role": "eye_R", "texture": "textures/eye.png", "mask": "textures/eye.png", "x": 133, "y": 110, "w": 28, "h": 16, "group": "head" },
            { "id": "iris_R", "role": "iris_R", "clip": "eye_R", "texture": "textures/iris.png", "x": 140, "y": 109, "w": 14, "h": 18, "group": "head" },
            { "id": "mouth", "role": "mouth", "texture": "textures/mouth_0.png", "x": 113, "y": 150, "w": 30, "h": 20, "group": "head",
              "pivot": [128, 152],
              "frames": ["textures/mouth_0.png", "textures/mouth_1.png", "textures/mouth_2.png"], "visemes": ["closed", "half", "open"] },
            { "id": "expr_smile", "role": "expr", "expression": "smile", "texture": "textures/smile.png", "x": 108, "y": 140, "w": 40, "h": 24, "group": "head" },
            { "id": "front_hair", "texture": "textures/front_hair.png", "x": 70, "y": 30, "w": 116, "h": 60, "group": "hair_front" }
        ]
    })
}

fn files(root: &str) -> Vec<(String, Vec<u8>)> {
    let mouth = |open: f64| {
        png(30, 20, move |x, y| {
            let ry = 1.5 + 7.0 * open;
            let d = (((x - 15.0) / 12.0).powi(2) + ((y - 6.0) / ry).powi(2)).sqrt();
            if d < 1.0 { [120, 30, 40, 255] } else { [0, 0, 0, 0] }
        })
    };
    let t = |n: &str| format!("{root}textures/{n}");
    vec![
        (format!("{root}model.json"), serde_json::to_vec(&model()).unwrap()),
        (t("back_hair.png"), ellipse(160, 200, [90, 60, 40])),
        // 身体的下边贴着画布底边：贴图的最后一行不透明
        (
            t("body.png"),
            png(176, 184, |x, _| {
                if (8.0..168.0).contains(&x) {
                    [60, 90, 160, 255]
                } else {
                    [0, 0, 0, 0]
                }
            }),
        ),
        (t("face.png"), ellipse(100, 130, [250, 220, 200])),
        (t("eye.png"), ellipse(28, 16, [255, 255, 255])),
        (t("iris.png"), ellipse(14, 18, [40, 60, 120])),
        (t("mouth_0.png"), mouth(0.0)),
        (t("mouth_1.png"), mouth(0.5)),
        (t("mouth_2.png"), mouth(1.0)),
        (t("smile.png"), ellipse(40, 24, [230, 120, 130])),
        (
            t("front_hair.png"),
            png(116, 60, |_, y| if y < 40.0 { [100, 70, 50, 255] } else { [0, 0, 0, 0] }),
        ),
    ]
}

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
    let mut p = Player::new(Puppet::new(&pkg).unwrap(), None, 1);
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
    let make = || Player::new(Puppet::new(&pkg).unwrap(), Some(talking()), 7);
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
fn the_track_moves_the_mouth_and_ends_in_idle() {
    let pkg = package();
    let mouth_px = |px: &[u8]| (74..80).map(|y| (58..70).filter(|&x| at(px, x, y)[0] < 160).count()).sum::<usize>();
    let open = track(serde_json::json!({
        "format": "baocut-puppet-track", "version": 1, "fps": 30, "duration": 1.0, "params": { "mouthOpen": [1.0] }
    }));
    let mut talk = Player::new(Puppet::new(&pkg).unwrap(), Some(open), 1);
    let mut idle = Player::new(Puppet::new(&pkg).unwrap(), None, 1);
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
