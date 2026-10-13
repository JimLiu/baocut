//! Opt-in real-weight inference on either native tensor backend.
//! BAOCUT_FISH_S2_PRO_DIR points to the pinned model directory; outputs are temporary.
use model_runtime::bundle::{FileEntry, ModelFiles};
use model_runtime::synthesize::{self, TtsEngineKind, TtsRequest, VoiceSpec};
use std::path::PathBuf;
#[test]
#[ignore = "requires S2 Pro weights and enough memory"]
fn fish_s2_pro_real_weights() {
    let dir = PathBuf::from(std::env::var_os("BAOCUT_FISH_S2_PRO_DIR").expect("BAOCUT_FISH_S2_PRO_DIR"));
    let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("hub-manifest.json")).unwrap()).unwrap();
    let files = manifest["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| FileEntry {
            path: f["path"].as_str().unwrap().into(),
            sha256: f["sha256"].as_str().unwrap().into(),
            byte_length: f["size"].as_u64().unwrap(),
        })
        .collect();
    let files = ModelFiles {
        family: "fish-s2-pro".into(),
        revision: manifest["revision"].as_str().unwrap().into(),
        dir: dir.to_string_lossy().into(),
        files,
    }
    .verify("tts")
    .unwrap();
    let codec_dir = PathBuf::from(std::env::var_os("BAOCUT_FISH_S2_PRO_CODEC_DIR").expect("BAOCUT_FISH_S2_PRO_CODEC_DIR"));
    let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(codec_dir.join("hub-manifest.json")).unwrap()).unwrap();
    let codec = ModelFiles {
        family: "fish-s2-pro-codec".into(),
        revision: manifest["revision"].as_str().unwrap().into(),
        dir: codec_dir.to_string_lossy().into(),
        files: manifest["files"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["path"] == "codec.safetensors")
            .map(|f| FileEntry {
                path: f["path"].as_str().unwrap().into(),
                sha256: f["sha256"].as_str().unwrap().into(),
                byte_length: f["size"].as_u64().unwrap(),
            })
            .collect(),
    }
    .verify("codec")
    .unwrap();
    eprintln!("Loading S2 Pro quantized weights");
    let started = std::time::Instant::now();
    let mut engine = synthesize::load(
        TtsEngineKind::FishS2Pro,
        synthesize::EngineFiles {
            model: &files,
            codec: Some(&codec),
            aux: None,
        },
    )
    .unwrap();
    eprintln!("Loaded S2 Pro in {:?}", started.elapsed());
    #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
    check_idle_memory();
    let text = std::env::var("BAOCUT_FISH_TEST_TEXT").unwrap_or_else(|_| "Hello. This is Fish Audio.".into());
    let mut request = TtsRequest::new(
        text,
        VoiceSpec::Preset {
            speaker: std::env::var("BAOCUT_FISH_TEST_VOICE").unwrap_or_else(|_| "en-female".into()),
        },
    );
    request.sampling.seed = Some(42);
    if let Some(path) = std::env::var_os("BAOCUT_FISH_TEST_REFERENCE") {
        request.voice = VoiceSpec::Clone {
            reference_audio: PathBuf::from(path),
            reference_text: Some(std::env::var("BAOCUT_FISH_TEST_REFERENCE_TEXT").expect("BAOCUT_FISH_TEST_REFERENCE_TEXT")),
        };
    }
    let result = engine
        .synthesize(&request, &mut |p| {
            if !matches!(p,synthesize::TtsProgress::Tokens {generated,..} if generated%20!=0) {
                eprintln!("{p:?}");
            }
            #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
            {
                let (active, cache, peak) = model_runtime::backend::mlx::runtime::memory_snapshot();
                eprintln!("memory active={active} cache={cache} peak={peak}");
                assert!(active + cache < 9usize << 29);
            }
            true
        })
        .unwrap();
    eprintln!("Synthesis finished after {:?}", started.elapsed());
    #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
    check_idle_memory();
    assert_eq!(result.sample_rate, 44100);
    assert!(result.samples.len() > 4410);
    assert!(result.samples.iter().all(|v| v.is_finite() && v.abs() <= 1.0));
    assert!(result.samples.iter().any(|v| v.abs() > 0.01));
    if std::env::var_os("BAOCUT_FISH_CANCEL_DURING_GENERATION").is_some() {
        assert!(
            engine
                .synthesize(&request, &mut |p| !matches!(
                    p,
                    synthesize::TtsProgress::Tokens { generated: 1, .. }
                ))
                .is_err(),
            "cancellation during generation releases transformer weights"
        );
        #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
        check_idle_memory();
    }
    if std::env::var_os("BAOCUT_FISH_REPEAT").is_some() {
        let second = engine.synthesize(&request, &mut |_| true).unwrap();
        assert_eq!(result.samples, second.samples, "same seed must reproduce the same waveform");
        #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
        check_idle_memory();
    }
    assert!(
        engine.synthesize(&request, &mut |_| false).is_err(),
        "cancellation stops before reference inference"
    );
    let out = std::env::var_os("BAOCUT_TEST_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&out).unwrap();
    let wav = out.join("fish-s2-pro.wav");
    synthesize::wav::write_wav_pcm16(&wav, &result.samples, result.sample_rate).unwrap();
    if let Some(baseline) = std::env::var_os("BAOCUT_FISH_BASELINE_WAV") {
        assert!(
            std::fs::read(wav).unwrap() == std::fs::read(baseline).unwrap(),
            "memory optimizations must preserve the baseline WAV bytes"
        );
    }
}

#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
fn check_idle_memory() {
    let (active, cache, peak) = model_runtime::backend::mlx::runtime::memory_snapshot();
    eprintln!("Final Metal memory ({active}, {cache}, {peak})");
    assert!(
        active + cache < 64 << 20,
        "finished or cancelled synthesis must not retain model weights"
    );
    assert!(
        peak < 9usize << 29,
        "quantized S2 Pro must stay below the 4.5 GiB regression budget"
    );
}
