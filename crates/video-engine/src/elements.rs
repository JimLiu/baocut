//! 写入时的实例校验（视频格式规范 §3.4–§3.9、§3.15、§3.16）。
//!
//! 画面元素的参数取 v2 的元素模型，校验也只有一份：把实例换成 `timeline::schema::Element`，调
//! `Element::validate_fields`（字段的适用范围、`element-props-mismatch`、role 与种类的搭配、三张动画预设表、
//! 取值区间），关键帧与音量包络换成 `timeline::keyframes::Keyframes` 交给它校验。这里只补 v2 没有的部分：
//! 容器（时间、轨道、素材的种类）、合成实例（不是 v2 的种类）、`fx` 里并进来的三种字段、裁剪、跟随策略。

use editor_semantics::{MediaTime, Ratio};
use render_graph::envelope::{envelope_keyframes, envelope_points};
use serde_json::{Value, json};
use timeline::keyframes::{KeyframeCaps, Keyframes, VOLUME_RANGE};
use timeline::schema::{AUDIO_FADE_RANGE, ELEMENT_PROPS_MISMATCH, Element, ElementKind, ElementRole, TimelineError, VERTICAL_ALIGNS};

use crate::error::{EngineResult, ErrorBody, Text, kinds, msg};
use crate::model::*;
use crate::state::VideoState;

/// 文字样式对象的上限（序列化后的字节数）。
pub const MAX_STYLE_BYTES: usize = 64 * 1024;

/// 校验视频里的一个实例（写入之后、事务提交之前调用）。
pub(crate) fn check_item(state: &VideoState, item_id: &str) -> EngineResult<()> {
    let placed = state.items.get(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?;
    let header = &state.sequence(&placed.sequence_id)?.header;
    let item = &placed.value;
    let fail = |message: Text| ErrorBody::invalid_operation(message).entities([item_id]);

    if let Some(span) = item.span()
        && (span.from_frame < 0 || span.duration_frames <= 0)
    {
        return Err(ErrorBody::range_collapsed(
            item_id,
            msg!("engine.itemSpanInvalid", "A clip cannot start before zero and must be at least one frame long"),
        ));
    }
    check_follow(item).map_err(fail)?;
    check_assets(state, item)?;
    check_link_group_sound(state, &placed.sequence_id, item)?;

    let bindings: Vec<&AnimationBinding> = header.animation_bindings.iter().filter(|b| b.target_id == item_id).collect();
    let mut keyframes = bindings_to_timeline(bindings.iter().copied(), header.fps.ratio().to_f64()).map_err(fail)?;
    if !bindings.is_empty() && item.place().is_none() {
        return Err(fail(msg!(
            "engine.keyframesNeedPicture",
            "Clip {item} has no picture, so it cannot have keyframes",
            item = item_id
        )));
    }
    if let Some(envelope) = envelope_points(item) {
        keyframes.volume = Some(envelope_keyframes(envelope).map_err(|e| fail(e.into()))?);
    }

    match item {
        TimelineItem::Caption(_) => Ok(()),
        TimelineItem::Composition(c) => check_composition(item_id, c, keyframes).map_err(fail),
        _ => {
            let element = to_element(item, keyframes);
            element.validate_fields().map_err(|e| timeline_error(item_id, e))?;
            check_v3_fields(item).map_err(fail)
        }
    }
}

/// 音画联动组里的合成与音频（规范 §3.7「声音」）：同一组里的音频实例是合成声音单独放的一份，合成自己的声音（用替身时是
/// 替身的音轨）必须关掉，不得两处同时出声。组只在同一条序列里算；合成的 `audio` 省略或 `enabled: false` 都算关着。
fn check_link_group_sound(state: &VideoState, sequence_id: &str, item: &TimelineItem) -> EngineResult<()> {
    let Some(group) = item.base().link_group_id.as_deref() else {
        return Ok(());
    };
    let mut sounding = Vec::new();
    let mut has_audio = false;
    for placed in state.items.values() {
        if placed.sequence_id != sequence_id || placed.value.base().link_group_id.as_deref() != Some(group) {
            continue;
        }
        match &placed.value {
            TimelineItem::Audio(_) => has_audio = true,
            TimelineItem::Composition(c) if c.audio.as_ref().is_some_and(|a| a.enabled) => sounding.push(c.base.id.clone()),
            _ => {}
        }
    }
    if has_audio && !sounding.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.linkGroupDoubleSound",
            "Link group {group} has an audio clip, so composition {items} must turn its own sound off (audio.enabled: false)",
            group,
            items = sounding.join(", ")
        ))
        .entities(sounding));
    }
    Ok(())
}

/// 去掉目标实例已经不在的关键帧绑定（删除、波纹删除之后）。
pub(crate) fn prune_bindings(state: &mut VideoState) {
    let live: std::collections::BTreeSet<Id> = state.items.keys().cloned().collect();
    for sequence in state.sequences.values_mut() {
        if sequence.header.animation_bindings.iter().any(|b| !live.contains(&b.target_id)) {
            sequence.header.animation_bindings.retain(|b| live.contains(&b.target_id));
        }
    }
}

/// 把 v3 的实例换成 v2 的元素：只用于校验，时间字段不参与（时间是 v3 的容器）。
fn to_element(item: &TimelineItem, keyframes: Keyframes) -> Element {
    let base = item.base();
    let kind = match item {
        TimelineItem::Video(_) => ElementKind::Video,
        TimelineItem::Image(_) => ElementKind::Image,
        TimelineItem::Audio(_) => ElementKind::Audio,
        TimelineItem::Text(_) => ElementKind::Text,
        TimelineItem::Shape(_) => ElementKind::Shape,
        TimelineItem::Sticker(_) => ElementKind::Sticker,
        TimelineItem::Visualizer(_) => ElementKind::Visualizer,
        TimelineItem::Progress(_) => ElementKind::Progress,
        TimelineItem::Draw(_) => ElementKind::Draw,
        TimelineItem::Placeholder(_) => ElementKind::Placeholder,
        TimelineItem::Confetti(_) => ElementKind::Confetti,
        TimelineItem::Whiteboard(_) => ElementKind::Whiteboard,
        TimelineItem::Composition(_) | TimelineItem::Caption(_) => unreachable!("不是 v2 的元素种类"),
    };
    // 五个校验搭配的 role 交给 v2；其余是开放词表，照常保留。
    let role = base
        .role
        .as_deref()
        .and_then(|r| serde_json::from_value::<ElementRole>(Value::String(r.to_string())).ok());
    let media = item.media();
    let (volume, fade_in, fade_out) = match item {
        TimelineItem::Audio(a) => (Some(a.mix.volume), a.mix.fade_in.as_ref(), a.mix.fade_out.as_ref()),
        TimelineItem::Video(v) => (
            Some(v.embedded_audio.volume),
            v.embedded_audio.fade_in.as_ref(),
            v.embedded_audio.fade_out.as_ref(),
        ),
        _ => (None, None, None),
    };
    let mut element = Element {
        id: base.id.clone(),
        kind,
        name: None,
        role,
        start: None,
        end: None,
        place: item.place().map(Place::to_timeline),
        vertical_align: None,
        src_id: item.asset_ref().map(|r| r.id.clone()),
        src_start: None,
        rate: None,
        muted: None,
        volume,
        audio_fade_in: fade_in.map(seconds),
        audio_fade_out: fade_out.map(seconds),
        bcf_clip: None,
        mode: media.and_then(|m| m.mode),
        fit: media.and_then(|m| m.fit),
        bg: media.and_then(|m| m.bg),
        text: None,
        style: None,
        style_preset_id: None,
        tile: None,
        mask: media.and_then(|m| m.mask.as_ref()).map(Mask::to_timeline),
        fx: media.and_then(|m| m.fx.as_ref()).map(Fx::to_timeline),
        animate: item.animate().map(Animation::to_timeline),
        transitions: None,
        keyframes: (!keyframes.is_empty()).then_some(keyframes),
        duck: None,
        source: None,
        html: None,
        ai: base.ai.clone(),
        counter: None,
        shape: None,
        sticker: None,
        visualizer: None,
        progress: None,
        draw: None,
        placeholder: None,
        confetti: None,
        whiteboard: None,
        hidden: false,
    };
    match item {
        TimelineItem::Image(i) => {
            element.tile = i.tile.as_ref().map(Tile::to_timeline);
            element.source = i.source.clone();
            element.html = i.html.clone();
        }
        TimelineItem::Text(t) => {
            element.text = t.text.clone();
            element.counter = t.counter.clone();
            element.style = t.style.clone();
            element.style_preset_id = t.style_preset_id.clone();
            element.vertical_align = t.vertical_align.clone();
            element.tile = t.tile.as_ref().map(Tile::to_timeline);
        }
        TimelineItem::Shape(s) => element.shape = Some(s.shape.clone()),
        TimelineItem::Sticker(s) => element.sticker = Some(s.sticker.clone()),
        TimelineItem::Visualizer(v) => element.visualizer = Some(v.visualizer.clone()),
        TimelineItem::Progress(p) => element.progress = Some(p.progress.clone()),
        TimelineItem::Draw(d) => element.draw = Some(d.draw.clone()),
        TimelineItem::Placeholder(p) => element.placeholder = Some(p.placeholder.clone()),
        TimelineItem::Confetti(c) => element.confetti = Some(c.confetti.clone()),
        TimelineItem::Whiteboard(w) => element.whiteboard = Some(w.whiteboard.clone()),
        _ => {}
    }
    element
}

/// v2 没有、v3 要求的字段规则。
fn check_v3_fields(item: &TimelineItem) -> Result<(), Text> {
    if let Some(fx) = item.fx() {
        fx.check_v3_fields()?;
    }
    if let Some(place) = item.place() {
        check_place(place)?;
    }
    check_mask(item.media().and_then(|m| m.mask.as_ref()))?;
    match item {
        TimelineItem::Video(VideoItem { crop: Some(c), .. }) | TimelineItem::Image(ImageItem { crop: Some(c), .. }) if !c.is_valid() => {
            return Err(msg!(
                "engine.cropRange",
                "Each crop edge must be within [0, 1), and left + right and top + bottom must each be less than 1"
            ));
        }
        TimelineItem::Text(t) => {
            if let Some(style) = &t.style {
                if !style.is_object() {
                    return Err(msg!("engine.textStyleNotObject", "The text style must be an object"));
                }
                if serde_json::to_vec(style).map_or(true, |bytes| bytes.len() > MAX_STYLE_BYTES) {
                    return Err(msg!("engine.textStyleTooLarge", "The text style cannot exceed 64 KiB"));
                }
            }
            if let Some(align) = &t.vertical_align
                && !VERTICAL_ALIGNS.contains(&align.as_str())
            {
                return Err(msg!("engine.verticalAlignInvalid", "verticalAlign must be top, center or bottom: {value}", value = align.to_string()));
            }
        }
        TimelineItem::Sticker(s) => {
            if s.is_asset() != s.asset_ref.is_some() {
                return Err(msg!(
                    "engine.stickerAssetRef",
                    "An asset sticker must have assetRef, and a template sticker cannot"
                ));
            }
            if !s.is_asset() && !s.media.is_empty() {
                return Err(msg!("engine.stickerMediaFields", "mode, fit, bg, mask and fx are only for asset stickers"));
            }
        }
        TimelineItem::Audio(a) => check_volume_and_fades(a.mix.volume, a.mix.fade_in.as_ref(), a.mix.fade_out.as_ref())?,
        TimelineItem::Video(v) => {
            let audio = &v.embedded_audio;
            check_volume_and_fades(audio.volume, audio.fade_in.as_ref(), audio.fade_out.as_ref())?;
        }
        _ => {}
    }
    Ok(())
}

/// 合成不是 v2 的种类：几何、动画、效果与遮罩分别交给 `timeline` 的同名类型校验。
fn check_composition(item_id: &str, c: &CompositionItem, keyframes: Keyframes) -> Result<(), Text> {
    let text = |e: TimelineError| Text::plain(e.to_string());
    c.place.to_timeline().validate(item_id).map_err(text)?;
    check_place(&c.place)?;
    check_mask(c.mask.as_ref())?;
    if let Some(animate) = &c.animate {
        animate.to_timeline().validate(item_id).map_err(text)?;
        let text_only = [animate.enter.as_ref(), animate.exit.as_ref()]
            .into_iter()
            .flatten()
            .any(|slot| matches!(slot.preset.as_str(), "typewriter" | "riseWords"));
        if text_only {
            return Err(msg!(
                "engine.textOnlyAnimation",
                "typewriter and riseWords on clip {item} only apply to text",
                item = item_id
            ));
        }
    }
    if let Some(fx) = &c.fx {
        fx.to_timeline().validate(item_id).map_err(text)?;
        fx.check_v3_fields()?;
    }
    // 圆角关键帧只用于视觉媒体（§3.15），合成没有。
    let caps = KeyframeCaps {
        transform: true,
        radius: false,
        volume: c.audio.is_some(),
    };
    if !keyframes.is_empty() {
        keyframes.validate(item_id, caps).map_err(text)?;
    }
    if let Some(audio) = &c.audio {
        check_volume_and_fades(audio.volume, audio.fade_in.as_ref(), audio.fade_out.as_ref())?;
    }
    if !c.parameter_values.is_object() {
        return Err(msg!("engine.parameterValuesNotObject", "parameterValues must be an object"));
    }
    Ok(())
}

/// 规范的取值区间比 v2 严：`place.opacity` 在 [0, 1]（§3.5；v2 只要求有限）。
fn check_place(place: &Place) -> Result<(), Text> {
    if let Some(opacity) = place.opacity
        && !(0.0..=1.0).contains(&opacity)
    {
        return Err(msg!("engine.opacityRange", "place.opacity must be within [0, 1]: {opacity}", opacity));
    }
    Ok(())
}

/// 遮罩羽化是 540 短边下的像素，≥ 0（§3.9；v2 不查）。
fn check_mask(mask: Option<&Mask>) -> Result<(), Text> {
    if let Some(feather) = mask.and_then(|m| m.feather)
        && !(feather.is_finite() && feather >= 0.0)
    {
        return Err(msg!("engine.featherInvalid", "mask.feather must be a finite number of at least 0: {feather}", feather));
    }
    Ok(())
}

fn check_volume_and_fades(volume: f64, fade_in: Option<&MediaTime>, fade_out: Option<&MediaTime>) -> Result<(), Text> {
    let (lo, hi) = VOLUME_RANGE;
    if !volume.is_finite() || !(lo..=hi).contains(&volume) {
        return Err(msg!("engine.volumeRange", "Volume must be between {lo}× and {hi}×", lo, hi));
    }
    let (lo, hi) = AUDIO_FADE_RANGE;
    for (name, fade) in [("fadeIn", fade_in), ("fadeOut", fade_out)] {
        if let Some(t) = fade {
            let s = seconds(t);
            if !(lo..=hi).contains(&s) {
                return Err(msg!("engine.secondsRange", "{field} must be between {lo} and {hi} seconds", field = name, lo, hi));
            }
        }
    }
    Ok(())
}

/// 跟随策略的写法（§3.16）。锚点的求值随编辑语义接上；这里只查形状。
fn check_follow(item: &TimelineItem) -> Result<(), Text> {
    let base = item.base();
    match &base.follow_policy {
        FollowPolicy::SpeechAnchor { start, end } => {
            if start.is_none() && end.is_none() {
                return Err(msg!("engine.speechAnchorEmpty", "speech-anchor needs a start or an end anchor"));
            }
            if end.is_some() && base.until_sequence_end {
                return Err(msg!("engine.speechAnchorUntilEnd", "speech-anchor cannot use untilSequenceEnd when it has an end"));
            }
        }
        FollowPolicy::ItemLocal { item_id } if *item_id == base.id => {
            return Err(msg!("engine.itemLocalSelf", "item-local cannot follow itself"));
        }
        _ => {}
    }
    if base.until_sequence_end && item.span().is_none() {
        return Err(msg!("engine.untilSequenceEndKind", "untilSequenceEnd is only for picture and caption clips"));
    }
    Ok(())
}

/// 素材的种类与版本（§3.4、§3.7）。
fn check_assets(state: &VideoState, item: &TimelineItem) -> EngineResult<()> {
    for asset_ref in item.asset_refs() {
        let asset = state
            .assets
            .get(&asset_ref.id)
            .ok_or_else(|| ErrorBody::not_found(kinds::asset(), &asset_ref.id))?;
        if !asset.revisions.contains_key(&asset_ref.revision) {
            return Err(ErrorBody::not_found(kinds::asset_revision(), &asset_ref.revision).entities([asset_ref.id.clone()]));
        }
    }
    let kind_of = |r: &VersionRef| state.assets.get(&r.id).map(|a| a.kind);
    let expect = |r: &VersionRef, allowed: &[AssetKind], what: Text| -> EngineResult<()> {
        match kind_of(r) {
            Some(kind) if allowed.contains(&kind) => Ok(()),
            _ => Err(ErrorBody::invalid_operation(what).entities([r.id.clone()])),
        }
    };
    match item {
        TimelineItem::Video(v) => expect(
            &v.asset_ref,
            &[AssetKind::Video],
            msg!("engine.videoAssetKind", "The asset of a video clip is not a video"),
        ),
        TimelineItem::Image(i) => expect(
            &i.asset_ref,
            &[AssetKind::Image],
            msg!("engine.imageAssetKind", "The asset of an image clip is not an image"),
        ),
        TimelineItem::Audio(a) => expect(
            &a.asset_ref,
            &[AssetKind::Audio, AssetKind::Video],
            msg!("engine.audioAssetKind", "The asset of an audio clip has no sound"),
        ),
        TimelineItem::Sticker(StickerItem { asset_ref: Some(r), .. }) => expect(
            r,
            &[AssetKind::Image, AssetKind::Video, AssetKind::Lottie],
            msg!("engine.stickerAssetKind", "An asset sticker can only use an image, video or Lottie asset"),
        ),
        TimelineItem::Placeholder(PlaceholderItem { asset_ref: Some(r), .. }) => {
            expect(
                r,
                &[AssetKind::Image, AssetKind::Video],
                msg!("engine.placeholderAssetKind", "A placeholder can only be replaced with a video or image asset"),
            )
        }
        TimelineItem::Whiteboard(w) => expect(
            &w.asset_ref,
            &[AssetKind::Image],
            msg!("engine.whiteboardAssetKind", "A whiteboard can only use an image asset"),
        ),
        TimelineItem::Composition(c) => {
            let CompositionSource::Bundle { asset_ref } = &c.source;
            expect(
                asset_ref,
                &[AssetKind::Bundle],
                msg!("engine.compositionAssetKind", "The asset of a composition clip is not a code bundle"),
            )?;
            match &c.prerender {
                Some(r) => expect(
                    r,
                    &[AssetKind::Video],
                    msg!("engine.prerenderAssetKind", "The prerendered stand-in of a composition must be a video asset"),
                ),
                None => Ok(()),
            }
        }
        _ => Ok(()),
    }
}

fn seconds(t: &MediaTime) -> f64 {
    t.to_ratio("time").map(Ratio::to_f64).unwrap_or(f64::NAN)
}

fn timeline_error(item_id: &str, error: TimelineError) -> ErrorBody {
    let message = error.to_string();
    let mut body = ErrorBody::invalid_operation(message.clone()).entities([item_id]);
    if message.contains(ELEMENT_PROPS_MISMATCH) {
        body = body.details(json!({ "rule": ELEMENT_PROPS_MISMATCH }));
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_points_need_exactly_one_time() {
        let point = EnvelopePoint {
            at: None,
            percent: None,
            volume: 1.0,
            ease: None,
        };
        assert!(envelope_keyframes(&[point]).is_err());
    }
}
