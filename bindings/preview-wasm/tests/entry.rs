//! WASM 入口在原生上的行为：同一套导出函数，界面经线性内存调用的就是这些。

use std::path::PathBuf;

use frame_render::{Documents, FrameRenderer, RenderOptions};
use preview_wasm::{
    add_font, bc_alloc, bc_frame_len, bc_frame_ptr, bc_free, bc_measure_text, bc_output_len, bc_output_ptr, bc_plan, bc_render,
    bc_set_video, bc_spectrum_begin, bc_spectrum_finish, bc_spectrum_push, clear_audio_spectra, clear_pictures, font_files, frame, plan,
    render, set_audio_spectrum, set_picture, set_speech, set_video, spectrum_push,
};
use serde_json::{Value, json};

fn video() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../crates/render-graph/tests/fixtures/video.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("读夹具视频")).unwrap()
}

fn output() -> Value {
    let bytes = unsafe { std::slice::from_raw_parts(bc_output_ptr(), bc_output_len()) };
    serde_json::from_slice(bytes).unwrap()
}

fn send(input: &[u8]) -> u32 {
    let ptr = bc_alloc(input.len());
    unsafe {
        std::ptr::copy_nonoverlapping(input.as_ptr(), ptr, input.len());
        let status = bc_set_video(ptr, input.len());
        bc_free(ptr, input.len());
        status
    }
}

#[test]
fn plans_need_a_video_first() {
    assert_eq!(plan(0.0).unwrap_err().code, "NO_VIDEO");
    assert_eq!(bc_plan(0.0), 1);
    assert_eq!(output()["code"], "NO_VIDEO");
}

#[test]
fn root_sequence_is_the_default() {
    set_video(json!({ "video": video() }).to_string().as_bytes()).unwrap();
    let plan: Value = serde_json::from_str(&plan(1.5).unwrap()).unwrap();
    assert_eq!(plan["sequenceId"], "seq_main");
    assert_eq!(plan["frame"], 45);
    assert_eq!(plan["layers"].as_array().unwrap().len(), 3);
}

#[test]
fn exports_round_trip_through_linear_memory() {
    let input = json!({ "video": video(), "sequenceId": "seq_main" }).to_string();
    assert_eq!(send(input.as_bytes()), 0);
    assert_eq!(bc_output_len(), 0);
    assert_eq!(bc_plan(5.0), 0);
    assert_eq!(output()["layers"][0]["itemId"], "item_hold");
}

#[test]
fn bad_input_is_reported_and_keeps_the_previous_video() {
    assert_eq!(send(json!({ "video": video() }).to_string().as_bytes()), 0);
    assert_eq!(send(b"{\"video\": 1}"), 1);
    assert_eq!(output()["code"], "INVALID_VIDEO");
    assert_eq!(
        send(json!({ "video": video(), "sequenceId": "seq_missing" }).to_string().as_bytes()),
        1
    );
    assert_eq!(output()["code"], "SEQUENCE_NOT_FOUND");
    assert_eq!(bc_plan(0.0), 0);
}

#[test]
fn frames_render_through_the_same_core_with_injected_fonts_and_pictures() {
    set_video(json!({ "video": video() }).to_string().as_bytes()).unwrap();
    // 没有字体时渲染器建不起来：报出来，计划照样能求。
    assert_eq!(render(1.5, 320, 180, true, false).unwrap_err().code, "INVALID_PARAMS");
    assert!(plan(1.5).is_ok());
    let files: Vec<String> = serde_json::from_str(&font_files()).unwrap();
    assert_eq!(files[0], "NotoSansSC-Variable.ttf");
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../crates/render-raster/assets/fonts");
    for name in files.iter().take(3) {
        add_font(std::fs::read(dir.join(name)).unwrap()).unwrap();
    }
    // 计划里每个视频、图片层都给一张纯红的画面（非预乘 RGBA）。
    let planned: Value = serde_json::from_str(&plan(1.5).unwrap()).unwrap();
    clear_pictures();
    for layer in planned["layers"].as_array().unwrap() {
        if matches!(layer["kind"].as_str(), Some("video" | "image")) {
            set_picture(layer["itemId"].as_str().unwrap(), [255, 0, 0, 255].repeat(16 * 9), 16, 9).unwrap();
        }
    }
    let rendered: Value = serde_json::from_str(&render(1.5, 320, 180, true, false).unwrap()).unwrap();
    assert_eq!(rendered["plan"]["frame"], 45);
    assert!(rendered["skipped"].is_array() && rendered["warnings"].is_array());
    let pixels = frame();
    assert_eq!(pixels.len(), 320 * 180 * 4);
    assert!(pixels.chunks_exact(4).any(|p| p[0] > 200 && p[1] < 40), "红色的画面画上去了");
    assert!(pixels.chunks_exact(4).all(|p| p[3] == 255), "帧是不透明的");
    // 经线性内存：尺寸变了照样画，画面指针与长度对得上。
    assert_eq!(bc_render(1.5, 160, 90, 1), 0);
    assert_eq!(output()["plan"]["frame"], 45);
    assert_eq!(bc_frame_len(), 160 * 90 * 4);
    assert!(!bc_frame_ptr().is_null());
    // 透明底（缩略图）：不铺背景，画面是非预乘的。只给斜放的台标送画面：台标外透明，边上半透明处也还是纯红。
    clear_pictures();
    set_picture("item_logo", [255, 0, 0, 255].repeat(16 * 9), 16, 9).unwrap();
    assert_eq!(bc_render(1.5, 160, 90, 3), 0);
    let pixels = frame();
    assert!(pixels.chunks_exact(4).any(|p| p[3] == 0), "背景留透明");
    assert!(pixels.chunks_exact(4).any(|p| p == [255, 0, 0, 255]), "台标是原色");
    assert!(
        pixels
            .chunks_exact(4)
            .filter(|p| p[3] > 0)
            .all(|p| p[0] >= 250 && p[1] == 0 && p[2] == 0),
        "非预乘"
    );
    // 再画不透明的一帧，画面回到渲染器自己的。
    assert_eq!(bc_render(1.5, 160, 90, 1), 0);
    assert!(frame().chunks_exact(4).all(|p| p[3] == 255));
    // 画面尺寸与字节数不符时报错。
    assert_eq!(set_picture("x", vec![0; 3], 1, 1).unwrap_err().code, "INVALID_PICTURE");
}

/// 按文稿触发的闪避：送进转写之后，计划里的声音按有效词流压低（与导出的声音计划同一份词流）；没有转写时不压低。
#[test]
fn speech_ducking_follows_the_transcripts_sent_in() {
    let mut video = video();
    video["sequences"]["seq_main"]["ducking"] = json!([{
        "id": "duck_speech", "enabled": true, "trigger": { "kind": "speech" }, "target": { "itemIds": ["item_music"] },
        "depth": 12, "attack": { "ticks": "1", "timescale": 10 }, "release": { "ticks": "1", "timescale": 10 },
    }]);
    set_video(json!({ "video": video }).to_string().as_bytes()).unwrap();
    let music_gain = |seconds: f64| -> f64 {
        let plan: Value = serde_json::from_str(&plan(seconds).unwrap()).unwrap();
        let voice = plan["voices"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["itemId"] == "item_music")
            .cloned();
        voice.expect("音乐在响")["gainDb"].as_f64().unwrap()
    };
    let before = music_gain(1.5);

    let body = json!({ "schema": "baocut.speech/1", "clock": "sequence", "timescale": 1000,
        "words": [{ "id": "w1", "text": "你好", "start": 1000, "end": 2000 }] });
    set_speech(json!([{ "documentId": "doc_speech", "body": body }]).to_string().as_bytes()).unwrap();
    assert!((music_gain(1.5) - (before - 12.0)).abs() < 1e-9);
    // 换视频之后词流重算（规则还在，转写还在）。
    set_video(json!({ "video": video }).to_string().as_bytes()).unwrap();
    assert!((music_gain(1.5) - (before - 12.0)).abs() < 1e-9);
    set_speech(b"[]").unwrap();
    assert_eq!(music_gain(1.5), before);
    assert_eq!(set_speech(b"{").unwrap_err().code, "INVALID_DOCUMENTS");
}

/// 一段合成的 48 kHz 单声道声音：440 Hz 与 3 kHz 交替。
fn tone(samples: usize) -> Vec<f32> {
    (0..samples)
        .map(|i| {
            let hz = if (i / 9_000) % 2 == 0 { 440.0 } else { 3000.0 };
            (std::f32::consts::TAU * hz * i as f32 / 48_000.0).sin() * 0.5
        })
        .collect()
}

/// 经线性内存按块送样本，算出素材频谱。
fn analyse(pcm: &[f32], block: usize) -> Vec<u8> {
    bc_spectrum_begin();
    for part in pcm.chunks(block) {
        let bytes: Vec<u8> = part.iter().flat_map(|s| s.to_le_bytes()).collect();
        let ptr = bc_alloc(bytes.len());
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
            assert_eq!(bc_spectrum_push(ptr, bytes.len()), 0);
            bc_free(ptr, bytes.len());
        }
    }
    assert_eq!(bc_spectrum_finish(), 0);
    unsafe { std::slice::from_raw_parts(bc_output_ptr(), bc_output_len()) }.to_vec()
}

/// 素材频谱按块送进来算，与原生导出一次算整段的结果逐字节相同。
#[test]
fn asset_spectra_are_analysed_block_by_block_like_the_export() {
    let pcm = tone(50_000);
    let whole = waveform::dsp::analyze(&pcm, waveform::bcs1::SpectrumBackend::Symphonia).unwrap();
    assert_eq!(analyse(&pcm, 4_096), whole);
    assert_eq!(analyse(&pcm, 777), whole);
    // 没开始就送、字节数不是 4 的倍数、什么都没送就结束：都报错。
    assert_eq!(spectrum_push(&[0; 4]).unwrap_err().code, "NO_ANALYSIS");
    bc_spectrum_begin();
    assert_eq!(spectrum_push(&[0; 3]).unwrap_err().code, "INVALID_AUDIO");
    assert_eq!(bc_spectrum_finish(), 1);
    assert_eq!(output()["code"], "INVALID_AUDIO");
}

/// 声波按序列的声音计划取素材频谱：缺的报在 `spectra` 里，送进来之后不再报缺，也不再报提示。
#[test]
fn visualizers_ask_for_the_asset_spectra_they_hear() {
    let mut video = video();
    video["sequences"]["seq_main"]["items"].as_array_mut().unwrap().push(json!({
        "id": "item_viz", "trackId": "trk_g1", "enabled": true, "locked": false, "paintOrder": 9,
        "followPolicy": { "kind": "sequence-fixed" }, "type": "visualizer", "span": { "fromFrame": 0, "durationFrames": 60 },
        "place": { "w": 60 }, "visualizer": { "style": "bars", "mainColor": "#FFFFFF", "audio": "asset_music" }
    }));
    set_video(json!({ "video": video }).to_string().as_bytes()).unwrap();
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../crates/render-raster/assets/fonts");
    let files: Vec<String> = serde_json::from_str(&font_files()).unwrap();
    add_font(std::fs::read(dir.join(&files[0])).unwrap()).unwrap();
    let noted = |rendered: &Value| {
        rendered["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["detail"].as_str().unwrap().starts_with("item_viz："))
    };

    let rendered: Value = serde_json::from_str(&render(1.0, 160, 90, false, false).unwrap()).unwrap();
    assert_eq!(
        rendered["spectra"],
        json!([{ "itemId": "item_viz", "asset": { "id": "asset_music", "revision": "rev_1" } }])
    );
    assert!(noted(&rendered));

    set_audio_spectrum("asset_music@rev_1", analyse(&tone(48_000 * 4), 48_000));
    let rendered: Value = serde_json::from_str(&render(1.0, 160, 90, false, false).unwrap()).unwrap();
    assert_eq!(rendered["spectra"], json!([]));
    assert!(!noted(&rendered), "{}", rendered["warnings"]);

    clear_audio_spectra();
    let rendered: Value = serde_json::from_str(&render(1.0, 160, 90, false, false).unwrap()).unwrap();
    assert_eq!(rendered["spectra"].as_array().unwrap().len(), 1);
}

#[test]
fn text_is_measured_with_the_injected_fonts_like_the_native_renderer() {
    let input = json!({
        "text": "输入文字", "wrapWidth": null, "canvas": { "width": 1920, "height": 1080 },
        "style": { "fontSize": 24, "fontWeight": "bold", "lineHeight": 1.2, "backgroundColor": "#000000CC", "backgroundPadding": 14 }
    })
    .to_string();
    let measure = |input: &str| {
        let ptr = bc_alloc(input.len());
        unsafe {
            std::ptr::copy_nonoverlapping(input.as_ptr(), ptr, input.len());
            let status = bc_measure_text(ptr, input.len());
            bc_free(ptr, input.len());
            (status, output())
        }
    };
    // 没有字体时量不了。
    assert_eq!(measure(&input).1["code"], "INVALID_PARAMS");
    let files: Vec<String> = serde_json::from_str(&font_files()).unwrap();
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../crates/render-raster/assets/fonts");
    let fonts: Vec<Vec<u8>> = files.iter().map(|name| std::fs::read(dir.join(name)).unwrap()).collect();
    for font in &fonts {
        add_font(font.clone()).unwrap();
    }
    // 还没画过帧也能量；结果与原生渲染器用同一批字体量的相同。
    let (status, measured) = measure(&input);
    assert_eq!(status, 0, "{measured}");
    let options = RenderOptions {
        width: 16,
        height: 9,
        skip_unsupported: true,
        captions: true,
    };
    let mut native = FrameRenderer::new(options, Documents::default(), fonts).unwrap();
    let request: Value = serde_json::from_str(&input).unwrap();
    let expected = native.measure_text("输入文字", &request["style"], None, (1920, 1080));
    assert_eq!(measured, json!(expected));
    assert!(expected.width > 100.0 && expected.height > 30.0, "{expected:?}");
    // 给了折行宽：框宽就是它，字折成多行。
    let narrow = json!({ "text": "输入文字", "wrapWidth": 60, "canvas": { "width": 1920, "height": 1080 }, "style": request["style"] });
    let (_, wrapped) = measure(&narrow.to_string());
    assert_eq!(wrapped["width"], 60.0);
    assert!(wrapped["height"].as_f64().unwrap() > expected.height * 1.5, "{wrapped}");
    // 读不懂的参数报出来。
    assert_eq!(measure("{}").1["code"], "INVALID_PARAMS");
}

/// 内置字体之外的族：`render` 报出缺的族名与提示；宿主把本机字体文件（这里是探针字体）经 `add_font` 送进来后，
/// 已经建好的渲染器装上它重排，不再报。
#[test]
fn missing_font_families_are_reported_until_the_host_sends_the_font() {
    let mut video = video();
    let items = video["sequences"]["seq_main"]["items"].as_array_mut().unwrap();
    let title = items.iter_mut().find(|item| item["id"] == "item_title").unwrap();
    title["style"]["fontFamily"] = json!("ColrProbe");
    title["text"] = json!("A");
    set_video(json!({ "video": video }).to_string().as_bytes()).unwrap();
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../crates/render-raster/assets/fonts");
    add_font(std::fs::read(dir.join("NotoSansSC-Variable.ttf")).unwrap()).unwrap();
    let note = "item_title：字体 \"ColrProbe\" 在当前字体库中不可用，将使用 Noto Sans SC fallback";
    let notes = |rendered: &Value| -> Vec<String> {
        rendered["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|w| w["detail"].as_str().map(str::to_owned))
            .filter(|d| d.contains("ColrProbe"))
            .collect()
    };
    // 每一帧都报（预览每帧清掉报告，常设的提示照报）。
    for _ in 0..2 {
        let rendered: Value = serde_json::from_str(&render(7.5, 320, 180, true, false).unwrap()).unwrap();
        assert_eq!(rendered["fonts"], json!(["ColrProbe"]));
        assert_eq!(notes(&rendered), vec![note]);
    }
    let fallback = frame();
    let probe = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../crates/render-raster/tests/fixtures/fonts/ColrProbe.ttf");
    add_font(std::fs::read(probe).unwrap()).unwrap();
    let rendered: Value = serde_json::from_str(&render(7.5, 320, 180, true, false).unwrap()).unwrap();
    assert_eq!(rendered["fonts"], json!([]));
    assert!(notes(&rendered).is_empty(), "{rendered}");
    assert_ne!(frame(), fallback, "按送来的字体重排");
}

/// 两种尺寸来回画（预览播放与停住）：各自的渲染器留着，切回来画出的帧与只画这一种尺寸时逐字节相同；字体送进来时
/// 两台都装上（闲着的那台下次画也按新字体重排）；第三种尺寸换掉最久没用的那台，照样画对。
#[test]
fn renderers_kept_per_size_stay_exact_and_take_fonts_sent_while_idle() {
    let mut video = video();
    let items = video["sequences"]["seq_main"]["items"].as_array_mut().unwrap();
    let title = items.iter_mut().find(|item| item["id"] == "item_title").unwrap();
    title["style"]["fontFamily"] = json!("ColrProbe");
    title["text"] = json!("A");
    set_video(json!({ "video": video }).to_string().as_bytes()).unwrap();
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../crates/render-raster/assets/fonts");
    add_font(std::fs::read(dir.join("NotoSansSC-Variable.ttf")).unwrap()).unwrap();
    let draw = |width: u32, height: u32| -> (Value, Vec<u8>) {
        let rendered: Value = serde_json::from_str(&render(7.5, width, height, true, false).unwrap()).unwrap();
        let pixels = frame();
        assert_eq!(pixels.len(), (width * height * 4) as usize);
        (rendered, pixels)
    };
    let (_, large) = draw(320, 180);
    let (rendered, small) = draw(160, 90);
    assert_eq!(rendered["fonts"], json!(["ColrProbe"]));
    for _ in 0..2 {
        assert_eq!(draw(320, 180).1, large, "切回来与只画这一种尺寸相同");
        assert_eq!(draw(160, 90).1, small);
    }
    // 画着小的时候送来字体：大的那台闲着，也要装上。
    let probe = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../crates/render-raster/tests/fixtures/fonts/ColrProbe.ttf");
    add_font(std::fs::read(probe).unwrap()).unwrap();
    let (rendered, large_font) = draw(320, 180);
    assert_eq!(rendered["fonts"], json!([]), "{rendered}");
    assert_ne!(large_font, large, "闲着的那台按送来的字体重排");
    let (rendered, small_font) = draw(160, 90);
    assert_eq!(rendered["fonts"], json!([]));
    assert_ne!(small_font, small);
    // 第三种尺寸换掉最久没用的（大的）；再画大的时由当时最久没用的那台改尺寸，画面不变。
    draw(64, 36);
    assert_eq!(draw(160, 90).1, small_font, "最近用过的那台还在");
    assert_eq!(draw(320, 180).1, large_font, "改尺寸重建的与原来的相同");
}
