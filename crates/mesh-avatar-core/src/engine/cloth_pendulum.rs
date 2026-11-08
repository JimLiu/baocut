//! Absolute-angle serial pendulum with masses proportional to link lengths.
use serde::Serialize;
use std::f64::consts::PI;
fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
pub fn solve(matrix: &[Vec<f64>], rhs: &[f64]) -> Vec<f64> {
    let n = rhs.len();
    let mut l = vec![vec![0.0; n]; n];
    for i in 0..n {
        for j in 0..=i {
            let mut v = matrix[i][j];
            for (a, b) in l[i][..j].iter().zip(&l[j][..j]) {
                v -= a * b;
            }
            l[i][j] = if i == j {
                v.max(1e-18).sqrt()
            } else {
                v / l[j][j]
            };
        }
    }
    let mut y = vec![0.0; n];
    let mut x = vec![0.0; n];
    for i in 0..n {
        y[i] = (rhs[i] - dot(&l[i][..i], &y)) / l[i][i];
    }
    for i in (0..n).rev() {
        let mut v = y[i];
        for j in i + 1..n {
            v -= l[j][i] * x[j];
        }
        x[i] = v / l[i][i];
    }
    x
}
// Jacobi rotations update rows and their transposed columns together.
#[allow(clippy::needless_range_loop)]
fn eigen_symmetric(input: &[Vec<f64>]) -> (Vec<f64>, Vec<Vec<f64>>) {
    let mut a = input.to_vec();
    let n = a.len();
    let mut u: Vec<Vec<f64>> = (0..n)
        .map(|i| (0..n).map(|j| if i == j { 1.0 } else { 0.0 }).collect())
        .collect();
    for _ in 0..100 * n * n {
        let (mut p, mut q, mut largest) = (0, 1, 0.0);
        for (i, row) in a.iter().enumerate() {
            for (j, v) in row.iter().enumerate().skip(i + 1) {
                if v.abs() > largest {
                    largest = v.abs();
                    p = i;
                    q = j;
                }
            }
        }
        if largest < 1e-12 {
            break;
        }
        let phi = 0.5 * (2.0 * a[p][q]).atan2(a[q][q] - a[p][p]);
        let (c, s) = (phi.cos(), phi.sin());
        let (app, aqq, apq) = (a[p][p], a[q][q], a[p][q]);
        for k in 0..n {
            if k != p && k != q {
                let (x, y) = (a[k][p], a[k][q]);
                a[k][p] = c * x - s * y;
                a[p][k] = a[k][p];
                a[k][q] = s * x + c * y;
                a[q][k] = a[k][q];
            }
        }
        a[p][p] = c * c * app - 2.0 * s * c * apq + s * s * aqq;
        a[q][q] = s * s * app + 2.0 * s * c * apq + c * c * aqq;
        a[p][q] = 0.0;
        a[q][p] = 0.0;
        for row in &mut u {
            let (x, y) = (row[p], row[q]);
            row[p] = c * x - s * y;
            row[q] = s * x + c * y;
        }
    }
    ((0..n).map(|i| a[i][i]).collect(), u)
}
#[derive(Debug, Clone, Serialize)]
pub struct PendulumSystem {
    pub lengths: Vec<f64>,
    pub mass: Vec<f64>,
    pub coefficient: Vec<Vec<f64>>,
    pub stiffness: Vec<f64>,
    pub damping: Vec<Vec<f64>>,
    pub frequencies: Vec<f64>,
    pub angles: Vec<f64>,
    pub velocities: Vec<f64>,
}
impl PendulumSystem {
    pub fn new(lengths: Vec<f64>, gravity: f64, zeta: f64, high_mode_damping: f64) -> Self {
        let n = lengths.len();
        let mass: Vec<f64> = (0..n).map(|i| lengths[i..].iter().sum()).collect();
        let coefficient: Vec<Vec<f64>> = lengths
            .iter()
            .enumerate()
            .map(|(i, li)| {
                lengths
                    .iter()
                    .enumerate()
                    .map(|(j, lj)| mass[i.max(j)] * li * lj)
                    .collect()
            })
            .collect();
        let stiffness: Vec<f64> = lengths
            .iter()
            .enumerate()
            .map(|(i, li)| gravity * mass[i] * li)
            .collect();
        let root_k: Vec<f64> = stiffness.iter().map(|x| x.sqrt()).collect();
        let (values, vectors) = eigen_symmetric(
            &coefficient
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    r.iter()
                        .enumerate()
                        .map(|(j, v)| v / root_k[i] / root_k[j])
                        .collect()
                })
                .collect::<Vec<_>>(),
        );
        let first = values
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        let damping = (0..n)
            .map(|i| {
                (0..n)
                    .map(|j| {
                        root_k[i]
                            * root_k[j]
                            * values
                                .iter()
                                .enumerate()
                                .map(|(k, v)| {
                                    vectors[i][k]
                                        * vectors[j][k]
                                        * 2.0
                                        * zeta
                                        * v.sqrt()
                                        * if k == first { 1.0 } else { high_mode_damping }
                                })
                                .sum::<f64>()
                    })
                    .collect()
            })
            .collect();
        let mut frequencies: Vec<f64> =
            values.iter().map(|v| 1.0 / v.sqrt() / (2.0 * PI)).collect();
        frequencies.sort_by(f64::total_cmp);
        Self {
            lengths,
            mass,
            coefficient,
            stiffness,
            damping,
            frequencies,
            angles: vec![0.0; n],
            velocities: vec![0.0; n],
        }
    }
    pub fn energy(&self, q: &[f64], v: &[f64]) -> f64 {
        let mut energy = self
            .stiffness
            .iter()
            .enumerate()
            .map(|(i, k)| k * (1.0 - q[i].cos()))
            .sum::<f64>();
        for i in 0..q.len() {
            for j in 0..q.len() {
                energy += 0.5 * self.coefficient[i][j] * (q[i] - q[j]).cos() * v[i] * v[j];
            }
        }
        energy
    }
    pub fn step(&mut self, h: f64, ax: f64, gravity_ratio: f64) {
        let q = &self.angles;
        let v = &self.velocities;
        let m: Vec<Vec<f64>> = self
            .coefficient
            .iter()
            .enumerate()
            .map(|(i, row)| {
                row.iter()
                    .enumerate()
                    .map(|(j, a)| a * (q[i] - q[j]).cos())
                    .collect()
            })
            .collect();
        let rhs: Vec<f64> = q
            .iter()
            .enumerate()
            .map(|(i, angle)| {
                dot(&m[i], v)
                    + h * (-self.stiffness[i] * gravity_ratio * angle.sin()
                        - ax * self.mass[i] * self.lengths[i] * angle.cos()
                        - self.coefficient[i]
                            .iter()
                            .enumerate()
                            .map(|(j, a)| a * (angle - q[j]).sin() * v[j] * v[j])
                            .sum::<f64>())
            })
            .collect();
        let mut next_v = solve(
            &m.iter()
                .enumerate()
                .map(|(i, row)| {
                    row.iter()
                        .enumerate()
                        .map(|(j, a)| a + h * self.damping[i][j])
                        .collect()
                })
                .collect::<Vec<_>>(),
            &rhs,
        );
        let mut next_q: Vec<f64> = q
            .iter()
            .enumerate()
            .map(|(i, a)| a + h * next_v[i])
            .collect();
        if ax == 0.0 && gravity_ratio == 1.0 {
            let old = self.energy(q, v);
            let potential = self.energy(&next_q, &vec![0.0; q.len()]);
            let next = self.energy(&next_q, &next_v);
            if next > old {
                if potential > old {
                    next_q = q.clone();
                    next_v = v.iter().map(|x| x * 0.999).collect();
                } else {
                    let scale = ((old - potential) / (next - potential).max(1e-30))
                        .max(0.0)
                        .sqrt();
                    for x in &mut next_v {
                        *x *= scale;
                    }
                }
            }
        }
        self.angles = next_q;
        self.velocities = next_v;
    }
}
