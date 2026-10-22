//! Stable global paint ordering for static word style variants.
use crate::{NodeKind, PaintLayer, Result, Scene, invalid};
use std::collections::{BTreeMap, BTreeSet};

/// Merge the base stack and every declared variant into one stable layer order.
///
/// Each stack contributes precedence edges between its adjacent layer IDs.
/// When several IDs are ready, their first declaration wins: base stack first,
/// then bindings in declaration order. Definitions may differ under one stable
/// ID, and variants may omit or add layers. Current selector membership never
/// changes this order. Callers draw one global layer at a time, grouping equal
/// complete layer definitions in first-glyph order, not complete style stacks.
pub fn paint_style_order(scene: &Scene, node_id: &str) -> Result<Vec<String>> {
    if scene.paint_style_bindings.len() > 64 {
        return Err(invalid("paintStyleBindings", "at most 64 paint style bindings"));
    }
    let mut pending = scene.nodes.iter().collect::<Vec<_>>();
    let mut target = None;
    let mut visited = 0;
    while let Some(node) = pending.pop() {
        visited += 1;
        if visited > crate::MAX_NODES {
            return Err(invalid("nodes", "node budget exceeded"));
        }
        if node.id == node_id && target.replace(node).is_some() {
            return Err(invalid(node_id, "ambiguous paint style text node"));
        }
        pending.extend(&node.children);
    }
    let node = target.ok_or_else(|| invalid(node_id, "paint style text node missing"))?;
    if node.kind != NodeKind::Text {
        return Err(invalid(node_id, "paint style order requires a text node"));
    }
    let mut stacks: Vec<&[PaintLayer]> = vec![&node.style.paints];
    for binding in &scene.paint_style_bindings {
        if binding.node_id == node_id {
            if binding.style.paints.is_empty() {
                return Err(invalid(&binding.id, "paint style replacement stack must not be empty"));
            }
            stacks.push(&binding.style.paints);
        }
    }
    let mut ids = Vec::new();
    let mut indices = BTreeMap::new();
    for stack in &stacks {
        if stack.len() > crate::paint_stack_limit(scene) {
            return Err(invalid(node_id, "paint budget exceeded"));
        }
        let mut local = BTreeSet::new();
        for layer in *stack {
            if !local.insert(layer.id.as_str()) {
                return Err(invalid(node_id, "duplicate paint layer id"));
            }
            if !indices.contains_key(layer.id.as_str()) {
                indices.insert(layer.id.as_str(), ids.len());
                ids.push(layer.id.as_str());
                if ids.len() > crate::paint_stack_limit(scene) {
                    return Err(invalid(
                        node_id,
                        format!("paint style layer id union exceeds {}", crate::paint_stack_limit(scene)),
                    ));
                }
            }
        }
    }
    let mut edges = vec![BTreeSet::new(); ids.len()];
    let mut incoming = vec![0usize; ids.len()];
    for stack in stacks {
        for pair in stack.windows(2) {
            let from = indices[pair[0].id.as_str()];
            let to = indices[pair[1].id.as_str()];
            if edges[from].insert(to) {
                incoming[to] += 1;
            }
        }
    }
    let mut emitted = vec![false; ids.len()];
    let mut order = Vec::with_capacity(ids.len());
    while order.len() < ids.len() {
        let next = (0..ids.len())
            .find(|&index| !emitted[index] && incoming[index] == 0)
            .ok_or_else(|| invalid(node_id, "paint style layer order contains a cycle"))?;
        emitted[next] = true;
        order.push(ids[next].to_owned());
        for &after in &edges[next] {
            incoming[after] -= 1;
        }
    }
    Ok(order)
}
