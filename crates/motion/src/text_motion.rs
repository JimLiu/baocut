//! Cue/visual-line/word/grapheme motion. Layout supplies unit identities; this
//! module owns clocks and poses, shared by native, WASM and export hosts.
use crate::program::Fill;
use crate::{
    CompositeMode, CurveSpec, EaseId, InterpolatorSpec, MotionProgram, MotionSegment, MotionValue,
    PoseBuffer, PostOp, PropertyId, PropertyTrack, SegmentKind, TargetId, TimeBase,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Unit {
    #[default]
    Cue,
    Line,
    Word,
    Grapheme,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Order {
    #[default]
    Forward,
    Backward,
    Center,
    Random,
}
fn one() -> f64 {
    1.0
}
fn duration() -> f64 {
    0.3
}
fn ease() -> String {
    "easeOutQuad".into()
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Effect {
    pub preset: String,
    #[serde(default)]
    pub unit: Unit,
    #[serde(default = "duration")]
    pub duration_seconds: f64,
    #[serde(default)]
    pub stagger_seconds: f64,
    #[serde(default = "one")]
    pub intensity: f64,
    #[serde(default = "ease")]
    pub easing: String,
    #[serde(default)]
    pub order: Order,
    #[serde(default)]
    pub seed: u32,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Emphasis {
    pub color: String,
    pub scale: f64,
    pub duration_seconds: f64,
}
/// KTV-style lyric sweep. Words already sung keep `color`; the word being sung
/// fills grapheme by grapheme across its real transcript window. Only lines
/// with real word timings sweep; translations stay in the base fill.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Karaoke {
    /// Fill of the sung part. Outline and shadow keep the style's own values.
    pub color: String,
    /// A small bouncing dot rides the sweep boundary above the line.
    #[serde(default)]
    pub guide: bool,
    /// Two-line lyric layout: the next cue waits under the one being sung.
    #[serde(default)]
    pub next_line: bool,
    /// How the sung fill advances: grapheme by grapheme across each word's
    /// window (default), or a whole word at once the instant it starts.
    #[serde(default, skip_serializing_if = "KaraokeUnit::is_grapheme")]
    pub unit: KaraokeUnit,
}
/// Granularity of the karaoke sweep (`textMotion.karaoke.unit`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KaraokeUnit {
    /// Continuous fill inside the word being sung.
    #[default]
    Grapheme,
    /// Each word turns fully sung at its start; gaps and the last word hold.
    Word,
}
impl KaraokeUnit {
    pub fn is_grapheme(&self) -> bool {
        *self == Self::Grapheme
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextMotion {
    pub version: u32,
    #[serde(default, rename = "in", skip_serializing_if = "Option::is_none")]
    pub entrance: Option<Effect>,
    #[serde(default, rename = "out", skip_serializing_if = "Option::is_none")]
    pub exit: Option<Effect>,
    #[serde(default, rename = "loop", skip_serializing_if = "Option::is_none")]
    pub cycle: Option<Effect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emphasis: Option<Emphasis>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub karaoke: Option<Karaoke>,
}
fn hex_color(color: &str) -> bool {
    color.starts_with('#')
        && [7, 9].contains(&color.len())
        && color[1..].bytes().all(|v| v.is_ascii_hexdigit())
}
pub const ENTRANCES: &[&str] = &[
    "typewriter",
    "fade-up",
    "rise",
    "cascade",
    "pop",
    "blur-in",
    "slide-mask",
    "wave-in",
];
pub const EXITS: &[&str] = &[
    "fade-down",
    "sink",
    "pop-out",
    "blur-out",
    "typewriter-erase",
];
pub const CYCLES: &[&str] = &["pulse", "wave", "shimmer", "swing"];
impl TextMotion {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("unsupported textMotion version".into());
        }
        for (effect, allowed) in [
            (&self.entrance, ENTRANCES),
            (&self.exit, EXITS),
            (&self.cycle, CYCLES),
        ] {
            if let Some(e) = effect {
                if !allowed.contains(&e.preset.as_str()) {
                    return Err(format!("invalid textMotion preset: {}", e.preset));
                }
                if !e.duration_seconds.is_finite()
                    || !(0.001..=60.0).contains(&e.duration_seconds)
                    || !e.stagger_seconds.is_finite()
                    || !(0.0..=10.0).contains(&e.stagger_seconds)
                    || !e.intensity.is_finite()
                    || !(0.0..=2.0).contains(&e.intensity)
                {
                    return Err("invalid textMotion timing or intensity".into());
                }
                if EaseId::parse(&e.easing).is_none() {
                    return Err("invalid textMotion easing".into());
                }
            }
        }
        if let Some(e) = &self.emphasis {
            if !e.scale.is_finite()
                || !(0.1..=3.0).contains(&e.scale)
                || !e.duration_seconds.is_finite()
                || !(0.001..=10.0).contains(&e.duration_seconds)
                || !hex_color(&e.color)
            {
                return Err("invalid textMotion emphasis".into());
            }
        }
        if let Some(k) = &self.karaoke
            && !hex_color(&k.color)
        {
            return Err("invalid textMotion karaoke".into());
        }
        Ok(())
    }
    pub fn compile(&self) -> Result<CompiledTextMotion, String> {
        self.validate()?;
        Ok(CompiledTextMotion {
            spec: self.clone(),
            entrance: self.entrance.as_ref().map(CompiledEffect::new),
            exit: self.exit.as_ref().map(CompiledEffect::new),
            cycle: self.cycle.as_ref().map(CompiledEffect::new),
        })
    }
}
#[derive(Debug, Clone)]
struct CompiledEffect {
    effect: Effect,
    progress: MotionProgram,
}
impl CompiledEffect {
    fn new(effect: &Effect) -> Self {
        let mut program = MotionProgram::new(TimeBase::ElementLocal);
        program.property_tracks.push(PropertyTrack {
            target: TargetId::SELF,
            property: PropertyId::parse("opacity"),
            composite: CompositeMode::Replace,
            order: 0,
            base: MotionValue::Scalar(0.0),
            post: PostOp::None,
            optional: false,
            segments: vec![MotionSegment {
                t0: 0.0,
                t1: 1.0,
                fill_before: Fill::Hold,
                fill_after: Fill::Hold,
                composite: CompositeMode::Replace,
                order: 0,
                kind: SegmentKind::Tween {
                    from: MotionValue::Scalar(0.0),
                    to: MotionValue::Scalar(1.0),
                    curve: CurveSpec::Named(
                        EaseId::parse(&effect.easing).unwrap_or(EaseId::Linear),
                    ),
                    interpolator: InterpolatorSpec::Linear,
                },
            }],
        });
        Self {
            effect: effect.clone(),
            progress: program,
        }
    }
    fn eased(&self, phase: f64) -> f64 {
        let mut pose = PoseBuffer::identity();
        crate::sample::sample(
            &self.progress,
            TargetId::SELF,
            phase.clamp(0.0, 1.0),
            &mut pose,
        );
        pose.scalar_or("opacity", 1.0)
    }
}
#[derive(Debug, Clone)]
pub struct CompiledTextMotion {
    pub spec: TextMotion,
    entrance: Option<CompiledEffect>,
    exit: Option<CompiledEffect>,
    cycle: Option<CompiledEffect>,
}
#[derive(Debug, Clone, Copy)]
pub struct UnitContext {
    pub cue_time: f64,
    pub cue_duration: f64,
    pub fps: f64,
    pub line: usize,
    pub lines: usize,
    pub word: Option<usize>,
    pub words: usize,
    pub grapheme: usize,
    pub graphemes: usize,
    pub font_size: f64,
    pub box_width: f64,
}
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextPose {
    pub unit: Unit,
    pub dx: f64,
    pub dy: f64,
    pub scale: f64,
    pub rotation: f64,
    pub opacity: f64,
    pub blur: f64,
    pub highlight: f64,
    pub active: bool,
    pub clip: bool,
}
impl Default for TextPose {
    fn default() -> Self {
        Self {
            unit: Unit::Cue,
            dx: 0.0,
            dy: 0.0,
            scale: 1.0,
            rotation: 0.0,
            opacity: 1.0,
            blur: 0.0,
            highlight: 0.0,
            active: false,
            clip: false,
        }
    }
}
fn unit(e: &Effect, c: &UnitContext) -> (usize, usize) {
    match e.unit {
        Unit::Cue => (0, 1),
        Unit::Line => (c.line, c.lines),
        Unit::Word => (c.word.unwrap_or(0), c.words),
        Unit::Grapheme => (c.grapheme, c.graphemes),
    }
}
fn order(e: &Effect, index: usize, count: usize) -> usize {
    let count = count.max(1);
    let index = index.min(count - 1);
    match e.order {
        Order::Forward => index,
        Order::Backward => count - 1 - index,
        Order::Center => ((index as f64 - (count - 1) as f64 / 2.0).abs()) as usize,
        Order::Random => {
            // A seeded permutation without per-frame sorting or allocations.
            let mut stride = (e.seed as usize % count).max(1);
            fn gcd(mut a: usize, mut b: usize) -> usize {
                while b != 0 {
                    (a, b) = (b, a % b);
                }
                a
            }
            while gcd(stride, count) != 1 {
                stride += 1;
            }
            (index * stride + e.seed as usize) % count
        }
    }
}
fn seconds(value: f64, fps: f64, min_frames: f64) -> f64 {
    (value * fps).round().max(min_frames) / fps
}
fn window(e: &Effect, c: &UnitContext) -> (f64, f64, f64) {
    let (_, n) = unit(e, c);
    let fps = c.fps.max(1.0);
    let d = seconds(e.duration_seconds, fps, 1.0);
    let s = seconds(e.stagger_seconds, fps, 0.0);
    let last = if e.order == Order::Center {
        n.saturating_sub(1) / 2
    } else {
        n.saturating_sub(1)
    };
    let total = d + s * last as f64;
    let factor = (c.cue_duration.max(0.0) * 0.5 / total.max(1e-9)).min(1.0);
    (d * factor, s * factor, total * factor)
}
impl CompiledTextMotion {
    /// Conservative scheduling before layout: the number of graphemes bounds
    /// visual lines and words too. Cue effects still use their exact window.
    pub fn boundary_windows(&self, duration: f64, fps: f64, units: usize) -> (f64, f64) {
        let c = UnitContext {
            cue_time: 0.0,
            cue_duration: duration,
            fps,
            line: 0,
            lines: units,
            word: None,
            words: units,
            grapheme: 0,
            graphemes: units,
            font_size: 1.0,
            box_width: 1.0,
        };
        (
            self.entrance
                .as_ref()
                .map_or(0.0, |e| window(&e.effect, &c).2),
            duration - self.exit.as_ref().map_or(0.0, |e| window(&e.effect, &c).2),
        )
    }

    pub fn changing_at(
        &self,
        time: f64,
        duration: f64,
        fps: f64,
        units: usize,
        starts: &[f64],
    ) -> bool {
        if time < 0.0 || time >= duration {
            return false;
        }
        let (enter_end, exit_start) = self.boundary_windows(duration, fps, units);
        self.cycle.is_some()
            || (self.spec.karaoke.is_some() && starts.iter().any(|s| s.is_finite()))
            || time < enter_end
            || time >= exit_start
            || self.active_word(time, starts).is_some_and(|i| {
                self.spec.emphasis.as_ref().is_some_and(|e| {
                    time - starts[i] < seconds(e.duration_seconds, fps.max(1.0), 1.0)
                })
            })
    }
    pub fn active_word(&self, time: f64, starts: &[f64]) -> Option<usize> {
        if self.spec.emphasis.is_none() && self.spec.karaoke.is_none() {
            return None;
        }
        starts
            .iter()
            .rposition(|start| start.is_finite() && *start <= time)
    }
    /// How far the karaoke sweep has come at `time`, in words: `3.4` means
    /// three words sung and 40% of the fourth. `None` without a sweep or before
    /// the first timed word. Ends shorter than their start fill at once.
    /// With `unit: word` the sweep snaps to whole words: the word whose start
    /// has passed is already fully sung (`index + 1`).
    pub fn karaoke_sung(&self, time: f64, starts: &[f64], ends: &[f64]) -> Option<f64> {
        let karaoke = self.spec.karaoke.as_ref()?;
        let index = self.active_word(time, starts)?;
        if karaoke.unit == KaraokeUnit::Word {
            return Some(index as f64 + 1.0);
        }
        let (start, end) = (
            starts[index],
            ends.get(index).copied().unwrap_or(starts[index]),
        );
        let fraction = if end > start {
            ((time - start) / (end - start)).clamp(0.0, 1.0)
        } else {
            1.0
        };
        Some(index as f64 + fraction)
    }
    /// Height of the karaoke guide dot's hop (0–1) while the sweep crosses one
    /// grapheme. `libm` keeps exported pixels identical across platforms.
    pub fn karaoke_guide_hop(sweep: f64) -> f64 {
        libm::sin(std::f64::consts::PI * sweep.clamp(0.0, 1.0))
    }
    /// Starts are display-clock offsets from real projected transcript timings.
    /// An empty list deliberately disables speech emphasis on untimed translations.
    pub fn sample(&self, c: UnitContext, starts: &[f64]) -> TextPose {
        let mut result = TextPose::default();
        if !c.cue_time.is_finite() || c.cue_time < 0.0 || c.cue_time >= c.cue_duration {
            result.opacity = 0.0;
            return result;
        }
        let mut selected = None;
        if let Some(e) = &self.exit {
            let w = window(&e.effect, &c);
            if c.cue_time >= c.cue_duration - w.2 {
                selected = Some((e, c.cue_time - (c.cue_duration - w.2), w, false));
            }
        }
        let in_end = self
            .entrance
            .as_ref()
            .map_or(0.0, |e| window(&e.effect, &c).2);
        if selected.is_none() {
            if let Some(e) = &self.entrance {
                let w = window(&e.effect, &c);
                if c.cue_time < w.2 {
                    selected = Some((e, c.cue_time, w, false));
                }
            }
        }
        if selected.is_none() {
            if let Some(e) = &self.cycle {
                selected = Some((
                    e,
                    c.cue_time - in_end,
                    (
                        seconds(e.effect.duration_seconds, c.fps.max(1.0), 1.0),
                        seconds(e.effect.stagger_seconds, c.fps.max(1.0), 0.0),
                        0.0,
                    ),
                    true,
                ));
            }
        }
        if let Some((compiled, t, (d, s, _), cycle)) = selected {
            let e = &compiled.effect;
            let (index, n) = unit(e, &c);
            let local = t - order(e, index, n) as f64 * s;
            result.unit = e.unit;
            let p = if cycle {
                if local <= 0.0 {
                    0.0
                } else {
                    (local / d.max(1e-9)).rem_euclid(1.0)
                }
            } else {
                compiled.eased(local / d.max(1e-9))
            };
            let f = c.font_size;
            let a = e.intensity;
            let wave = libm::sin(std::f64::consts::TAU * p);
            match e.preset.as_str() {
                "typewriter" => result.opacity = if p >= 1.0 { 1.0 } else { 0.0 },
                "typewriter-erase" => result.opacity = if p >= 1.0 { 0.0 } else { 1.0 },
                "fade-up" | "rise" | "cascade" => {
                    result.opacity =
                        (p * if e.preset == "rise" { 1.5 } else { 1.0 }).clamp(0.0, 1.0);
                    result.dy = (1.0 - p)
                        * f
                        * a
                        * match e.preset.as_str() {
                            "rise" => 0.6,
                            "cascade" => -0.8,
                            _ => 0.25,
                        };
                }
                "pop" => {
                    result.opacity = (p * 2.0).clamp(0.0, 1.0);
                    result.scale = (1.0 + (p - 1.0) * a).max(0.0);
                }
                "blur-in" => {
                    result.opacity = p.clamp(0.0, 1.0);
                    result.blur = ((1.0 - p) * 0.4 * f * a).max(0.0);
                }
                "slide-mask" => {
                    result.dx = -(1.0 - p) * c.box_width * a;
                    result.clip = true;
                }
                "wave-in" => {
                    result.opacity = p.clamp(0.0, 1.0);
                    result.dy = (1.0 - p) * libm::sin(index as f64 * 0.9) * 0.5 * f * a;
                }
                "fade-down" | "sink" => {
                    result.opacity = (1.0 - p).clamp(0.0, 1.0);
                    result.dy = p * f * a * if e.preset == "sink" { 0.6 } else { 0.25 };
                }
                "pop-out" => {
                    result.opacity = (1.0 - p).clamp(0.0, 1.0);
                    result.scale = (1.0 - p * a).max(0.0);
                }
                "blur-out" => {
                    result.opacity = (1.0 - p).clamp(0.0, 1.0);
                    result.blur = (p * 0.4 * f * a).max(0.0);
                }
                "pulse" => result.scale = 1.0 + 0.06 * a * wave,
                "wave" => result.dy = 0.18 * f * a * wave,
                "swing" => result.rotation = 0.09 * a * wave * 180.0 / std::f64::consts::PI,
                "shimmer" => {
                    result.highlight =
                        (libm::sin(std::f64::consts::PI * p).max(0.0).powi(8) * a).clamp(0.0, 1.0)
                }
                _ => {}
            }
        }
        if let Some(e) = &self.spec.emphasis
            && let Some(index) = self.active_word(c.cue_time, starts)
        {
            if c.word == Some(index) {
                let p = ((c.cue_time - starts[index])
                    / seconds(e.duration_seconds, c.fps.max(1.0), 1.0))
                .clamp(0.0, 1.0);
                result.scale *=
                    e.scale + (1.0 - e.scale) * crate::curve::apply_ease_id(EaseId::EaseOutQuad, p);
                result.active = true;
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context(t: f64) -> UnitContext {
        UnitContext {
            cue_time: t,
            cue_duration: 4.0,
            fps: 30.0,
            line: 0,
            lines: 2,
            word: Some(0),
            words: 3,
            grapheme: 0,
            graphemes: 9,
            font_size: 40.0,
            box_width: 500.0,
        }
    }
    #[test]
    fn emphasis_holds_gaps_and_stops_at_end() {
        let m:TextMotion=serde_json::from_value(serde_json::json!({"version":1,"emphasis":{"color":"#FC75E9","scale":1.18,"durationSeconds":0.2}})).unwrap();
        let p = m.compile().unwrap();
        assert!(p.sample(context(0.5), &[0.0, 2.0]).active);
        assert!(!p.sample(context(2.1), &[0.0, 2.0]).active);
        assert!(!p.sample(context(0.5), &[]).active);
        assert_eq!(p.sample(context(4.0), &[0.0]).opacity, 0.0);
    }
    #[test]
    fn short_cue_finishes_typewriter_and_random_access_is_stable() {
        let m:TextMotion=serde_json::from_value(serde_json::json!({"version":1,"in":{"preset":"typewriter","unit":"grapheme","durationSeconds":0.033333,"staggerSeconds":0.04,"easing":"linear"}})).unwrap();
        let p = m.compile().unwrap();
        let mut c = context(0.15);
        c.cue_duration = 0.2;
        c.grapheme = 8;
        assert_eq!(p.sample(c, &[]).opacity, 1.0);
        let before = p.sample(context(0.01), &[]);
        p.sample(context(3.0), &[]);
        assert_eq!(before, p.sample(context(0.01), &[]));
    }
    #[test]
    fn karaoke_sweeps_through_real_word_windows() {
        let m: TextMotion = serde_json::from_value(serde_json::json!(
            {"version":1,"karaoke":{"color":"#FF7A1A","guide":true,"nextLine":true}}
        ))
        .unwrap();
        let p = m.compile().unwrap();
        let (starts, ends) = ([0.5, 1.0, f64::INFINITY], [0.9, 1.0, f64::INFINITY]);
        assert_eq!(p.karaoke_sung(0.2, &starts, &ends), None);
        assert!((p.karaoke_sung(0.7, &starts, &ends).unwrap() - 0.5).abs() < 1e-9);
        // Between words the sung part holds; a zero-length word fills at once.
        assert_eq!(p.karaoke_sung(0.95, &starts, &ends), Some(1.0));
        assert_eq!(p.karaoke_sung(1.0, &starts, &ends), Some(2.0));
        // Untimed (translation) lines never sweep and never force redraws.
        assert_eq!(p.karaoke_sung(0.7, &[], &[]), None);
        assert!(!p.changing_at(0.7, 4.0, 30.0, 9, &[]));
        assert!(p.changing_at(0.7, 4.0, 30.0, 9, &starts));
        // A sweep alone never scales the active word like speech emphasis does.
        let mut c = context(0.7);
        c.word = Some(0);
        assert_eq!(p.sample(c, &starts).scale, 1.0);
        let bad: TextMotion =
            serde_json::from_value(serde_json::json!({"version":1,"karaoke":{"color":"orange"}}))
                .unwrap();
        assert!(bad.compile().is_err());
    }
    #[test]
    fn karaoke_unit_word_snaps_to_whole_words() {
        let default: TextMotion = serde_json::from_value(serde_json::json!(
            {"version":1,"karaoke":{"color":"#FF7A1A"}}
        ))
        .unwrap();
        // Old documents keep their shape on round-trip.
        assert!(
            serde_json::to_value(&default).unwrap()["karaoke"]
                .get("unit")
                .is_none()
        );
        assert_eq!(default.karaoke.unwrap().unit, KaraokeUnit::Grapheme);
        assert!(
            serde_json::from_value::<TextMotion>(serde_json::json!(
                {"version":1,"karaoke":{"color":"#FF7A1A","unit":"letter"}}
            ))
            .is_err()
        );
        let m: TextMotion = serde_json::from_value(serde_json::json!(
            {"version":1,"karaoke":{"color":"#FF7A1A","unit":"word"}}
        ))
        .unwrap();
        let p = m.compile().unwrap();
        // Word windows [0.5, 0.9), gap, [1.2, 1.6), [1.6, 2.4).
        let (starts, ends) = ([0.5, 1.2, 1.6], [0.9, 1.6, 2.4]);
        assert_eq!(p.karaoke_sung(0.2, &starts, &ends), None);
        // A word is fully sung the instant it starts, not partway through.
        assert_eq!(p.karaoke_sung(0.5, &starts, &ends), Some(1.0));
        assert_eq!(p.karaoke_sung(0.7, &starts, &ends), Some(1.0));
        assert_eq!(p.karaoke_sung(0.89, &starts, &ends), Some(1.0));
        // The gap holds the previous word.
        assert_eq!(p.karaoke_sung(1.0, &starts, &ends), Some(1.0));
        assert_eq!(p.karaoke_sung(1.2, &starts, &ends), Some(2.0));
        assert_eq!(p.karaoke_sung(1.59, &starts, &ends), Some(2.0));
        assert_eq!(p.karaoke_sung(1.6, &starts, &ends), Some(3.0));
        // The last word holds to the end of the cue.
        assert_eq!(p.karaoke_sung(2.0, &starts, &ends), Some(3.0));
        assert_eq!(p.karaoke_sung(9.0, &starts, &ends), Some(3.0));
        for t in [0.5, 0.63, 0.77, 1.05, 1.33, 1.9, 2.3] {
            let sung = p.karaoke_sung(t, &starts, &ends).unwrap();
            assert_eq!(sung.fract(), 0.0, "partial word at {t}");
        }
        let round_trip: TextMotion =
            serde_json::from_value(serde_json::to_value(&m).unwrap()).unwrap();
        assert_eq!(round_trip, m);
    }
    #[test]
    fn validation_rejects_wrong_slot_and_versions() {
        for v in [
            serde_json::json!({"version":2}),
            serde_json::json!({"version":1,"in":{"preset":"wave"}}),
            serde_json::json!({"version":1,"loop":{"preset":"wave","durationSeconds":0}}),
        ] {
            assert!(
                serde_json::from_value::<TextMotion>(v)
                    .unwrap()
                    .compile()
                    .is_err()
            );
        }
    }
}
