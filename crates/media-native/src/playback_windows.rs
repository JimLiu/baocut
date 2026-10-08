//! Windows 实时播放帧服务器：`IMFMediaEngine` → 可共享 D3D11 BGRA 纹理。
//!
//! 这是统一渲染 R4 的平台边界，不是另一条 CPU 解码器：Media Foundation 在
//! frame-server 模式直接写调用方拥有的 DXGI surface，随后用共享 D3D11 fence
//! 发布完成值。D3D12/wgpu 消费端应先等待 [`DxgiVideoFrame::ready_fence_value`]，
//! 再采样 [`DxgiVideoFrame::texture_handle`] 打开的资源。
//!
//! 帧服务器与创建它的线程绑定（COM/MF 生命周期必须在同一线程配对）。每一帧
//! 可以跨线程交给 GPU 消费端；三槽纹理池都仍被占用时，新帧按非阻塞背压丢弃，
//! 不覆盖在途纹理，也不回退到 CPU readback。latest-wins 邮箱属于上层调度器。

use std::marker::PhantomData;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
use std::path::Path;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use windows::Win32::Foundation::{GENERIC_ALL, HMODULE, RECT, S_FALSE};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP};
use windows::Win32::Graphics::Direct3D10::ID3D10Multithread;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_CREATE_DEVICE_PREVENT_INTERNAL_THREADING_OPTIMIZATIONS,
    D3D11_CREATE_DEVICE_VIDEO_SUPPORT, D3D11_FENCE_FLAG_SHARED, D3D11_RESOURCE_MISC_SHARED,
    D3D11_RESOURCE_MISC_SHARED_NTHANDLE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_DEFAULT, D3D11CreateDevice, ID3D11Device, ID3D11Device5, ID3D11DeviceContext,
    ID3D11DeviceContext4, ID3D11Fence, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    DXGI_SHARED_RESOURCE_READ, DXGI_SHARED_RESOURCE_WRITE, IDXGIDevice, IDXGIResource1,
};
use windows::Win32::Media::MediaFoundation::{
    CLSID_MFMediaEngineClassFactory, IMFByteStream, IMFDXGIDeviceManager, IMFMediaEngine,
    IMFMediaEngineClassFactory, IMFMediaEngineEx, IMFMediaEngineNotify, IMFMediaEngineNotify_Impl,
    MF_ACCESSMODE_READ, MF_FILEFLAGS_NONE, MF_MEDIA_ENGINE_CALLBACK, MF_MEDIA_ENGINE_DXGI_MANAGER,
    MF_MEDIA_ENGINE_EVENT_ERROR, MF_MEDIA_ENGINE_EVENT_LOADEDMETADATA,
    MF_MEDIA_ENGINE_READY_HAVE_FUTURE_DATA, MF_MEDIA_ENGINE_VIDEO_OUTPUT_FORMAT,
    MF_OPENMODE_FAIL_IF_NOT_EXIST, MFCreateAttributes, MFCreateDXGIDeviceManager, MFCreateFile,
};
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
use windows::core::{BSTR, Interface, PCWSTR, implement};

use crate::windows::{Runtime, media_feature_error, wide_path};

const SURFACE_POOL_SIZE: usize = 3;
static NEXT_SHARED_OBJECT_ID: AtomicU64 = AtomicU64::new(1);

fn next_shared_object_id() -> u64 {
    NEXT_SHARED_OBJECT_ID.fetch_add(1, Ordering::Relaxed).max(1)
}

const METADATA_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
struct NotifyInner {
    metadata_loaded: bool,
    error: Option<(usize, u32)>,
}

#[derive(Default)]
struct NotifyState {
    inner: Mutex<NotifyInner>,
    changed: Condvar,
}

#[implement(IMFMediaEngineNotify)]
struct MediaEngineNotify {
    state: Arc<NotifyState>,
}

impl IMFMediaEngineNotify_Impl for MediaEngineNotify_Impl {
    fn EventNotify(&self, event: u32, param1: usize, param2: u32) -> windows::core::Result<()> {
        let mut inner = self
            .state
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if event == MF_MEDIA_ENGINE_EVENT_LOADEDMETADATA.0 as u32 {
            inner.metadata_loaded = true;
            self.state.changed.notify_all();
        } else if event == MF_MEDIA_ENGINE_EVENT_ERROR.0 as u32 {
            inner.error = Some((param1, param2));
            self.state.changed.notify_all();
        }
        Ok(())
    }
}

struct SharedSurface {
    id: u64,
    texture: ID3D11Texture2D,
    handle: OwnedHandle,
    width: u32,
    height: u32,
}

struct SharedFence {
    id: u64,
    fence: ID3D11Fence,
    handle: OwnedHandle,
}

/// 创建播放纹理的 DXGI adapter 标识。
///
/// D3D12/wgpu 消费端必须使用同一 LUID；不匹配时应明确拒绝导入，而不是复制到 CPU。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct DxgiAdapterLuid {
    pub low_part: u32,
    pub high_part: i32,
}

/// `IMFMediaEngine` 的平台观测态。App 只做同名映射，不自行猜测 ready/seek/ended。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DxgiPlaybackState {
    Playing,
    Buffering,
    Paused,
    Ended,
}

/// 一帧已经由 Media Foundation 写好的 GPU surface。
///
/// 句柄只在本值存活期间保证有效；D3D12/wgpu 消费端应打开纹理与 fence 后再
/// 释放本值。打开 fence 后等待 [`ready_fence_value`](Self::ready_fence_value)，
/// 才能读取对应纹理。类型内没有 CPU 像素缓冲。
#[derive(Clone)]
pub struct DxgiVideoFrame {
    surface: Arc<SharedSurface>,
    fence: Arc<SharedFence>,
    timestamp_hns: i64,
    ready_fence_value: u64,
    adapter_luid: DxgiAdapterLuid,
}

impl std::fmt::Debug for DxgiVideoFrame {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DxgiVideoFrame")
            .field("width", &self.width())
            .field("height", &self.height())
            .field("timestamp_hns", &self.timestamp_hns)
            .field("ready_fence_value", &self.ready_fence_value)
            .field("adapter_luid", &self.adapter_luid)
            .finish_non_exhaustive()
    }
}

impl DxgiVideoFrame {
    /// 进程内稳定的 surface 身份，供 D3D12 importer 缓存已打开的 COM resource。
    /// 与 NT handle 数值不同：server 析构后 Windows 可以复用 handle 数值。
    pub fn surface_id(&self) -> u64 {
        self.surface.id
    }

    /// 进程内稳定的 shared fence 身份，供 importer 缓存已打开的 fence。
    pub fn synchronization_id(&self) -> u64 {
        self.fence.id
    }

    pub fn width(&self) -> u32 {
        self.surface.width
    }

    pub fn height(&self) -> u32 {
        self.surface.height
    }

    /// Media Foundation 的呈现时间戳，单位为 100ns。
    pub fn timestamp_hns(&self) -> i64 {
        self.timestamp_hns
    }

    pub fn timestamp_seconds(&self) -> f64 {
        self.timestamp_hns as f64 / 10_000_000.0
    }

    /// `IDXGIResource1::CreateSharedHandle` 产生的 NT handle。
    pub fn texture_handle(&self) -> RawHandle {
        self.surface.handle.as_raw_handle()
    }

    /// `ID3D11Fence::CreateSharedHandle` 产生的 NT handle。
    pub fn ready_fence_handle(&self) -> RawHandle {
        self.fence.handle.as_raw_handle()
    }

    /// 消费端读取纹理之前必须等待的 fence 值。
    pub fn ready_fence_value(&self) -> u64 {
        self.ready_fence_value
    }

    pub fn adapter_luid(&self) -> DxgiAdapterLuid {
        self.adapter_luid
    }
}

/// `IMFMediaEngine` 播放器。视频使用三槽共享纹理池；纯音频只保留播放时钟。
///
/// 本类型刻意不是 `Send` / `Sync`：创建、控制和析构都要留在同一 COM 线程。
/// 返回的 [`DxgiVideoFrame`] 可以移交给渲染线程。
pub struct DxgiFrameServer {
    engine: IMFMediaEngine,
    context: ID3D11DeviceContext4,
    surfaces: Vec<Arc<SharedSurface>>,
    fence: Arc<SharedFence>,
    next_surface: usize,
    last_timestamp_hns: Option<i64>,
    next_fence_value: u64,
    dropped_frames: u64,
    adapter_luid: DxgiAdapterLuid,
    width: u32,
    height: u32,
    has_audio: bool,
    duration_seconds: f64,
    _callback: IMFMediaEngineNotify,
    _byte_stream: IMFByteStream,
    _dxgi_manager: IMFDXGIDeviceManager,
    _device: ID3D11Device,
    notify_state: Arc<NotifyState>,
    _runtime: Runtime,
    _thread_affinity: PhantomData<Rc<()>>,
}

/// 打开本地媒体，等待元数据；有视频轨时建立 frame-server 的共享 GPU surface 池。
pub fn open_dxgi_frame_server(path: &Path) -> Result<DxgiFrameServer> {
    if !path.is_file() {
        bail!("媒体文件不存在：{}", path.display());
    }
    let runtime = Runtime::start()?;
    unsafe { open_inner(runtime, path) }
}

unsafe fn open_inner(runtime: Runtime, path: &Path) -> Result<DxgiFrameServer> {
    let (device, immediate_context) = unsafe { create_d3d11_device()? };
    let multithread: ID3D10Multithread = device.cast().context("D3D11 设备不支持多线程保护")?;
    let _was_protected = unsafe { multithread.SetMultithreadProtected(true) };

    let context: ID3D11DeviceContext4 = immediate_context
        .cast()
        .context("D3D11 设备不支持共享 fence（需要 Windows 10）")?;
    let fence = Arc::new(unsafe { create_shared_fence(&device)? });
    let adapter_luid = unsafe { adapter_luid(&device)? };

    let mut reset_token = 0_u32;
    let mut manager = None;
    unsafe { MFCreateDXGIDeviceManager(&mut reset_token, &mut manager) }
        .map_err(|error| media_feature_error("创建 DXGI Device Manager", error))?;
    let manager = manager.context("Media Foundation 返回空 DXGI Device Manager")?;
    unsafe { manager.ResetDevice(&device, reset_token) }
        .map_err(|error| media_feature_error("绑定 D3D11 解码设备", error))?;

    let notify_state = Arc::new(NotifyState::default());
    let callback: IMFMediaEngineNotify = MediaEngineNotify {
        state: Arc::clone(&notify_state),
    }
    .into();
    let attributes = unsafe {
        let mut attributes = None;
        MFCreateAttributes(&mut attributes, 3)
            .map_err(|error| media_feature_error("创建 Media Engine 属性", error))?;
        let attributes = attributes.context("Media Foundation 返回空属性对象")?;
        attributes.SetUnknown(&MF_MEDIA_ENGINE_CALLBACK, &callback)?;
        attributes.SetUnknown(&MF_MEDIA_ENGINE_DXGI_MANAGER, &manager)?;
        attributes.SetUINT32(
            &MF_MEDIA_ENGINE_VIDEO_OUTPUT_FORMAT,
            DXGI_FORMAT_B8G8R8A8_UNORM.0 as u32,
        )?;
        attributes
    };
    let factory: IMFMediaEngineClassFactory =
        unsafe { CoCreateInstance(&CLSID_MFMediaEngineClassFactory, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| media_feature_error("创建 Media Engine 工厂", error))?;
    let engine = unsafe { factory.CreateInstance(0, &attributes) }
        .map_err(|error| media_feature_error("创建 Media Engine frame-server", error))?;
    let configured = (|| -> Result<_> {
        let wide = wide_path(path);
        let byte_stream = unsafe {
            MFCreateFile(
                MF_ACCESSMODE_READ,
                MF_OPENMODE_FAIL_IF_NOT_EXIST,
                MF_FILEFLAGS_NONE,
                PCWSTR(wide.as_ptr()),
            )
        }
        .map_err(|error| media_feature_error("打开播放媒体", error))?;
        let engine_ex: IMFMediaEngineEx = engine.cast().context("Media Engine 缺少扩展接口")?;
        // `wide_path` 已规范化 verbatim prefix 且末尾带 NUL；BSTR 自带长度，不含 NUL。
        // 直接保留 UTF-16，避免 Windows 路径先经过 lossy UTF-8 往返。
        let source_url = BSTR::from_wide(&wide[..wide.len() - 1]);
        unsafe { engine_ex.SetSourceFromByteStream(&byte_stream, &source_url) }
            .map_err(|error| media_feature_error("设置播放媒体", error))?;
        wait_for_metadata(&notify_state, path)?;

        let has_video = unsafe { engine.HasVideo().as_bool() };
        let has_audio = unsafe { engine.HasAudio().as_bool() };
        if !has_video && !has_audio {
            bail!("unsupported: 源媒体没有音频或视频轨");
        }
        let (width, height, surfaces) = if has_video {
            let mut width = 0_u32;
            let mut height = 0_u32;
            unsafe { engine.GetNativeVideoSize(Some(&mut width), Some(&mut height)) }
                .context("读取视频尺寸失败")?;
            if width == 0 || height == 0 {
                bail!("unsupported: 源媒体没有有效的视频轨");
            }
            if width > i32::MAX as u32 || height > i32::MAX as u32 {
                bail!("unsupported: 视频尺寸超出 DXGI RECT 范围：{width}x{height}");
            }
            let surfaces = (0..SURFACE_POOL_SIZE)
                .map(|_| unsafe { create_shared_surface(&device, width, height).map(Arc::new) })
                .collect::<Result<Vec<_>>>()?;
            (width, height, surfaces)
        } else {
            (0, 0, Vec::new())
        };
        let duration_seconds = unsafe { engine.GetDuration() };
        Ok((
            byte_stream,
            width,
            height,
            surfaces,
            has_audio,
            duration_seconds,
        ))
    })();
    let (byte_stream, width, height, surfaces, has_audio, duration_seconds) = match configured {
        Ok(configured) => configured,
        Err(error) => {
            let _ = unsafe { engine.Shutdown() };
            return Err(error);
        }
    };

    Ok(DxgiFrameServer {
        engine,
        context,
        surfaces,
        fence,
        next_surface: 0,
        last_timestamp_hns: None,
        next_fence_value: 1,
        dropped_frames: 0,
        adapter_luid,
        width,
        height,
        has_audio,
        duration_seconds,
        _callback: callback,
        _byte_stream: byte_stream,
        _dxgi_manager: manager,
        _device: device,
        notify_state,
        _runtime: runtime,
        _thread_affinity: PhantomData,
    })
}

impl DxgiFrameServer {
    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn has_video(&self) -> bool {
        !self.surfaces.is_empty()
    }

    pub fn has_audio(&self) -> bool {
        self.has_audio
    }

    pub fn duration_seconds(&self) -> f64 {
        self.duration_seconds
    }

    /// 因三槽都仍在消费而被丢弃的解码帧数。
    pub fn dropped_frame_count(&self) -> u64 {
        self.dropped_frames
    }

    pub fn adapter_luid(&self) -> DxgiAdapterLuid {
        self.adapter_luid
    }

    pub fn current_time_seconds(&self) -> f64 {
        unsafe { self.engine.GetCurrentTime() }
    }

    /// 即时读取 Media Engine 状态。错误事件优先于普通状态返回；seeking 或播放意图
    /// 已生效但还没有 future data 时属于 buffering。
    pub fn playback_state(&self) -> Result<DxgiPlaybackState> {
        self.ensure_no_media_error()?;
        if unsafe { self.engine.IsEnded().as_bool() } {
            return Ok(DxgiPlaybackState::Ended);
        }
        if unsafe { self.engine.IsSeeking().as_bool() } {
            return Ok(DxgiPlaybackState::Buffering);
        }
        if unsafe { self.engine.IsPaused().as_bool() } {
            return Ok(DxgiPlaybackState::Paused);
        }
        if unsafe { self.engine.GetReadyState() } < MF_MEDIA_ENGINE_READY_HAVE_FUTURE_DATA.0 as u16
        {
            return Ok(DxgiPlaybackState::Buffering);
        }
        Ok(DxgiPlaybackState::Playing)
    }

    pub fn play(&self) -> Result<()> {
        unsafe { self.engine.Play() }.context("Media Engine 开始播放失败")
    }

    pub fn pause(&self) -> Result<()> {
        unsafe { self.engine.Pause() }.context("Media Engine 暂停失败")
    }

    pub fn seek(&self, seconds: f64) -> Result<()> {
        if !seconds.is_finite() {
            bail!("播放时间必须是有限值，实得 {seconds}");
        }
        unsafe { self.engine.SetCurrentTime(seconds.max(0.0)) }.context("Media Engine 定位失败")
    }

    pub fn set_volume(&self, volume: f32) -> Result<()> {
        if !volume.is_finite() {
            bail!("音量必须是有限值，实得 {volume}");
        }
        unsafe { self.engine.SetVolume(f64::from(volume.clamp(0.0, 1.0))) }
            .context("Media Engine 设置音量失败")
    }

    pub fn set_playback_rate(&self, rate: f32) -> Result<()> {
        if !rate.is_finite() || rate <= 0.0 {
            bail!("播放速率必须是有限正数，实得 {rate}");
        }
        unsafe { self.engine.SetPlaybackRate(f64::from(rate)) }
            .context("Media Engine 设置播放速率失败")
    }

    /// 取一帧已经完成 GPU 写入的 surface。
    ///
    /// 没有新帧，或三槽都还被消费端持有时返回 `Ok(None)`。后者是有意的
    /// 非阻塞背压：实时预览宁可丢掉当前帧，不等待 UI/GPU，也不做 CPU 回读。
    /// 上层 latest-wins 邮箱应及时释放被替换的旧帧。
    pub fn try_acquire_frame(&mut self) -> Result<Option<DxgiVideoFrame>> {
        self.ensure_no_media_error()?;
        if !self.has_video() {
            return Ok(None);
        }
        let Some(timestamp_hns) = self.video_stream_tick()? else {
            return Ok(None);
        };
        if self.last_timestamp_hns == Some(timestamp_hns) {
            return Ok(None);
        }
        self.last_timestamp_hns = Some(timestamp_hns);

        let Some(surface) = self.next_available_surface() else {
            self.dropped_frames = self.dropped_frames.saturating_add(1);
            return Ok(None);
        };
        let destination = RECT {
            left: 0,
            top: 0,
            right: self.width as i32,
            bottom: self.height as i32,
        };
        unsafe {
            self.engine
                .TransferVideoFrame(&surface.texture, None, &destination, None)
        }
        .context("Media Engine 把视频帧写入共享纹理失败")?;

        let ready_fence_value = self.next_fence_value;
        self.next_fence_value = self.next_fence_value.wrapping_add(1).max(1);
        unsafe { self.context.Signal(&self.fence.fence, ready_fence_value) }
            .context("发布 D3D11 共享 fence 失败")?;

        Ok(Some(DxgiVideoFrame {
            surface,
            fence: Arc::clone(&self.fence),
            timestamp_hns,
            ready_fence_value,
            adapter_luid: self.adapter_luid,
        }))
    }

    fn video_stream_tick(&self) -> Result<Option<i64>> {
        let mut timestamp_hns = 0_i64;
        let status = unsafe {
            (Interface::vtable(&self.engine).OnVideoStreamTick)(
                Interface::as_raw(&self.engine),
                &mut timestamp_hns,
            )
        };
        if status == S_FALSE {
            return Ok(None);
        }
        status
            .ok()
            .map_err(|error| media_feature_error("查询 Media Engine 视频帧", error))?;
        Ok(Some(timestamp_hns))
    }

    fn next_available_surface(&mut self) -> Option<Arc<SharedSurface>> {
        for offset in 0..self.surfaces.len() {
            let index = (self.next_surface + offset) % self.surfaces.len();
            if Arc::strong_count(&self.surfaces[index]) == 1 {
                self.next_surface = (index + 1) % self.surfaces.len();
                return Some(Arc::clone(&self.surfaces[index]));
            }
        }
        None
    }

    fn ensure_no_media_error(&self) -> Result<()> {
        let inner = self
            .notify_state
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some((media_error, status)) = inner.error {
            bail!("Media Engine 播放失败（mediaError={media_error}, status=0x{status:08x}）");
        }
        Ok(())
    }
}

impl Drop for DxgiFrameServer {
    fn drop(&mut self) {
        let _ = unsafe { self.engine.Shutdown() };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_only_wav_plays_without_video_surfaces() -> Result<()> {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/speech/test-sample.wav");
        let mut server = open_dxgi_frame_server(&path)?;
        assert!(server.has_audio());
        assert!(!server.has_video());
        assert_eq!((server.width(), server.height()), (0, 0));
        assert!(server.duration_seconds() > 3.0);
        assert!(server.try_acquire_frame()?.is_none());

        server.seek(0.0)?;
        server.play()?;
        let started = Instant::now();
        while server.current_time_seconds() < 0.1 {
            server.playback_state()?;
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "纯音频播放时钟未启动"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        server.pause()?;
        let paused_at = server.current_time_seconds();
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            server.current_time_seconds() - paused_at < 0.05,
            "纯音频暂停后时钟仍在运行"
        );

        server.seek(server.duration_seconds() - 0.15)?;
        server.play()?;
        let started = Instant::now();
        while server.playback_state()? != DxgiPlaybackState::Ended {
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "纯音频未进入结束状态"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    }
}

fn wait_for_metadata(state: &NotifyState, path: &Path) -> Result<()> {
    let started = Instant::now();
    let mut inner = state
        .inner
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    loop {
        if inner.metadata_loaded {
            return Ok(());
        }
        if let Some((media_error, status)) = inner.error {
            bail!(
                "Media Engine 无法加载 {}（mediaError={media_error}, status=0x{status:08x}）",
                path.display()
            );
        }
        let Some(remaining) = METADATA_TIMEOUT.checked_sub(started.elapsed()) else {
            bail!("Media Engine 等待元数据超时：{}", path.display());
        };
        let waited = state
            .changed
            .wait_timeout(inner, remaining)
            .unwrap_or_else(|error| error.into_inner());
        inner = waited.0;
        if waited.1.timed_out() && !inner.metadata_loaded {
            bail!("Media Engine 等待元数据超时：{}", path.display());
        }
    }
}

unsafe fn create_d3d11_device() -> Result<(ID3D11Device, ID3D11DeviceContext)> {
    let flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT
        | D3D11_CREATE_DEVICE_VIDEO_SUPPORT
        | D3D11_CREATE_DEVICE_PREVENT_INTERNAL_THREADING_OPTIMIZATIONS;
    let mut last_error = None;
    for driver_type in [D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP] {
        let mut device = None;
        let mut context = None;
        match unsafe {
            D3D11CreateDevice(
                None,
                driver_type,
                HMODULE::default(),
                flags,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
        } {
            Ok(()) => {
                return Ok((
                    device.context("D3D11 返回空设备")?,
                    context.context("D3D11 返回空 immediate context")?,
                ));
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(anyhow!(
        "创建支持视频与 BGRA 的 D3D11 设备失败：{}",
        last_error.context("没有 D3D11 driver 可尝试")?
    ))
}

unsafe fn create_shared_surface(
    device: &ID3D11Device,
    width: u32,
    height: u32,
) -> Result<SharedSurface> {
    let description = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE).0 as u32,
        CPUAccessFlags: 0,
        MiscFlags: (D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE).0 as u32,
    };
    let mut texture = None;
    unsafe { device.CreateTexture2D(&description, None, Some(&mut texture)) }
        .context("创建 Media Engine 共享 BGRA 纹理失败")?;
    let texture = texture.context("D3D11 返回空 BGRA 纹理")?;
    let resource: IDXGIResource1 = texture.cast().context("BGRA 纹理缺少 IDXGIResource1")?;
    let handle = unsafe {
        resource.CreateSharedHandle(
            None,
            DXGI_SHARED_RESOURCE_READ.0 | DXGI_SHARED_RESOURCE_WRITE.0,
            PCWSTR::null(),
        )
    }
    .context("导出 BGRA 纹理 NT handle 失败")?;
    Ok(SharedSurface {
        id: next_shared_object_id(),
        texture,
        handle: unsafe { own_handle(handle.0, "BGRA 纹理")? },
        width,
        height,
    })
}

unsafe fn adapter_luid(device: &ID3D11Device) -> Result<DxgiAdapterLuid> {
    let dxgi_device: IDXGIDevice = device.cast().context("D3D11 设备缺少 IDXGIDevice")?;
    let adapter = unsafe { dxgi_device.GetAdapter() }.context("读取 D3D11 adapter 失败")?;
    let description = unsafe { adapter.GetDesc() }.context("读取 DXGI adapter LUID 失败")?;
    Ok(DxgiAdapterLuid {
        low_part: description.AdapterLuid.LowPart,
        high_part: description.AdapterLuid.HighPart,
    })
}

unsafe fn create_shared_fence(device: &ID3D11Device) -> Result<SharedFence> {
    let device: ID3D11Device5 = device
        .cast()
        .context("D3D11 设备不支持共享 fence（需要 Windows 10）")?;
    let mut fence = None;
    unsafe { device.CreateFence(0, D3D11_FENCE_FLAG_SHARED, &mut fence) }
        .context("创建 D3D11 shared fence 失败")?;
    let fence: ID3D11Fence = fence.context("D3D11 返回空 shared fence")?;
    let handle = unsafe { fence.CreateSharedHandle(None, GENERIC_ALL.0, PCWSTR::null()) }
        .context("导出 D3D11 fence NT handle 失败")?;
    Ok(SharedFence {
        id: next_shared_object_id(),
        fence,
        handle: unsafe { own_handle(handle.0, "D3D11 fence")? },
    })
}

unsafe fn own_handle(raw: RawHandle, label: &str) -> Result<OwnedHandle> {
    if raw.is_null() || raw as isize == -1 {
        bail!("{label}返回了无效 NT handle");
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(raw) })
}
