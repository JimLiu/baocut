//! `core/crates/bcut-editor-core/src/shape_paths.rs` 与
//! `designs/baocut/app/model-shape-paths.js` 的生成器——20 份 `outline`
//! 形状配方的**归一化几何表**（设计 §13 P7a 留言①，P7b-client 落地）。
//!
//! 为什么是 codegen 而不是夹具：`gen_element_catalogue.rs` 发的是**契约夹具**
//! （测试期读、逐行对拍），因为那张表的消费者是属性面板，面板只需要"这是哪一
//! 类几何"。几何**点列**不一样——它是**运行期渲染数据**，产品代码要在画每一帧
//! 时读到它。原型侧是 `file://` 打开的 `<script>` 清单，fetch 一份 JSON 会被
//! CORS 挡掉。所以是生成的源文件，不是一份共享 JSON——**同一个生成器、同一次
//! 写盘**，两端不可能各自漂移。
//!
//! App v2（`apps/baocut`）经 `bcut-editor-core` 消费这张表（M4 B0）。它**画每一
//! 帧**走的是内核（`bcut-timeline-render` 的 `outline_path`），并不需要这张表；
//! 需要它的是 B3 的形状选择器——那 24 个缩略图是 GPUI 自己描的路径，与原型的
//! canvas 2D 同一处境。所以生成物落在纯层（不认识 gpui），由 `ui/` 侧按
//! `x = box.x + box.w * px` 描进 GPUI 的 `Path`。
//!
//! `designs/baocut` 是第二个消费者（第 60.2 轮）。它此前有**自己一份手描几何**
//! （第 39 轮照截图描的 24 条 `d=`），于是同一个 id 在原型上与在核心
//! 上画出来的是两个东西。第二份生成物就是来终结那份孪生的：它发的不是
//! 0..1 点列而是一条 **0..100 视框里的 `d=`**，因为原型画形状靠 `<svg viewBox>`
//! 缩放，不像另一端那样由消费者自己映射每个点。
//!
//! 段表的表达一致到字段名：`{verb, pts}`，verb 用 manifest 的拼写
//! （`move` / `line` / `quad` / `cubic` / `close`），点是**元素盒 0..1 归一化**
//! 坐标（左上原点），与 `motion::preset_registry::PathSegment`、
//! `bcut-timeline-render` 的 `outline_path` 同一口径。消费者（GPUI 的 `Path`、
//! 原型的 canvas 2D 描点）只做 `x = box.x + box.w * px` 的线性映射。
//!
//! 跑法（`#[ignore]`，日常 `cargo test` 不写盘）：
//!
//! ```sh
//! # 写盘（两端）
//! cargo test -p bcut-motion --test gen_element_shape_paths -- --ignored
//! # 门禁：只比对，不写盘
//! cargo test -p bcut-motion --test gen_element_shape_paths
//! ```
//!
//! **只发 `outline`**。`rect` / `ellipse` / `segment` 三类的几何是**参数化**的
//! （盒子本身、内切椭圆、`ShapeProps` 的两个端点），两端早就各自画得出来，把它们
//! 也铺成点列只会让 4 份配方多一条没人读的表。

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use motion::preset_registry::{CatalogueRecipe, PathSegment, ShapePath, timeline_shapes};

/// P7a 冻结：24 份形状配方里恰好 20 份是 `outline`。生成器不替谁做决定——
/// 新增一份 outline 配方要么改这里，要么就是漏了一次同步。
const FROZEN_OUTLINES: usize = 20;

const RUST_OUTPUT: &str = "../bcut-editor-core/src/shape_paths.rs";
const DESIGNS_OUTPUT: &str = "../../../designs/baocut/app/model-shape-paths.js";

fn output_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}

// ── double 发射 ──────────────────────────────────────────────────────

/// 最短往返十进制，并当场验证它 parse 回来逐位相同（同 `gen_anim_presets.rs`）。
/// Rust 与 JS 的数值字面量语法在这个子集上重合，所以一个函数发两边。
fn double(value: f64) -> String {
    assert!(value.is_finite(), "配方里出现了非有限数 {value}");
    assert!(
        (-0.5..=1.5).contains(&value),
        "归一化轮廓的点应当在 0..1 附近，出现了 {value}"
    );
    let text = format!("{value:?}");
    let round_trip: f64 = text.parse().expect("emitted double must parse");
    assert_eq!(
        round_trip.to_bits(),
        value.to_bits(),
        "{text} 不是 {value} 的往返表示"
    );
    text
}

// ── 段表 ────────────────────────────────────────────────────────────

/// 一段的 verb 名与**展平**的坐标（`[x, y]` / `[cx, cy, x, y]` / …）。
/// 展平是刻意的：两端的消费者都是 `ctx.bezierCurveTo(...pts)` 这种位置参数调用，
/// 嵌套一层点对只会让每个调用点多一次解包。
fn flatten(segment: &PathSegment) -> (&'static str, Vec<f64>) {
    match segment {
        PathSegment::Move(p) => ("move", vec![p[0], p[1]]),
        PathSegment::Line(p) => ("line", vec![p[0], p[1]]),
        PathSegment::Quad(c, p) => ("quad", vec![c[0], c[1], p[0], p[1]]),
        PathSegment::Cubic(a, b, p) => ("cubic", vec![a[0], a[1], b[0], b[1], p[0], p[1]]),
        PathSegment::Close => ("close", Vec::new()),
    }
}

/// 目录顺序 = manifest 的 `order`（面板下拉的顺序），同 order 再按 id 兜底，
/// 与 `gen_element_catalogue.rs` 同一条排序，生成物的行序因此与夹具一致。
fn outline_rows() -> Vec<(&'static str, &'static [PathSegment])> {
    let mut rows: Vec<&CatalogueRecipe> = timeline_shapes()
        .iter()
        .filter(|recipe| {
            matches!(
                recipe.shape().map(|body| &body.path),
                Some(ShapePath::Outline { .. })
            )
        })
        .collect();
    rows.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
    assert_eq!(
        rows.len(),
        FROZEN_OUTLINES,
        "outline 配方份数变了——同步 FROZEN_OUTLINES 与两端的目录测试"
    );
    rows.into_iter()
        .map(|recipe| {
            let ShapePath::Outline { segments } = &recipe.shape().expect("shape body").path else {
                unreachable!("上面已经筛过 outline")
            };
            (recipe.id.as_str(), segments.as_slice())
        })
        .collect()
}

// ── Rust（App v2） ──────────────────────────────────────────────────

fn rust_rows() -> String {
    let mut out = String::new();
    for (id, segments) in outline_rows() {
        let _ = writeln!(out, "    (\"{id}\", &[");
        for segment in segments {
            let (verb, pts) = flatten(segment);
            let numbers: Vec<String> = pts.into_iter().map(double).collect();
            let _ = writeln!(
                out,
                "        ShapePathSeg {{ verb: \"{verb}\", pts: &[{}] }},",
                numbers.join(", ")
            );
        }
        let _ = writeln!(out, "    ]),");
    }
    out
}

fn rust_ids() -> String {
    let quoted: Vec<String> = outline_rows()
        .into_iter()
        .map(|(id, _)| format!("\"{id}\""))
        .collect();
    let mut out = String::new();
    for (index, item) in quoted.iter().enumerate() {
        if index > 0 {
            if index % 5 == 0 {
                out.push_str(",\n    ");
            } else {
                out.push_str(", ");
            }
        }
        out.push_str(item);
    }
    out
}

fn render_rust() -> String {
    format!(
        r##"// @generated by core/crates/bcut-motion/tests/gen_element_shape_paths.rs — DO NOT EDIT.
// Regenerate with `cargo test -p bcut-motion --test gen_element_shape_paths --
// --ignored` after changing a manifest under `core/presets/builtin/shape/`. The
// same run rewrites the other twin: `designs/baocut/app/model-shape-paths.js`.
//! 形状目录里 **`outline` 类**的归一化几何表（设计 §7 / §13 P7b-client）。
//!
//! 目录的参数化三类（`rect` / `ellipse` / `segment`）由各自的参数画出，不在这
//! 张表里；{count} 份 `outline` 配方是显式点列，就是这里。点是**元素盒 0..1
//! 归一化**坐标（左上原点），与 `bcut_motion::preset_registry::PathSegment`
//! 的存法、`bcut-timeline-render` 的 `outline_path` 的读法逐字同一口径，所以
//! App 的选择器缩略图、原型和导出用同一条映射：
//!
//! ```text
//! x = box.x + box.w * px,  y = box.y + box.h * py
//! ```
//!
//! **舞台上真正的每一帧不读这张表**——那条路走内核（`bcut-timeline-render`），
//! 预览与导出因此同源。读它的是形状选择器的缩略图：那是 GPUI 自己描的路径，
//! 与内核是两条路，正如原型的 canvas 2D。
//!
//! 加一个形状 = 加一份 manifest 再跑一次生成器，**永远不是**手改下面某个点，
//! 也永远不是在渲染器里写 `match`。

/// 一段归一化轮廓：verb 用 manifest 的拼写，`pts` 是**展平**的坐标
/// （`[x, y]` / `[cx, cy, x, y]` / `[c1x, c1y, c2x, c2y, x, y]` / 空）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShapePathSeg {{
    pub verb: &'static str,
    pub pts: &'static [f64],
}}

/// 目录顺序（各 manifest 的 `order`）——查表本身没有顺序，选择器要按这个排。
#[rustfmt::skip]
pub const IDS: [&str; {count}] = [
    {ids},
];

/// id → 归一化轮廓。行序同 [`IDS`]。
#[rustfmt::skip]
pub const OUTLINES: [(&str, &[ShapePathSeg]); {count}] = [
{rows}];

/// 查一份轮廓。`None` = 这个 id 不是 outline 形状（`rect` / `ellipse` /
/// `line` / `arrow`，或这份构建不认识的名字）——调用方按自己的方式画，而不是
/// 什么都不画。
pub fn segments(id: &str) -> Option<&'static [ShapePathSeg]> {{
    OUTLINES
        .iter()
        .find(|(name, _)| *name == id)
        .map(|(_, segments)| *segments)
}}

/// 归一化点 → 盒内点。唯一的映射实现，免得每个描点处各写一遍。
pub fn map_point(px: f64, py: f64, x: f32, y: f32, w: f32, h: f32) -> (f32, f32) {{
    (x + w * px as f32, y + h * py as f32)
}}
"##,
        count = FROZEN_OUTLINES,
        ids = rust_ids(),
        rows = rust_rows(),
    )
}

// ── SVG d（designs/baocut 原型） ────────────────────────────────────

/// 归一化坐标 → 原型视框（0..100）里的一个 SVG 数字。
///
/// 前三份生成物发的是 0..1 点列，因为它们的消费者自己做 `x = box.x + box.w * px`
/// 的映射。这一份发的是一条 `d=` 字符串：原型的形状是 `<svg viewBox="-6 -6 112
/// 112"><path d=…>`，缩放归 viewBox 管，路径本身必须已经在 0..100 里。
///
/// 四位小数不是取舍：manifest 存的是六位小数的归一化值，×100 之后恰好是四位。
/// 断言把这条守住——将来有人往配方里写第七位小数，这里红，而不是悄悄丢精度。
fn svg_number(normalised: f64) -> String {
    assert!(normalised.is_finite(), "配方里出现了非有限数 {normalised}");
    let scaled = normalised * 100.0;
    let mut text = format!("{scaled:.4}");
    if text.contains('.') {
        text = text.trim_end_matches('0').trim_end_matches('.').to_string();
    }
    if text == "-0" {
        text = String::from("0");
    }
    let round_trip: f64 = text.parse().expect("emitted svg number must parse");
    assert!(
        (round_trip / 100.0 - normalised).abs() <= 1e-9,
        "{text} 丢了 {normalised} 的精度——配方的小数位超过了六位"
    );
    text
}

/// 一份轮廓 → 一条 `d=`。verb 与 SVG 命令一一对应，全用绝对坐标，
/// 不做 `H`/`V`/`S` 之类的缩写：省下的几个字节换不来第二种读法。
fn svg_d(segments: &[PathSegment]) -> String {
    let mut out = String::new();
    let n = |p: &[f64; 2]| format!("{} {}", svg_number(p[0]), svg_number(p[1]));
    for segment in segments {
        match segment {
            PathSegment::Move(p) => {
                let _ = write!(out, "M{}", n(p));
            }
            PathSegment::Line(p) => {
                let _ = write!(out, "L{}", n(p));
            }
            PathSegment::Quad(c, p) => {
                let _ = write!(out, "Q{} {}", n(c), n(p));
            }
            PathSegment::Cubic(a, b, p) => {
                let _ = write!(out, "C{} {} {}", n(a), n(b), n(p));
            }
            PathSegment::Close => out.push('Z'),
        }
    }
    out
}

fn designs_rows() -> String {
    let mut out = String::new();
    for (id, segments) in outline_rows() {
        let _ = writeln!(out, "    {id}: '{}',", svg_d(segments));
    }
    out
}

fn designs_ids() -> String {
    let quoted: Vec<String> = outline_rows()
        .into_iter()
        .map(|(id, _)| format!("'{id}'"))
        .collect();
    let mut out = String::new();
    for (index, item) in quoted.iter().enumerate() {
        if index > 0 {
            if index % 5 == 0 {
                out.push_str(",\n    ");
            } else {
                out.push_str(", ");
            }
        }
        out.push_str(item);
    }
    out
}

fn render_designs() -> String {
    format!(
        r#"/* @generated by core/crates/bcut-motion/tests/gen_element_shape_paths.rs —— 不要手改。
   改了 `core/presets/builtin/shape/` 下的 manifest 就跑
   `cargo test -p bcut-motion --test gen_element_shape_paths -- --ignored`，
   同一次写盘还会重写另一份孪生：
   `core/crates/bcut-editor-core/src/shape_paths.rs`。

   形状目录里 **`outline` 类**的 {count} 份几何（设计 §7 / §13 P7b-client）。
   目录的参数化三类（`rect` / `ellipse` / `segment`）由各自的参数画出，不在这张表里。

   **这是逐点落下的原始路径**，不是照名字重画的
   （见 `docs/design/bcf/bcut-element-render-foundation-design.md` §13 P7a）。
   于是好几个 id 与它画出来的东西对不上——`squig2` 是块状右箭头、`tick2` 是叉、
   `cross`/`cross2` 都是加号、`sharp2` 是对话气泡、`chevron` 是向下的 V。
   **那是原名，不是移植错误**：id 逐字沿用原名，显示名照画面取
   （`model-elements.js` 的 `SHAPE_NAMES`）。想「修好」某一格的几何 = 让原型与核心
   两处的画布同时对不上。

   坐标在 **0..100** 视框里，因为原型画形状用的是 `<svg viewBox>` 缩放，不像另一份
   生成物那样由消费者自己做 `x = box.x + box.w * px`。*/
window.BC_SHAPE = (() => {{

  /* 目录顺序（各 manifest 的 `order`）——查表本身没有顺序 */
  const IDS = Object.freeze([
    {ids},
  ]);

  /* id → 0..100 视框里的 SVG `d` */
  const D = Object.freeze({{
{rows}  }});

  /* 查一条路径。`null` = 这个 id 不是 outline 形状（`rect` / `ellipse` / `line` /
     `arrow`），调用方按自己的方式画，而不是画一个空的 `<path>` */
  const d = (id) => (Object.prototype.hasOwnProperty.call(D, id) ? D[id] : null);

  return {{IDS, D, d}};
}})();
"#,
        count = FROZEN_OUTLINES,
        ids = designs_ids(),
        rows = designs_rows(),
    )
}

// ── 写盘与门禁 ──────────────────────────────────────────────────────

/// 两份生成物的写盘与门禁共用同一张清单——加一个消费者只改这里一行。
fn generated_outputs() -> [(&'static str, String); 2] {
    [
        (RUST_OUTPUT, render_rust()),
        (DESIGNS_OUTPUT, render_designs()),
    ]
}

/// 几何变化时重写两份生成物。
///
/// `#[ignore]` 是刻意的：日常 `cargo test` 不该写产品目录。
#[test]
#[ignore = "写盘：cargo test -p bcut-motion --test gen_element_shape_paths -- --ignored"]
fn emit_element_shape_paths() {
    for (relative, text) in generated_outputs() {
        let path = output_path(relative);
        std::fs::write(&path, text).expect("写入形状几何表");
        eprintln!("wrote {}", path.display());
    }
}

/// 日常门禁：两份生成物与注册表必须逐字节一致。改了 manifest 却没跑生成器，
/// 这里红。
#[test]
#[ignore = "对拍 v2 的生成物 bcut-editor-core/src/shape_paths.rs 与 designs/baocut/app/model-shape-paths.js：待 bcut-editor-core 移植"]
fn element_shape_paths_are_up_to_date() {
    for (relative, text) in generated_outputs() {
        let path = output_path(relative);
        let on_disk = std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("读取 {} 失败：{err}", path.display()));
        assert_eq!(
            on_disk,
            text,
            "{} 与形状配方不同步——跑 cargo test -p bcut-motion --test gen_element_shape_paths -- --ignored",
            path.display()
        );
    }
}

/// 生成表覆盖的正是"注册表里所有 outline 形状"，一个不多一个不少——这是三端
/// 场景层开 `outline` 门的前提（缺一份配方就等于一个画不出来的下拉项）。
#[test]
fn every_outline_recipe_has_geometry() {
    let rows = outline_rows();
    let rust = render_rust();
    let designs = render_designs();
    for recipe in timeline_shapes() {
        let body = recipe.shape().expect("shape body");
        let is_outline = matches!(body.path, ShapePath::Outline { .. });
        assert_eq!(
            is_outline,
            rows.iter().any(|(id, _)| *id == recipe.id),
            "{} 的 outline 归属与生成表不一致",
            recipe.id
        );
        if is_outline {
            assert!(
                rust.contains(&format!("\n    (\"{}\", &[", recipe.id)),
                "{}",
                recipe.id
            );
            assert!(
                designs.contains(&format!("\n    {}: 'M", recipe.id)),
                "{}",
                recipe.id
            );
        }
    }
    // 每份配方的第一段必须是 `move`（解析期已校验），消费者因此不必防守。
    for (id, segments) in rows {
        assert!(
            matches!(segments.first(), Some(PathSegment::Move(_))),
            "{id} 的轮廓没有以 move 开头"
        );
    }
}
