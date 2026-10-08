//! WGSL 源的登记与组装（元素方案 §8.6）。
//!
//! 参考实现用 `#include "wgpu/<group>/<file>.wgsl"` 这条**它自己的**预处理指令
//! 拼源码。BaoCut 不复制那套机制，也不引入 shader 预处理器依赖：源文件用
//! `include_str!` 编进二进制，组装就是**前缀字符串拼接**——
//!
//! ```text
//! common.wgsl  ‖  <domain>/_prelude.wgsl  ‖  <style>.wgsl
//! ```
//!
//! `common.wgsl` 是无 binding 的纯函数；`_prelude.wgsl` 是该 domain 的 §8.1 /
//! §8.2 binding 面与顶点着色器；样式文件只写 fragment 与它自己的
//! `@group(3)` 配方 struct。
//!
//! **本模块不挂 `gpu` feature**：没有 GPU 的构建也要能做源码一致性检查（哪些
//! 样式有 shader、manifest 的 `shader` 字段是否对得上），而 naga 静态校验与
//! 真正的编译才需要 feature。
//!
//! ## 一个家族一份源码
//!
//! `SHADER_SOURCES` 是**按算法家族**登记的，不是按样式：`bar-v1` 两种的差异
//! 全在 `@group(3)` 的配方 uniform 里，源码逐字相同。14 个 progress 样式因此只有
//! 4 份文件，manifest 的 `shader` 字段指向所属家族的那一份。
//!
//! **visualizer 没有源码登记项**：声波 10 款自 2026-09 重设计起全部是 CPU 矢量
//! 配方（manifest `shader: null`），`shader_for(Visualizer, ·)` 恒为 `None`，host
//! 走矢量层。`ShaderDomain::Visualizer` 与它的 `_prelude.wgsl` 作为 §8.1 / §8.2
//! 的冻结契约保留。
//!
//! `tests/shader_wgsl.rs` 遍历整张表做 naga 校验 + GLSL ES 300 转译，另有一条
//! 断言要求"注册表里的每个 progress 样式都能在这里查到源码"——加样式忘了加行
//! 会立刻红。

use std::fmt;

/// shader 的 domain。两个 domain 的 `@group(1)` 布局不同（§8.2：8 项 vs 9 项），
/// 因此 prelude 也是两份。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ShaderDomain {
    Visualizer,
    Progress,
}

impl ShaderDomain {
    pub fn as_str(self) -> &'static str {
        match self {
            ShaderDomain::Visualizer => "visualizer",
            ShaderDomain::Progress => "progress",
        }
    }

    /// 该 domain 的 binding 面与顶点着色器源码（§8.1 / §8.2 的落点）。
    /// 公开是为了让契约测试能拿它与 Rust 侧的 uniform 表逐行对拍。
    pub fn prelude(self) -> &'static str {
        match self {
            ShaderDomain::Visualizer => VISUALIZER_PRELUDE,
            ShaderDomain::Progress => PROGRESS_PRELUDE,
        }
    }
}

impl fmt::Display for ShaderDomain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 顶点入口名（两个 prelude 共用）。
pub const VERTEX_ENTRY: &str = "vertexMain";
/// fragment 入口名（每份样式源共用）。
pub const FRAGMENT_ENTRY: &str = "fragmentMain";

/// 无 binding 的公共件。
pub const COMMON_WGSL: &str = include_str!("../../shaders/common.wgsl");
const VISUALIZER_PRELUDE: &str = include_str!("../../shaders/visualizer/_prelude.wgsl");
const PROGRESS_PRELUDE: &str = include_str!("../../shaders/progress/_prelude.wgsl");

/// 一份样式 shader 源。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShaderSource {
    pub domain: ShaderDomain,
    /// 文件名，与 manifest 的 `shader` 字段逐字相同。
    pub file: &'static str,
    /// 本源码服务的样式 id（目录里的面值 id，如 `normal`）。
    pub styles: &'static [&'static str],
    body: &'static str,
}

impl ShaderSource {
    /// `common ‖ prelude ‖ body`。每段之间补一个换行，源文件本身不必以换行结尾。
    pub fn assemble(&self) -> String {
        let mut out = String::with_capacity(
            COMMON_WGSL.len() + self.domain.prelude().len() + self.body.len(),
        );
        for part in [COMMON_WGSL, self.domain.prelude(), self.body] {
            out.push_str(part);
            if !part.ends_with('\n') {
                out.push('\n');
            }
        }
        out
    }

    /// 诊断用的稳定标签，也是 naga 校验测试里的用例名。
    pub fn label(&self) -> String {
        format!("{}/{}", self.domain.as_str(), self.file)
    }
}

macro_rules! shader {
    ($domain:expr, $dir:literal, $file:literal, [$($style:literal),+ $(,)?]) => {
        ShaderSource {
            domain: $domain,
            file: $file,
            styles: &[$($style),+],
            body: include_str!(concat!("../../shaders/", $dir, "/", $file)),
        }
    };
}

/// 14 个 progress 样式的 shader，按算法家族归成 4 份源码。
pub const SHADER_SOURCES: &[ShaderSource] = &[
    // ── progress：4 个算法家族，14 个样式。
    shader!(
        ShaderDomain::Progress,
        "progress",
        "normal.wgsl",
        ["normal", "rounded"]
    ),
    shader!(
        ShaderDomain::Progress,
        "progress",
        "border.wgsl",
        [
            "border",
            "reverse_border",
            "rainbow_border",
            "reverse_rainbow_border",
            "strobe_border",
            "reverse_strobe_border",
        ]
    ),
    shader!(
        ShaderDomain::Progress,
        "progress",
        "circle.wgsl",
        ["circle", "donut"]
    ),
    shader!(
        ShaderDomain::Progress,
        "progress",
        "snake.wgsl",
        ["snake", "snake_spin", "snake_rainbow", "snake_spin_rainbow"]
    ),
];

/// 按 `(domain, 样式 id)` 找源码；没有落地的样式返回 `None`（host 据此回退 CPU）。
pub fn shader_for(domain: ShaderDomain, style: &str) -> Option<&'static ShaderSource> {
    SHADER_SOURCES
        .iter()
        .find(|source| source.domain == domain && source.styles.contains(&style))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 组装出来的源码里不得残留参考实现的 `#include`——那是它的预处理指令，
    /// BaoCut 走字符串拼接（§8.6）。
    #[test]
    fn the_assembled_sources_carry_no_preprocessor_directives() {
        for source in SHADER_SOURCES {
            let text = source.assemble();
            // 注释里提到 `#include` 是在解释"我们为什么不用它"，不算残留。
            let code: String = text
                .lines()
                .map(|line| line.split("//").next().unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n");
            assert!(
                !code.contains("#include"),
                "{} 残留了 #include",
                source.label()
            );
            assert!(
                text.contains(&format!("fn {FRAGMENT_ENTRY}")),
                "{} 缺 fragment 入口",
                source.label()
            );
            assert!(
                text.contains(&format!("fn {VERTEX_ENTRY}")),
                "{} 缺 vertex 入口",
                source.label()
            );
        }
    }

    /// 注册表里的 **14 个 progress 样式一个不漏**都能查到源码，且每份源码只被
    /// 登记一次；**10 个 visualizer 样式一个都查不到**（它们是 CPU 矢量配方）。
    ///
    /// 与下一条互为反向：那一条查"登记的样式确实存在且 manifest 指得对"，
    /// 这一条查"存在的样式确实被登记了"。少了这一条，新样式忘了加行会静默地
    /// 落回 CPU（`shader_for` 返回 `None` ⇒ 回退），没有任何测试会红。
    #[test]
    fn every_catalogue_style_has_a_shader() {
        let mut seen: Vec<String> = Vec::new();
        for recipe in motion::preset_registry::timeline_visualizers() {
            assert!(
                shader_for(ShaderDomain::Visualizer, &recipe.id).is_none(),
                "visualizer/{} 是 CPU 矢量配方，不该有 WGSL 源",
                recipe.id
            );
        }
        for recipe in motion::preset_registry::timeline_progresses() {
            let source = shader_for(ShaderDomain::Progress, &recipe.id)
                .unwrap_or_else(|| panic!("progress/{} 没有登记 WGSL 源", recipe.id));
            seen.push(source.label());
        }
        assert_eq!(seen.len(), 14, "14 种 progress");
        seen.sort();
        seen.dedup();
        assert_eq!(
            seen.len(),
            SHADER_SOURCES.len(),
            "每份源码都至少服务一个样式"
        );

        // 同一个样式 id 不得在两份源码里各登记一次。
        let mut styles: Vec<(ShaderDomain, &str)> = SHADER_SOURCES
            .iter()
            .flat_map(|source| {
                source
                    .styles
                    .iter()
                    .map(move |style| (source.domain, *style))
            })
            .collect();
        let total = styles.len();
        styles.sort();
        styles.dedup();
        assert_eq!(styles.len(), total, "样式 id 在登记表里重复了");
        assert_eq!(total, 14);
    }

    /// 每份源码服务的样式都在注册表里，且 manifest 的 `shader` 字段与文件名
    /// 逐字相同——这条抓的是"文件加了、manifest 没指过来"。
    #[test]
    fn every_registered_style_matches_its_manifest_shader_field() {
        for source in SHADER_SOURCES {
            for style in source.styles {
                let declared = match source.domain {
                    // visualizer 配方的 `shader` 恒为 `null`，登记表里也不该有它。
                    ShaderDomain::Visualizer => None,
                    ShaderDomain::Progress => motion::preset_registry::timeline_progress(style)
                        .and_then(|recipe| recipe.progress())
                        .map(|body| body.shader.clone()),
                };
                assert_eq!(
                    declared.as_deref(),
                    Some(source.file),
                    "{}/{style} 的 manifest `shader` 字段与源文件名不一致",
                    source.domain
                );
            }
        }
    }

    #[test]
    fn the_lookup_is_keyed_by_domain_and_style() {
        // 家族共用一份源码：两种 `bar-v1` 查到的是同一个文件。
        let normal = shader_for(ShaderDomain::Progress, "normal").unwrap();
        let rounded = shader_for(ShaderDomain::Progress, "rounded").unwrap();
        assert_eq!(normal.file, rounded.file);
        assert_eq!(normal.file, "normal.wgsl");
        // domain 不能串：progress 的 `normal` 不是 visualizer 的样式。
        assert!(shader_for(ShaderDomain::Visualizer, "normal").is_none());
        // visualizer 样式没有 WGSL：host 据此走矢量层。
        assert!(shader_for(ShaderDomain::Visualizer, "bars").is_none());
        assert!(shader_for(ShaderDomain::Progress, "bars").is_none());
        // 不存在的样式返回 `None`，host 据此回退 CPU 而不是拿到一份空壳。
        assert!(shader_for(ShaderDomain::Progress, "zz_not_a_style").is_none());
    }
}
