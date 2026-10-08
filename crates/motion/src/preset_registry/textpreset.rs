//! 文字预设包（`core/presets/builtin/textpreset/*.json`）——注册表的**第四种**
//! 配方形状，`docs/design/app-v2/text-pane-and-groups.md` §6.2 的核心侧契约。
//!
//! 与既有三种并列：[`super::frozen`]（冻结的四条专用路径）、
//! [`super::manifest`]（通用动画 manifest）、[`super::catalogue`]（shape /
//! sticker / visualizer / progress 的形状库）。
//!
//! **为什么不复用 `parse_catalogue`**：目录型配方描述的是「**一个** kind 的一种
//! 画法」（一份 recipe ↔ 一个 `ShapeProps.shape` 面值）；文字预设描述的是「一
//! **组**排好版的元素」——1..5 个 text / shape，各带坐标、样式、进场错峰与动画。
//! 那是场景模板，不是画法，硬塞进 `CatalogueBody` 只能靠编一个假 body。
//!
//! 复用的仍是**纪律**：`builtin!` + `include_str!` 清单、`OnceLock` 一次性
//! `build()`、`(id, version)` + `manifest_hash` 冻结、目录一致性由
//! `tests/manifests.rs` 守住。
//!
//! ## 三条契约（改这里就是改契约）
//!
//! 1. **内容项是元素载荷本身**（`kind` / `place` / `text` / `style` / `shape` /
//!    `animate`），字段名与 `bcut_timeline::schema::Element` 逐字对齐，
//!    [`instantiate`] 只补 `start` / `end`。这样「预设落地的元素」与「手写
//!    `addElement` 的元素」不可能长成两种形状。
//! 2. **单位在生成期就换算完**：`place.x/y` 是画幅百分比、`style.fontSize` 是
//!    参考短边 540 上的像素、`place.rot` 是角度。运行期没有第二套单位。
//! 3. **动画名与形状名在解析期就核对注册表**：`enter` 查 `timeline.enter.*`、
//!    `exit` 查 `timeline.exit.*`、`shape.shape` 查形状目录。文档层的 exit 闭集
//!    （`EXIT_PRESETS` ∪ `EXIT_LEGACY_PRESETS`）为兼容 0.1 文档仍读入 `pop` /
//!    `blurIn` 之类**没有出场配方**的名字（`lower_timeline::effective_exit` 视作
//!    无退场）。预设是内置数据，不允许出现这种「合法但不动」的槽，所以这里按
//!    配方表验，比文档层更严。
//!
//! **参照表由调用方传进来，解析期一律不查 `data()`**：预设表是在
//! `build()` 内部建的，那时 `OnceLock` 还没初始化完，任何 `data()` 都是
//! 重入——`get_or_init` 遇到重入是**死锁**，不是报错。

use serde_json::{Map, Value};

use crate::MotionError;

use super::catalogue::CatalogueRecipe;
use super::frozen::{LoopRecipe, SlotRecipe};
use super::json::{field, number, text, version};

/// 解析期要核对的三张表。全部由调用方（`preset_registry::build`）传入——
/// 见模块头「参照表由调用方传进来」。
#[derive(Clone, Copy)]
pub struct TextPresetTables<'a> {
    pub shapes: &'a [CatalogueRecipe],
    pub enter: &'a [SlotRecipe],
    pub exit: &'a [SlotRecipe],
    pub loops: &'a [LoopRecipe],
}

/// 面板分类（封闭集合）。顺序即 chip 行的顺序。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum TextPresetCategory {
    Simple,
    Title,
    LowerThird,
    Other,
}

impl TextPresetCategory {
    pub const ALL: [Self; 4] = [Self::Simple, Self::Title, Self::LowerThird, Self::Other];

    /// JSON `category` 字段的面值，同时是 UI 的查询键。
    pub const fn key(self) -> &'static str {
        match self {
            Self::Simple => "simple",
            Self::Title => "title",
            Self::LowerThird => "lowerThird",
            Self::Other => "other",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.key() == value)
    }
}

/// 内容项的元素类型（封闭集合）。
///
/// 首批只有这两种：`text` 是主角，`shape` 承载目录里的色块 / 圆点 / 箭头
/// （落到 BaoCut 的 kind 闭集里是参数化形状，走矢量直出）。
/// 图片型内容项**不在**首批：它要一份随包分发的素材，那是另一条管线。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextPresetItemKind {
    Text,
    Shape,
}

impl TextPresetItemKind {
    pub const fn key(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Shape => "shape",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "text" => Some(Self::Text),
            "shape" => Some(Self::Shape),
            _ => None,
        }
    }
}

/// 一条内容项。
#[derive(Clone, Debug, PartialEq)]
pub struct TextPresetItem {
    pub kind: TextPresetItemKind,
    /// 相对预设起点的进场错峰（秒，≥ 0）。
    pub delay: f64,
    /// 元素载荷：解析期就校验过的对象，**不含** `start` / `end` / `id`。
    pub element: Value,
}

/// 一条文字预设。
#[derive(Clone, Debug, PartialEq)]
pub struct TextPresetRecipe {
    pub id: String,
    pub version: u32,
    pub category: TextPresetCategory,
    /// 面板顺序（全局唯一，解析期查重）。
    pub order: u32,
    /// 默认时长（秒）。
    pub duration: f64,
    pub content: Vec<TextPresetItem>,
    pub manifest_hash: u64,
}

impl TextPresetRecipe {
    /// 首个文字内容项的正文——面板卡片的可读标签与落地后的认领目标都用它。
    pub fn headline(&self) -> Option<&str> {
        self.content
            .iter()
            .find(|item| item.kind == TextPresetItemKind::Text)
            .and_then(|item| item.element.get("text"))
            .and_then(Value::as_str)
    }
}

/// 时长下限：预设时长被片长夹到 0 时的兜底，避免造出零长元素。
const MIN_SPAN: f64 = 0.1;

/// 一条预设 → N 个 `addElement` 的元素载荷（数组序即 z 序，低层在前）。
///
/// * 整组占 `[start, end)`，`end` 被 `film_end` 夹住；
/// * 成员起点 = `start + delay`（成组错峰），夹在 `end - MIN_SPAN` 以内；
/// * 不分配 `id`：内核 `addElement` 见不到 `id` 就自己铸一个。
pub fn instantiate(recipe: &TextPresetRecipe, start: f64, film_end: f64) -> Vec<Value> {
    let start = if start.is_finite() {
        start.max(0.0)
    } else {
        0.0
    };
    let ceiling = if film_end.is_finite() {
        film_end.max(start + MIN_SPAN)
    } else {
        start + recipe.duration
    };
    let end = round3((start + recipe.duration).min(ceiling));
    recipe
        .content
        .iter()
        .map(|item| {
            let mut object = item.element.as_object().cloned().unwrap_or_else(Map::new);
            let item_start = round3((start + item.delay).min(end - MIN_SPAN).max(start));
            object.insert("start".to_owned(), Value::from(item_start));
            object.insert("end".to_owned(), Value::from(end));
            Value::Object(object)
        })
        .collect()
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

/// 解析一份预设包。`file` 是清单里的文件名（不含扩展名），同时是 id 的期望值。
pub fn parse_text_preset(
    file: &str,
    doc: &Value,
    manifest_hash: u64,
    tables: TextPresetTables<'_>,
) -> Result<TextPresetRecipe, MotionError> {
    let invalid = |message: String| MotionError::ManifestInvalid(format!("{file}: {message}"));

    let domain = text(file, doc, "domain")?;
    if domain != "textpreset" {
        return Err(invalid(format!("domain 应为 textpreset，实为 {domain}")));
    }
    let id = text(file, doc, "id")?;
    if id != file {
        return Err(invalid(format!("id \"{id}\" 与文件名不一致")));
    }
    let category = TextPresetCategory::parse(text(file, doc, "category")?)
        .ok_or_else(|| invalid("未知 category".to_owned()))?;
    if !id.starts_with(category.key()) {
        return Err(invalid("id 前缀应是它自己的 category".to_owned()));
    }
    let order = field(file, doc, "order")?
        .as_u64()
        .filter(|order| *order > 0)
        .ok_or_else(|| invalid("order 须是正整数".to_owned()))? as u32;
    let duration = number(file, doc, "duration")?;
    if !duration.is_finite() || duration < MIN_SPAN {
        return Err(invalid(format!("duration 非法：{duration}")));
    }

    let items = field(file, doc, "content")?
        .as_array()
        .ok_or_else(|| invalid("content 不是数组".to_owned()))?;
    if items.is_empty() {
        return Err(invalid("content 为空".to_owned()));
    }
    let mut content = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        content.push(parse_item(file, index, item, tables)?);
    }

    Ok(TextPresetRecipe {
        id: id.to_owned(),
        version: version(file, doc)?,
        category,
        order,
        duration,
        content,
        manifest_hash,
    })
}

fn parse_item(
    file: &str,
    index: usize,
    item: &Value,
    tables: TextPresetTables<'_>,
) -> Result<TextPresetItem, MotionError> {
    let invalid = |message: String| {
        MotionError::ManifestInvalid(format!("{file}: content[{index}] {message}"))
    };
    let object = item
        .as_object()
        .ok_or_else(|| invalid("不是对象".to_owned()))?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .and_then(TextPresetItemKind::parse)
        .ok_or_else(|| invalid("kind 只能是 text / shape".to_owned()))?;

    let place = object
        .get("place")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("缺 place".to_owned()))?;
    for key in ["x", "y"] {
        let value = place
            .get(key)
            .and_then(Value::as_f64)
            .ok_or_else(|| invalid(format!("place.{key} 缺失或非数字")))?;
        if !value.is_finite() {
            return Err(invalid(format!("place.{key} 非法")));
        }
    }
    for key in ["w", "rot"] {
        if let Some(value) = place.get(key) {
            let value = value
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| invalid(format!("place.{key} 非法")))?;
            if key == "w" && value <= 0.0 {
                return Err(invalid("place.w 须为正".to_owned()));
            }
        }
    }

    match kind {
        TextPresetItemKind::Text => {
            object
                .get("text")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .ok_or_else(|| invalid("text 缺失或为空".to_owned()))?;
            object
                .get("style")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid("缺 style 对象".to_owned()))?;
        }
        TextPresetItemKind::Shape => {
            let shape = object
                .get("shape")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid("缺 shape 对象".to_owned()))?;
            let name = shape
                .get("shape")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("shape.shape 缺失".to_owned()))?;
            // 形状名走**形状目录**，写一个目录里没有的名字在这里就红，
            // 不会等到用户点了预设、元素落库、渲染期才发现画不出来。
            if !tables.shapes.iter().any(|recipe| recipe.id == name) {
                return Err(invalid(format!("形状目录里没有 \"{name}\"")));
            }
        }
    }

    let delay = match object.get("delay") {
        Some(value) => value
            .as_f64()
            .filter(|value| value.is_finite() && *value >= 0.0)
            .ok_or_else(|| invalid("delay 非法".to_owned()))?,
        None => 0.0,
    };

    if let Some(animate) = object.get("animate") {
        let animate = animate
            .as_object()
            .ok_or_else(|| invalid("animate 不是对象".to_owned()))?;
        for (slot, value) in animate {
            let preset = value
                .get("preset")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("animate.{slot} 缺 preset")))?;
            let known = match slot.as_str() {
                "enter" => tables.enter.iter().any(|recipe| recipe.id == preset),
                "exit" => tables.exit.iter().any(|recipe| recipe.id == preset),
                "loop" => tables.loops.iter().any(|recipe| recipe.id == preset),
                other => return Err(invalid(format!("未知动画槽 {other}"))),
            };
            if !known {
                return Err(invalid(format!("animate.{slot} 的 \"{preset}\" 没有配方")));
            }
            if let Some(dur) = value.get("dur") {
                let dur = dur
                    .as_f64()
                    .filter(|dur| dur.is_finite())
                    .ok_or_else(|| invalid(format!("animate.{slot}.dur 非法")))?;
                // 与 `bcut_timeline::animations::{DURATION_MIN, DURATION_MAX}` 同口径。
                // 那两个常量住在下游 crate，这里不能引用，所以复述并由
                // `bcut-timeline` 的预设落地测试反向钉住。
                if !(0.1..=2.0).contains(&dur) {
                    return Err(invalid(format!("animate.{slot}.dur 须在 0.1..=2.0")));
                }
            }
        }
    }

    // 载荷里不该出现由 `instantiate` 或内核负责的字段。
    for key in ["id", "start", "end", "role"] {
        if object.contains_key(key) {
            return Err(invalid(format!("不许自带 \"{key}\"")));
        }
    }

    let mut element = object.clone();
    element.remove("delay");
    Ok(TextPresetItem {
        kind,
        delay,
        element: Value::Object(element),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preset_registry::{
        Domain, ids, text_preset, text_presets, timeline_enter, timeline_exit, timeline_loop,
        timeline_shapes,
    };

    /// 测试期的参照表：走查询面拿，与 `build()` 里那份是同一批数据。
    fn tables() -> (
        Vec<crate::preset_registry::frozen::SlotRecipe>,
        Vec<crate::preset_registry::frozen::SlotRecipe>,
        Vec<crate::preset_registry::frozen::LoopRecipe>,
    ) {
        let enter = ids(Domain::TimelineEnter)
            .into_iter()
            .filter_map(|id| timeline_enter(id).cloned())
            .collect();
        let exit = ids(Domain::TimelineExit)
            .into_iter()
            .filter_map(|id| timeline_exit(id).cloned())
            .collect();
        let loops = ids(Domain::TimelineLoop)
            .into_iter()
            .filter_map(|id| timeline_loop(id).cloned())
            .collect();
        (enter, exit, loops)
    }

    /// 目录形状：51 条、四个分类的条目数固定（simple 13 / title 10 / lowerThird 20 / other 8），
    /// `order` 升序且分类连续（chip 过滤直接取子切片就成立）。
    #[test]
    fn the_builtin_catalogue_has_the_default_shape() {
        let all = text_presets();
        assert_eq!(all.len(), 51);
        let mut counts = [0usize; 4];
        for (index, recipe) in all.iter().enumerate() {
            counts[TextPresetCategory::ALL
                .iter()
                .position(|kind| *kind == recipe.category)
                .expect("已知分类")] += 1;
            if index > 0 {
                assert!(all[index - 1].order < recipe.order, "order 必须升序");
                assert!(
                    all[index - 1].category <= recipe.category,
                    "分类必须成段：{}",
                    recipe.id
                );
            }
        }
        assert_eq!(counts, [13, 10, 20, 8]);
    }

    /// 每条预设都能被 id 查回，且 id 与分类前缀一致（解析期已验，这里钉住查询面）。
    #[test]
    fn every_preset_is_reachable_by_id() {
        for recipe in text_presets() {
            let found = text_preset(&recipe.id).expect(&recipe.id);
            assert_eq!(found.id, recipe.id);
            assert!(recipe.id.starts_with(recipe.category.key()));
            assert!(!recipe.content.is_empty());
            assert!(recipe.headline().is_some(), "{} 没有文字项", recipe.id);
        }
    }

    /// `instantiate` 的三条：成员数守恒、起点按 delay 错峰、终点被片长夹住。
    #[test]
    fn instantiate_staggers_members_and_clamps_to_the_film_end() {
        let recipe = text_presets()
            .iter()
            .find(|recipe| recipe.content.iter().any(|item| item.delay > 0.0))
            .expect("至少有一条带错峰的预设");
        let elements = instantiate(recipe, 2.0, 600.0);
        assert_eq!(elements.len(), recipe.content.len());
        for (element, item) in elements.iter().zip(&recipe.content) {
            assert_eq!(element["start"].as_f64().unwrap(), round3(2.0 + item.delay));
            assert_eq!(
                element["end"].as_f64().unwrap(),
                round3(2.0 + recipe.duration)
            );
            assert!(element.get("id").is_none(), "id 由内核分配");
            assert_eq!(element["kind"].as_str().unwrap(), item.kind.key());
        }
        // 片长夹取：整组被压到 3.0，成员起点也不许越过终点。
        let clamped = instantiate(recipe, 2.0, 3.0);
        for element in &clamped {
            assert_eq!(element["end"].as_f64().unwrap(), 3.0);
            assert!(element["start"].as_f64().unwrap() <= 3.0 - MIN_SPAN + 1e-9);
        }
    }

    /// 解析期的守卫逐条：未知分类 / 未知形状 / 没有配方的动画 / 自带 id。
    #[test]
    fn the_parser_rejects_the_four_classes_of_bad_data() {
        let good = serde_json::json!({
            "id": "simple.99", "version": 1, "domain": "textpreset",
            "category": "simple", "order": 199, "duration": 4.0,
            "content": [{"kind": "text", "place": {"x": 50.0, "y": 50.0},
                         "text": "Hi", "style": {"fontSize": 30.0}}],
        });
        let (enter, exit, loops) = tables();
        let tables = TextPresetTables {
            shapes: timeline_shapes(),
            enter: &enter,
            exit: &exit,
            loops: &loops,
        };
        assert!(parse_text_preset("simple.99", &good, 0, tables).is_ok());

        let mut wrong_category = good.clone();
        wrong_category["category"] = serde_json::json!("banner");
        assert!(parse_text_preset("simple.99", &wrong_category, 0, tables).is_err());

        let mut wrong_shape = good.clone();
        wrong_shape["content"] = serde_json::json!([
            {"kind": "shape", "place": {"x": 50.0, "y": 50.0, "w": 20.0},
             "shape": {"shape": "no-such-shape"}}
        ]);
        assert!(parse_text_preset("simple.99", &wrong_shape, 0, tables).is_err());

        let mut dead_exit = good.clone();
        // `pop` 是文档闭集里的合法出场名，但 exit 配方表里没有它——写进内置
        // 数据就是一个「合法但不会动」的槽，解析期必须拒绝。
        dead_exit["content"][0]["animate"] = serde_json::json!({"exit": {"preset": "pop"}});
        assert!(parse_text_preset("simple.99", &dead_exit, 0, tables).is_err());

        let mut carries_id = good.clone();
        carries_id["content"][0]["id"] = serde_json::json!("el-1");
        assert!(parse_text_preset("simple.99", &carries_id, 0, tables).is_err());

        let mut wrong_file = good.clone();
        wrong_file["id"] = serde_json::json!("simple.98");
        assert!(parse_text_preset("simple.99", &wrong_file, 0, tables).is_err());
    }
}
