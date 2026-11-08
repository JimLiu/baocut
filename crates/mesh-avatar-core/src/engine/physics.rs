//! Secondary hair motion and two-joint tassel pendulums.
use super::{
    grid::Grid,
    rig::{rotate, sstep, Parameters, PhysicsOffsets, RigEngine},
};
use crate::rig::{Accessory, Point, Rig, Strand};
use anyhow::{Context, Result};

#[derive(Clone)]
struct StrandState {
    config: Strand,
    nodes: [Point; 4],
    p: Option<[Point; 4]>,
    v: [Point; 4],
}
struct BunState {
    index: usize,
    at: Point,
    p: Option<Point>,
    v: Point,
}
#[derive(Debug, Clone)]
struct Pendulum {
    th: Point,
    w: Point,
    pos: Point,
    vel: Point,
    acc: Point,
}

#[derive(Debug, Clone)]
pub struct TasselChain {
    pub accessory: Accessory,
    pub dir: Point,
    pub length1: f64,
    pub length2: f64,
    pub points: Option<[Point; 3]>,
    pub phi: Point,
    pub anchor: Point,
    state: Option<Pendulum>,
}

impl TasselChain {
    pub fn deform_grid(&self, mesh: &mut Grid) -> Result<()> {
        let points = self
            .points
            .context("step physics before deforming a tassel")?;
        let [px, py] = self.accessory.pivot;
        let [c1, s1] = [self.phi[0].cos(), self.phi[0].sin()];
        let [c2, s2] = [self.phi[1].cos(), self.phi[1].sin()];
        for (r, o) in mesh
            .rest
            .as_chunks::<2>()
            .0
            .iter()
            .zip(mesh.pos.as_chunks_mut::<2>().0)
        {
            let vx = f64::from(r[0]) - px;
            let vy = f64::from(r[1]) - py;
            let along = vx * self.dir[0] + vy * self.dir[1];
            let ax = points[0][0] + vx * c1 - vy * s1;
            let ay = points[0][1] + vx * s1 + vy * c1;
            let ux = vx - self.dir[0] * self.length1;
            let uy = vy - self.dir[1] * self.length1;
            let bx = points[1][0] + ux * c2 - uy * s2;
            let by = points[1][1] + ux * s2 + uy * c2;
            let w = sstep(self.length1 * 0.55, self.length1 * 1.35, along);
            *o = [(ax + (bx - ax) * w) as f32, (ay + (by - ay) * w) as f32];
        }
        Ok(())
    }
}

pub struct Physics {
    pub gain: f64,
    pub out: PhysicsOffsets,
    pub chains: Vec<TasselChain>,
    pub time: f64,
    strands: Vec<StrandState>,
    buns: Vec<BunState>,
    fringe: usize,
}

fn hair_anchor(engine: &RigEngine<'_>, at: Point, p: &Parameters) -> Point {
    let mut point = at;
    engine.apply_head(&mut point, 1.0, p, 1.0);
    engine.apply_body(&mut point, at[1], p, 0.0, 1.0, 0.0);
    point
}

fn soft_limit(v: Point, m: f64) -> Point {
    let l = v[0].hypot(v[1]);
    if l < 1e-6 {
        return v;
    }
    let k = m * (l / m).tanh() / l;
    [v[0] * k, v[1] * k]
}

impl Physics {
    pub fn new(rig: &Rig) -> Self {
        let strands: Vec<_> = rig
            .strands
            .iter()
            .map(|s| {
                let nodes = std::array::from_fn(|i| {
                    if s.nodes.len() == 4 {
                        return s.nodes[i];
                    }
                    let f = i as f64 / 3.0 * (s.nodes.len() - 1) as f64;
                    let k = (f.floor() as usize).min(s.nodes.len() - 2);
                    let t = f - k as f64;
                    std::array::from_fn(|a| s.nodes[k][a] + (s.nodes[k + 1][a] - s.nodes[k][a]) * t)
                });
                StrandState {
                    config: s.clone(),
                    nodes,
                    p: None,
                    v: [[0.0; 2]; 4],
                }
            })
            .collect();
        let fringe = rig
            .strands
            .iter()
            .filter(|s| s.name.starts_with("bang"))
            .count()
            .min(6);
        let mut buns = vec![];
        if let Some(b) = &rig.buns {
            for (index, e) in [&b.bun_l, &b.bun_r].into_iter().enumerate() {
                if let Some(e) = e {
                    buns.push(BunState {
                        index,
                        at: [e.cx, e.cy],
                        p: None,
                        v: [0.0; 2],
                    });
                }
            }
        }
        let chains = rig
            .accessories
            .iter()
            .map(|t| {
                let dx = t.tip[0] - t.pivot[0];
                let dy = t.tip[1] - t.pivot[1];
                let len = dx.hypot(dy);
                TasselChain {
                    accessory: t.clone(),
                    dir: [dx / len, dy / len],
                    length1: len * t.split,
                    length2: len * (1.0 - t.split),
                    points: None,
                    phi: [0.0; 2],
                    anchor: [0.0; 2],
                    state: None,
                }
            })
            .collect();
        Self {
            gain: 1.0,
            out: PhysicsOffsets {
                strands: vec![[[0.0; 2]; 4]; strands.len()],
                ..Default::default()
            },
            chains,
            time: 0.0,
            strands,
            buns,
            fringe,
        }
    }

    /// dt is finite, non-negative seconds. Integration substeps and the 0.05-second
    /// cap follow the JS engine; the caller owns elapsed time.
    pub fn step(&mut self, engine: &RigEngine<'_>, p: &Parameters, dt: f64) -> &PhysicsOffsets {
        assert!(
            dt.is_finite() && dt >= 0.0,
            "dt must be finite and non-negative"
        );
        engine.step_body(p, dt);
        let sub = ((dt / (1.0 / 240.0)).ceil() as usize).max(1);
        let h = dt.min(0.05) / sub as f64;
        let roll = -p.angle_z / 30.0 * engine.rig.head.max_roll
            - p.body_angle_z / 10.0 * engine.rig.body.max_roll;
        let g = self.gain;
        for (si, st) in self.strands.iter_mut().enumerate() {
            let target = st.nodes.map(|n| hair_anchor(engine, n, p));
            let positions = st.p.get_or_insert(target);
            for i in 0..sub {
                let time = self.time + i as f64 * h;
                for (j, &stiffness) in [0.0, 300.0, 200.0, 140.0].iter().enumerate().skip(1) {
                    let hang =
                        (st.nodes[j][0] - st.nodes[0][0]).hypot(st.nodes[j][1] - st.nodes[0][1]);
                    let wind = ((time * 1.3).sin() * 0.5
                        + (time * 3.1).sin() * 0.3
                        + (time * 4.7 + si as f64 * 1.7).sin() * 0.2)
                        * st.config.max
                        * 0.1
                        * j as f64
                        / 3.0;
                    let parent = [
                        positions[j - 1][0] - target[j - 1][0],
                        positions[j - 1][1] - target[j - 1][1],
                    ];
                    let tx =
                        target[j][0] + parent[0] * 0.9 * 0.85 - roll.sin() * hang * 0.12 + wind;
                    let ty = target[j][1] + parent[1] * 0.9 * 0.85;
                    let k = stiffness * st.config.k * 1.7 / g.max(0.35);
                    let c = 7.0 * 1.6 * 1.7_f64.sqrt() / g.sqrt().max(0.5);
                    let v = &mut st.v[j];
                    let q = &mut positions[j];
                    v[0] += (k * (tx - q[0]) - c * v[0]) * h;
                    v[1] += (k * (ty - q[1]) - c * v[1]) * h;
                    q[0] += v[0] * h;
                    q[1] += v[1] * h;
                }
                positions[0] = target[0];
            }
            for j in 0..4 {
                let o = [
                    positions[j][0] - target[j][0],
                    positions[j][1] - target[j][1],
                ];
                self.out.strands[si][j] = soft_limit(
                    o,
                    (st.config.max * 0.9 * g.max(1.0) * j as f64 / 3.0).max(0.5),
                );
            }
        }
        for s in &mut self.buns {
            let a = hair_anchor(engine, s.at, p);
            let wind = (self.time * 1.3 + s.at[0] * 0.01).sin() * 0.6
                + (self.time * 2.9 + s.at[1] * 0.02).sin() * 0.4;
            let tx = a[0] - roll.sin() * 3.0 + wind * 4.0 * 0.12;
            let ty = a[1];
            let pos = s.p.get_or_insert([tx, ty]);
            let k = 260.0 / g.max(0.35);
            let c = 11.0 / g.sqrt().max(0.5);
            for _ in 0..sub {
                s.v[0] += (k * (tx - pos[0]) - c * s.v[0]) * h;
                s.v[1] += (k * (ty - pos[1]) - c * s.v[1]) * h;
                pos[0] += s.v[0] * h;
                pos[1] += s.v[1] * h;
            }
            let mut o = [pos[0] - a[0], pos[1] - a[1]];
            let l = o[0].hypot(o[1]);
            let m = 4.0 * g.max(1.0);
            if l > m {
                o[0] *= m / l;
                o[1] *= m / l;
            }
            if s.index == 0 {
                self.out.bun_l = o;
            } else {
                self.out.bun_r = o;
            }
        }
        self.out.gain = 1.0;
        for _ in 0..4 {
            for j in 1..4 {
                let snap: Vec<_> = self
                    .out
                    .strands
                    .iter()
                    .take(self.fringe)
                    .map(|o| o[j])
                    .collect();
                for i in 0..self.fringe {
                    let l = snap[i.saturating_sub(1)];
                    let r = snap[(i + 1).min(self.fringe - 1)];
                    for a in 0..2 {
                        self.out.strands[i][j][a] = snap[i][a] * 0.5 + (l[a] + r[a]) * 0.25;
                    }
                }
            }
        }
        for ch in &mut self.chains {
            let anchor = engine.tassel_anchor(&ch.accessory, p, &self.out);
            let st = ch.state.get_or_insert(Pendulum {
                th: [0.0; 2],
                w: [0.0; 2],
                pos: anchor,
                vel: [0.0; 2],
                acc: [0.0; 2],
            });
            let vel = [
                (anchor[0] - st.pos[0]) / dt.max(1e-3),
                (anchor[1] - st.pos[1]) / dt.max(1e-3),
            ];
            let kf = 1.0 - (-dt * 6.0).exp();
            let acc = [
                (vel[0] - st.vel[0]) / dt.max(1e-3),
                (vel[1] - st.vel[1]) / dt.max(1e-3),
            ];
            for a in 0..2 {
                st.acc[a] += (acc[a] - st.acc[a]) * kf;
                st.vel[a] += (vel[a] - st.vel[a]) * kf;
            }
            st.pos = anchor;
            let normal = [-ch.dir[1], ch.dir[0]];
            let push =
                -(st.acc[0] * normal[0] + st.acc[1] * normal[1]) / (ch.length1 + ch.length2) * 0.32;
            let wind = ((self.time * 0.9 + ch.accessory.pivot[0]).sin() * 0.6
                + (self.time * 0.37 + ch.accessory.pivot[1]).sin() * 0.4)
                * 0.03;
            let target = -roll * 0.85 + wind;
            let w1 = 2.0 * std::f64::consts::PI * 0.7 / g.max(0.4).sqrt();
            let w2 = w1 * 1.35;
            for _ in 0..sub {
                let a1 = -w1 * w1 * (st.th[0] - target) - 2.0 * 0.22 * w1 * st.w[0] + push;
                st.w[0] += a1 * h;
                st.th[0] += st.w[0] * h;
                let a2 = -w2 * w2 * (st.th[1] - st.th[0]) - 2.0 * 0.22 * w2 * st.w[1]
                    + push * 0.4
                    + a1 * 0.5;
                st.w[1] += a2 * h;
                st.th[1] += st.w[1] * h;
            }
            st.th[0] = st.th[0].clamp(-0.55, 0.55);
            st.th[1] = st.th[1].clamp(-0.55 * 1.4, 0.55 * 1.4);
            ch.phi = st.th;
            let d1 = rotate(ch.dir, [0.0; 2], st.th[0].cos(), st.th[0].sin());
            let d2 = rotate(ch.dir, [0.0; 2], st.th[1].cos(), st.th[1].sin());
            let p1 = [
                anchor[0] + d1[0] * ch.length1,
                anchor[1] + d1[1] * ch.length1,
            ];
            ch.points = Some([
                anchor,
                p1,
                [p1[0] + d2[0] * ch.length2, p1[1] + d2[1] * ch.length2],
            ]);
            ch.anchor = anchor;
        }
        self.time += dt;
        &self.out
    }
}
