//! 最小 WAV 读写（立体声 16-bit PCM 写出；读入支持 16-bit PCM 与 32-bit float 的单 / 双声道）。
//!
//! 分离产物落盘走这里，避免再引入 hound；任意媒体（mp4 等）的解码请用 ffmpeg。

use super::types::StereoAudio;
use anyhow::{Context, Result, bail};
use std::io::Write;
use std::path::Path;

/// 把立体声 f32 PCM 写成 16-bit PCM WAV。超出 [-1, 1] 的样本会被裁剪。
pub fn write_wav_stereo_pcm16(path: &Path, audio: &StereoAudio) -> Result<()> {
    let bytes = encode_wav_stereo_pcm16(audio)?;
    let mut file = std::fs::File::create(path).with_context(|| format!("无法创建 WAV：{}", path.display()))?;
    file.write_all(&bytes)?;
    file.flush()?;
    Ok(())
}

/// 内存中编码立体声 16-bit PCM WAV。
pub fn encode_wav_stereo_pcm16(audio: &StereoAudio) -> Result<Vec<u8>> {
    if audio.left.len() != audio.right.len() {
        bail!("左右声道长度不一致：{} / {}", audio.left.len(), audio.right.len());
    }
    Ok(encode_wav_stereo_i16(audio.sample_rate, &interleave_pcm16(audio)))
}

/// 分轨落盘的量化规则：裁到 [-1, 1] 后乘 32767 四舍五入。本机 `bcut separate` 写 WAV 与
/// 节点分离交回 FLAC 分轨（远端算力 J2）用同一条，客户端解回的 i16 才能与本机逐样本相同。
pub fn pcm16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

/// 立体声 f32 → 交织的 16-bit PCM（[`pcm16`] 量化）。左右不等长时按短的截。
pub fn interleave_pcm16(audio: &StereoAudio) -> Vec<i16> {
    let mut out = Vec::with_capacity(audio.left.len() * 2);
    for (l, r) in audio.left.iter().zip(&audio.right) {
        out.push(pcm16(*l));
        out.push(pcm16(*r));
    }
    out
}

/// 交织的立体声 16-bit PCM 编成 WAV（与 [`encode_wav_stereo_pcm16`] 同一个文件头）。
pub fn encode_wav_stereo_i16(sample_rate: u32, interleaved: &[i16]) -> Vec<u8> {
    let frames = interleaved.len() / 2;
    let channels = 2u16;
    let block_align = channels * 2;
    let data_len = (frames * block_align as usize) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * u32::from(block_align)).to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for value in &interleaved[..frames * 2] {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

/// [`encode_wav_stereo_i16`] 写成文件。
pub fn write_wav_stereo_i16(path: &Path, sample_rate: u32, interleaved: &[i16]) -> Result<()> {
    let bytes = encode_wav_stereo_i16(sample_rate, interleaved);
    let mut file = std::fs::File::create(path).with_context(|| format!("无法创建 WAV：{}", path.display()))?;
    file.write_all(&bytes)?;
    file.flush()?;
    Ok(())
}

/// 读取 WAV（16-bit PCM 或 32-bit float，1 或 2 声道）；单声道会复制成左右两路。
pub fn read_wav(path: &Path) -> Result<StereoAudio> {
    let bytes = std::fs::read(path).with_context(|| format!("无法读取 WAV：{}", path.display()))?;
    decode_wav(&bytes)
}

pub fn decode_wav(bytes: &[u8]) -> Result<StereoAudio> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        bail!("不是 RIFF/WAVE 文件");
    }
    let mut cursor = 12;
    let mut format = 0u16;
    let mut channels = 0u16;
    let mut sample_rate = 0u32;
    let mut bits = 0u16;
    let mut data: Option<&[u8]> = None;
    while cursor + 8 <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into()?) as usize;
        let body_start = cursor + 8;
        let body_end = (body_start + size).min(bytes.len());
        let body = &bytes[body_start..body_end];
        match id {
            b"fmt " => {
                if body.len() < 16 {
                    bail!("fmt 块过短");
                }
                format = u16::from_le_bytes(body[0..2].try_into()?);
                channels = u16::from_le_bytes(body[2..4].try_into()?);
                sample_rate = u32::from_le_bytes(body[4..8].try_into()?);
                bits = u16::from_le_bytes(body[14..16].try_into()?);
                // WAVE_FORMAT_EXTENSIBLE：真正的格式在 SubFormat 的前两个字节。
                if format == 0xFFFE && body.len() >= 26 {
                    format = u16::from_le_bytes(body[24..26].try_into()?);
                }
            }
            b"data" => {
                data = Some(body);
                break;
            }
            _ => {}
        }
        cursor = body_start + size + (size & 1);
    }
    let data = data.context("WAV 缺少 data 块")?;
    if !(channels == 1 || channels == 2) {
        bail!("只支持 1 或 2 声道 WAV，实际 {channels}");
    }
    if sample_rate == 0 {
        bail!("WAV 采样率为 0");
    }
    let interleaved: Vec<f32> = match (format, bits) {
        (1, 16) => data
            .chunks_exact(2)
            .map(|c| f32::from(i16::from_le_bytes([c[0], c[1]])) / 32768.0)
            .collect(),
        (3, 32) => data.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect(),
        _ => bail!("只支持 16-bit PCM 或 32-bit float WAV，实际 format {format} / {bits} bit"),
    };
    let (left, right) = if channels == 1 {
        (interleaved.clone(), interleaved)
    } else {
        let left = interleaved.iter().step_by(2).copied().collect();
        let right = interleaved.iter().skip(1).step_by(2).copied().collect();
        (left, right)
    };
    Ok(StereoAudio { left, right, sample_rate })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stereo_pcm16_roundtrip() {
        let audio = StereoAudio {
            left: vec![0.0, 0.5, -0.5, 1.0, -1.0, 2.0],
            right: vec![0.25, -0.25, 0.75, -0.75, 0.0, -2.0],
            sample_rate: 44_100,
        };
        let bytes = encode_wav_stereo_pcm16(&audio).unwrap();
        assert_eq!(bytes.len(), 44 + 6 * 4);
        let decoded = decode_wav(&bytes).unwrap();
        assert_eq!(decoded.sample_rate, 44_100);
        assert_eq!(decoded.len(), 6);
        for (a, b) in decoded.left.iter().zip(&audio.left) {
            assert!((a - b.clamp(-1.0, 1.0)).abs() < 1e-4);
        }
        for (a, b) in decoded.right.iter().zip(&audio.right) {
            assert!((a - b.clamp(-1.0, 1.0)).abs() < 1e-4);
        }
    }

    #[test]
    fn pcm16_is_the_single_quantization_rule() {
        assert_eq!(pcm16(1.0), 32_767);
        assert_eq!(pcm16(-2.0), -32_767);
        assert_eq!(pcm16(0.5), 16_384);
        let audio = StereoAudio {
            left: vec![0.1, -0.3],
            right: vec![0.7, 0.0],
            sample_rate: 48_000,
        };
        assert_eq!(
            encode_wav_stereo_pcm16(&audio).unwrap(),
            encode_wav_stereo_i16(48_000, &interleave_pcm16(&audio)),
            "f32 与 i16 两条写法同一份字节"
        );
    }

    #[test]
    fn decodes_mono_float32() {
        let samples = [0.1f32, -0.2, 0.3];
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + 12u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&3u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&16_000u32.to_le_bytes());
        bytes.extend_from_slice(&64_000u32.to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&32u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&12u32.to_le_bytes());
        for s in samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        let decoded = decode_wav(&bytes).unwrap();
        assert_eq!(decoded.sample_rate, 16_000);
        assert_eq!(decoded.left, samples.to_vec());
        assert_eq!(decoded.right, samples.to_vec());
    }

    #[test]
    fn rejects_mismatched_channels() {
        let audio = StereoAudio {
            left: vec![0.0; 3],
            right: vec![0.0; 2],
            sample_rate: 44_100,
        };
        assert!(encode_wav_stereo_pcm16(&audio).is_err());
        assert!(decode_wav(b"not a wav").is_err());
    }
}
