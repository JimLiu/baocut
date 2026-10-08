//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/SourceSeparation/HTDemucs/HTDemucsSeparator.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 长音频的窗口切分与三角交叉淡化（纯逻辑，全平台编译）。
//!
//! 对照 speech-swift `HTDemucsSeparator.swift` 的 `triangularWeight` / `applySplit`：
//! 以 `training_length` 为窗、`(1 - overlap) × 窗长` 为步长滑动，每个窗口的输出乘以
//! 三角权重后 overlap-add，最后除以权重之和（shifts = 0，确定性）。

use anyhow::{Result, bail};

/// 三角交叉淡化权重：前半段 1..half 递增，后半段递减到 1，再除以最大值。
pub fn triangular_weight(length: usize) -> Vec<f32> {
    if length == 0 {
        return Vec::new();
    }
    let half = length / 2;
    let mut w: Vec<f32> = (0..length)
        .map(|i| if i < half { (i + 1) as f32 } else { (length - i) as f32 })
        .collect();
    let max = w.iter().copied().fold(1.0, f32::max);
    for v in &mut w {
        *v /= max;
    }
    w
}

/// 一个推理窗口：起点与实际长度（末尾窗口可能短于窗长，模型内部会补零）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub offset: usize,
    pub len: usize,
}

/// 按 demucs `apply_model(split=True)` 的规则排窗。
pub fn plan_windows(length: usize, segment_len: usize, overlap: f32) -> Vec<Window> {
    if length == 0 || segment_len == 0 {
        return Vec::new();
    }
    let stride = (((1.0 - overlap) * segment_len as f32) as usize).max(1);
    let mut windows = Vec::new();
    let mut offset = 0;
    while offset < length {
        let len = segment_len.min(length - offset);
        windows.push(Window { offset, len });
        offset += stride;
    }
    windows
}

/// CPU overlap-add 累加器：`channels` 路等长输出 + 权重和。
pub struct OverlapAdd {
    segment_len: usize,
    weight: Vec<f32>,
    out: Vec<Vec<f32>>,
    sum_w: Vec<f32>,
}

impl OverlapAdd {
    pub fn new(channels: usize, length: usize, segment_len: usize) -> Self {
        Self {
            segment_len,
            weight: triangular_weight(segment_len),
            out: vec![vec![0.0; length]; channels],
            sum_w: vec![0.0; length],
        }
    }

    /// 累加一个窗口的输出（每路长度须等于 `window.len`）。
    pub fn add(&mut self, window: Window, chunk: &[Vec<f32>]) -> Result<()> {
        if chunk.len() != self.out.len() {
            bail!("窗口输出通道数 {} 与累加器 {} 不符", chunk.len(), self.out.len());
        }
        if window.len > self.segment_len || window.offset + window.len > self.sum_w.len() {
            bail!(
                "窗口 [{}, +{}) 超出范围（窗长 {}，总长 {}）",
                window.offset,
                window.len,
                self.segment_len,
                self.sum_w.len()
            );
        }
        for (dst, src) in self.out.iter_mut().zip(chunk) {
            if src.len() != window.len {
                bail!("窗口输出长度 {} 与窗口 {} 不符", src.len(), window.len);
            }
            for (i, v) in src.iter().enumerate() {
                dst[window.offset + i] += v * self.weight[i];
            }
        }
        for i in 0..window.len {
            self.sum_w[window.offset + i] += self.weight[i];
        }
        Ok(())
    }

    /// 除以权重和，得到最终各路输出。
    pub fn finish(self) -> Vec<Vec<f32>> {
        let sum_w = self.sum_w;
        self.out
            .into_iter()
            .map(|mut ch| {
                for (v, w) in ch.iter_mut().zip(&sum_w) {
                    if *w > 0.0 {
                        *v /= w;
                    }
                }
                ch
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triangular_weight_is_symmetric_and_normalized() {
        let w = triangular_weight(8);
        assert_eq!(w, vec![0.25, 0.5, 0.75, 1.0, 1.0, 0.75, 0.5, 0.25]);
        let w = triangular_weight(7);
        assert_eq!(w.len(), 7);
        assert_eq!(w[3], 1.0);
        assert!((w[0] - 0.25).abs() < 1e-6 && (w[6] - 0.25).abs() < 1e-6);
        assert!(w.iter().all(|&v| v > 0.0));
        assert!(triangular_weight(0).is_empty());
    }

    #[test]
    fn plan_windows_uses_75_percent_stride_and_short_tail() {
        let seg = 343_980;
        let windows = plan_windows(882_000, seg, 0.25);
        let stride = 257_985;
        assert_eq!(windows[0], Window { offset: 0, len: seg });
        assert_eq!(windows[1].offset, stride);
        assert_eq!(windows.last().unwrap().offset, stride * 3);
        assert_eq!(windows.last().unwrap().len, 882_000 - stride * 3);
        assert_eq!(windows.len(), 4);
        // 短于一个窗口：只有一个窗，长度即总长。
        assert_eq!(plan_windows(1000, seg, 0.25), vec![Window { offset: 0, len: 1000 }]);
        assert!(plan_windows(0, seg, 0.25).is_empty());
    }

    #[test]
    fn overlap_add_of_identity_reconstructs_input() {
        let length = 1000;
        let seg = 300;
        let signal: Vec<f32> = (0..length).map(|i| (i as f32 * 0.01).sin()).collect();
        let mut acc = OverlapAdd::new(1, length, seg);
        for w in plan_windows(length, seg, 0.25) {
            let chunk = vec![signal[w.offset..w.offset + w.len].to_vec()];
            acc.add(w, &chunk).unwrap();
        }
        let out = acc.finish();
        for (a, b) in out[0].iter().zip(&signal) {
            assert!((a - b).abs() < 1e-5);
        }
    }

    #[test]
    fn overlap_add_rejects_bad_chunk() {
        let mut acc = OverlapAdd::new(2, 100, 50);
        assert!(acc.add(Window { offset: 0, len: 50 }, &[vec![0.0; 50]]).is_err());
        assert!(acc.add(Window { offset: 80, len: 50 }, &[vec![0.0; 50], vec![0.0; 50]]).is_err());
    }
}
