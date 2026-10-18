//! 行级 diff 与补丁（版本记录，视频格式规范 §9）：Myers 求差得到标准 unified diff，反向应用时要求精确匹配。
//!
//! 只处理以换行结尾的 UTF-8 文本（工作区快照都是），按 `\n` 切行。求差先去掉相同的头尾，再按 Myers 的中间蛇递归；
//! 一段的编辑距离超过 [`MAX_EDIT_COST`] 时整段按删除加插入处理：结果仍是正确的 diff，只是不再最短。

use std::collections::{BTreeMap, HashMap};

/// 上下文行数。
pub const CONTEXT: usize = 3;
/// 一次中间蛇搜索的编辑距离上限：整篇转录重写这样几乎全变的文本，不值得为最短 diff 付平方的代价。
const MAX_EDIT_COST: isize = 1024;

/// 一个文件在补丁里的一段改动。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hunk {
    pub old_start: usize,
    pub old_len: usize,
    pub new_start: usize,
    pub new_len: usize,
    /// 每行带标记：`' '` 上下文、`'-'` 只在旧文本、`'+'` 只在新文本。
    pub lines: Vec<(char, String)>,
}

/// 补丁里的一个文件：`None` 的一侧表示文件不存在（新建或删除）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FilePatch {
    pub path: String,
    pub old_exists: bool,
    pub new_exists: bool,
    pub hunks: Vec<Hunk>,
}

/// 补丁读不出来或者对不上。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PatchError(pub String);

fn lines(text: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    lines
}

fn join(lines: &[String]) -> String {
    let mut text = String::new();
    for line in lines {
        text.push_str(line);
        text.push('\n');
    }
    text
}

/// 两段文本的行级差异：`removed[i]` 表示旧文本第 i 行被删，`added[j]` 表示新文本第 j 行是新加的。其余行按顺序一一对应。
fn changed_lines<'a>(old: &[&'a str], new: &[&'a str]) -> (Vec<bool>, Vec<bool>) {
    let mut ids: HashMap<&'a str, u32> = HashMap::new();
    let mut intern = |line: &'a str| -> u32 {
        let next = ids.len() as u32;
        *ids.entry(line).or_insert(next)
    };
    let a: Vec<u32> = old.iter().map(|l| intern(l)).collect();
    let b: Vec<u32> = new.iter().map(|l| intern(l)).collect();
    let mut removed = vec![false; a.len()];
    let mut added = vec![false; b.len()];
    compare(&a, &b, 0, a.len(), 0, b.len(), &mut removed, &mut added);
    (removed, added)
}

#[allow(clippy::too_many_arguments)]
fn compare(a: &[u32], b: &[u32], mut x0: usize, mut x1: usize, mut y0: usize, mut y1: usize, removed: &mut [bool], added: &mut [bool]) {
    while x0 < x1 && y0 < y1 && a[x0] == b[y0] {
        x0 += 1;
        y0 += 1;
    }
    while x0 < x1 && y0 < y1 && a[x1 - 1] == b[y1 - 1] {
        x1 -= 1;
        y1 -= 1;
    }
    if x0 == x1 {
        added[y0..y1].iter_mut().for_each(|f| *f = true);
        return;
    }
    if y0 == y1 {
        removed[x0..x1].iter_mut().for_each(|f| *f = true);
        return;
    }
    match middle_snake(&a[x0..x1], &b[y0..y1]) {
        Some((x, y)) if (x, y) != (0, 0) && (x, y) != (x1 - x0, y1 - y0) => {
            compare(a, b, x0, x0 + x, y0, y0 + y, removed, added);
            compare(a, b, x0 + x, x1, y0 + y, y1, removed, added);
        }
        _ => {
            removed[x0..x1].iter_mut().for_each(|f| *f = true);
            added[y0..y1].iter_mut().for_each(|f| *f = true);
        }
    }
}

/// Myers 的中间蛇（双向搜索，线性空间），返回切分点。超过上限时返回 `None`。
fn middle_snake(a: &[u32], b: &[u32]) -> Option<(usize, usize)> {
    let (n, m) = (a.len() as isize, b.len() as isize);
    let max_d = ((n + m + 1) / 2).min(MAX_EDIT_COST);
    let offset = max_d;
    let size = (2 * max_d + 2) as usize;
    let mut v1 = vec![-1isize; size];
    let mut v2 = vec![-1isize; size];
    v1[(offset + 1) as usize] = 0;
    v2[(offset + 1) as usize] = 0;
    let delta = n - m;
    let front = delta % 2 != 0;
    let (mut k1start, mut k1end, mut k2start, mut k2end) = (0isize, 0isize, 0isize, 0isize);
    for d in 0..max_d {
        let mut k1 = -d + k1start;
        while k1 <= d - k1end {
            let i = (offset + k1) as usize;
            let mut x = if k1 == -d || (k1 != d && v1[i - 1] < v1[i + 1]) {
                v1[i + 1]
            } else {
                v1[i - 1] + 1
            };
            let mut y = x - k1;
            while x < n && y < m && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
            }
            v1[i] = x;
            if x > n {
                k1end += 2;
            } else if y > m {
                k1start += 2;
            } else if front {
                let j = offset + delta - k1;
                if j >= 0 && (j as usize) < size && v2[j as usize] != -1 && x >= n - v2[j as usize] {
                    return Some((x as usize, y as usize));
                }
            }
            k1 += 2;
        }
        let mut k2 = -d + k2start;
        while k2 <= d - k2end {
            let i = (offset + k2) as usize;
            let mut x = if k2 == -d || (k2 != d && v2[i - 1] < v2[i + 1]) {
                v2[i + 1]
            } else {
                v2[i - 1] + 1
            };
            let mut y = x - k2;
            while x < n && y < m && a[(n - x - 1) as usize] == b[(m - y - 1) as usize] {
                x += 1;
                y += 1;
            }
            v2[i] = x;
            if x > n {
                k2end += 2;
            } else if y > m {
                k2start += 2;
            } else if !front {
                let j = offset + delta - k2;
                if j >= 0 && (j as usize) < size && v1[j as usize] != -1 {
                    let x1 = v1[j as usize];
                    let y1 = offset + x1 - j;
                    if x1 >= n - x {
                        return Some((x1 as usize, y1 as usize));
                    }
                }
            }
            k2 += 2;
        }
    }
    None
}

/// 一个文件从 `old` 到 `new` 的改动；两边相同时为 `None`。`None` 的文本表示文件不存在。
pub fn diff_file(path: &str, old: Option<&str>, new: Option<&str>) -> Option<FilePatch> {
    if old == new {
        return None;
    }
    let a = lines(old.unwrap_or(""));
    let b = lines(new.unwrap_or(""));
    let (removed, added) = changed_lines(&a, &b);
    // 编辑脚本：(标记, 旧行号, 新行号)，行号从 0 起。
    let mut script: Vec<(char, usize, usize)> = Vec::with_capacity(a.len() + b.len());
    let (mut i, mut j) = (0, 0);
    while i < a.len() || j < b.len() {
        if i < a.len() && removed[i] {
            script.push(('-', i, j));
            i += 1;
        } else if j < b.len() && added[j] {
            script.push(('+', i, j));
            j += 1;
        } else {
            script.push((' ', i, j));
            i += 1;
            j += 1;
        }
    }
    let mut hunks = Vec::new();
    let mut at = 0;
    while at < script.len() {
        let Some(first) = script[at..].iter().position(|s| s.0 != ' ').map(|p| p + at) else {
            break;
        };
        let start = first.saturating_sub(CONTEXT);
        // 往后延伸：两处改动之间的相同行不超过两倍上下文时并进同一段。
        let mut end = first;
        let mut k = first;
        while k < script.len() {
            if script[k].0 != ' ' {
                end = k;
                k += 1;
                continue;
            }
            let run = script[k..].iter().take_while(|s| s.0 == ' ').count();
            if k + run < script.len() && run <= 2 * CONTEXT {
                k += run;
            } else {
                break;
            }
        }
        let stop = (end + 1 + CONTEXT).min(script.len());
        let (_, old_at, new_at) = script[start];
        let mut hunk = Hunk {
            old_start: old_at,
            old_len: 0,
            new_start: new_at,
            new_len: 0,
            lines: Vec::new(),
        };
        for &(tag, oi, nj) in &script[start..stop] {
            match tag {
                ' ' => {
                    hunk.old_len += 1;
                    hunk.new_len += 1;
                    hunk.lines.push((' ', a[oi].to_string()));
                }
                '-' => {
                    hunk.old_len += 1;
                    hunk.lines.push(('-', a[oi].to_string()));
                }
                _ => {
                    hunk.new_len += 1;
                    hunk.lines.push(('+', b[nj].to_string()));
                }
            }
        }
        // unified diff 的行号从 1 起；某一侧没有行时写它前面那一行的行号。
        if hunk.old_len > 0 {
            hunk.old_start += 1;
        }
        if hunk.new_len > 0 {
            hunk.new_start += 1;
        }
        hunks.push(hunk);
        at = stop;
    }
    Some(FilePatch {
        path: path.to_string(),
        old_exists: old.is_some(),
        new_exists: new.is_some(),
        hunks,
    })
}

fn range(start: usize, len: usize) -> String {
    if len == 1 { start.to_string() } else { format!("{start},{len}") }
}

/// 写成标准 unified diff 文本，路径加 `a/`、`b/` 前缀，不存在的一侧写 `/dev/null`。
pub fn format_patches(patches: &[FilePatch]) -> String {
    let mut out = String::new();
    for patch in patches {
        let old = if patch.old_exists {
            format!("a/{}", patch.path)
        } else {
            "/dev/null".into()
        };
        let new = if patch.new_exists {
            format!("b/{}", patch.path)
        } else {
            "/dev/null".into()
        };
        out.push_str(&format!("--- {old}\n+++ {new}\n"));
        for hunk in &patch.hunks {
            out.push_str(&format!(
                "@@ -{} +{} @@\n",
                range(hunk.old_start, hunk.old_len),
                range(hunk.new_start, hunk.new_len)
            ));
            for (tag, line) in &hunk.lines {
                out.push(*tag);
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    out
}

fn parse_range(text: &str) -> Result<(usize, usize), PatchError> {
    let bad = || PatchError(format!("bad hunk range {text}"));
    let (start, len) = match text.split_once(',') {
        Some((s, l)) => (s.parse().map_err(|_| bad())?, l.parse().map_err(|_| bad())?),
        None => (text.parse().map_err(|_| bad())?, 1),
    };
    Ok((start, len))
}

fn strip_side(text: &str, prefix: &str) -> Option<String> {
    if text == "/dev/null" {
        return None;
    }
    Some(text.strip_prefix(prefix).unwrap_or(text).to_string())
}

/// 读出 unified diff 文本（[`format_patches`] 的逆）。行数按 `@@` 头里的数取，内容以 `---` 开头的行不会被误认成文件头。
pub fn parse_patches(text: &str) -> Result<Vec<FilePatch>, PatchError> {
    let all = lines(text);
    let mut patches = Vec::new();
    let mut i = 0;
    while i < all.len() {
        let line = all[i];
        if line.is_empty() {
            i += 1;
            continue;
        }
        let old = line
            .strip_prefix("--- ")
            .ok_or_else(|| PatchError(format!("expected a file header at line {}", i + 1)))?;
        let new = all
            .get(i + 1)
            .and_then(|l| l.strip_prefix("+++ "))
            .ok_or_else(|| PatchError(format!("expected +++ at line {}", i + 2)))?;
        let old_path = strip_side(old, "a/");
        let new_path = strip_side(new, "b/");
        let path = new_path
            .clone()
            .or(old_path.clone())
            .ok_or_else(|| PatchError("both sides are /dev/null".into()))?;
        let mut patch = FilePatch {
            path,
            old_exists: old_path.is_some(),
            new_exists: new_path.is_some(),
            hunks: Vec::new(),
        };
        i += 2;
        while i < all.len() && all[i].starts_with("@@ ") {
            let header = all[i];
            let inner = header
                .strip_prefix("@@ -")
                .and_then(|h| h.split_once(" @@"))
                .map(|(h, _)| h)
                .ok_or_else(|| PatchError(format!("bad hunk header {header}")))?;
            let (old_range, new_range) = inner
                .split_once(" +")
                .ok_or_else(|| PatchError(format!("bad hunk header {header}")))?;
            let (old_start, old_len) = parse_range(old_range)?;
            let (new_start, new_len) = parse_range(new_range)?;
            let mut hunk = Hunk {
                old_start,
                old_len,
                new_start,
                new_len,
                lines: Vec::new(),
            };
            i += 1;
            let (mut seen_old, mut seen_new) = (0, 0);
            while seen_old < old_len || seen_new < new_len {
                let line = all.get(i).ok_or_else(|| PatchError("the patch ends inside a hunk".into()))?;
                let mut chars = line.chars();
                let tag = chars.next().unwrap_or(' ');
                let body = chars.as_str().to_string();
                match tag {
                    ' ' => {
                        seen_old += 1;
                        seen_new += 1;
                    }
                    '-' => seen_old += 1,
                    '+' => seen_new += 1,
                    _ => return Err(PatchError(format!("bad hunk line {}", i + 1))),
                }
                hunk.lines.push((tag, body));
                i += 1;
            }
            if seen_old != old_len || seen_new != new_len {
                return Err(PatchError(format!("hunk line counts do not match {header}")));
            }
            patch.hunks.push(hunk);
        }
        patches.push(patch);
    }
    Ok(patches)
}

/// 一侧在文本里的起点（从 0 起）：有行时是第一行，没有行时是插入点。
fn position(start: usize, len: usize) -> usize {
    if len > 0 { start - 1 } else { start }
}

/// 把一个文件的补丁应用到 `text` 上：`reverse` 为真时从新到旧。每一段都要求精确匹配（不做模糊匹配、不挪位置）。
pub fn apply_file(patch: &FilePatch, text: Option<&str>, reverse: bool) -> Result<Option<String>, PatchError> {
    let (from_exists, to_exists) = if reverse {
        (patch.new_exists, patch.old_exists)
    } else {
        (patch.old_exists, patch.new_exists)
    };
    if from_exists != text.is_some() {
        return Err(PatchError(format!("{} exists on one side only", patch.path)));
    }
    let source = lines(text.unwrap_or(""));
    let (from_tag, to_tag) = if reverse { ('+', '-') } else { ('-', '+') };
    let mut out: Vec<String> = Vec::with_capacity(source.len());
    let mut cursor = 0;
    for hunk in &patch.hunks {
        let (from_start, from_len, to_start, to_len) = if reverse {
            (hunk.new_start, hunk.new_len, hunk.old_start, hunk.old_len)
        } else {
            (hunk.old_start, hunk.old_len, hunk.new_start, hunk.new_len)
        };
        if from_len > 0 && from_start == 0 {
            return Err(PatchError(format!("bad hunk position in {}", patch.path)));
        }
        let at = position(from_start, from_len);
        if at < cursor || at + from_len > source.len() {
            return Err(PatchError(format!("hunk out of range in {}", patch.path)));
        }
        out.extend(source[cursor..at].iter().map(|l| l.to_string()));
        if position(to_start, to_len) != out.len() {
            return Err(PatchError(format!("hunk offset does not match in {}", patch.path)));
        }
        let expected = hunk
            .lines
            .iter()
            .filter(|(t, _)| *t == ' ' || *t == from_tag)
            .map(|(_, l)| l.as_str());
        if !expected.eq(source[at..at + from_len].iter().copied()) {
            return Err(PatchError(format!("hunk does not match in {}", patch.path)));
        }
        out.extend(hunk.lines.iter().filter(|(t, _)| *t == ' ' || *t == to_tag).map(|(_, l)| l.clone()));
        cursor = at + from_len;
    }
    out.extend(source[cursor..].iter().map(|l| l.to_string()));
    Ok(to_exists.then(|| join(&out)))
}

/// 一组文件（路径 → 文本）从 `old` 到 `new` 的补丁，按路径排序；`video.json` 排在最前。
pub fn diff_files(old: &BTreeMap<String, String>, new: &BTreeMap<String, String>) -> Vec<FilePatch> {
    let mut paths: Vec<&String> = old.keys().chain(new.keys()).collect();
    paths.sort_by(|a, b| (a.as_str() != "video.json", *a).cmp(&(b.as_str() != "video.json", *b)));
    paths.dedup();
    paths
        .into_iter()
        .filter_map(|path| diff_file(path, old.get(path).map(String::as_str), new.get(path).map(String::as_str)))
        .collect()
}

/// 把补丁应用到一组文件上；补丁没提到的文件不变。
pub fn apply_files(patches: &[FilePatch], files: &BTreeMap<String, String>, reverse: bool) -> Result<BTreeMap<String, String>, PatchError> {
    let mut out = files.clone();
    for patch in patches {
        match apply_file(patch, files.get(&patch.path).map(String::as_str), reverse)? {
            Some(text) => {
                out.insert(patch.path.clone(), text);
            }
            None => {
                out.remove(&patch.path);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(old: &str, new: &str) {
        let patch = diff_file("f", Some(old), Some(new));
        let Some(patch) = patch else {
            assert_eq!(old, new);
            return;
        };
        let text = format_patches(std::slice::from_ref(&patch));
        let parsed = parse_patches(&text).unwrap();
        assert_eq!(parsed, vec![patch.clone()], "{text}");
        assert_eq!(apply_file(&patch, Some(old), false).unwrap().as_deref(), Some(new), "{text}");
        assert_eq!(apply_file(&patch, Some(new), true).unwrap().as_deref(), Some(old), "{text}");
    }

    /// 一个确定的伪随机序列（xorshift），不依赖外部 crate。
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    fn random_text(rng: &mut Rng, lines: u64, alphabet: u64) -> String {
        (0..lines).map(|_| format!("line {}\n", rng.below(alphabet))).collect()
    }

    #[test]
    fn one_changed_line_is_one_hunk_with_context() {
        let old: String = (1..=20).map(|i| format!("{i}\n")).collect();
        let new = old.replace("10\n", "ten\n");
        let patch = diff_file("video.json", Some(&old), Some(&new)).unwrap();
        assert_eq!(
            format_patches(&[patch]),
            "--- a/video.json\n+++ b/video.json\n@@ -7,7 +7,7 @@\n 7\n 8\n 9\n-10\n+ten\n 11\n 12\n 13\n"
        );
    }

    #[test]
    fn identical_texts_have_no_patch() {
        assert!(diff_file("f", Some("a\n"), Some("a\n")).is_none());
    }

    #[test]
    fn new_and_deleted_files_use_dev_null() {
        let created = diff_file("documents/d.json", None, Some("{\n}\n")).unwrap();
        let text = format_patches(std::slice::from_ref(&created));
        assert_eq!(text, "--- /dev/null\n+++ b/documents/d.json\n@@ -0,0 +1,2 @@\n+{\n+}\n");
        assert_eq!(apply_file(&created, Some("{\n}\n"), true).unwrap(), None);
        assert_eq!(parse_patches(&text).unwrap(), vec![created]);
        let deleted = diff_file("documents/d.json", Some("{\n}\n"), None).unwrap();
        assert_eq!(apply_file(&deleted, None, true).unwrap().as_deref(), Some("{\n}\n"));
    }

    #[test]
    fn edge_cases_round_trip() {
        for (old, new) in [
            ("", "a\n"),
            ("a\n", ""),
            ("a\nb\nc\n", "c\nb\na\n"),
            ("x\n", "y\n"),
            ("a\na\na\n", "a\na\n"),
            ("--- a\n+++ b\n", "--- a\n@@ x\n+++ b\n"),
        ] {
            roundtrip(old, new);
        }
    }

    #[test]
    fn random_edits_round_trip() {
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        for case in 0..400 {
            let size = rng.below(60);
            let old = random_text(&mut rng, size, 1 + case % 8);
            let mut new_lines: Vec<String> = old.lines().map(str::to_string).collect();
            for _ in 0..rng.below(8) {
                let at = if new_lines.is_empty() {
                    0
                } else {
                    rng.below(new_lines.len() as u64) as usize
                };
                match rng.below(3) {
                    0 if !new_lines.is_empty() => {
                        new_lines.remove(at);
                    }
                    1 => new_lines.insert(at, format!("new {}", rng.below(5))),
                    _ if !new_lines.is_empty() => new_lines[at] = format!("changed {}", rng.below(5)),
                    _ => {}
                }
            }
            let new: String = new_lines.iter().map(|l| format!("{l}\n")).collect();
            roundtrip(&old, &new);
        }
    }

    #[test]
    fn a_large_rewrite_falls_back_to_delete_and_insert() {
        let mut rng = Rng(42);
        let old = random_text(&mut rng, 5000, 1_000_000);
        let new = random_text(&mut rng, 5000, 1_000_000);
        roundtrip(&old, &new);
    }

    #[test]
    fn a_mismatched_hunk_is_refused() {
        let patch = diff_file("f", Some("a\nb\nc\n"), Some("a\nB\nc\n")).unwrap();
        assert!(apply_file(&patch, Some("a\nX\nc\n"), true).is_err());
        assert!(apply_file(&patch, Some("z\na\nB\nc\n"), true).is_err(), "不挪位置找匹配");
        assert!(apply_file(&patch, None, true).is_err());
    }
}
