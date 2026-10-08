//! 逐词动画的目录：19 格，每格一个目录 id（`catalogId`），与 [`crate::word_motion::WORD_ANIM_TRACKS`] 同名同序。
//!
//! 样式根的 `wordAnimation`（或旧键 `anim`）由 [`crate::word_animation`] 读：`catalogId` 是目录里的一格时按那一格的
//! 连续轨画，`animationName` 是内核的三档分支名（`Reveal`、`Highlight`……）。[`word_animation_payload`] 给出选中一格时
//! 写进样式的那一份载荷，界面与只给了目录 id 的样式（定位框样式的 `animationPresetId`）都用它，不各写一份。
//!
//! 移植自 v2 `bcut-editor-core::stylepane` 的 `WORD_ANIMATIONS` 与 `word_animation_payload`，行为不变。

use serde_json::{Map, Value, json};

/// 目录的一格：目录 id 与内核的分支名。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WordAnimationEntry {
    pub catalog_id: &'static str,
    /// [`crate::word_animation`] 认的 `animationName`。
    pub kernel: &'static str,
}

const fn entry(catalog_id: &'static str, kernel: &'static str) -> WordAnimationEntry {
    WordAnimationEntry { catalog_id, kernel }
}

/// 19 格，顺序与 [`crate::word_motion::WORD_ANIM_TRACKS`] 相同：17 格原样，加内核自己的「弹跳」「涂色」两格。
pub const WORD_ANIMATIONS: [WordAnimationEntry; 19] = [
    entry("none", "None"),
    entry("boxHighlight", "Highlight"),
    entry("flipClock", "flipClock"),
    entry("highlight", "Highlighter"),
    entry("karaoke", "Karaoke"),
    entry("impact", "impact"),
    entry("reveal", "Reveal"),
    entry("floatInTop", "floatInTop"),
    entry("floatInBottom", "floatInBottom"),
    entry("scaleIn", "scaleIn"),
    entry("dropIn", "dropIn"),
    entry("impactPop", "impactPop"),
    entry("colourHighlight", "Color"),
    entry("rotateFlipClock", "rotateFlipClock"),
    entry("rotateHighlight", "rotateHighlight"),
    entry("stack", "stack"),
    entry("stomp", "stomp"),
    entry("bounce", "Bounce"),
    entry("paint", "Paint"),
];

/// 目录 id 找那一格；不在目录里时为 `None`。
pub fn word_animation_entry(catalog_id: &str) -> Option<&'static WordAnimationEntry> {
    WORD_ANIMATIONS
        .iter()
        .find(|entry| entry.catalog_id == catalog_id)
}

/// 「药丸高亮」底块的胀缩轨：`(相位, 倍数)`，缓动 [`WORD_BOX_EASING`]。
pub const WORD_BOX_SCALE_KEYFRAMES: [(f64, f64); 3] = [(0.0, 0.9), (0.7, 1.1), (1.0, 1.0)];
/// 同上的 alpha 轨。块 alpha 独立于词的 opacity：落到词 opacity 上会把字一起淡掉。
pub const WORD_BOX_OPACITY_KEYFRAMES: [(f64, f64); 3] = [(0.0, 0.75), (0.7, 1.0), (1.0, 1.0)];
/// 两段共用的缓动名（`cubic-bezier(0.37, 0, 0.63, 1)`）。
pub const WORD_BOX_EASING: &str = "sinInOut";

fn keyframes_json(frames: &[(f64, f64)]) -> Value {
    Value::Array(
        frames
            .iter()
            .map(|(time, value)| json!([time, value]))
            .collect(),
    )
}

/// 选中一格时写进样式根 `wordAnimation` 的载荷：`{animationId, animationName, catalogId, spoken, active, unspoken}`。
///
/// `name` 是目录 id；不是时按内核分支名处理（旧文档里只有 `animationName` 的，例如 `Highlight`、`Custom`），
/// 这时 `catalogId` 就写这个名字，不擅自换成目录里第一张同内核的卡。
pub fn word_animation_payload(name: &str) -> Value {
    let entry = word_animation_entry(name);
    let catalog_id = entry.map_or(name, |entry| entry.catalog_id);
    let kernel_name = entry.map_or(name, |entry| entry.kernel);
    let mut spoken = Map::new();
    let mut active = Map::new();
    let mut unspoken = Map::new();
    match kernel_name {
        "Color" => {
            active.insert("color".to_owned(), json!("#FFD43B"));
        }
        "Highlight" => {
            active.insert("backgroundColor".to_owned(), json!("#FFD43B"));
            active.insert("color".to_owned(), json!("#0D0D0D"));
            active.insert("borderRadiusEm".to_owned(), json!(0.25));
        }
        "Bounce" => {
            active.insert("bottomEm".to_owned(), json!(0.22));
        }
        "Paint" => {
            spoken.insert("color".to_owned(), json!("#FFD43B"));
            spoken.insert("underline".to_owned(), json!(true));
            spoken.insert("underlineOffsetEm".to_owned(), json!(0.18));
        }
        "Reveal" => {
            unspoken.insert("color".to_owned(), json!("transparent"));
            unspoken.insert("shadowOff".to_owned(), json!(true));
            unspoken.insert("underline".to_owned(), json!(false));
            unspoken.insert("opacity".to_owned(), json!(0.0));
        }
        // 纯不透明度那两档：没有块、没有换色，只有 `opacity`。
        "Karaoke" => {
            spoken.insert("opacity".to_owned(), json!(1.0));
            active.insert("opacity".to_owned(), json!(1.0));
            unspoken.insert("opacity".to_owned(), json!(0.5));
        }
        "Highlighter" => {
            spoken.insert("opacity".to_owned(), json!(0.5));
            active.insert("opacity".to_owned(), json!(1.0));
            unspoken.insert("opacity".to_owned(), json!(0.5));
        }
        "Custom" => {
            spoken.insert("color".to_owned(), json!("#2EC971"));
            active.insert("backgroundColor".to_owned(), json!("#FFD43B"));
            active.insert("color".to_owned(), json!("#0D0D0D"));
            active.insert("borderRadiusEm".to_owned(), json!(0.25));
            unspoken.insert("opacity".to_owned(), json!(0.5));
        }
        _ => {}
    }
    if catalog_id == "boxHighlight" {
        active.insert("backgroundColor".to_owned(), json!("#FFD43B"));
        active.insert("color".to_owned(), json!("#0D0D0D"));
        // 圆角是字号的倍数（0.5 → 0.5em），与底板圆角同一把尺。
        active.insert("borderRadiusEm".to_owned(), json!(0.5));
        // 只有这一格带底块的时间轨；荧光笔（`highlight`）的块是常亮的方角底。
        active.insert(
            "boxScale".to_owned(),
            keyframes_json(&WORD_BOX_SCALE_KEYFRAMES),
        );
        active.insert(
            "boxOpacity".to_owned(),
            keyframes_json(&WORD_BOX_OPACITY_KEYFRAMES),
        );
        active.insert("boxEasing".to_owned(), json!(WORD_BOX_EASING));
    }
    json!({
        "animationId": if kernel_name == "None" { "none" } else { "magic-wbw" },
        "animationName": kernel_name,
        "catalogId": catalog_id,
        "spoken": Value::Object(spoken),
        "active": Value::Object(active),
        "unspoken": Value::Object(unspoken),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::word_motion::WORD_ANIM_TRACKS;

    #[test]
    fn the_catalogue_lines_up_with_the_track_table() {
        let ids: Vec<_> = WORD_ANIMATIONS
            .iter()
            .map(|entry| entry.catalog_id)
            .collect();
        let tracks: Vec<_> = WORD_ANIM_TRACKS
            .iter()
            .map(|anim| anim.catalog_id)
            .collect();
        assert_eq!(ids, tracks);
    }

    #[test]
    fn switching_effects_replaces_the_whole_group_instead_of_patching_it() {
        let highlight = word_animation_payload("Highlight");
        assert_eq!(highlight["animationId"], json!("magic-wbw"));
        assert_eq!(highlight["active"]["backgroundColor"], json!("#FFD43B"));
        assert_eq!(highlight["active"]["color"], json!("#0D0D0D"));
        assert_eq!(highlight["spoken"], json!({}));
        // None 是唯一把 animationId 写成 "none" 的。
        let none = word_animation_payload("None");
        assert_eq!(none["animationId"], json!("none"));
        assert_eq!(none["active"], json!({}));
        let color = word_animation_payload("Color");
        assert_eq!(color["active"], json!({"color": "#FFD43B"}));
        assert_eq!(
            word_animation_payload("Reveal")["unspoken"]["color"],
            json!("transparent")
        );
        // 纯不透明度那两档：只有 `opacity`，没有 backgroundColor / color。
        let karaoke = word_animation_payload("karaoke");
        assert_eq!(karaoke["animationName"], json!("Karaoke"));
        assert_eq!(karaoke["spoken"], json!({"opacity": 1.0}));
        assert_eq!(karaoke["active"], json!({"opacity": 1.0}));
        assert_eq!(karaoke["unspoken"], json!({"opacity": 0.5}));
        let marker = word_animation_payload("highlight");
        assert_eq!(marker["animationName"], json!("Highlighter"));
        assert_eq!(marker["spoken"], json!({"opacity": 0.5}));
        assert_eq!(marker["active"], json!({"opacity": 1.0}));
        assert_eq!(marker["unspoken"], json!({"opacity": 0.5}));
        assert_eq!(
            word_animation_payload("Custom")["spoken"]["color"],
            json!("#2EC971")
        );
        assert_eq!(
            word_animation_payload("Bounce")["active"]["bottomEm"],
            json!(0.22)
        );
        // 块的时间轨只属于「药丸高亮」这一格；内核名递进来的 `Highlight` 不带。
        assert!(highlight["active"].get("boxScale").is_none());
        for entry in WORD_ANIMATIONS {
            let payload = word_animation_payload(entry.catalog_id);
            assert_eq!(
                payload["active"].get("boxScale").is_some(),
                entry.catalog_id == "boxHighlight",
                "{} 的块时间轨写错了格",
                entry.catalog_id
            );
        }
    }

    #[test]
    fn the_pill_highlight_payload_carries_a_box_track_the_kernel_reads() {
        let pill = word_animation_payload("boxHighlight");
        assert_eq!(
            pill["active"]["boxScale"],
            json!([[0.0, 0.9], [0.7, 1.1], [1.0, 1.0]])
        );
        assert_eq!(
            pill["active"]["boxOpacity"],
            json!([[0.0, 0.75], [0.7, 1.0], [1.0, 1.0]])
        );
        assert_eq!(pill["active"]["boxEasing"], json!("sinInOut"));
        let track = crate::word_box_track(&pill["active"]).expect("内核必须认得这三个键");
        assert!(track.is_animated());
        assert_eq!(track.scale_at(0.0), Some(0.9));
        assert_eq!(track.opacity_at(0.0), Some(0.75));
    }

    #[test]
    fn every_cell_reaches_the_kernel() {
        // 每一格的载荷交给内核都选中那一格的连续轨（`none` 没有轨），分支名照目录。
        for entry in WORD_ANIMATIONS {
            let payload = word_animation_payload(entry.catalog_id);
            let animation = crate::word_animation(&json!({ "wordAnimation": payload }));
            assert_eq!(animation.name, entry.kernel, "{}", entry.catalog_id);
            let expected = (entry.catalog_id != "none").then_some(entry.catalog_id);
            assert_eq!(
                animation.motion_id.as_deref(),
                expected,
                "{}",
                entry.catalog_id
            );
        }
        // 逐字显现：没念到的词透明、不带阴影。
        let reveal =
            crate::word_animation(&json!({ "wordAnimation": word_animation_payload("reveal") }));
        assert_eq!(reveal.unspoken.opacity, Some(0.0));
        assert!(reveal.unspoken.shadow_off);
    }

    #[test]
    fn two_highlight_cells_write_two_distinct_payloads() {
        let pill = word_animation_payload("boxHighlight");
        let marker = word_animation_payload("highlight");
        assert_ne!(pill, marker);
        assert_eq!(pill["catalogId"], json!("boxHighlight"));
        assert_eq!(marker["catalogId"], json!("highlight"));
        assert_eq!(pill["active"]["borderRadiusEm"], json!(0.5));
        assert!(marker["active"].get("borderRadiusEm").is_none());
        assert!(marker["active"].get("backgroundColor").is_none());
    }
}
