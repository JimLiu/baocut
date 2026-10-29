/**
 * 假的 `audiocpp_server`（Model Worker 协议规范 §4.4 的语音服务）：一个 Node 脚本，测试用 `writeFakeAudioCpp` 生成的可执行包装调用它，
 * 包装设置 `FAKE_AUDIOCPP_CONTROL` 与 `FAKE_AUDIOCPP_RECORD`。
 *
 * - `--version`：像 macOS 的发布构建那样打印版本与编进去的后端（`backends: cpu,metal`）。
 * - 否则读 `--config`，在配置的端口上回 `GET /health` 与 `POST /v1/audio/speech`（一秒 24 kHz 的满幅正弦 WAV）。
 * - 每次启动与请求追加一行到 `FAKE_AUDIOCPP_RECORD`：`{ pid, kind: 'start', args, config }` 或
 *   `{ pid, kind: 'request', body, reference }`（`reference` 是 `voice_ref` 文件的 sha256）。
 * - `FAKE_AUDIOCPP_CONTROL` 的 JSON 控制故障，每次读：`startExit`（启动时以错误退出）、`crash`（请求时崩溃）、
 *   `reject: { status, message }`（HTTP 错误）、`slowMs`（晚回）、`silent`（静音）、`notWav`（回的不是 WAV）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

interface Control {
  startExit?: string;
  crash?: string;
  reject?: { status: number; message: string };
  slowMs?: number;
  silent?: boolean;
  notWav?: boolean;
}

const args = process.argv.slice(2);
if (args.includes('--version')) {
  fs.writeSync(1, 'audio.cpp 0.9.3\ngit: fake\nbuild: Release, fake\nbackends: cpu,metal\n');
  process.exit(0);
}

const control = (): Control => {
  try {
    return JSON.parse(fs.readFileSync(process.env.FAKE_AUDIOCPP_CONTROL ?? '', 'utf8')) as Control;
  } catch {
    return {};
  }
};
const record = (entry: Record<string, unknown>) => {
  const file = process.env.FAKE_AUDIOCPP_RECORD;
  if (file) fs.appendFileSync(file, JSON.stringify({ pid: process.pid, ...entry }) + '\n');
};
const config = JSON.parse(fs.readFileSync(args[args.indexOf('--config') + 1]!, 'utf8')) as { host: string; port: number };
record({ kind: 'start', args, config });
const startup = control();
if (startup.startExit) {
  fs.writeSync(2, `error: ${startup.startExit}\n`);
  process.exit(2);
}

function wav(seconds: number, amplitude: number): Buffer {
  const rate = 24_000;
  const frames = Math.round(seconds * rate);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(Math.sin(i / 10) * amplitude * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/audio/speech') {
      res.writeHead(404);
      res.end();
      return;
    }
    let text = '';
    req.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    req.on('end', () => {
      const body = JSON.parse(text) as { voice_ref?: string };
      const c = control();
      const reference =
        body.voice_ref && fs.existsSync(body.voice_ref) ? crypto.createHash('sha256').update(fs.readFileSync(body.voice_ref)).digest('hex') : null;
      record({ kind: 'request', body, reference });
      if (c.crash) {
        fs.writeSync(2, `fatal: ${c.crash}\n`);
        process.exit(134);
      }
      const reply = () => {
        if (c.reject) {
          res.writeHead(c.reject.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: c.reject.message } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'audio/wav' });
        res.end(c.notWav ? 'not a wav' : wav(1, c.silent ? 0 : 1));
      };
      if (c.slowMs) setTimeout(reply, c.slowMs);
      else reply();
    });
  })
  .listen(config.port, config.host);
