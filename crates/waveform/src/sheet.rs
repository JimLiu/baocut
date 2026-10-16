//! 听音表：把一段音频画成一张图，让看不见波形的人（与模型）也能「看」到声音，并核对它与画面事件的对位。
//! 只出 RGBA 像素，编码成 PNG 由宿主做；图上不写字，刻度与颜色的含义由调用方的说明交代。
//!
//! 自上而下三条：
//!
//! 1. **频谱**（[`SPECTRUM_HEIGHT`] 像素）：纵轴 40 Hz 到奈奎斯特（最高 11 kHz）按对数，亮度是相对整段
//!    最大值的 dB（−72..0）；
//! 2. **波形**（[`WAVE_HEIGHT`] 像素）：每一列的样本峰值（淡）与均方根（亮），按满刻度 0 dBFS 画，不归一，
//!    安静的段落看起来就小；
//! 3. **事件**（[`EVENT_HEIGHT`] 像素）：节拍是灰色竖线（小节的第一拍更亮），起音是从底部长出来的刻度、
//!    高度随强度，重音是橙色的整条。
//!
//! 横轴与时间成正比。前两条上有时间网格：30 秒以内每秒一条、每 5 秒一条亮的；更长时每 5 秒一条、
//! 每 30 秒一条亮的。要核对的时刻画成贯穿三条的 2 像素竖线：绿是对上了（ok），琥珀是差一点（near），
//! 红是附近没有起音（none）。
//!
//! 思路参考开源项目 earshot（MIT 许可）的 listen sheet；这里是独立实现。

use realfft::RealFftPlanner;

use crate::cues::{CueMatch, CueStatus};

pub const SPECTRUM_HEIGHT: usize = 256;
pub const WAVE_HEIGHT: usize = 112;
pub const EVENT_HEIGHT: usize = 48;
/// 条与条之间的缝。
const GAP: usize = 2;
/// 整张图的高。
pub const HEIGHT: usize = SPECTRUM_HEIGHT + GAP + WAVE_HEIGHT + GAP + EVENT_HEIGHT;
/// 宽度的允许范围。
pub const MIN_WIDTH: usize = 200;
pub const MAX_WIDTH: usize = 4000;

const LOW_HZ: f64 = 40.0;
const HIGH_HZ: f64 = 11_000.0;
const RANGE_DB: f64 = 72.0;

type Rgb = [u8; 3];
const BACKGROUND: Rgb = [16, 16, 20];
const GAP_COLOR: Rgb = [40, 40, 48];
const GRID: Rgb = [70, 70, 84];
const GRID_MAJOR: Rgb = [120, 120, 140];
const WAVE_PEAK: Rgb = [70, 110, 150];
const WAVE_RMS: Rgb = [150, 200, 240];
const BEAT: Rgb = [90, 90, 100];
const DOWNBEAT: Rgb = [170, 170, 185];
const ONSET: Rgb = [220, 220, 230];
const ACCENT: Rgb = [255, 140, 40];
const CUE_OK: Rgb = [60, 220, 130];
const CUE_NEAR: Rgb = [255, 190, 40];
const CUE_NONE: Rgb = [255, 70, 70];

/// 画一张听音表要的东西。时间都是秒，PCM 第 0 个采样是 0。
pub struct SheetInput<'a> {
    pub pcm: &'a [f32],
    pub sample_rate: u32,
    pub width: usize,
    /// 起音时刻与强度（0..1）。
    pub onsets: &'a [(f64, f32)],
    /// 重音时刻。
    pub accents: &'a [f64],
    /// 拍点与小节开始（没有节拍时为空）。
    pub beats: &'a [f64],
    pub bars: &'a [f64],
    /// 要核对的时刻；`outside` 的不画。
    pub cues: &'a [CueMatch],
}

/// `width × HEIGHT` 的 RGBA 像素，逐行自上而下。
pub struct Sheet {
    pub width: usize,
    pub height: usize,
    pub rgba: Vec<u8>,
}

struct Canvas {
    width: usize,
    rgba: Vec<u8>,
}

impl Canvas {
    fn new(width: usize) -> Self {
        let mut rgba = Vec::with_capacity(width * HEIGHT * 4);
        for _ in 0..width * HEIGHT {
            rgba.extend_from_slice(&[BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 255]);
        }
        Self { width, rgba }
    }

    fn set(&mut self, x: usize, y: usize, color: Rgb) {
        if x < self.width && y < HEIGHT {
            let i = (y * self.width + x) * 4;
            self.rgba[i..i + 3].copy_from_slice(&color);
        }
    }

    fn column(&mut self, x: usize, top: usize, bottom: usize, color: Rgb) {
        for y in top..bottom {
            self.set(x, y, color);
        }
    }

    fn row(&mut self, y: usize, color: Rgb) {
        for x in 0..self.width {
            self.set(x, y, color);
        }
    }
}

const SPECTRUM_TOP: usize = 0;
const WAVE_TOP: usize = SPECTRUM_HEIGHT + GAP;
const EVENT_TOP: usize = WAVE_TOP + WAVE_HEIGHT + GAP;

/// 画听音表。`width` 须在 [`MIN_WIDTH`]..=[`MAX_WIDTH`]，PCM 不能为空（调用方先检查）。
pub fn render(input: &SheetInput) -> Sheet {
    let width = input.width.clamp(MIN_WIDTH, MAX_WIDTH);
    let rate = f64::from(input.sample_rate);
    let duration = input.pcm.len() as f64 / rate;
    let mut canvas = Canvas::new(width);
    let x_of = |t: f64| -> Option<usize> {
        if duration <= 0.0 || !(0.0..=duration).contains(&t) {
            return None;
        }
        Some(((t / duration * width as f64) as usize).min(width - 1))
    };

    spectrum(&mut canvas, input.pcm, rate);
    waveform(&mut canvas, input.pcm);
    for y in [
        SPECTRUM_HEIGHT,
        SPECTRUM_HEIGHT + 1,
        EVENT_TOP - 2,
        EVENT_TOP - 1,
    ] {
        canvas.row(y, GAP_COLOR);
    }

    // 时间网格：只在频谱与波形两条的上沿和下沿画短刻度，不盖住内容中段。
    let (step, major) = if duration <= 30.0 {
        (1.0, 5.0)
    } else {
        (5.0, 30.0)
    };
    let mut k = 1;
    while (k as f64) * step < duration {
        let t = k as f64 * step;
        if let Some(x) = x_of(t) {
            let is_major = (t / major).fract().abs() < 1e-9;
            let (color, len) = if is_major {
                (GRID_MAJOR, 10)
            } else {
                (GRID, 5)
            };
            for top in [SPECTRUM_TOP, WAVE_TOP] {
                canvas.column(x, top, top + len, color);
            }
            canvas.column(
                x,
                WAVE_TOP + WAVE_HEIGHT - len,
                WAVE_TOP + WAVE_HEIGHT,
                color,
            );
        }
        k += 1;
    }

    // 事件条：节拍、起音、重音。
    for t in input.beats {
        if let Some(x) = x_of(*t) {
            canvas.column(x, EVENT_TOP, EVENT_TOP + EVENT_HEIGHT, BEAT);
        }
    }
    for t in input.bars {
        if let Some(x) = x_of(*t) {
            canvas.column(x, EVENT_TOP, EVENT_TOP + EVENT_HEIGHT, DOWNBEAT);
        }
    }
    for (t, strength) in input.onsets {
        if let Some(x) = x_of(*t) {
            let len = ((f64::from(*strength).clamp(0.0, 1.0) * (EVENT_HEIGHT - 4) as f64) as usize)
                .max(4);
            canvas.column(
                x,
                EVENT_TOP + EVENT_HEIGHT - len,
                EVENT_TOP + EVENT_HEIGHT,
                ONSET,
            );
        }
    }
    for t in input.accents {
        if let Some(x) = x_of(*t) {
            for dx in 0..3 {
                canvas.column(
                    (x + dx).saturating_sub(1),
                    EVENT_TOP,
                    EVENT_TOP + EVENT_HEIGHT,
                    ACCENT,
                );
            }
        }
    }

    // 时刻：贯穿三条，2 像素宽。
    for cue in input.cues {
        let color = match cue.status {
            CueStatus::Ok => CUE_OK,
            CueStatus::Near => CUE_NEAR,
            CueStatus::None => CUE_NONE,
            CueStatus::Outside => continue,
        };
        if let Some(x) = x_of(cue.t) {
            canvas.column(x, 0, HEIGHT, color);
            canvas.column((x + 1).min(width - 1), 0, HEIGHT, color);
        }
    }

    Sheet {
        width,
        height: HEIGHT,
        rgba: canvas.rgba,
    }
}

/// 每列一帧 STFT（Hann 窗、约 46 ms），对数频率的行取该行频段里最大的 bin。
fn spectrum(canvas: &mut Canvas, pcm: &[f32], rate: f64) {
    let width = canvas.width;
    let window_len = ((rate * 0.046) as usize).next_power_of_two().max(256);
    let window: Vec<f64> = (0..window_len)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / window_len as f64).cos())
        .collect();
    let bin_hz = rate / window_len as f64;
    let bins = window_len / 2 + 1;
    let high = HIGH_HZ.min(0.49 * rate);
    // 第 r 行（自底向上）覆盖 [edge(r), edge(r + 1))。
    let edge = |r: usize| LOW_HZ * (high / LOW_HZ).powf(r as f64 / SPECTRUM_HEIGHT as f64);
    let rows: Vec<(usize, usize)> = (0..SPECTRUM_HEIGHT)
        .map(|r| {
            let a = ((edge(r) / bin_hz).round() as usize).clamp(1, bins - 1);
            let b = ((edge(r + 1) / bin_hz).round() as usize).clamp(a + 1, bins);
            (a, b)
        })
        .collect();
    let fft = RealFftPlanner::<f64>::new().plan_fft_forward(window_len);
    let mut input = fft.make_input_vec();
    let mut output = fft.make_output_vec();
    let mut db = vec![f64::NEG_INFINITY; width * SPECTRUM_HEIGHT];
    let mut top = f64::NEG_INFINITY;
    for x in 0..width {
        let center = ((x as f64 + 0.5) / width as f64 * pcm.len() as f64) as isize;
        let start = center - (window_len / 2) as isize;
        for (i, slot) in input.iter_mut().enumerate() {
            let k = start + i as isize;
            let sample = if k >= 0 {
                pcm.get(k as usize).copied().unwrap_or(0.0)
            } else {
                0.0
            };
            *slot = f64::from(sample) * window[i];
        }
        fft.process(&mut input, &mut output)
            .expect("buffers come from the same plan");
        for (r, (a, b)) in rows.iter().enumerate() {
            let power = output[*a..*b]
                .iter()
                .map(|c| c.norm_sqr())
                .fold(0.0, f64::max);
            let value = 10.0 * power.max(1e-20).log10();
            db[r * width + x] = value;
            top = top.max(value);
        }
    }
    for r in 0..SPECTRUM_HEIGHT {
        let y = SPECTRUM_TOP + SPECTRUM_HEIGHT - 1 - r;
        for x in 0..width {
            let level = ((db[r * width + x] - top + RANGE_DB) / RANGE_DB).clamp(0.0, 1.0);
            canvas.set(x, y, heat(level));
        }
    }
}

/// 每列样本的峰值与均方根，以中线为零、上下对称。
fn waveform(canvas: &mut Canvas, pcm: &[f32]) {
    let width = canvas.width;
    let mid = WAVE_TOP + WAVE_HEIGHT / 2;
    let half = (WAVE_HEIGHT / 2 - 1) as f64;
    for x in 0..width {
        let a = x * pcm.len() / width;
        let b = ((x + 1) * pcm.len() / width).max(a + 1).min(pcm.len());
        let slice = &pcm[a.min(b)..b];
        if slice.is_empty() {
            continue;
        }
        let peak = slice
            .iter()
            .fold(0.0_f64, |m, v| m.max(f64::from(*v).abs()))
            .min(1.0);
        let rms = (slice.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>() / slice.len() as f64)
            .sqrt()
            .min(1.0);
        let p = (peak * half).round() as usize;
        let r = (rms * half).round() as usize;
        canvas.column(x, mid - p, mid + p + 1, WAVE_PEAK);
        canvas.column(x, mid - r, mid + r + 1, WAVE_RMS);
    }
}

/// 0..1 → 暗紫、品红、橙、浅黄的热度色。
fn heat(level: f64) -> Rgb {
    const STOPS: [(f64, [f64; 3]); 5] = [
        (0.0, [16.0, 16.0, 20.0]),
        (0.3, [70.0, 20.0, 110.0]),
        (0.55, [190.0, 50.0, 110.0]),
        (0.8, [250.0, 140.0, 40.0]),
        (1.0, [255.0, 245.0, 190.0]),
    ];
    let level = level.clamp(0.0, 1.0);
    let k = STOPS
        .iter()
        .position(|(at, _)| *at >= level)
        .unwrap_or(STOPS.len() - 1)
        .max(1);
    let (a_at, a) = STOPS[k - 1];
    let (b_at, b) = STOPS[k];
    let f = (level - a_at) / (b_at - a_at);
    [0, 1, 2].map(|c| (a[c] + (b[c] - a[c]) * f).round() as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(sheet: &Sheet, x: usize, y: usize) -> Rgb {
        let i = (y * sheet.width + x) * 4;
        [sheet.rgba[i], sheet.rgba[i + 1], sheet.rgba[i + 2]]
    }

    #[test]
    fn the_sheet_has_its_size_draws_cues_by_status_and_is_deterministic() {
        let rate = 16_000;
        let pcm: Vec<f32> = (0..rate * 4)
            .map(|i| 0.5 * (i as f32 * 2.0 * std::f32::consts::PI * 1000.0 / rate as f32).sin())
            .collect();
        let cues = [
            CueMatch {
                t: 1.0,
                delta: Some(0.0),
                status: CueStatus::Ok,
            },
            CueMatch {
                t: 2.0,
                delta: Some(0.1),
                status: CueStatus::Near,
            },
            CueMatch {
                t: 3.0,
                delta: None,
                status: CueStatus::None,
            },
            CueMatch {
                t: 9.0,
                delta: None,
                status: CueStatus::Outside,
            },
        ];
        let input = SheetInput {
            pcm: &pcm,
            sample_rate: rate as u32,
            width: 400,
            onsets: &[(0.5, 1.0)],
            accents: &[0.5],
            beats: &[],
            bars: &[],
            cues: &cues,
        };
        let sheet = render(&input);
        assert_eq!((sheet.width, sheet.height), (400, HEIGHT));
        assert_eq!(sheet.rgba.len(), 400 * HEIGHT * 4);
        assert_eq!(render(&input).rgba, sheet.rgba);
        assert_eq!(pixel(&sheet, 100, 10), CUE_OK);
        assert_eq!(pixel(&sheet, 200, EVENT_TOP + 5), CUE_NEAR);
        assert_eq!(pixel(&sheet, 300, WAVE_TOP + 5), CUE_NONE);
        // 重音在 0.5 秒（第 50 列）占满事件条。
        assert_eq!(pixel(&sheet, 50, EVENT_TOP + 2), ACCENT);
        // 1 kHz 的正弦：它所在的行比 100 Hz 的行亮。
        let row_of = |hz: f64| {
            let r = (SPECTRUM_HEIGHT as f64 * (hz / LOW_HZ).ln()
                / (HIGH_HZ.min(0.49 * 16_000.0) / LOW_HZ).ln()) as usize;
            SPECTRUM_TOP + SPECTRUM_HEIGHT - 1 - r
        };
        let brightness = |c: Rgb| c.iter().map(|v| u32::from(*v)).sum::<u32>();
        assert!(
            brightness(pixel(&sheet, 150, row_of(1000.0)))
                > brightness(pixel(&sheet, 150, row_of(100.0))) + 200
        );
        // 0.5 振幅的波形：中线一定有颜色，波形条顶上没有。
        assert_eq!(pixel(&sheet, 150, WAVE_TOP + WAVE_HEIGHT / 2), WAVE_RMS);
        assert_eq!(pixel(&sheet, 150, WAVE_TOP + 1), BACKGROUND);
    }

    #[test]
    fn heat_runs_from_background_to_bright() {
        assert_eq!(heat(0.0), BACKGROUND);
        assert_eq!(heat(1.0), [255, 245, 190]);
        assert_eq!(heat(0.55), [190, 50, 110]);
    }
}
