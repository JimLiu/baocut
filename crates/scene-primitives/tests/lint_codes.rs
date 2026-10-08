//! 阶段 2 新增的诊断码（规范 §16）与「码表 ↔ 规范表」的一致性。
//!
//! 规范 §16 的表是**唯一的码清单**，此前没有任何测试把它和代码对起来
//! （`docs/archive/reviews/2026-08-02-cli-doc-audit.md` 已记过这个缺口）。

use std::path::{Path, PathBuf};

use scene_primitives::lint::{LINT_RULES, Severity, lint, resolve_error_code};
use serde_json::{Value, json};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repo root")
}

/// 一份最小可 resolve 的文档，元素上挂给定的 `animate`。
fn doc_with_animate(animate: Value) -> Value {
    json!({
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
        "scenes": [{"id": "s", "dur": 3}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end",
             "element": {"type": "text", "id": "el", "text": "hi",
                         "style": {"fontSize": 40},
                         "animate": animate}}
        ]}]
    })
}

fn codes(doc: &Value) -> Vec<&'static str> {
    lint(doc).into_iter().map(|d| d.rule).collect()
}

fn message(doc: &Value, rule: &str) -> String {
    lint(doc)
        .into_iter()
        .find(|d| d.rule == rule)
        .unwrap_or_else(|| panic!("没有 {rule}；实际：{:?}", codes(doc)))
        .message
}

fn doc_with_text(text: &str) -> Value {
    let mut doc = doc_with_animate(Value::Null);
    let el = &mut doc["tracks"][0]["clips"][0]["element"];
    el.as_object_mut().expect("element").remove("animate");
    el["text"] = json!(text);
    doc
}

/// 声明了 `font` 资产的文档：strict 字体模式（§11.2），系统字体不参与回退。
fn strict_doc_with_text(text: &str) -> Value {
    let mut doc = doc_with_text(text);
    doc["assets"] = json!({"body": {"type": "font", "src": "fonts/body.ttf"}});
    doc
}

#[test]
fn text_newline_and_color_emoji_warn() {
    assert!(codes(&doc_with_text("line one\nline two")).contains(&"text-newline"));
    assert!(codes(&strict_doc_with_text("attach 📎")).contains(&"text-emoji-no-glyph"));
    assert!(codes(&strict_doc_with_text("done 🟢")).contains(&"text-emoji-no-glyph"));
    assert!(codes(&strict_doc_with_text("\u{2764}\u{FE0F}")).contains(&"text-emoji-no-glyph"));
    let clean = codes(&strict_doc_with_text("你好，world → 100% ★"));
    assert!(
        !clean.contains(&"text-newline") && !clean.contains(&"text-emoji-no-glyph"),
        "{clean:?}"
    );
}

/// 显式 `style.textWrap` 或 `split.by: "line"` 启用多行排版（§6.2.2），`\n` 是硬换行。
#[test]
fn text_newline_is_quiet_in_paragraph_layout() {
    let mut wrapped = doc_with_text("line one\nline two");
    wrapped["tracks"][0]["clips"][0]["element"]["style"]["textWrap"] = json!("none");
    assert!(!codes(&wrapped).contains(&"text-newline"));
    let mut split = doc_with_text("line one\nline two");
    split["tracks"][0]["clips"][0]["element"]["split"] = json!({"by": "line"});
    assert!(!codes(&split).contains(&"text-newline"));
}

/// 旧单行路径不读 `textAlign`，整行恒居中（§6.2.2）：靠左 / 靠右不配 textWrap 会被静默丢掉。
#[test]
fn text_align_without_wrap_warns() {
    let with_style = |text: &str, style: Value, split: Option<Value>| {
        let mut doc = doc_with_text(text);
        let el = &mut doc["tracks"][0]["clips"][0]["element"];
        el["style"] = style;
        if let Some(split) = split {
            el["split"] = split;
        }
        codes(&doc).contains(&"text-align-needs-wrap")
    };
    let base = json!({"fontSize": 40, "width": 880});
    let styled = |extra: Value| {
        let mut style = base.clone();
        for (k, v) in extra.as_object().expect("object") {
            style[k] = v.clone();
        }
        style
    };
    // 靠左 / 靠右，以及单行路径一样不校验的非法值，都报
    for align in ["left", "right", "justify"] {
        assert!(
            with_style("hi", styled(json!({"textAlign": align})), None),
            "{align}"
        );
    }
    // 内容是 `$` 引用也照报：textAlign 与内容无关
    assert!(with_style(
        "$data.title",
        styled(json!({"textAlign": "left"})),
        None
    ));
    // 居中 = 旧行为；没写 / null / `$` 引用的 textAlign 不报
    assert!(!with_style("hi", base.clone(), None));
    assert!(!with_style(
        "hi",
        styled(json!({"textAlign": "center"})),
        None
    ));
    assert!(!with_style("hi", styled(json!({"textAlign": null})), None));
    assert!(!with_style(
        "hi",
        styled(json!({"textAlign": "$theme.align"})),
        None
    ));
    // 启用新排版（textWrap 或 split.by: "line"）后 textAlign 生效，不报
    for wrap in ["none", "word", "grapheme"] {
        assert!(
            !with_style(
                "hi",
                styled(json!({"textAlign": "right", "textWrap": wrap})),
                None
            ),
            "{wrap}"
        );
    }
    assert!(!with_style(
        "hi",
        styled(json!({"textAlign": "left"})),
        Some(json!({"by": "line"}))
    ));
    // 按词拆分不启用新排版，照报
    assert!(with_style(
        "hi",
        styled(json!({"textAlign": "left"})),
        Some(json!({"by": "word"}))
    ));
}

/// `align` / `justify` 只在 row / column / grid 下生效（§6.3）：缺省绝对布局里写了也被静默丢掉，
/// 子节点落在左上角——白板片里「圆角卡片的字贴在左上角」就是这样来的。
#[test]
fn align_without_flow_layout_warns() {
    let with_box_style = |style: Value| {
        let mut doc = doc_with_text("hi");
        let clip = &mut doc["tracks"][0]["clips"][0];
        let label = clip["element"].take();
        clip["element"] = json!({"type": "box", "id": "card",
                                 "style": style, "children": [label]});
        codes(&doc)
            .into_iter()
            .filter(|code| *code == "layout-align-ignored")
            .count()
    };
    let size = json!({"x": 120, "y": 80, "width": 420, "height": 140});
    let styled = |extra: Value| {
        let mut style = size.clone();
        for (k, v) in extra.as_object().expect("object") {
            style[k] = v.clone();
        }
        style
    };
    // 缺省布局与显式 absolute：一个节点只报一条，两个键都写也是一条
    assert_eq!(
        with_box_style(styled(json!({"align": "center", "justify": "center"}))),
        1
    );
    assert_eq!(with_box_style(styled(json!({"justify": "end"}))), 1);
    assert_eq!(
        with_box_style(styled(json!({"layout": "absolute", "align": "center"}))),
        1
    );
    // row / column / grid 生效；没写、null、`$` 引用的 layout 不报
    for layout in ["row", "column", "grid"] {
        assert_eq!(
            with_box_style(styled(
                json!({"layout": layout, "align": "center", "justify": "center"})
            )),
            0,
            "{layout}"
        );
    }
    assert_eq!(with_box_style(size.clone()), 0);
    assert_eq!(with_box_style(styled(json!({"align": null}))), 0);
    assert_eq!(
        with_box_style(styled(json!({"layout": "$vars.layout", "align": "center"}))),
        0
    );
    let mut doc = doc_with_text("hi");
    doc["tracks"][0]["clips"][0]["element"]["style"]["justify"] = json!("center");
    assert!(message(&doc, "layout-align-ignored").contains("layout: \"column\""));
}

/// 没声明 `font` 资产时由系统彩色 emoji 字体画成位图（§14.4 `DrawBitmap`），不报。
#[test]
fn color_emoji_is_quiet_outside_strict_font_mode() {
    for text in ["attach 📎", "done 🟢", "\u{2764}\u{FE0F}"] {
        let found = codes(&doc_with_text(text));
        assert!(!found.contains(&"text-emoji-no-glyph"), "{text}: {found:?}");
    }
    // 只有 image 资产不算 strict
    let mut doc = doc_with_text("attach 📎");
    doc["assets"] = json!({"logo": {"type": "image", "src": "img/logo.png"}});
    assert!(!codes(&doc).contains(&"text-emoji-no-glyph"));
}

#[test]
fn preset_unknown_still_fires() {
    let doc = doc_with_animate(json!({"enter": {"preset": "notAPreset", "dur": 0.4}}));
    assert!(codes(&doc).contains(&"preset-unknown"));
}

#[test]
fn preset_version_unknown_fires_for_builtin_and_manifest_presets() {
    let doc = doc_with_animate(json!({
        "enter": {"preset": "motion.moveIn", "presetVersion": 9, "dur": 0.4}
    }));
    assert!(codes(&doc).contains(&"preset-version-unknown"));
    // 冻结的 bcf.*@1 走另一条路径，同样不得静默用最新
    let doc = doc_with_animate(json!({
        "enter": {"preset": "fadeIn", "presetVersion": 2, "dur": 0.4}
    }));
    assert!(codes(&doc).contains(&"preset-version-unknown"));
}

#[test]
fn preset_param_unknown_and_missing_fire() {
    let doc = doc_with_animate(json!({
        "enter": {"preset": "motion.moveIn", "dur": 0.4, "params": {"nope": 1}}
    }));
    assert!(codes(&doc).contains(&"preset-param-unknown"));

    // 类型不符复用 unknown（规范 §16 没有独立的类型码），message 说明原因
    let doc = doc_with_animate(json!({
        "enter": {"preset": "motion.moveIn", "dur": 0.4, "params": {"direction": "sideways"}}
    }));
    let msg = message(&doc, "preset-param-unknown");
    assert!(msg.contains("direction"), "{msg}");
}

#[test]
fn relative_basis_unresolved_fires_when_the_target_has_no_layout_box() {
    // 字幕 lane 的入场模板是逐条目锚定的，没有单一自身盒。
    let doc = json!({
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
        "scenes": [{"id": "s", "dur": 3}],
        "presets": {"laneRise": {"keyframes": [{"prop": "y", "frames": [
            {"t": "0%", "v": {"value": 1.0, "basis": "selfWidth"}},
            {"t": "100%", "v": 0}]}]}},
        "tracks": [{"id": "cap", "kind": "captions", "clips": [
            {"id": "c", "start": 0, "end": "@s.end",
             "lanes": [{"id": "main", "animate": {"enter": {"preset": "laneRise", "dur": 0.2}}}],
             "captions": [{"at": 0.5, "until": 2.0, "lines": {"main": "hi"}}]}
        ]}]
    });
    assert!(
        codes(&doc).contains(&"relative-basis-unresolved"),
        "{:?}",
        lint(&doc)
            .iter()
            .map(|d| (d.rule, &d.message))
            .collect::<Vec<_>>()
    );
}

#[test]
fn relative_lengths_on_disallowed_properties_are_a_schema_error() {
    let doc = doc_with_animate(json!({"keyframes": [
        {"prop": "opacity", "frames": [
            {"t": "0%", "v": {"value": 0.1, "basis": "canvasWidth"}},
            {"t": "100%", "v": 1}]}
    ]}));
    let msg = message(&doc, "schema");
    assert!(msg.contains("opacity"), "{msg}");
}

#[test]
fn preset_compose_cycle_maps_to_its_own_code() {
    // 内置配方里不存在环（`tests/families.rs` 守着），所以这里直接验映射函数：
    // resolve 期的 `MotionError::PresetComposeCycle` 的 Display 前缀就是码。
    assert_eq!(
        resolve_error_code("preset-compose-cycle: motion.a → motion.b → motion.a"),
        "preset-compose-cycle"
    );
    let error = motion::MotionError::PresetComposeCycle("a → b → a".into());
    assert_eq!(
        resolve_error_code(&error.to_string()),
        "preset-compose-cycle"
    );
}

#[test]
fn every_resolve_error_prefix_maps_to_the_code_it_names() {
    for (prefix, code) in scene_primitives::lint::RESOLVE_ERROR_CODES {
        let msg = format!("{prefix}: 细节");
        assert_eq!(resolve_error_code(&msg), *code, "{prefix}");
    }
    assert_eq!(resolve_error_code("完全不认识的消息"), "resolve-error");
    // `component-` 是刻意保留的宽前缀：两种消息都归 component-cycle
    assert_eq!(
        resolve_error_code("component-unknown: x"),
        "component-cycle"
    );
    assert_eq!(resolve_error_code("component-cycle: x"), "component-cycle");
}

#[test]
fn preset_alias_used_is_info_and_suggests_the_canonical_form() {
    let doc = doc_with_animate(json!({"enter": {"preset": "springPop", "dur": 0.4}}));
    let msg = message(&doc, "preset-alias-used");
    assert!(msg.contains("motion.backIn"), "{msg}");
    assert_eq!(
        lint(&doc)
            .into_iter()
            .find(|d| d.rule == "preset-alias-used")
            .unwrap()
            .severity,
        Severity::Info
    );
    // canonical 写法不再提示
    let doc = doc_with_animate(json!({"enter": {"preset": "motion.backIn", "dur": 0.4}}));
    assert!(!codes(&doc).contains(&"preset-alias-used"));
}

#[test]
fn preset_sprawl_counts_families_not_cards() {
    // 同一个 family 的四个方向 = 一种词汇，不该触发。
    let mut children = Vec::new();
    for (i, direction) in ["left", "right", "up", "down"].iter().enumerate() {
        children.push(json!({
            "type": "text", "id": format!("t{i}"), "text": "x",
            "animate": {"enter": {"preset": "motion.backIn", "dur": 0.4,
                                  "params": {"direction": direction}}}
        }));
    }
    let doc = json!({
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
        "scenes": [{"id": "s", "dur": 3}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end",
             "element": {"type": "box", "id": "root", "children": children}}
        ]}]
    });
    assert!(!codes(&doc).contains(&"preset-sprawl"), "{:?}", codes(&doc));

    // 五个**不同**家族才触发
    let ids = [
        "motion.moveIn",
        "motion.scaleIn",
        "motion.backIn",
        "motion.rotateIn",
        "motion.blurIn",
    ];
    let children: Vec<Value> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            json!({"type": "text", "id": format!("t{i}"), "text": "x",
                   "animate": {"enter": {"preset": id, "dur": 0.4}}})
        })
        .collect();
    let doc = json!({
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
        "scenes": [{"id": "s", "dur": 3}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end",
             "element": {"type": "box", "id": "root", "children": children}}
        ]}]
    });
    let msg = message(&doc, "preset-sprawl");
    assert!(msg.contains("backIn"), "{msg}");
}

#[test]
fn motion_replace_overlap_fires_on_two_overlapping_replace_tracks() {
    // 两条裸 keyframes 通道写同一个属性、时间交叠 ⇒ 后声明按 order 覆盖。
    let doc = doc_with_animate(json!({"keyframes": [
        {"prop": "x", "frames": [{"t": "0%", "v": 0}, {"t": "80%", "v": 100}]},
        {"prop": "x", "frames": [{"t": "40%", "v": 0}, {"t": "100%", "v": -50}]}
    ]}));
    let msg = message(&doc, "motion-replace-overlap");
    assert!(msg.contains("\"x\""), "{msg}");

    // 不交叠就不报
    let doc = doc_with_animate(json!({"keyframes": [
        {"prop": "x", "frames": [{"t": "0%", "v": 0}, {"t": "30%", "v": 100}]},
        {"prop": "x", "frames": [{"t": "60%", "v": 0}, {"t": "100%", "v": -50}]}
    ]}));
    assert!(!codes(&doc).contains(&"motion-replace-overlap"));
}

#[test]
fn add_and_multiply_tracks_never_trigger_replace_overlap() {
    // `motion.moveIn`（y=add）+ `motion.pulse`（scale=multiply）刻意叠加。
    let doc = doc_with_animate(json!({
        "enter": {"preset": "motion.moveIn", "dur": 0.5},
        "emphasis": [{"preset": "motion.pulse", "at": 0.2, "dur": 0.6}]
    }));
    assert!(
        !codes(&doc).contains(&"motion-replace-overlap"),
        "{:?}",
        codes(&doc)
    );
}

/// 稳定 id 纪律（直接编辑回写方案 §4.3-1）：舞台编辑按元素路径寻址。
#[test]
fn element_id_rules_guard_the_addressing_of_stage_edits() {
    let doc = |children: Value| {
        json!({
            "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
            "scenes": [{"id": "s", "dur": 3, "desc": "x"}],
            "tracks": [{"id": "main", "kind": "visual", "clips": [
                {"id": "c", "start": 0, "end": "@s.end",
                 "element": {"type": "box", "id": "root", "children": children}}
            ]}]
        })
    };

    // 都有 id：两条规则都不响
    let clean = doc(json!([
        {"type": "text", "id": "a", "text": "甲"},
        {"type": "text", "id": "b", "text": "乙"}
    ]));
    assert!(
        !codes(&clean).contains(&"element-id-missing"),
        "{:?}",
        codes(&clean)
    );
    assert!(!codes(&clean).contains(&"element-id-duplicate"));

    // 匿名节点 → warn（不挡导出）
    let anonymous = doc(json!([{"type": "text", "text": "甲"}]));
    assert!(codes(&anonymous).contains(&"element-id-missing"));
    assert_eq!(
        lint(&anonymous)
            .into_iter()
            .find(|d| d.rule == "element-id-missing")
            .unwrap()
            .severity,
        Severity::Warn
    );

    // 同树重名 → error（一条元素路径会指向两个节点）
    let duplicated = doc(json!([
        {"type": "text", "id": "a", "text": "甲"},
        {"type": "text", "id": "a", "text": "乙"}
    ]));
    let msg = message(&duplicated, "element-id-duplicate");
    assert!(msg.contains("\"a\""), "{msg}");
    assert_eq!(
        lint(&duplicated)
            .into_iter()
            .find(|d| d.rule == "element-id-duplicate")
            .unwrap()
            .severity,
        Severity::Error
    );

    // 作用域是**单棵树**：跨 clip 重名合法（路径本来就从 clip 根起算）
    let cross_clip = json!({
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
        "scenes": [{"id": "s", "dur": 3, "desc": "x"}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c1", "start": 0, "end": 1,
             "element": {"type": "text", "id": "title", "text": "甲"}},
            {"id": "c2", "start": 1, "end": "@s.end",
             "element": {"type": "text", "id": "title", "text": "乙"}}
        ]}]
    });
    assert!(
        !codes(&cross_clip).contains(&"element-id-duplicate"),
        "{:?}",
        codes(&cross_clip)
    );
}

#[test]
#[ignore = "读 v2 的 BCF 规范 docs/design/bcf/baocut-format-spec/16.md：v3 不用 BCF，没有带来这份规范"]
fn every_declared_rule_appears_in_the_spec_section_sixteen_table() {
    // `schema` / `resolve-error` 是两个**结构层**的兜底码：规范 §16 的正文
    // （而不是表）描述它们。其余必须能 grep 到。
    const STRUCTURAL: &[&str] = &["schema", "resolve-error"];
    let spec = std::fs::read_to_string(spec_path()).expect("spec");
    let mut missing: Vec<&str> = Vec::new();
    for (rule, _) in LINT_RULES {
        if STRUCTURAL.contains(rule) {
            continue;
        }
        if !spec.contains(&format!("`{rule}`")) {
            missing.push(rule);
        }
    }
    assert!(
        missing.is_empty(),
        "这些码不在 docs/design/bcf/baocut-format-spec/16.md 的表里：{missing:?}"
    );
}

/// 规范已按章拆分（主文件只剩目录），§16 的码表在章节文件里。
fn spec_path() -> PathBuf {
    let path = repo_root().join("docs/design/bcf/baocut-format-spec/16.md");
    assert!(Path::new(&path).is_file(), "{path:?}");
    path
}

#[test]
fn the_rule_table_has_no_duplicates() {
    let mut seen: Vec<&str> = Vec::new();
    for (rule, _) in LINT_RULES {
        assert!(!seen.contains(rule), "{rule} 重复");
        seen.push(rule);
    }
}

/// 效果参数通道 `effects[N].<param>`（§6.6）：合法通道放行，越界下标 / 未知参数 /
/// 非数值参数都是 error。
#[test]
fn effect_param_channels_are_checked_against_the_effect_stack() {
    let with = |prop: &str| {
        let mut doc = doc_with_animate(json!({"keyframes": [
            {"prop": prop, "frames": [{"t": 0, "v": 0.0}, {"t": 1, "v": 1.0}]}
        ]}));
        doc["tracks"][0]["clips"][0]["element"]["effects"] = json!([
            {"preset": "filter.bloom", "presetVersion": 1},
            {"preset": "filter.outline", "presetVersion": 1}
        ]);
        lint(&doc)
            .into_iter()
            .filter(|d| d.severity == Severity::Error && d.rule != "scene-desc-missing")
            .map(|d| (d.rule, d.message))
            .collect::<Vec<_>>()
    };
    assert!(
        with("effects[0].intensity").is_empty(),
        "{:?}",
        with("effects[0].intensity")
    );
    assert!(with("effects[1].radius").is_empty());

    let out_of_range = with("effects[2].intensity");
    assert!(
        out_of_range.iter().any(|(_, m)| m.contains("effects[2]")),
        "{out_of_range:?}"
    );

    let unknown = with("effects[0].nope");
    assert!(
        unknown
            .iter()
            .any(|(rule, _)| *rule == "preset-param-unknown"),
        "{unknown:?}"
    );

    let color = with("effects[1].color");
    assert!(
        color.iter().any(|(_, m)| m.contains("不是数值")),
        "{color:?}"
    );

    // 非规范写法仍然是 allowlist 错误。
    let malformed = with("effects[01].intensity");
    assert!(
        malformed.iter().any(|(_, m)| m.contains("allowlist")),
        "{malformed:?}"
    );
}

#[test]
fn proc_nodes_lint_clean_and_bad_params_surface_as_errors() {
    let with = |element: Value| {
        let mut doc = doc_with_animate(Value::Null);
        doc["tracks"][0]["clips"][0]["element"] = element;
        lint(&doc)
            .into_iter()
            .filter(|d| d.severity == Severity::Error && d.rule != "scene-desc-missing")
            .map(|d| (d.rule, d.message))
            .collect::<Vec<_>>()
    };
    for good in [
        json!({"type":"proc","id":"r","proc":"rain","seed":4,"params":{"density":0.7,"wind":0.5}}),
        json!({"type":"proc","id":"s","proc":"splash","params":{"at":0.5,"count":30}}),
        json!({"type":"proc","id":"k","proc":"sky","params":{
            "stars":0.8,"milkyWay":0.4,"cloud":0.6,"moon":{"x":0.7,"y":0.2,"r":0.05,"glow":0.8}}}),
    ] {
        let errors = with(good.clone());
        assert!(errors.is_empty(), "{good}: {errors:?}");
    }
    let bad = with(json!({"type":"proc","id":"r","proc":"rain","params":{"density":3}}));
    assert!(
        bad.iter().any(|(_, m)| m.contains("proc.rain.density")),
        "{bad:?}"
    );
    let unknown = with(json!({"type":"proc","id":"r","proc":"hail"}));
    assert!(!unknown.is_empty());
}

/// `program` 资产的 `src` / `imports` / `files` 用 `..` 越出文档所在目录 → `program-path-escape`
/// （§6.5.3），指针落到具体那一项；消息写明边界、违规路径与改法。先下去再上来没出边界的、
/// 在目录内的路径都不报。
#[test]
fn program_paths_escaping_the_document_directory_are_flagged_where_they_are() {
    let with = |program: Value| {
        let mut doc = doc_with_text("hi");
        let mut entry = json!({"type": "program", "width": 320, "height": 180,
                               "fps": 30, "frames": 30});
        entry
            .as_object_mut()
            .unwrap()
            .extend(program.as_object().unwrap().clone());
        doc["assets"] = json!({ "film": entry });
        lint(&doc)
            .into_iter()
            .filter(|d| d.rule == "program-path-escape")
            .map(|d| (d.severity, d.pointer, d.message))
            .collect::<Vec<_>>()
    };

    let inside = with(json!({
        "src": "film/Film.tsx",
        "imports": {"lib": "./film/lib/../lib.ts"},
        "files": ["film/data.json", "img/a/../b.png"]
    }));
    assert!(inside.is_empty(), "{inside:?}");

    let escaped = with(json!({
        "src": "../film/X.tsx",
        "imports": {"remotion": "../shim/remotion.ts", "a/b": "../x.ts"},
        "files": ["ok.png", "../art/logo.svg"]
    }));
    // lint 的输出按指针排序
    let pointers: Vec<&str> = escaped.iter().map(|(_, p, _)| p.as_str()).collect();
    assert_eq!(
        pointers,
        [
            "/assets/film/files/1",
            "/assets/film/imports/a~1b",
            "/assets/film/imports/remotion",
            "/assets/film/src",
        ],
        "{escaped:?}"
    );
    assert!(escaped.iter().all(|(s, _, _)| *s == Severity::Error));
    let (_, _, src) = &escaped[3];
    for needle in ["\"../film/X.tsx\"", "文档所在目录", "项目根", "模块旁边"] {
        assert!(src.contains(needle), "消息缺 {needle}：{src}");
    }
    assert!(escaped[0].2.contains("files[1]"), "{:?}", escaped[0]);
    assert!(escaped[1].2.contains("imports.a/b"), "{:?}", escaped[1]);
}

/// 场景数上限 `1..400`（§5.1 / §16 Schema 层）：80 与 400 场通过，401 场在 `/scenes` 报
/// `schema` 错误，消息写明上限。一场一个 clip，确认这种规模下 lint 能走完 resolve。
#[test]
fn scene_count_limit_is_four_hundred() {
    let doc_with_scenes = |n: usize| {
        let scenes: Vec<Value> = (0..n)
            .map(|i| json!({"id": format!("s{i}"), "dur": 1, "desc": "镜头"}))
            .collect();
        let clips: Vec<Value> = (0..n)
            .map(|i| {
                json!({"id": format!("c{i}"), "start": format!("@s{i}.start"),
                       "end": format!("@s{i}.end"),
                       "element": {"type": "text", "id": format!("t{i}"), "text": "hi",
                                   "style": {"fontSize": 40}}})
            })
            .collect();
        json!({
            "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
            "scenes": scenes,
            "tracks": [{"id": "main", "kind": "visual", "clips": clips}]
        })
    };
    let scene_schema = |n: usize| {
        lint(&doc_with_scenes(n))
            .into_iter()
            .filter(|d| d.pointer == "/scenes")
            .map(|d| (d.rule, d.severity, d.message))
            .collect::<Vec<_>>()
    };
    for n in [80, 400] {
        let found = scene_schema(n);
        assert!(found.is_empty(), "{n} 场不该报场景数：{found:?}");
        let errors: Vec<_> = lint(&doc_with_scenes(n))
            .into_iter()
            .filter(|d| d.severity == Severity::Error)
            .collect();
        assert!(errors.is_empty(), "{n} 场：{errors:?}");
    }
    let over = scene_schema(401);
    assert_eq!(over.len(), 1, "{over:?}");
    assert_eq!(over[0].0, "schema");
    assert_eq!(over[0].1, Severity::Error);
    assert!(
        over[0].2.contains("401") && over[0].2.contains("1..400"),
        "{over:?}"
    );
    assert_eq!(scene_schema(0).len(), 1);
}

/// clip 根元素写 `style.x` / `style.y` 不生效（根节点从画布原点布局，§6.4）→ `clip-root-xy-ignored`
/// （warn），指针落到第一处生效不了的键，消息给改法（包进全画幅 Box）。写 0、写在子节点上、
/// 用 `$` 引用（值只有 resolve 才知道）都不报。
#[test]
fn clip_root_style_xy_warns_because_the_root_is_laid_out_at_the_origin() {
    let with_root = |style: Value| {
        let mut doc = doc_with_text("hi");
        doc["tracks"][0]["clips"][0]["element"]["style"] = style;
        lint(&doc)
            .into_iter()
            .filter(|d| d.rule == "clip-root-xy-ignored")
            .map(|d| (d.severity, d.pointer, d.message))
            .collect::<Vec<_>>()
    };
    let hits = with_root(json!({"fontSize": 40, "x": 160, "y": 460}));
    assert_eq!(hits.len(), 1, "{hits:?}");
    let (severity, pointer, message) = &hits[0];
    assert_eq!(*severity, Severity::Warn);
    assert_eq!(pointer, "/tracks/0/clips/0/element/style/x");
    for needle in ["\"c\"", "x=160", "y=460", "画布原点", "Box"] {
        assert!(message.contains(needle), "缺 {needle}：{message}");
    }
    let only_y = with_root(json!({"fontSize": 40, "y": "25%"}));
    assert_eq!(only_y.len(), 1, "{only_y:?}");
    assert_eq!(only_y[0].1, "/tracks/0/clips/0/element/style/y");

    for quiet in [
        json!({"fontSize": 40}),
        json!({"fontSize": 40, "x": 0, "y": 0}),
        json!({"fontSize": 40, "x": "0%"}),
        json!({"fontSize": 40, "x": "$vars.left"}),
    ] {
        assert!(with_root(quiet.clone()).is_empty(), "{quiet}");
    }

    // 子节点上的 x/y 照常生效，不报
    let mut doc = doc_with_text("hi");
    doc["tracks"][0]["clips"][0]["element"] = json!({
        "type": "box", "id": "root", "style": {"width": 1920, "height": 1080},
        "children": [{"type": "text", "id": "t", "text": "hi",
                      "style": {"fontSize": 40, "x": 160, "y": 460}}]
    });
    assert!(!codes(&doc).contains(&"clip-root-xy-ignored"));
}

/// `preset-unknown` 不再被更早的 resolve 错误吞掉（§16）：resolve 快速失败，一份文档里
/// 先撞上的 `motion-unsupported`（报成 `schema`，指针 `/`）曾让后面 `animate.parts` 里
/// 写错的 preset 一直看不见，改一处才冒一处。现在未知 preset 在静态阶段就按引用处报，
/// 与 resolve 错误同时出现；flow / parts 的 `op: "preset"` 条目也算引用。
#[test]
fn preset_unknown_is_reported_alongside_an_earlier_resolve_error() {
    let doc = json!({
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
        "scenes": [{"id": "a", "dur": 1}, {"id": "b", "dur": 1}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c-rx", "start": "@a", "end": "@a.end",
             "element": {"type": "box", "id": "rx",
                         "style": {"width": 1920, "height": 1080},
                         "animate": {"keyframes": [{"prop": "rotationX",
                             "frames": [{"t": "@a", "v": 0}, {"t": "@a.end", "v": 80}]}]}}},
            {"id": "c-parts", "start": "@b", "end": "@b.end",
             "element": {"type": "text", "id": "t", "text": "FROM FIRE",
                         "style": {"fontSize": 96}, "split": {"by": "word"},
                         "animate": {"parts": {"op": "stagger", "gap": 0.1, "parts": true,
                             "item": {"op": "preset", "preset": "motion.blurParts",
                                      "presetVersion": 1}}}}}
        ]}]
    });
    let diags = lint(&doc);
    assert!(
        diags.iter().any(|d| d.rule == "schema" && d.pointer == "/"),
        "{diags:?}"
    );
    let unknown: Vec<_> = diags
        .iter()
        .filter(|d| d.rule == "preset-unknown")
        .collect();
    assert_eq!(unknown.len(), 1, "{diags:?}");
    assert_eq!(
        unknown[0].pointer,
        "/tracks/0/clips/1/element/animate/parts/item/preset"
    );
    assert_eq!(unknown[0].severity, Severity::Error);
    assert!(
        unknown[0].message.contains("motion.blurParts"),
        "{}",
        unknown[0].message
    );
}

/// 同一个未知 preset 静态报过，resolve 失败时的那条（指针 `/`）不再重复；
/// 已知的 manifest / 冻结配方 / 项目级 preset 都不报。
#[test]
fn preset_unknown_is_reported_once_at_the_reference() {
    let doc = doc_with_animate(json!({"enter": {"preset": "notAPreset", "dur": 0.4}}));
    let unknown: Vec<_> = lint(&doc)
        .into_iter()
        .filter(|d| d.rule == "preset-unknown")
        .collect();
    assert_eq!(unknown.len(), 1, "{unknown:?}");
    assert_eq!(
        unknown[0].pointer,
        "/tracks/0/clips/0/element/animate/enter/preset"
    );

    let flow = doc_with_animate(json!({"flow": {"op": "sequence", "items": [
        {"op": "preset", "preset": "motion.fadeIn"},
        {"op": "wait", "dur": 0.2},
        {"op": "preset", "preset": "motion.nope"}
    ]}}));
    let unknown: Vec<_> = lint(&flow)
        .into_iter()
        .filter(|d| d.rule == "preset-unknown")
        .collect();
    assert_eq!(unknown.len(), 1, "{unknown:?}");
    assert_eq!(
        unknown[0].pointer,
        "/tracks/0/clips/0/element/animate/flow/items/2/preset"
    );

    for known in [
        json!({"enter": {"preset": "motion.moveIn", "dur": 0.4}}),
        json!({"enter": {"preset": "fadeIn", "dur": 0.4}}),
        json!({"enter": {"preset": "mine", "dur": 0.4}}),
        json!({"flow": {"op": "preset", "preset": "motion.blurIn"}}),
    ] {
        let mut doc = doc_with_animate(known.clone());
        doc["presets"] = json!({"mine": {"keyframes": [
            {"prop": "opacity", "frames": [{"t": "0%", "v": 0}, {"t": "100%", "v": 1}]}
        ]}});
        assert!(
            !codes(&doc).contains(&"preset-unknown"),
            "{known}: {:?}",
            lint(&doc)
        );
    }
}

/// flow / parts 的 `op: "preset"` 不读项目级 `presets`（resolve 直接查注册表）：
/// 写项目级名字 resolve 就失败，lint 在引用处报并说明只能用在 enter / exit / emphasis。
#[test]
fn flow_preset_ops_do_not_see_project_presets() {
    let mut doc = doc_with_animate(json!({"flow": {"op": "preset", "preset": "mine"}}));
    doc["presets"] = json!({"mine": {"keyframes": [
        {"prop": "opacity", "frames": [{"t": "0%", "v": 0}, {"t": "100%", "v": 1}]}
    ]}});
    let err = scene_primitives::Resolver::new(doc.clone(), None)
        .and_then(|mut r| r.resolve())
        .err()
        .expect("resolve 应当拒绝");
    assert!(err.to_string().starts_with("preset-unknown"), "{err}");
    let unknown: Vec<_> = lint(&doc)
        .into_iter()
        .filter(|d| d.rule == "preset-unknown")
        .collect();
    assert_eq!(unknown.len(), 1, "{unknown:?}");
    assert_eq!(
        unknown[0].pointer,
        "/tracks/0/clips/0/element/animate/flow/preset"
    );
    assert!(
        unknown[0].message.contains("enter / exit / emphasis"),
        "{}",
        unknown[0].message
    );
}
