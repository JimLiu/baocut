//! 文字预设包 ↔ `timeline.json` 的**落地闭环**（`docs/design/app-v2/text-pane-and-groups.md` §6.2）。
//!
//! 预设住在 `bcut-motion`，那边验的是「注册表内部自洽」（分类闭集、形状名与动画
//! 名都能查到配方）。它验不了的是这一层：`instantiate` 吐出来的载荷**能不能真
//! 的落进文档**——`Element` 的 `deny_unknown_fields`、`ENTER_PRESETS` / `EXIT_PRESETS` 闭集、
//! `dur` 的 0.1..=2.0 区间全在 `bcut-timeline` 这边。
//!
//! 少了这一条，「面板点了一下 → 内核报 invalid」只能等用户来发现。

use motion::preset_registry::{TextPresetCategory, text_presets, textpreset};
use timeline::schema::{Element, ElementKind, TimeValue, Track, TrackKind};

/// 每一条预设落地后都是**合法文档**：字段名认得、动画在闭集里、时长有序。
#[test]
fn every_builtin_text_preset_lands_as_a_valid_document() {
    let presets = text_presets();
    assert_eq!(presets.len(), 51, "内置目录条数变了就要同步这条断言");

    for recipe in presets {
        let elements = textpreset::instantiate(recipe, 3.0, 600.0);
        assert_eq!(elements.len(), recipe.content.len(), "{}", recipe.id);

        let parsed: Vec<Element> = elements
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let mut value = value.clone();
                // `addElement` 的 id 由内核分配；这里为了能校验先补一个。
                value["id"] = serde_json::json!(format!("el-{index}"));
                serde_json::from_value(value).unwrap_or_else(|error| {
                    panic!("{} 的第 {index} 个元素不是合法 Element：{error}", recipe.id)
                })
            })
            .collect();

        for element in &parsed {
            assert!(
                matches!(element.kind, ElementKind::Text | ElementKind::Shape),
                "{} 出现了非 text/shape 的 kind",
                recipe.id
            );
            let seconds = |value: &Option<TimeValue>| match value {
                Some(TimeValue::Seconds(seconds)) => *seconds,
                other => panic!("预设的时间点必须是秒，实为 {other:?}"),
            };
            let (start, end) = (seconds(&element.start), seconds(&element.end));
            assert!(start < end, "{} 的元素时长非正", recipe.id);
            assert!(start >= 3.0 - 1e-9, "{} 的成员早于预设起点", recipe.id);
        }

        // 整份文档过一遍校验：动画闭集、`dur` 区间、`place` 有限性都在这里红。
        let document = document_with(parsed);
        document
            .validate()
            .unwrap_or_else(|error| panic!("{} 校验不过：{error}", recipe.id));
    }
}

/// 分类分布 = 默认目录（simple 13 / title 10 / lowerThird 20 / other 8）。
/// 改目录会红——这正是需要被钉住的地方。
#[test]
fn the_catalogue_keeps_the_ported_category_split() {
    let counts = TextPresetCategory::ALL.map(|category| {
        text_presets()
            .iter()
            .filter(|recipe| recipe.category == category)
            .count()
    });
    assert_eq!(counts, [13, 10, 20, 8]);
}

/// 每条预设至少有一个文字成员：预设库落地后要认领「第一个文字成员」，
/// 一条纯形状的预设会让那条认领无声地落空。
#[test]
fn every_preset_carries_at_least_one_text_member() {
    for recipe in text_presets() {
        assert!(recipe.headline().is_some(), "{} 没有文字成员", recipe.id);
    }
}

fn document_with(elements: Vec<Element>) -> timeline::schema::TimelineDocument {
    let tracks = vec![Track {
        id: "text".to_owned(),
        kind: TrackKind::Overlay,
        name: Some("Text".to_owned()),
        hidden: false,
        locked: false,
        muted: false,
        elements,
    }];
    timeline::schema::TimelineDocument {
        tracks,
        ..Default::default()
    }
}
