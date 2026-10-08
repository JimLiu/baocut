//! Experimental lean carrier (`lines/1`, design M0). All coordinates are source
//! atom indexes / target Unicode scalar indexes, never normalized byte offsets.
//! This codec does not select a production protocol or write Transcript state.

use std::ops::Range;

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

use super::align_edges::{AlignChunk, CHUNK_EDGE_WEIGHT};
use crate::align_block::{AlignCtx, AlignEdge, AnchorAligner, WordAligner, safe_boundaries};
use crate::atomize::{JoinWord, join_word_texts, normalize_chars, unspaced_pair};

pub const FORMAT: &str = "lines/1";

/// Piece mark: shown in the source before each boundary word the answer is
/// asked to cut at (`≥k`). Input-only; one echoed unescaped into a chunk's
/// text is read as the model's own cut hint (see [`Chunk::marks`]).
pub const PIECE_MARK: char = '¦';

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Reference {
    Quote { left: String, right: String },
    Empty,
    Unknown,
}

/// One `|reference|text` unit. An empty `text` after a quote means "these
/// source words belong to the previous chunk" (the model already rendered them
/// inside that chunk's text); the parser keeps it so `evidence` can attach it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Chunk {
    pub reference: Reference,
    pub text: String,
    /// Where the model echoed a [`PIECE_MARK`] inside this chunk: offsets in
    /// normalized units ([`normalize_chars`]: whitespace and punctuation do
    /// not count) from the chunk's start, so they survive the host's spacing
    /// and punctuation pass. The mark itself is not part of `text`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    pub n: usize,
    pub rewrite: bool,
    pub chunks: Vec<Chunk>,
}

impl Record {
    pub fn text(&self) -> String {
        self.chunks
            .iter()
            .map(|chunk| chunk.text.as_str())
            .collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Issue {
    LinesSyntax,
    AnchorAmbiguous,
    AnchorUnresolved,
    AnchorConflict,
    FrozenCutAmbiguous,
    RewriteForbidden,
    /// The numbered line quotes another sentence of the page (the model merged
    /// or skipped a line and then counted on). The translation is not this
    /// sentence's; the line is rejected instead of degraded.
    LineMismatch,
    /// Advisory: a mismatched line whose quotes all locate in exactly one
    /// otherwise unanswered sentence was accepted for that sentence.
    LineReattributed,
}

/// Escapes before transport serialization. Quote dots are always escaped so
/// the only unescaped `..` is the endpoint separator.
pub fn escape(text: &str, quote: bool) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        match ch {
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\\' | '|' | '⏸' | '¦' => {
                out.push('\\');
                out.push(ch);
            }
            '.' | '∅' | '?' if quote => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

fn unescape(text: &str, quote: bool) -> Result<String, Issue> {
    let mut out = String::new();
    let mut chars = text.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            let escaped = chars.next().ok_or(Issue::LinesSyntax)?;
            out.push(match escaped {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '\\' | '|' | '⏸' | '¦' => escaped,
                '.' | '∅' | '?' if quote => escaped,
                _ => return Err(Issue::LinesSyntax),
            });
        } else if ch == '⏸' || ch == '\r' || ch == '\t' {
            // Pauses are input metadata only. Literal occurrences must escape.
            return Err(Issue::LinesSyntax);
        } else {
            out.push(ch);
        }
    }
    Ok(out)
}

fn unescaped_positions(text: &str, needle: char) -> Result<Vec<usize>, Issue> {
    let mut positions = Vec::new();
    let mut chars = text.char_indices();
    while let Some((index, ch)) = chars.next() {
        if ch == '\\' {
            chars.next().ok_or(Issue::LinesSyntax)?;
        } else if ch == needle {
            positions.push(index);
        }
    }
    Ok(positions)
}

/// `raw` (still escaped) without its unescaped occurrences of `needle`.
fn remove_unescaped(raw: &str, needle: char) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            out.push(ch);
            if let Some(next) = chars.next() {
                out.push(next);
            }
        } else if ch != needle {
            out.push(ch);
        }
    }
    out
}

/// A chunk's raw text unescaped, with its echoed piece marks taken out and
/// recorded as [`Chunk::marks`]. The whitespace the model put around a mark
/// is transport noise like the whitespace around a `|` ([`super::lines_translation`]'s
/// joint tidy-up): between two wide characters it goes, otherwise it collapses
/// to one space; a mark with nothing on one side of it is dropped without a
/// hint and the text around it is left as written. A literal `\¦` is text.
fn split_piece_marks(raw: &str) -> Result<(String, Vec<usize>), Issue> {
    let mut segments: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            current.push(ch);
            if let Some(next) = chars.next() {
                current.push(next);
            }
        } else if ch == PIECE_MARK {
            segments.push(std::mem::take(&mut current));
        } else {
            current.push(ch);
        }
    }
    segments.push(current);
    let mut text = String::new();
    let mut marks = Vec::new();
    let mut units = 0usize;
    for (index, segment) in segments.iter().enumerate() {
        let segment = unescape(segment, false)?;
        if index > 0 && !text.trim().is_empty() && !segment.trim().is_empty() {
            let spaced =
                text.ends_with(char::is_whitespace) || segment.starts_with(char::is_whitespace);
            let tail = text.trim_end().len();
            text.truncate(tail);
            let head = segment.trim_start();
            let wide = matches!(
                (text.chars().next_back(), head.chars().next()),
                (Some(last), Some(first)) if unspaced_pair(last, first)
            );
            if spaced && !wide {
                text.push(' ');
            }
            marks.push(units);
            text.push_str(head);
        } else {
            text.push_str(&segment);
        }
        units += normalize_chars(&segment).chars().count();
    }
    Ok((text, marks))
}

/// The record's own cut hints as character positions in [`Record::text`]:
/// every boundary between two textual chunks and every echoed piece mark
/// (the position of the first non-whitespace character after it, punctuation
/// included; the caller snaps it to a target atom start). Sorted, without
/// duplicates.
pub fn cut_hints(record: &Record) -> Vec<usize> {
    let mut hints = Vec::new();
    let mut offset = 0usize;
    for chunk in &record.chunks {
        if chunk.text.is_empty() {
            continue;
        }
        if offset > 0 {
            hints.push(offset);
        }
        let mut units = 0usize;
        let mut marks = chunk.marks.iter().copied().filter(|&mark| mark > 0);
        let mut next = marks.next();
        for (index, ch) in chunk.text.chars().enumerate() {
            while !ch.is_whitespace() && next.is_some_and(|mark| mark <= units) {
                hints.push(offset + index);
                next = marks.next();
            }
            if !ch.is_whitespace() && !crate::atomize::is_punctuation_or_symbol(ch) {
                units += ch.to_lowercase().count();
            }
        }
        offset += chunk.text.chars().count();
    }
    hints.sort_unstable();
    hints.dedup();
    hints
}

fn parse_reference(raw: &str) -> Result<Reference, Issue> {
    match raw {
        "∅" => return Ok(Reference::Empty),
        "?" => return Ok(Reference::Unknown),
        _ => (),
    }
    let dots = unescaped_positions(raw, '.')?;
    let separators: Vec<_> = dots
        .windows(2)
        .filter(|pair| pair[1] == pair[0] + 1)
        .map(|pair| pair[0])
        .collect();
    // A complete, uniquely matched source phrase supplies BOTH endpoints. This
    // is not a start-only marker and never borrows an end from the next chunk.
    if separators.is_empty() {
        let phrase = unescape(raw, true)?;
        if phrase.trim().is_empty() {
            return Err(Issue::LinesSyntax);
        }
        return Ok(Reference::Quote {
            left: phrase.clone(),
            right: phrase,
        });
    }
    // `|both..you..know|` is a slip for `|both..know|`: the outer parts are
    // the endpoints, anything between is interior and carries no meaning.
    // Three dots in a row are an ellipsis, which never abbreviates a quote.
    if separators.windows(2).any(|pair| pair[1] <= pair[0] + 2) {
        return Err(Issue::LinesSyntax);
    }
    let first = separators[0];
    let last = separators[separators.len() - 1];
    let left = unescape(&raw[..first], true)?;
    let right = unescape(&raw[last + 2..], true)?;
    if left.trim().is_empty() || right.trim().is_empty() {
        return Err(Issue::LinesSyntax);
    }
    Ok(Reference::Quote { left, right })
}

/// `text` read as a marker body: the reference it would be when it has the
/// `LEFT..RIGHT` shape. `None` for anything else, a whole-phrase quote
/// included — ordinary chunk text is a phrase too.
pub fn endpoint_quote(text: &str) -> Option<Reference> {
    match parse_reference(text.trim()) {
        Ok(Reference::Quote { left, right }) if left != right => {
            Some(Reference::Quote { left, right })
        }
        _ => None,
    }
}

pub fn render(record: &Record) -> String {
    let mut out = format!("{}{} ", record.n, if record.rewrite { "~" } else { "" });
    for chunk in &record.chunks {
        out.push('|');
        match &chunk.reference {
            Reference::Empty => out.push('∅'),
            Reference::Unknown => out.push('?'),
            Reference::Quote { left, right } => {
                out.push_str(&escape(left, true));
                out.push_str("..");
                out.push_str(&escape(right, true));
            }
        }
        out.push('|');
        out.push_str(&escape(&chunk.text, false));
    }
    out
}

/// Input hints rendered between the number and the source (`≤42` reading
/// budget, `≥3` minimum chunk count). They are never part of an answer, but a
/// model that echoes them must not turn a good line into a syntax error.
fn strip_echoed_hints(body: &str) -> &str {
    let mut rest = body;
    let mut stripped = false;
    loop {
        let trimmed = rest.trim_start_matches(' ');
        // A piece mark echoed before the first chunk carries no cut.
        if let Some(tail) = trimmed.strip_prefix(PIECE_MARK) {
            rest = tail;
            stripped = true;
            continue;
        }
        let Some(tail) = trimmed
            .strip_prefix('≤')
            .or_else(|| trimmed.strip_prefix('≥'))
        else {
            return if stripped { trimmed } else { rest };
        };
        let digits = tail.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || !matches!(tail.as_bytes().get(digits), Some(b' ') | None) {
            return if stripped { trimmed } else { rest };
        }
        rest = &tail[digits..];
        stripped = true;
    }
}

/// Parse one physical record, without trimming body whitespace. Page identity,
/// duplicate indexes and permissions are checked against the caller's manifest.
///
/// A quote marker followed by no text (`|a..b||c..d|x`, or `|a..b|` at the end
/// of the line) is legal: it attaches those source words to the neighbouring
/// chunk. A text-less `|∅|` / `|?|` carries nothing and is dropped. A line whose
/// chunks are all text-less has no translation and is a syntax error.
pub fn parse(line: &str) -> Result<Record, Issue> {
    if line.contains('\n') {
        return Err(Issue::LinesSyntax);
    }
    let (id, body) = line.split_once(' ').ok_or(Issue::LinesSyntax)?;
    let rewrite = id.ends_with('~');
    let digits = id.strip_suffix('~').unwrap_or(id);
    if digits.is_empty() || !digits.bytes().all(|ch| ch.is_ascii_digit()) {
        return Err(Issue::LinesSyntax);
    }
    let n = digits.parse::<usize>().map_err(|_| Issue::LinesSyntax)?;
    let body = strip_echoed_hints(body);
    if n == 0 || body.is_empty() {
        return Err(Issue::LinesSyntax);
    }
    let bars = unescaped_positions(body, '|')?;
    let mut chunks = Vec::new();
    if bars.is_empty() {
        let (text, marks) = split_piece_marks(body)?;
        chunks.push(Chunk {
            reference: Reference::Unknown,
            text,
            marks,
        });
    } else {
        // A dangling `|` or `||` after the last chunk is noise, not a marker.
        let mut bars = bars;
        let mut body_end = body.len();
        while bars.len() % 2 != 0 && body[bars[bars.len() - 1] + 1..body_end].trim().is_empty() {
            body_end = bars.pop().expect("odd count");
        }
        if bars.len() % 2 != 0 || bars[0] != 0 {
            return Err(Issue::LinesSyntax);
        }
        for index in (0..bars.len()).step_by(2) {
            let end = bars.get(index + 2).copied().unwrap_or(body_end);
            let (mut text, mut marks) = split_piece_marks(&body[bars[index + 1] + 1..end])?;
            // A mark echoed into a quote (`a..¦b`) is noise there.
            let reference = parse_reference(&remove_unescaped(
                &body[bars[index] + 1..bars[index + 1]],
                PIECE_MARK,
            ))?;
            if text.trim().is_empty() {
                if !matches!(reference, Reference::Quote { .. }) {
                    continue;
                }
                text = String::new();
                marks.clear();
            }
            chunks.push(Chunk {
                reference,
                text,
                marks,
            });
        }
    }
    if chunks.iter().all(|chunk| chunk.text.trim().is_empty()) {
        return Err(Issue::LinesSyntax);
    }
    Ok(Record { n, rewrite, chunks })
}

/// Matching tiers. `Exact` is byte equality; `Punct` strips outer sentence
/// punctuation and folds compatibility forms but keeps case, so `models.`
/// matches `models` while `And` still differs from `and`; `Fold` also folds
/// case and quote glyphs (the model may have retyped them).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Tier {
    Exact,
    Punct,
    Fold,
    /// Single atoms only: the quoted word is the atom up to its apostrophe
    /// (`you` for `you're`), the contraction slip models make most.
    Stem,
    /// Runs of two or more atoms only: the quote equals the run once
    /// whitespace is dropped on both sides. Words store no whitespace, so a
    /// script written without spaces between words (Thai, Lao, Khmer, ...)
    /// comes back from the join with spaces the model's quote never had.
    Glued,
    /// A quote whose edge stops inside a word of a script written without
    /// spaces, where that word was cut out of a longer run by a word
    /// segmenter (it is glued to a neighbour). The model does not see those
    /// boundaries and cuts where it reads a word end; the segmenter sometimes
    /// keeps two words together (`นัทแต่`). The quote, whitespace dropped,
    /// must occur in the sentence; the span grows to the whole words it
    /// touches. Words not cut that way (spaced scripts, one atom per phrase)
    /// never match here.
    Snap,
}
const TIERS: [Tier; 6] = [
    Tier::Exact,
    Tier::Punct,
    Tier::Fold,
    Tier::Stem,
    Tier::Glued,
    Tier::Snap,
];

/// Punctuation a quote may leave off a word's edge (`Punct` and looser tiers).
///
/// ASCII is a fixed list: `#`, `%`, `@`, `&`, `/`, `'`, `*` stay, because they
/// belong to the word (`50%`, `#3`, `don't`) more often than to the sentence.
/// Beyond ASCII the rule is the Unicode punctuation categories (dash, open,
/// close, initial, final, other), so every script's sentence and clause marks
/// count the same way — the Devanagari danda (`था।`), Arabic `،` / `؟`, the
/// Chinese enumeration comma and book-title brackets, the Armenian, Ethiopic,
/// Myanmar and Khmer full stops — without a per-language table. The single
/// curly quotes stay: a final one is also an apostrophe (`students’`), and a
/// quote that leaves it off still reaches the word through the `Stem` tier.
fn outer_punctuation(ch: char) -> bool {
    use unicode_general_category::{GeneralCategory, get_general_category};
    if ch.is_ascii() {
        return matches!(
            ch,
            ',' | '.' | '!' | '?' | ';' | ':' | '"' | '-' | '(' | ')'
        );
    }
    if matches!(ch, '\u{2018}'..='\u{201B}') {
        return false;
    }
    matches!(
        get_general_category(ch),
        GeneralCategory::DashPunctuation
            | GeneralCategory::OpenPunctuation
            | GeneralCategory::ClosePunctuation
            | GeneralCategory::InitialPunctuation
            | GeneralCategory::FinalPunctuation
            | GeneralCategory::OtherPunctuation
    )
}

fn canonical(text: &str, tier: Tier) -> String {
    if tier == Tier::Exact {
        return text.to_owned();
    }
    let folded: String = text
        .nfkc()
        .flat_map(|ch| {
            let lower: Vec<char> = if tier == Tier::Fold {
                ch.to_lowercase().collect()
            } else {
                vec![ch]
            };
            lower
        })
        .map(|ch| match ch {
            '’' | '‘' if tier == Tier::Fold => '\'',
            '“' | '”' if tier == Tier::Fold => '"',
            _ => ch,
        })
        .collect();
    // Only outer sentence punctuation; never remove internal decimal / URL /
    // identifier punctuation, and never turn a punctuation-only atom into empty.
    let trimmed = if folded.contains("://") || folded.contains('_') {
        folded.as_str()
    } else {
        folded.trim_matches(outer_punctuation)
    };
    let value = if trimmed.is_empty() { &folded } else { trimmed };
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn occurrences_at<W: JoinWord>(words: &[W], quote: &str, tier: Tier) -> Vec<Range<usize>> {
    if tier == Tier::Stem {
        let want = canonical(quote, Tier::Fold);
        if want.contains(['\'', '’']) || want.contains(' ') {
            return Vec::new();
        }
        return (0..words.len())
            .filter(|&at| {
                let atom = canonical(words[at].join_text(), Tier::Fold);
                atom.split_once('\'')
                    .is_some_and(|(stem, rest)| stem == want && !rest.is_empty())
            })
            .map(|at| at..at + 1)
            .collect();
    }
    if tier == Tier::Snap {
        return snapped_occurrences(words, quote);
    }
    if tier == Tier::Glued {
        let glued = |text: &str| -> String {
            canonical(text, Tier::Fold)
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .collect()
        };
        let want = glued(quote);
        let mut found = Vec::new();
        if want.is_empty() {
            return found;
        }
        for start in 0..words.len() {
            for end in start + 2..=words.len() {
                let text = join_word_texts(&words[start..end]);
                let text = glued(&text);
                if text == want {
                    found.push(start..end);
                }
                if text.len() > want.len() + 8 {
                    break;
                }
            }
        }
        return found;
    }
    let want = canonical(quote, tier);
    let mut found = Vec::new();
    for start in 0..words.len() {
        for end in start + 1..=words.len() {
            let text = join_word_texts(&words[start..end]);
            let text = canonical(&text, tier);
            if text == want {
                found.push(start..end);
            }
            // Joining nonempty atoms only grows. Allow edge punctuation in the
            // normalized comparison, but do not scan the rest of a long sentence.
            if text.len() > want.len() + 8 {
                break;
            }
        }
    }
    found
}

/// [`Tier::Snap`]: where the quote occurs inside the sentence with whitespace
/// dropped, widened to whole words; only when each edge that falls inside a
/// word falls inside a segmenter-cut word of an unspaced script.
fn snapped_occurrences<W: JoinWord>(words: &[W], quote: &str) -> Vec<Range<usize>> {
    // The quote loses its outer punctuation (as in every looser tier); the
    // words keep theirs, so the sentence still reads as written in between.
    let fold = |text: &str| -> String {
        text.nfkc()
            .flat_map(char::to_lowercase)
            .map(|ch| match ch {
                '’' | '‘' => '\'',
                '“' | '”' => '"',
                _ => ch,
            })
            .filter(|ch| !ch.is_whitespace())
            .collect()
    };
    let want = fold(&canonical(quote, Tier::Fold));
    if want.is_empty() {
        return Vec::new();
    }
    let mut text = String::new();
    let mut bounds: Vec<Range<usize>> = Vec::with_capacity(words.len());
    for word in words {
        let start = text.len();
        text.push_str(&fold(word.join_text()));
        bounds.push(start..text.len());
    }
    let cut_word = |index: usize| {
        let glued = words[index].glued() || words.get(index + 1).is_some_and(|next| next.glued());
        glued
            && words[index]
                .join_text()
                .chars()
                .any(crate::atomize::is_unspaced_script_char)
    };
    let mut found = Vec::new();
    for (at, _) in text.match_indices(want.as_str()) {
        let end = at + want.len();
        let Some(first) = bounds.iter().position(|word| word.end > at) else {
            continue;
        };
        let Some(last) = bounds.iter().rposition(|word| word.start < end) else {
            continue;
        };
        let inside_first = at > bounds[first].start;
        let inside_last = end < bounds[last].end;
        // Whole words are the stricter tiers' business (`Glued` takes runs).
        if !(inside_first || inside_last)
            || (inside_first && !cut_word(first))
            || (inside_last && !cut_word(last))
        {
            continue;
        }
        let span = first..last + 1;
        if !found.contains(&span) {
            found.push(span);
        }
    }
    found
}

/// Every source span a pair of quotes can denote, at the strictest tier that
/// yields anything. A span needs LEFT to start no later than RIGHT ends.
/// Where one endpoint quote occurs, with the rank of the loosest tier the
/// occurrence needed (0 = exact). Each endpoint is read on its own, so a
/// contraction slip on one side does not lose the exact other side.
fn endpoint_occurrences<W: JoinWord>(words: &[W], quote: &str) -> Vec<(Range<usize>, u8)> {
    let mut out: Vec<(Range<usize>, u8)> = Vec::new();
    for (rank, tier) in TIERS.into_iter().enumerate() {
        for span in occurrences_at(words, quote, tier) {
            if !out.iter().any(|(seen, _)| *seen == span) {
                out.push((span, rank as u8));
            }
        }
    }
    out
}

/// Every span a quote pair can mean, ranked by its loosest endpoint reading.
fn candidates_all<W: JoinWord>(words: &[W], left: &str, right: &str) -> Vec<(Range<usize>, u8)> {
    let ls = endpoint_occurrences(words, left);
    let rs = if left == right {
        ls.clone()
    } else {
        endpoint_occurrences(words, right)
    };
    let mut spans: Vec<(Range<usize>, u8)> = Vec::new();
    for (l, lr) in &ls {
        for (r, rr) in &rs {
            if l.start <= r.start && l.end <= r.end {
                let span = l.start..r.end;
                let rank = (*lr).max(*rr);
                match spans.iter_mut().find(|(seen, _)| *seen == span) {
                    Some((_, seen_rank)) => *seen_rank = (*seen_rank).min(rank),
                    None => spans.push((span, rank)),
                }
            }
        }
    }
    spans
}

/// Every source span a reference can denote at any matching tier (empty for
/// `∅` / `?`): what a quote could mean on its own, before any disambiguation.
pub fn candidate_spans<W: JoinWord>(words: &[W], reference: &Reference) -> Vec<Range<usize>> {
    match reference {
        Reference::Quote { left, right } => candidates_all(words, left, right)
            .into_iter()
            .map(|(span, _)| span)
            .collect(),
        _ => Vec::new(),
    }
}

/// Spans of the strictest reading that finds any: what a quote means on its
/// own.
fn candidates<W: JoinWord>(words: &[W], left: &str, right: &str) -> Vec<Range<usize>> {
    let all = candidates_all(words, left, right);
    let Some(best) = all.iter().map(|(_, rank)| *rank).min() else {
        return Vec::new();
    };
    all.into_iter()
        .filter(|(_, rank)| *rank == best)
        .map(|(span, _)| span)
        .collect()
}

/// Resolve one reference on its own: unique or nothing. Callers with several
/// chunks of one sentence use [`evidence`], which disambiguates across chunks.
pub fn resolve<W: JoinWord>(
    words: &[W],
    reference: &Reference,
) -> Result<Option<Range<usize>>, Issue> {
    match reference {
        Reference::Empty => Ok(None),
        Reference::Unknown => Err(Issue::AnchorUnresolved),
        Reference::Quote { left, right } => match candidates(words, left, right).as_slice() {
            [] => Err(Issue::AnchorUnresolved),
            [only] => Ok(Some(only.clone())),
            _ => Err(Issue::AnchorAmbiguous),
        },
    }
}

/// Whether both quotes of a reference occur in `words` at all (any tier). Used
/// to tell which sentence of a page a numbered line is really about.
pub fn quotes_occur<W: JoinWord>(words: &[W], reference: &Reference) -> Option<bool> {
    match reference {
        Reference::Quote { left, right } => Some(!candidates(words, left, right).is_empty()),
        _ => None,
    }
}

/// Deterministic oracle encoder for replay experiments. Extend quotes inward
/// until their pair is unique. Some repeated ranges are intrinsically impossible
/// to identify without quoting outside their hull: preserve them as unknown.
pub fn quote_range<W: JoinWord>(words: &[W], range: Range<usize>) -> Reference {
    if range.is_empty() || range.end > words.len() {
        return Reference::Unknown;
    }
    let full = join_word_texts(&words[range.clone()]);
    let full_reference = Reference::Quote {
        left: full.clone(),
        right: full,
    };
    if resolve(words, &full_reference) != Ok(Some(range.clone())) {
        return Reference::Unknown;
    }
    let len = range.len();
    for total in 2..=len.saturating_mul(2) {
        for left_len in 1..=len.min(total - 1) {
            let right_len = total - left_len;
            if right_len > len {
                continue;
            }
            let candidate = Reference::Quote {
                left: join_word_texts(&words[range.start..range.start + left_len]),
                right: join_word_texts(&words[range.end - right_len..range.end]),
            };
            if resolve(words, &candidate) == Ok(Some(range.clone())) {
                return candidate;
            }
        }
    }
    Reference::Unknown
}

pub fn from_ordinals<W: JoinWord>(n: usize, words: &[W], chunks: &[AlignChunk]) -> Record {
    Record {
        n,
        rewrite: false,
        chunks: chunks
            .iter()
            .map(|chunk| Chunk {
                text: chunk.text.clone(),
                marks: Vec::new(),
                reference: match (chunk.ordinals.iter().min(), chunk.ordinals.iter().max()) {
                    (Some(&lo), Some(&hi)) if hi < words.len() => quote_range(words, lo..hi + 1),
                    (None, None) => Reference::Empty,
                    _ => Reference::Unknown,
                },
            })
            .collect(),
    }
}

/// Piece starts of the sentence (see `lines_translation::piece_boundaries`);
/// a span that starts and ends on piece edges is preferred among ties.
pub type Pieces<'a> = &'a [usize];

/// Joint resolution of every quote of one sentence. A reference with a single
/// reading keeps it unconditionally: a quote is the model's claim about that
/// chunk's source hull, and a hull that overlaps a neighbour's (`|Turn..off|`
/// next to `|the light|`) is evidence of a crossing, not a reason to discard
/// either side. Only references with several readings are searched: among
/// the assignments the one overlapping the fixed and other chosen spans the
/// least wins (a partition is the normal case), then the one covering the
/// most source atoms, then piece-edge spans, then the fewest crossings
/// against target order, then the strictest readings. A searched reference
/// is resolved only when every winning assignment agrees on it; the rest
/// stay ambiguous.
///
/// `all` holds `(unit index, candidate spans)`; the unit index orders
/// references along the target. Returns one entry per reference.
fn resolve_jointly(
    all: &[(usize, Vec<(Range<usize>, u8)>)],
    pieces: Pieces,
    n: usize,
) -> Vec<Result<Range<usize>, Issue>> {
    const NODE_BUDGET: usize = 200_000;
    let mut out: Vec<Result<Range<usize>, Issue>> = vec![Err(Issue::AnchorUnresolved); all.len()];
    // Fixed: the unique readings. Live: references with several readings,
    // searched most-constrained first so the bound prunes early. References
    // without any occurrence stay unresolved.
    let mut fixed: Vec<(usize, Range<usize>)> = Vec::new();
    let mut live: Vec<usize> = Vec::new();
    for (index, (unit, spans)) in all.iter().enumerate() {
        match spans.as_slice() {
            [] => {}
            [(only, _)] => {
                out[index] = Ok(only.clone());
                fixed.push((*unit, only.clone()));
            }
            _ => live.push(index),
        }
    }
    if live.is_empty() {
        return out;
    }
    live.sort_by_key(|&index| all[index].1.len());
    let refs: Vec<(usize, Vec<(Range<usize>, u8)>)> =
        live.iter().map(|&i| all[i].clone()).collect();
    let refs = refs.as_slice();
    let longest: Vec<usize> = refs
        .iter()
        .map(|(_, spans)| spans.iter().map(|(span, _)| span.len()).max().unwrap_or(0))
        .collect();
    let on_edge = |span: &Range<usize>| {
        (span.start == 0 || pieces.contains(&span.start))
            && (span.end == n || pieces.contains(&span.end))
    };
    let overlap =
        |a: &Range<usize>, b: &Range<usize>| a.end.min(b.end).saturating_sub(a.start.max(b.start));
    // Least overlap, then most source covered, then on piece edges, then
    // fewest crossings, then strictest readings.
    type Score = (isize, usize, usize, isize, isize);
    struct Search<'a> {
        refs: &'a [(usize, Vec<(Range<usize>, u8)>)],
        fixed: &'a [(usize, Range<usize>)],
        longest: &'a [usize],
        on_edge: &'a dyn Fn(&Range<usize>) -> bool,
        overlap: &'a dyn Fn(&Range<usize>, &Range<usize>) -> usize,
        /// One entry per searched reference: the chosen span and its tier rank.
        chosen: Vec<(Range<usize>, u8)>,
        coverage: usize,
        overlapping: usize,
        nodes: usize,
        best: Option<Score>,
        winners: Vec<Vec<Range<usize>>>,
        exhausted: bool,
    }
    impl Search<'_> {
        fn score(&self) -> Score {
            let aligned = self
                .chosen
                .iter()
                .filter(|(span, _)| (self.on_edge)(span))
                .count();
            // Crossings count against every placed span, fixed ones included.
            let placed: Vec<(usize, &Range<usize>)> = self
                .chosen
                .iter()
                .enumerate()
                .map(|(i, (span, _))| (self.refs[i].0, span))
                .chain(self.fixed.iter().map(|(unit, span)| (*unit, span)))
                .collect();
            let mut crossings = 0isize;
            for (i, (ui, a)) in placed.iter().enumerate() {
                for (uj, b) in placed.iter().skip(i + 1) {
                    let order = ui.cmp(uj);
                    if order != std::cmp::Ordering::Equal && order != a.start.cmp(&b.start) {
                        crossings += 1;
                    }
                }
            }
            let ranks: isize = self.chosen.iter().map(|(_, rank)| *rank as isize).sum();
            (
                -(self.overlapping as isize),
                self.coverage,
                aligned,
                -crossings,
                -ranks,
            )
        }
        fn walk(&mut self, index: usize) {
            self.nodes += 1;
            if self.nodes > NODE_BUDGET {
                self.exhausted = true;
                return;
            }
            // Bound: overlap only grows; coverage at best gains every
            // remaining reference's longest span.
            if let Some((best_overlap, best_coverage, ..)) = self.best {
                let overlapping = -(self.overlapping as isize);
                let coverage = self.coverage + self.longest[index..].iter().sum::<usize>();
                if (overlapping, coverage) < (best_overlap, best_coverage) {
                    return;
                }
            }
            if index == self.refs.len() {
                let score = self.score();
                match self.best {
                    Some(best) if best > score => {}
                    Some(best) if best == score => self.winners.push(self.assignment()),
                    _ => {
                        self.best = Some(score);
                        self.winners = vec![self.assignment()];
                    }
                }
                return;
            }
            for (span, rank) in &self.refs[index].1 {
                let added: usize = self
                    .fixed
                    .iter()
                    .map(|(_, other)| (self.overlap)(span, other))
                    .chain(
                        self.chosen
                            .iter()
                            .map(|(other, _)| (self.overlap)(span, other)),
                    )
                    .sum();
                self.chosen.push((span.clone(), *rank));
                self.coverage += span.len();
                self.overlapping += added;
                self.walk(index + 1);
                self.overlapping -= added;
                self.coverage -= span.len();
                self.chosen.pop();
                if self.exhausted {
                    return;
                }
            }
        }
        fn assignment(&self) -> Vec<Range<usize>> {
            self.chosen.iter().map(|(span, _)| span.clone()).collect()
        }
    }
    let mut search = Search {
        refs,
        fixed: &fixed,
        longest: &longest,
        on_edge: &on_edge,
        overlap: &overlap,
        chosen: Vec::with_capacity(refs.len()),
        coverage: 0,
        overlapping: 0,
        nodes: 0,
        best: None,
        winners: Vec::new(),
        exhausted: false,
    };
    search.walk(0);
    for (position, &index) in live.iter().enumerate() {
        out[index] = if search.exhausted || search.winners.is_empty() {
            // Too many assignments to enumerate: fall back to the strict
            // per-reference reading, which never guesses.
            match refs[position]
                .1
                .iter()
                .filter(|(_, rank)| *rank == refs[position].1[0].1)
                .collect::<Vec<_>>()
                .as_slice()
            {
                [(only, _)] => Ok(only.clone()),
                _ => Err(Issue::AnchorAmbiguous),
            }
        } else {
            let first = &search.winners[0][position];
            if search.winners.iter().all(|w| &w[position] == first) {
                Ok(first.clone())
            } else {
                Err(Issue::AnchorAmbiguous)
            }
        };
    }
    out
}

#[derive(Debug)]
pub struct Evidence {
    pub text: String,
    pub edges: Vec<AlignEdge>,
    pub issues: Vec<Issue>,
    /// Only these candidates may be passed to the downstream DP. No caller may
    /// substitute generic target cuts when `issues` indicates missing evidence.
    pub cuts: Vec<usize>,
    /// Chunks that carry target text (text-less attachments are folded in).
    pub chunks: usize,
    /// Chunks whose source membership resolved (their edges are in `edges`).
    pub located: usize,
    /// Adjacent chunk pairs whose quoted hulls overlap (a reordering the model
    /// reported, or a copied endpoint): both hulls are kept and no cut is
    /// given between them (advisory; see [`evidence_with_pieces`]).
    pub overlapping: usize,
}

/// Per-sentence evidence. A chunk that fails to resolve or stays ambiguous
/// loses its own edges, and the sentence keeps no cut at all while such a
/// chunk exists (its words could sit on either side of any cut); the other
/// chunks keep their edges for the planner. A chunk a hard anchor contradicts
/// keeps its quoted hull and the anchor, both as edges. Empty affiliation
/// cannot create a time window without source evidence on both sides.
pub fn evidence<W: JoinWord>(record: &Record, words: &[W], ctx: &AlignCtx) -> Evidence {
    evidence_with_pieces(record, words, ctx, &[])
}

/// [`evidence`] for a sentence that was shown with piece marks: quotes that
/// sit exactly on the pieces win ties in the joint resolution.
pub fn evidence_with_pieces<W: JoinWord>(
    record: &Record,
    words: &[W],
    ctx: &AlignCtx,
    pieces: Pieces,
) -> Evidence {
    let text = record.text();
    let mut issues = Vec::new();
    // Units: chunks with text. A text-less quote attaches to the previous
    // unit, or to the next one when it opens the line.
    struct Unit {
        target: Range<usize>,
        primary: Option<usize>,
        attached: Vec<usize>,
        empty: bool,
        unknown: bool,
    }
    let mut units: Vec<Unit> = Vec::new();
    let mut refs: Vec<(usize, Vec<(Range<usize>, u8)>)> = Vec::new();
    let mut pending: Vec<usize> = Vec::new();
    let mut cursor = 0;
    for chunk in &record.chunks {
        let quote = match &chunk.reference {
            Reference::Quote { left, right } => Some(candidates_all(words, left, right)),
            _ => None,
        };
        if chunk.text.is_empty() {
            if let Some(spans) = quote {
                let index = refs.len();
                refs.push((units.len().saturating_sub(1), spans));
                match units.last_mut() {
                    Some(unit) => unit.attached.push(index),
                    None => pending.push(index),
                }
            }
            continue;
        }
        let target = cursor..cursor + chunk.text.chars().count();
        cursor = target.end;
        let mut unit = Unit {
            target,
            primary: None,
            attached: std::mem::take(&mut pending),
            empty: matches!(chunk.reference, Reference::Empty),
            unknown: matches!(chunk.reference, Reference::Unknown),
        };
        if let Some(spans) = quote {
            unit.primary = Some(refs.len());
            refs.push((units.len(), spans));
        }
        for &index in &unit.attached {
            refs[index].0 = units.len();
        }
        units.push(unit);
    }
    for index in pending {
        // Text-less quotes with no textual chunk at all: nothing to attach to.
        refs[index].1.clear();
    }
    let resolved = resolve_jointly(&refs, pieces, words.len());
    let mut membership: Vec<Option<(usize, usize)>> = Vec::new();
    let mut good = Vec::new();
    for unit in &units {
        let mut lo = usize::MAX;
        let mut hi = 0;
        let mut ok = !unit.unknown;
        if unit.unknown {
            issues.push(Issue::AnchorUnresolved);
        }
        for (index, is_primary) in unit
            .primary
            .iter()
            .map(|i| (*i, true))
            .chain(unit.attached.iter().map(|i| (*i, false)))
        {
            match &resolved[index] {
                Ok(span) => {
                    lo = lo.min(span.start);
                    hi = hi.max(span.end);
                }
                Err(issue) => {
                    issues.push(*issue);
                    if is_primary {
                        ok = false;
                    }
                }
            }
        }
        membership.push((ok && lo < hi).then_some((lo, hi)));
        good.push(ok && (unit.empty || lo < hi));
    }
    // Two adjacent hulls that overlap — including ones that end on the same
    // word (`|If..milliseconds|如果…在毫秒内|complete..milliseconds|完成`) or start
    // on it — are both kept as they were quoted. A shared endpoint is not
    // proof of a copying slip: in the replayed pages it was mostly the honest
    // report of a reordering (the first chunk really translates words from
    // the end of the second hull), and clipping the outer hull to the
    // partition reading admitted a cut whose left line carried text from the
    // right line's time window. `safe_boundaries` refuses every cut inside
    // the overlap on its own; a genuine slip (`|I..world|我劝她|joining..world|`)
    // only costs that one cut.
    let overlapping = (1..units.len())
        .filter(|&index| {
            matches!(
                (membership[index - 1], membership[index]),
                (Some((_, hi_a)), Some((lo_b, _))) if lo_b < hi_a
            )
        })
        .count();
    // Source words outside every quoted range still belong to some chunk; the
    // outermost chunks own the sentence's ends, so a lone chunk owns it all and
    // a partial quote (`|So..how|` for a whole-sentence chunk) never puts the
    // chunk in conflict with a hard anchor further along the sentence.
    let first = (0..units.len())
        .filter(|i| membership[*i].is_some())
        .min_by_key(|i| membership[*i].map(|(lo, _)| lo));
    let last = (0..units.len())
        .filter(|i| membership[*i].is_some())
        .max_by_key(|i| membership[*i].map(|(_, hi)| hi));
    if let Some(first) = first {
        membership[first] = membership[first].map(|(_, hi)| (0, hi));
    }
    if let Some(last) = last {
        membership[last] = membership[last].map(|(lo, _)| (lo, words.len()));
    }
    // A chunk with text but no source membership (`|?|` or an unresolved
    // quote) may translate words from anywhere in the sentence, so no cut of
    // the sentence can be shown safe: closing only the cuts next to it would
    // still let it cross a cut further away.
    let unlocated = units
        .iter()
        .enumerate()
        .any(|(index, unit)| membership[index].is_none() && !unit.empty);
    // A hard anchor whose source word lies outside the hull of the chunk that
    // carries it proves the quote understated on that side, not that the
    // quote is worthless: the hull stays an edge (it still vetoes the cuts it
    // crosses, which a lone anchor at the sentence's other end would not) and
    // the anchor joins it, so `safe_boundaries` sees both. Dropping the hull
    // instead let a cut between two other chunks through while the anchor
    // vetoed nothing there; marking the sentence unlocated cost 8 of 508
    // replayed sentences a rewrite turn and gained none.
    let src: Vec<_> = words.iter().map(JoinWord::join_text).collect();
    let hard = AnchorAligner.align(&src, &text, ctx);
    for anchor in &hard {
        for (index, unit) in units.iter().enumerate() {
            let overlaps = unit.target.start < anchor.tgt.end && anchor.tgt.start < unit.target.end;
            if let (true, Some((lo, hi))) = (overlaps, membership[index]) {
                if !(lo..hi).contains(&anchor.src) {
                    issues.push(Issue::AnchorConflict);
                }
            }
        }
    }
    let mut edges = Vec::new();
    for (index, unit) in units.iter().enumerate() {
        if let Some((lo, hi)) = membership[index] {
            edges.push(AlignEdge::soft(lo, unit.target.clone(), CHUNK_EDGE_WEIGHT));
            if hi - lo > 1 {
                edges.push(AlignEdge::soft(
                    hi - 1,
                    unit.target.clone(),
                    CHUNK_EDGE_WEIGHT,
                ));
            }
        }
    }
    edges.extend(hard);
    let grapheme_cuts: Vec<_> = text
        .grapheme_indices(true)
        .map(|(byte, _)| text[..byte].chars().count())
        .collect();
    let candidates: Vec<usize> = units
        .windows(2)
        .enumerate()
        .filter(|(index, _)| !unlocated && good[*index] && good[index + 1])
        .map(|(_, pair)| pair[0].target.end)
        .filter(|cut| {
            *cut < cursor
                && grapheme_cuts.contains(cut)
                && edges.iter().any(|e| e.tgt.end <= *cut)
                && edges.iter().any(|e| e.tgt.start >= *cut)
        })
        .collect();
    let cuts = safe_boundaries(&edges, &candidates, CHUNK_EDGE_WEIGHT);
    Evidence {
        text,
        edges,
        issues,
        cuts,
        chunks: units.len(),
        located: membership.iter().filter(|m| m.is_some()).count(),
        overlapping,
    }
}

/// The initial experiment is deliberately strict: a changed frozen echo keeps
/// the exact manifest text and discards its cuts. It never writes a near match.
/// A future LCS recovery must pass the separate ambiguity fixtures before use.
pub fn freeze(record: &Record, frozen: &str) -> (Record, Vec<Issue>) {
    if record.text() == frozen && !record.rewrite {
        return (record.clone(), Vec::new());
    }
    (
        Record {
            n: record.n,
            rewrite: false,
            chunks: vec![Chunk {
                reference: Reference::Unknown,
                text: frozen.to_owned(),
                marks: Vec::new(),
            }],
        },
        vec![if record.rewrite {
            Issue::RewriteForbidden
        } else {
            Issue::FrozenCutAmbiguous
        }],
    )
}
