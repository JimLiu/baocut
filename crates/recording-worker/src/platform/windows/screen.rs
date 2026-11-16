//! 屏幕、窗口与区域的画面：Windows.Graphics.Capture（「Screen capture」文档，Windows 10 1803 起；桌面程序用
//! `IGraphicsCaptureItemInterop::CreateForMonitor` / `CreateForWindow` 建捕获项，Windows 10 1903 起）。
//!
//! - 设备：D3D11 硬件设备（`D3D11_CREATE_DEVICE_BGRA_SUPPORT`，开多线程保护），经 `CreateDirect3D11DeviceFromDXGIDevice`
//!   交给 WinRT。帧池用 `Direct3D11CaptureFramePool::CreateFreeThreaded`（`FrameArrived` 在系统的工作线程上触发，不要
//!   消息循环），BGRA 8 位，两个缓冲。
//! - 每一帧：纹理拷进一张 CPU 可读的暂存纹理（区域录制只拷裁出来的部分，`CopySubresourceRegion`），`Map` 出来换成 NV12
//!   （BT.709、16–235），交给 [`Track`]。帧的时刻是 `Direct3D11CaptureFrame.SystemRelativeTime`（QPC 上的 100 纳秒）。
//!   比请求的帧率来得密时丢掉多出来的帧；Windows 11 24H2 起另设 `MinUpdateInterval` 让系统少送。
//! - 编码尺寸在开始时定下（宽高取偶）：窗口改了大小时帧池按新的大小 `Recreate`，画面左上对齐拷进原来的尺寸，余下是黑。
//! - 光标：`IsCursorCaptureEnabled`（Windows 10 2004 起）为假时系统不把光标画进画面。没有这个属性时由调用方退到 `baked`。
//! - 黄框：`IsBorderRequired = false`（Windows 11 起）不画捕获时的黄色边框，要先 `GraphicsCaptureAccess::RequestAccessAsync(
//!   Borderless)`。没有打包的桌面程序上这一请求的行为（会不会弹提示、会不会被拒）文档没有写，待实机核实；被拒或超时就
//!   照旧有黄框，不影响录制。
//! - 捕获项关闭（窗口关了、显示器拔了）：这一路记为断开（`device-lost`）。
//! - 排除应用做不到：Windows.Graphics.Capture 录整块屏幕时没有排除别的进程窗口的接口（见 [`super::WinCapturer`]）。

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Foundation::Metadata::ApiInformation;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureAccess, GraphicsCaptureAccessKind, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread,
    ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::IsWindow;
use windows_core::{HSTRING, Interface, factory};

use crate::platform::windows_portable::convert::bgra_to_nv12;
use crate::platform::windows_portable::geometry::{PixelRect, area_pixels, copy_size, even};
use crate::protocol::{CaptureKind, Source, WorkerError};
use crate::sink::Sink;

use super::clock;
use super::com::error;
use super::sources;
use super::writer::{Frame, Track};

const SESSION_TYPE: &str = "Windows.Graphics.Capture.GraphicsCaptureSession";
const BORDER_TIMEOUT: Duration = Duration::from_secs(3);

/// `start` 的来源解析成的捕获项与尺寸。
pub struct Resolved {
    pub kind: CaptureKind,
    /// 编码尺寸（物理像素，偶数）。
    pub width: u32,
    pub height: u32,
    /// 所在显示器的缩放比例（每逻辑单位的像素数）。
    pub scale: f64,
    /// 捕获范围在虚拟桌面上的物理像素（指针归一化用；窗口会动，指针线程每次重新取）。
    pub global: PixelRect,
    /// 窗口录制：窗口句柄的值。
    pub window: Option<isize>,
    item: GraphicsCaptureItem,
    /// 区域录制：帧里要裁出来的部分（相对显示器左上）。
    crop: Option<PixelRect>,
}

pub fn capture_supported() -> bool {
    GraphicsCaptureSession::IsSupported().unwrap_or(false)
}

fn session_has(property: &str) -> bool {
    ApiInformation::IsPropertyPresent(&HSTRING::from(SESSION_TYPE), &HSTRING::from(property)).unwrap_or(false)
}

pub fn cursor_toggle_supported() -> bool {
    session_has("IsCursorCaptureEnabled")
}

fn interop() -> Result<IGraphicsCaptureItemInterop, WorkerError> {
    factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(|e| error("CAPTURE_FAILED", "Windows.Graphics.Capture is unavailable", &e))
}

fn rect_of(rect: windows::Win32::Foundation::RECT) -> PixelRect {
    PixelRect {
        x: rect.left,
        y: rect.top,
        width: (rect.right - rect.left).max(0) as u32,
        height: (rect.bottom - rect.top).max(0) as u32,
    }
}

pub fn resolve(source: &Source) -> Result<Resolved, WorkerError> {
    let not_found = |what: &str| WorkerError::new("SOURCE_NOT_FOUND", format!("{what} is not available"));
    match source {
        Source::Display { display_id } => {
            let monitor = sources::find_monitor(display_id.as_deref()).ok_or_else(|| not_found("the display"))?;
            let item: GraphicsCaptureItem = unsafe { interop()?.CreateForMonitor(monitor.handle) }
                .map_err(|e| error("CAPTURE_FAILED", "cannot capture the display", &e))?;
            Ok(Resolved {
                kind: CaptureKind::Display,
                width: even(monitor.width()),
                height: even(monitor.height()),
                scale: monitor.scale,
                global: rect_of(monitor.rect),
                window: None,
                item,
                crop: None,
            })
        }
        Source::Window { window_id } => {
            let window = sources::parse_window(window_id).ok_or_else(|| not_found("the window"))?;
            if !unsafe { IsWindow(Some(window)) }.as_bool() {
                return Err(not_found("the window"));
            }
            let item: GraphicsCaptureItem = unsafe { interop()?.CreateForWindow(window) }
                .map_err(|e| error("CAPTURE_FAILED", "cannot capture the window", &e))?;
            let size = item.Size().map_err(|e| error("CAPTURE_FAILED", "cannot read the window size", &e))?;
            let scale = sources::monitor_of(window).map_or(1.0, |monitor| monitor.scale);
            let global = sources::window_frame(window).map(rect_of).unwrap_or_default();
            Ok(Resolved {
                kind: CaptureKind::Window,
                width: even(size.Width.max(2) as u32),
                height: even(size.Height.max(2) as u32),
                scale,
                global,
                window: Some(window.0 as isize),
                item,
                crop: None,
            })
        }
        Source::Area { display_id, rect } => {
            let monitor = sources::find_monitor(display_id.as_deref()).ok_or_else(|| not_found("the display"))?;
            let crop = area_pixels(rect, monitor.scale, monitor.width(), monitor.height())
                .ok_or_else(|| WorkerError::new("INVALID_PARAMS", "the area is outside the display or too small"))?;
            let item: GraphicsCaptureItem = unsafe { interop()?.CreateForMonitor(monitor.handle) }
                .map_err(|e| error("CAPTURE_FAILED", "cannot capture the display", &e))?;
            Ok(Resolved {
                kind: CaptureKind::Area,
                width: crop.width,
                height: crop.height,
                scale: monitor.scale,
                global: PixelRect { x: monitor.rect.left + crop.x, y: monitor.rect.top + crop.y, ..crop },
                window: None,
                item,
                crop: Some(crop),
            })
        }
    }
}

/// 帧回调里用到的东西：都在一把锁里，同一时刻只有一个回调在处理帧。
struct FrameState {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    winrt_device: IDirect3DDevice,
    pool: Direct3D11CaptureFramePool,
    staging: Option<ID3D11Texture2D>,
    /// 帧池当前的大小（窗口改大小后 `Recreate`）。
    pool_size: SizeInt32,
    output: (u32, u32),
    crop: Option<PixelRect>,
    interval_ns: u64,
    next_due: u64,
    bgra: Vec<u8>,
    track: Arc<Track>,
}

// SAFETY: D3D11 设备开了多线程保护；立即上下文与帧池只在这把锁里用。WinRT 的帧池、设备是敏捷对象。
unsafe impl Send for FrameState {}

pub struct ScreenCapture {
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    item: GraphicsCaptureItem,
    frame_token: i64,
    closed_token: i64,
}

impl ScreenCapture {
    pub fn start(resolved: &Resolved, fps: u32, baked: bool, track: Arc<Track>, _sink: Arc<Sink>) -> Result<Self, WorkerError> {
        let fail = |what: &str, e: &windows_core::Error| error("CAPTURE_FAILED", what, e);
        let (device, context) = create_device().map_err(|e| fail("cannot create the Direct3D device", &e))?;
        let dxgi: IDXGIDevice = device.cast().map_err(|e| fail("cannot get the DXGI device", &e))?;
        let winrt_device: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }
            .and_then(|inspectable| inspectable.cast())
            .map_err(|e| fail("cannot wrap the Direct3D device", &e))?;
        let item = resolved.item.clone();
        let size = item.Size().map_err(|e| fail("cannot read the capture size", &e))?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&winrt_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size)
            .map_err(|e| fail("cannot create the frame pool", &e))?;
        let session = pool.CreateCaptureSession(&item).map_err(|e| fail("cannot create the capture session", &e))?;
        if cursor_toggle_supported()
            && let Err(e) = session.SetIsCursorCaptureEnabled(baked)
        {
            eprintln!("cannot set IsCursorCaptureEnabled: {}", e.message());
        }
        request_borderless(&session);
        let fps = fps.max(1);
        if session_has("MinUpdateInterval") {
            let _ = session.SetMinUpdateInterval(TimeSpan { Duration: 10_000_000 / i64::from(fps) });
        }
        let state = Arc::new(Mutex::new(FrameState {
            device,
            context,
            winrt_device,
            pool: pool.clone(),
            staging: None,
            pool_size: size,
            output: (resolved.width, resolved.height),
            crop: resolved.crop,
            interval_ns: 1_000_000_000 / u64::from(fps),
            next_due: 0,
            bgra: Vec::new(),
            track: Arc::clone(&track),
        }));
        let handler_state = Arc::clone(&state);
        let frame_token = pool
            .FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, windows_core::IInspectable>::new(move |_, _| {
                if let Ok(mut state) = handler_state.lock()
                    && let Err(e) = on_frame(&mut state)
                {
                    eprintln!("a screen frame was dropped: {}", e.message());
                }
                Ok(())
            }))
            .map_err(|e| fail("cannot subscribe to frames", &e))?;
        let lost_track = Arc::clone(&track);
        let closed_token = item
            .Closed(&TypedEventHandler::<GraphicsCaptureItem, windows_core::IInspectable>::new(move |_, _| {
                lost_track.lose(clock::now());
                Ok(())
            }))
            .map_err(|e| fail("cannot subscribe to the capture item", &e))?;
        session.StartCapture().map_err(|e| fail("cannot start the capture", &e))?;
        Ok(Self { session, pool, item, frame_token, closed_token })
    }

    pub fn stop(self) {
        let _ = self.pool.RemoveFrameArrived(self.frame_token);
        let _ = self.item.RemoveClosed(self.closed_token);
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

fn create_device() -> windows_core::Result<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    let missing = || windows_core::Error::from(windows::Win32::Foundation::E_POINTER);
    let device = device.ok_or_else(missing)?;
    let context = context.ok_or_else(missing)?;
    if let Ok(multithread) = context.cast::<ID3D11Multithread>() {
        let _ = unsafe { multithread.SetMultithreadProtected(true) };
    }
    Ok((device, context))
}

/// 请求不画黄框。等不到结果（比如系统在等用户回答）时不阻塞开始，照旧有黄框。
fn request_borderless(session: &GraphicsCaptureSession) {
    if !session_has("IsBorderRequired") {
        return;
    }
    let (tx, rx) = mpsc::sync_channel(1);
    let requested = GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless).and_then(|operation| {
        operation.when(move |result| {
            let _ = tx.try_send(result);
        })
    });
    if let Err(e) = requested {
        eprintln!("cannot request borderless capture: {}", e.message());
        return;
    }
    match rx.recv_timeout(BORDER_TIMEOUT) {
        Ok(Ok(AppCapabilityAccessStatus::Allowed)) => {
            if let Err(e) = session.SetIsBorderRequired(false) {
                eprintln!("cannot turn off the capture border: {}", e.message());
            }
        }
        Ok(Ok(status)) => eprintln!("borderless capture was not allowed ({})", status.0),
        Ok(Err(e)) => eprintln!("borderless capture request failed: {}", e.message()),
        Err(_) => eprintln!("borderless capture request did not answer in time"),
    }
}

fn on_frame(state: &mut FrameState) -> windows_core::Result<()> {
    let frame = state.pool.TryGetNextFrame()?;
    let at = clock::from_hns(frame.SystemRelativeTime()?.Duration);
    let content = frame.ContentSize()?;
    if content.Width != state.pool_size.Width || content.Height != state.pool_size.Height {
        // 窗口改了大小：之后的帧按新大小来。这一帧照用（内容在帧左上，大小是 `ContentSize`）。
        state.pool.Recreate(&state.winrt_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, content)?;
        state.pool_size = content;
    }
    // 比请求的帧率密：丢掉。留四分之一帧的余量，免得时刻的抖动把每一帧都挤掉一半。
    if at.0 + state.interval_ns / 4 < state.next_due {
        let _ = frame.Close();
        return Ok(());
    }
    state.next_due = state.next_due.max(at.0.saturating_sub(state.interval_ns)) + state.interval_ns;
    let surface = frame.Surface()?;
    let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
    let texture: ID3D11Texture2D = unsafe { access.GetInterface() }?;
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    let (out_w, out_h) = state.output;
    // 源里要拷的部分。
    let (src_x, src_y, avail_w, avail_h) = match state.crop {
        Some(crop) => (crop.x.max(0) as u32, crop.y.max(0) as u32, crop.width, crop.height),
        None => (0, 0, content.Width.max(0) as u32, content.Height.max(0) as u32),
    };
    let avail_w = avail_w.min(desc.Width.saturating_sub(src_x));
    let avail_h = avail_h.min(desc.Height.saturating_sub(src_y));
    let (copy_w, copy_h) = copy_size((avail_w, avail_h), (out_w, out_h));
    if copy_w == 0 || copy_h == 0 {
        let _ = frame.Close();
        return Ok(());
    }
    if state.staging.is_none() {
        let staging_desc = D3D11_TEXTURE2D_DESC {
            Width: out_w,
            Height: out_h,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut staging: Option<ID3D11Texture2D> = None;
        unsafe { state.device.CreateTexture2D(&staging_desc, None, Some(&mut staging)) }?;
        state.staging = staging;
    }
    let Some(staging) = state.staging.clone() else { return Ok(()) };
    let source_box = D3D11_BOX { left: src_x, top: src_y, front: 0, right: src_x + copy_w, bottom: src_y + copy_h, back: 1 };
    unsafe { state.context.CopySubresourceRegion(&staging, 0, 0, 0, 0, &texture, 0, Some(&source_box)) };
    // 帧的纹理拷走了就可以还给帧池。
    let _ = frame.Close();
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { state.context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }?;
    let row = out_w as usize * 4;
    state.bgra.clear();
    state.bgra.resize(row * out_h as usize, 0);
    for y in 0..copy_h as usize {
        let source = unsafe { std::slice::from_raw_parts((mapped.pData as *const u8).add(y * mapped.RowPitch as usize), copy_w as usize * 4) };
        state.bgra[y * row..y * row + copy_w as usize * 4].copy_from_slice(source);
    }
    unsafe { state.context.Unmap(&staging, 0) };
    let mut nv12 = Vec::new();
    bgra_to_nv12(&state.bgra, row, out_w as usize, out_h as usize, &mut nv12);
    state.track.push_video(at, Frame { width: out_w, height: out_h, data: Arc::new(nv12) });
    Ok(())
}
