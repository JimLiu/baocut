//! 像素与声音样本的格式转换。
//!
//! - 画面：Windows.Graphics.Capture 给 BGRA（`DXGI_FORMAT_B8G8R8A8_UNORM`），H.264 编码器吃 NV12（8 位 4:2:0）。这里在
//!   CPU 上换：BT.709 矩阵、有限范围（16–235），色度取 2×2 的平均。编码的输入类型与输出类型都标同样的矩阵与范围
//!   （`MF_MT_YUV_MATRIX`、`MF_MT_VIDEO_NOMINAL_RANGE`），播放端按它解。不靠 Sink Writer 自己插颜色转换：它在哪些
//!   系统上会插、插哪个转换器，文档没有写死。
//! - 声音：Media Foundation 的 AAC 编码器只收 16 位 PCM、44.1 或 48 kHz、1、2 或 6 声道（「AAC Encoder」文档的
//!   输入类型）。WASAPI 的混音格式多半是 32 位浮点、可能多于两路；这里统一换成 16 位立体声（单声道复制成两路，
//!   多于两路取前两路，即左前、右前）。采样率不在这里换：要么请 WASAPI 自己转（`AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM`），
//!   要么设备本来就是 44.1 或 48 kHz，否则开设备时报错（[`aac_rate_supported`]）。

/// 一帧 BGRA 换成 NV12。`width`、`height` 是偶数；`stride` 是源一行的字节数。`out` 被改成 `width × height × 3 / 2` 字节。
pub fn bgra_to_nv12(src: &[u8], stride: usize, width: usize, height: usize, out: &mut Vec<u8>) {
    debug_assert!(width.is_multiple_of(2) && height.is_multiple_of(2));
    debug_assert!(src.len() >= stride * height.saturating_sub(1) + width * 4);
    out.resize(width * height * 3 / 2, 0);
    let (luma, chroma) = out.split_at_mut(width * height);
    for row in 0..height {
        let line = &src[row * stride..row * stride + width * 4];
        let target = &mut luma[row * width..(row + 1) * width];
        for (x, pixel) in line.chunks_exact(4).enumerate() {
            target[x] = y_of(pixel[2], pixel[1], pixel[0]);
        }
    }
    for row in 0..height / 2 {
        let top = &src[2 * row * stride..2 * row * stride + width * 4];
        let bottom = &src[(2 * row + 1) * stride..(2 * row + 1) * stride + width * 4];
        let target = &mut chroma[row * width..(row + 1) * width];
        for x in 0..width / 2 {
            let mut sum = [0u32; 3];
            for pixel in [&top[8 * x..8 * x + 4], &top[8 * x + 4..8 * x + 8], &bottom[8 * x..8 * x + 4], &bottom[8 * x + 4..8 * x + 8]] {
                sum[0] += u32::from(pixel[2]);
                sum[1] += u32::from(pixel[1]);
                sum[2] += u32::from(pixel[0]);
            }
            let (r, g, b) = (((sum[0] + 2) / 4) as u8, ((sum[1] + 2) / 4) as u8, ((sum[2] + 2) / 4) as u8);
            let (u, v) = uv_of(r, g, b);
            target[2 * x] = u;
            target[2 * x + 1] = v;
        }
    }
}

/// BT.709 有限范围的亮度（系数 × 1024）。
fn y_of(r: u8, g: u8, b: u8) -> u8 {
    let y = 187 * i32::from(r) + 629 * i32::from(g) + 63 * i32::from(b);
    (16 + ((y + 512) >> 10)).clamp(16, 235) as u8
}

fn uv_of(r: u8, g: u8, b: u8) -> (u8, u8) {
    let (r, g, b) = (i32::from(r), i32::from(g), i32::from(b));
    let u = -103 * r - 347 * g + 450 * b;
    let v = 450 * r - 409 * g - 41 * b;
    let scale = |c: i32| (128 + ((c + 512) >> 10)).clamp(16, 240) as u8;
    (scale(u), scale(v))
}

/// WASAPI 包里的样本格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleFormat {
    F32,
    I16,
    /// 24 位有效、3 字节一个样本。
    I24,
    /// 32 位整数（也用于 4 字节容器里 24 位有效的样本：高位对齐）。
    I32,
}

impl SampleFormat {
    pub fn bytes(self) -> usize {
        match self {
            SampleFormat::I16 => 2,
            SampleFormat::I24 => 3,
            SampleFormat::F32 | SampleFormat::I32 => 4,
        }
    }

    /// 由 `WAVEFORMATEX` 的格式（浮点与否）与容器位数认出样本格式；认不出是 None。
    pub fn from_wave(float: bool, container_bits: u16) -> Option<Self> {
        match (float, container_bits) {
            (true, 32) => Some(SampleFormat::F32),
            (false, 16) => Some(SampleFormat::I16),
            (false, 24) => Some(SampleFormat::I24),
            (false, 32) => Some(SampleFormat::I32),
            _ => None,
        }
    }
}

/// AAC 编码器收的采样率。
pub fn aac_rate_supported(rate: u32) -> bool {
    rate == 44_100 || rate == 48_000
}

/// 一个包换成交错的 16 位立体声，追加到 `out`。`channels` 是源的声道数；不完整的最后一帧丢掉。
pub fn to_stereo_i16(src: &[u8], format: SampleFormat, channels: usize, out: &mut Vec<i16>) {
    if channels == 0 {
        return;
    }
    let frame = format.bytes() * channels;
    for chunk in src.chunks_exact(frame) {
        let left = sample(&chunk[..format.bytes()], format);
        let right = if channels >= 2 { sample(&chunk[format.bytes()..2 * format.bytes()], format) } else { left };
        out.push(left);
        out.push(right);
    }
}

fn sample(bytes: &[u8], format: SampleFormat) -> i16 {
    match format {
        SampleFormat::I16 => i16::from_le_bytes([bytes[0], bytes[1]]),
        SampleFormat::I24 => i16::from_le_bytes([bytes[1], bytes[2]]),
        SampleFormat::I32 => i16::from_le_bytes([bytes[2], bytes[3]]),
        SampleFormat::F32 => {
            let value = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            if value.is_nan() { 0 } else { (value.clamp(-1.0, 1.0) * 32767.0).round() as i16 }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nv12_of_flat_colours() {
        let mut out = Vec::new();
        // 2×2 白、黑、纯红（BGRA）。
        bgra_to_nv12(&[255; 16], 8, 2, 2, &mut out);
        assert_eq!(out, vec![235, 235, 235, 235, 128, 128]);
        bgra_to_nv12(&[0, 0, 0, 255].repeat(4), 8, 2, 2, &mut out);
        assert_eq!(out, vec![16, 16, 16, 16, 128, 128]);
        bgra_to_nv12(&[0, 0, 255, 255].repeat(4), 8, 2, 2, &mut out);
        // BT.709 有限范围的红：Y 63、Cb 102、Cr 240。
        assert_eq!(out, vec![63, 63, 63, 63, 102, 240]);
        // 屏幕那一路用全 0 的 BGRA 填画面外的部分：换出来是黑。
        bgra_to_nv12(&[0; 16], 8, 2, 2, &mut out);
        assert_eq!(out, vec![16, 16, 16, 16, 128, 128]);
    }

    #[test]
    fn nv12_honours_stride_and_averages_chroma() {
        // 4×2，一行 20 字节（4 字节填充）。左边 2×2 白，右边 2×2 黑。
        let white = [255u8; 4];
        let black = [0u8, 0, 0, 255];
        let mut row = Vec::new();
        row.extend_from_slice(&white);
        row.extend_from_slice(&white);
        row.extend_from_slice(&black);
        row.extend_from_slice(&black);
        row.extend_from_slice(&[9, 9, 9, 9]);
        let src = [row.clone(), row].concat();
        let mut out = Vec::new();
        bgra_to_nv12(&src, 20, 4, 2, &mut out);
        assert_eq!(&out[..8], &[235, 235, 16, 16, 235, 235, 16, 16]);
        assert_eq!(&out[8..], &[128, 128, 128, 128]);
    }

    #[test]
    fn pcm_becomes_stereo_i16() {
        let mut out = Vec::new();
        let floats: Vec<u8> = [0.5f32, -1.0, 2.0, f32::NAN].iter().flat_map(|v| v.to_le_bytes()).collect();
        to_stereo_i16(&floats, SampleFormat::F32, 2, &mut out);
        assert_eq!(out, vec![16384, -32767, 32767, 0]);
        out.clear();
        // 单声道复制成两路。
        to_stereo_i16(&[0x34, 0x12, 0xcd, 0xab], SampleFormat::I16, 1, &mut out);
        assert_eq!(out, vec![0x1234, 0x1234, 0xabcdu16 as i16, 0xabcdu16 as i16]);
        out.clear();
        // 六声道取前两路；不完整的最后一帧丢掉。
        let six: Vec<u8> = [1i16, 2, 3, 4, 5, 6, 7].iter().flat_map(|v| v.to_le_bytes()).collect();
        to_stereo_i16(&six, SampleFormat::I16, 6, &mut out);
        assert_eq!(out, vec![1, 2]);
        out.clear();
        to_stereo_i16(&[0x00, 0x34, 0x12, 0x00, 0x00, 0x80], SampleFormat::I24, 2, &mut out);
        assert_eq!(out, vec![0x1234, i16::MIN]);
        out.clear();
        to_stereo_i16(&[0, 0, 0x34, 0x12], SampleFormat::I32, 1, &mut out);
        assert_eq!(out, vec![0x1234, 0x1234]);
    }

    #[test]
    fn wave_formats() {
        assert_eq!(SampleFormat::from_wave(true, 32), Some(SampleFormat::F32));
        assert_eq!(SampleFormat::from_wave(false, 24), Some(SampleFormat::I24));
        assert_eq!(SampleFormat::from_wave(true, 64), None);
        assert!(aac_rate_supported(48_000) && aac_rate_supported(44_100) && !aac_rate_supported(96_000));
    }
}
