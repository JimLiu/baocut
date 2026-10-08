/*!
 * bcut-core —— BCF (.bcut.json) 的纯函数核心：
 * $引用解析 / TimeExpr / resolve 管线 → FlatIR / sample(t) / 静态布局 / lint。
 * 语义与规范 §14.1 及 prototype（index.html / swift-renderer）逐步对应。
 * 本 crate 不做任何 I/O：文本度量经 TextMeasure trait 由 host 注入。
 */

pub mod assets;
pub mod audio_mix;
pub mod bcf_version;
pub mod char_grid;
pub mod color;
pub mod composition;
pub mod ease;
pub mod editpath;
pub mod events;
pub mod fingerprint;
pub mod json;
pub mod layout;
pub mod lint;
pub mod migrate;
pub mod pathstyle;
pub mod proc;
pub mod program_path;
pub mod resolve;
pub mod sample;
pub mod svgpath;
pub mod temporal;
pub mod text_layout;
pub mod timeexpr;

pub use assets::{
    AssetKind, AssetReq, CoreWord, HostInputs, MediaMeta, host_requirements,
    host_requirements_with_vars,
};
pub use color::Rgba;
pub use editpath::{NodeOrigin, OriginEntry};
pub use fingerprint::{canonical_json, content_fingerprint};
pub use migrate::{
    BCF_CURRENT, BCF_FALLBACK, BCF_VERSIONS, MOTION_VERSION, doc_version, migrate_doc,
};
pub use resolve::{
    AudioClip, CameraClip, CapItem, CapLane, CapLine, CapLineBox, CapWord, CapWordBox, CaptionClip,
    ClipPoly, ClipShape, Fit, Ir, RNode, ResolvedEffect, Resolver, VisualClip,
};
pub use sample::{Channel, Kf, mix_value, sample_frames};
pub mod svg_animation;
