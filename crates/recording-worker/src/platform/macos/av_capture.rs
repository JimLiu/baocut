//! 摄像头与麦克风：每个设备一个 `AVCaptureSession`（设备输入加视频或音频数据输出），样本交给 [`Track`]。
//!
//! - 会话从 `open` 起一直开着，段外的样本由 [`Track`] 丢掉；暂停与恢复不重开设备（重开要几百毫秒，恢复后的
//!   头一段会缺内容）。
//! - 时刻在会话的 `synchronizationClock` 上（AVCaptureSession 文档），写日志时换到主机时钟。
//! - 系统的摄像头、麦克风权限还没问过时，打开设备输入由系统弹它的授权窗口（Runtime 只挡拒绝与受限的）。
//! - 设备断开靠 [`DeviceCapture::is_connected`]（`AVCaptureDevice.connected`），由监视线程轮询。

use std::sync::Arc;

use dispatch2::{DispatchQueue, DispatchRetained};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{AnyThread, DefinedClass, define_class, msg_send};
use objc2_av_foundation::{
    AVCaptureAudioDataOutput, AVCaptureAudioDataOutputSampleBufferDelegate, AVCaptureConnection, AVCaptureDevice, AVCaptureDeviceInput,
    AVCaptureOutput, AVCaptureSession, AVCaptureVideoDataOutput, AVCaptureVideoDataOutputSampleBufferDelegate,
};
use objc2_core_media::CMSampleBuffer;
use objc2_foundation::{NSObject, NSObjectProtocol};

use crate::protocol::{DeviceRef, WorkerError};

use super::sources;
use super::writer::Track;

pub struct DeviceIvars {
    track: Arc<Track>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "BaoCutRecordingDeviceOutput"]
    #[ivars = DeviceIvars]
    pub struct DeviceOutput;

    unsafe impl NSObjectProtocol for DeviceOutput {}

    // 视频与音频数据输出的委托方法是同一个选择子，实现一次，两个协议都声明遵守。
    unsafe impl AVCaptureAudioDataOutputSampleBufferDelegate for DeviceOutput {
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        unsafe fn did_output(&self, _output: &AVCaptureOutput, sample: &CMSampleBuffer, _connection: &AVCaptureConnection) {
            self.ivars().track.append(sample);
        }
    }

    unsafe impl AVCaptureVideoDataOutputSampleBufferDelegate for DeviceOutput {}
);

impl DeviceOutput {
    fn new(track: Arc<Track>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(DeviceIvars { track });
        unsafe { msg_send![super(this), init] }
    }
}

pub struct DeviceCapture {
    session: Retained<AVCaptureSession>,
    device: Retained<AVCaptureDevice>,
    track: Arc<Track>,
    _output: Retained<DeviceOutput>,
    _queue: DispatchRetained<DispatchQueue>,
}

/// 按 ID（或 `default`）找到设备，用于日志里的 `device`。
pub fn find(video: bool, id: &str) -> Result<(Retained<AVCaptureDevice>, DeviceRef), WorkerError> {
    let device = sources::capture_device(video, id).ok_or_else(|| {
        WorkerError::new("SOURCE_NOT_FOUND", format!("{} {id} does not exist", if video { "camera" } else { "microphone" }))
    })?;
    let reference =
        DeviceRef { id: Some(unsafe { device.uniqueID() }.to_string()), name: Some(unsafe { device.localizedName() }.to_string()) };
    Ok((device, reference))
}

impl DeviceCapture {
    pub fn start(video: bool, device: Retained<AVCaptureDevice>, track: Arc<Track>) -> Result<Self, WorkerError> {
        let what = if video { "camera" } else { "microphone" };
        let input = unsafe { AVCaptureDeviceInput::deviceInputWithDevice_error(&device) }.map_err(|error| {
            // `AVErrorApplicationIsNotAuthorizedToUseDevice`（AVFoundation `AVError.h`）：用户没有允许，Runtime 换成缺权限的错误。
            let denied = error.domain().to_string() == "AVFoundationErrorDomain" && error.code() == -11852;
            let code = match (denied, video) {
                (true, true) => "CAMERA_PERMISSION_DENIED",
                (true, false) => "MICROPHONE_PERMISSION_DENIED",
                (false, _) => "DEVICE_UNAVAILABLE",
            };
            WorkerError::new(code, format!("cannot open the {what}: {}", error.localizedDescription()))
        })?;
        let session = unsafe { AVCaptureSession::new() };
        let output = DeviceOutput::new(Arc::clone(&track));
        let queue = DispatchQueue::new(if video { "com.baocut.recording.camera" } else { "com.baocut.recording.microphone" }, None);
        unsafe {
            session.beginConfiguration();
            if !session.canAddInput(&input) {
                session.commitConfiguration();
                return Err(WorkerError::new("DEVICE_UNAVAILABLE", format!("the {what} cannot be added to a capture session")));
            }
            session.addInput(&input);
            let added = if video {
                let data = AVCaptureVideoDataOutput::new();
                data.setAlwaysDiscardsLateVideoFrames(true);
                data.setSampleBufferDelegate_queue(
                    Some(ProtocolObject::<dyn AVCaptureVideoDataOutputSampleBufferDelegate>::from_ref(&*output)),
                    Some(&queue),
                );
                session.canAddOutput(&data).then(|| session.addOutput(&data)).is_some()
            } else {
                let data = AVCaptureAudioDataOutput::new();
                data.setSampleBufferDelegate_queue(
                    Some(ProtocolObject::<dyn AVCaptureAudioDataOutputSampleBufferDelegate>::from_ref(&*output)),
                    Some(&queue),
                );
                session.canAddOutput(&data).then(|| session.addOutput(&data)).is_some()
            };
            session.commitConfiguration();
            if !added {
                return Err(WorkerError::new("DEVICE_UNAVAILABLE", format!("the {what} output cannot be added to a capture session")));
            }
            track.set_clock(session.synchronizationClock().map(super::clock::cf_clock));
            session.startRunning();
        }
        Ok(Self { session, device, track, _output: output, _queue: queue })
    }

    pub fn track(&self) -> &Arc<Track> {
        &self.track
    }

    pub fn is_connected(&self) -> bool {
        unsafe { self.device.isConnected() }
    }

    pub fn stop(&self) {
        unsafe { self.session.stopRunning() };
    }
}
