//! 「字幕排版只能有一份实现」的门禁（主方案 D2 / D6）。
//!
//! App v2 的整条价值链押在这一条上：CLI 烧录与 App 预览必须是同一个内核，
//! 「同一输入同像素，差异即 bug」（M1-R3）。搬迁只是把代码挪过来，挡不住
//! 三个月后有人在 `apps/baocut` 里「先写个简版排版顶一下」——那份副本会安静
//! 地跟内核分叉，而所有测试照样绿。
//!
//! 于是这里扫源码：内核的入口名、样式投影函数、共享比例常量与频谱缓存路径的
//! 构造，只允许出现在本 crate 里。宿主可以随便调用，但不能自己再写一份。
//!
//! 扫描是文本级的，故意粗糙：它抓的是「有人复刻了同名实现」这件事，不追求
//! 语义精确。误报的正确处理方式是把它登记进 [`ALLOWED`] 并写清理由，不是把
//! 针挪个名字绕过去。
//!
//! 唯一的例外是**标识符前缀**：`enum LineKind` 这根针会顺带抓住
//! `enum LineKindName`——那是另一个名字的另一个类型，不是复刻。所以匹配收在
//! 词边界上（见 [`needle_hits`]），而不是往 [`ALLOWED`] 里塞路径条目：塞路径会连带
//! 放行同一个文件里将来真出现的 `enum LineKind` 本体。

use std::fs;
use std::path::{Path, PathBuf};

/// 被扫描的宿主源码树。内核之外的 crate 同样不许复刻。
///
/// v3：v2 扫的是 `apps/cli/src`、`apps/baocut/src` 与 `core/crates`；v3 的 Rust 都在 `crates/` 与
/// `bindings/`（`apps/` 是 TypeScript）。
const SCANNED: &[&str] = &["crates", "bindings"];

/// 已知且刻意保留的命中：`(路径后缀, 针, 理由)`。
///
/// 只有两类条目有资格进来：**该符号的唯一定义处**，和**函数体只有一行转发的
/// 宿主壳**。新增一条必须写明属于哪一类——「暂时先放着」不是理由，把针改个
/// 名字绕过去更不是。
const ALLOWED: &[(&str, &str, &str)] = &[
    (
        "timeline/src/effects.rs",
        "const REFERENCE_SHORT_EDGE",
        "参考短边的唯一定义处；本 crate 与 timeline-render / render-raster 都从这里取。",
    ),
    // v2 另有一条 `bcut-serve/src/endpoints/media.rs` 的 `fn media_fingerprint`（一行转发的宿主壳）；
    // `bcut-serve` 不移植（架构设计 §13.6），条目随之删掉，否则下面的自检会报它失效。
];

fn repo_root() -> PathBuf {
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // `exists()` 而不是 `is_dir()`：在 git worktree 里 `.git` 是一个**文件**
    // （内容为 `gitdir: …`）。收紧成 `is_dir()` 会让这个门禁在每个 worktree 里
    // 一路向上走到文件系统根然后 panic——而 agent 恰恰都在 worktree 里干活。
    while !dir.join(".git").exists() {
        dir = dir
            .parent()
            .expect("从 crate 目录向上找不到仓库根（.git）")
            .to_path_buf();
    }
    dir
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "target" || name == "node_modules" {
            continue;
        }
        if path.is_dir() {
            // 内核自己就是那份唯一实现，不参与扫描。
            if path.ends_with("subtitle-render") {
                continue;
            }
            collect(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

/// 词边界匹配：命中之后紧跟字母 / 数字 / 下划线的不算。
///
/// `bcut-wasm-editor` 的 `enum LineKindName` 是给 JS 用的线名枚举，带两个
/// `From` 与 `bcut_editor_core::selection::LineKind` 互转，本身没有第二份判据；
/// 但子串匹配会把它当成 `enum LineKind` 的复刻。
///
/// 只收紧**尾侧**：`": &str = \".spectrum.bin\""` 这类针本来就以标点开头，
/// 前缀也加边界会把它整根废掉。代价是 `enum LineKindV2` 这种「换个后缀另写
/// 一份」不再被抓——门禁本来就只防同名复刻，改名绕过在模块文档里已经写明
/// 不是可接受做法。
fn needle_hits(line: &str, needle: &str) -> bool {
    line.match_indices(needle).any(|(at, _)| {
        line[at + needle.len()..]
            .chars()
            .next()
            .is_none_or(|ch| !ch.is_alphanumeric() && ch != '_')
    })
}

fn scan(needles: &[&str], guidance: &str) {
    let root = repo_root();
    let mut files = Vec::new();
    for scanned in SCANNED {
        collect(&root.join(scanned), &mut files);
    }
    assert!(
        files.len() > 200,
        "扫描只找到 {} 个 .rs 文件，路径大概错了：{SCANNED:?}",
        files.len()
    );

    let mut hits = Vec::new();
    for file in &files {
        let Ok(text) = fs::read_to_string(file) else {
            continue;
        };
        let relative = file.strip_prefix(&root).unwrap_or(file);
        let relative = relative.to_string_lossy().replace('\\', "/");
        for (index, line) in text.lines().enumerate() {
            // 注释与文档里提到内核的名字是好事，不是复刻。
            let code = line.trim_start();
            if code.starts_with("//") || code.starts_with("*") {
                continue;
            }
            for needle in needles {
                if !needle_hits(line, needle) {
                    continue;
                }
                if ALLOWED
                    .iter()
                    .any(|(path, allowed, _)| relative.ends_with(path) && allowed == needle)
                {
                    continue;
                }
                hits.push(format!("{relative}:{}: {}", index + 1, line.trim()));
            }
        }
    }

    assert!(
        hits.is_empty(),
        "字幕内核出现了第二份实现（主方案 D2）：\n{}\n\n{guidance}",
        hits.join("\n")
    );
}

/// A：overlay 渲染计划的入口只能来自 `subtitle_render`。
#[test]
fn no_host_defines_its_own_overlay_render_plan() {
    scan(
        &[
            "struct OverlayRenderPlan",
            "enum OverlayRenderPlan",
            "impl OverlayRenderPlan",
            "struct OverlayFrame",
            "fn render_overlay_png",
            "fn compile_overlay_plan",
        ],
        "宿主要 overlay 帧就调 `subtitle_render::OverlayRenderPlan`；\
         缺什么接口就在内核里加，不要在宿主侧另起一份。",
    );
}

/// B：字幕样式投影（扁平 blob → 行样式）只能有一处。
#[test]
fn no_host_reimplements_the_subtitle_style_projection() {
    scan(
        &[
            "fn resolve_line_style",
            "fn merged_line_style",
            "fn apply_preview_overlays",
            "fn caption_recipe",
            // 带 `{`：针要抓的是「又声明了一个 `LineKind`」，不是任何以它开头的
            // 名字。少了这个花括号，`bcut-wasm-editor` 那个 `enum LineKindName`
            // （`"orig" | "trans"` 的 JSON 线名壳，两个 `From` 转到内核 LineKind）
            // 会被当成第二份实现。
            "enum LineKind {",
            "struct LineStyle",
        ],
        "样式投影是 Mac / Web / CLI 三端字号与颜色的唯一真相（见 \
         `subtitle_render::resolve_line_style` 的文档）：另写一份 = 三端分叉。",
    );
}

/// C：跨端共享的比例常量不许各写各的字面量。
#[test]
fn no_host_redeclares_the_shared_layout_ratios() {
    scan(
        &[
            "const REFERENCE_SHORT_EDGE",
            "const DEFAULT_BILINGUAL_ORIG_SCALE",
            "const DEFAULT_TRANSLATION_RATIO",
        ],
        "参考短边住在 `timeline::REFERENCE_SHORT_EDGE`，双语字号比例住在 \
         `subtitle_render`；复制字面量的那一端会在下次调参时独自跑偏。",
    );
}

/// D：BCS1 频谱缓存的文件名规则只能有一处。
///
/// 分叉的症状很有迷惑性：`bcut spectrum` 刚生成过，渲染却说「找不到频谱，
/// 请先运行 bcut spectrum」——因为两边算出的文件名不是同一个。
#[test]
fn no_host_reconstructs_the_spectrum_cache_path() {
    scan(
        &[
            ": &str = \".spectrum.bin\"",
            "fn spectrum_cache_path",
            "fn media_fingerprint",
        ],
        "频谱缓存路径走 `subtitle_render::paths::spectrum_cache_path`；\
         CLI 的 `services::spectrum::cache_path` 已经是转发别名。",
    );
}

/// E：样式画廊只能描述「要什么样式」，不能自己算一份渲染几何。
///
/// 第 62 轮曾经在原型里用 540px 参考画布、`displayPadding` 和一套
/// `fontPx * pad / 80` 公式。样式卡片必须把完整 style blob 交给共享内核；这些
/// 原型私有公式一旦进宿主，就会让 tile、stage 与导出各画一套。
///
/// 名单跟着代码走：`stylepane` / `tile_beat` 两族在 P2 第四批（`e8d2ee26`）与
/// 第十二批（`bdce1fd6`）下沉进 `bcut-editor-core`，App 侧同名文件已删，所以
/// 这里同时盯**新家**与仍留在 App 的那一半。名单里的文件缺失会直接 panic —
/// 那正是这条门禁想要的响动：下次搬家必须回来改这份名单，而不是让扫描静默
/// 落空。
// v3：点名的文件在 v2 的 `bcut-editor-core` 与 `apps/baocut`，v3 还没有样式画廊的 Rust 实现。
#[test]
#[ignore = "点名 v2 的 bcut-editor-core 与 apps/baocut 的样式画廊源文件：待 bcut-editor-core 移植"]
fn subtitle_style_gallery_has_no_prototype_render_math() {
    let root = repo_root();
    // 点名的这几份是 App 侧样式画廊的取数面：卡片目录、悬停即预览的覆盖层、
    // 小样节拍。`adapters/stylepane.rs` 曾经也在这里，`e8d2ee26` 把 stylepane
    // 集群沉进 `bcut-editor-core` 时删掉了它——core 那份归上面 A–D 的全量扫描管，
    // 不再由本条点名。
    let mut files = vec![
        root.join("core/crates/bcut-editor-core/src/stylepane.rs"),
        root.join("core/crates/bcut-editor-core/src/style_library.rs"),
        root.join("core/crates/bcut-editor-core/src/style_peek.rs"),
        root.join("core/crates/bcut-editor-core/src/tile_beat.rs"),
        root.join("apps/baocut/src/host/style_library.rs"),
    ];
    collect(
        &root.join("apps/baocut/src/app/editor/stylepane"),
        &mut files,
    );
    assert!(
        files.len() > 4,
        "样式画廊名单只剩 {} 个文件：apps/baocut/src/app/editor/stylepane 大概搬家了",
        files.len()
    );

    let forbidden = [
        "/ 540.0",
        "/540.0",
        "displayPadding",
        "leadIn",
        "fontPx * pad",
        "font_px * pad",
    ];
    let mut hits = Vec::new();
    for file in files {
        // 点名的文件被改名／搬走时要在这里炸出**是哪一份、该怎么办**：原来的
        // `expect("style gallery source is readable")` 只留下一个 `NotFound`，
        // `adapters/stylepane.rs` 删掉后这条门就一直红着没人看得出所以然。
        let text = fs::read_to_string(&file).unwrap_or_else(|err| {
            panic!(
                "读不到点名的样式画廊源文件 {}：{err}\n\
                 它被改名或搬走了就在本测试的 `files` 列表里同步——删掉这一行等于\
                 悄悄放弃这一份的覆盖，要删就在提交信息里写清去向。",
                file.strip_prefix(&root).unwrap_or(&file).display()
            )
        });
        for (index, line) in text.lines().enumerate() {
            let code = line.trim_start();
            if code.starts_with("//") || code.starts_with("*") {
                continue;
            }
            for needle in forbidden {
                if line.contains(needle) {
                    hits.push(format!(
                        "{}:{}: {}",
                        file.strip_prefix(&root).unwrap_or(&file).display(),
                        index + 1,
                        line.trim()
                    ));
                }
            }
        }
    }
    assert!(
        hits.is_empty(),
        "App 字幕样式画廊复制了原型渲染数学：\n{}\n\n把样式 blob 交给 \
         subtitle_render，让 tile/stage/export 继续共享同一份排版。",
        hits.join("\n")
    );
}

/// ALLOWED 里已经不再命中的条目要报错。
///
/// 这张名单是「明知故犯并写明理由」的登记表，不是永久豁免：被放行的那一行删掉
/// 之后条目还留着，下次同一个文件里真出现一份 `fn media_fingerprint` 复刻时，
/// 门禁会一声不吭地放行。`bcut-serve/src/thin_shell_gate.rs` 的 `unused_allow`
/// 是同一条自检。
///
/// 这里的判定能做到**精确到针**：ALLOWED 的三元组本来就带针，所以直接问
/// 「这根针在这个文件里还命中吗」，与 [`scan`] 的放行判据逐字同源（同样按
/// [`needle_hits`] 的词边界、同样跳过注释行）。
#[test]
fn the_allowlist_has_no_stale_entries() {
    let root = repo_root();
    let mut files = Vec::new();
    for scanned in SCANNED {
        collect(&root.join(scanned), &mut files);
    }

    let mut stale = Vec::new();
    for (path, needle, reason) in ALLOWED {
        let live = files.iter().any(|file| {
            let relative = file.strip_prefix(&root).unwrap_or(file);
            if !relative
                .to_string_lossy()
                .replace('\\', "/")
                .ends_with(path)
            {
                return false;
            }
            let Ok(text) = fs::read_to_string(file) else {
                return false;
            };
            text.lines().any(|line| {
                let code = line.trim_start();
                !code.starts_with("//") && !code.starts_with("*") && needle_hits(line, needle)
            })
        });
        if !live {
            stale.push(format!("{path} 的 `{needle}`（{reason}）"));
        }
    }
    assert!(
        stale.is_empty(),
        "ALLOWED 里这些条目已经不再命中（文件没了，或那一行已删/已改名），\n         请删掉条目：\n{}",
        stale.join("\n")
    );
}
