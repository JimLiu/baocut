#![cfg(feature = "media")]
use render_raster::{CapabilityProfile, MediaStore, PreparedBcf, TextEngine, load_assets};
use scene_primitives::Resolver;
use serde_json::json;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Arc;

#[test]
fn ordinary_alpha_video_matches_synchronized_foreground_and_luma_matte() {
    let Some(ffmpeg) = render_raster::exec::find_executable("ffmpeg") else {
        eprintln!("skip: ffmpeg unavailable for alpha fixture");
        return;
    };
    let root = std::env::temp_dir().join(format!("bcf-alpha-contract-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    for kind in ["alpha", "color", "mask"] {
        let path = root.join(format!("{kind}.mov"));
        let mut child = Command::new(&ffmpeg)
            .args([
                "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "32x24", "-r",
                "8", "-i", "-", "-an", "-c:v", "qtrle",
            ])
            .arg(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut input = child.stdin.take().unwrap();
        for f in 0..6 {
            let mut bytes = Vec::new();
            for y in 0i32..24 {
                for x in 0i32..32 {
                    let d = (x - (8 + f * 2)).pow(2) + (y - 12).pow(2);
                    let a = if d <= 25 {
                        255
                    } else if d <= 36 {
                        128
                    } else {
                        0
                    };
                    let pixel = match kind {
                        "alpha" => [200, 80, 40, a],
                        "mask" => [a, a, a, 255],
                        _ => [200, 80, 40, 255],
                    };
                    bytes.extend_from_slice(&pixel);
                }
            }
            input.write_all(&bytes).unwrap();
        }
        drop(input);
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let make = |masked| {
        let element = if masked {
            json!({"type":"box","children":[
                {"type":"video","id":"fg","src":"$assets.color","style":{"width":32,"height":24,"mask":{"source":"#matte","mode":"luma"}}},
                {"type":"video","id":"matte","src":"$assets.mask","style":{"width":32,"height":24}}
            ]})
        } else {
            json!({"type":"video","src":"$assets.alpha","style":{"width":32,"height":24}})
        };
        json!({"bcut":"0.2","meta":{"width":32,"height":24,"fps":8,"background":"rgba(0,0,0,0)"},
            "assets":{"alpha":{"type":"video","src":"alpha.mov"},"color":{"type":"video","src":"color.mov"},"mask":{"type":"video","src":"mask.mov"}},
            "scenes":[{"id":"s","dur":1}],"tracks":[{"id":"v","kind":"visual","clips":[{"id":"c","start":0,"end":1,
                "element":{"type":"composition","canvas":{"width":32,"height":24,"duration":0.75},"timeMap":[{"t":0,"source":0},{"t":0.5,"source":0.5},{"t":1,"source":0.5}],"children":[element]}}]}]})
    };
    let mut sessions = Vec::new();
    for masked in [false, true] {
        let doc = make(masked);
        let assets = Arc::new(load_assets(&doc, &root).unwrap());
        let mut resolver = Resolver::new(doc, None).unwrap();
        resolver.set_host_inputs(assets.inputs.clone());
        let runtime = PreparedBcf::new(
            resolver.resolve().unwrap(),
            TextEngine::with_document_fonts(&[]),
            &Default::default(),
            CapabilityProfile::cpu_reference(),
        )
        .unwrap();
        let mut media = MediaStore::new(assets, 8.0);
        media.set_random_access(true);
        sessions.push((runtime, media));
    }
    for t in [0.0, 0.25, 0.5, 0.9, 0.125, 0.25] {
        let (r, a) = &mut sessions[0];
        let direct = r.render_cpu(t, a).unwrap();
        let (r, b) = &mut sessions[1];
        let masked = r.render_cpu(t, b).unwrap();
        assert_eq!(direct.data(), masked.data(), "t={t}");
        assert_eq!(direct.pixel(0, 0).unwrap().alpha(), 0);
        assert!(direct.pixels().iter().any(|p| p.alpha() == 128));
        assert!(
            direct
                .pixels()
                .iter()
                .all(|p| p.red() <= p.alpha() && p.green() <= p.alpha() && p.blue() <= p.alpha())
        );
    }
    eprintln!(
        "alpha decoder: {:?}; foreground decoder: {:?}; matte decoder: {:?}",
        sessions[0].1.video_backend("alpha"),
        sessions[1].1.video_backend("color"),
        sessions[1].1.video_backend("mask")
    );
    drop(sessions);
    std::fs::remove_dir_all(root).unwrap();
}
