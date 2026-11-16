//! 段正常结束后把分片 MP4 转成普通 MP4（屏幕录制设计 §7：录制中崩溃时留下的是分片文件，正常收尾的是普通文件）。
//!
//! 不重新编码：Source Reader（`MFCreateSourceReaderFromURL`）读出压缩的样本，Sink Writer 以同一个媒体类型作输入与
//! 输出（输入输出类型相同时 Sink Writer 不插编码器，「Sink Writer」文档的 Tutorial: Using the Sink Writer to Encode
//! Video 与 Remarks），容器是 `MFTranscodeContainerType_MPEG4`。先写到旁边的临时文件，成功后替换原文件；失败时删掉
//! 临时文件，原来的分片文件不动。每个文件只有一路流（流 0）。

use std::path::Path;

use windows::Win32::Media::MediaFoundation::{
    IMFAttributes, IMFSample, MF_SOURCE_READERF_ENDOFSTREAM, MF_SOURCE_READERF_ERROR, MF_TRANSCODE_CONTAINERTYPE,
    MFCreateAttributes, MFCreateSinkWriterFromURL, MFCreateSourceReaderFromURL, MFTranscodeContainerType_MPEG4,
};
use windows_core::HSTRING;

pub fn to_plain_mp4(path: &Path) -> Result<(), String> {
    let temporary = path.with_extension("remux.tmp");
    let _ = std::fs::remove_file(&temporary);
    let result = unsafe { copy(path, &temporary) }.map_err(|error| format!("{} (HRESULT {:#010x})", error.message(), error.code().0 as u32));
    if let Err(message) = result {
        let _ = std::fs::remove_file(&temporary);
        return Err(message);
    }
    // 同一个目录里的重命名：替换是原子的（`MoveFileExW(MOVEFILE_REPLACE_EXISTING)`，Rust 的 `fs::rename` 在 Windows 上用它）。
    std::fs::rename(&temporary, path).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        format!("cannot replace the fragmented file: {error}")
    })
}

unsafe fn copy(from: &Path, to: &Path) -> windows_core::Result<()> {
    let reader = unsafe { MFCreateSourceReaderFromURL(&HSTRING::from(from.as_os_str()), None) }?;
    let native = unsafe { reader.GetNativeMediaType(0, 0) }?;
    let mut attributes: Option<IMFAttributes> = None;
    unsafe { MFCreateAttributes(&mut attributes, 1) }?;
    let attributes = attributes.ok_or_else(|| windows_core::Error::from(windows::Win32::Foundation::E_POINTER))?;
    unsafe { attributes.SetGUID(&MF_TRANSCODE_CONTAINERTYPE, &MFTranscodeContainerType_MPEG4) }?;
    let writer = unsafe { MFCreateSinkWriterFromURL(&HSTRING::from(to.as_os_str()), None, &attributes) }?;
    let stream = unsafe { writer.AddStream(&native) }?;
    unsafe { writer.SetInputMediaType(stream, &native, None) }?;
    unsafe { writer.BeginWriting() }?;
    let mut count = 0u64;
    loop {
        let mut flags = 0u32;
        let mut sample: Option<IMFSample> = None;
        unsafe { reader.ReadSample(0, 0, None, Some(&mut flags), None, Some(&mut sample)) }?;
        if flags & MF_SOURCE_READERF_ERROR.0 as u32 != 0 {
            return Err(windows_core::Error::from(windows::Win32::Foundation::E_FAIL));
        }
        if let Some(sample) = sample {
            unsafe { writer.WriteSample(stream, &sample) }?;
            count += 1;
        }
        if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
            break;
        }
    }
    if count == 0 {
        return Err(windows_core::Error::from(windows::Win32::Foundation::E_FAIL));
    }
    unsafe { writer.Finalize() }
}
