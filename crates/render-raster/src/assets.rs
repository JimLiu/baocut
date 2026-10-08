//! host 侧资源加载（opencat 显式生命周期的 fetch/probe 半边）：
//!   core host_requirements() → 本模块按 kind 加载/探测 → HostInputs 回填 core。
//! 所有路径相对文档目录；hash 声明时 sha256 强校验（渲染农场一致性）。

use crate::plan::PreflightDiagnostic;
use crate::source::{AnimatedImage, Lottie, PrepareCtx, VisualSource};
use anyhow::{Context, Result, anyhow, bail};
use scene_primitives::assets::{AssetKind, AssetReq, HostInputs};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tiny_skia::Pixmap;

/// 探测兜底用的 `ffprobe`：发现逻辑走 [`crate::exec`]（`BAOCUT_FFPROBE`，再 `PATH`），不归
/// 探测 crate 本身管，见 [`media_probe`] 顶部说明。找不到就是 `None`——
/// 调用方直接走纯 Rust 探测的结果，不再多花一次必然失败的 spawn。进程内只
/// 解析一次。
fn ffprobe_path() -> Option<&'static Path> {
    static RESOLVED: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    RESOLVED
        .get_or_init(|| crate::exec::find_executable("ffprobe"))
        .as_deref()
}

/// 视频资源：字节不进内存，逐帧经 VideoReader 按需解码。
#[derive(Debug, Clone)]
pub struct VideoInfo {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    /// 源自身的帧率。`0` = 探测不到。
    ///
    /// 用途只有一个：算出**最后一个可解码的时刻**（`duration - 1/fps`）。
    /// `ffmpeg -ss` 到最后一帧**之后**会一帧都吐不出来——那是硬错误，不是
    /// "冻结末帧"。想停在末帧的调用方（P7b 的 `sticker.loop = "once"`）必须
    /// 按源帧率夹取，按合成帧率夹取在低帧率片源上不够。
    pub fps: f64,
    /// 解码这条片源必须**显式指定**的解码器名（`None` = 让 ffmpeg 自选）。
    ///
    /// 只有一种情况用得上：**带 alpha 的 WebM**。ffmpeg 的原生 `vp9` / `vp8`
    /// 解码器会**静默丢掉 alpha 平面**（WebM 把它存在 `BlockAdditional` 里，
    /// 由容器的 `AlphaMode` 标记），只有 `libvpx-vp9` / `libvpx` 会还原它。
    /// 不指定就会让一张透明贴纸解出一块不透明的黑底——而且没有任何报错。
    /// 判据来自 [`probe_alpha_decoder`]，在资源加载期问一次。
    pub decoder: Option<String>,
}

#[derive(Default)]
pub struct LoadedAssets {
    /// 本次加载实际读取的文件，包括 Lottie 的外部图片；供宿主使热更新缓存失效。
    pub dependencies: Vec<PathBuf>,
    pub file_signatures: Vec<(PathBuf, Option<(u64, Option<std::time::SystemTime>)>)>,
    /// Lazy audio/video must still match the files probed during preparation.
    pub media_signatures: HashMap<PathBuf, (u64, Option<std::time::SystemTime>)>,
    pub images: HashMap<String, Arc<Pixmap>>,
    pub bounded_images: HashMap<String, PathBuf>,
    pub animated_svgs: HashMap<String, Arc<scene_primitives::svg_animation::SvgAnimation>>,
    /// 动图源（GIF / APNG / WebP）。`Arc` 是因为帧字节要跨渲染线程共享——
    /// 每个 worker 一个 `MediaStore`，但动图只解一次（`VisualSource` 无状态）。
    pub animated: HashMap<String, Arc<AnimatedImage>>,
    /// Lottie 源（bodymovin 子集）。与动图同样共享给多个 worker——
    /// `Lottie::record` 是纯函数，不持有采样状态。
    pub lotties: HashMap<String, Arc<Lottie>>,
    /// `program` 源（§6.5.3）：模块图与 `files` 字节只读共享，求值器按渲染线程各建一个。
    pub programs: HashMap<String, Arc<crate::program::ProgramSource>>,
    pub videos: HashMap<String, VideoInfo>,
    pub audios: HashMap<String, PathBuf>,
    /// 文档字体字节（进 TextEngine fontdb；非空 ⇒ strict 模式禁系统回退）
    pub fonts: Vec<Vec<u8>>,
    /// 资源加载期产生的 **warn 级**诊断（当前只有 Lottie 的
    /// `lottie-unsupported-feature`：忽略掉的表达式控制器组）。fail 级在这里
    /// 就是 `Err`，根本走不到 preflight。由 `FramePlanner` 并进 preflight 报告，
    /// 从 `bcut render --json` / `bcut ops` 的 `diagnostics` 透出。
    pub source_diagnostics: Vec<PreflightDiagnostic>,
    pub inputs: HostInputs,
}

impl LoadedAssets {
    /// 渲染中才出现的 warn：`program` 资产在加载期试渲的首帧之后才碰到的降级写法
    /// 与缺字形（`program-degraded`，按资产 id 排序）。与 `source_diagnostics`
    /// 不重复，渲染结束后读。
    pub fn render_diagnostics(&self) -> Vec<PreflightDiagnostic> {
        let mut ids: Vec<&String> = self.programs.keys().collect();
        ids.sort();
        ids.into_iter()
            .flat_map(|id| self.programs[id].late_diagnostics())
            .collect()
    }

    pub fn validate_media_files(&self) -> Result<()> {
        for path in self.media_signatures.keys() {
            self.validate_media_file(path)?;
        }
        Ok(())
    }

    pub fn validate_media_file(&self, path: &Path) -> Result<()> {
        if let Some(before) = self.media_signatures.get(path) {
            let meta = std::fs::metadata(path)?;
            if (meta.len(), meta.modified().ok()) != *before {
                bail!("BCF 媒体在准备后发生变化，请重新加载：{}", path.display());
            }
        }
        Ok(())
    }
}

/// doc + 文档目录 → 全部资源加载完成的 LoadedAssets（缺文件 / hash 不符即 fail-fast）。
pub fn load_assets(doc: &Value, base_dir: &Path) -> Result<LoadedAssets> {
    load_assets_with_vars(doc, base_dir, None)
}

/// 同 [`load_assets`]，带变量覆盖（asset 变量委托的需求解析，§11.1/§11.2）。
pub fn load_assets_with_vars(
    doc: &Value,
    base_dir: &Path,
    overrides: Option<&serde_json::Map<String, Value>>,
) -> Result<LoadedAssets> {
    let reqs = scene_primitives::host_requirements_with_vars(doc, overrides)?;
    let mut out = LoadedAssets::default();
    // 程序的字体库要等全部 `font` 资产读完才建得出来（字体可能排在程序后面）。
    #[cfg(feature = "program")]
    let mut programs = Vec::new();
    for req in &reqs {
        let path = base_dir.join(&req.src);
        let before = std::fs::metadata(&path)
            .with_context(|| format!("asset \"{}\": 读取 {} 失败", req.id, path.display()))?;
        let before = (before.len(), before.modified().ok());
        let lazy = matches!(req.kind, AssetKind::Video | AssetKind::Audio) || req.bounded_image;
        let bytes = if lazy {
            if req.hash.is_some() {
                use std::io::Read;
                let mut file = std::fs::File::open(&path)?;
                let mut hasher = Sha256::new();
                let mut buf = [0u8; 64 * 1024];
                loop {
                    let n = file.read(&mut buf)?;
                    if n == 0 {
                        break;
                    }
                    hasher.update(&buf[..n]);
                }
                verify_digest(req, &lower_hex(&hasher.finalize()))?;
            }
            Vec::new()
        } else {
            let bytes = std::fs::read(&path)?;
            verify_hash(req, &bytes)?;
            bytes
        };
        out.dependencies.push(path.clone());
        match req.kind {
            AssetKind::Image if req.bounded_image => {
                let reader = image::ImageReader::open(&path)?.with_guessed_format()?;
                if !matches!(
                    reader.format(),
                    Some(
                        image::ImageFormat::Png
                            | image::ImageFormat::Jpeg
                            | image::ImageFormat::WebP
                            | image::ImageFormat::Gif
                    )
                ) {
                    bail!(
                        "asset {}: bounded cache 只接受 PNG/JPEG/WebP/GIF 位图",
                        req.id
                    );
                }
                let (w, h) = reader.into_dimensions()?;
                if u64::from(w).saturating_mul(u64::from(h)).saturating_mul(4) > 64 * 1024 * 1024 {
                    bail!("asset {}: bounded image 单图不得超过 64 MiB", req.id);
                }
                out.inputs.insert_image(&req.id, w as f64, h as f64);
                out.bounded_images.insert(req.id.clone(), path.clone());
            }
            AssetKind::Image => {
                let pm = decode_image(&req.src, &bytes)
                    .with_context(|| format!("asset \"{}\" 解码失败", req.id))?;
                out.inputs
                    .insert_image(&req.id, pm.width() as f64, pm.height() as f64);
                out.images.insert(req.id.clone(), Arc::new(pm));
            }
            AssetKind::AnimatedImage => {
                let budget = PrepareCtx::default();
                let src = AnimatedImage::decode(&req.src, &bytes, &budget)
                    .with_context(|| format!("asset \"{}\" 解码失败", req.id))?;
                src.prepare(&budget)?;
                let meta = src.probe()?;
                out.inputs.insert_animated_image(
                    &req.id,
                    meta.width as f64,
                    meta.height as f64,
                    meta.frame_starts_ms.clone(),
                    meta.loops.plays(),
                );
                out.animated.insert(req.id.clone(), Arc::new(src));
            }
            AssetKind::Lottie => {
                let mut src = Lottie::parse(&req.id, &req.src, &bytes)
                    .with_context(|| format!("asset \"{}\" 解析失败", req.id))?;
                // 子资源在这里收集、读盘、解码，并按资产名并进内容指纹链；
                // 渲染期不得再有 I/O（`VisualSource` 的约定）。
                let lottie_dir = path.parent().unwrap_or(base_dir).to_path_buf();
                let mut loaded = Vec::new();
                for requirement in src.image_requirements().to_vec() {
                    let (bytes, label) = match (&requirement.embedded, &requirement.path) {
                        (Some(inline), _) => (inline.clone(), format!("<内嵌 {}>", requirement.id)),
                        (None, Some(relative)) => {
                            let child = lottie_dir.join(relative);
                            let meta = std::fs::metadata(&child)?;
                            out.file_signatures
                                .push((child.clone(), Some((meta.len(), meta.modified().ok()))));
                            let bytes = std::fs::read(&child).with_context(|| {
                                format!(
                                    "asset \"{}\"：读 Lottie 子资源 {} 失败",
                                    req.id,
                                    child.display()
                                )
                            })?;
                            out.dependencies.push(child.clone());
                            (bytes, child.display().to_string())
                        }
                        (None, None) => bail!(
                            "asset \"{}\"：Lottie 子资源 \"{}\" 既不是内嵌也没有路径",
                            req.id,
                            requirement.id
                        ),
                    };
                    let pixmap = requirement.decode(&bytes).with_context(|| {
                        format!("asset \"{}\"：Lottie 子资源 {label} 解码失败", req.id)
                    })?;
                    let pixmap = Arc::new(pixmap);
                    // 同一张图既进 Lottie 自己的采样表，也进 MediaStore——
                    // 元素路径发的是 `DrawMedia`，光栅化时从 MediaStore 取。
                    out.images
                        .insert(requirement.asset_name.clone(), pixmap.clone());
                    loaded.push((requirement.asset_name, bytes, pixmap));
                }
                src.attach_images(loaded);
                let budget = PrepareCtx::default();
                src.prepare(&budget)?;
                let meta = src.probe()?;
                out.source_diagnostics
                    .extend(src.diagnostics().iter().cloned());
                out.inputs.insert_lottie(
                    &req.id,
                    meta.width as f64,
                    meta.height as f64,
                    meta.frame_starts_ms.clone(),
                );
                out.lotties.insert(req.id.clone(), Arc::new(src));
            }
            AssetKind::Program => {
                #[cfg(feature = "program")]
                {
                    let program = req
                        .program
                        .as_ref()
                        .ok_or_else(|| anyhow!("asset \"{}\"：缺少 program 声明", req.id))?;
                    let bundle = bcut_compile::program::ProgramBundle::load(
                        &bcut_compile::program::ProgramSpec {
                            base_dir,
                            entry: &req.src,
                            export: &program.export,
                            imports: &program.imports,
                            files: &program.files,
                        },
                    )
                    .map_err(|error| crate::program::tag_asset(&req.id, error))?;
                    for (dependency, signature) in &bundle.dependencies {
                        out.dependencies.push(dependency.clone());
                        out.file_signatures.push((dependency.clone(), *signature));
                    }
                    out.inputs.insert_program(&req.id, program);
                    programs.push((req.id.clone(), bundle, program.clone()));
                }
                // v3：`bcut-compile` 不移植（架构设计 §13.6），`program` feature 只是占位。
                #[cfg(not(feature = "program"))]
                bail!(
                    "asset \"{}\"：program 资产要 BCF 编译器（bcut-compile），v3 不移植（架构设计 §13.6）",
                    req.id
                );
            }
            AssetKind::Video => {
                let probed = probe_media_info(&path, true)?;
                let (w, h) = (probed.display_width, probed.display_height);
                let (dur, fps) = (probed.duration, probed.fps);
                out.inputs
                    .insert_video(&req.id, w as f64, h as f64, dur, fps);
                out.videos.insert(
                    req.id.clone(),
                    VideoInfo {
                        decoder: probe_alpha_decoder(&path),
                        path: path.clone(),
                        width: w,
                        height: h,
                        duration: dur,
                        fps,
                    },
                );
            }
            AssetKind::Audio => {
                let probed = probe_media_info(&path, false)?;
                out.inputs.insert_audio(&req.id, probed.duration);
                out.audios.insert(req.id.clone(), path.clone());
            }
            AssetKind::Font => {
                let mut database = cosmic_text::fontdb::Database::new();
                database.load_font_data(bytes.clone());
                let family = database
                    .faces()
                    .next()
                    .and_then(|face| face.families.first())
                    .map(|(name, _)| name.clone())
                    .ok_or_else(|| anyhow!("asset {} 不含可用字体族", req.id))?;
                out.inputs
                    .font_families
                    .insert(req.src.clone(), family.clone());
                out.inputs
                    .font_families
                    .insert(format!("$assets.{}", req.id), family);
                out.fonts.push(bytes);
            }
        }
        let after = std::fs::metadata(&path)?;
        if before != (after.len(), after.modified().ok()) {
            bail!("asset \"{}\" 在加载期间发生变化，请重试", req.id);
        }
        if lazy {
            out.media_signatures.insert(path, before);
        } else {
            out.file_signatures.push((path, Some(before)));
        }
    }
    #[cfg(feature = "program")]
    if !programs.is_empty() {
        let fontdb = Arc::new(
            crate::fonts::TextEngine::for_document(&out.fonts)
                .font_system
                .db()
                .clone(),
        );
        for (id, bundle, program) in programs {
            let source = crate::program::ProgramSource::new(&id, bundle, &program, fontdb.clone());
            let diagnostics = source
                .probe()
                .map_err(|error| crate::program::tag_asset(&id, error))?;
            out.source_diagnostics.extend(diagnostics);
            out.programs.insert(id, Arc::new(source));
        }
    }
    out.file_signatures.extend(
        out.media_signatures
            .iter()
            .map(|(path, stamp)| (path.clone(), Some(*stamp))),
    );
    out.file_signatures.sort_by(|a, b| a.0.cmp(&b.0));
    for (path, before) in &out.file_signatures {
        let meta = std::fs::metadata(path)?;
        if Some((meta.len(), meta.modified().ok())) != *before {
            bail!("asset {} 在加载期间发生变化，请重试", path.display());
        }
    }
    Ok(out)
}

fn verify_hash(req: &AssetReq, bytes: &[u8]) -> Result<()> {
    if req.hash.is_none() {
        return Ok(());
    }
    verify_digest(req, &lower_hex(&Sha256::digest(bytes)))
}

/// sha2 0.11 的摘要（hybrid-array）没有 `LowerHex`：逐字节写出，与 v2 的 `{:x}` 同值。
fn lower_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn verify_digest(req: &AssetReq, actual: &str) -> Result<()> {
    let Some(decl) = &req.hash else { return Ok(()) };
    let hex = decl
        .strip_prefix("sha256-")
        .ok_or_else(|| anyhow!("asset \"{}\" hash 缺少 sha256- 前缀", req.id))?;
    if !actual.eq_ignore_ascii_case(hex) {
        bail!(
            "asset \"{}\" 内容与声明 hash 不符：期望 {hex}，实际 {actual}（文件被替换或损坏）",
            req.id
        );
    }
    Ok(())
}

/// png → tiny-skia 内置解码；jpg → image crate（无 alpha）；svg → resvg 天然尺寸光栅化。
/// **静态图专用**：GIF / APNG / 动画 WebP 走 `AssetKind::AnimatedImage`
/// 与 [`crate::source::AnimatedImage`]，不从这里进。
pub fn decode_image(src: &str, bytes: &[u8]) -> Result<Pixmap> {
    let ext = Path::new(src)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => Pixmap::decode_png(bytes).map_err(|e| anyhow!("PNG: {e}")),
        "jpg" | "jpeg" => {
            let img = image::load_from_memory(bytes)?.to_rgba8();
            let (w, h) = (img.width(), img.height());
            let mut pm = Pixmap::new(w, h).ok_or_else(|| anyhow!("空 JPEG"))?;
            pm.data_mut().copy_from_slice(img.as_raw()); // JPEG 无 alpha，straight == premultiplied
            Ok(pm)
        }
        "svg" => crate::svg::decode_svg_natural(bytes),
        "gif" | "webp" => bail!(
            "静态图片解码器不认 .{ext}：动图请把 asset 声明成 type: \"animatedImage\"、元素写 animatedImage（规范 §6.5.1）"
        ),
        other => bail!("不支持的图像格式 .{other}（png/jpg/svg）"),
    }
}

/// 按**目标长边**光栅化 SVG（实现在 [`crate::svg`]，浏览器预览共用同一份）。
pub use crate::svg::decode_svg_at_long_edge;

/// 按**字节**解码静态图（Lottie 子资源专用）。
///
/// 不走 [`decode_image`] 的扩展名分派：内嵌 data URI 根本没有文件名，
/// 而 bodymovin 的 `p` 字段在不同导出器下也未必带正确后缀。
pub fn decode_image_bytes(label: &str, bytes: &[u8]) -> Result<Pixmap> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Pixmap::decode_png(bytes).map_err(|e| anyhow!("{label}: PNG {e}"));
    }
    if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        return crate::svg::decode_svg_natural(bytes).map_err(|e| anyhow!("{label}: {e}"));
    }
    let img = image::load_from_memory(bytes)
        .map_err(|e| anyhow!("{label}: {e}"))?
        .to_rgba8();
    let (w, h) = (img.width(), img.height());
    let mut raw = img.into_raw();
    // straight RGBA → premultiplied（tiny-skia 的像素格式）
    for px in raw.chunks_exact_mut(4) {
        let pm = tiny_skia::ColorU8::from_rgba(px[0], px[1], px[2], px[3]).premultiply();
        px[0] = pm.red();
        px[1] = pm.green();
        px[2] = pm.blue();
        px[3] = pm.alpha();
    }
    let size = tiny_skia::IntSize::from_wh(w, h).ok_or_else(|| anyhow!("{label}: 零尺寸"))?;
    Pixmap::from_vec(raw, size).ok_or_else(|| anyhow!("{label}: 构造 pixmap 失败"))
}

struct ProbedMediaInfo {
    natural_width: u32,
    natural_height: u32,
    display_width: u32,
    display_height: u32,
    duration: f64,
    fps: f64,
}

fn probe_media_info(path: &Path, want_video: bool) -> Result<ProbedMediaInfo> {
    let (probe, _backend) = media_probe::probe_with_fallback(path, ffprobe_path())
        .with_context(|| format!("探测 {} 失败", path.display()))?;
    let (natural_width, natural_height) = probe.dimensions().unwrap_or((0, 0));
    let (display_width, display_height) = probe.display_dimensions().unwrap_or((0, 0));
    if want_video && (display_width == 0 || display_height == 0) {
        bail!("{} 没有视频流", path.display());
    }
    Ok(ProbedMediaInfo {
        natural_width,
        natural_height,
        display_width,
        display_height,
        duration: probe.duration_seconds.unwrap_or(0.0),
        fps: probe.fps().unwrap_or(0.0),
    })
}

/// 媒体探测：纯 Rust 主路径，解不了的容器才退到 `ffprobe`（可选）。
///
/// 返回 (natural_width, natural_height, duration, fps)；尺寸是**不含旋转**
/// 的编码口径，保持 CLI `naturalW/naturalH` 契约。渲染资源加载另行使用
/// 摆正后的 display 尺寸。fps 仅视频流有意义，`0` = 探测不到。
pub fn probe_media(path: &Path, want_video: bool) -> Result<(u32, u32, f64, f64)> {
    let probed = probe_media_info(path, want_video)?;
    Ok((
        probed.natural_width,
        probed.natural_height,
        probed.duration,
        probed.fps,
    ))
}

/// 带 alpha 的 WebM 需要**显式**解码器，否则 alpha 平面被静默丢掉。
///
/// WebM 把 alpha 存成每个 Block 的 `BlockAdditional`，靠 track 的 `AlphaMode`
/// 标记（EBML 0x53C0）。ffmpeg 的
/// **原生** `vp9` / `vp8` 解码器不读它，`libvpx-vp9` / `libvpx` 才读。
/// 实测（ffmpeg 7.1）：同一份 `yuva420p` 的 VP9 WebM，默认解码器给出的
/// 每个像素 α 都是 255，`-c:v libvpx-vp9` 才还原出真实 alpha。
///
/// 返回 `None` = 不用管（不是 alpha WebM，或者探测本身失败——那种情况下
/// 视频解码本身也会在下一步失败，这里不额外报错）。
///
/// alpha 标记现在由 [`media_probe`] 直接从 Matroska 的 `AlphaMode`
/// 元素读出，不再需要 ffprobe；**解码**仍然是 ffmpeg 的活，所以
/// 「codec + alpha → 解码器名」这层映射留在本模块。
///
/// 这是 P7b 动态贴纸（GIF → 带 alpha 的 WebM）能落进画面的必要条件。
pub fn probe_alpha_decoder(path: &Path) -> Option<String> {
    let (probe, _backend) = media_probe::probe_with_fallback(path, ffprobe_path()).ok()?;
    let video = probe.video.as_ref()?;
    if !video.alpha {
        return None;
    }
    match video.codec.as_deref()? {
        "vp9" => Some("libvpx-vp9".to_owned()),
        "vp8" => Some("libvpx".to_owned()),
        // 其余编码的 alpha 由各自的原生解码器还原，不用换。
        _ => None,
    }
}
