//! Local, read-only replay. Input is the baseline collector's JSON; stdout is
//! machine-readable measurements and candidate payloads (may contain user text).
//! Run: cargo run -p bcut-flow-core --example lean_carrier_replay -- corpus.json
use serde::Deserialize;
use serde_json::{Value, json};
use speech_doc::{
    align_block::{AlignCtx, AnchorWord, minimal_monotonic_blocks, safe_boundaries},
    atomize::join_word_texts,
    filepipe::{
        AlignChunk,
        align_edges::{chunks_to_edges, chunks_to_endpoint_edges},
        lines,
    },
};
use std::{collections::BTreeMap, fs};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Corpus {
    calls: Vec<Call>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Call {
    project: String,
    kind: String,
    log_path: String,
    line: usize,
    input_chars: usize,
    output_chars: usize,
    source_rows: usize,
    failure_counts: Value,
    sentences: Vec<Sentence>,
}
#[derive(Deserialize)]
struct Sentence {
    id: String,
    source_words: Vec<String>,
    target: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).ok_or("expected corpus path")?;
    let corpus: Corpus = serde_json::from_str(&fs::read_to_string(path)?)?;
    let mut rows = Vec::new();
    let mut totals: BTreeMap<&str, usize> = BTreeMap::new();
    for call in corpus.calls {
        // Canonical Rust parsers own the membership contract. The collector is
        // only an inventory/snapshot source; unmarked text is not known-empty
        // affiliation and must not be counted as successfully resolved evidence.
        let log = fs::read_to_string(&call.log_path)?;
        let raw: Value =
            serde_json::from_str(log.lines().nth(call.line - 1).ok_or("log line missing")?)?;
        let payload = raw["user"].as_str().ok_or("log input missing")?;
        let answer = raw["response"].as_str().ok_or("log response missing")?;
        let canonical: BTreeMap<String, Vec<AlignChunk>> = if call.kind == "translate" {
            let page = speech_doc::filepipe::parse_translate_source(payload)
                .ok_or("invalid translate input")?;
            speech_doc::filepipe::parse_translate_page(&page, Some(payload), answer)
                .alignments
                .into_iter()
                .map(|(id, draft)| (id, draft.chunks))
                .collect()
        } else {
            let input = speech_doc::filepipe::parse_align_edges_input(payload)
                .ok_or("invalid align input")?;
            speech_doc::filepipe::parse_align_edges(&input, Some(payload), answer)
                .groups
                .into_iter()
                .filter(|g| !g.chunks.is_empty())
                .map(|g| (g.id, g.chunks))
                .collect()
        };
        let mut sentences = Vec::new();
        for (index, s) in call.sentences.iter().enumerate() {
            if s.source_words.is_empty() || !canonical.contains_key(&s.id) {
                *totals.entry("unannotatedRows").or_default() += 1;
                continue;
            }
            let chunks = canonical[&s.id].clone();
            let target: String = chunks.iter().map(|c| c.text.as_str()).collect();
            let full = chunks_to_edges(&chunks, &target);
            let ends = chunks_to_endpoint_edges(&chunks, &target);
            let cuts: Vec<_> = (1..target.chars().count()).collect();
            let full_safe = safe_boundaries(&full, &cuts, 0.75);
            let ends_safe = safe_boundaries(&ends, &cuts, 0.75);
            let source: Vec<_> = s
                .source_words
                .iter()
                .enumerate()
                .map(|(i, text)| AnchorWord {
                    id: format!("w{i}"),
                    text: text.clone(),
                    t0: i as f64,
                    t1: i as f64 + 0.8,
                    glue: false,
                })
                .collect();
            // Synthetic timing is identical on both sides, not a measured timing
            // quality score. This isolates the endpoint representation.
            let full_blocks = minimal_monotonic_blocks(&full, &source, &target, &cuts, 0.75);
            let end_blocks = minimal_monotonic_blocks(&ends, &source, &target, &cuts, 0.75);
            let record = lines::from_ordinals(index + 1, &s.source_words, &chunks);
            let encoded = lines::render(&record);
            let decoded = lines::parse(&encoded).map_err(|error| format!("{error:?}: {}", s.id))?;
            let roundtrip = decoded == record;
            let unknown = record
                .chunks
                .iter()
                .filter(|c| matches!(c.reference, lines::Reference::Unknown))
                .count();
            let located = record
                .chunks
                .iter()
                .zip(&chunks)
                .filter(
                    |(new, old)| match (old.ordinals.iter().min(), old.ordinals.iter().max()) {
                        (Some(&lo), Some(&hi)) => {
                            lines::resolve(&s.source_words, &new.reference) == Ok(Some(lo..hi + 1))
                        }
                        (None, None) => lines::resolve(&s.source_words, &new.reference) == Ok(None),
                        _ => false,
                    },
                )
                .count();
            let evidence = lines::evidence(
                &decoded,
                &s.source_words,
                &AlignCtx {
                    source_lang: "und".into(),
                    lang: "und".into(),
                    protected_terms: Vec::new(),
                },
            );
            *totals.entry("annotatedRows").or_default() += 1;
            *totals.entry("chunks").or_default() += chunks.len();
            *totals.entry("locatedChunks").or_default() += located;
            *totals.entry("unknownChunks").or_default() += unknown;
            *totals.entry("boundaryDifferences").or_default() +=
                usize::from(full_safe != ends_safe);
            *totals.entry("blockDifferences").or_default() +=
                usize::from(full_blocks != end_blocks);
            *totals.entry("roundtripFailures").or_default() += usize::from(!roundtrip);
            *totals.entry("sourceEdges").or_default() += full.len();
            *totals.entry("endpointEdges").or_default() += ends.len();
            sentences.push(json!({"n":index+1,"id":s.id,"chunks":chunks.len(),"locatedChunks":located,"unknownChunks":unknown,"roundtrip":roundtrip,"textMatchesLegacyTarget":target==s.target,"boundaryEqual":full_safe==ends_safe,"blocksEqual":full_blocks==end_blocks,"issues":evidence.issues,"safeCuts":evidence.cuts,"input":format!("{} {}",index+1,lines::escape(&join_word_texts(s.source_words.iter().map(String::as_str)),false)),"output":encoded}));
        }
        rows.push(json!({"project":call.project,"kind":call.kind,"logPath":call.log_path,"line":call.line,"oldInputChars":call.input_chars,"oldOutputChars":call.output_chars,"sourceRows":call.source_rows,"failureCounts":call.failure_counts,"sentences":sentences}));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"schema":"lean-carrier-replay/1","mode":"oracle-encoding-of-existing-membership","timing":"synthetic-identical-for-block-equivalence","usage":null,"totals":totals,"calls":rows})
        )?
    );
    Ok(())
}
