//! BaoCut 产品剪辑域的纯函数核心。
//!
//! 本 crate 不做 I/O：源级无损 cuts、媒体视图、时间轴 clips、词锚点与
//! `timeline.json` schema 都在这里求值。CLI、serve、Studio 与原生客户端必须
//! 消费同一结果，不能各自复制时间语义。

#![recursion_limit = "512"]

pub mod anchors;
pub mod animations;
pub mod arrange;
pub mod cuts;
pub mod detect;
pub mod duck;
pub mod effects;
pub mod elements;
pub mod follow;
pub mod geometry;
pub mod keyframes;
pub mod lottie_fill;
pub mod map;
pub mod match_text;
pub mod motion;
pub mod patch;
pub mod protocol;
pub mod rules;
pub mod schema;
pub mod screentext;
pub mod svg_fill;
pub mod template;
pub mod video_elements;
pub mod video_transitions;
pub mod words;

pub use self::motion::{
    AnimationPartPose, AnimationPartUnit, AnimationPose, AnimationSlotSummary,
    AnimationSummaryKind, TextAnimationFrame, resolve_animation_pose, resolve_text_animation,
    split_animation_parts, summarize_animation,
};
pub use anchors::{
    AnchorBoundary, AnchorError, WordAnchor, parse_word_anchor, resolve_time_value,
    resolve_word_anchor,
};
pub use animations::{
    ANIMATION_PRESET_VERSION, AnimationPlan, AnimationSlotKind, AnimationSlotPlan, DURATION_MAX,
    DURATION_MIN, PERIOD_MAX, PERIOD_MIN, apply_animation, clear_animation,
};
pub use arrange::{
    ClipProjection, ClipSegment, PlaybackStep, SourcePosition, TimelinePosition,
    TimelineProjection, add_clip, clips_timeline_to_position, clips_timeline_to_source,
    materialize_implicit_clip, move_clip, remove_clips, set_clip_rate, split_clip, trim_clip,
};
pub use cuts::{CutSet, KeptSpan, SeamBias, insert_cut, restore_cut, retime_cut};
pub use detect::{
    ChapterWindow, CutProposal, DetectWord, FillerOptions, SilenceOptions, detect_fillers,
    detect_silences, filler_phrases, merge_proposals, normalize_filler, skip_already_cut,
};
pub use duck::{AudioGainPlan, Duck, GainEnvelope, GainWarning, element_gain_envelopes};
pub use effects::{LoweredEffect, REFERENCE_SHORT_EDGE, lower_element_effects};
pub use elements::{
    JOIN_EPSILON, JoinKeep, JoinRefusal, add_element, carries_source_clock, join_elements,
    media_play_rate, move_element_to_track, patch_element, patch_main, remove_element,
    reorder_element, replace_element, resolve_element_id, shifted_src_start, split_element,
    split_point_inside,
};
pub use follow::{
    COMPOSE_EPS, ClockEdit, FollowCreated, FollowReport, StalePicture, clock_snapshot,
    follow_clock, picture_assignments, same_clock, stale_pictures,
};
pub use geometry::{
    ElementAspect, ElementGeometry, PlaceDefaults, default_place, element_height, element_width,
    is_pixel_square, progress_at, static_box, width_basis,
};
pub use keyframes::{KeyTime, Keyframe, KeyframeCaps, Keyframes};
pub use map::{MIN_EVENT_DURATION, MappedEvent};
pub use match_text::{
    MatchAction, MatchCutSpan, MatchHit, MatchOptions, MatchParagraph, MatchPlan, MatchPlanError,
    MatchScope, MatchWord, plan_text_match,
};
pub use rules::{
    AudioCarrier, OPEN_TAIL, OriginalAudio, content_end, detached_json, display_duration,
    legacy_main, legacy_main_json, open_ended, open_ended_json, original_audio,
    original_audio_json, set_original_audio_muted_json,
};
pub use scene_primitives::svg_animation;
pub use schema::{
    Clip, Cut, ELEMENT_PROPS_MISMATCH, Element, ElementKind, Place, ProgressProps, ShapeProps,
    Source, SourceKind, StickerProps, TIMELINE_VERSION, TIMELINE_VERSIONS, TimelineDocument,
    TimelineError, VisualizerProps, WHITEBOARD_BEAT_AFTER_DRAW, WHITEBOARD_BEAT_WINDOW,
    WHITEBOARD_BEATS_HEURISTIC, WHITEBOARD_EMPTY_BOX, WHITEBOARD_LABEL_MISMATCH,
    WHITEBOARD_MAX_BEATS, WHITEBOARD_MAX_LABEL_CHARS, WHITEBOARD_SOURCE_KIND,
    WHITEBOARD_SPEECH_WITHOUT_PROGRESS, WHITEBOARD_UNASSIGNED_FOREGROUND,
    WHITEBOARD_WINDOW_TOO_SHORT, WhiteboardBeat, WhiteboardHand, WhiteboardPace, WhiteboardProps,
    schema_json,
};
pub use screentext::{
    ANCHOR_EVIDENCE_TICK, DEFAULT_DISPLAY_DURATION, DEFAULT_SOURCE_FALLBACK, SCAN_MAX_SAMPLE_GAP,
    SCAN_SAME_CENTER_PERCENT, SCAN_SAME_TEXT_RATIO, SCREENTEXT_QUEUE_VERSION, ScreenTextBBox,
    ScreenTextBlock, ScreenTextBlockState, ScreenTextColors, ScreenTextLine, ScreenTextPage,
    ScreenTextQueue, ScreenTextQueueFrame, ScreenTextScanBoundary, ScreenTextScanEdge,
    ScreenTextScanFoldResult, ScreenTextSpan, ScreenTextTiming, ScreenTextTotals,
    ScreenTextTranslationFile, ScreenTextTranslationItem, ScreenTextTranslationResult,
    TIME_EPSILON, apply_translations, build_screen_text_element, default_screen_text_style,
    fold_screen_text_scan, normalize_screen_text, resolve_screen_text_span, same_screen_text_block,
    screen_text_display_span, screen_text_similarity, screen_text_time_key, screentext_element_key,
    should_preserve_screen_text_timing,
};
pub use words::{
    DEFAULT_WORD_PAD, WordSpan, WordTiming, resolve_word_span, word_span_end, word_span_start,
};
