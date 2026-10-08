//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
//! v3：`program` 资产要 `bcut-compile`（不移植，架构设计 §13.6），本文件门在占位的
//! `program` feature 上，不编译。
#![cfg(feature = "program")]

//! `program` 元素的端到端语义（规范 §6.5.3）：模块图加载 → resolve → 录制期按
//! 帧表量化 → QuickJS 逐帧出 SVG → resvg 光栅化取像素。
//!
//! 夹具在 `core/fixtures/program/`：`frames.tsx` 把帧号编码进整幅底色
//! （r = frame % 256，g = frame / 256），于是取一个像素就能读回画的是第几帧。

use render_raster::drawop::DrawOp;
use render_raster::{
    FramePlanner, FrameRenderer, LoadedAssets, MediaStore, TextEngine, load_assets,
};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/program")
}

/// 帧号程序：16×8，`frames` 帧，帧率与文档相同；clip 从第 `start_frame` 个文档帧开始。
fn frames_doc(fps: f64, frames: u32, start_frame: u32, element: Value) -> Value {
    let start = f64::from(start_frame) / fps;
    let end = start + f64::from(frames) / fps + 1.0;
    json!({
        "meta": { "id": "pg", "width": 16, "height": 8, "fps": fps },
        "scenes": [ { "id": "a", "dur": end + 1.0, "desc": "程序元素" } ],
        "assets": { "prog": {
            "type": "program", "src": "frames.tsx", "export": "Frames",
            "width": 16, "height": 8, "fps": fps, "frames": frames
        } },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": start, "end": end, "element": element }
            ] }
        ]
    })
}

fn element(extra: Value) -> Value {
    let mut el = json!({
        "type": "program", "id": "p1", "src": "$assets.prog",
        "style": { "x": 0, "y": 0, "width": 16, "height": 8 }
    });
    for (k, v) in extra.as_object().unwrap() {
        el.as_object_mut().unwrap().insert(k.clone(), v.clone());
    }
    el
}

struct Harness {
    ir: scene_primitives::Ir,
    engine: TextEngine,
    renderer: FrameRenderer,
    media: MediaStore,
    planner: FramePlanner,
}

fn build(doc: Value) -> Harness {
    let assets = Arc::new(load_assets(&doc, &fixture_dir()).expect("load_assets"));
    build_with(doc, assets)
}

fn build_with(doc: Value, assets: Arc<LoadedAssets>) -> Harness {
    let lints = scene_primitives::lint::lint(&doc);
    let errors: Vec<String> = lints
        .iter()
        .filter(|d| d.severity == scene_primitives::lint::Severity::Error)
        .map(|d| format!("{} {} {}", d.rule, d.pointer, d.message))
        .collect();
    assert!(errors.is_empty(), "文档应当零 lint 错误：{errors:?}");

    let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
    resolver.set_host_inputs(assets.inputs.clone());
    let mut ir = resolver.resolve().unwrap();
    let mut engine = TextEngine::for_document(&assets.fonts);
    let renderer = FrameRenderer::new_with_assets(&mut ir, &mut engine, &assets).unwrap();
    let planner = FramePlanner::cpu_with_assets(&ir, &assets).unwrap();
    let media = MediaStore::new(assets, ir.fps);
    Harness {
        ir,
        engine,
        renderer,
        media,
        planner,
    }
}

impl Harness {
    /// 该时刻 `DrawMedia` 记录的源毫秒（= 帧起点）。
    fn media_ms(&mut self, t: f64) -> i64 {
        let frame = self.renderer.record(&self.ir, &mut self.engine, t);
        let hits: Vec<i64> = frame
            .ops
            .iter()
            .filter_map(|op| match op {
                DrawOp::DrawMedia { media_ms, .. } => Some(*media_ms),
                _ => None,
            })
            .collect();
        assert_eq!(hits.len(), 1, "t={t} 应恰有一个 DrawMedia");
        hits[0]
    }

    /// 走帧计划与 CPU 执行器（导出同一条路）取该时刻 (x, y) 的像素。
    fn pixel_at(&mut self, t: f64, x: u32, y: u32) -> (u8, u8, u8, u8) {
        let pm = self
            .planner
            .render(
                &self.renderer,
                &self.ir,
                &mut self.engine,
                &mut self.media,
                t,
            )
            .expect("渲染");
        let p = pm.pixel(x, y).unwrap();
        (p.red(), p.green(), p.blue(), p.alpha())
    }

    /// 读回 `frames.tsx` 画的帧号。
    fn drawn_frame(&mut self, t: f64) -> u32 {
        let (r, g, b, a) = self.pixel_at(t, 8, 4);
        assert_eq!((b, a), (7, 255), "t={t} 不是帧号程序的底色");
        u32::from(r) + 256 * u32::from(g)
    }

    /// 导出帧缓存的键：两帧键相同就会复用同一张画面。
    fn fingerprint(&mut self, t: f64) -> u64 {
        let plan = self
            .planner
            .plan(&self.renderer, &self.ir, &mut self.engine, t);
        plan.frame_fingerprints().expect("指纹").0
    }
}

fn starts(fps: f64, frames: u32) -> Vec<i64> {
    (0..=frames)
        .map(|k| (f64::from(k) * 1000.0 / fps).round() as i64)
        .collect()
}

/// 文档帧率与程序帧率相同时，片段内第 k 个文档帧画的就是程序第 k 帧——
/// 包括帧起点恰落在半毫秒上的帧率（48 fps 的第 3 帧是 62.5 ms）与不从 0 开始的 clip。
#[test]
fn document_frames_map_one_to_one_onto_program_frames() {
    for fps in [24.0, 25.0, 30000.0 / 1001.0, 30.0, 48.0, 60.0] {
        let frames = 40;
        for start_frame in [0, 7] {
            let mut h = build(frames_doc(fps, frames, start_frame, element(json!({}))));
            let table = starts(fps, frames);
            for k in 0..frames {
                let t = f64::from(start_frame + k) / fps;
                assert_eq!(
                    h.media_ms(t),
                    table[k as usize],
                    "fps={fps} start={start_frame} k={k}"
                );
                assert_eq!(h.drawn_frame(t), k, "fps={fps} start={start_frame} k={k}");
            }
        }
    }
}

/// 导出按帧计划指纹复用画面：相邻两帧的指纹必须不同，同一程序帧里的两个文档帧
/// （文档 60 fps、程序 30 fps）必须相同。
#[test]
fn the_export_frame_cache_keys_on_the_program_frame() {
    let mut doc = frames_doc(60.0, 30, 0, element(json!({})));
    doc["assets"]["prog"]["fps"] = json!(30.0);
    let mut h = build(doc);
    for k in 0..29u32 {
        let (a, b) = (f64::from(2 * k) / 60.0, f64::from(2 * k + 1) / 60.0);
        assert_eq!(h.fingerprint(a), h.fingerprint(b), "k={k} 同一程序帧");
        assert_eq!(h.drawn_frame(b), k);
        let next = f64::from(2 * k + 2) / 60.0;
        assert_ne!(h.fingerprint(a), h.fingerprint(next), "k={k} 相邻程序帧");
    }
}

/// `playbackRate` / `loop` 与视频、动图同一套公式。
#[test]
fn playback_rate_and_loop_fold_like_other_timed_media() {
    let fps = 30.0;
    // rate 2：文档第 f 帧画程序第 2f 帧；10 帧的程序默认循环。
    let mut h = build(frames_doc(
        fps,
        10,
        0,
        element(json!({ "playbackRate": 2.0 })),
    ));
    for f in 0..12u32 {
        assert_eq!(h.drawn_frame(f64::from(f) / fps), (2 * f) % 10, "f={f}");
    }
    // loop false：放完冻结在末帧。
    let mut h = build(frames_doc(fps, 10, 0, element(json!({ "loop": false }))));
    assert_eq!(h.drawn_frame(9.0 / fps), 9);
    assert_eq!(h.drawn_frame(25.0 / fps), 9);
}

fn sprite_doc(files: Value, props: Value) -> Value {
    json!({
        "meta": { "id": "sp", "width": 32, "height": 16, "fps": 30 },
        "scenes": [ { "id": "a", "dur": 1, "desc": "程序元素" } ],
        "assets": { "prog": {
            "type": "program", "src": "sprite.tsx", "export": "Sprite",
            "width": 32, "height": 16, "fps": 30, "frames": 30,
            "files": files, "props": props
        } },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": 0, "end": 1, "element": {
                    "type": "program", "id": "p1", "src": "$assets.prog",
                    "style": { "x": 0, "y": 0, "width": 32, "height": 16 }
                } }
            ] }
        ]
    })
}

/// 相对导入、`asset()` 取 `files` 里的 SVG、HTML 盒子三样都画出来。
#[test]
fn modules_files_and_html_boxes_render() {
    let mut h = build(sprite_doc(json!(["dot.svg"]), json!({})));
    assert_eq!(h.pixel_at(0.0, 4, 8), (0xe0, 0x20, 0x20, 255), "dot.svg");
    assert_eq!(h.pixel_at(0.0, 24, 8), (0xf0, 0xd0, 0x00, 255), "HTML 盒子");
}

/// `asset()` 引用了 `files` 之外的文件：加载期的首帧探测就报 `program-file-missing`，
/// 不去读盘（文件其实就在夹具目录里）。
#[test]
fn a_file_outside_files_is_reported_not_read() {
    let doc = sprite_doc(json!([]), json!({}));
    let Err(err) = load_assets(&doc, &fixture_dir()) else {
        panic!("应当报错");
    };
    let text = format!("{err:#}");
    assert!(text.starts_with("program-file-missing"), "{text}");
    assert!(
        text.contains("asset \"prog\"") && text.contains("dot.svg"),
        "{text}"
    );
}

/// `asset()` 的路径用 `..` 越出文档目录：只有求值时才知道，加载期的首帧探测报
/// `program-path-escape`（与 lint 对 `src` / `imports` / `files` 同一个码），消息点名路径与改法。
#[test]
fn an_asset_path_escaping_the_document_directory_is_program_path_escape() {
    let doc = sprite_doc(json!(["dot.svg"]), json!({ "src": "../program/dot.svg" }));
    let Err(err) = load_assets(&doc, &fixture_dir()) else {
        panic!("应当报错");
    };
    let text = format!("{err:#}");
    assert!(text.starts_with("program-path-escape: "), "{text}");
    for needle in [
        "asset \"prog\"",
        "asset()",
        "\"../program/dot.svg\"",
        "文档所在目录",
        "项目根",
    ] {
        assert!(text.contains(needle), "缺 {needle}：{text}");
    }
}

/// 运行时认得但画不出来的写法（这里是 `textShadow`）在加载期报
/// `program-degraded` warn，画面照常出。
#[test]
fn unsupported_styles_surface_as_degraded_warnings() {
    let doc = sprite_doc(json!(["dot.svg"]), json!({ "odd": true }));
    let assets = load_assets(&doc, &fixture_dir()).expect("load_assets");
    let degraded: Vec<&str> = assets
        .source_diagnostics
        .iter()
        .filter(|d| d.rule == "program-degraded")
        .map(|d| d.message.as_str())
        .collect();
    assert_eq!(degraded.len(), 1, "{degraded:?}");
    assert!(
        degraded[0].contains("asset \"prog\"") && degraded[0].contains("textShadow"),
        "{degraded:?}"
    );

    let clean = load_assets(&sprite_doc(json!(["dot.svg"]), json!({})), &fixture_dir()).unwrap();
    assert!(clean.source_diagnostics.is_empty());
}

/// `backdrop.tsx` 里的一个导出，整幅画在 `width`×`height` 上。
fn backdrop_doc(export: &str, width: u32, height: u32) -> Value {
    json!({
        "meta": { "id": "bd", "width": width, "height": height, "fps": 30 },
        "scenes": [ { "id": "a", "dur": 1, "desc": "程序元素" } ],
        "assets": { "prog": {
            "type": "program", "src": "backdrop.tsx", "export": export,
            "width": width, "height": height, "fps": 30, "frames": 30
        } },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": 0, "end": 1, "element": {
                    "type": "program", "id": "p1", "src": "$assets.prog",
                    "style": { "x": 0, "y": 0, "width": width, "height": height }
                } }
            ] }
        ]
    })
}

/// `backdropFilter` 把盒子后面已经画好的东西（嵌在 flex、transform 与 overflow:hidden 里也一样）
/// 糊掉，只在盒子里；父级 `opacity < 1` 是 backdrop root，盒子只看得到父级里先画的东西。
#[test]
fn backdrop_filter_blurs_what_is_behind_inside_its_root() {
    let mut h = build(backdrop_doc("Backdrop", 64, 32));
    let white = (255, 255, 255, 255);
    let black = (0, 0, 0, 255);
    // 盒子（8..24）外：条纹原样
    assert_eq!(h.pixel_at(0.0, 2, 16), white);
    assert_eq!(h.pixel_at(0.0, 3, 16), black);
    assert_eq!(h.pixel_at(0.0, 16, 4), white);
    // 盒子里：条纹抹成均匀的灰
    let inside: Vec<u8> = (10..22).map(|x| h.pixel_at(0.0, x, 16).0).collect();
    let lo = *inside.iter().min().unwrap();
    let hi = *inside.iter().max().unwrap();
    assert!(
        hi - lo < 24 && lo > 90 && hi < 170,
        "盒子里应是灰：{inside:?}"
    );
    // 右半：父级自成 backdrop root，里面在盒子之前没有画任何东西，条纹不糊
    assert_eq!(h.pixel_at(0.0, 40, 16), white);
    assert_eq!(h.pixel_at(0.0, 41, 16), black);
    assert!(h.planner.report().diagnostics.is_empty());
}

/// flex 里只写了 `width` / `height` 属性的 `<svg>` 按这个固有尺寸参与排布（居中）。
#[test]
fn flex_items_use_the_intrinsic_size_of_svg() {
    let mut h = build(backdrop_doc("FlexIcon", 88, 88));
    let red = (0xe0, 0x20, 0x20, 255);
    let bg = (0x20, 0x30, 0x40, 255);
    assert_eq!(h.pixel_at(0.0, 44, 44), red);
    assert_eq!(h.pixel_at(0.0, 21, 44), red);
    assert_eq!(h.pixel_at(0.0, 67, 44), red);
    assert_eq!(h.pixel_at(0.0, 17, 44), bg);
    assert_eq!(h.pixel_at(0.0, 71, 44), bg);
    assert_eq!(h.pixel_at(0.0, 44, 17), bg);
}

/// 加载期只试渲首帧；后段帧才碰到的降级写法与缺字形在渲染后由
/// `render_diagnostics` 交出，带最早出现的帧号，不和加载期的重复。
#[test]
fn warnings_after_the_first_frame_are_reported_after_rendering() {
    let doc = backdrop_doc("Late", 16, 16);
    let assets = Arc::new(load_assets(&doc, &fixture_dir()).expect("load_assets"));
    assert!(
        assets.source_diagnostics.is_empty(),
        "{:?}",
        assets.source_diagnostics
    );
    assert!(assets.render_diagnostics().is_empty());

    let mut h = build_with(doc, assets.clone());
    h.pixel_at(10.0 / 30.0, 0, 0);
    h.pixel_at(7.0 / 30.0, 0, 0);
    h.pixel_at(0.0, 0, 0);
    let late = assets.render_diagnostics();
    let messages: Vec<&str> = late.iter().map(|d| d.message.as_str()).collect();
    assert!(
        late.iter().all(|d| d.rule == "program-degraded"),
        "{messages:?}"
    );
    assert_eq!(late.len(), 2, "{messages:?}");
    assert!(
        messages
            .iter()
            .any(|m| m.contains("textShadow") && m.contains("第 7 帧起")),
        "{messages:?}"
    );
    assert!(
        messages
            .iter()
            .any(|m| m.contains("U+10FFFD") && m.contains("第 7 帧起")),
        "{messages:?}"
    );
}

/// `probes.tsx` 里的一个导出，整幅画在 48×24 上。
fn probes_doc(export: &str) -> Value {
    let mut doc = backdrop_doc(export, 48, 24);
    doc["assets"]["prog"]["src"] = json!("probes.tsx");
    doc
}

fn degraded_messages(assets: &LoadedAssets) -> Vec<String> {
    assets
        .source_diagnostics
        .iter()
        .filter(|d| d.rule == "program-degraded")
        .map(|d| d.message.clone())
        .collect()
}

/// 组件改写模块顶层的可变状态：加载期把首帧求值两次，画出的不一样就报
/// `program-degraded`；只读的顶层常量表不报。
#[test]
fn module_state_that_changes_across_evaluations_is_reported() {
    let stateful = load_assets(&probes_doc("Stateful"), &fixture_dir()).expect("load_assets");
    let messages = degraded_messages(&stateful);
    assert_eq!(messages.len(), 1, "{messages:?}");
    assert!(messages[0].contains("模块顶层"), "{messages:?}");

    let pure = load_assets(&probes_doc("Pure"), &fixture_dir()).expect("load_assets");
    assert!(
        pure.source_diagnostics.is_empty(),
        "{:?}",
        pure.source_diagnostics
    );
}

/// 字体库里没有的字族（这里名字里带「24pt」，运行时要给它加引号才是合法的 CSS）：
/// 文字落到缺省无衬线字体照样画出来，并报 `program-degraded` 点名这个字族。
#[test]
fn an_unknown_font_family_falls_back_and_is_reported() {
    let assets =
        Arc::new(load_assets(&probes_doc("UnknownFamily"), &fixture_dir()).expect("load_assets"));
    let messages = degraded_messages(&assets);
    assert_eq!(messages.len(), 1, "{messages:?}");
    assert!(messages[0].contains("「Nope 24pt」"), "{messages:?}");

    let mut h = build_with(probes_doc("UnknownFamily"), assets);
    let pm = h
        .planner
        .render(&h.renderer, &h.ir, &mut h.engine, &mut h.media, 0.0)
        .expect("渲染");
    let lit = pm.pixels().iter().filter(|p| p.red() > 128).count();
    assert!(lit > 40, "文字应当画出来，亮像素只有 {lit} 个");
}
