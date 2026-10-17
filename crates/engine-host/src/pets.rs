//! Codex Pet 的精灵图（`pets.idleApng`，命令协议规范 `pets` 一行）。
//!
//! Codex Pet 是 Codex 桌面端桌宠的格式：一张 WebP 图集，8 列、每格 192×208，v1 九行（1536×1872）、v2 十一行
//! （1536×2288），每行一种状态。贴进视频的是待机那一行（第 0 行）的前 6 格，按 280、110、110、140、140、320 毫秒一格
//! 编成一份无限循环的 APNG（`.apng`，视频格式规范 §3.7），之后与别的动图一样由帧光栅按时刻取帧。版本按图集的高认，
//! 宽或高对不上的不收。

use std::fs;
use std::path::{Path, PathBuf};

use message_ref::msg;
use serde::Deserialize;
use serde_json::{Value, json};
use video_engine::{ErrorBody, Retryability};

/// 图集的列数与一格的尺寸。
pub const COLUMNS: u32 = 8;
pub const CELL_WIDTH: u32 = 192;
pub const CELL_HEIGHT: u32 = 208;
/// 待机那一行每格停多少毫秒。
pub const IDLE_DELAYS_MS: [u16; 6] = [280, 110, 110, 140, 140, 320];
/// 图集文件的上限：官方与社区的图集都在 3 MiB 以内，留足余量。
const MAX_SHEET_BYTES: u64 = 16 << 20;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdleApngParams {
    /// 图集文件（绝对路径）。
    pub sheet: String,
    /// 写出的 APNG（绝对路径）；先写到旁边的临时文件，写完改名。
    pub out: String,
}

/// 按图集的高认版本：9 行是 v1，11 行是 v2；宽必须是 8 列。
pub fn sheet_version(width: u32, height: u32) -> Option<u8> {
    if width != COLUMNS * CELL_WIDTH {
        return None;
    }
    match height / CELL_HEIGHT {
        9 if height % CELL_HEIGHT == 0 => Some(1),
        11 if height % CELL_HEIGHT == 0 => Some(2),
        _ => None,
    }
}

/// 把图集的待机行编成 APNG，返回字节与版本。图集解不开或尺寸不对时是给人看的原因。
pub fn encode_idle(sheet: &[u8]) -> Result<(Vec<u8>, u8), String> {
    let image = image::load_from_memory_with_format(sheet, image::ImageFormat::WebP)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let (width, height) = image.dimensions();
    let version = sheet_version(width, height)
        .ok_or_else(|| format!("the sheet is {width}×{height}; a Codex Pet sheet is 1536×1872 (v1) or 1536×2288 (v2)"))?;
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, CELL_WIDTH, CELL_HEIGHT);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .set_animated(IDLE_DELAYS_MS.len() as u32, 0)
            .map_err(|error| error.to_string())?;
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        for (column, delay) in IDLE_DELAYS_MS.iter().enumerate() {
            let cell = image::imageops::crop_imm(&image, column as u32 * CELL_WIDTH, 0, CELL_WIDTH, CELL_HEIGHT).to_image();
            writer.set_frame_delay(*delay, 1000).map_err(|error| error.to_string())?;
            writer
                .set_dispose_op(png::DisposeOp::Background)
                .map_err(|error| error.to_string())?;
            writer.set_blend_op(png::BlendOp::Source).map_err(|error| error.to_string())?;
            writer.write_image_data(cell.as_raw()).map_err(|error| error.to_string())?;
        }
        writer.finish().map_err(|error| error.to_string())?;
    }
    Ok((out, version))
}

/// `pets.idleApng`：读图集，编成 APNG 写到 `out`。
pub fn idle_apng(p: &IdleApngParams) -> Result<Value, ErrorBody> {
    let (sheet, out) = (Path::new(&p.sheet), Path::new(&p.out));
    if !sheet.is_absolute() || !out.is_absolute() {
        return Err(ErrorBody::new(
            "INVALID_PARAMS",
            msg!("engineHost.petPathRelative", "The sprite sheet and output paths must be absolute"),
            Retryability::Never,
        ));
    }
    let unreadable = |error: String| {
        ErrorBody::new(
            "PET_SHEET_INVALID",
            msg!(
                "engineHost.petSheetUnreadable",
                "Not a usable Codex Pet sprite sheet: {error}",
                error
            ),
            Retryability::Never,
        )
    };
    let size = fs::metadata(sheet).map_err(|error| unreadable(error.to_string()))?.len();
    if size > MAX_SHEET_BYTES {
        return Err(unreadable(format!("the file is over {} MiB", MAX_SHEET_BYTES >> 20)));
    }
    let bytes = fs::read(sheet).map_err(|error| unreadable(error.to_string()))?;
    let (apng, version) = encode_idle(&bytes).map_err(unreadable)?;
    let write_failed = |error: std::io::Error| {
        ErrorBody::new(
            "IO_ERROR",
            msg!(
                "engineHost.petWriteFailed",
                "Cannot write the pet animation: {error}",
                error = error.to_string()
            ),
            Retryability::SameCommand,
        )
    };
    let part = PathBuf::from(format!("{}.part", out.display()));
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).map_err(write_failed)?;
    }
    fs::write(&part, &apng).map_err(write_failed)?;
    fs::rename(&part, out).map_err(write_failed)?;
    let duration_ms: u32 = IDLE_DELAYS_MS.iter().map(|delay| u32::from(*delay)).sum();
    Ok(json!({
        "version": version,
        "width": CELL_WIDTH,
        "height": CELL_HEIGHT,
        "frames": IDLE_DELAYS_MS.len(),
        "durationMs": duration_ms,
        "bytes": apng.len(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// 一张 `rows` 行的图集（9 行是 v1、11 行是 v2）：第 0 行第 i 格整格是第 i 种颜色，其余透明。
    fn sheet(rows: u32) -> Vec<u8> {
        let mut image = image::RgbaImage::new(COLUMNS * CELL_WIDTH, rows * CELL_HEIGHT);
        for column in 0..6 {
            for y in 0..CELL_HEIGHT {
                for x in 0..CELL_WIDTH {
                    image.put_pixel(column * CELL_WIDTH + x, y, image::Rgba([column as u8 * 40, 200, 10, 255]));
                }
            }
        }
        let mut out = Cursor::new(Vec::new());
        image.write_to(&mut out, image::ImageFormat::WebP).unwrap();
        out.into_inner()
    }

    #[test]
    fn versions_follow_the_sheet_size() {
        assert_eq!(sheet_version(1536, 1872), Some(1));
        assert_eq!(sheet_version(1536, 2288), Some(2));
        assert_eq!(sheet_version(1536, 2000), None);
        assert_eq!(sheet_version(1535, 1872), None);
    }

    #[test]
    fn the_idle_row_becomes_a_looping_apng_with_the_delay_table() {
        use image::AnimationDecoder;
        let (apng, version) = encode_idle(&sheet(9)).unwrap();
        assert_eq!(version, 1);
        let decoder = image::codecs::png::PngDecoder::new(Cursor::new(&apng)).unwrap();
        assert!(decoder.is_apng().unwrap());
        let frames = decoder.apng().unwrap().into_frames().collect_frames().unwrap();
        assert_eq!(frames.len(), 6);
        for (index, frame) in frames.iter().enumerate() {
            let (numerator, denominator) = frame.delay().numer_denom_ms();
            assert_eq!(numerator / denominator, u32::from(IDLE_DELAYS_MS[index]));
            assert_eq!(frame.buffer().dimensions(), (CELL_WIDTH, CELL_HEIGHT));
            assert_eq!(frame.buffer().get_pixel(96, 104).0, [index as u8 * 40, 200, 10, 255]);
        }
    }

    #[test]
    fn v2_sheets_decode() {
        let (apng, version) = encode_idle(&sheet(11)).unwrap();
        assert_eq!(version, 2);
        let decoder = image::codecs::png::PngDecoder::new(Cursor::new(&apng)).unwrap();
        assert!(decoder.is_apng().unwrap());
    }

    #[test]
    fn bad_sheets_and_paths_are_refused() {
        assert!(encode_idle(b"not a webp").is_err());
        assert!(encode_idle(&sheet(10)).unwrap_err().contains("1536×1872"));
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sheet.webp");
        fs::write(&file, sheet(11)).unwrap();
        let out = dir.path().join("cache").join("idle.apng");
        let relative = IdleApngParams {
            sheet: "sheet.webp".into(),
            out: out.display().to_string(),
        };
        assert_eq!(idle_apng(&relative).unwrap_err().code, "INVALID_PARAMS");
        let ok = IdleApngParams {
            sheet: file.display().to_string(),
            out: out.display().to_string(),
        };
        let result = idle_apng(&ok).unwrap();
        assert_eq!(result["version"], 2);
        assert_eq!(result["durationMs"], 1100);
        assert!(fs::read(&out).unwrap().starts_with(b"\x89PNG"));
    }
}
