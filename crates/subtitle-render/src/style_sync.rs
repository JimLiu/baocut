//! 字幕样式扁平根键 ↔ `voiceInkContexts` 的双向对账。
//!
//! `studio/style.json` 同时承载两层真相：
//!
//! - `voiceInkContexts.{sub,bi}`：Mac 编辑器的**无损**模型，两个上下文各有
//!   `orig`/`trans` 两行的完整外观、几何与逐词动画；
//! - 扁平根键：**单上下文**投影，Web 预览、GPUI 面板、烧录端
//!   `studio_export::resolve_line_style` 与六种可编辑工程导出都直接读它。
//!
//! Mac 写入时两层一起刷新（`ProductSubtitleStyleAdapter.replacingStyle` →
//! `mergeFlat`，`apps/mac/Sources/VoiceInk/Adapters/ProductSubtitleStyleAdapter.swift:36-50`
//! 与 `:222-282`），读取时 contexts 解得出来就整块采用（`:27-33`）。CLI 的两条写
//! 路径过去只碰扁平层：
//!
//! - `bcut studio apply` 的 `style` 覆盖层做顶层浅合并，contexts 原封不动 ——
//!   Web 改了模式/字号，apply 之后 Mac 仍然读旧 contexts；
//! - `POST __bcut/style/apply` 是整份替换 —— 请求体不带 contexts（GPUI 的
//!   `adapters/stylepane.rs` 只写根键与行级 partial）时会把盘上的 contexts 整块删掉。
//!
//! 本模块把两条路径收束到同一套语义：**先把本次明确改动的扁平键下沉到 contexts
//! （flat → contexts），再用 contexts 重算扁平投影（contexts → flat）**。顺序不能
//! 颠倒：只改根键的客户端会把读到的旧 contexts 原样带回来，先重算就会把用户刚做的
//! 改动盖回去。
//!
//! 「哪个上下文」的判定与 Mac 反向。Mac 靠 diff 找出被改的那个 set，CLI 没有这个
//! 信息，只能从**文档自己的字幕轨集**反推：含译文轨 → `bi`，否则 → `sub`（`sub`
//! 的 mode 被 `SubtitleStyleContexts.setMode` 钉死成单行，不携带意图）。轨集只有
//! 原文轨、而用户正在编辑 `bi` 那套外观时会与 `sub` 撞在同一个判定上，所以两条写
//! 路径都接受一个可选的 `ctx` 提示（`"sub"`/`"bi"`），页面知道自己在哪个 tab 时
//! 应当带上。
//!
//! # 轨集是文档真相，`mode` 是只写的兼容投影
//!
//! 画面/timeline 上摆着哪几条字幕轨由根键 `tracks` 声明，读取一律走
//! [`resolve_track_set`](crate::resolve_track_set)（读时迁移，绝不
//! 写回）。扁平 `mode` 与 `voiceInkContexts.bi.mode` 降为由轨集派生的兼容字段，
//! 每次落盘经 [`canonicalize_track_set`] 统一回写——历史写者留下的文档仍带它们，靠
//! resolve 的「不一致以兼容信号为准」保持互通（信号取 `bi.mode`，不可解析才回落
//! 根 `mode`）。
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

pub const CONTEXTS_KEY: &str = "voiceInkContexts";

/// 字幕样式的两个持久上下文——定义已随写事务信封下沉到
/// `bcut-subtitle-render`（[`StyleContext::of_style`] 也在那边），这里只保留原路径。
pub use crate::StyleContext;
pub use crate::text_design::validate_motion_tree;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BilingualScope {
    Common,
    Original,
    Translation,
}

/// 与 `mergeFlat` 一一对应的「整组」键：落在被选中上下文的 set 上。
const SET_KEYS: &[&str] = &[
    "x",
    "y",
    "width",
    "scale",
    "rotation",
    "verticalAlign",
    "transition",
];

/// 只属于双语上下文的 set 键：`sub` 被钉死成单行，这些键在它身上没有意义
/// （`SubtitleStyleContexts.swift:466-481`）。
const BI_SET_KEYS: &[&str] = &["mode", "order", "gap", "backgroundMode"];

/// 扁平外观键 → 上下文行样式字段。同名的那一批。
const LOOK_KEYS: &[(&str, &str)] = &[
    ("textMotion", "textMotion"),
    ("wordBackground", "wordBackground"),
    ("fontSizeBasis", "fontSizeBasis"),
    ("backgroundPaddingY", "backgroundPaddingY"),
    ("fontColor", "fontColor"),
    ("backgroundColor", "backgroundColor"),
    ("backgroundPadding", "backgroundPadding"),
    ("backgroundStyle", "backgroundStyle"),
    ("borderRadius", "borderRadius"),
    ("align", "textAlign"),
    ("lineHeight", "lineHeight"),
    ("letterSpacing", "letterSpacing"),
    ("textTransform", "textTransform"),
    ("underline", "underline"),
    ("textOutline", "textOutline"),
    ("dropShadow", "dropShadow"),
    ("glow", "glow"),
];

/// 需要改写字段名或形状的外观键，与上面那批合起来就是 `linePartial` 的全集。
const LOOK_KEYS_MAPPED: &[&str] = &[
    "fontFamily",
    "bold",
    "italic",
    "background",
    "outline",
    "wordAnimation",
];

/// 尺寸键：不直接落字段，走比例链（见 `sink_sizes`）。
const SIZE_KEYS: &[&str] = &["fontSize", "bilingualOrigScale", "transScale"];

/// 行级 partial：整块视为一次「明确改动」，逐键下沉到对应行。
const LINE_PARTIAL_KEYS: &[(&str, &str)] = &[("origStyle", "orig"), ("transStyle", "trans")];

/// `contexts` 是否是可用的两上下文结构。与 Mac `decode(StyleContexts.self, …)`
/// 解不出来就回退同义：结构不对就当没有，绝不半途改写。
pub fn valid_contexts(contexts: &Value) -> bool {
    let Some(contexts) = contexts.as_object() else {
        return false;
    };
    ["sub", "bi"].iter().all(|name| {
        contexts.get(*name).is_some_and(|set| {
            set.is_object()
                && ["orig", "trans"]
                    .iter()
                    .all(|line| set.get(*line).is_none_or(Value::is_object))
        })
    })
}

/// 本次写入代表的上下文：显式提示优先，其次按文档轨集判定。
///
/// 无提示时走轨集（[`StyleContext::of_style`]）而不是扁平 `mode`：`mode` 已经降为
/// 由轨集派生的兼容字段，这里再读一次它就是第二处判据。这一条保住 apps/mac 不带
/// `ctx` 的 `/style/apply`——含译文轨的文档照样落在 `bi` 上下文。
fn selected_context(style: &Value, hint: Option<&str>) -> &'static str {
    match hint {
        Some("bi") => "bi",
        Some("sub") => "sub",
        _ => StyleContext::of_style(style).as_str(),
    }
}

/// 被选中上下文里承载扁平根字号与外观的那一行 —— 与 `mergeFlat` 的
/// `let line = bilingual && set.mode == "trans" ? set.trans : set.orig` 同一判据。
fn selected_line(contexts: &Value, ctx: &str) -> &'static str {
    if ctx == "bi" && contexts["bi"]["mode"].as_str() == Some("trans") {
        "trans"
    } else {
        "orig"
    }
}

/// `after` 相对 `before` 明确改动的根键（不含 contexts 自身与版本戳）。
///
/// **被删掉的键也算改动**：Mac 用「删键」表达「没有意见」（`verticalAlign` 的块级
/// 锚点清除就是删键），漏掉它会让下沉看不见这次清除，再被重算原样加回去。
pub fn changed_flat_keys(before: &Value, after: &Value) -> BTreeSet<String> {
    let empty = Map::new();
    let before = before.as_object().unwrap_or(&empty);
    let after = after.as_object().unwrap_or(&empty);
    let tracked = |key: &String| key != CONTEXTS_KEY && key != "bcutStudioStyle";
    after
        .iter()
        .filter(|(key, value)| tracked(key) && before.get(*key) != Some(*value))
        .map(|(key, _)| key.clone())
        .chain(
            before
                .keys()
                .filter(|key| tracked(key) && !after.contains_key(*key))
                .cloned(),
        )
        .collect()
}

fn slot<'a>(value: &'a mut Value, key: &str) -> &'a mut Value {
    if !value.is_object() {
        *value = json!({});
    }
    &mut value[key]
}

fn object_slot<'a>(value: &'a mut Value, key: &str) -> &'a mut Value {
    let target = slot(value, key);
    if !target.is_object() {
        *target = json!({});
    }
    target
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|value| value.is_finite())
}

fn finite(value: &Value, default: f64) -> f64 {
    number(value).unwrap_or(default)
}

fn merged_flat_line(style: &Value, partial_key: &str) -> Value {
    let mut merged = style.as_object().cloned().unwrap_or_default();
    if let Some(partial) = style[partial_key].as_object() {
        for (key, value) in partial {
            merged.insert(key.clone(), value.clone());
        }
    }
    Value::Object(merged)
}

/// 扁平文字外观 → `voiceInkContexts.*.{orig,trans}` 的完整行记录。
///
/// 这是 flat-only 项目第一次做上下文编辑时的兼容桥；正常项目已有 contexts，不走
/// 这里。只搬既有 schema 能表达的字段，不凭空补产品默认。
fn record_from_flat(flat: &Value, font_size: f64) -> Value {
    let mut line_style = Map::new();
    for (flat_key, field) in LOOK_KEYS {
        if !flat[*flat_key].is_null() {
            line_style.insert((*field).to_owned(), flat[*flat_key].clone());
        }
    }
    if let Some(family) = flat["fontFamily"].as_str() {
        line_style.insert(
            "fontFamily".to_owned(),
            json!({"type": "default", "fontFamily": family}),
        );
    } else if flat["fontFamily"].is_object() {
        line_style.insert("fontFamily".to_owned(), flat["fontFamily"].clone());
    }
    if let Some(weight) = flat["fontWeight"].as_str() {
        line_style.insert("fontWeight".to_owned(), json!(weight));
    } else if let Some(weight) = flat["fontWeight"].as_u64() {
        line_style.insert("fontWeight".to_owned(), json!(weight));
    } else if let Some(bold) = flat["bold"].as_bool() {
        line_style.insert(
            "fontWeight".to_owned(),
            json!(if bold { "bold" } else { "normal" }),
        );
    }
    if let Some(italic) = flat["italic"].as_bool() {
        line_style.insert("italic".to_owned(), json!(italic));
        line_style.insert(
            "fontStyle".to_owned(),
            json!(if italic { "italic" } else { "normal" }),
        );
    }
    if let Some(background) = flat["background"].as_bool() {
        line_style.insert("bgOn".to_owned(), json!(background));
    }
    if let Some(outline) = flat["outline"].as_bool() {
        let mut value = flat["textOutline"].as_object().cloned().unwrap_or_default();
        value.insert("on".to_owned(), json!(outline));
        line_style.insert("textOutline".to_owned(), Value::Object(value));
    }
    line_style.insert("fontSize".to_owned(), json!(font_size.max(1.0)));

    let mut record = json!({"style": Value::Object(line_style)});
    if !flat["wordAnimation"].is_null() {
        record["anim"] = flat["wordAnimation"].clone();
    }
    record
}

fn copy_line_geometry(record: &mut Value, partial: &Value) {
    if number(&partial["x"]).is_some() && number(&partial["y"]).is_some() {
        record["x"] = partial["x"].clone();
        record["y"] = partial["y"].clone();
    }
    if matches!(
        partial["verticalAlign"].as_str(),
        Some("top" | "center" | "bottom")
    ) {
        record["verticalAlign"] = partial["verticalAlign"].clone();
    }
}

fn set_from_flat(style: &Value, mode: &str, orig: Value, trans: Value) -> Value {
    let mut set = json!({"mode": mode, "orig": orig, "trans": trans});
    for key in SET_KEYS {
        if !style[*key].is_null() {
            set[*key] = style[*key].clone();
        }
    }
    for key in BI_SET_KEYS {
        if *key != "mode" && !style[*key].is_null() {
            set[*key] = style[*key].clone();
        }
    }
    if !style["punct"].is_null() {
        set["punct"] = style["punct"].clone();
    }
    set
}

/// 为 flat-only 样式在内存中补齐两套无损上下文。
///
/// 函数不做 I/O；调用方只有在用户真正编辑后才把返回值提交。尺寸严格沿用既有
/// `fontSize × bilingualOrigScale × transScale` 链，首次 materialize 不改变画面。
pub fn materialize_contexts(style: &Value) -> Value {
    if valid_contexts(&style[CONTEXTS_KEY]) {
        return style.clone();
    }
    let mut result = style.clone();
    if !result.is_object() {
        result = json!({});
    }
    let root_size = finite(&style["fontSize"], 30.0).max(1.0);
    let orig_scale = finite(
        &style["bilingualOrigScale"],
        crate::DEFAULT_BILINGUAL_ORIG_SCALE,
    )
    .max(0.1);
    let trans_scale = finite(&style["transScale"], crate::DEFAULT_TRANSLATION_RATIO).max(0.1);
    let orig_size = number(&style["origStyle"]["fontSize"])
        .unwrap_or(root_size * orig_scale)
        .max(1.0);
    let trans_size = number(&style["transStyle"]["fontSize"])
        .unwrap_or(orig_size * trans_scale)
        .max(1.0);

    let sub_orig = record_from_flat(style, root_size);
    let sub_trans = record_from_flat(&merged_flat_line(style, "transStyle"), trans_size);
    let mut bi_orig = record_from_flat(&merged_flat_line(style, "origStyle"), orig_size);
    let mut bi_trans = record_from_flat(&merged_flat_line(style, "transStyle"), trans_size);
    copy_line_geometry(&mut bi_orig, &style["origStyle"]);
    copy_line_geometry(&mut bi_trans, &style["transStyle"]);
    // 双语上下文的 mode 由轨集派生（缺席轨集与 `mode` 时统一回落 `orig`），
    // 与 [`canonicalize_track_set`] 同一份判据。
    let mode = crate::mode_token(crate::StudioMode::of_style(style));
    result[CONTEXTS_KEY] = json!({
        "sub": set_from_flat(style, "orig", sub_orig, sub_trans),
        "bi": set_from_flat(style, mode, bi_orig, bi_trans),
    });
    result
}

fn partial_from_record(record: &Value, bilingual: bool) -> Value {
    let line_style = &record["style"];
    let mut partial = Map::new();
    if let Some(size) = number(&line_style["fontSize"]) {
        partial.insert("fontSize".to_owned(), json!(size.max(1.0)));
    }
    for (flat, source) in LOOK_KEYS {
        if !line_style[*source].is_null() {
            partial.insert((*flat).to_owned(), line_style[*source].clone());
        }
    }
    if let Some(family) = line_style
        .pointer("/fontFamily/fontFamily")
        .and_then(Value::as_str)
    {
        partial.insert("fontFamily".to_owned(), json!(family));
    }
    if let Some(weight) = line_style["fontWeight"].as_str() {
        partial.insert("bold".to_owned(), json!(matches!(weight, "bold" | "700")));
    } else if let Some(weight) = line_style["fontWeight"].as_u64() {
        partial.insert("bold".to_owned(), json!(weight >= 700));
    }
    if line_style["italic"].as_bool() == Some(true)
        || line_style["fontStyle"].as_str() == Some("italic")
    {
        partial.insert("italic".to_owned(), json!(true));
    }
    if let Some(background) = line_style["bgOn"].as_bool() {
        partial.insert("background".to_owned(), json!(background));
    }
    let outline = &line_style["textOutline"];
    if !outline.is_null() {
        partial.insert(
            "outline".to_owned(),
            json!(
                outline["on"]
                    .as_bool()
                    .unwrap_or_else(|| finite(&outline["width"], 0.0) > 0.0)
            ),
        );
    }
    if !record["anim"].is_null() {
        partial.insert("wordAnimation".to_owned(), record["anim"].clone());
    }
    if bilingual {
        for key in ["x", "y", "verticalAlign"] {
            if !record[key].is_null() {
                partial.insert(key.to_owned(), record[key].clone());
            }
        }
    }
    Value::Object(partial)
}

/// 取某一套上下文的等价扁平编辑投影。
///
/// 与 Web `subtitle-rendering.js::contextStyle` 同义：根键给共享控件读取，双语
/// `origStyle` / `transStyle` 给行级控件读取。返回值始终保留完整 contexts，因此
/// 后续整文档提交不会删掉另一套样式。
pub fn context_style(style: &Value, context: StyleContext) -> Value {
    let mut result = materialize_contexts(style);
    let contexts = result[CONTEXTS_KEY].clone();
    project_flat(&mut result, &contexts, context.as_str());
    if context == StyleContext::Bilingual {
        result["origStyle"] = partial_from_record(&contexts["bi"]["orig"], true);
        result["transStyle"] = partial_from_record(&contexts["bi"]["trans"], true);
    } else if let Some(root) = result.as_object_mut() {
        root.remove("origStyle");
        root.remove("transStyle");
    }
    result
}

/// 双语两行共同的扁平字段，以及当前不一致的字段名。
pub fn bilingual_common(style: &Value) -> (Value, BTreeSet<String>) {
    let projected = context_style(style, StyleContext::Bilingual);
    let empty = Map::new();
    let orig = projected["origStyle"].as_object().unwrap_or(&empty);
    let trans = projected["transStyle"].as_object().unwrap_or(&empty);
    let keys: BTreeSet<_> = orig.keys().chain(trans.keys()).cloned().collect();
    let mut common = Map::new();
    let mut mixed = BTreeSet::new();
    for key in keys {
        match (orig.get(&key), trans.get(&key)) {
            (Some(left), Some(right)) if left == right => {
                common.insert(key, left.clone());
            }
            _ => {
                mixed.insert(key);
            }
        }
    }
    (Value::Object(common), mixed)
}

/// 可由“共同 / 原文 / 译文”作用域控制的文字外观键。
pub fn is_line_look_key(key: &str) -> bool {
    key == "fontSize"
        || LOOK_KEYS.iter().any(|(flat, _)| *flat == key)
        || LOOK_KEYS_MAPPED.contains(&key)
}

/// 将一组扁平文字字段写入双语指定作用域。共同作用域同时更新两行；行级作用域
/// 只更新对应记录。返回值保留完整 contexts 并重建当前双语根投影。
pub fn apply_bilingual_scope(style: &Value, scope: BilingualScope, patch: &Value) -> Value {
    let before = context_style(style, StyleContext::Bilingual);
    let Some(fields) = patch.as_object() else {
        return before;
    };
    let mut candidate = before.clone();
    let targets: &[&str] = match scope {
        BilingualScope::Common => &["origStyle", "transStyle"],
        BilingualScope::Original => &["origStyle"],
        BilingualScope::Translation => &["transStyle"],
    };
    for target in targets {
        for (key, value) in fields {
            if is_line_look_key(key) {
                candidate[*target][key] = value.clone();
            }
        }
    }
    reconcile_replacement(
        &mut candidate,
        &before,
        Some(StyleContext::Bilingual.as_str()),
    );
    candidate
}

/// 把一行的**外观**从扁平形状下沉到上下文行记录（`{style, anim}`）。
/// `wanted` 决定哪些键算「本次明确改动」——只下沉它选中的键，整份重拍会把用户
/// 在另一个上下文/另一行单独调过的样式抹掉。
fn sink_look(line: &mut Value, flat: &Value, wanted: &dyn Fn(&str) -> bool) {
    if wanted("wordAnimation") && !flat["wordAnimation"].is_null() {
        *slot(line, "anim") = flat["wordAnimation"].clone();
    }
    let style = object_slot(line, "style");
    for (key, field) in LOOK_KEYS {
        if wanted(key) && !flat[*key].is_null() {
            style[*field] = flat[*key].clone();
        }
    }
    if wanted("fontFamily") {
        match &flat["fontFamily"] {
            Value::String(name) => {
                let kind = style
                    .pointer("/fontFamily/type")
                    .and_then(Value::as_str)
                    .unwrap_or("default")
                    .to_owned();
                style["fontFamily"] = json!({"type": kind, "fontFamily": name});
            }
            family if family.is_object() => style["fontFamily"] = family.clone(),
            _ => {}
        }
    }
    if wanted("bold")
        && let Some(bold) = flat["bold"].as_bool()
    {
        style["fontWeight"] = json!(if bold { "bold" } else { "normal" });
    }
    if wanted("italic")
        && let Some(italic) = flat["italic"].as_bool()
    {
        style["italic"] = json!(italic);
        style["fontStyle"] = json!(if italic { "italic" } else { "normal" });
    }
    if wanted("background")
        && let Some(background) = flat["background"].as_bool()
    {
        style["bgOn"] = json!(background);
    }
    // `outline` 是老的布尔投影，它写的是 `textOutline.on`：必须在 textOutline
    // 整组之后，否则整组克隆会把刚写进去的开关盖掉。
    if wanted("outline")
        && let Some(outline) = flat["outline"].as_bool()
    {
        object_slot(style, "textOutline")["on"] = json!(outline);
    }
}

/// 尺寸：`mergeFlat` 的严格反向。
///
/// `mergeFlat` 写的是「被选中那一行的绝对字号 + 双语对的两个比值」
/// （`bilingualOrigScale = bi.orig / 根`、`transScale = bi.trans / bi.orig`），
/// 所以反向也只动**本次真的被改过**的那一端，另一端保持绝对值不变 —— 与 Mac
/// 「改原文行不动译文行、只让比值跟着变」的行为一致。
fn sink_sizes(contexts: &mut Value, flat: &Value, ctx: &str, changed: &BTreeSet<String>) {
    let line = selected_line(contexts, ctx);
    let base = number(&flat["fontSize"]).map(|size| size.max(1.0));
    let orig_scale = number(&flat["bilingualOrigScale"]).map(|value| value.max(0.1));
    let trans_scale = number(&flat["transScale"]).map(|value| value.max(0.1));
    if changed.contains("fontSize")
        && let Some(base) = base
    {
        object_slot(object_slot(&mut contexts[ctx], line), "style")["fontSize"] = json!(base);
    }
    let size_of = |contexts: &Value, line: &str| {
        contexts
            .pointer(&format!("/bi/{line}/style/fontSize"))
            .and_then(number)
    };
    // 双语原文行：`sub` 被选中时它由「根 × bilingualOrigScale」编码（Mac 从 sub
    // flush 出来的正是这个形状）；`bi` 的译文行被选中时基准换成译文行。
    if changed.contains("bilingualOrigScale")
        && let Some(scale) = orig_scale
    {
        let anchor = if ctx == "bi" && line == "trans" {
            size_of(contexts, "trans")
        } else if ctx == "sub" {
            base
        } else {
            None
        };
        if let Some(anchor) = anchor {
            object_slot(object_slot(&mut contexts["bi"], "orig"), "style")["fontSize"] =
                json!((anchor * scale).max(1.0));
        }
    }
    if changed.contains("transScale")
        && let Some(scale) = trans_scale
        && let Some(orig) = size_of(contexts, "orig")
    {
        object_slot(object_slot(&mut contexts["bi"], "trans"), "style")["fontSize"] =
            json!((orig * scale).max(1.0));
    }
}

/// flat → contexts：把本次明确改动的扁平键下沉到被选中的上下文。
fn sink(style: &Value, contexts: &mut Value, ctx: &str, changed: &BTreeSet<String>) {
    let line = selected_line(contexts, ctx);
    let wanted = |key: &str| changed.contains(key);
    {
        let record = object_slot(&mut contexts[ctx], line);
        sink_look(record, style, &wanted);
    }
    for key in SET_KEYS {
        if !changed.contains(*key) {
            continue;
        }
        // 缺席即「没有意见」（Mac `mergeFlat` 对 verticalAlign 是赋 nil 删键），
        // 所以清除时也要把 set 上的键删掉，而不是留一个陈旧值。
        if style[*key].is_null() {
            if let Some(set) = contexts[ctx].as_object_mut() {
                set.remove(*key);
            }
        } else {
            contexts[ctx][*key] = style[*key].clone();
        }
    }
    // 标点是**项目级**开关：Mac 的 setPunct 同时写两个上下文
    // （`SubtitleStyleContexts.swift:450-458`）。
    if changed.contains("punct") && !style["punct"].is_null() {
        for name in ["sub", "bi"] {
            contexts[name]["punct"] = style["punct"].clone();
        }
    }
    for key in BI_SET_KEYS {
        if changed.contains(*key) && !style[*key].is_null() {
            contexts["bi"][*key] = style[*key].clone();
        }
    }
    sink_sizes(contexts, style, ctx, changed);
    // 行级 partial 只有双语上下文产出（Mac `linePartial(_:bilingual:)` 与
    // `lineGeom` 的 `guard ctx == .bi`）。整块 partial 里出现的键就是本次改动。
    for (flat_key, line_name) in LINE_PARTIAL_KEYS {
        if !changed.contains(*flat_key) {
            continue;
        }
        let partial = style[*flat_key].clone();
        let Some(fields) = partial.as_object().cloned() else {
            continue;
        };
        let record = object_slot(&mut contexts["bi"], line_name);
        sink_look(record, &partial, &|key: &str| fields.contains_key(key));
        for key in ["x", "y", "verticalAlign"] {
            match fields.get(key) {
                Some(value) if !value.is_null() => record[key] = value.clone(),
                Some(_) => {
                    if let Some(object) = record.as_object_mut() {
                        object.remove(key);
                    }
                }
                None => {}
            }
        }
        // 行级 `fontSize` 是**显式绕过比例链**的旁路（`resolve_line_style` 的
        // explicit_size），Mac 也把它读回上下文行样式。
        if let Some(size) = fields.get("fontSize").and_then(number) {
            object_slot(record, "style")["fontSize"] = json!(size.max(1.0));
        }
    }
}

/// contexts → flat：把一个上下文拍平成扁平根键。
///
/// 与 Mac `mergeFlat`（`ProductSubtitleStyleAdapter.swift:222-282`）逐键对应，
/// 两处刻意的差别：
///
/// - **缺席不写**。Mac 那边 set 是强类型模型，字段永远在；这里的 contexts 可能是
///   手写或半迁移的 JSON，缺字段时保留调用方给的底（迁移路径的底是
///   `studio::default_style()`），而不是塞一个凭空的缺省值。
/// - 行级 partial（`origStyle`/`transStyle`）不在这里产出：它们是 Mac 侧新加的行级
///   覆盖，CLI 只在有人明确写它们时下沉，不主动补写，免得给烧录端凭空多一层覆盖。
pub fn project_flat(style: &mut Value, contexts: &Value, ctx: &str) {
    let set = &contexts[ctx];
    let bi = &contexts["bi"];
    let line = &set[selected_line(contexts, ctx)];
    let line_style = &line["style"];
    let put = |style: &mut Value, key: &str, value: &Value| {
        if !value.is_null() {
            style[key] = value.clone();
        }
    };
    // `mode` 只有双语上下文携带意图，而且已经降级为由轨集派生的兼容字段：这里
    // 只把 Mac 的 Show 三档（写在 `bi.mode` 上）带回扁平层，随后由
    // [`canonicalize_track_set`] 统一裁决轨集并回写 `mode`。
    //
    // 非 `bi` 上下文**不再**无条件写 `mode="orig"`（旧病灶）：那一句会把双语文档
    // 在任何一次单行上下文的样式写入里压成单行，而上下文只描述「样式写给谁」，
    // 从来不是「画面上摆着哪几条轨」。
    if ctx == "bi" {
        put(style, "mode", &set["mode"]);
    }
    put(style, "punct", &set["punct"]);
    if let Some(family) = line_style
        .pointer("/fontFamily/fontFamily")
        .and_then(Value::as_str)
    {
        style["fontFamily"] = json!(family);
    }
    put(style, "fontSize", &line_style["fontSize"]);
    put(style, "fontColor", &line_style["fontColor"]);
    if let Some(weight) = line_style["fontWeight"].as_str() {
        style["bold"] = json!(matches!(weight, "bold" | "700"));
    }
    let outline = &line_style["textOutline"];
    if !outline.is_null() {
        style["outline"] = json!(
            outline["on"]
                .as_bool()
                .unwrap_or_else(|| number(&outline["width"]).unwrap_or(0.0) > 0.0)
        );
    }
    if !line_style["bgOn"].is_null() || !line_style["backgroundColor"].is_null() {
        style["background"] = json!(line_style["bgOn"].as_bool().unwrap_or_else(|| {
            let color = line_style["backgroundColor"]
                .as_str()
                .unwrap_or("transparent");
            color != "transparent" && !color.ends_with(",0)") && !color.ends_with(",0.0)")
        }));
    }
    for (flat, source) in LOOK_KEYS {
        // `align` 等同名键走这里；`textOutline`/`dropShadow` 整组克隆。
        put(style, flat, &line_style[*source]);
    }
    for key in SET_KEYS {
        // `verticalAlign` 是 M120 块级锚点：缺席表示「没有意见」，必须删键而不是
        // 留一个上一次 flush 的陈旧值（Mac 是 `.map(JSONValue.string)` 赋 nil）。
        if *key == "verticalAlign" {
            match set[*key].as_str() {
                Some(value) => style[*key] = json!(value),
                None => {
                    if let Some(object) = style.as_object_mut() {
                        object.remove(*key);
                    }
                }
            }
            continue;
        }
        put(style, key, &set[*key]);
    }
    // `order`/`gap`/`backgroundMode` 永远取自双语上下文，下沉时也只写它：Mac 是从
    // 被 flush 的那个 set 取的，但单行上下文里这三个键描述的「两行怎么排」根本没有
    // 消费方，两边取同一处才能保证页面改了之后原样读回来。
    for key in BI_SET_KEYS {
        if *key != "mode" {
            put(style, key, &bi[*key]);
        }
    }
    put(style, "wordAnimation", &line["anim"]);
    // 两个比值永远量自**双语对**，基准是刚写下的根字号 —— 与 `mergeFlat` 同一句：
    // 从 `sub` 拍平时根是单行原文的字号，比值仍描述双语栈。
    let selected = number(&line_style["fontSize"]).unwrap_or(0.0);
    let original = bi
        .pointer("/orig/style/fontSize")
        .and_then(number)
        .unwrap_or(0.0);
    let translated = bi
        .pointer("/trans/style/fontSize")
        .and_then(number)
        .unwrap_or(0.0);
    if selected > 0.0 && original > 0.0 {
        style["bilingualOrigScale"] = json!(original / selected);
        style["transScale"] = json!(translated / original);
    }
}

/// 一次完整对账：先下沉本次改动，再用 contexts 重算扁平投影。
///
/// 没有可用 contexts 时**逐比特不动**（纯 Web 项目、未迁移的旧项目），与 Web
/// `subtitle-rendering.js` 的 `contextStyle` 同一条豁免。
pub fn reconcile(style: &mut Value, changed: &BTreeSet<String>, ctx_hint: Option<&str>) {
    let mut contexts = style[CONTEXTS_KEY].clone();
    // 本次没有任何「上下文承载得住」的键在改（只改了 preset 名、captionEmphasis
    // 之类）时逐比特不动：重算扁平层是有副作用的（会把历史遗留的、与 contexts 不
    // 一致的根键拉回 contexts 真相），不该被一次无关写入顺带触发。
    if !valid_contexts(&contexts) || !changed.iter().any(|key| is_context_backed_key(key)) {
        return;
    }
    let ctx = selected_context(style, ctx_hint);
    sink(&style.clone(), &mut contexts, ctx, changed);
    project_flat(style, &contexts, ctx);
    style[CONTEXTS_KEY] = contexts;
}

/// `POST __bcut/style/apply` 的整份替换语义。
///
/// 1. 请求体不带 contexts 而盘上有 → **继承**盘上的（GPUI 只写根键，整份替换会把
///    Mac 的无损真相整块删掉）。
/// 2. 请求体自带的 contexts 与盘上不同 → 客户端是上下文感知的（Mac 走
///    `replacingStyle`，两层一起给），整份采信，不再对账：Rust 侧的拍平选不出
///    「被改的那个 set」，重算反而会把 Mac 刚写的扁平层打回另一个上下文。
/// 3. 其余情况（继承而来，或与盘上逐比特相同）→ 根键差异集就是本次改动意图，
///    走 `reconcile` 双向闭合。
pub fn reconcile_replacement(candidate: &mut Value, before: &Value, ctx_hint: Option<&str>) {
    let stored = &before[CONTEXTS_KEY];
    let inherited = if candidate[CONTEXTS_KEY].is_null() && !stored.is_null() {
        candidate[CONTEXTS_KEY] = stored.clone();
        true
    } else {
        false
    };
    if !inherited && candidate[CONTEXTS_KEY] != *stored {
        return;
    }
    let changed = changed_flat_keys(before, candidate);
    reconcile(candidate, &changed, ctx_hint);
}

/// 覆盖层/请求体里的可选上下文提示。
pub fn ctx_hint(value: &Value) -> Option<&str> {
    match value.as_str() {
        Some("sub") | Some("bi") => value.as_str(),
        _ => None,
    }
}

/// 本次写入有没有显式声明轨集。
///
/// [`resolve_track_set`](crate::resolve_track_set) 第 3 步在
/// `tracks` 与兼容信号（`bi.mode` 优先，其次根 `mode`）不一致时以信号为准（旧写者
/// 更新）。这条规则在**读**路径
/// 上正确，在**写**路径上会把新模型客户端的轨集写入变成空操作：请求体只带
/// `{"tracks": [...]}`，盘上那份陈旧的 `mode` 在浅合并里活了下来，于是轨集被按
/// `mode` 重派生回原样。所以写路径必须把「谁是本次意图」告诉 canonicalize。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TrackSetIntent {
    /// 写者没提轨集：沿用 resolve 的兼容裁决（不一致以兼容信号为准）。
    Inherited,
    /// 写者本次显式写了 `tracks` 且没写 `mode`：轨集就是意图，丢掉陈旧 `mode`。
    Authored,
}

impl TrackSetIntent {
    /// 从本次写入明确改动的键集判断意图。
    pub fn of_changed<'a>(changed: impl IntoIterator<Item = &'a str>) -> Self {
        let mut tracks = false;
        let mut mode = false;
        for key in changed {
            match key {
                "tracks" => tracks = true,
                "mode" => mode = true,
                _ => {}
            }
        }
        if tracks && !mode {
            Self::Authored
        } else {
            Self::Inherited
        }
    }
}

/// 无译文护栏的开关。
///
/// 两层真相的分工是既有裁决，本轮只换判据不换分工：**样式 sidecar
/// （`studio/style.json`）留意图，投影（`studio/data.json`）落可渲染的事实**。
/// 用户在还没翻译时就摆好双语，意图必须留在 sidecar 里，译文一到位就原样回到
/// 双语；而投影那一份必须摘掉译文轨，否则渲染与导出会在 render_plan 直接 bail。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TranslationGuard {
    /// 保留轨集里的译文轨（样式 sidecar 的写路径）。
    Keep,
    /// 摘掉译文轨（投影落盘、旧文档迁移与存量修复）。
    Drop,
}

impl TranslationGuard {
    pub fn of_has_translation(has_translation: bool) -> Self {
        if has_translation {
            Self::Keep
        } else {
            Self::Drop
        }
    }
}

/// 样式落盘前的唯一一次轨集裁决 —— 写侧单点。
///
/// 1. `tracks := resolve(style)`（`Authored` 时先丢掉两个陈旧兼容信号：根 `mode`
///    与 `voiceInkContexts.bi.mode`，否则本次「拿下/放回译文轨」会被上一轮的
///    `bi.mode` 一票否决）；
/// 2. `Drop` 时摘掉译文轨（空了补 `[source]`）——这是旧 `mode` 无译文护栏的轨集版；
/// 3. 回写兼容投影：`style.mode`、`voiceInkContexts.bi.mode` 都取
///    `mode_of(tracks)`，`sub.mode` 维持 `"orig"`（Mac 的 `sub` 被钉死成单行）。
///    `bi.mode` 必须**无条件**跟着轨集走：它是读侧裁决的首选信号，留在陈旧值上
///    会让下一次 `resolve` 把刚摘掉的译文轨原样放回来（读写不再幂等）。
///
/// **只在写路径调用。** 只读路径（渲染、预览、导出）一律走
/// [`resolve_track_set`](crate::resolve_track_set)，读时迁移不写回。
///
/// 必须在 [`reconcile`] **之后**调用，且不能塞进 `reconcile` 里面：`reconcile` 在
/// 「没有上下文承载得住的键在改」时逐比特不动，只带 `tracks` 的补丁会正好撞上
/// 那条早退，`mode` 与 `bi.mode` 就留在陈旧值上。
pub fn canonicalize_track_set(style: &mut Value, guard: TranslationGuard, intent: TrackSetIntent) {
    if !style.is_object() {
        return;
    }
    if intent == TrackSetIntent::Authored && !crate::parse_track_set(style).is_empty() {
        if let Some(object) = style.as_object_mut() {
            object.remove("mode");
        }
        // 用 `get_mut` 而不是索引：索引会给缺席的 `voiceInkContexts` 插一个 null 出来。
        if let Some(set) = style
            .get_mut(CONTEXTS_KEY)
            .and_then(|contexts| contexts.get_mut("bi"))
            .and_then(Value::as_object_mut)
        {
            set.remove("mode");
        }
    }
    let mut tracks = crate::resolve_track_set(style);
    if guard == TranslationGuard::Drop {
        tracks.retain(|track| track.role != crate::TrackRole::Translation);
        if tracks.is_empty() {
            tracks.push(crate::SubtitleTrack::source(None));
        }
    }
    let mode = crate::mode_token(crate::mode_of(&tracks));
    style["tracks"] = crate::tracks_json(&tracks);
    style["mode"] = json!(mode);
    if valid_contexts(&style[CONTEXTS_KEY]) {
        style[CONTEXTS_KEY]["sub"]["mode"] = json!("orig");
        style[CONTEXTS_KEY]["bi"]["mode"] = json!(mode);
    }
}

/// 给轨集补语言标注：只填空缺，已有 `lang` 不动（用户/上游更清楚）。
///
/// 语言是投影层才知道的信息（transcript `meta.lang` 与当前投影目标语），
/// `default_style` 拿不到，所以拆成独立一步，落盘前紧跟 canonicalize。
pub fn seed_track_langs(style: &mut Value, source_lang: Option<&str>, target_lang: Option<&str>) {
    let Some(tracks) = style["tracks"].as_array_mut() else {
        return;
    };
    for track in tracks {
        if track["lang"].as_str().is_some_and(|lang| !lang.is_empty()) {
            continue;
        }
        let lang = match track["role"].as_str() {
            Some("source") => source_lang,
            Some("translation") => target_lang,
            _ => None,
        };
        if let Some(lang) = lang.filter(|lang| !lang.trim().is_empty()) {
            track["lang"] = json!(lang);
        }
    }
}

/// 一次扁平覆盖层写入涉及的全部可下沉键（供调用方判断是否值得对账）。
pub fn is_context_backed_key(key: &str) -> bool {
    SET_KEYS.contains(&key)
        || BI_SET_KEYS.contains(&key)
        || SIZE_KEYS.contains(&key)
        || LOOK_KEYS.iter().any(|(flat, _)| *flat == key)
        || LOOK_KEYS_MAPPED.contains(&key)
        || LINE_PARTIAL_KEYS.iter().any(|(flat, _)| *flat == key)
        || key == "punct"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contexts() -> Value {
        json!({
            "sub": {
                "mode": "orig", "punct": true, "x": 50.0, "y": 86.0,
                "orig": {"style": {"fontSize": 29.0, "fontColor": "#ffffff",
                                   "fontFamily": {"type": "default", "fontFamily": "Inter"}}},
                "trans": {"style": {"fontSize": 22.0}}
            },
            "bi": {
                "mode": "bi", "order": "trans", "gap": 6.0, "punct": true, "x": 50.0, "y": 86.0,
                "orig": {"style": {"fontSize": 16.0, "fontColor": "#ffffff"}},
                "trans": {"style": {"fontSize": 29.0, "fontColor": "#ffffff"}}
            }
        })
    }

    /// 实测形状：扁平根是 `sub` 上下文拍平出来的（29 / 0.5517 / 1.8125 ↔
    /// bi.orig 16、bi.trans 29），mode 因此是 `orig`。
    fn flat() -> Value {
        json!({
            "mode": "orig", "punct": true, "fontSize": 29.0, "fontColor": "#ffffff",
            "fontFamily": "Inter", "x": 50.0, "y": 86.0,
            "bilingualOrigScale": 16.0 / 29.0, "transScale": 29.0 / 16.0,
            "voiceInkContexts": contexts()
        })
    }

    fn changed(keys: &[&str]) -> BTreeSet<String> {
        keys.iter().map(|key| (*key).to_owned()).collect()
    }

    #[test]
    fn flat_mode_switch_writes_the_bilingual_context_mode() {
        let mut style = flat();
        style["mode"] = json!("bi");
        reconcile(&mut style, &changed(&["mode"]), None);
        assert_eq!(style[CONTEXTS_KEY]["bi"]["mode"], "bi");
        // 选中的上下文换成 bi，扁平根随之变成 bi 的投影。
        assert_eq!(style["mode"], "bi");
        assert_eq!(style["fontSize"].as_f64(), Some(16.0));
        assert_eq!(style["bilingualOrigScale"].as_f64(), Some(1.0));
        assert_eq!(style["transScale"].as_f64(), Some(29.0 / 16.0));
        // 单行上下文没有被这次切换动过。
        assert_eq!(
            style[CONTEXTS_KEY]["sub"]["orig"]["style"]["fontSize"].as_f64(),
            Some(29.0)
        );
    }

    #[test]
    fn font_size_lands_in_the_selected_context_only() {
        let mut style = flat();
        style["fontSize"] = json!(40.0);
        reconcile(&mut style, &changed(&["fontSize"]), None);
        let contexts = &style[CONTEXTS_KEY];
        assert_eq!(
            contexts["sub"]["orig"]["style"]["fontSize"].as_f64(),
            Some(40.0)
        );
        assert_eq!(
            contexts["bi"]["orig"]["style"]["fontSize"].as_f64(),
            Some(16.0)
        );
        assert_eq!(
            contexts["bi"]["trans"]["style"]["fontSize"].as_f64(),
            Some(29.0)
        );
        // 双语比值跟着新的根字号重算，绝对字号不变 —— 与 Mac 一致。
        assert_eq!(style["bilingualOrigScale"].as_f64(), Some(16.0 / 40.0));
    }

    /// apps/mac 的 `/style/apply` 不带 `ctx`。轨集含译文轨的文档必须落在 `bi`
    /// 上下文，否则 Mac 的双语外观会被写进单行的 `sub` 里。
    #[test]
    fn a_translation_track_selects_the_bilingual_context_without_a_ctx_hint() {
        let mut style = flat();
        style["tracks"] = json!([{"role": "source"}, {"role": "translation"}]);
        // 两个兼容信号（根 `mode` 与 `bi.mode`）都拿掉：轨集必须自己把上下文选到 `bi`。
        style.as_object_mut().expect("object").remove("mode");
        style[CONTEXTS_KEY]["bi"]
            .as_object_mut()
            .expect("bi 上下文")
            .remove("mode");
        style["fontSize"] = json!(20.0);
        reconcile(&mut style, &changed(&["fontSize"]), None);
        assert_eq!(
            style[CONTEXTS_KEY]["bi"]["orig"]["style"]["fontSize"].as_f64(),
            Some(20.0)
        );
        // 单行上下文一动不动。
        assert_eq!(
            style[CONTEXTS_KEY]["sub"]["orig"]["style"]["fontSize"].as_f64(),
            Some(29.0)
        );
    }

    /// 旧写者（apps/mac）无条件回写扁平 `mode`。`mode` 与 `tracks` 打架时以 `mode`
    /// 为准：新模型的写者两者永远一致，不一致只可能来自旧写者，它的值更新。
    #[test]
    fn a_legacy_mode_writeback_wins_over_a_stale_track_set() {
        let mut style = json!({
            "mode": "orig",
            "tracks": [{"role": "source", "lang": "en"}, {"role": "translation", "lang": "zh"}],
        });
        canonicalize_track_set(
            &mut style,
            TranslationGuard::Keep,
            TrackSetIntent::Inherited,
        );
        assert_eq!(style["tracks"], json!([{"role": "source", "lang": "en"}]));
        assert_eq!(style["mode"], "orig");
    }

    /// 反过来：本次写入显式给了 `tracks` 而没碰 `mode`，轨集就是意图。没有这一条，
    /// 新模型客户端的「把译文轨拿下来」会被盘上那个陈旧 `mode` 一票否决。
    #[test]
    fn an_authored_track_set_wins_over_the_stale_mode_it_replaces() {
        let mut style = json!({
            "mode": "bi",
            "tracks": [{"role": "source"}],
            CONTEXTS_KEY: contexts(),
        });
        canonicalize_track_set(
            &mut style,
            TranslationGuard::Keep,
            TrackSetIntent::of_changed(["tracks"]),
        );
        assert_eq!(style["tracks"], json!([{"role": "source"}]));
        assert_eq!(style["mode"], "orig");
        assert_eq!(style[CONTEXTS_KEY]["sub"]["mode"], "orig");
        // 两个兼容信号都跟着走：`bi.mode` 排在根 `mode` 前面，留在 `"bi"` 上会让下一次
        // resolve 把刚拿下来的译文轨原样放回去。
        assert_eq!(style[CONTEXTS_KEY]["bi"]["mode"], "orig");
        // 落盘形态自洽：再 resolve 一次拿到同一个轨集（读写幂等）。
        assert_eq!(
            crate::tracks_json(&crate::resolve_track_set(&style)),
            style["tracks"]
        );
    }

    /// Mac 在 Subtitle Tab 改样式会从被钉死单行的 `.sub` set 刷出一个没有意义的
    /// 根 `mode="orig"`，用户真正看到的模式在 `bi.mode` 上。按根 `mode` 重派生会把
    /// 译文轨静默拿掉，所以裁决信号首选 `bi.mode`。
    #[test]
    fn the_bilingual_context_mode_outranks_a_flushed_flat_mode() {
        let mut contexts = contexts();
        contexts["bi"]["mode"] = json!("bi");
        // 无 tracks：从信号派生。
        let mut style = json!({"mode": "orig", CONTEXTS_KEY: contexts.clone()});
        canonicalize_track_set(
            &mut style,
            TranslationGuard::Keep,
            TrackSetIntent::Inherited,
        );
        assert_eq!(
            style["tracks"],
            json!([{"role": "source"}, {"role": "translation"}])
        );
        assert_eq!(style["mode"], "bi");

        // 有 tracks 且与信号打架：仍以 `bi.mode` 为准，同 role 的 lang 沿用。
        let mut style = json!({
            "mode": "orig",
            "tracks": [{"role": "source", "lang": "en"}],
            CONTEXTS_KEY: contexts,
        });
        canonicalize_track_set(
            &mut style,
            TranslationGuard::Keep,
            TrackSetIntent::Inherited,
        );
        assert_eq!(
            style["tracks"],
            json!([{"role": "source", "lang": "en"}, {"role": "translation"}])
        );
    }

    /// 写侧裁决与 Studio 的 JS 镜像共用同一张黄金表，逐行消费。
    #[test]
    fn canonicalization_matches_the_shared_contract_fixture() {
        let contract: Value = serde_json::from_str(include_str!(
            "../../speech-doc/tests/fixtures/subtitle-render-contract.json"
        ))
        .unwrap();
        let rows = contract["trackSet"]["canonicalize"]
            .as_array()
            .expect("夹具缺 trackSet.canonicalize");
        assert!(!rows.is_empty());
        for row in rows {
            let case = row["description"].as_str().unwrap_or("<无描述>");
            let intent = match row["intent"].as_str().expect("intent") {
                "authored" => TrackSetIntent::Authored,
                other => {
                    assert_eq!(other, "inherited", "{case}");
                    TrackSetIntent::Inherited
                }
            };
            // `guard: "drop"` 表示这一行走投影那条路（护栏生效），护栏本身仍由
            // `hasTranslation` 决定；`guard: "keep"` 是 sidecar 写路径，不看它。
            let guard = match row["guard"].as_str().expect("guard") {
                "drop" => TranslationGuard::of_has_translation(
                    row["hasTranslation"].as_bool().unwrap_or(false),
                ),
                other => {
                    assert_eq!(other, "keep", "{case}");
                    TranslationGuard::Keep
                }
            };
            let mut style = row["style"].clone();
            canonicalize_track_set(&mut style, guard, intent);
            assert_eq!(style["tracks"], row["expected"]["tracks"], "{case}");
            assert_eq!(style["mode"], row["expected"]["mode"], "{case}");
            if let Some(contexts) = row["expected"].get(CONTEXTS_KEY) {
                for (name, set) in contexts.as_object().expect("contexts") {
                    assert_eq!(style[CONTEXTS_KEY][name]["mode"], set["mode"], "{case}");
                }
            }
            // 落盘形态自洽：读侧再裁一次拿到同一个轨集。
            assert_eq!(
                crate::tracks_json(&crate::resolve_track_set(&style)),
                style["tracks"],
                "{case}"
            );
        }
    }

    /// 没有 `voiceInkContexts` 的文档（Studio/Web 自己写出来的扁平样式）回落根 `mode`。
    #[test]
    fn a_document_without_contexts_falls_back_to_the_flat_mode() {
        let mut style = json!({"mode": "bi"});
        canonicalize_track_set(
            &mut style,
            TranslationGuard::Keep,
            TrackSetIntent::Inherited,
        );
        assert_eq!(
            style["tracks"],
            json!([{"role": "source"}, {"role": "translation"}])
        );
        // 没有上下文就不要凭空造一个出来。
        assert!(style.get(CONTEXTS_KEY).is_none());
    }

    /// 只带 `tracks` 的补丁撞不响 `reconcile` 的早退，也必须拿到裁决——这条钉住
    /// 「canonicalize 不能塞进 reconcile 里面」。
    #[test]
    fn a_tracks_only_patch_is_canonicalized_outside_reconcile() {
        let mut style = flat();
        style["tracks"] = json!([{"role": "source"}, {"role": "translation"}]);
        let changed = changed(&["tracks"]);
        reconcile(&mut style, &changed, None);
        // reconcile 逐比特不动：`tracks` 不是上下文承载得住的键。
        assert_eq!(style["mode"], "orig");
        canonicalize_track_set(
            &mut style,
            TranslationGuard::Keep,
            TrackSetIntent::of_changed(changed.iter().map(String::as_str)),
        );
        assert_eq!(style["mode"], "bi");
        assert_eq!(style[CONTEXTS_KEY]["bi"]["mode"], "bi");
    }

    /// 无译文护栏是投影那一份的事：sidecar 留意图。
    #[test]
    fn the_translation_guard_only_drops_the_track_where_it_is_asked_to() {
        let seed = json!({"mode": "bi", "tracks": [{"role": "source"}, {"role": "translation"}]});
        let mut kept = seed.clone();
        canonicalize_track_set(&mut kept, TranslationGuard::Keep, TrackSetIntent::Inherited);
        assert_eq!(kept["mode"], "bi");
        let mut dropped = seed;
        canonicalize_track_set(
            &mut dropped,
            TranslationGuard::Drop,
            TrackSetIntent::Inherited,
        );
        assert_eq!(dropped["tracks"], json!([{"role": "source"}]));
        assert_eq!(dropped["mode"], "orig");
    }

    /// 摘掉唯一一条轨之后轨集不能空：`[source]` 兜底。
    #[test]
    fn a_translation_only_track_set_falls_back_to_source_without_translation() {
        let mut style = json!({"tracks": [{"role": "translation", "lang": "zh"}]});
        canonicalize_track_set(
            &mut style,
            TranslationGuard::Drop,
            TrackSetIntent::Inherited,
        );
        assert_eq!(style["tracks"], json!([{"role": "source"}]));
        assert_eq!(style["mode"], "orig");
    }

    /// 语言标注只补空缺。
    #[test]
    fn track_languages_are_seeded_without_overwriting_authored_values() {
        let mut style = json!({
            "tracks": [{"role": "source", "lang": "ja"}, {"role": "translation"}]
        });
        seed_track_langs(&mut style, Some("en"), Some("zh"));
        assert_eq!(
            style["tracks"],
            json!([{"role": "source", "lang": "ja"}, {"role": "translation", "lang": "zh"}])
        );
    }

    #[test]
    fn ctx_hint_overrides_the_ambiguous_flat_mode() {
        let mut style = flat();
        style["fontSize"] = json!(20.0);
        reconcile(&mut style, &changed(&["fontSize"]), Some("bi"));
        let contexts = &style[CONTEXTS_KEY];
        assert_eq!(
            contexts["bi"]["orig"]["style"]["fontSize"].as_f64(),
            Some(20.0)
        );
        assert_eq!(
            contexts["sub"]["orig"]["style"]["fontSize"].as_f64(),
            Some(29.0)
        );
        assert_eq!(style["fontSize"].as_f64(), Some(20.0));
        assert_eq!(style["bilingualOrigScale"].as_f64(), Some(1.0));
    }

    #[test]
    fn translation_scale_resizes_the_bilingual_translation_line() {
        let mut style = flat();
        style["transScale"] = json!(2.0);
        reconcile(&mut style, &changed(&["transScale"]), None);
        assert_eq!(
            style[CONTEXTS_KEY]["bi"]["trans"]["style"]["fontSize"].as_f64(),
            Some(32.0)
        );
        assert_eq!(style["transScale"].as_f64(), Some(2.0));
    }

    #[test]
    fn look_keys_are_mapped_onto_the_context_field_names() {
        let mut style = flat();
        style["fontColor"] = json!("#18E1D6");
        style["bold"] = json!(true);
        style["align"] = json!("left");
        style["background"] = json!(true);
        style["fontFamily"] = json!("Montserrat");
        reconcile(
            &mut style,
            &changed(&["fontColor", "bold", "align", "background", "fontFamily"]),
            None,
        );
        let line = &style[CONTEXTS_KEY]["sub"]["orig"]["style"];
        assert_eq!(line["fontColor"], "#18E1D6");
        assert_eq!(line["fontWeight"], "bold");
        assert_eq!(line["textAlign"], "left");
        assert_eq!(line["bgOn"], true);
        assert_eq!(
            line["fontFamily"],
            json!({"type":"default","fontFamily":"Montserrat"})
        );
        // 双语上下文完全没有被单行上下文的改动波及。
        assert_eq!(
            style[CONTEXTS_KEY]["bi"]["orig"]["style"]["fontColor"],
            "#ffffff"
        );
    }

    #[test]
    fn line_partials_land_on_the_bilingual_line_and_its_placement() {
        let mut style = flat();
        style["transStyle"] = json!({"fontColor": "#FF0000", "x": 30.0, "y": 20.0});
        reconcile(&mut style, &changed(&["transStyle"]), None);
        let line = &style[CONTEXTS_KEY]["bi"]["trans"];
        assert_eq!(line["style"]["fontColor"], "#FF0000");
        assert_eq!(line["x"].as_f64(), Some(30.0));
        assert_eq!(line["y"].as_f64(), Some(20.0));
    }

    #[test]
    fn replacement_without_contexts_inherits_and_stays_two_way_closed() {
        let before = flat();
        let mut candidate = before.clone();
        candidate.as_object_mut().unwrap().remove(CONTEXTS_KEY);
        candidate["mode"] = json!("bi");
        reconcile_replacement(&mut candidate, &before, None);
        assert_eq!(candidate[CONTEXTS_KEY]["bi"]["mode"], "bi");
        assert_eq!(
            candidate[CONTEXTS_KEY]["sub"]["orig"]["style"]["fontSize"].as_f64(),
            Some(29.0)
        );
        assert_eq!(candidate["mode"], "bi");
    }

    #[test]
    fn replacement_with_authored_contexts_is_taken_verbatim() {
        let before = flat();
        let mut candidate = before.clone();
        candidate[CONTEXTS_KEY]["sub"]["orig"]["style"]["fontSize"] = json!(11.0);
        candidate["fontSize"] = json!(11.0);
        let expected = candidate.clone();
        reconcile_replacement(&mut candidate, &before, None);
        assert_eq!(candidate, expected);
    }

    #[test]
    fn projects_are_untouched_without_contexts() {
        let mut style = json!({"mode": "bi", "fontSize": 30.0});
        let expected = style.clone();
        reconcile(&mut style, &changed(&["fontSize"]), None);
        assert_eq!(style, expected);
    }

    #[test]
    fn flat_only_styles_materialize_two_independent_contexts_without_changing_effective_sizes() {
        let style = json!({
            "mode": "bi", "fontFamily": "Inter", "fontSize": 30.0,
            "fontColor": "#FFFFFF", "bold": true,
            "bilingualOrigScale": 16.0 / 30.0, "transScale": 22.0 / 16.0,
            "origStyle": {"fontColor": "#00FF00"},
            "transStyle": {"fontColor": "#FF00FF", "x": 50.0, "y": 30.0}
        });
        let materialized = materialize_contexts(&style);
        let contexts = &materialized[CONTEXTS_KEY];
        assert!(valid_contexts(contexts));
        assert_eq!(contexts["sub"]["mode"], "orig");
        assert_eq!(contexts["bi"]["mode"], "bi");
        assert_eq!(
            contexts["sub"]["orig"]["style"]["fontSize"].as_f64(),
            Some(30.0)
        );
        assert_eq!(
            contexts["bi"]["orig"]["style"]["fontSize"].as_f64(),
            Some(16.0)
        );
        assert_eq!(
            contexts["bi"]["trans"]["style"]["fontSize"].as_f64(),
            Some(22.0)
        );
        assert_eq!(contexts["bi"]["orig"]["style"]["fontColor"], "#00FF00");
        assert_eq!(contexts["bi"]["trans"]["style"]["fontColor"], "#FF00FF");
        assert!(contexts["bi"]["orig"].get("x").is_none());
        assert_eq!(contexts["bi"]["trans"]["x"], 50.0);
        assert_eq!(contexts["bi"]["trans"]["y"], 30.0);
        assert_eq!(materialized["fontSize"], style["fontSize"]);
        assert_eq!(materialized["mode"], style["mode"]);

        let defaults = materialize_contexts(&json!({"mode": "bi", "fontSize": 30.0}));
        assert_eq!(
            defaults[CONTEXTS_KEY]["bi"]["orig"]["style"]["fontSize"],
            20.0
        );
        assert_eq!(
            defaults[CONTEXTS_KEY]["bi"]["trans"]["style"]["fontSize"],
            32.0
        );
    }

    #[test]
    fn each_context_projects_its_own_look_and_bilingual_line_partials() {
        let mut style = flat();
        style[CONTEXTS_KEY]["sub"]["orig"]["style"]["fontColor"] = json!("#00AA00");
        style[CONTEXTS_KEY]["bi"]["orig"]["style"]["fontColor"] = json!("#AA0000");
        style[CONTEXTS_KEY]["bi"]["trans"]["style"]["fontColor"] = json!("#0000AA");

        let subtitle = context_style(&style, StyleContext::Subtitle);
        let bilingual = context_style(&style, StyleContext::Bilingual);
        assert_eq!(subtitle["mode"], "orig");
        assert_eq!(subtitle["fontColor"], "#00AA00");
        assert!(subtitle.get("origStyle").is_none());
        assert!(subtitle.get("transStyle").is_none());
        assert_eq!(bilingual["mode"], "bi");
        assert_eq!(bilingual["fontColor"], "#AA0000");
        assert_eq!(bilingual["origStyle"]["fontColor"], "#AA0000");
        assert_eq!(bilingual["transStyle"]["fontColor"], "#0000AA");
        assert_eq!(
            bilingual[CONTEXTS_KEY]["sub"]["orig"]["style"]["fontColor"],
            "#00AA00"
        );
    }

    #[test]
    fn bilingual_common_reports_mixed_values_and_unifies_both_lines() {
        let mut style = flat();
        style[CONTEXTS_KEY]["sub"]["orig"]["style"]["fontColor"] = json!("#00CC00");
        style[CONTEXTS_KEY]["bi"]["orig"]["style"]["fontColor"] = json!("#AA0000");
        style[CONTEXTS_KEY]["bi"]["trans"]["style"]["fontColor"] = json!("#0000AA");

        let (_, mixed) = bilingual_common(&style);
        assert!(mixed.contains("fontColor"));

        let unified = apply_bilingual_scope(
            &style,
            BilingualScope::Common,
            &json!({"fontColor": "#FFD43B", "fontSize": 36.0}),
        );
        let (common, mixed) = bilingual_common(&unified);
        assert_eq!(common["fontColor"], "#FFD43B");
        assert_eq!(common["fontSize"], 36.0);
        assert!(!mixed.contains("fontColor"));
        assert_eq!(
            unified[CONTEXTS_KEY]["sub"]["orig"]["style"]["fontColor"],
            "#00CC00"
        );
    }

    #[test]
    fn bilingual_line_scope_only_changes_the_selected_line() {
        let style = flat();
        let changed = apply_bilingual_scope(
            &style,
            BilingualScope::Translation,
            &json!({"fontColor": "#F000F0"}),
        );
        assert_eq!(
            changed[CONTEXTS_KEY]["bi"]["trans"]["style"]["fontColor"],
            "#F000F0"
        );
        assert_eq!(
            changed[CONTEXTS_KEY]["bi"]["orig"]["style"]["fontColor"],
            "#ffffff"
        );
    }

    #[test]
    fn style_context_wire_values_are_stable() {
        assert_eq!(
            serde_json::to_value(StyleContext::Subtitle).unwrap(),
            json!("sub")
        );
        assert_eq!(
            serde_json::to_value(StyleContext::Bilingual).unwrap(),
            json!("bi")
        );
        assert_eq!(StyleContext::from_hint("sub"), Some(StyleContext::Subtitle));
        assert_eq!(StyleContext::from_hint("bi"), Some(StyleContext::Bilingual));
        assert_eq!(StyleContext::from_hint("text"), None);
    }
}
