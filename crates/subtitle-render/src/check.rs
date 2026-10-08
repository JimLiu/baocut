//! 检查报告里依赖时间线 schema 的纯判定。
//!
//! 移植自 BaoCut v2 `bcut-engine` 的 `flows/check.rs`：`place_out_of_canvas` 与它的测试原样带来，
//! 只把私有函数提成 `pub`。同一文件里读写工程目录的 `check_verdict` / `run_check` 不移植；
//! `speech-doc` 的 `check` 只依赖转录文档，不认识时间线 schema，所以这一条放在这里。

/// `place` 越出画布（`element-rect-out-of-canvas`）：盒子一侧越出画布，或中心 y 不在画内。
///
/// 视频 / 图片放大到左右都越出、盖满整幅宽不算：那是「放大、拖动取景」的裁切
/// （`bcut shorts cut --focus-x` 写的就是这种盒），播客切片验收里被当成放歪报了出来。
pub fn place_out_of_canvas(
    kind: timeline::schema::ElementKind,
    place: &timeline::schema::Place,
) -> bool {
    use timeline::schema::ElementKind;
    let x = place.x.unwrap_or(50.0);
    let y = place.y.unwrap_or(50.0);
    let width = place.w.unwrap_or(0.0) * place.scale.unwrap_or(1.0).abs();
    let (left, right) = (x - width / 2.0, x + width / 2.0);
    let zoom_crop =
        matches!(kind, ElementKind::Video | ElementKind::Image) && left <= 0.0 && right >= 100.0;
    (!zoom_crop && (left < 0.0 || right > 100.0)) || !(0.0..=100.0).contains(&y)
}

#[cfg(test)]
mod place_tests {
    use super::place_out_of_canvas;
    use timeline::schema::{ElementKind, Place};

    fn place(x: f64, w: f64) -> Place {
        Place {
            x: Some(x),
            y: Some(50.0),
            w: Some(w),
            ..Place::default()
        }
    }

    /// 播客切片验收：`shorts cut --focus-x 0.6` 的主视频盒（x -32.26、w 316.37）左右都越出、
    /// 盖满画布，是取景裁切，不报；只越出一侧的照报。
    #[test]
    fn a_zoom_crop_that_covers_the_canvas_is_not_out_of_canvas() {
        assert!(!place_out_of_canvas(
            ElementKind::Video,
            &place(-32.26, 316.37)
        ));
        assert!(!place_out_of_canvas(
            ElementKind::Image,
            &place(50.0, 180.0)
        ));
        assert!(place_out_of_canvas(ElementKind::Video, &place(90.0, 40.0)));
        // 文字盒没有「取景」这回事，越出就报。
        assert!(place_out_of_canvas(ElementKind::Text, &place(50.0, 180.0)));
        assert!(!place_out_of_canvas(ElementKind::Text, &place(50.0, 60.0)));
    }
}
