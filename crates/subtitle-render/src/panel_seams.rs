//! 分屏段的接缝（视频格式规范 §5.6「Studio 样式在分屏段的摆放」）：字幕计划只拿它决定一句挂不挂到接缝、挂哪条。
//!
//! 时间都在字幕文档自己的时钟上：序列时钟就是序列秒；源素材时钟由调用方按作用实例的时间映射换回源秒。
//! 一句按它自己的开始（不含 `leadIn`）定，那一刻被剪掉时取它之后第一次显示的地方，定了到这一句结束都不变。

/// 一段分屏画面：`[start, end)` 与这段格子之间的横向接缝（画布高的百分比，升序）。
#[derive(Clone, Debug, PartialEq)]
pub struct SeamWindow {
    pub start: f64,
    pub end: f64,
    pub seams: Vec<f64>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PanelSeams {
    /// 字幕显示得出来的区间（按开始排好、互不重叠）；`None` 表示处处都显示（序列时钟）。
    pub shown: Option<Vec<(f64, f64)>>,
    /// 画面分屏的几段，按开始排好。
    pub windows: Vec<SeamWindow>,
}

const EPSILON: f64 = 1e-6;

impl PanelSeams {
    /// 整理调用方给的区间：排序、合并重叠的显示区间，丢掉空的段。
    pub fn new(shown: Option<Vec<(f64, f64)>>, windows: Vec<SeamWindow>) -> Self {
        let shown = shown.map(|mut ranges| {
            ranges.retain(|(a, b)| a.is_finite() && b.is_finite() && b > a);
            ranges.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut merged: Vec<(f64, f64)> = Vec::with_capacity(ranges.len());
            for (a, b) in ranges {
                match merged.last_mut() {
                    Some(last) if a <= last.1 + EPSILON => last.1 = last.1.max(b),
                    _ => merged.push((a, b)),
                }
            }
            merged
        });
        let mut windows: Vec<SeamWindow> = windows
            .into_iter()
            .filter(|w| {
                w.start.is_finite() && w.end.is_finite() && w.end > w.start && !w.seams.is_empty()
            })
            .collect();
        windows.sort_by(|a, b| a.start.total_cmp(&b.start));
        Self { shown, windows }
    }

    /// 没有一段分屏：哪一句都不用挪。
    pub fn is_empty(&self) -> bool {
        self.windows.is_empty()
    }

    /// 一句 `[start, end)` 第一次显示的时刻：它的开始，被剪掉时是之后第一个显示得出来的时刻；一刻都不显示时 `None`。
    pub fn first_shown(&self, start: f64, end: f64) -> Option<f64> {
        let Some(shown) = &self.shown else {
            return Some(start);
        };
        let index = shown.partition_point(|(_, b)| *b <= start + EPSILON);
        let (a, _) = *shown.get(index)?;
        let at = a.max(start);
        (at < end - EPSILON || at <= start).then_some(at)
    }

    /// 这一刻画面上的横向接缝（没分屏时空）。
    pub fn seams_at(&self, at: f64) -> &[f64] {
        self.windows
            .iter()
            .rev()
            .find(|w| w.start <= at + EPSILON && at < w.end - EPSILON)
            .map_or(&[], |w| w.seams.as_slice())
    }

    /// 一句 `[start, end)` 挂到哪条接缝：开始的那一刻分屏时取离 `y`（字幕样式的锚线，画布高的百分比）最近的一条。
    pub fn seam_for(&self, start: f64, end: f64, y: f64) -> Option<f64> {
        if self.is_empty() {
            return None;
        }
        let at = self.first_shown(start, end)?;
        self.seams_at(at)
            .iter()
            .copied()
            .min_by(|a, b| (a - y).abs().total_cmp(&(b - y).abs()))
    }
}

/// 格子（画布百分比的 `[x, y, w, h]`）之间的横向接缝：一格的下边与另一格的上边相接、或隔着不到画布高 10% 的缝，两格横向
/// 有重叠的地方；隔着缝（格子间距）时取缝的中线，取三位小数。
pub fn horizontal_seams(rects: &[[f64; 4]]) -> Vec<f64> {
    const TOUCH: f64 = 0.05;
    const GAP_MAX: f64 = 10.0;
    let mut seams: Vec<f64> = Vec::new();
    for upper in rects {
        let edge = upper[1] + upper[3];
        if edge <= TOUCH || edge >= 100.0 - TOUCH {
            continue;
        }
        let below = rects
            .iter()
            .filter(|lower| {
                lower[1] - edge >= -TOUCH
                    && lower[1] - edge <= GAP_MAX
                    && lower[0] < upper[0] + upper[2] - TOUCH
                    && upper[0] < lower[0] + lower[2] - TOUCH
            })
            .map(|lower| lower[1])
            .min_by(f64::total_cmp);
        let Some(below) = below else { continue };
        let seam = ((edge + below.max(edge)) / 2.0 * 1000.0).round() / 1000.0;
        if !seams.iter().any(|s| (s - seam).abs() <= TOUCH) {
            seams.push(seam);
        }
    }
    seams.sort_by(f64::total_cmp);
    seams
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(start: f64, end: f64, seams: &[f64]) -> SeamWindow {
        SeamWindow {
            start,
            end,
            seams: seams.to_vec(),
        }
    }

    #[test]
    fn seams_are_where_one_cell_ends_and_the_next_begins() {
        let rows2 = [[0.0, 0.0, 100.0, 50.0], [0.0, 50.0, 100.0, 50.0]];
        assert_eq!(horizontal_seams(&rows2), vec![50.0]);
        let rows3 = [
            [0.0, 0.0, 100.0, 33.333],
            [0.0, 33.333, 100.0, 33.334],
            [0.0, 66.667, 100.0, 33.333],
        ];
        assert_eq!(horizontal_seams(&rows3), vec![33.333, 66.667]);
        let grid = [
            [0.0, 0.0, 50.0, 50.0],
            [50.0, 0.0, 50.0, 50.0],
            [0.0, 50.0, 50.0, 50.0],
            [50.0, 50.0, 50.0, 50.0],
        ];
        assert_eq!(horizontal_seams(&grid), vec![50.0]);
        // 左右并排的两格没有横向接缝
        assert!(horizontal_seams(&[[0.0, 0.0, 50.0, 100.0], [50.0, 0.0, 50.0, 100.0]]).is_empty());
    }

    #[test]
    fn seams_between_spaced_cells_sit_on_the_gap_midline() {
        // 9:16 上三行留 2 的间距（横缝高 1.125%）
        let rows3 = [
            [0.0, 0.0, 100.0, 32.583],
            [0.0, 33.708, 100.0, 32.584],
            [0.0, 67.417, 100.0, 32.583],
        ];
        assert_eq!(horizontal_seams(&rows3), vec![33.146, 66.855]);
        // 上一下二留 2：上格与下面两格之间一条缝，左右两格之间的竖缝不算
        let spotlight = [
            [0.0, 0.0, 100.0, 49.437],
            [0.0, 50.563, 49.0, 49.437],
            [51.0, 50.563, 49.0, 49.437],
        ];
        assert_eq!(horizontal_seams(&spotlight), vec![50.0]);
        // 隔得太远（画布高的 20%）不是接缝
        assert!(horizontal_seams(&[[0.0, 0.0, 100.0, 40.0], [0.0, 60.0, 100.0, 40.0]]).is_empty());
    }

    #[test]
    fn a_cue_is_decided_by_its_own_start() {
        let seams = PanelSeams::new(None, vec![window(10.0, 20.0, &[50.0])]);
        assert_eq!(seams.seam_for(10.0, 12.0, 86.0), Some(50.0));
        // 开始在一人段、延续进分屏段的一句不挂
        assert_eq!(seams.seam_for(9.0, 12.0, 86.0), None);
        // 开始在分屏段、延续到一人段的一句挂着
        assert_eq!(seams.seam_for(19.0, 22.0, 86.0), Some(50.0));
        assert_eq!(seams.seam_for(20.0, 22.0, 86.0), None);
    }

    #[test]
    fn three_rows_take_the_seam_nearest_the_style() {
        let seams = PanelSeams::new(None, vec![window(0.0, 10.0, &[33.333, 66.667])]);
        assert_eq!(seams.seam_for(1.0, 2.0, 86.0), Some(66.667));
        assert_eq!(seams.seam_for(1.0, 2.0, 12.0), Some(33.333));
    }

    #[test]
    fn a_cut_start_falls_to_the_first_shown_moment() {
        // 源素材时钟：句子开始的 4.5 被剪掉了，5 起才显示，5 起是分屏
        let seams = PanelSeams::new(
            Some(vec![(5.0, 8.0), (0.0, 4.0)]),
            vec![window(5.0, 8.0, &[50.0])],
        );
        assert_eq!(seams.first_shown(4.5, 6.0), Some(5.0));
        assert_eq!(seams.seam_for(4.5, 6.0, 86.0), Some(50.0));
        assert_eq!(seams.seam_for(3.0, 6.0, 86.0), None);
        // 整句都被剪掉
        assert_eq!(seams.first_shown(4.2, 4.8), None);
    }
}
