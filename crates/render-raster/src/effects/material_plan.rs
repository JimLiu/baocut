//! Renderer-neutral, fully evaluated material commands. No template expressions,
//! word clocks, filesystem paths or device objects cross this boundary.
use super::component_filters::{GaussianPass, GlowConfig};
use crate::drawop::{AssociatedBlend, BitmapData, FrameOps};
#[derive(Clone, Debug)]
pub enum MaterialCommand {
    NoisySweep {
        domain: [f64; 4],
        position: f64,
        mask_scale: [f64; 2],
        reveal: bool,
        flip_y: bool,
    },
    Gaussian(GaussianPass),
    AffineSampleBlend(super::component_filters::affine_samples::Config),
    Glow(GlowConfig),
}
#[derive(Clone, Debug)]
pub struct ImageQuad {
    pub bitmap: std::sync::Arc<BitmapData>,
    pub domain: [f64; 4],
    pub uv_scale: [f64; 2],
    pub uv_offset: [f64; 2],
}
#[derive(Clone, Debug)]
pub enum MaterialSource {
    Draw(std::sync::Arc<FrameOps>),
    Image(ImageQuad),
}
/// A local source texture, placed one texel per canvas pixel after filtering.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MaterialCapture {
    pub origin: [i32; 2],
    pub width: u32,
    pub height: u32,
}
#[derive(Clone, Debug)]
pub struct MaterialLayer {
    pub capture: Option<MaterialCapture>,
    pub source: MaterialSource,
    pub materials: Vec<MaterialCommand>,
    pub blend: AssociatedBlend,
}
#[derive(Clone, Debug)]
pub struct MaterialFrame {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<MaterialLayer>,
}
