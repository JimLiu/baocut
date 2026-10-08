//! Timeline element animation sampling.
//!
//! 数值内核在 [`bcut_motion`]（阶段 1，设计 §5.3）：本模块只做 lowering 与投影。
//! `resolve_animation_pose` / `resolve_text_animation` 的签名与语义不变，
//! `AnimationPose` 降为 `PoseBuffer` 的投影类型。预览与导出必须消费同一函数，
//! 不得在渲染器里维护本地 preset 公式。

use std::cell::RefCell;
use std::ops::Range;

use ::motion::composite::PoseBuffer;
use ::motion::lower_timeline::{
    AnimationInput, SlotInput, TextLowering, Window, effective_exit, lower_timeline_animation,
    lower_timeline_text,
};
use ::motion::program::TargetId;

use crate::schema::{Animation, AnimationSlot};

pub use ::motion::lower_timeline::TimelineProgram;
/// 预览与导出共用的采样网格量化器（ADR-M10：调用方传项目 fps）。
pub use ::motion::sample::quantize_time;
/// 文字 part 切分单元。唯一实现在 `motion::text_parts`。
pub use ::motion::text_parts::PartUnit as AnimationPartUnit;
/// 用 VoiceInk `AnimParts.split` 的规则切分文本；返回 UTF-8 字节区间。
pub use ::motion::text_parts::split_animation_parts;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnimationPose {
    pub opacity: f64,
    /// Fraction of the canvas short edge.
    pub dx: f64,
    /// Fraction of the canvas short edge; positive is down.
    pub dy: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotation: f64,
    pub blur: f64,
    pub reveal: Option<f64>,
}

impl AnimationPose {
    pub const IDENTITY: Self = Self {
        opacity: 1.0,
        dx: 0.0,
        dy: 0.0,
        scale_x: 1.0,
        scale_y: 1.0,
        rotation: 0.0,
        blur: 0.0,
        reveal: None,
    };

    pub fn is_identity(self) -> bool {
        self == Self::IDENTITY
    }

    /// `PoseBuffer` → `AnimationPose`（设计 §5.3 的投影）。
    fn from_buffer(buffer: &PoseBuffer) -> Self {
        Self {
            opacity: buffer.scalar_or("opacity", 1.0),
            dx: buffer.scalar_or("dx", 0.0),
            dy: buffer.scalar_or("dy", 0.0),
            scale_x: buffer.scalar_or("scaleX", 1.0),
            scale_y: buffer.scalar_or("scaleY", 1.0),
            rotation: buffer.scalar_or("rotation", 0.0),
            blur: buffer.scalar_or("blur", 0.0),
            reveal: buffer.scalar("reveal"),
        }
    }
}

impl Default for AnimationPose {
    fn default() -> Self {
        Self::IDENTITY
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnimationPartPose {
    pub index: usize,
    pub opacity: f64,
    /// Fraction of the canvas short edge; positive is down.
    pub dx: f64,
    /// Fraction of the canvas short edge; positive is down.
    pub dy: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextAnimationFrame {
    pub container: AnimationPose,
    pub unit: Option<AnimationPartUnit>,
    pub ranges: Vec<Range<usize>>,
    pub parts: Vec<AnimationPartPose>,
}

impl TextAnimationFrame {
    fn container(pose: AnimationPose) -> Self {
        Self {
            container: pose,
            unit: None,
            ranges: Vec::new(),
            parts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnimationSummaryKind {
    Enter,
    Exit,
    Loop,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnimationSlotSummary {
    pub kind: AnimationSummaryKind,
    pub preset: String,
    pub derived: bool,
}

fn slot_view(slot: &AnimationSlot) -> SlotInput<'_> {
    SlotInput {
        preset: slot.preset.as_str(),
        preset_version: slot.preset_version,
        dur: slot.dur,
        delay: slot.delay,
        intensity: slot.intensity,
        ease: slot.ease.as_deref(),
        stagger: slot.stagger,
        stagger_from: slot.stagger_from.as_deref(),
        period: slot.period,
        phase: slot.phase,
        seed: slot.seed,
    }
}

fn animation_view(animation: &Animation) -> AnimationInput<'_> {
    AnimationInput {
        enter: animation.enter.as_ref().map(slot_view),
        exit: animation.exit.as_ref().map(slot_view),
        r#loop: animation.r#loop.as_ref().map(slot_view),
    }
}

/// 把动画槽编译成 `MotionProgram`。`None` = 生命期非法（非有限或 ≤ 0）。
///
/// `resolve_animation_pose` 走线程本地缓存；需要把编译提到帧循环外面的调用方
/// （导出计划、舞台节点）可以直接用这个入口。
pub fn compile_animation(
    animation: &Animation,
    start: f64,
    end: Option<f64>,
    project_end: f64,
) -> Option<TimelineProgram> {
    lower_timeline_animation(
        &animation_view(animation),
        Window {
            start,
            end,
            project_end,
        },
    )
}

// ── 编译缓存 ─────────────────────────────────────────────────────────
//
// `resolve_animation_pose` 是逐元素逐帧调用的（`render_plan.rs` 的帧循环、
// GPUI 的舞台 tick），每次重新 lowering 会是明显回退。直接映射的定长缓存：
// 命中路径不分配堆内存，未命中才 clone 一份 `Animation` 存 key。

const CACHE_SLOTS: usize = 512;

struct CacheEntry {
    animation: Animation,
    start: u64,
    end: Option<u64>,
    project_end: u64,
    program: Option<TimelineProgram>,
}

thread_local! {
    static PROGRAM_CACHE: RefCell<Vec<Option<CacheEntry>>> =
        RefCell::new((0..CACHE_SLOTS).map(|_| None).collect());
}

fn cache_slot(animation: &Animation, start: f64, end: Option<f64>, project_end: f64) -> usize {
    let mut hash = ::motion::fnv1a64(&start.to_bits().to_le_bytes());
    hash ^= ::motion::fnv1a64(&end.unwrap_or(f64::NAN).to_bits().to_le_bytes());
    hash ^= ::motion::fnv1a64(&project_end.to_bits().to_le_bytes());
    for slot in [&animation.enter, &animation.exit, &animation.r#loop] {
        match slot {
            Some(slot) => {
                hash ^= ::motion::fnv1a64(slot.preset.as_bytes());
                hash = hash.rotate_left(7);
                for value in [
                    slot.dur,
                    slot.delay,
                    slot.intensity,
                    slot.period,
                    slot.phase,
                ] {
                    hash ^= ::motion::fnv1a64(&value.unwrap_or(f64::NAN).to_bits().to_le_bytes());
                    hash = hash.rotate_left(3);
                }
            }
            None => hash = hash.rotate_left(11),
        }
    }
    (hash % CACHE_SLOTS as u64) as usize
}

fn with_program<R>(
    animation: &Animation,
    start: f64,
    end: Option<f64>,
    project_end: f64,
    read: impl FnOnce(Option<&TimelineProgram>) -> R,
) -> R {
    let index = cache_slot(animation, start, end, project_end);
    PROGRAM_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let hit = cache[index].as_ref().is_some_and(|entry| {
            entry.start == start.to_bits()
                && entry.end == end.map(f64::to_bits)
                && entry.project_end == project_end.to_bits()
                && entry.animation == *animation
        });
        if !hit {
            cache[index] = Some(CacheEntry {
                animation: animation.clone(),
                start: start.to_bits(),
                end: end.map(f64::to_bits),
                project_end: project_end.to_bits(),
                program: compile_animation(animation, start, end, project_end),
            });
        }
        read(
            cache[index]
                .as_ref()
                .and_then(|entry| entry.program.as_ref()),
        )
    })
}

/// Returns the animation slots that actually render, including the mirrored
/// exit derived from a lone entrance. Presentation and export preflight use
/// this instead of reading the sparse stored fields and under-reporting loss.
pub fn summarize_animation(animation: &Animation) -> Vec<AnimationSlotSummary> {
    let mut output = Vec::new();
    if let Some(enter) = animation
        .enter
        .as_ref()
        .filter(|slot| slot.preset != "none")
    {
        output.push(AnimationSlotSummary {
            kind: AnimationSummaryKind::Enter,
            preset: enter.preset.clone(),
            derived: false,
        });
    }
    if let Some((exit, _)) = effective_exit(&animation_view(animation)) {
        output.push(AnimationSlotSummary {
            kind: AnimationSummaryKind::Exit,
            preset: exit.preset.to_owned(),
            derived: animation.exit.is_none(),
        });
    }
    if let Some(loop_slot) = animation
        .r#loop
        .as_ref()
        .filter(|slot| slot.preset != "none")
    {
        output.push(AnimationSlotSummary {
            kind: AnimationSummaryKind::Loop,
            preset: loop_slot.preset.clone(),
            derived: false,
        });
    }
    output
}

/// Resolve a timeline element animation at `time`.
///
/// `start`/`end` are the already-resolved timeline window. `end=None` closes at
/// `project_end`. `fps` is the shared preview/export sampling grid; callers must
/// pass the same plan rate so identical instants seek to identical poses.
pub fn resolve_animation_pose(
    animation: Option<&Animation>,
    start: f64,
    end: Option<f64>,
    project_end: f64,
    time: f64,
    fps: f64,
) -> AnimationPose {
    let Some(animation) = animation else {
        return AnimationPose::IDENTITY;
    };
    with_program(animation, start, end, project_end, |program| {
        let Some(program) = program else {
            return AnimationPose::IDENTITY;
        };
        let local = (quantize_time(time, fps) - start).clamp(0.0, program.lifetime);
        let mut buffer = PoseBuffer::identity();
        ::motion::sample(&program.program, TargetId::SELF, local, &mut buffer);
        AnimationPose::from_buffer(&buffer)
    })
}

/// Resolve VoiceInk-compatible per-grapheme/per-word text entrance animation.
///
/// During a cascade the container stays at identity and only `parts` move. At
/// every other instant this is exactly `resolve_animation_pose`, including the
/// derived whole-element exit and the idle loop.
pub fn resolve_text_animation(
    animation: Option<&Animation>,
    start: f64,
    end: Option<f64>,
    project_end: f64,
    time: f64,
    fps: f64,
    display_text: &str,
) -> TextAnimationFrame {
    let Some(animation) = animation else {
        return TextAnimationFrame::container(AnimationPose::IDENTITY);
    };
    let window = Window {
        start,
        end,
        project_end,
    };
    let cascade = match lower_timeline_text(&animation_view(animation), window, display_text) {
        TextLowering::Container => {
            return TextAnimationFrame::container(resolve_animation_pose(
                Some(animation),
                start,
                end,
                project_end,
                time,
                fps,
            ));
        }
        TextLowering::Identity => {
            return TextAnimationFrame::container(AnimationPose::IDENTITY);
        }
        TextLowering::Cascade(cascade) => cascade,
    };
    let local = (quantize_time(time, fps) - start).clamp(0.0, cascade.lifetime);
    if local >= cascade.finish {
        // 旧实现在这里递归时传的是已 unwrap 的 `Some(end)`：等价，但会重新量化一次，
        // 阶段 0 的 golden 是经这条路径录的，保持原样。
        return TextAnimationFrame::container(resolve_animation_pose(
            Some(animation),
            start,
            Some(end.unwrap_or(project_end)),
            project_end,
            time,
            fps,
        ));
    }
    let parts = (0..cascade.plan.count)
        .map(|index| {
            let mut buffer = PoseBuffer::identity();
            if let Some(tween) = &cascade.tween {
                tween.write_into(&mut buffer, cascade.plan.progress(index, local));
            }
            AnimationPartPose {
                index,
                opacity: buffer.scalar_or("opacity", 1.0),
                dx: 0.0,
                dy: buffer.scalar_or("dy", 0.0),
            }
        })
        .collect();
    TextAnimationFrame {
        container: AnimationPose::IDENTITY,
        unit: Some(cascade.unit),
        ranges: cascade.ranges,
        parts,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(preset: &str) -> AnimationSlot {
        AnimationSlot {
            preset: preset.to_owned(),
            preset_version: Some(1),
            dur: None,
            delay: None,
            intensity: None,
            ease: None,
            stagger: None,
            stagger_from: None,
            period: None,
            phase: None,
            seed: None,
        }
    }

    #[test]
    fn fade_is_quantized_and_derives_a_matching_exit() {
        let animation = Animation {
            enter: Some(slot("fade")),
            exit: None,
            r#loop: None,
        };
        let start = resolve_animation_pose(Some(&animation), 1.0, Some(3.0), 3.0, 1.0, 60.0);
        assert_eq!(start.opacity, 0.0);
        assert!(
            resolve_animation_pose(Some(&animation), 1.0, Some(3.0), 3.0, 1.2, 60.0).opacity > 0.8
        );
        assert_eq!(
            resolve_animation_pose(Some(&animation), 1.0, Some(3.0), 3.0, 3.0, 60.0).opacity,
            0.0
        );
    }

    #[test]
    fn explicit_none_exit_blocks_derivation() {
        let animation = Animation {
            enter: Some(slot("rise")),
            exit: Some(slot("none")),
            r#loop: None,
        };
        assert_eq!(
            resolve_animation_pose(Some(&animation), 0.0, Some(2.0), 2.0, 2.0, 60.0),
            AnimationPose::IDENTITY
        );
    }

    #[test]
    fn short_elements_squeeze_slots_without_overlap() {
        let animation = Animation {
            enter: Some(slot("slideL")),
            exit: Some(slot("slideR")),
            r#loop: None,
        };
        let midpoint = resolve_animation_pose(Some(&animation), 0.0, Some(0.2), 0.2, 0.1, 60.0);
        assert!(midpoint.opacity > 0.99);
        let end = resolve_animation_pose(Some(&animation), 0.0, Some(0.2), 0.2, 0.2, 60.0);
        assert_eq!(end.opacity, 0.0);
    }

    #[test]
    fn loop_sampling_is_seek_safe_and_starts_at_identity() {
        let animation = Animation {
            enter: None,
            exit: Some(slot("none")),
            r#loop: Some(slot("jitter")),
        };
        let at_start = resolve_animation_pose(Some(&animation), 0.0, Some(4.0), 4.0, 0.0, 60.0);
        assert_eq!(at_start, AnimationPose::IDENTITY);
        let first = resolve_animation_pose(Some(&animation), 0.0, Some(4.0), 4.0, 1.234, 60.0);
        let second = resolve_animation_pose(Some(&animation), 0.0, Some(4.0), 4.0, 1.234, 60.0);
        assert_eq!(first, second);
        assert!(first.dx != first.dy);
    }

    #[test]
    fn pop_uses_spring_scale_but_bounded_opacity() {
        let animation = Animation {
            enter: Some(slot("pop")),
            exit: Some(slot("none")),
            r#loop: None,
        };
        let pose = resolve_animation_pose(Some(&animation), 0.0, Some(2.0), 2.0, 0.3, 60.0);
        assert!(pose.scale_x > 0.9);
        assert!((0.0..=1.0).contains(&pose.opacity));
    }

    #[test]
    fn overshooting_user_ease_degrades_only_constrained_channels() {
        // `rise` 缺省 0.5s：t = 0.25 正好是进度 0.5。
        let mut custom = slot("rise");
        custom.ease = Some("easeOutBack".to_owned());
        let animation = Animation {
            enter: Some(custom),
            exit: Some(slot("none")),
            r#loop: None,
        };
        let pose = resolve_animation_pose(Some(&animation), 0.0, Some(4.0), 4.0, 0.25, 60.0);
        assert!((pose.opacity - 0.875).abs() < 1e-12);
        assert!(pose.dy.abs() < 0.003);
    }

    #[test]
    fn zero_intensity_keeps_the_whole_identity_pose() {
        let mut enter = slot("wipe");
        enter.intensity = Some(0.0);
        let animation = Animation {
            enter: Some(enter),
            exit: Some(slot("none")),
            r#loop: None,
        };
        let pose = resolve_animation_pose(Some(&animation), 0.0, Some(2.0), 2.0, 0.1, 60.0);
        assert_eq!(pose, AnimationPose::IDENTITY);
        assert_eq!(pose.reveal, None);
    }

    #[test]
    fn caller_frame_rate_controls_the_shared_sampling_grid() {
        let animation = Animation {
            enter: Some(slot("fade")),
            exit: Some(slot("none")),
            r#loop: None,
        };
        let at_30 = resolve_animation_pose(Some(&animation), 0.0, Some(2.0), 2.0, 0.019, 30.0);
        let at_60 = resolve_animation_pose(Some(&animation), 0.0, Some(2.0), 2.0, 0.019, 60.0);
        assert_eq!(at_30.opacity, 0.0);
        assert!(at_60.opacity > 0.0);
    }

    #[test]
    fn the_compile_cache_does_not_confuse_neighbouring_animations() {
        let a = Animation {
            enter: Some(slot("fade")),
            exit: Some(slot("none")),
            r#loop: None,
        };
        let b = Animation {
            enter: Some(slot("rise")),
            exit: Some(slot("none")),
            r#loop: None,
        };
        for _ in 0..8 {
            let pose_a = resolve_animation_pose(Some(&a), 0.0, Some(4.0), 4.0, 0.2, 60.0);
            let pose_b = resolve_animation_pose(Some(&b), 0.0, Some(4.0), 4.0, 0.2, 60.0);
            assert_eq!(pose_a.dy, 0.0);
            assert!(pose_b.dy > 0.0);
        }
        // 同一个动画换窗口必须重新编译
        let short = resolve_animation_pose(Some(&a), 0.0, Some(0.2), 0.2, 0.1, 60.0);
        let long = resolve_animation_pose(Some(&a), 0.0, Some(4.0), 4.0, 0.1, 60.0);
        assert!(short.opacity > long.opacity);
    }

    #[test]
    fn text_part_split_matches_voiceink_grapheme_cjk_and_whitespace_contract() {
        let cases = [
            (
                "Hello world",
                AnimationPartUnit::Char,
                vec!["H", "e", "l", "l", "o ", "w", "o", "r", "l", "d"],
            ),
            (
                "Hello world",
                AnimationPartUnit::Word,
                vec!["Hello ", "world"],
            ),
            (
                "BaoCut 剪辑 v2",
                AnimationPartUnit::Word,
                vec!["BaoCut ", "剪", "辑 ", "v2"],
            ),
            (
                "Hi 👨‍👩‍👧 🇯🇵 ok",
                AnimationPartUnit::Char,
                vec!["H", "i ", "👨‍👩‍👧 ", "🇯🇵 ", "o", "k"],
            ),
            ("  padded  ", AnimationPartUnit::Word, vec!["  padded  "]),
        ];
        for (text, unit, expected) in cases {
            let actual = split_animation_parts(text, unit)
                .into_iter()
                .map(|range| &text[range])
                .collect::<Vec<_>>();
            assert_eq!(actual, expected, "text={text:?} unit={unit:?}");
        }
    }

    #[test]
    fn typewriter_parts_match_voiceink_five_part_golden() {
        let animation = Animation {
            enter: Some(slot("typewriter")),
            exit: None,
            r#loop: None,
        };
        let frame =
            resolve_text_animation(Some(&animation), 0.0, Some(6.0), 12.0, 0.05, 60.0, "abcde");
        assert_eq!(frame.container, AnimationPose::IDENTITY);
        assert_eq!(frame.unit, Some(AnimationPartUnit::Char));
        let opacity = frame
            .parts
            .iter()
            .map(|part| part.opacity)
            .collect::<Vec<_>>();
        assert!((opacity[0] - 1.0).abs() < 1e-12);
        assert!((opacity[1] - 0.208_333_333_333_333_45).abs() < 1e-12);
        assert_eq!(&opacity[2..], &[0.0, 0.0, 0.0]);

        let settled =
            resolve_text_animation(Some(&animation), 0.0, Some(6.0), 12.0, 0.6, 60.0, "abcde");
        assert!(settled.parts.is_empty());
        assert_eq!(settled.container, AnimationPose::IDENTITY);
    }

    #[test]
    fn rise_words_center_order_matches_voiceink_golden() {
        let mut enter = slot("riseWords");
        enter.stagger_from = Some("center".to_owned());
        let animation = Animation {
            enter: Some(enter),
            exit: None,
            r#loop: None,
        };
        let frame = resolve_text_animation(
            Some(&animation),
            0.0,
            Some(6.0),
            12.0,
            0.1,
            60.0,
            "a b c d e",
        );
        let expected = [
            (0.0, 0.026),
            (0.384_575_760_099_958_4, 0.016_001_030_237_401_08),
            (0.739_691_795_085_381_2, 0.006_768_013_327_780_088),
            (0.384_575_760_099_958_4, 0.016_001_030_237_401_08),
            (0.0, 0.026),
        ];
        for (actual, expected) in frame.parts.iter().zip(expected) {
            assert!((actual.opacity - expected.0).abs() < 1e-12);
            assert!((actual.dy - expected.1).abs() < 1e-12);
        }
    }
}
