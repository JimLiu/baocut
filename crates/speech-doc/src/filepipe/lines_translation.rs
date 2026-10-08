//! Experimental translation adapter. Reuses the production content validator;
//! the page snapshot owns IDs, languages, glossary requirements and frozen text.
use super::{
    TranslatePage, TranslateParsed, TranslateSentence,
    align_edges::{AlignChunk, chunk_char_ranges},
    common::{Problem, ProblemCode, Warning, WarningCode, max_output_chars},
    lines::{self, Chunk, Issue, Record, Reference},
    translate_html::validate_translation_quality,
};
use crate::{
    atomize::{
        JoinWord, atomize, is_cjk_char, join_word_texts, normalize_chars, spaced_script_letter,
        unspaced_pair,
    },
    lcs::{AtomInterner, LCS_CELL_CAP, lcs_matches},
    split::{TransParams, target_cps_chars},
};
use std::collections::{BTreeMap, BTreeSet};
use unicode_general_category::{GeneralCategory, get_general_category};

/// Candidate protocol used by both host experiments. Locale policy and document
/// terminology remain separate, unchanged inputs to the model.
pub const PROTOCOL: &str = r#"lines/1, mode=blocks. Each numbered input line is one source sentence. Answer with exactly one output line per numbered input line, starting with the SAME number: copy the number from the input, never count lines yourself. Never merge two input lines into one output line and never split one — a line that is only a fragment of a sentence still gets its own numbered translation of just that fragment. Output only numbered lines, no prose or fences.
Line grammar: N |LEFT..RIGHT|target chunk|LEFT..RIGHT|target chunk …
Each marker names the source words its chunk translates: LEFT is the chunk's first source word(s), RIGHT its last. Quote complete words exactly as written in that sentence, enough of them to be unique within the sentence. |FULL SOURCE PHRASE| is a shorthand for one contiguous phrase. The chunk texts concatenate to one complete natural translation; never change word order to keep markers monotonic — markers may run backwards, code handles crossings.
Every chunk is its marker FIRST, then its text; text never comes before its own marker. A marker with NO text after it (|LEFT..RIGHT||next marker| or |LEFT..RIGHT| at the end of the line) adds those source words to the PREVIOUS chunk: use it when the previous chunk's text already rendered them. Never write comments such as "(merged)" as chunk text. |∅|text marks target words with no source counterpart; |?|text marks unknown correspondence.
Chunk granularity: a chunk is what one subtitle row can show; the header's row=N gives the reading units one row holds in the target language (one unit ≈ one character; in CJK text Latin letters and digits count about half). `≥k` before a source sentence means its translation MUST come back as at least k chunks, and the sentence is shown with ¦ between k suggested pieces: give each piece its own chunk (its marker quotes that piece's first and last words), moving a ¦ only when the natural translation cuts elsewhere; never quote across a ¦ and never write ¦ in the output. `≤n` is the sentence's reading budget in units (subordinate to meaning). Sentences without ≥k may be one chunk. Do not echo ≤n / ≥k. Chunks only cut the translation; they never add to it: never repeat, restate, or pad a phrase to reach k chunks — when the natural translation is too short to cut k ways, give fewer chunks. A chunk boundary never splits a word of the target language: if a ¦ would fall inside one target word, move the boundary to the nearest word boundary instead. Chunk text is always the translation, written in the language the header's target= names, never the quoted source words. Between two chunks keep only the spacing the target language itself puts between those words (`weak, |I think`; none in a script written without spaces) and add no other space around a |.
Escape literal backslash as \\, vertical bar as \|, LF/CR/TAB as \n/\r/\t, pause sign as \⏸, piece mark as \¦. Within quotes escape literal .. as \.\.; literal standalone ? or ∅ as \? or \∅. Never use ellipsis to abbreviate a source quote.
Input # lines are read-only neighbour context, @ lines identify speakers, blank lines identify paragraphs. ! lines give metadata: required is a JSON list of verbatim target terms. = N text freezes that sentence's target; reproduce its text exactly, adding only correspondence markers. Never echo metadata or source lines.
Format examples only (use the actual requested target language):
Input: 1 ≥2 Turn the light off.
Output: 1 |Turn..off|Apaga |the light|la luz.
Input: 2 Yes.
Output: 2 |Yes|是的。
Input: 3 ≥2 We make tools ¦ and they use them.
Output: 3 |We..tools|我们制造工具，|and..them|他们使用工具。
Input: 4 ≥2 I pitched her on joining ¦ the best company in the world.
Output: 4 |I..on|我劝她|joining..company|加入全球最好的公司。|in the world|
Input (one sentence split over two lines by the transcript — keep the split): 5 ≥2 It has focused on spatial intelligence, ¦ but other / 6 areas of the market fit a world model better.
Output: 5 |It..intelligence|它一直专注于空间智能，|but other|但其他 / 6 |areas..better|市场领域更适合世界模型。
Input: 7 ≥2 他的生活换个 ¦ 角度来看挺好的。
Output: 7 |他的生活换个|His life, seen from |角度来看挺好的|another angle, is pretty good.
"#;

/// Reading units one requested chunk should carry: two thirds of a row.
/// Models hand back exactly the chunks asked for, of uneven size, so asking
/// for `fit`-sized ones leaves some over `hard`; asking for smaller ones
/// costs a few markers and the planner merges short rows back.
///
/// `params` are the row thresholds the planner will apply (the project's
/// effective ones in production, [`TransParams::for_lang`] in experiments).
pub fn chunk_units(params: &TransParams) -> usize {
    (params.fit * 2 / 3).max(1)
}

/// Chunks to ask for a translation of `units` reading units: one row up to
/// `hard`, otherwise [`chunk_units`]-sized chunks (at least two). `units` is
/// an upper bound here (a reading budget), so only a sentence that cannot
/// fit one row even at its longest is asked to chunk.
pub fn chunks_for_units(units: usize, params: &TransParams) -> usize {
    chunks_over(units, params.hard, params)
}

/// [`chunks_for_units`] for a measured or predicted length: a translation
/// expected between `fit` and `hard` would plan as one over-`fit` row (or
/// come back one chunk over `hard` and cost a rewrite turn), so it is asked
/// to chunk already.
pub fn chunks_for_estimate(units: usize, params: &TransParams) -> usize {
    chunks_over(units, params.fit, params)
}

fn chunks_over(units: usize, one_row: usize, params: &TransParams) -> usize {
    if units <= one_row {
        1
    } else {
        units.div_ceil(chunk_units(params)).max(2)
    }
}

/// Expected reading units of the translation, from the source length
/// (non-whitespace characters × a ratio). The budget is an upper bound
/// (display time × reading speed) and hints made from it alone over-chunk
/// short-for-their-time sentences; a measured length ratio predicts the
/// actual translation. Only measured pairs are listed, each a p75:
///
/// - Latin-script source into a CJK target: 0.34, the en→zh-Hans validation
///   pages;
/// - Thai source into English: 1.3, per-sentence medians of 8 Thai sentences
///   (DeepSeek Flash, 2026-10-01, 189 translations).
///
/// Thai into Chinese was measured too (0.40, 104 translations) and is left
/// out on purpose: its hint of ≥3 gave three long Thai pieces, and DeepSeek
/// Flash answered 8 of 16 pages by echoing the source instead of translating
/// (0 of 16 with the budget's five shorter pieces). Every other pair, Thai
/// into any other language and Lao, Khmer or Burmese sources included,
/// returns `None` and the caller falls back to the budget. A Chinese,
/// Japanese or Korean source is never estimated.
fn estimated_units(source: &str, source_lang: &str, target_lang: &str) -> Option<usize> {
    if matches!(
        crate::split::primary_subtag(source_lang).as_str(),
        "zh" | "ja" | "ko"
    ) {
        return None;
    }
    let target = crate::split::primary_subtag(target_lang);
    let ratio = match (dominant_script(source)?, target.as_str()) {
        (SourceScript::Latin, "zh" | "ja" | "ko") => 0.34,
        (SourceScript::Thai, "en") => 1.3,
        _ => return None,
    };
    let chars = source.chars().filter(|ch| !ch.is_whitespace()).count();
    Some((chars as f64 * ratio).ceil() as usize)
}

/// Scripts [`estimated_units`] has ratios for.
#[derive(Debug, PartialEq)]
enum SourceScript {
    Latin,
    Thai,
    Other,
}

/// The script most of the source's letters are written in. Digits,
/// punctuation and symbols do not count, so `รหัสF-07…` is Thai and an
/// English line quoting one Thai word stays Latin. No letters, or a tie
/// between scripts, gives `None`.
fn dominant_script(source: &str) -> Option<SourceScript> {
    let mut counts = [0usize; 3];
    for ch in source.chars().filter(|ch| ch.is_alphabetic()) {
        let slot = match ch as u32 {
            0x0E00..=0x0E7F => 1,
            0x41..=0x5A | 0x61..=0x7A | 0xC0..=0x24F | 0x1E00..=0x1EFF => 0,
            _ => 2,
        };
        counts[slot] += 1;
    }
    let top = *counts.iter().max()?;
    if top == 0 || counts.iter().filter(|&&count| count == top).count() > 1 {
        return None;
    }
    Some(match counts.iter().position(|&count| count == top)? {
        0 => SourceScript::Latin,
        1 => SourceScript::Thai,
        _ => SourceScript::Other,
    })
}

/// Minimum chunk count hinted for a sentence: the smaller of what its reading
/// budget (the longest translation the row planner accepts) and its expected
/// length need. A sentence asked again is sized by its previous translation,
/// budget or not. Otherwise nothing is hinted without a budget; the row
/// planner still measures the answer.
pub fn chunk_hint(
    sentence: &TranslateSentence,
    source_lang: &str,
    lang: &str,
    params: &TransParams,
) -> usize {
    let words = source_words(sentence).len().max(1);
    let cap = words.div_ceil(2);
    if !sentence.editable {
        // A frozen sentence's budget is the chunking its text needs, set by
        // the caller that froze it, not an upper bound.
        return sentence.budget.map_or(1, |budget| {
            budget.div_ceil(chunk_units(params)).clamp(1, cap)
        });
    }
    if let Some(previous) = &sentence.existing_translation {
        // An editable sentence with a previous translation is being asked
        // again because that translation came back too coarsely chunked:
        // size the hint by its real length and ask for one chunk more.
        // A one-word sentence cannot be cut at all (`cap` is 1), so the
        // floor of two never goes above the cap.
        let units = target_cps_chars(previous, lang);
        return (chunks_for_units(units, params) + 1).max(2).min(cap);
    }
    let Some(budget) = sentence.budget else {
        return 1;
    };
    match estimated_units(&sentence.source, source_lang, lang) {
        Some(estimate) => chunks_for_estimate(estimate.min(budget), params).clamp(1, cap),
        None => chunks_for_units(budget, params).clamp(1, cap),
    }
}

/// Separator shown between the suggested pieces of a long source sentence.
pub use super::lines::PIECE_MARK;

/// Words that open a clause; a piece boundary right before one reads well.
/// Only listed languages get this preference, every other language cuts at
/// punctuation and, failing that, at even intervals.
fn clause_openers(source_lang: &str) -> &'static [&'static str] {
    match crate::split::primary_subtag(source_lang).as_str() {
        "en" => &[
            "and", "but", "or", "because", "so", "which", "that", "when", "if", "while", "as",
            "than", "although", "though", "where", "then",
        ],
        _ => &[],
    }
}

/// Split `words` into `pieces` roughly even runs, preferring boundaries after
/// punctuation and before clause openers within half a run of the even cut.
/// Returns the word indices that start pieces two onwards.
///
/// A source written without spaces arrives one character per word, so a
/// boundary that is not at punctuation may fall inside some word. Such a
/// source takes, inside the window, punctuation first, then a boundary
/// before a clause conjunction of that script, and otherwise the even cut
/// itself. This entry point knows no words; the page renderer also passes
/// the boundaries the dictionary segmenter does not break at and those just
/// inside a bracket or quote (see [`unsure_boundaries`]), and those never
/// open a piece. No piece is punctuation alone. Before that gate the
/// alternatives were measured on zhelite (round 5, design doc §8.5) and all
/// lost: the model copies every mark it is shown, into the word or not,
/// whatever the protocol says about moving it; the host's own subtitle-row
/// starts are budget cuts of the same kind and moved as many marks into
/// words as out of them; showing only the sure marks made the model cut only
/// there, so its chunks grew past the row budget; the seam tables cover
/// function words, not the content words the even cut lands in. A number is
/// never cut. The window stays half a run: a wider search made the pieces
/// uneven enough to push single chunks over the row budget (zhelite round 4).
pub fn piece_boundaries(words: &[String], pieces: usize, source_lang: &str) -> Vec<usize> {
    let per_character = crate::autocorrect::is_unspaced_cjk_language(source_lang);
    piece_boundaries_over(words, pieces, source_lang, per_character, &BTreeSet::new())
}

/// [`piece_boundaries`] with the "one character per word" reading given by
/// the caller: Chinese and Japanese always; Korean only in a transcript older
/// than 0.5, whose words are single syllables carrying the glue flag (a
/// current one has a word per space-delimited unit and scores like any
/// spaced script).
///
/// No piece opens at an `unsure` word index (see [`unsure_boundaries`]): the
/// model translates each piece on its own, so a mark inside a word turns into
/// a mistranslation (`หน้า ¦ ต่าง` "window" came back "front | panel") or a
/// target word cut in two (`5 อง ¦ ศา` gave `5 de|grees`). When the window
/// around an even cut holds only unsure boundaries, the nearest sure one
/// further out opens the piece; with none left, one piece fewer is shown.
fn piece_boundaries_over(
    words: &[String],
    pieces: usize,
    source_lang: &str,
    unspaced: bool,
    unsure: &BTreeSet<usize>,
) -> Vec<usize> {
    let n = words.len();
    if pieces < 2 || n < 2 {
        return Vec::new();
    }
    let pieces = pieces.min(n);
    let openers = clause_openers(source_lang);
    // A conjunction written without spaces spans several one-character
    // words: look at the run that starts at the boundary.
    let opens_cjk_clause = |p: usize| -> bool {
        let run: String = words[p..(p + 3).min(n)].concat();
        crate::seam::CUT_BEFORE_CJK
            .iter()
            .any(|word| run.starts_with(word))
    };
    let score = |p: usize| -> u8 {
        let before = &words[p - 1];
        let after = &words[p];
        if before
            .chars()
            .last()
            .is_some_and(crate::atomize::is_punctuation_or_symbol)
        {
            3
        } else if unspaced {
            u8::from(opens_cjk_clause(p)) * 2
        } else if openers.contains(&after.to_lowercase().as_str()) {
            2
        } else if starts_uppercase(before) && starts_uppercase(after) {
            // Inside a run of capitalised words (a multi-word name in a
            // bicameral script); a no-op for scripts without letter case.
            0
        } else {
            1
        }
    };
    let window = (n / (2 * pieces)).max(1);
    // A boundary between two numerals splits one number (`二十|七岁`, `1|000`);
    // the model then breaks the translated number to obey the piece.
    let inside_number = |p: usize| -> bool {
        words[p - 1].chars().last().is_some_and(is_numeral)
            && words[p].chars().next().is_some_and(is_numeral)
    };
    // A piece of punctuation alone (`シャーロック ¦ ・ ¦ ホームズ`) gives the
    // model nothing to translate: every piece keeps a letter or digit.
    let has_text = |range: std::ops::Range<usize>| {
        words[range]
            .iter()
            .any(|word| word.chars().any(char::is_alphanumeric))
    };
    let mut out: Vec<usize> = Vec::new();
    for i in 1..pieces {
        let target = (i * n).div_ceil(pieces);
        let low = target
            .saturating_sub(window)
            .max(out.last().map_or(1, |b| b + 1));
        let high = (target + window).min(n - 1);
        if low > high {
            continue;
        }
        let start = out.last().copied().unwrap_or(0);
        let usable = |p: usize| !unsure.contains(&p) && has_text(start..p) && has_text(p..n);
        let mut span: Vec<usize> = (low..=high).filter(|&p| usable(p)).collect();
        if span.is_empty() {
            let from = out.last().map_or(1, |b| b + 1);
            match (from..n)
                .filter(|&p| usable(p) && !inside_number(p))
                .min_by_key(|&p| p.abs_diff(target))
            {
                Some(p) => span.push(p),
                None => continue,
            }
        }
        let candidates: Vec<usize> = span
            .iter()
            .copied()
            .filter(|&p| !inside_number(p))
            .collect();
        let candidates = if candidates.is_empty() {
            span
        } else {
            candidates
        };
        let best = candidates
            .into_iter()
            .max_by_key(|&p| (score(p), std::cmp::Reverse(p.abs_diff(target))))
            .expect("non-empty window");
        out.push(best);
    }
    out
}

/// A digit of any script, or one of the ideographic numerals that spell a
/// number out character by character.
fn is_numeral(ch: char) -> bool {
    ch.is_numeric()
        || matches!(
            ch,
            '零' | '〇'
                | '一'
                | '二'
                | '两'
                | '三'
                | '四'
                | '五'
                | '六'
                | '七'
                | '八'
                | '九'
                | '十'
                | '百'
                | '千'
                | '万'
                | '亿'
                | '兆'
        )
}

fn starts_uppercase(word: &str) -> bool {
    word.chars()
        .find(|c| c.is_alphabetic())
        .is_some_and(char::is_uppercase)
}

/// `source` with [`PIECE_MARK`] inserted before each boundary word. `None`
/// when the words cannot be located in the source in order (tokenised text
/// that no longer matches its sentence).
pub fn with_pieces(source: &str, words: &[String], boundaries: &[usize]) -> Option<String> {
    if boundaries.is_empty() {
        return Some(source.to_owned());
    }
    let mut out = String::new();
    let mut cursor = 0;
    for (index, word) in words.iter().enumerate() {
        let at = source[cursor..].find(word.as_str())? + cursor;
        if boundaries.contains(&index) {
            out.push_str(source[cursor..at].trim_end());
            out.push(' ');
            out.push(PIECE_MARK);
            out.push(' ');
        } else {
            out.push_str(&source[cursor..at]);
        }
        out.push_str(word);
        cursor = at + word.len();
    }
    out.push_str(&source[cursor..]);
    Some(out)
}

/// Piece starts shown for `sentence` on `page` (empty when one chunk is
/// enough); the same boundaries the resolver prefers when reading the answer.
pub fn pieces(page: &TranslatePage, sentence: &TranslateSentence) -> Vec<usize> {
    pieces_with_params(page, sentence, &TransParams::for_lang(&page.target_lang))
}

/// [`pieces`] under the planner's effective row thresholds.
pub fn pieces_with_params(
    page: &TranslatePage,
    sentence: &TranslateSentence,
    params: &TransParams,
) -> Vec<usize> {
    let chunks = chunk_hint(sentence, &page.source_lang, &page.target_lang, params);
    // Only pre-0.5 per-syllable Korean words count here: glue on words of a
    // script split into words (Thai and the like) says nothing about the
    // source being cut per character.
    let glued = sentence.alignment.as_ref().is_some_and(|alignment| {
        alignment
            .source_words
            .iter()
            .zip(&alignment.source_glue)
            .any(|(word, glue)| crate::atomize::is_legacy_glued(&(word.as_str(), *glue)))
    });
    let per_character = crate::autocorrect::is_unspaced_cjk_language(&page.source_lang)
        || (glued && crate::autocorrect::is_cjk_language(&page.source_lang));
    let words = source_words(sentence);
    let unsure = if chunks > 1 {
        unsure_boundaries(&sentence.source, &words)
    } else {
        BTreeSet::new()
    };
    piece_boundaries_over(&words, chunks, &page.source_lang, per_character, &unsure)
}

/// Word indices whose boundary with the previous word may fall inside one
/// word: the two words touch in `source` with letters of one segmented
/// family on both sides, and the dictionary segmenter does not break there.
/// The families are the scripts cut by a word model (Thai, Lao, Khmer,
/// Myanmar) and Han with kana. For the first, the stored words come from the
/// LSTM model, which splits compounds the dictionary keeps (`หน้า|ต่าง`),
/// while the dictionary splits names the LSTM keeps; a boundary both agree
/// on is sure. Chinese and Japanese are stored one character per word, so
/// the dictionary alone decides (`视 ¦ 频` becomes `视频 ¦`); it still parts
/// some Japanese stems from their endings (`集 ¦ まって`). Boundaries at
/// spaces, punctuation, digits or another script are otherwise sure, and so
/// is every boundary of a script neither covers (Hangul syllables are in
/// neither family).
///
/// Whatever the script, a boundary just inside a bracket or quote is unsure
/// too (see [`inside_delimiter`]): the model keeps the opener with the piece
/// before it, and the joined translation reads `“ confirmed”`. Empty when
/// the words cannot be found in `source` in order.
fn unsure_boundaries(source: &str, words: &[String]) -> BTreeSet<usize> {
    let mut spans = Vec::with_capacity(words.len());
    let mut cursor = 0;
    for word in words {
        let Some(at) = source[cursor..].find(word.as_str()) else {
            return BTreeSet::new();
        };
        let start = cursor + at;
        cursor = start + word.len();
        spans.push((start, cursor));
    }
    let mut unsure = BTreeSet::new();
    let mut seams = Vec::new();
    for p in 1..words.len() {
        let (Some(before), Some(after)) = (words[p - 1].chars().last(), words[p].chars().next())
        else {
            continue;
        };
        let touching = spans[p - 1].1 == spans[p].0;
        if inside_delimiter(&words[p - 1], &words[p], touching) {
            unsure.insert(p);
        } else if touching
            && ((crate::atomize::is_lstm_script_char(before)
                && crate::atomize::is_lstm_script_char(after))
                || (crate::atomize::is_unspaced_cjk_char(before)
                    && crate::atomize::is_unspaced_cjk_char(after)))
        {
            seams.push(p);
        }
    }
    if seams.is_empty() {
        return unsure;
    }
    let sure: BTreeSet<usize> = crate::word_breaks::dictionary_word_boundaries(source)
        .into_iter()
        .collect();
    unsure.extend(seams.into_iter().filter(|&p| !sure.contains(&spans[p].0)));
    unsure
}

/// The boundary between `before` and `after` falls just inside a bracket or
/// quote: after an opener or before a closer. Brackets (Unicode Ps / Pe,
/// `(`, `「`, `„`) only ever open or close. Quotation marks (Pi / Pf) point
/// either way by language — German closes `„…“` with the mark English
/// opens with, Swedish opens `”…”` with the one English closes with,
/// German writes `»…«` — so one counts only when it is plainly attached to
/// the text on that side: nothing between them (`ว่า“ยืนยัน`, `说“已经`), or
/// standing alone as a word of its own (French `« mot »`). A German
/// `„bestätigt“ aber` and a Swedish `sa ”hej”` keep their sure boundaries.
fn inside_delimiter(before: &str, after: &str, touching: bool) -> bool {
    let opens = before
        .chars()
        .last()
        .is_some_and(|ch| match get_general_category(ch) {
            GeneralCategory::OpenPunctuation => true,
            GeneralCategory::InitialPunctuation => touching || before.chars().all(|c| c == ch),
            _ => false,
        });
    let closes = after
        .chars()
        .next()
        .is_some_and(|ch| match get_general_category(ch) {
            GeneralCategory::ClosePunctuation => true,
            GeneralCategory::FinalPunctuation => touching || after.chars().all(|c| c == ch),
            _ => false,
        });
    opens || closes
}

/// The source words a sentence is quoted by: the host's word atoms when the
/// page carries them, else the sentence text atomised.
pub fn source_words(sentence: &TranslateSentence) -> Vec<String> {
    match &sentence.alignment {
        Some(alignment) if !alignment.source_words.is_empty() => alignment.source_words.clone(),
        _ => atomize(&sentence.source),
    }
}

/// [`source_words`] with each word's stored glue flag (no space before it
/// when the words are joined back into text).
fn source_tokens(sentence: &TranslateSentence) -> Vec<(String, bool)> {
    let glue = sentence
        .alignment
        .as_ref()
        .map(|alignment| alignment.source_glue.as_slice())
        .unwrap_or_default();
    source_words(sentence)
        .into_iter()
        .enumerate()
        .map(|(index, word)| (word, glue.get(index).copied().unwrap_or(false)))
        .collect()
}

/// Render under the target language's default row thresholds.
pub fn render(page: &TranslatePage) -> String {
    render_with_params(page, &TransParams::for_lang(&page.target_lang))
}

/// Render under the planner's effective row thresholds: `row=` and every
/// `≥k` hint are sized from `params`, so the chunks asked for are the rows
/// the planner will accept.
pub fn render_with_params(page: &TranslatePage, params: &TransParams) -> String {
    let mut out = format!(
        "! format=lines/1 mode=blocks row={} target={}\n",
        params.fit, page.target_lang
    );
    if let Some(context) = &page.context_before {
        out.push_str(&format!("# before {}\n", lines::escape(context, false)));
    }
    let mut n = 0;
    let mut hinted = 0;
    for section in &page.sections {
        out.push('\n');
        if let Some(speaker) = &section.speaker {
            out.push_str(&format!("@{}\n", lines::escape(speaker, false)));
        }
        for sentence in &section.sentences {
            n += 1;
            let mut hints = String::new();
            if sentence.editable {
                if let Some(budget) = sentence.budget {
                    hints.push_str(&format!("≤{budget} "));
                }
            }
            let chunks = chunk_hint(sentence, &page.source_lang, &page.target_lang, params);
            if chunks > 1 {
                hints.push_str(&format!("≥{chunks} "));
                hinted += 1;
            }
            // Escape first, then place the piece marks: a mark is metadata
            // and must stay unescaped, while a literal `¦` in the source
            // reads `\¦` like any other sign.
            let escaped = lines::escape(&sentence.source, false);
            let escaped_words: Vec<String> = source_words(sentence)
                .iter()
                .map(|word| lines::escape(word, false))
                .collect();
            let source = with_pieces(
                &escaped,
                &escaped_words,
                &pieces_with_params(page, sentence, params),
            )
            .unwrap_or(escaped);
            out.push_str(&format!("{n} {hints}{source}\n"));
            if !sentence.editable {
                out.push_str(&format!(
                    "= {n} {}\n",
                    lines::escape(
                        sentence.existing_translation.as_deref().unwrap_or(""),
                        false
                    )
                ));
            }
            if !sentence.required_targets.is_empty() {
                out.push_str(&format!(
                    "! {n} required={}\n",
                    serde_json::to_string(&sentence.required_targets).expect("string list")
                ));
            }
        }
    }
    if let Some(context) = &page.context_after {
        out.push_str(&format!("# after {}\n", lines::escape(context, false)));
    }
    // Long pages dilute the contract; restate the rules that fail most (line
    // drift, chunk collapse, and answering in the source language) where the
    // model reads last. The target language is named here and in the header
    // because nothing else in the page says it: the system prompt gives it
    // once, and without a document brief every other word the model reads is
    // in the source language.
    out.push_str(&format!(
        "\n! reminder: {n} numbered lines in, {n} numbered lines out with the same numbers — never merge or split lines. Every sentence marked ≥k ({hinted} of them) must come back as at least k |..| chunks, from the first line to the last — cut the translation, never repeat or pad it. Chunk text is the translation written in the target language (target={target}); the source language appears only inside the |..| markers.\n",
        target = page.target_lang
    ));
    out
}

/// Whitespace the model leaves around a chunk boundary is transport noise
/// (it tends to write `text |marker|`, and the chunks are joined as-is): a
/// whitespace-only chunk becomes text-less, the line's ends are trimmed, and
/// a joint keeps one space where the neighbouring characters are of a script
/// that spaces its words and none between wide characters.
///
/// The opposite slip happens too: told not to pad a `|` with spaces, a model
/// writing a space-delimited target drops the space the language itself puts
/// there (`weak,|I think`, `I|found`), and joining the chunks glues words
/// together. A joint after sentence punctuation always gets its space back.
/// A joint between two word characters is ambiguous — `I|found` wants a
/// space, `somat|ized` (a target word split at a piece mark) does not — so
/// it is read by the line's own convention: when no joint of the line carries
/// whitespace the model dropped them all and every such joint gets a space;
/// when other joints are spaced, a glued one is deliberate and stays glued.
/// Targets written without spaces between words (wide scripts, and Thai, Lao,
/// Burmese, Khmer, Tibetan) are never spaced this way: a joint there keeps a
/// space only when the model wrote one, or between two words of a spaced
/// script.
///
/// A joint just inside a bracket or quote never keeps a space, even one the
/// model wrote: a chunk that ends on an opener (`next to the word “` +
/// `confirmed”`) or a chunk that starts with a closer. Only marks whose
/// direction the context settles count — see [`opens_at_end`] and
/// [`closes_at_start`]; the rest keep the space as written.
fn tidy_joints(record: &mut Record, spaced_target: bool) {
    for chunk in &mut record.chunks {
        if chunk.text.trim().is_empty() {
            chunk.text.clear();
        }
    }
    // A chunk that is only punctuation belongs to the chunk before it: appended
    // when that chunk ends in a letter, dropped when it already ends in
    // punctuation (`…，` + `，` would otherwise print `，，`).
    let mut previous: Option<usize> = None;
    for index in 0..record.chunks.len() {
        let text = record.chunks[index].text.trim().to_owned();
        if text.is_empty() {
            continue;
        }
        let punctuation_only = text.chars().all(crate::atomize::is_punctuation_or_symbol);
        match (punctuation_only, previous) {
            (true, Some(at)) => {
                let tail = &mut record.chunks[at].text;
                if !tail
                    .trim_end()
                    .chars()
                    .last()
                    .is_some_and(crate::atomize::is_punctuation_or_symbol)
                {
                    let trimmed = tail.trim_end().to_owned();
                    *tail = trimmed + &text;
                }
                record.chunks[index].text.clear();
            }
            _ => previous = Some(index),
        }
    }
    let textual: Vec<usize> = (0..record.chunks.len())
        .filter(|&index| !record.chunks[index].text.is_empty())
        .collect();
    if let Some(&first) = textual.first() {
        let text = &mut record.chunks[first].text;
        *text = text.trim_start().to_owned();
    }
    if let Some(&last) = textual.last() {
        let text = &mut record.chunks[last].text;
        *text = text.trim_end().to_owned();
    }
    let joint_spaced = |record: &Record, a: usize, b: usize| {
        record.chunks[a].text.ends_with(char::is_whitespace)
            || record.chunks[b].text.starts_with(char::is_whitespace)
    };
    let line_spaced = textual
        .windows(2)
        .any(|pair| joint_spaced(record, pair[0], pair[1]));
    for pair in textual.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let spaced = joint_spaced(record, a, b);
        let head = record.chunks[b].text.trim_start().to_owned();
        let mut tail = record.chunks[a].text.trim_end().to_owned();
        let (Some(last), Some(first)) = (tail.chars().last(), head.chars().next()) else {
            continue;
        };
        let wide = unspaced_pair(last, first);
        let space = if wide || opens_at_end(&tail) || closes_at_start(&head) {
            false
        } else if spaced {
            true
        } else if !spaced_target {
            // Two words of a spaced script meeting inside an unspaced
            // translation (`University|of Toronto`) keep their space; a
            // split word is the rarer case and reads worse glued.
            spaced_script_letter(last) && spaced_script_letter(first)
        } else if matches!(
            first,
            ',' | '.' | ';' | ':' | '!' | '?' | ')' | ']' | '}' | '”' | '’' | '»' | '-' | '—' | '–'
        ) || matches!(last, '(' | '[' | '{' | '“' | '‘' | '«' | '-' | '/')
        {
            false
        } else if matches!(last, ',' | '.' | ';' | ':' | '!' | '?') {
            true
        } else {
            !line_spaced
        };
        if space {
            tail.push(' ');
        }
        record.chunks[a].text = tail;
        record.chunks[b].text = head;
    }
}

/// `text` ends with a mark that opens what follows. A bracket (Unicode Ps:
/// `(`, `「`, `„`) always does. `“` and `‘` open in English and Chinese but
/// close in German (`„bestätigt“`, `„Ja!“`), so they count only after a space,
/// another opener or dash, the start of the text, or a letter of a script
/// written without spaces (`说“`, `ว่า“`). Other quotation marks are left
/// alone: French writes `« mot »` with the spaces inside, German `»…«`.
fn opens_at_end(text: &str) -> bool {
    let mut chars = text.chars().rev();
    match chars.next() {
        // A tone mark or virama belongs to the letter before it (`ไม่“`).
        Some('“' | '‘') => chars
            .find(|&ch| !crate::atomize::is_combining(ch))
            .is_none_or(|before| {
                before.is_whitespace()
                    || matches!(
                        get_general_category(before),
                        GeneralCategory::OpenPunctuation
                            | GeneralCategory::InitialPunctuation
                            | GeneralCategory::DashPunctuation
                    )
                    || (before.is_alphanumeric() && !spaced_script_letter(before))
            }),
        Some(last) => get_general_category(last) == GeneralCategory::OpenPunctuation,
        None => false,
    }
}

/// `text` starts with a mark that closes what precedes it: a bracket
/// (Unicode Pe), or `”` unless a letter of a spaced script follows it
/// (Swedish and Finnish open a quote with `”`). `’` is also an apostrophe
/// and `»` opens in German; neither counts.
fn closes_at_start(text: &str) -> bool {
    let mut chars = text.chars();
    match chars.next() {
        Some('”') => !chars.next().is_some_and(spaced_script_letter),
        Some(first) => get_general_category(first) == GeneralCategory::ClosePunctuation,
        None => false,
    }
}

/// Shortest chunk (in reading units) that the repeat check looks at;
/// interjections repeated on purpose are shorter.
const REPEAT_MIN_UNITS: usize = 4;

/// The units the repeat check compares: one per CJK character, one per run of
/// other characters (a word), punctuation and case folded away. Comparing
/// characters instead would let one long shared token (`Salesforce`, a URL)
/// outweigh everything else in a short chunk.
fn repeat_units(text: &str, interner: &mut AtomInterner) -> Vec<u32> {
    let mut units = Vec::new();
    for word in text.split_whitespace() {
        let mut run = String::new();
        for ch in normalize_chars(word).chars() {
            if is_cjk_char(ch) {
                if !run.is_empty() {
                    units.push(interner.intern(&run));
                    run.clear();
                }
                units.push(interner.intern(ch.encode_utf8(&mut [0; 4])));
            } else {
                run.push(ch);
            }
        }
        if !run.is_empty() {
            units.push(interner.intern(&run));
        }
    }
    units
}

/// Units the two chunks share, in order (`None` when either is empty or the
/// comparison is over the LCS cap).
fn shared_units(a: &[u32], b: &[u32]) -> Option<usize> {
    (!a.is_empty() && !b.is_empty())
        .then(|| lcs_matches(a, b, LCS_CELL_CAP).map(|matches| matches.len()))
        .flatten()
}

/// Whether the two chunks' quotes can point at two distinct source spans that
/// repeat each other: the source says something twice (`critical, critical`,
/// `faster and faster`, one clause negating a copy of the other, `caring
/// about the transcript … and caring about each call`), so a repeated
/// translation is faithful, not padding. Two spans repeat each other when
/// they share 4 of 5 of the shorter one's units in order, share a run of
/// at least two units that is 2 of 5 of the shorter span, or — when the
/// caller allows it — the word that closes the earlier span reopens the
/// later one (`which is critical,` / `critical for today's AI development`:
/// the repetition sits on the seam, however much else each span holds).
///
/// The seam rule is a proxy: `rejected it; it was expensive` has the same
/// shape, and nothing on the source side tells the two apart. The caller
/// allows it only when the translation shows the rest of the later span was
/// rendered too (the longer chunk carries at least as much beyond the shared
/// units as the shared units themselves); two chunks that merely restate
/// each other over a shared seam word are padding.
fn source_repeats<W: JoinWord>(
    words: &[W],
    a: &Reference,
    b: &Reference,
    seam_allowed: bool,
    interner: &mut AtomInterner,
) -> bool {
    let text = |span: &std::ops::Range<usize>, interner: &mut AtomInterner| {
        repeat_units(&join_word_texts(&words[span.clone()]), interner)
    };
    let spans_a = lines::candidate_spans(words, a);
    let spans_b = lines::candidate_spans(words, b);
    spans_a.iter().any(|span_a| {
        spans_b.iter().any(|span_b| {
            let disjoint = span_a.end <= span_b.start || span_b.end <= span_a.start;
            if !disjoint {
                return false;
            }
            let a = text(span_a, interner);
            let b = text(span_b, interner);
            let shorter = a.len().min(b.len());
            let (earlier, later) = if span_a.end <= span_b.start {
                (&a, &b)
            } else {
                (&b, &a)
            };
            let seam_repeat =
                seam_allowed && earlier.last().is_some() && earlier.last() == later.first();
            let shared = shared_units(&a, &b).unwrap_or(0);
            shorter > 0
                && (seam_repeat
                    || shared * 5 >= shorter * 4
                    || (shared >= 2 && shared * 5 >= shorter * 2))
        })
    })
}

/// Two adjacent chunks whose reading units nearly coincide while their source
/// does not repeat itself: the model wrote the same span twice to reach the
/// requested chunk count. Returns the repeated text.
fn repeated_chunk<W: JoinWord>(record: &Record, words: &[W]) -> Option<String> {
    let textual: Vec<&Chunk> = record
        .chunks
        .iter()
        .filter(|chunk| !chunk.text.is_empty())
        .collect();
    let mut interner = AtomInterner::default();
    for pair in textual.windows(2) {
        let a = repeat_units(&pair[0].text, &mut interner);
        let b = repeat_units(&pair[1].text, &mut interner);
        let shorter = a.len().min(b.len());
        if shorter < REPEAT_MIN_UNITS {
            continue;
        }
        // 4 of 5 units of the shorter side in common, in order.
        let Some(shared) = shared_units(&a, &b).filter(|shared| shared * 5 >= shorter * 4) else {
            continue;
        };
        let beyond_shared = a.len().max(b.len()) - shared;
        if source_repeats(
            words,
            &pair[0].reference,
            &pair[1].reference,
            beyond_shared >= shared,
            &mut interner,
        ) {
            continue;
        }
        return Some(pair[1].text.trim().to_owned());
    }
    None
}

/// Unescaped occurrences of `needle` in a raw answer line.
fn unescaped_count(line: &str, needle: char) -> usize {
    let mut count = 0;
    let mut chars = line.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            chars.next();
        } else if ch == needle {
            count += 1;
        }
    }
    count
}

/// `text ¦ LEFT..RIGHT|text`: the model wrote the piece mark where the next
/// marker's opening `|` belongs (altman en→zh 40 of 446 lines in one run,
/// en→ko 126 of 480). Read as written, the quote lands inside the previous
/// chunk's text — source words shown in the translation — and the next
/// chunk's text is taken for a marker that names no source word. Returns the
/// line with those marks turned into bars, and how many: only a mark in chunk
/// text that is directly followed by an endpoint quote of this sentence and
/// then a `|` qualifies, so a mark echoed inside chunk text (a cut hint) or
/// inside a quote is left alone.
fn reopen_markers<W: JoinWord>(line: &str, words: &[W]) -> Option<(String, usize)> {
    let mut delimiters: Vec<(usize, char)> = Vec::new();
    let mut chars = line.char_indices();
    while let Some((at, ch)) = chars.next() {
        if ch == '\\' {
            chars.next();
        } else if ch == PIECE_MARK || ch == '|' {
            delimiters.push((at, ch));
        }
    }
    // Bars so far, a reopened mark included: an even count of two or more
    // means the mark sits in chunk text; an odd one, inside a marker (a mark
    // echoed into a quote is noise the record parser drops).
    let mut bars = 0usize;
    let mut reopened: Vec<usize> = Vec::new();
    for (index, &(at, delimiter)) in delimiters.iter().enumerate() {
        if delimiter == '|' {
            bars += 1;
            continue;
        }
        let Some(&(next, '|')) = delimiters.get(index + 1) else {
            continue;
        };
        if bars < 2 || bars % 2 != 0 {
            continue;
        }
        let quote = &line[at + PIECE_MARK.len_utf8()..next];
        if lines::endpoint_quote(quote)
            .is_some_and(|reference| lines::quotes_occur(words, &reference) == Some(true))
        {
            reopened.push(at);
            bars += 1;
        }
    }
    if reopened.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(line.len());
    let mut cursor = 0;
    for at in &reopened {
        out.push_str(line[cursor..*at].trim_end());
        out.push('|');
        let rest = &line[at + PIECE_MARK.len_utf8()..];
        cursor = line.len() - rest.trim_start().len();
    }
    out.push_str(&line[cursor..]);
    Some((out, reopened.len()))
}

pub struct Parsed {
    pub translation: TranslateParsed,
    pub records: BTreeMap<usize, Record>,
    pub issues: Vec<(usize, Issue)>,
}

/// One editable sentence's answer under the lines carrier, kept next to its
/// translation for the align engine: the parsed record, the piece starts it
/// was shown with, and the source words its quotes refer to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslateLinesDraft {
    pub record: Record,
    pub pieces: Vec<usize>,
    pub source_words: Vec<String>,
}

/// `record` with its chunk texts re-cut from `committed`: the same
/// translation after the host's formatting pass (spacing, punctuation and
/// case only). Each textual chunk takes `committed` from where its own
/// significant characters start up to the next textual chunk's start (the
/// first from the beginning, the last to the end); text-less chunks stay
/// text-less. `None` when the significant characters no longer line up.
pub fn rebase(record: &Record, committed: &str) -> Option<Record> {
    let textual: Vec<usize> = (0..record.chunks.len())
        .filter(|&index| !record.chunks[index].text.is_empty())
        .collect();
    if textual.is_empty() {
        return None;
    }
    let chunks: Vec<AlignChunk> = textual
        .iter()
        .map(|&index| AlignChunk {
            text: record.chunks[index].text.clone(),
            ordinals: Vec::new(),
        })
        .collect();
    let ranges = chunk_char_ranges(&chunks, committed)?;
    if normalize_chars(&record.text()) != normalize_chars(committed) {
        return None;
    }
    let chars: Vec<char> = committed.chars().collect();
    let mut starts: Vec<usize> = ranges.iter().map(|range| range.start).collect();
    starts[0] = 0;
    let mut out = record.clone();
    for (slot, &index) in textual.iter().enumerate() {
        let end = starts.get(slot + 1).copied().unwrap_or(chars.len());
        let start = starts[slot].min(end);
        out.chunks[index].text = chars[start..end].iter().collect();
    }
    Some(out)
}

/// Per quote of a record's chunks that carry text: does it occur in `words`?
/// Non-quote chunks are skipped, so an empty result means the record carries
/// no textual quotes. Text-less markers say nothing about which sentence the
/// line translates: a model that merged two lines and counted on echoes its
/// own sentence's markers text-less at the start of every later line, then
/// writes the next sentence's translation after them.
fn quote_hits<W: JoinWord>(record: &Record, words: &[W]) -> Vec<bool> {
    record
        .chunks
        .iter()
        .filter(|chunk| !chunk.text.is_empty())
        .filter_map(|chunk| lines::quotes_occur(words, &chunk.reference))
        .collect()
}

/// `record` re-numbered for `home`, without the text-less markers that quote
/// some other sentence (the echoes a drifted line opens with); a text-less
/// marker that does occur in `home` is a genuine affiliation and stays.
fn reattributed<W: JoinWord>(record: &Record, home: usize, words: &[W]) -> Record {
    let chunks = record
        .chunks
        .iter()
        .filter(|chunk| {
            !chunk.text.is_empty() || lines::quotes_occur(words, &chunk.reference) != Some(false)
        })
        .cloned()
        .collect();
    Record {
        n: home,
        chunks,
        ..record.clone()
    }
}

fn quotes_all_hit<W: JoinWord>(record: &Record, words: &[W]) -> bool {
    let hits = quote_hits(record, words);
    !hits.is_empty() && hits.iter().all(|hit| *hit)
}

/// What a numbered line's quotes say about which sentence it translates.
enum Verdict {
    /// Its own sentence (quotes that miss are slips, the chunks stay unlocated).
    Own,
    /// Another sentence: no quote hits its own sentence and every quote hits
    /// one other sentence — the line drifted after a merge or a skip.
    Drifted,
    /// Its own sentence plus a neighbour's: the listed chunks quote another
    /// sentence and repeat text that sentence's own line already carries.
    Merged(Vec<usize>),
    /// Its own sentence plus a neighbour that has no line of its own: the
    /// translation of both was written under one number.
    Swallowed,
}

/// `records` holds only lines whose quotes hit their own sentence (a drifted
/// neighbour is no evidence that the neighbour was translated).
fn verdict<W: JoinWord>(
    record: &Record,
    own: usize,
    words: &[Vec<W>],
    records: &BTreeMap<usize, &Record>,
) -> Verdict {
    let hits = quote_hits(record, &words[own]);
    if hits.is_empty() || hits.iter().all(|hit| *hit) {
        return Verdict::Own;
    }
    if hits.iter().all(|hit| !hit) {
        let home = (0..words.len()).any(|m| m != own && quotes_all_hit(record, &words[m]));
        return if home { Verdict::Drifted } else { Verdict::Own };
    }
    let mut merged = Vec::new();
    for (index, chunk) in record.chunks.iter().enumerate() {
        let Reference::Quote { .. } = &chunk.reference else {
            continue;
        };
        // Only a chunk with text can have swallowed a neighbour's translation.
        if chunk.text.is_empty()
            || lines::quotes_occur(&words[own], &chunk.reference) != Some(false)
        {
            continue;
        }
        let homes: Vec<usize> = (0..words.len())
            .filter(|&m| m != own && lines::quotes_occur(&words[m], &chunk.reference) == Some(true))
            .collect();
        if homes.is_empty() {
            continue;
        }
        let text = chunk.text.trim();
        let repeated = !text.is_empty()
            && homes
                .iter()
                .filter_map(|m| records.get(&(m + 1)))
                .any(|home| home.text().contains(text));
        if repeated {
            merged.push(index);
        } else if homes.iter().any(|m| !records.contains_key(&(m + 1))) {
            return Verdict::Swallowed;
        }
    }
    if merged.is_empty() {
        Verdict::Own
    } else {
        Verdict::Merged(merged)
    }
}

/// [`parse_with_params`] under the target language's default row thresholds.
pub fn parse(page: &TranslatePage, input: &str, output: &str) -> Parsed {
    parse_with_params(
        page,
        input,
        output,
        &TransParams::for_lang(&page.target_lang),
    )
}

/// Parse the model's answer to `input` (the rendering of `page` under
/// `params`). `translation.lines` carries, for every accepted editable
/// sentence, its record together with the pieces it was rendered with.
pub fn parse_with_params(
    page: &TranslatePage,
    input: &str,
    output: &str,
    params: &TransParams,
) -> Parsed {
    // A target written without spaces between words never has a space added
    // at a joint: the model's own spaces (phrase breaks) are kept as written.
    let spaced_target = !(crate::autocorrect::is_unspaced_cjk_language(&page.target_lang)
        || crate::autocorrect::is_unspaced_script_language(&page.target_lang));
    let mut result = Parsed {
        translation: TranslateParsed::default(),
        records: BTreeMap::new(),
        issues: Vec::new(),
    };
    let ids = page.sentence_ids();
    if output.trim().is_empty() || output.chars().count() > max_output_chars(input.chars().count())
    {
        result.translation.page_rejected = true;
        result.translation.retry_ids = ids.iter().map(|id| (*id).to_owned()).collect();
        return result;
    }
    let words: Vec<Vec<(String, bool)>> = ids
        .iter()
        .map(|id| source_tokens(page.sentence(id).expect("page id")))
        .collect();
    let mut seen = BTreeSet::new();
    let mut rejected = BTreeSet::new();
    let mut echoed_marks = 0usize;
    let mut reopened_marks = 0usize;
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let prefix = line.split_once(' ').map(|(id, _)| id.trim_end_matches('~'));
        let n = prefix.and_then(|id| id.parse::<usize>().ok()).unwrap_or(0);
        if n == 0 || n > ids.len() {
            echoed_marks += unescaped_count(line, PIECE_MARK);
            result.issues.push((n, Issue::LinesSyntax));
            continue;
        }
        let reopened = reopen_markers(line, &words[n - 1]);
        let line = match &reopened {
            Some((line, count)) => {
                reopened_marks += count;
                line.as_str()
            }
            None => line,
        };
        echoed_marks += unescaped_count(line, PIECE_MARK);
        if !seen.insert(n) {
            rejected.insert(n);
            result
                .translation
                .diagnostics
                .push_problem(Problem::sentence(
                    ProblemCode::DuplicateId,
                    ids[n - 1],
                    "duplicate numbered line",
                ));
            continue;
        }
        match lines::parse(line) {
            Ok(mut record) if !record.rewrite => {
                tidy_joints(&mut record, spaced_target);
                result.records.insert(n, record);
            }
            Ok(_) => {
                rejected.insert(n);
                result.issues.push((n, Issue::RewriteForbidden));
            }
            Err(issue) => {
                rejected.insert(n);
                result.issues.push((n, issue));
            }
        }
    }
    result.translation.page_rejected = seen.is_empty();
    // Piece marks are input-only; echoed ones were taken out at parse time
    // (the ones inside chunk text kept as the model's cut hints).
    if echoed_marks > 0 {
        result
            .translation
            .diagnostics
            .push_warning(Warning::document(
                WarningCode::MarkerResidue,
                format!(
                    "{echoed_marks} echoed piece mark(s) `{PIECE_MARK}` removed from the answer and kept as cut hints"
                ),
            ));
    }
    if reopened_marks > 0 {
        result
            .translation
            .diagnostics
            .push_warning(Warning::document(
                WarningCode::MarkerResidue,
                format!(
                    "{reopened_marks} piece mark(s) `{PIECE_MARK}` written where a marker opens were read as `|`"
                ),
            ));
    }
    // Line drift: a numbered line whose quotes occur nowhere in its own
    // sentence is not that sentence's translation. Reject it; when its quotes
    // all occur in exactly one other sentence that has no line of its own,
    // accept it there (advisory) — the model merged or skipped a line and then
    // counted on.
    // Padding: a chunk that restates its neighbour to reach the requested
    // count, judged against the sentence's own words (a source that repeats
    // itself is translated repeating).
    let repeats: Vec<(usize, String)> = result
        .records
        .iter()
        .filter_map(|(n, record)| repeated_chunk(record, &words[*n - 1]).map(|text| (*n, text)))
        .collect();
    for (n, repeat) in repeats {
        result.records.remove(&n);
        rejected.insert(n);
        result
            .translation
            .diagnostics
            .push_problem(Problem::sentence(
                ProblemCode::TranslationChunkRepeat,
                ids[n - 1],
                format!(
                    "chunk repeats the previous chunk's text (\"{repeat}\"): translate the sentence once; fewer chunks are fine when it is short"
                ),
            ));
    }
    // A chunk whose text is itself a marker of this sentence (`…|llegó..él|`
    // with the quote sitting in the text slot): the model wrote source
    // markers where the translation belongs, so what the other chunks carry
    // is not a translation either. The whole line is asked again.
    let cited: Vec<(usize, String)> = result
        .records
        .iter()
        .filter_map(|(n, record)| {
            record
                .chunks
                .iter()
                .find(|chunk| {
                    lines::endpoint_quote(&chunk.text).is_some_and(|quote| {
                        lines::quotes_occur(&words[*n - 1], &quote) == Some(true)
                    })
                })
                .map(|chunk| (*n, chunk.text.trim().to_owned()))
        })
        .collect();
    for (n, quote) in cited {
        result.records.remove(&n);
        rejected.insert(n);
        result
            .translation
            .diagnostics
            .push_problem(Problem::sentence(
                ProblemCode::TranslationSourceCopy,
                ids[n - 1],
                format!(
                    "chunk text is a source marker (\"{quote}\"), not a translation: every chunk is its marker first, then its text in the target language"
                ),
            ));
    }
    // A chunk quoting the read-only context line (`# before` / `# after`)
    // translates the neighbour, not this sentence: the last line of a page
    // sometimes runs on into the context that follows it. The chunk goes,
    // the rest of the line stands; a line with nothing else is missing.
    let context_words: Vec<Vec<String>> = [&page.context_before, &page.context_after]
        .into_iter()
        .flatten()
        .map(|text| atomize(text))
        .collect();
    let mut echoed: Vec<(usize, Vec<usize>)> = Vec::new();
    for (&n, record) in &result.records {
        let dropped: Vec<usize> = record
            .chunks
            .iter()
            .enumerate()
            .filter(|(_, chunk)| {
                !chunk.text.is_empty()
                    && lines::quotes_occur(&words[n - 1], &chunk.reference) == Some(false)
                    && words
                        .iter()
                        .all(|other| lines::quotes_occur(other, &chunk.reference) != Some(true))
                    && context_words
                        .iter()
                        .any(|context| lines::quotes_occur(context, &chunk.reference) == Some(true))
            })
            .map(|(index, _)| index)
            .collect();
        if !dropped.is_empty() {
            echoed.push((n, dropped));
        }
    }
    for (n, dropped) in echoed {
        let record = result.records.get_mut(&n).expect("echoed record");
        let nothing_left = record
            .chunks
            .iter()
            .enumerate()
            .all(|(index, chunk)| chunk.text.is_empty() || dropped.contains(&index));
        if nothing_left {
            result.records.remove(&n);
            rejected.insert(n);
            continue;
        }
        let mut index = 0;
        record.chunks.retain(|_| {
            let keep = !dropped.contains(&index);
            index += 1;
            keep
        });
        tidy_joints(record, spaced_target);
        result
            .translation
            .diagnostics
            .push_warning(Warning::sentence(
                WarningCode::ContentIgnored,
                ids[n - 1],
                format!(
                    "{} chunk(s) quoting the read-only context line dropped",
                    dropped.len()
                ),
            ));
    }
    let mut moved: Vec<(usize, usize, Record)> = Vec::new();
    let mut mismatched = Vec::new();
    let mut trimmed: Vec<(usize, Vec<usize>)> = Vec::new();
    let owned: BTreeMap<usize, &Record> = result
        .records
        .iter()
        .filter(|(n, record)| quote_hits(record, &words[*n - 1]).iter().any(|hit| *hit))
        .map(|(n, record)| (*n, record))
        .collect();
    for (&n, record) in &result.records {
        match verdict(record, n - 1, &words, &owned) {
            Verdict::Own => continue,
            Verdict::Merged(chunks) => {
                trimmed.push((n, chunks));
                continue;
            }
            Verdict::Swallowed => {
                mismatched.push(n);
                continue;
            }
            Verdict::Drifted => {}
        }
        mismatched.push(n);
        let homes: Vec<usize> = (1..=ids.len())
            .filter(|&m| m != n && quotes_all_hit(record, &words[m - 1]))
            .collect();
        if let [home] = homes.as_slice() {
            moved.push((n, *home, record.clone()));
        }
    }
    // A chunk that repeats a neighbour's line is dropped; the rest of the
    // line is that sentence's translation.
    for (n, chunks) in trimmed {
        if let Some(record) = result.records.get_mut(&n) {
            let mut index = 0;
            record.chunks.retain(|_| {
                let keep = !chunks.contains(&index);
                index += 1;
                keep
            });
            // The joint space that led into a dropped chunk must not survive
            // as a trailing space; re-tidy the shortened line.
            tidy_joints(record, spaced_target);
            result.issues.push((n, Issue::LineMismatch));
        }
    }
    // A home is taken when it already has a line of its own that was not
    // itself mismatched, was rejected for another reason (duplicate, syntax),
    // is frozen, or is claimed by more than one drifted line.
    let mut taken: BTreeSet<usize> = rejected.clone();
    taken.extend(
        result
            .records
            .keys()
            .copied()
            .filter(|n| !mismatched.contains(n)),
    );
    let mut claimed = BTreeSet::new();
    for (_, home, _) in &moved {
        if !claimed.insert(*home) {
            taken.insert(*home);
        }
    }
    for n in &mismatched {
        result.records.remove(n);
        rejected.insert(*n);
        result.issues.push((*n, Issue::LineMismatch));
        result
            .translation
            .diagnostics
            .push_problem(Problem::sentence(
                ProblemCode::MissingId,
                ids[n - 1],
                "numbered line quotes another sentence (line mismatch)",
            ));
    }
    for (_, home, record) in moved {
        if taken.contains(&home) || !page.sentence(ids[home - 1]).expect("page id").editable {
            continue;
        }
        rejected.remove(&home);
        result
            .records
            .insert(home, reattributed(&record, home, &words[home - 1]));
        result.issues.push((home, Issue::LineReattributed));
    }
    for (index, id) in ids.iter().enumerate() {
        let n = index + 1;
        let sentence = page.sentence(id).expect("page id");
        if !sentence.editable {
            if rejected.contains(&n) {
                result.records.remove(&n);
                continue;
            }
            if let Some(record) = result.records.get(&n) {
                let (frozen, issues) = lines::freeze(
                    record,
                    sentence.existing_translation.as_deref().unwrap_or(""),
                );
                result
                    .issues
                    .extend(issues.into_iter().map(|issue| (n, issue)));
                result.records.insert(n, frozen);
            }
            continue;
        }
        if rejected.contains(&n) || !result.records.contains_key(&n) {
            result.records.remove(&n);
            result.translation.retry_ids.push((*id).to_owned());
            if !mismatched.contains(&n) {
                result
                    .translation
                    .diagnostics
                    .push_problem(Problem::sentence(
                        ProblemCode::MissingId,
                        *id,
                        "no valid numbered translation",
                    ));
            }
        } else {
            let text = result.records[&n].text();
            result
                .translation
                .translations
                .insert((*id).to_owned(), text);
        }
    }
    validate_translation_quality(page, &mut result.translation);
    result.records.retain(|n, _| {
        let id = ids[*n - 1];
        !page.sentence(id).expect("page id").editable
            || result.translation.translations.contains_key(id)
    });
    for (n, record) in &result.records {
        let id = ids[*n - 1];
        let sentence = page.sentence(id).expect("page id");
        if !sentence.editable {
            continue;
        }
        result.translation.lines.insert(
            id.to_owned(),
            TranslateLinesDraft {
                record: record.clone(),
                pieces: pieces_with_params(page, sentence, params),
                source_words: source_words(sentence),
            },
        );
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::filepipe::{TranslateAlignmentInput, TranslateSection, TranslateSentence};

    fn zh_page(source: &str) -> TranslatePage {
        TranslatePage {
            source_lang: "en".into(),
            target_lang: "zh".into(),
            sections: vec![TranslateSection {
                id: "p1".into(),
                sentences: vec![TranslateSentence::new("a", source)],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    /// 块边界两侧的空白是传输噪声：宽字符之间去掉，拉丁词之间收成一个空格，
    /// 只有空白的块变成无文块（并入前一块）。
    #[test]
    fn joint_whitespace_is_tidied_by_script() {
        let p = zh_page("So the history of modern AI cannot exist without open ecosystems.");
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |So..AI|所以，现代 AI 的历史 |cannot..ecosystems|不可能离开开放生态而存在。",
        );
        assert_eq!(
            result.translation.translations.get("a").map(String::as_str),
            Some("所以，现代 AI 的历史不可能离开开放生态而存在。"),
            "{:?} {:?}",
            result.translation.diagnostics,
            result.issues
        );
        let mut latin =
            zh_page("So the history of modern AI cannot exist without open ecosystems.");
        latin.target_lang = "es".into();
        let latin_input = render(&latin);
        let result = parse(
            &latin,
            &latin_input,
            "1 |So..AI|La historia de la IA moderna |cannot..ecosystems|no puede existir sin ecosistemas abiertos.",
        );
        assert_eq!(
            result.translation.translations["a"],
            "La historia de la IA moderna no puede existir sin ecosistemas abiertos."
        );
        let result = parse(
            &p,
            &input,
            "1 |So..AI|所以，现代 AI 的历史|cannot..without| |open ecosystems|不可能离开开放生态而存在。 ",
        );
        assert_eq!(
            result.translation.translations["a"],
            "所以，现代 AI 的历史不可能离开开放生态而存在。"
        );
        let record = &result.records[&1];
        assert_eq!(record.chunks.len(), 3);
        assert!(record.chunks[1].text.is_empty(), "{record:?}");
    }

    /// 韩文目标按空格分词：块缝上模型写的空格留着，模型没写空格的块缝按整行
    /// 的写法补回（和拉丁文字目标同一条规则），不会把两个어절粘在一起。
    #[test]
    fn korean_targets_keep_the_space_at_joints() {
        let mut p = zh_page("So the history of modern AI cannot exist without open ecosystems.");
        p.target_lang = "ko".into();
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |So..AI|그래서 현대 AI의 역사는 |cannot..ecosystems|열린 생태계 없이는 존재할 수 없습니다.",
        );
        assert_eq!(
            result.translation.translations.get("a").map(String::as_str),
            Some("그래서 현대 AI의 역사는 열린 생태계 없이는 존재할 수 없습니다."),
            "{:?} {:?}",
            result.translation.diagnostics,
            result.issues
        );
        let record = &result.records[&1];
        let pieces: Vec<&str> = record
            .chunks
            .iter()
            .map(|chunk| chunk.text.as_str())
            .collect();
        assert_eq!(
            join_word_texts(pieces.iter().copied()),
            "그래서 현대 AI의 역사는 열린 생태계 없이는 존재할 수 없습니다."
        );
    }

    /// 切分提示的打分：韩文只有在 0.5 之前逐音节的文稿里（词带「贴前」标记）
    /// 才按「一字一词」算；按어절成词的韩文和别的带空格的文字一样打分。
    #[test]
    fn korean_piece_boundaries_score_per_character_only_for_legacy_words() {
        let words: Vec<String> = "저는 어제 서울에서 친구를 만났고, 오늘은 집에서 쉬고 있습니다"
            .split(' ')
            .map(str::to_owned)
            .collect();
        assert_eq!(piece_boundaries(&words, 2, "ko"), vec![5]);
        assert_eq!(
            piece_boundaries(&words, 2, "ko"),
            piece_boundaries_over(&words, 2, "ko", false, &BTreeSet::new())
        );
    }

    /// 词间不留空格的非 CJK 目标（泰文）：块缝不补空格；模型自己写的空格（短语
    /// 停顿）留一个；夹在里面的两个拉丁词相遇时空格照留。
    #[test]
    fn unspaced_script_targets_get_no_space_added_at_joints() {
        let mut p = zh_page("So the history of modern AI cannot exist without open ecosystems.");
        p.target_lang = "th".into();
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |So..AI|ประวัติศาสตร์ของ AI สมัยใหม่|cannot..ecosystems|ไม่อาจดำรงอยู่ได้หากไม่มีระบบนิเวศแบบเปิด",
        );
        assert_eq!(
            result.translation.translations.get("a").map(String::as_str),
            Some("ประวัติศาสตร์ของ AI สมัยใหม่ไม่อาจดำรงอยู่ได้หากไม่มีระบบนิเวศแบบเปิด"),
            "{:?} {:?}",
            result.translation.diagnostics,
            result.issues
        );
        let result = parse(
            &p,
            &input,
            "1 |So..AI|ประวัติศาสตร์ของ AI สมัยใหม่ |cannot..ecosystems| ไม่อาจดำรงอยู่ได้หากไม่มีระบบนิเวศแบบเปิด",
        );
        assert_eq!(
            result.translation.translations["a"],
            "ประวัติศาสตร์ของ AI สมัยใหม่ ไม่อาจดำรงอยู่ได้หากไม่มีระบบนิเวศแบบเปิด"
        );
        let result = parse(
            &p,
            &input,
            "1 |So..AI|ประวัติศาสตร์ของ Open|cannot..ecosystems|AI ไม่อาจดำรงอยู่ได้หากไม่มีระบบนิเวศแบบเปิด",
        );
        assert_eq!(
            result.translation.translations["a"],
            "ประวัติศาสตร์ของ Open AI ไม่อาจดำรงอยู่ได้หากไม่มีระบบนิเวศแบบเปิด"
        );
    }

    /// 宽字符目标里两个拉丁词隔着块缝相遇时空格要留住（`University|of` 不能拼成
    /// `Universityof`）；只有标点的块并进前一块，前一块已经以标点结尾时丢掉
    /// （`，` + `，` 不得印成 `，，`）。
    #[test]
    fn latin_words_keep_their_space_and_punctuation_chunks_fold_back() {
        let p = zh_page("Geoffrey Hinton's University of Toronto team entered with AlexNet.");
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |Geoffrey..University|杰弗里·辛顿的 University|of..AlexNet|of Toronto 团队带着 AlexNet 参赛。",
        );
        assert_eq!(
            result.translation.translations.get("a").map(String::as_str),
            Some("杰弗里·辛顿的 University of Toronto 团队带着 AlexNet 参赛。"),
            "{:?} {:?}",
            result.translation.diagnostics,
            result.issues
        );
        let p = zh_page("We have one fewer chair than children, so someone loses.");
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |We..chair|我们比孩子少一把椅子，|than..children|，|so..loses|所以有人会输。",
        );
        assert_eq!(
            result.translation.translations.get("a").map(String::as_str),
            Some("我们比孩子少一把椅子，所以有人会输。"),
            "{:?}",
            result.translation.diagnostics
        );
        let record = &result.records[&1];
        assert!(record.chunks[1].text.is_empty(), "{record:?}");
        let result = parse(
            &p,
            &input,
            "1 |We..chair|我们比孩子少一把椅子|than..children|，|so..loses|所以有人会输。",
        );
        assert_eq!(
            result.translation.translations.get("a").map(String::as_str),
            Some("我们比孩子少一把椅子，所以有人会输。")
        );
        assert_eq!(result.records[&1].chunks[0].text, "我们比孩子少一把椅子，");
    }

    /// 页尾那句后面跟着 `# after` 上下文行时，模型偶尔把上下文也译进最后一行；
    /// 引用只落在上下文里的块丢掉、其余照收，只剩上下文的行按缺译处理。
    #[test]
    fn chunks_quoting_the_context_line_are_dropped() {
        let mut p = zh_page("Hey, did you see it coming?");
        p.context_after =
            Some("You were at the start of it, you were around when it launched.".into());
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |Hey..coming|嘿，你当时看出来了吗？|You..launched|你当时就在起点上，它发布时你在场。",
        );
        assert_eq!(
            result.translation.translations.get("a").map(String::as_str),
            Some("嘿，你当时看出来了吗？"),
            "{:?} {:?}",
            result.translation.diagnostics,
            result.issues
        );
        assert!(
            result
                .translation
                .diagnostics
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::ContentIgnored),
            "{:?}",
            result.translation.diagnostics
        );
        let result = parse(
            &p,
            &input,
            "1 |You..launched|你当时就在起点上，它发布时你在场。",
        );
        assert!(
            !result.translation.translations.contains_key("a"),
            "{:?}",
            result.translation.translations
        );
        assert_eq!(result.translation.retry_ids, vec!["a".to_owned()]);
    }

    /// 空格文字的目标语里，模型把 `|` 两侧的空格全省掉时要补回来（标点后一律补，
    /// 词与词之间按整行惯例补）；整行别处有空格而某一处故意黏着的（片标切进了
    /// 一个目标词）保持黏着；宽字符目标不受影响。
    #[test]
    fn glued_joints_get_their_space_back_by_line_convention() {
        let mut p =
            zh_page("我现在就执行力很弱，我觉得你执行力非常强，在摆烂和躯体化焦虑之间横跳。");
        p.source_lang = "zh".into();
        p.target_lang = "en".into();
        let input = render(&p);
        // No joint carries a space: the model dropped them all.
        let result = parse(
            &p,
            &input,
            "1 |我现在就执行力很弱，|Right now my execution ability is weak,|我觉得你执行力非常强，|I think yours is very strong,|在摆烂和躯体化焦虑之间横跳。|I swing between giving up and anxiety.",
        );
        assert!(
            result.translation.translations.contains_key("a"),
            "{:?} {:?}",
            result.translation.diagnostics,
            result.issues
        );
        assert_eq!(
            result.translation.translations["a"],
            "Right now my execution ability is weak, I think yours is very strong, I swing between giving up and anxiety.",
            "{:?}",
            result.translation.diagnostics
        );
        // Other joints are spaced: the glued `somat|ized` is a split word and
        // stays whole; the glued `weak,|I` still gets its space.
        let result = parse(
            &p,
            &input,
            "1 |我现在就执行力很弱，|Right now my execution ability is weak,|我觉得你执行力非常强，|I think yours is very strong, |在摆烂和躯|I swing between somat|体化焦虑之间横跳。|ized anxiety.",
        );
        assert_eq!(
            result.translation.translations["a"],
            "Right now my execution ability is weak, I think yours is very strong, I swing between somatized anxiety.",
            "{:?}",
            result.translation.diagnostics
        );
        // Brackets and quotes hug their content whatever the convention.
        let result = parse(
            &p,
            &input,
            "1 |我现在就执行力很弱，|He said (|我觉得你执行力非常强，|quietly|在摆烂和躯体化焦虑之间横跳。|) that it works.",
        );
        assert_eq!(
            result.translation.translations["a"],
            "He said (quietly) that it works."
        );
        // A wide-script target never gets spaces added at a joint.
        let zh = zh_page("So the history of modern AI cannot exist without open ecosystems.");
        let zh_input = render(&zh);
        let result = parse(
            &zh,
            &zh_input,
            "1 |So..AI|所以，现代 AI 的历史|cannot..ecosystems|不可能离开开放生态而存在。",
        );
        assert_eq!(
            result.translation.translations["a"],
            "所以，现代 AI 的历史不可能离开开放生态而存在。"
        );
    }

    /// 为凑块数把同一段译文写两遍的行拒收重问，不让重复文字进字幕。
    #[test]
    fn a_chunk_that_repeats_its_neighbour_rejects_the_line() {
        let p = zh_page(
            "And that's right now predominantly through US and Europe models, but they're also evaluating the Chinese models.",
        );
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |And..US|而这目前主要是通过美国和欧洲的模型，|and..Europe|美国和欧洲模型，|but..models|但他们也在评估中国模型。",
        );
        assert!(!result.translation.translations.contains_key("a"));
        assert_eq!(result.translation.retry_ids, vec!["a".to_owned()]);
        assert!(
            result
                .translation
                .diagnostics
                .has_code(ProblemCode::TranslationChunkRepeat)
        );
        // 正常的相邻块（共用少数字）不受影响。
        let result = parse(
            &p,
            &input,
            "1 |And..US|而这目前主要是通过美国和欧洲的模型，|but..models|但他们也在评估中国模型。",
        );
        assert!(result.translation.translations.contains_key("a"));
    }

    /// 重复护栏按阅读单位比（中日韩一字一单位、其余一词一单位），且放过源文
    /// 自己就重复的句子：一个共用的长专名、一句强调、一句否定对比都不是凑数。
    #[test]
    fn repeat_guard_counts_units_and_spares_source_repetition() {
        let p = zh_page("He still uses Salesforce, but he uses it together with Claude.");
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |He..Salesforce|他仍然用 Salesforce，|but..Claude|但他是结合 Claude 来用 Salesforce。",
        );
        assert!(
            result.translation.translations.contains_key("a"),
            "{:?}",
            result.translation.diagnostics
        );
        let p = zh_page("This is critical, critical for the launch.");
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |This is|这是|critical|至关重要的，|critical|至关重要的，|for..launch|对发布来说。",
        );
        assert!(
            result.translation.translations.contains_key("a"),
            "{:?}",
            result.translation.diagnostics
        );
        // The repeated word sits on the seam of two longer quotes (AMD
        // `s-g40.4`): the spans as wholes share one unit of three, but the
        // word that closes the first reopens the second.
        let p = zh_page("which is critical, critical for today's AI development.");
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |which..critical|这至关重要，|critical..development|对当今的 AI 发展至关重要。",
        );
        assert!(
            result.translation.translations.contains_key("a"),
            "{:?}",
            result.translation.diagnostics
        );
        // The seam rule is a proxy (Codex probe, round 7): a shared seam word
        // alone does not license two chunks that restate each other — the
        // later span's own content must show in its translation.
        for (source, output) in [
            (
                "The committee rejected it; it was very expensive.",
                "1 |The committee rejected it;|委员会否决了它，|it was very expensive.|委员会否决了它。",
            ),
            (
                "They visited the museum and discussed the painting.",
                "1 |They..the|他们参观了博物馆，|the..painting|他们参观了博物馆。",
            ),
        ] {
            let p = zh_page(source);
            let input = render(&p);
            let result = parse(&p, &input, output);
            assert!(
                !result.translation.translations.contains_key("a")
                    && result
                        .translation
                        .diagnostics
                        .has_code(ProblemCode::TranslationChunkRepeat),
                "{source}: {:?}",
                result.translation.diagnostics
            );
        }
        for (source, output) in [
            (
                "She thanked him and he thanked her.",
                "1 |She..him|她感谢了他，|he..her|他感谢了她。",
            ),
            (
                "This is critical, critical for the whole project.",
                "1 |This..critical|这至关重要，|critical..project|对整个项目至关重要。",
            ),
        ] {
            let p = zh_page(source);
            let input = render(&p);
            let result = parse(&p, &input, output);
            assert!(
                result.translation.translations.contains_key("a"),
                "{source}: {:?}",
                result.translation.diagnostics
            );
        }
        let mut p = zh_page("They can approve the plan, but they cannot approve the plan today.");
        p.target_lang = "es".into();
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |They..plan|Pueden aprobar el plan, |but..today|pero no pueden aprobar el plan hoy.",
        );
        assert!(
            result.translation.translations.contains_key("a"),
            "{:?}",
            result.translation.diagnostics
        );
        // A repeated phrase inside longer clauses (`caring about … and caring
        // about …`) is a source repetition too, even though the two spans as
        // wholes differ.
        let p = zh_page(
            "I think we've gone from caring about the transcript so much and caring about each individual tool call.",
        );
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |I..from|我觉得我们已经从|caring..transcript|那么在意对话记录|so..about|、那么在意|each..call|每一次工具调用。",
        );
        assert!(
            result.translation.translations.contains_key("a"),
            "{:?}",
            result.translation.diagnostics
        );
        // Padding proper: the source says it once, the answer twice.
        let p = zh_page("They can approve the plan today.");
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |They..plan|他们可以批准这个计划，|today|可以批准这个计划，今天。",
        );
        assert!(
            result
                .translation
                .diagnostics
                .has_code(ProblemCode::TranslationChunkRepeat),
            "{:?}",
            result.translation.diagnostics
        );
        // Padding on a quote seam (open-models `s-g51.0`): the source names
        // `US and Europe models` once, the answer renders it in two adjacent
        // chunks. The seam word `and` is shared by the two quotes only in the
        // sense that one closes on `US` and the next opens on `and`; that is
        // not a source repetition, so the gate must still reject.
        let p = zh_page(
            "And that's right now predominantly through US and Europe models, but they're also evaluating the Chinese models.",
        );
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |And..US|而这目前主要是通过美国和欧洲的模型，|and..Europe|美国和欧洲模型，|but..also|但他们也在|evaluating..models|评估中国模型。",
        );
        assert!(
            result
                .translation
                .diagnostics
                .has_code(ProblemCode::TranslationChunkRepeat),
            "{:?}",
            result.translation.diagnostics
        );
    }

    /// 分片符写在了下一个标记的开口处（`译文 ¦ LEFT..RIGHT|译文`）：按字面读，
    /// 引文会落进上一块的译文、下一块的译文被当成标记。能在本句原文里找到的
    /// 引文才算，分片符改读成 `|`；正文里的分片符（切点提示）不受影响。
    #[test]
    fn piece_mark_written_as_a_marker_opener_is_read_as_a_bar() {
        let mut p = zh_page(
            "But AI is causing many of the traditional roles in software development to blur together.",
        );
        p.target_lang = "ko".into();
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 |But..many|하지만 AI는 ¦ of..in|소프트웨어 개발의 ¦ traditional..together|전통적인 여러 역할을 뒤섞고 있습니다.",
        );
        assert_eq!(
            result.translation.translations["a"],
            "하지만 AI는 소프트웨어 개발의 전통적인 여러 역할을 뒤섞고 있습니다.",
            "{:?}",
            result.translation.diagnostics
        );
        let record = &result.translation.lines["a"].record;
        assert_eq!(record.chunks.len(), 3);
        assert!(quotes_all_hit(
            record,
            &source_tokens(&p.sections[0].sentences[0])
        ));
        assert!(
            result
                .translation
                .diagnostics
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::MarkerResidue),
            "{:?}",
            result.translation.diagnostics
        );
        // 只错一处时原样读是语法错（竖线成单），改读后整行可用。
        let result = parse(
            &p,
            &input,
            "1 |But..many|하지만 AI는 ¦ of..together|소프트웨어 개발의 전통적인 여러 역할을 뒤섞고 있습니다.",
        );
        assert_eq!(
            result.translation.translations["a"],
            "하지만 AI는 소프트웨어 개발의 전통적인 여러 역할을 뒤섞고 있습니다."
        );
        // 分片符后面不是本句的引文：仍是正文里的切点提示。
        let result = parse(
            &p,
            &input,
            "1 |But..many|하지만 AI는 ¦ 소프트웨어 개발의 |of..together|전통적인 여러 역할을 뒤섞고 있습니다.",
        );
        assert_eq!(
            result.translation.translations["a"],
            "하지만 AI는 소프트웨어 개발의 전통적인 여러 역할을 뒤섞고 있습니다."
        );
        assert_eq!(result.translation.lines["a"].record.chunks.len(), 2);
    }

    /// 回答里出现的未转义分片符是回显，去掉并记诊断；`\¦` 是正文，保留。
    #[test]
    fn piece_marks_echoed_are_removed_with_a_warning_and_literals_survive() {
        let mut p = zh_page("Use the delimiter.");
        p.target_lang = "es".into();
        let input = render(&p);
        let result = parse(&p, &input, "1 |Use..delimiter|Usa el delimitador \\¦.");
        assert_eq!(
            result.translation.translations["a"], "Usa el delimitador ¦.",
            "{:?}",
            result.translation.diagnostics
        );
        assert!(result.translation.diagnostics.warnings.is_empty());
        let result = parse(&p, &input, "1 |Use ¦ the..delimiter|Usa el delimitador.");
        assert_eq!(result.translation.translations["a"], "Usa el delimitador.");
        assert!(
            result
                .translation
                .diagnostics
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::MarkerResidue),
            "{:?}",
            result.translation.diagnostics
        );
        // Echoed into the text (brockman, 2 of 8 pages): the whitespace around
        // the mark goes with it between wide characters — no double space in
        // the translation — and the positions stay on the record as cut hints.
        let p = zh_page(
            "I think there's going to be more room than ever for software that creates value in unique ways.",
        );
        let input = render(&p);
        let result = parse(
            &p,
            &input,
            "1 ≥3 ¦ |I think..room|我认为，软件 ¦ 以独特方式创造价值 ¦ 的空间将比以往更大。",
        );
        assert_eq!(
            result.translation.translations["a"],
            "我认为，软件以独特方式创造价值的空间将比以往更大。",
            "{:?}",
            result.translation.diagnostics
        );
        assert_eq!(
            result.translation.lines["a"].record.chunks[0].marks,
            vec![5, 14]
        );
        assert_eq!(
            lines::cut_hints(&result.translation.lines["a"].record),
            vec![6, 15]
        );
        assert!(
            result
                .translation
                .diagnostics
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::MarkerResidue),
            "{:?}",
            result.translation.diagnostics
        );
    }

    /// 有长度预测（拉丁 → 中日韩）时，预计落在 fit 与 hard 之间的句子也请求
    /// 两块；只有预算时仍按 hard 判一行。
    #[test]
    fn predicted_over_fit_rows_are_asked_to_chunk() {
        let params = TransParams::for_lang("zh");
        assert!(params.fit < params.hard);
        // 50 个非空白字符 × 0.34 ≈ 17 单位：超 fit（16）不超 hard（20）。
        let mut sentence = TranslateSentence::new("a", &"abcde ".repeat(10));
        sentence.budget = Some(params.hard);
        assert_eq!(chunk_hint(&sentence, "en", "zh", &params), 2);
        // 40 字符 ≈ 14 单位：一行。
        let mut short = TranslateSentence::new("b", &"abcde ".repeat(8));
        short.budget = Some(params.hard);
        assert_eq!(chunk_hint(&short, "en", "zh", &params), 1);
        // 没有预测的语言对只看预算，预算不超 hard 就是一行。
        assert_eq!(chunk_hint(&sentence, "de", "es", &params), 1);
    }

    /// 源文按字母数取主导文字：数字、标点不算，夹一个外文词不改判；没有
    /// 字母或打平不判。
    #[test]
    fn the_dominant_script_counts_letters_only() {
        assert_eq!(
            dominant_script("รหัสF-07ปรากฏข้างคำว่า“ยืนยันแล้ว”แต่ยังไม่ได้ส่งพัสดุ"),
            Some(SourceScript::Thai)
        );
        assert_eq!(
            dominant_script("She said ขอบคุณ and left the room quietly."),
            Some(SourceScript::Latin)
        );
        assert_eq!(
            dominant_script("Größe und Gewicht"),
            Some(SourceScript::Latin)
        );
        assert_eq!(
            dominant_script("Я использую GPT каждый день"),
            Some(SourceScript::Other)
        );
        assert_eq!(dominant_script("120, 14:30 — 2.5"), None);
        assert_eq!(dominant_script("ab ขก"), None);
    }

    /// 只有量过的语言对有长度预测；泰文源只登记了英文目标（中文量过但会让
    /// 模型照抄原文，不登记），其余目标语、老挝 / 高棉 / 缅甸文源、中日韩源
    /// 都回到预算。
    #[test]
    fn only_measured_pairs_are_estimated() {
        let thai = "ลลิตาไม่ได้ยกเลิกการประชุมแต่เลื่อนไปเป็นวันพฤหัสบดีเวลา14:30น.";
        assert_eq!(thai.chars().count(), 63);
        assert_eq!(estimated_units(thai, "th", "en"), Some(82));
        assert_eq!(estimated_units(thai, "th", "zh-Hans"), None);
        assert_eq!(estimated_units(thai, "th", "de"), None);
        assert_eq!(estimated_units(thai, "th", "ja"), None);
        // A Thai source with a code in it is still Thai: into Chinese it gets
        // no estimate rather than the Latin 0.34.
        let code = "รหัสF-07ปรากฏข้างคำว่า“ยืนยันแล้ว”แต่ยังไม่ได้ส่งพัสดุ";
        assert_eq!(estimated_units(code, "th", "zh"), None);
        let chars = code.chars().count();
        assert_eq!(
            estimated_units(code, "th", "en"),
            Some((chars as f64 * 1.3).ceil() as usize)
        );
        assert_eq!(estimated_units("ສະບາຍດີ ທຸກຄົນ", "lo", "en"), None);
        // Latin into CJK is unchanged; a Cyrillic line quoting one Latin word
        // is not Latin any more.
        assert_eq!(
            estimated_units("abcde ".repeat(10).trim(), "en", "zh"),
            Some(17)
        );
        assert_eq!(
            estimated_units("Я использую GPT каждый день", "ru", "zh"),
            None
        );
        assert_eq!(estimated_units("我用 ChatGPT 写代码", "zh", "ja"), None);
    }

    /// 泰文源带预算翻成英文：首轮的 `≥k` 按预测长度要，不再按预算上限要
    /// （验收页 th-01：≥4 → ≥3）。翻成中文仍按预算（≥5）。
    #[test]
    fn a_thai_sentence_is_hinted_by_its_predicted_length() {
        let source = "ลลิตาไม่ได้ยกเลิกการประชุมแต่เลื่อนไปเป็นวันพฤหัสบดีเวลา14:30น.";
        let words = [
            "ลลิตา",
            "ไม่",
            "ได้",
            "ยก",
            "เลิก",
            "การ",
            "ประชุม",
            "แต่",
            "เลื่อน",
            "ไป",
            "เป็น",
            "วัน",
            "พฤหัสบดี",
            "เวลา",
            "14:30",
            "น.",
        ];
        let mut sentence = TranslateSentence::new("th-01", source);
        sentence.alignment = Some(TranslateAlignmentInput {
            source_words: words.iter().map(|w| w.to_string()).collect(),
            source_glue: Vec::new(),
            needs_split: true,
            groups: Vec::new(),
        });
        // Budgets of the acceptance probe (4.81 s × 21 / × 9).
        let en = TransParams::for_lang("en");
        sentence.budget = Some(101);
        assert_eq!(chunks_for_units(101, &en), 4);
        assert_eq!(chunk_hint(&sentence, "th", "en", &en), 3);
        let zh = TransParams::for_lang("zh");
        sentence.budget = Some(43);
        assert_eq!(chunks_for_units(43, &zh), 5);
        assert_eq!(chunk_hint(&sentence, "th", "zh-Hans", &zh), 5);
        // Other targets without a ratio keep the budget's hint too.
        let de = TransParams::for_lang("de");
        sentence.budget = Some(101);
        assert_eq!(chunk_hint(&sentence, "th", "de", &de), 4);
    }

    /// 带旧译文再问的可编辑句至少要两块，但一个词的句子切不开：上限 1 时
    /// 给 1，不因下限高于上限而崩溃（`clamp(2, 1)` 会 panic）。
    #[test]
    fn a_one_word_sentence_asked_again_is_hinted_one_chunk() {
        let params = TransParams::for_lang("en");
        let mut sentence = TranslateSentence::new("a", "ลลิตาไม่ได้ยกเลิกการประชุม");
        sentence.budget = Some(80);
        sentence.existing_translation = Some("Lalita did not cancel the meeting.".into());
        assert_eq!(chunk_hint(&sentence, "th", "en", &params), 1);
        let mut longer = TranslateSentence::new("b", "one two three four five six");
        longer.budget = Some(80);
        longer.existing_translation = Some("uno dos tres cuatro cinco seis".into());
        assert!(chunk_hint(&longer, "en", "es", &params) >= 2);
    }

    /// 无预算的页（实验页、没有时间的来源）里，带旧译文再问的句子也按旧译文
    /// 长度要块数；首轮与冻结句无预算仍是一块。
    #[test]
    fn a_sentence_asked_again_without_budget_is_sized_by_its_previous_text() {
        let params = TransParams::for_lang("en");
        let source =
            "Lea hat den Termin nicht abgesagt, sondern auf Donnerstag um 14:30 Uhr verschoben.";
        let previous =
            "Lea didn't cancel the appointment, but postponed it to Thursday at 2:30 p.m.";
        let mut sentence = TranslateSentence::new("a", source);
        assert_eq!(chunk_hint(&sentence, "de", "en", &params), 1);
        sentence.existing_translation = Some(previous.into());
        assert!(chunk_hint(&sentence, "de", "en", &params) >= 3);
        sentence.editable = false;
        assert_eq!(chunk_hint(&sentence, "de", "en", &params), 1);
    }

    fn thai_words() -> Vec<String> {
        // th-02 as the LSTM stores it: `อง|ศา` (degree), `หน้า|ต่าง` (window)
        // and `ทำ|ความ` are one word each in the dictionary.
        [
            "ถ้า",
            "อุณหภูมิ",
            "ลด",
            "ลง",
            "ต่ำ",
            "กว่า",
            "5",
            "อง",
            "ศา",
            "ให้",
            "ปิด",
            "หน้า",
            "ต่าง",
            "ก่อน",
            "เปิด",
            "เครื่อง",
            "ทำ",
            "ความ",
            "ร้อน",
        ]
        .map(String::from)
        .to_vec()
    }

    #[test]
    fn thai_boundaries_inside_a_dictionary_word_are_unsure() {
        let words = thai_words();
        let source = words.concat();
        assert_eq!(
            unsure_boundaries(&source, &words),
            BTreeSet::from([8, 12, 17])
        );
        // Spaced scripts and text that no longer matches its words: nothing.
        let latin: Vec<String> = "turn the light off".split(' ').map(String::from).collect();
        assert!(unsure_boundaries("turn the light off", &latin).is_empty());
        assert!(unsure_boundaries("something else", &words).is_empty());
    }

    /// 片标不落在括号、引号里侧：开引号紧贴后文（泰文、中文逐字时开引号挂
    /// 在前一个词尾）或独立成词（法文 `« mot »`）时，它后面那条缝不可信；
    /// 闭引号同理。德文 `„…“` 的 `“`、瑞典文 `”…”` 的 `”` 方向与英文相反，
    /// 隔着空格，照旧可信。
    #[test]
    fn pieces_never_open_just_inside_a_bracket_or_quote() {
        // th-05 as stored (2026-10-01 acceptance): the old mark came after
        // `ว่า“` and the answer joined to `the word “ confirmed”`.
        let words: Vec<String> = [
            "ร",
            "หัส",
            "F-07",
            "ปรากฏ",
            "ข้าง",
            "คำ",
            "ว่า“",
            "ยืนยัน",
            "แล้ว”",
            "แต่",
            "ยัง",
            "ไม่",
            "ได้",
            "ส่ง",
            "พัสดุ",
        ]
        .map(String::from)
        .to_vec();
        let source = "รหัสF-07ปรากฏข้างคำว่า“ยืนยันแล้ว”แต่ยังไม่ได้ส่งพัสดุ";
        let unsure = unsure_boundaries(source, &words);
        assert!(unsure.contains(&7), "{unsure:?}");
        let shown = with_pieces(
            source,
            &words,
            &piece_boundaries_over(&words, 3, "th", false, &unsure),
        )
        .unwrap();
        assert!(!shown.contains("“ ¦") && shown.contains("“ยืนยัน"), "{shown}");
        // Chinese per character: `说“ ¦ 已` and `画『 ¦ ハ` are out.
        let words: Vec<String> = ["他", "说“", "已", "经", "确", "认", "了”，", "但"]
            .map(String::from)
            .to_vec();
        let unsure = unsure_boundaries("他说“已经确认了”，但", &words);
        assert!(unsure.contains(&2) && !unsure.contains(&7), "{unsure:?}");
        let words: Vec<String> = ["映", "画『", "ハ", "リ"].map(String::from).to_vec();
        assert!(unsure_boundaries("映画『ハリ", &words).contains(&2));
        // Moved off the bracket, a mark must not leave a piece of
        // punctuation alone (`シャーロック ¦ ・ ¦ ホームズ`).
        let words: Vec<String> = ["ザ", "シ", "ャ", "・", "ホ", "ー", "ム"]
            .map(String::from)
            .to_vec();
        assert_eq!(
            piece_boundaries_over(&words, 3, "ja", true, &BTreeSet::from([2, 4])),
            vec![3, 5]
        );
        // A standalone French guillemet on either side.
        let words: Vec<String> = ["«", "Je", "confirme", "»", "mais"]
            .map(String::from)
            .to_vec();
        assert_eq!(
            unsure_boundaries("« Je confirme » mais", &words),
            BTreeSet::from([1, 3])
        );
        // Marks that point the other way in these languages stay sure.
        let words: Vec<String> = ["„bestätigt“", "aber", "noch"].map(String::from).to_vec();
        assert!(unsure_boundaries("„bestätigt“ aber noch", &words).is_empty());
        let words: Vec<String> = ["»Text«", "aber"].map(String::from).to_vec();
        assert!(unsure_boundaries("»Text« aber", &words).is_empty());
        let words: Vec<String> = ["sa", "”hej”", "och"].map(String::from).to_vec();
        assert!(unsure_boundaries("sa ”hej” och", &words).is_empty());
        let words: Vec<String> = ["He", "said", "(and", "I", "agree)", "that"]
            .map(String::from)
            .to_vec();
        assert!(unsure_boundaries("He said (and I agree) that", &words).is_empty());
    }

    /// 块缝在开引号之后、闭引号之前不留空格，模型写了也去掉（th-05 的
    /// `“ confirmed”`）；方向要靠上下文定：德文闭引号 `“`、瑞典文开引号
    /// `”`、法文 `« »` 里的空格照留。
    #[test]
    fn joints_just_inside_a_quote_lose_the_space() {
        let joined = |texts: &[&str], spaced_target: bool| -> String {
            let mut record = Record {
                n: 1,
                rewrite: false,
                chunks: texts
                    .iter()
                    .map(|text| Chunk {
                        reference: Reference::Empty,
                        text: (*text).to_owned(),
                        marks: Vec::new(),
                    })
                    .collect(),
            };
            tidy_joints(&mut record, spaced_target);
            record.text()
        };
        assert_eq!(
            joined(
                &[
                    "Code F-07 appears next to the word “ ",
                    "confirmed” ",
                    "but the parcel has not been sent."
                ],
                true
            ),
            "Code F-07 appears next to the word “confirmed” but the parcel has not been sent."
        );
        assert_eq!(
            joined(&["He said (", "and I agree ", ") that it works."], true),
            "He said (and I agree) that it works."
        );
        assert_eq!(
            joined(&["รหัส F-07 อยู่ข้างคำว่า“ ", "ยืนยันแล้ว”"], false),
            "รหัส F-07 อยู่ข้างคำว่า“ยืนยันแล้ว”"
        );
        // A tone mark is not a letter of its own: the quote still follows a
        // Thai word.
        assert_eq!(joined(&["ไม่“ ", "ยืนยัน”"], false), "ไม่“ยืนยัน”");
        assert_eq!(
            joined(&["Er schrieb „bestätigt“ ", "aber nichts weiter."], true),
            "Er schrieb „bestätigt“ aber nichts weiter."
        );
        assert_eq!(
            joined(&["Sie rief „Ja!“ ", "und ging."], true),
            "Sie rief „Ja!“ und ging."
        );
        assert_eq!(
            joined(
                &["Il a écrit « ", "confirmé » ", "mais rien d’autre."],
                true
            ),
            "Il a écrit « confirmé » mais rien d’autre."
        );
        assert_eq!(
            joined(&["Hon sa ", "”hej” och gick."], true),
            "Hon sa ”hej” och gick."
        );
    }

    /// 均匀切点落在词内时挪到最近的可信边界；整窗都不可信就往外找。
    #[test]
    fn thai_pieces_open_only_at_sure_boundaries() {
        let words = thai_words();
        let source = words.concat();
        let unsure = unsure_boundaries(&source, &words);
        // The old marks were [4, 8, 12, 16]: `5อง ¦ ศา`, `หน้า ¦ ต่าง`.
        assert_eq!(
            piece_boundaries_over(&words, 5, "th", false, &unsure),
            vec![4, 9, 13, 16]
        );
        let shown = with_pieces(&source, &words, &[4, 9, 13, 16]).unwrap();
        assert!(
            shown.contains("องศา ¦ ") && shown.contains("หน้าต่าง ¦ "),
            "{shown}"
        );
        // A window of only unsure boundaries takes the nearest sure one.
        let all_but_last: BTreeSet<usize> = (1..words.len() - 1).collect();
        assert_eq!(
            piece_boundaries_over(&words, 2, "th", false, &all_but_last),
            vec![words.len() - 1]
        );
        let none: BTreeSet<usize> = (1..words.len()).collect();
        assert!(piece_boundaries_over(&words, 3, "th", false, &none).is_empty());
    }

    /// 中文、日文一个字一个词：两个汉字 / 假名之间、词典分词器不断开的边界
    /// 不可信，片标挪到最近的词界（`视 ¦ 频` → `视频 ¦`）。夹着拉丁词或标点
    /// 的边界照旧可信。
    #[test]
    fn chinese_and_japanese_pieces_open_at_dictionary_word_boundaries() {
        let source = "今天这期视频我会分享最终筛选出来的";
        let words: Vec<String> = source.chars().map(String::from).collect();
        let unsure = unsure_boundaries(source, &words);
        assert_eq!(unsure, BTreeSet::from([1, 5, 9, 11, 13, 15]));
        // The even cuts all fall inside words without the gate.
        assert_eq!(
            piece_boundaries_over(&words, 4, "zh", true, &BTreeSet::new()),
            vec![5, 9, 13]
        );
        let gated = piece_boundaries_over(&words, 4, "zh", true, &unsure);
        assert_eq!(
            with_pieces(source, &words, &gated).unwrap(),
            "今天这期视频 ¦ 我会分享 ¦ 最终筛选 ¦ 出来的"
        );
        let mixed = "用这个Skill帮你，自动搜索";
        let words: Vec<String> = [
            "用", "这", "个", "Skill", "帮", "你，", "自", "动", "搜", "索",
        ]
        .map(String::from)
        .to_vec();
        let unsure = unsure_boundaries(mixed, &words);
        assert!(!unsure.contains(&3) && !unsure.contains(&4) && !unsure.contains(&6));
        // Japanese: kana and kanji are one family (`渋 ¦ 谷`, `通 ¦ 路` were
        // the cuts the model copied before the gate).
        let japanese = "青山方面から渋谷クロスタワー方面へ向かう通路をはじめ、";
        let words: Vec<String> = japanese.chars().map(String::from).collect();
        let ungated = piece_boundaries_over(&words, 4, "ja", true, &BTreeSet::new());
        assert_eq!(
            with_pieces(japanese, &words, &ungated).unwrap(),
            "青山方面から渋 ¦ 谷クロスタワー ¦ 方面へ向かう通 ¦ 路をはじめ、"
        );
        let unsure = unsure_boundaries(japanese, &words);
        let gated = piece_boundaries_over(&words, 4, "ja", true, &unsure);
        assert_eq!(
            with_pieces(japanese, &words, &gated).unwrap(),
            "青山方面から渋谷 ¦ クロスタワー ¦ 方面へ向かう通路 ¦ をはじめ、"
        );
    }

    /// 入库译文只在空白 / 标点 / 大小写上与回答不同时，块文本按入库译文重切。
    #[test]
    fn rebase_recuts_chunks_on_the_committed_text() {
        let record = lines::parse("1 |a..b|Hello , |c..d|world|e..f||g..h|!").unwrap();
        let rebased = rebase(&record, "Hello, World!").unwrap();
        assert_eq!(rebased.text(), "Hello, World!");
        assert_eq!(rebased.chunks[0].text, "Hello, ");
        assert_eq!(rebased.chunks[1].text, "World");
        assert!(rebased.chunks[2].text.is_empty());
        // 收尾的纯标点块没有有效字符可定位，只是把入库译文的尾巴接过去。
        assert_eq!(rebased.chunks[3].text, "!");
        assert_eq!(rebase(&record, "Goodbye, World!"), None);
    }

    fn page() -> TranslatePage {
        TranslatePage {
            source_lang: "en".into(),
            target_lang: "es".into(),
            sections: vec![TranslateSection {
                id: "p1".into(),
                sentences: vec![
                    TranslateSentence::new("a", "Good morning."),
                    TranslateSentence::new("b", "Good evening."),
                ],
                ..Default::default()
            }],
            ..Default::default()
        }
    }
    #[test]
    fn duplicates_and_broken_records_only_reject_their_sentence() {
        let p = page();
        let input = render(&p);
        for response in [
            "1 Buenos días.\n2 Buenas noches.\n1 Otro.",
            "1 |bad..|texto\n2 Buenas noches.",
            "1~ cambio\n2 Buenas noches.",
        ] {
            let result = parse(&p, &input, response);
            assert!(!result.translation.page_rejected);
            assert_eq!(result.translation.retry_ids, vec!["a"]);
            assert_eq!(result.translation.translations["b"], "Buenas noches.");
        }
        assert!(parse(&p, &input, "99 Otro.").translation.page_rejected);
    }
    #[test]
    fn same_content_validator_rejects_placeholder_and_source_copy() {
        let p = page();
        let input = render(&p);
        let result = parse(&p, &input, "1 TODO\n2 Good evening.");
        assert!(result.translation.translations.is_empty());
        assert!(result.records.is_empty());
        assert_eq!(result.translation.retry_ids.len(), 2);
    }

    /// 模型把标记写进了译文位置（多语言复验的 es-06 原行）：第二块的正文是
    /// 本句的一条 `LEFT..RIGHT` 引用，第一块的正文是源文的后半句。整行拒收
    /// 重问，不能拼成 `llegó diez minutos después de él. llegó..él` 收下。
    /// 去掉那条引用之后剩下的残句照抄由内容门拦住；正常译文不受影响。
    #[test]
    fn a_marker_in_the_text_slot_rejects_the_line() {
        let p = TranslatePage {
            source_lang: "es".into(),
            target_lang: "en".into(),
            sections: vec![TranslateSection {
                id: "p1".into(),
                sentences: vec![TranslateSentence::new(
                    "a",
                    "Aunque Inés salió antes que Mateo, llegó diez minutos después de él.",
                )],
                ..Default::default()
            }],
            ..Default::default()
        };
        let input = render(&p);
        let swapped = parse(
            &p,
            &input,
            "1 |Aunque..Mateo|llegó diez minutos después de él.|Aunque Inés salió antes que Mateo,|llegó..él|",
        );
        assert!(swapped.translation.translations.is_empty());
        assert!(swapped.records.is_empty());
        assert_eq!(swapped.translation.retry_ids, ["a"]);
        assert!(
            swapped
                .translation
                .diagnostics
                .has_code(ProblemCode::TranslationSourceCopy),
            "{:?}",
            swapped.translation.diagnostics
        );
        let fragment = parse(
            &p,
            &input,
            "1 |Aunque..Mateo|llegó diez minutos después de él.",
        );
        assert!(fragment.translation.translations.is_empty());
        assert!(
            fragment
                .translation
                .diagnostics
                .has_code(ProblemCode::TranslationSourceCopy)
        );
        let translated = parse(
            &p,
            &input,
            "1 |Aunque..Mateo|Although Inés left before Mateo, |llegó..él|she arrived ten minutes after him.",
        );
        assert_eq!(
            translated.translation.translations["a"],
            "Although Inés left before Mateo, she arrived ten minutes after him.",
            "{:?}",
            translated.translation.diagnostics
        );
        // 译文里的两个点不是引用：两端在本句源文里都找不到。
        let dotted = parse(
            &p,
            &input,
            "1 |Aunque..Mateo|Although Inés left before Mateo.. |llegó..él|she arrived ten minutes after him.",
        );
        assert!(dotted.translation.translations.contains_key("a"));
    }

    #[test]
    fn frozen_text_survives_changed_echo_and_duplicates_discard_evidence() {
        let mut p = page();
        p.sections[0].sentences[0].editable = false;
        p.sections[0].sentences[0].existing_translation = Some("No cambies nada.".into());
        let input = render(&p);
        let result = parse(&p, &input, "1 Cambia todo.\n2 Buenas noches.");
        assert_eq!(result.records[&1].text(), "No cambies nada.");
        assert!(result.issues.contains(&(1, Issue::FrozenCutAmbiguous)));
        assert!(!result.translation.translations.contains_key("a"));
        let duplicate = parse(&p, &input, "1 No cambies nada.\n1 Otro.\n2 Buenas noches.");
        assert!(!duplicate.records.contains_key(&1));
        assert_eq!(duplicate.translation.translations["b"], "Buenas noches.");
    }

    fn drift_page() -> TranslatePage {
        TranslatePage {
            source_lang: "en".into(),
            target_lang: "es".into(),
            sections: vec![TranslateSection {
                id: "p1".into(),
                sentences: vec![
                    TranslateSentence::new("a", "We ship on Monday."),
                    TranslateSentence::new("b", "Or maybe Tuesday."),
                    TranslateSentence::new("c", "The demo runs first."),
                    TranslateSentence::new("d", "Then questions."),
                ],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    /// The model merged sentences 1 and 2 into its line 1 and then counted on:
    /// its lines 2 and 3 are really sentences 3 and 4. The drifted lines must
    /// not be accepted under their numbers; they may be accepted where their
    /// quotes point, and the merged sentence goes to the retry list.
    #[test]
    fn drifted_lines_are_rejected_under_their_number_and_reattributed_by_quotes() {
        let p = drift_page();
        let input = render(&p);
        let response = "1 |We..Monday|Enviamos el lunes, |Or..Tuesday|o quizá el martes.\n2 |The..first|La demo va primero.\n3 |Then questions|Luego preguntas.";
        let result = parse(&p, &input, &response);
        // The merged line is rejected for both sentences it covers.
        assert_eq!(result.translation.retry_ids, vec!["a", "b"]);
        assert!(result.issues.contains(&(1, Issue::LineMismatch)));
        assert!(result.issues.contains(&(2, Issue::LineMismatch)));
        assert!(result.issues.contains(&(3, Issue::LineMismatch)));
        assert!(result.issues.contains(&(3, Issue::LineReattributed)));
        assert!(result.issues.contains(&(4, Issue::LineReattributed)));
        assert_eq!(result.translation.translations["c"], "La demo va primero.");
        assert_eq!(result.translation.translations["d"], "Luego preguntas.");
        assert!(!result.translation.translations.contains_key("b"));
        assert!(!result.translation.translations.contains_key("a"));
        // A quote that occurs nowhere is a paraphrase, not evidence of drift.
        let response = "1 |We..Monday|Enviamos el lunes.\n2 |Or..Tuesday|O el martes.\n3 |The..first|La demo va primero.\n4 |Then..questions|Luego |preguntas ya|preguntas.";
        let result = parse(&p, &input, &response);
        assert!(
            result.translation.retry_ids.is_empty(),
            "{:?}",
            result.issues
        );
    }

    /// The shape a 34-minute lecture came back in: the model merged sentences
    /// 1 and 2 under number 1, then opened every later line with text-less
    /// echoes of its own sentence's markers and wrote the NEXT sentence's
    /// translation after them. The echoes are no evidence of ownership: the
    /// textual chunks decide, so the merged line is retried and the shifted
    /// lines move to the sentences they quote, echoes dropped.
    #[test]
    fn echoed_markers_do_not_own_a_line_and_shifted_lines_move_on() {
        let p = TranslatePage {
            source_lang: "en".into(),
            target_lang: "es".into(),
            sections: vec![TranslateSection {
                id: "p1".into(),
                sentences: vec![
                    TranslateSentence::new("a", "Personally, I would have loved as an investor."),
                    TranslateSentence::new(
                        "b",
                        "I would have loved for it to head towards utility.",
                    ),
                    TranslateSentence::new("c", "One of the biggest questions we ask is this."),
                    TranslateSentence::new("d", "Work that everybody does."),
                    TranslateSentence::new("e", "You have to go ask."),
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        let input = render(&p);
        let response = "1 |Personally..loved|Personalmente me habría encantado |as..investor|como inversor |I..for|que fuera |it..utility|hacia la utilidad.\n\
2 |I..for| |it..utility| |One..questions|Una de las grandes preguntas |we..this|que hacemos es esta.\n\
3 |One..questions| |we..this| |Work..does|El trabajo que hace todo el mundo.\n\
4 |Work..does| |You..ask|Tienes que ir a preguntar.";
        let result = parse(&p, &input, response);
        assert_eq!(
            result.translation.retry_ids,
            vec!["a", "b"],
            "{:?}",
            result.issues
        );
        assert_eq!(
            result.translation.translations["c"],
            "Una de las grandes preguntas que hacemos es esta."
        );
        assert_eq!(
            result.translation.translations["d"],
            "El trabajo que hace todo el mundo."
        );
        assert_eq!(
            result.translation.translations["e"],
            "Tienes que ir a preguntar."
        );
        assert!(result.issues.contains(&(3, Issue::LineReattributed)));
        assert!(result.issues.contains(&(5, Issue::LineReattributed)));
        // The echoes quoting sentence 2 left with the move; the record for
        // sentence 3 carries only its own chunks.
        assert!(
            result.records[&3]
                .chunks
                .iter()
                .all(|chunk| !chunk.text.is_empty()),
            "{:?}",
            result.records[&3]
        );
        // A text-less marker that does quote the sentence it lands in stays.
        let response = "1 |Personally..loved|Personalmente me habría encantado |as..investor|como inversor.\n\
2 |I..for|Me habría encantado |it..utility|que fuera hacia la utilidad.\n\
3 |One..questions|Una de las grandes preguntas |we..this|que hacemos es esta.\n\
4 |Work..does|El trabajo que hace todo el mundo.\n\
5 |You..ask|Tienes que ir a preguntar. |to go|";
        let result = parse(&p, &input, response);
        assert!(
            result.translation.retry_ids.is_empty(),
            "{:?}",
            result.issues
        );
        assert_eq!(result.records[&5].chunks.len(), 2);
    }

    /// A line that repeats its neighbour's translation under its own number
    /// keeps its own chunks; a slipped quote alone changes nothing.
    #[test]
    fn repeated_neighbour_chunks_are_trimmed_and_slips_are_kept() {
        let p = drift_page();
        let input = render(&p);
        let response = "1 |We..Monday|Enviamos el lunes.|Or..Tuesday|O el martes.\n2 |Or..Tuesday|O el martes.\n3 |The..first|La demo va primero.\n4 |Then questions|Luego preguntas.";
        let result = parse(&p, &input, &response);
        assert!(
            result.translation.retry_ids.is_empty(),
            "{:?}",
            result.issues
        );
        assert_eq!(result.translation.translations["a"], "Enviamos el lunes.");
        assert_eq!(result.translation.translations["b"], "O el martes.");
        assert!(result.issues.contains(&(1, Issue::LineMismatch)));
        // The foreign quote is a slip when the neighbour's line says
        // something else: the chunk stays, unlocated.
        let response = "1 |We..Monday|Enviamos |Or..Tuesday|el lunes.\n2 |Or..Tuesday|O el martes.\n3 |The..first|La demo va primero.\n4 |Then questions|Luego preguntas.";
        let result = parse(&p, &input, &response);
        assert!(result.issues.is_empty(), "{:?}", result.issues);
        assert_eq!(result.translation.translations["a"], "Enviamos el lunes.");
    }

    /// Two drifted lines pointing at the same home, or a home that already has
    /// a valid line, are never guessed.
    #[test]
    fn contested_homes_stay_in_the_retry_list() {
        let p = drift_page();
        let input = render(&p);
        // Lines 2 and 4 both point at sentence 3: neither is guessed; line 3
        // alone points at sentence 4, which has no other line.
        let response = "1 |We..Monday|Enviamos el lunes.\n2 |The..first|La demo va primero.\n3 |Then questions|Luego preguntas.\n4 |The demo|La demo.";
        let result = parse(&p, &input, &response);
        assert_eq!(result.translation.retry_ids, vec!["b", "c"]);
        assert_eq!(result.translation.translations["d"], "Luego preguntas.");
        // Sentence 3 has a valid line of its own: the drifted line 2 is dropped.
        let response = "1 |We..Monday|Enviamos el lunes.\n2 |The..first|La demo va primero.\n3 |The..first|La demo va primero.\n4 |Then questions|Luego preguntas.";
        let result = parse(&p, &input, &response);
        assert_eq!(result.translation.retry_ids, vec!["b"]);
        assert_eq!(result.translation.translations["c"], "La demo va primero.");
    }

    #[test]
    fn hints_render_from_budget_and_are_tolerated_when_echoed() {
        let mut p = drift_page();
        // Row sizes follow the target language (`es`: 42-unit rows), so a
        // 40-unit budget is one row and a 60-unit one needs two chunks.
        p.sections[0].sentences[0].budget = Some(60);
        p.sections[0].sentences[1].budget = Some(40);
        let input = render(&p);
        assert!(
            input.starts_with("! format=lines/1 mode=blocks row=42 target=es\n"),
            "{input}"
        );
        assert!(
            input.contains("\n1 ≤60 ≥2 We ship ¦ on Monday.\n"),
            "{input}"
        );
        assert!(input.contains("\n2 ≤40 Or maybe Tuesday.\n"), "{input}");
        assert!(input.contains("! reminder: 4 numbered lines in"), "{input}");
        assert!(
            input.trim_end().ends_with(
                "written in the target language (target=es); the source language appears only inside the |..| markers."
            ),
            "{input}"
        );
        let response = "1 ≤60 ≥2 |We..ship|Enviamos |on ¦ Monday|el lunes.\n2 ≤40 |Or..Tuesday|O el martes.\n3 |The..first|La demo va primero.\n4 |Then questions|Luego preguntas.";
        let result = parse(&p, &input, response);
        assert!(
            result.translation.retry_ids.is_empty(),
            "{:?}",
            result.issues
        );
        assert_eq!(result.translation.translations["a"], "Enviamos el lunes.");
    }

    /// Pieces prefer punctuation, then clause openers, near the even cut;
    /// languages without an opener list still cut at punctuation.
    #[test]
    fn piece_boundaries_prefer_punctuation_then_clause_openers() {
        let words: Vec<String> = "If you think about where AI is today, I mean, we are still in the very early innings and I truly believe that"
            .split(' ')
            .map(str::to_owned)
            .collect();
        // 23 words in 3 pieces: even cuts at 8 and 16; the comma after
        // "today," (boundary 8) and "and" (boundary 18) win inside their windows.
        assert_eq!(piece_boundaries(&words, 3, "en"), vec![8, 18]);
        assert_eq!(piece_boundaries(&words, 3, "xx"), vec![8, 16]);
        assert!(piece_boundaries(&words, 1, "en").is_empty());
        // The even cut (5) would split the name "Claude Code"; the boundary
        // moves to the nearest cut outside the capitalised run.
        let words: Vec<String> = "to the shape of Claude Code living in Slack"
            .split(' ')
            .map(str::to_owned)
            .collect();
        assert_eq!(piece_boundaries(&words, 2, "en"), vec![6]);
        // A source written without spaces arrives one character per word:
        // punctuation anywhere in the run beats the even cut (which would
        // fall inside a word), and without punctuation the even cut stands.
        let words: Vec<String> = "其实他的生活换个角度来看挺好的，二十七岁已经有三百万人民币的存款了，还有两个工作在等着他"
            .chars()
            .map(|ch| ch.to_string())
            .collect::<Vec<_>>()
            .into_iter()
            .fold(Vec::<String>::new(), |mut out, ch| {
                if ch == "，" {
                    out.last_mut().expect("leading punctuation").push_str(&ch);
                } else {
                    out.push(ch);
                }
                out
            });
        let after_commas: Vec<usize> = words
            .iter()
            .enumerate()
            .filter(|(_, w)| w.ends_with('，'))
            .map(|(i, _)| i + 1)
            .collect();
        assert_eq!(piece_boundaries(&words, 3, "zh"), after_commas);
        let plain: Vec<String> = "其实他的生活换个角度来看挺好的"
            .chars()
            .map(|ch| ch.to_string())
            .collect();
        // Without punctuation the even cut stands (it may fall inside a word;
        // the measured alternatives are in the doc comment).
        assert_eq!(
            piece_boundaries(&plain, 2, "zh"),
            vec![plain.len().div_ceil(2)]
        );
        // A boundary before a clause conjunction (`但是…`) beats the even cut.
        let conjunction: Vec<String> = "他的生活挺好的但是他自己并不这么觉得"
            .chars()
            .map(|ch| ch.to_string())
            .collect();
        assert_eq!(piece_boundaries(&conjunction, 2, "zh"), vec![7]);
        // Three pieces over 36 characters look near 12 and 24 with a window
        // of 6: the first window has no punctuation and the even cut (12)
        // would split 三百万, so the boundary moves to 11; the second holds
        // the comma (boundary 20).
        let late_comma: Vec<String> =
            "他二十七岁就已经攒下了三百万人民币的存款，还有两个月薪两三万的工作在等着他"
                .chars()
                .map(|ch| ch.to_string())
                .collect::<Vec<_>>()
                .into_iter()
                .fold(Vec::<String>::new(), |mut out, ch| {
                    if ch == "，" {
                        out.last_mut().expect("leading punctuation").push_str(&ch);
                    } else {
                        out.push(ch);
                    }
                    out
                });
        assert_eq!(late_comma.len(), 36);
        assert_eq!(piece_boundaries(&late_comma, 3, "zh"), vec![11, 20]);
        // The even cut (4) would split the number 1 000 000; the boundary
        // moves to the nearest cut outside the numeral run.
        let number: Vec<String> = "Pay me 1 000 000 now ok"
            .split(' ')
            .map(str::to_owned)
            .collect();
        assert_eq!(piece_boundaries(&number, 2, "xx"), vec![5]);
        let source = "If you think about where AI is today, I mean, we are still";
        let words: Vec<String> = source.split(' ').map(str::to_owned).collect();
        assert_eq!(
            with_pieces(source, &words, &[8]).as_deref(),
            Some("If you think about where AI is today, ¦ I mean, we are still")
        );
        assert_eq!(with_pieces(source, &["missing".to_owned()], &[0]), None);
    }
}
