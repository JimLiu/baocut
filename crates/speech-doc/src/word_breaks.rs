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
