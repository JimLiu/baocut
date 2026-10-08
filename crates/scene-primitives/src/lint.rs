//! 两级校验（规范 §16）：Schema 层（结构合法，封闭枚举）→ Lint 层（语义与品味）。

use crate::assets::{self, AssetKind, HostInputs};
use crate::ease::EASE_NAMES;
use crate::json::JsonExt;
use crate::resolve::{Fit, RNode, Resolver, VisualClip};
use crate::timeexpr;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Info,
    Warn,
    Error,
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Severity::Info => write!(f, "info"),
            Severity::Warn => write!(f, "warn"),
            Severity::Error => write!(f, "error"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub rule: &'static str,
    pub severity: Severity,
    pub pointer: String,
    pub message: String,
}

/// 可动画属性 allowlist（规范 §6.4）。唯一实现在 `motion::value`。
pub use motion::value::ANIM_PROPS;

/// 场景数上限（规范 §5.1 / §16 Schema 层，`1..MAX_SCENES`）。`1.244.0` 从 50 提到 400：
/// 一场一个镜头的长片（逐拍切镜的 MV、十分钟讲解）50 场不够用，而场景表只是时间锚点，
/// resolve 与 lint 的开销都随 clip 数线性走，400 场实测不构成瓶颈。
pub const MAX_SCENES: usize = 400;

/// `resolve()` 失败时的错误消息前缀 → lint 码（规范 §16）。
///
/// 顺序即匹配优先级：靠前的前缀先命中。`"component-"` 是**故意的宽前缀**——
/// 实际消息有 `component-cycle:` 与 `component-unknown:` 两种，旧实现把两者
/// 都归到 `component-cycle`，收窄会改变现有 lint 输出。
pub const RESOLVE_ERROR_CODES: &[(&str, &str)] = &[
    ("time-ref-cycle", "time-ref-cycle"),
    ("time-ref-unknown", "time-ref-unknown"),
    ("transition-mismatch", "transition-mismatch"),
    ("transition-unknown", "transition-unknown"),
    ("component-", "component-cycle"),
    ("preset-unknown", "preset-unknown"),
    ("preset-version-unknown", "preset-version-unknown"),
    ("preset-compose-cycle", "preset-compose-cycle"),
    ("preset-param-unknown", "preset-param-unknown"),
    ("preset-param-missing", "preset-param-missing"),
    (
        "effect-capability-unsupported",
        "effect-capability-unsupported",
    ),
    ("relative-basis-unresolved", "relative-basis-unresolved"),
    ("motion-legacy-and-flow", "motion-legacy-and-flow"),
    ("split-line-unsupported", "split-line-unsupported"),
    // 规范 §16 没有为「flow 结构违规」定独立码（它是 schema 层的事），
    // `motion-unsupported` 同理（阶段 3 未实现的能力）。
    ("motion-flow-invalid", "schema"),
    ("motion-unsupported", "schema"),
    // 规范 §16 没有为「相对长度写在不允许的属性上」定独立码，归 schema。
    ("relative-not-allowed", "schema"),
    ("manifest-invalid", "schema"),
    ("word-anchor-unmapped", "word-anchor-unmapped"),
    ("word-anchor-ambiguous", "word-anchor-ambiguous"),
    ("word-anchor-no-transcript", "word-anchor-no-transcript"),
    ("word-anchor-name-clash", "word-anchor-name-clash"),
    ("asset-media-outside-project", "asset-media-outside-project"),
    ("path-command-unsupported", "path-command-unsupported"),
    ("path-morph-topology", "path-morph-topology"),
    ("mask-source-unknown", "mask-source-unknown"),
];

/// 本实现会产出的全部 lint 码。`tests/lint_codes.rs` 拿它对规范 §16 的表逐条 grep。
pub const LINT_RULES: &[(&str, Severity)] = &[
    ("schema", Severity::Error),
    ("resolve-error", Severity::Error),
    ("time-ref-cycle", Severity::Error),
    ("time-ref-unknown", Severity::Error),
    ("track-overlap", Severity::Error),
    ("transition-mismatch", Severity::Error),
    ("transition-unknown", Severity::Error),
    ("component-cycle", Severity::Error),
    ("clip-outside-scenes", Severity::Error),
    ("camera-multi-track", Severity::Error),
    ("caption-lane-unknown", Severity::Error),
    ("caption-words-mismatch", Severity::Error),
    ("caption-from-unknown-media", Severity::Error),
    ("caption-from-and-items", Severity::Error),
    ("asset-media-outside-project", Severity::Error),
    ("word-anchor-unmapped", Severity::Error),
    ("word-anchor-ambiguous", Severity::Error),
    ("word-anchor-no-transcript", Severity::Error),
    ("word-anchor-name-clash", Severity::Error),
    ("scene-id-reserved", Severity::Error),
    ("element-id-duplicate", Severity::Error),
    ("path-command-unsupported", Severity::Error),
    ("path-outside-svg", Severity::Warn),
    ("svg-child-unsupported", Severity::Warn),
    ("text-newline", Severity::Warn),
    ("text-align-needs-wrap", Severity::Warn),
    ("layout-align-ignored", Severity::Warn),
    ("text-emoji-no-glyph", Severity::Warn),
    ("path-morph-topology", Severity::Error),
    ("mask-source-unknown", Severity::Error),
    ("path-morph-no-target", Severity::Warn),
    ("clip-path-evenodd", Severity::Warn),
    ("cue-off-grid", Severity::Warn),
    ("transition-in-sketch", Severity::Warn),
    ("cadence-fps-mismatch", Severity::Info),
    ("sketch-mixed-finish", Severity::Warn),
    ("sketch-color-off-palette", Severity::Warn),
    ("sketch-text-outside-signoff", Severity::Warn),
    // host 侧产出（`bcut lint --sheet` 渲染抽帧）：core 只登记词表
    ("sketch-blank-frame", Severity::Warn),
    ("preset-unknown", Severity::Error),
    ("preset-version-unknown", Severity::Error),
    ("preset-compose-cycle", Severity::Error),
    ("preset-param-unknown", Severity::Error),
    ("preset-param-missing", Severity::Error),
    ("relative-basis-unresolved", Severity::Error),
    ("motion-legacy-and-flow", Severity::Error),
    ("motion-shader-inline", Severity::Error),
    ("split-line-unsupported", Severity::Error),
    ("bcf-version-unsupported", Severity::Error),
    ("effect-capability-unsupported", Severity::Error),
    // 两级码：fail（子集之外，见 §6.5.2）在资源加载期就是硬错误；warn
    // （无表达式的 `ef ty=5` 控制器组）经 preflight 报告透出。表里记较强的
    // 那一级——`bcut lint` 本身不产出它（lint 无 I/O，读不到素材字节）。
    ("lottie-unsupported-feature", Severity::Error),
    // `program` 资产声明（§6.5.3）：尺寸 / 帧率 / 帧数 / imports / files / props 的形态；
    // `bcut lint` 的模块图检查也用它报 files 里不合法的路径。
    ("program-invalid", Severity::Error),
    // `program` 的 src / imports / files 用 `..` 越出文档所在目录（§6.5.3）。本模块查静态看得到
    // 的这三处；模块里的相对 import 由 `bcut lint` 的模块图检查（bcut-compile
    // `program::graph`，读盘、不求值）与资源加载期报同一个码，`asset()` 只有加载期查得到。
    ("program-path-escape", Severity::Error),
    // 下面三条本模块不产出（纯函数无 I/O）：`bcut lint` 在宿主层读盘扫静态导入时报，
    // 资源加载期报同一个码（§6.5.3）。`1.244.0` 起进 lint。
    ("program-module-not-found", Severity::Error),
    ("program-compile-failed", Severity::Error),
    ("program-file-missing", Severity::Error),
    // 程序用了渲染器画不出的写法（不支持的 CSS 属性等），降级后照常出帧；由资源
    // 加载期试渲首帧收集，经 preflight 报告透出，`bcut lint` 不产出它。
    ("program-degraded", Severity::Warn),
    ("event-id-missing", Severity::Error),
    ("event-id-duplicate", Severity::Error),
    ("event-time-invalid", Severity::Error),
    ("event-phase-invalid", Severity::Error),
    ("event-outside-doc", Severity::Warn),
    ("element-id-missing", Severity::Warn),
    // clip 根元素的 style.x / style.y 不生效（根节点从画布原点布局，§6.4）。`1.244.0` 起。
    ("clip-root-xy-ignored", Severity::Warn),
    ("dead-air", Severity::Warn),
    ("narration-idle", Severity::Warn),
    ("bcf-version-missing", Severity::Warn),
    ("effect-fallback-applied", Severity::Warn),
    ("transition-fallback-applied", Severity::Warn),
    ("preset-sprawl", Severity::Warn),
    ("motion-replace-overlap", Severity::Warn),
    ("caption-flash", Severity::Warn),
    ("text-beat-too-short", Severity::Warn),
    ("video-window-overrun", Severity::Warn),
    ("z-reserved-band", Severity::Warn),
    ("scene-dur-long", Severity::Warn),
    ("preset-alias-used", Severity::Info),
    ("effect-determinism-visual", Severity::Info),
    ("experimental-field", Severity::Info),
    ("caption-highlight-no-words", Severity::Info),
    ("orphan-scene", Severity::Info),
    ("abs-time-used", Severity::Info),
];

/// 零文本度量：lint 与模板归一化只需要盒子几何，不需要字体。
pub(crate) struct ZeroMeasure;
impl crate::layout::TextMeasure for ZeroMeasure {
    fn measure(
        &mut self,
        _t: &str,
        _f: &str,
        size: f64,
        _w: u16,
    ) -> crate::layout::TextMetricsLine {
        crate::layout::TextMetricsLine {
            width: 0.0,
            ascent: size * 0.8,
            descent: size * 0.2,
        }
    }
}

/// 错误消息 → lint 码。`resolve-error` 是兜底。
pub fn resolve_error_code(msg: &str) -> &'static str {
    RESOLVE_ERROR_CODES
        .iter()
        .find(|(prefix, _)| msg.starts_with(prefix))
        .map(|(_, code)| *code)
        .unwrap_or("resolve-error")
}

/// 样式子集（规范 §6.3，封闭枚举）
pub const STYLE_KEYS: &[&str] = &[
    "width",
    "height",
    "x",
    "y",
    "padding",
    "gap",
    "layout",
    "columns",
    "flex",
    "align",
    "justify",
    "background",
    "color",
    "borderRadius",
    "border",
    "shadow",
    "opacity",
    "font",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "textWrap",
    "textStroke",
    "scale",
    "scaleX",
    "scaleY",
    "rotation",
    "anchor",
    "overflow",
    "clipPath",
    "mask",
    "blendMode",
    "z",
];

/// `style.blendMode` 的封闭枚举（§6.6）。唯一实现在 `motion::effect::BlendMode`。
pub fn blend_modes() -> [&'static str; 9] {
    motion::effect::BlendMode::ALL.map(motion::effect::BlendMode::as_str)
}

pub const NODE_TYPES: &[&str] = &[
    "charGrid",
    "proc",
    "composition",
    "box",
    "text",
    "image",
    "animatedImage",
    "lottie",
    "program",
    "video",
    "svg",
    "path",
    "group",
    "use",
];

/// variables[].type 封闭枚举（§11.1；asset 为 v0.3 新增）
pub const VAR_TYPES: &[&str] = &[
    "string", "number", "color", "boolean", "enum", "json", "asset",
];

macro_rules! diag {
    ($out:expr, $rule:expr, $sev:expr, $ptr:expr, $msg:expr) => {
        $out.push(Diagnostic {
            rule: $rule,
            severity: $sev,
            pointer: $ptr,
            message: $msg,
        })
    };
}

/// `program` 资产静态看得到的路径（`src`、`imports` 的值、`files` 的每一项）用 `..` 越出文档
/// 所在目录 → `program-path-escape`（§6.5.3），指针落到具体那一项。形态错误（不是字符串等）
/// 归 `program-invalid`，这里只看拿得到的字符串。
fn lint_program_paths(out: &mut Vec<Diagnostic>, id: &str, ptr: &str, entry: &Value) {
    use crate::program_path::{PATH_ESCAPE, escape_message, escapes};
    // RFC 6901：键里的 `~` / `/` 转义
    let token = |name: &str| name.replace('~', "~0").replace('/', "~1");
    let mut escape = |pointer: String, subject: String, path: &str| {
        diag!(
            out,
            PATH_ESCAPE,
            Severity::Error,
            pointer,
            format!("program 资产 \"{id}\"：{}", escape_message(&subject, path))
        );
    };
    if let Some(src) = entry.gstr("src")
        && escapes("", src)
    {
        escape(format!("{ptr}/src"), "src".into(), src);
    }
    if let Some(imports) = entry.get_("imports").and_then(Value::as_object) {
        for (name, target) in imports {
            if let Some(target) = target.as_str()
                && escapes("", target)
            {
                escape(
                    format!("{ptr}/imports/{}", token(name)),
                    format!("imports.{name}"),
                    target,
                );
            }
        }
    }
    if let Some(files) = entry.get_("files").and_then(Value::as_array) {
        for (index, file) in files.iter().enumerate() {
            if let Some(file) = file.as_str()
                && escapes("", file)
            {
                escape(
                    format!("{ptr}/files/{index}"),
                    format!("files[{index}]"),
                    file,
                );
            }
        }
    }
}

/// 校验剖面（ADR-M12）。
///
/// * `Document` —— 作者的项目文档。`visual` / `backend` 等级的效果只发 info
///   （`effect-determinism-visual`）：作者自己知道自己在换什么。
///
/// 旧 `DistributableTemplate`（`.bctpl` 可分发模板，`template-effect-determinism`
/// 报 error）已随 `.bctpl` 体系删除。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LintProfile {
    #[default]
    Document,
    /// 手绘风格的美术纪律（规范 §16）：在 `document` 之上加 `sketch-*` 规则。
    Sketch,
}

impl LintProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            LintProfile::Document => "document",
            LintProfile::Sketch => "sketch",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "document" => Some(LintProfile::Document),
            "sketch" => Some(LintProfile::Sketch),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct LintOptions {
    pub profile: LintProfile,
}

pub fn lint(doc: &Value) -> Vec<Diagnostic> {
    lint_with_inputs(doc, None)
}

/// 带 host 注入的完整校验：`inputs` 提供词级转录（`~` 锚点求值）与媒体元数据
/// （`video-window-overrun` 需要 duration）。纯文档场景传 None。
pub fn lint_with_inputs(doc: &Value, inputs: Option<&HostInputs>) -> Vec<Diagnostic> {
    lint_with_options(doc, inputs, LintOptions::default())
}

/// [`lint_with_inputs`] 的完整形态：额外指定校验剖面（ADR-M12）。
pub fn lint_with_options(
    doc: &Value,
    inputs: Option<&HostInputs>,
    options: LintOptions,
) -> Vec<Diagnostic> {
    let profile = options.profile;
    let mut out: Vec<Diagnostic> = Vec::new();

    // 顶层版本键（ADR-M13）。缺键按 0.1 读（warn），未知版本是硬错误——
    // 「未知更高版本不得静默降级」。0.1 永远可读。
    let declared = doc.gstr("bcut");
    if declared.is_none() {
        diag!(
            out,
            "bcf-version-missing",
            Severity::Warn,
            "/bcut".to_string(),
            format!(
                "缺少顶层 bcut 版本键，按 \"{}\" 读取；`bcut migrate` 可就地补齐（§4）",
                crate::migrate::BCF_FALLBACK
            )
        );
    } else if let Some(version) = declared.filter(|v| !crate::migrate::is_supported(v)) {
        diag!(
            out,
            "bcf-version-unsupported",
            Severity::Error,
            "/bcut".to_string(),
            format!(
                "文档声明的 bcut 版本 \"{version}\" 不在本实现支持的 {:?}；不得静默降级读取（§4）",
                crate::migrate::BCF_VERSIONS
            )
        );
    }
    // ADR-M13：实验字段只在 0.1 文档上发 info；升 `bcut: "0.2"` 后它们转正式。
    let experimental_fields_apply = crate::migrate::doc_version(doc) == "0.1";
    // BCF 是纯数据：shader / 脚本 / 表达式在**整篇文档**里都不允许（ADR-M07）。
    lint_executable_content(doc, "", &mut out);

    // ── meta / scenes（Schema 层） ──
    match doc.get_("meta") {
        None => diag!(
            out,
            "schema",
            Severity::Error,
            "/meta".into(),
            "缺少 meta".into()
        ),
        Some(m) => {
            for k in ["id", "width", "height"] {
                if m.get_(k).is_none() {
                    diag!(
                        out,
                        "schema",
                        Severity::Error,
                        format!("/meta/{k}"),
                        format!("meta.{k} 必填")
                    );
                }
            }
        }
    }
    match doc.get_("scenes").and_then(Value::as_array) {
        None => diag!(
            out,
            "schema",
            Severity::Error,
            "/scenes".into(),
            "缺少 scenes".into()
        ),
        Some(ss) => {
            if ss.is_empty() || ss.len() > MAX_SCENES {
                diag!(
                    out,
                    "schema",
                    Severity::Error,
                    "/scenes".into(),
                    format!("场景数 {} 超出 1..{MAX_SCENES}", ss.len())
                );
            }
            let mut seen = HashSet::new();
            for (i, s) in ss.iter().enumerate() {
                let ptr = format!("/scenes/{i}");
                match s.gstr("id") {
                    None => diag!(
                        out,
                        "schema",
                        Severity::Error,
                        format!("{ptr}/id"),
                        "场景缺少 id".into()
                    ),
                    Some(id) => {
                        if !seen.insert(id.to_string()) {
                            diag!(
                                out,
                                "schema",
                                Severity::Error,
                                format!("{ptr}/id"),
                                format!("场景 id \"{id}\" 重复")
                            );
                        }
                        // `doc` 是 @doc 保留锚点（§3.3），不能作为用户场景 id
                        if id == "doc" {
                            diag!(
                                out,
                                "scene-id-reserved",
                                Severity::Error,
                                format!("{ptr}/id"),
                                "场景 id \"doc\" 是保留锚点（@doc），请改名".into()
                            );
                        }
                    }
                }
                match s.get_("dur") {
                    None => diag!(
                        out,
                        "schema",
                        Severity::Error,
                        format!("{ptr}/dur"),
                        "场景缺少 dur".into()
                    ),
                    Some(v) => {
                        if let Some(d) = v.as_f64() {
                            // dur 必须为正是硬约束；300s 上限是品味提示（§5.1）——
                            // §20.9 的隐式宿主投影把整片投成单场景，长字幕项目
                            // 天然超过 300s，不能因此判死。
                            if d <= 0.0 {
                                diag!(
                                    out,
                                    "schema",
                                    Severity::Error,
                                    format!("{ptr}/dur"),
                                    format!("场景 dur {d} 须为正数")
                                );
                            } else if d > 300.0 {
                                diag!(
                                    out,
                                    "scene-dur-long",
                                    Severity::Warn,
                                    format!("{ptr}/dur"),
                                    format!(
                                        "场景 dur {d} 超过 300s 建议上限（长场景建议拆分；隐式宿主投影的单场景除外）"
                                    )
                                );
                            }
                        } else if !v.as_str().is_some_and(|s| s.starts_with("$vars.")) {
                            // number 或 "$vars.x"（§5.1）；实际数值在 resolve 期落定
                            diag!(
                                out,
                                "schema",
                                Severity::Error,
                                format!("{ptr}/dur"),
                                format!("场景 dur {v} 须为正数或 \"$vars.x\" 数字变量引用")
                            );
                        }
                    }
                }
                if s.gstr("desc").map_or(true, |d| d.is_empty()) {
                    diag!(
                        out,
                        "scene-desc-missing",
                        Severity::Error,
                        format!("{ptr}/desc"),
                        "场景 desc 必填（叙事锚点，规范 §5.1）".into()
                    );
                }
            }
        }
    }

    // ── variables 表（§11.1）：type 封闭枚举；asset 类型值形态 ──
    let mut var_types: HashMap<String, String> = HashMap::new();
    for (vi, v) in doc
        .get_("variables")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .enumerate()
    {
        let ptr = format!("/variables/{vi}");
        let Some(id) = v.gstr("id") else {
            diag!(
                out,
                "schema",
                Severity::Error,
                format!("{ptr}/id"),
                "变量缺少 id".into()
            );
            continue;
        };
        let ty = v.gstr("type").unwrap_or("");
        if !VAR_TYPES.contains(&ty) {
            diag!(
                out,
                "schema",
                Severity::Error,
                format!("{ptr}/type"),
                format!("变量 \"{id}\" type \"{ty}\" 不在 {}", VAR_TYPES.join("|"))
            );
        } else {
            var_types.insert(id.to_string(), ty.to_string());
        }
        if ty == "enum"
            && v.get_("options")
                .and_then(Value::as_array)
                .is_none_or(|a| a.is_empty())
        {
            diag!(
                out,
                "schema",
                Severity::Error,
                format!("{ptr}/options"),
                format!("enum 变量 \"{id}\" 缺少 options")
            );
        }
        if ty == "asset" {
            if let Some(d) = v.get_("default").filter(|d| !d.is_null()) {
                let obj = d.as_object();
                if obj.is_some_and(|o| o.contains_key("media")) {
                    diag!(
                        out,
                        "asset-media-outside-project",
                        Severity::Error,
                        format!("{ptr}/default"),
                        format!("asset 变量 \"{id}\" 的 {{media}} 形态需要 Project 容器（§17）")
                    );
                } else if !obj.is_some_and(|o| o.get("src").and_then(Value::as_str).is_some()) {
                    diag!(
                        out,
                        "schema",
                        Severity::Error,
                        format!("{ptr}/default"),
                        format!("asset 变量 \"{id}\" 的默认值须为 {{src, hash?}} 对象")
                    );
                }
            }
        }
    }

    // ── assets 表（§11.2）：type 封闭枚举、src|media|var 三选一、hash 格式 ──
    let mut asset_kinds: HashMap<String, AssetKind> = HashMap::new();
    if let Some(entries) = doc.get_("assets").and_then(Value::as_object) {
        for (id, entry) in entries {
            let ptr = format!("/assets/{id}");
            match entry.gstr("type").and_then(AssetKind::parse) {
                Some(kind) => {
                    asset_kinds.insert(id.clone(), kind);
                }
                None => diag!(
                    out,
                    "schema",
                    Severity::Error,
                    format!("{ptr}/type"),
                    format!(
                        "asset type \"{}\" 不在 image|animatedImage|lottie|program|video|audio|font",
                        entry.gstr("type").unwrap_or("")
                    )
                ),
            }
            let has_src = entry.gstr("src").is_some_and(|s| !s.is_empty());
            let has_var = entry.gstr("var").is_some_and(|s| !s.is_empty());
            let has_media = entry.get_("media").is_some();
            if has_media {
                diag!(
                    out,
                    "asset-media-outside-project",
                    Severity::Error,
                    format!("{ptr}/media"),
                    format!("asset \"{id}\" 的 media 引用需要 Project 容器（§17）")
                );
            }
            match (has_src, has_var) {
                (false, false) if !has_media => diag!(
                    out,
                    "schema",
                    Severity::Error,
                    format!("{ptr}/src"),
                    format!("asset \"{id}\" 须有 src / media / var 之一")
                ),
                (true, true) => diag!(
                    out,
                    "schema",
                    Severity::Error,
                    format!("{ptr}/var"),
                    format!("asset \"{id}\" 的 src 与 var 互斥（三选一）")
                ),
                _ => {}
            }
            if has_var {
                let var_name = entry.gstr("var").unwrap_or("");
                match var_types.get(var_name) {
                    None => diag!(
                        out,
                        "schema",
                        Severity::Error,
                        format!("{ptr}/var"),
                        format!("asset \"{id}\" 委托的变量 \"{var_name}\" 未声明")
                    ),
                    Some(t) if t != "asset" => diag!(
                        out,
                        "schema",
                        Severity::Error,
                        format!("{ptr}/var"),
                        format!("asset \"{id}\" 委托的变量 \"{var_name}\" type 是 {t}，须为 asset")
                    ),
                    _ => {}
                }
            }
            if entry.gstr("type") == Some("program") {
                if has_var {
                    diag!(
                        out,
                        "program-invalid",
                        Severity::Error,
                        format!("{ptr}/var"),
                        format!("program 资产 \"{id}\" 不接受 var 委托（§6.5.3）")
                    );
                } else {
                    if let Err(error) = assets::ProgramReq::parse(id, entry) {
                        let message = error.to_string();
                        diag!(
                            out,
                            "program-invalid",
                            Severity::Error,
                            ptr.clone(),
                            message
                                .strip_prefix("program-invalid: ")
                                .unwrap_or(&message)
                                .to_string()
                        );
                    }
                    lint_program_paths(&mut out, id, &ptr, entry);
                }
            }
            if let Some(h) = entry.gstr("hash") {
                if !assets::valid_hash(h) {
                    diag!(
                        out,
                        "asset-hash-format",
                        Severity::Error,
                        format!("{ptr}/hash"),
                        "hash 须为 \"sha256-\" + 64 位十六进制".into()
                    );
                }
            }
        }
    }

    // ── tracks：kind 枚举、camera/captions 至多一条、TimeExpr 语法、abs-time ──
    let mut camera_tracks = 0;
    let mut caption_tracks = 0;
    let tracks = doc
        .get_("tracks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for (ti, tr) in tracks.iter().enumerate() {
        let kind = tr.gstr("kind").unwrap_or("visual");
        if !["visual", "camera", "captions", "audio"].contains(&kind) {
            diag!(
                out,
                "schema",
                Severity::Error,
                format!("/tracks/{ti}/kind"),
                format!("未知 track kind \"{kind}\"")
            );
        }
        if kind == "camera" {
            camera_tracks += 1;
        }
        if kind == "captions" {
            caption_tracks += 1;
        }
        for (ci, c) in tr
            .get_("clips")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
        {
            let ptr = format!("/tracks/{ti}/clips/{ci}");
            for key in ["start", "end"] {
                if let Some(v) = c.get_(key).filter(|v| !v.is_null()) {
                    if v.is_number() {
                        diag!(
                            out,
                            "abs-time-used",
                            Severity::Info,
                            format!("{ptr}/{key}"),
                            format!(
                                "clip \"{}\" 的 {key} 是裸绝对秒，reflow 时不跟随",
                                c.gstr("id").unwrap_or("?")
                            )
                        );
                    } else if let Some(s) = v.as_str() {
                        if let Err(e) = timeexpr::parse(s) {
                            diag!(
                                out,
                                "schema",
                                Severity::Error,
                                format!("{ptr}/{key}"),
                                e.to_string()
                            );
                        }
                    }
                }
            }
            if kind == "visual" {
                if let Some(el) = c.get_("element") {
                    lint_element(
                        el,
                        &format!("{ptr}/element"),
                        &asset_kinds,
                        experimental_fields_apply,
                        profile,
                        &mut out,
                    );
                    // 稳定 id 纪律（直接编辑回写方案 §4.3-1）：舞台编辑的地址
                    // 是元素路径，没有 id 的节点只能退化成下标段，作者一重排就失配。
                    lint_element_ids(el, &format!("{ptr}/element"), &mut out);
                    lint_clip_root_xy(c, el, &format!("{ptr}/element"), &mut out);
                }
            }
            if kind == "captions" {
                lint_captions(c, &ptr, &mut out);
            }
            if kind == "audio" {
                lint_media_src(
                    c.get_("src"),
                    AssetKind::Audio,
                    &format!("{ptr}/src"),
                    &asset_kinds,
                    &mut out,
                );
            }
        }
    }
    if camera_tracks > 1 || caption_tracks > 1 {
        diag!(
            out,
            "camera-multi-track",
            Severity::Error,
            "/tracks".into(),
            format!(
                "camera 轨 {camera_tracks} 条 / captions 轨 {caption_tracks} 条（各至多 1 条）"
            )
        );
    }

    // ── 项目级 preset：可动画属性 / ease 枚举 ──
    if let Some(presets) = doc.get_("presets").and_then(Value::as_object) {
        for (name, def) in presets {
            for (ki, ch) in def
                .get_("keyframes")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new())
                .iter()
                .enumerate()
            {
                let ptr = format!("/presets/{name}/keyframes/{ki}");
                if let Some(prop) = ch.gstr("prop") {
                    if !motion::value::is_animatable(prop) {
                        diag!(
                            out,
                            "schema",
                            Severity::Error,
                            format!("{ptr}/prop"),
                            format!(
                                "\"{prop}\" 不在可动画属性 allowlist{}（§6.4）",
                                motion::value::not_animatable_hint(prop)
                            )
                        );
                    }
                }
                for (fi, f) in ch
                    .get_("frames")
                    .and_then(Value::as_array)
                    .unwrap_or(&Vec::new())
                    .iter()
                    .enumerate()
                {
                    if let Some(e) = f.gstr("ease") {
                        if !EASE_NAMES.contains(&e) {
                            diag!(
                                out,
                                "schema",
                                Severity::Error,
                                format!("{ptr}/frames/{fi}/ease"),
                                format!("未知 ease \"{e}\"（封闭枚举）")
                            );
                        }
                    }
                }
            }
        }
    }

    // ── component-cycle ──
    if let Some(comps) = doc.get_("components").and_then(Value::as_object) {
        let mut edges: HashMap<String, Vec<String>> = HashMap::new();
        for (name, def) in comps {
            let mut used = Vec::new();
            let root = def.get_("root").unwrap_or(&Value::Null);
            collect_uses(root, &mut used);
            edges.insert(name.clone(), used);
            // 组件根是自己的路径空间（方案 §4.3：组件内节点的 authored 从根起算）
            if root.is_object() {
                lint_element_ids(root, &format!("/components/{name}/root"), &mut out);
            }
        }
        for start in edges.keys() {
            let mut stack = vec![start.clone()];
            let mut visited = HashSet::new();
            while let Some(cur) = stack.pop() {
                if !visited.insert(cur.clone()) {
                    continue;
                }
                for next in edges.get(&cur).cloned().unwrap_or_default() {
                    if &next == start {
                        diag!(
                            out,
                            "component-cycle",
                            Severity::Error,
                            format!("/components/{start}"),
                            format!("组件 \"{start}\" 递归实例化（经 \"{cur}\"）")
                        );
                        stack.clear();
                        break;
                    }
                    stack.push(next);
                }
            }
        }
    }

    lint_preset_vocabulary(doc, &mut out);
    let unknown_presets = lint_preset_refs_known(doc, &mut out);
    // resolve 快速失败：它报的 `preset-unknown` 若已在引用处静态报过，就不再在 `/` 重复一条。
    let already_reported = |msg: &str| {
        msg.strip_prefix("preset-unknown: \"")
            .and_then(|rest| rest.strip_suffix('"'))
            .is_some_and(|name| unknown_presets.contains(name))
    };

    // ── 需要窗口求值的检查：track-overlap / time-ref-* / clip-outside-scenes ──
    match Resolver::new(doc.clone(), None) {
        Ok(mut r) => {
            if let Some(inputs) = inputs {
                r.set_host_inputs(inputs.clone());
            }
            match r.resolve() {
                Ok(mut ir) => {
                    // 阶段 2：lint 不跑真实布局，但要跑一次**零度量**布局，
                    // 好让相对长度的求值（以及 `relative-basis-unresolved`）
                    // 在 lint 期就发生。零宽盒仍然是盒——该码的语义是
                    // 「目标没有布局盒」。
                    let (cw, ch) = (ir.w, ir.h);
                    for clip in &mut ir.visual_clips {
                        crate::layout::layout_tree(&mut clip.tree, cw, ch, &mut ZeroMeasure);
                    }
                    if let Err(e) = crate::resolve::build_channels_after_layout(&mut ir) {
                        let msg = e.to_string();
                        diag!(
                            out,
                            resolve_error_code(&msg),
                            Severity::Error,
                            "/".into(),
                            msg
                        );
                    }
                    for vc in &ir.visual_clips {
                        // IR 的 clip 已经跨轨排序过，回不到原始 `/tracks/{i}/clips/{j}`；
                        // 用 clip id 定位，作者仍然能一眼找到出问题的片段。
                        lint_replace_overlap(
                            &vc.tree,
                            &format!("/clips/{}/element", vc.id),
                            &mut out,
                        );
                    }
                    for (ti, tr) in tracks.iter().enumerate() {
                        let mut wins: Vec<(String, f64, f64)> = Vec::new();
                        for c in tr
                            .get_("clips")
                            .and_then(Value::as_array)
                            .unwrap_or(&Vec::new())
                        {
                            let Some(id) = c.gstr("id") else { continue };
                            if let Some(&(Some(s), Some(e))) = r.clip_wins.get(id) {
                                wins.push((id.to_string(), s, e));
                                if e > ir.total + 1e-6 {
                                    diag!(
                                        out,
                                        "clip-outside-scenes",
                                        Severity::Error,
                                        format!("/tracks/{ti}"),
                                        format!(
                                            "clip \"{id}\" 窗口 [{s}, {e}] 超出全片时长 {}",
                                            ir.total
                                        )
                                    );
                                }
                            }
                        }
                        wins.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
                        for w in wins.windows(2) {
                            // 声明窗口重叠（转场交叠是编译器物化的，不看 render 窗口）
                            if w[0].2 - w[1].1 > 1e-6 {
                                diag!(
                                    out,
                                    "track-overlap",
                                    Severity::Error,
                                    format!("/tracks/{ti}"),
                                    format!(
                                        "clip \"{}\" [{:.2},{:.2}] 与 \"{}\" [{:.2},{:.2}] 时间重叠",
                                        w[0].0, w[0].1, w[0].2, w[1].0, w[1].1, w[1].2
                                    )
                                );
                            }
                        }
                    }
                    // video 引用窗口越界（§16）：需要 host 探测的 duration
                    for vc in &ir.visual_clips {
                        lint_video_overrun(&vc.tree, vc, &mut out);
                    }
                    lint_cadence(doc, &ir, &mut out);
                    lint_narration_idle(doc, &ir, &mut out);
                    // 顶层 `events[]`（§4.2）：渲染不读，但 `t` 解不出 / id 重复是文档错误
                    for issue in crate::events::resolve_events(&r, &ir.scenes, ir.total).issues {
                        out.push(Diagnostic {
                            rule: issue.rule,
                            severity: issue.severity,
                            pointer: issue.pointer,
                            message: issue.message,
                        });
                    }
                    if profile == LintProfile::Sketch {
                        lint_sketch(doc, &ir, &mut out);
                    }
                }
                Err(e) => {
                    let msg = e.to_string();
                    if !already_reported(&msg) {
                        diag!(
                            out,
                            resolve_error_code(&msg),
                            Severity::Error,
                            "/".into(),
                            msg
                        );
                    }
                }
            }
        }
        Err(e) => {
            let msg = e.to_string();
            if !already_reported(&msg) {
                diag!(
                    out,
                    resolve_error_code(&msg),
                    Severity::Error,
                    "/".into(),
                    msg
                );
            }
        }
    }

    out.sort_by(|a, b| b.severity.cmp(&a.severity).then(a.pointer.cmp(&b.pointer)));
    out
}

/// `motion-replace-overlap`（warn，规范 §7.7 / §16）：同一属性有多条时间重叠的
/// `replace` 通道，后者按 `order` 覆盖前者。
///
/// 判定直接在 `RNode::channels` 上做，而不是绕 `MotionProgram`——通道的
/// `(composite, order)` 就是 `lower_bcf` 会原样搬过去的那两个字段，
/// 中间多一层转换只会让 pointer 丢失。
fn lint_replace_overlap(node: &RNode, ptr: &str, out: &mut Vec<Diagnostic>) {
    use motion::CompositeMode;

    let span = |ch: &crate::sample::Channel| -> Option<(f64, f64)> {
        Some((ch.frames.first()?.t, ch.frames.last()?.t))
    };
    for (i, a) in node.channels.iter().enumerate() {
        if a.composite != CompositeMode::Replace {
            continue;
        }
        let Some((a0, a1)) = span(a) else { continue };
        for b in node.channels.iter().skip(i + 1) {
            if b.composite != CompositeMode::Replace || b.prop != a.prop {
                continue;
            }
            let Some((b0, b1)) = span(b) else { continue };
            let t0 = a0.max(b0);
            let t1 = a1.min(b1);
            if t1 - t0 <= 1e-9 {
                continue;
            }
            let (early, late) = if a.order <= b.order {
                (a.order, b.order)
            } else {
                (b.order, a.order)
            };
            diag!(
                out,
                "motion-replace-overlap",
                Severity::Warn,
                format!("{ptr}/animate"),
                format!(
                    "元素 \"{}\" 的属性 \"{}\" 有两条 replace 轨在 [{t0:.3}, {t1:.3}] 重叠，order {late} 覆盖 order {early}（§7.7）",
                    node.id, a.prop
                )
            );
        }
    }
    for (i, child) in node.children.iter().enumerate() {
        lint_replace_overlap(child, &format!("{ptr}/children/{i}"), out);
    }
}

/// 文档里出现的全部 preset 引用：`(id, pointer)`。
fn collect_preset_refs(el: &Value, ptr: &str, out: &mut Vec<(String, String)>) {
    if let Some(a) = el.get_("animate") {
        for slot in ["enter", "exit"] {
            if let Some(id) = a.get_(slot).and_then(|v| v.gstr("preset")) {
                out.push((id.to_string(), format!("{ptr}/animate/{slot}/preset")));
            }
        }
        for (i, em) in a
            .get_("emphasis")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
        {
            if let Some(id) = em.gstr("preset") {
                out.push((id.to_string(), format!("{ptr}/animate/emphasis/{i}/preset")));
            }
        }
    }
    for (i, c) in el
        .get_("children")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .enumerate()
    {
        collect_preset_refs(c, &format!("{ptr}/children/{i}"), out);
    }
}

/// `animate.flow` / `animate.parts` 里 `op: "preset"` 条目的引用：`(id, pointer)`。
/// 沿 `item` / `items[]` 走完整棵 op 树（§7.5 / §7.9）。
fn collect_op_preset_refs(el: &Value, ptr: &str, out: &mut Vec<(String, String)>) {
    fn walk(op: &Value, ptr: &str, out: &mut Vec<(String, String)>) {
        let Some(map) = op.as_object() else { return };
        if map.get("op").and_then(Value::as_str) == Some("preset") {
            if let Some(id) = map.get("preset").and_then(Value::as_str) {
                out.push((id.to_string(), format!("{ptr}/preset")));
            }
        }
        if let Some(item) = map.get("item") {
            walk(item, &format!("{ptr}/item"), out);
        }
        for (i, item) in map
            .get("items")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
        {
            walk(item, &format!("{ptr}/items/{i}"), out);
        }
    }
    if let Some(a) = el.get_("animate") {
        for slot in ["flow", "parts"] {
            if let Some(root) = a.get_(slot) {
                walk(root, &format!("{ptr}/animate/{slot}"), out);
            }
        }
    }
    for (i, c) in el
        .get_("children")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .enumerate()
    {
        collect_op_preset_refs(c, &format!("{ptr}/children/{i}"), out);
    }
}

/// `preset-unknown`（error，§7.4 / §16）的静态检查：在引用处报，不等 resolve。
///
/// resolve 快速失败，只要文档里有更早的错误（例如 `motion-unsupported`），写错的 preset
/// 就一直看不见；这里按两条查找路径各自判定，与 resolve 的判定逐条对应：
///
/// - `enter` / `exit` / `emphasis[i]`：项目级 `presets` → 通用 manifest（含 alias）→
///   冻结的 `bcf.*@1` 配方（`Resolver::slot_channels`）；
/// - flow / parts 的 `op: "preset"`：只查注册表（manifest 与冻结配方），**不读**项目级
///   `presets`（`motion::graph` 直接调 `preset_registry::expand`）。
///
/// 值以 `$` 开头的（变量引用）留给 resolve。返回报过的名字，供 resolve 那条去重。
fn lint_preset_refs_known(doc: &Value, out: &mut Vec<Diagnostic>) -> HashSet<String> {
    use motion::preset_registry::{bcf_preset, canonical_id, manifest};
    let registry_known = |id: &str| {
        let canonical = canonical_id(id);
        manifest(canonical).is_some() || bcf_preset(canonical).is_some()
    };
    let project_level = |id: &str| doc.get_("presets").and_then(|p| p.get_(id)).is_some();
    let mut slots: Vec<(String, String)> = Vec::new();
    let mut ops: Vec<(String, String)> = Vec::new();
    for (ti, tr) in doc
        .get_("tracks")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .enumerate()
    {
        for (ci, c) in tr
            .get_("clips")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
        {
            if let Some(el) = c.get_("element") {
                let ptr = format!("/tracks/{ti}/clips/{ci}/element");
                collect_preset_refs(el, &ptr, &mut slots);
                collect_op_preset_refs(el, &ptr, &mut ops);
            }
        }
    }
    let mut reported = HashSet::new();
    for (id, ptr) in &slots {
        if id.starts_with('$') || project_level(id) || registry_known(id) {
            continue;
        }
        diag!(
            out,
            "preset-unknown",
            Severity::Error,
            ptr.clone(),
            format!(
                "preset-unknown: \"{id}\" 不是项目级 presets、内置 motion.* family 或 bcf.* 配方（§7.4 / 附录 B）"
            )
        );
        reported.insert(id.clone());
    }
    for (id, ptr) in &ops {
        if id.starts_with('$') || registry_known(id) {
            continue;
        }
        let hint = if project_level(id) {
            "；项目级 presets 只能用在 enter / exit / emphasis，flow / parts 的 op: \"preset\" 只认内置 motion.* family 与 bcf.* 配方"
        } else {
            "（§7.5 / 附录 B）"
        };
        diag!(
            out,
            "preset-unknown",
            Severity::Error,
            ptr.clone(),
            format!("preset-unknown: \"{id}\" 不是内置 preset{hint}")
        );
        reported.insert(id.clone());
    }
    reported
}

/// 规范 §16：项目级 preset 使用超过 ~4 种入场/强调词汇（`preset-sprawl`，warn）
/// 与 `preset-alias-used`（info）。
///
/// 统计口径（两条）：
///
/// 1. **归一到 canonical family**：`Back In Left` 与 `Back In Right` 都是 `backIn`，
///    只算一种词汇——这正是设计 §5.4.3「UI 词汇与 canonical family 分离」的收益。
///    项目级 `presets` 里的 id 各自算一个 family。
/// 2. **冻结的 `bcf.*@1` 功能配方不计入**（`countUp` / `barFill` / `kenBurns` /
///    `fadeIn` / `fadeOut`）。规则量的是「入场/强调**词汇**」这一风格维度；
///    数字滚动与进度条填充是功能而不是风格，把它们算进去会让
///    `core/runtime/starter` 那种「全片只用 rise / draw / pop」
///    的模范文档也报警。
const PRESET_SPRAWL_THRESHOLD: usize = 4;

fn lint_preset_vocabulary(doc: &Value, out: &mut Vec<Diagnostic>) {
    let mut refs: Vec<(String, String)> = Vec::new();
    for (ti, tr) in doc
        .get_("tracks")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .enumerate()
    {
        for (ci, c) in tr
            .get_("clips")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
        {
            if let Some(el) = c.get_("element") {
                collect_preset_refs(el, &format!("/tracks/{ti}/clips/{ci}/element"), &mut refs);
            }
        }
    }
    let project_level = |id: &str| doc.get_("presets").and_then(|p| p.get_(id)).is_some();
    let mut families: HashSet<String> = HashSet::new();
    for (id, ptr) in &refs {
        if project_level(id) {
            families.insert(id.clone());
            continue;
        }
        let canonical = motion::preset_registry::canonical_id(id);
        if canonical != id {
            diag!(
                out,
                "preset-alias-used",
                Severity::Info,
                ptr.clone(),
                format!(
                    "\"{id}\" 是旧名 alias，建议写成 canonical family：{{\"preset\": \"{canonical}\", \"params\": {{…}}}}（§7.4 / 附录 B）"
                )
            );
        }
        if let Some(family) = motion::preset_registry::family_of(id) {
            families.insert(family.to_string());
        }
    }
    if families.len() > PRESET_SPRAWL_THRESHOLD {
        let mut names: Vec<&str> = families.iter().map(String::as_str).collect();
        names.sort_unstable();
        diag!(
            out,
            "preset-sprawl",
            Severity::Warn,
            "/tracks".to_string(),
            format!(
                "全片用了 {} 种入场/强调词汇（{}），超过建议的 {PRESET_SPRAWL_THRESHOLD} 种，片子会显得碎（§7.4）",
                names.len(),
                names.join("、")
            )
        );
    }
}

/// `video-window-overrun`（warn）：clip 窗口按 playbackRate 换算的媒体需求
/// 超出 segment / 源时长且未开 loop（§16）。duration 未探测（=0）时跳过。
/// `animatedImage` / `lottie` / `program` 同理——采样公式与 §6.5 同构，越界也是冻结末帧。
fn lint_video_overrun(node: &RNode, vc: &VisualClip, out: &mut Vec<Diagnostic>) {
    lint_video_overrun_window(node, vc, vc.end - vc.start, out);
}

fn lint_video_overrun_window(
    node: &RNode,
    vc: &VisualClip,
    duration: f64,
    out: &mut Vec<Diagnostic>,
) {
    if matches!(
        node.ntype.as_str(),
        "video" | "animatedImage" | "lottie" | "program"
    ) && !node.loop_media
    {
        let limit = match (node.segment, node.media_duration > 0.0) {
            (Some((_, s1)), true) => Some(s1.min(node.media_duration)),
            (Some((_, s1)), false) => Some(s1),
            (None, true) => Some(node.media_duration),
            (None, false) => None,
        };
        if let Some(limit) = limit {
            let need = node.time_map.as_ref().map_or(
                node.media_start + duration * node.playback_rate,
                |map| {
                    map.points
                        .iter()
                        .filter(|(t, _)| *t <= duration)
                        .map(|(_, source)| *source)
                        .fold(map.sample(duration), f64::max)
                },
            );
            if need > limit + 1e-6 {
                diag!(
                    out,
                    "video-window-overrun",
                    Severity::Warn,
                    format!(
                        "/tracks (clip \"{}\" {} \"{}\")",
                        vc.id, node.ntype, node.id
                    ),
                    format!(
                        "媒体需求至 {need:.2}s 超出可用范围 {limit:.2}s，超出部分冻结末帧（loop: true 可循环）"
                    )
                );
            }
        }
    }
    for c in &node.children {
        lint_video_overrun_window(
            c,
            vc,
            node.composition
                .as_ref()
                .map_or(duration, |canvas| canvas.duration),
            out,
        );
    }
}

fn collect_uses(node: &Value, out: &mut Vec<String>) {
    if node.gstr("type") == Some("use") {
        if let Some(c) = node.gstr("component") {
            out.push(c.to_string());
        }
    }
    for c in node
        .get_("children")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
    {
        collect_uses(c, out);
    }
}

/// media src：必须 $assets.* 且已声明、kind 匹配（把"渲染期未知路径"拦在编译期，§15）
fn lint_media_src(
    src: Option<&Value>,
    want: AssetKind,
    ptr: &str,
    asset_kinds: &HashMap<String, AssetKind>,
    out: &mut Vec<Diagnostic>,
) {
    let Some(s) = src.and_then(Value::as_str) else {
        diag!(
            out,
            "schema",
            Severity::Error,
            ptr.to_string(),
            "src 必填".into()
        );
        return;
    };
    match assets::asset_ref_id(s) {
        None => diag!(
            out,
            "asset-src-literal",
            Severity::Error,
            ptr.to_string(),
            format!("src \"{s}\" 不接受裸路径/URL，必须是 $assets.* 引用（§11.2）")
        ),
        Some(id) => match asset_kinds.get(id) {
            None => diag!(
                out,
                "asset-unknown",
                Severity::Error,
                ptr.to_string(),
                format!("引用的资源 \"{id}\" 未在 assets 表声明")
            ),
            Some(k) if *k != want => diag!(
                out,
                "asset-kind-mismatch",
                Severity::Error,
                ptr.to_string(),
                format!("资源 \"{id}\" 是 {k}，此处需要 {want}")
            ),
            _ => {}
        },
    }
}

// ── 元素级检查（可复用）───────────────────────────────────────────────
//
// 下面三个函数按节点类型白名单 / 样式子集 / animate 结构分别检查，`types` 与
// `rule` 参数化（文档 lint 传 `NODE_TYPES` + `"schema"`），诊断留在各自的规则族内。

/// 节点 `type` 必须在白名单内（§6.1）。
pub(crate) fn lint_node_type(
    el: &Value,
    ptr: &str,
    types: &[&str],
    rule: &'static str,
    out: &mut Vec<Diagnostic>,
) {
    let t = el.gstr("type").unwrap_or("");
    if !types.contains(&t) {
        diag!(
            out,
            rule,
            Severity::Error,
            format!("{ptr}/type"),
            format!("未知节点类型 \"{t}\"")
        );
    }
}

/// `style` 键必须在封闭子集内（§6.3）。
pub(crate) fn lint_style_keys(
    el: &Value,
    ptr: &str,
    rule: &'static str,
    out: &mut Vec<Diagnostic>,
) {
    if let Some(style) = el.get_("style").and_then(Value::as_object) {
        for k in style.keys() {
            if !STYLE_KEYS.contains(&k.as_str()) {
                diag!(
                    out,
                    rule,
                    Severity::Error,
                    format!("{ptr}/style/{k}"),
                    format!(
                        "样式属性 \"{k}\" 不在封闭子集{}（§6.3）",
                        if k == "backgroundColor" {
                            "；style 里背景色写 background，backgroundColor 只是动画通道名"
                        } else {
                            ""
                        }
                    )
                );
            }
        }
    }
}

/// 效果参数通道 `effects[N].<param>`（§6.6）必须指向本元素 `effects[]` 里真实存在的
/// 条目与**数值**参数（number / length）。越界下标、未知参数、布尔 / 颜色 / 枚举参数
/// 都是 error——渲染期找不到对应条目的通道只会被静默忽略，这里是唯一的拦截点。
fn lint_effect_channel(
    el: &Value,
    prop: &str,
    ptr: String,
    rule: &'static str,
    out: &mut Vec<Diagnostic>,
) {
    use motion::effect::{ParamKind, lookup};
    let Some((index, param)) = motion::value::effect_param_channel(prop) else {
        return;
    };
    let Some(item) = el
        .get_("effects")
        .and_then(Value::as_array)
        .and_then(|items| items.get(index))
    else {
        diag!(
            out,
            rule,
            Severity::Error,
            ptr,
            format!("\"{prop}\" 指向不存在的 effects[{index}]（§6.6）")
        );
        return;
    };
    let Some(id) = item.gstr("preset") else {
        return; // 缺 preset 已由 lint_effects 报过
    };
    let version = item
        .get_("presetVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1) as u32;
    let Ok(manifest) = lookup(id, version) else {
        return; // 未知效果已由 lint_effects 报过
    };
    match manifest.params.get(param).map(|spec| spec.kind) {
        Some(ParamKind::Number | ParamKind::Length) => {}
        Some(_) => diag!(
            out,
            rule,
            Severity::Error,
            ptr,
            format!(
                "\"{prop}\"：{} 的参数 {param} 不是数值，不能做关键帧动画（§6.6）",
                manifest.qualified()
            )
        ),
        None => diag!(
            out,
            "preset-param-unknown",
            Severity::Error,
            ptr,
            format!(
                "\"{prop}\"：{} 没有参数 {param}；{}（§6.6）",
                manifest.qualified(),
                manifest.params_hint()
            )
        ),
    }
}

/// `animate.flow` 里任意层级的 `{ prop }` 都按 [`lint_effect_channel`] 查一遍。
fn lint_flow_effect_channels(
    el: &Value,
    node: &Value,
    ptr: &str,
    rule: &'static str,
    out: &mut Vec<Diagnostic>,
) {
    match node {
        Value::Object(map) => {
            if let Some(prop) = map.get("prop").and_then(Value::as_str) {
                lint_effect_channel(el, prop, format!("{ptr}/prop"), rule, out);
            }
            for (key, child) in map {
                lint_flow_effect_channels(el, child, &format!("{ptr}/{key}"), rule, out);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                lint_flow_effect_channels(el, child, &format!("{ptr}/{index}"), rule, out);
            }
        }
        _ => {}
    }
}

/// `animate.keyframes[].prop` 在 allowlist 内（§6.4），`frames[].ease` 在封闭枚举内。
pub(crate) fn lint_animate(el: &Value, ptr: &str, rule: &'static str, out: &mut Vec<Diagnostic>) {
    if let Some(flow) = el.get_("animate").and_then(|a| a.get_("flow")) {
        lint_flow_effect_channels(el, flow, &format!("{ptr}/animate/flow"), rule, out);
    }
    if let Some(a) = el.get_("animate") {
        for (ki, ch) in a
            .get_("keyframes")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
        {
            if let Some(prop) = ch.gstr("prop") {
                if !motion::value::is_animatable(prop) {
                    diag!(
                        out,
                        rule,
                        Severity::Error,
                        format!("{ptr}/animate/keyframes/{ki}/prop"),
                        format!(
                            "\"{prop}\" 不在可动画属性 allowlist{}（§6.4）",
                            motion::value::not_animatable_hint(prop)
                        )
                    );
                }
                lint_effect_channel(
                    el,
                    prop,
                    format!("{ptr}/animate/keyframes/{ki}/prop"),
                    rule,
                    out,
                );
            }
            for (fi, f) in ch
                .get_("frames")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new())
                .iter()
                .enumerate()
            {
                if let Some(e) = f.gstr("ease") {
                    if !EASE_NAMES.contains(&e) {
                        diag!(
                            out,
                            rule,
                            Severity::Error,
                            format!("{ptr}/animate/keyframes/{ki}/frames/{fi}/ease"),
                            format!("未知 ease \"{e}\"（封闭枚举）")
                        );
                    }
                }
                // `clipPath` 通道的每个取值必须是可解析的参数化形状（§6.3）；
                // 录制期没有 `Result`，非法值只能在这里拦。
                if ch.gstr("prop") == Some("clipPath")
                    && let Some(v) = f.get_("v")
                    && let Err(error) = crate::resolve::ClipShape::parse(v)
                {
                    let msg = error.to_string();
                    diag!(
                        out,
                        if msg.starts_with("effect-capability-unsupported") {
                            "effect-capability-unsupported"
                        } else {
                            rule
                        },
                        Severity::Error,
                        format!("{ptr}/animate/keyframes/{ki}/frames/{fi}/v"),
                        msg
                    );
                }
                // 规范 §7.8：相对长度只用于 transform、blur 与效果参数。
                // 规范 §16 没有为这个情形定独立码，沿用调用方的 schema 码。
                if let (Some(prop), Some(v)) = (ch.gstr("prop"), f.get_("v")) {
                    if motion::preset_registry::manifest::is_relative_length_object(v)
                        && !motion::RELATIVE_LENGTH_PROPS.contains(&prop)
                    {
                        diag!(
                            out,
                            rule,
                            Severity::Error,
                            format!("{ptr}/animate/keyframes/{ki}/frames/{fi}/v"),
                            format!(
                                "属性 \"{prop}\" 不接受相对长度；只有 {:?} 可以（§7.8）",
                                motion::RELATIVE_LENGTH_PROPS
                            )
                        );
                    }
                }
            }
        }
    }
}

/// 值里还有 `$theme.*` / `$vars.*` 引用 ⇒ 形态校验留给 resolve（它先解引用）。
fn has_dollar_ref(value: &Value) -> bool {
    match value {
        Value::String(s) => s.starts_with('$'),
        Value::Array(items) => items.iter().any(has_dollar_ref),
        Value::Object(map) => map.values().any(has_dollar_ref),
        _ => false,
    }
}

/// `style.background`（渐变对象）、`style.shadow`、`style.fontStyle`、`style.mask`
/// 的形态校验（§6.3）。这些键此前只在 `STYLE_KEYS` 里放行，值却没人看：作者写
/// `linear-gradient(...)` 或 CSS 阴影字串时 lint 沉默、渲染没画，这里把口子堵上。
/// 存在性（`mask.source` 指向的元素）由 resolve 报 `mask-source-unknown`。
pub(crate) fn lint_style_values(
    el: &Value,
    ptr: &str,
    rule: &'static str,
    out: &mut Vec<Diagnostic>,
) {
    let Some(style) = el.get_("style").and_then(Value::as_object) else {
        return;
    };
    if let Some(stroke) = style.get("textStroke").filter(|v| !v.is_null()) {
        if !has_dollar_ref(stroke) {
            if let Err(error) = crate::resolve::TextStroke::parse(stroke) {
                diag!(
                    out,
                    rule,
                    Severity::Error,
                    format!("{ptr}/style/textStroke"),
                    error.to_string()
                );
            }
        }
    }
    if let Some(bg) = style.get("background").filter(|v| !v.is_null()) {
        // 字串形态：即使是 `$theme.x` 也不该含 `gradient(`；对象形态有引用则交给 resolve。
        let check = match bg {
            Value::String(s) => s.contains("gradient(") || !s.starts_with('$'),
            _ => !has_dollar_ref(bg),
        };
        if check && let Err(error) = crate::resolve::BgGradient::parse(bg) {
            diag!(
                out,
                rule,
                Severity::Error,
                format!("{ptr}/style/background"),
                error.to_string()
            );
        }
    }
    if let Some(shadow) = style.get("shadow").filter(|v| !v.is_null())
        && !has_dollar_ref(shadow)
        && let Err(error) = crate::resolve::BoxShadow::parse(shadow)
    {
        diag!(
            out,
            rule,
            Severity::Error,
            format!("{ptr}/style/shadow"),
            error.to_string()
        );
    }
    if let Some(border) = style.get("border").filter(|v| !v.is_null())
        && !has_dollar_ref(border)
        && let Err(error) = crate::resolve::BoxBorder::parse(border)
    {
        diag!(
            out,
            rule,
            Severity::Error,
            format!("{ptr}/style/border"),
            error.to_string()
        );
    }
    if let Some(font_style) = style.get("fontStyle").filter(|v| !v.is_null())
        && !has_dollar_ref(font_style)
        && !matches!(font_style.as_str(), Some("normal") | Some("italic"))
    {
        diag!(
            out,
            rule,
            Severity::Error,
            format!("{ptr}/style/fontStyle"),
            format!("style.fontStyle {font_style} 必须是 normal | italic（§6.3）")
        );
    }
    if let Some(mask) = style.get("mask").filter(|v| !v.is_null())
        && !has_dollar_ref(mask)
        && let Err(error) = crate::resolve::ElementMask::parse(mask)
    {
        diag!(
            out,
            rule,
            Severity::Error,
            format!("{ptr}/style/mask"),
            error.to_string()
        );
    }
}

/// `effects[]`（§6.6）、`style.blendMode`、`style.clipPath` 的语义校验。
///
/// 词汇表来自 `motion::effect` 的内置注册表——lint 与渲染读的是同一份
/// manifest，不存在「lint 放行、渲染报错」的第二事实来源。
pub(crate) fn lint_effects(
    el: &Value,
    ptr: &str,
    rule: &'static str,
    profile: LintProfile,
    out: &mut Vec<Diagnostic>,
) {
    if let Some(mode) = el
        .get_("style")
        .and_then(|s| s.get_("blendMode"))
        .filter(|v| !v.is_null())
    {
        let ok = mode
            .as_str()
            .is_some_and(|text| motion::effect::BlendMode::parse(text).is_some());
        if !ok {
            diag!(
                out,
                rule,
                Severity::Error,
                format!("{ptr}/style/blendMode"),
                format!("blendMode {mode} 不在封闭枚举 {:?}（§6.6）", blend_modes())
            );
        }
    }
    if let Some(clip) = el
        .get_("style")
        .and_then(|s| s.get_("clipPath"))
        .filter(|v| !v.is_null())
        && let Err(error) = match crate::resolve::ClipPoly::parse(clip) {
            // `path` 形状只在静态 style 上合法（§6.3）
            Ok(Some(_)) => Ok(()),
            Ok(None) => crate::resolve::ClipShape::parse(clip).map(|_| ()),
            Err(error) => Err(error),
        }
    {
        let msg = error.to_string();
        diag!(
            out,
            if msg.starts_with("effect-capability-unsupported") {
                "effect-capability-unsupported"
            } else if msg.starts_with("path-command-unsupported") {
                "path-command-unsupported"
            } else {
                rule
            },
            Severity::Error,
            format!("{ptr}/style/clipPath"),
            msg
        );
    }
    lint_style_values(el, ptr, rule, out);
    for field in ["effects", "backdropEffects"] {
        let Some(effects) = el.get_(field).filter(|v| !v.is_null()) else {
            continue;
        };
        let Some(items) = effects.as_array() else {
            diag!(
                out,
                rule,
                Severity::Error,
                format!("{ptr}/{field}"),
                "effects 必须是数组（§6.6）".to_string()
            );
            continue;
        };
        for (index, item) in items.iter().enumerate() {
            let eptr = format!("{ptr}/{field}/{index}");
            let Some(id) = item.gstr("preset") else {
                diag!(
                    out,
                    rule,
                    Severity::Error,
                    eptr,
                    "effects[] 条目缺少 preset（§6.6）".to_string()
                );
                continue;
            };
            let version = match item.get_("presetVersion") {
                Some(value) if !value.is_null() => match value.as_u64() {
                    Some(v) => v as u32,
                    None => {
                        diag!(
                            out,
                            rule,
                            Severity::Error,
                            format!("{eptr}/presetVersion"),
                            "presetVersion 必须是整数".to_string()
                        );
                        continue;
                    }
                },
                _ => 1,
            };
            let manifest = match motion::effect::lookup(id, version) {
                Ok(manifest) => manifest,
                Err(error) => {
                    let msg = error.to_string();
                    diag!(out, resolve_error_code(&msg), Severity::Error, eptr, msg);
                    continue;
                }
            };
            // 单输入滤镜之外的域（双输入遮罩、composite 表）不能直接挂在元素上。
            if manifest.inputs != 1 || (field == "backdropEffects" && !id.starts_with("filter.")) {
                diag!(
                    out,
                    "effect-capability-unsupported",
                    Severity::Error,
                    format!("{eptr}/preset"),
                    format!(
                        "{} 需要 {} 个输入，元素效果栈只提供 1 个（§6.6）；用另一元素作遮罩请写 style.mask: {{ source: \"#id\", mode }}（§6.3）",
                        manifest.qualified(),
                        manifest.inputs
                    )
                );
                continue;
            }
            // `visual` / `backend` 等级不承诺逐位一致，导出前必须可见（§14.6）。
            if manifest.determinism != motion::effect::Determinism::Strict {
                match profile {
                    LintProfile::Document | LintProfile::Sketch => diag!(
                        out,
                        "effect-determinism-visual",
                        Severity::Info,
                        eptr.clone(),
                        format!(
                            "{} 的确定性等级是 {}，成片不承诺逐位一致（§14.6）",
                            manifest.qualified(),
                            manifest.determinism.as_str()
                        )
                    ),
                }
            }
            if let Err(error) = crate::resolve::parse_effects(&Value::Array(vec![item.clone()])) {
                let msg = error.to_string();
                diag!(out, resolve_error_code(&msg), Severity::Error, eptr, msg);
            }
        }
    }
}

/// 规范 §16 / ADR-M13：0.1 文档使用「实验」字段时发 info。
/// 升 `bcut: "0.2"` 后这些字段转正式，本条静音。
const EXPERIMENTAL_FIELDS: &[(&str, &str)] = &[
    ("/animate/flow", "animate.flow（§7.5）"),
    ("/animate/parts", "animate.parts（§7.9）"),
    ("/split", "split（§7.9）"),
    ("/effects", "effects（§6.6）"),
    ("/style/blendMode", "style.blendMode（§6.6）"),
    ("/states", "states（§7.9）"),
    ("/constraints", "constraints（§7.9）"),
    ("/layoutStates", "layoutStates（§7.9）"),
];

/// 文档里绝不允许出现的可执行内容键（规范 §16 `motion-shader-inline`、ADR-M07）。
/// BCF 是纯数据：没有 shader 源码、没有脚本、没有表达式语言。
const EXECUTABLE_KEYS: &[&str] = &[
    "shader",
    "glsl",
    "wgsl",
    "sksl",
    "metal",
    "script",
    "eval",
    "expression",
];

fn json_pointer_of(field: &str) -> &str {
    field.rsplit('/').next().unwrap_or(field)
}

/// `experimental-field`（info）+ 曲线对象。只在 `bcut == "0.1"` 时调用。
fn lint_experimental_fields(el: &Value, ptr: &str, out: &mut Vec<Diagnostic>) {
    for (field, label) in EXPERIMENTAL_FIELDS {
        let present = match field.rsplit_once('/') {
            Some(("", key)) => el.get_(key).is_some_and(|v| !v.is_null()),
            Some((parent, key)) => el
                .get_(json_pointer_of(parent))
                .and_then(|p| p.get_(key))
                .is_some_and(|v| !v.is_null()),
            None => el.get_(field).is_some_and(|v| !v.is_null()),
        };
        if present {
            diag!(
                out,
                "experimental-field",
                Severity::Info,
                format!("{ptr}{field}"),
                format!("{label} 在 bcut 0.1 里是实验字段，升 \"0.2\" 后转正式（ADR-M13）")
            );
        }
    }
    // 曲线对象（§7.6）同样是实验形态：0.1 的封闭枚举只有名称。
    if let Some(animate) = el.get_("animate") {
        if has_curve_object(animate) {
            diag!(
                out,
                "experimental-field",
                Severity::Info,
                format!("{ptr}/animate"),
                "结构化曲线对象（§7.6 的 cubicBezier / steps / spring）在 bcut 0.1 里是实验形态"
                    .to_string()
            );
        }
    }
}

fn has_curve_object(value: &Value) -> bool {
    match value {
        Value::Object(map) => {
            for key in ["curve", "ease"] {
                if map.get(key).is_some_and(Value::is_object) {
                    return true;
                }
            }
            map.values().any(has_curve_object)
        }
        Value::Array(items) => items.iter().any(has_curve_object),
        _ => false,
    }
}

/// `motion-shader-inline`（error）：文档内出现 shader 源码或其它可执行定义。
fn lint_executable_content(value: &Value, ptr: &str, out: &mut Vec<Diagnostic>) {
    match value {
        Value::Object(map) => {
            for (key, item) in map {
                if EXECUTABLE_KEYS.contains(&key.as_str()) {
                    diag!(
                        out,
                        "motion-shader-inline",
                        Severity::Error,
                        format!("{ptr}/{key}"),
                        format!(
                            "字段 \"{key}\" 是可执行内容；BCF 是纯数据格式，效果只能引用具名配方（§14.6）"
                        )
                    );
                }
                lint_executable_content(item, &format!("{ptr}/{key}"), out);
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                lint_executable_content(item, &format!("{ptr}/{index}"), out);
            }
        }
        _ => {}
    }
}

/// `motion-legacy-and-flow`（error）与 `split-line-unsupported`（error）。
fn lint_flow_structure(el: &Value, ptr: &str, out: &mut Vec<Diagnostic>) {
    if let Some(animate) = el.get_("animate") {
        let has_flow = animate.get_("flow").is_some_and(|v| !v.is_null());
        let legacy: Vec<&str> = crate::resolve::LEGACY_ANIMATE_SLOTS
            .iter()
            .copied()
            .filter(|slot| animate.get_(slot).is_some_and(|v| !v.is_null()))
            .collect();
        if has_flow && !legacy.is_empty() {
            diag!(
                out,
                "motion-legacy-and-flow",
                Severity::Error,
                format!("{ptr}/animate/flow"),
                format!("同一元素不得同时声明 animate.flow 与 {legacy:?}（§7.5）")
            );
        }
        if animate.get_("parts").is_some_and(|v| !v.is_null()) && el.gstr("type") != Some("text") {
            diag!(
                out,
                "schema",
                Severity::Error,
                format!("{ptr}/animate/parts"),
                "animate.parts 只能用在 text 节点上（§7.9）".to_string()
            );
        }
    }
    if let Some(split) = el.get_("split").filter(|v| !v.is_null()) {
        if let Err(error) = crate::resolve::parse_split_unit(split) {
            let msg = error.to_string();
            diag!(
                out,
                resolve_error_code(&msg),
                Severity::Error,
                format!("{ptr}/split/by"),
                msg
            );
        }
    }
}

/// clip 根元素的 `style.x` / `style.y` 不生效：`layout::layout_tree` 把根节点的框固定在画布
/// 原点，`x` / `y` 只在父节点摆放子节点时读（§7）。只看静态写死的值——写 0、`$` 引用（值只有
/// resolve 才知道）不报；`animate` 里的位移是另一条通道，也不在这里管。
fn lint_clip_root_xy(clip: &Value, root: &Value, root_ptr: &str, out: &mut Vec<Diagnostic>) {
    let Some(style) = root.get_("style").and_then(Value::as_object) else {
        return;
    };
    let ignored = |key: &str| -> Option<String> {
        match style.get(key)? {
            Value::Number(n) if n.as_f64() != Some(0.0) => Some(n.to_string()),
            Value::String(s) => {
                let t = s.trim();
                let zero = t
                    .trim_end_matches(|c: char| c.is_ascii_alphabetic() || c == '%')
                    .parse::<f64>()
                    .is_ok_and(|v| v == 0.0);
                (!t.starts_with('$') && !zero).then(|| format!("\"{s}\""))
            }
            _ => None,
        }
    };
    let found: Vec<(&str, String)> = ["x", "y"]
        .into_iter()
        .filter_map(|key| ignored(key).map(|value| (key, value)))
        .collect();
    let Some((first, _)) = found.first() else {
        return;
    };
    let written = found
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join(", ");
    diag!(
        out,
        "clip-root-xy-ignored",
        Severity::Warn,
        format!("{root_ptr}/style/{first}"),
        format!(
            "clip \"{}\" 的根元素写了 style.{written}，但 clip 根节点固定从画布原点布局，x/y 不生效；\
             要定位就把它包进全画幅的 Box（style 宽高 = 画布）作为子节点，再在子节点上写 x/y",
            clip.gstr("id").unwrap_or("?")
        )
    );
}

/// 元素 id 纪律：一棵树内 id 唯一（error），可寻址元素都该有 id（warn）。
///
/// 作用域是**单棵元素树**（一个 clip 的 `element`，或一个组件的 `root`）——
/// 元素路径本来就是 clip 根起算的，跨 clip 重名不会让路径歧义。
fn lint_element_ids(root: &Value, root_ptr: &str, out: &mut Vec<Diagnostic>) {
    let mut seen: HashMap<String, String> = HashMap::new();
    walk_element_ids(root, root_ptr, &mut seen, out);
}

fn walk_element_ids(
    el: &Value,
    ptr: &str,
    seen: &mut HashMap<String, String>,
    out: &mut Vec<Diagnostic>,
) {
    match crate::editpath::stable_id(el) {
        Some(id) => {
            if let Some(first) = seen.get(id) {
                diag!(
                    out,
                    "element-id-duplicate",
                    Severity::Error,
                    format!("{ptr}/id"),
                    format!(
                        "元素 id \"{id}\" 在同一棵元素树里重复（首次出现 {first}）；元素路径会指向两个节点"
                    )
                );
            } else {
                seen.insert(id.to_string(), ptr.to_string());
            }
        }
        None => {
            // 容器与纯装饰节点没有 id 也能渲染，只是不可寻址：报 warn 不挡导出。
            diag!(
                out,
                "element-id-missing",
                Severity::Warn,
                ptr.to_string(),
                format!(
                    "{} 元素没有稳定 id，舞台编辑只能按下标寻址（重排即失配）",
                    el.gstr("type").unwrap_or("?")
                )
            );
        }
    }
    let mut local_seen = HashMap::new();
    let seen = if el.gstr("type") == Some("composition") {
        &mut local_seen
    } else {
        seen
    };
    for (i, c) in el
        .get_("children")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .enumerate()
    {
        walk_element_ids(c, &format!("{ptr}/children/{i}"), seen, out);
    }
}

fn lint_element(
    el: &Value,
    ptr: &str,
    asset_kinds: &HashMap<String, AssetKind>,
    experimental: bool,
    profile: LintProfile,
    out: &mut Vec<Diagnostic>,
) {
    let t = el.gstr("type").unwrap_or("");
    lint_node_type(el, ptr, NODE_TYPES, "schema", out);
    if let Some(want) = match t {
        "image" => Some(AssetKind::Image),
        "animatedImage" => Some(AssetKind::AnimatedImage),
        "lottie" => Some(AssetKind::Lottie),
        "program" => Some(AssetKind::Program),
        "video" => Some(AssetKind::Video),
        _ => None,
    } {
        lint_media_src(
            el.get_("src"),
            want,
            &format!("{ptr}/src"),
            asset_kinds,
            out,
        );
    }
    if matches!(t, "video" | "animatedImage" | "lottie" | "program") {
        lint_video_fields(el, ptr, out);
    }
    if matches!(t, "animatedImage" | "lottie" | "program") {
        // 三者都没有音轨：`withAudio` / `volume` 在这里是写错了，不是无声生效
        for key in ["withAudio", "volume"] {
            if el.get_(key).is_some_and(|v| !v.is_null()) {
                diag!(
                    out,
                    "schema",
                    Severity::Error,
                    format!("{ptr}/{key}"),
                    format!("{t} 没有音轨，不接受 {key}（§6.5.1 – §6.5.3）")
                );
            }
        }
    }
    if t == "path" {
        lint_path(el, ptr, out);
    }
    if t == "text" {
        lint_text_content(el, ptr, asset_kinds, out);
    }
    lint_clip_path_shape(el, ptr, out);
    lint_style_keys(el, ptr, "schema", out);
    lint_layout_align(el, ptr, out);
    lint_animate(el, ptr, "schema", out);
    lint_effects(el, ptr, "schema", profile, out);
    lint_flow_structure(el, ptr, out);
    if experimental {
        lint_experimental_fields(el, ptr, out);
    }
    if t != "svg" {
        // path 的几何在 Svg 的 viewBox 里解析；放在别处不会被画出来。
        for (i, c) in el
            .get_("children")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
        {
            if c.gstr("type") == Some("path") {
                diag!(
                    out,
                    "path-outside-svg",
                    Severity::Warn,
                    format!("{ptr}/children/{i}"),
                    "path 只在 svg 的直接子节点位置生效（§6.2.1）；这里的 path 不会被画出来"
                        .to_string()
                );
            }
        }
    } else {
        // svg 的子节点限 path（§6.2）：布局只给 path 换算 viewBox、不量别的节点，
        // 预览是真 <svg>，里面的 HTML 节点也不画。`use` 展开后才知道是什么，不报。
        for (i, c) in el
            .get_("children")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
        {
            let ct = c.gstr("type").unwrap_or("");
            if !matches!(ct, "path" | "use" | "") {
                diag!(
                    out,
                    "svg-child-unsupported",
                    Severity::Warn,
                    format!("{ptr}/children/{i}"),
                    format!(
                        "svg 的子节点只能是 path（§6.2）；这里的 {ct} 不会被画出来——把它和 svg 并列放进同一个 group"
                    )
                );
            }
        }
    }
    for (i, c) in el
        .get_("children")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .enumerate()
    {
        lint_element(
            c,
            &format!("{ptr}/children/{i}"),
            asset_kinds,
            experimental,
            profile,
            out,
        );
    }
}

/// `align` / `justify` 只在 `layout: "row" | "column" | "grid"` 下生效（§6.3）。缺省的绝对布局把没写
/// `x` / `y` 的子节点一律放在盒的左上角，两个键写了也被静默丢掉——「圆角卡片里的字贴在左上角」就是
/// 这么来的，渲染端与预览壳都这样画，lint 之前也不吭声。`$` 引用的 `layout` 要等 resolve 才知道值，不查。
fn lint_layout_align(el: &Value, ptr: &str, out: &mut Vec<Diagnostic>) {
    let Some(style) = el.get_("style").filter(|style| style.is_object()) else {
        return;
    };
    match style.get("layout").filter(|layout| !layout.is_null()) {
        None => {}
        Some(Value::String(mode)) if mode == "absolute" => {}
        // row / column / grid 生效；`$` 引用与非法值（schema 另报）不在这里猜
        Some(_) => return,
    }
    let keys: Vec<&str> = ["align", "justify"]
        .into_iter()
        .filter(|key| style.get(*key).is_some_and(|v| !v.is_null()))
        .collect();
    let Some(first) = keys.first() else {
        return;
    };
    diag!(
        out,
        "layout-align-ignored",
        Severity::Warn,
        format!("{ptr}/style/{first}"),
        format!(
            "{} 只在 layout: \"row\" / \"column\" / \"grid\" 下生效（§6.3）；这个节点是缺省的绝对布局，没写 x / y 的子节点照旧落在左上角。要让子节点在盒里居中，加 layout: \"column\"（或用 DSL 的 <Column>）",
            keys.join(" / ")
        )
    );
}

/// text 是单行（§6.2）：`\n` 不换行，`textAlign` 也不生效（旧单行路径恒居中）。
/// 彩色 emoji 由彩色字体画成位图（§14.4 `DrawBitmap`），只在 strict 字体模式
/// （文档声明了 `font` 资产，§11.2）下报：那时系统 emoji 字体不参与回退，文档没带
/// 彩色 emoji 字体就是缺字。lint 看不到字体字节，已声明彩色字体的文档照样会收到这条。
/// `$` 引用的内容要等 resolve 才知道，不查内容；`textAlign` 与内容无关，照查。
fn lint_text_content(
    el: &Value,
    ptr: &str,
    asset_kinds: &HashMap<String, AssetKind>,
    out: &mut Vec<Diagnostic>,
) {
    // 显式 `style.textWrap` 或 `split.by: "line"` 启用多行排版（§6.2.2）：`\n` 是硬换行，
    // `textAlign` 生效。两条都只在没启用时报。
    let paragraph = el
        .get_("style")
        .and_then(|style| style.get("textWrap"))
        .is_some_and(|wrap| !wrap.is_null())
        || el
            .get_("split")
            .and_then(|split| split.gstr("by"))
            .is_some_and(|by| by == "line");
    // 旧单行路径把整行居中在元素盒里、不读 textAlign，连取值都不校验；`$` 引用要等
    // resolve 才知道值，不查。
    let align = el
        .get_("style")
        .and_then(|style| style.get("textAlign"))
        .filter(|v| !v.is_null() && !v.as_str().is_some_and(|s| s.starts_with('$')));
    if let Some(align) = align.filter(|v| v.as_str() != Some("center") && !paragraph) {
        diag!(
            out,
            "text-align-needs-wrap",
            Severity::Warn,
            format!("{ptr}/style/textAlign"),
            format!(
                "没写 style.textWrap 的 text 走旧单行排版（§6.2.2），textAlign {align} 不生效，整行照旧居中在元素盒里；要靠左 / 靠右请加 textWrap: \"none\"（单行不折行）或 \"word\"（配 width 自动折行）"
            )
        );
    }
    let Some(text) = el.gstr("text").filter(|s| !s.starts_with('$')) else {
        return;
    };
    if text.contains('\n') && !paragraph {
        diag!(
            out,
            "text-newline",
            Severity::Warn,
            format!("{ptr}/text"),
            "text 只排一行（§6.2），\\n 不会换行；多行请显式写 style.textWrap（§6.2.2），或每行一个 text 放进 layout: \"column\" 的 box（DSL 的 <Column>）".to_string()
        );
    }
    let strict_fonts = asset_kinds
        .values()
        .any(|kind| matches!(kind, AssetKind::Font));
    if !strict_fonts {
        return;
    }
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if looks_like_color_emoji(c, chars.peek().copied()) {
            diag!(
                out,
                "text-emoji-no-glyph",
                Severity::Warn,
                format!("{ptr}/text"),
                format!(
                    "「{c}」看起来是彩色 emoji：文档声明了 font 资产，渲染处于 strict 字体模式（§11.2），系统 emoji 字体不参与回退，这个字会缺字（§6.2）。把彩色 emoji 字体（sbix / CBDT / COLR）也声明成 font 资产，或改用 image 素材；已经声明了可忽略。本条按码位猜测，可能误报"
                )
            );
            return;
        }
    }
}

/// 彩色 emoji 的码位猜测：主要图形区段、区域指示符、彩色圆 / 方块、🀄 🃏，
/// 以及后跟 U+FE0F（emoji 呈现选择符）的字符。
fn looks_like_color_emoji(c: char, next: Option<char>) -> bool {
    matches!(
        u32::from(c),
        0x1F004
            | 0x1F0CF
            | 0x1F1E6..=0x1F1FF
            | 0x1F300..=0x1F6FF
            | 0x1F7E0..=0x1F7EB
            | 0x1F900..=0x1F9FF
            | 0x1FA70..=0x1FAFF
    ) || next == Some('\u{FE0F}')
}

/// path 的 `d`（§6.2.1）：不认识的命令整条报错——旧实现静默跳过，画出来的形状
/// 会缺一块而没有任何提示。
fn lint_path(el: &Value, ptr: &str, out: &mut Vec<Diagnostic>) {
    let Some(d) = el.gstr("d") else { return };
    let parsed = if d.starts_with('$') {
        crate::svgpath::Parsed::default()
    } else {
        crate::svgpath::parse_checked(d)
    };
    // Variable geometry is validated after evaluation by resolve.
    if !parsed.unsupported.is_empty() {
        let list: Vec<String> = parsed.unsupported.iter().map(char::to_string).collect();
        diag!(
            out,
            "path-command-unsupported",
            Severity::Error,
            format!("{ptr}/d"),
            format!(
                "path.d 含不支持的命令 {}（支持 M L H V C S Q T A Z 及其小写相对形式）",
                list.join(" ")
            )
        );
    }
    // `pathMorph` 通道没有 `morphTo` 可插值时是空转（§6.2.1）。只看 keyframes 槽：
    // preset / flow 展开后的通道由渲染端同样按「无目标 = 原形状」处理。
    let writes_morph = el
        .get_("animate")
        .and_then(|a| a.get_("keyframes"))
        .and_then(Value::as_array)
        .is_some_and(|ks| ks.iter().any(|k| k.gstr("prop") == Some("pathMorph")));
    if writes_morph && el.get_("morphTo").is_none_or(Value::is_null) {
        diag!(
            out,
            "path-morph-no-target",
            Severity::Warn,
            format!("{ptr}/animate/keyframes"),
            "pathMorph 通道需要同一 path 上的 morphTo 目标形状，否则形状不会变".to_string()
        );
    }
}

/// `cadence` 采样域的三条美术纪律（规范 §7.10 / §16）。文档没有任何 clip 处在采样域里时一条都不触发。
fn lint_cadence(doc: &Value, ir: &crate::resolve::Ir, out: &mut Vec<Diagnostic>) {
    let mut mismatch_reported = false;
    for vc in &ir.visual_clips {
        let Some(fps) = vc.cadence.apply(ir.cadence_fps) else {
            continue;
        };
        let cells = vc.start * fps;
        if (cells - cells.round()).abs() > 1e-6 {
            diag!(
                out,
                "cue-off-grid",
                Severity::Warn,
                format!("/clips/{}/start", vc.id),
                format!(
                    "clip \"{}\" 在 {:.4}s 切入，不落在 {fps}fps 的绘制格上；这一刀会切在一张画的中间（最近的格点：{:.4}s）",
                    vc.id,
                    vc.start,
                    cells.round() / fps
                )
            );
        }
        let ratio = ir.fps / fps;
        if !mismatch_reported && (ratio - ratio.round()).abs() > 1e-6 {
            mismatch_reported = true;
            diag!(
                out,
                "cadence-fps-mismatch",
                Severity::Info,
                "/meta/fps".to_string(),
                format!(
                    "输出 {}fps 不是绘制频率 {fps}fps 的整数倍：每张画的停留帧数会长短交替。手绘片推荐 24fps 输出",
                    ir.fps
                )
            );
        }
    }
    let in_domain = |id: &str| {
        ir.visual_clips
            .iter()
            .any(|vc| vc.id == id && vc.cadence.apply(ir.cadence_fps).is_some())
    };
    let empty = Vec::new();
    for (ti, track) in doc
        .get_("tracks")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .enumerate()
    {
        for (ci, clip) in track
            .get_("clips")
            .and_then(Value::as_array)
            .unwrap_or(&empty)
            .iter()
            .enumerate()
        {
            if !clip.gstr("id").is_some_and(in_domain) {
                continue;
            }
            for key in ["transitionIn", "transitionOut"] {
                let preset = clip.get_(key).and_then(|t| t.gstr("preset")).unwrap_or("");
                if matches!(
                    preset,
                    "crossfade" | "bcf.crossfade" | "transition.crossfade"
                ) {
                    diag!(
                        out,
                        "transition-in-sketch",
                        Severity::Warn,
                        format!("/tracks/{ti}/clips/{ci}/{key}"),
                        format!(
                            "处在 cadence 采样域里的 clip 用了 {preset}：逐帧混合会把停格的画面抹成连续渐变。改用硬切、一帧纸色闪白、transition.circleCrop 或 transition.inkBlot"
                        )
                    );
                }
            }
        }
    }
}

/// `narration-idle`：旁白空档的判定阈值（秒）。旁白在说、画面却连续这么久一处都没变，
/// 观众会觉得画面「卡住了」；4 s 大约是一句中等长度的中文台词。
const NARRATION_IDLE_GAP: f64 = 4.0;
/// 短于它的旁白 clip 不查：一两句的串场白里停一拍是正常的。
const NARRATION_IDLE_MIN_CLIP: f64 = 6.0;
/// 每份文档至多报几条；多出来的在最后一条里给总数。
const NARRATION_IDLE_MAX_REPORTS: usize = 8;

/// `narration-idle`（warn，规范 §16）：旁白 clip 播放期间画面连续 >4 s 没有任何变化。
///
/// 只查**旁白**：audio clip 的素材 `src` 落在 `assets/vo/` 下（skill 的项目约定：旁白进
/// `<项目>/assets/vo/`）；音乐床等其它音频不查，音乐先行的片子不误报。「画面在变」的来源：
/// visual clip 的起止瞬间、每个节点关键帧通道（含逐字 part 通道与节点 camera）相邻两帧值
/// 不同的区间、转场（`wrap_channels` 与 Surface Transition 窗口）、camera 轨。通道只在它所在
/// clip 的渲染窗口里算数；单帧通道算一个瞬间。字幕轨不算——它跟着旁白走，算进来就永远报不出。
/// 窗口是旁白**真正在说**的区间：从 clip 起点到音频实长用完为止
/// （`start + (media_duration − media_start) / rate`，再不超过 clip 声明的终点）。旧项目常用
/// `@scene.end` 收尾，旁白说完后的定格不算空档。实长由 host 探测经 `HostInputs` 回填
/// （`bcut lint` 会探测音频素材）；拿不到实长（没探测、文件缺失或解不开）时退回 clip 声明窗口。
/// 6 s 门槛也按这个有效窗口算。
fn lint_narration_idle(doc: &Value, ir: &crate::resolve::Ir, out: &mut Vec<Diagnostic>) {
    use crate::sample::{Channel, Kf};

    let is_narration = |asset_id: &str| {
        doc.get_("assets")
            .and_then(|a| a.get_(asset_id))
            .and_then(|a| a.gstr("src"))
            .is_some_and(|src| src.replace('\\', "/").contains("assets/vo/"))
    };
    let speaking = |ac: &crate::resolve::AudioClip| {
        let mut end = ac.end;
        if ac.media_duration > 0.0 && ac.rate > 0.0 {
            end = end.min(ac.start + (ac.media_duration - ac.media_start).max(0.0) / ac.rate);
        }
        (ac.start, end)
    };
    let windows: Vec<(&str, f64, f64)> = ir
        .audio_clips
        .iter()
        .filter(|ac| is_narration(&ac.asset_id))
        .map(|ac| {
            let (w0, w1) = speaking(ac);
            (ac.id.as_str(), w0, w1)
        })
        .filter(|(_, w0, w1)| w1 - w0 >= NARRATION_IDLE_MIN_CLIP)
        .collect();
    if windows.is_empty() {
        return;
    }

    fn same(a: &Value, b: &Value) -> bool {
        match (a.as_f64(), b.as_f64()) {
            (Some(x), Some(y)) => (x - y).abs() <= 1e-9,
            _ => a == b,
        }
    }
    fn push_frames(frames: &[Kf], lo: f64, hi: f64, spans: &mut Vec<(f64, f64)>) {
        let mut add = |a: f64, b: f64| {
            let (a, b) = (a.max(lo), b.min(hi));
            if a <= b {
                spans.push((a, b));
            }
        };
        if let [only] = frames {
            add(only.t, only.t);
        }
        for pair in frames.windows(2) {
            if !same(&pair[0].v, &pair[1].v) {
                add(pair[0].t.min(pair[1].t), pair[0].t.max(pair[1].t));
            }
        }
    }
    fn push_channels(channels: &[Channel], lo: f64, hi: f64, spans: &mut Vec<(f64, f64)>) {
        for channel in channels {
            push_frames(&channel.frames, lo, hi, spans);
        }
    }
    fn walk(node: &RNode, lo: f64, hi: f64, spans: &mut Vec<(f64, f64)>) {
        push_channels(&node.channels, lo, hi, spans);
        push_frames(&node.local_camera, lo, hi, spans);
        if let Some(parts) = &node.part_motion {
            for channels in &parts.channels {
                push_channels(channels, lo, hi, spans);
            }
        }
        for child in &node.children {
            walk(child, lo, hi, spans);
        }
    }

    // 全片的「变化」区间一次收齐，按起点排序；前缀最大终点让每个旁白窗口二分定位。
    let mut spans: Vec<(f64, f64)> = Vec::new();
    for vc in &ir.visual_clips {
        let (lo, hi) = (vc.render_start, vc.render_end);
        spans.push((vc.start, vc.start));
        spans.push((vc.end, vc.end));
        push_channels(&vc.wrap_channels, lo, hi, &mut spans);
        walk(&vc.tree, lo, hi, &mut spans);
    }
    for cam in &ir.camera_clips {
        push_frames(&cam.frames, cam.start, cam.end, &mut spans);
    }
    for tr in &ir.surface_transitions {
        spans.push((tr.t0 - tr.half, tr.t0 + tr.half));
    }
    spans.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut reach = Vec::with_capacity(spans.len() + 1);
    reach.push(f64::NEG_INFINITY);
    for (_, end) in &spans {
        let last = *reach.last().unwrap_or(&f64::NEG_INFINITY);
        reach.push(last.max(*end));
    }

    let mut gaps: Vec<(&str, f64, f64)> = Vec::new();
    for (clip, w0, w1) in windows {
        let first = spans.partition_point(|s| s.0 < w0);
        let mut cursor = w0.max(reach[first]);
        for &(s, e) in &spans[first..] {
            if s > w1 {
                break;
            }
            if s - cursor > NARRATION_IDLE_GAP {
                gaps.push((clip, cursor, s));
            }
            cursor = cursor.max(e);
        }
        if w1 - cursor > NARRATION_IDLE_GAP {
            gaps.push((clip, cursor, w1));
        }
    }

    let total = gaps.len();
    for (n, (clip, g0, g1)) in gaps
        .into_iter()
        .take(NARRATION_IDLE_MAX_REPORTS)
        .enumerate()
    {
        let (scene, base) = ir
            .scenes
            .iter()
            .find(|(_, s, e)| g0 >= *s - 1e-9 && g0 < *e - 1e-9)
            .or(ir.scenes.last())
            .map(|(id, s, _)| (id.as_str(), *s))
            .unwrap_or(("?", 0.0));
        let mut message = format!(
            "旁白 \"{clip}\" 播到场景 \"{scene}\" 的 {:.2}–{:.2}s（全片 {g0:.2}–{g1:.2}s）时，画面 {:.1}s 没有任何变化（>{NARRATION_IDLE_GAP}s）：照这段旁白的词时间（@baocut/dsl 的 narration().cue）在空档里安排笔画或动作",
            g0 - base,
            g1 - base,
            g1 - g0
        );
        if n + 1 == NARRATION_IDLE_MAX_REPORTS && total > NARRATION_IDLE_MAX_REPORTS {
            message.push_str(&format!(
                "；全片共 {total} 处这样的空档，只列前 {NARRATION_IDLE_MAX_REPORTS} 处"
            ));
        }
        diag!(
            out,
            "narration-idle",
            Severity::Warn,
            format!("/clips/{clip}"),
            message
        );
    }
}

/// `sketch` 剖面（规范 §16）：本风格的美术纪律，不是引擎限制。只看 resolve 后的
/// 节点树——`$theme` 已经落成颜色，`bind: "literal"` 与 `bind: "theme"` 同口径。
fn lint_sketch(doc: &Value, ir: &crate::resolve::Ir, out: &mut Vec<Diagnostic>) {
    use crate::pathstyle::Finish;

    fn key(c: &crate::color::Rgba) -> (u8, u8, u8) {
        (c.r.round() as u8, c.g.round() as u8, c.b.round() as u8)
    }
    fn palette_of(value: &Value, into: &mut Vec<(u8, u8, u8)>) {
        match value {
            Value::String(text) => {
                if let Some(color) = crate::color::Rgba::parse(text) {
                    into.push(key(&color));
                }
            }
            Value::Object(map) => map.values().for_each(|v| palette_of(v, into)),
            Value::Array(items) => items.iter().for_each(|v| palette_of(v, into)),
            _ => {}
        }
    }
    struct Seen {
        finishes: Vec<&'static str>,
        off: Vec<(String, (u8, u8, u8))>,
        texts: Vec<String>,
    }
    fn walk(node: &RNode, palette: &[(u8, u8, u8)], seen: &mut Seen) {
        if node.ntype == "text" {
            seen.texts.push(node.id.clone());
        }
        let mut colors: Vec<(u8, u8, u8)> = Vec::new();
        colors.extend(node.fill.as_ref().map(key));
        colors.extend(node.stroke.as_ref().map(key));
        colors.extend(node.stroke_brush.and_then(|b| b.load).as_ref().map(key));
        if let Some(texture) = &node.texture {
            colors.push(key(&texture.color));
            colors.extend(texture.load.as_ref().map(key));
            let name = match texture.finish {
                Finish::Ink => Some("ink"),
                Finish::Pencil => Some("pencil"),
                Finish::Screen => Some("screen"),
                Finish::Riso => Some("riso"),
                Finish::Wash => Some("wash"),
                Finish::Paint => Some("paint"),
                // flat 什么都不画、grain 是纸面颗粒：都不算一种「上色手法」
                _ => None,
            };
            if let Some(name) = name
                && !seen.finishes.contains(&name)
            {
                seen.finishes.push(name);
            }
        }
        if !palette.is_empty() {
            for color in colors {
                if !palette.contains(&color) && !seen.off.iter().any(|(_, c)| *c == color) {
                    seen.off.push((node.id.clone(), color));
                }
            }
        }
        node.children
            .iter()
            .for_each(|child| walk(child, palette, seen));
    }

    let mut palette = Vec::new();
    if let Some(theme) = doc.get_("theme") {
        palette_of(theme, &mut palette);
    }
    // 收尾场景 = 声明序最后一个 scene；只有它可以出现文字（sign-off）。
    let signoff_from = ir.scenes.last().map(|(_, start, _)| *start);

    for vc in &ir.visual_clips {
        let mut seen = Seen {
            finishes: Vec::new(),
            off: Vec::new(),
            texts: Vec::new(),
        };
        walk(&vc.tree, &palette, &mut seen);
        let ptr = format!("/clips/{}", vc.id);
        if seen.finishes.len() > 1 {
            diag!(
                out,
                "sketch-mixed-finish",
                Severity::Warn,
                ptr.clone(),
                format!(
                    "clip \"{}\" 同时用了 {} 种纹理 finish（{}）；一个镜头只用一种上色手法",
                    vc.id,
                    seen.finishes.len(),
                    seen.finishes.join(" / ")
                )
            );
        }
        for (node, (r, g, b)) in seen.off.iter().take(4) {
            diag!(
                out,
                "sketch-color-off-palette",
                Severity::Warn,
                ptr.clone(),
                format!(
                    "clip \"{}\" 的节点 \"{node}\" 用了 #{r:02x}{g:02x}{b:02x}，它不在 theme 的任何一套配色里；颜色从 look 取",
                    vc.id
                )
            );
        }
        let in_signoff = signoff_from.is_some_and(|from| vc.start >= from - 1e-6);
        if !in_signoff && let Some(first) = seen.texts.first() {
            diag!(
                out,
                "sketch-text-outside-signoff",
                Severity::Warn,
                ptr,
                format!(
                    "clip \"{}\" 里有文字节点 \"{first}\"（共 {} 个）；手绘片只在收尾场景落字，其余靠画面讲",
                    vc.id,
                    seen.texts.len()
                )
            );
        }
    }
}

/// `style.clipPath` 的 `path` 形状（§6.3）：裁剪只有 nonzero 语义。
fn lint_clip_path_shape(el: &Value, ptr: &str, out: &mut Vec<Diagnostic>) {
    let Some(clip) = el.get_("style").and_then(|s| s.get_("clipPath")) else {
        return;
    };
    if clip.gstr("shape") == Some("path") && clip.gstr("fillRule") == Some("evenodd") {
        diag!(
            out,
            "clip-path-evenodd",
            Severity::Warn,
            format!("{ptr}/style/clipPath/fillRule"),
            "clipPath 的 path 形状按 nonzero 裁剪；evenodd 的镂空不会生效，改用方向相反的子路径"
                .to_string()
        );
    }
}

/// video 元素媒体字段（§6.5）：playbackRate / segment / loop / fit / withAudio / volume
fn lint_video_fields(el: &Value, ptr: &str, out: &mut Vec<Diagnostic>) {
    if let Some(r) = el.get_("playbackRate").filter(|v| !v.is_null()) {
        match r.as_f64() {
            Some(x) if x > 0.0 && x.is_finite() => {}
            _ => diag!(
                out,
                "schema",
                Severity::Error,
                format!("{ptr}/playbackRate"),
                format!("playbackRate {r} 须为正数")
            ),
        }
    }
    if let Some(seg) = el.get_("segment").filter(|v| !v.is_null()) {
        let ok = seg.as_array().is_some_and(|a| {
            a.len() == 2
                && a[0]
                    .as_f64()
                    .is_some_and(|s0| a[1].as_f64().is_some_and(|s1| s0 >= 0.0 && s1 > s0))
        });
        if !ok {
            diag!(
                out,
                "schema",
                Severity::Error,
                format!("{ptr}/segment"),
                format!("segment {seg} 须为 [start, end] 且 0 ≤ start < end")
            );
        }
    }
    if let Some(f) = el.gstr("fit") {
        if Fit::parse(f).is_none() {
            diag!(
                out,
                "schema",
                Severity::Error,
                format!("{ptr}/fit"),
                format!("fit \"{f}\" 不在 cover|contain|fill")
            );
        }
    }
    for key in ["loop", "withAudio"] {
        if let Some(v) = el.get_(key).filter(|v| !v.is_null()) {
            if !v.is_boolean() {
                diag!(
                    out,
                    "schema",
                    Severity::Error,
                    format!("{ptr}/{key}"),
                    format!("{key} {v} 须为布尔")
                );
            }
        }
    }
    if let Some(v) = el.get_("volume").filter(|v| !v.is_null()) {
        match v.as_f64() {
            Some(x) if (0.0..=1.0).contains(&x) => {}
            _ => diag!(
                out,
                "schema",
                Severity::Error,
                format!("{ptr}/volume"),
                format!("volume {v} 须在 [0, 1]")
            ),
        }
    }
}

fn lint_captions(clip: &Value, ptr: &str, out: &mut Vec<Diagnostic>) {
    let lane_ids: HashSet<String> = clip
        .get_("lanes")
        .and_then(Value::as_array)
        .map(|ls| {
            ls.iter()
                .filter_map(|l| l.gstr("id").map(String::from))
                .collect()
        })
        .unwrap_or_default();
    for (ii, it) in clip
        .get_("captions")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
        .iter()
        .enumerate()
    {
        let iptr = format!("{ptr}/captions/{ii}");
        if let Some(lines) = it.get_("lines").and_then(Value::as_object) {
            for (lane_id, line) in lines {
                if !lane_ids.is_empty() && !lane_ids.contains(lane_id) {
                    diag!(
                        out,
                        "caption-lane-unknown",
                        Severity::Error,
                        format!("{iptr}/lines/{lane_id}"),
                        format!("字幕项引用未声明的 lane \"{lane_id}\"")
                    );
                }
                if let Some(words) = line.get_("words").and_then(Value::as_array) {
                    let text = line.gstr("text").unwrap_or("");
                    let joined: String = words
                        .iter()
                        .filter_map(|w| w.gstr("text"))
                        .collect::<Vec<_>>()
                        .join("");
                    let norm =
                        |s: &str| s.chars().filter(|c| !c.is_whitespace()).collect::<String>();
                    if norm(&joined) != norm(text) {
                        diag!(
                            out,
                            "caption-words-mismatch",
                            Severity::Error,
                            format!("{iptr}/lines/{lane_id}/words"),
                            format!("words 依序拼接 \"{joined}\" 与 text \"{text}\" 不一致")
                        );
                    }
                    let mut prev = f64::NEG_INFINITY;
                    for w in words {
                        let t = w.gf64("t").unwrap_or(0.0);
                        if t <= prev {
                            diag!(
                                out,
                                "caption-words-mismatch",
                                Severity::Error,
                                format!("{iptr}/lines/{lane_id}/words"),
                                "词时间戳未严格递增".into()
                            );
                            break;
                        }
                        prev = t;
                    }
                }
            }
        }
    }
}
