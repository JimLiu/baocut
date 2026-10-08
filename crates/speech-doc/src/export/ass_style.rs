//! ASS 软字幕头：主样式名、双语译文样式名与 `--no-style` 的固定头。
//!
//! 移植自 BaoCut v2 `bcut-kernel` 的 `cmd/studio_export/ass_style.rs`。从工程样式合成
//! `[V4+ Styles]` 的 `ass_style_sheet` 及其换算（`ass_style_row`、`ass_number`、
//! `ass_color`、`ass_font_*`、`line_block_height`）依赖字幕渲染内核的
//! `LineStyle` / `resolve_line_style`，在 `subtitle-render` 的 `ass_style`（本 crate 不依赖渲染）；
//! 读画幅的 `ass_play_res*` 读工程文件，不移植。两行 `Format:` 两边共用，所以是 `pub`。

/// Dialogue 声明的主样式名。历史产物一直叫 `BaoCut`，保持不变。
pub const ASS_PRIMARY_STYLE: &str = "BaoCut";
/// 双语第二行（译文）的样式名，靠行内 `{\r}` 切换。
pub const ASS_TRANSLATION_STYLE: &str = "BaoCutTrans";

/// ASS 头 + 双语第二行要切换到的样式名。
#[derive(Debug, Clone)]
pub struct AssStyleSheet {
    pub header: String,
    /// `Some` 时，双语正文的第二行前会插入 `{\r<name>}`。
    pub translation_style: Option<String>,
}

pub const ASS_STYLE_FORMAT: &str = "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";
pub const ASS_EVENT_FORMAT: &str =
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";

impl AssStyleSheet {
    /// `--no-style` 的逃生舱：VoiceInk 时代的固定头，与 1.x 产物逐字节一致。
    pub fn legacy() -> Self {
        Self {
            header: format!(
                "[Script Info]\nTitle: BaoCut\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n\
[V4+ Styles]\n{ASS_STYLE_FORMAT}\n\
Style: BaoCut,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,30,30,40,1\n\n\
[Events]\n{ASS_EVENT_FORMAT}\n"
            ),
            translation_style: None,
        }
    }
}
