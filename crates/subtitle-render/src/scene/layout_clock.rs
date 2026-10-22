//! Stateless cue sampling remap. Persisted speech and outer activation are untouched.
use super::*;

pub(super) fn enabled(scene: &Scene) -> bool {
    scene.layout.clock.is_some()
        || scene
            .required_capabilities
            .iter()
            .any(|cap| cap == "caption-layout-clock/1")
}

pub(super) fn early_context(
    scene: &Scene,
    cue: &SceneCue,
    index: usize,
    count: usize,
    seconds: f64,
    params: &BTreeMap<String, Evaluated>,
    size: (u32, u32),
    instance: &str,
    seed: &str,
) -> Result<Context> {
    let mut context =
        sampled_layout::early_context(cue, index, count, seconds, params, size, instance, seed)?;
    if enabled(scene) {
        input_fields(&mut context, cue);
    }
    Ok(context)
}

pub(super) fn input_fields(context: &mut Context, cue: &SceneCue) {
    for (name, word) in [("First", cue.words.first()), ("Last", cue.words.last())] {
        let span = word.filter(|w| w.start.is_finite() && w.end.is_finite() && w.end > w.start);
        context.fields.insert(
            format!("unit.input{name}WordTimed"),
            Evaluated::Bool(span.is_some()),
        );
        for (edge, value) in [
            ("Start", span.map_or(0., |w| w.start - cue.start)),
            ("End", span.map_or(0., |w| w.end - cue.start)),
        ] {
            context.fields.insert(
                format!("time.input{name}Word{edge}Seconds"),
                Evaluated::Number(ValueType::Time, value),
            );
        }
    }
}

pub(super) fn sample(
    scene: &Scene,
    cue: &SceneCue,
    index: usize,
    count: usize,
    seconds: f64,
    params: &BTreeMap<String, Evaluated>,
    size: (u32, u32),
    instance: &str,
    seed: &str,
    budget: &mut Budget,
) -> Result<f64> {
    let Some(clock) = &scene.layout.clock else {
        return Ok(seconds);
    };
    let context = early_context(
        scene, cue, index, count, seconds, params, size, instance, seed,
    )?;
    let sample = evaluate(&clock.time, scene, &context, budget)?;
    if sample.value_type() != ValueType::Time {
        bail!("CAPTION_LAYOUT_CLOCK_INVALID: expected time");
    }
    let relative = sample.number()?;
    let absolute = cue.start + relative;
    if !relative.is_finite() || relative.abs() > 1_000_000. || !absolute.is_finite() {
        bail!("CAPTION_LAYOUT_CLOCK_INVALID: finite bounded sample time required");
    }
    Ok(absolute)
}
