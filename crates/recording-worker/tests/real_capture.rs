//! 真实采集（屏幕录制设计 §7「画面静止时」）：录一块静止的区域，强杀 Worker，屏幕文件仍然读得出、长度接近录的时长。
//!
//! 要真的录屏，所以缺省跳过：设 `BAOCUT_RECORDING_REAL_CAPTURE=1` 才跑，并且只在 macOS、屏幕录制权限已经允许、
//! 列得出显示器时跑（屏幕锁着时列不出），不会触发授权窗口。读文件要 `ffprobe`，找不到时跳过。
//! 只录主屏幕左上角一小块（菜单栏下方），不录麦克风、摄像头与系统声音。

#![cfg(target_os = "macos")]

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

struct Worker {
    child: std::process::Child,
    lines: std::sync::mpsc::Receiver<Value>,
    next: u64,
}

impl Worker {
    fn spawn() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_recording-worker"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn recording-worker");
        let stdout = child.stdout.take().unwrap();
        let (tx, lines) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    let _ = tx.send(value);
                }
            }
        });
        Self { child, lines, next: 0 }
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let id = self.next;
        let line = json!({ "id": id, "method": method, "params": params }).to_string();
        let stdin = self.child.stdin.as_mut().unwrap();
        writeln!(stdin, "{line}").unwrap();
        stdin.flush().unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let message = self.lines.recv_timeout(left).unwrap_or_else(|_| panic!("no answer to {method}"));
            if message["id"] == json!(id) {
                return message;
            }
        }
    }
}

fn ffprobe(path: &std::path::Path) -> Option<(u64, f64)> {
    let output = Command::new("ffprobe")
        .args(["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames:format=duration", "-of", "json"])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value: Value = serde_json::from_slice(&output.stdout).ok()?;
    let frames = value["streams"][0]["nb_read_frames"].as_str()?.parse().ok()?;
    let duration = value["format"]["duration"].as_str()?.parse().ok()?;
    Some((frames, duration))
}

#[test]
fn static_area_survives_kill() {
    if std::env::var("BAOCUT_RECORDING_REAL_CAPTURE").as_deref() != Ok("1") {
        eprintln!("skipped: set BAOCUT_RECORDING_REAL_CAPTURE=1 to record the screen");
        return;
    }
    if Command::new("ffprobe").arg("-version").stdout(Stdio::null()).status().is_err() {
        eprintln!("skipped: ffprobe not found");
        return;
    }
    let mut worker = Worker::spawn();
    let sources = worker.request("sources", json!({}));
    if sources["result"]["permissions"]["screen"] != json!("granted") || sources["result"]["displays"].as_array().is_none_or(|d| d.is_empty()) {
        eprintln!("skipped: screen recording is not granted or no display is listed (locked screen?)");
        let _ = worker.child.kill();
        return;
    }
    let dir = std::env::temp_dir().join(format!("baocut-real-capture-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let started = worker.request(
        "start",
        json!({
            "dir": dir,
            "source": { "kind": "area", "rect": { "x": 0, "y": 40, "width": 320, "height": 200 } },
            "camera": null, "microphone": null, "systemAudio": false, "cursor": "none", "keys": "off", "fps": 30,
        }),
    );
    assert!(started.get("error").is_none(), "start failed: {started}");
    let seconds = 5.0;
    std::thread::sleep(Duration::from_secs_f64(seconds));
    worker.child.kill().unwrap();
    let _ = worker.child.wait();
    std::thread::sleep(Duration::from_millis(300));

    let screen = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with("-screen.mp4")))
        .expect("a screen file");
    let probed = ffprobe(&screen);
    let _ = std::fs::remove_dir_all(&dir);
    let (frames, duration) = probed.expect("the screen file is readable after kill -9");
    // 补帧半秒一帧、分片一秒一个：最多丢最近一秒多。
    assert!(duration >= seconds - 2.0, "duration {duration} s after {seconds} s");
    assert!(frames as f64 >= (seconds - 2.0) * 2.0, "{frames} frames");
}
