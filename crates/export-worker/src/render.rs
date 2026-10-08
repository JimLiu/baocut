//! 逐帧合成与编码。输出帧 k 的序列时刻是 `start + k / fps`（精确值，架构设计 §9.10）；输出帧率与序列帧率不同时，
//! 帧计划按这个时刻所在的序列帧取实例，视频按这个时刻映射到的源时刻取帧。

use std::collections::HashSet;
use std::io::{BufRead, Read};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use font_files::FontFace;
use frame_render::{FrameRenderer, RenderError, RenderOptions, UnsupportedItem};
use media_core::encode::{Encoder, QueuedEncoder};
use render_graph::plan_frame;
use render_graph::video_plan::PictureRect;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::input::{Input, InputFont, OnUnsupported};
use crate::preflight;
use crate::sources::Sources;
use crate::{Failure, emit};

/// 进度最多这么频繁地报一次。
pub(crate) const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
/// 排队等着写进编码器的帧数（1080p 的 RGBA 一帧 8.3 MB，池里多一个正在画的）。
const ENCODE_QUEUE: usize = 2;

fn render_failure(error: RenderError) -> Failure {
    Failure {
        code: error.code,
        message: error.message,
        details: if error.items.is_empty() {
            Value::Null
        } else {
            json!({ "items": error.items })
        },
    }
}

/// 标准输入收到 `cancel` 或被关闭时置位。
pub(crate) fn watch_cancel() -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    let set = Arc::clone(&flag);
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(line) if line.trim() == "cancel" => break,
                Ok(_) => continue,
                Err(_) => break,
            }
        }
        set.store(true, Ordering::SeqCst);
    });
    flag
}

pub fn run(path: &Path) -> Result<ExitCode, Failure> {
    let cancel = watch_cancel();
    let input = Input::load(path)?;
    let tools = input.tools();
    let report = preflight::run(&input, &tools)?;
    if !report.missing_encoders.is_empty() {
        let mut failure = Failure::new(
            "EXPORT_TOOL_MISSING",
            format!("本机的 ffmpeg 没有编码器 {}", report.missing_encoders.join("、")),
        );
        failure.details = json!({ "missing": report.missing_encoders });
        return Err(failure);
    }
    let skip = input.on_unsupported == OnUnsupported::Skip;
    if !report.items.is_empty() && !skip {
        let mut failure = Failure::new(
            "EXPORT_UNSUPPORTED_CONTENT",
            report.items.iter().map(|i| i.message.clone()).collect::<Vec<_>>().join("；"),
        );
        failure.details = json!({ "items": report.items });
        return Err(failure);
    }
    let settings = input.encode_settings()?;
    // 按画布画在画面那一块的尺寸上；比输出小时贴进黑底的输出帧（黑边），排版不按输出的比例重排。
    let picture = input.output.picture();
    let boxed = Letterbox::new(input.output.width, input.output.height, picture);
    let mut renderer = FrameRenderer::new(
        RenderOptions {
            width: picture.width,
            height: picture.height,
            skip_unsupported: skip,
            captions: input.burn_captions,
        },
        preflight::documents(&input),
        frame_render::bundled_fonts(),
    )
    .map_err(render_failure)?;
    renderer.set_speakers(input.speakers.clone().map(Arc::new));
    // 冻结的本机字体在画第一帧之前装上；之后不再去本机找（成片按冻结的字体画，不随机器上后来的字体变）。
    let fonts = frozen_fonts(&input.fonts)?;
    if !fonts.is_empty() {
        renderer.add_fonts(fonts);
    }
    let mut sources = Sources::new(&input, tools.clone(), report.pictures.clone(), skip);
    let encoder = Encoder::start(&tools, &settings, &input.output.path).map_err(|e| Failure::new(e.code, e.message))?;
    // 写编码器在单独的线程：合成线程把帧交进队列就画下一帧（`progress` 的帧数是交进队列的帧数）。
    let mut encoder = QueuedEncoder::new(encoder, ENCODE_QUEUE, Letterbox::BAR);
    let view = input.document.view();
    let total = report.frames;
    let started = Instant::now();
    let mut reported = Instant::now() - PROGRESS_INTERVAL;
    emit(&json!({ "event": "progress", "frame": 0, "total": total }));
    for k in 0..total {
        if cancel.load(Ordering::SeqCst) {
            encoder.abort();
            sources.close();
            emit(&json!({ "event": "cancelled", "frame": k, "total": total }));
            return Ok(ExitCode::from(3));
        }
        sources.begin_frame(k);
        let step = (|| -> Result<(), Failure> {
            let t = input.frame_time(k)?;
            let plan = plan_frame(view, &input.sequence_id, t).map_err(|e| Failure::new(&e.code, e.message))?;
            renderer.render(view, &plan, t.to_f64(), &mut sources).map_err(render_failure)?;
            let encode_failure = |e: media_core::MediaError| Failure::new(e.code, e.message);
            let mut frame = encoder.buffer().map_err(encode_failure)?;
            boxed.place(renderer.frame().data(), &mut frame);
            encoder.submit(frame).map_err(encode_failure)
        })();
        if let Err(failure) = step {
            encoder.abort();
            sources.close();
            return Err(failure);
        }
        if reported.elapsed() >= PROGRESS_INTERVAL || k + 1 == total {
            reported = Instant::now();
            emit(&json!({ "event": "progress", "frame": k + 1, "total": total }));
        }
    }
    if cancel.load(Ordering::SeqCst) {
        encoder.abort();
        sources.close();
        emit(&json!({ "event": "cancelled", "frame": total, "total": total }));
        return Ok(ExitCode::from(3));
    }
    let restarts = sources.restarts();
    sources.close();
    encoder.finish().map_err(|e| Failure::new(e.code, e.message))?;
    let mut seen = HashSet::new();
    let skipped: Vec<UnsupportedItem> = report
        .items
        .iter()
        .chain(renderer.skipped())
        .chain(sources.skipped())
        .filter(|item| seen.insert(item.key()))
        .cloned()
        .collect();
    let mut warnings: Vec<Value> = report.warnings.iter().map(|w| json!(w)).collect();
    warnings.extend(renderer.warnings().iter().map(|w| json!(w)));
    let seconds = started.elapsed().as_secs_f64();
    emit(&json!({
        "event": "done",
        "frames": total,
        "skipped": skipped,
        "warnings": warnings,
        "decoderRestarts": restarts,
        "renderSeconds": (seconds * 1000.0).round() / 1000.0,
    }));
    Ok(ExitCode::SUCCESS)
}

/// 冻结的本机字体（架构设计 §9.11 的「字体」）：按冻结时记下的文件与文件里第几个，抽出那一个 face（与预览同一个抽法）。
/// 文件不见了、字节数或摘要与冻结时不同时以 `FONT_MISSING` 失败——成片不悄悄换成别的字体；冻结时就没找到的族不在
/// 这里，照回退字体画、渲染器报提示。同一个文件只核对一次，同一个 face 只装一次。
fn frozen_fonts(frozen: &[InputFont]) -> Result<Vec<Arc<Vec<u8>>>, Failure> {
    let mut checked: HashSet<PathBuf> = HashSet::new();
    let mut loaded: HashSet<(PathBuf, u32)> = HashSet::new();
    let mut fonts = Vec::new();
    for font in frozen {
        if !loaded.insert((font.path.clone(), font.face_index)) {
            continue;
        }
        let missing = |reason: &str, why: String| {
            let mut failure = Failure::new(
                "FONT_MISSING",
                format!("字体无法复现：「{}」用的本机字体 {} {why}", font.family, font.path.display()),
            );
            failure.details = json!({
                "family": font.family,
                "weight": font.weight,
                "italic": font.italic,
                "path": font.path,
                "reason": reason,
            });
            failure
        };
        if checked.insert(font.path.clone()) {
            let digest = file_digest(&font.path).map_err(|e| missing("missing", format!("读不到了（{e}）")))?;
            if digest != (font.byte_length, font.content_hash.clone()) {
                return Err(missing("changed", "与导出开始时不一样了".into()));
            }
        }
        let face = FontFace {
            path: font.path.clone(),
            index: font.face_index,
            file_len: font.byte_length,
        };
        let bytes =
            font_files::read_face(&face).map_err(|e| missing("unreadable", format!("抽不出第 {} 个字体（{e}）", font.face_index)))?;
        fonts.push(Arc::new(bytes));
    }
    Ok(fonts)
}

/// 文件的字节数与内容摘要（`sha256:` 加十六进制，与 Runtime 冻结素材与字体时的写法相同）。
fn file_digest(path: &Path) -> std::io::Result<(u64, String)> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let mut total = 0u64;
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        total += n as u64;
    }
    let hex: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Ok((total, format!("sha256:{hex}")))
}

/// 输出帧：画面与输出同尺寸时整帧复制进编码队列的缓冲；否则把画面逐行贴进画面那一块。缓冲来自编码队列的池，
/// 一开始铺满不透明黑（RGBA 0, 0, 0, 255）、回收时原样留着，画面以外的黑边不再重写。
struct Letterbox {
    picture: PictureRect,
    full: bool,
    stride: usize,
}

impl Letterbox {
    /// 黑边的颜色，也是编码队列的缓冲一开始铺的颜色。
    const BAR: [u8; 4] = [0, 0, 0, 255];

    fn new(width: u32, height: u32, picture: PictureRect) -> Letterbox {
        Letterbox {
            picture,
            full: picture.x == 0 && picture.y == 0 && picture.width == width && picture.height == height,
            stride: width as usize * 4,
        }
    }

    /// 把画面写进输出帧 `frame`（黑边已经铺好）。
    fn place(&self, picture: &[u8], frame: &mut [u8]) {
        if self.full {
            frame.copy_from_slice(picture);
            return;
        }
        let p = self.picture;
        let row = p.width as usize * 4;
        for (y, line) in picture.chunks_exact(row).take(p.height as usize).enumerate() {
            let at = (p.y as usize + y) * self.stride + p.x as usize * 4;
            frame[at..at + row].copy_from_slice(line);
        }
    }

    #[cfg(test)]
    fn frame(&self, height: u32) -> Vec<u8> {
        Self::BAR.repeat(self.stride / 4 * height as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frozen(path: &Path, bytes: &[u8]) -> InputFont {
        let hex: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
        InputFont {
            family: "Permanent Marker".into(),
            weight: 400,
            italic: false,
            path: path.to_path_buf(),
            face_index: 0,
            content_hash: format!("sha256:{hex}"),
            byte_length: bytes.len() as u64,
        }
    }

    /// 冻结的字体按摘要核对后抽出来装上（同一个 face 只装一次）；文件改了或不见了是 `FONT_MISSING`，不悄悄换字体。
    #[test]
    fn frozen_fonts_load_only_when_the_file_is_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../render-raster/assets/fonts/PermanentMarker-Regular.ttf");
        let bytes = std::fs::read(&source).unwrap();
        let path = dir.path().join("marker.ttf");
        std::fs::write(&path, &bytes).unwrap();
        let font = frozen(&path, &bytes);
        let fonts = frozen_fonts(&[font.clone(), font.clone()]).unwrap();
        assert_eq!(fonts.len(), 1);
        assert_eq!(*fonts[0], font_files::extract_face(&bytes, 0).unwrap());

        let mut changed = bytes.clone();
        let last = changed.len() - 1;
        changed[last] ^= 1;
        std::fs::write(&path, &changed).unwrap();
        let failure = frozen_fonts(std::slice::from_ref(&font)).unwrap_err();
        assert_eq!(failure.code, "FONT_MISSING");
        assert_eq!(failure.details["reason"], "changed");
        assert!(failure.message.starts_with("字体无法复现"), "{}", failure.message);

        std::fs::remove_file(&path).unwrap();
        let failure = frozen_fonts(&[font]).unwrap_err();
        assert_eq!(
            (failure.code.as_str(), &failure.details["reason"]),
            ("FONT_MISSING", &json!("missing"))
        );
        assert!(frozen_fonts(&[]).unwrap().is_empty());
    }

    /// 黑边与画面：画面逐行落在居中的那一块，其余是不透明的黑；与输出同尺寸时原样交出。
    #[test]
    fn the_picture_lands_centred_between_opaque_black_bars() {
        let picture = PictureRect {
            x: 2,
            y: 0,
            width: 4,
            height: 2,
        };
        // 画面每个像素按坐标上色，好认出落点。
        let source: Vec<u8> = (0..2u8)
            .flat_map(|y| (0..4u8).flat_map(move |x| [10 + x, 20 + y, 200, 255]))
            .collect();
        let boxed = Letterbox::new(8, 2, picture);
        let mut frame = boxed.frame(2);
        boxed.place(&source, &mut frame);
        assert_eq!(frame.len(), 8 * 2 * 4);
        for y in 0..2usize {
            for x in 0..8usize {
                let px = &frame[(y * 8 + x) * 4..][..4];
                if (2..6).contains(&x) {
                    assert_eq!(px, [10 + (x - 2) as u8, 20 + y as u8, 200, 255], "({x}, {y})");
                } else {
                    assert_eq!(px, [0, 0, 0, 255], "({x}, {y})");
                }
            }
        }
        // 上下黑边。
        let tall = Letterbox::new(
            2,
            6,
            PictureRect {
                x: 0,
                y: 2,
                width: 2,
                height: 2,
            },
        );
        let mut frame = tall.frame(6);
        tall.place(&[255; 16], &mut frame);
        let rows: Vec<&[u8]> = frame.chunks(8).collect();
        assert_eq!(rows[1], [0, 0, 0, 255, 0, 0, 0, 255]);
        assert_eq!(rows[2], [255; 8]);
        assert_eq!(rows[4], [0, 0, 0, 255, 0, 0, 0, 255]);
        // 铺满：整帧照抄。
        let full = Letterbox::new(
            4,
            2,
            PictureRect {
                x: 0,
                y: 0,
                width: 4,
                height: 2,
            },
        );
        let mut frame = vec![7; 4 * 2 * 4];
        full.place(&source, &mut frame);
        assert_eq!(frame, source);
    }
}
