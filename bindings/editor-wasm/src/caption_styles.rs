//! Template caption styles for the editor (caption editor design §6): the scene summary the
//! adjust page, gallery tags and fit checks read, so the UI never walks the expression tree.
use crate::{EntryError, invalid_input};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SummaryInput {
    /// A `baocut.caption-scene-style/1` body; its `adjust` fills the summary's `to` values.
    body: serde_json::Value,
}

/// `{ body }` → `CaptionSceneSummary`. A body that is not a valid scene style is `INVALID_STYLE`.
pub fn caption_scene_summary(input: &[u8]) -> Result<String, EntryError> {
    let input: SummaryInput = serde_json::from_slice(input).map_err(invalid_input)?;
    let style = caption_scene::parse_style(&input.body).map_err(|error| EntryError {
        code: "INVALID_STYLE",
        message: error.to_string(),
    })?;
    let summary = caption_scene::describe(style.scene(), style.adjust.as_ref());
    Ok(serde_json::to_string(&summary).expect("summary serializes"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_reads_the_body_adjust_and_rejects_other_styles() {
        let mut body: serde_json::Value =
            serde_json::from_str(include_str!("../../../crates/caption-scene/tests/fixtures/word-pop.json")).unwrap();
        body["adjust"] = serde_json::json!({ "fontScale": 1.5 });
        let input = serde_json::to_vec(&serde_json::json!({ "body": body })).unwrap();
        let summary: serde_json::Value = serde_json::from_str(&caption_scene_summary(&input).unwrap()).unwrap();
        assert!(summary["colors"].is_array() && summary["adjustable"]["fontScale"] == true);

        let studio =
            serde_json::to_vec(&serde_json::json!({ "body": { "schema": "baocut.legacy-studio-style/0.1", "style": {} } })).unwrap();
        assert_eq!(caption_scene_summary(&studio).unwrap_err().code, "INVALID_STYLE");
        assert_eq!(caption_scene_summary(b"{}").unwrap_err().code, "INVALID_INPUT");
    }
}
