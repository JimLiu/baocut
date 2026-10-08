//! FlowMatchEulerDiscreteScheduler，按 `scheduler/scheduler_config.json` 的配置复刻
//! （动态 shift、指数型 time shift、`shift_terminal` 拉伸）。纯逻辑，全平台编译。

use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct SchedulerConfig {
    #[serde(default = "d_base_seq")]
    pub base_image_seq_len: usize,
    #[serde(default = "d_max_seq")]
    pub max_image_seq_len: usize,
    #[serde(default = "d_base_shift")]
    pub base_shift: f64,
    #[serde(default = "d_max_shift")]
    pub max_shift: f64,
    #[serde(default)]
    pub shift_terminal: Option<f64>,
    #[serde(default)]
    pub use_dynamic_shifting: bool,
    #[serde(default)]
    pub time_shift_type: Option<String>,
    #[serde(default = "d_shift")]
    pub shift: f64,
}

fn d_base_seq() -> usize {
    256
}
fn d_max_seq() -> usize {
    4096
}
fn d_base_shift() -> f64 {
    0.5
}
fn d_max_shift() -> f64 {
    1.15
}
fn d_shift() -> f64 {
    1.0
}

impl SchedulerConfig {
    /// 读 `scheduler/scheduler_config.json`（由调用方按清单取出路径）。
    pub fn load(path: &Path) -> Result<Self> {
        let s = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        Ok(serde_json::from_str(&s)?)
    }

    /// 管线的 `calculate_shift`：按图像 token 数线性插值出 mu。
    pub fn mu(&self, image_seq_len: usize) -> f64 {
        let m = (self.max_shift - self.base_shift) / (self.max_image_seq_len as f64 - self.base_image_seq_len as f64);
        let b = self.base_shift - m * self.base_image_seq_len as f64;
        image_seq_len as f64 * m + b
    }

    /// 返回 N+1 个 sigma（末尾补 0）。模型收到的 timestep 就是 sigma（管线里 t/1000）。
    pub fn sigmas(&self, steps: usize, image_seq_len: usize) -> Vec<f64> {
        assert!(steps >= 1);
        // np.linspace(1.0, 1/N, N)
        let n = steps as f64;
        let mut s: Vec<f64> = (0..steps)
            .map(|i| {
                if steps == 1 {
                    1.0
                } else {
                    1.0 + (1.0 / n - 1.0) * i as f64 / (n - 1.0)
                }
            })
            .collect();
        if self.use_dynamic_shifting {
            let mu = self.mu(image_seq_len);
            let exponential = self.time_shift_type.as_deref().unwrap_or("exponential") == "exponential";
            for v in s.iter_mut() {
                *v = if exponential {
                    let e = mu.exp();
                    e / (e + (1.0 / *v - 1.0))
                } else {
                    mu / (mu + (1.0 / *v - 1.0))
                };
            }
        } else {
            for v in s.iter_mut() {
                *v = self.shift * *v / (1.0 + (self.shift - 1.0) * *v);
            }
        }
        // 只有一步时末项就是 1.0，拉伸会 0/0（diffusers 同样得 NaN），此时不拉伸。
        if let Some(term) = self.shift_terminal.filter(|t| *t > 0.0 && steps > 1) {
            let last = 1.0 - *s.last().unwrap();
            let scale = last / (1.0 - term);
            for v in s.iter_mut() {
                *v = 1.0 - (1.0 - *v) / scale;
            }
        }
        s.push(0.0);
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> SchedulerConfig {
        serde_json::from_str(
            r#"{"base_image_seq_len":256,"base_shift":0.5,"max_image_seq_len":8192,"max_shift":0.9,
                "shift":1.0,"shift_terminal":0.02,"time_shift_type":"exponential","use_dynamic_shifting":true}"#,
        )
        .unwrap()
    }

    #[test]
    fn sigmas_start_at_one_and_end_at_terminal() {
        let s = cfg().sigmas(40, 4096);
        assert_eq!(s.len(), 41);
        assert!((s[0] - 1.0).abs() < 1e-9, "{}", s[0]);
        assert!((s[39] - 0.02).abs() < 1e-9, "{}", s[39]);
        assert_eq!(s[40], 0.0);
        assert!(s.windows(2).all(|w| w[0] > w[1]));
    }

    #[test]
    fn single_step_is_finite() {
        assert_eq!(cfg().sigmas(1, 4096), vec![1.0, 0.0]);
    }
}
