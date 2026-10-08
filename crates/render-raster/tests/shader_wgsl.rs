//! WGSL 的静态校验与 §8 契约对拍（元素方案 §10 P5 的两条验收点）。
//!
//! 三件事：
//!
//! 1. **naga 校验**：仓库里现有的每一份组装源都过 `wgsl-in` 解析 + `Validator`；
//! 2. **GLSL ES 300 转译**：同一份模块打到 naga 的 GLSL 后端（ADR-E06 的
//!    "WebGL2 经 naga 自动转译"在这里变成可执行断言，不是一句承诺）；
//! 3. **§8.2 / §8.3 契约对拍**：WGSL 里的 `@group(1)` 声明顺序、`@group(2)` 的
//!    音频纹理与 sampler、行语义常量，逐条与 Rust 侧的冻结表比对。
//!
//! `SHADER_SOURCES` 当前只有 progress 的 4 份源码（14 款）；visualizer 10 款是
//! CPU 矢量配方，没有 WGSL，但它的 `VisualizerUniforms` / prelude 契约仍在这里
//! 对拍，将来加 GPU 声波配方时**只需往 `SHADER_SOURCES` 加行**——本文件遍历
//! 整张表，新样式自动进覆盖面。
//!
//! ```bash
//! cd core
//! cargo test -p bcut-render --features gpu --test shader_wgsl
//! ```

#![cfg(feature = "gpu")]

use render_raster::naga;
use render_raster::plan::shader_quad::{ProgressUniforms, VisualizerUniforms};
use render_raster::plan::shader_source::{
    COMMON_WGSL, FRAGMENT_ENTRY, SHADER_SOURCES, ShaderDomain, VERTEX_ENTRY,
};
use render_raster::source::kernel::Easing;
use render_raster::source::visualizer::{AUDIO_TEXTURE_ROW_FREQ, AUDIO_TEXTURE_ROW_TIME};

/// 从 prelude 里抠出 `@group(g) @binding(b) var<uniform> name` 的三元组。
fn uniform_declarations(source: &str, group: u32) -> Vec<(u32, String)> {
    let needle = format!("@group({group}) @binding(");
    source
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix(&needle)?;
            let (binding, rest) = rest.split_once(')')?;
            let rest = rest.trim_start();
            let name = rest.strip_prefix("var<uniform>")?.trim_start();
            let name = name.split([' ', ':']).next()?;
            Some((binding.parse().ok()?, name.to_owned()))
        })
        .collect()
}

/// 每一份组装源都过 naga 的解析 + 全量校验。
#[test]
fn every_registered_shader_passes_naga_validation() {
    assert!(
        !SHADER_SOURCES.is_empty(),
        "登记表为空说明 include_str! 的路径断了"
    );
    for source in SHADER_SOURCES {
        let wgsl = source.assemble();
        if let Err(error) = render_raster::validate_wgsl(&wgsl) {
            panic!("{} 没通过 naga 校验：{error:#}", source.label());
        }
    }
}

/// 同一份模块能打到 **GLSL ES 300**（WebGL2 目标）。
///
/// ADR-E06 的"WGSL 单源、naga 负责到 GLSL ES 300 的转译"如果只是一句承诺，
/// P6 接 WebGL2 时才会发现某个内建函数在 ES 300 上落不了地。这条断言把它提前
/// 到 P5——两个入口各转译一次（顶点与片元的可用特性面不同）。
#[test]
fn every_registered_shader_translates_to_glsl_es_300() {
    for source in SHADER_SOURCES {
        let wgsl = source.assemble();
        let module = render_raster::validate_wgsl(&wgsl)
            .unwrap_or_else(|error| panic!("{}: {error:#}", source.label()));
        let info = naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::default(),
        )
        .validate(&module)
        .unwrap_or_else(|error| panic!("{}: {error:?}", source.label()));

        for (stage, entry) in [
            (naga::ShaderStage::Vertex, VERTEX_ENTRY),
            (naga::ShaderStage::Fragment, FRAGMENT_ENTRY),
        ] {
            let options = naga::back::glsl::Options {
                version: naga::back::glsl::Version::Embedded {
                    version: 300,
                    is_webgl: true,
                },
                ..Default::default()
            };
            let pipeline_options = naga::back::glsl::PipelineOptions {
                shader_stage: stage,
                entry_point: entry.to_owned(),
                multiview: None,
            };
            let mut out = String::new();
            let writer = naga::back::glsl::Writer::new(
                &mut out,
                &module,
                &info,
                &options,
                &pipeline_options,
                naga::proc::BoundsCheckPolicies::default(),
            );
            match writer {
                Ok(mut writer) => {
                    writer.write().unwrap_or_else(|error| {
                        panic!("{} 的 {entry} 打不到 GLSL ES 300：{error}", source.label())
                    });
                }
                Err(error) => panic!("{} 的 {entry} 建不起 GLSL writer：{error}", source.label()),
            }
            assert!(
                out.contains("#version 300 es"),
                "{} 的 {entry} 没落到 ES 300",
                source.label()
            );
        }
    }
}

/// §8.2 的 uniform 顺序：WGSL 的声明与 Rust 的冻结表**逐行相同**。
///
/// 这是"§8 是跨文档契约"在两侧代码之间的接缝。任何一边改了顺序，这条立刻红。
#[test]
fn the_wgsl_group1_declarations_match_the_frozen_tables() {
    let visualizer = uniform_declarations(ShaderDomain::Visualizer.prelude(), 1);
    let expected: Vec<(u32, String)> = VisualizerUniforms::BINDINGS
        .iter()
        .map(|(binding, name)| (*binding, (*name).to_owned()))
        .collect();
    assert_eq!(visualizer, expected, "visualizer 的 @group(1) 顺序");

    let progress = uniform_declarations(ShaderDomain::Progress.prelude(), 1);
    let expected: Vec<(u32, String)> = ProgressUniforms::BINDINGS
        .iter()
        .map(|(binding, name)| (*binding, (*name).to_owned()))
        .collect();
    assert_eq!(progress, expected, "progress 的 @group(1) 顺序");
}

/// §8.1 的 `@group(0)`：两个变换 uniform，顶点阶段可见。
#[test]
fn both_preludes_declare_the_same_group0() {
    for domain in [ShaderDomain::Visualizer, ShaderDomain::Progress] {
        let group0 = uniform_declarations(domain.prelude(), 0);
        assert_eq!(
            group0,
            vec![
                (0, "u_transform".to_owned()),
                (1, "u_texTransform".to_owned())
            ],
            "{domain} 的 @group(0)"
        );
    }
}

/// §8.3 的行语义在 WGSL 里也是**写死的**：`AUDIO_ROW_TIME == 0`、
/// `AUDIO_ROW_FREQ == 1`，与 Rust 侧的两个常量同值。
///
/// GLSL 参考实现开了 `UNPACK_FLIP_Y_WEBGL`、行序相反——这条断言是"移植时忘了
/// 翻回来"的最后一道门（另两道在 `shader_quad` 的字节断言与 GPU 侧的行探针）。
#[test]
fn the_wgsl_audio_rows_agree_with_the_frozen_constants() {
    let prelude = ShaderDomain::Visualizer.prelude();
    assert!(
        prelude.contains(&format!(
            "const AUDIO_ROW_TIME : f32 = {}.0;",
            AUDIO_TEXTURE_ROW_TIME
        )),
        "时域行号与 AUDIO_TEXTURE_ROW_TIME 不一致"
    );
    assert!(
        prelude.contains(&format!(
            "const AUDIO_ROW_FREQ : f32 = {}.0;",
            AUDIO_TEXTURE_ROW_FREQ
        )),
        "频域行号与 AUDIO_TEXTURE_ROW_FREQ 不一致"
    );
    // 两个采样助手各读各的行，不得互换。
    assert!(prelude.contains("fn sampleTemporal") && prelude.contains("vec2f(x, AUDIO_ROW_TIME)"));
    assert!(prelude.contains("fn sampleFrequency") && prelude.contains("vec2f(x, AUDIO_ROW_FREQ)"));
    // progress 没有音频纹理。
    assert!(!ShaderDomain::Progress.prelude().contains("u_audio"));
}

/// `common.wgsl` 里的缓动分派表与 Rust 的 [`Easing::code`] 同一套编码。
#[test]
fn the_easing_codes_agree_between_rust_and_wgsl() {
    assert_eq!(
        [
            Easing::None.code(),
            Easing::OutQuad.code(),
            Easing::OutSine.code(),
            Easing::OutCubic.code()
        ],
        [0, 1, 2, 3]
    );
    // `applyEasing` 的阈值是 0.5 / 1.5 / 2.5，即"码 0 / 1 / 2，其余落 outCubic"。
    let dispatch = COMMON_WGSL
        .split("fn applyEasing")
        .nth(1)
        .expect("common.wgsl 必须有 applyEasing");
    for (threshold, easing) in [
        ("code < 0.5", "return x;"),
        ("code < 1.5", "easeOutQuad"),
        ("code < 2.5", "easeOutSine"),
    ] {
        let head = dispatch.find(threshold).expect(threshold);
        let tail = dispatch[head..].find(easing);
        assert!(
            tail.is_some() && tail.unwrap() < 60,
            "{threshold} 的分派臂错位"
        );
    }
    assert!(dispatch.contains("return easeOutCubic(x);"), "兜底臂");
}

/// 不用 WGSL 内建的 `smoothstep`：`edge0 > edge1` 在规范里是未定义行为，而
/// `gapCurve` 恰恰是下降斜坡（CPU 参照对两个方向都有定义）。
#[test]
fn the_shaders_use_the_explicit_ramp_instead_of_the_builtin_smoothstep() {
    assert!(
        COMMON_WGSL.contains("fn ramp(edge0"),
        "common.wgsl 必须自带 ramp"
    );
    for source in SHADER_SOURCES {
        // 注释里出现 `smoothstep(...)` 是在解释参考实现，不算调用。
        let code: String = source
            .assemble()
            .lines()
            .map(|line| line.split("//").next().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !code.contains("smoothstep("),
            "{} 用了内建 smoothstep，下降斜坡在规范里未定义",
            source.label()
        );
    }
}
