//! Garment pendulums and bilinear skinning in source pixels.
use super::{
    cloth_grid::{cloth_grid, sample_line, ClothGrid},
    cloth_pendulum::PendulumSystem,
    grid::Grid,
    rig::{BaseWeights, Parameters, PhysicsOffsets, RigEngine},
};
use crate::rig::{ClothTuning, ClothTuningUpdate, Point, Rig};
use anyhow::{ensure, Context, Result};
use std::f64::consts::{PI, SQRT_2};

#[derive(Debug, Clone)]
struct Location {
    q: [usize; 4],
    s: f64,
    t: f64,
    offset: Point,
}
fn place(p: &[f64], loc: &Location) -> Point {
    let (s, t) = (loc.s, loc.t);
    let w = [(1.0 - s) * (1.0 - t), s * (1.0 - t), s * t, (1.0 - s) * t];
    let mut out = loc.offset;
    for (j, weight) in w.iter().enumerate() {
        out[0] += p[loc.q[j]] * weight;
        out[1] += p[loc.q[j] + 1] * weight;
    }
    out
}
fn locate(g: &Garment, x: f64, y: f64) -> Location {
    let bounded = g.grid.custom || g.pinned.iter().any(|p| *p);
    let mut best = None;
    let mut best_miss = f64::INFINITY;
    for r in 0..g.grid.rows - 1 {
        for k in 0..g.grid.cols - 1 {
            let q = [
                (r * g.grid.cols + k) * 2,
                (r * g.grid.cols + k + 1) * 2,
                ((r + 1) * g.grid.cols + k + 1) * 2,
                ((r + 1) * g.grid.cols + k) * 2,
            ];
            let [ax, ay, bx, by, cx, cy, dx, dy] = [
                g.rest[q[0]],
                g.rest[q[0] + 1],
                g.rest[q[1]],
                g.rest[q[1] + 1],
                g.rest[q[2]],
                g.rest[q[2] + 1],
                g.rest[q[3]],
                g.rest[q[3] + 1],
            ];
            let (mut s, mut t) = (0.5, 0.5);
            for _ in 0..10 {
                let fx = ax * (1.0 - s) * (1.0 - t)
                    + bx * s * (1.0 - t)
                    + cx * s * t
                    + dx * (1.0 - s) * t
                    - x;
                let fy = ay * (1.0 - s) * (1.0 - t)
                    + by * s * (1.0 - t)
                    + cy * s * t
                    + dy * (1.0 - s) * t
                    - y;
                let (sx, sy) = (
                    (bx - ax) * (1.0 - t) + (cx - dx) * t,
                    (by - ay) * (1.0 - t) + (cy - dy) * t,
                );
                let (tx, ty) = (
                    (dx - ax) * (1.0 - s) + (cx - bx) * s,
                    (dy - ay) * (1.0 - s) + (cy - by) * s,
                );
                let det: f64 = sx * ty - sy * tx;
                if det.abs() < 1e-9 {
                    break;
                }
                s -= (fx * ty - fy * tx) / det;
                t -= (sx * fy - sy * fx) / det;
            }
            let mut miss = 0.0_f64.max(-s).max(s - 1.0) + 0.0_f64.max(-t).max(t - 1.0);
            if bounded {
                let (u, v) = (s.clamp(0.0, 1.0), t.clamp(0.0, 1.0));
                let px = ax * (1.0 - u) * (1.0 - v)
                    + bx * u * (1.0 - v)
                    + cx * u * v
                    + dx * (1.0 - u) * v;
                let py = ay * (1.0 - u) * (1.0 - v)
                    + by * u * (1.0 - v)
                    + cy * u * v
                    + dy * (1.0 - u) * v;
                miss = (px - x).hypot(py - y);
            }
            if best.is_none() || miss < best_miss {
                best_miss = miss;
                best = Some(Location {
                    q,
                    s,
                    t,
                    offset: [0.0; 2],
                });
            }
        }
    }
    let mut best = best.expect("validated cloth grid has cells");
    let (min, max) = if bounded { (0.0, 1.0) } else { (-3.0, 4.0) };
    best.s = best.s.clamp(min, max);
    best.t = best.t.clamp(min, max);
    if bounded {
        let p = place(&g.rest, &best);
        best.offset = [x - p[0], y - p[1]];
    }
    best
}
pub struct ClothMesh {
    pub mesh: Grid,
    locations: Vec<Location>,
}
pub struct Garment {
    pub name: String,
    pub behind: bool,
    pub grid: ClothGrid,
    pub gravity: f64,
    pub tuning: ClothTuning,
    pub rest: Vec<f64>,
    pub target: Vec<f64>,
    pub out: Vec<f64>,
    pub physical_out: Vec<f64>,
    pub pendulums: Vec<PendulumSystem>,
    pub angle: Vec<f64>,
    pub angular_velocity: Vec<f64>,
    pub lower_angle: Vec<f64>,
    pub lower_angular_velocity: Vec<f64>,
    pub bounce: Vec<f64>,
    pub bounce_velocity: Vec<f64>,
    pub meshes: Vec<ClothMesh>,
    pinned: Vec<bool>,
    top: Vec<Point>,
    weights: Vec<BaseWeights>,
    previous: Option<Vec<f64>>,
    pivot_velocity: Vec<f64>,
    system_key: Option<[f64; 3]>,
    parent: Option<usize>,
    parent_locations: Vec<Location>,
}
pub struct ClothPhysics {
    pub garments: Vec<Garment>,
    pub gain: f64,
    pub time: f64,
}
impl ClothPhysics {
    pub fn new(engine: &RigEngine<'_>, rig: &Rig) -> Result<Self> {
        let meters_per_pixel = rig
            .legs
            .as_ref()
            .map_or(1.6 / rig.image.height as f64, |l| {
                0.8 / (((l.left.ankle[0] - l.left.hip[0]).hypot(l.left.ankle[1] - l.left.hip[1])
                    + (l.right.ankle[0] - l.right.hip[0]).hypot(l.right.ankle[1] - l.right.hip[1]))
                    / 2.0)
            });
        let mut garments: Vec<Garment> = vec![];
        for c in &rig.cloth {
            c.validate()?;
            let grid = cloth_grid(c)?;
            let cols = grid.cols;
            let rows = grid.rows;
            let top: Vec<Point> = if grid.custom {
                grid.top.clone()
            } else {
                (0..cols)
                    .map(|k| sample_line(&c.waist, k as f64 / (cols - 1) as f64))
                    .collect()
            };
            let mut rest = grid.rest.clone();
            if !grid.custom {
                for (k, a) in top.iter().enumerate() {
                    let b = sample_line(&c.hem, k as f64 / (cols - 1) as f64);
                    for r in 0..rows {
                        let v = r as f64 / (rows - 1) as f64;
                        let i = (r * cols + k) * 2;
                        rest[i] = a[0] + (b[0] - a[0]) * v;
                        rest[i + 1] = a[1] + (b[1] - a[1]) * v;
                    }
                }
            }
            // The legacy one-pixel floor is an artificial short pendulum. Carry
            // collapsed/subpixel columns with their waist instead of integrating it.
            let pinned = (0..cols)
                .map(|k| {
                    let top = k * 2;
                    let bottom = ((rows - 1) * cols + k) * 2;
                    !grid.custom
                        && (rest[bottom] - rest[top]).hypot(rest[bottom + 1] - rest[top + 1]) <= 1.0
                })
                .collect();
            let parent = c
                .parent
                .as_ref()
                .map(|p| {
                    garments
                        .iter()
                        .position(|g| &g.name == p)
                        .context("cloth parent must name an earlier entry")
                })
                .transpose()?;
            let parent_locations = parent.map_or_else(Vec::new, |i| {
                top.iter()
                    .map(|p| locate(&garments[i], p[0], p[1]))
                    .collect()
            });
            let weights = top
                .iter()
                .map(|p| engine.base_weights(p[0], p[1], 0.0))
                .collect();
            garments.push(Garment {
                name: c.name.clone(),
                behind: c.behind,
                gravity: 9.80665 / c.scale.map_or(meters_per_pixel, |s| s / 1000.0),
                tuning: c.tuning.clone(),
                pinned,
                grid,
                top,
                weights,
                target: vec![0.0; rest.len()],
                out: rest.clone(),
                physical_out: rest.clone(),
                rest,
                pendulums: vec![],
                system_key: None,
                previous: None,
                pivot_velocity: vec![0.0; cols * 2],
                angle: vec![0.0; cols],
                angular_velocity: vec![0.0; cols],
                lower_angle: vec![0.0; cols],
                lower_angular_velocity: vec![0.0; cols],
                bounce: vec![0.0; cols],
                bounce_velocity: vec![0.0; cols],
                parent,
                parent_locations,
                meshes: vec![],
            });
        }
        Ok(Self {
            garments,
            gain: 1.0,
            time: 0.0,
        })
    }
    pub fn set_tuning(&mut self, name: Option<&str>, update: &ClothTuningUpdate) -> Result<()> {
        ClothTuning::default().updated(update).validate()?;
        ensure!(
            name.is_none_or(|n| self.garments.iter().any(|g| g.name == n)),
            "unknown cloth name"
        );
        for g in &mut self.garments {
            if name.is_none_or(|n| g.name == n) {
                g.tuning = g.tuning.updated(update);
            }
        }
        Ok(())
    }
    pub fn attach(&mut self, name: &str, mesh: Grid) -> Result<()> {
        let g = self
            .garments
            .iter_mut()
            .find(|g| g.name == name)
            .context("unknown cloth name")?;
        let locations = mesh
            .rest
            .as_chunks::<2>()
            .0
            .iter()
            .map(|p| locate(g, p[0] as f64, p[1] as f64))
            .collect();
        g.meshes.push(ClothMesh { mesh, locations });
        Ok(())
    }
    pub fn step(&mut self, engine: &RigEngine<'_>, p: &Parameters, dt: f64, phys: &PhysicsOffsets) {
        self.step_with(dt, |top, w| engine.deform_base(top[0], top[1], w, p, phys));
    }
    /// Alternate waist deformation for applications with external bone transforms.
    pub fn step_with(&mut self, dt: f64, mut deform: impl FnMut(Point, &BaseWeights) -> Point) {
        if dt < 0.0 {
            return;
        }
        let elapsed = dt.min(0.05);
        let sub = (elapsed * 240.0).ceil().max(1.0) as usize;
        let h = elapsed / sub as f64;
        for index in 0..self.garments.len() {
            let (previous, remaining) = self.garments.split_at_mut(index);
            let g = &mut remaining[0];
            let cols = g.grid.cols;
            let rows = g.grid.rows;
            let mut pivots = vec![0.0; cols * 2];
            let mut render_pivots = vec![0.0; cols * 2];
            let mut acceleration = vec![0.0; cols * 2];
            for k in 0..cols {
                let mut a = if let Some(parent) = g.parent {
                    place(&previous[parent].physical_out, &g.parent_locations[k])
                } else {
                    deform(g.top[k], &g.weights[k])
                };
                pivots[k * 2..k * 2 + 2].copy_from_slice(&a);
                if let Some(parent) = g.parent {
                    a = place(&previous[parent].out, &g.parent_locations[k]);
                }
                render_pivots[k * 2..k * 2 + 2].copy_from_slice(&a);
                for axis in 0..2 {
                    let i = k * 2 + axis;
                    let velocity = if elapsed > 0.0 {
                        g.previous
                            .as_ref()
                            .map_or(0.0, |p| (pivots[i] - p[i]) / elapsed)
                    } else {
                        0.0
                    };
                    acceleration[i] = if elapsed > 0.0 {
                        (velocity - g.pivot_velocity[i]) / elapsed
                    } else {
                        0.0
                    };
                    g.pivot_velocity[i] = velocity;
                }
                for r in 0..rows {
                    let i = (r * cols + k) * 2;
                    g.target[i] = g.rest[i] + a[0] - g.top[k][0];
                    g.target[i + 1] = g.rest[i + 1] + a[1] - g.top[k][1];
                }
            }
            g.previous = Some(pivots.clone());
            let tune = g.tuning.clone();
            let frequency_multiplier = tune.swing * tune.stiffness.sqrt();
            let vertical_omega = 2.0 * PI * 2.6;
            if g.grid.custom {
                let key = [frequency_multiplier, tune.damping, tune.high_mode_damping];
                if g.system_key != Some(key) {
                    let old = std::mem::take(&mut g.pendulums);
                    g.pendulums = g
                        .grid
                        .lengths
                        .iter()
                        .enumerate()
                        .map(|(k, length)| {
                            let lengths = g.grid.joints[k]
                                .windows(2)
                                .map(|j| (j[1] - j[0]) * length * 0.8)
                                .collect();
                            let mut state = PendulumSystem::new(
                                lengths,
                                g.gravity * frequency_multiplier.powi(2),
                                0.25 * tune.damping,
                                tune.high_mode_damping,
                            );
                            if let Some(p) = old.get(k) {
                                state.angles.clone_from(&p.angles);
                                state.velocities.clone_from(&p.velocities);
                            }
                            state
                        })
                        .collect();
                    g.system_key = Some(key);
                }
                let highest = g
                    .pendulums
                    .iter()
                    .flat_map(|p| &p.frequencies)
                    .copied()
                    .fold(f64::NEG_INFINITY, f64::max);
                let count = sub.max((elapsed * highest * 32.0).ceil() as usize);
                let step = elapsed / count as f64;
                for n in 0..count {
                    let t = self.time + (n + 1) as f64 * step;
                    let breeze =
                        ((t * 1.1).sin() * 0.6 + (t * 2.3).sin() * 0.4) * tune.max * tune.wind;
                    for k in 0..cols {
                        let ay = acceleration[k * 2 + 1];
                        let effective_gravity = (g.gravity * 0.1).max(g.gravity - ay);
                        let ax = acceleration[k * 2].clamp(-8.0 * g.gravity, 8.0 * g.gravity)
                            - effective_gravity * breeze / g.grid.lengths[k];
                        g.pendulums[k].step(step, ax, effective_gravity / g.gravity);
                        g.bounce_velocity[k] += (-vertical_omega.powi(2) * g.bounce[k]
                            - 2.0 * vertical_omega * g.bounce_velocity[k]
                            - ay * 0.15)
                            * step;
                        g.bounce[k] += g.bounce_velocity[k] * step;
                    }
                }
                if elapsed > 0.0 {
                    for _ in 0..tune.cohesion as usize {
                        for velocity in [false, true] {
                            let old: Vec<Vec<f64>> = g
                                .pendulums
                                .iter()
                                .map(|p| {
                                    if velocity {
                                        p.velocities.clone()
                                    } else {
                                        p.angles.clone()
                                    }
                                })
                                .collect();
                            for (k, p) in g.pendulums.iter_mut().enumerate() {
                                let values = if velocity {
                                    &mut p.velocities
                                } else {
                                    &mut p.angles
                                };
                                for (j, v) in values.iter_mut().enumerate() {
                                    *v = 0.5 * old[k][j]
                                        + 0.25
                                            * (old[k.saturating_sub(1)][j]
                                                + old[(k + 1).min(cols - 1)][j]);
                                }
                            }
                        }
                    }
                }
                g.physical_out = render_custom(g, &pivots, 1.0, 1.0);
                g.out = render_custom(
                    g,
                    &render_pivots,
                    self.gain * tune.response_gain,
                    tune.tier_gain,
                );
                continue;
            }
            for n in 0..sub {
                let t = self.time + (n + 1) as f64 * h;
                let breeze = ((t * 1.1).sin() * 0.6 + (t * 2.3).sin() * 0.4) * tune.max * tune.wind;
                for k in 0..cols {
                    if g.pinned[k] {
                        continue;
                    }
                    let i = k * 2;
                    let bottom = ((rows - 1) * cols + k) * 2;
                    let length = (g.rest[bottom] - g.rest[i])
                        .hypot(g.rest[bottom + 1] - g.rest[i + 1])
                        .max(1.0);
                    let effective_gravity = (g.gravity * 0.1).max(g.gravity - acceleration[i + 1]);
                    let link = 0.8 * length / 2.0;
                    let omega2 =
                        effective_gravity / link * frequency_multiplier * frequency_multiplier;
                    let omega = omega2.sqrt();
                    let zeta = 0.25 * tune.damping;
                    let low = omega * (2.0 - SQRT_2).sqrt();
                    let high = omega * (2.0 + SQRT_2).sqrt();
                    let alpha = 2.0 * zeta * low * high / (low + high);
                    let beta = 2.0 * zeta / (low + high);
                    let delta = g.angle[k] - g.lower_angle[k];
                    let (c, s) = (delta.cos(), delta.sin());
                    let (v1, v2) = (g.angular_velocity[k], g.lower_angular_velocity[k]);
                    let ax = acceleration[i].clamp(-8.0 * g.gravity, 8.0 * g.gravity);
                    let force = (ax - effective_gravity * breeze / length) / link;
                    let damp1 = alpha * (2.0 * v1 + c * v2) + beta * 2.0 * omega2 * v1;
                    let damp2 = alpha * (c * v1 + v2) + beta * omega2 * v2;
                    let b1 = -2.0 * omega2 * g.angle[k].sin()
                        - s * v2 * v2
                        - 2.0 * force * g.angle[k].cos()
                        - damp1;
                    let b2 = -omega2 * g.lower_angle[k].sin() + s * v1 * v1
                        - force * g.lower_angle[k].cos()
                        - damp2;
                    let determinant = 2.0 - c * c;
                    g.angular_velocity[k] += (b1 - c * b2) / determinant * h;
                    g.lower_angular_velocity[k] += (2.0 * b2 - c * b1) / determinant * h;
                    g.angle[k] += g.angular_velocity[k] * h;
                    g.lower_angle[k] += g.lower_angular_velocity[k] * h;
                    g.bounce_velocity[k] += (-vertical_omega * vertical_omega * g.bounce[k]
                        - 2.0 * vertical_omega * g.bounce_velocity[k]
                        - acceleration[i + 1] * 0.15)
                        * h;
                    g.bounce[k] += g.bounce_velocity[k] * h;
                }
            }
            if elapsed > 0.0 {
                for _ in 0..tune.cohesion as usize {
                    for values in [
                        &mut g.angle,
                        &mut g.angular_velocity,
                        &mut g.lower_angle,
                        &mut g.lower_angular_velocity,
                    ] {
                        let previous = values.clone();
                        for k in 0..cols {
                            values[k] = if g.pinned[k] {
                                0.0
                            } else {
                                previous[k] * 0.5
                                    + (previous[k.saturating_sub(1)]
                                        + previous[(k + 1).min(cols - 1)])
                                        * 0.25
                            };
                        }
                    }
                }
            }
            g.physical_out = render_legacy(g, &pivots, 1.0);
            g.out = render_legacy(g, &render_pivots, self.gain * tune.response_gain);
        }
        self.time += elapsed;
    }
    pub fn deform(&mut self) {
        for g in &mut self.garments {
            for m in &mut g.meshes {
                for (loc, pos) in m.locations.iter().zip(m.mesh.pos.as_chunks_mut::<2>().0) {
                    let p = place(&g.out, loc);
                    pos[0] = p[0] as f32;
                    pos[1] = p[1] as f32;
                }
            }
        }
    }
}
fn render_custom(g: &Garment, anchors: &[f64], gain: f64, bend_gain: f64) -> Vec<f64> {
    let mut out = vec![0.0; g.rest.len()];
    let cols = g.grid.cols;
    for k in 0..cols {
        let js = &g.grid.joints[k];
        let seam = &g.grid.seams[k];
        let length = g.grid.lengths[k];
        let vertical = g.tuning.max * 0.1 * (g.bounce[k] * gain / (g.tuning.max * 0.1)).tanh();
        let limit = 2.0
            * ((g.tuning.max - vertical.abs()) / (2.0 * length))
                .min(0.95)
                .asin();
        let root = g.pendulums[k].angles[0];
        let angles: Vec<f64> = g.pendulums[k]
            .angles
            .iter()
            .map(|v| {
                let displayed = if bend_gain == 1.0 {
                    *v
                } else {
                    root + (v - root) * bend_gain
                };
                limit * (displayed * gain / limit).tanh()
            })
            .collect();
        let mut joints = vec![[anchors[k * 2], anchors[k * 2 + 1]]];
        for (j, theta) in angles.iter().enumerate() {
            let a = sample_line(seam, js[j]);
            let b = sample_line(seam, js[j + 1]);
            let (x, y) = (b[0] - a[0], b[1] - a[1]);
            joints.push([
                joints[j][0] + x * theta.cos() + y * theta.sin(),
                joints[j][1] - x * theta.sin() + y * theta.cos(),
            ]);
        }
        for r in 0..g.grid.rows {
            let v = g.grid.fractions[k][r];
            let mut j = 0;
            while j < angles.len() - 1 && v > js[j + 1] + 1e-9 {
                j += 1;
            }
            let a = sample_line(seam, js[j]);
            let b = sample_line(seam, v);
            let u = (v - js[j]) / (js[j + 1] - js[j]);
            let theta = angles[j] * (1.0 - 0.1 * (1.0 - g.tuning.follow) * (1.0 - u));
            let (x, y) = (b[0] - a[0], b[1] - a[1]);
            let i = (r * cols + k) * 2;
            out[i] = joints[j][0] + x * theta.cos() + y * theta.sin();
            out[i + 1] = joints[j][1] - x * theta.sin() + y * theta.cos() + vertical * v;
        }
    }
    out
}
fn render_legacy(g: &Garment, anchors: &[f64], gain: f64) -> Vec<f64> {
    let mut out = vec![0.0; g.rest.len()];
    let cols = g.grid.cols;
    let rows = g.grid.rows;
    for k in 0..cols {
        let top = k * 2;
        let bottom = ((rows - 1) * cols + k) * 2;
        if g.pinned[k] {
            for r in 0..rows {
                let i = (r * cols + k) * 2;
                out[i] = g.rest[i] + anchors[top] - g.rest[top];
                out[i + 1] = g.rest[i + 1] + anchors[top + 1] - g.rest[top + 1];
            }
            continue;
        }
        let length = (g.rest[bottom] - g.rest[top])
            .hypot(g.rest[bottom + 1] - g.rest[top + 1])
            .max(1.0);
        let vertical = g.tuning.max * 0.1 * (g.bounce[k] * gain / (g.tuning.max * 0.1)).tanh();
        let limit = 2.0
            * ((g.tuning.max - vertical.abs()) / (2.0 * length))
                .min(0.95)
                .asin();
        let theta = limit * (g.angle[k] * gain / limit).tanh();
        let lower = limit * (g.lower_angle[k] * gain / limit).tanh();
        let bend = 0.1 * (1.0 - g.tuning.follow);
        let half_x = (g.rest[bottom] - g.rest[top]) / 2.0;
        let half_y = (g.rest[bottom + 1] - g.rest[top + 1]) / 2.0;
        let joint_x = anchors[top] + half_x * theta.cos() + half_y * theta.sin();
        let joint_y = anchors[top + 1] - half_x * theta.sin() + half_y * theta.cos();
        for r in 0..rows {
            let v = r as f64 / (rows - 1) as f64;
            let i = (r * cols + k) * 2;
            let first = v <= 0.5;
            let u = if first { v * 2.0 } else { (v - 0.5) * 2.0 };
            let rotation = if first { theta } else { lower } * (1.0 - bend + bend * u);
            let (c, s) = (rotation.cos(), rotation.sin());
            let (x, y) = (half_x * u, half_y * u);
            out[i] = if first { anchors[top] } else { joint_x } + x * c + y * s;
            out[i + 1] =
                if first { anchors[top + 1] } else { joint_y } - x * s + y * c + vertical * v;
        }
    }
    out
}
