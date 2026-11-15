//! 往外写的两处：stdout 上的 JSON 行（响应与推送），录制目录里只追加的 `journal.jsonl`。采集线程与主线程都会写，
//! 各自一把锁；每写一行就 flush，段的边界上再 `sync_data`，进程崩溃时日志里有的都已经在盘上。

use std::fs::{File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use crate::protocol::{JournalLine, Ns, WorkerEvent};

pub struct Sink {
    out: Mutex<Box<dyn Write + Send>>,
    journal: Mutex<Option<File>>,
}

impl Sink {
    pub fn new(out: Box<dyn Write + Send>) -> Self {
        Self { out: Mutex::new(out), journal: Mutex::new(None) }
    }

    fn line(&self, value: &Value) {
        let Ok(mut out) = self.out.lock() else { return };
        // stdout 断了（Runtime 退出）就没有人读了：忽略写失败，stdin 关闭时进程收尾退出。
        let _ = serde_json::to_writer(&mut *out, value);
        let _ = out.write_all(b"\n");
        let _ = out.flush();
    }

    pub fn reply(&self, id: &Value, result: Result<Value, crate::protocol::WorkerError>) {
        let value = match result {
            Ok(result) => serde_json::json!({ "id": id, "result": result }),
            Err(error) => serde_json::json!({ "id": id, "error": error }),
        };
        self.line(&value);
    }

    pub fn emit(&self, event: &WorkerEvent) {
        if let Ok(value) = serde_json::to_value(event) {
            self.line(&value);
        }
    }

    pub fn open_journal(&self, dir: &Path) -> io::Result<PathBuf> {
        let path = dir.join("journal.jsonl");
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        *self.journal.lock().map_err(|_| io::Error::other("journal lock poisoned"))? = Some(file);
        Ok(path)
    }

    pub fn close_journal(&self) {
        if let Ok(mut journal) = self.journal.lock()
            && let Some(file) = journal.take()
        {
            let _ = file.sync_all();
        }
    }

    /// 追加一行日志。`durable` 时等它落盘（段的开始与结束、各路流的开始与结束）。
    pub fn journal(&self, line: &JournalLine, durable: bool) -> io::Result<()> {
        let mut journal = self.journal.lock().map_err(|_| io::Error::other("journal lock poisoned"))?;
        let Some(file) = journal.as_mut() else {
            return Err(io::Error::other("no journal is open"));
        };
        let mut text = serde_json::to_vec(line).map_err(io::Error::other)?;
        text.push(b'\n');
        file.write_all(&text)?;
        if durable {
            file.sync_data()?;
        }
        Ok(())
    }
}

/// 指针或键盘的事件文件：每行一个 JSON 数组。每行都 flush（60 次每秒的小写入），崩溃时最多丢最后一行。
pub struct TrackFile {
    name: String,
    file: BufWriter<File>,
}

impl TrackFile {
    pub fn create(dir: &Path, name: String) -> io::Result<Self> {
        let file = OpenOptions::new().create(true).truncate(true).write(true).open(dir.join(&name))?;
        Ok(Self { name, file: BufWriter::new(file) })
    }

    pub fn push<T: Serialize>(&mut self, row: &T) {
        if serde_json::to_writer(&mut self.file, row).is_ok() {
            let _ = self.file.write_all(b"\n");
            let _ = self.file.flush();
        }
    }

    /// 收尾：落盘，返回文件名（相对录制目录）。
    pub fn finish(mut self) -> String {
        let _ = self.file.flush();
        let _ = self.file.get_ref().sync_data();
        self.name
    }
}

/// 指针事件文件的三种行（视频格式规范 §4.8 的来源；`worker-protocol.ts` 的 `PointerEventLine`）。
pub fn pointer_move(at: Ns, x: f64, y: f64) -> Value {
    serde_json::json!([at, "m", round6(x), round6(y)])
}

pub fn pointer_button(at: Ns, button: u32, down: bool) -> Value {
    serde_json::json!([at, "b", button, u8::from(down)])
}

pub fn pointer_cursor(at: Ns, cursor: &str) -> Value {
    serde_json::json!([at, "c", cursor])
}

/// 键盘事件文件的一行：`[ns, code, down, key]`（`shortcuts` 时 `key` 是空字符串）。
pub fn key_event(at: Ns, code: &str, down: bool, key: &str) -> Value {
    serde_json::json!([at, code, u8::from(down), key])
}

fn round6(value: f64) -> f64 {
    (value * 1e6).round() / 1e6
}
