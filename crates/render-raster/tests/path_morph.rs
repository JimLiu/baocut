#![cfg(feature = "media")]

//! `pathMorph` 通道 + `path.morphTo`（规范 §6.2.1 / §6.4）：形状序列 `[d, morphTo…]` 上的分段线性
//! 逐顶点插值；填充、描边与 `pathDraw` 的长度口径都跟着插值后的形状走；拓扑不等是硬错误。

use render_raster::drawop::encode;
use render_raster::plan::{CapabilityProfile, CpuExecutor, FramePlanner, execute_plan};
use render_raster::{FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use scene_primitives::resolve::{Ir, Resolver};
use serde_json::{Value, json};
use std::sync::Arc;

const W: u32 = 240;

fn doc(path: Value) -> Value {
    json!({
        "bcut": "0.1",
        "meta": {"id": "morph", "width": 240, "height": 160, "fps": 60, "background": "#ffffff"},
        "scenes": [{"id": "s", "dur": 4}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end", "element": {
                "type": "svg", "id": "art", "viewBox": "0 0 240 160",
                "style": {"width": 240, "height": 160},
                "children": [path]
            }}
        ]}]
    })
}

struct Stage {
    ir: Ir,
    engine: TextEngine,
    renderer: FrameRenderer,
}

impl Stage {
    fn new(doc: Value) -> Stage {
        let mut ir = Resolver::new(doc, None).unwrap().resolve().unwrap();
        let mut engine = TextEngine::new();
        let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
        Stage {
            ir,
            engine,
            renderer,
        }
    }

    fn bytes(&mut self, t: f64) -> Vec<u8> {
        encode(&self.renderer.record(&self.ir, &mut self.engine, t))
    }

    fn pixels(&mut self, t: f64) -> Vec<u8> {
        let planner = FramePlanner::cpu(&self.ir).unwrap();
        let plan = planner.plan(&self.renderer, &self.ir, &mut self.engine, t);
        plan.validate().unwrap();
        let mut executor = CpuExecutor::new(CapabilityProfile::cpu_reference());
        let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), self.ir.fps);
        execute_plan(&plan, &mut executor, &mut media, None)
            .unwrap()
            .data()
            .to_vec()
    }
}

fn px(data: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * W + x) * 4) as usize;
    [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

const WHITE: [u8; 4] = [255, 255, 255, 255];
const BLUE: [u8; 4] = [0, 0, 255, 255];

// 左方块 → 右方块 → 下方的扁条：三个同拓扑形状
const LEFT: &str = "M20 20 L80 20 L80 80 L20 80 Z";
const RIGHT: &str = "M160 20 L220 20 L220 80 L160 80 Z";
const LOW: &str = "M160 120 L220 120 L220 150 L160 150 Z";

fn morphing(frames: Value) -> Value {
    json!({
        "type": "path", "id": "p", "d": LEFT, "morphTo": [RIGHT, LOW], "fill": "#0000ff",
        "animate": {"keyframes": [{"prop": "pathMorph", "frames": frames}]}
    })
}

#[test]
fn morph_walks_the_shape_sequence_piecewise() {
    let mut stage = Stage::new(doc(morphing(
        json!([{"t": 0, "v": 0}, {"t": 2, "v": 1}, {"t": 4, "v": 2}]),
    )));
    let at0 = stage.pixels(0.0);
    assert_eq!(px(&at0, 50, 50), BLUE, "v=0：原形状");
    assert_eq!(px(&at0, 190, 50), WHITE);

    let half = stage.pixels(1.0);
    assert_eq!(px(&half, 120, 50), BLUE, "v=0.5：方块走到正中");
    assert_eq!(px(&half, 50, 50), WHITE);

    let at1 = stage.pixels(2.0);
    assert_eq!(px(&at1, 190, 50), BLUE, "v=1：第一个目标");

    let late = stage.pixels(3.999);
    assert_eq!(px(&late, 190, 135), BLUE, "v→2：第二个目标");
    assert_eq!(px(&late, 190, 50), WHITE);
}

#[test]
fn morph_value_is_clamped_to_the_target_count() {
    let mut stage = Stage::new(doc(morphing(json!([{"t": 0, "v": 9}, {"t": 4, "v": 9}]))));
    assert_eq!(px(&stage.pixels(1.0), 190, 135), BLUE);
}

#[test]
fn without_the_channel_a_morph_to_path_records_identically() {
    let plain = json!({"type": "path", "id": "p", "d": LEFT, "fill": "#0000ff"});
    let mut with_targets = plain.clone();
    with_targets["morphTo"] = json!(RIGHT);
    assert_eq!(
        Stage::new(doc(plain)).bytes(1.0),
        Stage::new(doc(with_targets)).bytes(1.0),
        "只声明 morphTo、不写通道：逐字节等于普通 path"
    );
}

#[test]
fn path_draw_measures_the_morphed_outline() {
    // 短横线 morph 成长横线；pathDraw 0.5 应画到**当前形状**的一半
    let mut stage = Stage::new(doc(json!({
        "type": "path", "id": "p", "d": "M20 80 L60 80", "morphTo": "M20 80 L220 80",
        "stroke": "#0000ff", "strokeWidth": 8, "lineCap": "butt",
        "animate": {"keyframes": [
            {"prop": "pathMorph", "frames": [{"t": 0, "v": 1}, {"t": 4, "v": 1}]},
            {"prop": "pathDraw", "frames": [{"t": 0, "v": 0.5}, {"t": 4, "v": 0.5}]}
        ]}
    })));
    let data = stage.pixels(1.0);
    assert_eq!(px(&data, 100, 80), BLUE, "长线的前半段");
    assert_eq!(px(&data, 140, 80), WHITE, "后半段还没画到");
}

#[test]
fn topology_mismatch_is_a_hard_error() {
    let bad =
        json!({"type": "path", "id": "p", "d": LEFT, "morphTo": "M0 0 L10 10", "fill": "#000"});
    let error = match Resolver::new(doc(bad), None).and_then(|mut r| r.resolve()) {
        Ok(_) => panic!("拓扑不等应当报错"),
        Err(error) => error.to_string(),
    };
    assert!(error.contains("path-morph-topology"), "{error}");
}
