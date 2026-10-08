//! 词化落盘（阶段〇）：ASR rows → §18 词原子 transcript。
//!
//! 对拍 voice-ink `DocBuilder`：每行有真实词时间则单调钳进行窗，否则按
//! `wWeight` 字符权重合成；词再经 atomize 细分（CJK 逐字，子 id `~k`）；
//! 行级说话人下沉为词的 `sp`；说话人切换点吸附到自然停顿；收尾归一化 + 修复。

use std::collections::BTreeMap;

use crate::asr_rows::{RowIn, WordIn};

use crate::word_breaks::grapheme_count;

use crate::atomize::{
    atomize_words, ends_sentence, is_unspaced_script_char, script_glue_from_text, w_weight,
};
use crate::doc::{DocEngine, DocMedia, Speaker, TranscriptDoc, Word};
use crate::fingerprint::fingerprint;
use crate::timing::{normalize_doc_words, r2, word_timing_repair};

/// 说话人切换点吸附的最小停顿 / 搜索窗口（`DocBuilder.snapPause/snapWindow`）。
const SPEAKER_SNAP_MIN_PAUSE: f64 = 0.25;
const SPEAKER_SNAP_WINDOW: f64 = 1.0;
/// 说话人色相环（`DocBuilder.speakerHues`）。
const SPEAKER_HUES: [u32; 8] = [222, 152, 28, 282, 350, 82, 190, 330];

/// 空白切分（`TranscriptModel.tokenize`）。
fn tokenize(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_owned).collect()
}

/// 无真实词时间的兜底：行时长按 `wWeight` 比例切给各 token（`wordsFromSegments`）。
pub fn synthesize_words(text: &str, row_start: f64, row_end: f64) -> Vec<WordIn> {
    let tokens = tokenize(text);
    if tokens.is_empty() {
        return Vec::new();
    }
    let weights: Vec<f64> = tokens.iter().map(|token| w_weight(token)).collect();
    let total: f64 = weights.iter().sum::<f64>().max(1e-9);
    let duration = (row_end - row_start).max(0.01);
    let mut words = Vec::with_capacity(tokens.len());
    let mut accumulated = 0.0;
    for (token, weight) in tokens.into_iter().zip(weights) {
        let start = row_start + duration * (accumulated / total);
        accumulated += weight;
        let end = row_start + duration * (accumulated / total);
        words.push(WordIn {
            start: r2(start),
            end: r2(end),
            text: token,
        });
    }
    words
}

/// 词内原子化（`TranscriptModel.atomized`）：CJK 逐字、标点归前；多原子词按
/// `wWeight` 比例切时间，子 id `<id>~<k>`。
///
/// 泰、老挝、缅甸、高棉文字的词再按词切开（[`atomize_words`]），藏文在音节符
/// 处切开；词内后续各段带「贴前」标记（原文没有空格），时间按字素簇
/// （grapheme cluster）个数分摊。输入的第三项是这个转录词与前一个转录词之间的
/// 标记（[`script_glue_from_text`]），落在它的第一段上。不含这些文字的词与
/// 以前逐字节相同。
fn atomized(words: Vec<(String, WordIn, bool)>) -> Vec<(String, WordIn, bool)> {
    let mut output = Vec::with_capacity(words.len());
    for (id, word, glue) in words {
        let atoms = atomize_words(&word.text);
        if atoms.len() <= 1 {
            match atoms.into_iter().next() {
                Some((only, _)) => {
                    let mut fixed = word;
                    fixed.text = only;
                    output.push((id, fixed, glue));
                }
                None => output.push((id, word, glue)),
            }
            continue;
        }
        let by_graphemes = word.text.chars().any(is_unspaced_script_char);
        let weights: Vec<f64> = atoms
            .iter()
            .map(|(atom, _)| {
                if by_graphemes {
                    grapheme_count(atom).max(1) as f64
                } else {
                    w_weight(atom)
                }
            })
            .collect();
        let total: f64 = weights.iter().sum::<f64>().max(1e-9);
        let duration = (word.end - word.start).max(0.0);
        let mut accumulated = 0.0;
        let mut t0 = word.start;
        let count = atoms.len();
        for (k, (atom, atom_glue)) in atoms.into_iter().enumerate() {
            accumulated += weights[k];
            let t1 = if k == count - 1 {
                word.end
            } else {
                r2(word.start + duration * (accumulated / total))
            };
            let atom_id = if k == 0 {
                id.clone()
            } else {
                format!("{id}~{k}")
            };
            output.push((
                atom_id,
                WordIn {
                    start: t0,
                    end: t1.max(t0),
                    text: atom,
                },
                if k == 0 { glue } else { atom_glue },
            ));
            t0 = t1.max(t0);
        }
    }
    output
}

/// 一个已有时间的词按 [`atomized`] 的同一条规则拆成原子：CJK 逐字、标点归前，多原子词的时间按字符权重分摊，
/// 子 id `<id>~<k>`，`glue` 落在第一段上。返回 `(id, 文字, 开始, 结束, 贴前)`；不用拆的词原样一段。
///
/// 字幕把转写的词交给渲染内核时用它：逐字落盘之前的转写里还有多字的词，逐词动画也要逐字推进。
pub fn atomize_timed_word(
    id: &str,
    text: &str,
    start: f64,
    end: f64,
    glue: bool,
) -> Vec<(String, String, f64, f64, bool)> {
    let word = WordIn {
        start,
        end,
        text: text.to_owned(),
    };
    atomized(vec![(id.to_owned(), word, glue)])
        .into_iter()
        .map(|(id, word, glue)| (id, word.text, word.start, word.end, glue))
        .collect()
}

/// 行级说话人标签落成词 `sp` 之后要不要再动切换点。
///
/// 两种策略对应两种证据来源，不是"松/严"两档：
///
/// - [`SnapToPauses`](Self::SnapToPauses)：标签来自与文本分离的区间投影
///   （voice-ink `DocBuilder` 的传统形态、pyannote 一类"谁在什么时候发声"的
///   区间），边界只是时间上的最大重叠，落在词中间很常见——于是两遍吸附：
///   夹心短岛并回、切换点挪到 ±1s 内最优停顿/句末。
/// - [`RowAuthoritative`](Self::RowAuthoritative)：标签是联合 ASR+diarization
///   模型（MOSS）在生成文本时一并给出的**文本归属判决**，行边界只是时间戳有
///   slop。这时吸附只会帮倒忙：实测 7h 双人访谈里 Pass 2 把答句开头的"呃"、
///   句尾的"一个经历对"挪给了对方，Pass 1 在 MOSS 没出标点的分块里把 142 个
///   真实应答"嗯/哦是吗/当然"整行并进了对方的句子（无标点 ⇒ "前词非句末"
///   恒成立）。行级归属权威 ⇒ 一个词都不挪，时间重叠交给
///   [`word_timing_repair`] 钳时间。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SpeakerBoundaryPolicy {
    #[default]
    SnapToPauses,
    RowAuthoritative,
}

/// rows → §18 词原子 transcript。`engine.aligned_words` 表达引擎是否给出过
/// 真实词时间戳（合成路径照样满足全部时间约束，消费方无需区分）。
///
/// 说话人切换点按 [`SpeakerBoundaryPolicy::SnapToPauses`] 处理；行级标签来自
/// 联合模型（MOSS）时用 [`build_doc_with_policy`] 传
/// [`SpeakerBoundaryPolicy::RowAuthoritative`]。
pub fn build_doc(
    rows: &[RowIn],
    media: DocMedia,
    lang: &str,
    engine: DocEngine,
    created_at: Option<String>,
) -> TranscriptDoc {
    build_doc_with_policy(
        rows,
        media,
        lang,
        engine,
        created_at,
        SpeakerBoundaryPolicy::SnapToPauses,
    )
}

/// [`build_doc`] 的显式说话人边界策略形态。
pub fn build_doc_with_policy(
    rows: &[RowIn],
    media: DocMedia,
    lang: &str,
    engine: DocEngine,
    created_at: Option<String>,
    speaker_policy: SpeakerBoundaryPolicy,
) -> TranscriptDoc {
    let mut doc = TranscriptDoc::new(media, lang, engine);
    doc.created_at = created_at;
    let duration = doc.media.duration;

    let mut sorted: Vec<&RowIn> = rows
        .iter()
        .filter(|row| !row.text.trim().is_empty())
        .collect();
    sorted.sort_by(|a, b| a.start.total_cmp(&b.start));

    let mut speaker_ids: BTreeMap<String, String> = BTreeMap::new();
    let mut speaker_order: Vec<(String, String)> = Vec::new(); // (sp id, 显示名)

    for (row_index, row) in sorted.iter().enumerate() {
        let row_start = row.start.clamp(0.0, duration);
        let row_end = row.end.clamp(row_start, duration);
        let seg_id = format!("g{}", row_index + 1);

        let mut row_words: Vec<(String, WordIn, bool)> =
            match row.words.as_ref().filter(|words| !words.is_empty()) {
                Some(real) => {
                    // 单调钳进行窗（对齐器偶尔越界一格）。
                    let mut previous = row_start;
                    let timed: Vec<(String, WordIn)> = real
                        .iter()
                        .enumerate()
                        .map(|(column, word)| {
                            let t0 = r2(row_end.min(previous.max(word.start)));
                            let t1 = r2(row_end.min(t0.max(word.end)));
                            previous = t0;
                            (
                                format!("{seg_id}.{column}"),
                                WordIn {
                                    start: t0,
                                    end: t1,
                                    text: word.text.trim().to_owned(),
                                },
                            )
                        })
                        .filter(|(_, word)| !word.text.is_empty())
                        .collect();
                    // 引擎按词给了时间（强制对齐器对泰文一类先分词再对齐）：
                    // 词与词之间原文没有空格的，按行文本补「贴前」标记。
                    let texts: Vec<&str> =
                        timed.iter().map(|(_, word)| word.text.as_str()).collect();
                    let glue = script_glue_from_text(&texts, &row.text)
                        .unwrap_or_else(|| vec![false; timed.len()]);
                    timed
                        .into_iter()
                        .zip(glue)
                        .map(|((id, word), glue)| (id, word, glue))
                        .collect()
                }
                None => synthesize_words(row.text.trim(), row_start, row_end)
                    .into_iter()
                    .enumerate()
                    .map(|(column, word)| (format!("{seg_id}.{column}"), word, false))
                    .collect(),
            };
        row_words = atomized(row_words);
        if row_words.is_empty() {
            continue;
        }

        let sp = match row.speaker.as_deref() {
            Some(label) => speaker_ids
                .entry(label.to_owned())
                .or_insert_with(|| {
                    let id = format!("s{}", speaker_order.len() + 1);
                    speaker_order.push((id.clone(), label.to_owned()));
                    id
                })
                .clone(),
            None => {
                if speaker_order.is_empty() {
                    speaker_order.push(("s1".to_owned(), "S1".to_owned()));
                }
                speaker_order[0].0.clone()
            }
        };
        let first = doc.words.len();
        for (index, (id, word, glue)) in row_words.into_iter().enumerate() {
            doc.words.push(Word {
                id,
                t0: word.start,
                t1: word.end,
                text: word.text,
                sp: sp.clone(),
                // 行首词与上一行之间按行分开，不贴。
                glue: glue && index > 0,
            });
        }
        normalize_row(&mut doc.words[first..], row_start, row_end);
    }

    for (index, (id, name)) in speaker_order.into_iter().enumerate() {
        doc.speakers.insert(
            id,
            Speaker {
                name,
                hue: Some(SPEAKER_HUES[index % SPEAKER_HUES.len()]),
            },
        );
    }

    if speaker_policy == SpeakerBoundaryPolicy::SnapToPauses {
        snap_to_pauses(&mut doc.words);
    }
    word_timing_repair(&mut doc.words);

    doc.stages.asr = Some(fingerprint(&doc.words));
    doc.stages.asr_layout = Some(crate::layout::layout_fingerprint(&doc));
    doc
}

fn normalize_row(words: &mut [Word], row_start: f64, row_end: f64) {
    normalize_doc_words(words, row_start, row_end);
}

fn gap_at(words: &[Word], index: usize) -> f64 {
    (words[index].t0 - words[index - 1].t1).max(0.0)
}

/// 边界打分（`TranscriptBoundary.features`）：score = gap + 句末加成 0.6。
fn boundary_score(words: &[Word], index: usize) -> Option<f64> {
    if index == 0 || index >= words.len() {
        return None;
    }
    let gap = gap_at(words, index);
    let bonus = if ends_sentence(&words[index - 1].text) {
        0.6
    } else {
        0.0
    };
    Some(gap + bonus)
}

/// 说话人切换点吸附（`DocBuilder.snapToPauses` 两遍）。
fn snap_to_pauses(words: &mut [Word]) {
    if words.len() < 2 {
        return;
    }
    // Pass 1:同说话人夹心里的短外来岛吸收回去——[i, j) 是外来说话人,
    // 两侧同说话人;j-i < 4、总时长 ≤ 1.2s、岛前无停顿、前词非句末 ⇒ 并回。
    let mut i = 1;
    while i < words.len() {
        if words[i].sp == words[i - 1].sp {
            i += 1;
            continue;
        }
        let island_sp = words[i].sp.clone();
        let mut j = i;
        while j < words.len() && words[j].sp == island_sp {
            j += 1;
        }
        if j < words.len()
            && words[j].sp == words[i - 1].sp
            && j - i < 4
            && words[j - 1].t1 - words[i].t0 <= 1.2
            && gap_at(words, i) < SPEAKER_SNAP_MIN_PAUSE
            && !ends_sentence(&words[i - 1].text)
        {
            let host = words[i - 1].sp.clone();
            for word in &mut words[i..j] {
                word.sp = host.clone();
            }
        }
        i = j;
    }
    // Pass 2:剩余切换点在 ±1s 窗口内挑最优停顿/句末边界。
    let boundaries: Vec<usize> = (1..words.len())
        .filter(|&index| words[index].sp != words[index - 1].sp)
        .collect();
    for boundary in boundaries {
        let boundary_time = words[boundary].t0;
        if gap_at(words, boundary) >= SPEAKER_SNAP_MIN_PAUSE
            || ends_sentence(&words[boundary - 1].text)
        {
            continue; // 已经落在自然边界上
        }
        let mut best: Option<(usize, f64)> = None; // (候选切点, score)
        // 向左:候选 j,words[..j] 保持左侧说话人。
        let mut j = boundary;
        while j >= 1 && words[j - 1].sp == words[boundary - 1].sp {
            if (boundary_time - words[j].t0).abs() > SPEAKER_SNAP_WINDOW {
                break;
            }
            if j != boundary
                && let Some(score) = boundary_score(words, j)
                && best.is_none_or(|(_, best_score)| score > best_score)
            {
                best = Some((j, score));
            }
            if j == 1 {
                break;
            }
            j -= 1;
        }
        // 向右:候选 j,words[boundary..j] 归给左侧说话人。
        let mut j = boundary + 1;
        while j < words.len() && words[j].sp == words[boundary].sp {
            if (words[j].t0 - boundary_time).abs() > SPEAKER_SNAP_WINDOW {
                break;
            }
            if let Some(score) = boundary_score(words, j)
                && best.is_none_or(|(_, best_score)| score > best_score)
            {
                best = Some((j, score));
            }
            j += 1;
        }
        if let Some((snap, _)) = best {
            let accept = gap_at(words, snap) >= SPEAKER_SNAP_MIN_PAUSE
                || ends_sentence(&words[snap - 1].text);
            if !accept {
                continue;
            }
            if snap < boundary {
                let sp = words[boundary].sp.clone();
                for word in &mut words[snap..boundary] {
                    word.sp = sp.clone();
                }
            } else if snap > boundary {
                let sp = words[boundary - 1].sp.clone();
                for word in &mut words[boundary..snap] {
                    word.sp = sp.clone();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn media() -> DocMedia {
        DocMedia {
            id: None,
            path: Some("talk.wav".to_owned()),
            hash: "sha256-00".to_owned(),
            duration: 100.0,
            sample_rate: Some(16_000),
        }
    }

    fn engine() -> DocEngine {
        DocEngine {
            name: "test".to_owned(),
            version: None,
            aligned_words: false,
        }
    }

    #[test]
    fn synthesized_words_cover_row_and_stay_monotone() {
        let words = synthesize_words("hello there world", 1.0, 3.0);
        assert_eq!(words.len(), 3);
        assert_eq!(words.first().unwrap().start, 1.0);
        assert_eq!(words.last().unwrap().end, 3.0);
        for pair in words.windows(2) {
            assert!(pair[0].end <= pair[1].start + 1e-9);
        }
    }

    #[test]
    fn build_splits_cjk_rows_per_character_with_tilde_ids() {
        let doc = build_doc(
            &[RowIn::new(0.0, 2.0, "大家好")],
            media(),
            "zh",
            engine(),
            None,
        );
        doc.validate().unwrap();
        let ids: Vec<&str> = doc.words.iter().map(|word| word.id.as_str()).collect();
        assert_eq!(ids, vec!["g1.0", "g1.0~1", "g1.0~2"]);
        let texts: Vec<&str> = doc.words.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(texts, vec!["大", "家", "好"]);
        assert_eq!(doc.words[0].t0, 0.0);
        assert_eq!(doc.words[2].t1, 2.0);
    }

    #[test]
    fn timed_words_split_per_character_like_the_build() {
        let atoms = atomize_timed_word("w1", "大家好。", 1.0, 1.6, true);
        let ids: Vec<&str> = atoms.iter().map(|a| a.0.as_str()).collect();
        assert_eq!(ids, vec!["w1", "w1~1", "w1~2"]);
        let texts: Vec<&str> = atoms.iter().map(|a| a.1.as_str()).collect();
        assert_eq!(texts, vec!["大", "家", "好。"]);
        assert_eq!((atoms[0].2, atoms[2].3), (1.0, 1.6));
        for pair in atoms.windows(2) {
            assert!(pair[0].3 <= pair[1].2 + 1e-9);
        }
        assert!(atoms[0].4 && !atoms[1].4);
        // 西文的词与单字原样一段。
        assert_eq!(
            atomize_timed_word("w2", "Labs.", 0.0, 1.0, false),
            vec![("w2".into(), "Labs.".into(), 0.0, 1.0, false)]
        );
        assert_eq!(atomize_timed_word("w3", "了。", 0.0, 1.0, false).len(), 1);
    }

    fn joined(doc: &TranscriptDoc) -> String {
        crate::atomize::join_word_texts(doc.words.iter())
    }

    /// 泰文行（引擎只给行文本）：短语按词切开，词内后续各段带「贴前」标记，
    /// 时间在短语的时间窗里按字素簇分摊；读回来与行文本逐字相同，短语之间的
    /// 空格还在。
    #[test]
    fn build_splits_thai_phrases_into_glued_words() {
        let text = "ลลิตาไม่ได้ยกเลิกการประชุม แต่เลื่อนไปเป็นวันพฤหัสบดี";
        let doc = build_doc(&[RowIn::new(0.0, 6.0, text)], media(), "th", engine(), None);
        doc.validate().unwrap();
        assert_eq!(joined(&doc), text);
        assert!(doc.words.len() >= 6, "{:?}", doc.words);
        assert!(!doc.words[0].glue);
        let second_phrase = doc
            .words
            .iter()
            .position(|word| word.text.starts_with("แต่"))
            .unwrap();
        assert!(
            !doc.words[second_phrase].glue,
            "the space between phrases stays"
        );
        assert!(doc.words[1..second_phrase].iter().all(|word| word.glue));
        assert!(doc.words[1].id.starts_with("g1.0~"));
        for pair in doc.words.windows(2) {
            assert!(pair[0].t1 <= pair[1].t0 + 1e-9);
        }
    }

    /// 强制对齐器对泰文先分词再对齐，引擎按词给时间：词与词之间按行文本补
    /// 标记，时间用引擎给的。没有这一步时这些词各自独立、拼接时按词间补空格
    /// （`join_word_texts` 对两个不带标记的泰文词加一个空格）。
    #[test]
    fn build_glues_engine_timed_thai_words_from_the_row_text() {
        let text = "ลลิตาไม่ได้ยกเลิก การประชุม";
        let mut row = RowIn::new(0.0, 4.0, text);
        row.words = Some(
            [
                ("ลลิตา", 0.0, 0.8),
                ("ไม่ได้", 0.8, 1.4),
                ("ยกเลิก", 1.4, 2.2),
                ("การประชุม", 2.6, 4.0),
            ]
            .iter()
            .map(|(text, start, end)| WordIn {
                start: *start,
                end: *end,
                text: (*text).to_owned(),
            })
            .collect(),
        );
        assert_eq!(
            crate::atomize::join_word_texts(["ลลิตา", "ไม่ได้"]),
            "ลลิตา ไม่ได้",
            "unglued Thai words are joined with a space"
        );
        let doc = build_doc(&[row], media(), "th", engine(), None);
        doc.validate().unwrap();
        assert_eq!(joined(&doc), text);
        let first = |prefix: &str| {
            doc.words
                .iter()
                .find(|word| word.text.starts_with(prefix))
                .unwrap()
        };
        assert!(first("ไม่").glue);
        assert!(first("ยก").glue);
        assert!(!first("การ").glue);
        assert_eq!(first("การ").t0, 2.6);
    }

    /// 不含这些文字的行与以前逐字节相同：没有标记。
    #[test]
    fn build_leaves_other_scripts_unglued() {
        for (text, lang) in [
            ("hello there, world", "en"),
            ("大家好，今天", "zh"),
            ("저는 내일 아이폰을 샀다.", "ko"),
            ("اشترينا 2.5 كيلوغرام من الأرز،", "ar"),
            ("मैंने कल किताब पढ़ी।", "hi"),
        ] {
            let doc = build_doc(&[RowIn::new(0.0, 3.0, text)], media(), lang, engine(), None);
            assert!(doc.words.iter().all(|word| !word.glue), "{text}");
        }
    }

    /// 韩文按空格成词：一个어절一个词，不拆音节，也不带「贴前」标记；读回来
    /// 空格都在。
    #[test]
    fn build_keeps_korean_rows_one_word_per_space_delimited_unit() {
        let doc = build_doc(
            &[RowIn::new(0.0, 3.0, "저는 내일 아이폰을 샀다.")],
            media(),
            "ko",
            engine(),
            None,
        );
        doc.validate().unwrap();
        let texts: Vec<&str> = doc.words.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(texts, vec!["저는", "내일", "아이폰을", "샀다."]);
        assert!(doc.words.iter().all(|word| !word.glue));
        assert_eq!(
            crate::atomize::join_word_texts(doc.words.iter()),
            "저는 내일 아이폰을 샀다."
        );
        let json = serde_json::to_vec(&doc).unwrap();
        let read = TranscriptDoc::from_json(&json).unwrap();
        assert_eq!(read.words, doc.words);
    }

    #[test]
    fn build_assigns_row_column_ids_speakers_and_hues() {
        let mut row_a = RowIn::new(0.0, 2.0, "hello there");
        row_a.speaker = Some("S1".to_owned());
        let mut row_b = RowIn::new(3.0, 5.0, "good bye");
        row_b.speaker = Some("S2".to_owned());
        let doc = build_doc(&[row_a, row_b], media(), "en", engine(), None);
        doc.validate().unwrap();
        assert_eq!(doc.words[0].id, "g1.0");
        assert_eq!(doc.words[2].id, "g2.0");
        assert_eq!(doc.words[0].sp, "s1");
        assert_eq!(doc.words[2].sp, "s2");
        assert_eq!(doc.speakers["s1"].hue, Some(222));
        assert_eq!(doc.speakers["s2"].hue, Some(152));
        assert!(doc.stages.asr.is_some());
        assert!(doc.stages.asr_layout.is_some());
    }

    #[test]
    fn build_without_speakers_uses_constant_s1() {
        let doc = build_doc(
            &[RowIn::new(0.0, 1.0, "hi there")],
            media(),
            "en",
            engine(),
            None,
        );
        doc.validate().unwrap();
        assert!(doc.words.iter().all(|word| word.sp == "s1"));
    }

    #[test]
    fn real_word_times_are_kept_and_clamped_into_row() {
        let mut row = RowIn::new(1.0, 2.0, "hello world");
        row.words = Some(vec![
            WordIn {
                start: 0.8,
                end: 1.5,
                text: "hello".to_owned(),
            },
            WordIn {
                start: 1.5,
                end: 2.6,
                text: "world".to_owned(),
            },
        ]);
        let doc = build_doc(&[row], media(), "en", engine(), None);
        doc.validate().unwrap();
        assert!(doc.words[0].t0 >= 1.0);
        assert!(doc.words[1].t1 <= 2.0 + 1e-9);
    }

    #[test]
    fn short_foreign_island_is_absorbed() {
        // A 的词流中夹了一个紧贴的 B 词(短、无停顿、前词非句末)⇒ 吸收回 A。
        let mut row_a = RowIn::new(0.0, 2.0, "one two");
        row_a.speaker = Some("A".to_owned());
        let mut row_b = RowIn::new(2.0, 2.4, "blip");
        row_b.speaker = Some("B".to_owned());
        let mut row_c = RowIn::new(2.4, 4.0, "three four");
        row_c.speaker = Some("A".to_owned());
        let doc = build_doc(&[row_a, row_b, row_c], media(), "en", engine(), None);
        assert!(doc.words.iter().all(|word| word.sp == "s1"));
    }

    #[test]
    fn speaker_boundary_snaps_to_nearby_pause() {
        let mut row_a = RowIn::new(0.0, 2.0, "one two");
        row_a.speaker = Some("A".to_owned());
        row_a.words = Some(vec![
            WordIn {
                start: 0.0,
                end: 1.0,
                text: "one".to_owned(),
            },
            WordIn {
                start: 1.7,
                end: 2.0,
                text: "two".to_owned(),
            }, // 1.0→1.7 停顿
        ]);
        let mut row_b = RowIn::new(2.0, 6.0, "three four five six seven");
        row_b.speaker = Some("B".to_owned());
        let doc = build_doc(&[row_a, row_b], media(), "en", engine(), None);
        // "two" 紧贴 "three"(gap 0),切点吸附到 0.7s 停顿,"two" 划给 B。
        assert_eq!(doc.words[1].text, "two");
        assert_eq!(doc.words[1].sp, doc.words[2].sp);
    }

    /// 词流按 `sp` 分段后的 `(说话人, 拼接文本)` 序列。
    fn turns(doc: &TranscriptDoc) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = Vec::new();
        for word in &doc.words {
            match out.last_mut() {
                Some((sp, text)) if *sp == word.sp => text.push_str(&word.text),
                _ => out.push((word.sp.clone(), word.text.clone())),
            }
        }
        out
    }

    /// 逐字等分时间的 CJK 行（MOSS 的词时间戳形态）。
    fn cjk_row(start: f64, end: f64, text: &str, speaker: &str) -> RowIn {
        let chars: Vec<char> = text.chars().collect();
        let step = (end - start) / chars.len() as f64;
        let mut row = RowIn::new(start, end, text);
        row.speaker = Some(speaker.to_owned());
        row.words = Some(
            chars
                .iter()
                .enumerate()
                .map(|(index, character)| WordIn {
                    start: start + step * index as f64,
                    end: start + step * (index + 1) as f64,
                    text: character.to_string(),
                })
                .collect(),
        );
        row
    }

    /// 夹具取自 MOSS 7h 双人访谈的原始行（`asr-rows.json` 719–725s）：
    /// 问句"当时打什么游戏"与答句"呃很多啊…"之间只有 0.19s，而"呃"之后有
    /// 0.48s 停顿。区间投影策略会把切点吸附到那个停顿、把答句开头的"呃"
    /// 挪给提问者；行级权威策略一个词都不挪。
    #[test]
    fn row_authoritative_policy_keeps_the_answer_opening_filler_with_the_answerer() {
        let question = cjk_row(718.14, 719.22, "当时打什么游戏", "S01");
        let mut answer = cjk_row(719.41, 724.99, "呃很多啊打DOTA啊什么的", "S02");
        // "呃" 之后 0.48s 停顿。
        let words = answer.words.as_mut().unwrap();
        words[0].end = 719.41;
        words[1].start = 719.89;
        let rows = vec![question, answer];
        let media = DocMedia {
            duration: 800.0,
            ..media()
        };

        let snapped = build_doc(&rows, media.clone(), "zh", engine(), None);
        assert_eq!(
            turns(&snapped),
            vec![
                ("s1".to_owned(), "当时打什么游戏呃".to_owned()),
                ("s2".to_owned(), "很多啊打DOTA啊什么的".to_owned()),
            ],
            "区间投影策略把答句开头的语气词吸附给了提问者（回归锁：既有行为）"
        );

        let authoritative = build_doc_with_policy(
            &rows,
            media,
            "zh",
            engine(),
            None,
            SpeakerBoundaryPolicy::RowAuthoritative,
        );
        authoritative.validate().unwrap();
        assert_eq!(
            turns(&authoritative),
            vec![
                ("s1".to_owned(), "当时打什么游戏".to_owned()),
                ("s2".to_owned(), "呃很多啊打DOTA啊什么的".to_owned()),
            ]
        );
    }

    /// 同一夹具 154s 处：MOSS 没出标点的分块里，S02 长句中间夹着 S01 的一个
    /// "嗯"（0.31s、两侧间隙 0.13s / 0.01s）。Pass 1 的"前词非句末"在无标点块
    /// 里恒成立，会把这个真实应答整行并进 S02；行级权威策略保留它。
    #[test]
    fn row_authoritative_policy_keeps_backchannel_rows_in_unpunctuated_chunks() {
        let rows = vec![
            cjk_row(151.0, 154.57, "呃NYU其实确实做得很不错", "S02"),
            cjk_row(154.70, 155.01, "嗯", "S01"),
            cjk_row(155.02, 158.0, "但另一方面NYU还有很强的电影学院", "S02"),
        ];
        let media = DocMedia {
            duration: 200.0,
            ..media()
        };
        let snapped = build_doc(&rows, media.clone(), "zh", engine(), None);
        assert!(
            snapped.words.iter().all(|word| word.sp == "s1"),
            "回归锁：区间投影策略吸收无标点块里的应答岛（既有行为）"
        );

        let authoritative = build_doc_with_policy(
            &rows,
            media,
            "zh",
            engine(),
            None,
            SpeakerBoundaryPolicy::RowAuthoritative,
        );
        let turned = turns(&authoritative);
        assert_eq!(turned.len(), 3, "{turned:?}");
        assert_eq!(turned[1], ("s2".to_owned(), "嗯".to_owned()));
    }

    /// 同一夹具 742s 处：MOSS 相邻行在时间上重叠（S02 行到 742.51，S01 行从
    /// 742.30 起）。行级权威策略只钳时间，不把重叠区的词划给对方。
    #[test]
    fn row_authoritative_policy_resolves_overlap_by_time_not_by_relabeling() {
        let rows = vec![
            cjk_row(737.41, 742.51, "这样的一个一个经历对", "S02"),
            cjk_row(742.30, 747.14, "哦所以现在您的人生高光时刻", "S01"),
        ];
        let media = DocMedia {
            duration: 800.0,
            ..media()
        };
        let doc = build_doc_with_policy(
            &rows,
            media,
            "zh",
            engine(),
            None,
            SpeakerBoundaryPolicy::RowAuthoritative,
        );
        doc.validate().unwrap();
        assert_eq!(
            turns(&doc),
            vec![
                ("s1".to_owned(), "这样的一个一个经历对".to_owned()),
                ("s2".to_owned(), "哦所以现在您的人生高光时刻".to_owned()),
            ]
        );
        for pair in doc.words.windows(2) {
            assert!(
                pair[0].t1 <= pair[1].t0 + 1e-9,
                "{:?} → {:?}",
                pair[0],
                pair[1]
            );
        }
    }
}
