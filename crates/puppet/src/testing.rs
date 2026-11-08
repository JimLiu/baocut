//! 测试用的合成角色（不用任何第三方角色）：程序画几张整块图层（后发、身体、脸、眼白与眼珠、三帧嘴、刘海、笑的
//! 表情），打成不压缩的 zip。本 crate 与引擎、渲染、导出的测试共用；产品代码不用它。

pub const W: u32 = 256;
pub const H: u32 = 384;

pub fn png(w: u32, h: u32, f: impl Fn(f64, f64) -> [u8; 4]) -> Vec<u8> {
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
pub fn ellipse(w: u32, h: u32, rgb: [u8; 3]) -> Vec<u8> {
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
pub fn zip(files: &[(String, Vec<u8>)]) -> Vec<u8> {
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

pub fn model() -> serde_json::Value {
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

pub fn files(root: &str) -> Vec<(String, Vec<u8>)> {
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

/// 整个角色包（`.bcpuppet` 的字节）。
pub fn package_zip() -> Vec<u8> {
    zip(&files(""))
}

/// 一份动作轨 JSON：`duration` 秒、30 帧每秒，嘴每 0.2 秒开合一次，头左右转。
pub fn talking_track(duration: f64) -> Vec<u8> {
    let n = (duration * 30.0).ceil() as usize + 1;
    let mouth: Vec<f64> = (0..n).map(|i| if (i / 6) % 2 == 1 { 0.9 } else { 0.0 }).collect();
    let turn: Vec<f64> = (0..n).map(|i| 20.0 * (i as f64 / 10.0).sin()).collect();
    serde_json::to_vec(&serde_json::json!({
        "format": "baocut-puppet-track", "version": 1, "fps": 30, "duration": duration,
        "params": { "mouthOpen": mouth, "angleX": turn }
    }))
    .expect("json")
}

/// mesh-avatar 的合成角色（格式规范 §2.5）：清单、rig 与层的位置取 mesh-avatar-core 的测试角色（BaoCut 自己生成的
/// xiaoli），贴图是程序画的色块，按 `.mavatar` 的目录排好（打包用 [`zip`]）。
pub fn mesh_avatar_files() -> Vec<(String, Vec<u8>)> {
    const AVATAR: &[u8] = include_bytes!("../../mesh-avatar-core/tests/fixtures/xiaoli/avatar.json");
    const RIG: &[u8] = include_bytes!("../../mesh-avatar-core/tests/fixtures/xiaoli/rig.json");
    const LAYERS: &[u8] = include_bytes!("../../mesh-avatar-core/tests/fixtures/xiaoli/built/layers.json");
    const SPRITES: &[u8] = include_bytes!("../../mesh-avatar-core/tests/fixtures/xiaoli/built/sprites/sprites.json");
    let rects = |json: &[u8], prefix: &str| -> Vec<(String, [u32; 4])> {
        let v: serde_json::Value = serde_json::from_slice(json).expect("fixture json");
        v["layers"]
            .as_object()
            .expect("fixture layers")
            .iter()
            .map(|(k, r)| {
                let r: Vec<u32> = r.as_array().unwrap().iter().map(|n| n.as_u64().unwrap() as u32).collect();
                (format!("{prefix}{k}"), [r[0], r[1], r[2], r[3]])
            })
            .collect()
    };
    let size: serde_json::Value = serde_json::from_slice(LAYERS).expect("fixture json");
    let (w, h) = (size["size"][0].as_u64().unwrap() as u32, size["size"][1].as_u64().unwrap() as u32);
    let mut files = vec![
        ("avatar.json".to_string(), AVATAR.to_vec()),
        ("rig.json".to_string(), RIG.to_vec()),
        ("built/layers.json".to_string(), LAYERS.to_vec()),
        ("built/sprites/sprites.json".to_string(), SPRITES.to_vec()),
    ];
    // 底图：上半是头发色、下半是皮肤色的渐变（转头看得出来）；头发遮罩取红通道，上 40% 是头发
    files.push((
        "built/base.png".to_string(),
        png(w, h, |x, y| {
            let t = y / f64::from(h);
            let k = (x / f64::from(w) * 60.0) as u8;
            if t < 0.4 { [90 + k, 60, 50, 255] } else { [240, 205 - k / 2, 185, 255] }
        }),
    ));
    files.push((
        "built/hairmask.png".to_string(),
        png(w, h, |_, y| if y < f64::from(h) * 0.4 { [255, 0, 0, 255] } else { [0, 0, 0, 255] }),
    ));
    for (name, [_, _, lw, lh]) in rects(LAYERS, "").into_iter().chain(rects(SPRITES, "sprites/")) {
        let rgb = match name.as_str() {
            n if n.ends_with("_ball") => [40, 60, 120],
            n if n.ends_with("_lash") || n.contains("closed") => [30, 20, 20],
            n if n.contains("mouth") => [150, 40, 50],
            n if n.contains("smile") => [200, 120, 90],
            _ => [210, 170, 150],
        };
        files.push((format!("built/{name}.png"), ellipse(lw, lh, rgb)));
    }
    files
}
