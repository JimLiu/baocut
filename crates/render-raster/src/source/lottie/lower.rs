//! Lottie 图层树 → DrawOp。
//!
//! **直接发原语，不先光栅化**（ADR-M11）：形状/描边/渐变落在 `FillPathPaint` /
//! `StrokePathPaint`，图层不透明度与混合落在 `PushLayer`，遮罩与轨道遮罩落在
//! `ClipPath` 或 `PushMatte`/`PopMatte`。这样 Lottie 与 BCF 自己的元素共享一条
//! 指令流、一份帧指纹、一套静止帧缓存，而且矢量内容跟着元素盒缩放，不会先
//! 光栅化到素材原尺寸再拉伸糊掉。
//!
//! 时间一律用**合成帧号**（f64）。图层可见性按父合成帧比 `ip`/`op`，图层自己
//! 的属性按 `compFrame − st` 求值，预合成的内部帧再除以 `sr` 或走时间重映射
//! ——与 lottie-web 的口径一致（rlottie 把 `sr` 也摊到普通图层上，本实现跟
//! lottie-web，因为它是事实参考实现）。

use super::geometry::{self, Affine, Contour, ShapePath};
use super::schema::{Animation, Gradient, Layer, LayerKind, ShapeItem, StrokeStyle, color_at};
use crate::drawop::{DrawOp, FrameBuilder, GradientStop, PaintData};
use anyhow::{Result, bail};
use motion::effect::BlendMode;
use std::collections::BTreeMap;

/// 一次录制的上下文。
pub struct Lowering<'a> {
    doc: &'a Animation,
    /// Lottie 图片资源 id → DrawOp string 侧表里的资产名。
    images: &'a BTreeMap<String, String>,
    /// 预合成递归深度上限：素材里互相引用会无限递归，这里直接拒。
    depth: usize,
}

const MAX_PRECOMP_DEPTH: usize = 16;

impl<'a> Lowering<'a> {
    pub fn new(doc: &'a Animation, images: &'a BTreeMap<String, String>) -> Lowering<'a> {
        Lowering {
            doc,
            images,
            depth: 0,
        }
    }

    /// 录制整段动画在 `frame`（合成帧号）的指令。`tf` 把合成坐标系放到画布上。
    pub fn record(&self, frame: f64, tf: Affine, b: &mut FrameBuilder) -> Result<()> {
        // 根合成裁到自己的画幅：播放器都这么做，不裁会让越界图层糊到元素盒外
        let clip = rect_path(self.doc.width, self.doc.height);
        let path = b.path_id(clip.to_path_data());
        b.push(DrawOp::ClipPath {
            path,
            tf: tf.to_mat6(),
        });
        self.render_layers(&self.doc.layers, frame, tf, b)?;
        b.push(DrawOp::PopClip);
        Ok(())
    }

    fn render_layers(
        &self,
        layers: &[Layer],
        frame: f64,
        tf: Affine,
        b: &mut FrameBuilder,
    ) -> Result<()> {
        // bodymovin 的 layers[0] 是最上层；画的时候从最下面开始
        let mut consumed = vec![false; layers.len()];
        for idx in (0..layers.len()).rev() {
            if consumed[idx] {
                continue;
            }
            let layer = &layers[idx];
            if layer.hidden || layer.is_matte_source {
                // 遮罩源自己不出画；它由下面那层在 `matte_source` 里取用
                continue;
            }
            let matte = layer.matte.and_then(|mode| {
                let source = idx.checked_sub(1)?;
                layers
                    .get(source)
                    .filter(|candidate| candidate.is_matte_source)
                    .map(|candidate| (source, candidate, mode))
            });
            if let Some((source, _, _)) = matte {
                consumed[source] = true;
            }
            self.render_layer(layers, layer, matte.map(|m| (m.1, m.2)), frame, tf, b)?;
        }
        Ok(())
    }

    fn render_layer(
        &self,
        siblings: &[Layer],
        layer: &Layer,
        matte: Option<(&Layer, crate::drawop::MatteMode)>,
        frame: f64,
        tf: Affine,
        b: &mut FrameBuilder,
    ) -> Result<()> {
        if !visible(layer, frame) {
            return Ok(());
        }
        // **属性时间就是所在合成的帧号**，不减 `st`。AE 把图层自己的关键帧写在
        // **合成时间轴**上；`st`（Start Time）说的是"这一层的**源**从哪一帧开始"
        // ——它只该挪预合成的内部时钟。踩过一次：把 `st` 也摊到属性上，某个
        // `st = -25` 的 spinner 里 8 条 `tm` 轨（关键帧正好铺满 `[ip, op) = [0,22]`）
        // 被整体推出取值范围，全部退化成末值常量，画面静止。
        //
        // lottie-web 5.13.0 看着像在减 `st`，其实两边一起减、正好抵消：
        // `getValueAtCurrentTime` 取 `frameNum = comp.renderedFrame − offsetTime`，
        // 而查找与插值用的关键帧时刻也是 `keyData.t − offsetTime`
        // （`lottie.js:3022/2802/2827`，形状属性 `:3491/:3516` 同款），
        // `offsetTime = elem.data.st` 在差里消掉——等价于直接拿合成帧比原始 `t`。
        let local = frame;
        let alpha = layer.transform.alpha(local);
        if alpha <= 0.0 {
            return Ok(());
        }
        let matrix = self.layer_matrix(siblings, layer, frame).then(tf);

        // 遮罩：单个满不透明的 add 遮罩走裁剪快路径，其余走离屏遮罩层
        let masks = MaskPlan::of(layer, local);
        let needs_layer = alpha < 1.0
            || layer.blend != BlendMode::Normal
            || matte.is_some()
            || masks.needs_layer();

        if needs_layer {
            b.push(DrawOp::PushLayer {
                opacity: alpha as f32,
                blend: layer.blend,
            });
        }
        let content_alpha = if needs_layer { 1.0 } else { alpha };

        if let MaskPlan::Clip(contour) = &masks {
            let path = b.path_id(ShapePath::single(contour.clone()).to_path_data());
            b.push(DrawOp::ClipPath {
                path,
                tf: matrix.to_mat6(),
            });
        }

        self.render_content(layer, local, matrix, content_alpha, b)?;

        if let MaskPlan::Clip(_) = &masks {
            b.push(DrawOp::PopClip);
        }
        if let MaskPlan::Matte(shapes) = &masks {
            b.push(DrawOp::PushMatte);
            for (contour, opacity) in shapes {
                let paint = b.paint_id(PaintData::Solid([1.0, 1.0, 1.0, *opacity as f32]));
                let path = b.path_id(ShapePath::single(contour.clone()).to_path_data());
                b.push(DrawOp::FillPathPaint {
                    path,
                    paint,
                    even_odd: false,
                    tf: matrix.to_mat6(),
                });
            }
            b.push(DrawOp::PopMatte {
                mode: crate::drawop::MatteMode::Alpha.code(),
            });
        }

        if let Some((source, mode)) = matte {
            b.push(DrawOp::PushMatte);
            if visible(source, frame) {
                let source_matrix = self.layer_matrix(siblings, source, frame).then(tf);
                let source_alpha = source.transform.alpha(frame);
                self.render_content(source, frame, source_matrix, source_alpha, b)?;
            }
            b.push(DrawOp::PopMatte { mode: mode.code() });
        }

        if needs_layer {
            b.push(DrawOp::PopLayer);
        }
        Ok(())
    }

    /// 图层自身矩阵 + 父链（`parent` 指向同一合成里的另一图层的 `ind`）。
    fn layer_matrix(&self, siblings: &[Layer], layer: &Layer, frame: f64) -> Affine {
        let mut matrix = layer.transform.matrix(frame);
        let mut parent = layer.parent;
        // 父链上限 = 图层数：环形父链在这里自然终止，不会死循环
        for _ in 0..siblings.len() {
            let Some(index) = parent else { break };
            let Some(next) = siblings.iter().find(|candidate| candidate.index == index) else {
                break;
            };
            matrix = matrix.then(next.transform.matrix(frame));
            parent = next.parent;
        }
        matrix
    }

    fn render_content(
        &self,
        layer: &Layer,
        local: f64,
        matrix: Affine,
        alpha: f64,
        b: &mut FrameBuilder,
    ) -> Result<()> {
        match &layer.kind {
            LayerKind::Null => Ok(()),
            LayerKind::Shape(items) => {
                let (_, pending) = self.render_shapes(items, local, matrix, alpha, &[]);
                emit(&pending, b);
                Ok(())
            }
            LayerKind::Solid {
                color,
                width,
                height,
            } => {
                let paint = b.paint_id(PaintData::Solid([
                    color[0] as f32,
                    color[1] as f32,
                    color[2] as f32,
                    alpha as f32,
                ]));
                let path = b.path_id(rect_path(*width, *height).to_path_data());
                b.push(DrawOp::FillPathPaint {
                    path,
                    paint,
                    even_odd: false,
                    tf: matrix.to_mat6(),
                });
                Ok(())
            }
            LayerKind::Image { ref_id } => {
                let Some(name) = self.images.get(ref_id) else {
                    bail!(
                        "lottie-asset-missing: 图层 \"{}\" 引用的图片资源 \"{ref_id}\" 没有被加载",
                        layer.name
                    );
                };
                let asset = b.string_id(name);
                // 图片按天然尺寸画在图层原点；元素盒的缩放由 `matrix` 承担
                let needs_alpha = alpha < 1.0;
                if needs_alpha {
                    b.push(DrawOp::PushLayer {
                        opacity: alpha as f32,
                        blend: BlendMode::Normal,
                    });
                }
                b.push(DrawOp::DrawMedia {
                    asset,
                    media_ms: -1,
                    src: [0.0; 4],
                    tf: matrix.to_mat6(),
                });
                if needs_alpha {
                    b.push(DrawOp::PopLayer);
                }
                Ok(())
            }
            LayerKind::Precomp {
                ref_id,
                width,
                height,
            } => {
                if self.depth >= MAX_PRECOMP_DEPTH {
                    bail!(
                        "lottie-precomp-depth: 预合成嵌套超过 {MAX_PRECOMP_DEPTH} 层（\"{ref_id}\"，可能是循环引用）"
                    );
                }
                let Some(layers) = self.doc.precomps.get(ref_id) else {
                    bail!(
                        "lottie-asset-missing: 图层 \"{}\" 引用的预合成 \"{ref_id}\" 不在 assets 里",
                        layer.name
                    );
                };
                // **只有这里用 `st` / `sr`**：预合成的内部时钟。
                // 有时间重映射时它给出的就是绝对内部帧（属性本身按合成帧求值）；
                // 没有时才按 `(合成帧 − st) / sr` 平移伸缩。
                let inner = match &layer.time_remap {
                    Some(remap) => remap.scalar(local) * self.doc.fr,
                    None => (local - layer.start) / layer.stretch,
                };
                let needs_layer = alpha < 1.0;
                if needs_layer {
                    b.push(DrawOp::PushLayer {
                        opacity: alpha as f32,
                        blend: BlendMode::Normal,
                    });
                }
                if *width > 0.0 && *height > 0.0 {
                    let path = b.path_id(rect_path(*width, *height).to_path_data());
                    b.push(DrawOp::ClipPath {
                        path,
                        tf: matrix.to_mat6(),
                    });
                }
                let nested = Lowering {
                    doc: self.doc,
                    images: self.images,
                    depth: self.depth + 1,
                };
                nested.render_layers(layers, inner, matrix, b)?;
                if *width > 0.0 && *height > 0.0 {
                    b.push(DrawOp::PopClip);
                }
                if needs_layer {
                    b.push(DrawOp::PopLayer);
                }
                Ok(())
            }
        }
    }

    // ── 形状树 ─────────────────────────────────────────────────────

    /// 一个形状组。
    ///
    /// AE 的形状组有两条**方向相反**的规则，这里都要照顾到：
    ///
    /// * 画笔（fill / stroke / 修改器）作用于它**上方**的路径——也就是数组里
    ///   排在它**前面**的条目。于是路径要**正序**累积。
    /// * 排在前面的条目画在**上层**。于是绘制要**倒序**发出。
    ///
    /// 所以先正序走一遍把绘制记成 [`Pending`]，最后整组倒转；嵌套组作为一个
    /// 整体块参与倒转，块内已经自己倒过了。返回值是本组产出的路径（已折进
    /// 本组的 `tr`），供父组上方的画笔继续使用。
    fn render_shapes(
        &self,
        items: &[ShapeItem],
        frame: f64,
        tf: Affine,
        alpha: f64,
        inherited: &[Modifier],
    ) -> (ShapePath, Vec<Pending>) {
        let group = items.iter().find_map(|item| match item {
            ShapeItem::Transform(t) => Some(t),
            _ => None,
        });
        let group_tf = group.map(|t| t.matrix(frame)).unwrap_or(Affine::IDENTITY);
        let local_tf = group_tf.then(tf);
        let local_alpha = alpha * group.map(|t| t.alpha(frame)).unwrap_or(1.0);
        // 修改器（Trim / Round Corners）作用于排在它**上方**的一切画笔，无论
        // 画笔是本组里排在它前面的条目，还是更上方子组里的条目：
        //
        // * 同组：`[sh, st, tm, tr]` 是 Trim Paths 描边动画最常见的写法（AE 面板
        //   里 Trim 在 Stroke 下面）。按数组正序走到 `st` 时 `tm` 还没套上，
        //   所以画笔必须自己回看 `items[index + 1..]`——否则描边永远整条画出，
        //   Noto「Rainbow」那种生长动画就退化成一条静止的满弧。
        // * 跨组：Noto「Chart Increasing」的折线是 `[gr{sh, st}, tm]`——描边在
        //   子组里、tm 在父组里，靠 `inherited` 下传。
        //
        // 两段按「先本组、后继承」的顺序套，和子组拿到的 `passed` 同一口径。
        // 修改器在本组的局部坐标上套用（Trim 是百分比、对仿射变换不敏感；
        // Round Corners 的半径不折算 `tr` 缩放，属可接受的近似）。
        let painted = |index: usize, paths: &ShapePath| -> ShapePath {
            items[index + 1..]
                .iter()
                .filter_map(|item| Modifier::evaluate(item, frame))
                .chain(inherited.iter().cloned())
                .fold(paths.clone(), |acc, modifier| modifier.apply(&acc))
        };

        let mut paths = ShapePath::default();
        let mut pending: Vec<Pending> = Vec::new();
        for (index, item) in items.iter().enumerate() {
            match item {
                ShapeItem::Transform(_) | ShapeItem::MergeAppend => {}
                ShapeItem::Group { items: sub_items } => {
                    // 本组里排在子组下方的修改器先套，再套更外层继承来的。
                    let mut passed: Vec<Modifier> = items[index + 1..]
                        .iter()
                        .filter_map(|item| Modifier::evaluate(item, frame))
                        .collect();
                    passed.extend(inherited.iter().cloned());
                    let (sub, block) =
                        self.render_shapes(sub_items, frame, local_tf, local_alpha, &passed);
                    paths.extend(&sub);
                    pending.push(Pending::Block(block));
                }
                ShapeItem::Path {
                    path,
                    reversed: flip,
                } => {
                    let contour = path.value(frame);
                    paths
                        .0
                        .push(if *flip { contour.reversed() } else { contour });
                }
                ShapeItem::Rect {
                    position,
                    size,
                    radius,
                    reversed: flip,
                } => {
                    let contour = geometry::rect(
                        position.point(frame),
                        size.point(frame),
                        radius.scalar(frame),
                    );
                    paths
                        .0
                        .push(if *flip { contour.reversed() } else { contour });
                }
                ShapeItem::Ellipse {
                    position,
                    size,
                    reversed: flip,
                } => {
                    let contour = geometry::ellipse(position.point(frame), size.point(frame));
                    paths
                        .0
                        .push(if *flip { contour.reversed() } else { contour });
                }
                ShapeItem::Star {
                    position,
                    points,
                    rotation,
                    outer_radius,
                    outer_round,
                    inner_radius,
                    inner_round,
                    is_star,
                } => paths.0.push(geometry::star(
                    position.point(frame),
                    points.scalar(frame),
                    rotation.scalar(frame),
                    outer_radius.scalar(frame),
                    outer_round.scalar(frame),
                    inner_radius.scalar(frame),
                    inner_round.scalar(frame),
                    *is_star,
                )),
                ShapeItem::Trim {
                    start,
                    end,
                    offset,
                    individually,
                } => {
                    paths = geometry::trim(
                        &paths,
                        start.scalar(frame),
                        end.scalar(frame),
                        offset.scalar(frame),
                        *individually,
                    );
                }
                ShapeItem::RoundCorners { radius } => {
                    paths = geometry::round_corners(&paths, radius.scalar(frame));
                }
                ShapeItem::Fill {
                    color,
                    opacity,
                    even_odd,
                } => {
                    let rgb = color_at(color, frame);
                    let a = local_alpha * (opacity.scalar(frame) / 100.0).clamp(0.0, 1.0);
                    if paths.is_empty() || a <= 0.0 {
                        continue;
                    }
                    let path = painted(index, &paths);
                    if path.is_empty() {
                        continue;
                    }
                    pending.push(Pending::Fill {
                        path,
                        paint: PaintData::Solid([
                            rgb[0] as f32,
                            rgb[1] as f32,
                            rgb[2] as f32,
                            a as f32,
                        ]),
                        even_odd: *even_odd,
                        tf: local_tf,
                    });
                }
                ShapeItem::GradientFill {
                    gradient,
                    opacity,
                    even_odd,
                } => {
                    let a = local_alpha * (opacity.scalar(frame) / 100.0).clamp(0.0, 1.0);
                    if paths.is_empty() || a <= 0.0 {
                        continue;
                    }
                    let path = painted(index, &paths);
                    if path.is_empty() {
                        continue;
                    }
                    pending.push(Pending::Fill {
                        path,
                        paint: gradient_paint(gradient, frame, a),
                        even_odd: *even_odd,
                        tf: local_tf,
                    });
                }
                ShapeItem::Stroke {
                    color,
                    opacity,
                    style,
                } => {
                    let rgb = color_at(color, frame);
                    let a = local_alpha * (opacity.scalar(frame) / 100.0).clamp(0.0, 1.0);
                    let paint =
                        PaintData::Solid([rgb[0] as f32, rgb[1] as f32, rgb[2] as f32, a as f32]);
                    pending.extend(stroke(
                        &painted(index, &paths),
                        style,
                        paint,
                        frame,
                        a,
                        local_tf,
                    ));
                }
                ShapeItem::GradientStroke {
                    gradient,
                    opacity,
                    style,
                } => {
                    let a = local_alpha * (opacity.scalar(frame) / 100.0).clamp(0.0, 1.0);
                    let paint = gradient_paint(gradient, frame, a);
                    pending.extend(stroke(
                        &painted(index, &paths),
                        style,
                        paint,
                        frame,
                        a,
                        local_tf,
                    ));
                }
            }
        }
        pending.reverse();
        (paths.transformed(&group_tf), pending)
    }
}

/// 某一帧上已求值的路径修改器（Trim Paths / Round Corners），用来从父组
/// 下传给排在它上方的子组。
#[derive(Clone, Debug)]
enum Modifier {
    Trim {
        start: f64,
        end: f64,
        offset: f64,
        individually: bool,
    },
    RoundCorners {
        radius: f64,
    },
}

impl Modifier {
    fn evaluate(item: &ShapeItem, frame: f64) -> Option<Self> {
        match item {
            ShapeItem::Trim {
                start,
                end,
                offset,
                individually,
            } => Some(Modifier::Trim {
                start: start.scalar(frame),
                end: end.scalar(frame),
                offset: offset.scalar(frame),
                individually: *individually,
            }),
            ShapeItem::RoundCorners { radius } => Some(Modifier::RoundCorners {
                radius: radius.scalar(frame),
            }),
            _ => None,
        }
    }

    fn apply(&self, paths: &ShapePath) -> ShapePath {
        match *self {
            Modifier::Trim {
                start,
                end,
                offset,
                individually,
            } => geometry::trim(paths, start, end, offset, individually),
            Modifier::RoundCorners { radius } => geometry::round_corners(paths, radius),
        }
    }
}

/// 一条待发的绘制。先记后发，才能同时满足「画笔取上方的路径」与
/// 「上方的条目画在上层」这两条方向相反的规则。
enum Pending {
    Fill {
        path: ShapePath,
        paint: PaintData,
        even_odd: bool,
        tf: Affine,
    },
    Stroke {
        path: ShapePath,
        paint: PaintData,
        width: f64,
        cap: u8,
        join: u8,
        miter: f64,
        tf: Affine,
    },
    /// 嵌套组：块内顺序已经定好，整体参与外层的倒转。
    Block(Vec<Pending>),
}

fn emit(pending: &[Pending], b: &mut FrameBuilder) {
    for item in pending {
        match item {
            Pending::Block(inner) => emit(inner, b),
            Pending::Fill {
                path,
                paint,
                even_odd,
                tf,
            } => {
                let paint = b.paint_id(paint.clone());
                let path = b.path_id(path.to_path_data());
                b.push(DrawOp::FillPathPaint {
                    path,
                    paint,
                    even_odd: *even_odd,
                    tf: tf.to_mat6(),
                });
            }
            Pending::Stroke {
                path,
                paint,
                width,
                cap,
                join,
                miter,
                tf,
            } => {
                let paint = b.paint_id(paint.clone());
                let path = b.path_id(path.to_path_data());
                b.push(DrawOp::StrokePathPaint {
                    path,
                    paint,
                    width: *width as f32,
                    cap: *cap,
                    join: *join,
                    miter: *miter as f32,
                    tf: tf.to_mat6(),
                });
            }
        }
    }
}

fn visible(layer: &Layer, frame: f64) -> bool {
    frame >= layer.in_point && frame < layer.out_point
}

/// 中心在原点、尺寸 `w × h` 的矩形——纯粹是"左上角在 (0,0)"的画幅框。
fn rect_path(w: f64, h: f64) -> ShapePath {
    ShapePath::single(Contour {
        v: vec![[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]],
        i: vec![[0.0, 0.0]; 4],
        o: vec![[0.0, 0.0]; 4],
        closed: true,
    })
}

#[allow(clippy::too_many_arguments)]
fn stroke(
    paths: &ShapePath,
    style: &StrokeStyle,
    paint: PaintData,
    frame: f64,
    alpha: f64,
    tf: Affine,
) -> Option<Pending> {
    if paths.is_empty() || alpha <= 0.0 {
        return None;
    }
    let width = style.width.scalar(frame);
    if width <= 0.0 {
        return None;
    }
    let pattern: Vec<f64> = style
        .dashes
        .iter()
        .map(|value| value.scalar(frame))
        .collect();
    let dashed = if pattern.is_empty() {
        paths.clone()
    } else {
        let offset = style
            .dash_offset
            .as_ref()
            .map(|value| value.scalar(frame))
            .unwrap_or(0.0);
        geometry::dash(paths, &pattern, offset)
    };
    if dashed.is_empty() {
        return None;
    }
    Some(Pending::Stroke {
        path: dashed,
        paint,
        width,
        cap: style.cap,
        join: style.join,
        miter: style.miter,
        tf,
    })
}

/// 渐变 → paint 侧表条目。几何在形状本地坐标系里（与 op 的 `tf` 同一系）。
fn gradient_paint(gradient: &Gradient, frame: f64, alpha: f64) -> PaintData {
    let start = gradient.start.point(frame);
    let end = gradient.end.point(frame);
    let stops = gradient_stops(gradient, frame, alpha);
    if !gradient.radial {
        return PaintData::Linear {
            p0: [start[0] as f32, start[1] as f32],
            p1: [end[0] as f32, end[1] as f32],
            stops,
        };
    }
    let dx = end[0] - start[0];
    let dy = end[1] - start[1];
    let radius = (dx * dx + dy * dy).sqrt();
    // 高光：沿 `a` 角、离圆心 `h`%（夹在 99% 以内，焦点落到圆周上会退化）
    let highlight = (gradient.highlight_length.scalar(frame) / 100.0).clamp(-0.99, 0.99);
    let angle = gradient.highlight_angle.scalar(frame).to_radians();
    let focus = [
        start[0] + radius * highlight * angle.cos(),
        start[1] + radius * highlight * angle.sin(),
    ];
    PaintData::Radial {
        center: [start[0] as f32, start[1] as f32],
        radius: radius as f32,
        focus: [focus[0] as f32, focus[1] as f32],
        stops,
    }
}

/// 扁平色标数组 → 色标表。颜色标与透明标各有自己的 offset 列表，取并集后
/// 在两边各自插值——只取颜色标会把中途的透明变化整个丢掉。
fn gradient_stops(gradient: &Gradient, frame: f64, alpha: f64) -> Vec<GradientStop> {
    let data = gradient.stops.value(frame);
    let count = gradient.stop_count.min(data.len() / 4);
    if count == 0 {
        return vec![GradientStop {
            offset: 0.0,
            color: [0.0, 0.0, 0.0, alpha as f32],
        }];
    }
    let colors: Vec<(f64, [f64; 3])> = (0..count)
        .map(|k| {
            (
                data[k * 4],
                [data[k * 4 + 1], data[k * 4 + 2], data[k * 4 + 3]],
            )
        })
        .collect();
    let alphas: Vec<(f64, f64)> = data[count * 4..]
        .chunks_exact(2)
        .map(|pair| (pair[0], pair[1]))
        .collect();

    let mut offsets: Vec<f64> = colors
        .iter()
        .map(|(o, _)| *o)
        .chain(alphas.iter().map(|(o, _)| *o))
        .collect();
    offsets.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    offsets.dedup_by(|a, b| (*a - *b).abs() < 1e-9);

    offsets
        .into_iter()
        .map(|offset| {
            let rgb = interpolate_stops(&colors, offset);
            let a = if alphas.is_empty() {
                1.0
            } else {
                interpolate_scalar(&alphas, offset)
            };
            GradientStop {
                offset: offset.clamp(0.0, 1.0) as f32,
                color: [
                    rgb[0] as f32,
                    rgb[1] as f32,
                    rgb[2] as f32,
                    (a * alpha).clamp(0.0, 1.0) as f32,
                ],
            }
        })
        .collect()
}

fn interpolate_stops(stops: &[(f64, [f64; 3])], at: f64) -> [f64; 3] {
    if stops.is_empty() {
        return [0.0; 3];
    }
    if at <= stops[0].0 {
        return stops[0].1;
    }
    let last = stops[stops.len() - 1];
    if at >= last.0 {
        return last.1;
    }
    for pair in stops.windows(2) {
        let (o0, c0) = pair[0];
        let (o1, c1) = pair[1];
        if at >= o0 && at <= o1 {
            let t = if o1 > o0 { (at - o0) / (o1 - o0) } else { 0.0 };
            return [
                c0[0] + (c1[0] - c0[0]) * t,
                c0[1] + (c1[1] - c0[1]) * t,
                c0[2] + (c1[2] - c0[2]) * t,
            ];
        }
    }
    last.1
}

fn interpolate_scalar(stops: &[(f64, f64)], at: f64) -> f64 {
    if stops.is_empty() {
        return 1.0;
    }
    if at <= stops[0].0 {
        return stops[0].1;
    }
    let last = stops[stops.len() - 1];
    if at >= last.0 {
        return last.1;
    }
    for pair in stops.windows(2) {
        let (o0, a0) = pair[0];
        let (o1, a1) = pair[1];
        if at >= o0 && at <= o1 {
            let t = if o1 > o0 { (at - o0) / (o1 - o0) } else { 0.0 };
            return a0 + (a1 - a0) * t;
        }
    }
    last.1
}

/// 图层遮罩的落地方式。
enum MaskPlan {
    None,
    /// 单个满不透明的 add 遮罩：一条 `ClipPath` 就够，不必起离屏层。
    Clip(Contour),
    /// 其余情况：遮罩形状画进离屏遮罩层，按 alpha 折进内容。
    Matte(Vec<(Contour, f64)>),
}

impl MaskPlan {
    fn of(layer: &Layer, frame: f64) -> MaskPlan {
        if layer.masks.is_empty() {
            return MaskPlan::None;
        }
        let shapes: Vec<(Contour, f64)> = layer
            .masks
            .iter()
            .map(|mask| {
                let contour = mask.path.value(frame);
                let opacity = (mask.opacity.scalar(frame) / 100.0).clamp(0.0, 1.0);
                (contour, opacity)
            })
            .filter(|(contour, opacity)| !contour.is_empty() && *opacity > 0.0)
            .collect();
        if shapes.is_empty() {
            return MaskPlan::None;
        }
        if shapes.len() == 1 && shapes[0].1 >= 1.0 && !layer.masks[0].inverted {
            return MaskPlan::Clip(shapes[0].0.clone());
        }
        MaskPlan::Matte(shapes)
    }

    fn needs_layer(&self) -> bool {
        matches!(self, MaskPlan::Matte(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::lottie::schema::{self, Diagnostics};
    use serde_json::json;

    fn lower(doc: serde_json::Value, frame: f64) -> crate::drawop::FrameOps {
        let mut diagnostics = Diagnostics::default();
        let animation = schema::parse("t", &doc, &mut diagnostics).unwrap();
        let images = BTreeMap::new();
        let mut builder = FrameBuilder::default();
        Lowering::new(&animation, &images)
            .record(frame, Affine::IDENTITY, &mut builder)
            .unwrap();
        builder.finish()
    }

    fn base(layers: serde_json::Value) -> serde_json::Value {
        json!({"v": "5.7.0", "fr": 10, "ip": 0, "op": 10, "w": 100, "h": 100, "layers": layers})
    }

    fn square_shape(fill: serde_json::Value) -> serde_json::Value {
        json!({"ty": 4, "ind": 1, "ip": 0, "op": 10, "st": 0, "ks": {},
        "shapes": [{"ty": "gr", "it": [
            {"ty": "rc", "p": {"a": 0, "k": [50, 50]}, "s": {"a": 0, "k": [40, 40]},
             "r": {"a": 0, "k": 0}},
            fill,
            {"ty": "tr", "p": {"a": 0, "k": [0, 0]}, "a": {"a": 0, "k": [0, 0]},
             "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0}, "o": {"a": 0, "k": 100}}
        ]}]})
    }

    fn solid_fill() -> serde_json::Value {
        json!({"ty": "fl", "c": {"a": 0, "k": [1, 0, 0, 1]}, "o": {"a": 0, "k": 100}})
    }

    /// Noto「Rainbow」的彩虹弧：`[sh, st, tm, tr]`——Trim Paths 和描边在**同一组**
    /// 里、排在描边下方。这是 Trim 生长动画最常见的写法；按数组正序画的话走到
    /// `st` 时 `tm` 还没套上，整条弧会被画满，动画整体丢失。
    #[test]
    fn a_trim_below_a_stroke_in_the_same_group_trims_that_stroke() {
        fn doc(trim_end: f64) -> serde_json::Value {
            base(
                json!([{"ty": 4, "ind": 1, "ip": 0, "op": 10, "st": 0, "ks": {},
                "shapes": [{"ty": "gr", "it": [
                    {"ty": "sh", "ks": {"a": 0, "k": {"c": false,
                        "v": [[0, 50], [100, 50]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]]}}},
                    {"ty": "st", "c": {"a": 0, "k": [0, 0, 1, 1]}, "o": {"a": 0, "k": 100},
                     "w": {"a": 0, "k": 4}, "lc": 1, "lj": 1},
                    {"ty": "tm", "s": {"a": 0, "k": 0}, "e": {"a": 0, "k": trim_end},
                     "o": {"a": 0, "k": 0}, "m": 1},
                    {"ty": "tr", "p": {"a": 0, "k": [0, 0]}, "a": {"a": 0, "k": [0, 0]},
                     "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0}, "o": {"a": 0, "k": 100}}
                ]}]}]),
            )
        }
        let full = lower(doc(100.0), 0.0);
        let half = lower(doc(50.0), 0.0);
        let none = lower(doc(0.0), 0.0);
        let strokes = |frame: &crate::drawop::FrameOps| {
            frame
                .ops
                .iter()
                .filter(|op| matches!(op, DrawOp::StrokePathPaint { .. }))
                .count()
        };
        assert_eq!(strokes(&full), 1);
        assert_eq!(strokes(&half), 1);
        assert_eq!(strokes(&none), 0, "trim 到 0% 时同组的描边不再发出");
        assert_ne!(
            full.paths, half.paths,
            "50% 的 trim 必须真的改了同组描边的路径"
        );
    }

    /// Noto「Chart Increasing」的折线：描边在子组里、Trim Paths 在父组里排在
    /// 子组下方。Trim 必须下传，否则折线整条画出、动画丢失。
    #[test]
    fn a_trim_after_a_nested_group_trims_that_groups_stroke() {
        fn doc(trim_end: f64) -> serde_json::Value {
            base(
                json!([{"ty": 4, "ind": 1, "ip": 0, "op": 10, "st": 0, "ks": {},
                "shapes": [{"ty": "gr", "it": [
                    {"ty": "gr", "it": [
                        {"ty": "sh", "ks": {"a": 0, "k": {"c": false,
                            "v": [[0, 50], [100, 50]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]]}}},
                        {"ty": "st", "c": {"a": 0, "k": [0, 0, 1, 1]}, "o": {"a": 0, "k": 100},
                         "w": {"a": 0, "k": 4}, "lc": 1, "lj": 1}
                    ]},
                    {"ty": "tm", "s": {"a": 0, "k": 0}, "e": {"a": 0, "k": trim_end},
                     "o": {"a": 0, "k": 0}, "m": 1}
                ]}]}]),
            )
        }
        let full = lower(doc(100.0), 0.0);
        let half = lower(doc(50.0), 0.0);
        let none = lower(doc(0.0), 0.0);
        let strokes = |frame: &crate::drawop::FrameOps| {
            frame
                .ops
                .iter()
                .filter(|op| matches!(op, DrawOp::StrokePathPaint { .. }))
                .count()
        };
        assert_eq!(strokes(&full), 1);
        assert_eq!(strokes(&half), 1);
        assert_eq!(strokes(&none), 0, "trim 到 0% 时子组的描边不再发出");
        assert_ne!(full.paths, half.paths, "50% 的 trim 必须真的改了描边路径");
    }

    #[test]
    fn a_single_filled_rectangle_lowers_to_one_fill_between_clips() {
        let frame = lower(base(json!([square_shape(solid_fill())])), 0.0);
        let kinds: Vec<&str> = frame
            .ops
            .iter()
            .map(|op| match op {
                DrawOp::ClipPath { .. } => "clip",
                DrawOp::PopClip => "popclip",
                DrawOp::FillPathPaint { .. } => "fill",
                _ => "other",
            })
            .collect();
        assert_eq!(kinds, vec!["clip", "fill", "popclip"]);
        assert_eq!(frame.paints.len(), 1);
        assert_eq!(frame.paints[0], PaintData::Solid([1.0, 0.0, 0.0, 1.0]));
    }

    #[test]
    fn a_layer_outside_its_time_range_emits_nothing() {
        let mut doc = base(json!([square_shape(solid_fill())]));
        doc["layers"][0]["ip"] = json!(5);
        assert_eq!(lower(doc.clone(), 0.0).ops.len(), 2, "只剩 clip/popclip");
        assert_eq!(lower(doc, 6.0).ops.len(), 3);
    }

    #[test]
    fn layer_opacity_and_blend_open_an_offscreen_layer() {
        let mut doc = base(json!([square_shape(solid_fill())]));
        doc["layers"][0]["ks"] = json!({"o": {"a": 0, "k": 50}});
        doc["layers"][0]["bm"] = json!(1);
        let frame = lower(doc, 0.0);
        let pushed = frame.ops.iter().find_map(|op| match op {
            DrawOp::PushLayer { opacity, blend } => Some((*opacity, *blend)),
            _ => None,
        });
        assert_eq!(pushed, Some((0.5, BlendMode::Multiply)));
        assert!(frame.ops.iter().any(|op| matches!(op, DrawOp::PopLayer)));
    }

    #[test]
    fn a_track_matte_wraps_the_content_in_push_pop_matte() {
        let mut matte_source = square_shape(solid_fill());
        matte_source["td"] = json!(1);
        matte_source["ind"] = json!(2);
        let mut content = square_shape(solid_fill());
        content["tt"] = json!(1);
        let frame = lower(base(json!([matte_source, content])), 0.0);
        let codes: Vec<&str> = frame
            .ops
            .iter()
            .map(|op| match op {
                DrawOp::PushLayer { .. } => "push",
                DrawOp::PopLayer => "pop",
                DrawOp::PushMatte => "pushmatte",
                DrawOp::PopMatte { .. } => "popmatte",
                DrawOp::FillPathPaint { .. } => "fill",
                DrawOp::ClipPath { .. } => "clip",
                DrawOp::PopClip => "popclip",
                _ => "other",
            })
            .collect();
        assert_eq!(
            codes,
            vec![
                "clip",
                "push",
                "fill",
                "pushmatte",
                "fill",
                "popmatte",
                "pop",
                "popclip"
            ]
        );
    }

    #[test]
    fn a_full_opacity_add_mask_becomes_a_clip_path() {
        let mut doc = base(json!([square_shape(solid_fill())]));
        doc["layers"][0]["masksProperties"] = json!([{
            "mode": "a", "o": {"a": 0, "k": 100},
            "pt": {"a": 0, "k": {"v": [[0, 0], [10, 0], [10, 10]],
                                 "i": [[0, 0], [0, 0], [0, 0]],
                                 "o": [[0, 0], [0, 0], [0, 0]], "c": true}}
        }]);
        let frame = lower(doc, 0.0);
        assert_eq!(
            frame
                .ops
                .iter()
                .filter(|op| matches!(op, DrawOp::ClipPath { .. }))
                .count(),
            2,
            "画幅裁剪 + 遮罩裁剪"
        );
        assert!(!frame.ops.iter().any(|op| matches!(op, DrawOp::PushMatte)));
    }

    #[test]
    fn a_translucent_mask_falls_back_to_the_matte_layer() {
        let mut doc = base(json!([square_shape(solid_fill())]));
        doc["layers"][0]["masksProperties"] = json!([{
            "mode": "a", "o": {"a": 0, "k": 40},
            "pt": {"a": 0, "k": {"v": [[0, 0], [10, 0], [10, 10]],
                                 "i": [[0, 0], [0, 0], [0, 0]],
                                 "o": [[0, 0], [0, 0], [0, 0]], "c": true}}
        }]);
        let frame = lower(doc, 0.0);
        assert!(frame.ops.iter().any(|op| matches!(op, DrawOp::PushMatte)));
        assert!(frame.paints.iter().any(|paint| matches!(
            paint,
            PaintData::Solid(c) if (c[3] - 0.4).abs() < 1e-6
        )));
    }

    #[test]
    fn a_precomp_layer_clips_to_its_own_size_and_remaps_time() {
        let doc = json!({"v": "5.7.0", "fr": 10, "ip": 0, "op": 10, "w": 100, "h": 100,
            "assets": [{"id": "c", "layers": [square_shape(solid_fill())]}],
            "layers": [{"ty": 0, "ind": 1, "refId": "c", "w": 60, "h": 60,
                        "ip": 0, "op": 10, "st": 0, "sr": 1, "ks": {}}]});
        let frame = lower(doc, 0.0);
        assert_eq!(
            frame
                .ops
                .iter()
                .filter(|op| matches!(op, DrawOp::ClipPath { .. }))
                .count(),
            2,
            "根画幅 + 预合成画幅"
        );
        assert!(
            frame
                .ops
                .iter()
                .any(|op| matches!(op, DrawOp::FillPathPaint { .. }))
        );
    }

    #[test]
    fn a_gradient_fill_lowers_to_a_gradient_paint() {
        let gradient = json!({"ty": "gf", "t": 1,
            "s": {"a": 0, "k": [0, 0]}, "e": {"a": 0, "k": [100, 0]},
            "o": {"a": 0, "k": 100},
            "g": {"p": 2, "k": {"a": 0, "k": [0, 1, 0, 0, 1, 0, 0, 1]}}});
        let frame = lower(base(json!([square_shape(gradient)])), 0.0);
        match &frame.paints[0] {
            PaintData::Linear { p0, p1, stops } => {
                assert_eq!(*p0, [0.0, 0.0]);
                assert_eq!(*p1, [100.0, 0.0]);
                assert_eq!(stops.len(), 2);
                assert_eq!(stops[0].color, [1.0, 0.0, 0.0, 1.0]);
                assert_eq!(stops[1].color, [0.0, 0.0, 1.0, 1.0]);
            }
            other => panic!("期望线性渐变，实际 {other:?}"),
        }
    }

    #[test]
    fn gradient_alpha_stops_merge_into_the_colour_stop_list() {
        let gradient = json!({"ty": "gf", "t": 1,
            "s": {"a": 0, "k": [0, 0]}, "e": {"a": 0, "k": [100, 0]},
            "o": {"a": 0, "k": 100},
            "g": {"p": 2, "k": {"a": 0, "k": [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0.5, 0, 1, 1]}}});
        let frame = lower(base(json!([square_shape(gradient)])), 0.0);
        let PaintData::Linear { stops, .. } = &frame.paints[0] else {
            panic!("期望线性渐变");
        };
        assert_eq!(stops.len(), 3, "两个颜色标 + 中间那个透明标");
        assert!((stops[1].offset - 0.5).abs() < 1e-6);
        assert_eq!(stops[1].color[3], 0.0);
    }

    #[test]
    fn lowering_the_same_frame_twice_gives_identical_bytes() {
        let doc = base(json!([square_shape(solid_fill())]));
        let a = crate::drawop::encode(&lower(doc.clone(), 3.0));
        let b = crate::drawop::encode(&lower(doc, 3.0));
        assert_eq!(a, b);
    }
}
