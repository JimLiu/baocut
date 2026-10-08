//! 内置效果注册表。与 preset 注册表同一纪律（设计 §5.4 / §6.3）：
//! `core/presets/builtin/{filter,composite}/*.json` 经 `include_str!` 嵌入、
//! `OnceLock` 一次性解析成 `'static` 结构；加一个效果 = 加一行。
//!
//! 目录与清单的一致性由 `tests/effects.rs`（dev-only，可以读文件系统）守住；
//! **每个 strict manifest 的 `kernel` 都有 CPU 参考实现**由
//! `bcut-render::effects` 的注册表测试守住——两边合起来才是 ADR-M05 的承诺。

use std::collections::BTreeMap;
use std::sync::OnceLock;

use super::manifest::{EffectDomain, EffectManifest, parse_manifest};
use crate::MotionError;
use crate::fingerprint::fnv1a64;

macro_rules! builtin_effect {
    ($ns:literal, $file:literal) => {
        (
            $ns,
            $file,
            include_str!(concat!("../../presets/builtin/", $ns, "/", $file, ".json")),
        )
    };
}

/// 加一个效果 = 加一行。
static EFFECT_SOURCES: &[(&str, &str, &str)] = &[
    builtin_effect!("filter", "filter.blur"),
    builtin_effect!("filter", "filter.brightness"),
    builtin_effect!("filter", "filter.contrast"),
    builtin_effect!("filter", "filter.saturation"),
    builtin_effect!("filter", "filter.grayscale"),
    builtin_effect!("filter", "filter.sepia"),
    builtin_effect!("filter", "filter.hueRotate"),
    builtin_effect!("filter", "filter.colorAdjust"),
    builtin_effect!("filter", "filter.invert"),
    builtin_effect!("filter", "filter.sharpen"),
    builtin_effect!("filter", "filter.rgbSplit"),
    builtin_effect!("filter", "filter.directionalBlur"),
    builtin_effect!("filter", "filter.outline"),
    builtin_effect!("filter", "filter.noise"),
    builtin_effect!("filter", "filter.vignette"),
    builtin_effect!("filter", "filter.dropShadow"),
    builtin_effect!("filter", "filter.chromaKey"),
    builtin_effect!("filter", "filter.alphaThreshold"),
    builtin_effect!("filter", "filter.bloom"),
    builtin_effect!("filter", "filter.grade"),
    builtin_effect!("filter", "filter.radialBlur"),
    builtin_effect!("filter", "filter.godRays"),
    builtin_effect!("filter", "mask.shape"),
    builtin_effect!("filter", "mask.progress"),
    builtin_effect!("filter", "mask.image"),
    builtin_effect!("filter", "mask.luma"),
    builtin_effect!("composite", "blend"),
    // Surface Transition（阶段 5，规范 §9）。与同目录的 `bcf.*.json` 分居两张
    // 注册表：前者是**双画面效果**，后者是双通道属性配方，只是词汇同源。
    builtin_effect!("transition", "transition.crossfade"),
    builtin_effect!("transition", "transition.slide"),
    builtin_effect!("transition", "transition.wipe"),
    builtin_effect!("transition", "transition.circleCrop"),
    builtin_effect!("transition", "transition.inkBlot"),
    builtin_effect!("transition", "transition.shatter"),
    builtin_effect!("transition", "transition.glitch"),
];

pub struct EffectRegistry {
    /// `(id, version) → manifest`，按 id 再按 version 排序。
    by_id: BTreeMap<(String, u32), EffectManifest>,
}

impl EffectRegistry {
    pub fn get(&self, id: &str, version: u32) -> Option<&EffectManifest> {
        self.by_id.get(&(id.to_owned(), version))
    }

    /// 只给 id 时取**最高**已注册版本。用于诊断，不用于求值：
    /// 求值一律要求显式版本（`preset-version-unknown` 不得静默升版）。
    pub fn latest(&self, id: &str) -> Option<&EffectManifest> {
        self.by_id
            .iter()
            .filter(|((key, _), _)| key == id)
            .next_back()
            .map(|(_, manifest)| manifest)
    }

    pub fn iter(&self) -> impl Iterator<Item = &EffectManifest> {
        self.by_id.values()
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    pub fn ids(&self) -> Vec<String> {
        self.by_id.keys().map(|(id, _)| id.clone()).collect()
    }

    pub fn in_domain(&self, domain: EffectDomain) -> Vec<&EffectManifest> {
        self.by_id
            .values()
            .filter(|manifest| manifest.domain == domain)
            .collect()
    }
}

static REGISTRY: OnceLock<Result<EffectRegistry, String>> = OnceLock::new();

fn build() -> Result<EffectRegistry, String> {
    let mut by_id = BTreeMap::new();
    for (_, file, source) in EFFECT_SOURCES {
        let manifest = parse_manifest(source, fnv1a64(source.as_bytes()))
            .map_err(|error| error.to_string())?;
        // 文件名必须等于 id：改名即红，不需要额外索引。
        if manifest.id != *file && !(*file == "blend" && manifest.id == "composite.blend") {
            return Err(format!(
                "manifest-invalid: {file}.json 声明的 id 是 {}",
                manifest.id
            ));
        }
        let key = (manifest.id.clone(), manifest.version);
        if by_id.insert(key, manifest).is_some() {
            return Err(format!("manifest-invalid: {file} 重复注册"));
        }
    }
    Ok(EffectRegistry { by_id })
}

/// 内置效果注册表（进程内解析一次）。
pub fn builtin_registry() -> &'static EffectRegistry {
    match REGISTRY.get_or_init(build) {
        Ok(registry) => registry,
        Err(error) => panic!("内置 effect manifest 非法：{error}"),
    }
}

/// 解析期自检：给 `validate_all` 风格的 dev 测试用，不 panic。
pub fn validate_all_effects() -> Result<(), MotionError> {
    REGISTRY
        .get_or_init(build)
        .as_ref()
        .map(|_| ())
        .map_err(|error| MotionError::ManifestInvalid(error.clone()))
}

/// 某个目录下已注册的文件名（不含 `.json`）。目录一致性测试用。
pub fn registered_effect_files(namespace: &str) -> Vec<&'static str> {
    EFFECT_SOURCES
        .iter()
        .filter(|(ns, _, _)| *ns == namespace)
        .map(|(_, file, _)| *file)
        .collect()
}

/// 查一个 `(id, version)`，区分「没这个效果」与「没这个版本」。
pub fn lookup(id: &str, version: u32) -> Result<&'static EffectManifest, MotionError> {
    let registry = builtin_registry();
    if let Some(manifest) = registry.get(id, version) {
        return Ok(manifest);
    }
    if registry.latest(id).is_some() {
        return Err(MotionError::PresetVersionUnknown(format!("{id}@{version}")));
    }
    Err(MotionError::PresetUnknown(id.to_owned()))
}
