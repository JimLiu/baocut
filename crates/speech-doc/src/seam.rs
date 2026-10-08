//! 译文片缝质量：悬垂连接词 / 黏着助词 / 闪现片 lint、preferred seam、
//! Latin 零 LLM 预拆。对拍 voice-ink `PipelineLint.checkAlign` 与
//! `DisplaySplitEngine.preferredTargetSplit` / `semanticPreSplitPieces`。

use crate::atomize::{
    atomize, clause_end_char, count_cps_chars, join_word_texts, seam_backed_by_whitespace,
    sentence_end,
};
use crate::doc::{TransPiece, Word};
use crate::split::{
    TransParams, exceeds_one_line_fit, piece_display_units, primary_subtag, target_cps_chars,
};

/// 可独立展示的最小片长；3 字及以下优先并入相邻片。
pub const MIN_PIECE_CHARS: usize = 3;
/// Latin 预拆：源/目标占比偏差上限。
pub const SNAP_RATIO_DIVERGENCE: f64 = 0.18;
/// Latin 预拆：两侧最短语音时长（秒）。
pub const MIN_CUE_DISPLAY_SEC: f64 = 1.0;

const CLOSERS: &[char] = &[
    ']', ')', '}', '）', '］', '｝', '】', '〕', '」', '』', '〉', '》', '”', '’', '"', '\'',
];
const STRONG_CLAUSE_PUNCT: &[char] = &[
    ',', '.', '!', '?', ';', ':', '，', '。', '！', '？', '；', '：', '…', '—',
];
const SEMANTIC_SEAM_PUNCT: &[char] = &['；', ';', '：', ':', '—'];
/// 开/闭字形可区分的成对定界符。缝落在一对**已闭合**的定界符内部即语病
///（「…名为“ | PluginDataJSON”的…」把引号和被引内容切开）。
///
/// 直引号 `"` / `'` 不纳入：单个字符无法从字形判开闭，只能按奇偶计数，而
/// 英文里它们兼作撇号（`it's`）与英寸号（`6" pipe`），奇偶法必然误判。
/// 中文译文用的是全角引号，本表已覆盖；漏判直引号是有意的取舍。
const DELIM_PAIRS: &[(char, char)] = &[
    ('“', '”'),
    ('‘', '’'),
    ('「', '」'),
    ('『', '』'),
    ('《', '》'),
    ('〈', '〉'),
    ('（', '）'),
    ('【', '】'),
    ('〔', '〕'),
    ('(', ')'),
    ('[', ']'),
    ('{', '}'),
];
const SENTENCE_FINAL_PUNCT: &[char] = &['。', '！', '？', '.', '!', '?', '…'];
const CLAUSE_PUNCT: &[char] = &[
    ',', '.', '!', '?', ';', ':', '，', '。', '！', '？', '；', '：', '、', '…', '—',
];

const DANGLING_CJK: &[char] = &[
    '和', '与', '或', '及', '跟', '而', '并', '且', '把', '被', '让', '使', '将', '比', '向', '往',
    '从', '当', '由', '给', '于',
];
/// 双字悬垂谓语：以补语为必需成分、片尾出现即断裂（G3 基线实测「类似 |
/// 于…」两处落库）。单字表覆盖不到（似/当不是虚词）。
const DANGLING_CJK_BIGRAMS: &[&str] = &["类似", "相当"];
/// 在显示切缝里末字仍是危险函数词，但作为**完整句末**时已构成常见名词/谓词。
const COMPLETE_CJK_SENTENCE_TAILS: &[&str] = &["方向", "对比", "总和", "跟不跟"];
/// 片尾「的」按悬垂处理（「…的 | 名词」定语与中心语被切开；p850 基准草稿
/// 实测两处落库），但这些双字名词/代词以「的」收尾是完整词，不算悬垂。
const DE_TAIL_COMPLETE_BIGRAMS: &[&str] = &["目的", "标的", "有的", "别的", "似的"];
/// 数字后的单位/量词：片首出现且前片以数字结尾 ⇒ 数量短语被切开
///（p850 基准草稿实测「1000 | 美元」）。单字表只收数字后近乎无歧义的。
const NUMBER_UNIT_PREFIXES: &[&str] = &[
    "美元", "欧元", "英镑", "日元", "港元", "万亿", "分钟", "小时", "公里", "公斤", "元", "块",
    "万", "亿", "年", "月", "日", "号", "岁", "人", "名", "位", "个", "次", "倍", "点", "天", "周",
    "米", "克", "吨",
];
const DANGLING_LATIN: &[&str] = &["and", "or", "of", "the", "a", "an", "to", "but"];
const LEADING_DANGLING_CJK: &[char] = &[
    '的', '地', '得', '了', '着', '过', '时', '者', '们', '之', '吗', '呢', '吧', '啊', '呀', '嘛',
    '哦',
];
/// 片尾仍在等待中心语的中文数量/类别短语。这里只收高置信度谓词尾，避免把
/// 「我只要一个 | 另一个不要」这类省略结构一概误判；右片有正文且左片无
/// 句读时才由 [`incomplete_nominal_split`] 阻塞。
const INCOMPLETE_CJK_NOMINAL_TAILS: &[&str] = &[
    "有一个",
    "有一种",
    "有这个",
    "有那个",
    "是一个",
    "是一种",
    "作为一个",
    "作为一种",
    "成为一个",
    "成为一种",
];
/// 片首并列连词：中文并列结构被切在 `和`/`及`/`与`/`或` 之前，与「片尾悬垂
/// 连词」是同一处语病的对称面（R2 基准实测「它们是 KV 缓存 | 和
/// PagedAttention。」「…就来聊聊 KV 缓存 | 和 PagedAttention。」两处；`或`
/// 曾只进悬垂尾表不进片首表，导致预拆建议裸切「…A | 或者 B」与契约的并列
/// 禁切条款冲突）。前片以句读收尾时不算（由 [`lint_pieces`] 的
/// `ends_clause_punct` 门控）。
const LEADING_COORDINATOR_CJK: &[char] = &['和', '及', '与', '或'];
/// 以并列连词起首但本身成词/成短语的片首（这些是合法片首，不得拦）。
/// 注意 `或者`/`或是` 不在此列：它们仍是并列连词，裸切在其前同样断并列。
const LEADING_COORDINATOR_WORDS: &[&str] = &[
    "和平",
    "和谐",
    "和解",
    "和睦",
    "和好",
    "和气",
    "和尚",
    "和约",
    "和风",
    "与其",
    "与此",
    "与日",
    "与会",
    "与众",
    "及时",
    "及其",
    "及至",
    "或许",
    "或多或少",
];
/// 弱收尾：裸尾片（无句读收尾）落在语法上不可停顿的尾形上。R2 基准 14 处
/// 硬悬空全部落在这几类：结构助词/方位后缀、副词、助动词、量词、及物光动词
/// 缺宾（见审计 §4.2.1）。
///
/// Blocking 只收「无标点时几乎不可能合法收句」的形态；语境相关的光动词
/// （知道/占用/生成…）留在 [`WEAK_TAIL_ADVISORY_WORDS`]，避免把
/// 「我不知道」「来看看」这类完整谓语误判成语病、凭空多一轮回炉。
const WEAK_TAIL_BLOCKING_WORDS: &[&str] = &[
    // 副词
    "如何",
    "只是",
    "同时",
    "预先",
    "仅仅",
    // 助动词
    "可以",
    // 量词短语（不含裸「一个/一种」：省略结构合法，见 INCOMPLETE_CJK_NOMINAL_TAILS）
    "一系列",
    "一块",
    // 光动词 + 完成体「了」：宾语必然在下一片
    "采用了",
    "内置了",
    "了解了",
    "使用了",
    "提供了",
    "包含了",
    "实现了",
    "支持了",
    "引入了",
    "带来了",
    "占用了",
    "生成了",
];
/// 弱收尾（提示级）：及物光动词缺宾。是否缺宾取决于语境，只提示 + 参与
/// 目标预拆罚分，不阻塞。
const WEAK_TAIL_ADVISORY_WORDS: &[&str] = &[
    "生成",
    "占用",
    "浪费掉",
    "看看",
    "知道",
    "了解",
    "获取",
    "释放",
];
/// 以「得」收尾但本身成词的双字尾（这些片尾合法）。
const WEAK_TAIL_DE_COMPLETE_BIGRAMS: &[&str] = &["心得", "所得", "值得", "难得", "舍得"];

// ---------------------------------------------------------------------------
// 形态类弱尾（开放类）。`WEAK_TAIL_BLOCKING_WORDS` 是封闭词表，中文悬空尾
// 却是开放类：R3 基准实测 `采用了`/`同时` 等词条命中后，缺陷只是**位移**到
// 相邻的未列出形态上（见审计 §2「缺陷位移」）。下面几组按**形态**判定，
// 词表只保留「成词陷阱」豁免侧（与既有「以上」「心得」同一机制）。
// ---------------------------------------------------------------------------

/// 处置式/兼语式框架词：`把/将/让/使/叫 + NP` 后必须跟谓语。
const FRAME_DISPOSAL_CJK: &[char] = &['把', '将', '让', '使', '叫'];
/// 框架词回看窗口（字）。超出窗口即认为该框架已在更早处闭合。
const FRAME_LOOKBACK: usize = 10;
/// 处置式/兼语式豁免：含框架字但框架字不作框架词用的双字词（副词「即将」、
/// 时间名词「将来」、连词「即使」等）。命中位置可在框架字前或后。
const FRAME_COMPLETE_BIGRAMS: &[&str] = &[
    "即将", "行将", "将来", "将要", "将会", "将近", "假使", "即使", "纵使", "致使", "促使", "迫使",
    "大把", "把握", "把手", "叫做", "名叫", "号叫",
];
/// 补语/体标记收尾：框架后已出现谓语核心，不算处置式缺谓语
///（缺宾的情形由 [`VERB_COMPLEMENT_TAILS`] 单独判）。
const PREDICATE_TAIL_CJK: &[char] = &[
    '了', '着', '过', '到', '成', '出', '掉', '回', '走', '开', '住', '给', '完', '好', '起', '下',
    '来', '去', '上',
];

/// 及物动词 + 趋向/结果补语：补语收尾即缺宾（「浪费掉 ‖ 60%」「观察到 ‖ 50%」）。
const VERB_COMPLEMENT_TAILS: &[char] = &['到', '掉', '出', '成'];
/// 动补缺宾豁免：以补语字收尾但本身是自足动词/名词的双字词。
const VERB_COMPLEMENT_COMPLETE_BIGRAMS: &[&str] = &[
    // 到
    "迟到", "报到", "周到", "独到", "不到", "直到", "来到",
    // 掉（自足不及物极少，只豁免明显成词的）
    "丢掉", // 出：输出/产出/支出 等是名词
    "输出", "产出", "支出", "付出", "演出", "突出", "杰出", "外出", "日出", "售出", "退出", "指出",
    // 成：完成/形成 等可自足收句
    "完成", "形成", "达成", "组成", "构成", "集成", "合成", "赞成", "现成", "既成",
];

/// 方位后缀：`在/从/对/往/向 … X` 或「数量/Latin + 方位」构成的方位框架
/// 未闭合。「上」在下面单独判（沿用既有的「在…上」回看规则）。
const LOCATIVE_SUFFIX_CJK: &[char] = &['里', '中', '下', '内', '间'];
/// 方位框架的显式引导词。
const LOCATIVE_FRAME_CJK: &[char] = &['在', '从', '对', '往', '向'];
/// 方位后缀豁免：这些双字尾是自足的代词/名词/动词，不是待闭合的方位短语。
const LOCATIVE_COMPLETE_BIGRAMS: &[&str] = &[
    // 里
    "这里", "那里", "哪里", "家里", "心里", "手里", "公里", "英里", "海里", "表里",
    // 中
    "其中", "当中", "之中", "集中", "空中", "眼中", "心中", "适中", "居中", "命中", "选中", "看中",
    "击中", "猜中", // 下
    "以下", "如下", "低下", "属下", "手下", "天下", "地下", "陛下", "阁下", "留下", "放下", "剩下",
    // 内
    "以内", "之内", "国内", "室内", "体内", "对内", // 间
    "之间", "期间", "中间", "时间", "空间", "房间", "瞬间", "民间", "夜间", "车间",
];

/// 方位后缀落在**片首**：与 [`LOCATIVE_SUFFIX_CJK`] 是同一语病的对称面
///（「从你现有的 GPU ‖ 中获得…」把方位框架从中间切开）。这些字起首时
/// 几乎总黏着前一片的 NP，除非本身成词。
const LEADING_LOCATIVE_WORDS: &[&str] = &[
    "中国", "中间", "中心", "中央", "中断", "中止", "中文", "中英", "下面", "下一", "下来", "下去",
    "下列", "下载", "上面", "上一", "上来", "上去", "上述", "上下", "里面", "内容", "内存", "内部",
    "内核", "内置", "间接", "间隔",
];

/// 光动词框架：`来/去 + 单音节重叠动词`（聊聊/看看/说说）缺宾。
const LIGHT_VERB_FRAME_CJK: &[char] = &['来', '去'];
/// 系词「是」裸尾：表语在下一片。判据从治超机制的实测坏缝反推
///（`所以，如果你的最大序列长度是 ‖ 2048 个 token，`）。
const COPULA_COMPLETE_BIGRAMS: &[&str] = &["求是", "自是"];
pub(crate) const CUT_BEFORE_CJK: &[&str] = &[
    "但是", "所以", "因为", "然后", "而且", "不过", "如果", "虽然", "那么", "或者", "并且", "同时",
    "接着", "另外",
];
const CUT_BEFORE_LATIN: &[&str] = &[
    "but", "so", "because", "then", "which", "when", "while", "and", "or", "if",
];
/// 弱缝:介词/不定式引导的短语起点。只用于源词区间锚定吸附,不用于目标切分。
const CUT_BEFORE_LATIN_WEAK: &[&str] = &[
    "to", "with", "for", "from", "into", "onto", "about", "without", "through", "over", "under",
    "between", "across", "by", "at", "on", "in", "of", "as", "after", "before", "during", "since",
    "until", "toward", "towards", "via",
];
/// 源词区间锚定:占比边界向语义缝吸附的搜索窗口(词数)。
const ANCHOR_SNAP_WINDOW: usize = 2;

fn is_cjk_lang(lang: &str) -> bool {
    matches!(primary_subtag(lang).as_str(), "zh" | "ja" | "ko")
}

fn strip_closers(text: &str) -> &str {
    let mut end = text.len();
    while end > 0 {
        let Some(ch) = text[..end].chars().next_back() else {
            break;
        };
        if !CLOSERS.contains(&ch) {
            break;
        }
        end -= ch.len_utf8();
    }
    &text[..end]
}

/// 片是否以句末标点收尾（剥离 closer 后）。
pub fn ends_sentence_final(text: &str) -> bool {
    let trimmed = text.trim();
    let stripped = strip_closers(trimmed);
    stripped
        .chars()
        .last()
        .is_some_and(|ch| SENTENCE_FINAL_PUNCT.contains(&ch))
}

/// 片是否以从句标点收尾（剥离空白后）。
pub fn ends_clause_punct(text: &str) -> bool {
    text.trim()
        .chars()
        .last()
        .is_some_and(|ch| CLAUSE_PUNCT.contains(&ch))
}

/// 片是否以悬垂连接词/介词结尾。
pub fn ends_dangling(text: &str) -> bool {
    let trimmed = text.trim();
    let Some(last) = trimmed.chars().last() else {
        return false;
    };
    if CLAUSE_PUNCT.contains(&last) {
        return false;
    }
    if DANGLING_CJK.contains(&last) {
        return true;
    }
    let tail: String = trimmed
        .chars()
        .rev()
        .take(2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if DANGLING_CJK_BIGRAMS.contains(&tail.as_str()) {
        return true;
    }
    if last == '的' && !de_tail_complete(trimmed, &tail) {
        return true;
    }
    // 强标点可能在润色回写时与两侧 Latin 词相连；按最后一个 lexical run
    // 判断，避免把 `matters—the` 当成一个安全词而漏掉悬空冠词 `the`。
    let Some(tok) = trimmed
        .split(|ch: char| !ch.is_alphanumeric() && ch != '\'' && ch != '-')
        .filter(|token| !token.is_empty())
        .next_back()
    else {
        return false;
    };
    DANGLING_LATIN.contains(&tok.to_ascii_lowercase().as_str())
}

/// 句末标点是否落在悬垂词上——「假句末」判据（`… because.` / `… of how.`）。
///
/// 与 [`ends_dangling`] 的差别是必须先**确认**这是个句末：文本以句末标点
/// 收尾，剥掉 closer 与句末标点后再看最后一个实义词。`ends_dangling` 本身
/// 遇到 `CLAUSE_PUNCT`（含 `.`）直接返回 false，直接调用永远判不出来。
///
/// 只对 Latin/中文这类可判定语言有意义，调用方负责语言门。
pub fn dangling_sentence_end(text: &str) -> bool {
    let trimmed = text.trim();
    if !ends_sentence_final(trimmed) {
        return false;
    }
    let stripped = trimmed.trim_end_matches(|ch: char| {
        SENTENCE_FINAL_PUNCT.contains(&ch) || CLOSERS.contains(&ch) || ch.is_whitespace()
    });
    if has_fronted_latin_preposition_object(stripped) {
        return false;
    }
    if is_elliptical_infinitive_end(stripped) {
        return false;
    }
    // 单字母编号/变量（`a.`、`B.`）在测试夹具、枚举口述与数学转录里可独立成句；
    // 不能因为 `a` 同时也是英文冠词就把纯协议 round-trip 判成假句末。
    if stripped.len() == 1 && stripped.chars().all(|ch| ch.is_ascii_alphabetic()) {
        return false;
    }
    // `的` 在显示切缝里仍是高风险悬垂词，但在完整中文句末常作判断、强调或
    // 名词化收尾（“是的。”“这是很重要的。”）。把整句判据与切缝判据分开：
    // 仅保留孤立碎片“的。”的告警，避免长访谈产生数百条无行动价值的误报。
    if stripped.ends_with('的') && stripped != "的" {
        return false;
    }
    if COMPLETE_CJK_SENTENCE_TAILS
        .iter()
        .any(|tail| stripped.ends_with(tail))
    {
        return false;
    }
    ends_dangling(stripped)
}

/// 文本中是否有任一句落在悬垂连接词/介词上。
///
/// [`dangling_sentence_end`] 只检查一个已知句片；文件载体与 json-v0 单句重试
/// 拿到的都是可能包含多句的整段文本。统一在这里按 `atomize` + `sentence_end`
/// 切片，避免两条验收路径各自实现一套略有漂移的扫描器。
pub fn contains_dangling_sentence_end(text: &str) -> bool {
    let atoms = atomize(text);
    let mut sentence_start = 0usize;
    for (index, atom) in atoms.iter().enumerate() {
        if !sentence_end(atom) {
            continue;
        }
        let sentence = join_word_texts(atoms[sentence_start..=index].iter().map(String::as_str));
        if dangling_sentence_end(&sentence) {
            return true;
        }
        sentence_start = index + 1;
    }
    // 最后一个句末原子之后的残段。丢掉它会开出一个盲区：ASCII 省略号收尾的
    // `but...` 过不了 [`crate::atomize::sentence_end`] 的 `2.14` / `a.com` 守卫
    // （词干里还留着 `.` 就不算句末），于是整段尾巴被静默丢弃、本函数恒返回
    // false，而 `bcut check` 走的 [`dangling_sentence_end`] 却照样告警——同一
    // 现象两条路径给相反答案，模型还能靠把 `.` 改成 `...` 蒙混过验收。
    //
    // 残段不以句末标点收尾时 `dangling_sentence_end` 自己就会返回 false，
    // 所以这里不会把「话没说完的段尾」误判成悬垂句末。
    if sentence_start < atoms.len() {
        let tail = join_word_texts(atoms[sentence_start..].iter().map(String::as_str));
        if dangling_sentence_end(&tail) {
            return true;
        }
    }
    false
}

/// 是否是句末标点（`。！？.!?…`）。
pub fn is_sentence_final_punct(ch: char) -> bool {
    SENTENCE_FINAL_PUNCT.contains(&ch)
}

/// 是否含有互相冲突的相邻句末/分句标点（例如 `。，`、`，。`、`，，`）。
///
/// `？！`、`!?` 这类组合句末语气，以及省略号，都是合法写法；这里只拦一边
/// 已经封句、另一边却又要求句内续接的组合，以及两个连续的分句标点。模型在句界
/// 重贴时偶尔会把新标点追加到 ASR 原标点后面，若不在提交时拒绝，派生
/// Sentence/Cue 都会保留噪声。
pub fn contains_conflicting_punctuation(text: &str) -> bool {
    let sentence_final = |ch: char| matches!(ch, '。' | '！' | '？' | '.' | '!' | '?');
    let clause = |ch: char| matches!(ch, '，' | '、' | '；' | '：' | ',' | ';' | ':');
    text.chars().zip(text.chars().skip(1)).any(|(left, right)| {
        (sentence_final(left) && clause(right))
            || (clause(left) && sentence_final(right))
            || (clause(left) && clause(right))
    })
}

/// 冲突相邻标点的确定性归一（重试策略重设计 R2「代码先修」）。
///
/// 判据与 [`contains_conflicting_punctuation`] 严格互补：凡是那里判冲突的相邻
/// 对，这里都消解掉一个，结果保证 `!contains_conflicting_punctuation(out)`。
/// 规则只有一条——**句末标点赢**：
///
/// - `。，` / `，。` → 保留句末的那个（`。`）；
/// - `，，` / `,;` 一类两个连续分句标点 → 保留前一个；
/// - `..` → `.`（同一句末重复，保留一个）。
///
/// `？！`、`!?`、`……` 这类组合语气不在冲突集里，原样保留。空白不影响判定：
/// 冲突判定看的是相邻字符，因此中间隔了空格的两个标点本就不算冲突。
pub fn normalize_conflicting_punctuation(text: &str) -> String {
    let sentence_final = |ch: char| matches!(ch, '。' | '！' | '？' | '.' | '!' | '?');
    let clause = |ch: char| matches!(ch, '，' | '、' | '；' | '：' | ',' | ';' | ':');
    // 第一步：恰好两个连续的 ASCII 句点折成一个。三个及以上是省略号写法，
    // 原样保留（`...` 不是 `..`）。
    let mut folded = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut index = 0usize;
    while index < chars.len() {
        if chars[index] == '.' {
            let run = chars[index..].iter().take_while(|ch| **ch == '.').count();
            let keep = if run == 2 { 1 } else { run };
            for _ in 0..keep {
                folded.push('.');
            }
            index += run;
            continue;
        }
        if chars[index] == '。' {
            let run = chars[index..].iter().take_while(|ch| **ch == '。').count();
            folded.push('。');
            index += run;
            continue;
        }
        folded.push(chars[index]);
        index += 1;
    }
    // 第二步：按「已写出的最后一个字符」逐字消解冲突对，保证消解本身不会
    // 制造出新的冲突对（`，，。` → `。`，而不是 `，。`）。
    let mut out = String::with_capacity(folded.len());
    for ch in folded.chars() {
        match out.chars().next_back() {
            Some(last) if sentence_final(last) && clause(ch) => continue,
            Some(last) if clause(last) && sentence_final(ch) => {
                out.pop();
                out.push(ch);
            }
            Some(last) if clause(last) && clause(ch) => continue,
            // 消解后可能露出两个同款 CJK 句末（`。，。`）：只留一个。
            Some('。') if ch == '。' => continue,
            _ => out.push(ch),
        }
    }
    out
}

/// 是否含有疑似被 ASR 粘成一个词的超长纯 Latin atom。
///
/// 该判据故意只看连续 ASCII 字母，不把 URL、带连字符术语或数字串算进去。
/// 调用方还应按语言门控；当前主要用于中文转录里的英文 code-switching，避免
/// `purereinforcementlearning` 这类本应有空格的短语漏过 polish 质量门。
pub fn contains_likely_collapsed_latin_atom(text: &str, min_chars: usize) -> bool {
    let mut run = 0usize;
    for ch in text.chars() {
        if ch.is_ascii_alphabetic() {
            run += 1;
            if run >= min_chars {
                return true;
            }
        } else {
            run = 0;
        }
    }
    false
}

/// 英语疑问/关系结构允许介词悬置：`what it reaches out to`、
/// `what this is an example of` 的末词虽是介词，但宾语已经前置，句子完整。
///
/// 这里只豁免当前悬垂词表里确实会触发假句末的 `to/of`，并要求 wh 词与末介词
/// 之间出现一个显式从句主语；这样 `what to do because of.` 仍会被报出，而不会
/// 因为远处碰巧有 `what` 就误放行。
fn has_fronted_latin_preposition_object(text: &str) -> bool {
    let tokens = text
        .split(|ch: char| !ch.is_alphanumeric() && ch != '\'')
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let Some(last) = tokens.last() else {
        return false;
    };
    if !matches!(last.as_str(), "to" | "of") {
        return false;
    }
    let wh = ["what", "who", "whom", "which", "where"];
    let subjects = [
        "i", "you", "he", "she", "it", "we", "they", "this", "that", "these", "those",
    ];
    let search_start = tokens.len().saturating_sub(12);
    (search_start..tokens.len().saturating_sub(1))
        .rev()
        .find(|index| wh.contains(&tokens[*index].as_str()))
        .is_some_and(|index| {
            tokens[index + 1..tokens.len() - 1]
                .iter()
                .any(|token| subjects.contains(&token.as_str()) || token.ends_with("'s"))
        })
}

/// 英语的不定式省略：`They can slow down any time they want to.`、
/// `You don't have to.`、`I was going to.` 的末词是 `to`，但它是被省略的动词短语
/// 的标记，不是等待宾语的介词；句子完整。只放行紧跟在这些许可动词之后的 `to`
///（口语访谈里 `want to.` 一类实测被 polish 验收打回，Agent 只能原样交回），
/// `example of.`、`what to do because of.` 照旧是假句末。
fn is_elliptical_infinitive_end(text: &str) -> bool {
    const LICENSORS: &[&str] = &[
        "want", "wants", "wanted", "need", "needs", "needed", "have", "has", "had", "going",
        "able", "ought", "used", "like", "likes", "liked", "love", "loves", "loved", "try",
        "tries", "tried", "supposed", "meant", "mean", "means", "plan", "plans", "planned",
        "intend", "intends", "intended", "hope", "hopes", "hoped", "got", "get", "gets", "forgot",
        "forget", "refuse", "refused", "refuses", "chose", "choose", "decided", "decide", "expect",
        "expected", "wish", "wished", "afford", "deserve", "deserves", "deserved", "allowed",
        "expects", "wishes",
    ];
    let mut tokens = text
        .split(|ch: char| !ch.is_alphanumeric() && ch != '\'')
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_lowercase())
        .rev();
    tokens.next().is_some_and(|last| last == "to")
        && tokens
            .next()
            .is_some_and(|before| LICENSORS.contains(&before.as_str()))
}

/// 以「的」收尾的双字尾是否自足。「有的」只在**独立**出现时是代词
///（有的人/有的是）；前面还有表意字时是「现有的/所有的/已有的」这类
/// 定语 + 的，仍在等中心语（治超实测坏缝 `从你现有的 ‖ GPU 中获得…`）。
fn de_tail_complete(trimmed: &str, tail: &str) -> bool {
    if !DE_TAIL_COMPLETE_BIGRAMS.contains(&tail) {
        return false;
    }
    if tail != "有的" {
        return true;
    }
    !trimmed
        .chars()
        .rev()
        .nth(2)
        .is_some_and(|ch| is_ideograph(ch))
}

/// 片是否以黏着助词或并列连词开头。介词「于」几乎总属于前一片的谓语
///（类似于/取决于/属于…），唯一常见的合法片首是连词「于是」。
pub fn starts_dangling(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.starts_with('于') && !trimmed.starts_with("于是") {
        return true;
    }
    let Some(first) = trimmed.chars().next() else {
        return false;
    };
    if LEADING_DANGLING_CJK.contains(&first) {
        return true;
    }
    LEADING_COORDINATOR_CJK.contains(&first)
        && !LEADING_COORDINATOR_WORDS
            .iter()
            .any(|word| trimmed.starts_with(word))
}

/// 裸尾片是否落在语法上不可停顿的弱尾形上。返回 `(严重度, 命中的尾形)`；
/// 以句读收尾（含 closer 后）时一律不算。
///
/// 与 [`ends_dangling`] 分开是刻意的：`ends_dangling` 也作用在**源**片上
/// （`validate_source_shape`），中文弱尾表混进去会在 zh→X 任务里变成源侧阻塞。
pub fn ends_weak_tail(text: &str) -> Option<(SeamLintKind, &'static str)> {
    let trimmed = text.trim();
    let stripped = strip_closers(trimmed);
    let last = stripped.chars().last()?;
    if CLAUSE_PUNCT.contains(&last) {
        return None;
    }
    let tail2: String = stripped
        .chars()
        .rev()
        .take(2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    // 方位框架「在…上」：整个介词短语还在等谓语（R2「这里的输出质量在数学上 |
    // 与单独运行大模型完全相同。」）。只在同片出现「在」时命中，绕开
    // 以上/晚上/网上/线上 这类自足词，无需维护白名单。
    if last == '上' && tail2 != "以上" && stripped.chars().rev().take(12).any(|ch| ch == '在') {
        return Some((SeamLintKind::Blocking, "在…上"));
    }
    if last == '得' && !WEAK_TAIL_DE_COMPLETE_BIGRAMS.contains(&tail2.as_str()) {
        return Some((SeamLintKind::Blocking, "得"));
    }
    if let Some(form) = morphological_weak_tail(stripped) {
        return Some((SeamLintKind::Blocking, form));
    }
    if let Some(word) = WEAK_TAIL_BLOCKING_WORDS
        .iter()
        .find(|word| stripped.ends_with(**word))
    {
        return Some((SeamLintKind::Blocking, word));
    }
    WEAK_TAIL_ADVISORY_WORDS
        .iter()
        .find(|word| stripped.ends_with(**word))
        .map(|word| (SeamLintKind::Advisory, *word))
}

/// 形态类弱尾判定（开放类）。命中返回形态名，全部为 Blocking。
///
/// 输入是已 `strip_closers`、已确认不以句读收尾的裸尾片。空白一律先剥除：
/// 交付投影会在 CJK 与 Latin 之间补空格，`35% 里`/`将 max_...` 这类片的
/// 形态相邻关系不能被这些空格切断。
fn morphological_weak_tail(stripped: &str) -> Option<&'static str> {
    let chars: Vec<char> = stripped.chars().filter(|ch| !ch.is_whitespace()).collect();
    let last = *chars.last()?;
    // 回看窗按「单位」计：连续 ASCII 词元记 1 个单位，否则
    // `将 max_num_batched_tokens` 这类片会被一个长 Latin 词整个吃掉窗口。
    let units = unit_offsets_from_end(&chars);
    let bigram: String = chars[chars.len().saturating_sub(2)..].iter().collect();

    // 2 · 及物动词 + 趋向/结果补语（到/掉/出/成）收尾 ⇒ 宾语在下一片。
    // 先于处置式判：`把 X 映射到` 两条都沾边，缺宾才是实际语病。
    if VERB_COMPLEMENT_TAILS.contains(&last) && chars.len() >= 2 {
        let head = chars[chars.len() - 2];
        // 前一字必须是表意字（`8 到` / `v2 出` 这类不是动补）。
        if is_ideograph(head) && !VERB_COMPLEMENT_COMPLETE_BIGRAMS.contains(&bigram.as_str()) {
            return Some("动补缺宾");
        }
    }

    // 3 · 方位框架未闭合。「上」沿用既有的「在…上」回看；里/中/下/内/间
    // 另加「数量/Latin + 方位」触发（R3「也就是这 35% 里 ‖ 用于 KV…」）。
    if LOCATIVE_SUFFIX_CJK.contains(&last)
        && chars.len() >= 2
        && !LOCATIVE_COMPLETE_BIGRAMS.contains(&bigram.as_str())
    {
        let head = chars[chars.len() - 2];
        let quantified = head.is_ascii_alphanumeric() || head == '%' || head == '％';
        let framed = chars.iter().enumerate().any(|(index, ch)| {
            units[index] <= FRAME_LOOKBACK + 2 && LOCATIVE_FRAME_CJK.contains(ch)
        });
        if quantified || framed {
            return Some("方位框架");
        }
    }

    // 6 · 系词「是」裸尾：表语必然在下一片。
    if last == '是' && !COPULA_COMPLETE_BIGRAMS.contains(&bigram.as_str()) {
        return Some("系词缺表语");
    }

    // 5 · 光动词：`来/去 + 单音节重叠动词`（来聊聊/去看看）缺宾。
    if chars.len() >= 3 && chars[chars.len() - 2] == last && is_ideograph(last) {
        let light = chars
            .iter()
            .rev()
            .skip(2)
            .take(3)
            .any(|ch| LIGHT_VERB_FRAME_CJK.contains(ch));
        if light {
            return Some("光动词重叠");
        }
    }

    // 1/4 · 处置式（把/将 + NP）与兼语式（让/使/叫 + NP）后无谓语。
    // 片尾落在补语/体标记上时视为谓语已出现，交由上面的动补判据处理。
    if !PREDICATE_TAIL_CJK.contains(&last) {
        for index in (0..chars.len().saturating_sub(1)).rev() {
            if units[index] > FRAME_LOOKBACK {
                break;
            }
            let ch = chars[index];
            if !FRAME_DISPOSAL_CJK.contains(&ch) {
                continue;
            }
            let before: String = chars[index.saturating_sub(1)..=index].iter().collect();
            let after: String = chars[index..].iter().take(2).collect();
            if FRAME_COMPLETE_BIGRAMS.contains(&before.as_str())
                || FRAME_COMPLETE_BIGRAMS.contains(&after.as_str())
            {
                break;
            }
            return Some(if ch == '把' || ch == '将' {
                "处置式缺谓语"
            } else {
                "兼语式缺谓语"
            });
        }
    }

    None
}

/// 每个字符到片尾的「单位距离」：连续 ASCII 词元（含 `_-.`）整体记 1 个单位，
/// 其余每字 1 个单位。片尾字符距离为 0。
fn unit_offsets_from_end(chars: &[char]) -> Vec<usize> {
    let mut offsets = vec![0usize; chars.len()];
    let mut unit = 0usize;
    let mut previous_ascii_word = false;
    for index in (0..chars.len()).rev() {
        let ch = chars[index];
        let ascii_word = ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.');
        if index + 1 < chars.len() && !(ascii_word && previous_ascii_word) {
            unit += 1;
        }
        offsets[index] = unit;
        previous_ascii_word = ascii_word;
    }
    offsets
}

pub(crate) fn is_ideograph(ch: char) -> bool {
    matches!(ch, '\u{4E00}'..='\u{9FFF}' | '\u{3040}'..='\u{30FF}' | '\u{AC00}'..='\u{D7AF}')
}

/// 目标片边界疑似切进 CJK 词内：两侧都是 CJK 表意字符且缝上没有任何标点/
/// 空白。确定性切分器按字原子工作、没有词典，"简|化""思考如|何"这类词内
/// 切只能保守拦截。
///
/// 两侧都是谚文音节的缝不算：韩文按空格分词，原子是어절，原子之间的缝
/// 本来就是词界（0.5 之前逐音节的文稿靠词上的「贴前」标记拦，见
/// `layout::seam_grade`）。谚文挨着汉字 / 假名的缝仍按词内算。
pub(crate) fn cjk_midword_boundary(left: &str, right: &str) -> bool {
    let (Some(last), Some(first)) = (left.chars().next_back(), right.chars().next()) else {
        return false;
    };
    is_ideograph(last)
        && is_ideograph(first)
        && !(crate::atomize::is_hangul_syllable(last) && crate::atomize::is_hangul_syllable(first))
}

/// 片内是否存在能**真正解决超行**的全合法自由缝。四个条件缺一不可：
///
/// 1. 两侧都不超 fit —— 否则切了还是超行，只是多赔一片；
/// 2. 两侧都长于 [`MIN_PIECE_CHARS`] —— 闪现碎片不是一行字幕；
/// 3. 两侧都不触发客观级缝问题（[`is_objective_blocking`]）；
/// 4. 不落在 CJK 词内边界（切完必被 draft 门打回）。
///
/// 这是「超 fit 必须再切一刀」的前置条件，也是「有缝必须是**全合法**缝才
/// 强制」的判据本体：返回 `None` 的超 fit 片归 translation-unsplittable
/// 通道，保持整片交付（审计 §7 P0-a）。
pub fn free_seam(text: &str, lang: &str, params: &TransParams) -> Option<(String, String)> {
    let atoms = atomize(text);
    if atoms.len() < 2 {
        return None;
    }
    for cut in 1..atoms.len() {
        let left = join_word_texts(atoms[..cut].iter().map(String::as_str));
        let right = join_word_texts(atoms[cut..].iter().map(String::as_str));
        if left.trim().is_empty() || right.trim().is_empty() {
            continue;
        }
        // 缝必须由原文的标点或空白背书，与 DP 的缝分级同口径：CJK/Latin
        // 交界拼接出的渲染空格不是缝（「担心 | AI 会抢走…」切在动词和宾语
        // 从句之间），否则"有自由缝"会把明显更差的切法当成必须执行的要求。
        if !sentence_end(&left)
            && clause_end_char(&left).is_none()
            && !seam_backed_by_whitespace(text, &atoms, cut)
        {
            continue;
        }
        if [&left, &right].iter().any(|side| {
            exceeds_one_line_fit(side, lang, params.fit)
                || piece_display_units(side, lang) <= MIN_PIECE_CHARS
        }) {
            continue;
        }
        if cjk_midword_boundary(left.trim_end(), right.trim_start()) {
            continue;
        }
        let refs = [left.as_str(), right.as_str()];
        if lint_pieces(&refs, lang, params)
            .iter()
            .any(is_objective_blocking)
        {
            continue;
        }
        return Some((left, right));
    }
    None
}

/// 片尾是否为顿号（并列分隔符，不是展示缝）。
pub fn ends_list_separator(text: &str) -> bool {
    text.trim().chars().last() == Some('、')
}

/// 「数字 | 单位」跨缝：左片剥 closer 后以 ASCII 数字收尾，右片以数字后
/// 近乎无歧义的单位/量词开头。
fn number_unit_split(left: &str, right: &str) -> bool {
    let ends_digit = strip_closers(left.trim())
        .chars()
        .last()
        .is_some_and(|ch| ch.is_ascii_digit());
    if !ends_digit {
        return false;
    }
    let right = right.trim_start();
    NUMBER_UNIT_PREFIXES
        .iter()
        .any(|unit| right.starts_with(unit))
}

/// 「我们有一个 | 想改变的系统」一类跨片未完成名词短语。数量词本身可能
/// 合法省略，故只拦上表中的高置信度谓词尾，并要求下一片确有词汇内容。
fn incomplete_nominal_split(left: &str, right: &str) -> bool {
    let left = left.trim_end();
    if left.is_empty() || ends_clause_punct(left) {
        return false;
    }
    let right = right.trim_start();
    !right.is_empty()
        && INCOMPLETE_CJK_NOMINAL_TAILS
            .iter()
            .any(|tail| left.ends_with(tail))
}

/// 「… X ‖ 中/里/上… 」：方位后缀被切到右片，方位框架从中间断开。
///
/// 判据与片尾方位框架对称、同样取窄：左片须有显式引导词（在/从/对/往/向）
/// 或以数量/Latin 词元收尾，右片首字不得自身成词（中国/下面/内容…）。
fn leading_locative_split(left: &str, right: &str) -> bool {
    let left = left.trim_end();
    if left.is_empty() || ends_clause_punct(left) {
        return false;
    }
    let right = right.trim_start();
    let Some(head) = right.chars().next() else {
        return false;
    };
    if !LOCATIVE_SUFFIX_CJK.contains(&head) && head != '上' {
        return false;
    }
    let quantified = left
        .chars()
        .next_back()
        .is_some_and(|ch| ch.is_ascii_alphanumeric() || ch == '%' || ch == '％');
    let framed = left
        .chars()
        .rev()
        .take(FRAME_LOOKBACK + 2)
        .any(|ch| LOCATIVE_FRAME_CJK.contains(&ch));
    if !quantified && !framed {
        return false;
    }
    !LEADING_LOCATIVE_WORDS
        .iter()
        .any(|word| right.starts_with(word))
}

/// 「A 和 B ‖ 中心语」：缝落在第二个并列项之后，把并列 NP 与中心语切开。
///
/// 精度门（缺一不可）。「和」兼作介词（「很高兴和大家聊聊 ‖ 如何…」），
/// 误判会把合法缝拦下、把「悬空」换成「超行」，因此判据取窄：
/// 左片无句读收尾；第二个并列项必须**短且是名词性的**（单个 Latin/数字
/// 词元，或 ≤3 个表意字且不含重叠动词）——介词「和」后面跟的是「NP + 谓语」，
/// 长度上就落不进这个窗口；右片以表意字起首，且不是人称代词主语、
/// 转折/承接连词或疑问词引导的小句。
fn coordinated_head_split(left: &str, right: &str) -> bool {
    /// 第二个并列项的最大表意字数。
    const MAX_SECOND_ITEM_CHARS: usize = 3;
    const SUBJECT_PRONOUN_CJK: &[char] = &['我', '你', '他', '她', '它', '咱', '您'];
    /// 以这些词起首的右片是新小句，不是并列 NP 的中心语。
    const CLAUSE_OPENER_CJK: &[&str] = &[
        "如何",
        "怎么",
        "怎样",
        "什么",
        "为什么",
        "是否",
        "能否",
        "以及",
        "还是",
        "就是",
        "都是",
    ];
    let left = left.trim_end();
    if left.is_empty() || ends_clause_punct(left) {
        return false;
    }
    let right = right.trim_start();
    let Some(head) = right.chars().next() else {
        return false;
    };
    if !is_ideograph(head) || SUBJECT_PRONOUN_CJK.contains(&head) {
        return false;
    }
    if CUT_BEFORE_CJK
        .iter()
        .chain(CLAUSE_OPENER_CJK.iter())
        .any(|word| right.starts_with(word))
    {
        return false;
    }
    let chars: Vec<char> = left.chars().collect();
    let Some(index) = chars
        .iter()
        .rposition(|ch| LEADING_COORDINATOR_CJK.contains(ch))
    else {
        return false;
    };
    // 连词自身成词（和平/与其/及时…）时不是并列结构。
    let from_coordinator: String = chars[index..].iter().collect();
    if LEADING_COORDINATOR_WORDS
        .iter()
        .any(|word| from_coordinator.starts_with(word))
    {
        return false;
    }
    let second: Vec<char> = chars[index + 1..]
        .iter()
        .copied()
        .filter(|ch| !ch.is_whitespace())
        .collect();
    if second.is_empty() || second.iter().any(|ch| CLAUSE_PUNCT.contains(ch)) {
        return false;
    }
    if second
        .iter()
        .all(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
    {
        return true;
    }
    if second.len() > MAX_SECOND_ITEM_CHARS || !second.iter().all(|ch| is_ideograph(*ch)) {
        return false;
    }
    // 重叠动词（聊聊/看看）说明「和」是介词，后面是谓语不是并列项。
    !second.windows(2).any(|pair| pair[0] == pair[1])
}

/// 源词是否以语义缝标点收尾（分号/冒号/破折号；普通逗号不算）。
pub fn ends_semantic_seam_punct(text: &str) -> bool {
    let stripped = strip_closers(text.trim());
    stripped
        .chars()
        .last()
        .is_some_and(|ch| SEMANTIC_SEAM_PUNCT.contains(&ch))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SeamLintKind {
    /// 阻塞：触发 LLM 重试或兜底修复。
    Blocking,
    /// 建议：soft+1..hard 存在更优缝；不阻塞。
    Advisory,
}

/// 问题类别：悬垂/粘着是客观语病（worker 答案可据此回炉），闪现与
/// aim-band 是长度取舍（只提示）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeamLintClass {
    DanglingTail,
    /// 裸尾片落在语法上不可停顿的弱尾形上（结构助词/副词/助动词/量词/光动词）。
    WeakTail,
    BoundHead,
    IncompleteNominal,
    ListSeparator,
    /// 缝落在一对已闭合的成对定界符内部（引号/括号被切开）。
    UnpairedDelimiter,
    FlashFragment,
    AimBand,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeamLintIssue {
    pub piece_index: usize,
    pub kind: SeamLintKind,
    pub class: SeamLintClass,
    pub message: String,
}

/// 客观语病级问题（悬垂尾/黏着首的 Blocking）：引擎验收回炉与 `task submit`
/// 提交期 lint 共用此判定——两侧规则不一致时，worker 会在提交期通过、到
/// 引擎聚合 repair 批才被打回，凭空多一次调用（p850 基准实测）。
pub fn is_objective_blocking(issue: &SeamLintIssue) -> bool {
    issue.kind == SeamLintKind::Blocking
        && matches!(
            issue.class,
            SeamLintClass::DanglingTail
                | SeamLintClass::WeakTail
                | SeamLintClass::BoundHead
                | SeamLintClass::IncompleteNominal
                | SeamLintClass::ListSeparator
                | SeamLintClass::UnpairedDelimiter
        )
}

/// 缝是否落在一对已闭合的成对定界符内部。返回 `(缝下标, 该定界符跨度的
/// 目标语阅读单位数)`，缝下标即右片下标。
///
/// 只认**已闭合**的定界符对：整句只有半个引号（ASR/译文本身不配对）时任何
/// 切分都躲不开，不应反复打回 worker。跨度按纯拼接计（不补 `sep_len` 空格），
/// 只用于和 hard 比较，误差至多一个空格。
fn delimiter_pair_seams(pieces: &[&str], lang: &str) -> Vec<(usize, usize)> {
    let mut chars: Vec<char> = Vec::new();
    let mut bounds: Vec<usize> = Vec::with_capacity(pieces.len());
    for text in pieces {
        bounds.push(chars.len());
        chars.extend(text.chars());
    }
    let mut stack: Vec<(char, usize)> = Vec::new();
    let mut spans: Vec<(usize, usize)> = Vec::new();
    for (pos, ch) in chars.iter().copied().enumerate() {
        if DELIM_PAIRS.iter().any(|(open, _)| *open == ch) {
            stack.push((ch, pos));
            continue;
        }
        if let Some(open) = DELIM_PAIRS
            .iter()
            .find(|(_, close)| *close == ch)
            .map(|(open, _)| *open)
            && let Some(at) = stack.iter().rposition(|(pending, _)| *pending == open)
        {
            spans.push((stack[at].1, pos));
            stack.truncate(at);
        }
    }
    (1..pieces.len())
        .filter_map(|index| {
            let seam = bounds[index];
            let (open, close) = spans
                .iter()
                .copied()
                .find(|(open, close)| *open < seam && seam <= *close)?;
            let span: String = chars[open..=close].iter().collect();
            Some((index, target_cps_chars(&span, lang)))
        })
        .collect()
}

/// 对一组片做缝质量 lint。`lang`/`params` 用于 aim-band advisory。
pub fn lint_pieces(pieces: &[&str], lang: &str, params: &TransParams) -> Vec<SeamLintIssue> {
    let mut issues = Vec::new();
    if pieces.is_empty() {
        return issues;
    }
    let pair_seams = delimiter_pair_seams(pieces, lang);
    for (index, text) in pieces.iter().enumerate() {
        // 片自身的展示宽度按契约口径计（片尾标点免费）；参与合并可行性求和
        // 时,作为合并结果**头部**的片其片尾标点会变成行内负担,须按
        // `target_cps_chars` 全额计,作为**尾部**的片仍按本口径计。
        let chars = piece_display_units(text, lang);
        // 末片可悬垂（下一句续接）；中间片不行。
        // 消息里的 piece 序号一律 1 基（"piece 2/4"）：与 validate_source_shape
        // 的 segment 序号同基。p850 基准实测 worker 把 0 基 "piece 1" 读成
        // 第 1 片，对着错误的片改答案。
        let ordinal = index + 1;
        let total = pieces.len();
        if index + 1 < pieces.len() && ends_dangling(text) {
            issues.push(SeamLintIssue {
                piece_index: index,
                kind: SeamLintKind::Blocking,
                class: SeamLintClass::DanglingTail,
                message: format!(
                    "piece {ordinal}/{total} ends on a dangling connective — keep it with the words it attaches to"
                ),
            });
        }
        // 弱尾（得/在…上/副词/助动词/量词/光动词）与悬垂连词是同一类语病的
        // 不同尾形；已判 DanglingTail 的片不重复报。
        if index + 1 < pieces.len()
            && !ends_dangling(text)
            && let Some((kind, form)) = ends_weak_tail(text)
        {
            issues.push(SeamLintIssue {
                piece_index: index,
                kind,
                class: SeamLintClass::WeakTail,
                message: format!(
                    "piece {ordinal}/{total} ends on 「{form}」, which still needs the words that follow — move the cut later or merge with the next piece"
                ),
            });
        }
        if index > 0 && starts_dangling(text) && !ends_clause_punct(pieces[index - 1]) {
            let coordinator = text
                .trim()
                .chars()
                .next()
                .is_some_and(|ch| LEADING_COORDINATOR_CJK.contains(&ch));
            issues.push(SeamLintIssue {
                piece_index: index,
                kind: SeamLintKind::Blocking,
                class: SeamLintClass::BoundHead,
                message: if coordinator {
                    format!(
                        "piece {ordinal}/{total} starts with the coordinator 和/及/与/或 — never cut before it; keep the coordinated items in one piece"
                    )
                } else {
                    format!(
                        "piece {ordinal}/{total} starts with a bound particle — keep it with the preceding words"
                    )
                },
            });
        }
        // 方位后缀落在片首：方位框架被从中间切开（「从你现有的 GPU ‖
        // 中获得…」）。与片尾方位框架判据是同一语病的对称面。
        if index > 0 && leading_locative_split(pieces[index - 1], text) {
            issues.push(SeamLintIssue {
                piece_index: index,
                kind: SeamLintKind::Blocking,
                class: SeamLintClass::BoundHead,
                message: format!(
                    "piece {ordinal}/{total} starts with a locative suffix bound to the preceding noun phrase — keep the whole 在/从…里/中/上 frame in one piece"
                ),
            });
        }
        if index > 0 && number_unit_split(pieces[index - 1], text) {
            issues.push(SeamLintIssue {
                piece_index: index,
                kind: SeamLintKind::Blocking,
                class: SeamLintClass::BoundHead,
                message: format!(
                    "piece {ordinal}/{total} starts with a unit or measure word bound to the number ending the previous piece — move the cut after the full quantity"
                ),
            });
        }
        // 并列结构的对称面：`LEADING_COORDINATOR_CJK` 只禁止切在「和/及/与」
        // **之前**，切在**第二个并列项之后**同样会把并列 NP 与其中心语切开
        //（R3「…存了那些 Key 和 Value ‖ 矩阵，…」）。
        if index > 0 && coordinated_head_split(pieces[index - 1], text) {
            issues.push(SeamLintIssue {
                piece_index: index - 1,
                kind: SeamLintKind::Blocking,
                class: SeamLintClass::IncompleteNominal,
                message: format!(
                    "piece {index}/{total} ends right after the second coordinated item — never cut after it either; keep the coordinated phrase with its head noun"
                ),
            });
        }
        if index > 0 && incomplete_nominal_split(pieces[index - 1], text) {
            issues.push(SeamLintIssue {
                piece_index: index - 1,
                kind: SeamLintKind::Blocking,
                class: SeamLintClass::IncompleteNominal,
                message: format!(
                    "piece {index}/{total} ends with an incomplete Chinese nominal phrase — keep its classifier/determiner with the following head noun"
                ),
            });
        }
        // 顿号是并列分隔符不是缝：短并列项被拆开时应合并；合并会超 hard 的
        // 长枚举保留缝但提示。
        if index > 0 && ends_list_separator(pieces[index - 1]) {
            let merged = target_cps_chars(pieces[index - 1], lang) + chars;
            issues.push(SeamLintIssue {
                piece_index: index - 1,
                kind: if merged <= params.hard {
                    SeamLintKind::Blocking
                } else {
                    SeamLintKind::Advisory
                },
                class: SeamLintClass::ListSeparator,
                message: format!(
                    "piece {index}/{total} ends on the list separator 、 — merge the list items or cut at a stronger seam"
                ),
            });
        }
        // 引号/括号内部不是缝：被引内容应整片保留。定界符跨度**达到** hard
        // 时切分不可避免，降级为提示，避免 worker 反复回炉。口径必须是
        // `span < hard`：span == hard 的整引片虽不超限，但它无法再容纳任何
        // 引号外文字，逼 worker 单拆引内内容——s-g25.25 基准实测 advisory 推荐
        // 的切法正是 submit lint 以 Blocking 拒绝的切法，形成不可满足闭环。
        if let Some((_, span)) = pair_seams.iter().copied().find(|(seam, _)| *seam == index) {
            issues.push(SeamLintIssue {
                piece_index: index - 1,
                kind: if span < params.hard {
                    SeamLintKind::Blocking
                } else {
                    SeamLintKind::Advisory
                },
                class: SeamLintClass::UnpairedDelimiter,
                message: format!(
                    "piece {index}/{total} ends inside a paired delimiter — keep the quoted or bracketed span in one piece"
                ),
            });
        }
        if pieces.len() > 1 && chars <= MIN_PIECE_CHARS {
            let mut can_merge = false;
            if index > 0
                && !ends_sentence_final(pieces[index - 1])
                && target_cps_chars(pieces[index - 1], lang) + chars <= params.hard
            {
                can_merge = true;
            }
            if index + 1 < pieces.len()
                && target_cps_chars(text, lang) + piece_display_units(pieces[index + 1], lang)
                    <= params.hard
            {
                can_merge = true;
            }
            issues.push(SeamLintIssue {
                piece_index: index,
                kind: if can_merge {
                    SeamLintKind::Blocking
                } else {
                    SeamLintKind::Advisory
                },
                class: SeamLintClass::FlashFragment,
                message: format!(
                    "piece {ordinal}/{total} is a {chars}-char flash fragment — merge it with a compatible neighbor when the hard limit allows"
                ),
            });
        }
        if chars > params.soft && chars <= params.hard {
            if let Some(split) = preferred_target_split(text, lang, params.soft, Some(params.hard))
            {
                issues.push(SeamLintIssue {
                    piece_index: index,
                    kind: SeamLintKind::Advisory,
                    class: SeamLintClass::AimBand,
                    message: format!(
                        "piece {ordinal}/{total} is {chars} chars — above the {}-char aim; preferred {} cut (\"{}\" | \"{}\") is optional",
                        params.soft, split.reason, split.left, split.right
                    ),
                });
            }
        }
    }
    issues
}

/// 合并相邻片以消除阻塞级缝问题；拼接不变量保持。
pub fn repair_lint_pieces(pieces: Vec<String>, lang: &str, params: &TransParams) -> Vec<String> {
    let mut current = pieces;
    for _ in 0..current.len().saturating_mul(2).max(1) {
        let refs: Vec<&str> = current.iter().map(String::as_str).collect();
        let blocking: Vec<_> = lint_pieces(&refs, lang, params)
            .into_iter()
            .filter(|issue| issue.kind == SeamLintKind::Blocking)
            .collect();
        if blocking.is_empty() || current.len() <= 1 {
            break;
        }
        // 优先合并闪现片与邻片；其次把悬垂结尾片并入后片 / 黏着开头片并入前片。
        let index = blocking[0].piece_index;
        let chars = piece_display_units(&current[index], lang);
        let short_tag_fits_previous = chars <= MIN_PIECE_CHARS
            && index > 0
            && !ends_sentence_final(&current[index - 1])
            && target_cps_chars(&current[index - 1], lang) + chars <= params.hard;
        let next_fits = index + 1 < current.len()
            && target_cps_chars(&current[index], lang)
                + piece_display_units(&current[index + 1], lang)
                <= params.hard;
        let previous_fits =
            index > 0 && target_cps_chars(&current[index - 1], lang) + chars <= params.hard;
        let merge_with_next = if short_tag_fits_previous {
            false
        } else if next_fits {
            true
        } else if previous_fits {
            false
        } else {
            // 展示 hard 是交付不变量。没有任一相邻片可安全吸收时保留当前缝，
            // 交给定向 LLM 精修；绝不能为消除 lint 制造 over-hard 译片。
            break;
        };
        let (left, right) = if merge_with_next {
            (index, index + 1)
        } else {
            (index - 1, index)
        };
        let merged = join_word_texts([current[left].as_str(), current[right].as_str()]);
        current.splice(left..=right, [merged]);
    }
    current
}

/// worker 答案的接受后修复：只合并"可安全并入邻片"的闪现碎片（Blocking 级
/// FlashFragment），文本与句内源词区间同步合并。悬垂/粘着缝在验收侧已拒绝，
/// 这里不改其他缝；保持 ≥2 片、绝不产出超 hard 片。选边逻辑与
/// [`repair_lint_pieces`] 一致。
pub fn repair_flash_pieces_with_ranges(
    pieces: Vec<(String, (usize, usize))>,
    lang: &str,
    params: &TransParams,
) -> Vec<(String, (usize, usize))> {
    let mut current = pieces;
    for _ in 0..current.len().saturating_mul(2).max(1) {
        if current.len() <= 2 {
            break;
        }
        let refs: Vec<&str> = current.iter().map(|(text, _)| text.as_str()).collect();
        let Some(issue) = lint_pieces(&refs, lang, params).into_iter().find(|issue| {
            issue.kind == SeamLintKind::Blocking && issue.class == SeamLintClass::FlashFragment
        }) else {
            break;
        };
        let index = issue.piece_index;
        let chars = piece_display_units(&current[index].0, lang);
        let short_tag_fits_previous = chars <= MIN_PIECE_CHARS
            && index > 0
            && !ends_sentence_final(&current[index - 1].0)
            && target_cps_chars(&current[index - 1].0, lang) + chars <= params.hard;
        let next_fits = index + 1 < current.len()
            && target_cps_chars(&current[index].0, lang)
                + piece_display_units(&current[index + 1].0, lang)
                <= params.hard;
        let previous_fits =
            index > 0 && target_cps_chars(&current[index - 1].0, lang) + chars <= params.hard;
        let merge_with_next = if short_tag_fits_previous {
            false
        } else if next_fits {
            true
        } else if previous_fits {
            false
        } else {
            break;
        };
        let (left, right) = if merge_with_next {
            (index, index + 1)
        } else {
            (index - 1, index)
        };
        let merged_text = join_word_texts([current[left].0.as_str(), current[right].0.as_str()]);
        let merged_range = (current[left].1.0, current[right].1.1);
        current.splice(left..=right, [(merged_text, merged_range)]);
    }
    current
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreferredTargetSplit {
    pub left: String,
    pub right: String,
    pub cut_offset: usize,
    pub left_chars: usize,
    pub right_chars: usize,
    pub reason: String,
}

fn ascii_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

/// 在目标语文本中找一条平衡的自然缝；无安全候选时返回 `None`。
pub fn preferred_target_split(
    text: &str,
    lang: &str,
    aim: usize,
    hard: Option<usize>,
) -> Option<PreferredTargetSplit> {
    if aim == 0 {
        return None;
    }
    let trimmed = text.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    let total = count_cps_chars(trimmed);
    if total <= aim || chars.len() < 2 {
        return None;
    }
    let is_cjk = is_cjk_lang(lang);
    let mut candidates: Vec<(usize, i32, String)> = Vec::new();

    let mut i = 0;
    while i + 1 < chars.len() {
        if !STRONG_CLAUSE_PUNCT.contains(&chars[i]) {
            i += 1;
            continue;
        }
        let punct = chars[i];
        if i > 0 && i + 1 < chars.len() {
            let left = chars[i - 1];
            let right = chars[i + 1];
            let glued = ascii_word_char(left) && ascii_word_char(right);
            if matches!(punct, '.' | ':') && glued {
                i += 1;
                continue;
            }
            if punct == ',' && left.is_ascii_digit() && right.is_ascii_digit() {
                i += 1;
                continue;
            }
        }
        if !is_cjk && punct == '.' {
            let mut start = i;
            while start > 0 && !chars[start - 1].is_whitespace() {
                start -= 1;
            }
            let token: String = chars[start..=i].iter().collect::<String>().to_lowercase();
            // 缩写 / 点号单字母串（Dr. / U.S.）不是从句缝。
            if !sentence_end(&token) {
                i += 1;
                continue;
            }
        }
        let mut j = i;
        while j + 1 < chars.len() && STRONG_CLAUSE_PUNCT.contains(&chars[j + 1]) {
            j += 1;
        }
        while j + 1 < chars.len() && CLOSERS.contains(&chars[j + 1]) {
            j += 1;
        }
        let offset = j + 1;
        if offset < chars.len() {
            candidates.push((offset, 0, format!("clause punctuation {punct}")));
        }
        i = i.max(j) + 1;
    }

    if is_cjk && chars.len() >= 3 {
        for at in 1..(chars.len() - 1) {
            if at + 1 >= chars.len() {
                break;
            }
            let word: String = chars[at..=at + 1].iter().collect();
            if CUT_BEFORE_CJK.contains(&word.as_str()) {
                candidates.push((at, 1, format!("discourse connective {word}")));
            }
        }
    }

    if !is_cjk {
        let mut w = 1;
        while w + 1 < chars.len() {
            if !chars[w].is_whitespace() || chars[w - 1].is_whitespace() {
                w += 1;
                continue;
            }
            let mut s = w;
            while s < chars.len() && chars[s].is_whitespace() {
                s += 1;
            }
            if s >= chars.len() {
                break;
            }
            let mut e = s;
            let mut word = String::new();
            while e < chars.len() && chars[e].is_alphabetic() {
                word.push(chars[e]);
                e += 1;
            }
            if CUT_BEFORE_LATIN.contains(&word.to_ascii_lowercase().as_str()) {
                candidates.push((w, 1, format!("discourse connective {word}")));
            }
            w = s.max(w + 1);
        }
    }

    let min_side = (if is_cjk { 7 } else { 10 }).max(((aim as f64) * 0.30).ceil() as usize);
    let min_ratio = if is_cjk { 0.40 } else { 0.35 };
    let mut best: Option<(PreferredTargetSplit, i32, usize, usize)> = None;
    let mut seen = std::collections::BTreeSet::new();
    for (offset, tier, reason) in candidates {
        if !seen.insert(offset) {
            continue;
        }
        // 基础安全：不切开 ASCII 词内部、不落在 opener 后 / closer 前。
        if offset == 0 || offset >= chars.len() {
            continue;
        }
        let left_ch = chars[offset - 1];
        let right_ch = chars[offset];
        if ascii_word_char(left_ch) && ascii_word_char(right_ch) {
            continue;
        }
        let left: String = chars[..offset].iter().collect::<String>().trim().to_owned();
        let right: String = chars[offset..].iter().collect::<String>().trim().to_owned();
        let ln = count_cps_chars(&left);
        let rn = count_cps_chars(&right);
        let short = ln.min(rn);
        let long = ln.max(rn);
        if ln < min_side || rn < min_side || long == 0 {
            continue;
        }
        if (short as f64) / (long as f64) < min_ratio {
            continue;
        }
        if ends_dangling(&left) {
            continue;
        }
        if starts_dangling(&right) && !ends_clause_punct(&left) {
            continue;
        }
        // 弱尾罚分：Blocking 级尾形直接淘汰（这种缝一产生就会被 lint 打回），
        // Advisory 级降一档 tier，使同等宽度下切点后移。
        let tier = match ends_weak_tail(&left) {
            Some((SeamLintKind::Blocking, _)) => continue,
            Some((SeamLintKind::Advisory, _)) => tier + 1,
            None => tier,
        };
        let overflow = hard.map_or(0, |h| ln.saturating_sub(h) + rn.saturating_sub(h));
        let imbalance = ln.abs_diff(rn);
        let split = PreferredTargetSplit {
            left,
            right,
            cut_offset: offset,
            left_chars: ln,
            right_chars: rn,
            reason,
        };
        let ranked = (split, tier, overflow, imbalance);
        let better = match &best {
            None => true,
            Some((_, bt, bo, bi)) => {
                tier < *bt
                    || (tier == *bt && overflow < *bo)
                    || (tier == *bt && overflow == *bo && imbalance < *bi)
                    || (tier == *bt
                        && overflow == *bo
                        && imbalance == *bi
                        && ranked.0.cut_offset < best.as_ref().unwrap().0.cut_offset)
            }
        };
        if better {
            best = Some(ranked);
        }
    }
    best.map(|(split, _, _, _)| split)
}

/// Latin 零 LLM 预拆：未超 fit、超 aim、有平衡目标缝 + 源语义缝 + 两侧 ≥1s。
/// 返回两片 `(text, from_word, to_word)`；不满足条件时 `None`。
pub fn latin_semantic_presplit(
    translation: &str,
    words: &[&Word],
    lang: &str,
    params: &TransParams,
) -> Option<Vec<(String, usize, usize)>> {
    if is_cjk_lang(lang) || words.len() < 2 {
        return None;
    }
    if crate::split::exceeds_one_line_fit(translation, lang, params.fit) {
        return None;
    }
    let split = preferred_target_split(translation, lang, params.soft, Some(params.hard))?;
    let mut source_seams = Vec::new();
    for (index, word) in words.iter().enumerate() {
        if index + 1 >= words.len() {
            break;
        }
        if sentence_end(&word.text) || ends_semantic_seam_punct(&word.text) {
            source_seams.push(index);
        }
    }
    if source_seams.is_empty() {
        return None;
    }
    let start = words[0].t0;
    let end = words[words.len() - 1].t1;
    let span = (end - start).max(0.01);
    let target_total = (split.left_chars + split.right_chars).max(1);
    let target_fraction = split.left_chars as f64 / target_total as f64;
    let mut ranked: Vec<(usize, f64)> = source_seams
        .into_iter()
        .map(|seam| {
            let fraction = (words[seam].t1 - start) / span;
            (seam, (fraction - target_fraction).abs())
        })
        .collect();
    ranked.sort_by(|a, b| {
        a.1.partial_cmp(&b.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.0.cmp(&b.0))
    });
    let &(seam, divergence) = ranked.first()?;
    if divergence > SNAP_RATIO_DIVERGENCE {
        return None;
    }
    let left_duration = words[seam].t1 - start;
    let right_duration = end - words[seam + 1].t0;
    if left_duration + 1e-9 < MIN_CUE_DISPLAY_SEC || right_duration + 1e-9 < MIN_CUE_DISPLAY_SEC {
        return None;
    }
    Some(vec![
        (split.left, 0, seam),
        (split.right, seam + 1, words.len() - 1),
    ])
}

/// over-fit / 缝预览清单条目（供 `bcut check` / align list 消费）。
#[derive(Debug, Clone, PartialEq)]
pub struct AlignListEntry {
    pub key: String,
    pub fit_chars: usize,
    pub over_hard: bool,
    pub over_fit: bool,
    pub seam_left: Option<String>,
    pub seam_right: Option<String>,
    pub seam_reason: Option<String>,
}

/// 扫描已译句，列出超 fit / 超 hard 及可选 preferred seam。
pub fn align_list_entries(
    translations: &[(String, String)],
    lang: &str,
    params: &TransParams,
) -> Vec<AlignListEntry> {
    let mut out = Vec::new();
    for (key, text) in translations {
        let fit_chars = piece_display_units(text, lang);
        let over_hard = fit_chars > params.hard;
        let over_fit = over_hard || crate::split::exceeds_one_line_fit(text, lang, params.fit);
        if !over_fit {
            continue;
        }
        let seam = preferred_target_split(text, lang, params.soft, Some(params.hard));
        out.push(AlignListEntry {
            key: key.clone(),
            fit_chars,
            over_hard,
            over_fit,
            seam_left: seam.as_ref().map(|s| s.left.clone()),
            seam_right: seam.as_ref().map(|s| s.right.clone()),
            seam_reason: seam.map(|s| s.reason),
        });
    }
    out
}

/// 源词边界的缝强度。`boundary` 是右片首词下标(1..words.len());0 = 非缝。
/// 3 = 左词带从句/句末标点;2 = 右词是连词/关系词;1 = 右词是介词/不定式 to。
pub(crate) fn source_boundary_strength(words: &[&str], boundary: usize) -> u8 {
    if boundary == 0 || boundary >= words.len() {
        return 0;
    }
    let left = words[boundary - 1].trim();
    if ends_clause_punct(left) || sentence_end(left) {
        return 3;
    }
    let right = words[boundary].trim();
    let right_tok: String = right
        .to_ascii_lowercase()
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_owned();
    if CUT_BEFORE_LATIN.contains(&right_tok.as_str())
        || CUT_BEFORE_CJK.iter().any(|w| right.starts_with(w))
    {
        return 2;
    }
    if CUT_BEFORE_LATIN_WEAK.contains(&right_tok.as_str()) {
        return 1;
    }
    0
}

/// 把修复后的文本片重新锚定到源词区间:先按字符占比划分,再把每个内部边界
/// 在 ±ANCHOR_SNAP_WINDOW 词窗口内吸附到最近的源语义缝(距离优先,同距离取
/// 强度高者)。占比裸切会落在 `make|changes` 这类短语内部;吸附不到才保持
/// 占比位置。
pub fn reanchor_texts(texts: Vec<String>, source_words: &[&str], lang: &str) -> Vec<TransPiece> {
    use crate::split::anchor_pieces_to_words;
    let word_count = source_words.len();
    let piece_cps: Vec<usize> = texts
        .iter()
        .map(|text| target_cps_chars(text, lang))
        .collect();
    let ranges = if texts.len() <= word_count && !texts.is_empty() {
        anchor_pieces_to_words(&piece_cps, word_count)
    } else {
        vec![(0, word_count.saturating_sub(1))]
    };
    if texts.len() == 1 || ranges.len() != texts.len() {
        return vec![TransPiece {
            from: Some(0),
            to: Some(word_count.saturating_sub(1)),
            text: texts.into_iter().next().unwrap_or_default(),
        }];
    }
    let k = texts.len();
    // 内部边界 = 每片右邻的起始词下标;逐个左→右吸附,保持严格递增且给后续
    // 片留 ≥1 词。
    let mut bounds: Vec<usize> = ranges.iter().take(k - 1).map(|&(_, to)| to + 1).collect();
    let mut prev = 0usize;
    for i in 0..bounds.len() {
        let ideal = bounds[i];
        let hi_cap = word_count - (k - 1 - i);
        let lo = (prev + 1).max(ideal.saturating_sub(ANCHOR_SNAP_WINDOW));
        let hi = hi_cap.min(ideal + ANCHOR_SNAP_WINDOW);
        let mut best: Option<(usize, u8, usize)> = None; // (distance, strength, pos)
        for pos in lo..=hi {
            let strength = source_boundary_strength(source_words, pos);
            if strength == 0 {
                continue;
            }
            let distance = pos.abs_diff(ideal);
            let better = match best {
                None => true,
                Some((bd, bs, bp)) => {
                    distance < bd
                        || (distance == bd && strength > bs)
                        || (distance == bd && strength == bs && pos < bp)
                }
            };
            if better {
                best = Some((distance, strength, pos));
            }
        }
        bounds[i] = best.map_or(ideal.clamp(prev + 1, hi_cap), |(_, _, pos)| pos);
        prev = bounds[i];
    }
    let mut out = Vec::with_capacity(k);
    let mut start = 0usize;
    for (index, text) in texts.into_iter().enumerate() {
        let end = if index + 1 < k {
            bounds[index] - 1
        } else {
            word_count - 1
        };
        out.push(TransPiece {
            from: Some(start),
            to: Some(end),
            text,
        });
        start = end + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 两侧都是谚文的缝是어절之间的词界，不算切进词内；汉字 / 假名之间、
    /// 谚文挨着汉字的缝照旧算。
    #[test]
    fn a_seam_between_two_hangul_units_is_a_word_boundary() {
        assert!(cjk_midword_boundary("简", "化"));
        assert!(cjk_midword_boundary("いい天", "気"));
        assert!(!cjk_midword_boundary("저는 내일", "아이폰을 샀다"));
        assert!(cjk_midword_boundary("한", "字"));
        assert!(cjk_midword_boundary("字", "한"));
        assert!(!cjk_midword_boundary("저는", "iPhone"));
        assert!(!cjk_midword_boundary("", "한"));
    }

    #[test]
    fn dangling_and_particle_detection() {
        assert!(ends_dangling("工具和"));
        assert!(!ends_dangling("工具和。"));
        assert!(ends_dangling("alpha and"));
        assert!(!ends_dangling("alpha and."));
        assert!(ends_dangling("matters—the"));
        assert!(starts_dangling("了吗"));
        assert!(starts_dangling("的时候"));
        // 「的确」表面以「的」开头；是否违规还要看前片是否句读——单侧函数仍为 true。
        assert!(starts_dangling("的确"));
        assert!(ends_clause_punct("开心。"));
        assert!(ends_sentence_final("完成。"));
        assert!(ends_sentence_final("Done.\""));
        assert!(!ends_sentence_final("完成，"));
    }

    /// p1215 真实样本：ASR 原生的假句末在润色后仍然残留。
    #[test]
    fn dangling_sentence_end_flags_false_periods() {
        assert!(dangling_sentence_end(
            "I don't normally sound like this, but."
        ));
        assert!(dangling_sentence_end("It's a good example of."));
        assert!(dangling_sentence_end("And."));
        assert!(dangling_sentence_end("我们把它拆成两块，然后把结果和。"));
        // 正常句末不报。
        assert!(!dangling_sentence_end("We are done now."));
        assert!(!dangling_sentence_end("这就是我们的目的。"));
        assert!(!dangling_sentence_end("a."));
        // 不以句末标点收尾的句子（gap/词数封口）不在判据内。
        assert!(!dangling_sentence_end("alpha and"));
        assert!(!dangling_sentence_end("alpha and,"));
        // 剥引号后仍能判。
        assert!(dangling_sentence_end("he called it the.\""));
        // wh 宾语已经前置的合法介词悬置不能误报；远处只有 wh 词、没有从句主语
        // 时仍是残缺结尾。
        assert!(!dangling_sentence_end("This is what it connects to."));
        assert!(!dangling_sentence_end(
            "Which means we check what it reaches out to."
        ));
        assert!(!dangling_sentence_end(
            "This is what it's a good example of."
        ));
        assert!(dangling_sentence_end(
            "We need to decide what to do because of."
        ));
        // 不定式省略：`to` 标记被省略的动词短语，句子完整（skill 试用实测
        // `want to.` 被 polish 验收打回）。
        assert!(!dangling_sentence_end(
            "They can slow down any time they want to."
        ));
        assert!(!dangling_sentence_end("You don't have to."));
        assert!(!dangling_sentence_end("I was going to!"));
        assert!(!dangling_sentence_end("We're supposed to."));
        // 不是许可动词之后的 `to` 仍是假句末。
        assert!(dangling_sentence_end("Then we went to."));
        assert!(dangling_sentence_end("To."));
        assert!(!dangling_sentence_end("是的。"));
        assert!(!dangling_sentence_end("这件事情是很重要的。"));
        assert!(dangling_sentence_end("的。"));
        assert!(!dangling_sentence_end("这是一个完全不同的方向。"));
        assert!(!dangling_sentence_end("最后需要做一个对比。"));
        assert!(!dangling_sentence_end("它是一系列问题的总和。"));
        assert!(!dangling_sentence_end("这条路你跟不跟？"));
        assert!(contains_dangling_sentence_end(
            "上一句完整。就是说当。你的 group 越多，效果越明显。"
        ));
        assert!(contains_dangling_sentence_end(
            "对。所以我们在 IMAGE 上看到了 SKILLING BEHAVIOR. 就是说当。 ，你的 GROUP 的数目越多。"
        ));
        assert!(!contains_dangling_sentence_end(
            "上一句完整。就是说当你的 group 越多，效果越明显。"
        ));
    }

    /// p-fb353b44 实测：ASCII 省略号收尾的悬垂句末曾是整条链的盲区。
    ///
    /// `atomize::sentence_end` 的 `2.14` / `a.com` 守卫会因为词干里还留着 `.`
    /// 而拒绝把 `but...` 认成句末，于是最后一个句末原子之后的整条尾巴被静默
    /// 丢弃、扫描恒返回 false——而 `bcut check` 直接调用的
    /// [`dangling_sentence_end`] 照样告警。两条路径必须给同一个答案，否则
    /// `polish-retry` 只要把句末 `.` 改成 `...` 就能骗过验收。
    #[test]
    fn trailing_residue_after_the_last_sentence_end_is_still_scanned() {
        // 单独喂给整句判据是 true，走整段扫描也必须是 true。
        assert!(dangling_sentence_end(
            "I don't normally sound like this, but..."
        ));
        assert!(contains_dangling_sentence_end(
            "I don't normally sound like this, but..."
        ));
        assert!(contains_dangling_sentence_end("上一句完整。就是说当..."));
        // Unicode 省略号本来就没进盲区，回归保护。
        assert!(contains_dangling_sentence_end("上一句完整。就是说当…"));
        // 残段不以句末标点收尾（话没说完的段尾）不算悬垂句末。
        assert!(!contains_dangling_sentence_end("上一句完整。就是说当"));
        assert!(!contains_dangling_sentence_end("alpha and"));
        // 正常收尾的整段不受影响。
        assert!(!contains_dangling_sentence_end(
            "We are done now. It works..."
        ));
        assert!(!contains_dangling_sentence_end("版本是 2.14"));
        assert!(!contains_dangling_sentence_end("他们搬去了 the U.S."));
    }

    #[test]
    fn conflicting_punctuation_and_collapsed_latin_atoms_are_detected() {
        assert!(contains_conflicting_punctuation("事情。，然后继续。"));
        assert!(contains_conflicting_punctuation("事情，。然后继续。"));
        assert!(contains_conflicting_punctuation("讲完了，，大家面面相觑。"));
        assert!(contains_conflicting_punctuation("somewhere,; then"));
        assert!(contains_conflicting_punctuation("done., then"));
        assert!(!contains_conflicting_punctuation("真的吗？！当然！"));
        assert!(!contains_conflicting_punctuation("版本 1.0，继续。"));

        assert!(contains_likely_collapsed_latin_atom(
            "反 purereinforcementlearning，至少",
            20
        ));
        assert!(!contains_likely_collapsed_latin_atom(
            "pure reinforcement learning",
            20
        ));
        assert!(!contains_likely_collapsed_latin_atom(
            "state-of-the-art model-v2",
            20
        ));
    }

    /// R2 代码先修：冲突相邻标点由代码归一，不再回灌给模型重掷整页。
    /// 归一化必须与检测判据严格互补——输出恒不再命中检测。
    #[test]
    fn conflicting_punctuation_is_normalized_deterministically() {
        // 句末赢：丢掉相邻的弱标点，不论前后。
        assert_eq!(
            normalize_conflicting_punctuation("事情。，然后继续。"),
            "事情。然后继续。"
        );
        assert_eq!(
            normalize_conflicting_punctuation("事情，。然后继续。"),
            "事情。然后继续。"
        );
        // 两个分句标点保留前一个；连消解也不留下新的冲突对。
        assert_eq!(
            normalize_conflicting_punctuation("讲完了，，大家"),
            "讲完了，大家"
        );
        assert_eq!(
            normalize_conflicting_punctuation("讲完了，，。大家"),
            "讲完了。大家"
        );
        assert_eq!(
            normalize_conflicting_punctuation("somewhere,; then"),
            "somewhere, then"
        );
        assert_eq!(
            normalize_conflicting_punctuation("done., then"),
            "done. then"
        );
        // `..` → `.`；`...` 是省略号，原样保留。
        assert_eq!(
            normalize_conflicting_punctuation("done.. next"),
            "done. next"
        );
        assert_eq!(
            normalize_conflicting_punctuation("wait... ok"),
            "wait... ok"
        );
        // 合法组合语气与小数点不受影响。
        assert_eq!(
            normalize_conflicting_punctuation("真的吗？！当然！"),
            "真的吗？！当然！"
        );
        assert_eq!(
            normalize_conflicting_punctuation("版本 1.0，继续。"),
            "版本 1.0，继续。"
        );
        // 互补性：归一化后恒不再命中检测。
        for sample in [
            "事情。，然后。",
            "事情，。然后。",
            "讲完了，，，大家。",
            "a,;.b",
            "done., then",
        ] {
            let normalized = normalize_conflicting_punctuation(sample);
            assert!(
                !contains_conflicting_punctuation(&normalized),
                "{sample:?} → {normalized:?}"
            );
        }
    }

    #[test]
    fn de_tail_is_dangling_except_complete_nouns() {
        // 定语「的」悬垂（p850 基准草稿实测「…的 | 名词」两处落库）。
        assert!(ends_dangling("这是我们生成的"));
        assert!(!ends_dangling("这是我们生成的。"));
        // 以「的」收尾的完整词不算悬垂。
        assert!(!ends_dangling("这就是我们的目的"));
        assert!(!ends_dangling("有的"));
        assert!(!ends_dangling("像做梦似的"));
    }

    #[test]
    fn lint_blocks_number_unit_split() {
        let params = TransParams::for_lang("zh");
        let pieces = ["他们每月要花 1000", "美元购买这些服务。"];
        let issues = lint_pieces(&pieces, "zh", &params);
        assert!(
            issues.iter().any(|i| i.piece_index == 1
                && i.kind == SeamLintKind::Blocking
                && i.class == SeamLintClass::BoundHead
                && i.message.contains("unit")),
            "{issues:?}"
        );
        // 非单位开头不误报。
        let ok = ["团队规模到了 2023", "情况才有了改变。"];
        assert!(
            lint_pieces(&ok, "zh", &params)
                .iter()
                .all(|i| !i.message.contains("unit")),
        );
    }

    #[test]
    fn lint_blocks_incomplete_chinese_nominal_split() {
        let params = TransParams::for_lang("zh");
        let broken = [
            "控制循环适用于我们有一个",
            "想改变的系统、一个可测量的问题。",
        ];
        let issues = lint_pieces(&broken, "zh", &params);
        assert!(
            issues.iter().any(|issue| {
                issue.kind == SeamLintKind::Blocking
                    && issue.class == SeamLintClass::IncompleteNominal
                    && issue.message.contains("incomplete Chinese nominal")
            }),
            "{issues:?}"
        );

        let complete = ["我们只有一个。", "接下来讨论另一个方案。"];
        assert!(
            lint_pieces(&complete, "zh", &params)
                .iter()
                .all(|issue| issue.class != SeamLintClass::IncompleteNominal)
        );
    }

    /// R2 基准两处两轮未修的硬悬空定点：`s-g41.0#0`（助词「得」）与
    /// `s-g89.0#0`（「在数学上」被腰斩）。
    #[test]
    fn lint_blocks_weak_tail_regressions_from_run2() {
        let params = TransParams::for_lang("zh");
        for pieces in [
            ["现在，剩余的 35% 得", "支撑每个活跃请求的 KV 缓存，"],
            ["这里的输出质量在数学上", "与单独运行大模型完全相同。"],
            ["KV 缓存只是", "把之前步骤里的那些键和值矩阵存起来，"],
            [
                "你还可以同时",
                "将 max_num_batched_tokens 设置为大于 2048。",
            ],
            ["一个小型草稿模型提出一系列", "输出 token，"],
            ["——具体来说，是模型如何", "逐 token 存储和检索它"],
            ["另外你还可以", "用投机解码进一步提速。"],
            ["它在最新版本里已经内置了", "分页注意力的实现。"],
            ["光是权重就要占用一块", "连续的显存区域。"],
        ] {
            let issues = lint_pieces(&pieces, "zh", &params);
            assert!(
                issues.iter().any(|issue| {
                    issue.piece_index == 0
                        && issue.class == SeamLintClass::WeakTail
                        && is_objective_blocking(issue)
                }),
                "{pieces:?} -> {issues:?}"
            );
        }
    }

    /// R2 已判优的宽片与常见完整收尾不得被新规则打回。
    #[test]
    fn weak_tail_spares_complete_tails() {
        let params = TransParams::for_lang("zh");
        for pieces in [
            [
                "把之前步骤里的那些键和值矩阵存起来，",
                "这样系统就不用重新计算已经知道的内容了。",
            ],
            [
                "就像为单个客人预留了一整层酒店楼层。",
                "而其他客人只能在门外排队。",
            ],
            [
                "所以，如果你的最大上下文是 2048 个 token，",
                "系统就会按这个上限预留显存。",
            ],
            [
                "但却没有一块足够大的连续区域来处理它。",
                "于是请求只能继续排队。",
            ],
            ["这份材料我很有心得", "所以先讲这一段。"],
            ["这个数字在 80% 以上", "属于完全可以接受的区间。"],
            ["我们在网上找到了它", "并做了完整复现。"],
        ] {
            let issues = lint_pieces(&pieces, "zh", &params);
            assert!(
                issues
                    .iter()
                    .all(|issue| issue.class != SeamLintClass::WeakTail),
                "{pieces:?} -> {issues:?}"
            );
        }
    }

    /// 并列结构不得切在 `和`/`及`/`与` 之前（`s-wmsk9mmhy-8#2`、`s-g20.19#3`）。
    #[test]
    fn lint_blocks_cut_before_chinese_coordinator() {
        let params = TransParams::for_lang("zh");
        for pieces in [
            ["它们是 KV 缓存", "和 PagedAttention。"],
            ["那我们就来聊聊 KV 缓存", "与 PagedAttention。"],
            ["这里要装的是显卡", "及其配套的散热模块。"],
        ] {
            let issues: Vec<_> = lint_pieces(&pieces, "zh", &params);
            let blocked = issues.iter().any(|issue| {
                issue.piece_index == 1
                    && issue.class == SeamLintClass::BoundHead
                    && issue.message.contains("coordinator")
                    && is_objective_blocking(issue)
            });
            // 「及其」是成词片首，不得拦。
            let expected = !pieces[1].starts_with("及其");
            assert_eq!(blocked, expected, "{pieces:?} -> {issues:?}");
        }
        // 前片以句读收尾时，并列连词起首是合法片首。
        let ok = ["它们是 KV 缓存，", "和 PagedAttention 一起工作。"];
        assert!(
            lint_pieces(&ok, "zh", &params)
                .iter()
                .all(|issue| !issue.message.contains("coordinator"))
        );
    }

    /// R3 审计 §2：封闭词表命中后缺陷只是**位移**到相邻的未列出形态。
    /// 这里逐条锁死五个形态类的正例（全部取自 R3 的 10 处硬悬空）。
    #[test]
    fn weak_tail_blocks_open_class_morphology() {
        for (text, form) in [
            // 1 · 处置式：把/将 + NP 后无谓语
            ("而块表会把逻辑页地址", "处置式缺谓语"),
            ("同时你还可以将 max_num_batched_tokens", "处置式缺谓语"),
            // 4 · 兼语式：让/使/叫 + NP 后无谓语
            ("模型必须让你的输入", "兼语式缺谓语"),
            // 2 · 及物动词 + 趋向/结果补语后缺宾
            ("这些传统系统会浪费掉", "动补缺宾"),
            ("生产环境的部署已经观察到", "动补缺宾"),
            // 3 · 方位框架（既有规则只覆盖「上」）
            ("也就是这 35% 里", "方位框架"),
            ("在这种情况下", "方位框架"),
            ("在一个完整的推理周期内", "方位框架"),
            ("你在生产环境的 AI 开发中", "方位框架"),
            // 5 · 光动词：来/去 + 单音节重叠动词缺宾
            ("那我们就来聊聊", "光动词重叠"),
        ] {
            assert_eq!(
                ends_weak_tail(text),
                Some((SeamLintKind::Blocking, form)),
                "{text}"
            );
        }
    }

    /// 形态类必须保留「成词陷阱」白名单豁免，否则会把「悬空」换成「超行」。
    #[test]
    fn weak_tail_morphology_keeps_word_trap_exemptions() {
        for text in [
            // 既有豁免
            "刚才提到的以上",
            "这是我的一点心得",
            // 框架字不作框架词用
            "这项能力在不久的将来",
            "整个流程即将",
            "假使",
            // 动补字成词
            "把结果写到文件并输出",
            "第一阶段已经完成",
            "这项工作我们迟到",
            // 方位字成词
            "答案就在其中",
            "请看下面的说明如下",
            "两次请求之间",
            "这台机器有八张卡在手里",
            // 处置式后已带谓语/补语
            "块表会把逻辑页地址映射过来",
            "我们把这些页面整理好",
            // 重叠动词但没有光动词框架
            "情况正在渐渐",
        ] {
            assert!(
                ends_weak_tail(text).is_none_or(|(kind, _)| kind != SeamLintKind::Blocking),
                "{text} -> {:?}",
                ends_weak_tail(text)
            );
        }
    }

    /// R3 新增缺陷：既有规则只禁止切在「和」**之前**，切在第二个并列项
    /// **之后**同样会把并列 NP 与中心语切开。
    #[test]
    fn lint_blocks_cut_after_second_coordinated_item() {
        let params = TransParams::for_lang("zh");
        for pieces in [
            ["它就存了那些 Key 和 Value", "矩阵，供后续复用。"],
            ["我们同时讨论缓存和调度", "问题的边界。"],
        ] {
            let issues = lint_pieces(&pieces, "zh", &params);
            assert!(
                issues.iter().any(|issue| issue.piece_index == 0
                    && issue.class == SeamLintClass::IncompleteNominal
                    && is_objective_blocking(issue)),
                "{pieces:?} -> {issues:?}"
            );
        }
        // 介词「和」（后接 NP + 谓语）与新小句起首都是合法缝，不得拦。
        for pieces in [
            ["今天很高兴和大家聊聊", "如何不再时刻盯着你的智能体。"],
            ["他喜欢音乐和电影", "然后就去休息了。"],
            ["它们是 KV 缓存和 PagedAttention，", "两者配合工作。"],
        ] {
            let issues = lint_pieces(&pieces, "zh", &params);
            assert!(
                !issues
                    .iter()
                    .any(|issue| issue.message.contains("second coordinated item")),
                "{pieces:?} -> {issues:?}"
            );
        }
    }

    /// 弱尾罚分不得产出「切完立刻被 lint 打回」的预拆缝。
    #[test]
    fn preferred_split_rejects_weak_tail_left_side() {
        let params = TransParams::for_lang("zh");
        let text = "现在剩余的百分之三十五得支撑每个活跃请求的键值缓存空间";
        if let Some(split) = preferred_target_split(text, "zh", params.soft, Some(params.hard)) {
            assert!(
                ends_weak_tail(&split.left).is_none_or(|(kind, _)| kind != SeamLintKind::Blocking),
                "{split:?}"
            );
        }
    }

    #[test]
    fn lint_blocks_cut_inside_paired_delimiter() {
        let params = TransParams::for_lang("zh");
        // s-g4.16：缝落在 “…” 内部。
        let pieces = ["一个根目录下包含名为“", "PluginDataJSON”的清单。"];
        let issues = lint_pieces(&pieces, "zh", &params);
        assert!(
            issues.iter().any(|i| i.piece_index == 0
                && i.kind == SeamLintKind::Blocking
                && i.class == SeamLintClass::UnpairedDelimiter),
            "{issues:?}"
        );
        assert!(issues.iter().filter(|i| is_objective_blocking(i)).count() >= 1);
        // 定界符对完整落在同一片里 ⇒ 无问题。
        let clean = ["一个根目录下包含", "名为“PluginDataJSON”的清单。"];
        assert!(
            !lint_pieces(&clean, "zh", &params)
                .iter()
                .any(|i| i.class == SeamLintClass::UnpairedDelimiter),
        );
        // 括号同理，并且能被 repair 合并掉。
        let paren = ["我们用代理插件（", "Agent Plugin）来做这件事。"];
        assert!(lint_pieces(&paren, "zh", &params).iter().any(|i| i.class
            == SeamLintClass::UnpairedDelimiter
            && i.kind == SeamLintKind::Blocking),);
        let repaired = repair_lint_pieces(
            ["他说（", "好的）", "然后就走了。"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            "zh",
            &params,
        );
        assert_eq!(repaired.concat(), "他说（好的）然后就走了。");
        assert!(
            !lint_pieces(
                &repaired.iter().map(String::as_str).collect::<Vec<_>>(),
                "zh",
                &params
            )
            .iter()
            .any(|i| i.class == SeamLintClass::UnpairedDelimiter),
            "{repaired:?}"
        );
    }

    #[test]
    fn lint_ignores_unclosed_and_oversized_delimiter_spans() {
        let params = TransParams::for_lang("zh");
        // 整句只有半个引号：任何切分都躲不开，不能反复打回 worker。
        let unclosed = ["他当时就说“我们", "明天再来讨论这件事。"];
        assert!(
            !lint_pieces(&unclosed, "zh", &params)
                .iter()
                .any(|i| i.class == SeamLintClass::UnpairedDelimiter),
        );
        // 引号跨度本身超 hard：切分不可避免，降级为 Advisory。
        let oversized = [
            "他说“这是一段很长的引文内容",
            "长到根本不可能塞进单独一片里”。",
        ];
        let issues = lint_pieces(&oversized, "zh", &params);
        assert!(
            issues
                .iter()
                .filter(|i| i.class == SeamLintClass::UnpairedDelimiter)
                .all(|i| i.kind == SeamLintKind::Advisory),
            "{issues:?}"
        );
        assert!(
            issues
                .iter()
                .any(|i| i.class == SeamLintClass::UnpairedDelimiter),
            "{issues:?}"
        );
        // 英文撇号不是闭定界符，不得凭空造出跨度。
        let latin = TransParams::for_lang("en");
        assert!(
            !lint_pieces(&["the students’ books", "were left behind"], "en", &latin)
                .iter()
                .any(|i| i.class == SeamLintClass::UnpairedDelimiter),
        );
    }

    /// span == hard 的整引片虽合法，但已装不下任何引号外文字；此时引内切分
    /// 不可避免，必须降级 Advisory——s-g25.25 基准实测 `span <= hard` 的口径
    /// 让 aim-band advisory 推荐的切法被 submit lint 以 Blocking 拒绝，形成
    /// 不可满足闭环。
    #[test]
    fn lint_delimiter_span_at_hard_is_advisory() {
        let params = TransParams::for_lang("zh");
        // 引号跨度 = “ + 18 全角字 + ” = 20 单位，正好等于 hard。
        let pieces = ["他说“字字字字字字字字字", "字字字字字字字字字”。"];
        let issues = lint_pieces(&pieces, "zh", &params);
        assert!(
            issues
                .iter()
                .any(|i| i.class == SeamLintClass::UnpairedDelimiter),
            "{issues:?}"
        );
        assert!(
            issues
                .iter()
                .filter(|i| i.class == SeamLintClass::UnpairedDelimiter)
                .all(|i| i.kind == SeamLintKind::Advisory),
            "{issues:?}"
        );
        // span == hard − 1：合并后仍能容纳引号外文字，保持 Blocking。
        let below = ["他说“字字字字字字字字字", "字字字字字字字字”。"];
        assert!(lint_pieces(&below, "zh", &params).iter().any(|i| i.class
            == SeamLintClass::UnpairedDelimiter
            && i.kind == SeamLintKind::Blocking),);
    }

    /// `或` 与 和/及/与 同属并列连词：裸切在它之前断开并列结构；前片句读
    /// 收尾时是合法小句首。`或许` 成词豁免。
    #[test]
    fn lint_blocks_bare_cut_before_huo_coordinator() {
        let params = TransParams::for_lang("zh");
        let bare = ["你可以选苹果", "或者选香蕉带走。"];
        let issues = lint_pieces(&bare, "zh", &params);
        assert!(
            issues.iter().any(|i| i.piece_index == 1
                && i.kind == SeamLintKind::Blocking
                && i.class == SeamLintClass::BoundHead
                && i.message.contains("和/及/与/或")),
            "{issues:?}"
        );
        // 前片以句读收尾 ⇒ 合法。
        let punct = ["你可以选苹果，", "或者选香蕉带走。"];
        assert!(
            !lint_pieces(&punct, "zh", &params)
                .iter()
                .any(|i| i.class == SeamLintClass::BoundHead),
        );
        // 「或许」是完整副词，不算并列连词开头。
        let adverb = ["他今天没有过来", "或许明天才会来。"];
        assert!(
            !lint_pieces(&adverb, "zh", &params)
                .iter()
                .any(|i| i.class == SeamLintClass::BoundHead),
        );
    }

    /// 预拆建议与 lint 同口径：不得推荐裸切在 `或者` 之前（曾经 CUT_BEFORE
    /// 候选不受并列门控，advisory 推荐的切法正是 lint 拒绝的切法）。
    #[test]
    fn preferred_split_never_bare_cuts_before_huo() {
        let params = TransParams::for_lang("zh");
        let bare = "我们可以直接采用现有的方案或者重新设计一套完全不同的架构";
        if let Some(split) = preferred_target_split(bare, "zh", params.soft, Some(params.hard)) {
            assert!(
                !split.right.trim_start().starts_with('或'),
                "advisory 推荐了 lint 会拒绝的裸切: {split:?}"
            );
        }
        // 前面有句读时，切在句读后、右片以「或者」开头是合法的。
        let punct = "我们可以直接采用现有的方案，或者重新设计一套完全不同的架构";
        let split = preferred_target_split(punct, "zh", params.soft, Some(params.hard))
            .expect("句读缝应给出建议");
        assert!(split.right.starts_with("或者"), "{split:?}");
    }

    /// 闪帧阈值按片级展示口径（片尾标点免费）：「他说了:」展示 3 单位，
    /// 曾按 4 计而漏判。
    #[test]
    fn flash_threshold_uses_display_units() {
        let params = TransParams::for_lang("zh");
        let pieces = ["他说了:", "我们明天一早就出发去北京。"];
        let issues = lint_pieces(&pieces, "zh", &params);
        assert!(
            issues.iter().any(|i| i.piece_index == 0
                && i.kind == SeamLintKind::Blocking
                && i.class == SeamLintClass::FlashFragment),
            "{issues:?}"
        );
    }

    #[test]
    fn lint_blocks_list_separator_cut_when_mergeable() {
        let params = TransParams::for_lang("zh");
        let pieces = ["这些想法复杂、", "有趣而深刻。"];
        let issues = lint_pieces(&pieces, "zh", &params);
        assert!(
            issues.iter().any(|i| i.piece_index == 0
                && i.kind == SeamLintKind::Blocking
                && i.message.contains("、")),
            "{issues:?}"
        );
        let repaired = repair_lint_pieces(
            pieces.into_iter().map(str::to_owned).collect(),
            "zh",
            &params,
        );
        assert_eq!(repaired, vec!["这些想法复杂、有趣而深刻。".to_owned()]);
        // 合并会超 hard 的长枚举只提示不阻塞。
        let long = [
            "第一项内容、第二项内容、第三项内容、",
            "第四项内容、第五项内容与第六项内容。",
        ];
        assert!(
            lint_pieces(&long, "zh", &params)
                .iter()
                .filter(|i| i.message.contains("、"))
                .all(|i| i.kind == SeamLintKind::Advisory),
        );
    }

    #[test]
    fn lint_blocks_dangling_middle_piece() {
        let params = TransParams::for_lang("zh");
        let pieces = ["前半工具和", "后半内容。"];
        let issues = lint_pieces(&pieces, "zh", &params);
        assert!(
            issues
                .iter()
                .any(|i| i.kind == SeamLintKind::Blocking && i.message.contains("dangling")),
            "{issues:?}"
        );
    }

    #[test]
    fn lint_blocks_flash_when_mergeable() {
        let params = TransParams::for_lang("zh");
        // 「尾片」不是完整短句，且可并入邻片。
        let pieces = ["前面很长的一片字幕内容", "尾片", "再接一段够长的内容文字"];
        let issues = lint_pieces(&pieces, "zh", &params);
        assert!(
            issues
                .iter()
                .any(|i| i.piece_index == 1 && i.kind == SeamLintKind::Blocking),
            "{issues:?}"
        );
    }

    #[test]
    fn lint_blocks_complete_short_tag_when_mergeable() {
        let params = TransParams::for_lang("zh");
        let pieces = ["这些函数可以做各种事情，", "对吧？", "但通常还会继续说明。"];
        let issues = lint_pieces(&pieces, "zh", &params);
        assert!(
            issues
                .iter()
                .any(|i| i.piece_index == 1 && i.kind == SeamLintKind::Blocking),
            "{issues:?}"
        );
        let repaired = repair_lint_pieces(
            pieces.into_iter().map(str::to_owned).collect(),
            "zh",
            &params,
        );
        assert_eq!(repaired[0], "这些函数可以做各种事情，对吧？");
    }

    #[test]
    fn repair_merges_flash_fragment() {
        let params = TransParams::for_lang("zh");
        let repaired = repair_lint_pieces(
            vec![
                "前面很长的一片字幕内容".into(),
                "尾片".into(),
                "再接一段够长的内容文字".into(),
            ],
            "zh",
            &params,
        );
        assert!(repaired.len() < 3, "{repaired:?}");
        let refs: Vec<&str> = repaired.iter().map(String::as_str).collect();
        assert!(
            lint_pieces(&refs, "zh", &params)
                .iter()
                .all(|i| i.kind != SeamLintKind::Blocking),
            "{repaired:?}"
        );
    }

    #[test]
    fn repair_never_merges_past_hard_ceiling() {
        let params = TransParams::for_lang("zh");
        let pieces = vec!["长".repeat(params.hard), "和".into()];
        assert!(
            target_cps_chars(&pieces[0], "zh") + target_cps_chars(&pieces[1], "zh") > params.hard
        );
        let repaired = repair_lint_pieces(pieces.clone(), "zh", &params);
        assert_eq!(repaired, pieces);
        assert!(
            repaired
                .iter()
                .all(|piece| target_cps_chars(piece, "zh") <= params.hard)
        );
    }

    #[test]
    fn preferred_split_finds_comma_seam() {
        let text =
            "You have to sweat the tokens carefully, and you also sweat the pixels every day.";
        let params = TransParams::for_lang("en");
        let split = preferred_target_split(text, "en", params.soft, Some(params.hard));
        assert!(split.is_some(), "expected balanced seam");
        let split = split.unwrap();
        assert!(split.left_chars >= 10 && split.right_chars >= 10);
        assert!(!ends_dangling(&split.left));
    }

    #[test]
    fn latin_presplit_requires_source_semantic_seam_and_duration() {
        // 源缝在首词后；时长占比贴近目标逗号缝（约 55%）。
        let left = Word {
            id: "a".into(),
            t0: 0.0,
            t1: 2.0,
            text: "Hello;".into(),
            sp: "s1".into(),
            glue: false,
        };
        let mid = Word {
            id: "b".into(),
            t0: 2.0,
            t1: 2.6,
            text: "world".into(),
            sp: "s1".into(),
            glue: false,
        };
        let right = Word {
            id: "c".into(),
            t0: 2.6,
            t1: 3.6,
            text: "again.".into(),
            sp: "s1".into(),
            glue: false,
        };
        let words = [&left, &mid, &right];
        // 31–42 CPS：超 aim 但仍单行 fit（空格不计）。
        let translation = "Review notes carefully, and share feedback.";
        let params = TransParams::for_lang("en");
        let cps = count_cps_chars(translation);
        assert!(cps > params.soft && cps <= params.fit, "cps={cps}");
        assert!(!crate::split::exceeds_one_line_fit(
            translation,
            "en",
            params.fit
        ));
        let pieces = latin_semantic_presplit(translation, &words, "en", &params)
            .expect("balanced latin pre-split");
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0].1, 0);
        assert_eq!(pieces[1].2, 2);
    }

    #[test]
    fn align_list_marks_over_fit() {
        let params = TransParams::for_lang("zh");
        let long = "超".repeat(22);
        let entries = align_list_entries(&[("s-a".into(), long)], "zh", &params);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].over_hard);
        assert!(entries[0].over_fit);
    }

    #[test]
    fn reanchor_snaps_boundaries_to_source_seams() {
        // 真实回归样本("Loop Engineering" 基准 s-g5.33):裸占比锚定会把
        // 边界切进 make|changes 与 external|applications;吸附后应落在
        // changes, 之后与 to 之前。
        let words: Vec<&str> = "This was the beginning of Context Engineering, where the \
             agent could now access files to load and make changes, or even use MCP to start \
             interacting with databases and external applications to load its own context."
            .split_whitespace()
            .collect();
        let texts = vec![
            "这就是上下文工程的开端:".to_owned(),
            "智能体现在可以访问文件进行加载和修改,".to_owned(),
            "甚至可以使用MCP与数据库和外部应用交互,".to_owned(),
            "从而加载自己的上下文。".to_owned(),
        ];
        let pieces = reanchor_texts(texts, &words, "zh");
        let bounds: Vec<(usize, usize)> = pieces
            .iter()
            .map(|piece| (piece.from.unwrap(), piece.to.unwrap()))
            .collect();
        assert_eq!(bounds, vec![(0, 6), (7, 18), (19, 30), (31, 35)]);
    }

    #[test]
    fn reanchor_keeps_proportional_when_no_seam_in_window() {
        let words: Vec<&str> = vec!["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
        let texts = vec!["前半句一共六个字".to_owned(), "后半句也是六个字".to_owned()];
        let pieces = reanchor_texts(texts, &words, "zh");
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0].from, Some(0));
        assert_eq!(pieces[1].to, Some(5));
        let boundary = pieces[1].from.unwrap();
        assert_eq!(pieces[0].to.unwrap() + 1, boundary);
        assert_eq!(boundary, 3); // 无缝可吸,保持占比切分
    }
}
