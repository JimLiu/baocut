//! Lottie 语料门（环境门控）。
//!
//! 语料**不在仓库里**（第三方素材、许可各异、几十兆美术资源）。测试经
//! `BCUT_LOTTIE_CORPUS` 指向本地语料目录；没设或目录不存在就整条跳过，
//! 不 fail——CI 与别人的机器上本来就没有这批素材。
//!
//! 收集规程与 2026-08-20 的普查结果见 `core/fixtures/lottie/README.md`。
//! 进仓库的只有两份 golden：
//!
//! * `golden-frames.json`：12 个 golden 素材在固定几帧上的 **DrawOp 指纹**。
//!   钉指纹而不是像素——指纹覆盖的是矢量指令本身，跨机器不受光栅化差异与
//!   缺失外链图片影响，也正是静止帧缓存真正用的那把键。
//! * `corpus-coverage.json`：整份语料在细化子集边界下的**分类结果**——哪些
//!   完整可渲染、哪些被 `lottie-unsupported-feature` 拦下、拦的理由是什么。
//!   子集边界一动，这张表就会红。
//!
//! 重生成：`BCUT_UPDATE_GOLDEN=1 BCUT_LOTTIE_CORPUS=~/lottie-corpus cargo test -p bcut-render --test lottie_corpus`

use render_raster::drawop::{self, FrameBuilder};
use render_raster::source::lottie::Lottie;
use render_raster::source::{MediaTime, PrepareCtx, VisualSource};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

const GOLDEN_FRAMES: &str = "tests/fixtures/lottie/golden-frames.json";
const GOLDEN_COVERAGE: &str = "tests/fixtures/lottie/corpus-coverage.json";
const GOLDEN_LIST: &str = "tests/fixtures/lottie/golden-corpus.json";

fn corpus_dir() -> Option<PathBuf> {
    let raw = std::env::var("BCUT_LOTTIE_CORPUS").ok()?;
    let expanded = match raw.strip_prefix("~/") {
        Some(rest) => PathBuf::from(std::env::var("HOME").ok()?).join(rest),
        None => PathBuf::from(raw),
    };
    expanded.is_dir().then_some(expanded)
}

fn fixture(path: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(path)
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap_or_else(|e| panic!("读 {path:?}: {e}")))
        .unwrap_or_else(|e| panic!("解析 {path:?}: {e}"))
}

fn updating() -> bool {
    std::env::var("BCUT_UPDATE_GOLDEN").is_ok_and(|v| v != "0")
}

/// golden 写盘：稳定键序（`serde_json` 的 `preserve_order` 未开启 ⇒ 对象按
/// `BTreeMap` 排序）+ 两空格缩进 + 末尾换行，逐字节可比。
fn write_golden(path: &Path, value: &Value) {
    let mut text = serde_json::to_string_pretty(value).expect("序列化 golden");
    text.push('\n');
    std::fs::write(path, text).unwrap_or_else(|e| panic!("写 {path:?}: {e}"));
}

fn assert_or_update(path: &Path, actual: Value) {
    if updating() {
        write_golden(path, &actual);
        return;
    }
    let expected = read_json(path);
    if expected != actual {
        // 逐条报差异比整份 JSON diff 好读得多
        let (a, b) = (
            serde_json::to_string_pretty(&expected).unwrap(),
            serde_json::to_string_pretty(&actual).unwrap(),
        );
        panic!(
            "{path:?} 与当前实现不一致。\n期望：\n{a}\n实际：\n{b}\n\
             若这是有意的语义变化，用 BCUT_UPDATE_GOLDEN=1 重生成并在提交里说明。"
        );
    }
}

/// 语料里除 manifest 之外的全部 `.json`（`manifest.json` 是来源清单，不是
/// Lottie 文档）。
fn corpus_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .expect("读语料目录")
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| {
            path.extension().and_then(|e| e.to_str()) == Some("json")
                && path.file_name().and_then(|n| n.to_str()) != Some("manifest.json")
        })
        .collect();
    files.sort();
    files
}

/// 内嵌子资源挂上；外链子资源在语料目录里找，找不到就报出来。
fn attach(lottie: &mut Lottie) -> Result<(), String> {
    let mut loaded = Vec::new();
    for requirement in lottie.image_requirements().to_vec() {
        let Some(bytes) = requirement.embedded.clone() else {
            return Err(format!(
                "外链子资源 {} 不在语料目录里",
                requirement.path.as_deref().unwrap_or("<无路径>")
            ));
        };
        let pixmap = tiny_skia::Pixmap::decode_png(&bytes)
            .or_else(|_| {
                image::load_from_memory(&bytes)
                    .map_err(|e| e.to_string())
                    .and_then(|img| {
                        let rgba = img.to_rgba8();
                        let (w, h) = (rgba.width(), rgba.height());
                        let mut raw = rgba.into_raw();
                        for px in raw.chunks_exact_mut(4) {
                            let pm = tiny_skia::ColorU8::from_rgba(px[0], px[1], px[2], px[3])
                                .premultiply();
                            px[0] = pm.red();
                            px[1] = pm.green();
                            px[2] = pm.blue();
                            px[3] = pm.alpha();
                        }
                        tiny_skia::Pixmap::from_vec(
                            raw,
                            tiny_skia::IntSize::from_wh(w, h).ok_or("零尺寸")?,
                        )
                        .ok_or_else(|| "构造 pixmap 失败".to_string())
                    })
            })
            .map_err(|e| format!("子资源 {} 解码失败：{e}", requirement.id))?;
        loaded.push((requirement.asset_name, bytes, std::sync::Arc::new(pixmap)));
    }
    lottie.attach_images(loaded);
    Ok(())
}

/// 五个固定取样点（首帧 / 四分之一 / 中点 / 四分之三 / 末帧内）。
fn sample_points(total_ms: i64) -> Vec<i64> {
    let last = (total_ms - 1).max(0);
    vec![0, last / 4, last / 2, last * 3 / 4, last]
}

fn record_fingerprint(lottie: &Lottie, ms: i64) -> Result<(u64, usize, usize, usize), String> {
    let mut builder = FrameBuilder::default();
    lottie
        .record(
            MediaTime::from_millis(ms),
            tiny_skia::Transform::identity(),
            &mut builder,
        )
        .map_err(|e| format!("{e:#}"))?;
    let frame = builder.finish();
    Ok((
        drawop::fingerprint(&frame),
        frame.ops.len(),
        frame.paths.len(),
        frame.paints.len(),
    ))
}

#[test]
fn the_refined_subset_classifies_the_whole_corpus_the_way_the_census_promised() {
    let Some(dir) = corpus_dir() else {
        eprintln!("跳过：未设 BCUT_LOTTIE_CORPUS（语料不在仓库里，见 fixtures/lottie/README.md）");
        return;
    };
    let mut renderable = Vec::new();
    let mut blocked = Vec::new();
    let mut incomplete = Vec::new();
    for path in corpus_files(&dir) {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let bytes = std::fs::read(&path).expect("读语料文件");
        match Lottie::parse("corpus", &name, &bytes) {
            Ok(mut lottie) => {
                if let Err(reason) = attach(&mut lottie) {
                    incomplete.push(json!({"file": name, "reason": reason}));
                    continue;
                }
                lottie.prepare(&PrepareCtx::default()).expect("prepare");
                let total = lottie.metadata().total_ms();
                let mut failure = None;
                for ms in sample_points(total) {
                    if let Err(error) = record_fingerprint(&lottie, ms) {
                        failure = Some(error);
                        break;
                    }
                }
                match failure {
                    Some(reason) => incomplete.push(json!({"file": name, "reason": reason})),
                    None => renderable.push(json!({
                        "file": name,
                        "warnings": lottie.diagnostics().len(),
                    })),
                }
            }
            Err(error) => {
                let message = format!("{error:#}");
                assert!(
                    message.contains("lottie-unsupported-feature")
                        || message.contains("lottie-parse"),
                    "被拦下的文件必须给出可归类的诊断码，{name} 报的是：{message}"
                );
                blocked.push(json!({
                    "file": name,
                    "reason": classify(&message),
                }));
            }
        }
    }

    let total = renderable.len() + blocked.len() + incomplete.len();
    assert!(
        total >= 50,
        "语料太小（{total} 个），普查规程要求 50–100 个"
    );
    assert_or_update(
        &fixture(GOLDEN_COVERAGE),
        json!({
            "note": "细化子集边界下的语料分类。renderable = parse + prepare + 五个取样点全部发出指令；\
                     blocked = lottie-unsupported-feature fail-fast；incomplete = 子集内但本机缺外链子资源。\
                     renderable + incomplete 就是普查（2026-08-20）说的「细化边界下 strict 覆盖 70/100」。",
            "total": total,
            "renderableCount": renderable.len(),
            "blockedCount": blocked.len(),
            "incompleteCount": incomplete.len(),
            "renderable": renderable,
            "blocked": blocked,
            "incomplete": incomplete,
        }),
    );
}

/// 报错文本 → 稳定的分类关键词（golden 里存这个，而不是整句中文，免得
/// 改一个字就红一片）。
fn classify(message: &str) -> &'static str {
    for (needle, label) in [
        ("文字图层", "text-layer"),
        ("表达式", "expression"),
        ("布尔合并路径", "boolean-merge"),
        ("光栅效果", "raster-effect"),
        ("重复器", "repeater"),
        ("3D", "three-d"),
        ("自动定向", "auto-orient"),
        ("遮罩模式", "mask-mode"),
        ("遮罩羽化", "mask-feather"),
        ("混合模式", "blend-mode"),
        ("未知图层类型", "unknown-layer"),
        ("未知形状条目", "unknown-shape"),
        ("轨道遮罩类型", "unknown-matte"),
    ] {
        if message.contains(needle) {
            return label;
        }
    }
    "other"
}

#[test]
fn the_twelve_golden_files_keep_their_draw_op_fingerprints() {
    let Some(dir) = corpus_dir() else {
        eprintln!("跳过：未设 BCUT_LOTTIE_CORPUS");
        return;
    };
    let list = read_json(&fixture(GOLDEN_LIST));
    let entries = list.as_array().expect("golden-corpus.json 是数组");
    let mut files = Vec::new();
    for entry in entries {
        let name = entry["file"].as_str().expect("golden 条目缺 file");
        let path = dir.join(name);
        assert!(path.is_file(), "golden 素材 {name} 不在语料目录里");
        let bytes = std::fs::read(&path).expect("读 golden 素材");
        let mut lottie = Lottie::parse("golden", name, &bytes)
            .unwrap_or_else(|e| panic!("golden 素材 {name} 必须落在子集内：{e:#}"));
        // 外链子资源缺席不影响 DrawOp 指纹：图片只以资产名进指令流
        let _ = attach(&mut lottie);
        let meta = lottie.metadata().clone();
        let samples: Vec<Value> = sample_points(meta.total_ms())
            .into_iter()
            .map(|ms| {
                let (fingerprint, ops, paths, paints) = record_fingerprint(&lottie, ms)
                    .unwrap_or_else(|e| panic!("golden 素材 {name} 在 {ms}ms 录制失败：{e}"));
                json!({
                    "ms": ms,
                    "ops": ops,
                    "paths": paths,
                    "paints": paints,
                    "drawOpFingerprint": format!("{fingerprint:016x}"),
                })
            })
            .collect();
        files.push(json!({
            "file": name,
            "width": meta.width,
            "height": meta.height,
            "fps": lottie.frame_rate(),
            "frames": meta.frame_count(),
            "warnings": lottie.diagnostics().len(),
            "samples": samples,
        }));
    }
    assert_eq!(files.len(), entries.len());
    assert_or_update(
        &fixture(GOLDEN_FRAMES),
        json!({
            "note": "12 个 golden 素材的 DrawOp 指纹（BCOP v4）。素材不进仓库，\
                     测试经 BCUT_LOTTIE_CORPUS 指向本地语料目录。",
            "rendererTag": "bcut.source.lottie/v1",
            "files": files,
        }),
    );
}

#[test]
fn recording_a_golden_file_is_byte_stable_and_order_independent() {
    let Some(dir) = corpus_dir() else {
        eprintln!("跳过：未设 BCUT_LOTTIE_CORPUS");
        return;
    };
    let list = read_json(&fixture(GOLDEN_LIST));
    for entry in list.as_array().unwrap() {
        let name = entry["file"].as_str().unwrap();
        let path = dir.join(name);
        if !path.is_file() {
            continue;
        }
        let bytes = std::fs::read(&path).unwrap();
        let lottie = Lottie::parse("golden", name, &bytes).unwrap();
        let points = sample_points(lottie.metadata().total_ms());
        let forward: Vec<u64> = points
            .iter()
            .map(|ms| record_fingerprint(&lottie, *ms).unwrap().0)
            .collect();
        let backward: Vec<u64> = points
            .iter()
            .rev()
            .map(|ms| record_fingerprint(&lottie, *ms).unwrap().0)
            .collect();
        assert_eq!(
            forward,
            backward.into_iter().rev().collect::<Vec<_>>(),
            "{name}：乱序录制必须逐位等于顺序录制"
        );
    }
}
