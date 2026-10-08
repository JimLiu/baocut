use super::*;

/// 每个词占 0.4 s、词间 0.1 s。
fn rec_words(texts: &[&str]) -> Vec<RecWord> {
    texts
        .iter()
        .enumerate()
        .map(|(index, text)| RecWord {
            text: (*text).to_owned(),
            t0: index as f64 * 0.5,
            t1: index as f64 * 0.5 + 0.4,
        })
        .collect()
}

fn lines(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn spans(plan: &MatchPlan) -> Vec<(usize, usize, Reason)> {
    plan.segments
        .iter()
        .map(|segment| (segment.first, segment.last, segment.reason))
        .collect()
}

fn en_fillers() -> Vec<Vec<String>> {
    [&["um"][..], &["uh"], &["you", "know"]]
        .iter()
        .map(|phrase| phrase.iter().map(|word| (*word).to_owned()).collect())
        .collect()
}

#[test]
fn tokens_fold_width_case_and_punctuation_across_scripts() {
    assert_eq!(tokens("Don't STOP, now!"), vec!["dont", "stop", "now"]);
    assert_eq!(tokens("well-known"), vec!["well", "known"]);
    // 全角字母数字经兼容分解合成后与半角相同。
    assert_eq!(tokens("ＡＢＣ１２"), tokens("abc12"));
    // 不用空格分词的文字逐字位成词元，拉丁串照旧成词。
    assert_eq!(
        tokens("我们用iPhone15拍。"),
        vec!["我", "们", "用", "iphone15", "拍"]
    );
    // 泰文：元音与声调记号并入所属字位，不单独成词元。
    let thai = tokens("สวัสดี");
    assert!(!thai.is_empty());
    assert_eq!(thai.concat(), "สวัสดี");
    assert!(thai.len() < "สวัสดี".chars().count());
    // 纯标点没有词元。
    assert!(tokens("——！？…").is_empty());
}

#[test]
fn repeated_take_keeps_the_last_or_the_first_pass() {
    let script = lines(&["the quick brown fox jumps"]);
    let words = rec_words(&["the", "quick", "the", "quick", "brown", "fox", "jumps"]);
    let last = plan(&script, &words, Take::Last, None);
    assert_eq!(spans(&last), vec![(0, 1, Reason::Repeat)]);
    assert_eq!(last.matched, 5);
    assert_eq!(last.coverage(), 1.0);
    let first = plan(&script, &words, Take::First, None);
    assert_eq!(spans(&first), vec![(2, 3, Reason::Repeat)]);
}

#[test]
fn repeated_take_in_a_spaceless_script_is_found_per_character() {
    let script = lines(&["我们今天讲一下剪辑。"]);
    let words = rec_words(&["我们", "今天", "我们", "今天", "讲", "一下", "剪辑"]);
    let last = plan(&script, &words, Take::Last, None);
    assert_eq!(spans(&last), vec![(0, 1, Reason::Repeat)]);
    let first = plan(&script, &words, Take::First, None);
    assert_eq!(spans(&first), vec![(2, 3, Reason::Repeat)]);
}

#[test]
fn replacements_are_never_cut() {
    // 识别听错 / 换说法：两侧同一个缝里都有没对上的词元。
    let script = lines(&["I have three apples here"]);
    let words = rec_words(&["I", "have", "3", "apples", "here"]);
    let plan = plan(&script, &words, Take::Last, None);
    assert!(plan.segments.is_empty());
    assert_eq!(plan.script_tokens, 5);
    assert_eq!(plan.matched, 4);
    assert!(plan.missing_lines.is_empty());
}

#[test]
fn fillers_need_a_table_and_otherwise_fall_back_to_extra() {
    let script = lines(&["so we start"]);
    let words = rec_words(&["so", "um,", "you", "know", "we", "start"]);
    let fillers = en_fillers();
    let with_table = plan(&script, &words, Take::Last, Some(&fillers));
    assert_eq!(spans(&with_table), vec![(1, 3, Reason::Filler)]);
    let without = plan(&script, &words, Take::Last, None);
    assert_eq!(spans(&without), vec![(1, 3, Reason::Extra)]);
}

#[test]
fn fillers_inside_a_false_start_do_not_hide_the_repeat() {
    let script = lines(&["we start now"]);
    let words = rec_words(&["we", "um", "we", "start", "now"]);
    let fillers = en_fillers();
    let plan = plan(&script, &words, Take::Last, Some(&fillers));
    assert_eq!(spans(&plan), vec![(0, 1, Reason::Repeat)]);
}

/// 同一句起了几次头：整段不是一个子串，但能由保留段里的子串按顺序拼出来。
/// 片之间夹着保留段里没有的词（更正词）就不算，归 `extra`（已知边界）。
#[test]
fn several_false_starts_in_a_row_are_one_repeat() {
    let script = lines(&["the first step reads the timeline"]);
    let words = rec_words(&[
        "the", "first", "step", "reads", "the", "first", "the", "first", "step", "reads", "the",
        "timeline",
    ]);
    let plan = plan(&script, &words, Take::Last, None);
    assert_eq!(spans(&plan), vec![(0, 5, Reason::Repeat)]);

    let script = lines(&["第一步读取时间轴"]);
    let words = rec_words(&["第一步", "读取", "第一步", "第一步", "读取", "时间轴"]);
    let plan = super::plan(&script, &words, Take::Last, None);
    assert_eq!(spans(&plan), vec![(0, 2, Reason::Repeat)]);

    let script = lines(&["the first step reads the timeline"]);
    let words = rec_words(&[
        "the", "first", "step", "reads", "sorry", "the", "first", "step", "reads", "the",
        "timeline",
    ]);
    let plan = super::plan(&script, &words, Take::Last, None);
    assert_eq!(spans(&plan), vec![(0, 4, Reason::Extra)]);
}

#[test]
fn off_script_speech_is_extra_and_unspoken_lines_are_missing() {
    let script = lines(&["hello world", "this line was never read", "see you today"]);
    let words = rec_words(&[
        "hello", "world", "buy", "my", "course", "see", "you", "today",
    ]);
    let plan = plan(&script, &words, Take::Last, None);
    // 稿第 2 行与录音「buy my course」落在同一个缝里：两侧都有 → 替换，保留。
    assert!(plan.segments.is_empty());
    assert!(plan.missing_lines.is_empty());

    let script = lines(&["hello world", "see you today"]);
    let plan = super::plan(&script, &words, Take::Last, None);
    assert_eq!(spans(&plan), vec![(2, 4, Reason::Extra)]);

    let script = lines(&["hello world", "this line was never read", "see you today"]);
    let words = rec_words(&["hello", "world", "see", "you", "today"]);
    let plan = super::plan(&script, &words, Take::Last, None);
    assert!(plan.segments.is_empty());
    assert_eq!(plan.missing_lines, vec![1]);
}

/// 已知边界：两遍不完全一样（第一遍说成 X、稿与第二遍是 Y）时，`repeat` 按连续子串
/// 判不出来，前一遍记成 `extra`；`--take first` 时 LCS 会把稿的首词钉在第一遍，
/// 剪掉的是两遍中间那一截。结果是确定的，这里钉住，留给后续批次。
#[test]
fn takes_that_differ_by_a_word_are_a_pinned_boundary() {
    let script = lines(&["alpha yankee charlie"]);
    let words = rec_words(&["alpha", "xray", "charlie", "alpha", "yankee", "charlie"]);
    let last = plan(&script, &words, Take::Last, None);
    assert_eq!(spans(&last), vec![(0, 2, Reason::Extra)]);
    let first = plan(&script, &words, Take::First, None);
    assert_eq!(spans(&first), vec![(1, 3, Reason::Extra)]);
}

#[test]
fn words_without_tokens_join_a_segment_only_between_extra_words() {
    let script = lines(&["one two three"]);
    let words = rec_words(&["one", "…", "two", "zzz", "—", "yyy", "three", "—"]);
    let plan = plan(&script, &words, Take::Last, None);
    assert_eq!(spans(&plan), vec![(3, 5, Reason::Extra)]);
}

/// 确定性伪随机（LCG），不引 `rand`。
struct Lcg(u64);

impl Lcg {
    fn next(&mut self, bound: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 33) % bound
    }
}

/// 生成一份稿与一段「念稿录音」：每隔几百词插一次重录（把前面几个词再说一遍）、
/// 一段稿外话与口癖，偶尔替换一个词、漏念一行。返回（稿行，录音词，插入次数）。
fn synthetic(
    seed: u64,
    lines_count: usize,
    word: impl Fn(u64) -> String,
    vocabulary: u64,
) -> (Vec<String>, Vec<RecWord>, usize) {
    let mut rng = Lcg(seed);
    let mut script = Vec::new();
    let mut spoken: Vec<String> = Vec::new();
    let mut inserts = 0;
    for line_index in 0..lines_count {
        let length = 8 + rng.next(8) as usize;
        let line = (0..length)
            .map(|_| word(rng.next(vocabulary)))
            .collect::<Vec<_>>();
        script.push(line.join(" "));
        // 三种事件互相错开，保证每次插入各成一段、不与漏念的行落进同一个缝（那会成替换）。
        if line_index % 97 == 50 {
            continue; // 漏念一行
        }
        let after_missing = line_index % 97 == 51;
        let before_missing = line_index % 97 == 49;
        let repeat = line_index % 23 == 7 && !after_missing;
        if repeat {
            // 重录：先说前 3 个词，再整行说一遍。
            spoken.extend(line[..3].iter().cloned());
            inserts += 1;
        }
        for (position, token) in line.iter().enumerate() {
            if line_index % 31 == 3 && !repeat && position == 2 {
                spoken.push("replacedword".to_owned());
            } else {
                spoken.push(token.clone());
            }
        }
        if line_index % 41 == 11 && !before_missing && (line_index + 1) % 23 != 7 {
            spoken.extend(["um", "offscriptaaa", "offscriptbbb"].map(str::to_owned));
            inserts += 1;
        }
    }
    let words = spoken
        .iter()
        .enumerate()
        .map(|(index, text)| RecWord {
            text: text.clone(),
            t0: index as f64 * 0.3,
            t1: index as f64 * 0.3 + 0.25,
        })
        .collect();
    (script, words, inserts)
}

/// 量级：约 10 万词元的稿对 10 万词元的录音。精确 LCS 的单元数与 n+m 成线性、
/// 远小于 n·m；每一次重录与稿外话都被找到。不量墙钟。
#[test]
fn alignment_work_stays_linear_on_hours_of_speech() {
    let (script, words, inserts) = synthetic(7, 9000, |id| format!("w{id}"), 6000);
    let plan = plan(&script, &words, Take::Last, None);
    let n = plan.script_tokens as u64;
    let m = words.len() as u64;
    assert!(n > 90_000 && m > 90_000, "fixture too small: {n} × {m}");
    assert!(
        plan.stats.lcs_cells <= 64 * (n + m),
        "lcs cells {} not linear in n+m={}",
        plan.stats.lcs_cells,
        n + m
    );
    assert!(
        plan.stats.hashed <= 16 * (n + m),
        "hashed {}",
        plan.stats.hashed
    );
    assert_eq!(plan.stats.unresolved_script_tokens, 0);
    assert_eq!(plan.segments.len(), inserts);
    assert!(
        plan.segments
            .iter()
            .all(|segment| segment.reason != Reason::Filler)
    );
    assert!(plan.coverage() > 0.95);
}

/// 同样的量级在逐字成词元的文字上：字表小、单字几乎都不唯一，锚点靠 k 元组。
#[test]
fn alignment_work_stays_linear_for_per_character_tokens() {
    let (script, words, inserts) = synthetic(
        11,
        6000,
        |id| char::from_u32(0x4E00 + id as u32).unwrap().to_string(),
        2500,
    );
    // 重录与替换的占位词在这里也换成汉字，避免拉丁串变成单个长词元。
    let words = words
        .into_iter()
        .map(|mut word| {
            word.text = match word.text.as_str() {
                "um" => "龖".to_owned(),
                "offscriptaaa" => "龘".to_owned(),
                "offscriptbbb" => "靐".to_owned(),
                "replacedword" => "齉".to_owned(),
                _ => word.text,
            };
            word
        })
        .collect::<Vec<_>>();
    let plan = plan(&script, &words, Take::First, None);
    let n = plan.script_tokens as u64;
    let m = words.len() as u64;
    assert!(n > 60_000, "fixture too small: {n}");
    assert!(
        plan.stats.lcs_cells <= 64 * (n + m),
        "cells {}",
        plan.stats.lcs_cells
    );
    assert_eq!(plan.stats.unresolved_script_tokens, 0);
    assert_eq!(plan.segments.len(), inserts);
}

/// 病态输入：没有任何唯一锚点、又超过单缝上限。确定性地整段记为没对上，不 panic。
#[test]
fn a_gap_without_anchors_beyond_the_cap_is_left_unmatched() {
    let script = lines(&[&"a b ".repeat(3000)]);
    let text = "b a ".repeat(3000);
    let words = rec_words(&text.split_whitespace().collect::<Vec<_>>());
    let first = plan(&script, &words, Take::Last, None);
    let second = plan(&script, &words, Take::Last, None);
    assert_eq!(first, second);
    assert_eq!(first.matched, 0);
    assert_eq!(first.stats.unresolved_script_tokens, 6000);
    assert_eq!(first.stats.lcs_cells, 0);
    assert_eq!(first.coverage(), 0.0);
}

#[test]
fn silence_threshold_follows_the_material_and_needs_two_bins() {
    // 50 bin/s：说话 200、停顿 2、单个 bin 的低谷不算。
    let mut levels = vec![200u8; 100];
    levels[20..30].fill(2);
    levels[60] = 2;
    levels[80..83].fill(3);
    let map = SilenceMap::from_levels(&levels, 50.0);
    assert_eq!(map.runs(), &[(0.4, 0.6), (1.6, 1.66)]);
    // 底噪整体偏高的素材：阈值跟着底噪抬，但不高过 95 分位往下 15 dB。
    let mut noisy = vec![200u8; 100];
    noisy[10..40].fill(20);
    let map = SilenceMap::from_levels(&noisy, 50.0);
    assert_eq!(map.runs(), &[(0.2, 0.8)]);
    assert!(SilenceMap::from_levels(&[], 50.0).runs().is_empty());
}

#[test]
fn snap_takes_the_nearest_silence_inside_the_window() {
    let map = SilenceMap::from_runs(vec![(1.0, 1.2), (1.5, 1.6), (3.0, 4.0)]);
    assert_eq!(map.snap(1.3, 1.8, 1.4), Some(1.55));
    // 窗口只截到静音的一部分时取交集的中点。
    assert_eq!(map.snap(1.1, 1.3, 1.25), Some(1.15));
    assert_eq!(map.snap(2.0, 2.9, 2.5), None);
    assert_eq!(map.snap(2.0, 2.0, 2.0), None);
}

#[test]
fn cut_points_snap_or_fall_back_to_the_gap_midpoint_without_crossing_kept_words() {
    let words = vec![
        RecWord {
            text: "keep".into(),
            t0: 0.0,
            t1: 1.0,
        },
        RecWord {
            text: "drop".into(),
            t0: 1.4,
            t1: 2.0,
        },
        RecWord {
            text: "keep".into(),
            t0: 2.6,
            t1: 3.0,
        },
    ];
    let segment = PlanSegment {
        first: 1,
        last: 1,
        reason: Reason::Extra,
    };
    // 两端都有静音：起点吸到 1.1–1.3 的中点；终点窗口 [1.7, 2.3] 截到 2.2–2.3，取其中点。
    let map = SilenceMap::from_runs(vec![(1.1, 1.3), (2.2, 2.4)]);
    let placed = place_cuts(std::slice::from_ref(&segment), &words, 5.0, Some(&map), 0.3);
    assert_eq!(
        placed,
        vec![PlacedCut {
            segment: 0,
            t0: 1.2,
            t1: 2.25,
            snapped: true
        }]
    );
    // 起点这侧的静音在窗口外（且越过前一个保留词）：落在词间空档中点，只算一端吸附到。
    let map = SilenceMap::from_runs(vec![(0.2, 0.9), (2.2, 2.4)]);
    let placed = place_cuts(std::slice::from_ref(&segment), &words, 5.0, Some(&map), 0.3);
    assert_eq!(
        placed,
        vec![PlacedCut {
            segment: 0,
            t0: 1.2,
            t1: 2.25,
            snapped: false
        }]
    );
    // 不吸附（没有能量或 --snap 0）：两端都取空档中点。
    let placed = place_cuts(std::slice::from_ref(&segment), &words, 5.0, Some(&map), 0.0);
    assert_eq!(
        placed,
        vec![PlacedCut {
            segment: 0,
            t0: 1.2,
            t1: 2.3,
            snapped: false
        }]
    );
    // 首尾没有相邻词时一直剪到 0 与素材末尾。
    let edge = PlanSegment {
        first: 0,
        last: 2,
        reason: Reason::Extra,
    };
    let placed = place_cuts(&[edge], &words, 5.0, None, 0.3);
    assert_eq!(
        placed,
        vec![PlacedCut {
            segment: 0,
            t0: 0.0,
            t1: 5.0,
            snapped: false
        }]
    );
}

#[test]
fn too_short_cuts_are_dropped() {
    let words = vec![
        RecWord {
            text: "a".into(),
            t0: 0.0,
            t1: 1.0,
        },
        RecWord {
            text: "b".into(),
            t0: 1.0,
            t1: 1.02,
        },
        RecWord {
            text: "c".into(),
            t0: 1.02,
            t1: 2.0,
        },
    ];
    let segment = PlanSegment {
        first: 1,
        last: 1,
        reason: Reason::Extra,
    };
    assert!(place_cuts(&[segment], &words, 2.0, None, 0.3).is_empty());
}

/// 方案稿 §10.5 的三份 fixture，两种文字各一份：稿与录音一致时一刀不剪；
/// 拿错了稿时覆盖率低于 0.6（门槛在 CLI 层）。
#[test]
fn a_faithful_reading_cuts_nothing_and_a_wrong_script_scores_low() {
    let latin_script = lines(&[
        "Today we look at how a long recording becomes a short film.",
        "First we transcribe it, then we compare it with the script.",
    ]);
    let latin_words = latin_script
        .iter()
        .flat_map(|line| line.split_whitespace())
        .collect::<Vec<_>>();
    let faithful = plan(&latin_script, &rec_words(&latin_words), Take::Last, None);
    assert!(faithful.segments.is_empty());
    assert!(faithful.missing_lines.is_empty());
    assert_eq!(faithful.coverage(), 1.0);

    let han_script = lines(&[
        "今天我们来看一段长录音怎么变成短片。",
        "先转录，再和稿子逐字比对。",
    ]);
    let han_words = rec_words(&[
        "今天",
        "我们",
        "来",
        "看",
        "一段",
        "长",
        "录音",
        "怎么",
        "变成",
        "短片。",
        "先",
        "转录，",
        "再",
        "和",
        "稿子",
        "逐字",
        "比对。",
    ]);
    let faithful = plan(&han_script, &han_words, Take::First, None);
    assert!(faithful.segments.is_empty());
    assert_eq!(faithful.coverage(), 1.0);

    // 拿错了稿：录音讲的是另一件事。
    let wrong_latin = lines(&[
        "Bake the bread for forty minutes until the crust turns golden.",
        "Let it cool on a rack before you slice it.",
    ]);
    assert!(plan(&wrong_latin, &rec_words(&latin_words), Take::Last, None).coverage() < 0.6);
    let wrong_han = lines(&[
        "面包放进烤箱烤四十分钟，直到外皮金黄。",
        "放在架子上晾凉之后再切片。",
    ]);
    assert!(plan(&wrong_han, &han_words, Take::Last, None).coverage() < 0.6);
}
