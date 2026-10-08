//! FNV-1a 双指纹（逐字对拍 voice-ink `PipelineFingerprint.swift`）。
//!
//! - 内容指纹 [`fingerprint`]：哈希每个词的 text——文本编辑即失效；
//! - 结构指纹 [`id_fingerprint`]：只哈希词 id——润色 rebind 保 id 故存活，
//!   重转录换发全部 id 故失效。

use crate::doc::Word;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// 每个元素:UTF-8 逐字节 FNV-1a,之后 `hash ^= 0x1f; hash *= prime`
/// （最后一个元素之后也执行）——防止 ["ab","c"] 与 ["a","bc"] 撞哈希。
fn hash_items<'a, I: IntoIterator<Item = &'a str>>(items: I) -> u64 {
    let mut hash = FNV_OFFSET;
    for item in items {
        for &byte in item.as_bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        hash ^= 0x1f;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn base36(mut value: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_owned();
    }
    let mut output = Vec::new();
    while value > 0 {
        output.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    output.reverse();
    String::from_utf8(output).expect("base36 digits are ASCII")
}

/// 内容指纹：`count:firstId:lastId:base36(FNV-1a(每词 text))`；空词流为
/// `0:-:-:<hash>`。
pub fn fingerprint(words: &[Word]) -> String {
    let hash = hash_items(words.iter().map(|word| word.text.as_str()));
    format!(
        "{}:{}:{}:{}",
        words.len(),
        words.first().map_or("-", |word| word.id.as_str()),
        words.last().map_or("-", |word| word.id.as_str()),
        base36(hash)
    )
}

/// 结构指纹：`count:base36(FNV-1a(每词 id))`。
pub fn id_fingerprint(words: &[Word]) -> String {
    let hash = hash_items(words.iter().map(|word| word.id.as_str()));
    format!("{}:{}", words.len(), base36(hash))
}

/// 任意字符串序列的指纹：`count:base36`（版式串、产物头等；调用方自行排序）。
pub fn fingerprint_strings<I>(items: I) -> String
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    let mut hash = FNV_OFFSET;
    let mut count = 0_usize;
    for item in items {
        for &byte in item.as_ref().as_bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        hash ^= 0x1f;
        hash = hash.wrapping_mul(FNV_PRIME);
        count += 1;
    }
    format!("{count}:{}", base36(hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::Word;

    fn word(id: &str, text: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0: 0.0,
            t1: 0.1,
            text: text.to_owned(),
            sp: "s1".to_owned(),
            glue: false,
        }
    }

    #[test]
    fn content_fingerprint_changes_with_text_but_not_time() {
        let a = vec![word("g1.0", "大家"), word("g1.1", "好")];
        let mut b = a.clone();
        b[1].t0 = 9.0;
        assert_eq!(fingerprint(&a), fingerprint(&b));
        b[1].text = "坏".to_owned();
        assert_ne!(fingerprint(&a), fingerprint(&b));
    }

    #[test]
    fn id_fingerprint_survives_text_edits_but_not_reid() {
        let a = vec![word("g1.0", "大家"), word("g1.1", "好")];
        let mut b = a.clone();
        b[0].text = "改过".to_owned();
        assert_eq!(id_fingerprint(&a), id_fingerprint(&b));
        b[0].id = "w123-0".to_owned();
        assert_ne!(id_fingerprint(&a), id_fingerprint(&b));
    }

    #[test]
    fn separator_prevents_concatenation_collisions() {
        assert_ne!(
            fingerprint_strings(["ab", "c"]),
            fingerprint_strings(["a", "bc"])
        );
    }

    #[test]
    fn wire_formats_match_voiceink() {
        let words = vec![word("g1.0", "hello"), word("g2.3", "world")];
        assert!(fingerprint(&words).starts_with("2:g1.0:g2.3:"));
        assert!(id_fingerprint(&words).starts_with("2:"));
        assert_eq!(id_fingerprint(&words).split(':').count(), 2);
        assert_eq!(fingerprint(&[]), format!("0:-:-:{}", base36(FNV_OFFSET)));
        assert_eq!(
            fingerprint_strings(std::iter::empty::<&str>())
                .split(':')
                .count(),
            2
        );
    }
}
