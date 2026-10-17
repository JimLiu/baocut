//! Word and grapheme boundaries from ICU4X, for text whose script does not put
//! spaces between words.
//!
//! The transcript builder (`bcut-flow-core`) uses these to split a run of Thai,
//! Lao, Khmer or Myanmar text into words; the forced aligner's tokenizer in
//! [`crate::text_prep`] is the other ICU4X caller. Words are cut with the LSTM
//! segmenter: it covers exactly those four scripts and does not carry the
//! Chinese / Japanese dictionary. [`dictionary_word_boundaries`] is a second
//! opinion only, for callers that need to know which LSTM boundaries are sure;
//! it links the word lists of those scripts (about 1.8 MB of binary).
//!
//! [`han_word_interior`] is the Chinese side: caption cue splitting
//! ([`crate::cue`]) and the burned-in caption wrap (`subtitle-render`) ask it
//! which gaps between two Han characters fall inside a word. It uses the
//! ICU4X `auto` segmenter, whose Chinese / Japanese dictionary is the same ICU
//! `cjdict` that `Intl.Segmenter` uses in the editor and the jobs.

use icu_segmenter::options::WordBreakInvariantOptions;
use icu_segmenter::{GraphemeClusterSegmenter, WordSegmenter};

/// Byte offsets strictly inside `text` where the LSTM word segmenter puts a
/// word boundary (0 and `text.len()` are left out). Text outside the four
/// LSTM scripts gets the Unicode default word boundaries (UAX #29).
pub fn lstm_word_boundaries(text: &str) -> Vec<usize> {
    let segmenter = WordSegmenter::new_lstm(WordBreakInvariantOptions::default());
    segmenter
        .segment_str(text)
        .filter(|&offset| offset > 0 && offset < text.len())
        .collect()
}

/// Byte offsets strictly inside `text` where the dictionary word segmenter
/// puts a word boundary, the same shape as [`lstm_word_boundaries`].
///
/// The two segmenters err differently on Thai: the LSTM splits compounds and
/// loanwords (`อง|ศา` "degree", `หน้า|ต่าง` "window"), the dictionary splits
/// names it does not list (`ลลิต|า`). A boundary both put in the same place
/// is one neither got wrong in the sentences measured, so callers use the
/// agreement as "this boundary is sure" and never as the word list itself.
pub fn dictionary_word_boundaries(text: &str) -> Vec<usize> {
    let segmenter = WordSegmenter::new_dictionary(WordBreakInvariantOptions::default());
    segmenter
        .segment_str(text)
        .filter(|&offset| offset > 0 && offset < text.len())
        .collect()
}

/// Byte offsets strictly inside `text` that sit between two Han characters
/// the ICU dictionary segmenter keeps in one word (`程|序` in `修程序崩溃`).
/// Offsets next to anything other than Han on either side are never listed,
/// so Latin glue, kana and Hangul spacing are left to their own rules.
pub fn han_word_interior(text: &str) -> Vec<usize> {
    if !text.chars().any(is_han) {
        return Vec::new();
    }
    let boundaries: Vec<usize> = WordSegmenter::new_auto(WordBreakInvariantOptions::default())
        .segment_str(text)
        .collect();
    let mut out = Vec::new();
    let mut previous: Option<char> = None;
    for (offset, c) in text.char_indices() {
        if let Some(before) = previous
            && is_han(before)
            && is_han(c)
            && boundaries.binary_search(&offset).is_err()
        {
            out.push(offset);
        }
        previous = Some(c);
    }
    out
}

/// For each word of a run, whether the gap after it falls inside a Han word
/// ([`han_word_interior`] over the trimmed texts joined without separators).
/// The last entry is always `false`. Cue splitting asks this once per run.
pub fn han_word_interior_gaps<S: AsRef<str>>(texts: &[S]) -> Vec<bool> {
    let mut joined = String::new();
    let mut ends = Vec::with_capacity(texts.len());
    for text in texts {
        joined.push_str(text.as_ref().trim());
        ends.push(joined.len());
    }
    let interior = han_word_interior(&joined);
    ends.iter()
        .enumerate()
        .map(|(index, &end)| index + 1 < texts.len() && interior.binary_search(&end).is_ok())
        .collect()
}

/// CJK unified ideographs (with extensions and compatibility ideographs).
pub fn is_han(c: char) -> bool {
    matches!(c,
        '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}'
            | '\u{20000}'..='\u{2FA1F}' | '\u{30000}'..='\u{3134F}')
}

/// Number of extended grapheme clusters (user-perceived characters) in `text`.
pub fn grapheme_count(text: &str) -> usize {
    GraphemeClusterSegmenter::new()
        .segment_str(text)
        .filter(|&offset| offset > 0)
        .count()
}

/// The extended grapheme clusters of `text`, in order; concatenated they are
/// `text`. These are not words: callers use them as comparison keys only.
pub fn graphemes(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    for end in GraphemeClusterSegmenter::new().segment_str(text) {
        if end > start {
            out.push(&text[start..end]);
            start = end;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(text: &str) -> Vec<&str> {
        let mut out = Vec::new();
        let mut start = 0;
        for end in lstm_word_boundaries(text)
            .into_iter()
            .chain(std::iter::once(text.len()))
        {
            out.push(&text[start..end]);
            start = end;
        }
        out
    }

    #[test]
    fn thai_runs_split_into_words_and_rejoin_losslessly() {
        let text = "ลลิตาไม่ได้ยกเลิกการประชุม";
        let pieces = words(text);
        assert!(pieces.len() >= 4, "{pieces:?}");
        assert_eq!(pieces.concat(), text);
        // A tone mark or vowel sign never starts a word.
        for piece in &pieces[1..] {
            let first = piece.chars().next().unwrap();
            assert!(
                !matches!(first as u32, 0x0E31 | 0x0E34..=0x0E3A | 0x0E47..=0x0E4E),
                "{piece}"
            );
        }
    }

    #[test]
    fn dictionary_keeps_the_compounds_the_lstm_splits() {
        let text = "ต่ำกว่า5องศาให้ปิดหน้าต่าง";
        let lstm = lstm_word_boundaries(text);
        let dictionary = dictionary_word_boundaries(text);
        // `องศา` ("degree") and `หน้าต่าง` ("window") are one word each: the
        // LSTM cuts them, the dictionary does not.
        for word in ["องศา", "หน้าต่าง"] {
            let start = text.find(word).unwrap();
            let end = start + word.len();
            assert!(
                lstm.iter().any(|&b| b > start && b < end),
                "{word}: {lstm:?}"
            );
            assert!(!dictionary.iter().any(|&b| b > start && b < end), "{word}");
        }
        assert!(dictionary.contains(&text.find("ให้").unwrap()));
    }

    fn han_words(text: &str) -> String {
        let interior = han_word_interior(text);
        let mut out = String::new();
        for (offset, c) in text.char_indices() {
            if offset > 0 && !interior.contains(&offset) {
                out.push('|');
            }
            out.push(c);
        }
        out
    }

    #[test]
    fn han_word_interior_follows_the_cjk_dictionary() {
        assert_eq!(han_words("修程序崩溃"), "修|程序|崩溃");
        assert_eq!(han_words("代码审查"), "代码|审查");
        assert_eq!(han_words("想想汇报"), "想想|汇报");
        assert_eq!(han_words("每隔几周"), "每隔|几|周");
        // Only Han–Han gaps are reported: Latin, digits and punctuation are not.
        assert_eq!(
            han_words("用GPT-4o做代码审查，"),
            "用|G|P|T|-|4|o|做|代码|审查|，"
        );
        assert!(han_word_interior("Transformer").is_empty());
        let gaps = han_word_interior_gaps(&["修", "程", "序", "崩", "溃", " ok"]);
        assert_eq!(gaps, [false, true, false, true, false, false]);
    }

    #[test]
    fn graphemes_count_a_base_with_its_marks_once() {
        assert_eq!(grapheme_count("ที่"), 1);
        assert_eq!(grapheme_count("พื้นที่"), 3);
        assert_eq!(grapheme_count(""), 0);
        assert_eq!(grapheme_count("abc"), 3);
        assert_eq!(graphemes("พื้นที่"), ["พื้", "น", "ที่"]);
        assert!(graphemes("").is_empty());
    }
}
