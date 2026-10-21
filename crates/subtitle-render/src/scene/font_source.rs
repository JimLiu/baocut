//! Resolve immutable source faces before any layout, shaping or line metrics.
use anyhow::Result;
use caption_scene::{Node, SceneSource, SceneStyle};
use render_raster::fonts::TextEngine;

pub(super) fn bind(style: &mut SceneStyle, text: &mut TextEngine) -> Result<()> {
    fn bind_nodes(nodes: &mut [Node], text: &mut TextEngine) -> Result<()> {
        for node in nodes {
            if let Some(source) = &node.style.font_source {
                node.style.font_family = text.resolve_font_source(&source.sha256, source.face_index)?;
            }
            bind_nodes(&mut node.children, text)?;
        }
        Ok(())
    }
    let SceneSource::Inline { value: scene } = &mut style.scene;
    bind_nodes(&mut scene.nodes, text)?;
    for binding in &mut scene.layout.font_style_bindings {
        if let Some(source) = &binding.style.font_source {
            binding.style.font_family = Some(text.resolve_font_source(&source.sha256, source.face_index)?);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use caption_scene::parse_style;
    use serde_json::json;
    use sha2::{Digest, Sha256};

    #[test]
    fn binds_exact_text_face_before_shaping() {
        let bytes = include_bytes!("../../../render-raster/assets/fonts/VKSans-400.ttf").to_vec();
        let digest: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        let mut body: serde_json::Value =
            serde_json::from_str(include_str!("../../../caption-scene/tests/fixtures/word-pop.json")).unwrap();
        body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-font-source/1"));
        let source = json!({"sha256":digest,"faceIndex":0});
        body["scene"]["value"]["nodes"][0]["style"]["fontSource"] = source.clone();
        let mut style = parse_style(&body).unwrap();
        let mut text = TextEngine::with_document_fonts(&[bytes]);
        bind(&mut style, &mut text).unwrap();
        let family = &style.scene().nodes[0].style.font_family;
        assert!(family.starts_with("__baocut_font_source_"));
        let line = text.shape("AVA", family, 40., 400);
        assert!(!line.glyphs.is_empty());
        for glyph in line.glyphs {
            let face = text.font_system.db().face(glyph.cache_key.font_id).unwrap();
            assert_eq!(face.index, 0);
            let cosmic_source = &face.source;
            text.font_system
                .db()
                .with_face_data(face.id, |bytes, _| {
                    let actual: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
                    assert_eq!(actual, digest);
                })
                .unwrap();
            let _ = cosmic_source;
        }
    }

    #[test]
    fn compile_rejects_unregistered_source_instead_of_family_fallback() {
        let mut body: serde_json::Value =
            serde_json::from_str(include_str!("../../../caption-scene/tests/fixtures/word-pop.json")).unwrap();
        body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-font-source/1"));
        body["scene"]["value"]["nodes"][0]["style"]["fontSource"] = json!({"sha256":"0".repeat(64)});
        let result = super::super::ScenePlan::compile(
            parse_style(&body).unwrap(),
            Default::default(),
            vec![],
            (160, 90),
            TextEngine::with_document_fonts(&[include_bytes!("../../../render-raster/assets/fonts/VKSans-400.ttf").to_vec()]),
            "probe".into(),
        );
        assert!(
            result
                .err()
                .unwrap()
                .to_string()
                .contains("FONT_SOURCE_UNREGISTERED_OR_FACE_MISSING")
        );
    }

    fn digest(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    fn glyph_digest(text: &TextEngine, glyph: &render_raster::fonts::ShapedGlyph) -> String {
        let face = text.font_system.db().face(glyph.cache_key.font_id).unwrap();
        assert_eq!(face.index, 0, "synthetic fixture must use the referenced face index");
        text.font_system
            .db()
            .with_face_data(face.id, |bytes, index| {
                assert_eq!(index, 0);
                digest(bytes)
            })
            .unwrap()
    }

    fn outlines(text: &mut TextEngine, line: &render_raster::fonts::ShapedLine) -> Vec<render_raster::drawop::PathData> {
        line.glyphs
            .iter()
            .map(|glyph| {
                let render_raster::fonts::GlyphRender::Outline(path) = text.glyph_render(glyph.cache_key) else {
                    panic!("synthetic Latin fixture must produce an actual glyph outline");
                };
                render_raster::drawop::path_from_skia(&path)
            })
            .collect()
    }

    fn plan(body: serde_json::Value, text: TextEngine, content: &str) -> super::super::ScenePlan {
        super::super::ScenePlan::compile(
            parse_style(&body).unwrap(),
            Default::default(),
            vec![super::super::SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                text: content.into(),
                start: 0.,
                end: 4.,
                words: vec![],
            }],
            (160, 90),
            text,
            "source-font-probe".into(),
        )
        .unwrap()
    }

    #[test]
    fn source_only_label_records_glyph_outlines_from_the_exact_font_bytes() {
        let ordinary = include_bytes!("../../../render-raster/assets/fonts/Arimo.ttf").to_vec();
        let source = include_bytes!("../../../render-raster/assets/fonts/VKSans-400.ttf").to_vec();
        let source_digest = digest(&source);
        let source_family = render_raster::fonts::font_data_faces(source.clone())[0].families[0].clone();
        let ordinary_family = render_raster::fonts::font_data_faces(ordinary.clone())[0].families[0].clone();
        let mut engine = TextEngine::with_document_fonts(&[ordinary]);
        engine.add_font_sources(vec![std::sync::Arc::new(source)]).unwrap();
        assert!(!engine.has_family(&source_family));
        let mut body: serde_json::Value =
            serde_json::from_str(include_str!("../../../caption-scene/tests/fixtures/bound-label.json")).unwrap();
        let scene = &mut body["scene"]["value"];
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-font-source/1"));
        scene["nodes"].as_array_mut().unwrap().truncate(2);
        scene["animations"] = json!([]);
        scene["nodes"][0]["style"]["fontFamily"] = json!(ordinary_family);
        scene["nodes"][0]["properties"] = json!({"opacity":{"kind":"constant","value":0}});
        let label = &mut scene["nodes"][1]["children"][0];
        label["text"]["text"] = json!("AVA");
        label["properties"] = json!({});
        label["style"]["fontFamily"] = json!(ordinary_family);
        label["style"]["fontWeight"] = json!(400);
        label["style"]["fontSize"] = json!({"value":12,"basis":"absolute"});
        label["style"]["fontSource"] = json!({"sha256":source_digest,"faceIndex":0});
        let mut rendered = plan(body, engine, "One two");
        let resolved = rendered.style.scene().nodes[1].children[0].style.clone();
        assert!(resolved.font_family.starts_with("__baocut_font_source_"));
        let actual_shape = rendered.text.shape_spaced("AVA", &resolved.font_family, 12., 400, false, 0.);
        assert_eq!(actual_shape.glyphs.len(), 3, "all synthetic label glyphs must be shaped");
        for glyph in &actual_shape.glyphs {
            assert_eq!(glyph_digest(&rendered.text, glyph), source_digest);
        }
        let expected_paths = outlines(&mut rendered.text, &actual_shape);
        let ordinary_shape = rendered.text.shape("AVA", &ordinary_family, 12., 400);
        let ordinary_paths = outlines(&mut rendered.text, &ordinary_shape);
        assert_ne!(
            expected_paths, ordinary_paths,
            "fixture must distinguish source binding from the displayed ordinary family"
        );
        for seconds in [0.2, 2.2, 0.2] {
            let (frame, _) = rendered.record(seconds).unwrap();
            let actual_paths: Vec<_> = frame
                .ops
                .iter()
                .filter_map(|op| match op {
                    render_raster::drawop::DrawOp::FillPath { path, .. } | render_raster::drawop::DrawOp::FillPathPaint { path, .. } => {
                        Some(frame.paths[*path as usize].clone())
                    }
                    _ => None,
                })
                .collect();
            // The hidden reference Text records its zero-opacity paths before the Label.
            // The final three glyph operations belong to the only visible Label in this fixture.
            assert!(actual_paths.len() >= expected_paths.len());
            assert_eq!(
                &actual_paths[actual_paths.len() - expected_paths.len()..],
                expected_paths.as_slice(),
                "Label recording must use the glyphs whose font bytes were verified"
            );
        }
        assert!(
            !rendered.text.has_family(&source_family),
            "referencing a label source cannot expose its public family"
        );
    }

    #[test]
    fn later_named_family_binding_restores_actual_glyphs_after_a_source_patch() {
        let ordinary = include_bytes!("../../../render-raster/assets/fonts/VKSans-400.ttf").to_vec();
        let other = include_bytes!("../../../render-raster/assets/fonts/Arimo.ttf").to_vec();
        let ordinary_digest = digest(&ordinary);
        let other_digest = digest(&other);
        let family = render_raster::fonts::font_data_faces(ordinary.clone())[0].families[0].clone();
        let mut engine = TextEngine::with_document_fonts(&[ordinary]);
        engine.add_font_sources(vec![std::sync::Arc::new(other)]).unwrap();
        let mut body: serde_json::Value =
            serde_json::from_str(include_str!("../../../caption-scene/tests/fixtures/unit-font-size.json")).unwrap();
        let scene = &mut body["scene"]["value"];
        scene["requiredCapabilities"].as_array_mut().unwrap().extend([
            json!("caption-font-source/1"),
            json!("caption-unit-font-style/1"),
            json!("caption-layout-per-sample/1"),
        ]);
        scene["nodes"][0]["style"]["fontFamily"] = json!(family);
        scene["nodes"][0]["style"]["fontWeight"] = json!(400);
        scene["nodes"][0]["style"]["fontSource"] = json!({"sha256":ordinary_digest});
        scene["layout"]["fontSizeBindings"] = json!([]);
        scene["layout"]["pagination"] = json!({"unit":"word","wordLinePattern":[[2]]});
        scene["selectors"] = json!([
            {"id":"pages","nodeId":"caption","unit":"page"},
            {"id":"first-word","nodeId":"caption","unit":"word","filter":{"kind":"range","start":0,"end":1}},
        ]);
        scene["layout"]["fontStyleBindings"] = json!([
            {"id":"source-face","nodeId":"caption","selectorId":"pages","style":{"fontSource":{"sha256":other_digest}}},
            {"id":"source-weight","nodeId":"caption","selectorId":"pages","style":{"fontWeight":400,"italic":false}},
            {"id":"ordinary-first-word","nodeId":"caption","selectorId":"first-word","style":{"fontFamily":family}},
        ]);
        let mut rendered = plan(body, engine, "AVA AVA");
        let mut first_snapshot = None;
        for seconds in [0.2, 2.2, 0.2] {
            let cue = &rendered.cues[0];
            let params = super::super::cue_parameters(&rendered.style, &rendered.presentation, cue, &rendered.instance_id).unwrap();
            let units = super::super::resolved_units(
                &mut rendered.text,
                &rendered.layouts,
                0,
                cue,
                rendered.style.scene(),
                true,
                seconds,
                &params,
                &rendered.presentation,
                &rendered.instance_id,
                (160, 90),
                &mut super::super::Budget::default(),
            )
            .unwrap()
            .remove("caption")
            .unwrap();
            let line = units.iter().find_map(|(_, line)| line.as_ref()).unwrap();
            let mut counts = [0, 0];
            let mut snapshot = Vec::new();
            for glyph in &line.shape.glyphs {
                let at = line.bytes.start + glyph.cluster.start;
                let actual_digest = glyph_digest(&rendered.text, glyph);
                if at < 3 {
                    assert_eq!(
                        actual_digest, ordinary_digest,
                        "later family patch must restore the ordinary family's actual face"
                    );
                    counts[0] += 1;
                } else if at >= 4 {
                    assert_eq!(
                        actual_digest, other_digest,
                        "weight/italic-only patch must preserve the explicitly selected source face"
                    );
                    counts[1] += 1;
                }
                snapshot.push((at, actual_digest));
            }
            assert_eq!(counts, [3, 3], "both declared words must contain actual glyphs");
            if let Some(previous) = &first_snapshot {
                assert_eq!(
                    &snapshot, previous,
                    "seek cannot retain an earlier source patch over a named family"
                );
            } else {
                first_snapshot = Some(snapshot);
            }
            let frame = rendered.render(seconds).unwrap();
            assert!(
                frame.rgba.chunks_exact(4).any(|p| p[3] != 0),
                "source/family typography must actually render"
            );
        }
    }

    #[test]
    fn source_only_registry_keeps_named_family_hidden_but_sha_reference_shapes_real_glyphs() {
        let ordinary = include_bytes!("../../../render-raster/assets/fonts/VKSans-400.ttf").to_vec();
        let hidden = include_bytes!("../../../render-raster/assets/fonts/Arimo.ttf").to_vec();
        let hidden_digest = digest(&hidden);
        let hidden_family = render_raster::fonts::font_data_faces(hidden.clone())[0].families[0].clone();
        let mut text = TextEngine::with_document_fonts(&[ordinary]);
        assert!(!text.has_family(&hidden_family));
        let before = text.shape("AVA", &hidden_family, 40., 400);
        let ordinary_before: Vec<_> = before.glyphs.iter().map(|g| glyph_digest(&text, g)).collect();
        assert_eq!(ordinary_before.len(), 3);
        assert!(ordinary_before.iter().all(|d| d != &hidden_digest));
        text.add_font_sources(vec![std::sync::Arc::new(hidden)]).unwrap();
        assert!(
            !text.has_family(&hidden_family),
            "source registration must not register a public family"
        );
        let alias = text.resolve_font_source(&hidden_digest, 0).unwrap();
        let explicit = text.shape("AVA", &alias, 40., 400);
        assert_eq!(explicit.glyphs.len(), 3);
        for glyph in &explicit.glyphs {
            assert_eq!(glyph_digest(&text, glyph), hidden_digest);
        }
        assert!(
            !text.has_family(&hidden_family),
            "private source-face resolution must leave public family matching unchanged"
        );
        let after = text.shape("AVA", &hidden_family, 40., 400);
        let ordinary_after: Vec<_> = after.glyphs.iter().map(|g| glyph_digest(&text, g)).collect();
        assert_eq!(
            ordinary_after, ordinary_before,
            "warm ordinary request cannot be redirected to source-only bytes"
        );
        assert_eq!(after.width, before.width);
    }
}
