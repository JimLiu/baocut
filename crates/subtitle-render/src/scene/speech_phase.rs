//! Cue speech phase and word span booleans (`caption-speech-phase/1`).
//!
//! These are read-only interval facts beside the unique active/read/unread
//! word state: overlapping words may both be in span, and the cue phase is
//! never encoded as a fourth word state.
use super::*;

pub(super) const CAPABILITY: &str = "caption-speech-phase/1";

pub(super) fn enabled(scene: &Scene) -> bool {
    scene.required_capabilities.iter().any(|c| c == CAPABILITY)
}

/// Speech envelope of a cue: earliest timed word start, latest timed word end,
/// and whether it comes from the explicit estimated timing policy.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct CueSpeech {
    first_start: f64,
    last_end: f64,
    estimated: bool,
}

/// Real input word times take precedence. Without them, `estimated` spreads
/// display words across the cue, so the envelope is the cue itself; under
/// `require-word-timing` the phase is unavailable.
pub(super) fn cue_speech(cue: &SceneCue, timing: TimingPolicy) -> Option<CueSpeech> {
    let mut words = cue
        .words
        .iter()
        .filter(|word| !word.text.is_empty())
        .peekable();
    if words.peek().is_none() {
        return (timing == TimingPolicy::Estimated).then_some(CueSpeech {
            first_start: cue.start,
            last_end: cue.end,
            estimated: true,
        });
    }
    let (first_start, last_end) = words.fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), word| {
        (a.min(word.start), b.max(word.end))
    });
    Some(CueSpeech {
        first_start,
        last_end,
        estimated: false,
    })
}

pub(super) fn add_fields(out: &mut Context, u: &Unit, seconds: f64) {
    let (before, reading, after, estimated) = match u.cue_speech {
        Some(s) if seconds < s.first_start => (true, false, false, s.estimated),
        Some(s) if seconds < s.last_end => (false, true, false, s.estimated),
        Some(s) => (false, false, true, s.estimated),
        None => (false, false, false, false),
    };
    // Only units bound to a word (word, grapheme and their repeat decorations)
    // carry a word span; estimated spans are marked by `unit.wordTimed = false`.
    let in_span = matches!(u.kind, UnitKind::Word | UnitKind::Grapheme)
        && !u.whitespace
        && u.spans
            .get(&UnitKind::Word)
            .is_some_and(|&(start, end)| start <= seconds && seconds < end);
    for (path, value) in [
        ("cue.speechPhase.beforeFirst", before),
        ("cue.speechPhase.reading", reading),
        ("cue.speechPhase.afterLast", after),
        ("cue.speechPhase.estimated", estimated),
        ("word.inSpan", in_span),
    ] {
        out.fields.insert(path.into(), Evaluated::Bool(value));
    }
}
