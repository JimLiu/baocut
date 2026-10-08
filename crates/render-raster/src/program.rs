//! `program` 资产（规范 §6.5.3）：`bcut-compile` 把程序求值成每帧一份 SVG，这里
//! 把它光栅成位图帧，经 [`crate::media::MediaStore`] 与动图同一条取帧路径供给。
//!
//! 求值器（QuickJS）是 `!Send` 的，`MediaStore` 却要跨线程移交；所以
//! [`ProgramSource`] 本身只放可共享的只读部分，求值器按线程懒建、按源缓存在
//! 线程局部表里（[`with_instance`]）。程序是逐帧纯函数，哪个线程画哪一帧结果都一样。
//! 模块顶层每个求值器只跑一次、之后一直留着，所以作者在顶层存可变状态会破坏这一点：
//! 加载期把首帧求值两次比对，不一致就报出来（[`ProgramSource::probe`]）。

use crate::plan::PreflightDiagnostic;
use anyhow::{Result, anyhow, bail};
use bcut_compile::program::{
    FontMetrics, MeasureText, ProgramBundle, ProgramFrame, ProgramInstance,
};
use resvg::usvg::{self, ImageHrefResolver, fontdb};
use scene_primitives::assets::ProgramReq;
use scene_primitives::program_path::{PATH_ESCAPE, escape_message, escapes};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use tiny_skia::Pixmap;

/// `asset("…")` 在 SVG 里写出的 `href` 前缀（运行时 `program.js` 的 `asset`）。
const ASSET_SCHEME: &str = "bcasset:";

/// 每个线程最多同时留几个程序的求值器。一个求值器是一整个 JS 堆（几十 MB），
/// 一份文档里的程序通常只有一两个。
const INSTANCES_PER_THREAD: usize = 4;

static NEXT_SERIAL: AtomicU64 = AtomicU64::new(1);

/// 一条降级提示：运行时的提示码、最早在哪一帧碰到，以及加载期试渲时是否已经报过。
#[derive(Debug)]
struct Degraded {
    warning: String,
    frame: u32,
    probed: bool,
}

/// 一个加载好的 `program` 资产：模块图、`files` 字节、声明的画布与帧表，以及排版
/// 用的字体库。渲染期不做 I/O。
pub struct ProgramSource {
    id: String,
    serial: u64,
    bundle: Arc<ProgramBundle>,
    props_json: String,
    width: u32,
    height: u32,
    fps: f64,
    frames: u32,
    frame_starts_ms: Vec<i64>,
    fontdb: Arc<fontdb::Database>,
    /// 字体库里的「最后手段」字体（macOS 的 `.LastResort`）：它给任何字符都画一个占位框，
    /// 文档没登记字体、走系统字体时，缺字形落到它身上而不是字形号 0。
    last_resort: Vec<fontdb::ID>,
    /// 渲染过的帧里碰到的降级提示（跨线程汇总，同一条只记一次）。
    degraded: Mutex<Vec<Degraded>>,
}

impl std::fmt::Debug for ProgramSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProgramSource")
            .field("id", &self.id)
            .field("width", &self.width)
            .field("height", &self.height)
            .field("fps", &self.fps)
            .field("frames", &self.frames)
            .finish_non_exhaustive()
    }
}

impl ProgramSource {
    pub fn new(
        id: &str,
        bundle: ProgramBundle,
        req: &ProgramReq,
        fontdb: Arc<fontdb::Database>,
    ) -> ProgramSource {
        ProgramSource {
            id: id.to_owned(),
            serial: NEXT_SERIAL.fetch_add(1, Ordering::Relaxed),
            bundle: Arc::new(bundle),
            props_json: req.props.to_string(),
            width: req.width,
            height: req.height,
            fps: req.fps,
            frames: req.frames,
            frame_starts_ms: req.frame_starts_ms(),
            last_resort: fontdb
                .faces()
                .filter(|face| face.families.iter().any(|(name, _)| name == ".LastResort"))
                .map(|face| face.id)
                .collect(),
            fontdb,
            degraded: Mutex::new(Vec::new()),
        }
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    /// `N + 1` 项帧起点表（毫秒），与动图 / Lottie 同一形状。
    pub fn frame_starts_ms(&self) -> &[i64] {
        &self.frame_starts_ms
    }

    /// 一轮的时长（秒）。
    pub fn duration(&self) -> f64 {
        self.frame_starts_ms.last().copied().unwrap_or(0) as f64 / 1000.0
    }

    pub fn bundle(&self) -> &ProgramBundle {
        &self.bundle
    }

    /// `ms` 落在第几帧（越界夹到首末帧）。
    pub fn frame_index(&self, ms: i64) -> u32 {
        crate::source::frame_index(&self.frame_starts_ms, ms) as u32
    }

    /// `ms` 所在帧的起点：同一帧窗口里的时刻画出来逐字节相同，缓存按它建键。
    pub fn frame_start_ms(&self, ms: i64) -> i64 {
        crate::source::frame_start_ms(&self.frame_starts_ms, ms)
    }

    fn frame_args(&self, frame: u32) -> ProgramFrame<'_> {
        ProgramFrame {
            frame: frame.min(self.frames.saturating_sub(1)),
            fps: self.fps,
            width: self.width,
            height: self.height,
            frames: self.frames,
            props_json: &self.props_json,
        }
    }

    /// 第 `frame` 帧的 SVG 文本。
    pub fn svg(&self, frame: u32) -> Result<String> {
        with_instance(self, |instance| {
            instance.render_svg(&self.frame_args(frame))
        })
    }

    /// 运行时在本线程最近求值的一帧里记下的降级提示（不支持的 CSS 等）。
    pub fn warnings(&self) -> Vec<String> {
        with_instance(self, |instance| Ok(instance.warnings())).unwrap_or_default()
    }

    /// 资源加载期的试渲：求值首帧并光栅一次，模块顶层之外的运行期错误（首帧就
    /// 抛的异常、引用了没声明的文件）在加载期就报出来，降级提示并进 preflight。
    /// 首帧再求值一次（不光栅）比对：两次不同说明模块顶层有跨帧的可变状态，
    /// 单帧渲染和多线程整片会画出不同的画面。
    pub fn probe(&self) -> Result<Vec<PreflightDiagnostic>> {
        let (_, svg) = self.render_frame(0, None)?;
        if self.svg(0)? != svg {
            self.note(0, vec!["module-state".to_owned()]);
        }
        let mut seen = self.degraded.lock().unwrap_or_else(|e| e.into_inner());
        Ok(seen
            .iter_mut()
            .map(|entry| {
                entry.probed = true;
                self.diagnostic(&entry.warning, None)
            })
            .collect())
    }

    /// 试渲首帧之后、渲染中才碰到的降级提示（后段才用到的写法、缺字形），按最早
    /// 出现的帧排序。加载期已经报过的不再重复；渲染结束后读。
    pub fn late_diagnostics(&self) -> Vec<PreflightDiagnostic> {
        let seen = self.degraded.lock().unwrap_or_else(|e| e.into_inner());
        let mut late: Vec<&Degraded> = seen.iter().filter(|entry| !entry.probed).collect();
        late.sort_by(|a, b| (a.frame, &a.warning).cmp(&(b.frame, &b.warning)));
        late.into_iter()
            .map(|entry| self.diagnostic(&entry.warning, Some(entry.frame)))
            .collect()
    }

    fn diagnostic(&self, warning: &str, frame: Option<u32>) -> PreflightDiagnostic {
        let at = frame
            .map(|frame| format!("（程序第 {frame} 帧起）"))
            .unwrap_or_default();
        PreflightDiagnostic {
            rule: "program-degraded",
            message: format!("asset \"{}\"：{}{at}", self.id, describe_warning(warning)),
        }
    }

    fn note(&self, frame: u32, warnings: Vec<String>) {
        if warnings.is_empty() {
            return;
        }
        let mut seen = self.degraded.lock().unwrap_or_else(|e| e.into_inner());
        for warning in warnings {
            match seen.iter_mut().find(|entry| entry.warning == warning) {
                Some(entry) => entry.frame = entry.frame.min(frame),
                None => seen.push(Degraded {
                    warning,
                    frame,
                    probed: false,
                }),
            }
        }
    }

    /// 取 `ms` 所在帧。`target = None` 按声明的画布尺寸光栅，否则按目标像素
    /// 尺寸重新排版光栅（矢量内容不经位图缩放）。这一帧的降级提示记进汇总。
    pub fn render(&self, ms: i64, target: Option<(u32, u32)>) -> Result<Pixmap> {
        let (pixmap, _) = self.render_frame(self.frame_index(ms), target)?;
        Ok(pixmap)
    }

    /// 求值并光栅第 `frame` 帧，连同这一帧的 SVG 文本。
    fn render_frame(&self, frame: u32, target: Option<(u32, u32)>) -> Result<(Pixmap, String)> {
        let (svg, mut warnings) = with_instance(self, |instance| {
            let svg = instance.render_svg(&self.frame_args(frame))?;
            Ok((svg, instance.warnings()))
        })?;
        let (pixmap, glyphs, families) = self.rasterize(frame, &svg, target)?;
        warnings.extend(
            families
                .into_iter()
                .map(|f| format!("font-family-missing:{f}")),
        );
        warnings.extend(glyphs.into_iter().map(|c| format!("glyph-missing:{c}")));
        self.note(frame, warnings);
        Ok((pixmap, svg))
    }

    /// 光栅一帧，连同文字里没有任何字体能画的字符（画成了 .notdef 空框），以及
    /// 字体库里找不到、改用缺省无衬线字体画的 `font-family`。
    fn rasterize(
        &self,
        frame: u32,
        svg: &str,
        target: Option<(u32, u32)>,
    ) -> Result<(Pixmap, Vec<char>, Vec<String>)> {
        let missing = Arc::new(Mutex::new(Vec::<String>::new()));
        let escaped = Arc::new(Mutex::new(Vec::<String>::new()));
        let unmatched = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut options = usvg::Options {
            fontdb: self.fontdb.clone(),
            ..usvg::Options::default()
        };
        options.image_href_resolver =
            asset_resolver(self.bundle.clone(), missing.clone(), escaped.clone());
        options.font_resolver.select_font = font_selector(unmatched.clone());
        let tree = usvg::Tree::from_str(svg, &options).map_err(|e| {
            anyhow!(
                "program-render-failed: asset \"{}\" 第 {frame} 帧的 SVG 解析失败：{e}",
                self.id
            )
        })?;
        // asset() 的路径用 `..` 越出文档目录：只有求值时才知道，由这里报与 lint 同一个码
        let escaped = std::mem::take(&mut *escaped.lock().unwrap_or_else(|e| e.into_inner()));
        if let Some(first) = escaped.first() {
            let more = match escaped.len() {
                1 => String::new(),
                n => format!("（另有 {} 处：{}）", n - 1, escaped[1..].join("、")),
            };
            bail!(
                "{PATH_ESCAPE}: asset \"{}\" 第 {frame} 帧：{}{more}",
                self.id,
                escape_message("asset()", first)
            );
        }
        let missing = std::mem::take(&mut *missing.lock().unwrap_or_else(|e| e.into_inner()));
        if !missing.is_empty() {
            bail!(
                "program-file-missing: asset \"{}\" 第 {frame} 帧引用了 files 之外的文件：{}\
                 （asset() 只能取 files 声明过的文件，路径相对文档目录）",
                self.id,
                missing.join("、")
            );
        }
        let (width, height) = target.unwrap_or((self.width, self.height));
        let (width, height) = (width.max(1), height.max(1));
        let mut pixmap = Pixmap::new(width, height)
            .ok_or_else(|| anyhow!("program-render-failed: 目标尺寸 {width}×{height} 无效"))?;
        let size = tree.size();
        let transform = tiny_skia::Transform::from_scale(
            width as f32 / size.width().max(1.0),
            height as f32 / size.height().max(1.0),
        );
        let painted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            resvg::render(&tree, transform, &mut pixmap.as_mut());
        }));
        if painted.is_err() {
            bail!(
                "program-render-failed: asset \"{}\" 第 {frame} 帧光栅化时 resvg 崩溃",
                self.id
            );
        }
        let mut glyphs = Vec::new();
        missing_glyphs(tree.root(), &self.last_resort, &mut glyphs);
        glyphs.sort_unstable();
        glyphs.dedup();
        let families = std::mem::take(&mut *unmatched.lock().unwrap_or_else(|e| e.into_inner()));
        Ok((pixmap, glyphs, families))
    }
}

/// 按 `font-family` 列表选字体。usvg 的缺省做法是列表都落空时找 `serif`：严格字体库里
/// 通常没有它（缺省是 Times New Roman），整段文字静默消失；有系统字体时又悄悄换成衬线体。
/// 这里列表落空就用缺省无衬线字体（文档登记的第一个字体）画，并记下落空的字族列表。
fn font_selector(unmatched: Arc<Mutex<Vec<String>>>) -> usvg::FontSelectionFn<'static> {
    Box::new(move |font, db| {
        let declared = font
            .families()
            .iter()
            .map(|family| match family {
                usvg::FontFamily::Serif => fontdb::Family::Serif,
                usvg::FontFamily::SansSerif => fontdb::Family::SansSerif,
                usvg::FontFamily::Cursive => fontdb::Family::Cursive,
                usvg::FontFamily::Fantasy => fontdb::Family::Fantasy,
                usvg::FontFamily::Monospace => fontdb::Family::Monospace,
                usvg::FontFamily::Named(name) => fontdb::Family::Name(name),
            })
            .collect::<Vec<_>>();
        let stretch = match font.stretch() {
            usvg::FontStretch::UltraCondensed => fontdb::Stretch::UltraCondensed,
            usvg::FontStretch::ExtraCondensed => fontdb::Stretch::ExtraCondensed,
            usvg::FontStretch::Condensed => fontdb::Stretch::Condensed,
            usvg::FontStretch::SemiCondensed => fontdb::Stretch::SemiCondensed,
            usvg::FontStretch::Normal => fontdb::Stretch::Normal,
            usvg::FontStretch::SemiExpanded => fontdb::Stretch::SemiExpanded,
            usvg::FontStretch::Expanded => fontdb::Stretch::Expanded,
            usvg::FontStretch::ExtraExpanded => fontdb::Stretch::ExtraExpanded,
            usvg::FontStretch::UltraExpanded => fontdb::Stretch::UltraExpanded,
        };
        let style = match font.style() {
            usvg::FontStyle::Normal => fontdb::Style::Normal,
            usvg::FontStyle::Italic => fontdb::Style::Italic,
            usvg::FontStyle::Oblique => fontdb::Style::Oblique,
        };
        let query = |families: &[fontdb::Family<'_>]| {
            db.query(&fontdb::Query {
                families,
                weight: fontdb::Weight(font.weight()),
                stretch,
                style,
            })
        };
        if let Some(id) = query(&declared) {
            return Some(id);
        }
        // `FontFamily` 的 Display 给具名字族加引号，消息里写裸名。
        let families = font
            .families()
            .iter()
            .map(|family| match family {
                usvg::FontFamily::Named(name) => name.clone(),
                generic => generic.to_string(),
            })
            .collect::<Vec<_>>()
            .join(", ");
        if let Ok(mut unmatched) = unmatched.lock() {
            if !unmatched.contains(&families) {
                unmatched.push(families);
            }
        }
        query(&[fontdb::Family::SansSerif])
    })
}

/// 排版结果里没有真字形的字符：字形号 0（.notdef），或落到了「最后手段」字体上。
/// 文档字体与内置字体都没有它，usvg 的逐字回退也找不到，画出来是空框，而且不会报错。
fn missing_glyphs(group: &usvg::Group, last_resort: &[fontdb::ID], out: &mut Vec<char>) {
    for node in group.children() {
        match node {
            usvg::Node::Group(group) => missing_glyphs(group, last_resort, out),
            usvg::Node::Text(text) => {
                for span in text.layouted() {
                    let missing = span
                        .positioned_glyphs
                        .iter()
                        .filter(|g| g.id.0 == 0 || last_resort.contains(&g.font));
                    for glyph in missing {
                        out.extend(
                            glyph
                                .text
                                .chars()
                                .filter(|c| !c.is_whitespace() && !c.is_control()),
                        );
                    }
                }
            }
            _ => {}
        }
        node.subroots(|sub| missing_glyphs(sub, last_resort, out));
    }
}

/// 给加载期错误标上资产名，诊断码仍留在最前面（`program-…: asset "x"：…`），
/// 宿主按码分流不受影响。
pub fn tag_asset(id: &str, error: anyhow::Error) -> anyhow::Error {
    let text = format!("{error:#}");
    let tag = format!("asset \"{id}\"");
    if text.contains(&tag) {
        return error;
    }
    match text.split_once(": ") {
        Some((code, rest))
            if code.starts_with("program-") && !code.contains(char::is_whitespace) =>
        {
            anyhow!("{code}: {tag}：{rest}")
        }
        _ => anyhow!("{tag}：{text}"),
    }
}

/// `bcasset:` 引用从 `files` 取字节；其余 `href` 只认 data URI，磁盘路径一律不读。
/// `asset()` 的路径用 `..` 越出文档目录的记进 `escaped`（报 `program-path-escape`），
/// 其余取不到的记进 `missing`（报 `program-file-missing`）。
fn asset_resolver(
    bundle: Arc<ProgramBundle>,
    missing: Arc<Mutex<Vec<String>>>,
    escaped: Arc<Mutex<Vec<String>>>,
) -> ImageHrefResolver<'static> {
    ImageHrefResolver {
        resolve_data: ImageHrefResolver::default_data_resolver(),
        resolve_string: Box::new(move |href: &str, options: &usvg::Options| {
            if let Some(name) = href.strip_prefix(ASSET_SCHEME)
                && escapes("", name)
            {
                if let Ok(mut escaped) = escaped.lock()
                    && !escaped.iter().any(|seen| seen == name)
                {
                    escaped.push(name.to_owned());
                }
                return None;
            }
            let found = href
                .strip_prefix(ASSET_SCHEME)
                .and_then(|name| bundle.file(name).map(|bytes| (name, bytes.clone())));
            let Some((name, bytes)) = found else {
                if let Ok(mut missing) = missing.lock() {
                    let name = href.strip_prefix(ASSET_SCHEME).unwrap_or(href).to_owned();
                    if !missing.contains(&name) {
                        missing.push(name);
                    }
                }
                return None;
            };
            let kind = match sniff(&bytes) {
                Some(mime) => (ImageHrefResolver::default_data_resolver())(mime, bytes, options),
                None => None,
            };
            if kind.is_none() {
                if let Ok(mut missing) = missing.lock() {
                    missing.push(format!("{name}（不是 PNG / JPEG / GIF / WebP / SVG）"));
                }
            }
            kind
        }),
    }
}

/// 按字节头认图片格式（文件名可能没有或不可信）。
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        let head = &bytes[..bytes.len().min(512)];
        let text = String::from_utf8_lossy(head);
        let text = text.trim_start_matches('\u{feff}').trim_start();
        (text.starts_with("<?xml") || text.contains("<svg")).then_some("image/svg+xml")
    }
}

fn describe_warning(warning: &str) -> String {
    let (kind, detail) = warning.split_once(':').unwrap_or((warning, ""));
    match kind {
        "css-unsupported" => format!("CSS 属性 {detail} 画不出来，已忽略"),
        "css-transform-unsupported" => format!("CSS transform 的 {detail}() 画不出来，已忽略"),
        "css-filter-unsupported" => format!("CSS filter 的 {detail}() 画不出来，已忽略"),
        "css-clip-path-unsupported" => format!("clip-path「{detail}」画不出来，已忽略"),
        "css-mask-unsupported" => "CSS mask 画不出来，已忽略".to_owned(),
        "css-background-unsupported" => format!("background「{detail}」画不出来，已忽略"),
        "svg-tag-unknown" => format!("<{detail}> 不是认识的 SVG 标签，按原样输出"),
        "css-blend-unsupported" => format!(
            "mix-blend-mode「{detail}」画不出来，这一层按 normal 叠（光栅器只认 bcut spec program 的 \
             cssBlendModes）；加色发光改用 screen，或把这层拆成单独的 program 元素、在元素上写 style.blendMode: \"plus\""
        ),
        "font-missing" => format!("measureText 找不到字体「{detail}」，文字宽度按估算排版"),
        "css-backdrop-unsupported" => {
            format!("backdrop-filter「{detail}」画不出来（只支持 div 上的滤镜函数），已忽略")
        }
        "font-family-missing" => format!(
            "字族「{detail}」在登记的字体里找不到，这段文字改用缺省无衬线字体画；字族名写字体文件里的族名\
             （name 表 ID 1，Google Fonts 的 static 包常带「24pt」这类后缀），并把字体登记成 font 资产"
        ),
        "module-state" => "同一帧求值两次画出的不一样：模块顶层有跨帧的可变状态（比如组件里改写顶层的 let），\
             单帧渲染和整片（多线程各画一段）会不一致；顶层只放只读常量，随时间变化的量从 useFrame() 算"
            .to_owned(),
        "glyph-missing" => format!(
            "字符「{detail}」（U+{:04X}）在登记的字体里都没有字形，画成了空框；把带这个字符的字体登记成 font 资产",
            detail.chars().next().map_or(0, u32::from)
        ),
        _ => warning.to_owned(),
    }
}

type InstanceSlot = (u64, Weak<ProgramBundle>, Rc<ProgramInstance>);

thread_local! {
    /// 本线程的求值器，按 [`ProgramSource`] 的序号建键，最近用过的在尾部。
    static INSTANCES: RefCell<Vec<InstanceSlot>> = const { RefCell::new(Vec::new()) };
}

/// 在本线程的求值器上跑 `f`；没有就建一个（首次约几十毫秒）。
fn with_instance<T>(
    source: &ProgramSource,
    f: impl FnOnce(&ProgramInstance) -> Result<T>,
) -> Result<T> {
    let instance = INSTANCES.with(|cell| -> Result<Rc<ProgramInstance>> {
        let mut slots = cell.borrow_mut();
        // 源已经释放的求值器随手清掉：它们的 JS 堆不该活到线程结束。
        slots.retain(|(_, bundle, _)| bundle.strong_count() > 0);
        if let Some(index) = slots
            .iter()
            .position(|(serial, ..)| *serial == source.serial)
        {
            let slot = slots.remove(index);
            let instance = slot.2.clone();
            slots.push(slot);
            return Ok(instance);
        }
        let instance = Rc::new(ProgramInstance::new(
            &source.bundle,
            Some(measure_text(source.fontdb.clone())),
        )?);
        instance.set_font_metrics(font_metrics(source.fontdb.clone()))?;
        if slots.len() >= INSTANCES_PER_THREAD {
            slots.remove(0);
        }
        slots.push((
            source.serial,
            Arc::downgrade(&source.bundle),
            instance.clone(),
        ));
        Ok(instance)
    })?;
    f(&instance)
}

/// `measureText` 的宿主实现：按 CSS 字体族列表、字重、斜体在文档字体库里选字，
/// 用与 usvg 排版同一份 rustybuzz 塑形后累加步进。找不到字体返回 NaN，运行时
/// 退回按字号估算。
fn measure_text(db: Arc<fontdb::Database>) -> MeasureText {
    let faces: RefCell<HashMap<(String, u16, bool), Option<fontdb::ID>>> =
        RefCell::new(HashMap::new());
    Box::new(move |text, family, size, weight, italic| {
        let key = (family.to_owned(), weight, italic);
        let id = *faces
            .borrow_mut()
            .entry(key)
            .or_insert_with(|| select_face(&db, family, weight, italic));
        let Some(id) = id else {
            return f64::NAN;
        };
        db.with_face_data(id, |data, index| {
            let face = rustybuzz::Face::from_slice(data, index)?;
            let mut buffer = rustybuzz::UnicodeBuffer::new();
            buffer.push_str(text);
            let shaped = rustybuzz::shape(&face, &[], buffer);
            let advance: i64 = shaped
                .glyph_positions()
                .iter()
                .map(|position| i64::from(position.x_advance))
                .sum();
            Some(advance as f64 * size / f64::from(face.units_per_em().max(1)))
        })
        .flatten()
        .unwrap_or(f64::NAN)
    })
}

/// `measureText` 的 `ascent` / `descent` 的宿主实现：与 [`measure_text`] 同一套选字，取字体级
/// 度量（ttf-parser 的 `ascender` / `descender`：OS/2 置了 USE_TYPO_METRICS 用 typo 值，否则
/// hhea，hhea 为 0 再退 OS/2）——usvg 排版放基线用的就是这两个数。descent 取正。
fn font_metrics(db: Arc<fontdb::Database>) -> FontMetrics {
    let faces: RefCell<HashMap<(String, u16, bool), Option<fontdb::ID>>> =
        RefCell::new(HashMap::new());
    Box::new(move |family, size, weight, italic| {
        let key = (family.to_owned(), weight, italic);
        let id = (*faces
            .borrow_mut()
            .entry(key)
            .or_insert_with(|| select_face(&db, family, weight, italic)))?;
        db.with_face_data(id, |data, index| {
            let face = rustybuzz::Face::from_slice(data, index)?;
            let scale = size / f64::from(face.units_per_em().max(1));
            Some((
                f64::from(face.ascender()) * scale,
                -f64::from(face.descender()) * scale,
            ))
        })
        .flatten()
    })
}

fn select_face(
    db: &fontdb::Database,
    family: &str,
    weight: u16,
    italic: bool,
) -> Option<fontdb::ID> {
    let names = parse_family_list(family);
    let mut families: Vec<fontdb::Family<'_>> = names
        .iter()
        .map(|name| match name.to_ascii_lowercase().as_str() {
            "serif" => fontdb::Family::Serif,
            "sans-serif" => fontdb::Family::SansSerif,
            "monospace" => fontdb::Family::Monospace,
            "cursive" => fontdb::Family::Cursive,
            "fantasy" => fontdb::Family::Fantasy,
            _ => fontdb::Family::Name(name),
        })
        .collect();
    if families.is_empty() {
        families.push(fontdb::Family::SansSerif);
    }
    db.query(&fontdb::Query {
        families: &families,
        weight: fontdb::Weight(weight),
        stretch: fontdb::Stretch::Normal,
        style: if italic {
            fontdb::Style::Italic
        } else {
            fontdb::Style::Normal
        },
    })
}

/// CSS `font-family` 列表：逗号分隔，名字可带单 / 双引号。
fn parse_family_list(list: &str) -> Vec<String> {
    list.split(',')
        .map(|name| name.trim().trim_matches(|c| c == '"' || c == '\'').trim())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn family_lists_drop_quotes_and_blanks() {
        assert_eq!(
            parse_family_list(r#""Fraunces", 'Space Grotesk' , serif,"#),
            vec!["Fraunces", "Space Grotesk", "serif"]
        );
    }

    /// 降级提示点名那个值、说明按 normal 画，并给出两条改法。
    #[test]
    fn unsupported_blend_modes_are_described() {
        let text = describe_warning("css-blend-unsupported:plus-lighter");
        for needle in [
            "plus-lighter",
            "normal",
            "screen",
            "blendMode",
            "cssBlendModes",
        ] {
            assert!(text.contains(needle), "缺 {needle}：{text}");
        }
    }

    /// 运行时的 `BLEND_MODES`（`bcut spec program` 的 `cssBlendModes`）与光栅器逐项对拍：
    /// 名单里的每个值 usvg 都解析成对应的混合模式，名单外的 `plus-lighter` / `plus-darker`
    /// 解析期被丢掉、按 normal 画——名单错了就会误报或漏报。
    #[test]
    fn program_blend_list_matches_what_usvg_parses() {
        fn blended(mode: &str) -> bool {
            let svg = format!(
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><g style="mix-blend-mode:{mode}"><rect width="4" height="4" fill="red"/></g></svg>"#
            );
            let tree = usvg::Tree::from_str(&svg, &usvg::Options::default()).unwrap();
            fn any(group: &usvg::Group) -> bool {
                group.blend_mode() != usvg::BlendMode::Normal
                    || group.children().iter().any(|node| match node {
                        usvg::Node::Group(group) => any(group),
                        _ => false,
                    })
            }
            any(tree.root())
        }
        let modes = bcut_compile::program::vocabulary::program_vocabulary().css_blend_modes;
        assert_eq!(modes.len(), 16, "{modes:?}");
        for mode in modes {
            assert_eq!(blended(mode), mode != "normal", "{mode}");
        }
        for mode in ["plus-lighter", "plus-darker", "Screen"] {
            assert!(!blended(mode), "{mode} 应当被 usvg 丢掉");
        }
    }

    /// 字体级 ascent / descent 取自选中的那张字面，按字号缩放、descent 取正；
    /// 找不到字族时是 `None`（运行时退回估算）。
    #[test]
    fn program_font_metrics_come_from_the_selected_face() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/fonts/Arimo.ttf");
        let data = std::fs::read(&path).unwrap();
        let face = rustybuzz::Face::from_slice(&data, 0).unwrap();
        let upem = f64::from(face.units_per_em());
        let (asc, desc) = (f64::from(face.ascender()), f64::from(face.descender()));
        let mut db = fontdb::Database::new();
        db.load_font_data(data.clone());
        let family = db.faces().next().unwrap().families[0].0.clone();
        let metrics = font_metrics(Arc::new(db));
        let (ascent, descent) = metrics(&family, 100.0, 400, false).expect("选得到字");
        assert!((ascent - asc * 100.0 / upem).abs() < 1e-9, "{ascent}");
        assert!((descent + desc * 100.0 / upem).abs() < 1e-9, "{descent}");
        assert!(ascent > 50.0 && descent > 5.0, "{ascent} {descent}");
        assert!(metrics("No Such Family", 100.0, 400, false).is_none());
    }

    #[test]
    fn sniffing_recognises_the_supported_formats() {
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n"), Some("image/png"));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff(b"GIF89a"), Some("image/gif"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff("\u{feff}<svg/>".as_bytes()), Some("image/svg+xml"));
        assert_eq!(sniff(b"hello"), None);
    }
}
