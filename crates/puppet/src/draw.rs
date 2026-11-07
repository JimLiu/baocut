//! 按 LivLiv `Puppet.render` 的顺序画一帧：说话时嘴画在最后一张表情上面，表情说话时换无嘴版，重画了眉毛的表情
//! 让中性眉毛淡出，闭眼的睫毛只在眨眼最后一段出现，眼珠被眼白裁，表情画的眉毛紧跟在最后一层眉毛之后。表情自己的
//! 眼睛（`expr_eye_L` `expr_eye_R`，BaoCut 的扩展）和中性的眼睛一样眨：底下先画这一边的闭眼层，再画压扁的眼睛。

use crate::raster::{self, Coverage, Frame, Paint, View};
use crate::rig::{Layer, Puppet};
use crate::smooth;

/// 睁开不到这么多，眼睛（眼白、眼珠、高光）就不画了，只剩闭眼层（格式规范 §5）。
pub(crate) const EYE_SHUT: f64 = 0.08;

/// 眼睛这几层的不透明度：一直不透明，睁开不到 [`EYE_SHUT`] 时直接换成闭眼层（此时它已不透明到 0.97）。LivLiv
/// 在睁开 0.2 到 0.02 之间让眼睛淡出、闭眼层淡入，快闭上的那一两帧是半透明的眼睛叠在半透明的睫毛上，一条灰带；
/// 一直压扁到很薄再换又是一条横线，对不上闭眼的睫毛弧线。
fn eye_alpha(open: f64) -> f64 {
    if open >= EYE_SHUT { 1.0 } else { 0.0 }
}

impl Puppet {
    /// 把当前的形变画进 `w`×`h` 的预乘 RGBA8 缓冲（先清成透明）。角色按画布等比缩放、居中，再按 `moveX` `moveY`
    /// 平移（缓冲的底边就是看得见的画面的底边）。
    ///
    /// 调用前要先 [`Puppet::update`]（`mesh: true`）。`out` 的长度必须是 `w * h * 4`。
    pub fn render(&self, w: u32, h: u32, out: &mut [u8]) {
        self.render_shifted(w, h, self.shift(w, h, f64::from(h)), out);
    }

    /// `moveX` `moveY` 在 `w`×`h` 的缓冲里是多少像素的平移（x 向右、y 向下）。下沿切在画布底边的角色（半身）往上最多
    /// 走到切口齐着看得见的画面底边，切边不会露出来（LivLiv 的 cutBottom：自动的动作不比摆放时多露切边）。
    /// `frame_bottom` 是看得见的画面的底边落在缓冲的第几行：缓冲画进一个伸出画面的框时比 `h` 小，框整个在画面里时
    /// 比 `h` 大（这时切口本来就看得见，只往下）。格式规范 §3。
    pub fn shift(&self, w: u32, h: u32, frame_bottom: f64) -> [f64; 2] {
        let (s, _, oy) = self.fit(w, h);
        let mh = f64::from(self.model.canvas[1]);
        let cut = self.model.anchors.bottom_y >= mh - 4.0;
        let room = if frame_bottom.is_finite() { (oy + mh * s - frame_bottom).max(0.0) / f64::from(h) } else { 0.0 };
        let up = if cut { self.params.move_y.min(room) } else { self.params.move_y };
        [self.params.move_x * f64::from(w), -up * f64::from(h)]
    }

    /// 同 [`Puppet::render`]，但平移由宿主给（缓冲像素）：宿主把一部分平移拿去挪整张缓冲（角色贴纸挪框，跳起来
    /// 不会被框切掉头顶），剩下的交给这里。
    pub fn render_shifted(&self, w: u32, h: u32, shift: [f64; 2], out: &mut [u8]) {
        let (w, h) = (w as usize, h as usize);
        assert_eq!(out.len(), w * h * 4, "render buffer has the wrong size");
        out.fill(0);
        let (s, ox, oy) = self.fit(w as u32, h as u32);
        let view = View { s, ox: ox + shift[0], oy: oy + shift[1] };
        let mut frame = Frame { w, h, px: out };
        let p = &self.params;
        let layers = &self.layers;
        // 眼白的覆盖：画到眼睛那一层时算一次，它的眼珠、高光用
        let mut covers: Vec<Option<Coverage>> = layers.iter().map(|_| None).collect();
        let draw =
            |frame: &mut Frame, l: &Layer, tex: &crate::Texture, alpha: f64, verts: Option<&[f32]>, mask: Option<(&Coverage, f32)>| {
                let paint = Paint {
                    tex,
                    alpha: alpha as f32,
                    mask,
                };
                raster::draw(frame, view, verts.unwrap_or(&l.out), &l.mesh.uv, &l.mesh.tri, &l.mesh.aa, &paint);
            };
        let draw_mouth = |frame: &mut Frame, l: &Layer| {
            // 一帧、不透明（stepMouth 负责换帧）；一帧之内开口随 mouthOpen 再往下拉一点
            let m = p.mouth_open.clamp(0.0, 1.0);
            let f = self.mouth_frame.min(l.frames.len() - 1);
            let py = l.def.pivot.map_or(l.def.y, |v| v[1]);
            let half = self.frame_kind.get(f).is_some_and(|k| k == "half");
            let k = if half {
                0.88 + 0.12 * self.frame_ease(f, m)
            } else {
                0.9 + 0.1 * self.frame_ease(f, m)
            };
            if f > 0 && Some(f) != self.vis.shut {
                // 嘴的拉伸越靠近下巴越弱：那里下巴接手（chinFollow），帧里画的下巴留在脸的下巴上
                let mut verts = l.out.clone();
                for i in 0..verts.len() / 2 {
                    let fade = 1.0 - f64::from(l.mesh.w_jaw[i]);
                    let dy = (f64::from(l.mesh.rest[2 * i + 1]) - py) * (k - 1.0) * fade;
                    verts[2 * i + 1] = (f64::from(verts[2 * i + 1]) + dy) as f32;
                }
                draw(frame, l, &l.frames[f], 1.0, Some(&verts), None);
            } else {
                draw(frame, l, &l.frames[f], 1.0, None, None);
            }
        };
        // 说话时嘴画在表情层上面：每张表情补丁都有自己不动的嘴
        let last_expr = if self.talk_left > 0.0 {
            layers.iter().rposition(|l| l.def.role() == "expr")
        } else {
            None
        };
        let last_brow = layers.iter().rposition(|l| l.def.id == "brows" || l.def.role() == "expr_brows");
        let mut new_brows = last_brow.is_none();
        let draw_new_brows = |frame: &mut Frame| {
            for e in layers {
                if let (Some(bt), "expr") = (e.brow_tex.as_deref(), e.def.role()) {
                    let a = self.expr_alpha(&e.def);
                    if a > 0.01 {
                        draw(frame, e, bt, a, e.out_b.as_deref(), None);
                    }
                }
            }
        };
        let mut deferred: Option<&Layer> = None;
        for (li, l) in layers.iter().enumerate() {
            let d = &l.def;
            let role = d.role();
            if let Some(dl) = deferred
                && last_expr.is_none_or(|le| li > le)
            {
                draw_mouth(&mut frame, dl);
                deferred = None;
            }
            if !new_brows && last_brow.is_some_and(|lb| li > lb) {
                new_brows = true;
                draw_new_brows(&mut frame);
            }
            if matches!(role, "hole" | "edge" | "edge_wide") {
                continue;
            }
            if role == "mouth" && l.frames.len() >= 3 {
                if last_expr.is_some_and(|le| li < le) {
                    deferred = Some(l);
                } else {
                    draw_mouth(&mut frame, l);
                }
                continue;
            }
            if role == "expr" {
                // 说话时用不带嘴的那张：说话的嘴下面是脸的中性皮肤，不是表情的笑
                let a = self.expr_alpha(d);
                if a > 0.01 {
                    let tex = if self.talk_left > 0.0 {
                        l.talk.as_deref().unwrap_or(&l.tex)
                    } else {
                        &l.tex
                    };
                    draw(&mut frame, l, tex, a, None, None);
                }
                continue;
            }
            if let Some(side) = role.strip_prefix("expr_eye_") {
                // 表情自己的眼睛：补丁在这里是光脸，先画这一边的闭眼层（乘表情的不透明度），再画压扁的眼睛
                let a = self.expr_alpha(d);
                let open = if side == "L" { p.eye_l_open } else { p.eye_r_open };
                let lid = format!("lid_{side}");
                if let Some(lid) = layers.iter().find(|e| e.def.role() == lid && e.shown) {
                    let la = (1.0 - smooth(0.05, 0.35, open)) * a;
                    if la > 0.01 {
                        draw(&mut frame, lid, &lid.tex, la, None, None);
                    }
                }
                if a > 0.01 && eye_alpha(open) > 0.0 {
                    draw(&mut frame, l, &l.tex, a, None, None);
                }
                continue;
            }
            if role == "expr_brows" {
                let a = self.expr_alpha(d);
                if a > 0.01 {
                    draw(&mut frame, l, &l.tex, a, None, None);
                }
                continue;
            }
            if d.id == "brows" {
                // 重画了眉毛的表情显示它自己的眉毛：中性眉毛随它淡出
                let mut fade = 0f64;
                for e in layers {
                    if e.def.role() == "expr" && e.def.brows.as_deref() == Some("redrawn") {
                        fade = fade.max(self.expr_alpha(&e.def));
                    }
                }
                if fade < 0.99 {
                    draw(&mut frame, l, &l.tex, 1.0 - fade, None, None);
                }
                continue;
            }
            if let Some(side) = role.strip_prefix("lid_") {
                // 闭眼的睫毛只在眨眼最后一段出现
                let open = if side == "L" { p.eye_l_open } else { p.eye_r_open };
                let a = 1.0 - smooth(0.05, 0.35, open);
                if a > 0.01 {
                    draw(&mut frame, l, &l.tex, a, None, None);
                }
                continue;
            }
            if let Some(side) = role.strip_prefix("eye_") {
                // 压扁，不淡出：淡出会让睫毛有重影，半透明的眼睛叠在闭眼的睫毛上是一条灰带
                let open = if side == "L" { p.eye_l_open } else { p.eye_r_open };
                draw(&mut frame, l, &l.tex, eye_alpha(open), None, None);
                if let Some(mask) = l.mask.as_deref() {
                    covers[li] = Some(raster::coverage(w, h, view, &l.out, &l.mesh.uv, &l.mesh.tri, mask));
                }
                continue;
            }
            if role == "blush" {
                let a = self.blush_alpha(d);
                if a > 0.01 {
                    draw(&mut frame, l, &l.tex, a.min(1.0), None, None);
                }
                continue;
            }
            if role.starts_with("iris_") || role.starts_with("shine_") {
                let Some(pi) = d.clip.as_ref().and_then(|c| self.by_id.get(c)).copied() else {
                    continue;
                };
                let parent = &layers[pi];
                let Some(mask) = parent.mask.as_deref() else { continue };
                if covers[pi].is_none() {
                    covers[pi] = Some(raster::coverage(w, h, view, &parent.out, &parent.mesh.uv, &parent.mesh.tri, mask));
                }
                let open = if role.ends_with("_L") { p.eye_l_open } else { p.eye_r_open };
                let cov = covers[pi].as_ref().map(|c| (c, l.soft as f32));
                draw(&mut frame, l, &l.tex, eye_alpha(open), None, cov);
                continue;
            }
            let ma = if d.show.is_some() || d.hide.is_some() {
                self.mood_alpha(d)
            } else {
                1.0
            };
            if ma > 0.01 {
                draw(&mut frame, l, &l.tex, ma, None, None);
            }
        }
        if let Some(dl) = deferred {
            draw_mouth(&mut frame, dl);
        }
        if !new_brows {
            draw_new_brows(&mut frame);
        }
    }
}

impl Puppet {
    /// 角色在 `w`×`h` 里按画布等比缩放、居中：缩放与左上角。
    fn fit(&self, w: u32, h: u32) -> (f64, f64, f64) {
        let [mw, mh] = self.model.canvas;
        let s = (f64::from(w) / f64::from(mw)).min(f64::from(h) / f64::from(mh));
        (s, (f64::from(w) - f64::from(mw) * s) / 2.0, (f64::from(h) - f64::from(mh) * s) / 2.0)
    }
}
