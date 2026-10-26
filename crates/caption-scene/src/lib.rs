//! Dynamic caption contracts shared by persistence, native rendering and WASM.
//! No filesystem, system clock, UI or platform dependencies.
mod adjust;
mod expression;
mod model;
mod paint_style;
mod validate;
pub use adjust::*;
pub use expression::*;
pub use model::*;
pub use paint_style::*;
pub use validate::*;

pub const STYLE_SCHEMA: &str = "baocut.caption-scene-style/1";
pub const SCENE_SCHEMA: &str = "baocut.caption-scene/1";
pub const MAX_NODES: usize = 256;
pub const MAX_UNITS: usize = 4096;
pub const MAX_OPERATIONS: usize = 65536;
pub const EXTENDED_PAINT_STACK_CAPABILITY: &str = "caption-paint-stack-extended/1";
pub const MAX_EXTENDED_PAINT_DECLARATIONS: usize = 4096;
/// One node and all of its static variants retain one bounded layer order.
pub fn paint_stack_limit(scene: &Scene) -> usize {
    if scene.required_capabilities.iter().any(|cap| cap == EXTENDED_PAINT_STACK_CAPABILITY) {
        64
    } else {
        16
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub path: String,
    pub detail: String,
}
impl Diagnostic {
    pub fn new(code: &str, path: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            path: path.into(),
            detail: detail.into(),
        }
    }
}
impl std::fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} at {}: {}", self.code, self.path, self.detail)
    }
}
impl std::error::Error for Diagnostic {}
pub type Result<T> = std::result::Result<T, Diagnostic>;
pub(crate) fn invalid(path: impl Into<String>, detail: impl Into<String>) -> Diagnostic {
    Diagnostic::new("CAPTION_SCENE_INVALID", path, detail)
}
