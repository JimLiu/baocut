//! 声波听素材的声音（格式规范 §3.7）：素材频谱按声音计划映射到序列时间、`project` 按增益混、缺素材频谱时报出来，
//! 以及从声音文件算素材频谱。素材频谱都是合成的，不读真实媒体。

mod common;

use common::*;
use std::sync::Arc;

use frame_render::SpeakerActivity;
use frame_render::renderer::RENDER_NOTE;
use frame_render::spectrum::analyze_file;
use serde_json::{Value, json};
use video_model::{VersionRef, VideoSnapshot};

/// 素材 `a_tone` 的频谱：源的第 1 秒之前静音，之后低频响、高频静（60 帧/秒，共 5 秒）。
fn tone() -> Vec<u8> {
    spectrum_by_frame(300, |frame, bin| match (frame >= 60, bin < 128) {
        (false, _) => 0,
        (true, true) => 220,
        (true, false) => 40,
    })
}

/// 声音实例从序列第 3 秒起放 `a_tone` 的源 [0, 3) 秒，音量 `volume`；声波实例铺满 [0, 6) 秒，听 `audio`。
fn scene(audio: &str, volume: f64) -> VideoSnapshot {
    let music = json!({
        "id": "music", "trackId": "trk_a1", "enabled": true, "locked": false, "paintOrder": 0,
        "followPolicy": { "kind": "sequence-fixed" },
        "type": "audio", "assetRef": { "id": "a_tone", "revision": "rev_1" }, "fromFrame": 90, "subframeOffset": { "ticks": "0", "timescale": 1 },
        "playDuration": { "ticks": "3", "timescale": 1 },
        "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
        "mix": { "volume": volume }
    });
    let viz = item(
        "g",
        0,
        180,
        json!({ "type": "visualizer", "place": { "w": 60 },
                "visualizer": { "style": "bars", "mainColor": "#FFFFFF", "audio": audio, "smoothing": 0 } }),
    );
    video(vec![viz, music], vec![audio_asset("a_tone")], json!({ "tracks": tracks() }))
}

fn tracks() -> Value {
    json!([
        { "id": "trk_v1", "order": 0, "kind": "visual", "locked": false, "visible": true, "muted": false,
          "solo": { "enabled": false, "group": "visual" } },
        { "id": "trk_a1", "order": 0, "kind": "audio", "locked": false, "visible": true, "muted": false,
          "solo": { "enabled": false, "group": "audio" } }
    ])
}

fn media() -> Media {
    let mut media = Media::default();
    media.audio_spectra.insert("a_tone@rev_1".into(), tone());
    media
}

/// 用新的渲染器画 `seconds` 这一帧，并确认没有提示、没有缺的素材频谱。
fn shot(video: &VideoSnapshot, seconds: f64, media: &mut Media) -> Vec<u8> {
    let mut renderer = renderer(false, frame_render::Documents::default());
    let frame = render_with(&mut renderer, video, seconds, media);
    assert!(renderer.warnings().is_empty(), "{:?}", renderer.warnings());
    assert!(renderer.missing_spectra().is_empty());
    frame
}

#[test]
fn the_asset_is_heard_at_its_source_time() {
    for audio in ["a_tone", "project"] {
        let video = scene(audio, 1.0);
        // 素材第 1 秒才响，实例从序列第 3 秒起放：序列第 4 秒起才响。
        let before = shot(&video, 2.0, &mut media());
        let quiet = shot(&video, 3.5, &mut media());
        let loud = shot(&video, 4.5, &mut media());
        assert_eq!(painted(&before), painted(&quiet), "{audio}");
        assert!(
            painted(&loud) > painted(&quiet) + 50,
            "{audio}：{} {}",
            painted(&quiet),
            painted(&loud)
        );
    }
}

#[test]
fn the_project_mix_follows_volume_but_a_single_asset_does_not() {
    let loud = shot(&scene("project", 1.0), 4.5, &mut media());
    let soft = shot(&scene("project", 0.1), 4.5, &mut media());
    assert!(painted(&soft) < painted(&loud), "{} {}", painted(&soft), painted(&loud));
    assert_eq!(
        shot(&scene("a_tone", 1.0), 4.5, &mut media()),
        shot(&scene("a_tone", 0.1), 4.5, &mut media()),
        "只听一个素材时不乘增益"
    );
}

#[test]
fn a_missing_asset_spectrum_is_reported_until_it_arrives() {
    let video = scene("project", 1.0);
    let mut media = Media::default();
    let mut renderer = renderer(false, frame_render::Documents::default());
    let placeholder = render_with(&mut renderer, &video, 4.5, &mut media);
    let asset = VersionRef {
        id: "a_tone".into(),
        revision: "rev_1".into(),
    };
    assert_eq!(renderer.missing_spectra(), [("g".to_string(), asset.clone())]);
    assert!(
        renderer
            .warnings()
            .iter()
            .any(|w| w.code == RENDER_NOTE && w.detail.starts_with("g："))
    );
    // 缓存命中时照样报缺。
    renderer.clear_reports();
    render_with(&mut renderer, &video, 4.6, &mut media);
    assert_eq!(renderer.missing_spectra(), [("g".to_string(), asset)]);
    // 素材频谱到了：宿主清掉频谱轨缓存再画，不再报缺，也不再是占位的样子。
    media.audio_spectra.insert("a_tone@rev_1".into(), tone());
    renderer.clear_spectra();
    renderer.clear_reports();
    let heard = render_with(&mut renderer, &video, 4.5, &mut media);
    assert!(renderer.missing_spectra().is_empty());
    assert!(renderer.warnings().is_empty(), "{:?}", renderer.warnings());
    assert_ne!(heard, placeholder);
}

#[test]
fn an_item_spectrum_overrides_the_asset() {
    let video = scene("project", 1.0);
    let mut silent = media();
    silent.spectra.insert("g".into(), spectrum(400, |_| 0));
    let overridden = shot(&video, 4.5, &mut silent);
    let heard = shot(&video, 4.5, &mut media());
    assert!(painted(&overridden) < painted(&heard));
}

/// 声波实例换成写了 `speaker` 与 `alwaysShow` 的（听整条序列的声音）。
fn speaker_scene(speaker: Option<&str>, always_show: bool) -> VideoSnapshot {
    let mut video = scene("project", 1.0);
    let sequence = video.sequences.values_mut().next().unwrap();
    for item in &mut sequence.items {
        if let video_model::TimelineItem::Visualizer(viz) = item {
            viz.visualizer.speaker = speaker.map(str::to_owned);
            viz.visualizer.always_show = Some(always_show);
        }
    }
    video
}

/// spk_a 在 [4.0, 4.2) 与 [4.6, 4.8) 说话（相隔 0.4 秒，并成一段），spk_b 在 [5.0, 6.0)。
fn speakers() -> Arc<SpeakerActivity> {
    let mut map = SpeakerActivity::new();
    map.insert("spk_a".into(), vec![(4.0, 4.2), (4.6, 4.8)]);
    map.insert("spk_b".into(), vec![(5.0, 6.0)]);
    Arc::new(map)
}

fn speaker_shot(video: &VideoSnapshot, seconds: f64, speakers: Option<Arc<SpeakerActivity>>) -> (Vec<u8>, Vec<String>) {
    let mut renderer = renderer(false, frame_render::Documents::default());
    renderer.set_speakers(speakers);
    let frame = render_with(&mut renderer, video, seconds, &mut media());
    let notes = renderer.warnings().iter().map(|w| w.detail.clone()).collect();
    (frame, notes)
}

#[test]
fn a_speaker_visualizer_only_moves_while_that_speaker_talks() {
    let all = speaker_scene(None, true);
    let quiet = shot(&all, 2.0, &mut media());
    let spk_a = speaker_scene(Some("spk_a"), true);
    // 在说话的段里与不过滤的一样；两个词之间不到 0.5 秒的停顿也算在说。
    for t in [4.1, 4.4, 4.7] {
        let (frame, notes) = speaker_shot(&spk_a, t, Some(speakers()));
        assert_eq!(frame, shot(&all, t, &mut media()), "{t}");
        assert!(notes.is_empty(), "{notes:?}");
    }
    // 声音还响着，但说话的是 spk_b：画静止的样子。
    let (frame, _) = speaker_shot(&spk_a, 5.5, Some(speakers()));
    assert_eq!(frame, quiet);
    assert!(painted(&shot(&all, 5.5, &mut media())) > painted(&quiet) + 50);
    // 没有转写、转写里没有这位说话人：整条静音，报提示。
    let (frame, notes) = speaker_shot(&spk_a, 4.1, None);
    assert_eq!(frame, quiet);
    assert!(notes.iter().any(|n| n.starts_with("g：") && n.contains("没有转写")), "{notes:?}");
    let (frame, notes) = speaker_shot(&speaker_scene(Some("spk_x"), true), 4.1, Some(speakers()));
    assert_eq!(frame, quiet);
    assert!(notes.iter().any(|n| n.contains("没有说话人 spk_x")), "{notes:?}");
}

#[test]
fn always_show_false_hides_the_visualizer_after_half_a_second_of_silence() {
    let hidden = speaker_scene(None, false);
    // 声音从序列第 4 秒起才有：之前不画；一出声就画。
    assert_eq!(painted(&shot(&hidden, 2.0, &mut media())), 0);
    assert_eq!(
        shot(&hidden, 4.5, &mut media()),
        shot(&speaker_scene(None, true), 4.5, &mut media())
    );
    // 与说话人一起：spk_a 在 4.8 秒停下，静音的样子再留 0.5 秒，之后不画。
    let spk_a = speaker_scene(Some("spk_a"), false);
    let quiet = shot(&speaker_scene(None, true), 2.0, &mut media());
    assert!(painted(&speaker_shot(&spk_a, 4.5, Some(speakers())).0) > painted(&quiet));
    assert_eq!(speaker_shot(&spk_a, 5.2, Some(speakers())).0, quiet);
    assert_eq!(painted(&speaker_shot(&spk_a, 5.5, Some(speakers())).0), 0);
    // 没有转写：没有声，不画（照样报提示）。
    let (frame, notes) = speaker_shot(&spk_a, 4.5, None);
    assert_eq!(painted(&frame), 0);
    assert!(!notes.is_empty());
    // 换一份说话人的区间：轨作废重拼。
    let mut renderer = renderer(false, frame_render::Documents::default());
    renderer.set_speakers(None);
    assert_eq!(painted(&render_with(&mut renderer, &spk_a, 4.5, &mut media())), 0);
    renderer.set_speakers(Some(speakers()));
    assert!(painted(&render_with(&mut renderer, &spk_a, 4.5, &mut media())) > 0);
}

/// 16 位单声道 48 kHz 的 WAV：前 1 秒 440 Hz，后 1 秒 3000 Hz。
fn tone_wav() -> Vec<u8> {
    let samples: Vec<i16> = (0..96_000)
        .map(|i| {
            let hz = if i < 48_000 { 440.0 } else { 3000.0 };
            (0.5 * (std::f64::consts::TAU * hz * f64::from(i) / 48_000.0).sin() * f64::from(i16::MAX)) as i16
        })
        .collect();
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::new();
    out.extend(b"RIFF");
    out.extend((36 + data).to_le_bytes());
    out.extend(b"WAVEfmt ");
    out.extend(16u32.to_le_bytes());
    out.extend(1u16.to_le_bytes());
    out.extend(1u16.to_le_bytes());
    out.extend(48_000u32.to_le_bytes());
    out.extend((48_000u32 * 2).to_le_bytes());
    out.extend(2u16.to_le_bytes());
    out.extend(16u16.to_le_bytes());
    out.extend(b"data");
    out.extend(data.to_le_bytes());
    for sample in samples {
        out.extend(sample.to_le_bytes());
    }
    out
}

#[test]
fn asset_files_are_analysed_deterministically() {
    let dir = std::env::temp_dir().join(format!("frame-render-spectrum-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("tone.wav");
    std::fs::write(&path, tone_wav()).unwrap();
    // 纯 Rust 解得了 WAV，用不到 ffmpeg。
    let ffmpeg = dir.join("no-ffmpeg");
    let first = analyze_file(&path, &ffmpeg).unwrap();
    let second = analyze_file(&path, &ffmpeg).unwrap();
    std::fs::remove_dir_all(&dir).ok();
    assert_eq!(first, second);
    let view = waveform::bcs1::parse(&first).unwrap();
    assert_eq!(view.header().frame_count, 120);
    // 每个分箱 46.875 Hz：440 Hz 落在第 9 箱，3000 Hz 落在第 64 箱。
    let peak = |frame: usize| {
        let row = &view.frame(frame).unwrap()[128..];
        (0..row.len()).max_by_key(|&bin| row[bin]).unwrap()
    };
    assert!((8..=10).contains(&peak(30)), "{}", peak(30));
    assert!((63..=65).contains(&peak(90)), "{}", peak(90));
}

/// 预览按尺寸留几台渲染器：新的那台拿上一台拼好的频谱轨，不再向宿主要素材频谱，画出来与自己拼的相同；说话人的
/// 区间不同时不拿（轨按说话人过滤过）。
#[test]
fn a_renderer_takes_the_spectrum_tracks_another_one_composed() {
    let video = scene("project", 1.0);
    let mut first = renderer(false, frame_render::Documents::default());
    render_with(&mut first, &video, 4.5, &mut media());
    let own = shot(&video, 4.5, &mut media());

    // 素材频谱不在手边：拿过来的轨照样画出来，也不报缺。
    let mut second = renderer(false, frame_render::Documents::default());
    second.share_spectra_from(&first);
    let shared = render_with(&mut second, &video, 4.5, &mut Media::default());
    assert!(second.missing_spectra().is_empty());
    assert!(second.warnings().is_empty(), "{:?}", second.warnings());
    assert_eq!(shared, own);

    // 说话人的区间对不上：不拿，自己去要素材频谱。
    let mut third = renderer(false, frame_render::Documents::default());
    third.set_speakers(Some(speakers()));
    third.share_spectra_from(&first);
    render_with(&mut third, &video, 4.5, &mut Media::default());
    assert_eq!(third.missing_spectra().len(), 1);
}
