//! Immutable pre-animation glyph ink on frozen source-byte membership.
//! Captured once per cue/node/page, independent of request and seek order.
use super::*;

pub(super) fn enabled(scene: &Scene) -> bool {
    scene
        .required_capabilities
        .iter()
        .any(|cap| cap == "caption-reference-geometry/1")
}

fn joined(a: Option<Bounds>, b: Option<Bounds>) -> Option<Bounds> {
    match (a, b) {
        (Some(a), Some(b)) => Some(union([a, b].into_iter())),
        (a, b) => a.or(b),
    }
}

/// Logical cluster index plus a range-union tree. Multiple glyphs in one
/// cluster belong to its first source byte, as in the existing ink contract.
/// The tree makes unit lookup logarithmic, including RTL visual order.
pub(super) struct PageMetrics {
    clusters: Vec<usize>,
    base: usize,
    tree: Vec<Option<Bounds>>,
}
impl PageMetrics {
    pub(super) fn measure(page: &Page, budget: &mut Budget) -> Result<Arc<Self>> {
        let mut entries = BTreeMap::<usize, Option<Bounds>>::new();
        for line in &page.lines {
            for (glyph, ink) in line.shape.glyphs.iter().zip(&line.glyph_ink) {
                budget.spend()?;
                if let Some(ink) = ink {
                    let cluster = line.bytes.start + glyph.cluster.start;
                    let previous = entries.entry(cluster).or_default();
                    *previous = joined(*previous, Some(*ink));
                }
            }
        }
        if entries.is_empty() {
            // Empty pages have no glyph census cost; share their empty index
            // instead of allocating a tree for every cue/node/page combination.
            static EMPTY: std::sync::OnceLock<Arc<PageMetrics>> = std::sync::OnceLock::new();
            return Ok(EMPTY
                .get_or_init(|| {
                    Arc::new(Self {
                        clusters: Vec::new(),
                        base: 0,
                        tree: Vec::new(),
                    })
                })
                .clone());
        }
        let clusters = entries.keys().copied().collect::<Vec<_>>();
        let base = clusters.len().max(1).next_power_of_two();
        let mut tree = vec![None; base * 2];
        for (index, value) in entries.into_values().enumerate() {
            budget.spend()?;
            tree[base + index] = value;
        }
        for index in (1..base).rev() {
            budget.spend()?;
            tree[index] = joined(tree[index * 2], tree[index * 2 + 1]);
        }
        Ok(Arc::new(Self {
            clusters,
            base,
            tree,
        }))
    }
    fn ink(&self, bytes: &Range<usize>, budget: &mut Budget) -> Result<Option<Bounds>> {
        let mut left = self.base + self.clusters.partition_point(|at| *at < bytes.start);
        let mut right = self.base + self.clusters.partition_point(|at| *at < bytes.end);
        let mut result = None;
        while left < right {
            budget.spend()?;
            if left % 2 == 1 {
                result = joined(result, self.tree[left]);
                left += 1;
            }
            if right % 2 == 1 {
                right -= 1;
                result = joined(result, self.tree[right]);
            }
            left /= 2;
            right /= 2;
        }
        Ok(result)
    }
    pub(super) fn bind(
        &self,
        units: &mut [(Unit, Option<Line>)],
        budget: &mut Budget,
    ) -> Result<()> {
        for (unit, _) in units {
            budget.spend()?;
            unit.reference_ink = self.ink(&unit.bytes, budget)?;
        }
        Ok(())
    }
}

pub(super) fn add_fields(context: &mut Context, unit: &Unit) {
    let ink = unit.reference_ink.unwrap_or_default();
    for (field, value) in [
        ("layout.referenceInkX", ink.x),
        ("layout.referenceInkY", ink.y),
        ("layout.referenceInkWidth", ink.width),
        ("layout.referenceInkHeight", ink.height),
    ] {
        context
            .fields
            .insert(field.into(), Evaluated::Number(ValueType::Length, value));
    }
    context.fields.insert(
        "unit.referenceInkAvailable".into(),
        Evaluated::Bool(unit.reference_ink.is_some()),
    );
}
