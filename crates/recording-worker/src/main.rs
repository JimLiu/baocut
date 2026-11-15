//! `recording-worker`：stdio 上的 JSON 行，与 Engine Host、Model Worker 同一套形状（`process-host` 的 `JsonLineWorker`）。
//! 方法与推送见 `protocol.rs` 与 `packages/runtime-core/src/recordings/worker-protocol.ts`。stdin 关闭时把开着的录制收尾再退出。

use std::io::{self, BufRead};
use std::sync::Arc;

use recording_worker::platform;
use recording_worker::server::Server;
use recording_worker::sink::Sink;

fn main() {
    let sink = Arc::new(Sink::new(Box::new(io::stdout())));
    let mut server = Server::new(platform::current(), sink);
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        server.handle_line(&line);
    }
    server.shutdown();
}
