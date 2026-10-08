#![cfg(target_os = "windows")]

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use media_native::{DxgiPlaybackState, DxgiVideoFrame, open_dxgi_frame_server};

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-export/source.mp4")
}

fn assert_send_sync<T: Send + Sync>() {}

#[test]
fn gpu_frames_can_cross_the_decoder_and_renderer_thread_boundary() {
    assert_send_sync::<DxgiVideoFrame>();
}

#[test]
fn media_engine_publishes_shareable_gpu_frames_without_a_cpu_buffer() {
    let mut server = open_dxgi_frame_server(&fixture()).expect("打开 IMFMediaEngine frame-server");
    assert_eq!((server.width(), server.height()), (160, 90));
    assert!(server.duration_seconds() >= 0.9);
    assert_eq!(server.playback_state().unwrap(), DxgiPlaybackState::Paused);

    server.play().expect("开始播放");
    let started = Instant::now();
    let frame = loop {
        if let Some(frame) = server.try_acquire_frame().expect("查询 GPU 帧") {
            break frame;
        }
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "Media Engine 在 5 秒内没有发布视频帧"
        );
        std::thread::sleep(Duration::from_millis(5));
    };

    assert_eq!((frame.width(), frame.height()), (160, 90));
    assert!(!frame.texture_handle().is_null());
    assert!(!frame.ready_fence_handle().is_null());
    assert!(frame.ready_fence_value() > 0);
    assert!(frame.timestamp_hns() >= 0);
    assert_eq!(frame.adapter_luid(), server.adapter_luid());
    assert!(frame.surface_id() > 0);
    assert!(frame.synchronization_id() > 0);
    assert!(matches!(
        server.playback_state().unwrap(),
        DxgiPlaybackState::Playing | DxgiPlaybackState::Buffering
    ));

    server.pause().expect("暂停播放");
    assert_eq!(server.playback_state().unwrap(), DxgiPlaybackState::Paused);
    server.seek(0.5).expect("定位播放");
    assert!(matches!(
        server.playback_state().unwrap(),
        DxgiPlaybackState::Paused | DxgiPlaybackState::Buffering
    ));
}

#[test]
fn the_three_surface_pool_drops_instead_of_blocking_or_reading_back() {
    let mut server = open_dxgi_frame_server(&fixture()).expect("打开 IMFMediaEngine frame-server");
    server.play().expect("开始播放");
    let started = Instant::now();
    let mut held = Vec::new();
    while held.len() < 3 && started.elapsed() < Duration::from_secs(5) {
        if let Some(frame) = server.try_acquire_frame().expect("查询 GPU 帧") {
            held.push(frame);
        } else {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    assert_eq!(held.len(), 3, "应填满三个独立的共享 surface 槽位");
    let handles = held
        .iter()
        .map(|frame| frame.texture_handle() as usize)
        .collect::<HashSet<_>>();
    assert_eq!(handles.len(), 3, "三个槽位必须持有三个不同的 NT handle");
    let surface_ids = held
        .iter()
        .map(DxgiVideoFrame::surface_id)
        .collect::<HashSet<_>>();
    assert_eq!(surface_ids.len(), 3, "三个槽位必须有三个稳定 surface id");
    let synchronization_ids = held
        .iter()
        .map(DxgiVideoFrame::synchronization_id)
        .collect::<HashSet<_>>();
    assert_eq!(
        synchronization_ids.len(),
        1,
        "同一 frame-server 的三槽共用一条 shared fence"
    );

    let before = Instant::now();
    while server.dropped_frame_count() == 0 && before.elapsed() < Duration::from_secs(1) {
        assert!(
            server
                .try_acquire_frame()
                .expect("池满时查询 GPU 帧")
                .is_none(),
            "三个 surface 都被持有时不得覆盖仍在消费的纹理"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(
        server.dropped_frame_count() > 0,
        "池满后应观测到非阻塞丢帧，而不是卡住解码线程"
    );
}
