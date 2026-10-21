//! Ordered AA hairline coverage from the unchanged tiny-skia 0.11.4 scanner.
//!
//! This module does not evaluate paint or composite destination pixels. Width
//! classification and its paint-opacity modulation belong to the caller.

use core::fmt;

use crate::alpha_runs::AlphaRun;
use crate::blitter::{Blitter, Mask};
use crate::color::AlphaU8;
use crate::geom::ScreenIntRect;
use crate::painter::DrawTiler;
use crate::{LengthU32, LineCap, Path, Transform};

/// Receives destination-space horizontal coverage spans in scanner order.
///
/// Different callbacks can cover the same pixel and must remain separate.
/// Zero-alpha spans are omitted, as in the CPU raster-pipeline blitter.
pub trait CoverageSink {
    /// Receive one span; `width` is positive and `alpha` is nonzero.
    ///
    /// Return false when a recording budget is exhausted. No later callback is
    /// made, and tracing returns [`CoverageError::Limit`]. The current scanner
    /// invocation can finish without recording before that error is returned.
    fn span(&mut self, x: u32, y: u32, width: u32, alpha: u8) -> bool;
}

/// An explicit tracing failure. No partially recorded trace is complete.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CoverageError {
    /// Canvas dimensions are zero or exceed the scanner's signed coordinates.
    InvalidSize,
    /// The original transform contains a non-finite component.
    InvalidTransform,
    /// Transforming the path produced invalid coordinates or bounds.
    InvalidPath,
    /// Device bounds exceed tiny-skia's safe floating-point math range.
    PathTooBig,
    /// The sink rejected a span because its recording budget was exhausted.
    Limit,
    /// The scanner emitted an invalid span or malformed sparse run array.
    InvalidSpan,
    /// A mask operation was not representable by the blitter's two-byte mask.
    UnsupportedMask,
}

impl fmt::Display for CoverageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidSize => "invalid coverage canvas size",
            Self::InvalidTransform => "non-finite coverage transform",
            Self::InvalidPath => "invalid transformed coverage path",
            Self::PathTooBig => "coverage path exceeds safe math range",
            Self::Limit => "coverage recording budget exceeded",
            Self::InvalidSpan => "invalid coverage scanner span",
            Self::UnsupportedMask => "unsupported coverage scanner mask",
        })
    }
}

#[cfg(feature = "std")]
impl std::error::Error for CoverageError {}

/// Trace a device AA hairline without allocating or painting a canvas.
///
/// The path is mapped by the complete original transform before scanning. For
/// dimensions above 8191, the original `DrawTiler` grid and sequential path
/// translate/scan/translate-back operations are retained, including f32 effects.
/// Callback coordinates are global canvas coordinates; clipping and curve/cap
/// processing are performed by the unchanged scanner.
///
/// This is the geometry half of the CPU AA hairline branch, not a general stroke
/// API. The caller must classify width first, apply its opacity modulation to
/// paint before byte conversion, and handle any dash operation before tracing.
/// No paint, clip mask, join, or miter is evaluated here.
pub fn trace_aa_hairline(
    path: &Path,
    line_cap: LineCap,
    transform: Transform,
    canvas: [u32; 2],
    sink: &mut dyn CoverageSink,
) -> Result<(), CoverageError> {
    let canvas_clip =
        ScreenIntRect::from_xywh(0, 0, canvas[0], canvas[1]).ok_or(CoverageError::InvalidSize)?;
    if !transform.is_finite() {
        return Err(CoverageError::InvalidTransform);
    }
    let mut path = path.clone();
    if !transform.is_identity() {
        path = path
            .transform(transform)
            .ok_or(CoverageError::InvalidPath)?;
    }
    if crate::painter::is_too_big_for_math(&path) {
        return Err(CoverageError::PathTooBig);
    }

    if let Some(tiler) = DrawTiler::new(canvas[0], canvas[1]) {
        for tile in tiler {
            let offset = Transform::from_translate(-(tile.x() as f32), -(tile.y() as f32));
            path = path.transform(offset).ok_or(CoverageError::InvalidPath)?;
            let clip = ScreenIntRect::from_xywh(0, 0, tile.width(), tile.height())
                .ok_or(CoverageError::InvalidSize)?;
            trace_tile(&path, line_cap, clip, [tile.x(), tile.y()], sink)?;
            let offset = Transform::from_translate(tile.x() as f32, tile.y() as f32);
            path = path.transform(offset).ok_or(CoverageError::InvalidPath)?;
        }
    } else {
        trace_tile(&path, line_cap, canvas_clip, [0, 0], sink)?;
    }
    Ok(())
}

fn trace_tile(
    path: &Path,
    line_cap: LineCap,
    clip: ScreenIntRect,
    origin: [u32; 2],
    sink: &mut dyn CoverageSink,
) -> Result<(), CoverageError> {
    let mut recorder = Recorder {
        sink,
        clip,
        origin,
        error: None,
    };
    crate::scan::hairline_aa::stroke_path(path, line_cap, &clip, &mut recorder);
    match recorder.error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

struct Recorder<'a> {
    sink: &'a mut dyn CoverageSink,
    clip: ScreenIntRect,
    origin: [u32; 2],
    error: Option<CoverageError>,
}

impl Recorder<'_> {
    fn fail(&mut self, error: CoverageError) {
        if self.error.is_none() {
            self.error = Some(error);
        }
    }

    fn emit(&mut self, x: u32, y: u32, width: u32, alpha: u8) {
        if self.error.is_some() || alpha == 0 {
            return;
        }
        let right = match x.checked_add(width) {
            Some(value) => value,
            None => {
                self.fail(CoverageError::InvalidSpan);
                return;
            }
        };
        if width == 0
            || x < self.clip.left()
            || right > self.clip.right()
            || y < self.clip.top()
            || y >= self.clip.bottom()
        {
            self.fail(CoverageError::InvalidSpan);
            return;
        }
        let x = match x.checked_add(self.origin[0]) {
            Some(value) => value,
            None => {
                self.fail(CoverageError::InvalidSpan);
                return;
            }
        };
        let y = match y.checked_add(self.origin[1]) {
            Some(value) => value,
            None => {
                self.fail(CoverageError::InvalidSpan);
                return;
            }
        };
        if !self.sink.span(x, y, width, alpha) {
            self.fail(CoverageError::Limit);
        }
    }
}

impl Blitter for Recorder<'_> {
    fn blit_h(&mut self, x: u32, y: u32, width: LengthU32) {
        self.emit(x, y, width.get(), 255);
    }

    fn blit_anti_h(&mut self, mut x: u32, y: u32, alpha: &mut [AlphaU8], runs: &mut [AlphaRun]) {
        let mut index = 0usize;
        while self.error.is_none() {
            let width = match runs.get(index) {
                Some(Some(width)) => u32::from(width.get()),
                Some(None) => return,
                None => {
                    self.fail(CoverageError::InvalidSpan);
                    return;
                }
            };
            let coverage = match alpha.get(index) {
                Some(value) => *value,
                None => {
                    self.fail(CoverageError::InvalidSpan);
                    return;
                }
            };
            self.emit(x, y, width, coverage);
            x = match x.checked_add(width) {
                Some(value) => value,
                None => {
                    self.fail(CoverageError::InvalidSpan);
                    return;
                }
            };
            index = match index.checked_add(width as usize) {
                Some(value) => value,
                None => {
                    self.fail(CoverageError::InvalidSpan);
                    return;
                }
            };
        }
    }

    fn blit_v(&mut self, x: u32, y: u32, height: LengthU32, alpha: AlphaU8) {
        let bottom = match y.checked_add(height.get()) {
            Some(value) => value,
            None => {
                self.fail(CoverageError::InvalidSpan);
                return;
            }
        };
        for row in y..bottom {
            if self.error.is_some() {
                return;
            }
            self.emit(x, row, 1, alpha);
        }
    }

    fn blit_anti_h2(&mut self, x: u32, y: u32, alpha0: AlphaU8, alpha1: AlphaU8) {
        self.emit(x, y, 1, alpha0);
        match x.checked_add(1) {
            Some(next) => self.emit(next, y, 1, alpha1),
            None => self.fail(CoverageError::InvalidSpan),
        }
    }

    fn blit_anti_v2(&mut self, x: u32, y: u32, alpha0: AlphaU8, alpha1: AlphaU8) {
        self.emit(x, y, 1, alpha0);
        match y.checked_add(1) {
            Some(next) => self.emit(x, next, 1, alpha1),
            None => self.fail(CoverageError::InvalidSpan),
        }
    }

    fn blit_rect(&mut self, rect: &ScreenIntRect) {
        for row in rect.top()..rect.bottom() {
            if self.error.is_some() {
                return;
            }
            self.emit(rect.left(), row, rect.width(), 255);
        }
    }

    fn blit_mask(&mut self, mask: &Mask, clip: &ScreenIntRect) {
        if self.error.is_some() {
            return;
        }
        if !mask.bounds.contains(clip) {
            self.fail(CoverageError::UnsupportedMask);
            return;
        }
        for y in clip.top()..clip.bottom() {
            for x in clip.left()..clip.right() {
                if self.error.is_some() {
                    return;
                }
                let row = u64::from(y - mask.bounds.top()) * u64::from(mask.row_bytes);
                let index = row + u64::from(x - mask.bounds.left());
                let coverage = match mask.image.get(index as usize) {
                    Some(value) if index < mask.image.len() as u64 => *value,
                    _ => {
                        self.fail(CoverageError::UnsupportedMask);
                        return;
                    }
                };
                self.emit(x, y, 1, coverage);
            }
        }
    }
}
