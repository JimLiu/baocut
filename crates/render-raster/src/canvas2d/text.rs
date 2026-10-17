//! Canvas 文字 → 字形轮廓路径。
//!
//! 录制端已经把 `fillText` / `strokeText` 归一成「左对齐 + alphabetic 基线」，并记下 Chromium 量出的宽度。
//! 这里用 rustybuzz 按文字体系分段整形（与 Blink 一样，标点、数字、空格并入相邻的段），把字形轮廓拼成
//! 一条用户空间的路径；整形宽度与 Chromium 的宽度对不上、缺字形、彩色字形时判为不支持，由调用方整段回退。
//!
//! 中日韩相邻标点按 Chromium 的 `text-spacing-trim: normal` 挤压（Blink 的 `HanKerning`）：整段开 `chws`，
//! 字体有 `halt` 时再给该挤的字单独开 `halt`（如「》（」里的「（」少半个字宽）。
//!
//! 合成斜体按 Skia 的做法还原成 −1/4 的水平错切。合成粗体（请求 ≥ 600，而 `@font-face` 声明的范围与字体
//! 文件自己的粗细都 < 600）判为不支持：Chromium 的加粗量随平台的字体栈而变（macOS 实测 68px 约为 Skia
//! 通用公式的一半、20px 几乎不加粗），没有一份跨平台一致的做法可以对齐。

use super::path::Seg;
use rustybuzz::ttf_parser::{GlyphId, OutlineBuilder, Tag};
use rustybuzz::{Direction, Face, Feature, Script, UnicodeBuffer, script};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use unicode_properties::{GeneralCategory, UnicodeGeneralCategory};

pub struct Font {
    face: Face<'static>,
    upem: f64,
    /// `@font-face` 声明的粗细范围上限与样式（CSS 匹配用的描述，不是字体文件自己的）。
    declared_weight_max: f64,
    declared_italic: bool,
    han: Option<HanKerning>,
    outlines: RwLock<HashMap<u16, Arc<Vec<Seg>>>>,
}

#[derive(Default)]
struct Outline(Vec<Seg>);

impl OutlineBuilder for Outline {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.push(Seg::Move(x.into(), y.into()));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.push(Seg::Line(x.into(), y.into()));
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.0
            .push(Seg::Quad(x1.into(), y1.into(), x.into(), y.into()));
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.0.push(Seg::Cubic(
            x1.into(),
            y1.into(),
            x2.into(),
            y2.into(),
            x.into(),
            y.into(),
        ));
    }
    fn close(&mut self) {
        self.0.push(Seg::Close);
    }
}

/// 字符的文字体系：`None` = Common（并入相邻的段），`Err` = 不支持的体系。
fn script_of(c: char) -> Result<Option<Script>, ()> {
    if !c.is_alphabetic() {
        return Ok(None);
    }
    Ok(Some(match c as u32 {
        0x0041..=0x024F
        | 0x1E00..=0x1EFF
        | 0x2C60..=0x2C7F
        | 0xA720..=0xA7FF
        | 0xFF21..=0xFF3A
        | 0xFF41..=0xFF5A => script::LATIN,
        0x0370..=0x03FF | 0x1F00..=0x1FFF => script::GREEK,
        0x0400..=0x052F => script::CYRILLIC,
        0x3040..=0x309F => script::HIRAGANA,
        0x30A0..=0x30FF | 0x31F0..=0x31FF | 0xFF66..=0xFF9F => script::KATAKANA,
        0x1100..=0x11FF | 0x3130..=0x318F | 0xAC00..=0xD7AF => script::HANGUL,
        0x2E80..=0x2FDF
        | 0x3005..=0x3007
        | 0x3021..=0x3029
        | 0x3038..=0x303B
        | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF
        | 0xF900..=0xFAFF
        | 0x20000..=0x3FFFF => script::HAN,
        _ => return Err(()),
    }))
}

/// 按文字体系切段：`(段文字, 体系)`。
fn runs(text: &str) -> Result<Vec<(String, Script)>, String> {
    let mut out: Vec<(String, Option<Script>)> = Vec::new();
    for c in text.chars() {
        let kind = script_of(c).map_err(|_| format!("text-script: U+{:04X}", c as u32))?;
        match (out.last_mut(), kind) {
            (Some((run, _)), None) => run.push(c),
            (Some((run, current @ None)), Some(s)) => {
                run.push(c);
                *current = Some(s);
            }
            (Some((run, Some(current))), Some(s)) if *current == s => run.push(c),
            _ => out.push((c.to_string(), kind)),
        }
    }
    Ok(out
        .into_iter()
        .map(|(run, s)| (run, s.unwrap_or(script::COMMON)))
        .collect())
}

/// 相邻标点挤压的字符类（Blink `HanKerningCharType`，CSS Text 4 的 Text Spacing Character Classes）。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kern {
    Other,
    Open,
    Close,
    Middle,
    /// 不是全角的 Ps / Pe（如 ASCII 括号）。
    OpenNarrow,
    CloseNarrow,
}

/// 与字体无关的分类；句读、冒号、分号与弯引号要看字体里字形的位置。
enum Class {
    Fixed(Kern),
    Dot,
    Colon,
    Semicolon,
    OpenQuote,
    CloseQuote,
}

fn class_of(c: char) -> Class {
    match c {
        '\u{2018}' | '\u{201C}' => Class::OpenQuote,
        '\u{2019}' | '\u{201D}' => Class::CloseQuote,
        '\u{3000}' | '\u{00B7}' | '\u{2027}' | '\u{30FB}' => Class::Fixed(Kern::Middle),
        '\u{3001}' | '\u{3002}' | '\u{FF0C}' | '\u{FF0E}' => Class::Dot,
        '\u{FF1A}' => Class::Colon,
        '\u{FF1B}' => Class::Semicolon,
        _ => {
            // CJK Symbols and Punctuation 区块或东亚全角（ea=F）里的 Ps / Pe 是全角开闭标点，其余的是窄的。
            let wide = matches!(c as u32, 0x3000..=0x303F | 0xFF01..=0xFF60 | 0xFFE0..=0xFFE6);
            Class::Fixed(match (c.general_category(), wide) {
                (GeneralCategory::OpenPunctuation, true) => Kern::Open,
                (GeneralCategory::OpenPunctuation, false) => Kern::OpenNarrow,
                (GeneralCategory::ClosePunctuation, true) => Kern::Close,
                (GeneralCategory::ClosePunctuation, false) => Kern::CloseNarrow,
                _ => Kern::Other,
            })
        }
    }
}

/// 后一个字（`kind`）挤掉起点的半个字宽（Blink `ShouldKern`）。
fn kern_start(kind: Kern, last: Kern) -> bool {
    kind == Kern::Open
        && matches!(
            last,
            Kern::Open | Kern::Middle | Kern::Close | Kern::OpenNarrow
        )
}

/// 前一个字（`last`）挤掉终点的半个字宽（Blink `ShouldKernLast`）。
fn kern_end(kind: Kern, last: Kern) -> bool {
    last == Kern::Close && matches!(kind, Kern::Close | Kern::Middle | Kern::CloseNarrow)
}

/// 探测用的一个字形：前进量与相对字形原点的水平墨迹范围（字体单位）。
struct Probe {
    glyph: u32,
    advance: i32,
    left: f64,
    right: f64,
}

/// 由墨迹落在全宽的哪一半判类（Blink `CharTypeFromBounds`，横排）。
fn kind_from_bounds(half: f64, probe: &Probe) -> Kern {
    if probe.right <= half {
        Kern::Close
    } else if probe.left >= half {
        Kern::Open
    } else if probe.right - probe.left <= half && probe.left >= half / 2.0 {
        Kern::Middle
    } else {
        Kern::Other
    }
}

/// 一组字形同宽同类时取该类，否则 `Other`；缺字形的跳过。
fn group_kind(probes: &[Probe]) -> Kern {
    let mut glyphs = probes.iter().filter(|p| p.glyph != 0);
    let Some(first) = glyphs.next() else {
        return Kern::Other;
    };
    let half = f64::from(first.advance) / 2.0;
    let kind = kind_from_bounds(half, first);
    if glyphs.all(|p| p.advance == first.advance && kind_from_bounds(half, p) == kind) {
        kind
    } else {
        Kern::Other
    }
}

/// 字体侧的挤压数据（Blink `HanKerning::FontData`）；字体没有 `halt` 或探测不通过时整个为 None。
struct HanKerning {
    chws: bool,
    dot: Kern,
    colon: Kern,
    semicolon: Kern,
    quote_fullwidth: bool,
}

impl HanKerning {
    fn probe(face: &Face) -> Option<HanKerning> {
        let tables = face.tables();
        let has = |tag: &[u8; 4]| {
            let tag = Tag::from_bytes(tag);
            [tables.gsub, tables.gpos]
                .into_iter()
                .flatten()
                .any(|table| table.features.into_iter().any(|f| f.tag == tag))
        };
        if !has(b"halt") {
            return None;
        }
        // 句读四个、冒号、分号、左右弯引号各两个；顺序与 Blink 相同。
        let text =
            "\u{3001}\u{3002}\u{FF0C}\u{FF0E}\u{FF1A}\u{FF1B}\u{201C}\u{2018}\u{201D}\u{2019}";
        let mut buffer = UnicodeBuffer::new();
        buffer.push_str(text);
        buffer.set_direction(Direction::LeftToRight);
        buffer.set_script(script::HAN);
        let shaped = rustybuzz::shape(face, &[], buffer);
        if shaped.len() != text.chars().count() {
            return None;
        }
        let mut probes = Vec::new();
        for ((info, pos), (offset, _)) in shaped
            .glyph_infos()
            .iter()
            .zip(shaped.glyph_positions())
            .zip(text.char_indices())
        {
            if info.cluster as usize != offset {
                return None;
            }
            let (left, right) = face
                .glyph_bounding_box(GlyphId(info.glyph_id as u16))
                .map_or((0.0, 0.0), |b| (f64::from(b.x_min), f64::from(b.x_max)));
            let dx = f64::from(pos.x_offset);
            probes.push(Probe {
                glyph: info.glyph_id,
                advance: pos.x_advance,
                left: left + dx,
                right: right + dx,
            });
        }
        Some(HanKerning {
            chws: has(b"chws"),
            dot: group_kind(&probes[..4]),
            colon: group_kind(&probes[4..5]),
            semicolon: group_kind(&probes[5..6]),
            quote_fullwidth: group_kind(&probes[6..8]) == Kern::Open
                && group_kind(&probes[8..10]) == Kern::Close,
        })
    }

    fn kind(&self, c: char) -> Kern {
        match class_of(c) {
            Class::Fixed(kind) => kind,
            Class::Dot => self.dot,
            Class::Colon => self.colon,
            Class::Semicolon => self.semicolon,
            Class::OpenQuote if self.quote_fullwidth => Kern::Open,
            Class::OpenQuote => Kern::OpenNarrow,
            Class::CloseQuote if self.quote_fullwidth => Kern::Close,
            Class::CloseQuote => Kern::CloseNarrow,
        }
    }

    /// 每个字要不要开 `halt`。`run_start[i]` 表示第 i 个字是一段整形的开头：字体有 `chws` 时段内交给它，
    /// 只补段与段交界处的挤压。行首行尾不挤（Canvas 文字是单行，按 `normal`）。
    fn halts(&self, chars: &[char], run_start: &[bool]) -> Vec<bool> {
        let mut out = vec![false; chars.len()];
        // Blink `HanKerning::MayApply`：一个可能的开闭标点都没有就不算。
        if !chars
            .iter()
            .any(|&c| matches!(c as u32, 0x2018..=0x301F | 0xFF08..=0xFF60))
        {
            return out;
        }
        let kinds: Vec<Kern> = chars.iter().map(|&c| self.kind(c)).collect();
        for i in 1..chars.len() {
            if self.chws && !run_start[i] {
                continue;
            }
            if kern_end(kinds[i], kinds[i - 1]) {
                out[i - 1] = true;
            } else if kern_start(kinds[i], kinds[i - 1]) {
                out[i] = true;
            }
        }
        out
    }
}

impl Font {
    /// `bytes` 是字体文件；`declared` 是 `@font-face` 的粗细范围与样式。
    pub fn load(
        bytes: Vec<u8>,
        declared_weight: [f64; 2],
        declared_style: &str,
    ) -> Result<Font, String> {
        let data: &'static [u8] = Box::leak(bytes.into_boxed_slice());
        let face = Face::from_slice(data, 0).ok_or("font-parse")?;
        let upem = f64::from(face.units_per_em());
        let han = HanKerning::probe(&face);
        Ok(Font {
            face,
            upem,
            declared_weight_max: declared_weight[1],
            declared_italic: declared_style != "normal",
            han,
            outlines: RwLock::new(HashMap::new()),
        })
    }

    fn outline(&self, glyph: u16) -> Arc<Vec<Seg>> {
        if let Some(hit) = self
            .outlines
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .get(&glyph)
        {
            return hit.clone();
        }
        let mut outline = Outline::default();
        self.face.outline_glyph(GlyphId(glyph), &mut outline);
        let outline = Arc::new(outline.0);
        self.outlines
            .write()
            .unwrap_or_else(|p| p.into_inner())
            .insert(glyph, outline.clone());
        outline
    }

    /// 一次 `fillText` / `strokeText` 的字形路径。`Err` 是不支持的原因。
    #[allow(clippy::too_many_arguments)]
    pub fn layout(
        &self,
        text: &str,
        size: f64,
        weight: f64,
        style: &str,
        left: f64,
        baseline: f64,
        chromium_width: f64,
        scale_x: f64,
    ) -> Result<Vec<Seg>, String> {
        let weight_class = f64::from(self.face.weight().to_number());
        if weight >= 600.0 && self.declared_weight_max < 600.0 && weight_class < 600.0 {
            return Err(format!("text-synthetic-bold: {weight}"));
        }
        // 请求斜体而声明的与字体文件本身都不是斜体时，Blink 让 Skia 做 −1/4 的错切。
        let skew = if style != "normal"
            && !self.declared_italic
            && !self.face.is_italic()
            && !self.face.is_oblique()
        {
            0.25
        } else {
            0.0
        };
        let scale = size / self.upem;
        let mut pen = 0.0f64;
        let mut segs = Vec::new();
        let runs = runs(text)?;
        let chars: Vec<char> = text.chars().collect();
        let mut run_start = vec![false; chars.len()];
        let mut index = 0;
        for (run, _) in &runs {
            run_start[index] = true;
            index += run.chars().count();
        }
        let halts = self.han.as_ref().map(|han| han.halts(&chars, &run_start));
        let mut index = 0;
        for (run, run_script) in runs {
            // Chromium 默认整段开 `chws`（字体没有就不起作用），再给该挤的字单独开 `halt`。
            let mut features = vec![Feature::new(Tag::from_bytes(b"chws"), 1, ..)];
            for (offset, c) in run.char_indices() {
                if halts.as_ref().is_some_and(|h| h[index]) {
                    features.push(Feature::new(
                        Tag::from_bytes(b"halt"),
                        1,
                        offset..offset + c.len_utf8(),
                    ));
                }
                index += 1;
            }
            let mut buffer = UnicodeBuffer::new();
            buffer.push_str(&run);
            buffer.set_direction(Direction::LeftToRight);
            buffer.set_script(run_script);
            let shaped = rustybuzz::shape(&self.face, &features, buffer);
            for (info, pos) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
                let glyph = info.glyph_id as u16;
                let source = run[info.cluster as usize..].chars().next().unwrap_or(' ');
                if glyph == 0 && !source.is_whitespace() {
                    return Err(format!("text-missing-glyph: U+{:04X}", source as u32));
                }
                let id = GlyphId(glyph);
                if self.face.is_color_glyph(id)
                    || self.face.glyph_svg_image(id).is_some()
                    || self.face.glyph_raster_image(id, u16::MAX).is_some()
                {
                    return Err(format!("text-color-glyph: U+{:04X}", source as u32));
                }
                let ox = left + (pen + f64::from(pos.x_offset)) * scale * scale_x;
                let oy = baseline - f64::from(pos.y_offset) * scale;
                let sx = scale * scale_x;
                let place = |x: f64, y: f64| (ox + x * sx + y * scale * skew, oy - y * scale);
                for seg in self.outline(glyph).iter() {
                    segs.push(match *seg {
                        Seg::Move(x, y) => {
                            let (x, y) = place(x, y);
                            Seg::Move(x, y)
                        }
                        Seg::Line(x, y) => {
                            let (x, y) = place(x, y);
                            Seg::Line(x, y)
                        }
                        Seg::Quad(a, b, x, y) => {
                            let (a, b) = place(a, b);
                            let (x, y) = place(x, y);
                            Seg::Quad(a, b, x, y)
                        }
                        Seg::Cubic(a, b, c, d, x, y) => {
                            let (a, b) = place(a, b);
                            let (c, d) = place(c, d);
                            let (x, y) = place(x, y);
                            Seg::Cubic(a, b, c, d, x, y)
                        }
                        Seg::Close => Seg::Close,
                    });
                }
                pen += f64::from(pos.x_advance);
            }
        }
        let width = pen * scale;
        let tolerance = 0.5f64.max(chromium_width * 0.002);
        if (width - chromium_width).abs() > tolerance {
            return Err(format!(
                "text-width-mismatch: {width:.3} vs {chromium_width:.3}"
            ));
        }
        Ok(segs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_characters_join_their_neighbours() {
        let r = runs("12程序员abc？").unwrap();
        let names: Vec<_> = r.iter().map(|(t, s)| (t.as_str(), *s)).collect();
        assert_eq!(names, [("12程序员", script::HAN), ("abc？", script::LATIN)]);
        assert!(runs("مرحبا").is_err());
    }

    fn noto_sans_sc() -> Font {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/assets/fonts/NotoSansSC-Variable.ttf"
        );
        Font::load(std::fs::read(path).unwrap(), [400.0, 400.0], "normal").unwrap()
    }

    fn width(font: &Font, text: &str) -> Result<(), String> {
        // 100px、upem 1000：一个全角字 100。
        let expected = match text {
            "》（" | "（（" => 150.0,
            "（" | "》" => 100.0,
            "a》（b" => 150.0 + (font_advance(font, 'a') + font_advance(font, 'b')) / 10.0,
            _ => unreachable!(),
        };
        font.layout(text, 100.0, 400.0, "normal", 0.0, 0.0, expected, 1.0)
            .map(|_| ())
    }

    fn font_advance(font: &Font, c: char) -> f64 {
        f64::from(
            font.face
                .glyph_hor_advance(font.face.glyph_index(c).unwrap())
                .unwrap(),
        )
    }

    #[test]
    fn adjacent_fullwidth_punctuation_collapses_like_chromium() {
        let font = noto_sans_sc();
        let han = font.han.as_ref().expect("Noto Sans SC has halt");
        assert!(!han.chws);
        // 简体中文字体：句读靠左下、弯引号是全角。
        assert_eq!(
            (han.dot, han.colon, han.quote_fullwidth),
            (Kern::Close, Kern::Close, true)
        );
        assert_eq!(han.kind('“'), Kern::Open);
        assert_eq!(han.kind('('), Kern::OpenNarrow);
        // 闭 + 开：后一个开括号少半个字宽；开 + 开同理。行首的开括号不挤。
        width(&font, "》（").unwrap();
        width(&font, "（（").unwrap();
        width(&font, "（").unwrap();
        width(&font, "a》（b").unwrap();
        // 「。」」闭 + 闭挤前一个；「，（」闭 + 开挤后一个；隔着拉丁字母不挤。
        let chars: Vec<char> = "。」a，（".chars().collect();
        assert_eq!(
            han.halts(&chars, &[true, false, false, false, false]),
            [true, false, false, false, true]
        );
        // 没有中日韩标点时一律不挤。
        assert_eq!(han.halts(&['(', '('], &[true, false]), [false, false]);
    }
}
