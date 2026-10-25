//! Explicit UTF-8 display membership without rewriting source speech words.
use super::*;

pub(super) fn for_cue<'a>(
    presentation: &'a Presentation,
    cue: &SceneCue,
    instance: &str,
) -> Option<&'a WordTextProjection> {
    let occurrence = instance
        .split_once('|')
        .map_or(instance, |(_, value)| value);
    let matching = |row: &&CueOverride| row.cue_id == cue.id;
    presentation
        .cue_overrides
        .iter()
        .filter(|row| row.occurrence_id.is_none())
        .filter(matching)
        .chain(
            presentation
                .cue_overrides
                .iter()
                .filter(|row| row.occurrence_id.as_deref() == Some(occurrence))
                .filter(matching),
        )
        .filter_map(|row| row.word_text_projection.as_ref())
        .last()
}

pub(super) fn bind(
    cue: &SceneCue,
    content: &str,
    projection: &WordTextProjection,
) -> Result<Vec<Word>> {
    let hash = Sha256::digest(content.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if hash != projection.text_sha256 {
        bail!("CAPTION_SCENE_INVALID: stale word text projection hash");
    }
    let source: Vec<_> = cue
        .words
        .iter()
        .filter(|word| !word.text.is_empty())
        .collect();
    if source.is_empty() || source.len() != projection.words.len() || source.len() > MAX_UNITS {
        bail!("CAPTION_SCENE_INVALID: word projection must bind every source word");
    }
    let mut words = Vec::with_capacity(source.len());
    let mut previous_end = 0;
    let mut ids = std::collections::BTreeSet::new();
    for (source, range) in source.into_iter().zip(&projection.words) {
        if range.word_id != source.id
            || !ids.insert(&source.id)
            || range.start < previous_end
            || range.start >= range.end
            || content.get(range.start..range.end).is_none()
        {
            bail!("CAPTION_SCENE_INVALID: invalid source word display range");
        }
        if !source.start.is_finite() || !source.end.is_finite() || source.end < source.start {
            bail!("CAPTION_SCENE_INVALID: word time");
        }
        words.push(Word {
            id: source.id.clone(),
            bytes: range.start..range.end,
            span: Some((source.start, source.end)),
            input_timed: true,
            run_start: false,
        });
        previous_end = range.end;
    }
    Ok(words)
}
