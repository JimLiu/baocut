//! `AnimatedImage`（GIF / APNG / 动画 WebP）的 source conformance（设计 §10 阶段 6）。
//!
//! 四条验收逐条对应可执行断言：
//! * **任意时间直接 seek** —— `random_seek_needs_no_warm_up`
//! * **顺序与乱序采样相同** —— `shuffled_sampling_equals_sorted_sampling`
//! * **子资源全部进 hash** —— `the_fingerprint_covers_every_frame_and_delay`
//! * **渲染期无网络 / 源不持有增量时钟** —— `sampling_takes_only_a_shared_reference`
//!   加上"重复采样逐字节相同"（源里根本没有可变状态可持有）
//!
//! 夹具是**程序生成**的（`write_animated_fixtures`，`#[ignore]`），落在
//! `core/fixtures/animated/`：跟 `core/fixtures/gen.sh` 一个路子，但用 crate 而
//! 不是 ffmpeg——逐帧 disposal / blend / loop count 需要精确控制，ffmpeg 给不了。
//! `animated_fixtures_are_up_to_date` 是日常门禁，挡住"改了生成器忘了写盘"。

use render_raster::source::animated_image::{
    AnimatedFormat, AnimatedImage, AnimatedImageBudgetExceeded,
};
use render_raster::source::{MediaTime, PrepareCtx, SourceLoop, VisualSource, frame_index};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

mod fixture_gen;

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/animated")
}

fn load(name: &str) -> AnimatedImage {
    let path = fixture_dir().join(name);
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("读取 {}：{e}", path.display()));
    AnimatedImage::decode(name, &bytes, &PrepareCtx::default())
        .unwrap_or_else(|e| panic!("解码 {name}：{e:#}"))
}

fn frame_digest(pixmap: &tiny_skia::Pixmap) -> String {
    let mut h = Sha256::new();
    h.update(pixmap.data());
    // sha2 0.11 的摘要（hybrid-array）没有 `LowerHex`，逐字节写出，与 v2 的 `{:x}` 同值。
    let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    hex[..16].to_string()
}

// ── 夹具生成与门禁 ──────────────────────────────────────────────────

/// 写盘用：`cargo test -p bcut-render --test animated_source -- --ignored`
#[test]
#[ignore]
fn write_animated_fixtures() {
    let dir = fixture_dir();
    std::fs::create_dir_all(&dir).expect("建夹具目录");
    for (name, bytes) in fixture_gen::fixtures() {
        std::fs::write(dir.join(&name), &bytes).expect("写夹具");
    }
    // golden：逐帧 PNG + 一张采样表
    for (name, _) in fixture_gen::fixtures() {
        let src = load(&name);
        let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(&name);
        let golden = dir.join(stem);
        std::fs::create_dir_all(&golden).expect("建 golden 目录");
        for i in 0..src.frame_count() {
            let png = src.frame(i).expect("帧").encode_png().expect("编码 PNG");
            std::fs::write(golden.join(format!("frame-{i}.png")), png).expect("写 golden 帧");
        }
    }
    std::fs::write(dir.join("expected.json"), expected_json()).expect("写 expected.json");
}

/// 生成器与committed 夹具必须一致（`gen_preview_presets` 同款门禁）。
#[test]
fn animated_fixtures_are_up_to_date() {
    let dir = fixture_dir();
    for (name, bytes) in fixture_gen::fixtures() {
        let on_disk = std::fs::read(dir.join(&name))
            .unwrap_or_else(|e| panic!("{name} 缺失（跑 --ignored write_animated_fixtures）：{e}"));
        assert_eq!(
            on_disk, bytes,
            "{name} 与生成器不一致：改了 fixture_gen 就要重新写盘"
        );
    }
    assert_eq!(
        std::fs::read_to_string(dir.join("expected.json")).expect("expected.json"),
        expected_json(),
        "expected.json 与当前解码结果不一致"
    );
}

/// golden 采样表：元数据 + 逐帧摘要 + 一组采样点。手写 JSON（不给测试引入
/// serde 派生），键序固定，逐字节可比。
fn expected_json() -> String {
    let mut out = String::from("{\n");
    let names: Vec<String> = fixture_gen::fixtures()
        .into_iter()
        .map(|(n, _)| n)
        .collect();
    for (fi, name) in names.iter().enumerate() {
        let src = load(name);
        let meta = src.probe().expect("probe");
        out.push_str(&format!("  \"{name}\": {{\n"));
        out.push_str(&format!("    \"format\": \"{}\",\n", src.format().as_str()));
        out.push_str(&format!(
            "    \"size\": [{}, {}],\n",
            meta.width, meta.height
        ));
        out.push_str(&format!("    \"frames\": {},\n", meta.frame_count()));
        out.push_str(&format!("    \"durationMs\": {},\n", meta.total_ms()));
        out.push_str(&format!("    \"loops\": \"{}\",\n", meta.loops));
        out.push_str(&format!(
            "    \"frameStartsMs\": {:?},\n",
            meta.frame_starts_ms
        ));
        out.push_str(&format!(
            "    \"fingerprint\": \"{}\",\n",
            src.fingerprint()
        ));
        out.push_str("    \"frameDigests\": [");
        for i in 0..src.frame_count() {
            if i > 0 {
                out.push_str(", ");
            }
            out.push_str(&format!("\"{}\"", frame_digest(&src.frame(i).unwrap())));
        }
        out.push_str("],\n    \"samples\": [\n");
        let total = meta.total_ms();
        let mut points: Vec<i64> = vec![-10, 0, total / 3, total / 2, total - 1, total, total * 3];
        for start in &meta.frame_starts_ms {
            points.push(*start);
        }
        points.sort_unstable();
        points.dedup();
        for (i, ms) in points.iter().enumerate() {
            let frame = src.sample(MediaTime::from_millis(*ms)).expect("sample");
            let px = frame.pixmap.pixel(0, 0).expect("像素");
            out.push_str(&format!(
                "      {{ \"ms\": {ms}, \"index\": {}, \"startMs\": {}, \"topLeft\": [{}, {}, {}, {}] }}{}\n",
                frame.index,
                frame.start.millis(),
                px.red(),
                px.green(),
                px.blue(),
                px.alpha(),
                if i + 1 == points.len() { "" } else { "," }
            ));
        }
        out.push_str("    ]\n  }");
        out.push_str(if fi + 1 == names.len() { "\n" } else { ",\n" });
    }
    out.push_str("}\n");
    out
}

// ── conformance ─────────────────────────────────────────────────────

#[test]
fn every_container_decodes_with_its_own_duration_table() {
    let gif = load("stripes.gif");
    assert_eq!(gif.format(), AnimatedFormat::Gif);
    let meta = gif.probe().unwrap();
    assert_eq!(meta.frame_count(), 4);
    assert_eq!(meta.frame_starts_ms, vec![0, 100, 300, 600, 1000]);
    assert_eq!(meta.loops, SourceLoop::Infinite);
    assert_eq!((meta.width, meta.height), (8, 8));

    let apng = load("pulse.png");
    assert_eq!(apng.format(), AnimatedFormat::Apng);
    let meta = apng.probe().unwrap();
    assert_eq!(meta.frame_count(), 3);
    // 40ms + 100ms + 60ms：APNG 的分数延时（1/25、1/10、3/50）取整到毫秒
    assert_eq!(meta.frame_starts_ms, vec![0, 40, 140, 200]);
    assert_eq!(meta.loops, SourceLoop::Finite(1));

    let webp = load("wave.webp");
    assert_eq!(webp.format(), AnimatedFormat::WebP);
    let meta = webp.probe().unwrap();
    assert_eq!(meta.frame_count(), 3);
    assert_eq!(meta.frame_starts_ms, vec![0, 50, 150, 300]);
    assert_eq!(meta.loops, SourceLoop::Infinite);
}

/// 逐帧颜色不同——「四帧其实是同一张图」这种假绿要挡住。
#[test]
fn the_frames_are_actually_different() {
    for name in ["stripes.gif", "pulse.png", "wave.webp", "disposal.gif"] {
        let src = load(name);
        let digests: Vec<String> = (0..src.frame_count())
            .map(|i| frame_digest(&src.frame(i).unwrap()))
            .collect();
        let mut sorted = digests.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), digests.len(), "{name} 有两帧完全相同");
    }
}

/// disposal 与画布合成：`Keep` 让上一帧的底透出来，`Background` 把**自己那块
/// 帧矩形**处置成背景（不是整幅画布）——两条 disposal 语义各留一处可观察证据。
#[test]
fn disposal_and_canvas_composition_are_honoured() {
    let src = load("disposal.gif");
    let meta = src.probe().unwrap();
    assert_eq!(meta.frame_count(), 3);
    assert_eq!(meta.loops, SourceLoop::Finite(2), "有限 loop count 被保留");

    let px = |i: usize, x: u32, y: u32| {
        let p = src.frame(i).unwrap().pixel(x, y).unwrap();
        (p.red(), p.green(), p.blue(), p.alpha())
    };
    // 帧 0：整幅红
    assert_eq!(px(0, 0, 0), (0xe0, 0x20, 0x20, 255));
    assert_eq!(px(0, 7, 7), (0xe0, 0x20, 0x20, 255));
    // 帧 1（dispose = Keep 的帧 0 之后）：红底 + 中间 4×4 绿块
    assert_eq!(px(1, 0, 0), (0xe0, 0x20, 0x20, 255), "帧 0 的红底被保留");
    assert_eq!(px(1, 3, 3), (0x20, 0xc0, 0x20, 255), "绿块合成在红底上");
    // 帧 2：左上 4×4 是本帧的蓝块
    assert_eq!(px(2, 1, 1), (0x20, 0x40, 0xe0, 255), "左上蓝块");
    // 帧 1 的 `Background` **只作用于它自己的帧矩形**（(2,2) 起的 4×4）——
    // 这正是 GIF disposal 的规范语义，不是"清空整幅画布"
    assert_eq!(px(2, 5, 5), (0, 0, 0, 0), "帧 1 的矩形被处置成背景（透明）");
    assert_eq!(
        px(2, 7, 7),
        (0xe0, 0x20, 0x20, 255),
        "矩形之外仍是帧 0 保留的红底"
    );
}

/// **任意时间直接 seek**：从末尾往回、跳着采样，与从头顺序走到同一时刻一致。
#[test]
fn random_seek_needs_no_warm_up() {
    let src = load("stripes.gif");
    let cold = src.sample(MediaTime::from_millis(750)).unwrap();
    // 另开一个源，先把整段顺序走一遍，再采同一点
    let warm_src = load("stripes.gif");
    for ms in (0..1000).step_by(10) {
        let _ = warm_src.sample(MediaTime::from_millis(ms)).unwrap();
    }
    let warm = warm_src.sample(MediaTime::from_millis(750)).unwrap();
    assert_eq!(cold.index, warm.index);
    assert_eq!(cold.pixmap.data(), warm.pixmap.data());
}

/// **顺序 vs 乱序**：同一组时刻，正序、逆序与固定洗牌序逐字节相同。
#[test]
fn shuffled_sampling_equals_sorted_sampling() {
    for name in ["stripes.gif", "pulse.png", "wave.webp", "disposal.gif"] {
        let src = load(name);
        let total = src.probe().unwrap().total_ms();
        let points: Vec<i64> = (0..=32).map(|i| total * i / 32).collect();

        let sorted: Vec<(usize, String)> = points
            .iter()
            .map(|ms| {
                let f = src.sample(MediaTime::from_millis(*ms)).unwrap();
                (f.index, frame_digest(&f.pixmap))
            })
            .collect();

        // 固定洗牌（splitmix 风格的确定性置换，不引入 rand 依赖）
        let mut order: Vec<usize> = (0..points.len()).collect();
        let mut state = 0x9e3779b97f4a7c15u64;
        for i in (1..order.len()).rev() {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            order.swap(i, (state >> 33) as usize % (i + 1));
        }
        let mut shuffled = vec![(usize::MAX, String::new()); points.len()];
        for i in order {
            let f = src.sample(MediaTime::from_millis(points[i])).unwrap();
            shuffled[i] = (f.index, frame_digest(&f.pixmap));
        }
        assert_eq!(sorted, shuffled, "{name} 的乱序采样与顺序采样不一致");

        // 逆序也走一遍
        let mut reversed = vec![(usize::MAX, String::new()); points.len()];
        for i in (0..points.len()).rev() {
            let f = src.sample(MediaTime::from_millis(points[i])).unwrap();
            reversed[i] = (f.index, frame_digest(&f.pixmap));
        }
        assert_eq!(sorted, reversed, "{name} 的逆序采样与顺序采样不一致");
    }
}

/// 同一时刻重复采样恒等——源没有可变状态可以偷偷推进。
#[test]
fn sampling_takes_only_a_shared_reference() {
    let src = load("wave.webp");
    fn sample_via_trait(source: &dyn VisualSource, ms: i64) -> (usize, Vec<u8>) {
        let f = source.sample(MediaTime::from_millis(ms)).unwrap();
        (f.index, f.pixmap.data().to_vec())
    }
    let a = sample_via_trait(&src, 120);
    for _ in 0..5 {
        assert_eq!(a, sample_via_trait(&src, 120));
    }
}

/// **子资源全部进 hash**：改任何一帧的像素、任何一条 delay、loop count，
/// 指纹都必须变；同样的字节两次解码指纹相同。
#[test]
fn the_fingerprint_covers_every_frame_and_delay() {
    let base = fixture_gen::stripes_gif(
        fixture_gen::STRIPE_COLOURS,
        fixture_gen::STRIPE_DELAYS_CS,
        gif::Repeat::Infinite,
    );
    let hash = |bytes: &[u8]| {
        AnimatedImage::decode("t.gif", bytes, &PrepareCtx::default())
            .unwrap()
            .fingerprint()
    };
    let h0 = hash(&base);
    assert_eq!(h0, hash(&base), "同样的字节必须给出同样的指纹");

    let mut colours = fixture_gen::STRIPE_COLOURS;
    colours[2][0] = colours[2][0].wrapping_add(1); // 只动第 3 帧的一个色分量
    let recoloured = fixture_gen::stripes_gif(
        colours,
        fixture_gen::STRIPE_DELAYS_CS,
        gif::Repeat::Infinite,
    );
    assert_ne!(h0, hash(&recoloured), "改一帧像素必须换指纹");

    let mut delays = fixture_gen::STRIPE_DELAYS_CS;
    delays[1] += 1;
    let retimed =
        fixture_gen::stripes_gif(fixture_gen::STRIPE_COLOURS, delays, gif::Repeat::Infinite);
    assert_ne!(h0, hash(&retimed), "改一条 delay 必须换指纹");

    let relooped = fixture_gen::stripes_gif(
        fixture_gen::STRIPE_COLOURS,
        fixture_gen::STRIPE_DELAYS_CS,
        gif::Repeat::Finite(3),
    );
    assert_ne!(h0, hash(&relooped), "改 loop count 必须换指纹");
}

/// 源本身不循环：末端之后一律冻结末帧，循环折叠是调用方（元素的
/// `loop` / `segment` 语义）的事。
#[test]
fn the_source_itself_never_loops() {
    let src = load("stripes.gif");
    let last = src.probe().unwrap().frame_count() - 1;
    for ms in [1000, 1001, 5_000, 1_000_000] {
        assert_eq!(src.sample(MediaTime::from_millis(ms)).unwrap().index, last);
    }
    for ms in [-1, -1000] {
        assert_eq!(src.sample(MediaTime::from_millis(ms)).unwrap().index, 0);
    }
}

/// 帧起点量化：一帧窗口内的任何时刻都落在同一帧起点上——静止帧缓存与帧指纹
/// 靠它命中（同一帧的连续时刻必须给出逐字节相同的 DrawOp）。
#[test]
fn every_instant_inside_a_frame_quantises_to_the_same_start() {
    let src = load("stripes.gif");
    let meta = src.probe().unwrap();
    for i in 0..meta.frame_count() {
        let (from, to) = (meta.frame_starts_ms[i], meta.frame_starts_ms[i + 1]);
        for ms in from..to {
            let f = src.sample(MediaTime::from_millis(ms)).unwrap();
            assert_eq!(f.index, i, "{ms}ms 应落在第 {i} 帧");
            assert_eq!(f.start.millis(), from);
            assert_eq!(frame_index(&meta.frame_starts_ms, ms), i);
        }
    }
}

// ── 拒绝路径 ────────────────────────────────────────────────────────

#[test]
fn static_containers_are_refused_with_a_pointer_to_type_image() {
    let png = fixture_gen::static_png();
    let err = AnimatedImage::decode("logo.png", &png, &PrepareCtx::default())
        .expect_err("静态 PNG 不该被当动图收下");
    assert!(
        format!("{err:#}").contains("type: \"image\""),
        "错误要指路到 type: image，实际：{err:#}"
    );

    let jpegish = b"\xff\xd8\xff\xe0 not a container";
    let err = AnimatedImage::decode("x.jpg", jpegish, &PrepareCtx::default()).expect_err("非容器");
    assert!(format!("{err:#}").contains("GIF / APNG / WebP"));
}

#[test]
fn the_decode_budget_is_enforced() {
    let bytes = fixture_gen::stripes_gif(
        fixture_gen::STRIPE_COLOURS,
        fixture_gen::STRIPE_DELAYS_CS,
        gif::Repeat::Infinite,
    );
    let tight = PrepareCtx {
        max_frames: 2,
        ..PrepareCtx::default()
    };
    let err = AnimatedImage::decode("t.gif", &bytes, &tight).expect_err("帧数超限");
    assert_eq!(
        err.downcast_ref::<AnimatedImageBudgetExceeded>(),
        Some(&AnimatedImageBudgetExceeded::Frames {
            actual: 3,
            limit: 2
        })
    );

    let thin = PrepareCtx {
        max_bytes: 64,
        ..PrepareCtx::default()
    };
    let err = AnimatedImage::decode("t.gif", &bytes, &thin).expect_err("字节超限");
    assert_eq!(
        err.downcast_ref::<AnimatedImageBudgetExceeded>(),
        Some(&AnimatedImageBudgetExceeded::Bytes {
            actual: 8 * 8 * 4,
            limit: 64
        })
    );
}

#[test]
fn a_zero_length_animation_is_refused() {
    let bytes = fixture_gen::stripes_gif(
        fixture_gen::STRIPE_COLOURS,
        [0, 0, 0, 0],
        gif::Repeat::Infinite,
    );
    let err = AnimatedImage::decode("t.gif", &bytes, &PrepareCtx::default())
        .expect_err("总时长 0 不该收下");
    assert!(format!("{err:#}").contains("总时长为 0"));
}

/// golden 帧 PNG 与当前解码结果逐字节一致。
#[test]
fn the_golden_frames_match_the_decoder() {
    for (name, _) in fixture_gen::fixtures() {
        let src = load(&name);
        let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(&name);
        for i in 0..src.frame_count() {
            let path = fixture_dir().join(stem).join(format!("frame-{i}.png"));
            let want = std::fs::read(&path)
                .unwrap_or_else(|e| panic!("读取 golden {}：{e}", path.display()));
            let got = src.frame(i).unwrap().encode_png().unwrap();
            assert_eq!(want, got, "{name} 第 {i} 帧与 golden 不一致");
        }
    }
}
