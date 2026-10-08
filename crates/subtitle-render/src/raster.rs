pub fn draw_fit_pixmap(destination: &mut Pixmap, source: &Pixmap, fit: Fit, opacity: f32) {
    draw_fit_pixmap_at(destination, source, fit, opacity, 0.5);
}

/// 同 [`draw_fit_pixmap`]，但水平余量按 `anchor_x` 分配：0 贴左、0.5 居中、1 贴右；
/// 竖直方向照旧居中（模板台标层的 `align`）。
pub fn draw_fit_pixmap_at(
    destination: &mut Pixmap,
    source: &Pixmap,
    fit: Fit,
    opacity: f32,
    anchor_x: f64,
) {
    let source_width = f64::from(source.width().max(1));
    let source_height = f64::from(source.height().max(1));
    let destination_width = f64::from(destination.width());
    let destination_height = f64::from(destination.height());
    let scale = match fit {
        Fit::Cover => (destination_width / source_width).max(destination_height / source_height),
        Fit::Contain => (destination_width / source_width).min(destination_height / source_height),
    };
    let width = source_width * scale;
    let height = source_height * scale;
    let transform = Transform::from_scale(scale as f32, scale as f32).post_translate(
        ((destination_width - width) * anchor_x) as f32,
        ((destination_height - height) / 2.0) as f32,
    );
    destination.draw_pixmap(
        0,
        0,
        source.as_ref(),
        &PixmapPaint {
            opacity,
            quality: FilterQuality::Bilinear,
            ..Default::default()
        },
        transform,
        None,
    );
}

/// Timeline 0.1 的 `fx {grayscale, blur, brightness}`。
///
/// 实现已迁到 `render_raster::effects`（`filter.colorAdjust@1` + `filter.blur@1`
/// 的 strict CPU reference）——这里只剩把持久字段翻成效果栈再执行。
/// `reference_scale = 画布短边 / 540`，与 lowering 的 `canvasShortEdge` 基准
/// 互为倒数，因此传给效果的短边是 `reference_scale * 540`。
pub fn apply_media_effects(pixmap: &mut Pixmap, fx: Option<&Fx>, reference_scale: f64) {
    let Some(fx) = fx else {
        return;
    };
    let short_edge = reference_scale * timeline::REFERENCE_SHORT_EDGE;
    for lowered in timeline::lower_element_effects(Some(fx), None, None, None, false) {
        render_raster::effects::apply_filter_in_place(
            &lowered.effect,
            &lowered.uniforms,
            pixmap,
            short_edge,
        )
        .expect("内置 filter 配方必须可执行");
    }
}

/// 只加亮度（全屏 `fit: contain` 的模糊背景板压暗）。
pub fn adjust_brightness(data: &mut [u8], amount: f64) {
    render_raster::effects::filters::color_adjust::brightness_only(data, amount);
}

/// premultiplied RGBA → straight alpha，就地。
///
/// 取整规则借 tiny-skia 的 `PremultipliedColorU8::demultiply()`——`render_png`
/// 走的 `Pixmap::encode_png` 用的也是它，所以全仓只有一条解乘规则。通道大于
/// alpha 的像素不是合法预乘值，保持原样而不是猜一个。
pub fn demultiply_rgba_in_place(data: &mut [u8]) {
    for pixel in data.chunks_exact_mut(4) {
        let Some(premultiplied) =
            tiny_skia::PremultipliedColorU8::from_rgba(pixel[0], pixel[1], pixel[2], pixel[3])
        else {
            continue;
        };
        let straight = premultiplied.demultiply();
        pixel[0] = straight.red();
        pixel[1] = straight.green();
        pixel[2] = straight.blue();
        pixel[3] = straight.alpha();
    }
}

pub fn multiply_premultiplied_alpha(data: &mut [u8], opacity: f64) {
    render_raster::effects::multiply_premultiplied_alpha(data, opacity);
}

pub fn multiply_pixel_coverage(pixel: &mut [u8], coverage: f64) {
    render_raster::effects::multiply_pixel_coverage(pixel, coverage);
}

/// 一条视觉行在自身排版盒里的左缘。CPU 光栅、GPU retained scene、底板与动画
/// 命中都走这一处，避免 `textAlign` 只在某一种输出后端生效。
pub fn line_start_x(layout: &LineLayout, line_width: f64, center_x: f64) -> f64 {
    let align_width = layout.align_width.max(line_width);
    let box_left = center_x - align_width / 2.0;
    match layout.text_align {
        LineTextAlign::Left => box_left,
        LineTextAlign::Center => center_x - line_width / 2.0,
        LineTextAlign::Right => box_left + align_width - line_width,
    }
}

/// 圆角矩形 / 椭圆的 SDF 覆盖率遮罩（`mask.shape@1` 的 CPU reference）。
///
/// 这里的 `radius` / `feather` 已经是**画布像素**，直接调内核；走 manifest 的
/// uniform 路径要先换算成「短边比例」（`mask.shape` 的取值范围是比例，
/// 把像素值塞进去会被 `resolve_uniforms` 夹到 0.5）。带 basis 的入口在
/// `render_media_element`，由 `lower_element_effects` 供参数。
pub fn apply_local_clip(pixmap: &mut Pixmap, radius: f64, ellipse: bool, feather: f64) {
    let (width, height) = (pixmap.width(), pixmap.height());
    render_raster::effects::filters::mask_shape::mask_shape(
        pixmap.data_mut(),
        width,
        height,
        radius,
        ellipse,
        feather,
    );
}

/// 主画面层是否恒等于「一张不透明纯黑底」：`place.opacity == 0` 且背景是黑底。
///
/// 成立时源画面一个像素都到不了输出，结果与源帧内容完全无关。`place` 不随时间
/// 变化，所以整段导出只用判一次——[`OverlayRenderPlan::base_frame_is_uniform_black`]
/// 就是拿它给平台导出循环和合成器做整条通路的短路依据。
///
/// 这里是这个判据的**唯一一份**：下面 [`apply_main_transform_bgra`] 的按行填黑
/// 快路也走它，两边不会漂。
pub fn main_transform_is_uniform_black(main: Option<&Main>) -> bool {
    let Some(main) = main else {
        return false;
    };
    let opacity = main
        .place
        .as_ref()
        .and_then(|place| place.opacity)
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    opacity <= f64::EPSILON
        && matches!(
            main.background.unwrap_or(Background::Black),
            Background::Black
        )
}

/// 主画面层整段是一张不透明纯色底时给出那个颜色（RGB）：`opacity == 0` 且
/// 背景是黑（缺省）或 0.12 的 `#RRGGBB`。黑底与 [`main_transform_is_uniform_black`]
/// 同真；模糊底要真的算，返回 `None`。
pub fn main_transform_uniform_fill(main: Option<&Main>) -> Option<[u8; 3]> {
    let main = main?;
    let opacity = main
        .place
        .as_ref()
        .and_then(|place| place.opacity)
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    if opacity > f64::EPSILON {
        return None;
    }
    main.background.unwrap_or(Background::Black).solid_rgb()
}

/// 水平进度擦除（`mask.progress@1` 的 CPU reference）。
pub fn apply_horizontal_reveal(pixmap: &mut Pixmap, reveal: f64) {
    let (width, height) = (pixmap.width(), pixmap.height());
    render_raster::effects::filters::reveal::horizontal_reveal(
        pixmap.data_mut(),
        width,
        height,
        reveal,
    );
}

pub use timeline::geometry::tile_stamp_points;

/// Shared admission rule for CPU passthrough and native GPU decoded textures.
pub fn main_transform_is_identity(main: Option<&Main>, width: u32, height: u32) -> bool {
    let Some(main) = main else {
        return true;
    };
    let place = main.place.as_ref();
    let x = f64::from(width) * place.and_then(|place| place.x).unwrap_or(50.0) / 100.0;
    let y = f64::from(height) * place.and_then(|place| place.y).unwrap_or(50.0) / 100.0;
    let scale_x = place.and_then(|place| place.scale).unwrap_or(1.0);
    let scale_y = place.and_then(|place| place.scale_y).unwrap_or(scale_x);
    let rotation = place.and_then(|place| place.rot).unwrap_or(0.0);
    let opacity = place
        .and_then(|place| place.opacity)
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    (x - f64::from(width) / 2.0).abs() <= 1e-9
        && (y - f64::from(height) / 2.0).abs() <= 1e-9
        && (scale_x - 1.0).abs() <= 1e-9
        && (scale_y - 1.0).abs() <= 1e-9
        && rotation.abs() <= 1e-9
        && (opacity - 1.0).abs() <= 1e-9
}

pub fn apply_main_transform_bgra(
    pixels: &mut [u8],
    stride: usize,
    width: u32,
    height: u32,
    main: Option<&Main>,
) -> Result<()> {
    let Some(main) = main else {
        return Ok(());
    };
    let width_usize = width as usize;
    let height_usize = height as usize;
    if pixels.len() < stride.saturating_mul(height_usize) || stride < width_usize * 4 {
        bail!("主画面 BGRA 缓冲区尺寸无效");
    }
    if main_transform_is_identity(Some(main), width, height) {
        return Ok(());
    }
    let place = main.place.as_ref();
    let x = f64::from(width) * place.and_then(|place| place.x).unwrap_or(50.0) / 100.0;
    let y = f64::from(height) * place.and_then(|place| place.y).unwrap_or(50.0) / 100.0;
    let scale_x = place.and_then(|place| place.scale).unwrap_or(1.0);
    let scale_y = place.and_then(|place| place.scale_y).unwrap_or(scale_x);
    let rotation = place.and_then(|place| place.rot).unwrap_or(0.0);
    let opacity = place
        .and_then(|place| place.opacity)
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);

    // `opacity == 0`：源画面一个像素都到不了输出，结果**完全由 background 决定**。
    //
    // 这不是罕见分支——媒体被「元素化」搬到时间轴之后（`main.detached`），main 层
    // 正是靠 `place.opacity = 0` 隐藏的，画面改由时间轴元素经合成器画。也就是说
    // 普通项目导出的**每一帧**都会走到这里。
    //
    // 走下面那条通路的话，每帧要：两次 width×height×4 的堆分配、一趟逐像素
    // BGRA→RGBA swizzle、一次 `draw_pixmap`（透明度 0，画了等于没画）、再一趟
    // 逐像素 swizzle 写回——1799 帧 720p 实测 **249 ms/帧**，占整段「字幕合成」的
    // 69%，全部用来产出一张纯黑底。黑底那一档直接按行填就够了。
    //
    // 模糊底那一档仍要真的算：它的内容就是源画面的模糊版，跳不过去；但可以省掉
    // 那次必然无效的 `draw_pixmap`（见下面 `opacity > 0` 的判断）。
    if let Some([r, g, b]) = main_transform_uniform_fill(Some(main)) {
        // 纯色底（黑，或 0.12 的 `#RRGGBB`）同一条按行填的快路；缓冲区是 BGRA。
        for row in 0..height_usize {
            let target = &mut pixels[row * stride..row * stride + width_usize * 4];
            for pixel in target.chunks_exact_mut(4) {
                pixel.copy_from_slice(&[b, g, r, 255]);
            }
        }
        return Ok(());
    }

    let mut source_rgba = vec![0_u8; width_usize * height_usize * 4];
    for row in 0..height_usize {
        let input = &pixels[row * stride..row * stride + width_usize * 4];
        let output = &mut source_rgba[row * width_usize * 4..(row + 1) * width_usize * 4];
        for column in 0..width_usize {
            output[column * 4] = input[column * 4 + 2];
            output[column * 4 + 1] = input[column * 4 + 1];
            output[column * 4 + 2] = input[column * 4];
            output[column * 4 + 3] = 255;
        }
    }
    let source = Pixmap::from_vec(
        source_rgba,
        IntSize::from_wh(width, height).context("主画面尺寸非法")?,
    )
    .context("主画面 RGBA 尺寸非法")?;
    let mut destination = Pixmap::new(width, height).context("无法创建主画面变换层")?;
    match main.background.unwrap_or(Background::Black) {
        Background::Black => destination.fill(tiny_skia::Color::BLACK),
        Background::Color([r, g, b]) => {
            destination.fill(tiny_skia::Color::from_rgba8(r, g, b, 255));
        }
        Background::Blur => {
            destination.data_mut().copy_from_slice(source.data());
            box_blur_rgba(
                destination.data_mut(),
                width,
                height,
                ((width.min(height) as f64) * 0.025).round().max(1.0) as usize,
            );
        }
    }
    let transform = Transform::from_translate(-(width as f32) / 2.0, -(height as f32) / 2.0)
        .post_scale(scale_x as f32, scale_y as f32)
        .post_rotate(rotation as f32)
        .post_translate(x as f32, y as f32);
    // 透明度 0 时这一笔是恒等操作（SourceOver 一个不透明度为 0 的源）。上面已经
    // 把黑底那一档整条短路掉，这里挡的是模糊底那一档——省下 1080p 一次带双线性
    // 采样的全画面 blit。
    if opacity > f64::EPSILON {
        destination.draw_pixmap(
            0,
            0,
            source.as_ref(),
            &PixmapPaint {
                opacity: opacity as f32,
                quality: FilterQuality::Bilinear,
                blend_mode: tiny_skia::BlendMode::SourceOver,
            },
            transform,
            None,
        );
    }
    for row in 0..height_usize {
        let input = &destination.data()[row * width_usize * 4..(row + 1) * width_usize * 4];
        let output = &mut pixels[row * stride..row * stride + width_usize * 4];
        for column in 0..width_usize {
            output[column * 4] = input[column * 4 + 2];
            output[column * 4 + 1] = input[column * 4 + 1];
            output[column * 4 + 2] = input[column * 4];
            output[column * 4 + 3] = 255;
        }
    }
    Ok(())
}

/// 文字元素与字幕共用的排版：按 Unicode 词边界贪心折行。
pub fn layout_text(
    text_engine: &mut TextEngine,
    item: &TimedItem,
    style: &LineStyle,
    wrap_width: f64,
    part_ranges: Option<&[Range<usize>]>,
) -> (Vec<LayoutLine>, f64) {
    layout_text_with(text_engine, item, style, wrap_width, part_ranges, false)
}

/// 字幕行的排版：与 [`layout_text`] 同一套分片与字形，只是含中日文的行不再贪心填满，
/// 改由 [`cjk_line_breaks`] 选断点（行数不多于贪心，按禁则、数字连单位、标点 / 空格处优先与
/// 各行均衡挑位置）。不含中日文的行与 [`layout_text`] 逐字节相同。
pub fn layout_subtitle_text(
    text_engine: &mut TextEngine,
    item: &TimedItem,
    style: &LineStyle,
    wrap_width: f64,
) -> (Vec<LayoutLine>, f64) {
    layout_text_with(text_engine, item, style, wrap_width, None, true)
}

enum LayoutToken {
    HardBreak,
    Space(GlyphChunk),
    Glyph(String, GlyphChunk),
}

fn layout_text_with(
    text_engine: &mut TextEngine,
    item: &TimedItem,
    style: &LineStyle,
    wrap_width: f64,
    part_ranges: Option<&[Range<usize>]>,
    balance_cjk: bool,
) -> (Vec<LayoutLine>, f64) {
    let weight = style.font_weight;
    let mut tokens = Vec::new();
    for run in timed_runs(&item.text, &item.words, &style.text_transform) {
        // 时间跨度不是不可折行的词：译片可能把整句作为一个带时间的 run。
        // 先按 Unicode 词边界排版，超宽单词再按字形簇兜底；每片保留原 word
        // 和字节偏移，让逐词动效与分片高亮仍引用原来的时间跨度。
        let mut pieces = Vec::new();
        let run_width = text_engine
            .shape_styled(
                &run.text,
                &style.font_name,
                style.font_size,
                weight,
                style.shaped_italic,
            )
            .width
            + style.letter_spacing * run.text.graphemes(true).count().saturating_sub(1) as f64;
        let boundaries = if run.word.is_some()
            && run_width <= wrap_width
            && !run.text.contains(['\n', '\r'])
            && !(style.text_motion.is_some() && run.text.chars().any(char::is_whitespace))
        {
            // 正常长度的时间词保留整词 shaping（连字、字距与动效几何不变）。
            vec![(0, run.text.as_str())]
        } else if run.word.is_none() && part_ranges.is_some() {
            // 文字元素的无时间分片可落在词内，保留原有逐字形的 part 映射。
            run.text.grapheme_indices(true).collect::<Vec<_>>()
        } else {
            run.text.split_word_bound_indices().collect::<Vec<_>>()
        };
        for (offset, piece) in boundaries {
            let shaped = text_engine.shape_styled(
                piece,
                &style.font_name,
                style.font_size,
                weight,
                style.shaped_italic,
            );
            let width = shaped.width
                + style.letter_spacing * piece.graphemes(true).count().saturating_sub(1) as f64;
            if width > wrap_width {
                pieces.extend(
                    piece
                        .grapheme_indices(true)
                        .map(|(at, grapheme)| (grapheme.to_owned(), run.start + offset + at)),
                );
            } else {
                pieces.push((piece.to_owned(), run.start + offset));
            }
        }
        for (piece, offset) in pieces {
            if piece == "\n" || piece == "\r\n" || piece == "\r" {
                tokens.push(LayoutToken::HardBreak);
                continue;
            }
            let shaped = text_engine.shape_styled(
                &piece,
                &style.font_name,
                style.font_size,
                weight,
                style.shaped_italic,
            );
            let width = shaped.width
                + style.letter_spacing * piece.graphemes(true).count().saturating_sub(1) as f64;
            let chunk = GlyphChunk {
                text: piece.clone(),
                word: run.word,
                part: part_ranges
                    .and_then(|ranges| ranges.iter().position(|range| range.contains(&offset))),
                width,
                font_name: style.font_name.clone(),
                font_size: style.font_size,
                font_weight: weight,
                italic: style.italic && !style.shaped_italic,
                shaped,
            };
            if piece.trim().is_empty() {
                tokens.push(LayoutToken::Space(chunk));
            } else {
                tokens.push(LayoutToken::Glyph(piece, chunk));
            }
        }
    }
    let breaks = (balance_cjk && item.text.chars().any(is_cjk_char))
        .then(|| cjk_line_breaks(&tokens, wrap_width, style.font_size));
    let mut lines = vec![LayoutLine::default()];
    let mut spaces: Vec<GlyphChunk> = Vec::new();
    for (index, token) in tokens.into_iter().enumerate() {
        let chunk = match token {
            LayoutToken::HardBreak => {
                spaces.clear();
                lines.push(LayoutLine::default());
                continue;
            }
            LayoutToken::Space(chunk) => {
                if lines.last().expect("layout line").width > 0.0 {
                    spaces.push(chunk);
                }
                continue;
            }
            LayoutToken::Glyph(_, chunk) => chunk,
        };
        let spaces_width = spaces.iter().map(|chunk| chunk.width).sum::<f64>();
        let line = lines.last().expect("layout line");
        let wrap = match &breaks {
            Some(breaks) => breaks.contains(&index),
            None => line.width > 0.0 && line.width + spaces_width + chunk.width > wrap_width,
        };
        if wrap {
            spaces.clear();
            lines.push(LayoutLine::default());
        }
        let line = lines.last_mut().expect("layout line");
        // 行首/行尾空白不参与宽度与对齐，词间空白仍保留时间和字形信息。
        for space in spaces.drain(..) {
            line.width += space.width;
            line.chunks.push(space);
        }
        line.width += chunk.width;
        line.chunks.push(chunk);
    }
    lines.retain(|line| !line.chunks.is_empty());
    if lines.is_empty() {
        lines.push(LayoutLine::default());
    }
    for line in &mut lines {
        line.height = style.font_size * style.line_height;
    }
    let width = lines.iter().map(|line| line.width).fold(0.0, f64::max);
    (lines, width)
}

/// 中日文（汉字、假名、全角标点）。谚文按空格分词，走原来的贪心折行。
fn is_cjk_char(c: char) -> bool {
    matches!(c,
        '\u{3000}'..='\u{303F}'
            | '\u{3040}'..='\u{30FF}'
            | '\u{3400}'..='\u{4DBF}'
            | '\u{4E00}'..='\u{9FFF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{FF00}'..='\u{FFEF}'
            | '\u{20000}'..='\u{2FA1F}')
}

fn is_han(c: char) -> bool {
    matches!(c,
        '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}'
            | '\u{20000}'..='\u{2FA1F}')
}

/// 不能落在行首的字（禁则）：句读、闭括号、闭引号、省略号与破折号、百分号、小假名。
fn cannot_start_line(c: char) -> bool {
    "，。、；：？！）］｝」』】〉》〕…‥—・ー％‰℃,.;:?!)]}%”’".contains(c)
        || "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々ゝゞヽヾ".contains(c)
}

/// 不能落在行尾的字：开括号与开引号。
fn cannot_end_line(c: char) -> bool {
    "（［｛「『【〈《〔“‘([{".contains(c)
}

/// 在它后面断行是自然的停顿。
fn is_pause_punct(c: char) -> bool {
    "，。、；：？！…）」』,.;:?!)".contains(c)
}

/// 含中日文的一段字幕怎么折：返回「从这个 token 起另起一行」的下标。
///
/// 贪心填满每一行会把词拆在行尾（利/益、10/亿）、把「？：、」推到行首、在末行留一个孤字。
/// 这里在最少行数里挑断点（有标点悬挂，可能比贪心还少一行），代价从重到轻：
///
/// 1. 行数（每行 1e9）——不为了好看多折一行；
/// 2. 禁则、数字与后面的量词 / 单位（10亿、10 亿、1870年代）、紧挨着的拉丁串（GPT-4）被拆开，
///    以及只剩一个字的行（每处 1e6）；
/// 3. 各行留白的平方和——行宽尽量相等；
/// 4. 断在空格（隐藏标点留下的空位、中英文之间）或停顿标点之后，减 `8 × 字号²`，
///    约等于换来两个字以内的不均衡。
///
/// 行尾的句读可以悬挂在行宽外（每处 1e5）：只在不悬挂就得把它挤到下一行行首时才用，
/// 所以这时返回的行宽可能比 `wrap_width` 多出一个标点。
///
/// 中文没有分词器，词内断行（利/益）只能靠均衡与标点优先间接避开，不保证。
fn cjk_line_breaks(tokens: &[LayoutToken], wrap_width: f64, font_size: f64) -> Vec<usize> {
    struct Item<'a> {
        token: usize,
        text: &'a str,
        width: f64,
        gap: f64,
    }
    let mut breaks = Vec::new();
    let mut paragraph: Vec<Item> = Vec::new();
    let mut gap = 0.0;
    let flush = |paragraph: &mut Vec<Item>, breaks: &mut Vec<usize>| {
        let n = paragraph.len();
        if n < 2 {
            paragraph.clear();
            return;
        }
        let mut prefix_width = vec![0.0; n + 1];
        let mut prefix_gap = vec![0.0; n + 1];
        for (j, item) in paragraph.iter().enumerate() {
            prefix_width[j + 1] = prefix_width[j] + item.width;
            prefix_gap[j + 1] = prefix_gap[j] + item.gap;
        }
        let line_width = |a: usize, b: usize| {
            prefix_width[b + 1] - prefix_width[a] + prefix_gap[b + 1] - prefix_gap[a + 1]
        };
        if line_width(0, n - 1) <= wrap_width + 1e-6 {
            paragraph.clear();
            return;
        }
        let bonus = 8.0 * font_size * font_size;
        let break_cost = |a: usize| {
            let prev = &paragraph[a - 1];
            let next = &paragraph[a];
            let prev_last = prev.text.chars().next_back().unwrap_or(' ');
            let next_first = next.text.chars().next().unwrap_or(' ');
            let joined = next.gap <= 0.0;
            // 数字连单位不看中间有没有空格：译文常写成「10 亿」，那个空格不是停顿。
            let forbidden = cannot_start_line(next_first)
                || cannot_end_line(prev_last)
                || (prev_last.is_ascii_digit() && is_han(next_first))
                || (joined && prev_last.is_ascii_graphic() && next_first.is_ascii_graphic());
            let mut cost = if forbidden { 1e6 } else { 0.0 };
            if !joined || is_pause_punct(prev_last) {
                cost -= bonus;
            }
            cost
        };
        let mut best = vec![f64::INFINITY; n + 1];
        let mut from = vec![0usize; n + 1];
        best[0] = 0.0;
        for end in 1..=n {
            // 标点悬挂：行尾的句读可以探出行宽，免得它被挤到下一行行首。
            let last = &paragraph[end - 1];
            let hang = if last
                .text
                .chars()
                .all(|c| "，。、；：？！,.;:?!".contains(c))
            {
                last.width
            } else {
                0.0
            };
            for start in (0..end).rev() {
                let width = line_width(start, end - 1);
                if width - hang > wrap_width + 1e-6 && start + 1 < end {
                    break;
                }
                if !best[start].is_finite() {
                    continue;
                }
                let single = paragraph[start..end]
                    .iter()
                    .map(|item| item.text.graphemes(true).count())
                    .sum::<usize>()
                    == 1;
                let mut cost = best[start] + 1e9 + (wrap_width - width).max(0.0).powi(2);
                if width > wrap_width + 1e-6 && start + 1 < end {
                    cost += 1e5;
                }
                if start > 0 {
                    cost += break_cost(start);
                }
                if single {
                    cost += 1e6;
                }
                if cost < best[end] {
                    best[end] = cost;
                    from[end] = start;
                }
            }
        }
        let mut at = n;
        let mut starts = Vec::new();
        while at > 0 {
            let start = from[at];
            if start > 0 {
                starts.push(paragraph[start].token);
            }
            at = start;
        }
        breaks.extend(starts.into_iter().rev());
        paragraph.clear();
    };
    for (index, token) in tokens.iter().enumerate() {
        match token {
            LayoutToken::HardBreak => {
                flush(&mut paragraph, &mut breaks);
                gap = 0.0;
            }
            LayoutToken::Space(chunk) => {
                if !paragraph.is_empty() {
                    gap += chunk.width;
                }
            }
            LayoutToken::Glyph(text, chunk) => {
                paragraph.push(Item {
                    token: index,
                    text,
                    width: chunk.width,
                    gap,
                });
                gap = 0.0;
            }
        }
    }
    flush(&mut paragraph, &mut breaks);
    breaks
}

pub fn layout_lines_height(lines: &[LayoutLine]) -> f64 {
    lines.iter().map(|line| line.height + line.gap_after).sum()
}

#[derive(Clone)]
pub struct CaptionFontSpec {
    pub name: String,
    pub size: f64,
    pub weight: u16,
    pub italic: bool,
}

pub fn caption_manifest_font(
    text_engine: &TextEngine,
    descriptor: &CaptionRecipeDescriptor,
    role: &str,
    style: &LineStyle,
    size: f64,
    italic: bool,
) -> CaptionFontSpec {
    let manifest = descriptor
        .fonts
        .iter()
        .find(|font| font.role == role)
        .or_else(|| descriptor.fonts.first());
    let mut name = None;
    let mut weight = if style.bold { 700 } else { 400 };
    if let Some(manifest) = manifest {
        let candidates = std::iter::once(manifest.family.as_str()).chain(
            (manifest.substitution != "strict")
                .then_some(manifest.fallback.iter().map(String::as_str))
                .into_iter()
                .flatten(),
        );
        name = candidates
            .into_iter()
            .find(|candidate| text_engine.has_family(candidate))
            .map(str::to_owned);
        if name.is_some() {
            // `NSFont(name:size:)` selects the named family's default face;
            // descriptor weights only choose the generic system fallback.
            weight = 400;
        } else if manifest.substitution != "strict" {
            weight = if manifest.weights.iter().copied().max().unwrap_or(600) >= 700 {
                700
            } else {
                400
            };
        }
    }
    let name = name.unwrap_or_else(|| {
        if manifest.is_some_and(|manifest| manifest.substitution == "strict") {
            style.font_name.clone()
        } else {
            // Mac falls back to its system font only after exhausting the
            // descriptor chain. An empty family asks TextEngine for the same
            // generic system sans; mono manifests normally resolve Menlo first.
            String::new()
        }
    });
    CaptionFontSpec {
        name,
        size,
        weight,
        italic,
    }
}

pub fn caption_base_font_role(descriptor: &CaptionRecipeDescriptor) -> &'static str {
    if descriptor.layers.iter().any(|layer| layer == "scanlines")
        || descriptor.events.iter().any(|event| event.op == "textSwap")
    {
        "mono"
    } else if descriptor.layout == "fullScreenWord" {
        "sansHeavy"
    } else {
        "sans"
    }
}

#[allow(clippy::too_many_arguments)]
pub fn caption_word_font(
    text_engine: &mut TextEngine,
    descriptor: &CaptionRecipeDescriptor,
    token: Option<&CaptionRecipeLayoutToken>,
    role: &str,
    text: &str,
    style: &LineStyle,
    wrap_width: f64,
    frame_height: u32,
    canvas_scale: f64,
) -> CaptionFontSpec {
    let emphasized = matches!(role, "emphasis" | "hero");
    let (font_role, mut scale, italic) = match descriptor.layout.as_str() {
        "fullScreenWord" => {
            let count = text.chars().count().max(1) as f64;
            (
                "sansHeavy",
                (2.5 - (count * 0.17).min(1.2)).max(1.15),
                false,
            )
        }
        "dualBand" => (
            if emphasized { "sansHeavy" } else { "sans" },
            if emphasized { 1.35 } else { 0.82 },
            false,
        ),
        "editorialBlock" => (
            if emphasized { "editorialSerif" } else { "sans" },
            if role == "hero" {
                1.42
            } else if emphasized {
                1.24
            } else {
                0.94
            },
            emphasized,
        ),
        "centerBand" => (
            if emphasized { "sansHeavy" } else { "sans" },
            if emphasized { 1.18 } else { 1.0 },
            false,
        ),
        _ => (
            if emphasized {
                "sansHeavy"
            } else {
                caption_base_font_role(descriptor)
            },
            1.0,
            false,
        ),
    };
    scale *= token.map_or(1.0, |token| token.font_scale);
    let proposed = style.font_size * scale;
    let mut spec = caption_manifest_font(
        text_engine,
        descriptor,
        font_role,
        style,
        proposed,
        italic || style.italic,
    );
    if descriptor.layout == "fullScreenWord" {
        let minimum = token
            .map_or(24.0, |token| token.min_font_size)
            .mul_add(canvas_scale, 0.0)
            .max(8.0);
        let max_height = f64::from(frame_height) * token.map_or(0.46, |token| token.max_height);
        let max_height = max_height.max(style.font_size);
        let max_width = (wrap_width - style.background_pad_h * 2.0).max(10.0);
        let fits = |engine: &mut TextEngine, size: f64, spec: &CaptionFontSpec| {
            let shaped = engine.shape(text, &spec.name, size, spec.weight);
            shaped.width <= max_width && shaped.ascent + shaped.descent <= max_height
        };
        let mut low = minimum.min(proposed);
        let mut high = minimum.max(proposed);
        if fits(text_engine, high, &spec) {
            spec.size = high;
        } else {
            for _ in 0..16 {
                let middle = (low + high) / 2.0;
                if fits(text_engine, middle, &spec) {
                    low = middle;
                } else {
                    high = middle;
                }
            }
            spec.size = low;
        }
    }
    if descriptor.layout == "editorialBlock" && emphasized {
        spec.weight = 700;
    }
    spec
}

pub fn caption_recipe_bands(
    design: &DesignedCaption,
    descriptor: &CaptionRecipeDescriptor,
    item: &TimedItem,
    time: f64,
    fps: f64,
) -> Vec<Vec<usize>> {
    let roles = caption_recipe_roles(design, item, descriptor);
    let group_indices = caption_recipe_group_indices(&item.words, descriptor.grouping.as_ref());
    if !caption_recipe_owns_layout(descriptor, item) {
        return vec![(0..item.words.len()).collect()];
    }
    let Some(group) = caption_recipe_visible_group(design, item, time, fps) else {
        return Vec::new();
    };
    let members = group_indices
        .iter()
        .enumerate()
        .filter_map(|(index, group_index)| (*group_index == group.index).then_some(index))
        .collect::<Vec<_>>();
    match descriptor.layout.as_str() {
        "fullScreenWord" => members.into_iter().map(|index| vec![index]).collect(),
        "dualBand" | "editorialBlock" => {
            let (marked, ordinary): (Vec<_>, Vec<_>) = members
                .into_iter()
                .partition(|index| matches!(roles[*index].as_str(), "emphasis" | "hero"));
            let bands = if descriptor.layout == "dualBand" {
                vec![marked, ordinary]
            } else {
                vec![ordinary, marked]
            };
            bands.into_iter().filter(|band| !band.is_empty()).collect()
        }
        _ => vec![members],
    }
}

#[allow(clippy::too_many_arguments)]
pub fn layout_inline_caption_text(
    text_engine: &mut TextEngine,
    item: &TimedItem,
    style: &LineStyle,
    descriptor: &CaptionRecipeDescriptor,
    token: Option<&CaptionRecipeLayoutToken>,
    roles: &[String],
    base_font: &CaptionFontSpec,
    wrap_width: f64,
    frame_height: u32,
    canvas_scale: f64,
) -> (Vec<LayoutLine>, f64) {
    let mut lines = vec![LayoutLine::default()];
    for run in timed_runs(&item.text, &item.words, &style.text_transform) {
        let pieces = if run.word.is_some() {
            vec![(run.text, run.start)]
        } else {
            run.text
                .grapheme_indices(true)
                .map(|(offset, grapheme)| (grapheme.to_owned(), run.start + offset))
                .collect()
        };
        for (piece, _) in pieces {
            if piece == "\n" {
                lines.push(LayoutLine::default());
                continue;
            }
            let spec = run.word.map_or_else(
                || base_font.clone(),
                |index| {
                    caption_word_font(
                        text_engine,
                        descriptor,
                        token,
                        &roles[index],
                        &piece,
                        style,
                        wrap_width,
                        frame_height,
                        canvas_scale,
                    )
                },
            );
            let shaped = text_engine.shape(&piece, &spec.name, spec.size, spec.weight);
            let width = shaped.width
                + style.letter_spacing * piece.graphemes(true).count().saturating_sub(1) as f64;
            let line = lines.last_mut().expect("inline caption line");
            if line.width > 0.0 && line.width + width > wrap_width && !piece.trim().is_empty() {
                lines.push(LayoutLine::default());
            }
            let line = lines.last_mut().expect("inline caption line");
            if line.width == 0.0 && piece.trim().is_empty() {
                continue;
            }
            line.width += width;
            line.height = line.height.max(spec.size * style.line_height);
            line.chunks.push(GlyphChunk {
                text: piece.clone(),
                word: run.word,
                part: None,
                width,
                font_name: spec.name,
                font_size: spec.size,
                font_weight: spec.weight,
                italic: spec.italic,
                shaped,
            });
        }
    }
    lines.retain(|line| !line.chunks.is_empty());
    if lines.is_empty() {
        lines.push(LayoutLine {
            height: style.font_size * style.line_height,
            ..LayoutLine::default()
        });
    }
    let width = lines.iter().map(|line| line.width).fold(0.0, f64::max);
    (lines, width)
}

#[allow(clippy::too_many_arguments)]
pub fn layout_caption_text(
    text_engine: &mut TextEngine,
    item: &TimedItem,
    style: &LineStyle,
    design: &DesignedCaption,
    descriptor: &CaptionRecipeDescriptor,
    wrap_width: f64,
    time: f64,
    fps: f64,
    frame_width: u32,
    frame_height: u32,
    canvas_scale: f64,
) -> (Vec<LayoutLine>, f64) {
    let token = caption_recipe_layout_token(descriptor, frame_width, frame_height);
    let roles = caption_recipe_roles(design, item, descriptor);
    let bands = caption_recipe_bands(design, descriptor, item, time, fps);
    let base_font = caption_manifest_font(
        text_engine,
        descriptor,
        caption_base_font_role(descriptor),
        style,
        style.font_size,
        style.italic,
    );
    if !caption_recipe_owns_layout(descriptor, item) {
        return layout_inline_caption_text(
            text_engine,
            item,
            style,
            descriptor,
            token,
            &roles,
            &base_font,
            wrap_width,
            frame_height,
            canvas_scale,
        );
    }
    let band_gap = token.map_or(0.0, |token| token.band_gap * canvas_scale);
    let mut lines = Vec::<LayoutLine>::new();
    for (band_index, band) in bands.iter().enumerate() {
        if band.is_empty() {
            continue;
        }
        lines.push(LayoutLine::default());
        for (position, word_index) in band.iter().copied().enumerate() {
            let text = transform_text(&item.words[word_index].text, &style.text_transform);
            let spec = caption_word_font(
                text_engine,
                descriptor,
                token,
                &roles[word_index],
                &text,
                style,
                wrap_width,
                frame_height,
                canvas_scale,
            );
            let shaped = text_engine.shape(&text, &spec.name, spec.size, spec.weight);
            let width = shaped.width
                + style.letter_spacing * text.graphemes(true).count().saturating_sub(1) as f64;
            let space = (position > 0).then(|| {
                let shaped =
                    text_engine.shape(" ", &base_font.name, base_font.size, base_font.weight);
                let width = shaped.width;
                GlyphChunk {
                    text: " ".into(),
                    word: None,
                    part: None,
                    width,
                    font_name: base_font.name.clone(),
                    font_size: base_font.size,
                    font_weight: base_font.weight,
                    italic: base_font.italic,
                    shaped,
                }
            });
            let incoming = width + space.as_ref().map_or(0.0, |chunk| chunk.width);
            let current = lines.last_mut().expect("caption band line");
            if current.width > 0.0 && current.width + incoming > wrap_width {
                lines.push(LayoutLine::default());
            } else if let Some(space) = space {
                let current = lines.last_mut().expect("caption band line");
                current.width += space.width;
                current.height = current.height.max(base_font.size * style.line_height);
                current.chunks.push(space);
            }
            let current = lines.last_mut().expect("caption band line");
            current.width += width;
            current.height = current.height.max(spec.size * style.line_height);
            current.chunks.push(GlyphChunk {
                text: text.clone(),
                word: Some(word_index),
                part: None,
                width,
                font_name: spec.name,
                font_size: spec.size,
                font_weight: spec.weight,
                italic: spec.italic,
                shaped,
            });
        }
        if band_index + 1 < bands.len()
            && let Some(last) = lines.last_mut()
        {
            last.gap_after = band_gap;
        }
    }
    if lines.is_empty() {
        lines.push(LayoutLine {
            height: style.font_size * style.line_height,
            ..LayoutLine::default()
        });
    }
    let width = lines.iter().map(|line| line.width).fold(0.0, f64::max);
    (lines, width)
}

/// 一行参与摆放所需的全部几何输入。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LineBox {
    /// 折行后的实际内容高度（`行数 × font_size × line_height`）。
    pub height: f64,
    /// 单行参考高度（`font_size × line_height`，不含折行）——槽位高度的来源。
    pub reference: f64,
    /// 本行自己的纵向内边距（`pad_h / PLATE_PAD_ASPECT`）。
    ///
    /// 逐行底板模式下它撑开这一行的槽位与实际盒；共享底板模式下行盒保持裸字形，
    /// 由 [`StackPlate::Shared`] 在整栈外面统一套一圈。
    pub pad_v: f64,
    /// 行级位置覆盖：`(x%, y%)` 是这一行文本块中心的帧百分比。
    pub over: Option<(f64, f64)>,
    /// 行级垂直锚点；缺席时由接缝规则（堆栈内）或 center（脱离行）补齐。
    pub align: Option<VerticalAlign>,
}

impl LineBox {
    /// 槽位高度：堆栈里有两行以上时用参考高度，否则用实际高度；`padded` 时各加 `2 × pad_v`。
    ///
    /// 两行以上必须用参考高度，接缝才钉得住：上行折行只能向上长，不能把下行推走。
    /// 只剩一行时没有接缝可钉，槽位退回实际高度，「块居中于锚点」的老语义才成立
    /// ——否则单语折行字幕会整体偏 `font_size × line_height / 2`。
    ///
    /// 等价于 Mac `PreparedContent.slotHeight(padded:padV:)`：`padded` 时槽位量的是
    /// 含底板内边距的盒子，逐行底板之间的缝才是视觉上的缝。
    pub fn slot(&self, stacked: usize, padded: bool) -> f64 {
        let bare = if stacked >= 2 {
            self.reference
        } else {
            self.height
        };
        bare + if padded { self.pad_v * 2.0 } else { 0.0 }
    }
}

/// 堆栈的底板形态——决定内边距记在每行身上还是整栈外面。
///
/// 镜像 Mac `prepareStack` 的 `mode`：只看 `backgroundMode` 与堆栈行数，**不看**背景开没开。
/// 底板关掉的 shared 栈仍按共享槽位摆放，否则同一份文档两端会错位。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum StackPlate {
    /// 逐行底板：每行的槽位与实际盒都含自己的 `pad_v`，缝落在两块底板之间。
    Separate,
    /// 共享底板：槽位保持裸字形、缝保持在字形之间，整栈外面套一圈板内边距。
    Shared { pad_v: f64 },
}

impl StackPlate {
    /// 行盒是否自带内边距。
    pub fn padded(self) -> bool {
        matches!(self, Self::Separate)
    }

    /// 整栈外面那圈纵向板内边距（Mac 的 `platePadV`）。
    pub fn plate_pad_v(self) -> f64 {
        match self {
            Self::Separate => 0.0,
            Self::Shared { pad_v } => pad_v,
        }
    }
}

/// 参与锚点堆栈的行数与它们的总高（含行间 gap 与底板内边距）。
///
/// 脱离堆栈（有行级位置覆盖）的行不计入：堆栈只对剩下的行居中，剩一行时结果就是
/// 单行居中于锚点，与本来就只有一行的数学完全一致。
///
/// `total_height` 就是块级 `verticalAlign` 钉住的那个盒子——等价于 Mac 的
/// `slotBoxHeight = platePadV × 2 + Σ slot + gap × (n - 1)`。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StackExtent {
    pub count: usize,
    pub total_height: f64,
}

pub fn stacked_extent(lines: &[LineBox], gap: f64, plate: StackPlate) -> StackExtent {
    let count = lines.iter().filter(|line| line.over.is_none()).count();
    let total_height = lines
        .iter()
        .filter(|line| line.over.is_none())
        .map(|line| line.slot(count, plate.padded()))
        .sum::<f64>()
        + gap * count.saturating_sub(1) as f64
        + plate.plate_pad_v() * 2.0;
    StackExtent {
        count,
        total_height,
    }
}

/// 槽位内把 `height` 高的内容贴到 `[slot_top, slot_top + slot]` 上，返回顶边。
pub fn align_within(slot_top: f64, slot: f64, height: f64, align: VerticalAlign) -> f64 {
    match align {
        VerticalAlign::Top => slot_top,
        VerticalAlign::Center => slot_top + (slot - height) / 2.0,
        VerticalAlign::Bottom => slot_top + slot - height,
    }
}

/// 把 `height` 高的块挂到一条锚线上，返回顶边：
/// top → 顶边压线；center → 中心压线（现状）；bottom → 底边压线。
///
/// 就是槽高为 0 的 [`align_within`]：锚线是零高度的槽。
pub fn anchor_block(anchor: f64, height: f64, align: VerticalAlign) -> f64 {
    align_within(anchor, 0.0, height, align)
}

/// 堆栈内第 `rank`（共 `count` 行）行缺省的槽内对齐：接缝钉死。
///
/// 上行贴槽底向上长、下行贴槽顶向下长，两行之间那道缝（gap）因此永远不动。
/// 只有一行时槽位等于实际高度，三种对齐都是恒等变换，取 center 即可。
pub fn seam_align(rank: usize, count: usize) -> VerticalAlign {
    if count < 2 {
        VerticalAlign::Center
    } else if rank == 0 {
        VerticalAlign::Bottom
    } else if rank + 1 == count {
        VerticalAlign::Top
    } else {
        VerticalAlign::Center
    }
}

/// 逐行求 `(文本块中心 x, 字形顶边 y)`，输出与输入同序（绘制次序不受位置影响）。
///
/// - 有覆盖的行：`(x%, y%)` 是自身**含内边距**文本盒的锚点，按行级 `align`（缺席 =
///   center）摆放，不参与堆栈游标。脱离行永远画自己的底板，所以永远按 separate 算。
/// - 无覆盖的行：整栈按 `block` 锚点（缺席 = center）落在 `anchor_y` 上，钉住的是
///   含底板的整块（[`StackExtent::total_height`]）；栈内逐行分配槽位，行盒按行级
///   `align`（缺席 = 接缝规则）贴进自己的槽位。
///
/// 返回的永远是**字形**顶边（含内边距的盒顶再进 `pad_v`），调用方的绘制算术不变；
/// `pad_v == 0` 时逐比特等于加内边距之前的实现，老文档零回归。
pub fn place_lines(
    lines: &[LineBox],
    anchor: (f64, f64),
    gap: f64,
    frame: (f64, f64),
    block: Option<VerticalAlign>,
    plate: StackPlate,
) -> Vec<(f64, f64)> {
    let (anchor_x, anchor_y) = anchor;
    let (frame_width, frame_height) = frame;
    let stack = stacked_extent(lines, gap, plate);
    let padded = plate.padded();
    // 共享底板时游标从「板顶 + 板内边距」起步，槽位本身仍量裸字形。
    let mut cursor = anchor_block(
        anchor_y,
        stack.total_height,
        block.unwrap_or(VerticalAlign::Center),
    ) + plate.plate_pad_v();
    let mut rank = 0;
    lines
        .iter()
        .map(|line| match line.over {
            Some((x, y)) => (
                frame_width * x / 100.0,
                anchor_block(
                    frame_height * y / 100.0,
                    line.height + line.pad_v * 2.0,
                    line.align.unwrap_or(VerticalAlign::Center),
                ) + line.pad_v,
            ),
            None => {
                let pad_v = if padded { line.pad_v } else { 0.0 };
                let slot = line.slot(stack.count, padded);
                let align = line.align.unwrap_or_else(|| seam_align(rank, stack.count));
                let top = align_within(cursor, slot, line.height + pad_v * 2.0, align) + pad_v;
                cursor += slot + gap;
                rank += 1;
                (anchor_x, top)
            }
        })
        .collect()
}

/// 堆栈内所有行摆放之后的**字形**纵向范围 `(顶边, 底边)`，共享底板据此外扩 `pad_v` 画。
///
/// 对应 Mac `stackedLayout` 里 `insetBy(dx: -padH, dy: -padV)` 之前的 `extent`。
///
/// 槽位只钉接缝，折行的内容会长出自己的槽位，所以底板不能从 `total_height` 反推。
/// 每行都只占 1 行时结果恰好是 `(锚点 - 总高/2, 锚点 + 总高/2)`，逐比特还原现状。
pub fn stacked_span(placements: &[(f64, f64)], lines: &[LineBox]) -> Option<(f64, f64)> {
    placements
        .iter()
        .zip(lines)
        .filter(|(_, line)| line.over.is_none())
        .fold(None, |span, ((_, top), line)| {
            let (top, bottom) = (*top, top + line.height);
            Some(span.map_or((top, bottom), |(high, low): (f64, f64)| {
                (high.min(top), low.max(bottom))
            }))
        })
}

pub fn group_transform(
    center_x: f64,
    center_y: f64,
    scale_x: f64,
    scale_y: f64,
    rotation: f64,
) -> Transform {
    Transform::from_translate(-(center_x as f32), -(center_y as f32))
        .post_scale(scale_x as f32, scale_y as f32)
        .post_rotate(rotation as f32)
        .post_translate(center_x as f32, center_y as f32)
}

/// Orthographic projection of the track's X/Z rotation. Unlike a CSS
/// perspective(6em), this has no viewport/font-dependent vanishing point.
pub fn group_transform_for_motion(
    pose: &word_motion::Pose,
    x: f64,
    y: f64,
    height: f64,
) -> Transform {
    let [a, b, c, d] = word_motion::projected_matrix(pose);
    Transform::from_translate(-(x as f32), -(y as f32))
        .post_concat(Transform::from_row(
            a as f32, b as f32, c as f32, d as f32, 0.0, 0.0,
        ))
        .post_translate(x as f32, (y + pose.dy * height) as f32)
}

pub fn layout_motion(
    layout: &LineLayout,
    animation: &WordAnimation,
) -> Option<word_motion::MotionFrame> {
    animation
        .motion_id
        .as_deref()
        .filter(|_| animation.caption.is_none() && layout.kind == LineKind::Original)
        .map(|id| motion_for_item(id, &layout.item, layout.render_time))
}

#[allow(clippy::too_many_arguments)]
fn motion_chunk_transform(
    motion: Option<&word_motion::MotionFrame>,
    chunk: &GlyphChunk,
    cursor: f64,
    center_x: f64,
    top: f64,
    height: f64,
    line_top: f64,
    line_height: f64,
) -> Transform {
    let Some(pose) = motion.and_then(|f| chunk.word.and_then(|i| f.words.get(i))) else {
        return Transform::identity();
    };
    let word_center = cursor + chunk.width / 2.0;
    word_transform_for_motion(
        pose,
        word_center,
        line_top + line_height / 2.0,
        center_x,
        top + height / 2.0,
        line_height,
    )
}

pub fn word_transform_for_motion(
    pose: &word_motion::Pose,
    word_center: f64,
    line_center: f64,
    center_x: f64,
    center_y: f64,
    line_height: f64,
) -> Transform {
    // A centered word first keeps its own pivot, then moves into the block's
    // center. Scaling about the block before that move would leave a residual
    // offset. Non-centered blockScaling uses the block center on both axes.
    let block_pivot = pose.block_scaled && !pose.centered;
    let pivot_x = if block_pivot { center_x } else { word_center };
    let pivot_y = if block_pivot { center_y } else { line_center };
    let mut transform = group_transform_for_motion(pose, pivot_x, pivot_y, line_height);
    if pose.centered {
        transform = transform.post_translate(
            (center_x - word_center) as f32,
            (center_y - line_center) as f32,
        );
    }
    transform
}

/// CPU raster 与 R2 glyph scene 共用的基线口径。
pub fn glyph_baseline(line_top: f64, line_height: f64, chunk: &GlyphChunk, bounce: f64) -> f64 {
    line_top + (line_height + chunk.shaped.ascent - chunk.shaped.descent) / 2.0 - bounce
}

/// CPU raster 与 R2 glyph scene 共用的单字形画布变换。先在字形局部应用合成
/// italic，再落到基线，之后依次接配方 pose 与整组 pose。
pub fn glyph_canvas_transform(
    chunk: &GlyphChunk,
    glyph_x: f64,
    glyph_y: f64,
    recipe_transform: Transform,
    group_transform: Transform,
) -> Transform {
    let italic = if chunk.italic {
        Transform::from_skew(-0.18, 0.0)
    } else {
        Transform::identity()
    };
    italic
        .post_translate(glyph_x as f32, glyph_y as f32)
        .post_concat(recipe_transform)
        .post_concat(group_transform)
}

pub fn paint(color: SubtitleColor, opacity: f64) -> Paint<'static> {
    let mut paint = Paint::default();
    let alpha = ((255 - color.a) as f64 * clamp(opacity, 0.0, 1.0)).round() as u8;
    paint.set_color_rgba8(color.r, color.g, color.b, alpha);
    paint.anti_alias = true;
    paint
}

pub fn rounded_rect_path(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
) -> Option<tiny_skia::Path> {
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    let radius = radius.min(width / 2.0).min(height / 2.0).max(0.0);
    let (x, y, width, height, radius) = (
        x as f32,
        y as f32,
        width as f32,
        height as f32,
        radius as f32,
    );
    let mut path = PathBuilder::new();
    path.move_to(x + radius, y);
    path.line_to(x + width - radius, y);
    path.quad_to(x + width, y, x + width, y + radius);
    path.line_to(x + width, y + height - radius);
    path.quad_to(x + width, y + height, x + width - radius, y + height);
    path.line_to(x + radius, y + height);
    path.quad_to(x, y + height, x, y + height - radius);
    path.line_to(x, y + radius);
    path.quad_to(x, y, x + radius, y);
    path.close();
    path.finish()
}

#[allow(clippy::too_many_arguments)]
pub fn fill_round_rect(
    pixmap: &mut Pixmap,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
    color: SubtitleColor,
    opacity: f64,
    transform: Transform,
) -> DrawBounds {
    let mut bounds = DrawBounds::default();
    if let Some(path) = rounded_rect_path(x, y, width, height, radius) {
        pixmap.fill_path(
            &path,
            &paint(color, opacity),
            FillRule::Winding,
            transform,
            None,
        );
        bounds.add_filled(&path, transform);
    }
    bounds
}

pub fn caption_recipe_transform(
    layout: &LineLayout,
    chunk: &GlyphChunk,
    cursor: f64,
    line_top: f64,
    line_height: f64,
    state: Option<&CaptionRecipeResolvedWord>,
) -> Transform {
    let Some(state) = state else {
        return Transform::identity();
    };
    let center_x = cursor + chunk.width / 2.0;
    let center_y = line_top + line_height / 2.0;
    let dx_base = layout.width.max(layout.style.font_size * 12.0);
    group_transform(
        center_x,
        center_y,
        state.scale_x,
        state.scale_y,
        state.rotation,
    )
    .post_translate(
        (state.dx * dx_base) as f32,
        (state.dy * layout.style.font_size * 2.4) as f32,
    )
}

pub fn caption_recipe_composite_mode(animation: &WordAnimation) -> CaptionCompositeMode {
    let Some(design) = animation.caption.as_ref() else {
        return CaptionCompositeMode::Normal;
    };
    let authored = design.text_option("composite").or_else(|| {
        caption_recipe_design_descriptor(design).map(|descriptor| descriptor.composite.as_str())
    });
    match authored {
        Some("difference") => CaptionCompositeMode::Difference,
        Some("exclusion") => CaptionCompositeMode::Exclusion,
        Some("screen") => CaptionCompositeMode::Screen,
        _ => CaptionCompositeMode::Normal,
    }
}

pub fn caption_recipe_blend_mode(animation: &WordAnimation) -> tiny_skia::BlendMode {
    match caption_recipe_composite_mode(animation) {
        CaptionCompositeMode::Normal => tiny_skia::BlendMode::SourceOver,
        CaptionCompositeMode::Difference => tiny_skia::BlendMode::Difference,
        CaptionCompositeMode::Exclusion => tiny_skia::BlendMode::Exclusion,
        CaptionCompositeMode::Screen => tiny_skia::BlendMode::Screen,
    }
}

pub fn caption_recipe_paint(
    animation: &WordAnimation,
    color: SubtitleColor,
    opacity: f64,
) -> Paint<'static> {
    let mut value = paint(color, opacity);
    value.blend_mode = caption_recipe_blend_mode(animation);
    value
}

pub fn caption_recipe_color(color: SubtitleColor, opacity: f64) -> Color {
    let alpha = ((255 - color.a) as f64 * opacity.clamp(0.0, 1.0)).round() as u8;
    Color::from_rgba8(color.r, color.g, color.b, alpha)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptionRepeatLinearGradient {
    pub start: [f64; 2],
    pub end: [f64; 2],
    pub first: SubtitleColor,
    pub middle: SubtitleColor,
}

/// CPU tiny-skia 与 retained glyph scene 共用的 Designed Caption 渐变参数。
/// 相位先量化到 31 段，保持历史 recipe 的确定性；坐标属于单个字形的本地轮廓，
/// 后续由各执行器与字形 transform 一起映射到画布。
pub fn caption_recipe_repeat_linear_gradient(
    animation: &WordAnimation,
    visual: &WordVisual,
) -> Option<CaptionRepeatLinearGradient> {
    let (Some(design), Some(state)) = (animation.caption.as_ref(), visual.recipe.as_ref()) else {
        return None;
    };
    let descriptor = caption_recipe_design_descriptor(design)?;
    if !descriptor
        .layers
        .iter()
        .any(|layer| layer == "gradientFill")
    {
        return None;
    }
    let phase = (state.fill_progress.clamp(0.0, 1.0) * 31.0).round();
    let shift = phase / 31.0 * 192.0 * 0.45;
    Some(CaptionRepeatLinearGradient {
        start: [-shift, 0.0],
        end: [192.0 - shift, 0.0],
        first: design.primary,
        middle: design.accent,
    })
}

pub fn caption_recipe_textures() -> &'static HashMap<&'static str, Pixmap> {
    static TEXTURES: std::sync::OnceLock<HashMap<&'static str, Pixmap>> =
        std::sync::OnceLock::new();
    TEXTURES.get_or_init(|| {
        CAPTION_TEXTURE_FILES
            .iter()
            .map(|(name, bytes)| {
                let pixmap = Pixmap::decode_png(bytes)
                    .expect("bundled GPUI caption texture must be a valid PNG");
                (*name, pixmap)
            })
            .collect()
    })
}

pub fn caption_recipe_texture(
    descriptor: &CaptionRecipeDescriptor,
    design: &DesignedCaption,
) -> Option<&'static Pixmap> {
    let filename = caption_recipe_texture_filename(descriptor, design)?;
    caption_recipe_textures().get(filename)
}

/// Designed Caption 选择的规范纹理文件名。CPU reference 与 retained scene
/// 必须共用这条默认/override 解析，不能各自猜第一张资产。
pub fn caption_recipe_texture_filename<'a>(
    descriptor: &'a CaptionRecipeDescriptor,
    design: &DesignedCaption,
) -> Option<&'a str> {
    let requested = design.text_option("texture");
    requested
        .and_then(|requested| {
            descriptor.assets.iter().find_map(|asset| {
                Path::new(&asset.file)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .filter(|stem| *stem == requested)
                    .map(|_| asset.file.as_str())
            })
        })
        .or_else(|| descriptor.assets.first().map(|asset| asset.file.as_str()))
}

pub fn caption_recipe_uses_texture_fill(animation: &WordAnimation) -> bool {
    animation
        .caption
        .as_ref()
        .and_then(caption_recipe_design_descriptor)
        .is_some_and(|descriptor| descriptor.layers.iter().any(|layer| layer == "textureFill"))
}

pub fn caption_recipe_glyph_texture_available(animation: &WordAnimation) -> bool {
    let Some(design) = animation.caption.as_ref() else {
        return false;
    };
    let Some(descriptor) = caption_recipe_design_descriptor(design) else {
        return false;
    };
    caption_recipe_texture_filename(descriptor, design).is_some_and(|filename| {
        CAPTION_TEXTURE_FILES
            .iter()
            .any(|(bundled, _)| *bundled == filename)
    })
}

/// CPU 已解码的规范纹理 → renderer-neutral premultiplied RGBA8 资源。内容 key
/// 截取 SHA-256 的前 128 bit；六张内置图案只在首次命中时复制一次，后续 scene
/// 与 compositor 都复用同一个 `Arc`。
pub fn caption_recipe_glyph_texture(
    animation: &WordAnimation,
) -> Option<Arc<element_draw::GlyphTexture>> {
    use sha2::Digest as _;

    static TEXTURES: std::sync::OnceLock<HashMap<&'static str, Arc<element_draw::GlyphTexture>>> =
        std::sync::OnceLock::new();
    let textures = TEXTURES.get_or_init(|| {
        caption_recipe_textures()
            .iter()
            .map(|(&name, pixmap)| {
                let mut hasher = sha2::Sha256::new();
                hasher.update(pixmap.width().to_be_bytes());
                hasher.update(pixmap.height().to_be_bytes());
                hasher.update(pixmap.data());
                let digest = hasher.finalize();
                let key = element_draw::GlyphTextureKey([
                    u64::from_be_bytes(digest[0..8].try_into().expect("sha256 prefix")),
                    u64::from_be_bytes(digest[8..16].try_into().expect("sha256 prefix")),
                ]);
                let texture = element_draw::GlyphTexture::new(
                    key,
                    pixmap.width(),
                    pixmap.height(),
                    pixmap.data().to_vec(),
                )
                .expect("bundled caption texture is tightly packed RGBA8");
                (name, Arc::new(texture))
            })
            .collect()
    });
    let design = animation.caption.as_ref()?;
    let descriptor = caption_recipe_design_descriptor(design)?;
    let filename = caption_recipe_texture_filename(descriptor, design)?;
    textures.get(filename).cloned()
}

pub fn caption_recipe_glyph_paint(
    animation: &WordAnimation,
    visual: &WordVisual,
    color: SubtitleColor,
    opacity: f64,
    allow_pattern: bool,
) -> Option<Paint<'static>> {
    let mut value = caption_recipe_paint(animation, color, opacity);
    if !allow_pattern {
        return Some(value);
    }
    let (Some(design), Some(_)) = (animation.caption.as_ref(), visual.recipe.as_ref()) else {
        return Some(value);
    };
    let Some(descriptor) = caption_recipe_design_descriptor(design) else {
        return Some(value);
    };
    if let Some(gradient) = caption_recipe_repeat_linear_gradient(animation, visual) {
        value.shader = LinearGradient::new(
            Point::from_xy(gradient.start[0] as f32, gradient.start[1] as f32),
            Point::from_xy(gradient.end[0] as f32, gradient.end[1] as f32),
            vec![
                GradientStop::new(0.0, caption_recipe_color(gradient.first, opacity)),
                GradientStop::new(0.5, caption_recipe_color(gradient.middle, opacity)),
                GradientStop::new(1.0, caption_recipe_color(gradient.first, opacity)),
            ],
            SpreadMode::Repeat,
            Transform::identity(),
        )?;
    } else if descriptor.layers.iter().any(|layer| layer == "textureFill") {
        // 与 Mac 一致：缺失的规范材质是显式渲染失败，不能静默退化成平涂。
        let texture = caption_recipe_texture(descriptor, design)?;
        value.shader = Pattern::new(
            texture.as_ref(),
            SpreadMode::Repeat,
            FilterQuality::Bilinear,
            opacity.clamp(0.0, 1.0) as f32,
            Transform::identity(),
        );
    }
    Some(value)
}

/// Designed Caption `glyphDuplicate` 的单层参数。偏移仍在字形局部坐标中，
/// 因而 CPU 可以在完整 glyph transform 之前应用；retained scene 会先把它经过
/// synthetic italic 的线性部分，再写入 run uniform，得到同一画布位置。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptionRecipeGlyphDuplicate {
    pub dx: f64,
    pub dy: f64,
    pub color: SubtitleColor,
    pub opacity: f64,
}

pub fn caption_recipe_glyph_duplicate_layer_count(animation: &WordAnimation) -> usize {
    let Some(descriptor) = animation
        .caption
        .as_ref()
        .and_then(caption_recipe_design_descriptor)
        .filter(|descriptor| {
            descriptor
                .layers
                .iter()
                .any(|layer| layer == "glyphDuplicate")
        })
    else {
        return 0;
    };
    descriptor.glyph_duplicate_layers.unwrap_or(1).max(1)
}

/// `glyphDuplicate` 也被少数配方用作视觉分层元数据；只有描述子真的声明 `echo`
/// channel 时，CPU/GPU 才需要额外字形 pass。比如 editorial-emphasis 的尾置
/// `glyphDuplicate` 只通过 `colorMix` 改正文颜色，不能为它提交一层全透明字形。
pub fn caption_recipe_echo_duplicate_layer_count(animation: &WordAnimation) -> usize {
    let has_echo = animation
        .caption
        .as_ref()
        .and_then(caption_recipe_design_descriptor)
        .is_some_and(|descriptor| {
            descriptor
                .events
                .iter()
                .any(|event| event.channels.iter().any(|channel| channel == "echo"))
        });
    has_echo
        .then(|| caption_recipe_glyph_duplicate_layer_count(animation))
        .unwrap_or(0)
}

fn caption_recipe_rgb_split_duplicate_layer_count(animation: &WordAnimation) -> usize {
    animation
        .caption
        .as_ref()
        .and_then(caption_recipe_design_descriptor)
        .is_some_and(|descriptor| {
            descriptor
                .events
                .iter()
                .any(|event| event.channels.iter().any(|channel| channel == "rgbSplit"))
                && descriptor
                    .layers
                    .iter()
                    .any(|layer| layer == "glyphDuplicate")
        })
        .then_some(2)
        .unwrap_or(0)
}

/// retained scene 为所有可能出现的字形副本预留固定 run 数。当前 echo 使用描述子
/// 声明的层数，RGB split 精确对应 CPU 的 red/cyan 两层；透明阶段仍保留节点。
pub fn caption_recipe_retained_duplicate_layer_count(animation: &WordAnimation) -> usize {
    caption_recipe_echo_duplicate_layer_count(animation)
        + caption_recipe_rgb_split_duplicate_layer_count(animation)
}

/// CPU reference 与 retained glyph scene 共用的 echo 层参数。即使当前 echo 为零也
/// 返回描述子声明的固定层数；scene 因此能保住节点/Arc 身份，只把透明度写成零。
pub fn caption_recipe_glyph_duplicate_layers(
    layout: &LineLayout,
    animation: &WordAnimation,
    visual: &WordVisual,
    opacity: f64,
) -> Vec<CaptionRecipeGlyphDuplicate> {
    let Some(state) = visual.recipe.as_ref() else {
        return Vec::new();
    };
    let count = caption_recipe_echo_duplicate_layer_count(animation);
    (0..count)
        .map(|layer| {
            let gain = (layer + 1) as f64 / count as f64;
            let echo = state.echo * gain;
            CaptionRecipeGlyphDuplicate {
                dx: -layout.style.font_size * (0.08 + echo * 0.12),
                dy: layout.style.font_size * (0.06 + echo * 0.08),
                color: visual.color.unwrap_or(layout.style.color),
                opacity: opacity * (echo * 0.45).min(0.55),
            }
        })
        .collect()
}

pub fn caption_recipe_rgb_split_duplicate_layers(
    layout: &LineLayout,
    animation: &WordAnimation,
    visual: &WordVisual,
    opacity: f64,
) -> Vec<CaptionRecipeGlyphDuplicate> {
    let Some(state) = visual.recipe.as_ref() else {
        return Vec::new();
    };
    if caption_recipe_rgb_split_duplicate_layer_count(animation) == 0 {
        return Vec::new();
    }
    let offset = layout.style.font_size * state.rgb_split;
    [
        SubtitleColor {
            r: 255,
            g: 59,
            b: 48,
            a: 0,
        },
        SubtitleColor {
            r: 50,
            g: 215,
            b: 255,
            a: 0,
        },
    ]
    .into_iter()
    .zip([-offset, offset])
    .map(|(color, dx)| CaptionRecipeGlyphDuplicate {
        dx,
        dy: 0.0,
        color,
        opacity: opacity * 0.72 * f64::from(state.rgb_split > 0.001),
    })
    .collect()
}

pub fn caption_recipe_retained_glyph_duplicate_layers(
    layout: &LineLayout,
    animation: &WordAnimation,
    visual: &WordVisual,
    opacity: f64,
) -> Vec<CaptionRecipeGlyphDuplicate> {
    let mut layers = caption_recipe_glyph_duplicate_layers(layout, animation, visual, opacity);
    layers.extend(caption_recipe_rgb_split_duplicate_layers(
        layout, animation, visual, opacity,
    ));
    layers
}

/// CPU 把 duplicate translation 放在 synthetic italic 之前；GPU 的稳定 geometry
/// 已经包含 italic，所以要把局部向量先乘其线性部分，再作为 run translation。
pub fn glyph_duplicate_canvas_offset(
    chunk: &GlyphChunk,
    duplicate: CaptionRecipeGlyphDuplicate,
) -> (f64, f64) {
    if chunk.italic {
        (duplicate.dx - duplicate.dy * 0.18, duplicate.dy)
    } else {
        (duplicate.dx, duplicate.dy)
    }
}

/// Designed Caption 在正文 outline/fill 之前追加的程序化字形描边。CPU reference
/// 直接 stroke 原始轮廓；retained scene 用同一组 width/color/opacity 驱动稳定
/// alpha mask 的 dilation shader，避免逐帧重建字形 mask。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptionRecipeGlyphStroke {
    pub width: f64,
    pub color: SubtitleColor,
    pub opacity: f64,
}

pub fn caption_recipe_retained_stroke_layer_count(animation: &WordAnimation) -> usize {
    let Some(descriptor) = animation
        .caption
        .as_ref()
        .and_then(caption_recipe_design_descriptor)
    else {
        return 0;
    };
    let glow = descriptor
        .events
        .iter()
        .any(|event| event.channels.iter().any(|channel| channel == "glowGain"))
        .then(|| descriptor.glow_layers.unwrap_or(3).max(1))
        .unwrap_or(0);
    let weight = usize::from(
        descriptor
            .events
            .iter()
            .any(|event| event.channels.iter().any(|channel| channel == "weightAxis")),
    );
    glow + weight
}

/// 描述子在任意 keyframe 可能要求的最大完整 stroke width。能力门在取得 GPU
/// ownership 前先用它核对固定扩边预算，避免播放到峰值阶段才临时回退。
pub fn caption_recipe_max_stroke_width(animation: &WordAnimation, font_size: f64) -> f64 {
    let Some(descriptor) = animation
        .caption
        .as_ref()
        .and_then(caption_recipe_design_descriptor)
    else {
        return 0.0;
    };
    let channel_max = |channel: &str| {
        descriptor
            .events
            .iter()
            .filter_map(|event| event.keyframes.get(channel))
            .flatten()
            .map(|key| key.value.max(0.0))
            .fold(0.0, f64::max)
    };
    let glow = font_size.max(0.0) * (0.035 + 0.11) * channel_max("glowGain");
    let weight = (channel_max("weightAxis") / 380.0 * 3.2).min(4.5);
    glow.max(weight)
}

/// CPU 与 retained scene 共用 neon/weight 的逐层描边参数。`retain_transparent`
/// 为真时返回描述子声明的固定层数；效果未活动的层只把 opacity/width 置零，
/// 让跨帧节点、glyph Arc 与 atlas placement 保持不变。
pub fn caption_recipe_glyph_stroke_layers(
    layout: &LineLayout,
    animation: &WordAnimation,
    visual: &WordVisual,
    opacity: f64,
    retain_transparent: bool,
) -> Vec<CaptionRecipeGlyphStroke> {
    let (Some(design), Some(descriptor)) = (
        animation.caption.as_ref(),
        animation
            .caption
            .as_ref()
            .and_then(caption_recipe_design_descriptor),
    ) else {
        return Vec::new();
    };
    let state = visual.recipe.as_ref();
    let mut strokes = Vec::with_capacity(caption_recipe_retained_stroke_layer_count(animation));
    if descriptor
        .events
        .iter()
        .any(|event| event.channels.iter().any(|channel| channel == "glowGain"))
    {
        let layers = descriptor.glow_layers.unwrap_or(3).max(1);
        let glow_gain = state.map_or(0.0, |state| state.glow_gain);
        if retain_transparent || glow_gain > 0.001 {
            for layer in (1..=layers).rev() {
                let fraction = layer as f64 / layers as f64;
                strokes.push(CaptionRecipeGlyphStroke {
                    width: layout.style.font_size * (0.035 + fraction * 0.11) * glow_gain,
                    color: design.accent,
                    opacity: opacity
                        * (0.24 / layer as f64)
                        * glow_gain.min(1.4)
                        * f64::from(glow_gain > 0.001),
                });
            }
        }
    }
    if descriptor
        .events
        .iter()
        .any(|event| event.channels.iter().any(|channel| channel == "weightAxis"))
    {
        let weight_axis = state.map_or(0.0, |state| state.weight_axis);
        if retain_transparent || weight_axis > 0.001 {
            strokes.push(CaptionRecipeGlyphStroke {
                width: (weight_axis / 380.0 * 3.2).min(4.5),
                color: visual.color.unwrap_or(layout.style.color),
                opacity: opacity * f64::from(weight_axis > 0.001),
            });
        }
    }
    strokes
}

/// 粒子与扫描线在 CPU reference / retained scene 间共享的逻辑几何。圆形用
/// `radius == min(width,height)/2` 表达，GPU 仍只提交固定 quad。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptionRecipeRoundedDecoration {
    pub rect: [f64; 4],
    pub radius: f64,
    pub color: SubtitleColor,
    pub opacity: f64,
}

#[allow(clippy::too_many_arguments)]
pub fn caption_recipe_rounded_decorations(
    layout: &LineLayout,
    animation: &WordAnimation,
    visual: &WordVisual,
    word_index: Option<usize>,
    cursor: f64,
    chunk_width: f64,
    line_top: f64,
    line_height: f64,
    opacity: f64,
    retain_transparent: bool,
) -> Vec<CaptionRecipeRoundedDecoration> {
    let (Some(design), Some(state)) = (animation.caption.as_ref(), visual.recipe.as_ref()) else {
        return Vec::new();
    };
    let Some(descriptor) = caption_recipe_design_descriptor(design) else {
        return Vec::new();
    };
    let mut decorations = Vec::new();
    let center_x = cursor + chunk_width / 2.0;
    let center_y = line_top + line_height / 2.0;
    let particle_role_supported = descriptor.events.iter().any(|event| {
        event.channels.iter().any(|channel| channel == "burst")
            && event
                .roles
                .as_ref()
                .is_none_or(|roles| roles.iter().any(|role| role == &state.role))
    });
    let particles = if retain_transparent
        && descriptor.layers.iter().any(|layer| layer == "particles")
        && particle_role_supported
        && let Some(word) = word_index.and_then(|index| layout.item.words.get(index))
    {
        let count = design
            .number_option("particleCount")
            .unwrap_or(16.0)
            .clamp(0.0, 24.0) as usize;
        let seed = caption_recipe_word_seed(design, &layout.item.id, word);
        caption_recipe_particle_templates(seed, count)
            .into_iter()
            .map(|template| {
                let phase = ((state.burst - template.lag) / (1.0 - template.lag).max(0.0001))
                    .clamp(0.0, 1.0);
                CaptionRecipeParticle {
                    dx: template.angle.cos() * template.distance * phase,
                    dy: template.angle.sin() * template.distance * phase + phase * phase * 0.38,
                    radius: template.radius,
                    opacity: if (0.0..1.0).contains(&phase) {
                        (1.0 - phase) * (1.0 - phase)
                    } else {
                        0.0
                    },
                }
            })
            .collect::<Vec<_>>()
    } else {
        state.particles.clone()
    };
    for particle in particles {
        if !retain_transparent && particle.opacity <= 0.001 {
            continue;
        }
        let radius = layout.style.font_size * particle.radius;
        let x = center_x + particle.dx * layout.style.font_size * 1.8;
        let y = center_y + particle.dy * layout.style.font_size * 1.8;
        decorations.push(CaptionRecipeRoundedDecoration {
            rect: [x - radius, y - radius, radius * 2.0, radius * 2.0],
            radius,
            color: design.accent,
            opacity: opacity * particle.opacity,
        });
    }
    if descriptor.layers.iter().any(|layer| layer == "scanlines")
        && (retain_transparent || state.rgb_split > 0.001)
    {
        let stride = (layout.style.font_size * 0.12).max(2.0);
        let mut y = line_top;
        while y < line_top + line_height {
            decorations.push(CaptionRecipeRoundedDecoration {
                rect: [cursor, y, chunk_width, (stride * 0.18).max(1.0)],
                radius: 0.0,
                color: design.accent,
                opacity: opacity * 0.18 * f64::from(state.rgb_split > 0.001),
            });
            y += stride;
        }
    }
    decorations
}

pub fn caption_recipe_clip_box(
    cursor: f64,
    line_top: f64,
    width: f64,
    height: f64,
    state: Option<&CaptionRecipeResolvedWord>,
) -> Option<[f64; 4]> {
    let state = state?;
    if state.clip_l <= 0.0 && state.clip_r <= 0.0 && state.clip_t <= 0.0 && state.clip_b <= 0.0 {
        return None;
    }
    let left = state.clip_l.clamp(0.0, 1.0);
    let right = state.clip_r.clamp(0.0, 1.0);
    let top = state.clip_t.clamp(0.0, 1.0);
    let bottom = state.clip_b.clamp(0.0, 1.0);
    Some([
        cursor + width * left,
        line_top + height * top,
        width * (1.0 - left - right).max(0.0),
        height * (1.0 - top - bottom).max(0.0),
    ])
}

#[allow(clippy::too_many_arguments)]
pub fn caption_recipe_clip_mask(
    pixmap: &Pixmap,
    cursor: f64,
    line_top: f64,
    width: f64,
    height: f64,
    state: Option<&CaptionRecipeResolvedWord>,
    transform: Transform,
) -> Option<PixmapMask> {
    let [left, top, clip_width, clip_height] =
        caption_recipe_clip_box(cursor, line_top, width, height, state)?;
    let mut mask = PixmapMask::new(pixmap.width(), pixmap.height())?;
    if let Some(path) = rounded_rect_path(left, top, clip_width, clip_height, 0.0) {
        mask.fill_path(&path, FillRule::Winding, false, transform);
    }
    Some(mask)
}

#[allow(clippy::too_many_arguments)]
pub fn draw_caption_recipe_decorations(
    pixmap: &mut Pixmap,
    text_engine: &mut TextEngine,
    layout: &LineLayout,
    animation: &WordAnimation,
    visual: &WordVisual,
    word_index: Option<usize>,
    cursor: f64,
    chunk_width: f64,
    line_top: f64,
    line_height: f64,
    opacity: f64,
    group_transform: Transform,
) -> DrawBounds {
    let mut bounds = DrawBounds::default();
    let (Some(design), Some(state)) = (animation.caption.as_ref(), visual.recipe.as_ref()) else {
        return bounds;
    };
    let Some(_) = caption_recipe_design_descriptor(design) else {
        return bounds;
    };
    for decoration in caption_recipe_rounded_decorations(
        layout,
        animation,
        visual,
        word_index,
        cursor,
        chunk_width,
        line_top,
        line_height,
        opacity,
        false,
    ) {
        if decoration.radius > 0.0
            && (decoration.rect[2] - decoration.radius * 2.0).abs() < 1e-9
            && (decoration.rect[3] - decoration.radius * 2.0).abs() < 1e-9
            && let Some(path) = PathBuilder::from_circle(
                (decoration.rect[0] + decoration.radius) as f32,
                (decoration.rect[1] + decoration.radius) as f32,
                decoration.radius as f32,
            )
        {
            pixmap.fill_path(
                &path,
                &caption_recipe_paint(animation, decoration.color, decoration.opacity),
                FillRule::Winding,
                group_transform,
                None,
            );
            bounds.add_filled(&path, group_transform);
        } else {
            bounds.merge(fill_round_rect(
                pixmap,
                decoration.rect[0],
                decoration.rect[1],
                decoration.rect[2],
                decoration.rect[3],
                decoration.radius,
                decoration.color,
                decoration.opacity,
                group_transform,
            ));
        }
    }
    let Some(emoji) = state.emoji.as_deref().filter(|emoji| !emoji.is_empty()) else {
        return bounds;
    };
    let size = layout.style.font_size * 0.62;
    let shaped = text_engine.shape(emoji, &layout.style.font_name, size, 400);
    let x = cursor + chunk_width - layout.style.font_size * 0.08;
    let baseline = line_top - layout.style.font_size * 0.52 + shaped.ascent;
    for glyph in &shaped.glyphs {
        let local = Transform::from_translate((x + glyph.x) as f32, (baseline + glyph.y) as f32)
            .post_concat(group_transform);
        match text_engine.glyph_render(glyph.cache_key) {
            GlyphRender::Outline(path) => {
                pixmap.fill_path(
                    &path,
                    &caption_recipe_paint(animation, SubtitleColor::WHITE, opacity),
                    FillRule::Winding,
                    local,
                    None,
                );
                bounds.add_filled(&path, local);
            }
            GlyphRender::ColorBitmap {
                width,
                height,
                rgba,
                left,
                top,
            } => {
                let bitmap = PixmapRef::from_bytes(&rgba, width, height)
                    .expect("彩色字形 RGBA 尺寸已由 TextEngine 验证");
                let placement =
                    Transform::from_translate(left as f32, -top as f32).post_concat(local);
                pixmap.draw_pixmap(
                    0,
                    0,
                    bitmap,
                    &PixmapPaint {
                        opacity: opacity as f32,
                        quality: FilterQuality::Bilinear,
                        blend_mode: caption_recipe_blend_mode(animation),
                    },
                    placement,
                    None,
                );
                bounds.add_pixmap(width, height, placement);
            }
            GlyphRender::Empty => {}
        }
    }
    bounds
}

#[allow(clippy::too_many_arguments)]
pub fn draw_line_effect(
    pixmap: &mut Pixmap,
    text_engine: &mut TextEngine,
    layout: &LineLayout,
    animation: &WordAnimation,
    center_x: f64,
    top: f64,
    opacity: f64,
    group_transform: Transform,
) -> DrawBounds {
    if layout.style.text_motion.is_some() || layout.style.word_background.is_some() {
        return DrawBounds::default();
    }
    let mut bounds = DrawBounds::default();
    let motion = layout_motion(layout, animation);
    let height = layout.height;
    let (opacity, group_transform) = motion.as_ref().map_or((opacity, group_transform), |frame| {
        (
            opacity * frame.block.opacity,
            group_transform_for_motion(&frame.block, center_x, top + height / 2.0, height)
                .post_concat(group_transform),
        )
    });
    let mut line_top = top;
    for line in layout.lines.iter() {
        let line_height = line
            .height
            .max(layout.style.font_size * layout.style.line_height);
        let mut cursor = line_start_x(layout, line.width, center_x);
        for chunk in &line.chunks {
            let (part_opacity, part_dx, part_dy) = chunk_part_delta(layout, chunk);
            let visual = if layout.kind == LineKind::Original && animation.name != "None" {
                chunk
                    .word
                    .and_then(|index| {
                        layout.item.words.get(index).map(|_| {
                            word_visual(
                                animation,
                                &layout.item,
                                index,
                                layout.current_word,
                                layout.render_time,
                                layout.render_fps,
                            )
                        })
                    })
                    .unwrap_or_default()
            } else {
                WordVisual::default()
            };
            if visual.shadow_off {
                cursor += chunk.width;
                continue;
            }
            let chunk_opacity =
                opacity * part_opacity * clamp(visual.opacity.unwrap_or(1.0), 0.0, 1.0);
            let bounce = visual.bottom_em.unwrap_or(0.0) * layout.style.font_size;
            let baseline = glyph_baseline(line_top, line_height, chunk, bounce);
            let recipe_transform = caption_recipe_transform(
                layout,
                chunk,
                cursor + part_dx,
                line_top + part_dy,
                line_height,
                visual.recipe.as_ref(),
            );
            let recipe_transform = motion_chunk_transform(
                motion.as_ref(),
                chunk,
                cursor,
                center_x,
                top,
                height,
                line_top,
                line_height,
            )
            .post_concat(recipe_transform);
            let clip_mask = caption_recipe_clip_mask(
                pixmap,
                cursor + part_dx,
                line_top + part_dy,
                chunk.width,
                line_height,
                visual.recipe.as_ref(),
                recipe_transform.post_concat(group_transform),
            );
            let replacement = visual
                .recipe
                .as_ref()
                .and_then(|state| state.text_swap.as_deref())
                .map(|text| {
                    text_engine.shape(text, &chunk.font_name, chunk.font_size, chunk.font_weight)
                });
            let shaped = replacement.as_ref().unwrap_or(&chunk.shaped);
            for (glyph_index, glyph) in shaped.glyphs.iter().enumerate() {
                // 彩色位图字形（emoji）没有可投影的轮廓：效果层直接跳过，位图本身
                // 仍由 draw_line_layout 画出来。
                let GlyphRender::Outline(path) = text_engine.glyph_render(glyph.cache_key) else {
                    continue;
                };
                let glyph_x =
                    cursor + glyph.x + glyph_index as f64 * layout.style.letter_spacing + part_dx;
                let local = glyph_canvas_transform(
                    chunk,
                    glyph_x,
                    baseline + glyph.y + part_dy,
                    recipe_transform,
                    group_transform,
                );
                let effect_transform = Transform::from_translate(
                    layout.style.effect_x as f32,
                    layout.style.effect_y as f32,
                )
                .post_concat(local);
                // Mac `SubtitleFrameDrawing` 的 paint-order 是「带阴影的描边在下、
                // 干净的填充在上」，也就是阴影/发光是**描边后**的轮廓投出来的。
                // 效果层只 fill 的话，开描边时阴影会比预览细一圈甚至看不见。
                //
                // 这里不区分发光和阴影是有意的：`SubtitleFrameDrawing.swift:544-551`
                // 的发光轮次跑在 :565 把 `.strokeWidth` 翻正之前，属性此刻仍是负值
                // （AppKit 语义＝描边＋填充一起画），所以发光同样是从描边后的轮廓
                // 糊出来的。两种效果在 `resolve_line_style` 里本来也共用一个
                // effect 槽位（那里有对应的缺口说明）。
                if layout.style.outline_on && layout.style.outline_width > 0.0 {
                    let stroke = Stroke {
                        width: layout.style.outline_width as f32,
                        ..Stroke::default()
                    };
                    pixmap.stroke_path(
                        &path,
                        &paint(layout.style.effect_color, chunk_opacity),
                        &stroke,
                        effect_transform,
                        clip_mask.as_ref(),
                    );
                    bounds.add_stroked(&path, effect_transform, stroke.width);
                }
                pixmap.fill_path(
                    &path,
                    &paint(layout.style.effect_color, chunk_opacity),
                    FillRule::Winding,
                    effect_transform,
                    clip_mask.as_ref(),
                );
                bounds.add_filled(&path, effect_transform);
            }
            cursor += chunk.width;
        }
        line_top += line_height + line.gap_after;
    }
    bounds
}

pub fn caption_recipe_word_rects(
    layout: &LineLayout,
    center_x: f64,
    top: f64,
) -> Vec<Option<(f64, f64, f64, f64)>> {
    let mut rects = vec![None; layout.item.words.len()];
    let mut line_top = top;
    for line in layout.lines.iter() {
        let line_height = line
            .height
            .max(layout.style.font_size * layout.style.line_height);
        let mut cursor = line_start_x(layout, line.width, center_x);
        for chunk in &line.chunks {
            if let Some(index) = chunk.word
                && index < rects.len()
            {
                let text_height = (chunk.shaped.ascent + chunk.shaped.descent)
                    .max(chunk.font_size)
                    .min(line_height);
                let text_top = line_top + (line_height - text_height) / 2.0;
                rects[index] = Some((cursor, text_top, chunk.width, text_height));
            }
            cursor += chunk.width;
        }
        line_top += line_height + line.gap_after;
    }
    rects
}

pub fn caption_recipe_pill_state(
    layout: &LineLayout,
    animation: &WordAnimation,
) -> Option<(usize, CaptionRecipeResolvedWord)> {
    let design = animation.caption.as_ref()?;
    let descriptor = caption_recipe_design_descriptor(design)?;
    if !descriptor.layers.iter().any(|layer| layer == "pill") {
        return None;
    }
    (0..layout.item.words.len())
        .filter_map(|index| {
            resolve_caption_recipe_word(
                design,
                &layout.item,
                index,
                layout.render_time,
                layout.render_fps,
            )
            .filter(|word| word.plate_progress > 0.001)
            .map(|word| (index, word))
        })
        .max_by(|(_, left), (_, right)| left.plate_x.total_cmp(&right.plate_x))
}

/// Designed Caption 的程序化底板。这里保存的是画布坐标和**不含 scene/group**
/// 的 alpha；CPU reference 在绘制时叠 `opacity`，retained scene 则把同一份值写进
/// rounded-rect uniform，再由 node pose 叠 group opacity。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptionRecipePlate {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub radius: f64,
    pub color: SubtitleColor,
    pub opacity: f64,
}

#[allow(clippy::too_many_arguments)]
pub fn caption_recipe_plate(
    layout: &LineLayout,
    animation: &WordAnimation,
    visual: &WordVisual,
    chunk: &GlyphChunk,
    cursor: f64,
    line_top: f64,
    line_height: f64,
    part_opacity: f64,
    part_dx: f64,
    part_dy: f64,
    bounce: f64,
    word_rects: &[Option<(f64, f64, f64, f64)>],
    pill_state: Option<&(usize, CaptionRecipeResolvedWord)>,
    pill_groups: Option<&[usize]>,
) -> Option<CaptionRecipePlate> {
    if let (Some((selected, state)), Some(groups), Some(index)) =
        (pill_state, pill_groups, chunk.word)
        && index == *selected
        && let Some((destination_x, destination_y, destination_w, destination_h)) =
            word_rects.get(index).copied().flatten()
    {
        let previous = (0..index)
            .rev()
            .find(|candidate| groups.get(*candidate) == groups.get(index))
            .and_then(|candidate| word_rects.get(candidate).copied().flatten());
        let travel = state.plate_x.clamp(0.0, 1.0);
        let (x, y, width, height) = previous.map_or(
            (destination_x, destination_y, destination_w, destination_h),
            |(source_x, source_y, source_w, source_h)| {
                (
                    source_x + (destination_x - source_x) * travel,
                    source_y + (destination_y - source_y) * travel,
                    source_w + (destination_w - source_w) * travel,
                    source_h + (destination_h - source_h) * travel,
                )
            },
        );
        let spread = layout.style.font_size * 0.12;
        return Some(CaptionRecipePlate {
            x: x - spread,
            y: y - spread,
            width: width + spread * 2.0,
            height: height + spread * 2.0,
            radius: layout.style.font_size * state.plate_radius,
            color: animation.caption.as_ref()?.accent,
            opacity: part_opacity * 0.92,
        });
    }

    if pill_state.is_none()
        && let (Some(background), Some(state)) = (visual.background, visual.recipe.as_ref())
    {
        let progress = state.plate_progress.clamp(0.0, 1.0);
        let spread = layout.style.font_size * (0.04 + progress * 0.12);
        let (word_x, text_top, word_width, word_height) = chunk
            .word
            .and_then(|index| word_rects.get(index).copied().flatten())
            .unwrap_or((
                cursor,
                line_top + (line_height - chunk.font_size) / 2.0,
                chunk.width,
                chunk.font_size,
            ));
        return Some(CaptionRecipePlate {
            x: word_x - spread + part_dx,
            y: text_top - spread - bounce + part_dy,
            width: (word_width + spread * 2.0) * progress.max(0.001),
            height: word_height + spread * 2.0,
            radius: layout.style.font_size * state.plate_radius,
            color: background,
            opacity: part_opacity * (0.25 + progress * 0.75),
        });
    }

    None
}

#[allow(clippy::too_many_arguments)]
pub fn draw_line_layout(
    pixmap: &mut Pixmap,
    text_engine: &mut TextEngine,
    layout: &LineLayout,
    animation: &WordAnimation,
    center_x: f64,
    top: f64,
    opacity: f64,
    group_transform: Transform,
) -> DrawBounds {
    if layout.style.text_motion.is_some() || layout.style.word_background.is_some() {
        return draw_text_motion_layout(
            pixmap,
            text_engine,
            layout,
            center_x,
            top,
            opacity,
            group_transform,
        );
    }
    let mut bounds = DrawBounds::default();
    let motion = layout_motion(layout, animation);
    let height = layout.height;
    let (opacity, group_transform) = motion.as_ref().map_or((opacity, group_transform), |frame| {
        let pose = &frame.block;
        let transform = group_transform_for_motion(pose, center_x, top + height / 2.0, height);
        (
            opacity * pose.opacity,
            transform.post_concat(group_transform),
        )
    });
    let word_rects = caption_recipe_word_rects(layout, center_x, top);
    let pill_state = caption_recipe_pill_state(layout, animation);
    let pill_groups = animation
        .caption
        .as_ref()
        .and_then(caption_recipe_design_descriptor)
        .filter(|descriptor| descriptor.layers.iter().any(|layer| layer == "pill"))
        .map(|descriptor| {
            caption_recipe_group_indices(&layout.item.words, descriptor.grouping.as_ref())
        });
    let mut line_top = top;
    for line in layout.lines.iter() {
        let line_height = line
            .height
            .max(layout.style.font_size * layout.style.line_height);
        let mut cursor = line_start_x(layout, line.width, center_x);
        for chunk in &line.chunks {
            let (part_opacity, part_dx, part_dy) = chunk_part_delta(layout, chunk);
            let visual = if layout.kind == LineKind::Original && animation.name != "None" {
                chunk
                    .word
                    .and_then(|index| {
                        layout.item.words.get(index).map(|_| {
                            word_visual(
                                animation,
                                &layout.item,
                                index,
                                layout.current_word,
                                layout.render_time,
                                layout.render_fps,
                            )
                        })
                    })
                    .unwrap_or_default()
            } else {
                WordVisual::default()
            };
            let chunk_opacity =
                opacity * part_opacity * clamp(visual.opacity.unwrap_or(1.0), 0.0, 1.0);
            let bounce = visual.bottom_em.unwrap_or(0.0) * layout.style.font_size;
            let baseline = glyph_baseline(line_top, line_height, chunk, bounce);
            let recipe_transform = caption_recipe_transform(
                layout,
                chunk,
                cursor + part_dx,
                line_top + part_dy,
                line_height,
                visual.recipe.as_ref(),
            );
            let recipe_transform = motion_chunk_transform(
                motion.as_ref(),
                chunk,
                cursor,
                center_x,
                top,
                height,
                line_top,
                line_height,
            )
            .post_concat(recipe_transform);
            let clip_mask = caption_recipe_clip_mask(
                pixmap,
                cursor + part_dx,
                line_top + part_dy,
                chunk.width,
                line_height,
                visual.recipe.as_ref(),
                recipe_transform.post_concat(group_transform),
            );
            bounds.merge(draw_caption_recipe_decorations(
                pixmap,
                text_engine,
                layout,
                animation,
                &visual,
                chunk.word,
                cursor + part_dx,
                chunk.width,
                line_top + part_dy,
                line_height,
                chunk_opacity,
                group_transform,
            ));
            if let Some(plate) = caption_recipe_plate(
                layout,
                animation,
                &visual,
                chunk,
                cursor,
                line_top,
                line_height,
                part_opacity,
                part_dx,
                part_dy,
                bounce,
                &word_rects,
                pill_state.as_ref(),
                pill_groups.as_deref(),
            ) {
                bounds.merge(fill_round_rect(
                    pixmap,
                    plate.x,
                    plate.y,
                    plate.width,
                    plate.height,
                    plate.radius,
                    plate.color,
                    opacity * plate.opacity,
                    group_transform,
                ));
            } else if visual.recipe.is_none()
                && let Some(background) = visual.background
            {
                // 经典逐词动画（Highlight / Custom）没有 recipe：底板是常量矩形，
                // 不走 plate 时间通道。几何口径与 Studio `canvas-stage.jsx` 的
                // highlight Rect 逐字段同源（0.14em 左右外扩、0.04em 上外扩、
                // 1.08em 高、borderRadiusEm 默认 0.25），对应 Mac
                // `SubtitleFrameAttribution` 的 `WordBox`。几何与 alpha 都走
                // `classic_word_box` / `classic_word_box_alpha`，与 GPU 场景侧
                // 同一份口径；有 `boxScale`/`boxOpacity` 轨时块按矩形中心胀缩、
                // alpha 与词自身的 opacity 分开（借用词 opacity 会把字一起淡掉）。
                //
                // 这条分支不能并进上面的 recipe 分支：`visual.recipe` 缺席时
                // plate 通道无从取值，一旦要求 recipe 存在，Highlight 的高亮块
                // 就完全不画。
                let box_rect = classic_word_box(
                    layout.style.font_size,
                    cursor,
                    chunk.width,
                    line_top,
                    line_height,
                    part_dx,
                    part_dy,
                    bounce,
                    &visual,
                );
                bounds.merge(fill_round_rect(
                    pixmap,
                    box_rect.x,
                    box_rect.y,
                    box_rect.width,
                    box_rect.height,
                    box_rect.radius,
                    background,
                    opacity * part_opacity * classic_word_box_alpha(&visual),
                    recipe_transform.post_concat(group_transform),
                ));
            }
            let replacement = visual
                .recipe
                .as_ref()
                .and_then(|state| state.text_swap.as_deref())
                .map(|text| {
                    text_engine.shape(text, &chunk.font_name, chunk.font_size, chunk.font_weight)
                });
            let shaped = replacement.as_ref().unwrap_or(&chunk.shaped);
            for (glyph_index, glyph) in shaped.glyphs.iter().enumerate() {
                let render = text_engine.glyph_render(glyph.cache_key);
                let glyph_x =
                    cursor + glyph.x + glyph_index as f64 * layout.style.letter_spacing + part_dx;
                let local = glyph_canvas_transform(
                    chunk,
                    glyph_x,
                    baseline + glyph.y + part_dy,
                    recipe_transform,
                    group_transform,
                );
                match render {
                    GlyphRender::Outline(path) => {
                        if animation.caption.is_some()
                            && let Some(state) = visual.recipe.as_ref()
                        {
                            if state.echo > 0.001 {
                                for duplicate in caption_recipe_glyph_duplicate_layers(
                                    layout,
                                    animation,
                                    &visual,
                                    chunk_opacity,
                                ) {
                                    let transform = Transform::from_translate(
                                        duplicate.dx as f32,
                                        duplicate.dy as f32,
                                    )
                                    .post_concat(local);
                                    pixmap.fill_path(
                                        &path,
                                        &caption_recipe_paint(
                                            animation,
                                            duplicate.color,
                                            duplicate.opacity,
                                        ),
                                        FillRule::Winding,
                                        transform,
                                        clip_mask.as_ref(),
                                    );
                                    bounds.add_filled(&path, transform);
                                }
                            }
                            if state.rgb_split > 0.001 {
                                for duplicate in caption_recipe_rgb_split_duplicate_layers(
                                    layout,
                                    animation,
                                    &visual,
                                    chunk_opacity,
                                ) {
                                    let split = Transform::from_translate(duplicate.dx as f32, 0.0)
                                        .post_concat(local);
                                    pixmap.fill_path(
                                        &path,
                                        &caption_recipe_paint(
                                            animation,
                                            duplicate.color,
                                            duplicate.opacity,
                                        ),
                                        FillRule::Winding,
                                        split,
                                        clip_mask.as_ref(),
                                    );
                                    bounds.add_filled(&path, split);
                                }
                            }
                            for recipe_stroke in caption_recipe_glyph_stroke_layers(
                                layout,
                                animation,
                                &visual,
                                chunk_opacity,
                                false,
                            ) {
                                let stroke = Stroke {
                                    width: recipe_stroke.width as f32,
                                    ..Stroke::default()
                                };
                                pixmap.stroke_path(
                                    &path,
                                    &caption_recipe_paint(
                                        animation,
                                        recipe_stroke.color,
                                        recipe_stroke.opacity,
                                    ),
                                    &stroke,
                                    local,
                                    clip_mask.as_ref(),
                                );
                                bounds.add_stroked(&path, local, stroke.width);
                            }
                        }
                        if layout.style.outline_on {
                            let stroke = Stroke {
                                // tiny-skia 与 Konva 的描边都跨轮廓居中；持久化的
                                // `textOutline.width` 百分比描述的是**可见外扩量**，
                                // `resolve_line_style` 已经把它折算成整条居中线宽
                                // （w/100·fontSize·0.5），这里直接用。
                                width: layout.style.outline_width as f32,
                                ..Stroke::default()
                            };
                            pixmap.stroke_path(
                                &path,
                                &caption_recipe_paint(
                                    animation,
                                    layout.style.outline_color,
                                    chunk_opacity,
                                ),
                                &stroke,
                                local,
                                clip_mask.as_ref(),
                            );
                            bounds.add_stroked(&path, local, stroke.width);
                        }
                        if let Some(fill) = caption_recipe_glyph_paint(
                            animation,
                            &visual,
                            visual.color.unwrap_or(layout.style.color),
                            chunk_opacity,
                            replacement.is_none(),
                        ) {
                            pixmap.fill_path(
                                &path,
                                &fill,
                                FillRule::Winding,
                                local,
                                clip_mask.as_ref(),
                            );
                            bounds.add_filled(&path, local);
                        }
                    }
                    GlyphRender::ColorBitmap {
                        width,
                        height,
                        rgba,
                        left,
                        top,
                    } => {
                        let bitmap = PixmapRef::from_bytes(&rgba, width, height)
                            .expect("彩色字形 RGBA 尺寸已由 TextEngine 验证");
                        // 位图字形不参与描边，也不吃字色。placement 偏移在字形局部
                        // 空间里，必须叠在 `local` 之下才能跟随 group_transform
                        // （camera zoom / pop scale）一起走。
                        let placement =
                            Transform::from_translate(left as f32, -top as f32).post_concat(local);
                        pixmap.draw_pixmap(
                            0,
                            0,
                            bitmap,
                            &PixmapPaint {
                                opacity: chunk_opacity as f32,
                                quality: FilterQuality::Bilinear,
                                blend_mode: caption_recipe_blend_mode(animation),
                            },
                            placement,
                            clip_mask.as_ref(),
                        );
                        bounds.add_pixmap(width, height, placement);
                    }
                    GlyphRender::Empty => {}
                }
            }
            if visual.underline.unwrap_or(layout.style.underline) {
                let underline_offset = visual.underline_offset_em.unwrap_or(0.10);
                bounds.merge(fill_round_rect(
                    pixmap,
                    cursor + part_dx,
                    baseline + layout.style.font_size * underline_offset + part_dy,
                    chunk.width,
                    (layout.style.font_size * 0.06).max(1.0),
                    layout.style.font_size * 0.03,
                    visual.color.unwrap_or(layout.style.color),
                    chunk_opacity,
                    group_transform,
                ));
            }
            cursor += chunk.width;
        }
        line_top += line_height + line.gap_after;
    }
    bounds
}

pub fn chunk_part_delta(layout: &LineLayout, chunk: &GlyphChunk) -> (f64, f64, f64) {
    let Some(part) = chunk
        .part
        .and_then(|index| layout.animation_parts.get(index))
    else {
        return (1.0, 0.0, 0.0);
    };
    (
        part.opacity.clamp(0.0, 1.0),
        part.dx * layout.animation_short_edge,
        part.dy * layout.animation_short_edge,
    )
}

/// 一次字幕绘制落笔到的画布区域（非零像素的**超集**）。
///
/// 每次落笔都把该次绘制的**路径控制点盒**（`Path::bounds()`，本身已是曲线的
/// 超集）按描边外扩后，经与绘制**完全相同**的变换映射到画布坐标再取并集。
/// tiny-skia 的 blitter 只写被覆盖的像素，所以这个并集必然是非零像素的超集
/// ——正好满足 `alpha_bbox_within` 的窗口契约，于是求包围盒不必再扫整幅
/// 8.3MB（1080p 透明 overlay 上这是导出的头号计算热点）。
///
/// 为什么不用「行盒 + 固定边距」直接估：`caption_recipe_transform` 会按配方
/// 对单个词做缩放/旋转/位移，粒子、emoji、echo、rgbSplit、glow 描边又各有
/// 自己的外扩量，任何固定边距都会在某条配方上估漏——估漏就是把内容裁掉。
/// 跟着落笔走则不会。
#[derive(Debug, Default, Clone, Copy)]
pub struct DrawBounds {
    /// `[left, top, right, bottom]`，画布坐标；`None` = 一笔未落。
    pub rect: Option<[f64; 4]>,
    /// 变换算出非有限值等无法界定的落笔：退回整幅，宁可多扫也不能扫漏。
    pub unbounded: bool,
}

impl DrawBounds {
    pub fn union(&mut self, left: f64, top: f64, right: f64, bottom: f64) {
        if !(left.is_finite() && top.is_finite() && right.is_finite() && bottom.is_finite()) {
            self.unbounded = true;
            return;
        }
        self.rect = Some(match self.rect {
            None => [left, top, right, bottom],
            Some([l, t, r, b]) => [l.min(left), t.min(top), r.max(right), b.max(bottom)],
        });
    }

    /// `expand` 是**路径空间**里的外扩量，跟着路径一起过变换。
    pub fn add_path(&mut self, path: &tiny_skia::Path, transform: Transform, expand: f64) {
        let bounds = path.bounds();
        let expand = expand.max(0.0) as f32;
        let Some(rect) = tiny_skia::Rect::from_ltrb(
            bounds.left() - expand,
            bounds.top() - expand,
            bounds.right() + expand,
            bounds.bottom() + expand,
        ) else {
            self.unbounded = true;
            return;
        };
        let Some(mapped) = rect.transform(transform) else {
            self.unbounded = true;
            return;
        };
        self.union(
            f64::from(mapped.left()),
            f64::from(mapped.top()),
            f64::from(mapped.right()),
            f64::from(mapped.bottom()),
        );
    }

    pub fn add_filled(&mut self, path: &tiny_skia::Path, transform: Transform) {
        self.add_path(path, transform, 0.0);
    }

    /// 描边：miter 拼接最远把轮廓推到 `miter_limit × width / 2`，tiny-skia 的
    /// 默认 `miter_limit` 是 4，因此 `2 × width` 是安全上界。
    pub fn add_stroked(&mut self, path: &tiny_skia::Path, transform: Transform, stroke_width: f32) {
        self.add_path(path, transform, f64::from(stroke_width.max(0.0)) * 2.0);
    }

    pub fn add_pixmap(&mut self, width: u32, height: u32, transform: Transform) {
        let Some(rect) = tiny_skia::Rect::from_ltrb(0.0, 0.0, width as f32, height as f32) else {
            self.unbounded = true;
            return;
        };
        let Some(mapped) = rect.transform(transform) else {
            self.unbounded = true;
            return;
        };
        self.union(
            f64::from(mapped.left()),
            f64::from(mapped.top()),
            f64::from(mapped.right()),
            f64::from(mapped.bottom()),
        );
    }

    pub fn merge(&mut self, other: Self) {
        self.unbounded |= other.unbounded;
        if let Some([l, t, r, b]) = other.rect {
            self.union(l, t, r, b);
        }
    }

    /// 并进一个已经定案的整数包围盒（例如效果层模糊后合成进来的那块）。
    pub fn merge_content_box(&mut self, bounds: &ContentBox) {
        self.union(
            bounds.cols.start as f64,
            bounds.rows.start as f64,
            bounds.cols.end as f64,
            bounds.rows.end as f64,
        );
    }

    /// 收成画布内的整数窗口。向外各留 1px：反走样会糊到相邻像素上。
    /// `None` = 一笔未落，调用方可以直接判定整幅透明。
    pub fn window(self, width: usize, height: usize) -> Option<ContentBox> {
        if self.unbounded {
            return Some(ContentBox {
                rows: 0..height,
                cols: 0..width,
            });
        }
        let [left, top, right, bottom] = self.rect?;
        let clamp_axis = |value: f64, limit: usize| value.clamp(0.0, limit as f64) as usize;
        let cols = clamp_axis(left.floor() - 1.0, width)..clamp_axis(right.ceil() + 1.0, width);
        let rows = clamp_axis(top.floor() - 1.0, height)..clamp_axis(bottom.ceil() + 1.0, height);
        (!rows.is_empty() && !cols.is_empty()).then_some(ContentBox { rows, cols })
    }
}

/// 预乘 RGBA 的整数 source-over（实现在 `render_raster::effects`）。
pub fn composite_premultiplied_rgba(
    destination: &mut [u8],
    source: &[u8],
    width: usize,
    bounds: &ContentBox,
) {
    render_raster::effects::composite_premultiplied_rgba(destination, source, width, bounds);
}

/// 把 `bounds` 覆盖的像素清零（缓冲复用）。
pub fn clear_content_box(data: &mut [u8], width: usize, bounds: &ContentBox) {
    render_raster::effects::clear_content_box(data, width, bounds);
}

/// 只在非零内容包围盒的邻域内做 box blur，输出与整帧模糊逐字节一致。
pub fn box_blur_rgba_content(
    data: &mut [u8],
    width: u32,
    height: u32,
    radius: usize,
) -> Option<ContentBox> {
    render_raster::effects::box_blur_content(data, width, height, radius)
}

/// [`box_blur_rgba_content`] 的已知包围盒版本。
pub fn box_blur_rgba_bounded(
    data: &mut [u8],
    width: u32,
    height: u32,
    radius: usize,
    content: &ContentBox,
) -> ContentBox {
    render_raster::effects::box_blur_bounded(data, width, height, radius, content)
}

/// 模糊半径的结构性上限（`render_raster::effects` 的同名常量）。
#[allow(dead_code)]
pub const MAX_BLUR_RADIUS: usize = render_raster::effects::MAX_BLUR_RADIUS;

/// 整幅预乘 RGBA 的单遍可分离 box blur。
pub fn box_blur_rgba(data: &mut [u8], width: u32, height: u32, radius: usize) {
    render_raster::effects::box_blur_premul_u8(data, width, height, radius);
}

/// 等比降采样到 `width × height`（只缩不放）。
///
/// 先按 2×2 均值连续减半、再做最后一步双线性：直接一步双线性缩 2.5 倍只会在
/// 每个目标像素上取四个源像素，线稿那样的细笔画会整条掉进采样缝里消失。减半
/// 这一步在预乘 RGBA 上做均值是对的——预乘值本身就是"颜色 × 覆盖率"，均值即
/// 面积加权。
pub fn downscaled_pixmap(source: &Pixmap, width: u32, height: u32) -> Pixmap {
    let width = width.max(1);
    let height = height.max(1);
    let mut current = None::<Pixmap>;
    loop {
        let stage = current.as_ref().unwrap_or(source);
        if stage.width() / 2 < width.max(1) || stage.height() / 2 < height.max(1) {
            break;
        }
        let Some(halved) = halve_pixmap(stage) else {
            break;
        };
        current = Some(halved);
    }
    let stage = current.as_ref().unwrap_or(source);
    if (stage.width(), stage.height()) == (width, height) {
        return stage.clone();
    }
    let mut destination = match Pixmap::new(width, height) {
        Some(destination) => destination,
        None => return stage.clone(),
    };
    draw_fit_pixmap(&mut destination, stage, Fit::Contain, 1.0);
    destination
}

/// 2×2 均值减半；奇数边按整除截掉最后一行/列（下一轮双线性会补回精确尺寸）。
fn halve_pixmap(source: &Pixmap) -> Option<Pixmap> {
    let width = source.width() / 2;
    let height = source.height() / 2;
    if width == 0 || height == 0 {
        return None;
    }
    let mut destination = Pixmap::new(width, height)?;
    let source_width = source.width() as usize;
    let source_data = source.data();
    let destination_data = destination.data_mut();
    for y in 0..height as usize {
        let top = (y * 2) * source_width * 4;
        let bottom = top + source_width * 4;
        for x in 0..width as usize {
            let left = x * 8;
            let out = (y * width as usize + x) * 4;
            for channel in 0..4 {
                let sum = u32::from(source_data[top + left + channel])
                    + u32::from(source_data[top + left + 4 + channel])
                    + u32::from(source_data[bottom + left + channel])
                    + u32::from(source_data[bottom + left + 4 + channel]);
                destination_data[out + channel] = ((sum + 2) / 4) as u8;
            }
        }
    }
    Some(destination)
}
