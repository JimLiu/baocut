//! progress 的 DrawOp golden：14 种样式 × 5 个（进度, 时刻）（设计 §11）。
//!
//! progress **没有素材源**，输入只有 `(progress, 元素盒, 两个颜色)`，因此夹具
//! 自带一份 `cases.json`（与 `core/fixtures/visualizer/cases.json` 平级、互不引用）。
//! 比法同样是**序列化文本逐字节比对**。
//!
//! ```bash
//! cd core
//! cargo test -p bcut-render --test progress_draw
//! cargo test -p bcut-render --test progress_draw -- --ignored   # 确认过再重生成
//! ```

use std::path::{Path, PathBuf};

use motion::preset_registry::{CatalogueRecipe, ProgressAspect, timeline_progresses};
use render_raster::drawop::{FrameBuilder, fingerprint};
use render_raster::source::progress::ProgressBox;
use render_raster::source::{ProgressParams, progress_frame};
use serde_json::{Value, json};

/// 端点必须精确（`progress(t)` 在 `[start, end]` 上单调、端点恰好 0/1，§11）。
const STEPS: [f64; 5] = [0.0, 0.25, 0.5, 0.75, 1.0];

/// 与 `STEPS` 一一配对的**元素本地时刻**（秒，P4 追加）。
///
/// P3 的六种与时刻无关，加这一列不会动它们的指纹；`snake_spin` 的自转相位读它。
/// 刻意取 3 秒长的元素上的五个整齐时刻（`0.75 s` 一步 ⇒ 50 °/s 下每步转 37.5°），
/// 而不是 `progress × 7.2 s`——那样"一整圈"会正好抵消掉自转，测了等于没测。
const TIMES: [f64; 5] = [0.0, 0.75, 1.5, 2.25, 3.0];

const CANVAS: (f64, f64) = (1920.0, 1080.0);

/// 参考短边 540 → 1080p 的折算系数（`short_edge / REFERENCE_SHORT_EDGE`）。
/// 真相在 `bcut_timeline::REFERENCE_SHORT_EDGE`；`bcut-render` 不依赖那条 crate 边，
/// 夹具因此把系数写成显式常量并在注释里点名出处。
const PIXEL_SCALE: f64 = 2.0;

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/progress")
}

/// 三只元素盒，直接来自 `bcut_timeline::geometry` 的默认几何表：
/// `bar` = 80% × 5%、`square` = 30% × 30%、`frame` = 100% × 100%，均居中。
fn element_box(aspect: ProgressAspect) -> ProgressBox {
    let (width, height) = match aspect {
        ProgressAspect::Bar => (0.8, 0.05),
        ProgressAspect::Square => (0.3, 0.3),
        ProgressAspect::Frame => (1.0, 1.0),
    };
    let (w, h) = (CANVAS.0 * width, CANVAS.1 * height);
    ProgressBox {
        x: (CANVAS.0 - w) / 2.0,
        y: (CANVAS.1 - h) / 2.0,
        w,
        h,
    }
}

fn params() -> ProgressParams {
    ProgressParams {
        main_color: [0.235_294_12, 0.678_431_4, 1.0, 1.0],
        secondary_color: [0.768_627_5, 0.901_960_8, 1.0, 1.0],
        pixel_scale: PIXEL_SCALE,
    }
}

fn record(recipe: &CatalogueRecipe, progress: f64, time: f64) -> Value {
    let aspect = recipe.progress().expect("progress 配方").aspect;
    let mut builder = FrameBuilder::default();
    let pushed = progress_frame(
        &mut builder,
        recipe,
        &params(),
        progress,
        time,
        element_box(aspect),
        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    );
    let frame = builder.finish();
    assert_eq!(pushed, frame.ops.len(), "返回条数必须等于实际压入条数");
    json!({
        "progress": progress,
        "t": time,
        "ops": frame.ops.len(),
        "paths": frame.paths.len(),
        "fingerprint": format!("{:016x}", fingerprint(&frame)),
    })
}

fn cases_json() -> Value {
    json!({
        "note": "progress 夹具的**输入**。P5 的 GPU 对拍与 P6 的 wasm 复用同一份，\
                 各自追加 expected-*.json。追加新输入请往末尾加，既有编号不动。\
                 times 与 progress 一一配对，是元素本地时刻（秒）：P4 追加，\
                 只有 snake_spin 读它，P3 六种的指纹不受影响。",
        "canvas": [CANVAS.0, CANVAS.1],
        "progress": STEPS.to_vec(),
        "times": TIMES.to_vec(),
        "pixelScale": PIXEL_SCALE,
        "mainColor": "#3CADFF",
        "secondaryColor": "#C4E6FF",
        "boxes": {
            "bar": "画幅 80% × 5%，居中",
            "square": "画幅 30% × 30%，居中",
            "frame": "画幅 100% × 100%",
        },
        "styles": timeline_progresses()
            .iter()
            .map(CatalogueRecipe::qualified_id)
            .collect::<Vec<_>>(),
    })
}

fn expected_json() -> Value {
    let styles = timeline_progresses()
        .iter()
        .map(|recipe| {
            json!({
                "style": recipe.qualified_id(),
                "algorithm": recipe.progress().unwrap().recipe.algorithm.name(),
                "aspect": match recipe.progress().unwrap().aspect {
                    ProgressAspect::Bar => "bar",
                    ProgressAspect::Square => "square",
                    ProgressAspect::Frame => "frame",
                },
                "samples": STEPS
                    .iter()
                    .zip(TIMES.iter())
                    .map(|(step, time)| record(recipe, *step, *time))
                    .collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "note": "DrawOp 指令流指纹（P3 六种 + P4 的 snake 两种）。P5 的 rainbow / strobe \
                 四种填实后，对应样式的 ops 会从 0 变成真实条数。",
        "styles": styles,
    })
}

fn pretty(value: &Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(value).expect("序列化夹具");
    bytes.push(b'\n');
    bytes
}

/// 重新生成夹具。确认过再跑：
/// `cargo test -p bcut-render --test progress_draw -- --ignored`
#[test]
#[ignore]
fn write_progress_draw_fixture() {
    let dir = fixture_dir();
    std::fs::create_dir_all(&dir).expect("建夹具目录");
    std::fs::write(dir.join("cases.json"), pretty(&cases_json())).unwrap();
    std::fs::write(dir.join("expected-draw.json"), pretty(&expected_json())).unwrap();
}

/// 日常门禁：当场重算再**逐字节**比。
#[test]
fn the_progress_fixtures_are_up_to_date() {
    let dir = fixture_dir();
    for (name, expected) in [
        ("cases.json", pretty(&cases_json())),
        ("expected-draw.json", pretty(&expected_json())),
    ] {
        let actual = std::fs::read(dir.join(name))
            .unwrap_or_else(|e| panic!("{name} 缺失（跑 --ignored）：{e}"));
        assert_eq!(actual, expected, "{name} 与生成器不一致");
    }
}

/// **14 种全部画得出东西**（P5b 之后没有空臂了）。
///
/// 半进度是唯一对全部 14 种都非退化的采样点：端点上 `reverse_*` 的进度框会整个
/// 消失，`background: false` 的 strobe 两种因此在那一端确实是 0 条指令。
#[test]
fn every_style_is_live_in_the_golden() {
    let styles = expected_json();
    let styles = styles["styles"].as_array().unwrap();
    assert_eq!(styles.len(), 14);
    for style in styles {
        let id = style["style"].as_str().unwrap();
        let samples = style["samples"].as_array().unwrap();
        assert!(
            samples[2]["ops"].as_u64().unwrap() > 0,
            "{id} @ progress=0.5 必须画出东西"
        );
    }
}

/// 进度单调：同一样式下相邻两步的指令流必须不同（除了退化端点）。
/// 这条挡住"进度值没接进去"这类静默失效。
#[test]
fn every_step_changes_the_instruction_stream() {
    for recipe in timeline_progresses() {
        let mut seen: Vec<String> = Vec::new();
        for (step, time) in STEPS.iter().zip(TIMES.iter()) {
            let entry = record(recipe, *step, *time);
            if entry["ops"].as_u64().unwrap() == 0 {
                continue;
            }
            let print = entry["fingerprint"].as_str().unwrap().to_owned();
            assert!(
                !seen.contains(&print),
                "{} 在 progress={step} 的画面与之前某一步逐字节相同",
                recipe.qualified_id()
            );
            seen.push(print);
        }
    }
}
