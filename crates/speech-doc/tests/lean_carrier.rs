use speech_doc::align_block::{
    AlignCtx, AlignEdge, AnchorWord, minimal_monotonic_blocks, safe_boundaries,
};
use speech_doc::filepipe::align_edges::{AlignChunk, chunks_to_edges, chunks_to_endpoint_edges};
use speech_doc::filepipe::lines::{self, Chunk, Issue, Record, Reference};

fn words(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_owned).collect()
}
fn ctx() -> AlignCtx {
    AlignCtx {
        source_lang: "en".into(),
        lang: "es".into(),
        protected_terms: Vec::new(),
    }
}

#[test]
fn arbitrary_membership_extrema_preserve_crossing_and_blocks() {
    // Includes overlapping, nested, noncontiguous, reversed, empty memberships,
    // all interior target candidates, and hard edges outside model membership.
    let src: Vec<_> = (0..5)
        .map(|i| AnchorWord {
            id: format!("w{i}"),
            text: format!("word{i}"),
            t0: i as f64,
            t1: i as f64 + 0.8,
            glue: false,
        })
        .collect();
    for a in 0..32 {
        for b in 0..32 {
            for c in 0..8 {
                let chunks: Vec<_> = [a, b, c]
                    .iter()
                    .zip(["abc", "def", "ghi"])
                    .map(|(&mask, text)| AlignChunk {
                        text: text.into(),
                        ordinals: (0..5).filter(|i| mask & (1 << i) != 0).collect(),
                    })
                    .collect();
                let mut full = chunks_to_edges(&chunks, "abcdefghi");
                let mut ends = chunks_to_endpoint_edges(&chunks, "abcdefghi");
                for hard in [
                    None,
                    Some(AlignEdge::hard(4, 0..2)),
                    Some(AlignEdge::hard(0, 7..9)),
                ] {
                    if let Some(hard) = hard {
                        full.push(hard.clone());
                        ends.push(hard);
                    }
                    for tau in [0.5, 0.75, 0.9] {
                        assert_eq!(
                            safe_boundaries(&full, &[1, 2, 3, 4, 5, 6, 7, 8], tau),
                            safe_boundaries(&ends, &[1, 2, 3, 4, 5, 6, 7, 8], tau)
                        );
                        assert_eq!(
                            minimal_monotonic_blocks(&full, &src, "abcdefghi", &[3, 6], tau),
                            minimal_monotonic_blocks(&ends, &src, "abcdefghi", &[3, 6], tau)
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn start_only_would_create_a_false_safe_cut() {
    let chunks = vec![
        AlignChunk {
            text: "Apaga ".into(),
            ordinals: vec![0, 3],
        },
        AlignChunk {
            text: "la luz.".into(),
            ordinals: vec![1, 2],
        },
    ];
    let target = "Apaga la luz.";
    assert!(safe_boundaries(&chunks_to_endpoint_edges(&chunks, target), &[6], 0.5).is_empty());
    assert_eq!(
        safe_boundaries(
            &[
                AlignEdge::soft(0, 0..5, 0.75),
                AlignEdge::soft(1, 6..12, 0.75)
            ],
            &[6],
            0.5
        ),
        vec![6]
    );
    let encoded = lines::from_ordinals(1, &words("Turn the light off."), &chunks);
    let decoded = lines::parse(&lines::render(&encoded)).unwrap();
    assert_eq!(decoded, encoded);
    assert!(
        lines::evidence(&decoded, &words("Turn the light off."), &ctx())
            .cuts
            .is_empty()
    );
}

#[test]
fn escaping_is_lossless_and_damage_is_never_stripped() {
    let record = Record {
        n: 42,
        rewrite: true,
        chunks: vec![Chunk {
            reference: Reference::Quote {
                left: "a|b\\..\n∅?⏸".into(),
                right: "路径\tעברית".into(),
            },
            text: "|literal| \\ .. \n\r\t⏸∅?".into(),
            marks: Vec::new(),
        }],
    };
    assert_eq!(lines::parse(&lines::render(&record)), Ok(record));
    for raw in [
        "1 |a..b|",
        "1 |a...b|text",
        "1 x|a..b|text",
        "1 |a..b text",
        "1 text\\x",
        "1 text\\",
        "1 ⏸",
        "0 text",
        "1 x\ny",
        "1 |a..b||c..d|",
    ] {
        assert_eq!(lines::parse(raw), Err(Issue::LinesSyntax), "{raw}");
    }
    assert_eq!(lines::parse("1   text  ").unwrap().text(), "  text  ");
    // Interior `..` parts and a dangling bar are slips, not new syntax.
    let slip = lines::parse("1 |a..b..c|text |").unwrap();
    assert_eq!(slip.chunks.len(), 1);
    assert_eq!(
        slip.chunks[0].reference,
        Reference::Quote {
            left: "a".into(),
            right: "c".into()
        }
    );
    assert_eq!(slip.chunks[0].text, "text ");
}

#[test]
fn quotes_do_not_guess_repetitions_or_partial_atoms() {
    let src = words("we can go and we can go");
    assert_eq!(
        lines::resolve(
            &src,
            &Reference::Quote {
                left: "we".into(),
                right: "go".into()
            }
        ),
        Err(Issue::AnchorAmbiguous)
    );
    assert_eq!(lines::quote_range(&src, 0..3), Reference::Unknown);
    assert_eq!(
        lines::resolve(
            &words("cat catalog"),
            &Reference::Quote {
                left: "cat".into(),
                right: "log".into()
            }
        ),
        Err(Issue::AnchorUnresolved)
    );
    // First target block may point to the end, then return to the beginning.
    let record = lines::parse("1 |go..go|Ve |we can go and..and|allí.").unwrap();
    assert!(lines::evidence(&record, &src, &ctx()).cuts.is_empty());
}

#[test]
fn complete_phrase_shorthand_supplies_both_endpoints() {
    let src = words("Turn the light off.");
    let parsed = lines::parse("1 |Turn..off|Apaga |the light|la luz.").unwrap();
    assert_eq!(
        lines::resolve(&src, &parsed.chunks[1].reference),
        Ok(Some(1..3))
    );
    assert!(lines::evidence(&parsed, &src, &ctx()).cuts.is_empty());
    let repeated = lines::parse("1 |we can go|vamos").unwrap();
    assert_eq!(
        lines::resolve(
            &words("we can go and we can go"),
            &repeated.chunks[0].reference
        ),
        Err(Issue::AnchorAmbiguous)
    );
    let decimal = lines::parse("1 |3.14|3,14").unwrap();
    assert_eq!(
        lines::resolve(&words("3.14"), &decimal.chunks[0].reference),
        Ok(Some(0..1))
    );
    // A text-less quote attaches its words to the previous chunk; a text-less
    // |∅| carries nothing and is dropped.
    let attached = lines::parse("1 |Yes|是的。|∅|").unwrap();
    assert_eq!(attached.chunks.len(), 1);
    let src = words("I pitched her on joining the best company in the world.");
    let record =
        lines::parse("1 |I..on|我劝她|joining..company|加入全球最好的公司。|in the world|")
            .unwrap();
    assert_eq!(record.text(), "我劝她加入全球最好的公司。");
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert_eq!(e.chunks, 2);
    assert_eq!(e.located, 2);
    // The second unit now spans "joining … world." (atoms 4..11): its far edge
    // sits on the last atom, not on "company".
    assert!(
        e.edges
            .iter()
            .any(|edge| edge.src == src.len() - 1 && !edge.hard)
    );
    assert_eq!(e.cuts, vec![3]);
}

#[test]
fn repeated_quotes_resolve_jointly_without_guessing_alone() {
    // "And" occurs twice (case-folded); alone the pair is ambiguous, but a single
    // chunk that must cover the sentence has one best reading.
    let src = words("And that's from a mix of US and Chinese origin models.");
    let record = lines::parse("1 |And..models|这来自美国和中国模型的混合。").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert!(e.edges.iter().any(|edge| edge.src == 0));
    assert!(e.edges.iter().any(|edge| edge.src == src.len() - 1));
    // Two chunks quoting the same short phrase: target order breaks the tie.
    let src = words("you know it is you know fine");
    let record = lines::parse("1 |you know|你知道，|it is|这|you know|你知道|fine|挺好。").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert_eq!(e.cuts.len(), 3, "{:?}", e.cuts);
    // Overlap forbids the long reading of the first chunk.
    let src = words("because you have to stay at the frontier and go past the frontier");
    let record =
        lines::parse("1 |because..frontier|因为你必须待在前沿，|and..frontier|而且要超越前沿。")
            .unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert_eq!(e.cuts, vec![10]);
    let ambiguous_edge = e
        .edges
        .iter()
        .find(|edge| edge.tgt.start == 0 && edge.src > 0);
    assert_eq!(ambiguous_edge.map(|edge| edge.src), Some(7));
    // A genuinely ambiguous chunk drops only itself; its neighbours keep cuts.
    let src = words("we can go and we can go and stop");
    let record = lines::parse("1 |we can go|走|we can go|走|and stop|停。").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    let record = lines::parse("1 |we can go|走|and stop|停|we can go|走。").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.cuts.len() < 2);
}

#[test]
fn unicode_and_opaque_tokens_preserve_atom_coordinates() {
    for (src, quote) in [
        (words("Turn off."), "off"),
        (words("ＣＡＦÉ."), "café"),
        (words("cafe\u{301}."), "café"),
        (words("שלום עולם"), "עולם"),
        (vec!["世".into(), "界。".into()], "界"),
    ] {
        let r = lines::resolve(
            &src,
            &Reference::Quote {
                left: quote.into(),
                right: quote.into(),
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(r.end, src.len());
    }
    for (src, quote) in [
        ("3.14", "314"),
        ("https://x.test/a?", "https://x.test/a"),
        ("my_id", "myid"),
    ] {
        assert_eq!(
            lines::resolve(
                &words(src),
                &Reference::Quote {
                    left: quote.into(),
                    right: quote.into()
                }
            ),
            Err(Issue::AnchorUnresolved)
        );
    }
    assert_eq!(
        lines::resolve(
            &words("!"),
            &Reference::Quote {
                left: "!".into(),
                right: "!".into()
            }
        ),
        Ok(Some(0..1))
    );
}

/// The multilingual acceptance run of 2026-10-01 (`hi-03`, `hi-05`, `hi-06`,
/// `hi-07`): every sentence ends in a danda attached to its last word, and the
/// model quotes the word without it. Sentence marks of every script come off a
/// quote's edge the way `.` and `。` always did; the ASCII list stays as it was.
#[test]
fn sentence_marks_of_any_script_come_off_a_quoted_word() {
    let hi = |text: &str| speech_doc::atomize::atomize(text);
    for (source, line) in [
        (
            "अमन ने तीन टिकटों के लिए 120 रुपये दिए, लेकिन इस कीमत में रात का खाना शामिल नहीं था।",
            "3 |अमन..दिए|Aman paid 120 rupees for three tickets, |लेकिन..था|but dinner was not included in this price.",
        ),
        // The repair answer: interior parts of a marker are a slip, the outer
        // ones are the endpoints.
        (
            "अमन ने तीन टिकटों के लिए 120 रुपये दिए, लेकिन इस कीमत में रात का खाना शामिल नहीं था।",
            "1 |अमन..दिए|Aman paid 120 rupees for three tickets, |लेकिन..नहीं..था|but dinner was not included in this price.",
        ),
        (
            "“पुष्टि हुई” के पास E-12 लिखा है, लेकिन पैकेट अभी तक भेजा नहीं गया है।",
            "5 |पुष्टि..है|\"Confirmed\" has E-12 written on it, |लेकिन..है|but the packet has not been sent yet.",
        ),
        (
            "“पुष्टि हुई” के पास E-12 लिखा है, लेकिन पैकेट अभी तक भेजा नहीं गया है।",
            "2 |“पुष्टि..है”|“Confirmed” has E-12 written next to it, |लेकिन..नहीं..है|but the packet has not been sent yet.",
        ),
        (
            "नेहा अर्जुन से पहले निकली थी, फिर भी वह उससे दस मिनट बाद पहुँची।",
            "6 |नेहा..थी|Neha left before Arjun, |फिर..पहुँची|yet she arrived ten minutes after him.",
        ),
        (
            "जब तक प्रबंधक दूसरे संस्करण को मंज़ूरी न दे, तब तक फ़ाइल सारा को मत भेजें।",
            "1 |जब..न दे|在经理批准另一个版本之前，|तब..भेजें|不要把文件发给萨拉。",
        ),
    ] {
        let src = hi(source);
        let record = lines::parse(line).unwrap();
        let e = lines::evidence(&record, &src, &ctx());
        assert!(e.issues.is_empty(), "{line}: {:?}", e.issues);
        assert_eq!(e.located, 2, "{line}");
        assert_eq!(e.cuts.len(), 1, "{line}");
    }
    // Other scripts' sentence and clause marks, opening ones included.
    for (source, quote) in [
        ("هل وصل الملف؟", "الملف"),
        ("وصل الملف، ثم", "الملف"),
        ("¿Qué pasó?", "Qué"),
        ("«Bonjour» dit-il", "Bonjour"),
        ("Ես եմ։", "եմ"),
        ("我们买了大米、面粉", "大米"),
    ] {
        let src = hi(source);
        assert!(
            lines::resolve(
                &src,
                &Reference::Quote {
                    left: quote.into(),
                    right: quote.into()
                }
            )
            .is_ok_and(|span| span.is_some()),
            "{source} / {quote}: {src:?}"
        );
    }
    // ASCII stays as it was: a sign that belongs to the word does not come
    // off, and a final curly quote (also an apostrophe) is not punctuation here.
    for (source, quote) in [
        ("50% off", "50"),
        ("#3 wins", "3"),
        ("students’ books", "students"),
    ] {
        assert_eq!(
            lines::resolve(
                &words(source),
                &Reference::Quote {
                    left: quote.into(),
                    right: quote.into()
                }
            ),
            Err(Issue::AnchorUnresolved),
            "{source} / {quote}"
        );
    }
}

#[test]
fn a_quote_of_unspaced_text_matches_a_run_of_atoms() {
    // Thai written without spaces between words: the atoms split only at the
    // quotation marks, and joining them back adds spaces the source never had.
    let src: Vec<String> =
        speech_doc::atomize::atomize("รหัสF-07ปรากฏข้างคำว่า“ยืนยันแล้ว”แต่ยังไม่ได้ส่งพัสดุ");
    assert_eq!(src.len(), 3, "{src:?}");
    let record = lines::parse(
        "1 |รหัสF-07ปรากฏข้างคำว่า“ยืนยันแล้ว”แต่ยังไม่ได้ส่งพัสดุ|The code F-07 is marked confirmed.",
    )
    .unwrap();
    assert_eq!(
        lines::resolve(&src, &record.chunks[0].reference),
        Ok(Some(0..3))
    );
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert_eq!(e.located, 1);
    // Whole atoms only, and only runs: a single atom never matches this way,
    // and a quote that stops inside an atom still does not resolve.
    for (source, quote) in [
        (src.clone(), "รหัสF-07ปรากฏข้างคำว่า“ยืนยัน"),
        (words("ab cd"), "a b"),
    ] {
        assert_eq!(
            lines::resolve(
                &source,
                &Reference::Quote {
                    left: quote.into(),
                    right: quote.into()
                }
            ),
            Err(Issue::AnchorUnresolved),
            "{quote}"
        );
    }
    // A stricter reading wins where one exists.
    assert_eq!(
        lines::resolve(
            &words("into the in to"),
            &Reference::Quote {
                left: "into".into(),
                right: "into".into()
            }
        ),
        Ok(Some(0..1))
    );
}

#[test]
fn a_quote_stopping_inside_a_segmented_word_widens_to_that_word() {
    // Thai cut into words by the segmenter (glued to each other): the model
    // cannot see where the segmenter put the boundaries, and the segmenter
    // sometimes keeps two words together. A quote edge inside such a word
    // takes the whole word.
    let sentence = "แม้พลอยจะออกเดินทางก่อนนัทแต่เธอก็มาถึงหลังเขาสิบนาที";
    let src = speech_doc::atomize::atomize_words(sentence);
    assert!(src.len() >= 8, "{src:?}");
    let quote = |left: &str, right: &str| Reference::Quote {
        left: left.into(),
        right: right.into(),
    };
    let holding = |needle: &str| {
        src.iter()
            .position(|(word, _)| word.contains(needle))
            .unwrap()
    };
    let start = holding("แม้");
    let name = holding("นัท");
    let after = holding("เธอ");
    // Ends inside (or at the end of) the word that holds `นัท`.
    assert_eq!(
        lines::resolve(&src, &quote("แม้พลอย", "ก่อนนัท")),
        Ok(Some(start..name + 1))
    );
    // Starts at `แต่`, which the segmenter may have kept with `นัท`.
    let but = holding("แต่");
    assert_eq!(
        lines::resolve(&src, &quote("แต่เธอ", "สิบนาที")),
        Ok(Some(but..src.len()))
    );
    assert!(but <= after);
    // The whole sentence still resolves at the strictest tier.
    assert_eq!(
        lines::resolve(&src, &quote(sentence, sentence)),
        Ok(Some(0..src.len()))
    );
    // Without the segmenter's glue nothing widens: one atom per phrase (an
    // older transcript) and words of a spaced script stay whole-word only.
    let phrase: Vec<String> = speech_doc::atomize::atomize(sentence);
    assert_eq!(
        lines::resolve(&phrase, &quote("แม้พลอย", "ก่อนนัท")),
        Err(Issue::AnchorUnresolved)
    );
    assert_eq!(
        lines::resolve(&words("catalog of books"), &quote("cat", "cat")),
        Err(Issue::AnchorUnresolved)
    );
}

#[test]
fn unknown_and_empty_do_not_invent_time_windows() {
    let src = words("hello world");
    let unknown = lines::parse("1 |hello..hello|hola |?|mundo").unwrap();
    assert!(!lines::evidence(&unknown, &src, &ctx()).issues.is_empty());
    assert!(lines::evidence(&unknown, &src, &ctx()).cuts.is_empty());
    let empty = lines::parse("1 |∅|ah |world..world|mundo").unwrap();
    let e = lines::evidence(&empty, &src, &ctx());
    assert!(e.issues.is_empty());
    assert!(e.cuts.is_empty());
}

#[test]
fn conflicting_hard_anchor_is_retained_and_vetoes_cuts() {
    let record = lines::parse("1 |bought..bought|Compró 42 |42..42|libros.").unwrap();
    let evidence = lines::evidence(&record, &words("bought 42 books"), &ctx());
    assert!(evidence.issues.contains(&Issue::AnchorConflict));
    assert!(evidence.edges.iter().any(|edge| edge.hard && edge.src == 1));
    assert!(evidence.cuts.is_empty());
}

#[test]
fn frozen_text_never_loses_negation_or_accepts_ambiguous_cuts() {
    for (echo, frozen) in [
        ("oui oui", "oui non oui"),
        ("go go", "go go go"),
        ("no", "not"),
        ("café", "cafe\u{301}"),
    ] {
        let input = lines::parse(&format!("1 {echo}")).unwrap();
        let (output, issues) = lines::freeze(&input, frozen);
        assert_eq!(output.text(), frozen);
        assert_eq!(issues, vec![Issue::FrozenCutAmbiguous]);
        assert!(
            lines::evidence(&output, &words("test"), &ctx())
                .cuts
                .is_empty()
        );
    }
    let input = lines::parse("1~ changed").unwrap();
    assert_eq!(
        lines::freeze(&input, "frozen").1,
        vec![Issue::RewriteForbidden]
    );
}

#[test]
fn no_cut_inside_a_grapheme_cluster() {
    let record = Record {
        n: 1,
        rewrite: false,
        chunks: vec![
            Chunk {
                reference: Reference::Quote {
                    left: "a".into(),
                    right: "a".into(),
                },
                text: "e".into(),
                marks: Vec::new(),
            },
            Chunk {
                reference: Reference::Quote {
                    left: "b".into(),
                    right: "b".into(),
                },
                text: "\u{301}".into(),
                marks: Vec::new(),
            },
        ],
    };
    assert!(
        lines::evidence(&record, &words("a b"), &ctx())
            .cuts
            .is_empty()
    );
}

/// A unique quote is the model's claim about its chunk's source hull; two
/// hulls that overlap (`|Turn..off|` next to `|the..the|`) are evidence of a
/// crossing and are both kept, so the only safe cut is the one every reading
/// allows. Dropping one of them (the earlier joint search did) reopened a
/// false-safe cut after `el`.
#[test]
fn overlapping_unique_quotes_keep_every_reference() {
    let src = words("Turn the light off now.");
    let record =
        lines::parse("1 |Turn..off|Apaga |the..the|el |light..light|foco |now..now|ahora.")
            .unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert_eq!(e.located, 4);
    assert_eq!(e.cuts, vec![14]);
}

/// A chunk with text but no source membership may translate words from
/// anywhere: while one exists no cut of the sentence is safe, not only the
/// two next to it. An empty affiliation carries no words and closes nothing.
#[test]
fn an_unlocated_chunk_closes_every_cut_of_the_sentence() {
    let src = words("alpha beta gamma omega");
    let record = lines::parse("1 |?|uno |alpha|dos |beta|tres |gamma|cuatro").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.contains(&Issue::AnchorUnresolved));
    assert!(e.cuts.is_empty(), "{:?}", e.cuts);
    let record = lines::parse("1 |zeta|uno |alpha|dos |beta|tres |gamma|cuatro").unwrap();
    assert!(lines::evidence(&record, &src, &ctx()).cuts.is_empty());
    let record = lines::parse("1 |alpha|uno |∅|eh |beta|dos |gamma..omega|tres").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert!(!e.cuts.is_empty());
}

/// A located chunk that a hard anchor contradicts (its text carries a number
/// whose source word lies outside the quoted hull) keeps its hull and the
/// anchor, both as edges: the hull still vetoes the distant cuts it crosses,
/// the anchor vetoes the cuts it crosses, and a cut beside the chunk that
/// neither crosses stays evidenced. (Dropping the hull admitted a cut between
/// two other chunks that the hull alone vetoed; marking the sentence
/// unlocated cost 8 of 508 replayed sentences a rewrite turn and gained none.)
#[test]
fn an_anchor_conflict_keeps_the_hull_and_the_anchor_as_edges() {
    let src = words("alpha beta gamma delta omega 42");
    let record =
        lines::parse("1 |alpha|uno |beta|dos |gamma|tres 42 |delta..omega|cuatro").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.contains(&Issue::AnchorConflict), "{:?}", e.issues);
    assert_eq!(e.located, 4);
    // `tres 42` owns `gamma` and `42`: the cut before it is safe, the cut
    // after it would put `42` left of `delta`.
    assert_eq!(e.cuts, vec![4, 8], "{:?}", e.cuts);
    // The conflicting chunk's hull reaches `gamma`, far from the `42` anchor:
    // without it the cut `dos|tres` would look safe.
    let src = words("42 alpha beta gamma delta");
    let record = lines::parse("1 |gamma|uno 42 |alpha|dos |beta|tres |delta|cuatro").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.contains(&Issue::AnchorConflict), "{:?}", e.issues);
    assert_eq!(e.cuts, vec![16], "{:?}", e.cuts);
    let src = words("alpha beta gamma delta omega 42");
    let record = lines::parse("1 |alpha|uno |beta|dos |gamma..42|tres 42").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert!(!e.cuts.is_empty());
}

/// Two adjacent hulls that end on the same word (or start on it) are both
/// kept as quoted: the shared endpoint is usually the honest report of a
/// reordering (the first chunk translates words from the end of the second
/// hull), so the only cut refused is the one between them. Clipping the outer
/// hull to the partition reading admitted a cut whose left line carried text
/// from the right line's time window (AMD `s-g107.0`: `完美地` is `perfectly`).
#[test]
fn shared_endpoint_quotes_keep_both_hulls_and_refuse_the_cut_between_them() {
    let src = words("I pitched her on joining the best company in the world.");
    let record = lines::parse("1 |I..world|我劝她|joining..world|加入全球最好的公司。").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert_eq!((e.located, e.overlapping), (2, 1));
    assert!(e.cuts.is_empty(), "{:?}", e.cuts);
    let record = lines::parse("1 |I..on|我劝她|I..world|加入全球最好的公司。").unwrap();
    let e = lines::evidence(&record, &src, &ctx());
    assert_eq!(e.overlapping, 1);
    assert!(e.cuts.is_empty(), "{:?}", e.cuts);
    let record = lines::parse("1 |Turn..off|Apaga |the light|la luz.").unwrap();
    let e = lines::evidence(&record, &words("Turn the light off."), &ctx());
    assert_eq!(e.overlapping, 1);
    assert!(e.cuts.is_empty());
    // Replayed sentences: the reordered adverbial stays with its chunk; the
    // cuts that no hull crosses are kept.
    let zh = AlignCtx {
        source_lang: "en".into(),
        lang: "zh-Hans".into(),
        protected_terms: Vec::new(),
    };
    let src = words(
        "Ditto to everything that she just said, because I think she described perfectly both the tremendous work and the opportunity.",
    );
    let record = lines::parse(
        "1 |Ditto..everything|她说的我全都同意，|that..said||because..work|因为我认为她完美地描述了|perfectly..work|那项了不起的工作|and..opportunity|以及其中的机遇。",
    )
    .unwrap();
    let e = lines::evidence(&record, &src, &zh);
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert_eq!(e.overlapping, 1);
    assert_eq!(e.cuts, vec![9, 29], "{:?}", e.cuts);
    let src =
        words("If every AI interaction has to complete in milliseconds, it becomes very hard");
    let record = lines::parse(
        "1 |If..milliseconds|如果每次 AI 交互都必须在毫秒内|complete..milliseconds|完成，|it..hard|那就很难",
    )
    .unwrap();
    let e = lines::evidence(&record, &src, &zh);
    assert!(e.issues.is_empty(), "{:?}", e.issues);
    assert_eq!(e.cuts, vec![20], "{:?}", e.cuts);
}

/// Every pair of quoted hulls over four words, against the oracle that sees
/// the full membership: no cut the evidence admits is unsafe under the
/// oracle, and every disjoint pair keeps its cut.
#[test]
fn two_quoted_hulls_never_admit_a_cut_the_full_membership_refuses() {
    let src = words("alpha beta gamma delta");
    let mut kept = 0;
    for a in 0..4 {
        for b in a..4 {
            for c in 0..4 {
                for d in c..4 {
                    let raw = format!("1 |{}..{}|uno |{}..{}|dos", src[a], src[b], src[c], src[d]);
                    let record = lines::parse(&raw).unwrap();
                    let e = lines::evidence(&record, &src, &ctx());
                    let chunks = [
                        AlignChunk {
                            text: "uno ".into(),
                            ordinals: (a..=b).collect(),
                        },
                        AlignChunk {
                            text: "dos".into(),
                            ordinals: (c..=d).collect(),
                        },
                    ];
                    let oracle = safe_boundaries(&chunks_to_edges(&chunks, "uno dos"), &[4], 0.75);
                    assert!(
                        e.cuts.iter().all(|cut| oracle.contains(cut)),
                        "{raw}: cuts {:?} oracle {:?}",
                        e.cuts,
                        oracle
                    );
                    assert_eq!(e.overlapping, usize::from(b >= c), "{raw}");
                    if b < c {
                        assert_eq!(e.cuts, vec![4], "{raw}");
                        kept += 1;
                    }
                }
            }
        }
    }
    assert_eq!(kept, 15);
}

/// A literal piece mark escapes like the other metadata signs.
#[test]
fn piece_mark_escapes_like_the_other_metadata_signs() {
    let record = lines::parse("1 |a..b|x \\¦ y").unwrap();
    assert_eq!(record.chunks[0].text, "x ¦ y");
    assert_eq!(lines::render(&record), "1 |a..b|x \\¦ y");
}

/// Echoed piece marks (`¦`) come out of the chunk text with the whitespace the
/// model put around them (one space between words of a spaced script, none
/// between wide characters) and stay on the record as cut hints; a literal
/// `\¦` is text; a mark before the first chunk, at a chunk edge or inside a
/// quote carries no hint.
#[test]
fn echoed_piece_marks_become_cut_hints_without_double_spaces() {
    let record = lines::parse("1 |a..b|Hello ¦ world|c..d| ¦ again \\¦ here ¦ |e..¦f|x¦y").unwrap();
    assert_eq!(record.chunks[0].text, "Hello world");
    assert_eq!(record.chunks[0].marks, vec![5]);
    assert_eq!(record.chunks[1].text.trim(), "again ¦ here");
    assert!(record.chunks[1].marks.is_empty());
    assert_eq!(
        record.chunks[2].reference,
        Reference::Quote {
            left: "e".into(),
            right: "f".into()
        }
    );
    assert_eq!(record.chunks[2].text, "xy");
    assert_eq!(record.chunks[2].marks, vec![1]);
    // Chunk boundaries and marks, as positions in the joined text.
    let text = record.text();
    let hints = lines::cut_hints(&record);
    let chars: Vec<char> = text.chars().collect();
    assert_eq!(hints.len(), 4, "{hints:?}");
    assert_eq!(chars[hints[0]], 'w');
    assert_eq!(chars[hints[3]], 'y');
    // Wide characters: the mark's spaces go with it.
    let record =
        lines::parse("3 ≥3 ¦ |a..b|我认为，软件 ¦ 以独特方式创造价值 ¦ 的空间将比以往更大。")
            .unwrap();
    assert_eq!(
        record.text(),
        "我认为，软件以独特方式创造价值的空间将比以往更大。"
    );
    assert_eq!(record.chunks[0].marks, vec![5, 14]);
    assert_eq!(lines::cut_hints(&record), vec![6, 15]);
}

/// The in-place split of an over-hard block takes the model's own cut before
/// a character-level seam: the PM boundary `有前景的|想法` is refused as a
/// candidate (dangling tail) but is a better display cut than `想|法`. Known
/// limit, pinned: the AMD block needs two cuts (`工作|和团队|看到…`), and a
/// split half keeps a single soft edge, so the second cut cannot be judged —
/// the block takes one cut, at a model boundary the lint refuses.
#[test]
fn a_model_cut_the_lint_refuses_still_beats_a_character_seam() {
    use speech_doc::align_block::{
        BilingualPlanInput, PlanOutcome, SplitCut, SplitSeam, hinted_cut_candidates,
        plan_sentence_at_cuts, plan_sentence_splitting_over_hard, target_cut_candidates,
    };
    let ctx = AlignCtx {
        source_lang: "en".into(),
        lang: "zh-Hans".into(),
        protected_terms: Vec::new(),
    };
    let split = |source: &str, line: &str| {
        let words = words(source);
        let record = lines::parse(line).unwrap();
        let evidence = lines::evidence(&record, &words, &ctx);
        let text = record.text();
        let input = BilingualPlanInput::new(
            words
                .iter()
                .enumerate()
                .map(|(i, text)| AnchorWord {
                    id: format!("w{i}"),
                    text: text.clone(),
                    t0: i as f64 * 0.3,
                    t1: i as f64 * 0.3 + 0.25,
                    glue: false,
                })
                .collect(),
            text.clone(),
            "en",
            "zh-Hans",
        );
        let candidates =
            target_cut_candidates(&text, &input.lang, &input.params, &input.protected_terms);
        let allowed: Vec<usize> = candidates
            .iter()
            .map(|c| c.pos)
            .filter(|c| evidence.cuts.contains(c))
            .collect();
        let hinted = hinted_cut_candidates(
            &text,
            &input.lang,
            &input.params,
            &input.protected_terms,
            &lines::cut_hints(&record),
        );
        assert!(matches!(
            plan_sentence_at_cuts(&evidence.edges, &input, &allowed),
            PlanOutcome::NeedsRewrite { .. }
        ));
        let (outcome, extra) = plan_sentence_splitting_over_hard(
            &evidence.edges,
            &input,
            &allowed,
            &candidates,
            &hinted,
        );
        let PlanOutcome::Aligned(entry) = outcome else {
            panic!("{outcome:?}");
        };
        (
            extra,
            entry
                .pieces
                .iter()
                .map(|piece| piece.text.clone())
                .collect::<Vec<_>>(),
        )
    };
    let (extra, pieces) = split(
        "To size up real problems and opportunities, build prototypes with AI in the loop, and learn to tell a promising idea from just a shiny one.",
        "26 |To..opportunities|去衡量真正的问题和机会，|build..loop|让 AI 参与其中做原型，|and..promising|并学会分辨一个有前景的|idea..one|想法和一个只是看着亮眼的点子。",
    );
    // 「有前景的 | 想法」以「的」收尾：悬垂尾是唯一放行的语病，落 flagged 档，
    // 这块没有干净缝所以仍然用它（第六轮这里是 `有前景的想|法`）。
    assert_eq!(
        extra,
        vec![SplitCut {
            pos: 36,
            seam: SplitSeam::HintedFlagged
        }]
    );
    assert_eq!(pieces[2], "并学会分辨一个有前景的");
    assert_eq!(pieces[3], "想法和一个只是看着亮眼的点子。");
    let (extra, pieces) = split(
        "This, of course, did not come up, but I suppose a good starting point, other than how this came together, is what opportunity did you see for your work and the team at World Labs work to be a part of AMD?",
        "27 |This..up|当然，当时没提到这个，|but..point|但我想一个好的起点，|other..together|除了这件事是怎么促成的，|is..work|就是你在 World Labs 的工作|and..Labs|和团队|work..AMD|看到什么机会，能成为 AMD 的一部分？",
    );
    // Both model boundaries inside the over-hard block are refused by the lint;
    // as refused hints they still outrank a character seam (§8.9), so the one
    // cut the block can take lands on the model's own `和团队 | 看到什么机会`.
    assert_eq!(
        extra,
        vec![SplitCut {
            pos: 55,
            seam: SplitSeam::HintedRefused
        }]
    );
    assert_eq!(pieces.len(), 5, "{pieces:?}");
    assert_eq!(pieces[4], "看到什么机会，能成为 AMD 的一部分？");
    // A single chunk with echoed marks: the hints are evidence enough to split
    // in place. The model's cut before `的空间` starts the next piece on a
    // bound particle, which the hint tolerance no longer admits, and the clean
    // comma seam wins regardless of fit (§8.8: the first line is four units,
    // the second exactly hard 20); round 7 cut at the hint instead.
    let (extra, pieces) = split(
        "I think there's going to be more room than ever for software that creates value in unique ways.",
        "1 |I think..room|我认为，软件 ¦ 以独特方式创造价值 ¦ 的空间将比以往更大。",
    );
    assert_eq!(
        extra,
        vec![SplitCut {
            pos: 4,
            seam: SplitSeam::Backed
        }]
    );
    assert_eq!(
        pieces,
        vec!["我认为，", "软件以独特方式创造价值的空间将比以往更大。"]
    );
}
