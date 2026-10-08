//! 关键帧通道与纯函数采样（规范 §14.1 sample(t)）。

use crate::color::Rgba;
use crate::ease::apply_ease;
use motion::{CompositeMode, PostOp};
use serde_json::{Map, Value};

#[derive(Debug, Clone)]
pub struct Kf {
    pub t: f64,
    pub v: Value,
    pub ease: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Channel {
    pub prop: String,
    pub frames: Vec<Kf>,
    /// countUp 等 preset 的展示参数（prefix/suffix/decimals）
    pub meta: Option<Map<String, Value>>,
    /// 合成模式（规范 §7.7）。legacy 四槽恒为 `Replace`。
    pub composite: CompositeMode,
    /// replace 通道之间的覆盖序：窗口重叠时大者胜；同序时后声明者胜（见 `replace_rank`）。
    /// 四槽的取值是 enter=0、exit=1000、emphasis[i]=(2+i)·1000、keyframes[j]=(1000+j)·1000，
    /// 与「后声明覆盖」（规范 §7.1）同序。
    pub order: u32,
}

impl Channel {
    /// legacy 通道：`Replace` + `order 0`。
    pub fn replace(prop: String, frames: Vec<Kf>, meta: Option<Map<String, Value>>) -> Self {
        Self {
            prop,
            frames,
            meta,
            composite: CompositeMode::Replace,
            order: 0,
        }
    }
}

/// 一组通道在某一刻的合成结果（规范 §7.7 的固定序）。
///
/// `values` 只装 **replace** 胜出值（胜者按 `replace_rank` 在 `t` 时刻裁决）；
/// `add` / `mul` 单独保存，由调用方带上它自己的 base（元素 style 的静态变换初值）
/// 折叠。没有 add / multiply 参与时 `scalar()` 原样返回 replace 值。
/// `add` / `mul` 是 `Option`：绝大多数节点是纯 replace，这两张表就永远不分配。
#[derive(Debug, Clone, Default)]
pub struct SampledPose {
    pub values: Map<String, Value>,
    add: Option<Map<String, Value>>,
    mul: Option<Map<String, Value>>,
    /// `textCount` 通道的展示参数。
    pub count_meta: Option<Map<String, Value>>,
}

impl SampledPose {
    pub fn get(&self, prop: &str) -> Option<&Value> {
        self.values.get(prop)
    }

    /// 折叠：`(replace ?? base) + Σadd) × Πmul`，再按属性归一（规范 §7.7 第 5 步）。
    pub fn scalar(&self, prop: &str, base: f64) -> f64 {
        let raw = self
            .values
            .get(prop)
            .and_then(Value::as_f64)
            .unwrap_or(base);
        let add = self
            .add
            .as_ref()
            .and_then(|m| m.get(prop))
            .and_then(Value::as_f64);
        let mul = self
            .mul
            .as_ref()
            .and_then(|m| m.get(prop))
            .and_then(Value::as_f64);
        if add.is_none() && mul.is_none() {
            return raw;
        }
        PostOp::for_property(prop).apply((raw + add.unwrap_or(0.0)) * mul.unwrap_or(1.0))
    }

    /// 有没有 add / multiply 轨参与。legacy 四槽恒为 `false`。
    pub fn has_composition(&self) -> bool {
        let filled = |m: &Option<Map<String, Value>>| m.as_ref().is_some_and(|m| !m.is_empty());
        filled(&self.add) || filled(&self.mul)
    }
}

/// replace 通道在 `t` 时刻的覆盖等级（规范 §7.7），元组大者胜：
///
/// - `2` 窗口 `[首帧, 末帧]` 之内——同级比 `order`（§7.1「后声明覆盖」）；
/// - `1` 已结束、保持末值——同级比谁结束得晚（最近一次写入者）；
/// - `0` 尚未开始、回填首值——同级比谁开始得早。
///
/// 最后比 `order`，再平手则后声明者胜。于是只有**窗口真正重叠**时 `order`
/// 才决定输赢（正是 `motion-replace-overlap` 报的情形）：首尾相接的两段关键帧、
/// 同一属性上的 enter 与 exit 各管各的窗口，不会被后者回填的首值整段盖掉。
fn replace_rank(frames: &[Kf], order: u32, t: f64) -> (u8, f64, u32) {
    let (Some(first), Some(last)) = (frames.first(), frames.last()) else {
        return (0, f64::NEG_INFINITY, order);
    };
    if t < first.t {
        (0, -first.t, order)
    } else if t > last.t {
        (1, last.t, order)
    } else {
        (2, 0.0, order)
    }
}

/// 按规范 §7.7 的固定序采样一组通道。
pub fn sample_channels(channels: &[Channel], t: f64) -> SampledPose {
    let mut pose = SampledPose::default();
    // 覆盖序台账：通道数很小，借用 prop 的线性表比 `Map<String, Value>` 省掉
    // 每通道一次 String 克隆 + 一个 JSON 数字。
    let mut winner: Vec<(&str, (u8, f64, u32))> = Vec::new();
    for ch in channels {
        let v = if ch.prop == "text" {
            let index = ch
                .frames
                .partition_point(|frame| frame.t <= t)
                .saturating_sub(1);
            ch.frames
                .get(index)
                .map_or(Value::Null, |frame| frame.v.clone())
        } else {
            sample_frames(&ch.frames, t)
        };
        if ch.prop == "textCount" {
            pose.count_meta = ch.meta.clone();
        }
        match ch.composite {
            CompositeMode::Replace => {
                let rank = replace_rank(&ch.frames, ch.order, t);
                match winner.iter_mut().find(|(prop, _)| *prop == ch.prop) {
                    Some((_, seen)) => {
                        // 等级见 `replace_rank`；完全平手时后声明者胜（规范 §7.1）。
                        if rank >= *seen {
                            *seen = rank;
                            // 该 prop 此前已胜出过 ⇒ `values` 里一定有槽位，原地
                            // 覆写即可，不必再克隆一次键。
                            match pose.values.get_mut(&ch.prop) {
                                Some(slot) => *slot = v,
                                None => {
                                    pose.values.insert(ch.prop.clone(), v);
                                }
                            }
                        }
                    }
                    None => {
                        winner.push((ch.prop.as_str(), rank));
                        pose.values.insert(ch.prop.clone(), v);
                    }
                }
            }
            CompositeMode::Add => {
                let Some(raw) = v.as_f64() else { continue };
                let add = pose.add.get_or_insert_with(Map::new);
                let acc = add.get(&ch.prop).and_then(Value::as_f64).unwrap_or(0.0);
                add.insert(ch.prop.clone(), Value::from(acc + raw));
            }
            CompositeMode::Multiply => {
                let Some(raw) = v.as_f64() else { continue };
                let mul = pose.mul.get_or_insert_with(Map::new);
                let acc = mul.get(&ch.prop).and_then(Value::as_f64).unwrap_or(1.0);
                mul.insert(ch.prop.clone(), Value::from(acc * raw));
            }
        }
    }
    pose
}

/// 数字线性 / 颜色分量 / 对象逐键；其余阶跃。
pub fn mix_value(a: &Value, b: &Value, u: f64) -> Value {
    if let (Some(na), Some(nb)) = (a.as_f64(), b.as_f64()) {
        return Value::from(na + (nb - na) * u);
    }
    if let (Some(sa), Some(sb)) = (a.as_str(), b.as_str()) {
        if let (Some(ca), Some(cb)) = (Rgba::parse(sa), Rgba::parse(sb)) {
            return Value::from(ca.mixed(&cb, u).css());
        }
    }
    if let (Some(oa), Some(ob)) = (a.as_object(), b.as_object()) {
        let mut out = Map::new();
        for (k, vb) in ob {
            let va = oa.get(k).unwrap_or(vb);
            out.insert(k.clone(), mix_value(va, vb, u));
        }
        return Value::Object(out);
    }
    if u < 1.0 { a.clone() } else { b.clone() }
}

pub fn sample_frames(frames: &[Kf], t: f64) -> Value {
    let (Some(first), Some(last)) = (frames.first(), frames.last()) else {
        return Value::Null;
    };
    if t <= first.t {
        return first.v.clone();
    }
    if t >= last.t {
        return last.v.clone();
    }
    for w in frames.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        if t >= a.t && t <= b.t {
            let span = b.t - a.t;
            let mut u = if span == 0.0 { 1.0 } else { (t - a.t) / span };
            u = apply_ease(b.ease.as_deref(), u);
            return mix_value(&a.v, &b.v, u);
        }
    }
    last.v.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn kf(t: f64, v: Value, ease: Option<&str>) -> Kf {
        Kf {
            t,
            v,
            ease: ease.map(String::from),
        }
    }

    #[test]
    fn numeric_channel() {
        let frames = vec![kf(0.0, json!(0), None), kf(1.0, json!(100), None)];
        assert_eq!(sample_frames(&frames, -1.0), json!(0));
        assert_eq!(sample_frames(&frames, 0.5), json!(50.0));
        assert_eq!(sample_frames(&frames, 2.0), json!(100));
    }

    #[test]
    fn eased_channel() {
        let frames = vec![
            kf(0.0, json!(0), None),
            kf(1.0, json!(1), Some("easeOutCubic")),
        ];
        let v = sample_frames(&frames, 0.5).as_f64().unwrap();
        assert!((v - 0.875).abs() < 1e-12);
    }

    #[test]
    fn color_channel() {
        let frames = vec![
            kf(0.0, json!("#000000"), None),
            kf(1.0, json!("#ffffff"), None),
        ];
        let v = sample_frames(&frames, 0.5);
        let c = Rgba::parse(v.as_str().unwrap()).unwrap();
        assert!((c.r - 127.5).abs() < 1.0);
    }

    #[test]
    fn object_channel() {
        let frames = vec![
            kf(0.0, json!({"x": 0, "zoom": 1.0}), None),
            kf(1.0, json!({"x": 100, "zoom": 2.0}), None),
        ];
        let v = sample_frames(&frames, 0.5);
        assert_eq!(v["x"], json!(50.0));
        assert_eq!(v["zoom"], json!(1.5));
    }
}
