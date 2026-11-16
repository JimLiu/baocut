//! Windows 的键码换成键盘轨的词（格式规范 §4.10），与 macOS 的那份（`platform/macos/keys.rs`）并列。
//!
//! - `code`（物理键，与布局无关）：按扫描码认。低级键盘钩子的 `KBDLLHOOKSTRUCT` 给扫描码与「扩展键」标志
//!   （`LLKHF_EXTENDED`，即扫描码前面的 0xE0）。对照表是 W3C UI Events KeyboardEvent code 规范里 Windows 一栏
//!   （「Code Values for Windows」，扫描码第 1 套）。认不出的写 `Unidentified`。
//! - `key` 里有名字的键（不产生字符的键）与「是不是功能键」：按虚拟键码（`VK_*`，WinUser.h）认，名字取 UI Events
//!   KeyboardEvent key 规范的词。字符键（字母、数字、标点、空格）的名字是 None，`all` 时由系统按当前布局翻成字。

/// 扫描码（加上是不是扩展键）→ `KeyboardEvent.code`。
pub fn code_for_scan(scan: u32, extended: bool) -> &'static str {
    if extended {
        return match scan {
            0x10 => "MediaTrackPrevious",
            0x19 => "MediaTrackNext",
            0x1C => "NumpadEnter",
            0x1D => "ControlRight",
            0x20 => "AudioVolumeMute",
            0x21 => "LaunchApp2",
            0x22 => "MediaPlayPause",
            0x24 => "MediaStop",
            0x2E => "AudioVolumeDown",
            0x30 => "AudioVolumeUp",
            0x32 => "BrowserHome",
            0x35 => "NumpadDivide",
            0x37 => "PrintScreen",
            0x38 => "AltRight",
            0x45 => "NumLock",
            0x46 => "Pause",
            0x47 => "Home",
            0x48 => "ArrowUp",
            0x49 => "PageUp",
            0x4B => "ArrowLeft",
            0x4D => "ArrowRight",
            0x4F => "End",
            0x50 => "ArrowDown",
            0x51 => "PageDown",
            0x52 => "Insert",
            0x53 => "Delete",
            0x5B => "MetaLeft",
            0x5C => "MetaRight",
            0x5D => "ContextMenu",
            0x5E => "Power",
            0x5F => "Sleep",
            0x63 => "WakeUp",
            0x65 => "BrowserSearch",
            0x66 => "BrowserFavorites",
            0x67 => "BrowserRefresh",
            0x68 => "BrowserStop",
            0x69 => "BrowserForward",
            0x6A => "BrowserBack",
            0x6B => "LaunchApp1",
            0x6C => "LaunchMail",
            0x6D => "MediaSelect",
            _ => "Unidentified",
        };
    }
    match scan {
        0x01 => "Escape",
        0x02 => "Digit1",
        0x03 => "Digit2",
        0x04 => "Digit3",
        0x05 => "Digit4",
        0x06 => "Digit5",
        0x07 => "Digit6",
        0x08 => "Digit7",
        0x09 => "Digit8",
        0x0A => "Digit9",
        0x0B => "Digit0",
        0x0C => "Minus",
        0x0D => "Equal",
        0x0E => "Backspace",
        0x0F => "Tab",
        0x10 => "KeyQ",
        0x11 => "KeyW",
        0x12 => "KeyE",
        0x13 => "KeyR",
        0x14 => "KeyT",
        0x15 => "KeyY",
        0x16 => "KeyU",
        0x17 => "KeyI",
        0x18 => "KeyO",
        0x19 => "KeyP",
        0x1A => "BracketLeft",
        0x1B => "BracketRight",
        0x1C => "Enter",
        0x1D => "ControlLeft",
        0x1E => "KeyA",
        0x1F => "KeyS",
        0x20 => "KeyD",
        0x21 => "KeyF",
        0x22 => "KeyG",
        0x23 => "KeyH",
        0x24 => "KeyJ",
        0x25 => "KeyK",
        0x26 => "KeyL",
        0x27 => "Semicolon",
        0x28 => "Quote",
        0x29 => "Backquote",
        0x2A => "ShiftLeft",
        0x2B => "Backslash",
        0x2C => "KeyZ",
        0x2D => "KeyX",
        0x2E => "KeyC",
        0x2F => "KeyV",
        0x30 => "KeyB",
        0x31 => "KeyN",
        0x32 => "KeyM",
        0x33 => "Comma",
        0x34 => "Period",
        0x35 => "Slash",
        0x36 => "ShiftRight",
        0x37 => "NumpadMultiply",
        0x38 => "AltLeft",
        0x39 => "Space",
        0x3A => "CapsLock",
        0x3B => "F1",
        0x3C => "F2",
        0x3D => "F3",
        0x3E => "F4",
        0x3F => "F5",
        0x40 => "F6",
        0x41 => "F7",
        0x42 => "F8",
        0x43 => "F9",
        0x44 => "F10",
        // 不带 0xE0 的 0x45 是 Pause（它的真扫描码是 E1 1D 45，钩子报成 0x45），NumLock 是 0xE045。
        0x45 => "Pause",
        0x46 => "ScrollLock",
        0x47 => "Numpad7",
        0x48 => "Numpad8",
        0x49 => "Numpad9",
        0x4A => "NumpadSubtract",
        0x4B => "Numpad4",
        0x4C => "Numpad5",
        0x4D => "Numpad6",
        0x4E => "NumpadAdd",
        0x4F => "Numpad1",
        0x50 => "Numpad2",
        0x51 => "Numpad3",
        0x52 => "Numpad0",
        0x53 => "NumpadDecimal",
        0x54 => "PrintScreen",
        0x56 => "IntlBackslash",
        0x57 => "F11",
        0x58 => "F12",
        0x59 => "NumpadEqual",
        0x64 => "F13",
        0x65 => "F14",
        0x66 => "F15",
        0x67 => "F16",
        0x68 => "F17",
        0x69 => "F18",
        0x6A => "F19",
        0x6B => "F20",
        0x6C => "F21",
        0x6D => "F22",
        0x6E => "F23",
        0x70 => "KanaMode",
        0x71 => "Lang2",
        0x72 => "Lang1",
        0x73 => "IntlRo",
        0x76 => "F24",
        0x79 => "Convert",
        0x7B => "NonConvert",
        0x7D => "IntlYen",
        0x7E => "NumpadComma",
        _ => "Unidentified",
    }
}

/// 虚拟键码 → 有名字的键的 `KeyboardEvent.key`；字符键是 None。
pub fn named_key(vk: u32) -> Option<&'static str> {
    Some(match vk {
        0x03 => "Cancel",
        0x08 => "Backspace",
        0x09 => "Tab",
        0x0C => "Clear",
        0x0D => "Enter",
        0x10 | 0xA0 | 0xA1 => "Shift",
        0x11 | 0xA2 | 0xA3 => "Control",
        0x12 | 0xA4 | 0xA5 => "Alt",
        0x13 => "Pause",
        0x14 => "CapsLock",
        0x15 => "KanaMode",
        0x17 => "JunjaMode",
        0x18 => "FinalMode",
        0x19 => "KanjiMode",
        0x1B => "Escape",
        0x1C => "Convert",
        0x1D => "NonConvert",
        0x1E => "Accept",
        0x1F => "ModeChange",
        0x21 => "PageUp",
        0x22 => "PageDown",
        0x23 => "End",
        0x24 => "Home",
        0x25 => "ArrowLeft",
        0x26 => "ArrowUp",
        0x27 => "ArrowRight",
        0x28 => "ArrowDown",
        0x29 => "Select",
        0x2A => "Print",
        0x2B => "Execute",
        0x2C => "PrintScreen",
        0x2D => "Insert",
        0x2E => "Delete",
        0x2F => "Help",
        0x5B | 0x5C => "Meta",
        0x5D => "ContextMenu",
        0x5F => "Standby",
        0x70 => "F1",
        0x71 => "F2",
        0x72 => "F3",
        0x73 => "F4",
        0x74 => "F5",
        0x75 => "F6",
        0x76 => "F7",
        0x77 => "F8",
        0x78 => "F9",
        0x79 => "F10",
        0x7A => "F11",
        0x7B => "F12",
        0x7C => "F13",
        0x7D => "F14",
        0x7E => "F15",
        0x7F => "F16",
        0x80 => "F17",
        0x81 => "F18",
        0x82 => "F19",
        0x83 => "F20",
        0x84 => "F21",
        0x85 => "F22",
        0x86 => "F23",
        0x87 => "F24",
        0x90 => "NumLock",
        0x91 => "ScrollLock",
        0xA6 => "BrowserBack",
        0xA7 => "BrowserForward",
        0xA8 => "BrowserRefresh",
        0xA9 => "BrowserStop",
        0xAA => "BrowserSearch",
        0xAB => "BrowserFavorites",
        0xAC => "BrowserHome",
        0xAD => "AudioVolumeMute",
        0xAE => "AudioVolumeDown",
        0xAF => "AudioVolumeUp",
        0xB0 => "MediaTrackNext",
        0xB1 => "MediaTrackPrevious",
        0xB2 => "MediaStop",
        0xB3 => "MediaPlayPause",
        0xB4 => "LaunchMail",
        0xB5 => "LaunchMediaPlayer",
        0xB6 => "LaunchApplication1",
        0xB7 => "LaunchApplication2",
        0xE5 => "Process",
        0xF6 => "Attn",
        0xF7 => "CrSel",
        0xF8 => "ExSel",
        0xF9 => "EraseEof",
        0xFA => "Play",
        0xFB => "ZoomToggle",
        0xFE => "Clear",
        _ => return None,
    })
}

/// 组合键的修饰键：Control、Alt 与 Windows 键（UI Events 的 `Meta`）。Shift 不算（格式规范 §4.10 的 `shortcuts`）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Chord {
    pub control: bool,
    pub alt: bool,
    pub meta: bool,
}

impl Chord {
    pub fn any(self) -> bool {
        self.control || self.alt || self.meta
    }
}

/// `shortcuts` 时这次按下记不记：有名字的键（功能键、修饰键自己……）或按着 Control、Alt、Windows 键时的任何键。
pub fn is_shortcut(vk: u32, chord: Chord) -> bool {
    named_key(vk).is_some() || chord.any()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_ui_events_word(code: &str) -> bool {
        !code.is_empty() && code.len() <= 64 && code.chars().all(|c| c.is_ascii_alphanumeric())
    }

    #[test]
    fn every_scan_code_maps_to_a_ui_events_word() {
        for scan in 0..=0xFFu32 {
            for extended in [false, true] {
                let code = code_for_scan(scan, extended);
                assert!(is_ui_events_word(code), "scan {scan:#x} extended {extended} maps to {code}");
            }
        }
    }

    #[test]
    fn known_scan_codes() {
        assert_eq!(code_for_scan(0x1E, false), "KeyA");
        assert_eq!(code_for_scan(0x02, false), "Digit1");
        assert_eq!(code_for_scan(0x1C, false), "Enter");
        assert_eq!(code_for_scan(0x1C, true), "NumpadEnter");
        assert_eq!(code_for_scan(0x1D, false), "ControlLeft");
        assert_eq!(code_for_scan(0x1D, true), "ControlRight");
        assert_eq!(code_for_scan(0x38, true), "AltRight");
        assert_eq!(code_for_scan(0x36, false), "ShiftRight");
        assert_eq!(code_for_scan(0x5B, true), "MetaLeft");
        // 主键区的方向键带 0xE0；小键盘上的同一个扫描码不带，是小键盘的键。
        assert_eq!(code_for_scan(0x48, true), "ArrowUp");
        assert_eq!(code_for_scan(0x48, false), "Numpad8");
        assert_eq!(code_for_scan(0x45, true), "NumLock");
        assert_eq!(code_for_scan(0x45, false), "Pause");
        assert_eq!(code_for_scan(0x3F, false), "F5");
        assert_eq!(code_for_scan(0x55, false), "Unidentified");
        assert_eq!(code_for_scan(0x00, true), "Unidentified");
    }

    #[test]
    fn named_keys_and_shortcuts() {
        assert_eq!(named_key(0x0D), Some("Enter"));
        assert_eq!(named_key(0xA0), Some("Shift"));
        assert_eq!(named_key(0x5B), Some("Meta"));
        assert_eq!(named_key(0x74), Some("F5"));
        assert_eq!(named_key(0x41), None, "the A key is a character key");
        assert_eq!(named_key(0x20), None, "Space types a character");
        for vk in 0..=0xFFu32 {
            if let Some(name) = named_key(vk) {
                assert!(is_ui_events_word(name), "vk {vk:#x} is named {name}");
            }
        }
        // `shortcuts`：字符键只在按着 Control、Alt 或 Windows 键时记；Shift 不算。
        assert!(!is_shortcut(0x41, Chord::default()));
        assert!(is_shortcut(0x41, Chord { control: true, ..Chord::default() }));
        assert!(is_shortcut(0x41, Chord { meta: true, ..Chord::default() }));
        assert!(is_shortcut(0x0D, Chord::default()));
        assert!(is_shortcut(0xA0, Chord::default()));
    }
}
