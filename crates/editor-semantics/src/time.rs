//! 时间类型与规则（视频格式规范 §2）。这里是 `parseDecimalSeconds`、`compareTime`、
//! `mapTime`、`quantizeFrame`、`timestampAt` 的语义单源（§2.13）；宿主只拿结果。

use message_ref::{Text, msg};
use serde::{Deserialize, Serialize};

use crate::ratio::Ratio;

/// 时间合同的版本（§2.13、TIME-08）。改变舍入或采样规则必须升级它。
pub const TIME_CONTRACT_VERSION: u32 = 1;

/// JSON 里的安全整数上限（2^53 − 1）。帧号、timescale、Rate 的分子分母都不超过它。
pub const MAX_SAFE_INTEGER: i128 = (1 << 53) - 1;

/// 十进制秒最多接受的整数位与小数位。超过时报溢出，不截断。
const MAX_INT_DIGITS: usize = 18;
const MAX_FRAC_DIGITS: usize = 18;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TimeError {
    /// 非法的十进制、负的绝对位置、零 timebase（`INVALID_TIME_VALUE`）。
    Invalid { field: String, reason: Text },
    /// 输入或中间值超出合同上限（`TIME_ARITHMETIC_OVERFLOW`）。
    Overflow { field: String },
    /// `exact-frame` 的请求不在帧边界上（`TIME_NOT_ON_FRAME_GRID`）。
    NotOnFrameGrid {
        requested: MediaTime,
        floor: i64,
        ceil: i64,
        nearest: i64,
    },
}

impl TimeError {
    pub fn code(&self) -> &'static str {
        match self {
            TimeError::Invalid { .. } => "INVALID_TIME_VALUE",
            TimeError::Overflow { .. } => "TIME_ARITHMETIC_OVERFLOW",
            TimeError::NotOnFrameGrid { .. } => "TIME_NOT_ON_FRAME_GRID",
        }
    }

    fn invalid(field: &str, reason: Text) -> TimeError {
        TimeError::Invalid {
            field: field.to_string(),
            reason,
        }
    }

    fn overflow(field: &str) -> TimeError {
        TimeError::Overflow { field: field.to_string() }
    }
}

/// 帧率：约分之后的正有理数（§2.3）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rate {
    pub num: i64,
    pub den: i64,
}

impl Rate {
    pub fn new(num: i64, den: i64) -> Result<Rate, TimeError> {
        let rate = Rate { num, den };
        rate.validate("rate")?;
        Ok(rate)
    }

    /// 分子分母为正的安全整数并已约分。不约分的 Rate 不接受，避免同一个帧率有两种写法。
    pub fn validate(&self, field: &str) -> Result<(), TimeError> {
        let (num, den) = (self.num as i128, self.den as i128);
        if num <= 0 || den <= 0 {
            return Err(TimeError::invalid(field, msg!("time.rateNotPositive", "Frame rate numerator and denominator must be positive")));
        }
        if num > MAX_SAFE_INTEGER || den > MAX_SAFE_INTEGER {
            return Err(TimeError::overflow(field));
        }
        let reduced = self.ratio();
        if reduced.num() != num || reduced.den() != den {
            return Err(TimeError::invalid(field, msg!("time.rateNotReduced", "Frame rate must be in lowest terms")));
        }
        Ok(())
    }

    pub fn ratio(self) -> Ratio {
        Ratio::new(self.num as i128, self.den as i128).expect("Rate 已校验")
    }

    /// 一帧的时长（秒）。
    pub fn frame_duration(self) -> Ratio {
        Ratio::new(self.den as i128, self.num as i128).expect("Rate 已校验")
    }
}

/// `ticks / timescale` 秒。`ticks` 是有符号的十进制整数字符串（§2.3）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaTime {
    pub ticks: String,
    pub timescale: i64,
}

impl MediaTime {
    /// 规范形式：约分之后的值。timescale 必须是安全整数。
    pub fn from_ratio(value: Ratio, field: &str) -> Result<MediaTime, TimeError> {
        if value.den() > MAX_SAFE_INTEGER {
            return Err(TimeError::overflow(field));
        }
        Ok(MediaTime {
            ticks: value.num().to_string(),
            timescale: value.den() as i64,
        })
    }

    pub fn zero() -> MediaTime {
        MediaTime {
            ticks: "0".into(),
            timescale: 1,
        }
    }

    /// 按值解析；1500/1000 与 3/2 得到同一个 `Ratio`（§2.3、TM05）。
    pub fn to_ratio(&self, field: &str) -> Result<Ratio, TimeError> {
        if self.timescale <= 0 {
            return Err(TimeError::invalid(field, msg!("time.timescaleNotPositive", "timescale must be greater than 0")));
        }
        if self.timescale as i128 > MAX_SAFE_INTEGER {
            return Err(TimeError::overflow(field));
        }
        let ticks = parse_integer(&self.ticks, field)?;
        Ratio::new(ticks, self.timescale as i128).ok_or_else(|| TimeError::overflow(field))
    }

    /// 缓存键用的规范值（§2.13）。
    pub fn canonical_key(&self, field: &str) -> Result<String, TimeError> {
        Ok(self.to_ratio(field)?.canonical())
    }
}

fn parse_integer(text: &str, field: &str) -> Result<i128, TimeError> {
    let digits = text.strip_prefix('-').unwrap_or(text);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(TimeError::invalid(field, msg!("time.notInteger", "Not a decimal integer: \"{text}\"", text)));
    }
    if digits.len() > 1 && digits.starts_with('0') {
        return Err(TimeError::invalid(field, msg!("time.leadingZero", "Integers cannot have leading zeros")));
    }
    if digits.len() > MAX_INT_DIGITS {
        return Err(TimeError::overflow(field));
    }
    text.parse::<i128>().map_err(|_| TimeError::overflow(field))
}

/// 精确解析十进制秒（§2.8、TM05、TM06）。
///
/// 语法：可选的负号，至少一位整数，可选的小数部分（点之后至少一位）。不接受加号、
/// 指数、NaN、Infinity、空白与千分位。超出位数或合同上限时报溢出，不截断。
pub fn parse_decimal_seconds(text: &str, field: &str) -> Result<Ratio, TimeError> {
    let (negative, body) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let (int_part, frac_part) = match body.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (body, None),
    };
    let is_digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !is_digits(int_part) || frac_part.is_some_and(|f| !is_digits(f)) {
        return Err(TimeError::invalid(field, msg!("time.notDecimalSeconds", "Not decimal seconds: \"{text}\"", text)));
    }
    let frac = frac_part.unwrap_or("");
    if int_part.len() > MAX_INT_DIGITS || frac.len() > MAX_FRAC_DIGITS {
        return Err(TimeError::overflow(field));
    }
    let digits = format!("{int_part}{frac}");
    let mut num: i128 = digits.parse().map_err(|_| TimeError::overflow(field))?;
    if negative {
        num = -num;
    }
    let den = 10i128.pow(frac.len() as u32);
    let value = Ratio::new(num, den).ok_or_else(|| TimeError::overflow(field))?;
    if value.den() > MAX_SAFE_INTEGER {
        return Err(TimeError::overflow(field));
    }
    Ok(value)
}

/// 秒的精确值写回十进制字符串。只有分母是 2 与 5 的幂时才是有限小数；否则为 `None`。
pub fn format_decimal_seconds(value: Ratio) -> Option<String> {
    let mut den = value.den();
    let mut scale = 0u32;
    while den % 10 == 0 {
        den /= 10;
        scale += 1;
    }
    while den % 2 == 0 || den % 5 == 0 {
        if den % 2 == 0 {
            den /= 2;
        } else {
            den /= 5;
        }
        scale += 1;
    }
    if den != 1 || scale > MAX_FRAC_DIGITS as u32 {
        return None;
    }
    let scaled = value.num().checked_mul(10i128.pow(scale))? / value.den();
    let negative = scaled < 0;
    let digits = scaled.unsigned_abs().to_string();
    let text = if scale == 0 {
        digits
    } else {
        let padded = format!("{digits:0>width$}", width = scale as usize + 1);
        let (i, f) = padded.split_at(padded.len() - scale as usize);
        format!("{i}.{f}")
    };
    Some(if negative { format!("-{text}") } else { text })
}

/// 精确比较两个时间（按值，不按字符串）。
pub fn compare_time(a: &MediaTime, b: &MediaTime) -> Result<std::cmp::Ordering, TimeError> {
    Ok(a.to_ratio("a")?.cmp(&b.to_ratio("b")?))
}

/// 视觉时间输入：秒与帧互斥（§2.8）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "unit", rename_all = "lowercase", deny_unknown_fields)]
pub enum TimelineTimeInput {
    Seconds { value: String },
    Frames { value: i64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FrameAlignment {
    ExactFrame,
    NearestFrame,
    FloorFrame,
    CeilFrame,
}

impl TimelineTimeInput {
    /// 输入解析成的精确时间。帧输入按命令所属序列的帧率换算（不接受别的时间域）。
    /// `allow_negative` 只给相对偏移用；绝对位置不能为负（§2.4）。
    pub fn resolve(&self, fps: Rate, field: &str, allow_negative: bool) -> Result<Ratio, TimeError> {
        let value = match self {
            TimelineTimeInput::Seconds { value } => parse_decimal_seconds(value, field)?,
            TimelineTimeInput::Frames { value } => {
                let frame = *value as i128;
                if frame.abs() > MAX_SAFE_INTEGER {
                    return Err(TimeError::overflow(field));
                }
                frame_time(frame, fps).ok_or_else(|| TimeError::overflow(field))?
            }
        };
        if !allow_negative && value.is_negative() {
            return Err(TimeError::invalid(field, msg!("time.negativePosition", "An absolute position cannot be negative")));
        }
        Ok(value)
    }
}

/// 帧边界的精确时间：`frame × den / num`。
pub fn frame_time(frame: i128, fps: Rate) -> Option<Ratio> {
    Ratio::from_int(frame)?.checked_mul(fps.frame_duration())
}

/// 精确时间落在帧网格上的位置（可以不是整数）。
pub fn frames_at(time: Ratio, fps: Rate) -> Option<Ratio> {
    time.checked_mul(fps.ratio())
}

/// 按对齐政策把精确时间量化到帧边界（§2.6）。`nearest-frame` 恰在正中时取较早的边界。
pub fn quantize_frame(time: Ratio, fps: Rate, policy: FrameAlignment, field: &str) -> Result<i64, TimeError> {
    let x = frames_at(time, fps).ok_or_else(|| TimeError::overflow(field))?;
    let floor = x.floor();
    let fract = x.fract();
    let half = Ratio::new(1, 2).expect("常量");
    let nearest = if fract > half { floor + 1 } else { floor };
    let frame = match policy {
        FrameAlignment::FloorFrame => floor,
        FrameAlignment::CeilFrame => x.ceil(),
        FrameAlignment::NearestFrame => nearest,
        FrameAlignment::ExactFrame => {
            if !x.is_integer() {
                return Err(TimeError::NotOnFrameGrid {
                    requested: MediaTime::from_ratio(time, field)?,
                    floor: to_frame(floor, field)?,
                    ceil: to_frame(x.ceil(), field)?,
                    nearest: to_frame(nearest, field)?,
                });
            }
            floor
        }
    };
    to_frame(frame, field)
}

fn to_frame(frame: i128, field: &str) -> Result<i64, TimeError> {
    if frame.abs() > MAX_SAFE_INTEGER {
        return Err(TimeError::overflow(field));
    }
    Ok(frame as i64)
}

/// 量化回执（§2.9）：请求的格式化值、精确值、实际落点与偏差。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeQuantizationReceipt {
    pub domain: SequenceDomain,
    pub sequence_revision: String,
    pub edit_fps: Rate,
    pub requested: TimelineTimeInput,
    pub requested_time: MediaTime,
    pub actual_frame: i64,
    pub actual_time: MediaTime,
    pub delta: MediaTime,
    pub policy: FrameAlignment,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceDomain {
    pub kind: SequenceDomainKind,
    pub sequence_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SequenceDomainKind {
    Sequence,
}

/// 一次量化：解析输入，按政策落到帧上，并给出回执。
pub struct Quantized {
    pub frame: i64,
    pub receipt: TimeQuantizationReceipt,
}

pub struct GridContext<'a> {
    pub sequence_id: &'a str,
    pub sequence_revision: &'a str,
    pub fps: Rate,
}

/// 绝对位置：解析 → 量化一次 → 回执。
pub fn quantize_input(
    input: &TimelineTimeInput,
    grid: &GridContext<'_>,
    policy: FrameAlignment,
    field: &str,
) -> Result<Quantized, TimeError> {
    let requested = input.resolve(grid.fps, field, false)?;
    quantize_exact(requested, input.clone(), grid, policy, field)
}

/// 已经求出的精确目标（例如「当前位置 + 相对偏移」）量化一次（TM07：先求绝对目标，再量化）。
pub fn quantize_exact(
    requested: Ratio,
    input: TimelineTimeInput,
    grid: &GridContext<'_>,
    policy: FrameAlignment,
    field: &str,
) -> Result<Quantized, TimeError> {
    if requested.is_negative() {
        return Err(TimeError::invalid(field, msg!("time.negativePosition", "An absolute position cannot be negative")));
    }
    let frame = quantize_frame(requested, grid.fps, policy, field)?;
    let actual = frame_time(frame as i128, grid.fps).ok_or_else(|| TimeError::overflow(field))?;
    let delta = actual.checked_sub(requested).ok_or_else(|| TimeError::overflow(field))?;
    Ok(Quantized {
        frame,
        receipt: TimeQuantizationReceipt {
            domain: SequenceDomain {
                kind: SequenceDomainKind::Sequence,
                sequence_id: grid.sequence_id.to_string(),
            },
            sequence_revision: grid.sequence_revision.to_string(),
            edit_fps: grid.fps,
            requested: input,
            requested_time: MediaTime::from_ratio(requested, field)?,
            actual_frame: frame,
            actual_time: MediaTime::from_ratio(actual, field)?,
            delta: MediaTime::from_ratio(delta, field)?,
            policy,
        },
    })
}

/// 视觉实例的映射（§2.5）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum TimeMap {
    Linear { source_in: MediaTime, rate: Rate },
    Hold { source_at: MediaTime },
}

/// 视频时刻 `t` 对应的源时刻：`sourceIn + (t − itemStart) × rate`（§2.5）。不要求 `t` 在整数帧上。
pub fn map_time(time_map: &TimeMap, item_start: Ratio, t: Ratio) -> Result<Ratio, TimeError> {
    match time_map {
        TimeMap::Hold { source_at } => source_at.to_ratio("sourceAt"),
        TimeMap::Linear { source_in, rate } => {
            let local = t.checked_sub(item_start).ok_or_else(|| TimeError::overflow("t"))?;
            let scaled = local.checked_mul(rate.ratio()).ok_or_else(|| TimeError::overflow("t"))?;
            source_in
                .to_ratio("sourceIn")?
                .checked_add(scaled)
                .ok_or_else(|| TimeError::overflow("t"))
        }
    }
}

/// 输出帧 `n` 的编码时间戳（微秒）：`round(n × den / num × 1e6)`，tie 取偶数（§2.13）。
/// 与编辑吸附的 `nearest-frame`（取较早边界）是两套规则。
pub fn timestamp_at(n: i64, output_fps: Rate) -> Option<i64> {
    let t = frame_time(n as i128, output_fps)?.checked_mul(Ratio::from_int(1_000_000)?)?;
    let floor = t.floor();
    let fract = t.fract();
    let half = Ratio::new(1, 2)?;
    let rounded = match fract.cmp(&half) {
        std::cmp::Ordering::Less => floor,
        std::cmp::Ordering::Greater => floor + 1,
        std::cmp::Ordering::Equal => {
            if floor % 2 == 0 {
                floor
            } else {
                floor + 1
            }
        }
    };
    i64::try_from(rounded).ok()
}
