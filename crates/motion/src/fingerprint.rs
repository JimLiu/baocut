//! `MotionProgram` 指纹（设计 §5.3）。
//!
//! FNV-1a-64，不引入 `sha2`：程序指纹是**等价/调试 token**，不是内容寻址哈希；
//! 需要内容寻址时用 `scene_primitives::fingerprint::canonical_json` 哈希
//! `canonical_bytes()`（计划 §1.1）。
//!
//! 两个指纹，职责不同：
//! - `fingerprint()`：版本 + 时间基准 + 轨（target/property/段时间/typed 值/曲线/
//!   插值器/composite/order）。**不含** base/post/optional/fill 与 `sources`，
//!   这样"语义等价的 Timeline 与 BCF 文档得到同一指纹"（设计 §10 阶段 1 验收）
//!   才可能成立——两条路径的 preset id 与 manifest hash 天然不同。
//! - `full_fingerprint()`：再叠加 base/post/optional/fill 与 `sources`
//!   （registry id / version / manifest hash），配方一改就变。

use std::fmt::Write as _;

use crate::curve::CurveSpec;
use crate::loop_kernel::LoopKernel;
use crate::program::{Fill, MotionProgram, MotionSegment, PropertyTrack, SegmentKind, TimeBase};
use crate::value::MotionValue;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = FNV_OFFSET;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

/// `-0.0` 归一到 `+0.0`，让 Timeline 与 BCF 两条 lowering 的零符号差异不劈开指纹。
fn bits(value: f64) -> u64 {
    if value == 0.0 {
        0.0f64.to_bits()
    } else {
        value.to_bits()
    }
}

fn encode_value(out: &mut String, value: &MotionValue) {
    match value {
        MotionValue::Vec2([x, y]) => {
            let _ = write!(out, "v2:{:016x}:{:016x}", bits(*x), bits(*y));
        }
        MotionValue::Color(c) => {
            let _ = write!(
                out,
                "col:{:016x}:{:016x}:{:016x}:{:016x}",
                bits(c.r),
                bits(c.g),
                bits(c.b),
                bits(c.a)
            );
        }
        // 数字（含 `Discrete` 里的整数 JSON）一律编码成标量：`0` 与 `0.0` 是同一段运动。
        other => match other.as_f64() {
            Some(n) => {
                let _ = write!(out, "n:{:016x}", bits(n));
            }
            None => {
                let _ = write!(out, "d:{}", other.to_json());
            }
        },
    }
}

fn encode_curve(out: &mut String, curve: &CurveSpec) {
    match curve {
        // `Default` 与 `Named(Linear)` 行为相同，指纹上必须相同。
        CurveSpec::Default => out.push_str("c:linear"),
        CurveSpec::Named(id) => {
            let _ = write!(out, "c:{}", id.name());
        }
        CurveSpec::Unknown(name) => {
            let _ = write!(out, "c?:{name}");
        }
        CurveSpec::Spring { response, damping } => {
            let _ = write!(out, "cs:{:016x}:{:016x}", bits(*response), bits(*damping));
        }
        CurveSpec::CubicBezier { x1, y1, x2, y2 } => {
            let _ = write!(
                out,
                "cb:{:016x}:{:016x}:{:016x}:{:016x}",
                bits(*x1),
                bits(*y1),
                bits(*x2),
                bits(*y2)
            );
        }
        CurveSpec::Steps { count, position } => {
            let _ = write!(out, "cst:{count}:{position:?}");
        }
    }
}

fn encode_kernel(out: &mut String, kernel: &LoopKernel) {
    let _ = writeln!(
        out,
        "k:{:?}:{}:{:?}:{:016x}:{}:{}:{}:{:016x}:{:016x}:{:?}:{:016x}:{:?}",
        kernel.wave,
        kernel.wave_samples,
        kernel.noise,
        bits(kernel.amplitude),
        kernel.channel_ordinal,
        kernel.channel_seed_stride,
        kernel.seed,
        bits(kernel.period),
        bits(kernel.phase_offset),
        kernel.envelope,
        bits(kernel.identity),
        kernel.post,
    );
    // 关键帧循环的补充行；波形内核此表为空，输出逐位不变。
    for key in &kernel.keyframes {
        let _ = writeln!(
            out,
            "kk:{:016x}:{:016x}:{:?}",
            bits(key.at),
            bits(key.value),
            key.curve
        );
    }
}

fn encode_segment(out: &mut String, segment: &MotionSegment, full: bool) {
    let _ = write!(
        out,
        "  s:{:016x}:{:016x}:{:?}:{}",
        bits(segment.t0),
        bits(segment.t1),
        segment.composite,
        segment.order
    );
    if full {
        let _ = write!(
            out,
            ":{}:{}",
            if segment.fill_before == Fill::Hold {
                1
            } else {
                0
            },
            if segment.fill_after == Fill::Hold {
                1
            } else {
                0
            }
        );
    }
    match &segment.kind {
        SegmentKind::Tween {
            from,
            to,
            curve,
            interpolator,
        } => {
            out.push_str(":tween:");
            encode_value(out, from);
            out.push(':');
            encode_value(out, to);
            out.push(':');
            encode_curve(out, curve);
            let _ = write!(out, ":{interpolator:?}");
        }
        SegmentKind::Hold { value } => {
            out.push_str(":hold:");
            encode_value(out, value);
        }
        SegmentKind::Loop(reference) => {
            let _ = write!(out, ":loop:{}", reference.0);
        }
    }
    out.push('\n');
}

fn encode_track(out: &mut String, track: &PropertyTrack, full: bool) {
    let _ = write!(out, "t:{}:{}", track.target.0, track.property);
    if full {
        out.push_str(":base=");
        encode_value(out, &track.base);
        let _ = write!(
            out,
            ":post={:?}:opt={}",
            track.post,
            if track.optional { 1 } else { 0 }
        );
    }
    out.push('\n');
    for segment in &track.segments {
        encode_segment(out, segment, full);
    }
}

impl MotionProgram {
    fn encode(&self, full: bool) -> String {
        let mut out = String::new();
        let _ = writeln!(
            out,
            "bcut-motion/{}\n{}",
            self.version,
            match self.time_base {
                TimeBase::ElementLocal => "local",
                TimeBase::Absolute => "absolute",
            }
        );
        let mut order: Vec<&PropertyTrack> = self.property_tracks.iter().collect();
        order.sort_by(|a, b| {
            a.target
                .cmp(&b.target)
                .then_with(|| a.property.cmp(&b.property))
        });
        for track in order {
            encode_track(&mut out, track, full);
        }
        for kernel in &self.loop_kernels {
            encode_kernel(&mut out, kernel);
        }
        if let Some(plan) = &self.part_plan {
            let _ = writeln!(
                out,
                "p:{:?}:{}:{:016x}:{:016x}:{:016x}:{:?}",
                plan.unit,
                plan.count,
                bits(plan.delay),
                bits(plan.part_duration),
                bits(plan.step),
                plan.orders
            );
        }
        if full {
            for source in &self.sources {
                let _ = writeln!(
                    out,
                    "src:{}:{}:{:016x}",
                    source.id, source.version, source.manifest_hash
                );
            }
        }
        out
    }

    pub fn canonical_bytes(&self) -> Vec<u8> {
        self.encode(false).into_bytes()
    }

    pub fn fingerprint(&self) -> u64 {
        fnv1a64(&self.canonical_bytes())
    }

    pub fn full_canonical_bytes(&self) -> Vec<u8> {
        self.encode(true).into_bytes()
    }

    pub fn full_fingerprint(&self) -> u64 {
        fnv1a64(&self.full_canonical_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composite::{CompositeMode, PostOp};
    use crate::curve::EaseId;
    use crate::interpolate::InterpolatorSpec;
    use crate::program::{PresetRef, PropertyTrack, TargetId};
    use crate::value::PropertyId;
    use serde_json::json;

    fn one_track(from: MotionValue, to: MotionValue, curve: CurveSpec) -> MotionProgram {
        let mut program = MotionProgram::new(TimeBase::Absolute);
        program.property_tracks.push(PropertyTrack {
            composite: CompositeMode::Replace,
            order: 0,
            target: TargetId::SELF,
            property: PropertyId::known("opacity"),
            base: MotionValue::Scalar(1.0),
            post: PostOp::ClampUnit,
            optional: false,
            segments: vec![MotionSegment {
                t0: 1.0,
                t1: 1.4,
                fill_before: Fill::Hold,
                fill_after: Fill::Hold,
                composite: CompositeMode::Replace,
                order: 0,
                kind: SegmentKind::Tween {
                    from,
                    to,
                    curve,
                    interpolator: InterpolatorSpec::Linear,
                },
            }],
        });
        program
    }

    #[test]
    fn fnv1a64_matches_the_reference_vector() {
        assert_eq!(fnv1a64(b""), FNV_OFFSET);
        assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
    }

    #[test]
    fn integer_json_and_float_scalars_hash_the_same() {
        let a = one_track(
            MotionValue::Discrete(json!(0)),
            MotionValue::Discrete(json!(1)),
            CurveSpec::Default,
        );
        let b = one_track(
            MotionValue::Scalar(0.0),
            MotionValue::Scalar(1.0),
            CurveSpec::Named(EaseId::Linear),
        );
        assert_eq!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn negative_zero_is_normalized() {
        let a = one_track(
            MotionValue::Scalar(-0.0),
            MotionValue::Scalar(1.0),
            CurveSpec::Default,
        );
        let b = one_track(
            MotionValue::Scalar(0.0),
            MotionValue::Scalar(1.0),
            CurveSpec::Default,
        );
        assert_eq!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn sources_only_move_the_full_fingerprint() {
        let mut a = one_track(
            MotionValue::Scalar(0.0),
            MotionValue::Scalar(1.0),
            CurveSpec::Default,
        );
        let b = a.clone();
        a.sources.push(PresetRef {
            id: "timeline.enter.fade".into(),
            version: 1,
            manifest_hash: 42,
        });
        assert_eq!(a.fingerprint(), b.fingerprint());
        assert_ne!(a.full_fingerprint(), b.full_fingerprint());
    }

    #[test]
    fn curves_and_times_move_the_fingerprint() {
        let base = one_track(
            MotionValue::Scalar(0.0),
            MotionValue::Scalar(1.0),
            CurveSpec::Default,
        );
        let eased = one_track(
            MotionValue::Scalar(0.0),
            MotionValue::Scalar(1.0),
            CurveSpec::Named(EaseId::EaseOutCubic),
        );
        assert_ne!(base.fingerprint(), eased.fingerprint());
        assert_ne!(base.fingerprint(), base.rebased(1.0).fingerprint());
    }
}
