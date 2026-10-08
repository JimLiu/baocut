//! 后端能力档案与 preflight（设计 §6.5）。
//!
//! Preflight 在**正式逐帧之前**跑完：能力不足、效果不存在、确定性等级不满足
//! 都在这里变成可见的诊断或 fallback 记录，而不是第 900 帧才炸。

use crate::drawop;
use anyhow::{Result, bail};
use motion::effect::{Determinism, EffectRef, lookup};
use scene_primitives::resolve::Ir;
use std::collections::BTreeSet;

/// CPU reference 后端的名字与版本。版本进 capability 指纹 ⇒ tiny-skia 升级
/// 会让帧指纹整体变值，这正是我们想要的（光栅化结果可能变）。
pub const CPU_BACKEND: &str = "cpu-tiny-skia";
pub const CPU_BACKEND_VERSION: &str = "0.11";

/// 单张 surface 的边长上限。4K 有余，挡住手写 JSON 的病态值。
pub const DEFAULT_MAX_SURFACE: u32 = 16384;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapabilityProfile {
    pub backend: String,
    pub backend_version: String,
    /// 后端声明支持的能力名（effect manifest 的 `capabilities` 与之求交）。
    pub features: BTreeSet<String>,
    pub max_surface: u32,
    /// 允许进入正式导出的最低确定性等级。
    pub determinism_floor: Determinism,
}

impl CapabilityProfile {
    /// tiny-skia CPU reference：strict-only，无扩展能力。
    pub fn cpu_reference() -> Self {
        CapabilityProfile {
            backend: CPU_BACKEND.to_owned(),
            backend_version: CPU_BACKEND_VERSION.to_owned(),
            features: BTreeSet::new(),
            max_surface: DEFAULT_MAX_SURFACE,
            determinism_floor: Determinism::Strict,
        }
    }

    pub fn supports(&self, feature: &str) -> bool {
        self.features.contains(feature)
    }

    /// 能力档案指纹。进 FramePlan 与每张 surface 的指纹 ⇒ 换后端必然换帧指纹。
    pub fn fingerprint(&self) -> u64 {
        let mut bytes = Vec::with_capacity(64);
        bytes.extend_from_slice(&(self.backend.len() as u32).to_le_bytes());
        bytes.extend_from_slice(self.backend.as_bytes());
        bytes.extend_from_slice(&(self.backend_version.len() as u32).to_le_bytes());
        bytes.extend_from_slice(self.backend_version.as_bytes());
        bytes.extend_from_slice(&(self.features.len() as u32).to_le_bytes());
        for feature in &self.features {
            bytes.extend_from_slice(&(feature.len() as u32).to_le_bytes());
            bytes.extend_from_slice(feature.as_bytes());
        }
        bytes.extend_from_slice(&self.max_surface.to_le_bytes());
        bytes.push(self.determinism_floor.code());
        drawop::fnv1a64(&bytes)
    }
}

/// 一次被应用（或被拒绝）的降级。
#[derive(Debug, Clone, PartialEq)]
pub struct FallbackRecord {
    pub effect: EffectRef,
    /// 触发降级的原因码（`effect-capability-unsupported` / `effect-unknown`…）。
    pub reason: String,
    /// 实际替用的效果；`None` = 没有效果级降级。
    pub applied: Option<EffectRef>,
    /// Surface Transition 专用：降级落到的 **Motion Transition** 配方名
    /// （规范 §9）。转场的降级落点是双方 clip 的属性轨道，不是另一条效果，
    /// 因此不能塞进 `applied`。
    pub applied_preset: Option<String>,
    pub determinism: Determinism,
}

/// 一条 preflight 诊断。`rule` 是规范 §16 的码，与 `bcut lint` 同一张表。
#[derive(Debug, Clone, PartialEq)]
pub struct PreflightDiagnostic {
    pub rule: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PreflightReport {
    pub fallbacks: Vec<FallbackRecord>,
    /// 诊断（进 `bcut render --json` / `bcut ops` 的 `diagnostics`）。
    pub diagnostics: Vec<PreflightDiagnostic>,
    /// 本次渲染的**实际**确定性等级：全部效果的最弱等级。
    pub determinism: Determinism,
}

impl PreflightReport {
    /// 没有任何「无可用降级」的记录。
    pub fn is_ok(&self) -> bool {
        self.fallbacks
            .iter()
            .all(|record| record.applied.is_some() || record.applied_preset.is_some())
    }
}

/// 逐帧之前的一次性检查（设计 §6.5）。
///
/// 三层：① 画布尺寸落在后端 `max_surface` 之内；② 文档里的每一条效果都能
/// 在**当前后端**上跑（版本已注册、capability 齐备、有 CPU 实现），不行就按
/// manifest 的 `fallback` 降级并记账，没有 fallback 就是硬错误；③ 效果元素的
/// 局部画布尺寸约束。**不允许渲染到一半才发现后端不支持。**
pub fn preflight(ir: &Ir, caps: &CapabilityProfile) -> Result<PreflightReport> {
    let width = ir.w.round().max(0.0) as u64;
    let height = ir.h.round().max(0.0) as u64;
    if width == 0 || height == 0 {
        bail!("preflight: 画布尺寸非法 {width}x{height}");
    }
    if width > u64::from(caps.max_surface) || height > u64::from(caps.max_surface) {
        bail!(
            "effect-capability-unsupported: 画布 {width}x{height} 超出后端 {} 的 surface 上限 {}",
            caps.backend,
            caps.max_surface
        );
    }
    fn check_local(node: &scene_primitives::RNode, caps: &CapabilityProfile) -> Result<()> {
        if let Some(canvas) = &node.composition
            && (canvas.width > caps.max_surface as f64 || canvas.height > caps.max_surface as f64)
        {
            bail!(
                "effect-capability-unsupported: 子合成 {} 超出 surface 上限 {}",
                node.id,
                caps.max_surface
            );
        }
        for child in &node.children {
            check_local(child, caps)?;
        }
        Ok(())
    }
    for clip in &ir.visual_clips {
        check_local(&clip.tree, caps)?;
    }
    // v2 原样；新版 clippy 把 `never_loop` 定为 deny，这里只放行，写法不动。
    #[allow(clippy::never_loop)]
    for conflict in super::EffectTopology::conflicts(ir) {
        bail!("{conflict}");
    }
    let topology = super::EffectTopology::of(ir);
    let mut report = preflight_effects(&topology.effects, caps)?;
    preflight_transitions(ir, caps, &mut report);
    Ok(report)
}

/// Surface Transition 的 preflight（规范 §9）。
///
/// 与效果不同，转场的降级落点是**双方 clip 的属性轨道**（resolve 期就算好的
/// `fallback_out` / `fallback_in`），因此这里不会硬错误：任何一条跑不动的
/// 转场都能退回它的 Motion 版本。返回的是**降级名单**（按 `from_clip` 的 id），
/// 录制器按它选路。
pub fn preflight_transitions(
    ir: &Ir,
    caps: &CapabilityProfile,
    report: &mut PreflightReport,
) -> BTreeSet<String> {
    let mut degraded = BTreeSet::new();
    for entry in &ir.surface_transitions {
        let (reason, determinism) = match lookup(&entry.effect.id, entry.effect.version) {
            Err(error) => (error.to_string(), Determinism::Strict),
            Ok(manifest) => {
                let missing: Vec<&str> = manifest
                    .capabilities
                    .iter()
                    .map(String::as_str)
                    .filter(|feature| !caps.supports(feature))
                    .collect();
                if !missing.is_empty() {
                    (
                        format!("后端 {} 缺能力 {missing:?}", caps.backend),
                        manifest.determinism,
                    )
                } else if !crate::effects::kernel_is_implemented(&manifest.kernel) {
                    (
                        format!("内核 {} 没有 CPU reference 实现", manifest.kernel),
                        manifest.determinism,
                    )
                } else if manifest.determinism > caps.determinism_floor {
                    (
                        format!(
                            "确定性等级 {} 低于本次导出的下限 {}",
                            manifest.determinism.as_str(),
                            caps.determinism_floor.as_str()
                        ),
                        manifest.determinism,
                    )
                } else {
                    report.determinism = report.determinism.max(manifest.determinism);
                    continue;
                }
            }
        };
        degraded.insert(entry.from_clip.clone());
        report.fallbacks.push(FallbackRecord {
            effect: entry.effect.clone(),
            reason: format!("transition-fallback-applied: {reason}"),
            applied: None,
            applied_preset: Some(entry.fallback.clone()),
            determinism,
        });
        report.diagnostics.push(PreflightDiagnostic {
            rule: "transition-fallback-applied",
            message: format!(
                "剪辑点 {} → {} 的 {} 已降级为 Motion Transition \"{}\"（{reason}，§9）",
                entry.from_clip,
                entry.to_clip,
                entry.effect.qualified(),
                entry.fallback
            ),
        });
    }
    degraded
}

/// 一组效果引用的 preflight。BCF 文档走 [`preflight`]，Product Timeline 的
/// overlay 直接把 lowering 出来的引用交到这里——两条路同一套判定。
pub fn preflight_effects(
    effects: &[EffectRef],
    caps: &CapabilityProfile,
) -> Result<PreflightReport> {
    let mut report = PreflightReport::default();
    for effect in effects {
        resolve_one(effect, caps, &mut report, 0)?;
    }
    Ok(report)
}

/// 单条效果的可用性判定。`depth` 挡住 manifest 里写成环的 `fallback` 链。
fn resolve_one(
    effect: &EffectRef,
    caps: &CapabilityProfile,
    report: &mut PreflightReport,
    depth: usize,
) -> Result<()> {
    if depth > 4 {
        bail!(
            "effect-capability-unsupported: {} 的 fallback 链过深（疑似成环）",
            effect.qualified()
        );
    }
    let manifest = match lookup(&effect.id, effect.version) {
        Ok(manifest) => manifest,
        Err(error) => bail!("{error}"),
    };
    let missing: Vec<&str> = manifest
        .capabilities
        .iter()
        .map(String::as_str)
        .filter(|feature| !caps.supports(feature))
        .collect();
    let unimplemented = !crate::effects::kernel_is_implemented(&manifest.kernel);
    let too_loose = manifest.determinism > caps.determinism_floor;
    if missing.is_empty() && !unimplemented && !too_loose {
        report.determinism = report.determinism.max(manifest.determinism);
        if manifest.determinism != Determinism::Strict {
            report.diagnostics.push(PreflightDiagnostic {
                rule: "effect-determinism-visual",
                message: format!(
                    "{} 的确定性等级是 {}，成片不承诺逐位一致（§14.6）",
                    manifest.qualified(),
                    manifest.determinism.as_str()
                ),
            });
        }
        return Ok(());
    }
    let reason = if !missing.is_empty() {
        format!("后端 {} 缺能力 {missing:?}", caps.backend)
    } else if unimplemented {
        format!("内核 {} 没有 CPU reference 实现", manifest.kernel)
    } else {
        format!(
            "确定性等级 {} 低于本次导出的下限 {}",
            manifest.determinism.as_str(),
            caps.determinism_floor.as_str()
        )
    };
    let Some(fallback) = manifest.fallback.clone() else {
        report.fallbacks.push(FallbackRecord {
            effect: effect.clone(),
            reason: format!("effect-capability-unsupported: {reason}"),
            applied: None,
            applied_preset: None,
            determinism: manifest.determinism,
        });
        bail!(
            "effect-capability-unsupported: {} 无法在当前后端执行（{reason}），manifest 也没有 fallback（§6.6）",
            manifest.qualified()
        );
    };
    report.fallbacks.push(FallbackRecord {
        effect: effect.clone(),
        reason: format!("effect-fallback-applied: {reason}"),
        applied: Some(fallback.clone()),
        applied_preset: None,
        determinism: manifest.determinism,
    });
    report.diagnostics.push(PreflightDiagnostic {
        rule: "effect-fallback-applied",
        message: format!(
            "{} 已按 manifest 降级为 {}（{reason}，§14.6）",
            manifest.qualified(),
            fallback.qualified()
        ),
    });
    resolve_one(&fallback, caps, report, depth + 1)
}
