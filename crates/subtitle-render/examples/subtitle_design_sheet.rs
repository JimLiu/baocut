//! Render the curated style families with the same planner used by playback and export.
//! cargo run -p bcut-subtitle-render --no-default-features --features wasm-safe --example subtitle_design_sheet -- /tmp/subtitle-designs
use subtitle_render::{OverlayIncludes, OverlayRenderPlan, text_design};
use tiny_skia::{Color, Pixmap, PixmapPaint, PixmapRef, Transform};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = std::env::args()
        .nth(1)
        .ok_or("provide an output directory")?;
    std::fs::create_dir_all(&output)?;
    let fonts = [
        include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").as_slice(),
        include_bytes!("../../render-raster/assets/fonts/Anton-Regular.ttf").as_slice(),
        include_bytes!("../../render-raster/assets/fonts/Inter-Medium.ttf").as_slice(),
        include_bytes!("../../render-raster/assets/fonts/Poppins-Black.ttf").as_slice(),
        include_bytes!("../../render-raster/assets/fonts/RobotoMono-Medium.ttf").as_slice(),
        include_bytes!("../../render-raster/assets/fonts/PlayfairDisplay-Italic.ttf").as_slice(),
        include_bytes!("../../render-raster/assets/fonts/Oswald-Bold.ttf").as_slice(),
    ];
    let times = [0.05, 0.25, 0.6, 1.6, 3.9];
    let mut sheet = Pixmap::new(
        320 * times.len() as u32,
        180 * text_design::designs().len() as u32,
    )
    .unwrap();
    sheet.fill(Color::from_rgba8(25, 30, 40, 255));
    for (row, design) in text_design::designs().iter().enumerate() {
        let doc = text_design::demo_document(&design["style"], "Make every word count");
        let mut renderer = OverlayRenderPlan::compile_with_injected_fonts(
            &doc,
            320,
            180,
            4.0,
            30.0,
            None,
            OverlayIncludes::ALL,
            fonts.iter().map(|bytes| bytes.to_vec()).collect(),
        )?;
        for (column, time) in times.iter().enumerate() {
            let result = renderer.render_subtitle_frame(*time)?;
            let frame = PixmapRef::from_bytes(&result.rgba, 320, 180).unwrap();
            sheet.draw_pixmap(
                column as i32 * 320,
                row as i32 * 180,
                frame,
                &PixmapPaint::default(),
                Transform::identity(),
                None,
            );
            let mut image = Pixmap::new(320, 180).unwrap();
            image.fill(Color::from_rgba8(25, 30, 40, 255));
            image.draw_pixmap(
                0,
                0,
                frame,
                &PixmapPaint::default(),
                Transform::identity(),
                None,
            );
            image.save_png(format!(
                "{output}/{}-{column}.png",
                design["id"].as_str().unwrap()
            ))?;
        }
    }
    sheet.save_png(format!("{output}/contact-sheet.png"))?;
    println!(
        "Rows: {}",
        text_design::designs()
            .iter()
            .map(|d| d["id"].as_str().unwrap())
            .collect::<Vec<_>>()
            .join(", ")
    );
    println!("Columns: {times:?}");
    Ok(())
}
