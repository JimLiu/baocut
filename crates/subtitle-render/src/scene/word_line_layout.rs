//! Frozen semantic word/line groups. Display whitespace normalization never
//! changes source text, word byte ranges or Unicode grapheme context indices.
use super::*;

fn consume(plans: impl IntoIterator<Item = Vec<usize>>, total: usize) -> Vec<Vec<Range<usize>>> {
    let mut at = 0;
    let mut pages = Vec::new();
    for plan in plans {
        if at == total {
            break;
        }
        let mut rows = Vec::new();
        for quota in plan {
            let end = (at + quota).min(total);
            if at < end {
                rows.push(at..end);
                at = end;
            }
        }
        if !rows.is_empty() {
            pages.push(rows);
        }
    }
    pages
}

/// `caption-remaining-word-page-plan/1`: each page takes the rows planned for the number of
/// words still unpaged. Validation caps entry `i` at `i + 1` words, so pages are never cut.
fn remaining_plan_groups(total: usize, plans: &[Vec<usize>]) -> Vec<Vec<Range<usize>>> {
    let mut remaining = total;
    let mut pages = Vec::new();
    while remaining > 0 {
        let rows = plans[remaining.min(plans.len()) - 1].clone();
        remaining -= rows.iter().sum::<usize>().min(remaining);
        pages.push(rows);
    }
    consume(pages, total)
}

fn groups(total: usize, pagination: &Pagination) -> Vec<Vec<Range<usize>>> {
    if let Some(plans) = &pagination.remaining_word_page_plans {
        return remaining_plan_groups(total, plans);
    }
    let pattern = pagination
        .word_line_pattern
        .as_ref()
        .expect("validated pattern");
    // Positive quotas guarantee that at most `total` pattern pages are needed.
    let initial = consume(pattern.iter().cycle().take(total).cloned(), total);
    let mut plans: Vec<Vec<usize>> = initial
        .iter()
        .map(|rows| rows.iter().map(|row| row.len()).collect())
        .collect();
    if pagination.tail_word_rule == Some(TailWordRule::JoinPreviousLine) {
        return join_tail_word(initial, pattern);
    }
    if let Some(rule) = &pagination.last_page_rule {
        if plans.len() > 1 && plans.last().unwrap().contains(&rule.if_row_count_is) {
            let previous = plans.len() - 2;
            plans[previous] = rule.previous_page_lines.clone();
            // Exactly one rewrite followed by replay; no repeated orphan rule.
            return consume(plans, total);
        }
    }
    initial
}

/// `caption-word-line-tail-join/1`: full pattern pages stay as planned; when the final page
/// is incomplete and its last row holds one word, that word joins the row before it, which
/// is the previous page's last row when the final page holds nothing else. A cue of one
/// word keeps it.
fn join_tail_word(
    mut pages: Vec<Vec<Range<usize>>>,
    pattern: &[Vec<usize>],
) -> Vec<Vec<Range<usize>>> {
    let Some(last) = pages.last() else {
        return pages;
    };
    let planned: usize = pattern[(pages.len() - 1) % pattern.len()].iter().sum();
    let held: usize = last.iter().map(|row| row.len()).sum();
    if held >= planned || last.last().is_none_or(|row| row.len() != 1) {
        return pages;
    }
    let lone = pages.last_mut().unwrap().pop().unwrap();
    if pages.last().unwrap().is_empty() {
        pages.pop();
    }
    match pages.last_mut().and_then(|rows| rows.last_mut()) {
        Some(previous) => previous.end = lone.end,
        None => pages.push(vec![lone]),
    }
    pages
}

pub(super) fn normalized_row(source: &str) -> (String, Vec<Range<usize>>) {
    let mut normalized = String::new();
    let mut mapping = Vec::new();
    let mut pending: Option<Range<usize>> = None;
    for (at, ch) in source.char_indices() {
        let range = at..at + ch.len_utf8();
        if ch.is_whitespace() {
            if let Some(run) = &mut pending {
                run.end = range.end;
            } else {
                pending = Some(range);
            }
            continue;
        }
        if let Some(run) = pending.take() {
            if !normalized.is_empty() {
                normalized.push(' ');
                mapping.push(run);
            }
        }
        normalized.push(ch);
        mapping.extend(std::iter::repeat_n(range, ch.len_utf8()));
    }
    // Trailing whitespace stays in Line.bytes but has no shaped glyph.
    (normalized, mapping)
}

fn shape_row(text: &mut TextEngine, source: &str, style: &TextStyle, fs: f64) -> ShapedLine {
    let (normalized, mapping) = normalized_row(source);
    let mut shape = text.shape_spaced(
        &normalized,
        &style.font_family,
        fs,
        style.font_weight,
        style.italic,
        style.letter_spacing * fs,
    );
    for glyph in &mut shape.glyphs {
        // Mapping is per normalized UTF-8 byte, so multibyte clusters, ligatures
        // and one collapsed space spanning many original bytes remain valid.
        if let (Some(first), Some(last)) = (
            mapping.get(glyph.cluster.start),
            glyph
                .cluster
                .end
                .checked_sub(1)
                .and_then(|end| mapping.get(end)),
        ) {
            glyph.cluster = first.start..last.end;
        }
    }
    shape
}

/// `caption-fixed-line-wrap/1`: display line byte ranges of one fixed row. The row's
/// normalized text wraps at `width` like width-wrapped pages (line break opportunities,
/// grapheme fallback for an overlong word); each break maps back to the source byte of the
/// next display line's first character, so separators stay on the line before.
fn wrap_row(text: &mut TextEngine, content: &str, row: Range<usize>, style: &TextStyle, fs: f64, width: f64) -> Vec<Range<usize>> {
    let (normalized, mapping) = normalized_row(&content[row.clone()]);
    let block = layout(&normalized, Wrap::Word, Some(width), 1.0, |r| {
        let shape = text.shape_spaced(
            &normalized[r],
            &style.font_family,
            fs,
            style.font_weight,
            style.italic,
            style.letter_spacing * fs,
        );
        TextMetricsLine {
            width: shape.width,
            ascent: shape.ascent,
            descent: shape.descent,
        }
    });
    // A display line starts at its first visible character; a whitespace-only line (from the
    // grapheme fallback) is left on the line before.
    let mut starts = vec![row.start];
    starts.extend(block.lines.iter().skip(1).filter_map(|line| {
        let visible = normalized[line.bytes.start..line.paint_end].find(|c: char| !c.is_whitespace())?;
        mapping.get(line.bytes.start + visible).map(|source| row.start + source.start)
    }));
    starts.dedup();
    let mut ends = starts[1..].to_vec();
    ends.push(row.end);
    starts.into_iter().zip(ends).map(|(start, end)| start..end).collect()
}

fn shape_page(
    text: &mut TextEngine,
    content: &str,
    rows: Vec<Range<usize>>,
    node: &Node,
    cfg: &Layout,
    size: (u32, u32),
    params: &BTreeMap<String, Evaluated>,
) -> Result<Vec<Line>> {
    let fs = node.style.font_size.resolve(size.0, size.1, params)?;
    let width = cfg.width.resolve(size.0, size.1, params)?;
    if !(1.0..=4096.0).contains(&fs) || !(1.0..=65536.0).contains(&width) {
        bail!("CAPTION_LAYOUT_INVALID: dimensions");
    }
    let x = cfg.x.resolve(size.0, size.1, params)?;
    let y = cfg.y.resolve(size.0, size.1, params)?;
    let wrap = cfg.pagination.fixed_line_overflow == Some(FixedLineOverflow::Wrap);
    let mut ranges = Vec::new();
    for (row, bytes) in rows.into_iter().enumerate() {
        if wrap {
            ranges.extend(wrap_row(text, content, bytes, &node.style, fs, width).into_iter().map(|r| (row, r)));
        } else {
            ranges.push((row, bytes));
        }
    }
    // Rows without fit keep one height and the uniform row offsets.
    let row_height = fs * node.style.line_height;
    let (scales, heights) = match &cfg.pagination.fixed_line_fit {
        Some(fit) => {
            let scales = fit_scales(text, content, &ranges, &node.style, fs, fit);
            let extra = fit.extra_line_height / scales.iter().copied().fold(1.0, f64::max);
            let heights = scales.iter().map(|scale| fs * scale * (node.style.line_height + extra)).collect();
            (scales, heights)
        }
        None => (vec![1.0; ranges.len()], vec![row_height; ranges.len()]),
    };
    let tops: Vec<f64> = if cfg.pagination.fixed_line_fit.is_some() {
        heights
            .iter()
            .scan(0.0, |top, height| Some(std::mem::replace(top, *top + height)))
            .collect()
    } else {
        (0..heights.len()).map(|i| i as f64 * row_height).collect()
    };
    let height = if cfg.pagination.fixed_line_fit.is_some() {
        heights.iter().sum::<f64>()
    } else {
        heights.len() as f64 * row_height
    };
    let mut lines = Vec::new();
    for ((((row, bytes), scale), row_height), top) in ranges.into_iter().zip(scales).zip(heights).zip(tops) {
        let row_fs = fs * scale;
        let shape = shape_row(text, &content[bytes.clone()], &node.style, row_fs);
        if cfg.overflow == LayoutOverflow::Error && shape.width > width + 0.001 {
            bail!("CAPTION_LAYOUT_OVERFLOW: fixed word line");
        }
        let lx = match cfg.align {
            Align::Left => x - width / 2.0,
            Align::Center => x - shape.width / 2.0,
            Align::Right => x + width / 2.0 - shape.width,
        };
        let ly = y - height / 2.0 + top;
        let bounds = Bounds {
            x: lx,
            y: ly,
            width: shape.width,
            height: row_height,
        };
        let baseline = ly + shape.ascent;
        let mut line = Line::new(text, bytes, shape, bounds, baseline, row_fs);
        line.row = row;
        lines.push(line);
    }
    Ok(lines)
}

/// `caption-fixed-line-fit/1`: font size scale of each row of one page. Rows are measured at
/// the base size; each scales to the widest row, a narrow last row is capped, a row without
/// width keeps its size and no row grows past 4096 px.
fn fit_scales(
    text: &mut TextEngine,
    content: &str,
    ranges: &[(usize, Range<usize>)],
    style: &TextStyle,
    fs: f64,
    fit: &FixedLineFit,
) -> Vec<f64> {
    let widths: Vec<f64> = ranges
        .iter()
        .map(|(_, bytes)| shape_row(text, &content[bytes.clone()], style, fs).width)
        .collect();
    let widest = widths.iter().copied().fold(0.0, f64::max);
    let last = widths.len().saturating_sub(1);
    widths
        .iter()
        .enumerate()
        .map(|(i, &width)| {
            if !(width > 0.0 && widest.is_finite()) {
                return 1.0;
            }
            let mut scale = widest / width;
            if i == last && width < widest * fit.last_line_width_ratio {
                scale = scale.min(fit.last_line_max_scale);
            }
            scale.min(4096.0 / fs)
        })
        .collect()
}

/// Frozen row byte ranges of a page: consecutive display lines of one row join again,
/// so sampled reflow wraps each row afresh at the sampled width.
fn page_rows(lines: &[Line]) -> Vec<Range<usize>> {
    let mut rows: Vec<(usize, Range<usize>)> = Vec::new();
    for line in lines {
        match rows.last_mut() {
            Some((row, bytes)) if *row == line.row => bytes.end = line.bytes.end,
            _ => rows.push((line.row, line.bytes.clone())),
        }
    }
    rows.into_iter().map(|(_, bytes)| bytes).collect()
}

pub(super) fn prepare(
    text: &mut TextEngine,
    cue: &SceneCue,
    content: &str,
    words: Vec<Word>,
    node: &Node,
    cfg: &Layout,
    size: (u32, u32),
    params: &BTreeMap<String, Evaluated>,
) -> Result<TextLayout> {
    let mut pages = Vec::new();
    let page_groups = if let Some(pattern) = &cfg.pagination.text_line_pattern {
        text_line_layout::groups(content, &words, pattern)?
    } else {
        groups(words.len(), &cfg.pagination)
    };
    for rows in page_groups {
        let first = rows.first().unwrap().start;
        let last = rows.last().unwrap().end;
        // Row/page breaks precede the next word. Non-whitespace separators
        // stay in source order on the previous row; no punctuation is dropped.
        let byte_at = |i: usize| {
            if i == 0 {
                0
            } else if i == words.len() {
                content.len()
            } else {
                words[i].bytes.start
            }
        };
        let ranges = rows
            .iter()
            .map(|row| byte_at(row.start)..byte_at(row.end))
            .collect();
        let lines = shape_page(text, content, ranges, node, cfg, size, params)?;
        pages.push(Page {
            source_range: byte_at(first)..byte_at(last),
            paint_start: byte_at(first),
            bounds: union(lines.iter().map(|line| line.bounds)),
            lines,
            words: (first..last).collect(),
            start: cue.start,
            end: cue.end,
        });
    }
    let count = pages.len().max(1) as f64;
    for (i, page) in pages.iter_mut().enumerate() {
        page.start = words[page.words[0]]
            .span
            .map_or(
                cue.start + (cue.end - cue.start) * i as f64 / count,
                |span| span.0,
            )
            .max(cue.start);
    }
    if cfg.leading_gap == LeadingGap::Show {
        if let Some(page) = pages.first_mut() {
            page.start = cue.start;
        }
    }
    for i in 0..pages.len() {
        pages[i].end = pages
            .get(i + 1)
            .map_or(cue.end, |page| page.start)
            .min(cue.end);
    }
    if let Some(window) = &cfg.page_window {
        page_window::apply(&mut pages, &words, content, window)?;
    }
    Ok(TextLayout {
        pages,
        words,
        content: content.into(),
    })
}

pub(super) fn reflow(
    text: &mut TextEngine,
    base: &TextLayout,
    page: &Page,
    node: &Node,
    cfg: &Layout,
    size: (u32, u32),
    params: &BTreeMap<String, Evaluated>,
) -> Result<Page> {
    let mut lines = shape_page(
        text,
        &base.content,
        page_rows(&page.lines),
        node,
        cfg,
        size,
        params,
    )?;
    page_window::inherit_lines(&mut lines, &page.lines)?;
    Ok(Page {
        source_range: page.source_range.clone(),
        paint_start: page.paint_start,
        words: page.words.clone(),
        start: page.start,
        end: page.end,
        bounds: union(lines.iter().map(|line| line.bounds)),
        lines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pagination() -> Pagination {
        Pagination {
            word_line_pattern: Some(vec![vec![2, 3]]),
            last_page_rule: Some(LastPageRule {
                if_row_count_is: 1,
                previous_page_lines: vec![2, 4],
            }),
            ..Pagination::default()
        }
    }
    fn counts(pages: Vec<Vec<Range<usize>>>) -> Vec<Vec<usize>> {
        pages
            .into_iter()
            .map(|rows| rows.into_iter().map(|row| row.len()).collect())
            .collect()
    }
    #[test]
    fn word_line_plan_replays_the_tail_rule_once_without_losing_words() {
        assert_eq!(counts(groups(6, &pagination())), vec![vec![2, 4]]);
        assert_eq!(counts(groups(8, &pagination())), vec![vec![2, 4], vec![2]]);
        assert_eq!(
            counts(groups(13, &pagination())),
            vec![vec![2, 3], vec![2, 4], vec![2]]
        );
        assert_eq!(counts(groups(1, &pagination())), vec![vec![1]]);
        assert_eq!(counts(groups(0, &pagination())), Vec::<Vec<usize>>::new());
        for n in (0..=64).chain(std::iter::once(MAX_UNITS)) {
            let pages = groups(n, &pagination());
            let words: Vec<usize> = pages.into_iter().flatten().flatten().collect();
            assert_eq!(words, (0..n).collect::<Vec<_>>());
        }
        let cycle = Pagination {
            word_line_pattern: Some(vec![vec![1], vec![2, 1]]),
            ..Pagination::default()
        };
        assert_eq!(
            counts(groups(9, &cycle)),
            vec![vec![1], vec![2, 1], vec![1], vec![2, 1], vec![1]]
        );
    }
    #[test]
    fn word_line_tail_join_moves_a_lone_final_word_to_the_row_before() {
        let tail = Pagination {
            word_line_pattern: Some(vec![vec![4, 3, 2]]),
            tail_word_rule: Some(TailWordRule::JoinPreviousLine),
            ..Pagination::default()
        };
        let plan = |n| counts(groups(n, &tail));
        assert_eq!(plan(1), vec![vec![1]]);
        assert_eq!(plan(2), vec![vec![2]]);
        assert_eq!(plan(5), vec![vec![5]]);
        assert_eq!(plan(8), vec![vec![4, 4]]);
        // A full page keeps its last row of two; one extra word joins it.
        assert_eq!(plan(9), vec![vec![4, 3, 2]]);
        assert_eq!(plan(10), vec![vec![4, 3, 3]]);
        assert_eq!(plan(14), vec![vec![4, 3, 2], vec![5]]);
        assert_eq!(plan(17), vec![vec![4, 3, 2], vec![4, 4]]);
        // A one-word row that completes its page is not a lone tail word.
        let complete = Pagination {
            word_line_pattern: Some(vec![vec![2, 1]]),
            tail_word_rule: Some(TailWordRule::JoinPreviousLine),
            ..Pagination::default()
        };
        assert_eq!(counts(groups(3, &complete)), vec![vec![2, 1]]);
        assert_eq!(counts(groups(4, &complete)), vec![vec![2, 2]]);
        for n in (0..=64).chain(std::iter::once(MAX_UNITS)) {
            let words: Vec<usize> = groups(n, &tail).into_iter().flatten().flatten().collect();
            assert_eq!(words, (0..n).collect::<Vec<_>>());
        }
    }
    #[test]
    fn remaining_word_page_plans_pick_rows_by_unpaged_word_count() {
        let shapes = Pagination {
            remaining_word_page_plans: Some(vec![vec![1], vec![2], vec![1, 1, 1], vec![1, 1, 1, 1]]),
            ..Pagination::default()
        };
        let plan = |n| counts(groups(n, &shapes));
        assert_eq!(plan(1), vec![vec![1]]);
        assert_eq!(plan(3), vec![vec![1, 1, 1]]);
        // Counts beyond the table reuse its last entry.
        assert_eq!(plan(10), vec![vec![1, 1, 1, 1], vec![1, 1, 1, 1], vec![2]]);
        let varied = Pagination {
            remaining_word_page_plans: Some(vec![vec![1], vec![1], vec![2, 1], vec![1, 1]]),
            ..Pagination::default()
        };
        assert_eq!(counts(groups(2, &varied)), vec![vec![1], vec![1]]);
        assert_eq!(counts(groups(5, &varied)), vec![vec![1, 1], vec![2, 1]]);
        assert_eq!(counts(groups(6, &varied)), vec![vec![1, 1], vec![1, 1], vec![1], vec![1]]);
        assert_eq!(counts(groups(0, &varied)), Vec::<Vec<usize>>::new());
        for pagination in [&shapes, &varied] {
            for n in (0..=64).chain(std::iter::once(MAX_UNITS)) {
                let words: Vec<usize> = groups(n, pagination).into_iter().flatten().flatten().collect();
                assert_eq!(words, (0..n).collect::<Vec<_>>());
            }
        }
    }
    #[test]
    fn word_line_normalization_maps_original_bytes_without_inserting_spaces() {
        let source = " \tA\r\n  B中🙂!  ";
        let (normalized, map) = normalized_row(source);
        assert_eq!(normalized, "A B中🙂!");
        assert_eq!(map[0], 2..3);
        assert_eq!(map[1], 3..7);
        for token in ["A", "B", "中", "🙂", "!"] {
            let normalized_at = normalized.find(token).unwrap();
            let original_at = source.find(token).unwrap();
            assert_eq!(map[normalized_at], original_at..original_at + token.len());
        }
        assert_eq!(normalized_row("中日韩").0, "中日韩");
    }
    fn font_engine() -> TextEngine {
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()])
    }
    fn config() -> Layout {
        serde_json::from_value(json!({
            "width":{"value":500,"basis":"absolute"},
            "x":{"value":300,"basis":"absolute"},"y":{"value":100,"basis":"absolute"},
            "maxLines":2,"overflow":"visible", "pagination":{"wordLinePattern":[[2,3]],
                "lastPageRule":{"ifRowCountIs":1,"previousPageLines":[2,4]}}
        }))
        .unwrap()
    }
    fn node() -> Node {
        serde_json::from_value(json!({"id":"text","type":"text","style":{
            "fontSize":{"value":20,"basis":"absolute"}}}))
        .unwrap()
    }
    fn cue(tokens: &[&str], text: &str) -> SceneCue {
        SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: text.into(),
            start: 0.,
            end: tokens.len() as f64,
            words: tokens
                .iter()
                .enumerate()
                .map(|(i, t)| SceneWord {
                    id: format!("word-{i}"),
                    text: (*t).into(),
                    start: i as f64,
                    end: i as f64 + 0.8,
                })
                .collect(),
        }
    }
    #[test]
    fn word_line_reflow_freezes_rows_membership_and_times_and_checks_overflow() {
        let cue = cue(
            &[
                "one", "two", "three", "four", "five", "six", "seven", "eight",
            ],
            "one two three four five six seven eight",
        );
        let words = bind_words(&cue, &cue.text, TimingPolicy::RequireWordTiming, false).unwrap();
        let mut text = font_engine();
        let mut cfg = config();
        let node = node();
        let params = BTreeMap::new();
        let base = prepare(
            &mut text,
            &cue,
            &cue.text,
            words,
            &node,
            &cfg,
            (600, 200),
            &params,
        )
        .unwrap();
        assert_eq!(base.pages.len(), 2);
        assert_eq!(base.pages[0].words, (0..6).collect::<Vec<_>>());
        assert_eq!((base.pages[0].start, base.pages[0].end), (0., 6.));
        assert_eq!((base.pages[1].start, base.pages[1].end), (6., 8.));
        let ranges: Vec<_> = base.pages[0]
            .lines
            .iter()
            .map(|line| line.bytes.clone())
            .collect();
        cfg.width.value = 1.;
        let after = reflow(
            &mut text,
            &base,
            &base.pages[0],
            &node,
            &cfg,
            (600, 200),
            &params,
        )
        .unwrap();
        assert_eq!(after.words, base.pages[0].words);
        assert_eq!((after.start, after.end), (0., 6.));
        assert_eq!(
            after
                .lines
                .iter()
                .map(|line| line.bytes.clone())
                .collect::<Vec<_>>(),
            ranges
        );
        assert!(after.lines.iter().all(|line| line.shape.width > 1.));
        cfg.overflow = LayoutOverflow::Error;
        assert!(
            reflow(
                &mut text,
                &base,
                &base.pages[0],
                &node,
                &cfg,
                (600, 200),
                &params
            )
            .err()
            .unwrap()
            .to_string()
            .contains("CAPTION_LAYOUT_OVERFLOW")
        );
        let words = bind_words(&cue, &cue.text, TimingPolicy::RequireWordTiming, false).unwrap();
        assert!(
            prepare(
                &mut text,
                &cue,
                &cue.text,
                words,
                &node,
                &cfg,
                (600, 200),
                &params
            )
            .is_err()
        );
    }
    #[test]
    fn fixed_line_wrap_breaks_wide_rows_at_the_width_and_keeps_rows_frozen() {
        let content = "one two\n three four five six";
        let cue = cue(&["one", "two", "three", "four", "five", "six"], content);
        let mut text = font_engine();
        let mut cfg = config();
        cfg.pagination.word_line_pattern = Some(vec![vec![4, 2]]);
        cfg.pagination.last_page_rule = None;
        cfg.pagination.fixed_line_overflow = Some(FixedLineOverflow::Wrap);
        cfg.width.value = 120.;
        let node = node();
        let params = BTreeMap::new();
        let words = bind_words(&cue, content, TimingPolicy::RequireWordTiming, false).unwrap();
        let base = prepare(&mut text, &cue, content, words, &node, &cfg, (600, 200), &params).unwrap();
        let page = &base.pages[0];
        assert_eq!(base.pages.len(), 1);
        assert_eq!(page.words, (0..6).collect::<Vec<_>>());
        assert_eq!((page.start, page.end), (0., 6.));
        // The first row wraps on word boundaries; the second row fits and stays one line.
        let shown: Vec<_> = page.lines.iter().map(|line| &content[line.bytes.clone()]).collect();
        assert!(shown.len() > 2, "{shown:?}");
        assert_eq!(shown.concat(), content);
        assert!(page.lines.iter().all(|line| line.shape.width <= 120.001));
        let rows: Vec<_> = page.lines.iter().map(|line| line.row).collect();
        assert_eq!(rows.last(), Some(&1));
        assert!(rows.windows(2).all(|pair| pair[0] <= pair[1]));
        assert_eq!(rows.iter().filter(|row| **row == 1).count(), 1);
        assert_eq!(shown.last(), Some(&"five six"));
        let row_height = 20. * node.style.line_height;
        for (i, line) in page.lines.iter().enumerate() {
            assert!((line.bounds.y - (page.lines[0].bounds.y + i as f64 * row_height)).abs() < 1e-9);
            let first = content[line.bytes.clone()].trim_start();
            assert!(
                ["one", "two", "three", "four", "five"].iter().any(|w| first.starts_with(w)),
                "{first:?}"
            );
        }
        assert_eq!(
            page_rows(&page.lines),
            vec![0..content.find("five").unwrap(), content.find("five").unwrap()..content.len()]
        );
        // Sampled reflow wraps each frozen row again at the sampled width.
        cfg.width.value = 500.;
        let wide = reflow(&mut text, &base, page, &node, &cfg, (600, 200), &params).unwrap();
        assert_eq!(
            wide.lines.iter().map(|line| line.bytes.clone()).collect::<Vec<_>>(),
            page_rows(&page.lines)
        );
        assert_eq!(wide.words, page.words);
        // Without the opt-in a wide row stays one line.
        cfg.width.value = 120.;
        cfg.pagination.fixed_line_overflow = None;
        let words = bind_words(&cue, content, TimingPolicy::RequireWordTiming, false).unwrap();
        let kept = prepare(&mut text, &cue, content, words, &node, &cfg, (600, 200), &params).unwrap();
        assert_eq!(kept.pages[0].lines.len(), 2);
        assert!(kept.pages[0].lines[0].shape.width > 120.);
    }
    #[test]
    fn fixed_line_fit_scales_rows_to_the_widest_row_and_caps_a_narrow_last_row() {
        let content = "one three four five six";
        let cue = cue(&["one", "three", "four", "five", "six"], content);
        let mut text = font_engine();
        let mut cfg = config();
        cfg.max_lines = 3;
        cfg.pagination.word_line_pattern = Some(vec![vec![1, 3, 1]]);
        cfg.pagination.last_page_rule = None;
        cfg.pagination.fixed_line_fit = Some(FixedLineFit {
            last_line_width_ratio: 0.5,
            last_line_max_scale: 1.3,
            extra_line_height: 0.1,
        });
        let node = node();
        let params = BTreeMap::new();
        let base_width = |text: &mut TextEngine, row: &str| shape_row(text, row, &node.style, 20.).width;
        let widest = base_width(&mut text, "three four five");
        let first_scale = widest / base_width(&mut text, "one");
        assert!(base_width(&mut text, "six") < widest * 0.5);
        let words = bind_words(&cue, content, TimingPolicy::RequireWordTiming, false).unwrap();
        let base = prepare(&mut text, &cue, content, words, &node, &cfg, (600, 200), &params).unwrap();
        let page = &base.pages[0];
        assert_eq!(base.pages.len(), 1);
        assert_eq!(page.words, (0..5).collect::<Vec<_>>());
        assert_eq!(page.lines.len(), 3);
        let sizes: Vec<_> = page.lines.iter().map(|line| line.max_font_size).collect();
        // The narrow first row grows to the widest row; the widest keeps its size; the narrow
        // last row stops at the cap instead of reaching the widest width.
        assert!((sizes[0] - 20. * first_scale).abs() < 1e-9);
        assert_eq!(sizes[1], 20.);
        assert!((sizes[2] - 26.).abs() < 1e-9);
        assert!(
            (page.lines[0].shape.width - widest).abs() < widest * 0.02,
            "{} vs {widest}",
            page.lines[0].shape.width
        );
        assert!(page.lines[2].shape.width < widest * 0.5 * 1.3 + 1.);
        // Rows stack at their own heights with the extra spacing over the page's largest scale,
        // centred on the layout y.
        let extra = 0.1 / first_scale;
        for (line, size) in page.lines.iter().zip(&sizes) {
            assert!((line.bounds.height - size * (node.style.line_height + extra)).abs() < 1e-9);
        }
        for pair in page.lines.windows(2) {
            assert!((pair[1].bounds.y - (pair[0].bounds.y + pair[0].bounds.height)).abs() < 1e-9);
        }
        let last = page.lines.last().unwrap();
        assert!(((page.lines[0].bounds.y + last.bounds.y + last.bounds.height) / 2. - 100.).abs() < 1e-9);
        // Sampled reflow measures the frozen rows again and keeps the same rows and scales.
        cfg.width.value = 300.;
        let again = reflow(&mut text, &base, page, &node, &cfg, (600, 200), &params).unwrap();
        assert_eq!(
            again.lines.iter().map(|line| line.bytes.clone()).collect::<Vec<_>>(),
            page.lines.iter().map(|line| line.bytes.clone()).collect::<Vec<_>>()
        );
        assert_eq!(again.lines.iter().map(|line| line.max_font_size).collect::<Vec<_>>(), sizes);
        // A last row at least the ratio of the widest is fitted like the others.
        cfg.pagination.fixed_line_fit = Some(FixedLineFit {
            last_line_width_ratio: 0.,
            last_line_max_scale: 1.,
            extra_line_height: 0.,
        });
        let words = bind_words(&cue, content, TimingPolicy::RequireWordTiming, false).unwrap();
        let fitted = prepare(&mut text, &cue, content, words, &node, &cfg, (600, 200), &params).unwrap();
        let last = fitted.pages[0].lines.last().unwrap();
        assert!((last.shape.width - widest).abs() < widest * 0.02);
        assert!((last.bounds.height - last.max_font_size * node.style.line_height).abs() < 1e-9);
        // Fitted rows still overflow a narrower width under error overflow.
        cfg.width.value = widest / 2.;
        cfg.overflow = LayoutOverflow::Error;
        let words = bind_words(&cue, content, TimingPolicy::RequireWordTiming, false).unwrap();
        let error = prepare(&mut text, &cue, content, words, &node, &cfg, (600, 200), &params)
            .err()
            .unwrap();
        assert!(error.to_string().contains("CAPTION_LAYOUT_OVERFLOW"));
    }
    #[test]
    fn fixed_line_fit_keeps_single_and_empty_rows_and_bounds_the_row_font_size() {
        let mut text = font_engine();
        let style = node().style;
        let fit = FixedLineFit {
            last_line_width_ratio: 0.4,
            last_line_max_scale: 1.3,
            extra_line_height: 0.3,
        };
        // One row is its own widest row; a whitespace-only row has no width to fit.
        assert_eq!(fit_scales(&mut text, "one", &[(0, 0..3)], &style, 20., &fit), vec![1.]);
        let scales = fit_scales(&mut text, "one  ", &[(0, 0..3), (1, 3..5)], &style, 20., &fit);
        assert_eq!(scales, vec![1., 1.]);
        // A very short row against a long one stops at 4096 px.
        let content = "i wwwwwwwwwwwwwwwwwwwwwwww";
        let scales = fit_scales(&mut text, content, &[(0, 0..2), (1, 2..content.len())], &style, 1000., &fit);
        assert!((scales[0] - 4.096).abs() < 1e-12, "{scales:?}");
        assert_eq!(scales[1], 1.);
    }
    #[test]
    fn fixed_line_wrap_reports_a_grapheme_wider_than_the_width_under_error_overflow() {
        let cue = cue(&["one", "two"], "one two");
        let mut text = font_engine();
        let mut cfg = config();
        cfg.pagination.word_line_pattern = Some(vec![vec![2]]);
        cfg.pagination.last_page_rule = None;
        cfg.pagination.fixed_line_overflow = Some(FixedLineOverflow::Wrap);
        cfg.width.value = 4.;
        let node = node();
        let params = BTreeMap::new();
        let words = bind_words(&cue, &cue.text, TimingPolicy::RequireWordTiming, false).unwrap();
        let visible = prepare(&mut text, &cue, &cue.text, words, &node, &cfg, (600, 200), &params).unwrap();
        // Overlong words fall back to grapheme breaks; every grapheme is its own line here.
        assert_eq!(visible.pages[0].lines.len(), 6);
        cfg.overflow = LayoutOverflow::Error;
        let words = bind_words(&cue, &cue.text, TimingPolicy::RequireWordTiming, false).unwrap();
        let error = prepare(&mut text, &cue, &cue.text, words, &node, &cfg, (600, 200), &params)
            .err()
            .unwrap();
        assert!(error.to_string().contains("CAPTION_LAYOUT_OVERFLOW"));
    }
    #[test]
    fn word_line_shape_and_context_keep_original_unicode_indices() {
        let content = "A \r\n\tB中🙂 C";
        let cue = cue(&["A", "B", "中", "🙂", "C"], content);
        let words = bind_words(&cue, content, TimingPolicy::RequireWordTiming, false).unwrap();
        let mut text = font_engine();
        let mut cfg = config();
        cfg.pagination.word_line_pattern = Some(vec![vec![5]]);
        cfg.pagination.last_page_rule = None;
        let node = node();
        let params = BTreeMap::new();
        let base = prepare(
            &mut text,
            &cue,
            content,
            words,
            &node,
            &cfg,
            (600, 200),
            &params,
        )
        .unwrap();
        assert_eq!(base.content, content);
        let line = &base.pages[0].lines[0];
        let b = content.find('B').unwrap();
        assert!(
            line.shape
                .glyphs
                .iter()
                .any(|glyph| glyph.cluster.start == b)
        );
        let plain = shape_row(&mut text, "A B中🙂 C", &node.style, 20.);
        assert_eq!(plain.width, line.shape.width);
        let units = units_for(
            &cue,
            &base,
            &base.pages[0],
            1.2,
            &SpeechState::default(),
            &Presentation::default(),
        );
        let b_unit = &units
            .iter()
            .find(|(u, _)| u.kind == UnitKind::Grapheme && u.bytes.start == b)
            .unwrap()
            .0;
        assert_eq!(b_unit.text_index, content[..b].graphemes(true).count());
        assert_eq!(b_unit.text_count, content.graphemes(true).count());
        assert_eq!(b_unit.id, "word-1:0");
        assert_eq!(b_unit.spans[&UnitKind::Word], (1., 1.8));
    }
    #[test]
    fn word_line_sampled_width_does_not_change_pages_or_visible_pixels() {
        let mut body: serde_json::Value = serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/word-pop.json"
        ))
        .unwrap();
        let scene = &mut body["scene"]["value"];
        scene["animations"] = json!([]);
        scene["selectors"] = json!([]);
        scene["layout"]["pagination"] = json!({"wordLinePattern":[[2,3]],"lastPageRule":{"ifRowCountIs":1,"previousPageLines":[2,4]}});
        scene["layout"]["overflow"] = json!("visible");
        scene["layout"]["layoutEvaluation"] = json!("per-sample");
        scene["layout"]["bindings"] = json!([{"property":"width","value":{"kind":"keyframes",
            "clock":{"unit":"cue","origin":"start","duration":{"kind":"unit-span"}},
            "keys":[{"at":0,"value":140},{"at":1,"value":1}]}}]);
        let cue = cue(
            &[
                "one", "two", "three", "four", "five", "six", "seven", "eight",
            ],
            "one two three four five six seven eight",
        );
        let mut plan = ScenePlan::compile(
            parse_style(&body).unwrap(),
            Presentation::default(),
            vec![cue],
            (160, 90),
            font_engine(),
            "test".into(),
        )
        .unwrap();
        let first = plan.render(0.1).unwrap();
        let late = plan.render(5.9).unwrap();
        assert_eq!(
            first.rgba, late.rgba,
            "centered frozen rows cannot wrap when sampled width shrinks"
        );
        assert!(first.rgba.chunks_exact(4).any(|pixel| pixel[3] > 0));
        assert_ne!(
            first.rgba,
            plan.render(6.1).unwrap().rgba,
            "page changes at its frozen first-word boundary"
        );
        assert_eq!(
            first.rgba,
            plan.render(0.1).unwrap().rgba,
            "seek order cannot change row groups"
        );
    }

    #[test]
    fn word_line_rtl_whitespace_carets_follow_logical_edges_and_collapsed_clusters() {
        let mut text = TextEngine::with_document_fonts(&[include_bytes!(
            "../../../render-raster/assets/fonts/Rubik.ttf"
        )
        .to_vec()]);
        let mut style = TextStyle::default();
        style.font_family = "Rubik".into();
        for token in ["אב", "اب", "א", "ا"] {
            let source = format!("  {token}  ");
            let shape = shape_row(&mut text, &source, &style, 32.0);
            assert!(!shape.glyphs.is_empty());
            assert!(shape.glyphs.iter().all(|glyph| glyph.rtl));
            let width = shape.width;
            let line = Line::new(
                &mut text,
                0..source.len(),
                shape,
                Bounds {
                    x: 10.0,
                    y: 20.0,
                    width,
                    height: 40.0,
                },
                50.0,
                32.0,
            );
            // The shaper positions are f32 (e.g. -1.9e-6 at the visual left
            // edge); allow subpixel rounding, not a different caret edge.
            let tolerance = 1e-4;
            for range in [0..1, 1..2] {
                assert!(
                    (whitespace_bounds(&line, &range).x - (10.0 + width)).abs() < tolerance,
                    "{source:?}"
                );
            }
            for at in source.len() - 2..source.len() {
                assert!(
                    (whitespace_bounds(&line, &(at..at + 1)).x - 10.0).abs() < tolerance,
                    "{source:?}: x={}, glyphs={:?}",
                    whitespace_bounds(&line, &(at..at + 1)).x,
                    line.shape
                        .glyphs
                        .iter()
                        .map(|g| (&g.cluster, g.x, g.rtl))
                        .collect::<Vec<_>>()
                );
            }
        }
        for (first, last) in [("א", "ב"), ("ا", "ب")] {
            let source = format!("{first}\t\t{last}");
            let start = first.len();
            let shape = shape_row(&mut text, &source, &style, 32.0);
            let width = shape.width;
            let line = Line::new(
                &mut text,
                0..source.len(),
                shape,
                Bounds {
                    x: 10.0,
                    y: 20.0,
                    width,
                    height: 40.0,
                },
                50.0,
                32.0,
            );
            let a = whitespace_bounds(&line, &(start..start + 1));
            let b = whitespace_bounds(&line, &(start + 1..start + 2));
            assert_eq!(a.x, b.x);
            assert_eq!(a.width, b.width);
            assert!(
                a.x > 10.0 && a.x < 10.0 + width,
                "collapsed internal space stays inside the RTL line"
            );
        }
    }
}
