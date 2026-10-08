//! 文本原子化与字符度量（逐字对拍 voice-ink `SubText` / `SubAlign`）。
//!
//! - [`atomize`]：汉字与假名逐字，其余文字（拉丁、谚文……）按空白分词，标点
//!   归属前一个原子，cohesion 守卫保 `3.14` / `U.S.` / `don't` /
//!   `state-of-the-art` 为单原子；无损——每个非空白字符恰好落入一个原子。
//! - 「中日韩」在这里是两个不同的问题，各有各的谓词，不要混用：
//!   - **占不占两格、算不算一个阅读单位**（宽度、CPS、页预算）：汉字、假名、
//!     谚文都算——[`is_cjk_char`] / [`is_cjk_adjacent`] / [`is_cjk_text`]。
//!   - **词与词之间写不写空格**（切词逐字、拼接不加空格、任意两字之间可断）：
//!     只有汉字与假名——[`is_unspaced_cjk_char`] / [`is_unspaced_cjk_adjacent`]。
//!     韩文按空格分词，走拉丁那一路。
//! - 两套度量严格区分：行宽用 [`visual_width`]（CJK 记 2），CPS 用
//!   [`count_cps_chars`]（非空白计 1）。
//!
//! 与 Swift 的已知偏差：Swift 按 grapheme cluster 迭代，这里按 Unicode 标量
//! （组合记号极端情形下计数不同）。切词不受影响：组合记号与零宽连接符跟着
//! 它所附着的字符走（[`is_combining`]），不当标点切开。

use unicode_general_category::{GeneralCategory, get_general_category};

/// 宽字符意义上的 CJK 词字符（三区段）：汉字、假名、谚文音节。回答的是
/// 「占两格、一个字算一个阅读单位」；**不**回答「词之间写不写空格」——那个
/// 问题用 [`is_unspaced_cjk_char`]。
pub fn is_cjk_char(ch: char) -> bool {
    is_unspaced_cjk_char(ch) || is_hangul_syllable(ch)
}

/// 词与词之间不写空格、一个字就是一个原子的文字：汉字与假名。谚文不在内
/// （韩文按空格分词）；泰文一类虽然也不写空格，但没有逐字的词界，空白之间
/// 整段是一个原子，同样不在内。
pub fn is_unspaced_cjk_char(ch: char) -> bool {
    matches!(ch as u32, 0x4E00..=0x9FFF | 0x3040..=0x30FF)
}

/// 谚文音节（U+AC00..U+D7AF）。
pub fn is_hangul_syllable(ch: char) -> bool {
    matches!(ch as u32, 0xAC00..=0xD7AF)
}

/// 字符串任一标量是 CJK 即视为 CJK（对拍 `SubText.isCJK(String)`——
/// 混排文本走 CJK 路径是刻意行为）。
pub fn is_cjk_text(text: &str) -> bool {
    text.chars().any(is_cjk_char)
}

/// 中日文语境标点规范化：ASCII `,` `:` `;` 任一直接邻字符是汉字或假名时替换
/// 为全角 `，` `：` `；`；两侧都不是的场合（`3,000`、`10:30`、URL、纯英文
/// 句子、韩文——韩文用半角标点）原样保留。`.` 刻意不映射——`配置好.env`、`详见 README.md` 一类
/// 文件名/缩写歧义无法靠邻字判定。幂等：全角字符不在映射域内。
///
/// 用途：LLM 生成的 brief 摘要/风格指南混入半角标点后会随 system prompt
/// 回显传染整条下游翻译（file-v1 基准 zh-Hans 译文半角逗号/冒号 14 处，
/// json-v0 基线 0 处），在验收/转换处做一次确定性清洗即可断根，且不产生
/// worker 重试成本。
pub fn normalize_cjk_ascii_punctuation(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    for (index, &ch) in chars.iter().enumerate() {
        let mapped = match ch {
            ',' => '，',
            ':' => '：',
            ';' => '；',
            _ => {
                out.push(ch);
                continue;
            }
        };
        let prev_cjk = index > 0 && is_unspaced_cjk_char(chars[index - 1]);
        let next_cjk = chars
            .get(index + 1)
            .copied()
            .is_some_and(is_unspaced_cjk_char);
        out.push(if prev_cjk || next_cjk { mapped } else { ch });
    }
    out
}

/// A letter or digit of a script that puts spaces between words. Han, kana
/// and the scripts that run words together (Thai, Lao, Myanmar, Khmer,
/// Tibetan) are excluded; anything not listed counts as spaced, Hangul
/// included.
pub fn spaced_script_letter(ch: char) -> bool {
    ch.is_alphanumeric()
        && !is_unspaced_cjk_adjacent(ch)
        && !matches!(
            ch as u32,
            0x0E00..=0x0EFF | 0x0F00..=0x0FFF | 0x1000..=0x109F | 0x1780..=0x17FF
        )
}

/// 宽度意义上的"宽字符"（记 2 格）：CJK 词字符（含谚文）+ CJK 标点/全角区 +
/// 中文引号破折号。拼接要不要空格不看它，看 [`is_unspaced_cjk_adjacent`]。
pub fn is_cjk_adjacent(ch: char) -> bool {
    is_cjk_char(ch) || is_wide_mark(ch)
}

/// 拼接意义上的"不写空格的字符"：汉字、假名 + CJK 标点/全角区 + 中文引号
/// 破折号。两侧都是它时词间不加空格（[`sep_len`] 第 1 条）。
pub fn is_unspaced_cjk_adjacent(ch: char) -> bool {
    is_unspaced_cjk_char(ch) || is_wide_mark(ch)
}

fn is_wide_mark(ch: char) -> bool {
    matches!(ch as u32,
        0x3000..=0x303F | 0xFF00..=0xFFEF | 0x2014 | 0x2018..=0x201D | 0x2026)
}

/// 全角标点/符号：CJK 标点区（U+3000..U+303F 的 、。「」『』《》〈〉【】〔〕）
/// 与全角区（U+FF00..U+FFEF 的 ，。！？：；（））中的标点/符号。这类字形**自带
/// 视觉留白**，任何一侧命中都不该再补空格。合取 [`is_punctuation_or_symbol`]
/// 是为了把全角字母/数字（Ａ、１）排除在外——它们仍按普通词占空格。
fn is_fullwidth_punctuation(ch: char) -> bool {
    matches!(ch as u32, 0x3000..=0x303F | 0xFF00..=0xFFEF) && is_punctuation_or_symbol(ch)
}

/// 中英共用排印符：U+2014 —、U+2018..U+201D ‘’‚‛“”、U+2026 …。
/// 它们在 Latin 排版里**正常参与空格**（`said “Hello`、`students’ books`、
/// `so… yeah`），字形不自带留白，因此不能套用全角标点的单侧规则。
fn is_shared_typographic_mark(ch: char) -> bool {
    matches!(ch as u32, 0x2014 | 0x2018..=0x201D | 0x2026)
}

/// 开定界符（Unicode Ps/Pi）。
fn is_opening_delimiter(ch: char) -> bool {
    matches!(
        get_general_category(ch),
        GeneralCategory::OpenPunctuation | GeneralCategory::InitialPunctuation
    )
}

/// 闭定界符（Unicode Pe/Pf）。
fn is_closing_delimiter(ch: char) -> bool {
    matches!(
        get_general_category(ch),
        GeneralCategory::ClosePunctuation | GeneralCategory::FinalPunctuation
    )
}

pub(crate) fn is_punctuation_or_symbol(ch: char) -> bool {
    matches!(
        get_general_category(ch),
        GeneralCategory::ConnectorPunctuation
            | GeneralCategory::DashPunctuation
            | GeneralCategory::OpenPunctuation
            | GeneralCategory::ClosePunctuation
            | GeneralCategory::InitialPunctuation
            | GeneralCategory::FinalPunctuation
            | GeneralCategory::OtherPunctuation
            | GeneralCategory::MathSymbol
            | GeneralCategory::CurrencySymbol
            | GeneralCategory::ModifierSymbol
            | GeneralCategory::OtherSymbol
    )
}

const COHESIVE_MARKS: &[char] = &['.', ',', '\'', '’', '-', '–', ':', '/', '@', '&', '+'];

/// 哪些字符一个字就是一个原子。
type PerChar = fn(char) -> bool;

fn is_word_char(ch: char, per_char: PerChar) -> bool {
    if per_char(ch) {
        return false;
    }
    ch.is_alphabetic() || ch.is_numeric() || ch == '_'
}

/// 组合记号（Unicode Mn / Mc / Me）与零宽连接符（ZWNJ / ZWJ）：书写上属于它
/// 前面那个字符，不是标点。泰文声调符（U+0E48..U+0E4B）、天城文等的 virama
/// 与 nukta、分解形式的拉丁重音都是 Mn 而不是字母；把它们当标点会在词中间
/// 收尾（`พื้นที่` 切成 `พื้` + `นที่`、`क्या` 切成 `क्` + `या`），再按词间
/// 空格拼回去就多出空格、改了原文。
pub(crate) fn is_combining(ch: char) -> bool {
    matches!(ch, '\u{200C}' | '\u{200D}')
        || matches!(
            get_general_category(ch),
            GeneralCategory::NonspacingMark
                | GeneralCategory::SpacingMark
                | GeneralCategory::EnclosingMark
        )
}

/// 无损原子化：汉字与假名逐字，其余文字按词（空白之间的一段）。韩文在这里
/// 按空格分词，一个어절一个原子。
///
/// 这是**成词**用的口径：建稿、把改过的文本重绑成词、给译文找切点。拿模型
/// 文本去和文稿词比对（LCS 的键）或按页计量的地方用 [`atomize_syllables`]。
pub fn atomize(text: &str) -> Vec<String> {
    atomize_with(text, is_unspaced_cjk_char)
}

/// 谚文也逐音节切的原子化（0.5 之前文稿的口径）。
///
/// 用在两类地方：
///
/// - **比对与计量**：把模型文本与文稿词做 LCS 的键、词序列签名、
///   [`word_count`]。键越细越稳——韩文模型改一个助词、补一处空格都不该让整
///   个어절对不上；预算按音节计则是为了让韩文一页装的内容与以前相同。
/// - **旧文稿的改写**：0.5 之前建的韩文文稿每个音节一个词（读入时带上
///   「贴前」标记保持原样显示），改写这种区间时新词要沿用同一粒度，见
///   [`atomize_like`]。
pub fn atomize_syllables(text: &str) -> Vec<String> {
    atomize_with(text, is_cjk_char)
}

/// 区间里有没有泰文一类按词切开的词（[`is_script_glued`]）。有的话，拿模型
/// 文本与这段文稿词做 LCS 时要用 [`comparison_atoms`] 的细口径。
pub fn needs_fine_comparison<W: JoinWord>(words: &[W]) -> bool {
    words.iter().any(is_script_glued)
}

/// 拿模型文本与文稿词做 LCS 时的原子（键由调用方再过 [`atom_key`]）。
///
/// `fine` 为假时与 [`atomize_syllables`] 逐个相同。为真时（区间里有泰文一类
/// 按词切开的词，见 [`needs_fine_comparison`]）每个原子再按字素簇切开：文稿
/// 那侧是一个个词，模型文本那侧按空白只能切到短语，两侧粒度不同就对不上；
/// 拿分词模型去切模型文本也不行，它依赖上下文，模型改一处空格就会换切法。
/// 两侧都切到字素簇才对称。所有原子都切（不只含泰文的），否则 `14:30` 这种
/// 夹在泰文里的段在两侧会一边整一边碎。
///
/// 字素簇在这里**只是比对键**：调用方把匹配映射回文稿词的下标，切句、分段
/// 的边界仍然只落在文稿的词边界上。
pub fn comparison_atoms(text: &str, fine: bool) -> Vec<String> {
    let atoms = atomize_syllables(text);
    if !fine {
        return atoms;
    }
    atoms
        .iter()
        .flat_map(|atom| {
            crate::word_breaks::graphemes(atom)
                .into_iter()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect()
}

/// 按 `words` 现有的粒度原子化 `text`：
///
/// - 区间里有 0.5 之前逐音节韩文的「贴前」词（[`is_legacy_glued`]）→ 逐音节；
/// - 区间里有不写空格的文字切出来的「贴前」词（[`is_script_glued`]，泰文一类
///   按词建稿的新文稿）→ [`atomize_words`] 的切法，只取文本；
/// - 否则按 [`atomize`]。
///
/// 返回的只是文本：拿它重新拼文本会在泰文词之间多出空格，成词的地方用
/// [`atomize_words_like`]，把标记带上。
pub fn atomize_like<W: JoinWord>(words: &[W], text: &str) -> Vec<String> {
    match span_granularity(words) {
        Granularity::LegacySyllables => atomize_syllables(text),
        Granularity::ScriptWords => atomize_words_anchored(words, text)
            .into_iter()
            .map(|(atom, _)| atom)
            .collect(),
        Granularity::Words => atomize(text),
    }
}

/// 区间里**已有的一个词**的文本按区间粒度拆成原子（给比对键用，另一侧是
/// [`atomize_like`] 切的改写文本）。与 [`atomize_like`] 只差在泰文一类按词
/// 切开的区间：已有的词本身就是一个词，不再拿去分词——单独一个词送进分词
/// 模型可能被切成两段，两侧的键就对不上了。
pub fn atomize_word_like<W: JoinWord>(words: &[W], word_text: &str) -> Vec<String> {
    match span_granularity(words) {
        Granularity::LegacySyllables => atomize_syllables(word_text),
        Granularity::ScriptWords | Granularity::Words => atomize(word_text),
    }
}

/// [`atomize_like`] 带上每个原子的「贴前」标记，给成词的地方用（改写区间、
/// 文本编辑）。逐音节的旧韩文区间与普通区间一律不带标记——前者由
/// [`crate::rebind::reglue_legacy_span`] 按旧规则重定，后者本来就没有。
pub fn atomize_words_like<W: JoinWord>(words: &[W], text: &str) -> Vec<(String, bool)> {
    match span_granularity(words) {
        Granularity::LegacySyllables => atomize_syllables(text)
            .into_iter()
            .map(|atom| (atom, false))
            .collect(),
        Granularity::ScriptWords => atomize_words_anchored(words, text),
        Granularity::Words => atomize(text)
            .into_iter()
            .map(|atom| (atom, false))
            .collect(),
    }
}

/// 泰文一类按词切开的区间改写时的切法：`text` 开头、结尾与区间原有词逐字相同
/// 的那几段沿用原来的词界，只有中间改动过的一段重新分词，标记按 `text` 里
/// 有没有空白重定（[`script_glue_from_text`]）。
///
/// 分词模型的结果跟上下文有关：同一个词，整句送进去和只送半句，边界可能不同
/// （实测泰文验收句每个子区间单独重切，边缘处约 9% 的子区间变了切法）。整段
/// 重切会让没改的词换掉 id 与时间；锚定之后，原文不变时切出来的就是原来的词。
/// 锚定的结果拼回去与 [`atomize_words`] 拼回去不一致时（锚点落在拉丁词中间
/// 之类），退回整段重切。
fn atomize_words_anchored<W: JoinWord>(words: &[W], text: &str) -> Vec<(String, bool)> {
    let fresh = atomize_words(text);
    let clean_cut = |before: Option<char>, after: Option<char>| {
        !after.is_some_and(is_combining) && !before.is_some_and(is_preposed_vowel)
    };
    // 锚定的词：(文本, 它在 `text` 里的起点)。
    let mut head: Vec<(String, usize)> = Vec::new();
    let mut cursor = 0;
    for word in words {
        let word = word.join_text().trim();
        let rest = &text[cursor..];
        let at = cursor + (rest.len() - rest.trim_start().len());
        if word.is_empty() || !text[at..].starts_with(word) {
            break;
        }
        let end = at + word.len();
        if !clean_cut(text[..end].chars().last(), text[end..].chars().next()) {
            break;
        }
        head.push((word.to_owned(), at));
        cursor = end;
    }
    let mut tail: Vec<(String, usize)> = Vec::new();
    let mut end = text.len();
    for word in words[head.len()..].iter().rev() {
        let word = word.join_text().trim();
        let before = text[..end].trim_end();
        if word.is_empty() || !before.ends_with(word) || before.len() - word.len() < cursor {
            break;
        }
        let start = before.len() - word.len();
        if !clean_cut(text[..start].chars().last(), text[start..].chars().next()) {
            break;
        }
        tail.push((word.to_owned(), start));
        end = start;
    }
    // 重切的中间段两头切出纯标点（模型在引号外加了空格：`ว่า“ยืนยัน` →
    // `ว่า “ยืนยัน`，尾锚 `ยืนยัน` 原样留下，中间只剩 `ว่า “`）时，把挨着的
    // 锚定词还给中间段一起切，标点才能像整段重切时那样贴到词上，不单成一个词。
    // 每侧最多还一个：本来就单独成段的标点（两边都有空格的 `—`）还一个词也
    // 贴不上，再还下去只会让没改的词换切法。
    let punct_only =
        |piece: Option<&(String, bool)>| piece.is_some_and(|(atom, _)| atom_key(atom).is_none());
    let mut middle = atomize_words(&text[cursor..end]);
    if punct_only(middle.last()) && tail.pop().is_some() {
        // `tail` 从文本末尾往前存，最后一个是离中间段最近的锚。
        end = tail.last().map_or(text.len(), |&(_, next)| next);
        middle = atomize_words(&text[cursor..end]);
    }
    if punct_only(middle.first())
        && let Some((_, start)) = head.pop()
    {
        cursor = start;
        middle = atomize_words(&text[cursor..end]);
    }
    let mut texts: Vec<String> = head.into_iter().map(|(word, _)| word).collect();
    texts.extend(middle.into_iter().map(|(atom, _)| atom));
    texts.extend(tail.into_iter().rev().map(|(word, _)| word));
    let Some(glue) = script_glue_from_text(&texts, text) else {
        return fresh;
    };
    let anchored: Vec<(String, bool)> = texts.into_iter().zip(glue).collect();
    if join_word_texts(anchored.iter()) == join_word_texts(fresh.iter()) {
        anchored
    } else {
        fresh
    }
}

/// 泰文、老挝文写在辅音前面的元音（逻辑顺序也在前）：它和后一个辅音是一个
/// 音节，词界不能落在它后面。
fn is_preposed_vowel(ch: char) -> bool {
    matches!(ch as u32, 0x0E40..=0x0E44 | 0x0EC0..=0x0EC4)
}

enum Granularity {
    LegacySyllables,
    ScriptWords,
    Words,
}

fn span_granularity<W: JoinWord>(words: &[W]) -> Granularity {
    if words.iter().any(is_legacy_glued) {
        Granularity::LegacySyllables
    } else if words.iter().any(is_script_glued) {
        Granularity::ScriptWords
    } else {
        Granularity::Words
    }
}

/// 0.5 之前逐音节的韩文词：带「贴前」标记、且含谚文音节。读旧文稿时
/// [`legacy_glue`] 只会给这种词打标记（谚文挨谚文、谚文挨破折号 / 省略号 /
/// 弯引号外侧，被标记的一侧总是谚文）。
pub fn is_legacy_glued<W: JoinWord + ?Sized>(word: &W) -> bool {
    word.glued() && word.join_text().chars().any(is_hangul_syllable)
}

/// 不写空格的文字（[`is_unspaced_script_char`]）在建稿时按词切开后，词内后续
/// 各段带的「贴前」标记：带标记、且不是 [`is_legacy_glued`]。
pub fn is_script_glued<W: JoinWord + ?Sized>(word: &W) -> bool {
    word.glued() && !is_legacy_glued(word)
}

/// 词与词之间不写空格、又不能逐字成词的文字：泰文、老挝文、藏文（含宗喀）、
/// 缅甸文、高棉文（含扩展区）。这些文字里的空格是短语或分句的停顿，不是词界；
/// 词界要靠分词（[`atomize_words`]）。与 [`spaced_script_letter`] 排除的是同
/// 一组文字。
pub fn is_unspaced_script_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x0E00..=0x0EFF
            | 0x0F00..=0x0FFF
            | 0x1000..=0x109F
            | 0x1780..=0x17FF
            | 0x19E0..=0x19FF
            | 0xA9E0..=0xA9FF
            | 0xAA60..=0xAA7F
    )
}

/// 有分词模型的那几种（泰、老挝、缅甸、高棉）。藏文没有分词模型，词内的
/// 音节已经由 [`atomize`] 在音节符 `་`（tsheg）处切开。
pub(crate) fn is_lstm_script_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x0E00..=0x0EFF | 0x1000..=0x109F | 0x1780..=0x17FF | 0x19E0..=0x19FF | 0xA9E0..=0xA9FF | 0xAA60..=0xAA7F
    )
}

/// 两段文本之间的缝碰到不写空格的文字（任一侧的边界字符是
/// [`is_unspaced_script_char`]）。
fn script_seam(prev: &str, next: &str) -> bool {
    prev.chars().last().is_some_and(is_unspaced_script_char)
        || next.chars().next().is_some_and(is_unspaced_script_char)
}

/// 成词口径的原子化，带「贴前」标记：先按 [`atomize`] 切，再把含泰、老挝、
/// 缅甸、高棉文字的原子按词切开（ICU4X 的 LSTM 分词）。标记为真的原子与前一个
/// 原子之间原文没有空白、且缝碰到不写空格的文字——这种缝按 [`sep_len`] 会被
/// 补上空格，所以要带标记才能拼回原文。藏文按音节符切开的缝同样带标记。
///
/// 不含这些文字的文本与 [`atomize`] 逐个相同、标记全为假。无损：按标记拼回
/// （[`join_word_texts`]）等于原文去掉首尾空白、把空白折成单个空格。
pub fn atomize_words(text: &str) -> Vec<(String, bool)> {
    let atoms = atomize(text);
    let mut out: Vec<(String, bool)> = Vec::with_capacity(atoms.len());
    let mut cursor = 0;
    for atom in atoms {
        let rest = &text[cursor..];
        let skipped = rest.len() - rest.trim_start().len();
        let adjacent = skipped == 0;
        let start = if text[cursor + skipped..].starts_with(&atom) {
            cursor + skipped
        } else {
            // atomize 是无损的，原子按序、只隔空白；保险起见找不到时按
            // 子串定位，定位不到就当作隔着空白。
            match text[cursor..].find(&atom) {
                Some(offset) => cursor + offset,
                None => {
                    out.extend(
                        split_script_words(&atom)
                            .into_iter()
                            .enumerate()
                            .map(|(index, piece)| (piece, index > 0)),
                    );
                    continue;
                }
            }
        };
        cursor = start + atom.len();
        let glue_first = adjacent
            && out
                .last()
                .is_some_and(|(previous, _)| script_seam(previous, &atom));
        for (index, piece) in split_script_words(&atom).into_iter().enumerate() {
            out.push((piece, if index == 0 { glue_first } else { true }));
        }
    }
    out
}

/// 一串按序取自 `text` 的词（转录引擎给的逐词时间、页面上的源词）各自与前
/// 一个词之间要不要带「贴前」标记：原文里两词之间没有空白、且缝碰到不写空格
/// 的文字（[`is_unspaced_script_char`]）。其余的缝（中日文逐字、拉丁词）一律
/// 为假，与没有这一步时相同。词在原文里按序对不上时返回 `None`。
pub fn script_glue_from_text<S: AsRef<str>>(words: &[S], text: &str) -> Option<Vec<bool>> {
    let mut flags = Vec::with_capacity(words.len());
    let mut cursor = 0;
    let mut previous: Option<&str> = None;
    for word in words {
        let word = word.as_ref().trim();
        if word.is_empty() {
            return None;
        }
        let rest = &text[cursor..];
        let skipped = rest.len() - rest.trim_start().len();
        if !text[cursor + skipped..].starts_with(word) {
            return None;
        }
        flags.push(skipped == 0 && previous.is_some_and(|previous| script_seam(previous, word)));
        cursor += skipped + word.len();
        previous = Some(word);
    }
    Some(flags)
}

/// 把一个原子里的泰、老挝、缅甸、高棉文字按词切开。只采用至少一侧是这些
/// 文字的分词边界（`F-07`、`14:30` 这类夹在里面的拉丁 / 数字段保持完整）；
/// 只有标点的段并进相邻的词：开定界符（Ps/Pi）并给后一个词，其余并给前一个
/// 词；重复符 `ๆ` / `ໆ` 并给前一个词。拼起来等于原子。
fn split_script_words(atom: &str) -> Vec<String> {
    if !atom.chars().any(is_lstm_script_char) {
        return vec![atom.to_owned()];
    }
    let boundaries: Vec<usize> = crate::word_breaks::lstm_word_boundaries(atom)
        .into_iter()
        .filter(|&offset| {
            let before = atom[..offset].chars().last();
            let after = atom[offset..].chars().next();
            (before.is_some_and(is_lstm_script_char) || after.is_some_and(is_lstm_script_char))
                && !after.is_some_and(is_combining)
        })
        .collect();
    let mut segments: Vec<&str> = Vec::with_capacity(boundaries.len() + 1);
    let mut start = 0;
    for end in boundaries.into_iter().chain(std::iter::once(atom.len())) {
        if end > start {
            segments.push(&atom[start..end]);
            start = end;
        }
    }
    let has_word_char = |segment: &str| segment.chars().any(|ch| ch.is_alphanumeric());
    let repetition_mark = |segment: &str| {
        segment
            .chars()
            .next()
            .is_some_and(|ch| matches!(ch, '\u{0E46}' | '\u{0EC6}'))
    };
    let mut pieces: Vec<String> = Vec::with_capacity(segments.len());
    let mut carry = String::new();
    for (index, segment) in segments.iter().enumerate() {
        let attach_back = !has_word_char(segment) || repetition_mark(segment);
        if attach_back {
            let opening = segment.chars().last().is_some_and(is_opening_delimiter)
                && !repetition_mark(segment);
            let has_next_word = segments[index + 1..].iter().any(|next| has_word_char(next));
            // 已经在等后一个词的标点之后的标点也跟着等，顺序不乱。
            if !carry.is_empty() || (opening && has_next_word) || pieces.is_empty() {
                carry.push_str(segment);
            } else if let Some(last) = pieces.last_mut() {
                last.push_str(segment);
            }
            continue;
        }
        let mut piece = std::mem::take(&mut carry);
        piece.push_str(segment);
        pieces.push(piece);
    }
    if !carry.is_empty() {
        match pieces.last_mut() {
            Some(last) => last.push_str(&carry),
            None => pieces.push(carry),
        }
    }
    pieces
}

fn atomize_with(text: &str, per_char: PerChar) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut run = String::new(); // 开放中的非 CJK 词原子
    let mut pending_prefix = String::new(); // 行首/间隙标点，等待向前依附
    let mut gap_before = true; // 光标前是空白（或文本开头）

    macro_rules! flush_run {
        () => {
            if !run.is_empty() {
                out.push(std::mem::take(&mut run));
            }
        };
    }

    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            flush_run!();
            gap_before = true;
            i += 1;
            continue;
        }
        if is_combining(c) && !gap_before {
            // 接在它所附着的字符后面：开放中的词、刚收尾的原子（CJK 字、
            // 以标点收尾的词）、或还在等词的前缀标点。间隙后的孤立记号没有
            // 可附着的字符，照旧走下面的分支。
            if !run.is_empty() {
                run.push(c);
            } else if let Some(last) = out.last_mut() {
                last.push(c);
            } else {
                pending_prefix.push(c);
            }
            i += 1;
            continue;
        }
        if per_char(c) {
            flush_run!();
            let mut atom = std::mem::take(&mut pending_prefix);
            atom.push(c);
            out.push(atom);
            gap_before = false;
            i += 1;
            continue;
        }
        if is_word_char(c, per_char) {
            if run.is_empty() {
                run = std::mem::take(&mut pending_prefix);
            }
            run.push(c);
            gap_before = false;
            i += 1;
            continue;
        }
        // 标点/符号连串 [i..j)
        let mut j = i;
        while j < chars.len()
            && !chars[j].is_whitespace()
            && !per_char(chars[j])
            && !is_word_char(chars[j], per_char)
        {
            j += 1;
        }
        let punct: String = chars[i..j].iter().collect();
        let next_is_word = j < chars.len() && is_word_char(chars[j], per_char);
        let next_is_content = j < chars.len() && !chars[j].is_whitespace();
        if !gap_before {
            if !run.is_empty() && next_is_word && j - i == 1 && COHESIVE_MARKS.contains(&chars[i]) {
                run.push(chars[i]); // 3.14 / don't / state-of-the-art 保持内聚
            } else if !run.is_empty() {
                run.push_str(&punct);
                flush_run!();
            } else if let Some(last) = out.last_mut() {
                last.push_str(&punct);
            } else {
                pending_prefix.push_str(&punct);
            }
            gap_before = false;
        } else if next_is_content {
            pending_prefix.push_str(&punct);
            gap_before = false;
        } else {
            flush_run!();
            let mut atom = std::mem::take(&mut pending_prefix);
            atom.push_str(&punct);
            out.push(atom);
            gap_before = true;
        }
        i = j;
    }
    flush_run!();
    if !pending_prefix.is_empty() {
        out.push(pending_prefix);
    }
    out
}

/// 文本的计量单位数，用于语言中立的页预算计量。
///
/// 汉字、假名、谚文逐字计一、其余文字按词计一，依附标点不单独计数
/// （[`atomize_syllables`] 的口径）。按字符计量对 CJK 与 Latin 并不公平
/// （Latin 一词约 5.5 字符，CJK 一字即一词），同一个字符预算下 CJK 页的信息
/// 密度是 Latin 的数倍；改用这个单位即可让两类文字落在同一量纲上。韩文的
/// **词**是어절（[`atomize`]），但预算仍按音节计：一个어절平均三个音节，按
/// 어절计会让同样的页预算装进约三倍的内容。分页粒度下每页只调用一次，分配
/// 开销可以忽略。
pub fn word_count(text: &str) -> usize {
    atomize_syllables(text).len()
}

/// 词间分隔宽度，三档（对拍 `SubText.sepLen`）：
///
/// 1. 两侧都是不写空格的字符（[`is_unspaced_cjk_adjacent`]：汉字、假名、CJK
///    标点/全角区、中文引号破折号）→ 0；谚文紧挨汉字或假名 → 0（中日文里
///    夹的韩文、韩文里夹的汉字照原样贴着）。**谚文与谚文之间不在此列**：
///    韩文按空格分词，两个어절之间是 1。
/// 2. 任一侧是**全角标点**（[`is_fullwidth_punctuation`]）→ 0，**单侧即可**。
/// 3. 任一侧是**共用排印符**（[`is_shared_typographic_mark`]）→ 只有当缝落在
///    该符号的**内容侧**时才 0：`prev` 以开定界符（Ps/Pi）结尾，或 `next` 以
///    闭定界符（Pe/Pf）开头。
///
/// 为什么第 2、3 条规则不同、**不要合并回一条**：全角标点的字形本身就带视觉
/// 留白，任一侧命中都不该再补空格；而共用排印符（U+2014 —、U+2018..U+201D
/// ‘’‚‛“”、U+2026 …）在 Latin 排版里是正常参与空格的字符，套用单侧规则会把
/// `said “Hello` 压成 `said“Hello`、`students’ books` 压成 `students’books`、
/// `so… yeah` 压成 `so…yeah`。英文是真实的翻译目标语，那样会整体算错英文译片
/// 的显示宽度并进而影响切分。
///
/// 第 3 条的判据是一句话：**定界符在面向自身内容的那一侧不占空格。** 所以
/// `名为“` + `PluginDataJSON”` 里 `“`（Pi）在 `prev` 末尾、缝在它的内容侧 → 0，
/// 拼回去是 `名为“PluginDataJSON”` 而不是幻影空格 `名为“ PluginDataJSON”`
/// （幻影空格会让 `join_atoms` 的 canonical 与译文不等长，`split.rs` 的 seam
/// 偏移与 protected-term 匹配整体错位）；而 `students’` + `books` 里 `’`（Pf）
/// 在 `prev` 末尾、缝在它的**外**侧 → 1，英文撇号后的空格得以保留。
/// `—`（Pd）和 `…`（Po）两侧皆非定界符，永远只走第 1 条。
///
/// 判定只看两侧各一个边界字符（`prev` 常常是整段累计前缀，不能回扫，否则
/// 单原子调用与整串调用会给出不同结果，重新引入偏移漂移）。已知取舍：
/// `sep_len("好”", "foo")` 这类「闭引号外侧接 Latin」在中文语境本该闭合、在
/// 英文语境（`“Hello world” today`）本该留空格，两字符局部信息不足以区分，
/// 这里按英文取 1（也是本次改动前的原有行为）。
pub fn sep_len(prev: &str, next: &str) -> usize {
    sep_len_with(prev, next, unspaced_pair)
}

/// [`sep_len`] 第 1 条：这两个相邻字符之间不写空格。两侧都是不写空格的字符
/// （汉字、假名、CJK 标点/全角区、中文引号破折号），或谚文紧挨汉字 / 假名。
/// 谚文与谚文不在内。清洗模型文本里多余空格的地方
/// （`markers::collapse_cjk_spaces`）与它同口径。
pub fn unspaced_pair(prev: char, next: char) -> bool {
    (is_unspaced_cjk_adjacent(prev) && is_unspaced_cjk_adjacent(next))
        || (is_hangul_syllable(prev) && is_unspaced_cjk_char(next))
        || (is_unspaced_cjk_char(prev) && is_hangul_syllable(next))
}

/// 0.5 之前的 [`unspaced_pair`]：谚文也算「不写空格的字符」。只给旧文稿用。
pub(crate) fn legacy_unspaced_pair(prev: char, next: char) -> bool {
    is_cjk_adjacent(prev) && is_cjk_adjacent(next)
}

/// 0.5 之前的 [`sep_len`]。只用来读旧文稿——见 [`legacy_glue`]。
fn legacy_sep_len(prev: &str, next: &str) -> usize {
    sep_len_with(prev, next, legacy_unspaced_pair)
}

/// 这道词缝在 0.5 之前不加空格、按现在的规则却会加：旧文稿里这样的词要带
/// 上「贴前」标记（[`crate::doc::Word::glue`]）才能保持原来的显示。
///
/// 命中的只有韩文逐音节的旧词：谚文挨谚文，以及谚文与破折号、省略号、弯
/// 引号外侧之间。读入旧版文稿、以及改写仍是逐音节的区间时，都用它给词定
/// 标记。
pub fn legacy_glue(prev: &str, next: &str) -> bool {
    legacy_sep_len(prev, next) == 0 && sep_len(prev, next) == 1
}

fn sep_len_with(prev: &str, next: &str, unspaced_pair: fn(char, char) -> bool) -> usize {
    let p = prev.chars().last();
    let n = next.chars().next();
    if let (Some(p), Some(n)) = (p, n)
        && unspaced_pair(p, n)
    {
        return 0;
    }
    if p.is_some_and(is_fullwidth_punctuation) || n.is_some_and(is_fullwidth_punctuation) {
        return 0;
    }
    let shared_content_side = |ch: char, opening: bool| {
        is_shared_typographic_mark(ch)
            && if opening {
                is_opening_delimiter(ch)
            } else {
                is_closing_delimiter(ch)
            }
    };
    if p.is_some_and(|ch| shared_content_side(ch, true))
        || n.is_some_and(|ch| shared_content_side(ch, false))
    {
        return 0;
    }
    if prev.ends_with(' ') || next.starts_with(' ') {
        return 0;
    }
    1
}

/// 拼接规则眼里的一个词：文本，加上文稿里存的「贴前」标记
/// （[`crate::doc::Word::glue`]）。标记为真时这个词与拼接序列里的前一个词
/// 之间不加空格，不论 [`sep_len`] 怎么判。
///
/// 纯文本（`&str` / `String`）没有标记，一律按 [`sep_len`] 走——译文原子、
/// 模型写回的片段都是这一类。凡是文本取自 `doc.words` 的地方，要么直接把
/// 词传进来，要么用 `(text, glue)` 把标记带上；只传文本会让带标记的文稿
/// 在那一处多出空格。
pub trait JoinWord {
    fn join_text(&self) -> &str;
    fn glued(&self) -> bool {
        false
    }
}

impl JoinWord for str {
    fn join_text(&self) -> &str {
        self
    }
}

impl JoinWord for String {
    fn join_text(&self) -> &str {
        self
    }
}

impl<T: JoinWord + ?Sized> JoinWord for &T {
    fn join_text(&self) -> &str {
        (**self).join_text()
    }
    fn glued(&self) -> bool {
        (**self).glued()
    }
}

impl JoinWord for (&str, bool) {
    fn join_text(&self) -> &str {
        self.0
    }
    fn glued(&self) -> bool {
        self.1
    }
}

impl JoinWord for (String, bool) {
    fn join_text(&self) -> &str {
        &self.0
    }
    fn glued(&self) -> bool {
        self.1
    }
}

/// 认「贴前」标记的 [`sep_len`]：`prev` 是已拼好的前缀（或前一个词的文本）。
pub fn word_sep<W: JoinWord + ?Sized>(prev: &str, next: &W) -> usize {
    if next.glued() {
        0
    } else {
        sep_len(prev, next.join_text())
    }
}

/// 词序列拼接为展示文本（汉字、假名之间不加空格；带「贴前」标记的词不加空格）。
pub fn join_word_texts<I>(words: I) -> String
where
    I: IntoIterator,
    I::Item: JoinWord,
{
    let mut output = String::new();
    for word in words {
        if !output.is_empty() && word_sep(&output, &word) == 1 {
            output.push(' ');
        }
        output.push_str(word.join_text());
    }
    output
}

/// 与 [`join_word_texts`] 同一把标尺：返回每个词边界处展示串的累计字符数。
///
/// `out[i]` 是前 `i + 1` 个词拼接后的字符数（含 `sep_len` 判定插入的空格），
/// 因此下标与输入词序列一一对应。任何需要把「显示串偏移」映射回词边界的地方
/// 都必须用它，而不是自行按词累加固定分隔宽度——后者在 CJK 邻接处会漂移。
pub fn join_prefix_char_lens<I>(words: I) -> Vec<usize>
where
    I: IntoIterator,
    I::Item: JoinWord,
{
    let mut output = String::new();
    let mut chars = 0_usize;
    let mut lens = Vec::new();
    for word in words {
        if !output.is_empty() && word_sep(&output, &word) == 1 {
            output.push(' ');
            chars += 1;
        }
        let text = word.join_text();
        output.push_str(text);
        chars += text.chars().count();
        lens.push(chars);
    }
    lens
}

/// 行宽度量：CJK 邻接字符记 2，其余记 1。
pub fn visual_width(text: &str) -> usize {
    text.chars()
        .map(|ch| if is_cjk_adjacent(ch) { 2 } else { 1 })
        .sum()
}

/// CPS 分子：非空白字符数。
pub fn count_cps_chars(text: &str) -> usize {
    text.chars().filter(|ch| !ch.is_whitespace()).count()
}

/// 归一化字符流：剥空白/标点/符号，逐字符小写展开（对拍 `SubAlign.normalizeChars`）。
/// 「模型只许加标点」由归一化后严格相等来证明。
pub fn normalize_chars(text: &str) -> String {
    let mut output = String::new();
    for ch in text.chars() {
        if ch.is_whitespace() || is_punctuation_or_symbol(ch) {
            continue;
        }
        for low in ch.to_lowercase() {
            output.push(low);
        }
    }
    output
}

/// LCS 原子键：归一化后字符串；纯标点原子键为空，调用方应剔除。
pub fn atom_key(atom: &str) -> Option<String> {
    let key = normalize_chars(atom);
    (!key.is_empty()).then_some(key)
}

/// 编辑距离（字符级 Levenshtein，滚动行）。
pub fn edit_distance(a: &[char], b: &[char]) -> usize {
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0_usize; b.len() + 1];
    for (i, &ca) in a.iter().enumerate() {
        current[0] = i + 1;
        for (j, &cb) in b.iter().enumerate() {
            let substitution = previous[j] + usize::from(ca != cb);
            current[j + 1] = substitution.min(previous[j + 1] + 1).min(current[j] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

/// 归一化相似度：`1 - editDistance/maxLen`；两侧皆空为 1。
pub fn similarity(a: &str, b: &str) -> f64 {
    let na: Vec<char> = normalize_chars(a).chars().collect();
    let nb: Vec<char> = normalize_chars(b).chars().collect();
    let max_len = na.len().max(nb.len());
    if max_len == 0 {
        return 1.0;
    }
    1.0 - edit_distance(&na, &nb) as f64 / max_len as f64
}

/// 字符权重（`TranscriptModel.wWeight`）：`max(2, letters+numbers+') + 1.4`。
pub fn w_weight(token: &str) -> f64 {
    let semantic = token
        .chars()
        .filter(|ch| ch.is_alphabetic() || ch.is_numeric() || *ch == '\'')
        .count();
    (semantic.max(2) as f64) + 1.4
}

/// rebind 空隙填充权重（`correctionTimingWeight`）：`max(1, letters+numbers+')`。
pub fn correction_timing_weight(token: &str) -> f64 {
    let semantic = token
        .chars()
        .filter(|ch| ch.is_alphabetic() || ch.is_numeric() || *ch == '\'')
        .count();
    semantic.max(1) as f64
}

const CLOSERS: &[char] = &['”', '"', '’', '\'', '」', '』', '）', ')', ']', '》'];
const TERMINAL: &[char] = &['。', '．', '.', '？', '?', '！', '!', '…'];
const CLAUSE_END: &[char] = &[',', ';', ':', '—', '–', '，', '；', '：', '、'];

/// 小写词干缩写表——`"Dr."` 的句点不是句末。
const SENTENCE_ABBREV: &[&str] = &[
    "mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "rev", "hon", "fr", "gen", "gov", "sen",
    "rep", "col", "lt", "sgt", "capt", "vs", "etc", "inc", "ltd", "corp", "dept", "vol", "fig",
];

/// 逆序跳过右引号/括号后看终止标点（对拍 `TranscriptBoundary.endsSentence`）。
pub fn ends_sentence(text: &str) -> bool {
    for ch in text.chars().rev() {
        if CLOSERS.contains(&ch) {
            continue;
        }
        return TERMINAL.contains(&ch);
    }
    false
}

/// 句末判定（对拍 `TranscriptModel.sentenceEnd`）：至多一个 closer 后的终止
/// 标点；`.` 在 token 内部另有 `.`（`2.14`/`a.com`）或词干是缩写时不算句末。
pub fn sentence_end(token: &str) -> bool {
    let trimmed: Vec<char> = token.chars().collect();
    let mut index = trimmed.len();
    let mut closers_skipped = 0;
    while index > 0 && CLOSERS.contains(&trimmed[index - 1]) && closers_skipped < 1 {
        index -= 1;
        closers_skipped += 1;
    }
    if index == 0 {
        return false;
    }
    let last = trimmed[index - 1];
    if !TERMINAL.contains(&last) {
        return false;
    }
    if last == '.' {
        let stem: String = trimmed[..index - 1].iter().collect();
        if stem.contains('.') {
            return false; // 2.14 / a.com / U.S.
        }
        let stem_lower = stem
            .trim_matches(|ch: char| !ch.is_alphanumeric())
            .to_lowercase();
        if SENTENCE_ABBREV.contains(&stem_lower.as_str()) {
            return false;
        }
    }
    true
}

/// 从句标点（`clauseEndChar`）：至多跳过一个右引号/括号后取尾标点。
/// 返回标点本身——破折号（打断/重启）与逗号类使用不同的断行门槛。
pub fn clause_end_char(token: &str) -> Option<char> {
    let chars: Vec<char> = token.chars().collect();
    let mut index = chars.len();
    if index > 0 && CLOSERS.contains(&chars[index - 1]) {
        index -= 1;
    }
    if index == 0 {
        return None;
    }
    let last = chars[index - 1];
    CLAUSE_END.contains(&last).then_some(last)
}

/// 第 `cut` 个原子边界在**原文里**是否真有空白背书。
///
/// [`atomize`] 丢掉空白，[`join_word_texts`] 又会在 CJK/Latin 交界补一个渲染
/// 用空格——于是「担心AI会抢走…」在原子层看起来和「你的 GPU 在…」一样有
/// 「词间空格缝」，但前者切的是动词和它的宾语从句。凡是把缝质量分级的地方
/// （DP 目标函数、自由缝判定）都必须用原文空白，而不是拼接后的空格。
pub fn seam_backed_by_whitespace(text: &str, atoms: &[String], cut: usize) -> bool {
    if cut == 0 || cut >= atoms.len() {
        return false;
    }
    let prefix_chars: usize = atoms[..cut].iter().map(|atom| atom.chars().count()).sum();
    let mut seen = 0usize;
    for ch in text.chars() {
        if seen == prefix_chars {
            return ch.is_whitespace();
        }
        if !ch.is_whitespace() {
            seen += 1;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_cjk_ascii_punctuation_targets_cjk_neighbors_only() {
        // 基准里观测到的传染源形态：Latin 词后紧跟 CJK。
        assert_eq!(
            normalize_cjk_ascii_punctuation("Martin,让我担心的是"),
            "Martin，让我担心的是"
        );
        assert_eq!(normalize_cjk_ascii_punctuation("他说:好"), "他说：好");
        assert_eq!(normalize_cjk_ascii_punctuation("分号;例子"), "分号；例子");
        // 两侧都不是 CJK：数字、时间、URL、纯英文原样保留。
        assert_eq!(
            normalize_cjk_ascii_punctuation("共 3,000 人"),
            "共 3,000 人"
        );
        assert_eq!(normalize_cjk_ascii_punctuation("10:30 开始"), "10:30 开始");
        assert_eq!(
            normalize_cjk_ascii_punctuation("见 http://example.com;q=1 页面"),
            "见 http://example.com;q=1 页面"
        );
        assert_eq!(
            normalize_cjk_ascii_punctuation("Keep tone light, direct: yes; ok"),
            "Keep tone light, direct: yes; ok"
        );
        // `.` 不在映射域（文件名/缩写歧义）；已是全角的文本幂等。
        assert_eq!(normalize_cjk_ascii_punctuation("配置好.env"), "配置好.env");
        let normalized = normalize_cjk_ascii_punctuation("他说：好，再见；完");
        assert_eq!(normalized, "他说：好，再见；完");
        assert_eq!(normalize_cjk_ascii_punctuation(&normalized), normalized);
    }

    #[test]
    fn seam_backing_follows_source_whitespace_not_rendered_spaces() {
        let text = "我发现很多人担心AI会抢走自己的工作。";
        let atoms = atomize(text);
        let cut = atoms
            .iter()
            .position(|atom| atom == "AI")
            .expect("AI atom present");
        // 拼接后是「担心 AI」，但原文没有空格：不是缝。
        assert!(!seam_backed_by_whitespace(text, &atoms, cut));

        let spaced = "你的 GPU 在显存读取之间会有空闲算力——";
        let spaced_atoms = atomize(spaced);
        let spaced_cut = spaced_atoms
            .iter()
            .position(|atom| atom == "在")
            .expect("在 atom present");
        assert!(seam_backed_by_whitespace(spaced, &spaced_atoms, spaced_cut));
    }

    #[test]
    fn atomize_matches_voiceink_test_vectors() {
        assert_eq!(atomize("你好，世界。"), vec!["你", "好，", "世", "界。"]);
        // 汉字、假名逐字；韩文按空格分词。
        assert_eq!(
            atomize("いい天気 한국어"),
            vec!["い", "い", "天", "気", "한국어"]
        );
        assert_eq!(
            atomize("3.14 U.S. don't state-of-the-art a.com"),
            vec!["3.14", "U.S.", "don't", "state-of-the-art", "a.com"]
        );
        assert_eq!(
            atomize("$100 50% 😀 +value"),
            vec!["$100", "50%", "😀", "+value"]
        );
    }

    /// 组合记号不切词：切完再拼回去必须还是原文。
    #[test]
    fn combining_marks_stay_inside_their_word() {
        // 泰文：声调符 U+0E49 / U+0E48 是 Mn 且不是字母。
        assert_eq!(atomize("พื้นที่"), vec!["พื้นที่"]);
        assert_eq!(atomize("ผมไม่ได้ไป ตลาดน้ำ"), vec!["ผมไม่ได้ไป", "ตลาดน้ำ"]);
        // 天城文：virama U+094D、nukta U+093C；孟加拉文 hasanta U+09CD；
        // 泰米尔文 pulli U+0BCD。
        assert_eq!(atomize("क्या हुआ?"), vec!["क्या", "हुआ?"]);
        assert_eq!(atomize("ज़रूरी"), vec!["ज़रूरी"]);
        assert_eq!(atomize("বাংলা ভাষার জন্য"), vec!["বাংলা", "ভাষার", "জন্য"]);
        assert_eq!(atomize("தமிழ் மொழி"), vec!["தமிழ்", "மொழி"]);
        // 阿拉伯文 tashkeel、希伯来文 niqqud。
        assert_eq!(atomize("مَرْحَبًا بِكُمْ"), vec!["مَرْحَبًا", "بِكُمْ"]);
        assert_eq!(atomize("שָׁלוֹם עוֹלָם"), vec!["שָׁלוֹם", "עוֹלָם"]);
        // 分解形式（NFD）的拉丁重音。
        assert_eq!(
            atomize("re\u{301}sume\u{301} done"),
            vec!["re\u{301}sume\u{301}", "done"]
        );
        // 零宽连接符（波斯文 ZWNJ、僧伽罗文 ZWJ）留在词内。
        assert_eq!(atomize("می\u{200C}خواهم"), vec!["می\u{200C}خواهم"]);
        // CJK 字后的组合浊点跟着那个字。
        assert_eq!(atomize("か\u{3099}き"), vec!["か\u{3099}", "き"]);
        // 词尾标点之后的记号仍跟着前一个原子，不另起一个。
        assert_eq!(atomize("a.\u{301} b"), vec!["a.\u{301}", "b"]);
        // 表情的变体选择符 U+FE0F 也是 Mn：照旧随表情一起。
        assert_eq!(atomize("I ❤\u{FE0F} you"), vec!["I", "❤\u{FE0F}", "you"]);
        assert_eq!(atomize("ok❤\u{FE0F}"), vec!["ok❤\u{FE0F}"]);
        for text in [
            "พื้นที่ ของ เรา",
            "क्या आप ठीक हैं?",
            "مَرْحَبًا بِكُمْ",
            "re\u{301}sume\u{301} done",
        ] {
            assert_eq!(
                join_word_texts(atomize(text).iter().map(String::as_str)),
                text
            );
        }
    }

    /// 韩文按空格分词：一个어절一个原子，标点跟着它所在的어절，拼回去就是
    /// 原文。这张表与 `bcut-editor-core/src/subtext.rs` 的同名测试逐条相同。
    #[test]
    fn korean_is_cut_and_joined_at_spaces() {
        assert_eq!(
            atomize("저는 내일 학교에 갑니다."),
            vec!["저는", "내일", "학교에", "갑니다."]
        );
        assert_eq!(
            atomize("“안녕하세요,” 그가 말했다."),
            vec!["“안녕하세요,”", "그가", "말했다."]
        );
        // 谚文与拉丁、数字连写是一个어절。
        assert_eq!(
            atomize("iPhone을 3개 샀어요"),
            vec!["iPhone을", "3개", "샀어요"]
        );
        // 夹在韩文里的汉字仍逐字，且与谚文贴着。
        assert_eq!(atomize("大韓민국"), vec!["大", "韓", "민국"]);
        for text in [
            "저는 내일 학교에 갑니다.",
            "“안녕하세요,” 그가 말했다.",
            "iPhone을 3개 샀어요",
            "그래서… 네, 맞아요 — 정말로",
            "大韓민국 만세",
            "他说안녕하세요就走了",
        ] {
            assert_eq!(
                join_word_texts(atomize(text).iter().map(String::as_str)),
                text,
            );
        }
        // 词缝：谚文与谚文之间是 1；谚文挨汉字 / 假名是 0；全角标点照旧
        // 单侧闭合；共用排印符按拉丁规则。
        assert_eq!(sep_len("저는", "내일"), 1);
        assert_eq!(sep_len("갑니다.", "저는"), 1);
        assert_eq!(sep_len("韓", "민국"), 0);
        assert_eq!(sep_len("민국", "万"), 0);
        assert_eq!(sep_len("の", "한국"), 0);
        assert_eq!(sep_len("「", "안녕"), 0);
        assert_eq!(sep_len("안녕", "」"), 0);
        assert_eq!(sep_len("“", "안녕"), 0);
        assert_eq!(sep_len("안녕", "”"), 0);
        assert_eq!(sep_len("그래서…", "네"), 1);
        assert_eq!(sep_len("맞아요", "—"), 1);
        assert_eq!(sep_len("iPhone", "을"), 1);
        // 宽度不变：谚文仍是两格。
        assert_eq!(visual_width("한국어 ab"), 9);
        assert!(is_cjk_char('한') && !is_unspaced_cjk_char('한'));
        assert!(spaced_script_letter('한') && !spaced_script_letter('漢'));
        // 韩文用半角标点：不换全角。
        assert_eq!(
            normalize_cjk_ascii_punctuation("네, 맞아요: 정말; 그래요"),
            "네, 맞아요: 정말; 그래요"
        );
    }

    /// 逐音节的口径留给比对、计量与旧文稿：与 0.5 之前的 `atomize` 逐字相同。
    #[test]
    fn syllable_atoms_keep_the_pre_0_5_cut() {
        assert_eq!(
            atomize_syllables("いい天気 한국어"),
            vec!["い", "い", "天", "気", "한", "국", "어"]
        );
        assert_eq!(
            atomize_syllables("저는 내일, 갑니다."),
            vec!["저", "는", "내", "일,", "갑", "니", "다."]
        );
        // 不含谚文的文本两种口径逐字相同。
        for text in [
            "你好，世界。",
            "3.14 U.S. don't state-of-the-art a.com",
            "他用 Agent 来做",
            "ผมไม่ได้ไป ตลาดน้ำ",
            "いい天気ですね。",
        ] {
            assert_eq!(atomize_syllables(text), atomize(text), "{text}");
        }
        // 预算按音节计。
        assert_eq!(word_count("저는 내일 학교에 갑니다."), 10);
        // 一个旧词（单音节，标点跟着它）在两种口径下都是一个原子。
        for word in ["한", "다.", "(그", "어,”"] {
            assert_eq!(atomize(word), vec![word]);
            assert_eq!(atomize_syllables(word), vec![word]);
        }
        // 区间里有带标记的词就沿用逐音节。
        let legacy = [("저", false), ("는", true)];
        let fresh = [("저는", false), ("내일", false)];
        assert_eq!(atomize_like(&legacy, "저는"), vec!["저", "는"]);
        assert_eq!(atomize_like(&fresh, "저는"), vec!["저는"]);
    }

    /// 泰文区间改写时锚定在原有的词上：原文不变就切回原来的词（哪怕区间从
    /// 短语中间开始、单独重切会换切法），只改了中间时首尾的词不动。
    #[test]
    fn script_word_spans_are_recut_only_where_the_text_changed() {
        let phrase = "ลลิตาไม่ได้ยกเลิกการประชุมแต่เลื่อนไปเป็นวันพฤหัสบดี";
        let whole = atomize_words(phrase);
        assert!(whole.len() >= 8, "{whole:?}");
        for (start, end) in [(0, 4), (1, 5), (2, whole.len()), (0, whole.len())] {
            let span = &whole[start..end];
            let text = join_word_texts(span.iter());
            let mut expected = span.to_vec();
            expected[0].1 = false; // 区间首词与区间前的关系由调用方保持
            assert_eq!(atomize_words_like(span, &text), expected, "{start}..{end}");
            assert_eq!(
                atomize_like(span, &text),
                span.iter()
                    .map(|(atom, _)| atom.clone())
                    .collect::<Vec<_>>()
            );
        }
        // 只改中间一个词：首尾的词原样保留。
        let span = &whole[..];
        let edited = join_word_texts(
            span.iter()
                .enumerate()
                .map(|(index, (atom, glue))| {
                    let atom = if index == 3 {
                        "ยกเลิกการ"
                    } else {
                        atom.as_str()
                    };
                    (atom.to_owned(), *glue)
                })
                .collect::<Vec<_>>()
                .iter(),
        );
        let recut = atomize_words_like(span, &edited);
        assert_eq!(join_word_texts(recut.iter()), edited);
        let head: Vec<(String, bool)> = span[..3]
            .iter()
            .enumerate()
            .map(|(index, (atom, glue))| (atom.clone(), *glue && index > 0))
            .collect();
        assert_eq!(recut[..3], head[..]);
        assert_eq!(recut.last(), span.last());
        // 已有的一个词按原样当一个原子。
        for (atom, _) in &whole {
            assert_eq!(atomize_word_like(span, atom), vec![atom.clone()]);
        }
    }

    /// 不写空格的文字按词切开、带标记；其余文字与 [`atomize`] 逐个相同。
    #[test]
    fn atomize_words_splits_unspaced_scripts_and_leaves_the_rest_alone() {
        for text in [
            "Hello, world — it's state-of-the-art.",
            "大家好，今天天气不错。",
            "저는 내일 아이폰을 샀다.",
            "اشترينا 2.5 كيلوغرام من الأرز، وبقي نصفه.",
            "मैंने कल किताब पढ़ी।",
            "いい天気 한국어 mix 3.14",
        ] {
            let words = atomize_words(text);
            let atoms: Vec<String> = words.iter().map(|(atom, _)| atom.clone()).collect();
            assert_eq!(atoms, atomize(text), "{text}");
            assert!(words.iter().all(|(_, glue)| !glue), "{text}");
        }
        for text in [
            "ลลิตาไม่ได้ยกเลิกการประชุมแต่เลื่อนไปเป็นวันพฤหัสบดีเวลา14:30น.",
            "รหัสF-07ปรากฏข้างคำว่า“ยืนยันแล้ว”แต่ยังไม่ได้ส่งพัสดุ",
            "ถ้าอุณหภูมิลดลงต่ำกว่า5องศา ให้ปิดหน้าต่างก่อน",
            "ເຈົ້າສະບາຍດີບໍ່",
            "ខ្ញុំស្រលាញ់ភាសាខ្មែរ",
            "မြန်မာဘာသာစကား",
            "བོད་ཡིག་ནི་ཡག་པོ་རེད།",
            "พื้นที่ทำงาน",
        ] {
            let words = atomize_words(text);
            assert!(words.len() > 1, "{text}: {words:?}");
            assert!(!words[0].1, "{text}");
            let rejoined = join_word_texts(words.iter().map(|(atom, glue)| (atom.as_str(), *glue)));
            assert_eq!(rejoined, text, "{words:?}");
            for (atom, _) in &words {
                let first = atom.chars().next().unwrap();
                assert!(
                    !is_combining(first),
                    "a word never starts with a mark: {atom}"
                );
            }
        }
        // 夹在泰文里的拉丁 / 数字段不拆；引号不单独成词（原子内的开引号跟
        // 后一个词，原子边上的引号沿用 atomize 的归属）。
        let words = atomize_words("รหัสF-07ปรากฏข้างคำว่า“ยืนยันแล้ว”แต่");
        let atoms: Vec<&str> = words.iter().map(|(atom, _)| atom.as_str()).collect();
        assert!(atoms.contains(&"F-07"), "{atoms:?}");
        assert!(!atoms.contains(&"“") && !atoms.contains(&"”"), "{atoms:?}");
        let words = atomize_words("เขาพูด“สวัสดี”ครับ");
        let atoms: Vec<&str> = words.iter().map(|(atom, _)| atom.as_str()).collect();
        assert!(!atoms.contains(&"“") && !atoms.contains(&"”"), "{atoms:?}");
        // 短语之间的空格不带标记。
        let words = atomize_words("สวัสดีครับ ขอบคุณ");
        let after_space = words
            .iter()
            .position(|(atom, _)| atom.starts_with("ขอบ"))
            .unwrap();
        assert!(!words[after_space].1);
    }

    #[test]
    fn script_glue_follows_the_text_only_at_unspaced_script_seams() {
        assert_eq!(
            script_glue_from_text(&["ลลิตา", "ไม่ได้", "การประชุม"], "ลลิตาไม่ได้ การประชุม"),
            Some(vec![false, true, false])
        );
        assert_eq!(
            script_glue_from_text(&["เวลา", "14:30", "น."], "เวลา14:30น."),
            Some(vec![false, true, true])
        );
        // 中日文逐字、拉丁词：不带标记（拼接规则本来就对）。
        assert_eq!(
            script_glue_from_text(&["大", "家"], "大家"),
            Some(vec![false, false])
        );
        assert_eq!(
            script_glue_from_text(&["don", "'t"], "don't"),
            Some(vec![false, false])
        );
        // 对不上原文就不给。
        assert_eq!(
            script_glue_from_text(&["ลลิตา", "ยกเลิก"], "ลลิตาไม่ได้ยกเลิก"),
            None
        );
    }

    /// 两种「贴前」词分得开：旧韩文逐音节的词含谚文，泰文一类的不含。
    #[test]
    fn legacy_and_script_glue_are_told_apart() {
        assert!(is_legacy_glued(&("는", true)));
        assert!(!is_legacy_glued(&("는", false)));
        assert!(is_script_glued(&("ได้", true)));
        assert!(!is_script_glued(&("는", true)));
        let thai = [("ลลิตา", false), ("ไม่ได้", true)];
        let atoms = atomize_like(&thai, "ลลิตาไม่ได้ยกเลิก");
        assert!(atoms.len() >= 3, "{atoms:?}");
        let words = atomize_words_like(&thai, "ลลิตาไม่ได้ยกเลิก");
        assert!(words[1..].iter().all(|(_, glue)| *glue));
        let legacy = [("저", false), ("는", true)];
        assert_eq!(atomize_like(&legacy, "저는"), vec!["저", "는"]);
        assert_eq!(
            atomize_words_like(&legacy, "저는"),
            vec![("저".to_owned(), false), ("는".to_owned(), false)]
        );
        // 没有标记的泰文区间（0.5 之前、或按短语建的文稿）按短语，与以前相同。
        let phrases = [("ลลิตาไม่ได้", false)];
        assert_eq!(
            atomize_like(&phrases, "ลลิตาไม่ได้ยกเลิก"),
            vec!["ลลิตาไม่ได้ยกเลิก"]
        );
    }

    /// 旧文稿的词缝：0.5 之前不加空格、现在会加的缝才带标记。
    #[test]
    fn legacy_glue_marks_exactly_the_seams_the_rule_change_would_open() {
        assert!(legacy_glue("저", "는"));
        assert!(legacy_glue("다—", "그"));
        assert!(legacy_glue("…", "네"));
        // 两种规则答案相同的缝不带标记。
        assert!(!legacy_glue("다.", "그")); // 都是 1
        assert!(!legacy_glue("iPhone", "을")); // 都是 1
        assert!(!legacy_glue("韓", "국")); // 都是 0
        assert!(!legacy_glue("「", "안")); // 都是 0
        assert!(!legacy_glue("你", "好"));
        assert!(!legacy_glue("hello", "world"));
        assert!(!legacy_glue("い", "い"));
        // 带上标记后，逐音节的旧词拼出来与 0.5 之前逐字相同。
        let words = [
            "저", "는", "내", "일", "iPhone", "을", "샀", "다.", "그", "래", "요",
        ];
        let mut marked: Vec<(&str, bool)> = Vec::new();
        let mut legacy = String::new();
        for (index, word) in words.iter().enumerate() {
            let glue = index > 0 && legacy_glue(words[index - 1], word);
            if index > 0 && legacy_sep_len(&legacy, word) == 1 {
                legacy.push(' ');
            }
            legacy.push_str(word);
            marked.push((word, glue));
        }
        assert_eq!(legacy, "저는내일 iPhone 을샀다. 그래요");
        assert_eq!(join_word_texts(marked), legacy);
    }

    #[test]
    fn word_count_matches_atomize_across_scripts() {
        // 纯英文：按词计。
        assert_eq!(
            word_count("alpha bravo charlie delta echo, foxtrot golf hotel."),
            8
        );
        // 纯中文：逐字计，句末标点依附前一原子。
        assert_eq!(word_count("你好，世界。"), 4);
        // 中英混排。
        assert_eq!(word_count("他用 Agent 来做"), 5);
        // 数字与内聚标点不被拆开。
        assert_eq!(word_count("3.14 U.S. don't state-of-the-art a.com"), 5);
        assert_eq!(word_count(""), 0);
    }

    #[test]
    fn word_count_exposes_cjk_information_density() {
        // 同样的字符数，CJK 的词数远高于 Latin —— 这正是按字符计页预算对两种
        // 语言不公平的原因。
        let zh = "人工智能正在改变视频剪辑的工作方式。";
        let en = "we ship fast video";
        assert_eq!(zh.chars().count(), en.chars().count());
        assert_eq!(word_count(zh), 17);
        assert_eq!(word_count(en), 4);
        assert!(word_count(zh) > word_count(en) * 3);
    }

    #[test]
    fn atomize_is_lossless_for_non_whitespace() {
        let input = "Hello, 世界! $100 (test) …";
        let atoms = atomize(input);
        let joined: String = atoms.concat();
        let expected: String = input.chars().filter(|ch| !ch.is_whitespace()).collect();
        assert_eq!(joined, expected);
    }

    #[test]
    fn sep_len_and_join_respect_cjk_adjacency() {
        assert_eq!(sep_len("你", "好"), 0);
        assert_eq!(sep_len("hello", "world"), 1);
        assert_eq!(sep_len("好，", "世"), 0);
        assert_eq!(
            join_word_texts(["他", "用", "Agent", "来", "做"]),
            "他用 Agent 来做"
        );
        // 全角标点自带留白：任一侧命中即闭合（单侧规则）。
        assert_eq!(sep_len("Agent", "（"), 0);
        assert_eq!(sep_len("）", "Agent"), 0);
        assert_eq!(sep_len("名为「", "PluginDataJSON」"), 0);
        // 共用排印符只在缝落到自身内容侧时闭合：开定界符看 prev 末尾、
        // 闭定界符看 next 开头。原报障 `名为“ | PluginDataJSON”` 必须是 0。
        assert_eq!(sep_len("名为“", "PluginDataJSON”"), 0);
        assert_eq!(sep_len("PluginDataJSON”", "的"), 0);
        assert_eq!(sep_len("他说", "“你好"), 0);
        // …而 Latin 语境里同一批符号必须保留空格（英文是真实目标语）。
        assert_eq!(sep_len("said", "“Hello"), 1);
        assert_eq!(sep_len("students’", "books"), 1);
        assert_eq!(sep_len("so…", "yeah"), 1);
        assert_eq!(sep_len("dash—", "next"), 1);
        // 已知取舍：闭引号外侧接 Latin 无法靠两字符区分中英语境，按英文取 1
        //（等同本次改动前的原有行为）。
        assert_eq!(sep_len("”", "Agent"), 1);
        // 全角字母/数字不是标点，仍按普通词处理。
        assert_eq!(sep_len("Ａ", "B"), 1);
        assert_eq!(sep_len("A", "１"), 1);
        // 共用排印符的开/闭归类按 Unicode 类别核实，不靠记忆：
        // U+2018 Pi、U+201A Ps、U+201B Pi、U+201C Pi / U+2019 Pf、U+201D Pf /
        // U+2014 Pd、U+2026 Po（两者皆非定界符，只走双侧规则）。
        for ch in ['‘', '‚', '‛', '“'] {
            assert!(
                is_shared_typographic_mark(ch) && is_opening_delimiter(ch),
                "{ch}"
            );
        }
        for ch in ['’', '”'] {
            assert!(
                is_shared_typographic_mark(ch) && is_closing_delimiter(ch),
                "{ch}"
            );
        }
        for ch in ['—', '…'] {
            assert!(is_shared_typographic_mark(ch), "{ch}");
            assert!(
                !is_opening_delimiter(ch) && !is_closing_delimiter(ch),
                "{ch}"
            );
        }
        // 共用排印符不属于全角块，全角标点也不属于共用排印符（两类互斥）。
        assert!(!is_fullwidth_punctuation('“') && !is_fullwidth_punctuation('…'));
        assert!(is_fullwidth_punctuation('「') && !is_shared_typographic_mark('「'));
        assert!(!is_fullwidth_punctuation('Ａ') && !is_fullwidth_punctuation('１'));
        // 成对定界符跨 Latin 内容时 canonical 必须与原文逐字相等。
        assert_eq!(
            join_word_texts(["包", "含", "名为“", "PluginDataJSON”的", "清", "单"]),
            "包含名为“PluginDataJSON”的清单"
        );
        // 英文引用整段往返必须逐字无损（tier 3 若退化成单侧规则，这里会塌成
        // `said“Hello world”today`）。
        assert_eq!(
            join_word_texts(["said", "“Hello", "world”", "today"]),
            "said “Hello world” today"
        );
    }

    #[test]
    fn width_and_cps_metrics_differ() {
        assert_eq!(visual_width("你好ab"), 6);
        assert_eq!(count_cps_chars("你好 ab"), 4);
    }

    #[test]
    fn normalize_strips_punct_and_lowercases() {
        assert_eq!(normalize_chars("Hi, 你好!"), "hi你好");
        assert_eq!(atom_key("…"), None);
        assert_eq!(atom_key("Hi,"), Some("hi".to_owned()));
    }

    #[test]
    fn similarity_matches_reference_cases() {
        assert_eq!(
            edit_distance(
                &"kitten".chars().collect::<Vec<_>>(),
                &"sitting".chars().collect::<Vec<_>>()
            ),
            3
        );
        assert_eq!(similarity("Hello, WORLD!", "hello world"), 1.0);
        assert_eq!(similarity("...", ""), 1.0);
        assert!(similarity("hello", "完全不同") < 0.3);
    }

    #[test]
    fn sentence_end_rejects_abbreviations_and_interior_dots() {
        assert!(sentence_end("ready."));
        assert!(sentence_end("好。"));
        assert!(sentence_end("done.\""));
        assert!(!sentence_end("2.14"));
        assert!(!sentence_end("agents.md"));
        assert!(!sentence_end("Dr."));
        assert!(!sentence_end("e.g."));
        assert!(!sentence_end("hello,"));
        assert_eq!(clause_end_char("hello,"), Some(','));
        assert_eq!(clause_end_char("wait—"), Some('—'));
        assert_eq!(clause_end_char("said,\""), Some(','));
        assert_eq!(clause_end_char("plain"), None);
        assert!(ends_sentence("说完了。」"));
    }

    #[test]
    fn a_glued_word_joins_without_a_space_whatever_its_neighbours_are() {
        // 纯文本没有标记，照字符规则来。
        assert_eq!(join_word_texts(["hello", "world"]), "hello world");
        assert_eq!(word_sep("hello", "world"), 1);
        // 带标记的词贴住前一个词：拼接、分隔宽度、前缀长度三处同一口径。
        let words = [("hello", false), ("world", true), ("again", false)];
        assert_eq!(join_word_texts(words), "helloworld again");
        assert_eq!(word_sep("hello", &words[1]), 0);
        assert_eq!(word_sep("world", &words[2]), 1);
        assert_eq!(join_prefix_char_lens(words), vec![5, 10, 16]);
        // 首词的标记没有前一个词可贴。
        assert_eq!(join_word_texts([("hello", true)]), "hello");
        // 没有标记时与纯文本逐字相同。
        let plain = ["他", "用", "Agent", "来", "做"];
        assert_eq!(
            join_word_texts(plain.map(|text| (text, false))),
            join_word_texts(plain)
        );
    }

    #[test]
    fn weights_match_voiceink_formulas() {
        assert_eq!(w_weight("a"), 3.4); // max(2,1)+1.4
        assert_eq!(w_weight("hello"), 6.4);
        assert_eq!(w_weight("don't"), 6.4); // 5 semantic chars (含 ')
        assert_eq!(correction_timing_weight("…"), 1.0);
        assert_eq!(correction_timing_weight("came"), 4.0);
    }
}
