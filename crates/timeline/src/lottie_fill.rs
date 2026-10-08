//! Lottie 素材的**填充色分组**（原型 `designs/baocut/app/model-lottiefill.js`）。
//!
//! 静态 SVG 贴纸的换色在 [`crate::svg_fill`]：数一数源码里有几个填充色分组，就出
//! 几张色卡。动态贴纸换成 Noto 的 Lottie JSON 之后，「动态贴纸也能分色」这句话
//! 由这一层兑现——Lottie 的颜色不在属性上，而在图层的形状项（`ty: "fl"` 填充 /
//! `ty: "st"` 描边，`c.k` 是 0–1 的 RGB 数组）与纯色图层（`ty: 1` 的 `sc`）上。
//!
//! 两条与另外两份实现逐字同源的规则——原型的 `BC_LOTTIEFILL.colorsOf` 与生成器
//! [`scripts/dev/elements/generate.py`] 的 `lottie_colors`（`anim/provenance.json`
//! 里每一份的 `colors` 就是它的产物）：
//!
//! 1. **只收静态色**。`c.a` 为真表示这条颜色本身带关键帧，那不是一个可以整体换
//!    掉的色区，跳过。
//! 2. **按出现次数排序，最多 [`MAX_SWATCHES`] 组**；次数相同按第一次出现的先后
//!    ——用户看到的第一张色卡就是画面上最大的那块色。
//!
//! 换色本身不在这里：文档里的真相是 `sticker.fillOverrides`（**按源 hex 键**，
//! 与 SVG 侧同一张表），渲染侧的落点是
//! `bcut_render::source::lottie::Lottie::apply_fill_overrides`。色卡 ↔ 覆盖表的
//! 翻译复用 [`crate::svg_fill::fills_to_overrides`] 与
//! [`crate::svg_fill::fill_list_from_overrides`]，两种素材共一份。

use serde_json::Value;

use crate::svg_fill::{FillCard, norm_fill_hex};

/// 默认色卡最多几张（原型 `BC_LOTTIEFILL.LIMIT`、生成器 `lottie_colors(limit=8)`）。
///
/// 比 SVG 那边的 [`crate::svg_fill::MAX_SWATCHES`]（5）多——八组是 Noto 那批
/// 素材的实际色数上界。
pub const MAX_SWATCHES: usize = 8;

/// Lottie 的 `[r, g, b]`（0–1，偶尔 0–255）→ `#RRGGBB`。
///
/// 任意一维大于 1 就整体按 0–255 解释（生成器 `lottie_rgb` 同判）：Lottie 两种
/// 写法都有，而 `[1, 1, 1]` 这种既是白也是「几乎全黑的 255 制」，按 0–1 读是
/// bodymovin 的默认。
pub fn rgb_hex(value: &Value) -> Option<String> {
    let list = value.as_array()?;
    if list.len() < 3 {
        return None;
    }
    let mut rgb = [0.0f64; 3];
    for (slot, item) in rgb.iter_mut().zip(list) {
        let channel = item.as_f64()?;
        if !channel.is_finite() {
            return None;
        }
        *slot = channel;
    }
    if rgb.iter().any(|channel| *channel > 1.0) {
        for channel in &mut rgb {
            *channel /= 255.0;
        }
    }
    let mut out = String::with_capacity(7);
    out.push('#');
    for channel in rgb {
        let byte = (channel.clamp(0.0, 1.0) * 255.0).round() as u8;
        out.push_str(&format!("{byte:02X}"));
    }
    Some(out)
}

/// 纯色图层的 `sc`：只认 `#RGB` / `#RRGGBB`，其余（`transparent`、空串、写坏的）
/// 不是一个可换的色区，跳过。
fn solid_hex(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let body = trimmed.strip_prefix('#')?;
    let hexy = body.chars().all(|c| c.is_ascii_hexdigit());
    (hexy && (body.len() == 3 || body.len() == 6)).then(|| norm_fill_hex(trimmed))
}

/// 形状树里的静态色，按遇到的次序发出。`gr` 递归进 `it`，其余项跳过。
fn visit_shapes(items: &Value, out: &mut Vec<String>) {
    let Some(list) = items.as_array() else {
        return;
    };
    for item in list {
        match item.get("ty").and_then(Value::as_str) {
            Some("fl" | "st") => {
                let Some(color) = item.get("c") else { continue };
                // `c.a` 为真 = 这条颜色自己带关键帧，不是一个整体可换的色区。
                if color.get("a").is_some_and(is_truthy) {
                    continue;
                }
                let Some(k) = color.get("k") else { continue };
                if let Some(hex) = rgb_hex(k) {
                    out.push(hex);
                }
            }
            Some("gr") => {
                if let Some(nested) = item.get("it") {
                    visit_shapes(nested, out);
                }
            }
            _ => {}
        }
    }
}

/// JS 的真值判断：`0` / `false` / `null` / 缺席都是假。Lottie 的 `a` 实际写的是
/// `0` / `1`，但手写文档里 `true` 也出现过。
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::Null => false,
        _ => true,
    }
}

/// 一份 Lottie 里所有静态色的落点，按遇到的次序。根图层在前，预合成
/// （`assets[].layers`）依 `assets` 的次序跟在后面——与原型和生成器同一趟遍历。
pub fn colors_in_order(doc: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let mut lists = vec![doc.get("layers")];
    if let Some(assets) = doc.get("assets").and_then(Value::as_array) {
        lists.extend(assets.iter().map(|asset| asset.get("layers")));
    }
    for layers in lists.into_iter().flatten() {
        let Some(layers) = layers.as_array() else {
            continue;
        };
        for layer in layers {
            if layer.get("ty").and_then(Value::as_i64) == Some(1)
                && let Some(sc) = layer.get("sc").and_then(Value::as_str)
                && let Some(hex) = solid_hex(sc)
            {
                out.push(hex);
            }
            if let Some(shapes) = layer.get("shapes") {
                visit_shapes(shapes, &mut out);
            }
        }
    }
    out
}

/// 色卡表：出现次数最多的前 [`MAX_SWATCHES`] 组，次数相同按第一次出现的先后。
///
/// `tag` 恒为空——SVG 那边的副标题是承载色的标签名（`path` / `rect`），Lottie 的
/// 承载是形状项，没有对用户有意义的名字，卡头就只剩「第 N 组」。
pub fn fills_of_doc(doc: &Value) -> Vec<FillCard> {
    let order = colors_in_order(doc);
    let mut cards: Vec<FillCard> = Vec::new();
    for hex in order {
        match cards.iter_mut().find(|card| card.hex == hex) {
            Some(card) => card.count += 1,
            None => cards.push(FillCard {
                hex,
                tag: String::new(),
                count: 1,
            }),
        }
    }
    // 稳定排序：次数降序，次数相同保持第一次出现的先后。
    cards.sort_by(|a, b| b.count.cmp(&a.count));
    cards.truncate(MAX_SWATCHES);
    cards
}

/// 一份 Lottie JSON 文本的色卡表。解析不动就是空表——**空表就是「不出颜色段」**。
pub fn fills_of(json: &str) -> Vec<FillCard> {
    serde_json::from_str::<Value>(json)
        .map(|doc| fills_of_doc(&doc))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rgb_reads_both_the_unit_and_the_byte_dialect() {
        assert_eq!(rgb_hex(&json!([1, 0, 0])).as_deref(), Some("#FF0000"));
        assert_eq!(rgb_hex(&json!([0, 128, 255])).as_deref(), Some("#0080FF"));
        assert_eq!(
            rgb_hex(&json!([0.0, 0.502, 1.0, 1.0])).as_deref(),
            Some("#0080FF")
        );
        assert_eq!(rgb_hex(&json!([1, 0])), None);
        assert_eq!(rgb_hex(&json!("#ff0000")), None);
    }

    #[test]
    fn only_static_colours_become_swatches() {
        let doc = json!({"layers": [{"ty": 4, "shapes": [
            {"ty": "gr", "it": [
                {"ty": "fl", "c": {"a": 0, "k": [1, 0, 0, 1]}},
                {"ty": "st", "c": {"a": 1, "k": [{"t": 0, "s": [0, 1, 0, 1]}]}},
            ]},
        ]}]});
        let cards = fills_of_doc(&doc);
        assert_eq!(cards.len(), 1, "带关键帧的描边色不出卡：{cards:?}");
        assert_eq!(cards[0].hex, "#FF0000");
    }

    /// 排序是「次数降序、同次按首次出现」——用户看到的第一张卡是画面上最大的
    /// 那块色。这条与原型 `colorsOf` 和生成器 `Counter.most_common` 同一口径。
    #[test]
    fn swatches_rank_by_frequency_then_first_appearance() {
        let fill = |hex: [i64; 3]| json!({"ty": "fl", "c": {"a": 0, "k": hex}});
        let doc = json!({"layers": [{"ty": 4, "shapes": [
            fill([0, 0, 1]),
            fill([1, 0, 0]),
            fill([0, 1, 0]),
            fill([1, 0, 0]),
            fill([0, 1, 0]),
        ]}]});
        let cards = fills_of_doc(&doc);
        assert_eq!(
            cards
                .iter()
                .map(|card| (card.hex.as_str(), card.count))
                .collect::<Vec<_>>(),
            vec![("#FF0000", 2), ("#00FF00", 2), ("#0000FF", 1)],
        );
    }

    /// 预合成里的图层也算数：Noto 的动态贴纸把整段动画塞在 `assets[].layers` 里，
    /// 只看 `doc.layers` 的话一张卡都读不出来。
    #[test]
    fn precomp_layers_and_solids_count_too() {
        let doc = json!({
            "layers": [{"ty": 0, "refId": "c0"}],
            "assets": [{"id": "c0", "layers": [
                {"ty": 1, "sc": "#abc"},
                {"ty": 4, "shapes": [{"ty": "fl", "c": {"a": 0, "k": [1, 1, 1, 1]}}]},
            ]}],
        });
        let cards = fills_of_doc(&doc);
        assert_eq!(
            cards
                .iter()
                .map(|card| card.hex.as_str())
                .collect::<Vec<_>>(),
            vec!["#AABBCC", "#FFFFFF"],
        );
    }

    #[test]
    fn at_most_eight_swatches_and_junk_parses_to_none() {
        let shapes: Vec<_> = (0..12)
            .map(|i| json!({"ty": "fl", "c": {"a": 0, "k": [i * 20, 0, 0]}}))
            .collect();
        let doc = json!({"layers": [{"ty": 4, "shapes": shapes}]});
        assert_eq!(fills_of_doc(&doc).len(), MAX_SWATCHES);
        assert!(fills_of("not json").is_empty());
    }
}
