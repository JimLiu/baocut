//! TimeExpr 解析（规范 §5.2 / 附录 A EBNF）。
//! 求值发生在 Resolver（需要 cue 表与 clip 窗口）；此处只做语法解析。

use anyhow::{Result, bail};

#[derive(Debug, Clone, PartialEq)]
pub enum TimeExpr {
    /// 全片绝对秒
    Abs(f64),
    /// @scene / #clip 锚点 + 偏移
    Anchor {
        /// '@' 场景 或 '#' clip
        sigil: char,
        id: String,
        mark: Mark,
        /// 绝对秒偏移（不随伸缩）
        offset: f64,
    },
    /// ~词锚点（规范 §5.2）：锚到某媒体转录中的一个词，经 §18.6 映射求值。
    Word {
        /// 媒体 id 或引用该媒体的 clip id
        ref_id: String,
        word_id: String,
        /// true = 词尾 t1；false = 词首 t0（缺省）
        mark_end: bool,
        offset: f64,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum Mark {
    Start,
    End,
    /// 场景时长百分比（0..100），仅 @scene 合法
    Pct(f64),
}

pub fn parse(s: &str) -> Result<TimeExpr> {
    let s = s.trim();
    if let Ok(n) = s.parse::<f64>() {
        return Ok(TimeExpr::Abs(n));
    }
    if let Some(rest) = s.strip_prefix('~') {
        return parse_word_anchor(rest, s);
    }
    let mut chars = s.char_indices().peekable();
    let (_, sigil) = chars
        .next()
        .filter(|(_, c)| *c == '@' || *c == '#')
        .map_or_else(|| (0, '\0'), |(i, c)| (i, c));
    if sigil == '\0' {
        bail!("非法 TimeExpr: \"{s}\"");
    }

    // ident: [A-Za-z_][A-Za-z0-9_-]*
    // '-' 既是 ident 合法字符又是偏移符号（"@growth-0.4"），
    // 与参考实现的正则回溯一致：从最长 ident 往回试，直到尾部可完整解析。
    let rest = &s[1..];
    let mut max_id = 0;
    for (i, c) in rest.char_indices() {
        let ok = if i == 0 {
            c.is_ascii_alphabetic() || c == '_'
        } else {
            c.is_ascii_alphanumeric() || c == '_' || c == '-'
        };
        if !ok {
            break;
        }
        max_id = i + c.len_utf8();
    }
    if max_id == 0 {
        bail!("非法 TimeExpr: \"{s}\"（缺少标识符）");
    }
    let mut candidates: Vec<usize> = (1..=max_id)
        .filter(|&i| rest.is_char_boundary(i) && !rest[..i].ends_with('-'))
        .collect();
    candidates.reverse();
    for id_end in candidates {
        let id = &rest[..id_end];
        if let Some((mark, offset)) = parse_tail(&rest[id_end..], sigil) {
            return Ok(TimeExpr::Anchor {
                sigil,
                id: id.to_string(),
                mark,
                offset,
            });
        }
    }
    bail!("非法 TimeExpr: \"{s}\"")
}

/// `~refId:wordId[:start|:end][±offset]`（附录 A word-anchor）。
/// 词 id 合法字符含 `.` 与 `-`，因此负偏移只允许出现在显式 `:start`/`:end` 之后；
/// 正偏移（`+`）不与词 id 字符冲突，可直接跟随。
fn parse_word_anchor(rest: &str, whole: &str) -> Result<TimeExpr> {
    // refId: [A-Za-z_][A-Za-z0-9_-]*
    let mut id_end = 0;
    for (i, c) in rest.char_indices() {
        let ok = if i == 0 {
            c.is_ascii_alphabetic() || c == '_'
        } else {
            c.is_ascii_alphanumeric() || c == '_' || c == '-'
        };
        if !ok {
            break;
        }
        id_end = i + c.len_utf8();
    }
    if id_end == 0 {
        bail!("非法 TimeExpr: \"{whole}\"（词锚点缺少媒体/clip 标识符）");
    }
    let ref_id = &rest[..id_end];
    let Some(after_ref) = rest[id_end..].strip_prefix(':') else {
        bail!("非法 TimeExpr: \"{whole}\"（词锚点须为 ~refId:wordId 形态）");
    };
    // wordId: [A-Za-z0-9][A-Za-z0-9._-]*（贪婪；'-' 属于词 id，不当负偏移切分）
    let mut w_end = 0;
    for (i, c) in after_ref.char_indices() {
        let ok = if i == 0 {
            c.is_ascii_alphanumeric()
        } else {
            c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-'
        };
        if !ok {
            break;
        }
        w_end = i + c.len_utf8();
    }
    if w_end == 0 {
        bail!("非法 TimeExpr: \"{whole}\"（词锚点缺少词 id）");
    }
    let word_id = &after_ref[..w_end];
    let mut tail = &after_ref[w_end..];

    let mut mark_end = false;
    let mut explicit_mark = false;
    if let Some(t) = tail.strip_prefix(":start") {
        explicit_mark = true;
        tail = t;
    } else if let Some(t) = tail.strip_prefix(":end") {
        mark_end = true;
        explicit_mark = true;
        tail = t;
    }

    let mut offset = 0.0;
    let t = tail.trim_start();
    if !t.is_empty() {
        let (sign, num) = if let Some(n) = t.strip_prefix('+') {
            (1.0, n)
        } else if let Some(n) = t.strip_prefix('-') {
            if !explicit_mark {
                bail!("非法 TimeExpr: \"{whole}\"（负偏移须跟在显式 :start/:end 之后）");
            }
            (-1.0, n)
        } else {
            bail!("非法 TimeExpr: \"{whole}\"");
        };
        offset = sign
            * num
                .trim_start()
                .parse::<f64>()
                .map_err(|_| anyhow::anyhow!("非法 TimeExpr: \"{whole}\"（偏移不是数字）"))?;
    }
    Ok(TimeExpr::Word {
        ref_id: ref_id.to_string(),
        word_id: word_id.to_string(),
        mark_end,
        offset,
    })
}

/// 解析 ident 之后的部分：[.mark][±offset]，必须整段耗尽。
fn parse_tail(tail: &str, sigil: char) -> Option<(Mark, f64)> {
    let mut mark = Mark::Start;
    let mut tail = tail;
    if let Some(after) = tail.strip_prefix('.') {
        if let Some(t) = after.strip_prefix("start") {
            mark = Mark::Start;
            tail = t;
        } else if let Some(t) = after.strip_prefix("end") {
            mark = Mark::End;
            tail = t;
        } else {
            // 百分比：数字 + '%'
            let num_end = after
                .char_indices()
                .take_while(|(_, c)| c.is_ascii_digit() || *c == '.')
                .last()
                .map(|(i, c)| i + c.len_utf8())
                .unwrap_or(0);
            if num_end == 0 || !after[num_end..].starts_with('%') || sigil == '#' {
                return None;
            }
            mark = Mark::Pct(after[..num_end].parse().ok()?);
            tail = &after[num_end + 1..];
        }
    }
    let mut offset = 0.0;
    let t = tail.trim_start();
    if !t.is_empty() {
        let (sign, num) = if let Some(n) = t.strip_prefix('+') {
            (1.0, n)
        } else if let Some(n) = t.strip_prefix('-') {
            (-1.0, n)
        } else {
            return None;
        };
        offset = sign * num.trim_start().parse::<f64>().ok()?;
    }
    Some((mark, offset))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_forms() {
        assert_eq!(parse("2.5").unwrap(), TimeExpr::Abs(2.5));
        assert_eq!(
            parse("@growth").unwrap(),
            TimeExpr::Anchor {
                sigil: '@',
                id: "growth".into(),
                mark: Mark::Start,
                offset: 0.0
            }
        );
        assert_eq!(
            parse("@growth.end-0.3").unwrap(),
            TimeExpr::Anchor {
                sigil: '@',
                id: "growth".into(),
                mark: Mark::End,
                offset: -0.3
            }
        );
        assert_eq!(
            parse("@growth.40%").unwrap(),
            TimeExpr::Anchor {
                sigil: '@',
                id: "growth".into(),
                mark: Mark::Pct(40.0),
                offset: 0.0
            }
        );
        assert_eq!(
            parse("#opening-shot.end").unwrap(),
            TimeExpr::Anchor {
                sigil: '#',
                id: "opening-shot".into(),
                mark: Mark::End,
                offset: 0.0
            }
        );
        assert_eq!(
            parse("@growth + 0.5").unwrap(),
            TimeExpr::Anchor {
                sigil: '@',
                id: "growth".into(),
                mark: Mark::Start,
                offset: 0.5
            }
        );
    }

    #[test]
    fn parse_errors() {
        assert!(parse("@").is_err());
        assert!(parse("growth").is_err());
        assert!(parse("#clip.40%").is_err());
        assert!(parse("@scene.middle").is_err());
        assert!(parse("@scene..").is_err());
    }

    fn word(ref_id: &str, word_id: &str, mark_end: bool, offset: f64) -> TimeExpr {
        TimeExpr::Word {
            ref_id: ref_id.into(),
            word_id: word_id.into(),
            mark_end,
            offset,
        }
    }

    #[test]
    fn parse_word_anchors() {
        assert_eq!(
            parse("~interview:g3.7").unwrap(),
            word("interview", "g3.7", false, 0.0)
        );
        assert_eq!(
            parse("~interview:g3.7:end").unwrap(),
            word("interview", "g3.7", true, 0.0)
        );
        assert_eq!(
            parse("~interview:g3.7:end-0.15").unwrap(),
            word("interview", "g3.7", true, -0.15)
        );
        assert_eq!(
            parse("~interview:g3.7:start-0.2").unwrap(),
            word("interview", "g3.7", false, -0.2)
        );
        // 正偏移可直接跟随（'+' 不是词 id 字符）
        assert_eq!(parse("~m:g3.7+0.2").unwrap(), word("m", "g3.7", false, 0.2));
        assert_eq!(
            parse("~m:g3.7 + 0.2").unwrap(),
            word("m", "g3.7", false, 0.2)
        );
        // 编辑新造词 id 含 '-'：整段吸收进词 id
        assert_eq!(
            parse("~m:w1a2b-3").unwrap(),
            word("m", "w1a2b-3", false, 0.0)
        );
        assert_eq!(
            parse("~m:w1a2b-3:end-0.1").unwrap(),
            word("m", "w1a2b-3", true, -0.1)
        );
        // clip 限定形态
        assert_eq!(
            parse("~clip-a:g0.1").unwrap(),
            word("clip-a", "g0.1", false, 0.0)
        );
    }

    #[test]
    fn parse_word_anchor_errors() {
        // 无显式 mark 时 " - 0.15" 无法与词 id 区分 → 拒绝
        assert!(parse("~m:g3.7 - 0.15").is_err());
        assert!(parse("~m").is_err()); // 缺 :wordId
        assert!(parse("~m:").is_err());
        assert!(parse("~:g3.7").is_err()); // 缺 refId
        assert!(parse("~m:g3.7:middle").is_err()); // 未知 mark（:m 不是词 id 字符续段）
        assert!(parse("~m:g3.7:end+x").is_err());
    }
}
