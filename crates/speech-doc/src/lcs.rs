//! 序列 LCS 匹配（对拍 voice-ink `SegmentLCS.lcsMatches`）。
//!
//! 公共前后缀先行剥离；中段 DP 受 cell 预算约束（超限返回 `None`，调用方
//! 走下一级降级）。`rows <= cap / columns` 的整数除法形式是 test-locked 的。
//!
//! 中段规模 ≤ [`FULL_TABLE_CELLS`] 时填完整长度表并回溯（历史路径，结果与
//! voice-ink 逐位一致）；更大的表改走线性空间的 Hirschberg 分治：内存 O(n+m)、
//! 时间约 2×n×m。两条路径给出的匹配数都等于 LCS 长度，只是同长时的具体
//! 配对可能不同——所以阈值以内刻意不换算法，避免既有页面的边界回贴发生
//! 漂移。
//!
//! 为什么要有第二条路径：中文一字一原子，一页 8000–10000 原子的表是
//! 6400 万–1 亿 cell，全表（u32）要 256–400 MB，旧上限 2500 万直接判
//! `None`；对 polish 这意味着**任何答案都过不了回贴**——逐字相同的零改动答案
//! 也一样（只要中段有一处差异，前后缀剥离就救不了）——引擎却把它当成模型
//! 答错重试 3 次后整页兜底。容量应当由算法兜住，而不是让分页器去猜。

/// 中段完整长度表的 cell 上限（u32 每 cell，即约 100 MB）。以内走全表回溯，
/// 以外走 Hirschberg。
pub const FULL_TABLE_CELLS: usize = 25_000_000;

/// 中段 DP 的总 cell 预算（时间上限）：超过返回 `None`。Hirschberg 内存与
/// 规模无关，这里只是防止病态输入（如模型把整页复读了十遍）把一次校验拖到
/// 分钟级：2.5 亿 cell ≈ 15.8k × 15.8k 原子，release 构建约 1–2 s。
pub const LCS_CELL_CAP: usize = 250_000_000;

/// 返回按序匹配对 `(indexA, indexB)`；表规模超过 `cell_cap` 时返回 `None`。
pub fn lcs_matches(a: &[u32], b: &[u32], cell_cap: usize) -> Option<Vec<(usize, usize)>> {
    let mut prefix = 0;
    while prefix < a.len() && prefix < b.len() && a[prefix] == b[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < a.len() - prefix
        && suffix < b.len() - prefix
        && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let mid_a = &a[prefix..a.len() - suffix];
    let mid_b = &b[prefix..b.len() - suffix];
    let rows = mid_a.len() + 1;
    let columns = mid_b.len() + 1;
    // 整数除法是刻意的（15→nil / 16→[] 的边界被 voice-ink 测试锁定）。
    if rows > cell_cap / columns {
        return None;
    }

    let mut matches: Vec<(usize, usize)> = (0..prefix).map(|i| (i, i)).collect();

    if !mid_a.is_empty() && !mid_b.is_empty() {
        if rows <= FULL_TABLE_CELLS / columns {
            full_table_matches(mid_a, mid_b, prefix, prefix, &mut matches);
        } else {
            hirschberg_matches(mid_a, mid_b, prefix, prefix, &mut matches);
        }
    }

    for k in (0..suffix).rev() {
        matches.push((a.len() - 1 - k, b.len() - 1 - k));
    }
    Some(matches)
}

/// 全表路径：反向填表（长度矩阵，u32 足够），正向回溯。
fn full_table_matches(
    a: &[u32],
    b: &[u32],
    offset_a: usize,
    offset_b: usize,
    matches: &mut Vec<(usize, usize)>,
) {
    let stride = b.len() + 1;
    let mut table = vec![0_u32; (a.len() + 1) * stride];
    for i in (0..a.len()).rev() {
        for j in (0..b.len()).rev() {
            table[i * stride + j] = if a[i] == b[j] {
                table[(i + 1) * stride + j + 1] + 1
            } else {
                table[(i + 1) * stride + j].max(table[i * stride + j + 1])
            };
        }
    }
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i] == b[j] {
            matches.push((offset_a + i, offset_b + j));
            i += 1;
            j += 1;
        } else if table[(i + 1) * stride + j] >= table[i * stride + j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
}

/// `row[j] = LCS(a, b[..j])`（正向长度行）。
fn lcs_row_forward(a: &[u32], b: &[u32]) -> Vec<u32> {
    let mut previous = vec![0_u32; b.len() + 1];
    let mut current = vec![0_u32; b.len() + 1];
    for &ca in a {
        current[0] = 0;
        for (j, &cb) in b.iter().enumerate() {
            current[j + 1] = if ca == cb {
                previous[j] + 1
            } else {
                previous[j + 1].max(current[j])
            };
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous
}

/// `row[j] = LCS(a, b[j..])`（反向长度行）。
fn lcs_row_backward(a: &[u32], b: &[u32]) -> Vec<u32> {
    let mut previous = vec![0_u32; b.len() + 1];
    let mut current = vec![0_u32; b.len() + 1];
    for &ca in a.iter().rev() {
        current[b.len()] = 0;
        for j in (0..b.len()).rev() {
            current[j] = if ca == b[j] {
                previous[j + 1] + 1
            } else {
                previous[j].max(current[j + 1])
            };
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous
}

/// Hirschberg 分治：按 `a` 的中线切开，用正/反两行长度找 `b` 的最优切点，
/// 递归到单元素时直接取首个相等位置。输出按序追加到 `matches`。
fn hirschberg_matches(
    a: &[u32],
    b: &[u32],
    offset_a: usize,
    offset_b: usize,
    matches: &mut Vec<(usize, usize)>,
) {
    if a.is_empty() || b.is_empty() {
        return;
    }
    if a.len() == 1 {
        if let Some(j) = b.iter().position(|&x| x == a[0]) {
            matches.push((offset_a, offset_b + j));
        }
        return;
    }
    if b.len() == 1 {
        if let Some(i) = a.iter().position(|&x| x == b[0]) {
            matches.push((offset_a + i, offset_b));
        }
        return;
    }
    let mid = a.len() / 2;
    let forward = lcs_row_forward(&a[..mid], b);
    let backward = lcs_row_backward(&a[mid..], b);
    let mut best = 0usize;
    let mut best_len = 0u32;
    for j in 0..=b.len() {
        let total = forward[j] + backward[j];
        if total > best_len {
            best_len = total;
            best = j;
        }
    }
    hirschberg_matches(&a[..mid], &b[..best], offset_a, offset_b, matches);
    hirschberg_matches(
        &a[mid..],
        &b[best..],
        offset_a + mid,
        offset_b + best,
        matches,
    );
}

/// 原子键 interner：把字符串键映射为紧凑整数，供 [`lcs_matches`] 使用。
#[derive(Default)]
pub struct AtomInterner {
    keys: std::collections::HashMap<String, u32>,
}

impl AtomInterner {
    pub fn intern(&mut self, key: &str) -> u32 {
        if let Some(&id) = self.keys.get(key) {
            return id;
        }
        let id = self.keys.len() as u32;
        self.keys.insert(key.to_owned(), id);
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cell_cap_boundary_is_integer_division() {
        // 3+1=4 行 × 4 列 = 16 cells:cap 15 → None,cap 16 → 空匹配
        assert_eq!(lcs_matches(&[1, 2, 3], &[4, 5, 6], 15), None);
        assert_eq!(lcs_matches(&[1, 2, 3], &[4, 5, 6], 16), Some(vec![]));
    }

    #[test]
    fn prefix_suffix_and_middle_are_all_matched() {
        let a = [1, 2, 9, 3, 4];
        let b = [1, 2, 8, 3, 4];
        let matches = lcs_matches(&a, &b, LCS_CELL_CAP).unwrap();
        assert_eq!(matches, vec![(0, 0), (1, 1), (3, 3), (4, 4)]);
    }

    #[test]
    fn near_identical_long_sequences_match_almost_fully() {
        let a: Vec<u32> = (0..4500).collect();
        let mut b = a.clone();
        b[1000] = 999_999;
        b[2000] = 999_998;
        b[3000] = 999_997;
        let matches = lcs_matches(&a, &b, LCS_CELL_CAP).unwrap();
        assert_eq!(matches.len(), 4497);
    }

    /// 全表与 Hirschberg 在同一输入上匹配数相同、匹配对都合法且严格递增。
    fn assert_valid_lcs(a: &[u32], b: &[u32], matches: &[(usize, usize)], expected_len: usize) {
        assert_eq!(matches.len(), expected_len);
        let mut last: Option<(usize, usize)> = None;
        for &(i, j) in matches {
            assert_eq!(a[i], b[j], "pair ({i},{j}) is not a match");
            if let Some((pi, pj)) = last {
                assert!(i > pi && j > pj, "pairs must be strictly increasing");
            }
            last = Some((i, j));
        }
    }

    #[test]
    fn hirschberg_agrees_with_full_table_on_random_like_inputs() {
        // 确定性伪随机（LCG），小字母表制造大量重复键。
        let mut seed = 0x2545_F491_u64;
        let mut next = || {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (seed >> 33) as u32 % 7
        };
        for round in 0..40 {
            let n = 1 + (round * 7) % 53;
            let m = 1 + (round * 11) % 47;
            let a: Vec<u32> = (0..n).map(|_| next()).collect();
            let b: Vec<u32> = (0..m).map(|_| next()).collect();
            let mut full = Vec::new();
            full_table_matches(&a, &b, 0, 0, &mut full);
            let mut hb = Vec::new();
            hirschberg_matches(&a, &b, 0, 0, &mut hb);
            assert_valid_lcs(&a, &b, &full, full.len());
            assert_valid_lcs(&a, &b, &hb, full.len());
        }
    }

    /// 报告场景：中文一页约 1 万原子、答案头尾各有一处差异（前后缀剥离救不了，
    /// 中段仍近整页）——旧上限下判 `None`（任何答案都无法回贴），现在必须
    /// 回贴成功且匹配数 = 长度 − 差异数。
    #[test]
    fn ten_thousand_atom_page_with_two_edits_is_matched_via_hirschberg() {
        let n = 10_111usize;
        let a: Vec<u32> = (0..n as u32).map(|x| x % 3000).collect();
        let mut b = a.clone();
        b[5] = 999_999;
        b[n - 6] = 999_998;
        assert!(
            (n - 10) * (n - 10) > FULL_TABLE_CELLS,
            "must exercise Hirschberg"
        );
        let matches = lcs_matches(&a, &b, LCS_CELL_CAP).unwrap();
        assert_valid_lcs(&a, &b, &matches, n - 2);
    }

    #[test]
    fn oversized_table_still_returns_none_at_the_time_cap() {
        let a: Vec<u32> = (0..20_000).collect();
        let mut b = a.clone();
        b[10] = 1;
        b[19_990] = 2;
        assert_eq!(lcs_matches(&a, &b, LCS_CELL_CAP), None);
    }

    #[test]
    fn interner_assigns_stable_dense_ids() {
        let mut interner = AtomInterner::default();
        let a = interner.intern("hello");
        let b = interner.intern("world");
        assert_eq!(interner.intern("hello"), a);
        assert_ne!(a, b);
    }
}
