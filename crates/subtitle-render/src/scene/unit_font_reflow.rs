//! `caption-unit-font-reflow/1`: width-wrapped pages rewrap at the sampled unit font sizes.
//!
//! Page membership stays frozen at the base size; each sample only refolds the current
//! page's source with the same word-wrap rules, so a growing word can push neighbours to
//! a new line and back without moving words to another page.
use super::*;

pub(super) fn enabled(scene: &Scene) -> bool {
    !scene.layout.pagination.has_fixed_lines()
        && scene
            .required_capabilities
            .iter()
            .any(|c| c == "caption-unit-font-reflow/1")
}

/// Source byte ranges of the rewrapped lines; `measure` shapes an absolute range with the sampled runs.
pub(super) fn line_bytes(
    page: &Page,
    content: &str,
    cfg: &Layout,
    width: f64,
    line_height: f64,
    mut measure: impl FnMut(Range<usize>) -> Result<ShapedLine>,
) -> Result<Vec<Range<usize>>> {
    let paint_range = page.paint_start..page.source_range.end;
    let source = &content[paint_range.clone()];
    let mut failure = None;
    let block = layout(source, Wrap::Word, Some(width), line_height, |r| {
        if failure.is_some() {
            return TextMetricsLine::default();
        }
        match measure(paint_range.start + r.start..paint_range.start + r.end) {
            Ok(shape) => TextMetricsLine {
                width: shape.width,
                ascent: shape.ascent,
                descent: shape.descent,
            },
            Err(error) => {
                failure = Some(error);
                TextMetricsLine::default()
            }
        }
    });
    if let Some(error) = failure {
        return Err(error);
    }
    if cfg.overflow == LayoutOverflow::Error && block.lines.len() > cfg.max_lines {
        bail!("CAPTION_LAYOUT_OVERFLOW: unit font reflow lines");
    }
    Ok(block
        .lines
        .iter()
        .map(|line| paint_range.start + line.bytes.start..paint_range.start + line.paint_end)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn font() -> Vec<u8> {
        include_bytes!("../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec()
    }
    fn plan(width: f64, max_lines: usize, overflow: &str) -> ScenePlan {
        let mut body: serde_json::Value = serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/unit-font-reflow.json"
        ))
        .unwrap();
        let layout = &mut body["scene"]["value"]["layout"];
        layout["width"] = json!({"value": width, "basis": "absolute"});
        layout["x"] = json!({"value": 160, "basis": "absolute"});
        layout["y"] = json!({"value": 90, "basis": "absolute"});
        layout["maxLines"] = json!(max_lines);
        layout["overflow"] = json!(overflow);
        let words = [
            ("a", "Alpha", 0.0, 1.0),
            ("b", "beta", 1.0, 2.0),
            ("c", "gamma", 2.0, 3.0),
        ];
        ScenePlan::compile(
            parse_style(&body).unwrap(),
            Presentation::default(),
            vec![SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                text: "Alpha beta gamma".into(),
                start: 0.0,
                end: 4.0,
                words: words
                    .iter()
                    .map(|(id, text, start, end)| SceneWord {
                        id: (*id).into(),
                        text: (*text).into(),
                        start: *start,
                        end: *end,
                    })
                    .collect(),
            }],
            (320, 180),
            TextEngine::with_document_fonts(&[font()]),
            "reflow".into(),
        )
        .unwrap()
    }
    /// The base line just fits; the active word at 24 px no longer does.
    fn snug(max_lines: usize, overflow: &str) -> ScenePlan {
        let wide = plan(1000.0, 3, "visible");
        let width = wide.layouts.values().next().unwrap().pages[0].lines[0]
            .shape
            .width;
        plan(width + 2.0, max_lines, overflow)
    }
    fn lines(plan: &mut ScenePlan, t: f64) -> Result<Vec<String>> {
        let cue = &plan.cues[0];
        let params = cue_parameters(&plan.style, &plan.presentation, cue, &plan.instance_id)?;
        let mut budget = Budget::default();
        let early = sampled_layout::early_context(
            cue,
            0,
            1,
            t,
            &params,
            (320, 180),
            &plan.instance_id,
            &plan.presentation.seed,
        )?;
        let sampled = sampled_layout::sample_scene(plan.style.scene(), &early, t, &mut budget)?;
        let scene = sampled.as_ref().unwrap_or(plan.style.scene());
        let units = resolved_units(
            &mut plan.text,
            &plan.layouts,
            0,
            cue,
            scene,
            sampled.is_some(),
            t,
            &params,
            &plan.presentation,
            &plan.instance_id,
            (320, 180),
            &mut budget,
        )?;
        let content = &plan.layouts.values().next().unwrap().content;
        Ok(units["caption"]
            .iter()
            .filter(|(unit, _)| unit.kind == UnitKind::Line)
            .map(|(unit, _)| content[unit.bytes.clone()].trim().to_string())
            .collect())
    }

    #[test]
    fn a_growing_word_pushes_neighbours_down_and_back_on_the_same_page() {
        let mut plan = snug(3, "visible");
        let base = plan.layouts.values().next().unwrap();
        assert_eq!((base.pages.len(), base.pages[0].lines.len()), (1, 1));
        assert_eq!(lines(&mut plan, 0.5).unwrap(), ["Alpha beta", "gamma"]);
        assert_eq!(lines(&mut plan, 3.5).unwrap(), ["Alpha beta gamma"]);
        let base = plan.layouts.values().next().unwrap();
        assert_eq!((base.pages.len(), base.pages[0].words.len()), (1, 3));
        assert!(plan.render(0.5).is_ok());
    }

    #[test]
    fn extra_lines_follow_the_declared_overflow() {
        let mut plan = snug(1, "error");
        assert_eq!(lines(&mut plan, 3.5).unwrap(), ["Alpha beta gamma"]);
        let error = lines(&mut plan, 0.5).unwrap_err().to_string();
        assert!(
            error.contains("CAPTION_LAYOUT_OVERFLOW: unit font reflow lines"),
            "{error}"
        );
    }
}
