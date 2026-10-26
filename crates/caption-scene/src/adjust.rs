//! Template adjustments (`adjust`) and the editor summary of a scene.
//!
//! A template style keeps its scene untouched; the user's colour, font, size and
//! placement changes live beside it and are applied by one pure preprocessing pass
//! before validation and compilation, so every surface renders the same frame.
//! The summary lists what the editor may offer (colours with their uses, fonts,
//! word tags, effect tags) without the UI ever reading the expression tree.
use crate::*;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const ADJUST_UNSUPPORTED: &str = "CAPTION_ADJUST_UNSUPPORTED";
pub const MIN_FONT_SCALE: f64 = 0.5;
pub const MAX_FONT_SCALE: f64 = 2.0;
const MAX_COLOR_SWAPS: usize = 256;
const MAX_FONT_SWAPS: usize = 64;
const MAX_NAME_BYTES: usize = 128;

/// User changes layered on a template scene; the scene body itself never changes.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneAdjust {
    /// Replace every literal colour equal to `from` (compared as `#RRGGBBAA`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub colors: Vec<ColorSwap>,
    /// Replace a font family (the summary's font key) wherever text uses it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fonts: Vec<FontSwap>,
    /// Multiplies every text and label font size, 0.5..2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_scale: Option<f64>,
    /// Constant layout x / y / width as fractions of the canvas width / height.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placement: Option<Placement>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColorSwap {
    pub from: String,
    /// Without alpha (`#RRGGBB`) the replaced colour keeps its own alpha.
    pub to: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontSwap {
    pub from: String,
    pub to: FontTarget,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontTarget {
    pub family: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Placement {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
}
/// Where a frozen template came from. Not used for rendering.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleOrigin {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pack: Option<PackRef>,
    pub template: TemplateRef,
    /// Lowercase SHA-256 of the scene before any adjustment.
    pub scene_sha256: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackRef {
    pub id: String,
    pub version: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateRef {
    pub id: String,
    pub revision: u32,
}

impl SceneAdjust {
    pub fn is_empty(&self) -> bool {
        self.colors.is_empty()
            && self.fonts.is_empty()
            && self.font_scale.is_none_or(|s| s == 1.0)
            && self
                .placement
                .as_ref()
                .is_none_or(|p| p.x.is_none() && p.y.is_none() && p.width.is_none())
    }
}

fn name(path: &str, value: &str) -> Result<()> {
    if value.is_empty() || value.len() > MAX_NAME_BYTES {
        return Err(invalid(path, "1..128 UTF-8 bytes required"));
    }
    Ok(())
}

/// Shape checks for `adjust` that do not need the scene.
pub fn validate_adjust(adjust: &SceneAdjust) -> Result<()> {
    if adjust.colors.len() > MAX_COLOR_SWAPS {
        return Err(Diagnostic::new(
            "CAPTION_BUDGET_EXCEEDED",
            "adjust.colors",
            "at most 256 colour swaps",
        ));
    }
    let mut froms = BTreeSet::new();
    for (i, swap) in adjust.colors.iter().enumerate() {
        let from =
            normalize_color(&swap.from).ok_or_else(|| invalid(format!("adjust.colors.{i}.from"), "expected #RRGGBB or #RRGGBBAA"))?;
        normalize_color(&swap.to).ok_or_else(|| invalid(format!("adjust.colors.{i}.to"), "expected #RRGGBB or #RRGGBBAA"))?;
        if !froms.insert(from) {
            return Err(invalid(format!("adjust.colors.{i}.from"), "duplicate colour"));
        }
    }
    if adjust.fonts.len() > MAX_FONT_SWAPS {
        return Err(Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "adjust.fonts", "at most 64 font swaps"));
    }
    let mut keys = BTreeSet::new();
    for (i, swap) in adjust.fonts.iter().enumerate() {
        name(&format!("adjust.fonts.{i}.from"), &swap.from)?;
        name(&format!("adjust.fonts.{i}.to.family"), &swap.to.family)?;
        if swap.to.weight.is_some_and(|w| !(1..=1000).contains(&w)) {
            return Err(invalid(format!("adjust.fonts.{i}.to.weight"), "weight 1..1000 required"));
        }
        if !keys.insert(swap.from.as_str()) {
            return Err(invalid(format!("adjust.fonts.{i}.from"), "duplicate font"));
        }
    }
    if let Some(s) = adjust.font_scale
        && !(s.is_finite() && (MIN_FONT_SCALE..=MAX_FONT_SCALE).contains(&s))
    {
        return Err(invalid("adjust.fontScale", "0.5..2 required"));
    }
    if let Some(p) = &adjust.placement {
        for (key, value, lo) in [("x", p.x, 0.0), ("y", p.y, 0.0), ("width", p.width, 0.01)] {
            if value.is_some_and(|v| !(v.is_finite() && (lo..=1.0).contains(&v))) {
                return Err(invalid(format!("adjust.placement.{key}"), "fraction of the canvas required"));
            }
        }
    }
    Ok(())
}
pub fn validate_origin(origin: &StyleOrigin) -> Result<()> {
    if let Some(pack) = &origin.pack {
        name("origin.pack.id", &pack.id)?;
        name("origin.pack.version", &pack.version)?;
    }
    name("origin.template.id", &origin.template.id)?;
    if origin.template.revision == 0 {
        return Err(invalid("origin.template.revision", "positive revision required"));
    }
    let sha = &origin.scene_sha256;
    if sha.len() != 64 || !sha.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return Err(invalid("origin.sceneSha256", "lowercase SHA-256 required"));
    }
    Ok(())
}

/// `#RRGGBBAA` in upper case, or `None` when the string is not a scene colour.
pub fn normalize_color(s: &str) -> Option<String> {
    let h = s.strip_prefix('#')?;
    if !matches!(h.len(), 6 | 8) || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = format!("#{}", h.to_ascii_uppercase());
    if h.len() == 6 {
        out.push_str("FF");
    }
    Some(out)
}
/// The replacement for one literal: `to` keeps the literal's alpha unless it names its own.
fn swapped(original: &str, to: &str) -> String {
    let to = to.to_ascii_uppercase();
    if to.len() == 9 {
        return to;
    }
    let h = &original[1..];
    if h.len() == 8 {
        format!("{to}{}", h[6..].to_ascii_uppercase())
    } else {
        to
    }
}

/// Keys whose string values are never colours: identifiers, static text and resource digests.
fn skipped_key(key: &str) -> bool {
    key == "text" || key == "id" || key.ends_with("Id") || key == "contentHash" || key == "sha256" || key == "path"
}
/// Calls `f(path, colour)` for every colour literal outside parameter defaults.
fn each_color(value: &mut Value, path: &mut Vec<Seg>, f: &mut dyn FnMut(&[Seg], &mut String)) {
    match value {
        Value::String(s) if normalize_color(s).is_some() => f(path, s),
        Value::Array(items) => {
            for (i, item) in items.iter_mut().enumerate() {
                path.push(Seg::Index(i));
                each_color(item, path, f);
                path.pop();
            }
        }
        Value::Object(map) => {
            // A typed scene serializes the default text style on every node; only text and labels draw it.
            let styled = matches!(map.get("type").and_then(Value::as_str), Some("text" | "label"));
            let node = map.contains_key("type") && map.contains_key("id");
            for (k, v) in map.iter_mut() {
                if skipped_key(k) || (path.is_empty() && k == "parameters") || (node && !styled && (k == "style" || k == "stateStyles")) {
                    continue;
                }
                path.push(Seg::Key(k.clone()));
                each_color(v, path, f);
                path.pop();
            }
        }
        _ => {}
    }
}
#[derive(Clone, Debug, PartialEq)]
enum Seg {
    Key(String),
    Index(usize),
}

/// The scene with `adjust` applied, and the per-field refusals (`CAPTION_ADJUST_UNSUPPORTED`)
/// for placement keys the template computes from parameters or bindings.
pub struct Adjusted {
    pub scene: Scene,
    pub diagnostics: Vec<Diagnostic>,
}
pub fn apply_adjust(scene: &Scene, adjust: &SceneAdjust) -> Result<Adjusted> {
    validate_adjust(adjust)?;
    let mut out = scene.clone();
    let mut diagnostics = vec![];
    if !adjust.fonts.is_empty() {
        swap_fonts(&mut out, &adjust.fonts);
    }
    if let Some(s) = adjust.font_scale.filter(|s| *s != 1.0) {
        scale_fonts(&mut out, s);
    }
    if let Some(p) = &adjust.placement {
        place(&mut out, p, &mut diagnostics);
    }
    if !adjust.colors.is_empty() {
        let swaps: Vec<(String, &str)> = adjust
            .colors
            .iter()
            .map(|c| (normalize_color(&c.from).unwrap_or_default(), c.to.as_str()))
            .collect();
        let mut value = serde_json::to_value(&out).map_err(|e| invalid("adjust", e.to_string()))?;
        each_color(&mut value, &mut vec![], &mut |_, s| {
            let key = normalize_color(s).unwrap_or_default();
            if let Some((_, to)) = swaps.iter().find(|(from, _)| *from == key) {
                *s = swapped(s, to);
            }
        });
        out = serde_json::from_value(value).map_err(|e| invalid("adjust", e.to_string()))?;
    }
    Ok(Adjusted { scene: out, diagnostics })
}

fn text_like(node: &Node) -> bool {
    matches!(node.kind, NodeKind::Text | NodeKind::Label)
}
fn each_node(nodes: &mut [Node], f: &mut dyn FnMut(&mut Node)) {
    for node in nodes {
        f(node);
        each_node(&mut node.children, f);
    }
}
fn each_node_ref<'a>(nodes: &'a [Node], parent: Option<&'a Node>, f: &mut dyn FnMut(&'a Node, Option<&'a Node>)) {
    for node in nodes {
        f(node, parent);
        each_node_ref(&node.children, Some(node), f);
    }
}

fn swap_fonts(scene: &mut Scene, swaps: &[FontSwap]) {
    let find = |family: &str| swaps.iter().find(|s| s.from == family);
    each_node(&mut scene.nodes, &mut |node| {
        if !text_like(node) {
            return;
        }
        if let Some(swap) = find(&node.style.font_family) {
            node.style.font_family = swap.to.family.clone();
            node.style.font_source = None;
            if let Some(w) = swap.to.weight {
                node.style.font_weight = w;
            }
            if let Some(i) = swap.to.italic {
                node.style.italic = i;
            }
        }
    });
    for binding in &mut scene.layout.font_style_bindings {
        let Some(family) = binding.style.font_family.as_deref() else {
            continue;
        };
        if let Some(swap) = find(family) {
            binding.style.font_family = Some(swap.to.family.clone());
            binding.style.font_source = None;
            if swap.to.weight.is_some() {
                binding.style.font_weight = swap.to.weight;
            }
            if swap.to.italic.is_some() {
                binding.style.italic = swap.to.italic;
            }
        }
    }
}

fn scale_number(v: &mut Value, s: f64) {
    if let Some(n) = v.as_f64() {
        *v = serde_json::json!(n * s);
    }
}
fn scale_dynamic(value: &mut DynamicValue, s: f64) {
    match value {
        DynamicValue::Constant { value } => scale_number(value, s),
        DynamicValue::Keyframes { keys, .. } => keys.iter_mut().for_each(|k| scale_number(&mut k.value, s)),
        DynamicValue::Expression { expression } => {
            let inner = std::mem::replace(expression, Expression::Read { path: String::new() });
            *expression = Expression::Call {
                function: "mul".into(),
                args: vec![
                    inner,
                    Expression::Literal {
                        value_type: ValueType::Scalar,
                        value: serde_json::json!(s),
                    },
                ],
            };
        }
    }
}
fn scale_fonts(scene: &mut Scene, s: f64) {
    each_node(&mut scene.nodes, &mut |node| {
        if !text_like(node) {
            return;
        }
        node.style.font_size.value *= s;
        node.style.font_size.offset *= s;
        if let Some(size) = node.properties.get_mut("fontSize") {
            scale_dynamic(size, s);
        }
    });
    for binding in &mut scene.layout.bindings {
        if binding.property == "fontSize" {
            scale_dynamic(&mut binding.value, s);
        }
    }
    for binding in &mut scene.layout.font_size_bindings {
        scale_dynamic(&mut binding.value, s);
        if let Some(reference) = &mut binding.reference_value {
            scale_dynamic(reference, s);
        }
    }
}

/// Layout keys the template fixes with a constant, which `placement` may override.
pub fn placeable(scene: &Scene) -> Vec<&'static str> {
    let bound = |key: &str| scene.layout.bindings.iter().any(|b| b.node_id.is_none() && b.property == key);
    let mut out = vec![];
    for (key, length) in [("x", &scene.layout.x), ("y", &scene.layout.y), ("width", &scene.layout.width)] {
        if length.parameter.is_none() && !bound(key) {
            out.push(key);
        }
    }
    out
}
fn place(scene: &mut Scene, p: &Placement, diagnostics: &mut Vec<Diagnostic>) {
    let open = placeable(scene);
    for (key, value) in [("x", p.x), ("y", p.y), ("width", p.width)] {
        let Some(value) = value else { continue };
        if !open.contains(&key) {
            diagnostics.push(Diagnostic::new(
                ADJUST_UNSUPPORTED,
                format!("adjust.placement.{key}"),
                "the template computes this layout value",
            ));
            continue;
        }
        let basis = if key == "y" {
            LengthBasis::CanvasHeight
        } else {
            LengthBasis::CanvasWidth
        };
        let length = Length {
            value,
            parameter: None,
            basis,
            offset: 0.0,
        };
        match key {
            "x" => scene.layout.x = length,
            "y" => scene.layout.y = length,
            _ => scene.layout.width = length,
        }
    }
}

impl SceneStyle {
    /// The style as rendered: `adjust` applied to the scene and dropped, `origin` dropped.
    pub fn resolved(&self) -> Result<Adjusted> {
        let base = self.scene();
        let adjusted = match &self.adjust {
            Some(adjust) if !adjust.is_empty() => apply_adjust(base, adjust)?,
            _ => Adjusted {
                scene: base.clone(),
                diagnostics: vec![],
            },
        };
        Ok(adjusted)
    }
    /// A copy with the adjusted scene inline and no `adjust` / `origin`.
    pub fn rendered(&self) -> Result<SceneStyle> {
        let Adjusted { scene, .. } = self.resolved()?;
        Ok(SceneStyle {
            schema: self.schema.clone(),
            scene: SceneSource::Inline { value: scene },
            parameters: self.parameters.clone(),
            adjust: None,
            origin: None,
        })
    }
}

/* ---------------- summary ---------------- */

/// What the editor shows for one template scene (computed from the unadjusted scene;
/// with `adjust`, colour and font entries also carry the adjusted value `to`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneSummary {
    pub colors: Vec<SummaryColor>,
    pub fonts: Vec<SummaryFont>,
    /// Word tags the scene's selectors and pagination read, such as `keyword`.
    pub word_tags: Vec<String>,
    /// Visible effect tags (caption editor design §8).
    pub behaviors: Vec<&'static str>,
    pub tiers: Vec<&'static str>,
    pub needs_word_timing: bool,
    /// The result changes with `presentation.seed`.
    pub seeded: bool,
    pub pagination: SummaryPagination,
    pub layers: Vec<SummaryLayer>,
    pub adjustable: Adjustable,
    /// Where the block sits now (with `adjust` applied), as fractions of the canvas axis.
    pub placement: SummaryPlacement,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryColor {
    /// `#RRGGBBAA`, upper case.
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    pub uses: Vec<&'static str>,
    pub animated: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryFont {
    pub key: String,
    pub family: String,
    pub weight: u16,
    pub italic: bool,
    /// Letter spacing tuned for this font, which a font swap keeps.
    pub tuned_spacing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<FontTarget>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryPagination {
    /// `auto` wraps by width and line count; `fixed` uses word or row patterns.
    pub mode: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words_per_page: Option<usize>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryLayer {
    pub node_id: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}
/// The current centre `x` / `y` and wrap `width` of a placeable key, as fractions of canvas width
/// (`x`, `width`) or height (`y`). Missing for keys the template computes, and for keys whose length
/// needs the canvas size when none was given.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct SummaryPlacement {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adjustable {
    pub colors: bool,
    pub fonts: bool,
    pub font_scale: bool,
    /// Layout keys `adjust.placement` may set.
    pub placement: Vec<&'static str>,
}

const USE_ORDER: [&str; 11] = [
    "text", "stroke", "shadow", "glow", "active", "read", "unread", "keyword", "plate", "word-box", "material",
];

fn num(v: Option<&Value>) -> f64 {
    v.and_then(Value::as_f64).unwrap_or(0.0)
}
/// What one paint layer looks like (`fill`, `stroke`, `shadow`, `inner-shadow`, `glow`, `image`).
fn layer_kind(layer: &Value) -> &'static str {
    let offset = layer
        .get("offset")
        .and_then(Value::as_array)
        .is_some_and(|o| o.iter().any(|v| v.as_f64().is_some_and(|n| n != 0.0)));
    let widened = num(layer.get("strokeWidth")) > 0.0 || num(layer.get("spread")) > 0.0;
    if layer.get("distanceCoverage").is_some_and(|d| !d.is_null()) {
        "inner-shadow"
    } else if offset {
        "shadow"
    } else if num(layer.get("blur")) > 0.0 {
        "glow"
    } else if widened {
        "stroke"
    } else if layer.pointer("/paint/kind").and_then(Value::as_str) == Some("image") {
        "image"
    } else {
        "fill"
    }
}
fn layer_use(layer: &Value) -> &'static str {
    match layer_kind(layer) {
        "inner-shadow" | "shadow" => "shadow",
        "glow" => "glow",
        "stroke" => "stroke",
        _ => "text",
    }
}
/// The state or tag a selector's filter narrows to, as a colour use.
fn filter_use(filter: &Value) -> Option<&'static str> {
    match filter.get("kind").and_then(Value::as_str)? {
        "tag" => Some("keyword"),
        "state" => match filter.get("value").and_then(Value::as_str)? {
            "active" => Some("active"),
            "read" => Some("read"),
            "unread" => Some("unread"),
            _ => None,
        },
        "and" | "or" => filter.get("filters")?.as_array()?.iter().find_map(filter_use),
        _ => None,
    }
}
fn selector_use(root: &Value, selector_id: Option<&str>) -> Option<&'static str> {
    let id = selector_id?;
    let selector = root
        .get("selectors")?
        .as_array()?
        .iter()
        .find(|s| s.get("id").and_then(Value::as_str) == Some(id))?;
    filter_use(selector.get("filter")?)
}
/// Finds a node by id anywhere in the tree, with its parent.
fn find_node<'a>(nodes: &'a [Value], id: &str, parent: Option<&'a Value>) -> Option<(&'a Value, Option<&'a Value>)> {
    for node in nodes {
        if node.get("id").and_then(Value::as_str) == Some(id) {
            return Some((node, parent));
        }
        if let Some(children) = node.get("children").and_then(Value::as_array)
            && let Some(hit) = find_node(children, id, Some(node))
        {
            return Some(hit);
        }
    }
    None
}
fn node_type(node: &Value) -> &str {
    node.get("type").and_then(Value::as_str).unwrap_or("")
}
fn decoration_use(parent: Option<&Value>) -> &'static str {
    if parent.is_some_and(|p| node_type(p) == "repeat") {
        "word-box"
    } else {
        "plate"
    }
}
fn key_at(path: &[Seg], i: usize) -> Option<&str> {
    match path.get(i) {
        Some(Seg::Key(k)) => Some(k),
        _ => None,
    }
}
fn index_at(path: &[Seg], i: usize) -> Option<usize> {
    match path.get(i) {
        Some(Seg::Index(n)) => Some(*n),
        _ => None,
    }
}
/// The use of the colour at `path` (relative to the scene root).
fn color_use(root: &Value, path: &[Seg]) -> &'static str {
    match key_at(path, 0) {
        Some("nodes") => {
            let mut node = None;
            let mut parent = None;
            let mut list = root.get("nodes");
            let mut i = 1;
            while let (Some(items), Some(n)) = (list.and_then(Value::as_array), index_at(path, i)) {
                parent = node;
                node = items.get(n);
                i += 1;
                if key_at(path, i) == Some("children") {
                    list = node.and_then(|v| v.get("children"));
                    i += 1;
                } else {
                    break;
                }
            }
            let Some(node) = node else { return "material" };
            let rest = &path[i..];
            let kind = node_type(node);
            if kind == "shape" {
                return decoration_use(parent);
            }
            if !matches!(kind, "text" | "label") {
                return "material";
            }
            match (key_at(rest, 0), key_at(rest, 1)) {
                (Some("style"), Some("stroke")) => "stroke",
                (Some("style"), Some("paints")) => index_at(rest, 2)
                    .and_then(|k| node.pointer(&format!("/style/paints/{k}")))
                    .map(layer_use)
                    .unwrap_or("text"),
                (Some("stateStyles"), Some("active")) => "active",
                (Some("stateStyles"), Some("read")) => "read",
                (Some("stateStyles"), Some("unread")) => "unread",
                _ => "text",
            }
        }
        Some("paintStyleBindings") => {
            let Some(binding) = index_at(path, 1).and_then(|i| root.get("paintStyleBindings")?.get(i)) else {
                return "text";
            };
            // Effects in a word stack keep their own use; its body colour is the selected words' colour.
            let layer = match (key_at(path, 3), index_at(path, 4)) {
                (Some("paints"), Some(k)) => binding.pointer(&format!("/style/paints/{k}")).map(layer_use).unwrap_or("text"),
                _ => "text",
            };
            if layer != "text" {
                return layer;
            }
            selector_use(root, binding.get("selectorId").and_then(Value::as_str)).unwrap_or("text")
        }
        Some("paintPropertyBindings") => {
            let Some(binding) = index_at(path, 1).and_then(|i| root.get("paintPropertyBindings")?.get(i)) else {
                return "text";
            };
            let node_id = binding.get("nodeId").and_then(Value::as_str).unwrap_or("");
            let paint_id = binding.get("paintId").and_then(Value::as_str).unwrap_or("");
            let layer = find_node(
                root.get("nodes").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]),
                node_id,
                None,
            )
            .and_then(|(n, _)| {
                n.pointer("/style/paints")?
                    .as_array()?
                    .iter()
                    .find(|l| l.get("id").and_then(Value::as_str) == Some(paint_id))
            })
            .map(layer_use)
            .unwrap_or("text");
            if layer != "text" {
                return layer;
            }
            selector_use(root, binding.get("selectorId").and_then(Value::as_str)).unwrap_or("text")
        }
        Some("animations") => {
            let Some(anim) = index_at(path, 1).and_then(|i| root.get("animations")?.get(i)) else {
                return "text";
            };
            if let Some(u) = selector_use(root, anim.pointer("/target/selectorId").and_then(Value::as_str)) {
                return u;
            }
            let node_id = anim.pointer("/target/nodeId").and_then(Value::as_str).unwrap_or("");
            match find_node(
                root.get("nodes").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]),
                node_id,
                None,
            ) {
                Some((n, parent)) if node_type(n) == "shape" => decoration_use(parent),
                Some((n, _)) if matches!(node_type(n), "text" | "label") => "text",
                _ => "material",
            }
        }
        Some("materials") | Some("renderLayers") => {
            let glow = path_object_kind(root, path).is_some_and(|k| k.contains("glow"));
            if glow { "glow" } else { "material" }
        }
        _ => "material",
    }
}
/// The `kind` of the nearest material object along `path`.
fn path_object_kind<'a>(root: &'a Value, path: &[Seg]) -> Option<&'a str> {
    let mut cur = root;
    let mut kind = None;
    for seg in path {
        cur = match seg {
            Seg::Key(k) => cur.get(k)?,
            Seg::Index(i) => cur.get(i)?,
        };
        if let Some(k) = cur.get("kind").and_then(Value::as_str) {
            kind = Some(k);
        }
    }
    kind
}
fn animated_path(root_key: Option<&str>, path: &[Seg]) -> bool {
    matches!(root_key, Some("animations") | Some("paintPropertyBindings") | Some("functions"))
        || path.iter().any(|s| matches!(s, Seg::Key(k) if k == "keys" || k == "expression"))
}

fn scene_json(scene: &Scene) -> Value {
    serde_json::to_value(scene).unwrap_or(Value::Null)
}
fn walk(value: &Value, f: &mut dyn FnMut(&Map<String, Value>)) {
    match value {
        Value::Array(items) => items.iter().for_each(|v| walk(v, f)),
        Value::Object(map) => {
            f(map);
            map.values().for_each(|v| walk(v, f));
        }
        _ => {}
    }
}

/// The editor summary of a template scene. `canvas` (width, height in pixels) lets `placement`
/// report lengths written in pixels or against the other axis.
pub fn describe(scene: &Scene, adjust: Option<&SceneAdjust>, canvas: Option<(u32, u32)>) -> SceneSummary {
    let root = scene_json(scene);
    // Colours, in use order.
    let mut colors: Vec<SummaryColor> = vec![];
    {
        let mut copy = root.clone();
        each_color(&mut copy, &mut vec![], &mut |path, s| {
            let value = normalize_color(s).unwrap_or_default();
            let use_ = color_use(&root, path);
            let animated = animated_path(key_at(path, 0), path);
            match colors.iter_mut().find(|c| c.value == value) {
                Some(c) => {
                    if !c.uses.contains(&use_) {
                        c.uses.push(use_);
                    }
                    c.animated |= animated;
                }
                None => colors.push(SummaryColor {
                    value,
                    to: None,
                    uses: vec![use_],
                    animated,
                }),
            }
        });
    }
    let rank = |u: &str| USE_ORDER.iter().position(|o| *o == u).unwrap_or(USE_ORDER.len());
    for c in &mut colors {
        c.uses.sort_by_key(|u| rank(u));
    }
    colors.sort_by_key(|c| c.uses.first().map(|u| rank(u)).unwrap_or(USE_ORDER.len()));
    if let Some(adjust) = adjust {
        for c in &mut colors {
            if let Some(swap) = adjust.colors.iter().find(|s| normalize_color(&s.from).as_deref() == Some(&c.value)) {
                c.to = Some(normalize_color(&swapped(&c.value, &swap.to)).unwrap_or_default());
            }
        }
    }

    // Fonts, by family in first-use order.
    let mut fonts: Vec<SummaryFont> = vec![];
    let mut text_nodes = 0usize;
    each_node_ref(&scene.nodes, None, &mut |node, _| {
        if !text_like(node) {
            return;
        }
        text_nodes += 1;
        let s = &node.style;
        let tuned = s.letter_spacing != 0.0;
        match fonts.iter_mut().find(|f| f.key == s.font_family) {
            Some(f) => f.tuned_spacing |= tuned,
            None => fonts.push(SummaryFont {
                key: s.font_family.clone(),
                family: s.font_family.clone(),
                weight: s.font_weight,
                italic: s.italic,
                tuned_spacing: tuned,
                to: None,
            }),
        }
    });
    for binding in &scene.layout.font_style_bindings {
        if let Some(family) = &binding.style.font_family
            && !fonts.iter().any(|f| &f.key == family)
        {
            fonts.push(SummaryFont {
                key: family.clone(),
                family: family.clone(),
                weight: binding.style.font_weight.unwrap_or(400),
                italic: binding.style.italic.unwrap_or(false),
                tuned_spacing: false,
                to: None,
            });
        }
    }
    if scene.layout.bindings.iter().any(|b| b.property == "letterSpacing") {
        fonts.iter_mut().for_each(|f| f.tuned_spacing = true);
    }
    if let Some(adjust) = adjust {
        for f in &mut fonts {
            f.to = adjust.fonts.iter().find(|s| s.from == f.key).map(|s| s.to.clone());
        }
    }

    // Word tags.
    let mut tags = BTreeSet::new();
    walk(&root, &mut |map| {
        if map.get("kind").and_then(Value::as_str) == Some("tag")
            && let Some(t) = map.get("value").and_then(Value::as_str)
        {
            tags.insert(t.to_string());
        }
    });
    for rule in &scene.layout.pagination.isolation {
        tags.insert(rule.tag.clone());
    }
    if let Some(runs) = &scene.layout.pagination.tag_runs {
        tags.insert(runs.tag.clone());
    }

    // Layers.
    let mut layers = vec![];
    each_node_ref(&scene.nodes, None, &mut |node, parent| {
        let id = node.id.clone();
        match node.kind {
            NodeKind::Text | NodeKind::Label => {
                let style = serde_json::to_value(&node.style).unwrap_or(Value::Null);
                let paints = style.get("paints").and_then(Value::as_array).cloned().unwrap_or_default();
                if paints.is_empty() {
                    layers.push(SummaryLayer {
                        node_id: id.clone(),
                        kind: "fill",
                        detail: None,
                    });
                    if node.style.stroke.is_some() {
                        layers.push(SummaryLayer {
                            node_id: id,
                            kind: "stroke",
                            detail: None,
                        });
                    }
                } else {
                    for p in &paints {
                        layers.push(SummaryLayer {
                            node_id: id.clone(),
                            kind: layer_kind(p),
                            detail: p
                                .pointer("/paint/kind")
                                .and_then(Value::as_str)
                                .filter(|k| *k != "solid")
                                .map(str::to_string),
                        });
                    }
                }
            }
            NodeKind::Shape => layers.push(SummaryLayer {
                node_id: id,
                kind: if parent.is_some_and(|p| p.kind == NodeKind::Repeat) {
                    "box"
                } else {
                    "plate"
                },
                detail: None,
            }),
            NodeKind::Image => layers.push(SummaryLayer {
                node_id: id,
                kind: "image",
                detail: None,
            }),
            _ => {}
        }
    });
    let mut material_kinds = vec![];
    walk(root.get("materials").unwrap_or(&Value::Null), &mut |map| {
        if let Some(k) = map.get("kind").and_then(Value::as_str) {
            material_kinds.push(k.to_string());
        }
    });
    walk(root.get("renderLayers").unwrap_or(&Value::Null), &mut |map| {
        if let Some(materials) = map.get("materials").and_then(Value::as_array) {
            for m in materials {
                if let Some(k) = m.get("kind").and_then(Value::as_str) {
                    material_kinds.push(k.to_string());
                }
            }
        }
    });
    material_kinds.dedup();
    for k in &material_kinds {
        layers.push(SummaryLayer {
            node_id: String::new(),
            kind: if k.contains("glow") { "glow" } else { "material" },
            detail: Some(k.clone()),
        });
    }

    let needs_word_timing = scene.speech_state.timing_policy == TimingPolicy::RequireWordTiming && reads_word_timing(&root);
    let seeded = reads_seed(&root);
    let pagination = summary_pagination(&scene.layout.pagination);
    let behaviors = behaviors(scene, &root, &layers, &tags, &material_kinds);
    let mut tiers = vec![];
    if !scene.animations.is_empty() || !scene.layout.bindings.is_empty() {
        tiers.push("glyph-motion");
    }
    if layers.iter().any(|l| l.kind != "fill" && l.kind != "material" && l.kind != "image")
        || !tags.is_empty()
        || colors.iter().any(|c| c.uses.contains(&"active"))
    {
        tiers.push("text-paint");
    }
    if !material_kinds.is_empty() || !scene.render_layers.is_empty() {
        tiers.push("texture-effects");
    }
    let mut decorated = false;
    each_node_ref(&scene.nodes, None, &mut |node, parent| {
        if parent.is_some_and(|p| p.kind == NodeKind::Repeat) && matches!(node.kind, NodeKind::Label | NodeKind::Image) {
            decorated = true;
        }
    });
    if decorated || !scene.sequences.is_empty() {
        tiers.push("derived-decoration");
    }
    let placement = placeable(scene);
    let current = current_placement(scene, &placement, adjust.and_then(|a| a.placement.as_ref()), canvas);
    SceneSummary {
        adjustable: Adjustable {
            colors: !colors.is_empty(),
            fonts: !fonts.is_empty(),
            font_scale: text_nodes > 0,
            placement,
        },
        placement: current,
        colors,
        fonts,
        word_tags: tags.into_iter().collect(),
        behaviors,
        tiers,
        needs_word_timing,
        seeded,
        pagination,
        layers,
    }
}

fn reads_word_timing(root: &Value) -> bool {
    let mut hit = false;
    walk(root, &mut |map| {
        if hit {
            return;
        }
        if let Some(path) = map.get("path").and_then(Value::as_str)
            && map.get("op").and_then(Value::as_str) == Some("read")
        {
            hit = (path.starts_with("time.") && path.contains("Word"))
                || matches!(path, "unit.active" | "unit.read" | "unit.unread")
                || path.contains("activeWord")
                || path.starts_with("word.")
                || path.contains("speechPhase")
                || path.ends_with("WordTimed");
        }
        if map.get("kind").and_then(Value::as_str) == Some("state") && map.contains_key("value") {
            hit = true;
        }
        if map.contains_key("origin") && map.contains_key("duration") && map.get("unit").and_then(Value::as_str) == Some("word") {
            hit = true;
        }
        if let Some(states) = map.get("stateStyles") {
            hit |= ["active", "read", "unread"]
                .iter()
                .any(|k| states.get(*k).is_some_and(|v| !v.is_null()));
        }
        if map.get("pageWindow").is_some_and(|v| !v.is_null()) {
            hit = true;
        }
    });
    hit
}
fn reads_seed(root: &Value) -> bool {
    let mut hit = false;
    walk(root, &mut |map| {
        if map.get("op").and_then(Value::as_str) == Some("call")
            && matches!(
                map.get("function").and_then(Value::as_str),
                Some("random" | "noise" | "shuffle-index")
            )
        {
            hit = true;
        }
        if map.get("by").and_then(Value::as_str) == Some("seed") {
            hit = true;
        }
    });
    hit
}
fn current_placement(scene: &Scene, open: &[&str], adjust: Option<&Placement>, canvas: Option<(u32, u32)>) -> SummaryPlacement {
    let fraction = |key: &str, length: &Length, set: Option<f64>| -> Option<f64> {
        if !open.contains(&key) {
            return None;
        }
        if set.is_some() {
            return set;
        }
        let natural = if key == "y" {
            LengthBasis::CanvasHeight
        } else {
            LengthBasis::CanvasWidth
        };
        if length.basis == natural && length.offset == 0.0 {
            return Some(length.value);
        }
        let (w, h) = canvas.filter(|&(w, h)| w > 0 && h > 0)?;
        let axis = if key == "y" { h } else { w } as f64;
        let px = length.resolve(w, h, &BTreeMap::new()).ok()?;
        Some(px / axis)
    };
    SummaryPlacement {
        x: fraction("x", &scene.layout.x, adjust.and_then(|p| p.x)),
        y: fraction("y", &scene.layout.y, adjust.and_then(|p| p.y)),
        width: fraction("width", &scene.layout.width, adjust.and_then(|p| p.width)),
    }
}
fn summary_pagination(p: &Pagination) -> SummaryPagination {
    let fixed = p.word_page_pattern.is_some()
        || p.word_line_pattern.is_some()
        || p.text_line_pattern.is_some()
        || p.remaining_word_page_plans.is_some()
        || p.pattern_select.is_some();
    let words = p
        .max_units_per_page
        .or_else(|| p.word_page_pattern.as_ref().and_then(|w| w.first().copied()))
        .or_else(|| p.word_line_pattern.as_ref().and_then(|w| w.first()).map(|rows| rows.iter().sum()));
    SummaryPagination {
        mode: if fixed { "fixed" } else { "auto" },
        words_per_page: words,
    }
}
fn multiline(p: &Pagination) -> bool {
    let rows = |plans: &Vec<Vec<usize>>| plans.iter().any(|r| r.len() > 1);
    p.word_line_pattern.as_ref().is_some_and(rows)
        || p.remaining_word_page_plans.as_ref().is_some_and(rows)
        || p.text_line_pattern.as_ref().is_some_and(|t| rows(&t.lines))
        || p.pattern_select
            .as_ref()
            .is_some_and(|s| s.candidates.iter().any(|c| rows(&c.word_line_pattern)))
}

fn behaviors(scene: &Scene, root: &Value, layers: &[SummaryLayer], tags: &BTreeSet<String>, materials: &[String]) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = vec![];
    let mut add = |tag: &'static str| {
        if !out.contains(&tag) {
            out.push(tag);
        }
    };
    let selector_unit = |id: Option<&str>| scene.selectors.iter().find(|s| Some(s.id.as_str()) == id).map(|s| s.unit);
    let state_selector = |id: Option<&str>| {
        id.and_then(|id| {
            root.get("selectors")?
                .as_array()?
                .iter()
                .find(|s| s.get("id").and_then(Value::as_str) == Some(id))
        })
        .and_then(|s| filter_use(s.get("filter")?))
            == Some("active")
    };
    // Active-word colour.
    let mut active_fill = false;
    each_node_ref(&scene.nodes, None, &mut |node, _| {
        active_fill |= node.state_styles.active.is_some();
    });
    active_fill |= scene.paint_style_bindings.iter().any(|b| state_selector(Some(&b.selector_id)));
    active_fill |= scene.paint_property_bindings.iter().any(|b| state_selector(Some(&b.selector_id)));
    if active_fill {
        add("active-color");
    }
    // Active-word box: a repeated decoration over the active word.
    let mut active_box = false;
    each_node_ref(&scene.nodes, None, &mut |node, _| {
        if node.kind == NodeKind::Repeat && state_selector(node.selector_id.as_deref()) {
            active_box = true;
        }
    });
    if active_box {
        add("active-box");
    }
    if materials.iter().any(|k| k.contains("sweep") || k.contains("soft-band")) {
        add("sweep");
    }
    for anim in &scene.animations {
        let value = serde_json::to_value(&anim.value).unwrap_or(Value::Null);
        let clock = value.pointer("/clock/unit").and_then(Value::as_str);
        let unit = selector_unit(anim.target.selector_id.as_deref());
        let repeats = value.pointer("/clock/repeat").is_some_and(|r| !r.is_null());
        let continuous = anim.value_reads("time.seconds");
        if repeats || continuous {
            add("loop");
        }
        if anim.property.starts_with("transform.scale") && clock == Some("word") {
            add("word-pop");
        } else if anim.property == "opacity" && (clock == Some("grapheme") || unit == Some(UnitKind::Grapheme)) {
            add("reveal");
        } else if anim.property == "opacity" && clock == Some("word") {
            add("reveal");
        } else if matches!(clock, Some("page" | "line" | "cue")) && !repeats {
            add("line-motion");
        }
    }
    let has = |kind: &str| layers.iter().any(|l| l.kind == kind);
    if has("stroke") {
        add("stroke");
    }
    if has("shadow") || has("inner-shadow") {
        add("shadow");
    }
    if has("glow") {
        add("glow");
    }
    let mut gradient = false;
    let mut texture = false;
    walk(root, &mut |map| match map.get("kind").and_then(Value::as_str) {
        Some("linear") => gradient = true,
        Some("image") if map.contains_key("uvTransform") => texture = true,
        _ => {}
    });
    if gradient {
        add("gradient");
    }
    if texture {
        add("texture");
    }
    if has("plate") || has("box") {
        add("plate");
    }
    if !tags.is_empty() {
        add("keyword");
    }
    if multiline(&scene.layout.pagination) {
        add("multiline");
    }
    let mut decoration = false;
    each_node_ref(&scene.nodes, None, &mut |node, parent| {
        if parent.is_some_and(|p| p.kind == NodeKind::Repeat) && matches!(node.kind, NodeKind::Label | NodeKind::Image) {
            decoration = true;
        }
    });
    if decoration {
        add("decoration");
    }
    out
}

impl Animation {
    fn value_reads(&self, path: &str) -> bool {
        let value = serde_json::to_value(&self.value).unwrap_or(Value::Null);
        let mut hit = false;
        walk(&value, &mut |map| {
            if map.get("op").and_then(Value::as_str) == Some("read") && map.get("path").and_then(Value::as_str) == Some(path) {
                hit = true;
            }
        });
        hit
    }
}
