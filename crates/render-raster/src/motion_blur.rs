//! 运动模糊（`bcut render --motion-blur N`，规范 §15.2）：一帧 = N 个等距子帧的平均。
//!
//! **快门约定**：180° 快门、**向后**开——帧 `t` 的子帧落在
//! `t + k / N × SHUTTER / fps`（`k = 0..N-1`），全部在本帧的时间片 `[t, t + 1/fps)`
//! 里。首个子帧就是不开运动模糊时的那一刻，所以镜头切点不会把下一镜「提前」糊进来，
//! 也不会把上一镜拖进这一帧。
//!
//! **平均口径**：预乘 RGBA8 逐通道 u32 累加、四舍五入整除（`(Σ + N/2) / N`）；
//! 子帧全同（静止段）时结果与单帧逐字节相同。
//!
//! **指纹**：`N = 1` 时不做任何事，帧指纹与没有这个参数时一字不差；`N ≥ 2` 时
//! 合成指纹 = FNV-1a 64（版本标签, N, 各子帧指纹），同一时刻静止与否都与 N=1 不同，
//! 渲染清单 / 帧缓存不会把两种口径混用。
//!
//! **代价**：每帧光栅化 N 次（静止段子帧指纹全同时只画一次），渲染耗时约 N 倍。
use crate::drawop::fnv1a64;
use anyhow::{Result, bail};

/// 子帧数上限：16 已经是 16× 的渲染耗时，再多边际收益看不出来。
pub const MAX_SAMPLES: u32 = 16;
/// 快门开角占一帧时长的比例（180° 快门）。
pub const SHUTTER: f64 = 0.5;

/// `1..=16`；越界报错（调用方按 `invalid_arg` 转出）。
pub fn validate(samples: u32) -> Result<()> {
    if !(1..=MAX_SAMPLES).contains(&samples) {
        bail!("--motion-blur 须在 1..={MAX_SAMPLES}（1 = 关闭），实得 {samples}");
    }
    Ok(())
}

/// 帧 `t` 的 N 个子帧时刻（第一个恒为 `t`）。
pub fn subframe_times(t: f64, fps: f64, samples: u32) -> Vec<f64> {
    let n = samples.max(1);
    (0..n)
        .map(|k| t + f64::from(k) / f64::from(n) * SHUTTER / fps)
        .collect()
}

/// N ≥ 2 的合成帧指纹。
pub fn composite_fingerprint(samples: u32, subframes: &[u64]) -> u64 {
    let mut bytes = Vec::with_capacity(24 + subframes.len() * 8);
    bytes.extend_from_slice(b"bcut-motion-blur/v1");
    bytes.extend_from_slice(&samples.to_le_bytes());
    for fp in subframes {
        bytes.extend_from_slice(&fp.to_le_bytes());
    }
    fnv1a64(&bytes)
}

/// 预乘 RGBA8 子帧的逐通道累加器。
pub struct Accumulator {
    sum: Vec<u32>,
    count: u32,
}

impl Accumulator {
    pub fn new(len: usize) -> Self {
        Accumulator {
            sum: vec![0; len],
            count: 0,
        }
    }

    /// 同一个子帧可以带权重加进来（静止段复用：画一次、记 `weight` 次）。
    pub fn add(&mut self, data: &[u8], weight: u32) {
        debug_assert_eq!(data.len(), self.sum.len());
        for (acc, &v) in self.sum.iter_mut().zip(data) {
            *acc += u32::from(v) * weight;
        }
        self.count += weight;
    }

    pub fn finish(self) -> Vec<u8> {
        let n = self.count.max(1);
        self.sum
            .into_iter()
            .map(|s| ((s + n / 2) / n) as u8)
            .collect()
    }
}

/// 单帧入口：N 个子帧各自走 FramePlan（效果栈照常），平均后返回 `(像素, 帧指纹)`。
/// `samples = 1` 时与 `planner.render` + `plan.frame_fingerprint()` 逐字节相同。
#[cfg(feature = "media")]
pub fn render_frame(
    planner: &crate::plan::FramePlanner,
    renderer: &crate::renderer::FrameRenderer,
    ir: &scene_primitives::resolve::Ir,
    engine: &mut crate::fonts::TextEngine,
    media: &mut crate::media::MediaStore,
    t: f64,
    samples: u32,
) -> Result<(tiny_skia::Pixmap, u64)> {
    use crate::plan::{CpuExecutor, execute_plan};
    validate(samples)?;
    let mut executor = CpuExecutor::new(planner.capabilities().clone());
    if samples == 1 {
        let plan = planner.plan(renderer, ir, engine, t);
        let fp = plan.frame_fingerprint()?;
        return Ok((execute_plan(&plan, &mut executor, media, None)?, fp));
    }
    let mut fps = Vec::with_capacity(samples as usize);
    let mut acc = Accumulator::new((renderer.width * renderer.height * 4) as usize);
    // 相邻子帧指纹相同就只画一次、按次数计权（静止段不付 N 倍）。
    let mut pending: Option<(u64, tiny_skia::Pixmap, u32)> = None;
    for sub in subframe_times(t, ir.fps, samples) {
        let plan = planner.plan(renderer, ir, engine, sub);
        let fp = plan.frame_fingerprint()?;
        fps.push(fp);
        if let Some((last, _, weight)) = pending.as_mut()
            && *last == fp
        {
            *weight += 1;
            continue;
        }
        if let Some((_, pixmap, weight)) = pending.take() {
            acc.add(pixmap.data(), weight);
        }
        pending = Some((fp, execute_plan(&plan, &mut executor, media, None)?, 1));
    }
    if let Some((_, pixmap, weight)) = pending.take() {
        acc.add(pixmap.data(), weight);
    }
    let size = tiny_skia::IntSize::from_wh(renderer.width, renderer.height)
        .ok_or_else(|| anyhow::anyhow!("帧尺寸为 0"))?;
    let pixmap = tiny_skia::Pixmap::from_vec(acc.finish(), size)
        .ok_or_else(|| anyhow::anyhow!("运动模糊累加尺寸不符"))?;
    Ok((pixmap, composite_fingerprint(samples, &fps)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subframes_open_at_the_frame_time_and_stay_inside_the_frame() {
        let times = subframe_times(1.0, 25.0, 4);
        assert_eq!(times[0], 1.0);
        assert_eq!(times.len(), 4);
        assert!(times.iter().all(|t| *t < 1.0 + 0.5 / 25.0));
        assert!(times.windows(2).all(|w| w[1] > w[0]));
        assert_eq!(subframe_times(2.0, 30.0, 1), vec![2.0]);
    }

    #[test]
    fn averaging_rounds_and_identical_subframes_are_exact() {
        let mut acc = Accumulator::new(4);
        acc.add(&[10, 11, 255, 0], 1);
        acc.add(&[11, 11, 255, 1], 1);
        assert_eq!(acc.finish(), vec![11, 11, 255, 1]);
        let mut same = Accumulator::new(3);
        same.add(&[7, 200, 3], 5);
        assert_eq!(same.finish(), vec![7, 200, 3]);
    }

    #[test]
    fn sample_count_is_part_of_the_fingerprint_and_bounded() {
        assert_ne!(
            composite_fingerprint(2, &[1, 1]),
            composite_fingerprint(3, &[1, 1, 1])
        );
        assert_ne!(
            composite_fingerprint(2, &[1, 2]),
            composite_fingerprint(2, &[2, 1])
        );
        assert!(validate(0).is_err() && validate(17).is_err());
        assert!(validate(1).is_ok() && validate(16).is_ok());
    }
}
