//! 解码端交付尺寸：铺满画布的视频比画布大时，让解码器直接交画面里要的尺寸（架构设计 §9.11「画面」）。
//!
//! 帧光栅把铺满的视频先按 `fit` 画进一张画布大小的局部画面，再叠上姿态与转场；4K 素材进 1080p 画布，每帧都要
//! 在 CPU 上整幅重采样一次。这里按同一条 `fit` 算式算出源在画布里的尺寸，交给 [`media_core::decode::VideoDecoder`]：
//! 原生解码（AVFoundation / Media Foundation）在解码链路里缩，ffmpeg 回落用 `scale` 滤镜缩，帧光栅收到的源
//! 已经是画布里的尺寸，`contain` 且宽高比吻合时正好走恒等直通。
//!
//! 只缩小、不放大；绑定边恰为画布的边，另一条边按比例取整到偶数（`cover` 向上取整，不小于画布），这样帧光栅
//! 算出的 `fit` 缩放恰为 1，剩下的只是整数偏移的贴图。有裁剪（在 `fit` 之前生效）或效果（效果的长度按画布算、
//! 作用在源像素上，源分辨率一变画面就不同）的实例不缩，仍交源尺寸；全零的裁剪与空的效果对象按没有算。

use video_model::{Fit, TimelineItem, VisualMode};

/// 视频实例在 `canvas` 里的交付尺寸；不缩时 `None`（交源尺寸）。`source` 是摆正后的源尺寸。
pub fn delivery_size(item: &TimelineItem, source: (u32, u32), canvas: (u32, u32)) -> Option<(u32, u32)> {
    let TimelineItem::Video(video) = item else {
        return None;
    };
    // 裁剪与效果的「有」与帧光栅同一个判法：全零的裁剪、空的效果对象都等于没有。
    let cropped = video.crop.as_ref().is_some_and(|crop| crop.is_valid() && !crop.is_empty());
    let effects = video.media.fx.as_ref().is_some_and(|fx| !fx.is_empty());
    if video.media.mode() != VisualMode::Fullscreen || cropped || effects {
        return None;
    }
    fitted_size(video.media.fit(), source, canvas)
}

/// 源按 `fit` 放进画布之后的尺寸，只在两条边都不放大时给；与源相同时 `None`。
pub fn fitted_size(fit: Fit, source: (u32, u32), canvas: (u32, u32)) -> Option<(u32, u32)> {
    let (sw, sh) = (f64::from(source.0), f64::from(source.1));
    let (cw, ch) = (f64::from(canvas.0), f64::from(canvas.1));
    if source.0 == 0 || source.1 == 0 || canvas.0 == 0 || canvas.1 == 0 {
        return None;
    }
    let (scale_w, scale_h) = (cw / sw, ch / sh);
    // 宽先到位（contain 里宽是绑定边，cover 里高是）还是高先到位。
    let width_binds = match fit {
        Fit::Contain => scale_w <= scale_h,
        Fit::Cover => scale_w >= scale_h,
    };
    let scale = if width_binds { scale_w } else { scale_h };
    if scale >= 1.0 {
        return None;
    }
    // 非绑定边按比例取整到偶数：contain 向下（不超过画布），cover 向上（不小于画布）。
    let even = |value: f64| match fit {
        Fit::Contain => (value / 2.0).floor() as u32 * 2,
        Fit::Cover => (value / 2.0).ceil() as u32 * 2,
    };
    let size = if width_binds {
        (canvas.0, even(sh * scale).clamp(2, source.1))
    } else {
        (even(sw * scale).clamp(2, source.0), canvas.1)
    };
    (size != source).then_some(size)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANVAS: (u32, u32) = (1920, 1080);

    #[test]
    fn contain_downscales_to_the_canvas_when_the_aspect_matches() {
        assert_eq!(fitted_size(Fit::Contain, (3840, 2160), CANVAS), Some((1920, 1080)));
        assert_eq!(fitted_size(Fit::Cover, (3840, 2160), CANVAS), Some((1920, 1080)));
    }

    #[test]
    fn contain_binds_the_tighter_edge_and_rounds_the_other_down_to_even() {
        // 竖屏 4K：高绑定，宽 2160 × (1080 / 3840) = 607.5 → 606。
        assert_eq!(fitted_size(Fit::Contain, (2160, 3840), CANVAS), Some((606, 1080)));
        // 超宽：宽绑定，高 1600 × 0.5 = 800。
        assert_eq!(fitted_size(Fit::Contain, (3840, 1600), CANVAS), Some((1920, 800)));
        // 4096×2160：宽绑定，高 2160 × (1920 / 4096) = 1012.5 → 1012。
        assert_eq!(fitted_size(Fit::Contain, (4096, 2160), CANVAS), Some((1920, 1012)));
    }

    #[test]
    fn cover_binds_the_looser_edge_and_rounds_the_other_up_to_even() {
        // 竖屏 4K 盖满：宽绑定，高 3840 × (1920 / 2160) = 3413.3 → 3414。
        assert_eq!(fitted_size(Fit::Cover, (2160, 3840), CANVAS), Some((1920, 3414)));
        // 超宽盖满：高绑定，宽 3840 × (1080 / 1600) = 2592。
        assert_eq!(fitted_size(Fit::Cover, (3840, 1600), CANVAS), Some((2592, 1080)));
        // 4096×2160 盖满：高绑定，宽 4096 × 0.5 = 2048。
        assert_eq!(fitted_size(Fit::Cover, (4096, 2160), CANVAS), Some((2048, 1080)));
    }

    #[test]
    fn never_upscales_or_touches_sources_that_already_fit() {
        assert_eq!(fitted_size(Fit::Contain, (1920, 1080), CANVAS), None);
        assert_eq!(fitted_size(Fit::Contain, (1280, 720), CANVAS), None);
        assert_eq!(fitted_size(Fit::Cover, (1280, 720), CANVAS), None);
        // 一边比画布大、另一边不大：contain 要缩，cover 得放大所以不动。
        assert_eq!(fitted_size(Fit::Contain, (3840, 1000), CANVAS), Some((1920, 500)));
        assert_eq!(fitted_size(Fit::Cover, (3840, 1000), CANVAS), None);
        assert_eq!(fitted_size(Fit::Contain, (0, 0), CANVAS), None);
    }

    #[test]
    fn fitted_size_keeps_the_fit_scale_at_one() {
        // 帧光栅会按交付尺寸再算一次 fit 的缩放：绑定边恰为画布，另一边不越过画布，缩放恰为 1。
        for (fit, source) in [
            (Fit::Contain, (2160, 3840)),
            (Fit::Contain, (4096, 2160)),
            (Fit::Cover, (2160, 3840)),
            (Fit::Cover, (3840, 1600)),
        ] {
            let (w, h) = fitted_size(fit, source, CANVAS).unwrap();
            let (sw, sh) = (f64::from(w), f64::from(h));
            let (cw, ch) = (f64::from(CANVAS.0), f64::from(CANVAS.1));
            let scale = match fit {
                Fit::Contain => (cw / sw).min(ch / sh),
                Fit::Cover => (cw / sw).max(ch / sh),
            };
            assert_eq!(scale, 1.0, "{fit:?} {source:?} → {w}×{h}");
        }
    }

    fn video(json: serde_json::Value) -> TimelineItem {
        serde_json::from_value(json).unwrap()
    }

    fn item(extra: serde_json::Value) -> TimelineItem {
        let mut value = serde_json::json!({
            "id": "clip", "type": "video", "trackId": "t", "enabled": true, "locked": false, "paintOrder": 0,
            "assetRef": { "id": "a", "revision": "r" },
            "embeddedAudio": { "enabled": false, "volume": 1 },
            "mode": "fullscreen", "fit": "contain", "place": {},
            "span": { "fromFrame": 0, "durationFrames": 30 },
            "timeMap": { "kind": "linear", "rate": { "num": 1, "den": 1 }, "sourceIn": { "ticks": "0", "timescale": 1 } }
        });
        for (key, v) in extra.as_object().unwrap() {
            value[key] = v.clone();
        }
        video(value)
    }

    #[test]
    fn only_plain_fullscreen_videos_are_delivered_smaller() {
        let source = (3840, 2160);
        assert_eq!(delivery_size(&item(serde_json::json!({})), source, CANVAS), Some((1920, 1080)));
        assert_eq!(
            delivery_size(&item(serde_json::json!({ "fit": "cover" })), source, CANVAS),
            Some((1920, 1080))
        );
        assert_eq!(delivery_size(&item(serde_json::json!({ "mode": "pip" })), source, CANVAS), None);
        assert_eq!(
            delivery_size(
                &item(serde_json::json!({ "crop": { "left": 0.1, "top": 0.0, "right": 0.0, "bottom": 0.0 } })),
                source,
                CANVAS
            ),
            None
        );
        assert_eq!(
            delivery_size(&item(serde_json::json!({ "fx": { "blur": 4.0 } })), source, CANVAS),
            None
        );
        assert_eq!(delivery_size(&item(serde_json::json!({})), (1920, 1080), CANVAS), None);
        // 全零的裁剪与空的效果对象等于没有（与帧光栅的 `crop_of` / `Fx::is_empty` 一致）。
        let empty = serde_json::json!({ "crop": { "left": 0.0, "top": 0.0, "right": 0.0, "bottom": 0.0 }, "fx": {} });
        assert_eq!(delivery_size(&item(empty), source, CANVAS), Some((1920, 1080)));
    }
}
