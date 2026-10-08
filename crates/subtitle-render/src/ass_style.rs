//! 从工程扁平样式 blob 合成 ASS `[V4+ Styles]` 头。
//!
//! 与 MP4 烧录同源：字号、颜色、描边、底板全部走 [`resolve_line_style`]，因此
//! `origStyle` / `transStyle` 行级 partial 与双语字号比例语义自动生效，不在这里
//! 重新实现一遍。这个文件只负责「把 [`LineStyle`] 翻译成 ASS 字段」。
//!
//! ## 单位换算
//!
//! - **描边**：工程里的 `textOutline.width` 是「可见外扩量」占字号的百分比。
//!   [`LineStyle::outline_width`] 存的是跨轮廓居中的整条线宽（`w/100·fontSize·0.5`），
//!   而 ASS 的 `Outline` 是向外生长的边框厚度，所以这里取它的一半，等价于
//!   `w/400·fontSize`。三个数不是一回事，改任何一处前先确认自己在说哪一个。
//!
//! ## 无法 1:1 映射的字段（近似规则）
//!
//! ASS 的样式模型比 BaoCut 的字幕样式弱，下列语义只能近似或直接丢弃。改这里前
//! 先同步 `docs/design/cli/bcut-cli-server-reference.md` 的同名说明。
//!
//! - **水平位置 `x`**：ASS 只有九宫格 Alignment，没有百分比锚点。`x` 只用来选左
//!   /中/右（`<33.3` 左、`>66.7` 右，其余居中），精确百分比丢失。
//! - **`width`（换行宽度）**：折成左右对称的 `MarginL`/`MarginR`。锚点不在画面中
//!   央时，这组对称边距与真实摆放会有偏移。
//! - **垂直位置 `y` + `verticalAlign`**：统一折算成「底对齐 + `MarginV`」。文本块
//!   高度按 `fontSize × lineHeight`（双语再加 `gap`）估算，不做真实排版度量，所以
//!   与烧录会有半行级误差。`verticalAlign` 缺席时按 `center` 近似——真实渲染此时
//!   走接缝规则，两者并不等价。
//! - **行级 `origStyle.x/y` / `verticalAlign`（脱离堆栈的行）**：完全忽略。ASS 的
//!   两个 Style 共享同一组 Alignment/Margin，无法各自摆放。
//! - **`order`（译文在上）**：不生效。sidecar 字幕的正文一直是「原文行在前」，这
//!   是 srt/vtt 既有行为，ASS 沿用。
//! - **`rotation`**：写进 `Angle`，符号取反（ASS 逆时针为正）。转场动画不导出。
//! - **`textTransform`**：不生效。正文文本由 sidecar 共用投影产出，不做大小写变换。
//! - **`glow` / `dropShadow.blur`**：ASS 没有模糊半径字段。发光/阴影只保留颜色与
//!   偏移量（发光偏移为 0，等价于关阴影），模糊丢失。
//! - **底板纵向内边距**：`BorderStyle=3` 只有一个 `Outline` 字段当内边距，这里取
//!   横向 `background_pad_h`，纵向内边距丢失。
//! - **`backgroundMode: "shared"`（共享底板）**：ASS 每行自带底板，无法共享一块。
//!
//! v3：移植自 BaoCut v2 `bcut-kernel` 的 `cmd/studio_export/ass_style.rs`（那里经 `include!` 进
//! `studio_export`，与本 crate 的扁平命名空间共用名字）。两个样式名、[`AssStyleSheet`]、
//! `--no-style` 的固定头与两行 `Format:` 已在 `speech-doc`（字幕导出用它们），这里从那边取，
//! 不再定义第二份；读工程文件的 `ass_play_res` / `ass_play_res_from_manifest` 不移植，画幅由
//! 调用方传入。

use serde_json::Value;
use speech_doc::export::ass_style::{ASS_EVENT_FORMAT, ASS_STYLE_FORMAT};
pub use speech_doc::export::{ASS_PRIMARY_STYLE, ASS_TRANSLATION_STYLE, AssStyleSheet};

use crate::{
    LineKind, LineStyle, REFERENCE_SHORT_EDGE, StudioMode, SubtitleColor, VerticalAlign, clamp,
    finite, parse_vertical_align, resolve_line_style,
};

/// ASS 数值字段：整数不带小数点，其余保留一位，避免头里出现 `2.0000000001`。
fn ass_number(value: f64) -> String {
    let value = if value.is_finite() { value } else { 0.0 };
    let rounded = (value * 10.0).round() / 10.0;
    if (rounded - rounded.round()).abs() < f64::EPSILON {
        format!("{}", rounded.round() as i64)
    } else {
        format!("{rounded:.1}")
    }
}

/// `&HAABBGGRR`。[`SubtitleColor::a`] 存的就是 ASS 语义的「透明度」
/// （`0` 不透明、`255` 全透明），这里直接落位，不做取反。
fn ass_color(color: SubtitleColor) -> String {
    format!(
        "&H{:02X}{:02X}{:02X}{:02X}",
        color.a, color.b, color.g, color.r
    )
}

/// 样式名里的逗号会撕开 `Style:` 行；同时挡掉换行与 ASS 覆盖标签定界符。
fn ass_font_field(name: &str) -> String {
    name.replace(',', " ")
        .replace(['\r', '\n', '{', '}'], "")
        .trim()
        .to_owned()
}

/// sidecar 的字体名要给外部播放器看，因此把 [`font_name`] 为 MP4 shaping 做的
/// SwiftPM 内部 family 映射回用户可见的产品名；其余别名（system / montserrat …）
/// 与烧录共用同一张表，不在这里重写。
fn ass_font_name(shaped: &str) -> String {
    let product = match shaped {
        "VK Sans" => "Source Sans 3",
        "VK Code" => "Source Code Pro",
        other => other,
    };
    ass_font_field(product)
}

/// 单行文本块的估算高度：`fontSize × lineHeight`。不做真实排版度量。
fn line_block_height(style: &LineStyle) -> f64 {
    style.font_size * style.line_height
}

/// 一条 `Style:` 行。
#[allow(clippy::too_many_arguments)]
fn ass_style_row(
    name: &str,
    style: &LineStyle,
    alignment: u8,
    margin_l: i64,
    margin_r: i64,
    margin_v: i64,
    angle: f64,
) -> String {
    // 有底板 → BorderStyle=3（不透明块）：此时 OutlineColour 是块颜色，
    // Outline 字段是块的内边距；没底板 → BorderStyle=1（描边+阴影）。
    let border_style = if style.background_on { 3 } else { 1 };
    let outline_colour = if style.background_on {
        style.background_color
    } else {
        style.outline_color
    };
    let outline = if style.background_on {
        style.background_pad_h
    } else if style.outline_on {
        // libass / VSFilter 的 `Outline` 是**向外生长**的边框厚度，而
        // [`LineStyle::outline_width`] 存的是跨轮廓居中的整条线宽，外扩量只有一半。
        // 直接落位会让播放器画出两倍粗的描边（= 持久化 `textOutline.width` 的
        // `w/100·fontSize`，而不是正确的 `w/400·fontSize`）。
        style.outline_width / 2.0
    } else {
        0.0
    };
    let shadow = if style.effect_on {
        style.effect_x.hypot(style.effect_y)
    } else {
        0.0
    };
    let back_colour = if style.effect_on {
        style.effect_color
    } else {
        SubtitleColor {
            r: 0,
            g: 0,
            b: 0,
            a: 255,
        }
    };
    let flag = |on: bool| if on { -1 } else { 0 };
    format!(
        "Style: {name},{font},{size},{primary},{secondary},{outline_colour},{back_colour},\
{bold},{italic},{underline},0,100,100,{spacing},{angle},{border_style},{outline},{shadow},\
{alignment},{margin_l},{margin_r},{margin_v},1",
        font = ass_font_name(&style.font_name),
        size = ass_number(style.font_size.max(1.0).round()),
        primary = ass_color(style.color),
        // 卡拉 OK 未播报色：sidecar 不做逐词高亮，与主色保持一致。
        secondary = ass_color(style.color),
        outline_colour = ass_color(outline_colour),
        back_colour = ass_color(back_colour),
        bold = flag(style.bold),
        italic = flag(style.italic),
        underline = flag(style.underline),
        spacing = ass_number(style.letter_spacing),
        angle = ass_number(angle),
        outline = ass_number(outline),
        shadow = ass_number(shadow),
    )
}

/// 从扁平样式 blob 合成完整 ASS 头。
///
/// `mode` 取 `orig` / `trans` / `bi`（同 `StudioMode::parse`），无法识别时退回
/// `orig`——sidecar 的内容模式由 `--mode` 决定，不能因为样式里存着别的模式串就
/// 换一套字号。
pub fn ass_style_sheet(style_root: &Value, mode: &str, play_res: (u32, u32)) -> AssStyleSheet {
    let (width, height) = play_res;
    let mode = StudioMode::parse(mode).unwrap_or(StudioMode::Original);
    let bilingual = mode == StudioMode::Bilingual;
    let original = resolve_line_style(style_root, LineKind::Original, width, height, bilingual);
    let translation =
        resolve_line_style(style_root, LineKind::Translation, width, height, bilingual);
    // Dialogue 声明的主样式：单语译文导出只有译文行，主样式就该是译文样式。
    let primary = match mode {
        StudioMode::Translated => &translation,
        StudioMode::Original | StudioMode::Bilingual => &original,
    };

    let canvas_scale = (f64::from(width.min(height)) / REFERENCE_SHORT_EDGE)
        * finite(style_root.get("scale"), 1.0).max(0.05);
    let gap = finite(style_root.get("gap"), 6.0).max(0.0) * canvas_scale;
    let block_height = if bilingual {
        line_block_height(&original) + gap + line_block_height(&translation)
    } else {
        line_block_height(primary)
    };
    // 锚线：`y` 是文本块锚点的画面百分比。折算成「块底边到画面底边的距离」，
    // 这样无论字幕在顶部还是底部，都能用底对齐 + MarginV 表达。
    let anchor = f64::from(height) * finite(style_root.get("y"), 86.0) / 100.0;
    let block_bottom = match parse_vertical_align(style_root.get("verticalAlign")) {
        Some(VerticalAlign::Top) => anchor + block_height,
        Some(VerticalAlign::Bottom) => anchor,
        Some(VerticalAlign::Center) | None => anchor + block_height / 2.0,
    };
    let margin_v = clamp(f64::from(height) - block_bottom, 0.0, f64::from(height)).round() as i64;
    let x = finite(style_root.get("x"), 50.0);
    // 底对齐三格：1 左 / 2 中 / 3 右。
    let alignment = if x < 33.3 {
        1
    } else if x > 66.7 {
        3
    } else {
        2
    };
    let side = (f64::from(width)
        * (100.0 - clamp(finite(style_root.get("width"), 80.0), 5.0, 100.0))
        / 200.0)
        .round()
        .max(0.0) as i64;
    // 屏幕坐标顺时针为正，ASS `Angle` 逆时针为正。
    let angle = -finite(style_root.get("rotation"), 0.0);

    let mut styles = vec![ass_style_row(
        ASS_PRIMARY_STYLE,
        primary,
        alignment,
        side,
        side,
        margin_v,
        angle,
    )];
    if bilingual {
        styles.push(ass_style_row(
            ASS_TRANSLATION_STYLE,
            &translation,
            alignment,
            side,
            side,
            margin_v,
            angle,
        ));
    }
    let header = format!(
        "[Script Info]\nTitle: BaoCut\nScriptType: v4.00+\nWrapStyle: 0\n\
ScaledBorderAndShadow: yes\nPlayResX: {width}\nPlayResY: {height}\n\n\
[V4+ Styles]\n{ASS_STYLE_FORMAT}\n{styles}\n\n[Events]\n{ASS_EVENT_FORMAT}\n",
        styles = styles.join("\n"),
    );
    AssStyleSheet {
        header,
        translation_style: bilingual.then(|| ASS_TRANSLATION_STYLE.to_owned()),
    }
}

// v3：两条测试原样取自 v2 `bcut-kernel` 的 `cmd/studio_export/tests.rs`（描边口径）与
// `cmd/media/tests.rs`（双语缺译）。夹具 helper（`document`、`word_doc`）是 JSON / 行字面量，
// 照 v2 的做法就地各留一份。
#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::json;
    use speech_doc::asr_rows::RowIn;
    use speech_doc::build::build_doc;
    use speech_doc::cue::{CueParams, derive_cues};
    use speech_doc::doc::{DocEngine, DocMedia, TranscriptDoc};
    use speech_doc::export::{
        ExportMode, SubtitleFlavor, SubtitleRenderOptions, build_subtitle_events,
        render_subtitle_events,
    };
    use speech_doc::sentence::derive_sentences;
    use speech_doc::split::derive_trans_cues;

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

    fn word_doc() -> TranscriptDoc {
        let mut row_a = RowIn::new(1.23, 5.0, "hello there");
        row_a.speaker = Some("S01".to_owned());
        let mut row_b = RowIn::new(6.0, 65.5, "goodbye now");
        row_b.speaker = Some("S02".to_owned());
        build_doc(
            &[row_a, row_b],
            DocMedia {
                id: None,
                path: Some("sample.wav".to_owned()),
                hash: "sha256-00".to_owned(),
                duration: 65.5,
                sample_rate: Some(16_000),
            },
            "en",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
        )
    }

    /// 描边宽度的口径闭环。持久化的 `textOutline.width` 是「可见外扩量」占字号的
    /// 百分比（Mac `StagePaneView` 的 `.strokeWidth = -width * 0.5`），所以：
    ///
    /// - [`LineStyle::outline_width`]（tiny-skia 居中描边的整条线宽）= `w/200 × fontSize`
    /// - ASS `Outline`（向外生长厚度）= 它的一半 = `w/400 × fontSize`
    ///
    /// 曾经两处都少乘一个 0.5，烧录与 sidecar 的描边比预览粗一倍。
    #[test]
    fn outline_width_is_the_centred_line_width_and_ass_takes_half_of_it() {
        let mut style = document("None", "none")["style"].clone();
        style["textOutline"] = json!({"color": "#000000", "width": 15, "on": true});
        // 底板开着会让 ASS 走 BorderStyle=3，`Outline` 字段变成块内边距。
        style["background"] = json!(false);

        // 1080p ⇒ canvas_scale = 1080/540 = 2；fontSize 30 ⇒ 60px。
        let line = resolve_line_style(&style, LineKind::Original, 1920, 1080, false);
        assert!((line.font_size - 60.0).abs() < 1e-9);
        assert!(line.outline_on);
        assert!(
            (line.outline_width - 4.5).abs() < 1e-9,
            "15/200 × 60 = 4.5，实际 {}",
            line.outline_width
        );

        let header = ass_style_sheet(&style, "orig", (1920, 1080)).header;
        let row = header
            .lines()
            .find(|line| line.starts_with("Style: BaoCut,"))
            .expect("必须有主样式行");
        // Format 第 17 个字段（0 起算 16）是 Outline。
        let outline = row
            .trim_start_matches("Style: ")
            .split(',')
            .nth(16)
            .expect("Outline 字段");
        assert_eq!(
            outline, "2.3",
            "15/400 × 60 = 2.25，写头时保留一位；行={row}"
        );
    }

    /// ASS 双语是「一条 Dialogue 两行」，缺译时那条事件只剩原文一行：
    /// 正文里没有 `\N`，也就不该出现切到译文样式的 `{\r...}` 标签。
    #[test]
    fn ass_bilingual_missing_translation_stays_a_single_primary_line() {
        let mut doc = word_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sentences[0].id.clone(), "你好".to_owned());
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        let mut missing = 0;
        let events = build_subtitle_events(
            &doc,
            &cues,
            &sentences,
            &stream,
            ExportMode::Bilingual,
            Some("zh"),
            true,
            &mut missing,
        );
        let ass = ass_style_sheet(&json!({}), "bi", (1920, 1080));
        let translation_style = ass.translation_style.clone();
        assert!(translation_style.is_some(), "双语头必须带译文样式");
        let rendered = render_subtitle_events(
            &doc,
            &events,
            SubtitleFlavor::Ass,
            &SubtitleRenderOptions {
                speakers: true,
                ass,
                ..SubtitleRenderOptions::default()
            },
        );
        assert_eq!(missing, 1);
        let dialogues: Vec<&str> = rendered
            .lines()
            .filter(|line| line.starts_with("Dialogue:"))
            .collect();
        assert_eq!(dialogues.len(), 2, "{rendered}");
        assert!(dialogues[0].contains("hello there\\N"), "{rendered}");
        // 缺译那条：单行原文，没有换行也没有译文样式切换。
        let missing_line = dialogues[1];
        assert!(missing_line.contains("goodbye now"), "{rendered}");
        assert!(!missing_line.contains("\\N"), "{rendered}");
        if let Some(style) = translation_style.as_deref() {
            assert!(!missing_line.contains(style), "{rendered}");
        }
    }
}
