//! 把一个角色包按一组固定姿势画成一张拼图，开发时看角色包能不能用：静止、左右转头、抬头低头、歪头、闭眼、
//! 看左看右、各帧嘴（半张、张开、圆嘴、扁嘴）、表情（缺省 `smile`）、带着表情快闭上眼与闭眼、挑眉、转头说话，
//! 最后是带着表情转头与转头说话（表情补丁、重画的眉毛和眼镜错开时露出的缝在这两格看）。每格先按姿势的参数走 1.2 秒
//! 物理，弹簧停稳再画。
//!
//!   cargo run -p puppet --release --example pose-sheet -- <角色包 .bcpuppet / .mavatar 或解开的目录> <out.png> [格子高度] [表情]
//!
//! mesh-avatar 角色（`.mavatar`）走播放器：每格是一条一直保持这个姿势的动作轨，画第 1.2 秒。
//!
//! 格子从左到右、从上到下依次是 `POSES` 的顺序，终端里打印一遍。

use std::path::Path;
use std::sync::Arc;

use puppet::{Character, CharacterPackage, Package, Params, Player, Puppet, TICK, Track};

/// 姿势里这个键是表情的权重，表情由命令行给
const EXPR: &str = "expr";

const POSES: &[(&str, &[(&str, f64)])] = &[
    ("rest", &[]),
    ("turn-left", &[("angleX", -25.0)]),
    ("turn-right", &[("angleX", 25.0)]),
    ("look-up", &[("angleY", 20.0)]),
    ("look-down", &[("angleY", -20.0)]),
    ("tilt", &[("angleZ", 18.0)]),
    ("blink", &[("eyeLOpen", 0.0), ("eyeROpen", 0.0)]),
    ("gaze-left", &[("eyeBallX", -1.0)]),
    ("gaze-right", &[("eyeBallX", 1.0)]),
    ("mouth-half", &[("mouthOpen", 0.3)]),
    ("mouth-open", &[("mouthOpen", 0.9)]),
    ("mouth-round", &[("mouthOpen", 0.9), ("vowel", -1.0)]),
    ("mouth-wide", &[("mouthOpen", 0.9), ("vowel", 1.0)]),
    ("expr", &[(EXPR, 1.0)]),
    ("expr-closing", &[(EXPR, 1.0), ("eyeLOpen", 0.15), ("eyeROpen", 0.15)]),
    ("expr-blink", &[(EXPR, 1.0), ("eyeLOpen", 0.0), ("eyeROpen", 0.0)]),
    ("brows-up", &[("browLY", 1.0), ("browRY", 1.0)]),
    ("turn-talk", &[("angleX", 20.0), ("angleY", -10.0), ("mouthOpen", 0.9), ("bodyX", 6.0)]),
    ("expr-turn-left", &[(EXPR, 1.0), ("angleX", -25.0)]),
    ("expr-turn-talk", &[(EXPR, 1.0), ("angleX", 20.0), ("angleY", -10.0), ("mouthOpen", 0.9), ("bodyX", 6.0)]),
];

fn load(path: &Path) -> CharacterPackage {
    if path.is_dir() {
        let model = std::fs::read(path.join("model.json")).expect("read model.json");
        Package::from_files(&model, |name| Ok(std::fs::read(path.join(name)).ok())).expect("read the package folder").into()
    } else {
        CharacterPackage::from_zip(&std::fs::read(path).expect("read the package")).expect("read the package")
    }
}

/// 一直保持一个姿势的动作轨：没给的参数取中性（眼睛睁开），不交给待机。
fn held(params: &[(&str, f64)], expr: &str) -> Arc<Track> {
    let mut p = serde_json::Map::new();
    for name in Params::NAMES.iter().filter(|n| !n.starts_with("move") && **n != "breath") {
        let rest = if name.ends_with("Open") && *name != "mouthOpen" { 1.0 } else { 0.0 };
        let v = params.iter().find(|(k, _)| k == name).map_or(rest, |(_, v)| *v);
        p.insert(name.to_string(), serde_json::json!([v, v]));
    }
    let mut e = serde_json::Map::new();
    if let Some((_, v)) = params.iter().find(|(k, _)| *k == EXPR) {
        e.insert(expr.to_string(), serde_json::json!([v, v]));
    }
    let json = serde_json::json!({
        "format": "baocut-puppet-track", "version": 1, "fps": 1, "duration": 2.0, "params": p, "expressions": e
    });
    Arc::new(Track::parse(&serde_json::to_vec(&json).unwrap()).expect("a valid track"))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [src, out, rest @ ..] = args.as_slice() else {
        eprintln!("usage: pose-sheet <package.bcpuppet | folder> <out.png> [cell height] [expression]");
        std::process::exit(2);
    };
    let package = load(Path::new(src));
    let [mw, mh] = package.canvas();
    let ch: u32 = rest.first().and_then(|v| v.parse().ok()).unwrap_or(384);
    let expr = rest.get(1).map_or("smile", String::as_str);
    let cw = ((f64::from(mw) / f64::from(mh)) * f64::from(ch)).round().max(1.0) as u32;
    let cols = 4u32;
    let rows = (POSES.len() as u32).div_ceil(cols);
    let mut sheet = image::RgbaImage::from_pixel(cols * cw, rows * ch, image::Rgba([96, 96, 104, 255]));
    let mut cell = vec![0u8; (cw * ch * 4) as usize];
    let mut layered = match &package {
        CharacterPackage::Layered(p) => Some(Puppet::new(p).expect("build the rig")),
        CharacterPackage::Mesh(_) => None,
    };
    for (k, (name, params)) in POSES.iter().enumerate() {
        let Some(puppet) = layered.as_mut() else {
            let rig = Character::new(&package).expect("build the rig");
            Player::new(rig, Some(held(params, expr)), 1, 0.0).render(1.2, cw, ch, &mut cell);
            paste(&mut sheet, &cell, k as u32, cols, cw, ch);
            println!("{k:2} {}", name.replace(EXPR, expr));
            continue;
        };
        puppet.reset();
        let mut p = Params::default();
        for (key, v) in params.iter().filter(|(key, _)| *key != EXPR) {
            p.set(Params::index(key).expect("known parameter"), *v);
        }
        puppet.params = p;
        if let Some((_, v)) = params.iter().find(|(key, _)| *key == EXPR) {
            puppet.set_expression(expr, *v);
        }
        for _ in 0..(1.2 / TICK) as usize {
            puppet.update(TICK, false);
        }
        puppet.update(0.0, true);
        puppet.render(cw, ch, &mut cell);
        paste(&mut sheet, &cell, k as u32, cols, cw, ch);
        println!("{k:2} {}", name.replace(EXPR, expr));
    }
    sheet.save(out).expect("write the sheet");
    println!("{}x{} cells of {cw}x{ch} -> {out}", cols, rows);
}

/// 第 `k` 格（预乘的像素叠到底色上）。
fn paste(sheet: &mut image::RgbaImage, cell: &[u8], k: u32, cols: u32, cw: u32, ch: u32) {
    let (x0, y0) = ((k % cols) * cw, (k / cols) * ch);
    for y in 0..ch {
        for x in 0..cw {
            let i = ((y * cw + x) * 4) as usize;
            let a = u32::from(cell[i + 3]);
            let bg = sheet.get_pixel(x0 + x, y0 + y).0;
            let px = [0, 1, 2].map(|c| (u32::from(cell[i + c]) + u32::from(bg[c]) * (255 - a) / 255).min(255) as u8);
            sheet.put_pixel(x0 + x, y0 + y, image::Rgba([px[0], px[1], px[2], 255]));
        }
    }
}
