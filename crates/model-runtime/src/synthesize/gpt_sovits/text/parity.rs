//! 与上游 Python 前端（G2PW 关闭）的全量对拍。语料由 v2 仓库（`baocut-app`）的 `scripts/dev/gpt-sovits-text/` 的
//! `dump_golden.py`（golden.json）、`dump_en.py`（en_layers.json）、`dump_jieba.py`（jieba.json）
//! 导出，放在 `BCUT_GSV_GOLDEN_DIR` 下：
//!
//! ```text
//! BCUT_GSV_GOLDEN_DIR=… cargo test -p model-runtime --lib synthesize::gpt_sovits::text::parity -- --ignored
//! ```

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::LazyLock;

use serde_json::{Value, json};

use super::en;
use super::en_norm::{self, NumberArgs};
use super::error::PyError;
use super::gpb;
use super::jieba;
use super::langseg::{self, SegLang};
use super::split;
use super::symbols::{self, symbol_id};
use super::zh;

fn golden(name: &str) -> Value {
    let dir = std::env::var_os("BCUT_GSV_GOLDEN_DIR").expect("BCUT_GSV_GOLDEN_DIR");
    let path = PathBuf::from(dir).join(name);
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}

fn names(ids: &[u32]) -> String {
    ids.iter()
        .map(|&id| symbols::SYMBOLS.get(id as usize).copied().unwrap_or("?"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// 切句与中文段 norm_text / phones / word2ph。
#[test]
#[ignore = "needs BCUT_GSV_GOLDEN_DIR (golden.json / en_layers.json / jieba.json)"]
fn golden_split_and_zh_segments() {
    let cases = golden("golden.json");
    let unk = symbol_id("UNK").unwrap();
    let (mut split_ok, mut split_total, mut seg_ok, mut seg_total) = (0, 0, 0, 0);
    for case in cases.as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let text = case["text"].as_str().unwrap();
        let english = case["hint"] == "en";

        // 上游报错的 case 记为 `{"error": ...}`，这边应同样返回 Err
        let want: Option<Vec<String>> = serde_json::from_value(case["split"].clone()).ok();
        let got = split::pre_seg_text(&split::replace_consecutive_punctuation(text), english).ok();
        split_total += 1;
        if got == want {
            split_ok += 1;
        } else {
            println!("SPLIT {id}\n  want {want:?}\n  got  {got:?}");
        }

        let mut segments: Vec<&Value> = case["phones_whole"].as_array().into_iter().flatten().collect();
        for sentence in case["phones_split"].as_array().into_iter().flatten() {
            segments.extend(sentence.as_array().into_iter().flatten());
        }
        for segment in segments {
            if segment["lang"] != "zh" {
                continue;
            }
            let seg_text = segment["text"].as_str().unwrap();
            let want_norm = segment["norm_text"].as_str().unwrap();
            let want_phones: Vec<u32> = serde_json::from_value(segment["phones"].clone()).unwrap();
            let want_w2p: Vec<usize> = serde_json::from_value(segment["word2ph"].clone()).unwrap();
            let (phones, word2ph, norm) = zh::clean(seg_text).expect("zh clean");
            let phones: Vec<u32> = phones.iter().map(|phone| symbol_id(phone).unwrap_or(unk)).collect();
            seg_total += 1;
            if norm == want_norm && phones == want_phones && word2ph == want_w2p {
                seg_ok += 1;
                continue;
            }
            println!("ZH {id} {seg_text:?}");
            if norm != want_norm {
                println!("  norm want {want_norm:?}\n  norm got  {norm:?}");
            }
            if phones != want_phones {
                println!("  phones want {}\n  phones got  {}", names(&want_phones), names(&phones));
            }
            if word2ph != want_w2p {
                println!("  w2p want {want_w2p:?}\n  w2p got  {word2ph:?}");
            }
        }
    }
    println!("RESULT split {split_ok}/{split_total}, zh segments {seg_ok}/{seg_total}");
    assert_eq!(split_ok, split_total, "split mismatches");
    assert_eq!(seg_ok, seg_total, "zh segment mismatches");
}

/// jieba 分词、词性与搜索模式。
#[test]
#[ignore = "needs BCUT_GSV_GOLDEN_DIR (golden.json / en_layers.json / jieba.json)"]
fn jieba_matches_jieba_fast() {
    let cases = golden("jieba.json");
    let (mut checks, mut bad) = (0, 0);
    let mut by_kind = BTreeMap::<String, usize>::new();
    let mut check = |what: &str, text: &str, want: String, got: String| {
        checks += 1;
        if want != got {
            bad += 1;
            *by_kind.entry(what.to_owned()).or_default() += 1;
            if bad <= 20 {
                println!("JIEBA {what} {text:?}\n  want {want}\n  got  {got}");
            }
        }
    };
    for case in cases.as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let want: Vec<(String, String)> = serde_json::from_value(case["posseg"].clone()).unwrap();
        check("posseg", text, format!("{want:?}"), format!("{:?}", jieba::posseg(text)));
        let want: Vec<String> = serde_json::from_value(case["cut"].clone()).unwrap();
        check("cut", text, format!("{want:?}"), format!("{:?}", jieba::cut(text)));
        let want: Vec<String> = serde_json::from_value(case["search"].clone()).unwrap();
        check("search", text, format!("{want:?}"), format!("{:?}", jieba::cut_for_search(text)));
        for pair in case["word_search"].as_array().unwrap() {
            let word = pair[0].as_str().unwrap();
            let want: Vec<String> = serde_json::from_value(pair[1].clone()).unwrap();
            check(
                "word_search",
                word,
                format!("{want:?}"),
                format!("{:?}", jieba::cut_for_search(word)),
            );
        }
    }
    println!("RESULT jieba {}/{checks} {by_kind:?}", checks - bad);
    assert_eq!(bad, 0, "jieba mismatches");
}

static LAYERS: LazyLock<Value> = LazyLock::new(|| golden("en_layers.json"));

fn rows(layer: &str) -> &'static [Value] {
    LAYERS[layer].as_array().expect("layer").as_slice()
}

/// 上游结果：字符串或 `{"error": 异常类名}`。
fn render(got: Result<String, PyError>) -> Value {
    match got {
        Ok(text) => Value::String(text),
        Err(err) => json!({ "error": err.name() }),
    }
}

fn render_list(got: Result<Vec<String>, PyError>) -> Value {
    match got {
        Ok(list) => json!(list),
        Err(err) => json!({ "error": err.name() }),
    }
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_owned()).collect()
}

struct Tally {
    name: &'static str,
    ok: usize,
    total: usize,
    shown: usize,
}

impl Tally {
    fn new(name: &'static str) -> Self {
        Self {
            name,
            ok: 0,
            total: 0,
            shown: 0,
        }
    }

    fn check(&mut self, label: &str, want: &Value, got: Value) {
        self.total += 1;
        if *want == got {
            self.ok += 1;
        } else if self.shown < 15 {
            self.shown += 1;
            eprintln!("MISMATCH {} {label:?}\n  want {want}\n  got  {got}", self.name);
        }
    }

    fn finish(tallies: &[Tally]) {
        for tally in tallies {
            eprintln!("RESULT {} {}/{}", tally.name, tally.ok, tally.total);
        }
        assert!(tallies.iter().all(|t| t.ok == t.total));
    }
}

/// inflect 数字读法。
#[test]
#[ignore = "needs BCUT_GSV_GOLDEN_DIR (golden.json / en_layers.json / jieba.json)"]
fn en_layer_number_to_words() {
    let mut tally = Tally::new("ntw");
    let plain = NumberArgs::default();
    let noand = NumberArgs { andword: "", ..plain };
    let g2 = NumberArgs {
        group: 2,
        andword: "",
        zero: "oh",
        ..plain
    };
    for row in rows("ntw") {
        let s = row["s"].as_str().unwrap();
        // 上游先 int(s)，再把 int 传进 number_to_words（即 str(int)）
        let n = match s.trim_start_matches('0') {
            "" => "0",
            n => n,
        };
        tally.check(&format!("plain {s}"), &row["plain"], render(en_norm::number_to_words(n, plain)));
        tally.check(&format!("noand {s}"), &row["noand"], render(en_norm::number_to_words(n, noand)));
        tally.check(&format!("g2 {s}"), &row["g2"], render(en_norm::number_to_words(n, g2)));
        let ord_words = en_norm::number_to_words(n, plain).and_then(|words| en_norm::ordinal(&words));
        tally.check(&format!("ord_words {s}"), &row["ord_words"], render(ord_words));
        tally.check(&format!("ord_digits {s}"), &row["ord_digits"], render(en_norm::ordinal(s)));
        for suffix in ["st", "nd", "rd", "th"] {
            let got = en_norm::number_to_words(&format!("{s}{suffix}"), plain);
            tally.check(&format!("suffix {s}{suffix}"), &row["suffix"][suffix], render(got));
        }
    }
    Tally::finish(&[tally]);
}

/// 英文文本规范化。
#[test]
#[ignore = "needs BCUT_GSV_GOLDEN_DIR (golden.json / en_layers.json / jieba.json)"]
fn en_layer_normalize() {
    let (mut normalize, mut text_normalize) = (Tally::new("normalize"), Tally::new("text_normalize"));
    for row in rows("normalize") {
        let input = row["in"].as_str().unwrap();
        normalize.check(input, &row["normalize"], render(en_norm::normalize(input)));
        text_normalize.check(input, &row["text_normalize"], render(en_norm::text_normalize(input)));
    }
    Tally::finish(&[normalize, text_normalize]);
}

/// 分词、词性、wordsegment 与 GRU 预测。
#[test]
#[ignore = "needs BCUT_GSV_GOLDEN_DIR (golden.json / en_layers.json / jieba.json)"]
fn en_layer_tokens_tags_segments_predictions() {
    let mut tokenize = Tally::new("tokenize");
    for row in rows("tokenize") {
        let input = row["in"].as_str().unwrap();
        tokenize.check(input, &row["tokens"], json!(en::tokenize(input)));
    }
    let mut pos = Tally::new("pos");
    for row in rows("pos") {
        let tokens = strings(&row["tokens"]);
        pos.check(&tokens.join(" "), &row["tags"], json!(en::pos_tag(&tokens)));
    }
    let mut segment = Tally::new("segment");
    for row in rows("segment") {
        let input = row["in"].as_str().unwrap();
        segment.check(input, &row["out"], json!(en::segment(input)));
    }
    let mut predict = Tally::new("predict");
    for row in rows("predict") {
        let input = row["in"].as_str().unwrap();
        let label = format!("{input} margin={}", row["margin"]);
        predict.check(&label, &row["out"], json!(en::predict(input)));
    }
    Tally::finish(&[tokenize, pos, segment, predict]);
}

/// g2p_en 调用、GPT-SoVITS 的英文 g2p 与 clean_text。
#[test]
#[ignore = "needs BCUT_GSV_GOLDEN_DIR (golden.json / en_layers.json / jieba.json)"]
fn en_layer_g2p() {
    let (mut call, mut g2p, mut clean) = (Tally::new("call"), Tally::new("g2p"), Tally::new("clean"));
    for row in rows("g2p") {
        let (input, norm) = (row["in"].as_str().unwrap(), row["norm"].as_str().unwrap());
        call.check(norm, &row["call"], render_list(en::g2p_call(norm)));
        g2p.check(norm, &row["g2p"], render_list(en::g2p(norm)));
        let got = match en::clean_text(input) {
            Ok((phones, norm)) => {
                let ids: Vec<u32> = phones.iter().map(|p| symbol_id(p).unwrap()).collect();
                json!({ "phones": phones, "ids": ids, "norm": norm })
            }
            Err(err) => json!({ "error": err.name() }),
        };
        clean.check(input, &row["clean"], got);
    }
    Tally::finish(&[call, g2p, clean]);
}

/// 中英混排分段（规则 C）与逐段音素 id。
#[test]
#[ignore = "needs BCUT_GSV_GOLDEN_DIR (golden.json / en_layers.json / jieba.json)"]
fn langseg_and_text_phones() {
    let mut langseg_tally = Tally::new("langseg");
    for row in rows("langseg") {
        let input = row["in"].as_str().unwrap();
        let got = match langseg::zh_segments(input) {
            Ok(pairs) => json!(pairs.iter().map(|(lang, text)| json!([lang.as_str(), text])).collect::<Vec<_>>()),
            Err(err) => json!({ "error": err.name() }),
        };
        langseg_tally.check(input, &row["segs"], got);
    }
    let mut tallies = vec![langseg_tally];
    for (layer, mode) in [("gpb_zh", SegLang::Zh), ("gpb_en", SegLang::En)] {
        let mut tally = Tally::new(layer);
        for row in rows(layer) {
            let input = row["in"].as_str().unwrap();
            let got = match gpb::text_phones(input, mode) {
                Ok(segments) => json!({
                    "ids": segments.iter().flat_map(|seg| seg.ids.iter().copied()).collect::<Vec<_>>(),
                    "segs": segments
                        .iter()
                        .map(|seg| json!([seg.lang.as_str(), seg.text, seg.norm]))
                        .collect::<Vec<_>>(),
                }),
                Err(err) => json!({ "error": err.name() }),
            };
            tally.check(input, &row["out"], got);
        }
        tallies.push(tally);
    }
    Tally::finish(&tallies);
}
