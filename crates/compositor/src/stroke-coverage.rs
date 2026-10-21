//! Ordered per-pixel AA events. A color tile cannot represent destination-dependent
//! byte rounding, so geometry is retained without precomposing its paint.
//! CPU cache, active frame programs and capture scratch each have a separate
//! 64 MiB admission limit. GPU event textures and per-operation ROI targets are
//! charged separately from the GPU's persistent 64 MiB event-cache reserve.
use anyhow::{Result, ensure};
use render_raster::{
    coverage::{CoverageSink, trace_aa_hairline},
    drawop::{DrawOp, FrameOps},
    raster::to_skia_path,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
use timeline_render::{GlyphInstance, GlyphKey, GlyphMask, GlyphRun, GlyphRunUniform, SceneFrame, SceneNode};

const LIMIT: usize = 64 * 1024 * 1024;
const MAX_RUNS: usize = 262144;
const MAX_EVENTS: usize = 4 * 1024 * 1024;
pub(crate) const GPU_CACHE_RESERVE: u64 = 64 * 1024 * 1024;

pub(crate) struct StrokeCoverage {
    pub key: [u8; 32],
    pub region: [u32; 4],
    /// Row-major offset/count pairs into the ordered coverage byte stream.
    pub index: Vec<[u32; 2]>,
    pub values: Vec<u8>,
    pub support: SceneFrame,
}
impl StrokeCoverage {
    pub fn bytes(&self) -> usize {
        self.index.len() * 9 + self.values.len()
    }
    pub fn gpu_bytes(&self) -> u64 {
        let rows = self.values.len().max(1).div_ceil(2048);
        // RG32Uint offset/count plus the padded R8Uint event stream. Every
        // stroke operation owns a separate ROI; its bytes are charged by plan.
        (self.index.len() * 8 + rows * 2048) as u64
    }
    pub fn work(&self) -> u64 {
        self.values.len() as u64 + self.index.len() as u64 * 4
    }
}
/// Shared by all DrawSourcePlans retained for one frame, including nested groups.
/// Cache eviction cannot release programs still referenced by those plans.
#[derive(Default)]
pub(crate) struct StrokeFrameResources {
    keys: BTreeSet<[u8; 32]>,
    cpu_bytes: usize,
    gpu_bytes: u64,
}
impl StrokeFrameResources {
    pub fn admit(&mut self, program: &StrokeCoverage) -> Result<()> {
        self.admit_resources(program.key, program.bytes(), program.gpu_bytes())
    }
    fn admit_resources(&mut self, key: [u8; 32], cpu_bytes: usize, gpu_bytes: u64) -> Result<()> {
        if self.keys.contains(&key) {
            return Ok(());
        }
        let total = self.cpu_bytes.saturating_add(cpu_bytes);
        ensure!(total <= LIMIT, "gpu-stroke-program-frame-budget");
        self.keys.insert(key);
        self.cpu_bytes = total;
        self.gpu_bytes = self.gpu_bytes.saturating_add(gpu_bytes);
        Ok(())
    }
    pub fn gpu_bytes(&self) -> u64 {
        self.gpu_bytes
    }
}
struct Entry {
    program: Arc<StrokeCoverage>,
    stamp: u64,
}
#[derive(Default)]
pub(crate) struct StrokeCoverageCache {
    entries: BTreeMap<[u8; 32], Entry>,
    bytes: usize,
    stamp: u64,
    prepared: u64,
}

#[derive(Clone, Copy)]
struct Run {
    x: u32,
    y: u32,
    width: u32,
    alpha: u8,
}
struct Recorder {
    runs: Vec<Run>,
    pixels: usize,
    region: [u32; 4],
    failed: bool,
}
impl CoverageSink for Recorder {
    fn span(&mut self, x: u32, y: u32, width: u32, alpha: u8) -> bool {
        let [left, top, w, h] = self.region;
        if x < left
            || y < top
            || y >= top + h
            || x.checked_add(width).is_none_or(|r| r > left + w)
            || self.runs.len() >= MAX_RUNS
            || self.pixels.saturating_add(width as usize) > MAX_EVENTS
        {
            self.failed = true;
            return false;
        }
        self.pixels += width as usize;
        self.runs.push(Run { x, y, width, alpha });
        true
    }
}
impl StrokeCoverageCache {
    /// Cumulative successful cache-miss preparations; eviction does not reset it.
    pub fn prepared_strokes(&self) -> u64 {
        self.prepared
    }
    pub fn prepare(&mut self, frame: &FrameOps, op: &DrawOp, size: [u32; 2]) -> Result<Option<Arc<StrokeCoverage>>> {
        self.stamp = self.stamp.wrapping_add(1);
        let (id, cap, tf) = match op {
            DrawOp::StrokePath { path, tf, .. } => (*path, 1, *tf),
            DrawOp::StrokePathPaint {
                path,
                cap,
                join,
                miter,
                tf,
                ..
            } => {
                ensure!(*cap <= 2 && *join <= 2 && miter.is_finite(), "gpu-draw-stroke-invalid");
                (*path, *cap, *tf)
            }
            _ => anyhow::bail!("gpu-stroke-program-operation"),
        };
        let source = frame.paths.get(id as usize).ok_or_else(|| anyhow::anyhow!("gpu-draw-path-index"))?;
        let mut f = FrameOps {
            paths: vec![source.clone()],
            ..Default::default()
        };
        f.ops.push(DrawOp::StrokePathPaint {
            path: 0,
            paint: 0,
            width: 0.,
            cap,
            join: 1,
            miter: 4.,
            tf,
        });
        let mut hash = Sha256::new();
        hash.update(b"ordered-stroke-coverage/1");
        for value in size {
            hash.update(value.to_le_bytes());
        }
        hash.update(render_raster::drawop::encode(&f));
        let key: [u8; 32] = hash.finalize().into();
        if let Some(entry) = self.entries.get_mut(&key) {
            entry.stamp = self.stamp;
            return Ok(Some(entry.program.clone()));
        }
        let path = to_skia_path(source).ok_or_else(|| anyhow::anyhow!("gpu-draw-path-invalid"))?;
        let ts = tiny_skia::Transform::from_row(tf[0], tf[1], tf[2], tf[3], tf[4], tf[5]);
        ensure!(ts.is_finite() && size.iter().all(|n| *n > 0), "gpu-stroke-program-transform");
        let mapped = path.clone().transform(ts).ok_or_else(|| anyhow::anyhow!("gpu-draw-path-invalid"))?;
        let b = mapped.bounds();
        let x = (b.left() - 2.).floor().max(0.);
        let y = (b.top() - 2.).floor().max(0.);
        let right = (b.right() + 2.).ceil().min(size[0] as f32);
        let bottom = (b.bottom() + 2.).ceil().min(size[1] as f32);
        if right <= x || bottom <= y {
            return Ok(None);
        }
        let w = right - x;
        let h = bottom - y;
        ensure!(
            w.is_finite() && h.is_finite() && w <= 2046. && h <= 2046.,
            "gpu-draw-path-atlas-size"
        );
        let region = [x as u32, y as u32, w as u32, h as u32];
        let pixels = region[2] as usize * region[3] as usize;
        // Counts, index, support, event bytes and bounded run storage together
        // must fit preparation limits before any full-size allocation.
        ensure!(
            pixels * 13 + MAX_EVENTS + MAX_RUNS * std::mem::size_of::<Run>() <= LIMIT,
            "gpu-stroke-program-preparation-budget"
        );
        let mut recorder = Recorder {
            runs: Vec::with_capacity(MAX_RUNS),
            pixels: 0,
            region,
            failed: false,
        };
        let cap = match cap {
            0 => tiny_skia::LineCap::Butt,
            1 => tiny_skia::LineCap::Round,
            _ => tiny_skia::LineCap::Square,
        };
        trace_aa_hairline(&path, cap, ts, size, &mut recorder).map_err(|e| anyhow::anyhow!("gpu-stroke-program-events: {e}"))?;
        ensure!(!recorder.failed, "gpu-stroke-program-event-budget");
        if recorder.pixels == 0 {
            return Ok(None);
        }
        let pixel_index = |r: Run| (r.y - region[1]) as usize * region[2] as usize + (r.x - region[0]) as usize;
        let mut counts = vec![0_u32; pixels];
        for run in &recorder.runs {
            let p = pixel_index(*run);
            for c in &mut counts[p..p + run.width as usize] {
                *c += 1;
            }
        }
        let max_count = counts.iter().copied().max().unwrap_or(0);
        ensure!(max_count <= 65536, "gpu-stroke-program-pixel-event-limit");
        let mut index = Vec::with_capacity(pixels);
        let mut offset = 0;
        for count in &counts {
            index.push([offset, *count]);
            offset += *count;
        }
        ensure!(offset as usize == recorder.pixels, "gpu-stroke-program-index");
        counts.fill(0);
        let mut values = vec![0; offset as usize];
        for run in &recorder.runs {
            let p = pixel_index(*run);
            for pos in p..p + run.width as usize {
                values[(index[pos][0] + counts[pos]) as usize] = run.alpha;
                counts[pos] += 1;
            }
        }
        let alpha: Vec<u8> = counts.iter().map(|n| if *n == 0 { 0 } else { 255 }).collect();
        let mask = Arc::new(
            GlyphMask::new(
                GlyphKey([
                    u64::from_le_bytes(key[..8].try_into().unwrap()),
                    u64::from_le_bytes(key[8..16].try_into().unwrap()),
                ]),
                region[2],
                region[3],
                0,
                0,
                alpha,
            )
            .unwrap(),
        );
        let support = SceneFrame {
            nodes: vec![SceneNode::Glyphs(Arc::new(GlyphRun {
                glyphs: Arc::from([GlyphInstance {
                    mask,
                    transform: [1., 0., 0., 1., 0., 0.],
                    uniform_index: 0,
                }]),
                uniforms: vec![GlyphRunUniform {
                    transform: [1., 0., 0., 1., region[0] as f32, region[1] as f32],
                    color: [1.; 4],
                    color_opacity: 1.,
                    clip: None,
                    paint: timeline_render::GlyphPaint::Solid,
                }],
                ..Default::default()
            }))],
            ..Default::default()
        };
        let program = Arc::new(StrokeCoverage {
            key,
            region,
            index,
            values,
            support,
        });
        let bytes = program.bytes();
        ensure!(bytes <= LIMIT, "gpu-stroke-program-cache-budget");
        while self.bytes.saturating_add(bytes) > LIMIT {
            let oldest = *self.entries.iter().min_by_key(|(_, e)| e.stamp).unwrap().0;
            self.bytes -= self.entries.remove(&oldest).unwrap().program.bytes();
        }
        self.bytes += bytes;
        self.entries.insert(
            key,
            Entry {
                program: program.clone(),
                stamp: self.stamp,
            },
        );
        self.prepared += 1;
        Ok(Some(program))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_program_budget_is_global_unique_and_failure_does_not_retain_more() {
        let mut resources = StrokeFrameResources::default();
        // One ledger is reused for sources and nested groups. Duplicate keys
        // must not consume another active allocation, even after cache eviction.
        resources.admit_resources([1; 32], LIMIT * 3 / 4, 43 * 1024 * 1024).unwrap();
        resources.admit_resources([1; 32], LIMIT * 3 / 4, 43 * 1024 * 1024).unwrap();
        resources.admit_resources([2; 32], LIMIT / 4, 14 * 1024 * 1024).unwrap();
        assert_eq!(resources.cpu_bytes, LIMIT);
        assert_eq!(resources.keys.len(), 2);
        assert_eq!(resources.gpu_bytes(), 57 * 1024 * 1024);
        // The cache reserve is additional; it cannot stand in for active data.
        assert_eq!(GPU_CACHE_RESERVE + resources.gpu_bytes(), 121 * 1024 * 1024);
        let error = resources.admit_resources([3; 32], 1, 2048).unwrap_err();
        assert!(error.to_string().contains("gpu-stroke-program-frame-budget"));
        assert_eq!(resources.cpu_bytes, LIMIT);
        assert_eq!(resources.keys.len(), 2);
        assert_eq!(resources.gpu_bytes(), 57 * 1024 * 1024);
    }

    #[test]
    fn event_texture_bytes_include_padding_but_exclude_per_operation_roi() {
        let program = StrokeCoverage {
            key: [0; 32],
            region: [0, 0, 2, 3],
            index: vec![[0, 0]; 6],
            values: vec![0; 2049],
            support: SceneFrame::default(),
        };
        assert_eq!(program.bytes(), 6 * 9 + 2049);
        assert_eq!(program.gpu_bytes(), 6 * 8 + 2 * 2048);
        // Six RGBA pixels belong to each operation's separately charged ROI.
        assert_ne!(program.gpu_bytes(), 6 * 8 + 2 * 2048 + 6 * 4);
    }

    #[test]
    fn preparation_stat_counts_geometry_misses_and_csr_keeps_repeat_order() {
        let mut path = tiny_skia::PathBuilder::new();
        for y in [6.5, 6.25, 6.5] {
            path.move_to(2.5, y);
            path.line_to(10.5, y);
        }
        let mut frame = FrameOps {
            paths: vec![render_raster::drawop::path_from_skia(&path.finish().unwrap())],
            ops: vec![DrawOp::StrokePath {
                path: 0,
                color: [1.; 4],
                width: 0.,
                tf: [1., 0., 0., 1., 0., 0.],
            }],
            ..Default::default()
        };
        let mut cache = StrokeCoverageCache::default();
        let first = cache.prepare(&frame, &frame.ops[0], [32, 16]).unwrap().unwrap();
        assert_eq!(cache.prepared_strokes(), 1);
        let pixel = (6 - first.region[1]) as usize * first.region[2] as usize + (5 - first.region[0]) as usize;
        let [offset, count] = first.index[pixel];
        assert_eq!(&first.values[offset as usize..(offset + count) as usize], &[255, 192, 255]);
        let again = cache.prepare(&frame, &frame.ops[0], [32, 16]).unwrap().unwrap();
        assert!(Arc::ptr_eq(&first, &again));
        assert_eq!(cache.prepared_strokes(), 1);
        if let DrawOp::StrokePath { color, width, .. } = &mut frame.ops[0] {
            *color = [0.2, 0.4, 0.6, 0.5];
            *width = 0.8;
        }
        let repaint = cache.prepare(&frame, &frame.ops[0], [32, 16]).unwrap().unwrap();
        assert!(Arc::ptr_eq(&first, &repaint));
        assert_eq!(
            cache.prepared_strokes(),
            1,
            "paint and width modulation do not rebuild scanner geometry"
        );
        if let DrawOp::StrokePath { tf, .. } = &mut frame.ops[0] {
            tf[4] = 0.375;
        }
        cache.prepare(&frame, &frame.ops[0], [32, 16]).unwrap().unwrap();
        assert_eq!(cache.prepared_strokes(), 2);
    }
}
