//! 画廊「动态排版」卡的真跑小样：三句样例词序列过同一条
//! [`compile_caption_sequence`] / [`CaptionSequencePlan::sample`]，用真字形画出来。
//! 缩略图与舞台是同一套排版 / 镜头，卡上看到的就是套上去会得到的。
use render_raster::fonts::TextEngine;
use tiny_skia::{FillRule, Pixmap, Transform};

use crate::{
    CAPTION_SEQUENCE_DEFAULT_SEED, CaptionSequenceCue, CaptionSequenceEnv, CaptionSequenceInput,
    CaptionSequenceOptions, CaptionSequencePlan, OverlayRenderPlan, SeqRole, Word,
    caption_sequence_layout_tokens, compile_caption_sequence, paint, parse_css_color,
};

/// 小样一圈的时长（秒）：三句念完再留一拍看总览。
pub const LOOP_SECONDS: f64 = 6.4;
/// 静止小样取这一刻（第二句念到一半，镜头刚落定）。
pub const STILL_SECONDS: f64 = 2.4;

const FONT: &str = "Arial";
const WEIGHT: u16 = 700;

/// 三句样例（词级时间），`beat` 是主角词。
fn demo_cues() -> (Vec<CaptionSequenceCue>, Vec<(String, SeqRole)>) {
    let script: [(&str, &[(&str, f64, f64)]); 3] = [
        (
            "c1",
            &[
                ("Make", 0.20, 0.50),
                ("every", 0.50, 0.90),
                ("word", 0.90, 1.35),
            ],
        ),
        (
            "c2",
            &[
                ("land", 1.70, 2.05),
                ("on", 2.05, 2.30),
                ("the", 2.30, 2.55),
                ("beat", 2.55, 3.10),
            ],
        ),
        ("c3", &[("Daoyazi", 3.50, 4.20), ("captions", 4.20, 4.90)]),
    ];
    let mut roles = Vec::new();
    let cues = script
        .iter()
        .map(|(id, words)| {
            let words: Vec<Word> = words
                .iter()
                .enumerate()
                .map(|(index, (text, start, end))| {
                    let word_id = format!("{id}-w{index}");
                    if *text == "beat" {
                        roles.push((word_id.clone(), SeqRole::Hero));
                    }
                    Word {
                        id: word_id,
                        text: (*text).to_owned(),
                        start: *start,
                        end: *end,
                    }
                })
                .collect();
            CaptionSequenceCue {
                id: (*id).to_owned(),
                start: words.first().map_or(0.0, |w| w.start),
                end: words.last().map_or(0.0, |w| w.end),
                speaker: None,
                break_before: false,
                words,
            }
        })
        .collect();
    (cues, roles)
}

/// 编译小样计划（画布 `width × height`，`seed` 与卡片 / 样式同一个种子）。
pub fn plan(text: &mut TextEngine, width: u32, height: u32, seed: u64) -> CaptionSequencePlan {
    let (cues, roles) = demo_cues();
    let input = CaptionSequenceInput {
        cues,
        roles: roles.into_iter().collect(),
        duration: LOOP_SECONDS,
        pins: Default::default(),
        seq_seeds: Default::default(),
    };
    let mut options = CaptionSequenceOptions::from_value(None);
    options.history_blocks = 8;
    let env = CaptionSequenceEnv {
        width,
        height,
        font_px: (f64::from(height) * 0.16).clamp(10.0, 24.0),
        bilingual: false,
        seed,
        intensity: 60.0,
        speed: 1.0,
        tokens: caption_sequence_layout_tokens(width, height),
        options,
    };
    let mut measure = |sample: &str, px: f64| text.shape(sample, FONT, px, WEIGHT).width;
    compile_caption_sequence(&input, &env, &mut measure)
}

/// 画 `seconds` 那一帧。`palette` 是 `[primary, accent, secondary, background]` 的 CSS 色。
pub fn render(
    text: &mut TextEngine,
    plan: &CaptionSequencePlan,
    seconds: f64,
    width: u32,
    height: u32,
    palette: [&str; 4],
) -> Option<Pixmap> {
    let colors = [
        parse_css_color(palette[0])?,
        parse_css_color(palette[1])?,
        parse_css_color(palette[2])?,
    ];
    let background = parse_css_color(palette[3])?;
    let mut image = Pixmap::new(width, height)?;
    image.fill(tiny_skia::Color::from_rgba8(
        background.r,
        background.g,
        background.b,
        255,
    ));
    let frame = plan.sample(seconds.rem_euclid(LOOP_SECONDS));
    let Some(camera) = frame.camera else {
        return Some(image);
    };
    let camera_transform = plan.camera_transform(&camera);
    for (sequence_index, block_index, states, alpha) in
        OverlayRenderPlan::caption_sequence_draw_list(plan, &frame)
    {
        let block = &plan.sequences[sequence_index].blocks[block_index];
        let block_transform = block.transform().post_concat(camera_transform);
        for (word, state) in block.words.iter().zip(&states) {
            let opacity = alpha * state.opacity;
            if opacity <= 0.001 {
                continue;
            }
            let color =
                OverlayRenderPlan::caption_sequence_word_color(colors, block.tone, word, state);
            let fill = paint(color, opacity);
            let shaped = text.shape(&word.text, FONT, word.font, WEIGHT);
            let baseline =
                word.y + (word.h - (shaped.ascent + shaped.descent)) / 2.0 + shaped.ascent;
            let word_transform = word
                .pop_transform(state.scale, state.pivot_x)
                .post_concat(block_transform);
            for glyph in &shaped.glyphs {
                let Some(path) = text.glyph_path(glyph.cache_key) else {
                    continue;
                };
                let local = Transform::from_translate(
                    (word.x + glyph.x) as f32,
                    (baseline + glyph.y) as f32,
                )
                .post_concat(word_transform);
                image.fill_path(&path, &fill, FillRule::Winding, local, None);
            }
        }
    }
    Some(image)
}

/// 默认种子（与画廊卡 / 描述符同一个）。
pub fn default_seed() -> u64 {
    CAPTION_SEQUENCE_DEFAULT_SEED
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_plan_covers_the_three_sample_cues_and_renders_ink() {
        let mut text = TextEngine::new();
        let plan = plan(&mut text, 176, 96, default_seed());
        let blocks: usize = plan.sequences.iter().map(|s| s.blocks.len()).sum();
        assert!(blocks >= 3, "样例至少三行，得到 {blocks}");
        let image = render(
            &mut text,
            &plan,
            STILL_SECONDS,
            176,
            96,
            ["#ffffff", "#ff9b42", "#59baf2", "#101418"],
        )
        .expect("render");
        let background = image.data()[..4].to_vec();
        let ink = image
            .data()
            .chunks(4)
            .filter(|px| px[..3] != background[..3])
            .count();
        assert!(ink > 50, "小样应当画出字，只有 {ink} 个非底色像素");
    }
}
