//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `audio::mix_audio_reported`
//! （host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! 解码后端选择的验收（WP6a）：视频帧与音频 clip 各自走了原生还是 ffmpeg。
//!
//! 按 `docs/design/bcf/baocut-format-spec.md` §15.1「解码后端必须可观测」，这两条路径的
//! 像素/样本只承诺语义等价 + 容差，所以"实际用了哪个后端"必须能问出来。本文件
//! 钉住的就是那个选择规则：
//!
//! - macOS / Windows 上的 MP4 → 平台原生（AVFoundation / Media Foundation）
//! - WebM（平台解码器打不开的容器）→ ffmpeg 兜底
//! - Linux（`media_native::available()` 为 false）→ 一律 ffmpeg
//! - 常速音频 clip → Symphonia；变速 clip → ffmpeg `atempo`
//!
//! 夹具用 ffmpeg 现生成，探测不到就整体跳过（仓库既有礼节）。

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

use render_raster::{MediaStore, audio, load_assets};
use serde_json::{Value, json};

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn ff(args: &[&str]) -> bool {
    Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error"])
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// 一份最小夹具：
///
/// - `clip.mp4`：H.264，无音轨。
/// - `clip.webm`：VP9，**不带 alpha**——纯粹是"平台解码器打不开的容器"。
/// - `rotated.mp4`：`clip.mp4` 的 stream-copy，只加 90° display matrix。
/// - `tone.wav`：44.1 kHz 立体声正弦（刻意不是 48 kHz，让重采样真的跑起来）。
/// - `av.mp4`：H.264 + AAC 的 2 秒素材，给 `withAudio` 展开的变速 clip 用
///   （音频轨上的 clip 恒为 1 倍速，`rate != 1` 只可能来自 video 元素的
///   `playbackRate`，见 `bcut-core` 的 `collect_with_audio`）。
fn fixtures() -> Option<(tempfile::TempDir, PathBuf)> {
    if !ffmpeg_available() {
        return None;
    }
    let dir = tempfile::tempdir().ok()?;
    let assets = dir.path().join("assets");
    std::fs::create_dir_all(&assets).ok()?;
    let source = "testsrc=size=160x90:rate=25:duration=1";
    let ok = ff(&[
        "-f",
        "lavfi",
        "-i",
        source,
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        assets.join("clip.mp4").to_str()?,
    ]) && ff(&[
        "-f",
        "lavfi",
        "-i",
        source,
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libvpx-vp9",
        // 编码质量无所谓，只要是个能解的 WebM：realtime + 最快档，别让夹具
        // 生成本身成为测试里最慢的一步。
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        assets.join("clip.webm").to_str()?,
    ]) && ff(&[
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2:sample_rate=44100",
        "-ac",
        "2",
        assets.join("tone.wav").to_str()?,
    ]) && ff(&[
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=160x90:rate=25:duration=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2:sample_rate=44100",
        "-ac",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        assets.join("av.mp4").to_str()?,
    ]);
    if !ok {
        return None;
    }
    let rotated = assets.join("rotated.mp4");
    if !ff(&[
        // FFmpeg 7+ 的显式 display-matrix 写法。老 ffmpeg 失败时
        // 保留其他基线夹具，旋转用例自己 skip。
        "-display_rotation",
        "90",
        "-i",
        assets.join("clip.mp4").to_str()?,
        "-c",
        "copy",
        rotated.to_str()?,
    ]) {
        let _ = std::fs::remove_file(rotated);
    }
    Some((dir, assets))
}

/// 只含一个视频元素的最小文档。
fn video_doc(src: &str) -> Value {
    json!({
        "meta": { "id": "backend", "width": 160, "height": 90, "fps": 25 },
        "scenes": [ { "id": "s", "dur": 1, "desc": "解码后端" } ],
        "assets": { "clip": { "type": "video", "src": src } },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": 0, "end": 1, "element": {
                    "type": "video", "id": "v", "src": "$assets.clip",
                    "style": { "x": 0, "y": 0, "width": 160, "height": 90 } } }
            ] }
        ]
    })
}

fn backend_for(dir: &Path, src: &str) -> Option<&'static str> {
    let doc = video_doc(src);
    let assets = Arc::new(load_assets(&doc, dir).expect("load_assets"));
    let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
    resolver.set_host_inputs(assets.inputs.clone());
    let ir = resolver.resolve().unwrap();
    let mut media = MediaStore::new(assets, ir.fps);
    // 真的解一帧：后端要到开解码器时才定下来。
    media.video_frame("clip", 0.2).expect("取帧");
    media.video_backend("clip")
}

/// MP4 走原生（有原生后端的平台上），WebM 一律回落 ffmpeg。
#[test]
fn an_mp4_decodes_natively_while_a_webm_falls_back_to_ffmpeg() {
    let Some((dir, _assets)) = fixtures() else {
        return;
    };
    let expected_mp4 = if media_native::available() {
        media_native::backend()
    } else {
        render_raster::media::FFMPEG_BACKEND
    };
    assert_eq!(
        backend_for(dir.path(), "assets/clip.mp4"),
        Some(expected_mp4),
        "MP4 应走 {expected_mp4}"
    );
    assert_eq!(
        backend_for(dir.path(), "assets/clip.webm"),
        Some(render_raster::media::FFMPEG_BACKEND),
        "WebM 平台解码器打不开，必须回落 ffmpeg"
    );
}

/// 两条后端交出的画面在跨后端容差内一致（§15.1）：同一段素材，一次经原生、
/// 一次经 ffmpeg（WebM 是同一份 `testsrc` 的另一种封装），中心像素的主导结构
/// 必须一致——这里用整幅平均色做粗判，细粒度的 SSIM 对拍在
/// `bcut-media-native` 的 `frame_stream.rs`。
#[test]
fn both_backends_agree_on_what_the_frame_looks_like() {
    let Some((dir, _assets)) = fixtures() else {
        return;
    };
    let mean = |src: &str| -> [u64; 3] {
        let doc = video_doc(src);
        let assets = Arc::new(load_assets(&doc, dir.path()).expect("load_assets"));
        let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
        resolver.set_host_inputs(assets.inputs.clone());
        let ir = resolver.resolve().unwrap();
        let mut media = MediaStore::new(assets, ir.fps);
        let pixmap = media.video_frame("clip", 0.2).expect("取帧");
        let mut totals = [0_u64; 3];
        for pixel in pixmap.data().chunks_exact(4) {
            totals[0] += u64::from(pixel[0]);
            totals[1] += u64::from(pixel[1]);
            totals[2] += u64::from(pixel[2]);
        }
        let count = (pixmap.width() * pixmap.height()) as u64;
        [totals[0] / count, totals[1] / count, totals[2] / count]
    };
    let native = mean("assets/clip.mp4");
    let fallback = mean("assets/clip.webm");
    for channel in 0..3 {
        let delta = native[channel].abs_diff(fallback[channel]);
        assert!(
            delta <= 12,
            "通道 {channel} 的整幅平均值差 {delta}（原生 {:?} vs ffmpeg {:?}）",
            native,
            fallback
        );
    }
}

/// 90° 旋转素材的两条解码路径都必须按 display 几何交帧：
///
/// - 原生路径不再因为拿 natural 编码尺寸校验而误回落；
/// - ffmpeg autorotate 路径的 rawvideo 不再被按 natural 行宽构造 Pixmap。
#[test]
fn rotated_video_uses_display_geometry_on_native_and_ffmpeg_paths() {
    let Some((dir, assets_dir)) = fixtures() else {
        return;
    };
    let rotated = assets_dir.join("rotated.mp4");
    if !rotated.exists() {
        eprintln!("跳过：这台机器的 ffmpeg 不支持 -display_rotation 夹具");
        return;
    }

    let (natural_width, natural_height, _, _) =
        render_raster::assets::probe_media(&rotated, true).expect("探测旋转 MP4");
    assert_eq!(
        (natural_width, natural_height),
        (160, 90),
        "公开 probe_media 仍保持 natural 编码尺寸口径"
    );

    let doc = video_doc("assets/rotated.mp4");
    let loaded = load_assets(&doc, dir.path()).expect("加载旋转视频");
    let info = loaded.videos.get("clip").expect("视频资源");
    assert_eq!(
        (info.width, info.height),
        (90, 160),
        "渲染资源必须使用摆正后的 display 尺寸"
    );

    let mut preferred = MediaStore::new(Arc::new(loaded), 25.0);
    let frame = preferred.video_frame("clip", 0.2).expect("首选路径取帧");
    assert_eq!((frame.width(), frame.height()), (90, 160));
    let expected = if media_native::available() {
        media_native::backend()
    } else {
        render_raster::media::FFMPEG_BACKEND
    };
    assert_eq!(preferred.video_backend("clip"), Some(expected));

    // 显式 decoder 名会让 VideoReader 跳过原生后端；这是已有 alpha
    // WebM 走 ffmpeg 的同一选择机制，用 H.264 名只为在测试里强制该路径。
    let mut fallback_assets = load_assets(&doc, dir.path()).expect("重新加载旋转视频");
    fallback_assets
        .videos
        .get_mut("clip")
        .expect("视频资源")
        .decoder = Some("h264".to_owned());
    let mut fallback = MediaStore::new(Arc::new(fallback_assets), 25.0);
    let frame = fallback.video_frame("clip", 0.2).expect("ffmpeg 路径取帧");
    assert_eq!((frame.width(), frame.height()), (90, 160));
    assert_eq!(
        fallback.video_backend("clip"),
        Some(render_raster::media::FFMPEG_BACKEND)
    );
}

/// 中段 RMS（掐掉首尾各 10 ms 的重采样过渡带）。
fn middle_rms(samples: &[f32]) -> f64 {
    let skip = audio::SAMPLE_RATE as usize / 100 * 2;
    let core = &samples[skip..samples.len() - skip];
    (core
        .iter()
        .map(|v| f64::from(*v) * f64::from(*v))
        .sum::<f64>()
        / core.len() as f64)
        .sqrt()
}

fn to_samples(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

fn mix(doc: Value, dir: &Path) -> audio::AudioMix {
    let assets = load_assets(&doc, dir).expect("load_assets");
    let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
    resolver.set_host_inputs(assets.inputs.clone());
    let ir = resolver.resolve().unwrap();
    audio::mix_audio_reported(&ir, &assets)
        .expect("混音")
        .expect("有 audio clip")
}

#[test]
fn prepared_video_rejects_replacement_without_touching_inactive_media() {
    use std::io::Write;
    let Some((dir, _)) = fixtures() else {
        return;
    };
    let asset = dir.path().join("assets/clip.mp4");
    let unused = dir.path().join("assets/unused.mp4");
    std::fs::copy(&asset, &unused).unwrap();
    let doc = json!({"assets":{
        "clip":{"type":"video","src":"assets/clip.mp4"},
        "unused":{"type":"video","src":"assets/unused.mp4"}
    }});
    let assets = load_assets(&doc, dir.path()).unwrap();
    std::fs::remove_file(unused).unwrap();
    let mut media = MediaStore::new(Arc::new(assets), 25.0);
    media.video_frame("clip", 0.0).unwrap();
    std::fs::OpenOptions::new()
        .append(true)
        .open(asset)
        .unwrap()
        .write_all(b"changed")
        .unwrap();
    assert!(
        media
            .video_frame("clip", 0.04)
            .unwrap_err()
            .to_string()
            .contains("准备后发生变化")
    );
}

#[test]
fn streamed_mix_matches_reference_across_windows_and_clip_block_boundaries() {
    let Some((dir, _)) = fixtures() else {
        return;
    };
    let doc = json!({
        "meta":{"id":"streamed","width":160,"height":90,"fps":25},
        "scenes":[{"id":"s","dur":6,"desc":"bounded audio"}],
        "assets":{"tone":{"type":"audio","src":"assets/tone.wav"}},
        "tracks":[{"id":"sound","kind":"audio","clips":[
            {"id":"a","start":3.70007,"end":5.6,"src":"$assets.tone","volume":0.8,
             "animate":{"keyframes":[{"prop":"volume","frames":[{"t":0,"v":0.1},{"t":1.9,"v":0.9}]}]}},
            {"id":"b","start":3.8,"end":5.5,"src":"$assets.tone","volume":0.4}
        ]}]
    });
    let assets = load_assets(&doc, dir.path()).unwrap();
    let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
    resolver.set_host_inputs(assets.inputs.clone());
    let mut ir = resolver.resolve().unwrap();
    // Exercise both the native and the streaming atempo decoder.
    ir.audio_clips[1].rate = 1.25;
    let expected = audio::mix_audio_reported(&ir, &assets).unwrap().unwrap();
    let actual = audio::mix_audio_file(&ir, &assets, &Default::default(), || Ok(()))
        .unwrap()
        .unwrap();
    assert_eq!(actual.clips, expected.clips);
    let wav = std::fs::read(actual.wav.path()).unwrap();
    assert_eq!(&wav[44..], expected.pcm);
    let info = media_probe::probe(actual.wav.path()).unwrap();
    assert!(info.has_audio());
    assert!(
        audio::mix_audio_file(&ir, &assets, &Default::default(), || anyhow::bail!(
            "cancelled"
        ))
        .is_err()
    );
}

/// 混音链（§4 `audio`、§8.4 淡入淡出 / 声像 / 总线 / muted）：内存与流式两条路径逐位相同，
/// 母带压住真峰值，静音轨等于没有这条轨。
#[test]
fn mix_chain_streamed_matches_memory_and_muted_track_is_silent() {
    let Some((dir, _)) = fixtures() else {
        return;
    };
    let doc = |muted: bool, with_bed: bool| {
        let mut tracks = vec![json!({"id":"vo-sea","kind":"audio","clips":[
            {"id":"line","start":1.0,"end":3.0,"src":"$assets.tone","volume":0.5}
        ]})];
        if with_bed {
            tracks.push(
                json!({"id":"score-music","kind":"audio","muted":muted,"clips":[
                    {"id":"bed","start":0,"end":5.5,"src":"$assets.tone","volume":0.9,
                     "fadeIn":0.5,"fadeOut":1.0,"pan":-0.4}
                ]}),
            );
        }
        json!({
            "meta":{"id":"chain","width":160,"height":90,"fps":25},
            "scenes":[{"id":"s","dur":6,"desc":"mix chain"}],
            "assets":{"tone":{"type":"audio","src":"assets/tone.wav"}},
            "tracks":tracks,
            "audio":{"buses":{"music":{"gainDb":-2}},
                     "duck":[{"from":"vo","to":"music","depthDb":12}],
                     "master":{"lufs":-18,"truePeak":-1.5}}
        })
    };
    let resolved = |doc: Value| {
        let assets = load_assets(&doc, dir.path()).unwrap();
        let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
        resolver.set_host_inputs(assets.inputs.clone());
        (resolver.resolve().unwrap(), assets)
    };
    let (ir, assets) = resolved(doc(false, true));
    assert_eq!(ir.audio_clips[1].bus, "music");
    let memory = audio::mix_audio_reported(&ir, &assets).unwrap().unwrap();
    let streamed = audio::mix_audio_file(&ir, &assets, &Default::default(), || Ok(()))
        .unwrap()
        .unwrap();
    assert_eq!(
        &std::fs::read(streamed.wav.path()).unwrap()[44..],
        memory.pcm
    );
    assert_eq!(streamed.master, memory.master);
    let master = memory.master.expect("写了 audio.master");
    assert!(master.true_peak <= -1.5 + 1e-6, "{master:?}");
    assert!((master.lufs + 18.0).abs() < 1.0, "{master:?}");

    // 时间轴另放旁白：闪避仍跟着它，母带不施加并报提醒。
    let exclude = std::collections::BTreeSet::from(["line".to_string()]);
    let partial = audio::mix_audio_file(&ir, &assets, &exclude, || Ok(()))
        .unwrap()
        .unwrap();
    assert!(partial.master.is_none());
    assert!(partial.warnings[0].starts_with("audio-master-skipped"));

    // muted 轨与删掉这条轨逐位相同。
    let (muted_ir, assets) = resolved(doc(true, true));
    assert_eq!(muted_ir.audio_clips.len(), 2, "编译保留静音轨的 clip");
    let muted = audio::mix_audio_reported(&muted_ir, &assets)
        .unwrap()
        .unwrap();
    let (without_ir, assets) = resolved(doc(false, false));
    let without = audio::mix_audio_reported(&without_ir, &assets)
        .unwrap()
        .unwrap();
    assert_eq!(muted.pcm, without.pcm);
    assert_eq!(muted.clips, without.clips);
    assert_ne!(muted.pcm, memory.pcm);
}

/// 一个只有 `tone.wav` 的音频轨单 clip 文档（恒为 1 倍速）。
fn mix_tone(dir: &Path) -> audio::AudioMix {
    mix(
        json!({
            "meta": { "id": "audio-backend", "width": 160, "height": 90, "fps": 25 },
            "scenes": [ { "id": "s", "dur": 1, "desc": "音频后端" } ],
            "assets": { "tone": { "type": "audio", "src": "assets/tone.wav" } },
            "tracks": [
                { "id": "sound", "kind": "audio", "clips": [
                    { "id": "bgm", "start": 0, "end": 1, "src": "$assets.tone", "volume": 1.0 }
                ] }
            ]
        }),
        dir,
    )
}

/// `withAudio` 展开的 clip：倍速由 video 元素的 `playbackRate` 决定，这是
/// `AudioClip::rate != 1` 的**唯一**来源。
fn mix_video_audio(dir: &Path, rate: f64) -> audio::AudioMix {
    mix(
        json!({
            "meta": { "id": "av-backend", "width": 160, "height": 90, "fps": 25 },
            "scenes": [ { "id": "s", "dur": 1, "desc": "withAudio 倍速" } ],
            "assets": { "av": { "type": "video", "src": "assets/av.mp4" } },
            "tracks": [
                { "id": "main", "kind": "visual", "clips": [
                    { "id": "shot", "start": 0, "end": 1, "element": {
                        "type": "video", "id": "v", "src": "$assets.av",
                        "withAudio": true, "playbackRate": rate, "volume": 1.0,
                        "style": { "x": 0, "y": 0, "width": 160, "height": 90 } } }
                ] }
            ]
        }),
        dir,
    )
}

/// 常速音频 clip 走 Symphonia，变速 clip 留给 ffmpeg 的 `atempo`（WP6a 的
/// 取舍：保音高时间拉伸没有可放心接入的纯 Rust 实现，见 `audio.rs` 头部）。
/// 两条路径的输出契约（48 kHz 立体声、长度、电平）必须一致。
#[test]
fn constant_rate_audio_uses_symphonia_and_rate_changed_audio_uses_ffmpeg() {
    let Some((dir, _assets)) = fixtures() else {
        return;
    };
    let mut measured = Vec::new();
    for (rate, expected) in [
        (1.0, audio::SYMPHONIA_BACKEND),
        (2.0, audio::FFMPEG_BACKEND),
    ] {
        let mix = mix_video_audio(dir.path(), rate);
        assert_eq!(
            mix.clips
                .iter()
                .map(|record| record.backend)
                .collect::<Vec<_>>(),
            vec![expected],
            "rate={rate} 应走 {expected}"
        );
        // 混音长度契约与后端无关：全片 1 秒 × 48 kHz × 立体声 × f32。
        assert_eq!(
            mix.pcm.len(),
            audio::SAMPLE_RATE as usize * 2 * 4,
            "rate={rate} 的 PCM 长度"
        );
        measured.push(middle_rms(&to_samples(&mix.pcm)));
    }
    // 变速的是**时间轴**不是电平：同一条正弦在 1x 与 2x 下 RMS 应当一致。
    // 这条把"后端换了但声音没换"钉死，不依赖 lavfi sine 的绝对幅度。
    let (constant, stretched) = (measured[0], measured[1]);
    assert!(constant > 0.02, "常速 RMS {constant:.4} 异常（几乎静音）");
    assert!(
        (constant - stretched).abs() < constant * 0.15,
        "Symphonia 路径 RMS {constant:.4} 与 ffmpeg atempo 路径 {stretched:.4} 差得太多"
    );
}

/// 常速路径的重采样正确性：Symphonia + 多相 sinc（44.1 kHz → 48 kHz）与迁移前
/// `ffmpeg -f f32le -ac 2 -ar 48000` 的输出，长度逐样一致、RMS 在 2% 以内。
///
/// 这条比"和自己比"强：参照物是**真正的 ffmpeg 解码 + swresample**，量的是
/// 换了解码器之后声音有没有变。
#[test]
fn the_symphonia_path_matches_the_ffmpeg_reference_pcm() {
    symphonia_matches_ffmpeg(2);
}

#[test]
fn mono_resampling_matches_the_ffmpeg_reference_pcm() {
    symphonia_matches_ffmpeg(1);
}

fn symphonia_matches_ffmpeg(channels: u16) {
    let Some((dir, assets)) = fixtures() else {
        return;
    };
    if channels == 1 {
        assert!(ff(&[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2:sample_rate=44100",
            "-ac",
            "1",
            assets.join("tone.wav").to_str().unwrap(),
        ]));
    }
    let mix = mix_tone(dir.path());
    assert_eq!(mix.clips[0].backend, audio::SYMPHONIA_BACKEND);
    let ours = to_samples(&mix.pcm);

    let reference = Command::new("ffmpeg")
        .args(["-nostdin", "-loglevel", "error", "-t", "1.000000"])
        .arg("-i")
        .arg(assets.join("tone.wav"))
        .args(["-f", "f32le", "-ac", "2", "-ar", "48000", "-"])
        .stderr(Stdio::null())
        .output()
        .expect("ffmpeg 参照解码");
    assert!(reference.status.success());
    let theirs = to_samples(&reference.stdout);
    // 两侧都是 1 秒的 48 kHz 立体声；混音侧按全片长度补零，参照侧就是 -t 的长度。
    assert_eq!(
        theirs.len(),
        audio::SAMPLE_RATE as usize * 2,
        "参照 PCM 应是 1 秒立体声"
    );
    assert_eq!(ours.len(), theirs.len(), "两条路径的样本数必须一致");
    let (ours_rms, theirs_rms) = (middle_rms(&ours), middle_rms(&theirs));
    assert!(
        (ours_rms - theirs_rms).abs() < theirs_rms * 0.02,
        "Symphonia RMS {ours_rms:.5} 与 ffmpeg RMS {theirs_rms:.5} 相差超过 2%"
    );
    // 逐样最大偏差：44.1 → 48 的插值核不同，但同一条 440 Hz 正弦上不该差很多。
    let worst = ours
        .iter()
        .zip(&theirs)
        .map(|(a, b)| (f64::from(*a) - f64::from(*b)).abs())
        .fold(0.0_f64, f64::max);
    assert!(
        worst < 0.05,
        "逐样最大偏差 {worst:.5} 过大（满幅 1.0，正弦幅度约 {:.3}）",
        theirs_rms * std::f64::consts::SQRT_2
    );
    println!("symphonia rms={ours_rms:.5} ffmpeg rms={theirs_rms:.5} 逐样最大偏差={worst:.5}");
}
