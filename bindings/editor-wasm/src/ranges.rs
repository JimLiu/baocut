//! 引擎校验用的取值区间与缺省值：界面的数字框按它们封顶、按它们给初值，不在 TS 里另抄一份数字。
//!
//! 只有引擎的规则在这里；滑杆的常用范围、步长、读数的倍率是界面的设计，留在界面。区间都含两端，写成 `[下限, 上限]`。

use serde::Serialize;
use timeline::animations::{DURATION_MAX, DURATION_MIN, INTENSITY_MAX, INTENSITY_MIN, PERIOD_MAX, PERIOD_MIN};
use timeline::duck::{DUCK_ATTACK_DEFAULT, DUCK_DEPTH_DEFAULT, DUCK_DEPTH_RANGE, DUCK_RELEASE_DEFAULT, DUCK_TIME_RANGE};
use timeline::keyframes::{KEYFRAMES_MAX_PER_PROP, OPACITY_RANGE, PERCENT_RANGE, VOLUME_RANGE};
use timeline::schema::{
    CONFETTI_ANGLE_RANGE, CONFETTI_COUNT_RANGE, CONFETTI_GRAVITY_RANGE, CONFETTI_INTERVAL_RANGE, CONFETTI_MAX_COLORS,
    CONFETTI_OPACITY_RANGE, CONFETTI_ORIGIN_RANGE, CONFETTI_RATE_RANGE, CONFETTI_RATE_SCALE_RANGE, CONFETTI_SCALE_RANGE, CONFETTI_SHAPES,
    CONFETTI_SPREAD_RANGE, CONFETTI_WIND_RANGE, FX_ADJUST_RANGE, FX_AMOUNT_RANGE, FX_BLUR_RANGE,
};
use video_model::{FX_SHADOW_BLUR_RANGE, FX_SHADOW_OPACITY_RANGE, FX_STROKE_WIDTH_MAX, FX_TEMPERATURE_RANGE};

use crate::EntryError;

type Range = [f64; 2];

const fn range((lo, hi): (f64, f64)) -> Range {
    [lo, hi]
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Ranges {
    fx: FxRanges,
    ducking: DuckingRanges,
    /// 实例音量与音量包络（线性倍数）。
    volume: Range,
    keyframes: KeyframeRanges,
    animation: AnimationRanges,
    confetti: ConfettiRanges,
}

/// `fx`（视频格式规范 §3.9）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FxRanges {
    /// `grayscale`、`sharpen`、`noise`、`vignette`、`effectIntensity`。
    amount: Range,
    /// `brightness`、`contrast`、`exposure`、`hue`、`saturation`。
    adjust: Range,
    temperature: Range,
    /// `blur`（540 短边下的像素）。
    blur: Range,
    /// `shadow.blur`（540 短边下的像素）。
    shadow_blur: Range,
    /// `shadow.opacity`。
    shadow_opacity: Range,
    /// `stroke.width` 的上限（540 短边下的像素），下限不含 0。
    stroke_width_max: f64,
}

/// 闪避（§3.9）：压低多少 dB、起落多少秒，以及 `setDucking` 不给时的缺省。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DuckingRanges {
    depth: Range,
    /// `attack` 与 `release`。
    time: Range,
    defaults: DuckingDefaults,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DuckingDefaults {
    depth: f64,
    attack: f64,
    release: f64,
}

/// 关键帧：每个属性最多几个，各属性的取值。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyframeRanges {
    max_per_prop: usize,
    opacity: Range,
    volume: Range,
    percent: Range,
}

/// 入场、出场与循环动画的时长（秒）、周期（秒）与强度。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimationRanges {
    duration: Range,
    period: Range,
    intensity: Range,
}

/// 彩纸（`confetti`）的参数：倍率、风、不透明度、发射与起点的区间，色板上限与形状的封闭取值。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfettiRanges {
    /// 色板最多几种颜色。
    max_colors: usize,
    /// 12 种单位形（属性页的次序）。
    shapes: &'static [&'static str],
    size: Range,
    speed: Range,
    gravity: Range,
    drift: Range,
    spin: Range,
    /// 参考 540 短边下的 px/s²。
    wind: Range,
    opacity: Range,
    /// `emit.rate`（粒/秒）。
    rate: Range,
    /// `emit.count`（每次爆发枚数）。
    count: Range,
    /// `emit.interval`（秒，0 = 只放一次）。
    interval: Range,
    /// 发射方向（度）。
    angle: Range,
    /// 发射扇面（度）。
    spread: Range,
    /// `origin.x` 与 `origin.y`（盒内 %）。
    origin: Range,
}

/// 输入不看（约定传 `{}`），结果是上面的整张表。
pub fn engine_ranges(_input: &[u8]) -> Result<String, EntryError> {
    let ranges = Ranges {
        fx: FxRanges {
            amount: range(FX_AMOUNT_RANGE),
            adjust: range(FX_ADJUST_RANGE),
            temperature: range(FX_TEMPERATURE_RANGE),
            blur: range(FX_BLUR_RANGE),
            shadow_blur: range(FX_SHADOW_BLUR_RANGE),
            shadow_opacity: range(FX_SHADOW_OPACITY_RANGE),
            stroke_width_max: FX_STROKE_WIDTH_MAX,
        },
        ducking: DuckingRanges {
            depth: range(DUCK_DEPTH_RANGE),
            time: range(DUCK_TIME_RANGE),
            defaults: DuckingDefaults {
                depth: DUCK_DEPTH_DEFAULT,
                attack: DUCK_ATTACK_DEFAULT,
                release: DUCK_RELEASE_DEFAULT,
            },
        },
        volume: range(VOLUME_RANGE),
        keyframes: KeyframeRanges {
            max_per_prop: KEYFRAMES_MAX_PER_PROP,
            opacity: range(OPACITY_RANGE),
            volume: range(VOLUME_RANGE),
            percent: range(PERCENT_RANGE),
        },
        animation: AnimationRanges {
            duration: [DURATION_MIN, DURATION_MAX],
            period: [PERIOD_MIN, PERIOD_MAX],
            intensity: [INTENSITY_MIN, INTENSITY_MAX],
        },
        confetti: ConfettiRanges {
            max_colors: CONFETTI_MAX_COLORS,
            shapes: CONFETTI_SHAPES,
            size: range(CONFETTI_SCALE_RANGE),
            speed: range(CONFETTI_SCALE_RANGE),
            gravity: range(CONFETTI_GRAVITY_RANGE),
            drift: range(CONFETTI_RATE_SCALE_RANGE),
            spin: range(CONFETTI_RATE_SCALE_RANGE),
            wind: range(CONFETTI_WIND_RANGE),
            opacity: range(CONFETTI_OPACITY_RANGE),
            rate: range(CONFETTI_RATE_RANGE),
            count: range(CONFETTI_COUNT_RANGE),
            interval: range(CONFETTI_INTERVAL_RANGE),
            angle: range(CONFETTI_ANGLE_RANGE),
            spread: range(CONFETTI_SPREAD_RANGE),
            origin: range(CONFETTI_ORIGIN_RANGE),
        },
    };
    Ok(serde_json::to_string(&ranges).expect("区间总能序列化"))
}
