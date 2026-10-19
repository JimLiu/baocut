use crate::*;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const CAPABILITIES: &[&str] = &[
    "caption-render-layers/1",
    "caption-image-sequence/1",
    "caption-noisy-sweep/1",
    "caption-bound-label/1",
    "caption-scene/1",
    "caption-text-context/1",
    "caption-ink-context/1",
    "caption-glyph-envelope/1",
    "caption-page-envelope/1",
    "caption-unit-context/1",
    "caption-cue-word-context/1",
    "caption-first-page-context/1",
    "caption-cue-unit-context/1",
    "caption-active-word-context/1",
    "caption-expressions/1",
    "caption-permutation/1",
    "caption-function-dag/1",
    "caption-bezier-expression/1",
    "caption-unit-animation/1",
    "caption-image-png/1",
    "caption-paint-stack/1",
    "caption-blur/1",
    "caption-feedback/1",
    "caption-wave-displace/1",
    "caption-soft-band/1",
    "caption-noise-palette-mix/1",
    "caption-angular-sample-blend/1",
    "caption-gradient-smear/1",
    "caption-gaussian-axis/1",
    "caption-glow-cascade/1",
    "caption-glow-tint/1",
    "caption-glow-color-matrix/1",
    "caption-layout-per-sample/1",
    "caption-page-window/1",
    "caption-unit-font-size/1",
    "caption-unit-font-style/1",
    "caption-word-line-layout/1",
    "caption-text-line-layout/1",
    "caption-scalar-cluster-layout/1",
];
pub fn property_type(property: &str) -> Option<ValueType> {
    Some(match property {
        "transform.x" | "transform.y" | "width" | "height" | "radius" | "fontSize" => ValueType::Length,
        "transform.rotation" => ValueType::Angle,
        "transform.scale" | "transform.scaleX" | "transform.scaleY" | "opacity" => ValueType::Scalar,
        "fill" => ValueType::Color,
        _ => return None,
    })
}
pub fn parse_style(body: &Value) -> Result<SceneStyle> {
    let style: SceneStyle = serde_json::from_value(body.clone()).map_err(|e| invalid("style", e.to_string()))?;
    validate_style(&style)?;
    Ok(style)
}
pub fn validate_style(style: &SceneStyle) -> Result<()> {
    if style.schema != STYLE_SCHEMA {
        return Err(Diagnostic::new("CAPTION_SCENE_SCHEMA_UNSUPPORTED", "schema", &style.schema));
    }
    validate_scene(style.scene())?;
    parameters(style.scene(), &[&style.parameters])?;
    Ok(())
}
pub fn parameters(scene: &Scene, overrides: &[&BTreeMap<String, Value>]) -> Result<BTreeMap<String, Evaluated>> {
    let mut out = BTreeMap::new();
    for p in &scene.parameters {
        out.insert(format!("params.{}", p.id), typed_value(p.value_type, &p.default)?);
    }
    for layer in overrides {
        for (id, value) in *layer {
            let p = scene
                .parameters
                .iter()
                .find(|p| p.id == *id)
                .ok_or_else(|| invalid(format!("parameters.{id}"), "undeclared parameter"))?;
            let v = typed_value(p.value_type, value)?;
            if let Evaluated::Number(_, n) = v {
                if p.min.is_some_and(|v| n < v) || p.max.is_some_and(|v| n > v) {
                    return Err(invalid(id, "parameter out of range"));
                }
            }
            out.insert(format!("params.{id}"), v);
        }
    }
    Ok(out)
}
pub fn validate_presentation(p: &Presentation, scene: Option<&Scene>) -> Result<()> {
    if p.word_tags
        .values()
        .any(|tags| tags.len() > 128 || tags.iter().any(|t| t.len() > 128))
    {
        return Err(invalid("wordTags", "tag budget exceeded"));
    }
    if p.seed.len() != 16 || u64::from_str_radix(&p.seed, 16).is_err() {
        return Err(invalid("presentation.seed", "16 hexadecimal digits required"));
    }
    if p.cue_overrides.len() > MAX_UNITS || p.word_tags.len() > MAX_UNITS {
        return Err(invalid("presentation", "binding budget exceeded"));
    }
    let mut seen = BTreeSet::new();
    for c in &p.cue_overrides {
        if !seen.insert((&c.cue_id, &c.occurrence_id)) {
            return Err(invalid("cueOverrides", "duplicate cue/occurrence"));
        }
    }
    if let Some(s) = scene {
        parameters(s, &[&p.parameters])?;
        for c in &p.cue_overrides {
            parameters(s, &[&c.parameters])?;
        }
    }
    Ok(())
}
fn name(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}
fn length(v: &Length, path: &str, scene: &Scene) -> Result<()> {
    if let Some(id) = &v.parameter {
        if !scene
            .parameters
            .iter()
            .any(|p| p.id == *id && matches!(p.value_type, ValueType::Scalar | ValueType::Integer))
        {
            return Err(invalid(path, "layout parameter must be a declared scalar"));
        }
    }
    if !v.value.is_finite() || !v.offset.is_finite() {
        return Err(invalid(path, "finite length required"));
    }
    Ok(())
}
fn validate_word_line_pattern(layout: &Layout) -> Result<()> {
    let pagination = &layout.pagination;
    let Some(pattern) = &pagination.word_line_pattern else {
        if pagination.last_page_rule.is_some() {
            return Err(invalid("pagination.lastPageRule", "wordLinePattern required"));
        }
        return Ok(());
    };
    let valid_rows =
        |rows: &[usize]| !rows.is_empty() && rows.len() <= layout.max_lines && rows.iter().all(|n| (1..=MAX_UNITS).contains(n));
    if pagination.max_units_per_page.is_some() || pattern.is_empty() || pattern.len() > 256 || !pattern.iter().all(|rows| valid_rows(rows))
    {
        return Err(invalid(
            "pagination.wordLinePattern",
            "bounded nonempty word rows required; maxUnitsPerPage is exclusive",
        ));
    }
    if let Some(rule) = &pagination.last_page_rule {
        let largest_page: usize = pattern.iter().map(|rows| rows.iter().sum()).max().unwrap();
        if !(1..=MAX_UNITS).contains(&rule.if_row_count_is)
            || !valid_rows(&rule.previous_page_lines)
            || rule.previous_page_lines.iter().sum::<usize>() < largest_page
        {
            return Err(invalid(
                "pagination.lastPageRule",
                "replacement rows must preserve or increase every pattern page capacity",
            ));
        }
    }
    Ok(())
}
fn validate_scalar_cluster_rules(rules: &ScalarClusterRules) -> Result<()> {
    let path = "pagination.textLinePattern.clusterRules";
    let mut total = 0usize;
    let mut ranges = |ranges: &[[u32; 2]]| -> Result<()> {
        if ranges.len() > 32 {
            return Err(invalid(path, "at most 32 intervals per range list"));
        }
        total += ranges.len();
        for &[low, high] in ranges {
            if low > high || high > 0x10ffff || (low <= 0xdfff && high >= 0xd800) {
                return Err(invalid(path, "inclusive ranges must contain only valid Unicode scalar values"));
            }
        }
        Ok(())
    };
    if rules.attachments.len() > 32 || rules.joiners.len() > 32 {
        return Err(invalid(path, "at most 32 attachments and 32 joiners"));
    }
    for rule in &rules.attachments {
        if rule.next.is_empty() {
            return Err(invalid(path, "attachment next ranges must not be empty"));
        }
        ranges(&rule.next)?;
        if let Some(previous) = &rule.previous {
            ranges(previous)?;
        }
        if let Some(head) = &rule.head_excluded {
            ranges(head)?;
        }
    }
    ranges(&rules.consume_following_after)?;
    if total > 256 {
        return Err(invalid(path, "at most 256 total range intervals"));
    }
    if rules.joiners.iter().any(|scalar| char::from_u32(*scalar).is_none()) {
        return Err(invalid(path, "joiners must be valid Unicode scalar values"));
    }
    Ok(())
}
fn validate_text_line_pattern(scene: &Scene) -> Result<()> {
    let pagination = &scene.layout.pagination;
    let Some(pattern) = &pagination.text_line_pattern else {
        return Ok(());
    };
    if !scene.required_capabilities.iter().any(|cap| cap == "caption-text-line-layout/1") {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            "pagination.textLinePattern",
            "caption-text-line-layout/1 must be declared",
        ));
    }
    if pattern.unit == TextCountUnit::ScalarCluster {
        if !scene
            .required_capabilities
            .iter()
            .any(|cap| cap == "caption-scalar-cluster-layout/1")
        {
            return Err(Diagnostic::new(
                "CAPTION_CAPABILITY_UNAVAILABLE",
                "pagination.textLinePattern",
                "caption-scalar-cluster-layout/1 must be declared",
            ));
        }
        let rules = pattern
            .cluster_rules
            .as_ref()
            .ok_or_else(|| invalid("pagination.textLinePattern", "scalar-cluster requires explicit clusterRules"))?;
        validate_scalar_cluster_rules(rules)?;
    } else if pattern.cluster_rules.is_some() {
        return Err(invalid("pagination.textLinePattern", "clusterRules only applies to scalar-cluster"));
    }
    if pagination.word_line_pattern.is_some() || pagination.max_units_per_page.is_some() || pagination.last_page_rule.is_some() {
        return Err(invalid(
            "pagination.textLinePattern",
            "text line counting is exclusive with wordLinePattern, maxUnitsPerPage and lastPageRule",
        ));
    }
    if pattern.lines.is_empty()
        || pattern.lines.len() > 256
        || pattern
            .lines
            .iter()
            .any(|rows| rows.is_empty() || rows.len() > scene.layout.max_lines || rows.iter().any(|count| !(1..=65_536).contains(count)))
    {
        return Err(invalid(
            "pagination.textLinePattern",
            "1..256 page plans, 1..maxLines rows and text limits 1..65536 required",
        ));
    }
    Ok(())
}
pub fn validate_scene(s: &Scene) -> Result<()> {
    if s.schema != SCENE_SCHEMA || s.evaluation_version != 1 {
        return Err(Diagnostic::new(
            "CAPTION_SCENE_SCHEMA_UNSUPPORTED",
            "scene",
            format!("{} evaluation {}", s.schema, s.evaluation_version),
        ));
    }
    for c in &s.required_capabilities {
        if !CAPABILITIES.contains(&c.as_str()) {
            return Err(Diagnostic::new("CAPTION_CAPABILITY_UNAVAILABLE", "requiredCapabilities", c));
        }
    }
    if s.resources.len() > 64 {
        return Err(invalid("resources", "resource budget exceeded"));
    }
    let mut resources = BTreeSet::new();
    for r in &s.resources {
        let hash = r.content_hash.strip_prefix("sha256:").unwrap_or("");
        if !name(&r.id)
            || !resources.insert(&r.id)
            || r.asset_ref.id.is_empty()
            || r.asset_ref.revision.is_empty()
            || hash.len() != 64
            || !hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(invalid("resources", "invalid resource id, revision or digest"));
        }
    }
    if s.sequences.len() > 64 {
        return Err(invalid("sequences", "at most 64 sequences"));
    }
    let mut sequence_ids = BTreeSet::new();
    for sequence in &s.sequences {
        if !name(&sequence.id)
            || !sequence_ids.insert(&sequence.id)
            || sequence.frames.is_empty()
            || sequence.frames.len() > 256
            || !s.required_capabilities.iter().any(|c| c == "caption-image-sequence/1")
        {
            return Err(invalid("sequences", "unique id, 1..256 frames and capability required"));
        }
        let mut frame_ids = BTreeSet::new();
        for r in &sequence.frames {
            let hash = r.content_hash.strip_prefix("sha256:").unwrap_or("");
            if !name(&r.id)
                || !frame_ids.insert(&r.id)
                || r.asset_ref.id.is_empty()
                || r.asset_ref.revision.is_empty()
                || hash.len() != 64
                || !hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(invalid("sequences", "invalid frame resource"));
            }
        }
    }
    if s.layout.pagination.unit != UnitKind::Word {
        return Err(invalid("pagination.unit", "word required"));
    }
    length(&s.layout.width, "layout.width", s)?;
    length(&s.layout.x, "layout.x", s)?;
    length(&s.layout.y, "layout.y", s)?;
    if s.layout.max_lines == 0 || s.layout.max_lines > 32 || s.layout.pagination.max_units_per_page.is_some_and(|n| n == 0 || n > MAX_UNITS)
    {
        return Err(invalid("layout", "invalid page/line limit"));
    }
    validate_text_line_pattern(s)?;
    validate_word_line_pattern(&s.layout)?;
    validate_page_window(s)?;
    if s.parameters.len() > 128 || s.functions.len() > 128 || s.selectors.len() > MAX_NODES || s.animations.len() > 1024 {
        return Err(invalid("scene", "declaration budget exceeded"));
    }
    let mut ids = BTreeSet::new();
    for p in &s.parameters {
        if !name(&p.id) || !ids.insert(&p.id) {
            return Err(invalid("parameters", "invalid or duplicate id"));
        }
        let v = typed_value(p.value_type, &p.default)?;
        if p.min.is_some_and(|n| !n.is_finite())
            || p.max.is_some_and(|n| !n.is_finite())
            || matches!((p.min,p.max),(Some(a),Some(b)) if a>b)
        {
            return Err(invalid(&p.id, "invalid range"));
        }
        if let Evaluated::Number(_, n) = v {
            if p.min.is_some_and(|v| n < v) || p.max.is_some_and(|v| n > v) {
                return Err(invalid(&p.id, "default out of range"));
            }
        }
    }
    let mut functions = BTreeSet::new();
    for f in &s.functions {
        if !name(&f.id)
            || !functions.insert(&f.id)
            || [
                "add",
                "sub",
                "mul",
                "div",
                "sin",
                "cos",
                "mix",
                "clamp",
                "random",
                "noise",
                "phase",
                "eq",
                "lt",
                "gt",
                "and",
                "or",
                "not",
                "abs",
                "min",
                "max",
                "floor",
                "ceil",
                "smoothstep",
                "sqrt",
                "cubic-bezier",
                "shuffle-index",
            ]
            .contains(&f.id.as_str())
        {
            return Err(invalid(&f.id, "invalid or reserved function name"));
        }
        let args: BTreeMap<_, _> = f.arguments.iter().map(|a| (a.name.clone(), a.value_type)).collect();
        if args.len() != f.arguments.len() || args.keys().any(|n| !name(n)) {
            return Err(invalid(&f.id, "duplicate or invalid argument"));
        }
        if infer(&f.body, s, &args)? != f.returns {
            return Err(invalid(&f.id, "return type mismatch"));
        }
    }
    fn walk<'a>(nodes: &'a [Node], out: &mut BTreeMap<&'a str, &'a Node>, depth: usize, parent: Option<NodeKind>) -> Result<()> {
        if depth > 16 {
            return Err(invalid("nodes", "tree depth exceeded"));
        }
        for n in nodes {
            if !name(&n.id) || out.insert(&n.id, n).is_some() {
                return Err(invalid("nodes", "invalid or duplicate id"));
            }
            if out.len() > MAX_NODES {
                return Err(invalid("nodes", "node budget exceeded"));
            }
            if matches!(n.kind, NodeKind::Text | NodeKind::Label | NodeKind::Shape | NodeKind::Image) && !n.children.is_empty() {
                return Err(invalid(&n.id, "leaf node has children"));
            }
            if n.kind == NodeKind::Label && parent != Some(NodeKind::Repeat) {
                return Err(invalid(&n.id, "label must be a direct repeat child"));
            }
            walk(&n.children, out, depth + 1, Some(n.kind))?;
        }
        Ok(())
    }
    let mut nodes = BTreeMap::new();
    walk(&s.nodes, &mut nodes, 0, None)?;
    if !nodes.values().any(|n| n.kind == NodeKind::Text) {
        return Err(invalid("nodes", "text node required"));
    }
    if s.layout.bindings.len() > 64 || (s.layout.layout_evaluation == LayoutEvaluation::Static && !s.layout.bindings.is_empty()) {
        return Err(invalid("layout.bindings", "per-sample mode and at most 64 bindings required"));
    }
    let mut seen_bindings = BTreeSet::new();
    for b in &s.layout.bindings {
        if !seen_bindings.insert((&b.node_id, &b.property)) {
            return Err(invalid("layout.bindings", "duplicate target/property"));
        }
        let ty = match (b.node_id.as_deref(), b.property.as_str()) {
            (None, "width" | "x" | "y") => ValueType::Length,
            (Some(id), "fontSize") if nodes.get(id).is_some_and(|n| n.kind == NodeKind::Text) => ValueType::Length,
            (Some(id), "letterSpacing" | "lineHeight") if nodes.get(id).is_some_and(|n| n.kind == NodeKind::Text) => ValueType::Scalar,
            _ => return Err(invalid("layout.bindings", "unsupported layout target/property")),
        };
        validate_early_value(&b.value, ty, s)?;
    }
    if s.materials.len() > 8 {
        return Err(invalid("materials", "at most 8 materials"));
    }
    if s.render_layers.len() > 8
        || (!s.render_layers.is_empty()
            && (!s.materials.is_empty() || !s.required_capabilities.iter().any(|c| c == "caption-render-layers/1")))
    {
        return Err(invalid(
            "renderLayers",
            "at most 8 independent layers, capability required; global materials must be empty",
        ));
    }
    let mut layer_ids = BTreeSet::new();
    for layer in &s.render_layers {
        if !name(&layer.id) || !layer_ids.insert(&layer.id) || layer.materials.len() > 8 {
            return Err(invalid("renderLayers", "unique id and at most 8 materials per layer required"));
        }
        match &layer.source {
            CaptionLayerSource::Nodes { node_ids } => {
                let mut selected = BTreeSet::new();
                if node_ids.is_empty()
                    || node_ids.len() > MAX_NODES
                    || node_ids
                        .iter()
                        .any(|id| !selected.insert(id) || !s.nodes.iter().any(|n| &n.id == id))
                {
                    return Err(invalid(&layer.id, "source must select unique scene root nodes"));
                }
            }
            CaptionLayerSource::ImageSequence {
                context_node_id,
                sequence_id,
                frame,
                domain,
                uv_scale,
                uv_offset,
            } => {
                let context_nodes = nodes
                    .get(context_node_id.as_str())
                    .map(|n| BTreeMap::from([(context_node_id.as_str(), *n)]))
                    .unwrap_or_default();
                validate_component_context(s, &context_nodes, &layer.id, context_node_id, "caption-image-sequence/1", 1.0)?;
                if !sequence_ids.contains(sequence_id) {
                    return Err(invalid(&layer.id, "unknown sequence"));
                }
                let count = s.sequences.iter().find(|q| &q.id == sequence_id).unwrap().frames.len();
                validate_component_uniform(s, frame, 0.0, (count - 1) as f64)?;
                validate_material_domain(s, domain)?;
                if uv_scale.iter().any(|n| !n.is_finite() || !(0.001..=1024.0).contains(n))
                    || uv_offset.iter().any(|n| !n.is_finite() || !(-1024.0..=1024.0).contains(n))
                {
                    return Err(invalid(&layer.id, "invalid sequence UV transform"));
                }
            }
        }
    }
    let mut names = BTreeSet::new();
    let mut samples = 1u32;
    for (source, material) in s.materials.iter().map(|m| (None, m)).chain(
        s.render_layers
            .iter()
            .flat_map(|l| l.materials.iter().map(move |m| (Some(&l.source), m))),
    ) {
        let mut scoped_nodes = BTreeMap::new();
        match source {
            Some(CaptionLayerSource::Nodes { node_ids }) => {
                for node in s.nodes.iter().filter(|n| node_ids.contains(&n.id)) {
                    walk(std::slice::from_ref(node), &mut scoped_nodes, 0, None)?;
                }
            }
            Some(CaptionLayerSource::ImageSequence { context_node_id, .. }) => {
                if let Some(node) = nodes.get(context_node_id.as_str()) {
                    scoped_nodes.insert(context_node_id.as_str(), *node);
                }
            }
            None => {}
        }
        let nodes = if source.is_some() { &scoped_nodes } else { &nodes };

        let id = match material {
            CaptionMaterial::NoisySweep {
                id,
                context_node_id,
                domain,
                position,
                mask_scale,
                ..
            } => {
                validate_component_context(s, &nodes, id, context_node_id, "caption-noisy-sweep/1", 1.0)?;
                validate_component_uniform(s, position, -1024.0, 1024.0)?;
                validate_material_domain(s, domain)?;
                if mask_scale.iter().any(|n| !n.is_finite() || !(0.001..=1024.0).contains(n)) {
                    return Err(invalid(id, "invalid noisy sweep mask scale"));
                }
                id
            }
            CaptionMaterial::Blur { id, radius, passes } => {
                if !(1..=3).contains(passes) {
                    return Err(invalid(id, "blur passes must be 1..3"));
                }
                validate_early_value(radius, ValueType::Length, s)?;
                if let DynamicValue::Constant { value } = radius {
                    let n = typed_value(ValueType::Length, value)?.number()?;
                    if !(0.0..=64.0).contains(&n) {
                        return Err(invalid(id, "blur radius must be 0..64 pixels"));
                    }
                }
                id
            }
            CaptionMaterial::WaveDisplace {
                id,
                amplitude,
                wavelength,
                phase,
                ..
            } => {
                for (value, ty, low, high, label) in [
                    (
                        amplitude,
                        ValueType::Length,
                        -256.0,
                        256.0,
                        "wave amplitude must be -256..256 pixels",
                    ),
                    (
                        wavelength,
                        ValueType::Length,
                        1.0,
                        1_000_000.0,
                        "wave wavelength must be 1..1000000 pixels",
                    ),
                    (
                        phase,
                        ValueType::Angle,
                        f64::NEG_INFINITY,
                        f64::INFINITY,
                        "wave phase must be finite",
                    ),
                ] {
                    validate_early_value(value, ty, s)?;
                    if let DynamicValue::Constant { value } = value {
                        let n = typed_value(ty, value)?.number()?;
                        if !n.is_finite() || !(low..=high).contains(&n) {
                            return Err(invalid(id, label));
                        }
                    }
                }
                id
            }
            CaptionMaterial::SoftBand {
                id,
                context_node_id,
                center,
                half_width,
                feather,
                amount,
                opacity,
                ..
            } => {
                if nodes.get(context_node_id.as_str()).is_none_or(|n| n.kind != NodeKind::Text)
                    || nodes.values().any(|n| !matches!(n.kind, NodeKind::Group | NodeKind::Text))
                    || nodes.values().filter(|n| n.kind == NodeKind::Text).count() != 1
                {
                    return Err(invalid(
                        id,
                        "soft-band requires its explicit context text as the only visual node, optionally inside groups",
                    ));
                }
                for (value, low, high, label) in [
                    (center, -4.0, 4.0, "soft-band center must be -4..4"),
                    (half_width, 0.0, 4.0, "soft-band halfWidth must be 0..4"),
                    (feather, 0.0, 4.0, "soft-band feather must be 0..4"),
                    (amount, 0.0, 1.0, "soft-band amount must be 0..1"),
                    (opacity, 0.0, 1.0, "soft-band opacity must be 0..1"),
                ] {
                    validate_value("opacity", value, s, UnitKind::Page)?;
                    if let DynamicValue::Constant { value } = value {
                        let n = typed_value(ValueType::Scalar, value)?.number()?;
                        if !(low..=high).contains(&n) {
                            return Err(invalid(id, label));
                        }
                    }
                }
                id
            }
            CaptionMaterial::NoisePaletteMix {
                id,
                context_node_id,
                palette_resource_id,
                palette_position,
                phase,
                domain,
            } => {
                validate_component_context(s, &nodes, id, context_node_id, "caption-noise-palette-mix/1", 1.0)?;
                if !s.required_capabilities.iter().any(|c| c == "caption-image-png/1") {
                    return Err(Diagnostic::new("CAPTION_CAPABILITY_REQUIRED", id, "caption-image-png/1"));
                }
                if !s.resources.iter().any(|r| &r.id == palette_resource_id) {
                    return Err(invalid(id, "palette resource must reference a frozen PNG"));
                }
                validate_component_uniform(s, palette_position, 0.0, 1.0)?;
                validate_component_uniform(s, phase, -1_000_000.0, 1_000_000.0)?;
                for (value, low) in [
                    (&domain.x, -1_000_000.0),
                    (&domain.y, -1_000_000.0),
                    (&domain.width, 0.001),
                    (&domain.height, 0.001),
                ] {
                    validate_value("width", value, s, UnitKind::Page)?;
                    if let DynamicValue::Constant { value } = value {
                        let n = typed_value(ValueType::Length, value)?.number()?;
                        if !n.is_finite() || !(low..=1_000_000.0).contains(&n) {
                            return Err(invalid(id, "material domain requires finite lengths and positive dimensions"));
                        }
                    }
                }
                id
            }
            CaptionMaterial::GradientSmear {
                id,
                context_node_id,
                domain,
                rect_scale,
                evolution,
                seed,
                stretch,
                progress,
                strength,
                noise,
                ..
            } => {
                validate_component_context(s, &nodes, id, context_node_id, "caption-gradient-smear/1", 1.0)?;
                for value in rect_scale {
                    validate_component_uniform(s, value, 0.001, 10_000.0)?;
                }
                for value in [evolution, seed] {
                    validate_component_uniform(s, value, -100_000.0, 100_000.0)?;
                }
                validate_component_uniform(s, stretch, -2.0, 2.0)?;
                validate_component_uniform(s, progress, 0.0, 1.0)?;
                for value in strength {
                    validate_component_uniform(s, value, -16.0, 16.0)?;
                }
                for (value, low, high) in [
                    (noise.complexity, 1.0, 10.0),
                    (noise.cycle, 0.0, 10_000.0),
                    (noise.brightness, -4.0, 4.0),
                    (noise.range, 0.0, 16.0),
                    (noise.rotation, -10_000.0, 10_000.0),
                    (noise.sub_rotation, -10_000.0, 10_000.0),
                    (noise.sub_impact, 0.0, 1.0),
                    (noise.sub_scale, 1.0, 10_000.0),
                ]
                .into_iter()
                .chain(noise.scale1.into_iter().chain(noise.scale2).map(|n| (n, 0.001, 10_000.0)))
                .chain(noise.offset.into_iter().chain(noise.sub_offset).map(|n| (n, -10_000.0, 10_000.0)))
                {
                    if !value.is_finite() || !(low..=high).contains(&value) {
                        return Err(invalid(id, "gradient smear noise outside finite bounds"));
                    }
                }
                for (value, low) in [
                    (&domain.x, -1_000_000.0),
                    (&domain.y, -1_000_000.0),
                    (&domain.width, 0.001),
                    (&domain.height, 0.001),
                ] {
                    validate_value("width", value, s, UnitKind::Page)?;
                    if let DynamicValue::Constant { value } = value {
                        let n = typed_value(ValueType::Length, value)?.number()?;
                        if !n.is_finite() || !(low..=1_000_000.0).contains(&n) {
                            return Err(invalid(id, "gradient smear domain outside finite bounds"));
                        }
                    }
                }
                id
            }
            CaptionMaterial::AngularSampleBlend {
                id,
                context_node_id,
                domain,
                aspect,
                angle,
            } => {
                validate_component_context(s, &nodes, id, context_node_id, "caption-angular-sample-blend/1", 1.0)?;
                validate_component_uniform(s, aspect, 0.0001, 10_000.0)?;
                validate_value("transform.rotation", angle, s, UnitKind::Page)?;
                if let DynamicValue::Constant { value } = angle {
                    let n = typed_value(ValueType::Angle, value)?.number()?;
                    if !n.is_finite() || !(-10_000.0..=10_000.0).contains(&n) {
                        return Err(invalid(id, "angular sample angle must be finite in -10000..10000 radians"));
                    }
                }
                for (value, low) in [
                    (&domain.x, -1_000_000.0),
                    (&domain.y, -1_000_000.0),
                    (&domain.width, 0.001),
                    (&domain.height, 0.001),
                ] {
                    validate_value("width", value, s, UnitKind::Page)?;
                    if let DynamicValue::Constant { value } = value {
                        let n = typed_value(ValueType::Length, value)?.number()?;
                        if !n.is_finite() || !(low..=1_000_000.0).contains(&n) {
                            return Err(invalid(id, "angular sample domain requires finite lengths and positive dimensions"));
                        }
                    }
                }
                id
            }
            CaptionMaterial::GaussianAxis {
                id,
                context_node_id,
                samples,
                step_uv,
                sigma_uv,
                gamma,
                ..
            } => {
                validate_component_context(s, &nodes, id, context_node_id, "caption-gaussian-axis/1", *gamma)?;
                validate_gaussian_uniforms(s, samples, step_uv, sigma_uv)?;
                id
            }
            CaptionMaterial::GlowCascade {
                id,
                context_node_id,
                levels,
                gamma,
                intensity,
                original_opacity,
                glow_tint,
                glow_color_matrix,
                ..
            } => {
                validate_component_context(s, &nodes, id, context_node_id, "caption-glow-cascade/1", *gamma)?;
                if levels.is_empty() || levels.len() > 7 {
                    return Err(invalid(id, "glow requires 1..7 finite levels"));
                }
                validate_component_uniform(s, intensity, 0.0, 16.0)?;
                validate_component_uniform(s, original_opacity, 0.0, 1.0)?;
                if let Some(tint) = glow_tint {
                    if !s.required_capabilities.iter().any(|c| c == "caption-glow-tint/1") {
                        return Err(Diagnostic::new("CAPTION_CAPABILITY_REQUIRED", id, "caption-glow-tint/1"));
                    }
                    validate_value("fill", tint, s, UnitKind::Page)?;
                }
                if let Some(matrix) = glow_color_matrix {
                    if !s.required_capabilities.iter().any(|c| c == "caption-glow-color-matrix/1") {
                        return Err(Diagnostic::new("CAPTION_CAPABILITY_REQUIRED", id, "caption-glow-color-matrix/1"));
                    }
                    if matrix.iter().any(|c| !c.is_finite()) {
                        return Err(invalid(id, "glow color matrix needs nine finite coefficients"));
                    }
                }
                for level in levels {
                    for stage in [&level.horizontal, &level.vertical] {
                        if stage.scale.num == 0 || stage.scale.num > stage.scale.den || stage.scale.den > 4096 {
                            return Err(invalid(id, "surface scale requires 1 <= num <= den <= 4096"));
                        }
                        validate_gaussian_uniforms(s, &stage.samples, &stage.step_uv, &stage.sigma_uv)?;
                    }
                }
                id
            }
            CaptionMaterial::Feedback {
                id,
                samples: n,
                step,
                decay,
                offset,
            } => {
                if *n == 0
                    || *n > 16
                    || step.timescale == 0
                    || step.ticks <= 0
                    || step.ticks.unsigned_abs() > 9_007_199_254_740_991
                    || step.seconds() * f64::from(*n) > 2.0
                    || !decay.is_finite()
                    || !(0.0..=1.0).contains(decay)
                    || offset.iter().any(|x| !x.is_finite() || x.abs() > 256.0)
                {
                    return Err(invalid(
                        id,
                        "feedback needs 1..16 past samples, positive step, window <= 2 seconds, decay 0..1, offset <= 256px",
                    ));
                }
                samples = samples.checked_mul(n + 1).ok_or_else(|| invalid(id, "feedback sample budget"))?;
                if samples > 32 {
                    return Err(invalid(id, "combined feedback sample budget exceeds 32"));
                }
                id
            }
        };
        if !name(id) || !names.insert(id) {
            return Err(invalid("materials", "invalid or duplicate id"));
        }
    }
    let mut sels = BTreeSet::new();
    for sel in &s.selectors {
        if sel.include_whitespace && sel.unit != UnitKind::Grapheme {
            return Err(invalid(&sel.id, "includeWhitespace requires grapheme units"));
        }
        if !name(&sel.id) || !sels.insert(&sel.id) || nodes.get(sel.node_id.as_str()).is_none_or(|n| n.kind != NodeKind::Text) {
            return Err(invalid(&sel.id, "invalid selector target or id"));
        }
        fn filter(f: &Filter, d: usize) -> Result<()> {
            if d > 16 {
                return Err(invalid("filter", "depth exceeded"));
            }
            match f {
                Filter::Range { start, end } if start > end => Err(invalid("filter", "reversed range")),
                Filter::And { filters } | Filter::Or { filters } => {
                    if filters.len() > 128 {
                        return Err(invalid("filter", "budget exceeded"));
                    }
                    for f in filters {
                        filter(f, d + 1)?;
                    }
                    Ok(())
                }
                Filter::Not { filter: f } => filter(f, d + 1),
                _ => Ok(()),
            }
        }
        filter(&sel.filter, 0)?;
    }
    if !s.layout.font_size_bindings.is_empty() {
        if !s.required_capabilities.iter().any(|cap| cap == "caption-unit-font-size/1") {
            return Err(Diagnostic::new(
                "CAPTION_CAPABILITY_REQUIRED",
                "layout.fontSizeBindings",
                "caption-unit-font-size/1",
            ));
        }
        if s.layout.font_size_bindings.len() > 64
            || s.layout.layout_evaluation != LayoutEvaluation::PerSample
            || !s.layout.pagination.has_fixed_lines()
        {
            return Err(invalid(
                "layout.fontSizeBindings",
                "at most 64 bindings require per-sample and fixed word/text line membership",
            ));
        }
        let mut ids = BTreeSet::new();
        for binding in &s.layout.font_size_bindings {
            if !name(&binding.id)
                || !ids.insert(&binding.id)
                || nodes.get(binding.node_id.as_str()).is_none_or(|node| node.kind != NodeKind::Text)
            {
                return Err(invalid(&binding.id, "invalid font size binding id or text node"));
            }
            let selector = s
                .selectors
                .iter()
                .find(|selector| selector.id == binding.selector_id)
                .ok_or_else(|| invalid(&binding.id, "font size selector missing"))?;
            if selector.node_id != binding.node_id || !matches!(selector.unit, UnitKind::Page | UnitKind::Line | UnitKind::Word) {
                return Err(invalid(
                    &binding.id,
                    "font size selector must address this text node's page, line or word units",
                ));
            }
            validate_value("width", &binding.value, s, selector.unit)?;
            validate_font_size_dependencies(&binding.value, s)?;
            let valid_size = |value: &Value| value.as_f64().is_some_and(|n| n.is_finite() && (1.0..=4096.0).contains(&n));
            match &binding.value {
                DynamicValue::Constant { value } if !valid_size(value) => {
                    return Err(invalid(&binding.id, "font size must be 1..4096 pixels"));
                }
                DynamicValue::Keyframes { keys, .. } if keys.iter().any(|key| !valid_size(&key.value)) => {
                    return Err(invalid(&binding.id, "font size keys must be 1..4096 pixels"));
                }
                _ => {}
            }
        }
    }
    if !s.layout.font_style_bindings.is_empty() {
        if !s.required_capabilities.iter().any(|cap| cap == "caption-unit-font-style/1") {
            return Err(Diagnostic::new(
                "CAPTION_CAPABILITY_REQUIRED",
                "layout.fontStyleBindings",
                "caption-unit-font-style/1",
            ));
        }
        if s.layout.font_style_bindings.len() > 64
            || s.layout.layout_evaluation != LayoutEvaluation::PerSample
            || !s.layout.pagination.has_fixed_lines()
        {
            return Err(invalid(
                "layout.fontStyleBindings",
                "at most 64 bindings require per-sample and fixed word/text line membership",
            ));
        }
        let mut ids = BTreeSet::new();
        for binding in &s.layout.font_style_bindings {
            if !name(&binding.id)
                || !ids.insert(&binding.id)
                || nodes.get(binding.node_id.as_str()).is_none_or(|node| node.kind != NodeKind::Text)
            {
                return Err(invalid(&binding.id, "invalid font style binding id or text node"));
            }
            let selector = s
                .selectors
                .iter()
                .find(|selector| selector.id == binding.selector_id)
                .ok_or_else(|| invalid(&binding.id, "font style selector missing"))?;
            if selector.node_id != binding.node_id || !matches!(selector.unit, UnitKind::Page | UnitKind::Line | UnitKind::Word) {
                return Err(invalid(
                    &binding.id,
                    "font style selector must address this text node's page, line or word units",
                ));
            }
            let patch = &binding.style;
            if patch.font_family.is_none() && patch.font_weight.is_none() && patch.italic.is_none() {
                return Err(invalid(&binding.id, "font style patch must specify at least one field"));
            }
            if patch
                .font_family
                .as_ref()
                .is_some_and(|family| family.trim().is_empty() || family.len() > 256 || family.chars().any(char::is_control))
                || patch.font_weight.is_some_and(|weight| !(1..=1000).contains(&weight))
            {
                return Err(invalid(&binding.id, "invalid static font family or weight"));
            }
        }
    }
    fn bindings(nodes: &[Node], unit: UnitKind, scene: &Scene, out: &mut BTreeMap<String, UnitKind>) {
        for n in nodes {
            out.insert(n.id.clone(), unit);
            let child_unit = if n.kind == NodeKind::Repeat {
                scene
                    .selectors
                    .iter()
                    .find(|s| Some(&s.id) == n.selector_id.as_ref())
                    .map_or(unit, |s| s.unit)
            } else {
                unit
            };
            bindings(&n.children, child_unit, scene, out);
        }
    }
    let mut bound_units = BTreeMap::new();
    bindings(&s.nodes, UnitKind::Cue, s, &mut bound_units);
    for n in nodes.values() {
        if n.kind == NodeKind::Image {
            if !n.resource_id.as_ref().is_some_and(|id| resources.contains(id)) {
                return Err(invalid(&n.id, "image requires a declared resourceId"));
            }
        } else if n.resource_id.is_some() || n.fit != ImageFit::Contain {
            return Err(invalid(&n.id, "image fields on non-image node"));
        }
        if n.style.paints.len() > 16 {
            return Err(invalid(&n.id, "paint budget exceeded"));
        }
        if !n.style.paints.is_empty()
            && (n.style.stroke.is_some()
                || !n.state_styles.is_empty()
                || n.properties.contains_key("fill")
                || s.animations.iter().any(|a| a.target.node_id == n.id && a.property == "fill"))
        {
            return Err(invalid(
                &n.id,
                "paint stack cannot be combined with fill overrides or legacy stroke",
            ));
        }
        let mut paints = BTreeSet::new();
        for layer in &n.style.paints {
            if !name(&layer.id)
                || !paints.insert(&layer.id)
                || !layer.stroke_width.is_finite()
                || !(0.0..=256.0).contains(&layer.stroke_width)
                || layer.offset.iter().any(|x| !x.is_finite() || x.abs() > 4096.0)
            {
                return Err(invalid(&n.id, "invalid paint layer"));
            }
            match &layer.paint {
                ScenePaint::Solid { color: c } => {
                    color(c)?;
                }
                ScenePaint::Linear { from, to, stops } => {
                    if from == to
                        || from.iter().chain(to).any(|n| !n.is_finite() || n.abs() > 16.0)
                        || stops.len() < 2
                        || stops.len() > 32
                        || stops.iter().any(|s| !s.at.is_finite() || !(0.0..=1.0).contains(&s.at))
                        || stops.windows(2).any(|s| s[0].at >= s[1].at)
                    {
                        return Err(invalid(&n.id, "invalid gradient"));
                    }
                    for stop in stops {
                        color(&stop.color)?;
                    }
                }
            }
        }

        if !matches!(n.kind, NodeKind::Text | NodeKind::Label)
            && (n.text.is_some() || !n.state_styles.is_empty() || n.style != TextStyle::default())
        {
            return Err(invalid(&n.id, "text/style fields require a text node"));
        }
        if n.kind == NodeKind::Label {
            if !s.required_capabilities.iter().any(|c| c == "caption-bound-label/1") {
                return Err(Diagnostic::new("CAPTION_CAPABILITY_REQUIRED", &n.id, "caption-bound-label/1"));
            }
            let Some(TextBinding::Static { text }) = &n.text else {
                return Err(invalid(&n.id, "label requires static text"));
            };
            if text.len() > 4096
                || text
                    .chars()
                    .any(|c| matches!(c, '\n' | '\r' | '\u{000b}' | '\u{000c}' | '\u{0085}' | '\u{2028}' | '\u{2029}'))
                || !n.state_styles.is_empty()
            {
                return Err(invalid(&n.id, "label requires one line, at most 4096 bytes, and no state styles"));
            }
        } else if n.properties.contains_key("fontSize") {
            return Err(invalid(&n.id, "fontSize pose belongs to labels"));
        }
        if n.kind == NodeKind::Image && (n.properties.contains_key("fill") || n.properties.contains_key("radius")) {
            return Err(invalid(&n.id, "image does not accept fill/radius"));
        }
        if n.kind == NodeKind::Group && n.properties.contains_key("fill") {
            return Err(invalid(&n.id, "fill is not a group property"));
        }
        if n.kind == NodeKind::Repeat && !n.properties.is_empty() {
            return Err(invalid(&n.id, "repeat properties belong on its children"));
        }
        if matches!(n.kind, NodeKind::Group | NodeKind::Text | NodeKind::Label)
            && n.properties.keys().any(|p| matches!(p.as_str(), "width" | "height" | "radius"))
        {
            return Err(invalid(&n.id, "shape geometry property on non-shape node"));
        }
        color(&n.style.fill)?;
        length(&n.style.font_size, &n.id, s)?;
        if n.style.font_weight == 0
            || n.style.font_weight > 1000
            || !(0.1..=10.0).contains(&n.style.line_height)
            || !n.style.letter_spacing.is_finite()
        {
            return Err(invalid(&n.id, "invalid text style"));
        }
        if let Some(stroke) = &n.style.stroke {
            color(&stroke.color)?;
            if !stroke.width.is_finite() || stroke.width < 0.0 {
                return Err(invalid(&n.id, "invalid stroke width"));
            }
        }
        if n.state_styles.unit != UnitKind::Word {
            return Err(invalid(&n.id, "state styles require word units"));
        }
        for state in [WordState::Active, WordState::Read, WordState::Unread] {
            if let Some(c) = n.state_styles.get(&state) {
                color(c)?;
            }
        }
        if n.kind == NodeKind::Repeat {
            if !n.selector_id.as_ref().is_some_and(|id| sels.contains(id)) {
                return Err(invalid(&n.id, "repeat requires a selector"));
            }
            if n.children
                .iter()
                .any(|n| !matches!(n.kind, NodeKind::Shape | NodeKind::Image | NodeKind::Label))
            {
                return Err(Diagnostic::new(
                    "CAPTION_CAPABILITY_UNAVAILABLE",
                    &n.id,
                    "repeat children must be shapes, images, or capability-gated labels",
                ));
            }
        } else if n.selector_id.is_some() {
            return Err(invalid(&n.id, "selectorId belongs to repeat nodes"));
        }
        for (p, v) in &n.properties {
            if p == "fontSize" {
                validate_label_size_literals(v)?;
            }
            validate_value_context(p, v, s, bound_units[n.id.as_str()], n.kind == NodeKind::Label && p != "fontSize")?;
        }
    }
    let mut animations = BTreeSet::new();
    for a in &s.animations {
        if !name(&a.id) || !animations.insert(&a.id) || !nodes.contains_key(a.target.node_id.as_str()) {
            return Err(invalid(&a.id, "invalid animation id or target"));
        }
        let unit = if let Some(id) = &a.target.selector_id {
            let sel = s
                .selectors
                .iter()
                .find(|sel| sel.id == *id && sel.node_id == a.target.node_id)
                .ok_or_else(|| invalid(&a.id, "selector belongs to another node"))?;
            sel.unit
        } else {
            bound_units[a.target.node_id.as_str()]
        };
        let node = nodes[a.target.node_id.as_str()];
        if node.kind == NodeKind::Repeat
            || (a.property == "fontSize" && node.kind != NodeKind::Label)
            || (!matches!(node.kind, NodeKind::Shape | NodeKind::Image) && matches!(a.property.as_str(), "width" | "height" | "radius"))
            || (node.kind == NodeKind::Group && a.property == "fill")
            || (node.kind == NodeKind::Image && matches!(a.property.as_str(), "fill" | "radius"))
        {
            return Err(invalid(&a.id, "property does not apply to this node"));
        }
        if a.property == "fontSize" && a.composite == Composite::Replace {
            validate_label_size_literals(&a.value)?;
        }
        let t = validate_value_context(
            &a.property,
            &a.value,
            s,
            unit,
            node.kind == NodeKind::Label && a.property != "fontSize",
        )?;
        if (t == ValueType::Color && a.composite != Composite::Replace) || (a.composite == Composite::Multiply && t != ValueType::Scalar) {
            return Err(invalid(&a.id, "invalid composite for property type"));
        }
    }
    Ok(())
}

fn validate_component_context(
    scene: &Scene,
    nodes: &BTreeMap<&str, &Node>,
    id: &str,
    node_id: &str,
    capability: &str,
    gamma: f64,
) -> Result<()> {
    if !scene.required_capabilities.iter().any(|c| c == capability) {
        return Err(Diagnostic::new("CAPTION_CAPABILITY_REQUIRED", id, capability));
    }
    if !gamma.is_finite() || !(0.1..=8.0).contains(&gamma) {
        return Err(invalid(id, "component gamma must be finite in 0.1..8"));
    }
    if nodes.get(node_id).is_none_or(|n| n.kind != NodeKind::Text)
        || nodes.values().filter(|n| n.kind == NodeKind::Text).count() != 1
        || nodes.values().any(|n| !matches!(n.kind, NodeKind::Text | NodeKind::Group))
    {
        return Err(invalid(
            id,
            "component filter requires its explicit context text as the sole visual node, optionally inside groups",
        ));
    }
    Ok(())
}
fn validate_component_uniform(scene: &Scene, value: &DynamicValue, low: f64, high: f64) -> Result<()> {
    validate_value("opacity", value, scene, UnitKind::Page)?;
    if let DynamicValue::Constant { value } = value {
        let n = typed_value(ValueType::Scalar, value)?.number()?;
        if !n.is_finite() || !(low..=high).contains(&n) {
            return Err(invalid("materials", "component uniform outside its finite range"));
        }
    }
    Ok(())
}
fn validate_gaussian_uniforms(scene: &Scene, samples: &DynamicValue, step: &DynamicValue, sigma: &DynamicValue) -> Result<()> {
    validate_component_uniform(scene, samples, 0.0, 1024.0)?;
    validate_component_uniform(scene, step, 0.0, 1.0)?;
    validate_component_uniform(scene, sigma, 0.0, 1024.0)?;
    if let (DynamicValue::Constant { value: count }, DynamicValue::Constant { value: width }) = (samples, sigma) {
        if count.as_f64().is_some_and(|n| n >= 1.0) && width.as_f64() == Some(0.0) {
            return Err(invalid("materials", "nonzero Gaussian side count requires positive sigma"));
        }
    }
    Ok(())
}
fn validate_value(property: &str, v: &DynamicValue, s: &Scene, unit: UnitKind) -> Result<ValueType> {
    validate_value_context(property, v, s, unit, false)
}
fn validate_value_context(property: &str, v: &DynamicValue, s: &Scene, unit: UnitKind, label_metrics: bool) -> Result<ValueType> {
    if !label_metrics {
        validate_label_dependencies(v, s)?;
    }
    let t = property_type(property).ok_or_else(|| Diagnostic::new("CAPTION_PROPERTY_UNSUPPORTED", property, "unknown property"))?;
    match v {
        DynamicValue::Constant { value } => {
            typed_value(t, value)?;
        }
        DynamicValue::Expression { expression } => {
            if infer(expression, s, &BTreeMap::new())? != t {
                return Err(Diagnostic::new("CAPTION_EXPRESSION_TYPE", property, "result type mismatch"));
            }
        }
        DynamicValue::Keyframes {
            clock,
            keys,
            interpolation,
            ..
        } => {
            if keys.len() < 2
                || keys.len() > 1024
                || keys.iter().any(|k| !k.at.is_finite() || !(0.0..=1.0).contains(&k.at))
                || keys.windows(2).any(|k| k[0].at >= k[1].at)
            {
                return Err(invalid(property, "invalid keyframes"));
            }
            if let Interpolation::CubicBezier { x1, y1, x2, y2 } = interpolation {
                if ![x1, y1, x2, y2].iter().all(|n| n.is_finite()) || !(0.0..=1.0).contains(x1) || !(0.0..=1.0).contains(x2) {
                    return Err(invalid(property, "invalid Bezier easing"));
                }
            }
            if clock.stagger.timescale == 0 || clock.stagger.ticks.unsigned_abs() > 9_007_199_254_740_991 {
                return Err(invalid(property, "invalid stagger"));
            }
            if clock.repeat.is_some_and(|r| r.iterations == 0 || r.iterations > 1024) {
                return Err(invalid(property, "invalid repeat count"));
            }
            if clock.offset.timescale == 0 || clock.offset.ticks.unsigned_abs() > 9_007_199_254_740_991 {
                return Err(invalid(property, "zero timescale"));
            }
            if matches!(clock.duration,Duration::Fixed{ticks,timescale} if ticks<0||ticks>9_007_199_254_740_991||timescale==0) {
                return Err(invalid(property, "invalid duration"));
            }
            if clock.unit > unit && clock.unit != UnitKind::Page {
                return Err(invalid(property, "clock is finer than selected unit"));
            }
            if matches!(t, ValueType::Integer | ValueType::Bool) && *interpolation != Interpolation::Step {
                return Err(invalid(property, "discrete type requires step"));
            }
            for k in keys {
                typed_value(t, &k.value)?;
            }
        }
    }
    Ok(t)
}

/// Layout/material inputs may only read the frozen cue context, never the layout they produce.
fn validate_early_value(value: &DynamicValue, ty: ValueType, scene: &Scene) -> Result<()> {
    validate_label_dependencies(value, scene)?;
    let property = match ty {
        ValueType::Length => "width",
        ValueType::Angle => "transform.rotation",
        _ => "opacity",
    };
    validate_value(property, value, scene, UnitKind::Cue)?;
    fn visit(e: &Expression, s: &Scene, budget: &mut usize, visited: &mut Option<BTreeSet<String>>) -> Result<()> {
        if *budget == 0 {
            return Err(invalid("expression", "dependency budget"));
        }
        *budget -= 1;
        match e {
            Expression::Read { path } => {
                if !(path.starts_with("params.")
                    || path.starts_with("args.")
                    || matches!(
                        path.as_str(),
                        "time.seconds"
                            | "time.elapsedSeconds"
                            | "time.durationSeconds"
                            | "time.cueDurationSeconds"
                            | "time.progress"
                            | "time.clampedProgress"
                    )
                    || matches!(path.as_str(), "unit.index" | "unit.count" | "canvas.width" | "canvas.height"))
                {
                    return Err(Diagnostic::new(
                        "CAPTION_DEPENDENCY_CYCLE",
                        path,
                        "layout-dependent input is unavailable before layout",
                    ));
                }
            }
            Expression::Call { function, args } => {
                for a in args {
                    visit(a, s, budget, visited)?;
                }
                if let Some(f) = s.functions.iter().find(|f| f.id == *function) {
                    if visited.as_mut().is_none_or(|seen| seen.insert(function.clone())) {
                        visit(&f.body, s, budget, visited)?;
                    }
                }
            }
            Expression::If {
                condition,
                then,
                otherwise,
            } => {
                visit(condition, s, budget, visited)?;
                visit(then, s, budget, visited)?;
                visit(otherwise, s, budget, visited)?;
            }
            _ => {}
        }
        Ok(())
    }
    let dag = scene
        .required_capabilities
        .iter()
        .any(|capability| capability == "caption-function-dag/1");
    let mut visited = dag.then(BTreeSet::new);
    match value {
        DynamicValue::Expression { expression } => visit(expression, scene, &mut if dag { 16_384 } else { 4096 }, &mut visited)?,
        DynamicValue::Keyframes { clock, .. } if clock.unit != UnitKind::Cue => {
            return Err(invalid("clock", "pre-layout values require cue clock"));
        }
        _ => {}
    }
    Ok(())
}

/// Unit font sizing sees frozen semantic membership and clocks, never resulting geometry.
fn validate_font_size_dependencies(value: &DynamicValue, scene: &Scene) -> Result<()> {
    fn visit(expr: &Expression, scene: &Scene, seen: &mut BTreeSet<String>, budget: &mut usize) -> Result<()> {
        if *budget == 0 {
            return Err(invalid("layout.fontSizeBindings", "dependency budget"));
        }
        *budget -= 1;
        match expr {
            Expression::Read { path } => {
                if !(path.starts_with("params.")
                    || path.starts_with("args.")
                    || path.starts_with("canvas.")
                    || path.starts_with("time.")
                    || path.starts_with("unit."))
                    || matches!(
                        path.as_str(),
                        "unit.lineEnvelopeAvailable" | "unit.rangeInkAvailable" | "unit.pageEnvelopeAvailable" | "unit.pageLineCount"
                    )
                {
                    return Err(Diagnostic::new(
                        "CAPTION_DEPENDENCY_CYCLE",
                        path,
                        "font sizing cannot depend on resulting layout or ink",
                    ));
                }
            }
            Expression::Call { function, args } => {
                for arg in args {
                    visit(arg, scene, seen, budget)?;
                }
                if let Some(function) = scene.functions.iter().find(|f| f.id == *function) {
                    if seen.insert(function.id.clone()) {
                        visit(&function.body, scene, seen, budget)?;
                    }
                }
            }
            Expression::If {
                condition,
                then,
                otherwise,
            } => {
                visit(condition, scene, seen, budget)?;
                visit(then, scene, seen, budget)?;
                visit(otherwise, scene, seen, budget)?;
            }
            _ => {}
        }
        Ok(())
    }
    if let DynamicValue::Expression { expression } = value {
        visit(expression, scene, &mut BTreeSet::new(), &mut 16_384)?;
    }
    Ok(())
}

fn validate_page_window(scene: &Scene) -> Result<()> {
    let Some(window) = &scene.layout.page_window else {
        return Ok(());
    };
    if !scene.required_capabilities.iter().any(|cap| cap == "caption-page-window/1") {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_REQUIRED",
            "layout.pageWindow",
            "caption-page-window/1",
        ));
    }
    if !scene.layout.pagination.has_fixed_lines()
        || scene.layout.leading_gap != LeadingGap::Hide
        || scene.speech_state.timing_policy != TimingPolicy::RequireWordTiming
    {
        return Err(invalid(
            "layout.pageWindow",
            "fixed word/text lines, leadingGap hide and input word timing required",
        ));
    }
    if window.gap_threshold.timescale == 0 || window.gap_threshold.ticks < 0 || window.gap_threshold.ticks > 9_007_199_254_740_991 {
        return Err(invalid("layout.pageWindow", "nonnegative safe gapThreshold time required"));
    }
    for ratios in [window.short_gap, window.long_gap] {
        if !ratios.before.is_finite()
            || !ratios.after.is_finite()
            || !(0.0..=1.0).contains(&ratios.before)
            || !(0.0..=1.0).contains(&ratios.after)
            || ratios.before + ratios.after > 1.0
        {
            return Err(invalid("layout.pageWindow", "before/after ratios must be 0..1 and sum at most 1"));
        }
    }
    Ok(())
}

/// Label-own geometry exists only after that label's size and shaping pass.
fn validate_label_dependencies(value: &DynamicValue, scene: &Scene) -> Result<()> {
    fn visit(expr: &Expression, scene: &Scene, seen: &mut BTreeSet<String>, left: &mut usize) -> Result<()> {
        if *left == 0 {
            return Err(invalid("label", "dependency budget"));
        }
        *left -= 1;
        match expr {
            Expression::Read { path }
                if matches!(
                    path.as_str(),
                    "layout.labelWidth"
                        | "layout.labelHeight"
                        | "layout.labelMaxGlyphInkWidth"
                        | "layout.labelMaxGlyphInkHeight"
                        | "unit.labelInkAvailable"
                ) =>
            {
                return Err(Diagnostic::new(
                    "CAPTION_DEPENDENCY_CYCLE",
                    path,
                    "label metrics require a post-size label pose",
                ));
            }
            Expression::Call { function, args } => {
                for arg in args {
                    visit(arg, scene, seen, left)?;
                }
                if let Some(f) = scene.functions.iter().find(|f| f.id == *function) {
                    if seen.insert(f.id.clone()) {
                        visit(&f.body, scene, seen, left)?;
                    }
                }
            }
            Expression::If {
                condition,
                then,
                otherwise,
            } => {
                visit(condition, scene, seen, left)?;
                visit(then, scene, seen, left)?;
                visit(otherwise, scene, seen, left)?;
            }
            _ => {}
        }
        Ok(())
    }
    if let DynamicValue::Expression { expression } = value {
        visit(expression, scene, &mut BTreeSet::new(), &mut 16_384)?;
    }
    Ok(())
}

fn validate_label_size_literals(value: &DynamicValue) -> Result<()> {
    let valid = |v: &Value| v.as_f64().is_some_and(|n| n.is_finite() && (1.0..=4096.0).contains(&n));
    if matches!(value, DynamicValue::Constant { value } if !valid(value))
        || matches!(value, DynamicValue::Keyframes { keys, .. } if keys.iter().any(|k| !valid(&k.value)))
    {
        return Err(invalid("fontSize", "label font size must be 1..4096 pixels"));
    }
    Ok(())
}

fn validate_material_domain(scene: &Scene, domain: &MaterialDomain) -> Result<()> {
    for (value, low) in [
        (&domain.x, -1_000_000.0),
        (&domain.y, -1_000_000.0),
        (&domain.width, 0.001),
        (&domain.height, 0.001),
    ] {
        validate_value("width", value, scene, UnitKind::Page)?;
        if let DynamicValue::Constant { value } = value {
            let n = typed_value(ValueType::Length, value)?.number()?;
            if !n.is_finite() || !(low..=1_000_000.0).contains(&n) {
                return Err(invalid("domain", "finite lengths and positive dimensions required"));
            }
        }
    }
    Ok(())
}
