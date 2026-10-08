//! 时间模型验收 TM01–TM07（验收规范 §6.7）。涉及视频事务的部分在 video-engine 的测试里。

use editor_semantics::*;

fn grid(fps: Rate) -> GridContext<'static> {
    GridContext {
        sequence_id: "main",
        sequence_revision: "7",
        fps,
    }
}

fn secs(value: &str) -> TimelineTimeInput {
    TimelineTimeInput::Seconds { value: value.into() }
}

fn mt(ticks: i64, timescale: i64) -> MediaTime {
    MediaTime {
        ticks: ticks.to_string(),
        timescale,
    }
}

#[test]
fn tm01_seconds_and_frames_land_on_the_same_frame() {
    let fps = Rate::new(30, 1).unwrap();
    let by_seconds = quantize_input(&secs("12.5"), &grid(fps), FrameAlignment::NearestFrame, "at").unwrap();
    let by_frames = quantize_input(
        &TimelineTimeInput::Frames { value: 375 },
        &grid(fps),
        FrameAlignment::NearestFrame,
        "at",
    )
    .unwrap();
    assert_eq!(by_seconds.frame, 375);
    assert_eq!(by_frames.frame, 375);
    assert_eq!(by_seconds.receipt.actual_time, by_frames.receipt.actual_time);
    assert_eq!(by_seconds.receipt.actual_time, mt(25, 2));
    assert_eq!(by_seconds.receipt.delta, MediaTime::zero());
}

#[test]
fn tm02_ntsc_ten_seconds_nearest_frame() {
    let fps = Rate::new(30000, 1001).unwrap();
    let q = quantize_input(&secs("10"), &grid(fps), FrameAlignment::NearestFrame, "at").unwrap();
    assert_eq!(q.frame, 300);
    assert_eq!(q.receipt.requested_time, mt(10, 1));
    assert_eq!(q.receipt.actual_time, mt(1001, 100));
    assert_eq!(q.receipt.delta, mt(1, 100));
    assert_eq!(q.receipt.edit_fps, fps);
    assert_eq!(q.receipt.policy, FrameAlignment::NearestFrame);
    assert_eq!(q.receipt.sequence_revision, "7");
}

#[test]
fn tm03_exact_frame_rejects_and_ties_go_to_the_earlier_edge() {
    let ntsc = Rate::new(30000, 1001).unwrap();
    let err = quantize_input(&secs("10.000"), &grid(ntsc), FrameAlignment::ExactFrame, "at")
        .err()
        .unwrap();
    assert_eq!(err.code(), "TIME_NOT_ON_FRAME_GRID");
    match err {
        TimeError::NotOnFrameGrid { floor, ceil, nearest, .. } => assert_eq!((floor, ceil, nearest), (299, 300, 300)),
        other => panic!("{other:?}"),
    }

    let fps = Rate::new(30, 1).unwrap();
    // 0.05 秒恰在第 1 帧与第 2 帧正中。
    let tie = quantize_input(&secs("0.05"), &grid(fps), FrameAlignment::NearestFrame, "at").unwrap();
    assert_eq!(tie.frame, 1);
    assert_eq!(tie.receipt.delta, mt(-1, 60));
    let floor = quantize_input(&secs("0.05"), &grid(fps), FrameAlignment::FloorFrame, "at").unwrap();
    let ceil = quantize_input(&secs("0.05"), &grid(fps), FrameAlignment::CeilFrame, "at").unwrap();
    assert_eq!((floor.frame, ceil.frame), (1, 2));
    let exact = quantize_input(&secs("0.1"), &grid(fps), FrameAlignment::ExactFrame, "at").unwrap();
    assert_eq!(exact.frame, 3);
}

#[test]
fn tm04_frames_belong_to_the_command_sequence_only() {
    // 帧输入只有「unit: frames」一种，按命令所属序列换算；源帧、输出帧之类的单位在反序列化时就被拒绝。
    let source_frames = serde_json::from_str::<TimelineTimeInput>(r#"{"unit":"sourceFrames","value":10}"#);
    assert!(source_frames.is_err());
    let both = serde_json::from_str::<TimelineTimeInput>(r#"{"unit":"seconds","value":"1","frames":30}"#);
    assert!(both.is_err());
    let bare = serde_json::from_str::<TimelineTimeInput>(r#"{"value":30}"#);
    assert!(bare.is_err());
    // 同一个帧号在不同序列帧率下是不同的时间：不猜帧率。
    let at = TimelineTimeInput::Frames { value: 300 };
    assert_eq!(
        at.resolve(Rate::new(30, 1).unwrap(), "at", false).unwrap(),
        Ratio::new(10, 1).unwrap()
    );
    assert_eq!(
        at.resolve(Rate::new(60, 1).unwrap(), "at", false).unwrap(),
        Ratio::new(5, 1).unwrap()
    );
}

#[test]
fn tm05_exact_decimal_and_equivalent_values() {
    assert_eq!(parse_decimal_seconds("0.1", "t").unwrap(), Ratio::new(1, 10).unwrap());
    assert_eq!(parse_decimal_seconds("10.000", "t").unwrap(), Ratio::new(10, 1).unwrap());
    let a = mt(1500, 1000);
    let b = mt(3, 2);
    assert_eq!(compare_time(&a, &b).unwrap(), std::cmp::Ordering::Equal);
    assert_eq!(a.canonical_key("a").unwrap(), b.canonical_key("b").unwrap());
    assert_eq!(MediaTime::from_ratio(a.to_ratio("a").unwrap(), "a").unwrap(), b);
    assert_eq!(format_decimal_seconds(Ratio::new(1001, 100).unwrap()).as_deref(), Some("10.01"));
    assert_eq!(format_decimal_seconds(Ratio::new(-1, 60).unwrap()), None);
}

#[test]
fn tm06_invalid_values_fail_without_float_fallback() {
    for bad in [
        "NaN",
        "Infinity",
        "-Infinity",
        "1e3",
        "1E-2",
        "+1",
        ".5",
        "5.",
        "",
        " 1",
        "1,5",
        "0x10",
        "1.2.3",
    ] {
        let err = parse_decimal_seconds(bad, "t").err().unwrap_or_else(|| panic!("{bad:?} 应被拒绝"));
        assert_eq!(err.code(), "INVALID_TIME_VALUE", "{bad:?}");
    }
    let huge = parse_decimal_seconds("1234567890123456789012", "t").err().unwrap();
    assert_eq!(huge.code(), "TIME_ARITHMETIC_OVERFLOW");
    let precise = parse_decimal_seconds("0.1234567890123456789", "t").err().unwrap();
    assert_eq!(precise.code(), "TIME_ARITHMETIC_OVERFLOW");
    // 绝对位置不能为负。
    assert_eq!(
        secs("-1").resolve(Rate::new(30, 1).unwrap(), "at", false).err().unwrap().code(),
        "INVALID_TIME_VALUE"
    );
    // 零分母、负分母、未约分、超限的 Rate 与 MediaTime。
    assert_eq!(Rate::new(30, 0).err().unwrap().code(), "INVALID_TIME_VALUE");
    assert_eq!(Rate::new(60, 2).err().unwrap().code(), "INVALID_TIME_VALUE");
    assert_eq!(Rate::new(1 << 60, 1).err().unwrap().code(), "TIME_ARITHMETIC_OVERFLOW");
    assert_eq!(mt(1, 0).to_ratio("t").err().unwrap().code(), "INVALID_TIME_VALUE");
    assert_eq!(
        MediaTime {
            ticks: "1.5".into(),
            timescale: 1
        }
        .to_ratio("t")
        .err()
        .unwrap()
        .code(),
        "INVALID_TIME_VALUE"
    );
    assert_eq!(
        MediaTime {
            ticks: "1e3".into(),
            timescale: 1
        }
        .to_ratio("t")
        .err()
        .unwrap()
        .code(),
        "INVALID_TIME_VALUE"
    );
    let overflow = MediaTime {
        ticks: "9".repeat(40),
        timescale: 1,
    };
    assert_eq!(overflow.to_ratio("t").err().unwrap().code(), "TIME_ARITHMETIC_OVERFLOW");
    // 帧号必须是安全整数；JSON 里的小数与指数在反序列化时就被拒绝。
    let frames = TimelineTimeInput::Frames { value: 1 << 60 };
    assert_eq!(
        frames.resolve(Rate::new(30, 1).unwrap(), "at", false).err().unwrap().code(),
        "TIME_ARITHMETIC_OVERFLOW"
    );
    assert!(serde_json::from_str::<TimelineTimeInput>(r#"{"unit":"frames","value":1.5}"#).is_err());
    assert!(serde_json::from_str::<TimelineTimeInput>(r#"{"unit":"frames","value":1e3}"#).is_err());
    assert!(serde_json::from_str::<TimelineTimeInput>(r#"{"unit":"seconds","value":12.5}"#).is_err());
}

#[test]
fn tm07_relative_moves_quantize_the_absolute_target_once() {
    let fps = Rate::new(30, 1).unwrap();
    // 起点不在帧上（例如音频的精确位置 0.02 秒），连续三次「晚 0.02 秒」。
    let start = parse_decimal_seconds("0.02", "t").unwrap();
    let step = parse_decimal_seconds("0.02", "t").unwrap();
    let mut exact = start;
    for _ in 0..3 {
        exact = exact.checked_add(step).unwrap();
    }
    let once = quantize_exact(exact, secs("0.08"), &grid(fps), FrameAlignment::NearestFrame, "at").unwrap();
    assert_eq!(once.frame, 2);
    // 若每次先把 0.02 秒舍入成 1 帧再累加，会落到第 3 帧：这正是要避免的累计偏差。
    let per_step = quantize_frame(step, fps, FrameAlignment::NearestFrame, "t").unwrap();
    assert_eq!(per_step * 3, 3);
    assert_ne!(once.frame, per_step * 3);
}

#[test]
fn map_time_matches_the_spec_example() {
    // 视频格式规范 §2.5 的例子：30 fps，fromFrame=90，sourceIn=2 秒，rate=3/2。
    let fps = Rate::new(30, 1).unwrap();
    let map = TimeMap::Linear {
        source_in: mt(2, 1),
        rate: Rate::new(3, 2).unwrap(),
    };
    let start = frame_time(90, fps).unwrap();
    assert_eq!(
        map_time(&map, start, frame_time(120, fps).unwrap()).unwrap(),
        Ratio::new(7, 2).unwrap()
    );
    let half = Ratio::new(4, 1).unwrap().checked_add(Ratio::new(1, 60).unwrap()).unwrap();
    assert_eq!(
        map_time(&map, start, half).unwrap(),
        Ratio::new(7, 2).unwrap().checked_add(Ratio::new(1, 40).unwrap()).unwrap()
    );
}

#[test]
fn timestamps_round_half_to_even_from_absolute_index() {
    let ntsc = Rate::new(30000, 1001).unwrap();
    assert_eq!(timestamp_at(0, ntsc), Some(0));
    assert_eq!(timestamp_at(1, ntsc), Some(33367));
    assert_eq!(timestamp_at(1_000_000, ntsc), Some(33_366_666_667));
    // 1/2 微秒正中：8 fps 下第 1 帧是 125000 微秒，构造 2_000_000 fps 的 1 帧 = 0.5 微秒。
    let fast = Rate::new(2_000_000, 1).unwrap();
    assert_eq!(timestamp_at(1, fast), Some(0));
    assert_eq!(timestamp_at(3, fast), Some(2));
}
