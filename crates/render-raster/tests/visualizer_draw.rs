//! sound wave 的 DrawOp golden：10 款 × 5 个时刻的指令流指纹（设计 §11）。
//!
//! **输入沿用 `core/fixtures/visualizer/cases.json`**（P2 冻结，只可追加不可改）：
//! `sweep` 频谱 + `default` 参数组 + 五个时刻。本文件只追加输出侧的
//! `expected-draw.json`，比法与 motion 阶段 0 一致——**序列化文本逐字节比对**，
//! 不是 `Value` 相等（f64 的 1-ULP 差异必须红）。
//!
//! golden 另加一列 `samples`——折线类三个算法（`oscilloscope-v1` /
//! `spectrum-area-v1` / `ribbons-v1`）的采样密度是**冻结的配方常量**（设计 §7.2：
//! 这是它们能评 `strict` 的前提），它同时进 golden 的两个地方（显式一列 + 隐式
//! 决定 path 段数），改 manifest 这份文件必然红。
//!
//! ```bash
//! cd core
//! cargo test -p bcut-render --test visualizer_draw
//! cargo test -p bcut-render --test visualizer_draw -- --ignored   # 确认过再重生成
//! ```

use std::path::{Path, PathBuf};

use motion::preset_registry::{CatalogueRecipe, VisualizerAspect, timeline_visualizers};
use render_raster::drawop::{FrameBuilder, fingerprint};
use render_raster::source::visualizer::{VisualizerParams, VizBox, VizFrame, VizSource, VizTrack};
use render_raster::source::{VizParams, visualizer_frame};
use serde_json::{Value, json};

/// 与 `cases.json` 的 `instants` 逐字相同（设计 §8.7 冻结的五个时刻）。
const INSTANTS: [f64; 5] = [0.0, 0.1, 0.5, 1.0, 2.5];

/// 与 `cases.json` 的 `params[1]`（`"default"`）逐字相同。
const PARAMS: VizParams = VizParams {
    min_db: -80.0,
    max_db: 40.0,
    smoothing: 0.8,
    gain: 1.0,
};

/// 1080p 上的两只元素盒，直接来自 `bcut_timeline::geometry` 的默认几何表：
/// 横条类 `100% × 20%`、贴底（y 中心 85%）；正方类 `30% × 30%`、居中。
const CANVAS: (f64, f64) = (1920.0, 1080.0);

/// 折线类三个算法：它们的 `samples` 直接决定 path 段数。
const POLYLINE_ALGORITHMS: [&str; 3] = ["oscilloscope-v1", "spectrum-area-v1", "ribbons-v1"];

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/visualizer")
}

fn element_box(aspect: VisualizerAspect) -> VizBox {
    match aspect {
        VisualizerAspect::Free => VizBox {
            x: 0.0,
            y: CANVAS.1 * 0.85 - CANVAS.1 * 0.2 / 2.0,
            w: CANVAS.0,
            h: CANVAS.1 * 0.2,
        },
        VisualizerAspect::Square => VizBox {
            x: CANVAS.0 * 0.35,
            y: CANVAS.1 * 0.35,
            w: CANVAS.0 * 0.3,
            h: CANVAS.1 * 0.3,
        },
    }
}

/// 两个已解析好的颜色。刻意不用配方的 `defaultMainColor`——那样每种样式的
/// 颜色都不同，指纹变化时分不清是"配方改了色"还是"几何改了"。
fn params() -> VisualizerParams {
    VisualizerParams {
        main_color: [0.235_294_12, 0.678_431_4, 1.0, 1.0],
        secondary_color: [1.0, 1.0, 1.0, 1.0],
    }
}

fn track() -> VizTrack {
    // 生成端与消费端共用同一份夹具字节：`sweep-48k-mono.bcs1` 由
    // `visualizer_source.rs` 的 `write_visualizer_fixtures` 落盘并逐字节守门。
    let bytes = std::fs::read(fixture_dir().join("sweep-48k-mono.bcs1"))
        .expect("sweep-48k-mono.bcs1 缺失（先跑 visualizer_source 的 --ignored）");
    VizTrack::derive(&bytes, PARAMS).expect("派生 sweep 轨")
}

fn record(recipe: &CatalogueRecipe, viz: &VizFrame, time: f64) -> Value {
    let aspect = recipe.visualizer().expect("visualizer 配方").aspect;
    let mut builder = FrameBuilder::default();
    let pushed = visualizer_frame(
        &mut builder,
        recipe,
        &params(),
        viz,
        time,
        element_box(aspect),
        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    );
    let frame = builder.finish();
    assert_eq!(pushed, frame.ops.len(), "返回条数必须等于实际压入条数");
    json!({
        "ops": frame.ops.len(),
        "paths": frame.paths.len(),
        "fingerprint": format!("{:016x}", fingerprint(&frame)),
    })
}

fn expected_json() -> Value {
    let track = track();
    let silence = track.silent_frame();
    let styles = timeline_visualizers()
        .iter()
        .map(|recipe| {
            let samples = INSTANTS
                .iter()
                .map(|instant| {
                    let viz = track.sample(*instant).expect("轨非空");
                    // 时刻既是**取帧**的坐标，也是元素本地时刻：`ribbons-v1` 读后者。
                    let mut entry = record(recipe, viz, *instant);
                    entry["t"] = json!(instant);
                    entry
                })
                .collect::<Vec<_>>();
            let body = recipe.visualizer().unwrap();
            json!({
                "style": recipe.qualified_id(),
                "algorithm": body.recipe.algorithm.name(),
                "aspect": match body.aspect {
                    VisualizerAspect::Square => "square",
                    VisualizerAspect::Free => "free",
                },
                // 折线类独有；柱状 / 点阵 / 环类没有这一档，记 null。
                "samples": body.recipe.integer("samples"),
                "instants": samples,
                // 「静音仍有画面」：频域行全 0 时每款都还有指令（设计 §7.2）。
                "silence": record(recipe, &silence, 0.0),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "note": "DrawOp 指令流指纹（10 款全量：柱状 4 + 折线 3 + 点阵 1 + 环 1 + 丝带 1）。\
                 输入是 cases.json 的 sweep × default × 五时刻，元素盒取 bcut_timeline 几何默认表在 \
                 1920×1080 上的像素；时刻同时充当元素本地时钟，只有 ribbons 读它。\
                 samples 是折线类冻结的采样密度。",
        "canvas": [CANVAS.0, CANVAS.1],
        "spectrum": "sweep",
        "params": "default",
        "mainColor": "#3CADFF",
        "secondaryColor": "#FFFFFF",
        "styles": styles,
    })
}

fn pretty(value: &Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(value).expect("序列化夹具");
    bytes.push(b'\n');
    bytes
}

/// 重新生成 golden。确认过再跑：
/// `cargo test -p bcut-render --test visualizer_draw -- --ignored`
#[test]
#[ignore]
fn write_visualizer_draw_fixture() {
    std::fs::write(
        fixture_dir().join("expected-draw.json"),
        pretty(&expected_json()),
    )
    .unwrap();
}

/// 日常门禁：当场重算再**逐字节**比。
#[test]
fn the_draw_golden_is_up_to_date() {
    let path = fixture_dir().join("expected-draw.json");
    let actual = std::fs::read(&path)
        .unwrap_or_else(|e| panic!("expected-draw.json 缺失（跑 --ignored）：{e}"));
    assert_eq!(
        actual,
        pretty(&expected_json()),
        "expected-draw.json 与生成器不一致"
    );
}

/// **10 款全部真的画东西**，有声与静音都是：静音是每款的"静止形态"
/// （柱子留 `minHeight`、示波器留中线、点阵留底灯、环停在静止位、丝带收成中线），
/// 元素在片头 / 无声段不会从画布上消失。
#[test]
fn every_style_is_live_in_the_golden() {
    let golden = expected_json();
    assert_eq!(golden["styles"].as_array().unwrap().len(), 10);
    for style in golden["styles"].as_array().unwrap() {
        let id = style["style"].as_str().unwrap();
        for sample in style["instants"].as_array().unwrap() {
            let ops = sample["ops"].as_u64().unwrap();
            assert!(ops > 0, "{id} @ t={} 必须画出东西", sample["t"]);
        }
        assert!(
            style["silence"]["ops"].as_u64().unwrap() > 0,
            "{id} 静音时也必须画出东西"
        );
    }
}

/// **`samples` 守卫**：折线类三个算法的采样密度是冻结常量，改它必然改 golden。
///
/// 三条一起钉：① 四款 manifest 都声明了它；② golden 里那一列与注册表逐字相同
/// （改 manifest 不重生成 ⇒ `the_draw_golden_is_up_to_date` 红）；③ 指令流里
/// path 的段数确实由它决定，所以它也是**隐式**进 golden 指纹的——两条路都堵上。
///
/// 段数公式按算法：
/// - `oscilloscope-v1` 线性布局：`samples`（move + n−1 条 line）；极坐标布局
///   `samples + 1`（多一条 close）；
/// - `spectrum-area-v1`：面积 path `samples + 3`（折线 + 右下 + 左下 + close），
///   描边 path `samples`；
/// - `ribbons-v1`：每条丝带 `samples`。
#[test]
fn the_polyline_density_is_frozen_by_the_manifest() {
    let track = track();
    let mut seen = 0;
    for style in expected_json()["styles"].as_array().unwrap() {
        let id = style["style"].as_str().unwrap();
        let algorithm = style["algorithm"].as_str().unwrap();
        if !POLYLINE_ALGORITHMS.contains(&algorithm) {
            assert!(style["samples"].is_null(), "{id} 不该有采样密度");
            continue;
        }
        seen += 1;
        let bare = id.strip_prefix("visualizer.").unwrap();
        let recipe = motion::preset_registry::timeline_visualizer(bare).unwrap();
        let body = recipe.visualizer().unwrap();
        let declared = body.recipe.integer("samples").expect("折线类必填 samples") as usize;
        assert_eq!(style["samples"].as_u64().unwrap() as usize, declared);
        let mut builder = FrameBuilder::default();
        visualizer_frame(
            &mut builder,
            recipe,
            &params(),
            track.sample(INSTANTS[2]).unwrap(),
            INSTANTS[2],
            element_box(body.aspect),
            [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        );
        let frame = builder.finish();
        assert!(!frame.paths.is_empty(), "{id}");
        let allowed: &[usize] = match algorithm {
            "oscilloscope-v1" => match body.recipe.text("layout") {
                Some("polar") => &[declared + 1],
                _ => &[declared],
            },
            "spectrum-area-v1" => &[declared + 3, declared],
            _ => &[declared],
        };
        for path in &frame.paths {
            assert!(
                allowed.contains(&path.0.len()),
                "{id} 的 path 段数 {} 不在 {allowed:?} 里",
                path.0.len()
            );
        }
    }
    assert_eq!(
        seen, 4,
        "折线类恰好四款：oscilloscope、ring_wave、spectrum_area、ribbons"
    );
}

/// **乱序采样 == 顺序采样**在绘制层同样成立：源是纯查表，绘制是纯函数，
/// 因此同一时刻的指令流与访问顺序无关（ADR-E04 的可执行形式）。
#[test]
fn shuffled_drawing_equals_sorted_drawing() {
    let track = track();
    let recipe = motion::preset_registry::timeline_visualizer("bars").unwrap();
    let sorted: Vec<u64> = INSTANTS
        .iter()
        .map(|instant| {
            let mut builder = FrameBuilder::default();
            visualizer_frame(
                &mut builder,
                recipe,
                &params(),
                track.sample(*instant).unwrap(),
                *instant,
                element_box(VisualizerAspect::Free),
                [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            );
            fingerprint(&builder.finish())
        })
        .collect();
    // 固定置换（不是随机）：顺序变了、结果不变才有意义。
    let order = [3usize, 0, 4, 1, 2];
    let mut shuffled = vec![0u64; INSTANTS.len()];
    for index in order {
        let mut builder = FrameBuilder::default();
        visualizer_frame(
            &mut builder,
            recipe,
            &params(),
            track.sample(INSTANTS[index]).unwrap(),
            INSTANTS[index],
            element_box(VisualizerAspect::Free),
            [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        );
        shuffled[index] = fingerprint(&builder.finish());
    }
    assert_eq!(sorted, shuffled);
}
