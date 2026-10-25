//! Per-word dynamic properties of the already selected complete paint stack.
use super::*;

pub(super) fn applies(scene: &Scene, node: &Node) -> bool {
    scene
        .paint_property_bindings
        .iter()
        .any(|binding| binding.node_id == node.id)
}

pub(super) fn needs_word_timing(scene: &Scene) -> bool {
    fn state(filter: &Filter) -> bool {
        match filter {
            Filter::State { .. } => true,
            Filter::And { filters } | Filter::Or { filters } => filters.iter().any(state),
            Filter::Not { filter } => state(filter),
            _ => false,
        }
    }
    scene.paint_property_bindings.iter().any(|binding| {
        matches!(&binding.value, DynamicValue::Keyframes { clock, .. } if clock.unit == UnitKind::Word)
            || scene.selectors.iter().any(|selector| selector.id == binding.selector_id && state(&selector.filter))
    })
}

pub(super) fn resolve(
    node: &Node,
    r: &RenderContext,
    word: Option<&Unit>,
    budget: &mut Budget,
) -> Result<Vec<PaintLayer>> {
    let chosen = if let Some(word) = word {
        paint_style_bindings::binding_index(r.scene, node, word, budget)?
    } else {
        None
    };
    let source = chosen
        .map(|index| r.scene.paint_style_bindings[index].style.paints.as_slice())
        .unwrap_or(node.style.paints.as_slice());
    for _ in source {
        budget.spend()?;
    }
    let mut layers = source.to_vec();
    let Some(word) = word else { return Ok(layers) };
    for binding in &r.scene.paint_property_bindings {
        budget.spend()?;
        if binding.node_id != node.id {
            continue;
        }
        let mut selector = None;
        for candidate in &r.scene.selectors {
            budget.spend()?;
            if candidate.id == binding.selector_id {
                selector = Some(candidate);
                break;
            }
        }
        let Some(selector) = selector else { continue };
        if word.kind != selector.unit
            || (word.whitespace && !selector.include_whitespace)
            || !unit_font_size::matches(&selector.filter, word, budget)?
        {
            continue;
        }
        let mut target = None;
        for (index, layer) in layers.iter().enumerate() {
            budget.spend()?;
            if layer.id == binding.paint_id {
                target = Some(index);
                break;
            }
        }
        // A property never creates a missing layer or resurrects a layer from
        // an unselected style variant. Its value is not sampled in this case.
        let Some(index) = target else { continue };
        let layer = &mut layers[index];
        let ty = match binding.property {
            PaintProperty::Color => ValueType::Color,
            PaintProperty::Blur => ValueType::Scalar,
        };
        let mut c = context(word, r);
        c.stable_key
            .push_str(&format!("|{}|paint|{}", node.id, binding.id));
        if matches!(&binding.value, DynamicValue::Keyframes { clock, .. } if !c.spans.contains_key(&clock.unit))
        {
            continue;
        }
        if let Some(units) = r.units.get(&node.id) {
            let mut rank = None;
            let mut count = 0;
            for (candidate, _) in units {
                budget.spend()?;
                if candidate.kind == selector.unit
                    && (!candidate.whitespace || selector.include_whitespace)
                    && unit_font_size::matches(&selector.filter, candidate, budget)?
                {
                    if candidate.id == word.id && rank.is_none() {
                        rank = Some(count);
                    }
                    count += 1;
                }
            }
            c.fields.insert(
                "unit.selectedIndex".into(),
                Evaluated::Number(ValueType::Scalar, rank.unwrap_or(0) as f64),
            );
            c.fields.insert(
                "unit.selectedCount".into(),
                Evaluated::Number(ValueType::Scalar, count as f64),
            );
        }
        cue_unit_context::select(&mut c, word, Some(&binding.selector_id));
        let Some(value) = sample_value(&binding.value, ty, r.scene, &c, r.seconds, budget)? else {
            continue;
        };
        match binding.property {
            PaintProperty::Color => {
                let Evaluated::Color(channels) = value else {
                    bail!("CAPTION_PAINT_INVALID: color type")
                };
                if channels
                    .iter()
                    .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
                {
                    bail!("CAPTION_PAINT_INVALID: color range");
                }
                let ScenePaint::Solid { color } = &mut layer.paint else {
                    bail!("CAPTION_PAINT_INVALID: solid color target")
                };
                let bytes = channels.map(|value| (value * 255.0).round() as u8);
                *color = format!(
                    "#{:02X}{:02X}{:02X}{:02X}",
                    bytes[0], bytes[1], bytes[2], bytes[3]
                );
            }
            PaintProperty::Blur => {
                let operand = value.number()?;
                let resolved = match binding.composite {
                    Composite::Replace => operand,
                    Composite::Add => layer.blur + operand,
                    Composite::Multiply => layer.blur * operand,
                };
                let limit = if layer.unit == PaintUnit::Em {
                    4.0
                } else {
                    256.0
                };
                if !resolved.is_finite() || !(0.0..=limit).contains(&resolved) {
                    bail!("CAPTION_PAINT_INVALID: blur range");
                }
                layer.blur = resolved;
            }
        }
    }
    Ok(layers)
}
