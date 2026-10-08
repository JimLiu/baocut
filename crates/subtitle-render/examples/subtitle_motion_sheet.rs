//! `cargo run -p bcut-subtitle-render --example subtitle_motion_sheet -- /tmp/motion-proof`
//! Raster samples for reviewing native panel output at repeatable times.
use render_raster::fonts::TextEngine;
use subtitle_render::{word_motion::WORD_ANIM_TRACKS, word_motion_demo};
use tiny_skia::{Pixmap, PixmapPaint, Transform};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = std::env::args()
        .nth(1)
        .ok_or("provide an output directory")?;
    std::fs::create_dir_all(&output)?;
    let mut text = TextEngine::new();
    let times = [0.1, 0.675, 1.675, 3.175];
    let mut sheet = Pixmap::new(208 * 4, 128 * WORD_ANIM_TRACKS.len() as u32).unwrap();
    sheet.fill(tiny_skia::Color::from_rgba8(240, 240, 240, 255));
    for (row, animation) in WORD_ANIM_TRACKS.iter().enumerate() {
        for (column, time) in times.iter().enumerate() {
            let sample = word_motion_demo::render(&mut text, animation.catalog_id, *time, 208, 128)
                .ok_or("sample raster failed")?;
            sheet.draw_pixmap(
                column as i32 * 208,
                row as i32 * 128,
                sample.as_ref(),
                &PixmapPaint::default(),
                Transform::identity(),
                None,
            );
            sample.save_png(format!("{output}/{}-{column}.png", animation.catalog_id))?;
        }
    }
    sheet.save_png(format!("{output}/contact-sheet.png"))?;
    println!(
        "Rows: {}",
        WORD_ANIM_TRACKS
            .iter()
            .map(|a| a.catalog_id)
            .collect::<Vec<_>>()
            .join(", ")
    );
    println!("Columns (seconds): {times:?}");
    Ok(())
}
