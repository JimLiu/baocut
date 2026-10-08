// overlay 内核的单元测试，随内核一起从 `core/crates/bcut-kernel/src/cmd/studio_export/tests.rs`
// 搬来（主方案 D2）。
//
// 切分轴线是**是否需要 `OverlayHost`**，不是「是否属于字幕」：
// `OverlayRenderPlan::compile*` 只吃一份内存里的 Studio 正文，纯函数，测试留这里；
// `compile_project*` / `load_overlay_document` 第一步就要 `studio_timeline_projection`
// （时间轴投影 + 词时钟 + HistoryStore rev），那是注入项，真实现在 CLI，
// 于是这些测试连同 `motion_baseline_tests` 一起留在 `cargo test -p bcut`。
// 在 crate 里给它们造一个假 host 会正好变成本 crate 明令禁止的第二份实现。
//
// 少数夹具 helper（document / style_document 等）两边都要用，两侧各留一份：
// 它们是 JSON 字面量，不是第二份实现。
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sha2::{Digest, Sha256};

    /// sha2 0.11 的摘要（hybrid-array）没有 `LowerHex`：逐字节写出，与 v2 的 `{:x}` 同值。
    fn lower_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// 合成 token：汉字与全角标点宽 1 个字号，其余 0.55 个字号；不走字体，只测断点算法。
    fn synthetic_tokens(text: &str, font_size: f64) -> Vec<(String, LayoutToken)> {
        text.split_word_bounds()
            .map(|piece| {
                let width = piece
                    .chars()
                    .map(|c| {
                        if is_cjk_char(c) {
                            font_size
                        } else {
                            0.55 * font_size
                        }
                    })
                    .sum::<f64>();
                let chunk = GlyphChunk {
                    text: piece.to_owned(),
                    word: None,
                    part: None,
                    width,
                    font_name: String::new(),
                    font_size,
                    font_weight: 400,
                    italic: false,
                    shaped: Default::default(),
                };
                let token = if piece == "\n" {
                    LayoutToken::HardBreak
                } else if piece.trim().is_empty() {
                    LayoutToken::Space(chunk)
                } else {
                    LayoutToken::Glyph(piece.to_owned(), chunk)
                };
                (piece.to_owned(), token)
            })
            .collect()
    }

    fn broken_lines(text: &str, chars_per_line: f64) -> Vec<String> {
        let tokens = synthetic_tokens(text, 10.0);
        let (texts, tokens): (Vec<_>, Vec<_>) = tokens.into_iter().unzip();
        let breaks = cjk_line_breaks(&tokens, chars_per_line * 10.0, 10.0);
        let mut lines = vec![String::new()];
        for (index, piece) in texts.iter().enumerate() {
            if breaks.contains(&index) {
                lines.push(String::new());
            }
            lines.last_mut().unwrap().push_str(piece);
        }
        lines
            .into_iter()
            .map(|line| line.trim().to_owned())
            .collect()
    }

    fn greedy_line_count(text: &str, chars_per_line: f64) -> usize {
        let mut count = 1;
        let mut used = 0.0;
        let mut pending = 0.0;
        for (_, token) in synthetic_tokens(text, 10.0) {
            match token {
                LayoutToken::Space(chunk) => {
                    if used > 0.0 {
                        pending += chunk.width;
                    }
                }
                LayoutToken::Glyph(_, chunk) => {
                    if used > 0.0 && used + pending + chunk.width > chars_per_line * 10.0 {
                        count += 1;
                        used = 0.0;
                    } else {
                        used += pending;
                    }
                    pending = 0.0;
                    used += chunk.width;
                }
                LayoutToken::HardBreak => unreachable!(),
            }
        }
        count
    }

    #[test]
    fn cjk_breaks_keep_kinsoku_units_and_balance_without_extra_lines() {
        // 三期播客实测里折坏的句子（利/益、10/亿、1870/年代、行首「：？」、孤字尾行）。
        let sentences = [
            "这就是问题所在：我们到底应该如何去衡量利益？还是说根本就无法衡量",
            "1870年代的铁路泡沫破裂之后，大家又花了10亿美元去建设新的网络",
            "ChatGPT 发布之后 所有人都在问：这个东西到底能不能真正赚钱？",
            "他说：「我们必须先解决自己的问题」，然后才能谈合作、谈发布、谈超越。",
            "用 GPT-4 做的实验 比原来快了200倍 便宜了400倍",
        ];
        // 标点禁则总能靠挪一个字满足，逐例必守；数字连单位、拉丁串不拆、不留孤字是软约束，
        // 行数卡死时（三行刚好装满）允许让步，只要求整轮扫下来是少数。
        let (mut soft, mut cases) = (0, 0);
        for text in sentences {
            for tenths in 60..=200 {
                let per_line = f64::from(tenths) / 10.0;
                let lines = broken_lines(text, per_line);
                let context = format!("{per_line}: {lines:?}");
                assert_eq!(lines.concat().replace(' ', ""), text.replace(' ', ""));
                assert!(
                    lines.len() <= greedy_line_count(text, per_line),
                    "{context}"
                );
                cases += 1;
                let mut bent = false;
                for (index, line) in lines.iter().enumerate() {
                    bent |= lines.len() > 1 && line.chars().count() == 1;
                    if index == 0 {
                        continue;
                    }
                    let first = line.chars().next().unwrap();
                    let prev = lines[index - 1].chars().next_back().unwrap();
                    assert!(!cannot_start_line(first), "{context}");
                    assert!(!cannot_end_line(prev), "{context}");
                    bent |= prev.is_ascii_digit() && is_han(first);
                    bent |= prev.is_ascii_alphanumeric() && first.is_ascii_alphanumeric();
                }
                soft += usize::from(bent);
            }
        }
        assert!(
            soft * 20 <= cases,
            "{soft} of {cases} layouts bent a soft rule"
        );
        // 两行时落在停顿处而不是填满第一行：隐藏逗号留下的空格、问号之后。
        assert_eq!(
            broken_lines("ChatGPT 发布之后 所有人都在问这件事", 12.0),
            ["ChatGPT 发布之后", "所有人都在问这件事"]
        );
        assert_eq!(
            broken_lines("我们到底应该如何衡量？还是说根本无法衡量", 12.0),
            ["我们到底应该如何衡量？", "还是说根本无法衡量"]
        );
        // 译文里数字与单位之间带空格（「10 亿」）：空格不算停顿，照样不拆（播客复验里折成「10 / 亿」）。
        // 同样是软约束：只有不拆就得多折一行时才让步。
        let text = "用户始终不到 10 亿 差不多就是这样？";
        let split = |lines: &[String]| {
            lines
                .windows(2)
                .any(|pair| pair[0].ends_with("10") && pair[1].starts_with('亿'))
        };
        assert_eq!(
            broken_lines(text, 11.0),
            ["用户始终不到 10 亿", "差不多就是这样？"]
        );
        let bent = (60..=200)
            .filter(|tenths| split(&broken_lines(text, f64::from(*tenths) / 10.0)))
            .count();
        assert!(bent * 20 <= 141, "{bent} of 141 widths split 10 / 亿");
    }

    #[test]
    fn text_without_cjk_is_not_rebalanced() {
        assert!(
            !"towards models that can really help"
                .chars()
                .any(is_cjk_char)
        );
        assert!(!"한국어 자막".chars().any(is_cjk_char));
    }

    /// 节点的可比较投影：只看类型与关键几何，避免把 `Arc` 地址写进断言。
    fn scene_node_shapes(nodes: &[element_draw::SceneNode]) -> Vec<String> {
        nodes
            .iter()
            .map(|node| match node {
                element_draw::SceneNode::Texture(texture) => format!(
                    "texture:{}:{}:{:?}",
                    texture.texture, texture.media_ms, texture.rect
                ),
                other => format!("{other:?}"),
            })
            .collect()
    }

    fn document(animation: &str, transition: &str) -> Value {
        json!({
            "meta": {"duration": 3.0},
            "style": {
                "mode": "orig", "fontFamily": "montserrat", "fontSize": 30,
                "fontColor": "#FFFFFF", "bold": true, "outline": true,
                "background": true, "backgroundColor": "#000000B3",
                "backgroundPadding": 10, "lineHeight": 1.2,
                "x": 50, "y": 86, "width": 80, "scale": 1, "rotation": 0,
                "wordAnimation": {"animationName": animation},
                "transition": {"transitionId": transition, "transitionSpeed": 50},
                "displayTiming": {"leadIn": 0.5, "tail": 1.0}
            },
            "cues": [{
                "id": "q1", "start": 0.5, "end": 2.5, "text": "Hello world",
                "words": [
                    {"text": "Hello", "t0": 0.5, "t1": 1.2},
                    {"text": "world", "t0": 1.3, "t1": 2.5}
                ]
            }],
            "sentences": [], "transCues": []
        })
    }

    /// 「预览 = 导出」的最小可证形式（主方案 M1-R3）。
    ///
    /// App v2 走 [`OverlayRenderPlan::render_rgba_frame`] 直接上传 premultiplied
    /// RGBA，serve 走 [`OverlayRenderPlan::render_png`] 发 PNG。两条路必须是
    /// 同一帧的两种封装：PNG 解出来的像素与 RGBA 缓冲区逐字节相同，三个身份
    /// （字幕内容键 / DrawOp 指纹 / 下一次变化时刻）也必须一致。
    ///
    /// 这里刻意用 `compile`（吃内存里的正文，不碰项目投影），所以断言不依赖
    /// 任何 host 注入，纯内核对拍。
    #[test]
    fn render_png_is_the_encoded_form_of_render_rgba_frame() {
        let document = document("Karaoke", "fade");
        let mut plan = OverlayRenderPlan::compile(&document, 320, 180, 3.0, 30.0, None).unwrap();

        // 逐词动画里取三个时刻：入场前、第一词高亮中、第二词高亮中。
        for time in [0.4, 0.9, 1.8] {
            let rgba = plan.render_rgba_frame(time).unwrap();
            let png = plan.render_png(time).unwrap();

            assert_eq!(rgba.width, 320);
            assert_eq!(rgba.height, 180);
            assert_eq!(
                rgba.rgba.len(),
                320 * 180 * 4,
                "t={time}：RGBA 缓冲区长度必须是 width * height * 4"
            );

            let decoded = Pixmap::decode_png(&png.png).unwrap();
            assert_eq!(decoded.width(), rgba.width, "t={time}");
            assert_eq!(decoded.height(), rgba.height, "t={time}");
            assert_eq!(
                decoded.data(),
                rgba.rgba.as_slice(),
                "t={time}：PNG 解码后的像素与 render_rgba_frame 不同，\
                 说明两个入口没走同一条渲染路径"
            );

            assert_eq!(png.subtitle_key, rgba.subtitle_key, "t={time}：字幕内容键");
            assert_eq!(
                png.draw_op_fingerprint, rgba.draw_op_fingerprint,
                "t={time}：DrawOp 指纹"
            );
            assert_eq!(
                png.next_change, rgba.next_change,
                "t={time}：下一次变化时刻"
            );
        }
    }

    #[test]
    fn mac_style_picker_fonts_are_loaded_by_video_burn_in() {
        let mut plan =
            OverlayRenderPlan::compile(&document("None", "none"), 320, 180, 3.0, 30.0, None)
                .unwrap();
        for family in [
            "Alata",
            "Archivo Black",
            "Bangers",
            "Carter One",
            "Dancing Script",
            "Fredoka One",
            "Paytone One",
            "Permanent Marker",
            "Press Start 2P",
            "VK Sans",
            "VK Code",
        ] {
            assert!(
                plan.text.has_family(family),
                "Mac 内置字体 {family:?} 不应在 MP4 导出中回退"
            );
        }
        let archivo = plan.text.shape("BaoCut", "Archivo Black", 36.0, 400);
        let fallback = plan.text.shape("BaoCut", "Noto Sans SC", 36.0, 400);
        assert_ne!(
            archivo.glyphs.first().map(|glyph| glyph.cache_key.font_id),
            fallback.glyphs.first().map(|glyph| glyph.cache_key.font_id),
            "Archivo Black 应使用自己的字形，而不是 Noto fallback"
        );
        assert_eq!(
            font_name(&json!({"fontFamily": "Source Sans 3"})),
            "VK Sans"
        );
        assert_eq!(
            font_name(&json!({"fontFamily": "Source Code Pro"})),
            "VK Code"
        );
    }

    #[test]
    fn latin_display_families_fall_back_to_weighted_noto_for_cjk_glyphs() {
        let mut plan =
            OverlayRenderPlan::compile(&document("None", "none"), 320, 180, 3.0, 30.0, None)
                .unwrap();
        let display = plan.text.shape("中文", "Anton", 36.0, 800);
        let noto = plan.text.shape("中文", "Noto Sans SC", 36.0, 800);
        let regular = plan.text.shape("中文", "Anton", 36.0, 400);
        let mixed = plan.text.shape("A中", "Anton", 36.0, 800);
        let latin = plan.text.shape("A", "Anton", 36.0, 800);
        assert!(!display.glyphs.is_empty());
        assert_eq!(display.glyphs.len(), noto.glyphs.len());
        for (fallback, direct) in display.glyphs.iter().zip(&noto.glyphs) {
            assert_eq!(fallback.cache_key.font_id, direct.cache_key.font_id);
            assert_eq!(fallback.cache_key.font_weight.0, 800);
        }
        assert!(
            regular
                .glyphs
                .iter()
                .all(|glyph| glyph.cache_key.font_weight.0 == 400)
        );
        assert_eq!(mixed.glyphs.len(), 2);
        assert_eq!(
            mixed.glyphs[0].cache_key.font_id,
            latin.glyphs[0].cache_key.font_id
        );
        assert_eq!(
            mixed.glyphs[1].cache_key.font_id,
            noto.glyphs[0].cache_key.font_id
        );
    }

    #[test]
    fn injected_font_compile_is_strict_and_does_not_load_the_bundled_catalog() {
        let fonts = vec![include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec()];
        let plan = OverlayRenderPlan::compile_with_injected_fonts(
            &document("None", "none"),
            320,
            180,
            3.0,
            30.0,
            None,
            OverlayIncludes::ALL,
            fonts,
        )
        .unwrap();
        assert!(plan.text.strict);
        assert_eq!(plan.fonts_loaded, 1);
        assert!(plan.text.has_family("Noto Sans SC"));
        assert!(!plan.text.has_family("Montserrat"));

        let error = OverlayRenderPlan::compile_with_injected_fonts(
            &document("None", "none"),
            320,
            180,
            3.0,
            30.0,
            None,
            OverlayIncludes::ALL,
            Vec::new(),
        )
        .err()
        .expect("空字体列表必须拒绝")
        .to_string();
        assert!(error.contains("fallback 字体"), "{error}");
    }

    #[test]
    fn subtitle_scene_static_fallback_accepts_plain_underlines_in_both_lines() {
        let source = document("None", "none");
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.mode = StudioMode::Translated;
        plan.original_style.underline = true;
        assert_eq!(plan.subtitle_scene_static_fallback(), None);
        plan.translation_style.underline = true;
        assert_eq!(plan.subtitle_scene_static_fallback(), None);
    }

    #[test]
    fn video_burn_in_loads_only_registered_baocut_font_files() {
        let temp = tempfile::tempdir().unwrap();
        let fonts = temp.path().join("fonts");
        fs::create_dir_all(&fonts).unwrap();
        fs::write(
            fonts.join("lf-alata.ttf"),
            include_bytes!("../../render-raster/assets/fonts/Alata-Regular.ttf"),
        )
        .unwrap();
        fs::write(fonts.join("orphan.ttf"), b"not a registered font").unwrap();
        fs::write(
            fonts.join("library.json"),
            serde_json::to_vec(&json!([
                {"family":"Alata","file":"lf-alata.ttf"},
                {"family":"escape","file":"../outside.ttf"},
                {"family":"duplicate","file":"lf-alata.ttf"}
            ]))
            .unwrap(),
        )
        .unwrap();

        let loaded = font_library_fonts_at(&fonts);
        assert_eq!(loaded.len(), 1);
        let engine = TextEngine::with_document_fonts(&loaded);
        assert!(engine.has_family("Alata"));
    }

    #[test]
    fn overlay_items_follow_cut_clip_reuse_rate_and_multisource_clock() {
        let timeline: timeline::TimelineDocument = serde_json::from_value(json!({
            "bcutTimeline": "0.1",
            "sources": {
                "main": {"cuts": [{"id": "cut-1", "t0": 1.0, "t1": 2.0}]},
                "insert": {"path": "insert.mp4", "kind": "video", "duration": 2.0}
            },
            "clips": [
                {"id": "c1", "in": 0.0, "out": 4.0},
                {"id": "c2", "srcId": "insert", "in": 0.0, "out": 2.0, "rate": 2.0}
            ]
        }))
        .unwrap();
        let projection = timeline::TimelineProjection::build(
            &timeline,
            &std::collections::BTreeMap::from([
                ("main".to_owned(), 4.0),
                ("insert".to_owned(), 2.0),
            ]),
        )
        .unwrap();
        let mut document = json!({
            "meta": {"duration": 4.0},
            "cues": [{
                "id": "q-main", "start": 0.0, "end": 4.0, "text": "A CUT B",
                "words": [
                    {"id": "w1", "text": "A", "t0": 0.0, "t1": 1.0},
                    {"id": "w2", "text": "CUT", "t0": 1.0, "t1": 2.0},
                    {"id": "w3", "text": "B", "t0": 2.0, "t1": 3.0}
                ]
            }],
            "sentences": [],
            "transCues": [{"id": "s-main#0", "sid": "s-main", "kind": "piece",
                "start": 0.5, "end": 2.5, "text": "VISIBLE"}],
            "sourceDocs": {
                "main": {"cues": [], "sentences": [], "transCues": []},
                "insert": {"cues": [{
                    "id": "q-insert", "start": 0.0, "end": 2.0, "text": "INSERT",
                    "words": [{"id": "wi", "text": "INSERT", "t0": 0.0, "t1": 2.0}]
                }], "sentences": [], "transCues": []}
            }
        });
        project_overlay_timed_items(&mut document, &projection);
        let cues = document["cues"].as_array().unwrap();
        assert_eq!(document["meta"]["duration"], 4.0);
        assert_eq!(cues.len(), 3);
        assert_eq!(
            (cues[0]["start"].as_f64(), cues[0]["end"].as_f64()),
            (Some(0.0), Some(1.0))
        );
        assert_eq!(cues[0]["text"], "A");
        assert_eq!(
            (cues[1]["start"].as_f64(), cues[1]["end"].as_f64()),
            (Some(1.0), Some(3.0))
        );
        assert_eq!(cues[1]["text"], "B");
        assert_eq!(cues[1]["words"][0]["t0"], 1.0);
        assert_eq!(cues[1]["words"][0]["t1"], 2.0);
        assert_eq!(cues[2]["sourceId"], "insert");
        assert_eq!(
            (cues[2]["start"].as_f64(), cues[2]["end"].as_f64()),
            (Some(3.0), Some(4.0))
        );
        assert_eq!(cues[2]["words"][0]["t1"], 4.0);
        let translated = document["transCues"].as_array().unwrap();
        assert_eq!(translated.len(), 1);
        assert_eq!(translated[0]["text"], "VISIBLE");
        assert_eq!(
            (
                translated[0]["start"].as_f64(),
                translated[0]["end"].as_f64()
            ),
            (Some(0.5), Some(1.5))
        );
    }

    #[test]
    fn parses_css_alpha_into_internal_transparency() {
        let color = parse_css_color("#11223380").unwrap();
        assert_eq!(
            (color.r, color.g, color.b, color.a),
            (0x11, 0x22, 0x33, 0x7f)
        );
    }

    #[test]
    fn main_place_transforms_the_native_bgra_before_overlay_compositing() {
        let mut pixels = vec![0_u8; 8 * 4 * 4];
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.copy_from_slice(&[0, 0, 255, 255]);
        }
        let main: Main = serde_json::from_value(json!({
            "place": {"x": 75, "y": 50, "scale": 0.5},
            "background": "black"
        }))
        .unwrap();
        apply_main_transform_bgra(&mut pixels, 8 * 4, 8, 4, Some(&main)).unwrap();
        let pixel = |x: usize, y: usize| &pixels[(y * 8 + x) * 4..(y * 8 + x + 1) * 4];
        assert_eq!(pixel(0, 2), &[0, 0, 0, 255]);
        assert!(pixel(5, 2)[2] > 200);
        assert_eq!(pixel(7, 0), &[0, 0, 0, 255]);
    }

    /// `place.opacity = 0` + 黑底是**普通项目导出的每一帧**：媒体被搬到时间轴
    /// （`main.detached`）之后，main 层就是靠它隐藏的。这一档在 `raster.rs` 里
    /// 走按行填黑的短路，绕开整条 tiny-skia 通路（实测 249 ms/帧 → ~0）。
    /// 这里钉住短路的两个契约：输出是一张不透明纯黑底，且不越界写 stride 的
    /// 行尾填充。
    #[test]
    fn opacity_zero_on_black_background_yields_an_opaque_black_frame() {
        let stride = 8 * 4 + 12;
        let mut pixels = vec![0_u8; stride * 4];
        for row in 0..4 {
            for column in 0..8 {
                pixels[row * stride + column * 4..row * stride + column * 4 + 4]
                    .copy_from_slice(&[10, 120, 250, 255]);
            }
            pixels[row * stride + 8 * 4..(row + 1) * stride].fill(0x5a);
        }
        let main: Main = serde_json::from_value(json!({
            "place": {"opacity": 0},
            "background": "black"
        }))
        .unwrap();
        apply_main_transform_bgra(&mut pixels, stride, 8, 4, Some(&main)).unwrap();
        for row in 0..4 {
            let visible = &pixels[row * stride..row * stride + 8 * 4];
            assert!(
                visible.chunks_exact(4).all(|pixel| pixel == [0, 0, 0, 255]),
                "第 {row} 行不是不透明黑：{visible:?}"
            );
            assert!(
                pixels[row * stride + 8 * 4..(row + 1) * stride]
                    .iter()
                    .all(|byte| *byte == 0x5a),
                "第 {row} 行的 stride 填充被写坏了"
            );
        }
    }

    /// 模糊底那一档不能跟着短路：它的内容就是源画面的模糊版，`opacity = 0`
    /// 只是让源画面不再叠在模糊底上，底本身仍要真的算出来。
    #[test]
    fn opacity_zero_on_blur_background_still_derives_from_the_source_frame() {
        let mut pixels = vec![0_u8; 8 * 4 * 4];
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.copy_from_slice(&[0, 0, 255, 255]);
        }
        let main: Main = serde_json::from_value(json!({
            "place": {"opacity": 0},
            "background": "blur"
        }))
        .unwrap();
        apply_main_transform_bgra(&mut pixels, 8 * 4, 8, 4, Some(&main)).unwrap();
        assert!(
            pixels.chunks_exact(4).all(|pixel| pixel[2] > 200),
            "模糊底被当成黑底短路掉了"
        );
    }

    /// 那条按行填黑的快路和导出侧「整条跳过铺底 / 上传」的短路必须共用同一个
    /// 判据，否则两边一漂就是「循环以为不用喂源帧、光栅却真去画源帧」。
    /// [`main_transform_is_uniform_black`] 是那份唯一真身，这里钉住它的边界：
    /// 只有 `opacity == 0` ＋ 黑底成立，模糊底、部分透明与缺省都不成立。
    #[test]
    fn only_a_fully_transparent_main_on_black_counts_as_a_uniform_black_base() {
        let main = |value: serde_json::Value| serde_json::from_value::<Main>(value).unwrap();
        assert!(main_transform_is_uniform_black(Some(&main(json!({
            "place": {"opacity": 0},
            "background": "black"
        })))));
        // background 缺省就是黑底。
        assert!(main_transform_is_uniform_black(Some(&main(
            json!({"place": {"opacity": 0}})
        ))));
        // 模糊底的内容来自源画面，跳不过去。
        assert!(!main_transform_is_uniform_black(Some(&main(json!({
            "place": {"opacity": 0},
            "background": "blur"
        })))));
        // 还透出一点点就得照常画。
        assert!(!main_transform_is_uniform_black(Some(&main(json!({
            "place": {"opacity": 0.01},
            "background": "black"
        })))));
        // 没有 place 时 opacity 缺省是 1。
        assert!(!main_transform_is_uniform_black(Some(&main(
            json!({"background": "black"})
        ))));
        assert!(!main_transform_is_uniform_black(None));
    }

    #[test]
    fn decoded_texture_passthrough_requires_an_identity_main_transform() {
        assert!(main_transform_is_identity(None, 1920, 1080));
        for value in [
            json!({}),
            json!({"place": {"x":50,"y":50,"scale":1,"scaleY":1,"rot":0,"opacity":1}}),
        ] {
            let main: Main = serde_json::from_value(value).unwrap();
            assert!(main_transform_is_identity(Some(&main), 1920, 1080));
        }
        for (key, value) in [
            ("x", 49.0),
            ("y", 51.0),
            ("scale", 0.9),
            ("scaleY", 1.1),
            ("rot", 0.01),
            ("opacity", 0.5),
            ("opacity", 0.0),
        ] {
            let mut document = json!({"place": {}});
            document["place"][key] = json!(value);
            let main: Main = serde_json::from_value(document).unwrap();
            assert!(
                !main_transform_is_identity(Some(&main), 1920, 1080),
                "{key}={value}"
            );
        }
    }

    #[test]
    fn media_effects_masks_reveal_and_tile_geometry_are_deterministic() {
        let mut pixel =
            Pixmap::from_vec(vec![100, 150, 200, 255], IntSize::from_wh(1, 1).unwrap()).unwrap();
        apply_media_effects(
            &mut pixel,
            Some(&Fx {
                grayscale: Some(1.0),
                blur: None,
                brightness: Some(0.1),
                contrast: None,
                exposure: None,
                hue: None,
                saturation: None,
                sharpen: None,
                noise: None,
                vignette: None,
                filter_preset: None,
                effect_preset: None,
                effect_intensity: None,
            }),
            1.0,
        );
        assert_eq!(pixel.data()[0], pixel.data()[1]);
        assert_eq!(pixel.data()[1], pixel.data()[2]);
        assert!(pixel.data()[0] > 150);

        let mut clipped = Pixmap::new(9, 9).unwrap();
        clipped.fill(tiny_skia::Color::WHITE);
        apply_local_clip(&mut clipped, 0.0, true, 0.0);
        assert_eq!(clipped.pixel(0, 0).unwrap().alpha(), 0);
        assert_eq!(clipped.pixel(4, 4).unwrap().alpha(), 255);
        apply_horizontal_reveal(&mut clipped, 0.5);
        assert_eq!(clipped.pixel(8, 4).unwrap().alpha(), 0);
        assert!(clipped.pixel(2, 4).unwrap().alpha() > 200);

        let tile = Tile {
            on: true,
            angle: Some(-30.0),
            gap_x: Some(8.0),
            gap_y: Some(10.0),
            stagger: Some(true),
        };
        let first = tile_stamp_points(320, 180, 64, 32, &tile);
        let second = tile_stamp_points(320, 180, 64, 32, &tile);
        assert_eq!(first, second);
        assert!(first.len() > 20);
    }

    /// M118 对拍：Mac 现在把每行的外观投影为 `origStyle` / `transStyle`。
    /// 烧录的译文行必须用自己的字体/颜色/字重/描边/背景，而不是根节点那一行的；
    /// 同时字号仍由 `bilingualOrigScale` / `transScale` 推出——partial 里没有
    /// `fontSize`，紧凑原文才不会退回独立行的字号。
    #[test]
    fn per_line_style_overrides_reach_the_burned_bilingual_lines() {
        let mut style = document("None", "none")["style"].clone();
        style["mode"] = json!("bi");
        style["bilingualOrigScale"] = json!(0.6);
        style["transScale"] = json!(1.25);
        style["origStyle"] = json!({
            "fontFamily": "montserrat", "fontColor": "#FFFFFF", "bold": true,
            "outline": true, "textOutline": {"color": "#000000", "width": 10, "on": true},
            "background": true, "letterSpacing": 0
        });
        style["transStyle"] = json!({
            "fontFamily": "Bebas Neue", "fontColor": "#FFCC00", "bold": false,
            "outline": false, "textOutline": {"color": "#FF0000", "width": 8, "on": false},
            "background": false, "letterSpacing": 4
        });

        let orig = resolve_line_style(&style, LineKind::Original, 1920, 1080, true);
        let trans = resolve_line_style(&style, LineKind::Translation, 1920, 1080, true);

        assert_eq!(orig.font_name, "Montserrat");
        assert_eq!(trans.font_name, "Bebas Neue");
        // 根节点是加粗/描边/带背景的原文行，这三个扁平布尔值优先级高于结构化
        // 字段，partial 必须能压过它们。
        assert!(orig.bold && !trans.bold);
        assert!(orig.outline_on && !trans.outline_on);
        assert!(orig.background_on && !trans.background_on);
        assert_eq!(
            (trans.color.r, trans.color.g, trans.color.b),
            (0xFF, 0xCC, 0x00)
        );
        assert_eq!(
            (orig.color.r, orig.color.g, orig.color.b),
            (0xFF, 0xFF, 0xFF)
        );

        let canvas = f64::from(1080_u32) / REFERENCE_SHORT_EDGE;
        assert!((orig.font_size - 30.0 * 0.6 * canvas).abs() < 1e-9);
        assert!((trans.font_size - 30.0 * 0.6 * 1.25 * canvas).abs() < 1e-9);
        // 字距也归一化到这一行自己的字号（原型的 `letterSpacing` 是 1/100 em）：
        // 译文逻辑字号 30 × 0.6 × 1.25 = 22.5 ⇒ size_scale = 0.75 · canvas。
        assert!((trans.letter_spacing - 4.0 * 0.75 * canvas).abs() < 1e-9);
    }

    /// 两条原文字幕、无出入场留白，方便按时刻各取一条。
    fn two_cue_document(style: Value) -> Value {
        let mut base = document("None", "none")["style"].clone();
        base["displayTiming"] = json!({"leadIn": 0, "tail": 0});
        for (key, value) in style.as_object().unwrap() {
            base[key] = value.clone();
        }
        json!({
            "meta": {"duration": 3.0},
            "style": base,
            "cues": [
                {"id": "q1", "start": 0.0, "end": 1.5, "text": "Hello world",
                 "words": [{"text": "Hello", "t0": 0.0, "t1": 0.7}, {"text": "world", "t0": 0.8, "t1": 1.5}]},
                {"id": "q2", "start": 1.5, "end": 3.0, "text": "Second line",
                 "words": [{"text": "Second", "t0": 1.5, "t1": 2.2}, {"text": "line", "t0": 2.3, "t1": 3.0}]}
            ],
            "sentences": [],
            "transCues": [
                {"id": "s1#0", "sid": "s1", "kind": "piece", "text": "你好世界", "start": 0.0, "end": 1.5},
                {"id": "s2#0", "sid": "s2", "kind": "piece", "text": "第二行", "start": 1.5, "end": 3.0}
            ]
        })
    }

    fn has_red_pixel(rgba: &[u8]) -> bool {
        rgba.chunks_exact(4)
            .any(|pixel| pixel[0] > 180 && pixel[1] < 40 && pixel[2] < 40 && pixel[3] > 180)
    }

    #[test]
    fn a_cue_style_restyles_only_its_own_cue_in_layout_and_pixels() {
        let document = two_cue_document(json!({
            // 单行模式里 origStyle 的同名键不能压过逐条覆盖。
            "origStyle": {"fontColor": "#00FF00"},
            "cueStyles": {"q2": {"source": {"fontColor": "#FF0000", "fontSize": 60}}}
        }));
        let mut plan = OverlayRenderPlan::compile(&document, 320, 180, 3.0, 30.0, None).unwrap();
        let first = plan.active_layouts(0.8);
        let second = plan.active_layouts(2.0);
        assert_eq!(first[0].item.id, "q1");
        assert_eq!(second[0].item.id, "q2");
        assert_eq!(
            (first[0].style.color.r, first[0].style.color.g),
            (0x00, 0xFF)
        );
        assert_eq!(
            (second[0].style.color.r, second[0].style.color.g),
            (0xFF, 0x00)
        );
        assert!((second[0].style.font_size - first[0].style.font_size * 2.0).abs() < 1e-9);
        assert!(!has_red_pixel(&plan.render_rgba_frame(0.8).unwrap().rgba));
        assert!(has_red_pixel(&plan.render_rgba_frame(2.0).unwrap().rgba));
    }

    #[test]
    fn an_empty_cue_style_renders_exactly_like_the_track() {
        let plain = two_cue_document(json!({}));
        let detached = two_cue_document(json!({"cueStyles": {"q1": {"source": {}}}}));
        let mut plain = OverlayRenderPlan::compile(&plain, 320, 180, 3.0, 30.0, None).unwrap();
        let mut detached =
            OverlayRenderPlan::compile(&detached, 320, 180, 3.0, 30.0, None).unwrap();
        assert!(detached.cue_original.is_empty());
        let (plain_frame, detached_frame) = (
            plain.subtitle_layout(0.8).unwrap(),
            detached.subtitle_layout(0.8).unwrap(),
        );
        assert_eq!(plain_frame.anchor, detached_frame.anchor);
        assert_eq!(plain_frame.lines.len(), detached_frame.lines.len());
        assert_eq!(
            plain.render_rgba_frame(0.8).unwrap().rgba,
            detached.render_rgba_frame(0.8).unwrap().rgba
        );
    }

    #[test]
    fn a_single_mode_cue_position_moves_the_whole_group() {
        let document = two_cue_document(json!({
            "cueStyles": {"q2": {"source": {"y": 20}}}
        }));
        let mut plan = OverlayRenderPlan::compile(&document, 320, 180, 3.0, 30.0, None).unwrap();
        let first = plan.subtitle_layout(0.8).unwrap();
        let second = plan.subtitle_layout(2.0).unwrap();
        assert!(
            second.anchor.1 < first.anchor.1 - 50.0,
            "q2 的逐条 y=20 应把整组抬高：{:?} vs {:?}",
            second.anchor,
            first.anchor
        );
        assert_eq!(first.anchor.0, second.anchor.0);
    }

    #[test]
    fn a_bilingual_translation_cue_style_detaches_only_that_line() {
        let document = two_cue_document(json!({
            "mode": "bi",
            "cueStyles": {"s2#0": {"translation": {"y": 20, "fontColor": "#FF0000"}}}
        }));
        let mut plan = OverlayRenderPlan::compile_with(
            &document,
            320,
            180,
            3.0,
            30.0,
            Some("bi"),
            OverlayIncludes::ALL,
        )
        .unwrap();
        assert_eq!(plan.cue_translation.len(), 1);
        let first = plan.subtitle_layout(0.8).unwrap();
        assert!(first.lines.iter().all(|line| !line.detached));
        let second = plan.subtitle_layout(2.0).unwrap();
        let translation = second
            .lines
            .iter()
            .find(|line| line.cue_id == "s2#0")
            .unwrap();
        let original = second
            .lines
            .iter()
            .find(|line| line.cue_id == "q2")
            .unwrap();
        assert!(translation.detached && !original.detached);
        assert!(translation.y < original.y);
        let styles = plan.active_layouts(2.0);
        let translated = styles
            .iter()
            .find(|line| line.kind == LineKind::Translation)
            .unwrap();
        assert_eq!(translated.style.color.r, 0xFF);
        assert_eq!(translated.style.color.g, 0x00);
    }

    #[test]
    fn a_portrait_and_a_landscape_canvas_with_the_same_short_edge_share_the_font_pixel() {
        let style = document("None", "none")["style"].clone();
        let landscape = resolve_line_style(&style, LineKind::Original, 1920, 1080, false);
        let portrait = resolve_line_style(&style, LineKind::Original, 1080, 1920, false);
        assert_eq!(landscape.font_size, 60.0);
        assert_eq!(portrait.font_size, 60.0);
        assert_eq!(1920.0 * 0.8, 1536.0);
        assert_eq!(1080.0 * 0.8, 864.0);
    }

    #[test]
    fn numeric_and_legacy_string_weights_reach_the_line_style() {
        let mut style = document("None", "none")["style"].clone();
        style["fontWeight"] = json!(600);
        style["bold"] = json!(false);
        let resolved = resolve_line_style(&style, LineKind::Original, 960, 540, false);
        assert_eq!(resolved.font_weight, 600);
        assert!(!resolved.bold);

        style["fontWeight"] = json!("700");
        let legacy = resolve_line_style(&style, LineKind::Original, 960, 540, false);
        assert_eq!(legacy.font_weight, 700);
        assert!(legacy.bold);
    }

    #[test]
    fn title_case_preserves_word_timing_across_mixed_cjk_and_latin_text() {
        let words = vec![
            Word {
                id: "w0".into(),
                text: "world".into(),
                start: 0.0,
                end: 0.5,
            },
            Word {
                id: "w1".into(),
                text: "ACME".into(),
                start: 0.5,
                end: 1.0,
            },
        ];
        let runs = timed_runs("你好world ACME", &words, "title");
        assert_eq!(
            runs.iter().map(|run| run.text.as_str()).collect::<String>(),
            "你好world ACME"
        );
        assert_eq!(
            runs.iter()
                .filter_map(|run| run.word.map(|word| (word, run.text.as_str())))
                .collect::<Vec<_>>(),
            [(0, "world"), (1, "ACME")]
        );
    }

    #[test]
    fn a_missing_border_radius_keeps_the_legacy_render_bytes() {
        let mut legacy = document("None", "none");
        legacy["style"]
            .as_object_mut()
            .unwrap()
            .remove("borderRadius");
        let mut explicit = legacy.clone();
        explicit["style"]["borderRadius"] = json!(10.0 * 0.8 / 0.55);
        let mut old_plan = OverlayRenderPlan::compile(&legacy, 320, 180, 3.0, 30.0, None).unwrap();
        let mut new_plan =
            OverlayRenderPlan::compile(&explicit, 320, 180, 3.0, 30.0, None).unwrap();
        assert_eq!(
            old_plan.render_rgba(1.0).unwrap(),
            new_plan.render_rgba(1.0).unwrap()
        );
    }

    #[test]
    fn short_gaps_are_split_exactly_between_tail_and_lead_in() {
        for (gap, lead_in, tail) in [(0.1, 0.5, 1.0), (0.6, 0.7, 0.4), (1.2, 2.0, 1.0)] {
            assert!(gap < lead_in + tail);
            let sum = display_padding(tail, gap, lead_in, tail)
                + display_padding(lead_in, gap, lead_in, tail);
            assert!((sum - gap).abs() < 1e-12, "{gap}/{lead_in}/{tail}");
        }
    }

    /// 效果层模糊半径的上限必须随字号走。Mac / Web 预览都不夹取，面板上限
    /// （glow range 100 ⇒ 0.9·fontSize，shadow blur 0.5 ⇒ 0.5·fontSize）必须原样
    /// 落到烧录；旧的硬编码 10px 会在 4K 上把柔和阴影烧成硬边。
    #[test]
    fn effect_blur_ceiling_scales_with_font_size() {
        let mut style = document("None", "none")["style"].clone();
        style["dropShadow"] =
            json!({"on": true, "blur": 0.5, "distance": 0.0, "opacity": 0.6, "color": "#000000"});
        let shadow = resolve_line_style(&style, LineKind::Original, 1920, 1080, false);
        assert!(shadow.effect_on);
        assert!(
            (shadow.effect_blur - 30.0).abs() < 1e-9,
            "0.5 × 60 = 30（旧口径会被夹到 10），实际 {}",
            shadow.effect_blur
        );

        style["glow"] = json!({"on": true, "intensity": 50, "range": 100, "color": "#FFFFFF"});
        let glow = resolve_line_style(&style, LineKind::Original, 1920, 1080, false);
        assert!(
            (glow.effect_blur - 54.0).abs() < 1e-9,
            "100/100 × 60 × 0.9 = 54，实际 {}",
            glow.effect_blur
        );
    }

    const PLACE_ANCHOR: (f64, f64) = (500.0, 860.0);

    const PLACE_FRAME: (f64, f64) = (1000.0, 1000.0);

    const PLACE_GAP: f64 = 6.0;

    /// 每行都只占 1 行（实际高 == 参考高）、且没有任何显式锚点的堆栈输入。
    /// 这是垂直锚点上线前后必须逐比特一致的那条基线。
    fn single_row_boxes(heights: &[f64], overrides: &[Option<(f64, f64)>]) -> Vec<LineBox> {
        heights
            .iter()
            .zip(overrides)
            .map(|(height, over)| LineBox {
                height: *height,
                reference: *height,
                pad_v: 0.0,
                over: *over,
                align: None,
            })
            .collect()
    }

    /// 等价性哨兵（不得放宽）：每行都只占 1 行时，槽位 + 接缝的新算法必须逐比特
    /// 还原「总高居中 + 逐行累加实际高」的老公式。下面三组落点是改造前的输出。
    ///
    /// 行级位置覆盖的三种情形也在这里一次算出：两行都覆盖时各自独立居中；只覆盖
    /// 一行时堆栈里只剩另一行，塌成单行居中于锚点；都不覆盖时是老公式。
    #[test]
    fn line_positions_lift_only_the_covered_lines_out_of_the_stack() {
        let heights = [40.0, 20.0];
        let (anchor, frame, gap) = (PLACE_ANCHOR, PLACE_FRAME, PLACE_GAP);

        let stacked = single_row_boxes(&heights, &[None, None]);
        assert_eq!(
            stacked_extent(&stacked, gap, StackPlate::Separate),
            StackExtent {
                count: 2,
                total_height: 66.0,
            }
        );
        assert_eq!(
            place_lines(&stacked, anchor, gap, frame, None, StackPlate::Separate),
            vec![(500.0, 827.0), (500.0, 873.0)]
        );

        let both = single_row_boxes(&heights, &[Some((20.0, 30.0)), Some((80.0, 70.0))]);
        assert_eq!(
            stacked_extent(&both, gap, StackPlate::Separate),
            StackExtent {
                count: 0,
                total_height: 0.0,
            }
        );
        assert_eq!(
            place_lines(&both, anchor, gap, frame, None, StackPlate::Separate),
            vec![(200.0, 280.0), (800.0, 690.0)]
        );

        let first = single_row_boxes(&heights, &[Some((20.0, 30.0)), None]);
        assert_eq!(
            stacked_extent(&first, gap, StackPlate::Separate),
            StackExtent {
                count: 1,
                total_height: 20.0,
            }
        );
        let placed = place_lines(&first, anchor, gap, frame, None, StackPlate::Separate);
        assert_eq!(placed, vec![(200.0, 280.0), (500.0, 850.0)]);
        // 契约：剩下的那一行必须与「本来就只有它一行」落在同一处。
        assert_eq!(
            place_lines(
                &single_row_boxes(&heights[1..], &[None]),
                anchor,
                gap,
                frame,
                None,
                StackPlate::Separate,
            ),
            vec![placed[1]]
        );
    }

    /// 接缝钉死：折行只在自己那一侧生长，另一行的落点一动不动。
    ///
    /// 槽位高度取「单行参考高度」而不是折行后的实际高度，所以上行折成两行时向上
    /// 长，下行折成两行时向下长；两者之间那道 gap 的两个端点都保持原位。这是
    /// 双语字幕「改一行不动另一行」的全部依据。
    #[test]
    fn wrapped_lines_grow_away_from_the_seam() {
        let (anchor, frame, gap) = (PLACE_ANCHOR, PLACE_FRAME, PLACE_GAP);
        let reference = [40.0, 20.0];
        let boxes = |heights: [f64; 2]| {
            vec![
                LineBox {
                    height: heights[0],
                    reference: reference[0],
                    pad_v: 0.0,
                    over: None,
                    align: None,
                },
                LineBox {
                    height: heights[1],
                    reference: reference[1],
                    pad_v: 0.0,
                    over: None,
                    align: None,
                },
            ]
        };
        let baseline = place_lines(
            &boxes(reference),
            anchor,
            gap,
            frame,
            None,
            StackPlate::Separate,
        );
        assert_eq!(baseline, vec![(500.0, 827.0), (500.0, 873.0)]);

        // 上行折成两行（40 → 80）：贴槽底向上长，下行纹丝不动。
        let upper = place_lines(
            &boxes([80.0, 20.0]),
            anchor,
            gap,
            frame,
            None,
            StackPlate::Separate,
        );
        assert_eq!(upper, vec![(500.0, 787.0), (500.0, 873.0)]);
        // 接缝仍是 6：上行底边 787+80=867，下行顶边 873。
        assert!((873.0 - (787.0 + 80.0) - gap).abs() < 1e-9);

        // 下行折成两行（20 → 40）：贴槽顶向下长，上行纹丝不动。
        let lower = place_lines(
            &boxes([40.0, 40.0]),
            anchor,
            gap,
            frame,
            None,
            StackPlate::Separate,
        );
        assert_eq!(lower, vec![(500.0, 827.0), (500.0, 873.0)]);
    }

    /// 单语（堆栈只剩一行）时槽位退回实际高度：折行的块仍居中于锚点。
    ///
    /// 若照抄「槽位一律是单行参考高度」，这里会整体偏 `参考高/2`，把所有既有的
    /// 单语折行字幕搬走。等价性哨兵（都不折行）抓不到这一条，所以单列一测。
    #[test]
    fn a_lone_wrapped_line_still_centers_on_the_anchor() {
        let (anchor, frame, gap) = (PLACE_ANCHOR, PLACE_FRAME, PLACE_GAP);
        let wrapped = vec![LineBox {
            height: 80.0,
            reference: 40.0,
            pad_v: 0.0,
            over: None,
            align: None,
        }];
        assert_eq!(
            stacked_extent(&wrapped, gap, StackPlate::Separate),
            StackExtent {
                count: 1,
                total_height: 80.0,
            }
        );
        assert_eq!(
            place_lines(&wrapped, anchor, gap, frame, None, StackPlate::Separate),
            vec![(500.0, 820.0)]
        );
        // 只覆盖一行、剩下的那行又折了行时同理：塌回「本来就只有它」的落点。
        let mixed = vec![
            LineBox {
                height: 40.0,
                reference: 40.0,
                pad_v: 0.0,
                over: Some((20.0, 30.0)),
                align: None,
            },
            wrapped[0],
        ];
        assert_eq!(
            place_lines(&mixed, anchor, gap, frame, None, StackPlate::Separate)[1],
            place_lines(&wrapped, anchor, gap, frame, None, StackPlate::Separate)[0]
        );
    }

    /// 块级锚点作用在整栈上：top → 栈顶边压锚线，bottom → 栈底边压锚线，
    /// center（以及缺席）→ 栈中心压锚线（现状）。行序永不翻转。
    #[test]
    fn the_block_anchor_hangs_the_whole_stack_off_the_anchor_line() {
        let heights = [40.0, 20.0];
        let (anchor, frame, gap) = (PLACE_ANCHOR, PLACE_FRAME, PLACE_GAP);
        let stacked = single_row_boxes(&heights, &[None, None]);
        let placed = |align| place_lines(&stacked, anchor, gap, frame, align, StackPlate::Separate);

        assert_eq!(placed(None), placed(Some(VerticalAlign::Center)));
        assert_eq!(
            placed(Some(VerticalAlign::Center)),
            vec![(500.0, 827.0), (500.0, 873.0)]
        );
        assert_eq!(
            placed(Some(VerticalAlign::Top)),
            vec![(500.0, 860.0), (500.0, 906.0)]
        );
        assert_eq!(
            placed(Some(VerticalAlign::Bottom)),
            vec![(500.0, 794.0), (500.0, 840.0)]
        );

        // 单行块（含折行）：三态就是「顶边 / 中心 / 底边压线」。
        let lone = vec![LineBox {
            height: 80.0,
            reference: 40.0,
            pad_v: 0.0,
            over: None,
            align: None,
        }];
        let lone_top =
            |align| place_lines(&lone, anchor, gap, frame, align, StackPlate::Separate)[0].1;
        assert_eq!(lone_top(Some(VerticalAlign::Top)), 860.0);
        assert_eq!(lone_top(Some(VerticalAlign::Center)), 820.0);
        assert_eq!(lone_top(Some(VerticalAlign::Bottom)), 780.0);
    }

    /// 行级锚点压过槽内接缝默认值；脱离堆栈的行按自己的锚点挂在 `(x%, y%)` 上，
    /// 缺席仍是 center，老文档因此零回归。
    #[test]
    fn line_anchors_override_the_seam_and_place_detached_lines() {
        let (anchor, frame, gap) = (PLACE_ANCHOR, PLACE_FRAME, PLACE_GAP);
        // 上行折成两行、但显式要求贴槽顶：向下长，会压过接缝。
        let forced = vec![
            LineBox {
                height: 80.0,
                reference: 40.0,
                pad_v: 0.0,
                over: None,
                align: Some(VerticalAlign::Top),
            },
            LineBox {
                height: 20.0,
                reference: 20.0,
                pad_v: 0.0,
                over: None,
                align: None,
            },
        ];
        assert_eq!(
            place_lines(&forced, anchor, gap, frame, None, StackPlate::Separate),
            vec![(500.0, 827.0), (500.0, 873.0)]
        );

        // 脱离行：y% = 30 → 300px 锚线，块高 40。
        let detached = |align| {
            place_lines(
                &[LineBox {
                    height: 40.0,
                    reference: 40.0,
                    pad_v: 0.0,
                    over: Some((20.0, 30.0)),
                    align,
                }],
                anchor,
                gap,
                frame,
                None,
                StackPlate::Separate,
            )[0]
        };
        assert_eq!(detached(None), (200.0, 280.0));
        assert_eq!(detached(Some(VerticalAlign::Center)), (200.0, 280.0));
        assert_eq!(detached(Some(VerticalAlign::Top)), (200.0, 300.0));
        assert_eq!(detached(Some(VerticalAlign::Bottom)), (200.0, 260.0));
    }

    /// 共享底板取摆放后的实际范围：折行的行长出槽位，底板必须跟着长；
    /// 都不折行时结果与「锚点 ± 总高/2」逐比特相同。
    #[test]
    fn the_shared_background_spans_the_placed_lines() {
        let (anchor, frame, gap) = (PLACE_ANCHOR, PLACE_FRAME, PLACE_GAP);
        let flat = single_row_boxes(&[40.0, 20.0], &[None, None]);
        let placed = place_lines(&flat, anchor, gap, frame, None, StackPlate::Separate);
        assert_eq!(stacked_span(&placed, &flat), Some((827.0, 893.0)));

        let wrapped = vec![
            LineBox {
                height: 80.0,
                reference: 40.0,
                pad_v: 0.0,
                over: None,
                align: None,
            },
            LineBox {
                height: 40.0,
                reference: 20.0,
                pad_v: 0.0,
                over: None,
                align: None,
            },
        ];
        let placed = place_lines(&wrapped, anchor, gap, frame, None, StackPlate::Separate);
        // 上行 787..867、下行 873..913：底板两头都长出来了。
        assert_eq!(stacked_span(&placed, &wrapped), Some((787.0, 913.0)));

        // 脱离堆栈的行不进共享底板；全部脱离时没有共享底板可画。
        let detached = vec![
            LineBox {
                over: Some((20.0, 5.0)),
                ..flat[0]
            },
            flat[1],
        ];
        let placed = place_lines(&detached, anchor, gap, frame, None, StackPlate::Separate);
        assert_eq!(stacked_span(&placed, &detached), Some((850.0, 870.0)));
        assert_eq!(stacked_span(&[], &[]), None);
    }

    /// 非对称内边距的两行堆栈：上行 `pad_v` 10、下行 4。
    ///
    /// 护栏一律用不等的两个值：对称 fixture 下「每行用自己的 pad_v」和「两行共用
    /// 一个 pad_v」都会通过，只有非对称才钉得住 Mac 的逐行语义。
    fn padded_pair() -> Vec<LineBox> {
        vec![
            LineBox {
                height: 40.0,
                reference: 40.0,
                pad_v: 10.0,
                over: None,
                align: None,
            },
            LineBox {
                height: 20.0,
                reference: 20.0,
                pad_v: 4.0,
                over: None,
                align: None,
            },
        ]
    }

    /// 逐行底板：槽位含 `2 × pad_v`，那道 gap 落在两块**底板**之间而不是字形之间。
    ///
    /// 视觉上的缝是两块板的间距；照旧把 gap 记在字形之间，双语字幕的两块底板会
    /// 贴死甚至互相压住。字形之间因此拉开 `gap + pad_v上 + pad_v下`，非对称时不等分。
    #[test]
    fn padded_slots_put_the_gap_between_the_plates_not_the_glyphs() {
        let (anchor, frame, gap) = (PLACE_ANCHOR, PLACE_FRAME, PLACE_GAP);
        let lines = padded_pair();
        // 槽高 = 参考高 + 2 × 自己的 pad_v：60 与 28，总高 60 + 28 + 6 = 94。
        assert_eq!(
            stacked_extent(&lines, gap, StackPlate::Separate),
            StackExtent {
                count: 2,
                total_height: 94.0,
            }
        );
        // 返回的永远是字形顶边：含内边距的盒顶再进 pad_v。
        let placed = place_lines(&lines, anchor, gap, frame, None, StackPlate::Separate);
        assert_eq!(placed, vec![(500.0, 823.0), (500.0, 883.0)]);

        let upper_plate_bottom = placed[0].1 + lines[0].height + lines[0].pad_v;
        let lower_plate_top = placed[1].1 - lines[1].pad_v;
        assert_eq!(lower_plate_top - upper_plate_bottom, gap);
        assert_eq!(
            placed[1].1 - (placed[0].1 + lines[0].height),
            gap + lines[0].pad_v + lines[1].pad_v
        );

        // pad_v 全为 0 时逐比特退回无内边距的老落点（等价性哨兵的那三个数）。
        let bare = single_row_boxes(&[40.0, 20.0], &[None, None]);
        assert_eq!(
            place_lines(&bare, anchor, gap, frame, None, StackPlate::Separate),
            vec![(500.0, 827.0), (500.0, 873.0)]
        );
    }

    /// 块级锚点钉的是**含内边距**的整栈盒：top → 板顶压锚线，bottom → 板底压锚线。
    ///
    /// 钉字形边会让开着底板的字幕整体越界——底板比字形多出一条 pad_v。
    #[test]
    fn the_block_anchor_pins_the_padded_stack_edges() {
        let (anchor, frame, gap) = (PLACE_ANCHOR, PLACE_FRAME, PLACE_GAP);
        let lines = padded_pair();
        let placed = |align| place_lines(&lines, anchor, gap, frame, align, StackPlate::Separate);

        assert_eq!(placed(None), vec![(500.0, 823.0), (500.0, 883.0)]);
        assert_eq!(
            placed(Some(VerticalAlign::Top)),
            vec![(500.0, 870.0), (500.0, 930.0)]
        );
        assert_eq!(
            placed(Some(VerticalAlign::Bottom)),
            vec![(500.0, 776.0), (500.0, 836.0)]
        );
        // 上行板顶 = 锚线；下行板底 = 锚线。
        assert_eq!(
            placed(Some(VerticalAlign::Top))[0].1 - lines[0].pad_v,
            anchor.1
        );
        let bottom = placed(Some(VerticalAlign::Bottom));
        assert_eq!(bottom[1].1 + lines[1].height + lines[1].pad_v, anchor.1);
    }

    /// 共享底板：槽位与缝都留在裸字形上，块级锚点钉的是**那块板**的边。
    ///
    /// 板内边距记在整栈外面（Mac 的 `platePadV`），所以字形落点与 pad = 0 的逐行
    /// 模式逐比特相同——共享模式下改 backgroundPadding 只该让板长胖，不该挪字。
    #[test]
    fn the_shared_plate_edge_is_what_the_block_anchor_pins() {
        let (anchor, frame, gap) = (PLACE_ANCHOR, PLACE_FRAME, PLACE_GAP);
        let lines = padded_pair();
        let plate = StackPlate::Shared { pad_v: 12.0 };
        // 槽位仍是裸参考高（40 + 20 + 6），板内边距 12 × 2 记在外面。
        assert_eq!(
            stacked_extent(&lines, gap, plate),
            StackExtent {
                count: 2,
                total_height: 90.0,
            }
        );
        let placed = |align| place_lines(&lines, anchor, gap, frame, align, plate);
        assert_eq!(placed(None), vec![(500.0, 827.0), (500.0, 873.0)]);

        // 板 = 字形范围向外扩一条 platePadV；源行字形顶距板顶恰好 platePadV。
        let span = stacked_span(&placed(None), &lines).expect("堆栈里有两行");
        assert_eq!((span.0 - 12.0, span.1 + 12.0), (815.0, 905.0));
        assert_eq!(placed(None)[0].1 - (span.0 - 12.0), 12.0);

        let top = placed(Some(VerticalAlign::Top));
        assert_eq!(top, vec![(500.0, 872.0), (500.0, 918.0)]);
        assert_eq!(stacked_span(&top, &lines).expect("两行").0 - 12.0, anchor.1);
        let bottom = placed(Some(VerticalAlign::Bottom));
        assert_eq!(bottom, vec![(500.0, 782.0), (500.0, 828.0)]);
        assert_eq!(
            stacked_span(&bottom, &lines).expect("两行").1 + 12.0,
            anchor.1
        );
    }

    /// 共享底板选行：`!源行有真背景 && 译文行有真背景 ? 译文行 : 源行`。
    ///
    /// 要害分支是「两行都没真背景」——此时仍然取**源行**。板固然不画，可它的 pad 会经
    /// `StackPlate::Shared` 的 `plate_pad_v` 撑开整个槽位盒；两行 backgroundPadding
    /// 不对称时选错行，就是与 Mac / Web 实打实的几何分叉，而不是「反正看不见」。
    ///
    /// fixture 的两个 pad 故意不等：相等时无论取哪行都通过，钉不住任何东西。
    #[test]
    fn the_shared_plate_spec_falls_back_to_the_translation_only_when_it_has_a_background() {
        // 每个候选是 (backgroundPadding 派生出的 pad, 这一行画得出真底板吗)。
        let (source_pad, trans_pad) = (20.0_f64, 5.0_f64);
        let pad_of = |line: Option<(f64, bool)>| line.map(|(pad, _)| pad);
        let pick = |source: Option<(f64, bool)>, trans: Option<(f64, bool)>| {
            pad_of(shared_plate_line(source, trans, |(_, bg): (f64, bool)| bg))
        };
        let source = |bg| Some((source_pad, bg));
        let trans = |bg| Some((trans_pad, bg));

        // 两行都没真背景 → 源行。fallback 要求译文行**自己**有背景，缺一不可。
        assert_eq!(pick(source(false), trans(false)), Some(source_pad));
        assert_eq!(pick(source(false), trans(true)), Some(trans_pad));
        // 源行自己画得出板时，译文行有没有都不影响。
        assert_eq!(pick(source(true), trans(false)), Some(source_pad));
        assert_eq!(pick(source(true), trans(true)), Some(source_pad));
        // 堆栈里只剩一行（另一行脱离或没启用）时就是它自己说了算。
        assert_eq!(pick(source(false), None), Some(source_pad));
        assert_eq!(pick(None, trans(false)), Some(trans_pad));
        assert_eq!(pick(None, None), None);

        // 选中的 pad 确实进入摆放：两个候选给出的槽位盒高差 (20 − 5) × 2。
        let extent = |pad| {
            stacked_extent(&padded_pair(), PLACE_GAP, StackPlate::Shared { pad_v: pad })
                .total_height
        };
        assert_eq!(
            extent(source_pad) - extent(trans_pad),
            (source_pad - trans_pad) * 2.0
        );
    }

    /// 脱离堆栈的行按自己**含内边距**的盒子挂在 `(x%, y%)` 上：
    /// top → 板顶压线、center（含缺席）→ 板中压线、bottom → 板底压线。
    ///
    /// 脱离行永远自己画底板（共享板包不住不连续的区间），所以板模式与它无关。
    #[test]
    fn detached_line_anchors_pin_the_padded_box_edges() {
        let (anchor, frame, gap) = (PLACE_ANCHOR, PLACE_FRAME, PLACE_GAP);
        let line = |align| LineBox {
            height: 40.0,
            reference: 40.0,
            pad_v: 10.0,
            over: Some((20.0, 30.0)),
            align,
        };
        let detached = |align| {
            place_lines(
                &[line(align)],
                anchor,
                gap,
                frame,
                None,
                StackPlate::Separate,
            )[0]
        };

        assert_eq!(detached(None), (200.0, 280.0));
        assert_eq!(detached(Some(VerticalAlign::Center)), (200.0, 280.0));
        assert_eq!(detached(Some(VerticalAlign::Top)), (200.0, 310.0));
        assert_eq!(detached(Some(VerticalAlign::Bottom)), (200.0, 250.0));
        // 盒高 60 的三条边分别压在 y% = 30 → 300 那条线上。
        assert_eq!(detached(Some(VerticalAlign::Top)).1 - 10.0, 300.0);
        assert_eq!(detached(None).1 - 10.0 + 30.0, 300.0);
        assert_eq!(detached(Some(VerticalAlign::Bottom)).1 + 40.0 + 10.0, 300.0);
        // 板模式与脱离行无关。
        assert_eq!(
            place_lines(
                &[line(None)],
                anchor,
                gap,
                frame,
                None,
                StackPlate::Shared { pad_v: 12.0 }
            )[0],
            detached(None)
        );
    }

    /// `pad_v` 恒等于 `pad_h / PLATE_PAD_ASPECT`——原型
    /// `designs/baocut/app/panel-substyle.jsx:82-86` 的 `padOf` 只有一个 `pad`：
    /// 竖向 `pad·fz/100`，横向再乘 1.4。此前核心按「底板是不是块」在 0.62 / 0.45
    /// 之间挑系数，两档的横竖比（1.6 与 2.2）都比原型的 1.4 扁，字上下贴着板边。
    /// `backgroundStyle == "block"` 现在只决定最小宽度。
    ///
    /// 关掉底板不会让 pad_v 归零——不画板的行照样撑开自己的槽位，否则同一份文档
    /// 「关一下背景」就会把另一行搬走。
    #[test]
    fn the_plate_padding_keeps_the_prototype_aspect_ratio() {
        let mut style = document("None", "none")["style"].clone();
        style["backgroundPadding"] = json!(20);
        style["background"] = json!(true);
        style["backgroundStyle"] = json!("wrap");
        // 短边 1080 → canvas_scale 2.0；pad_h = 20 × 2 × 0.8 = 32。
        let resolve =
            |style: &Value| resolve_line_style(style, LineKind::Original, 1920, 1080, false);

        let wrap = resolve(&style);
        assert!((wrap.background_pad_h - 32.0).abs() < 1e-9);
        assert!((wrap.background_pad_v - 32.0 / PLATE_PAD_ASPECT).abs() < 1e-9);

        style["backgroundStyle"] = json!("block");
        let block = resolve(&style);
        assert!((block.background_pad_h - 32.0).abs() < 1e-9);
        assert!((block.background_pad_v - 32.0 / PLATE_PAD_ASPECT).abs() < 1e-9);
        assert_eq!(block.background_pad_v, wrap.background_pad_v);

        style["background"] = json!(false);
        let off = resolve(&style);
        assert!(!off.background_on);
        assert!((off.background_pad_h - 32.0).abs() < 1e-9);
        assert!((off.background_pad_v - 32.0 / PLATE_PAD_ASPECT).abs() < 1e-9);

        // 行级 partial 各自覆盖 backgroundPadding：非对称 pad_v 是合法输入，
        // 共享底板因此不能「随便挑一行」取 padding。
        //
        // 译文行的 `pad_h` 还跟着**它自己的字号**走：这里的译文逻辑字号是
        // 30 × (20/30) × (32/20) = 32，短边 1080 ⇒ font_size 64，于是
        // pad_h = 5 × (64/30) × 0.8。此前乘的是 canvas_scale（2.0），译文行的
        // 底板与原文行一样厚，双语行看上去像两块不同比例的板。
        style["mode"] = json!("bi");
        style["transStyle"] = json!({"backgroundPadding": 5});
        let trans = resolve_line_style(&style, LineKind::Translation, 1920, 1080, true);
        assert!((trans.font_size - 64.0).abs() < 1e-9);
        assert!((trans.background_pad_h - 5.0 * (64.0 / REFERENCE_FONT_SIZE) * 0.8).abs() < 1e-9);
        assert!((trans.background_pad_v - trans.background_pad_h / PLATE_PAD_ASPECT).abs() < 1e-9);
    }

    /// 严格白名单：只有 `"top" | "center" | "bottom"` 三个字符串算数，别的一律缺席。
    /// 「显式 center」与「缺席」必须可区分——后者才走接缝规则。
    #[test]
    fn vertical_align_only_accepts_the_three_legal_strings() {
        for (value, expected) in [
            (json!("top"), Some(VerticalAlign::Top)),
            (json!("center"), Some(VerticalAlign::Center)),
            (json!("bottom"), Some(VerticalAlign::Bottom)),
            (json!("middle"), None),
            (json!("Top"), None),
            (json!("BOTTOM"), None),
            (json!(""), None),
            (json!(1), None),
            (json!(true), None),
            (json!(null), None),
            (json!({"value": "top"}), None),
            (json!(["top"]), None),
        ] {
            assert_eq!(
                parse_vertical_align(Some(&value)),
                expected,
                "verticalAlign = {value} 的判定不符合白名单"
            );
        }
        assert_eq!(parse_vertical_align(None), None);
    }

    /// 行级垂直锚点与行级位置同纪律：只读 partial、只在双语上下文消费。
    /// 走合并样式会让根节点的块级锚点冒充成每一行的显式值，接缝规则就废了。
    #[test]
    fn line_vertical_align_reads_the_partial_in_a_bilingual_context_only() {
        let style = json!({
            "verticalAlign": "top",
            "origStyle": {"verticalAlign": "bottom"},
            "transStyle": {"verticalAlign": "oops"}
        });
        assert_eq!(
            line_vertical_align(&style, LineKind::Original, StudioMode::Bilingual),
            Some(VerticalAlign::Bottom)
        );
        // 根节点的 "top" 不得渗进译文行。
        assert_eq!(
            line_vertical_align(&style, LineKind::Translation, StudioMode::Bilingual),
            None
        );
        // 单行导出忽略残留的行级锚点。
        assert_eq!(
            line_vertical_align(&style, LineKind::Original, StudioMode::Original),
            None
        );
        assert_eq!(
            line_vertical_align(&style, LineKind::Original, StudioMode::Translated),
            None
        );
        let plain = json!({"verticalAlign": "bottom"});
        assert_eq!(
            line_vertical_align(&plain, LineKind::Original, StudioMode::Bilingual),
            None
        );
    }

    /// x、y 必须成对出现才算行级覆盖，而且只在双语上下文消费。这两条同时挡住了
    /// 「从合并样式读到根锚点」和「单行导出被上一次双语摆放搬走」两种回归。
    #[test]
    fn line_positions_need_both_axes_and_a_bilingual_context() {
        let style = json!({
            "x": 50, "y": 86,
            "origStyle": {"x": 30},
            "transStyle": {"x": 30, "y": 40}
        });
        assert_eq!(
            line_position_override(&style, LineKind::Original, StudioMode::Bilingual),
            None
        );
        assert_eq!(
            line_position_override(&style, LineKind::Translation, StudioMode::Bilingual),
            Some((30.0, 40.0))
        );
        assert_eq!(
            line_position_override(&style, LineKind::Translation, StudioMode::Translated),
            None
        );
        let plain = json!({"x": 50, "y": 86});
        assert_eq!(
            line_position_override(&plain, LineKind::Original, StudioMode::Bilingual),
            None
        );
        let nulled = json!({"x": 50, "y": 86, "origStyle": {"x": 30, "y": null}});
        assert_eq!(
            line_position_override(&nulled, LineKind::Original, StudioMode::Bilingual),
            None
        );
    }

    fn positioned_bilingual_document() -> Value {
        let mut document = document("None", "none");
        document["style"]["mode"] = json!("bi");
        document["style"]["displayTiming"] = json!({"leadIn": 0.1, "tail": 0.1});
        document["cues"] = json!([{
            "id": "q1", "start": 1.0, "end": 2.0, "text": "Hello world",
            "words": [
                {"text": "Hello", "t0": 1.0, "t1": 1.5},
                {"text": "world", "t0": 1.5, "t1": 2.0}
            ]
        }]);
        document["transCues"] = json!([{
            "id": "s1#0", "sid": "s1", "kind": "piece",
            "start": 1.0, "end": 2.0, "text": "你好世界"
        }]);
        document
    }

    fn burned_rgba(document: &Value) -> Vec<u8> {
        OverlayRenderPlan::compile(document, 640, 360, 3.0, 30.0, None)
            .unwrap()
            .render_rgba(1.5)
            .unwrap()
    }

    /// 回归保护：只写一个轴、或在单行模式下留着两个轴，烧录结果都必须与完全没有
    /// 这些键时逐字节相同。
    #[test]
    fn half_written_line_positions_leave_the_burn_in_byte_identical() {
        let base = positioned_bilingual_document();
        let baseline = burned_rgba(&base);

        for partial in [
            json!({"x": 18}),
            json!({"y": 22}),
            json!({"x": null, "y": 22}),
        ] {
            let mut document = base.clone();
            document["style"]["origStyle"] = partial.clone();
            assert_eq!(
                burned_rgba(&document),
                baseline,
                "半截的行级位置 {partial} 不得移动烧录字幕"
            );
        }

        let mut single = base.clone();
        single["style"]["mode"] = json!("trans");
        let single_baseline = burned_rgba(&single);
        single["style"]["transStyle"] = json!({"x": 18, "y": 22});
        assert_eq!(burned_rgba(&single), single_baseline);
    }

    /// 像素级接缝钉死：一行折行后只往自己那一侧长，另一行烧在原处一动不动。
    ///
    /// 改造前整栈按实际总高重新居中，原文一折行译文就会被推走；这条断言是双语
    /// 字幕「改一行不动另一行」在烧录链上的验收口。两种 `order` 都验，因为折行的
    /// 那一行在上、在下时生长方向相反。
    #[test]
    fn a_wrapped_burned_line_grows_away_from_the_seam() {
        let rows = |document: &Value| {
            alpha_bbox(&burned_rgba(document), 640, 360)
                .expect("字幕帧必须有非零像素")
                .rows
        };
        for (order, original_on_top) in [(json!("trans"), false), (json!("orig"), true)] {
            let mut flat = positioned_bilingual_document();
            flat["style"]["order"] = order.clone();
            let mut wrapped = flat.clone();
            // 硬换行把原文摊成两行；译文的四个汉字仍是一行。
            wrapped["cues"][0]["text"] = json!("Hello\nworld");
            let (pinned, pushed) = (rows(&flat), rows(&wrapped));
            if original_on_top {
                assert_eq!(
                    pinned.end, pushed.end,
                    "order={order} 时原文折行把下面的译文行推走了：{pinned:?} → {pushed:?}"
                );
                assert!(
                    pushed.start < pinned.start,
                    "order={order} 时原文没有向上长：{pinned:?} → {pushed:?}"
                );
            } else {
                assert_eq!(
                    pinned.start, pushed.start,
                    "order={order} 时原文折行把上面的译文行推走了：{pinned:?} → {pushed:?}"
                );
                assert!(
                    pushed.end > pinned.end,
                    "order={order} 时原文没有向下长：{pinned:?} → {pushed:?}"
                );
            }
        }
    }

    /// 三情形的像素落点：两行都覆盖 → 各自独立居中；只覆盖一行 → 另一行塌回锚点
    /// 的单行位置；都不覆盖 → 仍贴着底部锚点。
    #[test]
    fn line_positions_move_only_the_covered_burned_lines() {
        let base = positioned_bilingual_document();
        let rows = |document: &Value| {
            let rgba = burned_rgba(document);
            alpha_bbox(&rgba, 640, 360)
                .expect("字幕帧必须有非零像素")
                .rows
        };

        // 都不覆盖：整组仍在 y=86% 的锚点附近。
        let stacked = rows(&base);
        assert!(stacked.start > 240, "锚点堆栈不应上移：{stacked:?}");

        // 两行都覆盖：一行在上四分之一，一行在下四分之一，中间是空的。
        let mut both = base.clone();
        both["style"]["origStyle"] = json!({"x": 25, "y": 15});
        both["style"]["transStyle"] = json!({"x": 75, "y": 85});
        let both_rows = rows(&both);
        assert!(
            both_rows.start < 90,
            "被覆盖的原文行没有上移：{both_rows:?}"
        );
        assert!(both_rows.end > 280, "被覆盖的译文行没有下移：{both_rows:?}");

        // 只覆盖原文行：译文行的堆栈只剩自己，必须与单行模式的落点完全一致。
        let mut only_original = base.clone();
        only_original["style"]["origStyle"] = json!({"x": 25, "y": 15});
        let mixed = burned_rgba(&only_original);
        let lifted = alpha_bbox(&mixed, 640, 360).expect("字幕帧必须有非零像素");
        assert!(lifted.rows.start < 90, "原文行没有脱离堆栈：{lifted:?}");

        let mut translation_only = base.clone();
        translation_only["style"]["mode"] = json!("trans");
        let solo = burned_rgba(&translation_only);
        let solo_box = alpha_bbox(&solo, 640, 360).expect("字幕帧必须有非零像素");
        // 译文行的像素与单行模式逐字节一致：只截出译文所在的那几行来比。
        let band = |rgba: &[u8], rows: std::ops::Range<usize>| {
            rgba[rows.start * 640 * 4..rows.end * 640 * 4].to_vec()
        };
        assert_eq!(
            band(&mixed, solo_box.rows.clone()),
            band(&solo, solo_box.rows.clone()),
            "未被覆盖的译文行必须塌回单行锚点"
        );
    }

    /// 跨端约定：`width`/`scale`/`rotation`/转场仍是整组属性，支点是全局锚点。
    /// 被覆盖的行只是换了落点，仍然跟着同一个组变换走——所以离锚点越远，转场
    /// 期间被拉动得越多。这条不是实现细节，是三端必须一致的取舍。
    #[test]
    fn floating_lines_still_ride_the_group_transition() {
        let mut document = positioned_bilingual_document();
        document["style"]["transition"] =
            json!({"transitionId": "magic-pop", "transitionSpeed": 50});
        document["style"]["origStyle"] = json!({"x": 25, "y": 15});

        let mut plan = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        // 显示窗从 0.9 开始（cue 1.0 减 leadIn 0.1），magic-pop@50 的时长是 0.1s。
        let opening = plan.render_rgba(0.9).unwrap();
        let settled = plan.render_rgba(1.5).unwrap();
        let opening_box = alpha_bbox(&opening, 640, 360).expect("转场首帧必须有非零像素");
        let settled_box = alpha_bbox(&settled, 640, 360).expect("落定帧必须有非零像素");

        assert!(
            opening_box.rows.start > settled_box.rows.start + 20,
            "浮动行在转场里必须被支点拉向锚点：{opening_box:?} vs {settled_box:?}"
        );
        assert!(
            opening_box.cols.start > settled_box.cols.start,
            "浮动行的横向也必须跟随整组缩放：{opening_box:?} vs {settled_box:?}"
        );
    }

    #[test]
    fn glow_blurs_only_the_effect_layer_and_keeps_solid_glyphs_crisp() {
        let mut plain_document = document("None", "none");
        plain_document["style"]["background"] = json!(false);
        plain_document["style"]["outline"] = json!(false);
        let mut plain =
            OverlayRenderPlan::compile(&plain_document, 640, 360, 3.0, 30.0, None).unwrap();
        let plain_rgba = plain.render_rgba(1.0).unwrap();

        let mut glow_document = plain_document;
        glow_document["style"]["glow"] = json!({
            "on": true, "color": "#FF0000", "intensity": 100, "range": 100
        });
        let mut glow =
            OverlayRenderPlan::compile(&glow_document, 640, 360, 3.0, 30.0, None).unwrap();
        let glow_rgba = glow.render_rgba(1.0).unwrap();

        let solid_glyphs = plain_rgba
            .chunks_exact(4)
            .zip(glow_rgba.chunks_exact(4))
            .filter(|(plain, _)| plain[3] == 255)
            .collect::<Vec<_>>();
        assert!(solid_glyphs.len() > 100);
        assert!(solid_glyphs.iter().all(|(plain, glowing)| plain == glowing));
        assert!(
            glow_rgba
                .chunks_exact(4)
                .zip(plain_rgba.chunks_exact(4))
                .any(|(glowing, plain)| glowing[0] > plain[0] && glowing[3] > plain[3])
        );
    }

    #[test]
    fn premultiplied_effect_layer_composites_under_crisp_text() {
        let mut destination = [128, 0, 0, 128];
        composite_premultiplied_rgba(
            &mut destination,
            &[0, 0, 128, 128],
            1,
            &ContentBox {
                rows: 0..1,
                cols: 0..1,
            },
        );
        assert_eq!(destination, [63, 0, 128, 191]);
    }

    #[test]
    fn caption_composite_modes_read_the_real_bgra_backdrop() {
        let source = [128, 128, 128, 255];
        for (mode, expected) in [
            (CaptionCompositeMode::Normal, 128),
            (CaptionCompositeMode::Difference, 64),
            (CaptionCompositeMode::Exclusion, 128),
            (CaptionCompositeMode::Screen, 160),
        ] {
            let mut target = [64, 64, 64, 255];
            composite_caption_pixel_bgra(&mut target, &source, mode);
            assert_eq!(target, [expected, expected, expected, 255], "{mode:?}");
        }

        let mut translucent = [64, 64, 64, 255];
        composite_caption_pixel_bgra(
            &mut translucent,
            &[64, 64, 64, 128],
            CaptionCompositeMode::Screen,
        );
        assert_eq!(translucent, [112, 112, 112, 255]);
    }

    #[test]
    fn difference_caption_is_composited_against_the_video_frame() {
        let mut plan = OverlayRenderPlan::compile(
            &designed_layout_document("caption-blend-difference"),
            320,
            180,
            3.0,
            30.0,
            None,
        )
        .unwrap();
        let overlay = plan.render_rgba(0.8).unwrap();
        let sample = overlay
            .chunks_exact(4)
            .position(|pixel| pixel[3] > 240)
            .expect("difference recipe 应产生近乎不透明的字形像素");
        let source = &overlay[sample * 4..sample * 4 + 4];
        let mut expected = [32_u8, 64, 96, 255];
        composite_caption_pixel_bgra(&mut expected, source, CaptionCompositeMode::Difference);

        let mut dark = vec![32_u8, 64, 96, 255].repeat(320 * 180);
        plan.composite_bgra(&mut dark, 320 * 4, 0.8).unwrap();
        let dark_changed = dark
            .chunks_exact(4)
            .filter(|pixel| *pixel != [32, 64, 96, 255])
            .count();
        assert!(dark_changed > 100);
        assert_eq!(&dark[sample * 4..sample * 4 + 4], &expected);
    }

    /// CPU 导出（`composite_bgra`）与 GPU 场景同一层序：元素 → 字幕 → 模板前景。
    /// 盖满画面的元素（主视频被元素化时就是这样）不得把字幕盖掉；非 normal 字幕
    /// 的底是「视频 + 元素」，与 GPU 按目标取样的口径相同。
    #[test]
    fn cpu_composite_keeps_captions_above_full_canvas_elements() {
        let full_canvas_element = json!({"tracks": [{"elements": [{
            "id": "cover", "kind": "shape", "start": 0.0, "end": 3.0,
            "shape": {"shape": "rect", "fill": "#FF0000"},
            "place": {"x": 50, "y": 50, "w": 100}
        }]}]});
        for (source, mode) in [
            (document("None", "none"), CaptionCompositeMode::Normal),
            (
                designed_layout_document("caption-blend-difference"),
                CaptionCompositeMode::Difference,
            ),
        ] {
            let caption = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None)
                .unwrap()
                .render_rgba(0.8)
                .unwrap();
            let sample = caption
                .chunks_exact(4)
                .position(|pixel| pixel[3] > 240)
                .expect("字幕应有近乎不透明的像素");

            let mut covered = source.clone();
            covered["timeline"] = full_canvas_element.clone();
            let mut backdrop_source = covered.clone();
            backdrop_source["cues"] = json!([]);
            let mut backdrop_plan =
                OverlayRenderPlan::compile(&backdrop_source, 320, 180, 3.0, 30.0, None).unwrap();
            backdrop_plan
                .load_projected_timeline_elements(&backdrop_source)
                .unwrap();
            let mut backdrop = vec![32_u8, 64, 96, 255].repeat(320 * 180);
            backdrop_plan
                .composite_bgra(&mut backdrop, 320 * 4, 0.8)
                .unwrap();
            assert_eq!(
                &backdrop[sample * 4..sample * 4 + 4],
                &[0, 0, 255, 255],
                "元素应盖满画面"
            );

            let mut plan = OverlayRenderPlan::compile(&covered, 320, 180, 3.0, 30.0, None).unwrap();
            plan.load_projected_timeline_elements(&covered).unwrap();
            let mut frame = vec![32_u8, 64, 96, 255].repeat(320 * 180);
            plan.composite_bgra(&mut frame, 320 * 4, 0.8).unwrap();
            let mut expected = [0_u8, 0, 255, 255];
            composite_caption_pixel_bgra(
                &mut expected,
                &caption[sample * 4..sample * 4 + 4],
                mode,
            );
            assert_ne!(expected, [0, 0, 255, 255], "{mode:?}");
            assert_eq!(&frame[sample * 4..sample * 4 + 4], &expected, "{mode:?}");
        }
    }

    #[test]
    fn render_plan_draws_styled_word_animation() {
        let mut plan = OverlayRenderPlan::compile(
            &document("Highlight", "magic-pop"),
            640,
            360,
            3.0,
            30.0,
            None,
        )
        .unwrap();
        let rgba = plan.render_rgba(0.8).unwrap();
        assert_eq!(rgba.len(), 640 * 360 * 4);
        assert!(rgba.chunks_exact(4).any(|pixel| pixel[3] > 0));
        assert!(
            rgba.chunks_exact(4).any(|pixel| {
                pixel[0] > 180 && pixel[1] > 120 && pixel[2] < 100 && pixel[3] > 0
            })
        );
        let bounds = rgba
            .chunks_exact(4)
            .enumerate()
            .filter(|(_, pixel)| pixel[3] > 0)
            .fold(
                None::<(usize, usize, usize, usize)>,
                |bounds, (index, _)| {
                    let point = (index % 640, index / 640);
                    Some(match bounds {
                        None => (point.0, point.1, point.0, point.1),
                        Some((left, top, right, bottom)) => (
                            left.min(point.0),
                            top.min(point.1),
                            right.max(point.0),
                            bottom.max(point.1),
                        ),
                    })
                },
            );
        // 底板纵向内边距是 pad_h ÷ 1.4（原型 `panel-substyle.jsx` 的 `padOf`：横向
        // 比纵向宽 1.4 倍），不再是 pad_h × 0.45：包围盒因此比上一版上下各放 2px。
        // 字形落点没变——单行块居中于锚点时 pad_v 在上下对消。
        assert_eq!(bounds, Some((255, 293, 384, 325)));
        // 描边宽度改口径（`textOutline.width` 是可见外扩量 ⇒ 居中线宽再乘 0.5）后
        // 字形描边变细一半；本轮几何对齐原型又改了底板纵向内边距（pad_h ÷ 1.4）、
        // 字距按本行字号缩放、阴影模糊不再被 0.9·字号夹住，像素随之重算。
        assert_eq!(
            lower_hex(&Sha256::digest(&rgba)),
            "86559b4099654620b8a690e0cda9dfcb171128e13f5b77a5ca01a24833ab6bc9"
        );
    }

    #[test]
    fn block_motion_hides_background_and_shadow_together_at_entry() {
        let mut doc = document("flipClock", "none");
        doc["style"]["wordAnimation"]["catalogId"] = json!("flipClock");
        doc["style"]["displayTiming"] = json!({"leadIn":0,"tail":0});
        doc["style"]["dropShadow"] = json!({"on":true,"color":"#000000","blur":0.1,"distance":0.1});
        let mut plan = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
        assert!(
            plan.render_rgba(0.5)
                .unwrap()
                .chunks_exact(4)
                .all(|p| p[3] == 0)
        );
        assert!(
            plan.render_rgba(0.9)
                .unwrap()
                .chunks_exact(4)
                .any(|p| p[3] != 0)
        );
    }

    #[test]
    fn word_motion_block_scale_uses_both_axes_and_centering_preserves_the_pivot() {
        let mut pose = word_motion::Pose {
            scale: 1.5,
            block_scaled: true,
            ..Default::default()
        };
        let mut point = tiny_skia::Point::from_xy(20.0, 10.0);
        word_transform_for_motion(&pose, 20.0, 10.0, 50.0, 30.0, 20.0).map_point(&mut point);
        assert_eq!(point, tiny_skia::Point::from_xy(5.0, 0.0));
        pose.centered = true;
        pose.scale = 0.88;
        let mut point = tiny_skia::Point::from_xy(20.0, 10.0);
        word_transform_for_motion(&pose, 20.0, 10.0, 50.0, 30.0, 20.0).map_point(&mut point);
        assert!((point.x - 50.0).abs() < 1e-5 && (point.y - 30.0).abs() < 1e-5);
    }

    #[test]
    fn every_catalog_motion_has_a_retained_gpu_scene_and_seek_safe_cpu_reference() {
        for anim in word_motion::WORD_ANIM_TRACKS
            .iter()
            .filter(|a| a.catalog_id != "none")
        {
            let id = anim.catalog_id;
            let mut doc = document(id, "none");
            doc["style"]["wordAnimation"] = json!({"animationName": id, "catalogId": id,
                "active": {"color":"#635bff", "backgroundColor":"#635bff"}});
            doc["style"]["background"] = json!(false);
            doc["style"]["displayTiming"] = json!({"leadIn":0,"tail":0});
            let mut plan = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
            assert_eq!(
                plan.subtitle_scene_static_fallback(),
                None,
                "{id} must not force the whole preview onto CPU"
            );
            let early_scene = plan
                .subtitle_scene_frame(0.54)
                .unwrap_or_else(|fallback| panic!("{id} GPU scene: {fallback}"));
            let later_scene = plan
                .subtitle_scene_frame(1.6)
                .unwrap_or_else(|fallback| panic!("{id} later GPU scene: {fallback}"));
            assert!(
                !early_scene.scene.nodes.is_empty(),
                "{id} GPU scene disappeared"
            );
            assert!(
                !later_scene.scene.nodes.is_empty(),
                "{id} later GPU scene disappeared"
            );
            assert_ne!(
                early_scene.scene.fingerprint, later_scene.scene.fingerprint,
                "{id} GPU scene identity must follow its per-frame motion"
            );
            let early = plan.render_rgba(0.54).unwrap();
            let later = plan.render_rgba(1.6).unwrap();
            assert_ne!(early, later, "{id} must animate between keyframes");
            assert!(later.chunks_exact(4).any(|p| p[3] != 0), "{id} disappeared");
            let png = plan.render_png(1.6).unwrap();
            assert_eq!(
                Pixmap::decode_png(&png.png).unwrap().data(),
                later.as_slice(),
                "{id}: export"
            );
            plan.render_rgba(1.8).unwrap();
            assert_eq!(
                plan.render_rgba(0.54).unwrap(),
                early,
                "{id}: seeking must be deterministic"
            );
            let mut cold = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
            assert_eq!(
                cold.render_rgba(1.6).unwrap(),
                later,
                "{id}: cache must not freeze motion"
            );
        }
    }

    /// 浏览器保留的显式 raster 交付口必须是 `putImageData` 能直接吃的形状
    /// （straight alpha ＋ 非零子矩形）。已发布样式都应走 GPU scene；这个入口
    /// 只服务无效 glyph / scene 上限等运行时兜底，不能再由目录样式触发。
    #[test]
    fn browser_raster_layer_is_the_straight_alpha_subrect_of_the_cpu_subtitle_frame() {
        let mut doc = document("boxHighlight", "none");
        doc["style"]["wordAnimation"] = json!({
            "animationName": "boxHighlight", "catalogId": "boxHighlight",
            "active": {"color": "#FFFFFF", "backgroundColor": "#6147FF"}
        });
        let mut plan = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
        assert_eq!(plan.subtitle_scene_static_fallback(), None);

        let premultiplied = plan.render_subtitle_frame(0.54).unwrap();
        let bounds = premultiplied.bounds.clone().expect("字幕这一刻必须有像素");
        let layer = plan.render_subtitle_raster_layer(0.54).unwrap();
        assert_eq!(layer.key, premultiplied.key);
        assert_eq!(layer.composite, CaptionCompositeMode::Normal);
        assert_eq!(
            (layer.x as usize, layer.y as usize),
            (bounds.cols.start, bounds.rows.start)
        );
        assert_eq!(layer.width as usize, bounds.cols.end - bounds.cols.start);
        assert_eq!(layer.height as usize, bounds.rows.end - bounds.rows.start);
        assert_eq!(
            layer.rgba.len(),
            layer.width as usize * layer.height as usize * 4
        );

        // 逐像素对位：alpha 不动，颜色通道只许被放大。半透明边缘一个都没放大
        // 就说明没解预乘——那会给每个抗锯齿字形边缘描一道暗边。
        let mut lifted = 0usize;
        for row in 0..layer.height as usize {
            for col in 0..layer.width as usize {
                let source = ((bounds.rows.start + row) * 320 + bounds.cols.start + col) * 4;
                let target = (row * layer.width as usize + col) * 4;
                assert_eq!(layer.rgba[target + 3], premultiplied.rgba[source + 3]);
                for channel in 0..3 {
                    assert!(layer.rgba[target + channel] >= premultiplied.rgba[source + channel]);
                }
                let alpha = premultiplied.rgba[source + 3];
                if (1..255).contains(&alpha)
                    && (0..3).any(|c| layer.rgba[target + c] > premultiplied.rgba[source + c])
                {
                    lifted += 1;
                }
            }
        }
        assert!(lifted > 0, "没有一个半透明像素被解乘，解预乘没生效");

        // 同一时刻重问必须逐字节一致（宿主拿 key 决定能不能留住上一帧位图）。
        let again = plan.render_subtitle_raster_layer(0.54).unwrap();
        assert_eq!(again.key, layer.key);
        assert_eq!(again.rgba, layer.rgba);

        // 键必须在**同一个词内**逐帧推进。宿主的 `unchanged` 只看键：键若按
        // (cue, 当前词) 定身份，第一帧之后每帧都会 `unchanged`，字幕出得来但动画
        // 冻住——静态截图看不出来的假修复。逐词动画正是靠 `motion_id.is_some()`
        // 同时点亮 `word_box_animated`，让缓存键带上帧号。
        let mid_word = plan.render_subtitle_raster_layer(1.5).unwrap();
        let late_word = plan.render_subtitle_raster_layer(2.0).unwrap();
        assert_ne!(
            mid_word.key, late_word.key,
            "同一个词内键没变，宿主会把整段动画冻在第一帧"
        );
        assert_ne!(
            mid_word.rgba, late_word.rgba,
            "同一个词内像素没变，逐词动画根本没在动"
        );

        // 透明时刻交付空图层而不是整幅透明缓冲（宿主据此整块卸掉图层）。
        doc["style"]["displayTiming"] = json!({"leadIn": 0, "tail": 0});
        doc["cues"][0]["start"] = json!(1.5);
        let mut quiet = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
        let blank = quiet.render_subtitle_raster_layer(0.2).unwrap();
        assert_eq!((blank.width, blank.height), (0, 0));
        assert!(blank.rgba.is_empty());
    }

    #[test]
    fn designed_caption_palette_tuning_and_word_roles_reach_the_renderer() {
        let mut styled = document("None", "none");
        styled["cues"][0]["words"][0]["id"] = json!("w1");
        styled["cues"][0]["words"][1]["id"] = json!("w2");
        styled["style"]["wordAnimation"]["caption"] = json!({
            "schema": 1,
            "style": {"id": "caption-highlight", "version": 1},
            "content": "orig",
            "palette": {"primary": "#EAEAEA", "accent": "#00FF66"},
            "intensity": 80,
            "speed": 1.5
        });
        styled["style"]["captionEmphasis"] = json!({
            "w2": {"anchorText":"world", "role":"hero", "color":"#FF00AA"}
        });

        let animation = word_animation(&styled["style"]);
        assert_eq!(animation.name, "Designed");
        let design = animation.caption.as_ref().unwrap();
        assert_eq!(design.style_id, "caption-highlight");
        assert_eq!(design.speed, 1.5);
        assert_eq!(design.intensity, 0.8);
        assert_eq!(design.overrides["w2"].role, "hero");

        let items = timed_items(
            styled["cues"].as_array().unwrap(),
            "text",
            &styled["style"],
            "und",
        );
        let active = word_visual(&animation, &items[0], 0, 0, 0.8, 30.0);
        assert_eq!(active.background, parse_css_color("#00FF66"));
        assert_eq!(active.color, parse_css_color("#00FF66"));
        let hero = word_visual(&animation, &items[0], 1, 0, 0.8, 30.0);
        assert_eq!(hero.color, parse_css_color("#FF00AA"));
        assert_eq!(
            hero.recipe.as_ref().map(|value| value.role.as_str()),
            Some("hero")
        );

        let mut designed = OverlayRenderPlan::compile(&styled, 640, 360, 3.0, 30.0, None).unwrap();
        let mut plain =
            OverlayRenderPlan::compile(&document("None", "none"), 640, 360, 3.0, 30.0, None)
                .unwrap();
        assert_ne!(
            designed.render_rgba(0.8).unwrap(),
            plain.render_rgba(0.8).unwrap(),
            "Designed Caption 不能只在面板里有选中态"
        );
        assert_ne!(
            designed.render_png(0.80).unwrap().subtitle_key,
            designed.render_png(0.84).unwrap().subtitle_key,
            "attack 期间必须按帧失效，speed/intensity 才会进入画面"
        );
    }

    #[test]
    fn designed_caption_gradient_and_texture_use_native_pattern_paints() {
        let make = |style_id: &str, options: Value| {
            let style = json!({
                "wordAnimation": {
                    "caption": {
                        "schema": 1,
                        "style": {"id": style_id, "version": 1},
                        "content": "orig",
                        "palette": {"primary": "#FFFFFF", "accent": "#FFD43B"},
                        "options": options
                    }
                }
            });
            let animation = word_animation(&style);
            let source = document("None", "none");
            let items = timed_items(source["cues"].as_array().unwrap(), "text", &style, "und");
            let visual = word_visual(&animation, &items[0], 0, 0, 0.8, 30.0);
            (animation, visual)
        };

        let (gradient, gradient_visual) = make("caption-gradient-fill", json!([]));
        let gradient_paint = caption_recipe_glyph_paint(
            &gradient,
            &gradient_visual,
            SubtitleColor::WHITE,
            1.0,
            true,
        )
        .unwrap();
        assert!(matches!(
            gradient_paint.shader,
            tiny_skia::Shader::LinearGradient(_)
        ));

        let (texture, texture_visual) = make(
            "caption-texture",
            json!([{"kind":"text", "key":"texture", "text":"wood"}]),
        );
        let texture_paint =
            caption_recipe_glyph_paint(&texture, &texture_visual, SubtitleColor::WHITE, 1.0, true)
                .unwrap();
        assert!(matches!(
            texture_paint.shader,
            tiny_skia::Shader::Pattern(_)
        ));
    }

    #[test]
    fn unavailable_or_non_original_designed_caption_never_falls_back_to_basic() {
        for (style_id, content) in [
            ("caption-not-installed", "orig"),
            ("caption-highlight", "trans"),
        ] {
            let style = json!({
                "wordAnimation": {
                    "caption": {
                        "schema": 1,
                        "style": {"id": style_id, "version": 1},
                        "content": content
                    }
                }
            });
            let animation = word_animation(&style);
            let source = document("None", "none");
            let items = timed_items(source["cues"].as_array().unwrap(), "text", &style, "und");
            let visual = word_visual(&animation, &items[0], 0, 0, 0.8, 30.0);
            assert_eq!(visual.opacity, Some(0.0));
        }
    }

    #[test]
    fn all_sixteen_designed_caption_recipes_render_seek_safe_pixels() {
        for descriptor in caption_recipe_descriptors() {
            let mut styled = document("None", "none");
            styled["cues"][0]["words"][0]["id"] = json!("w1");
            styled["cues"][0]["words"][1]["id"] = json!("w2");
            styled["style"]["wordAnimation"]["caption"] = json!({
                "schema": 1,
                "style": {"id": descriptor.id, "version": descriptor.version},
                "content": "orig",
                "palette": {"primary": "#FFFFFF", "accent": "#FFD43B"},
                "intensity": 60,
                "speed": 1,
                "seed": 42
            });
            styled["style"]["captionEmphasis"] = json!({
                "w1": {"anchorText":"Hello", "role":"hero"}
            });
            let mut first = OverlayRenderPlan::compile(&styled, 640, 360, 3.0, 30.0, None).unwrap();
            let mut second =
                OverlayRenderPlan::compile(&styled, 640, 360, 3.0, 30.0, None).unwrap();
            let first = first.render_rgba(0.8).unwrap();
            let second = second.render_rgba(0.8).unwrap();
            assert_eq!(first, second, "{} 必须 seek-safe", descriptor.id);
            assert!(
                first.chunks_exact(4).any(|pixel| pixel[3] != 0),
                "{} 不得渲染为空帧",
                descriptor.id
            );
        }
    }

    /// 倒鸭子端到端：`caption-daoyazi` 让 `OverlayRenderPlan` 接管原文轨，CPU 与 GPU
    /// 两条路都画出序列层（裁在字幕区域），且 seek-safe；译文行仍走 cue 级排版。
    #[test]
    fn daoyazi_sequence_takes_over_the_original_track_on_both_render_paths() {
        let mut styled = document("None", "none");
        styled["cues"][0]["words"][0]["id"] = json!("w1");
        styled["cues"][0]["words"][1]["id"] = json!("w2");
        styled["style"]["wordAnimation"]["caption"] = json!({
            "schema": 1,
            "style": {"id": "caption-daoyazi", "version": 1},
            "content": "orig",
            "palette": {"primary": "#FFFFFF", "accent": "#FF9B42", "secondary": "#59BAF2"},
            "intensity": 60,
            "speed": 1,
            "seed": 137,
            "options": [{
                "kind": "object",
                "key": "daoyazi",
                "value": {"camera": {"motion": "stopAndGo"}, "presentation": {"viewportMode": "full"}}
            }]
        });
        let compile = || OverlayRenderPlan::compile(&styled, 640, 360, 3.0, 30.0, None).unwrap();
        let mut plan = compile();
        assert!(plan.caption_sequence_active());
        let sequence = plan.ensure_caption_sequence().expect("序列计划");
        assert!(!sequence.sequences.is_empty(), "{:?}", sequence.diagnostics);
        assert_eq!(sequence.seed, 137);
        assert!(
            plan.active_layouts(0.8).is_empty(),
            "接管后原文行不再走 cue 级排版"
        );

        let frame = plan.render_subtitle_frame(0.8).unwrap();
        assert!(frame.key.starts_with("dz"), "{}", frame.key);
        assert!(
            frame.rgba.chunks_exact(4).any(|pixel| pixel[3] != 0),
            "序列层不得是空帧"
        );
        let bounds = frame.bounds.clone().expect("落笔包围盒");
        let [vx, vy, vw, vh] = sequence.viewport;
        assert!(
            bounds.cols.start as f64 >= vx.floor() && bounds.cols.end as f64 <= (vx + vw).ceil()
        );
        assert!(
            bounds.rows.start as f64 >= vy.floor() && bounds.rows.end as f64 <= (vy + vh).ceil()
        );
        let again = compile().render_subtitle_frame(0.8).unwrap();
        assert_eq!(again.key, frame.key);
        assert_eq!(*again.rgba, *frame.rgba, "seek-safe");
        assert_eq!(
            *plan.render_subtitle_frame(0.8).unwrap().rgba,
            *frame.rgba,
            "缓存命中同帧"
        );

        let scene = plan.subtitle_scene_frame(0.8).expect("序列层走 GPU scene");
        let runs: Vec<_> = scene
            .scene
            .nodes
            .iter()
            .filter_map(|node| match node {
                element_draw::SceneNode::Glyphs(run) => Some(run),
                _ => None,
            })
            .collect();
        assert!(!runs.is_empty(), "scene 必须带序列层 glyph run");
        assert!(
            runs.iter()
                .all(|run| run.uniforms.iter().all(|uniform| uniform.clip.is_some())),
            "序列层每个 uniform 都裁在字幕区域"
        );
        assert!(scene.key.starts_with("dz"), "{}", scene.key);
        assert!(scene.scene.next_change.is_some_and(|next| next > 0.8));
    }

    fn designed_layout_document(style_id: &str) -> Value {
        let mut styled = document("None", "none");
        styled["cues"][0]["words"][0]["id"] = json!("w1");
        styled["cues"][0]["words"][1]["id"] = json!("w2");
        styled["style"]["wordAnimation"]["caption"] = json!({
            "schema": 1,
            "style": {"id": style_id, "version": 1},
            "content": "orig",
            "palette": {"primary": "#FFFFFF", "accent": "#FFD43B"}
        });
        styled
    }

    #[test]
    fn every_bundled_caption_recipe_has_exact_scene_ownership_or_target_sampling_only() {
        for descriptor in caption_recipe_descriptors() {
            let mut source = designed_layout_document(&descriptor.id);
            source["style"]["background"] = json!(false);
            source["style"]["outline"] = json!(false);
            source["style"]["underline"] = json!(false);
            source["style"]["glow"] = json!({"on": false});
            source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
            let plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None)
                .unwrap_or_else(|error| panic!("compile {}: {error}", descriptor.id));

            if descriptor.id == "caption-blend-difference" {
                assert_eq!(
                    plan.subtitle_scene_static_fallback(),
                    Some(SubtitleSceneFallback::CompositeMode),
                    "public overlay scene cannot sample the video backdrop"
                );
            } else {
                assert_eq!(
                    plan.subtitle_scene_static_fallback(),
                    None,
                    "{} must have an exact retained scene",
                    descriptor.id
                );
            }
            plan.compositor_scene_support().unwrap_or_else(|error| {
                panic!(
                    "{} must be supported when the host provides target sampling: {error}",
                    descriptor.id
                )
            });
        }
    }

    #[cfg(target_os = "macos")]
    fn caption_golden_document(style_id: &str, texts: &[&str], language: &str) -> Value {
        let words = texts
            .iter()
            .enumerate()
            .map(|(index, text)| {
                json!({
                    "id": format!("gold-{index}"),
                    "text": text,
                    "t0": index as f64 * 0.5,
                    "t1": index as f64 * 0.5 + 0.42,
                    "sp": "s"
                })
            })
            .collect::<Vec<_>>();
        let text = if language == "zh" {
            texts.concat()
        } else {
            texts.join(" ")
        };
        let options = (style_id == "caption-particle-burst")
            .then(|| vec![json!({"kind":"number", "key":"particleCount", "number":12})])
            .unwrap_or_default();
        json!({
            "meta": {"duration": 1.92, "sourceLang": {"code": language}},
            "style": {
                "mode": "orig",
                "fontFamily": {"type":"default", "fontFamily":"Montserrat"},
                "fontSize": 34,
                "fontColor": "#FFFFFF",
                "bold": true,
                "background": false,
                "backgroundPadding": 10,
                "lineHeight": 1.2,
                "x": 50,
                "y": 50,
                "width": 84,
                "scale": 1,
                "captionEmphasis": {
                    "gold-1": {
                        "anchorText": texts[1],
                        "role": "hero",
                        "color": "#00E5FF",
                        "emoji": "✨"
                    }
                },
                "wordAnimation": {"animationName":"None", "caption": {
                    "schema": 1,
                    "style": {"id": style_id, "version": 1},
                    "content": "orig",
                    "palette": {
                        "primary": "#FFFFFF",
                        "accent": "#FF4D6D",
                        "backdrop": "#07111F"
                    },
                    "intensity": 72,
                    "speed": 1.1,
                    "seed": 31415,
                    "options": options
                }}
            },
            "cues": [{
                "id": "gold-cue",
                "start": 0.0,
                "end": 1.92,
                "text": text,
                "sp": "s",
                "words": words
            }],
            "sentences": [],
            "transCues": []
        })
    }

    #[cfg(target_os = "macos")]
    fn caption_golden_backdrop(width: u32, height: u32, variant: usize) -> Pixmap {
        fn fill(pixmap: &mut Pixmap, rect: tiny_skia::Rect, rgba: [u8; 4]) {
            let mut paint = tiny_skia::Paint::default();
            paint.set_color_rgba8(rgba[0], rgba[1], rgba[2], rgba[3]);
            pixmap.fill_rect(rect, &paint, Transform::identity(), None);
        }

        let mut pixmap = Pixmap::new(width, height).unwrap();
        fill(
            &mut pixmap,
            tiny_skia::Rect::from_xywh(0.0, 0.0, width as f32, height as f32).unwrap(),
            [9, 35, 67, 255],
        );
        let split = width as f32 * (0.38 + variant as f32 * 0.08);
        fill(
            &mut pixmap,
            tiny_skia::Rect::from_xywh(split, 0.0, width as f32 - split, height as f32).unwrap(),
            [241, 95, 39, 255],
        );
        let square = 18_u32;
        let mut y = 0_u32;
        let mut row = 0_u32;
        while y < height {
            let mut x = if row.is_multiple_of(2) { 0 } else { square };
            while x < width {
                fill(
                    &mut pixmap,
                    tiny_skia::Rect::from_xywh(x as f32, y as f32, square as f32, square as f32)
                        .unwrap(),
                    [255, 255, 255, 31],
                );
                x += square * 2;
            }
            y += square;
            row += 1;
        }
        pixmap
    }

    #[cfg(target_os = "macos")]
    fn caption_golden_contact_sheet(style_id: &str) -> Pixmap {
        let scenarios = [
            (
                256_u32,
                144_u32,
                ["Designed", "captions", "stay", "editable"],
                "en",
            ),
            (144, 256, ["Designed", "captions", "stay", "editable"], "en"),
            (256, 144, ["设计", "字幕", "保持", "可编辑"], "zh"),
        ];
        let times = [0.0, 0.24, 0.76, 1.82];
        let mut sheet = Pixmap::new(816, 1088).unwrap();
        sheet.fill(tiny_skia::Color::BLACK);
        for (column, (width, height, texts, language)) in scenarios.iter().enumerate() {
            for (row, time) in times.iter().copied().enumerate() {
                let backdrop = caption_golden_backdrop(*width, *height, row);
                let mut bgra = backdrop
                    .data()
                    .chunks_exact(*width as usize * 4)
                    .rev()
                    .flat_map(|row| row.chunks_exact(4))
                    .flat_map(|pixel| [pixel[2], pixel[1], pixel[0], pixel[3]])
                    .collect::<Vec<_>>();
                let document = caption_golden_document(style_id, texts, language);
                let mut plan =
                    OverlayRenderPlan::compile(&document, *width, *height, 1.92, 60.0, None)
                        .unwrap();
                plan.composite_bgra(&mut bgra, *width as usize * 4, time)
                    .unwrap();
                let rgba = bgra
                    .chunks_exact(4)
                    .flat_map(|pixel| [pixel[2], pixel[1], pixel[0], pixel[3]])
                    .collect::<Vec<_>>();
                let rendered =
                    Pixmap::from_vec(rgba, tiny_skia::IntSize::from_wh(*width, *height).unwrap())
                        .unwrap();
                let x = column as i32 * 272 + (272 - *width as i32) / 2;
                let y = (3 - row) as i32 * 272 + (272 - *height as i32) / 2;
                sheet.draw_pixmap(
                    x,
                    y,
                    rendered.as_ref(),
                    &tiny_skia::PixmapPaint::default(),
                    Transform::identity(),
                    None,
                );
            }
        }
        sheet
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn all_caption_recipes_stay_within_the_mac_renderer_goldens() {
        let directory =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/caption-goldens");
        // CoreText and cosmic-text rasterize the same font outlines differently.
        // These per-recipe envelopes are the frozen cross-engine baseline plus
        // 0.1–0.2 percentage points; backdrop/layout/timing/effect drift still
        // crosses the gate, while subpixel antialiasing does not.
        let limits = HashMap::from([
            ("caption-blend-difference", 0.014),
            ("caption-clip-wipe", 0.011),
            ("caption-editorial-emphasis", 0.012),
            ("caption-emoji-pop", 0.011),
            ("caption-glitch-rgb", 0.016),
            ("caption-gradient-fill", 0.015),
            ("caption-highlight", 0.014),
            // 当前 CoreText ↔ cosmic-text 基线为 3.2569%；保留 0.14 个百分点
            // 的既定跨引擎光栅化余量，仍能捕获布局、时序或效果漂移。
            ("caption-kinetic-slam", 0.034),
            ("caption-matrix-decode", 0.012),
            ("caption-neon-accent", 0.014),
            ("caption-neon-glow", 0.017),
            ("caption-parallax-layers", 0.012),
            ("caption-particle-burst", 0.011),
            ("caption-pill-karaoke", 0.015),
            ("caption-texture", 0.014),
            ("caption-weight-shift", 0.016),
        ]);
        for descriptor in caption_recipe_descriptors() {
            // 跨句序列配方（倒鸭子）的画面由 `CaptionSequencePlan` 接管，不是 cue 级
            // 接触表；它的像素回归在 `caption_sequence_tests` 与端到端测试里。
            if descriptor.is_sequence() {
                continue;
            }
            let fixture = directory.join(format!("{}.png", descriptor.id));
            let expected = Pixmap::decode_png(&std::fs::read(fixture).unwrap()).unwrap();
            let actual = caption_golden_contact_sheet(&descriptor.id);
            assert_eq!(actual.width(), expected.width(), "{} width", descriptor.id);
            assert_eq!(
                actual.height(),
                expected.height(),
                "{} height",
                descriptor.id
            );
            let mut changed = 0_usize;
            let mut max_delta = 0_u8;
            for (actual, expected) in actual.data().iter().zip(expected.data()) {
                let delta = actual.abs_diff(*expected);
                changed += usize::from(delta > 2);
                max_delta = max_delta.max(delta);
            }
            let fraction = changed as f64 / actual.data().len() as f64;
            let limit = limits[descriptor.id.as_str()];
            assert!(
                fraction <= limit,
                "{}: {:.4}% bytes changed (limit {:.4}%), max delta {max_delta}",
                descriptor.id,
                fraction * 100.0,
                limit * 100.0,
            );
        }
    }

    #[test]
    fn dual_band_and_editorial_layouts_follow_mac_band_order_and_font_roles() {
        let mut dual = OverlayRenderPlan::compile(
            &designed_layout_document("caption-parallax-layers"),
            640,
            360,
            3.0,
            30.0,
            None,
        )
        .unwrap();
        let dual = dual.active_layouts(0.8);
        let dual = &dual[0];
        assert_eq!(dual.lines.len(), 2);
        assert_eq!(
            dual.lines[0].chunks.iter().find_map(|chunk| chunk.word),
            Some(0)
        );
        assert_eq!(
            dual.lines[1].chunks.iter().find_map(|chunk| chunk.word),
            Some(1)
        );
        assert!(dual.lines[0].chunks[0].font_size > dual.lines[1].chunks[0].font_size);
        assert!(dual.lines[0].gap_after > 0.0);

        let mut editorial = designed_layout_document("caption-editorial-emphasis");
        editorial["style"]["captionEmphasis"] = json!({
            "w2": {"anchorText":"world", "role":"hero"}
        });
        let mut editorial =
            OverlayRenderPlan::compile(&editorial, 640, 360, 3.0, 30.0, None).unwrap();
        let editorial = editorial.active_layouts(0.8);
        let editorial = &editorial[0];
        assert_eq!(editorial.lines.len(), 2);
        assert_eq!(
            editorial.lines[0]
                .chunks
                .iter()
                .find_map(|chunk| chunk.word),
            Some(0),
            "editorialBlock 先排 ordinary band"
        );
        let hero = editorial.lines[1]
            .chunks
            .iter()
            .find(|chunk| chunk.word == Some(1))
            .unwrap();
        assert!(hero.italic);
        assert_eq!(hero.font_weight, 700);
        assert!(hero.font_size > editorial.lines[0].chunks[0].font_size);
    }

    #[test]
    fn full_screen_word_layout_uses_visible_group_fit_and_center_anchor() {
        let mut plan = OverlayRenderPlan::compile(
            &designed_layout_document("caption-kinetic-slam"),
            640,
            360,
            3.0,
            30.0,
            None,
        )
        .unwrap();
        let layouts = plan.active_layouts(0.8);
        assert_eq!(layouts[0].lines.len(), 1);
        assert_eq!(
            layouts[0].lines[0]
                .chunks
                .iter()
                .find_map(|chunk| chunk.word),
            Some(0)
        );
        assert!(layouts[0].width <= 640.0 * 0.86 + 0.5);
        let stack = plan.stack_layout(&layouts, 640.0_f64.min(360.0) / 540.0);
        assert_eq!(stack.anchor, (320.0, 180.0));
    }

    #[test]
    fn overlay_png_reuses_settled_word_state_and_reports_next_boundary() {
        let mut plan =
            OverlayRenderPlan::compile(&document("Highlight", "none"), 640, 360, 3.0, 30.0, None)
                .unwrap();
        let first = plan.render_png(0.8).unwrap();
        let settled = plan.render_png(0.9).unwrap();
        let next_word = plan.render_png(1.25).unwrap();
        assert_eq!(&first.png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(first.subtitle_key, settled.subtitle_key);
        assert_eq!(first.next_change, Some(1.2));
        assert_ne!(first.subtitle_key, next_word.subtitle_key);
        assert!(next_word.next_change.is_some_and(|value| value > 1.25));

        let mut animated =
            OverlayRenderPlan::compile(&document("None", "magic-fade"), 640, 360, 3.0, 30.0, None)
                .unwrap();
        let animation_frame = animated.render_png(0.01).unwrap();
        assert!(
            (animation_frame.next_change.unwrap() - 1.0 / 60.0).abs() < 1e-6,
            "transition invalidation must follow the renderer's rounded frame buckets"
        );
    }

    /// 方案 §5.4 S14：字幕入场姿态由 serve 烘进 PNG，客户端不能也不该二次施加，
    /// 所以 Mac `Stage/Frame/StageFrameMotion.swift::subtitlePoseNodes` 的两处压制
    /// （任意字幕被选中 / Designed Caption 让位）只能从这里开口。
    ///
    /// 三条不变量：压制后的入场帧 == 落定帧；键必须与不压制时区分开（否则
    /// Designed Caption 的逐帧键会在同一帧号上撞成一张图）；默认仍是不压制。
    #[test]
    fn suppressed_transition_renders_the_settled_pose_without_colliding_keys() {
        let pixels = |frame: &OverlayFrame| Pixmap::decode_png(&frame.png).unwrap().data().to_vec();
        let mut plan =
            OverlayRenderPlan::compile(&document("None", "magic-fade"), 640, 360, 3.0, 30.0, None)
                .unwrap();
        let animating = plan.render_png(0.01).unwrap();

        let mut suppressed =
            OverlayRenderPlan::compile(&document("None", "magic-fade"), 640, 360, 3.0, 30.0, None)
                .unwrap();
        suppressed.set_suppress_transition(true);
        let suppressed_entrance = suppressed.render_png(0.01).unwrap();

        // 同一时刻、无转场的那份文档就是压制后应有的样子（逐词状态一并对上）。
        let mut without =
            OverlayRenderPlan::compile(&document("None", "none"), 640, 360, 3.0, 30.0, None)
                .unwrap();
        let plain = without.render_png(0.01).unwrap();
        assert_eq!(pixels(&suppressed_entrance), pixels(&plain));
        assert_ne!(pixels(&animating), pixels(&plain));

        // 键必须分得开：同一实例在两种压制状态间切换时不得复用上一张缓存帧。
        assert_ne!(animating.subtitle_key, suppressed_entrance.subtitle_key);
        // 落定之后两条路径本就是同一张图，键也应当一致（不该无谓打散缓存）。
        assert_eq!(
            plan.render_png(1.0).unwrap().subtitle_key,
            suppressed.render_png(1.0).unwrap().subtitle_key
        );
    }

    #[test]
    fn transition_pose_matches_preview_contract() {
        let style = &document("None", "magic-fade")["style"];
        let start = transition_pose(style, 0.0, 0.0, 1.0, 30.0);
        let settled = transition_pose(style, 0.0, 0.3, 1.0, 30.0);
        assert!(start.active);
        assert_eq!(start.opacity, 0.0);
        assert_eq!(start.blur, 6.0);
        assert_eq!(settled, TransitionPose::IDENTITY);
    }

    #[test]
    fn rust_transition_and_word_states_match_shared_preview_fixtures() {
        let contract: Value = serde_json::from_str(include_str!(
            "../../speech-doc/tests/fixtures/subtitle-render-contract.json"
        ))
        .unwrap();
        for row in contract["displayWindows"].as_array().unwrap() {
            let items = timed_items(row["items"].as_array().unwrap(), "text", &json!({}), "und");
            let actual = &items[row["index"].as_u64().unwrap() as usize];
            assert!(
                (actual.display_start - row["expected"]["start"].as_f64().unwrap()).abs() < 1e-9
            );
            assert!((actual.display_end - row["expected"]["end"].as_f64().unwrap()).abs() < 1e-9);
        }
        for row in contract["modes"].as_array().unwrap() {
            let mode = StudioMode::parse(row["mode"].as_str().unwrap()).unwrap();
            let actual = mode_lines(mode, row["order"].as_str().unwrap())
                .into_iter()
                .map(|kind| match kind {
                    LineKind::Original => "orig",
                    LineKind::Translation => "trans",
                })
                .collect::<Vec<_>>();
            assert_eq!(
                actual,
                serde_json::from_value::<Vec<String>>(row["expected"].clone()).unwrap()
            );
        }
        for row in contract["punctuationProjections"].as_array().unwrap() {
            let text = row["text"].as_str().unwrap();
            let actual = projected_text(
                text,
                row["language"].as_str().unwrap(),
                row["enabled"].as_bool().unwrap(),
            );
            assert_eq!(actual, row["expected"].as_str().unwrap());
        }
        for row in contract["transitions"].as_array().unwrap() {
            let style = json!({"transition": {
                "transitionId": row["id"], "transitionSpeed": row["speed"]
            }});
            let pose = transition_pose(
                &style,
                row["displayStart"].as_f64().unwrap(),
                row["time"].as_f64().unwrap(),
                row["scale"].as_f64().unwrap(),
                row["fps"].as_f64().unwrap(),
            );
            let expected = &row["expected"];
            assert!((pose.opacity - expected["opacity"].as_f64().unwrap()).abs() < 1e-9);
            assert!((pose.scale_x - expected["scaleX"].as_f64().unwrap()).abs() < 1e-9);
            assert!((pose.scale_y - expected["scaleY"].as_f64().unwrap()).abs() < 1e-9);
            assert!((pose.blur - expected["blur"].as_f64().unwrap()).abs() < 1e-9);
            assert_eq!(pose.active, expected["active"]);
        }
        for row in contract["lineFontSizes"].as_array().unwrap() {
            let kind = match row["line"].as_str().unwrap() {
                "trans" => LineKind::Translation,
                _ => LineKind::Original,
            };
            let style = resolve_line_style(
                &row["style"],
                kind,
                row["frame"]["width"].as_u64().unwrap() as u32,
                row["frame"]["height"].as_u64().unwrap() as u32,
                row["compactOriginal"].as_bool().unwrap(),
            );
            assert!(
                (style.font_size - row["expected"].as_f64().unwrap()).abs() < 1e-9,
                "{}",
                row["name"].as_str().unwrap()
            );
        }
        for row in contract["styleMetrics"].as_array().unwrap() {
            let style = resolve_line_style(
                &row["style"],
                LineKind::Original,
                row["frame"]["width"].as_u64().unwrap() as u32,
                row["frame"]["height"].as_u64().unwrap() as u32,
                false,
            );
            let expected = &row["expected"];
            assert!(
                (style.background_radius - expected["borderRadius"].as_f64().unwrap()).abs() < 1e-9,
                "{}",
                row["name"]
            );
            assert!(
                (style.background_min_width - expected["blockMinWidth"].as_f64().unwrap()).abs()
                    < 1e-9,
                "{}",
                row["name"]
            );
            assert!(
                (style.letter_spacing - expected["letterSpacing"].as_f64().unwrap()).abs() < 1e-9,
                "{}",
                row["name"]
            );
        }
        for row in contract["textTransforms"].as_array().unwrap() {
            assert_eq!(
                transform_text(
                    row["text"].as_str().unwrap(),
                    row["transform"].as_str().unwrap()
                ),
                row["expected"].as_str().unwrap()
            );
        }
        for row in contract["wordAnimations"].as_array().unwrap() {
            let style = json!({"wordAnimation": {"animationName": row["name"]}});
            let animation = word_animation(&style);
            let visual = word_state(
                &animation,
                row["index"].as_u64().unwrap() as usize,
                row["current"].as_u64().unwrap() as usize,
                // 共享 fixture 里没有一条带块轨的效果；相位取 0 即可，
                // 没有 `box_track` 的效果对它免疫。
                0.0,
            );
            let expected = &row["expected"];
            if let Some(color) = expected.get("color").and_then(Value::as_str) {
                assert_eq!(visual.color, parse_css_color(color));
            }
            if let Some(opacity) = expected.get("opacity").and_then(Value::as_f64) {
                assert_eq!(visual.opacity, Some(opacity));
            }
            if let Some(background) = expected.get("backgroundColor").and_then(Value::as_str) {
                assert_eq!(visual.background, parse_css_color(background));
            }
            if let Some(radius) = expected.get("borderRadiusEm").and_then(Value::as_f64) {
                assert_eq!(visual.border_radius_em, Some(radius));
            }
            if let Some(bottom) = expected.get("bottomEm").and_then(Value::as_f64) {
                assert_eq!(visual.bottom_em, Some(bottom));
            }
            if let Some(underline) = expected.get("underline").and_then(Value::as_bool) {
                assert_eq!(visual.underline, Some(underline));
            }
            if let Some(offset) = expected.get("underlineOffsetEm").and_then(Value::as_f64) {
                assert_eq!(visual.underline_offset_em, Some(offset));
            }
            if let Some(shadow_off) = expected.get("shadowOff").and_then(Value::as_bool) {
                assert_eq!(visual.shadow_off, shadow_off);
            }
        }
    }

    #[test]
    fn pending_style_and_text_are_merged_without_mutating_project_truth() {
        let mut data = document("None", "none");
        let base = serde_json::to_string(&data["style"]).unwrap();
        let overlay = json!({
            "style": {"base": base, "value": {"fontSize": 44, "mode": "orig"}},
            "edits": {"q1": {"text": {"base": "Hello world", "value": "Edited text"}}}
        });
        apply_preview_overlays(&mut data, &overlay);
        assert_eq!(data["style"]["fontSize"], 44);
        assert_eq!(data["cues"][0]["text"], "Edited text");
        assert!(data["cues"][0].get("words").is_none());
    }

    #[test]
    fn video_plan_projects_punctuation_in_every_language_and_honors_the_style_switch() {
        let mut data = document("None", "none");
        data["meta"]["sourceLang"] = json!({"code": "zh"});
        data["cues"][0]["text"] = json!("你好，世界。");
        data["cues"][0]["words"] = json!([
            {"text": "你好，", "t0": 0.5, "t1": 1.2},
            {"text": "世界。", "t0": 1.3, "t1": 2.5}
        ]);

        let mut projected = OverlayRenderPlan::compile(&data, 640, 360, 3.0, 30.0, None).unwrap();
        assert_eq!(projected.active_layouts(0.8)[0].item.text, "你好 世界");

        data["style"]["punct"] = json!(false);
        let mut literal = OverlayRenderPlan::compile(&data, 640, 360, 3.0, 30.0, None).unwrap();
        assert_eq!(literal.active_layouts(0.8)[0].item.text, "你好，世界。");

        data["style"]["punct"] = json!(true);
        data["meta"]["sourceLang"] = json!({"code": "en"});
        data["cues"][0]["text"] = json!("Hello, world.");
        data["cues"][0]["words"] = json!([
            {"text": "Hello,", "t0": 0.5, "t1": 1.2},
            {"text": "world.", "t0": 1.3, "t1": 2.5}
        ]);
        let mut english = OverlayRenderPlan::compile(&data, 640, 360, 3.0, 30.0, None).unwrap();
        assert_eq!(english.active_layouts(0.8)[0].item.text, "Hello world");
    }

    #[test]
    fn pending_source_and_translation_structure_match_the_preview() {
        let mut data = json!({
            "rev": 7,
            "style": {},
            "cues": [{
                "id": "q1", "sp": "speaker", "start": 0.0, "end": 2.0,
                "text": "Hello world", "words": [{"text": "Hello"}]
            }],
            "sentences": [{
                "id": "s1", "start": 0.0, "end": 2.0, "trans": "你好世界"
            }],
            "transCues": [{
                "id": "s1#0", "sid": "s1", "kind": "piece", "text": "你好世界",
                "start": 0.0, "end": 2.0, "wordFrom": 0, "wordTo": 1,
                "sourceWords": [
                    {"id": "w1", "text": "Hello", "start": 0.0, "end": 1.0},
                    {"id": "w2", "text": "world", "start": 1.0, "end": 2.0}
                ]
            }]
        });
        let overlay = json!({
            "struct": {"baseRev": 7, "ops": [{
                "kind": "split", "id": "q1", "baseText": "Hello world", "offset": 5,
                "textA": "Hello", "textB": "world"
            }]},
            "transStruct": {"baseRev": 7, "ops": [{
                "kind": "split", "sid": "s1", "from": 0, "to": 1, "at": 0,
                "baseText": "你好世界", "textA": "你好", "textB": "世界"
            }]}
        });
        apply_preview_overlays(&mut data, &overlay);
        assert_eq!(data["cues"][0]["id"], "q1a");
        assert_eq!(data["cues"][1]["id"], "q1b");
        assert!(data["cues"][0].get("words").is_none());
        assert_eq!(data["transCues"][0]["id"], "s1#0");
        assert_eq!(data["transCues"][0]["text"], "你好");
        assert_eq!(data["transCues"][0]["end"], 1.0);
        assert_eq!(data["transCues"][1]["id"], "s1#1");
        assert_eq!(data["transCues"][1]["text"], "世界");
        assert_eq!(data["sentences"][0]["trans"], "你好世界");
    }

    #[test]
    fn pending_unaligned_translation_split_seeds_preview_pieces() {
        let mut data = json!({
            "rev": 7,
            "style": {},
            "cues": [{
                "id": "q-w1", "sp": "speaker", "start": 0.0, "end": 2.0,
                "text": "Hello world", "words": [
                    {"id": "w1", "text": "Hello", "t0": 0.0, "t1": 1.0},
                    {"id": "w2", "text": "world", "t0": 1.0, "t1": 2.0}
                ]
            }],
            "sentences": [{
                "id": "s-w1", "start": 0.0, "end": 2.0, "trans": "你好世界",
                "sourceWordIds": ["w1", "w2"]
            }],
            "transCues": [{
                "id": "s-w1", "sid": "s-w1", "kind": "sentence", "text": "你好世界",
                "start": 0.0, "end": 2.0
            }]
        });
        let overlay = json!({
            "transStruct": {"baseRev": 7, "ops": [{
                "kind": "split", "sid": "s-w1", "from": 0, "to": 1, "at": 0,
                "baseText": "你好世界", "textA": "您好", "textB": "世界",
                "seedUnaligned": true
            }]}
        });

        apply_preview_overlays(&mut data, &overlay);
        assert_eq!(data["transCues"][0]["kind"], "piece");
        assert_eq!(data["transCues"][0]["id"], "s-w1#0");
        assert_eq!(data["transCues"][0]["text"], "您好");
        assert_eq!(data["transCues"][0]["sourceWordIds"], json!(["w1"]));
        assert_eq!(data["transCues"][1]["id"], "s-w1#1");
        assert_eq!(data["transCues"][1]["text"], "世界");
        assert_eq!(data["transCues"][1]["sourceWordIds"], json!(["w2"]));
        assert_eq!(data["sentences"][0]["trans"], "您好世界");
    }

    #[test]
    fn a_piece_edit_rebuilds_the_sentence_from_all_translation_pieces() {
        let mut data = json!({
            "rev": 1,
            "style": {},
            "cues": [],
            "sentences": [{"id": "s1", "trans": "Alpha Beta"}],
            "transCues": [
                {"id": "s1#0", "sid": "s1", "kind": "piece", "text": "Alpha", "start": 0.0},
                {"id": "s1#1", "sid": "s1", "kind": "piece", "text": "Beta", "start": 1.0}
            ]
        });
        let overlay = json!({
            "trans": {"s1#1": {"kind": "piece", "base": "Beta", "value": "Gamma"}}
        });
        apply_preview_overlays(&mut data, &overlay);
        assert_eq!(data["transCues"][0]["text"], "Alpha");
        assert_eq!(data["transCues"][1]["text"], "Gamma");
        assert_eq!(data["sentences"][0]["trans"], "Alpha Gamma");
    }

    #[test]
    fn bgra_compositor_blends_without_external_media_tools() {
        let mut plan =
            OverlayRenderPlan::compile(&document("Color", "none"), 320, 180, 3.0, 30.0, None)
                .unwrap();
        let mut frame = vec![24_u8; 320 * 180 * 4];
        plan.composite_bgra(&mut frame, 320 * 4, 0.8).unwrap();
        assert!(
            frame
                .chunks_exact(4)
                .any(|pixel| { pixel[0] > 100 || pixel[1] > 100 || pixel[2] > 100 })
        );
    }

    /// 帧级合成缓存的正确性前提：顺序渲染（缓存生效）与冷启动单帧渲染逐字节
    /// 一致。采样点覆盖入场转场、逐词边界、静止段与显示窗边缘——整片导出与
    /// 区间重渲（补丁窗冷启动）共用这条等价性。
    #[test]
    fn sequential_cached_composites_match_cold_renders() {
        let doc = document("Color", "magic-fade");
        let mut warm = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
        let sampled = [0, 1, 2, 12, 27, 36, 39, 60, 78, 89];
        for frame_index in 0..90 {
            let time = frame_index as f64 / 30.0;
            let mut warm_frame = vec![24_u8; 320 * 180 * 4];
            warm.composite_bgra(&mut warm_frame, 320 * 4, time).unwrap();
            if !sampled.contains(&frame_index) {
                continue;
            }
            let mut cold = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
            let mut cold_frame = vec![24_u8; 320 * 180 * 4];
            cold.composite_bgra(&mut cold_frame, 320 * 4, time).unwrap();
            assert_eq!(
                warm_frame, cold_frame,
                "帧 {frame_index} 的缓存复用结果与冷渲染不一致"
            );
        }
    }

    /// 发光（`effect_on`）+ 双语的文档：字幕渲染会走「每行一张整幅效果层 →
    /// 模糊 → 预乘合成」的路径，也就是 bbox 化与 scratch 复用改动的目标。
    fn glowing_bilingual_document(transition: &str) -> Value {
        let mut document = document("Highlight", transition);
        document["style"]["mode"] = json!("bi");
        document["style"]["glow"] = json!({
            "on": true, "color": "#FF3366", "intensity": 80, "range": 40
        });
        // 收窄显示窗，让片头片尾留出真正的空白帧。
        document["style"]["displayTiming"] = json!({"leadIn": 0.1, "tail": 0.1});
        document["cues"] = json!([{
            "id": "q1", "start": 1.0, "end": 2.0, "text": "Hello world",
            "words": [
                {"text": "Hello", "t0": 1.0, "t1": 1.5},
                {"text": "world", "t0": 1.5, "t1": 2.0}
            ]
        }]);
        document["transCues"] = json!([{
            "id": "s1#0", "sid": "s1", "kind": "piece",
            "start": 1.0, "end": 2.0, "text": "你好世界"
        }]);
        document
    }

    /// 模糊后返回的包围盒必须覆盖全部非零字节——bbox 化合成与 scratch 复用
    /// 的清零都建立在这条不变式上。
    #[test]
    fn blur_bounds_cover_every_nonzero_byte() {
        let width = 96_u32;
        let height = 64_u32;
        for &(corner_x, corner_y) in &[(40_usize, 30_usize), (0, 0), (93, 61), (0, 30), (50, 0)] {
            for radius in [1_usize, 3, 9, 20] {
                let mut data = vec![0_u8; 96 * 64 * 4];
                for dy in 0..3 {
                    for dx in 0..4 {
                        let x = (corner_x + dx).min(95);
                        let y = (corner_y + dy).min(63);
                        let offset = (y * 96 + x) * 4;
                        data[offset..offset + 4].copy_from_slice(&[120, 40, 200, 220]);
                    }
                }
                let bounds = box_blur_rgba_content(&mut data, width, height, radius).unwrap();
                for y in 0..height as usize {
                    for x in 0..width as usize {
                        if bounds.rows.contains(&y) && bounds.cols.contains(&x) {
                            continue;
                        }
                        let offset = (y * 96 + x) * 4;
                        assert_eq!(
                            &data[offset..offset + 4],
                            &[0, 0, 0, 0],
                            "半径 {radius} 角点 ({corner_x},{corner_y}) 的包围盒外仍有非零像素 ({x},{y})"
                        );
                    }
                }
            }
        }
    }

    /// 与 [`sequential_cached_composites_match_cold_renders`] 同样的等价性，
    /// 但文档开启发光并使用双语——一帧内有两条效果行，能抓到 scratch 缓冲
    /// 未清零导致的跨帧/跨行残留。
    #[test]
    fn glowing_bilingual_cached_composites_match_cold_renders() {
        let doc = glowing_bilingual_document("magic-fade");
        let mut warm = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
        for frame_index in 0..90 {
            let time = frame_index as f64 / 30.0;
            let mut warm_frame = vec![24_u8; 320 * 180 * 4];
            warm.composite_bgra(&mut warm_frame, 320 * 4, time).unwrap();
            let mut cold = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
            let mut cold_frame = vec![24_u8; 320 * 180 * 4];
            cold.composite_bgra(&mut cold_frame, 320 * 4, time).unwrap();
            assert_eq!(
                warm_frame, cold_frame,
                "帧 {frame_index} 的缓存复用结果与冷渲染不一致"
            );
        }
    }

    /// 显示窗外必须判定为整帧透明，并且合成完全不触碰目标缓冲。
    #[test]
    fn blank_overlay_windows_leave_the_destination_untouched() {
        let doc = glowing_bilingual_document("none");
        let mut plan = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
        // 显示窗是 [0.9, 2.1)：片头片尾都是真正的空白帧。
        assert!(plan.overlay_is_blank(0.0).unwrap());
        assert!(!plan.overlay_is_blank(1.5).unwrap());
        assert!(plan.overlay_is_blank(2.9).unwrap());
        let mut blank = vec![24_u8; 320 * 180 * 4];
        plan.composite_bgra(&mut blank, 320 * 4, 0.0).unwrap();
        assert!(blank.iter().all(|&byte| byte == 24));
    }

    /// 局部（内容包围盒）模糊必须与整帧模糊逐字节一致——含内容贴边、
    /// 贴角时窗口收缩语义的对齐。
    #[test]
    fn content_box_blur_matches_full_frame_blur() {
        let width = 64_u32;
        let height = 36_u32;
        for &(corner_x, corner_y) in &[(5_usize, 5_usize), (58, 30), (0, 0), (60, 33), (30, 0)] {
            let mut full = vec![0_u8; 64 * 36 * 4];
            for dy in 0..3 {
                for dx in 0..4 {
                    let x = (corner_x + dx).min(63);
                    let y = (corner_y + dy).min(35);
                    let offset = (y * 64 + x) * 4;
                    full[offset..offset + 4].copy_from_slice(&[120, 40, 200, 220]);
                }
            }
            let mut content = full.clone();
            box_blur_rgba(&mut full, width, height, 4);
            box_blur_rgba_content(&mut content, width, height, 4);
            assert_eq!(full, content, "content blob at ({corner_x},{corner_y})");
        }
    }

    /// `OverlayIncludes` 与 `bcut-editable::builder::include_element` 必须逐条同构：
    /// 同一份 `--no-*` 组合下，「先烧录预览再导可编辑工程」两边看到的元素集合要一致。
    #[test]
    fn overlay_includes_mirror_the_editable_export_element_gates() {
        let element = |kind: &str, role: Option<&str>| -> Element {
            let mut raw = json!({"id": "el", "kind": kind});
            if let Some(role) = role {
                raw["role"] = json!(role);
            }
            serde_json::from_value(raw).unwrap()
        };
        let all = OverlayIncludes::ALL;
        assert!(all.allows(&element("text", None)));
        assert!(all.allows(&element("image", None)));
        assert!(all.allows(&element("video", None)));
        // 叠加层不承载音频：音轨由 timeline_media 预合成进源媒体。
        assert!(!all.allows(&element("audio", None)));

        let no_texts = OverlayIncludes {
            texts: false,
            ..OverlayIncludes::ALL
        };
        assert!(!no_texts.allows(&element("text", None)));
        assert!(no_texts.allows(&element("image", None)));

        let no_overlays = OverlayIncludes {
            media_overlays: false,
            ..OverlayIncludes::ALL
        };
        assert!(!no_overlays.allows(&element("image", None)));
        assert!(!no_overlays.allows(&element("video", None)));
        assert!(no_overlays.allows(&element("text", None)));

        // 水印角色先于 kind 判定，但只在水印被排除时短路。
        let no_watermarks = OverlayIncludes {
            watermarks: false,
            ..OverlayIncludes::ALL
        };
        assert!(!no_watermarks.allows(&element("text", Some("watermark"))));
        assert!(!no_watermarks.allows(&element("image", Some("watermark"))));
        assert!(no_watermarks.allows(&element("text", None)));
        // 保留水印但排除文字：水印文字仍要过 kind 这一关，跟着文字一起消失。
        assert!(!no_texts.allows(&element("text", Some("watermark"))));
        // 其余角色不享受任何豁免。
        assert!(!no_texts.allows(&element("text", Some("screentext"))));
        assert!(!no_overlays.allows(&element("video", Some("broll"))));
    }

    /// 关掉烧录后，显示模式的前提校验必须一并让路：没有译文也照样能导一版干净画面，
    /// 而不是因为「模式要求译文」把整次导出拒掉。
    #[test]
    fn disabled_subtitles_skip_the_display_mode_preconditions() {
        let document = document("none", "none");
        let compile = |includes: OverlayIncludes, mode: &str| {
            OverlayRenderPlan::compile_with(&document, 320, 180, 3.0, 30.0, Some(mode), includes)
        };
        let no_subtitles = OverlayIncludes {
            subtitles: false,
            ..OverlayIncludes::ALL
        };
        for mode in ["translated", "bilingual"] {
            assert!(
                compile(OverlayIncludes::ALL, mode).is_err(),
                "{mode} 缺译文必须报错"
            );
            let mut plan = compile(no_subtitles, mode).unwrap();
            let mut frame = vec![24_u8; 320 * 180 * 4];
            plan.composite_bgra(&mut frame, 320 * 4, 1.5).unwrap();
            assert!(
                frame.iter().all(|&byte| byte == 24),
                "{mode} 关掉烧录后不得画出任何字幕"
            );
        }
        // 对照组：保留烧录时同一份文档照样画得出原文。
        let mut plan = compile(OverlayIncludes::ALL, "original").unwrap();
        let mut frame = vec![24_u8; 320 * 180 * 4];
        plan.composite_bgra(&mut frame, 320 * 4, 1.5).unwrap();
        assert!(frame.iter().any(|&byte| byte != 24));
    }

    /// 无译文是投影前就能确定的失败。这里故意不给项目注册 OverlayHost：若实现
    /// 先尝试读取活时间轴，错误会变成“host 未注册”，也会重新引入超长文档的
    /// 整体深拷峰值。
    #[test]
    fn project_compile_rejects_missing_translation_before_live_projection() {
        let project = tempfile::tempdir().unwrap();
        let document = json!({
            "style": {"mode": "translated"},
            "cues": [{
                "id": "q1", "start": 0.0, "end": 1.0, "text": "hello",
                "words": [{"id": "w1", "text": "hello", "t0": 0.0, "t1": 1.0}]
            }],
            "sentences": [],
            "transCues": [],
            "sourceDocs": {
                "main": {"cues": [], "sentences": [], "transCues": []}
            }
        });
        let error = OverlayRenderPlan::compile_project(
            project.path(),
            &document,
            320,
            180,
            1.0,
            30.0,
            None,
        )
        .err()
        .expect("缺译文必须在时间轴投影前失败");
        assert_eq!(
            format!("{error:#}"),
            "当前 Studio 投影没有译文，无法导出译文或双语视频"
        );
    }

    #[test]
    fn translated_mode_leaves_untranslated_groups_blank_instead_of_showing_source() {
        let document = json!({
            "meta": {
                "duration": 4.0,
                "sourceLang": {"code": "en"},
                "targetLang": {"code": "zh"}
            },
            "style": {
                "mode": "trans", "fontFamily": "montserrat", "fontSize": 30,
                "fontColor": "#FFFFFF", "punct": true,
                "transStyle": {"fontFamily": "Bebas Neue", "fontColor": "#FFCC00"},
                "displayTiming": {"leadIn": 0.0, "tail": 0.0}
            },
            "cues": [
                {"id": "q1", "start": 0.0, "end": 2.0, "text": "Hello there."},
                {"id": "q2", "start": 2.0, "end": 4.0, "text": "Source fallback."}
            ],
            "sentences": [
                {"id": "s1", "cueIds": ["q1"], "start": 0.0, "end": 2.0,
                    "text": "Hello there.", "trans": "你好"},
                {"id": "s2", "cueIds": ["q2"], "start": 2.0, "end": 4.0,
                    "text": "Source fallback.", "trans": ""}
            ],
            "transCues": [
                {"id": "s1", "sid": "s1", "kind": "sentence",
                    "start": 0.0, "end": 2.0, "text": "你好"}
            ]
        });
        let mut translated =
            OverlayRenderPlan::compile(&document, 640, 360, 4.0, 30.0, Some("translated")).unwrap();

        let translated_line = translated.active_layouts(1.0);
        assert_eq!(translated_line.len(), 1);
        assert_eq!(translated_line[0].kind, LineKind::Translation);
        assert_eq!(translated_line[0].item.text, "你好");

        // 缺译句：译文轨里没有这一句，画面上就该什么都没有——绝不拿原文顶替。
        assert!(
            translated.active_layouts(3.0).is_empty(),
            "缺译句在译文模式下不排任何行"
        );
        // 逐像素确认「什么都没有」也包括字幕背景框：整帧必须一个字节都没被改。
        let mut frame = vec![24_u8; 640 * 360 * 4];
        translated.composite_bgra(&mut frame, 640 * 4, 3.0).unwrap();
        assert!(
            frame.iter().all(|&byte| byte == 24),
            "缺译句期间不画文字，也不画背景框"
        );

        // 双语模式语义不变：原文行照常，缺的只是译文行，同样不会多出一条用原文
        // 冒充的译文行。

        let mut bilingual =
            OverlayRenderPlan::compile(&document, 640, 360, 4.0, 30.0, Some("bilingual")).unwrap();
        let bilingual_fallback = bilingual.active_layouts(3.0);
        assert_eq!(bilingual_fallback.len(), 1);
        assert_eq!(bilingual_fallback[0].kind, LineKind::Original);
        assert_eq!(bilingual_fallback[0].item.text, "Source fallback");

        // 留空了，信封就更必须数得出来：覆盖率与上面真正被烧录的那一行同源，差值
        // 正好是被留空的 s2。看不见的缺译只有配上计数才不是静默丢句。
        assert_eq!(sentence_translation_coverage(&document), (1, 2));
    }

    /// 句边界漂移让旧译文键成为孤儿：`trans` 里的条目一条都没少，但没有一条挂得上
    /// 当前派生出来的句 id。覆盖率必须报 0/N，而不是被「有译文」的粗判蒙混过去。
    #[test]
    fn sentence_coverage_counts_orphaned_translation_keys_as_missing() {
        let drifted = json!({
            "cues": [
                {"id": "q1", "start": 0.0, "end": 2.0, "text": "Hello there."},
                {"id": "q2", "start": 2.0, "end": 4.0, "text": "Source fallback."}
            ],
            "sentences": [
                {"id": "s-w1", "cueIds": ["q1"], "start": 0.0, "end": 2.0,
                    "text": "Hello there.", "trans": ""},
                {"id": "s-w4", "cueIds": ["q2"], "start": 2.0, "end": 4.0,
                    "text": "Source fallback.", "trans": ""}
            ],
            // 旧边界下的句 id：内容还在，键已经指不到任何一句。
            "transCues": [
                {"id": "s-w0", "sid": "s-w0", "kind": "sentence",
                    "start": 0.0, "end": 4.0, "text": "你好，回退。"}
            ]
        });
        assert_eq!(sentence_translation_coverage(&drifted), (0, 2));

        // 同一批 transCue 挂回正确的句 id 就该满覆盖——判据是 sid 对得上，
        // 不是「transCues 非空」。
        let mut anchored = drifted.clone();
        anchored["transCues"] = json!([
            {"id": "s-w1", "sid": "s-w1", "kind": "sentence",
                "start": 0.0, "end": 2.0, "text": "你好"},
            {"id": "s-w4", "sid": "s-w4", "kind": "sentence",
                "start": 2.0, "end": 4.0, "text": "回退"}
        ]);
        assert_eq!(sentence_translation_coverage(&anchored), (2, 2));
    }

    /// `--no-*` 不改文档却决定画哪些元素，必须自成一段进帧缓存键；画质档只改码率、
    /// 不改像素，必须留在外面。
    #[test]
    fn include_flags_split_the_frame_cache_key() {
        let document = document("none", "none");
        let key = |includes: OverlayIncludes| {
            OverlayRenderPlan::compile_with(&document, 320, 180, 3.0, 30.0, None, includes)
                .unwrap()
                .definition_key
        };
        let base = key(OverlayIncludes::ALL);
        for includes in [
            OverlayIncludes {
                subtitles: false,
                ..OverlayIncludes::ALL
            },
            OverlayIncludes {
                texts: false,
                ..OverlayIncludes::ALL
            },
            OverlayIncludes {
                media_overlays: false,
                ..OverlayIncludes::ALL
            },
            OverlayIncludes {
                watermarks: false,
                ..OverlayIncludes::ALL
            },
        ] {
            assert_ne!(base, key(includes), "{includes:?} 必须换一套缓存键");
        }
        assert_eq!(base, key(OverlayIncludes::default()));
    }

    /// 导出期样式覆盖（`bcut export --to mp4 --sub-style`）：本次烧录必须逐像素
    /// 等于「项目样式就是这份 blob」，项目 `studio/style.json` 投影与 `edits.json`
    /// 里尚未提交的样式改动一并出局；同时一个字节的项目状态都不许写。
    #[test]
    fn export_time_subtitle_style_override_replaces_project_style_and_pending_edits() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path();
        fs::create_dir_all(project.join("studio")).unwrap();

        let mut data = positioned_bilingual_document();
        data["rev"] = json!(7);
        let project_style = data["style"].clone();
        let data_bytes = serde_json::to_vec_pretty(&data).unwrap();
        // 页面上改了颜色但还没 apply：这层覆盖平时是生效的。
        let edits = json!({
            "style": {
                "base": serde_json::to_string(&project_style).unwrap(),
                "value": {"fontColor": "#FF0000"}
            }
        });
        let edits_bytes = serde_json::to_vec_pretty(&edits).unwrap();
        fs::write(project.join("studio/data.json"), &data_bytes).unwrap();
        fs::write(project.join("studio/edits.json"), &edits_bytes).unwrap();

        let pending = load_preview_document(project).unwrap();
        assert_eq!(
            pending["style"]["fontColor"],
            json!("#FF0000"),
            "基线前提：未提交的样式改动本来会进入导出"
        );

        let mut override_style = project_style.clone();
        override_style["fontColor"] = json!("#00FF00");
        override_style["fontSize"] = json!(44);
        override_style["transStyle"] = json!({"fontColor": "#FFCC00"});
        let style_path = temp.path().join("preset-style.json");
        fs::write(
            &style_path,
            serde_json::to_vec_pretty(&override_style).unwrap(),
        )
        .unwrap();

        let mut document = load_preview_document(project).unwrap();
        apply_subtitle_style_override(
            &mut document,
            load_subtitle_style_override(&style_path).unwrap(),
        );
        assert_eq!(
            document["style"], override_style,
            "覆盖是整体替换，不是与项目样式合并"
        );

        let mut expected = data.clone();
        expected["style"] = override_style.clone();
        assert_eq!(
            burned_rgba(&document),
            burned_rgba(&expected),
            "烧录必须与「项目样式本来就是这份 blob」逐像素一致"
        );
        assert_ne!(
            burned_rgba(&document),
            burned_rgba(&pending),
            "未提交的样式改动不得参与预设导出"
        );
        assert_ne!(
            burned_rgba(&document),
            burned_rgba(&data),
            "项目自身样式也不得盖过覆盖 blob"
        );

        assert_eq!(
            fs::read(project.join("studio/data.json")).unwrap(),
            data_bytes
        );
        assert_eq!(
            fs::read(project.join("studio/edits.json")).unwrap(),
            edits_bytes
        );
        assert!(
            !project.join("studio/style.json").exists(),
            "导出期覆盖绝不写回项目状态"
        );
    }

    /// 覆盖文件读不出来就必须炸：静默退回项目样式会让用户拿到一份看着正常、
    /// 样式却不对的产物。非对象 JSON 尤其危险——所有 `style.get()` 都会落空，
    /// 渲染会用一整套默认值。
    #[test]
    fn subtitle_style_override_rejects_missing_broken_and_non_object_files() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("nope.json");
        let error = format!("{:#}", load_subtitle_style_override(&missing).unwrap_err());
        assert!(error.contains("读取 --sub-style"), "{error}");

        let broken = temp.path().join("broken.json");
        fs::write(&broken, b"{ \"fontSize\": ").unwrap();
        let error = format!("{:#}", load_subtitle_style_override(&broken).unwrap_err());
        assert!(error.contains("解析 --sub-style"), "{error}");

        for raw in ["[]", "\"classic\"", "null", "42"] {
            let path = temp.path().join("not-object.json");
            fs::write(&path, raw).unwrap();
            let error = format!("{:#}", load_subtitle_style_override(&path).unwrap_err());
            assert!(
                error.contains("顶层必须是 JSON 对象"),
                "{raw} 必须被拒绝：{error}"
            );
        }
    }

    /// 无字幕区间整帧透明，混合必须完全跳过、保持解码基帧原样。
    #[test]
    fn blank_gap_frames_leave_base_untouched() {
        let mut doc = document("Color", "none");
        doc["cues"][0]["start"] = json!(2.0);
        doc["cues"][0]["end"] = json!(2.5);
        doc["cues"][0]["words"] = json!([]);
        let mut plan = OverlayRenderPlan::compile(&doc, 320, 180, 3.0, 30.0, None).unwrap();
        let mut frame = vec![24_u8; 320 * 180 * 4];
        plan.composite_bgra(&mut frame, 320 * 4, 0.5).unwrap();
        assert!(frame.iter().all(|&byte| byte == 24));
        let mut visible = vec![24_u8; 320 * 180 * 4];
        plan.composite_bgra(&mut visible, 320 * 4, 2.2).unwrap();
        assert!(visible.iter().any(|&byte| byte != 24));
    }

    /// 水印在渲染期被抬到最上层（M5-B8，设计文档 §20 #10）。
    ///
    /// 两件事一起断言，因为只断言前一件会让一个「全部倒序」的实现也通过：
    ///
    /// 1. **跨类**：不管水印写在哪条轨、轨内排第几，它都排在所有非水印之后；
    /// 2. **同类稳定**：水印之间仍是文档顺序（先轨后元素），没有被重排。
    ///
    /// 这条路径同时供预览与 CLI 导出使用，所以它也是「两端层级恒等」的守卫。
    #[test]
    fn watermarks_are_hoisted_above_every_other_element_but_keep_their_own_order() {
        fn element(id: &str, watermark: bool) -> Value {
            let mut value = json!({
                "id": id, "kind": "text", "start": 0.0, "end": 3.0, "text": id
            });
            if watermark {
                value["role"] = json!("watermark");
            }
            value
        }

        let mut document = document("none", "none");
        document["timeline"] = json!({
            "tracks": [
                {"elements": [element("wm-first", true), element("plain-a", false)]},
                {"elements": [element("plain-b", false), element("wm-second", true)]}
            ]
        });

        let mut plan = OverlayRenderPlan::compile(&document, 320, 180, 3.0, 30.0, None).unwrap();
        // timeline.json 不存在 → 空 TimelineDocument；这些元素不引用媒体源，
        // 所以整条路径不碰磁盘，项目目录给个不存在的路径即可。
        plan.load_timeline_elements(
            std::path::Path::new("/nonexistent/baocut-b8-watermark-order"),
            &document,
        )
        .unwrap();

        let order: Vec<&str> = plan
            .elements
            .iter()
            .map(|element| element.id.as_str())
            .collect();
        assert_eq!(order, ["plain-a", "plain-b", "wm-first", "wm-second"]);
    }

    #[test]
    fn empty_optional_timeline_keeps_projected_video_pixels() {
        let project = tempfile::tempdir().unwrap();
        let media = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../render-raster/tests/fixtures/native-export/source.mp4");
        fs::write(
            project.path().join("project.json"),
            serde_json::to_vec(&json!({"media": {"path": media}})).unwrap(),
        )
        .unwrap();
        let mut source = document("none", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({
            "main": {"detached": true, "muted": true, "place": {"opacity": 0}},
            "tracks": [{"id": "video", "kind": "overlay", "elements": [{
                "id": "video-c1-1", "kind": "video", "srcId": "main",
                "start": 0.0, "end": 1.0, "srcStart": 0.0,
                "place": {"x": 50, "y": 50, "w": 100}
            }]}]
        });
        let render = || {
            let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 1.0, 30.0, None).unwrap();
            plan.load_timeline_elements(project.path(), &source)
                .unwrap();
            assert_eq!(plan.elements.len(), 1);
            let scene = plan.compositor_scene_frame(0.2).unwrap();
            assert!(!scene.nodes.is_empty(), "GPU 预览必须保留视频节点");
            plan.render_rgba_frame(0.2).unwrap().rgba
        };
        let expected = render();
        assert!(
            expected
                .chunks_exact(4)
                .any(|p| p[3] > 0 && p[..3].iter().any(|c| *c > 20))
        );
        for contents in ["", " \t\r\n"] {
            fs::write(project.path().join("timeline.json"), contents).unwrap();
            assert_eq!(render(), expected, "空时间轴应与未创建时间轴同像素");
            assert_eq!(
                fs::read_to_string(project.path().join("timeline.json")).unwrap(),
                contents,
                "预览只读，不修写用户项目"
            );
        }
        fs::write(project.path().join("timeline.json"), "{\"bcutTimeline\":").unwrap();
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 1.0, 30.0, None).unwrap();
        assert!(
            plan.load_timeline_elements(project.path(), &source)
                .is_err(),
            "非空损坏 JSON 不得吞错后当成缺省时间轴"
        );
    }

    /// 分离出来的主视频就是一件普通视频元素：叠放只看轨序（`tracks[]` 越靠后越在上），
    /// 挪到图形轨之上就盖住图形，CPU 光栅与 GPU 场景同一顺序。导出把恒等主视频还原成
    /// 底图只在它本来就是最底层时发生（`bcut-kernel` 的 `reattach_identity_main`）；
    /// 这条守的是渲染层自己不给 `srcId: main` 另开特判。
    #[test]
    fn detached_main_video_stacks_by_track_order() {
        let project = tempfile::tempdir().unwrap();
        let media = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../render-raster/tests/fixtures/native-export/source.mp4");
        fs::write(
            project.path().join("project.json"),
            serde_json::to_vec(&json!({"media": {"path": media}})).unwrap(),
        )
        .unwrap();
        let video_track = json!({"id": "video-track", "kind": "overlay", "elements": [{
            "id": "video-c1-1", "kind": "video", "srcId": "main",
            "start": 0.0, "end": 1.0, "srcStart": 0.0, "mode": "pip", "fit": "contain",
            "place": {"w": 100}
        }]});
        let shape_track = json!({"id": "shapes", "kind": "overlay", "elements": [{
            "id": "cover", "kind": "shape", "start": 0.0, "end": 1.0,
            "shape": {"shape": "rect", "fill": "#FF00FF"},
            "place": {"x": 50, "y": 50, "w": 100}
        }]});
        for (tracks, video_on_top) in [
            (json!([shape_track, video_track]), true),
            (json!([video_track, shape_track]), false),
        ] {
            let mut source = document("none", "none");
            source["cues"] = json!([]);
            source["timeline"] = json!({
                "main": {"detached": true, "muted": true, "place": {"opacity": 0}},
                "tracks": tracks
            });
            let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 1.0, 30.0, None).unwrap();
            plan.load_timeline_elements(project.path(), &source)
                .unwrap();
            let order: Vec<&str> = plan.elements.iter().map(|e| e.id.as_str()).collect();
            let expected = if video_on_top {
                ["cover", "video-c1-1"]
            } else {
                ["video-c1-1", "cover"]
            };
            assert_eq!(order, expected);

            let rgba = plan.render_rgba_frame(0.2).unwrap().rgba;
            let centre = (90 * 320 + 160) * 4;
            let [r, g, b] = [rgba[centre], rgba[centre + 1], rgba[centre + 2]];
            let magenta = r > 200 && g < 60 && b > 200;
            assert_eq!(
                magenta, !video_on_top,
                "video_on_top={video_on_top}: 中心像素 {:?}",
                [r, g, b]
            );

            let scene = plan.compositor_scene_frame(0.2).unwrap();
            assert_eq!(
                matches!(
                    scene.nodes.last(),
                    Some(element_draw::SceneNode::Texture(_))
                ),
                video_on_top,
                "GPU 场景的最上层节点：{:?}",
                scene.nodes.last().map(std::mem::discriminant)
            );
        }
    }

    #[test]
    fn timeline_image_sources_decode_and_loop_gif_frames() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("media")).unwrap();
        std::fs::write(
            project.path().join("media/stripes.gif"),
            include_bytes!("../../render-raster/tests/fixtures/animated/stripes.gif"),
        )
        .unwrap();
        let timeline = json!({
            "bcutTimeline": "0.3",
            "sources": {
                "gif": {"path": "media/stripes.gif", "kind": "image", "duration": 0.0}
            },
            "tracks": [{"id": "broll", "kind": "overlay", "elements": [{
                "id": "gif-broll", "kind": "image", "role": "broll",
                "start": 0.0, "end": 3.0, "srcId": "gif",
                "place": {"x": 50, "y": 50, "w": 50}
            }]}]
        });
        std::fs::write(
            project.path().join("timeline.json"),
            serde_json::to_vec(&timeline).unwrap(),
        )
        .unwrap();
        let mut source = document("none", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline;
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();

        assert!(plan.media.base.has_animated("gif"));
        let first = plan.render_rgba_frame(0.05).unwrap();
        let second = plan.render_rgba_frame(0.15).unwrap();
        let looped = plan.render_rgba_frame(1.05).unwrap();
        assert_ne!(first.draw_op_fingerprint, second.draw_op_fingerprint);
        assert_eq!(first.draw_op_fingerprint, looped.draw_op_fingerprint);
        assert_eq!(first.rgba, looped.rgba);
        assert!(
            first
                .next_change
                .is_some_and(|next| next <= 0.05 + 1.0 / 30.0)
        );
    }

    #[test]
    fn preview_media_failure_skips_only_its_element_and_strict_export_still_fails() {
        let project = tempfile::tempdir().unwrap();
        let timeline = json!({
            "bcutTimeline": "0.3",
            "sources": {
                "missing": {"path": "media/missing.png", "kind": "image", "duration": 0.0}
            },
            "tracks": [{"id": "overlay", "kind": "overlay", "elements": [
                {
                    "id": "title", "kind": "text", "start": 0.0, "end": 3.0,
                    "text": "still visible", "place": {"x": 50, "y": 50, "w": 60}
                },
                {
                    "id": "broken", "kind": "image", "start": 0.0, "end": 3.0,
                    "srcId": "missing", "place": {"x": 20, "y": 20, "w": 20}
                }
            ]}]
        });
        std::fs::write(
            project.path().join("timeline.json"),
            serde_json::to_vec(&timeline).unwrap(),
        )
        .unwrap();
        let mut source = document("none", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline;

        let mut strict = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        assert!(
            strict
                .load_timeline_elements(project.path(), &source)
                .unwrap_err()
                .to_string()
                .contains("source 媒体不存在")
        );

        let mut preview = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        preview
            .load_timeline_elements_with_policy(
                project.path(),
                &source,
                TimelineMediaFailurePolicy::SkipFailedElement,
            )
            .unwrap();
        assert_eq!(
            preview
                .elements
                .iter()
                .map(|element| element.id.as_str())
                .collect::<Vec<_>>(),
            ["title"]
        );
        assert!(
            preview
                .warnings()
                .iter()
                .any(|warning| warning.contains("missing") && warning.contains("已跳过"))
        );
        assert!(
            preview
                .render_rgba_frame(1.0)
                .unwrap()
                .rgba
                .chunks_exact(4)
                .any(|pixel| pixel[3] > 0),
            "坏图片不能把同一张 overlay 上的文字一起清空"
        );
    }

    // ── 模板层 ────────────────────────────────────────────────────────

    /// 一份只有一条整宽章节条的模板：`y`/`h` 是画面百分比。
    ///
    /// 直接构造 `TemplateScene` 而不是注册假 host——本文件开头那条纪律禁的是
    /// 「造第二份 OverlayHost 实现」，不是禁止喂它的产物。
    fn chapter_bar_doc(y: f64, h: f64) -> timeline::template::TemplateDoc {
        use timeline::template::{ChapterFill, LayerBox, LayerKind, TemplateLayer};
        let mut doc = timeline::template::blank(timeline::template::TemplateCanvas::Wide);
        doc.layers.push(TemplateLayer {
            id: "bar".to_string(),
            on: true,
            rect: LayerBox::new(0.0, y, 100.0, h),
            kind: LayerKind::Chapters {
                fill: ChapterFill::Bar,
                bg: "#F5D642".to_string(),
                color: "#000000".to_string(),
                accent: "#000000".to_string(),
                color_done: None,
                divider: false,
                size: 3.0,
            },
        });
        doc
    }

    fn chrome_scene(y: f64, h: f64) -> TemplateScene {
        TemplateScene::new(chapter_bar_doc(y, h), vec![], "T", vec![])
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        lower_hex(&Sha256::digest(bytes))
    }

    fn alpha_rows(rgba: &[u8], width: u32, row: u32) -> u64 {
        let start = (row as usize) * (width as usize) * 4;
        rgba[start..start + width as usize * 4]
            .chunks_exact(4)
            .map(|pixel| u64::from(pixel[3]))
            .sum()
    }

    /// 模板层真的画进了上屏/导出的那一帧，而且落在层声明的位置。
    ///
    /// 判别性在两条：① 不带模板时那一行必须是全透明的（否则测的是别的东西）；
    /// ② 模板带之外的行仍然全透明（否则说明整幅被涂了底）。
    #[test]
    fn a_template_layer_paints_into_the_overlay_frame() {
        let document = document("none", "none");
        let mut plain = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        let before = plain.render_rgba(1.0).unwrap();
        assert_eq!(alpha_rows(&before, 640, 4), 0, "没套模板时顶栏必须全透明");

        let mut plan = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        // 顶部 48px ⇒ 360 高画布的 13.33%
        plan.set_template_scene(Some(chrome_scene(0.0, 48.0 / 3.6)));
        let after = plan.render_rgba(1.0).unwrap();
        assert!(alpha_rows(&after, 640, 4) > 0, "顶栏应当被模板层填满");
        // 顶部模板不触发字幕避让：第 200 行有字幕，两次渲染必须逐字节相同
        let row = |rgba: &[u8]| rgba[200 * 640 * 4..201 * 640 * 4].to_vec();
        assert_eq!(row(&before), row(&after), "模板带之外不该被涂到");
        assert_ne!(before, after, "带模板的这一帧不该与没套时逐字节相同");
    }

    /// 浏览器的模板层出口：裁到模板带的子矩形，alpha 与整幅 overlay 里那一带一致。
    #[test]
    fn the_template_raster_layer_is_the_cropped_chrome_band() {
        let document = document("none", "none");
        let mut plain = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        assert!(plain.render_template_raster_layer(1.0).unwrap().is_none());

        let mut plan = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        plan.set_template_scene(Some(chrome_scene(0.0, 48.0 / 3.6)));
        let layer = plan.render_template_raster_layer(1.0).unwrap().unwrap();
        assert!(layer.key.starts_with("tplchrome:"), "{}", layer.key);
        assert_eq!((layer.x, layer.y, layer.width), (0, 0, 640));
        assert!(
            (1..=49).contains(&layer.height),
            "只含顶部 48px 的带：{}",
            layer.height
        );
        assert_eq!(layer.rgba.len(), (layer.width * layer.height * 4) as usize);
        assert_eq!(layer.composite, CaptionCompositeMode::Normal);
        let overlay = plan.render_rgba(1.0).unwrap();
        assert_eq!(
            alpha_rows(&layer.rgba, layer.width, 4),
            alpha_rows(&overlay, 640, 4),
            "子矩形的 alpha 与整幅 overlay 同一行一致"
        );
        let again = plan.render_template_raster_layer(1.0).unwrap().unwrap();
        assert_eq!(again.key, layer.key, "同一帧同一个键");
        assert!(layer.next_change.is_some(), "模板层逐帧给下一次变化");
    }

    /// wasm 宿主的模板输入：章节表按口径过滤、台标 key 取自文档、交进来的像素被预乘。
    #[test]
    fn template_source_parses_chapters_and_premultiplies_logos() {
        let mut doc = logo_doc((10.0, 10.0, 20.0, 10.0), false, 1.0);
        let mut second = doc.layers[0].clone();
        second.id = "wm2".to_string();
        for layer in [&mut doc.layers[0], &mut second] {
            if let timeline::template::LayerKind::Logo { src, .. } = &mut layer.kind {
                *src = timeline::template::LogoSrc::File {
                    file: "media/logo.png".to_string(),
                };
            }
        }
        doc.layers.push(second);
        let value = serde_json::to_value(&doc).unwrap();
        let chapters = json!([
            {"id": "c1", "title": "开场", "start": 0.0, "end": 2.0},
            {"id": "c2", "title": "缺尾", "start": 2.0},
            {"id": "c3", "title": "零长", "start": 3.0, "end": 3.0},
        ]);
        let mut source =
            TemplateSource::from_json(&value.to_string(), &chapters.to_string(), "标题").unwrap();
        assert_eq!(source.logo_keys(), vec!["media/logo.png".to_string()]);
        let scene = source.scene();
        assert_eq!(scene.chapters.len(), 1);
        assert_eq!(scene.chapters[0].title, "开场");
        assert_eq!(scene.title, "标题");
        assert!(scene.logos.is_empty());

        assert!(
            source
                .set_logo_rgba("media/logo.png", 2, 1, vec![0; 4])
                .is_err()
        );
        source
            .set_logo_rgba("media/logo.png", 1, 1, vec![255, 0, 0, 128])
            .unwrap();
        let with_logo = source.scene();
        assert_eq!(with_logo.logos["media/logo.png"].data(), &[128, 0, 0, 128]);
        assert_ne!(
            with_logo.fingerprint, scene.fingerprint,
            "台标像素进场景指纹"
        );
        assert!(TemplateSource::from_json("{", "[]", "").is_err());
    }

    /// DrawOp 指纹必须跟着模板层的像素走：资源名里不带这一帧的像素身份，
    /// 客户端会把动起来的章节条当成「没变」而复用旧图。
    #[test]
    fn the_frame_identity_follows_the_template_pixels() {
        let document = document("none", "none");
        let mut plain = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        let bare = plain.render_overlay_frame(1.0).unwrap().draw_op_fingerprint;

        let mut thin = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        thin.set_template_scene(Some(chrome_scene(0.0, 6.0)));
        let thin_id = thin.render_overlay_frame(1.0).unwrap().draw_op_fingerprint;

        let mut thick = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        thick.set_template_scene(Some(chrome_scene(0.0, 12.0)));
        let thick_id = thick.render_overlay_frame(1.0).unwrap().draw_op_fingerprint;
        let later_id = thick.render_overlay_frame(2.0).unwrap().draw_op_fingerprint;

        assert_ne!(bare, thin_id, "套了模板，整幅身份必须变");
        assert_ne!(thin_id, thick_id, "模板画得不一样，整幅身份必须跟着变");
        assert_ne!(
            thick_id, later_id,
            "章节条的进度色条随时间推进，帧身份必须逐帧变"
        );
    }

    /// 层盒是画面百分比：同一份模板画到不同尺寸的画布上，占的行数按比例走。
    #[test]
    fn a_template_layer_scales_to_the_overlay_canvas() {
        let document = document("none", "none");
        let mut plan = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        // 顶栏 6.67% ⇒ 360 高画布上是 24px
        plan.set_template_scene(Some(chrome_scene(0.0, 24.0 / 3.6)));
        let rgba = plan.render_rgba(1.0).unwrap();
        assert!(alpha_rows(&rgba, 640, 20) > 0, "第 20 行应当仍在顶栏内");
        assert_eq!(alpha_rows(&rgba, 640, 30), 0, "第 30 行应当已在顶栏之下");
        // 整行都画满：横向丢了百分比就会只剩左半边
        let row = &rgba[4 * 640 * 4..5 * 640 * 4];
        assert!(
            row.chunks_exact(4).all(|pixel| pixel[3] > 0),
            "顶栏必须横贯整幅，不是只画了左半边"
        );
    }

    /// 字幕避让：底部有整宽模板带时，字幕锚线抬到带的上沿（原型 `subsBottom`）。
    ///
    /// 走的是 `stack_layout` 这唯一漏斗。判别点是「只挪位置、不改长相」：
    /// 字号必须一个像素都不变；顶部模板或关掉 `subsAvoid` 时不抬。
    #[test]
    fn a_bottom_template_strip_lifts_the_subtitle_stack_without_restyling_it() {
        let document = document("none", "none");
        let plain = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        let plain_anchor = plain.stack_layout(&[], 1.0).anchor;
        let plain_size = plain.original_style.font_size;
        assert!(
            (plain_anchor.1 - 360.0 * 0.86).abs() < 1e-6,
            "默认锚线在 86%"
        );

        // 底部 y=80%、高 20% 的章节条 ⇒ subs_bottom = 22 ⇒ 锚线最多 78%
        let mut lifted = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        lifted.set_template_scene(Some(chrome_scene(80.0, 20.0)));
        let lifted_anchor = lifted.stack_layout(&[], 1.0).anchor;
        assert!(
            (lifted_anchor.1 - 360.0 * 0.78).abs() < 1e-6,
            "{lifted_anchor:?}"
        );
        assert_eq!(
            lifted.original_style.font_size, plain_size,
            "避让只管摆位，字号不能被动"
        );

        // 顶部模板不避让
        let mut top = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        top.set_template_scene(Some(chrome_scene(0.0, 12.0)));
        assert_eq!(top.stack_layout(&[], 1.0).anchor, plain_anchor);

        // 关掉 subsAvoid 也不避让
        let mut doc = chapter_bar_doc(80.0, 20.0);
        doc.subs_avoid = false;
        let mut off = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        off.set_template_scene(Some(TemplateScene::new(doc, vec![], "T", vec![])));
        assert_eq!(off.stack_layout(&[], 1.0).anchor, plain_anchor);

        // 撤掉模板恢复原位
        lifted.set_template_scene(None);
        assert_eq!(lifted.stack_layout(&[], 1.0).anchor, plain_anchor);
    }

    /// 元素指纹出口是跨引擎门禁；模板层是 host 光栅化的，必须主动拒绝而不是
    /// 给一个比不了的数。
    #[test]
    fn the_element_fingerprint_refuses_to_speak_for_a_template_layer() {
        let document = document("none", "none");
        let mut plan = OverlayRenderPlan::compile(&document, 640, 360, 3.0, 30.0, None).unwrap();
        plan.set_template_scene(Some(chrome_scene(0.0, 12.0)));
        let error = plan
            .element_drawop_fingerprint(1.0)
            .unwrap_err()
            .to_string();
        assert!(error.contains("模板层"), "{error}");
    }

    /// 十七款内置模板（简体中文词表）两种画幅各一帧 + 字体三态，像素 sha256 与 golden 对拍。
    ///
    /// 与其它 golden 一样：`BCUT_UPDATE_GOLDEN=1` 重写。判别点是逐款不同：
    /// 十七款之间、同款两画幅之间、三种字体解析之间，任意两张都不得相同。
    #[test]
    fn builtin_templates_render_to_golden_frames() {
        use timeline::template::ChapterSpan;
        let chapters = vec![
            // 拉丁标题：CJK 会被字体引擎强制落到 Noto Sans SC，字体三态就测不出差别
            ChapterSpan {
                id: "c1".into(),
                title: "Intro".into(),
                start: 0.0,
                end: 1.0,
            },
            ChapterSpan {
                id: "c2".into(),
                title: "Method".into(),
                start: 1.0,
                end: 2.2,
            },
            ChapterSpan {
                id: "c3".into(),
                title: "Wrap".into(),
                start: 2.2,
                end: 3.0,
            },
        ];
        // 内置字体集 strict 模式：不碰系统字体，任何机器上像素逐位一致
        let fonts = bundled_studio_fonts();
        let mut hashes = std::collections::BTreeMap::new();
        for doc in timeline::template::builtins() {
            for (label, w, h) in [("16x9", 320u32, 180u32), ("9x16", 180, 320)] {
                let scene = TemplateScene::new(doc.clone(), chapters.clone(), "科浪访谈", vec![]);
                let mut engine = TextEngine::with_document_fonts(&fonts);
                let pixmap = crate::template_layer::raster(
                    &scene,
                    crate::template_layer::FrameParams {
                        time: 1.5,
                        duration: 3.0,
                        width: w,
                        height: h,
                        fallback_family: "VK Sans",
                    },
                    &mut engine,
                    false,
                )
                .unwrap();
                assert!(
                    pixmap.data().iter().any(|byte| *byte > 0),
                    "{}/{label} 画空了",
                    doc.id
                );
                hashes.insert(format!("{}/{label}", doc.id), sha256_hex(pixmap.data()));
            }
        }
        // 字体三态：mono 层固定等宽、模板自带字体、缺族回退到字幕字体
        let mut mono = chapter_bar_doc(0.0, 12.0);
        mono.layers.push(timeline::template::TemplateLayer {
            id: "clock".to_string(),
            on: true,
            rect: timeline::template::LayerBox::new(60.0, 40.0, 36.0, 12.0),
            kind: timeline::template::LayerKind::Text {
                text: "{time} / {total}".to_string(),
                color: "#FFFFFF".to_string(),
                bg: Some("#000000A0".to_string()),
                align: timeline::template::TextAlign::Right,
                size: 6.0,
                pad: None,
                mono: true,
                weight: 700,
            },
        });
        let render = |doc: timeline::template::TemplateDoc| {
            let scene = TemplateScene::new(doc, chapters.clone(), "T", vec![]);
            let mut engine = TextEngine::with_document_fonts(&fonts);
            crate::template_layer::raster(
                &scene,
                crate::template_layer::FrameParams {
                    time: 1.5,
                    duration: 3.0,
                    width: 320,
                    height: 180,
                    fallback_family: "VK Sans",
                },
                &mut engine,
                false,
            )
            .unwrap()
        };
        hashes.insert(
            "font/mono".to_string(),
            sha256_hex(render(mono.clone()).data()),
        );
        let mut serif = mono.clone();
        serif.font = Some("Alata".to_string());
        hashes.insert("font/custom".to_string(), sha256_hex(render(serif).data()));
        let mut missing = mono.clone();
        missing.font = Some("No Such Family 42".to_string());
        hashes.insert(
            "font/missing".to_string(),
            sha256_hex(render(missing).data()),
        );
        // 缺族回退 = 跟随字幕字体，与不声明字体时逐字节相同
        assert_eq!(
            hashes["font/missing"], hashes["font/mono"],
            "缺族必须回退到 fallback_family"
        );

        let distinct: std::collections::BTreeSet<_> = hashes.values().collect();
        // 只有 font/missing 与 font/mono 允许相同
        assert_eq!(distinct.len(), hashes.len() - 1, "{hashes:#?}");

        let golden = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/golden/template-layer-frames.json");
        let actual = serde_json::to_string_pretty(&hashes).unwrap();
        if std::env::var_os("BCUT_UPDATE_GOLDEN").is_some() {
            std::fs::create_dir_all(golden.parent().unwrap()).unwrap();
            std::fs::write(&golden, format!("{actual}\n")).unwrap();
        }
        let expected = std::fs::read_to_string(&golden).unwrap_or_else(|e| {
            panic!("读 {}: {e}（BCUT_UPDATE_GOLDEN=1 生成）", golden.display())
        });
        assert_eq!(
            expected.trim_end(),
            actual,
            "模板层 golden 漂移（确认是有意变更后 BCUT_UPDATE_GOLDEN=1 重写）"
        );
    }

    /// 一层文字台标的模板（黑底徽章，alpha 能精确量），盒子与 `tile` / `opacity` 可调。
    fn logo_doc(
        rect: (f64, f64, f64, f64),
        tile: bool,
        opacity: f64,
    ) -> timeline::template::TemplateDoc {
        use timeline::template::{
            LayerBox, LayerKind, LogoShape, LogoSrc, TemplateLayer, TextAlign,
        };
        let mut doc = timeline::template::blank(timeline::template::TemplateCanvas::Wide);
        doc.layers.push(TemplateLayer {
            id: "wm".to_string(),
            on: true,
            rect: LayerBox::new(rect.0, rect.1, rect.2, rect.3),
            kind: LayerKind::Logo {
                src: LogoSrc::TEXT,
                text: "BRAND".to_string(),
                bg: Some("#000000".to_string()),
                color: "#FFFFFF".to_string(),
                shape: LogoShape::Badge,
                size: 6.0,
                pad: None,
                tile,
                opacity,
                align: TextAlign::Center,
            },
        });
        doc
    }

    fn render_logo_doc(doc: timeline::template::TemplateDoc, editing_dim: bool) -> Pixmap {
        let fonts = bundled_studio_fonts();
        let mut engine = TextEngine::with_document_fonts(&fonts);
        crate::template_layer::raster(
            &TemplateScene::new(doc, vec![], "T", vec![]),
            crate::template_layer::FrameParams {
                time: 0.0,
                duration: 3.0,
                width: 320,
                height: 180,
                fallback_family: "VK Sans",
            },
            &mut engine,
            editing_dim,
        )
        .unwrap()
    }

    fn max_alpha(pixmap: &Pixmap) -> u8 {
        pixmap
            .pixels()
            .iter()
            .map(|px| px.alpha())
            .max()
            .unwrap_or(0)
    }

    /// 台标层 `opacity` 是整层不透明度（夹到 0.05–1）；关掉的层在编辑态固定 0.35，
    /// 不与层自己的不透明度相乘（原型 `opacity: !l.on ? 0.35 : layerOpacity(l)`）。
    #[test]
    fn logo_opacity_fades_the_whole_layer() {
        let solid = render_logo_doc(logo_doc((10.0, 10.0, 40.0, 20.0), false, 1.0), false);
        assert_eq!(max_alpha(&solid), 255);
        let half = max_alpha(&render_logo_doc(
            logo_doc((10.0, 10.0, 40.0, 20.0), false, 0.5),
            false,
        ));
        assert!((127..=128).contains(&half), "0.5 → {half}");
        let floor = max_alpha(&render_logo_doc(
            logo_doc((10.0, 10.0, 40.0, 20.0), false, 0.0),
            false,
        ));
        assert!((12..=13).contains(&floor), "0 夹到 0.05 → {floor}");
        let mut off = logo_doc((10.0, 10.0, 40.0, 20.0), false, 0.5);
        off.layers[0].on = false;
        let dim = max_alpha(&render_logo_doc(off, true));
        assert!((89..=90).contains(&dim), "关掉的层编辑态 0.35 → {dim}");
    }

    /// 台标层 `align`（2026-09-15）：徽章底色照旧铺满盒子，字在徽章内边距里靠左 / 居中 / 靠右；
    /// 图片台标等比放进盒子后，横向余量同样按对齐分配。
    #[test]
    fn logo_align_places_text_and_image_inside_the_box() {
        use timeline::template::{LayerKind, LogoSrc, TemplateDoc, TextAlign};
        fn aligned(mut doc: TemplateDoc, value: TextAlign) -> TemplateDoc {
            if let LayerKind::Logo { align, .. } = &mut doc.layers[0].kind {
                *align = value;
            }
            doc
        }
        // 满足条件的像素横向跨度：(最左列, 最右列)
        fn span(pixmap: &Pixmap, lit: impl Fn(u8, u8) -> bool) -> (usize, usize) {
            let width = pixmap.width() as usize;
            let xs: Vec<usize> = pixmap
                .pixels()
                .iter()
                .enumerate()
                .filter(|(_, px)| lit(px.red(), px.alpha()))
                .map(|(i, _)| i % width)
                .collect();
            (
                *xs.iter().min().expect("有墨迹"),
                *xs.iter().max().expect("有墨迹"),
            )
        }
        // 盒子 = 画面 (32,18)–(160,54)；字号 6% × 180 = 10.8px，徽章内边距 0.6em ≈ 6.5px
        let frame = |value| {
            render_logo_doc(
                aligned(logo_doc((10.0, 10.0, 40.0, 20.0), false, 1.0), value),
                false,
            )
        };
        let white = |pixmap: &Pixmap| span(pixmap, |red, _| red > 128);
        let (left, center, right) = (
            frame(TextAlign::Left),
            frame(TextAlign::Center),
            frame(TextAlign::Right),
        );
        for pixmap in [&left, &center, &right] {
            assert_eq!(
                span(pixmap, |_, alpha| alpha == 255),
                (32, 159),
                "底色铺满盒子"
            );
        }
        let (l, c, r) = (white(&left), white(&center), white(&right));
        assert!((38..=42).contains(&l.0), "靠左：字从内边距起 {l:?}");
        assert!((150..=154).contains(&r.1), "靠右：字收在内边距前 {r:?}");
        let mid = (c.0 + c.1) as f64 / 2.0;
        assert!((mid - 96.0).abs() <= 2.0, "居中 {c:?}");
        assert!(l.0 < c.0 && c.0 < r.0, "{l:?} {c:?} {r:?}");
        assert!(
            (l.1 - l.0).abs_diff(r.1 - r.0) <= 1,
            "只平移不变形 {l:?} {r:?}"
        );

        let mut image = Pixmap::new(10, 10).unwrap();
        image.fill(tiny_skia::Color::from_rgba8(255, 0, 0, 255));
        let fonts = bundled_studio_fonts();
        let mut engine = TextEngine::with_document_fonts(&fonts);
        let mut picture = |value| {
            let mut doc = aligned(logo_doc((10.0, 10.0, 40.0, 20.0), false, 1.0), value);
            if let LayerKind::Logo { src, .. } = &mut doc.layers[0].kind {
                *src = LogoSrc::brand("logo-1");
            }
            let scene =
                TemplateScene::new(doc, vec![], "T", vec![("logo-1".into(), image.clone())]);
            let pixmap = crate::template_layer::raster(
                &scene,
                crate::template_layer::FrameParams {
                    time: 0.0,
                    duration: 3.0,
                    width: 320,
                    height: 180,
                    fallback_family: "VK Sans",
                },
                &mut engine,
                false,
            )
            .unwrap();
            span(&pixmap, |_, alpha| alpha > 128)
        };
        // 10×10 放进 128×36 成 36×36：余量 92px 全在右 / 两边各半 / 全在左
        assert_eq!(picture(TextAlign::Left), (32, 67));
        assert_eq!(picture(TextAlign::Center), (78, 113));
        assert_eq!(picture(TextAlign::Right), (124, 159));
    }

    /// 写死的 `pad` 按画面高算、与字号无关：字号不同的台标字与文字层从同一条竖线起笔。
    /// 不写时照旧按各自字号推（徽章 0.6em、文字层 0.5em），起笔位置随字号错开。
    #[test]
    fn explicit_pad_lines_up_text_of_different_sizes() {
        use timeline::template::{LayerBox, LayerKind, TemplateLayer, TextAlign};
        // 盒子 = 画面 (32,18)–(288,72)；字号 6% / 9% / 14% × 180 = 10.8 / 16.2 / 25.2px
        let doc = |size: f64, logo: bool, pad: Option<f64>| {
            let mut doc = logo_doc((10.0, 10.0, 80.0, 30.0), false, 1.0);
            if logo {
                if let LayerKind::Logo {
                    size: slot,
                    align,
                    pad: inset,
                    ..
                } = &mut doc.layers[0].kind
                {
                    *slot = size;
                    *align = TextAlign::Left;
                    *inset = pad;
                }
            } else {
                doc.layers[0] = TemplateLayer {
                    id: "tx".to_string(),
                    on: true,
                    rect: LayerBox::new(10.0, 10.0, 80.0, 30.0),
                    kind: LayerKind::Text {
                        text: "BRAND".to_string(),
                        color: "#FFFFFF".to_string(),
                        bg: Some("#000000".to_string()),
                        align: TextAlign::Left,
                        size,
                        pad,
                        mono: false,
                        weight: 800,
                    },
                };
            }
            doc
        };
        // 白字最左一列
        let start = |doc| {
            let pixmap = render_logo_doc(doc, false);
            let width = pixmap.width() as usize;
            pixmap
                .pixels()
                .iter()
                .enumerate()
                .filter(|(_, px)| px.red() > 128)
                .map(|(i, _)| i % width)
                .min()
                .expect("有墨迹")
        };
        let cases = [(6.0, true), (9.0, false), (14.0, false)];
        let starts = |pad: Option<f64>| -> Vec<usize> {
            cases
                .iter()
                .map(|&(size, logo)| start(doc(size, logo, pad)))
                .collect()
        };
        let spread = |xs: &[usize]| xs.iter().max().unwrap() - xs.iter().min().unwrap();
        // pad 5% × 180 = 9px：字从 32 + 9 = 41 起，只差字形自带的左侧留白（随字号略涨）
        let fixed = starts(Some(5.0));
        assert!(
            fixed.iter().all(|x| (41..=44).contains(x)),
            "起笔在盒子左缘 + 9px：{fixed:?}"
        );
        assert!(spread(&fixed) <= 2, "三层同一条起笔线：{fixed:?}");
        // 不写：6.5 / 8.1 / 12.6px，三条起笔线错开
        let legacy = starts(None);
        assert!(spread(&legacy) >= 5, "按字号推的内边距对不齐：{legacy:?}");
        // 0 就是贴盒子左缘
        let flush = starts(Some(0.0));
        assert!(flush.iter().all(|x| (32..=35).contains(x)), "{flush:?}");
    }

    /// 平铺台标：同一枚台标铺进盒子后绕盒心斜放放大——墨迹越出盒子（放大旋转后的角），
    /// 但画面四角仍然干净（`overflow: hidden` 裁在变换前的盒子上，随层一起旋转）。
    #[test]
    fn tiled_logo_spills_past_its_box_but_clips_to_the_rotated_box() {
        let flat = render_logo_doc(logo_doc((25.0, 25.0, 50.0, 50.0), false, 1.0), false);
        let tiled = render_logo_doc(logo_doc((25.0, 25.0, 50.0, 50.0), true, 1.0), false);
        assert_ne!(sha256_hex(flat.data()), sha256_hex(tiled.data()));
        // 盒子 = 画面 (80,45)–(240,135)
        let outside = |pixmap: &Pixmap| {
            (0..pixmap.height())
                .flat_map(|y| (0..pixmap.width()).map(move |x| (x, y)))
                .filter(|&(x, y)| !(80..240).contains(&x) || !(45..135).contains(&y))
                .filter(|&(x, y)| pixmap.pixel(x, y).is_some_and(|px| px.alpha() > 0))
                .count()
        };
        assert_eq!(outside(&flat), 0, "不平铺的层不越出盒子");
        assert!(outside(&tiled) > 0, "平铺斜放放大后应越出盒子");
        for (x, y) in [(0, 0), (319, 0), (0, 179), (319, 179)] {
            assert_eq!(
                tiled.pixel(x, y).unwrap().alpha(),
                0,
                "({x},{y}) 在旋转盒外"
            );
        }
    }

    /// 平铺排布就是原型的 flex 换行：`padding: 1em`、`gap: 1.6em 2.4em`、行内行间都
    /// `space-around`，放不下时按 `safe center` 贴起点溢出。
    #[test]
    fn tile_layout_follows_flex_wrap_space_around() {
        use crate::template_layer::{TILE_UNITS, tile_positions};
        // 1000×500 盒、em 10、单元 50×12：内容 980×480，一行 13 枚（13·50 + 12·24 = 938 ≤ 980）
        let pos = tile_positions(1000.0, 500.0, 10.0, 50.0, 12.0, TILE_UNITS);
        assert_eq!(pos.len(), 24);
        let (first, second) = pos.split_at(13);
        assert!(first.iter().all(|p| p.1 == first[0].1));
        assert!(second.iter().all(|p| p.1 == second[0].1));
        assert!(second[0].1 > first[0].1);
        // 行内 space-around：首尾留白相等，首项留白 = 剩余 / (2n)
        let lead = first[0].0 - 10.0;
        assert!((lead - 42.0 / 26.0).abs() < 1e-9, "{lead}");
        assert!((lead - (990.0 - (first[12].0 + 50.0))).abs() < 1e-9);
        let lead2 = second[0].0 - 10.0;
        assert!((lead2 - (990.0 - (second[10].0 + 50.0))).abs() < 1e-9);
        // 行间 space-around：上下留白相等
        let top = first[0].1 - 10.0;
        assert!((top - (490.0 - (second[0].1 + 12.0))).abs() < 1e-9);
        assert!((top - (480.0 - 24.0 - 16.0) / 4.0).abs() < 1e-9, "{top}");
        // 一枚都放不下：仍排一枚，横向贴起点溢出（`safe center`），纵向放得下照旧 space-around
        let tight = tile_positions(40.0, 40.0, 10.0, 50.0, 12.0, 1);
        assert_eq!(tight, vec![(10.0, 10.0 + 4.0)]);
        // 行数溢出（原型舞台上 14% × 8% 的台标盒铺 24 行）：首行贴 padding，不往上溢出
        let rows = tile_positions(82.3, 26.5, 10.6, 33.9, 16.9, TILE_UNITS);
        assert_eq!(rows.len(), 24);
        assert!((rows[0].1 - 10.6).abs() < 1e-9, "{:?}", rows[0]);
        assert!(
            (rows[1].1 - rows[0].1 - (16.9 + 16.96)).abs() < 1e-9,
            "{:?}",
            rows[1]
        );
        assert!((rows[0].0 - 24.2).abs() < 0.05, "{:?}", rows[0]);
    }

    /// R1 场景出口必须从真实 Overlay plan 组装，而不是测试手写一张
    /// `SceneFrame`。节点顺序、指纹和调度时刻三个身份在这里一起钉住。
    #[test]
    fn the_element_scene_is_assembled_from_the_canonical_overlay_plan() {
        let mut source = document("none", "none");
        source["timeline"] = json!({
            "tracks": [{
                "elements": [
                    {
                        "id": "shape-back", "kind": "shape", "start": 0.25, "end": 2.75,
                        "place": {"x": 50, "y": 50, "w": 40},
                        "shape": {"shape": "rect", "fill": "#00ff00"}
                    },
                    {
                        "id": "progress-front", "kind": "progress", "start": 0.25, "end": 2.75,
                        "place": {"x": 50, "y": 70, "w": 60, "rot": 25},
                        "progress": {
                            "style": "normal",
                            "mainColor": "#ff0000",
                            "secondaryColor": "#0000ff"
                        }
                    }
                ]
            }]
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(
            std::path::Path::new("/nonexistent/baocut-r1-scene-plan"),
            &source,
        )
        .unwrap();

        let scene = plan.element_scene_frame(1.25).unwrap();
        assert_eq!(scene.nodes.len(), 2);
        assert!(matches!(
            scene.nodes[0],
            element_draw::SceneNode::Vectors(_)
        ));
        let element_draw::SceneNode::ShaderQuad { transform, .. } = &scene.nodes[1] else {
            panic!("progress 必须保持 z 序并作为 ShaderQuad 输出")
        };
        assert!(
            transform.transform[1].abs() > 0.01,
            "旋转不得在场景组装时丢失"
        );
        assert!(
            transform.transform[4].abs() > 0.01,
            "旋转不得退化成轴对齐盒"
        );

        let canonical =
            u64::from_str_radix(&plan.element_drawop_fingerprint(1.25).unwrap(), 16).unwrap();
        assert_eq!(scene.fingerprint, canonical);
        assert_eq!(scene.next_change, Some(38.0 / 30.0));
    }

    /// R2 glyph scene 必须消费现有 OverlayRenderPlan 的排版结果；同一时刻重求场景
    /// 时 mask 像素命中 TextEngine 的 Arc 缓存，而不是再次跑 swash 或整幅光栅。
    #[test]
    fn plain_subtitles_become_reusable_glyph_scene_masks() {
        let mut source = document("None", "none");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();

        let first = plan.subtitle_scene_frame(1.0).unwrap();
        assert_eq!(first.scene.nodes.len(), 1);
        assert_eq!(
            first.scene.fingerprint,
            subtitle_scene_fingerprint(&plan.definition_key, &first.key)
        );
        let element_draw::SceneNode::Glyphs(first_run) = &first.scene.nodes[0] else {
            panic!("普通字幕必须成为 glyph run")
        };
        assert!(!first_run.glyphs.is_empty());
        assert!(first_run.glyphs.iter().all(|glyph| matches!(
            &glyph.mask.pixels,
            element_draw::GlyphPixels::Alpha(alpha)
                if alpha.len() == glyph.mask.width as usize * glyph.mask.height as usize
        )));

        let second = plan.subtitle_scene_frame(1.0).unwrap();
        let element_draw::SceneNode::Glyphs(second_run) = &second.scene.nodes[0] else {
            panic!("稳定帧仍必须是 glyph run")
        };
        assert_eq!(first.key, second.key);
        assert!(
            Arc::ptr_eq(&first_run.glyphs, &second_run.glyphs),
            "稳定 cue 必须复用整份字形几何"
        );
        assert_eq!(first_run.uniforms, second_run.uniforms);

        let mut recolored = source;
        recolored["style"]["fontColor"] = json!("#ff0000");
        let mut recolored =
            OverlayRenderPlan::compile(&recolored, 320, 180, 3.0, 30.0, None).unwrap();
        let recolored = recolored.subtitle_scene_frame(1.0).unwrap();
        assert_ne!(
            first.scene.fingerprint, recolored.scene.fingerprint,
            "subtitle key 相同时，计划定义仍必须参与 retained scene 身份"
        );
    }

    #[test]
    fn colr_subtitles_keep_premultiplied_rgba_in_the_glyph_scene() {
        let mut source = document("None", "none");
        source["style"]["fontFamily"] = json!("ColrProbe");
        source["style"]["fontColor"] = json!("#00FF0080");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["cues"][0]["text"] = json!("A");
        source["cues"][0]["words"] = json!([{"text": "A", "t0": 0.5, "t1": 2.5}]);
        let mut plan = OverlayRenderPlan::compile_with_injected_fonts(
            &source,
            320,
            180,
            3.0,
            30.0,
            None,
            OverlayIncludes::ALL,
            vec![include_bytes!("../../render-raster/tests/fixtures/fonts/ColrProbe.ttf").to_vec()],
        )
        .unwrap();

        let frame = plan.subtitle_scene_frame(1.0).unwrap();
        let [element_draw::SceneNode::Glyphs(run)] = frame.scene.nodes.as_slice() else {
            panic!("COLR 字幕必须留在原有 glyph run 顺序中")
        };
        let [glyph] = run.glyphs.as_ref() else {
            panic!("单字探针必须只产生一枚 glyph")
        };
        let element_draw::GlyphPixels::Color(rgba) = &glyph.mask.pixels else {
            panic!("COLR 字幕必须携带预乘 RGBA atlas 像素")
        };
        assert_eq!(
            rgba.len(),
            glyph.mask.width as usize * glyph.mask.height as usize * 4
        );
        assert!(rgba.chunks_exact(4).any(|pixel| pixel[3] > 0));
        assert_eq!(
            run.uniforms[glyph.uniform_index as usize].color_opacity, 1.0,
            "彩色字形不能误吃 fontColor 自身的 alpha"
        );
    }

    #[test]
    fn subtitle_backgrounds_become_a_vector_pass_before_glyphs() {
        let mut source = document("None", "none");
        source["style"]["outline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();

        let frame = plan.subtitle_scene_frame(1.0).unwrap();
        assert_eq!(frame.scene.nodes.len(), 2);
        let element_draw::SceneNode::Vectors(plate) = &frame.scene.nodes[0] else {
            panic!("字幕底板必须先进入 vector pass")
        };
        let [
            DrawOp::FillRect {
                w,
                h,
                radius,
                color,
                ..
            },
        ] = plate.ops.as_slice()
        else {
            panic!("单行字幕底板必须是一条 FillRect")
        };
        assert!(*w > 0.0 && *h > 0.0 && *radius >= 0.0);
        assert!((color[3] - 0.701_960_8).abs() < 1e-6, "{color:?}");
        assert!(matches!(
            frame.scene.nodes[1],
            element_draw::SceneNode::Glyphs(_)
        ));
    }

    #[test]
    fn plain_subtitle_underlines_become_a_vector_pass_after_glyphs() {
        let mut source = document("None", "none");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(true);
        source["style"]["glow"] = json!({"on": false});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();

        let frame = plan.subtitle_scene_frame(1.0).unwrap();
        let [
            element_draw::SceneNode::Glyphs(_),
            element_draw::SceneNode::AnimatedVectors {
                frame: underlines,
                pose,
                motion,
            },
        ] = frame.scene.nodes.as_slice()
        else {
            panic!("普通下划线必须在正文 glyph 后进入 vector pass")
        };
        assert_eq!(*pose, element_draw::ScenePose::IDENTITY);
        assert!(motion.is_none());
        assert!(!underlines.ops.is_empty());
        assert!(underlines.ops.iter().all(|op| matches!(
            op,
            DrawOp::FillRect {
                h,
                radius,
                color,
                ..
            } if *h >= 1.0 && *radius > 0.0 && color[3] > 0.0
        )));
    }

    #[test]
    fn simple_word_animations_update_only_glyph_run_uniforms() {
        let mut source = document("Color", "none");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();

        let first = plan.subtitle_scene_frame(0.8).unwrap();
        let second = plan.subtitle_scene_frame(1.5).unwrap();
        let element_draw::SceneNode::Glyphs(first_run) = &first.scene.nodes[0] else {
            panic!("Color 动画必须走 glyph run")
        };
        let element_draw::SceneNode::Glyphs(second_run) = &second.scene.nodes[0] else {
            panic!("Color 动画切词后仍必须走 glyph run")
        };
        assert!(Arc::ptr_eq(&first_run.glyphs, &second_run.glyphs));
        assert_ne!(first_run.uniforms, second_run.uniforms);
        assert_eq!(first.scene.next_change, Some(1.2));
        assert!(first_run.uniforms.iter().any(|uniform| {
            uniform.color[0] == 1.0
                && (uniform.color[1] - 212.0 / 255.0).abs() < 1e-6
                && (uniform.color[2] - 59.0 / 255.0).abs() < 1e-6
        }));

        source["style"]["wordAnimation"] = json!({"animationName": "Reveal"});
        let mut reveal = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        let reveal = reveal.subtitle_scene_frame(0.8).unwrap();
        let element_draw::SceneNode::Glyphs(reveal) = &reveal.scene.nodes[0] else {
            panic!("Reveal 动画必须走 glyph run")
        };
        assert!(
            reveal
                .uniforms
                .iter()
                .any(|uniform| uniform.color[3] == 0.0)
        );

        source["style"]["wordAnimation"] = json!({"animationName": "Bounce"});
        let mut bounce = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        let bounce = bounce.subtitle_scene_frame(0.8).unwrap();
        let element_draw::SceneNode::Glyphs(bounce) = &bounce.scene.nodes[0] else {
            panic!("Bounce 动画必须走 glyph run")
        };
        assert!(
            bounce
                .uniforms
                .iter()
                .any(|uniform| uniform.transform[5] < -0.1)
        );
    }

    #[test]
    fn subtitle_scene_exposes_one_motion_interval_instead_of_frame_bucket_rebuilds() {
        let mut source = document("None", "magic-pop");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        let mut plan = OverlayRenderPlan::compile(&source, 640, 360, 3.0, 30.0, None).unwrap();

        let first = plan.subtitle_scene_frame(0.01).unwrap();
        assert!((first.scene.next_change.unwrap() - 0.1).abs() < 1e-9);
        assert!((first.scene.active_until.unwrap() - 0.1).abs() < 1e-9);
        let element_draw::SceneNode::Glyphs(first_run) = &first.scene.nodes[0] else {
            panic!("无底板字幕必须直接产出 glyph motion")
        };
        let motion = first_run.motion.as_ref().expect("magic-pop motion");
        assert!((motion.start - 0.0).abs() < 1e-9);
        assert!((motion.end - 0.1).abs() < 1e-9);

        // 项目帧边界上，合成器连续采样必须与旧 CPU 配方的 round-both-ends
        // 采样逐字段一致；只有显示器补出的子帧允许是连续中间态。
        let frame_time = 1.0 / 30.0;
        let sampled = motion.sample(frame_time);
        let second = plan.subtitle_scene_frame(frame_time).unwrap();
        let element_draw::SceneNode::Glyphs(second_run) = &second.scene.nodes[0] else {
            panic!("下一项目帧仍必须是 glyph motion")
        };
        for (sampled, reference) in sampled.transform.into_iter().zip(second_run.pose.transform) {
            assert!(
                (sampled - reference).abs() <= 2e-5,
                "sampled={sampled} reference={reference} delta={}",
                (sampled - reference).abs()
            );
        }
        assert!((sampled.opacity - second_run.pose.opacity).abs() < 1e-6);

        let mut cpu = OverlayRenderPlan::compile(&source, 640, 360, 3.0, 30.0, None).unwrap();
        let cpu_frame = cpu.render_png(0.01).unwrap();
        assert!(
            (cpu_frame.next_change.unwrap() - 1.0 / 60.0).abs() < 1e-9,
            "CPU reference 仍保持历史帧桶调度"
        );
    }

    #[test]
    fn magic_fade_wraps_the_retained_scene_in_one_animated_blur_group() {
        let mut source = document("None", "magic-fade");
        source["style"]["glow"] = json!({"on": false});
        let mut plan = OverlayRenderPlan::compile(&source, 640, 360, 3.0, 30.0, None).unwrap();
        let first = plan.subtitle_scene_frame(0.01).unwrap();
        let [element_draw::SceneNode::BlurredGroup(first_group)] = first.scene.nodes.as_slice()
        else {
            panic!("magic-fade 必须在完整字幕场景之外套一层 blur group")
        };
        assert!(first_group.radius > 0.0);
        assert_eq!(first_group.nodes.len(), 3, "底板、描边、正文必须一起模糊");
        let motion = first_group.motion.as_ref().expect("fade blur motion");
        assert!(motion.from.blur > 0.0);
        assert_eq!(motion.to.blur, 0.0);
        assert!((first.scene.active_until.unwrap() - motion.end).abs() < 1e-9);

        let frame_time = 1.0 / 30.0;
        let second = plan.subtitle_scene_frame(frame_time).unwrap();
        let [element_draw::SceneNode::BlurredGroup(second_group)] = second.scene.nodes.as_slice()
        else {
            panic!("fade 项目帧仍必须是同一 blur group")
        };
        assert!((motion.sample(frame_time).blur - second_group.radius).abs() < 2e-5);
        let element_draw::SceneNode::Glyphs(first_fill) = &first_group.nodes[2] else {
            panic!("blur group 内第三层必须是正文 glyph")
        };
        let element_draw::SceneNode::Glyphs(second_fill) = &second_group.nodes[2] else {
            panic!("下一项目帧仍必须保留正文 glyph")
        };
        assert!(Arc::ptr_eq(&first_fill.glyphs, &second_fill.glyphs));
    }

    #[test]
    fn subtitle_outlines_become_a_retained_atlas_pass_before_fill() {
        let mut source = document("None", "none");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(true);
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        let first = plan.subtitle_scene_frame(1.0).unwrap();
        let [
            element_draw::SceneNode::Glyphs(outline),
            element_draw::SceneNode::Glyphs(fill),
        ] = first.scene.nodes.as_slice()
        else {
            panic!("无底板描边字幕必须按 outline → fill 发两条 glyph pass")
        };
        assert_eq!(outline.glyphs.len(), fill.glyphs.len());
        assert!(outline.glyphs.iter().zip(fill.glyphs.iter()).all(
            |(outline, fill)| outline.mask.key != fill.mask.key
                && outline.mask.width >= fill.mask.width
                && outline.mask.height >= fill.mask.height
        ));
        assert!(outline.uniforms.iter().all(|uniform| {
            uniform.color[0] == 0.0
                && uniform.color[1] == 0.0
                && uniform.color[2] == 0.0
                && uniform.color[3] > 0.0
        }));
        assert!(fill.uniforms.iter().all(|uniform| {
            uniform.color[0] == 1.0
                && uniform.color[1] == 1.0
                && uniform.color[2] == 1.0
                && uniform.color[3] > 0.0
        }));

        let second = plan.subtitle_scene_frame(1.5).unwrap();
        let [
            element_draw::SceneNode::Glyphs(second_outline),
            element_draw::SceneNode::Glyphs(second_fill),
        ] = second.scene.nodes.as_slice()
        else {
            panic!("稳态描边字幕仍必须保留两条 glyph pass")
        };
        assert!(Arc::ptr_eq(&outline.glyphs, &second_outline.glyphs));
        assert!(Arc::ptr_eq(&fill.glyphs, &second_fill.glyphs));
    }

    #[test]
    fn subtitle_glow_merges_outline_and_fill_before_one_retained_blur() {
        let mut source = document("None", "none");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(true);
        source["style"]["glow"] = json!({
            "on": true,
            "intensity": 60,
            "range": 20,
            "color": "#40A0FF"
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        let first = plan.subtitle_scene_frame(1.0).unwrap();
        let [
            element_draw::SceneNode::BlurredGlyphs(effect),
            element_draw::SceneNode::Glyphs(outline),
            element_draw::SceneNode::Glyphs(fill),
        ] = first.scene.nodes.as_slice()
        else {
            panic!("glow 必须先按 outline + fill 合成一次 effect，再画清晰正文")
        };
        assert_eq!(effect.layers.len(), 2);
        assert_eq!(
            effect.radius,
            plan.original_style.effect_blur.round() as u32
        );
        assert_eq!(effect.layers[0].glyphs.len(), outline.glyphs.len());
        assert_eq!(effect.layers[1].glyphs.len(), fill.glyphs.len());
        assert!(
            effect
                .layers
                .iter()
                .all(|layer| layer.uniforms.iter().all(|uniform| uniform.color[3] > 0.0))
        );

        let second = plan.subtitle_scene_frame(1.5).unwrap();
        let element_draw::SceneNode::BlurredGlyphs(second_effect) = &second.scene.nodes[0] else {
            panic!("稳态 glow 仍必须是 GPU effect node")
        };
        assert!(Arc::ptr_eq(
            &effect.layers[0].glyphs,
            &second_effect.layers[0].glyphs
        ));
        assert!(Arc::ptr_eq(
            &effect.layers[1].glyphs,
            &second_effect.layers[1].glyphs
        ));
    }

    #[test]
    fn subtitle_shadow_offset_is_frozen_into_retained_effect_geometry() {
        let mut source = document("None", "none");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["dropShadow"] = json!({
            "on": true,
            "color": "#000000",
            "opacity": 0.6,
            "distance": 0.1,
            "rotation": 0,
            "blur": 0.08
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        let frame = plan.subtitle_scene_frame(1.0).unwrap();
        let [
            element_draw::SceneNode::BlurredGlyphs(effect),
            element_draw::SceneNode::Glyphs(fill),
        ] = frame.scene.nodes.as_slice()
        else {
            panic!("drop shadow 必须先于清晰正文进入 effect node")
        };
        assert_eq!(effect.layers.len(), 1);
        let shadow = &effect.layers[0];
        assert_eq!(shadow.glyphs.len(), fill.glyphs.len());
        let dx = shadow.glyphs[0].transform[4] - fill.glyphs[0].transform[4];
        let dy = shadow.glyphs[0].transform[5] - fill.glyphs[0].transform[5];
        assert!((dx - plan.original_style.effect_x as f32).abs() < 1e-5);
        assert!((dy - plan.original_style.effect_y as f32).abs() < 1e-5);
    }

    #[test]
    fn reveal_shadow_off_updates_effect_uniforms_without_changing_geometry() {
        let mut source = document("Reveal", "none");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["glow"] = json!({
            "on": true,
            "intensity": 50,
            "range": 12,
            "color": "#FFFFFF"
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        let first = plan.subtitle_scene_frame(0.8).unwrap();
        let second = plan.subtitle_scene_frame(1.5).unwrap();
        let element_draw::SceneNode::BlurredGlyphs(first_effect) = &first.scene.nodes[0] else {
            panic!("Reveal glow 必须进入 effect node")
        };
        let element_draw::SceneNode::BlurredGlyphs(second_effect) = &second.scene.nodes[0] else {
            panic!("Reveal 切词后仍必须进入 effect node")
        };
        assert!(Arc::ptr_eq(
            &first_effect.layers[0].glyphs,
            &second_effect.layers[0].glyphs
        ));
        assert_ne!(
            first_effect.layers[0].uniforms,
            second_effect.layers[0].uniforms
        );
        assert!(
            first_effect.layers[0]
                .uniforms
                .iter()
                .any(|uniform| uniform.color[3] == 0.0)
        );
    }

    #[test]
    fn text_elements_become_ordered_glyph_scene_passes() {
        let mut source = document("None", "none");
        source["timeline"] = json!({
            "tracks": [{"kind": "overlay", "elements": [{
                "id": "title", "kind": "text", "start": 0.25, "end": 2.75,
                "text": "Retained title",
                "place": {"x": 42, "y": 38, "w": 55, "scale": 1.1,
                    "rot": 7, "opacity": 0.8},
                "style": {
                    "fontFamily": "Montserrat", "fontSize": 34,
                    "fontColor": "#fefefe", "background": true,
                    "backgroundColor": "#122033cc", "backgroundPadding": 8,
                    "outline": true,
                    "textOutline": {"on": true, "width": 4, "color": "#000000"},
                    "dropShadow": {"on": true, "color": "#000000", "opacity": 0.6,
                        "distance": 0.1, "rotation": 0, "blur": 0.08}
                }
            }]}]
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(
            std::path::Path::new("/nonexistent/baocut-r3-text-scene"),
            &source,
        )
        .unwrap();

        let first = plan.text_element_scene_frame(1.0).unwrap();
        assert_eq!(first.next_change, Some(2.75));
        assert!(matches!(
            first.nodes.as_slice(),
            [
                element_draw::SceneNode::AnimatedVectors { .. },
                element_draw::SceneNode::BlurredGlyphs(_),
                element_draw::SceneNode::Glyphs(_),
                element_draw::SceneNode::Glyphs(_),
            ]
        ));
        let element_draw::SceneNode::Glyphs(fill) = first.nodes.last().unwrap() else {
            panic!("文字正文必须是最后一条清晰 glyph pass")
        };
        assert!(!fill.glyphs.is_empty());
        assert_eq!(fill.pose.opacity, 0.8);
        assert!(
            fill.pose.transform[1].abs() > 0.01,
            "rotation 必须进容器 pose"
        );

        let second = plan.text_element_scene_frame(1.0).unwrap();
        let element_draw::SceneNode::Glyphs(second_fill) = second.nodes.last().unwrap() else {
            panic!("稳定帧仍必须是 glyph pass")
        };
        assert_eq!(fill.glyphs[0].mask.key, second_fill.glyphs[0].mask.key);
        assert!(
            Arc::ptr_eq(
                fill.glyphs[0].mask.pixels.data(),
                second_fill.glyphs[0].mask.pixels.data()
            ),
            "同一 text element 必须命中 TextEngine 的 swash mask 缓存"
        );
    }

    /// 第 156 轮：文字元素的 `block` 底板只在用户给了 `place.w` 时才撑满
    /// 换行宽；没给宽度时底板贴着文字（原型 `padOf`/`block` 同理）。
    #[test]
    fn text_element_block_plate_hugs_text_unless_width_is_set() {
        let render = |place: serde_json::Value| {
            let mut source = document("None", "none");
            source["cues"] = json!([]);
            source["timeline"] = json!({
                "tracks": [{"kind": "overlay", "elements": [{
                    "id": "plated", "kind": "text", "start": 0.0, "end": 2.0,
                    "text": "Hi",
                    "place": place,
                    "style": {
                        "fontFamily": "Montserrat", "fontSize": 40,
                        "fontColor": "#ffffff", "background": true,
                        "backgroundStyle": "block",
                        "backgroundColor": "#2455d6", "backgroundPadding": 6
                    }
                }]}]
            });
            let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 2.0, 30.0, None).unwrap();
            plan.load_timeline_elements(
                std::path::Path::new("/nonexistent/baocut-text-plate"),
                &source,
            )
            .unwrap();
            let element = plan.elements[0].clone();
            let pixmap = plan.render_text_element(&element, 1.0).unwrap();
            alpha_bbox(pixmap.data(), 320, 180).expect("底板应有像素")
        };
        let hugged = render(json!({"x": 50, "y": 50}));
        let filled = render(json!({"x": 50, "y": 50, "w": 90}));
        let hugged_w = hugged.cols.end - hugged.cols.start;
        let filled_w = filled.cols.end - filled.cols.start;
        assert!(
            hugged_w < 320 * 60 / 100,
            "没有 place.w 时底板必须贴着两个字：{hugged_w}px"
        );
        assert!(
            filled_w > hugged_w + 100,
            "给了 place.w=90 才撑满换行宽：hugged={hugged_w}px filled={filled_w}px"
        );
    }

    #[test]
    fn text_element_wipe_masks_the_cpu_layer_and_stays_in_retained_scene() {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({
            "tracks": [{"kind": "overlay", "elements": [{
                "id": "wiped-title", "kind": "text", "start": 0.0, "end": 2.0,
                "text": "WIPE TITLE",
                "place": {"x": 50, "y": 50, "w": 90},
                "style": {
                    "fontFamily": "Montserrat", "fontSize": 44,
                    "fontColor": "#ffffff", "background": true,
                    "backgroundColor": "#2455d6dd", "backgroundPadding": 12,
                    "outline": true,
                    "textOutline": {"on": true, "width": 3, "color": "#000000"}
                },
                "animate": {"enter": {"preset": "wipe", "presetVersion": 1, "dur": 0.6}}
            }]}]
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 2.0, 30.0, None).unwrap();
        plan.load_timeline_elements(
            std::path::Path::new("/nonexistent/baocut-text-wipe"),
            &source,
        )
        .unwrap();

        let time = 0.067;
        let scene = plan.text_element_scene_frame(time).unwrap();
        let [element_draw::SceneNode::BlurredGroup(group)] = scene.nodes.as_slice() else {
            panic!("wipe 必须把文字全部 pass 保留在一个 reveal group")
        };
        let reveal = group.reveal.expect("wipe group 必须携带 reveal uniform");
        assert!((0.0..1.0).contains(&reveal));
        assert_eq!(group.radius, 0.0);
        assert!(group.nodes.len() >= 3, "底板、描边与正文必须一起被 wipe");

        let element = plan.elements[0].clone();
        let partial = plan.render_text_element(&element, time).unwrap();
        let partial_bounds = alpha_bbox(partial.data(), 320, 180).expect("wipe 中段应有像素");
        let boundary = (f64::from(reveal) * 320.0).ceil() as usize;
        assert!(
            partial_bounds.cols.end <= boundary,
            "CPU reference 必须在同一 reveal 边界裁掉整层：{:?} > {boundary}",
            partial_bounds.cols
        );
        let full = plan.render_text_element(&element, 1.0).unwrap();
        let full_bounds = alpha_bbox(full.data(), 320, 180).expect("wipe 完成后应有像素");
        assert!(
            full_bounds.cols.end > partial_bounds.cols.end,
            "wipe 完成后应恢复文字右侧：partial={:?}, full={:?}, reveal={reveal}",
            partial_bounds.cols,
            full_bounds.cols
        );
    }

    #[test]
    fn plain_text_element_underlines_follow_the_glyph_pass() {
        let mut source = document("None", "none");
        source["timeline"] = json!({
            "tracks": [{"elements": [{
                "id": "underlined", "kind": "text", "start": 0.0, "end": 3.0,
                "text": "UNDER LINE",
                "style": {
                    "fontFamily": "Montserrat", "fontSize": 32,
                    "fontColor": "#ffffff", "underline": true,
                    "background": false, "outline": false,
                    "textOutline": {"on": false}, "dropShadow": {"on": false},
                    "glow": {"on": false}
                }
            }]}]
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(
            std::path::Path::new("/nonexistent/baocut-text-underline"),
            &source,
        )
        .unwrap();

        let scene = plan.text_element_scene_frame(1.0).unwrap();
        let [
            element_draw::SceneNode::Glyphs(_),
            element_draw::SceneNode::AnimatedVectors {
                frame: underlines, ..
            },
        ] = scene.nodes.as_slice()
        else {
            panic!("普通文字下划线必须在正文 glyph 后进入 vector pass")
        };
        assert!(!underlines.ops.is_empty());

        source["timeline"]["tracks"][0]["elements"][0]["animate"] =
            json!({"enter": {"preset": "riseWords", "presetVersion": 1}});
        let mut cascade = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        cascade
            .load_timeline_elements(
                std::path::Path::new("/nonexistent/baocut-text-underline-cascade"),
                &source,
            )
            .unwrap();
        let scene = cascade.text_element_scene_frame(0.1).unwrap();
        assert!(scene.nodes.len() >= 4);
        let mut runs = Vec::new();
        for (index, node) in scene.nodes.iter().enumerate() {
            match node {
                element_draw::SceneNode::Glyphs(run) => {
                    assert_eq!(run.uniforms.len(), 1);
                    assert!(matches!(
                        scene.nodes.get(index + 1),
                        Some(element_draw::SceneNode::AnimatedVectors { .. })
                    ));
                    runs.push(run);
                }
                element_draw::SceneNode::AnimatedVectors {
                    frame: underline, ..
                } => assert_eq!(underline.ops.len(), 1),
                _ => panic!("逐词移动文字必须保持 chunk glyph → underline 的 CPU z 序"),
            }
        }
        let first = runs.first().expect("至少有一个字形 chunk");
        assert!(
            runs.iter()
                .skip(1)
                .any(|run| run.uniforms != first.uniforms),
            "每个 part 必须保留独立级联姿态"
        );
    }

    #[test]
    fn text_element_alignment_moves_cpu_and_retained_glyphs_inside_place_width() {
        let render = |align: &str| {
            let mut source = document("None", "none");
            source["timeline"] = json!({
                "tracks": [{"elements": [{
                    "id": "aligned", "kind": "text", "start": 0.0, "end": 3.0,
                    "text": "ALIGN",
                    "place": {"x": 50, "y": 50, "w": 80},
                    "style": {
                        "fontFamily": "Montserrat", "fontSize": 24,
                        "fontColor": "#ffffff", "textAlign": align,
                        "background": false, "outline": false,
                        "textOutline": {"on": false}, "dropShadow": {"on": false},
                        "glow": {"on": false}
                    }
                }]}]
            });
            let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
            plan.load_timeline_elements(
                std::path::Path::new("/nonexistent/baocut-text-align"),
                &source,
            )
            .unwrap();

            let scene = plan.text_element_scene_frame(1.0).unwrap();
            let [element_draw::SceneNode::Glyphs(glyphs)] = scene.nodes.as_slice() else {
                panic!("无装饰文字必须只产生一条 glyph pass")
            };
            let retained_x = glyphs.glyphs[0].transform[4];

            let element = plan.elements[0].clone();
            let pixmap = plan.render_text_element(&element, 1.0).unwrap();
            let cpu_x = alpha_bbox(pixmap.data(), 320, 180)
                .expect("文字元素必须有非零像素")
                .cols
                .start;
            (retained_x, cpu_x)
        };

        let left = render("left");
        let center = render("center");
        let right = render("right");
        assert!(
            left.0 < center.0 && center.0 < right.0,
            "retained: {left:?} {center:?} {right:?}"
        );
        assert!(
            left.1 < center.1 && center.1 < right.1,
            "CPU: {left:?} {center:?} {right:?}"
        );
    }

    /// 字幕行缺省在字幕块自己的宽里对齐（块居中在锚点上，v2 的 Studio 样式就是这样）；根样式带
    /// `alignWithinWrap` 时在折行宽度里对齐，块贴折行区域的左边或右边（定位框样式用它）。
    #[test]
    fn captions_align_within_the_wrap_width_only_when_the_root_asks() {
        let layouts = |within: Option<bool>, align: &str| {
            let mut source = document("None", "none");
            source["style"]["textAlign"] = json!(align);
            if let Some(on) = within {
                source["style"][crate::ALIGN_WITHIN_WRAP_KEY] = json!(on);
            }
            let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
            plan.active_layouts(1.0)
        };
        let wrap = 320.0 * 0.8;
        let studio = layouts(None, "left");
        assert_eq!(studio[0].text_align, LineTextAlign::Left);
        assert!(studio[0].width < wrap, "这一句比折行宽度短：{}", studio[0].width);
        assert_eq!(studio[0].align_width, studio[0].width);
        assert_eq!(layouts(Some(false), "left")[0].align_width, studio[0].width);
        let boxed = layouts(Some(true), "right");
        assert_eq!(boxed[0].text_align, LineTextAlign::Right);
        assert_eq!(boxed[0].align_width, wrap);
        assert_eq!(boxed[0].width, studio[0].width);
    }

    #[test]
    fn text_element_cascade_updates_run_uniforms_without_rasterizing_a_full_frame() {
        let mut source = document("None", "none");
        source["timeline"] = json!({
            "tracks": [{"elements": [{
                "id": "cascade", "kind": "text", "start": 0.0, "end": 3.0,
                "text": "ONE TWO", "style": {
                    "fontFamily": "Montserrat", "fontSize": 32,
                    "background": false, "outline": false
                },
                "animate": {"enter": {"preset": "riseWords", "presetVersion": 1}}
            }]}]
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(
            std::path::Path::new("/nonexistent/baocut-r3-text-cascade"),
            &source,
        )
        .unwrap();

        let first_frame = plan.text_element_scene_frame(0.01).unwrap();
        let second_frame = plan.text_element_scene_frame(0.35).unwrap();
        assert_eq!(first_frame.next_change, Some(1.0 / 30.0));
        let [element_draw::SceneNode::Glyphs(first)] = first_frame.nodes.as_slice() else {
            panic!("纯文字级联必须只产出一条 glyph pass")
        };
        let [element_draw::SceneNode::Glyphs(second)] = second_frame.nodes.as_slice() else {
            panic!("级联后续帧仍必须只产出一条 glyph pass")
        };
        assert_eq!(first.glyphs[0].mask.key, second.glyphs[0].mask.key);
        assert_ne!(first.uniforms, second.uniforms);
    }

    #[test]
    fn classic_word_decorations_keep_cpu_chunk_order_in_the_scene() {
        let scene_for = |animation: &str, time: f64| {
            let mut source = document(animation, "none");
            source["style"]["background"] = json!(false);
            source["style"]["outline"] = json!(false);
            source["style"]["glow"] = json!({"on": false});
            OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None)
                .unwrap()
                .subtitle_scene_frame(time)
                .unwrap()
                .scene
        };

        let highlight = scene_for("Highlight", 1.5);
        assert!(matches!(
            highlight.nodes.as_slice(),
            [
                element_draw::SceneNode::Glyphs(_),
                element_draw::SceneNode::AnimatedVectors { .. },
                element_draw::SceneNode::Glyphs(_),
            ]
        ));
        let element_draw::SceneNode::AnimatedVectors { frame: plate, .. } = &highlight.nodes[1]
        else {
            unreachable!()
        };
        assert!(matches!(
            plate.ops.as_slice(),
            [DrawOp::FillRect {
                w,
                h,
                radius,
                color,
                ..
            }] if *w > 0.0 && *h > 0.0 && *radius > 0.0 && color[3] == 1.0
        ));

        let paint = scene_for("Paint", 1.0);
        assert!(matches!(
            paint.nodes.as_slice(),
            [
                element_draw::SceneNode::Glyphs(_),
                element_draw::SceneNode::AnimatedVectors { .. },
                element_draw::SceneNode::Glyphs(_),
            ]
        ));
        let element_draw::SceneNode::AnimatedVectors {
            frame: underline, ..
        } = &paint.nodes[1]
        else {
            unreachable!()
        };
        assert!(matches!(
            underline.ops.as_slice(),
            [DrawOp::FillRect { h, radius, .. }] if *h >= 1.0 && *radius > 0.0
        ));

        let custom = scene_for("Custom", 1.5);
        assert!(matches!(
            custom.nodes.as_slice(),
            [
                element_draw::SceneNode::Glyphs(_),
                element_draw::SceneNode::AnimatedVectors { .. },
                element_draw::SceneNode::Glyphs(_),
            ]
        ));
    }

    /// 「药丸高亮」的块在词的窗口里胀缩：两个时刻取帧，`w`/`h` 与块 alpha 都
    /// 必须不同。恒定矩形（今天所有其余经典效果）在这条断言下会立刻红。
    ///
    /// 相位取自**当前词自己的窗口**（`world` 是 1.3–2.5s）：`t=1.3` 落在
    /// `phase 0`（scale .9 / alpha .75），`t=2.14` 落在 `phase 0.7`
    /// （scale 1.1 / alpha 1）。
    #[test]
    fn legacy_pill_highlight_scene_breathes_across_the_word_window() {
        let scene_for = |time: f64| {
            let mut source = document("Highlight", "none");
            source["style"]["background"] = json!(false);
            source["style"]["outline"] = json!(false);
            source["style"]["glow"] = json!({"on": false});
            source["style"]["wordAnimation"] = json!({
                "animationName": "Highlight",
                "active": {
                    "backgroundColor": "#FFD43B",
                    "color": "#0D0D0D",
                    "borderRadiusEm": 1.0,
                    "boxScale": [[0.0, 0.9], [0.7, 1.1], [1.0, 1.0]],
                    "boxOpacity": [[0.0, 0.75], [0.7, 1.0], [1.0, 1.0]],
                    "boxEasing": "sinInOut",
                },
            });
            OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None)
                .unwrap()
                .subtitle_scene_frame(time)
                .unwrap()
                .scene
        };
        let plate_of = |scene: &element_draw::SceneFrame| {
            let element_draw::SceneNode::AnimatedVectors { frame, .. } = &scene.nodes[1] else {
                panic!("药丸底必须仍是 chunk 之间那一层 AnimatedVectors")
            };
            let [
                DrawOp::FillRect {
                    x,
                    y,
                    w,
                    h,
                    radius,
                    color,
                    ..
                },
            ] = frame.ops.as_slice()
            else {
                panic!("药丸底只落一笔 FillRect")
            };
            (*x, *y, *w, *h, *radius, color[3])
        };

        let (low_x, low_y, low_w, low_h, low_r, low_a) = plate_of(&scene_for(1.3));
        let (high_x, high_y, high_w, high_h, high_r, high_a) = plate_of(&scene_for(2.14));

        // 胀缩是真的：宽高圆角同倍变大，块 alpha 也不再是常数。
        assert!(high_w > low_w, "{low_w} → {high_w}");
        assert!(high_h > low_h, "{low_h} → {high_h}");
        assert!(high_r > low_r, "{low_r} → {high_r}");
        assert!(high_a > low_a, "{low_a} → {high_a}");
        // 块 alpha 与词 opacity 分开：Highlight 的词 opacity 恒为 1，块却是 .75。
        assert!((f64::from(low_a) - 0.75).abs() < 1e-3, "{low_a}");
        assert!((f64::from(high_a) - 1.0).abs() < 1e-3, "{high_a}");
        // 绕矩形中心缩放：两帧的中心必须重合（左上角对齐就会往右下漂）。
        assert!((f64::from(low_x + low_w / 2.0 - high_x - high_w / 2.0)).abs() < 1e-3);
        assert!((f64::from(low_y + low_h / 2.0 - high_y - high_h / 2.0)).abs() < 1e-3);
        // .9 → 1.1 的比例（宽高各自按同一倍数走）。
        assert!((f64::from(high_w / low_w) - 11.0 / 9.0).abs() < 1e-3);
        assert!((f64::from(high_h / low_h) - 11.0 / 9.0).abs() < 1e-3);
    }

    /// 曲线取值的精确对拍（原型 `designs/baocut/app/model-subanim.test.js:91-113`
    /// 的静帧基准 `SAMPLE_ON = 0.35`：`scale ≈ 1.0`、`alpha = 0.875`）。
    #[test]
    fn the_pill_highlight_track_samples_match_the_prototype_curve() {
        let animation = word_animation(&json!({"wordAnimation": {
            "animationName": "Highlight",
            "active": {
                "backgroundColor": "#FFD43B",
                "boxScale": [[0.0, 0.9], [0.7, 1.1], [1.0, 1.0]],
                "boxOpacity": [[0.0, 0.75], [0.7, 1.0], [1.0, 1.0]],
                "boxEasing": "sinInOut",
            },
        }}));
        let track = animation.box_track.clone().expect("药丸高亮必须解析出块轨");
        assert!(track.is_animated());
        for (phase, scale, alpha) in [
            (0.0, 0.9, 0.75),
            // sinInOut 在段中点对称，0.35 正好是 [0, 0.7] 的中点。
            (0.35, 1.0, 0.875),
            (0.7, 1.1, 1.0),
            (1.0, 1.0, 1.0),
        ] {
            let sampled_scale = track.scale_at(phase).unwrap();
            let sampled_alpha = track.opacity_at(phase).unwrap();
            assert!(
                (sampled_scale - scale).abs() < 1e-9,
                "phase {phase} scale {sampled_scale}"
            );
            assert!(
                (sampled_alpha - alpha).abs() < 1e-9,
                "phase {phase} alpha {sampled_alpha}"
            );
        }
        // 相位只对当前词生效，块也只画在当前词上。
        let on = word_state(&animation, 1, 1, 0.0);
        assert_eq!(on.box_scale, Some(0.9));
        assert_eq!(on.box_opacity, Some(0.75));
        let off = word_state(&animation, 0, 1, 0.0);
        assert_eq!(off.box_scale, None);
        assert_eq!(off.box_opacity, None);

        // 没有块轨的效果一字不变：`box_*` 恒为 `None`，块回到常量矩形。
        let plain = word_animation(&json!({"wordAnimation": {"animationName": "Highlight"}}));
        assert!(plain.box_track.is_none());
        assert_eq!(word_state(&plain, 1, 1, 0.35).box_scale, None);
        assert_eq!(word_state(&plain, 1, 1, 0.35).box_opacity, None);

        // 词内相位读的是那个词自己的窗口。
        let item = TimedItem {
            id: "q1".to_owned(),
            series_index: 0,
            text: "Hello world".to_owned(),
            display_start: 0.5,
            display_end: 2.5,
            words: vec![
                Word {
                    id: "w0".to_owned(),
                    text: "Hello".to_owned(),
                    start: 0.5,
                    end: 1.5,
                },
                Word {
                    id: "w1".to_owned(),
                    text: "world".to_owned(),
                    start: 1.5,
                    end: 2.5,
                },
            ],
        };
        assert!((word_phase(&item, 0, 0.85) - 0.35).abs() < 1e-9);
        assert!((word_phase(&item, 1, 1.85) - 0.35).abs() < 1e-9);
        // 越界与零长窗口都落 0，不是 NaN。
        assert_eq!(word_phase(&item, 0, 0.0), 0.0);
        assert_eq!(word_phase(&item, 9, 1.0), 0.0);
    }

    #[test]
    fn kinetic_slam_updates_retained_glyph_uniforms_on_the_project_fps_grid() {
        let mut source = designed_layout_document("caption-kinetic-slam");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();

        let first = plan.subtitle_scene_frame(0.51).unwrap();
        let second = plan.subtitle_scene_frame(0.55).unwrap();
        let [element_draw::SceneNode::Glyphs(first_run)] = first.scene.nodes.as_slice() else {
            panic!("kinetic slam 必须由单层 retained glyph scene 表达")
        };
        let [element_draw::SceneNode::Glyphs(second_run)] = second.scene.nodes.as_slice() else {
            panic!("同一可见词的后续采样仍必须是 glyph scene")
        };
        assert!(Arc::ptr_eq(&first_run.glyphs, &second_run.glyphs));
        assert_ne!(first_run.uniforms, second_run.uniforms);
        assert!(
            first_run
                .uniforms
                .iter()
                .any(|uniform| uniform.transform != element_draw::ScenePose::IDENTITY.transform)
        );
        let next = first
            .scene
            .next_change
            .expect("recipe 动画须报告下一 fps 样本");
        assert!(next > 0.51 && next <= 0.51 + 1.0 / 30.0 + 1e-9, "{next}");

        let next_word = plan.subtitle_scene_frame(1.31).unwrap();
        let [element_draw::SceneNode::Glyphs(next_word_run)] = next_word.scene.nodes.as_slice()
        else {
            panic!("下一可见词仍必须是 glyph scene")
        };
        assert!(
            !Arc::ptr_eq(&first_run.glyphs, &next_word_run.glyphs),
            "fullScreenWord 在同一 cue 内换词时必须换 geometry，不能复用上一词"
        );
    }

    #[test]
    fn clip_wipe_updates_only_the_retained_glyph_clip_uniform() {
        let mut source = designed_layout_document("caption-clip-wipe");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();

        let first = plan.subtitle_scene_frame(0.58).unwrap();
        let second = plan.subtitle_scene_frame(0.62).unwrap();
        let [element_draw::SceneNode::Glyphs(first_run)] = first.scene.nodes.as_slice() else {
            panic!("clip wipe 必须由单层 retained glyph scene 表达")
        };
        let [element_draw::SceneNode::Glyphs(second_run)] = second.scene.nodes.as_slice() else {
            panic!("clip wipe 后续采样仍必须是 glyph scene")
        };
        assert!(Arc::ptr_eq(&first_run.glyphs, &second_run.glyphs));
        let first_clips = first_run
            .uniforms
            .iter()
            .map(|uniform| uniform.clip)
            .collect::<Vec<_>>();
        let second_clips = second_run
            .uniforms
            .iter()
            .map(|uniform| uniform.clip)
            .collect::<Vec<_>>();
        assert!(first_clips.iter().any(Option::is_some));
        assert_ne!(first_clips, second_clips);
        assert_ne!(first_run.uniforms, second_run.uniforms);
        let next = first
            .scene
            .next_change
            .expect("clip recipe 须报告下一 fps 样本");
        assert!(next > 0.58 && next <= 0.58 + 1.0 / 30.0 + 1e-9, "{next}");
    }

    #[test]
    fn gradient_fill_updates_only_the_retained_glyph_paint_uniform() {
        let mut source = designed_layout_document("caption-gradient-fill");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();

        let first = plan.subtitle_scene_frame(0.58).unwrap();
        let second = plan.subtitle_scene_frame(0.62).unwrap();
        let [element_draw::SceneNode::Glyphs(first_run)] = first.scene.nodes.as_slice() else {
            panic!("gradient fill 必须由单层 retained glyph scene 表达")
        };
        let [element_draw::SceneNode::Glyphs(second_run)] = second.scene.nodes.as_slice() else {
            panic!("gradient fill 后续采样仍必须是 glyph scene")
        };
        assert!(Arc::ptr_eq(&first_run.glyphs, &second_run.glyphs));
        assert!(first_run.uniforms.iter().any(|uniform| matches!(
            uniform.paint,
            element_draw::GlyphPaint::RepeatLinearGradient { .. }
        )));
        let first_paints = first_run
            .uniforms
            .iter()
            .map(|uniform| uniform.paint)
            .collect::<Vec<_>>();
        let second_paints = second_run
            .uniforms
            .iter()
            .map(|uniform| uniform.paint)
            .collect::<Vec<_>>();
        assert_ne!(first_paints, second_paints);
        assert_ne!(first_run.uniforms, second_run.uniforms);
        let next = first
            .scene
            .next_change
            .expect("gradient recipe 须报告下一 fps 样本");
        assert!(next > 0.58 && next <= 0.58 + 1.0 / 30.0 + 1e-9, "{next}");
    }

    #[test]
    fn designed_caption_plates_update_procedural_uniforms_without_vector_geometry() {
        for style_id in ["caption-highlight", "caption-pill-karaoke"] {
            let (first_time, second_time) = if style_id == "caption-pill-karaoke" {
                (1.35, 1.39)
            } else {
                (0.58, 0.62)
            };
            let mut source = designed_layout_document(style_id);
            source["style"]["background"] = json!(false);
            source["style"]["outline"] = json!(false);
            source["style"]["underline"] = json!(false);
            source["style"]["glow"] = json!({"on": false});
            source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
            let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();

            let first = plan.subtitle_scene_frame(first_time).unwrap();
            let second = plan.subtitle_scene_frame(second_time).unwrap();
            let first_plate = first
                .scene
                .nodes
                .iter()
                .find_map(|node| match node {
                    element_draw::SceneNode::RoundedRect(node) => Some(node),
                    _ => None,
                })
                .unwrap_or_else(|| panic!("{style_id} 必须产生程序化圆角底板"));
            let second_plate = second
                .scene
                .nodes
                .iter()
                .find_map(|node| match node {
                    element_draw::SceneNode::RoundedRect(node) => Some(node),
                    _ => None,
                })
                .unwrap_or_else(|| panic!("{style_id} 后续采样仍必须保留圆角底板"));
            assert_ne!(first_plate.rect, second_plate.rect, "{style_id}");
            assert!(first_plate.rect[2] > 0.0 && first_plate.rect[3] > 0.0);
            assert!(first_plate.radius > 0.0 && first_plate.color[3] > 0.0);
            assert!(first.scene.nodes.iter().all(|node| !matches!(
                node,
                element_draw::SceneNode::Vectors(_)
                    | element_draw::SceneNode::AnimatedVectors { .. }
            )));

            let first_run = first
                .scene
                .nodes
                .iter()
                .find_map(|node| match node {
                    element_draw::SceneNode::Glyphs(run) => Some(run),
                    _ => None,
                })
                .expect("plate 后必须保留 glyph run");
            let second_run = second
                .scene
                .nodes
                .iter()
                .find_map(|node| match node {
                    element_draw::SceneNode::Glyphs(run) => Some(run),
                    _ => None,
                })
                .expect("plate 后续帧必须保留 glyph run");
            assert!(
                Arc::ptr_eq(&first_run.glyphs, &second_run.glyphs),
                "{style_id} 的底板动画不得重建 glyph geometry"
            );
            let next = first
                .scene
                .next_change
                .expect("plate recipe 须报告下一 fps 样本");
            assert!(
                next > first_time && next <= first_time + 1.0 / 30.0 + 1e-9,
                "{next}"
            );
        }
    }

    #[test]
    fn designed_caption_duplicate_layers_reuse_glyph_geometry_and_only_update_uniforms() {
        let mut source = designed_layout_document("caption-parallax-layers");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        source["style"]["captionEmphasis"] = json!({
            "w1": {"anchorText": "Hello", "role": "hero"}
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();

        let first = plan.subtitle_scene_frame(0.8).unwrap();
        let second = plan.subtitle_scene_frame(1.32).unwrap();
        fn glyph_runs(frame: &SubtitleSceneFrame) -> Vec<&Arc<element_draw::GlyphRun>> {
            frame
                .scene
                .nodes
                .iter()
                .filter_map(|node| match node {
                    element_draw::SceneNode::Glyphs(run) => Some(run),
                    _ => None,
                })
                .collect::<Vec<_>>()
        }
        let first_runs = glyph_runs(&first);
        let second_runs = glyph_runs(&second);
        assert_eq!(first_runs.len(), 6, "两词应各有两层 duplicate + 一层正文");
        assert_eq!(second_runs.len(), first_runs.len());
        let active_duplicate = first_runs
            .chunks_exact(3)
            .find(|word| word[0].uniforms[0].color[3] > 0.0)
            .expect("hero 词必须产生可见 duplicate");
        assert_ne!(
            active_duplicate[0].uniforms[0],
            active_duplicate[1].uniforms[0]
        );
        for word in first_runs.chunks_exact(3) {
            assert!(Arc::ptr_eq(&word[0].glyphs, &word[1].glyphs));
            assert!(Arc::ptr_eq(&word[1].glyphs, &word[2].glyphs));
        }
        for (first, second) in first_runs.iter().zip(&second_runs) {
            assert!(Arc::ptr_eq(&first.glyphs, &second.glyphs));
        }
        assert!(
            first_runs
                .iter()
                .zip(&second_runs)
                .any(|(first, second)| first.uniforms != second.uniforms),
            "attack 区间只能改变 duplicate/main uniforms"
        );
        assert!(first.scene.nodes.iter().all(|node| !matches!(
            node,
            element_draw::SceneNode::Vectors(_)
                | element_draw::SceneNode::AnimatedVectors { .. }
                | element_draw::SceneNode::RoundedRect(_)
        )));
        let next = first
            .scene
            .next_change
            .expect("duplicate recipe 须报告下一 fps 样本");
        assert!(next > 0.8 && next <= 0.8 + 1.0 / 30.0 + 1e-9, "{next}");
    }

    #[test]
    fn editorial_color_mix_uses_one_retained_fill_without_a_transparent_duplicate() {
        let mut source = designed_layout_document("caption-editorial-emphasis");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        source["style"]["captionEmphasis"] = json!({
            "w1": {"anchorText": "Hello", "role": "hero"}
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        assert_eq!(
            caption_recipe_glyph_duplicate_layer_count(&plan.original_animation),
            1,
            "descriptor 的视觉分层声明必须保留"
        );
        assert_eq!(
            caption_recipe_echo_duplicate_layer_count(&plan.original_animation),
            0,
            "只有 colorMix 的 editorial 配方不能产生透明 echo pass"
        );

        let first = plan.subtitle_scene_frame(0.58).unwrap();
        let second = plan.subtitle_scene_frame(0.62).unwrap();
        fn runs(frame: &SubtitleSceneFrame) -> Vec<&Arc<element_draw::GlyphRun>> {
            frame
                .scene
                .nodes
                .iter()
                .filter_map(|node| match node {
                    element_draw::SceneNode::Glyphs(run) => Some(run),
                    _ => None,
                })
                .collect::<Vec<_>>()
        }
        let first_runs = runs(&first);
        let second_runs = runs(&second);
        assert_eq!(first_runs.len(), 1, "editorial 只应提交一条正文 glyph run");
        assert_eq!(second_runs.len(), 1);
        assert_eq!(first_runs[0].uniforms.len(), 2);
        assert!(
            first_runs[0]
                .uniforms
                .iter()
                .any(|uniform| uniform.color[2] < 0.5),
            "hero 词的 colorMix 必须进入正文颜色 uniform"
        );
        assert!(Arc::ptr_eq(&first_runs[0].glyphs, &second_runs[0].glyphs));
        assert_ne!(first_runs[0].uniforms, second_runs[0].uniforms);
        assert!(first.scene.nodes.iter().all(|node| !matches!(
            node,
            element_draw::SceneNode::Vectors(_)
                | element_draw::SceneNode::AnimatedVectors { .. }
                | element_draw::SceneNode::RoundedRect(_)
        )));
        let next = first
            .scene
            .next_change
            .expect("editorial enter 须报告下一 fps 样本");
        assert!(next > 0.58 && next <= 0.58 + 1.0 / 30.0 + 1e-9, "{next}");
    }

    #[test]
    fn emoji_pop_keeps_word_local_decoration_geometry_and_only_updates_uniforms() {
        let mut source = designed_layout_document("caption-emoji-pop");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        source["style"]["captionEmphasis"] = json!({
            "w1": {"anchorText": "Hello", "role": "hero"}
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        let first = plan.subtitle_scene_frame(0.58).unwrap();
        let second = plan.subtitle_scene_frame(0.62).unwrap();
        fn runs(frame: &SubtitleSceneFrame) -> Vec<&Arc<element_draw::GlyphRun>> {
            frame
                .scene
                .nodes
                .iter()
                .filter_map(|node| match node {
                    element_draw::SceneNode::Glyphs(run) => Some(run),
                    _ => None,
                })
                .collect::<Vec<_>>()
        }
        let first_runs = runs(&first);
        let second_runs = runs(&second);
        assert_eq!(
            first_runs.len(),
            4,
            "两词须保持 emoji→正文 的逐词层序，未活动词也保留透明 emoji run"
        );
        assert_eq!(second_runs.len(), first_runs.len());
        assert!(first_runs[0].uniforms[0].color_opacity > 0.0);
        assert_eq!(first_runs[2].uniforms[0].color_opacity, 0.0);
        for (first, second) in first_runs.iter().zip(second_runs.iter()) {
            assert!(Arc::ptr_eq(&first.glyphs, &second.glyphs));
        }
        assert_ne!(first_runs[1].uniforms, second_runs[1].uniforms);
        assert!(
            first
                .scene
                .nodes
                .iter()
                .all(|node| matches!(node, element_draw::SceneNode::Glyphs(_)))
        );
        let next = first
            .scene
            .next_change
            .expect("emoji pop 须报告下一 fps 样本");
        assert!(next > 0.58 && next <= 0.58 + 1.0 / 30.0 + 1e-9, "{next}");
    }

    #[test]
    fn a_user_emoji_override_joins_other_supported_recipes_without_a_style_id_gate() {
        let mut source = designed_layout_document("caption-editorial-emphasis");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        source["style"]["captionEmphasis"] = json!({
            "w1": {"anchorText": "Hello", "role": "hero", "emoji": "B"}
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        let frame = plan.subtitle_scene_frame(0.8).unwrap();
        let runs = frame
            .scene
            .nodes
            .iter()
            .filter_map(|node| match node {
                element_draw::SceneNode::Glyphs(run) => Some(run),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            runs.len(),
            3,
            "editorial 两行正文须在用户 emoji 的逐词槽位前后切段"
        );
        assert!(runs.iter().all(|run| !run.glyphs.is_empty()));
        assert!(
            runs[1].uniforms[0].color_opacity > 0.0,
            "用户 emoji 覆盖必须在无 emojiPop channel 的已支持配方中真正可见"
        );
    }

    #[test]
    fn matrix_decode_switches_retained_glyph_geometry_without_a_full_frame_raster() {
        let mut source = designed_layout_document("caption-matrix-decode");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        assert_eq!(plan.subtitle_scene_static_fallback(), None);

        let samples = [0.52, 0.62, 0.72, 0.82, 0.92, 1.02];
        let mut sampled = Vec::new();
        for time in samples {
            let frame = plan.subtitle_scene_frame(time).unwrap();
            let [element_draw::SceneNode::Glyphs(run)] = frame.scene.nodes.as_slice() else {
                panic!("matrix decode 必须只提交局部 glyph geometry，不能生成整幅位图")
            };
            sampled.push((time, Arc::clone(&run.glyphs), frame.scene.next_change));
        }
        let (changed_time, changed_geometry, next_change) = sampled
            .iter()
            .skip(1)
            .find(|(_, geometry, _)| !Arc::ptr_eq(&sampled[0].1, geometry))
            .cloned()
            .expect("scramble phase 变化必须切换替字 glyph geometry");
        assert!(
            next_change.is_some_and(|next| {
                next > changed_time && next <= changed_time + 1.0 / 30.0 + 1e-9
            }),
            "替字动画必须继续在项目 fps 网格报告下一采样点: {next_change:?}"
        );

        let same_phase_time = changed_time + 0.001;
        let repeated = plan.subtitle_scene_frame(same_phase_time).unwrap();
        let [element_draw::SceneNode::Glyphs(repeated)] = repeated.scene.nodes.as_slice() else {
            unreachable!()
        };
        assert!(
            Arc::ptr_eq(&changed_geometry, &repeated.glyphs),
            "不同采样时刻落在相同 scramble phase 时必须命中有界 Arc geometry cache"
        );
    }

    #[test]
    fn glitch_rgb_keeps_scanlines_and_rgb_duplicates_in_one_retained_screen_scene() {
        let mut source = designed_layout_document("caption-glitch-rgb");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        assert_eq!(plan.subtitle_scene_static_fallback(), None);

        let first = plan.subtitle_scene_frame(0.80).unwrap();
        let second = plan.subtitle_scene_frame(0.84).unwrap();
        fn parts(
            nodes: &[element_draw::SceneNode],
        ) -> (
            Vec<&Arc<element_draw::RoundedRectNode>>,
            Vec<&Arc<element_draw::GlyphRun>>,
        ) {
            let rects = nodes
                .iter()
                .filter_map(|node| match node {
                    element_draw::SceneNode::RoundedRect(rect) => Some(rect),
                    _ => None,
                })
                .collect();
            let runs = nodes
                .iter()
                .filter_map(|node| match node {
                    element_draw::SceneNode::Glyphs(run) => Some(run),
                    _ => None,
                })
                .collect();
            (rects, runs)
        }
        let [element_draw::SceneNode::BlurredGroup(first_group)] = first.scene.nodes.as_slice()
        else {
            panic!("glitch 必须先合成透明层，再整体 Screen")
        };
        let [element_draw::SceneNode::BlurredGroup(second_group)] = second.scene.nodes.as_slice()
        else {
            panic!("glitch 后续帧仍须保持 Screen group")
        };
        assert_eq!(
            first_group.composite,
            element_draw::SceneCompositeMode::Screen
        );
        assert_eq!(
            second_group.composite,
            element_draw::SceneCompositeMode::Screen
        );
        let (first_rects, first_runs) = parts(&first_group.nodes);
        let (second_rects, second_runs) = parts(&second_group.nodes);
        assert!(!first_rects.is_empty(), "scanline 必须由程序化 rect 表达");
        assert_eq!(first_rects.len(), second_rects.len());
        assert_eq!(first_runs.len(), 6, "两词各保留 red/cyan/main 三条 run");
        assert_eq!(first_runs.len(), second_runs.len());
        assert!(first_rects.iter().all(|rect| rect.radius == 0.0));
        assert!(first_runs.iter().all(|run| {
            run.composite == element_draw::SceneCompositeMode::Normal && !run.glyphs.is_empty()
        }));
        assert!(
            first_runs
                .iter()
                .flat_map(|run| &run.uniforms)
                .any(|uniform| {
                    uniform.color[0] > 0.9 && uniform.color[1] < 0.4 && uniform.color[3] > 0.0
                })
        );
        assert!(
            first_runs
                .iter()
                .flat_map(|run| &run.uniforms)
                .any(|uniform| {
                    uniform.color[2] > 0.9 && uniform.color[1] > 0.7 && uniform.color[3] > 0.0
                })
        );
        for (first, second) in first_runs.iter().zip(second_runs) {
            assert!(Arc::ptr_eq(&first.glyphs, &second.glyphs));
        }
        assert!(first_group.nodes.iter().all(|node| !matches!(
            node,
            element_draw::SceneNode::Vectors(_) | element_draw::SceneNode::AnimatedVectors { .. }
        )));
        let next = first.scene.next_change.expect("glitch 须报告下一 fps 样本");
        assert!(next > 0.80 && next <= 0.80 + 1.0 / 30.0 + 1e-9, "{next}");
    }

    #[test]
    fn particle_burst_keeps_fixed_transparent_slots_and_retained_glyph_geometry() {
        let mut source = designed_layout_document("caption-particle-burst");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        source["style"]["captionEmphasis"] = json!({
            "w1": {"anchorText": "Hello", "role": "hero"}
        });
        source["style"]["wordAnimation"]["caption"]["options"] =
            json!([{"kind": "number", "key": "particleCount", "number": 12}]);
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        assert_eq!(plan.subtitle_scene_static_fallback(), None);

        let transparent = plan.subtitle_scene_frame(0.50).unwrap();
        let first = plan.subtitle_scene_frame(0.70).unwrap();
        let second = plan.subtitle_scene_frame(0.76).unwrap();
        fn rects(nodes: &[element_draw::SceneNode]) -> Vec<&Arc<element_draw::RoundedRectNode>> {
            nodes
                .iter()
                .filter_map(|node| match node {
                    element_draw::SceneNode::RoundedRect(rect) => Some(rect),
                    _ => None,
                })
                .collect()
        }
        fn runs(nodes: &[element_draw::SceneNode]) -> Vec<&Arc<element_draw::GlyphRun>> {
            nodes
                .iter()
                .filter_map(|node| match node {
                    element_draw::SceneNode::Glyphs(run) => Some(run),
                    _ => None,
                })
                .collect()
        }
        let [element_draw::SceneNode::BlurredGroup(transparent_group)] =
            transparent.scene.nodes.as_slice()
        else {
            panic!("particle 透明首帧也必须保留 Screen group")
        };
        let transparent_rects = rects(&transparent_group.nodes);
        assert_eq!(transparent_rects.len(), 12);
        assert!(
            transparent_rects.iter().all(|rect| rect.color[3] == 0.0),
            "burst 尚未开始时固定粒子槽必须只置透明"
        );
        let [element_draw::SceneNode::BlurredGroup(first_group)] = first.scene.nodes.as_slice()
        else {
            panic!("particle 必须先合成透明层，再整体 Screen")
        };
        let [element_draw::SceneNode::BlurredGroup(second_group)] = second.scene.nodes.as_slice()
        else {
            panic!("particle 后续帧仍须保持 Screen group")
        };
        assert_eq!(
            first_group.composite,
            element_draw::SceneCompositeMode::Screen
        );
        assert_eq!(
            second_group.composite,
            element_draw::SceneCompositeMode::Screen
        );
        let first_rects = rects(&first_group.nodes);
        let second_rects = rects(&second_group.nodes);
        assert_eq!(first_rects.len(), 12, "只为 hero 词保留固定粒子槽");
        assert_eq!(second_rects.len(), first_rects.len());
        assert!(
            first_rects.iter().all(|rect| {
                rect.radius > 0.0 && (rect.rect[2] - rect.radius * 2.0).abs() < 1e-4
            })
        );
        assert!(
            first_rects
                .iter()
                .zip(&second_rects)
                .any(|(first, second)| {
                    first.rect != second.rect || first.color != second.color
                })
        );
        let first_runs = runs(&first_group.nodes);
        let second_runs = runs(&second_group.nodes);
        assert_eq!(first_runs.len(), second_runs.len());
        for (first, second) in first_runs.iter().zip(second_runs) {
            assert_eq!(first.composite, element_draw::SceneCompositeMode::Normal);
            assert!(Arc::ptr_eq(&first.glyphs, &second.glyphs));
        }
        assert!(first_group.nodes.iter().all(|node| !matches!(
            node,
            element_draw::SceneNode::Vectors(_) | element_draw::SceneNode::AnimatedVectors { .. }
        )));
        let next = first
            .scene
            .next_change
            .expect("particle 须报告下一 fps 样本");
        assert!(next > 0.70 && next <= 0.70 + 1.0 / 30.0 + 1e-9, "{next}");
    }

    #[test]
    fn neon_and_weight_recipes_keep_fixed_stroke_runs_and_only_update_uniforms() {
        fn stroke_runs(nodes: &[element_draw::SceneNode]) -> Vec<&Arc<element_draw::GlyphRun>> {
            nodes
                .iter()
                .filter_map(|node| match node {
                    element_draw::SceneNode::Glyphs(run)
                        if run.uniforms.iter().any(|uniform| {
                            matches!(
                                uniform.paint,
                                element_draw::GlyphPaint::DilatedStroke { .. }
                            )
                        }) =>
                    {
                        Some(run)
                    }
                    _ => None,
                })
                .collect()
        }

        fn children<'a>(
            scene: &'a element_draw::SceneFrame,
            expected_composite: element_draw::SceneCompositeMode,
            style_id: &str,
        ) -> &'a [element_draw::SceneNode] {
            if expected_composite == element_draw::SceneCompositeMode::Screen {
                let [element_draw::SceneNode::BlurredGroup(group)] = scene.nodes.as_slice() else {
                    panic!("{style_id} must use one Screen group")
                };
                assert_eq!(group.composite, expected_composite, "{style_id}");
                &group.nodes
            } else {
                &scene.nodes
            }
        }

        for (style_id, expected_layers, expected_composite) in [
            (
                "caption-neon-accent",
                6,
                element_draw::SceneCompositeMode::Screen,
            ),
            (
                "caption-neon-glow",
                6,
                element_draw::SceneCompositeMode::Screen,
            ),
            (
                "caption-weight-shift",
                2,
                element_draw::SceneCompositeMode::Normal,
            ),
        ] {
            let mut source = designed_layout_document(style_id);
            source["style"]["background"] = json!(false);
            source["style"]["outline"] = json!(false);
            source["style"]["underline"] = json!(false);
            source["style"]["glow"] = json!({"on": false});
            source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
            let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None)
                .unwrap_or_else(|error| panic!("compile {style_id}: {error}"));
            assert_eq!(plan.subtitle_scene_static_fallback(), None, "{style_id}");

            let transparent = plan.subtitle_scene_frame(0.50).unwrap();
            let first = plan.subtitle_scene_frame(0.54).unwrap();
            let second = plan.subtitle_scene_frame(0.58).unwrap();
            let transparent_runs =
                stroke_runs(children(&transparent.scene, expected_composite, style_id));
            let first_runs = stroke_runs(children(&first.scene, expected_composite, style_id));
            let second_runs = stroke_runs(children(&second.scene, expected_composite, style_id));
            assert_eq!(transparent_runs.len(), expected_layers, "{style_id}");
            assert_eq!(first_runs.len(), expected_layers, "{style_id}");
            assert_eq!(second_runs.len(), expected_layers, "{style_id}");
            assert!(transparent_runs.iter().all(|run| {
                run.uniforms.iter().all(|uniform| {
                    uniform.color[3] == 0.0
                        && matches!(
                            uniform.paint,
                            element_draw::GlyphPaint::DilatedStroke { width } if width == 0.0
                        )
                })
            }));
            assert!(first_runs.iter().any(|run| {
                run.uniforms.iter().any(|uniform| {
                    uniform.color[3] > 0.0
                        && matches!(
                            uniform.paint,
                            element_draw::GlyphPaint::DilatedStroke { width } if width > 0.0
                        )
                })
            }));
            for (first, second) in first_runs.iter().zip(&second_runs) {
                assert!(Arc::ptr_eq(&first.glyphs, &second.glyphs), "{style_id}");
            }
            assert!(
                first_runs
                    .iter()
                    .zip(second_runs)
                    .any(|(first, second)| first.uniforms != second.uniforms),
                "{style_id} must update stroke uniforms on the fps grid"
            );
        }
    }

    #[test]
    fn target_sampling_caption_still_requests_an_explicit_scene_fallback() {
        let mut source = designed_layout_document("caption-blend-difference");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        assert_eq!(
            plan.subtitle_scene_frame(1.0).unwrap_err(),
            SubtitleSceneFallback::CompositeMode,
            "需要读取真实 backdrop 的 composite 不能绕过能力门"
        );
        assert_eq!(plan.subtitle_scene_static_fallback_with_backdrop(), None);
        let target_scene = plan.subtitle_scene_frame_with_backdrop(1.0).unwrap();
        let [element_draw::SceneNode::BlurredGroup(group)] = target_scene.scene.nodes.as_slice()
        else {
            panic!("backdrop-aware 字幕 scene 应把 target composite 保留在顶层 group")
        };
        assert_eq!(
            group.composite,
            element_draw::SceneCompositeMode::Difference
        );
        plan.compositor_scene_support().unwrap();
        let scene = plan.compositor_scene_frame(1.0).unwrap();
        let [element_draw::SceneNode::BlurredGroup(group)] = scene.nodes.as_slice() else {
            panic!("离线 scene 应把 target-sampling 字幕收成顶层 group")
        };
        assert_eq!(
            group.composite,
            element_draw::SceneCompositeMode::Difference
        );
        assert!(group.nodes.iter().all(|node| match node {
            element_draw::SceneNode::Glyphs(run) => {
                run.composite == element_draw::SceneCompositeMode::Normal
            }
            _ => true,
        }));
    }

    #[test]
    fn texture_fill_keeps_one_content_addressed_resource_and_retained_geometry() {
        let mut source = designed_layout_document("caption-texture");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        source["style"]["wordAnimation"]["caption"]["options"] =
            json!([{"kind": "text", "key": "texture", "text": "wood"}]);
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();

        let first = plan.subtitle_scene_frame(0.58).unwrap();
        let second = plan.subtitle_scene_frame(0.62).unwrap();
        let [element_draw::SceneNode::Glyphs(first_run)] = first.scene.nodes.as_slice() else {
            panic!("texture fill 必须由单层 retained glyph scene 表达")
        };
        let [element_draw::SceneNode::Glyphs(second_run)] = second.scene.nodes.as_slice() else {
            panic!("texture fill 后续采样仍必须是 glyph scene")
        };
        assert!(Arc::ptr_eq(&first_run.glyphs, &second_run.glyphs));
        assert!(
            first_run
                .uniforms
                .iter()
                .all(|uniform| { uniform.paint == element_draw::GlyphPaint::RepeatTexture })
        );
        let first_texture = first_run.texture.as_ref().expect("wood texture resource");
        let second_texture = second_run
            .texture
            .as_ref()
            .expect("retained texture resource");
        assert!(Arc::ptr_eq(first_texture, second_texture));
        assert_eq!((first_texture.width, first_texture.height), (181, 181));
        assert_eq!(
            first_texture.rgba.len(),
            first_texture.width as usize * first_texture.height as usize * 4
        );
        assert_ne!(first_run.uniforms, second_run.uniforms);
        let next = first
            .scene
            .next_change
            .expect("texture recipe 须报告下一 fps 样本");
        assert!(next > 0.58 && next <= 0.58 + 1.0 / 30.0 + 1e-9, "{next}");
    }

    #[test]
    fn screen_caption_keeps_retained_geometry_without_weakening_target_sampling_fallbacks() {
        let mut source = designed_layout_document("caption-blend-difference");
        source["style"]["background"] = json!(false);
        source["style"]["outline"] = json!(false);
        source["style"]["underline"] = json!(false);
        source["style"]["glow"] = json!({"on": false});
        source["style"]["transition"] = json!({"transitionId": "none", "transitionSpeed": 50});
        source["style"]["wordAnimation"]["caption"]["options"] =
            json!([{"kind": "text", "key": "composite", "text": "screen"}]);

        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        let first = plan.subtitle_scene_frame(0.58).unwrap();
        let later = plan.subtitle_scene_frame(0.62).unwrap();
        let [element_draw::SceneNode::BlurredGroup(first_group)] = first.scene.nodes.as_slice()
        else {
            panic!("Screen 字幕必须使用组级 composite")
        };
        let [element_draw::SceneNode::BlurredGroup(later_group)] = later.scene.nodes.as_slice()
        else {
            panic!("Screen 字幕后续帧必须保持组级 composite")
        };
        assert_eq!(
            first_group.composite,
            element_draw::SceneCompositeMode::Screen
        );
        assert_eq!(
            later_group.composite,
            element_draw::SceneCompositeMode::Screen
        );
        let first_runs = first_group
            .nodes
            .iter()
            .filter_map(|node| match node {
                element_draw::SceneNode::Glyphs(run) => Some(run),
                _ => None,
            })
            .collect::<Vec<_>>();
        let later_runs = later_group
            .nodes
            .iter()
            .filter_map(|node| match node {
                element_draw::SceneNode::Glyphs(run) => Some(run),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(!first_runs.is_empty());
        assert_eq!(first_runs.len(), later_runs.len());
        for (first, later) in first_runs.iter().zip(later_runs) {
            assert_eq!(first.composite, element_draw::GlyphCompositeMode::Normal);
            assert_eq!(later.composite, element_draw::GlyphCompositeMode::Normal);
            assert!(std::sync::Arc::ptr_eq(&first.glyphs, &later.glyphs));
        }

        source["style"]["background"] = json!(true);
        let mut with_vector_plate =
            OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        assert_eq!(
            with_vector_plate.subtitle_scene_frame(0.58).unwrap_err(),
            SubtitleSceneFallback::CompositeMode,
            "Screen 只在整张字幕层均可由 retained scene 精确表达时准入"
        );
        source["style"]["background"] = json!(false);

        source["style"]["wordAnimation"]["caption"]["options"] =
            json!([{"kind": "text", "key": "composite", "text": "exclusion"}]);
        let mut exclusion = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        assert_eq!(
            exclusion.subtitle_scene_frame(0.58).unwrap_err(),
            SubtitleSceneFallback::CompositeMode,
            "exclusion 仍需采样真实 target，不能伪装成固定混合"
        );
    }

    /// R2/R4 还没有交付给 compositor 的 host 光栅元素必须显式触发
    /// CPU fallback，不能只在 GPU 场景里悄悄消失。
    #[test]
    fn the_element_scene_rejects_host_rasterized_elements() {
        let mut source = document("none", "none");
        source["timeline"] = json!({
            "tracks": [{"elements": [{
                "id": "host-text", "kind": "text", "start": 0.0, "end": 3.0,
                "text": "still CPU"
            }]}]
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(
            std::path::Path::new("/nonexistent/baocut-r1-scene-fallback"),
            &source,
        )
        .unwrap();

        let error = plan.element_scene_frame(1.0).unwrap_err().to_string();
        assert!(error.contains("compositor-scene-unsupported"), "{error}");
        assert!(error.contains("host-text"), "{error}");
    }

    /// 素材贴纸的 `sticker.fillOverrides` 必须换到**画面**上。
    ///
    /// 光栅缓存按 source id 键，换色是元素级的：不另起变体的话，属性页把橙色
    /// 点成绿色、工具条色块也变绿，舞台却仍是橙色（用户 2026-09-08 回报）。
    /// 这里同源两个贴纸各带一张覆盖表，画面上必须出现两种颜色。
    #[test]
    fn an_asset_stickers_fill_override_reaches_the_pixels() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("media/elements")).unwrap();
        std::fs::write(
            project.path().join("media/elements/face.svg"),
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#FF7944"/></svg>"##,
        )
        .unwrap();
        let timeline = json!({
            "bcutTimeline": "0.2",
            "sources": {"face": {
                "path": "media/elements/face.svg", "kind": "image",
                "naturalW": 40, "naturalH": 40
            }},
            "tracks": [{"id": "overlay", "kind": "overlay", "elements": [
                {
                    "id": "plain", "kind": "sticker", "start": 0.0, "end": 3.0,
                    "srcId": "face", "place": {"x": 25, "y": 50, "w": 20},
                    "sticker": {"source": "asset", "path": "media/elements/face.svg"}
                },
                {
                    "id": "green", "kind": "sticker", "start": 0.0, "end": 3.0,
                    "srcId": "face", "place": {"x": 75, "y": 50, "w": 20},
                    "sticker": {
                        "source": "asset", "path": "media/elements/face.svg",
                        "fillOverrides": {"#FF7944": "#00C853"}
                    }
                }
            ]}]
        });
        std::fs::write(
            project.path().join("timeline.json"),
            serde_json::to_vec(&timeline).unwrap(),
        )
        .unwrap();
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline;
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();
        let rgba = plan.render_rgba(1.0).unwrap();
        let sample = |x: usize, y: usize| {
            let at = (y * 320 + x) * 4;
            (rgba[at], rgba[at + 1], rgba[at + 2])
        };
        // 两个贴纸各占画幅 20% 宽，中心在 25% / 75% 处。
        let (left_r, left_g, _) = sample(80, 90);
        let (right_r, right_g, _) = sample(240, 90);
        assert!(
            left_r > left_g,
            "没带覆盖表的贴纸必须保持原色（偏橙），实测 {left_r},{left_g}"
        );
        assert!(
            right_g > right_r,
            "带 fillOverrides 的贴纸必须换成绿色，实测 {right_r},{right_g}"
        );

        // GPU 合成路径走的是另一处取帧（`compositor_media_nodes`），必须拿到
        // 同一张换色图，否则预览与导出会在换色上分家。
        plan.compositor_scene_support().unwrap();
        plan.compositor_scene_frame(1.0).unwrap();
        let texture = plan
            .compositor_texture_frame("timeline-media:green", -1)
            .unwrap();
        let center = texture
            .pixel(texture.width() / 2, texture.height() / 2)
            .unwrap();
        assert!(
            center.green() > center.red(),
            "GPU 纹理也必须是换色后的绿，实测 {},{}",
            center.red(),
            center.green()
        );
    }

    /// Timeline 0.7：`sources[].kind: "lottie"` 由素材贴纸引用，按 `sticker.loop`
    /// 逐帧采样；`fillOverrides` 换的是 bodymovin 的纯色填充。CPU overlay 与 GPU
    /// 合成两条取帧路径必须拿到同一张图。
    #[test]
    fn a_lottie_source_renders_as_an_asset_sticker_with_fill_overrides() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("media/elements")).unwrap();
        std::fs::copy(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../render-raster/tests/fixtures/lottie/samples/shapes-only.json"
            ),
            project.path().join("media/elements/circle.json"),
        )
        .unwrap();
        let timeline = json!({
            "bcutTimeline": "0.7",
            "sources": {"circle": {
                "path": "media/elements/circle.json", "kind": "lottie",
                "naturalW": 200, "naturalH": 200, "duration": 2.0, "hasAudio": false
            }},
            "tracks": [{"id": "overlay", "kind": "overlay", "elements": [
                {
                    "id": "plain", "kind": "sticker", "start": 0.0, "end": 6.0,
                    "srcId": "circle", "place": {"x": 25, "y": 50, "w": 40},
                    "sticker": {"source": "asset", "path": "media/elements/circle.json", "loop": "loop"}
                },
                {
                    "id": "green", "kind": "sticker", "start": 0.0, "end": 6.0,
                    "srcId": "circle", "place": {"x": 75, "y": 50, "w": 40},
                    "sticker": {
                        "source": "asset", "path": "media/elements/circle.json",
                        "fillOverrides": {"#2170E6": "#00C853"}
                    }
                }
            ]}]
        });
        std::fs::write(
            project.path().join("timeline.json"),
            serde_json::to_vec(&timeline).unwrap(),
        )
        .unwrap();
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline;
        let mut plan = OverlayRenderPlan::compile(&source, 320, 320, 6.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();
        // 贴纸时长 2 s、元素占位 6 s：3.5 s 处已经绕回第二圈，loop 语义下仍要有像素。
        let rgba = plan.render_rgba(3.5).unwrap();
        let sample = |x: usize, y: usize| {
            let at = (y * 320 + x) * 4;
            (rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3])
        };
        let (left_r, left_g, left_b, left_a) = sample(80, 160);
        let (right_r, right_g, right_b, right_a) = sample(240, 160);
        assert!(
            left_a > 200,
            "Lottie 贴纸中心必须有像素，实测 alpha {left_a}"
        );
        assert!(
            left_b > left_g && left_b > left_r,
            "没带覆盖表的 Lottie 必须保持原色（偏蓝），实测 {left_r},{left_g},{left_b}"
        );
        assert!(
            right_a > 200,
            "换色 Lottie 贴纸中心必须有像素，实测 alpha {right_a}"
        );
        assert!(
            right_g > right_b && right_g > right_r,
            "带 fillOverrides 的 Lottie 必须换成绿色，实测 {right_r},{right_g},{right_b}"
        );
        // 圆外（画幅四角）必须透明：说明按素材 200×200 原尺寸光栅、没被拉成方块。
        let (_, _, _, corner_a) = sample(16, 16);
        assert_eq!(corner_a, 0, "Lottie 贴纸的圆外区域必须透明");

        plan.compositor_scene_support().unwrap();
        plan.compositor_scene_frame(3.5).unwrap();
        let texture = plan
            .compositor_texture_frame("timeline-media:green", 1_500)
            .unwrap();
        let center = texture
            .pixel(texture.width() / 2, texture.height() / 2)
            .unwrap();
        // 纹理按**元素盒的实际像素**光栅，不按素材 200×200 的原尺寸：320 画幅上
        // 占 40% 就是 128 px。矢量动图在原尺寸上多算的那些像素最后会被 GPU 缩掉，
        // 算了等于白算（见 `compositor_media_nodes` 里的目标尺寸推导）。
        assert_eq!((texture.width(), texture.height()), (128, 128));
        assert!(
            center.green() > center.blue(),
            "GPU 纹理也必须是换色后的绿，实测 {},{},{}",
            center.red(),
            center.green(),
            center.blue()
        );
    }

    #[test]
    fn compositor_export_scene_imports_a_host_decoded_image_texture() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("media")).unwrap();
        std::fs::write(
            project.path().join("media/dot.svg"),
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#00ff00"/></svg>"##,
        )
        .unwrap();
        let timeline = json!({
            "bcutTimeline": "0.2",
            "sources": {"dot": {"path": "media/dot.svg", "kind": "image", "duration": 0.0}},
            "tracks": [{"id": "overlay", "kind": "overlay", "elements": [
                {
                    "id": "image-1", "kind": "image", "start": 0.0, "end": 3.0,
                    "srcId": "dot", "mode": "fullscreen", "fit": "contain", "bg": "blur",
                    "place": {"x": 30, "y": 40, "w": 25, "opacity": 0.75, "radius": 4}
                },
                {
                    "id": "sticker-1", "kind": "sticker", "start": 0.0, "end": 3.0,
                    "srcId": "dot", "place": {"x": 70, "y": 60, "w": 20},
                    "sticker": {"source": "asset", "path": "media/dot.svg"}
                }
            ]}]
        });
        std::fs::write(
            project.path().join("timeline.json"),
            serde_json::to_vec(&timeline).unwrap(),
        )
        .unwrap();
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline;
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();

        plan.compositor_scene_support().unwrap();
        let scene = plan.compositor_scene_frame(1.0).unwrap();
        let [
            element_draw::SceneNode::Texture(node),
            element_draw::SceneNode::Texture(sticker),
        ] = scene.nodes.as_slice()
        else {
            panic!(
                "image 与 asset sticker 必须保持两条独立 TextureNode：{:?}",
                scene.nodes
            )
        };
        assert_eq!(node.texture, "timeline-media:image-1");
        assert_eq!((node.source_width, node.source_height), (64, 32));
        assert_eq!(node.media_ms, -1);
        assert_eq!(node.opacity, 0.75);
        assert_eq!(node.fit, element_draw::TextureFit::Contain);
        assert_eq!(node.background, element_draw::TextureBackground::Blur);
        assert_eq!(sticker.texture, "timeline-media:sticker-1");
        assert_eq!(sticker.media_ms, -1);
        assert_ne!(node.texture, sticker.texture, "同源元素不得争用纹理槽");
        let pixels = plan
            .compositor_texture_frame(&node.texture, node.media_ms)
            .unwrap();
        assert_eq!((pixels.width(), pixels.height()), (64, 32));
        assert!(
            pixels
                .data()
                .chunks_exact(4)
                .all(|pixel| pixel == [0, 255, 0, 255])
        );

        source["timeline"]["tracks"][0]["elements"][0]["fx"] = json!({"contrast": 0.25});
        let mut supported = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        supported
            .load_timeline_elements(project.path(), &source)
            .unwrap();
        assert!(supported.compositor_scene_frame(1.0).is_ok());

        source["timeline"]["tracks"][0]["elements"][0]["fx"] = json!({
            "filterPreset": "cottage3",
            "effectPreset": "bokeh_blur",
            "effectIntensity": 0.5,
            "sharpen": 0.25,
            "noise": 0.2,
            "vignette": 0.3
        });
        let mut advanced = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        advanced
            .load_timeline_elements(project.path(), &source)
            .unwrap();
        let scene = advanced.compositor_scene_frame(1.0).unwrap();
        let element_draw::SceneNode::Texture(node) = &scene.nodes[0] else {
            panic!("advanced media effects must stay in one texture node")
        };
        assert!(
            node.source_effects
                .iter()
                .any(|effect| matches!(effect, element_draw::TextureEffect::Sepia(_)))
        );
        assert!(
            node.source_effects
                .iter()
                .any(|effect| matches!(effect, element_draw::TextureEffect::Blur(_)))
        );
        assert!(
            node.source_effects
                .iter()
                .any(|effect| matches!(effect, element_draw::TextureEffect::Sharpen(_)))
        );
        assert!(
            node.source_effects
                .iter()
                .any(|effect| matches!(effect, element_draw::TextureEffect::Noise(_)))
        );
        assert!(
            node.source_effects
                .iter()
                .any(|effect| matches!(effect, element_draw::TextureEffect::Vignette(_)))
        );
    }

    /// [`SceneIdentity::Skip`] 只准少算身份，不准换画面。
    ///
    /// 导出用 Skip 是为了省掉每帧一趟整帧像素的 FNV-1a（720p 实测 3.3 ms/帧），
    /// 前提是它对 scene 本身零影响：节点、采样钟与 `next_change` 都必须与
    /// [`SceneIdentity::Full`] 逐项相同，只有 `fingerprint` 归零。
    #[test]
    fn skipping_scene_identity_changes_nothing_but_the_fingerprint() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("media")).unwrap();
        std::fs::write(
            project.path().join("media/dot.svg"),
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#00ff00"/></svg>"##,
        )
        .unwrap();
        let timeline = json!({
            "bcutTimeline": "0.2",
            "sources": {"dot": {"path": "media/dot.svg", "kind": "image", "duration": 0.0}},
            "tracks": [{"id": "overlay", "kind": "overlay", "elements": [{
                "id": "image-1", "kind": "image", "start": 0.0, "end": 3.0,
                "srcId": "dot", "mode": "fullscreen", "fit": "contain", "bg": "blur",
                "place": {"x": 30, "y": 40, "w": 25, "opacity": 0.75, "radius": 4}
            }]}]
        });
        std::fs::write(
            project.path().join("timeline.json"),
            serde_json::to_vec(&timeline).unwrap(),
        )
        .unwrap();
        let mut source = document("Karaoke", "fade");
        source["timeline"] = timeline;
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();
        plan.compositor_scene_support().unwrap();

        for time in [0.4, 0.9, 1.8] {
            let full = plan
                .compositor_scene_frame_with(time, SceneIdentity::Full)
                .unwrap();
            let skipped = plan
                .compositor_scene_frame_with(time, SceneIdentity::Skip)
                .unwrap();
            assert_eq!(skipped.next_change, full.next_change, "t={time}");
            assert_eq!(skipped.active_until, full.active_until, "t={time}");
            assert_eq!(
                scene_node_shapes(&skipped.nodes),
                scene_node_shapes(&full.nodes),
                "t={time}"
            );
            assert_ne!(full.fingerprint, 0, "t={time}：Full 必须真算出身份");
            assert_eq!(skipped.fingerprint, 0, "t={time}：Skip 的身份必须归零");
        }
    }

    /// [`SceneIdentity::Structural`] 是预览的去重身份：不读像素，但节点、采样钟与
    /// `next_change` 与 [`SceneIdentity::Full`] 逐项相同；同一时刻两次求值身份稳定，
    /// 元素几何一变身份就变（像素代理只替掉像素位，几何仍逐字段冻结）。
    #[test]
    fn structural_scene_identity_matches_full_scene_without_reading_pixels() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("media")).unwrap();
        std::fs::write(
            project.path().join("media/dot.svg"),
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#00ff00"/></svg>"##,
        )
        .unwrap();
        let compile = |x: f64| {
            let timeline = json!({
                "bcutTimeline": "0.2",
                "sources": {"dot": {"path": "media/dot.svg", "kind": "image", "duration": 0.0}},
                "tracks": [{"id": "overlay", "kind": "overlay", "elements": [{
                    "id": "image-1", "kind": "image", "start": 0.0, "end": 3.0,
                    "srcId": "dot", "mode": "pip", "fit": "contain",
                    "place": {"x": x, "y": 40, "w": 25, "opacity": 0.75, "radius": 4}
                }]}]
            });
            std::fs::write(
                project.path().join("timeline.json"),
                serde_json::to_vec(&timeline).unwrap(),
            )
            .unwrap();
            let mut source = document("None", "none");
            source["cues"] = json!([]);
            source["timeline"] = timeline;
            let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
            plan.load_timeline_elements(project.path(), &source)
                .unwrap();
            plan.compositor_scene_support().unwrap();
            plan
        };
        let mut plan = compile(30.0);
        let mut structural_at = Vec::new();
        for time in [0.4, 0.9, 1.8] {
            let full = plan
                .compositor_scene_frame_with(time, SceneIdentity::Full)
                .unwrap();
            let structural = plan
                .compositor_scene_frame_with(time, SceneIdentity::Structural)
                .unwrap();
            assert_eq!(structural.next_change, full.next_change, "t={time}");
            assert_eq!(structural.active_until, full.active_until, "t={time}");
            assert_eq!(
                scene_node_shapes(&structural.nodes),
                scene_node_shapes(&full.nodes),
                "t={time}"
            );
            assert_ne!(
                structural.fingerprint, 0,
                "t={time}：Structural 必须真算出身份"
            );
            let again = plan
                .compositor_scene_frame_with(time, SceneIdentity::Structural)
                .unwrap();
            assert_eq!(
                again.fingerprint, structural.fingerprint,
                "t={time}：同一时刻身份必须稳定"
            );
            structural_at.push(structural.fingerprint);
        }
        // 静态图 + 无字幕：三个时刻画面相同，去重身份也必须相同，否则每帧都会白上传一次。
        assert_eq!(structural_at[0], structural_at[1]);
        assert_eq!(structural_at[1], structural_at[2]);

        let mut moved = compile(31.0);
        let moved = moved
            .compositor_scene_frame_with(0.4, SceneIdentity::Structural)
            .unwrap();
        assert_ne!(
            moved.fingerprint, structural_at[0],
            "元素几何变了，结构身份必须跟着变"
        );
    }

    #[test]
    fn compositor_export_scene_freezes_media_animation_pose_blur() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("media")).unwrap();
        std::fs::write(
            project.path().join("media/dot.svg"),
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#00ff00"/></svg>"##,
        )
        .unwrap();
        let timeline = json!({
            "bcutTimeline": "0.2",
            "sources": {"dot": {"path": "media/dot.svg", "kind": "image", "duration": 0.0}},
            "tracks": [{"id": "overlay", "kind": "overlay", "elements": [{
                "id": "animated-image", "kind": "image", "start": 0.0, "end": 3.0,
                "srcId": "dot", "place": {"w": 25},
                "animate": {"enter": {"preset": "blurIn", "presetVersion": 1}}
            }]}]
        });
        std::fs::write(
            project.path().join("timeline.json"),
            serde_json::to_vec(&timeline).unwrap(),
        )
        .unwrap();
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline;
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();

        let animated = plan.compositor_scene_frame(0.1).unwrap();
        let [element_draw::SceneNode::BlurredGroup(group)] = animated.nodes.as_slice() else {
            panic!("blurIn 的活动窗口必须冻结成整元素 BlurredGroup")
        };
        assert!(group.radius > 0.0);
        let [element_draw::SceneNode::Texture(node)] = group.nodes.as_slice() else {
            panic!("动画组必须保留外部纹理子节点")
        };
        assert_eq!(node.texture, "timeline-media:animated-image");
        assert_eq!(node.reveal, 1.0);
        plan.compositor_texture_frame(&node.texture, node.media_ms)
            .unwrap();

        let settled = plan.compositor_scene_frame(1.0).unwrap();
        let [element_draw::SceneNode::Texture(node)] = settled.nodes.as_slice() else {
            panic!("blurIn 结束后不应保留空的中间 pass")
        };
        assert_eq!(node.reveal, 1.0);
        assert_ne!(animated.fingerprint, settled.fingerprint);
    }

    #[test]
    fn compositor_export_scene_expands_masked_image_tile_without_reuploading_the_source() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("media")).unwrap();
        std::fs::write(
            project.path().join("media/dot.svg"),
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#00ff00"/></svg>"##,
        )
        .unwrap();
        let timeline = json!({
            "bcutTimeline": "0.2",
            "sources": {"dot": {"path": "media/dot.svg", "kind": "image", "duration": 0.0}},
            "tracks": [{"id": "overlay", "kind": "overlay", "elements": [{
                "id": "tile-1", "kind": "image", "start": 0.0, "end": 3.0,
                "srcId": "dot", "fit": "cover",
                "place": {"w": 20, "scale": 1.1, "scaleY": 0.9, "rot": 5},
                "mask": {"shape": "ellipse", "feather": 4},
                "fx": {"grayscale": 0.6, "blur": 4, "brightness": -0.2},
                "tile": {"on": true, "angle": -30, "gapX": 8, "gapY": 10}
            }]}]
        });
        std::fs::write(
            project.path().join("timeline.json"),
            serde_json::to_vec(&timeline).unwrap(),
        )
        .unwrap();
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline;
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();

        let scene = plan.compositor_scene_frame(1.0).unwrap();
        assert!(scene.nodes.len() > 20);
        let textures = scene
            .nodes
            .iter()
            .map(|node| match node {
                element_draw::SceneNode::Texture(node) => node,
                other => panic!("tile 只能展开为 TextureNode：{other:?}"),
            })
            .collect::<Vec<_>>();
        assert!(
            textures
                .iter()
                .all(|node| node.texture == "timeline-media:tile-1"
                    && node.media_ms == -1
                    && node.mask_shape == element_draw::TextureMaskShape::Ellipse
                    && node.radius == 0.0
                    && node.mask_feather > 0.0
                    && node.source_effects.as_ref()
                        == [
                            element_draw::TextureEffect::ColorAdjust {
                                grayscale: 0.6,
                                brightness: -0.2,
                            },
                            element_draw::TextureEffect::Blur(1),
                        ])
        );
        let pixels = plan
            .compositor_texture_frame(&textures[0].texture, textures[0].media_ms)
            .unwrap();
        assert_eq!((pixels.width(), pixels.height()), (64, 32));
    }

    #[test]
    fn compositor_export_scene_places_template_chrome_last() {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        let template = chrome_scene(0.0, 24.0 / 1.8);
        let fingerprint = template.fingerprint;
        plan.set_template_scene(Some(template));

        plan.compositor_scene_support().unwrap();
        let scene = plan.compositor_scene_frame(1.0).unwrap();
        let Some(element_draw::SceneNode::Texture(node)) = scene.nodes.last() else {
            panic!("template chrome 必须成为最末一条 TextureNode")
        };
        assert_eq!(node.texture, format!("template-chrome:{fingerprint:016x}"));
        assert_eq!(node.rect, [0.0, 0.0, 320.0, 180.0]);
        assert_eq!(node.media_ms, 1_000);
        let pixels = plan
            .compositor_texture_frame(&node.texture, node.media_ms)
            .unwrap();
        assert!(alpha_rows(pixels.data(), 320, 4) > 0);
        assert_eq!(alpha_rows(pixels.data(), 320, 40), 0);
    }

    #[test]
    fn compositor_export_scene_keeps_vector_before_retained_text() {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({
            "tracks": [{"elements": [
                {
                    "id": "shape", "kind": "shape", "start": 0.0, "end": 3.0,
                    "shape": {"shape": "rect", "fill": "#ff0000"},
                    "place": {"x": 30, "y": 30, "w": 20}
                },
                {
                    "id": "title", "kind": "text", "start": 0.0, "end": 3.0,
                    "text": "GPU", "style": {
                        "fontFamily": "Montserrat", "fontSize": 28,
                        "background": false, "outline": false
                    }
                }
            ]}]
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_projected_timeline_elements(&source).unwrap();

        plan.compositor_scene_support().unwrap();
        let scene = plan.compositor_scene_frame(1.0).unwrap();
        assert!(matches!(
            scene.nodes.first(),
            Some(element_draw::SceneNode::Vectors(_))
        ));
        assert!(matches!(
            scene.nodes.last(),
            Some(element_draw::SceneNode::Glyphs(_))
        ));
        assert_eq!(scene.next_change, Some(3.0));
    }

    #[test]
    fn local_text_audition_moves_only_the_target_and_restores_the_frame() {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({"tracks":[{"elements":[
            {"id":"shape","kind":"shape","start":0,"end":3,"shape":{"shape":"rect","fill":"#FF0000"},"place":{"x":20,"y":20,"w":10},"animate":{"loop":{"preset":"pulse","period":2}}},
            {"id":"title","kind":"text","start":1,"end":3,"text":"LOCAL","place":{"x":60,"y":65,"w":50},"style":{"fontFamily":"Montserrat","fontSize":28,"background":false,"outline":false},"animate":{"enter":{"preset":"fade","dur":1},"exit":{"preset":"none"}}}
        ]}]});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_projected_timeline_elements(&source).unwrap();
        let base = plan.render_rgba_frame(0.5).unwrap();
        let before = plan.compositor_scene_frame(0.5).unwrap();
        plan.set_element_sample_time(Some(("title".into(), 1.2)));
        let first = plan.compositor_scene_frame(0.5).unwrap();
        let cpu_first = plan.render_rgba_frame(0.5).unwrap();
        plan.set_element_sample_time(Some(("title".into(), 1.8)));
        let second = plan.compositor_scene_frame(0.5).unwrap();
        let cpu_second = plan.render_rgba_frame(0.5).unwrap();
        assert_eq!(
            format!("{:?}", before.nodes.first()),
            format!("{:?}", first.nodes.first()),
            "background keeps timeline time"
        );
        assert_eq!(
            format!("{:?}", first.nodes.first()),
            format!("{:?}", second.nodes.first())
        );
        assert!(
            first.nodes.len() > before.nodes.len(),
            "selected text can be auditioned outside its timeline span"
        );
        assert_ne!(first.fingerprint, second.fingerprint);
        assert_ne!(cpu_first.rgba, cpu_second.rgba);
        plan.set_element_sample_time(None);
        assert_eq!(
            plan.compositor_scene_frame(0.5).unwrap().fingerprint,
            before.fingerprint
        );
        assert_eq!(plan.render_rgba_frame(0.5).unwrap().rgba, base.rgba);
    }

    /// 白板测试共用的源图：左半是一笔黑墨（细线），右半是一块红色色块。
    fn bcut_subtitle_render_whiteboard_project() -> (tempfile::TempDir, Value) {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("media")).unwrap();
        let mut pixmap = tiny_skia::Pixmap::new(240, 120).unwrap();
        pixmap.fill(tiny_skia::Color::WHITE);
        let mut ink = tiny_skia::Paint::default();
        ink.set_color_rgba8(20, 20, 20, 255);
        let mut stroke = tiny_skia::Stroke::default();
        stroke.width = 4.0;
        let mut pb = tiny_skia::PathBuilder::new();
        pb.move_to(20.0, 20.0);
        pb.line_to(100.0, 100.0);
        pb.line_to(100.0, 20.0);
        let path = pb.finish().unwrap();
        pixmap.stroke_path(&path, &ink, &stroke, tiny_skia::Transform::identity(), None);
        let mut red = tiny_skia::Paint::default();
        red.set_color_rgba8(230, 40, 40, 255);
        pixmap.fill_rect(
            tiny_skia::Rect::from_xywh(150.0, 30.0, 60.0, 60.0).unwrap(),
            &red,
            tiny_skia::Transform::identity(),
            None,
        );
        std::fs::write(
            project.path().join("media/board.png"),
            pixmap.encode_png().unwrap(),
        )
        .unwrap();
        let timeline = json!({
            "bcutTimeline": "0.8",
            "sources": {
                "board": {"path": "media/board.png", "kind": "image", "duration": 0.0}
            },
            "tracks": [{"id": "overlay", "kind": "overlay", "elements": [{
                "id": "wb", "kind": "whiteboard", "start": 0.0, "end": 4.0, "srcId": "board",
                "place": {"x": 50, "y": 50, "w": 80},
                "whiteboard": {"draw": 2.0, "hand": "none"}
            }]}]
        });
        std::fs::write(
            project.path().join("timeline.json"),
            serde_json::to_vec(&timeline).unwrap(),
        )
        .unwrap();
        (project, timeline)
    }

    fn bcut_subtitle_render_count_reddish(rgba: &[u8]) -> usize {
        rgba.chunks_exact(4)
            .filter(|px| px[0] > 150 && px[1] < 90 && px[2] < 90)
            .count()
    }

    /// GPU 合成场景（离屏导出与 App 预览）里白板件不能被静默丢掉：CPU 只产出
    /// 天然尺寸的揭示纹理，fit / mask / pose 留给 GPU TextureNode；像素与 CPU
    /// overlay 同源（前段无红、hold 段红块完整），且画时内按帧调度。
    #[test]
    fn compositor_scene_keeps_whiteboard_at_source_size_and_gpu_places_it() {
        let (project, timeline) = bcut_subtitle_render_whiteboard_project();
        let mut source = document("none", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline;
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 4.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();
        plan.compositor_scene_support().unwrap();

        let early = plan.compositor_scene_frame(0.5).unwrap();
        let [element_draw::SceneNode::Texture(node)] = early.nodes.as_slice() else {
            panic!("白板件应成为唯一一条 TextureNode：{:?}", early.nodes.len())
        };
        assert_eq!(node.texture, "whiteboard:wb");
        assert_eq!(node.rect, [32.0, 26.0, 256.0, 128.0]);
        assert_eq!((node.source_width, node.source_height), (240, 120));
        assert_eq!(node.media_ms, 500);
        let pixels = plan
            .compositor_texture_frame(&node.texture, node.media_ms)
            .unwrap();
        assert_eq!((pixels.width(), pixels.height()), (240, 120));
        assert_eq!(
            bcut_subtitle_render_count_reddish(pixels.data()),
            0,
            "前段只有墨线"
        );
        assert_eq!(
            early.next_change,
            Some(16.0 / 30.0),
            "画时内逐帧揭示，下一帧就要重采样"
        );

        let held = plan.compositor_scene_frame(3.0).unwrap();
        let [element_draw::SceneNode::Texture(node)] = held.nodes.as_slice() else {
            panic!("hold 段仍是一条 TextureNode")
        };
        assert_eq!(held.next_change, Some(4.0), "draw 后应直接复用到元素末尾");
        let pixels = plan
            .compositor_texture_frame(&node.texture, node.media_ms)
            .unwrap();
        assert!(
            bcut_subtitle_render_count_reddish(pixels.data()) > 1000,
            "hold 段红块完整"
        );
        assert_ne!(
            early.fingerprint, held.fingerprint,
            "不同采样钟的场景指纹不同"
        );
        let structural = plan
            .compositor_scene_frame_with(3.0, SceneIdentity::Structural)
            .unwrap();
        assert!(!structural.nodes.is_empty());
    }

    /// 源图比元素盒大时，揭示场按**盒子的像素**跑，不在源图天然尺寸上白算。
    ///
    /// 160×90 的画幅上 `w: 80` 的盒子是 128 px 宽，而源图 240×120——缩到
    /// 128×64 去揭示，最后那张纹理就是 128×64。盒子反过来比源大时不缩（见
    /// [`Self::compositor_scene_keeps_whiteboard_at_source_size_and_gpu_places_it`]
    /// 那条：320 画幅上盒子 256 px，比 240 的源还宽，放大交给 GPU）。
    #[test]
    fn a_whiteboard_larger_than_its_box_reveals_at_the_box_size() {
        let (project, timeline) = bcut_subtitle_render_whiteboard_project();
        let mut source = document("none", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline;
        let mut plan = OverlayRenderPlan::compile(&source, 160, 90, 4.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();
        plan.compositor_scene_support().unwrap();

        let early = plan.compositor_scene_frame(0.5).unwrap();
        let [element_draw::SceneNode::Texture(node)] = early.nodes.as_slice() else {
            panic!("白板件应成为唯一一条 TextureNode")
        };
        assert_eq!(
            (node.source_width, node.source_height),
            (128, 64),
            "纹理按元素盒的像素出，不按源图的 240×120"
        );
        let pixels = plan
            .compositor_texture_frame(&node.texture, node.media_ms)
            .unwrap();
        assert_eq!((pixels.width(), pixels.height()), (128, 64));
        assert_eq!(
            bcut_subtitle_render_count_reddish(pixels.data()),
            0,
            "缩过之后前段照旧只有墨线"
        );

        // 揭示照常推进：`draw` 之后红块要完整出现（按面积等比缩，1/3.5 左右）。
        let held = plan.compositor_scene_frame(3.0).unwrap();
        let [element_draw::SceneNode::Texture(node)] = held.nodes.as_slice() else {
            panic!("hold 段仍是一条 TextureNode")
        };
        let pixels = plan
            .compositor_texture_frame(&node.texture, node.media_ms)
            .unwrap();
        assert!(
            bcut_subtitle_render_count_reddish(pixels.data()) > 250,
            "hold 段红块完整，实测 {}",
            bcut_subtitle_render_count_reddish(pixels.data())
        );
    }

    /// 白板件走 Image 的几何与遮罩路径，只在像素上按显露场揭示：
    /// `draw` 之前逐步出现（墨先于色），`draw` 之后与同源 image 件逐像素一致；
    /// 任意时刻的帧只是 `t` 的函数——乱序采样与顺序采样必须给出同一批像素。
    #[test]
    fn whiteboard_reveals_ink_before_color_and_is_order_independent() {
        let (project, timeline) = bcut_subtitle_render_whiteboard_project();
        let mut source = document("none", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline.clone();
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 4.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();

        let start = plan.render_rgba_frame(0.0).unwrap();
        let early = plan.render_rgba_frame(0.5).unwrap();
        let mid = plan.render_rgba_frame(1.7).unwrap();
        let held = plan.render_rgba_frame(3.0).unwrap();
        let red_start = bcut_subtitle_render_count_reddish(&start.rgba);
        let red_early = bcut_subtitle_render_count_reddish(&early.rgba);
        let red_mid = bcut_subtitle_render_count_reddish(&mid.rgba);
        let red_held = bcut_subtitle_render_count_reddish(&held.rgba);
        assert_eq!(red_start, 0, "t=0 什么都还没画");
        assert_eq!(red_early, 0, "墨先于色：draw 的前段只画黑线，红块还没开始");
        assert!(
            red_mid > 0 && red_mid < red_held,
            "中段红块画了一部分：{red_mid} / {red_held}"
        );
        assert!(red_held > 1000, "hold 段红块完整：{red_held}");
        assert_ne!(start.rgba, early.rgba, "前段应已经出现墨线");

        // hold 段与同源 image 件逐像素一致——白板不改几何、不改遮罩、不改合成。
        let mut as_image = source.clone();
        as_image["timeline"]["tracks"][0]["elements"][0]["kind"] = json!("image");
        as_image["timeline"]["tracks"][0]["elements"][0]
            .as_object_mut()
            .unwrap()
            .remove("whiteboard");
        let mut image_plan =
            OverlayRenderPlan::compile(&as_image, 320, 180, 4.0, 30.0, None).unwrap();
        image_plan
            .load_timeline_elements(project.path(), &as_image)
            .unwrap();
        assert_eq!(image_plan.render_rgba_frame(3.0).unwrap().rgba, held.rgba);

        // 乱序采样：新计划先取 3.0 再取 1.7、0.5、0.0，像素必须与顺序采样一致。
        let mut shuffled = OverlayRenderPlan::compile(&source, 320, 180, 4.0, 30.0, None).unwrap();
        shuffled
            .load_timeline_elements(project.path(), &source)
            .unwrap();
        assert_eq!(shuffled.render_rgba_frame(3.0).unwrap().rgba, held.rgba);
        assert_eq!(shuffled.render_rgba_frame(1.7).unwrap().rgba, mid.rgba);
        assert_eq!(shuffled.render_rgba_frame(0.5).unwrap().rgba, early.rgba);
        assert_eq!(shuffled.render_rgba_frame(0.0).unwrap().rgba, start.rgba);
        assert_eq!(plan.whiteboard_cache.len(), 1, "同一源同一参数只分析一次");
    }

    /// `beats` 改变揭示顺序：把红块钉在 0 秒、墨线钉在后面，前段就该先出红。
    #[test]
    fn whiteboard_beats_override_reading_order() {
        let (project, mut timeline) = bcut_subtitle_render_whiteboard_project();
        timeline["tracks"][0]["elements"][0]["whiteboard"] = json!({
            "draw": 2.0, "hand": "none",
            "beats": [
                {"at": 0.0, "box": [60, 20, 35, 60]},
                {"at": 1.2, "box": [5, 10, 45, 80]}
            ]
        });
        let mut source = document("none", "none");
        source["cues"] = json!([]);
        source["timeline"] = timeline;
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 4.0, 30.0, None).unwrap();
        plan.load_timeline_elements(project.path(), &source)
            .unwrap();
        let early = plan.render_rgba_frame(0.5).unwrap();
        assert!(
            bcut_subtitle_render_count_reddish(&early.rgba) > 0,
            "beats 把红块排到第一拍，前段就应看见红"
        );
    }

    /// 两个彩纸试穿测试共用的构造：窗口只在补幽灵时用得上。
    fn bcut_subtitle_render_confetti_peek(id: &str, style: &str) -> ConfettiPeek {
        ConfettiPeek {
            id: id.to_owned(),
            props: timeline::schema::ConfettiProps {
                seed: Some(7),
                ..timeline::schema::ConfettiProps::new(style)
            },
            window: (0.0, 6.0),
        }
    }

    /// 彩纸试穿走**就地补丁**：换款只改计划里那一件的 `confetti`，撤回把原配方
    /// 写回去。宿主因此不用为了「找回原值」整份重编译一次（第 236 轮）。
    #[test]
    fn confetti_peek_swaps_a_recipe_in_place_and_restores_it() {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({"tracks":[{"elements":[
            {"id":"cft","kind":"confetti","start":0,"end":6,
             "confetti":{"style":"rainbow-paper","seed":7}}
        ]}]});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 6.0, 30.0, None).unwrap();
        plan.load_projected_timeline_elements(&source).unwrap();
        let base = plan.render_rgba_frame(1.0).unwrap();
        let elements_before = plan.elements.len();

        plan.set_confetti_peek(Some(bcut_subtitle_render_confetti_peek(
            "cft",
            "neon-streamers",
        )));
        let swapped = plan.render_rgba_frame(1.0).unwrap();
        assert_eq!(plan.elements.len(), elements_before, "就地补丁不新增元素");
        assert_ne!(
            swapped.draw_op_fingerprint, base.draw_op_fingerprint,
            "换款要真的改到 draw ops，否则宿主的同指纹去重会把预览帧吞掉"
        );

        // 连换两款：第二款必须从**原配方**换起，而不是从第一款换起。
        plan.set_confetti_peek(Some(bcut_subtitle_render_confetti_peek(
            "cft",
            "hearts-petals",
        )));
        let second = plan.render_rgba_frame(1.0).unwrap();
        assert_ne!(second.draw_op_fingerprint, swapped.draw_op_fingerprint);

        plan.set_confetti_peek(None);
        let restored = plan.render_rgba_frame(1.0).unwrap();
        assert_eq!(plan.elements.len(), elements_before);
        assert_eq!(
            restored.draw_op_fingerprint, base.draw_op_fingerprint,
            "撤回要回到原配方——计划里存着原值，不必重编译"
        );
        assert_eq!(restored.rgba, base.rgba);
    }

    /// 计划里没有目标件时凭空补一件幽灵：素材库网格上还没有选中件，这是那条链
    /// 唯一能在舞台上看见效果的办法（第 236 轮）。撤回整件摘掉，一个像素不留。
    #[test]
    fn confetti_peek_conjures_a_ghost_when_the_element_is_absent() {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({"tracks":[{"elements":[
            {"id":"shape","kind":"shape","start":0,"end":6,
             "shape":{"shape":"rect","fill":"#FF0000"},"place":{"x":20,"y":20,"w":10}}
        ]}]});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 6.0, 30.0, None).unwrap();
        plan.load_projected_timeline_elements(&source).unwrap();
        let base = plan.render_rgba_frame(1.0).unwrap();
        let elements_before = plan.elements.len();

        let mut ghost = bcut_subtitle_render_confetti_peek("__confetti_peek__", "party-cannons");
        ghost.window = (0.0, 6.0);
        plan.set_confetti_peek(Some(ghost));
        let with_ghost = plan.render_rgba_frame(1.0).unwrap();
        assert_eq!(plan.elements.len(), elements_before + 1, "幽灵件补在末尾");
        assert_eq!(
            plan.elements.last().map(|e| e.id.as_str()),
            Some("__confetti_peek__")
        );
        assert_ne!(with_ghost.rgba, base.rgba, "幽灵件必须真的画出来");

        plan.set_confetti_peek(None);
        let cleared = plan.render_rgba_frame(1.0).unwrap();
        assert_eq!(plan.elements.len(), elements_before, "撤回整件摘掉");
        assert_eq!(cleared.rgba, base.rgba);
    }

    /// 悬停试穿的本地钟必须在 **GPU 合成路径**上也算数。macOS App 的舞台走的是
    /// `compositor_scene_frame`，一度只有文字分支查 `sample_time_for`，其余元素
    /// 拿全局播放头求值：幽灵彩纸的 `start` 正好等于播放头，于是永远停在局部
    /// 0 秒——一颗粒子都没发射出来，舞台上什么都看不见（第 236 轮）。
    #[test]
    fn the_peek_clock_drives_non_text_elements_on_the_gpu_path() {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({"tracks":[{"elements":[
            {"id":"cft","kind":"confetti","start":1,"end":6,
             "confetti":{"style":"rainbow-paper","seed":7}}
        ]}]});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 6.0, 30.0, None).unwrap();
        plan.load_projected_timeline_elements(&source).unwrap();

        // 播放头钉死在这一件的起点：不看本地钟就等于局部 0 秒。
        let at_start = plan.compositor_scene_frame(1.0).unwrap().fingerprint;
        let cpu_at_start = plan.render_rgba_frame(1.0).unwrap().draw_op_fingerprint;

        plan.set_element_sample_time(Some(("cft".to_owned(), 3.0)));
        assert_ne!(
            plan.compositor_scene_frame(1.0).unwrap().fingerprint,
            at_start,
            "GPU 合成路径没认本地钟：舞台上看不到试穿"
        );
        assert_ne!(
            plan.render_rgba_frame(1.0).unwrap().draw_op_fingerprint,
            cpu_at_start,
            "CPU overlay 路径也得认本地钟"
        );

        // 撤回本地钟＝回到播放头，两条路径都要回到原样。
        plan.set_element_sample_time(None);
        assert_eq!(
            plan.compositor_scene_frame(1.0).unwrap().fingerprint,
            at_start
        );
        assert_eq!(
            plan.render_rgba_frame(1.0).unwrap().draw_op_fingerprint,
            cpu_at_start
        );
    }

    /// 上一条与幽灵件合起来才是用户的真实场景：素材库网格上**没有选中件**时，
    /// 悬停靠 `set_confetti_peek` 凭空补一件 `__confetti_peek__`，窗口起点就是
    /// 当前播放头，而 macOS App 的舞台走 GPU 合成路径。幽灵必须挤进 `active`
    /// 过滤、活过 `compositor_scene_support`，并且按本地钟往前跑（第 236 轮）。
    #[test]
    fn a_confetti_ghost_lands_on_the_gpu_compositor_scene() {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({"tracks":[{"elements":[]}]});
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 6.0, 30.0, None).unwrap();
        plan.load_projected_timeline_elements(&source).unwrap();
        let bare = plan.compositor_scene_frame(1.0).unwrap().fingerprint;

        let mut ghost = bcut_subtitle_render_confetti_peek("__confetti_peek__", "rainbow-paper");
        ghost.window = (1.0, 3.0);
        plan.set_confetti_peek(Some(ghost));
        let at_local_zero = plan.compositor_scene_frame(1.0).unwrap().fingerprint;

        // 本地钟往前推 1 秒：认钟才有粒子，不认钟就永远停在窗口起点。
        plan.set_element_sample_time(Some(("__confetti_peek__".to_owned(), 2.0)));
        let running = plan.compositor_scene_frame(1.0).unwrap().fingerprint;
        assert_ne!(running, bare, "幽灵件没进 GPU 合成场景：舞台上什么都没有");
        assert_ne!(
            running, at_local_zero,
            "幽灵件停在局部 0 秒：一颗粒子都没发射出来"
        );

        // 撤回试穿要一个像素不留。
        plan.set_element_sample_time(None);
        plan.set_confetti_peek(None);
        assert_eq!(plan.compositor_scene_frame(1.0).unwrap().fingerprint, bare);
    }

    /// 舞台拖拽期的预览只改内存里的 `place`，磁盘投影文档不动，因此
    /// `definition_key` 不变。SceneFrame 身份必须自己覆盖文本几何，否则每
    /// 一帧预览都会被宿主的 `overlay_fingerprint` 去重守卫整帧丢掉——选框
    /// 在动、glyph 却钉在原地，直到松手提交才跳过去。
    #[test]
    fn compositor_scene_fingerprint_follows_in_memory_text_geometry() {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({
            "tracks": [{"elements": [{
                "id": "title", "kind": "text", "start": 0.0, "end": 3.0,
                "text": "GPU", "place": {"x": 50, "y": 50, "w": 40},
                "style": {
                    "fontFamily": "Montserrat", "fontSize": 28,
                    "background": false, "outline": false
                }
            }]}]
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_projected_timeline_elements(&source).unwrap();

        let base = plan.compositor_scene_frame(1.0).unwrap().fingerprint;
        let repeat = plan.compositor_scene_frame(1.0).unwrap().fingerprint;
        assert_eq!(
            base, repeat,
            "同一份计划的同一时刻必须稳定复现身份，去重守卫才成立"
        );

        // `apps/baocut` 的 `apply_element_preview` 就是这么改的：只写 Place。
        for (field, patch) in [
            (
                "x",
                Box::new(|place: &mut Place| place.x = Some(62.0)) as Box<dyn Fn(&mut Place)>,
            ),
            ("y", Box::new(|place: &mut Place| place.y = Some(38.0))),
            ("w", Box::new(|place: &mut Place| place.w = Some(55.0))),
            (
                "scale",
                Box::new(|place: &mut Place| place.scale = Some(1.4)),
            ),
            ("rot", Box::new(|place: &mut Place| place.rot = Some(12.0))),
            (
                "opacity",
                Box::new(|place: &mut Place| place.opacity = Some(0.5)),
            ),
        ] {
            let mut moved = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
            moved.load_projected_timeline_elements(&source).unwrap();
            let element = moved
                .elements
                .iter_mut()
                .find(|element| element.id == "title")
                .expect("投影后的文本元素");
            patch(&mut element.place);
            let after = moved.compositor_scene_frame(1.0).unwrap().fingerprint;
            assert_ne!(
                base, after,
                "内存改 place.{field} 后 SceneFrame 身份必须变化"
            );
        }
    }

    #[test]
    fn compositor_export_support_accepts_external_texture_elements_after_r5() {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({
            "tracks": [{"elements": [{
                "id": "photo", "kind": "image", "start": 0.0, "end": 3.0,
                "srcId": "asset-photo"
            }]}]
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_projected_timeline_elements(&source).unwrap();

        plan.compositor_scene_support().unwrap();
    }

    // ── 字幕轨集：文档真相与 `mode` 兼容投影 ──

    #[test]
    fn a_track_set_derives_the_compatibility_mode() {
        let cases = [
            (json!([{"role": "source"}]), StudioMode::Original),
            (json!([{"role": "translation"}]), StudioMode::Translated),
            (
                json!([{"role": "source"}, {"role": "translation"}]),
                StudioMode::Bilingual,
            ),
        ];
        for (tracks, expected) in cases {
            let style = json!({"tracks": tracks});
            assert_eq!(StudioMode::of_style(&style), expected);
        }
    }

    #[test]
    fn a_malformed_track_entry_is_dropped_and_a_repeated_role_keeps_the_first() {
        let style = json!({"tracks": [
            {"role": "nonsense"},
            {"lang": "zh"},
            {"role": "source", "lang": "en"},
            {"role": "source", "lang": "ja"},
            42,
        ]});
        assert_eq!(
            resolve_track_set(&style),
            vec![SubtitleTrack::source(Some("en".to_owned()))]
        );
    }

    /// 旧文档没有 `tracks`：从兼容 `mode` 派生，两者都缺席时是单条原文轨。
    #[test]
    fn a_legacy_style_without_tracks_migrates_from_its_mode_at_read_time() {
        assert_eq!(
            resolve_track_set(&json!({"mode": "bilingual"})),
            vec![
                SubtitleTrack::source(None),
                SubtitleTrack::translation(None)
            ]
        );
        assert_eq!(
            resolve_track_set(&json!({"mode": "translated"})),
            vec![SubtitleTrack::translation(None)]
        );
        assert_eq!(
            resolve_track_set(&json!({})),
            vec![SubtitleTrack::source(None)]
        );
        // 认不出来的 `mode` 与缺席同义，不 panic 也不猜。
        assert_eq!(
            resolve_track_set(&json!({"mode": "nonsense"})),
            vec![SubtitleTrack::source(None)]
        );
    }

    /// apps/mac 无条件回写扁平 `mode`。两者打架时以 `mode` 为准并重派生轨集，
    /// 同 role 的语言标注沿用。
    #[test]
    fn a_conflicting_legacy_mode_rederives_the_track_set_and_keeps_langs() {
        let style = json!({
            "mode": "orig",
            "tracks": [{"role": "source", "lang": "en"}, {"role": "translation", "lang": "zh"}],
        });
        assert_eq!(
            resolve_track_set(&style),
            vec![SubtitleTrack::source(Some("en".to_owned()))]
        );
        let style = json!({
            "mode": "bi",
            "tracks": [{"role": "translation", "lang": "zh"}],
        });
        assert_eq!(
            resolve_track_set(&style),
            vec![
                SubtitleTrack::source(None),
                SubtitleTrack::translation(Some("zh".to_owned())),
            ]
        );
    }

    #[test]
    fn tracks_serialize_without_an_empty_lang_key() {
        let tracks = vec![
            SubtitleTrack::source(None),
            SubtitleTrack::translation(Some("zh".to_owned())),
        ];
        assert_eq!(
            tracks_json(&tracks),
            json!([{"role": "source"}, {"role": "translation", "lang": "zh"}])
        );
    }

    /// 不给 `--mode` 的导出按轨集烧译文轨，不再读扁平 `mode`。
    #[test]
    fn the_burn_in_mode_falls_back_to_the_document_track_set() {
        let mut document =
            json!({"style": {"tracks": [{"role": "source"}, {"role": "translation"}]}});
        assert_eq!(translation_burn_in_mode(&document, None), Some("bilingual"));
        document["style"]["tracks"] = json!([{"role": "translation"}]);
        assert_eq!(
            translation_burn_in_mode(&document, None),
            Some("translated")
        );
        document["style"]["tracks"] = json!([{"role": "source"}]);
        assert_eq!(translation_burn_in_mode(&document, None), None);
        // `--mode` 仍然是一次性编译参数，优先于文档轨集。
        document["style"]["tracks"] = json!([{"role": "source"}]);
        assert_eq!(
            translation_burn_in_mode(&document, Some("bilingual")),
            Some("bilingual")
        );
    }

    /// D10：`hidden` 缺省不落盘（老文档字节不变），置位时才写出来，并且能原样
    /// 穿过读时迁移。
    #[test]
    fn a_hidden_track_round_trips_through_the_track_set() {
        let tracks = vec![
            SubtitleTrack::source(None),
            SubtitleTrack::translation(Some("zh".to_owned())).with_hidden(true),
        ];
        let json = tracks_json(&tracks);
        assert_eq!(
            json,
            json!([
                {"role": "source"},
                {"role": "translation", "lang": "zh", "hidden": true},
            ])
        );
        assert_eq!(resolve_track_set(&json!({"tracks": json})), tracks);
        // `hidden: false` 与缺席同义。
        assert_eq!(
            resolve_track_set(&json!({"tracks": [{"role": "source", "hidden": false}]})),
            vec![SubtitleTrack::source(None)]
        );
    }

    /// D10 的核心不变式：根 `mode` 描述**声明**的轨集（关掉一条轨不改声明），
    /// 生效模式才跳过 `hidden`。两者分开，「放回」才拿得回原样。
    #[test]
    fn hidden_narrows_the_effective_mode_but_not_the_declared_one() {
        let style = json!({"tracks": [
            {"role": "source"},
            {"role": "translation", "lang": "zh", "hidden": true},
        ]});
        assert_eq!(StudioMode::of_style(&style), StudioMode::Bilingual);
        assert_eq!(mode_of(&resolve_track_set(&style)), StudioMode::Bilingual);
        assert_eq!(
            effective_track_set(&style),
            vec![SubtitleTrack::source(None)]
        );
        assert_eq!(effective_mode(&style), Some(StudioMode::Original));
        // 写路径 canonicalize 照样写声明的 `mode`，并把 `hidden` 原样带过去。
        let mut settled = style.clone();
        crate::style_sync::canonicalize_track_set(
            &mut settled,
            crate::style_sync::TranslationGuard::Keep,
            crate::style_sync::TrackSetIntent::Authored,
        );
        assert_eq!(settled["mode"], json!("bi"));
        assert_eq!(settled["tracks"], style["tracks"]);
    }

    /// 全部字幕轨都被关掉 = 这次一条字幕都不烧（等价 `--no-subs`）。
    #[test]
    fn an_all_hidden_track_set_has_no_effective_mode() {
        let style = json!({"tracks": [
            {"role": "source", "hidden": true},
            {"role": "translation", "hidden": true},
        ]});
        assert!(effective_track_set(&style).is_empty());
        assert_eq!(effective_mode(&style), None);
        let document = json!({"style": style});
        assert_eq!(translation_burn_in_mode(&document, None), None);
    }

    /// 关掉译文轨后，不给 `--mode` 的导出不再烧译文。
    #[test]
    fn the_burn_in_mode_skips_hidden_tracks() {
        let mut document = json!({"style": {"tracks": [
            {"role": "source"},
            {"role": "translation", "lang": "zh"},
        ]}});
        assert_eq!(translation_burn_in_mode(&document, None), Some("bilingual"));
        document["style"]["tracks"][1]["hidden"] = json!(true);
        assert_eq!(translation_burn_in_mode(&document, None), None);
        // 显式 `--mode` 仍然优先。
        assert_eq!(
            translation_burn_in_mode(&document, Some("translated")),
            Some("translated")
        );
    }

    /// 同 role 的重复条目在解析时就被丢掉，所以「生效译文轨 >1 条」的告警判据
    /// 只能从原始数组上取。
    #[test]
    fn duplicate_roles_are_reported_from_the_raw_track_array() {
        let style = json!({"tracks": [
            {"role": "source"},
            {"role": "translation", "lang": "zh"},
            {"role": "translation", "lang": "ja"},
            {"role": "translation", "lang": "ko"},
        ]});
        assert_eq!(duplicate_track_roles(&style), vec![TrackRole::Translation]);
        assert_eq!(
            resolve_track_set(&style),
            vec![
                SubtitleTrack::source(None),
                SubtitleTrack::translation(Some("zh".to_owned())),
            ]
        );
        assert!(duplicate_track_roles(&json!({"tracks": [{"role": "source"}]})).is_empty());
        assert!(duplicate_track_roles(&json!({})).is_empty());
    }

    /// 轨集裁决与 Studio 的 JS 镜像共用一张黄金表：两边逐行消费同一份夹具，
    /// 谁改了规则不同步，另一边立刻红。
    #[test]
    fn the_track_set_resolver_matches_the_shared_contract_fixture() {
        let contract: Value = serde_json::from_str(include_str!(
            "../../speech-doc/tests/fixtures/subtitle-render-contract.json"
        ))
        .unwrap();
        let rows = contract["trackSet"]["resolve"]
            .as_array()
            .expect("夹具缺 trackSet.resolve");
        assert!(!rows.is_empty());
        for row in rows {
            let case = row["description"].as_str().unwrap_or("<无描述>");
            let tracks = resolve_track_set(&row["style"]);
            assert_eq!(tracks_json(&tracks), row["expected"]["tracks"], "{case}");
            assert_eq!(
                mode_token(mode_of(&tracks)),
                row["expected"]["mode"].as_str().expect("expected.mode"),
                "{case}"
            );
            // 读时迁移必须幂等：裁决出来的轨集再解析一次结果不变。
            let settled = json!({"tracks": tracks_json(&tracks)});
            assert_eq!(
                tracks_json(&resolve_track_set(&settled)),
                tracks_json(&tracks),
                "{case}"
            );
        }
    }

    #[test]
    fn gpu_normal_overlay_uses_the_cpu_source_over_formula() {
        let overlay = [64, 32, 16, 128, 0, 0, 0, 0];
        let mut expected = [40, 80, 120, 255, 1, 2, 3, 255];
        composite_caption_pixel_bgra(
            &mut expected[..4],
            &overlay[..4],
            CaptionCompositeMode::Normal,
        );
        let mut actual = [40, 80, 120, 255, 1, 2, 3, 255];
        composite_normal_rgba_bgra(&mut actual, 8, 2, 1, &overlay).unwrap();

        assert_eq!(actual, expected);
    }

    /// 共享正文借来后：别处还持有就深拷，独占就原地拆出；两条路都叠 edits.json。
    #[cfg(feature = "host")]
    #[test]
    fn preview_document_from_shared_clones_only_when_shared() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path();
        std::fs::create_dir_all(project.join("studio")).unwrap();
        std::fs::write(
            project.join("studio/edits.json"),
            serde_json::to_vec(&json!({
                "edits": { "q1": { "text": { "base": "Hello", "value": "Edited" } } }
            }))
            .unwrap(),
        )
        .unwrap();
        let base = json!({
            "meta": { "duration": 3.0 },
            "cues": [ { "id": "q1", "start": 0.0, "end": 1.0, "text": "Hello" } ]
        });

        let shared = std::sync::Arc::new(base.clone());
        let keep = std::sync::Arc::clone(&shared);
        let edited = preview_document_from_shared(project, shared).unwrap();
        assert_eq!(
            edited["cues"][0]["text"], "Edited",
            "共享路径必须叠上 edits"
        );
        assert_eq!(keep["cues"][0]["text"], "Hello", "缓存里的那份不能被改写");

        let unique = std::sync::Arc::new(base);
        let edited = preview_document_from_shared(project, unique).unwrap();
        assert_eq!(
            edited["cues"][0]["text"], "Edited",
            "独占路径同样叠上 edits"
        );
    }

    /// 转录中的实时段（台账 #219 缺口 ①）：cue 流整份被换掉，译文轴清空，
    /// 但 `timeline` 原样留着——分离主轨的主视频住在元素层里，被顺手删掉
    /// 舞台就整片黑。
    #[test]
    fn live_cues_replace_the_cue_stream_and_keep_the_timeline() {
        let mut document = json!({
            "meta": { "duration": 30.0 },
            "cues": [ { "id": "q1", "start": 0.0, "end": 1.0, "text": "盘上的旧稿" } ],
            "sentences": [ { "id": "s1", "text": "盘上的旧稿" } ],
            "transCues": [ { "id": "t1", "start": 0.0, "end": 1.0, "text": "old" } ],
            "timeline": { "tracks": [] }
        });
        apply_live_cues(&mut document, &[(0.0, 1.5, "第一句"), (1.5, 3.0, "第二句")]);
        let cues = document["cues"].as_array().unwrap();
        assert_eq!(cues.len(), 2, "cue 流换成实时段");
        assert_eq!(cues[0]["text"], "第一句");
        assert_eq!(cues[0]["start"], 0.0);
        assert_eq!(cues[1]["end"], 3.0);
        assert_ne!(cues[0]["id"], cues[1]["id"], "id 必须互不相同");
        assert!(
            document["sentences"].as_array().unwrap().is_empty(),
            "实时段没有句子轴，旧稿的词 id 不能留下来"
        );
        assert!(
            document["transCues"].as_array().unwrap().is_empty(),
            "实时段没有译文轴"
        );
        assert!(
            document["timeline"].is_object(),
            "timeline 不能被动——主视频作为元素住在里面"
        );
    }

    /// 倒挂的段（识别器修订过 start 的边角）不能出负长度的 cue。
    #[test]
    fn live_cues_clamp_inverted_spans() {
        let mut document = json!({ "cues": [] });
        apply_live_cues(&mut document, &[(4.0, 2.0, "倒挂")]);
        assert_eq!(document["cues"][0]["start"], 4.0);
        assert_eq!(document["cues"][0]["end"], 4.0);
    }

    /// kinetic-wave 两条 cue：0–2s 带动效，2–4s 用逐条覆盖撤掉动效。
    #[cfg(feature = "host")]
    fn text_motion_split_document() -> Value {
        let design = crate::text_design::designs()
            .iter()
            .find(|design| design["id"] == "kinetic-wave")
            .expect("kinetic-wave design");
        let mut document = crate::text_design::demo_document(&design["style"], "Make every word");
        document["cues"] = json!([
            {"id": "moving", "start": 0.0, "end": 2.0, "text": "Make every word",
             "words": [
                {"id": "m0", "text": "Make", "t0": 0.0, "t1": 0.5},
                {"id": "m1", "text": "every", "t0": 0.6, "t1": 1.1},
                {"id": "m2", "text": "word", "t0": 1.2, "t1": 1.8}]},
            {"id": "plain", "start": 2.0, "end": 4.0, "text": "Plain line",
             "words": [
                {"id": "p0", "text": "Plain", "t0": 2.0, "t1": 2.8},
                {"id": "p1", "text": "line", "t0": 2.9, "t1": 3.8}]}
        ]);
        document["style"]["cueStyles"] = json!({
            "plain": {"source": {"textMotion": null, "wordBackground": null}}
        });
        document
    }

    #[cfg(feature = "host")]
    fn crop_rgba(rgba: &[u8], width: usize, rect: [f32; 4]) -> Vec<u8> {
        let [x, y, w, h] = rect.map(|value| value as usize);
        let mut out = Vec::with_capacity(w * h * 4);
        for row in y..y + h {
            out.extend_from_slice(&rgba[(row * width + x) * 4..(row * width + x + w) * 4]);
        }
        out
    }

    /// 分层文字动画按帧判：带动效的 cue 活动时字幕层报 `WordAnimation`，
    /// 另一条用逐条覆盖撤掉动效的 cue 照常出 glyph scene。整片 GPU 场景不再因此
    /// 判死——动效帧的字幕层是一张 CPU 光栅裁出的 1:1 纹理，逐字节就是
    /// `render_subtitle_frame` 那张图的子矩形，槽名在帧间保持稳定。
    #[cfg(feature = "host")]
    #[test]
    fn text_motion_subtitles_rasterize_into_a_texture_node_per_frame() {
        let document = text_motion_split_document();
        let mut plan = OverlayRenderPlan::compile(&document, 320, 180, 4.0, 30.0, None).unwrap();
        assert!(plan.has_text_motion());
        assert_eq!(plan.subtitle_scene_static_fallback(), None);
        assert_eq!(plan.subtitle_scene_static_fallback_with_backdrop(), None);
        plan.compositor_scene_support().unwrap();
        assert!(plan.text_motion_active_at(1.0));
        assert!(!plan.text_motion_active_at(3.0));
        assert_eq!(
            plan.subtitle_scene_frame(1.0).err(),
            Some(SubtitleSceneFallback::WordAnimation),
            "动效 cue 活动的帧仍要让 Web 回退字幕层"
        );
        let plain = plan
            .subtitle_scene_frame(3.0)
            .expect("撤掉动效的 cue 必须照常进 glyph scene");
        assert!(!plain.scene.nodes.is_empty());

        let mut slots = Vec::new();
        for time in [0.1, 1.0] {
            let scene = plan
                .compositor_scene_frame_with(time, SceneIdentity::Structural)
                .unwrap();
            let [element_draw::SceneNode::Texture(node)] = scene.nodes.as_slice() else {
                panic!("动效帧的字幕层必须是一张纹理节点：{:?}", scene.nodes.len())
            };
            assert!(node.texture.starts_with("subtitle-motion:"));
            assert_eq!(node.transform, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
            assert_eq!(
                (node.rect[2] as u32, node.rect[3] as u32),
                (node.source_width, node.source_height),
                "纹理必须 1:1 落在整数矩形上"
            );
            assert!(node.rect.iter().all(|value| value.fract() == 0.0));
            let next = scene.next_change.expect("动效帧必须声明下一帧边界");
            assert!(next > time && next <= time + 1.0 / 30.0 + 1e-9, "{next}");
            let texture = plan
                .compositor_texture_frame(&node.texture, node.media_ms)
                .unwrap();
            let reference = plan.render_subtitle_frame(time).unwrap();
            assert_eq!(
                texture.data(),
                crop_rgba(&reference.rgba, 320, node.rect).as_slice(),
                "纹理必须逐字节等于 CPU 字幕层的子矩形"
            );
            let [x, y, w, h] = node.rect.map(|value| value as usize);
            for (index, pixel) in reference.rgba.chunks_exact(4).enumerate() {
                let (px, py) = (index % 320, index / 320);
                if px < x || px >= x + w || py < y || py >= y + h {
                    assert_eq!(pixel[3], 0, "纹理窗外不得有字幕像素 ({px},{py})");
                }
            }
            slots.push(node.texture.clone());
        }
        assert_eq!(slots[0], slots[1], "字幕动效纹理槽必须跨帧稳定");

        let plain_scene = plan
            .compositor_scene_frame_with(3.0, SceneIdentity::Structural)
            .unwrap();
        assert!(!plain_scene.nodes.is_empty());
        assert!(
            plain_scene
                .nodes
                .iter()
                .all(|node| !matches!(node, element_draw::SceneNode::Texture(_))),
            "没有动效 cue 活动的帧走 glyph scene"
        );
    }

    /// 0–3 秒的文字元素，只有 0.6 秒 `rise` 入场（没有循环、没有退场）。
    #[cfg(feature = "host")]
    fn rise_title_plan() -> OverlayRenderPlan {
        let mut source = document("None", "none");
        source["cues"] = json!([]);
        source["timeline"] = json!({
            "tracks": [{"kind": "overlay", "elements": [{
                "id": "title", "kind": "text", "start": 0.0, "end": 3.0,
                "text": "Moving title",
                "place": {"x": 50, "y": 40},
                "style": {
                    "fontFamily": "Montserrat", "fontSize": 34, "fontColor": "#fefefe",
                    "textMotion": {"version": 1, "in": {"preset": "rise", "unit": "cue",
                        "durationSeconds": 0.6, "staggerSeconds": 0, "intensity": 0.8,
                        "easing": "easeOutQuad"}}
                }
            }]}]
        });
        let mut plan = OverlayRenderPlan::compile(&source, 320, 180, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(
            std::path::Path::new("/nonexistent/baocut-text-motion-element"),
            &source,
        )
        .unwrap();
        plan
    }

    /// 入场结束后的 hold 段完全静止：Structural 身份整段不变、`next_change` 直接
    /// 指到元素 end（没有退场），不逐帧重光栅 / 重传；入场中逐帧变。
    #[test]
    #[cfg(feature = "host")]
    fn text_motion_elements_hold_one_identity_while_still() {
        let mut plan = rise_title_plan();
        let mut frame = |time: f64| {
            let scene = plan
                .compositor_scene_frame_with(time, SceneIdentity::Structural)
                .unwrap();
            let [element_draw::SceneNode::Texture(node)] = scene.nodes.as_slice() else {
                panic!("文字动效元素必须是一张纹理节点")
            };
            let texture = plan
                .compositor_texture_frame(&node.texture, node.media_ms)
                .unwrap()
                .data()
                .to_vec();
            (scene.fingerprint, scene.next_change, texture)
        };
        let (moving_a, next_a, _) = frame(0.1);
        let (moving_b, _, _) = frame(0.3);
        assert_ne!(moving_a, moving_b, "入场中逐帧是不同的身份");
        assert!(next_a.is_some_and(|next| next <= 0.1 + 1.0 / 30.0 + 1e-9));
        let (still_a, next_still_a, pixels_a) = frame(1.0);
        let (still_b, next_still_b, pixels_b) = frame(2.0);
        assert_eq!(still_a, still_b, "静止段整段同一个 Structural 身份");
        assert_eq!(pixels_a, pixels_b, "同一身份必须真是同一张图");
        for next in [next_still_a, next_still_b] {
            let next = next.expect("静止段仍要给出元素 end");
            assert!((next - 3.0).abs() < 1e-9, "静止段直接跳到 end：{next}");
        }
    }

    /// `bcut element style --patch` 能把 `textMotion` 写进文字元素：这一件在 GPU
    /// 场景里同样是元素位置上的一张 CPU 光栅纹理，动的帧逐帧重建、静止段跳到下一个边界。
    #[cfg(feature = "host")]
    #[test]
    fn text_elements_with_text_motion_become_texture_nodes() {
        let mut plan = rise_title_plan();
        let mut pixels = Vec::new();
        for time in [0.1, 1.5] {
            let scene = plan
                .compositor_scene_frame_with(time, SceneIdentity::Full)
                .unwrap();
            let [element_draw::SceneNode::Texture(node)] = scene.nodes.as_slice() else {
                panic!("文字动效元素必须是一张纹理节点")
            };
            assert_eq!(node.texture, "text-motion:title");
            let next = scene.next_change.expect("文字动效元素必须给出下一个边界");
            if time < 0.6 {
                assert!(next > time && next <= time + 1.0 / 30.0 + 1e-9, "{next}");
            } else {
                assert!(
                    (next - 3.0).abs() < 1e-9,
                    "落定后没有退场，直接跳到 end：{next}"
                );
            }
            let texture = plan
                .compositor_texture_frame(&node.texture, node.media_ms)
                .unwrap();
            let element = plan.elements[0].clone();
            let reference = plan.render_text_element(&element, time).unwrap();
            assert_eq!(
                texture.data(),
                crop_rgba(reference.data(), 320, node.rect).as_slice()
            );
            pixels.push(reference.data().to_vec());
        }
        assert_ne!(pixels[0], pixels[1], "入场中与落定后必须是两张图");
    }
}
