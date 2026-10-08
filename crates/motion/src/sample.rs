//! 纯函数采样：`(program, t)` → `PoseBuffer`（设计 §5.3）。

use crate::composite::PoseBuffer;
use crate::curve::sample_curve;
use crate::interpolate::mix;
use crate::program::{Fill, MotionProgram, MotionSegment, PropertyTrack, SegmentKind, TargetId};
use crate::value::MotionValue;

const EPSILON: f64 = 1e-9;

/// 逐式来自 `bcut-timeline/src/motion.rs:702-708`。调用方负责用同一张 fps 网格
/// 量化，`MotionProgram::sample` 只接收已量化的 t（ADR-M10）。
pub fn quantize_time(time: f64, fps: f64) -> f64 {
    if time.is_finite() && fps.is_finite() && fps > 0.0 {
        (time * fps + EPSILON).floor() / fps
    } else {
        time
    }
}

/// 段内进度。`t1 == t0` 时取 `1.0` —— 零长段采样的是**已落定**端点，
/// 不是 `0/0 = NaN`（`motion.rs:544-549`、`:556-560`）。
fn segment_progress(segment: &MotionSegment, t: f64) -> f64 {
    if segment.t1 > segment.t0 {
        ((t - segment.t0) / (segment.t1 - segment.t0)).clamp(0.0, 1.0)
    } else {
        1.0
    }
}

fn eval_segment(program: &MotionProgram, segment: &MotionSegment, t: f64) -> Option<MotionValue> {
    match &segment.kind {
        SegmentKind::Hold { value } => Some(value.clone()),
        SegmentKind::Tween {
            from,
            to,
            curve,
            interpolator,
        } => {
            let eased = sample_curve(curve, segment_progress(segment, t));
            Some(mix(from, to, eased, *interpolator))
        }
        SegmentKind::Loop(reference) => {
            let kernel = program.loop_kernels.get(reference.0)?;
            let idle_local = t - segment.t0;
            let idle_duration = segment.t1 - segment.t0;
            Some(MotionValue::Scalar(
                kernel.sample(idle_local, idle_duration),
            ))
        }
    }
}

/// `None` = 该刻这条轨没有输出，pose 字段保持 base / 缺席。
///
/// 边界规则（计划 §2.5）：取**最后一个** `t0 <= t` 的段；段内是 `[t0, t1)`，
/// 右端点归下一段。因此 `enter.finish == exit.begin == half` 时退场赢，
/// 与 `motion.rs:543-566` 的 `local < finish` / `local >= begin` 一致。
pub fn sample_track(program: &MotionProgram, track: &PropertyTrack, t: f64) -> Option<MotionValue> {
    let index = track.segments.partition_point(|segment| segment.t0 <= t);
    if index == 0 {
        let segment = track.segments.first()?;
        if segment.fill_before == Fill::Hold {
            return eval_segment(program, segment, t);
        }
        return None;
    }
    let segment = &track.segments[index - 1];
    if t < segment.t1 {
        return eval_segment(program, segment, t);
    }
    if segment.fill_after == Fill::Hold {
        return eval_segment(program, segment, segment.t1);
    }
    None
}

/// 把 `target` 在 `t` 的全部轨写入 `out`。不分配堆内存。
pub fn sample(program: &MotionProgram, target: TargetId, t: f64, out: &mut PoseBuffer) {
    for track in &program.property_tracks {
        if track.target != target {
            continue;
        }
        track.assert_segments_agree();
        // `base` 先落进槽位：add / multiply 轨需要一个单位元起点（规范 §7.7 第 1 步）。
        if !track.optional {
            out.write_base(&track.property, track.base.clone());
        }
        let Some(value) = sample_track(program, track, t) else {
            continue;
        };
        // `post` 交给 `PoseBuffer` 在**合成之后**施加（规范 §7.7 第 5 步）；
        // 单 replace 轨下两者等价，这是阶段 0/1 golden 逐位不变的论据。
        out.write(
            &track.property,
            value,
            track.composite,
            track.order,
            track.post,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composite::{CompositeMode, PostOp};
    use crate::curve::{CurveSpec, EaseId};
    use crate::interpolate::InterpolatorSpec;
    use crate::program::{MotionSegment, PropertyTrack, TimeBase};
    use crate::value::PropertyId;

    fn tween(t0: f64, t1: f64, from: f64, to: f64, before: Fill, after: Fill) -> MotionSegment {
        MotionSegment {
            t0,
            t1,
            fill_before: before,
            fill_after: after,
            composite: CompositeMode::Replace,
            order: 0,
            kind: SegmentKind::Tween {
                from: MotionValue::Scalar(from),
                to: MotionValue::Scalar(to),
                curve: CurveSpec::Named(EaseId::Linear),
                interpolator: InterpolatorSpec::Linear,
            },
        }
    }

    fn program_with(segments: Vec<MotionSegment>) -> MotionProgram {
        let mut program = MotionProgram::new(TimeBase::ElementLocal);
        program.property_tracks.push(PropertyTrack {
            target: TargetId::SELF,
            property: PropertyId::known("opacity"),
            composite: CompositeMode::Replace,
            order: 0,
            base: MotionValue::Scalar(1.0),
            post: PostOp::ClampUnit,
            optional: false,
            segments,
        });
        program
    }

    #[test]
    fn quantize_matches_the_timeline_grid() {
        assert_eq!(quantize_time(0.019, 30.0), 0.0);
        assert!(quantize_time(0.019, 60.0) > 0.0);
        assert!(quantize_time(f64::NAN, 30.0).is_nan());
        assert_eq!(quantize_time(1.5, 0.0), 1.5);
    }

    #[test]
    fn fill_before_holds_at_progress_zero() {
        let program = program_with(vec![tween(0.5, 1.5, 0.0, 1.0, Fill::Hold, Fill::Off)]);
        let track = &program.property_tracks[0];
        assert_eq!(
            sample_track(&program, track, 0.0),
            Some(MotionValue::Scalar(0.0))
        );
        assert_eq!(
            sample_track(&program, track, 1.0),
            Some(MotionValue::Scalar(0.5))
        );
        assert_eq!(sample_track(&program, track, 1.5), None);
    }

    #[test]
    fn fill_after_holds_at_progress_one() {
        let program = program_with(vec![tween(0.5, 1.5, 0.0, 1.0, Fill::Off, Fill::Hold)]);
        let track = &program.property_tracks[0];
        assert_eq!(sample_track(&program, track, 0.0), None);
        assert_eq!(
            sample_track(&program, track, 9.0),
            Some(MotionValue::Scalar(1.0))
        );
    }

    #[test]
    fn zero_length_segments_sample_the_settled_end() {
        let program = program_with(vec![tween(0.5, 0.5, 0.0, 1.0, Fill::Hold, Fill::Off)]);
        let track = &program.property_tracks[0];
        assert_eq!(
            sample_track(&program, track, 0.4),
            Some(MotionValue::Scalar(1.0))
        );
        assert_eq!(sample_track(&program, track, 0.5), None);
    }

    #[test]
    fn the_later_segment_wins_at_a_shared_boundary() {
        let program = program_with(vec![
            tween(0.0, 1.0, 0.0, 1.0, Fill::Hold, Fill::Off),
            tween(1.0, 2.0, 1.0, 0.0, Fill::Off, Fill::Hold),
        ]);
        let track = &program.property_tracks[0];
        assert_eq!(
            sample_track(&program, track, 1.0),
            Some(MotionValue::Scalar(1.0))
        );
        assert_eq!(
            sample_track(&program, track, 1.5),
            Some(MotionValue::Scalar(0.5))
        );
    }

    #[test]
    fn sampling_is_order_independent() {
        let program = program_with(vec![
            tween(0.0, 1.0, 0.0, 1.0, Fill::Hold, Fill::Off),
            tween(1.0, 2.0, 1.0, 0.0, Fill::Off, Fill::Hold),
        ]);
        let instants: Vec<f64> = (0..200).map(|i| i as f64 * 0.017).collect();
        let forward: Vec<u64> = instants
            .iter()
            .map(|t| {
                let mut buf = PoseBuffer::identity();
                sample(&program, TargetId::SELF, *t, &mut buf);
                buf.scalar_or("opacity", 1.0).to_bits()
            })
            .collect();
        let backward: Vec<u64> = instants
            .iter()
            .rev()
            .map(|t| {
                let mut buf = PoseBuffer::identity();
                sample(&program, TargetId::SELF, *t, &mut buf);
                buf.scalar_or("opacity", 1.0).to_bits()
            })
            .collect();
        assert_eq!(forward, backward.into_iter().rev().collect::<Vec<_>>());
    }
}
