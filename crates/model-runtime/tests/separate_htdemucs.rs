//! HTDemucs-FT 真权重分离（移植自 v2 的 `htdemucs_smoke`，另加一段语音 + 合成低音的混音）：同一组测试对 MLX（`mlx::`，
//! Apple Silicon）与 candle（`candle::`，开 `backend-candle`；默认设备，CPU 或 CUDA）各跑一遍；两者都编进来时再比一次
//! 两个后端的人声输出（`parity::`）。
//!
//! ```sh
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-runtime --features backend-candle --test separate_htdemucs -- --ignored --test-threads=1 --nocapture
//! ```
//!
//! 权重不在（没设 `BAOCUT_TEST_MODELS_DIR` 或没有 `.bcut-manifest.json`）时打印原因后跳过。模型目录只读。
//! `BAOCUT_REQUIRE_CUDA=1` 时 candle 必须拿到 CUDA，不许静默回退 CPU（同 v2 的 `BCUT_REQUIRE_CUDA`）。

#![cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]

use std::path::{Path, PathBuf};
use std::time::Instant;

use model_runtime::bundle::{FAMILY_HTDEMUCS_FT, FileEntry, ModelFiles, VerifiedFiles};
use model_runtime::separate::types::{SeparationProgress, StereoAudio};
use model_runtime::separate::{self, Separator, resample::resample, wav};
use serde_json::Value;

const REPO: &str = "aufklarer/HTDemucs-FT-MLX";

/// 从 `<models-root>/<repo>/.bcut-manifest.json` 构造并校验文件清单；权重不在时给 `None` 并打印原因。
fn verified() -> Option<VerifiedFiles> {
    let Some(root) = std::env::var_os("BAOCUT_TEST_MODELS_DIR") else {
        println!("跳过：没设 BAOCUT_TEST_MODELS_DIR");
        return None;
    };
    let dir = PathBuf::from(root).join(REPO);
    let Ok(bytes) = std::fs::read(dir.join(".bcut-manifest.json")) else {
        println!("跳过：{} 没有 .bcut-manifest.json（权重没装好）", dir.display());
        return None;
    };
    let manifest: Value = serde_json::from_slice(&bytes).expect("manifest JSON");
    let files = manifest["files"]
        .as_array()
        .expect("manifest files")
        .iter()
        .map(|file| FileEntry {
            path: file["path"].as_str().expect("path").to_owned(),
            sha256: file["sha256"].as_str().unwrap_or_default().to_owned(),
            byte_length: file["size"].as_u64().expect("size"),
        })
        .collect();
    Some(
        ModelFiles {
            family: FAMILY_HTDEMUCS_FT.to_owned(),
            revision: manifest["revision"].as_str().unwrap_or_default().to_owned(),
            dir: dir.to_string_lossy().into_owned(),
            files,
        }
        .verify("separator")
        .expect("verify bundle files"),
    )
}

#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
fn load_mlx() -> Option<Box<dyn Separator>> {
    let files = verified()?;
    let started = Instant::now();
    let separator = separate::load_separator(&files).expect("load HTDemucs");
    println!("HTDemucs-FT（MLX）: 加载 {:.2} s", started.elapsed().as_secs_f32());
    Some(separator)
}

#[cfg(feature = "backend-candle")]
fn load_candle() -> Option<Box<dyn Separator>> {
    let device = model_runtime::backend::candle::default_device();
    if std::env::var("BAOCUT_REQUIRE_CUDA").ok().as_deref() == Some("1") {
        assert!(device.is_cuda(), "BAOCUT_REQUIRE_CUDA=1 时禁止静默回退 CPU");
    }
    let files = verified()?;
    let started = Instant::now();
    let label = model_runtime::backend::candle::device_label(&device);
    let separator = separate::load_candle_separator(&files, device).expect("load HTDemucs");
    println!("HTDemucs-FT（candle {label}）: 加载 {:.2} s", started.elapsed().as_secs_f32());
    Some(separator)
}

fn synth(len: usize, rate: u32) -> StereoAudio {
    let sine = |f: f32, phase: f32| -> Vec<f32> {
        (0..len)
            .map(|i| {
                let t = i as f32 / rate as f32;
                0.3 * (2.0 * std::f32::consts::PI * f * t + phase).sin() + 0.2 * (2.0 * std::f32::consts::PI * 3.0 * f * t).sin()
            })
            .collect()
    };
    StereoAudio {
        left: sine(220.0, 0.0),
        right: sine(220.0, 0.5),
        sample_rate: rate,
    }
}

/// 皮尔逊相关系数。
fn correlation(a: &[f32], b: &[f32]) -> f64 {
    let n = a.len().min(b.len());
    let mean = |x: &[f32]| x[..n].iter().map(|v| f64::from(*v)).sum::<f64>() / n as f64;
    let (ma, mb) = (mean(a), mean(b));
    let (mut cov, mut va, mut vb) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (x, y) = (f64::from(a[i]) - ma, f64::from(b[i]) - mb);
        cov += x * y;
        va += x * x;
        vb += y * y;
    }
    cov / (va.sqrt() * vb.sqrt()).max(1e-12)
}

/// 同一组测试对一个后端的加载函数展开一遍。
macro_rules! separation_tests {
    ($backend:ident, $load:path) => {
        mod $backend {
            use super::*;

            /// v2 的冒烟测试：48 kHz 输入走重采样，四个声部等长、有限，之和大致还原混音；第一次回调返回 `false` 必须报错。
            #[test]
            #[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
            fn separates_short_clip_and_reconstructs_mix() {
                let Some(mut separator) = $load() else { return };
                assert_eq!(separator.sample_rate(), 44_100);

                // 2 秒 48 kHz 输入：走重采样路径，输出应是 44.1 kHz。
                let mix = synth(96_000, 48_000);
                let mut windows_seen = 0;
                let stems = separator
                    .separate(&mix, &mut |p| {
                        if let SeparationProgress::Window { done, total } = p {
                            assert!(done <= total);
                            windows_seen = done;
                        }
                        true
                    })
                    .expect("分离");
                assert!(windows_seen > 0);
                let expected_len = (96_000.0 * 44_100.0 / 48_000.0_f64).round() as usize;
                for stem in [&stems.vocals, &stems.drums, &stems.bass, &stems.other] {
                    assert_eq!(stem.sample_rate, 44_100);
                    assert_eq!(stem.len(), expected_len);
                    assert!(stem.left.iter().all(|v| v.is_finite()));
                }

                // 四个声部之和应大致还原混音（各子模型独立预测，允许一定残差）。
                let resampled_left = resample(&mix.left, 48_000, 44_100);
                let sum: Vec<f32> = (0..expected_len)
                    .map(|i| stems.vocals.left[i] + stems.drums.left[i] + stems.bass.left[i] + stems.other.left[i])
                    .collect();
                let energy: f32 = resampled_left.iter().map(|v| v * v).sum();
                let residual: f32 = sum.iter().zip(&resampled_left).map(|(a, b)| (a - b) * (a - b)).sum();
                assert!(residual / energy < 0.5, "残差能量比 {}", residual / energy);

                // 取消：第一次回调返回 false 必须报错。
                let err = separator.separate(&mix, &mut |_| false).expect_err("取消应报错");
                assert!(err.to_string().contains("取消"), "{err}");
            }

            /// 一段英文语音（16 kHz 夹具，升到 44.1 kHz）叠一条合成低音（82 Hz + 二次谐波）：人声该跟语音走，背景该跟低音走。
            #[test]
            #[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
            fn splits_speech_from_a_synthetic_bass_line() {
                let Some(mut separator) = $load() else { return };
                let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/test-sample.wav");
                let speech16 = wav::read_wav(&fixture).expect("read fixture");
                assert_eq!(speech16.sample_rate, 16_000);
                let speech = resample(&speech16.left, 16_000, 44_100);
                let tone: Vec<f32> = (0..speech.len())
                    .map(|i| {
                        let t = i as f32 / 44_100.0;
                        0.15 * (std::f32::consts::TAU * 82.41 * t).sin() + 0.08 * (std::f32::consts::TAU * 164.82 * t).sin()
                    })
                    .collect();
                let mixed: Vec<f32> = speech.iter().zip(&tone).map(|(s, t)| s + t).collect();
                let mix = StereoAudio {
                    left: mixed.clone(),
                    right: mixed,
                    sample_rate: 44_100,
                };
                let started = Instant::now();
                let stems = separator.separate(&mix, &mut |_| true).expect("分离");
                let seconds = mix.duration_seconds();
                println!("{seconds:.2} s 的混音分离用了 {:.2} s", started.elapsed().as_secs_f32());
                let vocals = stems.vocals.to_mono();
                let background = stems.background().to_mono();
                let vs = correlation(&vocals, &speech);
                let vt = correlation(&vocals, &tone);
                let bt = correlation(&background, &tone);
                let bs = correlation(&background, &speech);
                println!("相关：人声~语音 {vs:.3}，人声~低音 {vt:.3}，背景~低音 {bt:.3}，背景~语音 {bs:.3}");
                assert!(vs > 0.95, "人声应跟语音走：{vs:.3}");
                assert!(bt > 0.95, "背景应跟低音走：{bt:.3}");
                assert!(vt.abs() < 0.1, "人声里不该有低音：{vt:.3}");
                assert!(bs.abs() < 0.1, "背景里不该有语音：{bs:.3}");
            }

            /// 自检样本（同一段 16 kHz 英文语音，单声道升到 44.1 kHz）只有人声：人声的 RMS 至少是背景的 2 倍——
            /// 与 `models.test` 对分离模型包的判定同一个阈值（Model Worker 协议规范 §4.3）。
            #[test]
            #[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
            fn pure_speech_lands_in_vocals() {
                let Some(mut separator) = $load() else { return };
                let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/test-sample.wav");
                let speech16 = wav::read_wav(&fixture).expect("read fixture");
                let speech = resample(&speech16.left, 16_000, 44_100);
                let mix = StereoAudio {
                    left: speech.clone(),
                    right: speech,
                    sample_rate: 44_100,
                };
                let stems = separator.separate(&mix, &mut |_| true).expect("分离");
                let rms = |x: &[f32]| (x.iter().map(|v| f64::from(*v) * f64::from(*v)).sum::<f64>() / x.len().max(1) as f64).sqrt();
                let vocals = rms(&stems.vocals.to_mono());
                let background = rms(&stems.background().to_mono());
                let db = 20.0 * (vocals / background.max(1e-12)).log10();
                println!("纯语音：人声 RMS {vocals:.4}，背景 RMS {background:.4}，人声比背景高 {db:.1} dB");
                assert!(vocals >= 0.001, "人声不该是静音：{vocals:.4}");
                assert!(
                    vocals >= 2.0 * background,
                    "人声应明显高于背景：{vocals:.4} vs {background:.4}"
                );
            }
        }
    };
}

#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
separation_tests!(mlx, load_mlx);

#[cfg(feature = "backend-candle")]
separation_tests!(candle, load_candle);

/// 信号失真比（dB）：`estimate` 相对 `reference` 的误差能量。
#[cfg(all(feature = "backend-candle", feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
fn sdr(reference: &[f32], estimate: &[f32]) -> f64 {
    let n = reference.len().min(estimate.len());
    let signal: f64 = reference[..n].iter().map(|v| f64::from(*v).powi(2)).sum();
    let noise: f64 = reference[..n]
        .iter()
        .zip(&estimate[..n])
        .map(|(r, e)| (f64::from(*r) - f64::from(*e)).powi(2))
        .sum();
    10.0 * (signal / noise.max(1e-20)).log10()
}

/// 两个后端读同一份权重、算同一张图：同一段混音的人声与背景应几乎一样（candle 的 CPU f32 对 MLX 的 Metal f32，
/// 只差浮点累加次序）。
#[cfg(all(feature = "backend-candle", feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn candle_matches_mlx_on_speech_over_bass() {
    let Some(mut mlx) = load_mlx() else { return };
    let Some(mut candle) = load_candle() else { return };
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/test-sample.wav");
    let speech16 = wav::read_wav(&fixture).expect("read fixture");
    let speech = resample(&speech16.left, 16_000, 44_100);
    let mixed: Vec<f32> = speech
        .iter()
        .enumerate()
        .map(|(i, s)| s + 0.15 * (std::f32::consts::TAU * 82.41 * i as f32 / 44_100.0).sin())
        .collect();
    let mix = StereoAudio {
        left: mixed.clone(),
        right: mixed,
        sample_rate: 44_100,
    };
    let started = Instant::now();
    let reference = mlx.separate(&mix, &mut |_| true).expect("MLX 分离");
    let mlx_seconds = started.elapsed().as_secs_f32();
    let started = Instant::now();
    let estimate = candle.separate(&mix, &mut |_| true).expect("candle 分离");
    let candle_seconds = started.elapsed().as_secs_f32();
    let vocals = sdr(&reference.vocals.to_mono(), &estimate.vocals.to_mono());
    let background = sdr(&reference.background().to_mono(), &estimate.background().to_mono());
    println!(
        "{:.2} s 的混音：MLX {mlx_seconds:.2} s，candle {candle_seconds:.2} s；candle 对 MLX 的 SDR：人声 {vocals:.1} dB，背景 {background:.1} dB",
        mix.duration_seconds()
    );
    assert!(vocals > 40.0, "人声与 MLX 差得太多：{vocals:.1} dB");
    assert!(background > 40.0, "背景与 MLX 差得太多：{background:.1} dB");
}
