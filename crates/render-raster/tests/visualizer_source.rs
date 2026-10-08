//! `VizTrack` 的 source conformance（元素方案 ADR-E04 / §8.7）。
//!
//! 四条采样义务与 `AnimatedImage` / `Lottie` 逐字相同，只是"一帧"换成了频谱：
//! * **任意时刻直接 seek** —— `a_cold_track_seeks_straight_to_any_instant`
//! * **顺序 == 乱序** —— `shuffled_sampling_equals_sorted_sampling`
//! * **子资源进 hash** —— `the_fingerprint_covers_the_spectrum_and_the_params`
//! * **源不持有增量时钟** —— `sampling_takes_only_a_shared_reference`
//!
//! 夹具在 `core/fixtures/visualizer/`：`cases.json` 是**输入**（两份固定 BCS1 ×
//! 四组元素参数 × 时刻表 + 乱序序列），`expected-track.json` 是本阶段的 golden。
//! P3 / P5 / P6 三个执行器复用同一份 `cases.json`，各自追加自己的 expected 文件
//! （约定见夹具 README）。

use std::path::{Path, PathBuf};

use render_raster::drawop::fnv1a64;
use render_raster::source::visualizer::{VizFrame, VizParams, VizSource, VizTrack};
use serde_json::{Value, json};
use waveform::bcs1;

// ── 夹具的程序生成端 ───────────────────────────────────────────────

/// 合成频谱的帧数：3.0 s × 60 Hz。时刻表最大的 2.5 s 因此**落在轨内**，
/// 而不是全部撞到末帧。
const SWEEP_FRAMES: usize = 180;

/// 乱序序列的种子（motion 阶段 0 的写法：splitmix64 + Fisher–Yates）。
const SHUFFLE_SEED: u64 = 0x5EED_5EED_5EED_5EED;

/// 采样时刻表（设计 §8.7 冻结的五个时刻）。
const INSTANTS: [f64; 5] = [0.0, 0.1, 0.5, 1.0, 2.5];

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/visualizer")
}

fn spectrum_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/spectrum")
}

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// 程序生成的 3 s BCS1。
///
/// **刻意不走 `dsp::analyze`**：那条路的字节取决于 rustfft 的三角函数，跨平台
/// 逐位一致没人承诺过；本夹具钉的是"重映射 → 平滑 → 取整 → 查表"这条链路，
/// 用**纯整数算术**造出的 canonical 字节更适合当它的输入。真实 DSP 的字节 golden
/// 由 P1 的 `core/fixtures/spectrum/tone-48k-mono-f32.bcs1` 负责，本用例把它当
/// 第二份输入一起跑。
fn synth_spectrum(frames: usize) -> Vec<u8> {
    let time_bins = bcs1::TIME_BINS as usize;
    let freq_bins = bcs1::FREQ_BINS as usize;
    let mut payload = Vec::with_capacity(frames * bcs1::FRAME_LEN);
    let mut state = 0x0BCD_5EED_0BCD_5EEDu64;
    for frame in 0..frames {
        // 时域行：三角波，周期与振幅随帧号缓慢摆动，中心 128（静音基线）。
        let period = 8 + frame % 17;
        let amplitude = 20 + (frame * 7) % 100;
        for bin in 0..time_bins {
            let phase = (bin + frame) % period;
            let ramp = if phase * 2 <= period {
                phase * 2
            } else {
                period * 2 - phase * 2
            };
            let value = 128 + (ramp * 2 * amplitude / period) as i64 - amplitude as i64;
            payload.push(value.clamp(0, 255) as u8);
        }
        // 频域行：低频强、高频衰减，三处共振峰，帧级脉冲，外加低幅确定性抖动。
        let pulse = (40 + (frame * 13) % 60) as i64;
        for bin in 0..freq_bins {
            let decay = 200 - (bin as i64 * 200 / 96).min(200);
            let mut bump = 0i64;
            for (center, width, height) in [(12i64, 6i64, 45i64), (40, 10, 30), (88, 14, 20)] {
                let distance = (bin as i64 - center).abs();
                if distance < width {
                    bump += height * (width - distance) / width;
                }
            }
            let jitter = (splitmix64(&mut state) % 9) as i64 - 4;
            let value = decay + bump + pulse * decay / 255 + jitter;
            payload.push(value.clamp(0, 255) as u8);
        }
    }
    let hash = fnv1a64(&payload);
    bcs1::encode(
        &bcs1::Bcs1Header::new(bcs1::SpectrumBackend::Symphonia, frames as u32, hash),
        &payload,
    )
    .expect("合成 BCS1 必须自洽")
}

/// 四组元素参数：覆盖 canonical 恒等窗、新建默认窗、bicubic 全 bin 窗与 gain 放大。
fn param_sets() -> Vec<(&'static str, VizParams)> {
    vec![
        (
            "canonical",
            VizParams {
                min_db: -120.0,
                max_db: 40.0,
                smoothing: 0.0,
                gain: 1.0,
            },
        ),
        (
            "default",
            VizParams {
                min_db: -80.0,
                max_db: 40.0,
                smoothing: 0.8,
                gain: 1.0,
            },
        ),
        (
            "bicubic",
            VizParams {
                min_db: -120.0,
                max_db: -10.0,
                smoothing: 0.5,
                gain: 1.0,
            },
        ),
        (
            "hot",
            VizParams {
                min_db: -80.0,
                max_db: 40.0,
                smoothing: 0.8,
                gain: 2.5,
            },
        ),
    ]
}

fn spectra() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        (
            "tone",
            "../spectrum/tone-48k-mono-f32.bcs1",
            "P1 的真实 DSP golden，0.2 s：时刻表里 0.5 / 1.0 / 2.5 全部越界，专钉 clamp",
        ),
        (
            "sweep",
            "sweep-48k-mono.bcs1",
            "程序生成的 3.0 s 合成频谱：五个时刻全部落在轨内",
        ),
    ]
}

/// 采样序列 = (频谱 × 参数组 × 时刻) 的笛卡尔积，按 `cases.json` 的书写顺序编号。
/// 三个执行器共用这个编号，`shuffle.order` 是它的一个置换。
fn sequence_len() -> usize {
    spectra().len() * param_sets().len() * INSTANTS.len()
}

fn shuffled_order() -> Vec<usize> {
    let mut order: Vec<usize> = (0..sequence_len()).collect();
    let mut state = SHUFFLE_SEED;
    for index in (1..order.len()).rev() {
        let pick = (splitmix64(&mut state) % (index as u64 + 1)) as usize;
        order.swap(index, pick);
    }
    order
}

fn cases_json() -> Value {
    json!({
        "note": "P2 conformance 夹具的**输入**。P3 / P5 / P6 复用同一份，各自追加 expected-*.json。",
        "spectra": spectra()
            .into_iter()
            .map(|(name, path, note)| json!({"name": name, "path": path, "note": note}))
            .collect::<Vec<_>>(),
        "params": param_sets()
            .into_iter()
            .map(|(name, params)| json!({
                "name": name,
                "minDb": params.min_db,
                "maxDb": params.max_db,
                "smoothing": params.smoothing,
                "gain": params.gain,
            }))
            .collect::<Vec<_>>(),
        "instants": INSTANTS.to_vec(),
        "sequence": {
            "order": "spectra × params × instants，按本文件的书写顺序展开",
            "length": sequence_len(),
        },
        "shuffle": {
            "algorithm": "splitmix64 + Fisher–Yates（自 len-1 递减，pick = next % (i+1)）",
            "seed": format!("0x{SHUFFLE_SEED:016X}"),
            "order": shuffled_order(),
        },
        "styles": motion::preset_registry::timeline_visualizers()
            .iter()
            .map(|recipe| recipe.qualified_id())
            .collect::<Vec<_>>(),
    })
}

fn row_digest(row: &[u8]) -> String {
    format!("{:016x}", fnv1a64(row))
}

fn load_spectrum(relative: &str) -> Vec<u8> {
    if let Some(name) = relative.strip_prefix("../spectrum/") {
        let path = spectrum_dir().join(name);
        return std::fs::read(&path).unwrap_or_else(|e| panic!("读取 {}：{e}", path.display()));
    }
    if relative == "sweep-48k-mono.bcs1" {
        // 生成端与消费端共用同一个函数：门禁因此是"当场重算再逐字节比"。
        return synth_spectrum(SWEEP_FRAMES);
    }
    panic!("cases.json 里出现了未知频谱 {relative}");
}

fn tracks() -> Vec<(String, String, VizTrack)> {
    let mut out = Vec::new();
    for (spectrum_name, path, _) in spectra() {
        let bytes = load_spectrum(path);
        for (param_name, params) in param_sets() {
            let track = VizTrack::derive(&bytes, params)
                .unwrap_or_else(|e| panic!("{spectrum_name}/{param_name} 派生失败：{e:#}"));
            out.push((spectrum_name.to_owned(), param_name.to_owned(), track));
        }
    }
    out
}

fn expected_json() -> Value {
    let entries = tracks()
        .into_iter()
        .map(|(spectrum, params, track)| {
            let samples = INSTANTS
                .iter()
                .map(|instant| {
                    let index = track.frame_index_at(*instant).expect("轨非空");
                    let frame = track.sample(*instant).expect("轨非空");
                    json!({
                        "t": instant,
                        "index": index,
                        "timeDigest": row_digest(&frame.time),
                        "freqDigest": row_digest(&frame.freq),
                        "freqHead": frame.freq_window(8).to_vec(),
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "spectrum": spectrum,
                "params": params,
                "analysisRate": track.analysis_rate(),
                "frameCount": track.frame_count(),
                "timeBins": track.time_bins(),
                "freqBins": track.freq_bins(),
                "fingerprint": track.fingerprint().to_string(),
                "samples": samples,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "note": "P2 golden：整轨指纹 + 五个时刻的帧号与逐行摘要。改了派生语义才该动它。",
        "tracks": entries,
    })
}

fn pretty(value: &Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(value).expect("序列化夹具");
    bytes.push(b'\n');
    bytes
}

/// 重新生成夹具。确认过再跑：
/// `cargo test -p bcut-render --test visualizer_source -- --ignored`
#[test]
#[ignore]
fn write_visualizer_fixtures() {
    let dir = fixture_dir();
    std::fs::create_dir_all(&dir).expect("建夹具目录");
    std::fs::write(
        dir.join("sweep-48k-mono.bcs1"),
        synth_spectrum(SWEEP_FRAMES),
    )
    .unwrap();
    std::fs::write(dir.join("cases.json"), pretty(&cases_json())).unwrap();
    std::fs::write(dir.join("expected-track.json"), pretty(&expected_json())).unwrap();
}

/// 日常门禁：当场重算再逐字节比，挡住"改了生成器忘了写盘"。
#[test]
fn visualizer_fixtures_are_up_to_date() {
    let dir = fixture_dir();
    for (name, expected) in [
        ("sweep-48k-mono.bcs1", synth_spectrum(SWEEP_FRAMES)),
        ("cases.json", pretty(&cases_json())),
        ("expected-track.json", pretty(&expected_json())),
    ] {
        let path = dir.join(name);
        let actual = std::fs::read(&path).unwrap_or_else(|e| {
            panic!("{name} 缺失（跑 --ignored write_visualizer_fixtures）：{e}")
        });
        assert_eq!(actual, expected, "{name} 与生成器不一致");
    }
}

// ── 采样规则 ───────────────────────────────────────────────────────

/// 取整规则是契约的一部分：`floor(t × analysisRate)`，不插值、不四舍五入。
/// 真相住在 `waveform::bcs1::frame_index_at`——这条对拍确保 `VizTrack`
/// 与 BCS1 格式层**逐时刻**给出同一个帧号，而不是各写一份 floor。
#[test]
fn the_rounding_rule_matches_the_spectrum_format_layer() {
    for (_, path, _) in spectra() {
        let bytes = load_spectrum(path);
        let view = bcs1::parse(&bytes).unwrap();
        let track = VizTrack::derive(&bytes, param_sets()[0].1).unwrap();
        assert_eq!(track.frame_count(), view.frame_count());
        for step in -50..4000 {
            let seconds = f64::from(step) / 1000.0;
            assert_eq!(
                track.frame_index_at(seconds),
                view.frame_index_at(seconds),
                "{seconds}s"
            );
        }
        // 帧边界两侧：略早于 1 / analysisRate 还在第 0 帧，
        // 正好落在边界时已经是第 1 帧。
        let first_boundary = 1.0 / f64::from(view.header().analysis_rate);
        assert_eq!(track.frame_index_at(first_boundary - f64::EPSILON), Some(0));
        assert_eq!(track.frame_index_at(first_boundary), Some(1));
    }
}

/// 越界一律 clamp：负时刻落首帧，末端之后冻结末帧，NaN / 无穷按首帧处理。
#[test]
fn out_of_range_instants_clamp_instead_of_failing() {
    let bytes = load_spectrum("../spectrum/tone-48k-mono-f32.bcs1");
    let track = VizTrack::derive(&bytes, param_sets()[1].1).unwrap();
    let last = track.frame_count() - 1;
    assert_eq!(track.frame_index_at(-3.0), Some(0));
    assert_eq!(track.frame_index_at(f64::NEG_INFINITY), Some(0));
    assert_eq!(track.frame_index_at(f64::NAN), Some(0));
    assert_eq!(track.frame_index_at(1e9), Some(last));
    // `+∞` 走的是「非有限 → 帧 0」那条分支（P1 冻结的行为，与 NaN 同路），
    // 不是「大到越界 → 末帧」。这里如实钉住，免得将来有人以为它是 bug 顺手改掉：
    // 真相在 `waveform::bcs1::frame_index_at`，改它要连 BCS1 一起改。
    assert_eq!(track.frame_index_at(f64::INFINITY), Some(0));
    // 时刻表里三个越界时刻取到的都是同一帧——这正是 tone 夹具存在的意义。
    assert_eq!(track.sample(0.5), track.sample(2.5));
    assert_eq!(track.sample(2.5).unwrap(), track.frame(last).unwrap());
}

/// **conformance 必选项**：乱序采样与顺序采样逐位一致。
///
/// 序列是 `cases.json` 的 (频谱 × 参数 × 时刻) 笛卡尔积，置换取夹具里那份
/// splitmix64 Fisher–Yates。源里没有任何可变状态，这条才可能绿。
#[test]
fn shuffled_sampling_equals_sorted_sampling() {
    let all = tracks();
    let read = |index: usize| -> (usize, String, String) {
        let instant = INSTANTS[index % INSTANTS.len()];
        let (_, _, track) = &all[index / INSTANTS.len()];
        let frame = track.sample(instant).expect("轨非空");
        (
            track.frame_index_at(instant).unwrap(),
            row_digest(&frame.time),
            row_digest(&frame.freq),
        )
    };
    let sorted: Vec<_> = (0..sequence_len()).map(read).collect();
    let mut shuffled = vec![(usize::MAX, String::new(), String::new()); sequence_len()];
    for index in shuffled_order() {
        shuffled[index] = read(index);
    }
    assert_eq!(sorted, shuffled);
    // 置换本身要是个真置换，否则上面那条断言可以靠"顺序执行"蒙混过关。
    let mut seen = shuffled_order();
    seen.sort_unstable();
    assert_eq!(seen, (0..sequence_len()).collect::<Vec<_>>());
    assert_ne!(shuffled_order(), (0..sequence_len()).collect::<Vec<_>>());
}

/// 冷轨直接跳到任意时刻，与"走完全程再跳"逐字节相同：没有 warm-up 这回事。
#[test]
fn a_cold_track_seeks_straight_to_any_instant() {
    let bytes = load_spectrum("sweep-48k-mono.bcs1");
    let cold = VizTrack::derive(&bytes, param_sets()[3].1).unwrap();
    let warm = VizTrack::derive(&bytes, param_sets()[3].1).unwrap();
    for step in 0..120 {
        let _ = warm.sample(f64::from(step) * 0.025);
    }
    for instant in INSTANTS {
        assert_eq!(cold.sample(instant), warm.sample(instant), "{instant}s");
    }
}

/// 采样只取共享引用：`&dyn VizSource` 上重复采样恒等，源里没有增量时钟可持有。
#[test]
fn sampling_takes_only_a_shared_reference() {
    let bytes = load_spectrum("sweep-48k-mono.bcs1");
    let track = VizTrack::derive(&bytes, param_sets()[1].1).unwrap();
    let source: &dyn VizSource = &track;
    let first = source.sample(1.0).unwrap().clone();
    for _ in 0..5 {
        assert_eq!(source.sample(1.0).unwrap(), &first);
    }
}

// ── 派生语义 ───────────────────────────────────────────────────────

/// 平滑递推 golden：`y[n] = τ·y[n-1] + (1-τ)·x[n]`，`y[-1] = 0`，**从帧 0 顺序
/// 推进**，gain 在最后一步相乘且不进递推状态。
///
/// 这条不读夹具——它把整轨派生的结果与 `waveform::remap::Remapper` 的逐帧
/// 推进逐字节对拍，钉的是"整轨派生没有把顺序推错、没有把 gain 折进状态"。
#[test]
fn the_smoothing_recursion_matches_the_reference_advance() {
    let bytes = load_spectrum("sweep-48k-mono.bcs1");
    let view = bcs1::parse(&bytes).unwrap();
    for (name, params) in param_sets() {
        let track = VizTrack::derive(&bytes, params).unwrap();
        let mut reference = waveform::remap::Remapper::new(
            view.header().freq_bins as usize,
            params.min_db,
            params.max_db,
            params.smoothing,
            params.gain,
        );
        for index in 0..view.frame_count() {
            let expected = reference.map_row(view.freq_row(index).unwrap());
            assert_eq!(
                track.frame(index).unwrap().freq.as_ref(),
                expected.as_slice(),
                "{name} 的第 {index} 帧频域行"
            );
        }
    }
    // τ = 0.8 的头三帧写死：`x` 恒为 canonical 255（= 100 线性幅度），
    // 在线性域得到 20 / 36 / 48.8，再转 dB 映射到 [-80, 40]。
    let flat = flat_spectrum(255);
    let track = VizTrack::derive(
        &flat,
        VizParams {
            min_db: -80.0,
            max_db: 40.0,
            smoothing: 0.8,
            gain: 1.0,
        },
    )
    .unwrap();
    assert_eq!(track.frame(0).unwrap().freq[0], 225);
    assert_eq!(track.frame(1).unwrap().freq[0], 236);
    assert_eq!(track.frame(2).unwrap().freq[0], 242);
}

fn flat_spectrum(freq_byte: u8) -> Vec<u8> {
    let mut payload = Vec::new();
    for _ in 0..8 {
        payload.extend(std::iter::repeat_n(128u8, bcs1::TIME_BINS as usize));
        payload.extend(std::iter::repeat_n(freq_byte, bcs1::FREQ_BINS as usize));
    }
    bcs1::encode(
        &bcs1::Bcs1Header::new(bcs1::SpectrumBackend::Symphonia, 8, 7),
        &payload,
    )
    .unwrap()
}

/// **时域行原样搬运**：dB 窗、平滑与 gain 只作用于频域行。
///
/// 依据是 Web Audio 语义（`smoothingTimeConstant` 只管
/// `getByteFrequencyData`），也是常识——「静音 ≈ 128」的中心化波形套 dB 窗没有
/// 意义。这是本阶段相对 ADR-E04 文字的一处细化，记在实施记录里。
#[test]
fn the_time_row_is_carried_through_verbatim() {
    let bytes = load_spectrum("sweep-48k-mono.bcs1");
    let view = bcs1::parse(&bytes).unwrap();
    for (name, params) in param_sets() {
        let track = VizTrack::derive(&bytes, params).unwrap();
        for index in 0..view.frame_count() {
            assert_eq!(
                track.frame(index).unwrap().time.as_ref(),
                view.time_row(index).unwrap(),
                "{name} 的第 {index} 帧时域行"
            );
        }
    }
}

/// 指纹覆盖上游 BCS1 与派生参数：改一个字节、改一个 dB 端点都换指纹；
/// 同输入两次派生同指纹。
#[test]
fn the_fingerprint_covers_the_spectrum_and_the_params() {
    let bytes = load_spectrum("sweep-48k-mono.bcs1");
    let base = VizTrack::derive(&bytes, param_sets()[1].1).unwrap();
    assert_eq!(
        base.fingerprint(),
        VizTrack::derive(&bytes, param_sets()[1].1)
            .unwrap()
            .fingerprint(),
        "同字节同参数必须同指纹"
    );
    for (name, params) in param_sets() {
        if name == "default" {
            continue;
        }
        assert_ne!(
            base.fingerprint(),
            VizTrack::derive(&bytes, params).unwrap().fingerprint(),
            "参数组 {name} 必须换指纹"
        );
    }
    // 换一个 payload 字节 → 换 BCS1 content_hash → 换轨指纹。
    let mut tweaked = bytes.clone();
    let offset = bcs1::HEADER_LEN + bcs1::TIME_BINS as usize;
    tweaked[offset] = tweaked[offset].wrapping_add(1);
    assert_ne!(
        base.fingerprint(),
        VizTrack::derive(&tweaked, param_sets()[1].1)
            .unwrap()
            .fingerprint()
    );
}

/// 夹具的 golden 与当前实现一致（`expected-track.json` 是它的书面形式）。
#[test]
fn the_committed_golden_matches_the_derivation() {
    let path = fixture_dir().join("expected-track.json");
    let committed: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(committed, expected_json());
    // golden 里必须真的出现 8 条轨（2 份频谱 × 4 组参数）。
    assert_eq!(committed["tracks"].as_array().unwrap().len(), 8);
}

/// `VizFrame` 是纯数据，两条行的宽度来自 BCS1 而不是配方——`binWidth` 的取窗
/// 是绘制期的事（§8.4）。
#[test]
fn the_row_widths_come_from_the_spectrum_not_from_the_recipe() {
    let bytes = load_spectrum("sweep-48k-mono.bcs1");
    let track = VizTrack::derive(&bytes, param_sets()[0].1).unwrap();
    assert_eq!(track.time_bins(), bcs1::TIME_BINS as usize);
    assert_eq!(track.freq_bins(), bcs1::FREQ_BINS as usize);
    let frame: &VizFrame = track.sample(1.0).unwrap();
    assert_eq!(frame.freq_window(64).len(), 64);
    assert_eq!(frame.freq_window(512).len(), 512);
}
