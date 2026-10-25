//! 分屏段的接缝要用的时间（视频格式规范 §5.6「Studio 样式在分屏段的摆放」）：一份字幕在自己的时钟上哪里显示得出来、
//! 哪几段画面是分屏的、各段的格子。字幕计划拿它决定一句挂不挂到接缝，帧计划本身不用。

use std::collections::HashMap;

use editor_semantics::{Ratio, TimeMap, map_time};
use video_model::{CompositionSource, Sequence, TimelineItem, Track};

use crate::{PlanError, TrackRules, audio_bounds, checked_fps, span_bounds};

/// 一份字幕时钟上的分屏画面，单位秒。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CaptionPanelTimes {
    /// 字幕显示得出来的区间：序列时钟是字幕实例的区间，源素材时钟是各作用实例在这段区间里取用的源。
    pub shown: Vec<(f64, f64)>,
    /// 分屏的画面：区间与这段的格子（画布百分比的 `[x, y, w, h]`）。
    pub windows: Vec<(f64, f64, Vec<[f64; 4]>)>,
}

/// 字幕实例 `caption_id` 时钟上的分屏画面；序列里没有起作用的分屏时 `None`。`source_asset` 给了就是源素材时钟：
/// 只看取用这个素材的作用实例，时间经它们的时间映射换回源秒。分屏的视频要启用、所在轨道可见（同画面上画不画）。
pub fn caption_panel_times(
    sequence: &Sequence,
    caption_id: &str,
    source_asset: Option<&str>,
) -> Result<Option<CaptionPanelTimes>, PlanError> {
    let fps = checked_fps(sequence)?;
    let rules = TrackRules::new(&sequence.tracks);
    let tracks: HashMap<&str, &Track> = sequence.tracks.iter().map(|track| (track.id.as_str(), track)).collect();
    let mut panelled: Vec<(Ratio, Ratio, Vec<[f64; 4]>)> = Vec::new();
    for item in &sequence.items {
        let TimelineItem::Video(video) = item else { continue };
        let Some(panels) = video.active_panels() else { continue };
        let shown = video.base.enabled && tracks.get(video.base.track_id.as_str()).is_some_and(|track| rules.visible(track));
        if !shown {
            continue;
        }
        let (start, end) = span_bounds(video.span, fps)?;
        panelled.push((
            start,
            end,
            panels.iter().map(|p| [p.rect.x, p.rect.y, p.rect.w, p.rect.h]).collect(),
        ));
    }
    if panelled.is_empty() {
        return Ok(None);
    }
    let items: HashMap<&str, &TimelineItem> = sequence.items.iter().map(|item| (item.base().id.as_str(), item)).collect();
    let Some(TimelineItem::Caption(caption)) = items.get(caption_id) else {
        return Ok(None);
    };
    let (from, to) = span_bounds(caption.span, fps)?;
    let Some(asset) = source_asset else {
        return Ok(Some(CaptionPanelTimes {
            shown: vec![(from.to_f64(), to.to_f64())],
            windows: panelled.into_iter().map(|(a, b, rects)| (a.to_f64(), b.to_f64(), rects)).collect(),
        }));
    };
    let mut times = CaptionPanelTimes::default();
    for id in &caption.scope_item_ids {
        let (asset_id, time_map, (start, end)): (&str, &TimeMap, (Ratio, Ratio)) = match items.get(id.as_str()) {
            Some(TimelineItem::Video(v)) => (&v.asset_ref.id, &v.time_map, span_bounds(v.span, fps)?),
            Some(TimelineItem::Composition(c)) => {
                let CompositionSource::Bundle { asset_ref } = &c.source;
                (
                    &c.prerender.as_ref().unwrap_or(asset_ref).id,
                    &c.time_map,
                    span_bounds(c.span, fps)?,
                )
            }
            Some(TimelineItem::Audio(a)) => (&a.asset_ref.id, &a.time_map, audio_bounds(a, fps)?),
            _ => continue,
        };
        if asset_id != asset {
            continue;
        }
        let source = |a: Ratio, b: Ratio| -> Result<(f64, f64), PlanError> {
            let (x, y) = (map_time(time_map, start, a)?.to_f64(), map_time(time_map, start, b)?.to_f64());
            Ok((x.min(y), x.max(y)))
        };
        let (a, b) = (start.max(from), end.min(to));
        if a >= b {
            continue;
        }
        times.shown.push(source(a, b)?);
        for (pa, pb, rects) in &panelled {
            let (wa, wb) = (a.max(*pa), b.min(*pb));
            if wa < wb {
                let (x, y) = source(wa, wb)?;
                times.windows.push((x, y, rects.clone()));
            }
        }
    }
    Ok(Some(times))
}
