//! 指针轨（视频格式规范 §4.8）：一次录制里鼠标的位置、按键与光标外观。它是录下来的事实，存成素材（`kind: 'other'`，
//! 媒体类型 [`POINTER_TRACK_MEDIA_TYPE`]），由录制清单的 `pointer` 流引用；怎样画光标、怎样跟随取景在屏幕取景文档里。
//!
//! 时刻是素材自己的时钟（0 是素材开头）上的非负整数刻度；落到录制时间按清单里这路流的 `start`。

use serde::{Deserialize, Serialize};

pub const POINTER_TRACK_FORMAT: &str = "baocut-pointer-track";
pub const POINTER_TRACK_VERSION: u32 = 1;
pub const POINTER_TRACK_MEDIA_TYPE: &str = "application/x-baocut-pointer-track+json";
/// 一份指针轨的字节上限。
pub const POINTER_TRACK_MAX_BYTES: u64 = 64 * 1024 * 1024;
/// 三种事件合计的上限。
pub const POINTER_TRACK_MAX_EVENTS: usize = 4_000_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerTrack {
    /// `baocut-pointer-track`。
    pub format: String,
    pub version: u32,
    /// 每秒的刻度数。
    pub timescale: u64,
    /// 位置样本 `[t, x, y]`，按 `t` 不减。`x`、`y` 是捕获画面（已摆正）的归一化坐标，左上为原点；指针在捕获画面之外时
    /// 越出 [0, 1]，照实记录，不夹到边上。
    #[serde(default)]
    pub moves: Vec<(u64, f64, f64)>,
    /// 按键 `[t, button, down]`，按 `t` 不减：`button` 0 是主键、1 是辅键、2 是中键，其余照系统的编号；`down` 1 按下、0 抬起。
    /// 按键没有自己的坐标，位置取这一刻的指针位置。
    #[serde(default)]
    pub buttons: Vec<(u64, u8, u8)>,
    /// 光标外观的切换 `[t, cursorId]`，按 `t` 不减：从这一刻起用清单 `pointer.cursors` 里的哪一个。
    #[serde(default)]
    pub cursors: Vec<(u64, String)>,
}

impl PointerTrack {
    /// 读一份指针轨并核对（§4.8）。错误是给开发者看的英文短语，由调用方放进自己的消息里。
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() as u64 > POINTER_TRACK_MAX_BYTES {
            return Err(format!("larger than {} MiB", POINTER_TRACK_MAX_BYTES / (1024 * 1024)));
        }
        let track: PointerTrack = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        if track.format != POINTER_TRACK_FORMAT {
            return Err(format!("format must be {POINTER_TRACK_FORMAT}"));
        }
        if track.version != POINTER_TRACK_VERSION {
            return Err(format!("unsupported version {}", track.version));
        }
        let max = editor_semantics::MAX_SAFE_INTEGER as u64;
        if track.timescale == 0 || track.timescale > max {
            return Err("timescale must be a positive safe integer".into());
        }
        if track.moves.len() + track.buttons.len() + track.cursors.len() > POINTER_TRACK_MAX_EVENTS {
            return Err(format!("more than {POINTER_TRACK_MAX_EVENTS} events"));
        }
        let ordered = |name: &str, times: &mut dyn Iterator<Item = u64>| -> Result<(), String> {
            let mut previous = 0;
            for t in times {
                if t > max || t < previous {
                    return Err(format!("{name} must be sorted by time in safe integer ticks"));
                }
                previous = t;
            }
            Ok(())
        };
        ordered("moves", &mut track.moves.iter().map(|m| m.0))?;
        ordered("buttons", &mut track.buttons.iter().map(|b| b.0))?;
        ordered("cursors", &mut track.cursors.iter().map(|c| c.0))?;
        if track.moves.iter().any(|m| !m.1.is_finite() || !m.2.is_finite()) {
            return Err("moves must have finite x and y".into());
        }
        if track.buttons.iter().any(|b| b.2 > 1) {
            return Err("buttons must have down as 0 or 1".into());
        }
        if track.cursors.iter().any(|c| c.1.is_empty()) {
            return Err("cursors must name a cursor id".into());
        }
        Ok(track)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_track_parses_and_keeps_positions_outside_the_frame() {
        let text = br#"{"format":"baocut-pointer-track","version":1,"timescale":1000,
            "moves":[[0,0.5,0.5],[16,0.52,0.5],[33,-0.1,1.2]],"buttons":[[20,0,1],[90,0,0]],"cursors":[[0,"c0"]]}"#;
        let track = PointerTrack::parse(text).unwrap();
        assert_eq!(track.moves[2], (33, -0.1, 1.2));
        assert_eq!(track.buttons, [(20, 0, 1), (90, 0, 0)]);
        assert_eq!(serde_json::from_slice::<serde_json::Value>(text).unwrap(), serde_json::to_value(&track).unwrap());
    }

    #[test]
    fn bad_tracks_are_refused() {
        let bad = |text: &str| PointerTrack::parse(text.as_bytes()).is_err();
        assert!(bad(r#"{"format":"other","version":1,"timescale":1000}"#));
        assert!(bad(r#"{"format":"baocut-pointer-track","version":2,"timescale":1000}"#));
        assert!(bad(r#"{"format":"baocut-pointer-track","version":1,"timescale":0}"#));
        assert!(bad(r#"{"format":"baocut-pointer-track","version":1,"timescale":1000,"moves":[[10,0,0],[5,0,0]]}"#));
        assert!(bad(r#"{"format":"baocut-pointer-track","version":1,"timescale":1000,"buttons":[[0,0,2]]}"#));
        assert!(bad(r#"{"format":"baocut-pointer-track","version":1,"timescale":1000,"cursors":[[0,""]]}"#));
    }
}
