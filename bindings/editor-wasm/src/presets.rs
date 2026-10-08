//! 元素的样式目录：声波、进度条与彩纸的款式、次序、默认颜色、dB 窗与发射参数，读 `motion` 的内置配方，渲染画的是同一份。
//!
//! 只解析这三类目录（`motion::preset_registry::parse_builtin_catalogue`），别的内置配方不进这个 WASM。只给界面新建与属性页
//! 要读的字段；画法（配方的其余参数）只在渲染内核里用。款名与色板标题是界面的文案，留在界面。

use motion::MotionError;
use motion::preset_registry::{
    CatalogueKind, CatalogueRecipe, ConfettiBody, ProgressAspect, ProgressBody, VisualizerAspect, VisualizerBody, parse_builtin_catalogue,
    visualizer_style_aliases,
};
use serde::Serialize;
use serde_json::{Map, Value};

use crate::EntryError;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Presets {
    progress: Vec<ProgressPreset>,
    visualizer: Vec<VisualizerPreset>,
    /// 声波旧 style id → 当前目录的款（老项目照常打开、照常画）。
    visualizer_aliases: Map<String, Value>,
    confetti: Vec<ConfettiPreset>,
}

/// 进度条的一款。`aspect`：`bar` 用整个框、`square` 在框里取内切正方形、`frame` 铺满画幅的边框。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPreset {
    id: String,
    aspect: &'static str,
    main_color: String,
    secondary_color: String,
    /// 属性页出几个色板（0–2）。
    num_colors: u8,
}

/// 声波的一款。`hasControl` 为 false 的款读时域，dB 窗、平滑与增益对它不起作用。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VisualizerPreset {
    id: String,
    aspect: &'static str,
    main_color: String,
    secondary_color: String,
    min_db: f64,
    max_db: f64,
    has_control: bool,
    num_colors: u8,
}

/// 彩纸的一款：色板、形状混合与缺省的发射参数（属性页的「跟配方」回落到这些值）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfettiPreset {
    id: String,
    colors: Vec<String>,
    shapes: Vec<String>,
    /// 改编来源的 id（`库名/部件`），属性页标注出处。
    sources: Vec<String>,
    has_emitter_control: bool,
    emit: ConfettiEmit,
    emitters: Vec<ConfettiEmitter>,
    /// 发射方向（度，90 向下、−90 向上）。
    angle: f64,
    /// 发射扇面（度）。
    spread: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfettiEmit {
    mode: String,
    rate: f64,
    count: f64,
    interval: f64,
}

/// 发射器：盒内 % 的中心，可以自带方向。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfettiEmitter {
    x: f64,
    y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    angle: Option<f64>,
}

fn broken(message: String) -> EntryError {
    EntryError {
        code: "PRESET_CATALOGUE_INVALID",
        message,
    }
}

fn catalogue(kind: CatalogueKind) -> Result<Vec<CatalogueRecipe>, EntryError> {
    let recipes = parse_builtin_catalogue(kind).map_err(|error: MotionError| broken(error.to_string()))?;
    Ok(recipes.into_iter().filter(|recipe| recipe.available).collect())
}

fn progress(recipe: &CatalogueRecipe, body: &ProgressBody) -> ProgressPreset {
    ProgressPreset {
        id: recipe.id.clone(),
        aspect: match body.aspect {
            ProgressAspect::Bar => "bar",
            ProgressAspect::Square => "square",
            ProgressAspect::Frame => "frame",
        },
        main_color: body.default_main_color.clone(),
        secondary_color: body.default_secondary_color.clone(),
        num_colors: body.num_colors,
    }
}

fn visualizer(recipe: &CatalogueRecipe, body: &VisualizerBody) -> VisualizerPreset {
    VisualizerPreset {
        id: recipe.id.clone(),
        aspect: match body.aspect {
            VisualizerAspect::Free => "free",
            VisualizerAspect::Square => "square",
        },
        main_color: body.default_main_color.clone(),
        secondary_color: body.default_secondary_color.clone(),
        min_db: body.default_min_db,
        max_db: body.default_max_db,
        has_control: body.has_control,
        num_colors: body.num_colors,
    }
}

fn confetti(recipe: &CatalogueRecipe, body: &ConfettiBody) -> Result<ConfettiPreset, EntryError> {
    let params = &body.recipe;
    let missing = |key: &str| broken(format!("彩纸 {} 的配方缺 {key}", recipe.id));
    let number = |map: &Map<String, Value>, key: &str| map.get(key).and_then(Value::as_f64).ok_or_else(|| missing(key));
    let emit = params.object("emit").ok_or_else(|| missing("emit"))?;
    let emitters = params
        .array("emitters")
        .ok_or_else(|| missing("emitters"))?
        .iter()
        .map(|emitter| {
            let emitter = emitter.as_object().ok_or_else(|| missing("emitters[]"))?;
            Ok(ConfettiEmitter {
                x: number(emitter, "x")?,
                y: number(emitter, "y")?,
                angle: emitter.get("angle").and_then(Value::as_f64),
            })
        })
        .collect::<Result<Vec<_>, EntryError>>()?;
    Ok(ConfettiPreset {
        id: recipe.id.clone(),
        colors: body.palette.clone(),
        shapes: body.shapes.clone(),
        sources: body.sources.clone(),
        has_emitter_control: body.has_emitter_control,
        emit: ConfettiEmit {
            mode: emit
                .get("mode")
                .and_then(Value::as_str)
                .ok_or_else(|| missing("emit.mode"))?
                .to_owned(),
            rate: number(emit, "rate")?,
            count: number(emit, "count")?,
            interval: number(emit, "interval")?,
        },
        emitters,
        angle: params.number("angle").ok_or_else(|| missing("angle"))?,
        spread: params.number("spread").ok_or_else(|| missing("spread"))?,
    })
}

/// 输入不看（约定传 `{}`），结果是三类目录（目录次序）与声波的旧名表。内置配方解析不了时 `PRESET_CATALOGUE_INVALID`。
pub fn element_presets(_input: &[u8]) -> Result<String, EntryError> {
    let presets = Presets {
        progress: catalogue(CatalogueKind::Progress)?
            .iter()
            .filter_map(|recipe| recipe.progress().map(|body| progress(recipe, body)))
            .collect(),
        visualizer: catalogue(CatalogueKind::Visualizer)?
            .iter()
            .filter_map(|recipe| recipe.visualizer().map(|body| visualizer(recipe, body)))
            .collect(),
        visualizer_aliases: visualizer_style_aliases()
            .iter()
            .map(|(old, new)| ((*old).to_owned(), Value::String((*new).to_owned())))
            .collect(),
        confetti: catalogue(CatalogueKind::Confetti)?
            .iter()
            .filter_map(|recipe| recipe.confetti().map(|body| confetti(recipe, body)))
            .collect::<Result<_, _>>()?,
    };
    Ok(serde_json::to_string(&presets).expect("目录总能序列化"))
}
