//! 文本引擎：cosmic-text shaping + 字形轮廓 → tiny-skia Path。
//! 实现 bcut-core 的 TextMeasure（布局度量）并为渲染提供字形路径。
//! 字形以矢量轮廓绘制，任意变换（camera zoom / pop scale）下不失真。

use cosmic_text::{
    Attrs, Buffer, CacheKey, Family, FontSystem, Metrics, Shaping, Stretch, Style, SubpixelBin,
    SwashCache, SwashContent, Weight, fontdb,
};
use scene_primitives::layout::{TextMeasure, TextMetricsLine};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::sync::OnceLock;
use swash::scale::Source;
use tiny_skia::{
    ColorU8, Paint, Path, PathBuilder, PathSegment, Pixmap, PremultipliedColorU8, Stroke, Transform,
};

static SYSTEM_FONT_DB: OnceLock<fontdb::Database> = OnceLock::new();

/// `style.fontStyle`（规范 §6.3）→ fontdb / cosmic-text 的 `Style`。
fn font_style(italic: bool) -> Style {
    if italic { Style::Italic } else { Style::Normal }
}

/// 进程内**只装一次**的系统字体库。首次调用要扫全机字体，实测约 0.5 s。
fn system_font_db() -> &'static fontdb::Database {
    SYSTEM_FONT_DB.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        db
    })
}

/// 预热系统字体库：把 [`system_font_db`] 的一次性装入提前到别处付掉。
///
/// 交互式宿主（App 的启动、serve 的预览端点）第一次渲染叠加层时会同步等这
/// 半秒——那正好是「打开项目后第一帧画面」的位置。提前在后台线程调用一次，
/// 之后的 [`TextEngine::with_system_and_fonts`] 只剩一次 `Database::clone`。
///
/// 幂等；与真正的首次使用并发调用也安全（`OnceLock` 保证只装一次，后到者等
/// 前者装完），所以最坏情况与不预热时一模一样，不会变慢。
pub fn warm_system_fonts() {
    let _ = system_font_db();
}

/// 一个字体 face 的名字：族名（所有语言的写法）与 PostScript 名。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FaceNames {
    pub families: Vec<String>,
    pub post_script_name: String,
}

impl FaceNames {
    /// 族名或 PostScript 名等于 `name`（族名不分大小写）。
    pub fn matches(&self, name: &str) -> bool {
        self.post_script_name == name
            || self
                .families
                .iter()
                .any(|family| family.eq_ignore_ascii_case(name))
    }
}

fn face_names(face: &fontdb::FaceInfo) -> FaceNames {
    FaceNames {
        families: face
            .families
            .iter()
            .map(|(family, _)| family.clone())
            .collect(),
        post_script_name: face.post_script_name.clone(),
    }
}

/// 一份字体文件字节里所有 face 的名字（远端导出 J4：按族名 / PostScript 名判断节点缺不缺
/// 这款字体）。认不出的字节给空表。
pub fn font_data_faces(data: Vec<u8>) -> Vec<FaceNames> {
    let mut db = fontdb::Database::new();
    db.load_font_data(data);
    db.faces().map(face_names).collect()
}

/// 系统字体库里族名或 PostScript 名等于 `name` 的 face 来自哪些文件（去重、排序）。
/// 内存里的字体不列——远端导出只按文件上传用到的系统字体。
pub fn system_font_files(name: &str) -> Vec<std::path::PathBuf> {
    let mut files = system_font_db()
        .faces()
        .filter(|face| face_names(face).matches(name))
        .filter_map(|face| match &face.source {
            // 系统字体按文件装入（`load_system_fonts` → `Source::File`）。
            fontdb::Source::File(path) => Some(path.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    files.sort();
    files.dedup();
    files
}

/// 系统字体库里有没有族名或 PostScript 名等于 `name` 的 face。
pub fn system_has_font(name: &str) -> bool {
    system_font_db()
        .faces()
        .any(|face| face_names(face).matches(name))
}

/// BaoCut 内置的 CJK 回退字体：思源黑体 Google 构建（可变字重）。
///
/// 默认构建只在这里 `include_bytes!`；`bcut_subtitle_render::bundled_studio_fonts()`
/// 的第一项转引这里，避免同一二进制内再复制 17 MB。App-only 的
/// `external-fonts` 构建改读已签名的共享资源目录。
///
/// 跟着 `media`（host 字节层）走：wasm 构建不打包它，浏览器预览的 CJK 由调用方
/// 从 JS 注入的文档字体承担（渲染真相以 `bcut render` 为准）。
#[cfg(feature = "media")]
pub fn cjk_fallback_font() -> &'static [u8] {
    #[cfg(feature = "external-fonts")]
    {
        external_bundled_font("NotoSansSC-Variable.ttf")
    }
    #[cfg(not(feature = "external-fonts"))]
    {
        include_bytes!("../assets/fonts/NotoSansSC-Variable.ttf")
    }
}

/// BaoCut 内置的展示字体（CJK 回退之外的 30 份：Poppins、Bangers、Permanent Marker……）。
///
/// `include_bytes!` 只在这里：Studio 字幕的整套内置字体
/// （`bcut_subtitle_render::bundled_studio_fonts()`，CJK 之后按这里的次序）与 BCF 文档渲染
/// （[`TextEngine::for_document`]）共用同一份字节。次序由内核字体表按下标对拍，只在末尾追加。
#[cfg(feature = "media")]
pub fn bundled_display_fonts() -> &'static [&'static [u8]] {
    macro_rules! bundled_font {
        ($name:literal) => {{
            #[cfg(feature = "external-fonts")]
            {
                external_bundled_font($name)
            }
            #[cfg(not(feature = "external-fonts"))]
            {
                include_bytes!(concat!("../assets/fonts/", $name)).as_slice()
            }
        }};
    }
    static FONTS: OnceLock<Vec<&'static [u8]>> = OnceLock::new();
    FONTS.get_or_init(|| {
        vec![
            bundled_font!("Montserrat.ttf"),
            bundled_font!("Arimo.ttf"),
            bundled_font!("Poppins-Regular.ttf"),
            bundled_font!("Poppins-Medium.ttf"),
            bundled_font!("Poppins-SemiBold.ttf"),
            bundled_font!("Poppins-ExtraBold.ttf"),
            bundled_font!("Anton-Regular.ttf"),
            bundled_font!("SquadaOne-Regular.ttf"),
            bundled_font!("Shrikhand-Regular.ttf"),
            bundled_font!("Rubik.ttf"),
            bundled_font!("BebasNeue-Regular.ttf"),
            bundled_font!("LexendDeca.ttf"),
            bundled_font!("SourceSerif4.ttf"),
            bundled_font!("Alata-Regular.ttf"),
            bundled_font!("ArchivoBlack-Regular.ttf"),
            bundled_font!("Bangers-Regular.ttf"),
            bundled_font!("CarterOne-Regular.ttf"),
            bundled_font!("DancingScript.ttf"),
            bundled_font!("FredokaOne-Regular.ttf"),
            bundled_font!("PaytoneOne-Regular.ttf"),
            bundled_font!("PermanentMarker-Regular.ttf"),
            bundled_font!("PressStart2P-Regular.ttf"),
            bundled_font!("VKSans-400.ttf"),
            bundled_font!("VKSans-500.ttf"),
            bundled_font!("VKSans-600.ttf"),
            bundled_font!("VKSans-700.ttf"),
            bundled_font!("VKSans-800.ttf"),
            bundled_font!("VKCode-400.ttf"),
            bundled_font!("VKCode-500.ttf"),
            bundled_font!("VKCode-600.ttf"),
            bundled_font!("VKCode-700.ttf"),
            bundled_font!("Inter-Medium.ttf"),
            bundled_font!("Poppins-Black.ttf"),
            bundled_font!("RobotoMono-Medium.ttf"),
            bundled_font!("PlayfairDisplay-Italic.ttf"),
            bundled_font!("Oswald-Bold.ttf"),
            bundled_font!("PlayfairDisplay-Regular.ttf"),
        ]
    })
}

/// App-only release mode: all three signed executables read the same sealed
/// `Contents/Resources/fonts` tree instead of embedding 25 MB three times.
#[cfg(feature = "external-fonts")]
pub fn external_bundled_font(name: &str) -> &'static [u8] {
    static FONTS: OnceLock<HashMap<String, Vec<u8>>> = OnceLock::new();
    let fonts = FONTS.get_or_init(|| {
        let executable = crate::exec::current_exe()
            .expect("bundled font lookup requires the current executable");
        let directory = app_fonts_dir(&executable)
            .expect("external-fonts requires a BaoCut.app/Contents/MacOS executable");
        load_external_fonts_at(&directory)
    });
    fonts
        .get(name)
        .unwrap_or_else(|| panic!("bundled font {name} is missing from the signed App"))
        .as_slice()
}

#[cfg(feature = "external-fonts")]
fn app_fonts_dir(executable: &std::path::Path) -> Option<std::path::PathBuf> {
    let macos = executable.parent()?;
    (macos.file_name()? == "MacOS").then_some(())?;
    let contents = macos.parent()?;
    (contents.file_name()? == "Contents").then_some(())?;
    (contents.parent()?.extension()? == "app").then_some(())?;
    Some(contents.join("Resources/fonts"))
}

#[cfg(feature = "external-fonts")]
fn load_external_fonts_at(directory: &std::path::Path) -> HashMap<String, Vec<u8>> {
    let entries = std::fs::read_dir(directory).unwrap_or_else(|error| {
        panic!(
            "cannot read bundled fonts at {}: {error}",
            directory.display()
        )
    });
    let fonts: HashMap<String, Vec<u8>> = entries
        .map(|entry| entry.expect("cannot read bundled font entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "ttf"))
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let bytes = std::fs::read(&path).unwrap_or_else(|error| {
                panic!("cannot read bundled font {}: {error}", path.display())
            });
            (name, bytes)
        })
        .collect();
    assert!(
        !fonts.is_empty(),
        "no TTF fonts in signed App at {}",
        directory.display()
    );
    fonts
}

/// 内置 CJK 字体的 family 名，也是 [`TextEngine`] 解析回退族时的首选。
pub const BUNDLED_CJK_FAMILY: &str = "Noto Sans SC";

/// 把内置 CJK 字体挂进 fontdb。零拷贝：`Source::Binary` 收的是 `Arc<dyn AsRef<[u8]>>`，
/// 这里包的是 `&'static [u8]`，因此每个 `TextEngine`（逐帧渲染是每个 worker 线程
/// 一个）只多一个 Arc，不是多一份 17 MB。
fn load_bundled_cjk_font(db: &mut fontdb::Database) {
    #[cfg(feature = "media")]
    {
        db.load_font_source(fontdb::Source::Binary(Arc::new(cjk_fallback_font())));
    }
    #[cfg(not(feature = "media"))]
    {
        let _ = db;
    }
}

/// CJK 回退链的候选次序。内置字体排第一（各机器一致），其后按平台列出系统
/// 自带的常规黑体，再往后是覆盖面更广、用来兜生僻字的那几款。
///
/// 这是一张**固定次序**的表，既不随字重变、也不随字符变——本模块要守的不变量
/// 正是这个：同一份文档在同一台机器上、任何字重下，都必须挑到同一串 face。
const CJK_FALLBACKS: &[&str] = &[
    BUNDLED_CJK_FAMILY,
    // macOS
    "PingFang SC",
    "Hiragino Sans GB",
    "Heiti SC",
    "Songti SC",
    // Windows
    "Microsoft YaHei",
    "SimHei",
    "SimSun",
    // Linux / 通用
    "Noto Sans CJK SC",
    "Source Han Sans SC",
    "WenQuanYi Micro Hei",
];

fn family_in_db(db: &fontdb::Database, family: &str) -> bool {
    db.query(&fontdb::Query {
        families: &[Family::Name(family)],
        weight: Weight::NORMAL,
        stretch: Stretch::Normal,
        style: Style::Normal,
    })
    .is_some()
}

/// 本引擎实际可用的 CJK 回退链（[`CJK_FALLBACKS`] 里这个库真装得到的那些）。
///
/// 为什么是「链」而不是一个族：一个族总有它排不出的字。过去这里只解析出一个族，
/// 该族缺字时就把这个字交回 cosmic-text 逐字形自己找——而它找的结果**跟着字重
/// 变**：实测同一句「名字里有个𠮷字」，weight 400 时那个「𠮷」落 PingFang SC，
/// weight 700 时落 YuKyokasho Yoko（日文教科书体）。一行里于是混进一两个明显
/// 不同款的字，而且换个字重、换台机器就换一种混法。
///
/// 链由我们自己按固定次序查完，cosmic-text 只剩「整条链都没有」这一种兜底。
fn resolve_cjk_chain(db: &fontdb::Database) -> Vec<String> {
    CJK_FALLBACKS
        .iter()
        .filter(|family| family_in_db(db, family))
        .map(|family| (*family).to_owned())
        .collect()
}

/// 缺省无衬线族的**具体名字**。
///
/// `Family::SansSerif` 是个待解析的意向，cosmic-text 每次带着字重去解析它，
/// 结果并不稳定：实测同一台 macOS 上，weight 400 / 700 解析到 Arial，而
/// 500 / 600 / 650 / 750 / 800 / 900 解析到 System Font。于是一页里 700 的标题
/// 和 650 的小标题落在两款完全不同的拉丁字体上。这里在装配时解析**一次**，
/// 之后所有字重都用这个名字，字重只管字重。
fn resolve_sans_family(db: &fontdb::Database) -> Option<String> {
    let name = db.family_name(&Family::SansSerif).to_owned();
    family_in_db(db, &name).then_some(name)
}

/// 排版用的字符分类。
#[derive(Clone, Copy, PartialEq, Eq)]
enum Script {
    Cjk,
    /// 两边都用得上的标点：跟着邻居走，自己不挑字体（见 [`resolve_scripts`]）。
    Neutral,
    Other,
}

/// 中文正文里常见、但 Unicode 上不属于 CJK 区段的标点。
///
/// 弯引号、破折号、省略号、间隔号在中文里随处可见，而拉丁族**也有**这些字形，
/// 于是按覆盖率挑字体时它们会稳稳留在拉丁族里：一句「他说“这段时间很关键”
/// ——真的吗……」的汉字是思源黑体，引号、破折号和省略号却是 Arial，宽度和
/// 笔形都和左右对不上。它们不该自己挑，该跟着旁边的正文走。
fn is_neutral_punctuation(character: char) -> bool {
    matches!(
        character,
        '‘' | '’' | '“' | '”' | '—' | '―' | '…' | '·' | '‧'
    )
}

fn script_of(character: char) -> Script {
    if is_cjk_character(character) {
        Script::Cjk
    } else if is_neutral_punctuation(character) {
        Script::Neutral
    } else {
        Script::Other
    }
}

/// 逐字定类，并把中性标点并进相邻的 CJK 段。
///
/// 规则与 UAX #24 的 common script 解析同一个意思：中性字符没有自己的字体意见，
/// 前后哪边是汉字就算哪边的。两边都不是汉字（一句英文里的引号）就保持原样，
/// 仍按覆盖率挑字体——所以纯拉丁文本的排版一个字节都不会变。
fn resolve_scripts(text: &str) -> Vec<Script> {
    let mut scripts = text.chars().map(script_of).collect::<Vec<_>>();
    for index in 0..scripts.len() {
        if scripts[index] != Script::Neutral {
            continue;
        }
        let before = scripts[..index]
            .iter()
            .rev()
            .find(|script| **script != Script::Neutral);
        let after = scripts[index + 1..]
            .iter()
            .find(|script| **script != Script::Neutral);
        if before == Some(&Script::Cjk) || after == Some(&Script::Cjk) {
            scripts[index] = Script::Cjk;
        }
    }
    scripts
}

/// `COLR` 表 tag。`swash::Tag` 就是 `u32`，无需额外导入即可 const 求值。
const COLR_TAG: swash::Tag = u32::from_be_bytes(*b"COLR");

/// 可变字体的字重轴 tag。
const WGHT_TAG: swash::Tag = u32::from_be_bytes(*b"wght");

#[derive(Debug, Clone)]
pub struct ShapedGlyph {
    pub cache_key: CacheKey,
    /// 相对行起点的 x（px）
    pub x: f64,
    /// 相对基线的 y 偏移（px，通常 0）
    pub y: f64,
    /// 源串的 UTF-8 字节区间（cosmic-text `LayoutGlyph.start..end`）。
    ///
    /// 只给文字 part 映射用（设计 §5.6）：`ShapedGlyph` 不进 DrawOp 编码，
    /// 也不进 `ShapeKey` 缓存键，所以加这个字段对既有 golden 是**零像素影响**。
    /// 连字会让一个字形跨越 part 边界，归属规则是取 `cluster.start` 所在的 part。
    pub cluster: std::ops::Range<usize>,
}

#[derive(Debug, Clone, Default)]
pub struct ShapedLine {
    pub width: f64,
    pub ascent: f64,
    pub descent: f64,
    pub glyphs: Vec<ShapedGlyph>,
}

/// 一个字形的可绘制形态。
///
/// 绝大多数字形是矢量轮廓；彩色字体则必须走彩色通道，且不同平台的承载表不同：
/// macOS `Apple Color Emoji` 用 `sbix` 位图（`glyf` 只留退化占位轮廓：孤立
/// MoveTo + Close），Windows `Segoe UI Emoji` 用 `COLR`/`CPAL` 分层轮廓——按
/// COLR 规范，它的**基字形自带非空单色回退轮廓**。因此「轮廓无填充面积」不是
/// 彩色字形的判据，只能按 face 的彩色能力分流（见 [`TextEngine::glyph_render`]）。
#[derive(Debug, Clone)]
pub enum GlyphRender {
    /// 常规矢量轮廓：任意变换（camera zoom / pop scale）下不失真。
    Outline(Path),
    /// 彩色字形的光栅结果（`sbix`/`CBDT` 位图，或 `COLR` 分层轮廓的合成）。
    /// `left` / `top` 是 swash placement：位图左上角相对字形原点的偏移，
    /// `top` 以 y 向上为正，因此绘制时是 `translate(left, -top)`。
    ///
    /// 已知局限：位图是固定像素分辨率，随 group_transform 放大会重采样偏软；
    /// 与轮廓字形不同，它无法参与描边。
    ColorBitmap {
        width: u32,
        height: u32,
        rgba: Arc<[u8]>,
        left: i32,
        top: i32,
    },
    /// 空白字形（空格）或既无可填充轮廓也无彩色位图。
    Empty,
}

/// swash 在离散字号档产出的 atlas alpha mask。`key` 只在当前进程的字体系统内
/// 标识 face/glyph/字号/次像素档，不进入持久格式或 DrawOp 指纹。
#[derive(Debug, Clone)]
pub struct GlyphMaskImage {
    pub key: [u64; 2],
    pub width: u32,
    pub height: u32,
    pub left: i32,
    pub top: i32,
    pub alpha: Arc<[u8]>,
}

/// swash 在离散字号档产出的预乘 RGBA 彩色字形。与 [`GlyphMaskImage`]
/// 共用同一进程内 key 口径，但像素是逐行紧排的 RGBA8。
#[derive(Debug, Clone)]
pub struct GlyphColorImage {
    pub key: [u64; 2],
    pub width: u32,
    pub height: u32,
    pub left: i32,
    pub top: i32,
    pub rgba: Arc<[u8]>,
}

/// glyph atlas 生产结果。普通轮廓为 alpha mask，彩色字形保留预乘
/// RGBA；执行器不得把后者降格成字色剪影。
#[derive(Debug, Clone)]
pub enum GlyphAtlasRender {
    Mask(GlyphMaskImage),
    Color(GlyphColorImage),
    Empty,
    Unsupported,
}

/// 缓存里的彩色位图字形。
#[derive(Debug, Clone)]
struct ColorGlyph {
    width: u32,
    height: u32,
    rgba: Arc<[u8]>,
    left: i32,
    top: i32,
}

#[derive(Debug, Clone)]
enum CachedGlyphMask {
    Mask(GlyphMaskImage),
    Empty,
    Unsupported,
}

/// 轮廓是否真能填出像素。彩色 emoji 的占位轮廓只有 MoveTo/Close，
/// `get_outline_commands` 仍返回 `Some`，所以不能只判 `None`。
fn path_has_area(path: &Path) -> bool {
    path.segments().any(|segment| {
        matches!(
            segment,
            PathSegment::LineTo(_) | PathSegment::QuadTo(_, _) | PathSegment::CubicTo(_, _, _)
        )
    })
}

#[derive(Clone, Hash, PartialEq, Eq)]
struct ShapeKey {
    text: String,
    family: String,
    size_bits: u64,
    weight: u16,
    italic: bool,
    spacing_bits: u64,
    rich: Vec<RichShapeSpan>,
}

#[derive(Clone, Hash, PartialEq, Eq)]
struct RichShapeSpan {
    start: usize,
    end: usize,
    family: String,
    size_bits: u64,
    weight: u16,
    italic: bool,
    spacing_bits: u64,
}

// ── 缓存限容 ────────────────────────────────────────────────────────────
//
// 既有四个缓存原来都是无上限 `HashMap`；R2 又增加 atlas mask：长视频 / 多字体
// 导出里 shaping、轮廓、彩色位图与 mask 都必须限容。预算模型抄
// `core/crates/bcut-kernel/src/cmd/studio_export/render_plan.rs`
// 的帧缓存（128MB VecDeque 预算）：按**估算字节**限容，超预算按最近最少使用
// 淘汰。淘汰只影响性能不影响正确性——五个缓存的取值都是「重算即得」的确定性
// 结果，且全部按值返回（大像素块由 Arc 共享），没有调用方持有指向条目的借用。
//
// 预算取值（五者合计 ≈ 105MiB，仍低于帧缓存的 128MB）：

/// 单行 shaping 结果。一条字幕行约 1KB（20 个 `ShapedGlyph` + 文本），
/// 16MiB ≈ 一万多条不同的行/字号组合。
const SHAPE_CACHE_BUDGET: usize = 16 << 20;
/// 字形轮廓（含 swash 影子，见 [`HeapBytes for Path`](HeapBytes)）。CJK 字形约
/// 2–3KB，24MiB ≈ 一万个「字形 × 字号 × 次像素相位」组合。
const PATH_CACHE_BUDGET: usize = 24 << 20;
/// 彩色位图字形。emoji 在 64px 上约 25KB，32MiB ≈ 一千三百个。
const BITMAP_CACHE_BUDGET: usize = 32 << 20;
/// GPU atlas 的 8-bit mask 源。常规 64px 字形约 4KB，32MiB 足以覆盖数千个
/// `glyph × size × subpixel-bin`；atlas 自己另有固定显存预算。
const MASK_CACHE_BUDGET: usize = 32 << 20;
/// 描边字形的 8-bit mask 源。它与普通 mask 分开限容：打开描边不能挤掉正文
/// atlas 热集，也不能借正文预算让宿主侧驻留悄悄翻倍而不记账。
const STROKE_MASK_CACHE_BUDGET: usize = 32 << 20;
/// per-face 彩色能力门。条目只有 `ID + bool`，预算实际由 fontdb 的 face 数封顶；
/// 1MiB ≈ 两万个 face，纯粹是防御性上限。
const COLOR_FACE_CACHE_BUDGET: usize = 1 << 20;

/// 每条 HashMap 条目的容器开销估算（hashbrown 的控制字节 + 装载因子留白）。
/// 只是数量级估算：小条目（`color_face_cache`）不至于被算成零成本。
const CACHE_ENTRY_OVERHEAD: usize = 32;

/// 缓存条目的堆字节估算。不要求精确，但必须与真实占用同数量级——否则预算是摆设。
trait HeapBytes {
    fn heap_bytes(&self) -> usize;
}

impl HeapBytes for ShapeKey {
    fn heap_bytes(&self) -> usize {
        self.text.capacity()
            + self.family.capacity()
            + self.rich.capacity() * std::mem::size_of::<RichShapeSpan>()
            + self
                .rich
                .iter()
                .map(|span| span.family.capacity())
                .sum::<usize>()
    }
}

impl HeapBytes for CacheKey {
    fn heap_bytes(&self) -> usize {
        0 // 全是标量字段
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct StrokeMaskKey {
    glyph: CacheKey,
    width_64: u32,
}

impl HeapBytes for StrokeMaskKey {
    fn heap_bytes(&self) -> usize {
        0
    }
}

impl HeapBytes for fontdb::ID {
    fn heap_bytes(&self) -> usize {
        0
    }
}

impl HeapBytes for bool {
    fn heap_bytes(&self) -> usize {
        0
    }
}

impl HeapBytes for ShapedLine {
    fn heap_bytes(&self) -> usize {
        self.glyphs.capacity() * std::mem::size_of::<ShapedGlyph>()
    }
}

impl HeapBytes for Path {
    /// tiny-skia 这一份之外，`swash` 的 `outline_command_cache` 里还留着同一个
    /// 字形的 `Box<[zeno::Command]>` 影子（每个 verb 一条 Command，比 tiny-skia
    /// 侧的「1 字节 verb + 8 字节 point」大数倍）。两份同生共死——
    /// [`TextEngine::glyph_path`] 淘汰轮廓时一并删影子——所以按一条条目合并计。
    fn heap_bytes(&self) -> usize {
        std::mem::size_of_val(self.verbs())
            + std::mem::size_of_val(self.points())
            + self.verbs().len() * std::mem::size_of::<swash::zeno::Command>()
    }
}

impl HeapBytes for ColorGlyph {
    fn heap_bytes(&self) -> usize {
        self.rgba.len()
    }
}

impl HeapBytes for GlyphMaskImage {
    fn heap_bytes(&self) -> usize {
        self.alpha.len()
    }
}

impl HeapBytes for CachedGlyphMask {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Mask(mask) => mask.heap_bytes(),
            Self::Empty | Self::Unsupported => 0,
        }
    }
}

impl<T: HeapBytes> HeapBytes for Option<T> {
    fn heap_bytes(&self) -> usize {
        self.as_ref().map_or(0, HeapBytes::heap_bytes)
    }
}

#[cfg(test)]
impl HeapBytes for u32 {
    fn heap_bytes(&self) -> usize {
        0
    }
}

#[cfg(test)]
impl HeapBytes for Vec<u8> {
    fn heap_bytes(&self) -> usize {
        self.capacity()
    }
}

struct CacheEntry<V> {
    value: V,
    bytes: usize,
    /// 最后一次命中的逻辑时刻。用单调计数而不是墙钟：渲染路径上的任何取值都
    /// 不许依赖时间。
    used: u64,
}

/// 按字节预算限容的 LRU 缓存。
struct BudgetCache<K, V> {
    entries: HashMap<K, CacheEntry<V>>,
    budget: usize,
    bytes: usize,
    clock: u64,
}

impl<K: Clone + std::hash::Hash + Eq + HeapBytes, V: HeapBytes> BudgetCache<K, V> {
    fn new(budget: usize) -> Self {
        BudgetCache {
            entries: HashMap::new(),
            budget,
            bytes: 0,
            clock: 0,
        }
    }

    fn get(&mut self, key: &K) -> Option<&V> {
        self.clock += 1;
        let clock = self.clock;
        let entry = self.entries.get_mut(key)?;
        entry.used = clock;
        Some(&entry.value)
    }

    /// 插入并按预算淘汰，返回被淘汰的键——调用方据此清理挂在同一个键上的
    /// 影子缓存（当前只有 `swash.outline_command_cache`）。
    fn insert(&mut self, key: K, value: V) -> Vec<K> {
        self.clock += 1;
        let bytes = CACHE_ENTRY_OVERHEAD
            + std::mem::size_of::<K>()
            + key.heap_bytes()
            + std::mem::size_of::<CacheEntry<V>>()
            + value.heap_bytes();
        let entry = CacheEntry {
            value,
            bytes,
            used: self.clock,
        };
        if let Some(old) = self.entries.insert(key, entry) {
            self.bytes -= old.bytes;
        }
        self.bytes += bytes;
        if self.bytes > self.budget {
            self.evict()
        } else {
            Vec::new()
        }
    }

    /// 超预算时按 LRU 淘汰到预算的 3/4。留出水位差是为了摊薄排序开销：否则每
    /// 插入一条就要把整张表排一次序。单条就超预算时保留它（重算它同样超预算，
    /// 踢掉只会次次未命中）。
    fn evict(&mut self) -> Vec<K> {
        if self.entries.len() <= 1 {
            return Vec::new();
        }
        let low_water = self.budget / 4 * 3;
        let mut order = self
            .entries
            .iter()
            .map(|(key, entry)| (entry.used, key.clone()))
            .collect::<Vec<_>>();
        // `used` 由单调计数产生，互不相等 ⇒ 排序结果唯一，淘汰是确定性的。
        order.sort_unstable_by_key(|(used, _)| *used);
        let mut evicted = Vec::new();
        for (_, key) in order {
            if self.bytes <= low_water || self.entries.len() <= 1 {
                break;
            }
            if let Some(entry) = self.entries.remove(&key) {
                self.bytes -= entry.bytes;
                evicted.push(key);
            }
        }
        evicted
    }
}

/// 排字时点了名的 face：族名、字重与是否斜体（[`TextEngine::set_face_log`]）。
pub type FaceUse = (String, u16, bool);

/// 几台排版引擎共用的 face 记录：宿主按它去找本机字体里的那一个 face（与排版同一套匹配）。
pub type FaceLog = Arc<std::sync::Mutex<Vec<FaceUse>>>;

pub struct TextEngine {
    pub font_system: FontSystem,
    swash: SwashCache,
    shape_cache: BudgetCache<ShapeKey, ShapedLine>,
    path_cache: BudgetCache<CacheKey, Option<Path>>,
    /// 彩色位图字形缓存。逐帧热路径上不能每帧重跑 premultiply + Pixmap 分配。
    bitmap_cache: BudgetCache<CacheKey, Option<ColorGlyph>>,
    /// 离散字号 glyph atlas 的 alpha 源；命中时不再调用 swash 光栅器。
    mask_cache: BudgetCache<CacheKey, CachedGlyphMask>,
    /// 同一离散字号下按 1/64px 线宽分档的居中描边 mask。生产一次后与正文
    /// mask 一样进入 compositor atlas，不在字幕入场/逐词动画期间重算。
    stroke_mask_cache: BudgetCache<StrokeMaskKey, CachedGlyphMask>,
    /// per-face 彩色能力门。单色字体绝不能为每个字形多跑一次光栅化。
    color_face_cache: BudgetCache<fontdb::ID, bool>,
    /// 文档字体 strict 模式：fontdb 只含文档声明的字体，无系统回退（§8.4 确定性）
    pub strict: bool,
    /// 本引擎排 CJK 用的回退链，装配时从 fontdb 里**查**出来
    /// （[`resolve_cjk_chain`]），不是写死的名字。空 = 这个库里一个 CJK 族都没有。
    cjk_chain: Vec<String>,
    /// 缺省无衬线族解析出的具体名字（[`resolve_sans_family`]）。
    sans_family: Option<String>,
    /// 排字时点了名、库里却没有的族（落到了回退字体上）。宿主按它去找字体文件、报缺字体。
    missing_families: std::collections::BTreeSet<String>,
    /// 族在不在库里的记忆：排字是热路径，不每次都查 fontdb。
    family_present: HashMap<String, bool>,
    /// 排字时点了名的 face 记到这里（宿主装上；没装时不记）。
    face_log: Option<FaceLog>,
}

impl TextEngine {
    /// 系统字体 ＋ 内置 CJK 回退。
    ///
    /// 内置字体必须在这里就挂上：BCF 渲染（`bcut render`）走的就是这条路，
    /// 而它过去只有一个纯系统 fontdb——中文因此逐字形散落到机器上碰巧装了的
    /// 字体里（见 [`resolve_cjk_family`]）。
    pub fn new() -> Self {
        let mut db = system_font_db().clone();
        load_bundled_cjk_font(&mut db);
        Self::with_font_system(
            FontSystem::new_with_locale_and_db("en-US".to_owned(), db),
            false,
        )
    }

    /// 三个公共构造器的共同尾巴：装好五个限容缓存。
    fn with_font_system(font_system: FontSystem, strict: bool) -> Self {
        let cjk_chain = resolve_cjk_chain(font_system.db());
        let sans_family = resolve_sans_family(font_system.db());
        TextEngine {
            font_system,
            swash: SwashCache::new(),
            shape_cache: BudgetCache::new(SHAPE_CACHE_BUDGET),
            path_cache: BudgetCache::new(PATH_CACHE_BUDGET),
            bitmap_cache: BudgetCache::new(BITMAP_CACHE_BUDGET),
            mask_cache: BudgetCache::new(MASK_CACHE_BUDGET),
            stroke_mask_cache: BudgetCache::new(STROKE_MASK_CACHE_BUDGET),
            color_face_cache: BudgetCache::new(COLOR_FACE_CACHE_BUDGET),
            strict,
            cjk_chain,
            sans_family,
            missing_families: Default::default(),
            family_present: HashMap::new(),
            face_log: None,
        }
    }

    /// 文档字体资产（assets type:"font"）注入。非空 ⇒ strict：fontdb 只装打包字体、
    /// locale 固定，任何机器上度量逐位一致（opencat engine_font_db_with_document_fonts 模式）。
    pub fn with_document_fonts(fonts: &[Vec<u8>]) -> Self {
        let shared: Vec<Arc<Vec<u8>>> = fonts.iter().map(|bytes| Arc::new(bytes.clone())).collect();
        Self::with_shared_document_fonts(&shared)
    }

    /// [`Self::with_document_fonts`]，字体字节共享：同一批字体建几台引擎都只占一份内存（大的字体集合动辄几十 MB）。
    pub fn with_shared_document_fonts(fonts: &[Arc<Vec<u8>>]) -> Self {
        if fonts.is_empty() {
            return Self::new();
        }
        let mut db = cosmic_text::fontdb::Database::new();
        for bytes in fonts {
            db.load_font_source(fontdb::Source::Binary(bytes.clone()));
        }
        // 缺省无衬线族 → 首个**文档**字体（family 未命中时的确定性回退）。
        // 必须在挂内置 CJK 之前取，否则这一位会被回退字体顶掉。
        let first_family = db
            .faces()
            .next()
            .and_then(|f| f.families.first().map(|(name, _)| name.clone()));
        if let Some(fam) = first_family {
            db.set_sans_serif_family(fam);
        }
        // 内置 CJK 回退也进 strict 库：它是**固定字节**，逐位可复现，不破坏
        // §8.4 的确定性（被禁的是「机器上碰巧装了什么」）。没有它的话，一份
        // 声明了拉丁展示字体的 BCF 一写中文就只能出豆腐块。
        load_bundled_cjk_font(&mut db);
        Self::with_font_system(
            FontSystem::new_with_locale_and_db("en-US".to_string(), db),
            true,
        )
    }

    /// BCF 文档渲染：[`Self::with_document_fonts`] 之上，BaoCut 内置的展示字体族
    /// （[`bundled_display_fonts`]）按名字恒定可用，文档不声明 `font` 资产也能写
    /// `font: "Permanent Marker"`。和内置 CJK 一样是固定字节，strict 模式的逐位一致不受
    /// 影响；装在文档字体 / 系统字体之后，同名时先装入的那一份胜出。缺省无衬线族与
    /// CJK 回退链不变。字幕的注入字体入口仍走 [`Self::with_document_fonts`]，不带这一套。
    pub fn for_document(fonts: &[Vec<u8>]) -> Self {
        #[allow(unused_mut)]
        let mut engine = Self::with_document_fonts(fonts);
        #[cfg(feature = "media")]
        for bytes in bundled_display_fonts() {
            engine
                .font_system
                .db_mut()
                .load_font_source(fontdb::Source::Binary(Arc::new(*bytes)));
        }
        engine
    }

    /// Host 字体 + App/用户字体。与 BCF 文档字体的 strict 模式不同，产品字幕
    /// 可以明确选择当前机器安装的字体，也可以从 BaoCut 字体库注入用户导入的
    /// 字体；打包字体仍覆盖缺省无衬线 fallback，避免未知字体落到平台随机默认值。
    pub fn with_system_and_fonts(fonts: &[Vec<u8>]) -> Self {
        let db = system_font_db().clone();
        Self::with_font_db_and_fonts(db, fonts)
    }

    fn with_font_db_and_fonts(mut db: fontdb::Database, fonts: &[Vec<u8>]) -> Self {
        // 内置 CJK 回退当作「系统字体」挂在最前面：它和真正的系统 face 一样
        // 要接受下面那轮 shadow——用户导入了自己的 Noto Sans SC 时，摘掉的
        // 必须也包括这一份，否则先装入者（内置）会赢过用户明确选择的副本。
        load_bundled_cjk_font(&mut db);
        // App/BaoCut 管理的字体必须盖过同名字体：FontLibrary 允许用户导入
        // 系统已有 family，并明确把导入副本作为选择结果。fontdb 对同权重候选
        // 使用先装入者，因此先移除冲突的 system face，再装入受管字体。
        let mut managed = fontdb::Database::new();
        for bytes in fonts {
            managed.load_font_data(bytes.clone());
        }
        let managed_families = managed
            .faces()
            .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
            .collect::<HashSet<_>>();
        let shadowed_system_faces = db
            .faces()
            .filter(|face| {
                face.families
                    .iter()
                    .any(|(name, _)| managed_families.contains(name))
            })
            .map(|face| face.id)
            .collect::<Vec<_>>();
        for id in shadowed_system_faces {
            db.remove_face(id);
        }
        for bytes in fonts {
            db.load_font_data(bytes.clone());
        }
        if db
            .query(&fontdb::Query {
                families: &[Family::Name(BUNDLED_CJK_FAMILY)],
                weight: Weight::NORMAL,
                stretch: Stretch::Normal,
                style: Style::Normal,
            })
            .is_some()
        {
            db.set_sans_serif_family(BUNDLED_CJK_FAMILY);
        }
        Self::with_font_system(
            FontSystem::new_with_locale_and_db("en-US".to_string(), db),
            false,
        )
    }

    /// 查询一个具名字体族是否真的存在。产品导出用它在 shaping 前报告缺失，
    /// 避免字体引擎的确定性 sans fallback 把错误伪装成成功。
    pub fn has_family(&self, family: &str) -> bool {
        if family.is_empty() {
            return true;
        }
        self.font_system
            .db()
            .query(&fontdb::Query {
                families: &[Family::Name(family)],
                weight: Weight::NORMAL,
                stretch: Stretch::Normal,
                style: Style::Normal,
            })
            .is_some()
    }

    /// 装上 face 记录：之后排字时点了名的族连同字重与斜体记进去（去重）。几台引擎可以共用一份。
    pub fn set_face_log(&mut self, log: Option<FaceLog>) {
        self.face_log = log;
    }

    /// 记下排字时点了名的族：库里没有就进 [`Self::take_missing_families`]；装了 face 记录时连同字重与斜体记进去。
    /// 只在真正排字时记，按候选链试探的 [`Self::has_family`] 不算。空族名是缺省无衬线族，不算。
    fn note_family(&mut self, family: &str, weight: u16, italic: bool) {
        if family.is_empty() {
            return;
        }
        if let Some(log) = &self.face_log {
            let mut log = log.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if !log
                .iter()
                .any(|(f, w, i)| f == family && *w == weight && *i == italic)
            {
                log.push((family.to_owned(), weight, italic));
            }
        }
        let present = match self.family_present.get(family) {
            Some(present) => *present,
            None => {
                let present = self.has_family(family);
                self.family_present.insert(family.to_owned(), present);
                present
            }
        };
        if !present && !self.missing_families.contains(family) {
            self.missing_families.insert(family.to_owned());
        }
    }

    /// 上次取走以来排字时点了名、库里却没有的族（按名字排序）。
    pub fn take_missing_families(&mut self) -> Vec<String> {
        std::mem::take(&mut self.missing_families)
            .into_iter()
            .collect()
    }

    /// 单行 shaping（无折行；与原型 CTLine 语义一致）。family 空 = 缺省无衬线族。
    pub fn shape(&mut self, text: &str, family: &str, font_size: f64, weight: u16) -> ShapedLine {
        self.shape_styled(text, family, font_size, weight, false)
    }

    /// [`TextEngine::shape`] 加 `fontStyle`（规范 §6.3）：`italic` 时按 CSS 规则在族内
    /// 挑斜体 face（fontdb `Style::Italic`，没有真斜体时 fontdb 退到 Oblique，再退正体
    /// ——不做人工倾斜，字形来源必须是确定的）。
    pub fn shape_styled(
        &mut self,
        text: &str,
        family: &str,
        font_size: f64,
        weight: u16,
        italic: bool,
    ) -> ShapedLine {
        self.shape_spaced(text, family, font_size, weight, italic, 0.0)
    }

    pub fn shape_spaced(
        &mut self,
        text: &str,
        family: &str,
        font_size: f64,
        weight: u16,
        italic: bool,
        spacing: f64,
    ) -> ShapedLine {
        self.note_family(family, weight, italic);
        let key = ShapeKey {
            text: text.to_string(),
            family: family.to_string(),
            size_bits: font_size.to_bits(),
            weight,
            italic,
            spacing_bits: spacing.to_bits(),
            rich: Vec::new(),
        };
        if let Some(s) = self.shape_cache.get(&key) {
            return s.clone();
        }
        let line = self.shape_uncached(text, family, font_size, weight, italic, spacing);
        self.shape_cache.insert(key, line.clone());
        line
    }

    /// Shape one final line with attributed font spans. Colour remains a paint
    /// attribute, so it cannot split a kerning pair or ligature during shaping.
    pub fn shape_rich(
        &mut self,
        text: &str,
        range: std::ops::Range<usize>,
        base: scene_primitives::text_layout::FontStyle<'_>,
        runs: &[scene_primitives::text_layout::Run],
    ) -> ShapedLine {
        if runs.is_empty() {
            let mut out = self.shape_spaced(
                &text[range.clone()],
                base.family,
                base.size,
                base.weight,
                base.italic,
                base.spacing,
            );
            for glyph in &mut out.glyphs {
                glyph.cluster.start += range.start;
                glyph.cluster.end += range.start;
            }
            return out;
        }
        let mut spans = Vec::new();
        for (part, font) in scene_primitives::text_layout::font_runs(base, runs, range.clone()) {
            self.note_family(font.family, font.weight, font.italic);
            for (family, weight, subrange) in
                self.plan_runs(&text[part.clone()], font.family, font.weight, font.italic)
            {
                spans.push(RichShapeSpan {
                    start: part.start + subrange.start - range.start,
                    end: part.start + subrange.end - range.start,
                    family,
                    size_bits: font.size.to_bits(),
                    weight,
                    italic: font.italic,
                    spacing_bits: font.spacing.to_bits(),
                });
            }
        }
        let key = ShapeKey {
            text: text[range.clone()].to_owned(),
            family: String::new(),
            size_bits: 0,
            weight: 0,
            italic: false,
            spacing_bits: 0,
            rich: spans,
        };
        let mut out = if let Some(hit) = self.shape_cache.get(&key) {
            hit.clone()
        } else {
            let mut buffer = Buffer::new(
                &mut self.font_system,
                Metrics::new(base.size as f32, (base.size * 1.25) as f32),
            );
            buffer.set_size(None, None);
            let default_attrs = Attrs::new();
            buffer.set_rich_text(
                key.rich.iter().map(|span| {
                    let size = f64::from_bits(span.size_bits);
                    let spacing = f64::from_bits(span.spacing_bits);
                    let attrs = Attrs::new()
                        .family(Family::Name(&span.family))
                        .weight(Weight(span.weight))
                        .style(font_style(span.italic))
                        .metrics(Metrics::new(size as f32, (size * 1.25) as f32));
                    let attrs = if spacing == 0.0 {
                        attrs
                    } else {
                        attrs.letter_spacing((spacing / size) as f32)
                    };
                    (&key.text[span.start..span.end], attrs)
                }),
                &default_attrs,
                Shaping::Advanced,
                None,
            );
            buffer.shape_until_scroll(&mut self.font_system, false);
            let mut line = ShapedLine::default();
            if let Some(run) = buffer.layout_runs().next() {
                line.width = run.line_w as f64;
                for glyph in run.glyphs {
                    let key = glyph.physical((0.0, 0.0), 1.0).cache_key;
                    line.glyphs.push(ShapedGlyph {
                        cache_key: key,
                        x: glyph.x as f64,
                        y: (glyph.y + glyph.y_offset) as f64,
                        cluster: glyph.start..glyph.end,
                    });
                    if let Some(font) = self.font_system.get_font(glyph.font_id, glyph.font_weight)
                    {
                        let metrics = font.as_swash().metrics(&[]);
                        let scale = f64::from(glyph.font_size) / f64::from(metrics.units_per_em);
                        line.ascent = line.ascent.max(f64::from(metrics.ascent) * scale);
                        line.descent = line.descent.max(f64::from(metrics.descent) * scale);
                    }
                }
            }
            self.shape_cache.insert(key, line.clone());
            line
        };
        for glyph in &mut out.glyphs {
            glyph.cluster.start += range.start;
            glyph.cluster.end += range.start;
        }
        out
    }

    /// 六个限容缓存当前的估算字节占用
    /// （shaping / 轮廓 / 彩色位图 / atlas mask / 描边 mask / 彩色能力门）。
    /// 只服务于测试与诊断。
    #[cfg(test)]
    fn cache_bytes(&self) -> (usize, usize, usize, usize, usize, usize) {
        (
            self.shape_cache.bytes,
            self.path_cache.bytes,
            self.bitmap_cache.bytes,
            self.mask_cache.bytes,
            self.stroke_mask_cache.bytes,
            self.color_face_cache.bytes,
        )
    }

    fn shape_uncached(
        &mut self,
        text: &str,
        family: &str,
        font_size: f64,
        weight: u16,
        italic: bool,
        spacing: f64,
    ) -> ShapedLine {
        let runs = self.plan_runs(text, family, weight, italic);
        if let [(only, only_weight, _)] = runs.as_slice() {
            // 常见情形：整串一个族。走原路，字距与连字一个不少。
            return self.shape_family_uncached(
                text,
                only,
                font_size,
                *only_weight,
                italic,
                spacing,
            );
        }
        let mut output = ShapedLine::default();
        for (run_family, run_weight, range) in runs {
            let start = range.start;
            append_shaped_segment(
                &mut output,
                self.shape_family_uncached(
                    &text[range],
                    &run_family,
                    font_size,
                    run_weight,
                    italic,
                    spacing,
                ),
                start,
            );
        }
        output
    }

    /// 一个族在这个字重下**真正会被用到**的 face，以及要拿去 shaping 的字重。
    ///
    /// cosmic-text 收候选 face 的门是「`usWeightClass` 与所求字重**完全相等**，
    /// 或者是覆盖该字重的可变字体」（见其 `FontFallbackIter`）。差一点都不算：
    /// Arial 只有 400 和 700 两档，所求 650 时它一个 face 都过不了门，于是整族
    /// 被跳过，落到 cosmic-text 自己的系统回退——实测就成了 System Font。一页里
    /// 700 的标题是 Arial、650 的小标题是 System Font，正是这么来的。
    ///
    /// 所以这里先按 CSS 规则（fontdb 的 `query`）在族内挑好 face，再把字重**夹到
    /// 这个 face 能过门的值**：可变字体照传所求字重，静态字体传它自己那档。族是
    /// 作者点的名，字重该在族内让步，而不是把整个族换掉。
    fn resolve_face(
        &mut self,
        family: &str,
        weight: u16,
        italic: bool,
    ) -> Option<(Arc<cosmic_text::Font>, u16)> {
        if family.is_empty() {
            return None;
        }
        let id = self.font_system.db().query(&fontdb::Query {
            families: &[Family::Name(family)],
            weight: Weight(weight),
            stretch: Stretch::Normal,
            style: font_style(italic),
        })?;
        let face_weight = self.font_system.db().face(id).map(|face| face.weight.0)?;
        let font = self.font_system.get_font(id, fontdb::Weight(weight))?;
        let covers_weight = face_weight == weight
            || font
                .as_swash()
                .variations()
                .find(|axis| axis.tag() == WGHT_TAG)
                .is_some_and(|axis| {
                    let wanted = f32::from(weight);
                    wanted >= axis.min_value() && wanted <= axis.max_value()
                });
        Some((font, if covers_weight { weight } else { face_weight }))
    }

    /// 把一行文本切成「族 → 字节区间」的若干段，**这一刀由我们自己下**。
    ///
    /// 挑族的规则只有一条：候选链 `[作者点名的族, …CJK 回退链]` 从头找，取第一个
    /// 真的有这个字的族。由此同时成立三件事：
    ///
    /// * 作者点名的族说了算。它排在链首，只要它排得出这个字就轮不到回退——
    ///   BCF 写 `fontFamily: "Songti SC"` 时中文就是宋体，不会被内置黑体顶掉。
    /// * 主字体缺字时整段走**同一款**回退字体，而且换字重也是同一款。以前这一步
    ///   是交给 cosmic-text 逐字形找的，它按字重给出不同答案（见
    ///   [`resolve_cjk_chain`]）。
    /// * 中性标点跟着邻居走（见 [`resolve_scripts`]），不会在一行中文里单独
    ///   留在拉丁族。
    ///
    /// 返回的相邻段保证族不同；整串同族时只有一段，调用方据此走不切段的快路。
    fn plan_runs(
        &mut self,
        text: &str,
        family: &str,
        weight: u16,
        italic: bool,
    ) -> Vec<(String, u16, std::ops::Range<usize>)> {
        // 缺省无衬线族在这里定死成具体名字，别让它每个字重解析一次。
        let primary = if family.is_empty() {
            self.sans_family.clone().unwrap_or_default()
        } else {
            family.to_owned()
        };
        let mut chain = vec![primary.clone()];
        chain.extend(
            self.cjk_chain
                .iter()
                .filter(|name| **name != primary)
                .cloned(),
        );
        // 覆盖判断要读字体表，先把链上的 face 与各自让步后的字重一次取齐，
        // 之后只查 cmap。
        let resolved = chain
            .iter()
            .map(|name| self.resolve_face(name, weight, italic))
            .collect::<Vec<_>>();
        let covers = |index: usize, character: char| {
            resolved[index]
                .as_ref()
                .is_some_and(|(font, _)| font.as_swash().charmap().map(character) != 0)
        };
        // 链上一个都排不出的字（整条链都没有的生僻字、emoji）留给 cosmic-text：
        // 它至少还有系统 fallback，而这一步的选择与字重无关，仍然是确定的。
        let pick = |character: char| {
            (0..chain.len())
                .find(|i| covers(*i, character))
                .unwrap_or(0)
        };

        let characters = text.chars().collect::<Vec<_>>();
        let scripts = resolve_scripts(text);
        // 第一遍：自己挑得了族的字先挑定；并进 CJK 段的中性标点空着，等邻居。
        let follows_neighbour = |index: usize| {
            scripts[index] == Script::Cjk && is_neutral_punctuation(characters[index])
        };
        let mut chosen = characters
            .iter()
            .enumerate()
            .map(|(index, character)| (!follows_neighbour(index)).then(|| pick(*character)))
            .collect::<Vec<_>>();
        // 第二遍：空着的去认最近的汉字——先往前找，没有再往后找。认的必须是汉字
        // 本身而不是随便哪一段，否则「A“中”」里的引号会去跟着 A 的拉丁族。
        let nearest_han = |chosen: &[Option<usize>], index: usize| {
            (0..index)
                .rev()
                .chain(index + 1..chosen.len())
                .find(|probe| scripts[*probe] == Script::Cjk && chosen[*probe].is_some())
                .and_then(|probe| chosen[probe])
        };
        for index in 0..chosen.len() {
            if chosen[index].is_none() {
                // 前后都没有汉字时 `resolve_scripts` 不会判成 CJK，兜底只是防御。
                chosen[index] =
                    Some(nearest_han(&chosen, index).unwrap_or_else(|| pick(characters[index])));
            }
        }

        let mut runs: Vec<(String, u16, std::ops::Range<usize>)> = Vec::new();
        for ((offset, character), index) in text.char_indices().zip(chosen) {
            let end = offset + character.len_utf8();
            let index = index.unwrap_or(0);
            let name = &chain[index];
            // 链上查不到 face 的族（只可能是 index 0 的空族名）保持原字重，
            // 让 cosmic-text 走它自己的 `Family::SansSerif` 老路。
            let run_weight = resolved[index].as_ref().map_or(weight, |(_, w)| *w);
            match runs.last_mut() {
                Some((last, last_weight, range)) if last == name && *last_weight == run_weight => {
                    range.end = end
                }
                _ => runs.push((name.clone(), run_weight, offset..end)),
            }
        }
        if runs.is_empty() {
            runs.push((primary, weight, 0..text.len()));
        }
        runs
    }

    fn shape_family_uncached(
        &mut self,
        text: &str,
        family: &str,
        font_size: f64,
        weight: u16,
        italic: bool,
        spacing: f64,
    ) -> ShapedLine {
        if text.is_empty() {
            return ShapedLine::default();
        }
        let fs = font_size as f32;
        let mut buffer = Buffer::new(
            &mut self.font_system,
            Metrics::new(fs, (font_size * 1.25) as f32),
        );
        buffer.set_size(None, None);
        let fam = if family.is_empty() {
            Family::SansSerif
        } else {
            Family::Name(family)
        };
        let attrs = Attrs::new()
            .weight(Weight(weight))
            .style(font_style(italic))
            .family(fam);
        let attrs = if spacing == 0.0 {
            attrs
        } else {
            attrs.letter_spacing((spacing / font_size) as f32)
        };
        buffer.set_text(text, &attrs, Shaping::Advanced, None);
        buffer.shape_until_scroll(&mut self.font_system, false);

        let mut out = ShapedLine::default();
        let mut primary_font = None;
        // v2 原样；新版 clippy 把 `never_loop` 定为 deny，这里只放行，写法不动。
        #[allow(clippy::never_loop)]
        for run in buffer.layout_runs() {
            out.width = run.line_w as f64;
            for g in run.glyphs {
                if primary_font.is_none() {
                    primary_font = Some(g.font_id);
                }
                let phys = g.physical((0.0, 0.0), 1.0);
                out.glyphs.push(ShapedGlyph {
                    cache_key: phys.cache_key,
                    x: g.x as f64,
                    y: g.y as f64 + g.y_offset as f64,
                    cluster: g.start..g.end,
                });
            }
            break; // 单行
        }
        // 字体度量（ascent/descent），取首个字形的字体
        if let Some(fid) = primary_font {
            if let Some(font) = self
                .font_system
                .get_font(fid, cosmic_text::fontdb::Weight(weight))
            {
                let m = font.as_swash().metrics(&[]);
                let scale = font_size / m.units_per_em as f64;
                out.ascent = m.ascent as f64 * scale;
                out.descent = m.descent as f64 * scale;
            }
        }
        if out.ascent == 0.0 {
            out.ascent = font_size * 0.8;
            out.descent = font_size * 0.2;
        }
        out
    }

    /// 字形轮廓 → tiny-skia Path（原点 = 基线左端，y 向下为正）
    pub fn glyph_path(&mut self, key: CacheKey) -> Option<Path> {
        if let Some(p) = self.path_cache.get(&key) {
            return p.clone();
        }
        let path = self
            .swash
            .get_outline_commands(&mut self.font_system, key)
            .and_then(|cmds| {
                let mut pb = PathBuilder::new();
                for cmd in cmds {
                    use swash::zeno::Command;
                    match cmd {
                        Command::MoveTo(p) => pb.move_to(p.x, -p.y),
                        Command::LineTo(p) => pb.line_to(p.x, -p.y),
                        Command::QuadTo(c, p) => pb.quad_to(c.x, -c.y, p.x, -p.y),
                        Command::CurveTo(c1, c2, p) => {
                            pb.cubic_to(c1.x, -c1.y, c2.x, -c2.y, p.x, -p.y)
                        }
                        Command::Close => pb.close(),
                    }
                }
                pb.finish()
            });
        // 轮廓在 swash 的 `outline_command_cache` 里还有一份影子（同一个
        // `CacheKey`，且比这边更大）。淘汰这边却留着那边，限容就只管住了小头。
        for evicted in self.path_cache.insert(key, path.clone()) {
            self.swash.outline_command_cache.remove(&evicted);
        }
        path
    }

    /// 字形的可绘制形态：按 **face 的彩色能力**分流，彩色 face 先试彩色通道，
    /// 拿不到彩色结果再退回矢量轮廓。
    ///
    /// 判据不能是「轮廓没有填充面积」：那只对 `sbix`/`CBDT` 位图字体成立
    /// （Apple Color Emoji 的 `glyf` 是零面积占位）。`COLR`/`CPAL` 字体
    /// （Windows `Segoe UI Emoji`）按规范要求基字形自带**非空**单色回退轮廓，
    /// 面积判据会把它错判成普通轮廓，画成与字幕字色相同的单色剪影。
    ///
    /// 彩色候选仍必须能回落轮廓：COLRv1-only 字体过得了表存在性门，但 swash
    /// 的 v0 `layers()` 拿不到图层；彩色 face 里的普通字形同理。
    ///
    /// [`glyph_path`](Self::glyph_path) 的返回语义故意保持不变：BCF
    /// `renderer.rs` 的 DrawOp 录制依赖它的确定性输出。BCF 文字的彩色字形走
    /// [`color_glyph`](Self::color_glyph)，不经这里。
    pub fn glyph_render(&mut self, key: CacheKey) -> GlyphRender {
        if self.face_has_color(key) {
            if let Some(glyph) = self.color_bitmap(key) {
                return GlyphRender::ColorBitmap {
                    width: glyph.width,
                    height: glyph.height,
                    rgba: glyph.rgba,
                    left: glyph.left,
                    top: glyph.top,
                };
            }
        }
        match self.glyph_path(key) {
            Some(path) if path_has_area(&path) => GlyphRender::Outline(path),
            _ => GlyphRender::Empty,
        }
    }

    /// BCF 录制器的彩色通道：彩色 face 且拿得到彩色光栅结果时，返回按
    /// `字号 × oversample` 光栅化的预乘 RGBA；否则 `None`，调用方照旧走
    /// [`glyph_path`](Self::glyph_path)——单色字形的指令流与指纹因此逐字节不变
    /// （[`glyph_render`](Self::glyph_render) 会把零面积轮廓报成 `Empty`，拿它
    /// 分流会让空格之类的字形从既有指令流里消失）。
    ///
    /// * `oversample`：放大（camera zoom / pop scale）时多给像素。swash 按请求
    ///   字号挑最近的位图档（`sbix` / `CBDT`）再缩放，`COLR` 直接按字号光栅化。
    /// * 子像素档清零：shaping 给的 `glyph.x` 已含小数部分，录制器按它平移；
    ///   再让 swash 按 `x_bin` 偏一次就是重复平移。清零也让每个字形只光栅化一次。
    ///
    /// 返回的 `left` / `top` 是**光栅字号**下的 placement（与 `GlyphRender` 同口径，
    /// `top` 以 y 向上为正），调用方负责除以 `oversample`。
    pub fn color_glyph(&mut self, key: CacheKey, oversample: f32) -> Option<GlyphColorImage> {
        if !self.face_has_color(key) {
            return None;
        }
        let size = f32::from_bits(key.font_size_bits) * oversample;
        if !size.is_finite() || size <= 0.0 {
            return None;
        }
        let key = CacheKey {
            font_size_bits: size.to_bits(),
            x_bin: SubpixelBin::Zero,
            y_bin: SubpixelBin::Zero,
            ..key
        };
        let glyph = self.color_bitmap(key)?;
        Some(GlyphColorImage {
            key: runtime_glyph_key(&key),
            width: glyph.width,
            height: glyph.height,
            left: glyph.left,
            top: glyph.top,
            rgba: glyph.rgba,
        })
    }

    /// 离散字号字形 → atlas 图像。普通轮廓为 alpha mask，彩色字形为预乘
    /// RGBA；两类结果都按完整 `CacheKey` 限容缓存。逐词动画只改变 quad
    /// pose/color，不会再次触发 swash 光栅化。
    pub fn glyph_atlas_render(&mut self, key: CacheKey) -> GlyphAtlasRender {
        if self.face_has_color(key)
            && let Some(glyph) = self.color_bitmap(key)
        {
            return GlyphAtlasRender::Color(GlyphColorImage {
                key: runtime_glyph_key(&key),
                width: glyph.width,
                height: glyph.height,
                left: glyph.left,
                top: glyph.top,
                rgba: glyph.rgba,
            });
        }
        if let Some(cached) = self.mask_cache.get(&key) {
            return cached.clone().into();
        }
        let mask = self.rasterize_glyph_mask(key);
        self.mask_cache.insert(key, mask.clone());
        mask.into()
    }

    /// 字形轮廓按 CPU reference 的 tiny-skia 居中线宽生成 R8 atlas mask。
    /// `width` 是完整 stroke width（不是可见外扩半径），按 1/64px 分档以避免
    /// 浮点微差把同一视觉线宽扩成无界缓存键。
    pub fn glyph_stroke_atlas_render(&mut self, key: CacheKey, width: f32) -> GlyphAtlasRender {
        if self.face_has_color(key) && self.color_bitmap(key).is_some() {
            return GlyphAtlasRender::Empty;
        }
        if !width.is_finite() || width <= 0.0 {
            return GlyphAtlasRender::Empty;
        }
        let width_64 = (width * 64.0).round().clamp(1.0, u32::MAX as f32) as u32;
        let cache_key = StrokeMaskKey {
            glyph: key,
            width_64,
        };
        if let Some(cached) = self.stroke_mask_cache.get(&cache_key) {
            return cached.clone().into();
        }
        let mask = self.rasterize_glyph_stroke(cache_key);
        self.stroke_mask_cache.insert(cache_key, mask.clone());
        mask.into()
    }

    fn rasterize_glyph_stroke(&mut self, key: StrokeMaskKey) -> CachedGlyphMask {
        let Some(path) = self.glyph_path(key.glyph) else {
            return CachedGlyphMask::Empty;
        };
        let width = key.width_64 as f32 / 64.0;
        let bounds = path.bounds();
        // tiny-skia 的抗锯齿边缘会越过几何包围盒不足 1px；额外留 1px，避免
        // atlas mask 切边。坐标仍以 glyph baseline 原点为基准。
        let expansion = width * 0.5 + 1.0;
        let left = (bounds.left() - expansion).floor();
        let top = (bounds.top() - expansion).floor();
        let right = (bounds.right() + expansion).ceil();
        let bottom = (bounds.bottom() + expansion).ceil();
        let Some(mask_width) = positive_extent(right - left) else {
            return CachedGlyphMask::Empty;
        };
        let Some(mask_height) = positive_extent(bottom - top) else {
            return CachedGlyphMask::Empty;
        };
        let Some(mut pixmap) = Pixmap::new(mask_width, mask_height) else {
            return CachedGlyphMask::Unsupported;
        };
        let mut paint = Paint::default();
        paint.set_color_rgba8(255, 255, 255, 255);
        paint.anti_alias = true;
        let stroke = Stroke {
            width,
            ..Stroke::default()
        };
        pixmap.stroke_path(
            &path,
            &paint,
            &stroke,
            Transform::from_translate(-left, -top),
            None,
        );
        let alpha = pixmap
            .data()
            .chunks_exact(4)
            .map(|pixel| pixel[3])
            .collect::<Vec<_>>();
        if alpha.iter().all(|value| *value == 0) {
            return CachedGlyphMask::Empty;
        }
        CachedGlyphMask::Mask(GlyphMaskImage {
            key: runtime_glyph_key(&key),
            width: mask_width,
            height: mask_height,
            left: left as i32,
            top: -(top as i32),
            alpha: alpha.into(),
        })
    }

    fn rasterize_glyph_mask(&mut self, key: CacheKey) -> CachedGlyphMask {
        let Some(image) = self.swash.get_image_uncached(&mut self.font_system, key) else {
            return if self
                .glyph_path(key)
                .is_some_and(|path| path_has_area(&path))
            {
                CachedGlyphMask::Unsupported
            } else {
                CachedGlyphMask::Empty
            };
        };
        if image.content != SwashContent::Mask {
            return CachedGlyphMask::Unsupported;
        }
        let (width, height) = (image.placement.width, image.placement.height);
        if width == 0 || height == 0 {
            return CachedGlyphMask::Empty;
        }
        let expected = (width as usize).checked_mul(height as usize);
        if expected != Some(image.data.len()) {
            return CachedGlyphMask::Unsupported;
        }
        CachedGlyphMask::Mask(GlyphMaskImage {
            key: runtime_glyph_key(&key),
            width,
            height,
            left: image.placement.left,
            top: image.placement.top,
            alpha: image.data.into(),
        })
    }

    /// face 是否可能产出彩色字形：有 `COLR` 分层轮廓，或有彩色位图 strike
    /// （`sbix` / `CBDT`）。per-face 缓存，单色字体只查一次表。
    ///
    /// 这里不额外要求 `CPAL`：没有调色板的 COLR face 会用 swash 的 foreground
    /// 画图层，仍是彩色内容，也仍好过被当成单色剪影；而 `color_bitmap` 失败必然
    /// 回落轮廓，放宽这一侧没有风险。
    fn face_has_color(&mut self, key: CacheKey) -> bool {
        if let Some(cached) = self.color_face_cache.get(&key.font_id) {
            return *cached;
        }
        let has_color = self
            .font_system
            .get_font(key.font_id, key.font_weight)
            .is_some_and(|font| {
                let face = font.as_swash();
                face.table(COLR_TAG).is_some() || face.color_strikes().next().is_some()
            });
        self.color_face_cache.insert(key.font_id, has_color);
        has_color
    }

    fn color_bitmap(&mut self, key: CacheKey) -> Option<ColorGlyph> {
        if let Some(cached) = self.bitmap_cache.get(&key) {
            return cached.clone();
        }
        let glyph = self.rasterize_color_bitmap(key);
        self.bitmap_cache.insert(key, glyph.clone());
        glyph
    }

    fn rasterize_color_bitmap(&mut self, key: CacheKey) -> Option<ColorGlyph> {
        let image = self.swash.get_image_uncached(&mut self.font_system, key)?;
        if image.content != SwashContent::Color {
            return None;
        }
        let (width, height) = (image.placement.width, image.placement.height);
        if width == 0 || height == 0 {
            return None;
        }
        if image.data.len() < width as usize * height as usize * 4 {
            return None;
        }
        let mut pixmap = Pixmap::new(width, height)?;
        // tiny-skia 的缓冲是预乘的，而 swash 两条彩色通道的 alpha 语义不同：
        // - `ColorOutline`（COLR）：逐图层 src-over 合成进零初始化缓冲，输出**已预乘**；
        // - `ColorBitmap`（sbix / CBDT）：PNG 解码结果，输出是**直通**（未预乘）。
        // 对 COLR 再乘一次会把 AA 边缘压暗，所以必须按 `image.source` 分流。
        let already_premultiplied = matches!(image.source, Source::ColorOutline(_));
        for (dst, src) in pixmap
            .pixels_mut()
            .iter_mut()
            .zip(image.data.chunks_exact(4))
        {
            let straight = ColorU8::from_rgba(src[0], src[1], src[2], src[3]);
            *dst = if already_premultiplied {
                // 越界像素（理论上不会出现）退回直通语义，避免 panic 或黑块。
                PremultipliedColorU8::from_rgba(src[0], src[1], src[2], src[3])
                    .unwrap_or_else(|| straight.premultiply())
            } else {
                straight.premultiply()
            };
        }
        Some(ColorGlyph {
            width,
            height,
            rgba: pixmap.take().into(),
            left: image.placement.left,
            top: image.placement.top,
        })
    }
}

impl From<CachedGlyphMask> for GlyphAtlasRender {
    fn from(value: CachedGlyphMask) -> Self {
        match value {
            CachedGlyphMask::Mask(mask) => Self::Mask(mask),
            CachedGlyphMask::Empty => Self::Empty,
            CachedGlyphMask::Unsupported => Self::Unsupported,
        }
    }
}

fn runtime_glyph_key(key: &impl Hash) -> [u64; 2] {
    let mut first = StableGlyphHasher::new(0xcbf2_9ce4_8422_2325);
    key.hash(&mut first);
    let mut second = StableGlyphHasher::new(0x8422_2325_cbf2_9ce4);
    key.hash(&mut second);
    [first.finish(), second.finish()]
}

fn positive_extent(value: f32) -> Option<u32> {
    if !value.is_finite() || value <= 0.0 || value > u32::MAX as f32 {
        return None;
    }
    Some(value as u32)
}

/// `DefaultHasher` 的算法不是公共契约；atlas key 只需进程内稳定，但明确的
/// FNV-1a 让同一个 CacheKey 在调试与测试里可复现。
struct StableGlyphHasher(u64);

impl StableGlyphHasher {
    fn new(seed: u64) -> Self {
        Self(seed)
    }
}

impl Hasher for StableGlyphHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x100_0000_01b3);
        }
    }
}

fn append_shaped_segment(output: &mut ShapedLine, mut segment: ShapedLine, byte_offset: usize) {
    let x_offset = output.width;
    for glyph in &mut segment.glyphs {
        glyph.x += x_offset;
        glyph.cluster.start += byte_offset;
        glyph.cluster.end += byte_offset;
    }
    output.width += segment.width;
    output.ascent = output.ascent.max(segment.ascent);
    output.descent = output.descent.max(segment.descent);
    output.glyphs.extend(segment.glyphs);
}

fn is_cjk_character(character: char) -> bool {
    matches!(
        character as u32,
        0x2E80..=0x2FFF
            | 0x3000..=0x303F
            | 0x3040..=0x30FF
            | 0x3100..=0x31BF
            | 0x31F0..=0x31FF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            // 竖排标点 / CJK 兼容标点 / 全角与半角形式。全角冒号（U+FF1A）、
            // 全角逗号、全角括号在中文正文里随处可见，它们过去落在这张表外面：
            // 一句「生活里：瞬时变化率」会被切成三段，中间那个冒号拿拉丁族去排，
            // 于是字重、字形宽度和左右边距都和两边的汉字对不上。
            | 0xFE10..=0xFE1F
            | 0xFE30..=0xFE4F
            | 0xFF01..=0xFF60
            | 0xFFE0..=0xFFE6
            | 0x20000..=0x323AF
    )
}

/// Whether a text run should use BaoCut's bundled CJK fallback instead of a Latin-only
/// display family. UI specimen surfaces consume the same predicate so their fallback choice
/// cannot drift from video burn-in.
pub fn contains_cjk(text: &str) -> bool {
    text.chars().any(is_cjk_character)
}

impl Default for TextEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl TextMeasure for TextEngine {
    fn measure_rich(
        &mut self,
        text: &str,
        range: std::ops::Range<usize>,
        base: scene_primitives::text_layout::FontStyle<'_>,
        runs: &[scene_primitives::text_layout::Run],
    ) -> TextMetricsLine {
        let shaped = self.shape_rich(text, range, base, runs);
        TextMetricsLine {
            width: shaped.width,
            ascent: shaped.ascent,
            descent: shaped.descent,
        }
    }
    fn measure_spaced(
        &mut self,
        text: &str,
        family: &str,
        size: f64,
        weight: u16,
        italic: bool,
        spacing: f64,
    ) -> TextMetricsLine {
        let shaped = self.shape_spaced(text, family, size, weight, italic, spacing);
        TextMetricsLine {
            width: shaped.width,
            ascent: shaped.ascent,
            descent: shaped.descent,
        }
    }
    fn measure(
        &mut self,
        text: &str,
        family: &str,
        font_size: f64,
        weight: u16,
    ) -> TextMetricsLine {
        self.measure_styled(text, family, font_size, weight, false)
    }

    fn measure_styled(
        &mut self,
        text: &str,
        family: &str,
        font_size: f64,
        weight: u16,
        italic: bool,
    ) -> TextMetricsLine {
        let s = self.shape_styled(text, family, font_size, weight, italic);
        TextMetricsLine {
            width: s.width,
            ascent: s.ascent,
            descent: s.descent,
        }
    }
}

/// countUp / `textCount` 数字格式化（规范 §7.1 `format`）：定长小数、en_US 千分组，
/// 与原型 NumberFormatter 一致。
///
/// - `grouping`（缺省 true）：整数部分每三位插一个 `,`；
/// - `pad`（缺省 0，0..=20）：整数部分左侧补零到至少这么多位（补零在分组之前，
///   与 `Intl.NumberFormat` 的 `minimumIntegerDigits` 同义）；
/// - `negativePrefix`（可选）：值 < 0 时**代替** `prefix`，不画负号、显示绝对值
///   （`公元前 2070 … 公元 220`）。「< 0」按四舍五入到 `decimals` 位之后的读数判：
///   `-0.4` 在 0 位小数下读作 `0`，用 `prefix`。
///
/// 类型不对的键在 resolve 期就被拒绝（`schema: textCount format …`），这里按缺省处理。
pub fn fmt_count(v: f64, meta: Option<&serde_json::Map<String, serde_json::Value>>) -> String {
    let get = |key: &str| meta.and_then(|m| m.get(key));
    let decimals = get("decimals").and_then(|d| d.as_f64()).unwrap_or(0.0) as usize;
    let prefix = get("prefix").and_then(|p| p.as_str()).unwrap_or("");
    let suffix = get("suffix").and_then(|s| s.as_str()).unwrap_or("");
    let grouping = get("grouping").and_then(|g| g.as_bool()).unwrap_or(true);
    let pad = get("pad")
        .and_then(|p| p.as_f64())
        .unwrap_or(0.0)
        .clamp(0.0, 20.0) as usize;
    let negative_prefix = get("negativePrefix").and_then(|p| p.as_str());
    let s = format!("{:.*}", decimals, v.abs());
    let (int_part, frac_part) = match s.split_once('.') {
        Some((i, f)) => (i.to_string(), Some(f.to_string())),
        None => (s, None),
    };
    // 读数是否非零（四舍五入之后）：决定负号与 negativePrefix。
    let nonzero = int_part.chars().any(|c| c != '0')
        || frac_part
            .as_deref()
            .is_some_and(|f| f.chars().any(|c| c != '0'));
    let negative = v < 0.0 && nonzero;
    let digits: Vec<char> = std::iter::repeat_n('0', pad.saturating_sub(int_part.len()))
        .chain(int_part.chars())
        .collect();
    let mut grouped = String::new();
    for (i, c) in digits.iter().enumerate() {
        if grouping && i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(*c);
    }
    let (lead, sign) = match (negative, negative_prefix) {
        (true, Some(np)) => (np, ""),
        (true, None) => (prefix, "-"),
        (false, _) => (prefix, ""),
    };
    match frac_part {
        Some(f) if decimals > 0 => format!("{lead}{sign}{grouped}.{f}{suffix}"),
        _ => format!("{lead}{sign}{grouped}{suffix}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[cfg(feature = "external-fonts")]
    #[test]
    fn external_fonts_resolve_only_inside_an_app_bundle() {
        let app = std::path::Path::new("/Applications/BaoCut.app/Contents/MacOS/bcut-serve");
        assert_eq!(
            app_fonts_dir(app).unwrap(),
            std::path::Path::new("/Applications/BaoCut.app/Contents/Resources/fonts")
        );
        assert!(app_fonts_dir(std::path::Path::new("/tmp/bcut-serve")).is_none());

        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Example.ttf"), b"font").unwrap();
        std::fs::write(dir.path().join("NOTICE.md"), b"notice").unwrap();
        let fonts = load_external_fonts_at(dir.path());
        assert_eq!(fonts.len(), 1);
        assert_eq!(fonts["Example.ttf"], b"font");
    }

    /// 本机上这一段文本每个字实际落到的 family，按字重报出来。
    fn families_by_char(
        engine: &mut TextEngine,
        text: &str,
        family: &str,
        weight: u16,
    ) -> Vec<String> {
        engine
            .shape(text, family, 48.0, weight)
            .glyphs
            .iter()
            .map(|glyph| {
                engine
                    .font_system
                    .db()
                    .face(glyph.cache_key.font_id)
                    .and_then(|face| face.families.first().map(|(name, _)| name.clone()))
                    .unwrap_or_default()
            })
            .collect()
    }

    /// 一行中文必须**整行一个字体**，不许逐字散开。
    ///
    /// 回归实测症状（`bcut render` 出的成片）：标题「导数的两张脸」里
    /// 「导数两张脸」是宋体、「的」是 Apple SD Gothic Neo，正文
    /// 「生活里：瞬时变化率」同一行里黑体宋体混排。根因是回退族写死成
    /// `"Noto Sans SC"`，而 BCF 渲染路径的 fontdb 里压根没有这个字体，
    /// cosmic-text 于是逐字形自己找——每个字找到什么算什么。
    ///
    /// 断言两件事：回退链的链首是查得到的（内置字体已挂进库），以及整行 CJK 的
    /// 字形都出自同一个 face。全角冒号也必须算进 CJK 段，否则它会拿拉丁族
    /// 去排，在中文行里显出一个宽窄不对的冒号。
    #[test]
    #[cfg_attr(
        not(feature = "media"),
        ignore = "待 media：内置 CJK 字体只在 media 下挂进 fontdb（见 Cargo.toml 文件头），不开时回退到系统字体"
    )]
    fn a_chinese_line_is_shaped_with_a_single_face() {
        let mut engine = TextEngine::new();
        assert_eq!(
            engine.cjk_chain.first().map(String::as_str),
            Some(BUNDLED_CJK_FAMILY),
            "内置 CJK 字体必须进 BCF 渲染用的 fontdb，并排在回退链最前"
        );

        for weight in [400u16, 600, 700] {
            // family 留空 = 缺省无衬线族，正是 BCF 里不声明 fontFamily 的写法。
            let families = families_by_char(&mut engine, "导数的两张脸：瞬时变化率", "", weight)
                .into_iter()
                .collect::<HashSet<_>>();
            assert_eq!(
                families,
                HashSet::from([BUNDLED_CJK_FAMILY.to_owned()]),
                "weight {weight} 的中文行没有整行一个字体：{families:?}"
            );
        }
    }

    /// 回退族**自己**缺字时，缺的那个字也必须落在一款确定的字体上，而且换字重
    /// 不换字体。
    ///
    /// 这是用户报的原症状里最后一块：过去只解析出一个回退族，该族排不出的字就
    /// 交还给 cosmic-text 逐字形找，而它的答案跟着字重走——实测「名字里有个𠮷
    /// 字」的「𠮷」（思源黑体没有），weight 400 落 PingFang SC，weight 700 落
    /// YuKyokasho Yoko，同一句话换个字重就换一款字。
    #[test]
    fn a_glyph_the_fallback_lacks_picks_one_font_at_every_weight() {
        let mut engine = TextEngine::new();
        let text = "名字里有个𠮷字";
        let picked = [100u16, 400, 550, 700, 900]
            .into_iter()
            .map(|weight| {
                let families = families_by_char(&mut engine, text, "", weight);
                // 「𠮷」是第 5 个字形（前面「名字里有个」五个字各一个字形）。
                families.get(5).cloned().unwrap_or_default()
            })
            .collect::<HashSet<_>>();
        assert_eq!(
            picked.len(),
            1,
            "缺字的回退随字重漂了：{picked:?}（同一段文本必须整体用同一款回退字体）"
        );
    }

    /// 中文行里的弯引号 / 破折号 / 省略号 / 间隔号跟着汉字走，不留在拉丁族。
    ///
    /// 它们在 Unicode 上不属于 CJK 区段，而拉丁族**也有**这些字形，所以按覆盖率
    /// 挑字体时会稳稳留在 Arial 里：一句中文的汉字是思源黑体，引号和破折号却是
    /// Arial，宽度与笔形都对不上。
    #[test]
    #[cfg_attr(
        not(feature = "media"),
        ignore = "待 media：内置 CJK 字体只在 media 下挂进 fontdb（见 Cargo.toml 文件头），不开时回退到系统字体"
    )]
    fn chinese_punctuation_follows_the_han_run() {
        let mut engine = TextEngine::new();
        for weight in [400u16, 700] {
            let families =
                families_by_char(&mut engine, "他说“这段时间很关键”——真的吗……", "", weight)
                    .into_iter()
                    .collect::<HashSet<_>>();
            assert_eq!(
                families,
                HashSet::from([BUNDLED_CJK_FAMILY.to_owned()]),
                "weight {weight} 的中文标点没跟着汉字：{families:?}"
            );
        }
        // 纯英文里的同一批标点仍归拉丁族——中性规则只在挨着汉字时生效。
        let latin = families_by_char(&mut engine, "he said “yes”—really…", "", 400)
            .into_iter()
            .collect::<HashSet<_>>();
        assert!(
            !latin.contains(BUNDLED_CJK_FAMILY),
            "英文行不该被拖进 CJK 族：{latin:?}"
        );
    }

    /// 作者点名的 CJK 族说了算，不被内置回退顶掉。
    ///
    /// 链首是作者写的 family，只要它排得出这个字就轮不到回退。本机没装候选族时
    /// 跳过——这条断言的是优先级，不是某台机器装了什么。
    #[test]
    fn an_author_named_cjk_family_wins_over_the_bundled_fallback() {
        let mut engine = TextEngine::new();
        let Some(named) = ["Songti SC", "PingFang SC", "Hiragino Sans GB", "SimSun"]
            .into_iter()
            .find(|family| engine.has_family(family) && *family != BUNDLED_CJK_FAMILY)
        else {
            eprintln!("跳过：本机没装可点名的系统 CJK 族");
            return;
        };
        let families = families_by_char(&mut engine, "导数是什么", named, 400)
            .into_iter()
            .collect::<HashSet<_>>();
        assert_eq!(
            families,
            HashSet::from([named.to_owned()]),
            "点名 {named} 却排成了别的族：{families:?}"
        );
    }

    /// 缺省无衬线族在装配时解析**一次**，此后字重只管字重。
    ///
    /// `Family::SansSerif` 是待解析的意向，cosmic-text 每次带着字重去解析它，
    /// 结果并不稳定：实测同一台 macOS 上 weight 400 / 700 解析到 Arial，而
    /// 500 / 600 / 650 / 750 / 800 / 900 解析到 System Font，于是一页里 700 的
    /// 标题和 650 的小标题落在两款完全不同的拉丁字体上。
    #[test]
    fn the_default_sans_family_does_not_drift_with_weight() {
        let mut engine = TextEngine::new();
        let families = [100u16, 400, 500, 600, 650, 700, 750, 800, 900]
            .into_iter()
            .flat_map(|weight| families_by_char(&mut engine, "Slope = dy / dx", "", weight))
            .collect::<HashSet<_>>();
        assert_eq!(families.len(), 1, "缺省无衬线族随字重漂了：{families:?}");
    }

    /// 全角标点属于 CJK：它们和汉字同属一段，跟着汉字用同一个族。
    #[test]
    fn fullwidth_punctuation_counts_as_cjk() {
        for character in ['：', '，', '（', '）', '、', '「', '」', '。'] {
            assert!(is_cjk_character(character), "{character} 应按 CJK 排版");
        }
        // 半角标点仍归拉丁段，别把英文句子里的逗号也拖进 CJK 族。
        for character in [':', ',', '(', ')', '.'] {
            assert!(!is_cjk_character(character), "{character} 不该算 CJK");
        }
    }

    #[test]
    fn fmt_count_grouping() {
        assert_eq!(fmt_count(72.0, None), "72");
        assert_eq!(fmt_count(42000.0, None), "42,000");
        let meta = json!({"suffix": "%", "decimals": 0});
        assert_eq!(fmt_count(71.6, meta.as_object()), "72%");
        let meta = json!({"decimals": 1});
        assert_eq!(fmt_count(0.14, meta.as_object()), "0.1");
    }

    #[test]
    fn fmt_count_grouping_off_and_zero_padding() {
        let meta = json!({"grouping": false});
        assert_eq!(fmt_count(42000.0, meta.as_object()), "42000");
        let meta = json!({"pad": 5, "grouping": false});
        assert_eq!(fmt_count(42.0, meta.as_object()), "00042");
        assert_eq!(fmt_count(123456.0, meta.as_object()), "123456");
        assert_eq!(fmt_count(-42.0, meta.as_object()), "-00042");
        // 补零在分组之前，与 Intl minimumIntegerDigits 同义。
        let meta = json!({"pad": 5});
        assert_eq!(fmt_count(42.0, meta.as_object()), "00,042");
        let meta = json!({"pad": 3, "decimals": 2, "grouping": false});
        assert_eq!(fmt_count(7.256, meta.as_object()), "007.26");
    }

    #[test]
    fn fmt_count_negative_prefix_replaces_prefix_and_sign() {
        let meta = json!({"prefix": "公元 ", "negativePrefix": "公元前 ", "grouping": false});
        let m = meta.as_object();
        assert_eq!(fmt_count(-2070.0, m), "公元前 2070");
        assert_eq!(fmt_count(-1.0, m), "公元前 1");
        assert_eq!(fmt_count(0.0, m), "公元 0");
        assert_eq!(fmt_count(-0.0, m), "公元 0");
        // -0.4 四舍五入到 0 位小数是 0：用 prefix，不用 negativePrefix。
        assert_eq!(fmt_count(-0.4, m), "公元 0");
        assert_eq!(fmt_count(-0.6, m), "公元前 1");
        assert_eq!(fmt_count(220.0, m), "公元 220");
        // 没写 negativePrefix：照旧 prefix + 负号。
        let meta = json!({"prefix": "$"});
        assert_eq!(fmt_count(-5.0, meta.as_object()), "$-5");
        assert_eq!(fmt_count(-0.4, meta.as_object()), "$0");
        // 与 suffix / decimals / pad 同用。
        let meta = json!({"negativePrefix": "−", "decimals": 1, "suffix": " °C", "pad": 2});
        assert_eq!(fmt_count(-3.26, meta.as_object()), "−03.3 °C");
        assert_eq!(fmt_count(-0.04, meta.as_object()), "00.0 °C");
    }

    /// 系统彩色 emoji 字体（macOS `sbix`、Linux `CBDT`、Windows `COLR`）必须走
    /// 彩色通道，普通拉丁字形仍走矢量轮廓；否则导出画面里 emoji 要么消失，要么
    /// 变成与字幕字色相同的单色剪影。
    ///
    /// 没有彩色 emoji 字体的机器（多数 Linux CI）自动跳过；结构性的判据回归由
    /// [`colr_face_with_solid_fallback_outline_uses_the_color_channel`] 用 checked-in
    /// 探针字体无条件覆盖。
    #[test]
    fn color_emoji_falls_back_to_the_bitmap_channel() {
        let mut engine = TextEngine::with_system_and_fonts(&[]);
        let emoji_family = ["Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji"]
            .into_iter()
            .find(|family| engine.has_family(family));
        let Some(emoji_family) = emoji_family else {
            eprintln!("跳过：本机没有安装彩色 emoji 字体");
            return;
        };
        let shaped = engine.shape("A😀B", "", 64.0, 400);
        assert!(!shaped.glyphs.is_empty(), "shaping 不应为空");
        let mut bitmaps = 0_usize;
        let mut outlines = 0_usize;
        for glyph in &shaped.glyphs {
            match engine.glyph_render(glyph.cache_key) {
                GlyphRender::Outline(path) => {
                    assert!(path_has_area(&path), "Outline 分支必须能填出像素");
                    outlines += 1;
                }
                GlyphRender::ColorBitmap { rgba, .. } => {
                    assert!(
                        rgba.chunks_exact(4).any(|pixel| pixel[3] > 0),
                        "彩色位图字形不能是全透明"
                    );
                    bitmaps += 1;
                }
                GlyphRender::Empty => {}
            }
        }
        assert!(
            bitmaps >= 1,
            "😀 应走彩色位图通道（回退字体 {emoji_family}）"
        );
        assert!(outlines >= 1, "A / B 仍应走矢量轮廓");
    }

    /// `COLR`/`CPAL` 字形（Windows `Segoe UI Emoji` 的结构）必须走彩色通道。
    ///
    /// 探针字体 `core/fixtures/fonts/ColrProbe.ttf` 由
    /// `core/fixtures/fonts/mk_colr_probe.py` 从零构造：基字形 `A` 自带**非空**
    /// 单色回退轮廓（COLR 规范要求），彩色图形在 COLR 图层里。旧的
    /// 「轮廓无填充面积才走彩色通道」判据在这里必然短路成 `Outline`。
    ///
    /// 同时钉住预乘语义：swash 的 COLR 通道输出**已预乘**，再乘一次会把 AA 边缘
    /// 压暗。调色板 0 是不透明纯红，两个图层互不重叠，因此纯红像素满足
    /// `red == alpha`；二次预乘会塌成 `red == red * alpha / 255`。
    #[test]
    fn colr_face_with_solid_fallback_outline_uses_the_color_channel() {
        let probe = include_bytes!("../tests/fixtures/fonts/ColrProbe.ttf").to_vec();
        let mut engine = TextEngine::with_document_fonts(&[probe]);
        let shaped = engine.shape("A", "ColrProbe", 64.0, 400);
        assert_eq!(shaped.glyphs.len(), 1, "探针字体应把 'A' shape 成单字形");
        let key = shaped.glyphs[0].cache_key;

        let path = engine.glyph_path(key).expect("COLR 基字形应有回退轮廓");
        assert!(
            path_has_area(&path),
            "探针必须保留非空单色回退轮廓，否则测不到面积判据的失效"
        );

        let GlyphRender::ColorBitmap { rgba, .. } = engine.glyph_render(key) else {
            panic!("COLR 字形必须走彩色通道，而不是被当成单色轮廓画成剪影");
        };

        let mut partial_red = 0_usize;
        for pixel in rgba.chunks_exact(4) {
            let [red, green, blue, alpha] = [pixel[0], pixel[1], pixel[2], pixel[3]];
            if alpha == 0 || red == 0 {
                continue;
            }
            if green != 0 || blue != 0 {
                continue; // 蓝色三角形（调色板 1）不参与红色不变量
            }
            assert_eq!(
                red, alpha,
                "COLR 输出被二次预乘：不透明纯红像素的 red 被 alpha 压暗"
            );
            // swash 的 `>>8` 合成让全覆盖像素落在 alpha=254，取 200 以下才算部分覆盖
            if alpha < 200 {
                partial_red += 1;
            }
        }
        assert!(
            partial_red > 0,
            "菱形斜边应产生部分覆盖的红色 AA 像素；否则预乘断言是空转"
        );
        let GlyphAtlasRender::Color(atlas) = engine.glyph_atlas_render(key) else {
            panic!("COLR 字形必须保留 RGBA atlas 数据");
        };
        assert!(Arc::ptr_eq(&rgba, &atlas.rgba));
        assert!(matches!(
            engine.glyph_stroke_atlas_render(key, 4.0),
            GlyphAtlasRender::Empty
        ));
    }

    /// BCF 文档不声明 `font` 资产也能按名字用内置展示字体；声明了（strict）也一样，
    /// 排出来的就是那一款（和缺省族宽度不同）。字幕的注入字体入口不带这一套。
    #[cfg(feature = "media")]
    #[test]
    fn documents_see_bundled_display_families_by_name() {
        let loose = TextEngine::for_document(&[]);
        assert!(!loose.strict);
        assert!(loose.has_family("Permanent Marker") && loose.has_family("Bangers"));

        let doc = include_bytes!("../assets/fonts/VKSans-400.ttf").to_vec();
        let mut strict = TextEngine::for_document(std::slice::from_ref(&doc));
        assert!(strict.strict);
        assert!(strict.has_family("Permanent Marker"));
        let marker = strict.shape("FOOM", "Permanent Marker", 48.0, 400).width;
        let fallback = strict.shape("FOOM", "", 48.0, 400).width;
        assert!((marker - fallback).abs() > 1.0, "{marker} vs {fallback}");

        assert!(!TextEngine::with_document_fonts(&[doc]).has_family("Permanent Marker"));
    }

    /// 彩色能力门必须是 per-face 的：单色字体不能因为新判据额外跑一次光栅化，
    /// 更不能被误判成彩色。
    #[test]
    fn monochrome_face_stays_on_the_outline_channel() {
        let mut engine =
            TextEngine::with_document_fonts(&[
                include_bytes!("../assets/fonts/VKSans-400.ttf").to_vec()
            ]);
        let shaped = engine.shape("Ag", "VK Sans", 48.0, 400);
        assert!(!shaped.glyphs.is_empty(), "shaping 不应为空");
        for glyph in &shaped.glyphs {
            assert!(
                !engine.face_has_color(glyph.cache_key),
                "单色 face 不应过彩色门"
            );
            assert!(
                matches!(
                    engine.glyph_render(glyph.cache_key),
                    GlyphRender::Outline(_)
                ),
                "单色字形必须留在矢量轮廓通道"
            );
        }
    }

    #[test]
    fn stroked_glyph_masks_expand_once_and_reuse_the_cached_alpha() {
        let mut engine =
            TextEngine::with_document_fonts(&[
                include_bytes!("../assets/fonts/VKSans-400.ttf").to_vec()
            ]);
        let shaped = engine.shape("O", "VK Sans", 48.0, 400);
        let key = shaped.glyphs[0].cache_key;
        let GlyphAtlasRender::Mask(base) = engine.glyph_atlas_render(key) else {
            panic!("普通字形必须有基础 mask")
        };
        let GlyphAtlasRender::Mask(first) = engine.glyph_stroke_atlas_render(key, 6.0) else {
            panic!("普通字形必须有描边 mask")
        };
        let GlyphAtlasRender::Mask(second) = engine.glyph_stroke_atlas_render(key, 6.0) else {
            panic!("缓存命中仍必须返回描边 mask")
        };
        assert!(first.width >= base.width && first.height >= base.height);
        assert!(first.left <= base.left);
        assert!(-first.top <= -base.top);
        assert_eq!(first.key, second.key);
        assert!(Arc::ptr_eq(&first.alpha, &second.alpha));
    }

    /// 限容缓存必须真的限容：超预算后按最近最少使用淘汰到 3/4 水位，刚命中过
    /// 的和刚插入的条目留下，并把被淘汰的键交还给调用方（`glyph_path` 靠它顺手
    /// 清 swash 的轮廓影子）。
    #[test]
    fn budget_cache_evicts_least_recently_used_down_to_the_low_water_mark() {
        let mut cache: BudgetCache<u32, Vec<u8>> = BudgetCache::new(4096);
        for id in 0..6_u32 {
            assert!(
                cache.insert(id, vec![0_u8; 512]).is_empty(),
                "还没超预算就不该淘汰"
            );
        }
        assert_eq!(cache.entries.len(), 6);
        // 让 0、1 成为最近使用的两条
        assert!(cache.get(&0).is_some());
        assert!(cache.get(&1).is_some());

        let evicted = cache.insert(6, vec![0_u8; 512]);
        assert_eq!(evicted, vec![2, 3], "最久未使用的先走，且键要交还给调用方");
        assert!(
            cache.bytes <= 4096 / 4 * 3,
            "淘汰必须一路降到低水位，而不是刚好压回预算线"
        );
        for present in [0_u32, 1, 4, 5, 6] {
            assert!(cache.get(&present).is_some(), "{present} 不该被淘汰");
        }
        for gone in [2_u32, 3] {
            assert!(cache.get(&gone).is_none(), "{gone} 应已被淘汰");
        }
        assert_eq!(
            cache.bytes,
            cache
                .entries
                .values()
                .map(|entry| entry.bytes)
                .sum::<usize>(),
            "字节账必须与表内容一致，否则预算会随淘汰漂移"
        );
    }

    /// 淘汰只影响性能，不影响像素：轮廓被踢掉之后重算，必须与第一次逐点相同。
    /// swash 的轮廓影子也一并清掉，所以这是一次真正的冷路径重算。
    #[test]
    fn evicting_a_glyph_outline_does_not_change_the_recomputed_path() {
        let mut engine =
            TextEngine::with_document_fonts(&[
                include_bytes!("../assets/fonts/VKSans-400.ttf").to_vec()
            ]);
        let shaped = engine.shape("Ag", "VK Sans", 48.0, 400);
        let key = shaped.glyphs[0].cache_key;
        let before = engine.glyph_path(key).expect("字形应有轮廓");

        engine.path_cache.entries.clear();
        engine.path_cache.bytes = 0;
        engine.swash.outline_command_cache.clear();

        let after = engine.glyph_path(key).expect("重算后仍应有轮廓");
        assert_eq!(before.verbs(), after.verbs());
        assert_eq!(before.points(), after.points());
    }

    /// 字节账要跟着实际内容走：shaping / 轮廓 / atlas mask 与能力门都不是零，
    /// 且六个缓存都在各自预算内。
    #[test]
    fn cache_accounting_tracks_real_content_and_stays_under_budget() {
        let mut engine =
            TextEngine::with_document_fonts(&[
                include_bytes!("../assets/fonts/VKSans-400.ttf").to_vec()
            ]);
        for size in [24.0, 36.0, 48.0] {
            let shaped = engine.shape("BaoCut 渲染", "VK Sans", size, 400);
            for glyph in &shaped.glyphs {
                let _ = engine.glyph_render(glyph.cache_key);
                let _ = engine.glyph_atlas_render(glyph.cache_key);
                let _ = engine.glyph_stroke_atlas_render(glyph.cache_key, 4.0);
            }
        }
        let (shape, path, bitmap, mask, stroke, face) = engine.cache_bytes();
        assert!(
            shape > 0 && path > 0 && mask > 0 && stroke > 0,
            "shaping、轮廓、正文 atlas mask 与描边 mask 缓存都应有内容"
        );
        assert!(shape <= SHAPE_CACHE_BUDGET);
        assert!(path <= PATH_CACHE_BUDGET);
        assert!(bitmap <= BITMAP_CACHE_BUDGET);
        assert!(mask <= MASK_CACHE_BUDGET);
        assert!(stroke <= STROKE_MASK_CACHE_BUDGET);
        assert!(face > 0 && face <= COLOR_FACE_CACHE_BUDGET);
    }

    #[test]
    fn managed_font_shadows_same_family_from_host_database() {
        let mut host = fontdb::Database::new();
        host.load_font_data(include_bytes!("../assets/fonts/VKSans-400.ttf").to_vec());
        let engine = TextEngine::with_font_db_and_fonts(
            host,
            &[include_bytes!("../assets/fonts/VKSans-800.ttf").to_vec()],
        );
        let id = engine
            .font_system
            .db()
            .query(&fontdb::Query {
                families: &[Family::Name("VK Sans")],
                weight: Weight::NORMAL,
                stretch: Stretch::Normal,
                style: Style::Normal,
            })
            .unwrap();
        assert_eq!(
            engine.font_system.db().face(id).unwrap().weight,
            Weight::EXTRA_BOLD,
            "BaoCut 管理的同名 family 应覆盖 host 字体"
        );
    }
}
