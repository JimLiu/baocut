//! 请求的分派与一次录制的状态：至多一次录制，录制中至多一段开着。段的开始与结束、`begin` 行在这里写；各路流与
//! 指针、键盘的行由平台的 [`Capturer`] 写（它们的时刻只有采集线程知道）。

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::platform::{Capturer, Platform};
use crate::protocol::{
    HelloResult, JournalLine, KeysMode, Ns, PROTOCOL_VERSION, Recorder, Request, SegmentResult, StartParams, StartResult, StopResult,
    WorkerError, WorkerEvent,
};
use crate::sink::Sink;

/// 剩余空间低于这个值时推送一次 `disk-low`（Runtime 自己也按 5 秒查一次，到更低的线时停止并收尾）。
const DISK_LOW_BYTES: u64 = 1 << 30;
const DISK_POLL: Duration = Duration::from_secs(2);

struct Recording {
    dir: PathBuf,
    journal: PathBuf,
    capturer: Box<dyn Capturer>,
    /// 开着的段。
    segment: Option<String>,
    count: u32,
    disk: DiskMonitor,
}

pub struct Server {
    platform: Box<dyn Platform>,
    sink: Arc<Sink>,
    recording: Option<Recording>,
}

impl Server {
    pub fn new(platform: Box<dyn Platform>, sink: Arc<Sink>) -> Self {
        Self { platform, sink, recording: None }
    }

    pub fn handle_line(&mut self, line: &str) {
        let request = match serde_json::from_str::<Request>(line) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("bad request line: {error}");
                return;
            }
        };
        let result = self.handle(&request.method, request.params);
        self.sink.reply(&request.id, result);
    }

    pub fn handle(&mut self, method: &str, params: Value) -> Result<Value, WorkerError> {
        match method {
            "hello" => to_value(HelloResult {
                protocol: PROTOCOL_VERSION,
                version: env!("CARGO_PKG_VERSION").to_owned(),
                platform: self.platform.name().to_owned(),
                capture: self.platform.capability(),
            }),
            "sources" => to_value(self.platform.sources()?),
            "start" => {
                let params: StartParams =
                    serde_json::from_value(params).map_err(|error| WorkerError::new("INVALID_REQUEST", error.to_string()))?;
                to_value(self.start(params)?)
            }
            "pause" => to_value(self.pause()?),
            "resume" => to_value(self.resume()?),
            "stop" => to_value(self.stop()?),
            other => Err(WorkerError::new("UNKNOWN_METHOD", format!("unknown method {other}"))),
        }
    }

    fn start(&mut self, params: StartParams) -> Result<StartResult, WorkerError> {
        if self.recording.is_some() {
            return Err(WorkerError::new("ALREADY_RECORDING", "a recording is already running"));
        }
        if params.fps == 0 || params.fps > 240 {
            return Err(WorkerError::new("INVALID_REQUEST", format!("fps {} is out of range", params.fps)));
        }
        let dir = PathBuf::from(&params.dir);
        std::fs::create_dir_all(&dir).map_err(|error| io_error("cannot create the recording directory", error))?;
        let journal = self.sink.open_journal(&dir).map_err(|error| io_error("cannot open the journal", error))?;
        let mut capturer = match self.platform.open(&params, Arc::clone(&self.sink)) {
            Ok(capturer) => capturer,
            Err(error) => {
                self.sink.close_journal();
                return Err(error);
            }
        };
        let cursor = capturer.cursor();
        let capture = capturer.capture();
        let begin = JournalLine::Begin {
            recorder: Recorder {
                name: "baocut".to_owned(),
                version: Some(env!("CARGO_PKG_VERSION").to_owned()),
                revision: option_env!("BAOCUT_REVISION").map(str::to_owned),
            },
            platform: self.platform.name().to_owned(),
            started_at: iso_now(),
            cursor,
            keyboard: match params.keys {
                KeysMode::Off => None,
                other => Some(other),
            },
            capture: capture.clone(),
        };
        if let Err(error) = self.sink.journal(&begin, true) {
            capturer.close();
            self.sink.close_journal();
            return Err(io_error("cannot write the journal", error));
        }
        let mut recording =
            Recording { disk: DiskMonitor::start(&dir, Arc::clone(&self.sink)), dir, journal, capturer, segment: None, count: 0 };
        let (segment_id, at) = match self.open_segment(&mut recording) {
            Ok(opened) => opened,
            Err(error) => {
                recording.capturer.close();
                recording.disk.stop();
                self.sink.close_journal();
                return Err(error);
            }
        };
        self.recording = Some(recording);
        Ok(StartResult { segment_id, at_ns: at, cursor, capture })
    }

    fn open_segment(&self, recording: &mut Recording) -> Result<(String, Ns), WorkerError> {
        recording.count += 1;
        let id = format!("s{}", recording.count);
        let at = self.platform.now();
        self.sink
            .journal(&JournalLine::Segment { id: id.clone(), start_ns: at }, true)
            .map_err(|error| io_error("cannot write the journal", error))?;
        recording.capturer.begin_segment(&id, at)?;
        recording.segment = Some(id.clone());
        Ok((id, at))
    }

    fn close_segment(&self, recording: &mut Recording) -> Result<SegmentResult, WorkerError> {
        let Some(id) = recording.segment.take() else {
            return Err(WorkerError::new("NOT_RECORDING", "no segment is open"));
        };
        let at = self.platform.now();
        recording.capturer.end_segment(&id, at)?;
        self.sink
            .journal(&JournalLine::SegmentEnd { id: id.clone(), end_ns: at }, true)
            .map_err(|error| io_error("cannot write the journal", error))?;
        Ok(SegmentResult { segment_id: id, at_ns: at })
    }

    fn pause(&mut self) -> Result<SegmentResult, WorkerError> {
        let mut recording = self.recording.take().ok_or_else(|| WorkerError::new("NOT_RECORDING", "not recording"))?;
        let result = if recording.segment.is_some() {
            self.close_segment(&mut recording)
        } else {
            Err(WorkerError::new("NOT_RECORDING", "the recording is already paused"))
        };
        self.recording = Some(recording);
        result
    }

    fn resume(&mut self) -> Result<SegmentResult, WorkerError> {
        let mut recording = self.recording.take().ok_or_else(|| WorkerError::new("NOT_PAUSED", "not recording"))?;
        let result = if recording.segment.is_none() {
            self.open_segment(&mut recording).map(|(segment_id, at_ns)| SegmentResult { segment_id, at_ns })
        } else {
            Err(WorkerError::new("NOT_PAUSED", "the recording is not paused"))
        };
        self.recording = Some(recording);
        result
    }

    fn stop(&mut self) -> Result<StopResult, WorkerError> {
        let mut recording = self.recording.take().ok_or_else(|| WorkerError::new("NOT_RECORDING", "not recording"))?;
        let ended = if recording.segment.is_some() { self.close_segment(&mut recording).map(|_| ()) } else { Ok(()) };
        recording.capturer.close();
        recording.disk.stop();
        self.sink.close_journal();
        ended?;
        Ok(StopResult { journal: recording.journal.to_string_lossy().into_owned() })
    }

    /// stdin 关了（Runtime 退出或要求退出）：开着的段照常收尾，文件可读，日志完整。
    pub fn shutdown(&mut self) {
        if self.recording.is_some()
            && let Err(error) = self.stop()
        {
            eprintln!("could not finish the recording on shutdown: {error}");
        }
    }

    pub fn recording_dir(&self) -> Option<&Path> {
        self.recording.as_ref().map(|recording| recording.dir.as_path())
    }
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, WorkerError> {
    serde_json::to_value(value).map_err(|error| WorkerError::new("INTERNAL", error.to_string()))
}

fn io_error(what: &str, error: std::io::Error) -> WorkerError {
    WorkerError::new("IO_ERROR", format!("{what}: {error}"))
}

/// 现在的 UTC 时刻，ISO 8601（`2026-11-15T08:30:00.123Z`）。不为一个时间戳引入日期库。
fn iso_now() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        now.subsec_millis()
    )
}

/// 1970-01-01 起的天数换成公历日期（Howard Hinnant 的 `civil_from_days`）。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// 录制中每 2 秒看一次录制目录所在盘的剩余空间，跌破 [`DISK_LOW_BYTES`] 时推送一次 `disk-low`（回升后再跌再推）。
struct DiskMonitor {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl DiskMonitor {
    fn start(dir: &Path, sink: Arc<Sink>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let dir = dir.to_path_buf();
        let thread = std::thread::Builder::new()
            .name("disk-monitor".to_owned())
            .spawn(move || {
                let mut warned = false;
                while !flag.load(Ordering::Relaxed) {
                    if let Some(free) = free_bytes(&dir) {
                        if free < DISK_LOW_BYTES && !warned {
                            sink.emit(&WorkerEvent::DiskLow { free_bytes: free });
                            warned = true;
                        } else if free > DISK_LOW_BYTES + DISK_LOW_BYTES / 2 {
                            warned = false;
                        }
                    }
                    // 分小步睡，停止时不用等满 2 秒。
                    for _ in 0..20 {
                        if flag.load(Ordering::Relaxed) {
                            break;
                        }
                        std::thread::sleep(DISK_POLL / 20);
                    }
                }
            })
            .ok();
        Self { stop, thread }
    }

    fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(unix)]
pub fn free_bytes(dir: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(dir.as_os_str().as_bytes()).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    Some(stat.f_bavail as u64 * stat.f_frsize as u64)
}

#[cfg(not(unix))]
pub fn free_bytes(_dir: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    #[test]
    fn civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_407), (2025, 11, 15));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }
}
