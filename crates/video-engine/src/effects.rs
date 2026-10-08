//! 效果（视频格式规范 §3.8）与裁剪（§3.5）。
//!
//! 效果是 v2 的 `fx`：一组固定字段，按固定顺序作用。`setEffects` 整个替换；字段的取值区间由
//! `elements::check_item` 交给 `timeline` 校验。

use serde_json::json;

use crate::error::{EngineResult, ErrorBody, msg};
use crate::model::*;
use crate::ops::{editable_item, not_applicable};
use crate::state::VideoState;

/// 整个替换实例的 `fx`。`None` 或全空的 `fx` 去掉效果。
pub(crate) fn set_effects(state: &mut VideoState, sequence_id: Option<&str>, item_id: &str, fx: Option<&Fx>) -> EngineResult<()> {
    let item = editable_item(state, sequence_id, item_id)?;
    let slot = item
        .fx_mut()
        .ok_or_else(|| not_applicable(
            item_id,
            msg!("engine.effectsNotVisual", "is not visual media or a composition, so it cannot have effects"),
        ))?;
    *slot = fx.filter(|fx| !fx.is_empty()).cloned();
    crate::elements::check_item(state, item_id)
}

pub(crate) fn check_crop(item_id: &str, crop: &Crop) -> EngineResult<()> {
    if !crop.is_valid() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.cropRange",
            "Each crop edge must be within [0, 1), and left + right and top + bottom must each be less than 1"
        ))
            .entities([item_id])
            .details(json!({ "crop": crop })));
    }
    Ok(())
}

/// `setStyle` 的 `crop`：`null` 去掉，四边都是 0 也等于去掉。只有视频与图片能裁。
pub(crate) fn apply_crop(item: &mut TimelineItem, item_id: &str, crop: Option<&Crop>) -> EngineResult<()> {
    if let Some(c) = crop {
        check_crop(item_id, c)?;
    }
    let slot = match item {
        TimelineItem::Video(v) => &mut v.crop,
        TimelineItem::Image(i) => &mut i.crop,
        _ => return Err(not_applicable(item_id, msg!("engine.cropNotVideoOrImage", "is not a video or image, so it cannot be cropped"))),
    };
    *slot = crop.filter(|c| !c.is_empty()).cloned();
    Ok(())
}
