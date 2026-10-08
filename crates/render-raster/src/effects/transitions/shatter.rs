//! `transition.shatter@1`：出场画面像玻璃一样碎开，碎片从爆心飞散、旋转、受重力
//! 下落并淡出，露出入场画面。
//!
//! **只有一次离屏**：出场画面就是 Transition pass 的 `from` 输入（录制器对每侧
//! 只录一次），这里只把它切片、逐片做仿射变换再叠回去，不会把出场镜头复制 N 份。
//!
//! 切片是对数极坐标里的抖动网格 Voronoi：以爆心为原点，`U = ln(1 + r/r₀)`、
//! `V = θ`，各按网格边长归一化，每格一个带 seed 抖动的种子点，像素归属查 3×3
//! 邻格（`V` 方向首尾相接）。对数半径让靠近爆心的碎片小、外圈的大，格边在画面里
//! 是放射裂纹加同心弧——一眼是「玻璃被击碎」。
//!
//! 每片的运动只由 `(seed, 片号)` 与 progress 决定（可 seek、无增量时钟）：
//! 离爆心越远越晚起飞（裂纹先传开），`τ = clamp((p − delay) / (1 − delay))`；
//! 位移 = 方向 × force × 速度 × τ(2 − τ) + (0, gravity × τ²)；旋转与向镜头的放大
//! 都与 τ 成正比；`τ ≥ 0.55` 之后线性淡出，`τ = 1` 时完全透明。
//! 还没起飞的碎片停在原位，只在片与片的边界上画一道渐显的亮裂纹（`crack`）。
//!
//! 确定性：超越函数一律走 `libm`（native 与 wasm 同一份实现），其余是 f64
//! 四则运算；`progress = 0` / `1` 直接拷贝 `from` / `to`，端点逐字节成立。

use motion::rng::splitmix64_unit;

/// 对数半径的零点：爆心附近这块圆里的碎片最小。
const CORE_RADIUS: f64 = 0.04;
/// 种子点在格内的抖动幅度（格宽的比例）。
const JITTER: f64 = 0.85;
/// 裂纹在 progress 的这一段里渐显。
const CRACK_RAMP: f64 = 0.06;
/// 起飞延迟：离爆心最远的碎片比最近的晚这么多 progress。
const DELAY_SPREAD: f64 = 0.3;
const DELAY_JITTER: f64 = 0.06;
/// 碎片从 τ = FADE_START 开始淡出。
const FADE_START: f64 = 0.55;

#[derive(Debug, Clone, Copy)]
pub struct Shatter {
    /// 目标片数（取整，4..=400）；实际片数按网格取整后相近。
    pub pieces: f64,
    pub seed: u64,
    /// 爆心，画布宽 / 高的比例。
    pub cx: f64,
    pub cy: f64,
    /// 飞散距离（像素，已按画布短边换算）。
    pub force: f64,
    /// 每片在整段转场里最多转过的角度（度）。
    pub rotation: f64,
    /// 重力下落距离（像素，已换算；负值向上）。
    pub gravity: f64,
    /// 裂纹亮度 `0..1`，0 = 不画裂纹。
    pub crack: f64,
}

struct Grid {
    n_r: usize,
    n_theta: usize,
    su: f64,
    sv: f64,
    r0: f64,
    ox: f64,
    oy: f64,
    /// `[ring][spoke]` 的种子点，格单位（未取模的 `V`）。
    seeds: Vec<(f64, f64)>,
}

impl Grid {
    fn new(width: u32, height: u32, params: &Shatter) -> Grid {
        let (w, h) = (f64::from(width), f64::from(height));
        let short = w.min(h).max(1.0);
        let (ox, oy) = (params.cx.clamp(0.0, 1.0) * w, params.cy.clamp(0.0, 1.0) * h);
        let r0 = (CORE_RADIUS * short).max(0.5);
        let mut r_max = 0.0f64;
        for (x, y) in [(0.0, 0.0), (w, 0.0), (0.0, h), (w, h)] {
            let (dx, dy) = (x - ox, y - oy);
            r_max = r_max.max((dx * dx + dy * dy).sqrt());
        }
        let u_max = libm::log(1.0 + r_max / r0).max(1e-6);
        let pieces = params.pieces.round().clamp(4.0, 400.0);
        // 方格：2π·u_max / c² = pieces。
        let tau = std::f64::consts::TAU;
        let cell = (tau * u_max / pieces).sqrt();
        let n_theta = ((tau / cell).round() as usize).max(3);
        let n_r = ((u_max / cell).round() as usize).max(1);
        let su = u_max / n_r as f64;
        let sv = tau / n_theta as f64;
        let mut seeds = Vec::with_capacity(n_r * n_theta);
        for ring in 0..n_r {
            for spoke in 0..n_theta {
                let index = (ring * n_theta + spoke) as i64;
                let ju = splitmix64_unit(params.seed, index * 2);
                let jv = splitmix64_unit(params.seed, index * 2 + 1);
                seeds.push((
                    ring as f64 + 0.5 + JITTER * (ju - 0.5),
                    spoke as f64 + 0.5 + JITTER * (jv - 0.5),
                ));
            }
        }
        Grid {
            n_r,
            n_theta,
            su,
            sv,
            r0,
            ox,
            oy,
            seeds,
        }
    }

    fn label(&self, px: f64, py: f64) -> u16 {
        let (dx, dy) = (px - self.ox, py - self.oy);
        let r = (dx * dx + dy * dy).sqrt();
        let u = libm::log(1.0 + r / self.r0) / self.su;
        let v = (libm::atan2(dy, dx) + std::f64::consts::PI) / self.sv;
        let iu = (u.floor().max(0.0) as usize).min(self.n_r - 1) as isize;
        let iv = v.floor() as isize;
        let n_theta = self.n_theta as isize;
        let mut best = (f64::INFINITY, 0usize);
        for du in -1..=1isize {
            let ring = iu + du;
            if ring < 0 || ring >= self.n_r as isize {
                continue;
            }
            for dv in -1..=1isize {
                let spoke = iv + dv;
                let wrapped = spoke.rem_euclid(n_theta);
                let label = ring as usize * self.n_theta + wrapped as usize;
                let (seed_u, seed_v) = self.seeds[label];
                // 种子点的 V 按未取模的格号展开，跨 ±π 的邻格距离才对。
                let seed_v = seed_v + (spoke - wrapped) as f64;
                let (eu, ev) = (u - seed_u, v - seed_v);
                let distance = eu * eu + ev * ev;
                if distance < best.0 {
                    best = (distance, label);
                }
            }
        }
        best.1 as u16
    }
}

#[derive(Clone, Copy)]
struct Piece {
    label: usize,
    count: u64,
    sum_x: f64,
    sum_y: f64,
    x0: u32,
    y0: u32,
    x1: u32,
    y1: u32,
}

#[inline]
fn over(out: &mut [u8], offset: usize, src: [f64; 4]) {
    let keep = 1.0 - src[3] / 255.0;
    for channel in 0..4 {
        let value = src[channel] + f64::from(out[offset + channel]) * keep;
        out[offset + channel] = value.round().clamp(0.0, 255.0) as u8;
    }
    // 预乘不变量：RGB 不超过 alpha。
    let alpha = out[offset + 3];
    for channel in 0..3 {
        out[offset + channel] = out[offset + channel].min(alpha);
    }
}

/// 双线性取样（像素中心坐标、边缘夹取），预乘值原样插值。
#[inline]
fn bilinear(data: &[u8], width: u32, height: u32, x: f64, y: f64) -> [f64; 4] {
    let max_x = f64::from(width - 1);
    let max_y = f64::from(height - 1);
    let x = x.clamp(0.0, max_x);
    let y = y.clamp(0.0, max_y);
    let (fx, fy) = (x.floor(), y.floor());
    let (tx, ty) = (x - fx, y - fy);
    let (x0, y0) = (fx as u32, fy as u32);
    let (x1, y1) = ((x0 + 1).min(width - 1), (y0 + 1).min(height - 1));
    let at = |px: u32, py: u32| ((py * width + px) * 4) as usize;
    let (a, b, c, d) = (at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1));
    let mut out = [0.0; 4];
    for (channel, slot) in out.iter_mut().enumerate() {
        let top = f64::from(data[a + channel]) * (1.0 - tx) + f64::from(data[b + channel]) * tx;
        let bottom = f64::from(data[c + channel]) * (1.0 - tx) + f64::from(data[d + channel]) * tx;
        *slot = top * (1.0 - ty) + bottom * ty;
    }
    out
}

pub fn shatter(
    from: &[u8],
    to: &[u8],
    out: &mut [u8],
    width: u32,
    height: u32,
    params: &Shatter,
    progress: f64,
) {
    if progress <= 0.0 || width == 0 || height == 0 {
        out.copy_from_slice(from);
        return;
    }
    if progress >= 1.0 {
        out.copy_from_slice(to);
        return;
    }
    let grid = Grid::new(width, height, params);
    let pixel_count = (width as usize) * (height as usize);
    let mut labels = vec![0u16; pixel_count];
    let mut pieces: Vec<Piece> = (0..grid.seeds.len())
        .map(|label| Piece {
            label,
            count: 0,
            sum_x: 0.0,
            sum_y: 0.0,
            x0: u32::MAX,
            y0: u32::MAX,
            x1: 0,
            y1: 0,
        })
        .collect();
    for y in 0..height {
        for x in 0..width {
            let label = grid.label(f64::from(x) + 0.5, f64::from(y) + 0.5);
            labels[(y * width + x) as usize] = label;
            let piece = &mut pieces[label as usize];
            piece.count += 1;
            piece.sum_x += f64::from(x) + 0.5;
            piece.sum_y += f64::from(y) + 0.5;
            piece.x0 = piece.x0.min(x);
            piece.y0 = piece.y0.min(y);
            piece.x1 = piece.x1.max(x);
            piece.y1 = piece.y1.max(y);
        }
    }

    // 底图是入场画面：碎片飞走的地方露出它。
    out.copy_from_slice(to);

    let short = f64::from(width.min(height));
    let crack_width = ((short / 540.0).round() as u32).max(1);
    let crack_alpha = params.crack.clamp(0.0, 1.0) * (progress / CRACK_RAMP).min(1.0);
    let (w, h) = (f64::from(width), f64::from(height));
    let r_max = {
        let mut r = 0.0f64;
        for (x, y) in [(0.0, 0.0), (w, 0.0), (0.0, h), (w, h)] {
            let (dx, dy) = (x - grid.ox, y - grid.oy);
            r = r.max((dx * dx + dy * dy).sqrt());
        }
        r.max(1.0)
    };

    struct Flight {
        label: usize,
        depth: f64,
        cx: f64,
        cy: f64,
        dx: f64,
        dy: f64,
        cos: f64,
        sin: f64,
        scale: f64,
        alpha: f64,
        bbox: (u32, u32, u32, u32),
    }
    let mut flights = Vec::new();
    let physics_seed = params.seed ^ 0xa076_1d64_78bd_642f;
    for piece in pieces.iter().filter(|piece| piece.count > 0) {
        let label = piece.label;
        let random = |k: i64| splitmix64_unit(physics_seed, label as i64 * 8 + k);
        let (cx, cy) = (
            piece.sum_x / piece.count as f64,
            piece.sum_y / piece.count as f64,
        );
        let (ex, ey) = (cx - grid.ox, cy - grid.oy);
        let distance = (ex * ex + ey * ey).sqrt();
        let near = (distance / r_max).clamp(0.0, 1.0);
        let delay = DELAY_SPREAD * near + DELAY_JITTER * random(0);
        let tau = ((progress - delay) / (1.0 - delay)).clamp(0.0, 1.0);
        if tau <= 0.0 {
            // 还没起飞：原位画这一片，外加裂纹。
            for y in piece.y0..=piece.y1 {
                for x in piece.x0..=piece.x1 {
                    let index = (y * width + x) as usize;
                    if labels[index] as usize != label {
                        continue;
                    }
                    let offset = index * 4;
                    let src = [
                        f64::from(from[offset]),
                        f64::from(from[offset + 1]),
                        f64::from(from[offset + 2]),
                        f64::from(from[offset + 3]),
                    ];
                    over(out, offset, src);
                    if crack_alpha > 0.0 {
                        let right = x + crack_width < width
                            && labels[index + crack_width as usize] as usize != label;
                        let below = y + crack_width < height
                            && labels[index + (crack_width * width) as usize] as usize != label;
                        if right || below {
                            let k = crack_alpha * 255.0;
                            over(out, offset, [k, k, k, k]);
                        }
                    }
                }
            }
            continue;
        }
        let (dir_x, dir_y) = if distance > 1e-6 {
            (ex / distance, ey / distance)
        } else {
            let angle = random(1) * std::f64::consts::TAU;
            (libm::cos(angle), libm::sin(angle))
        };
        let speed = (0.55 + 0.9 * random(2)) * (1.25 - 0.75 * near);
        let travel = params.force * speed * tau * (2.0 - tau);
        let fall = params.gravity * tau * tau;
        let angle = params.rotation * (2.0 * random(3) - 1.0) * tau * std::f64::consts::PI / 180.0;
        let depth = random(4);
        let scale = 1.0 + 0.4 * depth * tau;
        let alpha = ((1.0 - tau) / (1.0 - FADE_START)).clamp(0.0, 1.0);
        if alpha <= 0.0 {
            continue;
        }
        let (dx, dy) = (dir_x * travel, dir_y * travel + fall);
        let (cos, sin) = (libm::cos(angle), libm::sin(angle));
        // 源包围盒（像素边）正变换后的外接框。
        let (sx0, sy0) = (f64::from(piece.x0), f64::from(piece.y0));
        let (sx1, sy1) = (f64::from(piece.x1) + 1.0, f64::from(piece.y1) + 1.0);
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for (px, py) in [(sx0, sy0), (sx1, sy0), (sx0, sy1), (sx1, sy1)] {
            let (lx, ly) = ((px - cx) * scale, (py - cy) * scale);
            let (qx, qy) = (cx + dx + lx * cos - ly * sin, cy + dy + lx * sin + ly * cos);
            min_x = min_x.min(qx);
            min_y = min_y.min(qy);
            max_x = max_x.max(qx);
            max_y = max_y.max(qy);
        }
        if max_x <= 0.0 || max_y <= 0.0 || min_x >= w || min_y >= h {
            continue;
        }
        let bbox = (
            min_x.floor().max(0.0) as u32,
            min_y.floor().max(0.0) as u32,
            (max_x.ceil().min(w) as u32).max(1) - 1,
            (max_y.ceil().min(h) as u32).max(1) - 1,
        );
        flights.push(Flight {
            label,
            depth,
            cx,
            cy,
            dx,
            dy,
            cos,
            sin,
            scale,
            alpha,
            bbox,
        });
    }

    // 越靠近镜头（放大越多）的碎片越后画；同深度按片号，顺序完全确定。
    flights.sort_by(|a, b| a.depth.total_cmp(&b.depth).then(a.label.cmp(&b.label)));
    for flight in &flights {
        let (x0, y0, x1, y1) = flight.bbox;
        for y in y0..=y1 {
            for x in x0..=x1 {
                // 逆变换：q → 源坐标。
                let (qx, qy) = (
                    f64::from(x) + 0.5 - flight.cx - flight.dx,
                    f64::from(y) + 0.5 - flight.cy - flight.dy,
                );
                let lx = (qx * flight.cos + qy * flight.sin) / flight.scale;
                let ly = (-qx * flight.sin + qy * flight.cos) / flight.scale;
                let (sx, sy) = (flight.cx + lx, flight.cy + ly);
                if sx < 0.0 || sy < 0.0 || sx >= w || sy >= h {
                    continue;
                }
                let source = (sy as u32 * width + sx as u32) as usize;
                if labels[source] as usize != flight.label {
                    continue;
                }
                let mut src = bilinear(from, width, height, sx - 0.5, sy - 0.5);
                for value in &mut src {
                    *value *= flight.alpha;
                }
                over(out, ((y * width + x) * 4) as usize, src);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> Shatter {
        Shatter {
            pieces: 48.0,
            seed: 3,
            cx: 0.5,
            cy: 0.5,
            force: 40.0,
            rotation: 240.0,
            gravity: 30.0,
            crack: 0.6,
        }
    }

    #[test]
    fn the_piece_count_tracks_the_request() {
        for pieces in [8.0, 48.0, 120.0] {
            let grid = Grid::new(320, 180, &Shatter { pieces, ..params() });
            let actual = grid.seeds.len() as f64;
            assert!(
                actual >= pieces * 0.5 && actual <= pieces * 1.8,
                "请求 {pieces} 片，实际 {actual}"
            );
        }
    }

    #[test]
    fn pieces_near_the_impact_are_smaller() {
        let grid = Grid::new(320, 320, &params());
        let mut area = vec![0usize; grid.seeds.len()];
        for y in 0..320 {
            for x in 0..320 {
                area[grid.label(f64::from(x) + 0.5, f64::from(y) + 0.5) as usize] += 1;
            }
        }
        let inner: usize = area[..grid.n_theta].iter().sum::<usize>() / grid.n_theta;
        let outer_ring = grid.n_r - 1;
        let outer: usize = area[outer_ring * grid.n_theta..].iter().sum::<usize>() / grid.n_theta;
        assert!(inner * 4 < outer, "内圈 {inner} px/片，外圈 {outer} px/片");
    }
}
