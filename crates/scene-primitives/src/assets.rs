//! 显式资源生命周期（规范 §11.2，模式来自 opencat core 的 HostRequirements/HostInputs）：
//!   doc → host_requirements()（AssetId + kind + 逻辑 src + 可选 hash）
//!   → host 侧 fetch/probe（core 无 I/O）
//!   → HostInputs（媒体元数据）注入 Resolver → resolve 期定尺寸、fail-fast。

use crate::json::JsonExt;
use anyhow::{Result, bail};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetKind {
    Image,
    /// GIF / APNG / 动画 WebP（规范 §6.5.1）。与 `Image` 分家而不是给 `Image`
    /// 加个标记：天然尺寸之外还要逐帧时长表与循环声明，元素语义也不同
    /// （`animatedImage` 元素有 §6.5 那套媒体字段，`image` 元素没有）。
    AnimatedImage,
    /// bodymovin JSON（Lottie，规范 §6.5.2）。与 `AnimatedImage` 分家：它是
    /// **矢量**源，没有位图帧，天然尺寸来自合成头而不是解码器，子资源
    /// （image）要在 preflight 一并收集并进内容指纹。
    Lottie,
    /// 代码生成画面（规范 §6.5.3）：一组 TSX/TS 模块，宿主逐帧求值出 SVG 再光栅。
    /// 天然尺寸、帧率与帧数都写在资产条目里（没有可探测的容器），见 [`ProgramReq`]。
    Program,
    Video,
    Audio,
    Font,
}

impl AssetKind {
    pub fn parse(s: &str) -> Option<AssetKind> {
        match s {
            "image" => Some(AssetKind::Image),
            "animatedImage" => Some(AssetKind::AnimatedImage),
            "lottie" => Some(AssetKind::Lottie),
            "program" => Some(AssetKind::Program),
            "video" => Some(AssetKind::Video),
            "audio" => Some(AssetKind::Audio),
            "font" => Some(AssetKind::Font),
            _ => None,
        }
    }
}

impl fmt::Display for AssetKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AssetKind::Image => write!(f, "image"),
            AssetKind::AnimatedImage => write!(f, "animatedImage"),
            AssetKind::Lottie => write!(f, "lottie"),
            AssetKind::Program => write!(f, "program"),
            AssetKind::Video => write!(f, "video"),
            AssetKind::Audio => write!(f, "audio"),
            AssetKind::Font => write!(f, "font"),
        }
    }
}

/// 单条资源需求：id 为文档内 canonical 标识，src 为逻辑定位（相对文档目录）。
#[derive(Debug, Clone)]
pub struct AssetReq {
    pub id: String,
    pub kind: AssetKind,
    pub src: String,
    /// "sha256-<64hex>"；提供时 host 必须校验内容一致
    pub hash: Option<String>,
    pub bounded_image: bool,
    /// `program` 资产的其余声明（§6.5.3）；其它类型恒为 `None`。
    pub program: Option<ProgramReq>,
}

/// `program` 资产条目里 `src` 之外的字段（§6.5.3）。路径都相对文档目录。
#[derive(Debug, Clone, PartialEq)]
pub struct ProgramReq {
    /// 入口模块里组件的导出名，缺省 `default`。
    pub export: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// 源帧数；源时长 = `frames / fps`。
    pub frames: u32,
    /// 裸模块名 → 模块文件（如 `"remotion": "compat/remotion.ts"`）。
    pub imports: std::collections::BTreeMap<String, String>,
    /// 组件经 `asset()` 引用的文件或目录，加载期整体读入内存。
    pub files: Vec<String>,
    /// 传给组件的 props（JSON 对象）。
    pub props: Value,
}

/// 程序画面的上限：单边像素、帧率、帧数（一小时 60 fps）。
pub const PROGRAM_MAX_SIDE: u32 = 8192;
pub const PROGRAM_MAX_FPS: f64 = 240.0;
pub const PROGRAM_MAX_FRAMES: u32 = 216_000;

impl ProgramReq {
    /// 资产条目 → 声明；字段缺失或越界时报出具体字段。
    pub fn parse(id: &str, entry: &Value) -> Result<ProgramReq> {
        let side = |key: &str| -> Result<u32> {
            match entry.get_(key).and_then(Value::as_u64) {
                Some(v) if v >= 1 && v <= u64::from(PROGRAM_MAX_SIDE) => Ok(v as u32),
                _ => bail!(
                    "program-invalid: asset \"{id}\" 的 {key} 须为 1..={PROGRAM_MAX_SIDE} 的整数"
                ),
            }
        };
        let width = side("width")?;
        let height = side("height")?;
        let fps = match entry.gf64("fps") {
            Some(v) if v > 0.0 && v <= PROGRAM_MAX_FPS => v,
            _ => bail!("program-invalid: asset \"{id}\" 的 fps 须为 (0, {PROGRAM_MAX_FPS}] 的数值"),
        };
        let frames = match entry.get_("frames").and_then(Value::as_u64) {
            Some(v) if v >= 1 && v <= u64::from(PROGRAM_MAX_FRAMES) => v as u32,
            _ => bail!(
                "program-invalid: asset \"{id}\" 的 frames 须为 1..={PROGRAM_MAX_FRAMES} 的整数"
            ),
        };
        let export = match entry.get_("export") {
            None => "default".to_string(),
            Some(Value::String(name)) if !name.is_empty() => name.clone(),
            Some(_) => bail!("program-invalid: asset \"{id}\" 的 export 须为非空字符串"),
        };
        let mut imports = std::collections::BTreeMap::new();
        match entry.get_("imports") {
            None => {}
            Some(Value::Object(map)) => {
                for (name, target) in map {
                    let Some(target) = target.as_str().filter(|t| !t.is_empty()) else {
                        bail!("program-invalid: asset \"{id}\" 的 imports.{name} 须为模块路径");
                    };
                    imports.insert(name.clone(), target.to_string());
                }
            }
            Some(_) => bail!("program-invalid: asset \"{id}\" 的 imports 须为对象"),
        }
        let files = match entry.get_("files") {
            None => Vec::new(),
            Some(Value::Array(list)) => list
                .iter()
                .map(|v| {
                    v.as_str()
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .ok_or_else(|| {
                            anyhow::anyhow!(
                                "program-invalid: asset \"{id}\" 的 files 须为路径字符串数组"
                            )
                        })
                })
                .collect::<Result<_>>()?,
            Some(_) => bail!("program-invalid: asset \"{id}\" 的 files 须为路径字符串数组"),
        };
        let props = match entry.get_("props") {
            None => Value::Object(Map::new()),
            Some(v @ Value::Object(_)) => v.clone(),
            Some(_) => bail!("program-invalid: asset \"{id}\" 的 props 须为对象"),
        };
        Ok(ProgramReq {
            export,
            width,
            height,
            fps,
            frames,
            imports,
            files,
            props,
        })
    }

    /// 逐帧起点毫秒表（N+1 项）：`round(k × 1000 / fps)`，与 Lottie 合成帧表同一公式，
    /// 帧率相同时合成第 k 帧恰好取到源第 k 帧。
    pub fn frame_starts_ms(&self) -> Vec<i64> {
        (0..=self.frames)
            .map(|k| (f64::from(k) * 1000.0 / self.fps).round() as i64)
            .collect()
    }
}

/// doc → 资源需求清单（按 id 排序，确定性输出）。
/// asset 变量委托（`var` 字段，§11.2）按 variables 默认值解析；
/// 有变量覆盖时用 [`host_requirements_with_vars`]。
pub fn host_requirements(doc: &Value) -> Result<Vec<AssetReq>> {
    host_requirements_with_vars(doc, None)
}

/// 同 [`host_requirements`]，`overrides` 以 {"id": value} 形态覆盖 variables 默认值（§11.1）。
pub fn host_requirements_with_vars(
    doc: &Value,
    overrides: Option<&Map<String, Value>>,
) -> Result<Vec<AssetReq>> {
    let vars = effective_vars(doc, overrides);
    let mut out = Vec::new();
    if let Some(assets) = doc.get_("assets").and_then(Value::as_object) {
        for (id, entry) in assets {
            let entry = materialize_asset_entry(id, entry, &vars)?;
            let Some(ty) = entry.gstr("type") else {
                bail!("asset \"{id}\" 缺少 type");
            };
            let Some(kind) = AssetKind::parse(ty) else {
                bail!(
                    "asset \"{id}\" 未知 type \"{ty}\"（image|animatedImage|lottie|program|video|audio|font）"
                );
            };
            let Some(src) = entry.gstr("src") else {
                bail!("asset \"{id}\" 缺少 src");
            };
            let program = match kind {
                AssetKind::Program => Some(ProgramReq::parse(id, &entry)?),
                _ => None,
            };
            let bounded_image = match entry.get_("cache") {
                None => false,
                Some(v) => match v.as_str() {
                    Some("eager") => false,
                    Some("bounded") if kind == AssetKind::Image => true,
                    _ => bail!("asset {id}: cache 须为 eager，或 image 的 bounded"),
                },
            };
            out.push(AssetReq {
                id: id.clone(),
                kind,
                src: src.to_string(),
                hash: entry.gstr("hash").map(String::from),
                bounded_image,
                program,
            });
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// variables 默认值 + 覆盖 → 生效变量表。
pub fn effective_vars(doc: &Value, overrides: Option<&Map<String, Value>>) -> Map<String, Value> {
    let mut vars = Map::new();
    for v in doc
        .get_("variables")
        .and_then(Value::as_array)
        .unwrap_or(&Vec::new())
    {
        if let Some(id) = v.gstr("id") {
            let mut val = v.get_("default").cloned().unwrap_or(Value::Null);
            if let Some(o) = overrides {
                if let Some(ov) = o.get(id) {
                    val = ov.clone();
                }
            }
            vars.insert(id.to_string(), val);
        }
    }
    vars
}

/// 单条 asset 的 `var` 委托求解（§11.2）：`{type, var}` → `{type, src, hash?}`。
/// 变量值须为 `{src, hash?}`；`{media}` 形态需要 Project 容器，当前拒绝。
pub fn materialize_asset_entry(
    id: &str,
    entry: &Value,
    vars: &Map<String, Value>,
) -> Result<Value> {
    let Some(var_name) = entry.gstr("var") else {
        return Ok(entry.clone());
    };
    if entry.get_("src").is_some() {
        bail!("asset \"{id}\" 的 src 与 var 互斥（三选一，§11.2）");
    }
    let Some(val) = vars.get(var_name) else {
        bail!("asset \"{id}\" 委托的变量 \"{var_name}\" 不存在");
    };
    let Some(obj) = val.as_object() else {
        bail!("asset \"{id}\" 变量 \"{var_name}\" 的值须为 {{src, hash?}} 对象");
    };
    if obj.contains_key("media") {
        bail!(
            "asset-media-outside-project: asset \"{id}\" 变量值的 {{media}} 形态需要 Project 容器"
        );
    }
    let Some(src) = obj.get("src").and_then(Value::as_str) else {
        bail!("asset \"{id}\" 变量 \"{var_name}\" 的值缺少 src");
    };
    let mut out = Map::new();
    if let Some(t) = entry.get_("type") {
        out.insert("type".into(), t.clone());
    }
    out.insert("src".into(), Value::from(src));
    if let Some(cache) = entry.get_("cache") {
        out.insert("cache".into(), cache.clone());
    }
    if let Some(h) = obj.get("hash") {
        out.insert("hash".into(), h.clone());
    }
    Ok(Value::Object(out))
}

/// assets 表整体物化：把 `var` 委托条目替换为解析后的 `{type, src, hash?}`。
pub fn materialize_assets(assets: &Value, vars: &Map<String, Value>) -> Result<Value> {
    let Some(entries) = assets.as_object() else {
        return Ok(assets.clone());
    };
    let mut out = Map::new();
    for (id, entry) in entries {
        out.insert(id.clone(), materialize_asset_entry(id, entry, vars)?);
    }
    Ok(Value::Object(out))
}

/// host 探测到的媒体元数据（image: duration=0；audio: width/height=0）。
/// `fps` 是媒体源帧率（§6.5 帧精确采样用）；未知时为 0，采样退化为连续时间。
#[derive(Debug, Clone, Copy, Default)]
pub struct MediaMeta {
    pub width: f64,
    pub height: f64,
    pub duration: f64,
    pub fps: f64,
    /// 素材自带的播放遍数（`0` = 无限）。**只有 `animatedImage` 有意义**：
    /// GIF 的 NETSCAPE2.0 / APNG 的 `acTL.num_plays` / WebP 的 `ANIM.loop_count`。
    /// 元素没写 `loop` 时按它取缺省（§6.5.1）。
    pub plays: u32,
}

/// 转录词原子的 core 侧极简形态（§18.6）：CLI 从 flow-core TranscriptDoc 桥接。
/// t0/t1 为媒体源秒。
#[derive(Debug, Clone, PartialEq)]
pub struct CoreWord {
    pub id: String,
    pub t0: f64,
    pub t1: f64,
}

/// host → core 的回填：resolve 期只需要元数据，字节留在 host。
/// `transcripts` 按资产 id 键入词表（`~` 词锚点求值来源，§5.2/§18.6）。
#[derive(Debug, Clone, Default)]
pub struct HostInputs {
    /// Declared font source / asset reference → family name read by the host.
    pub font_families: HashMap<String, String>,
    pub media: HashMap<String, MediaMeta>,
    pub transcripts: HashMap<String, Vec<CoreWord>>,
    /// `animatedImage` / `lottie` 的逐帧**起点**毫秒表（N+1 项，末项为总时长）。
    /// 录制期按它把源时间量化到帧起点——同一帧内的连续时刻因此发出逐字节
    /// 相同的 DrawOp，静止帧缓存与帧指纹才命中得了。
    pub frame_tables: HashMap<String, Arc<[i64]>>,
}

impl HostInputs {
    pub fn insert_image(&mut self, id: &str, width: f64, height: f64) {
        self.media.insert(
            id.to_string(),
            MediaMeta {
                width,
                height,
                duration: 0.0,
                fps: 0.0,
                plays: 0,
            },
        );
    }
    /// 动图：宽高 + 逐帧起点表 + 素材自带的播放遍数。
    /// `duration` 由表的末项推出，`fps` 恒为 0（逐帧时长可以各不相同）。
    pub fn insert_animated_image(
        &mut self,
        id: &str,
        width: f64,
        height: f64,
        frame_starts_ms: Vec<i64>,
        plays: u32,
    ) {
        let duration = frame_starts_ms.last().copied().unwrap_or(0) as f64 / 1000.0;
        self.media.insert(
            id.to_string(),
            MediaMeta {
                width,
                height,
                duration,
                fps: 0.0,
                plays,
            },
        );
        self.frame_tables
            .insert(id.to_string(), Arc::from(frame_starts_ms));
    }
    /// Lottie：宽高来自合成头，帧表按合成帧率铺满 `[ip, op)`。
    ///
    /// 与动图共用一条回填路径**是有意的**——两者的元素时间语义完全同构
    /// （`localTime = mediaStart + (t − clip.start) × rate`，再按帧表量化），
    /// 差别只在"帧里装的是位图还是矢量指令"，而那是 host 的事。
    /// Lottie 容器不带播放遍数，`plays` 恒为 0（无限），元素写 `loop` 才是判据。
    pub fn insert_lottie(&mut self, id: &str, width: f64, height: f64, frame_starts_ms: Vec<i64>) {
        self.insert_animated_image(id, width, height, frame_starts_ms, 0);
    }
    /// 程序画面（§6.5.3）：尺寸与帧表都来自资产声明，回填路径与 Lottie 相同，
    /// `plays` 恒为 0（没写 `loop` 就无限循环）。
    pub fn insert_program(&mut self, id: &str, program: &ProgramReq) {
        self.insert_animated_image(
            id,
            f64::from(program.width),
            f64::from(program.height),
            program.frame_starts_ms(),
            0,
        );
    }
    pub fn insert_video(&mut self, id: &str, width: f64, height: f64, duration: f64, fps: f64) {
        self.media.insert(
            id.to_string(),
            MediaMeta {
                width,
                height,
                duration,
                fps,
                plays: 0,
            },
        );
    }
    pub fn insert_audio(&mut self, id: &str, duration: f64) {
        self.media.insert(
            id.to_string(),
            MediaMeta {
                width: 0.0,
                height: 0.0,
                duration,
                fps: 0.0,
                plays: 0,
            },
        );
    }
    pub fn insert_transcript(&mut self, asset_id: &str, words: Vec<CoreWord>) {
        self.transcripts.insert(asset_id.to_string(), words);
    }
}

/// `"$assets.logo"` → `Some("logo")`（media 节点 src 的唯一合法形态，规范 §11.2）
pub fn asset_ref_id(src: &str) -> Option<&str> {
    let rest = src.strip_prefix("$assets.")?;
    if rest.is_empty() || rest.contains('.') {
        return None;
    }
    Some(rest)
}

/// hash 字段格式校验（"sha256-" + 64 位十六进制）
pub fn valid_hash(h: &str) -> bool {
    h.strip_prefix("sha256-")
        .map(|hex| hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn requirements_sorted_and_typed() {
        let doc = json!({ "assets": {
            "zeta": { "type": "audio", "src": "a.mp3" },
            "alpha": { "type": "image", "src": "l.png", "hash": "sha256-".to_string() + &"ab".repeat(32) }
        }});
        let reqs = host_requirements(&doc).unwrap();
        assert_eq!(reqs.len(), 2);
        assert_eq!(reqs[0].id, "alpha");
        assert_eq!(reqs[0].kind, AssetKind::Image);
        assert!(valid_hash(reqs[0].hash.as_deref().unwrap()));
        assert_eq!(reqs[1].id, "zeta");
    }

    #[test]
    fn unknown_kind_rejected() {
        let doc = json!({ "assets": { "x": { "type": "gif", "src": "x.gif" } } });
        assert!(host_requirements(&doc).is_err());
        // 动图有自己的 kind：扩展名不参与判定，`type` 才是
        let doc = json!({ "assets": { "x": { "type": "animatedImage", "src": "x.gif" } } });
        let reqs = host_requirements(&doc).unwrap();
        assert_eq!(reqs[0].kind, AssetKind::AnimatedImage);
        assert_eq!(reqs[0].kind.to_string(), "animatedImage");
    }

    #[test]
    fn asset_ref_parsing() {
        assert_eq!(asset_ref_id("$assets.logo"), Some("logo"));
        assert_eq!(asset_ref_id("assets/logo.png"), None);
        assert_eq!(asset_ref_id("$assets.a.b"), None);
        assert!(!valid_hash("sha256-zz"));
    }
}
