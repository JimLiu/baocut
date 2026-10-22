//! Scrolling amplitude envelope with a fixed playhead and local progress clocks.
//! The temporal RMS window is prepared by `VizTrack::envelope_frame`, shared by
//! native export and WASM preview. Every coordinate scales with the element box.

use motion::preset_registry::VisualizerBody;

use crate::drawop::{Color4, DrawOp, FrameBuilder, Mat6};
use crate::source::kernel::DrawBox;
use crate::source::visualizer::{VisualizerParams, VizFrame};

pub(crate) fn draw(
    builder: &mut FrameBuilder,
    body: &VisualizerBody,
    params: &VisualizerParams,
    viz: &VizFrame,
    time: f64,
    bbox: DrawBox,
    tf: Mat6,
) -> usize {
    let Some(count) = body.recipe.integer("barCount").map(|n| n as usize) else {
        return 0;
    };
    if !(bbox.w > 0.0 && bbox.h > 0.0) || count < 3 || count > 4096 {
        return 0;
    }
    let before = builder.frame.ops.len();
    let sx = bbox.w / 1632.0;
    let sy = bbox.h / 340.0;
    let mut rect = |x: f64, y: f64, w: f64, h: f64, radius: f64, color: Color4| {
        if w <= 0.0 || h <= 0.0 {
            return;
        }
        builder.push(DrawOp::FillRect {
            x: (bbox.x + x * sx) as f32,
            y: (bbox.y + y * sy) as f32,
            w: (w * sx) as f32,
            h: (h * sy) as f32,
            radius: (radius * sx.min(sy)) as f32,
            color,
            tf,
        });
    };
    let slot = 1608.0 / (count - 1) as f64;
    for index in 0..count {
        let level = f64::from(viz.freq.get(index).copied().unwrap_or(0)) / 255.0;
        let height = 3.0 + level * 168.0;
        rect(
            12.0 + index as f64 * slot,
            130.0 - height / 2.0,
            5.5,
            height,
            2.7,
            if index <= count / 2 {
                params.main_color
            } else {
                params.secondary_color
            },
        );
    }
    let mut marker = params.main_color;
    marker[3] *= 0.22;
    rect(816.0, 22.0, 1.0, 216.0, 0.0, marker);
    let duration = if params.duration.is_finite() {
        params.duration.max(0.0)
    } else {
        0.0
    };
    let elapsed = if time.is_finite() {
        time.clamp(0.0, duration)
    } else {
        0.0
    };
    rect(12.0, 279.0, 1608.0, 2.0, 0.0, params.secondary_color);
    if duration > 0.0 {
        rect(
            12.0,
            279.0,
            1608.0 * elapsed / duration,
            2.0,
            0.0,
            params.main_color,
        );
    }
    // A compact vector monospace clock avoids per-frame font lookup and keeps
    // tiny labels identical in preview and export, including on Windows.
    for (seconds, right) in [(elapsed, false), (duration, true)] {
        let whole = seconds.floor() as u64;
        let clock = format!("{:02}:{:02}", whole / 60, whole % 60);
        let start = if right {
            1620.0 - clock.len() as f64 * 14.0
        } else {
            12.0
        };
        for (index, digit) in clock.bytes().enumerate() {
            let rows = match digit {
                b'0' => [14, 17, 19, 21, 25, 17, 14],
                b'1' => [4, 12, 4, 4, 4, 4, 14],
                b'2' => [14, 17, 1, 2, 4, 8, 31],
                b'3' => [30, 1, 1, 14, 1, 1, 30],
                b'4' => [2, 6, 10, 18, 31, 2, 2],
                b'5' => [31, 16, 16, 30, 1, 1, 30],
                b'6' => [14, 16, 16, 30, 17, 17, 14],
                b'7' => [31, 1, 2, 4, 8, 8, 8],
                b'8' => [14, 17, 17, 14, 17, 17, 14],
                b'9' => [14, 17, 17, 15, 1, 1, 14],
                _ => [0, 0, 4, 0, 4, 0, 0],
            };
            for (row, bits) in rows.iter().enumerate() {
                for col in 0..5 {
                    if bits & (1 << (4 - col)) != 0 {
                        rect(
                            start + index as f64 * 14.0 + col as f64 * 2.0,
                            307.0 + row as f64 * 2.5,
                            2.0,
                            2.5,
                            0.0,
                            params.secondary_color,
                        );
                    }
                }
            }
        }
    }
    builder.frame.ops.len() - before
}
