//! 麦克风与系统声音：WASAPI 共享模式（「Core Audio APIs」文档的 Capturing a Stream 与 Loopback Recording）。
//!
//! - 设备：`IMMDeviceEnumerator::EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)`；ID 是端点 ID（`IMMDevice::GetId`），
//!   名字是 `PKEY_Device_FriendlyName`；`default` 是 `GetDefaultAudioEndpoint(eCapture, eConsole)`。
//! - 系统声音：默认输出设备（`eRender`）以 `AUDCLNT_STREAMFLAGS_LOOPBACK` 打开，录到的是混音器送给它的声音。
//! - 格式：先请系统转成 48 kHz 立体声 16 位（`AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | SRC_DEFAULT_QUALITY`，Windows 7 起）；
//!   系统不肯时用混音格式，自己换成立体声 16 位（多于两路取前两路，单声道复制成两路）。采样率不是 44.1 / 48 kHz 时
//!   报错（AAC 编码器只收这两种）。
//! - 读：一秒的缓冲，每 10 毫秒轮询（`GetNextPacketSize` / `GetBuffer`）。包的时刻是 `GetBuffer` 给的
//!   `pu64QPCPosition`（QPC 上的 100 纳秒，包里第一帧被采到的时刻）。`AUDCLNT_BUFFERFLAGS_SILENT` 的包当静音写。
//! - 回环在没有声音播放时不送包（Loopback Recording 文档）：超过 100 毫秒没有包就补静音到 50 毫秒前，声音的时长与段
//!   一致。这一行为在不同 Windows 版本上的差别待实机核实（屏幕录制设计 §14）。
//! - 设备拔出：调用返回 `AUDCLNT_E_DEVICE_INVALIDATED`，这一路记为断开。

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_E_DEVICE_INVALIDATED, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, DEVICE_STATE_ACTIVE, IAudioCaptureClient, IAudioClient,
    IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, WAVEFORMATEX, WAVEFORMATEXTENSIBLE, eCapture, eConsole, eRender,
};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance, CoTaskMemFree, STGM_READ};

use crate::platform::windows_portable::convert::{SampleFormat, aac_rate_supported, to_stereo_i16};
use crate::protocol::{Device, DeviceRef, WorkerError};

use super::clock;
use super::com::{self, Mta, error, is_access_denied, take_pwstr};
use super::writer::Track;

const WAVE_FORMAT_PCM: u16 = 1;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
const BUFFER_HNS: i64 = 10_000_000;
const POLL: Duration = Duration::from_millis(10);
const SILENCE_AFTER: Duration = Duration::from_millis(100);
const SILENCE_LAG_NS: u64 = 50_000_000;

fn enumerator() -> windows_core::Result<IMMDeviceEnumerator> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

fn device_id(device: &IMMDevice) -> String {
    unsafe { device.GetId() }.map(take_pwstr).unwrap_or_default()
}

fn device_name(device: &IMMDevice) -> String {
    let Ok(store) = (unsafe { device.OpenPropertyStore(STGM_READ) }) else { return String::new() };
    let Ok(value) = (unsafe { store.GetValue(&PKEY_Device_FriendlyName) }) else { return String::new() };
    unsafe { PropVariantToStringAlloc(&value) }.map(take_pwstr).unwrap_or_default()
}

pub fn list_microphones() -> Vec<Device> {
    let Ok(enumerator) = enumerator() else { return Vec::new() };
    let default = unsafe { enumerator.GetDefaultAudioEndpoint(eCapture, eConsole) }.map(|device| device_id(&device)).ok();
    let Ok(collection) = (unsafe { enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE) }) else { return Vec::new() };
    let count = unsafe { collection.GetCount() }.unwrap_or(0);
    (0..count)
        .filter_map(|index| unsafe { collection.Item(index) }.ok())
        .map(|device| {
            let id = device_id(&device);
            Device { default: Some(default.as_deref() == Some(id.as_str())), name: device_name(&device), id }
        })
        .collect()
}

/// 按 ID 找麦克风；`default` 是系统的默认录音设备。
pub fn find_microphone(id: &str) -> Result<(Mta<IMMDevice>, DeviceRef), WorkerError> {
    let enumerator = enumerator().map_err(|e| error("MICROPHONE_FAILED", "cannot enumerate audio devices", &e))?;
    let device = if id == "default" {
        unsafe { enumerator.GetDefaultAudioEndpoint(eCapture, eConsole) }
    } else {
        unsafe { enumerator.GetDevice(&windows_core::HSTRING::from(id)) }
    }
    .map_err(|_| WorkerError::new("SOURCE_NOT_FOUND", "the microphone is not available"))?;
    let reference = DeviceRef { id: Some(device_id(&device)), name: Some(device_name(&device)).filter(|name| !name.is_empty()) };
    Ok((Mta(device), reference))
}

/// 默认输出设备（回环录系统声音）。
pub fn default_render() -> Result<Mta<IMMDevice>, WorkerError> {
    let enumerator = enumerator().map_err(|e| error("SYSTEM_AUDIO_FAILED", "cannot enumerate audio devices", &e))?;
    unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }
        .map(Mta)
        .map_err(|e| error("SYSTEM_AUDIO_FAILED", "there is no default output device", &e))
}

/// 客户端用的格式：采样率、声道数与样本格式。
#[derive(Clone, Copy)]
struct Format {
    rate: u32,
    channels: usize,
    sample: SampleFormat,
}

fn stereo_48k() -> WAVEFORMATEX {
    WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM,
        nChannels: 2,
        nSamplesPerSec: 48_000,
        nAvgBytesPerSec: 48_000 * 4,
        nBlockAlign: 4,
        wBitsPerSample: 16,
        cbSize: 0,
    }
}

/// 混音格式读出来（`WAVEFORMATEX` 是一字节对齐的，按未对齐读）。
unsafe fn parse_format(pointer: *const WAVEFORMATEX) -> Option<Format> {
    let format = unsafe { std::ptr::read_unaligned(pointer) };
    let float = match format.wFormatTag {
        WAVE_FORMAT_PCM => false,
        WAVE_FORMAT_IEEE_FLOAT => true,
        WAVE_FORMAT_EXTENSIBLE if format.cbSize >= 22 => {
            let extensible = unsafe { std::ptr::read_unaligned(pointer as *const WAVEFORMATEXTENSIBLE) };
            // KSDATAFORMAT_SUBTYPE_PCM / _IEEE_FLOAT 的第一段是 1 / 3，其余部分相同。
            match extensible.SubFormat.data1 {
                1 => false,
                3 => true,
                _ => return None,
            }
        }
        _ => return None,
    };
    let sample = SampleFormat::from_wave(float, format.wBitsPerSample)?;
    Some(Format { rate: format.nSamplesPerSec, channels: usize::from(format.nChannels.max(1)), sample })
}

fn activate(device: &IMMDevice) -> windows_core::Result<IAudioClient> {
    unsafe { device.Activate(CLSCTX_ALL, None) }
}

/// 打开客户端：先要 48 kHz 立体声 16 位，不行再用混音格式。
fn open_client(device: &IMMDevice, loopback: bool) -> windows_core::Result<(IAudioClient, Format)> {
    let base = if loopback { AUDCLNT_STREAMFLAGS_LOOPBACK } else { 0 };
    let client = activate(device)?;
    let wanted = stereo_48k();
    let converted = unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            base | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            BUFFER_HNS,
            0,
            &wanted,
            None,
        )
    };
    match converted {
        Ok(()) => return Ok((client, Format { rate: 48_000, channels: 2, sample: SampleFormat::I16 })),
        Err(e) if is_access_denied(&e) => return Err(e),
        Err(_) => {}
    }
    // `Initialize` 失败后这个客户端不能再用：重新激活一个。
    let client = activate(device)?;
    let mix = unsafe { client.GetMixFormat() }?;
    let format = unsafe { parse_format(mix) };
    let result = unsafe { client.Initialize(AUDCLNT_SHAREMODE_SHARED, base, BUFFER_HNS, 0, mix, None) };
    unsafe { CoTaskMemFree(Some(mix as *const _)) };
    result?;
    let format = format.ok_or_else(|| windows_core::Error::from(windows::Win32::Foundation::E_NOTIMPL))?;
    Ok((client, format))
}

pub struct AudioCapture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl AudioCapture {
    pub fn start(device: &Mta<IMMDevice>, loopback: bool, track: Arc<Track>) -> Result<Self, WorkerError> {
        let code = if loopback { "SYSTEM_AUDIO_FAILED" } else { "MICROPHONE_FAILED" };
        let (client, format) = open_client(&device.0, loopback).map_err(|e| {
            if is_access_denied(&e) && !loopback {
                error("MICROPHONE_PERMISSION_DENIED", "microphone access is turned off in Windows privacy settings", &e)
            } else {
                error(code, "cannot open the audio device", &e)
            }
        })?;
        if !aac_rate_supported(format.rate) {
            return Err(WorkerError::new(code, format!("the device runs at {} Hz; only 44100 and 48000 Hz can be recorded", format.rate)));
        }
        let capture: IAudioCaptureClient =
            unsafe { client.GetService() }.map_err(|e| error(code, "cannot get the capture client", &e))?;
        unsafe { client.Start() }.map_err(|e| error(code, "cannot start the audio device", &e))?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let client = Mta(client);
        let capture = Mta(capture);
        let thread = std::thread::Builder::new()
            .name(if loopback { "system-audio" } else { "microphone" }.to_owned())
            .spawn(move || {
                com::init_thread();
                let (client, capture) = (client, capture);
                run(&capture.0, format, loopback, &track, &flag);
                let _ = unsafe { client.0.Stop() };
            })
            .map_err(|e| WorkerError::new(code, format!("cannot start the audio thread: {e}")))?;
        Ok(Self { stop, thread: Some(thread) })
    }

    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run(capture: &IAudioCaptureClient, format: Format, loopback: bool, track: &Track, stop: &AtomicBool) {
    let frame_bytes = format.sample.bytes() * format.channels;
    let mut samples: Vec<i16> = Vec::new();
    let mut last_packet = Instant::now();
    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(POLL);
        let mut got = false;
        loop {
            let size = match unsafe { capture.GetNextPacketSize() } {
                Ok(size) => size,
                Err(e) => return lost(track, &e),
            };
            if size == 0 {
                break;
            }
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            let mut qpc = 0u64;
            if let Err(e) = unsafe { capture.GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc)) } {
                return lost(track, &e);
            }
            let bytes = frames as usize * frame_bytes;
            samples.clear();
            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                samples.resize(frames as usize * 2, 0);
            } else {
                let raw = unsafe { std::slice::from_raw_parts(data, bytes) };
                to_stereo_i16(raw, format.sample, format.channels, &mut samples);
            }
            if let Err(e) = unsafe { capture.ReleaseBuffer(frames) } {
                return lost(track, &e);
            }
            if frames > 0 {
                track.push_audio(clock::from_hns(qpc as i64), format.rate, &samples);
                got = true;
            }
        }
        if got {
            last_packet = Instant::now();
        } else if loopback && last_packet.elapsed() >= SILENCE_AFTER {
            track.fill_audio(crate::protocol::Ns(clock::now().0.saturating_sub(SILENCE_LAG_NS)));
        }
    }
}

fn lost(track: &Track, e: &windows_core::Error) {
    if e.code() == AUDCLNT_E_DEVICE_INVALIDATED {
        track.lose(clock::now());
    } else {
        track.fail(format!("audio capture failed: {} (HRESULT {:#010x})", e.message(), e.code().0 as u32));
    }
}
