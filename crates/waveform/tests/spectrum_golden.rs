//! 固定 PCM → BCS1 的逐字节 golden。
//!
//! 夹具 `tests/fixtures/spectrum/tone-48k-mono-f32.wav` 是 48 kHz、单声道、
//! **32 位浮点**的 WAV：解码到 f32 PCM 是恒等变换，不经任何重采样或整数量化，
//! 因此 symphonia 与 ffmpeg 拿到的样本本就相同，golden 不会因为 CI 上有没有
//! ffmpeg 而漂移。golden 的 `flags` 固定 backend = symphonia（bit0 = 0）。
//!
//! 本测试自己解 WAV（20 行字节读取），**不依赖 symphonia**——`waveform`
//! 是无 I/O 的纯函数 crate，不该为了跑测试把解码器拖进依赖树。
//! 端到端"真解码器 → 同一份 golden"由 `apps/cli` 的 spectrum 集成测试覆盖。
//!
//! 重生成：`BCUT_UPDATE_GOLDEN=1 cargo test -p waveform --test spectrum_golden`

use std::path::{Path, PathBuf};

use waveform::bcs1::{self, SpectrumBackend};
use waveform::dsp;

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/spectrum")
}

fn updating() -> bool {
    std::env::var("BCUT_UPDATE_GOLDEN").is_ok_and(|value| value != "0")
}

/// 48 kHz 单声道 32 位浮点 WAV → f32 PCM。只认夹具用的那一种布局。
fn decode_float32_wav(bytes: &[u8]) -> Vec<f32> {
    assert_eq!(&bytes[..4], b"RIFF", "夹具不是 RIFF");
    assert_eq!(&bytes[8..12], b"WAVE", "夹具不是 WAVE");
    let mut offset = 12;
    let mut format = None;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let body = &bytes[offset + 8..offset + 8 + size];
        match id {
            b"fmt " => {
                let tag = u16::from_le_bytes(body[0..2].try_into().unwrap());
                let channels = u16::from_le_bytes(body[2..4].try_into().unwrap());
                let rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
                let bits = u16::from_le_bytes(body[14..16].try_into().unwrap());
                assert_eq!(
                    (tag, channels, rate, bits),
                    (3, 1, 48_000, 32),
                    "夹具布局变了"
                );
                format = Some(());
            }
            b"data" => {
                assert!(format.is_some(), "data 出现在 fmt 之前");
                return body
                    .chunks_exact(4)
                    .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
                    .collect();
            }
            _ => {}
        }
        offset += 8 + size + (size & 1);
    }
    panic!("夹具没有 data chunk");
}

#[test]
fn the_fixture_tone_matches_the_bcs1_golden_byte_for_byte() {
    let wav = std::fs::read(fixtures().join("tone-48k-mono-f32.wav")).unwrap();
    let pcm = decode_float32_wav(&wav);
    assert_eq!(pcm.len(), 9600, "夹具应为 0.2 秒 @ 48 kHz");

    let produced = dsp::analyze(&pcm, SpectrumBackend::Symphonia).unwrap();
    let golden_path = fixtures().join("tone-48k-mono-f32.bcs1");
    if updating() {
        std::fs::write(&golden_path, &produced).unwrap();
    }
    let golden = std::fs::read(&golden_path).unwrap_or_else(|error| {
        panic!(
            "读取 {} 失败：{error}；用 BCUT_UPDATE_GOLDEN=1 重生成",
            golden_path.display()
        )
    });
    assert_eq!(
        produced.len(),
        golden.len(),
        "BCS1 长度变了：DSP 参数或帧数语义被改动，确认后用 BCUT_UPDATE_GOLDEN=1 重生成"
    );
    if let Some(offset) = produced.iter().zip(&golden).position(|(a, b)| a != b) {
        panic!(
            "BCS1 第 {offset} 字节不一致（{} != {}）：这是像素级语义变更，\
             确认后才用 BCUT_UPDATE_GOLDEN=1 重生成",
            produced[offset], golden[offset]
        );
    }

    // golden 的结构性事实：12 帧、backend 固定 symphonia、静音段真的是静音。
    let view = bcs1::parse(&golden).unwrap();
    let header = view.header();
    assert_eq!(header.frame_count, 12);
    assert_eq!(header.backend, SpectrumBackend::Symphonia);
    assert_eq!(u16::from_le_bytes(golden[6..8].try_into().unwrap()), 0);
    assert_eq!(header.content_hash, dsp::content_hash(&pcm));
    assert_eq!(header.duration_seconds(), 0.2);
    // 帧 0 完全落在前 2400 个静音样本里（窗长 1024），因此时域行全是 128。
    assert!(view.time_row(0).unwrap()[..100].iter().all(|&b| b == 128));
    // 帧 8 起始于样本 6400，落在有声段，时域必然离开中心。
    assert!(view.time_row(8).unwrap().iter().any(|&b| b != 128));
}

#[test]
fn the_golden_survives_a_parse_encode_round_trip() {
    let golden = std::fs::read(fixtures().join("tone-48k-mono-f32.bcs1")).unwrap();
    let view = bcs1::parse(&golden).unwrap();
    let mut payload = Vec::new();
    for frame in 0..view.frame_count() {
        payload.extend_from_slice(view.frame(frame).unwrap());
    }
    assert_eq!(bcs1::encode(&view.header(), &payload).unwrap(), golden);
}
