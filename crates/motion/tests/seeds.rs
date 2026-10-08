//! 阶段 3 验收（设计 §10 阶段 3 / §11）：随机效果必须显式播种、缺省 0，
//! 同 seed 同输出、异 seed 只影响声明为随机的通道，乱序采样与顺序采样一致。

use motion::composite::PoseBuffer;
use motion::graph::{CompileCtx, compile};
use motion::program::TargetId;
use motion::rng::splitmix64;
use motion::sample::sample;
use motion::{FlowParseCtx, parse_flow};
use serde_json::{Value, json};

fn program(flow: Value) -> motion::MotionProgram {
    let graph = parse_flow(&flow, &FlowParseCtx::default()).expect("parse");
    compile(&graph, &CompileCtx::default()).expect("compile")
}

fn samples(flow: Value, prop: &str) -> Vec<u64> {
    let program = program(flow);
    (0..240)
        .map(|step| {
            let mut buf = PoseBuffer::identity();
            sample(&program, TargetId::SELF, step as f64 * 0.01, &mut buf);
            buf.scalar_or(prop, 0.0).to_bits()
        })
        .collect()
}

fn noisy(seed: Option<u64>) -> Value {
    let mut op = json!({
        "op": "parallel",
        "items": [
            {"op": "noise", "prop": "x", "amplitude": 6.0, "period": 0.5, "dur": 2.0,
             "composite": "add"},
            {"op": "tween", "prop": "opacity", "from": 0, "to": 1, "dur": 0.4,
             "curve": "easeOutCubic"}
        ]
    });
    if let Some(seed) = seed {
        op["items"][0]["seed"] = json!(seed);
    }
    op
}

#[test]
fn the_same_seed_gives_the_same_output() {
    assert_eq!(samples(noisy(Some(7)), "x"), samples(noisy(Some(7)), "x"));
}

#[test]
fn an_omitted_seed_is_compiled_to_zero_not_to_a_random_source() {
    assert_eq!(samples(noisy(None), "x"), samples(noisy(Some(0)), "x"));
    assert_ne!(samples(noisy(None), "x"), samples(noisy(Some(1)), "x"));
}

#[test]
fn a_different_seed_only_moves_the_channel_declared_random() {
    let a = samples(noisy(Some(0)), "opacity");
    let b = samples(noisy(Some(99)), "opacity");
    assert_eq!(a, b, "seed 不得影响非随机通道");
    assert_ne!(samples(noisy(Some(0)), "x"), samples(noisy(Some(99)), "x"));
}

#[test]
fn the_channel_key_derives_a_separate_sub_seed() {
    let two_axes = json!({
        "op": "parallel",
        "items": [
            {"op": "noise", "prop": "x", "amplitude": 6.0, "period": 0.5, "dur": 2.0,
             "seed": 3, "channel": 0, "composite": "add"},
            {"op": "noise", "prop": "y", "amplitude": 6.0, "period": 0.5, "dur": 2.0,
             "seed": 3, "channel": 1, "composite": "add"}
        ]
    });
    let program = program(two_axes);
    let mut differs = false;
    for step in 1..200 {
        let mut buf = PoseBuffer::identity();
        sample(&program, TargetId::SELF, step as f64 * 0.01, &mut buf);
        if buf.scalar_or("x", 0.0) != buf.scalar_or("y", 0.0) {
            differs = true;
            break;
        }
    }
    assert!(differs, "channel 应当派生出不同的子种子");
}

/// 乱序采样 = 顺序采样（阶段 0 的写法：固定 splitmix64 种子 Fisher–Yates）。
#[test]
fn shuffled_sampling_matches_sequential_sampling() {
    let program = program(json!({
        "op": "sequence",
        "items": [
            {"op": "preset", "preset": "motion.moveIn", "dur": 0.5},
            {"op": "repeat", "count": 3, "mode": "yoyo",
             "item": {"op": "tween", "prop": "y", "from": -6, "to": 6, "dur": 0.4,
                      "curve": "easeInOutSine", "composite": "add"}},
            {"op": "noise", "prop": "x", "amplitude": 3.0, "period": 0.4, "dur": 1.0,
             "seed": 11, "composite": "add"}
        ]
    }));
    let instants: Vec<f64> = (0..400).map(|step| step as f64 * 0.008).collect();
    let read = |t: f64| {
        let mut buf = PoseBuffer::identity();
        sample(&program, TargetId::SELF, t, &mut buf);
        (
            buf.scalar_or("x", 0.0).to_bits(),
            buf.scalar_or("y", 0.0).to_bits(),
            buf.scalar_or("opacity", 1.0).to_bits(),
        )
    };
    let sequential: Vec<_> = instants.iter().map(|t| read(*t)).collect();

    let mut order: Vec<usize> = (0..instants.len()).collect();
    let mut state = 0x5EED_5EED_5EED_5EEDu64;
    for index in (1..order.len()).rev() {
        let pick = (splitmix64(&mut state) % (index as u64 + 1)) as usize;
        order.swap(index, pick);
    }
    let mut shuffled = vec![(0u64, 0u64, 0u64); instants.len()];
    for index in order {
        shuffled[index] = read(instants[index]);
    }
    assert_eq!(sequential, shuffled);
}
