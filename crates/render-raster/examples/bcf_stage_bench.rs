//! Run after building with --release. Inputs must be prepared BCF JSON documents.
use anyhow::{Context, Result, bail};
use render_raster::{CapabilityProfile, MediaStore, PreparedBcf, TextEngine, load_assets};
use scene_primitives::Resolver;
use std::{path::PathBuf, sync::Arc, time::Instant};

fn percentile(values: &mut [f64], fraction: f64) -> f64 {
    values.sort_by(f64::total_cmp);
    values[((values.len() - 1) as f64 * fraction).round() as usize]
}
fn main() -> Result<()> {
    let files: Vec<_> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if files.is_empty() {
        bail!("usage: bcf_stage_bench <document.bcut.json> ...");
    }
    let edge = std::env::var("BCUT_BENCH_LONG_EDGE")
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(640);
    for file in files {
        let document: serde_json::Value = serde_json::from_slice(&std::fs::read(&file)?)?;
        let assets = Arc::new(load_assets(
            &document,
            file.parent().context("document parent")?,
        )?);
        let mut resolver = Resolver::new(document, None)?;
        resolver.set_host_inputs(assets.inputs.clone());
        let ir = resolver.resolve()?;
        let (total, fps, w, h) = (ir.total, ir.fps, ir.w, ir.h);
        if !total.is_finite() || total <= 0.0 || !fps.is_finite() || fps <= 0.0 {
            bail!("benchmark requires a positive finite timeline");
        }
        let width = (edge as f64 * w / w.max(h)).round().max(1.0) as u32;
        let mut runtime = PreparedBcf::new(
            ir,
            TextEngine::with_document_fonts(&assets.fonts),
            &assets.lotties,
            CapabilityProfile::cpu_reference(),
        )?;
        let mut media = MediaStore::new(assets, fps);
        media.set_random_access(true);
        let before = Instant::now();
        runtime.render_cpu_width(0.0, &mut media, width)?;
        let cold = before.elapsed().as_secs_f64() * 1000.0;
        let frames = (total * fps).ceil() as usize;
        let stride = (frames / 45).max(1);
        let mut times = Vec::new();
        for frame in (0..frames).step_by(stride) {
            let before = Instant::now();
            runtime.render_cpu_width(frame as f64 / fps, &mut media, width)?;
            times.push(before.elapsed().as_secs_f64() * 1000.0);
        }
        let expected = runtime.render_cpu_width(total * 0.5, &mut media, width)?;
        let mut seeks = Vec::new();
        for fraction in [0.9, 0.1, 0.7, 0.3, 0.5] {
            let before = Instant::now();
            runtime.render_cpu_width(total * fraction, &mut media, width)?;
            seeks.push(before.elapsed().as_secs_f64() * 1000.0);
        }
        let repeated = runtime.render_cpu_width(total * 0.5, &mut media, width)?;
        let same = expected.data() == repeated.data();
        println!(
            "{}",
            serde_json::json!({"document":file.display().to_string(),"backend":"cpu-reference","width":width,"height":repeated.height(),
            "samples":times.len(),"coldMs":cold,"p50Ms":percentile(&mut times,0.5),"p95Ms":percentile(&mut times,0.95),
            "seekP95Ms":percentile(&mut seeks,0.95),"imageCacheBytes":media.image_cache_resident_bytes(),"randomSeekIdentical":same})
        );
        if !same {
            bail!("random seek differed for {}", file.display());
        }
    }
    Ok(())
}
