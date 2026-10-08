//! 闪避展开成增益包络（视频格式规范 §3.9）：唯一的一份规则，帧计划与导出都从这里取。
//!
//! 曲线取 v2（`timeline::duck::duck_curve`）：一条规则的触发区间先合并（间隔不超过 max(0.5 秒, attack + release)
//! 的并成一段），每段 `[s, e]` 展开成增益曲线上的四个点 (s − attack, 1)、(s, g)、(e, g)、(e + release, 1)，
//! g = 10^(−depth/20)，点之间在线性增益上插值；attack、release 小于 0.001 秒按 0.001 秒算。同一个实例落在几条规则的
//! 目标组里时各条的增益相乘。压低量（dB）从实例的增益（含淡入淡出）里减去，也就是在振幅上相乘。
//!
//! 触发区间：按实例触发的是组里发声实例的序列区间；按文稿触发的是当前有效词流里每个词在序列上的区间，由调用方
//! 给出（[`speech_activity`](crate::audio_plan::speech_activity)）：导出的声音计划与预览的逐帧计划用同一份词流。没有给出词流时
//! 按文稿触发的规则不展开。
//!
//! 按区间算，不看信号电平：结果只取决于时间线与文稿，逐帧确定。

use editor_semantics::Rate;
use timeline::duck::{Duck, ENVELOPE_BAKE_STEP, GainEnvelope, duck_curve};
use timeline::keyframes::volume_to_db;
use video_model::{DuckingRule, Sequence, TimelineItem, Track};

use crate::audio_plan::knots_at;
use crate::{PlanError, TrackRules, audio_bounds, span_bounds};

/// 一个实例受到的闪避：各条规则的增益曲线相乘之后烘焙成的 dB 折点。逐帧计划与导出读的是同一串折点，两边逐点一致。
#[derive(Clone, Debug, PartialEq)]
pub struct DuckingEnvelope {
    knots: Vec<(f64, f64)>,
}

impl DuckingEnvelope {
    /// 实例在序列里受到的闪避，不展开按文稿触发的规则（没有给出词流）。不在任何启用的规则的目标组里时为
    /// 空包络（处处 0 dB）。
    pub fn for_item(sequence: &Sequence, item: &TimelineItem, fps: Rate) -> Result<DuckingEnvelope, PlanError> {
        DuckingEnvelope::for_item_with_speech(sequence, item, fps, None)
    }

    /// 同 [`for_item`](Self::for_item)；`speech` 是有效词流在序列上的区间（秒），给了时按文稿触发的规则也展开。
    pub fn for_item_with_speech(
        sequence: &Sequence,
        item: &TimelineItem,
        fps: Rate,
        speech: Option<&[(f64, f64)]>,
    ) -> Result<DuckingEnvelope, PlanError> {
        let base = item.base();
        let rules = TrackRules::new(&sequence.tracks);
        let mut curves = Vec::new();
        for rule in sequence
            .ducking
            .iter()
            .filter(|r| r.enabled && r.depth.is_finite() && r.depth > 0.0)
        {
            if !rule.target.contains(&base.id, &base.track_id) {
                continue;
            }
            let activity = match rule.trigger.group() {
                Some(trigger) if trigger.contains(&base.id, &base.track_id) => continue,
                Some(_) => trigger_intervals(sequence, rule, &rules, fps, &base.id)?,
                None => match speech {
                    Some(speech) => speech.to_vec(),
                    None => continue,
                },
            };
            if activity.is_empty() {
                continue;
            }
            curves.push(GainEnvelope(duck_curve(&activity, &duck_of(rule)?)));
        }
        Ok(DuckingEnvelope { knots: bake(&curves) })
    }

    pub fn is_empty(&self) -> bool {
        self.knots.is_empty()
    }

    /// `t`（秒）这一刻压低多少 dB（≥ 0）：在折点之间按 dB 线性插值。
    pub fn reduction_db(&self, t: f64) -> f64 {
        knots_at(&self.knots, t)
    }

    /// 整条包络的折点 `(秒, 压低 dB)`，按时间排序：折点之间在 dB 上线性插值，第一个之前与最后一个之后是 0。
    pub fn knots(&self) -> Vec<(f64, f64)> {
        self.knots.clone()
    }
}

/// `t` 这一刻各条规则的增益相乘之后压低多少 dB。
fn exact_reduction_db(curves: &[GainEnvelope], t: f64) -> f64 {
    curves.iter().map(|curve| -volume_to_db(curve.at(t))).sum::<f64>().max(0.0)
}

/// 烘焙：每条曲线的折点都取，增益在斜坡上线性、换成 dB 不再线性，斜坡再按 `ENVELOPE_BAKE_STEP`（0.02 秒）
/// 等分取样；每个时刻的值取各条规则增益之积。
fn bake(curves: &[GainEnvelope]) -> Vec<(f64, f64)> {
    let mut times: Vec<f64> = Vec::new();
    for curve in curves {
        let points = curve.points();
        for pair in points.windows(2) {
            let ([t0, g0], [t1, g1]) = (pair[0], pair[1]);
            times.push(t0);
            if g0 != g1 && t1 > t0 {
                let steps = ((t1 - t0) / ENVELOPE_BAKE_STEP).ceil().max(1.0) as usize;
                times.extend((1..steps).map(|k| t0 + (t1 - t0) * k as f64 / steps as f64));
            }
        }
        times.extend(points.last().map(|p| p[0]));
    }
    times.sort_by(f64::total_cmp);
    times.dedup();
    times.into_iter().map(|t| (t, exact_reduction_db(curves, t))).collect()
}

/// 规则的参数换成 v2 的 `Duck`（曲线只有一份，在 `timeline::duck`）。
fn duck_of(rule: &DuckingRule) -> Result<Duck, PlanError> {
    let seconds = |m: &editor_semantics::MediaTime, field: &str| -> Result<f64, PlanError> {
        let v = m.to_ratio(field)?.to_f64();
        Ok(if v.is_finite() { v.max(0.0) } else { 0.0 })
    };
    Ok(Duck {
        under: String::new(),
        depth: Some(rule.depth),
        attack: Some(seconds(&rule.attack, "attack")?),
        release: Some(seconds(&rule.release, "release")?),
    })
}

/// 按实例触发的区间（秒，未合并）：组里启用、所在轨道发声、本身发声的实例，不含目标自己。
fn trigger_intervals(
    sequence: &Sequence,
    rule: &DuckingRule,
    rules: &TrackRules,
    fps: Rate,
    target_id: &str,
) -> Result<Vec<(f64, f64)>, PlanError> {
    let tracks: std::collections::HashMap<&str, &Track> = sequence.tracks.iter().map(|t| (t.id.as_str(), t)).collect();
    let mut intervals = Vec::new();
    let Some(trigger) = rule.trigger.group() else {
        return Ok(intervals);
    };
    for item in &sequence.items {
        let base = item.base();
        if base.id == target_id || !base.enabled || !trigger.contains(&base.id, &base.track_id) {
            continue;
        }
        let Some(track) = tracks.get(base.track_id.as_str()) else {
            continue;
        };
        if !rules.audible(track) {
            continue;
        }
        let bounds = match item {
            TimelineItem::Audio(a) if !a.mix.muted => audio_bounds(a, fps)?,
            TimelineItem::Video(v) if v.embedded_audio.enabled => span_bounds(v.span, fps)?,
            TimelineItem::Composition(c) if c.prerender.is_some() && c.audio.as_ref().is_some_and(|a| a.enabled) => {
                span_bounds(c.span, fps)?
            }
            _ => continue,
        };
        intervals.push((bounds.0.to_f64(), bounds.1.to_f64()));
    }
    Ok(intervals)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一条规则：压低 `depth` dB，触发区间 `activity`。
    fn curve(depth: f64, attack: f64, release: f64, activity: &[(f64, f64)]) -> GainEnvelope {
        let duck = Duck {
            under: String::new(),
            depth: Some(depth),
            attack: Some(attack),
            release: Some(release),
        };
        GainEnvelope(duck_curve(activity, &duck))
    }

    fn envelope(rules: Vec<GainEnvelope>) -> DuckingEnvelope {
        DuckingEnvelope { knots: bake(&rules) }
    }

    fn near(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{a} ≠ {b}");
    }

    #[test]
    fn ramps_are_linear_in_gain() {
        let env = envelope(vec![curve(12.0, 0.4, 1.0, &[(2.0, 4.0)])]);
        let floor = 10f64.powf(-12.0 / 20.0);
        assert_eq!(env.reduction_db(1.0), 0.0);
        near(env.reduction_db(2.0), 12.0);
        near(env.reduction_db(3.5), 12.0);
        // 斜坡的中点落在取样点上：增益是 1 与 g 的平均，不是 dB 的平均。
        near(env.reduction_db(1.8), -volume_to_db((1.0 + floor) / 2.0));
        near(env.reduction_db(4.5), -volume_to_db((1.0 + floor) / 2.0));
        assert!(env.reduction_db(1.8) < 6.0);
        assert_eq!(env.reduction_db(5.0), 0.0);
    }

    #[test]
    fn triggers_closer_than_half_a_second_merge() {
        // 间隔 0.4 秒（< max(0.5, attack + release)）：并成一段，中间不回升。
        let env = envelope(vec![curve(10.0, 0.02, 0.35, &[(1.0, 2.0), (2.4, 3.0)])]);
        near(env.reduction_db(2.2), 10.0);
        // 间隔 0.6 秒：两段，中间回到 0 dB。
        let env = envelope(vec![curve(10.0, 0.02, 0.35, &[(1.0, 2.0), (2.6, 3.0)])]);
        assert_eq!(env.reduction_db(2.45), 0.0);
    }

    #[test]
    fn zero_ramps_take_the_minimum_ramp() {
        let env = envelope(vec![curve(12.0, 0.0, 0.0, &[(1.0, 2.0)])]);
        assert_eq!(env.reduction_db(0.998), 0.0);
        near(env.reduction_db(1.0), 12.0);
        assert_eq!(env.reduction_db(2.002), 0.0);
        assert!(env.reduction_db(2.0005) > 0.0 && env.reduction_db(2.0005) < 12.0);
    }

    #[test]
    fn rules_multiply_their_gains() {
        let env = envelope(vec![
            curve(12.0, 0.001, 0.001, &[(0.0, 2.0)]),
            curve(3.0, 0.001, 0.001, &[(1.0, 3.0)]),
        ]);
        near(env.reduction_db(0.5), 12.0);
        near(env.reduction_db(1.5), 15.0);
        near(env.reduction_db(2.5), 3.0);
    }

    #[test]
    fn knots_follow_the_gain_curve_within_the_bake_step() {
        let curves = vec![curve(24.0, 0.3, 0.7, &[(1.0, 2.0)])];
        let env = envelope(curves.clone());
        let knots = env.knots();
        assert_eq!(knots.first().map(|k| k.1), Some(0.0));
        assert_eq!(knots.last().map(|k| k.1), Some(0.0));
        // 斜坡取样不超过 0.02 秒一个；折点之间按 dB 线性插值，与真实曲线的差不超过 0.5 dB。
        for pair in knots.windows(2) {
            let ((t0, d0), (t1, d1)) = (pair[0], pair[1]);
            if d0 != d1 {
                assert!(t1 - t0 <= ENVELOPE_BAKE_STEP + 1e-9);
            }
            let mid = (t0 + t1) / 2.0;
            assert!((exact_reduction_db(&curves, mid) - env.reduction_db(mid)).abs() < 0.5, "{mid}");
        }
    }
}
