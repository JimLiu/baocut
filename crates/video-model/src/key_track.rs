//! 键盘轨（视频格式规范 §4.10）：一次录制里按键的按下与抬起。它是录下来的事实，存成素材（`kind: 'other'`，媒体类型
//! [`KEY_TRACK_MEDIA_TYPE`]），由录制清单的 `keyboard` 流引用；按键怎样显示是编辑意图，不在这里。
//!
//! 时刻是素材自己的时钟（0 是素材开头）上的非负整数刻度；落到录制时间按清单里这路流的 `start`。

use serde::{Deserialize, Serialize};

pub const KEY_TRACK_FORMAT: &str = "baocut-key-track";
pub const KEY_TRACK_VERSION: u32 = 1;
pub const KEY_TRACK_MEDIA_TYPE: &str = "application/x-baocut-key-track+json";
/// 一份键盘轨的字节上限。
pub const KEY_TRACK_MAX_BYTES: u64 = 32 * 1024 * 1024;
/// 事件数的上限。
pub const KEY_TRACK_MAX_EVENTS: usize = 1_000_000;
/// `code` 与 `key` 各自的字节上限。
pub const KEY_TRACK_MAX_NAME_BYTES: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyTrack {
    /// `baocut-key-track`。
    pub format: String,
    pub version: u32,
    /// 每秒的刻度数。
    pub timescale: u64,
    /// 按键 `[t, code, down, key]`，按 `t` 不减。`code` 是哪一个物理键（W3C UI Events 的 `KeyboardEvent.code`，例如
    /// `KeyA`、`ShiftLeft`、`Enter`）；`down` 1 按下、0 抬起；`key` 是这次按键产生的值（UI Events 的
    /// `KeyboardEvent.key`，例如 `a`、`A`、`Enter`），没有记录时是空字符串。
    #[serde(default)]
    pub keys: Vec<(u64, String, u8, String)>,
}

impl KeyTrack {
    /// 读一份键盘轨并核对（§4.10）。错误是给开发者看的英文短语，由调用方放进自己的消息里。
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() as u64 > KEY_TRACK_MAX_BYTES {
            return Err(format!("larger than {} MiB", KEY_TRACK_MAX_BYTES / (1024 * 1024)));
        }
        let track: KeyTrack = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        if track.format != KEY_TRACK_FORMAT {
            return Err(format!("format must be {KEY_TRACK_FORMAT}"));
        }
        if track.version != KEY_TRACK_VERSION {
            return Err(format!("unsupported version {}", track.version));
        }
        let max = editor_semantics::MAX_SAFE_INTEGER as u64;
        if track.timescale == 0 || track.timescale > max {
            return Err("timescale must be a positive safe integer".into());
        }
        if track.keys.len() > KEY_TRACK_MAX_EVENTS {
            return Err(format!("more than {KEY_TRACK_MAX_EVENTS} events"));
        }
        let mut previous = 0;
        for (t, code, down, key) in &track.keys {
            if *t > max || *t < previous {
                return Err("keys must be sorted by time in safe integer ticks".into());
            }
            previous = *t;
            let named = !code.is_empty() && code.len() <= KEY_TRACK_MAX_NAME_BYTES && code.bytes().all(|b| b.is_ascii_alphanumeric());
            if !named {
                return Err("keys must name a key code of ASCII letters and digits".into());
            }
            if *down > 1 {
                return Err("keys must have down as 0 or 1".into());
            }
            if key.len() > KEY_TRACK_MAX_NAME_BYTES {
                return Err(format!("a key value is longer than {KEY_TRACK_MAX_NAME_BYTES} bytes"));
            }
        }
        Ok(track)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_track_parses_with_and_without_key_values() {
        let text = br#"{"format":"baocut-key-track","version":1,"timescale":1000,
            "keys":[[0,"MetaLeft",1,""],[40,"KeyS",1,"s"],[90,"KeyS",0,"s"],[120,"MetaLeft",0,""]]}"#;
        let track = KeyTrack::parse(text).unwrap();
        assert_eq!(track.keys[1], (40, "KeyS".into(), 1, "s".into()));
        assert_eq!(serde_json::from_slice::<serde_json::Value>(text).unwrap(), serde_json::to_value(&track).unwrap());
    }

    #[test]
    fn bad_tracks_are_refused() {
        let bad = |text: &str| KeyTrack::parse(text.as_bytes()).is_err();
        assert!(bad(r#"{"format":"other","version":1,"timescale":1000}"#));
        assert!(bad(r#"{"format":"baocut-key-track","version":2,"timescale":1000}"#));
        assert!(bad(r#"{"format":"baocut-key-track","version":1,"timescale":0}"#));
        assert!(bad(r#"{"format":"baocut-key-track","version":1,"timescale":1000,"keys":[[10,"KeyA",1,""],[5,"KeyA",0,""]]}"#));
        assert!(bad(r#"{"format":"baocut-key-track","version":1,"timescale":1000,"keys":[[0,"",1,""]]}"#));
        assert!(bad(r#"{"format":"baocut-key-track","version":1,"timescale":1000,"keys":[[0,"Key A",1,""]]}"#));
        assert!(bad(r#"{"format":"baocut-key-track","version":1,"timescale":1000,"keys":[[0,"KeyA",2,""]]}"#));
        assert!(bad(r#"{"format":"baocut-key-track","version":1,"timescale":1000,"keys":[[0,"KeyA",1]]}"#));
    }
}
