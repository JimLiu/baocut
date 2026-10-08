//! BaoCut 音频派生数据的纯函数层：**字节进、字节出，无任何 I/O**。
//!
//! 两种缓存格式各管一件事，互不影响：
//!
//! - [`bcw1`]：峰值包络（50 bins/s，单字节幅度）。只喂时间轴 UI 的音轨图，
//!   **不驱动像素**，因此不进渲染指纹。格式逻辑自 `apps/cli` 的波形服务迁入，
//!   字节布局逐位不变。
//! - [`bcs1`]：频谱（时域行 + 频域行的定长帧）。驱动 visualizer 元素的像素，
//!   因此 header 自带内容 hash 并进渲染指纹。
//!
//! 解码由调用方（host）完成：`bcut_speech::audio::decode_mono_48k` 给出 48 kHz
//! 单声道 f32 PCM，本 crate 只负责 PCM → 字节与字节 → 视图。
//!
//! [`remap`] 是元素级参数（`minDb` / `maxDb` / `smoothing` / `gain`）的重映射与
//! 平滑，**不进缓存**：一份 canonical 窗的 BCS1 服务任意参数组合。

pub mod bcs1;
pub mod bcw1;
/// 单声道 PCM → 节拍 / 小节 / 段落（`bcut beats` 的算法层）。与 [`dsp`] 同受
/// `dsp` feature 控制：都要 real FFT。
#[cfg(feature = "dsp")]
pub mod beats;
/// PCM → BCS1 的 STFT。默认开启；只读 BCS1 的消费方可以
/// `default-features = false` 关掉，realfft 随之退出依赖图。
#[cfg(feature = "dsp")]
pub mod dsp;
pub mod remap;

pub use bcs1::{Bcs1Header, Bcs1View, SpectrumBackend};
pub use bcw1::Bcw1Info;
pub use remap::Remapper;

/// FNV-1a 64 位。BCW1 的文件名指纹与 BCS1 的内容 hash 共用同一个实现。
#[derive(Debug, Clone, Copy)]
pub struct Fnv1a64(u64);

impl Default for Fnv1a64 {
    fn default() -> Self {
        Self::new()
    }
}

impl Fnv1a64 {
    pub const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    pub const PRIME: u64 = 0x0000_0100_0000_01b3;

    pub fn new() -> Self {
        Self(Self::OFFSET_BASIS)
    }

    pub fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.0 ^= u64::from(byte);
            self.0 = self.0.wrapping_mul(Self::PRIME);
        }
    }

    pub fn finish(self) -> u64 {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a64_matches_the_reference_vectors() {
        let mut hash = Fnv1a64::new();
        assert_eq!(hash.finish(), 0xcbf2_9ce4_8422_2325);
        hash.write(b"a");
        assert_eq!(hash.finish(), 0xaf63_dc4c_8601_ec8c);
        let mut split = Fnv1a64::new();
        split.write(b"foo");
        split.write(b"bar");
        let mut whole = Fnv1a64::new();
        whole.write(b"foobar");
        assert_eq!(split.finish(), whole.finish());
    }
}
