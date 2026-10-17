//! Canvas 录制转换的对拍：把录制里的若干帧转成 DrawOp 光栅，与 Chromium 截出的参考 PNG 比较。
//!
//! ```text
//! cargo run --release -p render-raster --example canvas2d_compare -- \
//!     <bundle-root> <recording.ndjson> <reference-dir> <out-dir> <frame>[=<png>] ...
//! ```
//!
//! 参考图默认是 `<reference-dir>/<frame>.png`；`<out-dir>` 里写出本侧渲染与放大 4 倍的差异图。

use render_raster::canvas2d::{Converter, Recording};
use render_raster::imgcmp;
use std::path::PathBuf;
use std::time::Instant;
use tiny_skia::Pixmap;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [root, recording, refs, out, frames @ ..] = args.as_slice() else {
        anyhow::bail!(
            "usage: <bundle-root> <recording> <reference-dir> <out-dir> <frame>[=<png>] ..."
        );
    };
    let out = PathBuf::from(out);
    std::fs::create_dir_all(&out)?;
    let started = Instant::now();
    let recording = Recording::load(recording.as_ref())?;
    let converter = Converter::new(root.as_ref(), &recording)?;
    eprintln!("load: {:.1} ms", started.elapsed().as_secs_f64() * 1000.0);
    println!("frame\tssim\tssim4x\tmax\tflat\tedge%\tconvert_ms\traster_ms");
    let mut worst = f64::INFINITY;
    for spec in frames {
        let (index, png) = match spec.split_once('=') {
            Some((i, p)) => (i.parse::<usize>()?, PathBuf::from(p)),
            None => (
                spec.parse::<usize>()?,
                PathBuf::from(refs).join(format!("{spec}.png")),
            ),
        };
        let json = recording
            .frame(index)
            .ok_or_else(|| anyhow::anyhow!("frame {index} missing"))?;
        let t0 = Instant::now();
        let ops = match converter.convert(json) {
            Ok(ops) => ops,
            Err(error) => {
                println!("{index}\t{error}");
                continue;
            }
        };
        let t1 = Instant::now();
        let ours = converter.rasterize(&ops, None)?;
        let t2 = Instant::now();
        let reference = render_raster::canvas2d::read_png(&png)?;
        let cmp = imgcmp::compare(&ours, &reference)?;
        worst = worst.min(cmp.ssim);
        println!(
            "{index}\t{:.4}\t{:.4}\t{}\t{}\t{:.2}\t{:.1}\t{:.1}",
            cmp.ssim,
            cmp.ssim_downsampled,
            cmp.max_deviation,
            cmp.flat_max_deviation,
            cmp.edge_share * 100.0,
            (t1 - t0).as_secs_f64() * 1000.0,
            (t2 - t1).as_secs_f64() * 1000.0,
        );
        // `INK=x,y,w,h`：区域内的亮度总和（文字粗细的粗略度量）。
        if let Ok(region) = std::env::var("INK") {
            let r: Vec<u32> = region.split(',').filter_map(|v| v.parse().ok()).collect();
            let ink = |p: &Pixmap| -> f64 {
                let mut sum = 0.0;
                for y in r[1]..r[1] + r[3] {
                    for x in r[0]..r[0] + r[2] {
                        let c = p.pixel(x, y).unwrap();
                        sum += f64::from(c.red()) * 0.3
                            + f64::from(c.green()) * 0.59
                            + f64::from(c.blue()) * 0.11;
                    }
                }
                sum / 255.0
            };
            println!("ink ours {:.0} ref {:.0}", ink(&ours), ink(&reference));
        }
        ours.save_png(out.join(format!("{index}.ours.png")))?;
        let mut diff =
            Pixmap::new(ours.width(), ours.height()).ok_or_else(|| anyhow::anyhow!("pixmap"))?;
        for ((d, a), b) in diff
            .data_mut()
            .chunks_exact_mut(4)
            .zip(ours.data().chunks_exact(4))
            .zip(reference.data().chunks_exact(4))
        {
            for c in 0..3 {
                d[c] = (a[c].abs_diff(b[c]) as u32 * 4).min(255) as u8;
            }
            d[3] = 255;
        }
        diff.save_png(out.join(format!("{index}.diff.png")))?;
    }
    println!("worst ssim: {worst:.4}");
    Ok(())
}
