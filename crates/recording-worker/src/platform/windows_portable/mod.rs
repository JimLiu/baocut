//! Windows 采集里与系统接口无关的部分：键码表、时刻换算、像素格式转换、几何与 PNG 编码。它们只是数据与算术，
//! 在 Windows 上由 [`super::windows`] 调用，测试在任何平台上都跑（`cfg(any(windows, test))`），不用 Windows 实机。

#![cfg_attr(not(windows), allow(dead_code))]

pub mod convert;
pub mod geometry;
pub mod keys;
pub mod png;
pub mod timing;
