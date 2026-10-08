//! Preset 展开：alias → canonical → 递归 compose → 参数校验 → 循环检测
//! （设计 §5.4.2、规范 §7.4）。
//!
//! 展开结果里**不残留 preset 名**：provenance 只以 `ExpandedPreset::sources` 侧车
//! 形式保留，最终进 `MotionProgram::sources`，采样期从不查它。
//!
//! 相对长度在这里**不求值**——`ResolvedFrame::v` 保留 `{value, basis, offset}` 原文
//! 对象，由布局之后的 `scene_primitives::resolve::build_channels_after_layout` 求值
//! （设计 §5.5：`self*/parent*` 需要静态布局）。

use serde_json::{Map, Value};

use crate::MotionError;
use crate::composite::{CompositeMode, default_mode};
use crate::curve::CurveSpec;
use crate::program::PresetRef;

use super::frozen::BcfPreset;
use super::manifest::{ComposeStep, PresetBody, PresetManifest, TrackSpec};
use super::substitute::{deep_substitute, substitute};

/// 配方来源。生产用 `Builtin`（静态注册表）；单测用内存表注入病态 manifest
/// （自引用、缺参数…），因为那些配方不该被发布。
pub trait PresetSource {
    fn manifest(&self, id: &str) -> Option<&PresetManifest>;
    fn bcf(&self, id: &str) -> Option<&BcfPreset>;
    /// alias → canonical id；不是 alias 时返回原串。
    fn canonical<'a>(&'a self, id: &'a str) -> &'a str;
}

/// 内置注册表。
pub struct Builtin;

impl PresetSource for Builtin {
    fn manifest(&self, id: &str) -> Option<&PresetManifest> {
        super::manifest(id)
    }

    fn bcf(&self, id: &str) -> Option<&BcfPreset> {
        super::bcf_preset(id)
    }

    fn canonical<'a>(&'a self, id: &'a str) -> &'a str {
        super::canonical_id(id)
    }
}

/// 递归深度上限。防御非环的病态深度（环本身由 `stack` 抓）。
const MAX_COMPOSE_DEPTH: usize = 32;

pub struct ExpandCtx {
    /// 引用点声明的时长；`'%'` 帧按它铺开。
    pub dur: f64,
    /// 规范 §7.3：省略 seed 时编译期写死 0。
    pub default_seed: u64,
}

impl ExpandCtx {
    pub fn with_dur(dur: f64) -> Self {
        Self {
            dur,
            default_seed: 0,
        }
    }
}

/// `t` 是**相对秒**（0..dur），调用方再加窗口起点。
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedFrame {
    pub t: f64,
    /// 数字，或未求值的 `{value, basis, offset}` 相对长度对象。
    pub v: Value,
    pub ease: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedTrack {
    pub prop: String,
    pub composite: CompositeMode,
    pub order: u32,
    pub frames: Vec<ResolvedFrame>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ExpandedPreset {
    pub tracks: Vec<ResolvedTrack>,
    pub sources: Vec<PresetRef>,
    /// 命中的 alias（供 `preset-alias-used` info lint）。
    pub aliases_used: Vec<String>,
}

/// 展开一个通用 manifest（或经 alias 指向它的旧名）。
///
/// `version` 缺省 = 该 id 的最低已发布版本（规范 §7.4，**不静默取最新**）。
pub fn expand(
    id: &str,
    version: Option<u32>,
    user_params: &Map<String, Value>,
    ctx: &ExpandCtx,
) -> Result<ExpandedPreset, MotionError> {
    expand_with(&Builtin, id, version, user_params, ctx)
}

/// 可注入来源的展开（单测与未来的第三方包用）。
pub fn expand_with(
    source: &dyn PresetSource,
    id: &str,
    version: Option<u32>,
    user_params: &Map<String, Value>,
    ctx: &ExpandCtx,
) -> Result<ExpandedPreset, MotionError> {
    let mut out = ExpandedPreset::default();
    let mut stack: Vec<String> = Vec::new();
    expand_inner(
        source,
        id,
        version,
        user_params,
        0.0,
        ctx.dur,
        ctx,
        &mut stack,
        &mut out,
    )?;
    out.tracks.sort_by(|a, b| a.order.cmp(&b.order));
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
fn expand_inner(
    source: &dyn PresetSource,
    id: &str,
    version: Option<u32>,
    user_params: &Map<String, Value>,
    at: f64,
    dur: f64,
    ctx: &ExpandCtx,
    stack: &mut Vec<String>,
    out: &mut ExpandedPreset,
) -> Result<(), MotionError> {
    let canonical = source.canonical(id);
    if canonical != id {
        let alias = id.to_owned();
        if !out.aliases_used.contains(&alias) {
            out.aliases_used.push(alias);
        }
    }

    if stack.iter().any(|seen| seen == canonical) {
        stack.push(canonical.to_owned());
        return Err(MotionError::PresetComposeCycle(stack.join(" → ")));
    }
    if stack.len() >= MAX_COMPOSE_DEPTH {
        stack.push(canonical.to_owned());
        return Err(MotionError::PresetComposeCycle(stack.join(" → ")));
    }

    let Some(manifest) = source.manifest(canonical) else {
        // 冻结的 `bcf.*@1` 配方也可以被 compose 引用（规范附录 B 的 fadeIn/fadeOut）。
        return expand_frozen_bcf(source, canonical, version, user_params, at, dur, out);
    };
    if let Some(requested) = version {
        if requested > manifest.version {
            return Err(MotionError::PresetVersionUnknown(format!(
                "{canonical}@{requested} > {}",
                manifest.version
            )));
        }
    }
    let params = bind_params(manifest, user_params)?;
    out.sources.push(PresetRef {
        id: manifest.id.clone(),
        version: manifest.version,
        manifest_hash: manifest.manifest_hash,
    });

    stack.push(canonical.to_owned());
    let result = match &manifest.body {
        PresetBody::Leaf(tracks) => lower_leaf(manifest, tracks, &params, at, dur, out),
        PresetBody::Compose(steps) => {
            lower_compose(source, manifest, steps, &params, at, dur, ctx, stack, out)
        }
        PresetBody::Ops(ops) => lower_ops(manifest, ops, &params, at, dur, ctx, out),
    };
    stack.pop();
    result
}

/// 参数绑定：缺省填充 → 用户覆盖 → 未知键 / 必填缺失 / 类型校验。
fn bind_params(
    manifest: &PresetManifest,
    user_params: &Map<String, Value>,
) -> Result<Map<String, Value>, MotionError> {
    for key in user_params.keys() {
        if !manifest.params.contains_key(key) {
            return Err(MotionError::PresetParamUnknown(format!(
                "{}.{key}",
                manifest.id
            )));
        }
    }
    let mut params = Map::new();
    for (key, spec) in &manifest.params {
        let value = match user_params.get(key) {
            Some(value) => value.clone(),
            None => match &spec.default {
                Some(default) => default.clone(),
                None => {
                    return Err(MotionError::PresetParamMissing(format!(
                        "{}.{key}",
                        manifest.id
                    )));
                }
            },
        };
        spec.ty.check(&manifest.id, key, &value)?;
        params.insert(key.clone(), value);
    }
    Ok(params)
}

fn curve_name(value: &Value, params: &Map<String, Value>) -> Option<String> {
    substitute(value, params)
        .as_str()
        .map(str::to_owned)
        .filter(|name| !name.is_empty())
}

fn lower_leaf(
    manifest: &PresetManifest,
    tracks: &[TrackSpec],
    params: &Map<String, Value>,
    at: f64,
    dur: f64,
    out: &mut ExpandedPreset,
) -> Result<(), MotionError> {
    let default_curve = manifest
        .defaults
        .curve
        .as_ref()
        .and_then(|value| curve_name(value, params));
    for track in tracks {
        let track_curve = track
            .curve
            .as_ref()
            .and_then(|value| curve_name(value, params))
            .or_else(|| default_curve.clone());
        let mut frames = Vec::with_capacity(track.frames.len());
        let mut dropped = false;
        for (index, frame) in track.frames.iter().enumerate() {
            let v = eval_manifest_value(&manifest.id, &deep_substitute(&frame.v, params))?;
            if v.is_null() {
                // `case` 表没有这个分支 ⇒ 该方向不驱动这条轨（例如 direction=up 的 x）。
                dropped = true;
                break;
            }
            if v.as_f64().is_none() && !super::manifest::is_relative_length_object(&v) {
                return Err(MotionError::ManifestInvalid(format!(
                    "{}: track \"{}\" frame value {v} is neither a number nor a length",
                    manifest.id, track.prop
                )));
            }
            let ease = match &frame.ease {
                Some(value) => curve_name(value, params),
                // 首帧不带曲线（`sample_frames` 从不读首帧的 ease）
                None if index == 0 => None,
                None => track_curve.clone(),
            };
            if let Some(name) = &ease {
                if matches!(CurveSpec::from_name(name), CurveSpec::Unknown(_)) {
                    return Err(MotionError::ManifestInvalid(format!(
                        "{}: unknown easing \"{name}\"",
                        manifest.id
                    )));
                }
            }
            frames.push(ResolvedFrame {
                t: at + frame.t.seconds(dur),
                v,
                ease,
            });
        }
        if dropped {
            continue;
        }
        let composite = track
            .composite
            .or(manifest.defaults.composite)
            .unwrap_or_else(|| default_mode(&track.prop));
        push_track(out, &track.prop, composite, track.order, frames);
    }
    Ok(())
}

/// ops 体（[`PresetBody::Ops`]）：`"{param}"` 替换 → `flow` 解析 → `graph` 编译
/// → 关键帧。`"{dur}"` 是**隐式绑定**，等于引用点声明的时长（manifest 因此不必
/// 也不能声明一个叫 `dur` 的参数）。
///
/// ops 体不能产出无名曲线：`graph` 已经把曲线对象铺成线性关键帧，剩下的
/// `ease` 一定是封闭枚举里的名字，正好落进 `ResolvedFrame::ease`。
fn lower_ops(
    manifest: &PresetManifest,
    ops: &[Value],
    params: &Map<String, Value>,
    at: f64,
    dur: f64,
    ctx: &ExpandCtx,
    out: &mut ExpandedPreset,
) -> Result<(), MotionError> {
    let mut bound = params.clone();
    bound.insert("dur".into(), Value::from(dur));
    let items: Vec<Value> = ops.iter().map(|op| deep_substitute(op, &bound)).collect();
    let flow = if items.len() == 1 {
        items.into_iter().next().expect("one op")
    } else {
        serde_json::json!({ "op": "parallel", "items": items })
    };
    let graph = crate::flow::parse_flow(
        &flow,
        &crate::flow::FlowParseCtx {
            part_count: 0,
            default_seed: ctx.default_seed,
        },
    )?;
    let compiled = crate::graph::compile_flow(&graph, &crate::graph::CompileCtx::default())?;
    for track in compiled.tracks {
        if track.target != crate::program::TargetId::SELF {
            return Err(MotionError::ManifestInvalid(format!(
                "{}: ops 体不得声明 target",
                manifest.id
            )));
        }
        let frames = track
            .frames
            .into_iter()
            .map(|frame| ResolvedFrame {
                t: at + frame.t,
                v: frame.v,
                ease: frame.ease,
            })
            .collect();
        push_track(out, &track.prop, track.composite, track.order, frames);
    }
    Ok(())
}

/// manifest 专用的两个**封闭**构造。两者都只出现在 `core/presets/builtin/**`，
/// BCF 文档里没有它们——规范 §7.4「`"{param}"` 是唯一替换语法、不做算术」约束的是
/// 文档作者，这里是配方作者的词汇表（见规范 §7.4 实现注记）。
///
/// - `{"case": <已替换的枚举值>, "of": {…}}`：按枚举参数选值。`of` 里没有这个键
///   ⇒ `null` ⇒ 整条轨丢弃（`direction: "up"` 时 `x` 轨根本不存在，而不是一条全 0 轨）。
/// - `{"length": <数字或长度对象>, "scale": <字面量>}`：字面量幅度 / 符号乘子。
///   `scale` **必须**是 manifest 里的字面数字，不接受 `"{param}"`——否则就成了表达式。
fn eval_manifest_value(id: &str, value: &Value) -> Result<Value, MotionError> {
    let Some(object) = value.as_object() else {
        return Ok(value.clone());
    };
    if let Some(case) = object.get("case") {
        let table = object.get("of").and_then(Value::as_object).ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{id}: \"case\" without an \"of\" table"))
        })?;
        let key = case.as_str().ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{id}: \"case\" resolved to {case}, not a string"))
        })?;
        let picked = table.get(key).cloned().unwrap_or(Value::Null);
        return eval_manifest_value(id, &picked);
    }
    let Some(inner) = object.get("length") else {
        return Ok(value.clone());
    };
    let scale = match object.get("scale") {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(1.0),
        None => 1.0,
        Some(other) => {
            return Err(MotionError::ManifestInvalid(format!(
                "{id}: \"scale\" must be a literal number, got {other}"
            )));
        }
    };
    let inner = eval_manifest_value(id, inner)?;
    if let Some(n) = inner.as_f64() {
        return Ok(Value::from(n * scale));
    }
    let length = super::manifest::parse_length_value(&inner).ok_or_else(|| {
        MotionError::ManifestInvalid(format!("{id}: \"length\" resolved to {inner}"))
    })?;
    Ok(serde_json::json!({
        "value": length.value * scale,
        "basis": length.basis.name(),
        "offset": length.offset_px * scale,
    }))
}

#[allow(clippy::too_many_arguments)]
fn lower_compose(
    source: &dyn PresetSource,
    manifest: &PresetManifest,
    steps: &[ComposeStep],
    params: &Map<String, Value>,
    at: f64,
    dur: f64,
    ctx: &ExpandCtx,
    stack: &mut Vec<String>,
    out: &mut ExpandedPreset,
) -> Result<(), MotionError> {
    for step in steps {
        if let Some(when) = &step.when {
            let resolved = substitute(when, params);
            let Some(enabled) = resolved.as_bool() else {
                return Err(MotionError::ManifestInvalid(format!(
                    "{}: \"when\" resolved to {resolved}, not a boolean",
                    manifest.id
                )));
            };
            if !enabled {
                continue;
            }
        }
        let mut child_params = Map::new();
        for (key, value) in &step.params {
            child_params.insert(key.clone(), deep_substitute(value, params));
        }
        expand_inner(
            source,
            &step.preset,
            step.version,
            &child_params,
            at + step.at,
            dur * step.dur_scale,
            ctx,
            stack,
            out,
        )?;
    }
    Ok(())
}

/// 冻结的 `bcf.*@1` 配方（`{params?, keyframes}`）被 compose 引用时的展开。
/// 数值走同一条 `'%'` → 秒的换算，composite 用属性缺省表。
///
/// 注意 `countUp` 的 `emitsParamsMeta`（prefix/suffix/decimals）在这里**不产出**——
/// `Channel::meta` 属于 BCF 文档域，由 `Resolver::lay_preset_frames` 挂上。
/// 阶段 2 没有任何 family compose 它；真要 compose 时得先决定 meta 怎么合并。
fn expand_frozen_bcf(
    source: &dyn PresetSource,
    id: &str,
    version: Option<u32>,
    user_params: &Map<String, Value>,
    at: f64,
    dur: f64,
    out: &mut ExpandedPreset,
) -> Result<(), MotionError> {
    let Some(preset) = source.bcf(id) else {
        return Err(MotionError::PresetUnknown(id.to_owned()));
    };
    if let Some(requested) = version {
        if requested > preset.version {
            return Err(MotionError::PresetVersionUnknown(format!(
                "{id}@{requested} > {}",
                preset.version
            )));
        }
    }
    let mut params = Map::new();
    if let Some(specs) = preset.definition.get("params").and_then(Value::as_object) {
        for (key, spec) in specs {
            params.insert(
                key.clone(),
                spec.get("default").cloned().unwrap_or(Value::Null),
            );
        }
    }
    for (key, value) in user_params {
        if !params.contains_key(key) {
            return Err(MotionError::PresetParamUnknown(format!("{id}.{key}")));
        }
        params.insert(key.clone(), value.clone());
    }
    out.sources.push(PresetRef {
        id: preset.id.clone(),
        version: preset.version,
        manifest_hash: preset.manifest_hash,
    });
    let kfs = preset
        .definition
        .get("keyframes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for channel in &kfs {
        let Some(prop) = channel.get("prop").and_then(Value::as_str) else {
            continue;
        };
        let mut frames = Vec::new();
        for frame in channel
            .get("frames")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
        {
            let raw_t = frame.get("t").cloned().unwrap_or(Value::Null);
            let t = raw_t
                .as_str()
                .and_then(|s| s.strip_suffix('%'))
                .and_then(|s| s.parse::<f64>().ok())
                .map(|pct| pct / 100.0 * dur)
                .or_else(|| raw_t.as_f64())
                .ok_or_else(|| {
                    MotionError::ManifestInvalid(format!("{id}: bad frame time {raw_t}"))
                })?;
            frames.push(ResolvedFrame {
                t: at + t,
                v: deep_substitute(&frame.get("v").cloned().unwrap_or(Value::Null), &params),
                ease: frame.get("ease").and_then(Value::as_str).map(str::to_owned),
            });
        }
        push_track(out, prop, default_mode(prop), 0, frames);
    }
    Ok(())
}

/// 同一 `(prop, composite, order)` 合并到一条轨；否则新开一条（多轨叠加是
/// `composite` 生效的前提，设计 §5.1）。
fn push_track(
    out: &mut ExpandedPreset,
    prop: &str,
    composite: CompositeMode,
    order: u32,
    frames: Vec<ResolvedFrame>,
) {
    if let Some(track) = out
        .tracks
        .iter_mut()
        .find(|t| t.prop == prop && t.composite == composite && t.order == order)
    {
        track.frames.extend(frames);
        track
            .frames
            .sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
        return;
    }
    out.tracks.push(ResolvedTrack {
        prop: prop.to_owned(),
        composite,
        order,
        frames,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fingerprint::fnv1a64;
    use serde_json::json;

    /// 内存表：可以喂进永远不该被发布的病态 manifest（自引用、缺参数…）。
    struct TestSource {
        manifests: Vec<PresetManifest>,
    }

    impl TestSource {
        fn new(docs: &[Value]) -> Self {
            Self {
                manifests: docs
                    .iter()
                    .map(|doc| {
                        let raw = serde_json::to_string(doc).unwrap();
                        super::super::manifest::parse_manifest(
                            "test.json",
                            doc,
                            fnv1a64(raw.as_bytes()),
                        )
                        .unwrap()
                    })
                    .collect(),
            }
        }
    }

    impl PresetSource for TestSource {
        fn manifest(&self, id: &str) -> Option<&PresetManifest> {
            self.manifests.iter().find(|m| m.id == id)
        }

        fn bcf(&self, id: &str) -> Option<&BcfPreset> {
            super::super::bcf_preset(id)
        }

        fn canonical<'a>(&'a self, id: &'a str) -> &'a str {
            self.manifests
                .iter()
                .find(|m| m.aliases.iter().any(|alias| alias == id))
                .map(|m| m.id.as_str())
                .unwrap_or(id)
        }
    }

    fn leaf(id: &str) -> Value {
        json!({
            "id": id, "version": 1, "domain": "motion", "family": "leaf",
            "determinism": "strict",
            "params": {"distance": {"type": "length", "default": 24.0}},
            "tracks": [{"prop": "y", "composite": "add", "order": 0,
                        "frames": [{"t": "0%", "v": "{distance}"},
                                   {"t": "100%", "v": 0, "ease": "easeOutCubic"}]}]
        })
    }

    fn expand_in(
        source: &TestSource,
        id: &str,
        params: Value,
    ) -> Result<ExpandedPreset, MotionError> {
        expand_with(
            source,
            id,
            None,
            params.as_object().unwrap(),
            &ExpandCtx::with_dur(0.5),
        )
    }

    #[test]
    fn leaf_frames_land_on_relative_seconds() {
        let source = TestSource::new(&[leaf("motion.a")]);
        let out = expand_in(&source, "motion.a", json!({"distance": 40.0})).unwrap();
        assert_eq!(out.tracks.len(), 1);
        let track = &out.tracks[0];
        assert_eq!(track.composite, CompositeMode::Add);
        assert_eq!(track.frames[0].t, 0.0);
        assert_eq!(track.frames[0].v, json!(40.0));
        assert_eq!(track.frames[1].t, 0.5);
        assert_eq!(track.frames[1].ease.as_deref(), Some("easeOutCubic"));
        assert_eq!(out.sources.len(), 1);
        assert_eq!(out.sources[0].id, "motion.a");
    }

    #[test]
    fn relative_lengths_survive_expansion_unevaluated() {
        let source = TestSource::new(&[leaf("motion.a")]);
        let out = expand_in(
            &source,
            "motion.a",
            json!({"distance": {"value": 0.04, "basis": "canvasShortEdge"}}),
        )
        .unwrap();
        assert_eq!(
            out.tracks[0].frames[0].v,
            json!({"value": 0.04, "basis": "canvasShortEdge"})
        );
    }

    #[test]
    fn compose_cycles_are_detected() {
        let source = TestSource::new(&[
            json!({"id": "motion.a", "version": 1, "domain": "motion", "determinism": "strict",
                   "compose": [{"preset": "motion.b"}]}),
            json!({"id": "motion.b", "version": 1, "domain": "motion", "determinism": "strict",
                   "compose": [{"preset": "motion.a"}]}),
        ]);
        let error = expand_in(&source, "motion.a", json!({})).unwrap_err();
        assert!(
            matches!(&error, MotionError::PresetComposeCycle(path)
                     if path == "motion.a → motion.b → motion.a"),
            "{error}"
        );
        assert!(error.to_string().starts_with("preset-compose-cycle"));
    }

    #[test]
    fn self_referencing_manifests_are_detected_too() {
        let source = TestSource::new(&[
            json!({"id": "motion.a", "version": 1, "domain": "motion", "determinism": "strict",
                   "compose": [{"preset": "motion.a"}]}),
        ]);
        assert!(matches!(
            expand_in(&source, "motion.a", json!({})),
            Err(MotionError::PresetComposeCycle(_))
        ));
    }

    #[test]
    fn unknown_and_missing_params_are_reported_separately() {
        let source = TestSource::new(&[
            json!({"id": "motion.a", "version": 1, "domain": "motion", "determinism": "strict",
                   "params": {"amount": {"type": "number"}},
                   "tracks": [{"prop": "y", "frames": [{"t": "0%", "v": "{amount}"},
                                                       {"t": "100%", "v": 0}]}]}),
        ]);
        assert!(matches!(
            expand_in(&source, "motion.a", json!({})),
            Err(MotionError::PresetParamMissing(_))
        ));
        assert!(matches!(
            expand_in(&source, "motion.a", json!({"amount": 1.0, "nope": 2.0})),
            Err(MotionError::PresetParamUnknown(_))
        ));
        assert!(matches!(
            expand_in(&source, "motion.a", json!({"amount": "big"})),
            Err(MotionError::PresetParamUnknown(_))
        ));
        assert!(expand_in(&source, "motion.a", json!({"amount": 1.0})).is_ok());
    }

    #[test]
    fn higher_versions_are_refused_instead_of_silently_using_the_latest() {
        let source = TestSource::new(&[leaf("motion.a")]);
        let error = expand_with(
            &source,
            "motion.a",
            Some(2),
            &Map::new(),
            &ExpandCtx::with_dur(0.5),
        )
        .unwrap_err();
        assert!(matches!(error, MotionError::PresetVersionUnknown(_)));
        assert!(
            expand_with(
                &source,
                "motion.a",
                Some(1),
                &Map::new(),
                &ExpandCtx::with_dur(0.5)
            )
            .is_ok()
        );
    }

    #[test]
    fn unknown_presets_report_preset_unknown() {
        let source = TestSource::new(&[]);
        assert!(matches!(
            expand_in(&source, "motion.nope", json!({})),
            Err(MotionError::PresetUnknown(_))
        ));
    }

    #[test]
    fn aliases_resolve_to_canonical_and_are_reported() {
        let mut doc = leaf("motion.a");
        doc["aliases"] = json!(["oldName"]);
        let source = TestSource::new(&[doc]);
        let out = expand_in(&source, "oldName", json!({})).unwrap();
        assert_eq!(out.aliases_used, vec!["oldName".to_string()]);
        assert_eq!(out.sources[0].id, "motion.a");
    }

    #[test]
    fn when_false_skips_the_step() {
        let source = TestSource::new(&[
            leaf("motion.a"),
            json!({"id": "motion.c", "version": 1, "domain": "motion", "determinism": "strict",
                   "params": {"fade": {"type": "bool", "default": true}},
                   "compose": [{"preset": "motion.a", "when": "{fade}"}]}),
        ]);
        assert_eq!(
            expand_in(&source, "motion.c", json!({}))
                .unwrap()
                .tracks
                .len(),
            1
        );
        assert!(
            expand_in(&source, "motion.c", json!({"fade": false}))
                .unwrap()
                .tracks
                .is_empty()
        );
    }

    #[test]
    fn compose_can_reference_the_frozen_bcf_recipes() {
        let source = TestSource::new(&[
            json!({"id": "motion.c", "version": 1, "domain": "motion", "determinism": "strict",
                   "compose": [{"preset": "fadeIn"}]}),
        ]);
        let out = expand_in(&source, "motion.c", json!({})).unwrap();
        assert_eq!(out.tracks.len(), 1);
        assert_eq!(out.tracks[0].prop, "opacity");
        // 规范 §7.7：opacity 缺省 multiply
        assert_eq!(out.tracks[0].composite, CompositeMode::Multiply);
        assert_eq!(out.tracks[0].frames[1].t, 0.5);
        assert!(out.sources.iter().any(|s| s.id == "fadeIn"));
    }

    #[test]
    fn compose_steps_offset_and_scale_the_child_window() {
        let source = TestSource::new(&[
            leaf("motion.a"),
            json!({"id": "motion.c", "version": 1, "domain": "motion", "determinism": "strict",
                   "compose": [{"preset": "motion.a", "at": 0.1, "durScale": 0.5}]}),
        ]);
        let out = expand_in(&source, "motion.c", json!({})).unwrap();
        assert_eq!(out.tracks[0].frames[0].t, 0.1);
        assert_eq!(out.tracks[0].frames[1].t, 0.35);
    }
}
