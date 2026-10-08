//! OmniVoice 的音频前后处理，逐条对照官方 `omnivoice/utils/audio.py`：
//! 参考音频去静音 / 截长、生成结果去长静音、淡入淡出补边、分段交叉淡化，
//! 以及音频分词器里 24 kHz → 16 kHz 的 torchaudio 重采样。
//!
//! 官方去静音走 pydub（`split_on_silence` / `detect_leading_silence`，毫秒粒度、
//! 先量化成 int16 再算 RMS）。这里按 pydub 源码复刻它的整数 RMS、毫秒切片（含切片越界
//! 时最多 2 ms 的补零）、静音区间合并与 `keep_silence` 对半分的规则，所以输出与官方
//! 一样经过 int16 量化。RMS 用平方前缀和求窗口和：int16 平方和在 f64 里是精确整数，
//! 与 `audioop.rms` 逐样本累加的结果逐位相同。

/// float32 → pydub 的 int16：`(x * 32768).clip(-32768, 32767).astype(int16)`（向零截断）。
fn to_pcm16(audio: &[f32]) -> Vec<i16> {
    audio.iter().map(|&x| (x * 32768.0).clamp(-32768.0, 32767.0) as i16).collect()
}

/// int16 → float32：`/ 32768`。
fn from_pcm16(samples: &[i16]) -> Vec<f32> {
    samples.iter().map(|&s| f32::from(s) / 32768.0).collect()
}

/// 单声道 16-bit 的 pydub `AudioSegment`。
#[derive(Clone)]
struct Segment {
    samples: Vec<i16>,
    rate: u32,
    /// `prefix[i]` = 前 i 个样本的平方和（精确整数）。
    prefix: Vec<u64>,
}

impl Segment {
    fn new(samples: Vec<i16>, rate: u32) -> Self {
        let mut prefix = Vec::with_capacity(samples.len() + 1);
        let mut acc = 0u64;
        prefix.push(0);
        for &s in &samples {
            acc += (i64::from(s) * i64::from(s)) as u64;
            prefix.push(acc);
        }
        Self { samples, rate, prefix }
    }

    /// `len(seg)`：`round(1000 * frames / rate)`（Python 的银行家舍入）。
    fn len_ms(&self) -> i64 {
        (1000.0 * (self.samples.len() as f64 / f64::from(self.rate))).round_ties_even() as i64
    }

    /// `frame_count(ms)` 取整：`int(ms * rate / 1000.0)`。
    fn frame_at(&self, ms: i64) -> usize {
        (ms as f64 * (f64::from(self.rate) / 1000.0)) as usize
    }

    /// `seg[start:end]` 的样本区间与补零数（切片端点先夹到 `len(seg)`；数据不够而切片
    /// 非空时尾部补零，pydub 保证不超过 2 ms）。
    fn span(&self, start_ms: i64, end_ms: i64) -> (usize, usize, usize) {
        let len = self.len_ms();
        let start = self.frame_at(start_ms.min(len));
        let end = self.frame_at(end_ms.min(len));
        let expected = end.saturating_sub(start);
        let lo = start.min(self.samples.len());
        let hi = end.min(self.samples.len()).max(lo);
        let missing = if hi > lo { expected - (hi - lo) } else { 0 };
        (lo, hi, missing)
    }

    fn slice(&self, start_ms: i64, end_ms: i64) -> Segment {
        let (lo, hi, missing) = self.span(start_ms, end_ms);
        let mut samples = self.samples[lo..hi].to_vec();
        samples.resize(samples.len() + missing, 0);
        Segment::new(samples, self.rate)
    }

    /// `seg[start:end].rms`（`audioop.rms`：平方均值开方后截成整数，空片段为 0）。
    fn rms(&self, start_ms: i64, end_ms: i64) -> u32 {
        let (lo, hi, missing) = self.span(start_ms, end_ms);
        let n = hi - lo + missing;
        if n == 0 {
            return 0;
        }
        let sum = (self.prefix[hi] - self.prefix[lo]) as f64;
        (sum / n as f64).sqrt() as u32
    }

    /// `seg[start:end].dBFS`：`20·log(rms/32768, 10)`，静音为 −∞。
    fn dbfs(&self, start_ms: i64, end_ms: i64) -> f64 {
        let rms = self.rms(start_ms, end_ms);
        if rms == 0 {
            return f64::NEG_INFINITY;
        }
        // Python `math.log(x, 10)` 是 `ln(x) / ln(10)`，不是 log10。
        20.0 * ((f64::from(rms) / 32768.0).ln() / 10f64.ln())
    }

    fn reversed(&self) -> Segment {
        let mut samples = self.samples.clone();
        samples.reverse();
        Segment::new(samples, self.rate)
    }
}

/// `pydub.silence.detect_silence`。
fn detect_silence(seg: &Segment, min_len: i64, thresh_db: f64, step: i64) -> Vec<(i64, i64)> {
    let len = seg.len_ms();
    if len < min_len {
        return Vec::new();
    }
    let thresh = 10f64.powf(thresh_db / 20.0) * 32768.0;
    let last_start = len - min_len;
    let mut starts: Vec<i64> = (0..=last_start).step_by(step as usize).collect();
    if last_start % step != 0 {
        starts.push(last_start);
    }
    let silent: Vec<i64> = starts
        .into_iter()
        .filter(|&i| f64::from(seg.rms(i, i + min_len)) <= thresh)
        .collect();
    let Some((&first, rest)) = silent.split_first() else {
        return Vec::new();
    };
    let mut ranges = Vec::new();
    let mut prev = first;
    let mut range_start = first;
    for &i in rest {
        let continuous = i == prev + step;
        let has_gap = i > prev + min_len;
        if !continuous && has_gap {
            ranges.push((range_start, prev + min_len));
            range_start = i;
        }
        prev = i;
    }
    ranges.push((range_start, prev + min_len));
    ranges
}

/// `pydub.silence.detect_nonsilent`。
fn detect_nonsilent(seg: &Segment, min_len: i64, thresh_db: f64, step: i64) -> Vec<(i64, i64)> {
    let silent = detect_silence(seg, min_len, thresh_db, step);
    let len = seg.len_ms();
    let Some(&(first_start, first_end)) = silent.first() else {
        return vec![(0, len)];
    };
    if first_start == 0 && first_end == len {
        return Vec::new();
    }
    let mut prev_end = 0;
    let mut out = Vec::new();
    for &(start, end) in &silent {
        out.push((prev_end, start));
        prev_end = end;
    }
    if silent.last().is_some_and(|&(_, end)| end != len) {
        out.push((prev_end, len));
    }
    if out.first() == Some(&(0, 0)) {
        out.remove(0);
    }
    out
}

/// `pydub.silence.split_on_silence`（`keep_silence` 为毫秒数）。
fn split_on_silence(seg: &Segment, min_len: i64, thresh_db: f64, keep: i64, step: i64) -> Vec<Segment> {
    let mut ranges: Vec<(i64, i64)> = detect_nonsilent(seg, min_len, thresh_db, step)
        .into_iter()
        .map(|(s, e)| (s - keep, e + keep))
        .collect();
    for i in 1..ranges.len() {
        let last_end = ranges[i - 1].1;
        let next_start = ranges[i].0;
        if next_start < last_end {
            let mid = (last_end + next_start).div_euclid(2);
            ranges[i - 1].1 = mid;
            ranges[i].0 = mid;
        }
    }
    let len = seg.len_ms();
    ranges.into_iter().map(|(s, e)| seg.slice(s.max(0), e.min(len))).collect()
}

/// `pydub.silence.detect_leading_silence`（`chunk_size = 10`）。
fn detect_leading_silence(seg: &Segment, thresh_db: f64) -> i64 {
    const CHUNK: i64 = 10;
    let len = seg.len_ms();
    let mut trim = 0;
    while seg.dbfs(trim, trim + CHUNK) < thresh_db && trim < len {
        trim += CHUNK;
    }
    trim.min(len)
}

/// 官方 `remove_silence_edges`：首尾各留 `lead` / `trail` 毫秒静音。
fn remove_silence_edges(seg: &Segment, lead: i64, trail: i64, thresh_db: f64) -> Segment {
    let start = (detect_leading_silence(seg, thresh_db) - lead).max(0);
    let seg = seg.slice(start, seg.len_ms()).reversed();
    let start = (detect_leading_silence(&seg, thresh_db) - trail).max(0);
    seg.slice(start, seg.len_ms()).reversed()
}

/// 官方 `remove_silence`：`mid_sil > 0` 时把长于它的中段静音压到它的长度，再修首尾。
/// 阈值恒为 −50 dBFS、步长 10 ms。输出经过 int16 量化（与官方一致）。
pub fn remove_silence(audio: &[f32], rate: u32, mid_sil: i64, lead_sil: i64, trail_sil: i64) -> Vec<f32> {
    let mut seg = Segment::new(to_pcm16(audio), rate);
    if mid_sil > 0 {
        let parts = split_on_silence(&seg, mid_sil, -50.0, mid_sil, 10);
        let joined: Vec<i16> = parts.into_iter().flat_map(|p| p.samples).collect();
        seg = Segment::new(joined, rate);
    }
    from_pcm16(&remove_silence_edges(&seg, lead_sil, trail_sil, -50.0).samples)
}

/// 官方 `trim_long_audio`（`max 15 s / min 3 s / 阈值 20 s`）：超过 20 秒的参考音频在
/// 15 秒内最靠后的一段有声起点处截断；找不到合适切点（早于 3 秒）就硬截 15 秒。
pub fn trim_long_audio(audio: &[f32], rate: u32) -> Vec<f32> {
    const MAX_MS: i64 = 15_000;
    const MIN_MS: i64 = 3_000;
    const THRESHOLD_SECONDS: f64 = 20.0;
    if audio.len() as f64 / f64::from(rate) <= THRESHOLD_SECONDS {
        return audio.to_vec();
    }
    let seg = Segment::new(to_pcm16(audio), rate);
    let nonsilent = detect_nonsilent(&seg, 100, -40.0, 10);
    if nonsilent.is_empty() {
        return audio.to_vec();
    }
    let mut best = 0;
    for &(start, end) in &nonsilent {
        if start > best && start <= MAX_MS {
            best = start;
        }
        if end > MAX_MS {
            break;
        }
    }
    if best < MIN_MS {
        best = MAX_MS.min(seg.len_ms());
    }
    from_pcm16(&seg.slice(0, best).samples)
}

/// `np.linspace(start, stop, n, dtype=float32)`：float64 里算好再转 float32，末项恰为 `stop`。
fn linspace(start: f64, stop: f64, n: usize) -> Vec<f32> {
    if n == 0 {
        return Vec::new();
    }
    if n == 1 {
        return vec![start as f32];
    }
    let step = (stop - start) / (n - 1) as f64;
    let mut out: Vec<f32> = (0..n).map(|i| (i as f64 * step + start) as f32).collect();
    out[n - 1] = stop as f32;
    out
}

/// 官方 `fade_and_pad_audio`：首尾各 `fade` 秒线性淡入淡出（不超过一半长度），
/// 再两侧各补 `pad` 秒静音。
pub fn fade_and_pad(audio: &[f32], pad_seconds: f64, fade_seconds: f64, rate: u32) -> Vec<f32> {
    if audio.is_empty() {
        return Vec::new();
    }
    let fade = (fade_seconds * f64::from(rate)) as usize;
    let pad = (pad_seconds * f64::from(rate)) as usize;
    let mut out = audio.to_vec();
    if fade > 0 {
        let k = fade.min(out.len() / 2);
        if k > 0 {
            for (s, w) in out[..k].iter_mut().zip(linspace(0.0, 1.0, k)) {
                *s *= w;
            }
            let n = out.len();
            for (s, w) in out[n - k..].iter_mut().zip(linspace(1.0, 0.0, k)) {
                *s *= w;
            }
        }
    }
    if pad > 0 {
        let mut padded = vec![0.0; pad];
        padded.extend_from_slice(&out);
        padded.resize(padded.len() + pad, 0.0);
        out = padded;
    }
    out
}

/// 官方 `cross_fade_chunks`（`silence_duration = 0.3`）：相邻两段之间，前段尾部
/// 淡出 0.1 秒、插 0.1 秒静音、后段头部淡入 0.1 秒。
pub fn cross_fade_chunks(chunks: &[Vec<f32>], rate: u32) -> Vec<f32> {
    const SILENCE_SECONDS: f64 = 0.3;
    let Some((first, rest)) = chunks.split_first() else {
        return Vec::new();
    };
    let total = (SILENCE_SECONDS * f64::from(rate)) as usize;
    let fade = total / 3;
    let silence = fade;
    let mut merged = first.clone();
    for chunk in rest {
        let fout = fade.min(merged.len());
        if fout > 0 {
            let n = merged.len();
            for (s, w) in merged[n - fout..].iter_mut().zip(linspace(1.0, 0.0, fout)) {
                *s *= w;
            }
        }
        merged.resize(merged.len() + silence, 0.0);
        let fin = fade.min(chunk.len());
        let start = merged.len();
        merged.extend_from_slice(chunk);
        for (s, w) in merged[start..start + fin].iter_mut().zip(linspace(0.0, 1.0, fin)) {
            *s *= w;
        }
    }
    merged
}

/// `np.sqrt(np.mean(x ** 2))`。
pub fn rms(audio: &[f32]) -> f32 {
    if audio.is_empty() {
        return 0.0;
    }
    let sum: f64 = audio.iter().map(|&x| f64::from(x) * f64::from(x)).sum();
    (sum / audio.len() as f64).sqrt() as f32
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 { a } else { gcd(b, a % b) }
}

/// `torchaudio.functional.resample` 的默认配置（`sinc_interp_hann`、
/// `lowpass_filter_width = 6`、`rolloff = 0.99`）：核按 torchaudio
/// `_get_sinc_resample_kernel` 的步骤以输入 dtype（f32）逐步计算，输入左补 `width`、
/// 右补 `width + orig` 个零后按步长 `orig` 卷积，输出截到 `ceil(new · len / orig)`。
pub fn resample(audio: &[f32], orig_rate: u32, new_rate: u32) -> Vec<f32> {
    const WIDTH_ZEROS: f64 = 6.0;
    const ROLLOFF: f64 = 0.99;
    if orig_rate == new_rate || audio.is_empty() {
        return audio.to_vec();
    }
    let g = gcd(orig_rate, new_rate);
    let orig = (orig_rate / g) as usize;
    let new = (new_rate / g) as usize;
    let base = orig.min(new) as f64 * ROLLOFF;
    let width = (WIDTH_ZEROS * orig as f64 / base).ceil() as usize;
    let taps = 2 * width + orig;
    let pi = std::f64::consts::PI as f32;
    let lpw = WIDTH_ZEROS as f32;
    let mut kernels = vec![vec![0f32; taps]; new];
    for (phase, kernel) in kernels.iter_mut().enumerate() {
        for (j, k) in kernel.iter_mut().enumerate() {
            let idx = (j as f32 - width as f32) / orig as f32;
            let mut t = -(phase as f32) / new as f32 + idx;
            t *= base as f32;
            t = t.clamp(-lpw, lpw);
            let window = (t * pi / lpw / 2.0).cos().powi(2);
            let t = t * pi;
            let sinc = if t == 0.0 { 1.0 } else { t.sin() / t };
            *k = sinc * (window * (base / orig as f64) as f32);
        }
    }
    let len = audio.len();
    let mut padded = vec![0f32; width];
    padded.extend_from_slice(audio);
    padded.resize(padded.len() + width + orig, 0.0);
    let frames = (padded.len() - taps) / orig + 1;
    let target = (new * len).div_ceil(orig);
    let mut out = Vec::with_capacity(frames * new);
    for frame in 0..frames {
        let window = &padded[frame * orig..frame * orig + taps];
        for kernel in &kernels {
            out.push(window.iter().zip(kernel).map(|(x, k)| x * k).sum());
        }
    }
    out.truncate(target);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 期望值由官方 `omnivoice/utils/audio.py` 的函数体（配 pydub 源码 + Python 3.12 audioop）
    /// 跑出，生成脚本 `omni_audio_golden.py` 与输入信号的整数生成器逐位一致。
    fn golden() -> serde_json::Value {
        serde_json::from_str(include_str!("testdata/audio_golden.json")).unwrap()
    }

    /// 三角波 + LCG 噪声的整数信号，与 golden 脚本的 `int_signal` 逐位一致。
    fn int_signal(rate: i64, plan: &serde_json::Value) -> Vec<f32> {
        let mut state: i64 = 12_345;
        let mut out = Vec::new();
        for part in plan.as_array().unwrap() {
            let p: Vec<i64> = part.as_array().unwrap().iter().map(|v| v.as_i64().unwrap()).collect();
            let (ms, amp, noise) = (p[0], p[1], p[2]);
            let period = 71;
            for i in 0..rate * ms / 1000 {
                state = (state * 1_103_515_245 + 12_345) % (1 << 31);
                let nz = if noise > 0 { (state >> 16) % (2 * noise + 1) - noise } else { 0 };
                let tri = if amp > 0 {
                    (4 * ((i % period) - period / 2).abs() * amp) / period - amp
                } else {
                    0
                };
                out.push((tri + nz).clamp(-32_768, 32_767) as f32 / 32_768.0);
            }
        }
        out
    }

    fn floats(v: &serde_json::Value) -> Vec<f32> {
        v.as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect()
    }

    fn assert_digest(got: &[f32], want: &serde_json::Value, what: &str) {
        let ints: Vec<i64> = got.iter().map(|&x| (x * 32_768.0).round() as i64).collect();
        assert_eq!(ints.len() as u64, want["len"].as_u64().unwrap(), "{what} 长度");
        let sum: i64 = ints.iter().sum();
        let wsum: i128 = ints.iter().enumerate().map(|(i, &v)| (i as i128 + 1) * i128::from(v)).sum();
        assert_eq!(sum, want["sum"].as_i64().unwrap(), "{what} 和");
        assert_eq!(wsum.to_string(), want["wsum"].to_string(), "{what} 加权和");
        let head: Vec<i64> = want["head"].as_array().unwrap().iter().map(|v| v.as_i64().unwrap()).collect();
        let tail: Vec<i64> = want["tail"].as_array().unwrap().iter().map(|v| v.as_i64().unwrap()).collect();
        assert_eq!(&ints[..head.len()], head.as_slice(), "{what} 开头");
        assert_eq!(&ints[ints.len() - tail.len()..], tail.as_slice(), "{what} 结尾");
    }

    fn assert_close(got: &[f32], want: &[f32], tol: f32, what: &str) {
        assert_eq!(got.len(), want.len(), "{what} 长度");
        for (i, (g, w)) in got.iter().zip(want).enumerate() {
            assert!((g - w).abs() <= tol, "{what}[{i}]: {g} != {w}");
        }
    }

    #[test]
    fn silence_removal_matches_official_pydub_path() {
        let golden = golden();
        for case in golden["remove_silence"].as_array().unwrap() {
            let rate = case["rate"].as_i64().unwrap();
            let input = int_signal(rate, &case["plan"]);
            let args: Vec<i64> = case["args"].as_array().unwrap().iter().map(|v| v.as_i64().unwrap()).collect();
            let got = remove_silence(&input, rate as u32, args[0], args[1], args[2]);
            assert_digest(&got, &case["output"], case["name"].as_str().unwrap());
        }
        for case in golden["trim_long_audio"].as_array().unwrap() {
            let rate = case["rate"].as_i64().unwrap();
            let input = int_signal(rate, &case["plan"]);
            let got = trim_long_audio(&input, rate as u32);
            let len = case["output_len"].as_u64().unwrap() as usize;
            assert_eq!(got.len(), len, "{}", case["name"]);
            assert_eq!(got.as_slice(), &input[..len]);
        }
    }

    #[test]
    fn fades_and_cross_fades_match_numpy() {
        let golden = golden();
        for case in golden["fade_and_pad"].as_array().unwrap() {
            let got = fade_and_pad(&floats(&case["input"]), 0.1, 0.1, 100);
            assert_close(&got, &floats(&case["output"]), 0.0, "fade_and_pad");
        }
        let case = &golden["cross_fade"];
        let chunks: Vec<Vec<f32>> = case["input"].as_array().unwrap().iter().map(floats).collect();
        let got = cross_fade_chunks(&chunks, 100);
        assert_close(&got, &floats(&case["output"]), 0.0, "cross_fade");
        assert!(fade_and_pad(&[], 0.1, 0.1, 24_000).is_empty());
    }

    /// 期望值来自按 torchaudio `_get_sinc_resample_kernel` / `_apply_sinc_resample_kernel`
    /// 源码步骤写的 numpy f32 复刻（离线环境没有 torchaudio 二进制可对拍）。
    #[test]
    fn resample_matches_torchaudio_formula() {
        let golden = golden();
        let case = &golden["resample"];
        let got = resample(&floats(&case["input"]), 24_000, 16_000);
        assert_close(&got, &floats(&case["output"]), 2e-6, "resample");
        assert_eq!(resample(&[0.5; 960], 24_000, 16_000).len(), 640);
        assert_eq!(resample(&[0.5; 7], 24_000, 16_000).len(), 5);
    }

    #[test]
    fn pydub_len_and_slice_semantics() {
        // 24 013 帧 → round(1000.54) = 1001 ms；切到末尾补 11 帧零。
        let seg = Segment::new(vec![1; 24_013], 24_000);
        assert_eq!(seg.len_ms(), 1001);
        assert_eq!(seg.slice(0, 1001).samples.len(), 24_024);
        // 越过末尾的空片段不补零。
        assert!(seg.slice(1001, 1001).samples.is_empty());
        assert_eq!(seg.rms(0, 10), 1);
        assert_eq!(Segment::new(vec![], 24_000).rms(0, 10), 0);
    }
}
