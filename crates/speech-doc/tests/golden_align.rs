//! 对齐 golden 集的加载、约束校验与 `AnchorAligner` 基线（计划 M0.1）。
//!
//! 这里是**唯一**做文件 I/O 的一侧：库代码只提供
//! [`speech_doc::golden::GoldenFile::from_str`] 与
//! [`speech_doc::metrics`] 的纯函数。
//!
//! 校验：schema、tag 合法、bead 两侧连续全覆盖且单调、硬锚落在自己的 bead 内、
//! `sentenceId` 是对应 `examples/<project>.bcut/transcript.json` 真实派生的句、
//! `sourceWords` 与该句词文本逐一相等。
//!
//! 基线：对每条用例用 [`AnchorAligner`] 产出对齐边，再走
//! [`minimal_monotonic_blocks`]（块的目标区间即 `target` 字符坐标，可直接与
//! golden bead 对照）与 [`plan_sentence`]（决策树结果）。数值**不设门槛**，
//! 只打印：
//!
//! ```text
//! cargo test -p bcut-flow-core --test golden_align -- --nocapture
//! ```

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use speech_doc::align_block::{
    AlignCtx, AlignEdge, AnchorAligner, AnchorWord, BilingualPlanInput, PlanOutcome, WordAligner,
    minimal_monotonic_blocks, plan_sentence, safe_boundaries, target_cut_candidates,
};
use speech_doc::doc::{AlignBlock, Correspondence, TranscriptDoc};
use speech_doc::golden::{GOLDEN_TAGS, GoldenCase, GoldenFile};
use speech_doc::metrics::{
    Bead, BeadMatch, bead_prf, beads_boundaries, beads_contiguous, boundary_f1, path_exact_match,
};
use speech_doc::sentence::{Sentence, derive_sentences};

/// 每个 `<lang>.json` 至少这么多条（计划 M0.1 验收）。
const MIN_CASES_PER_FILE: usize = 25;
/// golden 集总量下限。
const MIN_CASES_TOTAL: usize = 100;
/// 每类 tag 的下限。
const MIN_CASES_PER_TAG: usize = 5;

fn golden_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/align/golden")
}

fn examples_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/examples")
}

/// `core/fixtures/align/golden/<project>/<lang>.json`，按路径排序。
fn golden_files() -> Vec<(PathBuf, GoldenFile)> {
    let root = golden_root();
    let mut paths = Vec::new();
    let entries = std::fs::read_dir(&root)
        .unwrap_or_else(|error| panic!("读取 {} 失败：{error}", root.display()));
    for entry in entries {
        let entry = entry.expect("目录项");
        if !entry.file_type().expect("文件类型").is_dir() {
            continue;
        }
        for file in std::fs::read_dir(entry.path()).expect("读取项目目录") {
            let path = file.expect("目录项").path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                paths.push(path);
            }
        }
    }
    paths.sort();
    assert!(
        paths.len() >= 3,
        "golden 至少覆盖 3 个 <project>/<lang>.json，实际 {}",
        paths.len()
    );
    paths
        .into_iter()
        .map(|path| {
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("读取 {} 失败：{error}", path.display()));
            let file = GoldenFile::from_str(&text)
                .unwrap_or_else(|error| panic!("{} 解析失败：{error}", path.display()));
            (path, file)
        })
        .collect()
}

fn load_project(project: &str) -> TranscriptDoc {
    let path = examples_root().join(format!("{project}.bcut/transcript.json"));
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("读取 {} 失败：{error}", path.display()));
    let doc: TranscriptDoc = serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} 反序列化失败：{error}", path.display()));
    doc.validate().expect("transcript 自检");
    doc
}

/// `AlignBlock`（src 为闭区间、tgt 为半开区间）⇒ [`Bead`]。
fn block_bead(block: &AlignBlock) -> Bead {
    Bead::new(block.src.0..block.src.1 + 1, block.tgt.0..block.tgt.1)
}

fn plan_input(
    doc: &TranscriptDoc,
    sentence: &Sentence,
    case: &GoldenCase,
    lang: &str,
) -> BilingualPlanInput {
    let words: Vec<AnchorWord> = sentence
        .word_indices
        .iter()
        .map(|&index| {
            let word = &doc.words[index];
            AnchorWord {
                id: word.id.clone(),
                text: word.text.clone(),
                t0: word.t0,
                t1: word.t1,
                glue: false,
            }
        })
        .collect();
    BilingualPlanInput::new(words, case.target.clone(), &doc.lang, lang)
}

#[derive(Default)]
struct Baseline {
    cases: usize,
    strict_precision: f64,
    strict_recall: f64,
    strict_f1: f64,
    lax_precision: f64,
    lax_recall: f64,
    lax_f1: f64,
    src_boundary_f1: f64,
    tgt_boundary_f1: f64,
    path_em: usize,
    sentence_level: usize,
    needs_rewrite: usize,
    aligned: usize,
    hard_anchor_total: usize,
    hard_anchor_hit: usize,
}

impl Baseline {
    fn mean(&self, sum: f64) -> f64 {
        if self.cases == 0 {
            0.0
        } else {
            sum / self.cases as f64
        }
    }

    fn rate(&self, count: usize) -> f64 {
        if self.cases == 0 {
            0.0
        } else {
            count as f64 / self.cases as f64
        }
    }
}

#[test]
fn golden_files_parse_and_match_derived_sentences() {
    let files = golden_files();
    let mut total = 0usize;
    let mut tag_counts: BTreeMap<&str, usize> = GOLDEN_TAGS.iter().map(|tag| (*tag, 0)).collect();
    let mut docs: BTreeMap<String, TranscriptDoc> = BTreeMap::new();

    for (path, file) in &files {
        let label = format!("{}/{}", file.project, file.lang);
        assert!(
            file.cases.len() >= MIN_CASES_PER_FILE,
            "{label}: {} 条 < {MIN_CASES_PER_FILE}",
            file.cases.len()
        );
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("");
        assert_eq!(stem, file.lang, "{} 的文件名必须是 lang", path.display());
        let parent = path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .unwrap_or("");
        assert_eq!(
            parent,
            file.project,
            "{} 的目录名必须是 project",
            path.display()
        );

        let doc = docs
            .entry(file.project.clone())
            .or_insert_with(|| load_project(&file.project));
        assert_ne!(doc.lang, file.lang, "{label}: 目标语不能与源语相同");
        let sentences = derive_sentences(doc, &[]);
        let by_id: BTreeMap<&str, &Sentence> = sentences
            .iter()
            .map(|sentence| (sentence.id.as_str(), sentence))
            .collect();

        for case in &file.cases {
            total += 1;
            for tag in &case.tags {
                *tag_counts.get_mut(tag.as_str()).expect("已知 tag") += 1;
            }
            let sentence = by_id.get(case.sentence_id.as_str()).unwrap_or_else(|| {
                panic!(
                    "{}: sentenceId {} 不是 {} 当前派生的句",
                    case.id, case.sentence_id, file.project
                )
            });
            let words: Vec<&str> = sentence
                .word_indices
                .iter()
                .map(|&index| doc.words[index].text.as_str())
                .collect();
            assert_eq!(
                words, case.source_words,
                "{}: sourceWords 与派生句词不一致",
                case.id
            );
            assert!(
                beads_contiguous(&case.beads(), case.source_words.len(), case.target_chars()),
                "{}: beads 覆盖约束不成立",
                case.id
            );
        }
    }

    assert!(
        total >= MIN_CASES_TOTAL,
        "golden 总量 {total} < {MIN_CASES_TOTAL}"
    );
    println!("\n== golden 规模 ==");
    println!("文件 {} 个，用例 {total} 条", files.len());
    println!("\n== tag 分布 ==");
    for tag in GOLDEN_TAGS {
        let count = tag_counts[tag];
        println!("  {tag:<20} {count:>4}");
        assert!(
            count >= MIN_CASES_PER_TAG,
            "tag {tag} 只有 {count} 条 < {MIN_CASES_PER_TAG}"
        );
    }
}

#[test]
fn golden_anchor_aligner_baseline() {
    let files = golden_files();
    let mut docs: BTreeMap<String, TranscriptDoc> = BTreeMap::new();
    let mut rows: Vec<(String, Baseline)> = Vec::new();
    let mut overall = Baseline::default();

    for (_, file) in &files {
        let doc = docs
            .entry(file.project.clone())
            .or_insert_with(|| load_project(&file.project));
        let sentences = derive_sentences(doc, &[]);
        let by_id: BTreeMap<&str, &Sentence> = sentences
            .iter()
            .map(|sentence| (sentence.id.as_str(), sentence))
            .collect();
        let mut row = Baseline::default();

        for case in &file.cases {
            let sentence = by_id[case.sentence_id.as_str()];
            let input = plan_input(doc, sentence, case, &file.lang);
            let ctx = AlignCtx {
                source_lang: doc.lang.clone(),
                lang: file.lang.clone(),
                protected_terms: Vec::new(),
            };
            let src_words: Vec<&str> = case.source_words.iter().map(String::as_str).collect();
            let edges = AnchorAligner.align(&src_words, &case.target, &ctx);

            // 硬锚命中：golden 标注的硬锚里，AnchorAligner 真正产出同样边的比例。
            for anchor in &case.hard_anchors {
                row.hard_anchor_total += 1;
                if edges.iter().any(|edge| {
                    edge.hard
                        && edge.src == anchor.src
                        && edge.tgt.start <= anchor.tgt[0]
                        && edge.tgt.end >= anchor.tgt[1]
                }) {
                    row.hard_anchor_hit += 1;
                }
            }

            let candidates: Vec<usize> = target_cut_candidates(
                &input.target,
                &input.lang,
                &input.params,
                &input.protected_terms,
            )
            .into_iter()
            .map(|candidate| candidate.pos)
            .collect();
            let blocks = minimal_monotonic_blocks(
                &edges,
                &input.words,
                &input.target,
                &candidates,
                input.tau,
            );
            let predicted: Vec<Bead> = if blocks.is_empty() {
                vec![Bead::new(
                    0..case.source_words.len(),
                    0..case.target_chars(),
                )]
            } else {
                blocks.iter().map(block_bead).collect()
            };
            assert!(
                beads_contiguous(&predicted, case.source_words.len(), case.target_chars()),
                "{}: AnchorAligner 的块不是连续全覆盖划分",
                case.id
            );

            let golden = case.beads();
            let strict = bead_prf(&golden, &predicted, BeadMatch::Strict);
            let lax = bead_prf(&golden, &predicted, BeadMatch::Lax);
            let (golden_src, golden_tgt) = beads_boundaries(&golden);
            let (predicted_src, predicted_tgt) = beads_boundaries(&predicted);
            row.cases += 1;
            row.strict_precision += strict.precision;
            row.strict_recall += strict.recall;
            row.strict_f1 += strict.f1;
            row.lax_precision += lax.precision;
            row.lax_recall += lax.recall;
            row.lax_f1 += lax.f1;
            row.src_boundary_f1 += boundary_f1(&golden_src, &predicted_src).f1;
            row.tgt_boundary_f1 += boundary_f1(&golden_tgt, &predicted_tgt).f1;
            if path_exact_match(&golden, &predicted) {
                row.path_em += 1;
            }

            match plan_sentence(&edges, &input) {
                PlanOutcome::Aligned(entry) => {
                    row.aligned += 1;
                    assert_eq!(
                        entry.correspondence,
                        Some(Correspondence::Block),
                        "{}: Aligned 必须是块级对应",
                        case.id
                    );
                }
                PlanOutcome::NeedsRewrite { .. } => row.needs_rewrite += 1,
                PlanOutcome::SentenceLevel(_) => row.sentence_level += 1,
            }
        }

        overall.cases += row.cases;
        overall.strict_precision += row.strict_precision;
        overall.strict_recall += row.strict_recall;
        overall.strict_f1 += row.strict_f1;
        overall.lax_precision += row.lax_precision;
        overall.lax_recall += row.lax_recall;
        overall.lax_f1 += row.lax_f1;
        overall.src_boundary_f1 += row.src_boundary_f1;
        overall.tgt_boundary_f1 += row.tgt_boundary_f1;
        overall.path_em += row.path_em;
        overall.sentence_level += row.sentence_level;
        overall.needs_rewrite += row.needs_rewrite;
        overall.aligned += row.aligned;
        overall.hard_anchor_total += row.hard_anchor_total;
        overall.hard_anchor_hit += row.hard_anchor_hit;
        let short = file
            .project
            .split('-')
            .next()
            .unwrap_or(file.project.as_str());
        rows.push((format!("{short} {}→{}", doc.lang, file.lang), row));
    }

    println!("\n== AnchorAligner 基线（无 LLM / 无本地模型，数值不设门槛）==");
    println!(
        "{:<10} {:>5} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8}",
        "语言对",
        "用例",
        "strictP",
        "strictR",
        "strictF1",
        "laxP",
        "laxR",
        "laxF1",
        "bndSrcF1",
        "bndTgtF1",
        "pathEM",
        "句级率"
    );
    let print_row = |label: &str, row: &Baseline| {
        println!(
            "{label:<10} {:>5} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>8.3}",
            row.cases,
            row.mean(row.strict_precision),
            row.mean(row.strict_recall),
            row.mean(row.strict_f1),
            row.mean(row.lax_precision),
            row.mean(row.lax_recall),
            row.mean(row.lax_f1),
            row.mean(row.src_boundary_f1),
            row.mean(row.tgt_boundary_f1),
            row.rate(row.path_em),
            row.rate(row.sentence_level),
        );
    };
    for (label, row) in &rows {
        print_row(label, row);
    }
    print_row("总计", &overall);
    println!(
        "\n决策树：块级 {} / 需改写 {} / 整句 {}（共 {}）",
        overall.aligned, overall.needs_rewrite, overall.sentence_level, overall.cases
    );
    println!(
        "硬锚命中：{}/{}",
        overall.hard_anchor_hit, overall.hard_anchor_total
    );

    assert_eq!(
        overall.cases,
        files.iter().map(|(_, f)| f.cases.len()).sum::<usize>()
    );
}

#[test]
fn golden_endpoint_compression_preserves_cuts_blocks_and_plans() {
    let mut cases = 0;
    for (_, file) in golden_files() {
        let doc = load_project(&file.project);
        let sentences = derive_sentences(&doc, &[]);
        for case in &file.cases {
            let sentence = sentences.iter().find(|s| s.id == case.sentence_id).unwrap();
            let input = plan_input(&doc, sentence, case, &file.lang);
            let mut full = Vec::new();
            let mut ends = Vec::new();
            for bead in case.beads() {
                for src in bead.src.clone() {
                    full.push(AlignEdge::soft(src, bead.tgt.clone(), 0.75));
                }
                if !bead.src.is_empty() {
                    ends.push(AlignEdge::soft(bead.src.start, bead.tgt.clone(), 0.75));
                    if bead.src.len() > 1 {
                        ends.push(AlignEdge::soft(bead.src.end - 1, bead.tgt.clone(), 0.75));
                    }
                }
            }
            for a in &case.hard_anchors {
                let edge = AlignEdge::hard(a.src, a.tgt[0]..a.tgt[1]);
                full.push(edge.clone());
                ends.push(edge);
            }
            let cuts: Vec<_> = (1..case.target_chars()).collect();
            assert_eq!(
                safe_boundaries(&full, &cuts, input.tau),
                safe_boundaries(&ends, &cuts, input.tau),
                "{}",
                case.id
            );
            assert_eq!(
                minimal_monotonic_blocks(&full, &input.words, &input.target, &cuts, input.tau),
                minimal_monotonic_blocks(&ends, &input.words, &input.target, &cuts, input.tau),
                "{}",
                case.id
            );
            assert_eq!(
                plan_sentence(&full, &input),
                plan_sentence(&ends, &input),
                "{}",
                case.id
            );
            cases += 1;
        }
    }
    assert_eq!(cases, 126);
}
