//! Scene shaping policy shared by every measurement and rendering layout route.
use super::*;
pub(super) fn mode(style: &TextStyle) -> render_raster::fonts::GlyphShaping {
    match style.font_shaping {
        FontShaping::Advanced => render_raster::fonts::GlyphShaping::Advanced,
        FontShaping::Nominal => render_raster::fonts::GlyphShaping::Nominal,
    }
}
