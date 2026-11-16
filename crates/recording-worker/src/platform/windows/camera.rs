//! 摄像头：Media Foundation 的视频采集设备（「Audio/Video Capture in Media Foundation」文档）。
//!
//! - 设备：`MFEnumDeviceSources`（`MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID`）；ID 是符号链接
//!   （`MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK`，同一台设备在这台机器上不变），名字是 `FRIENDLY_NAME`。
//! - 读：设备当前（缺省）的格式，Source Reader 开 `MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING` 转成 NV12（Windows 8
//!   起；MJPG、YUY2 的摄像头都能转）。同步模式的 `ReadSample` 在自己的线程上一帧一帧读。宽或高是奇数时去掉最后一列或一行。
//! - 时刻：采集设备的样本时刻在 `MFGetSystemTime` 的时钟上（文档没有写明与 QPC 的关系）。第一帧时把两个时钟各读一次：
//!   样本时刻离 `MFGetSystemTime` 不到一秒就按两者的差把它换到 QPC 上；否则当它从别的起点算，按第一帧此刻到达换算。
//!   这条推断要实机核实（屏幕录制设计 §14）。
//! - 权限被拒：激活或读第一帧时返回 `E_ACCESSDENIED`，报 `CAMERA_PERMISSION_DENIED`。
//! - 拔出：`ReadSample` 失败或带 `MF_SOURCE_READERF_ERROR`，这一路记为断开。

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

use windows::Win32::Media::MediaFoundation::{
    IMFActivate, IMFAttributes, IMFMediaSource, IMFSample, IMFSourceReader, MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
    MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
    MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, MF_MT_DEFAULT_STRIDE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE,
    MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, MF_SOURCE_READER_FIRST_VIDEO_STREAM,
    MF_SOURCE_READERF_ENDOFSTREAM, MF_SOURCE_READERF_ERROR, MFCreateAttributes, MFCreateMediaType,
    MFCreateSourceReaderFromMediaSource, MFEnumDeviceSources, MFGetSystemTime, MFMediaType_Video, MFVideoFormat_NV12,
};
use windows::Win32::System::Com::CoTaskMemFree;
use windows_core::PWSTR;

use crate::platform::windows_portable::timing::hns_to_ns;
use crate::protocol::{Device, DeviceRef, Ns, WorkerError};

use super::clock;
use super::com::{self, Mta, error, is_access_denied, take_pwstr};
use super::writer::{Frame, Track};

const STREAM: u32 = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
/// 样本时刻与 `MFGetSystemTime` 相差在这之内就当它在系统时钟上。
const SYSTEM_CLOCK_WINDOW_NS: i128 = 1_000_000_000;

fn attributes(count: u32) -> windows_core::Result<IMFAttributes> {
    let mut attributes: Option<IMFAttributes> = None;
    unsafe { MFCreateAttributes(&mut attributes, count) }?;
    attributes.ok_or_else(|| windows_core::Error::from(windows::Win32::Foundation::E_POINTER))
}

fn string(activate: &IMFActivate, key: &windows_core::GUID) -> String {
    let mut value = PWSTR::null();
    let mut length = 0u32;
    match unsafe { activate.GetAllocatedString(key, &mut value, &mut length) } {
        Ok(()) => take_pwstr(value),
        Err(_) => String::new(),
    }
}

fn devices() -> Vec<Mta<IMFActivate>> {
    let Ok(filter) = attributes(1) else { return Vec::new() };
    if unsafe { filter.SetGUID(&MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID) }.is_err() {
        return Vec::new();
    }
    let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    if unsafe { MFEnumDeviceSources(&filter, &mut list, &mut count) }.is_err() || list.is_null() {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(count as usize);
    for index in 0..count as usize {
        // 数组里的每一项都要释放：读出来（取得所有权），用完随 `Mta` 一起放掉。
        if let Some(activate) = unsafe { std::ptr::read(list.add(index)) } {
            out.push(Mta(activate));
        }
    }
    unsafe { CoTaskMemFree(Some(list as *const _)) };
    out
}

pub fn list() -> Vec<Device> {
    devices()
        .into_iter()
        .map(|activate| Device {
            id: string(&activate.0, &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK),
            name: string(&activate.0, &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME),
            default: None,
        })
        .collect()
}

pub fn find(id: &str) -> Result<(Mta<IMFActivate>, DeviceRef), WorkerError> {
    let all = devices();
    // `default` 或空：第一台摄像头（Windows 没有「默认摄像头」的设置）。
    let found = if id == "default" || id.is_empty() {
        all.into_iter().next()
    } else {
        all.into_iter().find(|activate| string(&activate.0, &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK) == id)
    };
    let activate = found.ok_or_else(|| WorkerError::new("SOURCE_NOT_FOUND", "the camera is not available"))?;
    let reference = DeviceRef {
        id: Some(string(&activate.0, &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK)),
        name: Some(string(&activate.0, &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME)).filter(|name| !name.is_empty()),
    };
    Ok((activate, reference))
}

/// 读出来的 NV12 的布局。
#[derive(Clone, Copy)]
struct Layout {
    width: u32,
    height: u32,
    stride: usize,
}

fn camera_error(what: &str, e: &windows_core::Error) -> WorkerError {
    if is_access_denied(e) {
        error("CAMERA_PERMISSION_DENIED", "camera access is turned off in Windows privacy settings", e)
    } else {
        error("CAMERA_FAILED", what, e)
    }
}

fn open_reader(activate: &IMFActivate) -> windows_core::Result<(IMFMediaSource, IMFSourceReader, Layout, u32)> {
    let source: IMFMediaSource = unsafe { activate.ActivateObject() }?;
    let settings = attributes(1)?;
    unsafe { settings.SetUINT32(&MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, 1) }?;
    let reader = unsafe { MFCreateSourceReaderFromMediaSource(&source, &settings) }?;
    let wanted = unsafe { MFCreateMediaType() }?;
    unsafe {
        wanted.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        wanted.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
        reader.SetCurrentMediaType(STREAM, None, &wanted)?;
    }
    let current = unsafe { reader.GetCurrentMediaType(STREAM) }?;
    let size = unsafe { current.GetUINT64(&MF_MT_FRAME_SIZE) }?;
    let (width, height) = ((size >> 32) as u32, size as u32);
    let stride = unsafe { current.GetUINT32(&MF_MT_DEFAULT_STRIDE) }.map_or(width as usize, |stride| (stride as i32).unsigned_abs() as usize);
    let fps = unsafe { current.GetUINT64(&MF_MT_FRAME_RATE) }
        .ok()
        .and_then(|rate| {
            let (numerator, denominator) = ((rate >> 32) as u32, rate as u32);
            (denominator > 0).then(|| (f64::from(numerator) / f64::from(denominator)).round() as u32)
        })
        .filter(|fps| *fps > 0)
        .unwrap_or(30);
    Ok((source, reader, Layout { width, height, stride: stride.max(width as usize) }, fps))
}

pub struct CameraCapture {
    stop: Arc<AtomicBool>,
    source: Mta<IMFMediaSource>,
    thread: Option<JoinHandle<()>>,
}

impl CameraCapture {
    pub fn start(activate: &Mta<IMFActivate>, track: Arc<Track>) -> Result<Self, WorkerError> {
        let (source, reader, layout, fps) = open_reader(&activate.0).map_err(|e| camera_error("cannot open the camera", &e))?;
        if layout.width < 2 || layout.height < 2 {
            return Err(WorkerError::new("CAMERA_FAILED", "the camera reported an empty picture"));
        }
        track.set_fps(fps);
        // 先同步读一帧：权限被拒在这里报出来，而不是在开始之后。
        let mut flags = 0u32;
        let mut first: Option<IMFSample> = None;
        unsafe { reader.ReadSample(STREAM, 0, None, Some(&mut flags), None, Some(&mut first)) }
            .map_err(|e| camera_error("cannot read from the camera", &e))?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let reader = Mta(reader);
        let thread = std::thread::Builder::new()
            .name("camera".to_owned())
            .spawn(move || {
                com::init_thread();
                let reader = reader;
                run(&reader.0, layout, &track, &flag);
            })
            .map_err(|e| WorkerError::new("CAMERA_FAILED", format!("cannot start the camera thread: {e}")))?;
        Ok(Self { stop, source: Mta(source), thread: Some(thread) })
    }

    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // 让阻塞的 `ReadSample` 返回（返回 `MF_E_SHUTDOWN`）。
        let _ = unsafe { self.source.0.Shutdown() };
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run(reader: &IMFSourceReader, layout: Layout, track: &Track, stop: &AtomicBool) {
    // 样本时刻（100 纳秒）加上它换到 QPC 纳秒。
    let mut offset: Option<i128> = None;
    let (width, height) = (layout.width / 2 * 2, layout.height / 2 * 2);
    while !stop.load(Ordering::SeqCst) {
        let mut flags = 0u32;
        let mut timestamp = 0i64;
        let mut sample: Option<IMFSample> = None;
        let result = unsafe { reader.ReadSample(STREAM, 0, None, Some(&mut flags), Some(&mut timestamp), Some(&mut sample)) };
        if stop.load(Ordering::SeqCst) {
            return;
        }
        if result.is_err() || flags & (MF_SOURCE_READERF_ERROR.0 as u32 | MF_SOURCE_READERF_ENDOFSTREAM.0 as u32) != 0 {
            track.lose(clock::now());
            return;
        }
        let Some(sample) = sample else { continue };
        let offset = *offset.get_or_insert_with(|| {
            let host = i128::from(clock::now().0);
            let system = i128::from(hns_to_ns(unsafe { MFGetSystemTime() }));
            let stamp = i128::from(hns_to_ns(timestamp));
            if (system - stamp).abs() < SYSTEM_CLOCK_WINDOW_NS { host - system } else { host - stamp }
        });
        let at = (i128::from(hns_to_ns(timestamp)) + offset).max(0) as u64;
        if let Some(data) = read_nv12(&sample, layout, width, height) {
            track.push_video(Ns(at), Frame { width, height, data: Arc::new(data) });
        }
    }
}

/// 样本里的 NV12 拷成紧凑的（行宽 = 宽）一帧，宽高取偶。
fn read_nv12(sample: &IMFSample, layout: Layout, width: u32, height: u32) -> Option<Vec<u8>> {
    let buffer = unsafe { sample.ConvertToContiguousBuffer() }.ok()?;
    let mut pointer: *mut u8 = std::ptr::null_mut();
    let mut length = 0u32;
    unsafe { buffer.Lock(&mut pointer, None, Some(&mut length)) }.ok()?;
    let needed = layout.stride * layout.height as usize * 3 / 2;
    let result = if (length as usize) < needed || pointer.is_null() {
        None
    } else {
        let source = unsafe { std::slice::from_raw_parts(pointer, length as usize) };
        let (w, h) = (width as usize, height as usize);
        let mut out = Vec::with_capacity(w * h * 3 / 2);
        for y in 0..h {
            out.extend_from_slice(&source[y * layout.stride..y * layout.stride + w]);
        }
        let chroma = layout.stride * layout.height as usize;
        for y in 0..h / 2 {
            out.extend_from_slice(&source[chroma + y * layout.stride..chroma + y * layout.stride + w]);
        }
        Some(out)
    };
    let _ = unsafe { buffer.Unlock() };
    result
}
