//! `transition.wipe@1`：一条（可羽化的）边扫过画布，两张画面都不动。

use super::{Direction, composite_by_coverage, sweep_coverage, sweep_edge};

pub fn wipe(
    from: &[u8],
    to: &[u8],
    out: &mut [u8],
    width: u32,
    height: u32,
    direction: Direction,
    softness: f64,
    progress: f64,
) {
    let span = if direction.is_horizontal() {
        f64::from(width)
    } else {
        f64::from(height)
    };
    let softness = softness.max(0.0);
    let edge = sweep_edge(progress, span, softness);
    composite_by_coverage(from, to, out, width, height, |x, y| {
        let u = match direction {
            Direction::Right => f64::from(x),
            Direction::Left => f64::from(width - 1 - x),
            Direction::Down => f64::from(y),
            Direction::Up => f64::from(height - 1 - y),
        };
        sweep_coverage(edge, u, softness)
    });
}
