//! Authored keyframes and cubic Hermite sampling.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MotionDefinition {
    pub id: String,
    pub label: String,
    pub dur: f64,
    pub idle: bool,
    pub tracks: Vec<(String, Vec<[f64; 2]>)>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Expression {
    pub label: String,
    pub p: BTreeMap<String, serde_json::Value>,
}
#[derive(Deserialize)]
pub struct MotionData {
    pub motions: Vec<MotionDefinition>,
    pub additive: Vec<String>,
    pub expressions: BTreeMap<String, Expression>,
}

pub fn data() -> &'static MotionData {
    static DATA: OnceLock<MotionData> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("motions.json")).expect("valid built-in motion data")
    })
}
pub fn motions() -> &'static [MotionDefinition] {
    &data().motions
}
pub fn find_motion(id: &str) -> Option<&'static MotionDefinition> {
    motions().iter().find(|m| m.id == id)
}
pub fn sample_track(keys: &[[f64; 2]], t: f64) -> f64 {
    if keys.is_empty() {
        return 0.0;
    }
    if t <= keys[0][0] {
        return keys[0][1];
    }
    let n = keys.len() - 1;
    if t >= keys[n][0] {
        return keys[n][1];
    }
    let mut i = 0;
    while t > keys[i + 1][0] {
        i += 1;
    }
    let [t0, v0] = keys[i];
    let [t1, v1] = keys[i + 1];
    let tan = |j: usize| {
        if j == 0 || j >= n {
            0.0
        } else {
            (keys[j + 1][1] - keys[j - 1][1]) / (keys[j + 1][0] - keys[j - 1][0])
        }
    };
    let h = t1 - t0;
    let u = (t - t0) / h;
    let m0 = tan(i) * h;
    let m1 = tan(i + 1) * h;
    let u2 = u * u;
    let u3 = u2 * u;
    (2.0 * u3 - 3.0 * u2 + 1.0) * v0
        + (u3 - 2.0 * u2 + u) * m0
        + (-2.0 * u3 + 3.0 * u2) * v1
        + (u3 - u2) * m1
}
