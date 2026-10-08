//! Score a real answer with shared content validation and the production planner.
//!
//! argv:
//!   protocol
//!   atomize    (one text per stdin line → one JSON array of word atoms per line)
//!   atomize-words (same, with runs of Thai-like scripts split into words)
//!   dict-breaks (one text per stdin line → the dictionary segmenter's word
//!              boundaries as character offsets)
//!   render     old-input.html
//!   grade      old-input.html result.json old|lean manifest.json
//!   render-fix old-input.html grade.json
//!   grade-fix  old-input.html grade.json fix-result.json manifest.json
//!   replay     transcript.json lang page.out.txt…
//!
//! `replay` re-runs the production planner over the numbered lines of real
//! `bcut translate --align-fusion lines` page answers (matched to sentences by
//! their committed text) and prints, per line, what the lines draft yielded and
//! what the generic-cut fallback would yield — a diagnostic for bucketing
//! sentences that fell back to a dedicated align call.
//!
//! `render-fix` builds the second-turn page from a first-turn grade: sentences
//! without an accepted translation come back as fresh source lines; sentences
//! whose translation was accepted but came back too coarsely chunked for the
//! planner come back frozen (`= N text`) so the model only adds markers.
use serde_json::{Value, json};
use speech_doc::{
    align_block::{
        AlignCtx, AnchorAligner, AnchorWord, BilingualPlanInput, PlanOutcome, WordAligner,
        hinted_cut_candidates, plan_sentence, plan_sentence_at_cuts,
        plan_sentence_splitting_over_hard, target_cut_candidates,
    },
    filepipe::{
        TranslatePage, TranslateSection, align_edges::chunks_to_edges, lines, lines_translation,
        parse_translate_page, parse_translate_source, translate_html::validate_translation_quality,
    },
    split::target_cps_chars,
};
use std::{collections::BTreeMap, fs};

/// The old carrier renders `data-budget="整句≤42字"`; the shared parser drops it
/// on purpose (nothing validates it). The lean carrier sends it as `≤42`, so
/// the benchmark recovers the number from the very HTML the old arm was sent.
fn recover_budgets(page: &mut TranslatePage, html: &str) {
    let mut budgets: BTreeMap<String, usize> = BTreeMap::new();
    for tag in html.split("<p ").skip(1) {
        let Some(end) = tag.find('>') else { continue };
        let attrs = &tag[..end];
        let id = attrs
            .split_once("id=\"")
            .and_then(|(_, rest)| rest.split_once('"'))
            .map(|(id, _)| id.to_owned());
        let budget = attrs
            .split_once("data-budget=\"")
            .and_then(|(_, rest)| rest.split_once('"'))
            .map(|(text, _)| {
                text.chars()
                    .filter(char::is_ascii_digit)
                    .collect::<String>()
            })
            .and_then(|digits| digits.parse::<usize>().ok());
        if let (Some(id), Some(budget)) = (id, budget) {
            budgets.insert(id, budget);
        }
    }
    for section in &mut page.sections {
        for sentence in &mut section.sentences {
            if let Some(budget) = budgets.get(&sentence.id) {
                sentence.budget = Some(*budget);
            }
        }
    }
}

fn load_page(path: &str) -> Result<(TranslatePage, String), Box<dyn std::error::Error>> {
    let input = fs::read_to_string(path)?;
    let mut page = parse_translate_source(&input).ok_or("invalid source HTML")?;
    recover_budgets(&mut page, &input);
    restore_legacy_glue(&mut page);
    Ok((page, input))
}

/// The stored pages were rendered before transcript 0.5 and the rows carrier
/// has no glue flags: give each source word the flag a 0.5 reader gives a
/// pre-0.5 transcript, so the words join exactly as they did when the page
/// was rendered (only Korean per-syllable words are affected). Words of a
/// script written without spaces (Thai and the like, split into words by
/// `atomize-words`) take the flag from the sentence text, as the transcript
/// builder sets it.
fn restore_legacy_glue(page: &mut TranslatePage) {
    for section in &mut page.sections {
        for sentence in &mut section.sentences {
            let Some(alignment) = sentence.alignment.as_mut() else {
                continue;
            };
            if !alignment.source_glue.is_empty() {
                continue;
            }
            let words = &alignment.source_words;
            let script = speech_doc::atomize::script_glue_from_text(words, &sentence.source)
                .unwrap_or_else(|| vec![false; words.len()]);
            alignment.source_glue = (0..words.len())
                .map(|index| {
                    script[index]
                        || (index > 0
                            && speech_doc::atomize::legacy_glue(&words[index - 1], &words[index]))
                })
                .collect();
        }
    }
}

/// Chunks the planner needs for a translation of this length.
fn required_chunks(text: &str, lang: &str) -> usize {
    lines_translation::chunks_for_units(
        target_cps_chars(text, lang),
        &speech_doc::split::TransParams::for_lang(lang),
    )
}

/// Second-turn page: retry sentences as source, coarse sentences frozen.
fn fix_page(page: &TranslatePage, grade: &Value) -> TranslatePage {
    let retry: Vec<&str> = grade["retryIds"]
        .as_array()
        .map(|ids| ids.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    // Every accepted translation the planner could not row is asked again,
    // editable, with the previous text sizing the chunk hint (models asked to
    // re-mark a frozen text re-translate it anyway).
    let mut again: BTreeMap<&str, &str> = BTreeMap::new();
    for row in grade["rows"].as_array().into_iter().flatten() {
        if row["status"] == "needs-rewrite" {
            if let (Some(id), Some(text)) = (row["id"].as_str(), row["translation"].as_str()) {
                again.insert(id, text);
            }
        }
    }
    let mut out = TranslatePage {
        source_lang: page.source_lang.clone(),
        target_lang: page.target_lang.clone(),
        project_fingerprint: page.project_fingerprint.clone(),
        context_before: page.context_before.clone(),
        context_after: page.context_after.clone(),
        sections: Vec::new(),
    };
    for section in &page.sections {
        let mut kept = TranslateSection {
            id: section.id.clone(),
            speaker: section.speaker.clone(),
            sentences: Vec::new(),
        };
        for sentence in &section.sentences {
            if retry.contains(&sentence.id.as_str()) {
                kept.sentences.push(sentence.clone());
            } else if let Some(text) = again.get(sentence.id.as_str()) {
                let mut sentence = sentence.clone();
                sentence.existing_translation = Some((*text).to_owned());
                kept.sentences.push(sentence);
            }
        }
        if !kept.sentences.is_empty() {
            out.sections.push(kept);
        }
    }
    out
}

struct Graded {
    totals: BTreeMap<&'static str, usize>,
    rows: Vec<Value>,
}

fn grade_page(
    page: &TranslatePage,
    mode: &str,
    translations: &BTreeMap<String, String>,
    alignments: &BTreeMap<String, speech_doc::filepipe::TranslateAlignmentDraft>,
    records: &BTreeMap<usize, lines::Record>,
    manifest: &Value,
) -> Result<Graded, Box<dyn std::error::Error>> {
    let ctx = AlignCtx {
        source_lang: page.source_lang.clone(),
        lang: page.target_lang.clone(),
        protected_terms: Vec::new(),
    };
    let ids = page.sentence_ids();
    let mut totals: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut rows = Vec::new();
    for row in manifest["rows"].as_array().ok_or("manifest rows")? {
        let id = row["id"].as_str().ok_or("id")?;
        let Some(n) = ids.iter().position(|candidate| *candidate == id) else {
            continue;
        };
        let n = n + 1;
        let sentence = page.sentence(id).expect("page id");
        let text = match translations.get(id) {
            Some(text) => text.clone(),
            None if !sentence.editable => match &sentence.existing_translation {
                Some(text) => text.clone(),
                None => continue,
            },
            None => continue,
        };
        let text = text.as_str();
        let words: Vec<String> = serde_json::from_value(row["source_words"].clone())?;
        let mut input = BilingualPlanInput::new(
            words
                .iter()
                .enumerate()
                .map(|(i, text)| AnchorWord {
                    id: format!("w{i}"),
                    text: text.clone(),
                    t0: i as f64,
                    t1: i as f64 + 0.8,
                    glue: false,
                })
                .collect(),
            text.to_owned(),
            &page.source_lang,
            &page.target_lang,
        );
        // Use real word times when present; never pass synthetic timing off as
        // measured readability or final subtitle quality.
        let real_timing = if let Some(times) = row["word_times"].as_array() {
            if times.len() == input.words.len() {
                for (word, times) in input.words.iter_mut().zip(times) {
                    word.t0 = times[0]
                        .as_f64()
                        .or_else(|| times["t0"].as_f64())
                        .ok_or("t0")?;
                    word.t1 = times[1]
                        .as_f64()
                        .or_else(|| times["t1"].as_f64())
                        .ok_or("t1")?;
                }
                true
            } else {
                false
            }
        } else {
            false
        };
        input.protected_terms = sentence.required_targets.clone();
        let mut issue_list = Vec::new();
        let mut chunks = 0;
        let mut located = 0;
        let mut split_seams: Vec<&str> = Vec::new();
        let outcome = if mode == "lean" {
            if let Some(record) = records.get(&n) {
                let evidence = lines::evidence_with_pieces(
                    record,
                    &words,
                    &ctx,
                    &lines_translation::pieces(page, sentence),
                );
                chunks = evidence.chunks;
                located = evidence.located;
                issue_list = evidence.issues;
                let candidates =
                    target_cut_candidates(text, &input.lang, &input.params, &input.protected_terms);
                let allowed: Vec<_> = candidates
                    .iter()
                    .map(|c| c.pos)
                    .filter(|c| evidence.cuts.contains(c))
                    .collect();
                let hints = lines::cut_hints(record);
                let hinted = hinted_cut_candidates(
                    text,
                    &input.lang,
                    &input.params,
                    &input.protected_terms,
                    &hints,
                );
                // Same ladder as the engine: strict, then the in-place split of
                // an over-hard block when the model cuts were all admitted or
                // the model left cut hints (admitted or not).
                match plan_sentence_at_cuts(&evidence.edges, &input, &allowed) {
                    PlanOutcome::NeedsRewrite { .. }
                        if !allowed.is_empty() || !hints.is_empty() =>
                    {
                        let (outcome, extra) = plan_sentence_splitting_over_hard(
                            &evidence.edges,
                            &input,
                            &allowed,
                            &candidates,
                            &hinted,
                        );
                        split_seams = extra.iter().map(|cut| cut.seam.label()).collect();
                        outcome
                    }
                    outcome => outcome,
                }
            } else {
                plan_sentence_at_cuts(&[], &input, &[])
            }
        } else {
            let mut edges = Vec::new();
            if let Some(draft) = alignments.get(id) {
                chunks = draft.chunks.len();
                located = chunks;
                edges = chunks_to_edges(&draft.chunks, text);
            }
            edges.extend(AnchorAligner.align(
                &words.iter().map(String::as_str).collect::<Vec<_>>(),
                text,
                &ctx,
            ));
            plan_sentence(&edges, &input)
        };
        let (status, entry) = match outcome {
            PlanOutcome::Aligned(entry) => ("aligned", Some(entry)),
            PlanOutcome::SentenceLevel(entry) => ("sentence-level", Some(entry)),
            PlanOutcome::NeedsRewrite { .. } => ("needs-rewrite", None),
        };
        let required = required_chunks(text, &page.target_lang);
        let coarse = located < required;
        *totals.entry(status).or_default() += 1;
        *totals.entry("chunks").or_default() += chunks;
        *totals.entry("locatedChunks").or_default() += located;
        *totals.entry("sentencesWithAnchorIssues").or_default() +=
            usize::from(!issue_list.is_empty());
        *totals.entry("coarse").or_default() += usize::from(coarse && status == "needs-rewrite");
        rows.push(
            json!({"n":n,"id":id,"source":row["source"],"translation":text,"status":status,
            "chunks":chunks,"locatedChunks":located,"minChunks":required,"coarse":coarse,
            "frozen":!sentence.editable,"issues":issue_list,"realTiming":real_timing,
            "splitSeams":split_seams,"alignment":entry}),
        );
    }
    Ok(Graded { totals, rows })
}

/// Text equality that ignores the whitespace the joint tidy-up and AutoCorrect
/// may have changed between the page answer and the committed translation.
fn squeeze(text: &str) -> String {
    text.chars().filter(|ch| !ch.is_whitespace()).collect()
}

fn replay(
    transcript: &str,
    lang: &str,
    pages: &[String],
) -> Result<(), Box<dyn std::error::Error>> {
    let doc: Value = serde_json::from_str(&fs::read_to_string(transcript)?)?;
    let source_lang = doc["lang"].as_str().unwrap_or("en").to_owned();
    let trans = doc["trans"][lang].as_object().ok_or("trans[lang]")?;
    let aligns = doc["transAlign"][lang].as_object();
    // Sentence spans: a sentence id is `s-<first word id>`; each runs to the
    // next sentence's first word.
    let starts: std::collections::BTreeSet<&str> = trans
        .keys()
        .filter_map(|id| id.strip_prefix("s-"))
        .collect();
    let mut sentences: BTreeMap<String, Vec<AnchorWord>> = BTreeMap::new();
    let mut current: Option<String> = None;
    for word in doc["words"].as_array().ok_or("words")? {
        let id = word["id"].as_str().ok_or("word id")?;
        if starts.contains(id) {
            current = Some(format!("s-{id}"));
        }
        if let Some(sid) = &current {
            sentences.entry(sid.clone()).or_default().push(AnchorWord {
                id: id.to_owned(),
                text: word["text"].as_str().unwrap_or("").to_owned(),
                t0: word["t0"].as_f64().unwrap_or(0.0),
                t1: word["t1"].as_f64().unwrap_or(0.0),
                glue: false,
            });
        }
    }
    let by_text: BTreeMap<String, &str> = trans
        .iter()
        .filter_map(|(id, text)| text.as_str().map(|text| (squeeze(text), id.as_str())))
        .collect();
    let params = speech_doc::split::TransParams::for_lang(lang);
    let ctx = AlignCtx {
        source_lang: source_lang.clone(),
        lang: lang.to_owned(),
        protected_terms: Vec::new(),
    };
    let mut totals: BTreeMap<String, usize> = BTreeMap::new();
    for page in pages {
        for line in fs::read_to_string(page)?.lines() {
            let Some((prefix, _)) = line.split_once(' ') else {
                continue;
            };
            if prefix.parse::<usize>().is_err() {
                continue;
            }
            let Ok(record) = lines::parse(&line.replace(lines_translation::PIECE_MARK, "")) else {
                println!("{page}: {prefix}: syntax");
                continue;
            };
            let text = record.text();
            let Some(&sid) = by_text.get(&squeeze(&text)) else {
                println!("{page}: {prefix}: no committed sentence with this text");
                continue;
            };
            let Some(words) = sentences.get(sid) else {
                continue;
            };
            let aligner = aligns
                .and_then(|table| table.get(sid))
                .and_then(|entry| entry["aligner"].as_str())
                .unwrap_or("-");
            let word_texts: Vec<String> = words.iter().map(|word| word.text.clone()).collect();
            let committed = trans[sid].as_str().unwrap_or("");
            let Some(record) = lines_translation::rebase(&record, committed) else {
                println!("{sid} [{aligner}] rebase failed");
                *totals.entry("rebase-failed".to_owned()).or_default() += 1;
                continue;
            };
            let evidence = lines::evidence_with_pieces(&record, &word_texts, &ctx, &[]);
            let mut input =
                BilingualPlanInput::new(words.clone(), committed.to_owned(), &source_lang, lang);
            input.params = params;
            let allowed: Vec<_> = target_cut_candidates(
                committed,
                &input.lang,
                &input.params,
                &input.protected_terms,
            )
            .into_iter()
            .map(|c| c.pos)
            .filter(|c| evidence.cuts.contains(c))
            .collect();
            let name = |outcome: &PlanOutcome| match outcome {
                PlanOutcome::Aligned(_) => "aligned",
                PlanOutcome::SentenceLevel(_) => "sentence-level",
                PlanOutcome::NeedsRewrite { .. } => "needs-rewrite",
            };
            let strict = plan_sentence_at_cuts(&evidence.edges, &input, &allowed);
            let generic = plan_sentence(&evidence.edges, &input);
            // Round 5: the engine splits an over-hard block in place when the
            // model cuts were all admitted (round 7: or the model left cut
            // hints); report what that pass would give.
            let hints = lines::cut_hints(&record);
            let hinted = hinted_cut_candidates(
                committed,
                &input.lang,
                &input.params,
                &input.protected_terms,
                &hints,
            );
            let split = match &strict {
                PlanOutcome::NeedsRewrite { .. } if !allowed.is_empty() || !hints.is_empty() => {
                    let candidates = target_cut_candidates(
                        committed,
                        &input.lang,
                        &input.params,
                        &input.protected_terms,
                    );
                    let (outcome, extra) = plan_sentence_splitting_over_hard(
                        &evidence.edges,
                        &input,
                        &allowed,
                        &candidates,
                        &hinted,
                    );
                    format!("{}+{}", name(&outcome), extra.len())
                }
                _ => "-".to_owned(),
            };
            let key = format!(
                "{aligner} | strict={} split={split} generic={} issues={}",
                name(&strict),
                name(&generic),
                if evidence.issues.is_empty() {
                    "none"
                } else {
                    "some"
                }
            );
            *totals.entry(key).or_default() += 1;
            // Per chunk seam: is it a model-chosen cut the evidence kept, is it a
            // target cut candidate, and which objective seam-lint classes veto
            // it — separates evidence-side loss from filter-side veto.
            if !matches!(strict, PlanOutcome::Aligned(_)) {
                let target_chars: Vec<char> = committed.chars().collect();
                let candidates: Vec<usize> = target_cut_candidates(
                    committed,
                    &input.lang,
                    &input.params,
                    &input.protected_terms,
                )
                .into_iter()
                .map(|c| c.pos)
                .collect();
                let mut cursor = 0;
                let mut seams = Vec::new();
                let textual: Vec<&lines::Chunk> = record
                    .chunks
                    .iter()
                    .filter(|c| !c.text.is_empty())
                    .collect();
                for chunk in textual.iter().take(textual.len().saturating_sub(1)) {
                    cursor += chunk.text.chars().count();
                    let left: String = target_chars[..cursor].iter().collect();
                    let right: String = target_chars[cursor..].iter().collect();
                    let veto: Vec<String> =
                        speech_doc::seam::lint_pieces(&[&left, &right], lang, &params)
                            .into_iter()
                            .filter(speech_doc::seam::is_objective_blocking)
                            .map(|issue| format!("{:?}", issue.class))
                            .collect();
                    let units = |text: &str| target_cps_chars(text.trim(), lang);
                    seams.push(format!(
                        "@{cursor} {}{} {}|{} [{}]",
                        if evidence.cuts.contains(&cursor) {
                            "E"
                        } else {
                            "-"
                        },
                        if candidates.contains(&cursor) {
                            "C"
                        } else {
                            "-"
                        },
                        units(&left),
                        units(&right),
                        veto.join(",")
                    ));
                }
                println!(
                    "  seams: {}  hard={} units={}",
                    seams.join("  "),
                    params.hard,
                    target_cps_chars(committed, lang)
                );
            }
            if !aligner.starts_with("llm-lines") {
                println!(
                    "{sid} [{aligner}] chunks={}/{} cuts={} allowed={} issues={:?} strict={} generic={} :: {}",
                    evidence.located,
                    evidence.chunks,
                    evidence.cuts.len(),
                    allowed.len(),
                    evidence.issues,
                    name(&strict),
                    name(&generic),
                    text.chars().take(50).collect::<String>()
                );
            }
        }
    }
    println!("---");
    for (key, count) in totals {
        println!("{count:4}  {key}");
    }
    Ok(())
}

/// 文稿的读法转储：存盘的版式下派生的字幕行 / 段落 / 句子，再加一遍重新求解
/// 版式后的字幕行。两个版本的程序对同一份 transcript.json 各跑一遍，逐行比较，
/// 用来证明读法没变（或看清变在哪）。
fn project(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    use speech_doc::cue::{derive_cues, derive_paras};
    use speech_doc::doc::TranscriptDoc;
    use speech_doc::layout::{apply_balanced_cues, layout_fingerprint};
    use speech_doc::layout_profile::cue_params_for_doc;
    use speech_doc::sentence::derive_sentences;

    let doc = TranscriptDoc::from_json(&fs::read(path)?)?;
    let params = cue_params_for_doc(&doc);
    let cues = derive_cues(&doc, &params);
    for cue in &cues {
        println!(
            "{}",
            json!({"cue": cue.id, "start": cue.start, "end": cue.end, "sp": cue.sp,
                "words": cue.word_indices.len(), "text": cue.text(&doc)})
        );
    }
    for para in derive_paras(&doc, &cues) {
        println!(
            "{}",
            json!({"para": para.id, "sp": para.sp, "cues": para.cue_indices.len()})
        );
    }
    for sentence in derive_sentences(&doc, &cues) {
        println!(
            "{}",
            json!({"sentence": sentence.id, "words": sentence.word_indices.len(),
                "fp": sentence.src_fingerprint, "text": sentence.source_text})
        );
    }
    println!("{}", json!({"layoutFingerprint": layout_fingerprint(&doc)}));
    let mut relaid = doc.clone();
    relaid.auto_breaks.clear();
    let changed = apply_balanced_cues(&mut relaid, &params);
    println!("{}", json!({"relayoutChanged": changed}));
    for cue in derive_cues(&relaid, &params) {
        println!(
            "{}",
            json!({"relaidCue": cue.id, "words": cue.word_indices.len(), "text": cue.text(&relaid)})
        );
    }
    println!(
        "{}",
        json!({"words": doc.words.len(),
            "ids": speech_doc::fingerprint::id_fingerprint(&doc.words),
            "texts": speech_doc::fingerprint::fingerprint(&doc.words)})
    );
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("protocol") => {
            print!("{}", lines_translation::PROTOCOL);
            return Ok(());
        }
        Some("atomize-words") => {
            for line in std::io::stdin().lines() {
                let words: Vec<String> = speech_doc::atomize::atomize_words(&line?)
                    .into_iter()
                    .map(|(word, _)| word)
                    .collect();
                println!("{}", serde_json::to_string(&words)?);
            }
            return Ok(());
        }
        Some("atomize") => {
            for line in std::io::stdin().lines() {
                println!(
                    "{}",
                    serde_json::to_string(&speech_doc::atomize::atomize(&line?))?
                );
            }
            return Ok(());
        }
        Some("dict-breaks") => {
            // Character offsets (not bytes) where the dictionary segmenter
            // breaks, for scoring where piece marks and chunk starts fall.
            for line in std::io::stdin().lines() {
                let line = line?;
                let breaks: Vec<usize> = speech_doc::word_breaks::dictionary_word_boundaries(&line)
                    .into_iter()
                    .map(|byte| line[..byte].chars().count())
                    .collect();
                println!("{}", serde_json::to_string(&breaks)?);
            }
            return Ok(());
        }
        Some("project") if args.len() == 2 => {
            return project(&args[1]);
        }
        Some("replay") if args.len() >= 4 => {
            return replay(&args[1], &args[2], &args[3..]);
        }
        Some("render") if args.len() == 2 => {
            let (page, _) = load_page(&args[1])?;
            print!("{}", lines_translation::render(&page));
            return Ok(());
        }
        Some("render-fix") if args.len() == 3 => {
            let (page, _) = load_page(&args[1])?;
            let grade: Value = serde_json::from_str(&fs::read_to_string(&args[2])?)?;
            let fix = fix_page(&page, &grade);
            if fix.sentence_ids().is_empty() {
                return Err("nothing to fix".into());
            }
            print!("{}", lines_translation::render(&fix));
            return Ok(());
        }
        Some("grade-fix") if args.len() == 5 => {
            let (page, _) = load_page(&args[1])?;
            let grade: Value = serde_json::from_str(&fs::read_to_string(&args[2])?)?;
            let fix = fix_page(&page, &grade);
            let answer: Value = serde_json::from_str(&fs::read_to_string(&args[3])?)?;
            let output = answer["response"].as_str().ok_or("no successful answer")?;
            let manifest: Value = serde_json::from_str(&fs::read_to_string(&args[4])?)?;
            let result = lines_translation::parse(&fix, &lines_translation::render(&fix), output);
            let graded = grade_page(
                &fix,
                "lean",
                &result.translation.translations,
                &BTreeMap::new(),
                &result.records,
                &manifest,
            )?;
            let mut totals = graded.totals;
            totals.insert("syntaxOrPermissionIssues", result.issues.len());
            totals.insert("expectedSentences", fix.sentence_ids().len());
            totals.insert(
                "acceptedTranslations",
                result.translation.translations.len(),
            );
            totals.insert("translationRetries", result.translation.retry_ids.len());
            println!(
                "{}",
                serde_json::to_string_pretty(
                    &json!({"schema":"lean-carrier-grade/2","mode":"lean-fix","totals":totals,
                        "pageRejected":result.translation.page_rejected,"retryIds":result.translation.retry_ids,
                        "diagnostics":result.translation.diagnostics,"issues":result.issues,"rows":graded.rows})
                )?
            );
            return Ok(());
        }
        Some("grade") if args.len() == 5 => {}
        _ => return Err("see module docs for argv".into()),
    }
    let (page, input) = load_page(&args[1])?;
    let answer: Value = serde_json::from_str(&fs::read_to_string(&args[2])?)?;
    let output = answer["response"].as_str().ok_or("no successful answer")?;
    let mode = args[3].as_str();
    let manifest: Value = serde_json::from_str(&fs::read_to_string(&args[4])?)?;
    let mut extra: BTreeMap<&str, usize> = BTreeMap::new();
    let mut records = BTreeMap::new();
    let mut issues = Vec::new();
    let parsed = if mode == "lean" {
        let result = lines_translation::parse(&page, &lines_translation::render(&page), output);
        extra.insert("syntaxOrPermissionIssues", result.issues.len());
        issues = result.issues;
        records = result.records;
        result.translation
    } else {
        let mut result = parse_translate_page(&page, Some(&input), output);
        validate_translation_quality(&page, &mut result);
        result
    };
    let graded = grade_page(
        &page,
        mode,
        &parsed.translations,
        &parsed.alignments,
        &records,
        &manifest,
    )?;
    let mut totals = graded.totals;
    for (key, value) in extra {
        totals.insert(key, value);
    }
    totals.insert("expectedSentences", page.sentence_ids().len());
    totals.insert("acceptedTranslations", parsed.translations.len());
    totals.insert("translationRetries", parsed.retry_ids.len());
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"schema":"lean-carrier-grade/2","mode":mode,"totals":totals,"pageRejected":parsed.page_rejected,
                "retryIds":parsed.retry_ids,"diagnostics":parsed.diagnostics,"issues":issues,"rows":graded.rows})
        )?
    );
    Ok(())
}
