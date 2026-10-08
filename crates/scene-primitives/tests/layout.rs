use scene_primitives::layout::{self, TextMeasure, TextMetricsLine};
use scene_primitives::resolve::{RNode, Rect};
use serde_json::{Map, Value, json};

#[derive(Default)]
struct FakeMeasure {
    calls: Vec<(String, String, f64, u16)>,
}

impl TextMeasure for FakeMeasure {
    fn measure(
        &mut self,
        text: &str,
        family: &str,
        font_size: f64,
        weight: u16,
    ) -> TextMetricsLine {
        self.calls
            .push((text.to_string(), family.to_string(), font_size, weight));
        TextMetricsLine {
            width: text.chars().count() as f64 * font_size / 2.0,
            ascent: font_size * 0.8,
            descent: font_size * 0.2,
        }
    }
}

fn object(value: Value) -> Map<String, Value> {
    value.as_object().expect("object").clone()
}

fn node(ntype: &str, style: Value) -> RNode {
    RNode {
        ntype: ntype.to_string(),
        style: object(style),
        ..Default::default()
    }
}

#[test]
fn prepare_text_reads_typography_colors_and_transforms() {
    let mut text = node(
        "text",
        json!({
            "fontSize": 20,
            "fontWeight": 650,
            "font": "Inter",
            "color": "#112233",
            "background": "rgba(10,20,30,0.5)",
            "borderRadius": 8,
            "scale": 1.5,
            "scaleX": 2,
            "scaleY": 0.75,
            "rotation": 12,
            "opacity": 0.4,
            "anchor": "bottom"
        }),
    );
    text.text = Some("Rust".into());
    let mut measure = FakeMeasure::default();

    layout::prepare(&mut text, &mut measure);

    assert_eq!(
        measure.calls,
        vec![("Rust".into(), "Inter".into(), 20.0, 650)]
    );
    assert_eq!(
        (text.text_w, text.text_asc, text.text_desc),
        (40.0, 16.0, 4.0)
    );
    assert_eq!(
        (text.text_color.r, text.text_color.g, text.text_color.b),
        (17.0, 34.0, 51.0)
    );
    let bg = text.bg_color.expect("background");
    assert_eq!((bg.r, bg.g, bg.b, bg.a), (10.0, 20.0, 30.0, 0.5));
    assert_eq!(
        (
            text.border_radius,
            text.base_scale,
            text.base_scale_x,
            text.base_scale_y,
            text.base_rotation,
            text.base_opacity,
            text.anchor.as_str(),
        ),
        (8.0, 1.5, Some(2.0), Some(0.75), 12.0, 0.4, "bottom")
    );
}

#[test]
fn prepare_svg_scales_paths_and_computes_length() {
    let mut svg = node("svg", json!({ "width": 200, "height": 100 }));
    svg.view_box = Some([0.0, 0.0, 100.0, 50.0]);
    svg.children.push(RNode {
        ntype: "path".into(),
        path_d: Some("M0 0 L100 0 L100 50".into()),
        ..Default::default()
    });

    layout::prepare(&mut svg, &mut FakeMeasure::default());

    let path = &svg.children[0];
    assert_eq!(path.svg_scale, 2.0);
    assert_eq!(
        path.subpaths,
        vec![vec![(0.0, 0.0), (200.0, 0.0), (200.0, 100.0)]]
    );
    assert!((path.total_len - 300.0).abs() < 1e-9);
}

/// viewBox 的 `(minX, minY)` 落在 svg 盒的左上角（§6.2.1，与浏览器预览的
/// `<svg viewBox>` 同义）。原点居中的 viewBox 以前被当成 `0 0 w h`，内容整体
/// 偏出盒子，旋转（绕盒中心）后偏得更明显。
#[test]
fn prepare_svg_maps_view_box_origin_to_the_box_corner() {
    let mut svg = node("svg", json!({ "width": 240, "height": 180 }));
    svg.view_box = Some([-120.0, -90.0, 240.0, 180.0]);
    svg.children.push(RNode {
        ntype: "path".into(),
        path_d: Some("M-120 -90 L120 -90 L0 0".into()),
        morph_d: vec!["M-60 -45 L60 -45 L0 0".into()],
        ..Default::default()
    });

    layout::prepare(&mut svg, &mut FakeMeasure::default());

    let path = &svg.children[0];
    assert_eq!(path.svg_scale, 1.0);
    assert_eq!(
        path.subpaths,
        vec![vec![(0.0, 0.0), (240.0, 0.0), (120.0, 90.0)]]
    );
    assert_eq!(
        path.morph_shapes,
        vec![vec![vec![(60.0, 45.0), (180.0, 45.0), (120.0, 90.0)]]]
    );
}

#[test]
fn intrinsic_preserves_media_aspect_ratio_and_explicit_dimensions() {
    let mut image = node("image", json!({ "width": 100 }));
    image.nat_w = 400.0;
    image.nat_h = 200.0;
    assert_eq!(layout::intrinsic(&mut image), (100.0, 50.0));

    let mut video = node("video", json!({ "height": 90 }));
    video.nat_w = 1920.0;
    video.nat_h = 1080.0;
    assert_eq!(layout::intrinsic(&mut video), (160.0, 90.0));

    let mut missing_meta = node("image", json!({ "width": 100 }));
    assert_eq!(layout::intrinsic(&mut missing_meta), (100.0, 0.0));

    let mut svg = node("svg", json!({ "width": 30, "height": 40 }));
    assert_eq!(layout::intrinsic(&mut svg), (30.0, 40.0));
}

#[test]
fn intrinsic_flow_uses_gap_and_ignores_absolute_children() {
    let mut row = node("box", json!({ "layout": "row", "gap": 5 }));
    row.children = vec![
        node("box", json!({ "width": 10, "height": 20 })),
        node("box", json!({ "width": 20, "height": 12 })),
        node("box", json!({ "x": 0, "width": 999, "height": 999 })),
    ];
    assert_eq!(layout::intrinsic(&mut row), (35.0, 20.0));
    assert_eq!(row.intrinsic_cache, Some((35.0, 20.0)));

    let mut column = node("box", json!({ "layout": "column", "gap": 3 }));
    column.children = vec![
        node("box", json!({ "width": 10, "height": 20 })),
        node("box", json!({ "width": 30, "height": 12 })),
    ];
    assert_eq!(layout::intrinsic(&mut column), (30.0, 35.0));

    let mut stack = node("box", json!({}));
    stack.children = vec![
        node("box", json!({ "width": 10, "height": 20 })),
        node("box", json!({ "width": 30, "height": 12 })),
    ];
    assert_eq!(layout::intrinsic(&mut stack), (30.0, 20.0));
}

#[test]
fn place_positions_row_flow_and_absolute_children() {
    let mut root = node(
        "box",
        json!({ "layout": "row", "gap": 10, "align": "end", "justify": "center" }),
    );
    root.frame = Rect {
        x: 0.0,
        y: 0.0,
        w: 100.0,
        h: 60.0,
    };
    root.children = vec![
        node("box", json!({ "width": 20, "height": 10 })),
        node("box", json!({ "width": 10, "height": 20 })),
        node("box", json!({ "x": 7, "y": 8, "width": 5, "height": 6 })),
    ];

    layout::place(&mut root);

    assert_eq!(
        (
            root.children[0].frame.x,
            root.children[0].frame.y,
            root.children[0].frame.w,
            root.children[0].frame.h
        ),
        (30.0, 50.0, 20.0, 10.0)
    );
    assert_eq!(
        (
            root.children[1].frame.x,
            root.children[1].frame.y,
            root.children[1].frame.w,
            root.children[1].frame.h
        ),
        (60.0, 40.0, 10.0, 20.0)
    );
    assert_eq!(
        (
            root.children[2].frame.x,
            root.children[2].frame.y,
            root.children[2].frame.w,
            root.children[2].frame.h
        ),
        (7.0, 8.0, 5.0, 6.0)
    );
}

#[test]
fn place_honors_wrap_layout_precedence_and_column_alignment() {
    let mut root = node(
        "box",
        json!({ "layout": "row", "align": "end", "justify": "start" }),
    );
    root.wrap_layout = Some(object(json!({ "mode": "column", "gap": 5 })));
    root.frame = Rect {
        x: 0.0,
        y: 0.0,
        w: 50.0,
        h: 100.0,
    };
    root.children = vec![
        node("box", json!({ "width": 10, "height": 20 })),
        node("box", json!({ "width": 20, "height": 10 })),
    ];
    root.style.insert("justify".into(), json!("end"));
    root.style.insert("align".into(), json!("start"));

    assert_eq!(layout::layout_mode(&root).as_deref(), Some("column"));
    layout::place(&mut root);

    assert_eq!(
        (root.children[0].frame.x, root.children[0].frame.y),
        (0.0, 65.0)
    );
    assert_eq!(
        (root.children[1].frame.x, root.children[1].frame.y),
        (0.0, 90.0)
    );
}

// ── grid / flex（§6.3 扩展） ──

#[test]
fn grid_intrinsic_uses_equal_columns_and_row_heights() {
    let mut grid = node("box", json!({ "layout": "grid", "columns": 2, "gap": 4 }));
    grid.children = vec![
        node("box", json!({ "width": 10, "height": 20 })),
        node("box", json!({ "width": 30, "height": 12 })),
        node("box", json!({ "width": 8, "height": 6 })),
    ];
    // 列宽 = 最宽子节点 30；宽 = 2*30 + 4；高 = max(20,12) + 4 + 6
    assert_eq!(layout::intrinsic(&mut grid), (64.0, 30.0));
    assert_eq!(layout::layout_mode(&grid).as_deref(), Some("grid"));

    // columns 缺省/非法 → 单列
    let mut one = node("box", json!({ "layout": "grid", "gap": 2 }));
    one.children = vec![
        node("box", json!({ "width": 10, "height": 5 })),
        node("box", json!({ "width": 20, "height": 7 })),
    ];
    assert_eq!(layout::intrinsic(&mut one), (20.0, 14.0));
}

#[test]
fn place_grid_wraps_by_columns_and_honors_gap() {
    let mut grid = node(
        "box",
        json!({ "layout": "grid", "columns": 2, "gap": 10, "justify": "center", "align": "start" }),
    );
    grid.frame = Rect {
        x: 0.0,
        y: 0.0,
        w: 110.0,
        h: 100.0,
    };
    grid.children = vec![
        node("box", json!({ "width": 20, "height": 30 })),
        node("box", json!({ "width": 40, "height": 10 })),
        node("box", json!({ "width": 50, "height": 8 })),
    ];

    layout::place(&mut grid);

    // 列宽 = (110 - 10) / 2 = 50
    let f = |i: usize| {
        let r = grid.children[i].frame;
        (r.x, r.y, r.w, r.h)
    };
    assert_eq!(f(0), (15.0, 0.0, 20.0, 30.0)); // 第 0 列居中：(50-20)/2
    assert_eq!(f(1), (65.0, 0.0, 40.0, 10.0)); // 第 1 列：60 + (50-40)/2
    assert_eq!(f(2), (0.0, 40.0, 50.0, 8.0)); // 换行：行高 30 + gap 10
}

#[test]
fn flex_children_share_remaining_main_axis_space() {
    let mut row = node("box", json!({ "layout": "row", "gap": 10 }));
    row.frame = Rect {
        x: 0.0,
        y: 0.0,
        w: 200.0,
        h: 50.0,
    };
    row.children = vec![
        node("box", json!({ "width": 20, "height": 10 })),
        node("box", json!({ "flex": 1, "height": 10 })), // Spacer：无固有宽
        node("box", json!({ "width": 30, "height": 10 })),
    ];

    layout::place(&mut row);

    // 主轴已占 20 + 30 + 2*10 = 70，余 130 全给 flex:1
    assert_eq!(row.children[0].frame.x, 0.0);
    assert_eq!(
        (row.children[1].frame.x, row.children[1].frame.w),
        (30.0, 130.0)
    );
    assert_eq!(row.children[2].frame.x, 170.0);

    // 权重按比例分配；无 flex 时行为不变
    let mut row2 = node("box", json!({ "layout": "column" }));
    row2.frame = Rect {
        x: 0.0,
        y: 0.0,
        w: 50.0,
        h: 100.0,
    };
    row2.children = vec![
        node("box", json!({ "width": 10, "height": 10, "flex": 1 })),
        node("box", json!({ "width": 10, "height": 10, "flex": 3 })),
    ];
    layout::place(&mut row2);
    assert_eq!(
        (row2.children[0].frame.y, row2.children[0].frame.h),
        (0.0, 30.0)
    );
    assert_eq!(
        (row2.children[1].frame.y, row2.children[1].frame.h),
        (30.0, 70.0)
    );
}

#[test]
fn layout_tree_uses_canvas_for_an_empty_root() {
    let mut root = RNode::default();
    let mut measure = FakeMeasure::default();

    layout::layout_tree(&mut root, 640.0, 360.0, &mut measure);

    assert_eq!(
        (root.frame.x, root.frame.y, root.frame.w, root.frame.h),
        (0.0, 0.0, 640.0, 360.0)
    );
}
